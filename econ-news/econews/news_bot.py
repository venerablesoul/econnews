#!/usr/bin/env python3
"""
Экономические новости -> Telegram.

Каждый запуск:
  1. скачивает RSS-ленты из sources.py,
  2. отбирает экономически значимые новости и оценивает важность,
  3. убирает дубли (одна история из нескольких источников = одна новость),
  4. присылает новое в Telegram,
  5. раз в день (по умолчанию в 21:00 МСК) присылает сводку главного за сутки.

Только стандартная библиотека Python 3.9+, ничего ставить не нужно.

Переменные окружения:
  TELEGRAM_BOT_TOKEN   токен бота от @BotFather            (обязательно)
  TELEGRAM_CHAT_ID     ваш chat id                          (обязательно)
  MIN_LEVEL            high | medium (по умолчанию medium) — что присылать
  DIGEST_HOUR          час дневной сводки по МСК (21), -1 = выключить
  QUIET_HOURS          часы без звука по МСК, например 0-8 (по умолчанию 0-8)
  STATE_FILE           путь к файлу состояния (state.json)

Запуск вручную:
  python news_bot.py             обычный запуск
  python news_bot.py --dry-run   ничего не отправлять, напечатать в консоль
  python news_bot.py --test      отправить тестовое сообщение в Telegram
"""
from __future__ import annotations

import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

from sources import SOURCES

MSK = timezone(timedelta(hours=3))
UA = "Mozilla/5.0 (compatible; EconNewsBot/1.0; +https://github.com)"
MAX_AGE_HOURS = 12          # новости старше не присылаем
MAX_PER_MESSAGE_BATCH = 25  # не больше стольких новостей за один запуск
KEEP_DAYS = 3               # сколько хранить историю в state.json

# ----------------------------------------------------------------------------
# Ключевые слова. Английские — целыми словами, русские — по основе слова.
# ----------------------------------------------------------------------------
HIGH_EN = [
    "rate decision", "rate cut", "rate cuts", "rate hike", "rate hikes", "interest rate", "interest rates",
    "fomc", "powell", "lagarde", "monetary policy", "inflation", "cpi", "pce", "payrolls", "nonfarm",
    "unemployment rate", "jobless claims", "gdp", "recession", "default", "tariff", "tariffs",
    "sanctions", "opec", "opec+", "crude", "oil prices", "bond yields", "treasury yields", "stimulus",
    "bailout", "bank failure", "financial crisis", "crash", "selloff", "sell-off", "rate-setting",
    "stagflation", "debt ceiling", "shutdown", "downgrade", "trade war",
]
MEDIUM_EN = [
    "economy", "economic", "economies", "market", "markets", "stocks", "shares", "earnings",
    "trade", "exports", "imports", "dollar", "euro", "yuan", "yen", "gold", "housing", "retail sales",
    "pmi", "manufacturing", "consumer", "consumers", "debt", "deficit", "central bank", "fed",
    "federal reserve", "ecb", "boe", "pboc", "boj", "jobs", "wages", "growth", "bonds", "treasuries",
    "forecast", "budget", "oil", "gas", "commodities", "bitcoin", "s&p 500", "nasdaq", "dow",
    "investors", "supply chain", "banks", "lending", "mortgage", "mortgages", "imf", "world bank",
]
HIGH_RU = [
    "ключевая ставка", "ключевую ставку", "ключевой ставки", "ставку", "инфляц", "ввп", "рецесси",
    "санкци", "дефолт", "нефт", "опек", "набиуллин", "кризис", "девальвац", "курс рубля", "обвал",
]
MEDIUM_RU = [
    "экономик", "экономич", "рынок", "рынк", "акци", "облигац", "доллар", "евро", "юан", "золот",
    "экспорт", "импорт", "промышлен", "минфин", "бюджет", "профицит", "дефицит", "ипотек", "банк",
    "кредит", "росстат", "цб ", "центробанк", "минэк", "газ", "пошлин", "зарплат", "безработиц",
]


def _compile(words, russian):
    out = []
    for w in words:
        if russian:
            pat = r"(?<![\w])" + re.escape(w)
        else:
            pat = r"(?<![\w])" + re.escape(w) + r"(?![\w])"
        out.append((w, re.compile(pat, re.IGNORECASE)))
    return out


KW_HIGH = _compile(HIGH_EN, False) + _compile(HIGH_RU, True)
KW_MED = _compile(MEDIUM_EN, False) + _compile(MEDIUM_RU, True)


def score_text(title: str, summary: str):
    """Возвращает (очки, есть ли экономические слова в заголовке)."""
    score, title_hit = 0, False
    for _, rx in KW_HIGH:
        if rx.search(title):
            score += 3
            title_hit = True
        elif rx.search(summary):
            score += 1
    for _, rx in KW_MED:
        if rx.search(title):
            score += 1
            title_hit = True
    return min(score, 9), title_hit


# ----------------------------------------------------------------------------
# Загрузка и разбор RSS / Atom
# ----------------------------------------------------------------------------
def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower() if isinstance(tag, str) else ""


def _text(el) -> str:
    if el is None:
        return ""
    return "".join(el.itertext()).strip()


def _clean(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def _parse_date(s: str):
    s = (s or "").strip()
    if not s:
        return None
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError, IndexError):
        d = None
    if d is None:
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def fetch(url: str, timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml, */*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def parse_feed(raw: bytes):
    raw = raw.lstrip(b"\xef\xbb\xbf \r\n\t")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        # частая поломка лент — неэкранированные &
        fixed = re.sub(rb"&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)", b"&amp;", raw)
        root = ET.fromstring(fixed)

    items = []
    for el in root.iter():
        if _local(el.tag) not in ("item", "entry"):
            continue
        title = link = summary = date = ""
        cats = []
        for ch in el:
            name = _local(ch.tag)
            if name == "title":
                title = _text(ch)
            elif name == "link":
                href = ch.get("href")
                if href and (ch.get("rel") in (None, "alternate")):
                    link = link or href
                elif not href:
                    link = link or _text(ch)
            elif name in ("description", "summary", "encoded", "content") and not summary:
                summary = _text(ch)
            elif name in ("pubdate", "published", "updated", "date") and not date:
                date = _text(ch)
            elif name == "category":
                cats.append(_text(ch) or ch.get("term") or "")
            elif name == "guid" and not link and (ch.get("isPermaLink") or "true") == "true":
                link = _text(ch)
        if title:
            items.append({
                "title": _clean(title),
                "link": link.strip(),
                "summary": _clean(summary)[:500],
                "published": _parse_date(date),
                "categories": [c.strip() for c in cats if c],
            })
    return items


def load_source(src):
    try:
        return src, parse_feed(fetch(src["url"])), None
    except Exception as e:  # сеть, 403, кривой XML — источник просто пропускаем
        return src, [], f"{type(e).__name__}: {e}"[:200]


# ----------------------------------------------------------------------------
# Отбор, оценка, дедупликация
# ----------------------------------------------------------------------------
GN_SUFFIX = re.compile(r"\s+[-–—]\s+(Reuters|Bloomberg(?:\.com)?|Bloomberg News|BNN Bloomberg)\s*$", re.I)
STOP = set("the a an of to in on for and or is are as at by with from after over its it be has have will says said new".split())


def norm_tokens(title: str):
    words = re.findall(r"\w+", title.lower())
    return {w for w in words if len(w) > 2 and w not in STOP}


def similar(a: set, b: set) -> bool:
    if not a or not b:
        return False
    inter = len(a & b)
    return inter / min(len(a), len(b)) >= 0.75 and inter >= 3


def item_id(link: str, title: str) -> str:
    key = link or title
    key = re.sub(r"[?#].*$", "", key) if "news.google.com" not in key else key
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]


def level_of(score: int) -> str:
    if score >= 6:
        return "high"
    if score >= 3:
        return "medium"
    return "low"


def evaluate(src, it):
    title = GN_SUFFIX.sub("", it["title"])
    if src.get("categories") and it["categories"]:
        if not any(c in src["categories"] for c in it["categories"]):
            return None
    kw, title_hit = score_text(title, it["summary"])
    kind = src["kind"]
    if kind == "general" and not title_hit:
        return None
    if kind == "econ" and kw == 0:
        return None
    base = {"official": 2, "econ": 1, "general": 0}[kind]
    score = kw + base + src.get("tier", 0)
    return {
        "id": item_id(it["link"], title),
        "title": title,
        "link": it["link"],
        "source": src["name"],
        "sources": [src["name"]],
        "score": score,
        "ts": (it["published"] or datetime.now(timezone.utc)).isoformat(),
    }


def collect(now: datetime):
    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(load_source, SOURCES))

    errors = {}
    ok_names = set()
    candidates = []
    cutoff = now - timedelta(hours=MAX_AGE_HOURS)
    for src, items, err in results:
        if err:
            errors.setdefault(src["name"], err)
            continue
        ok_names.add(src["name"])
        for it in items:
            if it["published"] and it["published"] < cutoff:
                continue
            ev = evaluate(src, it)
            if ev:
                candidates.append(ev)
    # имя источника считается «упавшим», только если не ответила ни одна его лента
    errors = {k: v for k, v in errors.items() if k not in ok_names}
    return candidates, errors


def merge_duplicates(items):
    """Склеивает одну историю из разных источников. Каждый доп. источник +1 к важности."""
    items = sorted(items, key=lambda x: -x["score"])
    merged = []
    for it in items:
        toks = norm_tokens(it["title"])
        for m in merged:
            if m["id"] == it["id"] or similar(toks, m["_toks"]):
                if it["source"] not in m["sources"]:
                    m["sources"].append(it["source"])
                    m["score"] = min(m["score"] + 1, 14)
                m.setdefault("_ids", set()).add(it["id"])
                break
        else:
            it["_toks"] = toks
            it["_ids"] = {it["id"]}
            merged.append(it)
    return merged


# ----------------------------------------------------------------------------
# Состояние
# ----------------------------------------------------------------------------
def load_state(path):
    try:
        with open(path, encoding="utf-8") as f:
            st = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        st = {}
    st.setdefault("initialized", False)
    st.setdefault("seen", {})
    st.setdefault("recent", [])
    st.setdefault("last_digest", "")
    st.setdefault("fail_streak", {})
    return st


def save_state(path, st, now):
    limit = (now - timedelta(days=KEEP_DAYS)).isoformat()
    st["seen"] = {k: v for k, v in st["seen"].items() if v >= limit}
    st["recent"] = [r for r in st["recent"] if r["ts"] >= limit][-1500:]
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


# ----------------------------------------------------------------------------
# Перевод заголовков на русский (бесплатно, без ключей).
# Сначала Google Translate, если не ответил — MyMemory, если и он нет —
# остаётся оригинальный заголовок: новость не теряется.
# ----------------------------------------------------------------------------
GT_URL = "https://translate.googleapis.com/translate_a/single"
MM_URL = "https://api.mymemory.translated.net/get"
CYRILLIC = re.compile(r"[а-яё]", re.IGNORECASE)
_tr_cache: dict = {}


def _google(text, lang):
    q = urllib.parse.urlencode({"client": "gtx", "sl": "auto", "tl": lang, "dt": "t", "q": text})
    req = urllib.request.Request(f"{GT_URL}?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read().decode("utf-8"))
    out = "".join(seg[0] for seg in data[0] if seg and seg[0])
    return out.strip() or None


def _mymemory(text, lang):
    q = urllib.parse.urlencode({"q": text[:480], "langpair": f"en|{lang}"})
    req = urllib.request.Request(f"{MM_URL}?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read().decode("utf-8"))
    out = (data.get("responseData") or {}).get("translatedText") or ""
    if data.get("responseStatus") not in (200, "200") or "MYMEMORY WARNING" in out.upper():
        return None
    return html.unescape(out).strip() or None


def translate(text, lang="ru"):
    if not text or lang in ("", "off", "none") or CYRILLIC.search(text):
        return None  # уже по-русски или перевод выключен
    if text in _tr_cache:
        return _tr_cache[text]
    result = None
    for engine in (_google, _mymemory):
        try:
            result = engine(text, lang)
        except Exception:
            result = None
        if result and result.lower() != text.lower():
            break
        result = None
    _tr_cache[text] = result
    return result


def translate_items(items, lang):
    """Добавляет title_ru тем, у кого его ещё нет (параллельно, 4 потока)."""
    todo = [it for it in items if not it.get("title_ru")]
    if not todo or lang in ("", "off", "none"):
        return
    with ThreadPoolExecutor(max_workers=4) as ex:
        for it, tr in zip(todo, ex.map(lambda x: translate(x["title"], lang), todo)):
            if tr:
                it["title_ru"] = tr


# ----------------------------------------------------------------------------
# Telegram
# ----------------------------------------------------------------------------
TG_API = "https://api.telegram.org"
ICON = {"high": "🔴", "medium": "🟡", "low": "⚪"}
SHOW_ORIGINAL = os.environ.get("SHOW_ORIGINAL", "no").lower() in ("1", "yes", "true")


def fmt_item(it, icon=True):
    src = ", ".join(it["sources"])
    t = html.escape(it.get("title_ru") or it["title"])
    lead = f"{ICON[level_of(it['score'])]} " if icon else "▪️ "
    line = f"{lead}<b>{t}</b>"
    if SHOW_ORIGINAL and it.get("title_ru"):
        line += f"\n<i>{html.escape(it['title'])}</i>"
    line += f"\n<i>{html.escape(src)}</i>"
    if it.get("link"):
        line += f" · <a href=\"{html.escape(it['link'], quote=True)}\">читать →</a>"
    return line


def sectioned(items):
    """Блоки «Главное» / «Также» вместо сплошного списка."""
    high = [s for s in items if level_of(s["score"]) == "high"]
    med = [s for s in items if level_of(s["score"]) != "high"]
    blocks = []
    if high:
        blocks.append("🔴 <b>ГЛАВНОЕ</b>")
        blocks += [fmt_item(s, icon=False) for s in high]
    if med:
        blocks.append("🟡 <b>ТАКЖЕ</b>")
        blocks += [fmt_item(s, icon=False) for s in med]
    return blocks


def split_messages(header, blocks, limit=3900):
    msgs, cur = [], header
    for b in blocks:
        if len(cur) + len(b) + 2 > limit:
            msgs.append(cur)
            cur = b
        else:
            cur += "\n\n" + b
    msgs.append(cur)
    return msgs


class Telegram:
    def __init__(self, token, chat_id, dry=False, pages_url=""):
        self.token, self.chat_id, self.dry = token, chat_id, dry
        self.pages_url = pages_url
        self.use_webapp = True  # кнопка открывает страницу внутри Telegram

    def _markup(self):
        if not self.pages_url:
            return None
        btn = {"text": "📈 Рынок онлайн"}
        btn["web_app" if self.use_webapp else "url"] = {"url": self.pages_url} if self.use_webapp else self.pages_url
        return json.dumps({"inline_keyboard": [[btn]]})

    def _call(self, method, fields, files=None):
        url = f"{TG_API}/bot{self.token}/{method}"
        for attempt in range(3):
            if files:
                data, ctype = _multipart(fields, files)
                req = urllib.request.Request(url, data=data, headers={"Content-Type": ctype})
            else:
                req = urllib.request.Request(url, data=urllib.parse.urlencode(fields).encode())
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    r.read()
                return
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", "ignore")
                if e.code == 429:
                    time.sleep(5 * (attempt + 1))
                    continue
                if e.code == 400 and "reply_markup" in fields and self.use_webapp and \
                        ("BUTTON" in body.upper() or "WEB_APP" in body.upper()):
                    # web_app-кнопки работают только в личке; в группе — обычная ссылка
                    self.use_webapp = False
                    fields["reply_markup"] = self._markup()
                    continue
                raise RuntimeError(f"Telegram ответил {e.code}: {body}") from None
            except urllib.error.URLError:
                time.sleep(3)
        raise RuntimeError("Не удалось достучаться до Telegram")

    def send(self, text, silent=False, button=False):
        if self.dry:
            print("-" * 60 + ("  [без звука]" if silent else "") + ("  [кнопка: Рынок онлайн]" if button and self.pages_url else ""))
            print(html.unescape(re.sub(r"<[^>]+>", "", text)))
            return
        fields = {"chat_id": self.chat_id, "text": text, "parse_mode": "HTML",
                  "disable_web_page_preview": "true", "disable_notification": "true" if silent else "false"}
        if button and self._markup():
            fields["reply_markup"] = self._markup()
        self._call("sendMessage", fields)

    def send_photo(self, png, caption, silent=False, button=True):
        if self.dry:
            print("-" * 60 + f"  [КАРТИНКА {len(png)//1024} КБ]" + ("  [без звука]" if silent else ""))
            print(html.unescape(re.sub(r"<[^>]+>", "", caption)))
            return
        fields = {"chat_id": self.chat_id, "caption": caption[:1024], "parse_mode": "HTML",
                  "disable_notification": "true" if silent else "false"}
        if button and self._markup():
            fields["reply_markup"] = self._markup()
        self._call("sendPhoto", fields, files={"photo": ("market.png", png, "image/png")})


def _multipart(fields, files):
    boundary = "----econnews" + hashlib.md5(str(time.time()).encode()).hexdigest()
    out = []
    for k, v in fields.items():
        out.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    for k, (fname, content, ctype) in files.items():
        out.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{fname}\"\r\n"
                   f"Content-Type: {ctype}\r\n\r\n".encode() + content + b"\r\n")
    out.append(f"--{boundary}--\r\n".encode())
    return b"".join(out), f"multipart/form-data; boundary={boundary}"


def in_quiet_hours(now_msk, spec):
    try:
        a, b = (int(x) for x in spec.split("-"))
    except ValueError:
        return False
    h = now_msk.hour
    return (a <= h < b) if a <= b else (h >= a or h < b)


# ----------------------------------------------------------------------------
# Рынок: котировки, картинка, данные для страницы «Рынок онлайн»
# ----------------------------------------------------------------------------
MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
              "сентября", "октября", "ноября", "декабря"]
PAGE_DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs", "data.json")


def fetch_quotes():
    if os.environ.get("MARKET", "yes").lower() in ("0", "no", "off", "false"):
        return []
    try:
        import market
        return market.fetch_all()
    except Exception as e:
        print(f"  ! котировки недоступны: {e}")
        return []


def strip_line(quotes):
    import market
    return market.strip_line(quotes)


def render_chart(quotes, now):
    try:
        import charts
        return charts.render_market_png(quotes, now)
    except Exception as e:  # нет matplotlib или что-то пошло не так — без картинки
        print(f"  ! картинка не построена: {type(e).__name__}: {e}")
        return None


def write_page_data(st, quotes, now):
    """docs/data.json — его читает страница «Рынок онлайн»."""
    path = os.environ.get("PAGE_DATA", PAGE_DATA)
    if not os.path.isdir(os.path.dirname(path)):
        return
    day_ago = (now - timedelta(hours=48)).isoformat()
    news = [r for r in st["recent"] if r["ts"] >= day_ago and level_of(r["score"]) != "low"]
    news.sort(key=lambda r: r["ts"], reverse=True)
    old = {}
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    try:
        import market
        mk = market.to_json(quotes) if quotes else old.get("market", [])
    except Exception:
        mk = old.get("market", [])
    data = {
        "updated": now.isoformat(),
        "market": mk,
        "news": [{"title": r.get("title_ru") or r["title"], "original": r["title"] if r.get("title_ru") else "",
                  "sources": r["sources"], "link": r["link"], "level": level_of(r["score"]), "ts": r["ts"]}
                 for r in news[:150]],
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


# ----------------------------------------------------------------------------
# Главный цикл одного запуска
# ----------------------------------------------------------------------------
def run(dry=False):
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not dry and (not token or not chat):
        sys.exit("Не заданы TELEGRAM_BOT_TOKEN и/или TELEGRAM_CHAT_ID")
    min_level = os.environ.get("MIN_LEVEL", "medium").strip().lower()
    digest_hour = int(os.environ.get("DIGEST_HOUR", "21"))
    quiet = os.environ.get("QUIET_HOURS", "0-8")
    lang = os.environ.get("TRANSLATE", "ru").strip().lower()
    pages_url = os.environ.get("PAGES_URL", "").strip()
    chart_hours = {int(h) for h in os.environ.get("CHART_HOURS", "9,21").split(",") if h.strip().lstrip("-").isdigit()}
    show_market = os.environ.get("MARKET_LINE", "yes").lower() in ("1", "yes", "true")
    state_path = os.environ.get("STATE_FILE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "state.json"))

    tg = Telegram(token, chat, dry, pages_url)
    now = datetime.now(timezone.utc)
    now_msk = now.astimezone(MSK)
    st = load_state(state_path)

    candidates, errors = collect(now)
    quotes = fetch_quotes()
    mline = strip_line(quotes) if (quotes and show_market) else ""
    for name in {s["name"] for s in SOURCES}:
        st["fail_streak"][name] = st["fail_streak"].get(name, 0) + 1 if name in errors else 0

    # отбрасываем уже виденное и то, что похоже на уже отправленное
    recent_toks = [norm_tokens(r["title"]) for r in st["recent"]]
    fresh = []
    for c in candidates:
        if c["id"] in st["seen"]:
            continue
        toks = norm_tokens(c["title"])
        if any(similar(toks, rt) for rt in recent_toks):
            st["seen"][c["id"]] = now.isoformat()
            continue
        fresh.append(c)
    stories = merge_duplicates(fresh)

    wanted = {"high"} if min_level == "high" else {"high", "medium"}
    to_send = [s for s in stories if level_of(s["score"]) in wanted]
    to_send.sort(key=lambda s: s["ts"], reverse=True)   # свежие выше...
    to_send.sort(key=lambda s: -s["score"])              # ...но важные первыми

    # переводим только то, что действительно уйдёт в Telegram
    translate_items(to_send[:MAX_PER_MESSAGE_BATCH], lang)

    # запоминаем всё увиденное (даже неважное), чтобы не присылать повторно
    for s in stories:
        for i in s["_ids"]:
            st["seen"][i] = now.isoformat()
        rec = {"title": s["title"], "link": s["link"], "sources": s["sources"],
               "score": s["score"], "ts": now.isoformat()}
        if s.get("title_ru"):
            rec["title_ru"] = s["title_ru"]
        st["recent"].append(rec)

    silent = in_quiet_hours(now_msk, quiet)
    stamp = now_msk.strftime("%d.%m %H:%M")

    market_html = f"\n<i>📊 {html.escape(mline)}</i>" if mline else ""

    if not st["initialized"]:
        st["initialized"] = True
        st["last_digest"] = now_msk.strftime("%Y-%m-%d")  # сводку начнём со следующего дня
        top = to_send[:7]
        header = ("✅ <b>Бот экономических новостей запущен</b>\n"
                  f"Слежу за {len({s['name'] for s in SOURCES})} источниками, проверка каждые ~30 минут.\n"
                  "Утром и вечером пришлю графики рынков, в 21:00 — главное за день."
                  + market_html)
        blocks = sectioned(top) if top else ["Пока ничего значимого — пришлю, как только появится."]
        msgs = split_messages(header, blocks)
        for k, m in enumerate(msgs):
            tg.send(m, button=(k == len(msgs) - 1))
    elif to_send:
        extra = len(to_send) - MAX_PER_MESSAGE_BATCH
        batch = to_send[:MAX_PER_MESSAGE_BATCH]
        n_high = sum(level_of(s["score"]) == "high" for s in batch)
        header = f"📰 <b>Экономика · {stamp} МСК</b>" + market_html
        blocks = sectioned(batch)
        if extra > 0:
            blocks.append(f"<i>…и ещё {extra} — на странице «Рынок онлайн»</i>")
        msgs = split_messages(header, blocks)
        # важные новости — со звуком даже ночью
        for k, m in enumerate(msgs):
            tg.send(m, silent=silent and n_high == 0, button=(k == len(msgs) - 1))

    # картинка с графиками рынков (по умолчанию в 9 и 21 МСК)
    chart_key = now_msk.strftime("%Y-%m-%d-%H")
    st.setdefault("charts_sent", [])
    if quotes and now_msk.hour in chart_hours and chart_key not in st["charts_sent"]:
        png = render_chart(quotes, now)
        if png:
            title = "Утренний обзор рынков" if now_msk.hour < 14 else "Рынки к вечеру"
            cap = f"📊 <b>{title}</b>\n{html.escape(mline or strip_line(quotes))}"
            tg.send_photo(png, cap, silent=silent)
            st["charts_sent"] = (st["charts_sent"] + [chart_key])[-20:]

    # дневная сводка
    today = now_msk.strftime("%Y-%m-%d")
    if digest_hour >= 0 and now_msk.hour >= digest_hour and st["last_digest"] != today:
        st["last_digest"] = today
        day_ago = (now - timedelta(hours=24)).isoformat()
        day = [r for r in st["recent"] if r["ts"] >= day_ago and level_of(r["score"]) != "low"]
        day.sort(key=lambda r: -r["score"])
        top = day[:10]
        translate_items(top, lang)   # перевод сохранится и в state.json
        n_all = len(day)
        header = (f"🗓 <b>Главное за {now_msk.day} {MONTHS_GEN[now_msk.month - 1]}</b>\n"
                  f"<i>Значимых новостей за сутки: {n_all}. Топ-{len(top)}:</i>")
        blocks = [f"{k}. " + fmt_item(r, icon=True) for k, r in enumerate(top, 1)] or ["Значимых новостей не было."]
        dead = sorted(n for n, k in st["fail_streak"].items() if k >= 6)
        if dead:
            blocks.append("⚠️ <i>Не отвечают несколько часов: " + html.escape(", ".join(dead)) + "</i>")
        msgs = split_messages(header, blocks)
        for k, m in enumerate(msgs):
            tg.send(m, silent=True, button=(k == len(msgs) - 1))

    write_page_data(st, quotes, now)
    save_state(state_path, st, now)

    print(f"[{stamp} МСК] кандидатов: {len(candidates)}, новых историй: {len(stories)}, "
          f"отправлено: {len(to_send[:MAX_PER_MESSAGE_BATCH])}, котировок: {len(quotes)}, ошибки источников: {len(errors)}")
    for name, err in sorted(errors.items()):
        print(f"  ! {name}: {err}")


def main():
    args = set(sys.argv[1:])
    if "--test" in args:
        tg = Telegram(os.environ.get("TELEGRAM_BOT_TOKEN", ""), os.environ.get("TELEGRAM_CHAT_ID", ""),
                      pages_url=os.environ.get("PAGES_URL", ""))
        tg.send("👋 Тест: бот экономических новостей на связи.", button=True)
        print("Тестовое сообщение отправлено")
        return
    run(dry="--dry-run" in args)


if __name__ == "__main__":
    main()
