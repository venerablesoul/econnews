"""
Крупнейшие компании США для терминала: котировки, мультипликаторы, отчётность и календарь отчётов.

Результат — docs/stocks.json (скринер EQS, тепловая карта IMAP, вкладка ОТЧЁТЫ, команды бота /eqs /map /earnings)
и docs/fin/<ТИКЕР>.json (квартальная и годовая отчётность из SEC — для функции FA).

Источники:
  Yahoo Finance (без ключа)   — цены и изменение за день, пачками по 20 бумаг
  Finnhub (бесплатный ключ)   — мультипликаторы (P/E, дивиденды, рентабельность…), календарь отчётов
  SEC EDGAR (без ключа)       — выручка, прибыль, денежный поток из официальной отчётности (XBRL)
Ключ Finnhub берётся из FINNHUB_API_KEY. Без него обновляются только цены.
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
HERE = os.path.dirname(os.path.abspath(__file__))
STOCKS_FILE = os.path.join(HERE, "docs", "stocks.json")
FIN_DIR = os.path.join(HERE, "docs", "fin")

SPARK_URL = "https://query1.finance.yahoo.com/v7/finance/spark?symbols={syms}&range=1d&interval=1d"
FH_URL = "https://finnhub.io/api/v1"
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"

TECH, COMM, DISC, STAP, HLTH, FIN, IND, ENER, UTIL, REIT, MAT = (
    "Технологии", "Связь и медиа", "Циклич. потребление", "Повседн. спрос", "Здравоохранение", "Финансы",
    "Промышленность", "Энергетика", "Коммунальные", "Недвижимость", "Материалы")

# тикер, название, сектор, названия в английских заголовках, в русских
UNIVERSE = [
    ("AAPL", "Apple", TECH, ["Apple"], ["Apple", "Эппл"]),
    ("MSFT", "Microsoft", TECH, ["Microsoft"], ["Microsoft", "Майкрософт"]),
    ("NVDA", "Nvidia", TECH, ["Nvidia"], ["Nvidia", "Нвидиа", "Нвидия"]),
    ("AVGO", "Broadcom", TECH, ["Broadcom"], ["Broadcom", "Бродком"]),
    ("ORCL", "Oracle", TECH, ["Oracle"], ["Oracle", "Оракл"]),
    ("CRM", "Salesforce", TECH, ["Salesforce"], ["Salesforce"]),
    ("ADBE", "Adobe", TECH, ["Adobe"], ["Adobe"]),
    ("AMD", "AMD", TECH, ["AMD", "Advanced Micro Devices"], ["AMD"]),
    ("INTC", "Intel", TECH, ["Intel"], ["Intel", "Интел"]),
    ("CSCO", "Cisco", TECH, ["Cisco"], ["Cisco"]),
    ("IBM", "IBM", TECH, ["IBM"], ["IBM"]),
    ("QCOM", "Qualcomm", TECH, ["Qualcomm"], ["Qualcomm"]),
    ("TXN", "Texas Instruments", TECH, ["Texas Instruments"], ["Texas Instruments"]),
    ("ACN", "Accenture", TECH, ["Accenture"], ["Accenture"]),
    ("NOW", "ServiceNow", TECH, ["ServiceNow"], ["ServiceNow"]),
    ("INTU", "Intuit", TECH, ["Intuit"], ["Intuit"]),
    ("AMAT", "Applied Materials", TECH, ["Applied Materials"], ["Applied Materials"]),
    ("MU", "Micron", TECH, ["Micron"], ["Micron"]),
    ("LRCX", "Lam Research", TECH, ["Lam Research"], ["Lam Research"]),
    ("ADI", "Analog Devices", TECH, ["Analog Devices"], ["Analog Devices"]),
    ("PLTR", "Palantir", TECH, ["Palantir"], ["Palantir", "Палантир"]),
    ("GOOGL", "Alphabet", COMM, ["Alphabet", "Google"], ["Alphabet", "Google", "Гугл"]),
    ("META", "Meta", COMM, ["Meta Platforms", "Facebook", "Instagram"], ["Meta", "Facebook", "Фейсбук"]),
    ("NFLX", "Netflix", COMM, ["Netflix"], ["Netflix", "Нетфликс"]),
    ("DIS", "Disney", COMM, ["Disney"], ["Disney", "Дисней"]),
    ("CMCSA", "Comcast", COMM, ["Comcast"], ["Comcast"]),
    ("T", "AT&T", COMM, ["AT&T"], ["AT&T"]),
    ("VZ", "Verizon", COMM, ["Verizon"], ["Verizon"]),
    ("TMUS", "T-Mobile US", COMM, ["T-Mobile"], ["T-Mobile"]),
    ("AMZN", "Amazon", DISC, ["Amazon"], ["Amazon", "Амазон"]),
    ("TSLA", "Tesla", DISC, ["Tesla"], ["Tesla", "Тесла"]),
    ("HD", "Home Depot", DISC, ["Home Depot"], ["Home Depot"]),
    ("MCD", "McDonald's", DISC, ["McDonald's", "McDonalds"], ["McDonald's", "Макдоналдс"]),
    ("NKE", "Nike", DISC, ["Nike"], ["Nike", "Найк"]),
    ("SBUX", "Starbucks", DISC, ["Starbucks"], ["Starbucks", "Старбакс"]),
    ("LOW", "Lowe's", DISC, ["Lowe's"], ["Lowe's"]),
    ("BKNG", "Booking", DISC, ["Booking Holdings"], ["Booking"]),
    ("TJX", "TJX", DISC, ["TJX"], ["TJX"]),
    ("GM", "General Motors", DISC, ["General Motors"], ["General Motors", "Дженерал моторс"]),
    ("F", "Ford", DISC, ["Ford Motor"], ["Ford Motor"]),
    ("WMT", "Walmart", STAP, ["Walmart"], ["Walmart", "Walmart"]),
    ("PG", "Procter & Gamble", STAP, ["Procter & Gamble", "P&G"], ["Procter & Gamble"]),
    ("KO", "Coca-Cola", STAP, ["Coca-Cola"], ["Coca-Cola", "Кока-кола"]),
    ("PEP", "PepsiCo", STAP, ["PepsiCo"], ["PepsiCo"]),
    ("COST", "Costco", STAP, ["Costco"], ["Costco"]),
    ("PM", "Philip Morris", STAP, ["Philip Morris"], ["Philip Morris"]),
    ("MO", "Altria", STAP, ["Altria"], ["Altria"]),
    ("MDLZ", "Mondelez", STAP, ["Mondelez"], ["Mondelez"]),
    ("CL", "Colgate-Palmolive", STAP, ["Colgate"], ["Colgate"]),
    ("TGT", "Target", STAP, ["Target Corp"], []),
    ("LLY", "Eli Lilly", HLTH, ["Eli Lilly", "Lilly"], ["Eli Lilly", "Lilly"]),
    ("UNH", "UnitedHealth", HLTH, ["UnitedHealth"], ["UnitedHealth"]),
    ("JNJ", "Johnson & Johnson", HLTH, ["Johnson & Johnson", "J&J"], ["Johnson & Johnson"]),
    ("ABBV", "AbbVie", HLTH, ["AbbVie"], ["AbbVie"]),
    ("MRK", "Merck", HLTH, ["Merck"], ["Merck"]),
    ("PFE", "Pfizer", HLTH, ["Pfizer"], ["Pfizer", "Пфайзер"]),
    ("TMO", "Thermo Fisher", HLTH, ["Thermo Fisher"], ["Thermo Fisher"]),
    ("ABT", "Abbott", HLTH, ["Abbott Laboratories"], ["Abbott"]),
    ("DHR", "Danaher", HLTH, ["Danaher"], ["Danaher"]),
    ("AMGN", "Amgen", HLTH, ["Amgen"], ["Amgen"]),
    ("ISRG", "Intuitive Surgical", HLTH, ["Intuitive Surgical"], ["Intuitive Surgical"]),
    ("BMY", "Bristol-Myers Squibb", HLTH, ["Bristol-Myers", "Bristol Myers"], ["Bristol-Myers"]),
    ("GILD", "Gilead", HLTH, ["Gilead"], ["Gilead"]),
    ("MDT", "Medtronic", HLTH, ["Medtronic"], ["Medtronic"]),
    ("CVS", "CVS Health", HLTH, ["CVS Health"], ["CVS"]),
    ("BRK.B", "Berkshire Hathaway", FIN, ["Berkshire Hathaway", "Berkshire"], ["Berkshire", "Беркшир"]),
    ("JPM", "JPMorgan Chase", FIN, ["JPMorgan", "JP Morgan"], ["JPMorgan", "JP Morgan"]),
    ("V", "Visa", FIN, ["Visa Inc"], []),
    ("MA", "Mastercard", FIN, ["Mastercard"], ["Mastercard"]),
    ("BAC", "Bank of America", FIN, ["Bank of America", "BofA"], ["Bank of America"]),
    ("WFC", "Wells Fargo", FIN, ["Wells Fargo"], ["Wells Fargo"]),
    ("GS", "Goldman Sachs", FIN, ["Goldman Sachs", "Goldman"], ["Goldman Sachs", "Голдман"]),
    ("MS", "Morgan Stanley", FIN, ["Morgan Stanley"], ["Morgan Stanley"]),
    ("C", "Citigroup", FIN, ["Citigroup", "Citi"], ["Citigroup", "Citi"]),
    ("AXP", "American Express", FIN, ["American Express", "Amex"], ["American Express"]),
    ("BLK", "BlackRock", FIN, ["BlackRock"], ["BlackRock"]),
    ("SCHW", "Charles Schwab", FIN, ["Charles Schwab", "Schwab"], ["Schwab"]),
    ("SPGI", "S&P Global", FIN, ["S&P Global"], ["S&P Global"]),
    ("PYPL", "PayPal", FIN, ["PayPal"], ["PayPal"]),
    ("COF", "Capital One", FIN, ["Capital One"], ["Capital One"]),
    ("GE", "GE Aerospace", IND, ["GE Aerospace"], ["GE Aerospace"]),
    ("CAT", "Caterpillar", IND, ["Caterpillar"], ["Caterpillar"]),
    ("RTX", "RTX", IND, ["RTX", "Raytheon"], ["Raytheon"]),
    ("HON", "Honeywell", IND, ["Honeywell"], ["Honeywell"]),
    ("UNP", "Union Pacific", IND, ["Union Pacific"], ["Union Pacific"]),
    ("BA", "Boeing", IND, ["Boeing"], ["Boeing", "Боинг"]),
    ("LMT", "Lockheed Martin", IND, ["Lockheed"], ["Lockheed"]),
    ("DE", "Deere", IND, ["Deere"], ["Deere"]),
    ("UPS", "UPS", IND, ["UPS"], ["UPS"]),
    ("GD", "General Dynamics", IND, ["General Dynamics"], ["General Dynamics"]),
    ("MMM", "3M", IND, ["3M"], ["3M"]),
    ("FDX", "FedEx", IND, ["FedEx"], ["FedEx"]),
    ("UBER", "Uber", IND, ["Uber"], ["Uber"]),
    ("XOM", "Exxon Mobil", ENER, ["Exxon"], ["Exxon", "Эксон"]),
    ("CVX", "Chevron", ENER, ["Chevron"], ["Chevron", "Шеврон"]),
    ("COP", "ConocoPhillips", ENER, ["ConocoPhillips"], ["ConocoPhillips"]),
    ("NEE", "NextEra Energy", UTIL, ["NextEra"], ["NextEra"]),
    ("DUK", "Duke Energy", UTIL, ["Duke Energy"], ["Duke Energy"]),
    ("SO", "Southern Co", UTIL, ["Southern Co", "Southern Company"], []),
    ("AMT", "American Tower", REIT, ["American Tower"], ["American Tower"]),
    ("PLD", "Prologis", REIT, ["Prologis"], ["Prologis"]),
    ("SPG", "Simon Property", REIT, ["Simon Property"], ["Simon Property"]),
    ("LIN", "Linde", MAT, ["Linde"], ["Linde"]),
]

# Российские компании — только для привязки новостей к тикерам (котировки — с Мосбиржи в терминале)
MOEX_ALIASES = [
    ("MOEX:SBER", ["Sberbank"], ["Сбербанк", "Сбер"]),
    ("MOEX:GAZP", ["Gazprom"], ["Газпром"]),
    ("MOEX:LKOH", ["Lukoil"], ["Лукойл", "ЛУКОЙЛ"]),
    ("MOEX:ROSN", ["Rosneft"], ["Роснефть"]),
    ("MOEX:NVTK", ["Novatek"], ["Новатэк", "НОВАТЭК"]),
    ("MOEX:GMKN", ["Nornickel", "Norilsk Nickel"], ["Норникель", "Норильский никель"]),
    ("MOEX:YDEX", ["Yandex"], ["Яндекс"]),
    ("MOEX:VTBR", ["VTB"], ["ВТБ"]),
    ("MOEX:TATN", ["Tatneft"], ["Татнефть"]),
    ("MOEX:PLZL", ["Polyus"], ["Полюс"]),
    ("MOEX:MGNT", ["Magnit"], ["Магнит"]),
    ("MOEX:MTSS", ["MTS"], ["МТС"]),
    ("MOEX:AFLT", ["Aeroflot"], ["Аэрофлот"]),
    ("MOEX:CHMF", ["Severstal"], ["Северсталь"]),
    ("MOEX:NLMK", ["NLMK"], ["НЛМК"]),
    ("MOEX:ALRS", ["Alrosa"], ["Алроса", "АЛРОСА"]),
    ("MOEX:OZON", ["Ozon"], ["Озон", "Ozon"]),
]

BY_TICKER = {t: {"s": t, "n": n, "sec": s} for t, n, s, _, _ in UNIVERSE}


def yahoo_sym(t):
    return t.replace(".", "-")


def _get(url, headers=None, timeout=20):
    h = {"User-Agent": UA, "Accept": "*/*"}
    h.update(headers or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        return r.read()


def _json(url, headers=None, timeout=20):
    return json.loads(_get(url, headers, timeout).decode("utf-8"))


def _num(x, nd=None):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if v != v or v in (float("inf"), float("-inf")):
        return None
    return round(v, nd) if nd is not None else v


# ---------------------------------------------------------------------------
# Привязка новостей к компаниям
# ---------------------------------------------------------------------------
def _alias_rx(names, cyr):
    parts = []
    for n in names:
        esc = re.escape(n).replace(r"\ ", r"\s+")
        if cyr:
            # русские падежные окончания: «Сбербанка», «Теслы», «Яндексу», «Норникеля»
            base = re.sub(r"[аяь]$", "", n) if re.search(r"[а-яё]$", n) else n
            esc = re.escape(base).replace(r"\ ", r"\s+")
            parts.append(esc + r"(?:а|я|у|ю|е|ы|и|ь|ой|ей|ом|ем|ам|ям|ах|ях|ами|ями|ов|ев)?")
        else:
            parts.append(esc + r"(?:'s|’s)?")
    if not parts:
        return None
    letter = r"A-Za-zА-Яа-яЁё0-9"
    return re.compile(r"(?<![" + letter + r"&])(?:" + "|".join(parts) + r")(?![" + letter + r"&])")


_ALIAS = None


def _aliases():
    global _ALIAS
    if _ALIAS is None:
        _ALIAS = []
        for t, _, _, en, ru in UNIVERSE:
            _ALIAS.append((t, _alias_rx(en, False), _alias_rx(ru, True)))
        for t, en, ru in MOEX_ALIASES:
            _ALIAS.append((t, _alias_rx(en, False), _alias_rx(ru, True)))
    return _ALIAS


_DOLLAR = re.compile(r"(?:\$|\b(?:NYSE|NASDAQ|Nasdaq)\s*:\s*)([A-Z]{1,5}(?:\.[AB])?)\b")

UP_WORDS = re.compile(r"\b(surge[sd]?|soar(s|ed)?|jump(s|ed)?|rall(y|ies|ied)|beat(s)?|record high|upgrade[sd]?|raise[sd]? (its )?(guidance|forecast|outlook)|"
                      r"climb(s|ed)?|gain(s|ed)?|tops? estimates|buyback)\b|"
                      r"(взлет|взлёт|вырос|выросл|растут|подорожал|рекорд|превзош|повысил[аи]? прогноз|обратный выкуп)", re.I)
DOWN_WORDS = re.compile(r"\b(plunge[sd]?|slump(s|ed)?|tumble[sd]?|sink(s)?|sank|fall(s)?|fell|drop(s|ped)?|miss(es|ed)?|downgrade[sd]?|"
                        r"cut[s]? (its )?(guidance|forecast|outlook)|recall(s|ed)?|probe|lawsuit|sued|layoffs?|job cuts|fine[sd]?|antitrust)\b|"
                        r"(обвал|упал|упали|подешевел|снизил|снижен|падени|понизил[аи]? прогноз|отзыв|иск |штраф|сокращени|расследовани)", re.I)


def tickers_in(*texts, limit=3):
    """Тикеры компаний, упомянутых в заголовке/выжимке (английских и русских)."""
    text = " ".join(t for t in texts if t)
    if not text:
        return []
    found = []
    for m in _DOLLAR.finditer(text):
        t = m.group(1)
        if t in BY_TICKER and t not in found:
            found.append(t)
    for t, rx_en, rx_ru in _aliases():
        if t in found:
            continue
        if (rx_en and rx_en.search(text)) or (rx_ru and rx_ru.search(text)):
            found.append(t)
        if len(found) >= limit:
            break
    return found[:limit]


def direction(*texts):
    """Грубая оценка влияния новости на упомянутую компанию: 1 — позитив, -1 — негатив, 0 — неясно."""
    text = " ".join(t for t in texts if t)
    up, down = len(UP_WORDS.findall(text)), len(DOWN_WORDS.findall(text))
    return 1 if up > down else -1 if down > up else 0


# ---------------------------------------------------------------------------
# Цены: Yahoo, пачками
# ---------------------------------------------------------------------------
def parse_spark(payload):
    out = {}
    for res in ((payload or {}).get("spark") or {}).get("result") or []:
        try:
            meta = res["response"][0]["meta"]
        except (KeyError, IndexError, TypeError):
            continue
        sym = (res.get("symbol") or meta.get("symbol") or "").replace("-", ".")
        px = _num(meta.get("regularMarketPrice"))
        if not sym or px is None:
            continue
        prev = _num(meta.get("previousClose")) or _num(meta.get("chartPreviousClose"))
        ch = _num(meta.get("regularMarketChangePercent"))
        if ch is None and prev:
            ch = (px / prev - 1) * 100
        out[sym] = {"px": round(px, 4), "ch": _num(ch, 3), "h52": _num(meta.get("fiftyTwoWeekHigh"), 4),
                    "l52": _num(meta.get("fiftyTwoWeekLow"), 4), "vol": _num(meta.get("regularMarketVolume")),
                    "t": meta.get("regularMarketTime")}
    return out


def fetch_prices(tickers):
    batches = [tickers[i:i + 20] for i in range(0, len(tickers), 20)]

    def one(b):
        try:
            url = SPARK_URL.format(syms=urllib.parse.quote(",".join(yahoo_sym(t) for t in b), safe=","))
            return parse_spark(_json(url))
        except Exception as e:
            print(f"  ! цены Yahoo ({b[0]}…): {type(e).__name__}: {e}"[:200])
            return {}
    out = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        for part in ex.map(one, batches):
            out.update(part)
    return out


# ---------------------------------------------------------------------------
# Мультипликаторы и календарь отчётов: Finnhub
# ---------------------------------------------------------------------------
METRIC_MAP = {
    "mcap": "marketCapitalization", "pe": "peTTM", "fpe": "forwardPE", "ps": "psTTM", "pb": "pbQuarterly",
    "dy": "dividendYieldIndicatedAnnual", "beta": "beta", "epsg": "epsGrowthTTMYoy", "revg": "revenueGrowthTTMYoy",
    "roe": "roeTTM", "nm": "netProfitMarginTTM", "gm": "grossMarginTTM", "de": "totalDebt/totalEquityQuarterly",
    "r5d": "5DayPriceReturnDaily", "r13w": "13WeekPriceReturnDaily", "r52": "52WeekPriceReturnDaily",
    "rytd": "yearToDatePriceReturnDaily", "eps": "epsTTM",
}


def parse_metric(payload):
    m = (payload or {}).get("metric") or {}
    out = {k: _num(m.get(src), 3) for k, src in METRIC_MAP.items()}
    if out.get("pe") is None:
        out["pe"] = _num(m.get("peBasicExclExtraTTM"), 3)
    return {k: v for k, v in out.items() if v is not None}


def fetch_metric(t, key):
    return parse_metric(_json(f"{FH_URL}/stock/metric?symbol={urllib.parse.quote(t)}&metric=all&token={key}"))


def parse_earnings_calendar(payload, tickers):
    out = []
    for e in (payload or {}).get("earningsCalendar") or []:
        s = e.get("symbol")
        if s not in tickers:
            continue
        out.append({"s": s, "n": BY_TICKER[s]["n"], "d": e.get("date"), "h": e.get("hour") or "",
                    "q": e.get("quarter"), "y": e.get("year"),
                    "eps_e": _num(e.get("epsEstimate"), 4), "eps_a": _num(e.get("epsActual"), 4),
                    "rev_e": _num(e.get("revenueEstimate"), 0), "rev_a": _num(e.get("revenueActual"), 0)})
    out.sort(key=lambda x: (x["d"] or "", {"bmo": 0, "amc": 2}.get(x["h"], 1), -(x["rev_e"] or 0)))
    return out


def fetch_earnings(key, today):
    frm, to = (today - timedelta(days=7)).isoformat(), (today + timedelta(days=21)).isoformat()
    data = _json(f"{FH_URL}/calendar/earnings?from={frm}&to={to}&token={key}", timeout=30)
    return parse_earnings_calendar(data, set(BY_TICKER))


# ---------------------------------------------------------------------------
# Отчётность из SEC (XBRL): выручка, прибыль, денежный поток, долг
# ---------------------------------------------------------------------------
CONCEPTS = {
    "rev": ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
            "RevenuesNetOfInterestExpense", "RevenueFromContractWithCustomerIncludingAssessedTax"],
    "gp": ["GrossProfit"],
    "op": ["OperatingIncomeLoss"],
    "ni": ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
    "eps": ["EarningsPerShareDiluted", "EarningsPerShareBasic"],
    "ocf": ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
}
BALANCE = {
    "cash": ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
    "debt": ["LongTermDebt", "LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations"],
    "eq": ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    "assets": ["Assets"],
}
CASHFLOW = ("ocf", "capex")   # в отчётах накопительным итогом с начала года


def _days(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def _pick_units(concept):
    units = concept.get("units") or {}
    for u in ("USD", "USD/shares"):
        if u in units:
            return units[u]
    return next(iter(units.values()), [])


def _latest_concept(gaap, names):
    """Из нескольких вариантов показателя берём тот, где данные свежее."""
    best, best_end = None, ""
    for n in names:
        c = gaap.get(n)
        if not c:
            continue
        facts = _pick_units(c)
        end = max((f.get("end") or "" for f in facts), default="")
        if end > best_end:
            best, best_end = facts, end
    return best or []


def _dedupe(facts):
    """Один факт на период (start, end): последняя по дате подачи редакция."""
    by = {}
    for f in facts:
        if f.get("val") is None or not f.get("end"):
            continue
        k = (f.get("start"), f["end"])
        if k not in by or (f.get("filed") or "") >= (by[k].get("filed") or ""):
            by[k] = f
    return by


def _flows(facts, cumulative=False):
    """Годовые значения и значения за квартал (3 мес.) из фактов с периодом start..end."""
    by = _dedupe(facts)
    annual, quarter, groups = {}, {}, {}
    for (start, end), f in by.items():
        if not start:
            continue
        d = _days(start, end)
        if 350 <= d <= 380:
            annual[end] = f["val"]
        if 80 <= d <= 100:
            quarter[end] = f["val"]
        if cumulative:
            groups.setdefault(start, []).append((end, f["val"], d))
    if cumulative:
        # денежный поток: квартал = нарастающий итог минус предыдущий нарастающий итог того же года
        for lst in groups.values():
            lst.sort()
            prev = None
            for end, v, d in lst:
                if prev is not None and end not in quarter and 80 <= d - prev[2] <= 100:
                    quarter[end] = v - prev[1]
                prev = (end, v, d)
    # четвёртый квартал = год минус три квартала
    for end, total in annual.items():
        if end in quarter:
            continue
        e = date.fromisoformat(end)
        qs = [v for qe, v in quarter.items() if e - timedelta(days=370) < date.fromisoformat(qe) < e - timedelta(days=20)]
        if len(qs) == 3:
            quarter[end] = total - sum(qs)
    return annual, quarter


def _instants(facts):
    by = {}
    for f in facts:
        if f.get("val") is None or not f.get("end") or f.get("start"):
            continue
        if f["end"] not in by or (f.get("filed") or "") >= (by[f["end"]].get("filed") or ""):
            by[f["end"]] = f
    return {e: f["val"] for e, f in by.items()}


def financials_from_facts(facts, years=5, quarters=8):
    """Компактная отчётность для FA из companyfacts SEC."""
    gaap = ((facts or {}).get("facts") or {}).get("us-gaap") or {}
    ann, qtr = {}, {}
    for key, names in CONCEPTS.items():
        a, q = _flows(_latest_concept(gaap, names), cumulative=key in CASHFLOW)
        for end, v in a.items():
            ann.setdefault(end, {})[key] = v
        for end, v in q.items():
            qtr.setdefault(end, {})[key] = v
    for key, names in BALANCE.items():
        inst = _instants(_latest_concept(gaap, names))
        for table in (ann, qtr):
            for end in table:
                if end in inst:
                    table[end][key] = inst[end]

    def finish(table, n):
        rows = []
        for end in sorted(table, reverse=True):
            r = table[end]
            if r.get("rev") is None and r.get("ni") is None:
                continue
            if r.get("ocf") is not None and r.get("capex") is not None:
                r["fcf"] = r["ocf"] - abs(r["capex"])
            rows.append({"end": end, **{k: (round(v, 4) if k == "eps" else round(v)) for k, v in r.items() if v is not None}})
            if len(rows) >= n:
                break
        return rows
    return {"annual": finish(ann, years), "quarterly": finish(qtr, quarters),
            "name": (facts or {}).get("entityName", "")}


_CIK = {}


def cik_for(t, sec_headers):
    global _CIK
    if not _CIK:
        data = _json(SEC_TICKERS_URL, sec_headers, timeout=30)
        _CIK = {v["ticker"].upper(): int(v["cik_str"]) for v in data.values()}
    return _CIK.get(t.upper()) or _CIK.get(t.upper().replace(".", "-"))


def sec_headers():
    ua = os.environ.get("SEC_USER_AGENT", "").strip() or "EconNews bot econnews@users.noreply.github.com"
    return {"User-Agent": ua, "Accept-Encoding": "identity"}


def update_financials(tickers, now, limit=4, max_age_days=7):
    """Обновить отчётность нескольких компаний (самых давно обновлённых) — понемногу каждый запуск."""
    os.makedirs(FIN_DIR, exist_ok=True)
    ages = []
    for t in tickers:
        path = os.path.join(FIN_DIR, t + ".json")
        try:
            with open(path, encoding="utf-8") as f:
                upd = json.load(f).get("updated", "")
        except (FileNotFoundError, ValueError):
            upd = ""
        ages.append((upd, t))
    ages.sort()
    cutoff = (now - timedelta(days=max_age_days)).isoformat()
    todo = [t for upd, t in ages if upd < cutoff][:limit]
    h = sec_headers()
    done = 0
    for t in todo:
        try:
            cik = cik_for(t, h)
            if not cik:
                continue
            fin = financials_from_facts(_json(SEC_FACTS_URL.format(cik=cik), h, timeout=60))
            fin.update({"s": t, "cik": cik, "updated": now.isoformat()})
            with open(os.path.join(FIN_DIR, t + ".json"), "w", encoding="utf-8") as f:
                json.dump(fin, f, ensure_ascii=False, separators=(",", ":"))
            done += 1
            time.sleep(0.2)   # SEC просит не больше 10 запросов в секунду
        except Exception as e:
            print(f"  ! отчётность {t}: {type(e).__name__}: {e}"[:200])
    return done


# ---------------------------------------------------------------------------
# Сборка docs/stocks.json
# ---------------------------------------------------------------------------
def load_previous(path=STOCKS_FILE):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return {}


def sectors_summary(rows):
    by = {}
    for r in rows:
        if r.get("ch") is None:
            continue
        w = r.get("mcap") or 1
        s = by.setdefault(r["sec"], {"sec": r["sec"], "w": 0.0, "x": 0.0, "n": 0, "mcap": 0.0})
        s["w"] += w
        s["x"] += w * r["ch"]
        s["n"] += 1
        s["mcap"] += r.get("mcap") or 0
    out = [{"sec": s["sec"], "ch": round(s["x"] / s["w"], 3) if s["w"] else None, "n": s["n"], "mcap": round(s["mcap"])}
           for s in by.values()]
    out.sort(key=lambda s: -s["mcap"])
    return out


def build(now=None, key=None, metric_limit=12, metric_max_age_h=20, fin_limit=4, sleep=1.1, path=STOCKS_FILE):
    """Обновляет docs/stocks.json. Возвращает словарь с данными (или None, если ничего не получилось)."""
    now = now or datetime.now(timezone.utc)
    key = key if key is not None else os.environ.get("FINNHUB_API_KEY", "").strip()
    prev = load_previous(path)
    prev_rows = {r["s"]: r for r in prev.get("stocks") or []}
    tickers = [t for t, *_ in UNIVERSE]

    prices = fetch_prices(tickers)
    rows = []
    for t, n, sec, _, _ in UNIVERSE:
        r = {"s": t, "n": n, "sec": sec}
        old = prev_rows.get(t) or {}
        for k, v in old.items():
            if k not in ("s", "n", "sec"):
                r[k] = v
        if t in prices:
            r.update({k: v for k, v in prices[t].items() if v is not None and k != "t"})
            r["pt"] = now.isoformat()
        rows.append(r)

    # мультипликаторы — понемногу, самые старые первыми (лимит Finnhub: 60 запросов в минуту)
    n_metrics = 0
    if key:
        cutoff = (now - timedelta(hours=metric_max_age_h)).isoformat()
        stale = sorted((r.get("mu", ""), r["s"]) for r in rows if r.get("mu", "") < cutoff)
        by = {r["s"]: r for r in rows}
        for _, t in stale[:metric_limit]:
            try:
                m = fetch_metric(t, key)
                if m:
                    by[t].update(m)
                    by[t]["mu"] = now.isoformat()
                    if m.get("mcap") and by[t].get("px"):
                        # капитализация взята при этой цене — дальше двигаем её вместе с ценой
                        by[t]["mcap0"], by[t]["mpx"] = m["mcap"], by[t]["px"]
                    n_metrics += 1
            except Exception as e:
                print(f"  ! мультипликаторы {t}: {type(e).__name__}: {e}"[:200])
                if "429" in str(e):
                    break
            time.sleep(sleep)

    # капитализация (млн $) двигается вместе с ценой
    for r in rows:
        if r.get("mcap0") and r.get("px") and r.get("mpx"):
            r["mcap"] = round(r["mcap0"] * r["px"] / r["mpx"], 1)

    earnings = prev.get("earnings") or []
    e_upd = prev.get("earnings_updated", "")
    if key and e_upd < (now - timedelta(hours=3)).isoformat():
        try:
            earnings = fetch_earnings(key, now.date())
            e_upd = now.isoformat()
        except Exception as e:
            print(f"  ! календарь отчётов: {type(e).__name__}: {e}"[:200])

    if not prices and not prev:
        return None
    data = {"updated": now.isoformat(), "stocks": rows, "sectors": sectors_summary(rows),
            "earnings": earnings, "earnings_updated": e_upd,
            "prices_ok": len(prices), "metrics_updated": n_metrics}
    if os.path.isdir(os.path.dirname(path)):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    try:
        update_financials(tickers, now, limit=fin_limit)
    except Exception as e:
        print(f"  ! отчётность SEC: {type(e).__name__}: {e}"[:200])
    return data


if __name__ == "__main__":
    d = build()
    print("stocks:", d and len(d["stocks"]), "prices:", d and d["prices_ok"], "metrics:", d and d["metrics_updated"])
