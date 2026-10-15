"""Probe round 7: full raw structures for the parsers (Yahoo quoteSummary, MOEX dividends and market data, Nasdaq)."""
import gzip, http.cookiejar, json, os, time, urllib.parse, urllib.request
BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
RESEARCH = "EconNews research bot econnews@example.com"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
OUT = {}


def get(url, ua=BROWSER, timeout=40, accept="application/json,text/plain,*/*"):
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": accept, "Accept-Encoding": "gzip"})
    with opener.open(req, timeout=timeout) as r:
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


try:
    opener.open(urllib.request.Request("https://fc.yahoo.com", headers={"User-Agent": BROWSER}), timeout=20).read()
except Exception:
    pass
crumb = get("https://query2.finance.yahoo.com/v1/test/getcrumb").decode().strip()
MODS = ("assetProfile,summaryDetail,defaultKeyStatistics,financialData,earningsTrend,upgradeDowngradeHistory,"
        "institutionOwnership,fundOwnership,majorHoldersBreakdown,insiderHolders,calendarEvents,recommendationTrend,"
        "earningsHistory,secFilings,price,summaryProfile,netSharePurchaseActivity,indexTrend,industryTrend,sectorTrend")
for s in ("AAPL", "TSLA", "JPM"):
    def qs(s=s):
        d = json.loads(get("https://query2.finance.yahoo.com/v10/finance/quoteSummary/" + s + "?modules=" + MODS + "&crumb=" + urllib.parse.quote(crumb)))
        r = d["quoteSummary"]["result"][0]
        # keep everything but trim long lists
        for k, v in r.items():
            if isinstance(v, dict):
                for kk, vv in v.items():
                    if isinstance(vv, list) and len(vv) > 4:
                        v[kk] = vv[:4] + [{"_more": len(vv) - 4}]
        return r
    keep("yahoo_qs_" + s, qs)
    time.sleep(1)
keep("yahoo_chart_events", lambda: (lambda d: {"meta": {k: v for k, v in d["chart"]["result"][0]["meta"].items() if k not in ("tradingPeriods",)},
                                                "events": {k: dict(list(v.items())[-3:]) for k, v in (d["chart"]["result"][0].get("events") or {}).items()}})(
    json.loads(get("https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=10y&interval=1mo&events=div%7Csplit"))))
keep("yahoo_intraday", lambda: (lambda r: {"n": len(r["timestamp"]), "gran": r["meta"].get("dataGranularity"), "first": r["timestamp"][:2],
                                           "close": r["indicators"]["quote"][0]["close"][:3]})(
    json.loads(get("https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=5m"))["chart"]["result"][0]))
ISS = "https://iss.moex.com/iss/"
keep("moex_div", lambda: json.loads(get(ISS + "securities/SBER/dividends.json?iss.meta=off")))
keep("moex_tqbr", lambda: (lambda d: {"sec_cols": d["securities"]["columns"], "sec_row": d["securities"]["data"][:2], "md_cols": d["marketdata"]["columns"],
                                      "md_row": d["marketdata"]["data"][:2], "n": len(d["securities"]["data"])})(
    json.loads(get(ISS + "engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off"))))
keep("moex_imoex_parts", lambda: (lambda d: {k: (v["columns"], v["data"][:3], len(v["data"])) for k, v in d.items()})(
    json.loads(get(ISS + "statistics/engines/stock/markets/index/analytics/IMOEX.json?iss.meta=off&limit=100"))))
keep("nasdaq_short", lambda: json.loads(get("https://api.nasdaq.com/api/quote/AAPL/short-interest?assetClass=stocks")))
keep("nasdaq_earn_date", lambda: (lambda d: d["data"]["rows"][:2] if d.get("data") else d)(json.loads(get("https://api.nasdaq.com/api/calendar/earnings?date=2026-10-16"))))
keep("finnhub_ipo", lambda: json.loads(get("https://finnhub.io/api/v1/calendar/ipo?from=2026-10-15&to=2026-11-15&token=" + os.environ.get("FINNHUB_API_KEY", ""))).get("ipoCalendar", [])[:3])
keep("wiki_ru_sber", lambda: json.loads(get("https://ru.wikipedia.org/api/rest_v1/page/summary/%D0%A1%D0%B1%D0%B5%D1%80%D0%B1%D0%B0%D0%BD%D0%BA", ua=RESEARCH)))
keep("imf_ngdp", lambda: (lambda d: {"n": len(d["values"]["NGDP_RPCH"]), "USA": d["values"]["NGDP_RPCH"].get("USA"), "EURO": d["values"]["NGDP_RPCH"].get("EURO"),
                                     "keys": sorted(d["values"]["NGDP_RPCH"].keys())[:400]})(json.loads(get("https://www.imf.org/external/datamapper/api/v1/NGDP_RPCH", ua=RESEARCH))))
keep("imf_ind", lambda: (lambda d: {k: v.get("label") for k, v in d["indicators"].items()})(json.loads(get("https://www.imf.org/external/datamapper/api/v1/indicators", ua=RESEARCH))))
os.makedirs("probe", exist_ok=True)
json.dump(OUT, open("probe/out2.json", "w"), ensure_ascii=False, indent=1)
print({k: (list(v.keys())[:6] if isinstance(v, dict) else type(v).__name__) for k, v in OUT.items()})
