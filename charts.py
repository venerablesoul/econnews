"""
Картинка «Рынки» для Telegram: сетка карточек с ценой, изменением и графиком.
Нужен matplotlib (на GitHub ставится автоматически). Если его нет — бот просто
не присылает картинку, всё остальное работает.
"""
from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone

MSK = timezone(timedelta(hours=3))
MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
          "сентября", "октября", "ноября", "декабря"]

BG = "#0e1116"
CARD = "#161b22"
TEXT = "#e9edf3"
MUTED = "#8b95a7"
UP = "#2fbf71"
DOWN = "#ef5350"
FLAT = "#9aa4b5"


def render_market_png(quotes, now=None) -> bytes:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import FancyBboxPatch

    from market import fmt_change, fmt_price

    now = (now or datetime.now(timezone.utc)).astimezone(MSK)
    quotes = [q for q in quotes if q.get("chart", True)]
    n = len(quotes)
    cols = 2
    rows = (n + cols - 1) // cols
    W, card_h, head_h, pad = 10.8, 2.35, 1.25, 0.28
    H = head_h + rows * card_h + 0.35

    plt.rcParams["font.family"] = ["DejaVu Sans"]
    fig = plt.figure(figsize=(W, H), dpi=110, facecolor=BG)

    # заголовок
    fig.text(pad / W, 1 - 0.50 / H, "Рынки", color=TEXT, fontsize=26, fontweight="bold", va="center")
    fig.text(pad / W, 1 - 0.95 / H, f"{now.day} {MONTHS[now.month - 1]} {now.year}, {now:%H:%M} МСК",
             color=MUTED, fontsize=13, va="center")
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

        ax_bg.text(x0 + 0.22, y0 + ch - 0.30, q["name"], color=MUTED, fontsize=11.5, va="center")
        ax_bg.text(x0 + 0.22, y0 + ch - 0.78, fmt_price(q), color=TEXT, fontsize=21, fontweight="bold", va="center")
        if chg is not None:
            ax_bg.text(x0 + cw - 0.22, y0 + ch - 0.78, fmt_change(q), color=color, fontsize=15,
                       fontweight="bold", va="center", ha="right")
        ax_bg.text(x0 + cw - 0.22, y0 + ch - 0.30, q.get("period", ""), color=MUTED, fontsize=9.5,
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

    fig.text(0.5, 0.12 / H, "Источники: Yahoo Finance, ЦБ РФ, Мосбиржа · данные могут запаздывать",
             color="#5d6778", fontsize=9, ha="center", va="center")
    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor=BG)
    plt.close(fig)
    return buf.getvalue()
