"""
IMF PortWatch for the map: daily transits through the world's chokepoints (the SHIP tab's "Chokepoints" circles and
the side list) and the ports database (seaports, oil ports). PortWatch counts ships from satellite AIS, a few days
behind.

The map used to ask PortWatch's ArcGIS query service straight from the browser. Since late October 2026 that service
fails often: long queries answer "Cannot perform query", and the browser then showed "ArcGIS: Token Required". So the
bot reads the data and publishes it with the site:

  1. the ArcGIS Hub export of the whole layer as CSV (hub.arcgis.com, the same file as PortWatch's "Download"
     button) — one file, no query limits;
  2. if that fails, the query service in small pieces (one chokepoint at a time, the last ~60 days);
  3. if a layer's item cannot be found, ArcGIS Online's search finds it by its title (in case it was republished).

Chokepoint coordinates come from PortWatch's chokepoints database; if that is out of reach too, from the table below
(the map only needs where to put the circle).

Every 6 hours. A failed read changes nothing: the last good copy stays and the error is kept in "err".
Result: docs/portwatch.json (chokepoints) and docs/pw_ports.json (ports). Standard library only.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "docs", "portwatch.json")
OUT_PORTS = os.path.join(HERE, "docs", "pw_ports.json")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
EVERY_H = 6
PORTS_EVERY_H = 72        # the ports database changes once a year or so
DAYS = 60                 # daily rows kept: the map compares the last 7 days with the 30 before them
ORG = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/"
OWNER = "IMF-portwatch_imf_dataviz"
HUBS = ("https://hub.arcgis.com", "https://portwatch.imf.org")
# the layers: (service name, ArcGIS item id or None — then found by its title)
DAILY = ("Daily_Chokepoints_Data", "3da2b9ca97684916b75c4013f95d18ab")
CHOKES = ("PortWatch_chokepoints_database", "fa9a5800b0ee4855af8b2944ab1e07af")
PORTS = ("PortWatch_ports_database", None)
MAX_CSV = 120 << 20       # a bigger "CSV" is not this layer

# where each chokepoint is, for when the chokepoints database cannot be read (keys: the name without
# "strait", "canal", ... — see key())
WHERE = {
    "suez": (30.60, 32.33), "panama": (9.12, -79.75), "bosporus": (41.12, 29.07), "bab el mandeb": (12.60, 43.33),
    "malacca": (2.50, 101.40), "hormuz": (26.55, 56.45), "good hope": (-34.80, 19.00), "gibraltar": (35.95, -5.60),
    "dover": (51.00, 1.45), "oresund": (55.85, 12.70), "taiwan": (24.40, 119.60), "korea": (34.30, 129.30),
    "tsugaru": (41.50, 140.60), "luzon": (20.50, 121.00), "lombok": (-8.70, 115.75), "ombai": (-8.40, 125.00),
    "bohai": (38.30, 121.10), "torres": (-10.40, 142.20), "sunda": (-6.00, 105.80), "makassar": (-2.50, 118.00),
    "magellan": (-53.30, -70.70), "yucatan": (21.70, -85.80), "windward": (20.00, -73.80), "mona": (18.30, -67.90),
    "balabac": (7.70, 117.00), "bering": (65.80, -169.00), "kerch": (45.30, 36.55), "dardanelles": (40.20, 26.40),
}


def key(name):
    s = re.sub(r"[^a-z ]+", " ", str(name or "").lower().replace("ø", "o").replace("-", " "))
    s = re.sub(r"\b(strait|straits|canal|channel|passage|of|the|cape)\b", " ", s)
    return " ".join(s.split())


def where(name):
    k = key(name)
    if k in WHERE:
        return WHERE[k]
    for w, ll in WHERE.items():
        if w in k or k and k in w:
            return ll
    return None


# ---------------------------------------------------------------------------
# reading
# ---------------------------------------------------------------------------
def get(url, timeout=60, limit=8 << 20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read(limit + 1)
    if len(data) > limit:
        raise ValueError("answer too big")
    return data


def get_json(url, timeout=60):
    d = json.loads(get(url, timeout).decode("utf-8", "replace"))
    if isinstance(d, dict) and isinstance(d.get("error"), dict):
        e = d["error"]
        raise RuntimeError(f"ArcGIS {e.get('code', '')}: {e.get('message', '')}".strip())
    return d


def find_item(title, fetch=get_json):
    """An item id by the layer's title (PortWatch's own items first)."""
    q = urllib.parse.quote(f'title:"{title}" AND owner:{OWNER}')
    d = fetch(f"https://www.arcgis.com/sharing/rest/search?q={q}&num=20&f=json")
    res = [r for r in d.get("results") or [] if isinstance(r, dict) and r.get("id")]
    want = key(title.replace("_", " "))
    res.sort(key=lambda r: (key(str(r.get("title", "")).replace("_", " ")) != want, "Feature" not in str(r.get("type", ""))))
    if not res:
        raise RuntimeError("ArcGIS search: no item called " + title)
    return res[0]["id"]


def hub_csv(item, fetch=get, fetch_json=get_json, wait=time.sleep):
    """The Hub's CSV export of an item's first layer (text). The Hub may answer with the file at once, or with a
    status to wait for and then a link."""
    last = None
    for hub in HUBS:
        url = f"{hub}/api/download/v1/items/{item}/csv?redirect=false&layers=0"
        try:
            for _ in range(8):
                raw = fetch(url, 120, MAX_CSV)
                head = raw[:200].lstrip()
                if not head.startswith(b"{"):
                    return raw.decode("utf-8-sig", "replace")
                st = json.loads(raw.decode("utf-8", "replace"))
                link = st.get("resultUrl") or st.get("url")
                if link and str(st.get("status", "Completed")).lower() in ("completed", "succeeded", "ready", ""):
                    if not safe_link(link):
                        raise RuntimeError("Hub: odd link")
                    return fetch(link, 180, MAX_CSV).decode("utf-8-sig", "replace")
                if str(st.get("status", "")).lower() in ("failed", "error"):
                    raise RuntimeError("Hub: export failed")
                wait(8)
            raise RuntimeError("Hub: export not ready")
        except Exception as e:
            last = e
    raise last or RuntimeError("Hub: no answer")


def safe_link(url):
    """A download link the Hub gave: https to a public host name only (no IP addresses, no local names)."""
    try:
        u = urllib.parse.urlparse(str(url))
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    return (u.scheme == "https" and "." in host and not re.fullmatch(r"[\d.]+|\[?[0-9a-f:]+\]?", host)
            and not host.endswith((".local", ".internal", "localhost")) and not u.username and not u.password)


def num(x):
    try:
        v = float(str(x).replace(",", ""))
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def day_of(row):
    """YYYY-MM-DD from a row: its 'date' column (ISO, 'YYYY/MM/DD hh:mm:ss', or epoch ms) or year/month/day."""
    d = str(row.get("date") or row.get("Date") or "").strip()
    m = re.match(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", d)
    try:
        if m:
            return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
        if re.fullmatch(r"\d{11,13}", d):
            return datetime.fromtimestamp(int(d) / 1000, timezone.utc).date().isoformat()
        y, mo, da = row.get("year"), row.get("month"), row.get("day")
        if y and mo and da:
            return date(int(float(y)), int(float(mo)), int(float(da))).isoformat()
    except (ValueError, OverflowError):
        return None
    return None


FIELDS = ("n_total", "n_tanker", "n_container", "n_dry_bulk", "capacity", "capacity_tanker")


def day_row(a, d):
    return [d] + [None if num(a.get(f)) is None else round(num(a.get(f)), 1) for f in FIELDS]


def parse_daily(text, since):
    """{portid: {"name": .., "days": {day: row}}} from the daily CSV, rows on or after `since` only."""
    out = {}
    rd = csv.DictReader(io.StringIO(text))
    cols = {c.strip().lower(): c for c in rd.fieldnames or []}
    if "portid" not in cols or "n_total" not in cols:
        raise RuntimeError("PortWatch CSV: unexpected columns " + ",".join(list(cols)[:12]))
    for r in rd:
        a = {k.strip().lower(): v for k, v in r.items() if k}
        d = day_of(a)
        pid = str(a.get("portid") or "").strip()
        if not d or not pid or d < since:
            continue
        c = out.setdefault(pid, {"name": str(a.get("portname") or pid).strip()[:60], "days": {}})
        c["days"][d] = day_row(a, d)
    return out


def parse_base(text):
    """{portid: {name, lat, lon, yr, top}} from the chokepoints database CSV."""
    out = {}
    for r in csv.DictReader(io.StringIO(text)):
        a = {k.strip().lower(): v for k, v in r.items() if k}
        pid = str(a.get("portid") or "").strip()
        lat, lon = num(a.get("lat") or a.get("y")), num(a.get("lon") or a.get("x"))
        if pid and lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180:
            out[pid] = {"name": str(a.get("portname") or pid).strip()[:60], "lat": round(lat, 4), "lon": round(lon, 4),
                        "yr": num(a.get("vessel_count_total")), "top": str(a.get("industry_top1") or "")[:40] or None}
    return out


def query_daily(ids, since, fetch=get_json):
    """The query service, one chokepoint at a time (short queries answer; the long ones time out there)."""
    out = {}
    y = int(since[:4])
    for pid in ids:
        if not PID_RE.fullmatch(str(pid)):   # it goes into the query's where clause
            continue
        where_ = f"portid='{pid}' AND year>={y}"
        q = urllib.parse.urlencode({"where": where_, "outFields": "*", "returnGeometry": "false", "f": "json",
                                    "orderByFields": "year DESC,month DESC,day DESC", "resultRecordCount": str(DAYS + 40)})
        for attempt in range(3):   # the service flaps: the same query works on a second try
            try:
                d = fetch(ORG + DAILY[0] + "/FeatureServer/0/query?" + q)
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2)
        for f in d.get("features") or []:
            a = {k.lower(): v for k, v in (f.get("attributes") or {}).items()}
            dd = day_of(a)
            if not dd or dd < since:
                continue
            c = out.setdefault(pid, {"name": str(a.get("portname") or pid).strip()[:60], "days": {}})
            c["days"][dd] = day_row(a, dd)
    return out


def query_base(fetch=get_json):
    d = fetch(ORG + CHOKES[0] + "/FeatureServer/0/query?where=1%3D1&outFields=portid,portname,lat,lon,vessel_count_total,"
              "industry_top1&returnGeometry=false&f=json")
    out = {}
    for f in d.get("features") or []:
        a = f.get("attributes") or {}
        if a.get("portid") and a.get("lat") is not None and a.get("lon") is not None:
            out[a["portid"]] = {"name": a.get("portname") or a["portid"], "lat": a["lat"], "lon": a["lon"],
                                "yr": a.get("vessel_count_total"), "top": a.get("industry_top1")}
    return out


# ---------------------------------------------------------------------------
# chokepoints
# ---------------------------------------------------------------------------
def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def save(path, d):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


ITEM_RE = re.compile(r"[0-9a-f]{32}")
PID_RE = re.compile(r"[A-Za-z0-9_]{1,40}")


def item_of(layer, old, fetch_json):
    """A layer's item id: the one we know, the one found last time, or ArcGIS search (an id goes into a URL path:
    only 32 hex digits are accepted)."""
    it = layer[1] or (old.get("items") or {}).get(layer[0]) or find_item(layer[0], fetch_json)
    if not ITEM_RE.fullmatch(str(it)):
        raise RuntimeError("ArcGIS: odd item id")
    return it


def assemble(daily, base, old_base):
    """The published list: every chokepoint with a place and with days."""
    out = []
    for pid, c in daily.items():
        b = base.get(pid) or old_base.get(pid) or {}
        lat, lon = b.get("lat"), b.get("lon")
        if lat is None:
            ll = where(c.get("name"))
            if not ll:
                continue
            lat, lon = ll
        days = [c["days"][d] for d in sorted(c["days"])][-DAYS:]
        if not days:
            continue
        out.append({"id": pid, "name": b.get("name") or c.get("name") or pid, "lat": lat, "lon": lon,
                    "yr": b.get("yr"), "top": b.get("top"), "days": days})
    out.sort(key=lambda x: int(re.sub(r"\D", "", x["id"]) or 0))
    return out


def build_chokes(now, path=OUT, fetch=get, fetch_json=get_json, every_h=EVERY_H, wait=time.sleep):
    old = load(path)
    if old.get("checked", "") > (now - timedelta(hours=every_h)).isoformat():
        return 0
    since = (now - timedelta(days=DAYS + 5)).date().isoformat()
    errs, via, items = [], None, dict(old.get("items") or {})
    old_base = {c["id"]: c for c in old.get("choke") or [] if isinstance(c, dict) and c.get("id")}
    base = {}
    try:
        it = item_of(CHOKES, old, fetch_json)
        base = parse_base(hub_csv(it, fetch, fetch_json, wait))
        items[CHOKES[0]] = it
    except Exception as e:
        errs.append(f"chokepoints database (Hub): {type(e).__name__}: {e}"[:160])
        try:
            base = query_base(fetch_json)
        except Exception as e2:
            errs.append(f"chokepoints database (query): {type(e2).__name__}: {e2}"[:160])
    daily = {}
    try:
        it = item_of(DAILY, old, fetch_json)
        daily = parse_daily(hub_csv(it, fetch, fetch_json, wait), since)
        items[DAILY[0]] = it
        via = "hub-csv"
    except Exception as e:
        errs.append(f"daily transits (Hub): {type(e).__name__}: {e}"[:160])
    ids = sorted(set(base) | set(old_base) | {f"chokepoint{i}" for i in range(1, 29)})
    stale = [pid for pid in ids if not (daily.get(pid) or {}).get("days")
             or max(daily[pid]["days"]) < (now - timedelta(days=10)).date().isoformat()]
    if stale:   # the export is missing a chokepoint or is behind: those few from the query service
        try:
            got = query_daily(stale, since, fetch_json)
            for pid, c in got.items():
                have = daily.setdefault(pid, {"name": c["name"], "days": {}})
                have["days"].update(c["days"])
            via = via or "arcgis-query"
        except Exception as e:
            errs.append(f"daily transits (query): {type(e).__name__}: {e}"[:160])
    choke = assemble(daily, base, old_base)
    out = dict(old)
    out.update({"checked": now.isoformat(), "src": "IMF PortWatch", "items": items})
    if len(choke) >= 5:
        out.update({"updated": now.isoformat(), "via": via, "choke": choke})
        out.pop("err", None)
        if errs:
            out["warn"] = errs[:4]
        else:
            out.pop("warn", None)
    else:   # nothing usable: the last good copy stays
        out["err"] = "; ".join(errs)[:400] or "no chokepoints"
    save(path, out)
    if out.get("err"):
        raise RuntimeError(out["err"][:200])
    return len(choke)


# ---------------------------------------------------------------------------
# ports
# ---------------------------------------------------------------------------
def parse_ports(text):
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        a = {k.strip().lower(): v for k, v in r.items() if k}
        lat, lon = num(a.get("lat") or a.get("y")), num(a.get("lon") or a.get("x"))
        name = str(a.get("portname") or "").strip()[:50]
        if not name or lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        tot, tk = num(a.get("vessel_count_total")), num(a.get("vessel_count_tanker"))
        rows.append([name, str(a.get("country") or "")[:40], str(a.get("iso3") or "")[:3], round(lat, 4), round(lon, 4),
                     int(tot) if tot is not None else None, int(tk) if tk is not None else None,
                     str(a.get("industry_top1") or "")[:40] or None])
    return rows


def build_ports(now, path=OUT_PORTS, fetch=get, fetch_json=get_json, every_h=PORTS_EVERY_H, wait=time.sleep):
    old = load(path)
    if old.get("checked", "") > (now - timedelta(hours=every_h)).isoformat():
        return 0
    out = dict(old)
    out["checked"] = now.isoformat()
    try:
        it = (old.get("item") or find_item(PORTS[0], fetch_json))
        if not ITEM_RE.fullmatch(str(it)):
            raise RuntimeError("ArcGIS: odd item id")
        rows = parse_ports(hub_csv(it, fetch, fetch_json, wait))
        if len(rows) < 300:
            raise RuntimeError(f"only {len(rows)} ports")
        out.update({"updated": now.isoformat(), "src": "IMF PortWatch", "item": it,
                    "cols": ["name", "country", "iso3", "lat", "lon", "calls", "tanker_calls", "top"], "p": rows})
        out.pop("err", None)
    except Exception as e:
        out["err"] = f"{type(e).__name__}: {e}"[:200]
        out.pop("item", None)   # found again next time (the layer may have been republished)
    save(path, out)
    if out.get("err"):
        raise RuntimeError(out["err"])
    return len(out.get("p") or [])


def build(now=None):
    now = now or datetime.now(timezone.utc)
    n, errs = 0, []
    for fn in (build_chokes, build_ports):
        try:
            n += fn(now) or 0
        except Exception as e:
            errs.append(str(e)[:160])
    if errs and not n:
        raise RuntimeError("; ".join(errs))
    return n


if __name__ == "__main__":
    print("PortWatch rows:", build())
