// Котировки, история цен и данные по компаниям. Ключи API живут только здесь.
//   Акции США:   Finnhub (бесплатный ключ) — котировка, профиль, мультипликаторы, аналитики, отчёты, новости
//   История:     Yahoo Finance (без ключа), крипта — Binance, Россия — Мосбиржа (ISS)
//   Отчётность:  docs/fin/<ТИКЕР>.json, которую основной бот собирает из SEC (для ~100 крупнейших компаний)
import { cached, getJSON, getText, pageJSON, siteData } from "./lib.js";

const FH = "https://finnhub.io/api/v1";
const BINANCE = "https://data-api.binance.vision/api/v3";
const ISS = "https://iss.moex.com/iss";
const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/";

export const COINS = {
  BTC: "bitcoin", ETH: "ethereum", BNB: "binancecoin", SOL: "solana", XRP: "ripple", DOGE: "dogecoin",
  TON: "the-open-network", ADA: "cardano", TRX: "tron", AVAX: "avalanche-2", LINK: "chainlink", DOT: "polkadot",
  LTC: "litecoin", SUI: "sui", NEAR: "near", UNI: "uniswap",
};

// инструменты из данных бота: id в data.json → символ Yahoo для истории
export const MKT = {
  "S&P": ["^GSPC", "S&P 500"], "Nasdaq": ["^IXIC", "Nasdaq"], "DJI": ["^DJI", "Dow Jones"], "RTY": ["^RUT", "Russell 2000"],
  "VIX": ["^VIX", "VIX"], "SX5E": ["^STOXX50E", "Euro Stoxx 50"], "DAX": ["^GDAXI", "DAX"], "UKX": ["^FTSE", "FTSE 100"],
  "CAC": ["^FCHI", "CAC 40"], "NKY": ["^N225", "Nikkei 225"], "HSI": ["^HSI", "Hang Seng"], "SHCOMP": ["000001.SS", "Шанхай"],
  "SENSEX": ["^BSESN", "Sensex"], "IMOEX": [null, "Индекс Мосбиржи"], "DXY": ["DX-Y.NYB", "Индекс доллара"],
  "EUR/USD": ["EURUSD=X", "EUR/USD"], "USDJPY": ["JPY=X", "USD/JPY"], "GBPUSD": ["GBPUSD=X", "GBP/USD"],
  "USDCNY": ["CNY=X", "USD/CNY"], "USDCHF": ["CHF=X", "USD/CHF"], "USD/RUB": ["RUB=X", "USD/RUB"],
  "CNY/RUB": ["CNYRUB=X", "CNY/RUB"], "Brent": ["BZ=F", "Нефть Brent"], "WTI": ["CL=F", "Нефть WTI"],
  "Газ": ["NG=F", "Газ"], "Золото": ["GC=F", "Золото"], "Серебро": ["SI=F", "Серебро"], "Платина": ["PL=F", "Платина"],
  "Медь": ["HG=F", "Медь"], "Пшеница": ["ZW=F", "Пшеница"], "UST3M": ["^IRX", "UST 3M"], "UST5": ["^FVX", "UST 5Y"],
  "UST10": ["^TNX", "UST 10Y"], "UST30": ["^TYX", "UST 30Y"],
};
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
// популярные акции Мосбиржи — их можно писать без префикса MOEX:
const MOEX_COMMON = new Set(["SBER", "SBERP", "GAZP", "LKOH", "ROSN", "NVTK", "GMKN", "YDEX", "VTBR", "TATN", "TATNP", "PLZL",
  "MGNT", "MTSS", "AFLT", "CHMF", "NLMK", "ALRS", "OZON", "IRAO", "MOEX", "PHOR", "RUAL", "SNGS", "SNGSP", "PIKK", "MAGN",
  "AFKS", "HYDR", "FEES", "RTKM", "TRNFP", "X5", "T", "SMLT", "POSI", "HEAD", "BSPB", "CBOM", "UPRO", "SVCB", "ASTR"]);
const US_ONLY = new Set(["T"]);   // совпадает с тикером AT&T: Т-Технологии на Мосбирже — только с префиксом MOEX:

// Разбор того, что ввёл человек: «AAPL», «aapl us equity», «NASDAQ:AAPL», «MOEX:SBER», «BTC», «нефть»
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
  if (!env.FINNHUB_API_KEY) throw new Error("нет ключа Finnhub");
  return cached("fh:" + path, ttl, () => getJSON(fhUrl(env, path), { ttl: Math.min(ttl, 3600) }));
}

// ---------------------------------------------------------------------------
// Котировки
// ---------------------------------------------------------------------------
async function usQuote(env, s) {
  const x = await fh(env, "/quote?symbol=" + encodeURIComponent(s), 20);
  if (!x || !x.c) return null;
  return { px: x.c, ch: x.dp, prev: x.pc, h: x.h, l: x.l, o: x.o, t: x.t, cur: "$", src: "finnhub" };
}

async function cryptoQuotes(syms) {
  const list = "[" + syms.map((s) => '"' + s + 'USDT"').join(",") + "]";
  try {
    const arr = await cached("bn:" + syms.join(","), 15, () => getJSON(BINANCE + "/ticker/24hr?symbols=" + encodeURIComponent(list), { timeout: 8000 }));
    const out = {};
    for (const x of arr) out[x.symbol.replace(/USDT$/, "")] = { px: +x.lastPrice, ch: +x.priceChangePercent, h: +x.highPrice, l: +x.lowPrice, cur: "$", src: "binance" };
    return out;
  } catch (e) {
    const ids = syms.map((s) => COINS[s]).join(",");
    const d = await cached("cg:" + ids, 60, () => getJSON("https://api.coingecko.com/api/v3/simple/price?ids=" + ids + "&vs_currencies=usd&include_24hr_change=true"));
    const out = {};
    for (const s of syms) { const x = d[COINS[s]]; if (x) out[s] = { px: x.usd, ch: x.usd_24h_change, cur: "$", src: "coingecko" }; }
    return out;
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

// { ввод: {key, kind, name, px, ch, cur, src} } — не больше 40 инструментов за раз
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
  const cr = by("crypto");
  if (cr.length) jobs.push(cryptoQuotes(cr.map((p) => p.s)).then((m) => {
    for (const p of cr) if (m[p.s]) out[p.key] = { key: p.key, kind: "crypto", name: p.s + "/USDT", ...m[p.s] };
  }).catch(() => {}));
  const mo = by("moex");
  if (mo.length) jobs.push(moexQuotes(mo.map((p) => p.s)).then((m) => {
    for (const p of mo) if (m[p.s]) out[p.key] = { key: p.key, kind: "moex", ...m[p.s], name: m[p.s].name || p.s };
  }).catch(() => {}));
  const mk = by("mkt");
  if (mk.length) jobs.push(siteData(env).then((d) => {
    const ids = {};
    for (const q of d.market || []) ids[q.id] = q;
    for (const p of mk) {
      const q = ids[p.s];
      if (q) out[p.key] = { key: p.key, kind: "mkt", name: (MKT[p.s] || [])[1] || q.name, px: q.value, ch: q.change, cur: "", src: "bot", digits: q.digits };
    }
  }).catch(() => {}));
  await Promise.all(jobs);
  return out;
}

// ---------------------------------------------------------------------------
// История цен (дневные свечи)
// ---------------------------------------------------------------------------
const RANGES = { "1m": 31, "3m": 92, "6m": 183, "1y": 366, "2y": 731, "5y": 1827, "ytd": 0 };

export function normRange(r) {
  r = String(r || "1y").toLowerCase().replace("мес", "m").replace("г", "y").replace("л", "y");
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
  const interval = range === "5y" ? "1wk" : "1d";
  const d = await getJSON(YAHOO + encodeURIComponent(sym) + "?range=" + range.replace("m", "mo") + "&interval=" + interval + "&includePrePost=false", { ttl: 1800 });
  const r = d && d.chart && d.chart.result && d.chart.result[0];
  if (!r || !r.timestamp) throw new Error("Yahoo: нет данных");
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
  const interval = days > 900 ? "1w" : "1d";
  const limit = Math.min(1000, interval === "1w" ? Math.ceil(days / 7) + 1 : days);
  const k = await getJSON(BINANCE + "/klines?symbol=" + coin + "USDT&interval=" + interval + "&limit=" + limit, { ttl: 900 });
  const out = { t: [], o: [], h: [], l: [], c: [], v: [], cur: "USD", name: coin + "/USDT" };
  for (const x of k) { out.t.push(Math.floor(x[0] / 1000)); out.o.push(+x[1]); out.h.push(+x[2]); out.l.push(+x[3]); out.c.push(+x[4]); out.v.push(+x[5]); }
  return out;
}

async function moexHistory(s, range, isIndex) {
  const days = sinceDays(range);
  const interval = days > 900 ? 7 : 24;
  const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
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
  return out;
}

export async function getHistory(env, raw, range) {
  const p = parseSymbol(raw);
  if (!p) throw new Error("не понял инструмент: " + raw);
  range = normRange(range);
  return cached("hist:" + p.key + ":" + range, 1800, async () => {
    let h;
    if (p.kind === "crypto") h = { ...(await binanceHistory(p.s, range)), src: "binance" };
    else if (p.kind === "moex") h = { ...(await moexHistory(p.s, range, false)), src: "moex" };
    else if (p.kind === "mkt" && p.s === "IMOEX") h = { ...(await moexHistory("IMOEX", range, true)), src: "moex" };
    else if (p.kind === "mkt") h = { ...(await yahooHistory(MKT[p.s][0], range)), name: MKT[p.s][1], src: "yahoo" };
    else h = { ...(await yahooHistory(p.s.replace(".", "-"), range)), src: "yahoo" };
    if (range === "ytd" && p.kind === "crypto") {
      const jan1 = Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000;
      const i = h.t.findIndex((t) => t >= jan1);
      if (i > 0) for (const k of ["t", "o", "h", "l", "c", "v"]) h[k] = h[k].slice(i);
    }
    if (!h.c.length) throw new Error("нет истории для " + raw);
    return { ok: true, s: p.key, kind: p.kind, range, ...h };
  });
}

// ---------------------------------------------------------------------------
// Компания (акции США): DES, FA, ERN, ANR, CN, HDS
// ---------------------------------------------------------------------------
const DAY = 86400;

function num(x, d) {
  const v = Number(x);
  if (x == null || !isFinite(v)) return null;
  return d == null ? v : Math.round(v * 10 ** d) / 10 ** d;
}

function seriesRows(series, keys) {
  // { eps: [{period, v}], ... } → [{end, eps, ...}] по убыванию даты
  const by = {};
  for (const k of keys) for (const x of (series && series[k]) || []) {
    (by[x.period] = by[x.period] || { end: x.period })[k] = num(x.v, 4);
  }
  return Object.values(by).sort((a, b) => (a.end < b.end ? 1 : -1));
}

const FA_KEYS = ["eps", "salesPerShare", "grossMargin", "operatingMargin", "netMargin", "roe", "totalDebtToEquity", "fcfMargin"];

async function translateLines(lines) {
  if (!lines.length) return lines;
  try {
    const q = encodeURIComponent(lines.map((l) => l.replace(/\n/g, " ")).join("\n"));
    const d = await getJSON("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t&q=" + q, { ttl: 86400, timeout: 6000 });
    const text = (d[0] || []).map((seg) => seg[0] || "").join("");
    const out = text.split("\n").map((s) => s.trim());
    return out.length === lines.length ? out : lines;
  } catch (e) {
    return lines;
  }
}

export const COMPANY_PARTS = ["des", "fa", "ern", "anr", "cn", "hds"];

export async function getCompany(env, raw, parts = COMPANY_PARTS) {
  const p = parseSymbol(raw);
  if (!p) throw new Error("не понял тикер: " + raw);
  if (p.kind === "moex") return moexCompany(p.s);
  if (p.kind !== "us") throw new Error("данные компании есть только для акций (США и Мосбиржи)");
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
      if (!x || !x.name) throw new Error("компания не найдена");
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
      if (!/404/.test(String(e.message))) throw e;   // для компаний вне списка отчётности из SEC нет — это нормально
    }));
  }
  if (want.has("cn")) {
    safe("news", fh(env, `/company-news?symbol=${s}&from=${weekAgo}&to=${today}`, 900).then(async (x) => {
      const items = (x || []).filter((n) => n.headline).sort((a, b) => b.datetime - a.datetime).slice(0, 12);
      const ru = await translateLines(items.map((n) => n.headline));
      res.cn = items.map((n, i) => ({ t: n.datetime, h: ru[i] || n.headline, en: n.headline, src: n.source, url: n.url }));
    }));
  }
  if (want.has("hds")) {
    safe("insiders", fh(env, "/stock/insider-transactions?symbol=" + s, 6 * 3600).then((x) => {
      const rows = ((x && x.data) || []).filter((t) => !t.isDerivative && ["P", "S"].includes(t.transactionCode));
      res.ins = rows.slice(0, 15).map((t) => ({ name: t.name, date: t.transactionDate, code: t.transactionCode, ch: t.change,
        sh: t.share, px: num(t.transactionPrice, 2) }));
    }));
  }
  await Promise.all(jobs);
  if (want.has("des") && !res.profile && !res.quote) {
    throw new Error(res.errors.join("; ") || "нет данных по " + p.s);
  }
  return res;
}

async function moexCompany(s) {
  const d = await cached("issdesc:" + s, 6 * 3600, () => getJSON(ISS + "/securities/" + s + ".json?iss.meta=off&iss.only=description"));
  const desc = {};
  const cols = d.description.columns;
  for (const r of d.description.data) desc[r[cols.indexOf("name")]] = r[cols.indexOf("value")];
  if (!desc.SECID) throw new Error("бумага не найдена на Мосбирже: " + s);
  const q = (await moexQuotes([s]))[s] || null;
  return { ok: true, s: "MOEX:" + s, kind: "moex", profile: { name: desc.NAME || desc.SHORTNAME, exch: "Мосбиржа", country: "RU", cur: "RUB",
    isin: desc.ISIN, issue: num(desc.ISSUESIZE), lot: q && q.lot, list: desc.LISTLEVEL, type: desc.TYPENAME },
  quote: q, errors: [] };
}

// ---------------------------------------------------------------------------
// Картинка-график для бота (QuickChart — бесплатно, без ключа)
// ---------------------------------------------------------------------------
export async function chartImage(h, title) {
  const n = h.c.length;
  const step = Math.max(1, Math.ceil(n / 160));
  const labels = [], data = [];
  for (let i = 0; i < n; i += step) {
    labels.push(new Date(h.t[i] * 1000).toISOString().slice(5, 10).split("-").reverse().join("."));
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
