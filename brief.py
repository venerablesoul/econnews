"""
Pre-market brief: the option levels before the US open — one message a weekday at BRIEF_HOUR (MSK).

For the S&P 500, the Nasdaq-100 and bitcoin: price, total GEX and what it means (positive gamma — moves tend to be
damped, negative — they tend to speed up), the gamma flip, the call and put walls, the expected move for the day
(±1σ from the 30-day implied volatility) and the VIX / DVOL. With ANTHROPIC_API_KEY set, two sentences of AI reading
of these numbers are added (ai.py); without the key nothing is asked of anyone.
Data: docs/gex/<SYM>.json written by options.py and deribit.py (gex.py); the bot's quotes for the VIX.
"""
from __future__ import annotations

import html
import json
import os
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
GEX_DIR = os.path.join(HERE, "docs", "gex")
# what the brief covers; the ETF stands in when the index file is missing
ITEMS = (("SPX", "SPY", {"en": "S&P 500", "ru": "S&P 500"}), ("NDX", "QQQ", {"en": "Nasdaq-100", "ru": "Nasdaq-100"}),
         ("BTC", None, {"en": "Bitcoin", "ru": "Биткоин"}))
# an older snapshot (a stopped source) is left out rather than shown as today's; US options do not trade at weekends,
# so on Monday Friday's levels still count (with their date)
MAX_AGE_H = {"crypto": 30, "equity": 80}
DATED_AFTER_H = 20

S = {
    "head": {"en": "📐 <b>Option levels before the US open</b> · {d}", "ru": "📐 <b>Опционные уровни перед открытием США</b> · {d}"},
    "pos": {"en": "positive gamma: moves tend to be damped", "ru": "положительная гамма: движения гасятся"},
    "neg": {"en": "negative gamma: moves tend to speed up", "ru": "отрицательная гамма: движения ускоряются"},
    "flip": {"en": "flip {v} ({d})", "ru": "смена гаммы {v} ({d})"},
    "walls": {"en": "call wall {c} · put wall {p}", "ru": "стена коллов {c} · путов {p}"},
    "em": {"en": "±1σ today {lo}–{hi} (±{pct}%)", "ru": "±1σ за день {lo}–{hi} (±{pct}%)"},
    "vix": {"en": "VIX {v}", "ru": "VIX {v}"},
    "dvol": {"en": "DVOL {v}", "ru": "DVOL {v}"},
    "asof": {"en": "as of {d}", "ru": "на {d}"},
    "ai": {"en": "🤖 <i>{t}</i>", "ru": "🤖 <i>{t}</i>"},
    "note": {"en": "<i>Estimated from open interest (dealers assumed long calls, short puts), not real positions; US options 15+ min delayed. "
                   "Details: GEX and LVL in the terminal.</i>",
             "ru": "<i>Оценка по открытому интересу (дилеры предположительно в длинных коллах и коротких путах), а не реальные позиции; "
                   "опционы США — с задержкой от 15 мин. Подробнее: GEX и LVL в терминале.</i>"},
}
MONTHS = {"en": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
          "ru": ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]}


def t(lang, key, **kw):
    v = S[key].get(lang) or S[key]["en"]
    return v.format(**kw) if kw else v


def num(v, lang, nd=0):
    if v is None:
        return "—"
    s = f"{v:,.{nd}f}"
    return s.replace(",", " ").replace(".", ",") if lang == "ru" else s


def money(v, lang):
    if v is None:
        return "—"
    a, sign = abs(v), "−" if v < 0 else "+"
    for lim, en, ru in ((1e12, "T", " трлн"), (1e9, "B", " млрд"), (1e6, "M", " млн"), (1e3, "K", " тыс")):
        if a >= lim:
            return f"{sign}${num(a / lim, lang, 1)}{ru if lang == 'ru' else en}"
    return f"{sign}${num(a, lang, 0)}"


def pct(v, lang, nd=1):
    if v is None:
        return "—"
    return ("+" if v > 0 else "−" if v < 0 else "") + num(abs(v), lang, nd) + "%"


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def age_h(d, now):
    try:
        return (now - datetime.fromisoformat(d["updated"])).total_seconds() / 3600
    except (KeyError, TypeError, ValueError):
        return None


def fresh(d, now):
    a = age_h(d, now)
    return a is not None and a <= MAX_AGE_H.get(d.get("kind") or "equity", 30)


def snapshots(now, gex_dir=None):
    gex_dir = gex_dir or GEX_DIR
    out = []
    for sym, alt, name in ITEMS:
        d = load(os.path.join(gex_dir, sym + ".json"))
        if not (d and fresh(d, now)) and alt:
            d = load(os.path.join(gex_dir, alt + ".json"))
        if d and fresh(d, now) and d.get("px"):
            out.append((name, d))
    return out


def vix_of(quotes):
    for q in quotes or []:
        if isinstance(q, dict) and (q.get("short") == "VIX" or q.get("id") == "VIX" or q.get("name") == "VIX"):
            v = q.get("value")
            if isinstance(v, (int, float)):
                return v
    return None


def lines(name, d, lang, now=None):
    S_, lv, em, tot = d["px"], d.get("levels") or {}, d.get("em") or {}, d.get("tot") or {}
    nd = 0 if S_ >= 100 else 2
    g = tot.get("gex")
    head = f"<b>{html.escape(name[lang] if lang in name else name['en'])}</b> {num(S_, lang, nd)}"
    a = age_h(d, now) if now else None
    if a is not None and a > DATED_AFTER_H:
        u = datetime.fromisoformat(d["updated"]).astimezone(timezone(timedelta(hours=3)))
        months = MONTHS.get(lang, MONTHS["en"])
        head += " <i>(" + t(lang, "asof", d=f"{u.day} {months[u.month - 1]}") + ")</i>"
    if g is not None:
        head += f" · GEX {money(g, lang)} — {t(lang, 'pos' if g >= 0 else 'neg')}"
    parts = []
    if lv.get("zero"):
        parts.append(t(lang, "flip", v=num(lv["zero"], lang, nd), d=pct((lv["zero"] / S_ - 1) * 100, lang)))
    if lv.get("cwall") is not None and lv.get("pwall") is not None:
        parts.append(t(lang, "walls", c=num(lv["cwall"], lang, nd), p=num(lv["pwall"], lang, nd)))
    if em.get("d1"):
        parts.append(t(lang, "em", lo=num(S_ - em["d1"], lang, nd), hi=num(S_ + em["d1"], lang, nd), pct=num(em.get("d1_pct"), lang, 2)))
    if d.get("dvol"):
        parts.append(t(lang, "dvol", v=num(d["dvol"], lang, 1)))
    return head + ("\n" + " · ".join(parts) if parts else "")


def facts(snaps, vix):
    """The numbers in plain English for the AI note."""
    rows = []
    for name, d in snaps:
        lv, em, tot = d.get("levels") or {}, d.get("em") or {}, d.get("tot") or {}
        rows.append(f"{name['en']}: price {d['px']}, total GEX {tot.get('gex')} $ per 1% move, gamma flip {lv.get('zero')}, "
                    f"call wall {lv.get('cwall')}, put wall {lv.get('pwall')}, biggest + gamma strike {lv.get('pos')}, "
                    f"biggest − gamma strike {lv.get('neg')}, 1-day 1σ move {em.get('d1_pct')}%, 30-day IV {em.get('iv30')}"
                    + (f", DVOL {d['dvol']}" if d.get("dvol") else ""))
    if vix:
        rows.append(f"VIX {vix}")
    return "\n".join(rows)


def build(now, quotes=None, gex_dir=None, ai_note=None):
    """A function lang -> message, or None when there is nothing fresh to tell."""
    snaps = snapshots(now, gex_dir)
    if not snaps:
        return None
    vix = vix_of(quotes)
    note = None
    if ai_note:
        try:
            note = ai_note(facts(snaps, vix))
        except Exception as e:
            print(f"  ! AI brief note: {type(e).__name__}: {e}"[:200])
            note = None
    msk = now.astimezone(timezone(timedelta(hours=3)))

    def make(lang):
        d = f"{msk.day} {MONTHS[lang if lang in MONTHS else 'en'][msk.month - 1]}"
        blocks = [t(lang, "head", d=d)]
        blocks += [lines(name, s, lang, now) for name, s in snaps]
        if vix:
            blocks.append(t(lang, "vix", v=num(vix, lang, 2)))
        n = note.get(lang) if isinstance(note, dict) else None
        if n:
            blocks.append(t(lang, "ai", t=html.escape(n)))
        blocks.append(t(lang, "note"))
        return "\n\n".join(blocks)
    return make
