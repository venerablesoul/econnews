// Сервер бота EconNews на Cloudflare Workers (бесплатный тариф).
//
// Что делает:
//   /tg             — вебхук Telegram: мгновенно отвечает на /start и команды, ведёт список подписчиков
//   /subs           — список подписчиков для рассылки (его берёт news_bot.py; доступ по ключу)
//   /subs/remove    — убрать подписчиков, которые заблокировали бота
//   /sync/live      — основной бот присылает сюда свежие новости каждые 5 минут (доступ по ключу)
//   /api/quotes     — котировки для терминала. Ключи API хранятся только здесь, в браузер не попадают:
//                     всем — бесплатный ключ Finnhub (акции США, валюты, металлы, нефть),
//                     владельцу — ещё и платный EODHD
//   /api/quote      — котировки любых инструментов: ?s=AAPL,BTC,SBER,нефть
//   /api/company    — компания: ?s=AAPL&parts=des,fa,ern,anr,cn,hds
//   /api/history    — история цен: ?s=AAPL&r=1y (1m 3m 6m ytd 1y 2y 5y)
//   /api/live       — свежие новости и котировки от основного бота
//   /api/me         — список, портфель и алерты (вход через Telegram или пароль владельца)
//   cron            — раз в 2 минуты проверяет алерты и присылает сообщения
//
// Секреты (задаются автоматически из секретов GitHub, см. README):
//   TELEGRAM_BOT_TOKEN, OWNER_ID, FINNHUB_API_KEY, EODHD_API_KEY, TERMINAL_PASSWORD (необязательно)
// Переменная: PAGES_URL — адрес сайта бота (там лежат data.json, stocks.json, rates.json, fin/).
// Хранилище KV: SUBS — подписчики, личные данные, алерты, живая лента.
import {
  arrow, cached, cors, esc, hex, hmac, hookKey, isOwnerChat, json, msk, pagesUrl, pct, send, siteData, syncKey, tg,
} from "./lib.js";
import { COMPANY_PARTS, getCompany, getHistory, getQuotes, parseSymbol } from "./market.js";
import { HELP_FULL, isNewCallback, newCallback, newCommand } from "./botcmd.js";
import { checkAlerts, meApi } from "./user.js";

// акции и ETF США — бесплатный ключ Finnhub, для всех
const STOCKS = ["SPY", "QQQ", "DIA", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA"];

// мировые рынки — платный ключ EODHD, только владельцу (id как в терминале)
const EOD = {
  "S&P": "GSPC.INDX", "Nasdaq": "IXIC.INDX", "DJI": "DJI.INDX", "RTY": "RUT.INDX", "VIX": "VIX.INDX",
  "SX5E": "STOXX50E.INDX", "DAX": "GDAXI.INDX", "UKX": "FTSE.INDX", "CAC": "FCHI.INDX", "NKY": "N225.INDX",
  "HSI": "HSI.INDX", "SHCOMP": "SSEC.INDX", "SENSEX": "BSESN.INDX", "EUR/USD": "EURUSD.FOREX",
  "USDJPY": "USDJPY.FOREX", "GBPUSD": "GBPUSD.FOREX", "USDCNY": "USDCNY.FOREX", "USDCHF": "USDCHF.FOREX",
  "USD/RUB": "USDRUB.FOREX", "CNY/RUB": "CNYRUB.FOREX", "Золото": "XAUUSD.FOREX", "Серебро": "XAGUSD.FOREX",
  "Платина": "XPTUSD.FOREX", "UST3M": "US3M.GBOND", "UST5": "US5Y.GBOND", "UST10": "US10Y.GBOND", "UST30": "US30Y.GBOND",
};

// валюты, металлы, нефть и газ — поток Finnhub (OANDA), бесплатный ключ, для всех
const FH_FX = {
  "OANDA:EUR_USD": "EUR/USD", "OANDA:USD_JPY": "USDJPY", "OANDA:GBP_USD": "GBPUSD", "OANDA:USD_CHF": "USDCHF",
  "OANDA:USD_CNH": "USDCNY", "OANDA:XAU_USD": "Золото", "OANDA:XAG_USD": "Серебро", "OANDA:XPT_USD": "Платина",
  "OANDA:BCO_USD": "Brent", "OANDA:WTICO_USD": "WTI", "OANDA:NATGAS_USD": "Газ", "OANDA:XCU_USD": "Медь",
};

const FREE_TTL = 30;   // секунд: как часто обновляются бесплатные котировки (общие для всех)
const OWNER_TTL = 15;  // секунд: платные котировки владельца

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    // короткие адреса: /api/history/AAPL/5y, /api/quote/AAPL,BTC, /api/company/AAPL/des,fa
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
      if (url.pathname === "/api/history") return cors(await historyApi(env, url));
      if (url.pathname === "/api/live") return cors(await liveApi(env));
      if (url.pathname === "/api/me") return cors(json(await meApi(req, env, await whoIs(req, env)), 200, { "Cache-Control": "no-store" }));
      if (url.pathname === "/sync/live" && req.method === "POST") return await syncLive(req, env);
      if (url.pathname === "/subs" && req.method === "GET") return await subsList(req, env);
      if (url.pathname === "/subs/remove" && req.method === "POST") return await subsRemove(req, env);
      if (url.pathname === "/") return json({ ok: true, service: "econnews-bot", version: 2 });
      return new Response("not found", { status: 404 });
    } catch (e) {
      console.log("error", e && e.stack || e);
      // 200 с описанием ошибки: терминал покажет данные бота, а причину видно по адресу в браузере
      return cors(json({ ok: false, error: String(e && e.message || e) }, 200));
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkAlerts(env).then((r) => console.log("alerts", JSON.stringify(r)))
      .catch((e) => console.log("alerts error", e && e.stack || e)));
  },
};

// ---------------------------------------------------------------------------
// Подписчики (KV: ключ "u:<chat_id>")
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
  return json({ ok: true, ids: subs.map((s) => s.id) });
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
  await env.SUBS.put(key, "1", { metadata: meta });
  return true;
}

// ---------------------------------------------------------------------------
// Живая лента: основной бот присылает свежие новости, терминал и бот читают их сразу
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
function keyboard(env, chatType, extra = true) {
  const base = pagesUrl(env);
  const rows = [];
  if (base.startsWith("https://")) {
    // кнопки-приложения (web_app) работают только в личных чатах
    const btn = (text, url) => chatType === "private" ? { text, web_app: { url } } : { text, url };
    rows.push([btn("📈 Рынок онлайн", base), btn("🖥 Терминал", base + "terminal/")]);
  }
  if (extra) {
    rows.push([{ text: "📰 Новости", callback_data: "news" }, { text: "📊 Рынки", callback_data: "markets" }]);
    rows.push([{ text: "📅 Календарь", callback_data: "calendar" }, { text: "🏛 Сделки", callback_data: "trades" }]);
    rows.push([{ text: "⭐ Мой список", callback_data: "watch" }, { text: "💼 Портфель", callback_data: "port" }]);
    rows.push([{ text: "🗺 Карта рынка", callback_data: "map" }, { text: "🔎 Скринер", callback_data: "eqs" }]);
  }
  return { inline_keyboard: rows };
}

async function webhook(req, env, ctx) {
  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== await hookKey(env)) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await req.json().catch(() => null);
  if (update) ctx.waitUntil(handleUpdate(update, env).catch((e) => console.log("update error", e && e.stack || e)));
  return new Response("ok");
}

const HELP = [
  "/news — последние важные новости",
  "/markets — рынки сейчас",
  "/calendar — календарь событий",
  "/trades — сделки политиков США и инсайдеров",
  "/q AAPL BTC — котировки · /des AAPL — компания",
  "/watch · /port · /alert — список, портфель, алерты",
  "/help — все команды",
  "/stop — отписаться",
].join("\n");

const OLD_CALLBACKS = ["news", "markets", "calendar", "trades", "map"];

export async function handleUpdate(update, env) {
  if (update.callback_query) {
    const cq = update.callback_query;
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
    const chat = cq.message && cq.message.chat;
    if (!chat) return;
    if (OLD_CALLBACKS.includes(cq.data)) return command(cq.data, [], "", chat, cq.from || {}, env);
    if (isNewCallback(cq.data)) {
      try { await newCallback(cq.data, chat, env); } catch (e) { await send(env, chat, "Не получилось: " + esc(e.message || e)); }
    }
    return;
  }
  const msg = update.message;
  if (!msg || !msg.chat || typeof msg.text !== "string") return;
  const text = msg.text.trim();
  if (!text.startsWith("/")) {
    if (msg.chat.type !== "private") return;
    // в личке можно просто написать тикер: «AAPL», «BTC», «нефть»
    if (/^[A-Za-zА-Яа-яЁё&.:/\-]{1,20}$/.test(text)) {
      try {
        const p = parseSymbol(text);
        // латиница — только заглавными («AAPL», а не «hi»), остальное — нефть, золото, BTC, SBER
        const q = p && (p.kind !== "us" || text === text.toUpperCase()) ? await getQuotes(env, [text]) : {};
        const x = Object.values(q)[0];
        if (x && x.px != null) {
          return void await newCommand(x.kind === "us" ? "des" : "q", [x.key], x.key)(env, msg.chat);
        }
      } catch (e) { /* не тикер — покажем подсказку */ }
    }
    await send(env, msg.chat, "Я присылаю экономические новости сам. Команды:\n" + HELP, keyboard(env, "private"));
    return;
  }
  const parts = text.split(/\s+/);
  const cmd = parts[0].split("@")[0].slice(1).toLowerCase();
  const rest = text.slice(parts[0].length).trim();
  await command(cmd, parts.slice(1), rest, msg.chat, msg.from || {}, env);
}

async function command(cmd, args, rest, chat, from, env) {
  const owner = isOwnerChat(env, chat.id);
  if (cmd === "start") {
    const fresh = await subscribe(env, chat, from);
    const hello = [
      "👋 <b>Экономические новости</b>",
      "Важное из мировой экономики и с рынков — на русском: ставки центробанков, инфляция, нефть, валюты, крупные сделки политиков США и руководителей компаний.",
      "",
      "• новости — по мере появления (проверка каждые ~5 минут)",
      "• 9:00 МСК — главное за ночь, 21:00 — итоги дня",
      "• за час до важных данных — напоминание",
      "• котировки, компании, свой список, портфель и алерты — прямо здесь",
      "",
      fresh ? "✅ Вы подписаны." : "✅ Вы уже подписаны.",
      owner ? "👑 Вы владелец бота: в терминале, открытом кнопкой ниже, включены платные данные." : "",
      "",
      HELP,
    ].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
    await send(env, chat, hello, keyboard(env, chat.type));
    await command("news", [], "", chat, from, env);
    return;
  }
  if (cmd === "stop") {
    await env.SUBS.delete("u:" + chat.id);
    const t = owner
      ? "Вы отписались от рассылки сервера. Но вы владелец: основная рассылка приходит вам всегда. Выключить её можно в GitHub → Actions → Economic news → Disable workflow."
      : "Вы отписались. Чтобы снова получать новости — /start";
    await send(env, chat, t);
    return;
  }
  if (cmd === "help" || cmd === "commands" || cmd === "помощь") return void await send(env, chat, HELP_FULL, keyboard(env, chat.type));
  if (cmd === "stats" && owner) {
    const subs = await allSubs(env);
    const lines = subs.slice(0, 60).map((s) => `• ${esc(s.n || "без имени")} <i>с ${esc(s.t || "?")}</i>`);
    return void await send(env, chat, `👥 <b>Подписчиков: ${subs.length}</b>\n` + lines.join("\n"));
  }
  if (["news", "markets", "calendar", "trades"].includes(cmd)) {
    let data;
    try {
      data = await siteData(env);
    } catch (e) {
      return void await send(env, chat, "Не удалось получить свежие данные, попробуйте через минуту.");
    }
    const text = cmd === "news" ? newsText(data) : cmd === "markets" ? marketsText(data)
      : cmd === "calendar" ? calendarText(data) : tradesText(data);
    await send(env, chat, text, keyboard(env, chat.type, false));
    return;
  }
  const handler = newCommand(cmd, args, rest);
  if (handler) {
    try {
      await handler(env, chat);
    } catch (e) {
      console.log("command error", cmd, e && e.stack || e);
      await send(env, chat, "Не получилось: " + esc(e.message || e) + "\nПроверьте тикер или попробуйте через минуту.");
    }
    return;
  }
  await send(env, chat, "Не знаю такой команды. Вот что я умею:\n\n" + HELP_FULL);
}

// ---------------------------------------------------------------------------
// Ответы на команды — из data.json, который публикует основной бот
// ---------------------------------------------------------------------------
function updated(data) {
  return data.updated ? `\n<i>обновлено ${msk(data.updated, { hour: "2-digit", minute: "2-digit" })} МСК</i>` : "";
}

export function newsText(data) {
  const since = Date.now() - 24 * 3600e3;
  const items = (data.news || []).filter((n) => Date.parse(n.ts) >= since);
  items.sort((a, b) => (a.level === "high" ? 0 : 1) - (b.level === "high" ? 0 : 1) || Date.parse(b.ts) - Date.parse(a.ts));
  if (!items.length) return "За последние сутки значимых новостей не было." + updated(data);
  let total = 0;
  const blocks = items.slice(0, 8).map((n) => {
    let s = `${n.level === "high" ? "🔴" : "🟡"} <b>${esc(n.title)}</b>`;
    if (n.ai && n.ai.sum) s += `\n💡 ${esc(n.ai.sum)}`;
    else if (n.lead) s += `\n${esc(n.lead.length > 220 ? n.lead.slice(0, 219) + "…" : n.lead)}`;
    const tk = (n.tk || []).map((t) => "$" + t.replace("MOEX:", "")).join(" ");
    s += `\n<i>${esc((n.sources || []).join(", "))} · ${msk(n.ts, { hour: "2-digit", minute: "2-digit" })}${tk ? " · " + esc(tk) : ""}</i>`;
    if (/^https?:\/\//.test(n.link || "")) s += ` · <a href="${esc(n.link)}">читать →</a>`;
    return s;
  }).filter((b) => (total += b.length + 2) < 3800);   // лимит Telegram — 4096 символов
  return "📰 <b>Главное за сутки</b>\n\n" + blocks.join("\n\n") + updated(data);
}

const MARKET_ROWS = [["S&P", "S&P 500"], ["Nasdaq", "Nasdaq"], ["DAX", "DAX"], ["NKY", "Nikkei"], ["IMOEX", "Мосбиржа"],
  ["Brent", "Нефть Brent"], ["Золото", "Золото"], ["EUR/USD", "EUR/USD"], ["USD/RUB", "USD/RUB (ЦБ)"],
  ["CNY/RUB", "CNY/RUB (ЦБ)"], ["UST10", "UST 10 лет"], ["BTC", "Биткоин"]];

export function marketsText(data) {
  const by = {};
  for (const q of data.market || []) by[q.id] = q;
  const lines = MARKET_ROWS.filter(([id]) => by[id]).map(([id, name]) => {
    const q = by[id], c = q.change;
    return `${arrow(c)} ${esc(name)}: <b>${esc(q.price)}</b> ${esc(q.change_txt || "")}`;
  });
  if (!lines.length) return "Котировки пока недоступны." + updated(data);
  return "📊 <b>Рынки</b> <i>(изменение за день)</i>\n\n" + lines.join("\n") + updated(data);
}

function calendarText(data) {
  const now = Date.now(), until = now + 48 * 3600e3;
  const ev = (data.calendar || []).filter((e) => {
    const t = Date.parse(e.ts);
    return t >= now - 3600e3 && t <= until;
  });
  if (!ev.length) return "📅 В ближайшие двое суток важных событий нет.";
  let last = "", out = "📅 <b>Календарь (МСК)</b>";
  for (const e of ev.slice(0, 20)) {
    const day = msk(e.ts, { weekday: "long", day: "numeric", month: "long" });
    if (day !== last) { out += `\n\n<b>${esc(day)}</b>`; last = day; }
    const extra = [e.actual ? `факт <b>${esc(e.actual)}</b>` : "", e.forecast ? `прогноз ${esc(e.forecast)}` : "",
      e.previous ? `пред. ${esc(e.previous)}` : ""].filter(Boolean).join(", ");
    out += `\n${e.impact === "High" ? "🔴" : "🟡"} ${msk(e.ts, { hour: "2-digit", minute: "2-digit" })} ${e.flag || ""} ${esc(e.title_ru || e.title)}`
      + (extra ? ` <i>(${extra})</i>` : "");
    if (out.length > 3800) break;
  }
  return out + "\n\n🔴 — важное, 🟡 — среднее\nОтчёты компаний: /earnings";
}

const TYPE_RU = { buy: "покупка", sell: "продажа", sell_part: "частичная продажа", exchange: "обмен" };

function num1(x) {
  return String(Math.round(x * 10) / 10).replace(".", ",");
}

function usd(v) {
  if (v >= 1e9) return "$" + num1(v / 1e9) + " млрд";
  if (v >= 1e6) return "$" + num1(v / 1e6) + " млн";
  if (v >= 1e3) return "$" + Math.round(v / 1e3) + " тыс.";
  return "$" + Math.round(v || 0);
}

function usdRange(a, b) {
  if (!a) return "сумма не указана";
  if (b == null) return "более " + usd(a - 1);
  if (a === b) return usd(a);
  const u = b >= 1e6 ? 1e6 : 1e3;
  return "$" + num1(a / u) + "–" + num1(b / u) + (b >= 1e6 ? " млн" : " тыс.");
}

function dm(d) {
  return d && d.length >= 10 ? d.slice(8, 10) + "." + d.slice(5, 7) : "?";
}

function tradesText(data) {
  const tr = data.trades || {};
  const icon = (t) => t === "buy" ? "🟢" : t === "exchange" ? "⚪" : "🔴";
  const c = (tr.congress || []).slice(0, 6).map((t) =>
    `${icon(t.type)} <b>${esc(t.ticker)}</b> ${TYPE_RU[t.type] || "сделка"} · ${usdRange(t.amin, t.amax)}\n` +
    `<i>${esc(t.who)} (${esc(t.where)}) · сделка ${dm(t.date)}, раскрыта ${dm(t.disclosed)}</i>`);
  const i = (tr.insiders || []).slice(0, 6).map((t) =>
    `${icon(t.type)} <b>${esc(t.ticker)}</b> ${TYPE_RU[t.type] || "сделка"} ${usd(t.value)} — ${esc(t.company)}\n` +
    `<i>${esc(t.who)}${t.role ? ", " + esc(t.role) : ""} · ${dm(t.date)}</i>`);
  if (!c.length && !i.length) return "Данные о сделках ещё собираются — загляните позже.";
  let out = "";
  if (c.length) out += "🏛 <b>Сделки политиков США</b>\n<i>раскрываются с опозданием до 45 дней</i>\n\n" + c.join("\n\n");
  if (i.length) out += (out ? "\n\n" : "") + "💼 <b>Сделки инсайдеров</b>\n\n" + i.join("\n\n");
  return out + "\n\nВсе сделки — в терминале (команда СДЕЛКИ).";
}

// ---------------------------------------------------------------------------
// Кто открыл терминал: владелец (пароль или Telegram) или любой человек из Telegram
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
    return { id: String(env.OWNER_ID).trim(), owner: true, name: "владелец" };
  }
  const init = req.headers.get("X-Tg-Init");
  if (init && env.TELEGRAM_BOT_TOKEN) {
    const u = await telegramUser(init, env);
    if (u && u.id) return { id: String(u.id), owner: isOwnerChat(env, u.id), name: [u.first_name, u.last_name].filter(Boolean).join(" ") };
  }
  return null;
}

async function isOwner(req, env) {
  const w = await whoIs(req, env);
  return !!(w && w.owner);
}

// ---------------------------------------------------------------------------
// Новые API для терминала
// ---------------------------------------------------------------------------
async function quoteApi(env, url) {
  const syms = (url.searchParams.get("s") || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 40);
  if (!syms.length) return json({ ok: false, error: "укажите s=AAPL,BTC" }, 400);
  const q = await getQuotes(env, syms);
  return json({ ok: true, ts: new Date().toISOString(), quotes: q }, 200, { "Cache-Control": "no-store" });
}

async function companyApi(env, url) {
  const s = url.searchParams.get("s") || "";
  if (!s) return json({ ok: false, error: "укажите s=AAPL" }, 400);
  const parts = (url.searchParams.get("parts") || COMPANY_PARTS.join(",")).split(",").filter((p) => COMPANY_PARTS.includes(p));
  const c = await getCompany(env, s, parts.length ? parts : COMPANY_PARTS);
  return json(c, 200, { "Cache-Control": "public, max-age=60" });
}

async function historyApi(env, url) {
  const s = url.searchParams.get("s") || "";
  if (!s) return json({ ok: false, error: "укажите s=AAPL" }, 400);
  const h = await getHistory(env, s, url.searchParams.get("r") || "1y");
  return json(h, 200, { "Cache-Control": "public, max-age=600" });
}

// ---------------------------------------------------------------------------
// Котировки для терминала (как раньше)
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

// Поток сделок Finnhub отдаёт валюты и сырьё только через WebSocket: подключаемся на пару секунд,
// забираем последние цены и отключаемся. Ключ остаётся на сервере.
let fxLast = {};

async function finnhubFx(env) {
  const resp = await fetch("https://ws.finnhub.io/?token=" + encodeURIComponent(env.FINNHUB_API_KEY), { headers: { Upgrade: "websocket" } });
  const ws = resp.webSocket;
  if (!ws) throw new Error("Finnhub поток: HTTP " + resp.status);
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
  // по инструментам без сделок за эти секунды (ночь, выходные) — последняя известная цена
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
  const owner = await isOwner(req, env);
  const res = { ok: true, tier: owner ? "owner" : "free", refresh: owner ? OWNER_TTL : FREE_TTL,
    ts: new Date().toISOString(), stocks: {}, fx: {}, world: {}, errors: [] };
  const jobs = [];
  if (env.FINNHUB_API_KEY) {
    if (only !== "fx") jobs.push(cached("fh", owner ? OWNER_TTL : FREE_TTL, () => finnhub(env))
      .then((q) => { res.stocks = q; }).catch((e) => res.errors.push(String(e.message || e))));
    if (only !== "stocks") jobs.push(cached("fx", FREE_TTL, () => finnhubFx(env))
      .then((q) => { res.fx = q; }).catch((e) => res.errors.push(String(e.message || e))));
  } else res.errors.push("нет ключа Finnhub");
  if (owner) {
    if (env.EODHD_API_KEY) {
      jobs.push(cached("eod", OWNER_TTL, () => eodhd(env))
        .then((q) => { res.world = q; }).catch((e) => res.errors.push(String(e.message || e))));
    } else res.errors.push("нет ключа EODHD");
  }
  await Promise.all(jobs);
  return json(res, 200, { "Cache-Control": "no-store" });
}
