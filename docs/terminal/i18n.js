/* Terminal language: English by default, Russian with the EN/RU button (or ?lang=ru, which the bot's buttons add).
   The choice is remembered in this browser. Data stays language-neutral; this file holds every interface text
   in both languages and the names of instruments, sectors, tags and sources. */
(function(){
'use strict';
var KEY = 'lang';
function pick(){
  var q = null;
  try { q = new URLSearchParams(location.search).get('lang') } catch(e){}
  if (q === 'ru' || q === 'en') { try { localStorage.setItem(KEY, q) } catch(e){} return q }
  try { var s = localStorage.getItem(KEY); if (s === 'ru' || s === 'en') return s } catch(e){}
  return 'en';
}
var lang = pick(), RU = lang === 'ru';

// key: [English, Russian]; a value may be a function of arguments
var D = {
  // page
  title: ['Terminal', 'Терминал'],
  cmd_ph: ['command: WEI, FX, CRYPTO, N, ECO, TRD, GOLD, BTC, HELP…', 'команда: WEI, FX, CRYPTO, N, ECO, TRD, GOLD, BTC, HELP…'],
  cmd_ph_m: ['GOLD, BTC, N, HELP…', 'GOLD, BTC, N, HELP…'],
  lay_t: ['Layout: how many panels on screen', 'Раскладка: сколько панелей на экране'],
  st_data_t: ['Source of world market data', 'Источник данных по мировым рынкам'],
  st_crypto_t: ['Crypto: live exchange stream', 'Крипта: поток с биржи'],
  install: ['⤓ INSTALL', '⤓ УСТАНОВИТЬ'], install_t: ['Install as an app', 'Установить как приложение'],
  settings_t: ['Settings', 'Настройки'],
  lang_btn: ['RU', 'EN'], lang_btn_t: ['Русский язык', 'Switch to English'],
  p_mkt: ['WORLD MARKETS', 'МИРОВЫЕ РЫНКИ'], p_chart: ['CHART', 'ГРАФИК'], chart_mode_t: ['Switch the chart source', 'Переключить источник графика'],
  p_crypto: ['CRYPTOCURRENCIES', 'КРИПТОВАЛЮТЫ'], g_cap: ['Market cap', 'Капитализация'], g_btcd: ['BTC dominance', 'Доминация BTC'],
  g_fng: ['Fear / greed', 'Страх / жадность'],
  p_news: ['NEWS', 'НОВОСТИ'], search_ph: ['search…', 'поиск…'], f_all: ['ALL', 'ВСЕ'], f_high: ['🔴 TOP', '🔴 ВАЖНОЕ'],
  p_eco: ['CALENDAR · MSK', 'КАЛЕНДАРЬ · МСК'], swap_trd: ['⇄ TRADES', '⇄ СДЕЛКИ'],
  swap_trd_t: ["Show politicians' and insiders' trades", 'Показать сделки политиков и инсайдеров'],
  eco_macro: ['MACRO', 'МАКРО'], eco_earn: ['EARNINGS', 'ОТЧЁТЫ КОМПАНИЙ'],
  p_trd: ['TRADES', 'СДЕЛКИ'], swap_eco_t: ['Show the calendar', 'Показать календарь'],
  trd_cong: ['🏛 POLITICIANS', '🏛 ПОЛИТИКИ'], trd_ins: ['💼 INSIDERS', '💼 ИНСАЙДЕРЫ'], trd_buys: ['BUYS', 'ПОКУПКИ'],
  trd_buys_t: ['Buys only', 'Только покупки'], trd_ph: ['ticker or name…', 'тикер или имя…'],
  p_des: ['COMPANY', 'КОМПАНИЯ'],
  des_empty: ['Type a ticker and a function: <b>AAPL DES</b>, <b>NVDA FA</b>, <b>TSLA ERN</b>, <b>MSFT ANR</b>, <b>AMZN CN</b>. Moscow Exchange works too: <b>SBER DES</b>.',
    'Наберите тикер и функцию: <b>AAPL DES</b>, <b>NVDA FA</b>, <b>TSLA ERN</b>, <b>MSFT ANR</b>, <b>AMZN CN</b>. Работает и для Мосбиржи: <b>SBER DES</b>.'],
  p_hp: ['PRICE HISTORY', 'ИСТОРИЯ ЦЕН'], hp_tab: ['HP · TABLE', 'HP · ТАБЛИЦА'], comp_tab: ['COMP · COMPARE', 'COMP · СРАВНЕНИЕ'],
  hp_empty: ['Price history: <b>HP AAPL</b>, <b>HP BTC 5Y</b>, <b>HP SBER</b>. Several on one chart: <b>COMP AAPL MSFT NVDA</b>.',
    'История цен: <b>HP AAPL</b>, <b>HP BTC 5Y</b>, <b>HP SBER</b>. Сравнение на одном графике: <b>COMP AAPL MSFT NVDA</b>.'],
  p_eqs: ['US STOCK SCREENER', 'СКРИНЕР АКЦИЙ США'], loading: ['Loading', 'Загружаю'],
  p_imap: ['US MARKET MAP', 'КАРТА РЫНКА США'], im_day: ['TODAY', 'ЗА ДЕНЬ'], im_5d: ['5 DAYS', '5 ДНЕЙ'], im_ytd: ['YTD', 'С НАЧ. ГОДА'], im_1y: ['1 YEAR', 'ЗА ГОД'],
  p_gc: ['BONDS & RATES', 'ОБЛИГАЦИИ И СТАВКИ'], gc_tab: ['GC · CURVES', 'GC · КРИВЫЕ'], cb_tab: ['CB · CENTRAL BANKS', 'CB · СТАВКИ ЦБ'], wirp_tab: ['WIRP · FED', 'WIRP · ФРС'],
  p_my: ['MY', 'МОЁ'], w_tab: ['W · WATCHLIST', 'W · СПИСОК'], port_tab: ['PORT · PORTFOLIO', 'PORT · ПОРТФЕЛЬ'], alrt_tab: ['ALRT · ALERTS', 'ALRT · АЛЕРТЫ'],
  nav_mkt: ['MARKETS', 'РЫНКИ'], nav_chart: ['CHART', 'ГРАФИК'], nav_crypto: ['CRYPTO', 'КРИПТА'], nav_news: ['NEWS', 'НОВОСТИ'],
  nav_eco: ['CALENDAR', 'КАЛЕНДАРЬ'], nav_trd: ['TRADES', 'СДЕЛКИ'], nav_more_t: ['All functions', 'Все функции'],
  all_fn: ['ALL FUNCTIONS', 'ВСЕ ФУНКЦИИ'], commands: ['COMMANDS', 'КОМАНДЫ'], settings: ['SETTINGS', 'НАСТРОЙКИ'],
  help_intro: ['Type a command in the line at the top and press Enter (or GO). The "/" key puts the cursor into the command line.',
    'Наберите команду в строке сверху и нажмите Enter (или GO). Клавиша «/» ставит курсор в командную строку.'],
  help_outro: ['A click on a row in any table opens the chart, on a company ticker — its card. Russian commands work too: РЫНКИ, ВАЛЮТЫ, СЫРЬЁ, КРИПТА, НОВОСТИ, КАЛЕНДАРЬ, СДЕЛКИ, КОМПАНИЯ, СКРИНЕР, КАРТА, КРИВЫЕ, СТАВКИ, СПИСОК, ПОРТФЕЛЬ, АЛЕРТЫ.',
    'Нажатие на строку в любой таблице открывает график, на тикер компании — её карточку. Русские команды тоже работают: РЫНКИ, ВАЛЮТЫ, СЫРЬЁ, КРИПТА, НОВОСТИ, КАЛЕНДАРЬ, СДЕЛКИ, ПОЛИТИКИ, ИНСАЙДЕРЫ, КОМПАНИЯ, СКРИНЕР, КАРТА, КРИВЫЕ, СТАВКИ, СПИСОК, ПОРТФЕЛЬ, АЛЕРТЫ.'],
  set_data: ['<b style="color:var(--text)">Data.</b> News, the calendar and trades come from the bot (updated every ~5 minutes). Quotes are live through the bot server: US stocks (Finnhub), world indices, currencies, commodities and yields (Yahoo Finance) — all free. API keys are kept only on the server and never reach the browser.',
    '<b style="color:var(--text)">Данные.</b> Новости, календарь и сделки — из данных бота (обновление каждые ~5 минут). Котировки — онлайн через сервер бота: акции США (Finnhub), мировые индексы, валюты, сырьё и доходности (Yahoo Finance) — всё бесплатно. Ключи API хранятся только на сервере и в браузер не попадают.'],
  set_owner: ['<b style="color:var(--text)">Owner sign-in.</b> Open the terminal with the «🖥 Terminal» button in the bot chat — you are recognised automatically (your watchlist, portfolio and alerts are shared with the bot). In an ordinary browser, enter the owner password.',
    '<b style="color:var(--text)">Вход владельца.</b> Откройте терминал кнопкой «🖥 Терминал» в чате с ботом — вы определитесь автоматически (список, портфель и алерты будут общими с ботом). В обычном браузере — введите пароль владельца.'],
  pass_ph: ['owner password', 'пароль владельца'], login: ['Log in', 'Войти'], logout: ['Log out', 'Выйти'],
  set_install: ['<b style="color:var(--text)">Install as an app.</b> ', '<b style="color:var(--text)">Установить как приложение.</b> '],
  set_crypto: ['<b style="color:var(--text)">Crypto</b> comes straight from the Binance exchange in real time, no key needed. If Binance is unavailable, the terminal switches to CoinGecko (refreshed every minute).',
    '<b style="color:var(--text)">Крипта</b> идёт напрямую с биржи Binance в реальном времени, ключ не нужен. Если Binance недоступен, терминал переключится на CoinGecko (обновление раз в минуту).'],
  set_lang: ['<b style="color:var(--text)">Language.</b> ', '<b style="color:var(--text)">Язык.</b> '],
  // markets
  g_WEI: ['INDICES', 'ИНДЕКСЫ'], g_US: ['US STOCKS · LIVE', 'АКЦИИ США · ОНЛАЙН'], g_FX: ['CURRENCIES', 'ВАЛЮТЫ'], g_GLCO: ['COMMODITIES', 'СЫРЬЁ'],
  g_RATES: ['US YIELDS', 'ДОХОДНОСТИ США'],
  gu_WEI: ['points · daily change', 'цена в пунктах · изм. за день'], gu_US: ['$ per share · daily change', 'цена в $ за акцию · изм. за день'],
  gu_FX: ['rate · daily change', 'курс · изм. за день'], gu_GLCO: ['price · daily change', 'цена · изм. за день'], gu_RATES: ['% a year · change in bp', '% годовых · изм. в б.п.'],
  bp: [' bp', ' б.п.'], spread_10_3: ['10Y − 3M spread', 'Спред 10Y − 3M'], inverted: ['inverted', 'инверсия'], normal: ['normal', 'норма'],
  srv_down_retry: ['The bot server is not responding — retrying in a minute.', 'Сервер бота сейчас не отвечает — повторю через минуту.'],
  quotes_loading: ['Loading quotes…', 'Загрузка котировок…'],
  us_need_server: ['Live US stocks appear once the bot server is running.', 'Акции США онлайн появятся, когда заработает сервер бота.'],
  after_next_run: ['Appears after the next bot run', 'Появится после следующего запуска бота'],
  chart_prefix: ['CHART · ', 'ГРАФИК · '],
  updated_at: function(t){ return RU ? 'обновлено ' + t + ' МСК' : 'updated ' + t + ' MSK' },
  data_fail: ["Couldn't load the bot's data (docs/data.json).", 'Не удалось загрузить данные бота (docs/data.json).'],
  srv_errors: ['Bot server: ', 'Сервер бота: '], srv_quotes: ['Quotes from the bot server', 'Котировки с сервера бота'],
  srv_unavail: ['Bot server unavailable: ', 'Сервер бота недоступен: '],
  live_every: function(s){ return (RU ? 'онлайн · ' : 'live · ') + s + (RU ? ' с' : ' s') },
  bot_data_at: function(t){ return RU ? 'данные бота · ' + t + ' МСК' : 'bot data · ' + t + ' MSK' },
  srv_x: ['SERVER ✕', 'СЕРВЕР ✕'],
  // crypto
  c_coin: ['Coin', 'Монета'], c_price: ['Price, $', 'Цена, $'], c_24h: ['24h', '24ч'], c_range_t: ['Price position in the 24h range', 'Положение цены в диапазоне 24 ч'],
  c_live: ['Binance · real time', 'Binance · реальное время'], c_1min: ['CRYPTO 1 min', 'CRYPTO 1 мин'], c_gecko: ['CoinGecko · 1 min', 'CoinGecko · 1 мин'],
  c_gecko_note: ['Binance is unavailable — CoinGecko data, refreshed every minute.', 'Binance недоступен — данные CoinGecko, обновление раз в минуту.'],
  c_unavail: ['Crypto quotes are unavailable right now.', 'Котировки криптовалют сейчас недоступны.'],
  // chart
  tv_unavail_sw: ['TradingView is unavailable — showing the built-in chart. ⇄ — switch', 'TradingView недоступен — показан встроенный график. ⇄ — переключить'],
  tv_unavail: ['TradingView is unavailable — showing the built-in chart', 'TradingView недоступен — показан встроенный график'],
  tv_loading: ['Loading TradingView…', 'Загружаю TradingView…'],
  tv_failed: ["TradingView didn't open — showing the built-in chart. ⇄ — switch", 'TradingView не открылся — показан встроенный график. ⇄ — переключить'],
  tv_slow: ['TradingView is not responding — showing the built-in chart. ⇄ — switch', 'TradingView не отвечает — показан встроенный график. ⇄ — переключить'],
  own_nodata: ['No data for the built-in chart: ', 'Нет данных для встроенного графика: '], own_5d: ['  · 5 days', '  · 5 дней'],
  own_sub: ['built-in · bot data', 'встроенный · данные бота'],
  // news
  nothing: ['Nothing found', 'Ничего не найдено'], co_card_t: ['company card', 'карточка компании'],
  today: ['TODAY', 'СЕГОДНЯ'], yesterday: ['YESTERDAY', 'ВЧЕРА'], tomorrow: ['TOMORROW', 'ЗАВТРА'],
  // calendar
  eco_wait: ['The calendar appears after the next bot run.', 'Календарь появится после следующего запуска бота.'],
  imp_high: ['high impact', 'важное'], imp_med: ['medium impact', 'среднее'],
  fcst: ['fcst ', 'прогноз '], prev: ['prev ', 'пред. '], actual: ['actual ', 'факт '],
  next_in: ['Next key event in ', 'Следующее важное через '], no_more: ['No more key events this week', 'Важных событий на неделе больше нет'],
  dur: function(m){
    if (m >= 1440) return Math.floor(m / 1440) + (RU ? ' д ' : 'd ') + Math.floor(m % 1440 / 60) + (RU ? ' ч' : 'h');
    if (m >= 60) return Math.floor(m / 60) + (RU ? ' ч ' : 'h ') + (m % 60) + (RU ? ' мин' : 'm');
    return m + (RU ? ' мин' : ' min');
  },
  // trades
  t_buy: ['BUY', 'ПОКУПКА'], t_sell: ['SALE', 'ПРОДАЖА'], t_sell_part: ['PARTIAL SALE', 'ЧАСТ. ПРОДАЖА'], t_exchange: ['EXCHANGE', 'ОБМЕН'], t_trade: ['TRADE', 'СДЕЛКА'],
  o_spouse: ['spouse', 'супруг(а)'], o_joint: ['joint', 'совместно'], o_child: ['child', 'ребёнок'],
  no_amount: ['amount not stated', 'сумма не указана'], over: ['over ', 'более '],
  checked_at: function(t){ return RU ? 'проверено ' + t + ' МСК' : 'checked ' + t + ' MSK' },
  trd_note_c: ['Members of the US Congress must disclose trades within 45 days, amounts in ranges. Source: House and Senate reports.',
    'Члены Конгресса США обязаны раскрывать сделки в течение 45 дней, суммы — диапазонами. Источник: отчёты Палаты представителей и Сената.'],
  trd_note_i: ['Executives and directors of US companies: open-market buys from $25K and sales from $500K. Source: Form 4, SEC EDGAR.',
    'Руководители и директора компаний США: покупки от $25 тыс. и продажи от $500 тыс. на открытом рынке. Источник: форма 4, SEC EDGAR.'],
  trd_wait: ["Trades appear after the bot's next check.", 'Сделки появятся после следующей проверки бота.'],
  trd_none: ['No trades yet — the bot is loading reports.', 'Пока сделок нет — бот догружает отчёты.'],
  disclosed: ['DISCLOSED ', 'РАСКРЫТО '], trade_date: ['trade date', 'дата сделки'], open_chart: ['open the chart', 'открыть график'],
  shares_at: function(n, p){ return RU ? n + ' акций по $' + p : n + ' shares at $' + p },
  plan: [' · 10b5-1 plan', ' · по плану 10b5-1'], report: ['report ↗', 'отчёт ↗'], form4: ['Form 4 ↗', 'форма 4 ↗'],
  // settings
  tier_none: ["The bot server isn't set up yet — the terminal shows the bot's data.", 'Сервер бота ещё не настроен — терминал показывает данные бота.'],
  tier_owner: ['👑 You are signed in as the owner.', '👑 Вы вошли как владелец.'],
  tier_owner_paid: ['👑 You are signed in as the owner: the paid feed is on.', '👑 Вы вошли как владелец: платные данные включены.'],
  tier_tg: ['Opened from Telegram: your watchlist, portfolio and alerts are shared with the bot. Free live data.', 'Терминал открыт из Telegram: список, портфель и алерты общие с ботом. Бесплатные данные онлайн.'],
  tier_free: ['Now: free live data.', 'Сейчас: бесплатные данные онлайн.'],
  enter_pass: ['Enter the password.', 'Введите пароль.'], srv_not_set: ["The bot server isn't set up yet.", 'Сервер бота ещё не настроен.'],
  checking: ['Checking…', 'Проверяю…'], wrong_pass: ['Wrong password.', 'Неверный пароль.'],
  signed_in: ['Done: signed in as the owner on this device.', 'Готово: вы вошли как владелец на этом устройстве.'],
  no_answer: ["The server didn't answer: ", 'Сервер не ответил: '],
  pass_removed: ['Password removed. Inside Telegram the owner is recognised automatically.', 'Пароль удалён. Внутри Telegram владелец определяется автоматически.'],
  logged_out: ['You have logged out.', 'Вы вышли.'],
  inst_done: ['The terminal is already installed and open as an app.', 'Терминал уже установлен и открыт как приложение.'],
  inst_tg: ['Installing is not available inside Telegram: open the terminal in a browser (Chrome, Edge or Safari).', 'Внутри Telegram установка недоступна: откройте терминал в браузере (Chrome, Edge или Safari).'],
  inst_ios: ['On iPhone/iPad: open the page in Safari → "Share" → "Add to Home Screen".', 'На iPhone/iPad: откройте страницу в Safari → кнопка «Поделиться» → «На экран „Домой“».'],
  inst_btn: ['Press «⤓ INSTALL» at the top — the terminal appears on your desktop and opens in its own window.', 'Нажмите кнопку «⤓ УСТАНОВИТЬ» сверху — терминал появится на рабочем столе и будет открываться в своём окне.'],
  inst_other: ['In Chrome or Edge: the install icon in the address bar or menu ⋮ → "Install app". On Android: menu ⋮ → "Add to Home screen".',
    'В Chrome или Edge: значок установки в адресной строке или меню ⋮ → «Установить приложение». На Android: меню ⋮ → «Добавить на гл. экран».'],
  clock_open: ['market open', 'биржа открыта'], clock_closed: ['market closed', 'биржа закрыта'],
  // fn.js — common
  no_api: function(what){ return (what || (RU ? 'Эта функция' : 'This function')) + (RU ? ' работает через сервер бота, а он ещё не настроен (docs/config.json).' : " works through the bot server, which isn't set up yet (docs/config.json).") },
  load_fail: ["Couldn't load: ", 'Не удалось загрузить: '], srv_not_set_e: ['the bot server is not set up', 'сервер бота не настроен'],
  no_clip: ['no clipboard access', 'нет доступа к буферу обмена'],
  pick_t: ['Show another function in this panel', 'Поставить в эту панель другую функцию'], pick_head: ['Show in this panel:', 'Показать в этой панели:'],
  loading_x: function(s){ return (RU ? 'Загружаю ' : 'Loading ') + s },
  // panels and functions
  fn_mkt: ['World markets', 'Мировые рынки'], fn_chart: ['Chart', 'График'], fn_crypto: ['Cryptocurrencies', 'Криптовалюты'], fn_news: ['News', 'Новости'],
  fn_eco: ['Calendar and earnings', 'Календарь и отчёты'], fn_trd: ["Politicians' and insiders' trades", 'Сделки политиков и инсайдеров'],
  fn_des: ['Company: DES FA ERN ANR CN HDS', 'Компания: DES FA ERN ANR CN HDS'], fn_hp: ['Price history and comparison', 'История цен и сравнение'],
  fn_eqs: ['US stock screener', 'Скринер акций США'], fn_imap: ['US market map', 'Карта рынка США'], fn_gc: ['Bonds and rates: GC CB WIRP', 'Облигации и ставки: GC CB WIRP'],
  fn_my: ['Watchlist, portfolio, alerts', 'Список, портфель, алерты'],
  m_trd: ['Trades', 'Сделки'], m_des: ['Company', 'Компания'], m_hp: ['Price history', 'История цен'], m_comp: ['Comparison', 'Сравнение'],
  m_eqs: ['Screener', 'Скринер'], m_imap: ['Market map', 'Карта рынка'], m_gc: ['Yield curves', 'Кривые доходности'], m_cb: ['Central bank rates', 'Ставки ЦБ'],
  m_wirp: ['Fed expectations', 'Ожидания по ФРС'], m_w: ['My watchlist', 'Мой список'], m_port: ['Portfolio', 'Портфель'], m_alrt: ['Alerts', 'Алерты'],
  m_help: ['All commands', 'Все команды'],
  // DES
  company_x: function(s){ return (RU ? 'КОМПАНИЯ · ' : 'COMPANY · ') + s },
  co_card: ['Company card', 'Карточка компании'],
  moex_only_des: ['For Moscow Exchange shares only the DES card and the chart are available. Russian company financials are not connected yet.',
    'Для бумаг Мосбиржи доступна только карточка DES и график. Отчётность российских компаний пока не подключена.'],
  rec: [['STRONG BUY', 'BUY', 'HOLD', 'SELL', 'STRONG SELL'], ['АКТИВНО ПОКУПАТЬ', 'ПОКУПАТЬ', 'ДЕРЖАТЬ', 'ПРОДАВАТЬ', 'АКТИВНО ПРОДАВАТЬ']],
  rec_l: [['strong buy', 'buy', 'hold', 'sell', 'strong sell'], ['активно покупать', 'покупать', 'держать', 'продавать', 'активно продавать']],
  today_ch: [' today', ' за день'],
  k_lot: ['Lot', 'Лот'], k_issue: ['Shares issued', 'Выпуск'], k_mcap: ['Market cap', 'Капитал.'], k_list: ['Listing', 'Листинг'],
  k_dayhi: ['Day high', 'Макс. дня'], k_daylo: ['Day low', 'Мин. дня'], k_level: function(n){ return (RU ? 'уровень ' : 'level ') + n },
  k_pcs: [' sh.', ' шт.'],
  k_mcap_t: ['market capitalisation', 'рыночная капитализация'], k_pe_t: ['price / earnings, 12 months', 'цена / прибыль за 12 мес.'],
  k_fpe: ['Forward P/E', 'P/E форвард'], k_ps_t: ['price / sales', 'цена / выручка'], k_pb_t: ['price / book value', 'цена / балансовая стоимость'],
  k_div: ['Dividend', 'Дивиденды'], k_none: ['none', 'нет'], k_beta: ['Beta', 'Бета'], k_beta_t: ['sensitivity to the market', 'чувствительность к рынку'],
  k_eps: ['EPS (TTM)', 'EPS (12 мес.)'], k_revg: ['Revenue growth', 'Рост выручки'], k_epsg: ['EPS growth', 'Рост EPS'],
  k_gm: ['Gross margin', 'Вал. маржа'], k_om: ['Oper. margin', 'Опер. маржа'], k_nm: ['Net margin', 'Чист. маржа'],
  k_de: ['Debt/equity', 'Долг/капитал'], k_cr: ['Current ratio', 'Ликвидность'], k_shares: ['Shares', 'Акций'], k_mln: ['M', ' млн'],
  k_5d: ['5 days', '5 дней'], k_3m: ['3 months', '3 месяца'], k_ytd: ['YTD', 'С нач. года'], k_1y: ['1 year', 'За год'],
  r52_title: ['52-week range', 'Диапазон за 52 недели'],
  anr_line: function(w, sc, n){ return RU ? 'Аналитики: ' + w + ' · ' + sc + ' из 5 · ' + n + ' мнений' : 'Analysts: ' + w + ' · ' + sc + ' of 5 · ' + n + ' opinions' },
  next_rep: ['Next earnings: ', 'Следующий отчёт: '], bmo: [' before the open', ' до открытия'], amc: [' after the close', ' после закрытия'],
  eps_fcst: [' · EPS est. $', ' · прогноз EPS $'], rev_fcst: [', revenue ', ', выручка '],
  a_chart: ['📈 CHART', '📈 ГРАФИК'], a_watch: ['⭐ WATCH', '⭐ В СПИСОК'], a_alert: ['🔔 ALERT', '🔔 АЛЕРТ'], a_port: ['＋ PORTFOLIO', '＋ В ПОРТФЕЛЬ'],
  peers: ['Peers:', 'Похожие:'], part_fail: ["Some data didn't load: ", 'Часть данных не загрузилась: '],
  quarters: ['QUARTERS', 'КВАРТАЛЫ'], years: ['YEARS', 'ГОДЫ'],
  fa_sec_note: ['From SEC filings (10-Q, 10-K). Free cash flow = operating cash flow − capital expenditure.', 'По отчётам в SEC (10-Q, 10-K). Своб. денежный поток = операционный поток − капвложения.'],
  revenue: ['revenue', 'выручка'], net_income: ['net income', 'чистая прибыль'], profit: ['profit ', 'прибыль '], revenue_: ['revenue ', 'выручка '],
  fa_cols: [['Period', 'Revenue', 'Gross profit', 'Oper. income', 'Net income', 'EPS', 'Oper. cash flow', 'Free cash flow', 'Cash', 'Debt'],
    ['Период', 'Выручка', 'Вал. прибыль', 'Опер. прибыль', 'Чист. прибыль', 'EPS', 'Опер. поток', 'Своб. поток', 'Деньги', 'Долг']],
  fa_fh_note: function(s){ return RU ? 'Отчётность из SEC есть для ~110 крупнейших компаний США. Для ' + s + ' — показатели на акцию и рентабельность (Finnhub).'
    : 'SEC financials cover the ~110 largest US companies. For ' + s + ' — per-share figures and margins (Finnhub).' },
  fa_none: ['No financials found.', 'Отчётность не найдена.'],
  fa_fh_cols: [['Period', 'EPS', 'Revenue/share', 'Gross margin', 'Oper. margin', 'Net margin', 'ROE', 'Debt/equity'],
    ['Период', 'EPS', 'Выручка/акция', 'Вал. маржа', 'Опер. маржа', 'Чист. маржа', 'ROE', 'Долг/капитал']],
  ern_next: function(d, when, q, y){ return (RU ? 'Следующий отчёт: ' : 'Next earnings: ') + d + when + ' · Q' + q + ' ' + y },
  bmo_l: [' · before the market opens', ' · до открытия рынка'], amc_l: [' · after the close', ' · после закрытия'],
  ern_fcst: function(eps, rev){ return (RU ? 'Прогноз: EPS $' : 'Estimate: EPS $') + eps + (RU ? ' · выручка ' : ' · revenue ') + rev },
  ern_none: ['No earnings history.', 'Истории отчётов нет.'],
  est: ['estimate', 'прогноз'], beat: ['beat the estimate', 'факт лучше прогноза'], miss: ['missed', 'хуже'],
  ern_chart: ['EPS: actual vs estimate', 'Прибыль на акцию: факт против прогноза'], act_: ['actual $', 'факт $'], est_: ['estimate $', 'прогноз $'],
  ern_cols: [['Quarter', 'Period', 'Actual EPS', 'Estimate', 'Surprise'], ['Квартал', 'Отчётный период', 'Факт EPS', 'Прогноз', 'Сюрприз']],
  anr_none: ['No analyst ratings.', 'Рейтингов аналитиков нет.'],
  consensus: function(w, sc){ return (RU ? 'Консенсус: ' : 'Consensus: ') + w + ' · ' + sc + (RU ? ' из 5' : ' of 5') },
  anr_cols: [['Month', 'Distribution', 'Buy', 'Hold', 'Sell', 'Total'], ['Месяц', 'Распределение мнений', 'Купить', 'Держать', 'Продать', 'Всего']],
  cn_none: ['No fresh company news.', 'Свежих новостей по компании нет.'],
  hds_note: ['The largest holders (funds, 13F) are only in paid sources. Here — open-market trades by executives and directors (SEC Form 4).',
    'Крупнейшие держатели (фонды, 13F) есть только в платных источниках. Здесь — сделки руководства и директоров на открытом рынке (форма 4 SEC).'],
  hds_none: ['No open-market insider trades recently.', 'Сделок инсайдеров на открытом рынке за последнее время нет.'],
  hds_cols: [['Date', 'Who', 'Trade', 'Shares', 'Price', 'Value', 'Holding after'], ['Дата', 'Кто', 'Сделка', 'Акций', 'Цена', 'Сумма', 'Осталось']],
  // HP / COMP
  ranges: [{'1m': '1 month', '3m': '3 months', '6m': '6 months', ytd: 'year to date', '1y': '1 year', '2y': '2 years', '5y': '5 years'},
    {'1m': '1 мес.', '3m': '3 мес.', '6m': '6 мес.', ytd: 'с начала года', '1y': '1 год', '2y': '2 года', '5y': '5 лет'}],
  hp_ask: ['Type HP and a ticker: HP AAPL, HP BTC 5Y, HP SBER, HP OIL.', 'Наберите HP и тикер: HP AAPL, HP BTC 5Y, HP SBER, HP НЕФТЬ.'],
  hp_x: function(s){ return (RU ? 'ИСТОРИЯ ЦЕН' : 'PRICE HISTORY') + (s ? ' · ' + s : '') },
  over_range: function(r){ return (RU ? 'За ' : 'Over ') + r },
  hp_now: ['Now', 'Сейчас'], hp_min: ['Low', 'Мин.'], hp_max: ['High', 'Макс.'], hp_vol: ['Avg volume', 'Ср. объём'], hp_pts: ['Points', 'Точек'],
  csv_t: ['Download the table', 'Скачать таблицу'], save_fail: ["Couldn't save the file", 'Не удалось сохранить файл'],
  copy: ['⧉ COPY', '⧉ КОПИРОВАТЬ'], copy_t: ['Copy the table (for Excel)', 'Скопировать таблицу (для Excel)'], copied: ['✓ COPIED', '✓ СКОПИРОВАНО'],
  hp_cols: [['Date', 'Open', 'High', 'Low', 'Close', 'Chg', 'Volume'], ['Дата', 'Откр.', 'Макс.', 'Мин.', 'Закр.', 'Изм.', 'Объём']],
  comp_x: function(s){ return (RU ? 'СРАВНЕНИЕ' : 'COMPARISON') + (s ? ' · ' + s : '') },
  add_ticker: ['+ ticker', '+ тикер'], add: ['ADD', 'ДОБАВИТЬ'],
  comp_empty: ['Add 2–6 instruments: COMP AAPL MSFT NVDA, COMP S&P DAX IMOEX, COMP BTC GOLD. The chart shows the % change from the start of the period.',
    'Добавьте 2–6 инструментов: COMP AAPL MSFT NVDA, COMP S&P DAX IMOEX, COMP BTC ЗОЛОТО. График показывает изменение в % от начала периода.'],
  loading_d: ['Loading…', 'Загружаю…'], no_data: ['no data', 'нет данных'], no_data_c: ['No data', 'Нет данных'],
  not_loaded: [' · failed: ', ' · не загрузилось: '],
  // EQS
  eqs_p: [{'': 'ALL', leaders: 'GAINERS', losers: 'LOSERS', value: 'LOW P/E', div: 'DIVIDENDS', growth: 'REVENUE GROWTH', year: 'BEST 1Y'},
    {'': 'ВСЕ', leaders: 'ЛИДЕРЫ ДНЯ', losers: 'АУТСАЙДЕРЫ', value: 'ДЕШЁВЫЕ P/E', div: 'ДИВИДЕНДЫ', growth: 'РОСТ ВЫРУЧКИ', year: 'ЛУЧШИЕ ЗА ГОД'}],
  eqs_cols: [{s: 'Ticker', n: 'Company', sec: 'Sector', px: 'Price', ch: 'Day', mcap: 'Mkt cap', pe: 'P/E', fpe: 'Fwd P/E', dy: 'Div.', revg: 'Revenue', roe: 'ROE', rytd: 'YTD', r52: '1Y', beta: 'Beta'},
    {s: 'Тикер', n: 'Компания', sec: 'Сектор', px: 'Цена', ch: 'День', mcap: 'Кап.', pe: 'P/E', fpe: 'P/E ф.', dy: 'Див.', revg: 'Выручка', roe: 'ROE', rytd: 'С н.г.', r52: 'Год', beta: 'Бета'}],
  revg_t: ['revenue growth over a year', 'рост выручки за год'],
  eqs_wait: ["The screener's data appears after the next bot run (docs/stocks.json). ", 'Данные скринера появятся после следующего запуска бота (docs/stocks.json). '],
  n_companies: function(n){ return n + (RU ? ' компаний' : ' companies') },
  msk_at: function(t){ return t + (RU ? ' МСК' : ' MSK') },
  all_sectors: ['all sectors', 'все секторы'], f_mcap: ['mkt cap from, $B', 'кап. от, $ млрд'], f_pe: ['P/E from', 'P/E от'], f_to: ['to', 'до'],
  f_div: ['div. from, %', 'див. от, %'], f_q: ['search', 'поиск'], f_q_ph: ['ticker/name', 'тикер/название'],
  eqs_found: function(n){ return RU ? 'Найдено: ' + n + '. Нажмите на строку — карточка компании. Мультипликаторы обновляются раз в сутки (Finnhub), цены — каждые 5–10 минут (Yahoo).'
    : 'Found: ' + n + '. Click a row for the company card. Ratios refresh daily (Finnhub), prices every 5–10 minutes (Yahoo).' },
  // IMAP
  imap_wait: ['The map appears after the next bot run (docs/stocks.json).', 'Карта появится после следующего запуска бота (docs/stocks.json).'],
  imap_sub: function(t){ return RU ? 'цены ' + t + ' МСК · размер = капитализация' : 'prices ' + t + ' MSK · size = market cap' },
  imap_mcap_wait: ['Market caps are still loading — the map appears within an hour of the bot start.', 'Капитализации компаний ещё загружаются — карта появится в течение часа после запуска бота.'],
  mcap_s: [' · mkt cap ', ' · кап. '],
  // GC / CB / WIRP
  gc_wait: ['Curves and rates appear after the next bot run (docs/rates.json).', 'Кривые и ставки появятся после следующего запуска бота (docs/rates.json).'],
  gc_title: ['YIELD CURVES', 'КРИВЫЕ ДОХОДНОСТИ'], pick_countries: ['Choose countries.', 'Выберите страны.'],
  gc_note: function(d, m){ return RU ? 'Сплошная — сейчас (' + d + '), пунктир — неделю назад' + (m ? ', точки — месяц назад' : '') + '.' : 'Solid — now (' + d + '), dashed — a week ago' + (m ? ', dotted — a month ago' : '') + '.' },
  term: ['Term', 'Срок'], wk: ['wk', 'нед.'], wk_t: ['change over the week, bp', 'изменение за неделю, б.п.'], inv_s: ['inv.', 'инв.'],
  cb_title: ['CENTRAL BANK RATES', 'СТАВКИ ЦЕНТРОБАНКОВ'], cb_src: ['BIS · New York Fed · Bank of Russia', 'BIS · ФРБ Нью-Йорка · ЦБ РФ'],
  no_data_yet: ['No data yet.', 'Данных пока нет.'],
  cb_cols: [['Central bank', 'Rate', 'Was', 'Chg', 'Since', 'As of'], ['Центробанк', 'Ставка', 'Было', 'Изм.', 'С даты', 'Данные на']],
  cb_note: ['For the Fed — the federal funds target range. BIS data updates weekly; the Fed and Bank of Russia rates — daily.', 'Для ФРС — целевой диапазон ставки по федеральным фондам. Данные BIS обновляются раз в неделю; ставки ФРС и ЦБ РФ — каждый день.'],
  wirp_title: ['WIRP · FED RATE EXPECTATIONS', 'WIRP · ОЖИДАНИЯ ПО СТАВКЕ ФРС'], wirp_sub: ['fed funds futures', 'фьючерсы на ставку по фед. фондам'],
  wirp_wait: ['No data yet — it appears after the next update.', 'Данных пока нет — появятся после следующего обновления.'],
  w_target: ['Target range', 'Целевой диапазон'], w_effr: ['Effective rate', 'Эффективная ставка'], w_asof: ['As of', 'На дату'],
  wirp_cols: [['Meeting', 'Expected rate', 'Chg', 'vs now', 'Probabilities'], ['Заседание', 'Ожид. ставка', 'Изм.', 'К текущей', 'Вероятности']],
  w_probs: [{cut50: 'cut 0.5', cut: 'cut', hold: 'hold', hike: 'hike', hike50: 'hike 0.5'}, {cut50: 'снижение 0,5', cut: 'снижение', hold: 'без изменений', hike: 'повышение', hike50: 'повышение 0,5'}],
  wirp_note: ['The CME FedWatch method: the month average rate = 100 − futures price; the move at a meeting comes from the difference before and after the decision.',
    'Метод CME FedWatch: средняя ставка месяца = 100 − цена фьючерса; изменение на заседании выводится из разницы до и после решения.'],
  // W / PORT / ALRT
  not_saved: ["Not saved on the server: ", 'Не сохранилось на сервере: '],
  shared: ['☁ shared with the bot', '☁ общее с ботом'], local_only: ['this browser only', 'только в этом браузере'],
  w_ph: ['+ AAPL BTC SBER OIL', '+ AAPL BTC SBER НЕФТЬ'],
  w_empty: ['The watchlist is empty. Add instruments: US stocks (AAPL), Moscow Exchange (SBER), crypto (BTC), indices and commodities (S&P, OIL, GOLD). In Telegram — the /watch command.',
    'Список пуст. Добавьте инструменты: акции США (AAPL), Мосбиржи (SBER), крипту (BTC), индексы и сырьё (S&P, НЕФТЬ, ЗОЛОТО). В Telegram то же самое — команда /watch.'],
  w_cols: [['Ticker', 'Name', 'Price', 'Day', ''], ['Тикер', 'Название', 'Цена', 'День', '']],
  remove: ['remove', 'убрать'], w_note: ['Prices refresh every 30 seconds. Click a row for the card or the chart.', 'Цены обновляются каждые 30 секунд. Нажмите на строку — карточка или график.'],
  qty: ['qty', 'кол-во'], px_ph: ['price', 'цена'], px_t: ['empty — at the current price', 'пусто — по текущей цене'], sell: ['SELL', 'ПРОДАТЬ'],
  ticker: ['TICKER', 'ТИКЕР'], buy: ['BUY', 'КУПИТЬ'],
  port_empty: ['The portfolio is empty. Enter a ticker, a quantity and the purchase price (empty price — the current one). In Telegram: /buy AAPL 10 150.',
    'Портфель пуст. Введите тикер, количество и цену покупки (пустая цена — по текущей). В Telegram: /buy AAPL 10 150.'],
  port_cols: [['Ticker', 'Qty', 'Avg price', 'Price', 'Day', 'Value', 'P&L', '%', ''], ['Тикер', 'Кол-во', 'Ср. цена', 'Цена', 'День', 'Стоимость', 'Прибыль', '%', '']],
  remove_pos: ['remove the position', 'убрать позицию'], remove_q: function(s){ return RU ? 'Убрать ' + s + ' из портфеля?' : 'Remove ' + s + ' from the portfolio?' },
  total: ['TOTAL ', 'ИТОГО '], need_qty: ['Enter a ticker and a quantity', 'Укажите тикер и количество'],
  not_in_port: function(s){ return RU ? 'В портфеле нет ' + s : s + ' is not in the portfolio' },
  no_price_x: function(s){ return (RU ? 'нет цены ' : 'no price for ') + s },
  price_fail: function(e){ return RU ? 'Не удалось получить цену: ' + e + '. Укажите цену вручную.' : "Couldn't get the price: " + e + '. Enter the price yourself.' },
  alrt_fn: ['Alerts', 'Алерты'],
  alrt_signin: ['Alerts arrive as Telegram messages. Open the terminal with the «🖥 Terminal» button in the bot chat — or sign in with the owner password (SET command). In the bot itself: /alert AAPL > 200.',
    'Алерты приходят сообщением в Telegram. Откройте терминал кнопкой «🖥 Терминал» в чате с ботом — или войдите паролем владельца (команда SET). В самом боте: /alert AAPL > 200.'],
  alrt_ph: ['AAPL > 200 · BTC < 60000 · OIL 5% · NEWS FED', 'AAPL > 200 · BTC < 60000 · НЕФТЬ 5% · НОВОСТИ ФРС'], set_btn: ['SET', 'ПОСТАВИТЬ'],
  alrt_empty: ['No alerts. Examples: AAPL > 200 — price above; BTC < 60000 — below; OIL 5% — a daily move over 5%; NEWS FED — a story with this word. Checked every 2 minutes.',
    'Алертов нет. Примеры: AAPL > 200 — цена выше; BTC < 60000 — ниже; НЕФТЬ 5% — изменение за день больше 5%; НОВОСТИ ФРС — новость с этим словом. Проверка — каждые 2 минуты.'],
  alrt_cols: [['#', 'Condition', 'Now', 'Created', ''], ['№', 'Условие', 'Сейчас', 'Создан', '']],
  a_news: function(kw){ return (RU ? 'новость со словом «' : 'a story with the word «') + kw + '»' },
  a_chg: function(s, v){ return s + (RU ? ': изменение за день ±' : ': daily move ±') + v + '%' },
  a_px: function(s, op, v){ return s + (op === '>' ? (RU ? ' выше ' : ' above ') : (RU ? ' ниже ' : ' below ')) + v },
  del: ['delete', 'удалить'],
  // earnings tab
  earn_none: ['No earnings of the largest companies in the coming weeks (or the data is not loaded yet).', 'Отчётов крупнейших компаний в ближайшие недели нет (или данные ещё не загружены).'],
  earn_cols: [['Date', 'Company', 'EPS est.', 'EPS actual', 'Revenue est.'], ['Дата', 'Компания', 'EPS прогноз', 'EPS факт', 'Выручка прогноз']],
  bmo_s: ['☀ before open', '☀ до откр.'], amc_s: ['☾ after close', '☾ после закр.'],
  earn_wait: ['The earnings calendar appears after the next bot run.', 'Календарь отчётов появится после следующего запуска бота.']
};

// help table: [command, English, Russian]; a row with one cell is a section title
var HELP = [
  ['WEI', 'world stock indices', 'мировые фондовые индексы'],
  ['FX', 'currencies', 'валюты'],
  ['GLCO', 'commodities: oil, gas, metals, wheat', 'сырьё: нефть, газ, металлы, пшеница'],
  ['RATES', 'US Treasury yields and the 10Y − 3M spread', 'доходности гособлигаций США и спред 10 лет − 3 мес'],
  ['CRYPTO', 'cryptocurrencies in real time', 'криптовалюты в реальном времени'],
  ['N', "the bot's news feed (N OIL — search for a word)", 'лента новостей бота (N НЕФТЬ — поиск по слову)'],
  ['ECO', 'economic calendar', 'экономический календарь'],
  ['TRD', "US politicians' and insiders' trades (TRD NVDA — by ticker or name)", 'сделки политиков США и инсайдеров (TRD NVDA — по тикеру или имени)'],
  ['CONG, INS', "straight to politicians' / insiders' trades", 'сразу сделки политиков / инсайдеров'],
  ['GOLD, BRENT, SPX, DAX, BTC, ETH…', "open an instrument's chart", 'открыть график инструмента'],
  ['NASDAQ:AAPL, MOEX:SBER, AAPL', 'a TradingView chart of any ticker', 'график любого тикера TradingView'],
  ['US', 'live US stocks and ETFs (through the bot server)', 'акции и ETF США онлайн (через сервер бота)'],
  ['COMPANIES', 'КОМПАНИИ'],
  ['AAPL DES', 'company card: price, market cap, ratios, analysts, next earnings', 'карточка компании: цена, капитализация, мультипликаторы, аналитики, следующий отчёт'],
  ['AAPL FA', 'financials: revenue, profit, cash flow by quarter and year', 'отчётность: выручка, прибыль, денежный поток по кварталам и годам'],
  ['AAPL ERN', 'earnings: EPS actual vs estimate, the next date', 'отчёты: прибыль на акцию — факт против прогноза, дата следующего'],
  ['AAPL ANR', 'analyst ratings by month', 'рейтинги аналитиков по месяцам'],
  ['AAPL CN', 'company news', 'новости компании на русском'],
  ['AAPL HDS', 'insider trades of the company', 'сделки инсайдеров компании'],
  ['HP AAPL 5Y', 'price history as a table, CSV export (1M 3M 6M YTD 1Y 2Y 5Y)', 'история цен таблицей, выгрузка в CSV (1M 3M 6M YTD 1Y 2Y 5Y)'],
  ['COMP AAPL MSFT SPY', 'several instruments on one chart', 'сравнение нескольких инструментов на одном графике'],
  ['WHOLE MARKET', 'РЫНОК ЦЕЛИКОМ'],
  ['EQS', 'screener of ~110 largest US stocks: filters and sorting', 'скринер ~110 крупнейших акций США: фильтры и сортировка'],
  ['IMAP', 'US market heat map by sector', 'тепловая карта рынка США по секторам'],
  ['EVTS', 'earnings calendar of the largest companies', 'календарь отчётов крупнейших компаний'],
  ['GC', 'yield curves: US, Germany, UK, Japan, Russia', 'кривые доходности: США, Германия, Британия, Япония, Россия'],
  ['CB', 'central bank rates', 'ставки центробанков'],
  ['WIRP', 'Fed rate expectations for the next meetings', 'ожидания по ставке ФРС на ближайших заседаниях'],
  ['PERSONAL', 'ЛИЧНОЕ'],
  ['W AAPL BTC', 'watchlist (W — open, W AAPL — add)', 'список наблюдения (W — открыть, W AAPL — добавить)'],
  ['PORT', 'portfolio: positions, profit and loss', 'портфель: позиции, прибыль и убыток'],
  ['ALRT AAPL > 200', 'Telegram alert: price, daily move (OIL 5%), a word in the news (ALRT NEWS FED)', 'алерт в Telegram: цена, изменение за день (НЕФТЬ 5%), слово в новостях (ALRT НОВОСТИ ФРС)'],
  ['SCREEN', 'ЭКРАН'],
  ['LAYOUT 4, LAYOUT 6', '4 or 6 panels on screen (LAYOUT 1 — the usual layout)', '4 или 6 панелей на экране (LAYOUT 1 — обычная раскладка)'],
  ['▾ in a panel title', 'put any function into this panel', 'поставить в эту панель любую функцию'],
  ['LANG RU, LANG EN', 'interface language', 'язык интерфейса'],
  ['SET', 'settings and owner sign-in', 'настройки и вход владельца'],
  ['HELP', 'this help', 'эта справка']
];

// display names: ids are internal keys shared with the bot's data
var MKT_EN = {'S&P': 'S&P 500', 'Nasdaq': 'Nasdaq', 'DJI': 'Dow Jones', 'RTY': 'Russell 2000', 'VIX': 'VIX', 'SX5E': 'Euro Stoxx 50', 'DAX': 'DAX',
  'UKX': 'FTSE 100', 'CAC': 'CAC 40', 'NKY': 'Nikkei 225', 'HSI': 'Hang Seng', 'SHCOMP': 'Shanghai Composite', 'SENSEX': 'Sensex (India)',
  'IMOEX': 'MOEX Russia', 'DXY': 'US Dollar Index', 'EUR/USD': 'EUR/USD', 'USDJPY': 'USD/JPY', 'GBPUSD': 'GBP/USD', 'USDCNY': 'USD/CNY',
  'USDCHF': 'USD/CHF', 'USD/RUB': 'USD/RUB (CBR)', 'CNY/RUB': 'CNY/RUB (CBR)', 'Brent': 'Brent crude', 'WTI': 'WTI crude', 'Газ': 'Natural gas',
  'Золото': 'Gold', 'Серебро': 'Silver', 'Платина': 'Platinum', 'Медь': 'Copper', 'Пшеница': 'Wheat',
  'UST3M': 'UST 3M', 'UST5': 'UST 5Y', 'UST10': 'UST 10Y', 'UST30': 'UST 30Y', 'BTC': 'Bitcoin'};
var MKT_RU = {'IMOEX': 'Индекс Мосбиржи', 'DXY': 'Индекс доллара DXY', 'SHCOMP': 'Шанхай Composite', 'SENSEX': 'Sensex (Индия)',
  'USD/RUB': 'USD/RUB (ЦБ)', 'CNY/RUB': 'CNY/RUB (ЦБ)', 'Brent': 'Нефть Brent', 'WTI': 'Нефть WTI', 'Газ': 'Газ (Henry Hub)',
  'UST3M': 'UST 3 мес', 'UST5': 'UST 5 лет', 'UST10': 'UST 10 лет', 'UST30': 'UST 30 лет', 'BTC': 'Биткоин'};
var UNIT = [{'DXY': 'pts', 'VIX': 'pts', 'EUR/USD': '$ per €', 'USDJPY': '¥ per $', 'GBPUSD': '$ per £', 'USDCNY': 'yuan per $', 'USDCHF': 'franc per $',
  'USD/RUB': '₽ per $', 'CNY/RUB': '₽ per yuan', 'Brent': '$/bbl', 'WTI': '$/bbl', 'Газ': '$/MMBtu', 'Золото': '$/oz', 'Серебро': '$/oz',
  'Платина': '$/oz', 'Медь': '$/lb', 'Пшеница': '¢/bu'},
  {'DXY': 'пт', 'VIX': 'пт', 'EUR/USD': '$ за €', 'USDJPY': '¥ за $', 'GBPUSD': '$ за £', 'USDCNY': 'юань за $', 'USDCHF': 'франк за $',
  'USD/RUB': '₽ за $', 'CNY/RUB': '₽ за юань', 'Brent': '$/барр', 'WTI': '$/барр', 'Газ': '$/MMBtu', 'Золото': '$/унц', 'Серебро': '$/унц',
  'Платина': '$/унц', 'Медь': '$/фунт', 'Пшеница': '¢/бушель'}];
var REGION = [{'S&P': 'US', 'Nasdaq': 'US', 'DJI': 'US', 'RTY': 'US', 'VIX': 'volatility', 'SX5E': 'Europe', 'DAX': 'Germany', 'UKX': 'UK',
  'CAC': 'France', 'NKY': 'Japan', 'HSI': 'Hong Kong', 'SHCOMP': 'China', 'SENSEX': 'India', 'IMOEX': 'Russia'},
  {'S&P': 'США', 'Nasdaq': 'США', 'DJI': 'США', 'RTY': 'США', 'VIX': 'волатильность', 'SX5E': 'Европа', 'DAX': 'Германия', 'UKX': 'Британия',
  'CAC': 'Франция', 'NKY': 'Япония', 'HSI': 'Гонконг', 'SHCOMP': 'Китай', 'SENSEX': 'Индия', 'IMOEX': 'Россия'}];
var CLOCKS = [['MSK', 'МСК'], ['NEW YORK', 'НЬЮ-ЙОРК'], ['LONDON', 'ЛОНДОН'], ['TOKYO', 'ТОКИО']];
var SECTOR_RU = {'Technology': 'Технологии', 'Communication': 'Связь и медиа', 'Consumer Discretionary': 'Циклич. потребление',
  'Consumer Staples': 'Повседн. спрос', 'Health Care': 'Здравоохранение', 'Financials': 'Финансы', 'Industrials': 'Промышленность',
  'Energy': 'Энергетика', 'Utilities': 'Коммунальные', 'Real Estate': 'Недвижимость', 'Materials': 'Материалы'};
var TAG_RU = {Fed: 'ФРС', ECB: 'ЕЦБ', BankOfRussia: 'ЦБРФ', rates: 'ставки', inflation: 'инфляция', oil: 'нефть', gas: 'газ', gold: 'золото',
  ruble: 'рубль', dollar: 'доллар', bonds: 'облигации', markets: 'рынки', China: 'Китай', tariffs: 'пошлины', sanctions: 'санкции',
  jobs: 'занятость', GDP: 'ВВП', crypto: 'крипта', Russia: 'Россия'};
var SOURCE_RU = {'Fed': 'ФРС США', 'US Labor Statistics (BLS)': 'Статистика труда США (BLS)', 'ECB': 'ЕЦБ', 'Bank of England': 'Банк Англии',
  'IMF': 'МВФ', 'Bank of Russia': 'ЦБ РФ', 'Kommersant': 'Коммерсантъ', 'RBC': 'РБК'};
var TRADE_RU = [['House', 'Палата'], ['Senate', 'Сенат'], [' (option)', ' (опцион)'], [' et al.', ' и др.'], ['General Counsel', 'главный юрист'],
  ['President', 'президент'], ['Chair', 'председатель совета директоров'], ['Officer', 'топ-менеджер'], ['Director', 'член совета директоров'],
  ['10% owner', 'акционер 10%+']];
var FNG_RU = {'Extreme Fear': 'сильный страх', 'Fear': 'страх', 'Neutral': 'нейтрально', 'Greed': 'жадность', 'Extreme Greed': 'сильная жадность'};
function inv(m){ var o = {}; Object.keys(m).forEach(function(k){ o[m[k]] = k }); return o }
var SECTOR_EN = inv(SECTOR_RU), TAG_EN = inv(TAG_RU), SOURCE_EN = inv(SOURCE_RU);
function mapName(ru, en){ return function(x){ return RU ? ru[x] || x : en[x] || x } }

function t(key){
  var v = D[key];
  if (v == null) return key;
  if (typeof v === 'function') return v.apply(null, [].slice.call(arguments, 1));
  return v[RU ? 1 : 0];
}

// news stories: original headline + translation; older data had a Russian title and the English "original"
function isOld(n){ return n && n.original !== undefined && n.lang === undefined }
function newsTitle(n){
  if (isOld(n)) return RU || !n.original ? n.title : n.original;
  return (RU ? n.title_ru : n.title_en) || n.title || '';
}
function newsLead(n){
  if (isOld(n)) return RU ? n.lead || '' : '';
  return (RU ? n.lead_ru : n.lead_en) || n.lead || '';
}
function aiSum(n){
  var ai = n && n.ai; if (!ai) return '';
  if (ai.sum_ru === undefined) return RU ? ai.sum || '' : '';
  return RU ? ai.sum_ru || ai.sum || '' : ai.sum || ai.sum_ru || '';
}
function tradeLabel(s){
  s = String(s || '');
  TRADE_RU.forEach(function(p){ s = RU ? s.split(p[0]).join(p[1]) : s.split(p[1]).join(p[0]) });
  return s;
}
function setLang(l){
  l = l === 'ru' ? 'ru' : 'en';
  try { localStorage.setItem(KEY, l) } catch(e){}
  try { var u = new URL(location.href); u.searchParams.set('lang', l); location.replace(u.toString()) } catch(e){ location.reload() }
}

// static texts: data-i18n → text, data-i18n-html → HTML (our own strings only), -ph → placeholder, -title → title
function apply(root){
  (root || document).querySelectorAll('[data-i18n],[data-i18n-html],[data-i18n-ph],[data-i18n-title]').forEach(function(e){
    var d = e.dataset;
    if (d.i18n) e.textContent = t(d.i18n);
    if (d.i18nHtml) e.innerHTML = t(d.i18nHtml);
    if (d.i18nPh) e.placeholder = t(d.i18nPh);
    if (d.i18nTitle) e.title = t(d.i18nTitle);
  });
  document.documentElement.lang = lang;
  document.title = t('title');
  var h = document.getElementById('help-t');
  if (h && !h.firstChild) HELP.forEach(function(r){
    var tr = document.createElement('tr'), a = document.createElement('td');
    a.textContent = r[0];
    if (r.length === 2) { a.colSpan = 2; a.style.color = 'var(--amber)'; a.style.paddingTop = '8px'; a.textContent = RU ? r[1] : r[0]; tr.appendChild(a) }
    else { var b = document.createElement('td'); b.textContent = RU ? r[2] : r[1]; tr.appendChild(a); tr.appendChild(b) }
    h.appendChild(tr);
  });
}

window.L10N = {
  lang: lang, ru: RU, t: t, apply: apply, setLang: setLang,
  num: RU ? 'ru-RU' : 'en-US',     // numbers: 1,234.56 / 1 234,56
  date: RU ? 'ru-RU' : 'en-GB',    // dates and 24-hour times
  tv: RU ? 'ru' : 'en',            // TradingView widget
  tz: RU ? 'МСК' : 'MSK',
  mktName: function(id, fallback){ return (RU ? MKT_RU[id] : MKT_EN[id]) || (RU ? fallback : MKT_EN[id]) || fallback || id },
  unit: function(id){ return UNIT[RU ? 1 : 0][id] || '' },
  region: function(id){ return REGION[RU ? 1 : 0][id] || '' },
  clock: function(i){ return CLOCKS[i][RU ? 1 : 0] },
  sector: mapName(SECTOR_RU, SECTOR_EN), tag: mapName(TAG_RU, TAG_EN), source: mapName(SOURCE_RU, SOURCE_EN),
  tagKey: function(x){ return TAG_EN[x] || x },   // filter by the stored (English) tag whatever language the data had
  fng: function(x){ return RU ? FNG_RU[x] || x : x },
  newsTitle: newsTitle, newsLead: newsLead, aiSum: aiSum, tradeLabel: tradeLabel
};
})();
