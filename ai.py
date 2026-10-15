"""
Optional (paid, off by default): short AI notes on important news (Claude).

Enabled only when the ANTHROPIC_API_KEY secret is set. For each important story the model writes one
sentence in English and one in Russian — what happened and why it matters for markets — and names
assets the story may move, with a direction (up/down). Without the key nothing happens.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request

API_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MODEL = "claude-haiku-5-5"

PROMPT = """You are an analyst for a financial terminal. Below are numbered economic news stories (headline and summary).
For each story return an object:
  "i": story number,
  "sum": one short English sentence (up to 160 characters): what happened and why it matters for markets,
  "sum_ru": the same sentence in Russian,
  "assets": up to 3 assets the story may noticeably move: [{"a": "asset name", "d": "up" or "down"}].
     Names: US stock tickers (AAPL), indices (S&P 500, Nasdaq, MOEX), "Brent", "gold", "USD", "EUR", "RUB",
     "UST 10Y", "bitcoin". If the effect is unclear, an empty list.
Reply with a JSON array ONLY, no explanations.

Stories:
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
        s_ru = str(x.get("sum_ru") or "").strip()[:220]
        assets = []
        for a in x.get("assets") or []:
            if isinstance(a, dict) and a.get("a") and a.get("d") in ("up", "down"):
                assets.append({"a": str(a["a"])[:24], "d": a["d"]})
        if s or s_ru:
            out[i] = {"sum": s or s_ru, "sum_ru": s_ru or s, "assets": assets[:3]}
    return out


def annotate(items, limit=8, call=None):
    """Adds it["ai"] to stories that have no note yet. Returns how many were annotated."""
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
        print(f"  ! AI notes: {type(e).__name__}: {e}"[:200])
        return 0
    res = parse_answer(text, len(todo))
    for k, it in enumerate(todo, 1):
        if k in res:
            it["ai"] = res[k]
    return len(res)
