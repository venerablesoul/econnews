/* Maps — the terminal's version of Bloomberg MAP / BMAP: one dark world map with layers of data.
   MAP   — your own map: tick any layers (earthquakes, fires, storms, disasters, stock markets, chokepoints, ports,
           power plants, refineries, LNG terminals, weather)
   STORM — BMAP STORM: tropical cyclones with their tracks and the energy assets in their way
   SHIP  — BMAP V / SHIP: shipping through the world's chokepoints (ships a day, tankers, change) and ports
   WETR  — weather in the big cities: now, the week ahead, heating and cooling degree days (energy demand)
   ECO   — countries coloured by an indicator: GDP growth, inflation, unemployment, debt, policy rate, stocks today
   Static layers: docs/geo/*.json (tools/build_geo.py). Live layers come straight from the sources (USGS, NASA EONET,
   GDACS, IMF PortWatch, Open-Meteo); a source that does not allow browsers is fetched through the bot server (/api/geo). */
(function(){
'use strict';
var T = window.TERM, F = window.FN;
if (!T || !F) return;
var $ = T.$, el = T.el, TX = T.TX, I = T.I, fmt = T.fmt, pct = T.pct, cls = T.cls, store = T.store, clear = F.clear;

/* ======================= projection: Web Mercator in world units 0..1 ======================= */
var D2R = Math.PI / 180, LAT_MAX = 84;
function mx(lon){ return (lon + 180) / 360 }
function my(lat){ lat = Math.max(-LAT_MAX, Math.min(LAT_MAX, lat)); var s = Math.sin(lat * D2R); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) }
function ilon(x){ return x * 360 - 180 }
function ilat(y){ return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / D2R }
function km(a, b){   // great-circle distance between [lon, lat] points
  var p1 = a[1] * D2R, p2 = b[1] * D2R, dp = p2 - p1, dl = (b[0] - a[0]) * D2R;
  var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ======================= data access ======================= */
function getJSON(url, ms){
  var ac = window.AbortController ? new AbortController() : null, t = ac ? setTimeout(function(){ ac.abort() }, ms || 15000) : null;
  return fetch(url, ac ? {signal: ac.signal} : undefined).then(function(r){ clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() },
    function(e){ clearTimeout(t); throw e && e.name === 'AbortError' ? new Error(TX('srv_slow')) : e });
}
// sources without browser access (CORS) go through the bot server; the others straight, the server only if that fails
function viaServer(url){
  var b = T.api();
  if (!b) return Promise.reject(new Error(TX('srv_not_set_e')));
  // T.wjson: the server's lanes with short tries (throttled networks, see index.html)
  return T.wjson('/api/geo?u=' + encodeURIComponent(url), {timeout: 20000, hedge: 6000}).then(function(d){ if (d && d.ok === false && d.error) throw new Error(d.error); return d });
}
function live(url, direct){
  if (direct) return getJSON(url).catch(function(e){ return T.api() ? viaServer(url) : Promise.reject(e) });
  return viaServer(url).catch(function(e){ return getJSON(url).catch(function(){ throw e }) });
}
var geoCache = {};
function geo(name){ return geoCache[name] || (geoCache[name] = getJSON('../geo/' + name, 30000).catch(function(e){ delete geoCache[name]; throw e })) }

/* ======================= reference data ======================= */
// the stock market of each city (ids of the terminal's quotes)
var EXCH = [
  {id: 'S&P', more: ['Nasdaq', 'DJI', 'RTY'], lon: -74.011, lat: 40.707, city: ['New York', 'Нью-Йорк']},
  {id: 'UKX', lon: -0.091, lat: 51.515, city: ['London', 'Лондон']},
  {id: 'DAX', more: ['SX5E'], lon: 8.676, lat: 50.110, city: ['Frankfurt', 'Франкфурт']},
  {id: 'CAC', lon: 2.341, lat: 48.869, city: ['Paris', 'Париж']},
  {id: 'IMOEX', lon: 37.611, lat: 55.758, city: ['Moscow', 'Москва']},
  {id: 'NKY', lon: 139.776, lat: 35.683, city: ['Tokyo', 'Токио']},
  {id: 'HSI', lon: 114.159, lat: 22.283, city: ['Hong Kong', 'Гонконг']},
  {id: 'SHCOMP', lon: 121.500, lat: 31.237, city: ['Shanghai', 'Шанхай']},
  {id: 'SENSEX', lon: 72.834, lat: 18.930, city: ['Mumbai', 'Мумбаи']}
];
// big cities for the weather map: [English, Russian, lat, lon]
var CITIES = [
  ['New York', 'Нью-Йорк', 40.71, -74.01], ['Chicago', 'Чикаго', 41.88, -87.63], ['Houston', 'Хьюстон', 29.76, -95.37], ['Los Angeles', 'Лос-Анджелес', 34.05, -118.24],
  ['Atlanta', 'Атланта', 33.75, -84.39], ['Dallas', 'Даллас', 32.78, -96.80], ['Boston', 'Бостон', 42.36, -71.06], ['Toronto', 'Торонто', 43.65, -79.38],
  ['Mexico City', 'Мехико', 19.43, -99.13], ['São Paulo', 'Сан-Паулу', -23.55, -46.63], ['Buenos Aires', 'Буэнос-Айрес', -34.60, -58.38],
  ['London', 'Лондон', 51.51, -0.13], ['Paris', 'Париж', 48.86, 2.35], ['Berlin', 'Берлин', 52.52, 13.40], ['Madrid', 'Мадрид', 40.42, -3.70],
  ['Rome', 'Рим', 41.90, 12.50], ['Amsterdam', 'Амстердам', 52.37, 4.90], ['Stockholm', 'Стокгольм', 59.33, 18.07], ['Warsaw', 'Варшава', 52.23, 21.01],
  ['Istanbul', 'Стамбул', 41.01, 28.98], ['Moscow', 'Москва', 55.76, 37.62], ['St Petersburg', 'Санкт-Петербург', 59.94, 30.31],
  ['Yekaterinburg', 'Екатеринбург', 56.84, 60.61], ['Novosibirsk', 'Новосибирск', 55.01, 82.93], ['Almaty', 'Алматы', 43.24, 76.89],
  ['Cairo', 'Каир', 30.04, 31.24], ['Lagos', 'Лагос', 6.52, 3.38], ['Johannesburg', 'Йоханнесбург', -26.20, 28.05], ['Riyadh', 'Эр-Рияд', 24.71, 46.68],
  ['Dubai', 'Дубай', 25.20, 55.27], ['Tehran', 'Тегеран', 35.69, 51.39], ['Karachi', 'Карачи', 24.86, 67.01], ['Delhi', 'Дели', 28.61, 77.21],
  ['Mumbai', 'Мумбаи', 19.08, 72.88], ['Beijing', 'Пекин', 39.90, 116.41], ['Shanghai', 'Шанхай', 31.23, 121.47], ['Guangzhou', 'Гуанчжоу', 23.13, 113.26],
  ['Hong Kong', 'Гонконг', 22.32, 114.17], ['Seoul', 'Сеул', 37.57, 126.98], ['Tokyo', 'Токио', 35.68, 139.69], ['Singapore', 'Сингапур', 1.35, 103.82],
  ['Jakarta', 'Джакарта', -6.21, 106.85], ['Sydney', 'Сидней', -33.87, 151.21]
];
var FUEL_COL = {Coal: '#8b95a7', Gas: '#e0b23c', Oil: '#ef5350', Nuclear: '#f2cc60', Hydro: '#6ea8ff', Wind: '#56c1d6', Solar: '#f5e663',
  Biomass: '#2fbf71', Geothermal: '#ff7ab6', Waste: '#a07850', Storage: '#a78bfa', Other: '#6b7585'};
var ISO2 = {US: 'USA', DE: 'DEU', UK: 'GBR', GB: 'GBR', JP: 'JPN', RU: 'RUS', CN: 'CHN', IN: 'IND', CA: 'CAN', AU: 'AUS', CH: 'CHE', BR: 'BRA',
  KR: 'KOR', MX: 'MEX', TR: 'TUR', ZA: 'ZAF', SE: 'SWE', NO: 'NOR', NZ: 'NZL', ID: 'IDN', SA: 'SAU', PL: 'POL', CZ: 'CZE', HU: 'HUN',
  CL: 'CHL', CO: 'COL', PE: 'PER', TH: 'THA', MY: 'MYS', PH: 'PHL', IL: 'ISR', KZ: 'KAZ', AR: 'ARG', DK: 'DNK', HK: 'HKG', SG: 'SGP'};
var EURO = ['AUT', 'BEL', 'HRV', 'CYP', 'EST', 'FIN', 'FRA', 'DEU', 'GRC', 'IRL', 'ITA', 'LVA', 'LTU', 'LUX', 'MLT', 'NLD', 'PRT', 'SVK', 'SVN', 'ESP', 'BGR'];
var IDX_ISO = {'S&P': 'USA', DAX: 'DEU', UKX: 'GBR', CAC: 'FRA', NKY: 'JPN', HSI: 'HKG', SHCOMP: 'CHN', SENSEX: 'IND', IMOEX: 'RUS'};

/* ======================= colours ======================= */
function mix(a, b, t){
  var pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  var pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  t = Math.max(0, Math.min(1, t));
  return 'rgb(' + pa.map(function(v, i){ return Math.round(v + (pb[i] - v) * t) }).join(',') + ')';
}
function diverging(v, scale){   // red (negative) — grey — green (positive)
  if (v == null || isNaN(v)) return null;
  var t = Math.max(-1, Math.min(1, v / scale));
  return t < 0 ? mix('#2a2f35', '#e0393e', -t) : mix('#2a2f35', '#1fbf68', t);
}
function sequential(v, lo, hi, reverse){   // green (good) → amber → red (bad), or the reverse
  if (v == null || isNaN(v)) return null;
  var t = (v - lo) / ((hi - lo) || 1); if (reverse) t = 1 - t;
  return t < 0.5 ? mix('#1f8f55', '#e0a030', t * 2) : mix('#e0a030', '#d93a3a', (t - 0.5) * 2);
}
function tempCol(t){   // °C: deep blue → white → red
  if (t == null || isNaN(t)) return '#4b5563';
  var stops = [[-30, '#3a4cff'], [-10, '#6ea8ff'], [0, '#bfe3ff'], [10, '#f5f5c8'], [20, '#f2cc60'], [30, '#ff7a1a'], [40, '#d92020']];
  for (var i = 1; i < stops.length; i++) if (t <= stops[i][0]) return mix(stops[i - 1][1], stops[i][1], (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  return stops[stops.length - 1][1];
}
function alertCol(a){ a = String(a || '').toLowerCase(); return a === 'red' ? '#ff3b3b' : a === 'orange' ? '#ff9a1a' : '#2fbf71' }
function magCol(m){ return m >= 7 ? '#ff2a2a' : m >= 6 ? '#ff6a1a' : m >= 5 ? '#e0b23c' : m >= 4 ? '#f2cc60' : '#e8e8a0' }
// Saffir–Simpson from the 1-minute wind in km/h
function stormCat(kmh){
  if (kmh == null) return '';
  return kmh >= 252 ? 'CAT 5' : kmh >= 209 ? 'CAT 4' : kmh >= 178 ? 'CAT 3' : kmh >= 154 ? 'CAT 2' : kmh >= 119 ? 'CAT 1' : kmh >= 63 ? 'TS' : 'TD';
}
function stormCol(kmh){ return kmh >= 178 ? '#ff2a6a' : kmh >= 119 ? '#ff7a1a' : kmh >= 63 ? '#f2cc60' : '#4fd2ff' }
function when(ts){
  var d = new Date(ts); if (isNaN(d)) return '';
  return d.toLocaleString(I.date, {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: T.MSK}) + ' ' + I.tz;
}
function ago(ts){
  var m = Math.round((Date.now() - new Date(ts)) / 6e4);
  if (isNaN(m)) return '';
  if (m < 60) return TX('gm_min_ago', Math.max(1, m));
  if (m < 48 * 60) return TX('gm_h_ago', Math.round(m / 60));
  return TX('gm_d_ago', Math.round(m / 1440));
}
function nm2(a){ return a[I.ru ? 1 : 0] }

/* ======================= layers ======================= */
// a layer returns {pts: [{lon, lat, r, c, t, s: [lines], u, lbl, act, k}], lines: [{pts, c, w, dash}], polys: [{rings, c}], updated}
var LAYERS = {
  quakes: {grp: 'live', color: '#ff5a3c', src: 'USGS', ttl: 300, load: loadQuakes},
  fires: {grp: 'live', color: '#ff8c1a', src: 'NASA EONET', ttl: 900, load: function(){ return loadEonet('wildfires', '#ff8c1a') }},
  volc: {grp: 'live', color: '#ff3cc8', src: 'NASA EONET', ttl: 1800, load: function(){ return loadEonet('volcanoes', '#ff3cc8') }},
  storms: {grp: 'live', color: '#4fd2ff', src: 'GDACS', ttl: 600, load: loadStorms},
  alerts: {grp: 'live', color: '#f2cc60', src: 'GDACS', ttl: 900, load: loadAlerts},
  exch: {grp: 'mkt', color: '#e0b23c', src: '', ttl: 30, load: loadExch},
  choke: {grp: 'mkt', color: '#56c1d6', src: 'IMF PortWatch', ttl: 3600, load: loadChoke},
  ports: {grp: 'infra', color: '#6ea8ff', src: 'IMF PortWatch', load: loadPorts},
  plants: {grp: 'infra', color: '#a78bfa', src: 'WRI GPPD', load: loadPlants},
  refin: {grp: 'infra', color: '#ef5350', src: '', load: function(){ return loadInfra('refineries.json', '#ef5350', 'gm_refin') }},
  lng: {grp: 'infra', color: '#2fbf71', src: '', load: function(){ return loadInfra('lng.json', '#2fbf71', 'gm_lng') }},
  gas: {grp: 'infra', color: '#b7e34b', src: '', load: loadGas},
  oilst: {grp: 'infra', color: '#ffb35c', src: '', load: loadOilStorage},
  fact: {grp: 'infra', color: '#b8c4d6', src: 'Climate TRACE', load: loadFactories},
  ships: {grp: 'mkt', color: '#ffe066', src: 'Digitraffic AIS', ttl: 180, load: loadShips},
  tankers: {grp: 'mkt', color: '#ff9f40', src: 'aisstream.io', ttl: 600, load: loadTankers},
  world: {grp: 'mkt', color: '#5ab0ff', src: 'aisstream.io', ttl: 600, load: loadWorldShips},
  wx: {grp: 'wx', color: '#f2cc60', src: 'Open-Meteo', ttl: 1800, load: loadWeather}
};
var ORDER = ['plants', 'fact', 'ports', 'oilst', 'refin', 'lng', 'gas', 'ships', 'world', 'tankers', 'wx', 'alerts', 'fires', 'volc', 'quakes', 'choke', 'storms', 'exch'];
var GROUPS = [['live', 'gm_g_live'], ['mkt', 'gm_g_mkt'], ['infra', 'gm_g_infra'], ['wx', 'gm_g_wx']];
// which layers each tab shows: "base" always, "opt" can be ticked
var TABS = {
  MAP: {opt: ORDER.slice(), def: ['quakes', 'storms', 'fires', 'exch', 'choke']},
  STORM: {base: ['storms'], opt: ['refin', 'lng', 'gas', 'oilst', 'ports', 'plants', 'fact', 'alerts'], def: ['refin', 'lng', 'ports']},
  SHIP: {base: ['choke'], opt: ['world', 'tankers', 'ships', 'ports', 'oilst', 'refin', 'lng', 'storms'], def: ['ports', 'ships', 'tankers', 'world']},
  SPLC: {base: [], opt: [], def: []},
  SAT: {base: [], opt: [], def: []},
  WETR: {base: ['wx'], opt: ['storms', 'exch'], def: []},
  ECO: {base: [], opt: ['exch'], def: []}
};

var M = {tab: 'MAP', W: 0, H: 0, S: 0, S0: 0, cx: 0.5, cy: my(22), dpr: 1, on: {}, data: {}, status: {}, at: {}, hover: null, pin: null,
  eco: store('map_eco') || 'NGDP_RPCH', wx: store('map_wx') || 'now', fuels: {}, sideOpen: false, built: false};
try { var sv = JSON.parse(store('map_on') || 'null'); if (sv && typeof sv === 'object') M.on = sv } catch(e){}
try { var sf = JSON.parse(store('map_fuels') || 'null'); if (sf && typeof sf === 'object') M.fuels = sf } catch(e){}
// the categories switched off, per layer (the power plants' fuels keep their old storage key)
M.off = {plants: M.fuels, fact: {}, ships: {}, world: {}};
['fact', 'ships', 'world'].forEach(function(id){ try { var o = JSON.parse(store('map_off_' + id) || 'null'); if (o && typeof o === 'object') M.off[id] = o } catch(e){} });
Object.keys(TABS).forEach(function(t){ if (!M.on[t]) { M.on[t] = {}; TABS[t].def.forEach(function(k){ M.on[t][k] = 1 }) } });
// layers added later switch on once for those who saved their choice before
if (store('map_on_v') !== '2') { if (M.on.SHIP.ships == null) M.on.SHIP.ships = 1; store('map_on_v', '2'); store('map_on', JSON.stringify(M.on)) }
if (store('map_on_v2') !== '3') { if (M.on.SHIP.tankers == null) M.on.SHIP.tankers = 1; store('map_on_v2', '3'); store('map_on', JSON.stringify(M.on)) }
if (store('map_on_v3') !== '4') { if (M.on.SHIP.world == null) M.on.SHIP.world = 1; store('map_on_v3', '4'); store('map_on', JSON.stringify(M.on)) }
function saveOn(){ store('map_on', JSON.stringify(M.on)) }
function active(){
  var t = TABS[M.tab], out = (t.base || []).slice();
  (t.opt || []).forEach(function(k){ if (M.on[M.tab][k] && out.indexOf(k) < 0) out.push(k) });
  return ORDER.filter(function(k){ return out.indexOf(k) >= 0 });
}

function ensure(id, force){
  var L = LAYERS[id];
  var fresh = M.data[id] && (!L.ttl || Date.now() - M.at[id] < L.ttl * 1000);
  if (!force && (fresh || M.status[id] === 'loading')) return;
  M.status[id] = 'loading'; renderSide();
  Promise.resolve().then(L.load).then(function(d){
    M.data[id] = prep(d); M.at[id] = Date.now(); M.status[id] = 'ok'; M.err && delete M.err[id];
    renderSide(); redraw();
  }).catch(function(e){
    M.status[id] = 'err'; (M.err = M.err || {})[id] = e && e.message || String(e);
    renderSide(); redraw();
  });
}
function prep(d){
  (d.pts || []).forEach(function(p){
    p.fx = mx(p.lon); p.fy = my(p.lat);
    if (p.k !== 'ship') return;
    // a ship's track ([lon, lat], oldest first) and where it will be in 30 minutes at its speed and course
    if (p.trk && p.trk.length) p.tf = p.trk.map(function(q){ return [mx(q[0]), my(q[1])] });
    if (p.hd != null && p.sog > 0.5) {
      var dist = p.sog * 1852 * 0.5, a = p.hd * D2R, la = p.lat + dist * Math.cos(a) / 111320, lo = p.lon + dist * Math.sin(a) / (111320 * Math.max(0.05, Math.cos(p.lat * D2R)));
      p.pf = [mx(lo), my(la)];
    }
  });
  (d.lines || []).forEach(function(l){ l.f = l.pts.map(function(q){ return [mx(q[0]), my(q[1])] }) });
  (d.polys || []).forEach(function(pg){ pg.f = pg.rings.map(function(r){ return r.map(function(q){ return [mx(q[0]), my(q[1])] }) }) });
  return d;
}

/* ---------- earthquakes: USGS, magnitude 2.5+ over the past week ---------- */
function loadQuakes(){
  return live('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson', true).then(function(g){
    var pts = (g.features || []).map(function(f){
      var p = f.properties || {}, c = f.geometry && f.geometry.coordinates || [];
      if (c[0] == null || p.mag == null) return null;
      var s = [when(p.time) + ' · ' + ago(p.time), TX('gm_depth', fmt(c[2], 0))];
      if (p.tsunami) s.push(TX('gm_tsunami'));
      if (p.alert) s.push(TX('gm_pager', String(p.alert).toUpperCase()));
      return {lon: c[0], lat: c[1], r: 1.5 + Math.max(0, p.mag - 2.5) * 2.1, c: magCol(p.mag), t: 'M' + fmt(p.mag, 1) + ' · ' + (p.place || ''),
        s: s, u: p.url, v: p.mag, ts: p.time, lbl: p.mag >= 6 ? 'M' + fmt(p.mag, 1) : null, k: 'quake'};
    }).filter(Boolean);
    pts.sort(function(a, b){ return a.v - b.v });
    return {pts: pts, updated: g.metadata && g.metadata.generated};
  });
}

/* ---------- NASA EONET: wildfires, volcanoes (the latest position of each open event) ---------- */
var eonetP = null, eonetAt = 0;
function eonet(){
  if (!eonetP || Date.now() - eonetAt > 600000) { eonetAt = Date.now(); eonetP = live('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=45', true).catch(function(e){ eonetP = null; throw e }) }
  return eonetP;
}
function loadEonet(cat, col){
  return eonet().then(function(d){
    var pts = [];
    (d.events || []).forEach(function(ev){
      if (!(ev.categories || []).some(function(c){ return c.id === cat })) return;
      var gs = (ev.geometry || []).filter(function(g){ return g && g.coordinates }), g = gs[gs.length - 1];
      if (!g) return;
      var c = g.type === 'Point' ? g.coordinates : centroid(g.coordinates[0] || []);
      if (!c || c[0] == null) return;
      var s = [when(g.date) + ' · ' + ago(g.date)];
      if (g.magnitudeValue != null) s.push(fmt(g.magnitudeValue, 0) + ' ' + (g.magnitudeUnit || ''));
      (ev.sources || []).slice(0, 2).forEach(function(x){ s.push(TX('gm_source') + x.id) });
      var big = g.magnitudeValue != null && g.magnitudeUnit === 'acres' ? Math.min(6, Math.log10(Math.max(10, g.magnitudeValue)) - 1) : 1;
      pts.push({lon: c[0], lat: c[1], r: 2.2 + big * 0.8, c: col, t: ev.title, s: s, u: (ev.sources && ev.sources[0] && ev.sources[0].url) || ev.link, k: cat});
    });
    return {pts: pts};
  });
}
function centroid(ring){
  if (!ring.length) return null;
  var x = 0, y = 0; ring.forEach(function(p){ x += p[0]; y += p[1] }); return [x / ring.length, y / ring.length];
}

/* ---------- GDACS: tropical cyclones (position, track, forecast cone) and other alerts ---------- */
var GD = 'https://www.gdacs.org/gdacsapi/api/';
function ymd(ms){ return new Date(ms).toISOString().slice(0, 10) }
function gdSearch(list, days, levels){
  return live(GD + 'events/geteventlist/SEARCH?eventlist=' + list + '&fromDate=' + ymd(Date.now() - days * 864e5) + '&toDate=' + ymd(Date.now() + 864e5) +
    (levels ? '&alertlevel=' + levels : ''), true);
}
function isCurrent(p){ return String(p.iscurrent).toLowerCase() === 'true' }
function loadStorms(){
  return gdSearch('TC', 20, 'Green;Orange;Red').then(function(g){
    var pts = [], lines = [], polys = [], seen = {}, jobs = [], data = {pts: pts, lines: lines, polys: polys};
    // tracks and cones are heavy and GDACS can be slow with them: the storms show at once, each track joins when it comes
    var addLine = function(l){ l.f = l.pts.map(function(q){ return [mx(q[0]), my(q[1])] }); lines.push(l) };
    var addPoly = function(pg){ pg.f = pg.rings.map(function(r){ return r.map(function(q){ return [mx(q[0]), my(q[1])] }) }); polys.push(pg) };
    (g.features || []).forEach(function(f){
      var p = f.properties || {}, geo_ = f.geometry || {};
      if (p.eventtype !== 'TC' || geo_.type !== 'Point' || !isCurrent(p) || seen[p.eventid]) return;
      seen[p.eventid] = 1;
      var sev = p.severitydata || {}, kmh = sev.severity != null ? +sev.severity : null, name = (p.eventname || p.name || '').replace(/-\d+$/, ''), col = stormCol(kmh);
      var s = [stormCat(kmh) + (kmh != null ? ' · ' + TX('gm_wind', fmt(kmh, 0)) : ''), TX('gm_alert', p.alertlevel || '—'),
        (p.country ? p.country + ' · ' : '') + TX('gm_since', F.dmy(String(p.fromdate || '').slice(0, 10)))];
      pts.push({lon: geo_.coordinates[0], lat: geo_.coordinates[1], r: 6 + (kmh ? Math.min(8, kmh / 40) : 0), c: col, t: '🌀 ' + name, s: s,
        u: p.url && p.url.report, lbl: name, k: 'storm', kmh: kmh, alert: p.alertlevel, country: p.country, eid: p.eventid, ring: true});
      // the track (segments labelled by strength), the forecast cone and the areas of 60/90/120 km/h winds
      if (p.url && p.url.geometry) jobs.push(live(p.url.geometry, true).then(function(gg){
        (gg.features || []).forEach(function(ff){
          var q = ff.properties || {}, gt = ff.geometry || {}, cl = String(q.Class || ''), lb = String(q.polygonlabel || '');
          var each = function(t, f){ (gt.type === t ? [gt.coordinates] : gt.coordinates).forEach(f) };
          if (/^Line_/.test(cl) && /LineString/.test(gt.type)) each('LineString', function(c){ addLine({pts: c, c: TRACK_COL[lb] || col, w: 2}) });
          else if (cl === 'Poly_Cones' && /Polygon/.test(gt.type)) each('Polygon', function(pg){ addPoly({rings: [pg[0]], c: '#ffffff', a: 0.07}) });
          else if (/^Poly_(Green|Orange|Red)$/.test(cl) && /km\/h/.test(lb) && /Polygon/.test(gt.type)) each('Polygon', function(pg){ addPoly({rings: [pg[0]], c: alertCol(cl.slice(5)), a: 0.12}) });
        });
        if (M.data.storms === data) redraw();
      }).catch(function(){}));
    });
    return Promise.race([Promise.all(jobs), new Promise(function(r){ setTimeout(r, 3000) })]).then(function(){ return data });
  });
}
// a tropical cyclone as it looks from orbit: a white cloud disc with spiral bands and the eye, rings of its strength
function drawStorm(g, x, y, r, p){
  var kmh = p.kmh || 60, R = Math.max(14, Math.min(90, r * (1.6 + kmh / 120))), t = (Date.now() / 9000) % (2 * Math.PI);
  g.save();
  var gr = g.createRadialGradient(x, y, R * 0.08, x, y, R);
  gr.addColorStop(0, 'rgba(245,248,252,.92)'); gr.addColorStop(0.45, 'rgba(225,232,242,.55)'); gr.addColorStop(1, 'rgba(210,220,235,0)');
  g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.arc(x, y, R, 0, 6.2832); g.fill();
  // spiral bands (counter-clockwise in the north, clockwise in the south)
  var dir = p.lat < 0 ? -1 : 1;
  g.lineCap = 'round';
  for (var arm = 0; arm < 3; arm++) {
    g.beginPath();
    for (var i = 0; i <= 40; i++) {
      var f = i / 40, a = t * dir + arm * 2.094 + dir * f * 4.2, rr = R * (0.12 + 0.95 * f);
      var px_ = x + Math.cos(a) * rr, py_ = y - Math.sin(a) * rr;
      if (i) g.lineTo(px_, py_); else g.moveTo(px_, py_);
    }
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = Math.max(1.2, R * 0.07); g.stroke();
  }
  // the eye: dark for a hurricane/typhoon, cloudy for a weaker storm
  g.fillStyle = kmh >= 119 ? 'rgba(20,30,48,.85)' : 'rgba(255,255,255,.7)'; g.beginPath(); g.arc(x, y, Math.max(2, R * 0.07), 0, 6.2832); g.fill();
  // the rings: its colour by strength
  g.globalAlpha = 0.75; g.strokeStyle = p.c; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, R * 1.05, 0, 6.2832); g.stroke();
  g.globalAlpha = 0.35; g.beginPath(); g.arc(x, y, R * 1.45, 0, 6.2832); g.stroke();
  g.restore();
}
// track segments by the storm's strength then: hurricane/typhoon, tropical storm, depression
var TRACK_COL = {HU: '#ff4b6a', TY: '#ff4b6a', STY: '#ff2a6a', TS: '#f2cc60', TD: '#4fd2ff', STS: '#f2cc60'};
var GD_KIND = {EQ: 'gm_k_eq', FL: 'gm_k_fl', VO: 'gm_k_vo', DR: 'gm_k_dr', WF: 'gm_k_wf', TC: 'gm_k_tc'};
var GD_ICON = {EQ: '◎', FL: '≈', VO: '▲', DR: '☀', WF: '♨', TC: '🌀'};
function loadAlerts(){
  var types = ['EQ', 'FL', 'VO', 'DR', 'WF'];
  // earthquakes only with an orange or red alert (green ones are many and minor); floods, volcanoes, droughts and fires at every level
  // one request per type: GDACS returns at most 100 events per search
  var jobs = types.map(function(t){
    return gdSearch(t, t === 'EQ' ? 14 : 30, t === 'EQ' ? 'Orange;Red' : 'Green;Orange;Red').then(function(g){ return (g && g.features) || [] }, function(){ return null });
  });
  return Promise.all(jobs).then(function(a){
    if (a.every(function(x){ return x === null })) throw new Error('GDACS');
    return [].concat.apply([], a.map(function(x){ return x || [] }));
  }).then(function(feats){
    var pts = [], seen = {}, week = Date.now() - 7 * 864e5;
    feats.forEach(function(f){
      var p = f.properties || {}, geo_ = f.geometry || {};
      if (geo_.type !== 'Point' || !p.eventtype || p.eventtype === 'TC' || seen[p.eventtype + p.eventid]) return;
      if (p.Class && !/centroid/i.test(p.Class)) return;
      var lvl = String(p.alertlevel || 'Green');
      // green earthquakes are minor; the rest while current or from the last week
      if (lvl === 'Green' && p.eventtype === 'EQ') return;
      if (!isCurrent(p) && Date.parse(p.todate || p.fromdate) < week) return;
      seen[p.eventtype + p.eventid] = 1;
      var sev = p.severitydata || {};
      pts.push({lon: geo_.coordinates[0], lat: geo_.coordinates[1], r: lvl === 'Red' ? 7 : lvl === 'Orange' ? 5.5 : 3.6, c: alertCol(lvl),
        t: (GD_ICON[p.eventtype] || '') + ' ' + (p.name || p.eventname || TX(GD_KIND[p.eventtype] || 'gm_k_eq')), s: [TX(GD_KIND[p.eventtype] || 'gm_k_eq') + ' · ' + TX('gm_alert', lvl),
          sev.severitytext || '', (p.country || '') + (p.fromdate ? ' · ' + F.dmy(String(p.fromdate).slice(0, 10)) : '')].filter(Boolean),
        u: p.url && p.url.report, k: 'alert'});
    });
    return {pts: pts};
  });
}

/* ---------- stock markets: the terminal's own quotes ---------- */
function loadExch(){
  var pts = EXCH.map(function(e){
    var q = T.Q[e.id]; if (!q) return null;
    var s = [nm2(e.city) + ': ' + fmt(q.value, q.digits) + ' ' + pct(q.change)];
    (e.more || []).forEach(function(id){ var x = T.Q[id]; if (x) s.push(x.name + ': ' + fmt(x.value, x.digits) + ' ' + pct(x.change)) });
    s.push(TX('gm_click_chart'));
    return {lon: e.lon, lat: e.lat, r: 7, c: diverging(q.change, 2) || '#4b5563', ring: true, t: q.name, s: s, lbl: (q.name || e.id) + ' ' + pct(q.change, 1),
      act: function(){ T.openChart(e.id) }, k: 'exch'};
  }).filter(Boolean);
  if (!pts.length) throw new Error(TX('gm_no_quotes'));
  return {pts: pts};
}

/* ---------- IMF PortWatch: chokepoints (daily transits from satellite AIS) ---------- */
// The bot reads PortWatch (portwatch.py → ../portwatch.json, every 6 hours): PortWatch's own query service has been
// failing since late October 2026 ("Token Required", "Cannot perform query"). Straight from PortWatch only if that
// file is missing.
var PW = 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/';
var chokeP = null, chokeAt = 0;
function chokeData(){
  if (chokeP && Date.now() - chokeAt < 3600000) return chokeP;
  chokeAt = Date.now();
  chokeP = getJSON('../portwatch.json?t=' + Math.floor(Date.now() / 600000), 20000).then(function(d){
    var list = (d && d.choke) || [];
    if (list.length < 5) throw new Error('portwatch.json');
    // a day: [date, ships, tankers, container ships, dry bulk, capacity t, tanker capacity t]
    return chokeSummary(list.map(function(c){
      return {id: c.id, name: c.name, lon: c.lon, lat: c.lat, yr: c.yr, top: c.top, days: (c.days || []).map(function(x){
        return {k: +String(x[0]).replace(/-/g, ''), d: x[0], n: x[1], tk: x[2], cn: x[3], db: x[4], cap: x[5], ctk: x[6]} })};
    }), d.updated);
  }).catch(function(){ return chokeLive() }).catch(function(e){ chokeP = null; throw new Error(TX('gm_pw_fail')) });
  return chokeP;
}
function chokeLive(){
  var s = new Date(Date.now() - 45 * 864e5), y = s.getUTCFullYear(), m = s.getUTCMonth() + 1, d = s.getUTCDate();
  var where = '(year > ' + y + ') OR (year = ' + y + ' AND month > ' + m + ') OR (year = ' + y + ' AND month = ' + m + ' AND day >= ' + d + ')';
  var q = 'where=' + encodeURIComponent(where) + '&outFields=year,month,day,portid,portname,n_total,n_tanker,n_container,n_dry_bulk,n_cargo,capacity,capacity_tanker' +
    '&returnGeometry=false&orderByFields=' + encodeURIComponent('year DESC,month DESC,day DESC,portid') + '&f=json';
  return Promise.all([
    live(PW + 'PortWatch_chokepoints_database/FeatureServer/0/query?where=1%3D1&outFields=portid,portname,lat,lon,vessel_count_total,vessel_count_tanker,industry_top1&returnGeometry=false&f=json', true),
    arcgisAll(PW + 'Daily_Chokepoints_Data/FeatureServer/0/query?' + q)
  ]).then(function(r){
    if (r[0] && r[0].error) throw new Error('ArcGIS: ' + (r[0].error.message || r[0].error.code));
    var items = {};
    (r[0].features || []).forEach(function(f){ var a = f.attributes || {}; if (a.portid && a.lat != null) items[a.portid] = {id: a.portid, name: a.portname, lon: a.lon, lat: a.lat,
      yr: a.vessel_count_total, top: a.industry_top1, days: []} });
    (r[1].features || []).forEach(function(f){
      var a = f.attributes || {}, it = items[a.portid]; if (!it) return;
      it.days.push({k: a.year * 10000 + a.month * 100 + a.day, d: a.year + '-' + ('0' + a.month).slice(-2) + '-' + ('0' + a.day).slice(-2), n: a.n_total, tk: a.n_tanker,
        cn: a.n_container, db: a.n_dry_bulk, cap: a.capacity, ctk: a.capacity_tanker});
    });
    return chokeSummary(Object.keys(items).map(function(k){ return items[k] }));
  });
}
// per chokepoint: ships and tankers a day over the last 7 days against the 30 before them
function chokeSummary(items, updated){
  var out = items.map(function(b){
    var days = (b.days || []).slice().sort(function(x, y_){ return x.k - y_.k });
    var last7 = days.slice(-7), prev = days.slice(-37, -7);
    var avg = function(a, k){ var v = a.filter(function(x){ return x[k] != null }); return v.length ? v.reduce(function(s, x){ return s + x[k] }, 0) / v.length : null };
    var n7 = avg(last7, 'n'), p30 = avg(prev, 'n'), t7 = avg(last7, 'tk'), tp = avg(prev, 'tk');
    return {id: b.id, name: b.name, lon: b.lon, lat: b.lat, n7: n7, p30: p30, ch: n7 != null && p30 ? (n7 / p30 - 1) * 100 : null,
      t7: t7, tch: t7 != null && tp ? (t7 / tp - 1) * 100 : null, cap7: avg(last7, 'cap'), ctk7: avg(last7, 'ctk'), days: days,
      last: days.length ? days[days.length - 1].d : null, yr: b.yr, top: b.top};
  }).filter(function(c){ return c.lat != null && c.lon != null });
  out.sort(function(a, b){ return (b.n7 || 0) - (a.n7 || 0) });
  return out;
}
function loadChoke(){
  return chokeData().then(function(list){
    var pts = list.map(function(c){
      var s = [TX('gm_ships_day', c.n7 != null ? fmt(c.n7, 0) : '—') + (c.ch != null ? ' · ' + pct(c.ch, 0) + ' ' + TX('gm_vs30') : ''),
        TX('gm_tankers_day', c.t7 != null ? fmt(c.t7, 0) : '—') + (c.tch != null ? ' · ' + pct(c.tch, 0) : ''),
        c.cap7 != null ? TX('gm_cargo_day', fmt(c.cap7 / 1e6, 2)) : '', c.last ? TX('gm_data_to', c.last) : ''].filter(Boolean);
      return {lon: c.lon, lat: c.lat, r: 3.5 + Math.sqrt(c.n7 || 4) * 0.9, c: c.ch == null ? '#56c1d6' : c.ch < -15 ? '#ef5350' : c.ch < -5 ? '#e0b23c' : '#56c1d6',
        ring: true, t: '⚓ ' + c.name, s: s, lbl: c.name, k: 'choke', cp: c, act: function(){ pinChoke(c) }};
    });
    return {pts: pts};
  });
}

// an ArcGIS layer gives at most 1000–2000 rows per answer: the next pages follow while it says there is more
function arcgisAll(url, max){
  var out = [];
  var page = function(off){
    return live(url + '&resultOffset=' + off + '&resultRecordCount=1000', true).then(function(d){
      if (d && d.error) throw new Error('ArcGIS: ' + (d.error.message || d.error.code));
      out = out.concat(d.features || []);
      if (d.exceededTransferLimit && (d.features || []).length && off + 1000 < (max || 4000)) return page(off + 1000);
      return {features: out};
    });
  };
  return page(0);
}
function cName(c){ return I.ru ? c.ru : I.country(c.iso, c.en) }
function countryName(iso){ var c = world && world.c[iso]; return c ? cName(c) : iso || '' }

/* ---------- ports: IMF PortWatch (with their traffic), Natural Earth if it does not answer ---------- */
// the ports database once for both layers that use it (seaports, oil terminals)
var portsRawP = null;
function portsRaw(){
  // the bot's copy first (portwatch.py → ../pw_ports.json), PortWatch itself if it is missing
  if (!portsRawP) portsRawP = getJSON('../pw_ports.json', 20000).then(function(d){
    var p = (d && d.p) || []; if (p.length < 300) throw new Error('pw_ports.json');
    return {features: p.map(function(r){ return {attributes: {portname: r[0], country: r[1], ISO3: r[2], lat: r[3], lon: r[4], vessel_count_total: r[5],
      vessel_count_tanker: r[6], industry_top1: r[7]}} })};
  }).catch(function(){
    return arcgisAll(PW + 'PortWatch_ports_database/FeatureServer/0/query?where=1%3D1&outFields=portname,country,ISO3,lat,lon,vessel_count_total,vessel_count_tanker,industry_top1&returnGeometry=false&f=json', 3000);
  }).catch(function(e){ portsRawP = null; throw e });
  return portsRawP;
}
function loadPorts(){
  return portsRaw()
    .then(function(d){
      var pts = (d.features || []).map(function(f){
        var a = f.attributes || {}; if (a.lat == null || a.lon == null) return null;
        var n = a.vessel_count_total || 0;
        return {lon: a.lon, lat: a.lat, r: 1.2, c: '#6ea8ff', t: '⚓ ' + a.portname, v: n,
          s: [(a.country || '') + (a.industry_top1 ? ' · ' + a.industry_top1 : ''), TX('gm_port_calls', fmt(n, 0)) + (a.vessel_count_tanker ? ' · ' + TX('gm_tankers_short') + ' ' + fmt(a.vessel_count_tanker, 0) : '')],
          lbl: a.portname, minLbl: 2.2, k: 'port'};
      }).filter(Boolean).sort(function(a, b){ return a.v - b.v });
      if (pts.length < 100) throw new Error('PortWatch');
      // the circle's area follows the port's traffic, relative to the busiest one
      var top = pts[pts.length - 1].v || 1;
      pts.forEach(function(p, i){ p.r = 1.2 + 4.8 * Math.sqrt(Math.max(0, p.v) / top); if (i < pts.length - 25) p.lbl = null });   // names of the 25 busiest
      return {pts: pts, src: 'IMF PortWatch'};
    }).catch(function(){
      return geo('ports.json').then(function(d){
        return {pts: d.p.map(function(p){
          return {lon: p[0], lat: p[1], r: Math.max(1.3, 4.6 - p[2] * 0.42), c: '#6ea8ff', t: '⚓ ' + p[3], s: [TX('gm_port_rank', p[2])], lbl: p[2] <= 3 ? p[3] : null, minLbl: 2.5, k: 'port'};
        }), src: d.src};
      });
    });
}

/* ---------- static infrastructure ---------- */
function loadPlants(){
  return geo('plants.json').then(function(d){
    var fuels = d.fuels;
    return {pts: d.p.map(function(p){
      var f = fuels[p[3]], c = FUEL_COL[f] || '#8b95a7';
      return {lon: p[0], lat: p[1], r: Math.max(0.9, Math.min(7, Math.sqrt(p[2]) / 6.5)), c: c, glow: true, fuel: f,
        t: (p[5] || TX('gm_plant_' + f.toLowerCase())) , s: [TX('gm_fuel_' + f.toLowerCase()) + ' · ' + fmt(p[2], p[2] < 10 ? 1 : 0) + ' ' + TX('gm_mw'), countryName(p[4])], k: 'plant'};
    }), src: d.src, fuels: fuels};
  });
}
function loadInfra(file, col, key){
  return geo(file).then(function(d){
    return {pts: (d.p || []).map(function(p){
      // [lon, lat, name, iso3, extra text]
      return {lon: p[0], lat: p[1], r: 3.4, c: col, ring: true, t: p[2] || TX(key), s: [TX(key) + (p[3] ? ' · ' + countryName(p[3]) : ''), p[4] || ''].filter(Boolean), k: key};
    }), src: d.src};
  });
}

/* ---------- natural gas: fields (Wikidata) and underground storage (Wikidata, OpenStreetMap) ---------- */
function loadGas(){
  return geo('gas.json').then(function(d){
    return {pts: (d.p || []).map(function(p){
      // [lon, lat, kind (0 field, 1 storage), name, iso3, operator]
      var st = p[2] === 1, key = st ? 'gm_gas_storage' : 'gm_gas_field';
      return {lon: p[0], lat: p[1], r: st ? 3.6 : 2.8, c: st ? '#3fd0a8' : '#b7e34b', ring: true, t: p[3], k: 'gas',
        s: [TX(key) + (p[4] ? ' · ' + countryName(p[4]) : ''), p[5] || ''].filter(Boolean)};
    }), src: d.src};
  });
}

/* ---------- oil terminals: the ports where most tankers call (IMF PortWatch) and oil depots (OpenStreetMap) ---------- */
function loadOilStorage(){
  var ports = portsRaw().then(function(d){
    var rows = (d.features || []).map(function(f){ return f.attributes || {} }).filter(function(a){ return a.lat != null && a.vessel_count_tanker > 0 })
      .sort(function(a, b){ return b.vessel_count_tanker - a.vessel_count_tanker }).slice(0, 250);
    var top = rows.length ? rows[0].vessel_count_tanker : 1;
    return rows.map(function(a){
      var share = a.vessel_count_total ? a.vessel_count_tanker / a.vessel_count_total * 100 : null;
      return {lon: a.lon, lat: a.lat, r: 2 + 5 * Math.sqrt(a.vessel_count_tanker / top), c: '#ffb35c', ring: true, t: '🛢 ' + a.portname, k: 'oilport', v: a.vessel_count_tanker,
        s: [TX('gm_oil_port') + (a.country ? ' · ' + a.country : ''), TX('gm_tanker_calls', fmt(a.vessel_count_tanker, 0)) + (share != null ? ' · ' + TX('gm_tanker_share', fmt(share, 0)) : '')],
        lbl: a.portname, minLbl: 3};
    });
  }).catch(function(){ return [] });
  var depots = geo('depots.json').then(function(d){
    return (d.p || []).map(function(p){
      // [lon, lat, name, iso3, operator]
      return {lon: p[0], lat: p[1], r: 1.8, c: '#d98a3a', t: p[2] || TX('gm_depot'), k: 'depot', s: [TX('gm_depot') + (p[3] ? ' · ' + countryName(p[3]) : ''), p[4] || ''].filter(Boolean)};
    });
  }).catch(function(){ return [] });
  return Promise.all([ports, depots, satPoints()]).then(function(a){
    if (!a[0].length && !a[1].length) throw new Error(TX('load_fail'));
    var pts = a[1].concat(a[0].sort(function(x, y){ return x.v - y.v })).concat(a[2]);
    a[0].forEach(function(p, i){ if (i > 30) p.lbl = null });   // names of the 30 busiest
    return {pts: pts, src: (a[0].length ? 'IMF PortWatch · ' : '') + 'OpenStreetMap contributors (ODbL)'};
  });
}

/* ---------- heavy industry: Climate TRACE's inventory of plants ---------- */
var FACT_COL = {steel: '#9fb3cc', aluminium: '#c9b8ff', cement: '#d8c49a', chemicals: '#ff7ad9', paper: '#8fd18f', glass: '#7fe0e0', metals: '#e0a060'};
function loadFactories(){
  return geo('factories.json').then(function(d){
    var cats = d.cats, types = d.types || [], top = 1;
    d.p.forEach(function(p){ if (p[7] > top) top = p[7] });
    return {pts: d.p.map(function(p){
      // [lon, lat, category, name, iso3, owner, capacity t a year, CO2e t a year, type]
      var cat = cats[p[2]], ty = types[p[8]] || '';
      return {lon: p[0], lat: p[1], r: 1.1 + 5 * Math.sqrt((p[7] || 0) / top), c: FACT_COL[cat] || '#aaa', fuel: cat, k: 'fact', t: p[3],
        s: [TX('gm_fact_' + cat) + (ty ? ' (' + ty + ')' : '') + (p[4] ? ' · ' + countryName(p[4]) : ''), p[5] || '',
          p[6] ? TX('gm_capacity', fmt(p[6] / 1e6, p[6] < 1e6 ? 2 : 1)) : '', p[7] ? TX('gm_co2', fmt(p[7] / 1e6, p[7] < 1e6 ? 2 : 1)) : ''].filter(Boolean)};
    }).reverse(), src: d.src, cats: cats};   // the biggest drawn last, on top
  });
}

/* ---------- vessels: live AIS of the Baltic Sea (Finland's Digitraffic) ---------- */
// AIS ship type → the map's kind
var SHIP_KINDS = ['tanker', 'cargo', 'pass', 'service', 'other'];
var SHIP_COL = {tanker: '#ff9f40', cargo: '#5ab0ff', pass: '#d58cff', service: '#9ad06a', other: '#9a9a9a'};
function shipKind(t){ return t >= 80 && t < 90 ? 'tanker' : t >= 70 && t < 80 ? 'cargo' : t >= 60 && t < 70 ? 'pass' : (t >= 50 && t < 60) || (t >= 31 && t <= 33) ? 'service' : 'other' }
var DT = 'https://meri.digitraffic.fi/api/ais/v1/';
// where each Baltic ship was at the earlier loads (every 3 minutes while the map is open): the last 2 hours, 12 points
var TRAILS = {};
function trail(id, lon, lat, t){
  var r = TRAILS[id] || (TRAILS[id] = {pts: [], cur: null}), cut = Date.now() - 2 * 3600e3;
  if (!r.cur) r.cur = [lon, lat, t];
  else if (Math.abs(r.cur[0] - lon) + Math.abs(r.cur[1] - lat) > 0.002) { r.pts.push(r.cur); r.cur = [lon, lat, t] }   // moved ~200 m: the old place joins the track
  r.pts = r.pts.filter(function(q){ return q[2] >= cut }).slice(-12);
  return r.pts;
}
function loadShips(){
  return Promise.all([live(DT + 'locations', true), (M.shipMeta && Date.now() - M.shipMeta.at < 3600e3) ? Promise.resolve(M.shipMeta.d) : live(DT + 'vessels', true).then(function(v){ M.shipMeta = {at: Date.now(), d: v}; return v })])
    .then(function(a){
      var meta = {}; (a[1] || []).forEach(function(v){ meta[v.mmsi] = v });
      var cut = Date.now() - 6 * 3600e3;
      var pts = ((a[0] || {}).features || []).map(function(f){
        var pr = f.properties || {}, c = f.geometry && f.geometry.coordinates, v = meta[f.mmsi || pr.mmsi] || {};
        if (!c || c[0] == null || (pr.timestampExternal && pr.timestampExternal < cut)) return null;
        var kind = shipKind(v.shipType || 0), moving = pr.sog > 0.5 && pr.navStat !== 1 && pr.navStat !== 5;
        var name = (v.name || '').trim() || 'MMSI ' + (f.mmsi || pr.mmsi);
        var s = [TX('gm_ship1_' + kind) + ' · ' + (moving ? TX('gm_ship_speed', fmt(pr.sog, 1)) : TX(pr.navStat === 1 ? 'gm_ship_anchor' : pr.navStat === 5 ? 'gm_ship_moored' : 'gm_ship_still'))];
        if (v.destination && v.destination.trim()) s.push(TX('gm_ship_dest', v.destination.trim()));
        if (v.draught) s.push(TX('gm_ship_draught', fmt(v.draught / 10, 1)));
        if (moving && pr.cog != null && pr.cog < 360) s.splice(1, 0, TX('gm_ship_course', fmt(pr.cog, 0)));
        s.push(ago(pr.timestampExternal));
        var id = f.mmsi || pr.mmsi, tr = trail(id, c[0], c[1], pr.timestampExternal || Date.now());
        return trackNote({lon: c[0], lat: c[1], r: kind === 'tanker' || kind === 'cargo' ? 2.4 : 1.8, c: SHIP_COL[kind], fuel: kind, k: 'ship', t: '🚢 ' + name, s: s,
          hd: moving ? (pr.cog != null && pr.cog < 360 ? pr.cog : pr.heading != null && pr.heading < 360 ? pr.heading : null) : null, sog: pr.sog,
          trk: tr.map(function(q){ return [q[0], q[1]] }), trk0: tr.length ? tr[0][2] : null, lbl: (v.name || '').trim(),
          u: 'https://www.marinetraffic.com/en/ais/details/ships/mmsi:' + encodeURIComponent(id)});
      }).filter(Boolean);
      if (!pts.length) throw new Error('Digitraffic');
      // tankers and cargo ships on top
      var rank = {other: 0, service: 1, pass: 2, cargo: 3, tanker: 4};
      pts.sort(function(x, y){ return rank[y.fuel] - rank[x.fuel] });
      return {pts: pts, ships: true, src: 'Digitraffic AIS (CC BY 4.0)', updated: (a[0] || {}).dataUpdatedTime};
    });
}

/* ---------- ships on the map: an arrow along the course, the track behind, a dashed line 30 minutes ahead ---------- */
function shipSize(z){ return Math.max(3, Math.min(7.5, 2.3 * z)) }
// the track and the line ahead of one ship (all copies of the world across the date line)
function drawShipPath(g, p, ks, hi){
  for (var j = 0; j < ks.length; j++) {
    var k = ks[j], x = sx(p.fx + k), y = sy(p.fy);
    if (p.tf && p.tf.length) {
      var prev = null;
      for (var i = 0; i <= p.tf.length; i++) {
        var q = i < p.tf.length ? p.tf[i] : [p.fx, p.fy], qx = sx(q[0] + k), qy = sy(q[1]);
        if (prev && Math.abs(q[0] - prev[2]) < 0.5) {   // a segment across the date line is not drawn
          g.globalAlpha = hi ? 0.95 : 0.18 + 0.5 * i / p.tf.length; g.strokeStyle = hi ? '#f2cc60' : p.c; g.lineWidth = hi ? 2 : 1.3;
          g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(qx, qy); g.stroke();
        }
        if (i < p.tf.length) { g.globalAlpha = hi ? 1 : 0.55; g.fillStyle = hi ? '#f2cc60' : p.c; g.beginPath(); g.arc(qx, qy, hi ? 2.2 : 1.4, 0, 6.2832); g.fill() }
        prev = [qx, qy, q[0]];
      }
    }
    if (p.pf) {
      var fx_ = sx(p.pf[0] + k), fy_ = sy(p.pf[1]);
      if (Math.abs(fx_ - x) + Math.abs(fy_ - y) > 6 && Math.abs(p.pf[0] - p.fx) < 0.5) {
        g.globalAlpha = hi ? 0.95 : 0.6; g.strokeStyle = hi ? '#f2cc60' : p.c; g.lineWidth = hi ? 1.6 : 1.1; g.setLineDash([3, 3]);
        g.beginPath(); g.moveTo(x, y); g.lineTo(fx_, fy_); g.stroke(); g.setLineDash([]);
      }
    }
  }
  g.globalAlpha = 1;
}
function drawShipBody(g, p, x, y, sz){
  g.fillStyle = p.c; g.strokeStyle = 'rgba(5,8,12,.85)'; g.lineWidth = 0.9; g.globalAlpha = 0.95;
  if (p.hd == null) {   // at anchor, moored or still: a dot
    g.beginPath(); g.arc(x, y, sz * 0.5, 0, 6.2832); g.fill(); g.stroke(); return;
  }
  var a = p.hd * D2R, c = Math.cos(a), s_ = Math.sin(a);
  var P_ = function(px_, py_){ return [x + px_ * c - py_ * s_, y + px_ * s_ + py_ * c] };   // a point of the arrow, turned to the course
  var t = P_(0, -sz * 1.55), l = P_(-sz * 0.85, sz * 1.0), m = P_(0, sz * 0.45), r = P_(sz * 0.85, sz * 1.0);
  g.beginPath(); g.moveTo(t[0], t[1]); g.lineTo(l[0], l[1]); g.lineTo(m[0], m[1]); g.lineTo(r[0], r[1]); g.closePath(); g.fill(); g.stroke();
}
function drawShips(g, d, off, ks, z, W, H, labels){
  var sz = shipSize(z), zoomIn = M.S / M.S0;
  // tracks: when zoomed in to a sea (or when there are few ships), not over the whole world
  var paths = zoomIn >= 2.4 || d.pts.length < 400;
  if (paths) d.pts.forEach(function(p){
    if (off && off[p.fuel]) return;
    var y = sy(p.fy); if (y < -60 || y > H + 60) return;
    drawShipPath(g, p, ks, false);
  });
  for (var i = d.pts.length - 1; i >= 0; i--) {
    var p = d.pts[i]; if (off && off[p.fuel]) continue;
    var y = sy(p.fy); if (y < -20 || y > H + 20) continue;
    for (var j = 0; j < ks.length; j++) {
      var x = sx(p.fx + ks[j]); if (x < -20 || x > W + 20) continue;
      drawShipBody(g, p, x, y, sz);
      if (p.lbl && zoomIn >= 6) labels.push({x: x, y: y, r: sz, t: p.lbl, c: p.c});
    }
  }
  g.globalAlpha = 1;
}
function shipLines(kind, v, t){
  var moving = v.sog > 0.5 && v.nav !== 1 && v.nav !== 5;
  var s = [TX('gm_ship1_' + kind) + ' · ' + (moving ? TX('gm_ship_speed', fmt(v.sog, 1)) : TX(v.nav === 1 ? 'gm_ship_anchor' : v.nav === 5 ? 'gm_ship_moored' : 'gm_ship_still'))];
  if (moving && v.cog != null) s.push(TX('gm_ship_course', fmt(v.cog, 0)));
  if (v.dest) s.push(TX('gm_ship_dest', v.dest));
  if (v.draught) s.push(TX('gm_ship_draught', fmt(v.draught, 1)));
  if (t) s.push(ago(t));
  return {s: s, moving: moving};
}
function trackNote(p){
  if (p.trk && p.trk.length && p.trk0) p.s.push(TX('gm_ship_trk', fmt((Date.now() - p.trk0) / 3600e3, 1)));
  else if (p.pf) p.s.push(TX('gm_ship_ahead'));
  return p;
}

/* ---------- ships worldwide: tankers and cargo ships, aisstream.io, read by the bot (ais.py → ships_world.json) ---------- */
function loadWorldShips(){
  return getJSON('../ships_world.json?t=' + Math.floor(Date.now() / 60000), 30000).catch(function(){ throw new Error(TX('gm_world_nokey')) }).then(function(d){
    var C = d.cols || [], ix = {}; C.forEach(function(c, i){ ix[c] = i });
    if (ix.mmsi == null || ix.track == null) throw new Error('ships_world.json');
    var pts = (d.s || []).map(function(r){
      var lat = r[ix.lat], lon = r[ix.lon]; if (typeof lat !== 'number' || typeof lon !== 'number') return null;
      var kind = r[ix.kind] === 't' ? 'tanker' : 'cargo', m = r[ix.minute], t = m * 60000, flat = r[ix.track] || [], trk = [], t0 = null;
      for (var i = 0; i + 2 < flat.length; i += 3) { trk.push([flat[i + 1], flat[i]]); if (t0 == null) t0 = t - flat[i + 2] * 60000 }
      var v = {sog: r[ix.sog], cog: r[ix.cog], nav: r[ix.nav], dest: r[ix.dest], draught: r[ix.draught]}, L = shipLines(kind, v, t);
      var name = r[ix.name] || 'MMSI ' + r[ix.mmsi];
      return trackNote({lon: lon, lat: lat, r: 2.6, c: SHIP_COL[kind], fuel: kind, k: 'ship', t: (kind === 'tanker' ? '🛢 ' : '🚢 ') + name, s: L.s,
        hd: L.moving ? v.cog : null, sog: v.sog, trk: trk, trk0: t0, lbl: name, u: 'https://www.marinetraffic.com/en/ais/details/ships/mmsi:' + encodeURIComponent(r[ix.mmsi])});
    }).filter(Boolean);
    if (!pts.length) throw new Error(TX('gm_world_none'));
    pts.sort(function(a, b){ return (a.fuel === 'tanker' ? 0 : 1) - (b.fuel === 'tanker' ? 0 : 1) });   // tankers on top
    return {pts: pts, ships: true, src: 'aisstream.io', updated: d.updated, counts: d.counts};
  });
}

/* ---------- tankers at the oil chokepoints: aisstream.io, read by the bot (ais.py → ships.json) ---------- */
var AREA_COL = {hormuz: '#ff9f40', bab: '#ff7a5c', suez: '#f2cc60', malacca: '#56c1d6', turkish: '#a78bfa', danish: '#6ea8ff', gibraltar: '#b7e34b', panama: '#2fbf71', cape: '#e8e8a0'};
function loadTankers(){
  return getJSON('../ships.json?t=' + Math.floor(Date.now() / 60000), 20000).catch(function(){ throw new Error(TX('gm_tankers_nokey')) }).then(function(d){
    var names = {}; (d.areas || []).forEach(function(a){ names[a.id] = I.xl ? I.xlName('AREA', a.id) || a.name : I.ru ? a.name_ru || a.name : a.name });
    var pts = (d.ships || []).filter(function(v){ return typeof v.lat === 'number' && typeof v.lon === 'number' }).map(function(v){
      var L = shipLines('tanker', v, v.t ? Date.parse(v.t) : null);
      if (v.area && names[v.area]) L.s.splice(1, 0, '⚓ ' + names[v.area]);
      var trk = (v.trk || []).filter(function(q){ return q && q.length >= 2 }).map(function(q){ return [q[1], q[0]] });
      return trackNote({lon: v.lon, lat: v.lat, r: 2.8, c: AREA_COL[v.area] || '#ff9f40', k: 'ship', fuel: 'tanker', t: '🛢 ' + (v.name || 'MMSI ' + v.mmsi), s: L.s,
        hd: L.moving ? v.cog : null, sog: v.sog, trk: trk, trk0: v.trk && v.trk.length && v.trk[0][2] ? v.trk[0][2] * 60000 : null, lbl: v.name,
        u: 'https://www.marinetraffic.com/en/ais/details/ships/mmsi:' + encodeURIComponent(v.mmsi)});
    });
    if (!pts.length) throw new Error(TX('gm_tankers_none'));
    return {pts: pts, ships: true, src: 'aisstream.io', updated: d.updated, areas: d.areas};
  });
}

/* ---------- SPLC: the oil supply chain — producers, chokepoints, buyers ---------- */
// crude oil and products through each chokepoint, million barrels a day, by quarter: EIA Short-Term Energy Outlook
// (Global Energy Security Data). The bot reads EIA's table every day (chokepoints.py → ../chokepoints.json) and the
// diagram takes the figures from there; the lines below (released 10 Nov 2026) are only for when that file is missing.
var EIA_Q = ['2Q25', '3Q25', '4Q25', '1Q26', '2Q26', '3Q26'];
var EIA = {malacca: [23.9, 23.5, 25.0, 21.4, 16.7, 19.4], hormuz: [21.1, 21.4, 21.6, 15.0, 5.1, 9.1], suez: [5.1, 5.6, 5.9, 5.7, 5.8, 7.1],
  bab: [4.5, 4.7, 5.4, 5.6, 8.1, 6.3], danish: [4.8, 5.0, 5.0, 4.9, 4.7, 4.5], turkish: [3.7, 3.7, 3.7, 3.3, 4.1, 3.4], panama: [2.5, 2.8, 2.8, 2.9, 3.2, 3.0],
  cape: [9.4, 9.1, 10.0, 8.3, 9.5, 8.7]};
var EIA_SRC = 'https://www.eia.gov/outlooks/steo/report/energysecurity/article.php', EIA_REL = '2026-11-10';
// the bot's copy of EIA's table: used when it is complete (every chokepoint, a number for every quarter)
function goodEia(d){
  if (!d || !Array.isArray(d.q) || d.q.length < 4 || !d.v) return false;
  if (!d.q.every(function(q){ return /^[1-4]Q\d\d$/.test(q) })) return false;
  return Object.keys(EIA).every(function(k){ var a = d.v[k]; return Array.isArray(a) && a.length === d.q.length && a.every(function(x){ return typeof x === 'number' && x >= 0 && x <= 40 }) });
}
var eiaLoad = null;
function loadEia(){
  // resolves true once, when the bot's figures replace the built-in ones
  if (!eiaLoad) eiaLoad = getJSON('../chokepoints.json?t=' + Math.floor(Date.now() / 3600e3), 15000).then(function(d){
    if (!goodEia(d)) return false;
    var v = {}; Object.keys(EIA).forEach(function(k){ v[k] = d.v[k].slice() });
    // the date goes with the figures: the bot's figures without a release date show none (not the built-in one)
    EIA_Q = d.q.slice(); EIA = v; EIA_REL = /^\d{4}-\d\d-\d\d$/.test(d.released || '') ? d.released : null;
    return true;
  }).catch(function(){ eiaLoad = null; return false });   // no file yet: the built-in figures; tried again next time
  return eiaLoad;
}
// what each quarter is compared with: 4Q25, the last quarter before the 2026 disruption of Hormuz, while EIA's table
// still covers it; otherwise the same quarter a year earlier
function eiaBase(){ var i = EIA_Q.indexOf('4Q25'); if (i < 0 || i === EIA_Q.length - 1) i = EIA_Q.length - 5; return i >= 0 ? i : null }
// nodes: x, y in 0..1; k: c = chokepoint, s = supply, d = demand; pw — the PortWatch chokepoint's name
// a node's name in the reader's language (Chinese and Arabic come from i18n.xl.js)
function spName(n){ return I.xl ? I.xlName('SPLC', n.id) || n.n[0] : n.n[I.ru ? 1 : 0] }
var SP_NODES = [
  {id: 'rusb', k: 's', x: 0.0, y: 0.05, n: ['Baltic: Russia', 'Балтика: Россия']},
  {id: 'rusbs', k: 's', x: 0.0, y: 0.2, n: ['Black Sea: Russia, Kazakhstan', 'Чёрное море: Россия, Казахстан']},
  {id: 'gulf', k: 's', x: 0.0, y: 0.47, n: ['Persian Gulf: Saudi Arabia, Iraq, UAE, Kuwait, Iran, Qatar', 'Персидский залив: Саудовская Аравия, Ирак, ОАЭ, Кувейт, Иран, Катар']},
  {id: 'wafr', k: 's', x: 0.0, y: 0.74, n: ['West Africa', 'Западная Африка']},
  {id: 'amer', k: 's', x: 0.0, y: 0.95, n: ['Americas: US, Brazil, Guyana', 'Америка: США, Бразилия, Гайана']},
  {id: 'danish', k: 'c', x: 0.46, y: 0.05, pw: /oresund|danish|great belt/i, n: ['Danish straits', 'Датские проливы']},
  {id: 'turkish', k: 'c', x: 0.46, y: 0.19, pw: /bosp|dardan|turk/i, n: ['Turkish straits', 'Турецкие проливы']},
  {id: 'suez', k: 'c', x: 0.6, y: 0.32, pw: /suez/i, n: ['Suez + SUMED', 'Суэц + SUMED']},
  {id: 'bab', k: 'c', x: 0.46, y: 0.42, pw: /bab/i, n: ['Bab el-Mandeb', 'Баб-эль-Мандеб']},
  {id: 'hormuz', k: 'c', x: 0.3, y: 0.55, pw: /hormuz/i, n: ['Hormuz', 'Ормуз']},
  {id: 'malacca', k: 'c', x: 0.62, y: 0.6, pw: /malacca/i, n: ['Malacca', 'Малакка']},
  {id: 'cape', k: 'c', x: 0.46, y: 0.78, pw: /good hope/i, n: ['Cape of Good Hope', 'Мыс Доброй Надежды']},
  {id: 'panama', k: 'c', x: 0.46, y: 0.95, pw: /panama/i, n: ['Panama Canal', 'Панамский канал']},
  {id: 'europe', k: 'd', x: 1.0, y: 0.12, n: ['Europe', 'Европа']},
  {id: 'india', k: 'd', x: 1.0, y: 0.44, n: ['India', 'Индия']},
  {id: 'asia', k: 'd', x: 1.0, y: 0.66, n: ['East Asia', 'Восточная Азия']},
  {id: 'americas', k: 'd', x: 1.0, y: 0.92, n: ['Americas', 'Америка']}
];
var SP_EDGES = [['gulf', 'hormuz'], ['hormuz', 'bab'], ['bab', 'suez'], ['suez', 'europe'], ['hormuz', 'india'], ['hormuz', 'malacca'], ['malacca', 'asia'], ['hormuz', 'cape'],
  ['cape', 'europe'], ['cape', 'americas'], ['rusb', 'danish'], ['danish', 'europe'], ['danish', 'suez'], ['rusbs', 'turkish'], ['turkish', 'europe'], ['turkish', 'suez'], ['suez', 'india'],
  ['wafr', 'cape'], ['cape', 'malacca'], ['wafr', 'europe'], ['amer', 'panama'], ['panama', 'asia'], ['amer', 'europe']];
function splcLive(){
  return chokeData().then(function(list){
    var out = {};
    SP_NODES.forEach(function(n){ if (n.pw) { var c = list.filter(function(x){ return n.pw.test(x.name || '') })[0]; if (c) out[n.id] = c } });
    return out;
  }).catch(function(){ return {} });
}
function drawSplc(){
  box = $('map-body'); clear(box); box.classList.remove('narrow', 'side-open');
  var w = el('div', 'gm-wrap sp-wrap'), sd = el('div', 'gm-side'); box.appendChild(w); box.appendChild(sd);
  // the diagram needs some height: in a small panel it scrolls; on a narrow screen the list goes under it
  var narrow = box.clientWidth < 700;
  box.style.overflow = 'auto'; box.style.flexDirection = narrow ? 'column' : '';
  w.style.minHeight = '520px'; w.style.flex = narrow ? 'none' : ''; if (narrow) { w.style.height = '520px'; sd.style.width = 'auto'; sd.style.borderLeft = '0' }
  var sub = function(){ $('map-sub').textContent = 'EIA ' + EIA_Q[EIA_Q.length - 1] + (EIA_REL ? ' (' + F.dmy(EIA_REL) + ')' : '') + ' · IMF PortWatch' };
  sub();
  var liveData = {}, sel = null;
  function paint(){
    clear(w);
    var W = w.clientWidth, H = w.clientHeight; if (!W || !H) return;
    var cv = el('canvas'), dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; w.appendChild(cv);
    var g2 = cv.getContext('2d'); g2.scale(dpr, dpr); g2.font = '11.5px ' + getComputedStyle(document.body).fontFamily; g2.textBaseline = 'middle';
    g2.font = '600 11.5px ' + getComputedStyle(document.body).fontFamily;
    var srcW = Math.max.apply(null, SP_NODES.filter(function(n){ return n.k === 's' }).map(function(n){ return g2.measureText(spName(n).split(': ')[0]).width }));
    var padL = Math.min(W * 0.36, srcW + 24), padR = Math.min(110, W * 0.18), padY = 30, last = EIA_Q.length - 1;
    var P = function(n){ return [padL + n.x * (W - padL - padR), padY + n.y * (H - 2 * padY)] };
    // a label with a quiet background, so lines under it do not get in the way
    var label = function(lines, x, y, align){
      var w0 = 0; lines.forEach(function(l){ g2.font = (l[2] || '11.5px') + ' ' + getComputedStyle(document.body).fontFamily; w0 = Math.max(w0, g2.measureText(l[0]).width) });
      var bx = align === 'right' ? x - w0 - 6 : align === 'center' ? x - w0 / 2 - 3 : x - 3, h = lines.length * 14 + 4;
      g2.fillStyle = 'rgba(20,25,32,0.86)'; g2.fillRect(bx, y - h / 2, w0 + 6, h);
      lines.forEach(function(l, i){ g2.font = (l[2] || '11.5px') + ' ' + getComputedStyle(document.body).fontFamily; g2.fillStyle = l[1]; g2.textAlign = align === 'right' ? 'right' : align === 'center' ? 'center' : 'left'; g2.fillText(l[0], align === 'right' ? x - 3 : x, y - h / 2 + 9 + i * 14) });
      g2.textAlign = 'left'; g2.font = '11.5px ' + getComputedStyle(document.body).fontFamily;
    };
    var by = {}; SP_NODES.forEach(function(n){ by[n.id] = n });
    var vol = function(id){ return EIA[id] ? EIA[id][last] : null };
    var maxV = Math.max.apply(null, Object.keys(EIA).map(vol));
    var lit = function(a, b){ return !sel || a === sel || b === sel };
    SP_EDGES.forEach(function(e){
      var a = by[e[0]], b = by[e[1]], pa = P(a), pb = P(b), v = vol(a.id) || vol(b.id) || 2;
      var wd = Math.max(1, Math.sqrt(v / maxV) * 10), mx_ = (pa[0] + pb[0]) / 2;
      g2.beginPath(); g2.moveTo(pa[0], pa[1]); g2.bezierCurveTo(mx_, pa[1], mx_, pb[1], pb[0], pb[1]);
      g2.strokeStyle = lit(a.id, b.id) ? 'rgba(110,168,255,0.38)' : 'rgba(110,168,255,0.08)'; g2.lineWidth = wd; g2.stroke(); g2.lineWidth = 1;
    });
    SP_NODES.forEach(function(n){
      var p = P(n), nm = spName(n), on = lit(n.id, null) || SP_EDGES.some(function(e){ return (e[0] === sel && e[1] === n.id) || (e[1] === sel && e[0] === n.id) });
      g2.globalAlpha = on ? 1 : 0.35;
      if (n.k === 'c') {
        var bi = eiaBase(), v = vol(n.id), prev = bi == null ? null : EIA[n.id][bi], r = 6 + Math.sqrt(v / maxV) * 16, ch = prev ? (v / prev - 1) * 100 : null;
        g2.beginPath(); g2.arc(p[0], p[1], r, 0, 6.283); g2.fillStyle = ch != null && ch < -15 ? 'rgba(239,83,80,0.85)' : ch != null && ch > 15 ? 'rgba(224,178,60,0.85)' : 'rgba(86,193,214,0.85)'; g2.fill();
        var lines = [[nm, '#e6eaf0', '600 11.5px'], [fmt(v, 1) + ' ' + TX('sp_mbd') + (ch != null ? ' · ' + pct(ch, 0) : ''), ch != null && ch < -15 ? '#ef5350' : '#8b95a7']];
        var lv = liveData[n.id]; if (lv && lv.t7 != null) lines.push([TX('sp_live_s', fmt(lv.t7, 0), lv.tch != null ? pct(lv.tch, 0) : '—'), lv.tch != null && lv.tch < -15 ? '#ef5350' : '#5d6778', '10.5px']);
        label(lines, p[0] + r + 6, p[1], 'left');
      } else {
        g2.fillStyle = n.k === 's' ? '#e0b23c' : '#2fbf71'; g2.beginPath(); g2.arc(p[0], p[1], 4, 0, 6.283); g2.fill();
        var words = nm.split(': ');
        var ll = [[words[0], '#e6eaf0', '600 11.5px']];
        if (words[1]) words[1].match(/.{1,26}(,\s|$)/g).slice(0, 2).forEach(function(w2){ ll.push([w2.replace(/,\s$/, ','), '#8b95a7', '10.5px']) });
        label(ll, n.k === 's' ? p[0] - 8 : p[0] + 8, p[1], n.k === 's' ? 'right' : 'left');
      }
      g2.globalAlpha = 1;
    });
    cv.onclick = function(e){
      var r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, hit = null;
      SP_NODES.forEach(function(n){ var p = P(n); if (Math.hypot(p[0] - x, p[1] - y) < 24) hit = n.id });
      sel = hit === sel ? null : hit; paint(); side();
    };
  }
  function side(){
    clear(sd);
    var h = el('div', 'sh'); h.appendChild(el('span', null, TX('sp_side'))); h.appendChild(el('small', null, EIA_Q[EIA_Q.length - 1])); sd.appendChild(h);
    SP_NODES.filter(function(n){ return n.k === 'c' }).sort(function(a, b){ return EIA[b.id][EIA_Q.length - 1] - EIA[a.id][EIA_Q.length - 1] }).forEach(function(n){
      var v = EIA[n.id], lv = liveData[n.id], row = el('button', 'gm-row' + (sel === n.id ? ' on' : '')), dv = el('div');
      dv.appendChild(el('b', null, spName(n)));
      dv.appendChild(el('span', null, EIA_Q.map(function(q, i){ return q + ' ' + fmt(v[i], 1) }).slice(-4).join(' · ')));
      if (lv && lv.t7 != null) dv.appendChild(el('span', null, TX('sp_live', fmt(lv.t7, 0), lv.tch != null ? pct(lv.tch, 0) : '—')));
      row.appendChild(el('i')); row.firstChild.style.background = '#56c1d6'; row.appendChild(dv);
      row.onclick = function(){ sel = sel === n.id ? null : n.id; paint(); side() };
      sd.appendChild(row);
    });
    var bi = eiaBase(), nt = el('div', 'gm-note'); nt.style.padding = '8px 10px'; nt.textContent = TX('sp_note', bi == null ? null : EIA_Q[bi]); sd.appendChild(nt);
    var a = el('a', null, 'EIA · Short-Term Energy Outlook'); a.href = EIA_SRC; a.target = '_blank'; a.rel = 'noopener'; a.style.cssText = 'display:block;padding:0 10px 10px;color:var(--accent);text-decoration:none;font-size:11.5px'; sd.appendChild(a);
  }
  w.__draw = paint; if (F.canvases().indexOf(w) < 0) F.canvases().push(w);
  paint(); side();
  var here = function(){ return M.tab === 'SPLC' && document.body.contains(w) };
  splcLive().then(function(d){ liveData = d; if (here()) { paint(); side() } });
  loadEia().then(function(fresh){ if (fresh && here()) { sub(); paint(); side() } });
}

/* ---------- SAT: satellite pictures of the main oil storage hubs (sat.py → ../sat.json, ../sat/<hub>/<date>.jpg) ---------- */
var satP = null, satAt = 0, SATV = {site: null, then: null, k: 1, x: 0, y: 0, cut: 50};
function satData(){
  if (!satP || Date.now() - satAt > 600000) {
    satAt = Date.now();
    satP = getJSON('../sat.json?t=' + Math.floor(Date.now() / 600000), 20000).catch(function(e){ satP = null; throw e });
  }
  return satP;
}
function satName(s){ return String((I.xl ? I.xlName('SAT', s.id) || s.name : I.ru ? s.name_ru || s.name : s.name) || s.id) }
// sat.json is the bot's own file, but a picture's path is still checked: only sat/<hub>/<date>.jpg of this site
function satOk(i){ return i && /^sat\/[a-z0-9_-]{1,40}\/\d{4}-\d\d-\d\d\.jpg$/.test(String(i.f || '')) && /^\d{4}-\d\d-\d\d$/.test(String(i.d || '')) }
function satDate(d){ return F.dmy(d) }
function openSat(id){
  if (id) { var x = String(id).toLowerCase(); SATV.site = x; SATV.then = null; SATV.k = 1; SATV.x = SATV.y = 0 }
  else if (id === null) SATV.site = null;
  T.show('p-map'); setMapTab('SAT');
}
function drawSat(){
  var box = $('map-body'); clear(box); box.style.overflow = 'auto'; box.style.flexDirection = 'column';
  var w = el('div', 'sat-wrap'); box.appendChild(w);
  w.appendChild(el('div', 'note', TX('sat_loading')));
  $('map-sub').textContent = 'Copernicus Sentinel-2 · 10 m';
  satData().then(function(d){
    if (M.tab !== 'SAT' || !document.body.contains(w)) return;
    clear(w);
    var sites = (d.sites || []).filter(function(s){ return s && /^[a-z0-9_-]{1,40}$/.test(String(s.id)) && isFinite(+s.lat) && isFinite(+s.lon) && +s.km > 0 })
      .map(function(s){ var c = {}; for (var k in s) c[k] = s[k]; c.lat = +s.lat; c.lon = +s.lon; c.km = +s.km; c.imgs = (s.imgs || []).filter(satOk); return c });
    var cur = SATV.site && sites.filter(function(s){ return s.id === SATV.site })[0];
    if (cur && (cur.imgs || []).length) satDetail(w, cur, sites, d); else { SATV.site = null; satGallery(w, sites, d) }
  }).catch(function(){
    if (M.tab !== 'SAT' || !document.body.contains(w)) return;
    clear(w); w.appendChild(el('div', 'sat-empty', TX('sat_none')));
  });
}
function satGallery(w, sites, d){
  var head = el('div', 'sat-head');
  head.appendChild(el('div', 'sat-lead', TX('sat_lead')));
  w.appendChild(head);
  var grid = el('div', 'sat-grid'); w.appendChild(grid);
  sites.forEach(function(s){
    var imgs = s.imgs || [], last = imgs[imgs.length - 1], card = el('button', 'sat-card' + (last ? '' : ' none'));
    card.type = 'button';
    var pic = el('div', 'sat-pic');
    if (last) { var im = el('img'); im.loading = 'lazy'; im.alt = satName(s); im.src = '../' + last.f; pic.appendChild(im) }
    else pic.appendChild(el('span', 'sat-wait', TX('sat_wait')));
    var cap = el('div', 'sat-cap');
    cap.appendChild(el('b', null, satName(s)));
    cap.appendChild(el('span', null, last ? TX('sat_taken', satDate(last.d)) + (imgs.length > 1 ? ' · ' + TX('sat_n', imgs.length) : '') : '—'));
    pic.appendChild(cap); card.appendChild(pic);
    if (last) card.onclick = function(){ SATV.site = s.id; SATV.then = null; SATV.k = 1; SATV.x = SATV.y = 0; drawSat() };
    grid.appendChild(card);
  });
  var nt = el('div', 'note sat-note'); nt.textContent = TX('sat_note'); w.appendChild(nt);
  var src = el('div', 'note'); src.textContent = (d.src || 'Contains modified Copernicus Sentinel data') + (d.updated ? ' · ' + TX('sat_upd', satDate(d.updated.slice(0, 10))) : ''); w.appendChild(src);
}
// one hub: "then" and "now" on top of each other, a handle to slide between them; wheel or buttons to zoom, drag to move
function satDetail(w, s, sites, d){
  var imgs = s.imgs, now_ = imgs[imgs.length - 1], olds = imgs.slice(0, -1);
  var then = olds.filter(function(i){ return i.d === SATV.then })[0] || olds[0] || null;
  var bar = el('div', 'sat-bar');
  var back = el('button', 'chipbtn', '◀ ' + TX('sat_all')); back.onclick = function(){ SATV.site = null; drawSat() }; bar.appendChild(back);
  bar.appendChild(el('b', 'sat-title', satName(s)));
  var sel = el('div', 'sat-sel');
  sites.forEach(function(x){ if (!(x.imgs || []).length || x.id === s.id) return; var b = el('button', 'chipbtn', satName(x).split(/[:(,]/)[0].trim()); b.onclick = function(){ SATV.site = x.id; SATV.then = null; SATV.k = 1; SATV.x = SATV.y = 0; drawSat() }; sel.appendChild(b) });
  w.appendChild(bar); w.appendChild(sel);
  var stage = el('div', 'sat-stage'), inner = el('div', 'sat-inner');
  var a = el('img', 'sat-a'), bwrap = el('div', 'sat-b'), b = el('img');
  a.alt = b.alt = satName(s); a.draggable = b.draggable = false;
  b.src = '../' + now_.f; bwrap.appendChild(b);
  if (then) { a.src = '../' + then.f; inner.appendChild(a) }
  inner.appendChild(bwrap); stage.appendChild(inner);
  var handle = el('div', 'sat-handle'); handle.appendChild(el('i')); if (then) stage.appendChild(handle);
  var lt = el('span', 'sat-lbl l', then ? TX('sat_then', satDate(then.d)) : ''), rt = el('span', 'sat-lbl r', TX('sat_now', satDate(now_.d)));
  if (then) stage.appendChild(lt); stage.appendChild(rt);
  // a 1 km scale bar: the picture is s.km wide
  var sc = el('div', 'sat-scale'); sc.appendChild(el('i')); sc.appendChild(el('span', null, '1 ' + TX('sat_km'))); stage.appendChild(sc);
  var zc = el('div', 'zctl sat-z');
  [['−', 1 / 1.4], ['＋', 1.4], ['⟲', 0]].forEach(function(z){ var bt = el('button', 'chipbtn zb', z[0]); bt.type = 'button'; bt.onclick = function(e){ e.stopPropagation(); zoom(z[1], 0.5, 0.5) }; zc.appendChild(bt) });
  stage.appendChild(zc);
  w.appendChild(stage);
  function apply(){
    SATV.k = Math.max(1, Math.min(6, SATV.k));
    var lim = (SATV.k - 1) / (2 * SATV.k);   // how far the picture may move (as a share of its width) before an edge shows
    SATV.x = Math.max(-lim, Math.min(lim, SATV.x)); SATV.y = Math.max(-lim, Math.min(lim, SATV.y));
    inner.style.transform = 'scale(' + SATV.k + ') translate(' + (SATV.x * 100) + '%,' + (SATV.y * 100) + '%)';
    // the cut is a place on the screen; the clipped picture is inside the zoomed layer — so it is converted
    var cutIn = 50 + ((SATV.cut - 50) / SATV.k) - SATV.x * 100;
    bwrap.style.clipPath = then ? 'inset(0 0 0 ' + Math.max(0, Math.min(100, cutIn)) + '%)' : 'none';
    handle.style.left = SATV.cut + '%';
    var kmPx = stage.clientWidth / s.km * SATV.k; sc.firstChild.style.width = Math.round(kmPx) + 'px';
  }
  function zoom(f, fx, fy){
    if (!f) { SATV.k = 1; SATV.x = SATV.y = 0; return apply() }
    var k0 = SATV.k, k1 = Math.max(1, Math.min(6, k0 * f));
    // the point under the cursor stays where it is
    SATV.x += (fx - 0.5) * (1 / k1 - 1 / k0); SATV.y += (fy - 0.5) * (1 / k1 - 1 / k0); SATV.k = k1; apply();
  }
  stage.addEventListener('wheel', function(e){ e.preventDefault(); var r = stage.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.25 : 0.8, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height) }, {passive: false});
  stage.addEventListener('dblclick', function(){ zoom(0) });
  var drag = null;
  stage.addEventListener('pointerdown', function(e){
    if (e.target.closest('.zctl')) return;
    var r = stage.getBoundingClientRect(), onHandle = then && Math.abs(e.clientX - (r.left + r.width * SATV.cut / 100)) < 18;
    drag = {cut: onHandle || (then && SATV.k === 1), x0: e.clientX, y0: e.clientY, sx: SATV.x, sy: SATV.y, r: r};
    try { stage.setPointerCapture(e.pointerId) } catch(err){}
    if (drag.cut) { SATV.cut = Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100)); apply() }
    stage.classList.add(drag.cut ? 'cutting' : 'moving');
  });
  stage.addEventListener('pointermove', function(e){
    if (!drag) return;
    if (drag.cut) SATV.cut = Math.max(0, Math.min(100, (e.clientX - drag.r.left) / drag.r.width * 100));
    else { SATV.x = drag.sx + (e.clientX - drag.x0) / drag.r.width / SATV.k; SATV.y = drag.sy + (e.clientY - drag.y0) / drag.r.height / SATV.k }
    apply();
  });
  var up = function(){ drag = null; stage.classList.remove('cutting', 'moving') };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  // which older picture to compare with
  if (olds.length > 1) {
    var ch = el('div', 'gm-chips sat-dates'); ch.appendChild(el('span', 'sat-dl', TX('sat_cmp')));
    olds.slice().reverse().forEach(function(i){ var bt = el('button', 'chipbtn' + (then && i.d === then.d ? ' on' : ''), satDate(i.d)); bt.onclick = function(){ SATV.then = i.d; drawSat() }; ch.appendChild(bt) });
    w.appendChild(ch);
  }
  var info = el('div', 'sat-info');
  info.appendChild(el('span', null, TX('sat_meta', satDate(now_.d), now_.t || '', now_.cloud != null ? fmt(now_.cloud, 0) : '—', s.km)));
  var links = el('span', 'sat-links');
  var mp = el('button', 'chipbtn', TX('sat_onmap')); mp.onclick = function(){ M.on.SHIP.oilst = 1; saveOn(); openMap('SHIP'); flyTo(s.lon, s.lat, 60) }; links.appendChild(mp);
  var cb = el('a', 'chipbtn', 'Copernicus Browser ↗'); cb.href = 'https://browser.dataspace.copernicus.eu/?zoom=13&lat=' + s.lat + '&lng=' + s.lon; cb.target = '_blank'; cb.rel = 'noopener'; links.appendChild(cb);
  info.appendChild(links); w.appendChild(info);
  var nt = el('div', 'note sat-note'); nt.textContent = TX(then ? 'sat_how' : 'sat_how1'); w.appendChild(nt);
  var sn = el('div', 'note'); sn.textContent = d.src || 'Contains modified Copernicus Sentinel data'; w.appendChild(sn);   // the attribution Copernicus asks for
  var go = function(){ if (stage.clientWidth) apply(); else requestAnimationFrame(go) };
  b.onload = go; go();
  $('map-sub').textContent = 'Copernicus Sentinel-2 · ' + satName(s);
}
// the hubs on the map (the oil storage layer): a click opens their pictures
function satPoints(){
  return satData().then(function(d){
    return (d.sites || []).filter(function(s){ return (s.imgs || []).filter(satOk).length && isFinite(+s.lat) && isFinite(+s.lon) }).map(function(s){
      var last = s.imgs.filter(satOk).slice(-1)[0];
      return {lon: s.lon, lat: s.lat, r: 5, c: '#8fd3ff', ring: true, t: '🛰 ' + satName(s), k: 'sat', s: [TX('sat_taken', satDate(last.d)), TX('sat_click')],
        lbl: '🛰 ' + satName(s).split(/[:(,]/)[0].trim(), act: function(){ openSat(s.id) }};
    });
  }).catch(function(){ return [] });
}

/* ---------- Open-Meteo: weather in the big cities ---------- */
function loadWeather(){
  var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + CITIES.map(function(c){ return c[2] }).join(',') +
    '&longitude=' + CITIES.map(function(c){ return c[3] }).join(',') +
    '&current=temperature_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days=7&timezone=auto';
  return live(url, true).then(function(arr){
    if (!Array.isArray(arr)) arr = [arr];
    var rows = arr.map(function(w, i){
      var c = CITIES[i], d = w.daily || {}, mx_ = d.temperature_2m_max || [], mn = d.temperature_2m_min || [];
      var avg = mx_.map(function(v, j){ return v != null && mn[j] != null ? (v + mn[j]) / 2 : null }).filter(function(v){ return v != null });
      var mean = avg.length ? avg.reduce(function(a, b){ return a + b }, 0) / avg.length : null;
      var hdd = avg.reduce(function(a, v){ return a + Math.max(0, 18 - v) }, 0), cdd = avg.reduce(function(a, v){ return a + Math.max(0, v - 18) }, 0);
      return {name: nm2(c), lon: c[3], lat: c[2], now: w.current && w.current.temperature_2m, wind: w.current && w.current.wind_speed_10m, code: w.current && w.current.weather_code,
        tmax: mx_[0], tmin: mn[0], mean: mean, hdd: hdd, cdd: cdd, days: mx_.map(function(v, j){ return [d.time && d.time[j], v, mn[j]] }), rain: (d.precipitation_sum || []).reduce(function(a, v){ return a + (v || 0) }, 0)};
    });
    M.wxRows = rows;
    return {pts: rows.map(wxPoint), rows: rows};
  });
}
var WX_CODE = {0: '☀', 1: '🌤', 2: '⛅', 3: '☁', 45: '🌫', 48: '🌫', 51: '🌦', 53: '🌦', 55: '🌦', 61: '🌧', 63: '🌧', 65: '🌧', 71: '🌨', 73: '🌨', 75: '❄', 80: '🌦', 81: '🌧', 82: '⛈', 95: '⛈', 96: '⛈', 99: '⛈'};
function wxValue(r){ return M.wx === 'mean' ? r.mean : M.wx === 'hdd' ? r.hdd : M.wx === 'cdd' ? r.cdd : r.now }
function wxPoint(r){
  var v = wxValue(r), col = M.wx === 'hdd' ? sequential(r.hdd, 0, 140, true) : M.wx === 'cdd' ? sequential(r.cdd, 0, 100) : tempCol(v);
  var label = M.wx === 'hdd' || M.wx === 'cdd' ? fmt(v, 0) : (v > 0 ? '+' : '') + fmt(v, 0) + '°';
  return {lon: r.lon, lat: r.lat, r: 5.5, c: col, ring: true, t: (WX_CODE[r.code] || '') + ' ' + r.name, lbl: r.name + ' ' + label, minLbl: 1.4,
    s: [TX('gm_wx_now', fmt(r.now, 1), fmt(r.wind, 0)), TX('gm_wx_today', fmt(r.tmin, 0), fmt(r.tmax, 0)), TX('gm_wx_week', fmt(r.mean, 1), fmt(r.hdd, 0), fmt(r.cdd, 0))], k: 'wx'};
}

/* ======================= countries: base map and the ECO colouring ======================= */
var world = null;
function loadWorld(){
  if (world) return Promise.resolve(world);
  return geo('world.json').then(function(d){
    var q = d.q, land = new Path2D(), byIso = {};
    d.c.forEach(function(c){
      var p = new Path2D();
      c[5].forEach(function(r){
        var x = r[0], y = r[1];
        p.moveTo(mx(x / q), my(y / q));
        for (var i = 2; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; p.lineTo(mx(x / q), my(y / q)) }
        p.closePath();
      });
      land.addPath(p);
      byIso[c[0]] = {iso: c[0], en: c[1], ru: c[2], lx: c[3], ly: c[4], path: p};
    });
    world = {land: land, c: byIso, list: Object.keys(byIso).map(function(k){ return byIso[k] })};
    return world;
  });
}
var ECO_IND = [
  {k: 'NGDP_RPCH', div: 4, fmt: 1, unit: '%'}, {k: 'PCPIPCH', seq: [0, 15], fmt: 1, unit: '%'}, {k: 'LUR', seq: [2, 15], fmt: 1, unit: '%'},
  {k: 'GGXWDG_NGDP', seq: [20, 150], fmt: 0, unit: '%'}, {k: 'BCA_NGDPD', div: 6, fmt: 1, unit: '%'}, {k: 'GGXCNL_NGDP', div: 6, fmt: 1, unit: '%'},
  {k: 'CB', seq: [0, 20], fmt: 2, unit: '%'}, {k: 'Y10', seq: [0, 15], fmt: 2, unit: '%'}, {k: 'MKT', div: 2, fmt: 2, unit: '%'}
];
var eco = {vals: {}, note: ''};
function ecoValues(){
  var k = M.eco;
  if (k === 'MKT') {
    var v = {}; Object.keys(IDX_ISO).forEach(function(id){ var q = T.Q[id]; if (q && q.change != null) v[IDX_ISO[id]] = q.change });
    return Promise.resolve({v: v, note: TX('gm_eco_mkt_note')});
  }
  if (k === 'CB' || k === 'Y10') return F.page('rates.json', 600).then(function(d){
    var v = {};
    if (k === 'CB') (d.cb || []).forEach(function(c){ var iso = ISO2[c.c]; if (c.c === 'XM' || c.c === 'EA' || c.c === 'EU') EURO.forEach(function(e){ if (v[e] == null) v[e] = c.rate }); else if (iso) v[iso] = c.rate });
    else Object.keys(d.curves || {}).forEach(function(c){ var cv = d.curves[c], i = cv.t.indexOf('10Y'), iso = ISO2[c]; if (i >= 0 && iso) v[iso] = cv.y[i] });
    return {v: v, note: TX(k === 'CB' ? 'gm_eco_cb_note' : 'gm_eco_y10_note')};
  });
  return F.page('macro.json', 3600).then(function(d){
    var v = {}, y = new Date().getUTCFullYear(), yi = (d.years || []).indexOf(y);
    var m = d.map && d.map[k];
    if (m) Object.keys(m).forEach(function(iso){ v[iso] = m[iso] });
    else (d.rows || []).forEach(function(r){ var a = (r.v || {})[k]; if (a && a[yi] != null && r.c.length === 3 && !/^WEO|^ADV|^OEM|^EURO/.test(r.c)) v[r.c] = a[yi] });
    return {v: v, note: TX('gm_eco_imf_note', d.map && d.map.year || y)};
  });
}
function ecoColor(iso){
  var ind = ECO_IND.filter(function(x){ return x.k === M.eco })[0] || ECO_IND[0], v = eco.vals[iso];
  if (v == null) return null;
  if (ind.div) return diverging(v, ind.div);
  return sequential(v, ind.seq[0], ind.seq[1]);
}
function loadEco(){
  var key = M.eco;
  ecoValues().then(function(r){ if (key !== M.eco) return; eco.vals = r.v; eco.note = r.note; renderSide(); redraw() })
    .catch(function(e){ eco.vals = {}; eco.note = TX('load_fail') + e.message; renderSide(); redraw() });
}

/* ======================= drawing ======================= */
var box, wrap, cv, g, side, tip;   // (bgc, bg: the picture's canvas, see drawBase)
function build(){
  box = $('map-body'); clear(box); box.style.overflow = ''; box.style.flexDirection = '';   // SPLC may have changed them
  wrap = el('div', 'gm-wrap'); bgc = el('canvas', 'gm-bg'); cv = el('canvas'); wrap.appendChild(bgc); wrap.appendChild(cv);
  var ctl = el('div', 'gm-ctl');
  [['+', function(){ zoomAt(M.W / 2, M.H / 2, 1.6) }, 'gm_zin'], ['−', function(){ zoomAt(M.W / 2, M.H / 2, 1 / 1.6) }, 'gm_zout'], ['⌂', home, 'gm_home'],
    ['☰', function(){ M.sideOpen = !M.sideOpen; box.classList.toggle('side-open', M.sideOpen) }, 'gm_layers']].forEach(function(b){
    var x = el('button', b[0] === '☰' ? 'gm-tbtn' : null, b[0]); x.title = TX(b[2]); x.onclick = function(e){ e.stopPropagation(); b[1]() }; ctl.appendChild(x);
  });
  wrap.appendChild(ctl);
  // the picture under the map: satellite (darkened, with city lights), day, night or the plain scheme
  var bm = el('div', 'gm-base');
  BASES.forEach(function(b){ var x = el('button', 'chipbtn' + (M.base === b ? ' on' : ''), TX('gm_base_' + b)); x.dataset.b = b; x.onclick = function(e){ e.stopPropagation(); setBase(b) }; bm.appendChild(x) });
  wrap.appendChild(bm);
  M.legend = el('div', 'gm-leg'); wrap.appendChild(M.legend);
  M.att = el('div', 'gm-att'); wrap.appendChild(M.att);
  box.appendChild(wrap);
  side = el('div', 'gm-side'); box.appendChild(side);
  g = cv.getContext('2d'); bg = bgc.getContext('2d'); baseMeta();
  tip = $('tm-tip');
  bindInput();
  if (window.ResizeObserver) new ResizeObserver(function(){ resize() }).observe(wrap);
  M.built = true;
}
function resize(){
  if (!wrap) return;
  var W = wrap.clientWidth, H = wrap.clientHeight;
  if (!W || !H) return;
  var first = !M.W;
  M.dpr = window.devicePixelRatio || 1;
  cv.width = bgc.width = Math.round(W * M.dpr); cv.height = bgc.height = Math.round(H * M.dpr);
  // the smallest scale (and the first view): the whole world fits in the panel's width
  var S0 = W;
  if (first || !M.S) { M.S0 = S0; restoreView() } else { M.S = M.S * (S0 / M.S0); M.S0 = S0 }
  M.W = W; M.H = H;
  box.classList.toggle('narrow', W + (side && side.offsetWidth || 0) < 620);
  clampView(); draw();
}
function home(){ M.S = M.S0; M.cx = mx(15); M.cy = (my(80) + my(-58)) / 2; clampView(); saveView(); redraw() }
function restoreView(){
  M.S = M.S0; M.cx = mx(15); M.cy = (my(80) + my(-58)) / 2;
  try { var v = JSON.parse(store('map_view') || 'null'); if (v && v.z >= 1 && v.z < 400) { M.S = M.S0 * v.z; M.cx = v.x; M.cy = v.y } } catch(e){}
}
function saveView(){ clearTimeout(M.svT); M.svT = setTimeout(function(){ store('map_view', JSON.stringify({z: M.S / M.S0, x: M.cx, y: M.cy})) }, 400) }
function clampView(){
  if (M.S < M.S0) M.S = M.S0;
  if (M.S > M.S0 * 300) M.S = M.S0 * 300;
  M.cx = ((M.cx % 1) + 1) % 1;
  var half = M.H / 2 / M.S, top = my(LAT_MAX), bot = my(-LAT_MAX);
  if (bot - top <= 2 * half) M.cy = (top + bot) / 2; else M.cy = Math.max(top + half, Math.min(bot - half, M.cy));
}
/* ---------- the picture under the map: satellite tiles ----------
   NASA GIBS (public domain): Blue Marble with relief and sea floor (to zoom 8, ~500 m) and the Earth at night
   (VIIRS city lights 2012); closer in, EOxCloudless 2016 (Sentinel-2, 10 m, to zoom 14) — the only year EOX licenses
   under CC BY 4.0, so it may be used commercially with the attribution below the map (2018 and later years are
   CC BY-NC-SA: not for commercial use without EOX's paid licence). If it does not answer, Blue Marble stays. The tiles are drawn on their own canvas under the map's, so nothing from other sites is ever read
   back from the map's canvas; the service worker does not keep them (other sites' files are not cached). */
var BASES = ['sat', 'day', 'night', 'scheme'];
var GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/';
var TILESRC = {
  day: {max: 8, urls: [GIBS + 'BlueMarble_ShadedRelief_Bathymetry/default//GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg',
                       GIBS + 'BlueMarble_ShadedRelief_Bathymetry/default//GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
                       GIBS + 'BlueMarble_NextGeneration/default//GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg']},
  lights: {max: 8, urls: [GIBS + 'VIIRS_CityLights_2012/default//GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg']},
  close: {min: 9, max: 14, urls: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg']}
};
var TILES = new Map(), bgc = null, bg = null;
M.base = BASES.indexOf(store('map_base')) >= 0 ? store('map_base') : 'sat';
function setBase(b){
  M.base = b; store('map_base', b);
  if (wrap) wrap.querySelectorAll('.gm-base button').forEach(function(x){ x.classList.toggle('on', x.dataset.b === b) });
  redraw();
}
function tileUrl(src, z, x, y, local){ var s = TILESRC[src], u = local ? s.local : s.urls[s.alt || 0]; return u.replace('{z}', z).replace('{y}', y).replace('{x}', x) }
// the overview zooms are copied to this site by the bot (basemap.py → ../base/): they come first, NASA after them;
// its meta.json also says which NASA address works (the browser need not find out by failing)
var baseMetaP = null;
function baseMeta(){
  if (!baseMetaP) baseMetaP = getJSON('../base/meta.json', 15000).then(function(m){
    var L = (m && m.layers) || {};
    Object.keys(L).forEach(function(name){
      var s = TILESRC[name], l = L[name] || {}; if (!s || !/^(jpg|png)$/.test(l.ext || '') || !(l.max >= 0)) return;
      s.local = '../base/' + name + '/{z}/{y}/{x}.' + l.ext; s.localMax = Math.min(8, l.max);
      var i = s.urls.indexOf(l.url); if (i >= 0) { s.alt = i; s.good = true }
      s.dead = false; s.fails = 0;
    });
    TILES.clear(); redraw();
  }).catch(function(){});
  return baseMetaP;
}
// one tile: an image that is loading, loaded or failed; at most ~600 kept (the oldest go first)
function tile(src, z, x, y){
  var key = src + '/' + z + '/' + x + '/' + y, t = TILES.get(key);
  if (t) { TILES.delete(key); TILES.set(key, t); return t }   // the newest at the end
  var S_ = TILESRC[src];
  t = {img: new Image(), ok: false, bad: false, local: !!(S_.local && z <= S_.localMax)};
  t.img.decoding = 'async'; t.img.referrerPolicy = 'no-referrer';
  t.img.onload = function(){ t.ok = true; redraw() };
  t.img.onerror = function(){
    if (t.local) { t.local = false; t.img.src = tileUrl(src, z, x, y); return }   // not on this site: NASA's copy
    t.bad = true;
    // the first tiles of a source fail: its next address (some servers name the format .jpeg, some layers moved)
    var s = TILESRC[src]; s.fails = (s.fails || 0) + 1;
    if (!s.good && s.fails >= 4 && (s.alt || 0) < s.urls.length - 1) { s.alt = (s.alt || 0) + 1; s.fails = 0; TILES.forEach(function(v, k){ if (k.indexOf(src + '/') === 0 && v.bad) TILES.delete(k) }); redraw() }
    // every address failed (offline, or the service is down): the map draws its own land again
    else if (!s.good && !s.any && s.fails >= 4 && !s.dead) { s.dead = true; redraw() }
  };
  t.img.addEventListener('load', function(){ var s = TILESRC[src]; if (!t.local) s.good = true; s.any = true; s.dead = false });
  t.img.src = tileUrl(src, z, x, y, t.local);
  TILES.set(key, t);
  if (TILES.size > 600) { var first = TILES.keys().next().value; TILES.delete(first) }
  return t;
}
// draws one source's tiles over the view; a tile not loaded yet is stood in for by a part of its parent
function drawTiles(src, z, alphaV){
  var S = M.S, W = M.W, H = M.H, n = Math.pow(2, z), size = S / n;
  var y0 = Math.max(0, Math.floor((M.cy - H / 2 / S) * n)), y1 = Math.min(n - 1, Math.floor((M.cy + H / 2 / S) * n));
  var x0 = Math.floor((M.cx - W / 2 / S) * n), x1 = Math.floor((M.cx + W / 2 / S) * n);
  bg.globalAlpha = alphaV;
  for (var ty = y0; ty <= y1; ty++) for (var tx = x0; tx <= x1; tx++) {
    var wx = ((tx % n) + n) % n, px_ = Math.floor(sx(tx / n)), py_ = Math.floor(sy(ty / n)), sz = Math.ceil(size) + 1;
    var t = tile(src, z, wx, ty);
    if (t.ok) { bg.drawImage(t.img, px_, py_, sz, sz); continue }
    // the nearest loaded ancestor tile, cut to this tile's part, until this one arrives (or when it never does:
    // NASA out of reach — the site's own overview tiles, enlarged)
    for (var up = 1; z - up >= (TILESRC[src].min || 0) && up <= 8; up++) {
      var f = Math.pow(2, up), pt = TILES.get(src + '/' + (z - up) + '/' + Math.floor(wx / f) + '/' + Math.floor(ty / f));
      if (pt && pt.ok) { var part = 256 / f; bg.drawImage(pt.img, (wx % f) * part, (ty % f) * part, part, part, px_, py_, sz, sz); break }
    }
    // the site's own copy of the area, asked for once, so there is always something under a closer view
    var S_ = TILESRC[src];
    if (S_.local && z > S_.localMax) { var fl_ = Math.pow(2, z - S_.localMax); tile(src, S_.localMax, Math.floor(wx / fl_), Math.floor(ty / fl_)) }
  }
  bg.globalAlpha = 1;
}
function drawBase(on){
  if (!bg) return;
  var W = M.W, H = M.H;
  bg.setTransform(M.dpr, 0, 0, M.dpr, 0, 0); bg.globalCompositeOperation = 'source-over';
  bg.fillStyle = '#05070b'; bg.fillRect(0, 0, W, H);
  bgc.style.display = on ? '' : 'none';
  if (!on) return;
  // the tile zoom: a tile pixel no bigger than a screen pixel
  var zw = Math.max(0, Math.ceil(Math.log2(M.S * M.dpr / 256) - 0.15)), b = M.base;
  if (b !== 'night') {
    var dz = Math.min(TILESRC.day.max, zw);
    // the darkened day picture under the city lights (the look of a night-side Earth); brighter for "day"
    drawTiles('day', dz, b === 'day' ? 1 : 0.62);
    if (zw >= TILESRC.close.min && !TILESRC.close.dead) drawTiles('close', Math.min(TILESRC.close.max, zw), b === 'day' ? 1 : 0.7);
    if (b === 'sat') { bg.globalCompositeOperation = 'screen'; drawTiles('lights', Math.min(TILESRC.lights.max, zw), zw >= 10 ? 0.35 : 0.85); bg.globalCompositeOperation = 'source-over' }
  } else {
    drawTiles('lights', Math.min(TILESRC.lights.max, zw), 1);
  }
  // a soft vignette, so the edges recede like on the globe
  var gr = bg.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.35)'); bg.fillStyle = gr; bg.fillRect(0, 0, W, H);
}
function baseAtt(){
  if (M.tab === 'ECO' || M.base === 'scheme') return '';
  var z = M.S ? Math.ceil(Math.log2(M.S * (M.dpr || 1) / 256) - 0.15) : 0;
  return 'NASA EOSDIS GIBS' + (z >= TILESRC.close.min && M.base !== 'night' && !TILESRC.close.dead
    ? ' · EOxCloudless 2016 https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017), CC BY 4.0' : '');
}
function sx(fx){ return (fx - M.cx) * M.S + M.W / 2 }
function sy(fy){ return (fy - M.cy) * M.S + M.H / 2 }
function copies(){   // which horizontal copies of the world are on screen
  var out = [], k0 = Math.floor(M.cx - M.W / 2 / M.S), k1 = Math.floor(M.cx + M.W / 2 / M.S);
  for (var k = k0; k <= k1; k++) out.push(k);
  return out;
}
function redraw(){ if (!M.raf) M.raf = requestAnimationFrame(function(){ M.raf = 0; draw() }) }
function zf(){ return Math.min(3.2, Math.pow(M.S / M.S0, 0.35)) }
function draw(){
  if (!g || !M.W || !F.visible('p-map')) return;
  var W = M.W, H = M.H, S = M.S, dpr = M.dpr, ks = copies();
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  var pic = M.tab !== 'ECO' && M.base !== 'scheme' && !(M.base === 'night' ? TILESRC.lights : TILESRC.day).dead;
  drawBase(pic);
  if (pic) g.clearRect(0, 0, W, H); else { g.fillStyle = '#0b0e13'; g.fillRect(0, 0, W, H) }
  if (world) {
    ks.forEach(function(k){
      g.setTransform(dpr * S, 0, 0, dpr * S, dpr * ((k - M.cx) * S + W / 2), dpr * (H / 2 - M.cy * S));
      if (M.tab === 'ECO') {
        world.list.forEach(function(c){ g.fillStyle = ecoColor(c.iso) || '#15191e'; g.fill(c.path) });
        if (M.hoverIso && world.c[M.hoverIso]) { g.lineWidth = 2 / S; g.strokeStyle = '#f2cc60'; g.stroke(world.c[M.hoverIso].path) }
      } else if (!pic) { g.fillStyle = '#161c24'; g.fill(world.land) }
      g.lineWidth = (pic ? 0.5 : 0.6) / S; g.strokeStyle = M.tab === 'ECO' ? '#0b0e13' : pic ? 'rgba(220,230,245,.22)' : '#2c3542'; g.stroke(world.land);
    });
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  var z = zf(), act = active(), labels = [];
  act.forEach(function(id){
    var d = M.data[id]; if (!d) return;
    (d.polys || []).forEach(function(pg){
      ks.forEach(function(k){
        g.beginPath();
        pg.f.forEach(function(r){ r.forEach(function(p, i){ var x = sx(p[0] + k), y = sy(p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y) }); g.closePath() });
        g.globalAlpha = pg.a || 0.16; g.fillStyle = pg.c; g.fill(); g.globalAlpha = 0.35; g.strokeStyle = pg.c; g.lineWidth = 0.8; g.stroke(); g.globalAlpha = 1;
      });
    });
    (d.lines || []).forEach(function(l){
      ks.forEach(function(k){
        g.beginPath();
        l.f.forEach(function(p, i){ var x = sx(p[0] + k), y = sy(p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y) });
        g.strokeStyle = l.c; g.lineWidth = l.w || 1.4; g.setLineDash(l.dash || []); g.stroke(); g.setLineDash([]);
      });
    });
  });
  act.forEach(function(id){
    var d = M.data[id]; if (!d || !d.pts) return;
    if (d.ships) return drawShips(g, d, M.off[id] || null, ks, z, W, H, labels);
    var dense = d.pts.length > 3000;
    if (dense) g.globalCompositeOperation = 'lighter';
    var fuelOff = M.off[id] || null;
    for (var i = d.pts.length - 1; i >= 0; i--) {   // big ones first, small ones on top
      var p = d.pts[i];
      if (fuelOff && fuelOff[p.fuel]) continue;
      var y = sy(p.fy); if (y < -20 || y > H + 20) continue;
      for (var j = 0; j < ks.length; j++) {
        var x = sx(p.fx + ks[j]); if (x < -20 || x > W + 20) continue;
        var r = p.r * (dense ? Math.min(2.2, z) : z);
        g.fillStyle = p.c;
        if (dense) { g.globalAlpha = 0.75; if (r < 1.6) g.fillRect(x - r, y - r, r * 2, r * 2); else { g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill() } }
        else if (p.k === 'storm') drawStorm(g, x, y, r, p);
        else {
          g.globalAlpha = p.ring ? 0.85 : 0.9; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
          if (p.ring) { g.globalAlpha = 1; g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.8)'; g.stroke() }
        }
        if (p.hd != null && zf() > 1.8) { var ang = (p.hd - 90) * Math.PI / 180; g.globalAlpha = 0.9; g.strokeStyle = p.c; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * r * 3.2, y + Math.sin(ang) * r * 3.2); g.stroke() }
        if (p.lbl && (!p.minLbl || M.S / M.S0 >= p.minLbl)) labels.push({x: x, y: y, r: r, t: p.lbl, c: p.c});
      }
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  });
  if (M.hover && M.hover.p) {   // highlight under the cursor
    if (M.hover.p.k === 'ship') drawShipPath(g, M.hover.p, ks, true);
    var hp = M.hover.p; g.strokeStyle = '#f2cc60'; g.lineWidth = 2; g.beginPath(); g.arc(M.hover.x, M.hover.y, Math.max(5, hp.r * z + 3), 0, 6.2832); g.stroke();
  }
  // labels: the ones that do not overlap
  g.font = '11px ' + getComputedStyle(document.body).fontFamily; g.textBaseline = 'middle';
  var placed = [];
  labels.forEach(function(L){
    var w = g.measureText(L.t).width, x = L.x + L.r + 4, y = L.y;
    if (x + w > W - 4) x = L.x - L.r - 4 - w;
    var box_ = [x - 2, y - 8, x + w + 2, y + 8];
    if (placed.some(function(b){ return !(box_[2] < b[0] || box_[0] > b[2] || box_[3] < b[1] || box_[1] > b[3]) })) return;
    placed.push(box_);
    g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(box_[0], box_[1], box_[2] - box_[0], 16);
    g.fillStyle = '#e6eaf0'; g.fillText(L.t, x, y);
  });
  if (M.tab === 'ECO' && world) {   // values on the biggest countries
    g.font = '10px ' + getComputedStyle(document.body).fontFamily; g.textAlign = 'center';
    var ind = ECO_IND.filter(function(x){ return x.k === M.eco })[0] || ECO_IND[0];
    world.list.forEach(function(c){
      var v = eco.vals[c.iso]; if (v == null) return;
      ks.forEach(function(k){
        var x = sx(mx(c.lx) + k), y = sy(my(c.ly)); if (x < 0 || x > W || y < 0 || y > H) return;
        var t = fmt(v, ind.fmt);
        if (placed.some(function(b){ return x > b[0] - 12 && x < b[2] + 12 && y > b[1] - 6 && y < b[3] + 6 })) return;
        placed.push([x - 14, y - 6, x + 14, y + 6]);
        g.fillStyle = 'rgba(0,0,0,.55)'; g.fillText(t, x + 1, y + 1); g.fillStyle = '#fff'; g.fillText(t, x, y);
      });
    });
    g.textAlign = 'left';
  }
  renderOverlay();
}
function renderOverlay(){
  var act = active(), src = [];
  act.forEach(function(id){ var s = (M.data[id] && M.data[id].src) || LAYERS[id].src; if (s && src.indexOf(s) < 0) src.push(s) });
  if (M.tab === 'ECO') src.push(M.eco === 'MKT' ? '' : M.eco === 'CB' ? 'BIS / central banks' : M.eco === 'Y10' ? TX('gm_src_curves') : 'IMF WEO');
  src.push('Natural Earth'); src.push(baseAtt());
  M.att.textContent = src.filter(Boolean).join(' · ');
  // legend
  clear(M.legend);
  var L = M.legend, add = function(c, t){ var s = el('div'); var i = el('i'); i.style.background = c; s.appendChild(i); s.appendChild(document.createTextNode(t)); L.appendChild(s) };
  if (M.tab === 'ECO') {
    var ind = ECO_IND.filter(function(x){ return x.k === M.eco })[0] || ECO_IND[0];
    L.appendChild(el('b', null, ecoName(M.eco)));
    var bar = el('div', 'gm-grad'), lo, hi;
    if (ind.div) { lo = -ind.div; hi = ind.div; bar.style.background = 'linear-gradient(90deg,' + diverging(lo, ind.div) + ',' + diverging(0, ind.div) + ',' + diverging(hi, ind.div) + ')' }
    else { lo = ind.seq[0]; hi = ind.seq[1]; bar.style.background = 'linear-gradient(90deg,' + sequential(lo, lo, hi) + ',' + sequential((lo + hi) / 2, lo, hi) + ',' + sequential(hi, lo, hi) + ')' }
    L.appendChild(bar);
    var ends = el('div', 'gm-ends'); ends.appendChild(el('span', null, (ind.div ? '≤' : '≤') + fmt(lo, 0) + ind.unit)); ends.appendChild(el('span', null, '≥' + fmt(hi, 0) + ind.unit)); L.appendChild(ends);
  } else if (M.tab === 'WETR') {
    L.appendChild(el('b', null, TX('gm_wx_' + M.wx + '_t')));
    if (M.wx === 'now' || M.wx === 'mean') { var b2 = el('div', 'gm-grad'); b2.style.background = 'linear-gradient(90deg,' + [-30, -10, 0, 10, 20, 30, 40].map(tempCol).join(',') + ')'; L.appendChild(b2);
      var e2 = el('div', 'gm-ends'); e2.appendChild(el('span', null, '−30°')); e2.appendChild(el('span', null, '+40°')); L.appendChild(e2) }
  } else {
    act.forEach(function(id){
      if (id === 'plants') return add(LAYERS[id].color, TX('gm_l_plants'));
      add(LAYERS[id].color, TX('gm_l_' + id));
    });
    if (act.indexOf('quakes') >= 0) L.appendChild(el('div', 'gm-note', TX('gm_quake_leg')));
  }
  L.style.display = L.childNodes.length ? '' : 'none';
}

/* ======================= input: pan, zoom, hover, click ======================= */
function zoomAt(px, py, f){
  var wx = (px - M.W / 2) / M.S + M.cx, wy = (py - M.H / 2) / M.S + M.cy;
  M.S = M.S * f; clampView();
  M.cx = wx - (px - M.W / 2) / M.S; M.cy = wy - (py - M.H / 2) / M.S;
  clampView(); saveView(); hideTip(); redraw();
}
function flyTo(lon, lat, z){
  M.S = M.S0 * (z || 4); M.cx = mx(lon); M.cy = my(lat); clampView(); saveView(); redraw();
}
function bindInput(){
  var pts = {}, drag = null, pinch = null, moved = false;
  // the buttons, legend and links over the map keep their own clicks (a captured pointer would take them away)
  var onUi = function(e){ return e.target !== cv && e.target.closest && e.target.closest('button,a,input,select,.gm-ctl,.gm-leg,.gm-att') };
  wrap.addEventListener('pointerdown', function(e){
    if (onUi(e)) return;
    wrap.setPointerCapture && wrap.setPointerCapture(e.pointerId);
    pts[e.pointerId] = [e.clientX, e.clientY]; moved = false;
    var ids = Object.keys(pts);
    if (ids.length === 1) drag = {x: e.clientX, y: e.clientY, cx: M.cx, cy: M.cy};
    else if (ids.length === 2) { var a = pts[ids[0]], b = pts[ids[1]]; pinch = {d: Math.hypot(a[0] - b[0], a[1] - b[1]), S: M.S}; drag = null }
  });
  wrap.addEventListener('pointermove', function(e){
    if (pts[e.pointerId]) pts[e.pointerId] = [e.clientX, e.clientY];
    var ids = Object.keys(pts);
    if (pinch && ids.length === 2) {
      var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]), r = wrap.getBoundingClientRect();
      var f = (pinch.S * d / pinch.d) / M.S; zoomAt((a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top, f); moved = true; return;
    }
    if (drag) {
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) { moved = true; wrap.classList.add('drag') }
      M.cx = drag.cx - dx / M.S; M.cy = drag.cy - dy / M.S; clampView(); hideTip(); redraw(); return;
    }
    if (e.pointerType === 'mouse') hover(e);
  });
  var up = function(e){
    delete pts[e.pointerId];
    if (Object.keys(pts).length < 2) pinch = null;
    if (!Object.keys(pts).length) {
      if (drag && !moved) click(e);
      if (moved) saveView();
      drag = null; wrap.classList.remove('drag');
    }
  };
  wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
  wrap.addEventListener('pointerleave', function(e){ if (e.pointerType === 'mouse' && !drag) { hideTip(); if (M.hover || M.hoverIso) { M.hover = null; M.hoverIso = null; redraw() } } });
  wrap.addEventListener('wheel', function(e){
    e.preventDefault(); var r = wrap.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * 0.0028));
  }, {passive: false});
  wrap.addEventListener('dblclick', function(e){ if (onUi(e)) return; var r = wrap.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, 2) });
}
function pick(px, py){
  var best = null, bd = 1e9, z = zf(), ks = copies(), act = active();
  for (var a = act.length - 1; a >= 0; a--) {
    var d = M.data[act[a]]; if (!d || !d.pts) continue;
    var fuelOff = M.off[act[a]] || null, dense = d.pts.length > 3000;
    for (var i = 0; i < d.pts.length; i++) {
      var p = d.pts[i]; if (p.nohit || (fuelOff && fuelOff[p.fuel])) continue;
      var y = sy(p.fy); if (Math.abs(y - py) > 16) continue;
      for (var j = 0; j < ks.length; j++) {
        var x = sx(p.fx + ks[j]), dd = Math.hypot(x - px, y - py), rr = p.r * (dense ? Math.min(2.2, z) : z);
        if (dd <= Math.max(7, rr + 3) && dd - rr < bd) { bd = dd - rr; best = {p: p, x: x, y: y} }
      }
    }
    if (best && !dense) break;   // layers drawn on top win
  }
  return best;
}
function countryAt(px, py){
  if (!world) return null;
  var ks = copies(), dpr = M.dpr;
  for (var j = 0; j < ks.length; j++) {
    g.setTransform(dpr * M.S, 0, 0, dpr * M.S, dpr * ((ks[j] - M.cx) * M.S + M.W / 2), dpr * (M.H / 2 - M.cy * M.S));
    for (var i = 0; i < world.list.length; i++) if (g.isPointInPath(world.list[i].path, px * dpr, py * dpr)) { g.setTransform(dpr, 0, 0, dpr, 0, 0); return world.list[i] }
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return null;
}
function hover(e){
  var r = wrap.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  var h = pick(px, py);
  var c = !h && M.tab === 'ECO' ? countryAt(px, py) : null;
  var changed = (h && h.p) !== (M.hover && M.hover.p) || (c && c.iso) !== M.hoverIso;
  M.hover = h; M.hoverIso = c && c.iso;
  if (h) showTip(e, h.p.t, h.p.s);
  else if (c) showTip(e, cName(c), [ecoName(M.eco) + ': ' + (eco.vals[c.iso] != null ? fmt(eco.vals[c.iso], ecoFmt()) + '%' : TX('gm_nodata'))]);
  else hideTip();
  wrap.style.cursor = h && h.p.act ? 'pointer' : '';
  if (changed) redraw();
}
function click(e){
  var r = wrap.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  var h = pick(px, py);
  if (h) { if (h.p.act) h.p.act(); else pinInfo(h.p); return }
  if (M.tab === 'ECO') {
    var c = countryAt(px, py);
    if (c) pinInfo({t: cName(c), s: [ecoName(M.eco) + ': ' + (eco.vals[c.iso] != null ? fmt(eco.vals[c.iso], ecoFmt()) + '%' : TX('gm_nodata'))],
      act2: [TX('gm_open_ecst'), function(){ T.runCommand('ECST ' + c.iso) }]});
  } else if (e.pointerType !== 'mouse') hideTip();
}
function showTip(e, title, lines){
  clear(tip); tip.appendChild(el('b', null, title));
  (lines || []).forEach(function(l){ if (l) tip.appendChild(el('div', null, l)) });
  tip.style.display = 'block';
  var x = e.clientX + 14, y = e.clientY + 12, w = tip.offsetWidth, h = tip.offsetHeight;
  if (x + w > window.innerWidth - 6) x = e.clientX - w - 12;
  if (y + h > window.innerHeight - 6) y = e.clientY - h - 10;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function hideTip(){ if (tip) tip.style.display = 'none' }

/* ======================= the side panel ======================= */
function ecoName(k){ return TX('gm_eco_' + k) }
function ecoFmt(){ var ind = ECO_IND.filter(function(x){ return x.k === M.eco })[0]; return ind ? ind.fmt : 1 }
function pinInfo(p){ M.pin = p; renderSide(); if (M.sideOpen === false && box.classList.contains('narrow')) { M.sideOpen = true; box.classList.add('side-open') } }
function infoCard(){
  var p = M.pin; if (!p) return null;
  var c = el('div', 'gm-info');
  var x = el('button', 'gm-x', '✕'); x.onclick = function(){ M.pin = null; renderSide() }; c.appendChild(x);
  c.appendChild(el('b', null, p.t));
  (p.s || []).forEach(function(l){ if (l) c.appendChild(el('div', null, l)) });
  if (p.svg) c.appendChild(p.svg);
  if (p.u && /^https?:/.test(p.u)) { var a = el('a', null, TX('gm_more')); a.href = p.u; a.target = '_blank'; a.rel = 'noopener'; c.appendChild(a) }
  if (p.act2) { var b = el('button', 'chipbtn', p.act2[0]); b.onclick = p.act2[1]; c.appendChild(b) }
  return c;
}
function sh(t, right){ var h = el('div', 'sh'); h.appendChild(el('span', null, t)); if (right != null) h.appendChild(el('small', null, right)); return h }
function layerRow(id){
  var L = LAYERS[id], on = active().indexOf(id) >= 0, base = (TABS[M.tab].base || []).indexOf(id) >= 0;
  var b = el('button', 'gm-ly' + (on ? ' on' : '')), i = el('i'); i.style.background = on ? L.color : 'transparent'; i.style.borderColor = L.color;
  b.appendChild(i); b.appendChild(el('span', null, TX('gm_l_' + id)));
  var off = M.off[id], st = M.status[id], n = M.data[id] && M.data[id].pts ? M.data[id].pts.filter(function(p){ return !p.nohit && !(off && off[p.fuel]) }).length : null;
  b.appendChild(el('small', st === 'err' ? 'down' : null, !on ? '' : st === 'loading' ? '…' : st === 'err' ? '✕' : n != null ? fmt(n, 0) : ''));
  if (st === 'err' && M.err && M.err[id]) b.title = M.err[id];
  b.onclick = function(){
    if (base) return;
    M.on[M.tab][id] = on ? 0 : 1; saveOn();
    if (!on) ensure(id);
    renderSide(); redraw();
  };
  return b;
}
// the chips under a layer that has categories: a click hides or shows one
var CATS = {
  plants: {list: function(d){ return d.fuels }, col: function(f){ return FUEL_COL[f] }, name: function(f){ return TX('gm_fuel_' + f.toLowerCase()) }, key: 'map_fuels'},
  fact: {list: function(d){ return d.cats }, col: function(f){ return FACT_COL[f] }, name: function(f){ return TX('gm_fact_' + f) }, key: 'map_off_fact'},
  ships: {list: function(){ return SHIP_KINDS }, col: function(f){ return SHIP_COL[f] }, name: function(f){ return TX('gm_ship_' + f) }, key: 'map_off_ships'},
  world: {list: function(){ return ['tanker', 'cargo'] }, col: function(f){ return SHIP_COL[f] }, name: function(f){ return TX('gm_ship_' + f) }, key: 'map_off_world'}
};
function catChips(id){
  var d = M.data[id], C_ = CATS[id], off = M.off[id]; if (!d || !C_ || active().indexOf(id) < 0) return null;
  var list = C_.list(d); if (!list || !list.length) return null;
  var w = el('div', 'gm-chips');
  list.forEach(function(f){
    var col = C_.col(f) || '#8b95a7', b = el('button', 'chipbtn' + (off[f] ? '' : ' on'), C_.name(f));
    b.style.borderColor = col; if (!off[f]) { b.style.background = col; b.style.color = '#000' }
    b.onclick = function(){ if (off[f]) delete off[f]; else off[f] = 1; store(C_.key, JSON.stringify(off)); renderSide(); redraw() };
    w.appendChild(b);
  });
  return w;
}
function fuelChips(){ return catChips('plants') }
function renderSide(){
  if (!side) return;
  var keep = side.scrollTop;
  clear(side);
  var info = infoCard(); if (info) side.appendChild(info);
  ({MAP: sideMap, STORM: sideStorm, SHIP: sideShip, WETR: sideWetr, ECO: sideEco}[M.tab] || sideMap)();
  side.scrollTop = keep;
  renderOverlay();
}
function sideMap(){
  GROUPS.forEach(function(gr){
    var ids = (TABS.MAP.opt || []).filter(function(id){ return LAYERS[id].grp === gr[0] });
    if (!ids.length) return;
    side.appendChild(sh(TX(gr[1])));
    ids.forEach(function(id){ side.appendChild(layerRow(id)); var fc = catChips(id); if (fc) side.appendChild(fc) });
  });
  side.appendChild(el('div', 'note', TX('gm_map_note')));
}
function optRows(){
  var o = TABS[M.tab].opt || [];
  if (!o.length) return;
  side.appendChild(sh(TX('gm_overlays')));
  o.forEach(function(id){ side.appendChild(layerRow(id)); var fc = catChips(id); if (fc) side.appendChild(fc) });
}
function sideStorm(){
  var d = M.data.storms, st = M.status.storms;
  side.appendChild(sh(TX('gm_storms_now'), st === 'loading' ? '…' : ''));
  if (st === 'err') side.appendChild(el('div', 'err', TX('load_fail') + (M.err && M.err.storms || '')));
  var list = d ? d.pts.filter(function(p){ return p.k === 'storm' }) : [];
  if (d && !list.length) side.appendChild(el('div', 'empty', TX('gm_no_storms')));
  // energy assets within 300 km of each storm
  var assets = ['refin', 'lng', 'gas', 'oilst', 'ports', 'plants', 'fact'].filter(function(id){ return M.data[id] && active().indexOf(id) >= 0 });
  list.sort(function(a, b){ return (b.kmh || 0) - (a.kmh || 0) }).forEach(function(s){
    var b = el('button', 'gm-row');
    var i = el('i'); i.style.background = s.c; b.appendChild(i);
    var t = el('div'); t.appendChild(el('b', null, s.t.replace('🌀 ', '')));
    t.appendChild(el('span', null, s.s[0])); t.appendChild(el('span', null, s.s[1] + (s.country ? ' · ' + s.country : '')));
    var near = [];
    assets.forEach(function(id){
      var n = 0; M.data[id].pts.forEach(function(p){ if (p.nohit || (id === 'plants' && p.fuel !== 'Gas' && p.fuel !== 'Oil' && p.fuel !== 'Nuclear')) return; if (km([p.lon, p.lat], [s.lon, s.lat]) < 300) n++ });
      if (n) near.push(TX('gm_l_' + id) + ' ' + n);
    });
    if (near.length) t.appendChild(el('span', 'gm-near', TX('gm_near300') + near.join(', ')));
    b.appendChild(t);
    b.onclick = function(){ flyTo(s.lon, s.lat, 5); pinInfo(s) };
    side.appendChild(b);
  });
  optRows();
  side.appendChild(el('div', 'note', TX('gm_storm_note')));
}
function sideShip(){
  side.appendChild(sh(TX('gm_choke_t'), M.status.choke === 'loading' ? '…' : TX('gm_choke_cols')));
  if (M.status.choke === 'err') side.appendChild(el('div', 'err', TX('load_fail') + (M.err && M.err.choke || '')));
  var d = M.data.choke;
  (d ? d.pts : []).forEach(function(p){
    var c = p.cp, b = el('button', 'gm-row gm-ch');
    var i = el('i'); i.style.background = p.c; b.appendChild(i);
    b.appendChild(el('span', 'nm', c.name));
    b.appendChild(el('span', 'num', c.n7 != null ? fmt(c.n7, 0) : '—'));
    b.appendChild(el('span', 'num ' + cls(c.ch), c.ch != null ? pct(c.ch, 0) : '—'));
    b.onclick = function(){ flyTo(c.lon, c.lat, 6); pinChoke(c) };
    side.appendChild(b);
  });
  worldBlock();
  shipBlock();
  optRows();
  side.appendChild(el('div', 'note', TX('gm_ship_note')));
}
// ships worldwide: tankers and cargo ships seen in the last 6 hours, under way or not, and seas to fly to
function worldBlock(){
  if (active().indexOf('world') < 0) return;
  var d = M.data.world, st = M.status.world;
  side.appendChild(sh(TX('gm_world_t'), st === 'loading' ? '…' : TX('gm_ships_cols')));
  if (st === 'err') side.appendChild(el('div', 'err', M.err && M.err.world || TX('load_fail')));
  if (!d) return;
  var cnt = {};
  d.pts.forEach(function(p){ var c = cnt[p.fuel] = cnt[p.fuel] || {all: 0, go: 0}; c.all++; if (p.hd != null) c.go++ });
  ['tanker', 'cargo'].forEach(function(k){
    if (!cnt[k]) return;
    var r = el('div', 'gm-row gm-sk'), i = el('i'); i.style.background = SHIP_COL[k]; r.appendChild(i);
    r.appendChild(el('span', 'nm', TX('gm_ship_' + k))); r.appendChild(el('span', 'num', fmt(cnt[k].all, 0))); r.appendChild(el('span', 'num', fmt(cnt[k].go, 0)));
    side.appendChild(r);
  });
  if (d.updated) side.appendChild(el('div', 'note', TX('gm_ships_at', T.hm(d.updated)) + ' · ' + TX('gm_world_every')));
  var fly = el('div', 'gm-chips');
  [['gm_fly_channel', 1.3, 50.6, 16], ['gm_fly_hormuz', 56.3, 26.4, 16], ['gm_fly_redsea', 38.5, 20.5, 5], ['gm_fly_sing', 103.8, 1.6, 22],
   ['gm_fly_bosp', 29.0, 41.0, 36], ['gm_fly_gulfmex', -91, 27.5, 5]].forEach(function(x){
    var b = el('button', 'chipbtn', TX(x[0])); b.onclick = function(){ flyTo(x[1], x[2], x[3]) }; fly.appendChild(b);
  });
  side.appendChild(fly);
}
// live vessels: how many of each kind are under way, at anchor or moored, and where to look
function shipBlock(){
  if (active().indexOf('ships') < 0) return;
  var d = M.data.ships, st = M.status.ships;
  side.appendChild(sh(TX('gm_ships_t'), st === 'loading' ? '…' : TX('gm_ships_cols')));
  if (st === 'err') side.appendChild(el('div', 'err', TX('load_fail') + (M.err && M.err.ships || '')));
  if (!d) return;
  var cnt = {};
  d.pts.forEach(function(p){ var c = cnt[p.fuel] = cnt[p.fuel] || {all: 0, go: 0}; c.all++; if (p.hd != null) c.go++ });
  SHIP_KINDS.forEach(function(k){
    if (!cnt[k]) return;
    var r = el('div', 'gm-row gm-sk'), i = el('i'); i.style.background = SHIP_COL[k]; r.appendChild(i);
    r.appendChild(el('span', 'nm', TX('gm_ship_' + k))); r.appendChild(el('span', 'num', fmt(cnt[k].all, 0))); r.appendChild(el('span', 'num', fmt(cnt[k].go, 0)));
    side.appendChild(r);
  });
  if (d.updated) side.appendChild(el('div', 'note', TX('gm_ships_at', T.hm(d.updated))));
  var fly = el('div', 'gm-chips');
  [['gm_fly_gof', 27.8, 59.9, 24], ['gm_fly_baltic', 19, 59, 12]].forEach(function(x){ var b = el('button', 'chipbtn', TX(x[0])); b.onclick = function(){ flyTo(x[1], x[2], x[3]) }; fly.appendChild(b) });
  side.appendChild(fly);
}
function pinChoke(c){
  var NS = 'http://www.w3.org/2000/svg', W = 212, H = 64, svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('class', 'gm-spark');
  var days = c.days.slice(-40), hi = Math.max.apply(null, days.map(function(x){ return x.n || 0 }).concat([1])), bw = W / Math.max(1, days.length);
  days.forEach(function(x, i){
    var h = (x.n || 0) / hi * (H - 12), r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', i * bw + 0.5); r.setAttribute('y', H - h); r.setAttribute('width', Math.max(1, bw - 1)); r.setAttribute('height', h); r.setAttribute('fill', '#2f6f74');
    var t = document.createElementNS(NS, 'title'); t.textContent = x.d + ': ' + x.n + ' / ' + TX('gm_tankers_short') + ' ' + x.tk; r.appendChild(t); svg.appendChild(r);
    var th = (x.tk || 0) / hi * (H - 12), r2 = document.createElementNS(NS, 'rect');
    r2.setAttribute('x', i * bw + 0.5); r2.setAttribute('y', H - th); r2.setAttribute('width', Math.max(1, bw - 1)); r2.setAttribute('height', th); r2.setAttribute('fill', '#e0b23c'); svg.appendChild(r2);
  });
  var pts = M.data.choke && M.data.choke.pts.filter(function(p){ return p.cp === c })[0];
  pinInfo({t: '⚓ ' + c.name, s: (pts ? pts.s : []).concat([TX('gm_choke_chart')]), svg: svg, u: 'https://portwatch.imf.org/pages/' + encodeURIComponent(c.id)});
}
function sideWetr(){
  var mode = el('div', 'gm-chips');
  ['now', 'mean', 'hdd', 'cdd'].forEach(function(k){
    var b = el('button', 'chipbtn' + (M.wx === k ? ' on' : ''), TX(k === 'now' ? 'gm_wx_c_now' : 'gm_wx_' + k)); b.title = TX('gm_wx_' + k + '_t');
    b.onclick = function(){ M.wx = k; store('map_wx', k); if (M.data.wx && M.data.wx.rows) M.data.wx = prep({pts: M.data.wx.rows.map(wxPoint), rows: M.data.wx.rows}); renderSide(); redraw() };
    mode.appendChild(b);
  });
  side.appendChild(mode);
  side.appendChild(sh(TX('gm_wx_cities'), M.status.wx === 'loading' ? '…' : TX('gm_wx_cols_' + M.wx)));
  if (M.status.wx === 'err') side.appendChild(el('div', 'err', TX('load_fail') + (M.err && M.err.wx || '')));
  var rows = (M.data.wx && M.data.wx.rows || []).slice().sort(function(a, b){ return (wxValue(b) || -99) - (wxValue(a) || -99) });
  rows.forEach(function(r){
    var b = el('button', 'gm-row gm-ch'), i = el('i'); i.style.background = wxPoint(r).c; b.appendChild(i);
    b.appendChild(el('span', 'nm', r.name));
    b.appendChild(el('span', 'num', M.wx === 'hdd' || M.wx === 'cdd' ? fmt(wxValue(r), 0) : fmt(wxValue(r), 1) + '°'));
    b.appendChild(el('span', 'num flat', fmt(r.tmin, 0) + '…' + fmt(r.tmax, 0) + '°'));
    b.onclick = function(){ flyTo(r.lon, r.lat, 5); pinInfo(wxPoint(r)) };
    side.appendChild(b);
  });
  optRows();
  side.appendChild(el('div', 'note', TX('gm_wx_note')));
}
function sideEco(){
  var chips = el('div', 'gm-chips');
  ECO_IND.forEach(function(x){
    var b = el('button', 'chipbtn' + (M.eco === x.k ? ' on' : ''), TX('gm_eco_s_' + x.k)); b.title = ecoName(x.k);
    b.onclick = function(){ M.eco = x.k; store('map_eco', x.k); eco.vals = {}; loadEco(); renderSide(); redraw() };
    chips.appendChild(b);
  });
  side.appendChild(chips);
  var ks = Object.keys(eco.vals);
  side.appendChild(sh(ecoName(M.eco), ks.length ? fmt(ks.length, 0) : '…'));
  if (eco.note) side.appendChild(el('div', 'note', eco.note));
  ks.sort(function(a, b){ return eco.vals[b] - eco.vals[a] }).forEach(function(iso){
    var c = world && world.c[iso]; if (!c) return;
    var b = el('button', 'gm-row gm-ch'), i = el('i'); i.style.background = ecoColor(iso) || '#2c3542'; b.appendChild(i);
    b.appendChild(el('span', 'nm', cName(c)));
    b.appendChild(el('span', 'num', fmt(eco.vals[iso], ecoFmt()) + '%'));
    b.onclick = function(){ flyTo(c.lx, c.ly, 3); pinInfo({t: cName(c), s: [ecoName(M.eco) + ': ' + fmt(eco.vals[iso], ecoFmt()) + '%'], act2: [TX('gm_open_ecst'), function(){ T.runCommand('ECST ' + iso) }]}) };
    side.appendChild(b);
  });
  optRows();
}

/* ======================= open / refresh ======================= */
var TAB_CODE = {MAP: 'MAP', STORM: 'BMAP STORM', SHIP: 'BMAP V', WETR: 'WETR', ECO: 'MAP ECO', SPLC: 'SPLC', SAT: 'SAT'};
F.tabs($('map-tabs'), 't', function(t){ setMapTab(t) });
function setMapTab(t){
  M.tab = TABS[t] ? t : 'MAP'; M.pin = null; M.hover = null; hideTip();
  F.setTab($('map-tabs'), 't', M.tab);
  $('map-code').textContent = TAB_CODE[M.tab];
  $('map-title').textContent = TX('gm_title_' + M.tab);
  render();
}
function render(){
  if (!F.visible('p-map')) return;
  if (M.tab === 'SPLC') { M.built = false; M.W = 0; return drawSplc() }   // a diagram, not the map: the map is rebuilt when we come back
  if (M.tab === 'SAT') { M.built = false; M.W = 0; return drawSat() }
  if (!M.built) build();
  loadWorld().then(function(){ redraw() }).catch(function(e){ M.att.textContent = TX('load_fail') + e.message });
  active().forEach(function(id){ ensure(id) });
  if (M.tab === 'ECO') loadEco();
  $('map-sub').textContent = '';
  renderSide(); resize();
}
function openMap(tab, arg){
  T.show('p-map'); setMapTab(tab || M.tab);
  if (arg && M.tab === 'ECO') {
    var a = String(arg).toUpperCase(), hit = ECO_IND.filter(function(x){ return x.k === a || TX('gm_eco_s_' + x.k).toUpperCase() === a })[0];
    var al = {GDP: 'NGDP_RPCH', CPI: 'PCPIPCH', INF: 'PCPIPCH', INFLATION: 'PCPIPCH', UNEMP: 'LUR', JOBS: 'LUR', DEBT: 'GGXWDG_NGDP', CA: 'BCA_NGDPD',
      RATE: 'CB', RATES: 'CB', CB: 'CB', '10Y': 'Y10', YIELD: 'Y10', STOCKS: 'MKT', MKT: 'MKT', 'ВВП': 'NGDP_RPCH', 'ИНФЛЯЦИЯ': 'PCPIPCH', 'СТАВКИ': 'CB'}[a];
    if (hit || al) { M.eco = hit ? hit.k : al; store('map_eco', M.eco); eco.vals = {}; loadEco(); renderSide() }
  }
}
F.RENDER['p-map'] = function(){ render() };
// live layers refresh while the map is on screen
setInterval(function(){
  if (document.hidden || !F.visible('p-map')) return;
  active().forEach(function(id){ var L = LAYERS[id]; if (L.ttl && M.data[id] && Date.now() - M.at[id] > L.ttl * 1000) ensure(id, true) });
  if (active().indexOf('exch') >= 0) { try { M.data.exch = prep(loadExch()); redraw() } catch(e){} }
  if (M.tab === 'ECO' && M.eco === 'MKT') loadEco();
}, 30000);
document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && M.pin) { M.pin = null; renderSide() } });

/* ======================= commands ======================= */
var C = T.CMDS;
function mapCmd(arg){
  var a = String(arg || '').trim().toUpperCase(), w = a.split(/\s+/);
  if (/^(STORM|STORMS|ШТОРМ|ШТОРМЫ|ЦИКЛОНЫ|HURRICANE)/.test(w[0])) return openMap('STORM');
  if (/^(V|SHIP|SHIPS|VESSELS|СУДА|ФЛОТ|PORTS)$/.test(w[0])) return openMap('SHIP');
  if (/^(WETR|WEATHER|ПОГОДА|WX)$/.test(w[0])) return openMap('WETR');
  if (/^(SPLC|SUPPLY|ЦЕПОЧКА|ПОСТАВКИ)$/.test(w[0])) return openMap('SPLC');
  if (/^(SAT|OILSAT|СПУТНИК|СНИМКИ)$/.test(w[0])) return openSat(w[1] || null);
  if (/^(TANKERS|ТАНКЕРЫ)$/.test(w[0])) { M.on.SHIP.tankers = 1; saveOn(); return openMap('SHIP') }
  if (/^(ECO|ECON|ECST|COUNTRIES|ЭКОНОМИКА|СТРАНЫ)$/.test(w[0])) return openMap('ECO', w.slice(1).join(' '));
  if (a && TABS.MAP.opt.some(function(id){ return id.toUpperCase() === w[0] })) { var id = w[0].toLowerCase(); M.on.MAP[id] = 1; saveOn(); return openMap('MAP') }
  openMap(a ? null : 'MAP');
}
C.MAP = mapCmd; C.BMAP = mapCmd; C['КАРТА'] = mapCmd; C['КАРТЫ'] = mapCmd;
C.STORM = function(){ openMap('STORM') }; C['ШТОРМЫ'] = C['ЦИКЛОНЫ'] = C.STORM;
C.SHIP = function(){ openMap('SHIP') }; C.VESSELS = C.SHIP; C['СУДА'] = C.SHIP; C['СУДОХОДСТВО'] = C.SHIP;
C.WETR = function(){ openMap('WETR') }; C.WEAT = C.WETR; C.WFOR = C.WETR; C['ПОГОДА'] = C.WETR;
C.ECMAP = function(arg){ openMap('ECO', arg) };
C.SPLC = function(){ openMap('SPLC') }; C.SUPPLY = C.SPLC; C['ЦЕПОЧКА'] = C['ПОСТАВКИ'] = C.SPLC;
C.TANKERS = function(){ M.on.SHIP.tankers = 1; saveOn(); openMap('SHIP') }; C['ТАНКЕРЫ'] = C.TANKERS;
C.SAT = function(arg){ openSat(arg ? String(arg).trim().split(/\s+/)[0] : null) }; C.OILSAT = C.SAT; C['СПУТНИК'] = C['СНИМКИ'] = C['ХРАНИЛИЩА'] = C.SAT;
C.WORLDSHIPS = function(){ M.on.SHIP.world = 1; saveOn(); openMap('SHIP') }; C['СУДАМИР'] = C.WORLDSHIPS;

// for tests and other modules
window.MAPS = {M: M, open: openMap, layers: LAYERS, chokeData: chokeData, km: km, stormCat: stormCat, flyTo: flyTo, openSat: openSat, setBase: setBase,
  countryName: function(iso){ return world ? countryName(iso) : iso }};
})();
