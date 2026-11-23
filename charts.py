"""
Картинка «Рынки» для Telegram: сетка карточек с ценой, изменением и графиком.
Нужен matplotlib (на GitHub ставится автоматически). Если его нет — бот просто
не присылает картинку, всё остальное работает.
"""
from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone

MSK = timezone(timedelta(hours=3))

BG = "#0e1116"
CARD = "#161b22"
TEXT = "#e9edf3"
MUTED = "#8b95a7"
UP = "#2fbf71"
DOWN = "#ef5350"
FLAT = "#9aa4b5"


# Chinese names of the instruments on the picture (by their "short" key)
NAMES_ZH = {"S&P": "标普500指数", "Nasdaq": "纳斯达克指数", "Brent": "布伦特原油", "Золото": "黄金", "EUR/USD": "欧元/美元",
            "UST10": "美国10年期国债收益率", "BTC": "比特币", "IMOEX": "莫斯科交易所指数",
            "USD/RUB": "美元/卢布（俄央行）", "CNY/RUB": "人民币/卢布（俄央行）"}
CJK_FONTS = ("Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", "PingFang SC",
             "WenQuanYi Zen Hei", "WenQuanYi Micro Hei", "SimHei", "Noto Sans CJK JP")


def cjk_font():
    """A font with Chinese characters installed on this machine, or None."""
    try:
        from matplotlib import font_manager
        have = {f.name for f in font_manager.fontManager.ttflist}
    except Exception:
        return None
    return next((f for f in CJK_FONTS if f in have), None)


def picture_lang(lang):
    """The language the picture is drawn in. matplotlib cannot join Arabic letters, and Chinese needs a CJK font:
    without one the picture stays English (the caption under it is still in the reader's language)."""
    if lang == "ar" or (lang == "zh" and not cjk_font()):
        return "en"
    return lang if lang in ("en", "ru", "zh") else "en"


def render_market_png(quotes, now=None, lang="en") -> bytes:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import FancyBboxPatch

    import i18n
    from market import fmt_change, fmt_price

    lang = picture_lang(lang)

    now = (now or datetime.now(timezone.utc)).astimezone(MSK)
    quotes = [q for q in quotes if q.get("chart", True)]
    n = len(quotes)
    cols = 2
    rows = (n + cols - 1) // cols
    W, card_h, head_h, pad = 10.8, 2.35, 1.25, 0.28
    H = head_h + rows * card_h + 0.35

    plt.rcParams["font.family"] = [cjk_font(), "DejaVu Sans"] if lang == "zh" else ["DejaVu Sans"]
    fig = plt.figure(figsize=(W, H), dpi=110, facecolor=BG)

    # заголовок
    fig.text(pad / W, 1 - 0.50 / H, i18n.t(lang, "chart_title"), color=TEXT, fontsize=26, fontweight="bold", va="center")
    if lang == "zh":
        stamp = f"{now.year}年{i18n.month(lang, now.month)}{now.day}日 {now:%H:%M}（{i18n.t(lang, 'tz')}）"
    else:
        date = (f"{now.day} {i18n.month(lang, now.month)} {now.year}" if lang == "ru"
                else f"{i18n.month(lang, now.month)} {now.day}, {now.year}")
        stamp = f"{date}, {now:%H:%M} {i18n.t(lang, 'tz')}"
    fig.text(pad / W, 1 - 0.95 / H, stamp, color=MUTED, fontsize=13, va="center")
    cw = (W - pad * (cols + 1)) / cols
    ax_bg = fig.add_axes([0, 0, 1, 1], facecolor="none")
    ax_bg.set_axis_off()
    ax_bg.set_xlim(0, W)
    ax_bg.set_ylim(0, H)
    for i, q in enumerate(quotes):
        r, c = divmod(i, cols)
        x0 = pad + c * (cw + pad)
        y0 = H - head_h - (r + 1) * card_h + 0.12
        ch = card_h - 0.24
        ax_bg.add_patch(FancyBboxPatch((x0, y0), cw, ch, boxstyle="round,pad=0,rounding_size=0.18",
                                       fc=CARD, ec="#222a35", lw=1))
        chg = q.get("change")
        color = FLAT if chg is None or abs(chg) < 0.005 else (UP if chg > 0 else DOWN)

        if lang == "ru":
            name = q["name"]
        else:
            name = (NAMES_ZH.get(q.get("short")) if lang == "zh" else None) or q.get("en") or q["name"]
        ax_bg.text(x0 + 0.22, y0 + ch - 0.30, name, color=MUTED, fontsize=11.5, va="center")
        ax_bg.text(x0 + 0.22, y0 + ch - 0.78, fmt_price(q, lang), color=TEXT, fontsize=21, fontweight="bold", va="center")
        if chg is not None:
            ax_bg.text(x0 + cw - 0.22, y0 + ch - 0.78, fmt_change(q, lang), color=color, fontsize=15,
                       fontweight="bold", va="center", ha="right")
        ax_bg.text(x0 + cw - 0.22, y0 + ch - 0.30, i18n.t(lang, "period_30d" if q.get("src") == "cbr" else "period_5d"), color=MUTED, fontsize=9.5,
                   va="center", ha="right")

        vals = [v for _, v in q["series"]]
        if len(vals) >= 2:
            ax = fig.add_axes([(x0 + 0.18) / W, (y0 + 0.14) / H, (cw - 0.36) / W, (ch - 1.25) / H],
                              facecolor="none")
            xs = range(len(vals))  # по индексу: ночи и выходные без «ступенек»
            lo, hi = min(vals), max(vals)
            span = (hi - lo) or abs(hi) * 0.01 or 1
            ax.plot(xs, vals, color=color, lw=2.0, solid_capstyle="round")
            ax.fill_between(xs, vals, lo - span * 0.15, color=color, alpha=0.13, lw=0)
            ax.scatter([len(vals) - 1], [vals[-1]], s=22, color=color, zorder=3)
            ax.set_ylim(lo - span * 0.15, hi + span * 0.12)
            ax.set_xlim(0, len(vals) - 1)
            ax.set_axis_off()

    fig.text(0.5, 0.12 / H, i18n.t(lang, "chart_sources"),
             color="#5d6778", fontsize=9, ha="center", va="center")
    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor=BG)
    plt.close(fig)
    return buf.getvalue()
