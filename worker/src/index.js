// Сервер бота EconNews на Cloudflare Workers (бесплатный тариф).
//
// Что делает:
//   /tg             — вебхук Telegram: мгновенно отвечает на /start и команды, ведёт список подписчиков
//   /subs           — список подписчиков для рассылки (его берёт news_bot.py; доступ по ключу)
//   /subs/remove    — убрать подписчиков, которые заблокировали бота
//   /api/quotes     — котировки для терминала. Ключи API хранятся только здесь, в браузер не попадают:
//                     всем — бесплатный ключ Finnhub (акции США, валюты, металлы, нефть),
//                     владельцу — ещё и платный EODHD
//
// Секреты (задаются автоматически из секретов GitHub, см. README):
//   TELEGRAM_BOT_TOKEN, OWNER_ID, FINNHUB_API_KEY, EODHD_API_KEY, TERMINAL_PASSWORD (необязательно)
// Переменная: PAGES_URL — адрес сайта бота (там лежит data.json с новостями, рынками, календарём).
// Хранилище KV: SUBS — подписчики.

const TG_API = "https://api.telegram.org/bot";

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
    try {
      if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
      if (url.pathname === "/tg" && req.method === "POST") return await webhook(req, env, ctx);
      if (url.pathname === "/api/quotes") return cors(await quotesApi(req, env, url.searchParams.get("only") || ""));
      if (url.pathname === "/subs" && req.method === "GET") return await subsList(req, env);
      if (url.pathname === "/subs/remove" && req.method === "POST") return await subsRemove(req, env);
      if (url.pathname === "/") return json({ ok: true, service: "econnews-bot" });
      return new Response("not found", { status: 404 });
    } catch (e) {
      console.log("error", e && e.stack || e);
      // 200 с описанием ошибки: терминал покажет данные бота, а причину видно по адресу в браузере
      return cors(json({ ok: false, error: String(e && e.message || e) }, 200));
    }
  },
};

// ---------------------------------------------------------------------------
// Утилиты
// ---------------------------------------------------------------------------
const enc = new TextEncoder();

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function cors(res) {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Headers", "X-Tg-Init, X-Owner-Key");
  h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  h.set("Access-Control-Max-Age", "86400");
  return new Response(res.body, { status: res.status, headers: h });
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256hex(s) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}

// Ключи выводятся из токена бота, поэтому отдельные секреты для них не нужны.
// Те же формулы — в news_bot.py и worker/deploy.py.
const syncKey = (env) => sha256hex("econnews-sync:" + env.TELEGRAM_BOT_TOKEN);
const hookKey = async (env) => (await sha256hex("econnews-hook:" + env.TELEGRAM_BOT_TOKEN)).slice(0, 48);

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pagesUrl(env) {
  return (env.PAGES_URL || "").replace(/\/*$/, "/");
}

function msk(iso, opts) {
  return new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", ...opts });
}

function isOwnerChat(env, id) {
  return env.OWNER_ID && String(id) === String(env.OWNER_ID).trim();
}

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
// Telegram
// ---------------------------------------------------------------------------
async function tg(env, method, body) {
  const r = await fetch(TG_API + env.TELEGRAM_BOT_TOKEN + "/" + method, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return r.json().catch(() => ({ ok: false }));
}

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
  }
  return { inline_keyboard: rows };
}

async function send(env, chat, text, markup) {
  const body = { chat_id: chat.id, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (markup) body.reply_markup = markup;
  let r = await tg(env, "sendMessage", body);
  if (!r.ok && markup && /button|web_app|markup/i.test(r.description || "")) {
    delete body.reply_markup;   // на всякий случай: без кнопок, но сообщение дойдёт
    r = await tg(env, "sendMessage", body);
  }
  return r;
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
  "/stop — отписаться",
].join("\n");

async function handleUpdate(update, env) {
  if (update.callback_query) {
    const cq = update.callback_query;
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
    const chat = cq.message && cq.message.chat;
    if (chat && ["news", "markets", "calendar", "trades"].includes(cq.data)) await command(cq.data, chat, cq.from || {}, env);
    return;
  }
  const msg = update.message;
  if (!msg || !msg.chat || typeof msg.text !== "string") return;
  const text = msg.text.trim();
  if (!text.startsWith("/")) {
    if (msg.chat.type === "private") await send(env, msg.chat, "Я присылаю экономические новости сам. Команды:\n" + HELP, keyboard(env, "private"));
    return;
  }
  const cmd = text.split(/\s+/)[0].split("@")[0].slice(1).toLowerCase();
  await command(cmd, msg.chat, msg.from || {}, env);
}

async function command(cmd, chat, from, env) {
  const owner = isOwnerChat(env, chat.id);
  if (cmd === "start") {
    const fresh = await subscribe(env, chat, from);
    const hello = [
      "👋 <b>Экономические новости</b>",
      "Важное из мировой экономики и с рынков — на русском: ставки центробанков, инфляция, нефть, валюты, крупные сделки политиков США и руководителей компаний.",
      "",
      "• новости — по мере появления (проверка каждые ~10 минут)",
      "• 9:00 МСК — главное за ночь, 21:00 — итоги дня",
      "• за час до важных данных — напоминание",
      "",
      fresh ? "✅ Вы подписаны." : "✅ Вы уже подписаны.",
      owner ? "👑 Вы владелец бота: в терминале, открытом кнопкой ниже, включены платные данные." : "",
      "",
      HELP,
    ].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
    await send(env, chat, hello, keyboard(env, chat.type));
    await command("news", chat, from, env);
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
  if (cmd === "help") return void await send(env, chat, HELP, keyboard(env, chat.type));
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
  await send(env, chat, "Не знаю такой команды. Вот что я умею:\n" + HELP);
}

// ---------------------------------------------------------------------------
// Ответы на команды — из data.json, который публикует основной бот
// ---------------------------------------------------------------------------
let dataCache = { at: 0, data: null };

async function siteData(env) {
  if (dataCache.data && Date.now() - dataCache.at < 60000) return dataCache.data;
  const r = await fetch(pagesUrl(env) + "data.json", { cf: { cacheTtl: 60, cacheEverything: true } });
  if (!r.ok) throw new Error("data.json: HTTP " + r.status);
  const data = await r.json();
  dataCache = { at: Date.now(), data };
  return data;
}

function updated(data) {
  return data.updated ? `\n<i>обновлено ${msk(data.updated, { hour: "2-digit", minute: "2-digit" })} МСК</i>` : "";
}

function newsText(data) {
  const since = Date.now() - 24 * 3600e3;
  const items = (data.news || []).filter((n) => Date.parse(n.ts) >= since);
  items.sort((a, b) => (a.level === "high" ? 0 : 1) - (b.level === "high" ? 0 : 1) || Date.parse(b.ts) - Date.parse(a.ts));
  if (!items.length) return "За последние сутки значимых новостей не было." + updated(data);
  let total = 0;
  const blocks = items.slice(0, 8).map((n) => {
    let s = `${n.level === "high" ? "🔴" : "🟡"} <b>${esc(n.title)}</b>`;
    if (n.lead) s += `\n${esc(n.lead.length > 220 ? n.lead.slice(0, 219) + "…" : n.lead)}`;
    s += `\n<i>${esc((n.sources || []).join(", "))} · ${msk(n.ts, { hour: "2-digit", minute: "2-digit" })}</i>`;
    if (/^https?:\/\//.test(n.link || "")) s += ` · <a href="${esc(n.link)}">читать →</a>`;
    return s;
  }).filter((b) => (total += b.length + 2) < 3800);   // лимит Telegram — 4096 символов
  return "📰 <b>Главное за сутки</b>\n\n" + blocks.join("\n\n") + updated(data);
}

const MARKET_ROWS = [["S&P", "S&P 500"], ["Nasdaq", "Nasdaq"], ["DAX", "DAX"], ["NKY", "Nikkei"], ["IMOEX", "Мосбиржа"],
  ["Brent", "Нефть Brent"], ["Золото", "Золото"], ["EUR/USD", "EUR/USD"], ["USD/RUB", "USD/RUB (ЦБ)"],
  ["CNY/RUB", "CNY/RUB (ЦБ)"], ["UST10", "UST 10 лет"], ["BTC", "Биткоин"]];

function marketsText(data) {
  const by = {};
  for (const q of data.market || []) by[q.id] = q;
  const lines = MARKET_ROWS.filter(([id]) => by[id]).map(([id, name]) => {
    const q = by[id], c = q.change;
    const icon = c == null ? "⚪" : c > 0.005 ? "🟢" : c < -0.005 ? "🔴" : "⚪";
    return `${icon} ${esc(name)}: <b>${esc(q.price)}</b> ${esc(q.change_txt || "")}`;
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
  return out + "\n\n🔴 — важное, 🟡 — среднее";
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
// Котировки для терминала
// ---------------------------------------------------------------------------
// Проверка, что терминал открыт владельцем: из кнопки бота (подпись Telegram) или по паролю
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

async function isOwner(req, env) {
  const pass = req.headers.get("X-Owner-Key");
  if (pass && env.TERMINAL_PASSWORD && pass === env.TERMINAL_PASSWORD) return true;
  const init = req.headers.get("X-Tg-Init");
  if (init && env.OWNER_ID && env.TELEGRAM_BOT_TOKEN) {
    const u = await telegramUser(init, env);
    return !!u && isOwnerChat(env, u.id);
  }
  return false;
}

const memo = {};   // кэш в памяти сервера: один запрос к API на всех зрителей

async function cached(key, ttl, load) {
  const m = memo[key];
  if (m && Date.now() - m.at < ttl * 1000) return m.value;
  if (m && m.pending) return m.pending;
  const pending = load().then((value) => { memo[key] = { at: Date.now(), value }; return value; })
    .catch((e) => { delete memo[key]; throw e; });
  memo[key] = { ...(m || {}), pending };
  return pending;
}

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
