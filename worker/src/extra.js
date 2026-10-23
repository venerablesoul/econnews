// Extra API for the terminal's maps and monitors.
//   /api/geo?u=<url>  — the map layers and calendars from sources that do not allow browsers (CORS):
//                       only the listed hosts, cached at the edge; the answer is passed through as is
//   /api/perf?s=…     — returns over 1D…5Y for up to 40 instruments in one request (TRAY, FPC):
//                       Yahoo's spark endpoint takes 20 symbols per call, so 40 instruments cost 4 calls
//                       (the free plan allows 50 outside calls per request)
import { cached, getJSON } from "./lib.js";
import { MKT, getHistory, parseSymbol } from "./market.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
// host → seconds to cache
export const GEO_HOSTS = {
  "earthquake.usgs.gov": 120, "eonet.gsfc.nasa.gov": 600, "www.gdacs.org": 600, "gdacs.org": 600,
  "services9.arcgis.com": 1800, "api.open-meteo.com": 900, "date.nager.at": 86400, "www.treasurydirect.gov": 1800,
  "markets.newyorkfed.org": 1800, "data-api.ecb.europa.eu": 1800, "www.nhc.noaa.gov": 600, "meri.digitraffic.fi": 60,
};

export async function geoProxy(raw) {
  let u;
  try { u = new URL(String(raw || "")); } catch (e) { throw new Error("bad address"); }
  const ttl = GEO_HOSTS[u.hostname];
  if (u.protocol !== "https:" || !ttl) throw new Error("this source is not allowed: " + u.hostname);
  const text = await cached("geo:" + u.href, ttl, async () => {
    const init = { headers: { "User-Agent": UA, Accept: "application/json,*/*" }, cf: { cacheTtl: ttl, cacheEverything: true } };
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) init.signal = AbortSignal.timeout(20000);
    const r = await fetch(u.href, init);
    if (!r.ok) throw new Error(u.hostname + ": HTTP " + r.status);
    const t = await r.text();
    JSON.parse(t);   // only JSON passes through
    return t;
  });
  return new Response(text, { status: 200, headers: { "content-type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=" + Math.min(ttl, 600) } });
}

// ---------------------------------------------------------------------------
// Returns over many periods
// ---------------------------------------------------------------------------
const YEAR = 365.25 * 86400;
function at(series, ts) {
  let i = 0;
  while (i < series.t.length - 1 && series.t[i + 1] <= ts) i++;
  return series.t[i] <= ts ? series.c[i] : null;
}
// daily: a year of daily closes, weekly: five years of weekly closes → {period: %}; past one year — a year on average
export function returnsFrom(daily, weekly) {
  const out = {}, n = daily.t.length;
  if (n < 2) return out;
  const last = daily.c[n - 1], tl = daily.t[n - 1], now = new Date(tl * 1000);
  out["1d"] = (last / daily.c[n - 2] - 1) * 100;
  for (const [k, days] of [["1w", 7], ["1m", 30.4], ["3m", 91.3], ["6m", 182.6], ["1y", 365.25]]) {
    const v = at(daily, tl - days * 86400);
    out[k] = v ? (last / v - 1) * 100 : null;
  }
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  for (const [k, start] of [["mtd", Date.UTC(y, m, 1)], ["qtd", Date.UTC(y, Math.floor(m / 3) * 3, 1)], ["ytd", Date.UTC(y, 0, 1)]]) {
    const v = at(daily, start / 1000 - 1);
    out[k] = v ? (last / v - 1) * 100 : null;
  }
  // the daily series starts about a year back: the year from the weekly one when the daily falls short
  if (out["1y"] == null && weekly && weekly.t && weekly.t.length) { const v = at(weekly, tl - YEAR); out["1y"] = v ? (last / v - 1) * 100 : null; }
  if (weekly && weekly.t && weekly.t.length) {
    for (const [k, yrs] of [["2y", 2], ["3y", 3], ["5y", 5]]) {
      const ts = tl - yrs * YEAR;
      if (weekly.t[0] > ts + 14 * 86400) { out[k] = null; continue; }
      const v = at(weekly, ts);
      out[k] = v ? (Math.pow(last / v, 1 / yrs) - 1) * 100 : null;
    }
  }
  for (const k of Object.keys(out)) if (out[k] != null) out[k] = Math.round(out[k] * 100) / 100;
  return out;
}

// Yahoo spark: {symbol: {t, c}} for up to 20 symbols per call
export function sparkSeries(d) {
  const out = {};
  if (d && d.spark && Array.isArray(d.spark.result)) {
    for (const r of d.spark.result) {
      const x = r && r.response && r.response[0];
      const c = x && x.indicators && x.indicators.quote && x.indicators.quote[0] && x.indicators.quote[0].close;
      if (x && x.timestamp && c) out[r.symbol] = pairs(x.timestamp, c);
    }
  } else if (d && typeof d === "object") {
    for (const [sym, r] of Object.entries(d)) if (r && r.timestamp && r.close) out[sym] = pairs(r.timestamp, r.close);
  }
  return out;
}
function pairs(t, c) {
  const o = { t: [], c: [] };
  t.forEach((x, i) => { if (c[i] != null) { o.t.push(x); o.c.push(c[i]); } });
  return o;
}
async function spark(symbols, range, interval) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 20) {
    const part = symbols.slice(i, i + 20).map(encodeURIComponent).join(",");
    let got = {}, err = null;
    for (const base of ["https://query1.finance.yahoo.com/v7/finance/spark", "https://query2.finance.yahoo.com/v8/finance/spark"]) {
      try {
        got = sparkSeries(await getJSON(base + "?range=" + range + "&interval=" + interval + "&symbols=" + part, { ttl: 1800, timeout: 9000 }));
        if (Object.keys(got).length) break;
      } catch (e) { err = e; }
    }
    if (!Object.keys(got).length && err) throw err;
    Object.assign(out, got);
  }
  return out;
}

export async function getPerf(env, raws) {
  const list = [...new Set(raws.map((x) => String(x || "").trim()).filter(Boolean))].slice(0, 40);
  return cached("perf:" + list.join(","), 900, async () => {
    const items = list.map((s) => {
      const p = parseSymbol(s);
      if (!p) return { s, error: "unknown instrument" };
      let y = null, name = null, name_ru = null;
      if (p.kind === "mkt") { y = MKT[p.s][0]; name = MKT[p.s][1]; name_ru = MKT[p.s][2]; }
      else if (p.kind === "us") y = p.s.replace(".", "-");
      else if (p.kind === "crypto") { y = p.s + "-USD"; name = p.s + "/USD"; }
      return { s, p, y, name, name_ru };
    });
    const ys = items.filter((x) => x.y).map((x) => x.y);
    const [daily, weekly] = ys.length ? await Promise.all([spark(ys, "1y", "1d"), spark(ys, "5y", "1wk").catch(() => ({}))]) : [{}, {}];
    const rows = await Promise.all(items.map(async (x) => {
      if (x.error) return { s: x.s, error: x.error, r: null };
      try {
        let d = x.y && daily[x.y], w = x.y && weekly[x.y];
        if (!d || d.c.length < 2) {   // Moscow Exchange and anything Yahoo's spark lacks: the usual history
          const [h1, h5] = await Promise.all([getHistory(env, x.s, "1y"), getHistory(env, x.s, "5y").catch(() => null)]);
          d = h1; w = h5; x.name = x.name || h1.name; x.name_ru = x.name_ru || h1.name_ru;
        }
        return { s: x.s, key: x.p.key, name: x.name, name_ru: x.name_ru, px: d.c[d.c.length - 1], r: returnsFrom(d, w) };
      } catch (e) {
        return { s: x.s, error: String(e.message || e), r: null };
      }
    }));
    return { ok: true, rows, updated: new Date().toISOString() };
  });
}
