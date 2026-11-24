from __future__ import annotations

import gzip
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

import stocks

HERE = os.path.dirname(os.path.abspath(__file__))
OPT_DIR = os.path.join(HERE, "docs", "opt")
SUMMARY = os.path.join(HERE, "docs", "options.json")
CBOE_URL = "https://cdn.cboe.com/api/global/delayed_quotes/options/{sym}.json"

YAHOO_URL = "https://query2.finance.yahoo.com/v7/finance/options/{sym}?crumb={crumb}{date}"

FAST = ("SPX", "NDX", "SPY", "QQQ", "IWM")
CORE = ("SPX", "NDX", "SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "AMD", "NFLX",
        "JPM", "BAC", "XOM", "WMT", "COST", "LLY", "UNH", "V", "MA", "ORCL", "INTC", "PLTR")
ETF_NAMES = {"SPY": "SPDR S&P 500 ETF", "QQQ": "Invesco QQQ (Nasdaq-100)", "IWM": "iShares Russell 2000 ETF",
             "SPX": "S&P 500 index", "NDX": "Nasdaq-100 index"}
CBOE_SYM = {"SPX": "_SPX", "NDX": "_NDX"}
YAHOO_SYM = {"SPX": "^SPX", "NDX": "^NDX"}
GEX_BAND = {"SPX": 0.06, "NDX": 0.06, "SPY": 0.06, "QQQ": 0.06, "IWM": 0.08}
R_USD = 0.04

OCC = re.compile(r"^(.+?)(\d{6})([CP])(\d{8})$")


def parse_occ(code):
    m = OCC.match(code or "")
    if not m:
        return None
    y, mo, d = int(m.group(2)[:2]), int(m.group(2)[2:4]), int(m.group(2)[4:])
    return date(2000 + y, mo, d).isoformat(), m.group(3), int(m.group(4)) / 1000


def _n(x, nd=2):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return round(v, nd) if v == v else None


def max_pain(calls, puts):
    strikes = sorted(set(calls) | set(puts))
    best = None
    for p in strikes:
        pay = sum(oi * (p - k) for k, oi in calls.items() if p > k) + sum(oi * (k - p) for k, oi in puts.items() if k > p)
        if best is None or pay < best[0]:
            best = (pay, p)
    return best[1] if best else None


def summarize(payload, today, n_chain=4, width=0.15, max_rows=30):
    d = (payload or {}).get("data") or {}
    px = _n(d.get("current_price"), 4) or _n(d.get("close"), 4)
    if not px:
        raise ValueError("Cboe: no price")
    by_exp = {}
    for o in d.get("options") or []:
        p = parse_occ(o.get("option"))
        if not p:
            continue
        exp, cp, k = p
        if exp < today.isoformat():
            continue
        by_exp.setdefault(exp, {}).setdefault(k, {})[cp] = o
    exps = []
    chains = []
    for exp in sorted(by_exp)[:16]:
        strikes = by_exp[exp]
        c_oi = {k: (s.get("C") or {}).get("open_interest") or 0 for k, s in strikes.items()}
        p_oi = {k: (s.get("P") or {}).get("open_interest") or 0 for k, s in strikes.items()}
        c_vol = sum((s.get("C") or {}).get("volume") or 0 for s in strikes.values())
        p_vol = sum((s.get("P") or {}).get("volume") or 0 for s in strikes.values())
        atm = min(strikes, key=lambda k: abs(k - px))
        c, p = strikes[atm].get("C") or {}, strikes[atm].get("P") or {}
        ivs = [x for x in (c.get("iv"), p.get("iv")) if x]
        mid = lambda o: (o.get("bid", 0) + o.get("ask", 0)) / 2 if o.get("ask") else (o.get("last_trade_price") or 0)
        move = mid(c) + mid(p) if c and p else None
        exps.append({"d": exp, "dte": (date.fromisoformat(exp) - today).days, "c_vol": int(c_vol), "p_vol": int(p_vol),
                     "c_oi": int(sum(c_oi.values())), "p_oi": int(sum(p_oi.values())), "atm": atm,
                     "iv": _n(sum(ivs) / len(ivs) * 100, 1) if ivs else None,
                     "move": _n(move, 2), "move_pct": _n(move / px * 100, 2) if move else None,
                     "pain": max_pain(c_oi, p_oi)})
        if len(chains) < n_chain:
            near = sorted((k for k in strikes if abs(k / px - 1) <= width), key=lambda k: abs(k - px))[:max_rows]
            rows = []
            for k in sorted(near):
                row = [k]
                for side in ("C", "P"):
                    o = strikes[k].get(side) or {}
                    row += [_n(o.get("bid")), _n(o.get("ask")), _n(o.get("last_trade_price")),
                            _n((o.get("iv") or 0) * 100, 1) or None, _n(o.get("delta"), 3), int(o.get("open_interest") or 0),
                            int(o.get("volume") or 0)]
                rows.append(row)
            chains.append({"d": exp, "rows": rows})
    tot = lambda key: sum(e[key] for e in exps)
    top = sorted(((oi, exp, k, cp) for exp, strikes in by_exp.items() for k, s in strikes.items()
                  for cp, oi in (("C", (s.get("C") or {}).get("open_interest") or 0), ("P", (s.get("P") or {}).get("open_interest") or 0))
                  if oi), reverse=True)[:12]
    return {"px": px, "chg": _n(d.get("price_change_percent"), 2), "iv30": _n(d.get("iv30"), 2), "iv30_chg": _n(d.get("iv30_change"), 2),
            "ts": payload.get("timestamp"), "c_vol": tot("c_vol"), "p_vol": tot("p_vol"), "c_oi": tot("c_oi"), "p_oi": tot("p_oi"),
            "pcr_vol": _n(tot("p_vol") / tot("c_vol"), 2) if tot("c_vol") else None,
            "pcr_oi": _n(tot("p_oi") / tot("c_oi"), 2) if tot("c_oi") else None,
            "cols": ["k", "c_bid", "c_ask", "c_last", "c_iv", "c_delta", "c_oi", "c_vol",
                     "p_bid", "p_ask", "p_last", "p_iv", "p_delta", "p_oi", "p_vol"],
            "exp": exps, "chains": chains, "top_oi": [[exp, k, cp, int(oi)] for oi, exp, k, cp in top]}


def us_market_open(now):
    return now.weekday() < 5 and 13 <= now.hour < 21


def fetch_cboe(sym):
    req = urllib.request.Request(CBOE_URL.format(sym=urllib.parse.quote(CBOE_SYM.get(sym, sym))),
                                 headers={"User-Agent": stocks.UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=40) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
    d = json.loads(raw)
    d["src"] = "cboe"
    return d


# ---------------------------------------------------------------------------
# Yahoo Finance: the fallback when Cboe refuses
# ---------------------------------------------------------------------------
_yahoo = None
_cboe_off_until = None


def yahoo_session():
    global _yahoo
    if _yahoo is None:
        import company
        _yahoo = company.Session()
    return _yahoo


def yahoo_json(sym, date_ts=None, session=None):
    s = session or yahoo_session()
    for attempt in (0, 1):
        if not s.crumb:
            s.yahoo_login()
        url = YAHOO_URL.format(sym=urllib.parse.quote(sym), crumb=urllib.parse.quote(s.crumb),
                               date=f"&date={int(date_ts)}" if date_ts else "")
        try:
            d = s.json(url)
        except urllib.error.HTTPError as e:
            if e.code == 401 and attempt == 0:
                s.crumb = None
                continue
            raise
        res = (d.get("optionChain") or {}).get("result") or []
        if not res or not isinstance(res[0], dict):
            raise RuntimeError("Yahoo: no options for " + sym)
        return res[0]
    raise RuntimeError("Yahoo: unauthorized")


def third_friday(d):
    return d.weekday() == 4 and 15 <= d.day <= 21


def pick_expiries(stamps, now, fast=False):
    out, near = [], 10 if fast else 6
    for t in sorted(int(x) for x in stamps if isinstance(x, (int, float))):
        d = datetime.fromtimestamp(t, timezone.utc).date()
        dte = (d - now.date()).days
        if dte < 0:
            continue
        if len(out) < near and dte <= 45:
            out.append(t)
        elif dte <= 92 and third_friday(d):
            out.append(t)
    return out[:13]


def yahoo_chain(sym, now=None, fast=False, session=None, sleep=0.25):
    import gex
    now = now or datetime.now(timezone.utc)
    ysym = YAHOO_SYM.get(sym) or stocks.yahoo_sym(sym)
    first = yahoo_json(ysym, session=session)
    q = first.get("quote") or {}
    px = _n(q.get("regularMarketPrice"), 6)
    if not px:
        raise ValueError("Yahoo: no price for " + sym)
    blocks = list(first.get("options") or [])
    have = {b.get("expirationDate") for b in blocks}
    for t in pick_expiries(first.get("expirationDates") or [], now, fast):
        if t in have:
            continue
        if sleep:
            time.sleep(sleep)
        try:
            blocks += yahoo_json(ysym, t, session=session).get("options") or []
        except Exception as e:
            print(f"  ! options {sym} (Yahoo, expiry {t}): {type(e).__name__}: {e}"[:200])
    opts = []
    for b in blocks:
        for side in ("calls", "puts"):
            for c in b.get(side) or []:
                code = c.get("contractSymbol")
                p = parse_occ(code)
                if not p:
                    continue
                iv = _n(c.get("impliedVolatility"), 6)
                T = (datetime.fromisoformat(p[0]).replace(hour=21, tzinfo=timezone.utc) - now).total_seconds() / (365 * 86400)
                g = gex.greeks(px, p[2], max(T, gex.MIN_T), iv, R_USD) if iv and gex.IV_MIN < iv < gex.IV_MAX and T > 0 else None
                opts.append({"option": code, "open_interest": int(c.get("openInterest") or 0), "volume": int(c.get("volume") or 0),
                             "iv": iv, "bid": _n(c.get("bid"), 4), "ask": _n(c.get("ask"), 4),
                             "last_trade_price": _n(c.get("lastPrice"), 4),
                             "delta": round(g["dc"] if p[1] == "C" else g["dp"], 4) if g else None})
    ts = q.get("regularMarketTime")
    stamp = datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d %H:%M:%S") if isinstance(ts, (int, float)) else None
    return {"timestamp": stamp, "src": "yahoo",
            "data": {"current_price": px, "price_change_percent": _n(q.get("regularMarketChangePercent"), 4),
                     "iv30": None, "iv30_change": None, "options": opts}}


def fetch(sym, now=None, fast=False):
    global _cboe_off_until
    now = now or datetime.now(timezone.utc)
    if not _cboe_off_until or now >= _cboe_off_until:
        try:
            return fetch_cboe(sym)
        except Exception as e:
            print(f"  ! options {sym} (Cboe): {type(e).__name__}: {e} — trying Yahoo"[:200])
            if isinstance(e, urllib.error.HTTPError) and e.code in (401, 403, 429):
                _cboe_off_until = now + timedelta(hours=6)
    return yahoo_chain(sym, now, fast)


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return {}


def write_gex(t, payload, now, gex_dir=None):
    import gex
    chain, S = gex.from_cboe(payload, now)
    if not chain or not S:
        return None
    snap = gex.analyze(chain, S, now, size=100, r=R_USD, band=GEX_BAND.get(t, 0.12), kind="equity")
    d = payload.get("data") or {}
    extra = {"chg": _n(d.get("price_change_percent"), 2), "ts": payload.get("timestamp"),
             "n": ETF_NAMES.get(t) or stocks.BY_TICKER.get(t, {}).get("n") or t}
    return gex.write(t, snap, now, payload.get("src") or "cboe", extra, out_dir=gex_dir,
                     intra_band=0.04 if t in FAST else 0.08)


def build(now=None, limit=5, sleep=1.0, tickers=None, out_dir=OPT_DIR, summary_path=SUMMARY, fetcher=None, gex_dir=None):
    now = now or datetime.now(timezone.utc)
    if tickers is None:
        tickers = list(CORE) + [t for t, *_ in stocks.UNIVERSE if t not in CORE]
    os.makedirs(out_dir, exist_ok=True)
    hot = us_market_open(now)
    due = []
    for t in tickers:
        age_h = (0.25 if t in FAST else 1) if (hot and t in CORE) else 20
        upd = load(os.path.join(out_dir, t + ".json")).get("updated", "")
        if upd < (now - timedelta(hours=age_h)).isoformat():
            due.append((0 if t in FAST else 1 if t in CORE else 2, upd, t))
    due.sort()
    order = [x for x in due if x[0] == 0] + [x for x in due if x[0] > 0][:limit]
    done = 0
    for _, _, t in order:
        try:
            payload = fetcher(t) if fetcher else fetch(t, now, fast=t in FAST)
            snap = summarize(payload, now.date())
            try:
                g = None
                if t in CORE:
                    g = write_gex(t, payload, now, gex_dir)
                elif snap.get("iv30") is None:
                    import gex
                    chain, S = gex.from_cboe(payload, now)
                    g = gex.analyze(chain, S, now, size=100, r=R_USD) if chain and S else None
                if g and snap.get("iv30") is None and (g.get("em") or {}).get("iv30"):
                    snap["iv30"] = round(g["em"]["iv30"] * 100, 2)
            except Exception as e:
                print(f"  ! GEX {t}: {type(e).__name__}: {e}"[:200])
            snap = {"s": t, "updated": now.isoformat(), "src": payload.get("src") or "cboe", **snap}
            with open(os.path.join(out_dir, t + ".json"), "w", encoding="utf-8") as f:
                json.dump(snap, f, separators=(",", ":"))
            done += 1
        except Exception as e:
            print(f"  ! options {t}: {type(e).__name__}: {e}"[:200])
        if sleep:
            time.sleep(sleep)
    if done or not os.path.exists(summary_path):
        write_summary(tickers, out_dir, summary_path, now)
    return done


def write_summary(tickers, out_dir, summary_path, now):
    rows = []
    for t in tickers:
        d = load(os.path.join(out_dir, t + ".json"))
        if not d:
            continue
        n = ETF_NAMES.get(t) or stocks.BY_TICKER.get(t, {}).get("n") or t
        rows.append({"s": t, "n": n, "px": d.get("px"), "chg": d.get("chg"), "iv30": d.get("iv30"), "iv30_chg": d.get("iv30_chg"),
                     "c_vol": d.get("c_vol"), "p_vol": d.get("p_vol"), "pcr_vol": d.get("pcr_vol"), "pcr_oi": d.get("pcr_oi"),
                     "updated": d.get("updated")})
    rows.sort(key=lambda r: -((r.get("c_vol") or 0) + (r.get("p_vol") or 0)))
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump({"updated": now.isoformat(), "rows": rows}, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    import sys
    print("option snapshots written:", build(tickers=sys.argv[1:] or None, limit=int(os.environ.get("LIMIT", "3"))))
