// Локальный сервер бота для e2e-тестов терминала: настоящий код worker/src, внешние сервисы подменены.
// Запуск: node tests/fake_server.mjs 8787
import http from "node:http";
import { PAGES, TOKEN, OWNER, KV, installMocks, dataJson, stocksJson, ratesJson } from "./mocks.mjs";

installMocks();
const worker = (await import("../worker/src/index.js")).default;
const env = { TELEGRAM_BOT_TOKEN: TOKEN, OWNER_ID: OWNER, FINNHUB_API_KEY: "FHKEY", TERMINAL_PASSWORD: "pw", PAGES_URL: PAGES, SUBS: new KV() };
const ctx = { waitUntil() {} };
const FX = { "data.json": dataJson, "stocks.json": stocksJson, "rates.json": ratesJson };

const port = Number(process.argv[2] || 8787);
http.createServer(async (req, res) => {
  try {
    const url = "http://127.0.0.1:" + port + req.url;
    const path = new URL(url).pathname;
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
