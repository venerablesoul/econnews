#!/usr/bin/env python3
"""
Economic news -> Telegram (English by default, Russian for readers who chose /lang ru).

Every run:
  1. downloads the RSS feeds from sources.py,
  2. picks economically significant stories and scores their importance,
  3. removes duplicates (one story from several sources = one story),
  4. sends what is new to Telegram, each reader in their language,
  5. in the morning (9:00 MSK) — overnight highlights and today's calendar,
     in the evening (21:00 MSK) — the day in review and tomorrow's calendar,
  6. reminds about key data (inflation, rates, jobs) an hour before release,
  7. reports at once when a source stops responding (and when it is back),
  8. sends large trades of US politicians and company insiders (trades.py).

Python 3.9+ standard library only. Optional: matplotlib (the chart picture)
and pdfplumber (reading US House trade reports).

Environment variables:
  TELEGRAM_BOT_TOKEN   bot token from @BotFather                      (required)
  TELEGRAM_CHAT_ID     your chat id — the bot owner                   (required)
  WORKER_URL           the bot server address (normally read from docs/config.json);
                       news go to the owner and everyone who pressed /start
  MIN_LEVEL            high | medium (default medium) — what to send
  DIGEST_HOUR          hour of the evening digest, MSK (21), -1 = off
  QUIET_HOURS          silent hours, MSK, e.g. 0-8 (default 0-8)
  MORNING_HOUR         hour of the morning digest, MSK (9), -1 = off
  SUMMARIES            yes/no — a 1–2 sentence summary under the headline
  TAGS                 yes/no — tags #oil #Fed ...
  TRANSLATE            yes/no — translate headlines into the other language (Google, then MyMemory)
  CALENDAR             yes/no — economic calendar and reminders
  CAL_COUNTRIES        calendar currencies/countries (USD,EUR,CNY,GBP,JPY)
  REMIND_MINUTES       how many minutes before an event to remind (60), 0 = never
  ALERTS               yes/no — alerts about broken sources
  FRED_API_KEY         free FRED key — actual numbers for released US data (GitHub secret)
  TRADES               yes/no — trades of US politicians and insiders (trades.py)
  CONGRESS_MIN         send politicians' trades from this amount, $ (15000)
  INSIDER_MIN_BUY      send insider buys from this amount, $ (250000)
  INSIDER_MIN_SELL     send insider sales from this amount, $ (10000000)
  STATE_FILE           path to the state file (state.json)

Running by hand:
  python news_bot.py             a normal run
  python news_bot.py --dry-run   send nothing, print to the console
  python news_bot.py --test      send a test message to Telegram
  python news_bot.py --loop 5    run continuously, checking every 5 minutes
  python news_bot.py --loop 5 --git-sync   the same + push the data to GitHub (for the terminal)
  LOOP_HOURS=5.5 python news_bot.py --loop 10 --git-sync   a loop that stops by itself after 5.5 h
  python news_bot.py --selfcheck  offline check that this code works (no network, nothing sent); exit code 0 = fine

Keeping itself alive (see loop()): new code from GitHub is taken only if it passes the self-check, a hung run is
restarted, one failing part of a run does not stop the others, and the owner hears only about what the bot cannot fix
by itself. On GitHub Actions each ~5.5-hour session queues the next one (relay.py, news.yml, keepalive.yml).

Variables can go into a .env file next to the bot (see .env.example).
"""
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
# a browser User-Agent: some official sites (bls.gov, imf.org) answer 403 to "bots"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
MAX_AGE_HOURS = 12          # older stories are not sent
MAX_PER_MESSAGE_BATCH = 25  # at most this many stories per run
KEEP_DAYS = 3               # how long history is kept in state.json
DOWN_AFTER_HOURS = 3        # a source that fails this long in a row is "down" (the owner hears once, and when it is back)
LOOP_MINUTES = 0.0          # minutes between runs in --loop mode (0 = single runs from a schedule, ~30 min apart)


def down_after():
    """Failed runs in a row that make a source "down": ~DOWN_AFTER_HOURS whatever the interval between runs
    (it used to be a fixed 6 runs, which in the 5-minute loop meant 30 minutes, not the 3 hours the message says)."""
    every = LOOP_MINUTES if LOOP_MINUTES > 0 else 30.0
    return max(2, int(round(DOWN_AFTER_HOURS * 60 / every)))


def all_down_after():
    """Runs in a row with no source answering before the owner hears (~15 minutes: a short network blip passes)."""
    every = LOOP_MINUTES if LOOP_MINUTES > 0 else 30.0
    return max(1, int(round(15 / every)))


CODE_SHA = ""               # the git commit this process runs (set by loop(); recorded in state.json as "code_ok")

# ----------------------------------------------------------------------------
# Keywords. English ones match whole words, Russian ones match the word stem.
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
# Tags (#oil #Fed ...), stored in English and shown in the reader's language (i18n.TAGS_RU).
# English words match whole words ("*" at the end = prefix); Russian words match by stem.
# Order = priority, at most 3 tags per story.
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
    """Returns (points, whether the headline has economic words)."""
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
    """Only ordinary web links (http/https) leave the feed: anything else (javascript:, data:, ...) is dropped."""
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
        # a common feed defect — unescaped &
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
    except Exception as e:  # network, 403, broken XML — the source is just skipped
        return src, [], f"{type(e).__name__}: {e}"[:200]


# ----------------------------------------------------------------------------
# Selection, scoring, de-duplication
# ----------------------------------------------------------------------------
GN_SUFFIX = re.compile(r"\s+[-–—]\s+(Reuters|Bloomberg(?:\.com)?|Bloomberg News|BNN Bloomberg)\s*$", re.I)
# every Google News story ends with " - Publication name"
GN_ANY_SUFFIX = re.compile(r"\s+[-–—]\s+[^-–—]{2,60}$")

# Not economics, even though "market", "growth" etc. appear in the headline
# (crime stories that mention a market place, medical "growth", and so on).
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


LEAD_MAX = 230  # length of the summary under the headline


def make_lead(title: str, summary: str, link: str) -> str:
    """The first 1–2 sentences of the teaser, if they add something to the headline."""
    if not summary or "news.google.com" in (link or ""):
        return ""  # Google News teasers only repeat the headline
    s = re.sub(r"\s*(Continue reading|Read more|Читать далее)\W*$", "", summary, flags=re.I).strip()
    s = re.sub(r"\s*The post .{0,200} appeared first on .*$", "", s).strip()
    if len(s) < 40:
        return ""
    t_toks, s_toks = norm_tokens(title), norm_tokens(s)
    if s_toks and len(s_toks - t_toks) < 4:
        return ""  # the teaser almost repeats the headline
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
        return None  # "Markets", "Economy" are section titles, not stories
    if src.get("categories") and it["categories"]:
        if not any(c in src["categories"] for c in it["categories"]):
            return None
    kw, title_hit = score_text(title, it["summary"])
    kind = src["kind"]
    if kind != "official" and kw < 3 and NOISE.search(title):
        return None  # an incident with a random "economic" word
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
            except Exception as e:   # one odd story must not stop every run until it ages out
                print(f"  ! {src['name']}: skipped a story ({type(e).__name__}: {e})"[:200])
                continue
            if ev:
                candidates.append(ev)
    # a source counts as "down" only if none of its feeds answered
    errors = {k: v for k, v in errors.items() if k not in ok_names}
    return candidates, errors


def merge_duplicates(items):
    """Merges one story from different sources. Every extra source adds +1 to importance."""
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
                    m["lead"] = it["lead"]  # take the summary from whoever has one
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
    # a damaged field would otherwise break every run: it starts over instead
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
# Translation (free, no keys): English stories get a Russian version, Russian stories
# an English one. Google Translate first, MyMemory as a fallback; if both fail the story
# simply stays in its original language.
# ----------------------------------------------------------------------------
GT_URL = "https://translate.googleapis.com/translate_a/single"
MM_URL = "https://api.mymemory.translated.net/get"
CYRILLIC = re.compile(r"[а-яё]", re.IGNORECASE)
_tr_cache: dict = {}


def _env_on(name, default):
    return os.environ.get(name, default).strip().lower() in ("1", "yes", "true", "on")


TRANSLATE_ON = os.environ.get("TRANSLATE", "yes").strip().lower() not in ("off", "none", "no", "0", "false")


def _google(text, src, lang):
    q = urllib.parse.urlencode({"client": "gtx", "sl": src, "tl": lang, "dt": "t", "q": text})
    req = urllib.request.Request(f"{GT_URL}?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read().decode("utf-8"))
    out = "".join(seg[0] for seg in data[0] if seg and seg[0])
    return out.strip() or None


def _mymemory(text, src, lang):
    q = urllib.parse.urlencode({"q": text[:480], "langpair": f"{src}|{lang}"})
    req = urllib.request.Request(f"{MM_URL}?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read().decode("utf-8"))
    out = (data.get("responseData") or {}).get("translatedText") or ""
    if data.get("responseStatus") not in (200, "200") or "MYMEMORY WARNING" in out.upper():
        return None
    return html.unescape(out).strip() or None


def orig_lang(text):
    return "ru" if CYRILLIC.search(text or "") else "en"


def translate(text, lang="ru"):
    """Translation into lang ('ru' or 'en'); None if the text is already in that language or translation failed."""
    if not text or not TRANSLATE_ON or lang not in ("ru", "en"):
        return None
    src = orig_lang(text)
    if src == lang:
        return None
    key = (text, lang)
    if key in _tr_cache:
        return _tr_cache[key]
    result = None
    for engine in (_google, _mymemory):
        try:
            result = engine(text, src, lang)
        except Exception:
            result = None
        if result and result.lower() != text.lower():
            break
        result = None
    _tr_cache[key] = result
    return result


def translate_items(items):
    """Adds title_<lang>/lead_<lang> in the other language to stories that lack them (4 threads)."""
    if not TRANSLATE_ON:
        return
    jobs = []
    for it in items:
        target = "en" if orig_lang(it["title"]) == "ru" else "ru"
        if not it.get("title_" + target):
            jobs.append((it, "title", "title_" + target, target))
        if SUMMARIES and it.get("lead") and not it.get("lead_" + target):
            jobs.append((it, "lead", "lead_" + target, target))
    if not jobs:
        return
    with ThreadPoolExecutor(max_workers=4) as ex:
        for (it, src, dst, target), tr in zip(jobs, ex.map(lambda j: translate(j[0][j[1]], j[3]), jobs)):
            if tr:
                it[dst] = tr


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
SUMMARIES = _env_on("SUMMARIES", "yes")   # 1–2 sentence summary under the headline
SHOW_TAGS = _env_on("TAGS", "yes")        # tags #oil #Fed ...
TERMINAL_BUTTON = _env_on("TERMINAL_BUTTON", "yes")  # "Terminal" button under messages


def ai_sum(it, lang):
    """The AI one-liner in the reader's language. Older notes had only a Russian "sum" (no "sum_ru")."""
    ai = it.get("ai") or {}
    if "sum_ru" not in ai:
        return ai.get("sum", "") if lang == "ru" else ""
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
    """"Top" / "Also" blocks instead of one long list."""
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
    """A block longer than one message (a long calendar, say) is cut at line ends: Telegram refuses a message over
    4096 characters, and such a refusal would come back on every run."""
    if len(block) <= limit:
        return [block]
    out, cur = [], ""
    for line in block.split("\n"):
        while len(line) > limit:   # not expected: every line here is one story or one event
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
    """True for a failure that may pass by itself (network, Telegram busy or down) — worth repeating on the next run.
    False for one that would repeat forever: Telegram refusing the message itself (400…) or a bug in the bot."""
    if isinstance(e, TelegramError):
        return e.code == 429 or e.code >= 500
    if isinstance(e, (urllib.error.URLError, TimeoutError, ConnectionError)):
        return True
    return isinstance(e, RuntimeError) and "unreachable" in str(e)


def per_lang(fn):
    """Wraps fn(lang) so it is computed once per language."""
    cache = {}

    def get(lang):
        if lang not in cache:
            cache[lang] = fn(lang)
        return cache[lang]
    return get


class Telegram:
    """Sends to the owner (TELEGRAM_CHAT_ID) and everyone who pressed /start
    (the bot server keeps the subscriber list, see worker/). Each person gets their language (/lang)."""

    def __init__(self, token, chat_id, dry=False, pages_url="", subscribers=(), langs=None, owner_off=False):
        self.token, self.chat_id, self.dry = token, str(chat_id).strip(), dry
        self.owner_off = owner_off  # the owner pressed «Turn news off» in the bot
        self.pages_url = pages_url
        self.subscribers = [str(x) for x in dict.fromkeys(subscribers or []) if str(x) != self.chat_id]
        self.langs = {str(k): i18n.norm_lang(v) for k, v in (langs or {}).items()}
        self.gone = set()          # blocked the bot or deleted the chat — removed from subscribers
        self.no_webapp = set()     # chats where web_app buttons do not work
        self.sent = 0              # messages sent this run (so state is saved right away)

    def lang_of(self, chat):
        return self.langs.get(str(chat)) or i18n.DEFAULT

    def recipients(self, owner_only=False):
        # service notices (owner_only) still reach the owner; the news mailing respects «off»
        out = [self.chat_id] if self.chat_id and (owner_only or not self.owner_off) else []
        if not owner_only:
            out += [c for c in self.subscribers if c not in self.gone]
        return out

    def _markup(self, chat):
        lang = self.lang_of(chat)
        rows = []
        if self.pages_url:
            q = "?lang=ru" if lang == "ru" else ""
            # web_app buttons (open the page inside Telegram) only work in private chats
            webapp = not str(chat).startswith("-") and chat not in self.no_webapp

            def mk(text, url):
                return {"text": text, "web_app": {"url": url}} if webapp else {"text": text, "url": url}
            row = [mk(i18n.t(lang, "btn_market"), self.pages_url + q)]
            if TERMINAL_BUTTON:
                row.append(mk(i18n.t(lang, "btn_terminal"), self.pages_url.rstrip("/") + "/terminal/" + q))
            rows.append(row)
        # back to the bot's main menu (the bot server answers the "menu" button)
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
                self.no_webapp.add(chat)             # retry with plain links
                f["reply_markup"] = self._markup(chat)
                return self._call(method, f, files)
            if chat != self.chat_id and (e.code == 403 or (e.code == 400 and "chat not found" in low)):
                self.gone.add(chat)                  # the user blocked the bot
                return None
            raise

    def _broadcast(self, method, make, button, owner_only):
        """Sends to every recipient in their language. make(lang) -> (fields, files).
        One failed chat does not stop the others; raises only if nothing was delivered."""
        targets = self.recipients(owner_only)
        delivered, last_err = 0, None
        prepared = {}
        for k, chat in enumerate(targets):
            lang = self.lang_of(chat)
            if lang not in prepared:
                prepared[lang] = make(lang)
            fields, files = prepared[lang]
            if fields is None:
                continue      # nothing to send in this language (e.g. the picture failed to render)
            try:
                res = self._deliver(chat, method, fields, button(lang) if callable(button) else button, files)
                if res is not None:
                    delivered += 1
                    if files and method == "sendPhoto":
                        # upload the picture once per language, then reuse its file_id
                        photo = (res.get("photo") or [{}])[-1].get("file_id")
                        if photo:
                            prepared[lang] = (dict(fields, photo=photo), None)
            except Exception as e:
                last_err = e
                print(f"  ! Telegram, chat {chat}: {e}"[:300])
            if k and len(targets) > 20:
                time.sleep(0.04)   # stay under ~25 messages per second
        if delivered:
            self.sent += 1
        if targets and not delivered and last_err:
            raise last_err

    def _langs_in_use(self, owner_only):
        return sorted({self.lang_of(c) for c in self.recipients(owner_only)}) or [i18n.DEFAULT]

    def send(self, text, silent=False, button=False, owner_only=False):
        """text: a string or a function lang -> string (None = nothing for that language).
        button: bool or a function lang -> bool."""
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
        """make_msgs(lang) -> list of messages; the button goes under the last message of each language."""
        msgs = per_lang(make_msgs)
        langs = self._langs_in_use(owner_only)
        total = max((len(msgs(l)) for l in langs), default=0)
        for k in range(total):
            self.send(lambda lang, k=k: msgs(lang)[k] if k < len(msgs(lang)) else None, silent=silent,
                      button=(lambda lang, k=k: bool(button) and k == len(msgs(lang)) - 1), owner_only=owner_only)

    def send_photo(self, png, caption, silent=False, button=True, owner_only=False):
        """png and caption: values or functions lang -> value (png may be None to skip that language)."""
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
# Subscribers: the bot server (worker/) keeps the list; here we only read it
# ----------------------------------------------------------------------------
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs", "config.json")
_SUBS_CACHE = None   # last list received — in case the server is down for a minute
OWNER_OFF = False    # the owner switched the news off in the bot (from /subs)


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
    # same formula as in worker/src/lib.js
    return hashlib.sha256(("econnews-sync:" + token).encode()).hexdigest()


def fetch_subscribers(token):
    """(subscriber ids, {chat id: language}) from the bot server."""
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
# Markets: quotes, picture, data for the "Markets" page and the terminal
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
    except Exception as e:  # no matplotlib or something else went wrong — no picture
        print(f"  ! picture not rendered: {type(e).__name__}: {e}")
        return None


def page_calendar(st, now):
    """Calendar events 7 days ahead (and one day back) for the terminal, names in both languages."""
    events = (st.get("calendar") or {}).get("events") or []
    lo, hi = (now - timedelta(days=1)).isoformat(), (now + timedelta(days=7)).isoformat()
    out = []
    try:
        import econ_calendar as cal
        for e in events:
            if e["impact"] not in ("High", "Medium") or not (lo <= e["ts"] <= hi):
                continue
            item = {**e, "title_ru": cal.ru_name(e), "flag": cal.FLAGS.get(e["country"], "")}
            act = (st.get("cal_actuals") or {}).get(cal.event_id(e))
            if act:
                item["actual"] = act
            out.append(item)
    except Exception:
        return []
    out.sort(key=lambda e: e["ts"])
    return out[:200]


def page_news_item(r):
    """A story for the terminal: original headline and its translation, summary, tags, company tickers, AI note."""
    item = {"title": r["title"], "lang": orig_lang(r["title"]), "lead": r.get("lead") or "",
            "tags": [i18n.TAGS_FROM_RU.get(t, t) for t in r.get("tags", [])],
            "sources": [i18n.SOURCES_FROM_RU.get(x, x) for x in r["sources"]],
            "link": r["link"], "level": level_of(r["score"]), "ts": r["ts"]}
    for k in ("title_ru", "title_en", "lead_ru", "lead_en"):
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
    """docs/data.json — read by the Markets page and the terminal."""
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
    # every source failing at once is the runner's network, not the sources: the owner hears only if it lasts
    all_down = len(errors) == len({s["name"] for s in SOURCES})
    st["all_down_streak"] = (int(st.get("all_down_streak") or 0) + 1) if all_down else 0

    # drop what we have already seen and what looks like something already sent
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
    to_send.sort(key=lambda s: s["ts"], reverse=True)   # newest first...
    to_send.sort(key=lambda s: -s["score"])              # ...but important ones on top

    # translate only what is actually going out (it also lands in the terminal)
    translate_items(to_send[:MAX_PER_MESSAGE_BATCH])
    try:
        import ai
        if ai.enabled():
            ai.annotate([s for s in to_send if level_of(s["score"]) == "high"])
    except Exception as e:
        print(f"  ! AI notes: {type(e).__name__}: {e}"[:200])

    # remember everything seen (even unimportant) so it is never sent twice
    for s in stories:
        for i in s["_ids"]:
            st["seen"][i] = now.isoformat()
        rec = {"title": s["title"], "link": s["link"], "sources": s["sources"],
               "score": s["score"], "ts": now.isoformat()}
        keep = (("title_ru", "title_en", "lead", "lead_ru", "lead_en", "tags", "ai")
                if level_of(s["score"]) != "low" else ("title_ru", "title_en"))
        for k in keep:
            if s.get(k):
                rec[k] = s[k]
        st["recent"].append(rec)

    silent = in_quiet_hours(now_msk, quiet)
    stamp = now_msk.strftime("%d.%m %H:%M")

    def market_html(lang):
        m = mline(lang)
        return f"\n<i>📊 {html.escape(m)}</i>" if m else ""

    # Every part below stands on its own: when one fails (a message Telegram refuses, a bug in one feature), the rest
    # still goes out and the state is still saved. Otherwise the same failure came back on every run, and whatever
    # had already gone out was sent again each time. A part that failed for a moment (Telegram unreachable) and
    # sent nothing is tried again on the next run; one that cannot work (a bug) is reported to the owner once a day.
    trouble = []
    today = now_msk.strftime("%Y-%m-%d")

    def failed(part, e, before):
        """Logs a failed part. True = it is done anyway (something went out, or repeating cannot help)."""
        trouble.append(part)
        print(f"  ! {part}: {type(e).__name__}: {e}"[:300])
        if _retry_later(e):
            return tg.sent > before
        notes = st.get("notices")
        if not isinstance(notes, dict):
            notes = st["notices"] = {}
        if notes.get("part:" + part) != today:   # the owner hears about a broken part once a day
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
        st["last_digest"] = today                          # the evening digest starts tomorrow
        st["last_morning"] = today
    elif to_send:
        before = tg.sent
        try:
            extra = len(to_send) - MAX_PER_MESSAGE_BATCH
            batch = to_send[:MAX_PER_MESSAGE_BATCH]
            n_high = sum(level_of(s["score"]) == "high" for s in batch)
            # important news make a sound even at night
            tg.send_multi(lambda lang: split_messages(
                i18n.t(lang, "batch_head", stamp=stamp) + market_html(lang),
                sectioned(batch, lang) + ([i18n.t(lang, "more_on_page", n=extra)] if extra > 0 else [])),
                silent=silent and n_high == 0)
        except Exception as e:
            if tg.sent == before and _retry_later(e):
                raise   # nothing went out and Telegram may answer in a minute: the run is repeated, the news stay new
            failed("news", e, before)

    # calendar: the week's key events (cached in state.json)
    events = []
    if use_calendar:
        try:
            import econ_calendar as cal
            events = cal.get_events(st, now, cal_countries)
        except Exception as e:
            print(f"  ! calendar: {type(e).__name__}: {e}")
            events = []

    # reminders REMIND_MINUTES before an event
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

    # actual numbers for released US data (from FRED, needs the free key FRED_API_KEY)
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
                    continue  # not published yet — check next run
                actuals[cal.event_id(e)] = a
                released.append((e, a))
            if released:
                tg.send(lambda lang: i18n.t(lang, "released_head") + "\n" + "\n".join(
                    cal.fmt_released(e, a, lang, translate) for e, a in released), silent=silent)
            if len(actuals) > 300:
                st["cal_actuals"] = dict(list(actuals.items())[-300:])
        except Exception as e:
            failed("released data", e, before)

    # morning digest: overnight highlights + today's events
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

    # alerts about broken sources (service messages — owner only)
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

    # trades of US politicians and company insiders (official disclosures, no keys)
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

    # picture with market charts (by default at 9 and 21 MSK)
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

    # evening digest
    if digest_hour >= 0 and now_msk.hour >= digest_hour and st["last_digest"] != today:
        before = tg.sent
        try:
            day_ago = (now - timedelta(hours=24)).isoformat()
            day = [r for r in st["recent"] if r["ts"] >= day_ago and level_of(r["score"]) != "low"]
            day.sort(key=lambda r: -r["score"])
            top = day[:10]
            translate_items(top)   # the translation is also kept in state.json
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
        st["code_ok"] = {"sha": CODE_SHA, "at": now.isoformat()}   # the last code that got through a run (see news.yml)
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
    """Terminal data that does not depend on news: US companies (stocks.json, co/, opt/), rates, macro, MOEX."""
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
    for mod, label in (("company", "company files"), ("options", "option chains"), ("macro", "macro"), ("moex", "MOEX"),
                       ("ipo", "IPO"), ("wpe", "world valuations"), ("auctions", "Treasury auctions")):
        try:
            n = __import__(mod).build(now)
            if n:
                parts.append(f"{label}: {n}")
        except Exception as e:
            print(f"  ! {label} ({mod}.py): {type(e).__name__}: {e}"[:200])
    return (", ".join(parts) + ", ") if parts else ""


def push_live(token, now):
    """Fresh news to the bot server: the terminal shows them at once, without waiting for the site to rebuild."""
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
    """Reads the .env file (KEY=value) next to the bot. Variables that are already set are kept."""
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


# what the bot writes: only it changes these files
DATA_PATHS = ("state.json", "docs/data.json", "docs/stocks.json", "docs/rates.json", "docs/fin", "docs/co", "docs/opt",
              "docs/options.json", "docs/macro.json", "docs/moex.json", "docs/ipo.json", "docs/wpe.json",
              "docs/auctions.json")
# The data does not go into main: the whole site (docs/ — its code from main plus the data) and state.json are
# pushed as ONE commit that replaces the data branch each time. main keeps only code, and the data branch never
# grows a history. GitHub Pages serves the site from that branch (Settings → Pages → gh-pages, folder /docs).
DATA_BRANCH = "gh-pages"
SITE_PATHS = ("docs", "state.json")
_published = {}   # branch -> the last tree pushed by this process (to skip pushes when nothing changed)


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
    """Server mode.
    pull — new code from GitHub (main); on a fresh checkout also the bot's latest data from the data branch.
           The bot's own data files are never touched by the pull.
           code=False: the data part only (a session that runs the last version that worked, see news.yml);
           skip: commits known not to start — while main is at one of them, the code stays as it is.
    push — the site and state.json as one commit, force-pushed to the data branch (no commits to main)."""
    import shutil
    import subprocess
    import tempfile

    branch = os.environ.get("DATA_BRANCH", "").strip() or DATA_BRANCH

    def git(*a, env=None, stdin=None):
        return subprocess.run(["git", "-C", repo, *a], capture_output=True, text=True, timeout=120, env=env, input=stdin)

    def heal():
        # a rebase that stopped half-way leaves HEAD detached and blocks every later pull and push
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
                _copy_data(repo, tmp)   # the bot's data is safe here whatever the pull does
                for f in DATA_PATHS:
                    git("checkout", "-q", "HEAD", "--", f)   # data still tracked in main: back to HEAD, so no clash
                r = git("pull", "--rebase", "--autostash", "-q")
                if r.returncode:
                    print("  ! git pull:", (r.stderr or r.stdout).strip()[:300])
                    heal()
                    # e.g. old data commits of the bot that clash with main: take GitHub's main (the data is in tmp)
                    if git("fetch", "-q", "origin").returncode == 0:
                        git("reset", "-q", "--hard", "@{upstream}")
                _copy_data(tmp, repo)
            # a fresh checkout (GitHub Actions) has no state.json, or only the old copy committed to main:
            # then the bot's latest data comes from the data branch. A bot that already runs here keeps its own.
            state = os.path.join(repo, "state.json")
            fresh = not os.path.exists(state) or (
                git("ls-files", "--error-unmatch", "state.json").returncode == 0
                and git("diff", "--quiet", "HEAD", "--", "state.json").returncode == 0)
            if fresh:
                _pull_data(git, repo, branch, os.path.join(tmp, "index"))
            return

        # push: a temporary index, so main's own index and working tree stay as they are
        if not os.path.exists(os.path.join(repo, "state.json")):
            # the data was never restored here (a session that ended before its first run, or was cancelled while
            # setting up): pushing now would replace the data branch with the bare site and lose the bot's memory
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
            return  # nothing changed since the last push
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
    """The bot's data from the data branch into the working folder (only DATA_PATHS; the code stays main's)."""
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
    """Fingerprint of the bot code (*.py in the folder): if it changed after git pull, it is time to restart."""
    h = hashlib.sha1()
    for name in sorted(os.listdir(repo)):
        if name.endswith(".py"):
            with open(os.path.join(repo, name), "rb") as f:
                h.update(name.encode() + b"\0" + f.read())
    return h.hexdigest()


def restart(deadline, why):
    """Starts this process over with the code now on disk. The loop deadline (GitHub Actions) is kept."""
    if deadline:
        os.environ["LOOP_DEADLINE"] = str(deadline)
    print(why, flush=True)
    sys.stderr.flush()
    if os.name == "nt":
        # on Windows exec starts a separate process and this one ends: deploy/start_windows.bat would then start
        # a second bot. Ending here lets the .bat start exactly one new copy.
        os._exit(75)
    try:
        os.execv(sys.executable, [sys.executable] + sys.argv)
    except OSError as e:   # cannot start over in place: end the process (systemd, the .bat or the next session restart it)
        print(f"  ! could not restart: {e}", flush=True)
        os._exit(75)


def reload_self(deadline):
    """Restarts the process with the new code. The loop deadline (for GitHub Actions) is kept."""
    restart(deadline, "The bot code changed on GitHub — restarting with the new version.")


# ----------------------------------------------------------------------------
# Keeping itself alive: safe code updates, a hang watchdog, the owner hears only what the bot cannot fix
# ----------------------------------------------------------------------------
HANG_MINUTES = float(os.environ.get("HANG_MINUTES", "30") or 30)   # one run normally takes 1–3 minutes
FAIL_ALERT_MINUTES = 30     # runs failing this long in a row (and at least 3 of them) — the owner hears, once
RELAY_EVERY = 30 * 60       # how often a GitHub Actions session checks that the next session is queued


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
    except Exception as e:   # the relay is a helper: the bot runs without it
        print(f"  ! relay.py: {type(e).__name__}: {e}"[:200])
        return None


def _last_line(text):
    lines = [x.strip() for x in (text or "").splitlines() if x.strip()]
    failed = [x for x in lines if x.startswith("SELF-CHECK FAILED")]
    return (failed or lines or ["no details"])[-1].replace("SELF-CHECK FAILED:", "").strip()


def selfcheck_in(repo, timeout=300):
    """The self-check of the code now in `repo`, in a separate process. (ok, the end of its output)."""
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
    """The code back to commit `sha`; the bot's data files stay as they are."""
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
    """True the first time `value` comes for `key`. Kept in state.json, so the next session remembers it too
    (call it only after the first git_sync pull: before it a fresh checkout has no state.json yet)."""
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
    """A service message to the owner only, in their language (quiet at night). True if it went out."""
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
    """The owner hears once per broken commit."""
    if not sha or not notice_once("bad_code", sha):
        return
    err = _last_line(report)[:300]
    notify_owner(lambda lang: i18n.t(lang, "code_rejected", sha=sha[:7], err=html.escape(err)))


def update_code(repo, start_hash, deadline, bad, pinned=False, auto_reload=True):
    """New code from GitHub. The bot restarts with it only if it passes the self-check; code that does not is put back
    to the version that runs, remembered (not tried again until main moves on) and reported to the owner once."""
    if pinned:
        git_sync("pull", repo, code=False)   # this session runs the last version that worked (news.yml): data only
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
        os.environ["BOT_BAD_CODE"] = ",".join(sorted(bad))   # kept if this process restarts
        report_bad_code(after, report)


class Watchdog:
    """Restarts the bot when one run hangs (a download that never ends, say). A run normally takes 1–3 minutes."""

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
                except BaseException as e:   # never let the watchdog thread die
                    print(f"  ! watchdog: {type(e).__name__}: {e}", flush=True)


def selfcheck():
    """Offline check that this copy of the bot works: every module compiles and imports, and two whole runs go through
    on made-up news — no network, nothing is sent. Runs before new code replaces the running one (update_code) and
    at the start of every GitHub Actions session (news.yml). Returns the problems found ([] = fine)."""
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
        nb = importlib.import_module("news_bot")   # the module, not this script (__main__)
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
                   "DIGEST_HOUR": "0", "MORNING_HOUR": "-1", "CALENDAR": "no", "TRADES": "no", "ANTHROPIC_API_KEY": "",
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
    """Loop: a run every `minutes` minutes. A failed run does not stop the bot.
    max_hours > 0 — stop after that many hours (for GitHub Actions, where a job lives up to 6 h).
    With --git-sync the bot picks up new code itself: after git pull it restarts if any *.py changed —
    but only with code that passes the self-check; otherwise it stays on the version that works.
    On GitHub Actions (relay.py) each session also queues the next one and stops when the workflow is disabled."""
    global LOOP_MINUTES, CODE_SHA
    LOOP_MINUTES = float(minutes)
    repo = os.path.dirname(os.path.abspath(__file__))
    try:
        deadline = float(os.environ["LOOP_DEADLINE"])
    except (KeyError, ValueError):
        deadline = time.time() + max_hours * 3600 if max_hours > 0 else None
    auto_reload = os.environ.get("AUTO_RELOAD", "yes").strip().lower() not in ("0", "no", "off", "false")
    pinned = os.environ.get("BOT_PINNED", "").strip()          # news.yml: main fails its self-check, this is the last good
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
            # the site (GitHub Pages) rebuilds on every push — so not more than every ~10 minutes,
            # but at once if something went to Telegram (so a crash cannot make it send the same again)
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
