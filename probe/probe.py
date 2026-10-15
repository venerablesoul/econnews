"""Probe round 21: the fixes on the live site; the earnings calendar with the new splitting."""
import io, json, os, subprocess, sys, tarfile
from datetime import date
OUT = {}
os.makedirs("/tmp/m", exist_ok=True)
subprocess.run("git fetch -q --depth 1 origin main", shell=True)
arch = subprocess.run(["git", "archive", "FETCH_HEAD", "stocks.py"], capture_output=True).stdout
tarfile.open(fileobj=io.BytesIO(arch)).extractall("/tmp/m")
sys.path.insert(0, "/tmp/m")
import stocks
ev = stocks.fetch_earnings(os.environ["FINNHUB_API_KEY"], date.today())
OUT["earnings_n"] = len(ev)
OUT["earnings_dates"] = sorted({e["d"] for e in ev})
OUT["earnings_sample"] = [f'{e["d"]} {e["s"]}' for e in ev if e["d"] >= date.today().isoformat()][:25]
r = subprocess.run("pip install -q playwright && python -m playwright install --with-deps chromium >/dev/null && python probe/live2.py",
                   shell=True, capture_output=True, text=True, timeout=1800, env={**os.environ, "PAGES": "https://venerablesoul.github.io/econnews/"})
OUT["rc"], OUT["err"] = r.returncode, r.stderr[-1200:]
try:
    OUT["live"] = json.loads(r.stdout.strip().splitlines()[-1])
except Exception:
    OUT["raw"] = r.stdout[-1500:]
with open("probe/out18.json", "w") as f:
    json.dump(OUT, f, ensure_ascii=False, indent=1)
subprocess.run("git add probe/shots2", shell=True)
