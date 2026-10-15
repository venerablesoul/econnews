"""Probe round 3: why SEC financials are not saved; free Yahoo quote endpoints; Google translate to English."""
import json, os, sys, time, traceback, urllib.request, urllib.parse
sys.path.insert(0, os.path.dirname(__file__))
R = {"env_sec_ua_set": bool(os.environ.get("SEC_USER_AGENT", "").strip())}
import stocks_main as S
from datetime import datetime, timezone
S.FIN_DIR = os.path.join(os.path.dirname(__file__), "fin")
for ua_name, ua in [("default", None), ("plain", "EconNews venerablesoul@users.noreply.github.com")]:
    try:
        if ua:
            os.environ["SEC_USER_AGENT"] = ua
        h = S.sec_headers()
        S._CIK.clear() if hasattr(S._CIK, "clear") else None
        t0 = time.time()
        cik = S.cik_for("AAPL", h)
        facts = S._json(S.SEC_FACTS_URL.format(cik=cik), h, timeout=60)
        fin = S.financials_from_facts(facts)
        R["sec_" + ua_name] = {"ok": True, "cik": cik, "sec": round(time.time() - t0, 1), "annual": fin["annual"][:1], "q": fin["quarterly"][:2]}
    except Exception as e:
        R["sec_" + ua_name] = {"ok": False, "err": f"{type(e).__name__}: {e}", "tb": traceback.format_exc()[-600:]}
try:
    n = S.update_financials(["MSFT", "NVDA"], datetime.now(timezone.utc), limit=2)
    R["update_financials"] = {"n": n, "files": os.listdir(S.FIN_DIR)}
except Exception as e:
    R["update_financials"] = {"err": repr(e), "tb": traceback.format_exc()[-800:]}
def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": S.UA}), timeout=20) as r:
            return r.status, r.read()[:600].decode("utf-8", "replace")
    except Exception as e:
        return -1, repr(e)[:300]
R["gtr_en"] = get("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=" + urllib.parse.quote("Сбербанк повысил прогноз по прибыли"))
os.makedirs("probe", exist_ok=True)
json.dump(R, open("probe/out.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(R, ensure_ascii=False)[:3000])
