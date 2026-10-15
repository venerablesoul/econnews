"""Probe round 6: deep company data from free sources, from GitHub runners."""
import gzip, http.cookiejar, json, os, time, urllib.parse, urllib.request
R = {}
BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
RESEARCH = "EconNews research bot econnews@example.com"
FH = os.environ.get("FINNHUB_API_KEY", "")
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def get(url, ua=BROWSER, timeout=40):
    t = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "application/json,text/plain,*/*", "Accept-Encoding": "gzip"})
    with opener.open(req, timeout=timeout) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return r.status, raw, round(time.time() - t, 2)


def probe(name, url, shape=lambda d: d, ua=BROWSER, js=True, limit=4000):
    try:
        st, raw, dt = get(url, ua)
        if js:
            try:
                d = json.loads(raw)
                s = shape(d)
                txt = json.dumps(s, ensure_ascii=False)
                R[name] = {"status": st, "bytes": len(raw), "sec": dt, "sample": s if len(txt) <= limit else txt[:limit]}
            except Exception as e:
                R[name] = {"status": st, "bytes": len(raw), "text": raw[:400].decode("utf-8", "replace"), "err": repr(e)[:100]}
        else:
            R[name] = {"status": st, "bytes": len(raw), "sec": dt, "text": raw[:800].decode("utf-8", "replace")}
    except urllib.error.HTTPError as e:
        R[name] = {"status": e.code, "body": e.read()[:300].decode("utf-8", "replace")}
    except Exception as e:
        R[name] = {"status": -1, "err": repr(e)[:200]}


# --- Yahoo: crumb flow, quoteSummary, fundamentals time series, dividends/splits ---
crumb = ""
try:
    try:
        opener.open(urllib.request.Request("https://fc.yahoo.com", headers={"User-Agent": BROWSER}), timeout=20).read()
    except urllib.error.HTTPError:
        pass
    st, raw, _ = get("https://query2.finance.yahoo.com/v1/test/getcrumb")
    crumb = raw.decode().strip()
    R["yahoo_crumb"] = {"status": st, "crumb_len": len(crumb), "cookies": [c.name for c in jar]}
except Exception as e:
    R["yahoo_crumb"] = {"status": -1, "err": repr(e)[:200], "cookies": [c.name for c in jar]}
MODS = ("assetProfile,summaryDetail,defaultKeyStatistics,financialData,earningsTrend,upgradeDowngradeHistory,"
        "institutionOwnership,fundOwnership,majorHoldersBreakdown,insiderHolders,calendarEvents,recommendationTrend,"
        "earningsHistory,secFilings,incomeStatementHistoryQuarterly,price")
qs = "https://query2.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=" + MODS + "&crumb=" + urllib.parse.quote(crumb)
probe("yahoo_qs", qs, lambda d: {m: (json.dumps(v, ensure_ascii=False)[:500]) for m, v in ((d.get("quoteSummary") or {}).get("result") or [{}])[0].items()}, limit=12000)
probe("yahoo_qs_nocrumb", "https://query2.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=assetProfile", lambda d: str(d)[:300])
TS = ("annualTotalRevenue,annualNetIncome,annualOperatingCashFlow,annualFreeCashFlow,annualTotalAssets,annualTotalDebt,"
      "annualResearchAndDevelopment,annualDilutedEPS,quarterlyTotalRevenue,quarterlyNetIncome")
p2 = int(time.time())
probe("yahoo_ts", f"https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/AAPL?type={TS}&period1=1483228800&period2={p2}",
      lambda d: [{"type": (x.get("meta") or {}).get("type"), "n": len(x.get((x.get("meta") or {}).get("type", [""])[0], []) or [])} for x in (d.get("timeseries") or {}).get("result", [])])
probe("yahoo_div", "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=10y&interval=1mo&events=div,split",
      lambda d: {k: (list(v.items())[:2] if isinstance(v, dict) else v) for k, v in ((d["chart"]["result"][0].get("events")) or {}).items()})
probe("yahoo_search", "https://query2.finance.yahoo.com/v1/finance/search?q=apple&quotesCount=3&newsCount=2",
      lambda d: {"quotes": [q.get("symbol") for q in d.get("quotes", [])], "news": [n.get("title") for n in d.get("news", [])]})
probe("yahoo_screener", "https://query2.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_gainers&count=5",
      lambda d: str(d)[:400])
probe("yahoo_recs", "https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/AAPL", lambda d: str(d)[:400])

# --- Finnhub free tier: which endpoints answer ---
for name, path in [("price_target", "/stock/price-target?symbol=AAPL"), ("eps_est", "/stock/eps-estimate?symbol=AAPL&freq=quarterly"),
                   ("rev_est", "/stock/revenue-estimate?symbol=AAPL&freq=annual"), ("upgrade", "/stock/upgrade-downgrade?symbol=AAPL"),
                   ("executive", "/stock/executive?symbol=AAPL"), ("fin_reported", "/stock/financials-reported?symbol=AAPL&freq=annual"),
                   ("filings", "/stock/filings?symbol=AAPL"), ("ins_sentiment", "/stock/insider-sentiment?symbol=AAPL&from=2026-01-01&to=2026-10-15"),
                   ("ipo", "/calendar/ipo?from=2026-10-01&to=2026-11-15"), ("dividend", "/stock/dividend?symbol=AAPL&from=2020-01-01&to=2026-10-15"),
                   ("split", "/stock/split?symbol=AAPL&from=2000-01-01&to=2026-10-15"), ("ownership", "/stock/ownership?symbol=AAPL&limit=5"),
                   ("fund_own", "/stock/fund-ownership?symbol=AAPL&limit=5"), ("short", "/stock/short-interest?symbol=AAPL&from=2026-01-01&to=2026-10-15"),
                   ("basic_fin", "/stock/metric?symbol=AAPL&metric=all"), ("revenue_breakdown", "/stock/revenue-breakdown?symbol=AAPL"),
                   ("esg", "/stock/esg?symbol=AAPL"), ("etf_hold", "/etf/holdings?symbol=SPY"), ("sec_sim", "/stock/similarity-index?symbol=AAPL&freq=annual"),
                   ("market_status", "/stock/market-status?exchange=US"), ("market_holiday", "/stock/market-holiday?exchange=US"),
                   ("sector_metrics", "/sector/metrics?region=NA"), ("transcripts_list", "/stock/transcripts/list?symbol=AAPL"),
                   ("congress", "/stock/congressional-trading?symbol=AAPL&from=2026-01-01&to=2026-10-15"), ("lobbying", "/stock/lobbying?symbol=AAPL&from=2025-01-01&to=2026-10-15")]:
    probe("fh_" + name, f"https://finnhub.io/api/v1{path}&token={FH}" if "?" in path else f"https://finnhub.io/api/v1{path}?token={FH}",
          lambda d: json.dumps(d, ensure_ascii=False)[:600])

# --- SEC: submissions (filings, description) ---
probe("sec_subm", "https://data.sec.gov/submissions/CIK0000320193.json",
      lambda d: {k: d.get(k) for k in ("name", "sicDescription", "category", "fiscalYearEnd", "stateOfIncorporation", "website", "description", "addresses", "phone", "exchanges", "tickers", "formerNames")}
      | {"recent_forms": d["filings"]["recent"]["form"][:15], "recent_docs": d["filings"]["recent"]["primaryDocument"][:3]}, ua=RESEARCH)
probe("sec_13f_search", "https://efts.sec.gov/LATEST/search-index?q=%22APPLE%20INC%22&forms=13F-HR", lambda d: str(d)[:300], ua=RESEARCH)

# --- Wikipedia: company summaries in English and Russian ---
probe("wiki_en", "https://en.wikipedia.org/api/rest_v1/page/summary/Apple_Inc.", lambda d: {k: d.get(k) for k in ("title", "description", "extract")}, ua=RESEARCH)
probe("wiki_ll", "https://en.wikipedia.org/w/api.php?action=query&prop=langlinks|pageprops&titles=Apple%20Inc&lllang=ru&redirects=1&format=json", lambda d: d, ua=RESEARCH)
probe("wiki_ru", "https://ru.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote("Apple"), lambda d: {k: d.get(k) for k in ("title", "description", "extract")}, ua=RESEARCH)
probe("wikidata_ticker", "https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q312&props=claims|sitelinks&format=json",
      lambda d: {"sitelinks": list((d["entities"]["Q312"].get("sitelinks") or {}).keys())[:10], "P1128_employees": str(d["entities"]["Q312"]["claims"].get("P1128", [{}])[-1:])[:300],
                 "P169_ceo": str(d["entities"]["Q312"]["claims"].get("P169", [{}])[-1:])[:300]}, ua=RESEARCH)

# --- Moscow Exchange: dividends, issuer info ---
probe("moex_div", "https://iss.moex.com/iss/securities/SBER/dividends.json?iss.meta=off", lambda d: d)
probe("moex_desc_en", "https://iss.moex.com/iss/securities/SBER.json?iss.meta=off&iss.only=description&lang=en", lambda d: d["description"]["data"][:25])

# --- FRED without a key (graph CSV), for monthly macro data ---
for sid in ("CPIAUCSL", "UNRATE", "BAMLH0A0HYM2", "T10Y2Y", "DGS10"):
    probe("fred_" + sid, f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}", js=False)

# --- IMF with the research UA: one indicator, all countries ---
probe("imf_lur", "https://www.imf.org/external/datamapper/api/v1/LUR", lambda d: {"n": len(d["values"]["LUR"]), "USA": {k: v for k, v in d["values"]["LUR"]["USA"].items() if k >= "2023"}}, ua=RESEARCH)
probe("imf_regions", "https://www.imf.org/external/datamapper/api/v1/regions", lambda d: {k: v.get("label") for k, v in list(d.get("regions", {}).items())[:40]}, ua=RESEARCH)

# --- Cboe: index and an MOEX-like check is not needed; IPO/earnings from Nasdaq ---
probe("nasdaq_ipo", "https://api.nasdaq.com/api/ipo/calendar?date=2026-10", lambda d: str(d)[:600])
probe("nasdaq_earn", "https://api.nasdaq.com/api/calendar/earnings?date=2026-10-15", lambda d: str(d)[:600])
probe("nasdaq_short", "https://api.nasdaq.com/api/quote/AAPL/short-interest?assetClass=stocks", lambda d: str(d)[:600])
probe("nasdaq_inst", "https://api.nasdaq.com/api/company/AAPL/institutional-holdings?limit=5&type=TOTAL", lambda d: str(d)[:900])
probe("nasdaq_div", "https://api.nasdaq.com/api/quote/AAPL/dividends?assetclass=stocks", lambda d: str(d)[:600])

os.makedirs("probe", exist_ok=True)
json.dump(R, open("probe/out.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps({k: v.get("status") for k, v in R.items()}, indent=1))
