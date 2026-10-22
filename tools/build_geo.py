"""Builds the static map layers of the terminal (docs/geo/*.json) from open datasets.

Run once when a source updates (the files are committed; the terminal only reads them):
  python3 tools/build_geo.py SRC_DIR
SRC_DIR holds the downloaded sources:
  ne/geojson/ne_50m_admin_0_countries.geojson   Natural Earth 1:50m countries (public domain)  github.com/nvkelso/natural-earth-vector
  ne/geojson/ne_10m_ports.geojson               Natural Earth 1:10m ports (public domain)
  gppd/output_database/global_power_plant_database.csv   WRI Global Power Plant Database v1.3 (CC BY 4.0)
                                                          github.com/wri/global-power-plant-database
  infra/*.json                                   optional: refineries, LNG terminals, mines… prepared by tools/build_infra.py

Compact formats (smaller files, the browser decodes them in a few milliseconds):
  world.json  {q, c: [[iso3, name_en, name_ru, label_lon, label_lat, [ring, ring…]]]}
              ring = [lon0*q, lat0*q, dlon1, dlat1, dlon2, dlat2, …] (integers; deltas after the first point)
  plants.json {fuels: [...], p: [[lon, lat, MW, fuel index, iso3, name], …]}  (name only for 30 MW and more)
  ports.json  {p: [[lon, lat, rank, name], …]}  rank 1 = the largest ports
"""
import csv
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "geo")
Q = 50              # coordinates in 1/50 of a degree (~2 km)
TOL = 0.06          # simplification tolerance, degrees
MIN_AREA = 0.04     # drop islands smaller than this (square degrees) unless they are the country's only land


def dp(points, tol):
    """Douglas-Peucker simplification of an open polyline (iterative)."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / L if L else math.hypot(px - ax, py - ay)
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(points, keep) if k]


def area(ring):
    s = 0.0
    for i in range(len(ring) - 1):
        s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return abs(s) / 2


def simplify_ring(ring):
    ring = [(round(x, 4), round(y, 4)) for x, y in ring]
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    # split the closed ring in two halves so the endpoints are not fixed to one place
    mid = len(ring) // 2
    s = dp(ring[:mid + 1], TOL)[:-1] + dp(ring[mid:], TOL)
    return s


def encode(ring):
    out, px, py = [], None, None
    for x, y in ring:
        qx, qy = int(round(x * Q)), int(round(y * Q))
        if px is None:
            out += [qx, qy]
        elif qx != px or qy != py:
            out += [qx - px, qy - py]
        else:
            continue
        px, py = qx, qy
    return out


# shorter everyday names where Natural Earth gives the formal one (the map's labels and the ECO list)
SHORT = {"USA": ("United States", "США"), "CHN": ("China", "Китай"), "KOR": ("South Korea", "Южная Корея"), "PRK": ("North Korea", "КНДР"),
         "ARE": ("UAE", "ОАЭ"), "CAF": ("Central African Rep.", "ЦАР"), "COD": ("DR Congo", "ДР Конго"), "COG": ("Congo", "Конго"),
         "DOM": ("Dominican Rep.", "Доминикана"), "CYN": ("Northern Cyprus", "Северный Кипр")}


def countries(src):
    gj = json.load(open(os.path.join(src, "ne", "geojson", "ne_50m_admin_0_countries.geojson"), encoding="utf-8"))
    rows = []
    for f in gj["features"]:
        p = f["properties"]
        iso = p.get("ISO_A3_EH") if p.get("ISO_A3_EH") not in (None, "-99") else p.get("ADM0_A3")
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        outer = [poly[0] for poly in polys]           # holes are left out: at this scale they are lakes and enclaves
        big = max(outer, key=area)
        rings = []
        for r in outer:
            if r is not big and area(r) < MIN_AREA:
                continue
            s = simplify_ring(r)
            if len(s) >= 4:
                rings.append(encode(s))
        if not rings:
            continue
        en, ru = SHORT.get(iso) or (p.get("NAME_EN") or p["NAME"], p.get("NAME_RU") or p.get("NAME_EN") or p["NAME"])
        rows.append([iso, en, ru, round(p.get("LABEL_X") or 0, 2), round(p.get("LABEL_Y") or 0, 2), rings, area(big)])
    # one entry per code: an overseas territory under its country's code (Australia's Indian Ocean islands) joins it,
    # and the bigger part keeps the name and the label
    rows.sort(key=lambda r: (r[0], -r[6]))
    merged = []
    for r in rows:
        if merged and merged[-1][0] == r[0]:
            merged[-1][5] += r[5]
        else:
            merged.append(r)
    rows = [r[:6] for r in merged]
    return {"q": Q, "src": "Natural Earth 1:50m (public domain)", "c": rows}


FUELS = ["Coal", "Gas", "Oil", "Nuclear", "Hydro", "Wind", "Solar", "Biomass", "Geothermal", "Waste", "Storage", "Other"]
FUEL_MAP = {"Petcoke": "Oil", "Cogeneration": "Gas", "Wave and Tidal": "Other"}


def plants(src):
    path = os.path.join(src, "gppd", "output_database", "global_power_plant_database.csv")
    out = []
    for r in csv.DictReader(open(path, encoding="utf-8")):
        try:
            mw = float(r["capacity_mw"] or 0)
            lat, lon = float(r["latitude"]), float(r["longitude"])
        except ValueError:
            continue
        if mw < 1:
            continue
        fuel = FUEL_MAP.get(r["primary_fuel"], r["primary_fuel"])
        fi = FUELS.index(fuel) if fuel in FUELS else FUELS.index("Other")
        row = [round(lon, 3), round(lat, 3), round(mw) if mw >= 10 else round(mw, 1), fi, r["country"]]
        if mw >= 30:
            row.append(r["name"].strip())
        out.append(row)
    out.sort(key=lambda x: -x[2])   # big first: drawn last on top, found first on hover
    return {"src": "WRI Global Power Plant Database v1.3 (2021), CC BY 4.0", "fuels": FUELS, "p": out}


def ports(src):
    gj = json.load(open(os.path.join(src, "ne", "geojson", "ne_10m_ports.geojson"), encoding="utf-8"))
    out = []
    for f in gj["features"]:
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"][:2]
        out.append([round(lon, 3), round(lat, 3), int(p.get("scalerank") or 9), p.get("name") or ""])
    out.sort(key=lambda x: x[2])
    return {"src": "Natural Earth 1:10m ports (public domain)", "p": out}


def write(name, obj):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    print(name, os.path.getsize(path) // 1024, "KB")


def main(src):
    write("world.json", countries(src))
    write("plants.json", plants(src))
    write("ports.json", ports(src))
    infra = os.path.join(src, "infra")
    if os.path.isdir(infra):
        for fn in sorted(os.listdir(infra)):
            if fn.endswith(".json"):
                write(fn, json.load(open(os.path.join(infra, fn), encoding="utf-8")))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
