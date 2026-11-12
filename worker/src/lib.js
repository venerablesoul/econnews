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

// Sign-in limits (used in index.js)
export const TG_INIT_TTL = 86400;   // seconds: Telegram's initData is fresh on every terminal start, a day is plenty
export const LOGIN_MAX = 10;        // different wrong owner passwords from one address before it is locked out

// Compares two secrets without leaking through timing how many first characters matched:
// both sides are hashed with a random key first, so the comparison is over unrelated digests.
// (the key is made on first use: Workers do not allow random numbers while the module loads)
let cmpKey = null;
export async function safeEqual(a, b) {
  if (!cmpKey) cmpKey = crypto.getRandomValues(new Uint8Array(32));
  const [x, y] = await Promise.all([hmac(cmpKey, String(a)), hmac(cmpKey, String(b))]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
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

// The news bot's workflow page on GitHub (for the owner's alert): from GITHUB_REPO (set at deploy)
// or from a github.io site address; "" when neither is known (a custom domain without GITHUB_REPO).
export function newsWorkflowUrl(env) {
  let repo = String(env.GITHUB_REPO || "").trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    const m = /^https:\/\/([\w-]+)\.github\.io\/([\w.-]+)\/?/i.exec(String(env.PAGES_URL || ""));
    repo = m ? m[1] + "/" + m[2] : "";
  }
  return repo ? `https://github.com/${repo}/actions/workflows/news.yml` : "";
}

// date/time locales: Russian, British English, simplified Chinese, Arabic with Latin digits (as numbers elsewhere);
// all on the 24-hour clock
export const LOCALE = { ru: "ru-RU", en: "en-GB", zh: "zh-CN-u-hc-h23", ar: "ar-u-nu-latn-hc-h23" };

export function msk(iso, opts, lang = "ru") {
  return new Date(iso).toLocaleString(LOCALE[lang] || LOCALE.en, { timeZone: "Europe/Moscow", ...opts });
}

export function isOwnerChat(env, id) {
  return !!env.OWNER_ID && String(id) === String(env.OWNER_ID).trim();
}

// ---------------------------------------------------------------------------
// In-memory cache of the server: one API request for all viewers
// ---------------------------------------------------------------------------
export const memo = {};

// A load that has not finished in this time is treated as lost and started again. It may belong to a request whose
// viewer went away: the runtime then cancels it, it never finishes, and every later request would wait for it.
export const PENDING_MAX = 20000;

// `ctx` (optional): the request's context — the load keeps running after the answer (ctx.waitUntil).
export async function cached(key, ttl, load, ctx) {
  const m = memo[key];
  if (m && "value" in m && Date.now() - m.at < ttl * 1000) return m.value;
  return reload(key, load, ctx);
}

// Stale-while-revalidate: a value younger than `ttl` seconds is returned as is; an older one (up to `maxAge` seconds)
// is returned at once while a fresh one loads in the background; with no usable value the caller waits for the load.
export async function swr(key, ttl, load, { ctx, maxAge = 600 } = {}) {
  const m = memo[key];
  const age = m && "value" in m ? Date.now() - m.at : Infinity;
  if (age < ttl * 1000) return m.value;
  const p = reload(key, load, ctx);
  if (age < maxAge * 1000) {
    p.catch(() => {});
    return m.value;
  }
  return p;
}

function reload(key, load, ctx) {
  const m = memo[key];
  if (m && m.pending && Date.now() - m.started < PENDING_MAX) return m.pending;
  const pending = Promise.resolve().then(load).then((value) => {
    const cur = memo[key];
    // a newer load may have replaced this one (see PENDING_MAX): keep it running, take the value
    memo[key] = cur && cur.pending && cur.pending !== pending ? { ...cur, at: Date.now(), value } : { at: Date.now(), value };
    return value;
  }, (e) => {
    const cur = memo[key];
    if (cur && cur.pending === pending) {
      // the last good value stays: swr() keeps serving it while the source is down (err says why it is old)
      if ("value" in cur) memo[key] = { at: cur.at, value: cur.value, err: String(e && e.message || e) };
      else delete memo[key];
    }
    throw e;
  });
  memo[key] = { ...(m || {}), pending, started: Date.now() };
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(pending.catch(() => {}));
  return pending;
}

// Waits for `p` at most `ms` milliseconds; after that resolves with `fallback` (p keeps running).
export function within(p, ms, fallback) {
  let timer;
  return Promise.race([
    Promise.resolve(p).finally(() => clearTimeout(timer)),
    new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
  ]);
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

// padding for monospaced tables (<code>): Chinese characters take two columns
const WIDE = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/g;
export const textWidth = (s) => String(s).length + (String(s).match(WIDE) || []).length;
export const padEndW = (s, w) => String(s) + " ".repeat(Math.max(0, w - textWidth(s)));
export const padStartW = (s, w) => " ".repeat(Math.max(0, w - textWidth(s))) + String(s);

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

// money in dollars (or another currency sign): $5.01T / $5,01 трлн / $5.01万亿 / $5.01 تريليون
const UNITS = {
  en: [[1e12, "T"], [1e9, "B"], [1e6, "M"]],
  ru: [[1e12, " трлн"], [1e9, " млрд"], [1e6, " млн"]],
  zh: [[1e12, "万亿"], [1e8, "亿"], [1e4, "万"]],
  ar: [[1e12, " تريليون"], [1e9, " مليار"], [1e6, " مليون"]],
};
export function money(v, cur = "$", lang = "en") {
  if (v == null || isNaN(v)) return "—";
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  for (const [size, word] of UNITS[lang] || UNITS.en) {
    if (a < size) continue;
    const x = a / size;
    return sign + cur + fmt(x, size === 1e12 ? 2 : x >= 100 ? 0 : 1, lang) + word;
  }
  return sign + cur + fmt(a, a >= 1e4 ? 0 : 2, lang);
}

// dates "YYYY-MM-DD…": English "30 Jun 2025" / "30 Jun", Russian "30.06.2025" / "30.06",
// Chinese "2025年6月30日" / "6月30日", Arabic "30 يونيو 2025" / "30 يونيو"
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

export function dmy(d, lang = "ru") {
  if (!d || d.length < 10) return "—";
  if (lang === "zh") return d.slice(0, 4) + "年" + dm(d, lang);
  return lang === "ru" ? d.slice(8, 10) + "." + d.slice(5, 7) + "." + d.slice(0, 4) : dm(d, lang) + " " + d.slice(0, 4);
}

export function dm(d, lang = "ru") {
  if (!d || d.length < 10) return "?";
  const day = +d.slice(8, 10), m = +d.slice(5, 7);
  if (lang === "ru") return d.slice(8, 10) + "." + d.slice(5, 7);
  if (lang === "zh") return m + "月" + day + "日";
  return day + " " + (lang === "ar" ? MON_AR : MON)[m - 1];
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
