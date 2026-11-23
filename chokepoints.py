"""
Oil through the world's chokepoints by quarter — the SPLC diagram on the map (docs/terminal/map.js).

Source: EIA, Short-Term Energy Outlook, "Global Energy Security Data", Table 2: crude oil and petroleum liquids
through each chokepoint and around the Cape of Good Hope, million barrels a day, by quarter. EIA refreshes it with
every monthly STEO (a new quarter appears once a quarter, older quarters get revised). EIA publishes no data file
for this table, so the HTML table itself is read.

The page is checked once a day. A page that does not look right — a new layout, a missing chokepoint, a number that
cannot be a flow — changes nothing: the last good copy stays (and map.js still has the November 2026 figures built in
as the last resort), and the error goes to the log. New quarters are added to the history already kept; revised
quarters replace the old numbers.
Result: docs/chokepoints.json. Python standard library only.
"""
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
EVERY_H = 20          # once a day is plenty for a monthly report
KEEP_Q = 16           # quarters of history kept (four years)
MAX_FLOW = 40.0       # mb/d: more than any chokepoint carries (Malacca, the biggest, is ~24)
# the map's ids and how EIA names the rows ("Suez Canal and SUMED Pipeline", "Danish Straits", ...)
ROWS = (("malacca", r"malacca"), ("hormuz", r"hormuz"), ("suez", r"suez"), ("bab", r"bab.{0,3}el.{0,3}mandeb"),
        ("danish", r"danish"), ("turkish", r"turkish|dardanelles|bosp"), ("panama", r"panama"), ("cape", r"good\s+hope"))
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")


# ---------------------------------------------------------------------------
# the page's tables
# ---------------------------------------------------------------------------
class Tables(html.parser.HTMLParser):
    """Every <table> as a list of rows; a row is a list of cell texts, a cell repeated over its colspan."""

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
            self._cell.append(" ")   # a footnote mark must not glue to the number before it

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
    """'2Q25', '2Q 2025', 'Q2 2025', '2025 2Q', '2025 Q2' → '2Q25'; None for anything else."""
    s = " ".join(str(label or "").split())
    m = re.search(r"\b([1-4])\s*Q\s*'?(\d{4}|\d{2})\b", s, re.I) or re.search(r"\bQ\s*([1-4])\s*'?(\d{4}|\d{2})\b", s, re.I)
    if m:
        q, y = m.group(1), m.group(2)
    else:   # the year and the quarter in two header rows, joined: "2025 2Q"
        y_m = re.search(r"\b(20\d{2})\b", s)
        q_m = re.search(r"\b([1-4])\s*Q\b|\bQ\s*([1-4])\b", s, re.I)
        if not (y_m and q_m):
            return None
        q, y = q_m.group(1) or q_m.group(2), y_m.group(1)
    yy = int(y) % 100
    return f"{q}Q{yy:02d}"


def q_key(q):
    """'2Q25' → 2025.25 (sortable)."""
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
    """The chokepoint id of a data row, or None. A title row spanning the table ("... and the Cape of Good Hope") has
    the same text in every cell and is not a data row."""
    if not r or len(r[0]) > 60 or len(set(r)) < 2:
        return None
    return row_id(r[0])


def col_quarter(t, first, c):
    """The quarter of column c from the header rows above the data. Short cells only: a title row spanning the table
    ("... 2Q25–3Q26") must not label every column; a year and a quarter in two rows ("2025" over "Q2") are joined."""
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
    """The page → {"q": [quarters, oldest first], "v": {id: [mb/d, ...]}, "released": "2026-11-10" or None}.
    Raises ValueError when no table looks like the chokepoint table."""
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
        # quarters that have begun (a forecast column, if EIA ever adds one, is left out)
        cols = [(c, col_quarter(t, first, c)) for c in range(1, width)]
        cols = [(c, q) for c, q in cols if q and q_start(q) <= now]
        qs = [q for _, q in cols]
        if len(cols) < 4:
            why = "fewer than 4 quarters in the header"
            continue
        if len(set(qs)) != len(qs) or qs != sorted(qs, key=q_key):
            why = "quarters out of order: " + " ".join(qs)
            continue
        # the first row of each chokepoint that has numbers (a footnote row naming it has none)
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
        # only the quarters every chokepoint has a number for
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
    """'Release Date: November 10, 2026' → '2026-11-10'. On EIA's page the label is bold, so tags may stand between
    the label and the date ("<strong>Release Date:</strong> November 10, 2026")."""
    m = re.search(r"Release\s+Date(?:\s*(?::|<[^>]{0,200}>))*\s*(" + "|".join(MONTHS) + r")\s+(\d{1,2}),\s*(20\d{2})", page or "", re.I)
    if not m:
        return None
    month = next(i for i, x in enumerate(MONTHS, 1) if x.lower() == m.group(1).lower())
    return f"{m.group(3)}-{month:02d}-{int(m.group(2)):02d}"


def by_quarter(d):
    """A stored or parsed table → {quarter: {id: mb/d}}, complete quarters only."""
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
    """The new table over the kept history: new quarters added, revised ones replaced; KEEP_Q newest kept.
    Returns (merged table, how many quarters are new or changed)."""
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
    """Once a day: reads the EIA table and updates docs/chokepoints.json.
    Returns how many new or revised quarters there were (0: nothing new, or checked recently)."""
    now = now or datetime.now(timezone.utc)
    old = load(path)
    last_try = max(old.get("checked") or "", old.get("tried") or "")
    if last_try > (now - timedelta(hours=every_h)).isoformat():
        return 0
    try:
        new = parse(fetcher(URL), now)
    except Exception as e:
        # keep what we have, note the failure (shown nowhere but the file and the log) and wait a day before retrying
        save(path, {**old, "tried": now.isoformat(), "error": f"{type(e).__name__}: {e}"[:200]})
        raise
    merged, changed = merge(old, new)
    # the release date goes with the figures: new figures without a readable date get none rather than the old date
    released = new.get("released") or (None if changed else old.get("released"))
    out = {"updated": now.isoformat() if changed or not old.get("updated") else old["updated"], "checked": now.isoformat(),
           "src": URL, "released": released, "unit": "million barrels a day", **merged}
    save(path, out)
    return changed


if __name__ == "__main__":
    print("chokepoint quarters new or revised:", build(every_h=0))
