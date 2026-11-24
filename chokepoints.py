from __future__ import annotations

import gzip
import html.parser
import json
import os
import re
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "docs", "chokepoints.json")
URL = "https://www.eia.gov/outlooks/steo/report/energysecurity/article.php"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
EVERY_H = 20
KEEP_Q = 16
MAX_FLOW = 40.0
ROWS = (("malacca", r"malacca"), ("hormuz", r"hormuz"), ("suez", r"suez"), ("bab", r"bab.{0,3}el.{0,3}mandeb"),
        ("danish", r"danish"), ("turkish", r"turkish|dardanelles|bosp"), ("panama", r"panama"), ("cape", r"good\s+hope"))
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")


# ---------------------------------------------------------------------------
# the page's tables
# ---------------------------------------------------------------------------
class Tables(html.parser.HTMLParser):

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self._t, self._row, self._cell, self._span, self._skip = [], [], None, None, 1, 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1
        elif tag == "table":
            self._t.append([])
        elif tag == "tr" and self._t:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []
            try:
                self._span = max(1, min(20, int(dict(attrs).get("colspan") or 1)))
            except ValueError:
                self._span = 1
        elif tag in ("br", "p", "div") and self._cell is not None:
            self._cell.append(" ")
        elif tag in ("sup",) and self._cell is not None:
            self._cell.append(" ")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._skip = max(0, self._skip - 1)
        elif tag in ("td", "th") and self._cell is not None and self._row is not None:
            text = " ".join("".join(self._cell).split())
            self._row.extend([text] * self._span)
            self._cell = None
        elif tag == "tr" and self._row is not None and self._t:
            if self._row:
                self._t[-1].append(self._row)
            self._row = None
        elif tag == "table" and self._t:
            self.tables.append(self._t.pop())

    def handle_data(self, data):
        if self._cell is not None and not self._skip:
            self._cell.append(data)


def quarter(label):
    s = " ".join(str(label or "").split())
    m = re.search(r"\b([1-4])\s*Q\s*'?(\d{4}|\d{2})\b", s, re.I) or re.search(r"\bQ\s*([1-4])\s*'?(\d{4}|\d{2})\b", s, re.I)
    if m:
        q, y = m.group(1), m.group(2)
    else:
        y_m = re.search(r"\b(20\d{2})\b", s)
        q_m = re.search(r"\b([1-4])\s*Q\b|\bQ\s*([1-4])\b", s, re.I)
        if not (y_m and q_m):
            return None
        q, y = q_m.group(1) or q_m.group(2), y_m.group(1)
    yy = int(y) % 100
    return f"{q}Q{yy:02d}"


def q_key(q):
    return 2000 + int(q[2:]) + (int(q[0]) - 1) / 4


def number(text):
    m = re.search(r"-?\d+(?:\.\d+)?", (text or "").replace(",", ""))
    return float(m.group(0)) if m else None


def row_id(name):
    n = (name or "").lower()
    if "total" in n:
        return None
    for rid, pat in ROWS:
        if re.search(pat, n):
            return rid
    return None


def data_row(r):
    if not r or len(r[0]) > 60 or len(set(r)) < 2:
        return None
    return row_id(r[0])


def col_quarter(t, first, c):
    cells = [t[r][c] if c < len(t[r]) else "" for r in range(first)]
    short = [x for x in cells if 0 < len(x) <= 14]
    for x in reversed(short):
        q = quarter(x)
        if q:
            return q
    return quarter(" ".join(short)) if len(short) > 1 else None


def q_start(q):
    return datetime(2000 + int(q[2:]), 3 * int(q[0]) - 2, 1, tzinfo=timezone.utc)


def parse(page, now=None):
    now = now or datetime.now(timezone.utc)
    p = Tables()
    p.feed(page)
    p.close()
    best, why = None, "no table with the chokepoints"
    for t in p.tables:
        first = next((i for i, r in enumerate(t) if data_row(r)), None)
        if first is None:
            continue
        width = max(len(r) for r in t)
        cols = [(c, col_quarter(t, first, c)) for c in range(1, width)]
        cols = [(c, q) for c, q in cols if q and q_start(q) <= now]
        qs = [q for _, q in cols]
        if len(cols) < 4:
            why = "fewer than 4 quarters in the header"
            continue
        if len(set(qs)) != len(qs) or qs != sorted(qs, key=q_key):
            why = "quarters out of order: " + " ".join(qs)
            continue
        v = {}
        for r in t[first:]:
            rid = data_row(r)
            if not rid or rid in v:
                continue
            nums = [number(r[c]) if c < len(r) else None for c, _ in cols]
            if any(x is not None for x in nums):
                v[rid] = nums
        missing = [rid for rid, _ in ROWS if rid not in v]
        if missing:
            why = "missing rows: " + ", ".join(missing)
            continue
        bad = [f"{rid} {x}" for rid in v for x in v[rid] if x is not None and not 0 <= x <= MAX_FLOW]
        if bad:
            why = "numbers that cannot be flows: " + ", ".join(bad[:4])
            continue
        keep = [i for i in range(len(qs)) if all(v[rid][i] is not None for rid in v)]
        if len(keep) < 4:
            why = "fewer than 4 complete quarters"
            continue
        best = {"q": [qs[i] for i in keep], "v": {rid: [v[rid][i] for i in keep] for rid, _ in ROWS}}
        break
    if not best:
        raise ValueError("EIA chokepoint table: " + why)
    best["released"] = release_date(page)
    return best


def release_date(page):
    m = re.search(r"Release\s+Date(?:\s*(?::|<[^>]{0,200}>))*\s*(" + "|".join(MONTHS) + r")\s+(\d{1,2}),\s*(20\d{2})", page or "", re.I)
    if not m:
        return None
    month = next(i for i, x in enumerate(MONTHS, 1) if x.lower() == m.group(1).lower())
    return f"{m.group(3)}-{month:02d}-{int(m.group(2)):02d}"


def by_quarter(d):
    out, qs, v = {}, d.get("q") or [], d.get("v") or {}
    for i, q in enumerate(qs):
        if not isinstance(q, str) or quarter(q) != q:
            continue
        row = {}
        for rid, _ in ROWS:
            arr = v.get(rid) if isinstance(v.get(rid), list) else []
            x = arr[i] if i < len(arr) else None
            if not isinstance(x, (int, float)) or isinstance(x, bool):
                break
            row[rid] = x
        else:
            out[q] = row
    return out


def merge(old, new):
    have, fresh = by_quarter(old), by_quarter(new)
    changed = sum(1 for q, row in fresh.items() if have.get(q) != row)
    have.update(fresh)
    qs = sorted(have, key=q_key)[-KEEP_Q:]
    return {"q": qs, "v": {rid: [have[q][rid] for q in qs] for rid, _ in ROWS}}, changed


# ---------------------------------------------------------------------------
# the file
# ---------------------------------------------------------------------------
def fetch(url=URL, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*", "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read(5_000_000)
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
    return raw.decode("utf-8", "replace")


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def save(path, d):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def build(now=None, path=OUT, fetcher=fetch, every_h=EVERY_H):
    now = now or datetime.now(timezone.utc)
    old = load(path)
    last_try = max(old.get("checked") or "", old.get("tried") or "")
    if last_try > (now - timedelta(hours=every_h)).isoformat():
        return 0
    try:
        new = parse(fetcher(URL), now)
    except Exception as e:
        save(path, {**old, "tried": now.isoformat(), "error": f"{type(e).__name__}: {e}"[:200]})
        raise
    merged, changed = merge(old, new)
    released = new.get("released") or (None if changed else old.get("released"))
    out = {"updated": now.isoformat() if changed or not old.get("updated") else old["updated"], "checked": now.isoformat(),
           "src": URL, "released": released, "unit": "million barrels a day", **merged}
    save(path, out)
    return changed


if __name__ == "__main__":
    print("chokepoint quarters new or revised:", build(every_h=0))
