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
  return getJSON(b + '/api/geo?u=' + encodeURIComponent(url), 25000).then(function(d){ if (d && d.ok === false && d.error) throw new Error(d.error); return d });
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
var FUEL_COL = {Coal: '#8c8c8c', Gas: '#ffa028', Oil: '#ff4b4b', Nuclear: '#ffd400', Hydro: '#4fa3ff', Wind: '#56d6d6', Solar: '#f5e663',
  Biomass: '#21c66f', Geothermal: '#ff7ab6', Waste: '#a07850', Storage: '#c77dff', Other: '#6a6a6a'};
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
  if (t == null || isNaN(t)) return '#555';
  var stops = [[-30, '#3a4cff'], [-10, '#4fa3ff'], [0, '#bfe3ff'], [10, '#f5f5c8'], [20, '#ffd400'], [30, '#ff7a1a'], [40, '#d92020']];
  for (var i = 1; i < stops.length; i++) if (t <= stops[i][0]) return mix(stops[i - 1][1], stops[i][1], (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  return stops[stops.length - 1][1];
}
function alertCol(a){ a = String(a || '').toLowerCase(); return a === 'red' ? '#ff3b3b' : a === 'orange' ? '#ff9a1a' : '#21c66f' }
function magCol(m){ return m >= 7 ? '#ff2a2a' : m >= 6 ? '#ff6a1a' : m >= 5 ? '#ffa028' : m >= 4 ? '#ffd400' : '#e8e8a0' }
// Saffir–Simpson from the 1-minute wind in km/h
function stormCat(kmh){
  if (kmh == null) return '';
  return kmh >= 252 ? 'CAT 5' : kmh >= 209 ? 'CAT 4' : kmh >= 178 ? 'CAT 3' : kmh >= 154 ? 'CAT 2' : kmh >= 119 ? 'CAT 1' : kmh >= 63 ? 'TS' : 'TD';
}
function stormCol(kmh){ return kmh >= 178 ? '#ff2a6a' : kmh >= 119 ? '#ff7a1a' : kmh >= 63 ? '#ffd400' : '#4fd2ff' }
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
  alerts: {grp: 'live', color: '#ffd400', src: 'GDACS', ttl: 900, load: loadAlerts},
  exch: {grp: 'mkt', color: '#ffa028', src: '', ttl: 30, load: loadExch},
  choke: {grp: 'mkt', color: '#56d6d6', src: 'IMF PortWatch', ttl: 3600, load: loadChoke},
  ports: {grp: 'infra', color: '#4fa3ff', src: 'IMF PortWatch', load: loadPorts},
  plants: {grp: 'infra', color: '#c77dff', src: 'WRI GPPD', load: loadPlants},
  refin: {grp: 'infra', color: '#ff4b4b', src: '', load: function(){ return loadInfra('refineries.json', '#ff4b4b', 'gm_refin') }},
  lng: {grp: 'infra', color: '#21c66f', src: '', load: function(){ return loadInfra('lng.json', '#21c66f', 'gm_lng') }},
  wx: {grp: 'wx', color: '#ffd400', src: 'Open-Meteo', ttl: 1800, load: loadWeather}
};
var ORDER = ['plants', 'ports', 'refin', 'lng', 'wx', 'alerts', 'fires', 'volc', 'quakes', 'choke', 'storms', 'exch'];
var GROUPS = [['live', 'gm_g_live'], ['mkt', 'gm_g_mkt'], ['infra', 'gm_g_infra'], ['wx', 'gm_g_wx']];
// which layers each tab shows: "base" always, "opt" can be ticked
var TABS = {
  MAP: {opt: ORDER.slice(), def: ['quakes', 'storms', 'fires', 'exch', 'choke']},
  STORM: {base: ['storms'], opt: ['refin', 'lng', 'ports', 'plants', 'alerts'], def: ['refin', 'lng', 'ports']},
  SHIP: {base: ['choke'], opt: ['ports', 'refin', 'lng', 'storms'], def: ['ports']},
  WETR: {base: ['wx'], opt: ['storms', 'exch'], def: []},
  ECO: {base: [], opt: ['exch'], def: []}
};

var M = {tab: 'MAP', W: 0, H: 0, S: 0, S0: 0, cx: 0.5, cy: my(22), dpr: 1, on: {}, data: {}, status: {}, at: {}, hover: null, pin: null,
  eco: store('map_eco') || 'NGDP_RPCH', wx: store('map_wx') || 'now', fuels: {}, sideOpen: false, built: false};
try { var sv = JSON.parse(store('map_on') || 'null'); if (sv && typeof sv === 'object') M.on = sv } catch(e){}
try { var sf = JSON.parse(store('map_fuels') || 'null'); if (sf && typeof sf === 'object') M.fuels = sf } catch(e){}
Object.keys(TABS).forEach(function(t){ if (!M.on[t]) { M.on[t] = {}; TABS[t].def.forEach(function(k){ M.on[t][k] = 1 }) } });
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
  (d.pts || []).forEach(function(p){ p.fx = mx(p.lon); p.fy = my(p.lat) });
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
    var pts = [], lines = [], polys = [], seen = {}, jobs = [];
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
          if (/^Line_/.test(cl) && /LineString/.test(gt.type)) each('LineString', function(c){ lines.push({pts: c, c: TRACK_COL[lb] || col, w: 2}) });
          else if (cl === 'Poly_Cones' && /Polygon/.test(gt.type)) each('Polygon', function(pg){ polys.push({rings: [pg[0]], c: '#ffffff', a: 0.07}) });
          else if (/^Poly_(Green|Orange|Red)$/.test(cl) && /km\/h/.test(lb) && /Polygon/.test(gt.type)) each('Polygon', function(pg){ polys.push({rings: [pg[0]], c: alertCol(cl.slice(5)), a: 0.12}) });
        });
      }).catch(function(){}));
    });
    return Promise.all(jobs).then(function(){ return {pts: pts, lines: lines, polys: polys} });
  });
}
// track segments by the storm's strength then: hurricane/typhoon, tropical storm, depression
var TRACK_COL = {HU: '#ff4b6a', TY: '#ff4b6a', STY: '#ff2a6a', TS: '#ffd400', TD: '#4fd2ff', STS: '#ffd400'};
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
    return {lon: e.lon, lat: e.lat, r: 7, c: diverging(q.change, 2) || '#555', ring: true, t: q.name, s: s, lbl: (q.name || e.id) + ' ' + pct(q.change, 1),
      act: function(){ T.openChart(e.id) }, k: 'exch'};
  }).filter(Boolean);
  if (!pts.length) throw new Error(TX('gm_no_quotes'));
  return {pts: pts};
}

/* ---------- IMF PortWatch: chokepoints (daily transits from satellite AIS) ---------- */
var PW = 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/';
var chokeP = null, chokeAt = 0;
function chokeData(){
  if (chokeP && Date.now() - chokeAt < 3600000) return chokeP;
  chokeAt = Date.now();
  var s = new Date(Date.now() - 45 * 864e5), y = s.getUTCFullYear(), m = s.getUTCMonth() + 1, d = s.getUTCDate();
  var where = '(year > ' + y + ') OR (year = ' + y + ' AND month > ' + m + ') OR (year = ' + y + ' AND month = ' + m + ' AND day >= ' + d + ')';
  var q = 'where=' + encodeURIComponent(where) + '&outFields=year,month,day,portid,portname,n_total,n_tanker,n_container,n_dry_bulk,n_cargo,capacity,capacity_tanker' +
    '&returnGeometry=false&orderByFields=' + encodeURIComponent('year DESC,month DESC,day DESC,portid') + '&f=json';
  chokeP = Promise.all([
    live(PW + 'PortWatch_chokepoints_database/FeatureServer/0/query?where=1%3D1&outFields=portid,portname,lat,lon,vessel_count_total,vessel_count_tanker,industry_top1&returnGeometry=false&f=json', true),
    arcgisAll(PW + 'Daily_Chokepoints_Data/FeatureServer/0/query?' + q)
  ]).then(function(r){
    var base = {}, out = [];
    (r[0].features || []).forEach(function(f){ var a = f.attributes || {}; if (a.portid && a.lat != null) base[a.portid] = a });
    var by = {};
    (r[1].features || []).forEach(function(f){
      var a = f.attributes || {}; if (!a.portid) return;
      var key = a.year * 10000 + a.month * 100 + a.day;
      (by[a.portid] = by[a.portid] || []).push({k: key, d: a.year + '-' + ('0' + a.month).slice(-2) + '-' + ('0' + a.day).slice(-2), n: a.n_total, tk: a.n_tanker, cn: a.n_container,
        db: a.n_dry_bulk, cap: a.capacity, ctk: a.capacity_tanker});
    });
    Object.keys(base).forEach(function(id){
      var b = base[id], days = (by[id] || []).sort(function(x, y_){ return x.k - y_.k });
      var last7 = days.slice(-7), prev = days.slice(-37, -7);
      var avg = function(a, k){ var v = a.filter(function(x){ return x[k] != null }); return v.length ? v.reduce(function(s, x){ return s + x[k] }, 0) / v.length : null };
      var n7 = avg(last7, 'n'), p30 = avg(prev, 'n'), t7 = avg(last7, 'tk'), tp = avg(prev, 'tk');
      out.push({id: id, name: b.portname, lon: b.lon, lat: b.lat, n7: n7, p30: p30, ch: n7 != null && p30 ? (n7 / p30 - 1) * 100 : null,
        t7: t7, tch: t7 != null && tp ? (t7 / tp - 1) * 100 : null, cap7: avg(last7, 'cap'), ctk7: avg(last7, 'ctk'), days: days,
        last: days.length ? days[days.length - 1].d : null, yr: b.vessel_count_total, top: b.industry_top1});
    });
    out.sort(function(a, b){ return (b.n7 || 0) - (a.n7 || 0) });
    return out;
  }).catch(function(e){ chokeP = null; throw e });
  return chokeP;
}
function loadChoke(){
  return chokeData().then(function(list){
    var pts = list.map(function(c){
      var s = [TX('gm_ships_day', c.n7 != null ? fmt(c.n7, 0) : '—') + (c.ch != null ? ' · ' + pct(c.ch, 0) + ' ' + TX('gm_vs30') : ''),
        TX('gm_tankers_day', c.t7 != null ? fmt(c.t7, 0) : '—') + (c.tch != null ? ' · ' + pct(c.tch, 0) : ''),
        c.cap7 != null ? TX('gm_cargo_day', fmt(c.cap7 / 1e6, 2)) : '', c.last ? TX('gm_data_to', c.last) : ''].filter(Boolean);
      return {lon: c.lon, lat: c.lat, r: 3.5 + Math.sqrt(c.n7 || 4) * 0.9, c: c.ch == null ? '#56d6d6' : c.ch < -15 ? '#ff4b4b' : c.ch < -5 ? '#ffa028' : '#56d6d6',
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
function countryName(iso){ var c = world && world.c[iso]; return c ? (I.ru ? c.ru : c.en) : iso || '' }

/* ---------- ports: IMF PortWatch (with their traffic), Natural Earth if it does not answer ---------- */
function loadPorts(){
  return arcgisAll(PW + 'PortWatch_ports_database/FeatureServer/0/query?where=1%3D1&outFields=portname,country,ISO3,lat,lon,vessel_count_total,vessel_count_tanker,industry_top1&returnGeometry=false&f=json', 3000)
    .then(function(d){
      var pts = (d.features || []).map(function(f){
        var a = f.attributes || {}; if (a.lat == null || a.lon == null) return null;
        var n = a.vessel_count_total || 0;
        return {lon: a.lon, lat: a.lat, r: 1.2, c: '#4fa3ff', t: '⚓ ' + a.portname, v: n,
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
          return {lon: p[0], lat: p[1], r: Math.max(1.3, 4.6 - p[2] * 0.42), c: '#4fa3ff', t: '⚓ ' + p[3], s: [TX('gm_port_rank', p[2])], lbl: p[2] <= 3 ? p[3] : null, minLbl: 2.5, k: 'port'};
        }), src: d.src};
      });
    });
}

/* ---------- static infrastructure ---------- */
function loadPlants(){
  return geo('plants.json').then(function(d){
    var fuels = d.fuels;
    return {pts: d.p.map(function(p){
      var f = fuels[p[3]], c = FUEL_COL[f] || '#888';
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
var box, wrap, cv, g, side, tip;
function build(){
  box = $('map-body'); clear(box);
  wrap = el('div', 'gm-wrap'); cv = el('canvas'); wrap.appendChild(cv);
  var ctl = el('div', 'gm-ctl');
  [['+', function(){ zoomAt(M.W / 2, M.H / 2, 1.6) }, 'gm_zin'], ['−', function(){ zoomAt(M.W / 2, M.H / 2, 1 / 1.6) }, 'gm_zout'], ['⌂', home, 'gm_home'],
    ['☰', function(){ M.sideOpen = !M.sideOpen; box.classList.toggle('side-open', M.sideOpen) }, 'gm_layers']].forEach(function(b){
    var x = el('button', b[0] === '☰' ? 'gm-tbtn' : null, b[0]); x.title = TX(b[2]); x.onclick = function(e){ e.stopPropagation(); b[1]() }; ctl.appendChild(x);
  });
  wrap.appendChild(ctl);
  M.legend = el('div', 'gm-leg'); wrap.appendChild(M.legend);
  M.att = el('div', 'gm-att'); wrap.appendChild(M.att);
  box.appendChild(wrap);
  side = el('div', 'gm-side'); box.appendChild(side);
  g = cv.getContext('2d');
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
  cv.width = Math.round(W * M.dpr); cv.height = Math.round(H * M.dpr);
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
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  if (world) {
    ks.forEach(function(k){
      g.setTransform(dpr * S, 0, 0, dpr * S, dpr * ((k - M.cx) * S + W / 2), dpr * (H / 2 - M.cy * S));
      if (M.tab === 'ECO') {
        world.list.forEach(function(c){ g.fillStyle = ecoColor(c.iso) || '#15191e'; g.fill(c.path) });
        if (M.hoverIso && world.c[M.hoverIso]) { g.lineWidth = 2 / S; g.strokeStyle = '#ffd400'; g.stroke(world.c[M.hoverIso].path) }
      } else { g.fillStyle = '#10161c'; g.fill(world.land) }
      g.lineWidth = 0.6 / S; g.strokeStyle = M.tab === 'ECO' ? '#000' : '#2a3540'; g.stroke(world.land);
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
    var dense = d.pts.length > 3000;
    if (dense) g.globalCompositeOperation = 'lighter';
    var fuelOff = id === 'plants' ? M.fuels : null;
    for (var i = d.pts.length - 1; i >= 0; i--) {   // big ones first, small ones on top
      var p = d.pts[i];
      if (fuelOff && fuelOff[p.fuel]) continue;
      var y = sy(p.fy); if (y < -20 || y > H + 20) continue;
      for (var j = 0; j < ks.length; j++) {
        var x = sx(p.fx + ks[j]); if (x < -20 || x > W + 20) continue;
        var r = p.r * (dense ? Math.min(2.2, z) : z);
        g.fillStyle = p.c;
        if (dense) { g.globalAlpha = 0.75; if (r < 1.6) g.fillRect(x - r, y - r, r * 2, r * 2); else { g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill() } }
        else {
          g.globalAlpha = p.ring ? 0.85 : 0.9; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
          if (p.ring) { g.globalAlpha = 1; g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.8)'; g.stroke() }
        }
        if (p.lbl && (!p.minLbl || M.S / M.S0 >= p.minLbl)) labels.push({x: x, y: y, r: r, t: p.lbl, c: p.c});
      }
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  });
  if (M.hover && M.hover.p) {   // highlight under the cursor
    var hp = M.hover.p; g.strokeStyle = '#ffd400'; g.lineWidth = 2; g.beginPath(); g.arc(M.hover.x, M.hover.y, Math.max(5, hp.r * z + 3), 0, 6.2832); g.stroke();
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
    g.fillStyle = '#e6e6e6'; g.fillText(L.t, x, y);
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
  src.push('Natural Earth');
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
    var fuelOff = act[a] === 'plants' ? M.fuels : null, dense = d.pts.length > 3000;
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
  else if (c) showTip(e, I.ru ? c.ru : c.en, [ecoName(M.eco) + ': ' + (eco.vals[c.iso] != null ? fmt(eco.vals[c.iso], ecoFmt()) + '%' : TX('gm_nodata'))]);
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
    if (c) pinInfo({t: I.ru ? c.ru : c.en, s: [ecoName(M.eco) + ': ' + (eco.vals[c.iso] != null ? fmt(eco.vals[c.iso], ecoFmt()) + '%' : TX('gm_nodata'))],
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
  var st = M.status[id], n = M.data[id] && M.data[id].pts ? M.data[id].pts.filter(function(p){ return !p.nohit }).length : null;
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
function fuelChips(){
  var d = M.data.plants; if (!d || !d.fuels) return null;
  var w = el('div', 'gm-chips');
  d.fuels.forEach(function(f){
    var b = el('button', 'chipbtn' + (M.fuels[f] ? '' : ' on'), TX('gm_fuel_' + f.toLowerCase()));
    b.style.borderColor = FUEL_COL[f]; if (!M.fuels[f]) { b.style.background = FUEL_COL[f]; b.style.color = '#000' }
    b.onclick = function(){ if (M.fuels[f]) delete M.fuels[f]; else M.fuels[f] = 1; store('map_fuels', JSON.stringify(M.fuels)); renderSide(); redraw() };
    w.appendChild(b);
  });
  return w;
}
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
    ids.forEach(function(id){ side.appendChild(layerRow(id)); if (id === 'plants' && active().indexOf('plants') >= 0) { var fc = fuelChips(); if (fc) side.appendChild(fc) } });
  });
  side.appendChild(el('div', 'note', TX('gm_map_note')));
}
function optRows(){
  var o = TABS[M.tab].opt || [];
  if (!o.length) return;
  side.appendChild(sh(TX('gm_overlays')));
  o.forEach(function(id){ side.appendChild(layerRow(id)); if (id === 'plants' && active().indexOf('plants') >= 0) { var fc = fuelChips(); if (fc) side.appendChild(fc) } });
}
function sideStorm(){
  var d = M.data.storms, st = M.status.storms;
  side.appendChild(sh(TX('gm_storms_now'), st === 'loading' ? '…' : ''));
  if (st === 'err') side.appendChild(el('div', 'err', TX('load_fail') + (M.err && M.err.storms || '')));
  var list = d ? d.pts.filter(function(p){ return p.k === 'storm' }) : [];
  if (d && !list.length) side.appendChild(el('div', 'empty', TX('gm_no_storms')));
  // energy assets within 300 km of each storm
  var assets = ['refin', 'lng', 'ports', 'plants'].filter(function(id){ return M.data[id] });
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
  optRows();
  side.appendChild(el('div', 'note', TX('gm_ship_note')));
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
    r2.setAttribute('x', i * bw + 0.5); r2.setAttribute('y', H - th); r2.setAttribute('width', Math.max(1, bw - 1)); r2.setAttribute('height', th); r2.setAttribute('fill', '#ffa028'); svg.appendChild(r2);
  });
  var pts = M.data.choke && M.data.choke.pts.filter(function(p){ return p.cp === c })[0];
  pinInfo({t: '⚓ ' + c.name, s: (pts ? pts.s : []).concat([TX('gm_choke_chart')]), svg: svg, u: 'https://portwatch.imf.org/pages/' + encodeURIComponent(c.id)});
}
function sideWetr(){
  var mode = el('div', 'gm-chips');
  ['now', 'mean', 'hdd', 'cdd'].forEach(function(k){
    var b = el('button', 'chipbtn' + (M.wx === k ? ' on' : ''), TX('gm_wx_' + k)); b.title = TX('gm_wx_' + k + '_t');
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
    var b = el('button', 'gm-row gm-ch'), i = el('i'); i.style.background = ecoColor(iso) || '#333'; b.appendChild(i);
    b.appendChild(el('span', 'nm', I.ru ? c.ru : c.en));
    b.appendChild(el('span', 'num', fmt(eco.vals[iso], ecoFmt()) + '%'));
    b.onclick = function(){ flyTo(c.lx, c.ly, 3); pinInfo({t: I.ru ? c.ru : c.en, s: [ecoName(M.eco) + ': ' + fmt(eco.vals[iso], ecoFmt()) + '%'], act2: [TX('gm_open_ecst'), function(){ T.runCommand('ECST ' + iso) }]}) };
    side.appendChild(b);
  });
  optRows();
}

/* ======================= open / refresh ======================= */
var TAB_CODE = {MAP: 'MAP', STORM: 'BMAP STORM', SHIP: 'BMAP V', WETR: 'WETR', ECO: 'MAP ECO'};
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
  if (/^(ECO|ECON|ECST|COUNTRIES|ЭКОНОМИКА|СТРАНЫ)$/.test(w[0])) return openMap('ECO', w.slice(1).join(' '));
  if (a && TABS.MAP.opt.some(function(id){ return id.toUpperCase() === w[0] })) { var id = w[0].toLowerCase(); M.on.MAP[id] = 1; saveOn(); return openMap('MAP') }
  openMap(a ? null : 'MAP');
}
C.MAP = mapCmd; C.BMAP = mapCmd; C['КАРТА'] = mapCmd; C['КАРТЫ'] = mapCmd;
C.STORM = function(){ openMap('STORM') }; C['ШТОРМЫ'] = C['ЦИКЛОНЫ'] = C.STORM;
C.SHIP = function(){ openMap('SHIP') }; C.VESSELS = C.SHIP; C['СУДА'] = C.SHIP; C['СУДОХОДСТВО'] = C.SHIP;
C.WETR = function(){ openMap('WETR') }; C.WEAT = C.WETR; C.WFOR = C.WETR; C['ПОГОДА'] = C.WETR;
C.ECMAP = function(arg){ openMap('ECO', arg) };

// for tests and other modules
window.MAPS = {M: M, open: openMap, layers: LAYERS, chokeData: chokeData, km: km, stormCat: stormCat,
  countryName: function(iso){ return world ? countryName(iso) : iso }};
})();
