"""Проверка, что сервер бота задеплоен из текущего коммита: последний запуск workflow «Bot server (Cloudflare)» зелёный.
Запуск: python3 tests/check_deploy.py [sha]  → «DEPLOY OK»."""
import json
import subprocess
import sys
import urllib.request

ROOT = __file__.rsplit("/tests/", 1)[0]
REPO = "venerablesoul/econnews"
want = sys.argv[1] if len(sys.argv) > 1 else ""
if not want:
    want = subprocess.run(["git", "-C", ROOT, "log", "-1", "--format=%H", "--", "worker", ".github/workflows/worker.yml"],
                          capture_output=True, text=True).stdout.strip()
runs = json.loads(urllib.request.urlopen(f"https://api.github.com/repos/{REPO}/actions/workflows/worker.yml/runs?per_page=10").read())["workflow_runs"]
mine = [r for r in runs if r["head_sha"] == want]
if not mine:
    # деплой мог пройти на более позднем коммите (бот добавляет свои коммиты с данными)
    log = subprocess.run(["git", "-C", ROOT, "rev-list", "origin/main"], capture_output=True, text=True).stdout.split()
    later = log[:log.index(want)] if want in log else []
    mine = [r for r in runs if r["head_sha"] in later]
if not mine:
    print("Деплоя для", want[:7], "ещё нет. Последние:", [(r["head_sha"][:7], r["status"], r["conclusion"]) for r in runs[:3]])
    sys.exit(1)
r = mine[0]
print(f"Bot server: {r['head_sha'][:7]} {r['status']} {r['conclusion']} {r['html_url']}")
if r["status"] == "completed" and r["conclusion"] == "success":
    print("DEPLOY OK")
else:
    sys.exit(1)
