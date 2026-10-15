import json, os, time
from playwright.sync_api import sync_playwright
BASE = os.environ["PAGES"] + "terminal/"
OUT, ERR = {}, []
os.makedirs("probe/shots2", exist_ok=True)
with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    p.on("pageerror", lambda e: ERR.append("pageerror: " + str(e)))
    for i in range(30):   # wait until GitHub Pages serves the new code
        p.goto(BASE + "?v=" + str(time.time()))
        p.wait_for_selector("#mkt table", timeout=30000)
        if p.evaluate("window.TERM && window.TERM.TV && window.TERM.TV['S&P']") == "FOREXCOM:SPXUSD":
            break
        time.sleep(20)
    OUT["new_code"] = p.evaluate("window.TERM.TV['S&P']")
    p.wait_for_timeout(12000)
    tv_text = " ".join(f.evaluate("() => document.body ? document.body.innerText : ''") for f in p.frames[1:])
    OUT["gp_restricted"] = "only available on TradingView" in tv_text
    OUT["gp_has_numbers"] = any(c.isdigit() for c in tv_text)
    p.screenshot(path="probe/shots2/gp_sp500.png")
    for cmd in ("UST10", "VIX", "NIKKEI"):
        p.fill("#cmd", cmd); p.press("#cmd", "Enter"); p.wait_for_timeout(10000)
        txt = " ".join(f.evaluate("() => document.body ? document.body.innerText : ''") for f in p.frames[1:])
        OUT["chart_" + cmd] = {"restricted": "only available on TradingView" in txt, "sub": p.inner_text("#chart-sub"), "own": p.locator("#ownc canvas, #ownc svg").count()}
        p.screenshot(path=f"probe/shots2/chart_{cmd}.png")
    p.fill("#cmd", "CORR"); p.press("#cmd", "Enter")
    p.wait_for_function("document.querySelectorAll('#ana-body table.mx').length >= 1", timeout=40000)
    p.wait_for_timeout(4000)
    OUT["corr_tables"] = p.locator("#ana-body table.mx").count()
    p.fill("#cmd", "AAPL ANR"); p.press("#cmd", "Enter")
    p.wait_for_function("(document.querySelector('#des-body') || {}).textContent && document.querySelector('#des-body').textContent.includes('329')", timeout=30000)
    OUT["anr_heading_count"] = p.inner_text("#des-body").count("Analyst price target")
    p.screenshot(path="probe/shots2/anr.png")
    p.fill("#cmd", "EVTS"); p.press("#cmd", "Enter"); p.wait_for_timeout(5000)
    OUT["evts"] = p.inner_text("#earn")[:500]
    b.close()
OUT["errors"] = ERR
print(json.dumps(OUT, ensure_ascii=False))
