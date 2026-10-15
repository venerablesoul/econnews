"""Probe round 11: the live bot server again (latency of the company card, BTC intraday error text)."""
import json, time, urllib.request
API = "https://econnews-bot.econnews-6dce35.workers.dev"
OUT = {}


def get(path):
    t = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(API + path, headers={"User-Agent": "probe"}), timeout=40) as r:
            d = json.loads(r.read())
            return {"status": r.status, "sec": round(time.time() - t, 2), "d": d}
    except urllib.error.HTTPError as e:
        return {"status": e.code, "body": e.read()[:400].decode("utf-8", "replace")}
    except Exception as e:
        return {"err": repr(e)}


def short(x, n=1500):
    return json.dumps(x, ensure_ascii=False)[:n]


r = get("/api/ipo"); OUT["ipo"] = {"status": r.get("status"), "n": len((r.get("d") or {}).get("ipo") or []), "first": short(((r.get("d") or {}).get("ipo") or [None])[0], 300)}
for s in ("AAPL", "XOM", "SPY", "BRK.B"):
    r = get("/api/company?s=" + s)
    d = r.get("d") or {}
    OUT["co_" + s] = {"status": r.get("status"), "sec": r.get("sec"), "keys": sorted(d), "errors": d.get("errors"), "co": bool(d.get("co")),
                      "opt": short(d.get("opt"), 300), "rv": short((d.get("rv") or {}).get("rows"), 400), "dvd": short(d.get("dvd"), 300), "cf": short(d.get("cf"), 300),
                      "body": r.get("body")}
for s, rg in (("AAPL", "1d"), ("BTC", "5d"), ("SBER", "1d"), ("S&P", "5d")):
    r = get("/api/history?s=" + urllib.request.quote(s) + "&r=" + rg)
    d = r.get("d") or {}
    OUT[f"hist_{s}_{rg}"] = {"status": r.get("status"), "n": len(d.get("c") or []), "range": d.get("range"), "first_t": (d.get("t") or [None])[0],
                             "last_t": (d.get("t") or [None])[-1], "src": d.get("src"), "body": r.get("body")}
r = get("/api/history?s=BTC&r=5d"); OUT["btc5d_raw"] = {k: (v if k != "d" else {kk: vv for kk, vv in v.items() if kk not in ("t", "o", "h", "l", "c", "v")}) for k, v in r.items()}
r = get("/api/history?s=BTC&r=1d"); OUT["btc1d_raw"] = {k: (v if k != "d" else {kk: vv for kk, vv in v.items() if kk not in ("t", "o", "h", "l", "c", "v")}) for k, v in r.items()}
for u in ("https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=120", "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=30m&limit=240"):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as rr:
            OUT[u[:60]] = {"status": rr.status, "sample": rr.read()[:300].decode("utf-8", "replace")}
    except Exception as e:
        OUT[u[:60]] = {"err": repr(e)[:300]}
with open("probe/out6.json", "w") as f:
    json.dump(OUT, f, ensure_ascii=False, indent=1)
