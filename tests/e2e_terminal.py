"""
End-to-end test of the terminal in a real browser (Chromium via Playwright).

Starts locally: the site (docs/) and the bot server (the real worker/src code with faked external services,
tests/fake_server.mjs). Checks every function on a desktop and a phone, in English (default) and Russian,
the Markets page, and that the browser console has no errors.
Run: python3 tests/e2e_terminal.py   (screenshots go to the E2E_SHOTS folder, if set)
"""
import functools
import hashlib
import http.server
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DOCS = os.path.join(ROOT, "docs")
SHOTS = os.environ.get("E2E_SHOTS", "")
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")

from playwright.sync_api import sync_playwright  # noqa: E402

BLOCK = ("translate.googleapis.com", "tradingview.com", "binance", "coingecko.com", "alternative.me", "fonts.googleapis.com", "fonts.gstatic.com", "telegram.org")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def start_static():
    port = free_port()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Quiet, directory=DOCS))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, port


def start_fake_worker():
    port = free_port()
    proc = subprocess.Popen(["node", os.path.join(HERE, "fake_server.mjs"), str(port)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for _ in range(100):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1).read()
            return proc, port
        except Exception:
            time.sleep(0.1)
    proc.kill()
    raise RuntimeError("fake worker did not start: " + (proc.stdout.read() if proc.stdout else ""))


FAILS = []
OKS = []


def check(name, cond, info=""):
    (OKS if cond else FAILS).append(name)
    print(("  ok  " if cond else "  FAIL ") + name + ("" if cond else f"  [{info}]"))


def run():
    static, sport = start_static()
    proc, wport = start_fake_worker()
    api = f"http://127.0.0.1:{wport}"
    fx = {n: urllib.request.urlopen(f"{api}/__fx/{n}").read() for n in ("data.json", "stocks.json", "rates.json")}
    # live feed: the bot pushed a fresh story that is not on the site yet
    key = hashlib.sha256(b"econnews-sync:123:TEST").hexdigest()
    body = json.dumps({"updated": "2099-01-01T00:00:00+00:00", "news": [{"title": "Fresh story from the server", "lang": "en",
                                                                         "title_ru": "Свежая новость с сервера", "ts": "2099-01-01T00:00:00+00:00",
                                                                         "level": "high", "sources": ["Live"], "link": "https://x/live"}], "market": []}).encode()
    urllib.request.urlopen(urllib.request.Request(f"{api}/sync/live", data=body, method="POST",
                                                  headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})).read()
    base = f"http://127.0.0.1:{sport}/terminal/"
    errors = []

    def setup(ctx):
        def handle(route):
            url = route.request.url
            if any(b in url for b in BLOCK):
                return route.abort()
            u = urllib.parse.urlparse(url)
            if u.netloc == f"127.0.0.1:{sport}":
                if u.path == "/config.json":
                    return route.fulfill(status=200, content_type="application/json", body=json.dumps({"api": api}))
                if u.path.lstrip("/") in fx:
                    return route.fulfill(status=200, content_type="application/json", body=fx[u.path.lstrip("/")])
            return route.continue_()
        ctx.route("**/*", handle)

    def watch(page):
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text and "ERR_FAILED" not in m.text else None)
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))

    def cmd(page, text):
        page.fill("#cmd", text)
        page.press("#cmd", "Enter")

    def shot(page, name):
        if SHOTS:
            os.makedirs(SHOTS, exist_ok=True)
            page.screenshot(path=os.path.join(SHOTS, name + ".png"))

    def visible_panels(page):
        return page.eval_on_selector_all("main > .panel", "ps => ps.filter(p => getComputedStyle(p).display !== 'none').map(p => p.id)")

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        setup(ctx)
        page = ctx.new_page()
        watch(page)
        page.goto(base)
        page.wait_for_selector("#mkt table")
        vis = visible_panels(page)
        check("default layout: 5 panels", sorted(vis) == sorted(["p-mkt", "p-chart", "p-crypto", "p-news", "p-eco"]), vis)
        check("English by default: panel titles and the RU button",
              page.inner_text("#p-mkt .ph").startswith("WEI") and "WORLD MARKETS" in page.inner_text("#p-mkt .ph")
              and page.inner_text("#b-lang") == "RU" and page.evaluate("document.documentElement.lang") == "en")
        page.wait_for_function("document.querySelector('#mkt').textContent.includes('Gold')", timeout=8000)
        mkt = page.inner_text("#mkt")
        check("markets: English names and number format", "Gold" in mkt and "Brent crude" in mkt and "7,730" in mkt and "INDICES" in mkt, mkt[-600:])
        page.wait_for_function("document.querySelector('#news').textContent.includes('Fresh story from the server')", timeout=8000)
        check("live feed: a fresh story from the bot server in N", True)
        news = page.inner_text("#news")
        check("news: original headlines, English AI note, English tags",
              "Fed holds rates" in news and "Rates stay high for longer" in news and "#Fed" in news and "Tesla shares plunge after recall" in news
              and "Отзыв машин" not in news, news[:500])
        check("news: $TSLA ticker button", page.locator("#news .tkb", has_text="TSLA").count() == 1)
        shot(page, "01_start")

        # DES and the company tabs
        cmd(page, "AAPL DES")
        page.wait_for_function("document.querySelector('#des-body').textContent.includes('Apple Inc')", timeout=8000)
        body = page.inner_text("#des-body")
        check("DES: the Apple card", "P/E" in body and "$5.01T" in body and "Analysts" in body and "Next earnings" in body, body[:300])
        check("DES replaces crypto in the top-right panel", "p-des" in visible_panels(page) and "p-crypto" not in visible_panels(page), visible_panels(page))
        shot(page, "02_des")
        page.click("#des-tabs button[data-t=FA]")
        page.wait_for_selector("#des-body table")
        fa = page.inner_text("#des-body")
        check("FA: SEC financials by quarter", "$109B" in fa and "$29.8B" in fa and "Free cash flow" in fa, fa[:300])
        page.click("#des-body .ptabs button:has-text('YEARS')")
        years = page.inner_text("#des-body table")
        check("FA: switch to years", "2025" in years and "$416B" in years and "$98.0B" in years, years)
        shot(page, "03_fa")
        page.click("#des-tabs button[data-t=ERN]")
        page.wait_for_selector("#des-body svg rect")
        check("ERN: actual/estimate chart and table", page.locator("#des-body svg rect").count() >= 4 and "Q3 2026" in page.inner_text("#des-body"))
        page.click("#des-tabs button[data-t=ANR]")
        check("ANR: distribution of opinions", page.locator("#des-body .anr-bar").count() >= 2 and "Consensus: BUY" in page.inner_text("#des-body"))
        page.click("#des-tabs button[data-t=CN]")
        check("CN: company news, original headlines", "Apple beats estimates" in page.inner_text("#des-body"))
        page.click("#des-tabs button[data-t=HDS]")
        check("HDS: insider trades", "Cook Tim" in page.inner_text("#des-body") and "SALE" in page.inner_text("#des-body"))
        page.click("#des-tabs button[data-t=DES]")

        # HP: table and CSV
        cmd(page, "HP AAPL")
        page.wait_for_function("document.querySelectorAll('#hp-body tbody tr').length >= 200", timeout=8000)
        check("HP: 250 days of history", page.locator("#hp-body tbody tr").count() == 250)
        with page.expect_download() as dl:
            page.click("#hp-body button:has-text('CSV')")
        d = dl.value
        path = d.path()
        with open(path, encoding="utf-8-sig") as f:
            lines = f.read().strip().splitlines()
        check("HP: CSV export", d.suggested_filename == "AAPL_1y.csv" and lines[0] == "date,open,high,low,close,volume" and len(lines) == 251,
              (d.suggested_filename, lines[:2], len(lines)))
        check("HP: English stats", "Over 1 year" in page.inner_text("#hp-body .stat"), page.inner_text("#hp-body .stat"))
        shot(page, "04_hp")

        # COMP
        cmd(page, "COMP AAPL MSFT")
        page.wait_for_selector("#hp-body .cv canvas")
        page.wait_for_function("document.querySelectorAll('#hp-body .cv .legend span').length === 2", timeout=8000)
        check("COMP: two instruments on one chart", page.locator("#hp-body .cv .legend span").count() == 2)
        shot(page, "05_comp")

        # EQS
        cmd(page, "EQS")
        page.wait_for_selector("#eqs-body tbody tr")
        check("EQS: all companies", page.locator("#eqs-body tbody tr").count() == 3)
        page.select_option("#eqs-body select", "Energy")
        page.wait_for_function("document.querySelectorAll('#eqs-body tbody tr').length === 1")
        check("EQS: sector filter", "XOM" in page.inner_text("#eqs-body tbody"))
        page.select_option("#eqs-body select", "")
        page.wait_for_function("document.querySelectorAll('#eqs-body tbody tr').length === 3")
        page.click("#eqs-body th:has-text('P/E') >> nth=0")
        first = page.inner_text("#eqs-body tbody tr:first-child td:first-child")
        check("EQS: sort by P/E", first == "XOM", first)
        shot(page, "06_eqs")
        page.click("#eqs-body tbody tr:first-child")
        page.wait_for_function("document.querySelector('#des-title').textContent.includes('XOM')", timeout=8000)
        check("EQS: a row opens DES", True)
        cmd(page, "EQS GAINERS")
        page.wait_for_selector("#eqs-body tbody tr")
        check("EQS GAINERS preset", page.inner_text("#eqs-body tbody tr:first-child td:first-child") == "NVDA")

        # IMAP
        cmd(page, "IMAP")
        page.wait_for_selector("#imap .tile")
        check("IMAP: company tiles and English sectors", page.locator("#imap .tile").count() == 3 and "Technology" in page.inner_text("#imap"))
        shot(page, "07_imap")
        page.click("#imap .tile:has-text('NVDA')")
        page.wait_for_function("document.querySelector('#des-title').textContent.includes('NVDA')", timeout=8000)
        check("IMAP: a tile opens DES", True)

        # GC / CB / WIRP
        cmd(page, "GC")
        page.wait_for_selector("#gc-body svg path")
        check("GC: curves and table", page.locator("#gc-body svg path").count() >= 1 and "10Y" in page.inner_text("#gc-body table")
              and "United States" in page.inner_text("#gc-body"))
        shot(page, "08_gc")
        cmd(page, "CB")
        page.wait_for_function("document.querySelector('#gc-body').textContent.includes('Bank of Russia')", timeout=5000)
        check("CB: central bank rates", "-100 bp" in page.inner_text("#gc-body"), page.inner_text("#gc-body")[:300])
        cmd(page, "WIRP")
        page.wait_for_selector("#gc-body .prob i")
        check("WIRP: probabilities by meeting", "hike 50%" in page.inner_text("#gc-body"))

        # W / PORT / ALRT (first without signing in — this browser only)
        cmd(page, "W AAPL BTC")
        page.wait_for_function("document.querySelectorAll('#my-body tbody tr').length === 2", timeout=8000)
        page.wait_for_function("document.querySelector('#my-body').textContent.includes('342.96')", timeout=8000)
        check("W: the list with prices", "this browser only" in page.inner_text("#my-sub"))
        cmd(page, "PORT")
        page.fill("#my-body form input.t", "AAPL")
        page.fill("#my-body form input[placeholder='qty']", "10")
        page.fill("#my-body form input[placeholder='price']", "300")
        page.click("#my-body form button:has-text('BUY')")
        page.wait_for_function("document.querySelector('#my-body tfoot') && document.querySelector('#my-body tfoot').textContent.includes('TOTAL')", timeout=8000)
        port = page.inner_text("#my-body")
        check("PORT: position and total", "+$429.60" in port and "+14.3%" in port and "TOTAL $" in port, port[:400])
        shot(page, "09_port")
        cmd(page, "ALRT")
        check("ALRT without sign-in: the Telegram hint", "Alerts arrive" in page.inner_text("#my-body"))
        # owner sign-in with the password → data shared with the bot
        cmd(page, "SET")
        page.fill("#k-pass", "pw")
        page.click("#k-login")
        page.wait_for_function("document.querySelector('#k-msg').textContent.includes('Done')", timeout=8000)
        page.keyboard.press("Escape")
        cmd(page, "ALRT AAPL > 400")
        page.wait_for_selector("#my-body form input.t")
        val = page.input_value("#my-body form input.t")
        page.click("#my-body form button.solid")
        try:
            page.wait_for_function("document.querySelector('#my-body').textContent.includes('AAPL above 400')", timeout=8000)
        except Exception:
            print("DEBUG my-body:", page.inner_text("#my-body")[:500], "| sub:", page.inner_text("#my-sub"), "| errors:", errors[:3])
            raise
        check("ALRT: alert set on the server", val == "AAPL > 400" and "☁" in page.inner_text("#my-sub"), val)
        cmd(page, "ALRT ???")
        page.wait_for_selector("#my-body form input.t")
        page.click("#my-body form button.solid")
        page.wait_for_function("document.querySelector('#my-body .err')", timeout=8000)
        check("ALRT: server error in English", "Didn't get the alert" in page.inner_text("#my-body .err"), page.inner_text("#my-body .err"))
        cmd(page, "W")
        page.wait_for_function("document.querySelectorAll('#my-body tbody tr').length >= 2", timeout=8000)
        me = {}
        for _ in range(20):   # changes reach the server after a 0.4 s delay
            me = json.loads(urllib.request.urlopen(urllib.request.Request(f"{api}/api/me", headers={"X-Owner-Key": "pw"})).read())
            if me.get("w") and me.get("p"):
                break
            page.wait_for_timeout(250)
        check("W/PORT: moved to the server (shared with the bot)", "AAPL" in me.get("w", []) and any(x["s"] == "AAPL" for x in me.get("p", [])), me)
        shot(page, "10_alrt")

        # ECO: company earnings
        page.click("#eco-tabs button[data-t=earn]")
        page.wait_for_selector("#earn table")
        check("ECO: the earnings tab", "AAPL" in page.inner_text("#earn") and "after close" in page.inner_text("#earn"))

        # layouts
        cmd(page, "LAYOUT 4")
        time.sleep(0.3)
        check("LAYOUT 4: four panels", len(visible_panels(page)) == 4, visible_panels(page))
        shot(page, "11_layout4")
        cmd(page, "LAYOUT 6")
        time.sleep(0.3)
        check("LAYOUT 6: six panels", len(visible_panels(page)) == 6, visible_panels(page))
        shot(page, "12_layout6")
        first_panel = visible_panels(page)[0]
        page.click(f"#{first_panel} .ph .pick")
        page.click("#fnmenu button:has-text('US market map')")
        time.sleep(0.3)
        vis = visible_panels(page)
        check("▾ in a title: another function in the panel", "p-imap" in vis and first_panel not in vis and len(vis) == 6, vis)
        cmd(page, "LAYOUT 1")
        time.sleep(0.2)
        check("LAYOUT 1: back to five", len(visible_panels(page)) == 5)

        # a ticker in a story
        cmd(page, "N")
        page.click("#news .tkb:has-text('TSLA')")
        page.wait_for_function("document.querySelector('#des-title').textContent.includes('TSLA')", timeout=8000)
        check("a ticker in the news opens the company", True)

        # HELP is built from the dictionary
        cmd(page, "HELP")
        check("HELP: the command table in English", "company card" in page.inner_text("#ov-help") and page.locator("#help-t tr").count() > 30)
        page.keyboard.press("Escape")

        # a link from the bot: ?cmd=
        page2 = ctx.new_page()
        watch(page2)
        page2.goto(base + "?cmd=" + urllib.request.quote("MSFT FA"))
        page2.wait_for_function("document.querySelector('#des-title').textContent.includes('MSFT')", timeout=8000)
        page2.wait_for_selector("#des-body table")
        check("link ?cmd=MSFT FA from the bot", "per-share figures" in page2.inner_text("#des-body"))
        page2.close()

        overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check("desktop: no horizontal scroll", overflow <= 0, overflow)

        # Russian: ?lang=ru (as the bot's buttons do for Russian readers), then the toggle back
        rctx = browser.new_context(viewport={"width": 1440, "height": 900})
        setup(rctx)
        r = rctx.new_page()
        watch(r)
        r.goto(base + "?lang=ru")
        r.wait_for_selector("#mkt table")
        check("RU: interface in Russian", "МИРОВЫЕ РЫНКИ" in r.inner_text("#p-mkt .ph") and r.inner_text("#b-lang") == "EN"
              and "Золото" in r.inner_text("#mkt") and "ИНДЕКСЫ" in r.inner_text("#mkt") and ",00%" in r.inner_text("#mkt"), r.inner_text("#mkt")[:200])
        r.wait_for_function("document.querySelector('#news').textContent.includes('Свежая новость с сервера')", timeout=8000)
        rn = r.inner_text("#news")
        check("RU: news translated, Russian AI note and tags", "ФРС сохранила ставку" in rn and "Отзыв машин" in rn and "#ФРС" in rn, rn[:400])
        r.fill("#cmd", "AAPL DES"); r.press("#cmd", "Enter")
        r.wait_for_function("document.querySelector('#des-body').textContent.includes('Apple Inc')", timeout=8000)
        rb = r.inner_text("#des-body")
        check("RU: DES in Russian", "$5,01 трлн" in rb and "Аналитики" in rb and "Следующий отчёт" in rb, rb[:300])
        r.click("#des-tabs button[data-t=CN]")
        r.wait_for_function("document.querySelector('#des-body').textContent.includes('Apple превзошла')", timeout=8000)
        check("RU: CN translated by the server", True)
        r.fill("#cmd", "EQS"); r.press("#cmd", "Enter")
        r.wait_for_selector("#eqs-body tbody tr")
        r.select_option("#eqs-body select", "Энергетика")
        r.wait_for_function("document.querySelectorAll('#eqs-body tbody tr').length === 1")
        check("RU: sectors in Russian", "XOM" in r.inner_text("#eqs-body tbody"))
        shot(r, "16_ru")
        r.click("#b-lang")
        r.wait_for_function("(document.querySelector('#b-lang') || {}).textContent === 'RU' && !!document.querySelector('#mkt table')", timeout=8000)
        r.wait_for_selector("#mkt table")
        check("the EN/RU button switches back to English and is remembered", "WORLD MARKETS" in r.inner_text("#p-mkt .ph")
              and r.evaluate("localStorage.getItem('lang')") == "en")

        # the Markets page in both languages
        mp = rctx.new_page()
        watch(mp)
        mp.goto(f"http://127.0.0.1:{sport}/")
        mp.wait_for_selector("#tiles .tile .n")
        check("Markets page: English", "Gold" in mp.inner_text("#tiles") and mp.inner_text("#h1") == "Markets", mp.inner_text("#tiles")[:200])
        mp.click("#lang")
        mp.wait_for_function("(document.querySelector('#h1') || {}).textContent === 'Рынок онлайн'", timeout=8000)
        mp.wait_for_selector("#tiles .tile .n")
        check("Markets page: Russian after the toggle", "Золото" in mp.inner_text("#tiles"))
        mp.click("button[data-tab=news]")
        check("Markets page: Russian news", "ФРС сохранила ставку" in mp.inner_text("#news"))
        rctx.close()

        # phone
        mctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, accept_downloads=True)
        setup(mctx)
        m = mctx.new_page()
        watch(m)
        m.goto(base)
        m.wait_for_selector("#mkt table")
        check("phone: one panel visible", len(visible_panels(m)) == 1, visible_panels(m))
        m.click("#b-more")
        m.click("#fnlist button:has-text('Screener')")
        m.wait_for_selector("#eqs-body tbody tr")
        check("phone: functions menu → screener", visible_panels(m) == ["p-eqs"], visible_panels(m))
        shot(m, "13_mobile_eqs")
        m.fill("#cmd", "AAPL DES")
        m.press("#cmd", "Enter")
        m.wait_for_function("document.querySelector('#des-body').textContent.includes('Apple Inc')", timeout=8000)
        check("phone: DES", visible_panels(m) == ["p-des"], visible_panels(m))
        shot(m, "14_mobile_des")
        m.click("#b-more")
        m.click("#fnlist button:has-text('Yield curves')")
        m.wait_for_selector("#gc-body svg path")
        shot(m, "15_mobile_gc")
        ov = m.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check("phone: no horizontal page scroll", ov <= 0, ov)
        browser.close()

    proc.kill()
    static.shutdown()
    check("no errors in the browser console", not errors, errors[:5])
    if FAILS:
        print(f"\nFAILED: {len(FAILS)} of {len(FAILS) + len(OKS)}")
        sys.exit(1)
    print(f"\nTERMINAL E2E PASSED ({len(OKS)} checks)")


if __name__ == "__main__":
    run()
