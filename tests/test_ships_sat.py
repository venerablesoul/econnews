import io
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import ais        # noqa: E402
import portwatch  # noqa: E402
import sat        # noqa: E402

NOW = datetime(2026, 11, 24, 6, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# PortWatch
# ---------------------------------------------------------------------------
DAILY_HEAD = "date,year,month,day,portid,portname,n_container,n_dry_bulk,n_tanker,n_cargo,n_total,capacity,capacity_tanker,ObjectId\n"


def daily_csv(ids, days=50, end=NOW.date() - timedelta(days=4), fmt="slash"):
    rows = [DAILY_HEAD]
    for pid, name, n in ids:
        for i in range(days):
            d = end - timedelta(days=i)
            ds = d.strftime("%Y/%m/%d 00:00:00+00") if fmt == "slash" else d.isoformat()
            rows.append(f"{ds},{d.year},{d.month},{d.day},{pid},\"{name}\",10,20,{n // 3},40,{n},123456.5,45000,{i}\n")
    rows.append(f"2019/01/01 00:00:00+00,2019,1,1,{ids[0][0]},\"{ids[0][1]}\",1,1,1,1,1,1,1,99999\n")
    return "".join(rows)


BASE_CSV = ("portid,portname,fullname,lat,lon,vessel_count_total,industry_top1\n"
            "chokepoint1,Suez Canal,Suez Canal,30.59,32.43,26000,Container\n"
            "chokepoint6,Strait of Hormuz,Strait of Hormuz,26.57,56.25,40000,Tanker\n"
            "chokepoint4,Bab el-Mandeb Strait,Bab el-Mandeb,12.6,43.4,20000,Tanker\n"
            "chokepoint5,Malacca Strait,Malacca,2.2,102.2,80000,Container\n"
            "chokepoint2,Panama Canal,Panama,9.1,-79.7,11000,Container\n"
            "chokepoint7,Cape of Good Hope,Cape,-34.9,19.5,9000,Dry bulk\n")


class PortWatch(unittest.TestCase):

    def test_names_dates_and_rows(self):
        self.assertEqual(portwatch.where("Strait of Hormuz"), (26.55, 56.45))
        self.assertEqual(portwatch.where("Bab el-Mandeb Strait"), (12.60, 43.33))
        self.assertEqual(portwatch.where("Cape of Good Hope"), (-34.80, 19.00))
        self.assertEqual(portwatch.where("Øresund Strait"), (55.85, 12.70))
        self.assertIsNone(portwatch.where("Nowhere Strait"))
        self.assertEqual(portwatch.day_of({"date": "2026/11/20 00:00:00+00"}), "2026-11-20")
        self.assertEqual(portwatch.day_of({"date": "2026-11-20T00:00:00Z"}), "2026-11-20")
        self.assertEqual(portwatch.day_of({"date": "1763596800000"}), "2025-11-20")
        self.assertEqual(portwatch.day_of({"year": "2026", "month": "11", "day": "3"}), "2026-11-03")
        self.assertIsNone(portwatch.day_of({"date": "2026/02/30"}))
        got = portwatch.parse_daily(daily_csv([("chokepoint6", "Strait of Hormuz", 30)]), "2026-10-01")
        self.assertEqual(set(got), {"chokepoint6"})
        days = got["chokepoint6"]["days"]
        self.assertEqual(min(days) >= "2026-10-01", True)
        self.assertNotIn("2019-01-01", days)
        self.assertEqual(days["2026-11-20"], ["2026-11-20", 30.0, 10.0, 10.0, 20.0, 123456.5, 45000.0])
        with self.assertRaises(RuntimeError):
            portwatch.parse_daily("a,b\n1,2\n", "2026-01-01")

    def test_hub_export_waits_for_the_file(self):
        calls = []

        def fetch(url, timeout=60, limit=0):
            calls.append(url)
            if "api/download" in url and len(calls) == 1:
                return b'{"status":"Pending"}'
            if "api/download" in url:
                return b'{"status":"Completed","resultUrl":"https://files.example/x.csv"}'
            return "﻿portid,n_total\nchokepoint1,5\n".encode()
        text = portwatch.hub_csv("abc", fetch, wait=lambda s: None)
        self.assertTrue(text.startswith("portid"))
        self.assertIn("layers=0", calls[0])
        self.assertEqual(calls[-1], "https://files.example/x.csv")
        self.assertEqual(portwatch.hub_csv("abc", lambda u, t=0, l=0: b"portid,n_total\n", wait=lambda s: None), "portid,n_total\n")
        with self.assertRaises(RuntimeError):
            portwatch.hub_csv("abc", lambda u, t=0, l=0: b'{"status":"Completed","resultUrl":"http://x/y.csv"}', wait=lambda s: None)

    def test_build_from_the_export_and_the_query_for_what_is_missing(self):
        ids = [("chokepoint1", "Suez Canal", 60), ("chokepoint6", "Strait of Hormuz", 30), ("chokepoint4", "Bab el-Mandeb Strait", 25),
               ("chokepoint5", "Malacca Strait", 220), ("chokepoint7", "Cape of Good Hope", 50)]
        queried = []

        def fetch(url, timeout=60, limit=0):
            if PortWatchIds.DAILY in url:
                return daily_csv(ids).encode()
            if PortWatchIds.BASE in url:
                return BASE_CSV.encode()
            raise AssertionError(url)

        def fetch_json(url):
            q = dict(x.split("=", 1) for x in url.split("?", 1)[1].split("&"))
            where = portwatch.urllib.parse.unquote_plus(q["where"])
            pid = where.split("'")[1]
            queried.append(pid)
            if pid != "chokepoint2":
                return {"features": []}
            d = NOW.date() - timedelta(days=5)
            return {"features": [{"attributes": {"portid": "chokepoint2", "portname": "Panama Canal", "year": d.year, "month": d.month,
                                                 "day": d.day, "n_total": 33, "n_tanker": 4}}]}
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "portwatch.json")
            n = portwatch.build_chokes(NOW, path, fetch, fetch_json, wait=lambda s: None)
            self.assertEqual(n, 6)
            with open(path) as f:
                d = json.load(f)
            by = {c["id"]: c for c in d["choke"]}
            self.assertEqual(by["chokepoint6"]["lat"], 26.57)
            self.assertEqual(by["chokepoint6"]["top"], "Tanker")
            self.assertEqual(len(by["chokepoint1"]["days"]), 50)
            self.assertEqual(by["chokepoint2"]["days"][0][1], 33.0)
            self.assertIn("chokepoint2", queried)
            self.assertNotIn("chokepoint1", queried)
            self.assertEqual(d["via"], "hub-csv")
            self.assertNotIn("err", d)
            self.assertEqual(portwatch.build_chokes(NOW + timedelta(hours=2), path, fetch, fetch_json), 0)
            def down(*a, **k):
                raise OSError("Token Required")
            with self.assertRaises(RuntimeError):
                portwatch.build_chokes(NOW + timedelta(hours=7), path, down, down, wait=lambda s: None)
            with open(path) as f:
                d2 = json.load(f)
            self.assertEqual(len(d2["choke"]), 6)
            self.assertIn("Token Required", d2["err"])

    def test_without_the_database_the_table_places_the_circles(self):
        def fetch(url, timeout=60, limit=0):
            if PortWatchIds.DAILY in url:
                return daily_csv([("chokepoint%d" % i, n, 10) for i, n in enumerate(
                    ["Suez Canal", "Strait of Hormuz", "Dover Strait", "Kerch Strait", "Mona Passage", "Unknown Strait"], 1)]).encode()
            raise OSError("Token Required")

        def fetch_json(url):
            raise OSError("Token Required")
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "portwatch.json")
            self.assertEqual(portwatch.build_chokes(NOW, path, fetch, fetch_json, wait=lambda s: None), 5)
            with open(path) as f:
                d = json.load(f)
            self.assertEqual([c["name"] for c in d["choke"]], ["Suez Canal", "Strait of Hormuz", "Dover Strait", "Kerch Strait", "Mona Passage"])
            self.assertTrue(d["warn"])

    def test_ports(self):
        rows = "portname,country,ISO3,lat,lon,vessel_count_total,vessel_count_tanker,industry_top1\n" + "".join(
            f"Port {i},Country,ABC,{i % 80}.5,{i % 170}.25,{1000 + i},{i % 7},Container\n" for i in range(400)) + "Bad,,,,,,,\n"

        def fetch(url, timeout=60, limit=0):
            return rows.encode()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "pw_ports.json")
            n = portwatch.build_ports(NOW, path, fetch, lambda u: {"results": [{"id": "ab" * 16, "title": "PortWatch_ports_database", "type": "Feature Service"}]},
                                      wait=lambda s: None)
            self.assertEqual(n, 400)
            with open(path) as f:
                d = json.load(f)
            self.assertEqual(d["p"][3], ["Port 3", "Country", "ABC", 3.5, 3.25, 1003, 3, "Container"])
            self.assertEqual(d["item"], "ab" * 16)
            with self.assertRaises(RuntimeError):
                portwatch.build_ports(NOW + timedelta(days=4), os.path.join(tmp, "p2.json"), fetch,
                                      lambda u: {"results": [{"id": "../../x?y=1", "title": "PortWatch_ports_database"}]}, wait=lambda s: None)


class PortWatchIds:
    DAILY = portwatch.DAILY[1]
    BASE = portwatch.CHOKES[1]


# ---------------------------------------------------------------------------
# AIS: the world layer and the tracks
# ---------------------------------------------------------------------------
def ship(mmsi, lat, lon, t, **kw):
    d = {"mmsi": mmsi, "lat": lat, "lon": lon, "t": t.isoformat(timespec="seconds"), "area": ais.area_of(lat, lon), "sog": 12.0, "cog": 90}
    d.update(kw)
    return d


class ShipsWorld(unittest.TestCase):

    def test_subscription_is_the_whole_world(self):
        sub = ais.subscription("K")
        self.assertEqual(sub["BoundingBoxes"], [[[-90.0, -180.0], [90.0, 180.0]]])

    def test_tracks_and_kinds(self):
        t0, t1, t2 = NOW, NOW + timedelta(minutes=30), NOW + timedelta(minutes=60)
        new0 = {"111111111": ship(111111111, 26.40, 56.20, t0, type=80, name="TANK ONE"),
                "222222222": ship(222222222, 51.90, 3.00, t0, type=71, name="BOX TWO"),
                "333333333": ship(333333333, 40.00, 10.00, t0, type=60),
                "444444444": ship(444444444, 10.00, 10.00, t0)}
        w, k = ais.merge_world({}, {}, set(), new0, t0)
        self.assertEqual(sorted(r[0] for r in w["s"]), [111111111, 222222222])
        self.assertEqual(w["counts"], {"t": 1, "c": 1})
        self.assertEqual(k["c"], {"2026-11-24": [222222222]})
        new1 = {"111111111": ship(111111111, 26.45, 56.30, t1), "222222222": ship(222222222, 51.95, 3.10, t1)}
        w, k = ais.merge_world(w, k, {"111111111"}, new1, t1)
        rows = {r[0]: dict(zip(w["cols"], r)) for r in w["s"]}
        self.assertEqual(rows[111111111]["track"], [26.4, 56.2, 30])
        self.assertEqual(rows[222222222]["kind"], "c")
        new2 = {"111111111": ship(111111111, 26.452, 56.302, t2)}
        w, k = ais.merge_world(w, k, {"111111111"}, new2, t2)
        rows = {r[0]: dict(zip(w["cols"], r)) for r in w["s"]}
        self.assertEqual(len(rows[111111111]["track"]), 3)
        self.assertEqual(rows[111111111]["minute"], ais.minute(t2.isoformat()))
        w, k = ais.merge_world(w, k, set(), {}, t2 + timedelta(hours=7))
        self.assertEqual(w["s"], [])
        self.assertEqual(k["c"], {"2026-11-24": [222222222]})
        w, k = ais.merge_world(w, k, set(), {"222222222": {"mmsi": 222222222, "type": 30}}, t2 + timedelta(hours=8))
        self.assertEqual(k["c"], {})

    def test_track_keeps_the_last_points_only_and_crosses_the_date_line(self):
        rec = {"lat": 0.0, "lon": 179.99, "t": NOW.isoformat()}
        for i in range(1, 10):
            t = NOW + timedelta(minutes=30 * i)
            ais.add_track(rec, 0.0 + i * 0.1, 179.99, t.isoformat(), 0)
            rec.update({"lat": 0.0 + i * 0.1, "t": t.isoformat()})
        self.assertEqual(len(rec["trk"]), ais.TRACK_PTS)
        self.assertFalse(ais.moved(0, 179.999, 0, -179.999))
        self.assertTrue(ais.moved(0, 179.99, 0, -179.98))

    def test_tankers_file_has_tracks_and_build_writes_three_files(self):
        t0, t1 = NOW, NOW + timedelta(minutes=31)
        seq = [({"111111111": ship(111111111, 26.40, 56.20, t0, type=80), "222222222": ship(222222222, 51.9, 3.0, t0, type=72)}, 5),
               ({"111111111": ship(111111111, 26.50, 56.35, t1)}, 3)]
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "ships.json")
            env = dict(os.environ, AISSTREAM_API_KEY="KEY")
            old = os.environ.copy()
            os.environ.update(env)
            try:
                self.assertEqual(ais.build(t0, path=path, listen_fn=lambda k, now=None: seq[0]), 5)
                self.assertEqual(ais.build(t1, path=path, listen_fn=lambda k, now=None: seq[1]), 3)
            finally:
                os.environ.clear()
                os.environ.update(old)
            with open(path) as f:
                tk = json.load(f)
            self.assertEqual(tk["ships"][0]["trk"], [[26.4, 56.2, ais.minute(t0.isoformat())]])
            with open(os.path.join(d, "ships_world.json")) as f:
                w = json.load(f)
            self.assertEqual(sorted(r[0] for r in w["s"]), [111111111, 222222222])
            self.assertTrue(os.path.exists(os.path.join(d, "ais_kinds.json")))
            many = {str(200000000 + i): ship(200000000 + i, (i % 160) - 80 + 0.123, (i % 350) - 175 + 0.456, t1, type=70 + i % 20, name="SHIP %d" % i,
                                             dest="SOMEWHERE", draught=9.5) for i in range(9000)}
            w2, _ = ais.merge_world({}, {}, set(), many, t1)
            for r in w2["s"]:
                r[-1] = [12.35, 123.46, 180] * ais.TRACK_PTS
            self.assertLessEqual(len(w2["s"]), ais.MAX_WORLD)
            self.assertLess(len(json.dumps(w2, separators=(",", ":"))), 900_000)


# ---------------------------------------------------------------------------
# satellite pictures
# ---------------------------------------------------------------------------
def png(color, alpha=255, circles=True):
    from PIL import Image, ImageDraw
    im = Image.new("RGBA", (256, 256), color + (alpha,))
    if circles and alpha:
        d = ImageDraw.Draw(im)
        for x in range(20, 240, 60):
            d.ellipse([x, 100, x + 30, 130], fill=(200, 200, 195, 255))
    b = io.BytesIO()
    im.save(b, "PNG")
    return b.getvalue()


class SatellitePictures(unittest.TestCase):

    def test_geometry(self):
        b = sat.bbox(35.957, -96.757, 7.0)
        self.assertAlmostEqual(b[3] - b[1], 7.0 / 111.32, places=3)
        tiles, rng, crop, z = sat.tiles_for(b)
        self.assertEqual(z, 14)
        self.assertLessEqual(len(tiles), 25)
        w, h = (rng[2] - rng[0] + 1) * 256, (rng[3] - rng[1] + 1) * 256
        self.assertTrue(0 <= crop[0] < crop[2] <= w and 0 <= crop[1] < crop[3] <= h)
        self.assertAlmostEqual((crop[2] - crop[0]) / (crop[3] - crop[1]), 1.0, delta=0.05)
        for s in sat.SITES:
            self.assertLessEqual(len(sat.tiles_for(sat.bbox(s[3], s[4], s[5]))[0]), 25, s[0])
        self.assertEqual((sat.zoom_for(0), sat.zoom_for(52), sat.zoom_for(60)), (14, 13, 13))

    def fake(self, passes, colors):
        calls = {"search": 0, "tiles": 0}

        def fetch(url, body=None, timeout=60, limit=0):
            if url == sat.STAC:
                calls["search"] += 1
                dt0, dt1 = body["datetime"].split("/")
                feats = [{"id": p[0], "bbox": [-180, -90, 180, 90], "properties": {"datetime": p[1], "eo:cloud_cover": p[2]}}
                         for p in passes if dt0[:10] <= p[1][:10] <= dt1[:10]]
                feats.append({"id": "S2X_EDGE_OF_TILE_ITEM", "bbox": [0, 0, 1, 1], "properties": {"datetime": "2026-11-23T10:00:00Z"}})
                return json.dumps({"features": feats}).encode()
            calls["tiles"] += 1
            item = sat.urllib.parse.parse_qs(url.split("?", 1)[1])["item"][0]
            self.assertNotEqual(item, "S2X_EDGE_OF_TILE_ITEM")
            c = colors[item]
            return png(c[0], c[1]) if isinstance(c, tuple) and len(c) == 2 else png(c)
        return fetch, calls

    def test_newest_clear_pass_and_one_to_compare(self):
        passes = [("S2B_CLOUDY_20261122", "2026-11-22T10:31:00Z", 30.0), ("S2A_CLEAR_20261117", "2026-11-17T10:31:00Z", 5.0),
                  ("S2A_EDGE_20261112", "2026-11-12T10:31:00Z", 1.0), ("S2C_OLD_20261010", "2026-10-10T10:31:00Z", 2.0)]
        colors = {"S2B_CLOUDY_20261122": (235, 235, 238), "S2A_CLEAR_20261117": (70, 85, 60), "S2A_EDGE_20261112": ((70, 85, 60), 0),
                  "S2C_OLD_20261010": (90, 80, 60)}
        fetch, calls = self.fake(passes, colors)
        with tempfile.TemporaryDirectory() as d:
            path, sdir = os.path.join(d, "sat.json"), os.path.join(d, "sat")
            n = sat.build(NOW, path, sdir, fetch, per_call=1)
            self.assertEqual(n, 2)
            with open(path) as f:
                out = json.load(f)
            first = [s for s in out["sites"] if s["imgs"]]
            self.assertEqual(len(first), 1)
            s = first[0]
            self.assertEqual([i["d"] for i in s["imgs"]], ["2026-10-10", "2026-11-17"])
            self.assertEqual(s["imgs"][1]["f"], "sat/%s/2026-11-17.jpg" % s["id"])
            from PIL import Image
            im = Image.open(os.path.join(d, s["imgs"][1]["f"]))
            self.assertEqual((im.format, im.size[0]), ("JPEG", sat.SIZE))
            self.assertEqual(len(out["sites"]), len(sat.SITES))
            n2 = sat.build(NOW + timedelta(hours=1), path, sdir, fetch, per_call=1)
            with open(path) as f:
                out = json.load(f)
            self.assertEqual(sum(1 for s in out["sites"] if s["imgs"]), 2)
            self.assertEqual(n2, 2)

    def test_keeps_four_and_reports_errors(self):
        with tempfile.TemporaryDirectory() as d:
            path, sdir = os.path.join(d, "sat.json"), os.path.join(d, "sat")
            sid = sat.SITES[0][0]
            os.makedirs(os.path.join(sdir, sid))
            imgs = []
            for day in ("2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"):
                open(os.path.join(sdir, sid, day + ".jpg"), "wb").close()
                imgs.append({"d": day, "f": f"sat/{sid}/{day}.jpg"})
            with open(path, "w") as f:
                json.dump({"sites": [{"id": sid, "imgs": imgs, "checked": "2026-01-01"}] +
                                    [{"id": s[0], "imgs": [], "checked": NOW.isoformat()} for s in sat.SITES[1:]]}, f)
            fetch, _ = self.fake([("S2A_NEW_20261120", "2026-11-20T10:00:00Z", 3.0)], {"S2A_NEW_20261120": (60, 70, 50)})
            self.assertEqual(sat.build(NOW, path, sdir, fetch, per_call=1), 1)
            self.assertEqual(sorted(os.listdir(os.path.join(sdir, sid))), ["2026-09-01.jpg", "2026-10-01.jpg", "2026-11-01.jpg", "2026-11-20.jpg"])

            def down(*a, **k):
                raise OSError("no network")
            with self.assertRaises(RuntimeError):
                sat.build(NOW + timedelta(days=1), path, sdir, down, per_call=2)
            with open(path) as f:
                out = json.load(f)
            self.assertEqual(len(out["err"]), 2)
            self.assertEqual(len([s for s in out["sites"] if s["id"] == sid][0]["imgs"]), 4)


if __name__ == "__main__":
    unittest.main()
