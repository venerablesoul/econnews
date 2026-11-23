"""
Texts for the Telegram bot and the data files: English, Russian, Chinese (simplified) and Arabic.

English is the default. Each subscriber picks a language with /lang (stored by the bot server);
the news bot builds every message once per language and sends each person their version.
A text missing in some language falls back to English.
"""
from __future__ import annotations

DEFAULT = "en"
LANGS = ("en", "ru", "zh", "ar")

MONTHS = {
    "en": ["January", "February", "March", "April", "May", "June", "July", "August",
           "September", "October", "November", "December"],
    "ru": ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
           "сентября", "октября", "ноября", "декабря"],
    "zh": ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
    "ar": ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس",
           "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
}

S = {
    "tz": {"en": "MSK", "ru": "МСК", "zh": "莫斯科时间", "ar": "بتوقيت موسكو"},
    "read": {"en": "read →", "ru": "читать →", "zh": "阅读 →", "ar": "اقرأ ←"},
    "top": {"en": "🔴 <b>TOP</b>", "ru": "🔴 <b>ГЛАВНОЕ</b>", "zh": "🔴 <b>要闻</b>", "ar": "🔴 <b>الأهم</b>"},
    "also": {"en": "🟡 <b>ALSO</b>", "ru": "🟡 <b>ТАКЖЕ</b>", "zh": "🟡 <b>其他</b>", "ar": "🟡 <b>أيضًا</b>"},
    "started": {
        "en": ("✅ <b>Economic news bot is running</b>\n"
               "Watching {n} sources, checking every ~5 minutes.\n"
               "9:00 MSK — overnight highlights and today's calendar, 21:00 — the day in review.\n"
               "An hour before key data (inflation, Fed/ECB decisions) you get a reminder.\n"
               "Русский язык: /lang ru · 中文: /lang zh · العربية: /lang ar"),
        "ru": ("✅ <b>Бот экономических новостей запущен</b>\n"
               "Слежу за {n} источниками, проверка каждые ~5 минут.\n"
               "В 9:00 МСК — главное за ночь и календарь дня, в 21:00 — итоги дня.\n"
               "За час до важных данных (инфляция, ставки ФРС/ЕЦБ) пришлю напоминание."),
        "zh": ("✅ <b>经济新闻机器人已启动</b>\n"
               "正在关注 {n} 个信息源，约每 5 分钟检查一次。\n"
               "莫斯科时间 9:00 推送隔夜要闻和今日日历，21:00 推送当日回顾。\n"
               "重要数据（通胀、美联储/欧洲央行决议）公布前一小时会提醒您。"),
        "ar": ("✅ <b>بوت الأخبار الاقتصادية يعمل</b>\n"
               "أتابع {n} مصدرًا وأتحقق كل 5 دقائق تقريبًا.\n"
               "الساعة 9:00 بتوقيت موسكو: أبرز أخبار الليل وأجندة اليوم، والساعة 21:00: حصاد اليوم.\n"
               "قبل ساعة من البيانات المهمة (التضخم، قرارات الاحتياطي الفيدرالي والمركزي الأوروبي) يصلك تذكير."),
    },
    "nothing_yet": {"en": "Nothing significant yet — I'll send it as soon as it appears.",
                    "ru": "Пока ничего значимого — пришлю, как только появится.",
                    "zh": "暂无重要消息，一有新消息就发给您。",
                    "ar": "لا جديد مهمًا حتى الآن، وسأرسله فور ظهوره."},
    "batch_head": {"en": "📰 <b>Economy · {stamp} MSK</b>", "ru": "📰 <b>Экономика · {stamp} МСК</b>",
                   "zh": "📰 <b>经济 · 莫斯科时间 {stamp}</b>", "ar": "📰 <b>الاقتصاد · {stamp} بتوقيت موسكو</b>"},
    "more_on_page": {"en": "<i>…and {n} more on the Markets page</i>", "ru": "<i>…и ещё {n} — на странице «Рынок онлайн»</i>",
                     "zh": "<i>……另有 {n} 条，请见“市场”页面</i>", "ar": "<i>…و{n} أخرى في صفحة «الأسواق»</i>"},
    "soon_head": {"en": "⏰ <b>Key data soon</b>", "ru": "⏰ <b>Скоро важные данные</b>",
                  "zh": "⏰ <b>重要数据即将公布</b>", "ar": "⏰ <b>بيانات مهمة قريبًا</b>"},
    "in_min": {"en": "in {m} min · ", "ru": "через {m} мин · ", "zh": "{m} 分钟后 · ", "ar": "بعد {m} دقيقة · "},
    "released_head": {"en": "📊 <b>Data released</b>", "ru": "📊 <b>Вышли данные</b>",
                      "zh": "📊 <b>数据已公布</b>", "ar": "📊 <b>صدرت البيانات</b>"},
    "fcst": {"en": "fcst {v}", "ru": "прогноз {v}", "zh": "预期 {v}", "ar": "المتوقع {v}"},
    "prev": {"en": "prev {v}", "ru": "пред. {v}", "zh": "前值 {v}", "ar": "السابق {v}"},
    "above": {"en": "above forecast", "ru": "выше прогноза", "zh": "高于预期", "ar": "أعلى من المتوقع"},
    "below": {"en": "below forecast", "ru": "ниже прогноза", "zh": "低于预期", "ar": "أقل من المتوقع"},
    "inline": {"en": "as expected", "ru": "как ожидали", "zh": "符合预期", "ar": "كما كان متوقعًا"},
    "morning_head": {"en": "☀️ <b>Good morning! Overnight highlights</b>", "ru": "☀️ <b>Доброе утро! Главное за ночь</b>",
                     "zh": "☀️ <b>早上好！隔夜要闻</b>", "ar": "☀️ <b>صباح الخير! أبرز أخبار الليل</b>"},
    "quiet_night": {"en": "No significant news overnight.", "ru": "Ночью значимых новостей не было.",
                    "zh": "夜间没有重要新闻。", "ar": "لم تكن هناك أخبار مهمة خلال الليل."},
    "today_cal": {"en": "📅 <b>Today's calendar (MSK)</b>", "ru": "📅 <b>Сегодня в календаре (МСК)</b>",
                  "zh": "📅 <b>今日日历（莫斯科时间）</b>", "ar": "📅 <b>أجندة اليوم (بتوقيت موسكو)</b>"},
    "tomorrow_cal": {"en": "📅 <b>Tomorrow's calendar (MSK)</b>", "ru": "📅 <b>Завтра в календаре (МСК)</b>",
                     "zh": "📅 <b>明日日历（莫斯科时间）</b>", "ar": "📅 <b>أجندة الغد (بتوقيت موسكو)</b>"},
    "all_down": {"en": "⚠️ No source has answered for ~15 min. Probably a network problem on GitHub's side — "
                       "the bot keeps trying by itself.",
                 "ru": "⚠️ Ни один источник не отвечает уже ~15 мин. Скорее всего, проблемы с сетью у GitHub — "
                       "бот продолжает пробовать сам.",
                 "zh": "⚠️ 约 15 分钟内没有任何信息源响应。可能是 GitHub 一侧的网络问题，机器人会自动继续重试。",
                 "ar": "⚠️ لم يستجب أي مصدر منذ نحو 15 دقيقة. على الأرجح هي مشكلة في شبكة GitHub، والبوت يواصل المحاولة تلقائيًا."},
    # the bot's own health (owner only; sent only when it cannot fix things by itself)
    "part_failed": {"en": "⚠️ <b>Part of the bot is broken</b>: {part} — {err}\n"
                          "Everything else works. This needs a fix in the code; if it is still broken tomorrow, I'll say so again.",
                    "ru": "⚠️ <b>Сломалась часть бота</b>: {part} — {err}\n"
                          "Остальное работает. Нужна правка в коде; если завтра не починится — напомню.",
                    "zh": "⚠️ <b>机器人的部分功能出现故障</b>：{part} — {err}\n"
                          "其余功能正常。需要修改代码；如果明天仍未修复，我会再提醒您。",
                    "ar": "⚠️ <b>تعطّل جزء من البوت</b>: {part} — {err}\n"
                          "كل ما عداه يعمل. يحتاج الأمر إلى تعديل في الكود، وإن بقي معطلًا غدًا فسأذكّرك مجددًا."},
    "bot_failing": {"en": "⚠️ <b>The news bot keeps failing</b> ({n} runs in a row, ~{m} min): {err}\n"
                          "It keeps retrying by itself. If this does not clear up, the code or a key needs a fix.",
                    "ru": "⚠️ <b>Бот новостей не может отработать</b> ({n} раз подряд, ~{m} мин): {err}\n"
                          "Он продолжает пробовать сам. Если это не пройдёт — нужна правка кода или ключа.",
                    "zh": "⚠️ <b>新闻机器人持续运行失败</b>（连续 {n} 次，约 {m} 分钟）：{err}\n"
                          "它会自动继续重试。如果问题没有消失，需要修改代码或密钥。",
                    "ar": "⚠️ <b>بوت الأخبار يفشل باستمرار</b> ({n} مرات متتالية، نحو {m} دقيقة): {err}\n"
                          "يواصل المحاولة تلقائيًا. إن لم تنتهِ المشكلة فيجب تعديل الكود أو المفتاح."},
    "bot_recovered": {"en": "✅ <b>The news bot works again</b> after ~{m} min of failures.",
                      "ru": "✅ <b>Бот новостей снова работает</b> после ~{m} мин сбоев.",
                      "zh": "✅ <b>新闻机器人已恢复工作</b>，此前故障约 {m} 分钟。",
                      "ar": "✅ <b>عاد بوت الأخبار إلى العمل</b> بعد نحو {m} دقيقة من الأعطال."},
    "code_rejected": {"en": "⚠️ <b>New code on GitHub does not start</b> ({sha}): {err}\n"
                            "The bot keeps running the previous version and will pick up the next fixed commit by itself.",
                      "ru": "⚠️ <b>Новый код на GitHub не запускается</b> ({sha}): {err}\n"
                            "Бот работает на предыдущей версии и сам подхватит следующий исправленный коммит.",
                      "zh": "⚠️ <b>GitHub 上的新代码无法启动</b>（{sha}）：{err}\n"
                            "机器人继续运行上一版本，并会自动采用下一个修复后的提交。",
                      "ar": "⚠️ <b>الكود الجديد على GitHub لا يعمل</b> ({sha}): {err}\n"
                            "يواصل البوت العمل بالإصدار السابق وسيعتمد تلقائيًا الإيداع المُصلَح التالي."},
    "went_down": {"en": "⚠️ Not responding for ~{h} h: {names}", "ru": "⚠️ Не отвечают уже ~{h} ч: {names}",
                  "zh": "⚠️ 已约 {h} 小时无响应：{names}", "ar": "⚠️ لا تستجيب منذ نحو {h} ساعة: {names}"},
    "came_back": {"en": "✅ Back online: {names}", "ru": "✅ Снова работают: {names}",
                  "zh": "✅ 已恢复：{names}", "ar": "✅ عادت للعمل: {names}"},
    "dead": {"en": "⚠️ <i>Not responding for several hours: {names}</i>", "ru": "⚠️ <i>Не отвечают несколько часов: {names}</i>",
             "zh": "⚠️ <i>数小时无响应：{names}</i>", "ar": "⚠️ <i>لا تستجيب منذ عدة ساعات: {names}</i>"},
    "chart_morning": {"en": "Morning market overview", "ru": "Утренний обзор рынков",
                      "zh": "早间市场概览", "ar": "نظرة صباحية على الأسواق"},
    "chart_evening": {"en": "Markets this evening", "ru": "Рынки к вечеру", "zh": "傍晚市场", "ar": "الأسواق مساءً"},
    "digest_head": {"en": "🗓 <b>Top stories of {day} {month}</b>\n<i>Significant stories in 24 h: {n}. Top {k}:</i>",
                    "ru": "🗓 <b>Главное за {day} {month}</b>\n<i>Значимых новостей за сутки: {n}. Топ-{k}:</i>",
                    "zh": "🗓 <b>{month}{day}日要闻</b>\n<i>24 小时内重要新闻 {n} 条，精选前 {k} 条：</i>",
                    "ar": "🗓 <b>أبرز أخبار {day} {month}</b>\n<i>الأخبار المهمة خلال 24 ساعة: {n}. أهم {k}:</i>"},
    "digest_empty": {"en": "No significant news.", "ru": "Значимых новостей не было.",
                     "zh": "没有重要新闻。", "ar": "لم تكن هناك أخبار مهمة."},
    "test": {"en": "👋 Test: the economic news bot is online.", "ru": "👋 Тест: бот экономических новостей на связи.",
             "zh": "👋 测试：经济新闻机器人在线。", "ar": "👋 اختبار: بوت الأخبار الاقتصادية متصل."},
    "btn_market": {"en": "📈 Markets", "ru": "📈 Рынок онлайн", "zh": "📈 市场", "ar": "📈 الأسواق"},
    "btn_terminal": {"en": "🖥 Terminal", "ru": "🖥 Терминал", "zh": "🖥 终端", "ar": "🖥 المنصة"},
    "btn_menu": {"en": "☰ Main menu", "ru": "☰ Главное меню", "zh": "☰ 主菜单", "ar": "☰ القائمة الرئيسية"},
    # charts.py
    "chart_title": {"en": "Markets", "ru": "Рынки", "zh": "市场", "ar": "الأسواق"},
    "chart_sources": {"en": "Sources: Yahoo Finance, Bank of Russia, Moscow Exchange · data may be delayed",
                      "ru": "Источники: Yahoo Finance, ЦБ РФ, Мосбиржа · данные могут запаздывать",
                      "zh": "来源：Yahoo Finance、俄罗斯央行、莫斯科交易所 · 数据可能有延迟",
                      "ar": "المصادر: Yahoo Finance، البنك المركزي الروسي، بورصة موسكو · قد تتأخر البيانات"},
    "period_5d": {"en": "5 days", "ru": "5 дней", "zh": "5 天", "ar": "5 أيام"},
    "period_30d": {"en": "30 days", "ru": "30 дней", "zh": "30 天", "ar": "30 يومًا"},
    # trades.py
    "trd_congress_head": {"en": "🏛 <b>US politicians' trades</b>", "ru": "🏛 <b>Сделки политиков США</b>",
                          "zh": "🏛 <b>美国政界人士交易</b>", "ar": "🏛 <b>صفقات السياسيين الأمريكيين</b>"},
    "trd_congress_note": {"en": "<i>Members of Congress disclose trades up to 45 days late.</i>",
                          "ru": "<i>Политики раскрывают сделки с опозданием до 45 дней.</i>",
                          "zh": "<i>国会议员最多可延迟 45 天披露交易。</i>",
                          "ar": "<i>يفصح أعضاء الكونغرس عن صفقاتهم بتأخير قد يصل إلى 45 يومًا.</i>"},
    "trd_insider_head": {"en": "💼 <b>Insider trades</b>", "ru": "💼 <b>Сделки инсайдеров</b>",
                         "zh": "💼 <b>内部人士交易</b>", "ar": "💼 <b>صفقات المطّلعين</b>"},
    "trd_insider_note": {"en": "<i>Company executives buying or selling their own stock.</i>",
                         "ru": "<i>Руководители компаний покупают или продают свои акции.</i>",
                         "zh": "<i>公司高管买卖本公司股票。</i>",
                         "ar": "<i>مديرو الشركات يشترون أسهم شركاتهم أو يبيعونها.</i>"},
    "trd_more": {"en": "<i>…and {n} more — in the terminal (TRD command)</i>", "ru": "<i>…и ещё {n} — в терминале (команда TRD)</i>",
                 "zh": "<i>……另有 {n} 笔，请见终端（TRD 命令）</i>", "ar": "<i>…و{n} أخرى في المنصة (الأمر TRD)</i>"},
    "trd_traded": {"en": "traded {d}, disclosed {d2}", "ru": "сделка {d}, раскрыта {d2}",
                   "zh": "交易 {d}，披露 {d2}", "ar": "الصفقة {d}، الإفصاح {d2}"},
    "trd_shares": {"en": "{n} shares at ${p}", "ru": "{n} акций по ${p}", "zh": "{n} 股，每股 ${p}", "ar": "{n} سهم بسعر ${p}"},
    "trd_report": {"en": "report", "ru": "отчёт", "zh": "报告", "ar": "التقرير"},
    "trd_form4": {"en": "Form 4", "ru": "форма 4", "zh": "Form 4", "ar": "النموذج 4"},
    "trd_no_amount": {"en": "amount not stated", "ru": "сумма не указана", "zh": "未注明金额", "ar": "المبلغ غير مذكور"},
    "trd_over": {"en": "over {v}", "ru": "более {v}", "zh": "超过 {v}", "ar": "أكثر من {v}"},
}

TRADE_TYPE = {
    "buy": {"en": "buy", "ru": "покупка", "zh": "买入", "ar": "شراء"},
    "sell": {"en": "sell", "ru": "продажа", "zh": "卖出", "ar": "بيع"},
    "sell_part": {"en": "partial sale", "ru": "частичная продажа", "zh": "部分卖出", "ar": "بيع جزئي"},
    "exchange": {"en": "exchange", "ru": "обмен", "zh": "置换", "ar": "مبادلة"},
}
_SPOUSE = {"en": "spouse", "ru": "супруг(а)", "zh": "配偶", "ar": "الزوج/الزوجة"}
_JOINT = {"en": "joint", "ru": "совместно", "zh": "共同持有", "ar": "ملكية مشتركة"}
_CHILD = {"en": "child", "ru": "ребёнок", "zh": "子女", "ar": "الابن/الابنة"}
TRADE_OWNER = {"SP": _SPOUSE, "Spouse": _SPOUSE, "JT": _JOINT, "Joint": _JOINT,
               "DC": _CHILD, "Child": _CHILD, "Dependent Child": _CHILD}

# news tags: stored in English, shown in the reader's language
TAGS_RU = {"Fed": "ФРС", "ECB": "ЕЦБ", "BankOfRussia": "ЦБРФ", "rates": "ставки", "inflation": "инфляция", "oil": "нефть",
           "gas": "газ", "gold": "золото", "ruble": "рубль", "dollar": "доллар", "bonds": "облигации",
           "markets": "рынки", "China": "Китай", "tariffs": "пошлины", "sanctions": "санкции", "jobs": "занятость",
           "GDP": "ВВП", "crypto": "крипта", "Russia": "Россия"}
TAGS_FROM_RU = {v: k for k, v in TAGS_RU.items()}
# Telegram hashtags take letters, digits and "_" only — no spaces
TAGS_XL = {
    "zh": {"Fed": "美联储", "ECB": "欧洲央行", "BankOfRussia": "俄罗斯央行", "rates": "利率", "inflation": "通胀",
           "oil": "石油", "gas": "天然气", "gold": "黄金", "ruble": "卢布", "dollar": "美元", "bonds": "债券",
           "markets": "市场", "China": "中国", "tariffs": "关税", "sanctions": "制裁", "jobs": "就业",
           "GDP": "GDP", "crypto": "加密货币", "Russia": "俄罗斯"},
    "ar": {"Fed": "الفيدرالي", "ECB": "المركزي_الأوروبي", "BankOfRussia": "المركزي_الروسي", "rates": "الفائدة",
           "inflation": "التضخم", "oil": "النفط", "gas": "الغاز", "gold": "الذهب", "ruble": "الروبل",
           "dollar": "الدولار", "bonds": "السندات", "markets": "الأسواق", "China": "الصين", "tariffs": "الرسوم_الجمركية",
           "sanctions": "العقوبات", "jobs": "الوظائف", "GDP": "الناتج_المحلي", "crypto": "العملات_المشفرة",
           "Russia": "روسيا"},
}

# news source names: stored in English, shown in the reader's language
SOURCES_RU = {"Fed": "ФРС США", "US Labor Statistics (BLS)": "Статистика труда США (BLS)", "ECB": "ЕЦБ",
              "Bank of England": "Банк Англии", "IMF": "МВФ", "Bank of Russia": "ЦБ РФ",
              "Kommersant": "Коммерсантъ", "RBC": "РБК"}
SOURCES_FROM_RU = {v: k for k, v in SOURCES_RU.items()}
SOURCES_XL = {
    "zh": {"Fed": "美联储", "US Labor Statistics (BLS)": "美国劳工统计局（BLS）", "ECB": "欧洲央行",
           "Bank of England": "英国央行", "IMF": "国际货币基金组织", "Bank of Russia": "俄罗斯央行",
           "Kommersant": "《生意人报》"},
    "ar": {"Fed": "الاحتياطي الفيدرالي", "US Labor Statistics (BLS)": "مكتب إحصاءات العمل الأمريكي (BLS)",
           "ECB": "البنك المركزي الأوروبي", "Bank of England": "بنك إنجلترا", "IMF": "صندوق النقد الدولي",
           "Bank of Russia": "البنك المركزي الروسي", "Kommersant": "كوميرسانت"},
}


# parts of a run (for the owner's notice when one of them is broken)
PARTS_RU = {"start message": "стартовое сообщение", "news": "новости", "reminders": "напоминания",
            "released data": "вышедшие данные", "morning digest": "утренний дайджест",
            "source alerts": "уведомления об источниках", "trades": "сделки", "chart": "картинка с графиками",
            "evening digest": "вечерний дайджест"}
PARTS_XL = {
    "zh": {"start message": "启动消息", "news": "新闻", "reminders": "提醒", "released data": "已公布数据",
           "morning digest": "早间摘要", "source alerts": "信息源通知", "trades": "交易", "chart": "行情图片",
           "evening digest": "晚间摘要"},
    "ar": {"start message": "رسالة البدء", "news": "الأخبار", "reminders": "التذكيرات", "released data": "البيانات الصادرة",
           "morning digest": "الملخص الصباحي", "source alerts": "تنبيهات المصادر", "trades": "الصفقات",
           "chart": "صورة الرسوم البيانية", "evening digest": "الملخص المسائي"},
}


def part(name, lang):
    lang = norm_lang(lang)
    if lang == "ru":
        return PARTS_RU.get(name, name)
    return (PARTS_XL.get(lang) or {}).get(name, name)


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
    lang = norm_lang(lang)
    if lang == "ru":
        return TAGS_RU.get(k, k)
    return (TAGS_XL.get(lang) or {}).get(k, k)


def source(name, lang):
    k = SOURCES_FROM_RU.get(name, name)
    lang = norm_lang(lang)
    if lang == "ru":
        return SOURCES_RU.get(k, k)
    return (SOURCES_XL.get(lang) or {}).get(k, k)


def trade_type(code, lang):
    e = TRADE_TYPE.get(code) or {}
    return e.get(norm_lang(lang)) or e.get(DEFAULT, code or "")


def trade_owner(code, lang):
    e = TRADE_OWNER.get(code or "") or {}
    return e.get(norm_lang(lang)) or e.get(DEFAULT, "")


# big numbers: "$1.2B" in English, "$1,2 млрд" in Russian, "$12亿" in Chinese, "$1.2 مليار" in Arabic
_UNITS = {
    "en": ((1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "K")),
    "ru": ((1e12, " трлн"), (1e9, " млрд"), (1e6, " млн"), (1e3, " тыс.")),
    "zh": ((1e12, "万亿"), (1e8, "亿"), (1e4, "万")),
    "ar": ((1e12, " تريليون"), (1e9, " مليار"), (1e6, " مليون"), (1e3, " ألف")),
}


def units(lang):
    """[(size, suffix), …] from the largest, for writing big amounts in the reader's language."""
    return _UNITS[norm_lang(lang)]
