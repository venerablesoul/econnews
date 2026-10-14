"""Временная проверка источников (раунд 2)."""
import json, re, urllib.request, urllib.error, time
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
R = {}
def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:500]
    except Exception as e:
        return -1, repr(e).encode()
syms = "AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,BRK-B,JPM,V,MA,UNH,XOM,LLY,AVGO,HD,PG,COST,JNJ,ABBV,WMT,KO,PEP,BAC,CVX,MRK,ORCL,CRM,ADBE,AMD,NFLX,DIS,CSCO,INTC,QCOM,TXN,IBM,GE,CAT,BA,HON,UNP,LMT,RTX,DE,UPS,GS,MS,C,WFC".split(",")
for n in (20, 50):
    st, b = get("https://query1.finance.yahoo.com/v7/finance/spark?symbols=" + ",".join(syms[:n]) + "&range=1d&interval=1d")
    try:
        res = json.loads(b)["spark"]["result"]
        R[f"spark_{n}"] = {"status": st, "n": len(res), "syms": [x["symbol"] for x in res][:60],
                           "meta_keys": sorted(res[0]["response"][0]["meta"].keys())}
    except Exception as e:
        R[f"spark_{n}"] = {"status": st, "err": repr(e), "body": b[:300].decode("utf-8", "replace")}
st, b = get("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm")
h = b.decode("utf-8", "replace")
i = h.find("FOMC Meetings")
R["fomc_heads"] = re.findall(r"<h4[^>]*>.{0,120}?(\d{4}) FOMC Meetings", h, re.S)[:8]
R["fomc_html"] = h[max(0, i - 400): i + 1800]
st, b = get("https://stats.bis.org/api/v1/data/WS_CBPOL/D.US+XM+GB+JP+CN+CH+CA+AU+IN+BR+TR+KR+MX+ZA+RU/all?lastNObservations=1&format=csv")
lines = b.decode("utf-8", "replace").splitlines()
hdr = lines[0].split(",") if lines else []
R["bis"] = {"status": st, "header": hdr, "rows": [l[:60] + " ... " + l[-60:] for l in lines[1:20]]}
st, b = get("https://query1.finance.yahoo.com/v8/finance/chart/BRK-B?range=5d&interval=1d")
R["yahoo_brkb"] = st
st, b = get("https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=1y&interval=1d")
R["yahoo_gspc_1y"] = st
with open("probe/out2.json", "w", encoding="utf-8") as f:
    json.dump(R, f, ensure_ascii=False, indent=1)
print("ok")
