"""
Список источников новостей.

kind:
  official — центробанки, статистика, МВФ: берём всё, это первоисточники
  econ     — экономические разделы СМИ: берём, если есть экономические слова
  general  — общие ленты: берём только при явных экономических словах в заголовке
tier: надёжность/вес источника (0..2), добавляется к оценке важности
categories: для лент с рубриками (РБК) — берём только эти рубрики

Чтобы добавить источник, допишите строку по образцу. Чтобы убрать — закомментируйте.
"""

GN = "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q="

SOURCES = [
    # ---------- Центробанки и официальная статистика ----------
    {"name": "ФРС США", "url": "https://www.federalreserve.gov/feeds/press_all.xml", "kind": "official", "tier": 2},
    {"name": "Статистика труда США (BLS)", "url": "https://www.bls.gov/feed/bls_latest.rss", "kind": "official", "tier": 2},
    # запасной канал: bls.gov часто отвечает 403 серверам GitHub
    {"name": "Статистика труда США (BLS)", "url": GN + "site:bls.gov+when:2d", "kind": "official", "tier": 2},
    {"name": "ЕЦБ", "url": "https://www.ecb.europa.eu/rss/press.html", "kind": "official", "tier": 2},
    {"name": "Банк Англии", "url": "https://www.bankofengland.co.uk/rss/news", "kind": "official", "tier": 2},
    {"name": "МВФ", "url": "https://www.imf.org/en/News/rss?language=eng", "kind": "official", "tier": 2},
    # запасной канал: imf.org блокирует запросы с серверов GitHub
    {"name": "МВФ", "url": GN + "site:imf.org+when:2d", "kind": "official", "tier": 2},
    {"name": "ЦБ РФ", "url": "https://www.cbr.ru/rss/eventrss", "kind": "official", "tier": 2},

    # ---------- Bloomberg ----------
    {"name": "Bloomberg", "url": "https://feeds.bloomberg.com/economics/news.rss", "kind": "econ", "tier": 1},
    {"name": "Bloomberg", "url": "https://feeds.bloomberg.com/markets/news.rss", "kind": "econ", "tier": 1},
    # запасной канал, если прямые ленты Bloomberg не отвечают
    {"name": "Bloomberg", "url": GN + "site:bloomberg.com+(economy+OR+inflation+OR+Fed+OR+ECB+OR+markets+OR+oil)+when:1d", "kind": "econ", "tier": 1},

    # ---------- BBC ----------
    {"name": "BBC", "url": "https://feeds.bbci.co.uk/news/business/rss.xml", "kind": "econ", "tier": 1},

    # ---------- Reuters (официальных RSS нет — через Google News) ----------
    {"name": "Reuters", "url": GN + "site:reuters.com+(economy+OR+inflation+OR+%22central+bank%22+OR+tariffs+OR+markets)+when:1d", "kind": "econ", "tier": 1},
    {"name": "Reuters", "url": GN + "site:reuters.com+(OPEC+OR+%22oil+prices%22+OR+China+economy+OR+PBOC+OR+yuan)+when:1d", "kind": "econ", "tier": 1},

    # ---------- Другие крупные деловые СМИ ----------
    {"name": "Financial Times", "url": "https://www.ft.com/global-economy?format=rss", "kind": "econ", "tier": 1},
    {"name": "CNBC", "url": "https://www.cnbc.com/id/20910258/device/rss/rss.html", "kind": "econ", "tier": 0},
    {"name": "MarketWatch", "url": "https://feeds.content.dowjones.io/public/rss/mw_topstories", "kind": "general", "tier": 0},
    {"name": "The Guardian", "url": "https://www.theguardian.com/business/economics/rss", "kind": "econ", "tier": 0},

    # ---------- Россия (немного) ----------
    {"name": "Коммерсантъ", "url": "https://www.kommersant.ru/RSS/section-economics.xml", "kind": "econ", "tier": 1},
    {"name": "РБК", "url": "https://rssexport.rbc.ru/rbcnews/news/30/full.rss", "kind": "general", "tier": 0,
     "categories": ["Экономика", "Финансы", "Бизнес"]},
]
