"""
IPO calendar for the terminal (IPO function) and the bot (/ipo): upcoming US listings, recently priced ones and new filings.
Source: the Nasdaq IPO calendar (free, no key; it covers NYSE and Nasdaq listings). Finnhub's free calendar is often empty,
so this file is what the terminal and the bot server rely on.
Result: docs/ipo.json, refreshed every 2 hours.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "docs", "ipo.json")
URL = "https://api.nasdaq.com/api/ipo/calendar?date={month}"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
RECENT_DAYS = 45   # priced and filed deals this far back


def fetch(month):
    req = urllib.request.Request(URL.format(month=month), headers={"User-Agent": UA, "Accept": "application/json, text/plain, */*"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def _date(s):
    """'10/15/2026' -> '2026-10-15'."""
    m = re.match(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})", s or "")
    return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}" if m else None


def _int(s):
    s = re.sub(r"[^\d.]", "", str(s or ""))
    try:
        return int(float(s)) if s else None
    except ValueError:
        return None


def _rows(table):
    if isinstance(table, dict):
        if isinstance(table.get("rows"), list):
            return table["rows"]
        for v in table.values():   # upcoming → upcomingTable → rows
            if isinstance(v, dict) and isinstance(v.get("rows"), list):
                return v["rows"]
    return []


def parse(payload):
    """One month of the Nasdaq calendar -> rows in the Finnhub layout the server and the terminal already use."""
    d = (payload or {}).get("data") or {}
    out = []
    for kind, status, date_key in (("upcoming", "expected", "expectedPriceDate"), ("priced", "priced", "pricedDate"),
                                   ("filed", "filed", "filedDate"), ("withdrawn", "withdrawn", "withdrawDate")):
        for r in _rows(d.get(kind)):
            day = _date(r.get(date_key) or r.get("expectedPriceDate") or r.get("pricedDate") or r.get("filedDate") or "")
            name = (r.get("companyName") or "").strip()
            if not day or not name:
                continue
            out.append({"date": day, "symbol": (r.get("proposedTickerSymbol") or "").strip() or None, "name": name,
                        "exchange": (r.get("proposedExchange") or "").strip() or None,
                        "price": (r.get("proposedSharePrice") or "").strip() or None,
                        "numberOfShares": _int(r.get("sharesOffered")), "totalSharesValue": _int(r.get("dollarValueOfSharesOffered")),
                        "status": status, "id": r.get("dealID")})
    return out


ORDER = {"expected": 0, "priced": 1, "filed": 2, "withdrawn": 3}


def select(rows, today):
    """Upcoming ones from today on (earliest first), then priced and filed in the last RECENT_DAYS (newest first)."""
    since = (datetime.fromisoformat(today) - timedelta(days=RECENT_DAYS)).date().isoformat()
    seen, keep = set(), []
    for r in rows:
        if r["status"] == "expected" and r["date"] < today:
            continue
        if r["status"] != "expected" and r["date"] < since:
            continue
        key = r.get("id") or (r["name"], r["status"])
        if key in seen:
            continue
        seen.add(key)
        keep.append(r)
    up = sorted((r for r in keep if r["status"] == "expected"), key=lambda r: r["date"])
    rest = sorted((r for r in keep if r["status"] != "expected"), key=lambda r: r["date"], reverse=True)
    rest.sort(key=lambda r: ORDER[r["status"]])   # stable: priced, then filed, then withdrawn, each newest first
    for r in up + rest:
        r.pop("id", None)
    return up + rest


def months(now):
    first = now.replace(day=1)
    prev = (first - timedelta(days=1)).replace(day=1)
    nxt = (first + timedelta(days=32)).replace(day=1)
    return [m.strftime("%Y-%m") for m in (prev, first, nxt)]


def build(now=None, path=OUT, fetcher=fetch, max_age_h=2):
    """Returns the number of deals written (0 when the file is fresh or Nasdaq did not answer)."""
    now = now or datetime.now(timezone.utc)
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
    except (FileNotFoundError, ValueError):
        old = {}
    if old.get("updated", "") > (now - timedelta(hours=max_age_h)).isoformat():
        return 0
    rows, ok = [], 0
    for m in months(now):
        try:
            rows += parse(fetcher(m))
            ok += 1
        except Exception as e:
            print(f"  ! Nasdaq IPO {m}: {type(e).__name__}: {e}"[:200])
    if not ok:
        return 0   # keep the old file rather than an empty one
    ipo = select(rows, now.date().isoformat())
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"updated": now.isoformat(), "source": "Nasdaq IPO calendar", "ipo": ipo}, f, ensure_ascii=False, separators=(",", ":"))
    return len(ipo) or 1


if __name__ == "__main__":
    print("deals:", build(max_age_h=0))
