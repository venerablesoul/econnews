#!/usr/bin/env python3
"""
Keeps the news bot running on GitHub Actions without anyone's help (standard library only).

Why: the bot lives in GitHub Actions sessions of ~5.5 hours (a job may run at most 6 hours). The next session used to
be started by the schedule "*/30 * * * *", but GitHub fires such a schedule only every 4–8 hours on this repository,
so the bot was silent for 1–2.5 hours between sessions, once or twice a day.

How: every session queues the next one itself right after its first good check — a workflow_dispatch made with the
job's own GITHUB_TOKEN (GitHub lets exactly this event start a new run). The queued session waits ("pending": the
concurrency group in news.yml lets one session run and one wait) and starts the moment the current one ends,
also when the current one dies unexpectedly. keepalive.yml is the safety net that restarts the chain if it ever breaks.

  python relay.py next [--if-healthy]   queue the next news session unless one is already waiting
                                        (--if-healthy: only if this session got through at least one check)
  python relay.py keepalive [--fresh]   start a news session if none runs or waits; keep the workflows enabled
                                        (--fresh: start one anyway, so a changed news.yml applies from the next session)

Never starts a second copy, and never touches a workflow disabled by hand:
Actions → Economic news → ⋯ → Disable workflow is the off switch.
Outside GitHub Actions (a server, a home computer) everything here does nothing.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request

NEWS = "news.yml"
KEEPALIVE = "keepalive.yml"
WAITING = ("queued", "pending", "waiting", "requested")   # created, not started yet
ACTIVE = WAITING + ("in_progress",)


def _env(name):
    return os.environ.get(name, "").strip()


def news_workflow():
    return _env("RELAY_WORKFLOW") or NEWS


def token():
    return _env("RELAY_TOKEN") or _env("GITHUB_TOKEN")


def repo():
    return _env("GITHUB_REPOSITORY")


def enabled():
    """Only inside GitHub Actions, and only when the workflow handed the bot its token."""
    return _env("GITHUB_ACTIONS") == "true" and bool(token()) and bool(repo())


def call(method, path, body=None, timeout=20):
    """(HTTP status, JSON answer). Network trouble is status 0, never an exception."""
    url = (_env("GITHUB_API_URL") or "https://api.github.com").rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": "Bearer " + token(), "Accept": "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "econnews-relay"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}
    except (urllib.error.URLError, OSError, ValueError) as e:
        return 0, {"message": f"{type(e).__name__}: {e}"[:200]}


def _why(status, d):
    return f"HTTP {status}: {(d or {}).get('message', '')}".strip().rstrip(":")[:200]


def workflow_state(wf=None):
    """'active', 'disabled_manually', 'disabled_inactivity', … — or '' when GitHub could not be asked."""
    status, d = call("GET", f"/repos/{repo()}/actions/workflows/{wf or news_workflow()}")
    return (d.get("state") or "") if status == 200 else ""


def stopped(wf=None):
    """The owner switched the bot off: the workflow is disabled by hand."""
    return enabled() and workflow_state(wf) == "disabled_manually"


def runs(wf=None, n=30):
    """The newest runs of the workflow (a waiting run is always among them)."""
    status, d = call("GET", f"/repos/{repo()}/actions/workflows/{wf or news_workflow()}/runs?per_page={n}")
    if status != 200:
        raise RuntimeError("runs: " + _why(status, d))
    return d.get("workflow_runs") or []


def default_ref():
    return _env("RELAY_REF") or _env("GITHUB_REF_NAME") or "main"


def dispatch(wf=None, ref=None):
    """Starts the workflow (it waits if a session is running). (ok, error text)."""
    last = ""
    for attempt in range(3):
        status, d = call("POST", f"/repos/{repo()}/actions/workflows/{wf or news_workflow()}/dispatches",
                         {"ref": ref or default_ref()})
        if status in (200, 201, 204):
            return True, ""
        last = _why(status, d)
        if status and status < 500 and status != 429:
            break   # refused (no permission, workflow disabled, wrong branch): asking again will not help
        time.sleep(3 * (attempt + 1))
    return False, last


def keep_enabled(*wfs):
    """GitHub switches off scheduled workflows of a repository that had no commits for 60 days; touching 'enable'
    keeps them on (the bot's data goes to gh-pages, so main may go quiet for months).
    A workflow disabled by hand is left as it is."""
    out = {}
    for wf in wfs:
        state = workflow_state(wf)
        if state in ("active", "disabled_inactivity"):
            status, d = call("PUT", f"/repos/{repo()}/actions/workflows/{wf}/enable")
            out[wf] = "on" if status in (200, 204) else _why(status, d)
        else:
            out[wf] = state or "unknown"
    return out


def queue_next(wf=None):
    """From inside a news session: make sure one more session waits after this one. Returns what happened."""
    if not enabled():
        return "off (not on GitHub Actions)"
    wf = wf or news_workflow()
    try:
        state = workflow_state(wf)
        if state == "disabled_manually":
            return "not queued: the workflow is disabled by hand"
        if state == "disabled_inactivity":
            keep_enabled(wf)
        me = _env("GITHUB_RUN_ID")
        if any(r.get("status") in ACTIVE and str(r.get("id")) != me for r in runs(wf)):
            return "already waiting"
        ok, err = dispatch(wf)
        return "queued" if ok else "could not queue: " + err
    except Exception as e:   # never let this stop the bot
        return f"could not queue: {type(e).__name__}: {e}"[:200]


def keepalive(fresh=False, wf=None):
    """keepalive.yml: start a news session if none runs or waits. Returns what happened."""
    if not enabled():
        return "off (not on GitHub Actions)"
    wf = wf or news_workflow()
    try:
        kept = keep_enabled(wf, KEEPALIVE)
        state = workflow_state(wf)
        if state == "disabled_manually":
            return "the news workflow is disabled by hand — leaving it off"
        active = [r for r in runs(wf) if r.get("status") in ACTIVE]
        if active and not fresh:
            what = ", ".join(sorted({r.get("status") for r in active}))
            return f"the bot is fine ({what}); workflows: {kept}"
        ok, err = dispatch(wf)
        if not ok:
            return "::warning::could not start the news bot: " + err
        return ("started a new session" if not active else "queued a session with the new settings") + f"; workflows: {kept}"
    except Exception as e:
        return f"::warning::keepalive: {type(e).__name__}: {e}"[:200]


# A session that never got through a single check must not queue another one: broken code would otherwise
# restart itself in a loop. The bot marks the session healthy after its first good check.
def _marker():
    return os.path.join(_env("RUNNER_TEMP") or tempfile.gettempdir(), "econnews-healthy")


def mark_healthy():
    try:
        with open(_marker(), "w") as f:
            f.write(str(time.time()))
    except OSError:
        pass


def healthy():
    return os.path.exists(_marker())


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd == "next":
        if "--if-healthy" in argv and not healthy():
            print("This session never got through a check — not queueing another one (the keepalive and the "
                  "owner alert take over).")
            return 0
        print("Next session:", queue_next())
        return 0
    if cmd == "keepalive":
        print(keepalive(fresh="--fresh" in argv))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
