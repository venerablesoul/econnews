"""Probe round 8: Cboe delayed options, MOEX dividends variants."""
import gzip, json, urllib.request
BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
OUT = {}


def get(url, ua=BROWSER, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "application/json,text/plain,*/*", "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return raw


def keep(name, fn):
    try:
        OUT[name] = fn()
    except urllib.error.HTTPError as e:
        OUT[name] = {"_error": e.code, "body": e.read()[:300].decode("utf-8", "replace")}
    except Exception as e:
        OUT[name] = {"_error": repr(e)[:300]}


def cboe(sym):
    raw = get(f"https://cdn.cboe.com/api/global/delayed_quotes/options/{sym}.json")
    d = json.loads(raw)
    data = d.get("data") or {}
    opts = data.get("options") or []
    head = {k: v for k, v in data.items() if k != "options"}
    return {"bytes": len(raw), "top": {k: v for k, v in d.items() if k != "data"}, "head": head, "n": len(opts),
            "first": opts[:3], "mid": opts[len(opts) // 2: len(opts) // 2 + 2]}


keep("cboe_AAPL", lambda: cboe("AAPL"))
keep("cboe_SPX", lambda: cboe("_SPX"))
keep("cboe_quote_AAPL", lambda: json.loads(get("https://cdn.cboe.com/api/global/delayed_quotes/quotes/AAPL.json")))
ISS = "https://iss.moex.com/iss/"
for name, url in (("moex_div1", "securities/SBER/dividends.json"),
                  ("moex_div2", "securities/SBER/dividends.json?iss.only=dividends"),
                  ("moex_div3", "statistics/engines/stock/markets/shares/dividends.json?securities=SBER"),
                  ("moex_div4", "securities/SBER/dividends"),
                  ("moex_div5", "securities/SBER/dividends.json?lang=en&iss.meta=off&iss.json=extended")):
    keep(name, lambda url=url: get(ISS + url)[:3000].decode("utf-8", "replace"))
with open("probe/out3.json", "w") as f:
    json.dump(OUT, f, ensure_ascii=False, indent=1)
