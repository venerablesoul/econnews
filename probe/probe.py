"""Probe round 18: the news bot runs but its git pushes stopped at 12:03 UTC.
Cancel the stuck run (its "Save state" step still runs), read its logs, make sure state.json on main
remembers the stories the bot handled since then (so nothing is sent twice), and start a fresh run."""
import json, os, subprocess, time, urllib.request
API = "https://econnews-bot.econnews-6dce35.workers.dev"
GH = "https://api.github.com/repos/venerablesoul/econnews"
TOK = os.environ["GH_TOKEN"]
OUT = {"log": []}


def note(*a):
    OUT["log"].append(" ".join(str(x) for x in a)); print(*a, flush=True)


def gh(path, method="GET", body=None):
    req = urllib.request.Request(GH + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"User-Agent": "probe", "Authorization": "Bearer " + TOK, "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            b = r.read()
            return json.loads(b) if b else {"_status": r.status}
    except urllib.error.HTTPError as e:
        return {"_status": e.code, "_body": e.read()[:300].decode("utf-8", "replace")}


def sh(*a, cwd=None):
    r = subprocess.run(list(a), capture_output=True, text=True, cwd=cwd, timeout=300)
    return r.returncode, (r.stdout + r.stderr)[-1500:]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def job_logs(jid):
    req = urllib.request.Request(f"{GH}/actions/jobs/{jid}/logs", headers={"User-Agent": "probe", "Authorization": "Bearer " + TOK})
    try:
        urllib.request.build_opener(NoRedirect).open(req, timeout=60)
    except urllib.error.HTTPError as e:
        loc = e.headers.get("Location")
        if not loc:
            return f"no logs: HTTP {e.code}"
        with urllib.request.urlopen(urllib.request.Request(loc, headers={"User-Agent": "probe"}), timeout=120) as r:
            return r.read().decode("utf-8", "replace")
    return "no logs"


live = json.loads(urllib.request.urlopen(urllib.request.Request(API + "/api/live", headers={"User-Agent": "probe"}), timeout=30).read())
note("live updated", live.get("updated"), "stories", len(live.get("news") or []))

# 1) still stuck? (no news-bot commit on main after 12:03 UTC)
sh("git", "fetch", "-q", "origin", "main")
rc, last_bot = sh("git", "log", "-1", "--author=news-bot", "--format=%cI %h", "origin/main")
note("last news-bot commit on main:", last_bot.strip())
runs = gh("/actions/workflows/news.yml/runs?per_page=1")["workflow_runs"]
run = runs[0]
note("run", run["id"], run["status"])
if last_bot.strip() < "2026-10-15T12:10" and run["status"] == "in_progress":
    note("cancel:", gh(f"/actions/runs/{run['id']}/cancel", "POST"))
    for _ in range(60):
        time.sleep(10)
        r = gh(f"/actions/runs/{run['id']}")
        if r.get("status") == "completed":
            break
    note("after cancel:", r.get("status"), r.get("conclusion"))
jobs = gh(f"/actions/runs/{run['id']}/jobs")["jobs"]
note("steps:", [(s["name"], s["conclusion"]) for s in jobs[0]["steps"]])
logs = job_logs(jobs[0]["id"])
lines = logs.splitlines()
with open("probe/out_log.txt", "w") as f:
    f.write("\n".join(lines[:60] + ["...."] + [l for l in lines if "!" in l or "git" in l.lower() or "error" in l.lower() or "restart" in l.lower()][-250:]
                      + ["...."] + lines[-200:]))
note("log lines", len(lines))

# 2) state.json on main: add the stories the bot handled after its last saved state
sh("git", "fetch", "-q", "origin", "main")
sh("git", "worktree", "add", "-f", "/tmp/main", "origin/main")
rc, last_bot = sh("git", "log", "-1", "--author=news-bot", "--format=%cI %h", "origin/main")
note("last news-bot commit after cancel:", last_bot.strip())
st = json.load(open("/tmp/main/state.json"))
have = {r.get("title") for r in st.get("recent", [])}
add = []
for n in live.get("news") or []:
    if n.get("title") in have or not n.get("ts"):
        continue
    rec = {"title": n["title"], "link": n.get("link"), "sources": n.get("sources") or [], "score": 6 if n.get("level") == "high" else 3, "ts": n["ts"]}
    for k in ("title_ru", "title_en", "lead", "lead_ru", "lead_en", "tags", "ai"):
        if n.get(k):
            rec[k] = n[k]
    add.append(rec)
note("stories to remember:", len(add), [a["title"][:50] for a in add[:5]])
if add:
    st["recent"] = sorted(st["recent"] + add, key=lambda r: r["ts"])
    with open("/tmp/main/state.json", "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=1)
    sh("git", "-C", "/tmp/main", "add", "state.json")
    note("commit:", sh("git", "-C", "/tmp/main", "-c", "user.name=news-bot", "-c", "user.email=news-bot@users.noreply.github.com",
                       "commit", "-q", "-m", "news update: remember the stories handled while the save was stuck"))
    for _ in range(3):
        rc, out = sh("git", "-C", "/tmp/main", "push", "origin", "HEAD:main")
        note("push:", rc, out[-300:])
        if rc == 0:
            break
        sh("git", "-C", "/tmp/main", "pull", "--rebase", "-q", "origin", "main")

# 3) a fresh run now (the schedule would start one within 30 minutes anyway)
note("dispatch:", gh("/actions/workflows/news.yml/dispatches", "POST", {"ref": "main"}))
with open("probe/out14.json", "w") as f:
    json.dump(OUT, f, ensure_ascii=False, indent=1)
