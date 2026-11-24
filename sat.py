"""
Satellite images of the world's main oil storage hubs — the terminal's SAT panel and the map's oil storage layer.

Source: Copernicus Sentinel-2 (ESA), level 2A, true colour, 10 m per pixel; a new pass every 2–5 days. The bot finds
the passes in Microsoft Planetary Computer's free STAC catalogue and has its data API draw the picture (map tiles of
one pass, stitched and cropped here) — no key, no registration.

For every hub: the newest pass that is clear over the hub itself (clouds and the edge of a pass are checked on the
picture, not only the pass's cloud figure) and, from the start, one about a month older, so the terminal can compare
"now" with "then". The last 4 pictures per hub are kept. At 10 m the tanks show as circles, and you can see new
tanks, empty land, ships at the jetties; how full the tanks are (the shadows inside floating roofs) needs ~0.5 m
pictures, which are not free.

Each hub is checked every 12 hours, at most 3 hubs per call (about a minute), the stalest first.
Result: docs/sat.json and docs/sat/<hub>/<date>.jpg. Needs Pillow (installed with matplotlib).
"""
from __future__ import annotations

import io
import json
import math
import os
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "docs", "sat.json")
DIR = os.path.join(HERE, "docs", "sat")
UA = "econnews-bot (+https://github.com/venerablesoul/econnews)"
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
TILES = ("https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?collection=sentinel-2-l2a"
         "&item={item}&assets=visual&asset_bidx=visual%7C1%2C2%2C3&nodata=0&format=png")
SRC = "Copernicus Sentinel-2 (ESA) · Microsoft Planetary Computer"
# the map zoom whose pixel on the ground is closest to Sentinel-2's own 10 m (it shrinks with latitude: z14 near the
# equator, z13 from ~45°)
SIZE = 600           # the published picture's width, px
EVERY_H = 12
PER_CALL = 3
BUDGET_S = 100
KEEP = 4
MAX_CC = 40          # a pass's own cloud figure (%): above it, not even tried
MAX_CLOUD = 0.12     # ... and on the picture: at most 12 % white-grey cloud
MAX_EMPTY = 0.02     # ... and at most 2 % outside the pass
OLD_DAYS = (21, 75)  # the "then" picture: 3 to 10 weeks back

# id, English name, Russian name, lat, lon, box side (km)
SITES = (
    ("cushing", "Cushing, Oklahoma (WTI hub)", "Кушинг, Оклахома (хаб WTI)", 35.957, -96.757, 7.0),
    ("houston", "Houston Ship Channel", "Хьюстонский судоходный канал", 29.733, -95.190, 8.0),
    ("rotterdam", "Rotterdam: Europoort and Maasvlakte", "Роттердам: Европорт и Маасвлакте", 51.950, 4.080, 8.0),
    ("primorsk", "Primorsk oil terminal", "Нефтяной терминал Приморск", 60.345, 28.665, 6.0),
    ("novorossiysk", "Novorossiysk: Sheskharis", "Новороссийск: Шесхарис", 44.692, 37.808, 5.0),
    ("rastanura", "Ras Tanura", "Рас-Танура", 26.650, 50.150, 7.0),
    ("kharg", "Kharg Island", "Остров Харк", 29.240, 50.318, 7.0),
    ("fujairah", "Fujairah", "Фуджейра", 25.178, 56.355, 6.0),
    ("singapore", "Singapore: Jurong and Bukom", "Сингапур: Джуронг и Буком", 1.255, 103.725, 10.0),
)


# ---------------------------------------------------------------------------
# geometry: the hub's box, WebMercator tiles
# ---------------------------------------------------------------------------
def bbox(lat, lon, km):
    dlat = km / 2 / 111.32
    dlon = km / 2 / (111.32 * max(0.05, math.cos(math.radians(lat))))
    return [round(lon - dlon, 5), round(lat - dlat, 5), round(lon + dlon, 5), round(lat + dlat, 5)]


def world_px(lat, lon, z):
    """A point's pixel on the whole WebMercator map at zoom z (256-px tiles)."""
    n = 256 * 2 ** z
    s = math.sin(math.radians(max(-85.0511, min(85.0511, lat))))
    return (lon + 180) / 360 * n, (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n


def zoom_for(lat):
    return max(12, min(15, math.floor(math.log2(156543.03 * math.cos(math.radians(lat)) / 10) + 0.6)))   # rather finer than coarser


def tiles_for(b, z=None):
    """The tiles covering a box, the tile range, the box in the stitched picture's pixels, and the zoom."""
    z = z or zoom_for((b[1] + b[3]) / 2)
    x0, y0 = world_px(b[3], b[0], z)
    x1, y1 = world_px(b[1], b[2], z)
    tx0, ty0, tx1, ty1 = int(x0 // 256), int(y0 // 256), int(x1 // 256), int(y1 // 256)
    tiles = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
    crop = (x0 - tx0 * 256, y0 - ty0 * 256, x1 - tx0 * 256, y1 - ty0 * 256)
    return tiles, (tx0, ty0, tx1, ty1), crop, z


# ---------------------------------------------------------------------------
# network
# ---------------------------------------------------------------------------
def http(url, body=None, timeout=60, limit=6 << 20):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "*/*",
                                                          **({"Content-Type": "application/json"} if data else {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        out = r.read(limit + 1)
    if len(out) > limit:
        raise ValueError("answer too big")
    return out


def search(b, start, end, fetch=http, limit=8):
    """Passes over the box between two dates, newest first: [{id, dt, cc, bbox}]."""
    body = {"collections": ["sentinel-2-l2a"], "bbox": b, "datetime": f"{start}T00:00:00Z/{end}T23:59:59Z",
            "query": {"eo:cloud_cover": {"lt": MAX_CC}}, "sortby": [{"field": "datetime", "direction": "desc"}], "limit": limit}
    d = json.loads(fetch(STAC, body).decode("utf-8", "replace"))
    out = []
    for f in d.get("features") or []:
        p = f.get("properties") or {}
        fid, dt = str(f.get("id") or ""), str(p.get("datetime") or "")
        if not re.fullmatch(r"[A-Za-z0-9_.\-]{10,120}", fid) or not re.match(r"\d{4}-\d\d-\d\d", dt):
            continue
        fb = f.get("bbox") or []
        if len(fb) == 4 and not (fb[0] <= b[0] and fb[1] <= b[1] and fb[2] >= b[2] and fb[3] >= b[3]):
            continue   # the hub is not wholly inside this pass's tile
        out.append({"id": fid, "dt": dt, "cc": p.get("eo:cloud_cover")})
    out.sort(key=lambda x: x["dt"], reverse=True)
    return out


def render(item, b, fetch=http):
    """The hub's picture from one pass: a Pillow RGB image (SIZE wide), or an exception."""
    from PIL import Image
    tiles, (tx0, ty0, tx1, ty1), crop, z = tiles_for(b)
    if len(tiles) > 30:
        raise ValueError("box too big")
    canvas = Image.new("RGBA", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256), (0, 0, 0, 0))

    def one(t):
        url = TILES.format(z=z, x=t[0], y=t[1], item=urllib.parse.quote(item, safe=""))
        for attempt in range(3):
            try:
                return t, fetch(url, None, 60, 2 << 20)
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(1.5 * (attempt + 1))

    with ThreadPoolExecutor(max_workers=6) as ex:
        for t, raw in ex.map(one, tiles):
            im = Image.open(io.BytesIO(raw)).convert("RGBA")
            canvas.paste(im, ((t[0] - tx0) * 256, (t[1] - ty0) * 256))
    pic = canvas.crop(tuple(int(round(v)) for v in crop))
    w, h = pic.size
    return pic.resize((SIZE, max(1, round(SIZE * h / max(1, w)))), Image.LANCZOS)


def quality(pic):
    """(cloud share, empty share) of a picture: cloud = bright and grey, empty = outside the pass (transparent/black)."""
    small = pic.resize((150, max(1, round(150 * pic.size[1] / pic.size[0]))))
    px = list(small.getdata())
    n = len(px) or 1
    empty = sum(1 for p in px if (len(p) > 3 and p[3] < 16) or max(p[:3]) < 4)
    cloud = sum(1 for p in px if (len(p) < 4 or p[3] >= 16) and min(p[:3]) > 185 and max(p[:3]) - min(p[:3]) < 28)
    return cloud / n, empty / n


def save_jpeg(pic, path):
    from PIL import ImageEnhance
    rgb = pic.convert("RGB")
    rgb = ImageEnhance.Contrast(rgb).enhance(1.08)   # Sentinel's true colour is a little flat
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    rgb.save(tmp, "JPEG", quality=80, optimize=True, progressive=True)
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# the hubs
# ---------------------------------------------------------------------------
def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def best(passes, b, have, fetch, deadline):
    """The newest pass that is clear over the hub (not one we already have). Returns (pass, picture, cloud) or None."""
    for p in passes:
        if p["dt"][:10] in have or time.monotonic() > deadline:
            continue
        try:
            pic = render(p["id"], b, fetch)
        except Exception:
            continue
        cloud, empty = quality(pic)
        if cloud <= MAX_CLOUD and empty <= MAX_EMPTY:
            return p, pic, cloud
    return None


def update_site(site, rec, now, fetch, deadline, sat_dir):
    sid, en, ru, lat, lon, km = site
    b = bbox(lat, lon, km)
    imgs = [i for i in rec.get("imgs") or [] if isinstance(i, dict) and os.path.isfile(os.path.join(sat_dir, sid, i.get("d", "") + ".jpg"))]
    have = {i["d"] for i in imgs}
    added = 0
    newest = max(have) if have else ""
    # the newest clear pass of the last 20 days (only one newer than what we have) and, while there is no older
    # picture to compare with, one from 3–10 weeks back
    wanted = [((now - timedelta(days=20)).date().isoformat(), now.date().isoformat(), newest)]
    if len(imgs) < 2:
        wanted.append(((now - timedelta(days=OLD_DAYS[1])).date().isoformat(), (now - timedelta(days=OLD_DAYS[0])).date().isoformat(), ""))
    for start, end, after in wanted:
        passes = [p for p in search(b, start, end, fetch) if p["dt"][:10] > after]
        got = best(passes, b, have, fetch, deadline)
        if not got:
            continue
        p, pic, cloud = got
        d = p["dt"][:10]
        save_jpeg(pic, os.path.join(sat_dir, sid, d + ".jpg"))
        imgs.append({"d": d, "t": p["dt"][11:16], "cc": round(p["cc"], 1) if isinstance(p["cc"], (int, float)) else None,
                     "cloud": round(cloud * 100, 1), "item": p["id"]})
        have.add(d)
        added += 1
    imgs.sort(key=lambda i: i["d"])
    for old in imgs[:-KEEP]:   # the oldest pictures go
        try:
            os.remove(os.path.join(sat_dir, sid, old["d"] + ".jpg"))
        except OSError:
            pass
    imgs = imgs[-KEEP:]
    for i in imgs:
        i["f"] = f"sat/{sid}/{i['d']}.jpg"
    return {"id": sid, "name": en, "name_ru": ru, "lat": lat, "lon": lon, "km": km, "bbox": b, "imgs": imgs,
            "checked": now.isoformat()}, added


def build(now=None, path=OUT, sat_dir=DIR, fetch=http, per_call=PER_CALL, every_h=EVERY_H, budget_s=BUDGET_S):
    """Checks the stalest hubs (at most per_call) and updates docs/sat.json. Returns how many pictures were added."""
    now = now or datetime.now(timezone.utc)
    old = load(path)
    by = {s.get("id"): s for s in old.get("sites") or [] if isinstance(s, dict)}
    cut = (now - timedelta(hours=every_h)).isoformat()
    due = sorted((s for s in SITES if (by.get(s[0]) or {}).get("checked", "") < cut), key=lambda s: (by.get(s[0]) or {}).get("checked", ""))
    if not due:
        return 0
    deadline = time.monotonic() + budget_s
    errs = dict(old.get("err") or {})
    added = 0
    for site in due[:per_call]:
        if time.monotonic() > deadline:
            break
        try:
            rec, n = update_site(site, by.get(site[0]) or {}, now, fetch, deadline, sat_dir)
            by[site[0]] = rec
            added += n
            errs.pop(site[0], None)
        except Exception as e:
            errs[site[0]] = f"{type(e).__name__}: {e}"[:160]
            r = dict(by.get(site[0]) or {"id": site[0], "name": site[1], "name_ru": site[2], "lat": site[3], "lon": site[4],
                                          "km": site[5], "bbox": bbox(site[3], site[4], site[5]), "imgs": []})
            r["checked"] = now.isoformat()   # tried; the next try in 12 hours
            by[site[0]] = r
    sites = []
    for s in SITES:
        r = by.get(s[0]) or {"id": s[0], "name": s[1], "name_ru": s[2], "lat": s[3], "lon": s[4], "km": s[5],
                             "bbox": bbox(s[3], s[4], s[5]), "imgs": []}
        r.update({"name": s[1], "name_ru": s[2], "lat": s[3], "lon": s[4], "km": s[5]})   # the table here wins
        sites.append(r)
    out = {"updated": now.isoformat() if added or not old.get("updated") else old["updated"], "checked": now.isoformat(),
           "src": SRC, "res_m": 10, "sites": sites}
    if errs:
        out["err"] = errs
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)
    if errs and not added and len(errs) >= min(per_call, len(due)):
        raise RuntimeError("; ".join(f"{k}: {v}" for k, v in list(errs.items())[:2]))
    return added


if __name__ == "__main__":
    print("satellite pictures added:", build())
