"""
Dealer positioning from option chains — the terminal's GEX, VOLS, GRK and GEXH functions and the levels in the
bot's pre-market brief.

Input: a normalized chain (see `option()` below) from options.py (Cboe or Yahoo: US stocks, ETFs, the SPX and NDX
indexes) or deribit.py (BTC and ETH options). Greeks are computed with Black-Scholes from each option's implied
volatility, so every source is treated alike.

The public convention used by most GEX services: dealers are assumed to be long the calls and short the puts that
the public trades, so call gamma counts +, put gamma −. It is an estimate from open interest, not real positions.
  GEX   = gamma × open interest × contract size × spot² × 1%   — $ of delta dealers trade per 1% move
  vanna = Δdelta per 1 volatility point × OI × size × spot      — $ of delta when volatility moves 1 point
  charm = Δdelta per day × OI × size × spot                     — $ of delta that one day of time decay adds

Output: docs/gex/<SYM>.json (the snapshot the terminal draws) and docs/gex/hist/<SYM>.json (intraday snapshots of
the last sessions for the interval map, and one line per day for the history).
Python standard library only.
"""
from __future__ import annotations

import json
import math
import os
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
GEX_DIR = os.path.join(HERE, "docs", "gex")
HIST_DIR = os.path.join(GEX_DIR, "hist")

SQ2PI = math.sqrt(2 * math.pi)
MIN_T = 2 / 24 / 365          # an option that expires in less than 2 hours counts as 2 hours (gamma would explode)
MAX_DTE = 120                 # exposures: expiries within ~4 months carry almost all of the gamma
IV_MIN, IV_MAX = 0.01, 5.0    # implied volatility outside this range is a broken quote


def npdf(x):
    return math.exp(-0.5 * x * x) / SQ2PI


def ncdf(x):
    return 0.5 * math.erfc(-x / math.sqrt(2))


def greeks(S, K, T, sig, r=0.0):
    """Black-Scholes greeks without dividends. T in years, sig a fraction (0.25 = 25%).
    Returns None for impossible inputs. Theta and charm per calendar day, vega and vanna per 1 volatility point."""
    if None in (S, K, T, sig) or not (S > 0 and K > 0 and T > 0 and sig > 0):
        return None
    sq = math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * sig * sig) * T) / (sig * sq)
    d2 = d1 - sig * sq
    pd1, disc = npdf(d1), math.exp(-r * T)
    dc = ncdf(d1)
    common = -S * pd1 * sig / (2 * sq)
    return {
        "dc": dc, "dp": dc - 1,
        "g": pd1 / (S * sig * sq),
        "v": S * pd1 * sq / 100,
        "tc": (common - r * K * disc * ncdf(d2)) / 365,
        "tp": (common + r * K * disc * ncdf(-d2)) / 365,
        "vanna": -pd1 * d2 / sig / 100,
        "charm": -pd1 * (2 * r * T - d2 * sig * sq) / (2 * T * sig * sq) / 365,
    }


def gamma_only(S, K, T, sig, r=0.0):
    if None in (S, K, T, sig) or not (S > 0 and K > 0 and T > 0 and sig > 0):
        return 0.0
    sq = math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * sig * sig) * T) / (sig * sq)
    return npdf(d1) / (S * sig * sq)


def sig(x, n=4):
    """Rounds to n significant digits (keeps the files small)."""
    if x is None or x != x or x in (float("inf"), float("-inf")):
        return None
    if x == 0:
        return 0
    return float(f"{x:.{n}g}")


def r2(x):
    return None if x is None else round(x, 2)


def option(exp, cp, k, T, oi=0, iv=None, vol=0, bid=None, ask=None, last=None, S=None):
    """One option of a normalized chain. exp — 'YYYY-MM-DD', cp — 'C'/'P', T — years to expiry, iv — a fraction.
    S — the price this option is priced from (Deribit: the future of its expiry); None = the chain's spot."""
    return {"exp": exp, "cp": cp, "k": float(k), "T": max(T, MIN_T), "oi": float(oi or 0), "iv": iv, "vol": vol or 0,
            "bid": bid, "ask": ask, "last": last, "S": S}


def mid(o):
    b, a = o.get("bid"), o.get("ask")
    if b is not None and a and a >= b >= 0:
        return (a + b) / 2
    return o.get("last")


def interp(xs, ys, x):
    """Linear interpolation over sorted xs; None outside the range."""
    if not xs:
        return None
    if x < xs[0] or x > xs[-1]:
        return None
    for i in range(1, len(xs)):
        if x <= xs[i]:
            x0, x1, y0, y1 = xs[i - 1], xs[i], ys[i - 1], ys[i]
            return y0 if x1 == x0 else y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return ys[-1]


def smile(opts, S):
    """The volatility smile of one expiry: out-of-the-money options (puts below the price, calls above)."""
    pts = {}
    for o in opts:
        iv = o["iv"]
        if iv is None or not IV_MIN < iv < IV_MAX:
            continue
        if (o["cp"] == "P" and o["k"] <= S) or (o["cp"] == "C" and o["k"] >= S):
            pts.setdefault(o["k"], []).append(iv)
    ks = sorted(pts)
    return ks, [sum(pts[k]) / len(pts[k]) for k in ks]


def atm_iv(ks, ivs, S):
    if not ks:
        return None
    v = interp(ks, ivs, S)
    if v is None:   # the price is outside the strikes with quotes: the nearest one
        v = ivs[0] if S < ks[0] else ivs[-1]
    return v


def iv_at_days(term, days):
    """Implied volatility for `days` from the term structure, interpolated in total variance."""
    pts = [(t[1], t[2]) for t in term if t[2] and t[1] is not None]
    if not pts:
        return None
    pts.sort()
    if days <= pts[0][0]:
        return pts[0][1]
    if days >= pts[-1][0]:
        return pts[-1][1]
    for (d0, v0), (d1, v1) in zip(pts, pts[1:]):
        if d0 <= days <= d1:
            d0, d1 = max(d0, 0.5), max(d1, 0.5)
            w0, w1 = v0 * v0 * d0, v1 * v1 * d1
            w = w0 + (w1 - w0) * (days - d0) / (d1 - d0) if d1 != d0 else w0
            return math.sqrt(max(w, 0) / max(days, 0.5))
    return pts[-1][1]


def analyze(chain, S, now, size=100.0, r=0.0, band=0.1, kind="equity", max_strikes=80, grid=61, prof_band=None):
    """Everything the terminal shows for one underlying, from a normalized chain at spot S."""
    by_exp = {}
    for o in chain:
        if o["k"] > 0:
            by_exp.setdefault(o["exp"], []).append(o)
    exps = sorted(by_exp)
    if not exps or not S:
        raise ValueError("no options")
    today = now.date().isoformat()
    year_days = 365 if kind == "crypto" else 252

    # the smile of each expiry; options without a usable volatility borrow it from the smile
    term, smiles = [], {}
    for e in exps:
        opts = by_exp[e]
        Se = next((o["S"] for o in opts if o.get("S")), S)
        ks, ivs = smile(opts, Se)
        smiles[e] = (ks, ivs, Se)
        T = opts[0]["T"]
        a = atm_iv(ks, ivs, Se)
        # the at-the-money straddle: the market's expected move by that expiry
        near = min({o["k"] for o in opts}, key=lambda k: abs(k - Se))
        c = next((o for o in opts if o["k"] == near and o["cp"] == "C"), None)
        p = next((o for o in opts if o["k"] == near and o["cp"] == "P"), None)
        st = (mid(c) or 0) + (mid(p) or 0) if c and p and mid(c) is not None and mid(p) is not None else None
        if st is not None and kind == "crypto":   # Deribit prices options in coins
            st *= Se
        term.append([e, round(T * 365, 2), sig(a, 4), sig(st, 4)])
    for e in exps:
        ks, ivs, Se = smiles[e]
        for o in by_exp[e]:
            iv = o["iv"]
            if iv is None or not IV_MIN < iv < IV_MAX:
                v = interp(ks, ivs, o["k"])
                if v is None and ks:
                    v = ivs[0] if o["k"] < ks[0] else ivs[-1]
                o["iv_used"] = v
            else:
                o["iv_used"] = iv

    use = [o for o in chain if o["T"] * 365 <= MAX_DTE and o.get("iv_used") and o["oi"] > 0]
    front = exps[0] if exps[0] >= today else next((e for e in exps if e >= today), exps[0])

    # exposures by strike
    agg = {}
    tot = {"gex": 0.0, "gex_front": 0.0, "vex": 0.0, "cex": 0.0, "c_oi": 0.0, "p_oi": 0.0}
    for o in use:
        So = o.get("S") or S
        g = greeks(So, o["k"], o["T"], o["iv_used"], r)
        if not g:
            continue
        s = 1 if o["cp"] == "C" else -1
        gx = s * g["g"] * o["oi"] * size * S * S * 0.01
        vx = s * g["vanna"] * o["oi"] * size * S
        cx = s * g["charm"] * o["oi"] * size * S
        a = agg.setdefault(o["k"], {"gc": 0.0, "gp": 0.0, "gf": 0.0, "vx": 0.0, "cx": 0.0, "oc": 0.0, "op": 0.0})
        if s > 0:
            a["gc"] += gx
            a["oc"] += o["oi"]
            tot["c_oi"] += o["oi"]
        else:
            a["gp"] += gx
            a["op"] += o["oi"]
            tot["p_oi"] += o["oi"]
        a["vx"] += vx
        a["cx"] += cx
        tot["gex"] += gx
        tot["vex"] += vx
        tot["cex"] += cx
        if o["exp"] == front:
            a["gf"] += gx
            tot["gex_front"] += gx
    if not agg:
        raise ValueError("no open interest")

    # levels
    ks_all = sorted(agg)
    net = {k: agg[k]["gc"] + agg[k]["gp"] for k in ks_all}
    cwall = max(ks_all, key=lambda k: agg[k]["gc"])
    pwall = min(ks_all, key=lambda k: agg[k]["gp"])
    pos = max(ks_all, key=lambda k: net[k])
    neg = min(ks_all, key=lambda k: net[k])

    # total GEX if the price moved to x: where it crosses zero is the "gamma flip"
    pb = prof_band or max(band, 0.05)
    xs = [S * (1 - pb + 2 * pb * i / (grid - 1)) for i in range(grid)]
    ys = []
    # strikes far from every price of the grid add almost no gamma: left out, the profile of a whole SPX chain stays fast
    near_use = [o for o in use if abs(o["k"] / S - 1) <= pb + 0.2]
    for x in xs:
        t = 0.0
        for o in near_use:
            # Deribit options are priced from their expiry's future: move it together with the index
            So = (o.get("S") or S) * x / S
            t += (1 if o["cp"] == "C" else -1) * gamma_only(So, o["k"], o["T"], o["iv_used"], r) * o["oi"] * size * x * x * 0.01
        ys.append(t)
    zero = None
    for i in range(1, grid):
        if (ys[i - 1] < 0) != (ys[i] < 0):
            x0 = xs[i - 1] + (xs[i] - xs[i - 1]) * (0 - ys[i - 1]) / (ys[i] - ys[i - 1])
            if zero is None or abs(x0 - S) < abs(zero - S):
                zero = x0

    # max pain of the front expiry
    fo = by_exp[front]
    c_oi = {}
    p_oi = {}
    for o in fo:
        (c_oi if o["cp"] == "C" else p_oi)[o["k"]] = (c_oi if o["cp"] == "C" else p_oi).get(o["k"], 0) + o["oi"]
    pain = None
    best = None
    for p in sorted(set(c_oi) | set(p_oi)):
        pay = sum(oi * (p - k) for k, oi in c_oi.items() if p > k) + sum(oi * (k - p) for k, oi in p_oi.items() if k > p)
        if best is None or pay < best:
            best, pain = pay, p

    # expected move: 30-day implied volatility → one standard deviation for a day and a week
    iv30 = iv_at_days(term, 30)
    fr = next((t for t in term if t[0] == front), None)
    em = {"iv30": sig(iv30, 4), "front": front}
    if iv30:
        sd = S * iv30 / math.sqrt(year_days)
        em.update({"d1": sig(sd, 5), "d1_pct": r2(sd / S * 100), "w1": sig(sd * math.sqrt(5 if kind != "crypto" else 7), 5)})
    if fr and fr[3]:
        em.update({"straddle": fr[3], "straddle_pct": r2(fr[3] / S * 100)})

    # the strikes shown: the nearest to the price within the band
    show = [k for k in ks_all if abs(k / S - 1) <= band]
    if len(show) > max_strikes:
        show = sorted(sorted(show, key=lambda k: abs(k - S))[:max_strikes])
    if not show:
        show = sorted(ks_all, key=lambda k: abs(k - S))[:min(max_strikes, len(ks_all))]
        show.sort()

    # the volatility surface: moneyness × expiry
    if kind == "crypto":
        mgrid = [round(0.6 + 0.05 * i, 3) for i in range(19)]
    else:
        mgrid = [round(0.8 + 0.025 * i, 3) for i in range(17)]
    surf_exps = [e for e in exps if e >= today][:14]
    surf = {"m": mgrid, "d": [], "dte": [], "iv": []}
    for e in surf_exps:
        ks, ivs, Se = smiles[e]
        if len(ks) < 3:
            continue
        row = [sig(interp(ks, ivs, m * Se), 4) for m in mgrid]
        if sum(1 for v in row if v) < 3:
            continue
        surf["d"].append(e)
        surf["dte"].append(round(by_exp[e][0]["T"] * 365, 2))
        surf["iv"].append(row)

    # greeks: expiry × strike near the money
    g_exps = [e for e in exps if e >= today][:8]
    near_ks = set()
    for e in g_exps:
        near_ks.update(o["k"] for o in by_exp[e] if abs(o["k"] / S - 1) <= (0.25 if kind == "crypto" else 0.08))
    gk = sorted(sorted(near_ks, key=lambda k: abs(k - S))[:31])
    grk = {"d": g_exps, "k": gk, "dc": [], "dp": [], "g": [], "tc": [], "tp": [], "v": []}
    for e in g_exps:
        T = by_exp[e][0]["T"]
        ks, ivs, Se = smiles[e]
        have = {o["k"] for o in by_exp[e]}
        rows = {x: [] for x in ("dc", "dp", "g", "tc", "tp", "v")}
        for k in gk:
            iv = None
            if k in have:
                iv = interp(ks, ivs, k)
                if iv is None and ks:
                    iv = ivs[0] if k < ks[0] else ivs[-1]
            gg = greeks(Se, k, T, iv, r) if iv else None
            if gg:
                gg = dict(gg, g=gg["g"] * Se * 0.01)   # gamma as the change of delta per 1% move (readable for any price)
            for x in rows:
                rows[x].append(sig(gg[x], 4) if gg else None)
        for x in rows:
            grk[x].append(rows[x])

    out = {
        "kind": kind, "px": sig(S, 7), "size": size,
        "levels": {"zero": sig(zero, 6), "cwall": cwall, "pwall": pwall, "pos": pos, "neg": neg, "pain": pain, "pain_d": front},
        "tot": {k: sig(v, 4) for k, v in tot.items()},
        "em": em,
        "k": show,
        "gc": [sig(agg[k]["gc"], 4) for k in show], "gp": [sig(agg[k]["gp"], 4) for k in show],
        "gf": [sig(agg[k]["gf"], 4) for k in show], "vx": [sig(agg[k]["vx"], 4) for k in show],
        "cx": [sig(agg[k]["cx"], 4) for k in show], "oc": [round(agg[k]["oc"], 1) for k in show],
        "op": [round(agg[k]["op"], 1) for k in show],
        "prof": {"x": [sig(x, 6) for x in xs], "y": [sig(y, 4) for y in ys]},
        "term": [t for t in term if t[0] >= today][:24],
        "surf": surf, "grk": grk, "n_exp": len([e for e in exps if e >= today]),
    }
    out["tot"]["pcr_oi"] = r2(tot["p_oi"] / tot["c_oi"]) if tot["c_oi"] else None
    return out


# ---------------------------------------------------------------------------
# files
# ---------------------------------------------------------------------------
def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return {}


def dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def session_day(now, kind):
    """The trading day a snapshot belongs to: New York's date for US options, UTC for crypto."""
    if kind == "crypto":
        return now.astimezone(timezone.utc).date().isoformat()
    # New York: UTC−5 in winter, UTC−4 in summer (second Sunday of March .. first Sunday of November)
    y = now.year
    mar = datetime(y, 3, 8, 7, tzinfo=timezone.utc)
    nov = datetime(y, 11, 1, 6, tzinfo=timezone.utc)
    start = mar + timedelta(days=(6 - mar.weekday()) % 7)
    end = nov + timedelta(days=(6 - nov.weekday()) % 7)
    off = -4 if start <= now < end else -5
    return (now + timedelta(hours=off)).date().isoformat()


def write(sym, snap, now, src, extra=None, out_dir=None, hist_dir=None, intra_days=5, intra_band=0.04, keep_days=750):
    """Saves the snapshot and adds it to the history. Returns the stored snapshot."""
    out_dir = out_dir or GEX_DIR
    hist_dir = hist_dir or os.path.join(out_dir, "hist")
    doc = {"s": sym, "updated": now.isoformat(), "src": src, **snap, **(extra or {})}
    dump(os.path.join(out_dir, sym + ".json"), doc)

    path = os.path.join(hist_dir, sym + ".json")
    h = load(path)
    S = snap["px"]
    day = session_day(now, snap.get("kind"))
    near = [(k, n) for k, n in zip(snap["k"], [(c or 0) + (p or 0) for c, p in zip(snap["gc"], snap["gp"])])
            if abs(k / S - 1) <= intra_band]
    lv, em = snap["levels"], snap["em"]
    pt = {"t": now.isoformat(), "day": day, "px": S, "k": [k for k, _ in near], "g": [sig(n, 3) for _, n in near],
          "zero": lv.get("zero"), "cw": lv.get("cwall"), "pw": lv.get("pwall"), "gex": snap["tot"].get("gex"),
          "iv": em.get("iv30"), "st": em.get("straddle_pct")}
    intra = [x for x in h.get("intra") or [] if x.get("t", "") < pt["t"]] + [pt]
    days_kept = sorted({x.get("day") for x in intra})[-intra_days:]
    intra = [x for x in intra if x.get("day") in days_kept][-400:]
    row = {"d": day, "px": S, "gex": snap["tot"].get("gex"), "zero": lv.get("zero"), "cw": lv.get("cwall"),
           "pw": lv.get("pwall"), "iv": em.get("iv30"), "em": em.get("d1_pct")}
    days = [x for x in h.get("days") or [] if x.get("d") != day] + [row]
    days.sort(key=lambda x: x["d"])
    dump(path, {"s": sym, "updated": now.isoformat(), "intra": intra, "days": days[-keep_days:]})
    return doc


def from_cboe(payload, now, close_utc_hour=21):
    """Cboe-shaped chain (also Yahoo's, converted by options.py) → normalized options and the spot."""
    import options as opt_mod
    d = (payload or {}).get("data") or {}
    S = opt_mod._n(d.get("current_price"), 6) or opt_mod._n(d.get("close"), 6)
    chain = []
    for o in d.get("options") or []:
        p = opt_mod.parse_occ(o.get("option"))
        if not p:
            continue
        exp, cp, k = p
        t_exp = datetime.fromisoformat(exp).replace(hour=close_utc_hour, tzinfo=timezone.utc)
        T = (t_exp - now).total_seconds() / (365 * 86400)
        if T <= 0:   # expired already (a chain read after the close still lists today's expiry)
            continue
        iv = o.get("iv")
        try:
            iv = float(iv) if iv is not None else None
        except (TypeError, ValueError):
            iv = None
        chain.append(option(exp, cp, k, T, oi=o.get("open_interest") or 0, iv=iv, vol=o.get("volume") or 0,
                            bid=o.get("bid"), ask=o.get("ask"), last=o.get("last_trade_price")))
    return chain, S
