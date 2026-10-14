"""
E2E-тест терминала в настоящем браузере (Chromium через Playwright).

Поднимает локально: сайт (docs/) и сервер бота (настоящий код worker/src с подменёнными внешними сервисами,
tests/fake_server.mjs). Проверяет все новые функции на компьютере и телефоне, отсутствие ошибок в консоли.
Запуск: python3 tests/e2e_terminal.py   (скриншоты — в папку из E2E_SHOTS, если задана)
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

BLOCK = ("tradingview.com", "binance", "coingecko.com", "alternative.me", "fonts.googleapis.com", "fonts.gstatic.com", "telegram.org")


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
    # живая лента: «бот» прислал свежую новость, которой ещё нет на сайте
    key = hashlib.sha256(b"econnews-sync:123:TEST").hexdigest()
    body = json.dumps({"updated": "2099-01-01T00:00:00+00:00", "news": [{"title": "Свежая новость с сервера", "ts": "2099-01-01T00:00:00+00:00",
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
        check("раскладка 5 панелей по умолчанию", sorted(vis) == sorted(["p-mkt", "p-chart", "p-crypto", "p-news", "p-eco"]), vis)
        page.wait_for_function("document.querySelector('#news').textContent.includes('Свежая новость с сервера')", timeout=8000)
        check("живая лента: свежая новость с сервера бота в N", True)
        check("новость: тикер $TSLA и разбор ИИ", page.locator("#news .tkb", has_text="TSLA").count() == 1 and "Отзыв машин" in page.inner_text("#news"))
        shot(page, "01_start")

        # DES и вкладки компании
        cmd(page, "AAPL DES")
        page.wait_for_function("document.querySelector('#des-body').textContent.includes('Apple Inc')", timeout=8000)
        body = page.inner_text("#des-body")
        check("DES: карточка Apple", "P/E" in body and "$5,01 трлн" in body and "Аналитики" in body and "Следующий отчёт" in body, body[:300])
        check("DES в правой верхней панели вместо крипты", "p-des" in visible_panels(page) and "p-crypto" not in visible_panels(page), visible_panels(page))
        shot(page, "02_des")
        page.click("#des-tabs button[data-t=FA]")
        page.wait_for_selector("#des-body table")
        fa = page.inner_text("#des-body")
        check("FA: отчётность из SEC по кварталам", "$109 млрд" in fa and "$29,8 млрд" in fa and "Своб. поток" in fa, fa[:300])
        page.click("#des-body .ptabs button:has-text('ГОДЫ')")
        years = page.inner_text("#des-body table")
        check("FA: переключение на годы", "2025" in years and "$416 млрд" in years and "$98,0 млрд" in years, years)
        shot(page, "03_fa")
        page.click("#des-tabs button[data-t=ERN]")
        page.wait_for_selector("#des-body svg rect")
        check("ERN: график факт/прогноз и таблица", page.locator("#des-body svg rect").count() >= 4 and "Q3 2026" in page.inner_text("#des-body"))
        page.click("#des-tabs button[data-t=ANR]")
        check("ANR: распределение мнений", page.locator("#des-body .anr-bar").count() >= 2 and "ПОКУПАТЬ" in page.inner_text("#des-body"))
        page.click("#des-tabs button[data-t=CN]")
        check("CN: новости компании на русском", "Apple превзошла прогнозы" in page.inner_text("#des-body"))
        page.click("#des-tabs button[data-t=HDS]")
        check("HDS: сделки инсайдеров", "Cook Tim" in page.inner_text("#des-body"))
        page.click("#des-tabs button[data-t=DES]")

        # HP: таблица и CSV
        cmd(page, "HP AAPL")
        page.wait_for_function("document.querySelectorAll('#hp-body tbody tr').length >= 200", timeout=8000)
        check("HP: история 250 дней", page.locator("#hp-body tbody tr").count() == 250)
        with page.expect_download() as dl:
            page.click("#hp-body button:has-text('CSV')")
        d = dl.value
        path = d.path()
        with open(path, encoding="utf-8-sig") as f:
            lines = f.read().strip().splitlines()
        check("HP: выгрузка CSV", d.suggested_filename == "AAPL_1y.csv" and lines[0] == "date,open,high,low,close,volume" and len(lines) == 251,
              (d.suggested_filename, lines[:2], len(lines)))
        shot(page, "04_hp")

        # COMP
        cmd(page, "COMP AAPL MSFT")
        page.wait_for_selector("#hp-body .cv canvas")
        page.wait_for_function("document.querySelectorAll('#hp-body .cv .legend span').length === 2", timeout=8000)
        check("COMP: два инструмента на одном графике", page.locator("#hp-body .cv .legend span").count() == 2)
        shot(page, "05_comp")

        # EQS
        cmd(page, "EQS")
        page.wait_for_selector("#eqs-body tbody tr")
        check("EQS: все компании", page.locator("#eqs-body tbody tr").count() == 3)
        page.select_option("#eqs-body select", "Энергетика")
        page.wait_for_function("document.querySelectorAll('#eqs-body tbody tr').length === 1")
        check("EQS: фильтр по сектору", "XOM" in page.inner_text("#eqs-body tbody"))
        page.select_option("#eqs-body select", "")
        page.wait_for_function("document.querySelectorAll('#eqs-body tbody tr').length === 3")
        page.click("#eqs-body th:has-text('P/E')")
        first = page.inner_text("#eqs-body tbody tr:first-child td:first-child")
        check("EQS: сортировка по P/E", first == "XOM", first)
        shot(page, "06_eqs")
        page.click("#eqs-body tbody tr:first-child")
        page.wait_for_function("document.querySelector('#des-title').textContent.includes('XOM')", timeout=8000)
        check("EQS: строка открывает DES", True)

        # IMAP
        cmd(page, "IMAP")
        page.wait_for_selector("#imap .tile")
        check("IMAP: плитки компаний", page.locator("#imap .tile").count() == 3)
        shot(page, "07_imap")
        page.click("#imap .tile:has-text('NVDA')")
        page.wait_for_function("document.querySelector('#des-title').textContent.includes('NVDA')", timeout=8000)
        check("IMAP: плитка открывает DES", True)

        # GC / CB / WIRP
        cmd(page, "GC")
        page.wait_for_selector("#gc-body svg path")
        check("GC: кривые и таблица", page.locator("#gc-body svg path").count() >= 1 and "10Y" in page.inner_text("#gc-body table"))
        shot(page, "08_gc")
        cmd(page, "CB")
        page.wait_for_function("document.querySelector('#gc-body').textContent.includes('ЦБ РФ')", timeout=5000)
        check("CB: ставки центробанков", "−100 б.п." in page.inner_text("#gc-body") or "-100" in page.inner_text("#gc-body"), page.inner_text("#gc-body")[:300])
        cmd(page, "WIRP")
        page.wait_for_selector("#gc-body .prob i")
        check("WIRP: вероятности по заседаниям", "повышение 50%" in page.inner_text("#gc-body"))

        # W / PORT / ALRT (сначала без входа — только в браузере)
        cmd(page, "W AAPL BTC")
        page.wait_for_function("document.querySelectorAll('#my-body tbody tr').length === 2", timeout=8000)
        page.wait_for_function("document.querySelector('#my-body').textContent.includes('342,96')", timeout=8000)
        check("W: список с ценами", "только в этом браузере" in page.inner_text("#my-sub"))
        cmd(page, "PORT")
        page.fill("#my-body form input.t", "AAPL")
        page.fill("#my-body form input[placeholder='кол-во']", "10")
        page.fill("#my-body form input[placeholder='цена']", "300")
        page.click("#my-body form button:has-text('КУПИТЬ')")
        page.wait_for_function("document.querySelector('#my-body tfoot') && document.querySelector('#my-body tfoot').textContent.includes('ИТОГО')", timeout=8000)
        port = page.inner_text("#my-body")
        check("PORT: позиция и итог", "+$429,60" in port and "+14,32%" in port, port[:400])
        shot(page, "09_port")
        cmd(page, "ALRT")
        check("ALRT без входа: подсказка про Telegram", "Алерты приходят" in page.inner_text("#my-body"))
        # вход владельца паролем → данные общие с ботом
        cmd(page, "SET")
        page.fill("#k-pass", "pw")
        page.click("#k-login")
        page.wait_for_function("document.querySelector('#k-msg').textContent.includes('Готово')", timeout=8000)
        page.keyboard.press("Escape")
        cmd(page, "ALRT AAPL > 400")
        page.wait_for_selector("#my-body form input.t")
        val = page.input_value("#my-body form input.t")
        page.click("#my-body form button:has-text('ПОСТАВИТЬ')")
        try:
            page.wait_for_function("document.querySelector('#my-body').textContent.includes('AAPL выше 400')", timeout=8000)
        except Exception:
            print("DEBUG my-body:", page.inner_text("#my-body")[:500], "| sub:", page.inner_text("#my-sub"), "| errors:", errors[:3])
            raise
        check("ALRT: алерт поставлен на сервере", val == "AAPL > 400" and "☁" in page.inner_text("#my-sub"), val)
        cmd(page, "W")
        page.wait_for_function("document.querySelectorAll('#my-body tbody tr').length >= 2", timeout=8000)
        me = {}
        for _ in range(20):   # изменения уходят на сервер с задержкой 0,4 с
            me = json.loads(urllib.request.urlopen(urllib.request.Request(f"{api}/api/me", headers={"X-Owner-Key": "pw"})).read())
            if me.get("w") and me.get("p"):
                break
            page.wait_for_timeout(250)
        check("W/PORT: перенесены на сервер (общие с ботом)", "AAPL" in me.get("w", []) and any(x["s"] == "AAPL" for x in me.get("p", [])), me)
        shot(page, "10_alrt")

        # ECO: отчёты компаний
        page.click("#eco-tabs button[data-t=earn]")
        page.wait_for_selector("#earn table")
        check("ECO: вкладка отчётов компаний", "AAPL" in page.inner_text("#earn"))

        # раскладки
        cmd(page, "LAYOUT 4")
        time.sleep(0.3)
        check("LAYOUT 4: четыре панели", len(visible_panels(page)) == 4, visible_panels(page))
        shot(page, "11_layout4")
        cmd(page, "LAYOUT 6")
        time.sleep(0.3)
        check("LAYOUT 6: шесть панелей", len(visible_panels(page)) == 6, visible_panels(page))
        shot(page, "12_layout6")
        first_panel = visible_panels(page)[0]
        page.click(f"#{first_panel} .ph .pick")
        page.click("#fnmenu button:has-text('Карта рынка')")
        time.sleep(0.3)
        vis = visible_panels(page)
        check("▾ в заголовке: другая функция в панели", "p-imap" in vis and first_panel not in vis and len(vis) == 6, vis)
        cmd(page, "LAYOUT 1")
        time.sleep(0.2)
        check("LAYOUT 1: обратно пять", len(visible_panels(page)) == 5)

        # тикер из новости
        cmd(page, "N")
        page.click("#news .tkb:has-text('TSLA')")
        page.wait_for_function("document.querySelector('#des-title').textContent.includes('TSLA')", timeout=8000)
        check("тикер в новости открывает компанию", True)

        # ссылка из бота: ?cmd=
        page2 = ctx.new_page()
        watch(page2)
        page2.goto(base + "?cmd=" + urllib.request.quote("MSFT FA"))
        page2.wait_for_function("document.querySelector('#des-title').textContent.includes('MSFT')", timeout=8000)
        page2.wait_for_selector("#des-body table")
        check("ссылка ?cmd=MSFT FA из бота", "показатели на акцию" in page2.inner_text("#des-body"))
        page2.close()

        overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check("компьютер: нет горизонтальной прокрутки", overflow <= 0, overflow)

        # телефон
        mctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, accept_downloads=True)
        setup(mctx)
        m = mctx.new_page()
        watch(m)
        m.goto(base)
        m.wait_for_selector("#mkt table")
        check("телефон: видна одна панель", len(visible_panels(m)) == 1, visible_panels(m))
        m.click("#b-more")
        m.click("#fnlist button:has-text('Скринер')")
        m.wait_for_selector("#eqs-body tbody tr")
        check("телефон: меню функций → скринер", visible_panels(m) == ["p-eqs"], visible_panels(m))
        shot(m, "13_mobile_eqs")
        m.fill("#cmd", "AAPL DES")
        m.press("#cmd", "Enter")
        m.wait_for_function("document.querySelector('#des-body').textContent.includes('Apple Inc')", timeout=8000)
        check("телефон: DES", visible_panels(m) == ["p-des"], visible_panels(m))
        shot(m, "14_mobile_des")
        m.click("#b-more")
        m.click("#fnlist button:has-text('Кривые')")
        m.wait_for_selector("#gc-body svg path")
        shot(m, "15_mobile_gc")
        ov = m.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check("телефон: нет горизонтальной прокрутки страницы", ov <= 0, ov)
        browser.close()

    proc.kill()
    static.shutdown()
    check("нет ошибок в консоли браузера", not errors, errors[:5])
    if FAILS:
        print(f"\nОШИБКИ: {len(FAILS)} из {len(FAILS) + len(OKS)}")
        sys.exit(1)
    print(f"\nTERMINAL E2E PASSED ({len(OKS)} проверок)")


if __name__ == "__main__":
    run()
