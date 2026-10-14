#!/usr/bin/env python3
"""
Экономические новости -> Telegram.

Каждый запуск:
  1. скачивает RSS-ленты из sources.py,
  2. отбирает экономически значимые новости и оценивает важность,
  3. убирает дубли (одна история из нескольких источников = одна новость),
  4. присылает новое в Telegram,
  5. утром (9:00 МСК) — главное за ночь и календарь событий дня,
     вечером (21:00 МСК) — итоги дня и календарь на завтра,
  6. напоминает о важных данных (инфляция, ставки, занятость) за час до выхода,
  7. сразу сообщает, если источник перестал отвечать (и когда снова заработал),
  8. присылает крупные сделки политиков США и инсайдеров компаний (trades.py).

Только стандартная библиотека Python 3.9+. Необязательно: matplotlib (картинка с графиками)
и pdfplumber (чтение отчётов о сделках Палаты представителей США).

Переменные окружения:
  TELEGRAM_BOT_TOKEN   токен бота от @BotFather            (обязательно)
  TELEGRAM_CHAT_ID     ваш chat id — владелец бота           (обязательно)
  WORKER_URL           адрес сервера бота (обычно берётся из docs/config.json сам);
                       новости получают владелец и все, кто нажал /start
  MIN_LEVEL            high | medium (по умолчанию medium) — что присылать
  DIGEST_HOUR          час дневной сводки по МСК (21), -1 = выключить
  QUIET_HOURS          часы без звука по МСК, например 0-8 (по умолчанию 0-8)
  MORNING_HOUR         час утреннего дайджеста по МСК (9), -1 = выключить
  SUMMARIES            yes/no — выжимка в 1–2 предложения под заголовком
  TAGS                 yes/no — теги #нефть #ФРС ...
  CALENDAR             yes/no — экономический календарь и напоминания
  CAL_COUNTRIES        валюты/страны календаря (USD,EUR,CNY,GBP,JPY)
  REMIND_MINUTES       за сколько минут напоминать о событии (60), 0 = не напоминать
  ALERTS               yes/no — оповещения о сбоях источников
  FRED_API_KEY         бесплатный ключ FRED — факт по вышедшим данным США (секрет GitHub)
  TRADES               yes/no — сделки политиков США и инсайдеров (trades.py)
  CONGRESS_MIN         присылать сделки политиков от этой суммы, $ (15000)
  INSIDER_MIN_BUY      присылать покупки инсайдеров от этой суммы, $ (250000)
  INSIDER_MIN_SELL     присылать продажи инсайдеров от этой суммы, $ (10000000)
  STATE_FILE           путь к файлу состояния (state.json)

Запуск вручную:
  python news_bot.py             обычный запуск
  python news_bot.py --dry-run   ничего не отправлять, напечатать в консоль
  python news_bot.py --test      отправить тестовое сообщение в Telegram
  python news_bot.py --loop 5    работать постоянно, проверка каждые 5 минут
  python news_bot.py --loop 5 --git-sync   то же + отправлять данные на GitHub (для терминала)
  LOOP_HOURS=5.5 python news_bot.py --loop 10 --git-sync   цикл, который сам завершится через 5,5 ч

Переменные можно положить в файл .env рядом с ботом (см. .env.example).
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
# браузерный User-Agent: часть официальных сайтов (bls.gov, imf.org) отвечает 403 «ботам»
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
MAX_AGE_HOURS = 12          # новости старше не присылаем
MAX_PER_MESSAGE_BATCH = 25  # не больше стольких новостей за один запуск
KEEP_DAYS = 3               # сколько хранить историю в state.json
DOWN_AFTER = 6              # столько неудачных запусков подряд (~3 ч) = источник «упал»

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


# ----------------------------------------------------------------------------
# Теги (#нефть #ФРС ...). Английские слова — целиком, со «*» на конце — по началу
# слова; русские — по основе. Порядок = приоритет, у новости не больше 3 тегов.
# ----------------------------------------------------------------------------
TAG_RULES = [
    ("ФРС", ["fed", "feds", "federal reserve", "fomc", "powell", "warsh", "фрс"]),
    ("ЕЦБ", ["ecb", "lagarde", "ецб", "лагард"]),
    ("ЦБРФ", ["bank of russia", "nabiullina", "цб рф", "банк росси", "набиуллин", "ключев"]),
    ("ставки", ["rate cut*", "rate hike*", "interest rate*", "key rate", "rate decision", "monetary policy", "ставк"]),
    ("инфляция", ["inflation*", "cpi", "pce", "deflation", "инфляц", "дефляц"]),
    ("нефть", ["oil", "crude", "brent", "wti", "opec", "opec+", "нефт", "опек"]),
    ("газ", ["natural gas", "lng", "gas prices", "газа", "газу", "газом", "газов", "спг"]),
    ("золото", ["gold", "bullion", "золот"]),
    ("рубль", ["ruble*", "rouble*", "рубл"]),
    ("доллар", ["dollar*", "greenback", "доллар"]),
    ("облигации", ["bond*", "yield*", "treasur*", "gilt*", "облигац", "офз", "доходност"]),
    ("рынки", ["stocks", "shares", "equities", "s&p", "nasdaq", "dow", "selloff", "sell-off", "rally", "акци", "мосбирж", "биржев"]),
    ("Китай", ["china", "chinese", "pboc", "yuan", "beijing", "китай", "юан", "пекин"]),
    ("пошлины", ["tariff*", "trade war", "пошлин", "торгов войн"]),
    ("санкции", ["sanction*", "санкци"]),
    ("занятость", ["payrolls", "jobs", "unemployment", "jobless", "labor market", "labour market", "безработиц", "занятост"]),
    ("ВВП", ["gdp", "recession", "ввп", "рецесси"]),
    ("крипта", ["bitcoin", "crypto*", "ethereum", "биткоин", "крипто"]),
    ("Россия", ["russia*", "росси", "минфин", "росстат"]),
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
# у любой новости из Google News в конце « - Название издания»
GN_ANY_SUFFIX = re.compile(r"\s+[-–—]\s+[^-–—]{2,60}$")

# Не экономика, хотя в заголовке попалось «market», «growth» и т. п.
# («Боевики убили 20 человек по дороге на рынок», «у Папы обнаружили growth на лёгком»).
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


LEAD_MAX = 230  # длина выжимки под заголовком


def make_lead(title: str, summary: str, link: str) -> str:
    """1–2 первых предложения анонса статьи, если они добавляют что-то к заголовку."""
    if not summary or "news.google.com" in (link or ""):
        return ""  # у Google News в анонсе только повтор заголовка
    s = re.sub(r"\s*(Continue reading|Read more|Читать далее)\W*$", "", summary, flags=re.I).strip()
    s = re.sub(r"\s*The post .{0,200} appeared first on .*$", "", s).strip()
    if len(s) < 40:
        return ""
    t_toks, s_toks = norm_tokens(title), norm_tokens(s)
    if s_toks and len(s_toks - t_toks) < 4:
        return ""  # анонс почти дословно повторяет заголовок
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
        return None  # «Markets», «Economy» — это заголовки рубрик, а не новости
    if src.get("categories") and it["categories"]:
        if not any(c in src["categories"] for c in it["categories"]):
            return None
    kw, title_hit = score_text(title, it["summary"])
    kind = src["kind"]
    if kind != "official" and kw < 3 and NOISE.search(title):
        return None  # происшествие со случайным «экономическим» словом
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
                if not m.get("lead") and it.get("lead"):
                    m["lead"] = it["lead"]  # выжимку берём у того, у кого она есть
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
    """Добавляет title_ru и lead_ru тем, у кого их ещё нет (параллельно, 4 потока)."""
    if lang in ("", "off", "none"):
        return
    jobs = []
    for it in items:
        if not it.get("title_ru"):
            jobs.append((it, "title", "title_ru"))
        if SUMMARIES and it.get("lead") and not it.get("lead_ru"):
            jobs.append((it, "lead", "lead_ru"))
    if not jobs:
        return
    with ThreadPoolExecutor(max_workers=4) as ex:
        for (it, src, dst), tr in zip(jobs, ex.map(lambda j: translate(j[0][j[1]], lang), jobs)):
            if tr:
                it[dst] = tr


# ----------------------------------------------------------------------------
# Telegram
# ----------------------------------------------------------------------------
TG_API = "https://api.telegram.org"
ICON = {"high": "🔴", "medium": "🟡", "low": "⚪"}
def _env_on(name, default):
    return os.environ.get(name, default).strip().lower() in ("1", "yes", "true", "on")


SHOW_ORIGINAL = _env_on("SHOW_ORIGINAL", "no")
SUMMARIES = _env_on("SUMMARIES", "yes")   # выжимка под заголовком
SHOW_TAGS = _env_on("TAGS", "yes")        # теги #нефть #ФРС ...
TERMINAL_BUTTON = _env_on("TERMINAL_BUTTON", "yes")  # кнопка «Терминал» под сообщениями


def fmt_tags(tags):
    return " ".join("#" + t for t in tags)


def fmt_item(it, icon=True, lead=True):
    src = ", ".join(it["sources"])
    t = html.escape(it.get("title_ru") or it["title"])
    mark = f"{ICON[level_of(it['score'])]} " if icon else "▪️ "
    line = f"{mark}<b>{t}</b>"
    if SHOW_ORIGINAL and it.get("title_ru"):
        line += f"\n<i>{html.escape(it['title'])}</i>"
    text = (it.get("lead_ru") or it.get("lead") or "") if (lead and SUMMARIES) else ""
    if text:
        line += f"\n{html.escape(text)}"
    meta = html.escape(src)
    if SHOW_TAGS and it.get("tags"):
        meta += " · " + fmt_tags(it["tags"])
    line += f"\n<i>{meta}</i>"
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


class TelegramError(RuntimeError):
    def __init__(self, code, body):
        super().__init__(f"Telegram ответил {code}: {body[:300]}")
        self.code, self.body = code, body


class Telegram:
    """Отправка в Telegram: владельцу (TELEGRAM_CHAT_ID) и всем, кто нажал /start
    (список подписчиков ведёт сервер бота, см. worker/)."""

    def __init__(self, token, chat_id, dry=False, pages_url="", subscribers=()):
        self.token, self.chat_id, self.dry = token, str(chat_id).strip(), dry
        self.pages_url = pages_url
        self.subscribers = [str(x) for x in dict.fromkeys(subscribers or []) if str(x) != self.chat_id]
        self.gone = set()          # заблокировали бота или удалили чат — уберём из подписчиков
        self.sent = 0              # сколько сообщений ушло за запуск (чтобы сразу сохранить состояние)
        self.no_webapp = set()     # чаты, где кнопки-приложения не работают

    def recipients(self, owner_only=False):
        out = [self.chat_id] if self.chat_id else []
        if not owner_only:
            out += [c for c in self.subscribers if c not in self.gone]
        return out

    def _markup(self, chat):
        if not self.pages_url:
            return None
        # web_app-кнопки (открывают страницу внутри Telegram) работают только в личных чатах
        webapp = not str(chat).startswith("-") and chat not in self.no_webapp

        def mk(text, url):
            return {"text": text, "web_app": {"url": url}} if webapp else {"text": text, "url": url}
        row = [mk("📈 Рынок онлайн", self.pages_url)]
        if TERMINAL_BUTTON:
            row.append(mk("🖥 Терминал", self.pages_url.rstrip("/") + "/terminal/"))
        return json.dumps({"inline_keyboard": [row]})

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
        raise RuntimeError("Не удалось достучаться до Telegram")

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
                self.no_webapp.add(chat)             # повторяем с обычными ссылками
                f["reply_markup"] = self._markup(chat)
                return self._call(method, f, files)
            if chat != self.chat_id and (e.code == 403 or (e.code == 400 and "chat not found" in low)):
                self.gone.add(chat)                  # пользователь заблокировал бота
                return None
            raise

    def _broadcast(self, method, fields, button, owner_only, files=None):
        """Отправить всем получателям. Ошибка у одного не мешает остальным.
        Исключение — только если не дошло никому (например, Telegram недоступен)."""
        targets = self.recipients(owner_only)
        delivered, last_err = 0, None
        for k, chat in enumerate(targets):
            try:
                res = self._deliver(chat, method, fields, button, files)
                if res is not None:
                    delivered += 1
                    if files and method == "sendPhoto":
                        # картинку загружаем один раз, остальным — по её file_id
                        photo = (res.get("photo") or [{}])[-1].get("file_id")
                        if photo:
                            fields, files = dict(fields, photo=photo), None
            except Exception as e:
                last_err = e
                print(f"  ! Telegram, чат {chat}: {e}"[:300])
            if k and len(targets) > 20:
                time.sleep(0.04)   # не больше ~25 сообщений в секунду
        if delivered:
            self.sent += 1
        if targets and not delivered and last_err:
            raise last_err

    def send(self, text, silent=False, button=False, owner_only=False):
        if self.dry:
            n = len(self.recipients(owner_only))
            print("-" * 60 + ("  [без звука]" if silent else "") + ("  [кнопка: Рынок онлайн]" if button and self.pages_url else "")
                  + f"  [получателей: {n}{', только владелец' if owner_only else ''}]")
            print(html.unescape(re.sub(r"<[^>]+>", "", text)))
            return
        fields = {"text": text, "parse_mode": "HTML",
                  "disable_web_page_preview": "true", "disable_notification": "true" if silent else "false"}
        self._broadcast("sendMessage", fields, button, owner_only)

    def send_photo(self, png, caption, silent=False, button=True, owner_only=False):
        if self.dry:
            print("-" * 60 + f"  [КАРТИНКА {len(png)//1024} КБ]" + ("  [без звука]" if silent else "")
                  + f"  [получателей: {len(self.recipients(owner_only))}]")
            print(html.unescape(re.sub(r"<[^>]+>", "", caption)))
            return
        fields = {"caption": caption[:1024], "parse_mode": "HTML", "disable_notification": "true" if silent else "false"}
        self._broadcast("sendPhoto", fields, button, owner_only, files={"photo": ("market.png", png, "image/png")})


# ----------------------------------------------------------------------------
# Подписчики: их список хранит сервер бота (worker/), здесь мы его только читаем
# ----------------------------------------------------------------------------
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs", "config.json")
_SUBS_CACHE = None   # последний полученный список — на случай, если сервер на минуту недоступен


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
    # та же формула, что в worker/src/index.js
    return hashlib.sha256(("econnews-sync:" + token).encode()).hexdigest()


def fetch_subscribers(token):
    global _SUBS_CACHE
    url = worker_url()
    if not url or not token:
        return []
    try:
        req = urllib.request.Request(url + "/subs", headers={"Authorization": "Bearer " + _sync_key(token), "User-Agent": UA})
        with urllib.request.urlopen(req, timeout=15) as r:
            ids = [str(x) for x in json.loads(r.read().decode("utf-8")).get("ids", [])]
        _SUBS_CACHE = ids
        return ids
    except Exception as e:
        print(f"  ! список подписчиков недоступен ({type(e).__name__}: {e})"[:200]
              + (" — беру прошлый" if _SUBS_CACHE else ""))
        return list(_SUBS_CACHE or [])


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
        print(f"  убраны подписчики, заблокировавшие бота: {len(ids)}")
    except Exception as e:
        print(f"  ! не удалось убрать подписчиков: {type(e).__name__}: {e}"[:200])


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


def page_calendar(st, now):
    """События календаря на 7 дней вперёд (и сутки назад) для терминала."""
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
    """Новость для терминала: заголовок, выжимка, теги, тикеры компаний и (если есть) разбор ИИ."""
    item = {"title": r.get("title_ru") or r["title"], "original": r["title"] if r.get("title_ru") else "",
            "lead": r.get("lead_ru") or r.get("lead") or "", "tags": r.get("tags", []),
            "sources": r["sources"], "link": r["link"], "level": level_of(r["score"]), "ts": r["ts"]}
    try:
        import stocks
        tk = stocks.tickers_in(r["title"], r.get("title_ru"), r.get("lead"), r.get("lead_ru"))
        if tk:
            d = stocks.direction(r["title"], r.get("lead"), r.get("title_ru"), r.get("lead_ru"))
            item["tk"] = tk
            if d:
                item["dir"] = d
    except Exception:
        pass
    if r.get("ai"):
        item["ai"] = r["ai"]
    return item


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
        "news": [page_news_item(r) for r in news[:150]],
        "calendar": page_calendar(st, now),
    }
    if st.get("trades"):
        try:
            import trades
            data["trades"] = trades.page_data(st)
        except Exception as e:
            print(f"  ! сделки для терминала: {type(e).__name__}: {e}")
            if old.get("trades"):
                data["trades"] = old["trades"]
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
    morning_hour = int(os.environ.get("MORNING_HOUR", "9"))
    use_calendar = _env_on("CALENDAR", "yes")
    cal_countries = {c.strip().upper() for c in os.environ.get("CAL_COUNTRIES", "USD,EUR,CNY,GBP,JPY").split(",") if c.strip()}
    remind_min = int(os.environ.get("REMIND_MINUTES", "60"))
    alerts_on = _env_on("ALERTS", "yes")
    state_path = os.environ.get("STATE_FILE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "state.json"))

    subscribers = fetch_subscribers(token)
    tg = Telegram(token, chat, dry, pages_url, subscribers)
    now = datetime.now(timezone.utc)
    now_msk = now.astimezone(MSK)
    st = load_state(state_path)

    candidates, errors = collect(now)
    quotes = fetch_quotes()
    mline = strip_line(quotes) if (quotes and show_market) else ""
    went_down, came_back = [], []
    for name in sorted({s["name"] for s in SOURCES}):
        prev = st["fail_streak"].get(name, 0)
        cur = prev + 1 if name in errors else 0
        st["fail_streak"][name] = cur
        if cur == DOWN_AFTER:
            went_down.append(name)
        elif prev >= DOWN_AFTER and cur == 0:
            came_back.append(name)
    all_down = len(errors) == len({s["name"] for s in SOURCES})

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
    try:
        import ai
        if ai.enabled():
            ai.annotate([s for s in to_send if level_of(s["score"]) == "high"])
    except Exception as e:
        print(f"  ! ИИ-разбор: {type(e).__name__}: {e}"[:200])

    # запоминаем всё увиденное (даже неважное), чтобы не присылать повторно
    for s in stories:
        for i in s["_ids"]:
            st["seen"][i] = now.isoformat()
        rec = {"title": s["title"], "link": s["link"], "sources": s["sources"],
               "score": s["score"], "ts": now.isoformat()}
        keep = ("title_ru", "lead", "lead_ru", "tags", "ai") if level_of(s["score"]) != "low" else ("title_ru",)
        for k in keep:
            if s.get(k):
                rec[k] = s[k]
        st["recent"].append(rec)

    silent = in_quiet_hours(now_msk, quiet)
    stamp = now_msk.strftime("%d.%m %H:%M")

    market_html = f"\n<i>📊 {html.escape(mline)}</i>" if mline else ""

    if not st["initialized"]:
        st["initialized"] = True
        st["last_digest"] = now_msk.strftime("%Y-%m-%d")  # сводку начнём со следующего дня
        st["last_morning"] = now_msk.strftime("%Y-%m-%d")
        top = to_send[:7]
        header = ("✅ <b>Бот экономических новостей запущен</b>\n"
                  f"Слежу за {len({s['name'] for s in SOURCES})} источниками, проверка каждые ~10 минут.\n"
                  "В 9:00 — главное за ночь и календарь дня, в 21:00 — итоги дня.\n"
                  "За час до важных данных (инфляция, ставки ФРС/ЕЦБ) пришлю напоминание."
                  + market_html)
        blocks = sectioned(top) if top else ["Пока ничего значимого — пришлю, как только появится."]
        msgs = split_messages(header, blocks)
        for k, m in enumerate(msgs):
            tg.send(m, button=(k == len(msgs) - 1), owner_only=True)
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

    # календарь: важные события недели (кэшируется в state.json)
    events = []
    if use_calendar:
        try:
            import econ_calendar as cal
            events = cal.get_events(st, now, cal_countries)
        except Exception as e:
            print(f"  ! календарь: {type(e).__name__}: {e}")
            events = []
    tr = (lambda t: translate(t, lang)) if lang not in ("", "off", "none") else None

    # напоминания о событиях за REMIND_MINUTES минут
    if events and remind_min > 0:
        import econ_calendar as cal
        reminded = st.setdefault("cal_reminded", [])
        soon = [e for e in cal.events_between(events, now, now + timedelta(minutes=remind_min))
                if cal.event_id(e) not in reminded]
        if soon:
            lines = []
            for e in soon:
                mins = max(1, int((datetime.fromisoformat(e["ts"]) - now).total_seconds() // 60))
                lines.append(f"через {mins} мин · " + cal.fmt_event(e, tr))
                reminded.append(cal.event_id(e))
            tg.send("⏰ <b>Скоро важные данные</b>\n" + "\n".join(lines), silent=silent)
        st["cal_reminded"] = reminded[-200:]

    # факт по вышедшим данным США (из FRED, нужен бесплатный ключ FRED_API_KEY)
    fred_key = os.environ.get("FRED_API_KEY", "").strip()
    if events and fred_key:
        import econ_calendar as cal
        actuals = st.setdefault("cal_actuals", {})
        due = [e for e in cal.events_between(events, now - timedelta(hours=36), now - timedelta(minutes=1))
               if cal.fred_spec(e) and cal.event_id(e) not in actuals]
        lines = []
        for e in due[:8]:
            try:
                a = cal.fetch_actual(e, fred_key)
            except Exception as ex:
                print(f"  ! FRED {e['title']}: {type(ex).__name__}: {ex}"[:200])
                continue
            if not a:
                continue  # ещё не опубликовано — проверим в следующий запуск
            actuals[cal.event_id(e)] = a
            v = cal.verdict(a, e.get("forecast"))
            extra = [f"прогноз {html.escape(e['forecast'])}" if e.get("forecast") else "",
                     f"пред. {html.escape(e['previous'])}" if e.get("previous") else ""]
            extra = ", ".join(x for x in extra if x)
            lines.append(f"{cal.FLAGS.get(e['country'], '')} {html.escape(cal.ru_name(e, tr))}: <b>{html.escape(a)}</b>"
                         + (f" <i>({extra})</i>" if extra else "") + (f" — {v}" if v else ""))
        if lines:
            tg.send("📊 <b>Вышли данные</b>\n" + "\n".join(lines), silent=silent)
        if len(actuals) > 300:
            st["cal_actuals"] = dict(list(actuals.items())[-300:])

    # утренний дайджест: главное за ночь + события дня
    today = now_msk.strftime("%Y-%m-%d")
    st.setdefault("last_morning", "")
    if morning_hour >= 0 and morning_hour <= now_msk.hour < 14 and st["last_morning"] != today:
        st["last_morning"] = today
        since = (now - timedelta(hours=12)).isoformat()
        night = [r for r in st["recent"] if r["ts"] >= since and level_of(r["score"]) != "low"]
        night.sort(key=lambda r: -r["score"])
        top = night[:7]
        translate_items(top, lang)
        header = f"☀️ <b>Доброе утро! Главное за ночь</b>" + market_html
        blocks = [f"{k}. " + fmt_item(r, icon=True, lead=k <= 3) for k, r in enumerate(top, 1)] \
            or ["Ночью значимых новостей не было."]
        if events:
            import econ_calendar as cal
            day_start = now_msk.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
            todays = cal.events_between(events, max(now, day_start), day_start + timedelta(days=1))
            if todays:
                blocks.append("📅 <b>Сегодня в календаре (МСК)</b>\n" + "\n".join(cal.fmt_event(e, tr) for e in todays))
        msgs = split_messages(header, blocks)
        for k, m in enumerate(msgs):
            tg.send(m, button=(k == len(msgs) - 1))

    # оповещения о сбоях источников
    if alerts_on and st["initialized"]:
        lines = []
        if all_down:
            if not st.get("all_down_alerted"):
                lines.append("⚠️ Ни один источник не ответил. Возможно, проблемы с сетью у GitHub — проверю в следующий раз.")
                st["all_down_alerted"] = True
        else:
            st["all_down_alerted"] = False
            if went_down:
                lines.append(f"⚠️ Не отвечают уже ~{DOWN_AFTER // 2} ч: " + html.escape(", ".join(went_down)))
            if came_back:
                lines.append("✅ Снова работают: " + html.escape(", ".join(came_back)))
        if lines:
            tg.send("\n".join(lines), silent=True, owner_only=True)   # служебное — только владельцу

    # сделки политиков США и инсайдеров (официальные раскрытия, без ключей)
    n_trades = 0
    if _env_on("TRADES", "yes"):
        try:
            import trades
            new_trades = trades.update(st, now)
            for m in trades.messages(new_trades):
                tg.send(m, silent=silent)
            n_trades = sum(len(v) for v in new_trades.values())
        except Exception as e:
            print(f"  ! сделки: {type(e).__name__}: {e}")

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
        blocks = [f"{k}. " + fmt_item(r, icon=True, lead=k <= 3) for k, r in enumerate(top, 1)] \
            or ["Значимых новостей не было."]
        if events:
            import econ_calendar as cal
            tomorrow = (now_msk + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
            nxt = cal.events_between(events, tomorrow, tomorrow + timedelta(days=1))
            if nxt:
                blocks.append("📅 <b>Завтра в календаре (МСК)</b>\n" + "\n".join(cal.fmt_event(e, tr) for e in nxt))
        dead = sorted(n for n, k in st["fail_streak"].items() if k >= DOWN_AFTER)
        if dead:
            blocks.append("⚠️ <i>Не отвечают несколько часов: " + html.escape(", ".join(dead)) + "</i>")
        msgs = split_messages(header, blocks)
        for k, m in enumerate(msgs):
            tg.send(m, silent=True, button=(k == len(msgs) - 1))

    write_page_data(st, quotes, now)
    save_state(state_path, st, now)
    extras = update_extras(now, dry)
    push_live(token, now)
    if tg.gone:
        remove_subscribers(token, tg.gone)

    print(f"[{stamp} МСК] кандидатов: {len(candidates)}, новых историй: {len(stories)}, "
          f"отправлено: {len(to_send[:MAX_PER_MESSAGE_BATCH])}, получателей: {len(tg.recipients())}, "
          f"котировок: {len(quotes)}, сделок: {n_trades}, {extras}"
          f"ошибки источников: {len(errors)}")
    for name, err in sorted(errors.items()):
        print(f"  ! {name}: {err}")
    return tg.sent


def update_extras(now, dry=False):
    """Данные терминала, которые не зависят от новостей: компании США (stocks.json) и ставки (rates.json)."""
    parts = []
    if dry or not _env_on("COMPANIES", "yes"):
        return ""
    try:
        import stocks
        d = stocks.build(now)
        if d:
            parts.append(f"акций: {d['prices_ok']}, мультипликаторов: {d['metrics_updated']}")
    except Exception as e:
        print(f"  ! компании (stocks.py): {type(e).__name__}: {e}"[:200])
    try:
        import rates
        r = rates.build(now)
        if r:
            parts.append(f"кривых: {len(r.get('curves') or {})}")
    except Exception as e:
        print(f"  ! ставки (rates.py): {type(e).__name__}: {e}"[:200])
    return (", ".join(parts) + ", ") if parts else ""


def push_live(token, now):
    """Свежие новости — на сервер бота: терминал покажет их сразу, не дожидаясь обновления сайта."""
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
        print(f"  ! живая лента на сервер бота: {type(e).__name__}: {e}"[:200])


def load_dotenv(path):
    """Читает файл .env (КЛЮЧ=значение) рядом с ботом. Уже заданные переменные не трогает."""
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


def git_sync(stage, repo):
    """Режим сервера: перед запуском забираем изменения с GitHub, после — отправляем state.json и данные страницы."""
    import subprocess

    def git(*a):
        return subprocess.run(["git", "-C", repo, *a], capture_output=True, text=True, timeout=120)

    if stage == "pull":
        r = git("pull", "--rebase", "--autostash", "-q")
        if r.returncode:
            print("  ! git pull:", (r.stderr or r.stdout).strip()[:300])
        return
    for f in ("state.json", "docs/data.json", "docs/stocks.json", "docs/rates.json", "docs/fin"):
        if os.path.exists(os.path.join(repo, f)):
            git("add", f)
    if git("diff", "--cached", "--quiet").returncode == 0:
        return  # нечего отправлять
    git("-c", "user.name=news-bot", "-c", "user.email=news-bot@users.noreply.github.com",
        "commit", "-q", "-m", "news update")
    for _ in range(3):
        r = git("push", "-q")
        if r.returncode == 0:
            return
        git("pull", "--rebase", "--autostash", "-q")
    print("  ! git push не удался:", (r.stderr or r.stdout).strip()[:300])


def loop(minutes, sync, max_hours=0.0):
    """Цикл: запуск каждые `minutes` минут. Ошибка одного запуска не останавливает бота.
    max_hours > 0 — остановиться через столько часов (для GitHub Actions, где задача живёт до 6 ч)."""
    repo = os.path.dirname(os.path.abspath(__file__))
    deadline = time.time() + max_hours * 3600 if max_hours > 0 else None
    print(f"Бот запущен в постоянном режиме: проверка каждые {minutes:g} мин"
          + (", синхронизация с GitHub включена" if sync else "") + ". Остановить: Ctrl+C.")
    last_push = 0.0
    push_every = float(os.environ.get("PUSH_MINUTES", "10")) * 60
    while True:
        started = time.time()
        try:
            if sync:
                git_sync("pull", repo)
            sent = run()
            # сайт (GitHub Pages) пересобирается при каждой отправке — не чаще раза в ~10 минут,
            # но сразу, если что-то ушло в Telegram (чтобы после сбоя не прислать то же самое ещё раз)
            if sync and (sent or time.time() - last_push >= push_every - 30):
                git_sync("push", repo)
                last_push = time.time()
        except SystemExit as e:
            print(e)
            return
        except Exception as e:
            print(f"  ! запуск завершился ошибкой: {type(e).__name__}: {e}")
        pause = max(30.0, minutes * 60 - (time.time() - started))
        if deadline and time.time() + pause > deadline:
            print("Время работы истекло, выхожу.")
            return
        time.sleep(pause)


def main():
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
    args = sys.argv[1:]
    if "--test" in args:
        tg = Telegram(os.environ.get("TELEGRAM_BOT_TOKEN", ""), os.environ.get("TELEGRAM_CHAT_ID", ""),
                      pages_url=os.environ.get("PAGES_URL", ""))
        tg.send("👋 Тест: бот экономических новостей на связи.", button=True)
        print("Тестовое сообщение отправлено")
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
