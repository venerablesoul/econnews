"""
Tankers at the world's oil chokepoints, from aisstream.io (a free live AIS feed) — the map's SHIP tab, "Tankers" layer.

Works only with a free key: register at aisstream.io, create an API key and add it as the repository secret
AISSTREAM_API_KEY. Without the key this does nothing. Every 30 minutes the bot listens to the feed for ~60 seconds
inside boxes around the chokepoints (Hormuz, Bab el-Mandeb, Suez, Malacca, the Turkish and Danish straits,
Gibraltar, Panama, the Cape of Good Hope) and writes docs/ships.json: the last position of every tanker seen
in the last 12 hours and a count per chokepoint. aisstream.io relies on receivers on land: ships far from the coast,
or where there are few receivers, may be missing — the count is "seen", not "all".

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
URL = "wss://stream.aisstream.io/v0/stream"
EVERY_MIN = 30
LISTEN_S = 60
KEEP_H = 12
MAX_SHIPS = 2000
MAX_FRAME = 1 << 20   # a bigger frame is not AIS — the connection is dropped
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
    return {"APIKey": api_key, "BoundingBoxes": [[[a[3][0], a[3][1]], [a[3][2], a[3][3]]] for a in AREAS],
            "FilterMessageTypes": ["PositionReport", "ShipStaticData"]}


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
        head, self.buf = head.split(b"\r\n\r\n", 1)
        lines = head.decode("latin-1").split("\r\n")
        if not lines[0].split(" ")[1:2] == ["101"]:
            raise ConnectionError("not upgraded: " + lines[0][:60])
        want = base64.b64encode(hashlib.sha1((nonce + GUID).encode()).digest()).decode()
        got = {k.strip().lower(): v.strip() for k, v in (x.split(":", 1) for x in lines[1:] if ":" in x)}
        if got.get("sec-websocket-accept") != want:
            raise ConnectionError("bad handshake answer")

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
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


def merge(old, new, now):
    """Keeps what was known (a ship's type comes in a rare static message) and positions of the last KEEP_H hours."""
    cut = (now - timedelta(hours=KEEP_H)).isoformat()
    by = {str(s.get("mmsi")): dict(s) for s in old.get("ships") or [] if isinstance(s, dict) and s.get("mmsi")}
    for k, v in (old.get("types") or {}).items():
        by.setdefault(k, {"mmsi": int(k)}).setdefault("type", v)
    for k, v in new.items():
        rec = by.setdefault(k, {"mmsi": v["mmsi"]})
        rec.update({x: y for x, y in v.items() if y is not None})
    types = {k: v["type"] for k, v in by.items() if isinstance(v.get("type"), int)}
    tankers = [v for v in by.values() if 80 <= v.get("type", -1) <= 89 and v.get("lat") is not None and v.get("t", "") >= cut]
    tankers.sort(key=lambda v: v.get("t", ""), reverse=True)
    counts = {}
    for v in by.values():
        if v.get("t", "") >= cut and v.get("area"):
            c = counts.setdefault(v["area"], {"ships": 0, "tankers": 0})
            c["ships"] += 1
            c["tankers"] += 1 if 80 <= v.get("type", -1) <= 89 else 0
    # the type cache: what we know about ships seen in the last week is enough
    recent_cut = (now - timedelta(days=7)).isoformat()
    keep_types = {k: t for k, t in types.items() if by[k].get("t", recent_cut) >= recent_cut}
    return {"updated": now.isoformat(), "src": "aisstream.io", "hours": KEEP_H,
            "areas": [{"id": a[0], "name": a[1], "name_ru": a[2], "box": list(a[3]), **counts.get(a[0], {"ships": 0, "tankers": 0})} for a in AREAS],
            "ships": tankers[:MAX_SHIPS], "types": dict(list(keep_types.items())[-20000:])}


def build(now=None, path=OUT, listen_fn=listen, every_min=EVERY_MIN):
    """Every 30 minutes, with the key: listens and updates docs/ships.json. Returns how many messages were read."""
    k = key()
    if not k:
        return 0
    now = now or datetime.now(timezone.utc)
    old = {}
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {}
    if old.get("updated", "") > (now - timedelta(minutes=every_min - 1)).isoformat():
        return 0
    try:
        ships, n = listen_fn(k, now=now)
    except Exception as e:   # whatever the feed answered, the key never goes into a log
        raise RuntimeError(f"{type(e).__name__}: {e}".replace(k, "***")) from None
    out = merge(old, ships, now)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)
    return n


if __name__ == "__main__":
    print("AIS messages read:", build())
