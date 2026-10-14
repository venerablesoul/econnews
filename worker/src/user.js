// Личное: список наблюдения (W), портфель (PORT) и алерты (ALRT).
// Хранится в KV: "p:<chat_id>" — список и портфель, "alerts" — все алерты (их раз в 2 минуты проверяет cron).
// Один и тот же человек видит одно и то же в боте и в терминале, открытом кнопкой из Telegram.
import { cached, esc, fmt, pct, price, send, siteData } from "./lib.js";
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
    if (old) {   // одна позиция на инструмент: средняя цена покупки
      const nq = old.q + q;
      by.set(p.key, { s: p.key, q: nq, c: nq ? (old.q * old.c + q * c) / nq : 0 });
    } else by.set(p.key, { s: p.key, q, c });
    if (by.size >= MAX_PORT) break;
  }
  return [...by.values()].map((x) => ({ s: x.s, q: Math.round(x.q * 1e6) / 1e6, c: Math.round(x.c * 1e6) / 1e6 }));
}

// Портфель с текущими ценами: стоимость, прибыль/убыток, изменение за день
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
// Алерты
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

// «AAPL > 200», «BTC ниже 60000», «нефть выше 80», «AAPL 5%», «новости ФРС»
export function parseAlert(text) {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  let m = /^(?:news|n|новост[иь]|слово|word)\s+(.{2,60})$/i.exec(t);
  if (m) return { k: "news", kw: m[1].trim().replace(/^["«]|["»]$/g, "") };
  m = /^(.+?)\s*(>=|<=|>|<|выше|ниже|above|below)\s*([\d\s.,]+)$/i.exec(t);
  if (m) {
    const p = parseSymbol(m[1]);
    const v = Number(m[3].replace(/\s/g, "").replace(",", "."));
    if (!p || !isFinite(v)) return null;
    const op = /[>]|выше|above/i.test(m[2]) ? ">" : "<";
    return { k: "px", s: p.key, op, v };
  }
  m = /^(.+?)\s+(?:±|\+-|изм(?:енение)?\s*)?([\d.,]+)\s*%$/i.exec(t);
  if (m) {
    const p = parseSymbol(m[1]);
    const v = Number(m[2].replace(",", "."));
    if (!p || !isFinite(v) || v <= 0) return null;
    return { k: "chg", s: p.key, v };
  }
  m = /^(.+?)\s+([\d\s.,]+)$/.exec(t);   // «AAPL 200»: направление определим по текущей цене
  if (m) {
    const p = parseSymbol(m[1]);
    const v = Number(m[2].replace(/\s/g, "").replace(",", "."));
    if (p && isFinite(v)) return { k: "px", s: p.key, op: "?", v };
  }
  return null;
}

export function alertText(a) {
  if (a.k === "news") return `📰 новость со словом «${esc(a.kw)}»`;
  if (a.k === "chg") return `${esc(a.s)}: изменение за день ±${fmt(a.v, a.v % 1 ? 1 : 0)}%`;
  return `${esc(a.s)} ${a.op === ">" ? "выше" : "ниже"} ${price(a.v)}`;
}

export async function addAlert(env, chatId, spec) {
  const a = await loadAlerts(env);
  const mine = a.list.filter((x) => String(x.c) === String(chatId));
  if (mine.length >= MAX_ALERTS_USER) throw new Error(`не больше ${MAX_ALERTS_USER} алертов на человека — удалите лишние`);
  if (a.list.length >= MAX_ALERTS_TOTAL) throw new Error("на сервере слишком много алертов, попробуйте позже");
  const item = { id: a.nid++, c: String(chatId), t: new Date().toISOString(), ...spec };
  if (item.k === "px" && item.op === "?") {
    const q = (await getQuotes(env, [item.s]))[item.s];
    if (!q || q.px == null) throw new Error("не удалось получить цену " + item.s + " — укажите явно: > или <");
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

// Проверка алертов (cron раз в 2 минуты)
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
    if (x.k === "px") {
      hit = x.op === ">" ? q.px >= x.v : q.px <= x.v;
      text = `🔔 <b>${esc(x.s)}</b> ${x.op === ">" ? "поднялся выше" : "опустился ниже"} ${price(x.v)}: сейчас <b>${price(q.px)}</b> (${pct(q.ch)} за день)` +
        "\n<i>Алерт выполнен и удалён. Поставить снова: /alert " + esc(x.s) + (x.op === ">" ? " > " : " < ") + x.v + "</i>";
    } else if (x.k === "chg") {
      hit = q.ch != null && Math.abs(q.ch) >= x.v && x.day !== today;
      text = `🔔 <b>${esc(x.s)}</b> ${q.ch > 0 ? "вырос" : "упал"} за день на <b>${pct(q.ch)}</b>: ${price(q.px)}` +
        `\n<i>Порог ±${fmt(x.v, x.v % 1 ? 1 : 0)}%. Следующее оповещение — не раньше завтра.</i>`;
    }
    if (!hit) { keep.push(x); continue; }
    const r = await send(env, x.c, text);
    fired++;
    changed = true;
    if (r && r.ok === false && /blocked|not found|deactivated/i.test(r.description || "")) continue;   // человек ушёл — алерт убираем
    if (x.k === "chg") keep.push({ ...x, day: today });
  }
  // новости: ищем слово в заголовках и выжимках, вышедших после прошлой проверки
  const newsAlerts = keep.filter((x) => x.k === "news");
  if (newsAlerts.length) {
    const d = await siteData(env).catch(() => null);
    const items = ((d && d.news) || []).filter((n) => n.ts > a.news_ts);
    if (items.length) {
      const latest = items.reduce((m, n) => (n.ts > m ? n.ts : m), a.news_ts);
      if (a.news_ts) {   // в первый раз только запоминаем время, чтобы не присылать старое
        for (const x of newsAlerts) {
          const kw = x.kw.toLowerCase();
          const hits = items.filter((n) => [n.title, n.original, n.lead].join(" ").toLowerCase().includes(kw)).slice(0, 3);
          for (const n of hits) {
            const link = /^https?:\/\//.test(n.link || "") ? ` · <a href="${esc(n.link)}">читать →</a>` : "";
            await send(env, x.c, `🔔 Новость по слову «${esc(x.kw)}»\n${n.level === "high" ? "🔴" : "🟡"} <b>${esc(n.title)}</b>` +
              (n.lead ? "\n" + esc(n.lead.slice(0, 220)) : "") + `\n<i>${esc((n.sources || []).join(", "))}</i>${link}`);
            fired++;
          }
        }
      }
      a.news_ts = latest;
      changed = true;
    }
  }
  if (changed) {
    a.list = keep;
    await saveAlerts(env, a);
  }
  return { checked: a.list.length, fired };
}

// ---------------------------------------------------------------------------
// /api/me — список, портфель и алерты для терминала (вход через Telegram или пароль владельца)
// ---------------------------------------------------------------------------
export async function meApi(req, env, who) {
  if (!who) return { ok: false, error: "Откройте терминал кнопкой «🖥 Терминал» в чате с ботом — тогда список, портфель и алерты будут общими с ботом." };
  const id = String(who.id);
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (body.op === "alert_add") {
      const spec = parseAlert(body.text);
      if (!spec) return { ok: false, error: "Не понял алерт. Примеры: AAPL > 200 · BTC < 60000 · нефть 5% · новости ФРС" };
      try {
        const item = await addAlert(env, id, spec);
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
