import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import basemap  # noqa: E402

JPG = b"\xff\xd8\xff\xe0" + b"0" * 200


class Basemap(unittest.TestCase):

    def test_finds_the_working_address_and_copies_in_parts(self):
        asked = []

        def fetch(url):
            asked.append(url)
            if "Bathymetry" in url and url.endswith(".jpg"):
                return b"<html>404 Not Found</html>"
            if "CityLights" in url:
                return JPG
            if url.endswith(".jpeg"):
                return JPG
            raise OSError("no")
        with tempfile.TemporaryDirectory() as d:
            n1 = basemap.build(base=d, fetch=fetch, per_call=300)
            meta = json.load(open(os.path.join(d, "meta.json")))
            self.assertTrue(meta["layers"]["day"]["url"].endswith(".jpeg"))
            self.assertFalse(meta["layers"]["day"]["done"])
            n2 = basemap.build(base=d, fetch=fetch, per_call=1000)
            meta = json.load(open(os.path.join(d, "meta.json")))
            self.assertEqual(n1 + n2, 2 * 341)
            self.assertTrue(meta["layers"]["day"]["done"] and meta["layers"]["lights"]["done"])
            self.assertTrue(os.path.isfile(os.path.join(d, "day", "4", "15", "15.jpg")))
            asked.clear()
            self.assertEqual(basemap.build(base=d, fetch=fetch), 0)
            self.assertEqual(asked, [])

    def test_nothing_answers(self):
        def down(url):
            raise OSError("blocked")
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(RuntimeError):
                basemap.build(base=d, fetch=down)
            self.assertIn("err", json.load(open(os.path.join(d, "meta.json")))["layers"]["day"])


if __name__ == "__main__":
    unittest.main()
