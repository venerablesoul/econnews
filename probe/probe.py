import json, urllib.request
from playwright.sync_api import sync_playwright
OUT = {}
r = urllib.request.urlopen(urllib.request.Request("https://terminalbloom.com/", headers={"User-Agent": "Mozilla/5.0"}), timeout=30)
OUT["html"] = r.read().decode("utf-8", "replace")[:1200]
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome"); page = b.new_page(viewport={"width": 1440, "height": 900})
    page.goto("https://terminalbloom.com/", wait_until="load", timeout=60000); page.wait_for_timeout(8000)
    OUT["final_url"] = page.url
    OUT["frames"] = [f.url for f in page.frames]
    OUT["maps_in_frames"] = []
    for f in page.frames:
        try:
            OUT["maps_in_frames"].append([f.url, f.evaluate("!!window.MAPS && !!window.TERM && !!window.TERM.CMDS.STORM")])
        except Exception as e:
            OUT["maps_in_frames"].append([f.url, str(e)[:100]])
    b.close()
json.dump(OUT, open("probe/out12.json", "w"), ensure_ascii=False, indent=1)
