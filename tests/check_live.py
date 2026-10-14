"""Проверка живых данных, которые основной бот опубликовал на GitHub (ветка main).
Запуск: python3 tests/check_live.py  → «LIVE DATA OK», если всё на месте."""
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
    print(f"stocks.json: обновлён {s.get('updated')}, компаний {len(rows)}, с ценой {len(px)}, с P/E {len(pe)}, с капитализацией {len(mc)}, отчётов в календаре {len(s.get('earnings') or [])}")
    if not fresh(s.get("updated", ""), 3):
        problems.append("stocks.json устарел")
    if len(px) < 100:
        problems.append("цен меньше 100")
    if len(pe) < 12 or len(mc) < 12:
        problems.append("мультипликаторов меньше 12")
    if len(s.get("earnings") or []) < 3:
        problems.append("в календаре отчётов меньше 3 событий")
except FileNotFoundError:
    problems.append("нет docs/stocks.json")

try:
    r = show("docs/rates.json")
    curves = r.get("curves") or {}
    print(f"rates.json: обновлён {r.get('updated')}, кривые {sorted(curves)}, ставок ЦБ {len(r.get('cb') or [])}, "
          f"заседаний ФРС {len((r.get('wirp') or {}).get('meetings') or [])}")
    for c in ("US", "DE", "UK", "JP", "RU"):
        if c not in curves or len(curves[c].get("y") or []) < 3:
            problems.append(f"нет кривой {c}")
    if len(r.get("cb") or []) < 10:
        problems.append("ставок ЦБ меньше 10")
    if not (r.get("wirp") or {}).get("meetings"):
        problems.append("нет WIRP")
    if not fresh(r.get("updated", ""), 4):
        problems.append("rates.json устарел")
except FileNotFoundError:
    problems.append("нет docs/rates.json")

ls = git("ls-tree", "--name-only", "origin/main", "docs/fin/").stdout.split()
print(f"docs/fin: файлов отчётности {len(ls)}")
if len(ls) < 4:
    problems.append("файлов отчётности меньше 4")
else:
    f = show(ls[0])
    a, q = f.get("annual") or [], f.get("quarterly") or []
    print(f"  {ls[0]}: лет {len(a)}, кварталов {len(q)}, последняя выручка {q[0].get('rev') if q else None}")
    if not a or not q or q[0].get("rev") is None:
        problems.append(f"в {ls[0]} нет выручки")

d = show("docs/data.json")
tk = [n for n in d.get("news") or [] if n.get("tk")]
print(f"data.json: новостей {len(d.get('news') or [])}, с тикерами {len(tk)}" + (f" (например {tk[0]['tk']}: {tk[0]['title'][:60]})" if tk else ""))
if not tk:
    problems.append("ни в одной новости нет тикеров")

if problems:
    print("ПРОБЛЕМЫ: " + "; ".join(problems))
    sys.exit(1)
print("LIVE DATA OK")
