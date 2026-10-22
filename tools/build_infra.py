"""Builds the refinery and LNG terminal layers of the terminal map (docs/geo/refineries.json, docs/geo/lng.json).

Sources (free, open):
  OpenStreetMap through the Overpass API — © OpenStreetMap contributors, ODbL 1.0
  Wikidata (SPARQL) — CC0
Run where the internet is open:  python3 tools/build_infra.py fetch OUT_DIR   (downloads into OUT_DIR)
then:                             python3 tools/build_infra.py build OUT_DIR NE_COUNTRIES.geojson
The country of each point comes from the Natural Earth borders (point in polygon).
Format: {src, p: [[lon, lat, name, iso3, operator], …]}
"""
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
GEO = os.path.join(os.path.dirname(HERE), "docs", "geo")
UA = "econnews-terminal/1.0 (https://github.com/venerablesoul/econnews)"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
WIKIDATA = "https://query.wikidata.org/sparql"

OSM_QUERIES = {
    "refinery_industrial": 'nwr["industrial"~"^(refinery|oil_refinery)$"];',
    "refinery_works": 'nwr["man_made"="works"]["product"~"oil|petrol|fuel|diesel|gasoline|kerosene",i];',
    "lng_tag": 'nwr["industrial"~"lng|liquefied",i];',
    "lng_substance": 'nwr["substance"~"^lng$",i]["man_made"!="pipeline"]["man_made"!="storage_tank"];',
    "lng_name_ind": 'nwr["name"~"LNG"]["landuse"~"industrial|port"];',
}
WD_CLASSES = {"oil_refinery": ["Q12353044", "Q1867977"], "lng": ["Q3398676", "Q15709854"]}
KEEP_TAGS = ("operator", "product", "substance", "capacity", "industrial", "man_made", "owner", "landuse")


def fetch(out):
    os.makedirs(out, exist_ok=True)
    for name, sel in OSM_QUERIES.items():
        ql = "[out:json][timeout:180];(%s);out center tags;" % sel
        for host in OVERPASS:
            try:
                req = urllib.request.Request(host, data=urllib.parse.urlencode({"data": ql}).encode(), headers={"User-Agent": UA})
                d = json.loads(urllib.request.urlopen(req, timeout=240).read())
                break
            except Exception as e:
                print("overpass", name, host, e)
                d = None
        if d is None:
            continue
        rows = []
        for e in d.get("elements") or []:
            t = e.get("tags") or {}
            if not t.get("name"):
                continue
            c = e.get("center") or {"lon": e.get("lon"), "lat": e.get("lat")}
            rows.append([c.get("lon"), c.get("lat"), t.get("name:en") or t.get("name"), {k: v for k, v in t.items() if k in KEEP_TAGS}])
        json.dump(rows, open(os.path.join(out, "out_osm_" + name + ".json"), "w"), ensure_ascii=False)
        print("osm", name, len(rows))
        time.sleep(5)
    for name, classes in WD_CLASSES.items():
        q = """SELECT ?i ?iLabel ?co ?iso3 ?ownerLabel WHERE { VALUES ?c { %s } ?i wdt:P31 ?c ; wdt:P625 ?co .
  OPTIONAL { ?i wdt:P17 ?country . ?country wdt:P298 ?iso3 . } OPTIONAL { ?i wdt:P127 ?owner . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ru,es,fr,de". } }""" % " ".join("wd:" + c for c in classes)
        url = WIKIDATA + "?" + urllib.parse.urlencode({"query": q, "format": "json"})
        d = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/sparql-results+json"}), timeout=180).read())
        items = {}
        for r in d["results"]["bindings"]:
            qid = r["i"]["value"].rsplit("/", 1)[1]
            co = r["co"]["value"]
            try:
                lon, lat = [float(x) for x in co[co.index("(") + 1:co.index(")")].split()]
            except ValueError:
                continue
            items.setdefault(qid, [round(lon, 4), round(lat, 4), r.get("iLabel", {}).get("value", ""), r.get("iso3", {}).get("value", ""),
                                   r.get("ownerLabel", {}).get("value", ""), ""])
        json.dump({"items": items}, open(os.path.join(out, "out_wd_" + name + ".json"), "w"), ensure_ascii=False)
        print("wikidata", name, len(items))


# ---------------------------------------------------------------------------
def load_countries(path):
    gj = json.load(open(path, encoding="utf-8"))
    out = []
    for f in gj["features"]:
        p = f["properties"]
        iso = p.get("ISO_A3_EH") if p.get("ISO_A3_EH") not in (None, "-99") else p.get("ADM0_A3")
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for poly in polys:
            ring = poly[0]
            xs, ys = [q[0] for q in ring], [q[1] for q in ring]
            out.append((iso, (min(xs), min(ys), max(xs), max(ys)), poly))
    return out


def inside(ring, x, y):
    c = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            c = not c
        j = i
    return c


def country_of(countries, lon, lat):
    best, bd = None, 1e9
    for iso, bb, poly in countries:
        if bb[0] <= lon <= bb[2] and bb[1] <= lat <= bb[3] and inside(poly[0], lon, lat) and not any(inside(h, lon, lat) for h in poly[1:]):
            return iso
    # on the coast just outside the simplified border: the nearest country within ~25 km
    for iso, bb, poly in countries:
        if bb[0] - 0.3 <= lon <= bb[2] + 0.3 and bb[1] - 0.3 <= lat <= bb[3] + 0.3:
            d = min(math.hypot(q[0] - lon, q[1] - lat) for q in poly[0])
            if d < bd:
                best, bd = iso, d
    return best if bd < 0.25 else ""


def km(a, b):
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp, dl = p2 - p1, math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 12742 * math.asin(min(1, math.sqrt(h)))


NOT_OIL = re.compile(r"sugar|azúcar|azucar|sucre|zucker|сахар|salt|\bsal\b|olive|olivo|vegetable|edible|palm|soy|cooking|gold|silver|copper|zinc|nickel|"
                     r"alumin|metal|lithium|cobalt|ethanol|biodiesel|bio-?fuel|renewable|glucose|starch|water|agua|potash|phosphat|fertili|glass|"
                     r"oil mill|\bmill\b|tłuszcz|\bfat\b|grain|粮|油脂|食用|food|flour|cereal|cocoa|coffee|tea\b|rice|oleo|olea|huile|aceite|margarin", re.I)
# a product list of an oil refinery (OpenStreetMap "product" tag)
OIL_PRODUCT = re.compile(r"(^|;)\s*(petroleum|gasoline|petrol|diesel|kerosene|fuel_oil|heating_oil|crude_oil|crude|lpg|naphtha|bitumen|asphalt|"
                         r"jet_fuel|lubricants?|lubricating_oils|oil_products|fuel)\s*(;|$)", re.I)
# the word "refinery" in the languages of the map, or an oil company name
OIL_NAME = re.compile(r"refin|raffin|rafin|rafiner|НПЗ|нефтеперераб|нафтоперероб|炼油|煉油|石化|製油|정유|petro|oil|crude|pertamina|"
                      r"aramco|sinopec|cnpc|reliance|lukoil|rosneft|gazprom|exxon|esso|shell|chevron|valero|marathon|phillips|total|repsol|eni\b|"
                      r"\bbp\b|motor oil|hellenic|orlen|mol\b|omv|ina\b|nis\b|tüpraş|tupras|sasol|petrobras|pemex|pdvsa|ecopetrol|ypf|ancap|"
                      r"adnoc|kpc|knpc|qatar|bapco|sonatrach|nnpc|indian oil|bharat|hindustan|nayara|sk energy|gs caltex|s-oil|hyundai oilbank|"
                      r"eneos|idemitsu|cosmo|formosa|cpc|petronas|ptt|thaioil|irpc|ampol|viva energy|z energy|neste|preem|equinor|galp|cepsa|"
                      r"saras|api\b|tamoil|ruhr oel|bayernoil|miro|schwedt|leuna|heide|gunvor|vitol|cenovus|suncor|imperial|irving|husky|"
                      r"citgo|hf sinclair|par pacific|calumet|delek|cvr|pbf|motiva|lyondell|chalmette|deer park|wynnewood", re.I)


# city gas and filling stations that run on LNG — not terminals
SMALL_LNG = re.compile(r"^LNG$|综合站|储配站|加气|气化站|加注|filling|tankstelle|tankstation|truck|bunker|refuel|\bstation\b|станция|АГЗС|tienda|\bshop\b", re.I)


def dedupe(rows, dist_km):
    out = []
    for r in rows:
        if any(km((r[0], r[1]), (o[0], o[1])) < dist_km for o in out):
            continue
        out.append(r)
    return out


def build(src, ne_path):
    countries = load_countries(ne_path)

    def load(name):
        p = os.path.join(src, name)
        return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None

    # refineries: Wikidata first (curated names), then OpenStreetMap
    ref = []
    for name in ("out_wd_oil_refinery.json", "out_wd_refinery.json"):
        d = load(name)
        generic = name == "out_wd_refinery.json"   # "refinery" includes sugar and metal refineries: only oil names
        for x in (d or {}).get("items", {}).values():
            if not x[2] or re.match(r"^Q\d+$", x[2]) or NOT_OIL.search(x[2]) or (generic and not OIL_NAME.search(x[2] + " " + x[4])):
                continue
            ref.append([x[0], x[1], x[2], x[3], x[4]])
    for name in ("out_osm_refinery_industrial.json", "out_osm_refinery_works.json"):
        for x in load(name) or []:
            if x[0] is None or x[1] is None:
                continue
            t = x[3] or {}
            prod = t.get("product", "")
            text = " ".join([x[2] or "", prod, t.get("operator", "")])
            if NOT_OIL.search(text):
                continue
            if not OIL_PRODUCT.search(prod) and not OIL_NAME.search((x[2] or "") + " " + t.get("operator", "")):
                continue
            ref.append([round(x[0], 4), round(x[1], 4), x[2], "", t.get("operator", "")])
    ref = dedupe(ref, 4)
    # LNG terminals and plants (small Iberian satellite regasification units "UAG …" left out)
    lng = []
    for name in ("out_wd_regasification_terminal.json", "out_wd_liquefied_natural_gas_terminal.json", "out_wd_lng.json"):
        d = load(name)
        for x in (d or {}).get("items", {}).values():
            if x[2] and not re.match(r"^Q\d+$", x[2]):
                lng.append([x[0], x[1], x[2], x[3], x[4]])
    for name in ("out_osm_lng_tag.json", "out_osm_lng_name_ind.json", "out_osm_lng_substance.json"):
        for x in load(name) or []:
            if x[0] is None or x[1] is None or re.match(r"^(UAG|UPAG|Planta satélite)\b", x[2] or "", re.I) or SMALL_LNG.search(x[2] or "") \
                    or (x[2] or "").endswith("?"):
                continue
            t = x[3] or {}
            lng.append([round(x[0], 4), round(x[1], 4), x[2], "", t.get("operator", "")])
    lng = dedupe(lng, 3)
    for rows in (ref, lng):
        for r in rows:   # the country by the border, not Wikidata's "country" (it can be a historical one)
            r[3] = country_of(countries, r[0], r[1]) or r[3]
        rows.sort(key=lambda r: (r[3], r[2]))
    os.makedirs(GEO, exist_ok=True)
    src_txt = "OpenStreetMap contributors (ODbL), Wikidata (CC0)"
    for name, rows in (("refineries.json", ref), ("lng.json", lng)):
        with open(os.path.join(GEO, name), "w", encoding="utf-8") as f:
            json.dump({"src": src_txt, "p": rows}, f, ensure_ascii=False, separators=(",", ":"))
        print(name, len(rows), os.path.getsize(os.path.join(GEO, name)) // 1024, "KB")


if __name__ == "__main__":
    if sys.argv[1] == "fetch":
        fetch(sys.argv[2])
    else:
        build(sys.argv[2], sys.argv[3])
