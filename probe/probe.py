"""Probe round 5: free sources for macro (IMF, DBnomics) and options (Cboe) from GitHub runners."""
import gzip, json, os, time, urllib.request
R = {}
BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


def get(url, ua=BROWSER, timeout=40):
    t = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "application/json,*/*", "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return r.status, raw, round(time.time() - t, 2), dict(r.headers)


def probe(name, url, shape, ua=BROWSER):
    try:
        st, raw, dt, hd = get(url, ua)
        try:
            d = json.loads(raw)
            R[name] = {"status": st, "bytes": len(raw), "sec": dt, "cors": hd.get("Access-Control-Allow-Origin"), "sample": shape(d)}
        except Exception as e:
            R[name] = {"status": st, "bytes": len(raw), "sec": dt, "text": raw[:300].decode("utf-8", "replace"), "err": repr(e)[:100]}
    except urllib.error.HTTPError as e:
        R[name] = {"status": e.code, "body": e.read()[:200].decode("utf-8", "replace")}
    except Exception as e:
        R[name] = {"status": -1, "err": repr(e)[:200]}


IMF = "https://www.imf.org/external/datamapper/api/v1/"
probe("imf_indicators", IMF + "indicators", lambda d: {k: v.get("label") for k, v in list(d.get("indicators", {}).items())[:12]})
probe("imf_gdp", IMF + "NGDP_RPCH/USA/DEU/CHN/RUS/JPN/GBR/IND/BRA?periods=2024,2025,2026,2027", lambda d: d)
probe("imf_multi", IMF + "PCPIPCH/USA/RUS?periods=2025,2026", lambda d: d)
probe("imf_lur", IMF + "LUR/USA/RUS/EUQ?periods=2025,2026", lambda d: d)
probe("imf_debt", IMF + "GGXWDG_NGDP/USA/JPN?periods=2025", lambda d: d)
probe("imf_bca", IMF + "BCA_NGDPD/CHN/DEU?periods=2025", lambda d: d)
probe("imf_gdpd", IMF + "NGDPD/USA/CHN?periods=2025", lambda d: d)
probe("imf_imf_ua", IMF + "NGDP_RPCH/USA?periods=2025", lambda d: d, ua="EconNews research bot econnews@example.com")
probe("imf_countries", IMF + "countries", lambda d: {k: v.get("label") for k, v in list(d.get("countries", {}).items())[:5]})
probe("imf_regions", IMF + "regions", lambda d: {k: v.get("label") for k, v in list(d.get("regions", {}).items())[:30]})

DBN = "https://api.db.nomics.world/v22/series/"
dbshape = lambda d: [{"code": s.get("series_code"), "name": s.get("series_name"), "last": list(zip(s.get("period", [])[-3:], s.get("value", [])[-3:]))}
                     for s in (d.get("series") or {}).get("docs", [])][:3]
probe("dbn_us_cpi", DBN + "BLS/cu/CUSR0000SA0?observations=1&format=json", dbshape)
probe("dbn_us_unemp", DBN + "BLS/ln/LNS14000000?observations=1&format=json", dbshape)
probe("dbn_ea_hicp", DBN + "Eurostat/prc_hicp_manr/M.RCH_A.CP00.EA?observations=1&format=json", dbshape)

def cboe_shape(d):
    data = d.get("data") or {}
    opts = data.get("options") or []
    return {"top": list(d.keys()), "data_keys": [k for k in data.keys() if k != "options"],
            "data_fields": {k: v for k, v in data.items() if k != "options"}, "n_options": len(opts), "first": opts[:3], "last": opts[-1:]}

for s in ("AAPL", "SPY", "TSLA", "_SPX", "NVDA"):
    probe("cboe_" + s, f"https://cdn.cboe.com/api/global/delayed_quotes/options/{s}.json", cboe_shape)
probe("cboe_quote_AAPL", "https://cdn.cboe.com/api/global/delayed_quotes/quotes/AAPL.json", lambda d: d)
probe("yahoo_opt", "https://query1.finance.yahoo.com/v7/finance/options/AAPL", lambda d: list(d.keys()))

os.makedirs("probe", exist_ok=True)
json.dump(R, open("probe/out.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "sample"} for k, v in R.items()}, ensure_ascii=False, indent=1))
