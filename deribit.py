"""
Bitcoin and Ether options from Deribit (the largest crypto options exchange) for GEX, VOLS, GRK and GEXH,
and DVOL — Deribit's 30-day implied volatility index ("the VIX of bitcoin").

Public market data: no key, no account. One request gives every listed option of a coin with its open interest,
mark implied volatility and the price of its expiry's future; the greeks are computed in gex.py.
Deribit does not allow browsers (no CORS), so the bot reads it and the terminal gets docs/gex/BTC.json, ETH.json.
Contract size: 1 coin, so GEX here is in dollars per 1% move like for US options.
"""
from __future__ import annotations

import gzip
import json
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import gex

API = "https://www.deribit.com/api/v2/public/"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
COINS = ("BTC", "ETH")
NAMES = {"BTC": "Bitcoin options (Deribit)", "ETH": "Ether options (Deribit)"}
EVERY_MIN = 15
MONTHS = {m: i + 1 for i, m in enumerate(("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"))}


def get(path, params, timeout=30):
    url = API + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
    d = json.loads(raw)
    if not isinstance(d, dict) or "result" not in d:
        raise ValueError("Deribit: " + str((d or {}).get("error") if isinstance(d, dict) else "bad answer")[:100])
    return d["result"]


def parse_name(name):
    """BTC-27NOV26-60000-C → ('2026-11-27', 'C', 60000.0); None for anything else."""
    try:
        coin, exp, k, cp = str(name).split("-")
        day, mon, yy = int(exp[:-5]), MONTHS[exp[-5:-2]], int(exp[-2:])
        if cp not in ("C", "P"):
            return None
        return f"{2000 + yy:04d}-{mon:02d}-{day:02d}", cp, float(k)
    except (ValueError, KeyError, IndexError):
        return None


def chain_from(summary, now):
    """Deribit's book summary → normalized options (expiry at 08:00 UTC, implied volatility in %)."""
    out = []
    for x in summary or []:
        if not isinstance(x, dict):
            continue
        p = parse_name(x.get("instrument_name"))
        if not p:
            continue
        exp, cp, k = p
        t_exp = datetime.fromisoformat(exp).replace(hour=8, tzinfo=timezone.utc)
        T = (t_exp - now).total_seconds() / (365 * 86400)
        if T <= 0:
            continue
        iv = x.get("mark_iv")
        iv = iv / 100 if isinstance(iv, (int, float)) and iv > 0 else None
        S = x.get("underlying_price") if isinstance(x.get("underlying_price"), (int, float)) else None
        out.append(gex.option(exp, cp, k, T, oi=x.get("open_interest") or 0, iv=iv, vol=x.get("volume") or 0,
                              bid=x.get("bid_price"), ask=x.get("ask_price"), last=x.get("mark_price"), S=S))
    return out


def dvol_series(rows):
    """[[ms, open, high, low, close], ...] → [[iso hour, close], ...]"""
    out = []
    for r in rows or []:
        if isinstance(r, list) and len(r) >= 5 and isinstance(r[4], (int, float)):
            out.append([datetime.fromtimestamp(r[0] / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M"), round(r[4], 2)])
    return out[-24 * 7:]


def build(now=None, out_dir=None, fetcher=get, every_min=EVERY_MIN, sleep=0.5):
    """Refreshes BTC and ETH every 15 minutes. Returns how many were written."""
    now = now or datetime.now(timezone.utc)
    out_dir = out_dir or gex.GEX_DIR
    done = 0
    for coin in COINS:
        path = os.path.join(out_dir, coin + ".json")
        if gex.load(path).get("updated", "") > (now - timedelta(minutes=every_min - 1)).isoformat():
            continue
        try:
            summary = fetcher("get_book_summary_by_currency", {"currency": coin, "kind": "option"})
            idx = fetcher("get_index_price", {"index_name": coin.lower() + "_usd"})
            S = (idx or {}).get("index_price")
            if not isinstance(S, (int, float)) or S <= 0:
                raise ValueError("no index price")
            chain = chain_from(summary, now)
            snap = gex.analyze(chain, S, now, size=1.0, r=0.0, band=0.25, kind="crypto", prof_band=0.2)
            extra = {"n": NAMES[coin], "ts": now.strftime("%Y-%m-%d %H:%M:%S")}
            try:
                dv = fetcher("get_volatility_index_data", {"currency": coin, "resolution": 3600,
                                                          "start_timestamp": int((now - timedelta(days=7)).timestamp() * 1000),
                                                          "end_timestamp": int(now.timestamp() * 1000)})
                series = dvol_series((dv or {}).get("data"))
                if series:
                    extra["dvol"] = series[-1][1]
                    extra["dvol_hist"] = series
            except Exception as e:
                print(f"  ! DVOL {coin}: {type(e).__name__}: {e}"[:200])
            gex.write(coin, snap, now, "deribit", extra, out_dir=out_dir, intra_band=0.1)
            done += 1
        except Exception as e:
            print(f"  ! Deribit {coin}: {type(e).__name__}: {e}"[:200])
        if sleep:
            time.sleep(sleep)
    return done


if __name__ == "__main__":
    print("crypto option snapshots written:", build())
