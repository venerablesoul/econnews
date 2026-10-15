"""Probe round 17: does a push of the next company / option files get rejected (push protection, size, rules)?"""
import json, os, subprocess, sys, tarfile, io, time
OUT = {}
M = "/tmp/m"
os.makedirs(M, exist_ok=True)


def sh(*a, cwd=None):
    r = subprocess.run(list(a), capture_output=True, text=True, cwd=cwd, timeout=600)
    return {"rc": r.returncode, "out": (r.stdout or "")[-1500:], "err": (r.stderr or "")[-2500:]}


OUT["fetch"] = sh("git", "fetch", "--depth", "1", "origin", "main")
arch = subprocess.run(["git", "archive", "FETCH_HEAD", "company.py", "options.py", "stocks.py", "moex.py", "macro.py"], capture_output=True).stdout
tarfile.open(fileobj=io.BytesIO(arch)).extractall(M)
built = subprocess.run(["git", "ls-tree", "--name-only", "FETCH_HEAD", "docs/co/"], capture_output=True, text=True).stdout.split()
sys.path.insert(0, M)
import company, options, moex, stocks
done = {os.path.basename(x)[:-5] for x in built}
todo = [t for t in sorted(t for t, *_ in stocks.UNIVERSE) if t not in done][:14]
OUT["todo"] = todo
os.makedirs("probe/pushtest/co", exist_ok=True); os.makedirs("probe/pushtest/opt", exist_ok=True)
t0 = time.time()
OUT["co_written"] = company.build(tickers=todo, limit=14, out_dir="probe/pushtest/co", sleep=0.3)
OUT["opt_written"] = options.build(tickers=todo[:8], limit=8, out_dir="probe/pushtest/opt", summary_path="probe/pushtest/options.json", sleep=0.3)
OUT["moex"] = moex.build(path="probe/pushtest/moex.json", max_age_min=0)
OUT["build_sec"] = round(time.time() - t0, 1)
OUT["sizes"] = {f: os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk("probe/pushtest") for f in fs}
sh("git", "config", "user.name", "news-bot"); sh("git", "config", "user.email", "news-bot@users.noreply.github.com")
OUT["add"] = sh("git", "add", "probe/pushtest")
OUT["commit"] = sh("git", "commit", "-q", "-m", "push test: company and option files")
OUT["push"] = sh("git", "push", "origin", "HEAD:probe")
with open("probe/out12.json", "w") as f:
    json.dump(OUT, f, ensure_ascii=False, indent=1)
