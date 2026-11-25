(function(){
'use strict';
var KEY = 'lang', LANGS = ['en', 'ru', 'zh', 'ar'];
function pick(){
  var q = null;
  try { q = new URLSearchParams(location.search).get('lang') } catch(e){}
  if (LANGS.indexOf(q) >= 0) { try { localStorage.setItem(KEY, q) } catch(e){} return q }
  try { var s = localStorage.getItem(KEY); if (LANGS.indexOf(s) >= 0) return s } catch(e){}
  return 'en';
}
var lang = pick(), RU = lang === 'ru';
var XI = lang === 'zh' ? 0 : lang === 'ar' ? 1 : -1;
if (XI >= 0) {
  var me = document.currentScript, src = me && me.src ? me.src.replace(/i18n\.js(\?.*)?$/, 'i18n.xl.js$1') : 'i18n.xl.js';
  try { document.write('<script src="' + src + '"><\/script>') } catch(e){}
}
function XL(){ return XI >= 0 && window.L10N_XL || null }
function xl(map, id){ var x = XL(), m = x && x[map], v = m && m[id]; return v ? v[XI] : null }

var D = {
  title: ['Terminal', 'Терминал'],
  cmd_ph: ['command: WEI, FX, CRYPTO, N, ECO, TRD, GOLD, BTC, HELP…', 'команда: WEI, FX, CRYPTO, N, ECO, TRD, GOLD, BTC, HELP…'],
  cmd_ph_m: ['GOLD, BTC, N, HELP…', 'GOLD, BTC, N, HELP…'],
  lay_t: ['Layout: how many panels on screen', 'Раскладка: сколько панелей на экране'],
  st_data_t: ['Source of world market data', 'Источник данных по мировым рынкам'],
  st_crypto_t: ['Crypto: live exchange stream', 'Крипта: поток с биржи'],
  install: ['⤓ INSTALL', '⤓ УСТАНОВИТЬ'], install_t: ['Install as an app', 'Установить как приложение'],
  settings_t: ['Settings', 'Настройки'],
  lang_btn_t: ['Interface language', 'Язык интерфейса'],
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
  des_empty: ['Type a ticker and a function: <b>AAPL DES</b>, <b>NVDA FA</b>, <b>TSLA EE</b>, <b>MSFT ANR</b>, <b>AMZN HDS</b>, <b>KO DVD</b>, <b>SPY OMON</b>, <b>JPM RV</b>. Moscow Exchange works too: <b>SBER DES</b>.',
    'Наберите тикер и функцию: <b>AAPL DES</b>, <b>NVDA FA</b>, <b>TSLA EE</b>, <b>MSFT ANR</b>, <b>AMZN HDS</b>, <b>KO DVD</b>, <b>SPY OMON</b>, <b>JPM RV</b>. Работает и для Мосбиржи: <b>SBER DES</b>.'],
  p_hp: ['PRICE HISTORY', 'ИСТОРИЯ ЦЕН'], hp_tab: ['HP · TABLE', 'HP · ТАБЛИЦА'], comp_tab: ['COMP · COMPARE', 'COMP · СРАВНЕНИЕ'],
  hp_empty: ['Price history: <b>HP AAPL</b>, <b>HP BTC 5Y</b>, <b>HP SBER</b>. Several on one chart: <b>COMP AAPL MSFT NVDA</b>.',
    'История цен: <b>HP AAPL</b>, <b>HP BTC 5Y</b>, <b>HP SBER</b>. Сравнение на одном графике: <b>COMP AAPL MSFT NVDA</b>.'],
  p_eqs: ['US STOCK SCREENER', 'СКРИНЕР АКЦИЙ США'], loading: ['Loading', 'Загружаю'],
  p_imap: ['US MARKET MAP', 'КАРТА РЫНКА США'], im_ru: ['RUSSIA', 'РОССИЯ'], p_imap_ru: ['MOSCOW EXCHANGE MAP', 'КАРТА МОСБИРЖИ'],
  p_ana: ['WORLD ECONOMY & CROSS-ASSET', 'МИРОВАЯ ЭКОНОМИКА И РЫНКИ'], ecst_tab: ['ECST · ECONOMIES', 'ECST · ЭКОНОМИКИ'],
  fxc_tab: ['FXC · CROSS RATES', 'FXC · КРОСС-КУРСЫ'], corr_tab: ['CORR · CORRELATION', 'CORR · КОРРЕЛЯЦИИ'],
  opt_tab: ['OMON · OPTIONS', 'OMON · ОПЦИОНЫ'], ipo_tab: ['IPO · CALENDAR', 'IPO · КАЛЕНДАРЬ'], im_day: ['TODAY', 'ЗА ДЕНЬ'], im_5d: ['5 DAYS', '5 ДНЕЙ'], im_ytd: ['YTD', 'С НАЧ. ГОДА'], im_1y: ['1 YEAR', 'ЗА ГОД'],
  p_gc: ['BONDS & RATES', 'ОБЛИГАЦИИ И СТАВКИ'], gc_tab: ['GC · CURVES', 'GC · КРИВЫЕ'], cb_tab: ['CB · CENTRAL BANKS', 'CB · СТАВКИ ЦБ'], wirp_tab: ['WIRP · FED', 'WIRP · ФРС'],
  p_my: ['MY', 'МОЁ'], w_tab: ['W · WATCHLIST', 'W · СПИСОК'], port_tab: ['PORT · PORTFOLIO', 'PORT · ПОРТФЕЛЬ'], alrt_tab: ['ALRT · ALERTS', 'ALRT · АЛЕРТЫ'],
  papr_tab: ['PAPR · PRACTICE', 'PAPR · ДЕМОСЧЁТ'], fbar_t: ['Quick functions (Alt+1…9)', 'Быстрые функции (Alt+1…9)'], m_papr: ['Practice account (virtual $)', 'Демосчёт (виртуальные $)'],
  pp_equity: ['Equity', 'Капитал'], pp_cash: ['Cash', 'Деньги'], pp_pl: ['Result', 'Результат'], pp_trades: ['Trades', 'Сделок'],
  pp_amt: ['qty or $1000', 'кол-во или $1000'], pp_amt_t: ['A number of shares/coins, or a dollar amount with $ (e.g. $2500)', 'Количество акций/монет или сумма в долларах со знаком $ (например, $2500)'],
  pp_reset: ['Start over', 'Начать заново'], pp_reset_q: ['Reset the practice account to $100,000 and forget its trades?', 'Сбросить демосчёт до $100 000 и забыть его сделки?'],
  pp_cols: [['Ticker', 'Qty', 'Avg price', 'Last', 'Day', 'Value', 'Result', '%'], ['Тикер', 'Кол-во', 'Ср. цена', 'Цена', 'День', 'Стоимость', 'Результат', '%']],
  pp_hcols: [['Time', 'Side', 'Ticker', 'Qty', 'Price', 'Amount'], ['Время', 'Сторона', 'Тикер', 'Кол-во', 'Цена', 'Сумма']],
  pp_hist: ['TRADES', 'СДЕЛКИ'],
  pp_empty: function(m){ return RU ? 'Демосчёт: ' + m + ' виртуальных долларов. Введите тикер (AAPL, BTC, SPY) и количество или сумму ($5000) — сделка пройдёт по последней цене.' : 'A practice account with ' + m + ' of virtual money. Type a ticker (AAPL, BTC, SPY) and a quantity or an amount ($5000) — the trade fills at the last price.' },
  pp_note: ['Practice only: fills at the last quote the terminal has (US stocks may be delayed), no fees, no shorting. Kept in this browser only.', 'Только для тренировки: сделки по последней котировке терминала (акции США могут быть с задержкой), без комиссий и коротких продаж. Хранится только в этом браузере.'],
  pp_need: ['Type a ticker and a quantity or $ amount.', 'Введите тикер и количество или сумму в $.'],
  pp_noquote: function(s){ return (RU ? 'Нет цены для ' : 'No price for ') + s },
  pp_usd_only: ['The practice account trades in US dollars: US stocks, ETFs, crypto.', 'Демосчёт — в долларах: акции и ETF США, крипта.'],
  pp_nocash: function(m){ return (RU ? 'Не хватает денег: доступно ' : 'Not enough cash: ') + m },
  pp_noshares: function(n){ return (RU ? 'Столько нет: в позиции ' : 'You do not hold that many: ') + n },
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
  g_WEI: ['INDICES', 'ИНДЕКСЫ'], g_US: ['US STOCKS · LIVE', 'АКЦИИ США · ОНЛАЙН'], g_FX: ['CURRENCIES', 'ВАЛЮТЫ'], g_GLCO: ['COMMODITIES', 'СЫРЬЁ'],
  g_RATES: ['US YIELDS', 'ДОХОДНОСТИ США'],
  gu_WEI: ['points · daily change', 'цена в пунктах · изм. за день'], gu_US: ['$ per share · daily change', 'цена в $ за акцию · изм. за день'],
  gu_FX: ['rate · daily change', 'курс · изм. за день'], gu_GLCO: ['price · daily change', 'цена · изм. за день'], gu_RATES: ['% a year · change in bp', '% годовых · изм. в б.п.'],
  bp: [' bp', ' б.п.'], spread_10_3: ['10Y − 3M spread', 'Спред 10Y − 3M'], inverted: ['inverted', 'инверсия'], normal: ['normal', 'норма'],
  srv_down_retry: ['The bot server is not answering yet — still trying.', 'Сервер бота пока не отвечает — продолжаю попытки.'],
  srv_hint: ['Some providers (in Russia) throttle Cloudflare, where the server runs: the terminal keeps trying other connections, the data on screen stays.',
    'Часть провайдеров (в России) замедляет Cloudflare, где работает сервер: терминал пробует другие соединения, данные на экране остаются.'],
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
  c_coin: ['Coin', 'Монета'], c_price: ['Price, $', 'Цена, $'], c_24h: ['24h', '24ч'], c_range_t: ['Price position in the 24h range', 'Положение цены в диапазоне 24 ч'],
  c_live: ['Binance · real time', 'Binance · реальное время'], c_1min: ['CRYPTO 1 min', 'CRYPTO 1 мин'], c_gecko: ['CoinGecko · 1 min', 'CoinGecko · 1 мин'],
  c_gecko_note: ['Binance is unavailable — CoinGecko data, refreshed every minute.', 'Binance недоступен — данные CoinGecko, обновление раз в минуту.'],
  c_unavail: ['Crypto quotes are unavailable right now.', 'Котировки криптовалют сейчас недоступны.'],
  tv_unavail_sw: ['TradingView is unavailable — showing the built-in chart. ⇄ — switch', 'TradingView недоступен — показан встроенный график. ⇄ — переключить'],
  tv_unavail: ['TradingView is unavailable — showing the built-in chart', 'TradingView недоступен — показан встроенный график'],
  tv_loading: ['Loading TradingView…', 'Загружаю TradingView…'],
  tv_failed: ["TradingView didn't open — showing the built-in chart. ⇄ — switch", 'TradingView не открылся — показан встроенный график. ⇄ — переключить'],
  tv_slow: ['TradingView is not responding — showing the built-in chart. ⇄ — switch', 'TradingView не отвечает — показан встроенный график. ⇄ — переключить'],
  own_nodata: ['No data for the built-in chart: ', 'Нет данных для встроенного графика: '], own_5d: ['  · 5 days', '  · 5 дней'],
  own_sub: ['built-in · bot data', 'встроенный · данные бота'],
  nothing: ['Nothing found', 'Ничего не найдено'], co_card_t: ['company card', 'карточка компании'],
  today: ['TODAY', 'СЕГОДНЯ'], yesterday: ['YESTERDAY', 'ВЧЕРА'], tomorrow: ['TOMORROW', 'ЗАВТРА'],
  eco_wait: ['The calendar appears after the next bot run.', 'Календарь появится после следующего запуска бота.'],
  imp_high: ['high impact', 'важное'], imp_med: ['medium impact', 'среднее'],
  fcst: ['fcst ', 'прогноз '], prev: ['prev ', 'пред. '], actual: ['actual ', 'факт '],
  next_in: ['Next key event in ', 'Следующее важное через '], no_more: ['No more key events this week', 'Важных событий на неделе больше нет'],
  dur: function(m){
    if (m >= 1440) return Math.floor(m / 1440) + (RU ? ' д ' : 'd ') + Math.floor(m % 1440 / 60) + (RU ? ' ч' : 'h');
    if (m >= 60) return Math.floor(m / 60) + (RU ? ' ч ' : 'h ') + (m % 60) + (RU ? ' мин' : 'm');
    return m + (RU ? ' мин' : ' min');
  },
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
  no_api: function(what){ return (what || (RU ? 'Эта функция' : 'This function')) + (RU ? ' работает через сервер бота, а он ещё не настроен (docs/config.json).' : " works through the bot server, which isn't set up yet (docs/config.json).") },
  load_fail: ["Couldn't load: ", 'Не удалось загрузить: '], srv_not_set_e: ['the bot server is not set up', 'сервер бота не настроен'],
  no_clip: ['no clipboard access', 'нет доступа к буферу обмена'],
  pick_t: ['Show another function in this panel', 'Поставить в эту панель другую функцию'],
  float_t: ['Float this window over the others (drag its title to move it, its corner to size it)', 'Открепить окно поверх других (тяните за заголовок — двигать, за угол — менять размер)'],
  dock_t: ['Put it back into the grid', 'Вернуть окно в сетку'], fresize_t: ['Drag to resize', 'Тяните, чтобы изменить размер'],
  close_t: ['Close this panel', 'Закрыть окно'], close_all_t: ['Close all panels', 'Закрыть все окна'],
  lay_reset_t: ['Default layout and sizes', 'Стандартная раскладка и размеры'],
  empty_slot: ['EMPTY PANEL', 'ПУСТОЕ ОКНО'], add_fn: ['＋ Add a function', '＋ Добавить функцию'],
  empty_hint: ['or type a command above — it opens here', 'или наберите команду в строке сверху — она откроется здесь'],
  reset_link: ['⟲ Default layout', '⟲ Стандартная раскладка'],
  gutter_t: ['Drag to resize · double-click: the layout\'s own sizes', 'Тяните, чтобы изменить размер · двойной щелчок — как было'], pick_head: ['Show in this panel:', 'Показать в этой панели:'],
  loading_x: function(s){ return (RU ? 'Загружаю ' : 'Loading ') + s },
  fn_mkt: ['World markets', 'Мировые рынки'], fn_chart: ['Chart', 'График'], fn_crypto: ['Cryptocurrencies', 'Криптовалюты'], fn_news: ['News', 'Новости'],
  fn_eco: ['Calendar and earnings', 'Календарь и отчёты'], fn_trd: ["Politicians' and insiders' trades", 'Сделки политиков и инсайдеров'],
  fn_des: ['Company: DES FA ERN EE ANR HDS DVD OMON RV', 'Компания: DES FA ERN EE ANR HDS DVD OMON RV'],
  fn_ana: ['Economies, FX, correlations, options, IPO', 'Экономики, валюты, корреляции, опционы, IPO'],
  m_ecst: ['World economies (IMF)', 'Экономики мира (МВФ)'], m_fxc: ['Cross rates', 'Кросс-курсы'], m_corr: ['Correlations', 'Корреляции'],
  m_opt: ['Options', 'Опционы'], m_ipo: ['IPO calendar', 'Календарь IPO'], m_imap_ru: ['Moscow Exchange map', 'Карта Мосбиржи'], fn_hp: ['Price history and comparison', 'История цен и сравнение'],
  fn_eqs: ['US stock screener', 'Скринер акций США'], fn_imap: ['US market map', 'Карта рынка США'], fn_gc: ['Bonds and rates: GC CB WIRP', 'Облигации и ставки: GC CB WIRP'],
  fn_my: ['Watchlist, portfolio, alerts', 'Список, портфель, алерты'],
  m_trd: ['Trades', 'Сделки'], m_des: ['Company', 'Компания'], m_hp: ['Price history', 'История цен'], m_comp: ['Comparison', 'Сравнение'],
  m_eqs: ['Screener', 'Скринер'], m_imap: ['Market map', 'Карта рынка'], m_gc: ['Yield curves', 'Кривые доходности'], m_cb: ['Central bank rates', 'Ставки ЦБ'],
  m_wirp: ['Fed expectations', 'Ожидания по ФРС'], m_w: ['My watchlist', 'Мой список'], m_port: ['Portfolio', 'Портфель'], m_alrt: ['Alerts', 'Алерты'],
  m_help: ['All commands', 'Все команды'],
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
  hds_note: ['Open-market trades by executives and directors (SEC Form 4).', 'Сделки руководства и директоров на открытом рынке (форма 4 SEC).'],
  hds_none: ['No open-market insider trades recently.', 'Сделок инсайдеров на открытом рынке за последнее время нет.'],
  hds_cols: [['Date', 'Who', 'Trade', 'Shares', 'Price', 'Value', 'Holding after'], ['Дата', 'Кто', 'Сделка', 'Акций', 'Цена', 'Сумма', 'Осталось']],
  ranges: [{'1d': '1 day', '5d': '5 days', '1m': '1 month', '3m': '3 months', '6m': '6 months', ytd: 'year to date', '1y': '1 year', '2y': '2 years', '5y': '5 years'},
    {'1d': '1 день', '5d': '5 дней', '1m': '1 мес.', '3m': '3 мес.', '6m': '6 мес.', ytd: 'с начала года', '1y': '1 год', '2y': '2 года', '5y': '5 лет'}],
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
  srv_slow: ['the server did not answer in time — try again', 'сервер не ответил вовремя — попробуйте ещё раз'],
  co_offline: ['The server is unreachable from your network — showing the copy saved on the site (price delayed up to 10 min; no peers or company news).', 'Сервер недоступен из вашей сети — показана копия с сайта (цена с задержкой до 10 минут, без конкурентов и новостей компании).'],
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
  eqs_us: ['US', 'США'], eqs_ru: ['MOSCOW EXCHANGE', 'МОСБИРЖА'],
  eqs_ru_cols: [{s: 'Ticker', n: 'Company', sec: 'Sector', px: 'Price, ₽', ch: 'Day', val: 'Turnover', cap: 'Mkt cap', w: 'IMOEX, %'},
    {s: 'Тикер', n: 'Компания', sec: 'Сектор', px: 'Цена, ₽', ch: 'День', val: 'Оборот', cap: 'Кап.', w: 'IMOEX, %'}],
  eqs_ru_note: function(n, t){ return RU ? 'Акций: ' + n + '. Основной режим Мосбиржи (TQBR), задержка 15 минут, данные на ' + (t || '—') + ' МСК. Нажмите на строку — карточка компании.'
    : n + ' shares. Moscow Exchange main board (TQBR), 15-minute delay, as of ' + (t || '—') + ' MSK. Click a row for the company card.' },
  eqs_found: function(n){ return RU ? 'Найдено: ' + n + '. Нажмите на строку — карточка компании. Мультипликаторы обновляются раз в сутки (Finnhub), цены — каждые 5–10 минут (Yahoo).'
    : 'Found: ' + n + '. Click a row for the company card. Ratios refresh daily (Finnhub), prices every 5–10 minutes (Yahoo).' },
  imap_wait: ['The map appears after the next bot run (docs/stocks.json).', 'Карта появится после следующего запуска бота (docs/stocks.json).'],
  imap_sub: function(t){ return RU ? 'цены ' + t + ' МСК · размер = капитализация' : 'prices ' + t + ' MSK · size = market cap' },
  imap_mcap_wait: ['Market caps are still loading — the map appears within an hour of the bot start.', 'Капитализации компаний ещё загружаются — карта появится в течение часа после запуска бота.'],
  mcap_s: [' · mkt cap ', ' · кап. '],
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
  no_deep: function(s){ return RU ? 'Подробных данных по ' + s + ' пока нет: они собираются по ~100 крупнейшим компаниям США и обновляются дважды в день.'
    : 'No detailed data for ' + s + ' yet: it covers the ~100 largest US companies and is refreshed twice a day.' },
  wiki_src: ['Wikipedia', 'Википедия'], about_src: ['company profile', 'профиль компании'],
  k_emp: ['Employees', 'Сотрудников'], k_ev: ['EV', 'EV'], k_peg: ['PEG', 'PEG'], k_fcf: ['Free cash flow', 'Своб. поток'],
  k_cash: ['Cash', 'Деньги'], k_debt: ['Debt', 'Долг'], k_roa: ['ROA', 'ROA'], k_float: ['Float', 'В обращении'],
  pt_head: function(n){ return (RU ? 'Целевая цена аналитиков · мнений: ' : 'Analyst price target · opinions: ') + n },
  pt_mean: ['Mean', 'Средняя'], pt_median: ['Median', 'Медиана'], pt_high: ['High', 'Максимум'], pt_low: ['Low', 'Минимум'], pt_up: ['To the mean', 'До средней'],
  pt_now: ['now', 'сейчас'],
  rt_head: ['Rating changes', 'Изменения рейтингов'],
  rt_cols: [['Date', 'Firm', 'Action', 'Rating', 'Was', 'Target', 'Was'], ['Дата', 'Компания', 'Действие', 'Рейтинг', 'Был', 'Цель', 'Была']],
  rt_act: [{up: 'upgrade', down: 'downgrade', init: 'initiated', main: 'maintained', reit: 'reiterated'}, {up: 'повышение', down: 'понижение', init: 'начало покрытия', main: 'подтверждён', reit: 'подтверждён'}],
  ee_next: function(d, est){ return (RU ? 'Следующий отчёт: ' : 'Next report: ') + d + (est ? (RU ? ' (ориентировочно)' : ' (estimated)') : '') },
  ee_p: [{'0q': 'Current qtr', '+1q': 'Next qtr', '0y': 'Current year', '+1y': 'Next year'}, {'0q': 'Тек. квартал', '+1q': 'След. квартал', '0y': 'Тек. год', '+1y': 'След. год'}],
  ee_cols: [['Period', 'Ends', 'EPS est.', 'Low', 'High', 'Analysts', 'EPS y/y', 'Revenue est.', 'Rev. y/y', 'Revisions 30d'],
    ['Период', 'Конец', 'Прогноз EPS', 'Мин.', 'Макс.', 'Аналитиков', 'EPS г/г', 'Прогноз выручки', 'Выручка г/г', 'Пересмотры 30 дн.']],
  ee_trend: ['EPS estimate over time', 'Как менялся прогноз EPS'],
  ee_tcols: [['Period', 'Now', '7 days ago', '30 days ago', '60 days ago', '90 days ago'], ['Период', 'Сейчас', '7 дней назад', '30 дней назад', '60 дней назад', '90 дней назад']],
  ee_hist: ['Surprises', 'Сюрпризы'], ee_hcols: [['Quarter', 'Actual', 'Estimate', 'Surprise'], ['Квартал', 'Факт', 'Прогноз', 'Сюрприз']],
  hds_break: ['Ownership', 'Структура владения'], h_ins: ['Insiders', 'Инсайдеры'], h_inst: ['Institutions', 'Институционалы'],
  h_inst_f: ['Institutions, % of float', 'Институц., % обращ.'], h_inst_n: ['Institutions', 'Число институц.'],
  h_buys: ['Insider buys, 6 mo', 'Покупки инсайдеров, 6 мес.'], h_sells: ['Insider sales, 6 mo', 'Продажи инсайдеров, 6 мес.'],
  h_top: ['Largest institutions', 'Крупнейшие институционалы'], h_funds: ['Largest funds', 'Крупнейшие фонды'],
  own_cols: [['Holder', '% held', 'Shares', 'Value', 'Change', 'Reported'], ['Держатель', 'Доля', 'Акций', 'Стоимость', 'Изм.', 'Отчёт']],
  si_head: ['Short interest (SI)', 'Короткие позиции (SI)'], si_sh: ['Short, shares', 'В шорте, акций'], si_pf: ['% of float', '% обращения'],
  si_days: ['Days to cover', 'Дней на покрытие'], si_d: ['As of', 'На дату'], si_prior: ['Month before', 'Месяцем ранее'],
  si_chart: ['Short interest, shares', 'Короткие позиции, акций'], h_trades: ['Insider trades', 'Сделки инсайдеров'],
  dvd_none: ['The company pays no dividends.', 'Компания не платит дивиденды.'],
  d_rate: ['Annual dividend', 'Дивиденд в год'], d_yield: ['Yield', 'Доходность'], d_payout: ['Payout ratio', 'Доля прибыли'],
  d_avg5: ['5-year avg yield', 'Ср. доходность 5 лет'], d_ex: ['Ex-date', 'Отсечка'], d_pay: ['Payment', 'Выплата'],
  d_years: ['Dividends by year', 'Дивиденды по годам'], d_cols: [['Ex-date', 'Amount', 'Change'], ['Отсечка', 'Сумма', 'Изм.']],
  d_splits: ['Splits: ', 'Сплиты: '],
  omon_none: ['No option data.', 'Данных по опционам нет.'],
  omon_lite: ['Only the 30-day implied volatility is available for this ticker; full chains are kept for ~100 companies and ETFs.',
    'По этому тикеру есть только 30-дневная подразумеваемая волатильность; полные цепочки хранятся для ~100 компаний и ETF.'],
  o_px: ['Price', 'Цена'], o_iv: ['IV30', 'IV30'], o_ivch: ['IV30 change', 'Изм. IV30'], o_pcv: ['Put/call, volume', 'Пут/колл, объём'],
  o_pco: ['Put/call, open int.', 'Пут/колл, откр. инт.'], o_cv: ['Call volume', 'Объём коллов'], o_pv: ['Put volume', 'Объём путов'],
  o_ts: ['Data as of', 'Данные на'], o_calls: ['CALLS', 'КОЛЛЫ'], o_puts: ['PUTS', 'ПУТЫ'], o_strike: ['Strike', 'Страйк'],
  o_ccols: [['Bid', 'Ask', 'Last', 'IV', 'Δ', 'OI', 'Vol'], ['Bid', 'Ask', 'Посл.', 'IV', 'Δ', 'ОИ', 'Объём']],
  o_exp: ['Expiries', 'Экспирации'],
  o_ecols: [['Expiry', 'Days', 'ATM IV', 'Expected move', 'Max pain', 'Call vol', 'Put vol', 'Call OI', 'Put OI'],
    ['Экспирация', 'Дней', 'IV ATM', 'Ожид. движение', 'Max pain', 'Объём коллов', 'Объём путов', 'ОИ коллов', 'ОИ путов']],
  o_note: ['Cboe delayed quotes (15 min). Expected move = price of the at-the-money straddle. Max pain = the expiry price at which option holders lose the most.',
    'Котировки Cboe с задержкой 15 мин. Ожидаемое движение = цена стрэддла «на деньгах». Max pain — цена на экспирации, при которой держатели опционов теряют больше всего.'],
  o_top: ['Largest open interest: ', 'Наибольший открытый интерес: '],
  rv_none: function(s){ return RU ? s + ' нет в списке ~100 крупнейших компаний США — сравнить не с чем.' : s + ' is not in the list of ~100 largest US companies — no comparison.' },
  rv_cols: [{s: 'Ticker', n: 'Company', mcap: 'Mkt cap', pe: 'P/E', fpe: 'Fwd P/E', ps: 'P/S', pb: 'P/B', dy: 'Div.', revg: 'Revenue', epsg: 'EPS', gm: 'Gross m.', nm: 'Net m.', roe: 'ROE', r52: '1Y'},
    {s: 'Тикер', n: 'Компания', mcap: 'Кап.', pe: 'P/E', fpe: 'P/E ф.', ps: 'P/S', pb: 'P/B', dy: 'Див.', revg: 'Выручка', epsg: 'EPS', gm: 'Вал. м.', nm: 'Чист. м.', roe: 'ROE', r52: 'Год'}],
  rv_median: ['Peer median', 'Медиана конкурентов'],
  rv_note: ['Peers from Finnhub that are in the screener; if there are few, the largest companies of the same sector. Growth is over a year.',
    'Аналоги по Finnhub из скринера; если их мало — крупнейшие компании того же сектора. Рост — за год.'],
  cf_none: ['No filings found.', 'Отчётов не найдено.'], cf_cols: [['Date', 'Form', 'What it is'], ['Дата', 'Форма', 'Что это']],
  cf_types: [{'10-K': 'annual report', '10-Q': 'quarterly report', '8-K': 'material event', '8-K/A': 'material event (amended)', 'DEF 14A': 'proxy statement', 'S-3': 'securities registration',
    '424B2': 'prospectus', 'SC 13G': '5%+ holder', 'SC 13G/A': '5%+ holder', 'SD': 'conflict minerals', '11-K': 'employee plan', '3': 'insider: first holding', '4': 'insider trade'},
    {'10-K': 'годовой отчёт', '10-Q': 'квартальный отчёт', '8-K': 'существенное событие', '8-K/A': 'существенное событие (испр.)', 'DEF 14A': 'материалы к собранию', 'S-3': 'регистрация бумаг',
    '424B2': 'проспект', 'SC 13G': 'акционер 5%+', 'SC 13G/A': 'акционер 5%+', 'SD': 'конфликтные минералы', '11-K': 'план для сотрудников', '3': 'инсайдер: первая позиция', '4': 'сделка инсайдера'}],
  mgmt_head: ['Management (MGMT)', 'Руководство (MGMT)'], mgmt_cols: [['Name', 'Position', 'Age', 'Pay'], ['Имя', 'Должность', 'Возраст', 'Вознаграждение']],
  imap_sub_ru: function(t){ return RU ? 'Мосбиржа · ' + (t || '') + ' МСК · размер = капитализация' : 'Moscow Exchange · ' + (t || '') + ' MSK · size = market cap' },
  imap_ru_wait: ['The Moscow Exchange map appears after the next bot run (docs/moex.json).', 'Карта Мосбиржи появится после следующего запуска бота (docs/moex.json).'],
  ecst_title: ['IMF WORLD ECONOMIC OUTLOOK', 'МВФ: ПЕРСПЕКТИВЫ МИРОВОЙ ЭКОНОМИКИ'],
  ecst_wait: ['IMF forecasts appear after the next bot run (docs/macro.json).', 'Прогнозы МВФ появятся после следующего запуска бота (docs/macro.json).'],
  ecst_cols: function(y){ return RU ? ['Страна', 'ВВП ' + y, 'ВВП ' + (y + 1), 'Инфл. ' + y, 'Инфл. ' + (y + 1), 'Безраб. ' + y, 'Бюджет ' + y, 'Госдолг ' + y, 'Тек. счёт ' + y]
    : ['Country', 'GDP ' + y, 'GDP ' + (y + 1), 'CPI ' + y, 'CPI ' + (y + 1), 'Unempl. ' + y, 'Budget ' + y, 'Gov. debt ' + y, 'Cur. acct ' + y] },
  ecst_note: ['Real GDP growth and average inflation, %; budget balance, government debt and current account, % of GDP. Years after the current one are IMF forecasts. Click a country for its history.',
    'Рост реального ВВП и средняя инфляция, %; сальдо бюджета, госдолг и текущий счёт — % ВВП. Годы после текущего — прогноз МВФ. Нажмите на страну — её динамика.'],
  ecst_back: ['← ALL COUNTRIES', '← ВСЕ СТРАНЫ'], ecst_ind: ['Indicator', 'Показатель'], fcst_w: ['forecast', 'прогноз'],
  fxc_title: ['CROSS RATES', 'КРОСС-КУРСЫ'], fxc_wait: ['Currency quotes are still loading.', 'Курсы валют ещё загружаются.'],
  fxc_note: ['One unit of the row currency in the column currency; below — the change today. From the terminal quotes (Yahoo, Bank of Russia for the ruble).',
    'Одна единица валюты строки в валюте столбца; ниже — изменение за день. По котировкам терминала (Yahoo, для рубля — ЦБ РФ).'],
  corr_title: function(r){ return (RU ? 'КОРРЕЛЯЦИИ · ' : 'CORRELATIONS · ') + r },
  corr_note: ['Correlation of daily returns over the period: +1 — move together, −1 — in opposite directions, 0 — unrelated.',
    'Корреляция дневных доходностей за период: +1 — движутся вместе, −1 — в разные стороны, 0 — не связаны.'],
  corr_few: ['Add at least two instruments.', 'Добавьте хотя бы два инструмента.'],
  opt_title: ['OPTIONS: MOST ACTIVE', 'ОПЦИОНЫ: САМЫЕ АКТИВНЫЕ'], opt_wait: ['The options overview appears after the next bot run (docs/options.json).', 'Обзор опционов появится после следующего запуска бота (docs/options.json).'],
  opt_cols: [['Ticker', 'Name', 'Price', 'Day', 'IV30', 'IV chg', 'Calls vol', 'Puts vol', 'P/C vol', 'P/C OI'], ['Тикер', 'Название', 'Цена', 'День', 'IV30', 'Изм. IV', 'Объём коллов', 'Объём путов', 'П/К объём', 'П/К ОИ']],
  opt_note: ['Click a row for the option chain (OMON). IV30 — 30-day implied volatility; P/C above 1 — more puts than calls (hedging, caution).',
    'Нажмите на строку — цепочка опционов (OMON). IV30 — 30-дневная подразумеваемая волатильность; П/К выше 1 — путов больше, чем коллов (хеджирование, осторожность).'],
  ipo_title: ['IPO CALENDAR · US', 'КАЛЕНДАРЬ IPO · США'], ipo_none: ['No IPOs in the next 30 days.', 'IPO в ближайшие 30 дней нет.'],
  ipo_cols: [['Date', 'Ticker', 'Company', 'Exchange', 'Price', 'Shares', 'Value', 'Status'], ['Дата', 'Тикер', 'Компания', 'Биржа', 'Цена', 'Акций', 'Объём', 'Статус']],
  ipo_status: [{expected: 'expected', priced: 'priced', filed: 'filed', withdrawn: 'withdrawn'}, {expected: 'ожидается', priced: 'размещено', filed: 'подана заявка', withdrawn: 'отозвано'}],
  overbought: ['overbought', 'перекупленность'], oversold: ['oversold', 'перепроданность'], vs_sma200: ['vs SMA 200', 'к SMA 200'],
  earn_none: ['No earnings of the largest companies in the coming weeks (or the data is not loaded yet).', 'Отчётов крупнейших компаний в ближайшие недели нет (или данные ещё не загружены).'],
  earn_cols: [['Date', 'Company', 'EPS est.', 'EPS actual', 'Revenue est.'], ['Дата', 'Компания', 'EPS прогноз', 'EPS факт', 'Выручка прогноз']],
  bmo_s: ['☀ before open', '☀ до откр.'], amc_s: ['☾ after close', '☾ после закр.'],
  earn_wait: ['The earnings calendar appears after the next bot run.', 'Календарь отчётов появится после следующего запуска бота.']  ,
  // ---------- new panels ----------
  fn_tech: ['Technical analysis', 'Технический анализ'], fn_mon: ['Market monitors', 'Мониторы рынка'], fn_map: ['World map', 'Карта мира'],
  p_tech: ['TECHNICAL ANALYSIS', 'ТЕХНИЧЕСКИЙ АНАЛИЗ'], p_mon: ['MARKET MONITORS', 'МОНИТОРЫ РЫНКА'], p_map: ['WORLD MAP', 'КАРТА МИРА'],
  m_tech: ['Chart with indicators and TA', 'График с индикаторами и ТА'], m_vap: ['Volume at price', 'Объём по ценам'], m_tra: ['Total return', 'Полная доходность'],
  m_tray: ['Returns over periods', 'Доходность за периоды'], m_mov: ['Index movers', 'Кто двигает индекс'], m_most: ['Most active', 'Самые активные'],
  m_memb: ['Index members', 'Состав индекса'], m_wpe: ['World valuations', 'Оценка рынков мира'], m_bi: ['Sectors', 'Секторы'], m_fpc: ['ETF returns', 'Доходность ETF'],
  m_cdr: ['Exchange hours, holidays', 'Часы бирж, праздники'], m_wb: ['World bonds', 'Облигации мира'], m_btmm: ['Country rates', 'Ставки страны'],
  m_mmr: ['Money markets', 'Денежный рынок'], m_srch: ['US Treasuries', 'Казначейские бумаги США'], m_map: ['World map with layers', 'Карта мира со слоями'],
  m_storm: ['Storms', 'Штормы'], m_ship: ['Shipping, chokepoints', 'Судоходство, проливы'], m_wetr: ['Weather', 'Погода'], m_mapeco: ['Countries on the map', 'Страны на карте'],
  tech_tab: ['TECH · CHART', 'TECH · ГРАФИК'], vap_tab: ['VAP · VOLUME AT PRICE', 'VAP · ОБЪЁМ ПО ЦЕНАМ'], tsm_tab: ['TSM · BY HOUR', 'TSM · ПО ЧАСАМ'],
  qr_tab: ['QR · TIME & SALES', 'QR · ЛЕНТА СДЕЛОК'], tra_tab: ['TRA · TOTAL RETURN', 'TRA · ПОЛНАЯ ДОХОДНОСТЬ'], tray_tab: ['TRAY · RETURNS', 'TRAY · ДОХОДНОСТИ'],
  mov_tab: ['MOV · MOVERS', 'MOV · ЛИДЕРЫ'], most_tab: ['MOST · ACTIVE', 'MOST · АКТИВНЫЕ'], mrr_tab: ['MRR · RETURNS', 'MRR · ДОХОДНОСТИ'], memb_tab: ['MEMB · WEIGHTS', 'MEMB · ВЕСА'],
  wpe_tab: ['WPE · VALUATION', 'WPE · ОЦЕНКА'], bi_tab: ['BI · SECTORS', 'BI · СЕКТОРЫ'], fpc_tab: ['FPC · FUNDS', 'FPC · ФОНДЫ'], cdr_tab: ['CDR · EXCHANGES', 'CDR · БИРЖИ'],
  wb_tab: ['WB · WORLD BONDS', 'WB · ОБЛИГАЦИИ МИРА'], btmm_tab: ['BTMM · COUNTRY', 'BTMM · СТРАНА'], mmr_tab: ['MMR · MONEY MARKETS', 'MMR · ДЕНЕЖНЫЙ РЫНОК'], srch_tab: ['SRCH · TREASURIES', 'SRCH · ТРЕЖЕРИС'],
  map_tab: ['MAP · LAYERS', 'MAP · СЛОИ'], storm_tab: ['STORM · STORMS', 'STORM · ШТОРМЫ'], ship_tab: ['SHIP · SHIPPING', 'SHIP · СУДОХОДСТВО'], wetr_tab: ['WETR · WEATHER', 'WETR · ПОГОДА'],
  mapeco_tab: ['ECO · COUNTRIES', 'ECO · СТРАНЫ'],
  name: ['Name', 'Название'], company: ['Company', 'Компания'], weight: ['Weight', 'Вес'], show: ['SHOW', 'ПОКАЗАТЬ'], neck: ['neckline', 'линия шеи'],
  reg_us: ['US · ~100 LARGEST', 'США · ~100 КРУПНЕЙШИХ'], reg_ru: ['MOEX INDEX', 'ИНДЕКС МОСБИРЖИ'],
  per_1d: ['1D', '1Д'], per_1w: ['1W', '1Н'], per_mtd: ['MTD', 'С НАЧ. МЕС.'], per_1m: ['1M', '1М'], per_qtd: ['QTD', 'С НАЧ. КВ.'], per_3m: ['3M', '3М'], per_6m: ['6M', '6М'],
  per_ytd: ['YTD', 'С НАЧ. ГОДА'], per_1y: ['1Y', '1Г'], per_2y: ['2Y*', '2Г*'], per_3y: ['3Y*', '3Г*'], per_5y: ['5Y*', '5Л*'], per_ann: ['* a year on average (annualised)', '* в среднем за год'],

  // ---------- TECH ----------
  tech_empty: ['Technical analysis: <b>TECH AAPL</b>, <b>BTC GPO</b> (bars), <b>GOLD TA</b> (trend lines, levels, Fibonacci, patterns), <b>IND NVDA MACD</b>, <b>VAP AAPL</b>, <b>TRAY</b>.',
    'Технический анализ: <b>TECH AAPL</b>, <b>BTC GPO</b> (бары), <b>ЗОЛОТО TA</b> (трендовые линии, уровни, Фибоначчи, фигуры), <b>IND NVDA MACD</b>, <b>VAP AAPL</b>, <b>TRAY</b>.'],
  tech_t_TECH: function(s){ return (RU ? 'ТЕХАНАЛИЗ · ' : 'TECHNICAL ANALYSIS · ') + s }, tech_t_VAP: function(s){ return (RU ? 'ОБЪЁМ ПО ЦЕНАМ · ' : 'VOLUME AT PRICE · ') + s },
  tech_t_TSM: function(s){ return (RU ? 'ТОРГОВЫЙ ДЕНЬ ПО ЧАСАМ · ' : 'THE TRADING DAY BY HOUR · ') + s }, tech_t_QR: function(s){ return (RU ? 'ЛЕНТА СДЕЛОК · ' : 'TIME & SALES · ') + s },
  tech_t_TRA: function(s){ return (RU ? 'ПОЛНАЯ ДОХОДНОСТЬ · ' : 'TOTAL RETURN · ') + s }, tech_t_TRAY: function(){ return RU ? 'ДОХОДНОСТЬ ЗА ПЕРИОДЫ' : 'RETURNS OVER PERIODS' },
  st_line: ['LINE', 'ЛИНИЯ'], st_bar: ['BARS', 'БАРЫ'], st_candle: ['CANDLES', 'СВЕЧИ'],
  ta_trend: ['TREND LINES', 'ТРЕНДЫ'], ta_sr: ['SUPPORT/RESIST.', 'ПОДДЕРЖКА/СОПРОТ.'], ta_fib: ['FIBONACCI', 'ФИБОНАЧЧИ'], ta_pat: ['PATTERNS', 'ФИГУРЫ'],
  ts_trend: ['Trend', 'Тренд'], ts_trend_t: ['Price against the 50- and 200-day averages', 'Цена против 50- и 200-дневной средней'],
  ts_trend_up: ['up: price > SMA50 > SMA200', 'вверх: цена > SMA50 > SMA200'], ts_trend_down: ['down: price < SMA50 < SMA200', 'вниз: цена < SMA50 < SMA200'], ts_trend_side: ['mixed', 'смешанный'],
  ts_cross: ['SMA 50/200 cross', 'Пересечение SMA 50/200'], ts_golden: ['golden cross', 'золотой крест'], ts_death: ['death cross', 'крест смерти'],
  ts_ob: ['overbought', 'перекупленность'], ts_os: ['oversold', 'перепроданность'], ts_macd_up: ['above signal', 'выше сигнальной'], ts_macd_dn: ['below signal', 'ниже сигнальной'],
  ts_cross_on: function(d){ return (RU ? 'пересечение ' : 'crossed ') + d }, ts_pctb_t: ['Where the price is inside the Bollinger band: 0% the lower edge, 100% the upper', 'Где цена внутри полос Боллинджера: 0% — нижняя граница, 100% — верхняя'],
  ts_atr_t: ['Average true range: a typical bar size', 'Средний истинный диапазон: обычный размер бара'], ts_sup: ['Support', 'Поддержка'], ts_res: ['Resistance', 'Сопротивление'],
  ts_tl_sup: ['Rising trend line', 'Восходящая линия тренда'], ts_tl_res: ['Falling trend line', 'Нисходящая линия тренда'], ts_broken: ['broken', 'пробита'],
  fib_cols: [['Level', 'Price', 'From price'], ['Уровень', 'Цена', 'От цены']], fib_up: ['Fibonacci retracement of the rise (from the high down)', 'Коррекция Фибоначчи от роста (от максимума вниз)'],
  fib_dn: ['Fibonacci retracement of the fall (from the low up)', 'Коррекция Фибоначчи от падения (от минимума вверх)'],
  pat_cols: [['Date', 'Pattern', 'Close'], ['Дата', 'Фигура', 'Закрытие']], pat_note: ['Latest candle patterns', 'Последние свечные фигуры'],
  pat_doji: ['Doji', 'Доджи'], pat_hammer: ['Hammer (bullish)', 'Молот (бычий)'], pat_star: ['Shooting star (bearish)', 'Падающая звезда (медвежья)'],
  pat_engulf_bull: ['Bullish engulfing', 'Бычье поглощение'], pat_engulf_bear: ['Bearish engulfing', 'Медвежье поглощение'], pat_morning: ['Morning star (bullish)', 'Утренняя звезда (бычья)'],
  pat_evening: ['Evening star (bearish)', 'Вечерняя звезда (медвежья)'], pat_dtop: ['Double top', 'Двойная вершина'], pat_dbot: ['Double bottom', 'Двойное дно'],
  ta_disclaimer: ['Calculated automatically from prices — a reading of the chart, not investment advice.', 'Рассчитано автоматически по ценам — это прочтение графика, а не инвестиционная рекомендация.'],
  vap_poc: ['Point of control', 'Точка контроля (POC)'], vap_vah: ['Value area high', 'Верх зоны стоимости'], vap_val: ['Value area low', 'Низ зоны стоимости'],
  vap_last: ['Last', 'Последняя'], vap_vs_vwap: ['vs VWAP', 'к VWAP'], vap_total: ['Volume', 'Объём'], vap_novol: ['No volume data for this instrument (indices and currencies have none).', 'По этому инструменту нет данных об объёме (у индексов и валют его нет).'],
  vap_note: ['Volume of each bar spread evenly over its high–low range; green — bars that closed up, red — down; yellow — the price with the most volume (POC); bright — the value area with 70% of the volume.',
    'Объём каждого бара распределён по его диапазону; зелёный — бары, закрывшиеся ростом, красный — падением; жёлтый — цена с наибольшим объёмом (POC); яркие — зона стоимости с 70% объёма.'],
  tsm_cols: [['Hour (MSK)', 'Open', 'High', 'Low', 'Close', 'Chg', 'Volume', '% of total', 'VWAP'], ['Час (МСК)', 'Откр.', 'Макс.', 'Мин.', 'Закр.', 'Изм.', 'Объём', '% объёма', 'VWAP']],
  tsm_open: ['Open', 'Открытие'], tsm_hi: ['High', 'Максимум'], tsm_lo: ['Low', 'Минимум'], tsm_last: ['Last', 'Последняя'],
  tsm_note: ['From 5-minute bars (1D) or 30-minute bars (5D). AQR and VWAP open this table too.', 'По 5-минутным барам (1D) или 30-минутным (5D). AQR и VWAP открывают эту же таблицу.'],
  qr_cols: [['Time (MSK)', 'Price', 'Amount', 'Value $', 'Side'], ['Время (МСК)', 'Цена', 'Кол-во', 'Сумма $', 'Сторона']], qr_buy: ['buy', 'покупка'], qr_sell: ['sell', 'продажа'],
  qr_buys: ['Bought', 'Куплено'], qr_sells: ['Sold', 'Продано'], qr_n: ['Trades', 'Сделок'],
  qr_note: ['The last trades on Binance (USDT pair), refreshed every 4 seconds; the side is the one that took the price.', 'Последние сделки на Binance (пара к USDT), обновление каждые 4 секунды; сторона — та, что взяла цену.'],
  qr_bars_note: ['There is no free tick-by-tick feed for stocks and indices: here are today\'s 5-minute bars (newest first). For crypto (BTC, ETH…) QR shows every trade.',
    'Бесплатной ленты каждой сделки для акций и индексов нет: здесь 5-минутные бары за день (новые сверху). Для крипты (BTC, ETH…) QR показывает каждую сделку.'],
  qr_nofeed_note: ['Binance\'s trade feed does not answer from your network: here are today\'s 5-minute bars (newest first).',
    'Лента сделок Binance не отвечает из вашей сети: здесь 5-минутные бары за день (новые сверху).'],
  qr_bar_cols: [['Time (MSK)', 'Close', 'Volume'], ['Время (МСК)', 'Закрытие', 'Объём']],
  tra_price: ['Price return', 'Рост цены'], tra_div: ['Dividends paid', 'Выплачено дивидендов'], tra_total: ['Total return', 'Полная доходность'], tra_ann: ['A year on average', 'В среднем за год'],
  tra_from: ['From', 'С'], tra_total_l: ['with dividends reinvested', 'с реинвестированием дивидендов'], tra_price_l: ['price only', 'только цена'],
  tra_note: ['Each dividend is reinvested at the close before the ex-date.', 'Каждый дивиденд реинвестируется по закрытию накануне экс-даты.'],
  tra_nodiv: ['No dividends in this period — total return equals the price return.', 'Дивидендов за период не было — полная доходность равна росту цены.'],
  tra_index: ['For indices, currencies and commodities only the price return is shown.', 'Для индексов, валют и сырья показан только рост цены.'],
  tray_ph: ['tickers: AAPL MSFT GOLD', 'тикеры: AAPL MSFT ЗОЛОТО'], tray_reset: ['MAIN MARKETS', 'ОСНОВНЫЕ РЫНКИ'],
  tray_note: ['Price returns; over 2, 3 and 5 years — a year on average. A click opens the chart.', 'Доходность по цене; за 2, 3 и 5 лет — в среднем за год. Нажатие открывает график.'],
  ge_none: ['Not enough reported earnings to build P/E over time (needs the SEC financials, US companies only).', 'Недостаточно отчётных данных о прибыли, чтобы построить P/E во времени (нужна отчётность SEC, только компании США).'],
  ge_now: ['P/E now', 'P/E сейчас'], ge_avg: ['average', 'среднее'], ge_z: ['From the average, σ', 'От среднего, σ'], ge_fpe: ['Forward P/E', 'Форвардный P/E'], ge_lo_hi: ['Range', 'Диапазон'],
  ge_note: ['Price divided by the trailing 12-month EPS from the SEC reports (yearly before the last eight quarters), over five years.', 'Цена, делённая на прибыль на акцию за 12 месяцев из отчётов SEC (до последних восьми кварталов — годовую), за пять лет.'],
  cacs_cols: [['Date', 'Event', 'Details'], ['Дата', 'Событие', 'Подробности']], cacs_up: ['COMING', 'ПРЕДСТОЯЩИЕ'], cacs_past: ['PAST', 'ПРОШЕДШИЕ'],
  cacs_earn: ['Earnings', 'Отчёт'], cacs_ex: ['Ex-dividend', 'Экс-дивидендная дата'], cacs_pay: ['Dividend payment', 'Выплата дивиденда'], cacs_div: ['Dividend', 'Дивиденд'],
  cacs_split: ['Split', 'Сплит'], cacs_rep: ['Quarter reported', 'Отчёт за квартал'], cacs_est_q: ['(estimated, a quarter)', '(оценка, за квартал)'],
  cacs_none: ['No corporate actions found.', 'Корпоративных событий не найдено.'], cacs_note: ['Dividends, splits, earnings dates and SEC filings in one calendar.', 'Дивиденды, сплиты, даты отчётов и документы в SEC в одном календаре.'],
  crpr_note: ['Credit ratings by Moody\'s, S&P and Fitch are not free: here are the company\'s news about its ratings and links to the agencies.', 'Кредитные рейтинги Moody\'s, S&P и Fitch платные: здесь новости компании о её рейтингах и ссылки на агентства.'],
  crpr_none: ['No rating news in the latest company news.', 'В последних новостях компании нет сообщений о рейтингах.'],

  // ---------- monitors ----------
  mov_title: ['INDEX MOVERS', 'КТО ДВИГАЕТ ИНДЕКС'], mov_idx: ['Index', 'Индекс'], mov_adv: ['Rising / falling', 'Растут / падают'], mov_sum: ['Members together', 'Участники вместе'],
  mov_members: ['Members', 'Участников'], mov_up: ['PUSH UP', 'ТЯНУТ ВВЕРХ'], mov_dn: ['PULL DOWN', 'ТЯНУТ ВНИЗ'],
  mov_cols: [['Company', 'Chg', 'Weight', 'Index pts'], ['Компания', 'Изм.', 'Вес', 'Пункты']],
  mov_note_us: ['The S&P 500 through its ~100 largest members (about two thirds of it); weights from their market caps, points ≈ weight × move × index level.', 'S&P 500 через ~100 крупнейших компаний (около двух третей индекса); веса — по капитализации, пункты ≈ вес × изменение × уровень индекса.'],
  mov_note_ru: ['The MOEX index with the exchange\'s own weights; points ≈ weight × move × index level.', 'Индекс Мосбиржи с весами самой биржи; пункты ≈ вес × изменение × уровень индекса.'],
  most_title: ['MOST ACTIVE', 'САМЫЕ АКТИВНЫЕ'], most_dollar: ['$ TURNOVER', 'ОБОРОТ $'], most_dollar_ru: ['TURNOVER ₽', 'ОБОРОТ ₽'], most_vol: ['SHARES', 'АКЦИИ ШТ.'], most_gain: ['GAINERS', 'РАСТУТ'],
  most_lose: ['LOSERS', 'ПАДАЮТ'], most_hi52: ['52W HIGHS', 'МАКС. 52 НЕД.'], most_lo52: ['52W LOWS', 'МИН. 52 НЕД.'],
  most_cols: [['Ticker', 'Company', 'Price', 'Chg', 'Volume', 'Turnover', 'From 52W high', 'From 52W low'], ['Тикер', 'Компания', 'Цена', 'Изм.', 'Объём', 'Оборот', 'От макс. 52н', 'От мин. 52н']],
  most_cols_ru: [['Ticker', 'Company', 'Price', 'Chg', 'Turnover', 'In the index'], ['Тикер', 'Компания', 'Цена', 'Изм.', 'Оборот', 'В индексе']],
  most_note: ['Among the ~100 largest US companies, today.', 'Среди ~100 крупнейших компаний США, сегодня.'], most_note_ru: ['All Moscow Exchange shares, today.', 'Все акции Мосбиржи, сегодня.'],
  mrr_title: ['MEMBERS RANKED BY RETURN', 'УЧАСТНИКИ ПО ДОХОДНОСТИ'], mrr_note_us: ['Click a column to sort. Price returns.', 'Нажмите на столбец для сортировки. Доходность по цене.'],
  mrr_note_ru: ['The exchange gives the day\'s change only; longer periods — TRAY with tickers.', 'Биржа даёт только изменение за день; за длинные периоды — TRAY с тикерами.'],
  memb_title: ['INDEX MEMBERS AND WEIGHTS', 'СОСТАВ ИНДЕКСА И ВЕСА'], memb_top10: ['Top 10 weight', 'Вес первой десятки'],
  memb_cols: [['Ticker', 'Company', 'Sector', 'Weight', 'Market cap', 'Price', 'Chg'], ['Тикер', 'Компания', 'Сектор', 'Вес', 'Капитализация', 'Цена', 'Изм.']],
  memb_note_us: ['Weights inside the ~100 largest S&P 500 members (by market cap), not the official index weights.', 'Веса внутри ~100 крупнейших компаний S&P 500 (по капитализации), а не официальные веса индекса.'],
  memb_note_ru: ['Official weights of the MOEX index from the exchange.', 'Официальные веса индекса Мосбиржи от биржи.'],
  wpe_title: ['WORLD VALUATIONS', 'ОЦЕНКА РЫНКОВ МИРА'], wpe_us100: ['P/E of the ~100 largest US stocks (weighted by market cap)', 'P/E ~100 крупнейших акций США (взвешенный по капитализации)'], wpe_fwd: ['forward', 'форвардный'],
  wpe_cols: [['Market', 'ETF', 'P/E', 'P/B', 'P/S', 'Div. yield', 'Today', 'YTD'], ['Рынок', 'ETF', 'P/E', 'P/B', 'P/S', 'Див. дох.', 'Сегодня', 'С нач. года']],
  wpe_wait: ['Valuations by country appear after the next bot run (it reads country ETFs from Yahoo Finance once a day).', 'Оценки по странам появятся после следующего запуска бота (он раз в день берёт страновые ETF с Yahoo Finance).'],
  wpe_note: ['Each market through its main country ETF (iShares/SPDR): the fund\'s P/E and yield, and P/B and P/S of the stocks it holds (Yahoo Finance). Green — cheaper than the median, red — dearer.',
    'Каждый рынок — через его основной страновой ETF (iShares/SPDR): P/E и дивидендная доходность фонда, P/B и P/S акций в нём (Yahoo Finance). Зелёный — дешевле медианы, красный — дороже.'],
  bi_title: ['SECTOR DASHBOARDS', 'ПАНЕЛЬ СЕКТОРОВ'],
  bi_cols: [['Sector', 'Market cap', 'Today', '5D', 'YTD', '1Y', 'P/E', 'Fwd P/E', 'Net margin', 'Revenue growth', 'ROE', 'Div. yield'], ['Сектор', 'Капитализация', 'Сегодня', '5Д', 'С нач. года', '1Г', 'P/E', 'Форв. P/E', 'Чистая маржа', 'Рост выручки', 'ROE', 'Див. дох.']],
  bi_sub_cols: [['Ticker', 'Company', 'Market cap', 'Today', 'YTD', 'P/E', 'Net margin', 'Revenue growth'], ['Тикер', 'Компания', 'Капитализация', 'Сегодня', 'С нач. года', 'P/E', 'Чистая маржа', 'Рост выручки']],
  bi_note: ['The ~100 largest US companies by sector: returns weighted by market cap, P/E = all market cap / all earnings, the rest — medians. A click shows the members.',
    '~100 крупнейших компаний США по секторам: доходность взвешена по капитализации, P/E = вся капитализация / вся прибыль, остальное — медианы. Нажатие показывает компании.'],
  fpc_title: ['ETF RETURNS RANKED', 'ДОХОДНОСТЬ ETF ПО МЕСТАМ'], fpc_all: ['ALL', 'ВСЕ'], fpc_eq: ['STOCKS', 'АКЦИИ'], fpc_sec: ['SECTORS', 'СЕКТОРЫ'], fpc_bond: ['BONDS', 'ОБЛИГАЦИИ'],
  fpc_cmd: ['COMMODITIES', 'СЫРЬЁ'], fpc_alt: ['REAL ESTATE, BTC', 'НЕДВИЖИМОСТЬ, BTC'],
  fpc_note: ['Price returns of the largest US-listed ETFs; click a column to sort, a row to open the chart.', 'Доходность по цене крупнейших ETF США; нажмите на столбец для сортировки, на строку — для графика.'],
  cdr_title: ['EXCHANGES: HOURS AND HOLIDAYS', 'БИРЖИ: ЧАСЫ И ПРАЗДНИКИ'],
  cdr_cols: [['Code', 'Exchange', 'Local time', 'Session, MSK', 'Now', 'Next holidays'], ['Код', 'Биржа', 'Местное время', 'Сессия, МСК', 'Сейчас', 'Ближайшие праздники']],
  cdr_open: ['OPEN', 'ОТКРЫТА'], cdr_closed: ['closed', 'закрыта'], cdr_pre: ['before the open', 'до открытия'], cdr_lunch: ['lunch break', 'перерыв'], cdr_hol: ['holiday', 'праздник'],
  cdr_closes: function(d){ return (RU ? 'закроется через ' : 'closes in ') + d }, cdr_opens: function(d){ return (RU ? 'откроется через ' : 'opens in ') + d },
  cdr_nohol: ['holidays unavailable', 'праздники недоступны'],
  cdr_note: ['NYSE, London, Xetra, Euronext and SIX holidays by the exchanges\' own rules; elsewhere — nationwide public holidays (Nager.Date), on which exchanges usually close. Half days and extended sessions are not shown.',
    'Праздники NYSE, Лондона, Xetra, Euronext и SIX — по правилам самих бирж; для остальных — общенациональные праздники (Nager.Date), в которые биржи обычно закрыты. Короткие дни и дополнительные сессии не показаны.'],
  na_title: function(c){ return c + (RU ? ' — НЕДОСТУПНО' : ' — NOT AVAILABLE') },
  na_bas: ['BAS (broker activity summary) needs exchange broker-level data, which no free source publishes.', 'BAS (сводка активности брокеров) требует данных бирж по брокерам — их не публикует ни один бесплатный источник.'],
  na_pick: ['PICK (US municipal bond offerings) needs dealer quotes from MSRB EMMA, which has no free data feed.', 'PICK (предложения муниципальных облигаций США) требует котировок дилеров из MSRB EMMA, у которого нет бесплатного потока данных.'],

  // ---------- rates panel ----------
  wb_title: ['WORLD BOND MARKETS', 'ОБЛИГАЦИИ МИРА'],
  wb_cols: [['Country', '2Y', '5Y', '10Y', '30Y', '10Y wk, bp', 'vs UST, bp', 'vs Bund, bp', '2s10s, bp', 'Date'], ['Страна', '2 года', '5 лет', '10 лет', '30 лет', '10 лет за нед., б.п.', 'к UST, б.п.', 'к Bund, б.п.', 'спред 2–10 лет, б.п.', 'Дата']],
  wb_bars: ['10-YEAR YIELDS', 'ДОХОДНОСТЬ 10 ЛЕТ'],
  wb_note: ['Yields from central banks and treasuries (as on the GC curves). * — monthly averages (ECB). A click opens the country (BTMM).', 'Доходности от центробанков и казначейств (как на кривых GC). * — среднемесячные (ЕЦБ). Нажатие открывает страну (BTMM).'],
  ctry: function(c){ return RU && CTRY_RU[c] || c },
  tenor: function(x){
    var m = RU && /^(\d+)([MY])$/.exec(x || ''), n = m && +m[1];
    if (!m) return x;
    if (m[2] === 'M') return n + ' мес';
    return n + (n % 10 === 1 && n % 100 !== 11 ? ' год' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? ' года' : ' лет');
  },
  spread: function(x){ return RU && SPREAD_RU[x] || x },
  btmm_title: function(c){ return (RU ? 'СТАВКИ И ОБЛИГАЦИИ · ' : 'RATES & BONDS · ') + c }, btmm_cb: ['POLICY RATE', 'КЛЮЧЕВАЯ СТАВКА'], btmm_prev: ['Before', 'Предыдущая'],
  btmm_since: ['Since', 'Действует с'], btmm_next: ['Next FOMC', 'Следующее заседание ФРС'], btmm_implied: ['Futures imply', 'Ожидания рынка'], btmm_mm: ['MONEY MARKET AND FX', 'ДЕНЕЖНЫЙ РЫНОК И ВАЛЮТА'],
  btmm_nomm: ['No overnight rate for this country.', 'Ставки овернайт по этой стране нет.'], btmm_curve: function(d){ return (RU ? 'КРИВАЯ НА ' : 'CURVE AS OF ') + d },
  btmm_curve_cols: [['Term', 'Yield', 'Wk, bp', 'Mo, bp'], ['Срок', 'Доходность', 'Нед., б.п.', 'Мес., б.п.']], btmm_nocurve: ['No yield curve for this country.', 'Кривой доходности по этой стране нет.'],
  btmm_eco: function(c){ return (RU ? 'КАЛЕНДАРЬ · ' : 'CALENDAR · ') + c }, btmm_noeco: ['No key releases in the coming days.', 'Важных публикаций в ближайшие дни нет.'],
  btmm_eco_cols: [['When', 'Release', 'Actual', 'Forecast', 'Previous'], ['Когда', 'Показатель', 'Факт', 'Прогноз', 'Пред.']],
  mmr_title: ['MONEY-MARKET RATES', 'СТАВКИ ДЕНЕЖНОГО РЫНКА'],
  mmr_cols: [['Rate', 'Market', 'Value', 'Chg, bp', 'Policy rate', 'vs policy, bp', 'Date'], ['Ставка', 'Рынок', 'Значение', 'Изм., б.п.', 'Ключевая', 'К ключевой, б.п.', 'Дата']],
  mmr_wait: ['Money-market rates appear after the next bot run.', 'Ставки денежного рынка появятся после следующего запуска бота.'],
  mmr_note: ['Overnight benchmark rates from the central banks: New York Fed (SOFR, EFFR), ECB (€STR), Bank of England (SONIA), Bank of Russia (RUONIA).', 'Ставки овернайт от центробанков: ФРБ Нью-Йорка (SOFR, EFFR), ЕЦБ (€STR), Банк Англии (SONIA), Банк России (RUONIA).'],
  srch_title: ['US TREASURY SECURITIES', 'КАЗНАЧЕЙСКИЕ БУМАГИ США'], srch_ph: ['CUSIP or term', 'CUSIP или срок'], srch_reopen: ['(reopening)', '(доразмещение)'],
  srch_cols: [['CUSIP', 'Term', 'Auction', 'Issue', 'Maturity', 'High yield', 'Coupon', 'Bid/cover', 'Offered'], ['CUSIP', 'Срок', 'Аукцион', 'Выпуск', 'Погашение', 'Доходность', 'Купон', 'Спрос/предл.', 'Объём']],
  srch_note: ['Auctions of the last ~13 months and the announced ones, from the US Treasury (the bot refreshes the list every few hours); type a CUSIP or a term (10-YEAR, TIPS, FRN) to filter.',
    'Аукционы за ~13 месяцев и объявленные, от Минфина США (бот обновляет список раз в несколько часов); наберите CUSIP или срок (10-YEAR, TIPS, FRN) для фильтра.'],
  srch_coming: ['announced', 'объявлен'],
  srch_pending: ['results soon', 'итоги скоро'],
  srch_wait: ['The list of auctions appears after the bot\'s next run.', 'Список аукционов появится после следующего запуска бота.'],

  // ---------- news topics ----------
  nse_mna: ['M&A', 'Слияния и поглощения'], nse_opn: ['Market open', 'Открытие рынков'], nse_uss: ['US stocks', 'Акции США'], nse_cns: ['Canada', 'Канада'],
  nse_cos: ['Companies', 'Компании'], nse_bbea: ['Earnings, up- and downgrades', 'Отчёты, повышения и понижения'], nse_ratc: ['Credit ratings', 'Кредитные рейтинги'],

  // ---------- maps ----------
  gm_title_MAP: ['WORLD MAP · LAYERS', 'КАРТА МИРА · СЛОИ'], gm_title_STORM: ['STORMS AND ENERGY ASSETS', 'ШТОРМЫ И ЭНЕРГООБЪЕКТЫ'], gm_title_SHIP: ['SHIPPING: CHOKEPOINTS AND PORTS', 'СУДОХОДСТВО: ПРОЛИВЫ И ПОРТЫ'],
  gm_title_WETR: ['WEATHER IN THE BIG CITIES', 'ПОГОДА В КРУПНЫХ ГОРОДАХ'], gm_title_ECO: ['COUNTRIES BY INDICATOR', 'СТРАНЫ ПО ПОКАЗАТЕЛЮ'],
  gm_zin: ['Zoom in', 'Приблизить'], gm_zout: ['Zoom out', 'Отдалить'], gm_home: ['The whole world', 'Весь мир'], gm_layers: ['Layers and list', 'Слои и список'],
  gm_g_live: ['LIVE', 'СОБЫТИЯ'], gm_g_mkt: ['MARKETS AND TRADE', 'РЫНКИ И ТОРГОВЛЯ'], gm_g_infra: ['INFRASTRUCTURE', 'ИНФРАСТРУКТУРА'], gm_g_wx: ['WEATHER', 'ПОГОДА'],
  gm_overlays: ['ALSO ON THE MAP', 'ТАКЖЕ НА КАРТЕ'],
  gm_l_quakes: ['Earthquakes M2.5+, 7 days', 'Землетрясения M2.5+, 7 дней'], gm_l_fires: ['Wildfires', 'Лесные пожары'], gm_l_volc: ['Volcanoes', 'Вулканы'],
  gm_l_storms: ['Tropical cyclones', 'Тропические циклоны'], gm_l_alerts: ['Disaster alerts', 'Оповещения о бедствиях'], gm_l_exch: ['Stock markets today', 'Фондовые рынки сегодня'],
  gm_l_choke: ['Shipping chokepoints', 'Морские проливы'], gm_l_ports: ['Seaports', 'Морские порты'], gm_l_plants: ['Power plants', 'Электростанции'],
  gm_l_refin: ['Oil refineries', 'НПЗ'], gm_l_lng: ['LNG terminals', 'СПГ-терминалы'], gm_l_wx: ['Temperature', 'Температура'], gm_refin: ['Oil refinery', 'НПЗ'], gm_lng: ['LNG terminal', 'СПГ-терминал'],
  gm_map_note: ['Drag to move, wheel or pinch to zoom; a click on a point gives the details. Live layers refresh by themselves.', 'Тяните, чтобы двигать, колесо или щипок — масштаб; нажатие на точку — подробности. Живые слои обновляются сами.'],
  gm_quake_leg: ['size and colour — magnitude', 'размер и цвет — магнитуда'], gm_more: ['More at the source ↗', 'Подробнее у источника ↗'], gm_nodata: ['no data', 'нет данных'],
  gm_min_ago: function(m){ return m + (RU ? ' мин назад' : ' min ago') }, gm_h_ago: function(h){ return h + (RU ? ' ч назад' : ' h ago') }, gm_d_ago: function(d){ return d + (RU ? ' дн. назад' : ' d ago') },
  gm_depth: function(k){ return (RU ? 'глубина ' : 'depth ') + k + (RU ? ' км' : ' km') }, gm_tsunami: ['⚠ tsunami warning issued', '⚠ объявлялась угроза цунами'],
  gm_pager: function(a){ return (RU ? 'PAGER (ущерб): ' : 'PAGER (impact): ') + a }, gm_source: ['source: ', 'источник: '],
  gm_wind: function(k){ return (RU ? 'ветер ' : 'wind ') + k + (RU ? ' км/ч' : ' km/h') }, gm_alert: function(a){ return (RU ? 'уровень ' : 'alert ') + a },
  gm_since: function(d){ return (RU ? 'с ' : 'since ') + d },
  gm_k_eq: ['Earthquake', 'Землетрясение'], gm_k_fl: ['Flood', 'Наводнение'], gm_k_vo: ['Volcano', 'Вулкан'], gm_k_dr: ['Drought', 'Засуха'], gm_k_wf: ['Wildfire', 'Пожар'], gm_k_tc: ['Tropical cyclone', 'Тропический циклон'],
  gm_click_chart: ['click — the chart', 'нажмите — график'], gm_no_quotes: ['quotes are not loaded yet', 'котировки ещё не загружены'],
  gm_ships_day: function(n){ return (RU ? 'судов в день: ' : 'ships a day: ') + n }, gm_tankers_day: function(n){ return (RU ? 'танкеров в день: ' : 'tankers a day: ') + n },
  gm_vs30: ['vs the previous 30 days', 'к предыдущим 30 дням'], gm_cargo_day: function(t){ return (RU ? 'груз в день: ' : 'cargo a day: ') + t + (RU ? ' млн т' : ' Mt') },
  gm_data_to: function(d){ return (RU ? 'данные по ' : 'data to ') + d }, gm_tankers_short: ['tankers', 'танкеры'],
  gm_choke_t: ['CHOKEPOINTS · 7-DAY AVERAGE', 'ПРОЛИВЫ · СРЕДНЕЕ ЗА 7 ДНЕЙ'], gm_choke_cols: ['ships/day · change', 'судов/день · изм.'],
  gm_choke_chart: ['Ships a day over 40 days: all (teal) and tankers (amber)', 'Судов в день за 40 дней: все (бирюзовый) и танкеры (янтарный)'],
  gm_ship_note: ['IMF PortWatch: daily transits counted from satellite AIS signals, a few days behind (the bot keeps a copy). Red — traffic fell more than 15% against the previous 30 days. Ships worldwide and tankers at the chokepoints: aisstream.io — the bot listens to the world\'s AIS for a minute every 30 minutes (receivers are on land: ships far out at sea are not seen). Baltic: live AIS from Finland\'s Digitraffic. The arrow is the course, the line behind a ship its track, the dashes where it will be in 30 minutes.',
    'IMF PortWatch: суточные проходы по спутниковым AIS-сигналам, с отставанием в несколько дней (бот хранит копию). Красный — трафик упал более чем на 15% к предыдущим 30 дням. Суда по миру и танкеры в проливах — aisstream.io: бот слушает мировой AIS минуту каждые 30 минут (приёмники на берегу: суда далеко в открытом море не видны). Балтика — живой AIS финского Digitraffic. Стрелка — курс, линия за судном — его путь, пунктир — где оно будет через 30 минут.'],
  gm_l_gas: ['Natural gas: fields and storage', 'Газ: месторождения и ПХГ'], gm_l_oilst: ['Oil terminals and depots', 'Нефтяные терминалы и нефтебазы'],
  gm_l_fact: ['Heavy industry', 'Тяжёлая промышленность'], gm_l_ships: ['Vessels (Baltic, live)', 'Суда (Балтика, онлайн)'],
  gm_l_tankers: ['Tankers at the chokepoints', 'Танкеры в проливах'], gm_l_world: ['Ships worldwide (tankers, cargo)', 'Суда по миру (танкеры, грузовые)'],
  gm_world_t: ['SHIPS · WORLD, AIS (6 H)', 'СУДА · МИР, AIS (6 Ч)'], gm_world_every: ['tracks every 30 min', 'треки — каждые 30 мин'],
  gm_world_nokey: ['Ships worldwide: no data yet — the bot needs the free aisstream.io key (secret AISSTREAM_API_KEY); with it the first positions appear within 30 minutes',
    'Суда по миру: данных пока нет — боту нужен бесплатный ключ aisstream.io (секрет AISSTREAM_API_KEY); с ним первые позиции появятся в течение 30 минут'],
  gm_world_none: ['Ships worldwide: none seen in the last 6 hours', 'Суда по миру: за 6 часов не замечены'],
  gm_ship_course: function(d){ return (RU ? 'курс ' : 'course ') + d + '°' },
  gm_ship_trk: function(h){ return RU ? 'линия — путь за ' + h + ' ч, пунктир — где будет через 30 мин' : 'line — the track over ' + h + ' h, dashes — where it will be in 30 min' },
  gm_ship_ahead: ['dashes — where it will be in 30 min at this speed', 'пунктир — где будет через 30 мин при этой скорости'],
  gm_fly_channel: ['English Channel', 'Ла-Манш'], gm_fly_hormuz: ['Hormuz', 'Ормуз'], gm_fly_redsea: ['Red Sea', 'Красное море'], gm_fly_sing: ['Singapore', 'Сингапур'],
  gm_base_sat: ['Satellite', 'Спутник'], gm_base_day: ['Day', 'День'], gm_base_night: ['Night', 'Ночь'], gm_base_scheme: ['Scheme', 'Схема'],
  gm_fly_bosp: ['Bosporus', 'Босфор'], gm_fly_gulfmex: ['Gulf of Mexico', 'Мексиканский залив'],
  gm_pw_fail: ['IMF PortWatch is not answering; the bot keeps a copy of its data (every 6 hours) — it appears after the bot\'s next update.',
    'IMF PortWatch сейчас не отвечает; бот хранит копию его данных (раз в 6 часов) — она появится после следующего обновления бота.'],
  sat_tab: ['SAT · OIL FROM SPACE', 'SAT · НЕФТЬ ИЗ КОСМОСА'], gm_title_SAT: ['OIL STORAGE FROM SPACE · SENTINEL-2', 'НЕФТЕХРАНИЛИЩА ИЗ КОСМОСА · SENTINEL-2'],
  m_sat: ['Oil storage from space', 'Нефтехранилища из космоса'], sat_loading: ['loading the pictures…', 'загружаю снимки…'],
  sat_none: ['No satellite pictures yet: the bot takes them from Sentinel-2 (Copernicus, no key needed) — the first ones appear within a few hours of its update.',
    'Спутниковых снимков пока нет: бот берёт их у Sentinel-2 (Copernicus, ключ не нужен) — первые появятся в течение нескольких часов после его обновления.'],
  sat_lead: ['The world\'s main oil storage hubs from orbit: Copernicus Sentinel-2, 10 m per pixel, a new pass every 2–5 days. The bot keeps the latest clear picture of each hub and a few older ones. Open a hub to compare “then” and “now”.',
    'Главные нефтехранилища мира с орбиты: Copernicus Sentinel-2, 10 м на пиксель, новый пролёт каждые 2–5 дней. Бот хранит последний чистый снимок каждого хаба и несколько прошлых. Откройте хаб, чтобы сравнить «было» и «стало».'],
  sat_wait: ['no clear picture yet', 'чистого снимка пока нет'],
  sat_taken: function(d){ return (RU ? 'снимок ' : 'picture of ') + d },
  sat_n: function(n){ return RU ? 'снимков: ' + n : n + ' pictures' },
  sat_note: ['At 10 m you can see the tanks (circles 30–100 m across), new tanks being built, tankers at the jetties, fresh earthworks. How full the tanks are cannot be read at this resolution — that needs ~0.5 m commercial pictures.',
    'На 10 м видны резервуары (круги 30–100 м), строительство новых, танкеры у причалов, свежие земляные работы. Насколько заполнены резервуары, при таком разрешении не определить — для этого нужны коммерческие снимки ~0,5 м.'],
  sat_upd: function(d){ return (RU ? 'обновлено ' : 'updated ') + d },
  sat_all: ['All hubs', 'Все хабы'], sat_full_t: ['Full screen', 'Во весь экран'], sat_km: ['km', 'км'], sat_cmp: ['Compare with:', 'Сравнить со снимком:'], sat_onmap: ['On the map', 'На карте'],
  sat_then: function(d){ return (RU ? 'было · ' : 'then · ') + d }, sat_now: function(d){ return (RU ? 'стало · ' : 'now · ') + d },
  sat_meta: function(d, t, cl, km){ return (RU ? 'Снимок ' : 'Picture of ') + d + (t ? ' ' + t + ' UTC' : '') + (RU ? ' · облака над хабом ' : ' · clouds over the hub ') + cl + '% · ' + km + '×' + km + (RU ? ' км' : ' km') },
  sat_how: ['Drag the yellow handle to compare; wheel or ＋/− to zoom, drag to move when zoomed in, double-click to reset, ⛶ — full screen.',
    'Тяните жёлтую ручку, чтобы сравнить; колесо или ＋/− — приблизить (до 8×), при приближении тяните, чтобы двигать, двойной клик — сброс, ⛶ — во весь экран.'],
  sat_how1: ['Only one clear picture so far — the next pass will be added for comparison. Wheel or ＋/− to zoom, drag to move, ⛶ — full screen.',
    'Пока есть только один чистый снимок — следующий пролёт добавится для сравнения. Колесо или ＋/− — приблизить, тяните, чтобы двигать, ⛶ — во весь экран.'],
  sat_click: ['click — satellite pictures', 'клик — спутниковые снимки'],
  gm_tankers_nokey: ['Tankers: no data yet — the bot needs a free aisstream.io key (secret AISSTREAM_API_KEY)', 'Танкеры: данных пока нет — боту нужен бесплатный ключ aisstream.io (секрет AISSTREAM_API_KEY)'],
  gm_tankers_none: ['Tankers: none seen in the last 12 hours', 'Танкеры: за 12 часов не замечены'],
  splc_tab: ['SPLC · SUPPLY CHAIN', 'SPLC · ЦЕПОЧКА ПОСТАВОК'], gm_title_SPLC: ['OIL SUPPLY CHAIN: PRODUCERS → CHOKEPOINTS → BUYERS', 'ЦЕПОЧКА ПОСТАВОК НЕФТИ: ПРОИЗВОДИТЕЛИ → ПРОЛИВЫ → ПОКУПАТЕЛИ'],
  m_splc: ['Oil supply chain', 'Цепочка поставок нефти'], m_tankers: ['Tankers at the chokepoints', 'Танкеры в проливах'],
  sp_mbd: ['mb/d', 'млн барр./сут'], sp_vs: function(q){ return RU ? 'к ' + q : 'vs ' + q },
  sp_live: function(n, ch){ return RU ? 'сейчас: ' + n + ' танкеров/день (' + ch + ' к 30 дням)' : 'now: ' + n + ' tankers/day (' + ch + ' vs 30 days)' },
  sp_side: ['CHOKEPOINTS · MB/D', 'ПРОЛИВЫ · МЛН БАРР./СУТ'],
  sp_live_s: function(n, ch){ return RU ? 'сейчас ' + n + ' танк./день ' + ch : 'now ' + n + ' tankers/day ' + ch },
  sp_note: function(base){
    var q = function(x){ return RU ? x[0] + ' кв. 20' + x.slice(2) : x };
    return RU ? 'Нефть и нефтепродукты через каждый пролив, млн баррелей в сутки по кварталам (EIA; бот обновляет цифры сам, когда EIA публикует новые). '
      + (base ? 'Красный — на 15%+ ниже, чем в ' + q(base) + ', жёлтый — выше. ' : '')
      + 'Онлайн: танкеров в день за последние 7 дней против 30 до них (IMF PortWatch, спутниковый AIS; отставание в несколько дней). EIA предупреждает, что цифры по Ормузу могут пересматриваться: AIS-сигналы там ненадёжны с февраля 2026. Маршруты — основные, упрощённо. Нажмите на узел, чтобы выделить его маршруты.'
      : 'Crude oil and products through each chokepoint, million barrels a day by quarter (EIA; the bot picks up new figures when EIA publishes them). '
      + (base ? 'Red — at least 15% lower than in ' + q(base) + ', yellow — higher. ' : '')
      + 'Live: tankers a day, the last 7 days against the 30 before (IMF PortWatch, satellite AIS; a few days behind). EIA warns that Hormuz figures may be revised: AIS signals there have been unreliable since February 2026. Routes are the main ones, simplified. Click a node to follow its routes.';
  },
  gm_gas_field: ['Natural gas field', 'Газовое месторождение'], gm_gas_storage: ['Underground gas storage', 'Подземное хранилище газа'],
  gm_oil_port: ['Oil port (most calls by tankers)', 'Нефтяной порт (больше всего заходов танкеров)'],
  gm_tanker_calls: function(n){ return (RU ? 'заходов танкеров (PortWatch): ' : 'tanker calls (PortWatch): ') + n },
  gm_tanker_share: function(n){ return RU ? n + '% всех заходов' : n + '% of all calls' },
  gm_depot: ['Oil depot / tank farm', 'Нефтебаза / резервуарный парк'],
  gm_fact_steel: ['Steel', 'Сталь'], gm_fact_aluminium: ['Aluminium', 'Алюминий'], gm_fact_cement: ['Cement', 'Цемент'], gm_fact_chemicals: ['Chemicals', 'Химия'],
  gm_fact_paper: ['Pulp and paper', 'Целлюлоза и бумага'], gm_fact_glass: ['Glass', 'Стекло'], gm_fact_metals: ['Other metals', 'Другие металлы'],
  gm_capacity: function(x){ return RU ? 'мощность ' + x + ' млн т в год' : 'capacity ' + x + ' Mt a year' },
  gm_co2: function(x){ return RU ? 'выбросы ' + x + ' млн т CO₂e в год' : 'emissions ' + x + ' Mt CO₂e a year' },
  gm_ship_tanker: ['Tankers', 'Танкеры'], gm_ship_cargo: ['Cargo ships', 'Грузовые'], gm_ship_pass: ['Passenger', 'Пассажирские'], gm_ship_service: ['Tugs, pilots, service', 'Буксиры, лоцманы, служебные'], gm_ship_other: ['Other', 'Прочие'],
  gm_ship1_tanker: ['Tanker', 'Танкер'], gm_ship1_cargo: ['Cargo ship', 'Грузовое судно'], gm_ship1_pass: ['Passenger ship', 'Пассажирское судно'], gm_ship1_service: ['Service vessel', 'Служебное судно'], gm_ship1_other: ['Vessel', 'Судно'],
  gm_ship_speed: function(v){ return RU ? 'идёт ' + v + ' уз' : 'under way, ' + v + ' kn' },
  gm_ship_anchor: ['at anchor', 'на якоре'], gm_ship_moored: ['moored', 'у причала'], gm_ship_still: ['not moving', 'стоит'],
  gm_ship_dest: function(d){ return (RU ? 'пункт назначения: ' : 'destination: ') + d },
  gm_ship_draught: function(d){ return (RU ? 'осадка ' : 'draught ') + d + (RU ? ' м' : ' m') },
  gm_ships_t: ['VESSELS · BALTIC, LIVE AIS', 'СУДА · БАЛТИКА, ОНЛАЙН AIS'],
  gm_ships_cols: ['all · under way', 'всего · в пути'],
  gm_ships_at: function(t){ return (RU ? 'Позиции AIS на ' : 'AIS positions as of ') + t + (RU ? ' МСК' : ' MSK') },
  gm_fly_gof: ['Gulf of Finland: Primorsk, Ust-Luga', 'Финский залив: Приморск, Усть-Луга'], gm_fly_baltic: ['The whole Baltic', 'Вся Балтика'],
  gm_port_rank: function(r){ return (RU ? 'класс порта ' : 'port class ') + r + (RU ? ' (1 — крупнейшие)' : ' (1 — the largest)') },
  gm_mw: ['MW', 'МВт'], gm_port_calls: function(n){ return (RU ? 'заходов судов (PortWatch): ' : 'vessel calls (PortWatch): ') + n },
  gm_fuel_coal: ['Coal', 'Уголь'], gm_fuel_gas: ['Gas', 'Газ'], gm_fuel_oil: ['Oil', 'Нефть'], gm_fuel_nuclear: ['Nuclear', 'АЭС'], gm_fuel_hydro: ['Hydro', 'ГЭС'],
  gm_fuel_wind: ['Wind', 'Ветер'], gm_fuel_solar: ['Solar', 'Солнце'], gm_fuel_biomass: ['Biomass', 'Биомасса'], gm_fuel_geothermal: ['Geothermal', 'Геотермальные'],
  gm_fuel_waste: ['Waste', 'Мусор'], gm_fuel_storage: ['Storage', 'Накопители'], gm_fuel_other: ['Other', 'Прочие'],
  gm_plant_coal: ['Coal power plant', 'Угольная электростанция'], gm_plant_gas: ['Gas power plant', 'Газовая электростанция'], gm_plant_oil: ['Oil power plant', 'Мазутная электростанция'],
  gm_plant_nuclear: ['Nuclear power plant', 'АЭС'], gm_plant_hydro: ['Hydro power plant', 'ГЭС'], gm_plant_wind: ['Wind farm', 'Ветровая электростанция'], gm_plant_solar: ['Solar plant', 'Солнечная электростанция'],
  gm_plant_biomass: ['Biomass plant', 'Электростанция на биомассе'], gm_plant_geothermal: ['Geothermal plant', 'Геотермальная электростанция'], gm_plant_waste: ['Waste-to-energy plant', 'Мусоросжигательная электростанция'],
  gm_plant_storage: ['Energy storage', 'Накопитель энергии'], gm_plant_other: ['Power plant', 'Электростанция'],
  gm_storms_now: ['ACTIVE TROPICAL CYCLONES', 'АКТИВНЫЕ ТРОПИЧЕСКИЕ ЦИКЛОНЫ'], gm_no_storms: ['No active tropical cyclones right now.', 'Сейчас нет активных тропических циклонов.'],
  gm_near300: ['within 300 km: ', 'в 300 км: '],
  gm_storm_note: ['GDACS (UN / EU): position, track and forecast cone; category by the Saffir–Simpson scale. Tick refineries, LNG and oil terminals, gas sites, ports, power plants and heavy industry to see what is in the way.',
    'GDACS (ООН / ЕС): положение, траектория и конус прогноза; категория — по шкале Саффира–Симпсона. Отметьте НПЗ, СПГ- и нефтяные терминалы, газовые объекты, порты, электростанции и тяжёлую промышленность, чтобы увидеть, что на пути.'],
  gm_wx_now: function(t, w){ return (RU ? 'сейчас ' : 'now ') + t + '°C, ' + (RU ? 'ветер ' : 'wind ') + w + (RU ? ' км/ч' : ' km/h') },
  gm_wx_today: function(a, b){ return (RU ? 'сегодня ' : 'today ') + a + '…' + b + '°C' },
  gm_wx_week: function(m, h, c){ return (RU ? 'неделя: в среднем ' : 'week: mean ') + m + '°C · HDD ' + h + ' · CDD ' + c },
  gm_wx_now_t: ['Temperature now, °C', 'Температура сейчас, °C'], gm_wx_mean_t: ['7-day mean temperature, °C', 'Средняя температура за 7 дней, °C'],
  gm_wx_hdd_t: ['Heating degree days over the next 7 days (base 18 °C): more — more heating, more gas', 'Градусо-дни отопления на 7 дней вперёд (база 18 °C): больше — больше отопления и газа'],
  gm_wx_cdd_t: ['Cooling degree days over the next 7 days (base 18 °C): more — more air conditioning, more power', 'Градусо-дни охлаждения на 7 дней вперёд (база 18 °C): больше — больше кондиционеров и электричества'],
  gm_wx_c_now: ['NOW', 'СЕЙЧАС'], gm_wx_mean: ['7 DAYS', '7 ДНЕЙ'], gm_wx_hdd: ['HDD', 'HDD'], gm_wx_cdd: ['CDD', 'CDD'], gm_wx_cities: ['CITIES', 'ГОРОДА'],
  gm_wx_cols_now: ['now · today', 'сейчас · сегодня'], gm_wx_cols_mean: ['7-day mean · today', 'среднее 7 дн. · сегодня'], gm_wx_cols_hdd: ['HDD 7 days · today', 'HDD 7 дн. · сегодня'], gm_wx_cols_cdd: ['CDD 7 days · today', 'CDD 7 дн. · сегодня'],
  gm_wx_note: ['Open-Meteo forecast. Degree days drive gas and power demand: Europe, the US Northeast and Asia in winter (HDD), the US South and India in summer (CDD).',
    'Прогноз Open-Meteo. Градусо-дни двигают спрос на газ и электричество: Европа, северо-восток США и Азия зимой (HDD), юг США и Индия летом (CDD).'],
  gm_eco_NGDP_RPCH: ['Real GDP growth this year, %', 'Рост реального ВВП в этом году, %'], gm_eco_PCPIPCH: ['Inflation this year, %', 'Инфляция в этом году, %'],
  gm_eco_LUR: ['Unemployment, %', 'Безработица, %'], gm_eco_GGXWDG_NGDP: ['Government debt, % of GDP', 'Госдолг, % ВВП'], gm_eco_BCA_NGDPD: ['Current account, % of GDP', 'Текущий счёт, % ВВП'],
  gm_eco_GGXCNL_NGDP: ['Budget balance, % of GDP', 'Сальдо бюджета, % ВВП'], gm_eco_CB: ['Central bank policy rate, %', 'Ключевая ставка центробанка, %'], gm_eco_Y10: ['10-year government bond yield, %', 'Доходность 10-летних гособлигаций, %'],
  gm_eco_MKT: ['Main stock index today, %', 'Основной фондовый индекс сегодня, %'],
  gm_eco_s_NGDP_RPCH: ['GDP', 'ВВП'], gm_eco_s_PCPIPCH: ['INFLATION', 'ИНФЛЯЦИЯ'], gm_eco_s_LUR: ['UNEMPL.', 'БЕЗРАБОТ.'], gm_eco_s_GGXWDG_NGDP: ['DEBT', 'ДОЛГ'],
  gm_eco_s_BCA_NGDPD: ['CURR. ACC.', 'ТЕК. СЧЁТ'], gm_eco_s_GGXCNL_NGDP: ['BUDGET', 'БЮДЖЕТ'], gm_eco_s_CB: ['POLICY RATE', 'СТАВКА ЦБ'], gm_eco_s_Y10: ['10Y', '10 ЛЕТ'], gm_eco_s_MKT: ['STOCKS', 'АКЦИИ'],
  gm_eco_imf_note: function(y){ return (RU ? 'МВФ, World Economic Outlook, ' : 'IMF World Economic Outlook, ') + y + (RU ? ' (оценка/прогноз).' : ' (estimate / forecast).') },
  gm_eco_cb_note: ['Central bank rates from the GC/CB data (the ECB rate colours the euro area).', 'Ставки центробанков из данных GC/CB (ставка ЕЦБ окрашивает еврозону).'],
  gm_eco_y10_note: ['10-year yields of the countries with curves in GC/WB.', 'Доходности 10-летних бумаг стран, по которым есть кривые в GC/WB.'],
  gm_eco_mkt_note: ['Live: the main index of each market in the terminal.', 'Онлайн: основной индекс каждого рынка из терминала.'],
  ecst_map_note: ['This year\'s estimates from the IMF World Economic Outlook (the full five-year table is kept for the largest economies).', 'Оценки на этот год из World Economic Outlook МВФ (полная таблица на пять лет — для крупнейших экономик).'],
  gm_open_ecst: ['ECST · the country\'s economy', 'ECST · экономика страны'], gm_src_curves: ['central banks and treasuries', 'центробанки и казначейства'],

  p_gex: ['OPTIONS · DEALER POSITIONING', 'ОПЦИОНЫ · ПОЗИЦИИ ДИЛЕРОВ'], fn_gex: ['Options: GEX, levels, volatility', 'Опционы: GEX, уровни, волатильность'],
  gex_tab: ['GEX · EXPOSURE', 'GEX · ЭКСПОЗИЦИЯ'], lvl_tab: ['LVL · LEVELS', 'LVL · УРОВНИ'], vols_tab: ['VOLS · SURFACE', 'VOLS · ПОВЕРХНОСТЬ'],
  grk_tab: ['GRK · GREEKS', 'GRK · ГРЕКИ'], gexh_tab: ['GEXH · HISTORY', 'GEXH · ИСТОРИЯ'],
  m_gex: ['Gamma exposure by strike', 'Гамма-экспозиция по страйкам'], m_lvl: ['Option levels and expected move', 'Опционные уровни и ожидаемый ход'],
  m_vols: ['Volatility surface 3D', 'Поверхность волатильности 3D'], m_grk: ['Greeks by strike and expiry', 'Греки по страйкам и экспирациям'],
  m_gexh: ['GEX history and interval map', 'История GEX и интервальная карта'],
  gex_t_GEX: function(s){ return (RU ? 'ГАММА-ЭКСПОЗИЦИЯ · ' : 'GAMMA EXPOSURE · ') + s },
  gex_t_LVL: function(s){ return (RU ? 'УРОВНИ И ОЖИДАЕМЫЙ ХОД · ' : 'LEVELS & EXPECTED MOVE · ') + s },
  gex_t_VOLS: function(s){ return (RU ? 'ВОЛАТИЛЬНОСТЬ · ' : 'VOLATILITY · ') + s },
  gex_t_GRK: function(s){ return (RU ? 'ГРЕКИ · ' : 'GREEKS · ') + s },
  gex_t_GEXH: function(s){ return (RU ? 'ИСТОРИЯ GEX · ' : 'GEX HISTORY · ') + s },
  ago_now: ['just now', 'только что'], ago_min: function(m){ return RU ? m + ' мин назад' : m + ' min ago' }, ago_h: function(h){ return RU ? h + ' ч назад' : h + ' h ago' },
  gex_none: function(s){ return RU ? 'По ' + s + ' опционных данных пока нет: бот обновляет их каждые 15 минут (индексы и крипта) или раз в час (акции) — загляните чуть позже.' : 'No option data for ' + s + ' yet: the bot refreshes it every 15 minutes (indexes and crypto) or every hour (stocks) — check back a little later.' },
  gex_which: function(a, b){ return RU ? 'Позиции дилеров считаются для: ' + a + ' и крупных акций (' + b + '…). Выберите вверху или введите тикер.' : 'Dealer positioning is kept for: ' + a + ' and the big stocks (' + b + '…). Pick one above or type a ticker.' },
  gex_other: ['ticker…', 'тикер…'],
  gex_pos: ['Positive gamma: dealers sell rallies and buy dips — moves tend to be damped.', 'Положительная гамма: дилеры продают рост и покупают падение — движения гасятся.'],
  gex_neg: ['Negative gamma: dealers trade with the move — moves tend to speed up.', 'Отрицательная гамма: дилеры торгуют по движению — движения ускоряются.'],
  gex_spot: ['Price', 'Цена'], gex_total: ['Total GEX', 'Сумма GEX'], gex_total_t: ['Dollars of the underlying dealers would buy (+) or sell (−) for each 1% move', 'Сколько долларов базового актива дилеры купят (+) или продадут (−) на каждый 1% движения'],
  gex_flip: ['Gamma flip', 'Смена гаммы'], gex_flip_t: ['Above it dealer gamma is positive (calm), below it negative (volatile)', 'Выше — гамма дилеров положительная (спокойнее), ниже — отрицательная (волатильнее)'],
  gex_cwall: ['Call wall', 'Стена коллов'], gex_cwall_t: ['The strike with the most call gamma: often resistance', 'Страйк с наибольшей гаммой коллов: часто сопротивление'],
  gex_pwall: ['Put wall', 'Стена путов'], gex_pwall_t: ['The strike with the most put gamma: often support', 'Страйк с наибольшей гаммой путов: часто поддержка'],
  gex_pcr: ['Put/call OI', 'Путы/коллы OI'],
  gex_m_cp: ['CALLS & PUTS', 'КОЛЛЫ И ПУТЫ'], gex_m_net: ['NET', 'НЕТТО'], gex_m_front: ['NEAREST EXPIRY', 'БЛИЖАЙШАЯ ЭКСП.'], gex_m_vanna: ['VANNA', 'ВАННА'],
  gex_m_charm: ['CHARM', 'ЧАРМ'], gex_m_oi: ['OPEN INTEREST', 'ОТКРЫТЫЙ ИНТЕРЕС'],
  gex_note: ['GEX — gamma × open interest × contract × price² × 1%, all expiries within 4 months. The dealer side is the usual public estimate (dealers long calls, short puts), not their real positions. Vanna — $ of delta per 1 volatility point, charm — per day.',
    'GEX — гамма × открытый интерес × контракт × цена² × 1%, все экспирации до 4 месяцев. Сторона дилеров — обычная публичная оценка (дилеры в длинных коллах и коротких путах), а не их реальные позиции. Ванна — $ дельты на 1 пункт волатильности, чарм — за день.'],
  gex_puts_oi: ['← puts', '← путы'], gex_calls_oi: ['calls →', 'коллы →'], gex_neg_side: ['negative', 'отрицательная'], gex_pos_side: ['positive', 'положительная'],
  gex_strike: ['Strike', 'Страйк'], gex_calls: ['Calls', 'Коллы'], gex_puts: ['Puts', 'Путы'], gex_net: ['Net', 'Нетто'],
  gex_level: ['Level', 'Уровень'], gex_value: ['Value', 'Значение'], gex_dist: ['From price', 'От цены'], gex_what: ['What it means', 'Что это значит'],
  gex_maxpos: ['Most + gamma', 'Макс. + гамма'], gex_maxpos_t: ['The strike that pins the price most', 'Страйк, сильнее всего «притягивающий» цену'],
  gex_maxneg: ['Most − gamma', 'Макс. − гамма'], gex_maxneg_t: ['Where moves can speed up', 'Где движение может ускориться'],
  gex_pain: ['Max pain', 'Макс. боль'], gex_pain_t: function(d){ return RU ? 'Цена, при которой покупатели опционов теряют больше всего (экспирация ' + d + ')' : 'The price at which option buyers lose the most (expiry ' + d + ')' },
  gex_em_lo: ['−1σ today', '−1σ за день'], gex_em_hi: ['+1σ today', '+1σ за день'],
  gex_em_t: function(p, iv){ return RU ? 'Один стандартный ход за день: ±' + p + '% (из 30-дневной IV ' + iv + '); ~68% дней закрываются внутри' : 'One standard daily move: ±' + p + '% (from the 30-day IV ' + iv + '); ~68% of days close inside' },
  gex_emw_lo: ['−1σ week', '−1σ за неделю'], gex_emw_hi: ['+1σ week', '+1σ за неделю'],
  gex_straddle: function(d){ return RU ? 'Стрэддл до ' + d : 'Straddle to ' + d },
  gex_straddle_t: function(a, p){ return RU ? 'Цена ATM-стрэддла ' + a + ' (±' + p + '%) — ход, который рынок закладывает до экспирации' : 'The at-the-money straddle costs ' + a + ' (±' + p + '%) — the move the market prices to the expiry' },
  gex_vix: function(v){ return 'VIX ' + v + ' · +1σ' }, gex_dvol: function(v){ return 'DVOL ' + v + ' · +1σ' },
  gex_vix_t: function(sd, lo){ return RU ? 'Дневной ход по индексу волатильности: ' + sd + ' (вниз до ' + lo + ')' : 'The daily move by the volatility index: ' + sd + ' (down to ' + lo + ')' },
  gex_on_chart: ['Show the levels on the chart (TECH)', 'Показать уровни на графике (TECH)'], gex_prof: ['Total GEX if the price moved here', 'Сумма GEX, если бы цена была здесь'],
  gex_lvl_note: ['The profile recomputes every option\'s gamma at other prices; where it crosses zero is the gamma flip. US options are 15+ minutes delayed.', 'Профиль пересчитывает гамму каждого опциона при других ценах; где он пересекает ноль — смена гаммы. Опционы США — с задержкой от 15 минут.'],
  gex_3d: ['3D', '3D'], gex_heat: ['HEATMAP', 'ТЕПЛОКАРТА'], gex_table: ['TABLE', 'ТАБЛИЦА'], gex_iv30: ['IV 30 days', 'IV 30 дней'], gex_front_iv: ['Nearest IV', 'Ближняя IV'], gex_back_iv: ['Farthest IV', 'Дальняя IV'],
  gex_moneyness: ['strike / price', 'страйк / цена'], gex_expiry: ['expiry', 'экспирация'], gex_smile: function(d){ return (RU ? 'Улыбка · ' : 'Smile · ') + d }, gex_term: ['Term structure (ATM IV by days)', 'Временная структура (ATM IV по дням)'],
  gex_d: [' d', ' дн'], gex_dvol_t: ['DVOL — 30-day implied volatility index, 7 days', 'DVOL — индекс 30-дневной ожидаемой волатильности, 7 дней'],
  gex_vols_note: ['Out-of-the-money options form the surface (puts below the price, calls above). A steep left side = demand for protection.', 'Поверхность строится по опционам вне денег (путы ниже цены, коллы выше). Крутой левый край — спрос на защиту.'],
  gex_drag: ['drag to turn', 'потяните, чтобы повернуть'],
  grk_dc: ['Call delta', 'Дельта колла'], grk_dp: ['Put delta', 'Дельта пута'], grk_g: ['Gamma: Δ change per 1% move', 'Гамма: изменение Δ на 1% движения'],
  grk_tc: ['Call theta, $ per day', 'Тета колла, $ в день'], grk_tp: ['Put theta, $ per day', 'Тета пута, $ в день'], grk_v: ['Vega, $ per volatility point', 'Вега, $ на пункт волатильности'],
  grk_note: ['Black-Scholes greeks from each option\'s implied volatility, per one option on one unit of the underlying (one share / one coin).', 'Греки Блэка-Шоулза из ожидаемой волатильности каждого опциона, на один опцион на единицу актива (одна акция / одна монета).'],
  gex_hist_none: ['No intraday snapshots for this day.', 'За этот день снимков нет.'], gex_iv_day: ['IV and straddle through the day, %', 'IV и стрэддл в течение дня, %'],
  gex_st_short: ['Straddle', 'Стрэддл'], gex_daily: ['Total GEX by day', 'Сумма GEX по дням'], gex_px_flip: ['Price, gamma flip and walls by day', 'Цена, смена гаммы и стены по дням'],
  gex_hist_note: ['Interval map: a circle for each strike at each snapshot — green positive, red negative gamma, size = how much. The history starts when the bot began keeping it.', 'Интервальная карта: круг на каждый страйк в каждом снимке — зелёный положительная, красный отрицательная гамма, размер — сколько. История начинается с момента, когда бот стал её вести.'],
  ta_gex: ['OPTION LEVELS', 'ОПЦ. УРОВНИ'],
  ta_gex_none: function(l){ return RU ? 'Опционные уровни есть для: ' + l : 'Option levels exist for: ' + l },
  ta_gex_far: function(s){ return RU ? 'Опционные уровни ' + s + ' не подходят к ценам этого графика' : 'The option levels of ' + s + ' do not fit the prices of this chart' },

  p_flow: ['ORDER FLOW', 'ПОТОК ОРДЕРОВ'], fn_flow: ['Crypto order flow: heatmap, DOM, footprint, CVD', 'Поток ордеров крипты: теплокарта, стакан, кластеры, CVD'],
  heat_tab: ['HEAT · BOOK HEATMAP', 'HEAT · ТЕПЛОКАРТА СТАКАНА'], book_tab: ['BOOK · DOM & TAPE', 'BOOK · СТАКАН И ЛЕНТА'], foot_tab: ['FOOT · FOOTPRINT', 'FOOT · КЛАСТЕРЫ'], cvd_tab: ['CVD · DELTA', 'CVD · ДЕЛЬТА'],
  m_obh: ['Order book heatmap (crypto)', 'Теплокарта стакана (крипта)'], m_book: ['Order book and tape', 'Стакан и лента сделок'], m_foot: ['Footprint candles', 'Кластерный график'], m_cvd: ['Cumulative volume delta', 'Кумулятивная дельта объёма'],
  fl_t_HEAT: function(p){ return (RU ? 'ТЕПЛОКАРТА СТАКАНА · ' : 'ORDER BOOK HEATMAP · ') + p }, fl_t_BOOK: function(p){ return (RU ? 'СТАКАН И ЛЕНТА · ' : 'DOM & TAPE · ') + p },
  fl_t_FOOT: function(p){ return (RU ? 'КЛАСТЕРЫ · ' : 'FOOTPRINT · ') + p }, fl_t_CVD: function(p){ return (RU ? 'ДЕЛЬТА ОБЪЁМА · ' : 'VOLUME DELTA · ') + p },
  fl_connecting: function(p){ return (RU ? 'подключение к Binance: ' : 'connecting to Binance: ') + p + '…' }, fl_live: ['live', 'онлайн'],
  fl_fail: function(m){ return (RU ? 'Binance не отвечает (' : 'Binance does not answer (') + m + (RU ? ') — пробую зеркало…' : ') — trying the mirror…') },
  fl_other: ['coin…', 'монета…'], fl_nopair: function(p){ return (RU ? 'На Binance нет пары ' : 'Binance has no pair ') + p }, fl_collect: ['collecting the first seconds of the book…', 'собираю первые секунды стакана…'],
  fl_row: ['row =', 'строка ='], fl_dist: ['from the mid', 'от середины'], fl_contrast_t: ['Contrast: how much of the book stays dark', 'Контраст: какая часть стакана остаётся тёмной'],
  zoom_in_t: ['Zoom in', 'Приблизить'], zoom_out_t: ['Zoom out', 'Отдалить'], zoom_reset_t: ['Reset zoom and scroll', 'Сбросить масштаб и прокрутку'],
  fl_zoom_hint_XY: ['wheel — price · Shift+wheel — time · drag — scroll · double-click — reset', 'колесо — цена · Shift+колесо — время · тянуть — прокрутка · двойной клик — сброс'],
  fl_zoom_hint_CVD: ['wheel — zoom · drag — scroll back · double-click — reset', 'колесо — масштаб · тянуть — назад по времени · двойной клик — сброс'],
  fl_heat_filling: function(s){ return RU ? 'история стакана копится: ' + s + ' с · левее — путь цены по сделкам' : 'the book\'s history is filling: ' + s + ' s · to the left — the price\'s path from trades' },
  fl_unknown: ['beyond the book Binance gave', 'за пределами стакана от Binance'],
  fl_price: ['Price', 'Цена'], fl_resting: ['Resting', 'В стакане'], fl_bids: ['BIDS', 'ПОКУПКА'], fl_asks: ['ASKS', 'ПРОДАЖА'], fl_traded5: ['traded 5 min', 'сделки 5 мин'],
  fl_spread: ['spread', 'спред'], fl_imb: ['imbalance ±0.1%', 'перевес ±0,1%'], fl_tape: ['TAPE · big trades highlighted', 'ЛЕНТА · крупные сделки подсвечены'],
  fl_sold: ['Sold at the bid', 'Продано по бидам'], fl_bought: ['Bought at the ask', 'Куплено по аскам'], fl_bar_delta: ['Bar delta', 'Дельта бара'], fl_vol: ['Volume', 'Объём'],
  fl_note_HEAT: ['Brightness — size resting in each price row (row height in the top-left corner), twice a second. Most of the book stays dark; only levels bigger than usual on screen light up, white are the biggest walls — the scale under the right panel gives sizes in coins, ◐ changes the contrast. Grey — beyond the 5,000 levels Binance gives. Lines: best bid (green) and ask (red). Circles — trades summed by moment and price (green bought at the ask, red sold at the bid; outlined — big). Right — the book now, with the three biggest walls on each side signed. Hover for the exact price range, size in coins and dollars and distance from the mid.',
    'Яркость — объём заявок в каждой ценовой строке (её шаг — в левом верхнем углу), дважды в секунду. Основная часть стакана тёмная: светятся только уровни крупнее обычного на экране, белое — самые крупные стенки; шкала под правой панелью показывает объём в монетах, ◐ меняет контраст. Серое — за пределами 5000 уровней, что даёт Binance. Линии: лучший бид (зелёная) и аск (красная). Круги — сделки, сложенные по моменту и цене (зелёные — покупки по аску, красные — продажи по биду; с обводкой — крупные). Справа — стакан сейчас, три крупнейшие стенки с каждой стороны подписаны. Наведите курсор — точный диапазон цены, объём в монетах и долларах и расстояние от середины.'],
  fl_note_BOOK: ['The ladder groups prices by 5 steps; yellow bars — volume traded at the price in the last 5 minutes. Imbalance — bids vs asks within 0.1% of the price. Big trade = top 0.5% by size and ≥ $50K.',
    'Стакан сгруппирован по 5 шагов цены; жёлтые полосы — объём сделок на цене за 5 минут. Перевес — биды против асков в пределах 0,1% от цены. Крупная сделка — верхние 0,5% по объёму и от $50 тыс.'],
  fl_note_FOOT: ['Each cell: sold at the bid (left, red) × bought at the ask (right, green). Yellow frame — the bar\'s point of control; green frame — buying ≥ 3× the selling one level lower (imbalance). Built from live trades plus the last few minutes.',
    'В клетке: продано по бидам (слева, красным) × куплено по аскам (справа, зелёным). Жёлтая рамка — точка контроля бара; зелёная — покупки ≥ 3× продаж уровнем ниже (дисбаланс). Строится из живых сделок и последних минут истории.'],
  fl_note_CVD: ['Delta = bought at the ask − sold at the bid (Binance\'s taker volume of each bar); CVD adds it up. Rings on the price — big trades since the panel opened. Price up while CVD falls = rally on passive buying (divergence).',
    'Дельта = куплено по аскам − продано по бидам (объём тейкеров Binance в каждом баре); CVD — её накопленная сумма. Кольца на цене — крупные сделки с открытия панели. Цена растёт, а CVD падает — рост на пассивных покупках (дивергенция).']
};

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
  ['AAPL ANR', 'analyst ratings, price targets, rating changes', 'рейтинги аналитиков, целевые цены, изменения рейтингов'],
  ['AAPL CN', 'company news', 'новости компании на русском'],
  ['AAPL EE', 'estimates: EPS and revenue by quarter and year, revisions, surprises', 'прогнозы: прибыль на акцию и выручка по кварталам и годам, пересмотры, сюрпризы'],
  ['AAPL HDS', 'holders: institutions, funds, insiders, short interest (SI)', 'акционеры: институционалы, фонды, инсайдеры, короткие позиции (SI)'],
  ['AAPL DVD', 'dividends and splits: history, yield, dates', 'дивиденды и сплиты: история, доходность, даты'],
  ['AAPL OMON', 'options: chain, implied volatility, expected move, max pain', 'опционы: цепочка, подразумеваемая волатильность, ожидаемое движение, max pain'],
  ['AAPL RV', 'the company against its peers on the same ratios', 'компания против конкурентов по тем же мультипликаторам'],
  ['AAPL CF', 'SEC filings: 10-K, 10-Q, 8-K', 'отчёты в SEC: 10-K, 10-Q, 8-K'],
  ['AAPL MGMT', 'management and their pay', 'руководство и его вознаграждение'],
  ['HP AAPL 5Y', 'price history, SMA 50/200 and RSI, CSV export (1D 5D 1M 3M 6M YTD 1Y 2Y 5Y)', 'история цен, SMA 50/200 и RSI, выгрузка в CSV (1D 5D 1M 3M 6M YTD 1Y 2Y 5Y)'],
  ['COMP AAPL MSFT SPY', 'several instruments on one chart', 'сравнение нескольких инструментов на одном графике'],
  ['WHOLE MARKET', 'РЫНОК ЦЕЛИКОМ'],
  ['EQS, EQS RU', 'screener: ~100 largest US stocks or all Moscow Exchange shares', 'скринер: ~100 крупнейших акций США или все акции Мосбиржи'],
  ['IMAP, IMAP RU', 'heat map by sector: US stocks or the Moscow Exchange (HEAT)', 'тепловая карта по секторам: акции США или Мосбиржа (ТЕПЛОКАРТА)'],
  ['ECST, ECST RU', 'IMF forecasts: GDP, inflation, unemployment, debt by country', 'прогнозы МВФ: ВВП, инфляция, безработица, долг по странам'],
  ['FXC', 'cross rates of the main currencies', 'кросс-курсы основных валют'],
  ['CORR', 'correlations of markets (CORR AAPL BTC GOLD — your own set)', 'корреляции рынков (CORR AAPL BTC ЗОЛОТО — свой набор)'],
  ['OMON', 'options overview: implied volatility and put/call ratios', 'обзор опционов: подразумеваемая волатильность и пут/колл'],
  ['IPO', 'IPO calendar (US)', 'календарь IPO (США)'],
  ['EVTS', 'earnings calendar of the largest companies', 'календарь отчётов крупнейших компаний'],
  ['GC', 'yield curves: US, Germany, UK, Japan, Russia', 'кривые доходности: США, Германия, Британия, Япония, Россия'],
  ['CB', 'central bank rates', 'ставки центробанков'],
  ['WIRP', 'Fed rate expectations for the next meetings', 'ожидания по ставке ФРС на ближайших заседаниях'],
  ['WB', 'world bond markets: 2/5/10/30-year yields, spreads to UST and Bund', 'облигации мира: доходности 2/5/10/30 лет, спреды к UST и Bund'],
  ['BTMM US, BTMM RU', "a country's rates at a glance: policy rate, curve, overnight rate, its calendar (USSW — the US)", 'ставки страны на одном экране: ключевая, кривая, овернайт, её календарь (USSW — США)'],
  ['MMR', 'money-market rates: SOFR, EFFR, €STR, SONIA, RUONIA', 'ставки денежного рынка: SOFR, EFFR, €STR, SONIA, RUONIA'],
  ['SRCH', 'US Treasury securities: auctions, yields, bid-to-cover (CRVF — all curves, FIT — WB)', 'казначейские бумаги США: аукционы, доходности, спрос (CRVF — все кривые, FIT — WB)'],
  ['MARKET MONITORS', 'МОНИТОРЫ РЫНКА'],
  ['MOV, MOV RU', 'what moves the index: leaders and laggards in index points', 'кто двигает индекс: лидеры и аутсайдеры в пунктах индекса'],
  ['MOST', 'most active, gainers, losers, 52-week highs and lows', 'самые активные, растущие, падающие, на максимумах и минимумах 52 недель'],
  ['MRR, MEMB', 'members ranked by return · members and weights', 'участники по доходности · состав и веса'],
  ['WPE', 'world valuations: P/E, P/B, yield by country', 'оценка рынков мира: P/E, P/B, доходность по странам'],
  ['BI', 'sector dashboards: returns, valuations, margins, growth', 'панель секторов: доходность, оценка, маржа, рост'],
  ['FPC', 'ETF returns ranked (stocks, sectors, bonds, commodities)', 'ETF по доходности (акции, секторы, облигации, сырьё)'],
  ['CDR', 'exchanges: open now, sessions in Moscow time, holidays', 'биржи: открыты ли сейчас, сессии по Москве, праздники'],
  ['TECHNICAL ANALYSIS', 'ТЕХНИЧЕСКИЙ АНАЛИЗ'],
  ['TECH AAPL, G', 'chart: candles/bars/line, SMA, EMA, Bollinger, VWAP, volume, RSI, MACD, stochastic', 'график: свечи/бары/линия, SMA, EMA, Боллинджер, VWAP, объём, RSI, MACD, стохастик'],
  ['AAPL TA', 'trend lines, support/resistance, Fibonacci, candle patterns, double tops/bottoms', 'трендовые линии, поддержка/сопротивление, Фибоначчи, свечные фигуры, двойные вершины/дно'],
  ['IND BTC MACD, GPO, GPC, GIP', 'indicators · bars · candles · today intraday', 'индикаторы · бары · свечи · внутри дня'],
  ['VAP, TSM, QR', 'volume at price · the day by hour with VWAP (AQR) · time & sales', 'объём по ценам · день по часам с VWAP (AQR) · лента сделок'],
  ['TRA KO 5Y, TRAY', 'total return with dividends · returns over 12 periods', 'полная доходность с дивидендами · доходность за 12 периодов'],
  ['AAPL GE, CACS, CRPR', 'P/E over 5 years · corporate action calendar · credit rating news', 'P/E за 5 лет · календарь корпоративных событий · новости о кредитных рейтингах'],
  ['OPTIONS', 'ОПЦИОНЫ'],
  ['GEX SPX, GEX BTC', 'gamma exposure by strike: calls, puts, net, nearest expiry, vanna, charm, open interest', 'гамма-экспозиция по страйкам: коллы, путы, нетто, ближайшая экспирация, ванна, чарм, открытый интерес'],
  ['LVL QQQ', 'gamma flip, call and put walls, max pain, expected move (±1σ day/week, straddle, VIX/DVOL)', 'смена гаммы, стены коллов и путов, макс. боль, ожидаемый ход (±1σ день/неделя, стрэддл, VIX/DVOL)'],
  ['VOLS SPY', 'implied volatility surface in 3D, smile, term structure', 'поверхность ожидаемой волатильности в 3D, улыбка, временная структура'],
  ['GRK NVDA', 'greeks by strike and expiry: delta, gamma, theta, vega (table or 3D)', 'греки по страйкам и экспирациям: дельта, гамма, тета, вега (таблица или 3D)'],
  ['GEXH SPX', 'interval map of GEX through the day and its history by day', 'интервальная карта GEX за день и её история по дням'],
  ['ORDER FLOW (CRYPTO)', 'ПОТОК ОРДЕРОВ (КРИПТА)'],
  ['HEAT BTC, OBH ETH', 'order book heatmap with trades as bubbles (HEAT alone — the market map)', 'теплокарта стакана со сделками-кругами (HEAT без монеты — карта рынка)'],
  ['BOOK BTC', 'order book ladder and the tape, big trades highlighted', 'стакан и лента сделок, крупные подсвечены'],
  ['FOOT BTC', 'footprint candles: bid × ask volume at each price, delta, imbalances', 'кластерный график: объём по бидам × аскам на каждой цене, дельта, дисбалансы'],
  ['CVD BTC', 'cumulative volume delta under the price, big trades', 'кумулятивная дельта объёма под ценой, крупные сделки'],
  ['MAPS', 'КАРТЫ'],
  ['MAP', 'world map with layers: earthquakes, fires, storms, markets, chokepoints, vessels, ports, power plants, heavy industry, refineries, oil terminals, LNG, gas fields and storage', 'карта мира со слоями: землетрясения, пожары, штормы, рынки, проливы, суда, порты, электростанции, тяжёлая промышленность, НПЗ, нефтяные терминалы, СПГ, газовые месторождения и ПХГ'],
  ['STORM (BMAP STORM)', 'tropical cyclones with tracks and the energy assets in their way', 'тропические циклоны с траекториями и энергообъекты на их пути'],
  ['SHIP (BMAP V)', 'shipping through the chokepoints: ships and tankers a day, change; live vessels of the Baltic', 'судоходство через проливы: судов и танкеров в день, изменение; суда Балтики онлайн'],
  ['WETR', 'weather in the big cities: now, the week, heating/cooling degree days', 'погода в крупных городах: сейчас, неделя, градусо-дни отопления/охлаждения'],
  ['SPLC', 'oil supply chain: producers → chokepoints → buyers, flows by quarter (EIA) and tankers a day now', 'цепочка поставок нефти: производители → проливы → покупатели, потоки по кварталам (EIA) и танкеры в день сейчас'],
  ['SAT', 'satellite pictures of the main oil storage hubs (Sentinel-2): then and now, side by side', 'спутниковые снимки главных нефтехранилищ (Sentinel-2): было и стало рядом'],
  ['TANKERS', 'tankers at the oil chokepoints, live (needs the bot\'s free aisstream.io key)', 'танкеры в нефтяных проливах онлайн (нужен бесплатный ключ aisstream.io у бота)'],
  ['MAP ECO GDP', 'countries coloured by GDP, inflation, unemployment, debt, policy rate, 10Y, stocks today', 'страны по ВВП, инфляции, безработице, долгу, ставке ЦБ, доходности 10 лет, акциям сегодня'],
  ['NEWS TOPICS', 'ТЕМЫ НОВОСТЕЙ'],
  ['NSE MNA, MA', 'deals: mergers and acquisitions (OPN, USS, CNS, US COS, BBEA — other topics, alone or after NSE)', 'сделки: слияния и поглощения (OPN, USS, CNS, US COS, BBEA — другие темы, сами по себе или после NSE)'],
  ['TOPCA, RATC', 'top news on Canada · credit rating actions', 'главное по Канаде · кредитные рейтинги'],
  ['PERSONAL', 'ЛИЧНОЕ'],
  ['W AAPL BTC', 'watchlist (W — open, W AAPL — add)', 'список наблюдения (W — открыть, W AAPL — добавить)'],
  ['PORT', 'portfolio: positions, profit and loss', 'портфель: позиции, прибыль и убыток'],
  ['PAPR AAPL', 'practice account: buy and sell with $100,000 of virtual money at live prices', 'демосчёт: покупки и продажи на $100 000 виртуальных денег по живым ценам'],
  ['ALRT AAPL > 200', 'Telegram alert: price, daily move (OIL 5%), a word in the news (ALRT NEWS FED)', 'алерт в Telegram: цена, изменение за день (НЕФТЬ 5%), слово в новостях (ALRT НОВОСТИ ФРС)'],
  ['SCREEN', 'ЭКРАН'],
  ['LAYOUT 4, LAYOUT 6', '4 or 6 panels on screen (LAYOUT 1 — the usual layout)', '4 или 6 панелей на экране (LAYOUT 1 — обычная раскладка)'],
  ['▾ in a panel title', 'put any function into this panel', 'поставить в эту панель любую функцию'],
  ['✕, ⟲', 'close the panel (✕ in its title); ✕ at the top closes all, ⟲ brings the default layout back', 'закрыть окно (✕ в его заголовке); ✕ сверху закрывает все, ⟲ возвращает стандартную раскладку'],
  ['⇔, ✥', 'drag the border between panels to resize them; drag a title onto another panel to swap them', 'тяните границу между окнами, чтобы изменить размер; перетащите заголовок на другое окно, чтобы поменять их местами'],
  ['⧉, ▣', 'float a window over the others (⧉ in its title): drag its title to move it, its corner to size it; ▣ or a double-click on the title puts it back', 'открепить окно поверх других (⧉ в заголовке): тяните за заголовок — двигать, за угол — менять размер; ▣ или двойной клик по заголовку — вернуть в сетку'],
  ['LANG RU, LANG EN', 'interface language (LANG ZH — 中文, LANG AR — العربية)', 'язык интерфейса (LANG ZH — 中文, LANG AR — العربية)'],
  ['SET', 'settings and owner sign-in', 'настройки и вход владельца'],
  ['HELP', 'this help', 'эта справка']
];

var MKT_EN = {'S&P': 'S&P 500', 'Nasdaq': 'Nasdaq', 'DJI': 'Dow Jones', 'RTY': 'Russell 2000', 'VIX': 'VIX', 'SX5E': 'Euro Stoxx 50', 'DAX': 'DAX',
  'UKX': 'FTSE 100', 'CAC': 'CAC 40', 'NKY': 'Nikkei 225', 'HSI': 'Hang Seng', 'SHCOMP': 'Shanghai Composite', 'SENSEX': 'Sensex (India)',
  'IMOEX': 'MOEX Russia', 'DXY': 'US Dollar Index', 'EUR/USD': 'EUR/USD', 'USDJPY': 'USD/JPY', 'GBPUSD': 'GBP/USD', 'USDCNY': 'USD/CNY',
  'USDCHF': 'USD/CHF', 'USD/RUB': 'USD/RUB (CBR)', 'CNY/RUB': 'CNY/RUB (CBR)', 'Brent': 'Brent crude', 'WTI': 'WTI crude', 'Газ': 'Natural gas',
  'Золото': 'Gold', 'Серебро': 'Silver', 'Платина': 'Platinum', 'Медь': 'Copper', 'Пшеница': 'Wheat',
  'UST3M': 'UST 3M', 'UST5': 'UST 5Y', 'UST10': 'UST 10Y', 'UST30': 'UST 30Y', 'BTC': 'Bitcoin'};
var CTRY_RU = {US: 'США', EA: 'Еврозона', DE: 'Германия', UK: 'Британия', JP: 'Япония', RU: 'Россия', CA: 'Канада', AU: 'Австралия', CH: 'Швейцария'};
var SPREAD_RU = {'2s10s': 'Спред 2–10 лет', '3m10y': 'Спред 3 мес – 10 лет', '5s30s': 'Спред 5–30 лет'};
var MKT_RU = {'IMOEX': 'Индекс Мосбиржи', 'DXY': 'Индекс доллара DXY', 'SHCOMP': 'Шанхайский композитный', 'SENSEX': 'Sensex (Индия)',
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
var SECTOR_RU = {'Other': 'Прочее', 'Technology': 'Технологии', 'Communication': 'Связь и медиа', 'Consumer Discretionary': 'Циклич. потребление',
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
function mapName(ru, en, map){ return function(x){ if (RU) return ru[x] || x; var k = en[x] || x; return xl(map, k) || k } }

function t(key){
  var x = XL(), v = x && x.D[key];
  if (v !== undefined && v !== null) return typeof v === 'function' ? v.apply(null, [].slice.call(arguments, 1)) : v[XI];
  v = D[key];
  if (v == null) return key;
  if (typeof v === 'function') return v.apply(null, [].slice.call(arguments, 1));
  return v[RU ? 1 : 0];
}

function isOld(n){ return n && n.original !== undefined && n.lang === undefined }
var TR_TL = {en: 'en', ru: 'ru', zh: 'zh-CN', ar: 'ar'}[lang], TR_KEY = 'tr_news_' + lang, trMem = {}, trBusy = {}, trBad = {}, trOff = 0;
try { trMem = JSON.parse(localStorage.getItem(TR_KEY) || '{}') || {} } catch(e){ trMem = {} }
function trKeep(){
  try {
    var k = Object.keys(trMem);
    if (k.length > 900) k.slice(0, k.length - 700).forEach(function(x){ delete trMem[x] });
    localStorage.setItem(TR_KEY, JSON.stringify(trMem));
  } catch(e){}
}
function foreign(n){ return n && !isOld(n) && (n.lang || 'en') !== lang }
function gtx(lines){
  return fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + TR_TL + '&dt=t&q=' + encodeURIComponent(lines.join('\n')))
    .then(function(r){ if (!r.ok) { var e = new Error('HTTP ' + r.status); e.net = 1; throw e } return r.json() }, function(e){ e.net = 1; throw e })
    .then(function(j){
      var out = [], buf = '';
      ((j && j[0]) || []).forEach(function(s){ if (!s) return; buf += s[0] || ''; if (/\n\s*$/.test(s[1] || '')) { out.push(buf.trim()); buf = '' } });
      if (buf.trim()) out.push(buf.trim());
      if (out.length !== lines.length) throw new Error('split');
      return out;
    });
}
function trChunk(src, done){
  var flat = src.map(function(s){ return String(s).replace(/\s+/g, ' ').trim() });
  src.forEach(function(s){ trBusy[s] = 1 });
  var put = function(out){
    var got = 0;
    src.forEach(function(s, i){ delete trBusy[s]; var t = out[i]; if (t && t.toLowerCase() !== flat[i].toLowerCase()) { trMem[s] = t; got++ } else trBad[s] = Date.now() + 600000 });
    if (got) { trKeep(); done() }
  };
  var fail = function(e){ var until = Date.now() + 120000; src.forEach(function(s){ delete trBusy[s]; trBad[s] = until }); if (!e || e.net) trOff = Date.now() + 90000 };
  gtx(flat).then(put, function(e){
    if (e && e.net) return fail(e);
    Promise.all(flat.map(function(l){ return gtx([l]).then(function(o){ return o[0] }, function(){ return '' }) })).then(put, fail);
  });
}
function fillNews(items, done){
  if (!TR_TL || !window.fetch) return;
  var now = Date.now(); if (trOff > now) return;
  var want = [];
  (items || []).forEach(function(n){
    if (!foreign(n)) return;
    if (!n['title_' + lang] && n.title) want.push(n.title);
    if (!n['lead_' + lang] && n.lead && !aiSum(n)) want.push(n.lead);
  });
  want = want.filter(function(s, i){ return want.indexOf(s) === i && !trMem[s] && !trBusy[s] && !(trBad[s] > now) });
  var chunk = [], size = 0;
  want.slice(0, 160).forEach(function(s){
    if (chunk.length && (size + s.length > 1400 || chunk.length >= 24)) { trChunk(chunk, done); chunk = []; size = 0 }
    chunk.push(s); size += s.length + 1;
  });
  if (chunk.length) trChunk(chunk, done);
}
function newsTitle(n){
  if (isOld(n)) return RU || !n.original ? n.title : n.original;
  return n['title_' + lang] || (foreign(n) && trMem[n.title]) || n.title || '';
}
function newsLead(n){
  if (isOld(n)) return RU ? n.lead || '' : '';
  return n['lead_' + lang] || (foreign(n) && n.lead && trMem[n.lead]) || n.lead || '';
}
function aiSum(n){
  var ai = n && n.ai; if (!ai) return '';
  if (ai.sum_ru === undefined) return RU ? ai.sum || '' : '';
  if (XI >= 0) return ai['sum_' + lang] || '';
  return RU ? ai.sum_ru || ai.sum || '' : ai.sum || ai.sum_ru || '';
}
function tradeLabel(s){
  s = String(s || '');
  var x = XL();
  TRADE_RU.forEach(function(p, i){
    s = s.split(p[1]).join(p[0]);
    if (RU) s = s.split(p[0]).join(p[1]);
    else if (x) s = s.split(p[0]).join(x.TRADE[i][XI]);
  });
  return s;
}
function dn(o, en, ru){
  if (!o) return '';
  en = en || 'name'; ru = ru || en + '_ru';
  return (lang === 'en' ? null : o[en + '_' + lang] || (RU ? o[ru] : null)) || o[en] || '';
}
function setLang(l){
  l = LANGS.indexOf(l) >= 0 ? l : 'en';
  try { localStorage.setItem(KEY, l) } catch(e){}
  try { var u = new URL(location.href); u.searchParams.set('lang', l); location.replace(u.toString()) } catch(e){ location.reload() }
}

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
  var h = document.getElementById('help-t'), x = XL();
  if (h && !h.firstChild) HELP.forEach(function(r){
    var tr = document.createElement('tr'), a = document.createElement('td'), z = x && x.HELP[r[0]];
    a.textContent = (x && x.HELP_CMD[r[0]] ? x.HELP_CMD[r[0]][XI] : r[0]);
    if (r.length === 2) { a.colSpan = 2; a.style.color = 'var(--amber)'; a.style.paddingTop = '8px'; a.textContent = z ? z[XI] : RU ? r[1] : r[0]; tr.appendChild(a) }
    else { var b = document.createElement('td'); b.textContent = z ? z[XI] : RU ? r[2] : r[1]; tr.appendChild(a); tr.appendChild(b) }
    h.appendChild(tr);
  });
}

var LANG_LIST = [['en', 'English', 'EN'], ['ru', 'Русский', 'RU'], ['zh', '中文', '中'], ['ar', 'العربية', 'ع']];
var LOC = {en: ['en-US', 'en-GB', 'en', 'MSK'], ru: ['ru-RU', 'ru-RU', 'ru', 'МСК'],
  zh: ['en-US', 'zh-CN-u-hc-h23', 'zh_CN', '莫斯科时间'], ar: ['en-US', 'ar-u-nu-latn-hc-h23', 'ar_AE', 'بتوقيت موسكو']}[lang];

var REGION_CODE = {UK: 'GB', XM: 'EZ'}, regionNames = null;
function country(code, fallback){
  if (XI < 0 || !code) return fallback || code || '';
  var x = XL(), c = String(code).toUpperCase(), g = x && x.GROUP[c];
  if (g) return g[XI];
  c = REGION_CODE[c] || c;
  if (c.length === 3 && x && x.ISO3[c]) c = x.ISO3[c];
  if (!/^[A-Z]{2}$/.test(c)) return fallback || code;
  try {
    regionNames = regionNames || new Intl.DisplayNames([lang], {type: 'region'});
    var n = regionNames.of(c);
    if (n && n !== c) return n;
  } catch(e){}
  return fallback || code;
}

var UNITS = {en: [[1e12, 'T', 4], [1e9, 'B', 3], [1e6, 'M', 2], [1e3, 'K', 1]],
  ru: [[1e12, ' трлн', 4], [1e9, ' млрд', 3], [1e6, ' млн', 2], [1e3, ' тыс.', 1]],
  zh: [[1e12, '万亿', 4], [1e8, '亿', 3], [1e4, '万', 2]],
  ar: [[1e12, ' تريليون', 4], [1e9, ' مليار', 3], [1e6, ' مليون', 2], [1e3, ' ألف', 1]]}[lang];
function scale(v, min, max){
  var a = Math.abs(v || 0);
  for (var i = 0; i < UNITS.length; i++) {
    var u = UNITS[i];
    if (u[2] > (max || 4) || u[2] < (min || 1)) continue;
    if (a >= u[0]) return {x: v / u[0], s: u[1], size: u[0], rank: u[2]};
  }
  return null;
}
var MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var MON_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
function iso_(s){ return lang === 'ar' ? '\u2068' + s + '\u2069' : s }
function dm(d){
  if (!d || d.length < 10) return '—';
  var day = +d.slice(8, 10), m = +d.slice(5, 7);
  if (RU) return d.slice(8, 10) + '.' + d.slice(5, 7);
  if (lang === 'zh') return m + '月' + day + '日';
  return iso_(day + ' ' + (lang === 'ar' ? MON_AR : MON_EN)[m - 1]);
}
function dmy(d){
  if (!d || d.length < 10) return '—';
  if (lang === 'zh') return d.slice(0, 4) + '年' + dm(d);
  if (lang === 'ar') return iso_(+d.slice(8, 10) + ' ' + MON_AR[+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4));
  return dm(d) + (RU ? '.' : ' ') + d.slice(0, 4);
}
function my(d){
  if (!d || d.length < 10) return '—';
  if (RU) return d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(2, 4);
  if (lang === 'zh') return d.slice(2, 4) + '年' + (+d.slice(5, 7)) + '月';
  return iso_((lang === 'ar' ? MON_AR : MON_EN)[+d.slice(5, 7) - 1] + (lang === 'ar' ? ' ' : " '") + d.slice(2, 4));
}

window.L10N = {
  lang: lang, ru: RU, xl: XI >= 0, scale: scale, dm: dm, dmy: dmy, my: my, rtl: lang === 'ar', langs: LANG_LIST, t: t, apply: apply, setLang: setLang,
  num: LOC[0],
  date: LOC[1],
  tv: LOC[2],
  tz: LOC[3],
  q: lang === 'en' ? '' : 'lang=' + lang,
  mktName: function(id, fallback){ return (RU ? MKT_RU[id] : xl('MKT', id) || MKT_EN[id]) || (RU ? fallback : MKT_EN[id]) || fallback || id },
  unit: function(id){ return XI >= 0 ? xl('UNIT', id) || UNIT[0][id] || '' : UNIT[RU ? 1 : 0][id] || '' },
  region: function(id){ return XI >= 0 ? xl('REGION', id) || REGION[0][id] || '' : REGION[RU ? 1 : 0][id] || '' },
  clock: function(i){ var x = XL(); return x ? x.CLOCKS[i][XI] : CLOCKS[i][RU ? 1 : 0] },
  sector: mapName(SECTOR_RU, SECTOR_EN, 'SECTOR'), tag: mapName(TAG_RU, TAG_EN, 'TAG'), source: mapName(SOURCE_RU, SOURCE_EN, 'SOURCE'),
  tagKey: function(x){ return TAG_EN[x] || x },
  fng: function(x){ return RU ? FNG_RU[x] || x : xl('FNG', x) || x },
  dn: dn, country: country,
  nstr: function(x){ return RU && x ? String(x).replace(/(\d)\.(\d)/g, '$1,$2') : x },
  ind: function(k, x){ return RU ? x.ru : xl('MACRO_IND', k) || x.en },
  mktXl: function(id){ return xl('MKT', id) },
  xlName: function(map, id){ return xl(map, id) },
  newsTitle: newsTitle, newsLead: newsLead, aiSum: aiSum, tradeLabel: tradeLabel, fillNews: fillNews
};
})();
