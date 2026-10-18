// Tests of the bot server (worker/src) without network: fetch and the KV storage are faked.
// Run: node tests/worker.test.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { PAGES, TOKEN, OWNER, sent, flags, dataJson, stocksJson, KV, installMocks, iso, calls } from "./mocks.mjs";
installMocks();
const env = { TELEGRAM_BOT_TOKEN: TOKEN, OWNER_ID: OWNER, FINNHUB_API_KEY: "FHKEY", TERMINAL_PASSWORD: "pw", PAGES_URL: PAGES, SUBS: new KV() };
const ctx = { waits: [], waitUntil(p) { this.waits.push(p); } };

const worker = (await import("../worker/src/index.js")).default;
const { handleUpdate, newsText, marketsText } = await import("../worker/src/index.js");
const { parseSymbol } = await import("../worker/src/market.js");
const { parseAlert, cleanPort } = await import("../worker/src/user.js");
const { clearMemo, fmt, money, pct } = await import("../worker/src/lib.js");
const { t, newsField, sectorName, tradeLabel } = await import("../worker/src/i18n.js");

let passed = 0;
async function test(name, fn) {
  try {
    clearMemo();
    await fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    console.log("  FAIL " + name);
    console.log(e && e.stack || e);
    process.exitCode = 1;
  }
}

const api = async (path, headers = {}, method = "GET", body) => {
  const r = await worker.fetch(new Request("https://w.test" + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  return { status: r.status, json: await r.json(), headers: r.headers };
};
let uid = 1000;
const msg = async (text, chatId = 555, type = "private", from = {}) => {
  const start = sent.length;
  await handleUpdate({ update_id: ++uid, message: { message_id: uid, chat: { id: chatId, type }, from: { id: chatId, first_name: "Test", ...from }, text } }, env);
  return sent.slice(start);
};
const cb = async (data, chatId = 555) => {
  const start = sent.length;
  await handleUpdate({ update_id: ++uid, callback_query: { id: "c" + uid, data, from: { id: chatId }, message: { chat: { id: chatId, type: "private" } } } }, env);
  return sent.slice(start).filter((m) => m.method !== "answerCallbackQuery");
};
const texts = (out) => out.map((m) => m.text || m.caption || "").join("\n----\n");
const noErrors = (out) => assert.ok(!/That didn't work|I don't know that command|Не получилось|Не знаю такой команды/.test(texts(out)), texts(out));
const buttons = (out) => out.flatMap((m) => (m.reply_markup && m.reply_markup.inline_keyboard || []).flat());
const RU = 556;   // a chat that switches to Russian

console.log("Bot server:");

await test("number formats in both languages", () => {
  assert.equal(fmt(81800.5, 0), "81,801");
  assert.equal(fmt(81800.5, 0, "ru"), "81\u202f801");
  assert.equal(fmt(-3429.6, 2), "−3,429.60");
  assert.equal(fmt(3429.6, 2, "ru"), "3\u202f429,60");
  assert.equal(pct(6.2), "+6.20%");
  assert.equal(pct(6.2, 2, "ru"), "+6,20%");
  assert.equal(money(416e9), "$416B");
  assert.equal(money(416e9, "$", "ru"), "$416 млрд");
  assert.equal(money(5.0459e12), "$5.05T");
});

await test("names: sectors, trade labels, news fields in both languages", () => {
  assert.equal(sectorName("Technology", "ru"), "Технологии");
  assert.equal(sectorName("Технологии", "en"), "Technology");
  assert.equal(tradeLabel("House, CA12", "ru"), "Палата, CA12");
  assert.equal(tradeLabel("Палата, CA12", "en"), "House, CA12");
  const [fresh, old] = dataJson.news;
  assert.equal(newsField(fresh, "title", "en"), "Fed holds rates");
  assert.equal(newsField(fresh, "title", "ru"), "ФРС сохранила ставку");
  assert.equal(newsField(old, "title", "en"), "Tesla shares plunge after recall");
  assert.equal(newsField(old, "title", "ru"), "Акции Tesla обвалились после отзыва");
  assert.equal(t("en", "need_symbol", "des"), "Add a ticker, for example: /des AAPL");
  assert.equal(t("ru", "need_symbol", "des"), "Укажите тикер, например: /des AAPL");
  assert.equal(t("xx", "rates_none"), "No data yet.", "unknown language falls back to English");
});

await test("ticker parsing", () => {
  assert.equal(parseSymbol("aapl").key, "AAPL");
  assert.equal(parseSymbol("AAPL US Equity").key, "AAPL");
  assert.equal(parseSymbol("NASDAQ:AAPL").key, "AAPL");
  assert.equal(parseSymbol("BRK-B").key, "BRK.B");
  assert.equal(parseSymbol("btc").kind, "crypto");
  assert.equal(parseSymbol("BINANCE:ETHUSDT").key, "ETH");
  assert.equal(parseSymbol("SBER").key, "MOEX:SBER");
  assert.equal(parseSymbol("MOEX:T").key, "MOEX:T");
  assert.equal(parseSymbol("T").key, "T");
  assert.equal(parseSymbol("oil").key, "Brent");
  assert.equal(parseSymbol("нефть").key, "Brent");
  assert.equal(parseSymbol("gold").key, "Золото");
  assert.equal(parseSymbol("S&P").key, "S&P");
  assert.equal(parseSymbol("привет"), null);
  assert.equal(parseSymbol(""), null);
});

await test("alert parsing (English and Russian words)", () => {
  assert.deepEqual(parseAlert("AAPL > 200"), { k: "px", s: "AAPL", op: ">", v: 200 });
  assert.deepEqual(parseAlert("BTC below 60 000"), { k: "px", s: "BTC", op: "<", v: 60000 });
  assert.deepEqual(parseAlert("BTC ниже 60 000"), { k: "px", s: "BTC", op: "<", v: 60000 });
  assert.deepEqual(parseAlert("oil 5%"), { k: "chg", s: "Brent", v: 5 });
  assert.deepEqual(parseAlert("SBER ±3,5%"), { k: "chg", s: "MOEX:SBER", v: 3.5 });
  assert.deepEqual(parseAlert("news Fed"), { k: "news", kw: "Fed" });
  assert.deepEqual(parseAlert("новости ФРС"), { k: "news", kw: "ФРС" });
  assert.deepEqual(parseAlert("AAPL 400"), { k: "px", s: "AAPL", op: "?", v: 400 });
  assert.equal(parseAlert("something unclear"), null);
});

await test("portfolio: one position per instrument with the average price", () => {
  assert.deepEqual(cleanPort([{ s: "aapl", q: 10, c: 100 }, { s: "AAPL", q: 10, c: 200 }, { s: "???", q: 1, c: 1 }, { s: "BTC", q: 0, c: 1 }]),
    [{ s: "AAPL", q: 20, c: 150 }]);
});

await test("/api/quote: US stocks, crypto, Moscow Exchange, oil", async () => {
  const r = await api("/api/quote?s=AAPL,BTC,SBER,oil,ZZZZ");
  assert.equal(r.json.ok, true);
  const q = r.json.quotes;
  assert.equal(q.AAPL.px, 342.96);
  assert.equal(q.BTC.px, 81800.5);
  assert.equal(q["MOEX:SBER"].px, 285.52);
  assert.equal(q.Brent.px, 80.1);
  assert.equal(q.Brent.name, "Brent crude");
  assert.equal(q.Brent.name_ru, "Нефть Brent");
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "*");
  assert.ok(!JSON.stringify(r.json).includes("FHKEY"), "the key must not leak into the answer");
});

await test("/api/quotes: free world quotes (Yahoo) for everyone, no paid key needed", async () => {
  const r = await api("/api/quotes");
  assert.equal(r.json.tier, "free");
  assert.equal(r.json.paid, false);
  assert.equal(r.json.world["S&P"].value, 7730);
  assert.ok(Math.abs(r.json.world["S&P"].change - 1) < 1e-9);
  assert.equal(r.json.world["Золото"].value, 4020);
  assert.equal(r.json.world.IMOEX.value, 2741.5);
  assert.ok(!r.json.errors.some((e) => /EODHD/.test(e)), "no EODHD key is not an error any more");
  clearMemo();
  flags.failSpark = true;
  try {
    const f = await api("/api/quotes?only=world");
    assert.equal(f.json.ok, true, "a Yahoo failure does not break the answer");
    assert.ok(f.json.errors.some((e) => /Yahoo/.test(e)));
  } finally { flags.failSpark = false; }
});

await test("/api/company: all parts; headlines translated only when asked", async () => {
  const r = await api("/api/company?s=AAPL");
  const c = r.json;
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(c.profile.name, "Apple Inc");
  assert.equal(c.quote.px, 342.96);
  assert.equal(c.m.pe, 38.83);
  assert.equal(c.fin.annual[0].rev, 416e9);
  assert.equal(c.faSeries.quarterly[0].eps, 2.0244);
  assert.equal(c.anr[0].sb, 12);
  assert.equal(c.next.hour, "amc");
  assert.equal(c.ern.length, 2);
  assert.equal(c.cn[0].h, "Apple beats estimates", "English by default — no translator calls");
  assert.equal(c.ins.length, 1, "only open-market buys and sells");
  assert.deepEqual(c.peers, ["NVDA", "DELL", "HPQ"]);
  assert.deepEqual(c.errors, []);
  assert.equal(c.co.targets.mean, 329.38, "the deep file docs/co/AAPL.json is included");
  assert.ok(c.opt.exp.length >= 4 && c.opt.chains[0].rows.length > 5, "the option snapshot docs/opt/AAPL.json");
  assert.deepEqual(c.rv.rows.map((r) => r.s), ["AAPL", "NVDA"], "peers that are in stocks.json");
  assert.equal(c.dvd, undefined, "dividends come from the deep file, no live request");
  clearMemo();
  const ru = await api("/api/company?s=AAPL&parts=cn&lang=ru");
  assert.equal(ru.json.cn[0].h, "Apple превзошла прогнозы");
  assert.equal(ru.json.cn[0].en, "Apple beats estimates");
});

await test("short paths /api/history/AAPL/1m and /api/quote/AAPL,BTC", async () => {
  const r = await api("/api/history/AAPL/1m");
  assert.equal(r.json.ok, true);
  assert.equal(r.json.range, "1m");
  const q = await api("/api/quote/AAPL,BTC");
  assert.equal(q.json.quotes.BTC.px, 81800.5);
});

await test("fallbacks: crypto without Binance, translation without Google", async () => {
  flags.failBinance = true; flags.failGoogle = true; flags.failYahoo = true;
  try {
    const q = await api("/api/quote?s=BTC");
    assert.equal(q.json.quotes.BTC.px, 81700);
    assert.equal(q.json.quotes.BTC.src, "cryptocompare");
    clearMemo();
    const h = await api("/api/history?s=BTC&r=6m");
    assert.equal(h.json.ok, true);
    assert.equal(h.json.src, "coinbase");
    clearMemo();
    const w = await api("/api/history?s=BTC&r=5y");
    assert.ok(w.json.c.length > 250 && w.json.c.length < 270, "five years: weekly points (" + w.json.c.length + ")");
    clearMemo();
    const c = await api("/api/company?s=AAPL&parts=cn&lang=ru");
    assert.equal(c.json.cn[0].h, "Apple превзошла оценки");
    flags.failYahoo = false;
    clearMemo();
    const y = await api("/api/history?s=BTC&r=5y");
    assert.equal(y.json.src, "yahoo", "without Binance: Yahoo first");
  } finally { flags.failBinance = false; flags.failGoogle = false; flags.failYahoo = false; }
});

await test("/api/company: a company outside the SEC list and the Moscow Exchange (EN and RU)", async () => {
  const r = await api("/api/company?s=ZZZZ&parts=des");
  assert.equal(r.json.ok, false);
  const m = await api("/api/company?s=SBER");
  assert.equal(m.json.ok, true);
  assert.equal(m.json.profile.name, "Sberbank of Russia PJSC");
  assert.equal(m.json.profile.isin, "RU0009029540");
  assert.equal(m.json.quote.px, 285.52);
  const mr = await api("/api/company?s=SBER&lang=ru");
  assert.equal(mr.json.profile.name, "Сбербанк России ПАО ао");
  const nf = await api("/api/company?s=MSFT&parts=fa");
  assert.equal(nf.json.ok, true);
  assert.equal(nf.json.fin, undefined);
  assert.ok(nf.json.faSeries);
});

await test("/api/history: stocks, crypto, Moscow Exchange, failure", async () => {
  const a = await api("/api/history?s=AAPL&r=1y");
  assert.equal(a.json.ok, true);
  assert.equal(a.json.c.length, 250);
  assert.equal(a.json.src, "yahoo");
  const b = await api("/api/history?s=BTC&r=6m");
  assert.equal(b.json.src, "binance");
  assert.ok(b.json.c.length > 100);
  const s = await api("/api/history?s=SBER&r=3m");
  assert.equal(s.json.src, "moex");
  const g = await api("/api/history?s=gold&r=1y");
  assert.equal(g.json.name, "Gold");
  assert.equal(g.json.name_ru, "Золото");
  flags.failYahoo = true;
  clearMemo();
  const f = await api("/api/history?s=MSFT&r=1y");
  flags.failYahoo = false;
  assert.equal(f.json.ok, false);
  assert.ok(/429/.test(f.json.error));
});

await test("the webhook without the secret is rejected", async () => {
  const r = await worker.fetch(new Request("https://w.test/tg", { method: "POST", body: "{}" }), env, ctx);
  assert.equal(r.status, 403);
});

await test("bot (English by default): /start, /q /des /fa /ern /anr /cn /hds", async () => {
  let out = await msg("/start", 555, "private", { language_code: "ru" });
  assert.match(texts(out), /You are subscribed/);
  assert.match(texts(out), /Русский язык: \/lang ru/, "a Russian Telegram app gets the hint");
  assert.match(texts(out), /Top stories of the day/);
  assert.match(texts(out), /Fed holds rates/);
  assert.match(texts(out), /💡 Rates stay high for longer/);
  assert.match(texts(out), /Tesla shares plunge after recall/, "old-format stories show the English original");
  assert.ok(!/Отзыв машин/.test(texts(out)), "a Russian-only AI note is not shown to English readers");
  assert.ok(buttons(out).some((b) => b.web_app && /terminal\/$/.test(b.web_app.url) && b.text === "🖥 Terminal"));
  out = await msg("/q AAPL BTC oil SBER");
  noErrors(out);
  assert.match(texts(out), /AAPL.*342\.96/);
  assert.match(texts(out), /BTC.*81,801/);
  assert.match(texts(out), /<i>Brent crude<\/i>/);
  out = await msg("/des AAPL");
  noErrors(out);
  assert.match(texts(out), /Apple Inc/);
  assert.match(texts(out), /P\/E: 38\.8/);
  assert.match(texts(out), /Analysts \(53\): <b>buy/);
  assert.match(texts(out), /Market cap: <b>\$5\.01T/);
  assert.ok(buttons(out).some((b) => b.callback_data === "fa:AAPL" && b.text === "FA financials"));
  assert.ok(buttons(out).some((b) => b.web_app && /terminal\/\?cmd=AAPL%20DES$/.test(b.web_app.url)));
  out = await msg("/fa AAPL"); noErrors(out); assert.match(texts(out), /revenue \$416B/); assert.match(texts(out), /27 Sep 2025/);
  out = await msg("/ern AAPL"); noErrors(out); assert.match(texts(out), /Next:/); assert.match(texts(out), /❌ Q3 2026/);
  out = await msg("/anr AAPL"); noErrors(out); assert.match(texts(out), /Consensus: <b>buy/); assert.match(texts(out), /Strong buy +12/);
  out = await msg("/cn AAPL"); noErrors(out); assert.match(texts(out), /Apple beats estimates/);
  out = await msg("/hds AAPL"); noErrors(out); assert.match(texts(out), /Cook Tim/); assert.match(texts(out), /🔴 sale 2,399 shares at \$332\.01/);
  out = await msg("/des SBER"); noErrors(out); assert.match(texts(out), /Sberbank of Russia PJSC/); assert.match(texts(out), /Moscow Exchange/);
});

await test("bot: /lang ru switches the chat to Russian everywhere", async () => {
  let out = await msg("/lang", RU);
  assert.ok(buttons(out).some((b) => b.callback_data === "lang:ru"));
  out = await cb("lang:ru", RU);
  assert.match(texts(out), /Язык: русский/);
  assert.ok(buttons(out).some((b) => b.web_app && /terminal\/\?lang=ru$/.test(b.web_app.url) && b.text === "🖥 Терминал"));
  assert.equal(await env.SUBS.get("l:" + RU), "ru");
  out = await msg("/start", RU);
  assert.match(texts(out), /Вы подписаны/);
  assert.match(texts(out), /ФРС сохранила ставку/);
  assert.match(texts(out), /💡 Ставки останутся высокими дольше/);
  assert.match(texts(out), /#ФРС/);
  const meta = (await env.SUBS.getWithMetadata("u:" + RU)).metadata;
  assert.equal(meta.l, "ru", "the language is kept in the subscriber's metadata for the news bot");
  out = await msg("/q AAPL BTC нефть", RU);
  assert.match(texts(out), /AAPL.*342,96/);
  assert.match(texts(out), /BTC.*81\u202f801/);
  assert.match(texts(out), /<i>Нефть Brent<\/i>/);
  out = await msg("/des AAPL", RU);
  assert.match(texts(out), /Аналитики \(53\): <b>покупать/);
  assert.match(texts(out), /Капитализация: <b>\$5,01 трлн/);
  assert.ok(buttons(out).some((b) => b.web_app && /terminal\/\?cmd=AAPL%20DES&lang=ru$/.test(b.web_app.url)));
  out = await msg("/fa AAPL", RU); assert.match(texts(out), /выручка \$416 млрд/); assert.match(texts(out), /27\.09\.2025/);
  out = await msg("/cn AAPL", RU); assert.match(texts(out), /Apple превзошла прогнозы/);
  out = await msg("/des SBER", RU); assert.match(texts(out), /Сбербанк России/);
  out = await msg("/map", RU); assert.match(texts(out), /Технологии \+1,90%/);
  out = await msg("/rates", RU); assert.match(texts(out), /США/); assert.match(texts(out), /спред 10Y−2Y: 37/);
  out = await msg("/cb", RU); assert.match(texts(out), /ЦБ РФ: <b>14,00%<\/b> <i>\(было 15,00%, с 12\.09\.2026/);
  out = await msg("/wirp", RU); assert.match(texts(out), /повышение: 50%/);
  out = await msg("/help", RU); assert.match(texts(out), /\/lang en — in English/);
  out = await msg("/lang en", RU); assert.match(texts(out), /Language: English/);
  out = await msg("/q AAPL", RU); assert.match(texts(out), /342\.96/);
  await msg("/lang ru", RU);
});

await test("/subs gives each subscriber's language to the news bot", async () => {
  const k = crypto.createHash("sha256").update("econnews-sync:" + TOKEN).digest("hex");
  await env.SUBS.put("l:" + OWNER, "ru");
  clearMemo();
  const s = await api("/subs", { Authorization: "Bearer " + k });
  assert.equal(s.json.ok, true);
  assert.ok(s.json.ids.includes("555") && s.json.ids.includes(String(RU)));
  assert.equal(s.json.langs[String(RU)], "ru");
  assert.equal(s.json.langs["555"], undefined, "English is the default and is not listed");
  assert.equal(s.json.langs[OWNER], "ru", "the owner gets the mailing without subscribing");
});

await test("bot: /chart sends a picture", async () => {
  let out = await msg("/chart AAPL 1y");
  let photo = out.find((m) => m.method === "sendPhoto");
  assert.ok(photo, texts(out));
  assert.equal(photo.photo, "https://quickchart.io/chart/render/zf-test");
  assert.match(photo.caption, /1 year/);
  out = await msg("/chart AAPL 1y", RU);
  photo = out.find((m) => m.method === "sendPhoto");
  assert.match(photo.caption, /1 год/);
});

await test("bot: watchlist", async () => {
  let out = await msg("/watch AAPL BTC SBER", 777);
  noErrors(out);
  assert.match(texts(out), /Added: AAPL, BTC, MOEX:SBER/);
  assert.match(texts(out), /My watchlist/);
  out = await msg("/unwatch BTC", 777);
  assert.match(texts(out), /Removed: BTC/);
  const u = JSON.parse(await env.SUBS.get("p:777"));
  assert.deepEqual(u.w, ["AAPL", "MOEX:SBER"]);
  out = await cb("w+:NVDA", 777);
  assert.match(texts(out), /NVDA/);
});

await test("bot: portfolio", async () => {
  let out = await msg("/buy AAPL 10 300", 778);
  noErrors(out);
  assert.match(texts(out), /Bought: AAPL × 10 at 300/);
  out = await msg("/buy BTC 0.5", 778);
  assert.match(texts(out), /Bought: BTC × 0\.5000 at 81,801/);
  assert.match(texts(out), /AAPL<\/b> × 10: \$3,429\.60/);
  out = await msg("/port", 778);
  assert.match(texts(out), /AAPL.*× 10/);
  assert.match(texts(out), /Total/);
  out = await msg("/sell AAPL 4", 778);
  const u = JSON.parse(await env.SUBS.get("p:778"));
  assert.equal(u.p.find((x) => x.s === "AAPL").q, 6);
  out = await msg("/sell TSLA 1", 778);
  assert.match(texts(out), /TSLA is not in your portfolio/);
  out = await msg("/port clear", 778);
  assert.match(texts(out), /cleared/);
});

await test("bot: alerts and cron, each person in their language, few KV writes", async () => {
  let out = await msg("/alert AAPL > 300", 779);
  assert.match(texts(out), /Alert #\d+: AAPL above 300/);
  await msg("/alert BTC < 10", 779);
  out = await msg("/alert AAPL 1000", 779);
  assert.match(texts(out), /AAPL above 1,000/);
  await msg("/alert oil 5%", 779);
  await msg("/alert news Fed", 779);
  await msg("/alert новости ФРС", RU);
  out = await msg("/alerts", 779);
  assert.match(texts(out), /a story with the word «Fed»/);
  // first check: AAPL > 300 and oil (+6.2% > 5%) fire, news alerts only remember the time
  const start = sent.length;
  const ev = { waits: [], waitUntil(p) { this.waits.push(p); } };
  await worker.scheduled({ cron: "*/2 * * * *" }, env, ev);
  await Promise.all(ev.waits);
  let fired = sent.slice(start).map((m) => m.text).join("\n");
  assert.match(fired, /AAPL<\/b> rose above 300/);
  assert.match(fired, /Brent<\/b> is up <b>\+6\.20%/);
  let a = JSON.parse(await env.SUBS.get("alerts"));
  assert.ok(!a.list.some((x) => x.s === "AAPL" && x.v === 300), "a fired alert is removed");
  assert.ok(a.list.some((x) => x.s === "BTC"), "the others stay");
  assert.ok(a.news_ts);
  // nothing new: the check does not write to KV
  const puts = env.SUBS.puts;
  const ev1 = { waits: [], waitUntil(p) { this.waits.push(p); } };
  await worker.scheduled({}, env, ev1);
  await Promise.all(ev1.waits);
  assert.equal(env.SUBS.puts, puts, "a quiet check costs no KV writes");
  // a fresh story with the word: the English reader gets the English headline, the Russian one — Russian
  await env.SUBS.put("live", JSON.stringify({ updated: iso(Date.now() + 1000), news: [{ title: "Fed unexpectedly cuts rates", lang: "en",
    title_ru: "ФРС неожиданно снизила ставку", lead: "", sources: ["Reuters"], link: "https://x/2", level: "high", ts: iso(Date.now() + 1000) }],
    market: dataJson.market }));
  clearMemo();
  const s2 = sent.length;
  const ev2 = { waits: [], waitUntil(p) { this.waits.push(p); } };
  await worker.scheduled({}, env, ev2);
  await Promise.all(ev2.waits);
  const got = sent.slice(s2);
  const en = got.filter((m) => String(m.chat_id) === "779").map((m) => m.text).join("\n");
  const ru = got.filter((m) => String(m.chat_id) === String(RU)).map((m) => m.text).join("\n");
  assert.match(en, /A story with the word «Fed»/);
  assert.match(en, /Fed unexpectedly cuts rates/);
  assert.match(ru, /Новость по слову «ФРС»/);
  assert.match(ru, /ФРС неожиданно снизила ставку/);
  assert.ok(!/Brent/.test(en), "the oil move is not sent twice in a day");
  // delete with the button
  a = JSON.parse(await env.SUBS.get("alerts"));
  const id = a.list.find((x) => x.s === "BTC").id;
  out = await cb("adel:" + id, 779);
  assert.match(texts(out), /deleted/);
});

await test("bot: screener, map, earnings, rates, WIRP, help (English)", async () => {
  let out = await msg("/eqs"); noErrors(out); assert.ok(buttons(out).some((b) => b.callback_data === "eqs:div" && b.text === "🏦 Dividend payers"));
  out = await cb("eqs:div"); noErrors(out); assert.match(texts(out), /1\. <b>XOM/);
  out = await msg("/eqs gainers"); assert.match(texts(out), /1\. <b>NVDA/);
  out = await msg("/eqs лидеры"); assert.match(texts(out), /1\. <b>NVDA/);
  out = await msg("/map"); noErrors(out); assert.match(texts(out), /Technology \+1\.90%/);
  out = await msg("/earnings"); noErrors(out); assert.match(texts(out), /AAPL<\/b> Apple/); assert.match(texts(out), /EPS est\. \$2\.02/);
  out = await msg("/rates"); noErrors(out); assert.match(texts(out), /United States/); assert.match(texts(out), /10Y <b>5\.19%<\/b> \(−9\)/);
  assert.match(texts(out), /10Y−2Y spread: 37/);
  out = await msg("/cb"); noErrors(out); assert.match(texts(out), /Bank of Russia: <b>14\.00%<\/b> <i>\(was 15\.00%, since 12 Sep 2026/);
  out = await msg("/wirp"); noErrors(out); assert.match(texts(out), /hike: 50%/);
  out = await msg("/help"); assert.match(texts(out), /\/alert AAPL > 200/); assert.match(texts(out), /\/lang ru/);
  out = await msg("/markets"); assert.match(texts(out), /Gold: <b>\$4,012<\/b> \+0\.4%/); assert.match(texts(out), /Brent crude: <b>\$80\.10<\/b>/);
  out = await msg("/nonsense"); assert.match(texts(out), /I don't know that command/);
});

await test("bot: a ticker as a plain message", async () => {
  let out = await msg("AAPL");
  assert.match(texts(out), /Apple Inc/);
  out = await msg("oil");
  assert.match(texts(out), /Brent/);
  out = await msg("нефть", RU);
  assert.match(texts(out), /Нефть Brent/);
  out = await msg("hi");
  assert.match(texts(out), /Commands/);
});

await test("replies from data.json: news and markets texts", () => {
  const en = newsText(dataJson, "en"), ru = newsText(dataJson, "ru");
  assert.match(en, /Reuters · \d\d:\d\d · #Fed #rates/);
  assert.match(ru, /#ФРС #ставки/);
  assert.match(marketsText(dataJson, "ru"), /Золото: <b>\$4\u202f012<\/b> \+0,4%/);
});

await test("/api/me: owner sign-in, watchlist, portfolio, alerts, errors in the asked language", async () => {
  let r = await api("/api/me");
  assert.equal(r.json.ok, false);
  assert.match(r.json.error, /Open the terminal/);
  r = await api("/api/me?lang=ru");
  assert.match(r.json.error, /Откройте терминал/);
  const H = { "X-Owner-Key": "pw", "Content-Type": "application/json" };
  r = await api("/api/me", H);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.id, OWNER);
  r = await api("/api/me", H, "POST", { w: ["aapl", "btc", "aapl"], p: [{ s: "NVDA", q: 3, c: 200 }] });
  assert.deepEqual(r.json.w, ["AAPL", "BTC"]);
  r = await api("/api/me", H, "POST", { op: "alert_add", text: "NVDA > 500" });
  assert.equal(r.json.ok, true, JSON.stringify(r.json));
  assert.equal(r.json.alerts.length, 1);
  r = await api("/api/me", H, "POST", { op: "alert_add", text: "???" });
  assert.match(r.json.error, /Didn't get the alert/);
  r = await api("/api/me", H, "POST", { op: "alert_del", id: (await api("/api/me", H)).json.alerts[0].id });
  assert.equal(r.json.alerts.length, 0);
  r = await api("/api/me", { "X-Owner-Key": "wrong" });
  assert.equal(r.json.ok, false);
});

await test("/api/me: sign-in with the Telegram signature", async () => {
  const user = JSON.stringify({ id: 4242, first_name: "Ann" });
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: "q1", user };
  const check = Object.keys(fields).sort().map((k) => k + "=" + fields[k]).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(check).digest("hex");
  const init = new URLSearchParams({ ...fields, hash }).toString();
  let r = await api("/api/me", { "X-Tg-Init": init, "Content-Type": "application/json" }, "POST", { w: ["TSLA"] });
  assert.equal(r.json.id, "4242");
  assert.deepEqual(r.json.w, ["TSLA"]);
  r = await api("/api/me", { "X-Tg-Init": init.replace(/hash=[^&]+/, "hash=00") });
  assert.equal(r.json.ok, false);
});

await test("live feed: accepted with the key and served", async () => {
  const key = crypto.createHash("sha256").update("econnews-sync:" + TOKEN).digest("hex");
  let r = await api("/sync/live", { Authorization: "Bearer nope" }, "POST", { news: [] });
  assert.equal(r.status, 403);
  r = await api("/sync/live", { Authorization: "Bearer " + key, "Content-Type": "application/json" }, "POST",
    { updated: "2099-01-01T00:00:00Z", news: [{ title: "Fresh story", ts: "2099-01-01T00:00:00Z", level: "high", sources: ["X"] }], market: [] });
  assert.equal(r.json.ok, true);
  clearMemo();
  r = await api("/api/live");
  assert.equal(r.json.news[0].title, "Fresh story");
});

await test("/api/company: live fallbacks for a company without deep files (dividends, filings, IV30)", async () => {
  const r = await api("/api/company?s=XOM&parts=co,dvd,cf,opt,rv");
  const c = r.json;
  assert.equal(c.co, undefined);
  assert.deepEqual(c.dvd.hist[0], ["2026-08-06", 0.99]);
  assert.deepEqual(c.dvd.splits[0], ["2001-09-09", "2:1"]);
  assert.deepEqual(c.cf.map((f) => f.type), ["10-Q", "8-K"], "Form 4 (insider trades) is left to HDS");
  assert.equal(c.opt.lite, true);
  assert.equal(c.opt.iv30, 24.4);
  assert.deepEqual(c.rv.rows.map((r) => r.s), ["XOM"], "no peers in the list and alone in its sector");
  assert.deepEqual(c.errors, []);
});

await test("bot (English): deep company functions EE ANR HDS SI DVD CF MGMT RV OMON", async () => {
  let out = await msg("/des AAPL"); noErrors(out);
  assert.match(texts(out), /American multinational technology company/);
  assert.match(texts(out), /Employees: 150,000/);
  assert.match(texts(out), /Price target: <b>\$329\.38<\/b> \(\$215 – \$405\) · −4\.0% from now/);
  for (const cbk of ["ee:AAPL", "hds:AAPL", "dvd:AAPL", "omon:AAPL", "rv:AAPL", "cf:AAPL"]) assert.ok(buttons(out).some((b) => b.callback_data === cbk), cbk);
  out = await msg("/ee AAPL"); noErrors(out);
  assert.match(texts(out), /Current quarter<\/b> \(to 30 Sep 2026\)\nEPS \$1\.98 \(1\.93–2\.07\) · \+6\.9% y\/y/);
  assert.match(texts(out), /Next report: <b>2 Nov 2026<\/b>/);
  assert.match(texts(out), /30 Jun 2026: \$2\.02 vs \$1\.89 · \+6\.7%/);
  out = await msg("/anr AAPL"); noErrors(out);
  assert.match(texts(out), /mean <b>\$329\.38<\/b>, median \$340\.00/);
  assert.match(texts(out), /12 Oct <b>JP Morgan<\/b>: ▪️ maintained Overweight · target \$360 \(was \$340\)/);
  out = await cb("hds:AAPL"); noErrors(out);
  assert.match(texts(out), /Insiders <b>1\.6%<\/b> · institutions <b>66\.3%<\/b> \(7,697\)/);
  assert.match(texts(out), /Blackrock Inc\.: 7\.97% · \$399B · \+1\.6%/);
  assert.match(texts(out), /Vanguard Total Stock Market Index Fund: 3\.19%/);
  assert.match(texts(out), /Cook Tim/);
  out = await cb("si:AAPL"); noErrors(out);
  assert.match(texts(out), /Short: <b>120,763,539 shares<\/b> on 30 Sep 2026/);
  assert.match(texts(out), /Before: 128,753,092 on 15 Sep 2026 \(−6\.2%\)/);
  out = await msg("/dvd AAPL"); noErrors(out);
  assert.match(texts(out), /Annual: <b>\$1\.05<\/b> · yield 0\.32% · payout 12%/);
  assert.match(texts(out), /10 Aug 2026: \$0\.27/);
  assert.match(texts(out), /Splits: 4:1 \(31 Aug 2020\)/);
  out = await msg("/dvd XOM"); noErrors(out); assert.match(texts(out), /6 Aug 2026: \$0\.99/);
  out = await msg("/cf AAPL"); noErrors(out); assert.match(texts(out), /<b>10-Q<\/b> — quarterly report/);
  out = await msg("/mgmt AAPL"); noErrors(out); assert.match(texts(out), /<b>Mr\. Timothy D\. Cook<\/b>, 64\nExecutive Chairman of the Board · pay \$16\.8M/);
  out = await msg("/rv AAPL"); noErrors(out); assert.match(texts(out), /AAPL +38\.8/); assert.match(texts(out), /Median/);
  out = await msg("/omon AAPL"); noErrors(out);
  assert.match(texts(out), /IV30 <b>26\.2%<\/b>/);
  assert.match(texts(out), /16 Oct \(1d\): IV \d+\.\d% · ±\$\d/);
  out = await msg("/omon XOM"); noErrors(out); assert.match(texts(out), /only the IV30/i);
  out = await msg("/ee XOM"); noErrors(out); assert.match(texts(out), /No detailed data for XOM yet/);
  out = await msg("/dvd SBER"); noErrors(out); assert.match(texts(out), /Moscow Exchange shares are not in the free data/);
});

await test("bot (English): macro, IPO, Moscow Exchange", async () => {
  let out = await msg("/macro"); noErrors(out);
  assert.match(texts(out), /United States: GDP 2\.0 \/ 2\.1 · CPI 2\.8 \/ 2\.4/);
  out = await msg("/macro RU"); noErrors(out); assert.match(texts(out), /<b>Russia<\/b>/); assert.match(texts(out), /GDP growth, %\s+5\.7/);
  out = await msg("/ipo"); noErrors(out); assert.match(texts(out), /CTY · CITY THERAPEUTICS, INC\.\n\$17\.00-19\.00 · 9,722,222 shares/);
  out = await msg("/moex"); noErrors(out);
  assert.match(texts(out), /Moscow Exchange today<\/b> · 14:05 MSK/);
  assert.match(texts(out), /Real Estate \+3\.10%/);
  assert.match(texts(out), /Gainers:<\/b> PIK \+3\.1%/);
});

await test("bot (Russian): the new functions speak Russian", async () => {
  await msg("/lang ru", RU);
  let out = await msg("/des AAPL", RU);
  assert.match(texts(out), /американская корпорация/);
  assert.match(texts(out), /Целевая цена: <b>\$329,38<\/b>/);
  assert.ok(buttons(out).some((b) => b.text === "EE прогнозы"));
  out = await msg("/ee AAPL", RU); noErrors(out); assert.match(texts(out), /Текущий квартал<\/b> \(до 30\.09\.2026\)/); assert.match(texts(out), /г\/г/);
  out = await msg("/hds AAPL", RU); noErrors(out); assert.match(texts(out), /Инсайдеры <b>1,6%<\/b> · институционалы <b>66,3%<\/b>/);
  out = await msg("/si AAPL", RU); noErrors(out); assert.match(texts(out), /В шорте: <b>120 763 539 акций<\/b>/);
  out = await msg("/dvd AAPL", RU); noErrors(out); assert.match(texts(out), /Отсечка 10\.08\.2026 · выплата 13\.08\.2026/);
  out = await msg("/cf AAPL", RU); noErrors(out); assert.match(texts(out), /квартальный отчёт/);
  out = await msg("/omon AAPL", RU); noErrors(out); assert.match(texts(out), /Пут\/колл/);
  out = await msg("/rv AAPL", RU); noErrors(out); assert.match(texts(out), /Медиана/);
  out = await msg("/macro", RU); noErrors(out); assert.match(texts(out), /США: ВВП 2,0 \/ 2,1 · ИПЦ 2,8 \/ 2,4/);
  out = await msg("/macro Россия", RU); noErrors(out); assert.match(texts(out), /Рост ВВП, %\s+5,7/);
  out = await msg("/ipo", RU); noErrors(out); assert.match(texts(out), /ожидается/);
  out = await msg("/moex", RU); noErrors(out); assert.match(texts(out), /Недвижимость \+3,10%/); assert.match(texts(out), /ПИК ао \+3,1%/);
  out = await msg("/ee XOM", RU); noErrors(out); assert.match(texts(out), /Подробных данных по XOM пока нет/);
});

await test("morning note: watchlist companies reporting today or tomorrow, once a day, in each person's language", async () => {
  const { watchReminders } = await import("../worker/src/botcmd.js");
  const earn = stocksJson.earnings[0];   // AAPL, in two days
  const day = new Date(Date.parse(earn.d + "T06:05:00Z") - 864e5);   // the day before, 09:05 MSK
  await env.SUBS.put("p:701", JSON.stringify({ w: ["AAPL", "BTC"], p: [] }));
  await env.SUBS.put("p:702", JSON.stringify({ w: ["XOM"], p: [] }));
  await env.SUBS.put("p:703", JSON.stringify({ w: ["AAPL"], p: [] }));
  await env.SUBS.put("l:703", "ru");
  assert.deepEqual(await watchReminders(env, new Date(day.getTime() - 3600e3)), { skipped: true }, "only at 09:00 MSK");
  const start = sent.length;
  const r = await watchReminders(env, day);
  const out = sent.slice(start).filter((m) => ["701", "702", "703"].includes(String(m.chat_id)));
  assert.equal(r.sent, sent.length - start, "other test chats with AAPL in their watchlist get it too");
  assert.deepEqual(out.map((m) => String(m.chat_id)).sort(), ["701", "703"]);
  assert.match(out.find((m) => String(m.chat_id) === "701").text, /<b>AAPL<\/b> Apple reports tomorrow after the close · EPS estimate \$2\.02/);
  assert.match(out.find((m) => String(m.chat_id) === "703").text, /отчитывается завтра/);
  assert.deepEqual(await watchReminders(env, new Date(day.getTime() + 600e3)), { done: true }, "once a day");
  for (const k of ["p:701", "p:702", "p:703", "l:703"]) await env.SUBS.delete(k);
});

await test("/api/ipo and intraday history (1D, 5D)", async () => {
  const r = await api("/api/ipo");
  assert.equal(r.json.ipo[0].symbol, "CTY", "upcoming first (Finnhub)");
  assert.deepEqual(r.json.ipo.map((x) => x.status), ["expected", "priced", "filed"], "then recently priced and filed (Nasdaq file)");
  assert.equal(r.json.source, "Nasdaq + Finnhub");
  const h = await api("/api/history?s=AAPL&r=1d");
  assert.equal(h.json.range, "1d");
  assert.ok(calls.some((u) => /chart\/AAPL\?range=1d&interval=5m/.test(u)), "5-minute bars");
  const b = await api("/api/history?s=BTC&r=5d");
  assert.equal(b.json.range, "5d");
  assert.ok(calls.some((u) => /klines\?symbol=BTCUSDT&interval=30m&limit=240/.test(u)), "30-minute bars");
  clearMemo();
  flags.failBinance = true; flags.failYahoo = true;
  const c = await api("/api/history?s=BTC&r=5d");
  flags.failBinance = false; flags.failYahoo = false;
  assert.equal(c.json.c.length, 120, "without Binance: hourly bars from Coinbase");
  assert.equal(c.json.src, "coinbase");
  const out = await msg("/chart AAPL 1d"); noErrors(out);
  assert.match(texts(out), /1 day/);
});

await test("/api/ipo without Finnhub and without the file; the bot's /ipo shows recently priced deals", async () => {
  clearMemo();
  flags.failFinnhubIpo = true;
  const r = await api("/api/ipo");
  assert.deepEqual(r.json.ipo.map((x) => x.symbol), ["IAM", null], "the Nasdaq file alone");
  let out = await msg("/ipo"); noErrors(out);
  assert.match(texts(out), /No IPOs in the next 30 days[\s\S]*Recently priced[\s\S]*IAM · Iambic Therapeutics/);
  clearMemo();
  flags.noIpoFile = true;
  const e = await api("/api/ipo");
  assert.equal(e.json.ok, false);
  assert.match(e.json.error, /IPO calendar/);
  flags.failFinnhubIpo = false; flags.noIpoFile = false;
  clearMemo();
});

await test("/api/corr: one request for the matrix; returns on common trading days", async () => {
  const { corrPair } = await import("../worker/src/market.js");
  // a 7-day asset and a 5-day one: returns between the days both traded, so Monday is not compared with Sunday
  const a = {}, b = {};
  let pa = 100, pb = 50;
  for (let i = 0; i < 60; i++) {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 864e5), day = d.toISOString().slice(0, 10), wd = d.getUTCDay();
    pa *= 1 + Math.sin(i * 1.7) * 0.02;
    a[day] = pa;
    if (wd !== 0 && wd !== 6) b[day] = pa / 2;   // the same asset, closed at weekends
  }
  const p = corrPair(a, b);
  assert.equal(p.r, 1, "identical prices on common days correlate exactly");
  assert.ok(p.n > 35);
  const r = await api("/api/corr?s=" + encodeURIComponent("AAPL,BTC,gold,NOPE!!") + "&r=1y");
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.syms, ["AAPL", "BTC", "gold"]);
  assert.equal(r.json.m.length, 3);
  assert.equal(r.json.m[0][0], 1);
  assert.equal(r.json.m[0][1], r.json.m[1][0], "symmetric");
  assert.deepEqual(r.json.bad.map((x) => x.s), ["NOPE!!"]);
  const few = await api("/api/corr?s=AAPL");
  assert.equal(few.status, 400);
});

await test("the root address answers", async () => {
  const r = await api("/");
  assert.equal(r.json.ok, true);
});

if (process.exitCode) console.log(`\nWORKER TESTS FAILED (passed ${passed})`);
else console.log(`\nWORKER TESTS PASSED (${passed})`);
