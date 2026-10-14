// Тесты сервера бота (worker/src) без сети: fetch и хранилище KV подменены.
// Запуск: node tests/worker.test.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { PAGES, TOKEN, OWNER, sent, calls, flags, dataJson, KV, installMocks, iso } from "./mocks.mjs";
installMocks();
const env = { TELEGRAM_BOT_TOKEN: TOKEN, OWNER_ID: OWNER, FINNHUB_API_KEY: "FHKEY", TERMINAL_PASSWORD: "pw", PAGES_URL: PAGES, SUBS: new KV() };
const ctx = { waits: [], waitUntil(p) { this.waits.push(p); } };

const worker = (await import("../worker/src/index.js")).default;
const { handleUpdate } = await import("../worker/src/index.js");
const { parseSymbol } = await import("../worker/src/market.js");
const { parseAlert, cleanPort } = await import("../worker/src/user.js");
const { clearMemo } = await import("../worker/src/lib.js");

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
const msg = async (text, chatId = 555, type = "private") => {
  const start = sent.length;
  await handleUpdate({ update_id: ++uid, message: { message_id: uid, chat: { id: chatId, type }, from: { id: chatId, first_name: "Тест" }, text } }, env);
  return sent.slice(start);
};
const cb = async (data, chatId = 555) => {
  const start = sent.length;
  await handleUpdate({ update_id: ++uid, callback_query: { id: "c" + uid, data, from: { id: chatId }, message: { chat: { id: chatId, type: "private" } } } }, env);
  return sent.slice(start).filter((m) => m.method !== "answerCallbackQuery");
};
const texts = (out) => out.map((m) => m.text || m.caption || "").join("\n----\n");
const noErrors = (out) => assert.ok(!/Не получилось|Не знаю такой команды/.test(texts(out)), texts(out));

console.log("Сервер бота:");

await test("разбор тикеров", () => {
  assert.equal(parseSymbol("aapl").key, "AAPL");
  assert.equal(parseSymbol("AAPL US Equity").key, "AAPL");
  assert.equal(parseSymbol("NASDAQ:AAPL").key, "AAPL");
  assert.equal(parseSymbol("BRK-B").key, "BRK.B");
  assert.equal(parseSymbol("btc").kind, "crypto");
  assert.equal(parseSymbol("BINANCE:ETHUSDT").key, "ETH");
  assert.equal(parseSymbol("SBER").key, "MOEX:SBER");
  assert.equal(parseSymbol("MOEX:T").key, "MOEX:T");
  assert.equal(parseSymbol("T").key, "T");
  assert.equal(parseSymbol("нефть").key, "Brent");
  assert.equal(parseSymbol("золото").key, "Золото");
  assert.equal(parseSymbol("S&P").key, "S&P");
  assert.equal(parseSymbol("привет"), null);
  assert.equal(parseSymbol(""), null);
});

await test("разбор алертов", () => {
  assert.deepEqual(parseAlert("AAPL > 200"), { k: "px", s: "AAPL", op: ">", v: 200 });
  assert.deepEqual(parseAlert("BTC ниже 60 000"), { k: "px", s: "BTC", op: "<", v: 60000 });
  assert.deepEqual(parseAlert("нефть 5%"), { k: "chg", s: "Brent", v: 5 });
  assert.deepEqual(parseAlert("SBER ±3,5%"), { k: "chg", s: "MOEX:SBER", v: 3.5 });
  assert.deepEqual(parseAlert("новости ФРС"), { k: "news", kw: "ФРС" });
  assert.deepEqual(parseAlert("AAPL 400"), { k: "px", s: "AAPL", op: "?", v: 400 });
  assert.equal(parseAlert("что-то непонятное"), null);
});

await test("портфель: одна позиция на инструмент со средней ценой", () => {
  assert.deepEqual(cleanPort([{ s: "aapl", q: 10, c: 100 }, { s: "AAPL", q: 10, c: 200 }, { s: "???", q: 1, c: 1 }, { s: "BTC", q: 0, c: 1 }]),
    [{ s: "AAPL", q: 20, c: 150 }]);
});

await test("/api/quote: акции США, крипта, Мосбиржа, нефть", async () => {
  const r = await api("/api/quote?s=AAPL,BTC,SBER,нефть,ZZZZ");
  assert.equal(r.json.ok, true);
  const q = r.json.quotes;
  assert.equal(q.AAPL.px, 342.96);
  assert.equal(q.BTC.px, 81800.5);
  assert.equal(q["MOEX:SBER"].px, 285.52);
  assert.equal(q.Brent.px, 80.1);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "*");
  assert.ok(!JSON.stringify(r.json).includes("FHKEY"), "ключ не должен попасть в ответ");
});

await test("/api/company: все разделы", async () => {
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
  assert.equal(c.cn[0].h, "Apple превзошла прогнозы");
  assert.equal(c.cn[0].en, "Apple beats estimates");
  assert.equal(c.ins.length, 1, "только покупки/продажи на рынке");
  assert.deepEqual(c.peers, ["DELL", "HPQ"]);
  assert.deepEqual(c.errors, []);
});

await test("/api/company: компания вне списка SEC и Мосбиржа", async () => {
  const r = await api("/api/company?s=ZZZZ&parts=des");
  assert.equal(r.json.ok, false);
  const m = await api("/api/company?s=SBER");
  assert.equal(m.json.ok, true);
  assert.equal(m.json.profile.isin, "RU0009029540");
  assert.equal(m.json.quote.px, 285.52);
  const nf = await api("/api/company?s=MSFT&parts=fa");
  assert.equal(nf.json.ok, true);
  assert.equal(nf.json.fin, undefined);
  assert.ok(nf.json.faSeries);
});

await test("/api/history: акции, крипта, Мосбиржа, запасной вариант при сбое", async () => {
  const a = await api("/api/history?s=AAPL&r=1y");
  assert.equal(a.json.ok, true);
  assert.equal(a.json.c.length, 250);
  assert.equal(a.json.src, "yahoo");
  const b = await api("/api/history?s=BTC&r=6m");
  assert.equal(b.json.src, "binance");
  assert.ok(b.json.c.length > 100);
  const s = await api("/api/history?s=SBER&r=3m");
  assert.equal(s.json.src, "moex");
  flags.failYahoo = true;
  clearMemo();
  const f = await api("/api/history?s=MSFT&r=1y");
  flags.failYahoo = false;
  assert.equal(f.json.ok, false);
  assert.ok(/429/.test(f.json.error));
});

await test("вебхук без секрета отклоняется", async () => {
  const r = await worker.fetch(new Request("https://w.test/tg", { method: "POST", body: "{}" }), env, ctx);
  assert.equal(r.status, 403);
});

await test("бот: /q /des /fa /ern /anr /cn /hds", async () => {
  let out = await msg("/q AAPL BTC нефть SBER");
  noErrors(out);
  assert.match(texts(out), /AAPL.*342,96/);
  assert.match(texts(out), /BTC.*81 801/);
  out = await msg("/des AAPL");
  noErrors(out);
  assert.match(texts(out), /Apple Inc/);
  assert.match(texts(out), /P\/E: 38,8/);
  assert.match(texts(out), /Аналитики \(53\): <b>покупать/);
  assert.ok(out[0].reply_markup.inline_keyboard.flat().some((b) => b.callback_data === "fa:AAPL"));
  assert.ok(out[0].reply_markup.inline_keyboard.flat().some((b) => b.web_app && /terminal\/\?cmd=AAPL%20DES/.test(b.web_app.url)));
  out = await msg("/fa AAPL"); noErrors(out); assert.match(texts(out), /выручка \$416 млрд/);
  out = await msg("/ern AAPL"); noErrors(out); assert.match(texts(out), /Следующий/); assert.match(texts(out), /❌ Q3 2026/);
  out = await msg("/anr AAPL"); noErrors(out); assert.match(texts(out), /Консенсус: <b>покупать/);
  out = await msg("/cn AAPL"); noErrors(out); assert.match(texts(out), /Apple превзошла прогнозы/);
  out = await msg("/hds AAPL"); noErrors(out); assert.match(texts(out), /Cook Tim/);
  out = await msg("/des SBER"); noErrors(out); assert.match(texts(out), /Сбербанк России/);
});

await test("бот: /chart присылает картинку", async () => {
  const out = await msg("/chart AAPL 1y");
  const photo = out.find((m) => m.method === "sendPhoto");
  assert.ok(photo, texts(out));
  assert.equal(photo.photo, "https://quickchart.io/chart/render/zf-test");
  assert.match(photo.caption, /1 год/);
});

await test("бот: список наблюдения", async () => {
  let out = await msg("/watch AAPL BTC SBER", 777);
  noErrors(out);
  assert.match(texts(out), /Добавил: AAPL, BTC, MOEX:SBER/);
  assert.match(texts(out), /Мой список/);
  out = await msg("/unwatch BTC", 777);
  assert.match(texts(out), /Убрал: BTC/);
  const u = JSON.parse(await env.SUBS.get("p:777"));
  assert.deepEqual(u.w, ["AAPL", "MOEX:SBER"]);
  out = await cb("w+:NVDA", 777);
  assert.match(texts(out), /NVDA/);
});

await test("бот: портфель", async () => {
  let out = await msg("/buy AAPL 10 300", 778);
  noErrors(out);
  assert.match(texts(out), /Куплено: AAPL × 10 по 300/);
  out = await msg("/buy BTC 0.5", 778);
  assert.match(texts(out), /Куплено: BTC × 0,5000 по 81 801/);
  assert.match(texts(out), /AAPL<\/b> × 10: \$3 429,60/);
  out = await msg("/port", 778);
  assert.match(texts(out), /AAPL.*× 10/);
  assert.match(texts(out), /Итого/);
  out = await msg("/sell AAPL 4", 778);
  const u = JSON.parse(await env.SUBS.get("p:778"));
  assert.equal(u.p.find((x) => x.s === "AAPL").q, 6);
  out = await msg("/port clear", 778);
  assert.match(texts(out), /очищен/);
});

await test("бот: алерты и cron", async () => {
  let out = await msg("/alert AAPL > 300", 779);
  assert.match(texts(out), /Алерт №\d+: AAPL выше 300/);
  out = await msg("/alert BTC < 10", 779);
  out = await msg("/alert AAPL 1000", 779);
  assert.match(texts(out), /AAPL выше 1 000/);
  out = await msg("/alert нефть 5%", 779);
  out = await msg("/alert новости ФРС", 779);
  out = await msg("/alerts", 779);
  assert.match(texts(out), /новость со словом «ФРС»/);
  // первая проверка: срабатывают AAPL > 300 и нефть (+6,2% > 5%), новости только запоминают время
  const start = sent.length;
  const ev = { waits: [], waitUntil(p) { this.waits.push(p); } };
  await worker.scheduled({ cron: "*/2 * * * *" }, env, ev);
  await Promise.all(ev.waits);
  let fired = sent.slice(start).map((m) => m.text).join("\n");
  assert.match(fired, /AAPL<\/b> поднялся выше 300/);
  assert.match(fired, /Brent<\/b> вырос за день на <b>\+6,20%/);
  let a = JSON.parse(await env.SUBS.get("alerts"));
  assert.ok(!a.list.some((x) => x.s === "AAPL" && x.v === 300), "сработавший алерт удалён");
  assert.ok(a.list.some((x) => x.s === "BTC"), "несработавший остался");
  assert.ok(a.news_ts);
  // появилась свежая новость со словом — приходит оповещение; изменение нефти второй раз за день не шлётся
  await env.SUBS.put("live", JSON.stringify({ updated: iso(Date.now()), news: [{ title: "ФРС неожиданно снизила ставку", lead: "", sources: ["Reuters"],
    link: "https://x/2", level: "high", ts: iso(Date.now()) }], market: dataJson.market }));
  clearMemo();
  const s2 = sent.length;
  const ev2 = { waits: [], waitUntil(p) { this.waits.push(p); } };
  await worker.scheduled({}, env, ev2);
  await Promise.all(ev2.waits);
  fired = sent.slice(s2).map((m) => m.text).join("\n");
  assert.match(fired, /Новость по слову «ФРС»/);
  assert.ok(!/Brent/.test(fired), fired);
  // удаление кнопкой
  a = JSON.parse(await env.SUBS.get("alerts"));
  const id = a.list.find((x) => x.s === "BTC").id;
  out = await cb("adel:" + id, 779);
  assert.match(texts(out), /удалён/);
});

await test("бот: скринер, карта, отчёты, ставки, WIRP, справка", async () => {
  let out = await msg("/eqs"); noErrors(out); assert.ok(out[0].reply_markup.inline_keyboard.flat().some((b) => b.callback_data === "eqs:div"));
  out = await cb("eqs:div"); noErrors(out); assert.match(texts(out), /1\. <b>XOM/);
  out = await msg("/eqs лидеры"); assert.match(texts(out), /1\. <b>NVDA/);
  out = await msg("/map"); noErrors(out); assert.match(texts(out), /Технологии \+1,90%/);
  out = await msg("/earnings"); noErrors(out); assert.match(texts(out), /AAPL<\/b> Apple/);
  out = await msg("/rates"); noErrors(out); assert.match(texts(out), /10Y <b>5,19%<\/b> \(−9\)/); assert.match(texts(out), /спред 10Y−2Y: 37/);
  out = await msg("/cb"); noErrors(out); assert.match(texts(out), /ЦБ РФ: <b>14,00%<\/b> <i>\(было 15,00%, с 12\.09\.2026/);
  out = await msg("/wirp"); noErrors(out); assert.match(texts(out), /повышение: 50%/);
  out = await msg("/help"); assert.match(texts(out), /\/alert AAPL > 200/);
  out = await msg("/news"); assert.match(texts(out), /ФРС/);
});

await test("бот: тикер обычным сообщением", async () => {
  let out = await msg("AAPL");
  assert.match(texts(out), /Apple Inc/);
  out = await msg("нефть");
  assert.match(texts(out), /Brent/);
  out = await msg("hi");
  assert.match(texts(out), /Команды/);
});

await test("/api/me: вход владельца, список, портфель, алерты", async () => {
  let r = await api("/api/me");
  assert.equal(r.json.ok, false);
  const H = { "X-Owner-Key": "pw", "Content-Type": "application/json" };
  r = await api("/api/me", H);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.id, OWNER);
  r = await api("/api/me", H, "POST", { w: ["aapl", "btc", "aapl"], p: [{ s: "NVDA", q: 3, c: 200 }] });
  assert.deepEqual(r.json.w, ["AAPL", "BTC"]);
  r = await api("/api/me", H, "POST", { op: "alert_add", text: "NVDA > 500" });
  assert.equal(r.json.ok, true, JSON.stringify(r.json));
  assert.equal(r.json.alerts.length, 1);
  r = await api("/api/me", H, "POST", { op: "alert_del", id: r.json.alerts[0].id });
  assert.equal(r.json.alerts.length, 0);
  r = await api("/api/me", { "X-Owner-Key": "wrong" });
  assert.equal(r.json.ok, false);
});

await test("/api/me: вход через подпись Telegram", async () => {
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

await test("живая лента: приём с ключом и выдача", async () => {
  const key = crypto.createHash("sha256").update("econnews-sync:" + TOKEN).digest("hex");
  let r = await api("/sync/live", { Authorization: "Bearer nope" }, "POST", { news: [] });
  assert.equal(r.status, 403);
  r = await api("/sync/live", { Authorization: "Bearer " + key, "Content-Type": "application/json" }, "POST",
    { updated: "2099-01-01T00:00:00Z", news: [{ title: "Свежая новость", ts: "2099-01-01T00:00:00Z", level: "high", sources: ["X"] }], market: [] });
  assert.equal(r.json.ok, true);
  clearMemo();
  r = await api("/api/live");
  assert.equal(r.json.news[0].title, "Свежая новость");
});

await test("старые адреса работают как раньше", async () => {
  const r = await api("/");
  assert.equal(r.json.ok, true);
  const k = crypto.createHash("sha256").update("econnews-sync:" + TOKEN).digest("hex");
  const s = await api("/subs", { Authorization: "Bearer " + k });
  assert.equal(s.json.ok, true);
});

const total = passed;
if (process.exitCode) console.log(`\nОШИБКИ в тестах сервера (прошло ${total})`);
else console.log(`\nWORKER TESTS PASSED (${total})`);
