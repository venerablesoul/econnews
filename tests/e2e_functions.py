"""
End-to-end test of the newer terminal functions in a real browser (Chromium via Playwright):
technical analysis (TECH, TA, IND, GPO, VAP, TSM, QR, TRA, TRAY), company tabs (GE, CACS, CRPR), monitors (MOV, MOST, MRR, MEMB,
WPE, BI, FPC, CDR), the rates panel (WB, BTMM, MMR, SRCH), news topics (NSE, TOPCA, MA, RATC) and the maps (MAP, STORM, SHIP, WETR, MAP ECO).
The site and the bot server run locally (tests/fake_server.mjs); the map sources answer from tests/geo_fixtures.mjs —
the sources with browser access straight, the others (Treasury, holidays) through the server's /api/geo.
Run: python3 tests/e2e_functions.py   (screenshots go to the E2E_SHOTS folder, if set)
"""
import json
import os
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import e2e_terminal as E  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

DIRECT = ("earthquake.usgs.gov", "eonet.gsfc.nasa.gov", "www.gdacs.org", "services9.arcgis.com", "api.open-meteo.com", "meri.digitraffic.fi")
VIA_SERVER = ("date.nager.at",)   # the test blocks them in the browser: the terminal must use /api/geo
TRADES = [{"id": 1000 + i, "price": str(81000 + i), "qty": str(round(0.01 * (i + 1), 2)), "quoteQty": "810", "time": 1792000000000 + i * 1000,
           "isBuyerMaker": i % 3 == 0} for i in range(20)]
check = E.check
# the Bloomberg functions in the two lists the owner sent (alerts, ALRT, already existed)
CODES_CFI = """N TOP TOPCA NSE CNS USS MNA OPN COS BBEA WEI WPE ECO ECST MOV MA WFX FXC RATC BTMM USSW FIT WB CDR MMR SRCH CRVF PICK
BI MOST FPC ECDR PDF DES MGMT CN ISSD RELS FA DVD ERN EE GE EM ANR PHDC CRPR CACS CF GIP QR BQ BAS AQR VAP TSM OMON
RV COMP TRA GP GPO HP SI G TRAY MRR MEMB""".split()
CODES_FORMARSE = "G TA IND CORR FUND ALRT".split()


def shot(page, name):
    if E.SHOTS:
        os.makedirs(E.SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(E.SHOTS, name + ".png"))


def visible_panels(page):
    return page.eval_on_selector_all("main > .panel", "ps => ps.filter(p => getComputedStyle(p).display !== 'none').map(p => p.id)")


def run():
    static, sport = E.start_static()
    proc, wport = E.start_fake_worker()
    api = f"http://127.0.0.1:{wport}"
    fx = {n: urllib.request.urlopen(f"{api}/__fx/{n}").read() for n in ("data.json", "stocks.json", "rates.json", "macro.json", "moex.json", "options.json", "wpe.json", "auctions.json")}
    base = f"http://127.0.0.1:{sport}/terminal/"
    errors = []
    geo_calls = []

    def setup(ctx):
        def handle(route):
            url = route.request.url
            u = urllib.parse.urlparse(url)
            if "/api/v3/trades" in url:
                # binance.com closed (as from the US): the terminal turns to Binance's market-data mirror; no feed at all for ETH
                if u.netloc == "api.binance.com" or "ETHUSDT" in url:
                    return route.abort()
                return route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(TRADES))
            if u.netloc in DIRECT:
                geo_calls.append(u.netloc)
                body = urllib.request.urlopen(f"{api}/__geo?u=" + urllib.parse.quote(url, safe="")).read()
                return route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=body)
            if u.netloc in VIA_SERVER:
                return route.abort()
            if any(b in url for b in E.BLOCK):
                return route.abort()
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

    def wait_text(page, sel, text, timeout=10000):
        page.wait_for_function("([s, t]) => { const e = document.querySelector(s); return e && e.textContent.includes(t) }", arg=[sel, text], timeout=timeout)

    def screen_xy(page, lon, lat):
        """Where a point is on the map canvas (the page's own projection)."""
        return page.evaluate("""([lon, lat]) => {
          const M = window.MAPS.M, mx = (lon + 180) / 360, s = Math.sin(lat * Math.PI / 180), my = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
          const wrap = document.querySelector('#map-body .gm-wrap').getBoundingClientRect();
          let x = (mx - M.cx) * M.S + M.W / 2; while (x < 0) x += M.S; while (x > M.W) x -= M.S;
          return [wrap.left + x, wrap.top + (my - M.cy) * M.S + M.H / 2];
        }""", [lon, lat])

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        setup(ctx)
        page = ctx.new_page()
        watch(page)
        page.goto(base)
        page.wait_for_selector("#mkt table")

        # ---------------- technical analysis ----------------
        cmd(page, "TECH AAPL")
        page.wait_for_selector("#tech-body .tc-cv canvas", timeout=10000)
        tb = page.inner_text("#tech-body")
        check("TECH: chart, ranges, indicators and the reading", "Trend" in tb and "RSI 14" in tb and "SMA 50" in tb and "1Y" in tb and "ATR 14" in tb, tb[:400])
        check("TECH: panel title", "TECHNICAL ANALYSIS · AAPL" in page.inner_text("#p-tech .ph"), page.inner_text("#p-tech .ph"))
        page.click("#tech-body .chipbtn:has-text('MACD')")
        page.wait_for_function("document.querySelector('#tech-body .chipbtn.on') && [...document.querySelectorAll('#tech-body .chipbtn.on')].some(b => b.textContent === 'MACD')")
        check("TECH: MACD switched on", True)
        page.hover("#tech-body .tc-cv canvas", position={"x": 300, "y": 120})
        page.wait_for_function("getComputedStyle(document.querySelector('#tm-tip')).display === 'block'", timeout=5000)
        tip = page.inner_text("#tm-tip")
        check("TECH: crosshair shows O/H/L/C", "O " in tip and "C " in tip and "Vol" in tip, tip)
        page.mouse.move(5, 5)
        shot(page, "f01_tech")
        cmd(page, "AAPL TA")
        page.wait_for_selector("#tech-body .tc-tabs2 table")
        ta = page.inner_text("#tech-body")
        check("TA: Fibonacci levels table", "61.8%" in ta and "Fibonacci retracement" in ta, ta[-600:])
        cmd(page, "BTC GPO")
        page.wait_for_function("[...document.querySelectorAll('#tech-body .chipbtn.on')].some(b => b.textContent === 'BARS')", timeout=8000)
        check("GPO: bars style", True)
        cmd(page, "IND NVDA BOLL")
        page.wait_for_function("[...document.querySelectorAll('#tech-body .chipbtn.on')].some(b => b.textContent === 'BOLL 20,2') && document.querySelector('#tech-title').textContent.includes('NVDA')", timeout=8000)
        check("IND: Bollinger switched on for NVDA", True)
        cmd(page, "VAP AAPL")
        wait_text(page, "#tech-body", "Point of control")
        check("VAP: point of control, value area, VWAP", all(x in page.inner_text("#tech-body") for x in ("Value area high", "VWAP", "Volume")), page.inner_text("#tech-body")[:300])
        shot(page, "f02_vap")
        cmd(page, "TSM AAPL")
        page.wait_for_selector("#tech-body table tbody tr")
        check("TSM: the day by hour", "Hour (MSK)" in page.inner_text("#tech-body thead") and page.locator("#tech-body tbody tr").count() >= 1)
        cmd(page, "QR BTC")
        wait_text(page, "#tech-body", "Bought")
        check("QR: crypto trades from Binance", page.locator("#tech-body tbody tr").count() == 20 and "sell" in page.inner_text("#tech-body tbody"))
        cmd(page, "QR ETH")
        wait_text(page, "#tech-body", "does not answer from your network")
        check("QR: no trade feed at all — the day's bars instead of an error", page.locator("#tech-body tbody tr").count() >= 10, page.inner_text("#tech-body")[:300])
        cmd(page, "QR AAPL")
        wait_text(page, "#tech-body", "no free tick-by-tick")
        check("QR: stocks — the day's bars and an honest note", page.locator("#tech-body tbody tr").count() >= 10)
        cmd(page, "TRA AAPL")
        wait_text(page, "#tech-body", "Total return")
        tra = page.inner_text("#tech-body .stat")
        check("TRA: price, dividends, total return", "Price return" in tra and "Dividends paid" in tra and "A year on average" in tra, tra)
        cmd(page, "TRAY")
        page.wait_for_selector("#tech-body table tbody tr", timeout=15000)
        tr = page.inner_text("#tech-body")
        check("TRAY: 14 markets over 12 periods", page.locator("#tech-body tbody tr").count() == 14 and "YTD" in tr and "5Y*" in tr, tr[:300])
        shot(page, "f03_tray")

        # ---------------- company tabs ----------------
        cmd(page, "AAPL GE")
        wait_text(page, "#des-body", "P/E now", 12000)
        shot(page, "f03b_ge")
        check("GE: P/E over five years", page.locator("#des-body .cv canvas").count() == 1 and "Forward P/E" in page.inner_text("#des-body"),
              (page.locator("#des-body .cv canvas").count(), page.inner_text("#des-body")[:300]))
        cmd(page, "AAPL CACS")
        wait_text(page, "#des-body", "Earnings")
        check("CACS: corporate action calendar", "COMING" in page.inner_text("#des-body") and page.locator("#des-body table").count() >= 1, page.inner_text("#des-body")[:300])
        cmd(page, "AAPL CRPR")
        wait_text(page, "#des-body", "Moody")
        check("CRPR: honest note and links to the agencies", page.locator("#des-body .actions a").count() == 3)

        # ---------------- monitors ----------------
        cmd(page, "MOV")
        page.wait_for_selector("#mon-body table tbody tr")
        mv = page.inner_text("#mon-body")
        check("MOV: leaders and laggards with index points", "PUSH UP" in mv and "PULL DOWN" in mv and "NVDA" in mv and "XOM" in mv, mv[:400])
        shot(page, "f04_mov")
        cmd(page, "MOV RU")
        wait_text(page, "#mon-body", "SBER")
        check("MOV RU: the MOEX index with exchange weights", "MOEX" in page.inner_text("#mon-body") and "14.50%" in page.inner_text("#mon-body"), page.inner_text("#mon-body")[:300])
        cmd(page, "MOST US")
        page.wait_for_selector("#mon-body table tbody tr")
        page.click("#mon-body .chipbtn:has-text('GAINERS')")
        page.wait_for_function("document.querySelector('#mon-body tbody tr td') && document.querySelector('#mon-body tbody tr td').textContent === 'NVDA'")
        check("MOST: gainers first", True)
        cmd(page, "MRR")
        page.wait_for_selector("#mon-body table tbody tr")
        page.click("#mon-body th:has-text('1Y')")
        first = page.inner_text("#mon-body tbody tr:first-child td:nth-child(2)")
        check("MRR: sort by one year", first == "NVDA", first)
        cmd(page, "MEMB")
        page.wait_for_selector("#mon-body .anr-bar i")
        check("MEMB: sector weights and members", page.locator("#mon-body tbody tr").count() == 3 and "Top 10 weight" in page.inner_text("#mon-body"))
        cmd(page, "WPE")
        wait_text(page, "#mon-body", "Germany")
        check("WPE: valuations by country", page.locator("#mon-body tbody tr").count() == 3 and "17.9" in page.inner_text("#mon-body"), page.inner_text("#mon-body")[:300])
        cmd(page, "BI")
        page.wait_for_selector("#mon-body tbody tr.row")
        page.click("#mon-body tbody tr.row:has-text('Technology')")
        page.wait_for_function("document.querySelectorAll('#mon-body table table tbody tr').length === 2")
        check("BI: sectors, a click shows the members", True)
        cmd(page, "FPC")
        page.wait_for_selector("#mon-body tbody tr", timeout=30000)
        check("FPC: ETFs ranked", page.locator("#mon-body tbody tr").count() >= 30, page.locator("#mon-body tbody tr").count())
        check("FPC: each fund says what it holds", "Treasuries 20Y+" in page.inner_text("#mon-body") and "Semiconductors" in page.inner_text("#mon-body"))
        cmd(page, "CDR")
        page.wait_for_selector("#mon-body tbody tr")
        page.wait_for_function("[...document.querySelectorAll('#mon-body tbody tr')].find(r => r.textContent.includes('MOEX')).textContent.includes('Unity Day')", timeout=10000)
        cdr = page.inner_text("#mon-body")
        moex = page.evaluate("[...document.querySelectorAll('#mon-body tbody tr')].find(r => r.textContent.includes('MOEX')).querySelector('td.hol').textContent")
        check("CDR: the nearest holidays come first", moex.index("Unity Day") < moex.index("Christmas"), moex)
        lse = page.evaluate("MON.ruleHolidays('LSE', 2026).map(h => h.date).join(',')")
        check("CDR: London bank holidays 2026 (Boxing Day on a Saturday moves to Monday)",
              lse == "2026-01-01,2026-04-03,2026-04-06,2026-05-04,2026-05-25,2026-08-31,2026-12-25,2026-12-28", lse)
        xe = page.evaluate("[MON.easter(2027, 0), MON.ruleHolidays('XETRA', 2026).length, MON.ruleHolidays('SIX', 2026).map(h => h.date).includes('2026-05-14'), MON.ruleHolidays('EPA', 2026).some(h => h.date === '2026-07-14')]")
        check("CDR: Easter, Xetra and SIX calendars, Euronext open on Bastille Day", xe == ["2027-03-28", 7, True, False], xe)
        check("CDR: 18 exchanges, NYSE holidays by rule, others via the server", page.locator("#mon-body tbody tr").count() == 18 and ("Thanksgiving" in cdr or "Christmas" in cdr), cdr[:500])
        shot(page, "f05_cdr")
        cmd(page, "BAS")
        wait_text(page, "#mon-body", "broker")
        check("BAS: explained as not available", "NOT AVAILABLE" in page.inner_text("#p-mon .ph"))

        # ---------------- rates panel ----------------
        cmd(page, "WB")
        wait_text(page, "#gc-body", "Russia")
        check("WB: 10-year yields and spreads", "vs UST, bp" in page.inner_text("#gc-body") and page.locator("#gc-body tbody tr").count() == 2)
        cmd(page, "BTMM US")
        wait_text(page, "#gc-body", "SOFR")
        bt = page.inner_text("#gc-body")
        check("BTMM US: policy rate, money market, curve", "Federal Reserve" in bt and "Next FOMC" in bt and "2s10s" in bt, bt[:500])
        cmd(page, "BTMM RU")
        wait_text(page, "#gc-body", "RUONIA")
        check("BTMM RU: Bank of Russia and RUONIA", "Bank of Russia" in page.inner_text("#gc-body"))
        cmd(page, "MMR")
        wait_text(page, "#gc-body", "EFFR")
        check("MMR: overnight rates against policy rates", page.locator("#gc-body tbody tr").count() == 3)
        cmd(page, "SRCH")
        wait_text(page, "#gc-body", "912797QX8", 10000)
        check("SRCH: Treasury auctions from the bot's copy", page.locator("#gc-body tbody tr").count() == 2)
        check("SRCH: the investment yield and the bid-to-cover", "3.962%" in page.inner_text("#gc-body") and "2.91" in page.inner_text("#gc-body"))
        page.fill("#gc-body input.t", "26-WEEK")
        page.wait_for_timeout(200)
        check("SRCH: filter by term", page.locator("#gc-body tbody tr").count() == 1 and "912797QY6" in page.inner_text("#gc-body tbody"))
        page.fill("#gc-body input.t", "")
        page.click("#gc-body .chipbtn:has-text('Note')")
        wait_text(page, "#gc-body", "91282CRR4")
        nt = page.inner_text("#gc-body tbody")
        check("SRCH: an announced TIPS auction", "TIPS" in nt and "announced" in nt and page.locator("#gc-body tbody tr").count() == 1, nt)
        shot(page, "f06_srch")

        # ---------------- news topics ----------------
        cmd(page, "NSE MNA")
        page.wait_for_selector("#ntools .chip.tag")
        check("NSE MNA: a topic filter", "M&A" in page.inner_text("#ntools"))
        cmd(page, "RATC")
        wait_text(page, "#ntools", "Credit ratings")
        check("RATC: rating actions topic", True)
        page.click("#ntools .chip.tag")
        check("news topic: removed with ✕", page.locator("#ntools .chip.tag").count() == 0)

        # ---------------- maps ----------------
        cmd(page, "MAP")
        page.wait_for_selector("#map-body .gm-wrap canvas")
        page.wait_for_function("window.MAPS && window.MAPS.M.data.quakes && window.MAPS.M.data.choke && window.MAPS.M.data.storms && window.MAPS.M.data.exch", timeout=15000)
        side = page.inner_text("#map-body .gm-side")
        check("MAP: layers with counts", "Earthquakes" in side and "Shipping chokepoints" in side and "Stock markets today" in side, side[:400])
        check("MAP: earthquakes from USGS straight", "earthquake.usgs.gov" in geo_calls)
        x, y = screen_xy(page, 140.2, 34.6)
        page.mouse.move(x, y)
        page.wait_for_function("getComputedStyle(document.querySelector('#tm-tip')).display === 'block'", timeout=5000)
        check("MAP: hover shows the earthquake", "M6.4" in page.inner_text("#tm-tip"), page.inner_text("#tm-tip"))
        page.mouse.click(x, y)
        wait_text(page, "#map-body .gm-info", "Tokyo")
        check("MAP: a click pins the details with a link", page.locator("#map-body .gm-info a").count() == 1)
        page.click("#map-body .gm-ly:has-text('Power plants')")
        page.wait_for_function("window.MAPS.M.data.plants && window.MAPS.M.data.plants.pts.length > 30000", timeout=20000)
        check("MAP: 34,000+ power plants with fuel filters", page.locator("#map-body .gm-chips .chipbtn").count() == 12)
        page.click("#map-body .gm-chips .chipbtn:has-text('Solar')")
        check("MAP: a fuel switched off", page.evaluate("!!window.MAPS.M.fuels.Solar"))
        page.click("#map-body .gm-ly:has-text('Oil refineries')")
        page.wait_for_function("window.MAPS.M.data.refin && window.MAPS.M.data.refin.pts.length > 400", timeout=10000)
        check("MAP: refineries layer", True)
        page.click("#map-body .gm-ly:has-text('Heavy industry')")
        page.wait_for_function("window.MAPS.M.data.fact && window.MAPS.M.data.fact.pts.length > 6000", timeout=15000)
        n_all = int(page.inner_text("#map-body .gm-ly:has-text('Heavy industry') small").replace(",", ""))
        page.click("#map-body .gm-chips .chipbtn:has-text('Cement')")
        n_nocem = int(page.inner_text("#map-body .gm-ly:has-text('Heavy industry') small").replace(",", ""))
        check("MAP: heavy industry (Climate TRACE) with kinds that switch off", n_all > 6000 and 0 < n_nocem < n_all - 2000, [n_all, n_nocem])
        fact = page.evaluate("window.MAPS.M.data.fact.pts.filter(p => /POSCO Gwangyang/.test(p.t))[0]")
        check("MAP: a steel plant with its owner, capacity and emissions", fact and "POSCO Holdings" in " ".join(fact["s"]) and "Mt a year" in " ".join(fact["s"]), fact)
        page.click("#map-body .gm-ly:has-text('Natural gas')")
        page.wait_for_function("window.MAPS.M.data.gas && window.MAPS.M.data.gas.pts.length > 300", timeout=10000)
        kinds = page.evaluate("[...new Set(window.MAPS.M.data.gas.pts.map(p => p.s[0].split(' · ')[0]))].sort()")
        check("MAP: gas fields and underground gas storage", kinds == ["Natural gas field", "Underground gas storage"], kinds)
        page.click("#map-body .gm-ly:has-text('Oil terminals')")
        page.wait_for_function("window.MAPS.M.data.oilst && window.MAPS.M.data.oilst.pts.length > 800", timeout=10000)
        top = page.evaluate("window.MAPS.M.data.oilst.pts[window.MAPS.M.data.oilst.pts.length - 1]")
        check("MAP: oil terminals — the busiest tanker port on top, with the oil depots", top["t"] == "🛢 Rotterdam" and "15,000" in " ".join(top["s"]), top)
        page.evaluate("window.MAPS.M.S = window.MAPS.M.S0 * 3; window.MAPS.M.cx = (10 + 180) / 360; window.MAPS.M.cy = 0.33")
        page.mouse.move(700, 400); page.mouse.wheel(0, 1); page.wait_for_timeout(400)
        shot(page, "f07b_industry")
        for lay in ("Heavy industry", "Natural gas", "Oil terminals"):
            page.click(f"#map-body .gm-ly:has-text('{lay}')")
        page.mouse.move(700, 400)
        page.mouse.wheel(0, -400)
        page.wait_for_timeout(300)
        check("MAP: wheel zooms in", page.evaluate("window.MAPS.M.S > window.MAPS.M.S0 * 1.2"), page.evaluate("window.MAPS.M.S / window.MAPS.M.S0"))
        z0 = page.evaluate("window.MAPS.M.S")
        page.click("#map-body .gm-ctl button[title='Zoom in']")
        page.wait_for_timeout(200)
        z1 = page.evaluate("window.MAPS.M.S")
        page.click("#map-body .gm-ctl button[title='Zoom out']")
        page.wait_for_timeout(200)
        check("MAP: the + and − buttons zoom (not swallowed by the map's drag)", abs(z1 / z0 - 1.6) < 0.01 and abs(page.evaluate("window.MAPS.M.S") - z0) < 1e-6 * z0, [z0, z1])
        shot(page, "f07_map")
        page.click("#map-body .gm-ctl button:has-text('⌂')")
        cmd(page, "STORM")
        wait_text(page, "#map-body .gm-side", "MELISSA")
        st = page.inner_text("#map-body .gm-side")
        check("STORM: the current cyclone, category and wind", "CAT 4" in st and "213 km/h" in st and "OLD" not in st, st[:400])
        check("STORM: track and cone drawn", page.evaluate("window.MAPS.M.data.storms.lines.length === 1 && window.MAPS.M.data.storms.polys.length === 1"))
        page.click("#map-body .gm-row:has-text('MELISSA')")
        page.wait_for_function("window.MAPS.M.S > window.MAPS.M.S0 * 3")
        shot(page, "f08_storm")
        check("STORM: a click flies to the storm", True)
        cmd(page, "BMAP V")
        page.wait_for_function("document.querySelectorAll('#map-body .gm-side .gm-ch').length === 3", timeout=10000)
        sh = page.inner_text("#map-body .gm-side")
        check("SHIP (BMAP V): chokepoints with ships a day and change", "Malacca Strait" in sh and "−25%" in sh or "-25%" in sh, sh[:400])
        page.click("#map-body .gm-ch:has-text('Suez')")
        page.wait_for_selector("#map-body .gm-info svg rect")
        check("SHIP: the 40-day chart of a chokepoint", page.locator("#map-body .gm-info svg rect").count() >= 60)
        page.wait_for_function("window.MAPS.M.data.ports && window.MAPS.M.data.ports.pts.length === 150", timeout=10000)
        check("SHIP: ports from PortWatch (pages of an ArcGIS layer)", True)
        page.wait_for_function("window.MAPS.M.data.ships", timeout=10000)
        wait_text(page, "#map-body .gm-side", "VESSELS")
        sk = page.inner_text("#map-body .gm-side")
        ships = page.evaluate("window.MAPS.M.data.ships.pts.map(p => [p.t, p.fuel, p.hd])")
        check("SHIP: live Baltic vessels — a stale position dropped, tankers on top, course only when moving",
              len(ships) == 4 and ships[0][1] == "tanker" and ships[0][2] == 251 and [s for s in ships if s[0] == "🚢 VOLGA CARGO"][0][2] is None and "Tankers" in sk, [ships, sk[-300:]])
        crude = page.evaluate("window.MAPS.M.data.ships.pts.filter(p => p.t === '🚢 BALTIC CRUDE')[0].s.join(' | ')")
        check("SHIP: a tanker's speed, destination and draught", "11.2 kn" in crude and "RUPRI" in crude and "14.8 m" in crude, crude)
        page.click("#map-body .gm-side .chipbtn:has-text('Gulf of Finland')")
        page.wait_for_timeout(200)
        check("SHIP: a button flies to the Gulf of Finland", page.evaluate("window.MAPS.M.S / window.MAPS.M.S0") > 20)
        page.click("#map-body .gm-chips .chipbtn:has-text('Passenger')")
        check("SHIP: a kind of vessel switched off", page.evaluate("!!window.MAPS.M.off.ships.pass"))
        page.click("#map-body .gm-chips .chipbtn:has-text('Passenger')")
        shot(page, "f09_ship")
        cmd(page, "WETR")
        page.wait_for_function("document.querySelectorAll('#map-body .gm-side .gm-ch').length === 43", timeout=10000)
        page.click("#map-body .gm-side .chipbtn:has-text('HDD')")
        check("WETR: 43 cities, degree days", "HDD 7 days" in page.inner_text("#map-body .gm-side"))
        shot(page, "f10_wetr")
        cmd(page, "MAP ECO INFLATION")
        wait_text(page, "#map-body .gm-side", "Argentina")
        eco = page.inner_text("#map-body .gm-side")
        check("MAP ECO: countries by inflation (IMF, all countries)", "Inflation this year" in eco and eco.index("Argentina") < eco.index("United States"), eco[:300])
        page.click("#map-body .gm-ch:has-text('Argentina')")
        wait_text(page, "#map-body .gm-info", "41.3")
        page.click("#map-body .gm-info .chipbtn")
        wait_text(page, "#ana-body", "Indicator", 10000)
        check("MAP ECO: a country opens ECST", True)
        shot(page, "f11_eco")
        cmd(page, "MAP ECO RATE")
        wait_text(page, "#map-body .gm-side", "Russia")
        check("MAP ECO RATE: policy rates", "Central bank policy rate" in page.inner_text("#map-body .gm-side"))

        # ---------------- Russian ----------------
        page.goto(base + "?lang=ru")
        page.wait_for_selector("#mkt table")
        cmd(page, "КАРТА")
        page.wait_for_selector("#map-body .gm-side")
        wait_text(page, "#map-body .gm-side", "Землетрясения")
        check("RU: the map in Russian", "Морские проливы" in page.inner_text("#map-body .gm-side"))
        cmd(page, "MOV")
        wait_text(page, "#mon-body", "ТЯНУТ ВВЕРХ")
        check("RU: MOV in Russian", "КТО ДВИГАЕТ ИНДЕКС" in page.inner_text("#p-mon .ph"))
        cmd(page, "TECH AAPL")
        wait_text(page, "#tech-body", "Тренд")
        check("RU: TECH in Russian", "СВЕЧИ" in page.inner_text("#tech-body"))
        cmd(page, "CDR")
        wait_text(page, "#mon-body", "Мосбиржа")
        check("RU: CDR in Russian", "БИРЖИ" in page.inner_text("#p-mon .ph"))
        page.goto(base + "?lang=en")
        page.wait_for_selector("#mkt table")

        # ---------------- help ----------------
        cmd(page, "HELP")
        help_t = page.inner_text("#help-t")
        check("HELP lists the new functions", all(x in help_t for x in ("TECH AAPL", "MOV, MOV RU", "STORM (BMAP STORM)", "WB", "NSE MNA")), help_t[-600:])
        page.keyboard.press("Escape")

        # ---------------- every code from the two lists the owner sent (CFI and formarse.es) ----------------
        codes = sorted(set(CODES_CFI + CODES_FORMARSE + ["MAP", "BMAP", "STORM", "SHIP", "WETR"]))
        known = page.evaluate("cs => cs.filter(c => TERM.CMDS[c] || TERM.SUFFIX[c])", codes)
        check(f"all {len(codes)} codes from the lists are terminal functions", len(known) == len(codes), sorted(set(codes) - set(known)))
        n_err = len(errors)
        for c in codes:
            cmd(page, c if page.evaluate("c => !!TERM.CMDS[c]", c) else "AAPL " + c)
            page.wait_for_timeout(250)
        page.wait_for_timeout(1500)
        check("each of them runs without a script error", len(errors) == n_err, errors[n_err:n_err + 5])

        # ---------------- phone ----------------
        m = ctx.new_page()
        m.set_viewport_size({"width": 390, "height": 844})
        watch(m)
        m.goto(base)
        m.wait_for_selector("#mkt table")
        m.click("#b-more")
        m.click("#fnlist button:has-text('World map with layers')")
        m.wait_for_selector("#map-body .gm-wrap canvas")
        check("phone: MAP alone on screen", visible_panels(m) == ["p-map"], visible_panels(m))
        check("phone: the list is hidden behind ☰", m.evaluate("getComputedStyle(document.querySelector('#map-body .gm-side')).display") == "none")
        m.click("#map-body .gm-ctl .gm-tbtn")
        check("phone: ☰ opens the layers", m.evaluate("getComputedStyle(document.querySelector('#map-body .gm-side')).display") != "none")
        shot(m, "f12_mobile_map")
        m.click("#map-body .gm-ctl .gm-tbtn")   # still reachable beside the open list: closes it
        check("phone: ☰ closes the layers again", m.evaluate("getComputedStyle(document.querySelector('#map-body .gm-side')).display") == "none")
        m.click("#b-more")
        m.click("#fnlist button:has-text('Chart with indicators')")
        m.wait_for_selector("#tech-body .tc-cv canvas")
        ov = m.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check("phone: TECH without horizontal page scroll", ov <= 0, ov)
        shot(m, "f13_mobile_tech")
        browser.close()

    proc.kill()
    static.shutdown()
    check("no errors in the browser console", not errors, errors[:5])
    if E.FAILS:
        print(f"\nFAILED: {len(E.FAILS)} of {len(E.FAILS) + len(E.OKS)}")
        sys.exit(1)
    print(f"\nFUNCTIONS E2E PASSED ({len(E.OKS)} checks)")


if __name__ == "__main__":
    run()
