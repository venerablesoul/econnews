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

BLOCK = ("translate.googleapis.com", "tradingview.com", "binance", "coingecko.com", "alternative.me", "fonts.googleapis.com", "fonts.gstatic.com", "telegram.org", "gibs.earthdata.nasa.gov", "tiles.maps.eox.at", "planetarycomputer.microsoft.com")


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


def extra_fixtures():
    import datetime as dt
    import io as _io
    from PIL import Image, ImageDraw
    now = dt.datetime.now(dt.timezone.utc)
    day = lambda i: (now.date() - dt.timedelta(days=i)).isoformat()
    choke = []
    for i, (name, lat, lon, n) in enumerate([("Suez Canal", 30.6, 32.3, 60), ("Strait of Hormuz", 26.6, 56.3, 30), ("Malacca Strait", 2.5, 101.4, 220),
                                             ("Bab el-Mandeb Strait", 12.6, 43.3, 25), ("Panama Canal", 9.1, -79.7, 33)], 1):
        days = [[day(k), n - (5 if k < 7 else 0), n // 3, 10, 20, 123456, 45000] for k in range(40, 3, -1)]
        choke.append({"id": "chokepoint%d" % i, "name": name, "lat": lat, "lon": lon, "yr": 20000, "top": "Tanker", "days": days})
    m = int(now.timestamp() // 60)
    cols = ["mmsi", "name", "kind", "lat", "lon", "sog", "cog", "nav", "minute", "dest", "draught", "track"]
    ships = [[538000001, "GULF STAR", "t", 27.0, -90.5, 12.5, 45, 0, m - 5, "HOUSTON", 14.1, [26.6, -91.0, 60, 26.8, -90.75, 30]],
             [538000002, "BOX ONE", "c", 25.5, -88.0, 15.0, 270, 0, m - 2, "VERACRUZ", 11.0, [25.5, -87.4, 30]],
             [538000003, "<img src=x onerror=alert(1)>", "c", 24.0, -86.0, 0.0, None, 1, m - 9, "<b>x</b>", None, []]]
    world = {"updated": now.isoformat(), "src": "aisstream.io", "hours": 6, "counts": {"t": 1, "c": 2}, "cols": cols, "s": ships}

    def jpeg(color):
        im = Image.new("RGB", (240, 240), color)
        d = ImageDraw.Draw(im)
        for x in range(20, 220, 40):
            d.ellipse([x, 100, x + 24, 124], fill=(210, 210, 205))
        b = _io.BytesIO()
        im.save(b, "JPEG", quality=80)
        return b.getvalue()
    sites = [{"id": "cushing", "name": "Cushing, Oklahoma (WTI hub)", "name_ru": "Кушинг, Оклахома (хаб WTI)", "lat": 35.957, "lon": -96.757, "km": 7.0,
              "imgs": [{"d": day(40), "t": "17:10", "cloud": 1.0, "f": "sat/cushing/%s.jpg" % day(40)},
                       {"d": day(3), "t": "17:10", "cloud": 2.5, "f": "sat/cushing/%s.jpg" % day(3)}]},
             {"id": "fujairah", "name": "Fujairah", "name_ru": "Фуджейра", "lat": 25.178, "lon": 56.355, "km": 6.0, "imgs": []}]
    tb = _io.BytesIO()
    tim = Image.new("RGB", (256, 256), (24, 58, 96))
    ImageDraw.Draw(tim).ellipse([60, 60, 190, 190], fill=(70, 110, 60))
    tim.save(tb, "JPEG", quality=70)
    out_tiles = {"__tile__": tb.getvalue(),
                 "base/meta.json": json.dumps({"version": 1, "layers": {"day": {"url": "x", "ext": "jpg", "max": 4, "done": True},
                                                                          "lights": {"url": "x", "ext": "jpg", "max": 4, "done": True}}}).encode()}
    out = {"portwatch.json": json.dumps({"updated": now.isoformat(), "src": "IMF PortWatch", "choke": choke}).encode(),
           "ships_world.json": json.dumps(world).encode(),
           "sat.json": json.dumps({"updated": now.isoformat(), "src": "Contains modified Copernicus Sentinel data 2026 · via Microsoft Planetary Computer", "sites": sites}).encode(),
           "sat/cushing/%s.jpg" % day(40): jpeg((95, 85, 60)), "sat/cushing/%s.jpg" % day(3): jpeg((60, 80, 70))}
    out.update(out_tiles)
    return out


def run():
    static, sport = start_static()
    proc, wport = start_fake_worker()
    api = f"http://127.0.0.1:{wport}"
    fx = {n: urllib.request.urlopen(f"{api}/__fx/{n}").read() for n in ("data.json", "stocks.json", "rates.json", "macro.json", "moex.json", "options.json",
                                                                       "gex/SPX.json", "gex/BTC.json", "gex/hist/SPX.json", "gex/hist/BTC.json", "ships.json")}
    fx.update(extra_fixtures())
    key = hashlib.sha256(b"econnews-sync:123:TEST").hexdigest()
    body = json.dumps({"updated": "2099-01-01T00:00:00+00:00", "news": [{"title": "Fresh story from the server", "lang": "en",
                                                                         "title_ru": "Свежая новость с сервера", "title_zh": "来自服务器的最新消息",
                                                                         "title_ar": "خبر جديد من الخادم", "ts": "2099-01-01T00:00:00+00:00",
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
                    kind = "image/jpeg" if u.path.endswith(".jpg") else "application/json"
                    return route.fulfill(status=200, content_type=kind, body=fx[u.path.lstrip("/")])
                if u.path.startswith("/base/") and u.path.endswith(".jpg") and "__tile__" in fx:
                    return route.fulfill(status=200, content_type="image/jpeg", body=fx["__tile__"])
            return route.continue_()
        ctx.route("**/*", handle)

    def setup_binance(ctx):
        import fake_binance

        def handle(route):
            url = route.request.url
            if "binance" in url:
                a = fake_binance.answer(url)
                if a is not None:
                    return route.fulfill(status=200, content_type="application/json", body=json.dumps(a), headers={"Access-Control-Allow-Origin": "*"})
                return route.abort()
            return route.fallback()
        ctx.route("**/*", handle)
        ctx.add_init_script(path=os.path.join(HERE, "fake_binance.js"))

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
        check("English by default: panel titles and the language button",
              page.inner_text("#p-mkt .ph").startswith("WEI") and "WORLD MARKETS" in page.inner_text("#p-mkt .ph")
              and page.inner_text("#b-lang") == "EN ▾" and page.evaluate("document.documentElement.lang") == "en"
              and page.evaluate("window.L10N_XL === undefined"), page.inner_text("#b-lang"))
        page.click("#b-lang")
        check("the language menu: four languages, English marked", page.is_visible("#lang-menu")
              and page.eval_on_selector_all("#lang-menu button", "bs => bs.map(b => b.lang).join()") == "en,ru,zh,ar"
              and page.get_attribute("#lang-menu button.on", "lang") == "en")
        shot(page, "00_lang_menu")
        page.keyboard.press("Escape")
        check("the language menu closes with Escape", not page.is_visible("#lang-menu"))
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
        hds = page.inner_text("#des-body")
        shot(page, "02e_hds")
        check("HDS: holders, funds, short interest and insider trades", "Blackrock Inc." in hds and "Vanguard 500 Index Fund" in hds and "Short interest" in hds
              and "120,763,539" in hds and "Cook Tim" in hds and "SALE" in hds, hds[:600])
        page.click("#des-tabs button[data-t=EE]")
        ee = page.inner_text("#des-body")
        shot(page, "02d_ee")
        check("EE: estimates, revisions, surprises", "Current qtr" in ee and "$1.98" in ee and "Next report: 2 Nov 2026" in ee and "Surprises" in ee, ee[:500])
        page.click("#des-tabs button[data-t=ANR]")
        anr = page.inner_text("#des-body")
        check("ANR: price target and rating changes", "Analyst price target" in anr and "$329.38" in anr and "JP Morgan" in anr and "Rating changes" in anr, anr[:500])
        page.click("#des-tabs button[data-t=DVD]")
        dvd = page.inner_text("#des-body")
        check("DVD: dividends by year and splits", "Annual dividend" in dvd and "$1.05" in dvd and "Splits: 4:1" in dvd and page.locator("#des-body svg rect").count() >= 1,
              (page.locator("#des-body svg rect").count(), dvd[:300]))
        page.click("#des-tabs button[data-t=OMON]")
        page.wait_for_selector("#des-body table.chain tbody tr")
        om = page.inner_text("#des-body")
        check("OMON: chain with calls and puts, expiries, max pain", page.locator("#des-body table.chain tbody tr").count() >= 10 and "CALLS" in om and "PUTS" in om
              and "Max pain" in om and page.locator("#des-body td.itm").count() > 0, om[:400])
        shot(page, "02c_omon_chain")
        page.click("#des-body .ptabs button >> nth=1")
        check("OMON: another expiry", page.locator("#des-body .ptabs button.on").inner_text() == "23 Oct", page.locator("#des-body .ptabs button.on").inner_text())
        page.click("#des-tabs button[data-t=RV]")
        rv = page.inner_text("#des-body")
        check("RV: the company and its peers with the median", "NVDA" in rv and "Peer median" in rv and page.locator("#des-body tr.me").count() == 1, rv[:300])
        page.click("#des-tabs button[data-t=CF]")
        check("CF: SEC filings with links", "quarterly report" in page.inner_text("#des-body") and page.locator("#des-body td a").count() >= 3)
        shot(page, "02b_omon")
        cmd(page, "AAPL MGMT")
        page.wait_for_selector("#mgmt")
        des_main = page.inner_text("#des-body")
        check("DES: description, management (MGMT) and price target", "Management (MGMT)" in des_main and "Timothy D. Cook" in des_main
              and "American multinational technology company" in des_main and "Analyst price target" in des_main, des_main[:400])

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

        cmd(page, "COMP AAPL MSFT")
        page.wait_for_selector("#hp-body .cv canvas")
        page.wait_for_function("document.querySelectorAll('#hp-body .cv .legend span').length === 2", timeout=8000)
        check("COMP: two instruments on one chart", page.locator("#hp-body .cv .legend span").count() == 2)
        shot(page, "05_comp")

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

        cmd(page, "EQS RU")
        page.wait_for_function("document.querySelector('#eqs-body').textContent.includes('SBER')", timeout=8000)
        check("EQS RU: Moscow Exchange screener", page.locator("#eqs-body tbody tr").count() == 10 and "IMOEX, %" in page.inner_text("#eqs-body thead"))
        page.click("#eqs-body th:has-text('Day')")
        check("EQS RU: sort by day change", page.inner_text("#eqs-body tbody tr:first-child td:first-child") in ("PIKK", "GAZP"), page.inner_text("#eqs-body tbody tr:first-child"))
        page.click("#eqs-body .ptabs button:has-text('US')")
        page.wait_for_function("document.querySelectorAll('#eqs-body tbody tr').length === 3", timeout=8000)
        check("EQS: back to US stocks", True)

        cmd(page, "IMAP")
        page.wait_for_selector("#imap .tile")
        check("IMAP: company tiles and English sectors", page.locator("#imap .tile").count() == 3 and "Technology" in page.inner_text("#imap"))
        shot(page, "07_imap")
        page.click("#imap .tile:has-text('NVDA')")
        page.wait_for_function("document.querySelector('#des-title').textContent.includes('NVDA')", timeout=8000)
        check("IMAP: a tile opens DES", True)

        cmd(page, "IMAP RU")
        page.wait_for_function("document.querySelector('#imap').textContent.includes('SBER')", timeout=8000)
        shot(page, "07e_imap_ru")
        check("IMAP RU: Moscow Exchange tiles by sector", page.locator("#imap .tile").count() >= 9 and "Financials" in page.inner_text("#imap")
              and "Moscow Exchange" in page.inner_text("#imap-sub"), (page.locator("#imap .tile").count(), page.inner_text("#imap")[:300]))
        page.click("#imap-tabs button[data-g=US]")
        page.wait_for_function("document.querySelectorAll('#imap .tile').length === 3", timeout=8000)
        check("IMAP: back to US stocks", True)

        cmd(page, "ECST")
        page.wait_for_function("document.querySelector('#ana-body').textContent.includes('United States')", timeout=8000)
        check("ECST: IMF forecasts by country", "GDP 2026" in page.inner_text("#ana-body") and page.locator("#ana-body tbody tr").count() >= 20)
        page.click("#ana-body tr.row:has-text('Russia')")
        page.wait_for_function("document.querySelector('#ana-body').textContent.includes('Real GDP growth')", timeout=8000)
        check("ECST: one country over the years", "2028*" in page.inner_text("#ana-body") and "ALL COUNTRIES" in page.inner_text("#ana-body"))
        shot(page, "07b_ecst")
        cmd(page, "FXC")
        page.wait_for_function("document.querySelectorAll('#ana-body table.mx tbody tr').length >= 3", timeout=8000)
        fxc = page.inner_text("#ana-body")
        shot(page, "07c_fxc")
        check("FXC: cross-rate matrix", "EUR" in fxc and "USD" in fxc and "JPY" in fxc, fxc[:300])
        cmd(page, "CORR AAPL BTC GOLD 1Y")
        page.wait_for_function("document.querySelectorAll('#ana-body table.mx tbody tr').length === 3", timeout=8000)
        shot(page, "07d_corr")
        page.wait_for_timeout(600)
        check("CORR: drawn once", page.locator("#ana-body table.mx").count() == 1, page.locator("#ana-body table.mx").count())
        check("CORR: 3×3 matrix with ones on the diagonal", page.locator("#ana-body table.mx td:has-text('1.00')").count() >= 3, page.inner_text("#ana-body")[:300])
        cmd(page, "OMON")
        page.wait_for_function("document.querySelector('#ana-body').textContent.includes('SPDR')", timeout=8000)
        check("OMON: options overview", "AAPL" in page.inner_text("#ana-body") and "P/C vol" in page.inner_text("#ana-body"))
        page.click("#ana-body tr.row:has-text('AAPL')")
        page.wait_for_selector("#des-body table.chain")
        check("OMON overview: a row opens the chain", True)
        cmd(page, "IPO")
        page.wait_for_function("document.querySelector('#ana-body').textContent.includes('CTY')", timeout=8000)
        check("IPO: calendar", "CITY THERAPEUTICS" in page.inner_text("#ana-body") and "expected" in page.inner_text("#ana-body"))

        cmd(page, "HP AAPL 1D")
        page.wait_for_selector("#hp-body tbody tr")
        check("HP 1D: intraday range is accepted", "Over 1 day" in page.inner_text("#hp-body .stat") and page.locator("#hp-tabs button[data-r='1d'].on").count() == 1,
              page.inner_text("#hp-body .stat"))
        cmd(page, "HP AAPL 1Y")
        page.wait_for_selector("#hp-body .stat")
        page.wait_for_function("document.querySelector('#hp-body .stat').textContent.includes('RSI')", timeout=8000)
        check("HP: RSI and SMA 200", "RSI(14)" in page.inner_text("#hp-body .stat") and "vs SMA 200" in page.inner_text("#hp-body .stat"), page.inner_text("#hp-body .stat"))

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
        for _ in range(20):
            me = json.loads(urllib.request.urlopen(urllib.request.Request(f"{api}/api/me", headers={"X-Owner-Key": "pw"})).read())
            if me.get("w") and me.get("p"):
                break
            page.wait_for_timeout(250)
        check("W/PORT: moved to the server (shared with the bot)", "AAPL" in me.get("w", []) and any(x["s"] == "AAPL" for x in me.get("p", [])), me)
        shot(page, "10_alrt")

        page.click("#eco-tabs button[data-t=earn]")
        page.wait_for_selector("#earn table")
        check("ECO: the earnings tab", "AAPL" in page.inner_text("#earn") and "after close" in page.inner_text("#earn"))

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
        page.click("#fnmenu button:has(b:text-is('IMAP'))")
        time.sleep(0.3)
        vis = visible_panels(page)
        check("▾ in a title: another function in the panel", "p-imap" in vis and first_panel not in vis and len(vis) == 6, vis)
        cmd(page, "LAYOUT 1")
        time.sleep(0.2)
        check("LAYOUT 1: back to five", len(visible_panels(page)) == 5)

        cmd(page, "N")
        page.click("#news .tkb:has-text('TSLA')")
        page.wait_for_function("document.querySelector('#des-title').textContent.includes('TSLA')", timeout=8000)
        check("a ticker in the news opens the company", True)

        cmd(page, "HELP")
        check("HELP: the command table in English", "company card" in page.inner_text("#ov-help") and page.locator("#help-t tr").count() > 30)
        page.keyboard.press("Escape")

        page2 = ctx.new_page()
        watch(page2)
        page2.goto(base + "?cmd=" + urllib.request.quote("MSFT FA"))
        page2.wait_for_function("document.querySelector('#des-title').textContent.includes('MSFT')", timeout=8000)
        page2.wait_for_selector("#des-body table")
        check("link ?cmd=MSFT FA from the bot", "per-share figures" in page2.inner_text("#des-body"))
        page2.close()

        overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check("desktop: no horizontal scroll", overflow <= 0, overflow)

        rctx = browser.new_context(viewport={"width": 1440, "height": 900})
        setup(rctx)
        r = rctx.new_page()
        watch(r)
        r.goto(base + "?lang=ru")
        r.wait_for_selector("#mkt table")
        check("RU: interface in Russian", "МИРОВЫЕ РЫНКИ" in r.inner_text("#p-mkt .ph") and r.inner_text("#b-lang") == "RU ▾"
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
        r.click("#des-tabs button[data-t=EE]")
        check("RU: EE in Russian", "Тек. квартал" in r.inner_text("#des-body") and "Сюрпризы" in r.inner_text("#des-body"))
        r.click("#des-tabs button[data-t=HDS]")
        check("RU: HDS in Russian", "Крупнейшие институционалы" in r.inner_text("#des-body") and "Короткие позиции" in r.inner_text("#des-body"))
        r.click("#des-tabs button[data-t=OMON]")
        r.wait_for_selector("#des-body table.chain")
        check("RU: OMON in Russian", "КОЛЛЫ" in r.inner_text("#des-body") and "Экспирации" in r.inner_text("#des-body"))
        r.click("#des-tabs button[data-t=DES]")
        check("RU: the description from the Russian Wikipedia", "американская корпорация" in r.inner_text("#des-body"))
        r.fill("#cmd", "ECST RU"); r.press("#cmd", "Enter")
        r.wait_for_function("document.querySelector('#ana-body').textContent.includes('Рост реального ВВП')", timeout=8000)
        check("RU: ECST for Russia in Russian", "Россия" in r.inner_text("#ana-body"))
        r.fill("#cmd", "IMAP RU"); r.press("#cmd", "Enter")
        r.wait_for_function("document.querySelector('#imap').textContent.includes('Финансы')", timeout=8000)
        check("RU: the Moscow Exchange map in Russian", "Мосбиржа" in r.inner_text("#imap-sub"))
        r.fill("#cmd", "EQS"); r.press("#cmd", "Enter")
        r.wait_for_selector("#eqs-body tbody tr")
        r.select_option("#eqs-body select", "Энергетика")
        r.wait_for_function("document.querySelectorAll('#eqs-body tbody tr').length === 1")
        check("RU: sectors in Russian", "XOM" in r.inner_text("#eqs-body tbody"))
        shot(r, "16_ru")
        r.click("#b-lang")
        r.click("#lang-menu button[lang=en]")
        r.wait_for_function("(document.querySelector('#b-lang') || {}).textContent === 'EN ▾' && !!document.querySelector('#mkt table')", timeout=8000)
        r.wait_for_selector("#mkt table")
        check("the language menu switches back to English and is remembered", "WORLD MARKETS" in r.inner_text("#p-mkt .ph")
              and r.evaluate("localStorage.getItem('lang')") == "en")

        def opt_body(cmd_text, sel, ms=8000):
            r.fill("#cmd", cmd_text); r.press("#cmd", "Enter")
            r.wait_for_function("(function(){ var b = document.querySelector('#gex-body'); return b && !b.querySelector('.loading') && b.querySelector('" + sel + "') })()", timeout=ms)
            return r.inner_text("#gex-body")

        def drawn(sel):
            return r.evaluate("(function(){ var c = document.querySelector('" + sel + "'); if (!c) return 0; var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, n = 0; for (var i = 3; i < d.length; i += 4) if (d[i]) n++; return n })()")
        g = opt_body("GEX SPX", ".gx-cv canvas")
        check("GEX: S&P 500 levels and bars", "Gamma flip: 6,682" in g and "Call wall: 6,800" in g and "Put wall: 6,750" in g and drawn("#gex-body .gx-cv canvas") > 5000, g[:300])
        r.hover("#gex-body .gx-cv canvas", position={"x": 300, "y": 160})
        check("GEX: the read-out of a strike", "Strike" in r.inner_text("#tm-tip") and "Net:" in r.inner_text("#tm-tip"), r.inner_text("#tm-tip"))
        shot(r, "20_gex")
        for m_, label in (("NET", "NET"), ("VANNA", "VANNA"), ("OPEN INTEREST", "OPEN INTEREST")):
            r.click(f"#gex-body .chipbtn:has-text('{m_}')")
            check(f"GEX: the {label} view draws", drawn("#gex-body .gx-cv canvas") > 3000)
        r.click("#gex-body .chipbtn:has-text('CALLS & PUTS')")
        lv = opt_body("LVL", "table")
        check("LVL: levels and the expected move", "Gamma flip" in lv and "+1σ today" in lv and "Max pain" in lv and "Straddle to" in lv, lv[:400])
        check("LVL: the GEX profile chart draws", drawn("#gex-body .gx-small canvas") > 2000)
        r.click("#gex-body .actions button")
        r.wait_for_function("document.querySelector('#tech-body') && document.querySelector('#tech-body .tc-cv canvas')", timeout=8000)
        check("LVL → TECH with the option levels switched on", r.evaluate("JSON.parse(localStorage.getItem('tech_ta') || '{}').gex") == 1
              and "OPTION LEVELS" in r.inner_text("#tech-body"))
        r.wait_for_selector("#tech-body .tc-gexnote", timeout=8000)
        check("TECH: option levels far from the chart's prices are left out", "do not fit the prices" in r.inner_text("#tech-body .tc-gexnote"),
              r.inner_text("#tech-body .tc-gexnote"))
        ndx = json.loads(fx["gex/SPX.json"]); ndx.update({"s": "NDX", "n": "Nasdaq-100 index"})
        fx["gex/NDX.json"] = json.dumps(ndx).encode()
        nl = opt_body("LVL NDX", "table")
        check("LVL NDX: no 'on the chart' button (TECH's Nasdaq is the Composite)", r.locator("#gex-body .actions button").count() == 0 and "Gamma flip" in nl, nl[:200])
        r.fill("#cmd", "TECH Nasdaq"); r.press("#cmd", "Enter")
        r.wait_for_function("((document.querySelector('#tech-body .tc-gexnote') || {}).textContent || '').includes('exist for')", timeout=8000)
        check("TECH Nasdaq gets no Nasdaq-100 levels", "Option levels exist for" in r.inner_text("#tech-body .tc-gexnote")
              and "NDX" not in r.inner_text("#tech-body .tc-gexnote"), r.inner_text("#tech-body .tc-gexnote"))
        v = opt_body("VOLS SPX", ".gx-3d canvas")
        check("VOLS: the 3D surface, smile and term structure", drawn("#gex-body .gx-3d canvas") > 5000 and "IV 30 days" in v and r.locator("#gex-body .gx-two canvas").count() == 2, v[:200])
        box = r.locator("#gex-body .gx-3d").bounding_box()
        before = drawn("#gex-body .gx-3d canvas")
        r.mouse.move(box["x"] + 200, box["y"] + 150); r.mouse.down(); r.mouse.move(box["x"] + 320, box["y"] + 170, steps=4); r.mouse.up()
        check("VOLS: dragging turns the surface", drawn("#gex-body .gx-3d canvas") != before)
        shot(r, "21_vols")
        r.click("#gex-body .chipbtn:has-text('HEATMAP')")
        check("VOLS: the heatmap view", drawn("#gex-body .gx-3d canvas") > 5000)
        gk = opt_body("GRK", "table")
        check("GRK: the greeks table", "Strike" in gk and r.locator("#gex-body table tbody tr").count() >= 10 and r.locator("#gex-body tr.me").count() == 1, gk[:200])
        r.click("#gex-body .chipbtn:has-text('3D')")
        check("GRK: 3D", drawn("#gex-body .gx-3d canvas") > 3000)
        h = opt_body("GEXH", ".gx-imap canvas")
        check("GEXH: interval map and daily history", drawn("#gex-body .gx-imap canvas") > 5000 and r.locator("#gex-body .gx-small canvas, #gex-body .gx-two canvas").count() >= 2, h[:200])
        shot(r, "22_gexh")
        b = opt_body("GEX BTC", ".gx-cv canvas")
        check("GEX: bitcoin from Deribit", "Deribit" in r.inner_text("#gex-sub") and "Call wall: 65,000" in b, b[:300])
        vb = opt_body("VOLS BTC", ".gx-3d canvas")
        check("VOLS: bitcoin with DVOL", "DVOL" in vb and r.locator("#gex-body canvas").count() >= 4, vb[:200])
        nb = opt_body("GEX TSLA", ".empty")
        check("GEX: a ticker without data says so", "No option data for TSLA yet" in nb, nb[:200])
        r.click("#b-lang")
        r.click("#lang-menu button[lang=ru]")
        r.wait_for_function("(document.querySelector('#b-lang') || {}).textContent === 'RU ▾' && !!document.querySelector('#mkt table')", timeout=8000)
        rg = opt_body("GEX SPX", ".gx-cv canvas")
        check("RU: GEX in Russian", "Смена гаммы" in rg and "ГАММА-ЭКСПОЗИЦИЯ" in r.inner_text("#p-gex .ph"), rg[:200])
        r.click("#b-lang")
        r.click("#lang-menu button[lang=en]")
        r.wait_for_function("(document.querySelector('#b-lang') || {}).textContent === 'EN ▾' && !!document.querySelector('#mkt table')", timeout=8000)

        fctx = browser.new_context(viewport={"width": 1440, "height": 900})
        setup(fctx)
        setup_binance(fctx)
        f = fctx.new_page()
        watch(f)
        f.goto(base)
        f.wait_for_selector("#mkt table")

        def fdrawn():
            return f.evaluate("(function(){ var c = document.querySelector('#flow-body .fl-cv canvas'); if (!c) return 0; var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, n = 0; for (var i = 3; i < d.length; i += 4) if (d[i]) n++; return n })()")
        f.fill("#cmd", "HEAT BTC"); f.press("#cmd", "Enter")
        f.wait_for_function("window.FLOWX && FLOWX.market() && FLOWX.market().synced && FLOWX.market().cols.length >= 3", timeout=12000)
        f.wait_for_timeout(600)
        mkt_ = f.evaluate("(function(){ var m = FLOWX.market(), bb = -1e9, ba = 1e9; m.bids.forEach(function(_, p){ if (p > bb) bb = p }); m.asks.forEach(function(_, p){ if (p < ba) ba = p }); return {bb: bb, ba: ba, n: m.bids.size, tr: m.trades.length} })()")
        check("HEAT: the order book is kept in sync (snapshot + diffs, never crossed)", mkt_["n"] > 900 and mkt_["bb"] < mkt_["ba"] and mkt_["tr"] > 100, mkt_)
        check("HEAT: the heatmap draws", fdrawn() > 50000)
        shot(f, "23_heat")
        def hz():
            return f.evaluate("JSON.stringify(FLOWX.state.z.HEAT)")
        cvb = f.locator("#flow-body .fl-cv").bounding_box()
        f.mouse.move(cvb["x"] + cvb["width"] / 2, cvb["y"] + cvb["height"] / 2)
        z0 = f.evaluate("FLOWX.state.z.HEAT.p")
        for _ in range(3):
            f.mouse.wheel(0, -120); f.wait_for_timeout(60)
        z1 = f.evaluate("FLOWX.state.z.HEAT.p")
        check("HEAT: the wheel zooms into the price", z1 > z0 * 1.5, (z0, z1))
        check("HEAT: zoomed in, the heatmap still draws", fdrawn() > 50000)
        f.keyboard.down("Shift"); f.mouse.wheel(0, -120); f.keyboard.up("Shift"); f.wait_for_timeout(60)
        check("HEAT: Shift+wheel stretches the time", f.evaluate("FLOWX.state.z.HEAT.t") > 1, hz())
        f.click("#flow-body .chipbtn.zb:has-text('−')")
        check("HEAT: the − button zooms out", f.evaluate("FLOWX.state.z.HEAT.p") < z1, hz())
        f.mouse.dblclick(cvb["x"] + cvb["width"] / 2, cvb["y"] + cvb["height"] / 2)
        check("HEAT: a double-click resets the zoom", f.evaluate("FLOWX.state.z.HEAT.p === 1 && FLOWX.state.z.HEAT.t === 1"), hz())
        sharp = f.evaluate("""(function(){
          FLOWX.state.z.HEAT.p = 12; FLOWX.state.z.HEAT.t = 8;   // zoomed in: a price step and a half-second are many pixels
          var w = document.querySelector('#flow-body .fl-cv'); w.__paint();
          var dpr = window.devicePixelRatio || 1, c = w.querySelector('canvas'), g = c.getContext('2d'), x = Math.floor(c.width - (160 + 30) * dpr);
          var d = g.getImageData(x, 0, 1, c.height).data, rows = 0, edges = 0;
          for (var y = 1; y < c.height; y++) { var a = (y - 1) * 4, b = y * 4; if (d[a] !== d[b] || d[a + 1] !== d[b + 1] || d[a + 2] !== d[b + 2]) edges++; rows++ }
          return {edges: edges, rows: rows};
        })()""")
        check("HEAT: zoomed in, price cells are several pixels tall (not a smear of 1-pixel rows)", 0 < sharp["edges"] < sharp["rows"] / 4, sharp)
        unk = f.evaluate("(function(){ var m = FLOWX.market(); return m && isFinite(m.lo) && isFinite(m.hi) && m.lo < m.hi })()")
        check("HEAT: the book's known range comes from the 5000-level snapshot", unk)
        shot(f, "23b_heat_zoom")
        f.evaluate("FLOWX.state.z.HEAT.p = 1; FLOWX.state.z.HEAT.t = 1")
        f.fill("#cmd", "BOOK BTC"); f.press("#cmd", "Enter"); f.wait_for_timeout(800)
        check("BOOK: the ladder and the tape draw", fdrawn() > 20000 and "DOM & TAPE" in f.inner_text("#p-flow .ph"))
        f.fill("#cmd", "FOOT BTC"); f.press("#cmd", "Enter"); f.wait_for_timeout(800)
        check("FOOT: footprint candles draw", fdrawn() > 20000)
        shot(f, "24_foot")
        f.click("#flow-body .chipbtn.zb:has-text('＋')"); f.click("#flow-body .chipbtn.zb:has-text('＋')")
        check("FOOT: ＋ shows finer price levels", f.evaluate("FLOWX.state.z.FOOT.p") == 4 and fdrawn() > 20000, f.evaluate("JSON.stringify(FLOWX.state.z.FOOT)"))
        shot(f, "24b_foot_zoom")
        f.click("#flow-body .chipbtn.zb:has-text('⟲')")
        check("FOOT: ⟲ resets", f.evaluate("FLOWX.state.z.FOOT.p") == 2)
        f.fill("#cmd", "CVD BTC"); f.press("#cmd", "Enter")
        f.wait_for_function("FLOWX.market() && FLOWX.market().kl && FLOWX.market().kl.bars.length >= 400", timeout=8000)
        f.wait_for_timeout(600)
        check("CVD: price, cumulative delta and bar delta draw", fdrawn() > 20000)
        shot(f, "25_cvd")
        cvb = f.locator("#flow-body .fl-cv").bounding_box()
        f.mouse.move(cvb["x"] + cvb["width"] / 2, cvb["y"] + cvb["height"] / 3)
        n0 = f.evaluate("FLOWX.state.z.CVD.n")
        f.mouse.wheel(0, -120); f.mouse.wheel(0, -120); f.wait_for_timeout(60)
        n1 = f.evaluate("FLOWX.state.z.CVD.n")
        check("CVD: the wheel shows fewer, wider bars", 15 <= n1 < n0, (n0, n1))
        f.mouse.down(); f.mouse.move(cvb["x"] + cvb["width"] / 2 + 200, cvb["y"] + cvb["height"] / 3, steps=5); f.mouse.up()
        off = f.evaluate("FLOWX.state.z.CVD.off")
        check("CVD: dragging scrolls back in time", off > 10, off)
        check("CVD: scrolled back, it still draws", fdrawn() > 20000)
        shot(f, "25b_cvd_zoom")
        f.mouse.dblclick(cvb["x"] + cvb["width"] / 2, cvb["y"] + cvb["height"] / 3)
        check("CVD: a double-click goes back to now", f.evaluate("FLOWX.state.z.CVD.off") == 0)
        kl_calls = []

        def kl_fail(route):
            kl_calls.append(route.request.url)
            route.fulfill(status=500, content_type="application/json", body="{}", headers={"Access-Control-Allow-Origin": "*"})
        f.route("**/api/v3/klines*", kl_fail)
        f.click("#flow-body button:has-text('1h')")
        f.wait_for_timeout(3000)
        check("CVD: a failed request for the bars is not repeated four times a second", 1 <= len(kl_calls) <= 3, len(kl_calls))
        f.unroute("**/api/v3/klines*")
        f.fill("#cmd", "HEAT"); f.press("#cmd", "Enter")
        f.wait_for_function("!document.getElementById('p-imap').classList.contains('off')", timeout=5000)
        check("HEAT alone still opens the market map", True)
        f.fill("#cmd", "MOV"); f.press("#cmd", "Enter")
        f.wait_for_function("document.getElementById('p-flow').classList.contains('off')", timeout=5000)
        f.wait_for_function("!window.FLOWX.market()", timeout=8000)
        check("the streams close when the order-flow panel leaves the screen", f.evaluate("!FLOWX.market()"))
        f.fill("#cmd", "SPLC"); f.press("#cmd", "Enter")
        f.wait_for_selector("#map-body .sp-wrap canvas")
        sp = f.inner_text("#map-body")
        check("SPLC: the oil supply chain with EIA flows", "Hormuz" in sp and "3Q26 9.1" in sp and "Cape of Good Hope" in sp, sp[:300])
        check("SPLC: without the bot's file, the figures built into the page", "EIA 3Q26 (10 Nov 2026)" in f.inner_text("#map-sub"), f.inner_text("#map-sub"))
        shot(f, "26_splc")
        qs = ["1Q25", "2Q25", "3Q25", "4Q25", "1Q26", "2Q26", "3Q26", "4Q26"]
        newer = {"q": qs, "released": "2027-01-13", "v": {k: [round(2 + i * 0.5 + j / 10, 1) for j in range(len(qs))] for i, k in enumerate(
            ("malacca", "hormuz", "suez", "bab", "danish", "turkish", "panama", "cape"))}}
        newer["v"]["hormuz"] = [20.9, 21.1, 21.4, 21.6, 15.0, 5.1, 9.1, 11.2]
        fx["chokepoints.json"] = json.dumps(newer).encode()
        f.click("#map-tabs button[data-t=SHIP]")
        f.wait_for_selector("#map-body .gm-wrap canvas:not(.gm-bg)")
        f.click("#map-tabs button[data-t=SPLC]")
        f.wait_for_function("document.getElementById('map-sub').textContent.includes('4Q26')", timeout=8000)
        sp = f.inner_text("#map-body")
        check("SPLC: the figures the bot read from EIA replace the built-in ones", "4Q26 11.2" in sp and "13 Jan 2027" in f.inner_text("#map-sub"), sp[:300])
        f.click("#map-tabs button[data-t=SHIP]")
        f.wait_for_selector("#map-body .gm-wrap canvas:not(.gm-bg)")
        f.wait_for_function("document.querySelector('#map-body .gm-side') && document.querySelector('#map-body .gm-side').textContent.includes('Tankers at the chokepoints')", timeout=8000)
        f.wait_for_function("window.MAPS && MAPS.M.data.tankers && MAPS.M.data.tankers.pts.length === 2", timeout=8000)
        check("SHIP: the map comes back after SPLC, with the tankers layer", f.locator("#map-body .gm-wrap canvas:not(.gm-bg)").count() == 1)
        check("MAP: the satellite picture lies under the map", f.locator("#map-body .gm-wrap canvas.gm-bg").count() == 1 and f.evaluate("MAPS.M.base") in ("sat", "day", "night", "scheme"))
        f.click("#map-body .gm-base button[data-b=scheme]")
        f.wait_for_function("getComputedStyle(document.querySelector('#map-body .gm-bg')).display === 'none'", timeout=3000)
        check("MAP: the scheme switch hides the picture and is remembered", f.evaluate("getComputedStyle(document.querySelector('#map-body .gm-bg')).display") == "none" and f.evaluate("localStorage.getItem('map_base')") == "scheme")
        f.click("#map-body .gm-base button[data-b=sat]")
        f.wait_for_function("MAPS.M.base === 'sat'", timeout=3000)
        check("MAP: back to the satellite picture", f.evaluate("localStorage.getItem('map_base')") == "sat")
        f.wait_for_function("""(function(){ var c = document.querySelector('#map-body .gm-bg'); if (!c || getComputedStyle(c).display === 'none') return false;
          var d = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data; return d[2] > 40 })()""", timeout=8000)
        check("MAP: the satellite picture comes from the site's own copy of the tiles", True)
        f.wait_for_function("window.MAPS && MAPS.M.data.choke && MAPS.M.data.choke.pts.length === 5", timeout=8000)
        side = f.inner_text("#map-body .gm-side")
        check("SHIP: chokepoints from the bot's copy of PortWatch", "Malacca Strait" in side and "Token" not in side, side[:200])
        f.wait_for_function("window.MAPS && MAPS.M.data.world && MAPS.M.data.world.pts.length === 3", timeout=8000)
        wp = f.evaluate("MAPS.M.data.world.pts.map(function(p){ return {t: p.t, hd: p.hd, trk: (p.trk || []).length, pf: !!p.pf, s: p.s.join(' | ')} })")
        check("SHIP: ships worldwide, tankers first, with their tracks", wp[0]["t"].startswith("🛢 GULF STAR") and wp[0]["trk"] == 2 and wp[0]["hd"] == 45 and wp[0]["pf"], wp[:2])
        check("SHIP: a ship at anchor has no arrow and no line ahead", [p for p in wp if "onerror" in p["t"]][0]["hd"] is None)
        check("SHIP: the course and the track are explained in the card", "course 45°" in wp[0]["s"] and "dashes" in wp[0]["s"], wp[0]["s"])
        check("SHIP: the worldwide block in the side panel", "SHIPS · WORLD" in f.inner_text("#map-body .gm-side"))
        f.evaluate("MAPS.flyTo(-89.5, 26.2, 40)")
        f.wait_for_timeout(300)
        shot(f, "27_ships_world")
        injected = f.evaluate("!!document.querySelector('#map-body img[src=x], body > img[src=x]') || !!window.__xss")
        check("SHIP: a ship's name is shown as text, never as HTML", not injected)
        f.fill("#cmd", "SAT"); f.press("#cmd", "Enter")
        f.wait_for_selector("#map-body .sat-card")
        cards = f.locator("#map-body .sat-card").count()
        check("SAT: a card per hub (one without a picture yet)", cards == 2 and f.locator("#map-body .sat-card.none").count() == 1, cards)
        f.wait_for_function("document.querySelector('#map-body .sat-card img') && document.querySelector('#map-body .sat-card img').naturalWidth > 0", timeout=8000)
        shot(f, "28_sat_gallery")
        f.click("#map-body .sat-card:not(.none)")
        f.wait_for_selector("#map-body .sat-stage .sat-handle")
        check("SAT: the hub opens with then and now", "then ·" in f.inner_text("#map-body .sat-stage") and "now ·" in f.inner_text("#map-body .sat-stage"))
        st = f.locator("#map-body .sat-stage").bounding_box()
        im0 = f.locator("#map-body .sat-inner").bounding_box()
        check("SAT: the pictures keep their square shape inside the window (no stretching)", abs(im0["width"] - im0["height"]) < 1.5
              and abs(min(st["width"], st["height"]) - im0["width"]) < 4 and im0["x"] >= st["x"] - 1 and im0["y"] >= st["y"] - 1, (st, im0))
        f.mouse.click(im0["x"] + im0["width"] * 0.25, im0["y"] + im0["height"] * 0.5)
        clip = f.evaluate("document.querySelector('#map-body .sat-b').style.clipPath")
        check("SAT: clicking moves the cut between the pictures", "inset(0px 0px 0px 25" in clip or "inset(0 0 0 25" in clip, clip)
        f.click("#map-body .sat-z button:has-text('＋')")
        inner_w = "document.querySelector('#map-body .sat-inner').getBoundingClientRect().width"
        tr = f.evaluate("(function(){ var i = document.querySelector('#map-body .sat-inner'); return {k: i.getBoundingClientRect().width / %s, t: i.style.transform} })()" % im0["width"])
        check("SAT: ＋ zooms in by laying the pictures out bigger (sharp, not a stretched bitmap)", abs(tr["k"] - 1.4) < 0.02 and not tr["t"], tr)
        f.mouse.dblclick(st["x"] + st["width"] * 0.5, st["y"] + st["height"] * 0.6)
        check("SAT: a double-click resets the zoom", abs(f.evaluate(inner_w) - im0["width"]) < 1.5, f.evaluate(inner_w))
        shot(f, "29_sat_hub")
        f.click("#map-body .sat-bar button")
        f.wait_for_selector("#map-body .sat-grid")
        check("SAT: back to all hubs", f.locator("#map-body .sat-card").count() == 2)
        f.click("#map-tabs button[data-t=SHIP]")
        f.wait_for_selector("#map-body .gm-wrap canvas:not(.gm-bg)")
        f.fill("#cmd", "PAPR"); f.press("#cmd", "Enter")
        f.wait_for_selector("#my-body .stat")
        f.fill("#my-body input.t", "AAPL"); f.fill("#my-body input[data-k=paper-a]", "$3429.6")
        f.click("#my-body button[type=submit]")
        f.wait_for_function("document.querySelector('#my-body tbody tr') && document.querySelector('#my-body').textContent.includes('AAPL')", timeout=8000)
        pp = f.evaluate("JSON.parse(localStorage.getItem('my_paper'))")
        check("PAPR: a practice buy at the last price", abs(pp["pos"]["AAPL"]["q"] - 10) < 1e-6 and abs(pp["cash"] - (100000 - 3429.6)) < 0.01, pp)
        f.fill("#my-body input.t", "AAPL"); f.fill("#my-body input[data-k=paper-a]", "50")
        f.click("#my-body button:has-text('SELL')")
        f.wait_for_selector("#my-body .err")
        check("PAPR: no selling what is not held", "do not hold that many" in f.inner_text("#my-body .err"))
        f.fill("#my-body input.t", "S&P"); f.fill("#my-body input[data-k=paper-a]", "1")
        f.click("#my-body button[type=submit]")
        f.wait_for_function("(document.querySelector('#my-body .err') || {}).textContent && document.querySelector('#my-body .err').textContent.includes('US dollars')", timeout=8000)
        pp2 = f.evaluate("JSON.parse(localStorage.getItem('my_paper'))")
        check("PAPR: an index or currency pair is not bought as if priced in dollars", list(pp2["pos"]) == ["AAPL"], pp2)
        check("the quick bar lists the functions", f.locator("#fbar button").count() >= 15 and "GEX" in f.inner_text("#fbar"))
        f.keyboard.press("Alt+6")
        f.wait_for_function("!document.getElementById('p-gex').classList.contains('off')", timeout=5000)
        check("Alt+6 opens GEX", True)
        fctx.close()

        mp = rctx.new_page()
        watch(mp)
        mp.goto(f"http://127.0.0.1:{sport}/")
        mp.wait_for_selector("#tiles .tile .n")
        check("Markets page: English", "Gold" in mp.inner_text("#tiles") and mp.inner_text("#h1") == "Markets", mp.inner_text("#tiles")[:200])
        mp.select_option("#lang", "ru")
        mp.wait_for_function("(document.querySelector('#h1') || {}).textContent === 'Рынок онлайн'", timeout=8000)
        mp.wait_for_selector("#tiles .tile .n")
        check("Markets page: Russian after the toggle", "Золото" in mp.inner_text("#tiles"))
        mp.click("button[data-tab=news]")
        check("Markets page: Russian news", "ФРС сохранила ставку" in mp.inner_text("#news"))
        rctx.close()

        for lang, want in (("zh", {"panel": "全球市场", "mkt": ["黄金", "布伦特原油", "指数"], "news": ["来自服务器的最新消息", "美联储维持利率不变", "美联储将利率维持不变", "#美联储"],
                                   "des": ["$5.01万亿", "分析师", "下次财报"], "cn": "苹果业绩超出预期", "ee": ["本季度", "业绩意外"], "ecst": ["实际 GDP 增长", "俄罗斯"],
                                   "sector": "能源", "eco": "日历 · 莫斯科时间", "help": "全球股票指数", "btn": "中 ▾",
                                   "gex": ["伽马敞口", "伽马翻转点", "按行权价的伽马敞口"]}),
                           ("ar", {"panel": "الأسواق العالمية", "mkt": ["الذهب", "خام برنت", "المؤشرات"], "news": ["خبر جديد من الخادم", "الفيدرالي يثبت أسعار الفائدة", "أبقى الفيدرالي", "#الفيدرالي"],
                                   "des": ["$5.01 تريليون", "المحللون", "النتائج التالية"], "cn": "أبل تتجاوز التوقعات", "ee": ["الربع الحالي", "المفاجآت"], "ecst": ["نمو الناتج الحقيقي", "روسيا"],
                                   "sector": "الطاقة", "eco": "الأجندة · بتوقيت موسكو", "help": "مؤشرات الأسهم العالمية", "btn": "ع ▾",
                                   "gex": ["تعرض غاما", "نقطة انقلاب غاما", "تعرض غاما حسب سعر التنفيذ"]})):
            xctx = browser.new_context(viewport={"width": 1440, "height": 900})
            setup(xctx)
            x = xctx.new_page()
            watch(x)
            x.goto(base + "?lang=" + lang)
            x.wait_for_selector("#mkt table")
            check(f"{lang}: interface, html lang and the dictionary", want["panel"] in x.inner_text("#p-mkt .ph") and x.inner_text("#b-lang") == want["btn"]
                  and x.evaluate("document.documentElement.lang") == lang and x.evaluate("Object.keys(window.L10N_XL.D).length") > 900
                  and want["eco"] in x.inner_text("#p-eco .ph"), x.inner_text("#p-mkt .ph"))
            x.wait_for_function(f"document.querySelector('#mkt').textContent.includes({json.dumps(want['mkt'][0])})", timeout=8000)
            xm = x.inner_text("#mkt")
            check(f"{lang}: instrument names and Latin digits", all(w in xm for w in want["mkt"]) and "7,730" in xm, xm[:300])
            x.wait_for_function(f"document.querySelector('#news').textContent.includes({json.dumps(want['news'][0])})", timeout=8000)
            xn = x.inner_text("#news")
            check(f"{lang}: news translated, the summary in place of a missing AI note, tags", all(w in xn for w in want["news"]), xn[:400])
            shot(x, f"20_{lang}_main")
            cmd(x, "AAPL DES")
            x.wait_for_function("document.querySelector('#des-body').textContent.includes('Apple Inc')", timeout=8000)
            xb = x.inner_text("#des-body")
            check(f"{lang}: DES (big numbers in the language's units)", all(w in xb for w in want["des"]), xb[:400])
            shot(x, f"21_{lang}_des")
            x.click("#des-tabs button[data-t=CN]")
            x.wait_for_function(f"document.querySelector('#des-body').textContent.includes({json.dumps(want['cn'])})", timeout=8000)
            check(f"{lang}: CN translated by the server", True)
            x.click("#des-tabs button[data-t=EE]")
            check(f"{lang}: EE", all(w in x.inner_text("#des-body") for w in want["ee"]), x.inner_text("#des-body")[:300])
            cmd(x, "ECST RU")
            x.wait_for_function(f"document.querySelector('#ana-body').textContent.includes({json.dumps(want['ecst'][0])})", timeout=8000)
            check(f"{lang}: ECST: the IMF indicators and the country from the browser", want["ecst"][1] in x.inner_text("#ana-body"), x.inner_text("#ana-body")[:300])
            cmd(x, "EQS")
            x.wait_for_selector("#eqs-body tbody tr")
            x.select_option("#eqs-body select", want["sector"])
            x.wait_for_function("document.querySelectorAll('#eqs-body tbody tr').length === 1")
            check(f"{lang}: sectors", "XOM" in x.inner_text("#eqs-body tbody"))
            cmd(x, "HELP")
            x.wait_for_selector("#help-t tr")
            check(f"{lang}: the help table", want["help"] in x.inner_text("#help-t"))
            check(f"{lang}: the help table has the options functions", want["gex"][2] in x.inner_text("#help-t"))
            shot(x, f"22_{lang}_help")
            x.keyboard.press("Escape")
            cmd(x, "GEX SPX")
            x.wait_for_selector("#gex-body .gx-cv canvas", timeout=8000)
            xg = x.inner_text("#gex-body")
            check(f"{lang}: GEX in the reader's language", want["gex"][0] in x.inner_text("#p-gex .ph") and want["gex"][1] in xg, xg[:300])
            shot(x, f"23_{lang}_gex")
            x.keyboard.press("Escape")
            if lang == "ar":
                check("ar: Arabic letters are not spread apart", x.evaluate("getComputedStyle(document.querySelector('#p-mkt .ph')).letterSpacing") in ("0px", "normal"))
                check("ar: news lines take their direction from the text", x.evaluate("getComputedStyle(document.querySelector('#news li')).unicodeBidi") == "plaintext")
            overflow = x.evaluate("document.documentElement.scrollWidth - window.innerWidth")
            check(f"{lang}: no horizontal scroll", overflow <= 0, overflow)
            mp2 = xctx.new_page()
            watch(mp2)
            mp2.goto(f"http://127.0.0.1:{sport}/")
            mp2.wait_for_selector("#tiles .tile .n")
            check(f"{lang}: the Markets page in the same language", mp2.input_value("#lang") == lang and mp2.inner_text("#h1") == {"zh": "市场", "ar": "الأسواق"}[lang]
                  and want["mkt"][0] in mp2.inner_text("#tiles"), mp2.inner_text("#tiles")[:200])
            shot(mp2, f"23_{lang}_markets")
            xctx.close()

        wctx = browser.new_context(viewport={"width": 1440, "height": 900})
        setup(wctx)
        w = wctx.new_page()
        watch(w)
        w.goto(base)
        w.wait_for_selector("#mkt table")
        slot = lambda pid: w.eval_on_selector("#" + pid, "p => p.dataset.slot || ''")
        check("windows: every panel has ✕ and the layout has borders to drag",
              w.locator("main > .panel .ph .pclose").count() >= 18 and w.locator("main > .gutter.v").count() >= 2 and w.locator("main > .gutter.h").count() >= 1)
        news_slot = slot("p-news")
        w.click("#p-news .pclose")
        check("windows: ✕ closes one, an empty window takes its place", "p-news" not in visible_panels(w)
              and w.locator(".slot-empty").count() == 1 and w.eval_on_selector(".slot-empty", "d => d.dataset.slot") == news_slot)
        w.click(".slot-empty .add")
        w.wait_for_selector("#fnmenu button")
        names = w.eval_on_selector_all("#fnmenu button b", "bs => bs.map(b => b.textContent)")
        check("windows: the menu offers every function, not just panels", all(c in names for c in ("LVL", "FOOT", "PAPR", "TRD", "SPLC")), names[:12])
        w.click("#fnmenu button:has(b:text-is('TRD'))")
        w.wait_for_function("!document.querySelector('#p-trd').classList.contains('off')")
        check("windows: the chosen function opens in that window", slot("p-trd") == news_slot and w.locator(".slot-empty").count() == 0)
        before = w.eval_on_selector("#p-mkt", "p => p.getBoundingClientRect().width")
        g = w.locator("main > .gutter.v").first.bounding_box()
        w.mouse.move(g["x"] + g["width"] / 2, g["y"] + 40)
        w.mouse.down()
        w.mouse.move(g["x"] + g["width"] / 2 + 60, g["y"] + 40, steps=4)
        w.mouse.move(g["x"] + g["width"] / 2 + 120, g["y"] + 40, steps=4)
        w.mouse.up()
        after = w.eval_on_selector("#p-mkt", "p => p.getBoundingClientRect().width")
        saved = w.evaluate("JSON.parse(localStorage.getItem('layout2')).size['1']")
        check("windows: dragging a border resizes the panels and is remembered", 100 < after - before < 140 and saved and len(saved["cols"]) == 3, (before, after, saved))
        w.reload()
        w.wait_for_selector("#mkt table")
        check("windows: the sizes survive a reload", abs(w.eval_on_selector("#p-mkt", "p => p.getBoundingClientRect().width") - after) < 3)
        w.locator("main > .gutter.v").first.dblclick()
        check("windows: double-click on a border brings the layout's own sizes back",
              abs(w.eval_on_selector("#p-mkt", "p => p.getBoundingClientRect().width") - before) < 3 and not w.evaluate("JSON.parse(localStorage.getItem('layout2')).size['1']"))
        mkt_slot, chart_slot = slot("p-mkt"), slot("p-chart")
        t1 = w.locator("#p-mkt .ph [data-i18n=p_mkt]").bounding_box()
        t2 = w.locator("#p-chart .ph").bounding_box()
        w.mouse.move(t1["x"] + 10, t1["y"] + t1["height"] / 2)
        w.mouse.down()
        w.mouse.move(t1["x"] + 60, t1["y"] + 60, steps=5)
        w.mouse.move(t2["x"] + t2["width"] / 2, t2["y"] + 80, steps=8)
        w.mouse.up()
        check("windows: dragging a title onto another window swaps them", slot("p-mkt") == chart_slot and slot("p-chart") == mkt_slot)
        shot(w, "28_windows")
        w.click("#lay button[data-act=close]")
        check("windows: ✕ at the top closes all", visible_panels(w) == [] and w.locator(".slot-empty").count() == 5 and w.locator(".slot-empty .reset").count() == 5)
        cmd(w, "N")
        w.wait_for_function("!document.querySelector('#p-news').classList.contains('off')")
        check("windows: a command opens in an empty window", visible_panels(w) == ["p-news"] and w.locator(".slot-empty").count() == 4)
        shot(w, "29_windows_empty")
        w.click("#lay button[data-act=reset]")
        check("windows: ⟲ brings the default layout back", sorted(visible_panels(w)) == sorted(["p-mkt", "p-chart", "p-crypto", "p-news", "p-eco"]) and w.locator(".slot-empty").count() == 0)
        news_slot = slot("p-news")
        w.click("#p-news .ph .pfloat")
        fl = w.evaluate("(function(){ var p = document.getElementById('p-news'), r = p.getBoundingClientRect(); return {cls: p.className, pos: getComputedStyle(p).position, x: r.left, y: r.top, w: r.width, h: r.height, slot: p.dataset.slot || null} })()")
        check("float: ⧉ lifts the window over the grid", "floating" in fl["cls"] and fl["pos"] == "absolute" and fl["slot"] is None and w.locator(".slot-empty").count() == 1, fl)
        t = w.locator("#p-news .ph").bounding_box()
        w.mouse.move(t["x"] + 60, t["y"] + t["height"] / 2); w.mouse.down(); w.mouse.move(t["x"] + 160, t["y"] + 90, steps=6); w.mouse.up()
        moved = w.eval_on_selector("#p-news", "p => { var r = p.getBoundingClientRect(); return [r.left, r.top] }")
        mr = w.eval_on_selector("main", "m => { var r = m.getBoundingClientRect(); return [r.left, r.top, r.width, r.height] }")
        want = [min(fl["x"] + 100, mr[0] + mr[2] - fl["w"]), min(fl["y"] + 90 - t["height"] / 2, mr[1] + mr[3] - fl["h"])]
        check("float: dragging the title moves it (and keeps it on the page)", abs(moved[0] - want[0]) < 4 and abs(moved[1] - want[1]) < 6, (fl, moved, want))
        inside = w.evaluate("(function(){ var p = document.getElementById('p-news').getBoundingClientRect(), m = document.querySelector('main').getBoundingClientRect(); return p.left >= m.left - 1 && p.top >= m.top - 1 && p.right <= m.right + 1 && p.bottom <= m.bottom + 1 })()")
        check("float: the window stays wholly on the page", inside)
        t = w.locator("#p-news .ph").bounding_box()
        w.mouse.move(t["x"] + 60, t["y"] + t["height"] / 2); w.mouse.down(); w.mouse.move(t["x"] - 300, t["y"] - 500, steps=6); w.mouse.up()
        c = w.locator("#p-news .fresize").bounding_box()
        hit = w.evaluate("(function(x, y){ var n = document.elementFromPoint(x, y); return n ? n.tagName + '.' + n.className + '#' + n.id : '' })(%f, %f)" % (c["x"] + 8, c["y"] + 8))
        w.mouse.move(c["x"] + 8, c["y"] + 8); w.mouse.down(); w.mouse.move(c["x"] + 88, c["y"] + 48, steps=6); w.mouse.up()
        sz = w.eval_on_selector("#p-news", "p => { var r = p.getBoundingClientRect(); return [r.width, r.height] }")
        check("float: the corner sizes it", abs(sz[0] - fl["w"] - 80) < 4 and abs(sz[1] - fl["h"] - 40) < 4, (fl, sz, c, hit))
        w.click("#p-eco .ph .pfloat")
        z1, z2 = w.evaluate("[+document.getElementById('p-news').style.zIndex, +document.getElementById('p-eco').style.zIndex]")
        check("float: the newest window lies on top", z2 > z1, (z1, z2))
        w.click("#p-news .ph [data-i18n]", position={"x": 5, "y": 5})
        z1b = w.evaluate("+document.getElementById('p-news').style.zIndex")
        check("float: a click brings a window to the front", z1b > z2, (z1b, z2))
        shot(w, "30_floating")
        w.reload()
        w.wait_for_selector("#mkt table")
        kept = w.evaluate("(function(){ var p = document.getElementById('p-news'), r = p.getBoundingClientRect(); return p.classList.contains('floating') && Math.abs(r.width - %f) < 4 })()" % sz[0])
        check("float: floating windows survive a reload", kept)
        w.click("#p-news .ph .pfloat")
        check("float: ▣ puts it back into the grid", slot("p-news") == news_slot and "floating" not in w.eval_on_selector("#p-news", "p => p.className"), slot("p-news"))
        w.click("#lay button[data-act=reset]")
        check("float: ⟲ docks every window", w.locator(".panel.floating").count() == 0 and w.locator(".slot-empty").count() == 0)
        wctx.close()

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
        m.click("#des-tabs button[data-t=OMON]")
        m.wait_for_selector("#des-body table.chain")
        ov2 = m.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check("phone: the option chain scrolls inside its panel", ov2 <= 0, ov2)
        m.click("#b-more")
        m.click("#fnlist button:has-text('World economies')")
        m.wait_for_function("document.querySelector('#ana-body').textContent.includes('United States')", timeout=8000)
        check("phone: functions menu → ECST", visible_panels(m) == ["p-ana"], visible_panels(m))
        shot(m, "14b_mobile_ecst")
        m.click("#b-more")
        m.click("#fnlist button:has-text('Yield curves')")
        m.wait_for_selector("#gc-body svg path")
        shot(m, "15_mobile_gc")
        ov = m.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check("phone: no horizontal page scroll", ov <= 0, ov)
        m.fill("#cmd", "GEX SPX"); m.press("#cmd", "Enter")
        m.wait_for_selector("#gex-body .gx-cv canvas")
        check("phone: GEX in one panel", visible_panels(m) == ["p-gex"], visible_panels(m))
        shot(m, "27_mobile_gex")
        ov3 = m.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check("phone: GEX has no horizontal page scroll", ov3 <= 0, ov3)
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
