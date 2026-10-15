// Personal data: watchlist (W), portfolio (PORT) and alerts (ALRT).
// Stored in KV: "p:<chat_id>" — watchlist and portfolio, "alerts" — all alerts (cron checks them every 2 minutes).
// The same person sees the same data in the bot and in the terminal opened with the Telegram button.
import { esc, send, siteData } from "./lib.js";
import { L, getLang, newsField, sourceName, t } from "./i18n.js";
import { getQuotes, parseSymbol } from "./market.js";

export const MAX_WATCH = 40, MAX_PORT = 40, MAX_ALERTS_USER = 20, MAX_ALERTS_TOTAL = 400;

export async function getUser(env, id) {
  const raw = await env.SUBS.get("p:" + id);
  let u = {};
  try { u = raw ? JSON.parse(raw) : {}; } catch { u = {}; }
  return { w: Array.isArray(u.w) ? u.w : [], p: Array.isArray(u.p) ? u.p : [] };
}

export async function saveUser(env, id, u) {
  const clean = { w: cleanWatch(u.w || []), p: cleanPort(u.p || []) };
  await env.SUBS.put("p:" + id, JSON.stringify(clean));
  return clean;
}

export function cleanWatch(list) {
  const out = [];
  for (const raw of list) {
    const p = parseSymbol(raw);
    if (p && !out.includes(p.key)) out.push(p.key);
    if (out.length >= MAX_WATCH) break;
  }
  return out;
}

export function cleanPort(list) {
  const by = new Map();
  for (const x of list) {
    const p = parseSymbol(x && x.s);
    const q = Number(x && x.q), c = Number(x && x.c);
    if (!p || !isFinite(q) || q === 0 || !isFinite(c) || c < 0) continue;
    const old = by.get(p.key);
    if (old) {   // one position per instrument: average purchase price
      const nq = old.q + q;
      by.set(p.key, { s: p.key, q: nq, c: nq ? (old.q * old.c + q * c) / nq : 0 });
    } else by.set(p.key, { s: p.key, q, c });
    if (by.size >= MAX_PORT) break;
  }
  return [...by.values()].map((x) => ({ s: x.s, q: Math.round(x.q * 1e6) / 1e6, c: Math.round(x.c * 1e6) / 1e6 }));
}

// Portfolio at current prices: value, profit/loss, daily change
export async function portfolioView(env, port) {
  const quotes = port.length ? await getQuotes(env, port.map((x) => x.s)) : {};
  let value = 0, cost = 0, day = 0;
  const rows = port.map((x) => {
    const q = quotes[x.s] || {};
    const px = q.px != null ? q.px : null;
    const val = px != null ? px * x.q : null;
    const pl = val != null ? val - x.c * x.q : null;
    if (val != null) {
      value += val; cost += x.c * x.q;
      if (q.ch != null) day += val - val / (1 + q.ch / 100);
    }
    return { s: x.s, q: x.q, c: x.c, px, ch: q.ch, cur: q.cur || "", name: q.name, val, pl, plp: pl != null && x.c ? (px / x.c - 1) * 100 : null };
  });
  return { rows, value, cost, pl: value - cost, plp: cost ? (value / cost - 1) * 100 : null, day, dayp: value ? day / (value - day) * 100 : null };
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
export async function loadAlerts(env) {
  const raw = await env.SUBS.get("alerts");
  let a = {};
  try { a = raw ? JSON.parse(raw) : {}; } catch { a = {}; }
  return { list: Array.isArray(a.list) ? a.list : [], nid: a.nid || 1, news_ts: a.news_ts || "" };
}

export async function saveAlerts(env, a) {
  await env.SUBS.put("alerts", JSON.stringify(a));
}

// "AAPL > 200", "BTC below 60000", "oil above 80", "AAPL 5%", "news Fed" (Russian words work too)
export function parseAlert(text) {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  let m = /^(?:news|n|word|новост[иь]|слово)\s+(.{2,60})$/i.exec(t);
  if (m) return { k: "news", kw: m[1].trim().replace(/^["«]|["»]$/g, "") };
  m = /^(.+?)\s*(>=|<=|>|<|выше|ниже|above|below)\s*([\d\s.,]+)$/i.exec(t);
  if (m) {
    const p = parseSymbol(m[1]);
    const v = Number(m[3].replace(/\s/g, "").replace(",", "."));
    if (!p || !isFinite(v)) return null;
    const op = /[>]|выше|above/i.test(m[2]) ? ">" : "<";
    return { k: "px", s: p.key, op, v };
  }
  m = /^(.+?)\s+(?:±|\+-|chg\s*|change\s*|изм(?:енение)?\s*)?([\d.,]+)\s*%$/i.exec(t);
  if (m) {
    const p = parseSymbol(m[1]);
    const v = Number(m[2].replace(",", "."));
    if (!p || !isFinite(v) || v <= 0) return null;
    return { k: "chg", s: p.key, v };
  }
  m = /^(.+?)\s+([\d\s.,]+)$/.exec(t);   // "AAPL 200": the direction is taken from the current price
  if (m) {
    const p = parseSymbol(m[1]);
    const v = Number(m[2].replace(/\s/g, "").replace(",", "."));
    if (p && isFinite(v)) return { k: "px", s: p.key, op: "?", v };
  }
  return null;
}

export function alertText(a, lang = "en") {
  const X = L(lang);
  if (a.k === "news") return X.t("a_news", esc(a.kw));
  if (a.k === "chg") return X.t("a_chg", esc(a.s), X.fmt(a.v, a.v % 1 ? 1 : 0));
  return X.t("a_px", esc(a.s), a.op, X.price(a.v));
}

export async function addAlert(env, chatId, spec, lang = "en") {
  const a = await loadAlerts(env);
  const mine = a.list.filter((x) => String(x.c) === String(chatId));
  if (mine.length >= MAX_ALERTS_USER) throw new Error(t(lang, "a_max_user", MAX_ALERTS_USER));
  if (a.list.length >= MAX_ALERTS_TOTAL) throw new Error(t(lang, "a_max_total"));
  const item = { id: a.nid++, c: String(chatId), t: new Date().toISOString(), ...spec };
  if (item.k === "px" && item.op === "?") {
    const q = (await getQuotes(env, [item.s]))[item.s];
    if (!q || q.px == null) throw new Error(t(lang, "a_no_price", item.s));
    item.op = item.v >= q.px ? ">" : "<";
  }
  a.list.push(item);
  await saveAlerts(env, a);
  return item;
}

export async function deleteAlert(env, chatId, id) {
  const a = await loadAlerts(env);
  const before = a.list.length;
  a.list = a.list.filter((x) => !(String(x.c) === String(chatId) && String(x.id) === String(id)));
  if (a.list.length === before) return false;
  await saveAlerts(env, a);
  return true;
}

export async function userAlerts(env, chatId) {
  const a = await loadAlerts(env);
  return a.list.filter((x) => String(x.c) === String(chatId));
}

// Alert check (cron every 2 minutes). KV free tier allows 1,000 writes a day, so the alert list is written
// only when something fired (or on the very first run), not on every check.
const NEWS_FIELDS = ["title", "title_en", "title_ru", "original", "lead", "lead_en", "lead_ru"];

function newsHaystack(n) {
  const ai = n.ai || {};
  return NEWS_FIELDS.map((k) => n[k] || "").concat([ai.sum || "", ai.sum_ru || ""]).join(" ").toLowerCase();
}

export async function checkAlerts(env, now = new Date()) {
  const a = await loadAlerts(env);
  if (!a.list.length) return { checked: 0, fired: 0 };
  let changed = false, fired = 0;
  const today = now.toISOString().slice(0, 10);
  const syms = [...new Set(a.list.filter((x) => x.k !== "news").map((x) => x.s))];
  const quotes = syms.length ? await getQuotes(env, syms).catch(() => ({})) : {};
  const keep = [];
  for (const x of a.list) {
    if (x.k === "news") { keep.push(x); continue; }
    const q = quotes[x.s];
    if (!q || q.px == null) { keep.push(x); continue; }
    let hit = false, text = "";
    const X = L(await getLang(env, x.c));
    if (x.k === "px") {
      hit = x.op === ">" ? q.px >= x.v : q.px <= x.v;
      text = X.t("fire_px", esc(x.s), x.op, X.price(x.v), X.price(q.px), X.pct(q.ch)) + X.t("fire_px_note", esc(x.s), x.op, x.v);
    } else if (x.k === "chg") {
      hit = q.ch != null && Math.abs(q.ch) >= x.v && x.day !== today;
      text = X.t("fire_chg", esc(x.s), q.ch > 0, X.pct(q.ch), X.price(q.px)) + X.t("fire_chg_note", X.fmt(x.v, x.v % 1 ? 1 : 0));
    }
    if (!hit) { keep.push(x); continue; }
    const r = await send(env, x.c, text);
    fired++;
    changed = true;
    if (r && r.ok === false && /blocked|not found|deactivated/i.test(r.description || "")) continue;   // the person left — drop the alert
    if (x.k === "chg") keep.push({ ...x, day: today });
  }
  // news: look for the word in headlines and summaries that appeared after the last saved check
  const newsAlerts = keep.filter((x) => x.k === "news");
  if (newsAlerts.length) {
    const d = await siteData(env).catch(() => null);
    const since = Date.parse(a.news_ts) || 0;
    const items = ((d && d.news) || []).filter((n) => Date.parse(n.ts) > since);
    if (items.length) {
      const latest = items.reduce((m, n) => Math.max(m, Date.parse(n.ts) || 0), since);
      let hits = 0;
      if (a.news_ts) {   // on the very first run only remember the time, so old stories are not sent
        for (const x of newsAlerts) {
          const kw = x.kw.toLowerCase();
          const created = Date.parse(x.t) || 0;   // a new alert does not get stories published before it was set
          const found = items.filter((n) => Date.parse(n.ts) > created && newsHaystack(n).includes(kw)).slice(0, 3);
          if (!found.length) continue;
          const X = L(await getLang(env, x.c));
          for (const n of found) {
            const link = /^https?:\/\//.test(n.link || "") ? ` · <a href="${esc(n.link)}">${X.t("read")}</a>` : "";
            const lead = newsField(n, "lead", X.lang);
            await send(env, x.c, X.t("fire_news", esc(x.kw)) + `\n${n.level === "high" ? "🔴" : "🟡"} <b>${esc(newsField(n, "title", X.lang))}</b>` +
              (lead ? "\n" + esc(lead.slice(0, 220)) : "") + `\n<i>${esc((n.sources || []).map((s) => sourceName(s, X.lang)).join(", "))}</i>${link}`);
            fired++;
            hits++;
          }
        }
      }
      // save the time only when it matters: first run, something was sent, or the saved mark is over 6 hours old
      if (!a.news_ts || hits || latest - since > 6 * 3600e3) {
        a.news_ts = new Date(latest).toISOString();
        changed = true;
      }
    }
  }
  if (changed) {
    a.list = keep;
    await saveAlerts(env, a);
  }
  return { checked: a.list.length, fired };
}

// ---------------------------------------------------------------------------
// /api/me — watchlist, portfolio and alerts for the terminal (sign-in via Telegram or the owner's password)
// ---------------------------------------------------------------------------
export async function meApi(req, env, who, lang = "en") {
  if (!who) return { ok: false, error: t(lang, "me_login") };
  const id = String(who.id);
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (body.op === "alert_add") {
      const spec = parseAlert(body.text);
      if (!spec) return { ok: false, error: t(lang, "me_bad_alert") };
      try {
        const item = await addAlert(env, id, spec, lang);
        return { ok: true, added: item, alerts: await userAlerts(env, id) };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    }
    if (body.op === "alert_del") {
      await deleteAlert(env, id, body.id);
      return { ok: true, alerts: await userAlerts(env, id) };
    }
    const u = await getUser(env, id);
    if (Array.isArray(body.w)) u.w = body.w;
    if (Array.isArray(body.p)) u.p = body.p;
    const saved = await saveUser(env, id, u);
    return { ok: true, id, ...saved };
  }
  const [u, alerts] = await Promise.all([getUser(env, id), userAlerts(env, id)]);
  return { ok: true, id, name: who.name || "", ...u, alerts };
}
