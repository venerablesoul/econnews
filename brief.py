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

import i18n

HERE = os.path.dirname(os.path.abspath(__file__))
GEX_DIR = os.path.join(HERE, "docs", "gex")
# what the brief covers; the ETF stands in when the index file is missing
ITEMS = (("SPX", "SPY", {"en": "S&P 500", "ru": "S&P 500", "zh": "标普500", "ar": "S&P 500"}),
         ("NDX", "QQQ", {"en": "Nasdaq-100", "ru": "Nasdaq-100", "zh": "纳斯达克100", "ar": "ناسداك 100"}),
         ("BTC", None, {"en": "Bitcoin", "ru": "Биткоин", "zh": "比特币", "ar": "بيتكوين"}))
# an older snapshot (a stopped source) is left out rather than shown as today's; US options do not trade at weekends,
# so on Monday Friday's levels still count (with their date)
MAX_AGE_H = {"crypto": 30, "equity": 80}
DATED_AFTER_H = 20

S = {
    "head": {"en": "📐 <b>Option levels before the US open</b> · {d}", "ru": "📐 <b>Опционные уровни перед открытием США</b> · {d}", "zh": "📐 <b>美股开盘前的期权关键位</b> · {d}", "ar": "📐 <b>مستويات الخيارات قبل افتتاح السوق الأمريكية</b> · {d}"},
    "pos": {"en": "positive gamma: moves tend to be damped", "ru": "положительная гамма: движения гасятся", "zh": "正伽马：波动往往被抑制", "ar": "غاما موجبة: تميل الحركات إلى الهدوء"},
    "neg": {"en": "negative gamma: moves tend to speed up", "ru": "отрицательная гамма: движения ускоряются", "zh": "负伽马：波动往往加速", "ar": "غاما سالبة: تميل الحركات إلى التسارع"},
    "flip": {"en": "flip {v} ({d})", "ru": "смена гаммы {v} ({d})", "zh": "伽马翻转点 {v}（{d}）", "ar": "نقطة انقلاب غاما {v} ({d})"},
    "walls": {"en": "call wall {c} · put wall {p}", "ru": "стена коллов {c} · путов {p}", "zh": "看涨墙 {c} · 看跌墙 {p}", "ar": "جدار خيارات الشراء {c} · جدار خيارات البيع {p}"},
    "em": {"en": "±1σ today {lo}–{hi} (±{pct}%)", "ru": "±1σ за день {lo}–{hi} (±{pct}%)", "zh": "今日 ±1σ {lo}–{hi}（±{pct}%）", "ar": "±1σ اليوم {lo}–{hi} (±{pct}%)"},
    "vix": {"en": "VIX {v}", "ru": "VIX {v}"},
    "dvol": {"en": "DVOL {v}", "ru": "DVOL {v}"},
    "asof": {"en": "as of {d}", "ru": "на {d}", "zh": "截至 {d}", "ar": "حتى {d}"},
    "ai": {"en": "🤖 <i>{t}</i>", "ru": "🤖 <i>{t}</i>"},
    "note": {"en": "<i>Estimated from open interest (dealers assumed long calls, short puts), not real positions; US options 15+ min delayed. "
                   "Details: GEX and LVL in the terminal.</i>",
             "ru": "<i>Оценка по открытому интересу (дилеры предположительно в длинных коллах и коротких путах), а не реальные позиции; "
                   "опционы США — с задержкой от 15 мин. Подробнее: GEX и LVL в терминале.</i>",
             "zh": "<i>根据未平仓量估算（假定做市商持有看涨多头、看跌空头），并非真实仓位；美国期权延迟 15 分钟以上。"
                   "详情：终端中的 GEX 和 LVL。</i>",
             "ar": "<i>تقدير من العقود المفتوحة (يُفترض أن المتعاملين في مراكز شراء لخيارات الشراء ومراكز بيع لخيارات البيع)، وليست مراكز حقيقية؛ "
                   "الخيارات الأمريكية متأخرة 15 دقيقة على الأقل. التفاصيل: GEX وLVL في المنصة.</i>"},
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
    for lim, unit in i18n.units(lang):   # $1.2B / $1,2 млрд / $12亿 / $1.2 مليار
        if a >= lim:
            return f"{sign}${num(a / lim, lang, 1)}{unit}"
    return f"{sign}${num(a, lang, 0)}"


def day_month(dt, lang):
    """23 Nov / 23 ноя / 11月23日 / 23 نوفمبر"""
    if lang == "zh":
        return f"{dt.month}月{dt.day}日"
    if lang == "ar":
        return f"{dt.day} {i18n.month('ar', dt.month)}"
    return f"{dt.day} {MONTHS[lang if lang in MONTHS else 'en'][dt.month - 1]}"


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
        head += " <i>(" + t(lang, "asof", d=day_month(u, lang)) + ")</i>"
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
        blocks = [t(lang, "head", d=day_month(msk, lang))]
        blocks += [lines(name, s, lang, now) for name, s in snaps]
        if vix:
            blocks.append(t(lang, "vix", v=num(vix, lang, 2)))
        n = (note.get(lang) or note.get("en")) if isinstance(note, dict) else None
        if n:
            blocks.append(t(lang, "ai", t=html.escape(n)))
        blocks.append(t(lang, "note"))
        return "\n\n".join(blocks)
    return make
