from __future__ import annotations

import io
import json
import math
import os
import re
import time
import urllib.error
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
SMOOTH = "&resampling=bilinear&reproject=bilinear"
SRC = "Contains modified Copernicus Sentinel data {years} · via Microsoft Planetary Computer"
RENDER_V = 2
MAX_M_PX = 9.6
OUT_M_PX = 4.0
MAX_SIDE = 1800
THUMB = 420
MAX_TILES = 49
EVERY_H = 12
PER_CALL = 3
BUDGET_S = 100
KEEP = 4
MAX_CC = 40
MAX_CLOUD = 0.12
MAX_EMPTY = 0.02
OLD_DAYS = (21, 75)

SITES = (
    ("cushing", "Cushing, Oklahoma (WTI hub)", "Кушинг, Оклахома (хаб WTI)", 35.937, -96.742, 7.5),
    ("houston", "Houston Ship Channel", "Хьюстонский судоходный канал", 29.733, -95.190, 8.0),
    ("rotterdam", "Rotterdam: Europoort and Maasvlakte", "Роттердам: Европорт и Маасвлакте", 51.950, 4.080, 8.0),
    ("primorsk", "Primorsk oil terminal", "Нефтяной терминал Приморск", 60.342, 28.716, 5.0),
    ("novorossiysk", "Novorossiysk: Sheskharis", "Новороссийск: Шесхарис", 44.707, 37.846, 5.0),
    ("rastanura", "Ras Tanura", "Рас-Танура", 26.648, 50.154, 5.0),
    ("kharg", "Kharg Island", "Остров Харк", 29.226, 50.315, 5.0),
    ("fujairah", "Fujairah", "Фуджейра", 25.193, 56.352, 6.0),
    ("singapore", "Singapore: Jurong Island", "Сингапур: остров Джуронг", 1.268, 103.700, 7.0),
    ("bukom", "Singapore: Pulau Bukom", "Сингапур: остров Буком", 1.232, 103.762, 4.0),
)


# ---------------------------------------------------------------------------
# geometry: the hub's box, WebMercator tiles
# ---------------------------------------------------------------------------
def bbox(lat, lon, km):
    dlat = km / 2 / 111.32
    dlon = km / 2 / (111.32 * max(0.05, math.cos(math.radians(lat))))
    return [round(lon - dlon, 5), round(lat - dlat, 5), round(lon + dlon, 5), round(lat + dlat, 5)]


def world_px(lat, lon, z):
    n = 256 * 2 ** z
    s = math.sin(math.radians(max(-85.0511, min(85.0511, lat))))
    return (lon + 180) / 360 * n, (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n


def m_per_px(lat, z):
    return 156543.03 * math.cos(math.radians(lat)) / 2 ** z


def zoom_for(lat):
    return max(12, min(16, math.ceil(math.log2(156543.03 * math.cos(math.radians(lat)) / MAX_M_PX) - 1e-9)))


def tiles_for(b, z=None):
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
            continue
        out.append({"id": fid, "dt": dt, "cc": p.get("eo:cloud_cover")})
    out.sort(key=lambda x: x["dt"], reverse=True)
    return out


_smooth = {"on": True}


def render(item, b, fetch=http):
    from PIL import Image
    tiles, (tx0, ty0, tx1, ty1), crop, z = tiles_for(b)
    if len(tiles) > MAX_TILES:
        raise ValueError("box too big")
    canvas = Image.new("RGBA", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256), (0, 0, 0, 0))

    def one(t):
        for attempt in range(3):
            url = TILES.format(z=z, x=t[0], y=t[1], item=urllib.parse.quote(item, safe="")) + (SMOOTH if _smooth["on"] else "")
            try:
                return t, fetch(url, None, 60, 2 << 20)
            except urllib.error.HTTPError as e:
                if e.code in (400, 422) and _smooth["on"]:
                    _smooth["on"] = False
                    continue
                if attempt == 2:
                    raise
            except Exception:
                if attempt == 2:
                    raise
            time.sleep(1.5 * (attempt + 1))
        raise ValueError("tile not fetched")

    with ThreadPoolExecutor(max_workers=6) as ex:
        for t, raw in ex.map(one, tiles):
            im = Image.open(io.BytesIO(raw)).convert("RGBA")
            canvas.paste(im, ((t[0] - tx0) * 256, (t[1] - ty0) * 256))
    pic = canvas.crop(tuple(int(round(v)) for v in crop))
    w, h = pic.size
    lat = (b[1] + b[3]) / 2
    up = max(1.0, min(2.5, m_per_px(lat, z) / OUT_M_PX))
    k = min(up, MAX_SIDE / max(w, h))
    size = (max(1, round(w * k)), max(1, round(h * k)))
    return pic.resize(size, Image.LANCZOS) if size != (w, h) else pic


def quality(pic):
    small = pic.resize((150, max(1, round(150 * pic.size[1] / pic.size[0]))))
    px = list(small.get_flattened_data() if hasattr(small, "get_flattened_data") else small.getdata())
    n = len(px) or 1
    empty = sum(1 for p in px if (len(p) > 3 and p[3] < 16) or max(p[:3]) < 4)
    cloud = sum(1 for p in px if (len(p) < 4 or p[3] >= 16) and min(p[:3]) > 185 and max(p[:3]) - min(p[:3]) < 28)
    return cloud / n, empty / n


def enhance(pic):
    from PIL import Image, ImageEnhance, ImageFilter, ImageOps
    rgb = pic.convert("RGB")
    if pic.mode == "RGBA":
        bg = Image.new("RGB", pic.size, (0, 0, 0))
        bg.paste(rgb, mask=pic.getchannel("A"))
        rgb = bg
    rgb = ImageOps.autocontrast(rgb, cutoff=(0.5, 0.02), preserve_tone=True)
    hist = rgb.convert("L").histogram()
    land = sum(hist[40:]) or 1
    acc, med = 0, 128
    for v in range(40, 256):
        acc += hist[v]
        if acc >= land / 2:
            med = v
            break
    gamma = max(0.75, min(1.6, math.log(128 / 255) / math.log(max(1, min(254, med)) / 255)))
    if abs(gamma - 1) > 0.04:
        y, cb, cr = rgb.convert("YCbCr").split()
        y = y.point([round(255 * (v / 255) ** gamma) for v in range(256)])
        rgb = Image.merge("YCbCr", (y, cb, cr)).convert("RGB")
    rgb = ImageEnhance.Color(rgb).enhance(1.06 if gamma <= 1.1 else 1.0)
    scale = max(1.0, max(rgb.size) / 900)
    rgb = rgb.filter(ImageFilter.UnsharpMask(radius=round(1.0 * scale, 1), percent=70, threshold=3))
    return rgb.filter(ImageFilter.UnsharpMask(radius=round(3.0 * scale, 1), percent=18, threshold=4))


def save_jpeg(pic, path, thumb=None):
    from PIL import Image
    rgb = enhance(pic)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for out, im, q in ((path, rgb, 86), (thumb, None, 80)):
        if not out:
            continue
        if im is None:
            w, h = rgb.size
            im = rgb.resize((THUMB, max(1, round(THUMB * h / max(1, w)))), Image.LANCZOS)
        tmp = out + ".tmp"
        im.save(tmp, "JPEG", quality=q, optimize=True, progressive=True)
        os.replace(tmp, out)


def thumb_of(path):
    return path[:-4] + "_t.jpg"


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


def _drop(sat_dir, sid, d):
    for f in (d + ".jpg", d + "_t.jpg"):
        try:
            os.remove(os.path.join(sat_dir, sid, f))
        except OSError:
            pass


def stale(rec, b):
    return bool(rec.get("redo")) or any(isinstance(i, dict) and (i.get("v") != RENDER_V or (i.get("bb") or rec.get("bbox")) != b)
                                        for i in rec.get("imgs") or [])


def refresh(sid, imgs, rec, b, fetch, deadline, sat_dir):
    out, later = [], []
    for i in imgs:
        framed = (i.get("bb") or rec.get("bbox")) == b
        if i.get("v") == RENDER_V and framed:
            out.append(i)
            continue
        if time.monotonic() >= deadline:
            later.append(i)
            continue
        pic = None
        if i.get("item"):
            try:
                pic = render(i["item"], b, fetch)
            except Exception:
                pic = None
        if pic is not None:
            cloud, empty = quality(pic)
            if cloud <= MAX_CLOUD and empty <= MAX_EMPTY:
                f = os.path.join(sat_dir, sid, i["d"] + ".jpg")
                save_jpeg(pic, f, thumb_of(f))
                out.append({k: v for k, v in i.items() if k not in ("f", "tf")} | {"cloud": round(cloud * 100, 1), "v": RENDER_V, "bb": b})
                continue
        _drop(sat_dir, sid, i["d"])
    return out, later


def update_site(site, rec, now, fetch, deadline, sat_dir):
    sid, en, ru, lat, lon, km = site
    b = bbox(lat, lon, km)
    seen, imgs = set(), []
    for i in (rec.get("imgs") or []) + (rec.get("redo") or []):
        if isinstance(i, dict) and i.get("d") not in seen and os.path.isfile(os.path.join(sat_dir, sid, str(i.get("d", "")) + ".jpg")):
            seen.add(i["d"])
            imgs.append(i)
    imgs, later = refresh(sid, imgs, rec, b, fetch, deadline, sat_dir)
    have = {i["d"] for i in imgs} | {i["d"] for i in later}
    added = 0
    newest = max(have) if have else ""
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
        f = os.path.join(sat_dir, sid, d + ".jpg")
        save_jpeg(pic, f, thumb_of(f))
        imgs.append({"d": d, "t": p["dt"][11:16], "cc": round(p["cc"], 1) if isinstance(p["cc"], (int, float)) else None,
                     "cloud": round(cloud * 100, 1), "item": p["id"], "v": RENDER_V, "bb": b})
        have.add(d)
        added += 1
    imgs.sort(key=lambda i: i["d"])
    for old in imgs[:-KEEP]:
        _drop(sat_dir, sid, old["d"])
    imgs = imgs[-KEEP:]
    later.sort(key=lambda i: i["d"])
    shown = imgs or later
    for i in shown + later:
        i["f"] = f"sat/{sid}/{i['d']}.jpg"
        if os.path.isfile(os.path.join(sat_dir, sid, i["d"] + "_t.jpg")):
            i["tf"] = f"sat/{sid}/{i['d']}_t.jpg"
        else:
            i.pop("tf", None)
    out = {"id": sid, "name": en, "name_ru": ru, "lat": lat, "lon": lon, "km": km, "bbox": b, "imgs": shown, "checked": now.isoformat()}
    if later:
        out["redo"] = later
    return out, added


def build(now=None, path=OUT, sat_dir=DIR, fetch=http, per_call=PER_CALL, every_h=EVERY_H, budget_s=BUDGET_S):
    now = now or datetime.now(timezone.utc)
    old = load(path)
    by = {s.get("id"): s for s in old.get("sites") or [] if isinstance(s, dict)}
    cut = (now - timedelta(hours=every_h)).isoformat()
    due = sorted((s for s in SITES if (by.get(s[0]) or {}).get("checked", "") < cut or stale(by.get(s[0]) or {}, bbox(s[3], s[4], s[5]))),
                 key=lambda s: (not stale(by.get(s[0]) or {}, bbox(s[3], s[4], s[5])), (by.get(s[0]) or {}).get("checked", "")))
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
            r["checked"] = now.isoformat()
            by[site[0]] = r
    sites = []
    for s in SITES:
        r = by.get(s[0]) or {"id": s[0], "name": s[1], "name_ru": s[2], "lat": s[3], "lon": s[4], "km": s[5],
                             "bbox": bbox(s[3], s[4], s[5]), "imgs": []}
        r.update({"name": s[1], "name_ru": s[2], "lat": s[3], "lon": s[4], "km": s[5]})
        sites.append(r)
    years = sorted({i["d"][:4] for r in sites for i in r.get("imgs") or [] if i.get("d")}) or [str(now.year)]
    out = {"updated": now.isoformat() if added or not old.get("updated") else old["updated"], "checked": now.isoformat(),
           "src": SRC.format(years=", ".join(years)), "res_m": 10, "px_m": OUT_M_PX, "sites": sites}
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
