"""Checks the live data the news bot published on GitHub (the main branch).
Run: python3 tests/check_live.py  → "LIVE DATA OK" when everything is in place."""
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone

ROOT = __file__.rsplit("/tests/", 1)[0]


def git(*a):
    return subprocess.run(["git", "-C", ROOT, *a], capture_output=True, text=True)


def show(path):
    r = git("show", "origin/main:" + path)
    if r.returncode:
        raise FileNotFoundError(path)
    return json.loads(r.stdout)


git("fetch", "-q", "origin", "main")
now = datetime.now(timezone.utc)
problems = []


def fresh(iso, hours):
    try:
        return datetime.fromisoformat(iso) > now - timedelta(hours=hours)
    except Exception:
        return False


try:
    s = show("docs/stocks.json")
    rows = s.get("stocks") or []
    px = [r for r in rows if r.get("px")]
    pe = [r for r in rows if r.get("pe") is not None]
    mc = [r for r in rows if r.get("mcap")]
    secs = sorted({r.get("sec") for r in rows})
    print(f"stocks.json: updated {s.get('updated')}, companies {len(rows)}, with price {len(px)}, with P/E {len(pe)}, "
          f"with market cap {len(mc)}, earnings in the calendar {len(s.get('earnings') or [])}, sectors {secs[:4]}…")
    if not fresh(s.get("updated", ""), 3):
        problems.append("stocks.json is stale")
    if len(px) < 100:
        problems.append("fewer than 100 prices")
    if len(pe) < 12 or len(mc) < 12:
        problems.append("fewer than 12 ratios")
    if len(s.get("earnings") or []) < 3:
        problems.append("fewer than 3 events in the earnings calendar")
    if "Technology" not in secs:
        problems.append("sectors are not in English yet")
except FileNotFoundError:
    problems.append("no docs/stocks.json")

try:
    r = show("docs/rates.json")
    curves = r.get("curves") or {}
    print(f"rates.json: updated {r.get('updated')}, curves {sorted(curves)}, central banks {len(r.get('cb') or [])}, "
          f"Fed meetings {len((r.get('wirp') or {}).get('meetings') or [])}, US curve name {(curves.get('US') or {}).get('name')!r}")
    for c in ("US", "DE", "UK", "JP", "RU"):
        if c not in curves or len(curves[c].get("y") or []) < 3:
            problems.append(f"no {c} curve")
    if (curves.get("US") or {}).get("name_ru") is None:
        problems.append("curve names have no Russian variant yet")
    if len(r.get("cb") or []) < 10:
        problems.append("fewer than 10 central bank rates")
    if not (r.get("wirp") or {}).get("meetings"):
        problems.append("no WIRP")
    if not fresh(r.get("updated", ""), 4):
        problems.append("rates.json is stale")
except FileNotFoundError:
    problems.append("no docs/rates.json")

ls = git("ls-tree", "--name-only", "origin/main", "docs/fin/").stdout.split()
print(f"docs/fin: financials files {len(ls)}")
if len(ls) < 4:
    problems.append("fewer than 4 financials files")
else:
    f = show(ls[0])
    a, q = f.get("annual") or [], f.get("quarterly") or []
    print(f"  {ls[0]}: years {len(a)}, quarters {len(q)}, latest revenue {q[0].get('rev') if q else None}")
    if not a or not q or q[0].get("rev") is None:
        problems.append(f"{ls[0]} has no revenue")

d = show("docs/data.json")
news = d.get("news") or []
tk = [n for n in news if n.get("tk")]
both = [n for n in news if n.get("lang") and (n.get("title_ru") or n.get("title_en"))]
ins = (d.get("trades") or {}).get("insiders") or []
print(f"data.json: stories {len(news)}, with tickers {len(tk)}, with a translation {len(both)}, insider trades {len(ins)}"
      + (f" (e.g. {tk[0]['tk']}: {tk[0]['title'][:60]})" if tk else ""))
if not tk:
    problems.append("no story has tickers")
if news and not both:
    problems.append("stories have no translations yet (new format)")

if problems:
    print("PROBLEMS: " + "; ".join(problems))
    sys.exit(1)
print("LIVE DATA OK")
