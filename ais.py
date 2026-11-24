"""
Ships from aisstream.io (a free live AIS feed) — the map's SHIP tab: "Tankers in the straits" and "Ships worldwide".

Works only with a free key: register at aisstream.io, create an API key and add it as the repository secret
AISSTREAM_API_KEY. Without the key this does nothing. Every 30 minutes the bot listens to the whole world's feed for
~60 seconds and writes:
  docs/ships.json        tankers at the chokepoints (Hormuz, Bab el-Mandeb, Suez, Malacca, the Turkish and Danish
                         straits, Gibraltar, Panama, the Cape of Good Hope): the last 12 hours, a count per chokepoint;
  docs/ships_world.json  tankers and cargo ships anywhere, seen in the last 6 hours, each with its track — where it
                         was at the earlier listenings (every 30 minutes), so the map shows where ships are heading;
  docs/ais_kinds.json    which ships are cargo ships (a ship says its type only every ~6 minutes; the map needs it at
                         once), the last week. The bot's memory — the map does not load it.
aisstream.io relies on receivers on land: ships far from the coast, or where there are few receivers, may be missing —
the count is "seen", not "all".

aisstream.io does not allow browsers (the key would be public), so the bot reads it. The key travels only inside the
encrypted connection and is never printed or written anywhere. Standard library only (a small WebSocket client).
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import socket
import ssl
import struct
import time
import urllib.parse
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "docs", "ships.json")
OUT_WORLD = os.path.join(HERE, "docs", "ships_world.json")
OUT_KINDS = os.path.join(HERE, "docs", "ais_kinds.json")
URL = "wss://stream.aisstream.io/v0/stream"
EVERY_MIN = 30
LISTEN_S = 60
KEEP_H = 12
MAX_SHIPS = 2000
TYPE_DAYS = 7             # tankers are remembered for a week after they were last seen
MAX_TANKER_IDS = 8000
MAX_FRAME = 1 << 20   # a bigger frame is not AIS — the connection is dropped
WORLD_H = 6               # the world layer: ships seen in the last 6 hours
MAX_WORLD = 4000          # ... at most (the most recently seen): the file stays ~400 KB, ~120 KB as the site sends it
TRACK_PTS = 6             # earlier positions kept per ship (one per listening, every 30 minutes: ~3 hours)
TRACK_MIN_DEG = 0.01      # a ship that moved less (~1 km) adds no track point
MAX_CARGO_IDS = 30000
WORLD_BOX = [[[-90.0, -180.0], [90.0, 180.0]]]
# [south, west, north, east]; aisstream wants [[lat, lon], [lat, lon]]
AREAS = (
    ("hormuz", "Strait of Hormuz", "Ормузский пролив", (24.8, 54.5, 27.6, 58.2)),
    ("bab", "Bab el-Mandeb", "Баб-эль-Мандеб", (11.4, 42.0, 14.6, 44.6)),
    ("suez", "Suez Canal", "Суэцкий канал", (27.6, 32.0, 31.6, 34.0)),
    ("malacca", "Strait of Malacca", "Малаккский пролив", (0.8, 98.0, 6.5, 104.8)),
    ("turkish", "Turkish straits", "Турецкие проливы", (39.9, 25.9, 41.5, 29.6)),
    ("danish", "Danish straits", "Датские проливы", (54.4, 9.8, 57.9, 13.2)),
    ("gibraltar", "Strait of Gibraltar", "Гибралтарский пролив", (35.6, -6.6, 36.4, -4.8)),
    ("panama", "Panama Canal", "Панамский канал", (8.5, -80.4, 9.6, -79.3)),
    ("cape", "Cape of Good Hope", "Мыс Доброй Надежды", (-36.5, 17.0, -33.0, 21.0)),
)
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def key():
    return os.environ.get("AISSTREAM_API_KEY", "").strip()


def area_of(lat, lon):
    for a in AREAS:
        s, w, n, e = a[3]
        if s <= lat <= n and w <= lon <= e:
            return a[0]
    return None


def subscription(api_key):
    # the whole world: the chokepoints are inside it, and the world layer needs everything
    return {"APIKey": api_key, "BoundingBoxes": WORLD_BOX, "FilterMessageTypes": ["PositionReport", "ShipStaticData"]}


# ---------------------------------------------------------------------------
# a minimal WebSocket client (RFC 6455): text/binary frames, fragments, ping → pong, close
# ---------------------------------------------------------------------------
class WS:
    def __init__(self, url, timeout=20):
        u = urllib.parse.urlparse(url)
        port = u.port or (443 if u.scheme == "wss" else 80)
        raw = socket.create_connection((u.hostname, port), timeout=timeout)
        self.sock = ssl.create_default_context().wrap_socket(raw, server_hostname=u.hostname) if u.scheme == "wss" else raw
        nonce = base64.b64encode(os.urandom(16)).decode()
        path = (u.path or "/") + (("?" + u.query) if u.query else "")
        self.sock.sendall((f"GET {path} HTTP/1.1\r\nHost: {u.hostname}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {nonce}\r\nSec-WebSocket-Version: 13\r\nUser-Agent: econnews-bot\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("closed during the handshake")
            head += chunk
            if len(head) > 16384:
                raise ConnectionError("handshake too long")
        head, rest = head.split(b"\r\n\r\n", 1)
        self.buf, self.pos = bytearray(rest), 0
        lines = head.decode("latin-1").split("\r\n")
        if not lines[0].split(" ")[1:2] == ["101"]:
            raise ConnectionError("not upgraded: " + lines[0][:60])
        want = base64.b64encode(hashlib.sha1((nonce + GUID).encode()).digest()).decode()
        got = {k.strip().lower(): v.strip() for k, v in (x.split(":", 1) for x in lines[1:] if ":" in x)}
        if got.get("sec-websocket-accept") != want:
            raise ConnectionError("bad handshake answer")

    def _read(self, n):
        while len(self.buf) - self.pos < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("closed")
            if self.pos > 1 << 20:   # what was read already is dropped now and then, not after every message
                del self.buf[:self.pos]
                self.pos = 0
            self.buf += chunk
        out = bytes(self.buf[self.pos:self.pos + n])
        self.pos += n
        return out

    def send(self, data, opcode=1):
        if isinstance(data, str):
            data = data.encode("utf-8")
        mask = os.urandom(4)
        n = len(data)
        head = bytes([0x80 | opcode])
        if n < 126:
            head += bytes([0x80 | n])
        elif n < 65536:
            head += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            head += bytes([0x80 | 127]) + struct.pack(">Q", n)
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self):
        """The next whole message (bytes), or None when the server closed."""
        parts, kind = [], None
        while True:
            b1, b2 = self._read(2)
            fin, op, masked, n = b1 & 0x80, b1 & 0x0F, b2 & 0x80, b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            if n > MAX_FRAME:
                raise ConnectionError("frame too big")
            mk = self._read(4) if masked else None
            data = self._read(n)
            if mk:
                data = bytes(b ^ mk[i % 4] for i, b in enumerate(data))
            if op == 8:
                return None
            if op == 9:
                self.send(data, opcode=10)
                continue
            if op == 10:
                continue
            if op in (1, 2):
                kind, parts = op, [data]
            elif op == 0 and kind:
                parts.append(data)
            if fin and kind:
                msg = b"".join(parts)
                if len(msg) > MAX_FRAME:
                    raise ConnectionError("message too big")
                return msg

    def close(self):
        try:
            self.send(b"", opcode=8)
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass


# ---------------------------------------------------------------------------
# the messages
# ---------------------------------------------------------------------------
def num(x):
    return x if isinstance(x, (int, float)) and not isinstance(x, bool) and x == x else None


def clean_text(s, n=40):
    s = "".join(ch for ch in str(s or "") if ch.isprintable()).replace("@", " ").strip()
    return " ".join(s.split())[:n]


def read_message(m, ships, now):
    """Updates ships (mmsi → record) from one aisstream message (dict). Returns the mmsi or None."""
    if not isinstance(m, dict):
        return None
    meta = m.get("MetaData") or {}
    mmsi = meta.get("MMSI")
    if not isinstance(mmsi, int) or not 100000000 <= mmsi <= 999999999:
        return None
    body = (m.get("Message") or {}).get(m.get("MessageType") or "") or {}
    rec = ships.setdefault(str(mmsi), {"mmsi": mmsi})
    name = clean_text(meta.get("ShipName"))
    if name:
        rec["name"] = name
    if m.get("MessageType") == "ShipStaticData":
        t = num(body.get("Type"))
        if t is not None and 0 <= t < 100:
            rec["type"] = int(t)
        dest = clean_text(body.get("Destination"), 30)
        if dest:
            rec["dest"] = dest
        dr = num(body.get("MaximumStaticDraught"))
        if dr is not None and 0 < dr < 30:
            rec["draught"] = round(dr, 1)
    elif m.get("MessageType") == "PositionReport":
        lat, lon = num(body.get("Latitude")), num(body.get("Longitude"))
        if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
            return None
        rec.update({"lat": round(lat, 4), "lon": round(lon, 4), "t": now.isoformat(timespec="seconds"), "area": area_of(lat, lon)})
        sog, cog = num(body.get("Sog")), num(body.get("Cog"))
        rec["sog"] = round(sog, 1) if sog is not None and sog < 102.3 else None
        rec["cog"] = round(cog) if cog is not None and cog < 360 else None
        nav = num(body.get("NavigationalStatus"))
        rec["nav"] = int(nav) if nav is not None and 0 <= nav <= 15 else None
    return mmsi


def listen(api_key, seconds=LISTEN_S, url=URL, connect=WS, now=None):
    """Messages for `seconds`. Returns (ships dict, how many messages)."""
    now = now or datetime.now(timezone.utc)
    ships, n = {}, 0
    ws = connect(url)
    try:
        ws.send(json.dumps(subscription(api_key)))   # must arrive within 3 s of connecting
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            # wait at most until the end: a timeout in the middle of a frame would leave the stream out of step,
            # so a timeout simply ends the listening
            ws.sock.settimeout(max(0.5, end - time.monotonic()))
            try:
                raw = ws.recv()
            except (socket.timeout, TimeoutError):
                break
            if raw is None:
                break
            try:
                m = json.loads(raw)
            except ValueError:
                continue
            if isinstance(m, dict) and m.get("error"):
                raise RuntimeError("aisstream: " + clean_text(m.get("error"), 120))
            if read_message(m, ships, now):
                n += 1
    finally:
        ws.close()
    return ships, n


def is_tanker(t):
    return isinstance(t, int) and not isinstance(t, bool) and 80 <= t <= 89


def is_cargo(t):
    return isinstance(t, int) and not isinstance(t, bool) and 70 <= t <= 79


def minute(iso):
    """Minutes since 1970 (UTC) of an ISO time — the track points' compact clock."""
    try:
        return int(datetime.fromisoformat(iso).timestamp() // 60)
    except (TypeError, ValueError):
        return None


def moved(a_lat, a_lon, b_lat, b_lon):
    dl = abs(a_lon - b_lon) % 360
    return abs(a_lat - b_lat) >= TRACK_MIN_DEG or min(dl, 360 - dl) >= TRACK_MIN_DEG


def add_track(rec, lat, lon, t_iso, since_min):
    """Before a ship gets its new position: the old one goes to its track (if it is older and ~1 km away).
    A track point is [lat, lon, minute]; only the last TRACK_PTS, none older than since_min."""
    if rec.get("lat") is None or rec.get("lon") is None or not rec.get("t") or rec["t"] >= t_iso:
        return
    if not moved(rec["lat"], rec["lon"], lat, lon):
        return
    m = minute(rec["t"])
    trk = [p for p in rec.get("trk") or [] if isinstance(p, list) and len(p) == 3 and isinstance(p[2], int) and p[2] >= since_min]
    if m is not None and m >= since_min:
        trk.append([round(rec["lat"], 3), round(rec["lon"], 3), m])
    rec["trk"] = trk[-TRACK_PTS:]


def fresh_track(rec, since_min):
    trk = [p for p in rec.get("trk") or [] if isinstance(p, list) and len(p) == 3 and isinstance(p[2], int) and p[2] >= since_min]
    if trk:
        rec["trk"] = trk[-TRACK_PTS:]
    else:
        rec.pop("trk", None)
    return rec


def merge(old, new, now):
    """Positions of the last KEEP_H hours, and which ships are tankers. A ship's type comes only in its static message
    (every few minutes), so the tankers seen in the last week are remembered: {"tk": {day last seen: [mmsi, ...]}}.
    Only tankers and only one week — the file stays small (the map loads it)."""
    cut = (now - timedelta(hours=KEEP_H)).isoformat()
    today = now.astimezone(timezone.utc).date().isoformat()
    week = (now - timedelta(days=TYPE_DAYS)).astimezone(timezone.utc).date().isoformat()
    known = {}   # mmsi → the day it was last seen as a tanker
    tk = old.get("tk") if isinstance(old.get("tk"), dict) else {}
    for day, ids in tk.items():
        if isinstance(day, str) and day >= week and isinstance(ids, list):
            for m in ids:
                if isinstance(m, int) and day > known.get(str(m), ""):
                    known[str(m)] = day
    by = {str(s["mmsi"]): dict(s) for s in old.get("ships") or [] if isinstance(s, dict) and isinstance(s.get("mmsi"), int)}
    since_min = minute(cut) or 0
    for k, v in new.items():
        rec = by.setdefault(k, {"mmsi": v["mmsi"]})
        if v.get("lat") is not None and v.get("t"):
            add_track(rec, v["lat"], v["lon"], v["t"], since_min)
        rec.update({x: y for x, y in v.items() if y is not None})

    def tanker(k, v):
        t = v.get("type")
        return is_tanker(t) if isinstance(t, int) else k in known

    # the chokepoint layer: tankers inside a chokepoint's box (the feed is the whole world now; the rest are in the world layer)
    tankers = [fresh_track(v, since_min) for k, v in by.items() if tanker(k, v) and v.get("lat") is not None and v.get("t", "") >= cut
               and v.get("area")]
    tankers.sort(key=lambda v: v.get("t", ""), reverse=True)
    counts = {}
    for v in tankers:
        if v.get("area"):
            counts[v["area"]] = counts.get(v["area"], 0) + 1
    seen = {}   # every ship in the boxes during this listening
    for v in new.values():
        if v.get("area") and v.get("t"):
            seen[v["area"]] = seen.get(v["area"], 0) + 1
    last = {}
    for k, v in by.items():
        if tanker(k, v):
            day = max(known.get(k, ""), (v.get("t") or "")[:10], today if k in new else "")
            if day >= week:
                last[k] = day
    for k, day in known.items():   # tankers not met this time are remembered until their week is over
        if not isinstance(by.get(k, {}).get("type"), int):   # ... unless a new static message gave another type
            last.setdefault(k, day)
    keep = sorted(last.items(), key=lambda x: x[1])[-MAX_TANKER_IDS:]
    tk_out = {}
    for k, day in keep:
        tk_out.setdefault(day, []).append(int(k))
    return {"updated": now.isoformat(), "src": "aisstream.io", "hours": KEEP_H,
            "areas": [{"id": a[0], "name": a[1], "name_ru": a[2], "box": list(a[3]), "tankers": counts.get(a[0], 0),
                       "seen_now": seen.get(a[0], 0)} for a in AREAS],
            "ships": tankers[:MAX_SHIPS], "tk": {d: sorted(v) for d, v in sorted(tk_out.items())}}


# the world layer: compact rows, one per ship. "track": flat [lat, lon, minutes before "minute", ...], oldest first,
# to 0.01° (~1 km: where a ship was half an hour ago needs no more)
WORLD_COLS = ["mmsi", "name", "kind", "lat", "lon", "sog", "cog", "nav", "minute", "dest", "draught", "track"]


def world_rows(d):
    """ships_world.json → {mmsi: record}."""
    by = {}
    for r in d.get("s") or []:
        if not isinstance(r, list) or len(r) < len(WORLD_COLS) or not isinstance(r[0], int):
            continue
        rec = dict(zip(WORLD_COLS, r))
        flat, m = rec.pop("track") or [], rec.pop("minute")
        if not isinstance(m, int):
            continue
        rec["trk"] = [[flat[i], flat[i + 1], m - flat[i + 2]] for i in range(0, len(flat) - 2, 3) if isinstance(flat[i + 2], int)]
        rec["t"] = datetime.fromtimestamp(m * 60, timezone.utc).isoformat(timespec="seconds")
        by[str(rec["mmsi"])] = rec
    return by


def merge_world(oldw, kinds, tankers, new, now):
    """Tankers and cargo ships anywhere, seen in the last WORLD_H hours, with their tracks; and the memory of which
    ships are cargo ships (a week). tankers: the mmsi (str) known to be tankers (from ships.json's memory)."""
    today = now.astimezone(timezone.utc).date().isoformat()
    week = (now - timedelta(days=TYPE_DAYS)).astimezone(timezone.utc).date().isoformat()
    cargo = {}
    for day, ids in (kinds.get("c") or {}).items():
        if isinstance(day, str) and day >= week and isinstance(ids, list):
            for m in ids:
                if isinstance(m, int) and day > cargo.get(str(m), ""):
                    cargo[str(m)] = day
    by = world_rows(oldw)
    cut = (now - timedelta(hours=WORLD_H)).isoformat()
    since_min = minute(cut) or 0
    for k, v in new.items():
        t = v.get("type")
        if is_cargo(t):
            cargo[k] = today
        elif isinstance(t, int):
            cargo.pop(k, None)
        kind = ("t" if is_tanker(t) or (t is None and k in tankers) else "c" if is_cargo(t) or (t is None and k in cargo)
                else (by.get(k) or {}).get("kind") if t is None else None)
        if kind is None:
            by.pop(k, None)   # not a tanker or cargo ship (or not known yet)
            continue
        rec = by.setdefault(k, {"mmsi": v["mmsi"]})
        rec["kind"] = kind
        if v.get("lat") is not None and v.get("t"):
            add_track(rec, v["lat"], v["lon"], v["t"], since_min)
        rec.update({x: y for x, y in v.items() if y is not None and x in ("name", "lat", "lon", "sog", "cog", "nav", "t", "dest", "draught")})
    keep = [fresh_track(r, since_min) for r in by.values() if r.get("lat") is not None and (r.get("t") or "") >= cut]
    keep.sort(key=lambda r: r.get("t") or "", reverse=True)
    keep = keep[:MAX_WORLD]
    rows = []
    for r in keep:
        m = minute(r["t"])
        flat = [x for p in r.get("trk") or [] for x in (round(p[0], 2), round(p[1], 2), m - p[2])]
        rows.append([r["mmsi"], r.get("name") or "", r["kind"], r["lat"], r["lon"], r.get("sog"), r.get("cog"), r.get("nav"),
                     m, r.get("dest") or "", r.get("draught"), flat])
    ids = sorted(cargo.items(), key=lambda x: x[1])[-MAX_CARGO_IDS:]
    c_out = {}
    for k, day in ids:
        c_out.setdefault(day, []).append(int(k))
    counts = {"t": sum(1 for r in keep if r["kind"] == "t"), "c": sum(1 for r in keep if r["kind"] == "c")}
    return ({"updated": now.isoformat(), "src": "aisstream.io", "hours": WORLD_H, "every_min": EVERY_MIN, "counts": counts,
             "cols": WORLD_COLS, "s": rows},
            {"updated": now.isoformat(), "c": {d: sorted(v) for d, v in sorted(c_out.items())}})


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


def build(now=None, path=OUT, listen_fn=listen, every_min=EVERY_MIN):
    """Every 30 minutes, with the key: listens and updates docs/ships.json. Returns how many messages were read."""
    k = key()
    if not k:
        return 0
    now = now or datetime.now(timezone.utc)
    old = load(path)
    if old.get("updated", "") > (now - timedelta(minutes=every_min - 1)).isoformat():
        return 0
    try:
        ships, n = listen_fn(k, now=now)
    except Exception as e:   # whatever the feed answered, the key never goes into a log
        raise RuntimeError(f"{type(e).__name__}: {e}".replace(k, "***")) from None
    out = merge(old, ships, now)
    save(path, out)
    # the world layer and the cargo memory sit next to ships.json
    here = os.path.dirname(path)
    wpath, kpath = os.path.join(here, os.path.basename(OUT_WORLD)), os.path.join(here, os.path.basename(OUT_KINDS))
    tankers = {str(m) for ids in out["tk"].values() for m in ids}
    world, kinds = merge_world(load(wpath), load(kpath), tankers, ships, now)
    save(wpath, world)
    save(kpath, kinds)
    return n


if __name__ == "__main__":
    print("AIS messages read:", build())
