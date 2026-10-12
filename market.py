"""
Котировки для строки рынка, картинки с графиками и страницы «Рынок онлайн».

Бесплатные источники без ключей:
  Yahoo Finance  — индексы США, нефть, золото, валюты, доходность, биткоин
  ЦБ РФ          — официальные курсы доллара и юаня к рублю
  Мосбиржа (ISS) — индекс Мосбиржи
Если какой-то источник не ответил, этот инструмент просто пропускается.
"""
from __future__ import annotations

import json
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
MSK = timezone(timedelta(hours=3))

# name — как показывать, short — коротко для строки в сообщении, digits — знаков после запятой
INSTRUMENTS = [
    {"name": "S&P 500", "short": "S&P", "src": "yahoo", "sym": "^GSPC", "digits": 0},
    {"name": "Nasdaq", "short": "Nasdaq", "src": "yahoo", "sym": "^IXIC", "digits": 0},
    {"name": "Нефть Brent", "short": "Brent", "src": "yahoo", "sym": "BZ=F", "digits": 2, "prefix": "$"},
    {"name": "Золото", "short": "Золото", "src": "yahoo", "sym": "GC=F", "digits": 0, "prefix": "$"},
    {"name": "EUR/USD", "short": "EUR/USD", "src": "yahoo", "sym": "EURUSD=X", "digits": 4},
    {"name": "Доходность США 10 лет", "short": "UST10", "src": "yahoo", "sym": "^TNX", "digits": 2, "suffix": "%"},
    {"name": "Биткоин", "short": "BTC", "src": "yahoo", "sym": "BTC-USD", "digits": 0, "prefix": "$"},
    {"name": "Индекс Мосбиржи", "short": "IMOEX", "src": "moex", "sym": "IMOEX", "digits": 0},
    {"name": "USD/RUB (ЦБ)", "short": "USD/RUB", "src": "cbr", "sym": "R01235", "digits": 2},
    {"name": "CNY/RUB (ЦБ)", "short": "CNY/RUB", "src": "cbr", "sym": "R01375", "digits": 2},
    # только на странице «Рынок онлайн» (chart: False — не попадают на картинку)
    {"name": "Газ (Henry Hub)", "short": "Газ", "src": "yahoo", "sym": "NG=F", "digits": 3, "prefix": "$", "chart": False},
    {"name": "Медь", "short": "Медь", "src": "yahoo", "sym": "HG=F", "digits": 3, "prefix": "$", "chart": False},
    {"name": "Доходность США 3 мес", "short": "UST3M", "src": "yahoo", "sym": "^IRX", "digits": 2, "suffix": "%", "chart": False},
    {"name": "Доходность США 5 лет", "short": "UST5", "src": "yahoo", "sym": "^FVX", "digits": 2, "suffix": "%", "chart": False},
    {"name": "Доходность США 30 лет", "short": "UST30", "src": "yahoo", "sym": "^TYX", "digits": 2, "suffix": "%", "chart": False},
]

# Только для терминала (docs/terminal): мировые индексы, валюты, сырьё.
# terminal: True — не показываются на странице «Рынок онлайн» и на картинке.
_T = {"src": "yahoo", "chart": False, "terminal": True}
INSTRUMENTS += [
    {**_T, "name": "Dow Jones", "short": "DJI", "sym": "^DJI", "digits": 0},
    {**_T, "name": "Russell 2000", "short": "RTY", "sym": "^RUT", "digits": 0},
    {**_T, "name": "VIX", "short": "VIX", "sym": "^VIX", "digits": 2},
    {**_T, "name": "Euro Stoxx 50", "short": "SX5E", "sym": "^STOXX50E", "digits": 0},
    {**_T, "name": "DAX", "short": "DAX", "sym": "^GDAXI", "digits": 0},
    {**_T, "name": "FTSE 100", "short": "UKX", "sym": "^FTSE", "digits": 0},
    {**_T, "name": "CAC 40", "short": "CAC", "sym": "^FCHI", "digits": 0},
    {**_T, "name": "Nikkei 225", "short": "NKY", "sym": "^N225", "digits": 0},
    {**_T, "name": "Hang Seng", "short": "HSI", "sym": "^HSI", "digits": 0},
    {**_T, "name": "Шанхай Composite", "short": "SHCOMP", "sym": "000001.SS", "digits": 0},
    {**_T, "name": "Sensex (Индия)", "short": "SENSEX", "sym": "^BSESN", "digits": 0},
    {**_T, "name": "Индекс доллара DXY", "short": "DXY", "sym": "DX-Y.NYB", "digits": 2},
    {**_T, "name": "USD/JPY", "short": "USDJPY", "sym": "JPY=X", "digits": 2},
    {**_T, "name": "GBP/USD", "short": "GBPUSD", "sym": "GBPUSD=X", "digits": 4},
    {**_T, "name": "USD/CNY", "short": "USDCNY", "sym": "CNY=X", "digits": 4},
    {**_T, "name": "USD/CHF", "short": "USDCHF", "sym": "CHF=X", "digits": 4},
    {**_T, "name": "Нефть WTI", "short": "WTI", "sym": "CL=F", "digits": 2, "prefix": "$"},
    {**_T, "name": "Серебро", "short": "Серебро", "sym": "SI=F", "digits": 2, "prefix": "$"},
    {**_T, "name": "Платина", "short": "Платина", "sym": "PL=F", "digits": 0, "prefix": "$"},
    {**_T, "name": "Пшеница", "short": "Пшеница", "sym": "ZW=F", "digits": 0},
]

# адреса вынесены, чтобы их можно было подменить в тестах
YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=5d&interval=30m"
MOEX_URL = "https://iss.moex.com/iss/engines/stock/markets/index/securities/{sym}/candles.json?interval=60&from={frm}&iss.meta=off"
CBR_URL = "https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1={d1}&date_req2={d2}&VAL_NM_RQ={sym}"


def _get(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _day_change(series):
    """Изменение: последняя цена против последней цены предыдущего торгового дня (по МСК)."""
    if len(series) < 2:
        return None
    last_t, last_v = series[-1]
    last_day = last_t.astimezone(MSK).date()
    prev = [v for t, v in series if t.astimezone(MSK).date() < last_day]
    if not prev or not prev[-1]:
        return None
    return (last_v / prev[-1] - 1) * 100


def fetch_yahoo(sym):
    data = json.loads(_get(YAHOO_URL.format(sym=urllib.request.quote(sym))))
    res = data["chart"]["result"][0]
    ts = res.get("timestamp") or []
    closes = res["indicators"]["quote"][0].get("close") or []
    series = [(datetime.fromtimestamp(t, timezone.utc), c) for t, c in zip(ts, closes) if c is not None]
    price = res.get("meta", {}).get("regularMarketPrice")
    if price and series:
        series[-1] = (series[-1][0], float(price))
    return series


def fetch_moex(sym):
    frm = (datetime.now(MSK) - timedelta(days=8)).strftime("%Y-%m-%d")
    data = json.loads(_get(MOEX_URL.format(sym=sym, frm=frm)))
    cols = data["candles"]["columns"]
    i_close, i_begin = cols.index("close"), cols.index("begin")
    series = []
    for row in data["candles"]["data"]:
        t = datetime.strptime(row[i_begin], "%Y-%m-%d %H:%M:%S").replace(tzinfo=MSK).astimezone(timezone.utc)
        series.append((t, float(row[i_close])))
    return series


def fetch_cbr(sym):
    now = datetime.now(MSK)
    d1 = (now - timedelta(days=40)).strftime("%d/%m/%Y")
    d2 = (now + timedelta(days=1)).strftime("%d/%m/%Y")  # ЦБ публикует курс на завтра заранее
    root = ET.fromstring(_get(CBR_URL.format(d1=d1, d2=d2, sym=sym)))
    series = []
    for rec in root.iter("Record"):
        d = datetime.strptime(rec.get("Date"), "%d.%m.%Y").replace(tzinfo=MSK)
        nominal = float((rec.findtext("Nominal") or "1").replace(",", "."))
        value = float(rec.findtext("Value").replace(",", ".")) / nominal
        series.append((d.astimezone(timezone.utc), value))
    return series


FETCHERS = {"yahoo": fetch_yahoo, "moex": fetch_moex, "cbr": fetch_cbr}


def _load(inst):
    try:
        series = FETCHERS[inst["src"]](inst["sym"])
        if not series:
            return None
        if inst["src"] == "cbr":
            # у ЦБ одно значение в день: изменение к предыдущей записи, на графике — 30 дней
            change = (series[-1][1] / series[-2][1] - 1) * 100 if len(series) >= 2 else None
            period = "30 дней"
        else:
            change = _day_change(series)
            period = "5 дней"
        return {**inst, "price": series[-1][1], "change": change, "series": series, "period": period}
    except Exception as e:
        print(f"  ! котировка {inst['name']}: {type(e).__name__}: {e}"[:200])
        return None


def fetch_all():
    with ThreadPoolExecutor(max_workers=6) as ex:
        return [q for q in ex.map(_load, INSTRUMENTS) if q]


# ---------------------------------------------------------------------------
# Форматирование
# ---------------------------------------------------------------------------
def fmt_price(q):
    d = q.get("digits", 2)
    s = f"{q['price']:,.{d}f}".replace(",", " ")  # узкий пробел как разделитель тысяч
    if d:
        s = s.replace(".", ",")
    return f"{q.get('prefix', '')}{s}{q.get('suffix', '')}"


def fmt_change(q):
    c = q.get("change")
    if c is None:
        return ""
    arrow = "▲" if c > 0.005 else ("▼" if c < -0.005 else "•")
    return f"{arrow}{abs(c):.1f}%".replace(".", ",")


def strip_line(quotes, keys=("S&P", "Brent", "Золото", "USD/RUB", "IMOEX", "BTC")):
    """Короткая строка рынка для шапки сообщения."""
    by = {q["short"]: q for q in quotes}
    parts = [f"{k} {fmt_price(by[k])} {fmt_change(by[k])}".strip() for k in keys if k in by]
    return " · ".join(parts)


def to_json(quotes, points=60):
    """Компактный вид для страницы: цена, изменение, упрощённая серия для спарклайна."""
    out = []
    for q in quotes:
        vals = [v for _, v in q["series"]]
        step = max(1, len(vals) // points)
        spark = vals[::step]
        if spark[-1] != vals[-1]:
            spark.append(vals[-1])
        item = {"name": q["name"], "price": fmt_price(q), "change": q.get("change"),
                "change_txt": fmt_change(q), "period": q["period"], "spark": [round(v, 6) for v in spark],
                "id": q["short"], "value": round(q["price"], 6), "digits": q.get("digits", 2)}
        if q.get("terminal"):
            item["terminal"] = True
        out.append(item)
    return out
