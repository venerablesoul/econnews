// A local bot server for the terminal e2e tests: the real worker/src code with faked external services.
// Run: node tests/fake_server.mjs 8787
import http from "node:http";
import { PAGES, TOKEN, OWNER, KV, installMocks, dataJson, stocksJson, ratesJson, coAAPL, optAAPL, optionsJson, macroJson, moexJson, geoRoute } from "./mocks.mjs";
import { wpeJson, ratesExtra, macroMap, auctionsJson } from "./geo_fixtures.mjs";
import { readFileSync } from "node:fs";
// option analytics written by the real gex.py (tests/make_gex_fixtures.py) and tankers as the bot would write them
const gexFx = (n) => JSON.parse(readFileSync(new URL("./fixtures/pages/gex/" + n, import.meta.url), "utf8"));
const now = Date.now(), iso = (ms) => new Date(ms).toISOString();
const shipsJson = { updated: iso(now - 600e3), src: "aisstream.io", hours: 12,
  areas: [{ id: "hormuz", name: "Strait of Hormuz", name_ru: "Ормузский пролив", box: [24.8, 54.5, 27.6, 58.2], tankers: 2, seen_now: 3 }],
  ships: [{ mmsi: 538001234, name: "OCEAN STAR", type: 80, lat: 26.5, lon: 56.3, sog: 12.4, cog: 301, nav: 0, area: "hormuz", dest: "FUJAIRAH", t: iso(now - 900e3) },
          { mmsi: 538005678, name: "GULF DAWN", type: 84, lat: 26.1, lon: 55.9, sog: 0, cog: null, nav: 1, area: "hormuz", t: iso(now - 1800e3) }], tk: {} };

installMocks();
const worker = (await import("../worker/src/index.js")).default;
const env = { TELEGRAM_BOT_TOKEN: TOKEN, OWNER_ID: OWNER, FINNHUB_API_KEY: "FHKEY", TERMINAL_PASSWORD: "pw", PAGES_URL: PAGES, SUBS: new KV() };
const ctx = { waitUntil() {} };
const FX = { "data.json": dataJson, "stocks.json": stocksJson, "rates.json": ratesJson, "co/AAPL.json": coAAPL, "opt/AAPL.json": optAAPL,
  "options.json": optionsJson, "macro.json": { ...macroJson, map: macroMap }, "moex.json": moexJson, "wpe.json": wpeJson, "auctions.json": auctionsJson,
  "rates.json": { ...ratesJson, ...ratesExtra },
  "gex/SPX.json": gexFx("SPX.json"), "gex/BTC.json": gexFx("BTC.json"), "gex/hist/SPX.json": gexFx("hist/SPX.json"), "gex/hist/BTC.json": gexFx("hist/BTC.json"),
  "ships.json": shipsJson };

const port = Number(process.argv[2] || 8787);
http.createServer(async (req, res) => {
  try {
    const url = "http://127.0.0.1:" + port + req.url;
    const path = new URL(url).pathname;
    if (path === "/__geo") {   // what a map source would answer (the browser's direct requests in the e2e tests)
      const body = geoRoute(new URL(new URL(url).searchParams.get("u")));
      res.writeHead(body && body.__status ? body.__status : 200, { "content-type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify(body === undefined ? { error: "no fixture" } : body));
    }
    if (path.startsWith("/__fx/")) {
      const body = FX[path.slice(6)];
      res.writeHead(body ? 200 : 404, { "content-type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify(body || {}));
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }), env, ctx);
    const out = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
    res.end(out);
  } catch (e) {
    res.writeHead(500); res.end(String(e && e.stack || e));
  }
}).listen(port, "127.0.0.1", () => console.log("fake worker on " + port));
