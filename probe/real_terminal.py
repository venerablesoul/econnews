"""The live terminal (GitHub Pages + the real bot server) in a real browser: every new function, EN and RU, desktop and phone."""
import json, os, sys, time
from playwright.sync_api import sync_playwright
BASE = os.environ["PAGES"] + "terminal/"
OUT, ERR = {}, []
os.makedirs("probe/shots", exist_ok=True)


def run_cmd(p, c):
    p.fill("#cmd", c); p.press("#cmd", "Enter")


def grab(p, name, sel, wait_text=None, timeout=20000):
    try:
        if wait_text:
            p.wait_for_function("([s, t]) => (document.querySelector(s) || {}).textContent && document.querySelector(s).textContent.includes(t)",
                                arg=[sel, wait_text], timeout=timeout)
        else:
            p.wait_for_timeout(2500)
        OUT[name] = p.inner_text(sel)[:700]
    except Exception as e:
        OUT[name] = "TIMEOUT/ERR: " + str(e)[:150] + " | " + p.inner_text(sel)[:300]
    p.screenshot(path=f"probe/shots/{name}.png")


with sync_playwright() as pw:
    b = pw.chromium.launch()
    for lang, vp in (("en", {"width": 1440, "height": 900}), ("ru", {"width": 1440, "height": 900})):
        ctx = b.new_context(viewport=vp)
        p = ctx.new_page()
        p.on("console", lambda m: ERR.append(m.text) if m.type == "error" else None)
        p.on("pageerror", lambda e: ERR.append("pageerror: " + str(e)))
        p.goto(BASE + ("?lang=ru" if lang == "ru" else ""))
        p.wait_for_selector("#mkt table", timeout=30000)
        run_cmd(p, "AAPL DES"); grab(p, f"{lang}_des", "#des-body", "Apple")
        for tab, t in (("EE", "$"), ("ANR", "$"), ("HDS", "%"), ("DVD", "$"), ("OMON", "IV30"), ("RV", "AAPL"), ("CF", "10-")):
            p.click(f"#des-tabs button[data-t={tab}]"); grab(p, f"{lang}_{tab.lower()}", "#des-body", t)
        run_cmd(p, "MSFT DVD"); grab(p, f"{lang}_msft_dvd_live", "#des-body", "$")
        run_cmd(p, "ECST"); grab(p, f"{lang}_ecst", "#ana-body", "2026")
        run_cmd(p, "ECST RU"); grab(p, f"{lang}_ecst_ru", "#ana-body", "2027")
        run_cmd(p, "FXC"); grab(p, f"{lang}_fxc", "#ana-body", "EUR")
        run_cmd(p, "CORR"); grab(p, f"{lang}_corr", "#ana-body", "1.00" if lang == "en" else "1,00", 40000)
        run_cmd(p, "OMON"); grab(p, f"{lang}_opt", "#ana-body", "AAPL")
        run_cmd(p, "IPO"); grab(p, f"{lang}_ipo", "#ana-body", "20")
        run_cmd(p, "IMAP RU"); grab(p, f"{lang}_imap_ru", "#imap", "SBER")
        run_cmd(p, "EQS RU"); grab(p, f"{lang}_eqs_ru", "#eqs-body", "SBER")
        run_cmd(p, "HP AAPL 1D"); grab(p, f"{lang}_hp_1d", "#hp-body", ":")
        run_cmd(p, "HP BTC 1Y"); grab(p, f"{lang}_hp_btc", "#hp-body", "RSI")
        ctx.close()
    m = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    p = m.new_page()
    p.on("pageerror", lambda e: ERR.append("pageerror: " + str(e)))
    p.goto(BASE); p.wait_for_selector("#mkt table", timeout=30000)
    run_cmd(p, "AAPL OMON"); grab(p, "phone_omon", "#des-body", "IV30")
    OUT["phone_overflow"] = p.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    run_cmd(p, "ECST"); grab(p, "phone_ecst", "#ana-body", "2026")
    b.close()
OUT["console_errors"] = ERR[:30]
print(json.dumps(OUT, ensure_ascii=False))
