"""Probe round 19: everything new, for real — the bot commands on real data (Telegram intercepted) and the live terminal in a browser."""
import io, json, os, subprocess, tarfile, urllib.request
OUT = {}


def sh(cmd, env=None, timeout=900):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout, env={**os.environ, **(env or {})})
    return r.returncode, r.stdout, r.stderr[-3000:]


os.makedirs("/tmp/m", exist_ok=True)
sh("git fetch -q --depth 1 origin main")
arch = subprocess.run(["git", "archive", "FETCH_HEAD", "worker", "tests"], capture_output=True).stdout
tarfile.open(fileobj=io.BytesIO(arch)).extractall("/tmp/m")
pages = "https://venerablesoul.github.io/econnews/"
try:
    urllib.request.urlopen(pages + "stocks.json", timeout=30).read()
except Exception as e:
    OUT["pages_err"] = repr(e)
OUT["pages"] = pages
rc, out, err = sh("node probe/real_bot.mjs", {"PAGES": pages})
OUT["bot_rc"], OUT["bot_err"] = rc, err
try:
    OUT["bot"] = json.loads(out.strip().splitlines()[-1])
except Exception:
    OUT["bot_raw"] = out[-3000:]
OUT["pw_install"] = sh("pip install -q playwright && python -m playwright install --with-deps chromium", timeout=900)[0]
rc, out, err = sh("python probe/real_terminal.py", {"PAGES": pages}, timeout=1200)
OUT["term_rc"], OUT["term_err"] = rc, err
try:
    OUT["terminal"] = json.loads(out.strip().splitlines()[-1])
except Exception:
    OUT["term_raw"] = out[-3000:]
with open("probe/out15.json", "w") as f:
    json.dump(OUT, f, ensure_ascii=False, indent=1)
