// Quotes, price history and company data. API keys live only here, on the server.
//   US stocks:    Finnhub (free key) — quote, profile, ratios, analysts, earnings, company news
//   World:        Yahoo Finance (no key) — indices, currencies, commodities, yields
//   History:      Yahoo Finance; crypto — Binance / Yahoo / Coinbase; Russia — Moscow Exchange (ISS)
//   Financials:   docs/fin/<TICKER>.json, built by the news bot from SEC filings (~100 largest companies)
import { cached, dm, getJSON, pageJSON, siteData } from "./lib.js";

const FH = "https://finnhub.io/api/v1";
const BINANCE = "https://data-api.binance.vision/api/v3";
const ISS = "https://iss.moex.com/iss";
const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/";

export const COINS = {
  BTC: "bitcoin", ETH: "ethereum", BNB: "binancecoin", SOL: "solana", XRP: "ripple", DOGE: "dogecoin",
  TON: "the-open-network", ADA: "cardano", TRX: "tron", AVAX: "avalanche-2", LINK: "chainlink", DOT: "polkadot",
  LTC: "litecoin", SUI: "sui", NEAR: "near", UNI: "uniswap",
};

// instruments of the bot's data: id in data.json (kept as is for compatibility) → [Yahoo symbol, English name, Russian name]
export const MKT = {
  "S&P": ["^GSPC", "S&P 500", "S&P 500"], "Nasdaq": ["^IXIC", "Nasdaq", "Nasdaq"], "DJI": ["^DJI", "Dow Jones", "Dow Jones"],
  "RTY": ["^RUT", "Russell 2000", "Russell 2000"], "VIX": ["^VIX", "VIX", "VIX"], "SX5E": ["^STOXX50E", "Euro Stoxx 50", "Euro Stoxx 50"],
  "DAX": ["^GDAXI", "DAX", "DAX"], "UKX": ["^FTSE", "FTSE 100", "FTSE 100"], "CAC": ["^FCHI", "CAC 40", "CAC 40"],
  "NKY": ["^N225", "Nikkei 225", "Nikkei 225"], "HSI": ["^HSI", "Hang Seng", "Hang Seng"],
  "SHCOMP": ["000001.SS", "Shanghai Composite", "Шанхай"], "SENSEX": ["^BSESN", "Sensex", "Sensex"],
  "IMOEX": [null, "MOEX Russia index", "Индекс Мосбиржи"], "DXY": ["DX-Y.NYB", "US Dollar Index", "Индекс доллара"],
  "EUR/USD": ["EURUSD=X", "EUR/USD", "EUR/USD"], "USDJPY": ["JPY=X", "USD/JPY", "USD/JPY"], "GBPUSD": ["GBPUSD=X", "GBP/USD", "GBP/USD"],
  "USDCNY": ["CNY=X", "USD/CNY", "USD/CNY"], "USDCHF": ["CHF=X", "USD/CHF", "USD/CHF"], "USD/RUB": ["RUB=X", "USD/RUB", "USD/RUB"],
  "CNY/RUB": ["CNYRUB=X", "CNY/RUB", "CNY/RUB"], "Brent": ["BZ=F", "Brent crude", "Нефть Brent"], "WTI": ["CL=F", "WTI crude", "Нефть WTI"],
  "Газ": ["NG=F", "Natural gas", "Газ"], "Золото": ["GC=F", "Gold", "Золото"], "Серебро": ["SI=F", "Silver", "Серебро"],
  "Платина": ["PL=F", "Platinum", "Платина"], "Медь": ["HG=F", "Copper", "Медь"], "Пшеница": ["ZW=F", "Wheat", "Пшеница"],
  "UST3M": ["^IRX", "UST 3M", "UST 3M"], "UST5": ["^FVX", "UST 5Y", "UST 5Y"], "UST10": ["^TNX", "UST 10Y", "UST 10Y"],
  "UST30": ["^TYX", "UST 30Y", "UST 30Y"],
};
export const mktName = (id, lang) => (MKT[id] ? MKT[id][lang === "ru" ? 2 : 1] : id);
const MKT_ALIAS = {
  SPX: "S&P", SP500: "S&P", "S&P500": "S&P", "S&P": "S&P", NDX: "Nasdaq", NASDAQ: "Nasdaq", DOW: "DJI", DJI: "DJI",
  RUSSELL: "RTY", RTY: "RTY", VIX: "VIX", STOXX: "SX5E", SX5E: "SX5E", DAX: "DAX", FTSE: "UKX", UKX: "UKX", CAC: "CAC",
  NIKKEI: "NKY", NKY: "NKY", HSI: "HSI", HANGSENG: "HSI", SHCOMP: "SHCOMP", SENSEX: "SENSEX", IMOEX: "IMOEX",
  "МОСБИРЖА": "IMOEX", DXY: "DXY", EURUSD: "EUR/USD", "EUR/USD": "EUR/USD", EUR: "EUR/USD", USDJPY: "USDJPY", JPY: "USDJPY",
  GBPUSD: "GBPUSD", GBP: "GBPUSD", USDCNY: "USDCNY", CNY: "USDCNY", USDCHF: "USDCHF", USDRUB: "USD/RUB", "USD/RUB": "USD/RUB",
  RUB: "USD/RUB", "РУБЛЬ": "USD/RUB", "ДОЛЛАР": "USD/RUB", CNYRUB: "CNY/RUB", "CNY/RUB": "CNY/RUB", "ЮАНЬ": "CNY/RUB",
  BRENT: "Brent", "НЕФТЬ": "Brent", OIL: "Brent", WTI: "WTI", GAS: "Газ", NATGAS: "Газ", "ГАЗ": "Газ", GOLD: "Золото",
  "ЗОЛОТО": "Золото", XAU: "Золото", SILVER: "Серебро", "СЕРЕБРО": "Серебро", XAG: "Серебро", PLATINUM: "Платина",
  "ПЛАТИНА": "Платина", COPPER: "Медь", "МЕДЬ": "Медь", WHEAT: "Пшеница", "ПШЕНИЦА": "Пшеница",
  US3M: "UST3M", UST3M: "UST3M", US5Y: "UST5", UST5: "UST5", US10Y: "UST10", UST10: "UST10", US30Y: "UST30", UST30: "UST30",
};
// popular Moscow Exchange shares: can be typed without the MOEX: prefix
const MOEX_COMMON = new Set(["SBER", "SBERP", "GAZP", "LKOH", "ROSN", "NVTK", "GMKN", "YDEX", "VTBR", "TATN", "TATNP", "PLZL",
  "MGNT", "MTSS", "AFLT", "CHMF", "NLMK", "ALRS", "OZON", "IRAO", "MOEX", "PHOR", "RUAL", "SNGS", "SNGSP", "PIKK", "MAGN",
  "AFKS", "HYDR", "FEES", "RTKM", "TRNFP", "X5", "T", "SMLT", "POSI", "HEAD", "BSPB", "CBOM", "UPRO", "SVCB", "ASTR"]);
const US_ONLY = new Set(["T"]);   // same as AT&T: T-Technologies on the Moscow Exchange only with the MOEX: prefix

// What the person typed: "AAPL", "aapl us equity", "NASDAQ:AAPL", "MOEX:SBER", "BTC", "oil", "нефть"
export function parseSymbol(raw) {
  let s = String(raw || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!s) return null;
  s = s.replace(/\s+(US\s+)?(EQUITY|EQ)$/, "").replace(/\s+US$/, "").trim();
  let m = /^(?:MOEX|MCX)[:\s](.+)$/.exec(s);
  if (m) return { kind: "moex", s: m[1].trim(), key: "MOEX:" + m[1].trim() };
  m = /^(?:BINANCE:)?([A-Z0-9]{2,10})(?:USDT|\/USDT|-USD)$/.exec(s);
  if (m && COINS[m[1]]) return { kind: "crypto", s: m[1], key: m[1] };
  if (COINS[s]) return { kind: "crypto", s, key: s };
  if (MKT_ALIAS[s]) return { kind: "mkt", s: MKT_ALIAS[s], key: MKT_ALIAS[s] };
  if (MKT[raw]) return { kind: "mkt", s: raw, key: raw };
  m = /^(?:NASDAQ|NYSE|AMEX|NYSEARCA|ARCA|BATS):(.+)$/.exec(s);
  if (m) s = m[1];
  s = s.replace("-", ".").replace(/\s/g, "");
  if (MOEX_COMMON.has(s) && !US_ONLY.has(s)) return { kind: "moex", s, key: "MOEX:" + s };
  if (/^[A-Z][A-Z0-9]{0,6}(\.[A-Z])?$/.test(s)) return { kind: "us", s, key: s };
  return null;
}

const fhUrl = (env, path) => FH + path + (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(env.FINNHUB_API_KEY || "");

export async function fh(env, path, ttl) {
  if (!env.FINNHUB_API_KEY) throw new Error("no Finnhub key");
  return cached("fh:" + path, ttl, () => getJSON(fhUrl(env, path), { ttl: Math.min(ttl, 3600) }));
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------
async function usQuote(env, s) {
  const x = await fh(env, "/quote?symbol=" + encodeURIComponent(s), 20);
  if (!x || !x.c) return null;
  return { px: x.c, ch: x.dp, prev: x.pc, h: x.h, l: x.l, o: x.o, t: x.t, cur: "$", src: "finnhub" };
}

const BINANCE_HOSTS = [BINANCE, "https://api.binance.com/api/v3", "https://api1.binance.com/api/v3"];

async function cryptoQuotes(syms) {
  const list = "[" + syms.map((s) => '"' + s + 'USDT"').join(",") + "]";
  const errors = [];
  for (const host of BINANCE_HOSTS) {
    try {
      const arr = await cached("bn:" + host + syms.join(","), 15, () => getJSON(host + "/ticker/24hr?symbols=" + encodeURIComponent(list), { timeout: 6000 }));
      const out = {};
      for (const x of arr) out[x.symbol.replace(/USDT$/, "")] = { px: +x.lastPrice, ch: +x.priceChangePercent, h: +x.highPrice, l: +x.lowPrice, cur: "$", src: "binance" };
      if (Object.keys(out).length) return out;
    } catch (e) { errors.push(String(e.message || e)); }
  }
  try {
    const d = await cached("cc:" + syms.join(","), 30, () => getJSON("https://min-api.cryptocompare.com/data/pricemultifull?fsyms=" + syms.join(",") + "&tsyms=USD", { timeout: 6000 }));
    const raw = (d && d.RAW) || {};
    const out = {};
    for (const s of syms) { const x = raw[s] && raw[s].USD; if (x && x.PRICE) out[s] = { px: x.PRICE, ch: x.CHANGEPCT24HOUR, h: x.HIGH24HOUR, l: x.LOW24HOUR, cur: "$", src: "cryptocompare" }; }
    if (Object.keys(out).length) return out;
    errors.push("CryptoCompare: no data");
  } catch (e) { errors.push("CryptoCompare " + String(e.message || e)); }
  try {
    const out = {};
    await Promise.all(syms.slice(0, 10).map(async (s) => {
      const d = await cached("yq:" + s, 30, () => getJSON(YAHOO + s + "-USD?range=1d&interval=5m", { timeout: 6000 }));
      const m = d.chart.result[0].meta;
      const prev = m.chartPreviousClose || m.previousClose;
      if (m.regularMarketPrice) out[s] = { px: m.regularMarketPrice, ch: prev ? (m.regularMarketPrice / prev - 1) * 100 : null, cur: "$", src: "yahoo" };
    }));
    if (Object.keys(out).length) return out;
  } catch (e) { errors.push("Yahoo " + String(e.message || e)); }
  try {
    const ids = syms.map((s) => COINS[s]).join(",");
    const d = await cached("cg:" + ids, 60, () => getJSON("https://api.coingecko.com/api/v3/simple/price?ids=" + ids + "&vs_currencies=usd&include_24hr_change=true"));
    const out = {};
    for (const s of syms) { const x = d[COINS[s]]; if (x) out[s] = { px: x.usd, ch: x.usd_24h_change, cur: "$", src: "coingecko" }; }
    return out;
  } catch (e) {
    errors.push(String(e.message || e));
    throw new Error("crypto: " + errors.join("; "));
  }
}

async function moexQuotes(syms) {
  const url = ISS + "/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=securities,marketdata" +
    "&securities=" + syms.join(",") + "&securities.columns=SECID,SHORTNAME,PREVPRICE,LOTSIZE" +
    "&marketdata.columns=SECID,LAST,LASTTOPREVPRICE,HIGH,LOW,OPEN";
  const d = await cached("iss:" + syms.join(","), 20, () => getJSON(url));
  const names = {}, out = {};
  const sc = d.securities.columns, md = d.marketdata.columns;
  for (const r of d.securities.data) names[r[sc.indexOf("SECID")]] = { n: r[sc.indexOf("SHORTNAME")], prev: r[sc.indexOf("PREVPRICE")], lot: r[sc.indexOf("LOTSIZE")] };
  for (const r of d.marketdata.data) {
    const s = r[md.indexOf("SECID")], meta = names[s] || {};
    const last = r[md.indexOf("LAST")] || meta.prev;
    if (!last) continue;
    let ch = r[md.indexOf("LASTTOPREVPRICE")];
    if (ch == null && meta.prev && last) ch = (last / meta.prev - 1) * 100;
    out[s] = { px: last, ch, name: meta.n, lot: meta.lot, cur: "₽", src: "moex", h: r[md.indexOf("HIGH")], l: r[md.indexOf("LOW")] };
  }
  return out;
}

// { input: {key, kind, name, name_ru, px, ch, cur, src} } — up to 40 instruments at a time
export async function getQuotes(env, inputs) {
  const parsed = [];
  const seen = new Set();
  for (const raw of inputs) {
    const p = parseSymbol(raw);
    if (!p || seen.has(p.key)) continue;
    seen.add(p.key);
    parsed.push({ raw, ...p });
    if (parsed.length >= 40) break;
  }
  const out = {};
  const by = (k) => parsed.filter((p) => p.kind === k);
  const jobs = [];
  for (const p of by("us").slice(0, 25)) {
    jobs.push(usQuote(env, p.s).then((q) => { if (q) out[p.key] = { key: p.key, kind: "us", name: p.s, ...q }; })
      .catch((e) => { out[p.key] = { key: p.key, kind: "us", error: String(e.message || e) }; }));
  }
  const fail = (list, kind) => (e) => { for (const p of list) out[p.key] = { key: p.key, kind, error: String(e.message || e) }; };
  const cr = by("crypto");
  if (cr.length) jobs.push(cryptoQuotes(cr.map((p) => p.s)).then((m) => {
    for (const p of cr) if (m[p.s]) out[p.key] = { key: p.key, kind: "crypto", name: p.s + "/USDT", ...m[p.s] };
  }).catch(fail(cr, "crypto")));
  const mo = by("moex");
  if (mo.length) jobs.push(moexQuotes(mo.map((p) => p.s)).then((m) => {
    for (const p of mo) if (m[p.s]) out[p.key] = { key: p.key, kind: "moex", ...m[p.s], name: m[p.s].name || p.s };
  }).catch(fail(mo, "moex")));
  const mk = by("mkt");
  if (mk.length) jobs.push(siteData(env).then((d) => {
    const ids = {};
    for (const q of d.market || []) ids[q.id] = q;
    for (const p of mk) {
      const q = ids[p.s];
      if (q) out[p.key] = { key: p.key, kind: "mkt", name: (MKT[p.s] || [])[1] || q.name_en || q.name, name_ru: (MKT[p.s] || [])[2] || q.name,
        px: q.value, ch: q.change, cur: "", src: "bot", digits: q.digits };
    }
  }).catch(() => {}));
  await Promise.all(jobs);
  return out;
}

// ---------------------------------------------------------------------------
// World markets for the terminal: indices, currencies, commodities, yields — Yahoo Finance, free, no key.
// One "spark" request per 20 symbols instead of one per symbol. USD/RUB and CNY/RUB are left to the
// Bank of Russia rates from the news bot (Yahoo's ruble quotes are unreliable); IMOEX comes from the Moscow Exchange.
// ---------------------------------------------------------------------------
export const WORLD = ["S&P", "Nasdaq", "DJI", "RTY", "VIX", "SX5E", "DAX", "UKX", "CAC", "NKY", "HSI", "SHCOMP", "SENSEX", "DXY",
  "EUR/USD", "USDJPY", "GBPUSD", "USDCNY", "USDCHF", "Brent", "WTI", "Газ", "Золото", "Серебро", "Платина", "Медь", "Пшеница",
  "UST3M", "UST5", "UST10", "UST30"];

function sparkRows(d) {
  // v7: {spark: {result: [{symbol, response: [{meta}]}]}} · v8: {"^GSPC": {symbol, close: [...], chartPreviousClose}}
  const out = {};
  if (d && d.spark && Array.isArray(d.spark.result)) {
    for (const r of d.spark.result) {
      const m = r && r.response && r.response[0] && r.response[0].meta;
      if (m && m.regularMarketPrice != null) out[r.symbol] = { px: m.regularMarketPrice, prev: m.chartPreviousClose ?? m.previousClose };
    }
  } else if (d && typeof d === "object") {
    for (const [sym, r] of Object.entries(d)) {
      const close = ((r && r.close) || []).filter((x) => x != null);
      if (close.length) out[sym] = { px: close[close.length - 1], prev: r.chartPreviousClose ?? r.previousClose };
    }
  }
  return out;
}

async function yahooSpark(symbols) {
  const out = {};
  const errors = [];
  for (let i = 0; i < symbols.length; i += 20) {
    const part = symbols.slice(i, i + 20).map(encodeURIComponent).join(",");
    let got = null;
    for (const url of ["https://query1.finance.yahoo.com/v7/finance/spark?range=1d&interval=1d&symbols=",
      "https://query2.finance.yahoo.com/v8/finance/spark?range=1d&interval=1d&symbols="]) {
      try {
        got = sparkRows(await getJSON(url + part, { timeout: 6000 }));
        if (Object.keys(got).length) break;
      } catch (e) { errors.push(String(e.message || e)); }
    }
    Object.assign(out, got || {});
  }
  if (!Object.keys(out).length) throw new Error("Yahoo: " + (errors[0] || "no data"));
  return out;
}

async function imoexLive() {
  const d = await getJSON(ISS + "/engines/stock/markets/index/securities/IMOEX.json?iss.meta=off&iss.only=marketdata" +
    "&marketdata.columns=SECID,CURRENTVALUE,LASTVALUE,LASTCHANGEPRC", { timeout: 6000 });
  const c = d.marketdata.columns, r = d.marketdata.data[0] || [];
  const v = r[c.indexOf("CURRENTVALUE")] || r[c.indexOf("LASTVALUE")];
  return v ? { value: v, change: r[c.indexOf("LASTCHANGEPRC")] } : null;
}

// { id: {value, change} } for the terminal; refreshed at most every `ttl` seconds for all viewers together
export async function worldQuotes(ttl = 30) {
  return cached("world", ttl, async () => {
    const sym = {};
    for (const id of WORLD) sym[MKT[id][0]] = id;
    const [y, imoex] = await Promise.all([yahooSpark(Object.keys(sym)), imoexLive().catch(() => null)]);
    const out = {};
    for (const [s, x] of Object.entries(y)) {
      if (!sym[s] || !(x.px > 0)) continue;
      out[sym[s]] = { value: x.px, change: x.prev ? (x.px / x.prev - 1) * 100 : null };
    }
    if (imoex) out.IMOEX = imoex;
    return out;
  });
}

// ---------------------------------------------------------------------------
// Price history (daily candles)
// ---------------------------------------------------------------------------
const RANGES = { "1d": 1, "5d": 5, "1m": 31, "3m": 92, "6m": 183, "1y": 366, "2y": 731, "5y": 1827, "ytd": 0 };
const INTRADAY = { "1d": true, "5d": true };   // 5-30 minute bars

export function normRange(r) {
  r = String(r || "1y").toLowerCase().replace("мес", "m").replace("г", "y").replace("л", "y").replace("д", "d");
  return RANGES[r] != null ? r : "1y";
}

function sinceDays(range) {
  if (range === "ytd") {
    const now = new Date();
    return Math.ceil((now - new Date(Date.UTC(now.getUTCFullYear(), 0, 1))) / 864e5) + 1;
  }
  return RANGES[range];
}

async function yahooHistory(sym, range) {
  const interval = { "1d": "5m", "5d": "30m", "5y": "1wk" }[range] || "1d";
  const d = await getJSON(YAHOO + encodeURIComponent(sym) + "?range=" + range.replace("m", "mo") + "&interval=" + interval + "&includePrePost=false",
    { ttl: INTRADAY[range] ? 120 : 1800 });
  const r = d && d.chart && d.chart.result && d.chart.result[0];
  if (!r || !r.timestamp) throw new Error("Yahoo: no data");
  const q = r.indicators.quote[0];
  const out = { t: [], o: [], h: [], l: [], c: [], v: [], cur: r.meta.currency, name: r.meta.longName || r.meta.shortName || sym };
  r.timestamp.forEach((t, i) => {
    if (q.close[i] == null) return;
    out.t.push(t); out.o.push(q.open[i]); out.h.push(q.high[i]); out.l.push(q.low[i]); out.c.push(q.close[i]); out.v.push(q.volume[i]);
  });
  return out;
}

async function binanceHistory(coin, range) {
  const days = sinceDays(range);
  const interval = range === "1d" ? "5m" : range === "5d" ? "30m" : days > 900 ? "1w" : "1d";
  const limit = range === "1d" ? 288 : range === "5d" ? 240 : Math.min(1000, interval === "1w" ? Math.ceil(days / 7) + 1 : days);
  let k = null, err = null;
  for (const host of BINANCE_HOSTS) {
    try { k = await getJSON(host + "/klines?symbol=" + coin + "USDT&interval=" + interval + "&limit=" + limit, { ttl: INTRADAY[range] ? 60 : 900, timeout: 8000 }); break; }
    catch (e) { err = e; }
  }
  if (!k) {
    // Binance blocks some Cloudflare servers: Yahoo (one request for any range), then Coinbase (rate-limited on shared IPs)
    try { return { ...(await yahooHistory(coin + "-USD", range)), name: coin + "/USD", src2: "yahoo" }; } catch (e) { err = new Error((err ? err.message + "; " : "") + "Yahoo: " + (e.message || e)); }
    try { return await coinbaseHistory(coin, range); } catch (e) { throw new Error(err.message + "; Coinbase: " + (e.message || e)); }
  }
  const out = { t: [], o: [], h: [], l: [], c: [], v: [], cur: "USD", name: coin + "/USDT" };
  for (const x of k) { out.t.push(Math.floor(x[0] / 1000)); out.o.push(+x[1]); out.h.push(+x[2]); out.l.push(+x[3]); out.c.push(+x[4]); out.v.push(+x[5]); }
  return out;
}

// Coinbase Exchange candles: [time, low, high, open, close, volume], newest first, at most 300 per request
async function coinbaseHistory(coin, range) {
  const days = sinceDays(range);
  const gran = range === "1d" ? 300 : range === "5d" ? 3600 : 86400;
  const end = Math.floor(Date.now() / 1000), start = end - days * 86400;
  const step = gran * 300;
  const rows = [];
  for (let to = end; to > start && rows.length < 2000; to -= step) {
    const from = Math.max(start, to - step);
    const part = await getJSON("https://api.exchange.coinbase.com/products/" + coin + "-USD/candles?granularity=" + gran +
      "&start=" + new Date(from * 1000).toISOString() + "&end=" + new Date(to * 1000).toISOString(), { ttl: INTRADAY[range] ? 60 : 900, timeout: 8000 });
    if (!Array.isArray(part) || !part.length) break;
    rows.push(...part);
  }
  if (!rows.length) throw new Error("no history for " + coin);
  const seen = new Set();
  const sorted = rows.filter((x) => !seen.has(x[0]) && seen.add(x[0])).sort((a, b) => a[0] - b[0]);
  const weekly = days > 900;   // like Binance: weekly points for five years
  const out = { t: [], o: [], h: [], l: [], c: [], v: [], cur: "USD", name: coin + "/USD", src2: "coinbase" };
  sorted.forEach((x, i) => {
    if (weekly && (sorted.length - 1 - i) % 7) return;
    out.t.push(x[0]); out.l.push(x[1]); out.h.push(x[2]); out.o.push(x[3]); out.c.push(x[4]); out.v.push(x[5]);
  });
  return out;
}

async function moexHistory(s, range, isIndex) {
  const days = sinceDays(range);
  const interval = range === "1d" ? 10 : range === "5d" ? 60 : days > 900 ? 7 : 24;
  // intraday: from a few days back (weekends), then keep the last trading day / five days
  const from = new Date(Date.now() - (INTRADAY[range] ? days * 2 + 3 : days) * 864e5).toISOString().slice(0, 10);
  const path = isIndex ? "/engines/stock/markets/index/securities/" : "/engines/stock/markets/shares/boards/TQBR/securities/";
  const out = { t: [], o: [], h: [], l: [], c: [], v: [], cur: isIndex ? "" : "RUB", name: s };
  for (let start = 0; start < 3000; start += 500) {
    const d = await getJSON(ISS + path + s + "/candles.json?iss.meta=off&interval=" + interval + "&from=" + from + "&start=" + start, { ttl: 1800 });
    const cols = d.candles.columns, rows = d.candles.data;
    for (const r of rows) {
      out.t.push(Math.floor(Date.parse(r[cols.indexOf("begin")].replace(" ", "T") + "+03:00") / 1000));
      out.o.push(r[cols.indexOf("open")]); out.h.push(r[cols.indexOf("high")]); out.l.push(r[cols.indexOf("low")]);
      out.c.push(r[cols.indexOf("close")]); out.v.push(r[cols.indexOf("volume")]);
    }
    if (rows.length < 500) break;
  }
  if (INTRADAY[range] && out.t.length) {
    const daysSeen = [...new Set(out.t.map((t) => new Date((t + 3 * 3600) * 1000).toISOString().slice(0, 10)))];
    const keep = daysSeen.slice(-days)[0];
    const i = out.t.findIndex((t) => new Date((t + 3 * 3600) * 1000).toISOString().slice(0, 10) >= keep);
    for (const k of ["t", "o", "h", "l", "c", "v"]) out[k] = out[k].slice(i);
  }
  return out;
}

export async function getHistory(env, raw, range) {
  const p = parseSymbol(raw);
  if (!p) throw new Error("unknown instrument: " + raw);
  range = normRange(range);
  return cached("hist:" + p.key + ":" + range, INTRADAY[range] ? 120 : 1800, async () => {
    let h;
    if (p.kind === "crypto") { const b = await binanceHistory(p.s, range); h = { ...b, src: b.src2 || "binance" }; delete h.src2; }
    else if (p.kind === "moex") h = { ...(await moexHistory(p.s, range, false)), src: "moex" };
    else if (p.kind === "mkt" && p.s === "IMOEX") h = { ...(await moexHistory("IMOEX", range, true)), src: "moex" };
    else if (p.kind === "mkt") h = { ...(await yahooHistory(MKT[p.s][0], range)), name: MKT[p.s][1], name_ru: MKT[p.s][2], src: "yahoo" };
    else h = { ...(await yahooHistory(p.s.replace(".", "-"), range)), src: "yahoo" };
    if (range === "ytd" && p.kind === "crypto") {
      const jan1 = Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000;
      const i = h.t.findIndex((t) => t >= jan1);
      if (i > 0) for (const k of ["t", "o", "h", "l", "c", "v"]) h[k] = h[k].slice(i);
    }
    if (!h.c.length) throw new Error("no history for " + raw);
    return { ok: true, s: p.key, kind: p.kind, range, ...h };
  });
}

// ---------------------------------------------------------------------------
// Company (US stocks): DES, FA, ERN, ANR, CN, HDS
// ---------------------------------------------------------------------------
const DAY = 86400;

function num(x, d) {
  const v = Number(x);
  if (x == null || !isFinite(v)) return null;
  return d == null ? v : Math.round(v * 10 ** d) / 10 ** d;
}

function seriesRows(series, keys) {
  // { eps: [{period, v}], ... } → [{end, eps, ...}], newest first
  const by = {};
  for (const k of keys) for (const x of (series && series[k]) || []) {
    (by[x.period] = by[x.period] || { end: x.period })[k] = num(x.v, 4);
  }
  return Object.values(by).sort((a, b) => (a.end < b.end ? 1 : -1));
}

const FA_KEYS = ["eps", "salesPerShare", "grossMargin", "operatingMargin", "netMargin", "roe", "totalDebtToEquity", "fcfMargin"];

// Headlines are translated one by one (in parallel): joined together, the translator sometimes loses line breaks.
// Google first, MyMemory if Google blocks the server; if both fail the original stays.
// Only the Russian bot needs this: the terminal translates in the browser.
export const translateState = { errors: [] };

async function translateOne(line) {
  return cached("tr:" + line, 86400, async () => {
    let err;
    try {
      const d = await getJSON("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t&q=" + encodeURIComponent(line),
        { ttl: 86400, timeout: 5000 });
      const text = (d[0] || []).map((seg) => seg[0] || "").join("").trim();
      if (text) return text;
    } catch (e) { err = "Google " + (e.status || e.message); }
    try {
      const d = await getJSON("https://api.mymemory.translated.net/get?langpair=en|ru&q=" + encodeURIComponent(line.slice(0, 480)), { ttl: 86400, timeout: 5000 });
      const text = ((d && d.responseData && d.responseData.translatedText) || "").trim();
      if (text && !/MYMEMORY WARNING/i.test(text) && String(d.responseStatus) === "200") return text.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
      err = (err ? err + ", " : "") + "MyMemory " + (d && d.responseStatus);
    } catch (e) { err = (err ? err + ", " : "") + "MyMemory " + (e.status || e.message); }
    throw new Error(err || "translation unavailable");
  });
}

async function translateLines(lines) {
  return Promise.all(lines.map((l) => translateOne(l.replace(/\s+/g, " ").trim()).catch((e) => {
    if (translateState.errors.length < 3) translateState.errors.push(String(e.message || e));
    return l;
  })));
}

// des fa ern anr cn hds — live (Finnhub); co — the deep file docs/co/<T>.json (profile, management, estimates,
// price targets, rating changes, holders, short interest, dividends, filings; built by company.py);
// dvd, cf — dividends and filings (from co, or live when the company has no file); opt — option snapshot
// docs/opt/<T>.json (options.py) or the Cboe IV30; rv — the company against its peers (docs/stocks.json)
export const COMPANY_PARTS = ["des", "fa", "ern", "anr", "cn", "hds", "co", "dvd", "cf", "opt", "rv"];
const notFound = (e) => { if (!/HTTP 404/.test(String(e.message))) throw e; };   // no file for this company — fine

export async function getCompany(env, raw, parts = COMPANY_PARTS, lang = "en") {
  const p = parseSymbol(raw);
  if (!p) throw new Error("unknown ticker: " + raw);
  if (p.kind === "moex") return moexCompany(p.s, lang);
  if (p.kind !== "us") throw new Error("company data is available for stocks only (US and Moscow Exchange)");
  const s = encodeURIComponent(p.s);
  const want = new Set(parts);
  const today = new Date().toISOString().slice(0, 10);
  const later = new Date(Date.now() + 120 * DAY * 1000).toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 10 * DAY * 1000).toISOString().slice(0, 10);
  const res = { ok: true, s: p.s, kind: "us", errors: [] };
  const jobs = [];
  const safe = (name, pr) => jobs.push(pr.catch((e) => { res.errors.push(name + ": " + (e.message || e)); }));

  if (want.has("des") || want.has("fa")) {
    safe("profile", fh(env, "/stock/profile2?symbol=" + s, 6 * 3600).then((x) => {
      if (!x || !x.name) throw new Error("company not found");
      res.profile = { name: x.name, exch: x.exchange, country: x.country, cur: x.currency, ipo: x.ipo, web: x.weburl,
        logo: x.logo, ind: x.finnhubIndustry, mcap: num(x.marketCapitalization, 1), shares: num(x.shareOutstanding, 2) };
    }));
    safe("metric", fh(env, "/stock/metric?symbol=" + s + "&metric=all", 6 * 3600).then((x) => {
      const m = (x && x.metric) || {};
      res.m = {
        pe: num(m.peTTM ?? m.peBasicExclExtraTTM, 2), fpe: num(m.forwardPE, 2), ps: num(m.psTTM, 2), pb: num(m.pbQuarterly ?? m.pb, 2),
        evebitda: num(m.evEbitdaTTM, 2), dy: num(m.dividendYieldIndicatedAnnual, 2), div: num(m.dividendIndicatedAnnual, 3),
        beta: num(m.beta, 2), eps: num(m.epsTTM, 3), epsg: num(m.epsGrowthTTMYoy, 1), revg: num(m.revenueGrowthTTMYoy, 1),
        roe: num(m.roeTTM, 1), roa: num(m.roaTTM, 1), gm: num(m.grossMarginTTM, 1), om: num(m.operatingMarginTTM, 1),
        nm: num(m.netProfitMarginTTM, 1), de: num(m["totalDebt/totalEquityQuarterly"], 2), cr: num(m.currentRatioQuarterly, 2),
        h52: num(m["52WeekHigh"], 2), l52: num(m["52WeekLow"], 2), h52d: m["52WeekHighDate"], l52d: m["52WeekLowDate"],
        r5d: num(m["5DayPriceReturnDaily"], 2), r13w: num(m["13WeekPriceReturnDaily"], 2), r26w: num(m["26WeekPriceReturnDaily"], 2),
        r52: num(m["52WeekPriceReturnDaily"], 2), rytd: num(m.yearToDatePriceReturnDaily, 2), vol10: num(m["10DayAverageTradingVolume"], 2),
        mcap: num(m.marketCapitalization, 1),
      };
      if (want.has("fa")) {
        const ser = (x && x.series) || {};
        res.faSeries = { annual: seriesRows(ser.annual, FA_KEYS).slice(0, 6), quarterly: seriesRows(ser.quarterly, FA_KEYS).slice(0, 8) };
      }
    }));
  }
  if (want.has("des")) {
    safe("quote", usQuote(env, p.s).then((q) => { res.quote = q; }));
    safe("peers", fh(env, "/stock/peers?symbol=" + s, 24 * 3600).then((x) => { res.peers = (x || []).filter((t) => t !== p.s).slice(0, 8); }));
  }
  if (want.has("des") || want.has("anr")) {
    safe("recommendation", fh(env, "/stock/recommendation?symbol=" + s, 12 * 3600).then((x) => {
      res.anr = (x || []).slice(0, 6).map((r) => ({ period: r.period, sb: r.strongBuy, b: r.buy, h: r.hold, s: r.sell, ss: r.strongSell }));
    }));
  }
  if (want.has("des") || want.has("ern")) {
    safe("calendar", fh(env, `/calendar/earnings?from=${today}&to=${later}&symbol=${s}`, 6 * 3600).then((x) => {
      const ev = ((x && x.earningsCalendar) || []).filter((e) => e.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
      if (ev) res.next = { date: ev.date, hour: ev.hour, q: ev.quarter, y: ev.year, eps_e: num(ev.epsEstimate, 4), rev_e: num(ev.revenueEstimate, 0) };
    }));
  }
  if (want.has("ern")) {
    safe("earnings", fh(env, "/stock/earnings?symbol=" + s + "&limit=12", 6 * 3600).then((x) => {
      res.ern = (x || []).map((e) => ({ period: e.period, q: e.quarter, y: e.year, act: num(e.actual, 4), est: num(e.estimate, 4),
        sp: num(e.surprisePercent, 2) }));
    }));
  }
  if (want.has("fa")) {
    safe("fin", pageJSON(env, "fin/" + p.s + ".json", 3600).then((x) => { res.fin = x; }).catch((e) => {
      if (!/404/.test(String(e.message))) throw e;   // companies outside the list have no SEC file — that's fine
    }));
  }
  if (want.has("cn")) {
    safe("news", fh(env, `/company-news?symbol=${s}&from=${weekAgo}&to=${today}`, 900).then(async (x) => {
      const items = (x || []).filter((n) => n.headline).sort((a, b) => b.datetime - a.datetime).slice(0, 12);
      res.cn = items.map((n) => ({ t: n.datetime, h: n.headline, en: n.headline, src: n.source, url: n.url }));
      if (lang === "ru" && items.length) {
        translateState.errors = [];
        const ru = await translateLines(items.map((n) => n.headline));
        res.cn.forEach((n, i) => { n.h = ru[i] || n.en; });
        if (ru.every((x, i) => x === items[i].headline)) res.errors.push("translation: " + (translateState.errors[0] || "unavailable"));
      }
    }));
  }
  if (want.has("hds")) {
    safe("insiders", fh(env, "/stock/insider-transactions?symbol=" + s, 6 * 3600).then((x) => {
      const rows = ((x && x.data) || []).filter((t) => !t.isDerivative && ["P", "S"].includes(t.transactionCode));
      res.ins = rows.slice(0, 15).map((t) => ({ name: t.name, date: t.transactionDate, code: t.transactionCode, ch: t.change,
        sh: t.share, px: num(t.transactionPrice, 2) }));
    }));
  }
  // the deep files first; a live fallback starts right after a file turns out missing (in parallel with the rest)
  const coP = want.has("co") || want.has("dvd") || want.has("cf")
    ? pageJSON(env, "co/" + p.s + ".json", 1800).catch((e) => { notFound(e); return null; }) : Promise.resolve(null);
  safe("co", coP.then((x) => { if (x) res.co = x; }));
  if (want.has("dvd")) {
    safe("dividends", coP.then((co) => (co && co.div && co.div.hist ? null : yahooDividends(p.s).then((x) => { res.dvd = x; }))));
  }
  if (want.has("cf")) {
    const since = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);   // a year of filings keeps the answer small
    safe("filings", coP.then((co) => (co && co.filings && co.filings.length ? null :
      fh(env, "/stock/filings?symbol=" + s + "&from=" + since, 6 * 3600).then((x) => {
        res.cf = (x || []).filter((f) => f.form && f.form !== "4").slice(0, 25)
          .map((f) => ({ d: (f.filedDate || "").slice(0, 10), type: f.form, url: f.reportUrl || f.filingUrl }));
      }))));
  }
  if (want.has("opt")) {
    safe("options", pageJSON(env, "opt/" + p.s + ".json", 600).catch((e) => { notFound(e); return null; }).then((x) => {
      if (x) { res.opt = x; return null; }
      return getJSON("https://cdn.cboe.com/api/global/delayed_quotes/quotes/" + s + ".json", { ttl: 600, timeout: 6000 }).then((q) => {
        const d = (q && q.data) || {};
        if (d.iv30 != null) res.opt = { s: p.s, px: num(d.current_price, 4), chg: num(d.price_change_percent, 2), iv30: num(d.iv30, 2),
          iv30_chg: num(d.iv30_change, 2), ts: q.timestamp, lite: true };
      });
    }));
  }
  if (want.has("rv")) safe("peers", relativeValue(env, p.s).then((x) => { res.rv = x; }));
  await Promise.all(jobs);
  if (want.has("des") && !res.profile && !res.quote) {
    throw new Error(res.errors.join("; ") || "no data for " + p.s);
  }
  return res;
}

// dividends and splits from Yahoo chart events (small answer: one point a month)
async function yahooDividends(sym) {
  const d = await getJSON(YAHOO + encodeURIComponent(sym.replace(".", "-")) + "?range=15y&interval=1mo&events=div%7Csplit", { ttl: 6 * 3600 });
  const ev = ((((d && d.chart) || {}).result || [])[0] || {}).events || {};
  const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
  const hist = Object.values(ev.dividends || {}).map((x) => [day(x.date), num(x.amount, 6)]).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 80);
  const splits = Object.values(ev.splits || {}).map((x) => [day(x.date), x.splitRatio || x.numerator + ":" + x.denominator])
    .sort((a, b) => (a[0] < b[0] ? 1 : -1));
  return { hist, splits };
}

// RV: the company and its peers on the same ratios (Finnhub peers that are in docs/stocks.json; else the sector)
const RV_KEYS = ["s", "n", "sec", "px", "ch", "mcap", "pe", "fpe", "ps", "pb", "dy", "beta", "revg", "epsg", "gm", "nm", "roe", "de", "r52", "rytd"];
export async function relativeValue(env, sym) {
  const [st, peers] = await Promise.all([pageJSON(env, "stocks.json", 300),
    fh(env, "/stock/peers?symbol=" + encodeURIComponent(sym), 24 * 3600).catch(() => [])]);
  const all = (st && st.stocks) || [];
  const by = Object.fromEntries(all.map((r) => [r.s, r]));
  const me = by[sym];
  let list = (peers || []).filter((t) => t !== sym && by[t]);
  const src = list.length ? "peers" : "sector";
  if (list.length < 4 && me) {
    list = list.concat(all.filter((r) => r.sec === me.sec && r.s !== sym && !list.includes(r.s))
      .sort((a, b) => (b.mcap || 0) - (a.mcap || 0)).map((r) => r.s)).slice(0, 8);
  }
  const pick = (r) => Object.fromEntries(RV_KEYS.map((k) => [k, r[k] ?? null]));
  const rows = [me, ...list.slice(0, 8).map((t) => by[t])].filter(Boolean).map(pick);
  const med = {};
  for (const k of RV_KEYS.slice(5)) {
    const v = rows.slice(1).map((r) => r[k]).filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
    med[k] = v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
  }
  return { s: sym, in_list: !!me, src, rows, median: med, updated: st && st.updated };
}

async function moexCompany(s, lang = "en") {
  // the exchange gives descriptions in English or Russian
  const l = lang === "ru" ? "ru" : "en";
  const d = await cached("issdesc:" + l + ":" + s, 6 * 3600, () => getJSON(ISS + "/securities/" + s + ".json?iss.meta=off&iss.only=description&lang=" + l));
  const desc = {};
  const cols = d.description.columns;
  for (const r of d.description.data) desc[r[cols.indexOf("name")]] = r[cols.indexOf("value")];
  if (!desc.SECID) throw new Error("not found on the Moscow Exchange: " + s);
  const q = (await moexQuotes([s]))[s] || null;
  return { ok: true, s: "MOEX:" + s, kind: "moex", profile: { name: desc.NAME || desc.SHORTNAME, exch: l === "ru" ? "Мосбиржа" : "Moscow Exchange", country: "RU", cur: "RUB",
    isin: desc.ISIN, issue: num(desc.ISSUESIZE), lot: q && q.lot, list: desc.LISTLEVEL, type: desc.TYPENAME },
  quote: q, errors: [] };
}

// ---------------------------------------------------------------------------
// Chart picture for the bot (QuickChart — free, no key)
// ---------------------------------------------------------------------------
export async function chartImage(h, title, lang = "en") {
  const n = h.c.length;
  const step = Math.max(1, Math.ceil(n / 160));
  const labels = [], data = [];
  const intraday = INTRADAY[h.range];
  const label = (t) => (intraday ? new Date((t + 3 * 3600) * 1000).toISOString().slice(h.range === "1d" ? 11 : 5, 16).replace("T", " ")
    : dm(new Date(t * 1000).toISOString(), lang));   // intraday: Moscow time
  for (let i = 0; i < n; i += step) {
    labels.push(label(h.t[i]));
    data.push(+h.c[i].toFixed(4));
  }
  if (data[data.length - 1] !== +h.c[n - 1].toFixed(4)) { labels.push(""); data.push(+h.c[n - 1].toFixed(4)); }
  const up = h.c[n - 1] >= h.c[0];
  const color = up ? "#21c66f" : "#ff4b4b";
  const chart = {
    type: "line",
    data: { labels, datasets: [{ data, borderColor: color, backgroundColor: up ? "rgba(33,198,111,0.12)" : "rgba(255,75,75,0.12)", fill: true, pointRadius: 0, borderWidth: 2, lineTension: 0.1 }] },
    options: {
      legend: { display: false },
      title: { display: true, text: title, fontColor: "#ffa028", fontSize: 16 },
      scales: {
        xAxes: [{ ticks: { fontColor: "#8c8c8c", maxTicksLimit: 8 }, gridLines: { color: "rgba(255,255,255,0.05)" } }],
        yAxes: [{ position: "right", ticks: { fontColor: "#8c8c8c" }, gridLines: { color: "rgba(255,255,255,0.08)" } }],
      },
    },
  };
  const r = await fetch("https://quickchart.io/chart/create", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chart, width: 800, height: 420, backgroundColor: "#000000", format: "png" }),
  });
  const d = await r.json().catch(() => ({}));
  if (!d.success || !d.url) throw new Error("QuickChart: " + (d.error || r.status));
  return d.url;
}
