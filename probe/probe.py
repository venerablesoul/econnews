"""Probe round 16 (logs through the redirect without the token): why the news bot stopped committing — its live feed, its job and logs."""
import json, os, time, urllib.request
API = "https://econnews-bot.econnews-6dce35.workers.dev"
GH = "https://api.github.com/repos/venerablesoul/econnews"
TOK = os.environ.get("GH_TOKEN", "")
OUT = {}


def get(url, auth=False, raw=False):
    h = {"User-Agent": "probe"}
    if auth:
        h["Authorization"] = "Bearer " + TOK
        h["Accept"] = "application/vnd.github+json"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=60) as r:
            b = r.read()
            return b.decode("utf-8", "replace") if raw else json.loads(b)
    except urllib.error.HTTPError as e:
        return {"_status": e.code, "_body": e.read()[:300].decode("utf-8", "replace")}
    except Exception as e:
        return {"_err": repr(e)[:300]}


live = get(API + "/api/live")
OUT["live"] = {"updated": live.get("updated"), "n": len(live.get("news") or []), "now": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
runs = get(GH + "/actions/workflows/news.yml/runs?per_page=2", auth=True)
OUT["runs"] = [(r["id"], r["status"], r["created_at"]) for r in runs.get("workflow_runs", [])]
rid = runs["workflow_runs"][0]["id"]
jobs = get(f"{GH}/actions/runs/{rid}/jobs", auth=True)
OUT["jobs"] = [(j["id"], j["status"], j["started_at"], [(s["name"], s["status"]) for s in j["steps"]]) for j in jobs.get("jobs", [])]
jid = jobs["jobs"][0]["id"]
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def job_logs(jid):
    req = urllib.request.Request(f"{GH}/actions/jobs/{jid}/logs", headers={"User-Agent": "probe", "Authorization": "Bearer " + TOK,
                                                                       "Accept": "application/vnd.github+json"})
    try:
        urllib.request.build_opener(NoRedirect).open(req, timeout=60)
        return {"_err": "no redirect"}
    except urllib.error.HTTPError as e:
        loc = e.headers.get("Location")
        if not loc:
            return {"_status": e.code, "_body": e.read()[:300].decode("utf-8", "replace")}
    with urllib.request.urlopen(urllib.request.Request(loc, headers={"User-Agent": "probe"}), timeout=120) as r:
        return r.read().decode("utf-8", "replace")


try:
    logs = job_logs(jid)
except Exception as e:
    logs = {"_err": repr(e)[:300]}
if isinstance(logs, str):
    lines = logs.splitlines()
    OUT["log_lines"] = len(lines)
    with open("probe/out_log.txt", "w") as f:
        f.write("\n".join(lines[-400:]))
else:
    OUT["logs"] = logs
with open("probe/out11.json", "w") as f:
    json.dump(OUT, f, ensure_ascii=False, indent=1)
