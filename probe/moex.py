"""
Moscow Exchange shares for the terminal heat map and screener (the Bloomberg functions IMAP and EQS for Russia).
Source: MOEX ISS (free, no key, 15-minute delay): all shares of the main board TQBR with today's prices and
turnover, plus the weights of the MOEX Russia Index (IMOEX). Result: docs/moex.json.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
from datetime import datetime, timedelta, timezone

import stocks

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "docs", "moex.json")
ISS = "https://iss.moex.com/iss/"
TQBR_URL = (ISS + "engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=securities,marketdata"
            "&securities.columns=SECID,SHORTNAME,LATNAME,PREVPRICE,LOTSIZE"
            "&marketdata.columns=SECID,OPEN,LOW,HIGH,LAST,LASTTOPREVPRICE,VALTODAY,ISSUECAPITALIZATION,UPDATETIME,MARKETPRICE")
IMOEX_URL = ISS + "statistics/engines/stock/markets/index/analytics/IMOEX.json?iss.meta=off&limit=100"

# sectors use the same English names as the US companies (the bot and the terminal translate them)
F, E, M, T, C, U, I, S, D, R, H = ("Financials", "Energy", "Materials", "Technology", "Communication", "Utilities",
                                   "Industrials", "Consumer Staples", "Consumer Discretionary", "Real Estate", "Health Care")
SECTORS = {
    "SBER": F, "SBERP": F, "VTBR": F, "T": F, "MOEX": F, "BSPB": F, "CBOM": F, "SVCB": F, "AFKS": F, "LEAS": F, "RENI": F,
    "SFIN": F, "MBNK": F, "DOMRF": F,
    "GAZP": E, "LKOH": E, "ROSN": E, "NVTK": E, "TATN": E, "TATNP": E, "SNGS": E, "SNGSP": E, "TRNFP": E, "BANEP": E,
    "BANE": E, "SIBN": E,
    "GMKN": M, "PLZL": M, "ALRS": M, "CHMF": M, "NLMK": M, "MAGN": M, "RUAL": M, "PHOR": M, "UGLD": M, "SELG": M,
    "MTLR": M, "MTLRP": M, "ENPG": M, "RASP": M, "TRMK": M, "AKRN": M, "VSMO": M, "SGZH": M,
    "YDEX": T, "POSI": T, "HEAD": T, "ASTR": T, "VKCO": T, "OZON": D, "DIAS": T, "SOFL": T, "IVAT": T,
    "MTSS": C, "RTKM": C, "RTKMP": C,
    "IRAO": U, "HYDR": U, "FEES": U, "MSNG": U, "UPRO": U, "LSNGP": U, "OGKB": U, "TGKA": U, "MRKP": U,
    "AFLT": I, "FLOT": I, "NMTP": I, "FESH": I, "GLTR": I, "NKHP": I,
    "MGNT": S, "X5": S, "LENT": S, "FIXP": D, "MVID": D, "AQUA": S, "BELU": S, "ABRD": S, "OKEY": S,
    "PIKK": R, "SMLT": R, "LSRG": R, "ETLN": R,
    "MDMG": H, "GEMC": H, "APTK": H, "ABIO": H,
}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": stocks.UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def table(d, name):
    t = d.get(name) or {}
    return [dict(zip(t.get("columns") or [], row)) for row in t.get("data") or []]


def latin(name):
    """'Sberbank ao' -> 'Sberbank', 'Tatneft ap' -> 'Tatneft pref'."""
    name = re.sub(r"\s+ao$", "", (name or "").strip(), flags=re.I)
    return re.sub(r"\s+ap$", " pref", name, flags=re.I)


def parse(tqbr, imoex):
    weights = {r.get("secids") or r.get("ticker"): r.get("weight") for r in table(imoex, "analytics")}
    md = {r["SECID"]: r for r in table(tqbr, "marketdata")}
    rows, times = [], []
    for s in table(tqbr, "securities"):
        sid = s["SECID"]
        m = md.get(sid) or {}
        px = m.get("LAST") or m.get("MARKETPRICE") or s.get("PREVPRICE")
        val = m.get("VALTODAY") or 0
        if not px or (not val and sid not in weights):
            continue   # not traded today and not in the index: nothing to show
        if m.get("UPDATETIME"):
            times.append(m["UPDATETIME"])
        rows.append({"s": sid, "n": s.get("SHORTNAME"), "en": latin(s.get("LATNAME")) or sid, "sec": SECTORS.get(sid),
                     "px": px, "ch": m.get("LASTTOPREVPRICE"), "o": m.get("OPEN"), "h": m.get("HIGH"), "l": m.get("LOW"),
                     "val": round(val), "cap": round(m.get("ISSUECAPITALIZATION") or 0) or None,
                     "w": weights.get(sid), "lot": s.get("LOTSIZE")})
    rows.sort(key=lambda r: -(r["cap"] or 0))
    return rows, max(times) if times else None


def build(now=None, path=OUT, fetcher=get, max_age_min=15):
    """Returns the number of shares written (0 if the file is fresh or nothing changed)."""
    now = now or datetime.now(timezone.utc)
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
    except (FileNotFoundError, ValueError):
        old = {}
    if old.get("updated", "") > (now - timedelta(minutes=max_age_min)).isoformat():
        return 0
    rows, t = parse(fetcher(TQBR_URL), fetcher(IMOEX_URL))
    if len(rows) < 20 or rows == old.get("rows"):
        return 0   # an empty answer or a closed market: keep the file (and the git history) as it is
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"updated": now.isoformat(), "time": t, "rows": rows}, f, ensure_ascii=False, separators=(",", ":"))
    return len(rows)


if __name__ == "__main__":
    print("MOEX shares:", build(max_age_min=0))
