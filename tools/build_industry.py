"""Builds the heavy-industry, natural-gas and oil-storage layers of the terminal map:
  docs/geo/factories.json — steel, aluminium, cement, chemicals, pulp and paper, glass, other metals
                            (Climate TRACE asset inventory, CC BY 4.0: location, owner, capacity, CO2e a year)
  docs/geo/gas.json       — natural gas fields (Wikidata, CC0) and underground gas storage (Wikidata + OpenStreetMap, ODbL)
  docs/geo/depots.json    — oil storage terminals and fuel depots (OpenStreetMap, ODbL)

Run where the internet is open:  python3 tools/build_industry.py fetch OUT_DIR
then:                             python3 tools/build_industry.py build OUT_DIR NE_COUNTRIES.geojson
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_infra import GEO, OVERPASS, UA, WIKIDATA, country_of, dedupe, load_countries  # noqa: E402

CT = "https://api.climatetrace.org/v6/assets?sectors=manufacturing&limit=1000&offset={off}"
# Climate TRACE sector → the map's category
CATS = ["steel", "aluminium", "cement", "chemicals", "paper", "glass", "metals"]
SECTOR_CAT = {"iron-and-steel": "steel", "aluminum": "aluminium", "cement": "cement", "chemicals": "chemicals", "other-chemicals": "chemicals",
              "petrochemical-steam-cracking": "chemicals", "pulp-and-paper": "paper", "glass": "glass", "other-metals": "metals"}
OSM_DEPOTS = '[out:json][timeout:280];nwr["industrial"~"^(oil_depot|fuel_depot|tank_farm|oil_terminal|oil_storage|petroleum_terminal)$"];out center tags qt;'
OSM_GAS = ('[out:json][timeout:280];(nwr["industrial"~"gas_storage|underground_gas_storage|gas_reservoir"];'
           'nwr["name"~"[Uu]nderground [Gg]as [Ss]torage|[Gg]as [Ss]torage [Ff]acility|Erdgasspeicher|Untergrundspeicher|Untertagespeicher|Gasspeicher|ПХГ|'
           '[Пп]одземное хранилище газа|stockage de gaz|stoccaggio gas|magazyn gazu|zásobník plynu"][!"highway"];);out center tags qt;')
# Wikidata classes: natural gas field, gas condensate field, oil and gas field (two items), underground gas storage
WD_GAS_FIELDS = ["Q1349255", "Q12093880", "Q4291415", "Q12132769"]
WD_GAS_STORAGE = ["Q2497639"]
KEEP_TAGS = ("industrial", "operator", "capacity", "substance", "product", "storage", "content", "man_made", "landuse", "name:en", "name:ru", "owner")

# names that mean underground storage of natural gas, and names of things that are not
UGS_NAME = re.compile(r"(gas storage|storage field|storage dome|gas hub|erdgasspeicher|untergrundspeicher|untertagespeicher|porenspeicher|kavernenspeicher|"
                      r"gasspeicher|kaverne|упхг|пхг|подземн\w* хранилищ\w* газа|zásobník|stoccaggio|gaslager|magazyn gazu|stockage|almacenamiento|"
                      r"gasopslag|gas cavern|underground storage)", re.I)
NOT_UGS = re.compile(r"(lpg|glp|gpl|propan|butan|air liquide|linde|helium|primagaz|abastible|terminal|\bpt\.|elpiji|gasometer|oxygen|\bcng\b|\blng\b|aufgegeben|"
                     r"ehemalig|former|closed|silo|sonde|inspektion|tankstelle|filling|zugang)", re.I)


def _get(url, data=None, headers=None, timeout=240):
    h = {"User-Agent": UA, "Accept": "application/json"}
    h.update(headers or {})
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h), timeout=timeout).read())


def fetch(out):
    os.makedirs(out, exist_ok=True)
    rows, off = [], 0
    while True:
        a = _get(CT.format(off=off)).get("assets") or []
        for x in a:
            es = x.get("EmissionsSummary") or [{}]
            e = next((s for s in es if s.get("Gas") == "co2e_100yr"), es[0] if es else {})
            c = (x.get("Centroid") or {}).get("Geometry")
            rows.append([c, x.get("Sector"), x.get("AssetType"), x.get("Name"), x.get("Country"), ((x.get("Owners") or [{}])[0] or {}).get("CompanyName"),
                         e.get("Capacity"), e.get("CapacityUnits"), e.get("Activity"), e.get("ActivityUnits"), e.get("EmissionsQuantity")])
        if len(a) < 1000:
            break
        off += 1000
    json.dump(rows, open(os.path.join(out, "ct_mfg.json"), "w"), ensure_ascii=False)
    for name, ql in (("out_osm_depots.json", OSM_DEPOTS), ("out_osm_gas_storage.json", OSM_GAS)):
        d = None
        for host in OVERPASS:
            try:
                d = _get(host, data=urllib.parse.urlencode({"data": ql}).encode(), timeout=320)
                break
            except Exception as e:
                print("overpass", name, host, e)
        els = [[e.get("lon") or (e.get("center") or {}).get("lon"), e.get("lat") or (e.get("center") or {}).get("lat"),
                (e.get("tags") or {}).get("name") or (e.get("tags") or {}).get("name:en"), {k: v for k, v in (e.get("tags") or {}).items() if k in KEEP_TAGS}]
               for e in (d or {}).get("elements", [])]
        json.dump(els, open(os.path.join(out, name), "w"), ensure_ascii=False)
        time.sleep(5)
    for qid in WD_GAS_FIELDS + WD_GAS_STORAGE:
        q = ("SELECT ?i ?iLabel ?co ?iso3 ?opLabel WHERE { ?i wdt:P31 wd:%s ; wdt:P625 ?co . OPTIONAL { ?i wdt:P17 ?cn . ?cn wdt:P298 ?iso3 } "
             "OPTIONAL { ?i wdt:P137 ?op } SERVICE wikibase:label { bd:serviceParam wikibase:language \"en,ru,de,fr,es\". } } LIMIT 8000") % qid
        d = _get(WIKIDATA + "?format=json&query=" + urllib.parse.quote(q), headers={"Accept": "application/sparql-results+json"})
        items = {}
        for b in d["results"]["bindings"]:
            co = b["co"]["value"]
            if co.startswith("Point("):
                lon, lat = map(float, co[6:-1].split())
                items[b["i"]["value"].rsplit("/", 1)[1]] = [round(lon, 4), round(lat, 4), b.get("iLabel", {}).get("value", ""),
                                                            b.get("iso3", {}).get("value", ""), b.get("opLabel", {}).get("value", "")]
        json.dump(items, open(os.path.join(out, "out_wd_" + qid + ".json"), "w"), ensure_ascii=False)
        time.sleep(1)


def _num(x):
    return round(x) if isinstance(x, (int, float)) and x > 1 else None


def factories(src, countries):
    rows = json.load(open(os.path.join(src, "ct_mfg.json"), encoding="utf-8"))
    types, out = [], []
    for c, sector, atype, name, iso, owner, cap, cap_u, act, act_u, emis in rows:
        cat = SECTOR_CAT.get(sector)
        if not cat or not c or not name:
            continue
        lon, lat = round(c[0], 3), round(c[1], 3)
        t = (atype or "").replace("_", " ").strip()
        t = "" if t.lower() in ("unknown", "other metals", "other chemicals", "manufacturing", "other minerals") else t
        if t not in types:
            types.append(t)
        # capacity only where it is in tonnes of product (Climate TRACE leaves "unitless" placeholders)
        cap = _num(cap) if cap_u and cap_u != "unitless" else None
        out.append([lon, lat, CATS.index(cat), name.strip(), iso or country_of(countries, lon, lat), (owner or "").strip(), cap, _num(emis), types.index(t)])
    out.sort(key=lambda r: -(r[7] or 0))   # the biggest emitters first: drawn last, on top
    return {"src": "Climate TRACE (CC BY 4.0)", "cats": CATS, "types": types, "p": out}


def gas(src, countries):
    out = []
    for qid in WD_GAS_FIELDS:
        path = os.path.join(src, "out_wd_" + qid + ".json")
        if os.path.exists(path):
            for lon, lat, name, iso, op in json.load(open(path, encoding="utf-8")).values():
                if name and not re.fullmatch(r"Q\d+", name):
                    out.append([lon, lat, 0, name, iso or country_of(countries, lon, lat), op])
    fields = dedupe(out, 3)
    stor = []
    for qid in WD_GAS_STORAGE:
        path = os.path.join(src, "out_wd_" + qid + ".json")
        if os.path.exists(path):
            for lon, lat, name, iso, op in json.load(open(path, encoding="utf-8")).values():
                if name and not re.fullmatch(r"Q\d+", name):
                    stor.append([lon, lat, 1, name, iso or country_of(countries, lon, lat), op])
    for lon, lat, name, t in json.load(open(os.path.join(src, "out_osm_gas_storage.json"), encoding="utf-8")):
        if lon is None or not name or t.get("man_made") in ("pipeline", "monitoring_station", "gasometer", "reservoir_covered"):
            continue
        if NOT_UGS.search(name) or not (UGS_NAME.search(name) or t.get("man_made") == "gas_cavern"):
            continue
        stor.append([round(lon, 4), round(lat, 4), 1, name, country_of(countries, lon, lat), t.get("operator") or t.get("owner") or ""])
    # one point per site: Wikidata first, then the OpenStreetMap name that says most
    stor = dedupe(sorted(stor, key=lambda r: (len(r[3]) < 6, -len(r[3]))), 8)
    return {"src": "Wikidata (CC0), OpenStreetMap contributors (ODbL)", "p": fields + stor}


def depots(src, countries):
    out = []
    for lon, lat, name, t in json.load(open(os.path.join(src, "out_osm_depots.json"), encoding="utf-8")):
        if lon is None:
            continue
        out.append([round(lon, 4), round(lat, 4), name or "", country_of(countries, lon, lat), t.get("operator") or t.get("owner") or ""])
    out = dedupe(sorted(out, key=lambda r: not r[2]), 1.5)
    return {"src": "OpenStreetMap contributors (ODbL)", "p": out}


def build(src, ne_path):
    countries = load_countries(ne_path)
    for name, fn in (("factories.json", factories), ("gas.json", gas), ("depots.json", depots)):
        d = fn(src, countries)
        with open(os.path.join(GEO, name), "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
        print(name, len(d["p"]), round(os.path.getsize(os.path.join(GEO, name)) / 1024), "KB")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "fetch":
        fetch(sys.argv[2])
    elif len(sys.argv) >= 4 and sys.argv[1] == "build":
        build(sys.argv[2], sys.argv[3])
    else:
        print(__doc__)
