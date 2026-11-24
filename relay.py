#!/usr/bin/env python3
"""
  python relay.py next [--if-healthy]
  python relay.py keepalive [--fresh]
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
WAITING = ("queued", "pending", "waiting", "requested")
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
    return _env("GITHUB_ACTIONS") == "true" and bool(token()) and bool(repo())


def call(method, path, body=None, timeout=20):
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
    status, d = call("GET", f"/repos/{repo()}/actions/workflows/{wf or news_workflow()}")
    return (d.get("state") or "") if status == 200 else ""


def stopped(wf=None):
    return enabled() and workflow_state(wf) == "disabled_manually"


def runs(wf=None, n=30):
    status, d = call("GET", f"/repos/{repo()}/actions/workflows/{wf or news_workflow()}/runs?per_page={n}")
    if status != 200:
        raise RuntimeError("runs: " + _why(status, d))
    return d.get("workflow_runs") or []


def default_ref():
    return _env("RELAY_REF") or _env("GITHUB_REF_NAME") or "main"


def dispatch(wf=None, ref=None):
    last = ""
    for attempt in range(3):
        status, d = call("POST", f"/repos/{repo()}/actions/workflows/{wf or news_workflow()}/dispatches",
                         {"ref": ref or default_ref()})
        if status in (200, 201, 204):
            return True, ""
        last = _why(status, d)
        if status and status < 500 and status != 429:
            break
        time.sleep(3 * (attempt + 1))
    return False, last


def keep_enabled(*wfs):
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
    except Exception as e:
        return f"could not queue: {type(e).__name__}: {e}"[:200]


def keepalive(fresh=False, wf=None):
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
