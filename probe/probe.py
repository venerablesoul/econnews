"""Probe round 4: which SEC request/header combination works from GitHub runners."""
import gzip, json, os, urllib.request, itertools
R = {}
UAS = {"research": "EconNews research bot econnews@example.com",
       "trades": "EconNews venerablesoul@users.noreply.github.com",
       "sample": "Sample Company Name AdminContact@samplecompanydomain.com",
       "browser": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
URLS = {"tickers": "https://www.sec.gov/files/company_tickers.json",
        "facts": "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
        "concept": "https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/NetIncomeLoss.json",
        "submissions": "https://data.sec.gov/submissions/CIK0000320193.json",
        "feed": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&company=&dateb=&owner=include&start=0&count=10&output=atom"}
for (un, ua), (k, url), enc in itertools.product(UAS.items(), URLS.items(), ["identity", "gzip, deflate"]):
    h = {"User-Agent": ua, "Accept-Encoding": enc, "Accept": "*/*"}
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            R[f"{un}|{k}|{enc[:4]}"] = [r.status, len(raw)]
    except urllib.error.HTTPError as e:
        R[f"{un}|{k}|{enc[:4]}"] = [e.code, e.read()[:120].decode("utf-8", "replace")]
    except Exception as e:
        R[f"{un}|{k}|{enc[:4]}"] = [-1, repr(e)[:120]]
os.makedirs("probe", exist_ok=True)
json.dump(R, open("probe/out.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(R, ensure_ascii=False, indent=1))
