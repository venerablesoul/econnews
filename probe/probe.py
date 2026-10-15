"""Probe round 9: the real builders (company.py, options.py, macro.py, moex.py) against the live sources."""
import json, os, sys, tempfile, time, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import company, options, macro, moex
OUT = {}
tmp = tempfile.mkdtemp()


def run(name, fn):
    t = time.time()
    try:
        OUT[name] = {"ok": True, "res": fn(), "sec": round(time.time() - t, 1)}
    except Exception:
        OUT[name] = {"ok": False, "err": traceback.format_exc()[-1500:], "sec": round(time.time() - t, 1)}


def co():
    n = company.build(tickers=["AAPL", "BRK.B", "KO", "JPM"], limit=4, out_dir=tmp, sleep=0.5)
    res = {"written": n}
    for t in ("AAPL", "BRK.B", "KO", "JPM"):
        d = company.load(os.path.join(tmp, t + ".json"))
        res[t] = {"bytes": len(json.dumps(d, ensure_ascii=False)), "keys": sorted(d), "wiki": {k: (v or {}).get("t") for k, v in (d.get("wiki") or {}).items()},
                  "funds": [x.get("n") for x in (d.get("holders") or {}).get("funds", [])[:3]], "div_n": len((d.get("div") or {}).get("hist", [])),
                  "short_rows": len((d.get("short") or {}).get("rows", [])), "est": [e.get("p") for e in d.get("est", [])], "targets": d.get("targets"),
                  "filings": (d.get("filings") or [])[:2], "ratings": (d.get("ratings") or [])[:2]}
    return res


def opt():
    s = os.path.join(tmp, "options.json")
    n = options.build(tickers=["AAPL", "SPY", "BRK.B", "TSLA"], limit=4, out_dir=tmp, summary_path=s, sleep=0.5)
    d = options.load(os.path.join(tmp, "AAPL.json"))
    return {"written": n, "summary": options.load(s), "aapl_bytes": len(json.dumps(d)), "aapl_exp": d.get("exp", [])[:3],
            "aapl_chain0": (d.get("chains") or [{}])[0].get("rows", [])[:3], "spy_bytes": os.path.getsize(os.path.join(tmp, "SPY.json")) if os.path.exists(os.path.join(tmp, "SPY.json")) else None}


def mac():
    p = os.path.join(tmp, "macro.json")
    n = macro.build(path=p, max_age_h=0)
    d = macro.load(p) if hasattr(macro, "load") else json.load(open(p))
    return {"written": n, "years": d.get("years"), "ind": list(d.get("ind", {})), "usa": next((r for r in d.get("rows", []) if r["c"] == "USA"), None),
            "missing": [c for c in macro.COUNTRIES if c not in {r["c"] for r in d.get("rows", [])}], "bytes": os.path.getsize(p)}


def mx():
    p = os.path.join(tmp, "moex.json")
    n = moex.build(path=p, max_age_min=0)
    d = json.load(open(p)) if os.path.exists(p) else {}
    rows = d.get("rows", [])
    return {"written": n, "time": d.get("time"), "n": len(rows), "top": rows[:5], "no_sector": [r["s"] for r in rows if not r.get("sec") and r.get("w")],
            "bytes": os.path.getsize(p) if os.path.exists(p) else None}


run("company", co)
run("options", opt)
run("macro", mac)
run("moex", mx)
with open("probe/out4.json", "w") as f:
    json.dump(OUT, f, ensure_ascii=False, indent=1, default=str)
