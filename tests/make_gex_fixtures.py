"""Builds the option-analytics fixtures of the terminal tests (tests/fixtures/pages/gex/) with the real gex.py code:
a made-up S&P 500 chain (a realistic shape of open interest and skew) and the Deribit sample saved from the live
source (tests/fixtures/live). Run again after a change of gex.py: python3 tests/make_gex_fixtures.py"""
import json
import math
import os
import random
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import deribit  # noqa: E402
import gex      # noqa: E402

OUT = os.path.join(HERE, "fixtures", "pages", "gex")


def spx_chain(now, S):
    rnd = random.Random(7)
    out = []
    exps = []
    d = now.date()
    while len(exps) < 12:
        d += timedelta(days=1)
        if d.weekday() < 5:
            exps.append(d)
    for m in (1, 2, 3):   # three monthly expiries
        exps.append((now + timedelta(days=30 * m)).date())
    for e in exps:
        T = (datetime(e.year, e.month, e.day, 21, tzinfo=timezone.utc) - now).total_seconds() / (365 * 86400)
        for k in range(int(S * 0.85) // 25 * 25, int(S * 1.15), 25):
            m = k / S - 1
            iv = 0.16 - 0.55 * m + 1.8 * m * m + 0.02 / math.sqrt(max(T * 365, 1))
            base = 4000 * math.exp(-abs(m) * 25)
            coi = base * (2.2 if 0.005 < m < 0.03 else 1) * (2.5 if k % 100 == 0 and m > 0 else 1) * rnd.uniform(0.6, 1.4) * 1.4
            poi = base * (1.8 if -0.05 < m < -0.02 else 1) * (2.5 if k % 100 == 50 and m < 0 else 1) * rnd.uniform(0.6, 1.4) * 1.4
            out.append(gex.option(e.isoformat(), "C", k, T, oi=round(coi), iv=iv, bid=1, ask=1.1))
            out.append(gex.option(e.isoformat(), "P", k, T, oi=round(poi), iv=iv + 0.01, bid=1, ask=1.1))
    return out


def main():
    os.makedirs(os.path.join(OUT, "hist"), exist_ok=True)
    base = datetime(2026, 11, 20, 14, 45, tzinfo=timezone.utc)
    for f in ("SPX.json", "BTC.json", os.path.join("hist", "SPX.json"), os.path.join("hist", "BTC.json")):
        p = os.path.join(OUT, f)
        if os.path.exists(p):
            os.remove(p)
    # three sessions of 15-minute snapshots for the interval map and a year of days
    S = 6700.0
    for day in range(3):
        for q in range(26):
            now = base + timedelta(days=day, minutes=15 * q)
            S += math.sin(q / 3 + day) * 6
            snap = gex.analyze(spx_chain(now, S), S, now, size=100, r=0.04, band=0.06)
            gex.write("SPX", snap, now, "yahoo", {"n": "S&P 500 index", "chg": 0.42, "ts": now.strftime("%Y-%m-%d %H:%M:%S")}, out_dir=OUT)
    h = gex.load(os.path.join(OUT, "hist", "SPX.json"))
    rnd = random.Random(3)
    days = []
    px = 5900.0
    for i in range(240):
        d = (base - timedelta(days=240 - i)).date().isoformat()
        px *= 1 + rnd.uniform(-0.012, 0.013)
        days.append({"d": d, "px": round(px, 2), "gex": rnd.uniform(-4e9, 7e9), "zero": round(px * rnd.uniform(0.98, 1.0), 1),
                     "cw": round(px * 1.02 / 25) * 25, "pw": round(px * 0.97 / 25) * 25, "iv": rnd.uniform(0.12, 0.22), "em": 1.0})
    h["days"] = days + h["days"]
    gex.dump(os.path.join(OUT, "hist", "SPX.json"), h)
    # bitcoin from the live Deribit sample
    fx = os.path.join(HERE, "fixtures", "live")
    book = json.load(open(os.path.join(fx, "deribit_btc_book.json")))["result"]
    S = json.load(open(os.path.join(fx, "deribit_btc_index.json")))["result"]["index_price"]
    dv = deribit.dvol_series(json.load(open(os.path.join(fx, "deribit_dvol.json")))["result"]["data"])
    now = datetime(2026, 11, 23, 13, 26, tzinfo=timezone.utc)
    snap = gex.analyze(deribit.chain_from(book, now), S, now, size=1.0, kind="crypto", band=0.25, prof_band=0.2)
    gex.write("BTC", snap, now, "deribit", {"n": deribit.NAMES["BTC"], "ts": now.strftime("%Y-%m-%d %H:%M:%S"), "dvol": dv[-1][1], "dvol_hist": dv}, out_dir=OUT)
    for f in sorted(os.listdir(OUT)) + ["hist/" + x for x in sorted(os.listdir(os.path.join(OUT, "hist")))]:
        p = os.path.join(OUT, f)
        if os.path.isfile(p):
            print(f, os.path.getsize(p))


if __name__ == "__main__":
    main()
