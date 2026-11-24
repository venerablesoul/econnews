"""
The map's satellite picture for the overview zooms, kept on the site itself.

The terminal draws NASA GIBS tiles under the map: Blue Marble with relief and sea floor (day) and the Earth at night
(city lights). Taken straight from NASA they may be slow or out of reach from some networks, so the bot copies the
overview zooms 0–4 (341 tiles per picture, ~10 MB in all) to docs/base/<picture>/<z>/<y>/<x>.<ext> once; the terminal
uses them first and NASA only for closer zooms. The address that works is found here (GIBS names some layers .jpg,
some .jpeg) and written to docs/base/meta.json, so the browser asks NASA with the right one.

NASA imagery is public domain. Done once (a missing tile is fetched again on a later call), at most ~400 tiles a call.
"""
from __future__ import annotations

import json
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "docs", "base")
UA = "econnews-bot (+https://github.com/venerablesoul/econnews)"
GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/"
VERSION = 1
MAXZ = 4
PER_CALL = 400
# each picture: the addresses to try, in order, and the file kind each gives
PICTURES = {
    "day": [GIBS + "BlueMarble_ShadedRelief_Bathymetry/default//GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg",
            GIBS + "BlueMarble_ShadedRelief_Bathymetry/default//GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
            GIBS + "BlueMarble_NextGeneration/default//GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg"],
    "lights": [GIBS + "VIIRS_CityLights_2012/default//GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg",
               GIBS + "VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png"],
}


def get(url, timeout=40, limit=2 << 20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read(limit + 1)
    if len(data) > limit:
        raise ValueError("tile too big")
    return data


def kind(data):
    """'jpg' or 'png' by the file's first bytes; None if it is not a picture (an error page)."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    return None


def tiles(maxz=MAXZ):
    return [(z, y, x) for z in range(maxz + 1) for y in range(2 ** z) for x in range(2 ** z)]


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def pick(name, fetch):
    """The first address of a picture whose world tile (0/0/0) is a real picture: (template, ext)."""
    for tpl in PICTURES[name]:
        try:
            data = fetch(tpl.format(z=0, y=0, x=0))
        except Exception:
            continue
        k = kind(data)
        if k:
            return tpl, k
    return None, None


def build(now=None, base=DIR, fetch=get, per_call=PER_CALL, workers=8):
    """Copies what is still missing. Returns how many tiles were saved."""
    now = now or datetime.now(timezone.utc)
    meta_path = os.path.join(base, "meta.json")
    meta = load(meta_path)
    if meta.get("version") == VERSION and all((meta.get("layers") or {}).get(n, {}).get("done") for n in PICTURES):
        return 0
    layers = dict(meta.get("layers") or {}) if meta.get("version") == VERSION else {}
    saved, budget = 0, per_call
    for name in PICTURES:
        L = layers.get(name) or {}
        if not L.get("url"):
            tpl, ext = pick(name, fetch)
            if not tpl:
                L["err"] = "no address answered"
                layers[name] = L
                continue
            L = {"url": tpl, "ext": ext}
        missing = [t for t in tiles() if not os.path.isfile(os.path.join(base, name, str(t[0]), str(t[1]), f"{t[2]}.{L['ext']}"))]
        todo = missing[:max(0, budget)]

        def one(t, L=L, name=name):
            z, y, x = t
            for attempt in range(2):
                try:
                    data = fetch(L["url"].format(z=z, y=y, x=x))
                    if kind(data) != L["ext"]:
                        return 0
                    p = os.path.join(base, name, str(z), str(y), f"{x}.{L['ext']}")
                    os.makedirs(os.path.dirname(p), exist_ok=True)
                    with open(p + ".tmp", "wb") as f:
                        f.write(data)
                    os.replace(p + ".tmp", p)
                    return 1
                except Exception:
                    time.sleep(1)
            return 0

        if todo:
            with ThreadPoolExecutor(max_workers=workers) as ex:
                got = sum(ex.map(one, todo))
            saved += got
            budget -= len(todo)
        L["done"] = all(os.path.isfile(os.path.join(base, name, str(t[0]), str(t[1]), f"{t[2]}.{L['ext']}")) for t in missing)
        L["max"] = MAXZ
        L.pop("err", None)
        layers[name] = L
    os.makedirs(base, exist_ok=True)
    out = {"version": VERSION, "updated": now.isoformat(), "src": "NASA EOSDIS GIBS", "layers": layers}
    with open(meta_path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    os.replace(meta_path + ".tmp", meta_path)
    if not saved and any(L.get("err") for L in layers.values()):
        raise RuntimeError("; ".join(f"{n}: {L['err']}" for n, L in layers.items() if L.get("err")))
    return saved


if __name__ == "__main__":
    print("map tiles saved:", build())
