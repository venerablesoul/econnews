// EconNews bot server on Cloudflare Workers (free plan).
//
// What it does:
//   /tg             — Telegram webhook: answers /start and commands instantly, keeps the subscriber list
//   /subs           — subscribers for the mailing (read by news_bot.py; key required), with each one's language
//   /subs/remove    — drop subscribers who blocked the bot
//   /sync/live      — the news bot pushes fresh stories here every 5 minutes (key required)
//   /api/quotes     — live quotes for the terminal. API keys stay here and never reach the browser:
//                     everyone — US stocks via the free Finnhub key, currencies/metals/oil via Finnhub's stream,
//                     world indices, commodities and yields via Yahoo Finance (free, no key);
//                     the owner — optionally the paid EODHD feed instead of Yahoo (only if EODHD_API_KEY is set)
//   /api/quote      — quotes of anything: ?s=AAPL,BTC,SBER,oil
//   /api/company    — company: ?s=AAPL&parts=des,fa,ern,anr,cn,hds,co,dvd,cf,opt,rv[&lang=ru]
//   /api/history    — price history: ?s=AAPL&r=1y (1d 5d 1m 3m 6m ytd 1y 2y 5y)
//   /api/ipo        — IPO calendar: upcoming, recently priced and filed (Nasdaq calendar via the news bot + Finnhub)
//   /api/corr       — correlation matrix in one request: ?s=S%26P,GOLD,BTC&r=1y (3m 6m 1y 2y 5y)
//   /api/live       — fresh stories and quotes from the news bot
//   /api/me         — watchlist, portfolio and alerts (sign-in via Telegram or the owner's password)
//   /api/geo        — map layers and calendars from sources that do not allow browsers: ?u=<address> (listed hosts only)
//   /api/perf       — returns over 1D…5Y for up to 40 instruments: ?s=SPY,QQQ,GOLD (TRAY, FPC)
//   cron            — every 2 minutes checks alerts and sends messages
//
// Secrets (set automatically from the GitHub secrets):
//   TELEGRAM_BOT_TOKEN, OWNER_ID, FINNHUB_API_KEY, EODHD_API_KEY (optional, paid), TERMINAL_PASSWORD (optional)
// Variable: PAGES_URL — the bot's site (data.json, stocks.json, rates.json, fin/ live there).
// KV storage: SUBS — subscribers, languages, personal data, alerts, the live feed.
import {
  arrow, cached, cors, esc, hex, hmac, hookKey, isOwnerChat, json, pagesUrl, send, siteData, syncKey, tg,
} from "./lib.js";
import { COMPANY_PARTS, getCompany, getCorr, getHistory, getIpos, getQuotes, mktName, parseSymbol, worldQuotes } from "./market.js";
import { isNewCallback, newCallback, newCommand, watchReminders } from "./botcmd.js";
import { L, aiSum, getLang, newsField, norm, setLang, sourceName, t, tagName, tradeLabel, TRADE_TYPE } from "./i18n.js";
import { checkAlerts, meApi } from "./user.js";
import { geoProxy, getPerf } from "./extra.js";

// US stocks and ETFs — free Finnhub key, for everyone
const STOCKS = ["SPY", "QQQ", "DIA", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA"];

// world markets — paid EODHD key, owner only and only if the key is set (ids as in the terminal)
const EOD = {
  "S&P": "GSPC.INDX", "Nasdaq": "IXIC.INDX", "DJI": "DJI.INDX", "RTY": "RUT.INDX", "VIX": "VIX.INDX",
  "SX5E": "STOXX50E.INDX", "DAX": "GDAXI.INDX", "UKX": "FTSE.INDX", "CAC": "FCHI.INDX", "NKY": "N225.INDX",
  "HSI": "HSI.INDX", "SHCOMP": "SSEC.INDX", "SENSEX": "BSESN.INDX", "EUR/USD": "EURUSD.FOREX",
  "USDJPY": "USDJPY.FOREX", "GBPUSD": "GBPUSD.FOREX", "USDCNY": "USDCNY.FOREX", "USDCHF": "USDCHF.FOREX",
  "USD/RUB": "USDRUB.FOREX", "CNY/RUB": "CNYRUB.FOREX", "Золото": "XAUUSD.FOREX", "Серебро": "XAGUSD.FOREX",
  "Платина": "XPTUSD.FOREX", "UST3M": "US3M.GBOND", "UST5": "US5Y.GBOND", "UST10": "US10Y.GBOND", "UST30": "US30Y.GBOND",
};

// currencies, metals, oil and gas — Finnhub's trade stream (OANDA), free key, for everyone
// (ids like "Золото" are internal keys shared with data.json and the terminal, not display names)
const FH_FX = {
  "OANDA:EUR_USD": "EUR/USD", "OANDA:USD_JPY": "USDJPY", "OANDA:GBP_USD": "GBPUSD", "OANDA:USD_CHF": "USDCHF",
  "OANDA:USD_CNH": "USDCNY", "OANDA:XAU_USD": "Золото", "OANDA:XAG_USD": "Серебро", "OANDA:XPT_USD": "Платина",
  "OANDA:BCO_USD": "Brent", "OANDA:WTICO_USD": "WTI", "OANDA:NATGAS_USD": "Газ", "OANDA:XCU_USD": "Медь",
};

const FREE_TTL = 30;   // seconds: how often the free quotes refresh (shared by everyone)
const OWNER_TTL = 15;  // seconds: the owner's paid quotes

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    // short paths: /api/history/AAPL/5y, /api/quote/AAPL,BTC, /api/company/AAPL/des,fa
    const m = /^\/api\/(history|quote|company)\/([^/]+)(?:\/([^/]+))?\/?$/.exec(url.pathname);
    if (m) {
      url.searchParams.set("s", decodeURIComponent(m[2]));
      if (m[3]) url.searchParams.set(m[1] === "history" ? "r" : "parts", decodeURIComponent(m[3]));
      url.pathname = "/api/" + m[1];
    }
    try {
      if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
      if (url.pathname === "/tg" && req.method === "POST") return await webhook(req, env, ctx);
      if (url.pathname === "/api/quotes") return cors(await quotesApi(req, env, url.searchParams.get("only") || ""));
      if (url.pathname === "/api/quote") return cors(await quoteApi(env, url));
      if (url.pathname === "/api/company") return cors(await companyApi(env, url));
      if (url.pathname === "/api/ipo") return cors(await ipoApi(env));
      if (url.pathname === "/api/history") return cors(await historyApi(env, url));
      if (url.pathname === "/api/corr") return cors(await corrApi(env, url));
      if (url.pathname === "/api/live") return cors(await liveApi(env));
      if (url.pathname === "/api/geo") return cors(await geoProxy(url.searchParams.get("u")));
      if (url.pathname === "/api/perf") return cors(json(await getPerf(env, (url.searchParams.get("s") || "").split(",")), 200, { "Cache-Control": "public, max-age=300" }));
      if (url.pathname === "/api/me") {
        return cors(json(await meApi(req, env, await whoIs(req, env), norm(url.searchParams.get("lang"))), 200, { "Cache-Control": "no-store" }));
      }
      if (url.pathname === "/sync/live" && req.method === "POST") return await syncLive(req, env);
      if (url.pathname === "/subs" && req.method === "GET") return await subsList(req, env);
      if (url.pathname === "/subs/remove" && req.method === "POST") return await subsRemove(req, env);
      if (url.pathname === "/") return json({ ok: true, service: "econnews-bot", version: 3 });
      return new Response("not found", { status: 404 });
    } catch (e) {
      console.log("error", e && e.stack || e);
      // 200 with the error text: the terminal keeps showing the bot's data, and the cause is visible in the browser
      return cors(json({ ok: false, error: String(e && e.message || e) }, 200));
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkAlerts(env).then((r) => console.log("alerts", JSON.stringify(r)))
      .catch((e) => console.log("alerts error", e && e.stack || e)));
    ctx.waitUntil(watchReminders(env).then((r) => r.skipped || console.log("reminders", JSON.stringify(r)))
      .catch((e) => console.log("reminders error", e && e.stack || e)));
  },
};

// ---------------------------------------------------------------------------
// Subscribers (KV key "u:<chat_id>", metadata {n: name, t: date, l: language})
// ---------------------------------------------------------------------------
async function authorized(req, env) {
  const h = req.headers.get("Authorization") || "";
  return h === "Bearer " + await syncKey(env);
}

async function allSubs(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.SUBS.list({ prefix: "u:", cursor });
    for (const k of page.keys) out.push({ id: k.name.slice(2), ...(k.metadata || {}) });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

async function subsList(req, env) {
  if (!(await authorized(req, env))) return json({ ok: false, error: "forbidden" }, 403);
  const subs = await allSubs(env);
  const langs = {};
  for (const s of subs) if (s.l && s.l !== "en") langs[s.id] = s.l;
  // the owner always gets the mailing, even without subscribing — so their language is needed too
  if (env.OWNER_ID) {
    const id = String(env.OWNER_ID).trim();
    if (!langs[id]) { const l = await getLang(env, id); if (l !== "en") langs[id] = l; }
  }
  return json({ ok: true, ids: subs.map((s) => s.id), langs });
}

async function subsRemove(req, env) {
  if (!(await authorized(req, env))) return json({ ok: false, error: "forbidden" }, 403);
  const body = await req.json().catch(() => ({}));
  const ids = (body.ids || []).map(String).filter((x) => /^-?\d+$/.test(x)).slice(0, 100);
  await Promise.all(ids.map((id) => env.SUBS.delete("u:" + id)));
  return json({ ok: true, removed: ids.length });
}

async function subscribe(env, chat, from) {
  const key = "u:" + chat.id;
  if (await env.SUBS.get(key) !== null) return false;
  const name = chat.title || [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || "";
  const meta = { n: name.slice(0, 40), t: new Date().toISOString().slice(0, 10) };
  if (chat.lang && chat.lang !== "en") meta.l = chat.lang;
  await env.SUBS.put(key, "1", { metadata: meta });
  return true;
}

// ---------------------------------------------------------------------------
// Live feed: the news bot pushes fresh stories, the terminal and the bot read them at once
// ---------------------------------------------------------------------------
async function syncLive(req, env) {
  if (!(await authorized(req, env))) return json({ ok: false, error: "forbidden" }, 403);
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.news)) return json({ ok: false, error: "bad body" }, 400);
  const data = { updated: String(body.updated || new Date().toISOString()), news: body.news.slice(0, 80),
    market: Array.isArray(body.market) ? body.market.slice(0, 60) : [] };
  await env.SUBS.put("live", JSON.stringify(data));
  return json({ ok: true, news: data.news.length });
}

async function liveApi(env) {
  const raw = await cached("live-api", 20, () => env.SUBS.get("live"));
  const d = raw ? JSON.parse(raw) : { updated: null, news: [], market: [] };
  return json({ ok: true, ...d }, 200, { "Cache-Control": "public, max-age=20" });
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------
function keyboard(env, chat, extra = true) {
  const X = L(chat.lang);
  const base = pagesUrl(env);
  const q = X.ru ? "?lang=ru" : "";
  const rows = [];
  if (base.startsWith("https://")) {
    // web_app buttons work only in private chats
    const btn = (text, url) => chat.type === "private" ? { text, web_app: { url } } : { text, url };
    rows.push([btn(X.t("btn_market"), base + q), btn(X.t("btn_terminal"), base + "terminal/" + q)]);
  }
  if (extra) {
    rows.push([{ text: X.t("btn_news"), callback_data: "news" }, { text: X.t("btn_markets"), callback_data: "markets" }]);
    rows.push([{ text: X.t("btn_calendar"), callback_data: "calendar" }, { text: X.t("btn_trades"), callback_data: "trades" }]);
    rows.push([{ text: X.t("btn_watch"), callback_data: "watch" }, { text: X.t("btn_port"), callback_data: "port" }]);
    rows.push([{ text: X.t("btn_map"), callback_data: "map" }, { text: X.t("btn_eqs"), callback_data: "eqs" }]);
  }
  return { inline_keyboard: rows };
}

const langButtons = { inline_keyboard: [[{ text: "🇬🇧 English", callback_data: "lang:en" }, { text: "🇷🇺 Русский", callback_data: "lang:ru" }]] };

async function webhook(req, env, ctx) {
  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== await hookKey(env)) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await req.json().catch(() => null);
  if (update) ctx.waitUntil(handleUpdate(update, env).catch((e) => console.log("update error", e && e.stack || e)));
  return new Response("ok");
}

const OLD_CALLBACKS = ["news", "markets", "calendar", "trades", "map"];

export async function handleUpdate(update, env) {
  if (update.callback_query) {
    const cq = update.callback_query;
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
    const raw = cq.message && cq.message.chat;
    if (!raw) return;
    const chat = { ...raw, lang: await getLang(env, raw.id) };
    if (/^lang:(en|ru)$/.test(cq.data || "")) return command("lang", [cq.data.slice(5)], cq.data.slice(5), chat, cq.from || {}, env);
    if (OLD_CALLBACKS.includes(cq.data)) return command(cq.data, [], "", chat, cq.from || {}, env);
    if (isNewCallback(cq.data)) {
      try { await newCallback(cq.data, chat, env); } catch (e) { await send(env, chat, esc(t(chat.lang, "failed_short", e.message || e))); }
    }
    return;
  }
  const msg = update.message;
  if (!msg || !msg.chat || typeof msg.text !== "string") return;
  const chat = { ...msg.chat, lang: await getLang(env, msg.chat.id) };
  const text = msg.text.trim();
  if (!text.startsWith("/")) {
    if (chat.type !== "private") return;
    // in a private chat a bare ticker works: "AAPL", "BTC", "oil", "нефть"
    if (/^[A-Za-zА-Яа-яЁё&.:/\-]{1,20}$/.test(text)) {
      try {
        const p = parseSymbol(text);
        // Latin letters only in capitals ("AAPL", not "hi"); the rest — oil, gold, BTC, SBER
        const q = p && (p.kind !== "us" || text === text.toUpperCase()) ? await getQuotes(env, [text]) : {};
        const x = Object.values(q)[0];
        if (x && x.px != null) {
          return void await newCommand(x.kind === "us" ? "des" : "q", [x.key], x.key)(env, chat);
        }
      } catch (e) { /* not a ticker — show the hint */ }
    }
    await send(env, chat, t(chat.lang, "plain_text") + t(chat.lang, "help_short"), keyboard(env, chat));
    return;
  }
  const parts = text.split(/\s+/);
  const cmd = parts[0].split("@")[0].slice(1).toLowerCase();
  const rest = text.slice(parts[0].length).trim();
  await command(cmd, parts.slice(1), rest, chat, msg.from || {}, env);
}

async function command(cmd, args, rest, chat, from, env) {
  const owner = isOwnerChat(env, chat.id);
  const X = L(chat.lang);
  if (cmd === "start") {
    const fresh = await subscribe(env, chat, from);
    const ruHint = !X.ru && /^(ru|uk|be|kk)/i.test(from.language_code || "");
    const hello = [...X.t("hello", { fresh, owner, ruHint }), X.t("help_short")]
      .filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
    await send(env, chat, hello, keyboard(env, chat));
    await command("news", [], "", chat, from, env);
    return;
  }
  if (cmd === "lang" || cmd === "language" || cmd === "язык") {
    const want = String(args[0] || "").toLowerCase();
    if (!["en", "ru", "english", "russian", "рус", "русский", "англ"].includes(want)) {
      return void await send(env, chat, X.t("lang_usage"), langButtons);
    }
    const lang = await setLang(env, chat.id, /^(ru|рус|russian)/.test(want) ? "ru" : "en");
    const c2 = { ...chat, lang };
    await send(env, c2, t(lang, "lang_set") + "\n\n" + t(lang, "help_short"), keyboard(env, c2));
    return;
  }
  if (cmd === "stop") {
    await env.SUBS.delete("u:" + chat.id);
    await send(env, chat, X.t(owner ? "stop_owner" : "stop"));
    return;
  }
  if (cmd === "help" || cmd === "commands" || cmd === "помощь") return void await send(env, chat, X.t("help"), keyboard(env, chat));
  if (cmd === "stats" && owner) {
    const subs = await allSubs(env);
    const lines = subs.slice(0, 60).map((s) => `• ${esc(s.n || X.t("no_name"))} <i>${X.t("stats_since")} ${esc(s.t || "?")}${s.l ? " · " + esc(s.l) : ""}</i>`);
    return void await send(env, chat, X.t("stats", subs.length) + "\n" + lines.join("\n"));
  }
  if (["news", "markets", "calendar", "trades"].includes(cmd)) {
    let data;
    try {
      data = await siteData(env);
    } catch (e) {
      return void await send(env, chat, X.t("no_data"));
    }
    const text = cmd === "news" ? newsText(data, X.lang) : cmd === "markets" ? marketsText(data, X.lang)
      : cmd === "calendar" ? calendarText(data, X.lang) : tradesText(data, X.lang);
    await send(env, chat, text, keyboard(env, chat, false));
    return;
  }
  const handler = newCommand(cmd, args, rest);
  if (handler) {
    try {
      await handler(env, chat);
    } catch (e) {
      console.log("command error", cmd, e && e.stack || e);
      await send(env, chat, esc(X.t("failed", e.message || e)));
    }
    return;
  }
  await send(env, chat, X.t("unknown") + X.t("help"));
}

// ---------------------------------------------------------------------------
// Replies built from data.json that the news bot publishes
// ---------------------------------------------------------------------------
function updated(data, X) {
  return data.updated ? X.t("updated", X.date(data.updated, { hour: "2-digit", minute: "2-digit" })) : "";
}

export function newsText(data, lang = "en") {
  const X = L(lang);
  const since = Date.now() - 24 * 3600e3;
  const items = (data.news || []).filter((n) => Date.parse(n.ts) >= since);
  items.sort((a, b) => (a.level === "high" ? 0 : 1) - (b.level === "high" ? 0 : 1) || Date.parse(b.ts) - Date.parse(a.ts));
  if (!items.length) return X.t("news_none") + updated(data, X);
  let total = 0;
  const blocks = items.slice(0, 8).map((n) => {
    let s = `${n.level === "high" ? "🔴" : "🟡"} <b>${esc(newsField(n, "title", X.lang))}</b>`;
    const sum = aiSum(n, X.lang);
    const lead = newsField(n, "lead", X.lang);
    if (sum) s += `\n💡 ${esc(sum)}`;
    else if (lead) s += `\n${esc(lead.length > 220 ? lead.slice(0, 219) + "…" : lead)}`;
    const tk = (n.tk || []).map((x) => "$" + x.replace("MOEX:", "")).join(" ");
    const tags = (n.tags || []).slice(0, 3).map((x) => "#" + tagName(x, X.lang)).join(" ");
    s += `\n<i>${esc((n.sources || []).map((x) => sourceName(x, X.lang)).join(", "))} · ${X.date(n.ts, { hour: "2-digit", minute: "2-digit" })}` +
      `${tk ? " · " + esc(tk) : ""}${tags ? " · " + esc(tags) : ""}</i>`;
    if (/^https?:\/\//.test(n.link || "")) s += ` · <a href="${esc(n.link)}">${X.t("read")}</a>`;
    return s;
  }).filter((b) => (total += b.length + 2) < 3800);   // Telegram's limit is 4096 characters
  return X.t("news_head") + "\n\n" + blocks.join("\n\n") + updated(data, X);
}

const MARKET_ROWS = ["S&P", "Nasdaq", "DAX", "NKY", "IMOEX", "Brent", "Золото", "EUR/USD", "USD/RUB", "CNY/RUB", "UST10", "BTC"];
const ROW_NAME = { en: { "USD/RUB": "USD/RUB (CBR)", "CNY/RUB": "CNY/RUB (CBR)", BTC: "Bitcoin" },
  ru: { "USD/RUB": "USD/RUB (ЦБ)", "CNY/RUB": "CNY/RUB (ЦБ)", BTC: "Биткоин", IMOEX: "Мосбиржа" } };

export function marketsText(data, lang = "en") {
  const X = L(lang);
  const by = {};
  for (const q of data.market || []) by[q.id] = q;
  const lines = MARKET_ROWS.filter((id) => by[id]).map((id) => {
    const q = by[id], c = q.change;
    const name = ROW_NAME[X.lang][id] || mktName(id, X.lang) || id;
    const px = q.value != null ? (q.prefix || "") + X.fmt(q.value, q.digits != null ? q.digits : 2) + (q.suffix || "") : q.price;
    return `${arrow(c)} ${esc(name)}: <b>${esc(px)}</b> ${c != null ? X.pct(c, 1) : ""}`;
  });
  if (!lines.length) return X.t("markets_none") + updated(data, X);
  return X.t("markets_head") + "\n\n" + lines.join("\n") + updated(data, X);
}

export function calendarText(data, lang = "en") {
  const X = L(lang);
  const now = Date.now(), until = now + 48 * 3600e3;
  const ev = (data.calendar || []).filter((e) => {
    const ts = Date.parse(e.ts);
    return ts >= now - 3600e3 && ts <= until;
  });
  if (!ev.length) return X.t("cal_none");
  let last = "", out = X.t("cal_head");
  for (const e of ev.slice(0, 20)) {
    const day = X.date(e.ts, { weekday: "long", day: "numeric", month: "long" });
    if (day !== last) { out += `\n\n<b>${esc(day)}</b>`; last = day; }
    const extra = [e.actual ? `${X.t("actual")} <b>${esc(e.actual)}</b>` : "", e.forecast ? `${X.t("fcst")} ${esc(e.forecast)}` : "",
      e.previous ? `${X.t("prev")} ${esc(e.previous)}` : ""].filter(Boolean).join(", ");
    const title = X.ru ? e.title_ru || e.title : e.title;
    out += `\n${e.impact === "High" ? "🔴" : "🟡"} ${X.date(e.ts, { hour: "2-digit", minute: "2-digit" })} ${e.flag || ""} ${esc(title)}`
      + (extra ? ` <i>(${extra})</i>` : "");
    if (out.length > 3800) break;
  }
  return out + "\n\n" + X.t("cal_legend");
}

function usd(v, X) {
  if (!v) return "$0";
  return X.money(v);
}

function usdRange(a, b, X) {
  const no = { en: "amount not stated", ru: "сумма не указана" }, over = { en: "over ", ru: "более " };
  if (!a) return no[X.lang];
  if (b == null) return over[X.lang] + usd(a - 1, X);
  if (a === b) return usd(a, X);
  return usd(a, X) + "–" + usd(b, X);
}

export function tradesText(data, lang = "en") {
  const X = L(lang);
  const tr = data.trades || {};
  const icon = (x) => x === "buy" ? "🟢" : x === "exchange" ? "⚪" : "🔴";
  const type = (x) => TRADE_TYPE[X.lang][x] || (X.ru ? "сделка" : "trade");
  const c = (tr.congress || []).slice(0, 6).map((x) =>
    `${icon(x.type)} <b>${esc(x.ticker)}</b> ${type(x.type)} · ${usdRange(x.amin, x.amax, X)}\n` +
    `<i>${esc(x.who)} (${esc(tradeLabel(x.where, X.lang))}) · ${X.t("trd_traded", X.dm(x.date), X.dm(x.disclosed))}</i>`);
  const i = (tr.insiders || []).slice(0, 6).map((x) =>
    `${icon(x.type)} <b>${esc(x.ticker)}</b> ${type(x.type)} ${usd(x.value, X)} — ${esc(x.company)}\n` +
    `<i>${esc(x.who)}${x.role ? ", " + esc(tradeLabel(x.role, X.lang)) : ""} · ${X.dm(x.date)}</i>`);
  if (!c.length && !i.length) return X.t("trd_none");
  let out = "";
  if (c.length) out += X.t("trd_congress") + "\n\n" + c.join("\n\n");
  if (i.length) out += (out ? "\n\n" : "") + X.t("trd_insiders") + "\n\n" + i.join("\n\n");
  return out + "\n\n" + X.t("trd_more");
}

// ---------------------------------------------------------------------------
// Who opened the terminal: the owner (password or Telegram) or anyone from Telegram
// ---------------------------------------------------------------------------
async function telegramUser(initData, env) {
  const p = new URLSearchParams(initData);
  const hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const check = [...p.entries()].map(([k, v]) => k + "=" + v).sort().join("\n");
  const secret = await hmac("WebAppData", env.TELEGRAM_BOT_TOKEN);
  if (hex(await hmac(secret, check)) !== hash) return null;
  if (Date.now() / 1000 - Number(p.get("auth_date") || 0) > 30 * 86400) return null;
  try { return JSON.parse(p.get("user") || "null"); } catch { return null; }
}

async function whoIs(req, env) {
  const pass = req.headers.get("X-Owner-Key");
  if (pass && env.TERMINAL_PASSWORD && pass === env.TERMINAL_PASSWORD && env.OWNER_ID) {
    return { id: String(env.OWNER_ID).trim(), owner: true, name: "owner" };
  }
  const init = req.headers.get("X-Tg-Init");
  if (init && env.TELEGRAM_BOT_TOKEN) {
    const u = await telegramUser(init, env);
    if (u && u.id) return { id: String(u.id), owner: isOwnerChat(env, u.id), name: [u.first_name, u.last_name].filter(Boolean).join(" ") };
  }
  return null;
}

// ---------------------------------------------------------------------------
// APIs for the terminal
// ---------------------------------------------------------------------------
async function quoteApi(env, url) {
  const syms = (url.searchParams.get("s") || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 40);
  if (!syms.length) return json({ ok: false, error: "add s=AAPL,BTC" }, 400);
  const q = await getQuotes(env, syms);
  return json({ ok: true, ts: new Date().toISOString(), quotes: q }, 200, { "Cache-Control": "no-store" });
}

async function companyApi(env, url) {
  const s = url.searchParams.get("s") || "";
  if (!s) return json({ ok: false, error: "add s=AAPL" }, 400);
  const parts = (url.searchParams.get("parts") || COMPANY_PARTS.join(",")).split(",").filter((p) => COMPANY_PARTS.includes(p));
  const c = await getCompany(env, s, parts.length ? parts : COMPANY_PARTS, norm(url.searchParams.get("lang")));
  return json(c, 200, { "Cache-Control": "public, max-age=60" });
}

async function ipoApi(env) {
  return json(await getIpos(env), 200, { "Cache-Control": "public, max-age=900" });
}

async function corrApi(env, url) {
  const syms = (url.searchParams.get("s") || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (syms.length < 2) return json({ ok: false, error: "add at least two instruments: s=S%26P,GOLD" }, 400);
  return json(await getCorr(env, syms, url.searchParams.get("r") || "1y"), 200, { "Cache-Control": "public, max-age=600" });
}

async function historyApi(env, url) {
  const s = url.searchParams.get("s") || "";
  if (!s) return json({ ok: false, error: "add s=AAPL" }, 400);
  const h = await getHistory(env, s, url.searchParams.get("r") || "1y");
  return json(h, 200, { "Cache-Control": "public, max-age=600" });
}

// ---------------------------------------------------------------------------
// Live quotes for the terminal's market screen
// ---------------------------------------------------------------------------
async function finnhub(env) {
  const out = {};
  let err = "";
  await Promise.all(STOCKS.map(async (s) => {
    try {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${encodeURIComponent(env.FINNHUB_API_KEY)}`,
        { cf: { cacheTtl: FREE_TTL - 5, cacheEverything: true } });
      if (!r.ok) throw new Error("Finnhub HTTP " + r.status);
      const x = await r.json();
      if (x && x.c) out[s] = { value: x.c, change: x.dp, base: x.pc };
    } catch (e) { err = String(e.message || e); }
  }));
  if (!Object.keys(out).length && err) throw new Error(err);
  return out;
}

// Finnhub gives currencies and commodities only through its WebSocket stream: connect for a couple of seconds,
// take the latest prices and disconnect. The key stays on the server.
let fxLast = {};

async function finnhubFx(env) {
  const resp = await fetch("https://ws.finnhub.io/?token=" + encodeURIComponent(env.FINNHUB_API_KEY), { headers: { Upgrade: "websocket" } });
  const ws = resp.webSocket;
  if (!ws) throw new Error("Finnhub stream: HTTP " + resp.status);
  ws.accept();
  const got = {};
  const want = Object.keys(FH_FX).length;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    let msgs = 0;
    const finish = () => { clearTimeout(timer); resolve(); };
    ws.addEventListener("message", (ev) => {
      if (++msgs > 300) return finish();
      if (typeof ev.data !== "string" || ev.data.indexOf('"trade"') < 0) return;
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type !== "trade") return;
      for (const x of m.data || []) {
        const id = FH_FX[x.s];
        if (id && x.p > 0) got[id] = { value: x.p, t: x.t };
      }
      if (Object.keys(got).length >= want) finish();
    });
    ws.addEventListener("close", finish);
    ws.addEventListener("error", finish);
    for (const s of Object.keys(FH_FX)) ws.send(JSON.stringify({ type: "subscribe", symbol: s }));
  });
  try { ws.close(1000, "done"); } catch {}
  // instruments without trades in these seconds (night, weekend) keep their last known price
  fxLast = { ...fxLast, ...got };
  return { ...fxLast };
}

async function eodhd(env) {
  const ids = Object.keys(EOD), codes = ids.map((i) => EOD[i]);
  const url = `https://eodhd.com/api/real-time/${codes[0]}?s=${codes.slice(1).join(",")}&api_token=${encodeURIComponent(env.EODHD_API_KEY)}&fmt=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("EODHD HTTP " + r.status);
  let arr = await r.json();
  if (!Array.isArray(arr)) arr = [arr];
  const byCode = {};
  for (const x of arr) if (x && x.code) byCode[x.code] = x;
  const out = {};
  for (const id of ids) {
    const x = byCode[EOD[id]];
    if (!x || x.close == null || x.close === "NA") continue;
    out[id] = { value: +x.close, change: x.change_p != null && x.change_p !== "NA" ? +x.change_p : null };
  }
  return out;
}

async function quotesApi(req, env, only) {
  const w = await whoIs(req, env);
  const owner = !!(w && w.owner);
  const paid = owner && !!env.EODHD_API_KEY;
  const res = { ok: true, tier: owner ? "owner" : "free", paid, refresh: paid ? OWNER_TTL : FREE_TTL,
    ts: new Date().toISOString(), stocks: {}, fx: {}, world: {}, errors: [] };
  const jobs = [];
  if (env.FINNHUB_API_KEY) {
    if (only !== "fx" && only !== "world") jobs.push(cached("fh", paid ? OWNER_TTL : FREE_TTL, () => finnhub(env))
      .then((q) => { res.stocks = q; }).catch((e) => res.errors.push(String(e.message || e))));
    if (only !== "stocks" && only !== "world") jobs.push(cached("fx", FREE_TTL, () => finnhubFx(env))
      .then((q) => { res.fx = q; }).catch((e) => res.errors.push(String(e.message || e))));
  } else res.errors.push("no Finnhub key");
  if (only !== "stocks" && only !== "fx") {
    // world indices, commodities and yields: free Yahoo data for everyone; the paid feed on top for the owner if set
    const free = worldQuotes(FREE_TTL).catch((e) => { res.errors.push(String(e.message || e)); return {}; });
    const eod = paid ? cached("eod", OWNER_TTL, () => eodhd(env)).catch((e) => { res.errors.push(String(e.message || e)); return {}; }) : Promise.resolve({});
    jobs.push(Promise.all([free, eod]).then(([a, b]) => { res.world = { ...a, ...b }; }));
  }
  await Promise.all(jobs);
  return json(res, 200, { "Cache-Control": "no-store" });
}
