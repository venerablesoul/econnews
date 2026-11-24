#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import html
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import i18n
from sources import SOURCES

MSK = timezone(timedelta(hours=3))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
MAX_AGE_HOURS = 12
MAX_PER_MESSAGE_BATCH = 25
KEEP_DAYS = 3
DOWN_AFTER_HOURS = 3
LOOP_MINUTES = 0.0


def down_after():
    every = LOOP_MINUTES if LOOP_MINUTES > 0 else 30.0
    return max(2, int(round(DOWN_AFTER_HOURS * 60 / every)))


def all_down_after():
    every = LOOP_MINUTES if LOOP_MINUTES > 0 else 30.0
    return max(1, int(round(15 / every)))


CODE_SHA = ""

# ----------------------------------------------------------------------------
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


# ----------------------------------------------------------------------------
# ----------------------------------------------------------------------------
TAG_RULES = [
    ("Fed", ["fed", "feds", "federal reserve", "fomc", "powell", "warsh", "фрс"]),
    ("ECB", ["ecb", "lagarde", "ецб", "лагард"]),
    ("BankOfRussia", ["bank of russia", "nabiullina", "цб рф", "банк росси", "набиуллин", "ключев"]),
    ("rates", ["rate cut*", "rate hike*", "interest rate*", "key rate", "rate decision", "monetary policy", "ставк"]),
    ("inflation", ["inflation*", "cpi", "pce", "deflation", "инфляц", "дефляц"]),
    ("oil", ["oil", "crude", "brent", "wti", "opec", "opec+", "нефт", "опек"]),
    ("gas", ["natural gas", "lng", "gas prices", "газа", "газу", "газом", "газов", "спг"]),
    ("gold", ["gold", "bullion", "золот"]),
    ("ruble", ["ruble*", "rouble*", "рубл"]),
    ("dollar", ["dollar*", "greenback", "доллар"]),
    ("bonds", ["bond*", "yield*", "treasur*", "gilt*", "облигац", "офз", "доходност"]),
    ("markets", ["stocks", "shares", "equities", "s&p", "nasdaq", "dow", "selloff", "sell-off", "rally", "акци", "мосбирж", "биржев"]),
    ("China", ["china", "chinese", "pboc", "yuan", "beijing", "китай", "юан", "пекин"]),
    ("tariffs", ["tariff*", "trade war", "пошлин", "торгов войн"]),
    ("sanctions", ["sanction*", "санкци"]),
    ("jobs", ["payrolls", "jobs", "unemployment", "jobless", "labor market", "labour market", "безработиц", "занятост"]),
    ("GDP", ["gdp", "recession", "ввп", "рецесси"]),
    ("crypto", ["bitcoin", "crypto*", "ethereum", "биткоин", "крипто"]),
    ("Russia", ["russia*", "росси", "минфин", "росстат"]),
]


def _tag_rx(w):
    if re.search(r"[а-яё]", w, re.I):
        return re.compile(r"(?<![\w])" + re.escape(w), re.I)
    if w.endswith("*"):
        return re.compile(r"(?<![\w])" + re.escape(w[:-1]), re.I)
    return re.compile(r"(?<![\w])" + re.escape(w) + r"(?![\w])", re.I)


TAGS = [(tag, [_tag_rx(w) for w in words]) for tag, words in TAG_RULES]


def tags_for(*texts, limit=3):
    text = " ".join(t for t in texts if t)
    out = []
    for tag, rxs in TAGS:
        if any(rx.search(text) for rx in rxs):
            out.append(tag)
            if len(out) >= limit:
                break
    return out


def score_text(title: str, summary: str):
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
# Loading and parsing RSS / Atom
# ----------------------------------------------------------------------------
def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower() if isinstance(tag, str) else ""


def _text(el) -> str:
    if el is None:
        return ""
    return "".join(el.itertext()).strip()


def _web_link(s: str) -> str:
    s = (s or "").strip()
    return s if re.match(r"https?://", s, re.I) else ""


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
                "link": _web_link(link),
                "summary": _clean(summary)[:500],
                "published": _parse_date(date),
                "categories": [c.strip() for c in cats if c],
            })
    return items


def load_source(src):
    try:
        return src, parse_feed(fetch(src["url"])), None
    except Exception as e:
        return src, [], f"{type(e).__name__}: {e}"[:200]


# ----------------------------------------------------------------------------
# Selection, scoring, de-duplication
# ----------------------------------------------------------------------------
GN_SUFFIX = re.compile(r"\s+[-–—]\s+(Reuters|Bloomberg(?:\.com)?|Bloomberg News|BNN Bloomberg)\s*$", re.I)
GN_ANY_SUFFIX = re.compile(r"\s+[-–—]\s+[^-–—]{2,60}$")

NOISE = re.compile(r"(?<![\w])(kill(?:s|ed|ing)?|gunm[ae]n|shooting|murder\w*|stabb\w*|surgery|"
                   r"dies|died|funeral|убил\w*|убит\w*|погиб\w*|стрельб\w*|операци[яюи] на)(?![\w])", re.I)
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


LEAD_MAX = 230


def make_lead(title: str, summary: str, link: str) -> str:
    if not summary or "news.google.com" in (link or ""):
        return ""
    s = re.sub(r"\s*(Continue reading|Read more|Читать далее)\W*$", "", summary, flags=re.I).strip()
    s = re.sub(r"\s*The post .{0,200} appeared first on .*$", "", s).strip()
    if len(s) < 40:
        return ""
    t_toks, s_toks = norm_tokens(title), norm_tokens(s)
    if s_toks and len(s_toks - t_toks) < 4:
        return ""
    out = ""
    for sent in re.split(r"(?<=[.!?])\s+", s):
        if len(out) + len(sent) > LEAD_MAX and out:
            break
        out = (out + " " + sent).strip()
    if len(out) > LEAD_MAX:
        out = out[:LEAD_MAX].rsplit(" ", 1)[0].rstrip(",;:—-") + "…"
    return out


def evaluate(src, it):
    title = GN_SUFFIX.sub("", it["title"])
    if "news.google.com" in (it["link"] or ""):
        title = GN_ANY_SUFFIX.sub("", title)
    if len(title.split()) < 3:
        return None
    if src.get("categories") and it["categories"]:
        if not any(c in src["categories"] for c in it["categories"]):
            return None
    kw, title_hit = score_text(title, it["summary"])
    kind = src["kind"]
    if kind != "official" and kw < 3 and NOISE.search(title):
        return None
    if kind == "general" and not title_hit:
        return None
    if kind == "econ" and kw == 0:
        return None
    base = {"official": 2, "econ": 1, "general": 0}[kind]
    score = kw + base + src.get("tier", 0)
    lead = make_lead(title, it["summary"], it["link"])
    return {
        "id": item_id(it["link"], title),
        "title": title,
        "lead": lead,
        "tags": tags_for(title, lead),
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
            try:
                if it["published"] and it["published"] < cutoff:
                    continue
                ev = evaluate(src, it)
            except Exception as e:
                print(f"  ! {src['name']}: skipped a story ({type(e).__name__}: {e})"[:200])
                continue
            if ev:
                candidates.append(ev)
    errors = {k: v for k, v in errors.items() if k not in ok_names}
    return candidates, errors


def merge_duplicates(items):
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
                if not m.get("lead") and it.get("lead"):
                    m["lead"] = it["lead"]
                for t in it.get("tags", []):
                    if t not in m["tags"] and len(m["tags"]) < 3:
                        m["tags"].append(t)
                break
        else:
            it["_toks"] = toks
            it["_ids"] = {it["id"]}
            merged.append(it)
    return merged


# ----------------------------------------------------------------------------
# State
# ----------------------------------------------------------------------------
def load_state(path):
    try:
        with open(path, encoding="utf-8") as f:
            st = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError):
        st = {}
    if not isinstance(st, dict):
        st = {}
    for key, kind, default in (("initialized", bool, False), ("seen", dict, {}), ("recent", list, []),
                               ("last_digest", str, ""), ("fail_streak", dict, {})):
        if not isinstance(st.get(key), kind):
            if key in st:
                print(f"  ! state.json: «{key}» was damaged — starting it over")
            st[key] = default
    st["recent"] = [r for r in st["recent"] if isinstance(r, dict) and isinstance(r.get("ts"), str)
                    and isinstance(r.get("title"), str) and isinstance(r.get("sources"), list)
                    and isinstance(r.get("score"), (int, float)) and isinstance(r.get("link"), str)]
    st["seen"] = {k: v for k, v in st["seen"].items() if isinstance(v, str)}
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
# ----------------------------------------------------------------------------
GT_URL = "https://translate.googleapis.com/translate_a/single"
MM_URL = "https://api.mymemory.translated.net/get"
GC_URL = "https://clients5.google.com/translate_a/t"
CYRILLIC = re.compile(r"[а-яё]", re.IGNORECASE)
_tr_cache: dict = {}
_tr_fail: dict = {}
_engine_off: dict = {}
_ai_tried: set = set()
_bf_tries: dict = {}
TR_RETRY_S = 600
ENGINE_PAUSE_S = 300
MM_QUOTA_PAUSE_S = 3600
BACKFILL_JOBS = 60
BACKFILL_SINGLE = 12
TR_SINGLE = 12
BACKFILL_TRIES = 3
BATCH_URL_CHARS = 4000
HOLD_S = 600
AI_TITLES = 12


def _env_on(name, default):
    return os.environ.get(name, default).strip().lower() in ("1", "yes", "true", "on")


TRANSLATE_ON = os.environ.get("TRANSLATE", "yes").strip().lower() not in ("off", "none", "no", "0", "false")


ENGINE_LANG = {"zh": "zh-CN"}


def _google(text, src, lang):
    q = urllib.parse.urlencode({"client": "gtx", "sl": src, "tl": ENGINE_LANG.get(lang, lang), "dt": "t", "q": text})
    req = urllib.request.Request(f"{GT_URL}?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read().decode("utf-8"))
    out = "".join(seg[0] for seg in data[0] if seg and seg[0])
    return out.strip() or None


def _gclient(text, src, lang):
    q = urllib.parse.urlencode({"client": "dict-chrome-ex", "sl": src, "tl": ENGINE_LANG.get(lang, lang), "q": text})
    req = urllib.request.Request(f"{GC_URL}?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read().decode("utf-8"))
    while isinstance(data, list) and data:
        data = data[0]
    if not isinstance(data, str):
        return None
    return html.unescape(data).strip() or None


def _mymemory(text, src, lang):
    q = urllib.parse.urlencode({"q": text[:480], "langpair": f"{src}|{ENGINE_LANG.get(lang, lang)}"})
    req = urllib.request.Request(f"{MM_URL}?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read().decode("utf-8"))
    out = (data.get("responseData") or {}).get("translatedText") or ""
    if "MYMEMORY WARNING" in out.upper() or data.get("responseStatus") in (429, "429"):
        _engine_off["_mymemory"] = time.time() + MM_QUOTA_PAUSE_S
        return None
    if data.get("responseStatus") not in (200, "200"):
        return None
    return html.unescape(out).strip() or None


def orig_lang(text):
    return "ru" if CYRILLIC.search(text or "") else "en"


def _one_line(text):
    return " ".join(str(text).split())


def _chunks(texts, max_url=BATCH_URL_CHARS):
    out, cur, size = [], [], 0
    for t in texts:
        n = len(urllib.parse.quote(t)) + 3
        if cur and size + n > max_url:
            out.append(cur)
            cur, size = [], 0
        cur.append(t)
        size += n
    if cur:
        out.append(cur)
    return out


def _lines(engine, texts, src, lang):
    out = engine("\n".join(texts), src, lang)
    lines = [x.strip() for x in (out or "").split("\n") if x.strip()]
    if len(lines) == len(texts):
        return lines
    if len(texts) == 1:
        return None
    mid = len(texts) // 2
    head, tail = _lines(engine, texts[:mid], src, lang), _lines(engine, texts[mid:], src, lang)
    return (head or [None] * mid) + (tail or [None] * (len(texts) - mid))


BATCH_ENGINES = ("_gclient", "_google")


def engines_paused():
    now = time.time()
    return all(_engine_off.get(name, 0) > now for name in BATCH_ENGINES)


def prefetch(texts, lang):
    if not TRANSLATE_ON or lang not in i18n.LANGS:
        return 0
    now = time.time()
    groups = {}
    for t in dict.fromkeys(x for x in texts if x):
        src = orig_lang(t)
        if src == lang or (t, lang) in _tr_cache or now - _tr_fail.get((t, lang), 0) < TR_RETRY_S:
            continue
        groups.setdefault(src, []).append(t)
    filled = 0
    for src, todo in groups.items():
        for name in BATCH_ENGINES:
            if not todo:
                break
            engine = globals()[name]
            rest = []
            for chunk in _chunks(todo):
                if _engine_off.get(name, 0) > time.time():
                    rest.extend(chunk)
                    continue
                try:
                    got = _lines(engine, [_one_line(t) for t in chunk], src, lang)
                except Exception as e:
                    _engine_off[name] = time.time() + ENGINE_PAUSE_S
                    print(f"  ! translation {name[1:]} → {lang}: {type(e).__name__}: {e}"[:200])
                    got = None
                for k, t in enumerate(chunk):
                    tr = got[k] if got else None
                    if tr and tr.lower() != _one_line(t).lower():
                        _tr_cache[(t, lang)] = tr
                        _tr_fail.pop((t, lang), None)
                        filled += 1
                    else:
                        rest.append(t)
            todo = rest
    return filled


def translate(text, lang="ru"):
    if not text or not TRANSLATE_ON or lang not in i18n.LANGS:
        return None
    src = orig_lang(text)
    if src == lang:
        return None
    key = (text, lang)
    if key in _tr_cache:
        return _tr_cache[key]
    now = time.time()
    if now - _tr_fail.get(key, 0) < TR_RETRY_S:
        return None
    result = None
    for engine in (_gclient, _google, _mymemory):
        name = engine.__name__
        if _engine_off.get(name, 0) > now:
            continue
        try:
            result = engine(text, src, lang)
        except urllib.error.HTTPError as e:
            if e.code in (403, 429, 503):
                _engine_off[name] = now + ENGINE_PAUSE_S
            result = None
        except (urllib.error.URLError, TimeoutError, OSError):
            _engine_off[name] = now + ENGINE_PAUSE_S
            result = None
        except Exception:
            result = None
        if result and result.lower() != text.lower():
            break
        result = None
    if result:
        _tr_cache[key] = result
        _tr_fail.pop(key, None)
    else:
        _tr_fail[key] = now
    return result


def ai_fill_titles(items, limit=AI_TITLES):
    gaps, seen = [], set()
    for it in items:
        src = orig_lang(it["title"])
        if id(it) in seen or it["title"] in _ai_tried:
            continue
        seen.add(id(it))
        if any(lang != src and not it.get("title_" + lang) for lang in i18n.LANGS):
            gaps.append(it)
    if not gaps:
        return 0
    try:
        import ai
        if not ai.enabled():
            return 0
        gaps = gaps[:limit]
        _ai_tried.update(it["title"] for it in gaps)
        got = ai.translate_titles([it["title"] for it in gaps])
    except Exception as e:
        print(f"  ! AI translation: {type(e).__name__}: {e}"[:200])
        return 0
    filled = 0
    for k, it in enumerate(gaps, 1):
        src = orig_lang(it["title"])
        for lang, text in (got.get(k) or {}).items():
            if lang != src and lang in i18n.LANGS and text and not it.get("title_" + lang) and text.lower() != it["title"].lower():
                it["title_" + lang] = text
                _tr_cache[(it["title"], lang)] = text
                filled += 1
    return filled


def backfill_translations(st, now, limit=BACKFILL_JOBS, single=BACKFILL_SINGLE):
    if not TRANSLATE_ON or engines_paused():
        return 0
    since = (now - timedelta(hours=48)).isoformat()
    shown = [r for r in reversed(st.get("recent") or []) if r.get("ts", "") >= since and level_of(r.get("score", 0)) != "low"]
    t0 = time.time()

    def due(text, target):
        key = (text, target)
        return _bf_tries.get(key, 0) < BACKFILL_TRIES and t0 - _tr_fail.get(key, 0) >= TR_RETRY_S

    titles, leads = [], []
    for r in shown:
        src = orig_lang(r["title"])
        for target in i18n.LANGS:
            if target == src:
                continue
            if not r.get("title_" + target) and due(r["title"], target):
                titles.append((r, "title", target))
            if SUMMARIES and r.get("lead") and not r.get("lead_" + target) and due(r["lead"], target):
                leads.append((r, "lead", target))
    jobs = (titles + leads)[:limit]
    for target in i18n.LANGS:
        prefetch([r[field] for r, field, t in jobs if t == target], target)
    filled, singles = 0, 0
    for r, field, target in jobs:
        key = (r[field], target)
        if key not in _tr_cache:
            if singles >= single or engines_paused():
                continue
            singles += 1
            _bf_tries[key] = _bf_tries.get(key, 0) + 1
        tr = translate(r[field], target)
        if tr:
            r[f"{field}_{target}"] = tr
            filled += 1
    if titles:
        filled += ai_fill_titles([r for r, _, _ in titles])
    return filled


TR_FIELDS = tuple(f"{f}_{lang}" for f in ("title", "lead") for lang in i18n.LANGS)


def translate_items(items, first=()):
    if not TRANSLATE_ON:
        return
    order = [x for x in first if x in i18n.LANGS] + [x for x in i18n.LANGS if x not in first]
    jobs = []
    for target in order:
        for field in ("title", "lead"):
            for it in items:
                if orig_lang(it["title"]) == target or it.get(f"{field}_{target}"):
                    continue
                if field == "lead" and not (SUMMARIES and it.get("lead")):
                    continue
                jobs.append((it, field, f"{field}_{target}", target))
    if not jobs:
        return
    for name in BATCH_ENGINES:
        _engine_off.pop(name, None)
    for it, src, dst, target in jobs:
        _tr_fail.pop((it[src], target), None)
    for target in order:
        prefetch([it[src] for it, src, dst, t in jobs if t == target], target)
    single = []
    for job in jobs:
        it, src, dst, target = job
        if (it[src], target) in _tr_cache:
            it[dst] = _tr_cache[(it[src], target)]
        else:
            single.append(job)
    single = single[:TR_SINGLE]
    with ThreadPoolExecutor(max_workers=3) as ex:
        for (it, src, dst, target), tr in zip(single, ex.map(lambda j: translate(j[0][j[1]], j[3]), single)):
            if tr:
                it[dst] = tr


def hold_untranslated(st, stories, to_send, langs, now):
    held = st.get("tr_hold") if isinstance(st.get("tr_hold"), dict) else {}
    day_ago = (now - timedelta(days=1)).isoformat()
    held = {k: v for k, v in held.items() if isinstance(v, str) and v >= day_ago}
    waiting = []
    if TRANSLATE_ON:
        for s in to_send[:MAX_PER_MESSAGE_BATCH]:
            src = orig_lang(s["title"])
            if not any(lang != src and not s.get("title_" + lang) for lang in langs):
                continue
            first = min((held[i] for i in s["_ids"] if i in held), default=None)
            if first and now - datetime.fromisoformat(first) >= timedelta(seconds=HOLD_S):
                continue
            for i in s["_ids"]:
                held[i] = first or now.isoformat()
            waiting.append(s)
    st["tr_hold"] = held
    if not waiting:
        return stories, to_send
    out = {id(s) for s in waiting}
    print(f"  translation: {len(waiting)} stories wait for the next run")
    return [s for s in stories if id(s) not in out], [s for s in to_send if id(s) not in out]


def title_for(it, lang):
    return it.get("title_" + lang) or it["title"]


def lead_for(it, lang):
    return it.get("lead_" + lang) or it.get("lead") or ""


# ----------------------------------------------------------------------------
# Telegram
# ----------------------------------------------------------------------------
TG_API = "https://api.telegram.org"
ICON = {"high": "🔴", "medium": "🟡", "low": "⚪"}
SHOW_ORIGINAL = _env_on("SHOW_ORIGINAL", "no")
SUMMARIES = _env_on("SUMMARIES", "yes")
SHOW_TAGS = _env_on("TAGS", "yes")
TERMINAL_BUTTON = _env_on("TERMINAL_BUTTON", "yes")


def ai_sum(it, lang):
    ai = it.get("ai") or {}
    if "sum_ru" not in ai:
        return ai.get("sum", "") if lang == "ru" else ""
    if lang in ("zh", "ar"):
        return ai.get("sum_" + lang) or ""
    return ai.get("sum_ru" if lang == "ru" else "sum") or ""


def fmt_tags(tags, lang=i18n.DEFAULT):
    return " ".join("#" + i18n.tag(t, lang) for t in tags)


def fmt_item(it, icon=True, lead=True, lang=i18n.DEFAULT):
    src = ", ".join(i18n.source(x, lang) for x in it["sources"])
    title = title_for(it, lang)
    mark = f"{ICON[level_of(it['score'])]} " if icon else "▪️ "
    line = f"{mark}<b>{html.escape(title)}</b>"
    if SHOW_ORIGINAL and title != it["title"]:
        line += f"\n<i>{html.escape(it['title'])}</i>"
    text = (ai_sum(it, lang) or lead_for(it, lang)) if (lead and SUMMARIES) else ""
    if text:
        line += f"\n{html.escape(text)}"
    meta = html.escape(src)
    if SHOW_TAGS and it.get("tags"):
        meta += " · " + fmt_tags(it["tags"], lang)
    line += f"\n<i>{meta}</i>"
    if it.get("link"):
        line += f" · <a href=\"{html.escape(it['link'], quote=True)}\">{i18n.t(lang, 'read')}</a>"
    return line


def sectioned(items, lang=i18n.DEFAULT):
    high = [s for s in items if level_of(s["score"]) == "high"]
    med = [s for s in items if level_of(s["score"]) != "high"]
    blocks = []
    if high:
        blocks.append(i18n.t(lang, "top"))
        blocks += [fmt_item(s, icon=False, lang=lang) for s in high]
    if med:
        blocks.append(i18n.t(lang, "also"))
        blocks += [fmt_item(s, icon=False, lang=lang) for s in med]
    return blocks


def split_messages(header, blocks, limit=3900):
    msgs, cur = [], header
    for block in blocks:
        for b in _fit(block, limit):
            if len(cur) + len(b) + 2 > limit:
                msgs.append(cur)
                cur = b
            else:
                cur += "\n\n" + b
    msgs.append(cur)
    return msgs


def _fit(block, limit):
    if len(block) <= limit:
        return [block]
    out, cur = [], ""
    for line in block.split("\n"):
        while len(line) > limit:
            if cur:
                out.append(cur)
                cur = ""
            out.append(line[:limit])
            line = line[limit:]
        if cur and len(cur) + 1 + len(line) > limit:
            out.append(cur)
            cur = line
        else:
            cur = cur + "\n" + line if cur else line
    if cur:
        out.append(cur)
    return [x for x in out if x]


class TelegramError(RuntimeError):
    def __init__(self, code, body):
        super().__init__(f"Telegram returned {code}: {body[:300]}")
        self.code, self.body = code, body


def _retry_later(e):
    if isinstance(e, TelegramError):
        return e.code == 429 or e.code >= 500
    if isinstance(e, (urllib.error.URLError, TimeoutError, ConnectionError)):
        return True
    return isinstance(e, RuntimeError) and "unreachable" in str(e)


def per_lang(fn):
    cache = {}

    def get(lang):
        if lang not in cache:
            cache[lang] = fn(lang)
        return cache[lang]
    return get


class Telegram:

    def __init__(self, token, chat_id, dry=False, pages_url="", subscribers=(), langs=None, owner_off=False):
        self.token, self.chat_id, self.dry = token, str(chat_id).strip(), dry
        self.owner_off = owner_off
        self.pages_url = pages_url
        self.subscribers = [str(x) for x in dict.fromkeys(subscribers or []) if str(x) != self.chat_id]
        self.langs = {str(k): i18n.norm_lang(v) for k, v in (langs or {}).items()}
        self.gone = set()
        self.no_webapp = set()
        self.sent = 0

    def lang_of(self, chat):
        return self.langs.get(str(chat)) or i18n.DEFAULT

    def recipients(self, owner_only=False):
        out = [self.chat_id] if self.chat_id and (owner_only or not self.owner_off) else []
        if not owner_only:
            out += [c for c in self.subscribers if c not in self.gone]
        return out

    def _markup(self, chat):
        lang = self.lang_of(chat)
        rows = []
        if self.pages_url:
            q = "" if lang == i18n.DEFAULT else "?lang=" + lang
            webapp = not str(chat).startswith("-") and chat not in self.no_webapp

            def mk(text, url):
                return {"text": text, "web_app": {"url": url}} if webapp else {"text": text, "url": url}
            row = [mk(i18n.t(lang, "btn_market"), self.pages_url + q)]
            if TERMINAL_BUTTON:
                row.append(mk(i18n.t(lang, "btn_terminal"), self.pages_url.rstrip("/") + "/terminal/" + q))
            rows.append(row)
        rows.append([{"text": i18n.t(lang, "btn_menu"), "callback_data": "menu"}])
        return json.dumps({"inline_keyboard": rows})

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
                    return json.loads(r.read().decode("utf-8") or "{}").get("result") or {}
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", "ignore")
                if e.code == 429 and attempt < 2:
                    try:
                        wait = json.loads(body)["parameters"]["retry_after"]
                    except (ValueError, KeyError, TypeError):
                        wait = 5 * (attempt + 1)
                    time.sleep(min(float(wait), 30))
                    continue
                raise TelegramError(e.code, body) from None
            except urllib.error.URLError:
                time.sleep(3)
        raise RuntimeError("Telegram is unreachable")

    def _deliver(self, chat, method, fields, button, files=None):
        f = dict(fields, chat_id=chat)
        markup = self._markup(chat) if button else None
        if markup:
            f["reply_markup"] = markup
        try:
            return self._call(method, f, files)
        except TelegramError as e:
            low = e.body.lower()
            if e.code == 400 and markup and ("button" in low or "web_app" in low):
                self.no_webapp.add(chat)
                f["reply_markup"] = self._markup(chat)
                return self._call(method, f, files)
            if chat != self.chat_id and (e.code == 403 or (e.code == 400 and "chat not found" in low)):
                self.gone.add(chat)
                return None
            raise

    def _broadcast(self, method, make, button, owner_only):
        targets = self.recipients(owner_only)
        delivered, last_err = 0, None
        prepared = {}
        for k, chat in enumerate(targets):
            lang = self.lang_of(chat)
            if lang not in prepared:
                prepared[lang] = make(lang)
            fields, files = prepared[lang]
            if fields is None:
                continue
            try:
                res = self._deliver(chat, method, fields, button(lang) if callable(button) else button, files)
                if res is not None:
                    delivered += 1
                    if files and method == "sendPhoto":
                        photo = (res.get("photo") or [{}])[-1].get("file_id")
                        if photo:
                            prepared[lang] = (dict(fields, photo=photo), None)
            except Exception as e:
                last_err = e
                print(f"  ! Telegram, chat {chat}: {e}"[:300])
            if k and len(targets) > 20:
                time.sleep(0.04)
        if delivered:
            self.sent += 1
        if targets and not delivered and last_err:
            raise last_err

    def _langs_in_use(self, owner_only):
        return sorted({self.lang_of(c) for c in self.recipients(owner_only)}) or [i18n.DEFAULT]

    def send(self, text, silent=False, button=False, owner_only=False):
        make_text = per_lang(text if callable(text) else (lambda lang: text))
        if self.dry:
            for lang in self._langs_in_use(owner_only):
                body = make_text(lang)
                if body is None:
                    continue
                n = sum(1 for c in self.recipients(owner_only) if self.lang_of(c) == lang)
                btn = button(lang) if callable(button) else button
                print("-" * 60 + f"  [{lang}]" + ("  [silent]" if silent else "")
                      + ("  [buttons]" if btn and self.pages_url else "") + f"  [recipients: {n}]")
                print(html.unescape(re.sub(r"<[^>]+>", "", body)))
            return

        def make(lang):
            body = make_text(lang)
            if body is None:
                return None, None
            return {"text": body, "parse_mode": "HTML", "disable_web_page_preview": "true",
                    "disable_notification": "true" if silent else "false"}, None
        self._broadcast("sendMessage", make, button, owner_only)

    def send_multi(self, make_msgs, silent=False, button=True, owner_only=False):
        msgs = per_lang(make_msgs)
        langs = self._langs_in_use(owner_only)
        total = max((len(msgs(l)) for l in langs), default=0)
        for k in range(total):
            self.send(lambda lang, k=k: msgs(lang)[k] if k < len(msgs(lang)) else None, silent=silent,
                      button=(lambda lang, k=k: bool(button) and k == len(msgs(lang)) - 1), owner_only=owner_only)

    def send_photo(self, png, caption, silent=False, button=True, owner_only=False):
        make_png = png if callable(png) else (lambda lang: png)
        make_cap = caption if callable(caption) else (lambda lang: caption)
        if self.dry:
            for lang in self._langs_in_use(owner_only):
                img = make_png(lang)
                print("-" * 60 + f"  [{lang}] [PICTURE {len(img or b'') // 1024} KB]" + ("  [silent]" if silent else ""))
                print(html.unescape(re.sub(r"<[^>]+>", "", make_cap(lang))))
            return

        def make(lang):
            img = make_png(lang)
            if not img:
                return None, None
            fields = {"caption": make_cap(lang)[:1024], "parse_mode": "HTML", "disable_notification": "true" if silent else "false"}
            return fields, {"photo": ("market.png", img, "image/png")}
        self._broadcast("sendPhoto", make, button, owner_only)


# ----------------------------------------------------------------------------
# ----------------------------------------------------------------------------
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs", "config.json")
_SUBS_CACHE = None
OWNER_OFF = False


def worker_url():
    url = os.environ.get("WORKER_URL", "").strip()
    if not url:
        try:
            with open(CONFIG_FILE, encoding="utf-8") as f:
                url = (json.load(f).get("api") or "").strip()
        except (FileNotFoundError, ValueError, AttributeError):
            url = ""
    return url.rstrip("/")


def _sync_key(token):
    return hashlib.sha256(("econnews-sync:" + token).encode()).hexdigest()


def fetch_subscribers(token):
    global _SUBS_CACHE, OWNER_OFF
    url = worker_url()
    if not url or not token:
        return [], {}
    try:
        req = urllib.request.Request(url + "/subs", headers={"Authorization": "Bearer " + _sync_key(token), "User-Agent": UA})
        with urllib.request.urlopen(req, timeout=15) as r:
            d = json.loads(r.read().decode("utf-8"))
        ids = [str(x) for x in d.get("ids", [])]
        langs = {str(k): v for k, v in (d.get("langs") or {}).items()}
        OWNER_OFF = bool(d.get("owner_off"))
        _SUBS_CACHE = (ids, langs)
        return ids, langs
    except Exception as e:
        print(f"  ! subscriber list unavailable ({type(e).__name__}: {e})"[:200]
              + (" — using the previous one" if _SUBS_CACHE else ""))
        return _SUBS_CACHE or ([], {})


def remove_subscribers(token, ids):
    url = worker_url()
    if not url or not ids:
        return
    try:
        req = urllib.request.Request(url + "/subs/remove", data=json.dumps({"ids": sorted(ids)}).encode(),
                                     headers={"Authorization": "Bearer " + _sync_key(token), "User-Agent": UA,
                                              "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as r:
            r.read()
        print(f"  removed subscribers who blocked the bot: {len(ids)}")
    except Exception as e:
        print(f"  ! could not remove subscribers: {type(e).__name__}: {e}"[:200])


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
# ----------------------------------------------------------------------------
PAGE_DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs", "data.json")


def fetch_quotes():
    if os.environ.get("MARKET", "yes").lower() in ("0", "no", "off", "false"):
        return []
    try:
        import market
        return market.fetch_all()
    except Exception as e:
        print(f"  ! quotes unavailable: {e}")
        return []


def strip_line(quotes, lang=i18n.DEFAULT):
    import market
    return market.strip_line(quotes, lang=lang)


def render_chart(quotes, now, lang=i18n.DEFAULT):
    try:
        import charts
        return charts.render_market_png(quotes, now, lang=lang)
    except Exception as e:
        print(f"  ! picture not rendered: {type(e).__name__}: {e}")
        return None


def page_calendar(st, now):
    events = (st.get("calendar") or {}).get("events") or []
    lo, hi = (now - timedelta(days=1)).isoformat(), (now + timedelta(days=7)).isoformat()
    out = []
    try:
        import econ_calendar as cal
        for e in events:
            if e["impact"] not in ("High", "Medium") or not (lo <= e["ts"] <= hi):
                continue
            item = {**e, "title_ru": cal.ru_name(e), "flag": cal.FLAGS.get(e["country"], "")}
            for lang in ("zh", "ar"):
                name = cal.known_name(e, lang)
                if name:
                    item["title_" + lang] = name
            act = (st.get("cal_actuals") or {}).get(cal.event_id(e))
            if act:
                item["actual"] = act
            out.append(item)
    except Exception:
        return []
    out.sort(key=lambda e: e["ts"])
    return out[:200]


def page_news_item(r):
    item = {"title": r["title"], "lang": orig_lang(r["title"]), "lead": r.get("lead") or "",
            "tags": [i18n.TAGS_FROM_RU.get(t, t) for t in r.get("tags", [])],
            "sources": [i18n.SOURCES_FROM_RU.get(x, x) for x in r["sources"]],
            "link": r["link"], "level": level_of(r["score"]), "ts": r["ts"]}
    for k in TR_FIELDS:
        if r.get(k):
            item[k] = r[k]
    try:
        import stocks
        texts = (r["title"], r.get("title_ru"), r.get("title_en"), r.get("lead"), r.get("lead_ru"), r.get("lead_en"))
        tk = stocks.tickers_in(*texts)
        if tk:
            d = stocks.direction(*texts)
            item["tk"] = tk
            if d:
                item["dir"] = d
    except Exception:
        pass
    if r.get("ai"):
        item["ai"] = r["ai"]
    return item


def write_page_data(st, quotes, now):
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
        "news": [page_news_item(r) for r in news[:150]],
        "calendar": page_calendar(st, now),
    }
    if st.get("trades"):
        try:
            import trades
            data["trades"] = trades.page_data(st)
        except Exception as e:
            print(f"  ! trades for the terminal: {type(e).__name__}: {e}")
            if old.get("trades"):
                data["trades"] = old["trades"]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


# ----------------------------------------------------------------------------
# One run
# ----------------------------------------------------------------------------
def run(dry=False):
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not dry and (not token or not chat):
        sys.exit("TELEGRAM_BOT_TOKEN and/or TELEGRAM_CHAT_ID are not set")
    min_level = os.environ.get("MIN_LEVEL", "medium").strip().lower()
    digest_hour = int(os.environ.get("DIGEST_HOUR", "21"))
    quiet = os.environ.get("QUIET_HOURS", "0-8")
    pages_url = os.environ.get("PAGES_URL", "").strip()
    chart_hours = {int(h) for h in os.environ.get("CHART_HOURS", "9,21").split(",") if h.strip().lstrip("-").isdigit()}
    show_market = os.environ.get("MARKET_LINE", "yes").lower() in ("1", "yes", "true")
    morning_hour = int(os.environ.get("MORNING_HOUR", "9"))
    use_calendar = _env_on("CALENDAR", "yes")
    cal_countries = {c.strip().upper() for c in os.environ.get("CAL_COUNTRIES", "USD,EUR,CNY,GBP,JPY").split(",") if c.strip()}
    remind_min = int(os.environ.get("REMIND_MINUTES", "60"))
    alerts_on = _env_on("ALERTS", "yes")
    state_path = os.environ.get("STATE_FILE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "state.json"))

    subscribers, langs = fetch_subscribers(token)
    tg = Telegram(token, chat, dry, pages_url, subscribers, langs, owner_off=OWNER_OFF)
    now = datetime.now(timezone.utc)
    now_msk = now.astimezone(MSK)
    st = load_state(state_path)

    candidates, errors = collect(now)
    quotes = fetch_quotes()
    mline = per_lang(lambda lang: strip_line(quotes, lang) if (quotes and show_market) else "")
    went_down, came_back = [], []
    limit = down_after()
    for name in sorted({s["name"] for s in SOURCES}):
        prev = st["fail_streak"].get(name, 0)
        prev = prev if isinstance(prev, int) else 0
        cur = prev + 1 if name in errors else 0
        st["fail_streak"][name] = cur
        if cur == limit:
            went_down.append(name)
        elif prev >= limit and cur == 0:
            came_back.append(name)
    all_down = len(errors) == len({s["name"] for s in SOURCES})
    st["all_down_streak"] = (int(st.get("all_down_streak") or 0) + 1) if all_down else 0

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
    to_send.sort(key=lambda s: s["ts"], reverse=True)
    to_send.sort(key=lambda s: -s["score"])

    translate_items(to_send[:MAX_PER_MESSAGE_BATCH], first=tg._langs_in_use(False))
    ai_fill_titles(to_send[:MAX_PER_MESSAGE_BATCH])
    if st["initialized"]:
        stories, to_send = hold_untranslated(st, stories, to_send, tg._langs_in_use(False), now)
    try:
        import ai
        if ai.enabled():
            ai.annotate([s for s in to_send if level_of(s["score"]) == "high"])
    except Exception as e:
        print(f"  ! AI notes: {type(e).__name__}: {e}"[:200])

    for s in stories:
        for i in s["_ids"]:
            st["seen"][i] = now.isoformat()
        rec = {"title": s["title"], "link": s["link"], "sources": s["sources"],
               "score": s["score"], "ts": now.isoformat()}
        titles = tuple(k for k in TR_FIELDS if k.startswith("title_"))
        keep = ((*TR_FIELDS, "lead", "tags", "ai") if level_of(s["score"]) != "low" else titles)
        for k in keep:
            if s.get(k):
                rec[k] = s[k]
        st["recent"].append(rec)

    silent = in_quiet_hours(now_msk, quiet)
    stamp = now_msk.strftime("%d.%m %H:%M")

    def market_html(lang):
        m = mline(lang)
        return f"\n<i>📊 {html.escape(m)}</i>" if m else ""

    trouble = []
    today = now_msk.strftime("%Y-%m-%d")

    def failed(part, e, before):
        trouble.append(part)
        print(f"  ! {part}: {type(e).__name__}: {e}"[:300])
        if _retry_later(e):
            return tg.sent > before
        notes = st.get("notices")
        if not isinstance(notes, dict):
            notes = st["notices"] = {}
        if notes.get("part:" + part) != today:
            try:
                tg.send(lambda lang: i18n.t(lang, "part_failed", part=html.escape(i18n.part(part, lang)),
                                            err=html.escape(f"{type(e).__name__}: {e}"[:300])),
                        silent=True, owner_only=True)
                notes["part:" + part] = today
            except Exception as e2:
                print(f"  ! could not tell the owner: {type(e2).__name__}: {e2}"[:200])
        return True

    if not st["initialized"]:
        before = tg.sent
        try:
            top = to_send[:7]
            n_src = len({s["name"] for s in SOURCES})
            tg.send_multi(lambda lang: split_messages(
                i18n.t(lang, "started", n=n_src) + market_html(lang),
                sectioned(top, lang) if top else [i18n.t(lang, "nothing_yet")]), owner_only=True)
        except Exception as e:
            failed("start message", e, before)
        st["initialized"] = True
        st["last_digest"] = today
        st["last_morning"] = today
    elif to_send:
        before = tg.sent
        try:
            extra = len(to_send) - MAX_PER_MESSAGE_BATCH
            batch = to_send[:MAX_PER_MESSAGE_BATCH]
            n_high = sum(level_of(s["score"]) == "high" for s in batch)
            tg.send_multi(lambda lang: split_messages(
                i18n.t(lang, "batch_head", stamp=stamp) + market_html(lang),
                sectioned(batch, lang) + ([i18n.t(lang, "more_on_page", n=extra)] if extra > 0 else [])),
                silent=silent and n_high == 0)
        except Exception as e:
            if tg.sent == before and _retry_later(e):
                raise
            failed("news", e, before)

    events = []
    if use_calendar:
        try:
            import econ_calendar as cal
            events = cal.get_events(st, now, cal_countries)
        except Exception as e:
            print(f"  ! calendar: {type(e).__name__}: {e}")
            events = []

    if events and remind_min > 0:
        before = tg.sent
        try:
            import econ_calendar as cal
            reminded = st.setdefault("cal_reminded", [])
            soon = [e for e in cal.events_between(events, now, now + timedelta(minutes=remind_min))
                    if cal.event_id(e) not in reminded]
            if soon:
                mins = {cal.event_id(e): max(1, int((datetime.fromisoformat(e["ts"]) - now).total_seconds() // 60)) for e in soon}
                try:
                    tg.send(lambda lang: i18n.t(lang, "soon_head") + "\n" + "\n".join(
                        i18n.t(lang, "in_min", m=mins[cal.event_id(e)]) + cal.fmt_event(e, lang, translate) for e in soon), silent=silent)
                    reminded += [cal.event_id(e) for e in soon]
                except Exception as e:
                    if failed("reminders", e, before):
                        reminded += [cal.event_id(x) for x in soon]
            st["cal_reminded"] = reminded[-200:]
        except Exception as e:
            failed("reminders", e, before)

    fred_key = os.environ.get("FRED_API_KEY", "").strip()
    if events and fred_key:
        before = tg.sent
        try:
            import econ_calendar as cal
            actuals = st.setdefault("cal_actuals", {})
            due = [e for e in cal.events_between(events, now - timedelta(hours=36), now - timedelta(minutes=1))
                   if cal.fred_spec(e) and cal.event_id(e) not in actuals]
            released = []
            for e in due[:8]:
                try:
                    a = cal.fetch_actual(e, fred_key)
                except Exception as ex:
                    print(f"  ! FRED {e['title']}: {type(ex).__name__}: {ex}"[:200])
                    continue
                if not a:
                    continue
                actuals[cal.event_id(e)] = a
                released.append((e, a))
            if released:
                tg.send(lambda lang: i18n.t(lang, "released_head") + "\n" + "\n".join(
                    cal.fmt_released(e, a, lang, translate) for e, a in released), silent=silent)
            if len(actuals) > 300:
                st["cal_actuals"] = dict(list(actuals.items())[-300:])
        except Exception as e:
            failed("released data", e, before)

    st.setdefault("last_morning", "")
    if morning_hour >= 0 and morning_hour <= now_msk.hour < 14 and st["last_morning"] != today:
        before = tg.sent
        try:
            since = (now - timedelta(hours=12)).isoformat()
            night = [r for r in st["recent"] if r["ts"] >= since and level_of(r["score"]) != "low"]
            night.sort(key=lambda r: -r["score"])
            top = night[:7]
            translate_items(top)
            todays = []
            if events:
                import econ_calendar as cal
                day_start = now_msk.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
                todays = cal.events_between(events, max(now, day_start), day_start + timedelta(days=1))

            def morning(lang):
                blocks = [f"{k}. " + fmt_item(r, icon=True, lead=k <= 3, lang=lang) for k, r in enumerate(top, 1)] \
                    or [i18n.t(lang, "quiet_night")]
                if todays:
                    import econ_calendar as cal
                    blocks.append(i18n.t(lang, "today_cal") + "\n" + "\n".join(cal.fmt_event(e, lang, translate) for e in todays))
                return split_messages(i18n.t(lang, "morning_head") + market_html(lang), blocks)
            tg.send_multi(morning)
            st["last_morning"] = today
        except Exception as e:
            if failed("morning digest", e, before):
                st["last_morning"] = today

    st.setdefault("last_brief", "")
    brief_hour = int(os.environ.get("BRIEF_HOUR", "16"))
    if brief_hour >= 0 and now_msk.weekday() < 5 and brief_hour <= now_msk.hour < brief_hour + 3 and st["last_brief"] != today:
        before = tg.sent
        try:
            import brief
            import ai
            make = brief.build(now, quotes, ai_note=ai.brief_note if ai.enabled() else None)
            if make:
                tg.send(make, silent=silent)
            st["last_brief"] = today
        except Exception as e:
            if failed("pre-market brief", e, before):
                st["last_brief"] = today

    if alerts_on and st["initialized"]:
        lines = []
        if all_down:
            if st["all_down_streak"] >= all_down_after() and not st.get("all_down_alerted"):
                lines.append(("all_down", {}))
        else:
            if went_down:
                lines.append(("went_down", {"h": DOWN_AFTER_HOURS, "names": html.escape(", ".join(went_down))}))
            if came_back:
                lines.append(("came_back", {"names": html.escape(", ".join(came_back))}))
        if lines:
            before = tg.sent
            try:
                tg.send(lambda lang: "\n".join(i18n.t(lang, k, **kw) for k, kw in lines), silent=True, owner_only=True)
                done = True
            except Exception as e:
                done = failed("source alerts", e, before)
            if done and all_down:
                st["all_down_alerted"] = True
        if not all_down:
            st["all_down_alerted"] = False

    n_trades = 0
    if _env_on("TRADES", "yes"):
        before = tg.sent
        try:
            import trades
            new_trades = trades.update(st, now)
            n_trades = sum(len(v) for v in new_trades.values())
            if any(new_trades.values()):
                tg.send_multi(lambda lang: trades.messages(new_trades, lang=lang), silent=silent, button=False)
        except Exception as e:
            failed("trades", e, before)

    chart_key = now_msk.strftime("%Y-%m-%d-%H")
    st.setdefault("charts_sent", [])
    if quotes and now_msk.hour in chart_hours and chart_key not in st["charts_sent"]:
        before = tg.sent
        try:
            title_key = "chart_morning" if now_msk.hour < 14 else "chart_evening"
            tg.send_photo(per_lang(lambda lang: render_chart(quotes, now, lang)),
                          lambda lang: f"📊 <b>{i18n.t(lang, title_key)}</b>\n{html.escape(mline(lang) or strip_line(quotes, lang))}",
                          silent=silent)
            done = True
        except Exception as e:
            done = failed("chart", e, before)
        if done:
            st["charts_sent"] = (st["charts_sent"] + [chart_key])[-20:]

    if digest_hour >= 0 and now_msk.hour >= digest_hour and st["last_digest"] != today:
        before = tg.sent
        try:
            day_ago = (now - timedelta(hours=24)).isoformat()
            day = [r for r in st["recent"] if r["ts"] >= day_ago and level_of(r["score"]) != "low"]
            day.sort(key=lambda r: -r["score"])
            top = day[:10]
            translate_items(top)
            nxt = []
            if events:
                import econ_calendar as cal
                tomorrow = (now_msk + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
                nxt = cal.events_between(events, tomorrow, tomorrow + timedelta(days=1))
            dead = sorted(n for n, k in st["fail_streak"].items() if isinstance(k, int) and k >= down_after())

            def digest(lang):
                header = i18n.t(lang, "digest_head", day=now_msk.day, month=i18n.month(lang, now_msk.month), n=len(day), k=len(top))
                blocks = [f"{k}. " + fmt_item(r, icon=True, lead=k <= 3, lang=lang) for k, r in enumerate(top, 1)] \
                    or [i18n.t(lang, "digest_empty")]
                if nxt:
                    import econ_calendar as cal
                    blocks.append(i18n.t(lang, "tomorrow_cal") + "\n" + "\n".join(cal.fmt_event(e, lang, translate) for e in nxt))
                if dead:
                    blocks.append(i18n.t(lang, "dead", names=html.escape(", ".join(dead))))
                return split_messages(header, blocks)
            tg.send_multi(digest, silent=True)
            st["last_digest"] = today
        except Exception as e:
            if failed("evening digest", e, before):
                st["last_digest"] = today

    if CODE_SHA:
        st["code_ok"] = {"sha": CODE_SHA, "at": now.isoformat()}
    try:
        backfill_translations(st, now)
    except Exception as e:
        print(f"  ! translation backfill: {type(e).__name__}: {e}"[:200])
    write_page_data(st, quotes, now)
    save_state(state_path, st, now)
    extras = update_extras(now, dry)
    push_live(token, now)
    if tg.gone:
        remove_subscribers(token, tg.gone)

    print(f"[{stamp} MSK] candidates: {len(candidates)}, new stories: {len(stories)}, "
          f"sent: {len(to_send[:MAX_PER_MESSAGE_BATCH])}, recipients: {len(tg.recipients())}, "
          f"quotes: {len(quotes)}, trades: {n_trades}, {extras}"
          f"source errors: {len(errors)}" + (f", failed parts: {', '.join(trouble)}" if trouble else ""))
    for name, err in sorted(errors.items()):
        print(f"  ! {name}: {err}")
    return tg.sent


def update_extras(now, dry=False):
    parts = []
    if dry or not _env_on("COMPANIES", "yes"):
        return ""
    try:
        import stocks
        d = stocks.build(now)
        if d:
            parts.append(f"stocks: {d['prices_ok']}, ratios: {d['metrics_updated']}, financials: {d.get('fin_updated', 0)}")
    except Exception as e:
        print(f"  ! companies (stocks.py): {type(e).__name__}: {e}"[:200])
    try:
        import rates
        r = rates.build(now)
        if r:
            parts.append(f"curves: {len(r.get('curves') or {})}")
    except Exception as e:
        print(f"  ! rates (rates.py): {type(e).__name__}: {e}"[:200])
    for mod, label in (("company", "company files"), ("options", "option chains"), ("deribit", "crypto options"),
                       ("ais", "ships (AIS)"), ("chokepoints", "oil chokepoints (EIA)"), ("portwatch", "chokepoint transits (PortWatch)"),
                       ("sat", "satellite images of oil storage"), ("basemap", "map tiles"), ("macro", "macro"), ("moex", "MOEX"),
                       ("ipo", "IPO"), ("wpe", "world valuations"), ("auctions", "Treasury auctions")):
        try:
            n = __import__(mod).build(now)
            if n:
                parts.append(f"{label}: {n}")
        except Exception as e:
            print(f"  ! {label} ({mod}.py): {type(e).__name__}: {e}"[:200])
    return (", ".join(parts) + ", ") if parts else ""


def push_live(token, now):
    url = worker_url()
    path = os.environ.get("PAGE_DATA", PAGE_DATA)
    if not url or not token or not os.path.exists(path):
        return
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        body = json.dumps({"updated": d.get("updated"), "news": (d.get("news") or [])[:60],
                           "market": d.get("market") or []}, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(url + "/sync/live", data=body, method="POST",
                                     headers={"Authorization": "Bearer " + _sync_key(token), "User-Agent": UA,
                                              "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as r:
            r.read()
    except Exception as e:
        print(f"  ! live feed to the bot server: {type(e).__name__}: {e}"[:200])


def load_dotenv(path):
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass


DATA_PATHS = ("state.json", "docs/data.json", "docs/stocks.json", "docs/rates.json", "docs/fin", "docs/co", "docs/opt",
              "docs/options.json", "docs/macro.json", "docs/moex.json", "docs/ipo.json", "docs/wpe.json",
              "docs/auctions.json", "docs/gex", "docs/ships.json", "docs/chokepoints.json", "docs/ships_world.json",
              "docs/ais_kinds.json", "docs/portwatch.json", "docs/pw_ports.json", "docs/sat.json", "docs/sat", "docs/base")
DATA_BRANCH = "gh-pages"
SITE_PATHS = ("docs", "state.json")
_published = {}


def _copy_data(src_root, dst_root):
    import shutil
    for f in DATA_PATHS:
        src, dst = os.path.join(src_root, f), os.path.join(dst_root, f)
        if os.path.isdir(src):
            shutil.copytree(src, dst, dirs_exist_ok=True)
        elif os.path.isfile(src):
            os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
            shutil.copy2(src, dst)


def git_sync(stage, repo, code=True, skip=()):
    import shutil
    import subprocess
    import tempfile

    branch = os.environ.get("DATA_BRANCH", "").strip() or DATA_BRANCH

    def git(*a, env=None, stdin=None):
        return subprocess.run(["git", "-C", repo, *a], capture_output=True, text=True, timeout=120, env=env, input=stdin)

    def heal():
        if any(os.path.isdir(os.path.join(repo, ".git", d)) for d in ("rebase-merge", "rebase-apply")):
            print("  ! git: aborting a stuck rebase")
            git("rebase", "--abort")

    heal()
    tmp = tempfile.mkdtemp()
    try:
        if stage == "pull":
            if code and skip and git("fetch", "-q").returncode == 0:
                up = git("rev-parse", "-q", "--verify", "@{upstream}").stdout.strip()
                code = up not in skip
            if code:
                _copy_data(repo, tmp)
                for f in DATA_PATHS:
                    git("checkout", "-q", "HEAD", "--", f)
                r = git("pull", "--rebase", "--autostash", "-q")
                if r.returncode:
                    print("  ! git pull:", (r.stderr or r.stdout).strip()[:300])
                    heal()
                    if git("fetch", "-q", "origin").returncode == 0:
                        git("reset", "-q", "--hard", "@{upstream}")
                _copy_data(tmp, repo)
            state = os.path.join(repo, "state.json")
            fresh = not os.path.exists(state) or (
                git("ls-files", "--error-unmatch", "state.json").returncode == 0
                and git("diff", "--quiet", "HEAD", "--", "state.json").returncode == 0)
            if fresh:
                _pull_data(git, repo, branch, os.path.join(tmp, "index"))
            return

        if not os.path.exists(os.path.join(repo, "state.json")):
            print(f"  (no state.json here — nothing to save, {branch} stays as it is)")
            return
        paths = [p for p in SITE_PATHS if os.path.exists(os.path.join(repo, p))]
        env = {**os.environ, "GIT_INDEX_FILE": os.path.join(tmp, "index")}
        r = git("add", "-f", "-A", "--", *paths, env=env)
        tree = git("write-tree", env=env).stdout.strip() if r.returncode == 0 else ""
        if not tree:
            print("  ! git: could not pack the site:", (r.stderr or r.stdout).strip()[:300])
            return
        if _published.get(branch) == tree:
            return
        commit = git("-c", "user.name=news-bot", "-c", "user.email=news-bot@users.noreply.github.com",
                     "commit-tree", tree, "-m", "site data").stdout.strip()
        for _ in range(3):
            r = git("push", "-f", "-q", "origin", f"{commit}:refs/heads/{branch}")
            if r.returncode == 0:
                _published[branch] = tree
                return
            time.sleep(3)
        print("  ! git push failed:", (r.stderr or r.stdout).strip()[:300])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _pull_data(git, repo, branch, index):
    ref = "refs/remotes/origin/" + branch
    if git("fetch", "-q", "origin", f"+refs/heads/{branch}:{ref}").returncode:
        print(f"  (no {branch} branch on GitHub yet: the data stays as it is)")
        return False
    names = [n for n in git("ls-tree", "-r", "-z", "--name-only", ref, "--", *DATA_PATHS).stdout.split("\0") if n]
    if not names:
        return False
    env = {**os.environ, "GIT_INDEX_FILE": index}
    if git("read-tree", ref, env=env).returncode:
        return False
    r = git("checkout-index", "-f", "-z", "--stdin", env=env, stdin="\0".join(names))
    if r.returncode:
        print("  ! git: could not restore the data:", (r.stderr or r.stdout).strip()[:300])
        return False
    print(f"  data restored from {branch}: {len(names)} files")
    return True


def code_hash(repo):
    h = hashlib.sha1()
    for name in sorted(os.listdir(repo)):
        if name.endswith(".py"):
            with open(os.path.join(repo, name), "rb") as f:
                h.update(name.encode() + b"\0" + f.read())
    return h.hexdigest()


def restart(deadline, why):
    if deadline:
        os.environ["LOOP_DEADLINE"] = str(deadline)
    print(why, flush=True)
    sys.stderr.flush()
    if os.name == "nt":
        os._exit(75)
    try:
        os.execv(sys.executable, [sys.executable] + sys.argv)
    except OSError as e:
        print(f"  ! could not restart: {e}", flush=True)
        os._exit(75)


def reload_self(deadline):
    restart(deadline, "The bot code changed on GitHub — restarting with the new version.")


# ----------------------------------------------------------------------------
# ----------------------------------------------------------------------------
HANG_MINUTES = float(os.environ.get("HANG_MINUTES", "30") or 30)
FAIL_ALERT_MINUTES = 30
RELAY_EVERY = 30 * 60


def _git(repo, *a, timeout=120):
    import subprocess
    try:
        return subprocess.run(["git", "-C", repo, *a], capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError) as e:
        return subprocess.CompletedProcess(a, 1, "", str(e))


def git_head(repo):
    r = _git(repo, "rev-parse", "HEAD")
    return r.stdout.strip() if r.returncode == 0 else ""


def _relay():
    try:
        import relay
        return relay
    except Exception as e:
        print(f"  ! relay.py: {type(e).__name__}: {e}"[:200])
        return None


def _last_line(text):
    lines = [x.strip() for x in (text or "").splitlines() if x.strip()]
    failed = [x for x in lines if x.startswith("SELF-CHECK FAILED")]
    return (failed or lines or ["no details"])[-1].replace("SELF-CHECK FAILED:", "").strip()


def selfcheck_in(repo, timeout=300):
    import subprocess
    try:
        r = subprocess.run([sys.executable, os.path.join(repo, "news_bot.py"), "--selfcheck"], cwd=repo,
                           capture_output=True, text=True, timeout=timeout)
        return r.returncode == 0, (r.stdout + r.stderr).strip()[-1500:]
    except subprocess.TimeoutExpired:
        return False, f"SELF-CHECK FAILED: it did not finish in {timeout} s"
    except OSError as e:
        return False, f"SELF-CHECK FAILED: {type(e).__name__}: {e}"


def rollback(repo, sha):
    import shutil
    import tempfile
    tmp = tempfile.mkdtemp()
    try:
        _copy_data(repo, tmp)
        ok = _git(repo, "reset", "-q", "--hard", sha).returncode == 0
        _copy_data(tmp, repo)
        return ok
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _state_path():
    return os.environ.get("STATE_FILE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "state.json"))


def notice_once(key, value):
    path = _state_path()
    try:
        st = load_state(path)
        notes = st.setdefault("notices", {})
        if not isinstance(notes, dict):
            notes = st["notices"] = {}
        if notes.get(key) == value:
            return False
        notes[key] = value
        save_state(path, st, datetime.now(timezone.utc))
    except OSError as e:
        print(f"  ! state.json: {e}")
    return True


def notify_owner(text):
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat:
        return False
    langs = (_SUBS_CACHE or fetch_subscribers(token))[1]
    tg = Telegram(token, chat, langs=langs)
    quiet = in_quiet_hours(datetime.now(MSK), os.environ.get("QUIET_HOURS", "0-8"))
    try:
        tg.send(text, silent=quiet, owner_only=True)
    except Exception as e:
        print(f"  ! could not tell the owner: {type(e).__name__}: {e}"[:200])
    return tg.sent > 0


def report_bad_code(sha, report):
    if not sha or not notice_once("bad_code", sha):
        return
    err = _last_line(report)[:300]
    notify_owner(lambda lang: i18n.t(lang, "code_rejected", sha=sha[:7], err=html.escape(err)))


def update_code(repo, start_hash, deadline, bad, pinned=False, auto_reload=True):
    if pinned:
        git_sync("pull", repo, code=False)
        return
    before = git_head(repo)
    git_sync("pull", repo, skip=bad)
    if not auto_reload or code_hash(repo) == start_hash:
        return
    after = git_head(repo)
    ok, report = selfcheck_in(repo)
    if ok:
        reload_self(deadline)
        return
    print(f"  ! the new code ({after[:7]}) fails its self-check — staying on {before[:7]}\n{report}")
    if before and after and before != after:
        rollback(repo, before)
    if after:
        bad.add(after)
        os.environ["BOT_BAD_CODE"] = ",".join(sorted(bad))
        report_bad_code(after, report)


class Watchdog:

    def __init__(self, limit, on_stuck):
        self.limit, self.on_stuck, self.since = limit, on_stuck, None
        threading.Thread(target=self._watch, name="watchdog", daemon=True).start()

    def begin(self):
        self.since = time.monotonic()

    def end(self):
        self.since = None

    def _watch(self):
        while True:
            time.sleep(max(0.05, min(30.0, self.limit / 4)))
            since = self.since
            if since is not None and time.monotonic() - since > self.limit:
                self.since = None
                try:
                    self.on_stuck()
                except BaseException as e:
                    print(f"  ! watchdog: {type(e).__name__}: {e}", flush=True)


def selfcheck():
    import importlib
    import tempfile
    from unittest import mock

    here = os.path.dirname(os.path.abspath(__file__))
    names = sorted(n[:-3] for n in os.listdir(here) if n.endswith(".py"))
    problems = []
    for name in names:
        path = os.path.join(here, name + ".py")
        try:
            with open(path, encoding="utf-8") as f:
                compile(f.read(), path, "exec")
        except Exception as e:
            problems.append(f"{name}.py: {type(e).__name__}: {e}")
    if problems:
        return problems

    def no_network(*a, **k):
        raise OSError("self-check: no network")

    with mock.patch("urllib.request.urlopen", no_network), mock.patch("urllib.request.OpenerDirector.open", no_network):
        for name in names:
            try:
                importlib.import_module(name)
            except Exception as e:
                problems.append(f"import {name}: {type(e).__name__}: {e}")
        if problems:
            return problems
        nb = importlib.import_module("news_bot")
        now = datetime.now(timezone.utc)

        def story(i, title, score, tags, source="Reuters"):
            return {"id": f"selfcheck{i}", "title": title, "lead": "", "tags": tags, "link": f"https://example.invalid/{i}",
                    "source": source, "sources": [source], "score": score, "ts": now.isoformat()}

        batches = [[story(1, "Fed holds rates steady as inflation cools", 9, ["Fed", "rates"])],
                   [story(2, "Oil jumps after OPEC cuts output sharply", 8, ["oil"]),
                    story(3, "ЦБ сохранил ключевую ставку на уровне 16%", 9, ["BankOfRussia"], source="Bank of Russia")]]
        sent = []

        def fake_call(self, method, fields, files=None):
            sent.append((str(fields.get("chat_id")), fields.get("text") or ""))
            return {"message_id": len(sent)}

        def fake_translate(text, lang="ru"):
            return None if nb.orig_lang(text) == lang else f"[{lang}] {text}"

        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "docs"))
            env = {"TELEGRAM_BOT_TOKEN": "1:SELFCHECK", "TELEGRAM_CHAT_ID": "100", "PAGES_URL": "https://example.invalid/",
                   "STATE_FILE": os.path.join(d, "state.json"), "PAGE_DATA": os.path.join(d, "docs", "data.json"),
                   "DIGEST_HOUR": "0", "MORNING_HOUR": "-1", "BRIEF_HOUR": "-1", "CALENDAR": "no", "TRADES": "no", "ANTHROPIC_API_KEY": "",
                   "FRED_API_KEY": "", "QUIET_HOURS": "0-0", "MARKET": "no"}
            try:
                with mock.patch.dict(os.environ, env), \
                        mock.patch.object(nb, "collect", side_effect=lambda now: (batches.pop(0), {})), \
                        mock.patch.object(nb, "fetch_subscribers", return_value=(["200", "300"], {"300": "ru"})), \
                        mock.patch.object(nb, "translate", side_effect=fake_translate), \
                        mock.patch.object(nb, "update_extras", return_value=""), \
                        mock.patch.object(nb, "push_live"), mock.patch.object(nb, "remove_subscribers"), \
                        mock.patch.object(nb.Telegram, "_call", fake_call):
                    nb.run()
                    nb.run()
                with open(env["STATE_FILE"], encoding="utf-8") as f:
                    st = json.load(f)
                with open(env["PAGE_DATA"], encoding="utf-8") as f:
                    data = json.load(f)
                chats = {c for c, _ in sent}
                ru = " ".join(t for c, t in sent if c == "300")
                if not st.get("initialized") or len(st.get("seen") or {}) < 3:
                    problems.append("offline run: state.json was not saved properly")
                if len(data.get("news") or []) != 3:
                    problems.append(f"offline run: data.json has {len(data.get('news') or [])} stories instead of 3")
                if not {"100", "200", "300"} <= chats:
                    problems.append(f"offline run: messages reached {sorted(chats)} instead of the owner and both readers")
                if not re.search(r"[а-яё]", ru, re.I):
                    problems.append("offline run: the Russian reader got no Russian text")
            except Exception as e:
                import traceback
                problems.append(f"offline run: {type(e).__name__}: {e}")
                traceback.print_exc()
    return problems


def loop(minutes, sync, max_hours=0.0):
    global LOOP_MINUTES, CODE_SHA
    LOOP_MINUTES = float(minutes)
    repo = os.path.dirname(os.path.abspath(__file__))
    try:
        deadline = float(os.environ["LOOP_DEADLINE"])
    except (KeyError, ValueError):
        deadline = time.time() + max_hours * 3600 if max_hours > 0 else None
    auto_reload = os.environ.get("AUTO_RELOAD", "yes").strip().lower() not in ("0", "no", "off", "false")
    pinned = os.environ.get("BOT_PINNED", "").strip()
    main_bad = os.environ.get("BOT_MAIN_BAD", "").strip()
    bad = {x for x in os.environ.get("BOT_BAD_CODE", "").split(",") if x} | ({main_bad} if main_bad else set())
    start_hash = code_hash(repo)
    if sync:
        CODE_SHA = git_head(repo)
    rl = _relay() if sync else None
    on_actions = bool(rl and rl.enabled())
    if on_actions and rl.stopped():
        print("The workflow is disabled (Actions → Economic news → Enable workflow turns the bot back on) — not starting.")
        return
    print(f"The bot runs continuously: a check every {minutes:g} min"
          + (", GitHub sync on" if sync else "") + ". Stop: Ctrl+C.")
    if pinned:
        print(f"main ({main_bad[:7]}) fails its self-check — running the last version that worked ({pinned[:7]}).")
    dog = Watchdog(HANG_MINUTES * 60, lambda: restart(
        deadline, f"  ! a run has been stuck for {HANG_MINUTES:g} min — starting the bot over"))
    last_push = 0.0
    push_every = float(os.environ.get("PUSH_MINUTES", "10")) * 60
    fails, fail_since, alerted, reported_main = 0, None, False, False
    relay_at = None
    while True:
        started = time.time()
        dog.begin()
        try:
            if sync:
                update_code(repo, start_hash, deadline, bad, pinned=bool(pinned), auto_reload=auto_reload)
                if pinned and not reported_main:
                    reported_main = True
                    try:
                        with open(os.environ.get("BOT_MAIN_REPORT", ""), encoding="utf-8") as f:
                            report = f.read()
                    except OSError:
                        report = ""
                    report_bad_code(main_bad, report)
            sent = run()
            if sync and (sent or time.time() - last_push >= push_every - 30):
                git_sync("push", repo)
                last_push = time.time()
        except SystemExit as e:
            print(e)
            return
        except Exception as e:
            fails += 1
            fail_since = fail_since or started
            err = f"{type(e).__name__}: {e}"
            print(f"  ! the run failed: {err}")
            mins = int((time.time() - fail_since) / 60)
            if not alerted and fails >= 3 and mins >= FAIL_ALERT_MINUTES:
                alerted = notify_owner(lambda lang: i18n.t(lang, "bot_failing", n=fails, m=mins, err=html.escape(err[:300])))
        else:
            if alerted:
                mins = int((time.time() - fail_since) / 60)
                notify_owner(lambda lang: i18n.t(lang, "bot_recovered", m=mins))
            fails, fail_since, alerted = 0, None, False
            if on_actions:
                rl.mark_healthy()
                if relay_at is None or time.time() - relay_at >= RELAY_EVERY:
                    first, relay_at = relay_at is None, time.time()
                    if rl.stopped():
                        print("The workflow was disabled — this session ends here (Enable workflow turns the bot back on).")
                        return
                    print("  next session:", rl.queue_next())
                    if first:
                        print("  workflows kept on:", rl.keep_enabled(rl.news_workflow(), rl.KEEPALIVE))
        finally:
            dog.end()
        pause = max(30.0, minutes * 60 - (time.time() - started))
        if deadline and time.time() + pause > deadline:
            print("Time is up, exiting.")
            return
        time.sleep(pause)


def main():
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
    args = sys.argv[1:]
    if "--selfcheck" in args:
        problems = selfcheck()
        for p in problems[1:]:
            print("  " + p)
        print(f"SELF-CHECK FAILED: {problems[0]}" if problems else "SELF-CHECK OK")
        sys.exit(1 if problems else 0)
    if "--test" in args:
        token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
        tg = Telegram(token, os.environ.get("TELEGRAM_CHAT_ID", ""), pages_url=os.environ.get("PAGES_URL", ""),
                      langs=fetch_subscribers(token)[1])
        tg.send(lambda lang: i18n.t(lang, "test"), button=True)
        print("Test message sent")
        return
    if "--loop" in args:
        i = args.index("--loop")
        minutes = float(args[i + 1]) if i + 1 < len(args) and args[i + 1].replace(".", "", 1).isdigit() \
            else float(os.environ.get("INTERVAL_MINUTES", "5"))
        sync = "--git-sync" in args or os.environ.get("GIT_SYNC", "").lower() in ("1", "yes", "true")
        max_hours = float(os.environ.get("LOOP_HOURS", "0") or 0)
        loop(minutes, sync, max_hours)
        return
    run(dry="--dry-run" in args)


if __name__ == "__main__":
    main()
