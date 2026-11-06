#!/usr/bin/env python3
"""
The terminal on a network that throttles Cloudflare (Russian providers since June 2025: a connection stops after
~16 KB, every later request on it hangs; a fresh connection works). The bot server is on *.workers.dev.

A. The usual port (:443) hangs, the other HTTPS ports of the same server answer: quotes must come at once anyway,
   the status never shows "SERVER ✕", the fresh story comes through the small /api/live?since= answer.
B. Every connection stalls after two answers and starts fresh ~10 s after it stalled (what the browser does when its
   check of a dead connection fails): live quotes keep coming every couple of seconds, no "SERVER ✕".
C. Nothing answers at all: the screen is full at once anyway (the browser's copy and the bot's data on the site,
   US stocks included), "SERVER ✕" only after several failed tries.
D. Inside Telegram the sign-in data is read from the address: the first quotes request goes out at once with it,
   without waiting up to 3 s for telegram.org.

Run: python3 tests/e2e_throttle.py   (needs node and Playwright, like tests/e2e_terminal.py)
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_terminal as E  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

HOST = "econnews-bot.test.workers.dev"
API = "https://" + HOST
X = ("SERVER ✕", "СЕРВЕР ✕")

# data.json as the bot now writes it: the US panel's tickers are in it (terminal: true)
US = [{"id": "SPY", "name": "S&P 500 ETF", "name_en": "S&P 500 ETF", "price": "$738,03", "value": 738.03, "change": 0.69,
       "digits": 2, "prefix": "$", "spark": [733, 735, 738.03], "terminal": True},
      {"id": "AAPL", "name": "Apple", "name_en": "Apple", "price": "$344,22", "value": 344.22, "change": 0.02,
       "digits": 2, "prefix": "$", "spark": [340, 342, 344.22], "terminal": True}]

# records every value of the status pill from the very start
PILL_WATCH = """
setInterval(function(){
  var e = document.getElementById('st-data'); if (!e) return;
  var t = e.textContent;
  if (window.__pl !== t) { (window.__pills = window.__pills || []).push([Math.round(performance.now()), t]); window.__pl = t }
}, 50);
"""


def main():
    static, sport = E.start_static()
    wproc, wport = E.start_fake_worker()
    fake = f"http://127.0.0.1:{wport}"
    fx = {n: urllib.request.urlopen(f"{fake}/__fx/{n}").read() for n in ("stocks.json", "rates.json")}
    data = json.loads(urllib.request.urlopen(f"{fake}/__fx/data.json").read())
    data["market"] = data["market"] + US
    fx["data.json"] = json.dumps(data).encode()
    # a fresh story on the server that the site does not have yet
    import hashlib
    key = hashlib.sha256(b"econnews-sync:123:TEST").hexdigest()
    story = {"title": "Fresh story from the server", "lang": "en", "title_ru": "Свежая новость с сервера",
             "ts": "2099-01-01T00:00:00+00:00", "level": "high", "sources": ["Live"], "link": "https://x/live"}
    old = [{"title": "Old live story %d" % i, "lang": "en", "ts": "2000-01-01T00:00:00+00:00", "level": "medium",
            "sources": ["Live"], "link": "https://x/old%d" % i} for i in range(40)]
    body = json.dumps({"updated": "2099-01-01T00:00:00+00:00", "news": [story] + old, "market": data["market"] * 3}).encode()
    urllib.request.urlopen(urllib.request.Request(f"{fake}/sync/live", data=body, method="POST",
                                                  headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})).read()
    check = E.check

    def forward(route, refresh=None):
        """Answers a request to the workers.dev server from the local fake server (the real worker code)."""
        req = route.request
        u = urllib.parse.urlparse(req.url)
        target = fake + u.path + ("?" + u.query if u.query else "")
        hdr = {k: v for k, v in req.headers.items() if k.lower() in ("x-tg-init", "x-owner-key", "content-type")}
        try:
            r = urllib.request.urlopen(urllib.request.Request(target, method=req.method, headers=hdr, data=req.post_data_buffer), timeout=15)
            status, out = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, out = e.code, e.read()
        if refresh and u.path == "/api/quotes":
            d = json.loads(out)
            d["refresh"] = refresh
            out = json.dumps(d).encode()
        route.fulfill(status=status, headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*",
                                              "Access-Control-Allow-Headers": "X-Tg-Init, X-Owner-Key, Content-Type"}, body=out)

    def session(server, config=None, url_suffix="", before=None, stall_tg=False):
        """A browser with the site on localhost and the bot server faked by `server(route, port)` (None = hang)."""
        pw = sync_playwright().start()
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        ctx.add_init_script(PILL_WATCH)
        if before:
            before(ctx)
        log = {"req": [], "stalled": [], "hung": []}

        def handle(route):
            url = route.request.url
            u = urllib.parse.urlparse(url)
            if u.hostname == HOST:
                port = u.port or 443
                log["req"].append((time.time(), port, u.path + ("?" + u.query if u.query else ""), dict(route.request.headers, _method=route.request.method)))
                if server(route, port) is None:
                    log["stalled"].append((time.time(), port, u.path))   # left unanswered: the connection hangs
                    log["hung"].append(route)
                return
            if "telegram.org" in url and stall_tg:
                log["hung"].append(route)
                return   # telegram.org hangs too
            if any(b in url for b in E.BLOCK):
                return route.abort()
            if u.netloc == f"127.0.0.1:{sport}":
                if u.path == "/config.json":
                    return route.fulfill(status=200, content_type="application/json", body=json.dumps(config or {"api": API}))
                if u.path.lstrip("/") in fx:
                    return route.fulfill(status=200, content_type="application/json", body=fx[u.path.lstrip("/")])
            return route.continue_()
        ctx.route("**/*", handle)
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        t0 = time.time()
        page.goto(f"http://127.0.0.1:{sport}/terminal/" + url_suffix, wait_until="domcontentloaded")
        return pw, browser, page, log, errors, t0

    def close(pw, browser, log):
        for r in log["hung"]:   # let the hanging requests go before closing (otherwise Playwright prints noise)
            try:
                r.abort()
            except Exception:
                pass
        browser.close()
        pw.stop()

    def pills(page):
        return page.evaluate("window.__pills || []")

    def us_rows(page):
        return page.evaluate("Array.from(document.querySelectorAll('#g-US + table tr.row')).map(function(r){ return r.dataset.id })")

    # ---------------------------------------------------------------- A. :443 hangs, other ports answer
    def a_server(route, port):
        if port == 443:
            return None
        forward(route)
        return True
    pw, browser, page, log, errors, t0 = session(a_server)
    try:
        page.wait_for_selector("#mkt table", timeout=5000)
        t_screen = time.time() - t0
        check("A: the markets are on screen at once (site data)", t_screen < 3, f"{t_screen:.2f} s")
        check("A: US stocks from the site data before the server answers", "SPY" in us_rows(page), us_rows(page))
        page.wait_for_function("() => /LIVE|PRO/.test(document.getElementById('st-data').textContent) && !/…/.test(document.getElementById('st-data').textContent)", timeout=10000)
        t_live = time.time() - t0
        check("A: live quotes although :443 hangs", t_live < 6, f"{t_live:.2f} s")
        print(f"       (screen {t_screen:.2f} s, live quotes {t_live:.2f} s)")
        quote_ports = [p for _, p, path, h in log["req"] if path.startswith("/api/quotes") and h["_method"] == "GET"]
        check("A: quotes came over another port", any(p != 443 for p in quote_ports), quote_ports)
        check("A: AAPL from the server (Finnhub)", page.evaluate("TERM.Q.AAPL && TERM.Q.AAPL.src") == "live", page.evaluate("TERM.Q.AAPL"))
        page.wait_for_function("document.querySelector('#news').textContent.includes('Fresh story from the server')", timeout=15000)
        live = [path for _, _, path, _ in log["req"] if path.startswith("/api/live")]
        check("A: the fresh story via the small answer /api/live?since=", live and all("since=" in x for x in live), live)
        check("A: old stories of the feed are not downloaded", "Old live story" not in page.inner_text("#news"))
        lane = page.evaluate("localStorage.getItem('api_lane')")
        check("A: the working lane is remembered", bool(lane) and lane.startswith(API + ":"), lane)
        time.sleep(2)
        seen = [t for _, t in pills(page)]
        check("A: never 'SERVER ✕'", not any(x in t for t in seen for x in X), seen)
        check("A: no script errors", not errors, errors)
    finally:
        close(pw, browser, log)

    # ---------------------------------------------------------------- B. every connection stalls after 2 answers
    budget = {}
    def b_server(route, port):
        st = budget.setdefault(port, {"n": 0, "stalled_at": None})
        if st["stalled_at"] is not None:
            if time.time() - st["stalled_at"] < 10:
                return None                       # the dead connection: everything on it hangs
            st.update(n=0, stalled_at=None)       # the browser dropped it — a fresh connection
        if st["n"] >= 2:
            st["stalled_at"] = time.time()
            return None
        st["n"] += 1
        forward(route, refresh=2)                 # quotes every 2 s: many connections are used up in the test
        return True
    pw, browser, page, log, errors, t0 = session(b_server)
    try:
        page.wait_for_function("() => /LIVE/.test(document.getElementById('st-data').textContent) && !/…/.test(document.getElementById('st-data').textContent)", timeout=10000)
        stamps = []
        end = time.time() + 40
        last = None
        while time.time() < end:
            v = page.evaluate("document.getElementById('mkt-upd').textContent")
            if v != last:
                stamps.append(time.time())
                last = v
            time.sleep(0.25)
        gaps = [b - a for a, b in zip(stamps, stamps[1:])]
        oks = len([1 for _, p, path, _ in log["req"] if path.startswith("/api/quotes")]) - len([1 for _, _, path in log["stalled"] if path.startswith("/api/quotes")])
        stalls = len(log["stalled"])
        print(f"       ({len(stamps)} quote updates in 40 s, {stalls} stalled requests, longest gap {max(gaps or [0]):.1f} s)")
        check("B: connections did stall in the test", stalls >= 5, stalls)
        check("B: live quotes keep coming (≥ 10 updates in 40 s)", len(stamps) >= 10, len(stamps))
        check("B: no gap over 10 s", max(gaps or [99]) <= 10, [round(g, 1) for g in gaps])
        seen = [t for _, t in pills(page)]
        check("B: never 'SERVER ✕'", not any(x in t for t in seen for x in X), seen)
        check("B: quotes answered", oks >= 10, oks)
        check("B: no script errors", not errors, errors)
    finally:
        close(pw, browser, log)

    # ---------------------------------------------------------------- C. nothing answers
    pw, browser, page, log, errors, t0 = session(lambda route, port: None)
    try:
        page.wait_for_selector("#mkt table", timeout=5000)
        t_screen = time.time() - t0
        check("C: the screen is full at once with no server", t_screen < 3, f"{t_screen:.2f} s")
        rows = us_rows(page)
        check("C: US stocks from the site data", "SPY" in rows and "AAPL" in rows, rows)
        check("C: news from the site data", "Fed holds rates" in page.inner_text("#news"))
        time.sleep(1.5)
        first = [t for _, t in pills(page)]
        check("C: no 'SERVER ✕' after one slow try", not any(x in t for t in first for x in X), first)
        page.wait_for_function("() => /✕/.test(document.getElementById('st-data').textContent)", timeout=60000)
        t_x = time.time() - t0
        print(f"       ('SERVER ✕' after {t_x:.1f} s of no answer)")
        check("C: 'SERVER ✕' only after several tries (>8 s)", t_x > 8, f"{t_x:.1f} s")
        title = page.evaluate("document.getElementById('st-data').title")
        check("C: the status explains the throttling", "Cloudflare" in title, title)
        ports = sorted({p for _, p, _, _ in log["req"]})
        check("C: all six lanes were tried", ports == [443, 2053, 2083, 2087, 2096, 8443], ports)
        check("C: no script errors", not errors, errors)
    finally:
        close(pw, browser, log)

    # ---------------------------------------------------------------- D. Telegram: no wait for telegram.org
    init = "query_id=AAE&user=%7B%22id%22%3A42%2C%22first_name%22%3A%22T%22%7D&auth_date=1700000000&hash=abc"
    pw, browser, page, log, errors, t0 = session(lambda route, port: forward(route) or True, stall_tg=True,
                                                 url_suffix="#tgWebAppData=" + urllib.parse.quote(init) + "&tgWebAppVersion=7.0")
    try:
        page.wait_for_function("() => /LIVE/.test(document.getElementById('st-data').textContent) && !/…/.test(document.getElementById('st-data').textContent)", timeout=10000)
        q = [(t, h) for t, _, path, h in log["req"] if path.startswith("/api/quotes") and h["_method"] == "GET"]
        first = q[0][0] - t0 if q else 99
        check("D: the first quotes request goes out before telegram.org would time out (<2.5 s)", first < 2.5, f"{first:.2f} s")
        check("D: it carries the Telegram sign-in from the address", q and q[0][1].get("x-tg-init") == init, q and q[0][1].get("x-tg-init"))
        check("D: no script errors", not errors, errors)
    finally:
        close(pw, browser, log)

    wproc.kill()
    static.shutdown()
    if E.FAILS:
        print(f"\nTHROTTLE E2E FAILED: {len(E.FAILS)} of {len(E.FAILS) + len(E.OKS)}")
        sys.exit(1)
    print(f"\nTHROTTLE E2E PASSED ({len(E.OKS)} checks)")


if __name__ == "__main__":
    main()
