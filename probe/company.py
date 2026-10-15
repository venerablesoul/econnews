"""
Deep company data for the terminal and the bot — the Bloomberg functions DES (profile, management),
EE (estimates), ANR (price targets, rating changes), HDS (holders), SI (short interest), DVD (dividends)
and CF (filings). Result: docs/co/<TICKER>.json for the ~100 largest US companies (stocks.UNIVERSE),
refreshed a few companies per run so that every company is at most ~12 hours old.

Free sources, no keys:
  Yahoo Finance quoteSummary — the same data the Yahoo website shows; it needs a session cookie and a "crumb"
      token, which we get the way a browser does (fc.yahoo.com → getcrumb)
  Yahoo chart events        — dividend and split history
  Nasdaq                    — short interest history (published twice a month)
  Wikipedia                 — a short company description in English and Russian (refreshed weekly)
"""
from __future__ import annotations

import gzip
import http.cookiejar
import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import stocks

UA = stocks.UA
RESEARCH_UA = "EconNews research bot econnews@example.com"   # Wikipedia asks for an identifying User-Agent
HERE = os.path.dirname(os.path.abspath(__file__))
CO_DIR = os.path.join(HERE, "docs", "co")

QS_URL = "https://query2.finance.yahoo.com/v10/finance/quoteSummary/{sym}?modules={mods}&crumb={crumb}"
CHART_EVENTS_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=15y&interval=1mo&events=div%7Csplit"
NASDAQ_SHORT_URL = "https://api.nasdaq.com/api/quote/{sym}/short-interest?assetClass=stocks"
WIKI_SEARCH_URL = "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={q}&srlimit=4&format=json"
WIKI_SUMMARY_URL = "https://{lang}.wikipedia.org/api/rest_v1/page/summary/{title}"
WIKI_LANGLINK_URL = ("https://en.wikipedia.org/w/api.php?action=query&titles={title}&prop=langlinks&lllang=ru"
                     "&redirects=1&format=json")

MODULES = ("assetProfile", "summaryDetail", "defaultKeyStatistics", "financialData", "earningsTrend",
           "upgradeDowngradeHistory", "institutionOwnership", "fundOwnership", "majorHoldersBreakdown",
           "insiderHolders", "calendarEvents", "earningsHistory", "secFilings", "netSharePurchaseActivity", "price")

# words that show a Wikipedia page is about a company (not a fruit, a planet or a person)
COMPANY_WORDS = ("company", "corporation", "conglomerate", "bank", "manufacturer", "retailer", "holding", "firm",
                 "insurer", "multinational", "provider", "operator", "maker", "producer", "chain", "airline",
                 "railroad", "pharmaceutical", "biotechnology", "semiconductor", "software", "restaurant",
                 "payment", "financial services", "brand", "utility", "investment", "technology", "network",
                 "developer", "supplier", "contractor", "group", "business", "enterprise")


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
class Session:
    """A cookie-keeping HTTP session (Yahoo needs its cookie together with the crumb)."""

    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.crumb = None

    def get(self, url, ua=UA, timeout=25):
        req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "application/json,text/plain,*/*",
                                                   "Accept-Encoding": "gzip"})
        with self.opener.open(req, timeout=timeout) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return raw

    def json(self, url, ua=UA, timeout=25):
        return json.loads(self.get(url, ua, timeout).decode("utf-8"))

    def yahoo_login(self):
        try:
            self.get("https://fc.yahoo.com", timeout=20)   # answers 404 but sets the session cookie
        except Exception:
            pass
        crumb = self.get("https://query2.finance.yahoo.com/v1/test/getcrumb").decode("utf-8", "replace").strip()
        if not crumb or len(crumb) > 40 or "<" in crumb:
            raise RuntimeError("Yahoo gave no crumb")
        self.crumb = crumb

    def quote_summary(self, sym, modules=MODULES):
        for attempt in (0, 1):
            if not self.crumb:
                self.yahoo_login()
            url = QS_URL.format(sym=urllib.parse.quote(sym), mods=",".join(modules), crumb=urllib.parse.quote(self.crumb))
            try:
                d = self.json(url)
            except urllib.error.HTTPError as e:
                if e.code == 401 and attempt == 0:   # the crumb expired — log in again once
                    self.crumb = None
                    continue
                raise
            res = (d.get("quoteSummary") or {}).get("result") or []
            if not res:
                raise RuntimeError("Yahoo: no data for " + sym)
            return res[0]
        raise RuntimeError("Yahoo: unauthorized")


# ---------------------------------------------------------------------------
# Parsing Yahoo's quoteSummary
# ---------------------------------------------------------------------------
def raw(x):
    """Yahoo wraps numbers as {"raw": 1.5, "fmt": "1.50"}; empty values come as {}."""
    if isinstance(x, dict):
        return x.get("raw")
    return x


def num(x, nd=None, scale=1.0):
    v = raw(x)
    if v is None or isinstance(v, bool):
        return None
    try:
        v = float(v) * scale
    except (TypeError, ValueError):
        return None
    if v != v or v in (float("inf"), float("-inf")):
        return None
    if nd == 0:
        return int(round(v))
    return round(v, nd) if nd is not None else v


def day(x):
    """A date as YYYY-MM-DD from {"raw": epoch, "fmt": "2026-06-30"} or from an epoch number."""
    if isinstance(x, dict):
        if isinstance(x.get("fmt"), str) and re.match(r"^\d{4}-\d{2}-\d{2}$", x["fmt"]):
            return x["fmt"]
        x = x.get("raw")
    if isinstance(x, (int, float)) and x > 0:
        return datetime.fromtimestamp(x, timezone.utc).strftime("%Y-%m-%d")
    if isinstance(x, str) and re.match(r"^\d{4}-\d{2}-\d{2}", x):
        return x[:10]
    return None


def items(lst):
    """Real list entries only (our trimmed test fixtures add {"_more": n})."""
    return [x for x in (lst or []) if isinstance(x, dict) and "_more" not in x]


def clean(d):
    """Drops empty values so the files stay small."""
    if isinstance(d, dict):
        out = {}
        for k, v in d.items():
            v = clean(v)
            if v is None or v == "" or v == [] or v == {}:
                continue
            out[k] = v
        return out
    if isinstance(d, list):
        return [clean(x) for x in d]
    return d


def parse_profile(r):
    ap = r.get("assetProfile") or {}
    pr = r.get("price") or {}
    addr = ", ".join(x for x in (ap.get("address1"), ap.get("city"), " ".join(filter(None, (ap.get("state"), ap.get("zip")))),
                                 ap.get("country")) if x)
    officers = [{"n": re.sub(r"\s+", " ", o.get("name") or "").strip(), "t": o.get("title"), "age": o.get("age"),
                 "pay": num(o.get("totalPay"), 0)} for o in items(ap.get("companyOfficers"))[:12]]
    return {"name": pr.get("longName") or pr.get("shortName"), "summary": (ap.get("longBusinessSummary") or "")[:2000],
            "industry": ap.get("industry"), "sector": ap.get("sector"), "employees": ap.get("fullTimeEmployees"),
            "address": addr, "phone": ap.get("phone"), "website": ap.get("website"), "ir": ap.get("irWebsite"),
            "exchange": pr.get("exchangeName"), "officers": officers}


def parse_stats(r):
    ks, sd, fd = r.get("defaultKeyStatistics") or {}, r.get("summaryDetail") or {}, r.get("financialData") or {}
    pct = lambda x: num(x, 2, 100.0)
    return {
        "ev": num(ks.get("enterpriseValue"), 0), "ev_ebitda": num(ks.get("enterpriseToEbitda"), 2),
        "ev_rev": num(ks.get("enterpriseToRevenue"), 2), "peg": num(ks.get("pegRatio"), 2),
        "pb": num(ks.get("priceToBook"), 2), "book": num(ks.get("bookValue"), 3),
        "pe": num(sd.get("trailingPE"), 2), "fpe": num(sd.get("forwardPE") or ks.get("forwardPE"), 2),
        "eps": num(ks.get("trailingEps"), 3), "feps": num(ks.get("forwardEps"), 3),
        "float": num(ks.get("floatShares"), 0), "shares": num(ks.get("sharesOutstanding"), 0),
        "beta": num(ks.get("beta") or sd.get("beta"), 3), "chg52": pct(ks.get("52WeekChange")),
        "sp52": pct(ks.get("SandP52WeekChange")), "mcap": num(sd.get("marketCap"), 0),
        "avg_vol": num(sd.get("averageVolume"), 0), "fy_end": day(ks.get("lastFiscalYearEnd")),
        "mrq": day(ks.get("mostRecentQuarter")), "ath": num(sd.get("allTimeHigh"), 4),
        "cash": num(fd.get("totalCash"), 0), "debt": num(fd.get("totalDebt"), 0), "ebitda": num(fd.get("ebitda"), 0),
        "fcf": num(fd.get("freeCashflow"), 0), "ocf": num(fd.get("operatingCashflow"), 0),
        "rev": num(fd.get("totalRevenue"), 0), "gm": pct(fd.get("grossMargins")), "om": pct(fd.get("operatingMargins")),
        "nm": pct(fd.get("profitMargins")), "ebitdam": pct(fd.get("ebitdaMargins")), "roa": pct(fd.get("returnOnAssets")),
        "roe": pct(fd.get("returnOnEquity")), "de": num(fd.get("debtToEquity"), 2), "cr": num(fd.get("currentRatio"), 3),
        "qr": num(fd.get("quickRatio"), 3), "rev_g": pct(fd.get("revenueGrowth")), "earn_g": pct(fd.get("earningsGrowth")),
        "cur": fd.get("financialCurrency"),
    }


def parse_targets(r):
    fd = r.get("financialData") or {}
    return {"px": num(fd.get("currentPrice"), 4), "mean": num(fd.get("targetMeanPrice"), 2),
            "median": num(fd.get("targetMedianPrice"), 2), "high": num(fd.get("targetHighPrice"), 2),
            "low": num(fd.get("targetLowPrice"), 2), "n": num(fd.get("numberOfAnalystOpinions"), 0),
            "rec": num(fd.get("recommendationMean"), 2), "key": fd.get("recommendationKey")}


def parse_ratings(r, limit=40):
    out = []
    for h in items((r.get("upgradeDowngradeHistory") or {}).get("history")):
        pt, pt0 = num(h.get("currentPriceTarget"), 2), num(h.get("priorPriceTarget"), 2)
        out.append({"d": day(h.get("epochGradeDate")), "f": h.get("firm"), "to": h.get("toGrade"), "from": h.get("fromGrade"),
                    "a": h.get("action"), "pt": pt or None, "pt0": pt0 or None, "pta": h.get("priceTargetAction") or None})
    out.sort(key=lambda x: x["d"] or "", reverse=True)
    return out[:limit]


def _est_block(e):
    e = e or {}
    return {"avg": num(e.get("avg"), 4), "low": num(e.get("low"), 4), "high": num(e.get("high"), 4),
            "n": num(e.get("numberOfAnalysts"), 0), "ago": num(e.get("yearAgoEps") or e.get("yearAgoRevenue"), 4),
            "g": num(e.get("growth"), 2, 100.0)}


def parse_estimates(r):
    out = []
    for t in items((r.get("earningsTrend") or {}).get("trend")):
        if t.get("period") not in ("0q", "+1q", "0y", "+1y"):
            continue
        tr, rv = t.get("epsTrend") or {}, t.get("epsRevisions") or {}
        out.append({"p": t.get("period"), "end": day(t.get("endDate")), "g": num(t.get("growth"), 2, 100.0),
                    "eps": _est_block(t.get("earningsEstimate")), "rev": _est_block(t.get("revenueEstimate")),
                    "trend": {k: num(tr.get(src), 4) for k, src in (("now", "current"), ("d7", "7daysAgo"), ("d30", "30daysAgo"),
                                                                     ("d60", "60daysAgo"), ("d90", "90daysAgo"))},
                    "up7": num(rv.get("upLast7days"), 0), "up30": num(rv.get("upLast30days"), 0),
                    "dn7": num(rv.get("downLast7Days") or rv.get("downLast7days"), 0), "dn30": num(rv.get("downLast30days"), 0)})
    return out


def parse_history(r):
    out = []
    for h in items((r.get("earningsHistory") or {}).get("history")):
        out.append({"q": day(h.get("quarter")), "act": num(h.get("epsActual"), 4), "est": num(h.get("epsEstimate"), 4),
                    "sp": num(h.get("surprisePercent"), 2, 100.0)})
    return sorted(out, key=lambda x: x["q"] or "", reverse=True)


def parse_next(r):
    ce = (r.get("calendarEvents") or {}).get("earnings") or {}
    dates = [day(x) for x in ce.get("earningsDate") or []]
    return {"date": next((d for d in dates if d), None), "estimated": bool(ce.get("isEarningsDateEstimate")),
            "eps": {"avg": num(ce.get("earningsAverage"), 4), "low": num(ce.get("earningsLow"), 4), "high": num(ce.get("earningsHigh"), 4)},
            "rev": {"avg": num(ce.get("revenueAverage"), 0), "low": num(ce.get("revenueLow"), 0), "high": num(ce.get("revenueHigh"), 0)}}


def _fund(name):
    """'VANGUARD INDEX FUNDS-Vanguard 500 Index Fund' -> 'Vanguard 500 Index Fund' (the trust's name is noise)."""
    head, sep, tail = (name or "").partition("-")
    return tail.strip() if sep and len(head) > 3 and len(tail.strip()) > 3 else name


def _owners(lst, limit=10, fund=False):
    return [{"n": _fund(o.get("organization")) if fund else o.get("organization"), "pct": num(o.get("pctHeld"), 3, 100.0), "sh": num(o.get("position"), 0),
             "val": num(o.get("value"), 0), "chg": num(o.get("pctChange"), 2, 100.0), "d": day(o.get("reportDate"))}
            for o in items(lst)[:limit]]


def parse_holders(r):
    mh = r.get("majorHoldersBreakdown") or {}
    ns = r.get("netSharePurchaseActivity") or {}
    insiders = [{"n": re.sub(r"\s+", " ", h.get("name") or "").strip(), "rel": h.get("relation"), "d": day(h.get("latestTransDate")),
                 "desc": h.get("transactionDescription"), "pos": num(h.get("positionDirect"), 0)}
                for h in items((r.get("insiderHolders") or {}).get("holders"))[:12]]
    return {"ins": num(mh.get("insidersPercentHeld"), 2, 100.0), "inst": num(mh.get("institutionsPercentHeld"), 2, 100.0),
            "inst_float": num(mh.get("institutionsFloatPercentHeld"), 2, 100.0), "inst_n": num(mh.get("institutionsCount"), 0),
            "top": _owners((r.get("institutionOwnership") or {}).get("ownershipList")),
            "funds": _owners((r.get("fundOwnership") or {}).get("ownershipList"), fund=True), "insiders": insiders,
            "net6m": {"buy_n": num(ns.get("buyInfoCount"), 0), "buy_sh": num(ns.get("buyInfoShares"), 0),
                      "sell_n": num(ns.get("sellInfoCount"), 0), "sell_sh": num(ns.get("sellInfoShares"), 0),
                      "net_sh": num(ns.get("netInfoShares"), 0), "inst_net_pct": num(ns.get("netInstBuyingPercent"), 2, 100.0)}}


def parse_dividend_summary(r):
    sd, ks, ce = r.get("summaryDetail") or {}, r.get("defaultKeyStatistics") or {}, r.get("calendarEvents") or {}
    rate = num(sd.get("dividendRate"), 4) or num(sd.get("trailingAnnualDividendRate"), 4)
    return {"rate": rate, "yield": num(sd.get("dividendYield"), 3, 100.0) or None, "payout": num(sd.get("payoutRatio"), 2, 100.0),
            "avg5y": num(sd.get("fiveYearAvgDividendYield"), 2), "ex": day(ce.get("exDividendDate")) or day(sd.get("exDividendDate")),
            "pay": day(ce.get("dividendDate")), "last": num(ks.get("lastDividendValue"), 4), "last_d": day(ks.get("lastDividendDate")),
            "split": ks.get("lastSplitFactor"), "split_d": day(ks.get("lastSplitDate"))}


def parse_short(r):
    ks = r.get("defaultKeyStatistics") or {}
    return {"sh": num(ks.get("sharesShort"), 0), "pct_float": num(ks.get("shortPercentOfFloat"), 2, 100.0),
            "pct_out": num(ks.get("sharesPercentSharesOut"), 2, 100.0), "ratio": num(ks.get("shortRatio"), 2),
            "d": day(ks.get("dateShortInterest")), "prior": num(ks.get("sharesShortPriorMonth"), 0),
            "prior_d": day(ks.get("sharesShortPreviousMonthDate"))}


def parse_filings(r, limit=30):
    out = []
    for f in items((r.get("secFilings") or {}).get("filings")):
        main = next((x.get("url") for x in f.get("exhibits") or [] if x.get("type") == f.get("type")), None)
        out.append({"d": f.get("date"), "type": f.get("type"), "title": f.get("title"), "url": main or f.get("edgarUrl")})
    return out[:limit]


def parse_summary(r):
    """Everything from one quoteSummary answer, in the shape stored in docs/co/<T>.json."""
    return {"profile": parse_profile(r), "stats": parse_stats(r), "targets": parse_targets(r), "ratings": parse_ratings(r),
            "est": parse_estimates(r), "hist": parse_history(r), "next": parse_next(r), "holders": parse_holders(r),
            "div": parse_dividend_summary(r), "short": parse_short(r), "filings": parse_filings(r)}


# ---------------------------------------------------------------------------
# Dividends and splits, short interest history, Wikipedia
# ---------------------------------------------------------------------------
def parse_events(payload):
    res = ((payload or {}).get("chart") or {}).get("result") or [{}]
    ev = (res[0] or {}).get("events") or {}
    divs = sorted(([day(int(v.get("date") or k)), num(v.get("amount"), 6)] for k, v in (ev.get("dividends") or {}).items()), reverse=True)
    splits = sorted(([day(int(v.get("date") or k)), v.get("splitRatio") or f"{v.get('numerator')}:{v.get('denominator')}"]
                     for k, v in (ev.get("splits") or {}).items()), reverse=True)
    return [d for d in divs if d[0] and d[1]][:80], [s for s in splits if s[0]][:20]


def _int(s):
    try:
        return int(str(s).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def parse_nasdaq_short(payload, limit=24):
    rows = (((payload or {}).get("data") or {}).get("shortInterestTable") or {}).get("rows") or []
    out = []
    for r in rows[:limit]:
        m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", r.get("settlementDate") or "")
        if not m:
            continue
        out.append({"d": f"{m.group(3)}-{m.group(1)}-{m.group(2)}", "sh": _int(r.get("interest")),
                    "adv": _int(r.get("avgDailyShareVolume")), "days": num(r.get("daysToCover"), 2)})
    return out


def is_company_page(summary):
    if not summary or summary.get("type") == "disambiguation":
        return False
    desc = ((summary.get("description") or "") + " " + (summary.get("extract") or "")[:300]).lower()
    return any(w in desc for w in COMPANY_WORDS)


def wiki_pick(s, x):
    if not x:
        return None
    return {"t": x.get("title"), "x": (x.get("extract") or "")[:1200],
            "url": ((x.get("content_urls") or {}).get("desktop") or {}).get("page")}


def fetch_wiki(s, name):
    """English and Russian Wikipedia summaries of the company (best effort)."""
    q = urllib.parse.quote(f'"{name}" company' if len(name.split()) < 2 else name)
    hits = (s.json(WIKI_SEARCH_URL.format(q=q), ua=RESEARCH_UA).get("query") or {}).get("search") or []
    for h in hits[:3]:
        title = h.get("title") or ""
        en = s.json(WIKI_SUMMARY_URL.format(lang="en", title=urllib.parse.quote(title.replace(" ", "_"))), ua=RESEARCH_UA)
        if not is_company_page(en):
            continue
        out = {"en": wiki_pick(s, en)}
        ll = s.json(WIKI_LANGLINK_URL.format(title=urllib.parse.quote(en.get("title") or title)), ua=RESEARCH_UA)
        pages = ((ll.get("query") or {}).get("pages") or {}).values()
        ru_title = next((x.get("*") for p in pages for x in p.get("langlinks") or [] if x.get("lang") == "ru"), None)
        if ru_title:
            ru = s.json(WIKI_SUMMARY_URL.format(lang="ru", title=urllib.parse.quote(ru_title.replace(" ", "_"))), ua=RESEARCH_UA)
            if ru and ru.get("extract"):
                out["ru"] = wiki_pick(s, ru)
        return out
    return {}


# ---------------------------------------------------------------------------
# Building the files
# ---------------------------------------------------------------------------
def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return {}


def build_one(s, t, now, prev=None):
    """One company: returns the dict for docs/co/<t>.json (raises if Yahoo gives nothing)."""
    prev = prev or {}
    r = s.quote_summary(stocks.yahoo_sym(t))
    data = {"s": t, "updated": now.isoformat(), **parse_summary(r)}
    try:
        divs, splits = parse_events(s.json(CHART_EVENTS_URL.format(sym=urllib.parse.quote(stocks.yahoo_sym(t)))))
        data["div"]["hist"], data["div"]["splits"] = divs, splits
    except Exception as e:
        print(f"  ! dividends {t}: {type(e).__name__}: {e}"[:200])
        if (prev.get("div") or {}).get("hist"):
            data["div"]["hist"], data["div"]["splits"] = prev["div"]["hist"], prev["div"].get("splits", [])
    try:
        data["short"]["rows"] = parse_nasdaq_short(s.json(NASDAQ_SHORT_URL.format(sym=urllib.parse.quote(t.replace(".", "/")))))
    except Exception as e:
        print(f"  ! short interest {t}: {type(e).__name__}: {e}"[:200])
        data["short"]["rows"] = (prev.get("short") or {}).get("rows", [])
    # Wikipedia changes slowly: once a week
    wiki_at = prev.get("wiki_at", "")
    if prev.get("wiki") is not None and wiki_at > (now - timedelta(days=7)).isoformat():
        data["wiki"], data["wiki_at"] = prev["wiki"], wiki_at
    else:
        try:
            data["wiki"] = fetch_wiki(s, data["profile"].get("name") or stocks.BY_TICKER.get(t, {}).get("n") or t)
            data["wiki_at"] = now.isoformat()
        except Exception as e:
            print(f"  ! Wikipedia {t}: {type(e).__name__}: {e}"[:200])
            data["wiki"], data["wiki_at"] = prev.get("wiki") or {}, wiki_at
    return clean(data)


def build(now=None, limit=6, max_age_h=12, sleep=1.0, tickers=None, out_dir=CO_DIR, session=None):
    """Refreshes the `limit` oldest company files. Returns how many were written."""
    now = now or datetime.now(timezone.utc)
    tickers = tickers or [t for t, *_ in stocks.UNIVERSE]
    os.makedirs(out_dir, exist_ok=True)
    ages = sorted((load(os.path.join(out_dir, t + ".json")).get("updated", ""), t) for t in tickers)
    cutoff = (now - timedelta(hours=max_age_h)).isoformat()
    todo = [t for upd, t in ages if upd < cutoff][:limit]
    if not todo:
        return 0
    s = session or Session()
    done = 0
    for t in todo:
        path = os.path.join(out_dir, t + ".json")
        try:
            data = build_one(s, t, now, load(path))
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
            done += 1
        except Exception as e:
            print(f"  ! company {t}: {type(e).__name__}: {e}"[:200])
            if "401" in str(e) or "crumb" in str(e).lower():
                break   # Yahoo refuses the session — try again next run
        time.sleep(sleep)
    return done


if __name__ == "__main__":
    import sys
    n = build(tickers=sys.argv[1:] or None, limit=int(os.environ.get("LIMIT", "3")))
    print("company files written:", n)
