"""
English / Russian texts for the Telegram bot and the data files.

English is the default. Each subscriber picks a language with /lang (stored by the bot server);
the news bot builds every message once per language and sends each person their version.
"""
from __future__ import annotations

DEFAULT = "en"
LANGS = ("en", "ru")

MONTHS = {
    "en": ["January", "February", "March", "April", "May", "June", "July", "August",
           "September", "October", "November", "December"],
    "ru": ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
           "сентября", "октября", "ноября", "декабря"],
}

S = {
    "tz": {"en": "MSK", "ru": "МСК"},
    "read": {"en": "read →", "ru": "читать →"},
    "top": {"en": "🔴 <b>TOP</b>", "ru": "🔴 <b>ГЛАВНОЕ</b>"},
    "also": {"en": "🟡 <b>ALSO</b>", "ru": "🟡 <b>ТАКЖЕ</b>"},
    "started": {
        "en": ("✅ <b>Economic news bot is running</b>\n"
               "Watching {n} sources, checking every ~5 minutes.\n"
               "9:00 MSK — overnight highlights and today's calendar, 21:00 — the day in review.\n"
               "An hour before key data (inflation, Fed/ECB decisions) you get a reminder.\n"
               "Русский язык: /lang ru"),
        "ru": ("✅ <b>Бот экономических новостей запущен</b>\n"
               "Слежу за {n} источниками, проверка каждые ~5 минут.\n"
               "В 9:00 МСК — главное за ночь и календарь дня, в 21:00 — итоги дня.\n"
               "За час до важных данных (инфляция, ставки ФРС/ЕЦБ) пришлю напоминание."),
    },
    "nothing_yet": {"en": "Nothing significant yet — I'll send it as soon as it appears.",
                    "ru": "Пока ничего значимого — пришлю, как только появится."},
    "batch_head": {"en": "📰 <b>Economy · {stamp} MSK</b>", "ru": "📰 <b>Экономика · {stamp} МСК</b>"},
    "more_on_page": {"en": "<i>…and {n} more on the Markets page</i>", "ru": "<i>…и ещё {n} — на странице «Рынок онлайн»</i>"},
    "soon_head": {"en": "⏰ <b>Key data soon</b>", "ru": "⏰ <b>Скоро важные данные</b>"},
    "in_min": {"en": "in {m} min · ", "ru": "через {m} мин · "},
    "released_head": {"en": "📊 <b>Data released</b>", "ru": "📊 <b>Вышли данные</b>"},
    "fcst": {"en": "fcst {v}", "ru": "прогноз {v}"},
    "prev": {"en": "prev {v}", "ru": "пред. {v}"},
    "above": {"en": "above forecast", "ru": "выше прогноза"},
    "below": {"en": "below forecast", "ru": "ниже прогноза"},
    "inline": {"en": "as expected", "ru": "как ожидали"},
    "morning_head": {"en": "☀️ <b>Good morning! Overnight highlights</b>", "ru": "☀️ <b>Доброе утро! Главное за ночь</b>"},
    "quiet_night": {"en": "No significant news overnight.", "ru": "Ночью значимых новостей не было."},
    "today_cal": {"en": "📅 <b>Today's calendar (MSK)</b>", "ru": "📅 <b>Сегодня в календаре (МСК)</b>"},
    "tomorrow_cal": {"en": "📅 <b>Tomorrow's calendar (MSK)</b>", "ru": "📅 <b>Завтра в календаре (МСК)</b>"},
    "all_down": {"en": "⚠️ No source responded. Probably a network problem on GitHub — I'll retry next run.",
                 "ru": "⚠️ Ни один источник не ответил. Возможно, проблемы с сетью у GitHub — проверю в следующий раз."},
    "went_down": {"en": "⚠️ Not responding for ~{h} h: {names}", "ru": "⚠️ Не отвечают уже ~{h} ч: {names}"},
    "came_back": {"en": "✅ Back online: {names}", "ru": "✅ Снова работают: {names}"},
    "dead": {"en": "⚠️ <i>Not responding for several hours: {names}</i>", "ru": "⚠️ <i>Не отвечают несколько часов: {names}</i>"},
    "chart_morning": {"en": "Morning market overview", "ru": "Утренний обзор рынков"},
    "chart_evening": {"en": "Markets this evening", "ru": "Рынки к вечеру"},
    "digest_head": {"en": "🗓 <b>Top stories of {day} {month}</b>\n<i>Significant stories in 24 h: {n}. Top {k}:</i>",
                    "ru": "🗓 <b>Главное за {day} {month}</b>\n<i>Значимых новостей за сутки: {n}. Топ-{k}:</i>"},
    "digest_empty": {"en": "No significant news.", "ru": "Значимых новостей не было."},
    "test": {"en": "👋 Test: the economic news bot is online.", "ru": "👋 Тест: бот экономических новостей на связи."},
    "btn_market": {"en": "📈 Markets", "ru": "📈 Рынок онлайн"},
    "btn_terminal": {"en": "🖥 Terminal", "ru": "🖥 Терминал"},
    # charts.py
    "chart_title": {"en": "Markets", "ru": "Рынки"},
    "chart_sources": {"en": "Sources: Yahoo Finance, Bank of Russia, Moscow Exchange · data may be delayed",
                      "ru": "Источники: Yahoo Finance, ЦБ РФ, Мосбиржа · данные могут запаздывать"},
    "period_5d": {"en": "5 days", "ru": "5 дней"},
    "period_30d": {"en": "30 days", "ru": "30 дней"},
    # trades.py
    "trd_congress_head": {"en": "🏛 <b>US politicians' trades</b>", "ru": "🏛 <b>Сделки политиков США</b>"},
    "trd_congress_note": {"en": "<i>Members of Congress disclose trades up to 45 days late.</i>",
                          "ru": "<i>Политики раскрывают сделки с опозданием до 45 дней.</i>"},
    "trd_insider_head": {"en": "💼 <b>Insider trades</b>", "ru": "💼 <b>Сделки инсайдеров</b>"},
    "trd_insider_note": {"en": "<i>Company executives buying or selling their own stock.</i>",
                         "ru": "<i>Руководители компаний покупают или продают свои акции.</i>"},
    "trd_more": {"en": "<i>…and {n} more — in the terminal (TRD command)</i>", "ru": "<i>…и ещё {n} — в терминале (команда TRD)</i>"},
    "trd_traded": {"en": "traded {d}, disclosed {d2}", "ru": "сделка {d}, раскрыта {d2}"},
    "trd_shares": {"en": "{n} shares at ${p}", "ru": "{n} акций по ${p}"},
    "trd_report": {"en": "report", "ru": "отчёт"},
    "trd_form4": {"en": "Form 4", "ru": "форма 4"},
    "trd_no_amount": {"en": "amount not stated", "ru": "сумма не указана"},
    "trd_over": {"en": "over {v}", "ru": "более {v}"},
}

TRADE_TYPE = {
    "buy": {"en": "buy", "ru": "покупка"}, "sell": {"en": "sell", "ru": "продажа"},
    "sell_part": {"en": "partial sale", "ru": "частичная продажа"}, "exchange": {"en": "exchange", "ru": "обмен"},
}
TRADE_OWNER = {
    "SP": {"en": "spouse", "ru": "супруг(а)"}, "Spouse": {"en": "spouse", "ru": "супруг(а)"},
    "JT": {"en": "joint", "ru": "совместно"}, "Joint": {"en": "joint", "ru": "совместно"},
    "DC": {"en": "child", "ru": "ребёнок"}, "Child": {"en": "child", "ru": "ребёнок"},
    "Dependent Child": {"en": "child", "ru": "ребёнок"},
}

# news tags: stored in English, shown in the reader's language
TAGS_RU = {"Fed": "ФРС", "ECB": "ЕЦБ", "BankOfRussia": "ЦБРФ", "rates": "ставки", "inflation": "инфляция", "oil": "нефть",
           "gas": "газ", "gold": "золото", "ruble": "рубль", "dollar": "доллар", "bonds": "облигации",
           "markets": "рынки", "China": "Китай", "tariffs": "пошлины", "sanctions": "санкции", "jobs": "занятость",
           "GDP": "ВВП", "crypto": "крипта", "Russia": "Россия"}
TAGS_FROM_RU = {v: k for k, v in TAGS_RU.items()}

# news source names: stored in English, shown in the reader's language
SOURCES_RU = {"Fed": "ФРС США", "US Labor Statistics (BLS)": "Статистика труда США (BLS)", "ECB": "ЕЦБ",
              "Bank of England": "Банк Англии", "IMF": "МВФ", "Bank of Russia": "ЦБ РФ",
              "Kommersant": "Коммерсантъ", "RBC": "РБК"}
SOURCES_FROM_RU = {v: k for k, v in SOURCES_RU.items()}


def norm_lang(lang):
    lang = (lang or "").strip().lower()[:2]
    return lang if lang in LANGS else DEFAULT


def t(lang, key, **kw):
    entry = S[key]
    s = entry.get(norm_lang(lang)) or entry[DEFAULT]
    return s.format(**kw) if kw else s


def month(lang, m):
    return MONTHS[norm_lang(lang)][m - 1]


def tag(tag_key, lang):
    k = TAGS_FROM_RU.get(tag_key, tag_key)
    return TAGS_RU.get(k, k) if norm_lang(lang) == "ru" else k


def source(name, lang):
    k = SOURCES_FROM_RU.get(name, name)
    return SOURCES_RU.get(k, k) if norm_lang(lang) == "ru" else k


def trade_type(code, lang):
    return (TRADE_TYPE.get(code) or {}).get(norm_lang(lang), code or "")


def trade_owner(code, lang):
    return (TRADE_OWNER.get(code or "") or {}).get(norm_lang(lang), "")
