"""
World economy forecasts for the terminal and the bot — the Bloomberg functions ECST / ECFC
(economic statistics and forecasts by country). Source: IMF World Economic Outlook through the IMF DataMapper
API (free, no key; it refuses browser-like requests, so we introduce ourselves as a research bot).
Result: docs/macro.json, refreshed once a day (the IMF updates the forecasts twice a year).
"""
from __future__ import annotations

import json
import os
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "docs", "macro.json")
IMF_URL = "https://www.imf.org/external/datamapper/api/v1/{ind}?periods={periods}"
RESEARCH_UA = "EconNews research bot econnews@example.com"

# indicator: (English, Russian, unit)
INDICATORS = {
    "NGDP_RPCH": ("Real GDP growth", "Рост реального ВВП", "%"),
    "PCPIPCH": ("Inflation (average CPI)", "Инфляция (средняя, ИПЦ)", "%"),
    "LUR": ("Unemployment rate", "Безработица", "%"),
    "GGXCNL_NGDP": ("Budget balance, % of GDP", "Сальдо бюджета, % ВВП", "%"),
    "GGXWDG_NGDP": ("Government debt, % of GDP", "Госдолг, % ВВП", "%"),
    "BCA_NGDPD": ("Current account, % of GDP", "Текущий счёт, % ВВП", "%"),
    "NGDPD": ("GDP, USD bn", "ВВП, млрд долл.", "bn"),
}

# IMF code: (English, Russian) — the world, the groups and the 20 largest economies
COUNTRIES = {
    "WEOWORLD": ("World", "Мир"), "ADVEC": ("Advanced economies", "Развитые страны"),
    "OEMDC": ("Emerging & developing", "Развивающиеся страны"), "EURO": ("Euro area", "Еврозона"),
    "USA": ("United States", "США"), "CHN": ("China", "Китай"), "DEU": ("Germany", "Германия"), "JPN": ("Japan", "Япония"),
    "IND": ("India", "Индия"), "GBR": ("United Kingdom", "Великобритания"), "FRA": ("France", "Франция"),
    "ITA": ("Italy", "Италия"), "CAN": ("Canada", "Канада"), "BRA": ("Brazil", "Бразилия"), "RUS": ("Russia", "Россия"),
    "KOR": ("South Korea", "Южная Корея"), "AUS": ("Australia", "Австралия"), "ESP": ("Spain", "Испания"),
    "MEX": ("Mexico", "Мексика"), "IDN": ("Indonesia", "Индонезия"), "TUR": ("Türkiye", "Турция"),
    "SAU": ("Saudi Arabia", "Саудовская Аравия"), "CHE": ("Switzerland", "Швейцария"), "ZAF": ("South Africa", "ЮАР"),
    "KAZ": ("Kazakhstan", "Казахстан"),
}


def fetch(ind, periods):
    req = urllib.request.Request(IMF_URL.format(ind=ind, periods=",".join(map(str, periods))),
                                 headers={"User-Agent": RESEARCH_UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))


def parse(payloads, years):
    """payloads: {indicator: IMF answer} -> rows [{c, en, ru, v: {indicator: [value per year]}}]."""
    rows = []
    for code, (en, ru) in COUNTRIES.items():
        v = {}
        for ind, d in payloads.items():
            series = ((d.get("values") or {}).get(ind) or {}).get(code) or {}
            vals = [series.get(str(y)) for y in years]
            if any(x is not None for x in vals):
                v[ind] = [round(x, 1) if isinstance(x, (int, float)) else None for x in vals]
        if v:
            rows.append({"c": code, "en": en, "ru": ru, "v": v})
    return rows


def build(now=None, path=OUT, fetcher=fetch, max_age_h=24):
    """Returns the number of countries written (0 when the file is fresh or the IMF did not answer)."""
    now = now or datetime.now(timezone.utc)
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
    except (FileNotFoundError, ValueError):
        old = {}
    if old.get("updated", "") > (now - timedelta(hours=max_age_h)).isoformat():
        return 0
    years = list(range(now.year - 3, now.year + 3))
    payloads = {}
    for ind in INDICATORS:
        try:
            payloads[ind] = fetcher(ind, years)
        except Exception as e:
            print(f"  ! IMF {ind}: {type(e).__name__}: {e}"[:200])
    rows = parse(payloads, years)
    if len(payloads) < len(INDICATORS) // 2 or len(rows) < 10:
        return 0   # keep yesterday's file rather than a half-empty one
    data = {"updated": now.isoformat(), "source": "IMF World Economic Outlook", "years": years,
            "ind": {k: {"en": en, "ru": ru, "unit": u} for k, (en, ru, u) in INDICATORS.items() if k in payloads},
            "rows": rows}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    return len(rows)


if __name__ == "__main__":
    print("countries:", build(max_age_h=0))
