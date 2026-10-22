"""
US Treasury auctions for the terminal — the Bloomberg function SRCH (a search of government securities).
The Treasury's Fiscal Data API (auctions_query) does not answer browsers, so the bot keeps a copy:
the auctions of the last ~13 months and the announced ones, bills, notes and bonds (TIPS and FRN among them).
TreasuryDirect stands in when Fiscal Data does not answer. Result: docs/auctions.json, refreshed every few hours.
"""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "docs", "auctions.json")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
FD = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query"
FIELDS = ["cusip", "security_type", "security_term", "auction_date", "issue_date", "maturity_date", "high_yield", "high_discnt_rate",
          "high_investment_rate", "int_rate", "bid_to_cover_ratio", "offering_amt", "reopening", "inflation_index_security", "floating_rate"]
TD = "https://www.treasurydirect.gov/TA_WS/securities/{kind}?format=json"
# TreasuryDirect's names for the same fields
TD_FIELDS = {"cusip": "cusip", "security_type": "securityType", "security_term": "securityTerm", "auction_date": "auctionDate",
             "issue_date": "issueDate", "maturity_date": "maturityDate", "high_yield": "highYield", "high_discnt_rate": "highDiscountRate",
             "high_investment_rate": "highInvestmentRate", "int_rate": "interestRate", "bid_to_cover_ratio": "bidToCoverRatio",
             "offering_amt": "offeringAmount", "reopening": "reopening", "inflation_index_security": "tips", "floating_rate": "floatingRate"}
NUM = {"high_yield", "high_discnt_rate", "high_investment_rate", "int_rate", "bid_to_cover_ratio", "offering_amt"}
TYPES = ("Bill", "Note", "Bond")


def _get_json(url, timeout=60):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"}), timeout=timeout) as r:
        return json.loads(r.read())


def clean(rec, names=None):
    """One record in either source's shape → the compact row: dates as YYYY-MM-DD, numbers as numbers, "null"/"" as missing."""
    out = {}
    for k in FIELDS:
        v = rec.get((names or {}).get(k, k))
        if v is None or v in ("null", "", "None"):
            continue
        if k in NUM:
            try:
                v = float(v)
            except (TypeError, ValueError):
                continue
            if k == "offering_amt":
                v = int(v)
        elif k.endswith("_date"):
            v = str(v)[:10]
        elif k in ("reopening", "inflation_index_security", "floating_rate"):
            if v is True or v is False:
                v = "Yes" if v else "No"
            if v != "Yes":
                continue   # only the "Yes" flags are kept
        out[k] = v
    return out if out.get("cusip") and out.get("auction_date") and out.get("security_type") in TYPES else None


def from_fiscal(since, fetch=_get_json):
    q = {"fields": ",".join(FIELDS), "filter": f"auction_date:gte:{since}", "sort": "-auction_date", "page[size]": "1000"}
    d = fetch(FD + "?" + urllib.parse.urlencode(q, safe=":,[]-"))
    return [r for r in (clean(x) for x in d.get("data") or []) if r]


def from_treasurydirect(days, fetch=_get_json):
    rows = []
    for t in TYPES:
        rows += fetch(TD.format(kind="auctioned") + f"&type={t}&days={days}") or []
    rows += fetch(TD.format(kind="upcoming")) or []
    return [r for r in (clean(x, TD_FIELDS) for x in rows) if r]


def build(now=None, path=OUT, max_age_h=6, fetch=_get_json):
    """Returns the number of auctions written (0 when the file is fresh or neither source answered)."""
    now = now or datetime.now(timezone.utc)
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
    except (FileNotFoundError, ValueError):
        old = {}
    if old.get("updated", "") > (now - timedelta(hours=max_age_h)).isoformat():
        return 0
    since = (now - timedelta(days=400)).date().isoformat()
    rows, src = [], None
    for name, fn in (("US Treasury Fiscal Data", lambda: from_fiscal(since, fetch)), ("TreasuryDirect", lambda: from_treasurydirect(400, fetch))):
        try:
            rows = fn()
            if len(rows) >= 20:
                src = name
                break
        except Exception as e:
            print(f"  ! auctions ({name}): {type(e).__name__}: {e}"[:200])
    if not src:
        return 0
    seen, uniq = set(), []
    for r in sorted(rows, key=lambda r: (r["auction_date"], r["cusip"]), reverse=True):
        k = (r["cusip"], r["auction_date"])
        if k not in seen:
            seen.add(k)
            uniq.append(r)
    data = {"updated": now.isoformat(), "source": src, "rows": uniq}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    return len(uniq)


if __name__ == "__main__":
    print("auctions:", build(max_age_h=0))
