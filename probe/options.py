"""
Option chains for the terminal and the bot — the Bloomberg function OMON (option monitor).
Source: Cboe delayed quotes (free, no key, 15-minute delay) — the same data cboe.com shows.

Cboe gives the whole chain of a stock as one 1-15 MB file. That is too big for the bot server (it may use only
10 ms of CPU per request) and the browser cannot load it (no CORS), so this script keeps a small snapshot per
ticker: docs/opt/<TICKER>.json (summary per expiry + the strikes around the price for the nearest expiries)
and docs/options.json (one line per ticker for the overview).
"""
from __future__ import annotations

import gzip
import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

import stocks

HERE = os.path.dirname(os.path.abspath(__file__))
OPT_DIR = os.path.join(HERE, "docs", "opt")
SUMMARY = os.path.join(HERE, "docs", "options.json")
CBOE_URL = "https://cdn.cboe.com/api/global/delayed_quotes/options/{sym}.json"

# refreshed every hour while the US market is open; every other company of stocks.UNIVERSE once a day
CORE = ("SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "AMD", "NFLX",
        "JPM", "BAC", "XOM", "WMT", "COST", "LLY", "UNH", "V", "MA", "ORCL", "INTC", "PLTR")
ETF_NAMES = {"SPY": "SPDR S&P 500 ETF", "QQQ": "Invesco QQQ (Nasdaq-100)", "IWM": "iShares Russell 2000 ETF"}

OCC = re.compile(r"^(.+?)(\d{6})([CP])(\d{8})$")   # AAPL261016C00250000: root, YYMMDD, call/put, strike x 1000


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
    """The expiry price at which option holders lose the most (sum of payouts is the lowest)."""
    strikes = sorted(set(calls) | set(puts))
    best = None
    for p in strikes:
        pay = sum(oi * (p - k) for k, oi in calls.items() if p > k) + sum(oi * (k - p) for k, oi in puts.items() if k > p)
        if best is None or pay < best[0]:
            best = (pay, p)
    return best[1] if best else None


def summarize(payload, today, n_chain=4, width=0.15, max_rows=30):
    """The snapshot stored in docs/opt/<T>.json from Cboe's answer."""
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
    """Roughly the US session (13:30-20:00 UTC in summer, 14:30-21:00 in winter) with a margin, Mon-Fri."""
    return now.weekday() < 5 and 13 <= now.hour < 21


def fetch(sym):
    req = urllib.request.Request(CBOE_URL.format(sym=urllib.parse.quote(sym)),
                                 headers={"User-Agent": stocks.UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=40) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
    return json.loads(raw)


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return {}


def build(now=None, limit=5, sleep=1.0, tickers=None, out_dir=OPT_DIR, summary_path=SUMMARY, fetcher=fetch):
    """Refreshes the stalest snapshots. Returns how many were written."""
    now = now or datetime.now(timezone.utc)
    if tickers is None:
        tickers = list(CORE) + [t for t, *_ in stocks.UNIVERSE if t not in CORE]
    os.makedirs(out_dir, exist_ok=True)
    hot = us_market_open(now)
    due = []
    for t in tickers:
        age_h = 1 if (hot and t in CORE) else 20
        upd = load(os.path.join(out_dir, t + ".json")).get("updated", "")
        if upd < (now - timedelta(hours=age_h)).isoformat():
            due.append((upd, t))
    done = 0
    for _, t in sorted(due)[:limit]:
        try:
            snap = summarize(fetcher(t), now.date())
            snap = {"s": t, "updated": now.isoformat(), **snap}
            with open(os.path.join(out_dir, t + ".json"), "w", encoding="utf-8") as f:
                json.dump(snap, f, separators=(",", ":"))
            done += 1
        except Exception as e:
            print(f"  ! options {t}: {type(e).__name__}: {e}"[:200])
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
