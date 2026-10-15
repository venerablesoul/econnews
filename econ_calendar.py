"""
Экономический календарь: важные события недели (инфляция, решения по ставкам,
занятость, ВВП...) для напоминаний и утреннего обзора.

Источник — бесплатная JSON-лента календаря Forex Factory (faireconomy.media),
без ключей. Лента обновляется раз в несколько часов и просит не дёргать её
слишком часто, поэтому бот кэширует её в state.json и скачивает не чаще
раза в CACHE_HOURS.

Если лента недоступна, бот просто работает без календаря.
"""
from __future__ import annotations

import json
import urllib.parse
import re
import urllib.request
from datetime import datetime, timedelta, timezone

URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
UA = "Mozilla/5.0 (compatible; EconNewsBot/1.0)"
CACHE_HOURS = 6
MSK = timezone(timedelta(hours=3))

FLAGS = {"USD": "🇺🇸", "EUR": "🇪🇺", "GBP": "🇬🇧", "JPY": "🇯🇵", "CNY": "🇨🇳", "CHF": "🇨🇭",
         "CAD": "🇨🇦", "AUD": "🇦🇺", "NZD": "🇳🇿", "ALL": "🌐"}
COUNTRY = {"USD": "США", "EUR": "еврозона", "GBP": "Великобритания", "JPY": "Япония",
           "CNY": "Китай", "CHF": "Швейцария", "CAD": "Канада", "AUD": "Австралия", "NZD": "Н. Зеландия"}

# Перевод частых названий: (регулярка, русское название). Остальное — через переводчик.
NAMES = [
    (r"^Core CPI m/m", "Базовая инфляция (CPI), м/м"),
    (r"^Core CPI y/y", "Базовая инфляция (CPI), г/г"),
    (r"^CPI m/m", "Инфляция (CPI), м/м"),
    (r"^CPI y/y", "Инфляция (CPI), г/г"),
    (r"^CPI Flash Estimate y/y", "Инфляция, предв. оценка, г/г"),
    (r"^Core CPI Flash Estimate y/y", "Базовая инфляция, предв. оценка, г/г"),
    (r"^Core PCE Price Index m/m", "Базовый индекс PCE, м/м"),
    (r"^Core PPI m/m", "Базовые цены производителей (PPI), м/м"),
    (r"^PPI m/m", "Цены производителей (PPI), м/м"),
    (r"^Non-Farm Employment Change", "Занятость вне с/х (NFP)"),
    (r"^ADP Non-Farm Employment Change", "Занятость ADP"),
    (r"^Unemployment Rate", "Уровень безработицы"),
    (r"^Unemployment Claims", "Заявки на пособие по безработице"),
    (r"^Average Hourly Earnings m/m", "Средняя почасовая зарплата, м/м"),
    (r"^Federal Funds Rate", "Решение ФРС по ставке"),
    (r"^FOMC Statement", "Заявление ФРС"),
    (r"^FOMC Press Conference", "Пресс-конференция ФРС"),
    (r"^FOMC Meeting Minutes", "Протокол заседания ФРС"),
    (r"^FOMC Economic Projections", "Прогнозы ФРС"),
    (r"^Fed Chair (\w+) Speaks", r"Выступление главы ФРС (\1)"),
    (r"^Main Refinancing Rate", "Решение ЕЦБ по ставке"),
    (r"^ECB Press Conference", "Пресс-конференция ЕЦБ"),
    (r"^ECB President (\w+) Speaks", r"Выступление главы ЕЦБ (\1)"),
    (r"^Official Bank Rate", "Решение Банка Англии по ставке"),
    (r"^BOJ Policy Rate", "Решение Банка Японии по ставке"),
    (r"^Advance GDP q/q", "ВВП, предв. оценка, кв/кв"),
    (r"^Prelim GDP q/q", "ВВП, предв. оценка, кв/кв"),
    (r"^Final GDP q/q", "ВВП, финальная оценка, кв/кв"),
    (r"^GDP q/q", "ВВП, кв/кв"),
    (r"^GDP m/m", "ВВП, м/м"),
    (r"^Core Retail Sales m/m", "Базовые розничные продажи, м/м"),
    (r"^Retail Sales m/m", "Розничные продажи, м/м"),
    (r"^ISM Manufacturing PMI", "Деловая активность в промышленности (ISM)"),
    (r"^ISM Services PMI", "Деловая активность в услугах (ISM)"),
    (r"^JOLTS Job Openings", "Вакансии JOLTS"),
    (r"^Prelim UoM Consumer Sentiment", "Потребительские настроения (Мичиган)"),
    (r"^Prelim UoM Inflation Expectations", "Инфляционные ожидания (Мичиган)"),
    (r"^Crude Oil Inventories", "Запасы нефти в США"),
    (r"^Trade Balance", "Торговый баланс"),
]


def fetch_events(timeout=15):
    req = urllib.request.Request(URL, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = json.loads(r.read().decode("utf-8"))
    out = []
    for e in raw:
        try:
            ts = datetime.fromisoformat(e["date"]).astimezone(timezone.utc)
        except (KeyError, ValueError):
            continue
        out.append({
            "title": (e.get("title") or "").strip(),
            "country": (e.get("country") or "").strip().upper(),
            "ts": ts.isoformat(),
            "impact": (e.get("impact") or "").strip(),
            "forecast": (e.get("forecast") or "").strip(),
            "previous": (e.get("previous") or "").strip(),
        })
    return out


def get_events(st, now, countries, impacts=("High",)):
    """События из кэша state['calendar'], при необходимости обновляет кэш."""
    cal = st.setdefault("calendar", {"fetched": "", "events": []})
    stale = not cal["fetched"] or \
        datetime.fromisoformat(cal["fetched"]) < now - timedelta(hours=CACHE_HOURS)
    # новая неделя начинается в воскресенье — перекачиваем, если кэш с прошлой недели
    if cal["fetched"] and datetime.fromisoformat(cal["fetched"]).isocalendar()[1] != now.isocalendar()[1]:
        stale = True
    if stale:
        try:
            cal["events"] = fetch_events()
            cal["fetched"] = now.isoformat()
        except Exception as e:
            print(f"  ! calendar unavailable: {type(e).__name__}: {e}")
            if not cal["fetched"]:
                # не стучимся каждые 30 минут в упавшую ленту: повторим через час
                cal["fetched"] = (now - timedelta(hours=CACHE_HOURS - 1)).isoformat()
    return [e for e in cal["events"]
            if e["impact"] in impacts and (e["country"] in countries or e["country"] == "ALL")]


def event_id(e):
    return f"{e['country']}|{e['ts']}|{e['title']}"


def ru_name(e, translate=None):
    t = e["title"]
    for rx, ru in NAMES:
        if re.search(rx, t):
            return re.sub(rx, ru, t).strip()
    if translate:
        tr = translate(t)
        if tr:
            return tr
    return t


def event_name(e, lang="en", translate=None):
    return ru_name(e, translate) if lang == "ru" else e["title"]


def _fp(e, lang):
    extra = []
    if e.get("forecast"):
        extra.append(("прогноз " if lang == "ru" else "fcst ") + _esc(e["forecast"]))
    if e.get("previous"):
        extra.append(("пред. " if lang == "ru" else "prev ") + _esc(e["previous"]))
    return extra


def fmt_event(e, lang="en", translate=None, with_time=True):
    t_msk = datetime.fromisoformat(e["ts"]).astimezone(MSK)
    flag = FLAGS.get(e["country"], "🏳")
    s = (f"<b>{t_msk:%H:%M}</b> " if with_time else "") + f"{flag} {_esc(event_name(e, lang, translate))}"
    extra = _fp(e, lang)
    if extra:
        s += f" <i>({', '.join(extra)})</i>"
    return s


def fmt_released(e, actual, lang="en", translate=None):
    """"🇺🇸 CPI y/y: <b>3.1%</b> (fcst 3.0%, prev 2.9%) — above forecast"."""
    extra = _fp(e, lang)
    v = verdict(actual, e.get("forecast"), lang)
    return (f"{FLAGS.get(e['country'], '')} {_esc(event_name(e, lang, translate))}: <b>{_esc(actual)}</b>"
            + (f" <i>({', '.join(extra)})</i>" if extra else "") + (f" — {v}" if v else ""))


def _esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def events_between(events, start, end):
    res = [e for e in events if start <= datetime.fromisoformat(e["ts"]) < end]
    res.sort(key=lambda e: e["ts"])
    return res


# ---------------------------------------------------------------------------
# Фактические значения (вышло X при прогнозе Y) для данных США — из FRED.
# Нужен бесплатный ключ: https://fredaccount.stlouisfed.org/apikeys
# FRED публикует цифру в течение минут–пары часов после выхода данных.
# ---------------------------------------------------------------------------
FRED_URL = "https://api.stlouisfed.org/fred/series/observations"

# название события Forex Factory -> (серия FRED, преобразование, формат)
#   pch — изменение к прошлому периоду в %, pc1 — к прошлому году в %, lin — как есть,
#   chg — изменение в единицах серии. fmt: pct — «0.3%», k — «215K» (тысячи), k_raw — сотни тысяч → K
FRED_MAP = [
    (r"^CPI m/m", "CPIAUCSL", "pch", "pct"),
    (r"^CPI y/y", "CPIAUCSL", "pc1", "pct"),
    (r"^Core CPI m/m", "CPILFESL", "pch", "pct"),
    (r"^Core CPI y/y", "CPILFESL", "pc1", "pct"),
    (r"^Core PCE Price Index m/m", "PCEPILFE", "pch", "pct"),
    (r"^PPI m/m", "PPIFIS", "pch", "pct"),
    (r"^Core PPI m/m", "PPIFES", "pch", "pct"),
    (r"^Non-Farm Employment Change", "PAYEMS", "chg", "k"),
    (r"^Unemployment Rate", "UNRATE", "lin", "pct"),
    (r"^Unemployment Claims", "ICSA", "lin", "k_raw"),
    (r"^Average Hourly Earnings m/m", "CES0500000003", "pch", "pct"),
    (r"^Retail Sales m/m", "RSAFS", "pch", "pct"),
    (r"^Core Retail Sales m/m", "RSFSXMV", "pch", "pct"),
    (r"^(Advance|Prelim|Final) GDP q/q", "A191RL1Q225SBEA", "lin", "pct"),
    (r"^Federal Funds Rate", "DFEDTARU", "lin", "pct"),
]


def fred_spec(e):
    if e.get("country") != "USD":
        return None
    for rx, series, units, fmt in FRED_MAP:
        if re.search(rx, e["title"]):
            return series, units, fmt
    return None


def _fmt_actual(v, fmt):
    if fmt == "k":
        return f"{round(v):.0f}K"
    if fmt == "k_raw":
        return f"{round(v / 1000):.0f}K"
    if fmt == "pct":
        return f"{v:.1f}%"
    return f"{v:g}"


def fetch_actual(e, key, timeout=15):
    """Возвращает строку факта, если FRED уже опубликовал данные после события, иначе None."""
    spec = fred_spec(e)
    if not spec or not key:
        return None
    series, units, fmt = spec
    q = urllib.parse.urlencode({"series_id": series, "api_key": key, "file_type": "json",
                                "units": units, "sort_order": "desc", "limit": 1})
    req = urllib.request.Request(f"{FRED_URL}?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        obs = json.loads(r.read().decode("utf-8")).get("observations") or []
    if not obs or obs[0].get("value") in (None, "", "."):
        return None
    # данные должны появиться в FRED в день события (по Нью-Йорку) или позже
    ev_day = (datetime.fromisoformat(e["ts"]) - timedelta(hours=5)).date().isoformat()
    if obs[0].get("realtime_start", "") < ev_day:
        return None
    return _fmt_actual(float(obs[0]["value"]), fmt)


def _num(s):
    m = re.search(r"-?\d+(?:\.\d+)?", (s or "").replace(",", "."))
    if not m:
        return None
    return float(m.group())


def verdict(actual, forecast, lang="en"):
    """Actual vs forecast: "above forecast" / "below forecast" / "as expected"."""
    a, f = _num(actual), _num(forecast)
    if a is None or f is None:
        return ""
    ru = lang == "ru"
    if abs(a - f) < 1e-9:
        return "как ожидали" if ru else "as expected"
    if a > f:
        return "выше прогноза" if ru else "above forecast"
    return "ниже прогноза" if ru else "below forecast"
