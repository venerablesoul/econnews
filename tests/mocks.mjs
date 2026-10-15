// Fake external services for the bot server and terminal tests: Finnhub, Yahoo, Binance, Moscow Exchange,
// Telegram, QuickChart, translators and the site's files. No network.
import assert from "node:assert/strict";

export const PAGES = "https://pages.test/econnews/";
export const TOKEN = "123:TEST";
export const OWNER = "111";
export const sent = [];          // everything sent to Telegram
export const calls = [];         // all outgoing requests
export const flags = { failYahoo: false, failBinance: false, failGoogle: false, failSpark: false };

// ------------------------------------------------------------------ data
const now = Date.now();
export const iso = (ms) => new Date(ms).toISOString();
export const dataJson = {
  updated: iso(now - 600e3),
  market: [
    { id: "S&P", name: "S&P 500", name_en: "S&P 500", price: "7 719", value: 7719, change: -1.1, change_txt: "▼1,1%", digits: 0 },
    { id: "Brent", name: "Нефть Brent", name_en: "Brent crude", price: "$80,1", value: 80.1, change: 6.2, change_txt: "▲6,2%", digits: 2, prefix: "$" },
    { id: "Золото", name: "Золото", name_en: "Gold", price: "$4 012", value: 4012.4, change: 0.4, digits: 0, prefix: "$" },
  ],
  news: [
    // the current format: original headline + translation, English tags and sources, AI summary in both languages
    { title: "Fed holds rates", lang: "en", title_ru: "ФРС сохранила ставку", lead: "The Fed kept rates on hold.", lead_ru: "ФРС сохранила ставку.",
      tags: ["Fed", "rates"], sources: ["Reuters"], link: "https://x/1", level: "high", ts: iso(now - 3600e3),
      ai: { sum: "Rates stay high for longer", sum_ru: "Ставки останутся высокими дольше", assets: [] } },
    // the older format (Russian title + English original) must still work
    { title: "Акции Tesla обвалились после отзыва", original: "Tesla shares plunge after recall", lead: "", tags: [], sources: ["CNBC"],
      link: "https://x/3", level: "medium", ts: iso(now - 7200e3), tk: ["TSLA"], dir: -1,
      ai: { sum: "Отзыв машин бьёт по продажам Tesla", assets: [{ a: "TSLA", d: "down" }] } }],
  calendar: [], trades: {},
};
export const stocksJson = {
  updated: iso(now),
  stocks: [
    { s: "AAPL", n: "Apple", sec: "Technology", px: 342.96, ch: 0.5, pe: 38.8, dy: 0.5, mcap: 5e6, revg: 14, r52: 37, l52: 243 },
    { s: "XOM", n: "Exxon Mobil", sec: "Energy", px: 110, ch: -2.1, pe: 12, dy: 3.4, mcap: 4.6e5, revg: -3, r52: 5, l52: 100 },
    { s: "NVDA", n: "Nvidia", sec: "Technology", px: 221, ch: 3.3, pe: 50, mcap: 5.4e6, revg: 80, r52: 60, l52: 150 },
  ],
  sectors: [{ sec: "Technology", ch: 1.9, n: 2, mcap: 1.04e7 }, { sec: "Energy", ch: -2.1, n: 1, mcap: 4.6e5 }],
  earnings: [{ s: "AAPL", n: "Apple", d: iso(now + 2 * 864e5).slice(0, 10), h: "amc", eps_e: 2.02 }],
};
export const ratesJson = {
  updated: iso(now),
  curves: {
    US: { name: "United States", name_ru: "США", flag: "🇺🇸", date: "2026-10-14", t: ["3M", "2Y", "10Y", "30Y"], x: [0.25, 2, 10, 30], y: [4.28, 4.82, 5.19, 5.52], w: [4.22, 4.77, 5.28, 5.67] },
    RU: { name: "Russia (OFZ)", name_ru: "Россия (ОФЗ)", flag: "🇷🇺", date: "2026-10-14", t: ["2Y", "10Y"], x: [2, 10], y: [14.0, 15.9], w: null },
  },
  cb: [{ c: "US", name: "Federal Reserve", name_ru: "ФРС США", flag: "🇺🇸", rate: 3.875, lo: 3.75, hi: 4.0 },
    { c: "RU", name: "Bank of Russia", name_ru: "ЦБ РФ", flag: "🇷🇺", rate: 14, prev: 15, since: "2026-09-12" }],
  wirp: { effr: 3.88, lo: 3.75, hi: 4.0, meetings: [{ date: "2026-10-28", after: 4.005, d_bp: 12.5, cum_bp: 12.5, hike: 50, hold: 50, cut: 0, hike50: 0 }] },
};
export const finAAPL = { s: "AAPL", annual: [{ end: "2025-09-27", rev: 416e9, ni: 112e9, eps: 7.46, fcf: 98e9, cash: 30e9, debt: 90e9, eq: 70e9 }],
  quarterly: [{ end: "2026-06-27", rev: 109.4e9, ni: 29.8e9, eps: 2.02 }] };
const closes = Array.from({ length: 250 }, (_, i) => 250 + i * 0.4);

export function route(url, init) {
  const u = new URL(url);
  const p = u.pathname;
  if (u.host === "api.telegram.org") {
    const method = p.split("/").pop();
    const body = init && init.body ? JSON.parse(init.body) : {};
    sent.push({ method, ...body });
    return { ok: true, result: { message_id: sent.length } };
  }
  if (u.host === "pages.test") {
    const name = p.replace("/econnews/", "");
    const map = { "data.json": dataJson, "stocks.json": stocksJson, "rates.json": ratesJson, "fin/AAPL.json": finAAPL };
    if (map[name]) return map[name];
    return { __status: 404 };
  }
  if (u.host === "finnhub.io") {
    assert.ok(u.searchParams.get("token"), "the Finnhub key goes only to Finnhub");
    const s = u.searchParams.get("symbol");
    if (p.endsWith("/quote")) return s === "ZZZZ" ? { c: 0, d: null, dp: null } : { c: s === "AAPL" ? 342.96 : 100, dp: 0.5, pc: 341.27, h: 347, l: 341, o: 344, t: 1792008000 };
    if (p.endsWith("/profile2")) return s === "ZZZZ" ? {} : { name: s === "AAPL" ? "Apple Inc" : s + " Corp", exchange: "NASDAQ NMS - GLOBAL MARKET", country: "US", currency: "USD",
      ipo: "1980-12-12", marketCapitalization: 5045937.46, shareOutstanding: 14687.36, finnhubIndustry: "Technology", weburl: "https://www.apple.com/" };
    if (p.endsWith("/metric")) return { metric: { peTTM: 38.83, forwardPE: 35.3, psTTM: 10.7, pbQuarterly: 38.5, dividendYieldIndicatedAnnual: 0.505,
      dividendIndicatedAnnual: 1.08, beta: 1.106, epsTTM: 8.72, epsGrowthTTMYoy: 32.6, revenueGrowthTTMYoy: 14.24, roeTTM: 137.2,
      grossMarginTTM: 48.65, operatingMarginTTM: 33.17, netProfitMarginTTM: 27.62, "52WeekHigh": 348.15, "52WeekLow": 243.42,
      yearToDatePriceReturnDaily: 25.5, "52WeekPriceReturnDaily": 37.8, marketCapitalization: 5006387.5 },
      series: { annual: { eps: [{ period: "2025-09-27", v: 7.465 }], netMargin: [{ period: "2025-09-27", v: 0.2692 }] },
        quarterly: { eps: [{ period: "2026-06-27", v: 2.0244 }], salesPerShare: [{ period: "2026-06-27", v: 7.45 }] } } };
    if (p.endsWith("/recommendation")) return [{ period: "2026-09-01", strongBuy: 12, buy: 22, hold: 15, sell: 3, strongSell: 1 },
      { period: "2026-06-01", strongBuy: 14, buy: 24, hold: 15, sell: 2, strongSell: 0 }];
    if (p.endsWith("/calendar/earnings")) return { earningsCalendar: [{ symbol: s, date: iso(now + 18 * 864e5).slice(0, 10), hour: "amc", quarter: 4, year: 2026,
      epsEstimate: 2.0214, revenueEstimate: 115327453620 }] };
    if (p.endsWith("/earnings")) return [{ estimate: 1.9271, actual: 1.91, period: "2026-06-30", surprisePercent: -0.89, year: 2026, quarter: 3 },
      { estimate: 1.9884, actual: 2.01, period: "2026-03-31", surprisePercent: 1.09, year: 2026, quarter: 2 }];
    if (p.endsWith("/company-news")) return [{ datetime: 1792005473, headline: "Apple beats estimates", source: "Yahoo", url: "https://n/1" },
      { datetime: 1792004936, headline: "iPhone sales jump", source: "CNBC", url: "https://n/2" }];
    if (p.endsWith("/peers")) return [s, "DELL", "HPQ"];
    if (p.endsWith("/insider-transactions")) return { data: [{ name: "Cook Tim", change: -2399, share: 39593, transactionDate: "2026-10-06",
      transactionCode: "S", transactionPrice: 332.01, isDerivative: false }, { name: "Grant", change: 10, transactionCode: "A", isDerivative: false }] };
  }
  if (u.host === "translate.googleapis.com" && flags.failGoogle) return { __status: 429 };
  if (u.host === "api.mymemory.translated.net") {
    const q = u.searchParams.get("q");
    return { responseStatus: 200, responseData: { translatedText: q === "Apple beats estimates" ? "Apple превзошла оценки" : "перевод: " + q } };
  }
  if ((u.host === "data-api.binance.vision" || u.host.endsWith("binance.com")) && flags.failBinance) return { __status: 451 };
  if (u.host === "min-api.cryptocompare.com") {
    if (p.includes("pricemultifull")) return { RAW: { BTC: { USD: { PRICE: 81700, CHANGEPCT24HOUR: -2.1, HIGH24HOUR: 84000, LOW24HOUR: 80000 } } } };
    if (p.includes("histoday")) return { Data: { Data: closes.map((c, i) => ({ time: 1700000000 + i * 86400, open: c, high: c + 1, low: c - 1, close: c, volumeto: 5 })) } };
  }
  if (u.host === "translate.googleapis.com") {
    const q = u.searchParams.get("q");
    return [[[q.replace("Apple beats estimates", "Apple превзошла прогнозы").replace("iPhone sales jump", "Продажи iPhone выросли"), q]]];
  }
  if (u.host === "data-api.binance.vision") {
    if (p.endsWith("/ticker/24hr")) return [{ symbol: "BTCUSDT", lastPrice: "81800.5", priceChangePercent: "-1.95", highPrice: "84000", lowPrice: "80000" }];
    if (p.endsWith("/klines")) return closes.map((c, i) => [1700000000000 + i * 864e5, String(c), String(c + 1), String(c - 1), String(c), "10"]);
  }
  if (u.host === "iss.moex.com") {
    if (p.includes("/candles.json")) {
      return { candles: { columns: ["open", "close", "high", "low", "value", "volume", "begin", "end"],
        data: closes.slice(0, 120).map((c, i) => [c, c, c + 1, c - 1, 0, 100, `2026-0${1 + Math.floor(i / 30)}-${String(1 + (i % 28)).padStart(2, "0")} 00:00:00`, ""]) } };
    }
    if (p.includes("/securities/SBER.json")) {
      const ru = u.searchParams.get("lang") === "ru";
      return { description: { columns: ["name", "title", "value"], data: [["SECID", "", "SBER"], ["NAME", "", ru ? "Сбербанк России ПАО ао" : "Sberbank of Russia PJSC"],
        ["ISIN", "", "RU0009029540"], ["ISSUESIZE", "", "21586948000"], ["TYPENAME", "", ru ? "Акция обыкновенная" : "Ordinary share"]] } };
    }
    if (p.includes("/markets/index/securities/IMOEX.json")) return { marketdata: { columns: ["SECID", "CURRENTVALUE", "LASTVALUE", "LASTCHANGEPRC"], data: [["IMOEX", 2741.5, 2741.5, 0.8]] } };
    if (p.includes("/securities.json")) return { securities: { columns: ["SECID", "SHORTNAME", "PREVPRICE", "LOTSIZE"], data: [["SBER", "Сбербанк", 287.16, 1]] },
      marketdata: { columns: ["SECID", "LAST", "LASTTOPREVPRICE", "HIGH", "LOW", "OPEN"], data: [["SBER", 285.52, -0.57, 290, 284, 288]] } };
  }
  if ((u.host === "query1.finance.yahoo.com" || u.host === "query2.finance.yahoo.com") && p.includes("/spark")) {
    if (flags.failSpark) return { __status: 401 };
    const syms = (u.searchParams.get("symbols") || "").split(",");
    const px = { "^GSPC": 7730, "^GDAXI": 24100, "GC=F": 4020, "EURUSD=X": 1.1612, "^TNX": 4.12 };
    if (p.startsWith("/v7")) return { spark: { result: syms.filter((s) => px[s]).map((s) => ({ symbol: s, response: [{ meta: { regularMarketPrice: px[s], chartPreviousClose: px[s] / 1.01 } }] })), error: null } };
    return Object.fromEntries(syms.filter((s) => px[s]).map((s) => [s, { symbol: s, close: [px[s]], chartPreviousClose: px[s] / 1.01 }]));
  }
  if (u.host === "query1.finance.yahoo.com") {
    if (flags.failYahoo) return { __status: 429 };
    const t0 = 1760000000;
    return { chart: { result: [{ meta: { currency: "USD", longName: "Apple Inc.", regularMarketPrice: closes[closes.length - 1] },
      timestamp: closes.map((_, i) => t0 + i * 86400), indicators: { quote: [{ open: closes, high: closes.map((c) => c + 2), low: closes.map((c) => c - 2), close: closes, volume: closes.map(() => 1000) }] } }] } };
  }
  if (u.host === "quickchart.io") return { success: true, url: "https://quickchart.io/chart/render/zf-test" };
  if (u.host === "api.coingecko.com") return { bitcoin: { usd: 81800, usd_24h_change: -1.9 } };
  throw new Error("unexpected request: " + url);
}

export function installMocks() {
  globalThis.fetch = async (url, init) => {
  url = String(url);
  calls.push(url);
  const body = route(url, init);
  const status = body && body.__status ? body.__status : 200;
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
}

export class KV {
  constructor() { this.m = new Map(); this.puts = 0; }
  async get(k) { return this.m.has(k) ? this.m.get(k).v : null; }
  async getWithMetadata(k) { return this.m.has(k) ? { value: this.m.get(k).v, metadata: this.m.get(k).meta || null } : { value: null, metadata: null }; }
  async put(k, v, o = {}) { this.puts++; this.m.set(k, { v: String(v), meta: o.metadata }); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = "" } = {}) { return { keys: [...this.m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: this.m.get(name).meta })), list_complete: true }; }
}

