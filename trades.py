"""
Сделки политиков и инсайдеров США — для бота и терминала.

Все источники официальные, бесплатные и без ключей:

  Палата представителей — отчёты о сделках (Periodic Transaction Report)
      disclosures-clerk.house.gov: индекс отчётов за год (ZIP) + PDF каждого отчёта.
      Для чтения PDF нужен пакет pdfplumber (pip install pdfplumber).
      Без него Палата пропускается, остальное работает.
  Сенат — электронные отчёты о сделках на efdsearch.senate.gov (HTML-таблицы).
  Инсайдеры — покупки и продажи акций директорами и топ-менеджерами компаний
      на открытом рынке: форма 4 в SEC EDGAR (раскрывается за 2 рабочих дня).

Политики раскрывают сделки с опозданием до 45 дней, поэтому у каждой сделки
две даты: когда совершена и когда раскрыта.

Состояние хранится в state.json в разделе "trades".
"""
from __future__ import annotations

import hashlib
import html
import http.cookiejar
import io
import json
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

HOUSE_INDEX = "https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{year}FD.ZIP"
HOUSE_PDF = "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/{year}/{doc}.pdf"
SENATE_ROOT = "https://efdsearch.senate.gov"
SEC_FEED = ("https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&company=&dateb="
            "&owner=include&start=0&count=100&output=atom")
SEC_TXT = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc_nd}/{acc}.txt"

WINDOW_DAYS = 14          # какие отчёты политиков смотрим (по дате подачи)
KEEP_DAYS = 45            # сколько дней хранить сделки для терминала
KEEP_MAX = 250            # и не больше стольких записей каждого вида
DOCS_PER_CHECK = 25       # не больше стольких новых отчётов политиков за одну проверку
SEC_PER_RUN = 40          # не больше стольких форм 4 за один запуск

TYPE_RU = {"buy": "покупка", "sell": "продажа", "sell_part": "частичная продажа", "exchange": "обмен"}
OWNER_RU = {"SP": "супруг(а)", "JT": "совместно", "DC": "ребёнок",
            "Spouse": "супруг(а)", "Joint": "совместно", "Child": "ребёнок", "Dependent Child": "ребёнок"}


def _env_int(name, default):
    try:
        return int(float(os.environ.get(name, default)))
    except ValueError:
        return int(default)


def _get(url, headers=None, timeout=30, opener=None, data=None):
    h = {"User-Agent": UA, "Accept": "*/*"}
    h.update(headers or {})
    req = urllib.request.Request(url, headers=h, data=data)
    op = opener.open if opener else urllib.request.urlopen
    with op(req, timeout=timeout) as r:
        return r.read()


def _sec_headers():
    # SEC требует, чтобы в User-Agent было указано, кто обращается, и контактный адрес
    ua = os.environ.get("SEC_USER_AGENT", "").strip() or "EconNewsBot news-bot@users.noreply.github.com"
    return {"User-Agent": ua, "Accept-Encoding": "identity"}


def _id(*parts):
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:16]


def _date(s, fmt="%m/%d/%Y"):
    """'09/24/2026' -> '2026-09-24' ('' если не разобрать)."""
    s = (s or "").strip()
    for f in (fmt, "%Y-%m-%d", "%m/%d/%y"):
        try:
            return datetime.strptime(s, f).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return ""


def parse_amount(s):
    """'$1,001 - $15,000' -> (1001, 15000); 'Over $50,000,000' -> (50000001, None)."""
    nums = [int(x.replace(",", "")) for x in re.findall(r"\$\s*([\d,]+)", s or "") if x.replace(",", "")]
    if not nums:
        return None, None
    if re.search(r"over|more than|>", s, re.I):
        return nums[0] + 1, None
    return nums[0], (nums[1] if len(nums) > 1 else nums[0])


def _ttype(s):
    s = (s or "").strip().lower()
    if s.startswith(("p", "purchase", "buy")):
        return "buy"
    if "partial" in s:
        return "sell_part"
    if s.startswith(("s", "sale", "sell")):
        return "sell"
    if s.startswith("e"):
        return "exchange"
    return ""


# ---------------------------------------------------------------------------
# Палата представителей
# ---------------------------------------------------------------------------
def house_index(now):
    """Отчёты о сделках (тип P) за последние WINDOW_DAYS дней из годового индекса."""
    years = {now.year} | ({now.year - 1} if now.month == 1 else set())
    since = (now - timedelta(days=WINDOW_DAYS)).strftime("%Y-%m-%d")
    out = []
    for year in sorted(years):
        zf = zipfile.ZipFile(io.BytesIO(_get(HOUSE_INDEX.format(year=year), timeout=60)))
        name = next(n for n in zf.namelist() if n.lower().endswith(".txt"))
        lines = zf.read(name).decode("utf-8", "replace").splitlines()
        head = [h.strip() for h in lines[0].split("\t")]
        for line in lines[1:]:
            row = dict(zip(head, [c.strip() for c in line.split("\t")]))
            if row.get("FilingType") != "P":
                continue
            filed = _date(row.get("FilingDate", ""))
            if not filed or filed < since:
                continue
            doc = row.get("DocID", "")
            name_ = " ".join(x for x in (row.get("First"), row.get("Last"), row.get("Suffix")) if x)
            dist = row.get("StateDst", "")
            out.append({"doc": doc, "year": str(year), "filed": filed, "name": name_,
                        "district": f"{dist[:2]}-{dist[2:]}" if len(dist) > 2 else dist})
    return out


ASSET_RX = re.compile(r"\(([A-Z][A-Z0-9.\-]{0,7})\)\s*\[([A-Z]{2})\]")
MONEY_RX = re.compile(r"\$\s*[\d,]{3,}")
TYPE_CELL = re.compile(r"^(P|S|S \(partial\)|E)$", re.I)
DATE_CELL = re.compile(r"^\d{1,2}/\d{1,2}/\d{4}$")


def house_rows_to_trades(rows, meta):
    """Строки таблицы из PDF-отчёта -> сделки. Колонки ищем по содержимому,
    а не по номеру: ID/владелец, актив «Название (ТИКЕР) [ST]», тип P/S/E,
    дата сделки, дата уведомления, сумма «$1,001 - $15,000»."""
    out = []
    for row in rows:
        cells = [re.sub(r"\s+", " ", (c or "")).strip() for c in row]
        ttype = next((c for c in cells if TYPE_CELL.match(c)), "")
        dates = [c for c in cells if DATE_CELL.match(c)]
        asset = next((c for c in cells if ASSET_RX.search(c)), "")
        amount = next((c for c in cells if MONEY_RX.search(c) and c != asset), "")
        if not (ttype and dates and amount and asset):
            continue
        m = ASSET_RX.search(asset)
        ticker, kind = m.group(1), m.group(2)
        if kind not in ("ST", "OP"):          # акции и опционы на акции; облигации и фонды пропускаем
            continue
        owner = next((c for c in cells if c in ("SP", "JT", "DC")), "")
        amin, amax = parse_amount(amount)
        name = asset[:m.start()].strip(" -") or ticker
        out.append({
            "src": "house", "who": meta["name"], "where": f"Палата, {meta['district']}".strip(", "),
            "owner": owner, "ticker": ticker, "asset": name[:80] + (" (опцион)" if kind == "OP" else ""),
            "type": _ttype(ttype), "amin": amin, "amax": amax,
            "date": _date(dates[0]), "disclosed": meta["filed"],
            "link": HOUSE_PDF.format(year=meta["year"], doc=meta["doc"]),
        })
    return out


# запасной разбор по строкам текста, если в PDF не нашлось таблицы
LINE_RX = re.compile(r"^(?:(SP|JT|DC)\s+)?(.+?)\s+(P|S|S \(partial\)|E)\s+(\d{1,2}/\d{1,2}/\d{4})\s+"
                     r"(\d{1,2}/\d{1,2}/\d{4})\s+(\$[\d,]+(?:\s*-\s*(?:\$[\d,]+)?)?|Over \$[\d,]+)")


def house_text_to_trades(text, meta):
    lines = [l.strip() for l in (text or "").splitlines()]
    rows = []
    for i, line in enumerate(lines):
        m = LINE_RX.match(line)
        if not m:
            continue
        owner, asset, tt, d1, d2, amount = m.groups()
        # продолжение строки (перенос названия, тикера или суммы) — следующая строка, если это не новая сделка
        tail = lines[i + 1] if i + 1 < len(lines) and not LINE_RX.match(lines[i + 1]) else ""
        if amount.rstrip().endswith("-"):
            nxt = re.search(r"\$[\d,]+", tail)
            amount += " " + (nxt.group(0) if nxt else "")
        t = ASSET_RX.search(asset + " " + re.sub(r"\$[\d,]+", "", tail))
        if not t:
            continue
        rows.append([owner or "", asset if ASSET_RX.search(asset) else f"{asset} {t.group(0)}", tt, d1, d2, amount])
    return house_rows_to_trades(rows, meta)


def house_report(meta):
    import pdfplumber  # noqa: импорт здесь: без пакета пропускаем только Палату
    raw = _get(HOUSE_PDF.format(year=meta["year"], doc=meta["doc"]), timeout=60)
    rows, text = [], []
    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        for page in pdf.pages:
            for t in page.extract_tables() or []:
                rows.extend(t)
            text.append(page.extract_text() or "")
    trades = house_rows_to_trades(rows, meta)
    return trades or house_text_to_trades("\n".join(text), meta)


# ---------------------------------------------------------------------------
# Сенат
# ---------------------------------------------------------------------------
class _Tables(HTMLParser):
    """Собирает текст ячеек <td> из первого <tbody>."""
    def __init__(self):
        super().__init__()
        self.rows, self._row, self._cell, self._in_body, self._done = [], None, None, False, False

    def handle_starttag(self, tag, attrs):
        if self._done:
            return
        if tag == "tbody":
            self._in_body = True
        elif self._in_body and tag == "tr":
            self._row = []
        elif self._in_body and tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag):
        if self._done:
            return
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append(re.sub(r"\s+", " ", "".join(self._cell)).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None
        elif tag == "tbody" and self._in_body:
            self._in_body, self._done = False, True

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def senate_rows_to_trades(rows, meta):
    """Колонки отчёта Сената: #, дата сделки, владелец, тикер, актив, тип актива, тип сделки, сумма, комментарий."""
    out = []
    for c in rows:
        if len(c) < 8:
            continue
        ticker = c[3].strip().upper()
        if not ticker or ticker in ("--", "N/A"):
            continue
        if c[5] and not re.search(r"stock|option", c[5], re.I):
            continue
        amin, amax = parse_amount(c[7])
        out.append({
            "src": "senate", "who": meta["name"], "where": "Сенат",
            "owner": c[2], "ticker": ticker, "asset": c[4][:80] + (" (опцион)" if "option" in c[5].lower() else ""),
            "type": _ttype(c[6]), "amin": amin, "amax": amax,
            "date": _date(c[1]), "disclosed": meta["filed"], "link": meta["link"],
        })
    return out


class Senate:
    """Сайт Сената требует один раз согласиться с условиями (форма с CSRF-токеном),
    после этого в той же сессии доступен поиск отчётов."""
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.token = ""

    def _cookie(self, name):
        return next((c.value for c in self.jar if c.name == name), "")

    def login(self):
        home = SENATE_ROOT + "/search/home/"
        page = _get(home, opener=self.op).decode("utf-8", "replace")
        m = (re.search(r'name=["\']csrfmiddlewaretoken["\'][^>]*?value=["\']([^"\']+)', page)
             or re.search(r'value=["\']([^"\']+)["\'][^>]*?name=["\']csrfmiddlewaretoken', page))
        if not m:
            raise RuntimeError("Сенат: не найдена форма согласия")
        body = urllib.parse.urlencode({"csrfmiddlewaretoken": m.group(1), "prohibition_agreement": "1"}).encode()
        _get(home, headers={"Referer": home}, opener=self.op, data=body)
        self.token = self._cookie("csrftoken") or self._cookie("csrf")

    def reports(self, now):
        since = (now - timedelta(days=WINDOW_DAYS)).strftime("%m/%d/%Y 00:00:00")
        body = urllib.parse.urlencode({
            "start": "0", "length": "100", "report_types": "[11]", "filer_types": "[]",
            "submitted_start_date": since, "submitted_end_date": "", "candidate_state": "",
            "senator_state": "", "office_id": "", "first_name": "", "last_name": "",
            "csrfmiddlewaretoken": self.token}).encode()
        raw = _get(SENATE_ROOT + "/search/report/data/", opener=self.op, data=body,
                   headers={"Referer": SENATE_ROOT + "/search/", "X-CSRFToken": self.token,
                            "X-Requested-With": "XMLHttpRequest"})
        out = []
        for row in json.loads(raw).get("data", []):
            first, last, link_html, filed = row[0], row[1], row[3], row[4]
            m = re.search(r'href="([^"]+)"', link_html)
            if not m or "/ptr/" not in m.group(1):   # бумажные отчёты (сканы) пропускаем
                continue
            name = " ".join(x.strip().title() for x in (first, last) if x and x.strip())
            out.append({"doc": m.group(1).rstrip("/").rsplit("/", 1)[-1], "name": name,
                        "filed": _date(filed), "link": SENATE_ROOT + m.group(1)})
        return out

    def report(self, meta):
        page = _get(meta["link"], opener=self.op, headers={"Referer": SENATE_ROOT + "/search/"}).decode("utf-8", "replace")
        p = _Tables()
        p.feed(page)
        return senate_rows_to_trades(p.rows, meta)


# ---------------------------------------------------------------------------
# Инсайдеры: форма 4 SEC
# ---------------------------------------------------------------------------
def sec_feed():
    """Последние формы 4: [(accession, cik, ссылка, время)] без повторов."""
    root = ET.fromstring(_get(SEC_FEED, headers=_sec_headers()))
    ns = {"a": "http://www.w3.org/2005/Atom"}
    out, seen = [], set()
    for e in root.findall("a:entry", ns):
        title = (e.findtext("a:title", "", ns) or "").strip()
        if not title.startswith("4 "):        # 4/A (исправления) пропускаем
            continue
        link = (e.find("a:link", ns).get("href") if e.find("a:link", ns) is not None else "")
        m = re.search(r"/data/(\d+)/(\d{18})/([\d-]{20})-index", link)
        if not m or m.group(3) in seen:
            continue
        seen.add(m.group(3))
        out.append({"acc": m.group(3), "cik": m.group(1), "acc_nd": m.group(2),
                    "link": link, "filed": (e.findtext("a:updated", "", ns) or "")[:10]})
    return out


ROLE_RU = [(r"chief executive|\bceo\b", "CEO"), (r"chief financial|\bcfo\b", "CFO"),
           (r"chief operating|\bcoo\b", "COO"), (r"chief technology|\bcto\b", "CTO"),
           (r"general counsel|chief legal", "главный юрист"), (r"^president\b", "президент"),
           (r"chair", "председатель совета директоров")]


def _role(rel, t):
    if rel is None:
        return ""
    yes = lambda tag: t(rel, tag).lower() in ("1", "true")
    roles = []
    if yes("isOfficer"):
        title = t(rel, "officerTitle")
        ru = next((r for rx, r in ROLE_RU if re.search(rx, title, re.I)), "")
        roles.append(ru or title or "топ-менеджер")
    if yes("isDirector") and not roles:
        roles.append("член совета директоров")
    if yes("isTenPercentOwner"):
        roles.append("акционер 10%+")
    return ", ".join(roles)


def parse_form4(xml_text, meta):
    """Покупки (код P) и продажи (код S) на открытом рынке из формы 4."""
    root = ET.fromstring(xml_text.encode("utf-8") if isinstance(xml_text, str) else xml_text)

    def t(el, path):
        x = el.find(path) if el is not None else None
        return (x.text or "").strip() if x is not None and x.text else ""

    def num(path_el, path):
        try:
            return float(t(path_el, path).replace(",", ""))
        except ValueError:
            return 0.0

    ticker = t(root, "issuer/issuerTradingSymbol").upper()
    if not ticker or ticker in ("NONE", "N/A"):
        return []
    owners = root.findall("reportingOwner")
    rel = owners[0].find("reportingOwnerRelationship") if owners else None
    person = rel is not None and any(t(rel, k).lower() in ("1", "true") for k in ("isOfficer", "isDirector"))
    names = []
    for o in owners:
        n = t(o, "reportingOwnerId/rptOwnerName")
        parts = n.split()
        if person and 2 <= len(parts) <= 4:   # «COOK TIMOTHY D» -> «Timothy D Cook»
            parts = parts[1:] + parts[:1]
        names.append(" ".join(p.capitalize() if p.isupper() or p.islower() else p for p in parts))
    who = names[0] + (" и др." if len(names) > 1 else "") if names else ""
    plan = t(root, "aff10b5One").lower() in ("1", "true")

    sums = {}
    for tx in root.findall("nonDerivativeTable/nonDerivativeTransaction"):
        code = t(tx, "transactionCoding/transactionCode")
        if code not in ("P", "S"):
            continue
        sh = num(tx, "transactionAmounts/transactionShares/value")
        pr = num(tx, "transactionAmounts/transactionPricePerShare/value")
        if sh <= 0 or pr <= 0:
            continue
        s = sums.setdefault(code, {"value": 0.0, "shares": 0.0, "date": ""})
        s["value"] += sh * pr
        s["shares"] += sh
        s["date"] = max(s["date"], t(tx, "transactionDate/value")[:10])

    out = []
    for code, s in sums.items():
        out.append({
            "src": "sec", "id": _id(meta["acc"], code), "ticker": ticker,
            "company": t(root, "issuer/issuerName"), "who": who, "role": _role(rel, t),
            "type": "buy" if code == "P" else "sell", "value": round(s["value"]),
            "shares": round(s["shares"]), "price": round(s["value"] / s["shares"], 2),
            "plan": plan, "date": s["date"], "disclosed": meta["filed"], "link": meta["link"],
        })
    return out


def sec_filing(meta):
    raw = _get(SEC_TXT.format(**meta), headers=_sec_headers()).decode("utf-8", "replace")
    m = re.search(r"<XML>\s*(.*?)\s*</XML>", raw, re.S | re.I)
    if not m:
        return []
    return parse_form4(m.group(1).strip(), meta)


# ---------------------------------------------------------------------------
# Обновление состояния
# ---------------------------------------------------------------------------
def _state(st):
    tr = st.setdefault("trades", {})
    for k, v in (("congress", []), ("insiders", []), ("docs", {}), ("queue", []),
                 ("ready", {}), ("checked", ""), ("sec_seen", []), ("errors", {})):
        tr.setdefault(k, v)
    return tr


def _congress_alert(t, min_amount):
    return t["type"] in ("buy", "sell", "sell_part") and (t["amin"] or 0) >= min_amount


def _insider_alert(t, min_buy, min_sell):
    if t["type"] == "buy":
        return t["value"] >= min_buy
    return t["value"] >= min_sell and not t.get("plan")


def update(st, now, log=print):
    """Проверяет источники и возвращает новые заметные сделки для Telegram:
    {"congress": [...], "insiders": [...]}. Ошибки источников не прерывают работу."""
    tr = _state(st)
    new = {"congress": [], "insiders": []}
    every = _env_int("CONGRESS_EVERY_MIN", 60)
    min_amount = _env_int("CONGRESS_MIN", 15000)
    min_buy, min_sell = _env_int("INSIDER_MIN_BUY", 250000), _env_int("INSIDER_MIN_SELL", 10000000)

    # --- политики: раз в CONGRESS_EVERY_MIN минут ищем новые отчёты ---
    due = not tr["checked"] or now - datetime.fromisoformat(tr["checked"]) >= timedelta(minutes=every)
    if due:
        tr["checked"] = now.isoformat()
        senate = None
        for src in ("house", "senate"):
            try:
                if src == "house":
                    found = house_index(now)
                else:
                    s = Senate()
                    s.login()
                    found = s.reports(now)
                    senate = s
                queued = {q["doc"] for q in tr["queue"]}
                first = not tr["ready"].get(src)
                for meta in found:
                    if meta["doc"] in tr["docs"] or meta["doc"] in queued:
                        continue
                    if src == "house" and not (len(meta["doc"]) == 8 and meta["doc"].startswith("2")):
                        tr["docs"][meta["doc"]] = meta["filed"]   # скан бумажного отчёта — не читается
                        continue
                    # отчёты, найденные при первом запуске, показываем в терминале, но не присылаем
                    tr["queue"].append({**meta, "src": src, "silent": first})
                tr["ready"][src] = True
                tr["errors"].pop(src, None)
            except Exception as e:
                tr["errors"][src] = f"{type(e).__name__}: {e}"[:200]
                log(f"  ! сделки ({src}): {tr['errors'][src]}")

        # читаем отчёты из очереди (не больше DOCS_PER_CHECK за раз, остальные — в следующий раз)
        try:
            import pdfplumber  # noqa: F401
            has_pdf = True
        except ImportError:
            has_pdf = False
            if any(q["src"] == "house" for q in tr["queue"]):
                log("  ! сделки Палаты пропущены: нет пакета pdfplumber (pip install pdfplumber)")
        done, keep = 0, []
        tr["queue"].sort(key=lambda q: (q["silent"], q["filed"]))   # сначала свежие отчёты
        for q in tr["queue"]:
            if done >= DOCS_PER_CHECK or (q["src"] == "house" and not has_pdf) or \
                    (q["src"] == "senate" and senate is None):
                keep.append(q)
                continue
            done += 1
            try:
                if q["src"] == "house":
                    items = house_report(q)
                else:
                    items = senate.report(q)
                    time.sleep(0.5)
            except Exception as e:
                q["tries"] = q.get("tries", 0) + 1
                log(f"  ! отчёт {q['src']} {q['doc']}: {type(e).__name__}: {e}"[:200])
                if q["tries"] < 3:
                    keep.append(q)
                else:
                    tr["docs"][q["doc"]] = q["filed"]
                continue
            tr["docs"][q["doc"]] = q["filed"]
            known = {c["id"] for c in tr["congress"]}
            for it in items:
                it["id"] = _id(it["src"], it["who"], it["ticker"], it["type"], it["date"], it["amin"], it["owner"], q["doc"])
                if it["id"] in known:
                    continue
                known.add(it["id"])
                tr["congress"].append(it)
                if not q["silent"] and _congress_alert(it, min_amount):
                    new["congress"].append(it)
        tr["queue"] = keep

    # --- инсайдеры: каждый запуск ---
    try:
        feed = sec_feed()
        seen = set(tr["sec_seen"])
        first = not tr["ready"].get("sec")
        fresh = [f for f in feed if f["acc"] not in seen]
        known = {c["id"] for c in tr["insiders"]}
        for k, f in enumerate(fresh):
            if k >= SEC_PER_RUN:
                if first:
                    seen.add(f["acc"])   # при первом запуске старое не догоняем
                continue
            try:
                items = sec_filing(f)
            except Exception as e:
                log(f"  ! форма 4 {f['acc']}: {type(e).__name__}: {e}"[:200])
                continue
            seen.add(f["acc"])
            for it in items:
                if it["id"] in known:
                    continue
                # в терминал — заметные сделки (покупки от $25 тыс., продажи от $500 тыс.)
                if it["value"] < (25000 if it["type"] == "buy" else 500000):
                    continue
                known.add(it["id"])
                tr["insiders"].append(it)
                if not first and _insider_alert(it, min_buy, min_sell):
                    new["insiders"].append(it)
            time.sleep(0.15)   # правило SEC: не больше 10 запросов в секунду
        # лента отдаёт ~100 последних форм; помнить нужно только их
        in_feed = {f["acc"] for f in feed}
        tr["sec_seen"] = [a for a in seen if a in in_feed]
        tr["ready"]["sec"] = True
        tr["errors"].pop("sec", None)
    except Exception as e:
        tr["errors"]["sec"] = f"{type(e).__name__}: {e}"[:200]
        log(f"  ! сделки инсайдеров: {tr['errors']['sec']}")

    _prune(tr, now)
    return new


def _prune(tr, now):
    lo = (now - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
    for key in ("congress", "insiders"):
        items = [t for t in tr[key] if (t.get("disclosed") or "") >= lo]
        items.sort(key=lambda t: (t.get("disclosed") or "", t.get("date") or ""), reverse=True)
        tr[key] = items[:KEEP_MAX]
    doc_lo = (now - timedelta(days=WINDOW_DAYS + 3)).strftime("%Y-%m-%d")
    tr["docs"] = {d: f for d, f in tr["docs"].items() if f >= doc_lo}
    tr["queue"] = [q for q in tr["queue"] if q["filed"] >= doc_lo]


# ---------------------------------------------------------------------------
# Форматирование
# ---------------------------------------------------------------------------
def _num_ru(x):
    s = f"{x:.1f}".rstrip("0").rstrip(".")
    return s.replace(".", ",")


def fmt_usd(v):
    if v >= 1e9:
        return f"${_num_ru(v / 1e9)} млрд"
    if v >= 1e6:
        return f"${_num_ru(v / 1e6)} млн"
    if v >= 1e3:
        return f"${round(v / 1e3)} тыс."
    return f"${round(v)}"


def fmt_range(amin, amax):
    if not amin:
        return "сумма не указана"
    if amax is None:
        return "более " + fmt_usd(amin - 1)
    if amax == amin:
        return fmt_usd(amin)
    unit, word = (1e6, "млн") if amax >= 1e6 else (1e3, "тыс.")
    return f"${_num_ru(round(amin / unit, 1))}–{_num_ru(round(amax / unit, 1))} {word}"


def _dm(d):
    return f"{d[8:10]}.{d[5:7]}" if len(d or "") >= 10 else "?"


def _icon(t):
    return {"buy": "🟢", "sell": "🔴", "sell_part": "🔴"}.get(t, "⚪")


def fmt_congress(t):
    e = html.escape
    owner = OWNER_RU.get(t.get("owner", ""), "")
    line = f"{_icon(t['type'])} <b>{e(t['ticker'])}</b> {TYPE_RU.get(t['type'], 'сделка')} · {fmt_range(t['amin'], t['amax'])}"
    meta = f"{e(t['who'])} ({e(t['where'])})" + (f" · {owner}" if owner else "")
    meta += f" · сделка {_dm(t['date'])}, раскрыта {_dm(t['disclosed'])}"
    return f"{line}\n<i>{meta}</i> · <a href=\"{e(t['link'], quote=True)}\">отчёт</a>"


def fmt_insider(t):
    e = html.escape
    line = f"{_icon(t['type'])} <b>{e(t['ticker'])}</b> {TYPE_RU[t['type']]} {fmt_usd(t['value'])} — {e(t['company'])}"
    shares = f"{t['shares']:,}".replace(",", " ")
    price = f"{t['price']:,.2f}".replace(",", " ").replace(".", ",")
    meta = f"{e(t['who'])}" + (f", {e(t['role'])}" if t.get("role") else "")
    meta += f" · {shares} акций по ${price} · {_dm(t['date'])}"
    return f"{line}\n<i>{meta}</i> · <a href=\"{e(t['link'], quote=True)}\">форма 4</a>"


def messages(new, limit=12):
    """Тексты сообщений для Telegram (пустой список, если нечего слать)."""
    out = []
    for key, title, fmt, note in (
            ("congress", "🏛 <b>Сделки политиков США</b>", fmt_congress,
             "<i>Политики раскрывают сделки с опозданием до 45 дней.</i>"),
            ("insiders", "💼 <b>Сделки инсайдеров</b>", fmt_insider,
             "<i>Руководители компаний покупают или продают свои акции.</i>")):
        items = new.get(key) or []
        if not items:
            continue
        if key == "congress":
            items = sorted(items, key=lambda t: -(t["amin"] or 0))
        else:
            items = sorted(items, key=lambda t: (t["type"] != "buy", -t["value"]))
        blocks = [fmt(t) for t in items[:limit]]
        if len(items) > limit:
            blocks.append(f"<i>…и ещё {len(items) - limit} — в терминале (команда СДЕЛКИ)</i>")
        out.append(title + "\n" + note + "\n\n" + "\n\n".join(blocks))
    return out


def page_data(st):
    """Раздел trades для docs/data.json (терминал)."""
    tr = st.get("trades") or {}
    keep_c = ("src", "who", "where", "owner", "ticker", "asset", "type", "amin", "amax", "date", "disclosed", "link")
    keep_i = ("ticker", "company", "who", "role", "type", "value", "shares", "price", "plan", "date", "disclosed", "link")
    return {
        "congress": [{k: t.get(k) for k in keep_c} for t in (tr.get("congress") or [])[:200]],
        "insiders": [{k: t.get(k) for k in keep_i} for t in (tr.get("insiders") or [])[:200]],
        "checked": tr.get("checked", ""),
    }
