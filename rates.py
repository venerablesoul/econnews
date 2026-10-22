"""
Bonds and rates for the terminal (GC, CB, WIRP) and the bot commands /rates /cb /wirp — all free, official sources.
Облигации и ставки для терминала (GC, CB, WIRP) и команд бота /rates /cb /wirp.

Результат — docs/rates.json. Всё из бесплатных официальных источников без ключей:
  Кривые доходности: Минфин США (Treasury), Бундесбанк (Германия; запасной — ЕЦБ, AAA еврозоны),
                     Банк Англии, Минфин Японии, Мосбиржа (кривая ОФЗ)
  Ставки центробанков: BIS (Банк международных расчётов) + свежие данные ФРБ Нью-Йорка и ЦБ РФ
  WIRP (ожидания по ставке ФРС): фьючерсы на ставку по федеральным фондам (Yahoo) + календарь заседаний ФРС
"""
from __future__ import annotations

import calendar
import csv
import io
import json
import os
import re
import urllib.request
from datetime import date, datetime, timedelta, timezone

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
HERE = os.path.dirname(os.path.abspath(__file__))
RATES_FILE = os.path.join(HERE, "docs", "rates.json")

UST_URL = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/"
           "{y}/all?type=daily_treasury_yield_curve&field_tdr_date_value={y}&page&_format=csv")
BBK_URL = ("https://api.statistiken.bundesbank.de/rest/data/BBSIS/D.I.ZAR.ZI.EUR.S1311.B.A604.{t}.R.A.A._Z._Z.A"
           "?lastNObservations=30&format=csv")
ECB_URL = ("https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.{t}"
           "?lastNObservations=30&format=csvdata")
BOE_URL = ("https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom={frm}"
           "&Dateto=now&SeriesCodes=IUDSNZC,IUDMNZC,IUDLNZC&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N")
MOF_URL = "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/jgbcme.csv"
MOEX_URL = "https://iss.moex.com/iss/engines/stock/zcyc.json?iss.meta=off&iss.only=yearyields"
BIS_URL = "https://stats.bis.org/api/v1/data/WS_CBPOL/D.{c}/all?lastNObservations={n}&format=csv"
EFFR_URL = "https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json"
FOMC_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
CBR_URL = "https://www.cbr.ru/hd_base/KeyRate/?UniDbQuery.Posted=True&UniDbQuery.From={frm}&UniDbQuery.To={to}"
ZQ_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=5d&interval=1d"
# more curves for WB: Bank of Canada (Valet API), Reserve Bank of Australia (table F2)
BOC_URL = ("https://www.bankofcanada.ca/valet/observations/BD.CDN.2YR.DQ.YLD,BD.CDN.5YR.DQ.YLD,BD.CDN.10YR.DQ.YLD,"
           "BD.CDN.LONG.DQ.YLD/json?recent=40")
RBA_URL = "https://www.rba.gov.au/statistics/tables/csv/f2-data.csv"
# money-market rates (MMR): New York Fed, ECB, Bank of England, Bank of Russia, Moscow Exchange
NYFED_URL = "https://markets.newyorkfed.org/api/rates/{kind}/{k}/last/2.json"
ESTR_URL = "https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT?lastNObservations=3&format=csvdata"
SONIA_URL = ("https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom={frm}"
             "&Dateto=now&SeriesCodes=IUDSOIA&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N")
RUONIA_URL = "https://www.cbr.ru/hd_base/ruonia/dynamics/?UniDbQuery.Posted=True&UniDbQuery.From={frm}&UniDbQuery.To={to}"
RUSFAR_URL = ("https://iss.moex.com/iss/engines/stock/markets/index/securities/RUSFAR.json?iss.meta=off&iss.only=marketdata"
              "&marketdata.columns=SECID,CURRENTVALUE,LASTVALUE,TRADEDATE")

MONTH_CODES = "FGHJKMNQUVXZ"


def _get(url, timeout=30):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"}), timeout=timeout) as r:
        return r.read()


def _f(x):
    try:
        v = float(str(x).replace(",", ".").strip())
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def tenor_years(t):
    t = t.strip().upper()
    m = re.match(r"([\d.]+)\s*(M|MO|MONTH|Y|YR|YEAR)", t)
    if not m:
        return None
    v = float(m.group(1))
    return v / 12 if m.group(2).startswith("M") else v


def curve_from_rows(rows, labels):
    """rows: [(date, {label: value})] по возрастанию даты → текущая кривая и кривые неделю и месяц назад."""
    rows = [(d, v) for d, v in rows if any(v.get(l) is not None for l in labels)]
    if not rows:
        return None
    rows.sort(key=lambda x: x[0])
    last_d, last = rows[-1]

    def back(days):
        target = last_d - timedelta(days=days)
        cand = [(d, v) for d, v in rows if d <= target]
        return cand[-1] if cand else (None, None)
    wd, w = back(7)
    md, m = back(28)
    keep = [l for l in labels if last.get(l) is not None]
    return {"date": last_d.isoformat(), "t": keep, "x": [round(tenor_years(l), 4) for l in keep],
            "y": [round(last[l], 4) for l in keep],
            "w": [round(w[l], 4) if w and w.get(l) is not None else None for l in keep] if w else None,
            "wd": wd.isoformat() if wd else None,
            "m": [round(m[l], 4) if m and m.get(l) is not None else None for l in keep] if m else None,
            "md": md.isoformat() if md else None}


# ---------------------------------------------------------------------------
# Кривые
# ---------------------------------------------------------------------------
UST_COLS = [("1 Mo", "1M"), ("2 Mo", "2M"), ("3 Mo", "3M"), ("6 Mo", "6M"), ("1 Yr", "1Y"), ("2 Yr", "2Y"),
            ("3 Yr", "3Y"), ("5 Yr", "5Y"), ("7 Yr", "7Y"), ("10 Yr", "10Y"), ("20 Yr", "20Y"), ("30 Yr", "30Y")]


def parse_ust(text):
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        try:
            d = datetime.strptime(r["Date"], "%m/%d/%Y").date()
        except (KeyError, ValueError):
            continue
        rows.append((d, {lbl: _f(r.get(col)) for col, lbl in UST_COLS}))
    return rows


def us_curve(today):
    rows = parse_ust(_get(UST_URL.format(y=today.year)).decode("utf-8", "replace"))
    if len(rows) < 25:   # начало года: добавим прошлый год для сравнения «месяц назад»
        rows += parse_ust(_get(UST_URL.format(y=today.year - 1)).decode("utf-8", "replace"))
    return curve_from_rows(rows, [l for _, l in UST_COLS])


BBK_TENORS = [("R01XX", "1Y"), ("R02XX", "2Y"), ("R03XX", "3Y"), ("R05XX", "5Y"), ("R07XX", "7Y"),
              ("R10XX", "10Y"), ("R15XX", "15Y"), ("R20XX", "20Y"), ("R30XX", "30Y")]


def parse_bbk(text):
    """CSV Бундесбанка: строка заголовка с кодами рядов, затем «дата;значение;флаг;…» (запятая — десятичная)."""
    lines = text.lstrip("﻿").splitlines()
    head = next((l for l in lines if "BBSIS" in l), "")
    cols = [c.strip('"') for c in head.split(";")]
    idx = {}
    for i, c in enumerate(cols):
        for code, lbl in BBK_TENORS:
            if "." + code + "." in c and not c.endswith("_FLAGS"):
                idx[i] = lbl
    rows = []
    for l in lines:
        parts = l.split(";")
        if not re.match(r"\d{4}-\d\d-\d\d$", parts[0].strip()):
            continue
        d = date.fromisoformat(parts[0].strip())
        rows.append((d, {lbl: _f(parts[i]) if i < len(parts) else None for i, lbl in idx.items()}))
    return rows


def de_curve(today):
    t = "+".join(code for code, _ in BBK_TENORS)
    rows = parse_bbk(_get(BBK_URL.format(t=t)).decode("utf-8", "replace"))
    return curve_from_rows(rows, [l for _, l in BBK_TENORS])


ECB_TENORS = [("SR_3M", "3M"), ("SR_6M", "6M"), ("SR_1Y", "1Y"), ("SR_2Y", "2Y"), ("SR_3Y", "3Y"), ("SR_5Y", "5Y"),
              ("SR_7Y", "7Y"), ("SR_10Y", "10Y"), ("SR_20Y", "20Y"), ("SR_30Y", "30Y")]


def parse_ecb(text):
    by = {}
    lab = dict(ECB_TENORS)
    for r in csv.DictReader(io.StringIO(text)):
        key = (r.get("KEY") or "").split(".")[-1]
        if key not in lab:
            continue
        try:
            d = date.fromisoformat(r["TIME_PERIOD"])
        except (KeyError, ValueError):
            continue
        by.setdefault(d, {})[lab[key]] = _f(r.get("OBS_VALUE"))
    return sorted(by.items())


def ea_curve(today):
    t = "+".join(code for code, _ in ECB_TENORS)
    return curve_from_rows(parse_ecb(_get(ECB_URL.format(t=t)).decode("utf-8", "replace")), [l for _, l in ECB_TENORS])


BOE_COLS = [("IUDSNZC", "5Y"), ("IUDMNZC", "10Y"), ("IUDLNZC", "20Y")]


def parse_boe(text):
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        try:
            d = datetime.strptime(r["DATE"].strip(), "%d %b %Y").date()
        except (KeyError, ValueError):
            continue
        rows.append((d, {lbl: _f(r.get(col)) for col, lbl in BOE_COLS}))
    return rows


def uk_curve(today):
    frm = (today - timedelta(days=45)).strftime("%d/%b/%Y")
    return curve_from_rows(parse_boe(_get(BOE_URL.format(frm=frm)).decode("utf-8", "replace")), [l for _, l in BOE_COLS])


def parse_mof(text):
    lines = [l for l in text.splitlines() if l.strip()]
    head_i = next((i for i, l in enumerate(lines) if l.startswith("Date,")), None)
    if head_i is None:
        return [], []
    labels = [c.strip() for c in lines[head_i].split(",")[1:] if c.strip()]
    rows = []
    for l in lines[head_i + 1:]:
        parts = l.split(",")
        try:
            d = datetime.strptime(parts[0].strip(), "%Y/%m/%d").date()
        except ValueError:
            continue
        rows.append((d, {lbl: _f(parts[i + 1]) if i + 1 < len(parts) else None for i, lbl in enumerate(labels)}))
    return rows, labels


def jp_curve(today):
    rows, labels = parse_mof(_get(MOF_URL).decode("utf-8", "replace"))
    want = [l for l in ("1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y", "40Y") if l in labels]
    return curve_from_rows(rows, want)


def parse_moex(payload):
    t = (payload or {}).get("yearyields") or {}
    cols = t.get("columns") or []
    if not cols:
        return None
    i_d, i_p, i_v = cols.index("tradedate"), cols.index("period"), cols.index("value")
    pts = {}
    d = None
    for row in t.get("data") or []:
        d = row[i_d]
        p, v = _f(row[i_p]), _f(row[i_v])
        if p is not None and v is not None:
            pts[p] = v
    return d, pts


def ru_curve(today):
    d, pts = parse_moex(json.loads(_get(MOEX_URL)))
    want = [(0.25, "3M"), (0.5, "6M"), (1, "1Y"), (2, "2Y"), (3, "3Y"), (5, "5Y"), (7, "7Y"), (10, "10Y"), (15, "15Y"), (20, "20Y")]
    keep = [(p, l) for p, l in want if p in pts]
    if not keep:
        return None
    return {"date": d, "t": [l for _, l in keep], "x": [p for p, _ in keep], "y": [round(pts[p], 4) for p, _ in keep],
            "w": None, "m": None, "wd": None, "md": None}


def parse_boc(payload):
    """Bank of Canada Valet: {observations: [{d: date, SERIES: {v: "2.61"}}]} → rows for curve_from_rows."""
    names = {"BD.CDN.2YR.DQ.YLD": "2Y", "BD.CDN.5YR.DQ.YLD": "5Y", "BD.CDN.10YR.DQ.YLD": "10Y", "BD.CDN.LONG.DQ.YLD": "30Y"}
    rows = []
    for o in (payload or {}).get("observations") or []:
        try:
            d = datetime.strptime(o["d"], "%Y-%m-%d").date()
        except (KeyError, ValueError):
            continue
        rows.append((d, {lbl: _f((o.get(code) or {}).get("v")) for code, lbl in names.items()}))
    return rows


def ca_curve(today):
    return curve_from_rows(parse_boc(json.loads(_get(BOC_URL))), ["2Y", "5Y", "10Y", "30Y"])


def parse_rba(text):
    """RBA table F2: a header block, a "Series ID" line, then "16-Oct-2026,3.51,3.62,3.88,4.31,1.95"."""
    rows, started = [], False
    for line in text.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if parts and parts[0] == "Series ID":
            started = True
            continue
        if not started or len(parts) < 5:
            continue
        try:
            d = datetime.strptime(parts[0], "%d-%b-%Y").date()
        except ValueError:
            continue
        rows.append((d, {"2Y": _f(parts[1]), "3Y": _f(parts[2]), "5Y": _f(parts[3]), "10Y": _f(parts[4])}))
    return rows


def au_curve(today):
    rows = parse_rba(_get(RBA_URL, timeout=60).decode("utf-8-sig", "replace"))
    return curve_from_rows(rows[-60:], ["2Y", "3Y", "5Y", "10Y"])


# code, (English name, Russian name), flag, loader, fallback (code, names, loader)
CURVES = [
    ("US", ("United States", "США"), "🇺🇸", us_curve, None),
    ("DE", ("Germany", "Германия"), "🇩🇪", de_curve, ("EA", ("Euro area (AAA)", "Еврозона (AAA)"), ea_curve)),
    ("UK", ("United Kingdom", "Великобритания"), "🇬🇧", uk_curve, None),
    ("JP", ("Japan", "Япония"), "🇯🇵", jp_curve, None),
    ("RU", ("Russia (OFZ)", "Россия (ОФЗ)"), "🇷🇺", ru_curve, None),
    ("CA", ("Canada", "Канада"), "🇨🇦", ca_curve, None),
    ("AU", ("Australia", "Австралия"), "🇦🇺", au_curve, None),
]


# ---------------------------------------------------------------------------
# Ставки центробанков
# ---------------------------------------------------------------------------
CB = [("US", ("Federal Reserve", "ФРС США"), "🇺🇸"), ("XM", ("ECB", "ЕЦБ"), "🇪🇺"),
      ("GB", ("Bank of England", "Банк Англии"), "🇬🇧"), ("JP", ("Bank of Japan", "Банк Японии"), "🇯🇵"),
      ("CN", ("People's Bank of China", "Народный банк Китая"), "🇨🇳"), ("CH", ("Swiss National Bank", "Нацбанк Швейцарии"), "🇨🇭"),
      ("CA", ("Bank of Canada", "Банк Канады"), "🇨🇦"), ("AU", ("Reserve Bank of Australia", "Резервный банк Австралии"), "🇦🇺"),
      ("IN", ("Reserve Bank of India", "Резервный банк Индии"), "🇮🇳"), ("BR", ("Central Bank of Brazil", "ЦБ Бразилии"), "🇧🇷"),
      ("TR", ("Central Bank of Türkiye", "ЦБ Турции"), "🇹🇷"), ("KR", ("Bank of Korea", "Банк Кореи"), "🇰🇷"),
      ("MX", ("Bank of Mexico", "Банк Мексики"), "🇲🇽"), ("ZA", ("South African Reserve Bank", "Резервный банк ЮАР"), "🇿🇦"),
      ("RU", ("Bank of Russia", "ЦБ РФ"), "🇷🇺")]


def parse_bis(text):
    series = {}
    for r in csv.DictReader(io.StringIO(text)):
        c, d, v = r.get("REF_AREA"), r.get("TIME_PERIOD"), _f(r.get("OBS_VALUE"))
        if c and d and v is not None:
            series.setdefault(c, []).append((d, v))
    out = {}
    for c, obs in series.items():
        obs.sort()
        d_last, v_last = obs[-1]
        since, prev = None, None
        for d, v in reversed(obs):
            if abs(v - v_last) > 1e-9:
                prev = v
                break
            since = d
        out[c] = {"rate": v_last, "date": d_last, "since": since if prev is not None else None, "prev": prev}
    return out


def parse_cbr(html_text):
    rows = re.findall(r"<td>(\d\d\.\d\d\.\d{4})</td>\s*<td>([\d,]+)</td>", html_text)
    obs = sorted((datetime.strptime(d, "%d.%m.%Y").date().isoformat(), _f(v)) for d, v in rows)
    if not obs:
        return None
    d_last, v_last = obs[-1]
    since, prev = None, None
    for d, v in reversed(obs):
        if abs(v - v_last) > 1e-9:
            prev = v
            break
        since = d
    return {"rate": v_last, "date": d_last, "since": since if prev is not None else None, "prev": prev}


def cb_rates(today):
    codes = "+".join(c for c, _, _ in CB)
    data = parse_bis(_get(BIS_URL.format(c=codes, n=600), timeout=60).decode("utf-8", "replace"))
    # свежие источники поверх BIS (там данные обновляются раз в неделю)
    try:
        ref = json.loads(_get(EFFR_URL))["refRates"][0]
        lo, hi = _f(ref.get("targetRateFrom")), _f(ref.get("targetRateTo"))
        if lo is not None and hi is not None:
            us = data.setdefault("US", {})
            mid = (lo + hi) / 2
            if us.get("rate") is not None and abs(us["rate"] - mid) > 1e-9:
                us["prev"], us["since"] = us["rate"], None
            us.update({"rate": mid, "lo": lo, "hi": hi, "date": ref.get("effectiveDate")})
    except Exception as e:
        print(f"  ! Fed rate (NY Fed): {type(e).__name__}: {e}"[:200])
    try:
        frm = (today - timedelta(days=400)).strftime("%d.%m.%Y")
        ru = parse_cbr(_get(CBR_URL.format(frm=frm, to=today.strftime("%d.%m.%Y"))).decode("utf-8", "replace"))
        if ru:
            data["RU"] = ru
    except Exception as e:
        print(f"  ! Bank of Russia key rate: {type(e).__name__}: {e}"[:200])
    out = []
    for c, (name, name_ru), flag in CB:
        x = data.get(c)
        if not x:
            continue
        out.append({"c": c, "name": name, "name_ru": name_ru, "flag": flag, **{k: v for k, v in x.items() if v is not None}})
    return out


# ---------------------------------------------------------------------------
# WIRP: ожидания по ставке ФРС из фьючерсов на ставку по федеральным фондам
# ---------------------------------------------------------------------------
MONTHS_EN = {m: i for i, m in enumerate(calendar.month_name) if m}


def parse_fomc(html_text):
    """Даты заседаний (последний день) из календаря ФРС."""
    heads = [(m.start(), int(m.group(1))) for m in re.finditer(r"(\d{4}) FOMC Meetings", html_text)]
    out = []
    for m in re.finditer(r'fomc-meeting__month[^>]*>\s*<strong>([^<]+)</strong>.{0,300}?fomc-meeting__date[^>]*>([^<]+)<',
                         html_text, re.S):
        year = None
        for pos, y in heads:
            if pos < m.start():
                year = y
        if not year:
            continue
        month_txt, days = m.group(1).strip(), m.group(2).strip()
        if "notation" in days.lower() or "unscheduled" in days.lower():
            continue
        last_month = month_txt.split("/")[-1].strip()
        month = MONTHS_EN.get(last_month) or next((i for n, i in MONTHS_EN.items() if n.startswith(last_month[:3])), None)
        nums = re.findall(r"\d+", days)
        if not month or not nums:
            continue
        try:
            out.append(date(year, month, int(nums[-1])))
        except ValueError:
            continue
    return sorted(set(out))


def zq_symbol(y, m):
    return f"ZQ{MONTH_CODES[m - 1]}{y % 100:02d}.CBT"


def implied_path(effr, meetings, avg):
    """
    Классический метод CME FedWatch.
    effr — текущая эффективная ставка; meetings — даты заседаний (по возрастанию, будущие);
    avg — {(год, месяц): средняя ставка месяца из фьючерса = 100 − цена}.
    Возвращает [{date, rate_before, rate_after, d_bp, cum_bp}].
    """
    out = []
    rate = effr
    by_month = {}
    for d in meetings:
        by_month.setdefault((d.year, d.month), d)
    for d in meetings:
        ym = (d.year, d.month)
        n = calendar.monthrange(d.year, d.month)[1]
        before_days = d.day          # решение действует со следующего дня
        after_days = n - d.day
        nxt = (d.year + (d.month == 12), d.month % 12 + 1)
        after = None
        if (after_days < 7 or ym not in avg) and nxt in avg and nxt not in by_month:
            after = avg[nxt]          # заседание в конце месяца: берём следующий месяц без заседаний
        elif ym in avg and after_days > 0:
            after = (avg[ym] * n - rate * before_days) / after_days
        elif nxt in avg:
            after = avg[nxt]
        if after is None:
            break
        out.append({"date": d.isoformat(), "before": round(rate, 4), "after": round(after, 4),
                    "d_bp": round((after - rate) * 100, 1), "cum_bp": round((after - effr) * 100, 1)})
        rate = after
    return out


def probabilities(d_bp, step=25.0):
    """Вероятности решения на заседании по ожидаемому изменению (б.п.)."""
    x = d_bp / step
    if x >= 0:
        k = int(x)
        frac = x - k
        if k == 0:
            return {"hike": round(frac * 100), "hold": round((1 - frac) * 100), "cut": 0, "hike50": 0}
        return {"hike": round((1 - frac) * 100), "hike50": round(frac * 100), "hold": 0, "cut": 0}
    x = -x
    k = int(x)
    frac = x - k
    if k == 0:
        return {"cut": round(frac * 100), "hold": round((1 - frac) * 100), "hike": 0, "cut50": 0}
    return {"cut": round((1 - frac) * 100), "cut50": round(frac * 100), "hold": 0, "hike": 0}


def zq_price(sym):
    meta = json.loads(_get(ZQ_URL.format(sym=urllib.request.quote(sym))))["chart"]["result"][0]["meta"]
    return _f(meta.get("regularMarketPrice"))


def wirp(today):
    ref = json.loads(_get(EFFR_URL))["refRates"][0]
    effr = _f(ref.get("percentRate"))
    meetings = [d for d in parse_fomc(_get(FOMC_URL).decode("utf-8", "replace")) if d >= today][:8]
    if effr is None or not meetings:
        return None
    months = set()
    for d in meetings:
        months.add((d.year, d.month))
        months.add((d.year + (d.month == 12), d.month % 12 + 1))
    avg = {}
    for y, m in sorted(months):
        try:
            p = zq_price(zq_symbol(y, m))
            if p:
                avg[(y, m)] = round(100 - p, 4)
        except Exception as e:
            print(f"  ! future {zq_symbol(y, m)}: {type(e).__name__}: {e}"[:160])
    path = implied_path(effr, meetings, avg)
    for row in path:
        row.update(probabilities(row["d_bp"]))
    return {"effr": effr, "date": ref.get("effectiveDate"), "lo": _f(ref.get("targetRateFrom")),
            "hi": _f(ref.get("targetRateTo")), "meetings": path}


# ---------------------------------------------------------------------------
# Денежный рынок (MMR): ставки овернайт
# ---------------------------------------------------------------------------
def _pair(obs):
    """[(date, value)] → (last date, last value, previous value)."""
    obs = sorted(o for o in obs if o[1] is not None)
    if not obs:
        return None
    return obs[-1][0], obs[-1][1], obs[-2][1] if len(obs) > 1 else None


def parse_nyfed(payload):
    return _pair([(r.get("effectiveDate"), _f(r.get("percentRate"))) for r in (payload or {}).get("refRates") or []])


def parse_estr(text):
    return _pair([(r.get("TIME_PERIOD"), _f(r.get("OBS_VALUE"))) for r in csv.DictReader(io.StringIO(text))])


def parse_sonia(text):
    obs = []
    for r in csv.DictReader(io.StringIO(text)):
        try:
            obs.append((datetime.strptime(r["DATE"].strip(), "%d %b %Y").date().isoformat(), _f(r.get("IUDSOIA"))))
        except (KeyError, ValueError):
            continue
    return _pair(obs)


def parse_ruonia(html_text):
    rows = re.findall(r"<td>(\d\d\.\d\d\.\d{4})</td>\s*<td[^>]*>([\d,]+)</td>", html_text)
    return _pair([(datetime.strptime(d, "%d.%m.%Y").date().isoformat(), _f(v)) for d, v in rows])


def parse_rusfar(payload):
    t = (payload or {}).get("marketdata") or {}
    cols, data = t.get("columns") or [], t.get("data") or []
    if not data:
        return None
    r = dict(zip(cols, data[0]))
    v = _f(r.get("CURRENTVALUE")) or _f(r.get("LASTVALUE"))
    return (r.get("TRADEDATE"), v, _f(r.get("LASTVALUE")) if r.get("CURRENTVALUE") else None) if v is not None else None


# key, country, English, Russian, loader
MM = [
    ("SOFR", "US", "Secured overnight financing rate", "Обеспеченная ставка овернайт (SOFR)",
     lambda t: parse_nyfed(json.loads(_get(NYFED_URL.format(kind="secured", k="sofr"))))),
    ("EFFR", "US", "Effective federal funds rate", "Эффективная ставка по федеральным фондам",
     lambda t: parse_nyfed(json.loads(_get(NYFED_URL.format(kind="unsecured", k="effr"))))),
    ("OBFR", "US", "Overnight bank funding rate", "Ставка межбанковского фондирования овернайт",
     lambda t: parse_nyfed(json.loads(_get(NYFED_URL.format(kind="unsecured", k="obfr"))))),
    ("ESTR", "EA", "Euro short-term rate (€STR)", "Краткосрочная ставка евро (€STR)",
     lambda t: parse_estr(_get(ESTR_URL).decode("utf-8", "replace"))),
    ("SONIA", "UK", "Sterling overnight index average", "Средняя ставка овернайт в фунтах (SONIA)",
     lambda t: parse_sonia(_get(SONIA_URL.format(frm=(t - timedelta(days=14)).strftime("%d/%b/%Y"))).decode("utf-8", "replace"))),
    ("RUONIA", "RU", "Ruble overnight index average", "Индикатор RUONIA",
     lambda t: parse_ruonia(_get(RUONIA_URL.format(frm=(t - timedelta(days=14)).strftime("%d.%m.%Y"), to=t.strftime("%d.%m.%Y"))).decode("utf-8", "replace"))),
    ("RUSFAR", "RU", "Ruble secured funding rate (repo)", "Ставка RUSFAR (репо)",
     lambda t: parse_rusfar(json.loads(_get(RUSFAR_URL)))),
]


def money_markets(today, prev=None):
    out = []
    old = {x.get("k"): x for x in prev or []}
    for k, c, en, ru, fn in MM:
        try:
            r = fn(today)
            if r and r[1] is not None:
                out.append({"k": k, "c": c, "en": en, "ru": ru, "date": r[0], "v": round(r[1], 4), "prev": round(r[2], 4) if r[2] is not None else None})
                continue
        except Exception as e:
            print(f"  ! money market {k}: {type(e).__name__}: {e}"[:200])
        if k in old:   # keep the last known value rather than lose the row
            out.append(old[k])
    return out


# ---------------------------------------------------------------------------
def load_previous(path=RATES_FILE):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return {}


def build(now=None, path=RATES_FILE, max_age_h=2.0, force=False):
    """Обновляет docs/rates.json не чаще раза в max_age_h часов (каждая часть — отдельно)."""
    now = now or datetime.now(timezone.utc)
    prev = load_previous(path)
    if not force and prev.get("updated", "") > (now - timedelta(hours=max_age_h)).isoformat():
        return prev
    today = now.date()
    data = {"updated": now.isoformat(), "curves": dict(prev.get("curves") or {}),
            "cb": prev.get("cb") or [], "wirp": prev.get("wirp"), "mm": prev.get("mm") or []}
    for code, names, flag, fn, fallback in CURVES:
        try:
            c = fn(today)
            if not c and fallback:
                code2, names, fn2 = fallback
                c = fn2(today)
            if c:
                data["curves"][code] = {"name": names[0], "name_ru": names[1], "flag": flag, **c}
        except Exception as e:
            print(f"  ! curve {names[0]}: {type(e).__name__}: {e}"[:200])
            if fallback:
                try:
                    code2, names2, fn2 = fallback
                    c = fn2(today)
                    if c:
                        data["curves"][code] = {"name": names2[0], "name_ru": names2[1], "flag": flag, **c}
                except Exception as e2:
                    print(f"  ! curve {fallback[1][0]}: {type(e2).__name__}: {e2}"[:200])
    try:
        cb = cb_rates(today)
        if cb:
            data["cb"] = cb
    except Exception as e:
        print(f"  ! central bank rates: {type(e).__name__}: {e}"[:200])
    try:
        mm = money_markets(today, data["mm"])
        if mm:
            data["mm"] = mm
    except Exception as e:
        print(f"  ! money markets: {type(e).__name__}: {e}"[:200])
    try:
        w = wirp(today)
        if w and w.get("meetings"):
            data["wirp"] = w
    except Exception as e:
        print(f"  ! WIRP: {type(e).__name__}: {e}"[:200])
    if os.path.isdir(os.path.dirname(path)):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    return data


if __name__ == "__main__":
    d = build(force=True)
    print(json.dumps({k: (list(v) if isinstance(v, dict) else v) for k, v in d.items() if k != "cb"}, ensure_ascii=False)[:2000])
