// Shared helpers of the bot server: responses, cache, Telegram, number formatting (English / Russian).

export const TG_API = "https://api.telegram.org/bot";
const enc = new TextEncoder();

export function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function cors(res) {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Headers", "X-Tg-Init, X-Owner-Key, Content-Type");
  h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  h.set("Access-Control-Max-Age", "86400");
  return new Response(res.body, { status: res.status, headers: h });
}

export function hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256hex(s) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

export async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}

// Keys are derived from the bot token, so they need no separate secrets.
// The same formulas are in news_bot.py and worker/deploy.py.
export const syncKey = (env) => sha256hex("econnews-sync:" + env.TELEGRAM_BOT_TOKEN);
export const hookKey = async (env) => (await sha256hex("econnews-hook:" + env.TELEGRAM_BOT_TOKEN)).slice(0, 48);

export function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function pagesUrl(env) {
  return (env.PAGES_URL || "").replace(/\/*$/, "/");
}

export function msk(iso, opts, lang = "ru") {
  return new Date(iso).toLocaleString(lang === "ru" ? "ru-RU" : "en-GB", { timeZone: "Europe/Moscow", ...opts });
}

export function isOwnerChat(env, id) {
  return !!env.OWNER_ID && String(id) === String(env.OWNER_ID).trim();
}

// ---------------------------------------------------------------------------
// In-memory cache of the server: one API request for all viewers
// ---------------------------------------------------------------------------
export const memo = {};

export async function cached(key, ttl, load) {
  const m = memo[key];
  if (m && "value" in m && Date.now() - m.at < ttl * 1000) return m.value;
  if (m && m.pending) return m.pending;
  const pending = load().then((value) => { memo[key] = { at: Date.now(), value }; return value; })
    .catch((e) => { if (memo[key] && memo[key].pending === pending) delete memo[key]; throw e; });
  memo[key] = { ...(m || {}), pending };
  return pending;
}

export function clearMemo() {
  for (const k of Object.keys(memo)) delete memo[k];
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export async function getJSON(url, { ttl = 0, timeout = 12000, headers = {} } = {}) {
  const init = { headers: { "User-Agent": UA, Accept: "application/json,*/*", ...headers } };
  if (ttl > 0) init.cf = { cacheTtl: ttl, cacheEverything: true };
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) init.signal = AbortSignal.timeout(timeout);
  const r = await fetch(url, init);
  if (!r.ok) {
    const e = new Error("HTTP " + r.status + " " + url.replace(/token=[^&]+/, "token=***").split("?")[0]);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

export async function getText(url, { ttl = 0, timeout = 12000 } = {}) {
  const init = { headers: { "User-Agent": UA } };
  if (ttl > 0) init.cf = { cacheTtl: ttl, cacheEverything: true };
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) init.signal = AbortSignal.timeout(timeout);
  const r = await fetch(url, init);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.text();
}

// ---------------------------------------------------------------------------
// Numbers: English "1,234.56" or Russian "1 234,56" (lang = "en" | "ru")
// ---------------------------------------------------------------------------
export function fmt(v, d = 2, lang = "en") {
  if (v == null || isNaN(v)) return "—";
  const ru = lang === "ru";
  const s = Math.abs(Number(v)).toFixed(d);
  const [a, b] = s.split(".");
  const grouped = a.replace(/\B(?=(\d{3})+(?!\d))/g, ru ? "\u202f" : ",");
  const neg = Number(v) < 0 && Number(s) !== 0;
  return (neg ? "−" : "") + grouped + (b ? (ru ? "," : ".") + b : "");
}

export function digitsFor(p) {
  const a = Math.abs(p || 0);
  return a >= 1000 ? 0 : a >= 10 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 4 : 6;
}

export function price(v, lang = "en") {
  return fmt(v, digitsFor(v), lang);
}

export function pct(c, d = 2, lang = "en") {
  if (c == null || isNaN(c)) return "—";
  const s = Math.abs(c).toFixed(d);
  return (c > 0 ? "+" : c < 0 && Number(s) !== 0 ? "−" : "") + (lang === "ru" ? s.replace(".", ",") : s) + "%";
}

export function arrow(c) {
  return c == null ? "⚪" : c > 0.005 ? "🟢" : c < -0.005 ? "🔴" : "⚪";
}

// money in dollars (or another currency sign): $5.01T / $5,01 трлн
export function money(v, cur = "$", lang = "en") {
  if (v == null || isNaN(v)) return "—";
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  const ru = lang === "ru";
  if (a >= 1e12) return sign + cur + fmt(a / 1e12, 2, lang) + (ru ? " трлн" : "T");
  if (a >= 1e9) return sign + cur + fmt(a / 1e9, a >= 1e11 ? 0 : 1, lang) + (ru ? " млрд" : "B");
  if (a >= 1e6) return sign + cur + fmt(a / 1e6, a >= 1e8 ? 0 : 1, lang) + (ru ? " млн" : "M");
  return sign + cur + fmt(a, a >= 1e4 ? 0 : 2, lang);
}

// dates "YYYY-MM-DD…": English "30 Jun 2025" / "30 Jun", Russian "30.06.2025" / "30.06"
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dmy(d, lang = "ru") {
  if (!d || d.length < 10) return "—";
  return lang === "ru" ? d.slice(8, 10) + "." + d.slice(5, 7) + "." + d.slice(0, 4) : +d.slice(8, 10) + " " + MON[+d.slice(5, 7) - 1] + " " + d.slice(0, 4);
}

export function dm(d, lang = "ru") {
  if (!d || d.length < 10) return "?";
  return lang === "ru" ? d.slice(8, 10) + "." + d.slice(5, 7) : +d.slice(8, 10) + " " + MON[+d.slice(5, 7) - 1];
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------
export async function tg(env, method, body) {
  const r = await fetch(TG_API + env.TELEGRAM_BOT_TOKEN + "/" + method, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return r.json().catch(() => ({ ok: false }));
}

export async function send(env, chat, text, markup) {
  const id = typeof chat === "object" ? chat.id : chat;
  const body = { chat_id: id, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (markup) body.reply_markup = markup;
  let r = await tg(env, "sendMessage", body);
  if (!r.ok && markup && /button|web_app|markup/i.test(r.description || "")) {
    delete body.reply_markup;   // just in case: without buttons, but the message gets through
    r = await tg(env, "sendMessage", body);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Data of the main bot (docs/*.json on the site) + the live feed from KV
// ---------------------------------------------------------------------------
export async function pageJSON(env, name, ttl = 60) {
  return cached("page:" + name, ttl, () => getJSON(pagesUrl(env) + name, { ttl }));
}

export async function liveData(env) {
  return cached("live", 20, async () => {
    if (!env.SUBS) return null;
    const raw = await env.SUBS.get("live");
    return raw ? JSON.parse(raw) : null;
  });
}

// data.json with fresh news and quotes on top (the main bot pushes them every 5 minutes)
export async function siteData(env) {
  const [site, live] = await Promise.all([
    pageJSON(env, "data.json").catch(() => null),
    liveData(env).catch(() => null),
  ]);
  if (!site && !live) throw new Error("no bot data yet");
  if (!live || (site && (site.updated || "") >= (live.updated || ""))) return site;
  return { ...(site || {}), updated: live.updated, news: live.news || (site && site.news) || [],
    market: live.market && live.market.length ? live.market : (site && site.market) || [] };
}
