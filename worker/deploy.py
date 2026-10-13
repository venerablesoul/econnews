#!/usr/bin/env python3
"""
Помощник автодеплоя сервера бота (запускается из .github/workflows/worker.yml).

  python worker/deploy.py prepare   — аккаунт Cloudflare, хранилище подписчиков (KV), адрес *.workers.dev
  python worker/deploy.py secrets   — файл с секретами для `wrangler secret bulk` (из секретов GitHub)
  python worker/deploy.py telegram  — проверка сервера, вебхук и меню бота, отчёт владельцу в Telegram
  python worker/deploy.py config    — docs/config.json с адресом сервера (для бота и терминала)

Ключи выводятся из токена бота теми же формулами, что в worker/src/index.js и news_bot.py.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

CF = "https://api.cloudflare.com/client/v4"
WORKER_NAME = "econnews-bot"
KV_TITLE = "econnews-subs"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def fail(msg):
    print(f"::error::{msg}")
    sys.exit(1)


def env(name):
    return os.environ.get(name, "").strip()


def github_env(**kv):
    """Передать значения следующим шагам workflow."""
    path = env("GITHUB_ENV")
    for k, v in kv.items():
        os.environ[k] = v
        if path:
            with open(path, "a", encoding="utf-8") as f:
                f.write(f"{k}={v}\n")


def http(method, url, body=None, headers=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json", "User-Agent": "econnews-deploy"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except ValueError:
            return e.code, {}


def cf(method, path, body=None):
    status, d = http(method, CF + path, body, {"Authorization": "Bearer " + env("CLOUDFLARE_API_TOKEN")})
    return status, d


def cf_errors(d):
    return "; ".join(f"{e.get('code')}: {e.get('message')}" for e in d.get("errors") or []) or "неизвестная ошибка"


# ---------------------------------------------------------------------------
def prepare():
    if not env("CLOUDFLARE_API_TOKEN"):
        fail("Не задан секрет CLOUDFLARE_API_TOKEN. GitHub → Settings → Secrets and variables → Actions → "
             "New repository secret. Как получить токен — в README, раздел «Сервер бота».")
    if not env("TELEGRAM_BOT_TOKEN"):
        fail("Не задан секрет TELEGRAM_BOT_TOKEN (тот же, что использует основной бот).")

    acc = env("CLOUDFLARE_ACCOUNT_ID")
    if not acc:
        status, d = cf("GET", "/accounts?per_page=50")
        accounts = d.get("result") or []
        if status != 200 or not accounts:
            fail("Токен Cloudflare не подошёл (" + cf_errors(d) + "). Создайте токен по шаблону "
                 "«Edit Cloudflare Workers» и сохраните его в секрет CLOUDFLARE_API_TOKEN.")
        acc = accounts[0]["id"]
        if len(accounts) > 1:
            print(f"У токена несколько аккаунтов, беру первый: {accounts[0].get('name')}. "
                  "Другой можно указать секретом CLOUDFLARE_ACCOUNT_ID.")

    # хранилище подписчиков
    status, d = cf("GET", f"/accounts/{acc}/storage/kv/namespaces?per_page=100")
    if status != 200:
        fail("Нет доступа к Workers KV (" + cf_errors(d) + "). У токена должно быть право «Workers KV Storage: Edit» "
             "— оно есть в шаблоне «Edit Cloudflare Workers».")
    kv = next((n["id"] for n in d.get("result") or [] if n.get("title") == KV_TITLE), "")
    if not kv:
        status, d = cf("POST", f"/accounts/{acc}/storage/kv/namespaces", {"title": KV_TITLE})
        if status != 200:
            fail("Не удалось создать хранилище подписчиков: " + cf_errors(d))
        kv = d["result"]["id"]
        print("Создано хранилище подписчиков", KV_TITLE)

    # адрес вида <имя>.workers.dev (у нового аккаунта его может не быть — создаём)
    status, d = cf("GET", f"/accounts/{acc}/workers/subdomain")
    sub = ((d.get("result") or {}).get("subdomain") or "") if status == 200 else ""
    if not sub:
        wanted = "econnews-" + hashlib.sha1(acc.encode()).hexdigest()[:6]
        status, d = cf("PUT", f"/accounts/{acc}/workers/subdomain", {"subdomain": wanted})
        if status != 200:
            fail("Не удалось включить адрес workers.dev (" + cf_errors(d) + "). Откройте один раз "
                 "dash.cloudflare.com → Workers & Pages — Cloudflare создаст его сам — и запустите деплой снова.")
        sub = (d.get("result") or {}).get("subdomain") or wanted
        print("Создан адрес", sub + ".workers.dev")

    toml = os.path.join(HERE, "wrangler.toml")
    with open(toml, encoding="utf-8") as f:
        text = f.read()
    text = re.sub(r'(binding\s*=\s*"SUBS"\s*\n\s*id\s*=\s*")[^"]*(")', r"\g<1>" + kv + r"\g<2>", text)
    with open(toml, "w", encoding="utf-8") as f:
        f.write(text)

    url = f"https://{WORKER_NAME}.{sub}.workers.dev"
    github_env(CLOUDFLARE_ACCOUNT_ID=acc, WORKER_URL=url)
    print("Аккаунт:", acc[:6] + "…", "· сервер:", url)


def secrets():
    out = {
        "TELEGRAM_BOT_TOKEN": env("TELEGRAM_BOT_TOKEN"),
        "OWNER_ID": env("TELEGRAM_CHAT_ID"),
        "FINNHUB_API_KEY": env("FINNHUB_API_KEY"),
        "EODHD_API_KEY": env("EODHD_API_KEY"),
        "TERMINAL_PASSWORD": env("TERMINAL_PASSWORD"),
    }
    out = {k: v for k, v in out.items() if v}
    path = os.path.join(HERE, ".secrets.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f)
    os.chmod(path, 0o600)
    print("Секреты для сервера:", ", ".join(sorted(out)))
    for k in ("FINNHUB_API_KEY", "EODHD_API_KEY"):
        if k not in out:
            print(f"::warning::Нет секрета {k} — соответствующие котировки в терминале работать не будут.")


def tg(method, body=None):
    status, d = http("POST", f"https://api.telegram.org/bot{env('TELEGRAM_BOT_TOKEN')}/{method}", body or {})
    return d


def telegram():
    url = env("WORKER_URL")
    token = env("TELEGRAM_BOT_TOKEN")
    pages = env("PAGES_URL").rstrip("/") + "/"
    # 1) сервер отвечает? (новый адрес workers.dev иногда включается до минуты)
    ok = False
    for _ in range(18):
        status, d = http("GET", url + "/")
        if status == 200 and d.get("ok"):
            ok = True
            break
        time.sleep(10)
    if not ok:
        fail(f"Сервер {url} не отвечает. Проверьте в dash.cloudflare.com → Workers & Pages → {WORKER_NAME}.")

    sync = hashlib.sha256(("econnews-sync:" + token).encode()).hexdigest()
    hook = hashlib.sha256(("econnews-hook:" + token).encode()).hexdigest()[:48]
    status, d = http("GET", url + "/subs", headers={"Authorization": "Bearer " + sync})
    if status != 200:
        fail("Сервер запущен, но не видит токен бота или хранилище (ответ /subs: %s %s). "
             "Проверьте секрет TELEGRAM_BOT_TOKEN." % (status, d))
    n_subs = len(d.get("ids") or [])

    # 2) Telegram: вебхук, команды, кнопка меню
    r = tg("setWebhook", {"url": url + "/tg", "secret_token": hook, "allowed_updates": ["message", "callback_query"],
                          "max_connections": 20})
    if not r.get("ok"):
        fail("Telegram не принял вебхук: " + str(r.get("description")))
    tg("setMyCommands", {"commands": [
        {"command": "news", "description": "Главные новости за сутки"},
        {"command": "markets", "description": "Рынки сейчас"},
        {"command": "calendar", "description": "Календарь событий"},
        {"command": "trades", "description": "Сделки политиков США и инсайдеров"},
        {"command": "start", "description": "Подписаться на новости"},
        {"command": "stop", "description": "Отписаться"},
    ]})
    if pages.startswith("https://"):
        tg("setChatMenuButton", {"menu_button": {"type": "web_app", "text": "Терминал",
                                                 "web_app": {"url": pages + "terminal/"}}})
    info = tg("getWebhookInfo").get("result") or {}
    if info.get("url") != url + "/tg":
        fail("Вебхук не установился: " + json.dumps(info, ensure_ascii=False))

    # 3) котировки через сервер
    status, q = http("GET", url + "/api/quotes")
    stocks = len((q or {}).get("stocks") or {})
    errors = (q or {}).get("errors") or []

    # 4) отчёт владельцу
    owner = env("TELEGRAM_CHAT_ID")
    mark = lambda name: "✅" if env(name) else "—"
    text = (
        "✅ <b>Сервер бота работает</b>\n"
        f"Адрес: {url}\n"
        "Бот мгновенно отвечает на /start и команды — круглосуточно.\n"
        f"Подписчиков: <b>{n_subs}</b> (вы получаете новости всегда)\n\n"
        f"{mark('FINNHUB_API_KEY')} бесплатный ключ (Finnhub) — акции США в терминале для всех"
        + (f" (получено котировок: {stocks})" if stocks else "") + "\n"
        f"{mark('EODHD_API_KEY')} платный ключ (EODHD) — только для вас\n"
        f"{mark('TERMINAL_PASSWORD')} пароль владельца для терминала в браузере\n"
        + (f"\n⚠️ {'; '.join(errors)}\n" if errors and env('FINNHUB_API_KEY') else "")
        + "\nЧтобы терминал узнал вас и включил платные данные, откройте его кнопкой «🖥 Терминал» в этом чате."
    )
    if owner:
        tg("sendMessage", {"chat_id": owner, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True})
    print(re.sub(r"<[^>]+>", "", text))


def config():
    path = os.path.join(ROOT, "docs", "config.json")
    data = {}
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, ValueError):
        pass
    data["api"] = env("WORKER_URL")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("docs/config.json:", data)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    {"prepare": prepare, "secrets": secrets, "telegram": telegram, "config": config}.get(cmd, lambda: fail("команда?"))()
