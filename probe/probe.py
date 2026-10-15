"""Probe round 13 (Coinbase errors in detail; direct Coinbase from the runner): live bot server — crypto history through Coinbase, the company card with the deep files."""
import json, time, urllib.request
API = "https://econnews-bot.econnews-6dce35.workers.dev"
OUT = {}


def get(path):
    t = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(API + path, headers={"User-Agent": "probe"}), timeout=40) as r:
            return {"status": r.status, "sec": round(time.time() - t, 2), "d": json.loads(r.read())}
    except Exception as e:
        return {"err": repr(e)[:300]}


for s, rg in (("BTC", "1d"), ("BTC", "5d"), ("BTC", "1y"), ("BTC", "5y"), ("ETH", "1d")):
    r = get(f"/api/history?s={s}&r={rg}")
    d = r.get("d") or {}
    OUT[f"{s}_{rg}"] = {"sec": r.get("sec"), "ok": d.get("ok"), "error": d.get("error"), "n": len(d.get("c") or []), "src": d.get("src"), "last": (d.get("c") or [None])[-1]}
for s in ("AAPL", "MSFT"):
    r = get("/api/company?s=" + s)
    d = r.get("d") or {}
    co = d.get("co") or {}
    OUT["co_" + s] = {"sec": r.get("sec"), "errors": d.get("errors"), "co_keys": sorted(co), "opt_full": bool((d.get("opt") or {}).get("chains")),
                      "dvd_live": "dvd" in d, "cf_live": "cf" in d, "rv": len((d.get("rv") or {}).get("rows") or []), "rv_src": (d.get("rv") or {}).get("src")}
for g, span in ((300, 86400), (3600, 5 * 86400), (86400, 300 * 86400)):
    import datetime as dt
    end = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    u = (f"https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity={g}&start=" + (end - dt.timedelta(seconds=span)).isoformat().replace("+00:00", ".000Z")
         + "&end=" + end.isoformat().replace("+00:00", ".000Z"))
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 (compatible; EconNewsBot/1.0)"}), timeout=30) as rr:
            body = rr.read()
            OUT[f"cb_direct_{g}"] = {"status": rr.status, "n": len(json.loads(body)), "u": u}
    except urllib.error.HTTPError as e:
        OUT[f"cb_direct_{g}"] = {"status": e.code, "body": e.read()[:300].decode("utf-8", "replace"), "u": u}
    except Exception as e:
        OUT[f"cb_direct_{g}"] = {"err": repr(e)[:300]}
with open("probe/out8.json", "w") as f:
    json.dump(OUT, f, ensure_ascii=False, indent=1)
