import json, random, time


def depth():
    r = random.Random(1)
    mid = 61280
    return {"lastUpdateId": 1000, "bids": [[f"{mid - 1 - i:.2f}", f"{r.random() * (30 if i % 50 == 0 else 2):.4f}"] for i in range(1000)],
            "asks": [[f"{mid + 1 + i:.2f}", f"{r.random() * (30 if i % 50 == 0 else 2):.4f}"] for i in range(1000)]}


def agg(limit=1000, from_id=None):
    r = random.Random(from_id or 2)
    now = int(time.time() * 1000)
    start = from_id if from_id is not None else 899000
    out = []
    for i in range(limit):
        a = start + i
        if a >= 900000:
            break
        out.append({"a": a, "p": f"{61280 + r.uniform(-40, 40):.2f}", "q": f"{r.random() * (8 if r.random() < 0.01 else 0.4):.5f}",
                    "f": a, "l": a, "T": now - (900000 - a) * 300, "m": r.random() < 0.5, "M": True})
    return out


def klines(interval="1m", limit=500):
    r = random.Random(3)
    span = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600}.get(interval, 60) * 1000
    now = int(time.time() * 1000) // span * span
    px, out = 60500.0, []
    for i in range(limit):
        t = now - (limit - 1 - i) * span
        o = px
        px *= 1 + r.uniform(-0.002, 0.002)
        v = r.uniform(5, 80)
        tb = v * r.uniform(0.3, 0.7)
        out.append([t, f"{o:.2f}", f"{max(o, px) * 1.0008:.2f}", f"{min(o, px) * 0.9992:.2f}", f"{px:.2f}", f"{v:.5f}", t + span - 1, "0", 100, f"{tb:.5f}", "0", "0"])
    return out


def answer(url):
    from urllib.parse import urlparse, parse_qs
    u = urlparse(url)
    q = {k: v[0] for k, v in parse_qs(u.query).items()}
    if u.path.endswith("/api/v3/depth"):
        return depth()
    if u.path.endswith("/api/v3/aggTrades"):
        return agg(int(q.get("limit", 500)), int(q["fromId"]) if "fromId" in q else None)
    if u.path.endswith("/api/v3/klines"):
        return klines(q.get("interval", "1m"), int(q.get("limit", 500)))
    return None
