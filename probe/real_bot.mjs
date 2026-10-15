// The real bot code (from main) against the real sources; only Telegram is intercepted — nothing is sent to anyone.
import { KV } from "/tmp/m/tests/mocks.mjs";
const realFetch = globalThis.fetch;
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.telegram.org/")) {
    sent.push(init && init.body ? JSON.parse(init.body) : {});
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), { headers: { "content-type": "application/json" } });
  }
  return realFetch(url, init);
};
const { handleUpdate } = await import("/tmp/m/worker/src/index.js");
const { watchReminders } = await import("/tmp/m/worker/src/botcmd.js");
const env = { TELEGRAM_BOT_TOKEN: "1:x", OWNER_ID: "1", FINNHUB_API_KEY: process.env.FINNHUB_API_KEY, PAGES_URL: process.env.PAGES, SUBS: new KV() };
let uid = 0;
const out = {};
async function msg(chat, text) {
  const n = sent.length, t = Date.now();
  try { await handleUpdate({ update_id: ++uid, message: { message_id: uid, chat: { id: chat, type: "private" }, from: { id: chat, first_name: "T" }, text } }, env); }
  catch (e) { return { err: String(e && e.stack || e).slice(0, 400) }; }
  const r = sent.slice(n);
  return { sec: (Date.now() - t) / 1000, text: r.map((m) => m.text || m.caption || ("[photo] " + (m.photo || ""))).join("\n----\n"),
    buttons: r.flatMap((m) => ((m.reply_markup || {}).inline_keyboard || []).flat().map((b) => b.text)) };
}
const CMDS = ["/q AAPL BTC oil SBER", "/des AAPL", "/fa AAPL", "/ern AAPL", "/ee AAPL", "/anr AAPL", "/hds AAPL", "/si AAPL", "/dvd AAPL", "/dvd KO",
  "/cf AAPL", "/cf MSFT", "/mgmt AAPL", "/rv AAPL", "/omon AAPL", "/omon XOM", "/cn AAPL", "/chart BTC 1d", "/chart AAPL 5d", "/macro", "/macro RU",
  "/ipo", "/moex", "/map", "/eqs leaders", "/earnings", "/rates", "/cb", "/wirp", "/des SBER", "/dvd SBER", "/ee ZZZZ"];
for (const [chat, lang] of [[101, "en"], [102, "ru"]]) {
  if (lang === "ru") await msg(chat, "/lang ru");
  for (const c of CMDS) out[lang + " " + c] = await msg(chat, c);
}
// the morning note: a watchlist with a company that reports tomorrow
const st = await (await realFetch(process.env.PAGES + "stocks.json")).json();
const e = (st.earnings || []).find((x) => x.d > new Date().toISOString().slice(0, 10));
if (e) {
  await env.SUBS.put("p:101", JSON.stringify({ w: [e.s], p: [] }));
  const n = sent.length;
  const r = await watchReminders(env, new Date(Date.parse(e.d + "T06:05:00Z") - 864e5));
  out.reminder = { earning: e, result: r, text: sent.slice(n).map((m) => m.text).join("\n") };
}
console.log(JSON.stringify(out));
