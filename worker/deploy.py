#!/usr/bin/env python3
"""
Auto-deploy helper of the bot server (run by .github/workflows/worker.yml).

  python worker/deploy.py prepare   — Cloudflare account, subscriber storage (KV), the *.workers.dev address
  python worker/deploy.py secrets   — secrets file for `wrangler secret bulk` (from the GitHub secrets)
  python worker/deploy.py telegram  — server check, webhook and bot menu (English + Russian), report to the owner
  python worker/deploy.py config    — docs/config.json with the server address (for the bot and the terminal)

Keys are derived from the bot token with the same formulas as in worker/src/lib.js and news_bot.py.
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
    """Pass values to the next workflow steps."""
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
    except (urllib.error.URLError, OSError, ValueError) as e:
        # a new *.workers.dev address may take a while to appear in DNS — not an error, we retry
        print(f"  {method} {url.split('?')[0]}: {type(e).__name__}: {e}"[:200])
        return 0, {}


def cf(method, path, body=None):
    status, d = http(method, CF + path, body, {"Authorization": "Bearer " + env("CLOUDFLARE_API_TOKEN")})
    return status, d


def cf_errors(d):
    return "; ".join(f"{e.get('code')}: {e.get('message')}" for e in d.get("errors") or []) or "unknown error"


# ---------------------------------------------------------------------------
def prepare():
    if not env("CLOUDFLARE_API_TOKEN"):
        fail("The CLOUDFLARE_API_TOKEN secret is missing. GitHub → Settings → Secrets and variables → Actions → "
             "New repository secret. Create the token at dash.cloudflare.com → My Profile → API Tokens "
             "with the \"Edit Cloudflare Workers\" template.")
    if not env("TELEGRAM_BOT_TOKEN"):
        fail("The TELEGRAM_BOT_TOKEN secret is missing (the same one the news bot uses).")

    acc = env("CLOUDFLARE_ACCOUNT_ID")
    if not acc:
        status, d = cf("GET", "/accounts?per_page=50")
        accounts = d.get("result") or []
        if status != 200 or not accounts:
            fail("The Cloudflare token was rejected (" + cf_errors(d) + "). Create a token with the "
                 "\"Edit Cloudflare Workers\" template and save it as the CLOUDFLARE_API_TOKEN secret.")
        acc = accounts[0]["id"]
        if len(accounts) > 1:
            print(f"The token has several accounts, using the first: {accounts[0].get('name')}. "
                  "Another one can be set with the CLOUDFLARE_ACCOUNT_ID secret.")

    # subscriber storage
    status, d = cf("GET", f"/accounts/{acc}/storage/kv/namespaces?per_page=100")
    if status != 200:
        fail("No access to Workers KV (" + cf_errors(d) + "). The token needs \"Workers KV Storage: Edit\" "
             "— the \"Edit Cloudflare Workers\" template has it.")
    kv = next((n["id"] for n in d.get("result") or [] if n.get("title") == KV_TITLE), "")
    if not kv:
        status, d = cf("POST", f"/accounts/{acc}/storage/kv/namespaces", {"title": KV_TITLE})
        if status != 200:
            fail("Could not create the subscriber storage: " + cf_errors(d))
        kv = d["result"]["id"]
        print("Created the subscriber storage", KV_TITLE)

    # <name>.workers.dev address (a new account may not have one yet — create it)
    status, d = cf("GET", f"/accounts/{acc}/workers/subdomain")
    sub = ((d.get("result") or {}).get("subdomain") or "") if status == 200 else ""
    if not sub:
        wanted = "econnews-" + hashlib.sha1(acc.encode()).hexdigest()[:6]
        status, d = cf("PUT", f"/accounts/{acc}/workers/subdomain", {"subdomain": wanted})
        if status != 200:
            fail("Could not enable the workers.dev address (" + cf_errors(d) + "). Open "
                 "dash.cloudflare.com → Workers & Pages once — Cloudflare creates it — and run the deploy again.")
        sub = (d.get("result") or {}).get("subdomain") or wanted
        print("Created the address", sub + ".workers.dev")

    toml = os.path.join(HERE, "wrangler.toml")
    with open(toml, encoding="utf-8") as f:
        text = f.read()
    text = re.sub(r'(binding\s*=\s*"SUBS"\s*\n\s*id\s*=\s*")[^"]*(")', r"\g<1>" + kv + r"\g<2>", text)
    with open(toml, "w", encoding="utf-8") as f:
        f.write(text)

    url = f"https://{WORKER_NAME}.{sub}.workers.dev"
    github_env(CLOUDFLARE_ACCOUNT_ID=acc, WORKER_URL=url)
    print("Account:", acc[:6] + "…", "· server:", url)


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
    print("Server secrets:", ", ".join(sorted(out)))
    if "FINNHUB_API_KEY" not in out:
        print("::warning::No FINNHUB_API_KEY secret — US stock quotes and company data will not work (the key is free: finnhub.io).")
    if "EODHD_API_KEY" not in out:
        print("EODHD_API_KEY is not set — fine: world quotes come from free Yahoo Finance data (EODHD is an optional paid upgrade).")


def tg(method, body=None):
    status, d = http("POST", f"https://api.telegram.org/bot{env('TELEGRAM_BOT_TOKEN')}/{method}", body or {})
    return d


COMMANDS = [   # (command, English, Russian)
    ("news", "Top stories of the day", "Главные новости за сутки"),
    ("markets", "Markets now", "Рынки сейчас"),
    ("q", "Quotes: /q AAPL BTC oil", "Котировки: /q AAPL BTC нефть"),
    ("des", "Company: /des AAPL", "Компания: /des AAPL"),
    ("chart", "Chart: /chart AAPL 1y", "График: /chart AAPL 1y"),
    ("watch", "My watchlist: /watch AAPL", "Мой список: /watch AAPL"),
    ("port", "My portfolio", "Мой портфель"),
    ("alert", "Alert: /alert AAPL > 200", "Алерт: /alert AAPL > 200"),
    ("alerts", "My alerts", "Мои алерты"),
    ("map", "US market map", "Карта рынка США"),
    ("eqs", "Stock screener", "Скринер акций"),
    ("earnings", "Company earnings this week", "Отчёты компаний на неделе"),
    ("rates", "Bond yields", "Доходности облигаций"),
    ("cb", "Central bank rates", "Ставки центробанков"),
    ("wirp", "Fed rate expectations", "Ожидания по ставке ФРС"),
    ("calendar", "Economic calendar", "Календарь событий"),
    ("trades", "US politicians' and insiders' trades", "Сделки политиков США и инсайдеров"),
    ("lang", "Language: /lang en · /lang ru", "Язык: /lang ru · /lang en"),
    ("help", "All commands", "Все команды"),
    ("start", "Subscribe to the news", "Подписаться на новости"),
    ("stop", "Unsubscribe", "Отписаться"),
]


def telegram():
    url = env("WORKER_URL")
    token = env("TELEGRAM_BOT_TOKEN")
    pages = env("PAGES_URL").rstrip("/") + "/"
    # 1) is the server up? (a new workers.dev address sometimes takes up to a minute)
    ok = False
    for _ in range(36):   # up to ~6 minutes
        status, d = http("GET", url + "/")
        if status == 200 and d.get("ok"):
            ok = True
            break
        time.sleep(10)
    if not ok:
        fail(f"The server {url} does not respond. Check dash.cloudflare.com → Workers & Pages → {WORKER_NAME}.")

    sync = hashlib.sha256(("econnews-sync:" + token).encode()).hexdigest()
    hook = hashlib.sha256(("econnews-hook:" + token).encode()).hexdigest()[:48]
    status, d = http("GET", url + "/subs", headers={"Authorization": "Bearer " + sync})
    if status != 200:
        fail("The server runs but cannot see the bot token or the storage (/subs answered: %s %s). "
             "Check the TELEGRAM_BOT_TOKEN secret." % (status, d))
    n_subs = len(d.get("ids") or [])

    # 2) Telegram: webhook, command menu (English by default, Russian for Russian-language apps), menu button
    r = tg("setWebhook", {"url": url + "/tg", "secret_token": hook, "allowed_updates": ["message", "callback_query"],
                          "max_connections": 20})
    if not r.get("ok"):
        fail("Telegram rejected the webhook: " + str(r.get("description")))
    tg("setMyCommands", {"commands": [{"command": c, "description": en} for c, en, _ in COMMANDS]})
    tg("setMyCommands", {"commands": [{"command": c, "description": ru} for c, _, ru in COMMANDS], "language_code": "ru"})
    tg("setMyDescription", {"description": "Key economic news and markets: central bank rates, inflation, oil, currencies, "
                                           "company data, a watchlist, a portfolio and alerts. /lang ru — по-русски."})
    tg("setMyDescription", {"description": "Главные экономические новости и рынки: ставки ЦБ, инфляция, нефть, валюты, "
                                           "данные компаний, список, портфель и алерты.", "language_code": "ru"})
    if pages.startswith("https://"):
        tg("setChatMenuButton", {"menu_button": {"type": "web_app", "text": "Terminal",
                                                 "web_app": {"url": pages + "terminal/"}}})
    info = tg("getWebhookInfo").get("result") or {}
    if info.get("url") != url + "/tg":
        fail("The webhook was not set: " + json.dumps(info, ensure_ascii=False))

    # 3) quotes through the server
    status, q = http("GET", url + "/api/quotes")
    stocks = len((q or {}).get("stocks") or {})
    world = len((q or {}).get("world") or {})
    errors = (q or {}).get("errors") or []

    # 4) report to the owner
    owner = env("TELEGRAM_CHAT_ID")
    mark = lambda name: "✅" if env(name) else "—"
    text = (
        "✅ <b>The bot server is running</b>\n"
        f"Address: {url}\n"
        "The bot answers /start and commands instantly, around the clock.\n"
        f"Subscribers: <b>{n_subs}</b> (you always get the news)\n\n"
        f"{mark('FINNHUB_API_KEY')} free key (Finnhub) — US stocks and company data for everyone"
        + (f" (quotes received: {stocks})" if stocks else "") + "\n"
        f"✅ free world quotes (Yahoo Finance){f' — {world} instruments' if world else ''}\n"
        f"{mark('EODHD_API_KEY')} paid key (EODHD) — optional, only for you\n"
        f"{mark('TERMINAL_PASSWORD')} owner password for the terminal in a browser\n"
        + (f"\n⚠️ {'; '.join(errors)}\n" if errors else "")
        + "\nLanguage: /lang ru — по-русски. Open the terminal with the «🖥 Terminal» button so it recognises you."
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
    {"prepare": prepare, "secrets": secrets, "telegram": telegram, "config": config}.get(cmd, lambda: fail("command?"))()
