"""
World valuations for the terminal — the Bloomberg function WPE (P/E of the world's stock markets).
Each market through its main country ETF (iShares / SPDR): Yahoo Finance gives the fund's trailing P/E and yield,
and for the stocks it holds — P/E, P/B and P/S (topHoldings). Today's move and the return since January come with it.
Result: docs/wpe.json, refreshed once a day.
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "docs", "wpe.json")

# country code, ETF, English, Russian, flag
MARKETS = [
    ("US", "SPY", "United States (S&P 500)", "США (S&P 500)", "🇺🇸"), ("US", "QQQ", "United States (Nasdaq 100)", "США (Nasdaq 100)", "🇺🇸"),
    ("CA", "EWC", "Canada", "Канада", "🇨🇦"), ("MX", "EWW", "Mexico", "Мексика", "🇲🇽"), ("BR", "EWZ", "Brazil", "Бразилия", "🇧🇷"),
    ("GB", "EWU", "United Kingdom", "Великобритания", "🇬🇧"), ("DE", "EWG", "Germany", "Германия", "🇩🇪"), ("FR", "EWQ", "France", "Франция", "🇫🇷"),
    ("IT", "EWI", "Italy", "Италия", "🇮🇹"), ("ES", "EWP", "Spain", "Испания", "🇪🇸"), ("NL", "EWN", "Netherlands", "Нидерланды", "🇳🇱"),
    ("CH", "EWL", "Switzerland", "Швейцария", "🇨🇭"), ("SE", "EWD", "Sweden", "Швеция", "🇸🇪"), ("PL", "EPOL", "Poland", "Польша", "🇵🇱"),
    ("TR", "TUR", "Türkiye", "Турция", "🇹🇷"), ("SA", "KSA", "Saudi Arabia", "Саудовская Аравия", "🇸🇦"), ("ZA", "EZA", "South Africa", "ЮАР", "🇿🇦"),
    ("IN", "INDA", "India", "Индия", "🇮🇳"), ("CN", "MCHI", "China", "Китай", "🇨🇳"), ("HK", "EWH", "Hong Kong", "Гонконг", "🇭🇰"),
    ("TW", "EWT", "Taiwan", "Тайвань", "🇹🇼"), ("KR", "EWY", "South Korea", "Южная Корея", "🇰🇷"), ("JP", "EWJ", "Japan", "Япония", "🇯🇵"),
    ("SG", "EWS", "Singapore", "Сингапур", "🇸🇬"), ("ID", "EIDO", "Indonesia", "Индонезия", "🇮🇩"), ("AU", "EWA", "Australia", "Австралия", "🇦🇺"),
    ("EU", "VGK", "Europe", "Европа", "🇪🇺"), ("EM", "EEM", "Emerging markets", "Развивающиеся рынки", "🌐"), ("WORLD", "ACWI", "World", "Мир", "🌐"),
]
MODULES = ["summaryDetail", "defaultKeyStatistics", "topHoldings", "price"]


def _raw(d, k):
    v = (d or {}).get(k)
    if isinstance(v, dict):
        v = v.get("raw")
    return v if isinstance(v, (int, float)) else None


def _ratio(v):
    """topHoldings.equityHoldings gives the ratios of the holdings; some are stored inverted (earnings yield)."""
    if v is None or v <= 0:
        return None
    return round(1 / v, 2) if v < 1 else round(v, 2)


def parse(qs):
    """One quoteSummary answer → the row's numbers."""
    sd, ks, th, pr = qs.get("summaryDetail") or {}, qs.get("defaultKeyStatistics") or {}, qs.get("topHoldings") or {}, qs.get("price") or {}
    eq = th.get("equityHoldings") or {}
    pe = _raw(sd, "trailingPE") or _ratio(_raw(eq, "priceToEarnings"))
    y = _raw(sd, "yield") if _raw(sd, "yield") is not None else _raw(sd, "trailingAnnualDividendYield")
    ch = _raw(pr, "regularMarketChangePercent")
    out = {"pe": round(pe, 2) if pe else None, "pb": _ratio(_raw(eq, "priceToBook")), "ps": _ratio(_raw(eq, "priceToSales")),
           "dy": round(y * 100, 2) if y is not None else None, "ch": round(ch * 100, 2) if ch is not None else None,   # Yahoo gives fractions
           "px": _raw(pr, "regularMarketPrice"), "rytd": round(_raw(ks, "ytdReturn") * 100, 2) if _raw(ks, "ytdReturn") is not None else None,
           "r52": round(_raw(ks, "52WeekChange") * 100, 2) if _raw(ks, "52WeekChange") is not None else None,
           "aum": _raw(sd, "totalAssets")}
    return out


def build(now=None, path=OUT, session=None, max_age_h=20, sleep=0.6):
    """Returns the number of markets written (0 when the file is fresh or Yahoo did not answer)."""
    now = now or datetime.now(timezone.utc)
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
    except (FileNotFoundError, ValueError):
        old = {}
    if old.get("updated", "") > (now - timedelta(hours=max_age_h)).isoformat():
        return 0
    if session is None:
        import company
        session = company.Session()
    rows, errors = [], []
    for c, sym, en, ru, flag in MARKETS:
        try:
            r = parse(session.quote_summary(sym, MODULES))
            rows.append({"c": c, "s": sym, "en": en, "ru": ru, "flag": flag, **{k: v for k, v in r.items() if v is not None}})
        except Exception as e:
            errors.append(f"{sym}: {type(e).__name__}: {e}"[:120])
        if sleep:
            time.sleep(sleep)
    if len(rows) < len(MARKETS) // 2:
        for e in errors[:3]:
            print("  ! WPE", e)
        return 0   # keep yesterday's file rather than a half-empty one
    data = {"updated": now.isoformat(), "source": "Yahoo Finance (country ETFs)", "rows": rows}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    return len(rows)


if __name__ == "__main__":
    print("markets:", build(max_age_h=0))
