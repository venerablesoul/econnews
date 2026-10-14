"""
Необязательно: короткий разбор важных новостей с помощью ИИ (Claude).

Включается, только если задан секрет ANTHROPIC_API_KEY. Для каждой важной новости ИИ пишет
одно предложение по-русски — что произошло и почему это важно для рынков — и называет активы,
на которые новость может повлиять, с направлением (↑/↓).
Без ключа ничего не происходит: новости работают как раньше.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request

API_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MODEL = "claude-haiku-5-5"

PROMPT = """Ты — аналитик финансового терминала. Ниже пронумерованные экономические новости (заголовок и анонс).
Для каждой новости верни объект:
  "i": номер новости,
  "sum": одно короткое предложение по-русски (до 160 символов): что произошло и почему это важно для рынков,
  "assets": до 3 активов, на которые новость может заметно повлиять: [{"a": "название актива", "d": "up" или "down"}].
     Названия: тикеры акций США (AAPL), индексы (S&P 500, Nasdaq, Мосбиржа), «нефть Brent», «золото», «доллар», «евро»,
     «рубль», «UST 10Y», «биткоин». Если влияние неочевидно — пустой список.
Ответь ТОЛЬКО JSON-массивом без пояснений.

Новости:
"""


def enabled():
    return bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())


def _call(prompt, key, model, timeout=40):
    body = json.dumps({"model": model, "max_tokens": 1500, "temperature": 0,
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request(API_URL, data=body, headers={
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read().decode("utf-8"))
    return "".join(b.get("text", "") for b in data.get("content") or [] if b.get("type") == "text")


def parse_answer(text, n):
    m = re.search(r"\[.*\]", text or "", re.S)
    if not m:
        return {}
    try:
        arr = json.loads(m.group(0))
    except ValueError:
        return {}
    out = {}
    for x in arr if isinstance(arr, list) else []:
        if not isinstance(x, dict):
            continue
        try:
            i = int(x.get("i"))
        except (TypeError, ValueError):
            continue
        if not 1 <= i <= n:
            continue
        s = str(x.get("sum") or "").strip()[:220]
        assets = []
        for a in x.get("assets") or []:
            if isinstance(a, dict) and a.get("a") and a.get("d") in ("up", "down"):
                assets.append({"a": str(a["a"])[:24], "d": a["d"]})
        if s:
            out[i] = {"sum": s, "assets": assets[:3]}
    return out


def annotate(items, limit=8, call=None):
    """Добавляет it["ai"] важным новостям без разбора. Возвращает число разобранных."""
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key and call is None:
        return 0
    todo = [it for it in items if not it.get("ai")][:limit]
    if not todo:
        return 0
    lines = []
    for k, it in enumerate(todo, 1):
        lead = it.get("lead") or ""
        lines.append(f"{k}. {it['title']}" + (f" — {lead[:300]}" if lead else ""))
    model = os.environ.get("AI_MODEL", "").strip() or DEFAULT_MODEL
    try:
        text = (call or _call)(PROMPT + "\n".join(lines), key, model)
    except Exception as e:
        print(f"  ! ИИ-разбор новостей: {type(e).__name__}: {e}"[:200])
        return 0
    res = parse_answer(text, len(todo))
    for k, it in enumerate(todo, 1):
        if k in res:
            it["ai"] = res[k]
    return len(res)
