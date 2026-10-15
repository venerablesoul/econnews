"""Probe round 20: which TradingView symbols the free widget shows; is Finnhub's earnings calendar cut off."""
import json, os, subprocess, urllib.request
from datetime import date, timedelta
OUT = {}
KEY = os.environ.get("FINNHUB_API_KEY", "")


def cal(a, b):
    u = f"https://finnhub.io/api/v1/calendar/earnings?from={a}&to={b}&token={KEY}"
    d = json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "probe"}), timeout=60).read())
    rows = d.get("earningsCalendar") or []
    ds = sorted(r.get("date") for r in rows)
    return {"n": len(rows), "first": ds[:1], "last": ds[-1:], "aapl_jpm_nflx_tsla": sorted({r["symbol"] + " " + r["date"] for r in rows if r.get("symbol") in ("AAPL", "JPM", "NFLX", "TSLA", "MSFT", "KO")})}


t = date.today()
for a, b in ((t - timedelta(7), t + timedelta(21)), (t, t + timedelta(7)), (t + timedelta(1), t + timedelta(1)), (t + timedelta(6), t + timedelta(6)), (t - timedelta(2), t - timedelta(1))):
    try:
        OUT[f"cal {a}..{b}"] = cal(a.isoformat(), b.isoformat())
    except Exception as e:
        OUT[f"cal {a}..{b}"] = repr(e)
r = subprocess.run("pip install -q playwright && python -m playwright install --with-deps chromium >/dev/null && python probe/tv_check.py",
                   shell=True, capture_output=True, text=True, timeout=1500)
OUT["tv_rc"], OUT["tv_err"] = r.returncode, r.stderr[-1500:]
try:
    OUT["tv"] = json.loads(r.stdout.strip().splitlines()[-1])
except Exception:
    OUT["tv_raw"] = r.stdout[-1500:]
with open("probe/out17.json", "w") as f:
    json.dump(OUT, f, ensure_ascii=False, indent=1)
