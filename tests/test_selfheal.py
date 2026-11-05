"""The bot keeps itself running: GitHub Actions sessions queue each other (relay.py), broken code is not taken
(self-check + rollback), one failing part does not stop a run, a hung run is restarted, the owner hears only what the
bot cannot fix. No network: GitHub's API is a local fake with GitHub's concurrency rule, git repos are temporary.
Run: python3 -m unittest tests.test_selfheal -v"""
import contextlib
import http.server
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
from datetime import datetime, timedelta, timezone
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

import i18n      # noqa: E402
import news_bot  # noqa: E402
import relay     # noqa: E402

try:
    import yaml  # noqa: F401  (the workflow tests read .github/workflows; tests.yml installs it)
    HAS_YAML = True
except ImportError:
    HAS_YAML = False

ACTIONS_ENV = ("GITHUB_ACTIONS", "GITHUB_TOKEN", "RELAY_TOKEN", "GITHUB_REPOSITORY", "GITHUB_API_URL", "GITHUB_RUN_ID",
               "RUNNER_TEMP", "RELAY_REF", "RELAY_WORKFLOW", "BOT_PINNED", "BOT_MAIN_BAD", "BOT_MAIN_REPORT",
               "BOT_BAD_CODE", "LOOP_DEADLINE")


@contextlib.contextmanager
def clean_env(**extra):
    """No GitHub Actions variables (the test suite itself runs on GitHub Actions) plus `extra`."""
    with mock.patch.dict(os.environ):
        for k in ACTIONS_ENV:
            os.environ.pop(k, None)
        os.environ.update({k: str(v) for k, v in extra.items()})
        yield


# ---------------------------------------------------------------------------------------------------------------
# A fake of GitHub's Actions API for one repository, with the rule of `concurrency` in news.yml:
# one run in progress and one pending; a newer pending run cancels the older pending one.
# ---------------------------------------------------------------------------------------------------------------
class FakeGitHub:
    TOKEN = "ghs_test"

    def __init__(self):
        self.state = {"news.yml": "active", "keepalive.yml": "active"}
        self.runs = []          # newest last
        self.calls = []         # (method, path)
        self.outage = 0         # answer everything with this HTTP status
        self.refuse_dispatch = 0
        self.next_id = 100
        self.lock = threading.Lock()
        gh = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def answer(self, status, body=None):
                raw = json.dumps(body).encode() if body is not None else b""
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def handle_any(self, method):
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n) or b"{}") if n else {}
                path = self.path.split("?")[0]
                with gh.lock:
                    gh.calls.append((method, path))
                    if self.headers.get("Authorization") != "Bearer " + FakeGitHub.TOKEN:
                        return self.answer(401, {"message": "Bad credentials"})
                    if gh.outage:
                        return self.answer(gh.outage, {"message": "outage"})
                    parts = path.strip("/").split("/")   # repos o r actions workflows <wf> [runs|dispatches|enable]
                    if parts[:5] != ["repos", "o", "r", "actions", "workflows"] or len(parts) < 6:
                        return self.answer(404, {"message": "Not Found"})
                    wf, tail = parts[5], parts[6:] if len(parts) > 6 else []
                    if wf not in gh.state:
                        return self.answer(404, {"message": "Not Found"})
                    if method == "GET" and not tail:
                        return self.answer(200, {"path": ".github/workflows/" + wf, "state": gh.state[wf]})
                    if method == "GET" and tail == ["runs"]:
                        runs = [r for r in reversed(gh.runs) if r["wf"] == wf][:30]
                        return self.answer(200, {"total_count": len(runs), "workflow_runs": runs})
                    if method == "PUT" and tail == ["enable"]:
                        gh.state[wf] = "active"
                        return self.answer(204)
                    if method == "POST" and tail == ["dispatches"]:
                        if gh.refuse_dispatch:
                            return self.answer(gh.refuse_dispatch, {"message": "refused"})
                        if gh.state[wf] != "active":
                            return self.answer(422, {"message": "Cannot trigger a 'workflow_dispatch' on a disabled workflow"})
                        if body.get("ref") != "main":
                            return self.answer(422, {"message": "No ref found for: " + str(body.get("ref"))})
                        gh._new_run(wf, "workflow_dispatch")
                        return self.answer(204)
                    return self.answer(404, {"message": "Not Found"})

            def do_GET(self):
                self.handle_any("GET")

            def do_POST(self):
                self.handle_any("POST")

            def do_PUT(self):
                self.handle_any("PUT")

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def _new_run(self, wf, event):
        run = {"id": self.next_id, "wf": wf, "event": event, "status": "in_progress", "conclusion": None}
        self.next_id += 1
        if any(r["status"] == "in_progress" for r in self.runs if r["wf"] == wf):
            run["status"] = "pending"
            for r in self.runs:
                if r["wf"] == wf and r["status"] == "pending":
                    r["status"], r["conclusion"] = "completed", "cancelled"
        self.runs.append(run)
        return run

    def start(self, event="workflow_dispatch"):
        with self.lock:
            return self._new_run("news.yml", event)

    def running(self):
        return [r for r in self.runs if r["status"] == "in_progress"]

    def pending(self):
        return [r for r in self.runs if r["status"] == "pending"]

    def finish(self, run, conclusion="success"):
        """The session ended (or died): the waiting one starts at once."""
        with self.lock:
            run["status"], run["conclusion"] = "completed", conclusion
            for r in self.runs:
                if r["status"] == "pending":
                    r["status"] = "in_progress"
                    break

    def count(self, method, suffix):
        return sum(1 for m, p in self.calls if m == method and p.endswith(suffix))

    def env(self, run=None, **extra):
        values = dict(GITHUB_ACTIONS="true", GITHUB_TOKEN=self.TOKEN, GITHUB_REPOSITORY="o/r", GITHUB_API_URL=self.url,
                      RELAY_REF="main", GITHUB_RUN_ID=run["id"] if run else "")
        values.update(extra)
        return clean_env(**values)


class GitHubCase(unittest.TestCase):
    def setUp(self):
        self.gh = FakeGitHub()
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = self._tmp.name

    def tearDown(self):
        self.gh.close()
        self._tmp.cleanup()


class Relay(GitHubCase):
    def test_does_nothing_outside_github_actions(self):
        with clean_env():
            self.assertFalse(relay.enabled())
            self.assertIn("off", relay.queue_next())
            self.assertIn("off", relay.keepalive())
            self.assertFalse(relay.stopped())
        self.assertEqual(self.gh.calls, [])

    def test_queues_the_next_session_once(self):
        cur = self.gh.start()
        with self.gh.env(cur):
            self.assertEqual(relay.queue_next(), "queued")
            self.assertEqual(relay.queue_next(), "already waiting", "a second check does not queue another one")
        self.assertEqual(self.gh.count("POST", "/dispatches"), 1)
        self.assertEqual([r["status"] for r in self.gh.runs], ["in_progress", "pending"])

    def test_a_waiting_run_from_someone_else_counts(self):
        cur = self.gh.start()
        self.gh.start(event="schedule")        # e.g. the owner pressed "Run workflow"
        with self.gh.env(cur):
            self.assertEqual(relay.queue_next(), "already waiting")
        self.assertEqual(self.gh.count("POST", "/dispatches"), 0)

    def test_respects_the_off_switch(self):
        cur = self.gh.start()
        self.gh.state["news.yml"] = "disabled_manually"
        with self.gh.env(cur):
            self.assertTrue(relay.stopped())
            self.assertIn("disabled by hand", relay.queue_next())
            self.assertIn("leaving it off", relay.keepalive())
            self.assertIn("leaving it off", relay.keepalive(fresh=True))
        self.assertEqual(self.gh.count("POST", "/dispatches"), 0)
        self.assertEqual(self.gh.count("PUT", "news.yml/enable"), 0, "a workflow disabled by hand stays disabled")
        self.assertEqual(self.gh.state["news.yml"], "disabled_manually")

    def test_a_workflow_disabled_for_inactivity_is_switched_back_on(self):
        cur = self.gh.start()
        self.gh.state["news.yml"] = "disabled_inactivity"
        with self.gh.env(cur):
            self.assertEqual(relay.queue_next(), "queued")
        self.assertEqual(self.gh.state["news.yml"], "active")

    def test_github_trouble_never_raises(self):
        cur = self.gh.start()
        with self.gh.env(cur), mock.patch.object(relay.time, "sleep"):
            self.gh.outage = 503
            self.assertTrue(relay.queue_next().startswith("could not queue"))
            self.assertIn("::warning::", relay.keepalive())
            self.gh.outage = 0
            self.gh.refuse_dispatch = 403
            before = self.gh.count("POST", "/dispatches")
            self.assertIn("HTTP 403", relay.queue_next())
            self.assertEqual(self.gh.count("POST", "/dispatches") - before, 1, "a refusal is not repeated")
        with self.gh.env(cur, GITHUB_API_URL="http://127.0.0.1:9"):   # nothing listens there
            self.assertTrue(relay.queue_next().startswith("could not queue"))

    def test_retries_a_dispatch_when_github_stumbles(self):
        cur = self.gh.start()
        answers = iter([(502, {}), (204, {})])
        real = relay.call

        def flaky(method, path, body=None, timeout=20):
            return next(answers) if method == "POST" else real(method, path, body, timeout)
        with self.gh.env(cur), mock.patch.object(relay, "call", flaky), mock.patch.object(relay.time, "sleep"):
            self.assertEqual(relay.queue_next(), "queued")

    def test_keepalive(self):
        with self.gh.env():
            self.assertIn("started a new session", relay.keepalive())
            self.assertEqual(len(self.gh.running()), 1)
            self.assertIn("the bot is fine", relay.keepalive())
            self.assertEqual(len(self.gh.runs), 1, "never a second copy")
            self.assertIn("queued a session with the new settings", relay.keepalive(fresh=True))
            self.assertEqual((len(self.gh.running()), len(self.gh.pending())), (1, 1), "the running one is not touched")
        self.assertGreaterEqual(self.gh.count("PUT", "news.yml/enable"), 3, "keeps the news workflow enabled")
        self.assertGreaterEqual(self.gh.count("PUT", "keepalive.yml/enable"), 3, "and itself")

    def test_command_line_and_the_crash_loop_guard(self):
        cur = self.gh.start()
        with self.gh.env(cur, RUNNER_TEMP=self.tmp):
            out = subprocess.run([sys.executable, os.path.join(ROOT, "relay.py"), "next", "--if-healthy"],
                                 capture_output=True, text=True, timeout=60)
            self.assertEqual(out.returncode, 0)
            self.assertIn("never got through a check", out.stdout)
            self.assertEqual(self.gh.count("POST", "/dispatches"), 0)
            relay.mark_healthy()
            out = subprocess.run([sys.executable, os.path.join(ROOT, "relay.py"), "next", "--if-healthy"],
                                 capture_output=True, text=True, timeout=60)
            self.assertIn("Next session: queued", out.stdout)
            out = subprocess.run([sys.executable, os.path.join(ROOT, "relay.py"), "keepalive"], capture_output=True, text=True,
                                 timeout=60)
            self.assertIn("the bot is fine", out.stdout)
        self.assertEqual(self.gh.count("POST", "/dispatches"), 1)

    def test_the_chain_of_sessions(self):
        """A day of sessions: no gap between them, a crash after the first check is covered by the waiting session,
        a crash before it stops the chain (no restart loop) until the keepalive starts it again, and the off switch."""
        self.gh.start()                                            # the very first session: "Run workflow"
        for n in range(8):
            cur = self.gh.running()[0]
            with self.gh.env(cur):
                self.assertEqual(relay.queue_next(), "queued")    # the bot's first good check
                relay.keepalive()                                 # the safety net fires somewhere in between
                self.assertEqual(relay.queue_next(), "already waiting")   # the half-hourly check
            self.assertEqual((len(self.gh.running()), len(self.gh.pending())), (1, 1))
            self.gh.finish(cur, "failure" if n == 3 else "success")   # session 4 dies (GitHub lost the runner)
            self.assertEqual(len(self.gh.running()), 1, f"after session {n + 1} the next one runs at once")
        # a session that dies before its first check queues nothing
        self.gh.finish(self.gh.running()[0], "failure")
        self.assertEqual(self.gh.running(), [])
        with self.gh.env():
            self.assertIn("started a new session", relay.keepalive())
        self.assertEqual(len(self.gh.running()), 1)
        # the owner switches the bot off
        self.gh.state["news.yml"] = "disabled_manually"
        with self.gh.env(self.gh.running()[0]):
            self.assertTrue(relay.stopped())
            self.assertIn("disabled by hand", relay.queue_next())
        self.gh.finish(self.gh.running()[0])
        with self.gh.env():
            relay.keepalive()
        self.assertEqual(self.gh.running(), [], "nothing restarts a bot that was switched off")
        self.assertLessEqual(sum(r["conclusion"] == "cancelled" for r in self.gh.runs), 1)


# ---------------------------------------------------------------------------------------------------------------
# The loop: relay, off switch, failure alerts, watchdog
# ---------------------------------------------------------------------------------------------------------------
class Loop(GitHubCase):
    def setUp(self):
        super().setUp()
        self._saved = (news_bot.LOOP_MINUTES, news_bot.CODE_SHA, news_bot._SUBS_CACHE)

    def tearDown(self):
        news_bot.LOOP_MINUTES, news_bot.CODE_SHA, news_bot._SUBS_CACHE = self._saved
        super().tearDown()

    def loop(self, runs, env, **patches):
        """loop(5, sync=True) with `runs` as the results of run(): numbers, or exceptions to raise.
        SystemExit at the end stops the loop (as a missing token does)."""
        told = []
        with env, mock.patch.object(news_bot, "run", side_effect=list(runs) + [SystemExit("stop")]) as run, \
                mock.patch.object(news_bot, "git_sync") as sync, \
                mock.patch.object(news_bot, "update_code") as update, \
                mock.patch.object(news_bot, "notify_owner", side_effect=lambda text: told.append(text("en")) or True), \
                mock.patch.object(news_bot.time, "sleep"), \
                mock.patch.multiple(news_bot, **patches) if patches else contextlib.nullcontext():
            news_bot.loop(5, True)
        return run, sync, update, told

    def test_queues_the_next_session_after_the_first_good_run(self):
        cur = self.gh.start()
        run, _, update, told = self.loop([RuntimeError("boom"), 0, 1, 0], self.gh.env(cur, RUNNER_TEMP=self.tmp))
        self.assertEqual(run.call_count, 5)
        self.assertEqual(update.call_count, 5)
        self.assertEqual(self.gh.count("POST", "/dispatches"), 1, "queued once, after the first good run")
        self.assertEqual(len(self.gh.pending()), 1)
        self.assertTrue(os.path.exists(os.path.join(self.tmp, "econnews-healthy")))
        self.assertEqual(told, [], "one failed run is not worth a message")

    def test_a_session_that_never_works_queues_nothing(self):
        cur = self.gh.start()
        self.loop([RuntimeError("boom")] * 3, self.gh.env(cur, RUNNER_TEMP=self.tmp))
        self.assertEqual(self.gh.count("POST", "/dispatches"), 0)
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "econnews-healthy")))

    def test_does_not_start_when_switched_off(self):
        cur = self.gh.start()
        self.gh.state["news.yml"] = "disabled_manually"
        run, *_ = self.loop([0], self.gh.env(cur))
        run.assert_not_called()

    def test_stops_when_switched_off_during_a_session(self):
        cur = self.gh.start()
        calls = []

        def run_and_switch_off():
            calls.append(1)
            if len(calls) == 2:
                self.gh.state["news.yml"] = "disabled_manually"
            return 0
        with self.gh.env(cur), mock.patch.object(news_bot, "RELAY_EVERY", 0), \
                mock.patch.object(news_bot, "run", side_effect=run_and_switch_off), \
                mock.patch.object(news_bot, "git_sync"), mock.patch.object(news_bot, "update_code"), \
                mock.patch.object(news_bot.time, "sleep"):
            news_bot.loop(5, True)
        self.assertEqual(len(calls), 2, "the session ended at the check after the switch")

    def test_the_owner_hears_about_lasting_failures_once_and_about_the_recovery(self):
        with clean_env():
            _, _, _, told = self.loop([RuntimeError("Telegram returned 401: Unauthorized")] * 4 + [0, 0], clean_env(),
                                      FAIL_ALERT_MINUTES=0)
        self.assertEqual(len(told), 2, told)
        self.assertIn("keeps failing", told[0])
        self.assertIn("3 runs in a row", told[0])
        self.assertIn("401", told[0])
        self.assertIn("works again", told[1])

    def test_short_failures_are_not_reported(self):
        _, _, _, told = self.loop([RuntimeError("x")] * 4 + [0], clean_env())   # 4 failures but not 30 minutes
        self.assertEqual(told, [])

    def test_a_pinned_session_reports_the_broken_main_once(self):
        report = os.path.join(self.tmp, "selfcheck.txt")
        with open(report, "w") as f:
            f.write("SELF-CHECK FAILED: macro.py: SyntaxError: invalid syntax (macro.py, line 3)\n")
        state = os.path.join(self.tmp, "state.json")
        env = clean_env(BOT_PINNED="a" * 40, BOT_MAIN_BAD="b" * 40, BOT_MAIN_REPORT=report, STATE_FILE=state)
        _, _, update, told = self.loop([0, 0], env)
        self.assertTrue(all(c.kwargs.get("pinned") for c in update.call_args_list), "a pinned session takes no new code")
        self.assertEqual(len(told), 1)
        self.assertIn("New code on GitHub does not start", told[0])
        self.assertIn("bbbbbbb", told[0])
        self.assertIn("SyntaxError", told[0])
        _, _, _, told = self.loop([0], clean_env(BOT_PINNED="a" * 40, BOT_MAIN_BAD="b" * 40, BOT_MAIN_REPORT=report,
                                                 STATE_FILE=state))
        self.assertEqual(told, [], "the next session remembers it was said (state.json)")

    def test_watchdog_restarts_a_hung_run(self):
        hits = []
        dog = news_bot.Watchdog(1.0, lambda: hits.append(1))
        dog.begin()
        time.sleep(0.3)
        dog.end()
        time.sleep(1.5)
        self.assertEqual(hits, [], "a run that finishes in time is left alone")
        dog.begin()
        deadline = time.time() + 10
        while not hits and time.time() < deadline:
            time.sleep(0.05)
        self.assertEqual(hits, [1])

    def test_restart_falls_back_to_exiting(self):
        with clean_env(), mock.patch.object(news_bot.os, "execv", side_effect=OSError("no exec")), \
                mock.patch.object(news_bot.os, "_exit", side_effect=SystemExit("exited")) as ex:
            with self.assertRaises(SystemExit):
                news_bot.restart(123.5, "test")
            ex.assert_called_once()
            self.assertEqual(os.environ["LOOP_DEADLINE"], "123.5")


# ---------------------------------------------------------------------------------------------------------------
# Safe code updates on real git repositories with the real bot code
# ---------------------------------------------------------------------------------------------------------------
def git(cwd, *a, ok=True):
    r = subprocess.run(["git", "-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", *a],
                       capture_output=True, text=True)
    if ok and r.returncode:
        raise AssertionError(f"git {' '.join(a)}: {r.stderr}")
    return r.stdout.strip()


class BotRepos(unittest.TestCase):
    """remote.git (GitHub), dev (a developer's clone) with the real bot code, bot (where the bot runs)."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        d = self.d = self._tmp.name
        self.remote, self.dev, self.bot = (os.path.join(d, x) for x in ("remote.git", "dev", "bot"))
        git(d, "init", "-q", "--bare", "-b", "main", self.remote)
        git(self.remote, "config", "uploadpack.allowAnySHA1InWant", "true")
        git(d, "clone", "-q", self.remote, self.dev)
        for name in os.listdir(ROOT):
            if name.endswith(".py"):
                shutil.copy2(os.path.join(ROOT, name), self.dev)
        with open(os.path.join(self.dev, ".gitignore"), "w") as f:
            f.write("__pycache__/\n/state.json\n/docs/data.json\n")
        git(self.dev, "add", "-A")
        git(self.dev, "commit", "-qm", "bot")
        git(self.dev, "push", "-q", "origin", "main")
        self.good = git(self.dev, "rev-parse", "HEAD")
        git(d, "clone", "-q", self.remote, self.bot)

    def tearDown(self):
        self._tmp.cleanup()

    def commit(self, name, text, append=True, msg="change"):
        p = os.path.join(self.dev, name)
        with open(p, "a" if append else "w", encoding="utf-8") as f:
            f.write(text)
        git(self.dev, "commit", "-qam", msg)
        git(self.dev, "push", "-q", "origin", "main")
        return git(self.dev, "rev-parse", "HEAD")

    @staticmethod
    def read(*p):
        with open(os.path.join(*p), encoding="utf-8") as f:
            return f.read()


class Reloaded(Exception):
    pass


class SafeCodeUpdates(BotRepos):
    def test_good_code_is_taken_broken_code_is_not(self):
        state = os.path.join(self.d, "state.json")
        os.makedirs(os.path.join(self.bot, "docs"))
        with open(os.path.join(self.bot, "docs", "data.json"), "w") as f:
            f.write('{"bot": "data"}')
        told, bad = [], set()

        def update():
            news_bot.update_code(self.bot, news_bot.code_hash(self.bot), None, bad)

        with clean_env(STATE_FILE=state), mock.patch.object(news_bot, "reload_self", side_effect=Reloaded), \
                mock.patch.object(news_bot, "notify_owner", side_effect=lambda text: told.append(text("en")) or True):
            update()                                                    # nothing new: nothing happens
            self.commit("sources.py", "\n# a harmless change\n")
            with self.assertRaises(Reloaded):                           # passes the self-check: restart with it
                update()
            macro = self.read(self.bot, "macro.py")
            broken = self.commit("macro.py", "\ndef oops(:\n")
            update()                                                    # fails: rolled back, remembered, reported
            self.assertEqual(self.read(self.bot, "macro.py"), macro, "the code that runs is back")
            self.assertNotEqual(git(self.bot, "rev-parse", "HEAD"), broken)
            self.assertEqual(bad, {broken})
            self.assertIn(broken, os.environ["BOT_BAD_CODE"])
            self.assertEqual(self.read(self.bot, "docs", "data.json"), '{"bot": "data"}', "the bot's data is kept")
            self.assertEqual(len(told), 1)
            self.assertIn(broken[:7], told[0])
            self.assertIn("SyntaxError", told[0])
            with mock.patch.object(news_bot, "selfcheck_in") as check:
                update()                                                # main still broken: not even tried
                check.assert_not_called()
            self.assertEqual(len(told), 1, "said once")
            self.commit("macro.py", macro + "# fixed\n", append=False)
            with self.assertRaises(Reloaded):                           # the fix comes in by itself
                update()
            self.assertEqual(self.read(self.bot, "macro.py"), macro + "# fixed\n")

    def test_a_pinned_session_takes_no_code_but_gets_its_data(self):
        news_bot._published.clear()
        state = '{"initialized": true, "seen": {}, "recent": [], "last_digest": "", "fail_streak": {}}'
        with open(os.path.join(self.dev, "state.json"), "w") as f:
            f.write(state)
        news_bot.git_sync("push", self.dev)                             # the data branch exists
        os.remove(os.path.join(self.dev, "state.json"))
        self.commit("sources.py", "\n# new code\n")
        head = git(self.bot, "rev-parse", "HEAD")
        news_bot.update_code(self.bot, news_bot.code_hash(self.bot), None, set(), pinned=True)
        self.assertEqual(git(self.bot, "rev-parse", "HEAD"), head, "no new code")
        self.assertEqual(self.read(self.bot, "state.json"), state, "the data came from gh-pages")


class DataBranchGuard(BotRepos):
    def test_a_session_without_its_data_does_not_wipe_the_data_branch(self):
        """«Save state» runs at the end of every session. One that ended before its first run (switched off, cancelled
        while setting up) has only the bare site: pushing it would replace gh-pages and lose the bot's memory."""
        news_bot._published.clear()
        os.makedirs(os.path.join(self.dev, "docs"), exist_ok=True)
        with open(os.path.join(self.dev, "state.json"), "w") as f:
            f.write('{"memory": 1}')
        with open(os.path.join(self.dev, "docs", "data.json"), "w") as f:
            f.write('{"news": 1}')
        news_bot.git_sync("push", self.dev)
        before = git(self.remote, "rev-parse", "gh-pages")
        fresh = os.path.join(self.d, "fresh")
        git(self.d, "clone", "-q", self.remote, fresh)
        os.makedirs(os.path.join(fresh, "docs"), exist_ok=True)
        with open(os.path.join(fresh, "docs", "index.html"), "w") as f:
            f.write("site")
        news_bot._published.clear()
        news_bot.git_sync("push", fresh)
        self.assertEqual(git(self.remote, "rev-parse", "gh-pages"), before, "the data branch is untouched")
        self.assertEqual(git(self.remote, "show", "gh-pages:state.json"), '{"memory": 1}')
        self.assertEqual(git(self.remote, "show", "gh-pages:docs/data.json"), '{"news": 1}')


@unittest.skipUnless(shutil.which("bash") and shutil.which("timeout") and HAS_YAML, "needs bash, timeout and PyYAML")
class CheckTheCodeStep(BotRepos):
    """The «Check the code» step of news.yml, run as GitHub runs it (bash -e) in a shallow checkout."""

    def script(self):
        import yaml
        with open(os.path.join(ROOT, ".github", "workflows", "news.yml"), encoding="utf-8") as f:
            wf = yaml.safe_load(f)
        return next(s["run"] for s in wf["jobs"]["news"]["steps"] if s.get("name") == "Check the code")

    def run_step(self):
        work = os.path.join(self.d, "work")
        shutil.rmtree(work, ignore_errors=True)
        git(self.d, "clone", "-q", "--depth", "1", "file://" + self.remote, work)
        envfile, tmp = os.path.join(self.d, "github_env"), os.path.join(self.d, "runner_temp")
        os.makedirs(tmp, exist_ok=True)
        open(envfile, "w").close()
        env = {k: v for k, v in os.environ.items() if k not in ACTIONS_ENV}
        env.update(GITHUB_ENV=envfile, RUNNER_TEMP=tmp, GITHUB_REF_NAME="main")
        r = subprocess.run(["bash", "-e", "-c", self.script()], cwd=work, env=env, capture_output=True, text=True,
                           timeout=600)
        values = dict(line.split("=", 1) for line in self.read(envfile).splitlines() if "=" in line)
        return r, values, git(work, "rev-parse", "HEAD")

    def publish_code_ok(self, sha):
        news_bot._published.clear()
        with open(os.path.join(self.dev, "state.json"), "w") as f:
            json.dump({"initialized": True, "code_ok": {"sha": sha, "at": "2026-11-06T00:00:00+00:00"}}, f)
        news_bot.git_sync("push", self.dev)
        os.remove(os.path.join(self.dev, "state.json"))

    def test_main_passes(self):
        r, values, head = self.run_step()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("SELF-CHECK OK", r.stdout)
        self.assertEqual(values, {})
        self.assertEqual(head, self.good)

    def test_broken_main_runs_the_last_version_that_worked(self):
        self.publish_code_ok(self.good)
        bad = self.commit("macro.py", "\ndef oops(:\n")
        r, values, head = self.run_step()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(head, self.good)
        self.assertEqual(values["BOT_PINNED"], self.good)
        self.assertEqual(values["BOT_MAIN_BAD"], bad)
        self.assertIn("SyntaxError", self.read(values["BOT_MAIN_REPORT"]))
        self.assertIn("::warning::", r.stdout)

    def test_broken_main_without_a_known_good_version_still_runs(self):
        bad = self.commit("macro.py", "\ndef oops(:\n")
        r, values, head = self.run_step()                               # no gh-pages branch at all
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual((values, head), ({}, bad))
        self.publish_code_ok(bad)                                        # "good" is the broken one itself
        r, values, head = self.run_step()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual((values, head), ({}, bad))

    def test_when_the_old_version_fails_too_main_runs(self):
        older_bad = self.commit("stocks.py", "\ndef oops(:\n")
        self.publish_code_ok(older_bad)
        bad = self.commit("macro.py", "\ndef oops(:\n")
        r, values, head = self.run_step()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(values, {})
        self.assertEqual(head, bad)


# ---------------------------------------------------------------------------------------------------------------
# One run: parts stand on their own
# ---------------------------------------------------------------------------------------------------------------
class RunParts(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        d = self._tmp.name
        os.makedirs(os.path.join(d, "docs"))
        self.state = os.path.join(d, "state.json")
        self.env = {"TELEGRAM_BOT_TOKEN": "1:T", "TELEGRAM_CHAT_ID": "100", "PAGES_URL": "https://p.test/",
                    "STATE_FILE": self.state, "PAGE_DATA": os.path.join(d, "docs", "data.json"),
                    "DIGEST_HOUR": "-1", "MORNING_HOUR": "-1", "CALENDAR": "no", "TRADES": "no", "ANTHROPIC_API_KEY": "",
                    "FRED_API_KEY": "", "QUIET_HOURS": "0-0", "MARKET": "no"}
        self.n = 0
        self.saved = news_bot.LOOP_MINUTES

    def tearDown(self):
        news_bot.LOOP_MINUTES = self.saved
        self._tmp.cleanup()

    def story(self, title, score=8):
        self.n += 1
        return {"id": f"s{self.n}", "title": title, "lead": "", "tags": [], "link": f"https://x/{self.n}", "source": "Reuters",
                "sources": ["Reuters"], "score": score, "ts": datetime.now(timezone.utc).isoformat()}

    def run_bot(self, stories, deliver, errors=None, **env):
        """One run; deliver(chat, text) -> None or raises. Returns (what was delivered, the saved state)."""
        out = []

        def fake_call(tg, method, fields, files=None):
            deliver(str(fields.get("chat_id")), fields.get("text") or "")
            out.append((str(fields.get("chat_id")), fields.get("text") or ""))
            return {"message_id": len(out)}
        with mock.patch.dict(os.environ, {**self.env, **env}), \
                mock.patch.object(news_bot, "collect", return_value=(stories, errors or {})), \
                mock.patch.object(news_bot, "fetch_subscribers", return_value=(["200"], {})), \
                mock.patch.object(news_bot, "translate", return_value=None), \
                mock.patch.object(news_bot, "update_extras", return_value=""), \
                mock.patch.object(news_bot, "push_live"), \
                mock.patch.object(news_bot.Telegram, "_call", fake_call):
            news_bot.run()
        with open(self.state, encoding="utf-8") as f:
            return out, json.load(f)

    def started(self):
        self.run_bot([], lambda c, t: None)   # the first run only says hello to the owner
        with open(self.state, encoding="utf-8") as f:
            st = json.load(f)
        st["last_digest"] = ""                # the first run puts the evening digest off till tomorrow: due now
        with open(self.state, "w", encoding="utf-8") as f:
            json.dump(st, f)

    def test_telegram_down_repeats_the_run_and_loses_nothing(self):
        self.started()
        story = self.story("Fed holds rates steady as inflation cools", 9)

        def down(chat, text):
            raise urllib.error.URLError("network is unreachable")
        with mock.patch.object(news_bot.time, "sleep"):
            with self.assertRaises(Exception):
                self.run_bot([story], down)
        with open(self.state, encoding="utf-8") as f:
            self.assertNotIn(story["id"], json.load(f)["seen"], "the story is still new")
        out, st = self.run_bot([dict(story)], lambda c, t: None)       # Telegram is back
        self.assertTrue(any("Fed holds rates" in t for c, t in out if c == "200"))
        self.assertIn(story["id"], st["seen"])

    def test_a_message_telegram_refuses_is_not_repeated_forever(self):
        self.started()
        story = self.story("Oil jumps after OPEC cuts output sharply")

        def refuse(chat, text):
            if "Oil jumps" in text:
                raise news_bot.TelegramError(400, '{"description": "Bad Request: message is too long"}')
        out, st = self.run_bot([story], refuse)
        self.assertIn(story["id"], st["seen"], "the run went through and the story is done")
        told = [t for c, t in out if c == "100"]
        self.assertTrue(told and "Part of the bot is broken" in told[0] and "news" in told[0], out)
        out, st = self.run_bot([dict(story)], refuse)
        self.assertEqual(out, [], "not sent again, and the owner is told once a day")

    def test_partly_delivered_news_are_not_sent_twice(self):
        self.started()
        # distinct headlines (similar ones are merged into one story), long enough for a batch of several messages
        stories = [self.story(f"Inflation shock{i} hits economy{i} markets{i} as investors{i} weigh central{i} "
                              f"bank{i} policy{i} outlook{i}") for i in range(1, 40)]
        calls = []

        def second_fails(chat, text):
            calls.append(chat)
            if len(calls) > 2:
                raise urllib.error.URLError("connection reset")
        with mock.patch.object(news_bot.time, "sleep"):
            out, st = self.run_bot(stories, second_fails)
        self.assertGreater(len(calls), 2, "the batch took more than one message, and the second one failed")
        self.assertTrue(out, "the first message went out")
        self.assertTrue(all(s["id"] in st["seen"] for s in stories), "so the run is not repeated")

    def test_a_broken_part_does_not_stop_the_run(self):
        self.started()
        story = self.story("ECB cuts interest rates as inflation slows", 9)
        with mock.patch.object(news_bot.i18n, "month", side_effect=ValueError("bug in the digest")):
            out, st = self.run_bot([story], lambda c, t: None, DIGEST_HOUR="0")
            self.assertTrue(any("ECB cuts" in t for c, t in out if c == "200"), "the news still went out")
            self.assertIn(story["id"], st["seen"])
            self.assertEqual(st["last_digest"], datetime.now(news_bot.MSK).strftime("%Y-%m-%d"))
            self.assertTrue(any("evening digest" in t and "bug in the digest" in t for c, t in out if c == "100"))
            out, st = self.run_bot([], lambda c, t: None, DIGEST_HOUR="0")
            self.assertEqual(out, [], "not tried again today, the owner is not told twice")

    def test_a_digest_that_could_not_go_out_is_tried_again(self):
        self.started()

        def down(chat, text):
            raise urllib.error.URLError("network is unreachable")
        with mock.patch.object(news_bot.time, "sleep"):
            out, st = self.run_bot([], down, DIGEST_HOUR="0")
        self.assertNotEqual(st["last_digest"], datetime.now(news_bot.MSK).strftime("%Y-%m-%d"))
        out, st = self.run_bot([], lambda c, t: None, DIGEST_HOUR="0")
        self.assertTrue(any("Top stories of" in t for c, t in out))

    def test_source_alerts_mean_hours_and_a_network_blip_is_quiet(self):
        news_bot.LOOP_MINUTES = 5
        self.assertEqual(news_bot.down_after(), 36, "3 hours of 5-minute runs")
        self.assertEqual(news_bot.all_down_after(), 3)
        news_bot.LOOP_MINUTES = 0
        self.assertEqual(news_bot.down_after(), 6, "single runs every ~30 minutes")
        news_bot.LOOP_MINUTES = 5
        self.started()
        every = {s["name"]: "timeout" for s in news_bot.SOURCES}
        out, _ = self.run_bot([], lambda c, t: None, errors=every)
        out += self.run_bot([], lambda c, t: None, errors=every)[0]
        self.assertEqual(out, [], "two runs without any source: still quiet")
        out, _ = self.run_bot([], lambda c, t: None, errors=every)
        self.assertTrue(any("No source has answered" in t for c, t in out))
        out, _ = self.run_bot([], lambda c, t: None, errors=every)
        self.assertEqual(out, [], "said once")
        one = {"Fed": "HTTP Error 404"}
        told = []
        for _ in range(36):
            told += self.run_bot([], lambda c, t: None, errors=one)[0]
        self.assertEqual(len(told), 1, told)
        self.assertEqual(told[0], ("100", "⚠️ Not responding for ~3 h: Fed"), "to the owner only")
        out, _ = self.run_bot([], lambda c, t: None)
        self.assertTrue(any("Back online: Fed" in t for c, t in out))


class SmallPieces(unittest.TestCase):
    def test_long_blocks_are_split_under_the_telegram_limit(self):
        cal = "📅 <b>Calendar</b>\n" + "\n".join(f"<b>{h:02d}:00</b> 🇺🇸 Event number {h} with a long name" for h in range(400))
        msgs = news_bot.split_messages("Header", ["first story", cal, "last story"], limit=3900)
        self.assertTrue(all(len(m) <= 3900 for m in msgs), [len(m) for m in msgs])
        joined = "\n".join(msgs)
        self.assertIn("Event number 399 with", joined)
        self.assertTrue(msgs[0].startswith("Header"))
        self.assertIn("last story", msgs[-1])
        self.assertEqual(news_bot._fit("x" * 9000, 3900), ["x" * 3900, "x" * 3900, "x" * 1200])

    def test_damaged_state_starts_over_instead_of_failing_every_run(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "state.json")
            with open(p, "w") as f:
                json.dump({"seen": [], "recent": [{"title": "ok", "ts": "2026-11-01T00:00:00+00:00", "sources": ["X"],
                                                   "score": 5, "link": ""}, {"broken": 1}, "junk"],
                           "fail_streak": None, "initialized": True, "last_digest": 5}, f)
            st = news_bot.load_state(p)
            self.assertEqual((st["seen"], st["fail_streak"], st["last_digest"], st["initialized"]), ({}, {}, "", True))
            self.assertEqual([r["title"] for r in st["recent"]], ["ok"])
            with open(p, "w") as f:
                f.write("[1, 2]")
            self.assertEqual(news_bot.load_state(p)["seen"], {})

    def test_one_odd_story_does_not_break_collecting(self):
        good = {"title": "Oil prices jump as OPEC cuts output", "link": "https://x/1", "summary": "", "published": None,
                "categories": []}
        odd = {"title": "Odd", "link": "https://x/2", "summary": "", "published": "not a date", "categories": []}
        src = {"name": "Test", "url": "https://x", "kind": "econ"}
        with mock.patch.object(news_bot, "SOURCES", [src]), \
                mock.patch.object(news_bot, "load_source", return_value=(src, [odd, good], None)):
            candidates, errors = news_bot.collect(datetime.now(timezone.utc))
        self.assertEqual([c["title"] for c in candidates], ["Oil prices jump as OPEC cuts output"])
        self.assertEqual(errors, {})

    def test_failures_worth_repeating(self):
        self.assertTrue(news_bot._retry_later(urllib.error.URLError("x")))
        self.assertTrue(news_bot._retry_later(TimeoutError()))
        self.assertTrue(news_bot._retry_later(RuntimeError("Telegram is unreachable")))
        self.assertTrue(news_bot._retry_later(news_bot.TelegramError(502, "")))
        self.assertTrue(news_bot._retry_later(news_bot.TelegramError(429, "")))
        self.assertFalse(news_bot._retry_later(news_bot.TelegramError(400, "can't parse entities")))
        self.assertFalse(news_bot._retry_later(KeyError("bug")))

    def test_the_selfcheck_passes_on_this_code(self):
        self.assertEqual(news_bot.selfcheck(), [])

    def test_all_new_texts_exist_in_both_languages(self):
        for key, kw in (("part_failed", {"part": "x", "err": "y"}), ("bot_failing", {"n": 3, "m": 30, "err": "e"}),
                        ("bot_recovered", {"m": 5}), ("code_rejected", {"sha": "abc1234", "err": "e"}), ("all_down", {})):
            en, ru = i18n.t("en", key, **kw), i18n.t("ru", key, **kw)
            self.assertNotEqual(en, ru, key)
            self.assertRegex(ru, "[а-я]")
        self.assertEqual(i18n.part("morning digest", "ru"), "утренний дайджест")


@unittest.skipUnless(HAS_YAML, "needs PyYAML")
class Workflows(unittest.TestCase):
    def load(self, name):
        import yaml
        with open(os.path.join(ROOT, ".github", "workflows", name), encoding="utf-8") as f:
            wf = yaml.safe_load(f)
        wf["on"] = wf.pop(True, wf.get("on"))   # YAML 1.1 reads the key `on` as true
        return wf

    def test_news_sessions_chain_themselves(self):
        wf = self.load("news.yml")
        self.assertEqual(list(wf["on"]), ["workflow_dispatch"], "no schedule: sessions queue each other")
        self.assertEqual(wf["permissions"], {"contents": "write", "actions": "write"})
        self.assertEqual(wf["concurrency"], {"group": "econ-news", "cancel-in-progress": False})
        steps = {s.get("name") or s.get("uses"): s for s in wf["jobs"]["news"]["steps"]}
        bot = steps["Collect and send news"]
        self.assertEqual(bot["env"]["GITHUB_TOKEN"], "${{ github.token }}")
        self.assertIn("--loop 5 --git-sync", bot["run"])
        self.assertIn("LOOP_HOURS=5.5", bot["run"])
        self.assertLess(5.5 * 60 + 10, wf["jobs"]["news"]["timeout-minutes"])
        self.assertLessEqual(wf["jobs"]["news"]["timeout-minutes"], 360, "GitHub stops a job after 6 hours")
        self.assertEqual(steps["Save state"]["if"], "always()")
        nxt = steps["Make sure the next session is queued"]
        self.assertEqual(nxt["if"], "${{ !cancelled() }}")
        self.assertIn("relay.py next --if-healthy", nxt["run"])
        self.assertTrue(steps["Install chart and PDF libraries"]["continue-on-error"])
        order = [s.get("name") for s in wf["jobs"]["news"]["steps"]]
        self.assertLess(order.index("Check the code"), order.index("Collect and send news"))

    def test_keepalive(self):
        wf = self.load("keepalive.yml")
        self.assertIn("schedule", wf["on"])
        self.assertEqual(wf["on"]["push"]["branches"], ["main"])
        self.assertIn(".github/workflows/news.yml", wf["on"]["push"]["paths"])
        self.assertEqual(wf["permissions"]["actions"], "write")
        self.assertNotEqual(wf.get("concurrency", {}).get("group"), "econ-news", "must not wait behind the news session")
        run = wf["jobs"]["keepalive"]["steps"][-1]
        self.assertIn("relay.py keepalive", run["run"])
        self.assertEqual(run["env"]["GITHUB_TOKEN"], "${{ github.token }}")

    def test_worker_knows_the_repository(self):
        with open(os.path.join(ROOT, ".github", "workflows", "worker.yml"), encoding="utf-8") as f:
            self.assertIn('--var "GITHUB_REPO:${{ github.repository }}"', f.read())


if __name__ == "__main__":
    unittest.main()
