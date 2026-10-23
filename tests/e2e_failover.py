#!/usr/bin/env python3
"""
The terminal when *.workers.dev is blocked on the viewer's network (several Russian providers reset such connections).

1. The main address is blocked, the PHP relay (deploy/hosting/api/index.php, run by `php -S` in front of the local
   test server) works: quotes, the company card and the search must come through the relay.
2. Every address is down: the company card falls back to the copy on the site (docs/co, docs/fin, stocks.json).
3. The relay itself: only /api/... is passed, CORS headers are there, the viewer's headers reach the server.

Run: python3 tests/e2e_failover.py   (needs php, node and Playwright, like tests/e2e_terminal.py)
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_terminal as E  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLOCKED = "https://econnews-bot.blocked.workers.dev"


def start_relay(upstream):
    port = E.free_port()
    env = dict(os.environ, ECONNEWS_UPSTREAM=upstream)
    proc = subprocess.Popen(["php", "-S", f"127.0.0.1:{port}", os.path.join(ROOT, "deploy", "hosting", "api", "index.php")],
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(100):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=1).read()
            return proc, port
        except Exception:
            time.sleep(0.1)
    proc.kill()
    raise RuntimeError("php relay did not start")


def main():
    if not shutil.which("php"):
        print("php not installed — skipped")
        return
    static, sport = E.start_static()
    wproc, wport = E.start_fake_worker()
    api = f"http://127.0.0.1:{wport}"
    rproc, rport = start_relay(api)
    relay = f"http://127.0.0.1:{rport}"
    fx = {n: urllib.request.urlopen(f"{api}/__fx/{n}").read() for n in ("data.json", "stocks.json", "rates.json")}
    check = E.check
    try:
        # --- the relay on its own ---
        r = urllib.request.urlopen(relay + "/api/ping")
        check("relay: /api/ping answers through PHP", json.loads(r.read()).get("ok") is True)
        check("relay: CORS header", r.headers.get("Access-Control-Allow-Origin") == "*")
        r = urllib.request.urlopen(relay + "/api/quote?s=AAPL,BTC")
        q = json.loads(r.read())
        check("relay: quotes pass through", q.get("ok") and "AAPL" in json.dumps(q), str(q)[:200])
        for bad in ("/subs", "/sync/live", "/tg", "/api/../subs"):
            try:
                urllib.request.urlopen(relay + bad)
                code = 200
            except urllib.error.HTTPError as e:
                code = e.code
            check("relay: refuses " + bad, code == 404, code)
        req = urllib.request.Request(relay + "/api/me", headers={"X-Owner-Key": "pw"})
        me = json.loads(urllib.request.urlopen(req).read())
        check("relay: the owner's header reaches the server", me.get("ok") is not False and "owner" in json.dumps(me).lower(), str(me)[:200])
        req = urllib.request.Request(relay + "/api/ping", method="OPTIONS")
        check("relay: OPTIONS preflight", urllib.request.urlopen(req).status == 204)

        def run(config, name):
            errors = []
            with sync_playwright() as pw:
                browser = pw.chromium.launch()
                ctx = browser.new_context(viewport={"width": 1440, "height": 900})

                def handle(route):
                    url = route.request.url
                    if url.startswith(BLOCKED) or any(b in url for b in E.BLOCK):
                        return route.abort("connectionreset")   # what the provider does to *.workers.dev
                    u = urllib.parse.urlparse(url)
                    if u.netloc == f"127.0.0.1:{sport}":
                        if u.path == "/config.json":
                            return route.fulfill(status=200, content_type="application/json", body=json.dumps(config))
                        if u.path.lstrip("/") in fx:
                            return route.fulfill(status=200, content_type="application/json", body=fx[u.path.lstrip("/")])
                    return route.continue_()
                ctx.route("**/*", handle)
                page = ctx.new_page()
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.goto(f"http://127.0.0.1:{sport}/terminal/")
                page.wait_for_selector("#mkt table")
                out = name(page)
                browser.close()
            check("no script errors", not errors, errors)
            return out

        # --- 1. workers.dev blocked, the relay works ---
        def blocked(page):
            page.wait_for_function("() => window.TERM && TERM.api() && TERM.api().indexOf('127.0.0.1') >= 0", timeout=15000)
            check("blocked: the terminal switched to the relay", page.evaluate("TERM.api()") == relay, page.evaluate("TERM.api()"))
            page.wait_for_function("() => /LIVE|PRO/.test(document.getElementById('st-data').textContent)", timeout=15000)
            check("blocked: live quotes through the relay", True)
            page.fill("#cmd", "AAPL DES")
            page.press("#cmd", "Enter")
            page.wait_for_selector("#des-body .co-head", timeout=15000)
            check("blocked: company card loads", "AAPL" in page.inner_text("#des-body .co-head"))
            check("blocked: no offline note (the server answered)", "copy saved" not in page.inner_text("#des-body"))
            check("blocked: the choice is remembered", page.evaluate("localStorage.getItem('api_url')") == relay)
        run({"api": BLOCKED, "api_alt": [relay]}, blocked)

        # --- 2. nothing answers: the copy on the site ---
        def down(page):
            page.fill("#cmd", "AAPL DES")
            page.press("#cmd", "Enter")
            page.wait_for_selector("#des-body .co-head", timeout=40000)
            body = page.inner_text("#des-body")
            check("down: company card from the site copy", "AAPL" in page.inner_text("#des-body .co-head"))
            check("down: says the server is unreachable", "unreachable" in body, body[:200])
            check("down: P/E from stocks.json", "P/E" in body)
        run({"api": BLOCKED, "api_alt": ["https://relay.blocked.workers.dev"]}, down)

        # --- 3. a normal network: the main address stays ---
        def normal(page):
            page.wait_for_function("() => /LIVE|PRO/.test(document.getElementById('st-data').textContent)", timeout=15000)
            time.sleep(1.5)
            check("normal: both work — keeps the first that answered", page.evaluate("TERM.api()") in (api, relay))
        run({"api": api, "api_alt": [relay]}, normal)
    finally:
        rproc.kill()
        wproc.kill()
        static.shutdown()
    if E.FAILS:
        print(f"\nFAILOVER E2E FAILED: {len(E.FAILS)} of {len(E.FAILS) + len(E.OKS)}")
        sys.exit(1)
    print(f"\nFAILOVER E2E PASSED ({len(E.OKS)} checks)")


if __name__ == "__main__":
    main()
