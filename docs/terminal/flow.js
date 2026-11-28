(function(){
'use strict';
var T = window.TERM, F = window.FN;
if (!T || !F) return;
var $ = T.$, el = T.el, TX = T.TX, I = T.I, fmt = T.fmt, pct = T.pct, cls = T.cls, store = T.store, clear = F.clear;

var HOSTS = [{rest: 'https://api.binance.com', ws: 'wss://stream.binance.com:9443'}, {rest: 'https://data-api.binance.vision', ws: 'wss://data-stream.binance.vision'}];
var COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'];
var fl = {tab: 'HEAT', coin: store('flow_coin') || 'BTC', tf: store('flow_tf') || '1m', ftf: '1m', host: +(store('flow_host') || 0) % HOSTS.length};
if (!/^[A-Z0-9]{2,10}$/.test(fl.coin)) fl.coin = 'BTC';
var FOOT_MULT = [20, 10, 5, 2, 1];
function zdef(){ return {HEAT: {p: 1, t: 1, off: 0, po: 0}, FOOT: {p: 2, w: 1, off: 0}, CVD: {n: 0, off: 0}} }
fl.z = zdef();
F.tabs($('flow-tabs'), 't', function(t){ fl.tab = t; render() });

function css(name, fb){ try { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fb } catch(e){ return fb } }
function C(){ return {up: css('--up', '#3fb68b'), down: css('--down', '#e5534b'), acc: css('--accent', '#d9a441'), warm: css('--warm', '#e0b23c'), text: css('--text', '#e6e9ef'), muted: css('--muted', '#8b94a3'), faint: css('--faint', '#5c6573'), bg: css('--bg', '#0e1116'), panel: css('--panel', '#12161d')} }
function alpha(hex, a){ var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim()); if (!m) return hex; var n = parseInt(m[1], 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')' }
var HEAT = [[16, 20, 28], [28, 52, 96], [36, 110, 140], [70, 170, 140], [220, 200, 110], [250, 230, 170]];
var HEAT2 = [[11, 15, 24], [18, 34, 74], [22, 70, 140], [24, 128, 170], [70, 190, 160], [236, 210, 90], [255, 246, 214]];
var LUT = (function(){
  var o = new Uint8ClampedArray(256 * 3);
  for (var i = 0; i < 256; i++) { var t = i / 255 * (HEAT2.length - 1), a = Math.min(HEAT2.length - 2, Math.floor(t)), f = t - a, A = HEAT2[a], B = HEAT2[a + 1];
    for (var c = 0; c < 3; c++) o[i * 3 + c] = Math.round(A[c] + (B[c] - A[c]) * f) }
  return o;
})();
function heat(t){ t = Math.max(0, Math.min(1, t)) * (HEAT.length - 1); var i = Math.min(HEAT.length - 2, Math.floor(t)), f = t - i, a = HEAT[i], b = HEAT[i + 1]; return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')' }
function dg(p){ return p >= 1000 ? 1 : p >= 10 ? 2 : p >= 1 ? 3 : 5 }
function label(g, text, x, y, K){ var w = g.measureText(text).width; g.fillStyle = 'rgba(14,17,22,.82)'; g.fillRect(x - 3, y - 8, w + 6, 16); g.fillStyle = K.muted; g.fillText(text, x, y) }
function niceStep(x){ var e = Math.pow(10, Math.floor(Math.log10(x))), f = x / e; return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * e }
function qty(v){ return v >= 1000 ? fmt(v, 0) : v >= 10 ? fmt(v, 1) : v >= 1 ? fmt(v, 2) : fmt(v, 3) }
function usdShort(v){ return v >= 1e6 ? '$' + fmt(v / 1e6, 2) + 'M' : v >= 1e3 ? '$' + fmt(v / 1e3, 1) + 'K' : '$' + fmt(v, 0) }
function hms(ms){ return new Date(ms).toLocaleTimeString(I.date, {hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: T.MSK}) }
function hm(ms){ return new Date(ms).toLocaleTimeString(I.date, {hour: '2-digit', minute: '2-digit', timeZone: T.MSK}) }
function tipShow(lines, e){
  var t = $('tm-tip'); clear(t);
  lines.forEach(function(l, i){ t.appendChild(el(i ? 'div' : 'b', l[1] || null, l[0])) });
  t.style.display = 'block';
  var x = e.clientX + 14, y = e.clientY + 14;
  if (x + t.offsetWidth > window.innerWidth - 6) x = e.clientX - t.offsetWidth - 14;
  if (y + t.offsetHeight > window.innerHeight - 6) y = e.clientY - t.offsetHeight - 10;
  t.style.left = x + 'px'; t.style.top = y + 'px';
}
function untip(){ $('tm-tip').style.display = 'none' }
var PXR = 1;
function px(v){ return Math.round(v * PXR) / PXR }
function canvasIn(wrap){
  var W = wrap.clientWidth, H = wrap.clientHeight; if (!W || !H) return null;
  var cv = wrap.querySelector('canvas'), dpr = window.devicePixelRatio || 1;
  if (!cv) { cv = el('canvas'); wrap.appendChild(cv) }
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr) }
  var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); PXR = dpr;
  g.font = '11px ' + getComputedStyle(document.body).fontFamily; g.textBaseline = 'middle';
  return {cv: cv, g: g, W: W, H: H};
}

/* ======================= the live market (one pair at a time) ======================= */
var M = null;
function rest(path){
  var h = HOSTS[fl.host];
  var ac = window.AbortController ? new AbortController() : null, t = ac ? setTimeout(function(){ ac.abort() }, 9000) : null;
  return fetch(h.rest + path, ac ? {signal: ac.signal} : undefined).then(function(r){ clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() },
    function(e){ clearTimeout(t); throw e });
}
function nextHost(){ fl.host = (fl.host + 1) % HOSTS.length; store('flow_host', String(fl.host)) }
function status(text, bad){ var s = $('flow-sub'); if (s) { s.textContent = text; s.style.color = bad ? 'var(--down)' : '' } }

function start(){
  if (M && M.coin === fl.coin && M.ws && M.ws.readyState <= 1) return;
  stop();
  var coin = fl.coin, pair = coin + 'USDT';
  var m = M = {coin: coin, pair: pair, bids: new Map(), asks: new Map(), lastId: 0, buf: [], synced: false, trades: [], cols: [], foot: {}, kl: null,
    sizes: [], big: [], opened: false, seq: 0, tick: 0, lastCol: 0, step: 0};
  status(TX('fl_connecting', pair));
  var h = HOSTS[fl.host], ws;
  try { ws = new WebSocket(h.ws + '/stream?streams=' + pair.toLowerCase() + '@depth@100ms/' + pair.toLowerCase() + '@aggTrade') }
  catch(e){ nextHost(); return setTimeout(start, 500) }
  m.ws = ws;
  var guard = setTimeout(function(){ if (M === m && !m.opened) { try { ws.close() } catch(e){} nextHost(); M = null; start() } }, 7000);
  ws.onopen = function(){ m.opened = true; clearTimeout(guard); snapshot(m); backfill(m) };
  ws.onmessage = function(ev){
    if (M !== m) return;
    var d; try { d = JSON.parse(ev.data) } catch(e){ return }
    var s = d && d.stream || '', x = d && d.data;
    if (!x) return;
    if (/@depth/.test(s)) depth(m, x); else if (/@aggTrade/.test(s)) trade(m, x);
  };
  ws.onerror = function(){};
  ws.onclose = function(){ if (M === m && m.opened && visibleNow()) setTimeout(function(){ if (M === m) { M = null; start() } }, 2500) };
  if (!stop.timer) stop.timer = setInterval(function(){ if (M && !visibleNow()) stop() }, 4000);
}
function stop(){ if (M && M.ws) { var w = M.ws; M = null; try { w.onclose = null; w.close() } catch(e){} } else M = null; clearInterval(loop.raf); loop.raf = 0 }
function visibleNow(){ return F.visible('p-flow') && !document.hidden }

function snapshot(m){
  m.snapAt = Date.now();
  rest('/api/v3/depth?symbol=' + m.pair + '&limit=5000').then(function(s){
    if (M !== m) return;
    m.bids.clear(); m.asks.clear();
    (s.bids || []).forEach(function(b){ m.bids.set(+b[0], +b[1]) }); (s.asks || []).forEach(function(a){ m.asks.set(+a[0], +a[1]) });
    m.lo = (s.bids || []).length ? +s.bids[s.bids.length - 1][0] : -Infinity; m.hi = (s.asks || []).length ? +s.asks[s.asks.length - 1][0] : Infinity;
    m.lastId = s.lastUpdateId; m.synced = true;
    var buf = m.buf; m.buf = [];
    buf.forEach(function(x){ depth(m, x) });
    status(m.pair + ' · Binance' + (fl.host ? ' (binance.vision)' : '') + ' · ' + TX('fl_live'));
    loop();
  }).catch(function(e){
    if (M !== m) return;
    if (/HTTP 400/.test(e && e.message || '')) { status(TX('fl_nopair', m.pair), true); var ws_ = m.ws; M = null; try { ws_.onclose = null; ws_.close() } catch(x){} return }
    status(TX('fl_fail', e.message || e), true);
    nextHost(); setTimeout(function(){ if (M === m) { var w_ = m.ws; M = null; try { w_.onclose = null; w_.close() } catch(x){} start() } }, 3000);
  });
}
function depth(m, x){
  if (!m.synced) { m.buf.push(x); if (m.buf.length > 2000) m.buf.shift(); return }
  if (x.u <= m.lastId) return;
  if (x.U > m.lastId + 1 && m.lastId) { m.synced = false; m.buf = [x]; return snapshot(m) }
  (x.b || []).forEach(function(b){ var p = +b[0], q = +b[1]; if (p < m.lo) return; if (q) m.bids.set(p, q); else m.bids.delete(p) });
  (x.a || []).forEach(function(a){ var p = +a[0], q = +a[1]; if (p > m.hi) return; if (q) m.asks.set(p, q); else m.asks.delete(p) });
  m.lastId = x.u;
}
function trade(m, x){
  var t = {t: x.T, p: +x.p, q: +x.q, sell: !!x.m};
  m.trades.push(t); if (m.trades.length > 6000) m.trades.splice(0, 1000);
  m.sizes.push(t.q); if (m.sizes.length > 3000) m.sizes.splice(0, 500);
  if (isBig(m, t)) { m.big.push(t); if (m.big.length > 200) m.big.shift() }
  addFoot(m, t);
  if (m.kl) liveBar(m, t);
}
function bestBid(m){ var b = -Infinity; m.bids.forEach(function(_, p){ if (p > b) b = p }); return b }
function bestAsk(m){ var a = Infinity; m.asks.forEach(function(_, p){ if (p < a) a = p }); return a }
function bigLimit(m){
  var now = Date.now();
  if (m.bigQ && now - m.bigAt < 2000) return m.bigQ;
  var s = m.sizes.slice().sort(function(a, b){ return a - b }); m.bigQ = s.length ? s[Math.floor(s.length * 0.995)] : Infinity; m.bigAt = now; return m.bigQ;
}
function isBig(m, t){ return t.q >= bigLimit(m) && t.q * t.p >= 50000 }
function stepFor(p){ var raw = p * 0.0001, e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e; return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * e }

/* ---------- history: the last few minutes of trades and the bars ---------- */
function backfill(m){
  var pages = 0, got = [];
  (function more(endId){
    rest('/api/v3/aggTrades?symbol=' + m.pair + '&limit=1000' + (endId != null ? '&fromId=' + Math.max(0, endId - 1000) : '')).then(function(a){
      if (M !== m || !a || !a.length) return finish();
      got = a.concat(got); pages++;
      if (pages < 8 && a[0].a > 0 && Date.now() - a[0].T < 20 * 60e3) more(a[0].a); else finish();
    }).catch(finish);
  })(null);
  function finish(){
    if (M !== m) return;
    var seen = {}, first = m.trades.length ? m.trades[0].t : Infinity;
    got.forEach(function(x){ if (seen[x.a] || x.T >= first) return; seen[x.a] = 1; var t = {t: x.T, p: +x.p, q: +x.q, sell: !!x.m}; m.sizes.push(t.q) });
    var old = got.filter(function(x){ return x.T < first }).map(function(x){ return {t: x.T, p: +x.p, q: +x.q, sell: !!x.m} });
    m.trades = old.concat(m.trades).slice(-6000);
    m.foot = {}; m.trades.forEach(function(t){ addFoot(m, t) });
    m.big = m.trades.filter(function(t){ return isBig(m, t) }).slice(-200);
  }
}
function addFoot(m, t){
  var span = fl.ftf === '5m' ? 300e3 : 60e3, k = Math.floor(t.t / span) * span;
  if (!m.step) m.step = stepFor(t.p);
  var b = m.foot[k] || (m.foot[k] = {t: k, lv: {}, o: t.p, h: t.p, l: t.p, c: t.p, buy: 0, sell: 0});
  var lvl = Math.floor(t.p / m.step), c = b.lv[lvl] || (b.lv[lvl] = [0, 0]);
  if (t.sell) { c[0] += t.q; b.sell += t.q } else { c[1] += t.q; b.buy += t.q }
  b.h = Math.max(b.h, t.p); b.l = Math.min(b.l, t.p); b.c = t.p;
  var keys = Object.keys(m.foot); if (keys.length > 90) keys.sort(function(a, b2){ return a - b2 }).slice(0, keys.length - 90).forEach(function(x){ delete m.foot[x] });
}
var TF = {'1m': 60e3, '5m': 300e3, '15m': 900e3, '1h': 3600e3};
function klines(m){
  var tf = fl.tf;
  return rest('/api/v3/klines?symbol=' + m.pair + '&interval=' + tf + '&limit=500').then(function(a){
    if (M !== m) return;
    m.kl = {tf: tf, bars: a.map(function(r){ var v = +r[5], tb = +r[9]; return {t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: v, d: 2 * tb - v} })};
  });
}
function liveBar(m, t){
  var span = TF[m.kl.tf], bars = m.kl.bars, k = Math.floor(t.t / span) * span, last = bars[bars.length - 1];
  if (!last || k > last.t) { bars.push({t: k, o: t.p, h: t.p, l: t.p, c: t.p, v: 0, d: 0}); if (bars.length > 600) bars.shift(); last = bars[bars.length - 1] }
  else if (k < last.t) return;
  last.h = Math.max(last.h, t.p); last.l = Math.min(last.l, t.p); last.c = t.p; last.v += t.q; last.d += t.sell ? -t.q : t.q;
}

/* ---------- the heatmap columns: two a second ---------- */
var SAMPLE_MS = 500, MAX_COLS = 1800, HBAND = 0.005, HBASE = 0.0015, ROW_PX = 4, CONTRAST = [0.35, 0.55, 0.7, 0.82, 0.9];
fl.con = Math.max(0, Math.min(CONTRAST.length - 1, Math.round(+(store('flow_con') || 2)) || 0));
function niceUp(x){
  if (!(x > 0)) return 0;
  var e = Math.pow(10, Math.floor(Math.log10(x))), f = Math.round(x / e * 1000) / 1000;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}
function tickOf(m){
  var ps = []; m.bids.forEach(function(_, p){ ps.push(p) }); ps.sort(function(a, b){ return b - a }); ps = ps.slice(0, 400);
  var t = Infinity; for (var i = 1; i < ps.length; i++) { var d = ps[i - 1] - ps[i]; if (d > 0 && d < t) t = d }
  return isFinite(t) ? +t.toPrecision(6) : 0;
}
function sample(m){
  var now = Date.now(); if (now - m.lastCol < SAMPLE_MS - 20 || !m.synced) return;
  m.lastCol = now;
  var bb = bestBid(m), ba = bestAsk(m); if (!isFinite(bb) || !isFinite(ba) || bb >= ba) return;
  var mid = (bb + ba) / 2;
  if (!m.hstep) { m.step = m.step || stepFor(mid); m.ptick = tickOf(m); m.hstep = niceUp(Math.max(m.step / 10, m.ptick)) }
  var hs = m.hstep, band = mid * HBAND;
  var k0 = Math.floor((mid - band) / hs), n = Math.ceil(2 * band / hs) + 2, q = new Float32Array(n);
  var add = function(qty, p){ var k = Math.floor(p / hs + 1e-7) - k0; if (k >= 0 && k < n) q[k] += qty };
  m.bids.forEach(add); m.asks.forEach(add);
  m.cols.push({t: now, bb: bb, ba: ba, mid: mid, k0: k0, q: q, klo: isFinite(m.lo) ? Math.ceil(m.lo / hs - 1e-7) : -Infinity, khi: isFinite(m.hi) ? Math.floor(m.hi / hs + 1e-7) : Infinity});
  if (m.cols.length > MAX_COLS) m.cols.splice(0, m.cols.length - MAX_COLS);
  if (now - (m.snapAt || 0) > 60e3 && (bb - m.lo < band || m.hi - ba < band)) { m.synced = false; m.buf = []; snapshot(m) }
}
function rowStep(hs, pxPer){
  var b = hs;
  for (var i = 0; i < 40; i++) {
    var r = b / hs;
    if (Math.abs(r - Math.round(r)) < 1e-6 && b * pxPer >= ROW_PX) return b;
    b = niceUp(b * 1.0001 + 1e-12);
    if (b <= hs) b = hs * 2;
  }
  return hs * Math.max(1, Math.ceil(ROW_PX / (hs * pxPer)));
}

/* ======================= drawing ======================= */
function loop(){
  if (loop.raf) return;
  loop.raf = setInterval(function(){
    if (!M) return;
    try { sample(M) } catch(e){ console.error(e) }
    if (!visibleNow()) return;
    var w = $('flow-body').querySelector('.fl-cv');
    if (w && w.__paint) try { w.__paint() } catch(e){ console.error(e) }
  }, 250);
}
function render(){
  if (!F.visible('p-flow')) return;
  var box = $('flow-body'); clear(box);
  $('flow-code').textContent = fl.tab;
  $('flow-title').textContent = TX('fl_t_' + fl.tab, fl.coin + '/USDT');
  var f = el('form', 'frm'); f.autocomplete = 'off';
  COINS.forEach(function(c){ var b = el('button', 'chipbtn' + (c === fl.coin ? ' on' : ''), c); b.type = 'button'; b.onclick = function(){ setCoin(c) }; f.appendChild(b) });
  var i = el('input', 't'); i.placeholder = TX('fl_other'); i.style.width = '80px'; i.value = COINS.indexOf(fl.coin) < 0 ? fl.coin : ''; f.appendChild(i);
  f.onsubmit = function(e){ e.preventDefault(); var v = i.value.trim().toUpperCase().replace(/(\/)?USDT$/, ''); if (/^[A-Z0-9]{2,10}$/.test(v)) setCoin(v) };
  if (fl.tab === 'CVD' || fl.tab === 'FOOT') {
    f.appendChild(el('span', 'tc-sep'));
    (fl.tab === 'CVD' ? ['1m', '5m', '15m', '1h'] : ['1m', '5m']).forEach(function(t){
      var cur = fl.tab === 'CVD' ? fl.tf : fl.ftf, b = el('button', 'chipbtn' + (t === cur ? ' on' : ''), t); b.type = 'button';
      b.onclick = function(){
        if (fl.tab === 'CVD') { fl.tf = t; store('flow_tf', t); if (M) { M.kl = null; klines(M).catch(function(){}) } }
        else { fl.ftf = t; if (M) { M.foot = {}; M.trades.forEach(function(x){ addFoot(M, x) }) } }
        render();
      };
      f.appendChild(b);
    });
  }
  var wrap = el('div', 'cv fl-cv');
  if (fl.tab !== 'BOOK') {
    var zc = el('div', 'zctl z-' + fl.tab); wrap.appendChild(zc);
    [['−', -1, 'zoom_out_t'], ['＋', 1, 'zoom_in_t'], ['⟲', 0, 'zoom_reset_t']].forEach(function(z){
      var b = el('button', 'chipbtn zb', z[0]); b.type = 'button'; b.title = TX(z[2]) + ' — ' + TX('fl_zoom_hint_' + (fl.tab === 'CVD' ? 'CVD' : 'XY'));
      b.onclick = function(){ if (z[1]) zoomBy(z[1], false); else fl.z[fl.tab] = zdef()[fl.tab]; repaint() };
      zc.appendChild(b);
    });
    if (fl.tab === 'HEAT') {
      var cb = el('button', 'chipbtn zb', '◐'); cb.type = 'button'; cb.title = TX('fl_contrast_t');
      cb.onclick = function(){ fl.con = (fl.con + 1) % CONTRAST.length; store('flow_con', String(fl.con)); if (M) M._lv = null; repaint() };
      zc.appendChild(cb);
    }
  }
  box.appendChild(f);
  box.appendChild(wrap);
  wrap.__paint = function(){ ({HEAT: paintHeat, BOOK: paintBook, FOOT: paintFoot, CVD: paintCvd}[fl.tab] || paintHeat)(wrap) };
  var repaint = function(){ try { wrap.__paint() } catch(e){ console.error(e) } };
  if (fl.tab !== 'BOOK') zoomable(wrap, repaint);
  var note = el('div', 'note', TX('fl_note_' + fl.tab));
  if (fl.tab !== 'BOOK') { note.appendChild(el('br')); note.appendChild(el('b', 'zhint', '🔍 ' + TX('fl_zoom_hint_' + (fl.tab === 'CVD' ? 'CVD' : 'XY')))) }
  box.appendChild(note);
  start();
  if (fl.tab === 'CVD' && M && !M.kl && M.opened) klines(M).catch(function(e){ status(TX('fl_fail', e.message || e), true) });
  if (M && M.synced) loop();
}
function setCoin(c){ fl.coin = c; store('flow_coin', c); fl.z = zdef(); stop(); render() }
function zoomBy(dir, shift){
  var z = fl.z[fl.tab], k = dir > 0 ? 1.25 : 0.8;
  if (fl.tab === 'HEAT') { if (shift) z.t = Math.max(0.34, Math.min(8, z.t * k)); else z.p *= k }
  else if (fl.tab === 'FOOT') { if (shift) z.w = Math.max(0.6, Math.min(2.2, z.w * k)); else z.p = Math.max(0, Math.min(FOOT_MULT.length - 1, z.p + dir)) }
  else if (fl.tab === 'CVD') z.n = (z.n || 160) / k;
}
function zoomable(wrap, repaint){
  var wheelAt = 0;
  wrap.addEventListener('wheel', function(e){
    e.preventDefault();
    if (fl.tab === 'FOOT' && !e.shiftKey && Date.now() - wheelAt < 180) return;
    wheelAt = Date.now(); zoomBy(e.deltaY < 0 ? 1 : -1, e.shiftKey); untip(); repaint();
  }, {passive: false});
  wrap.addEventListener('dblclick', function(e){ if (e.target.closest('.zctl')) return; fl.z[fl.tab] = zdef()[fl.tab]; repaint() });
  var pts = {}, drag = null, pinch = null;
  function two(){ var k = Object.keys(pts); return k.length === 2 ? [pts[k[0]], pts[k[1]]] : null }
  wrap.addEventListener('pointerdown', function(e){
    if ((e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('.zctl')) return;
    pts[e.pointerId] = {x: e.clientX, y: e.clientY};
    try { wrap.setPointerCapture(e.pointerId) } catch(err){}
    var p2 = two();
    if (p2) { drag = null; pinch = {d: Math.hypot(p2[0].x - p2[1].x, p2[0].y - p2[1].y), side: Math.abs(p2[0].x - p2[1].x) > Math.abs(p2[0].y - p2[1].y)}; return }
    var z = fl.z[fl.tab], H = wrap.clientHeight, W = wrap.clientWidth, m = M;
    drag = {x0: e.clientX, y0: e.clientY, off0: z.off, po0: z.po || 0,
      perX: fl.tab === 'HEAT' ? 1 / (1.5 * z.t) : fl.tab === 'FOOT' ? 1 / Math.round(96 * z.w) : (z.n || 160) / Math.max(1, W - 72),
      perY: fl.tab === 'HEAT' && m && m.cols.length ? 2 * m.cols[m.cols.length - 1].mid * HBASE / z.p / Math.max(1, H - 18) : 0};
    wrap.classList.add('grabbing');
  });
  wrap.addEventListener('pointermove', function(e){
    if (!pts[e.pointerId]) return;
    pts[e.pointerId] = {x: e.clientX, y: e.clientY};
    var z = fl.z[fl.tab], p2 = two();
    if (p2 && pinch) {
      var d = Math.hypot(p2[0].x - p2[1].x, p2[0].y - p2[1].y);
      if (d > pinch.d * 1.18 || d < pinch.d / 1.18) { zoomBy(d > pinch.d ? 1 : -1, pinch.side); pinch.d = d; untip(); repaint() }
      return;
    }
    if (!drag) return;
    z.off = drag.off0 + (e.clientX - drag.x0) * drag.perX; if (drag.perY) z.po = drag.po0 + (e.clientY - drag.y0) * drag.perY;
    untip(); repaint();
  });
  function up(e){ delete pts[e.pointerId]; if (!two()) pinch = null; drag = null; wrap.classList.remove('grabbing') }
  wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
}
F.RENDER['p-flow'] = function(){ if (!$('flow-body').querySelector('.fl-cv')) render(); else if (!M) start() };
document.addEventListener('visibilitychange', function(){ if (!document.hidden && F.visible('p-flow') && !M) render() });

function waiting(wrap, g, W, H){ var K = C(); g.fillStyle = K.faint; g.fillText(M && M.synced ? TX('fl_collect') : TX('fl_connecting', fl.coin + 'USDT'), 12, 16) }

function paintHeat(wrap){
  var c = canvasIn(wrap); if (!c) return;
  var g = c.g, W = c.W, H = c.H, K = C(), m = M;
  if (!m || !m.cols.length || !m.hstep) return waiting(wrap, g, W, H);
  var R = 76, PR = 104, B = 18, cols = m.cols, cur = cols[cols.length - 1], hs = m.hstep, z = fl.z.HEAT, plotW = W - R - PR, plotH = H - B;
  var cw = 1.5 * z.t, cap = Math.max(1, Math.floor(plotW / cw));
  z.off = Math.max(0, Math.min(Math.round(z.off), cols.length - Math.min(cap, cols.length)));
  var view = cols.slice(Math.max(0, cols.length - cap - z.off), cols.length - z.off), n = view.length, last = view[n - 1];
  var X0 = plotW - n * cw;
  z.p = Math.max(HBASE / HBAND, Math.min(Math.max(1, cur.mid * HBASE / (8 * hs)), z.p));
  var bandMax = cur.mid * HBAND * 0.98;
  z.po = Math.max(-bandMax, Math.min(bandMax, z.po));
  var mid = cur.mid + z.po, band = cur.mid * HBASE / z.p, lo = mid - band, hi = mid + band;
  var pxPer = plotH / (hi - lo), Y = function(p){ return (hi - p) * pxPer };
  var bstep = rowStep(hs, pxPer), bin = Math.max(1, Math.round(bstep / hs)), rowH = bstep * pxPer;
  var bLo = Math.floor(lo / bstep + 1e-9), bHi = Math.ceil(hi / bstep - 1e-9), nr = Math.max(1, bHi - bLo);
  var vals = new Float32Array(n * nr);
  for (var i = 0; i < n; i++) {
    var col = view[i], q = col.q, base = col.k0;
    for (var r = 0; r < nr; r++) {
      var k1 = (bLo + r) * bin, v = 0, known = false;
      for (var k = k1; k < k1 + bin; k++) { if (k < col.klo || k > col.khi) continue; var ix = k - base; if (ix >= 0 && ix < q.length) { v += q[ix]; known = true } }
      vals[i * nr + r] = known ? v : -1;
    }
  }
  var pos = [], stride = Math.max(1, Math.floor(vals.length / 8000));
  for (var j = 0; j < vals.length; j += stride) if (vals[j] > 0) pos.push(vals[j]);
  pos.sort(function(a, b){ return a - b });
  var f0 = pos.length ? pos[Math.floor((pos.length - 1) * CONTRAST[fl.con])] : 1, t0 = pos.length ? pos[Math.floor((pos.length - 1) * 0.997)] : 1;
  if (!(t0 > f0 * 1.5)) t0 = f0 * 1.5;
  var lv = m._lv, key = bstep + ':' + fl.con;
  if (lv && lv.key === key && f0 / lv.f < 3 && lv.f / f0 < 3) { lv.f += (f0 - lv.f) * 0.2; lv.t += (t0 - lv.t) * 0.2 } else lv = m._lv = {key: key, f: f0, t: t0};
  var fl_ = lv.f, top = Math.max(lv.t, fl_ * 1.5);
  var shade = function(v){ return v <= 0 ? 0 : v <= fl_ ? 0.12 * v / fl_ : Math.min(1, 0.12 + 0.88 * Math.pow((v - fl_) / (top - fl_), 0.55)) };
  var off = m._hc || (m._hc = document.createElement('canvas'));
  if (off.width !== Math.max(1, n) || off.height !== nr) { off.width = Math.max(1, n); off.height = nr }
  var og = off.getContext('2d'), img = og.createImageData(Math.max(1, n), nr), d = img.data;
  for (var i2 = 0; i2 < n; i2++) for (var r2 = 0; r2 < nr; r2++) {
    var v2 = vals[i2 * nr + r2], o = ((nr - 1 - r2) * n + i2) * 4;
    if (v2 < 0) { d[o] = 26; d[o + 1] = 28; d[o + 2] = 33; d[o + 3] = 255; continue }
    var li = Math.round(shade(v2) * 255) * 3;
    d[o] = LUT[li]; d[o + 1] = LUT[li + 1]; d[o + 2] = LUT[li + 2]; d[o + 3] = 255;
  }
  og.putImageData(img, 0, 0);
  g.fillStyle = 'rgb(10,13,20)'; g.fillRect(0, 0, plotW, plotH);
  if (n) { g.imageSmoothingEnabled = false; g.drawImage(off, 0, 0, n, nr, X0, Y(bHi * bstep), n * cw, nr * rowH); g.imageSmoothingEnabled = true }
  var dd = dg(mid), tickStep = niceStep((hi - lo) / Math.max(4, Math.floor(plotH / 42)));
  if (tickStep < bstep) tickStep = bstep;
  var tdd = Math.max(0, Math.min(8, Math.ceil(-Math.log10(Math.min(tickStep, bstep)) - 1e-9)));
  g.fillStyle = alpha(K.text, 0.06);
  for (var p = Math.ceil(lo / tickStep) * tickStep; p <= hi; p += tickStep) g.fillRect(0, px(Y(p)), plotW, 1);
  ['bb', 'ba'].forEach(function(key2){
    g.beginPath(); view.forEach(function(col, i){ var y = px(Y(col[key2])) + 0.5; if (i) g.lineTo(X0 + i * cw, y); else g.moveTo(X0, y); g.lineTo(X0 + (i + 1) * cw, y) });
    g.strokeStyle = key2 === 'bb' ? K.up : K.down; g.lineWidth = 1.5; g.lineJoin = 'miter'; g.stroke(); g.lineWidth = 1;
  });
  var t1 = last.t, tLeft = t1 - (plotW / cw) * SAMPLE_MS, X = function(t){ return plotW - (t1 - t) / SAMPLE_MS * cw - cw / 2 };
  var tr = m.trades.filter(function(t){ return t.t >= tLeft && t.t <= t1 + SAMPLE_MS && t.p >= lo && t.p <= hi });
  if (X0 > 4) {
    g.beginPath(); var started = false;
    tr.forEach(function(t){ var x = X(t.t); if (x > X0) return; if (started) g.lineTo(x, Y(t.p)); else { g.moveTo(x, Y(t.p)); started = true } });
    g.strokeStyle = alpha(K.text, 0.35); g.lineWidth = 1; g.stroke();
    if (X0 > 150) { g.fillStyle = K.faint; g.textAlign = 'center'; g.fillText(TX('fl_heat_filling', Math.round(n * SAMPLE_MS / 1000)), X0 / 2, 34); g.textAlign = 'left' }
  }
  var tb = Math.max(1, Math.ceil(7 / cw)), agg = {}, amax = 0;
  tr.forEach(function(t){
    var ci = Math.floor((t1 - t.t) / SAMPLE_MS / tb), ri = Math.floor(t.p / bstep + 1e-9), k3 = ci + ':' + ri + ':' + (t.sell ? 1 : 0);
    var a = agg[k3] || (agg[k3] = {ci: ci, ri: ri, sell: t.sell, q: 0, big: false});
    a.q += t.q; if (isBig(m, t)) a.big = true; if (a.q > amax) amax = a.q;
  });
  var rMax = Math.max(6, Math.min(14, rowH * 2.5));
  Object.keys(agg).map(function(k4){ return agg[k4] }).sort(function(a, b){ return a.q - b.q }).forEach(function(a){
    var x = plotW - (a.ci + 0.5) * tb * cw, y = Y((a.ri + 0.5) * bstep), r = Math.max(1.3, Math.sqrt(a.q / (amax || 1)) * rMax);
    if (x < 0 || x > plotW) return;
    g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fillStyle = alpha(a.sell ? K.down : K.up, a.big ? 0.92 : r < 2.5 ? 0.4 : 0.62); g.fill();
    if (a.big) { g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.2; g.stroke(); g.lineWidth = 1 }
  });
  var depthW = PR - 8, bx = plotW + 4, qmax = 0, rows = {};
  var addRow = function(q2, p2, side){ if (p2 < lo || p2 > hi) return; var b2 = Math.floor(p2 / bstep + 1e-9); var rr = rows[b2] || (rows[b2] = [0, 0]); rr[side] += q2; if (rr[side] > qmax) qmax = rr[side] };
  m.bids.forEach(function(q2, p2){ addRow(q2, p2, 0) }); m.asks.forEach(function(q2, p2){ addRow(q2, p2, 1) });
  g.fillStyle = 'rgb(13,16,22)'; g.fillRect(plotW, 0, PR, plotH);
  var rh = Math.max(1, rowH - (rowH >= 5 ? 1 : 0)), walls = [[], []];
  for (var b in rows) {
    var y2 = Y((+b + 1) * bstep);
    for (var sd = 0; sd < 2; sd++) if (rows[b][sd]) {
      g.fillStyle = alpha(sd ? K.down : K.up, 0.7); g.fillRect(bx, y2, Math.max(1, rows[b][sd] / qmax * depthW), rh);
      walls[sd].push([rows[b][sd], +b]);
    }
  }
  g.font = '10px ' + getComputedStyle(document.body).fontFamily;
  walls.forEach(function(list, sd){
    list.sort(function(a, b3){ return b3[0] - a[0] }).slice(0, 3).forEach(function(wl){
      var y3 = Y((wl[1] + 0.5) * bstep); if (y3 < 6 || y3 > plotH - 6) return;
      var txt = qty(wl[0]), tw = g.measureText(txt).width, x3 = Math.min(bx + wl[0] / qmax * depthW + 3, plotW + PR - tw - 3);
      g.fillStyle = 'rgba(10,13,20,.8)'; g.fillRect(x3 - 2, y3 - 6, tw + 4, 12);
      g.fillStyle = sd ? K.down : K.up; g.fillText(txt, x3, y3);
      g.fillStyle = alpha(sd ? K.down : K.up, 0.55); g.fillRect(plotW - 5, px(y3) - 1, 5, 2);
    });
  });
  g.font = '11px ' + getComputedStyle(document.body).fontFamily;
  g.fillStyle = K.faint;
  for (var p2b = Math.ceil(lo / tickStep) * tickStep; p2b <= hi; p2b += tickStep) { var ty = Y(p2b); if (ty > 8 && ty < plotH - 8) g.fillText(fmt(p2b, tdd), W - R + 6, ty) }
  var py = Math.max(8, Math.min(plotH - 8, Y(cur.mid)));
  g.fillStyle = K.text; g.fillRect(W - R + 2, py - 8, R - 4, 16); g.fillStyle = K.bg; g.fillText(fmt(cur.mid, Math.max(dd, tdd)), W - R + 6, py);
  var hv = fl.hov;
  if (hv && hv.x >= X0 && hv.x <= plotW && hv.y >= 0 && hv.y <= plotH) {
    var hr = Math.floor((hi - hv.y / pxPer) / bstep + 1e-9), hy = Y((hr + 1) * bstep);
    g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(0, hy, plotW + PR, Math.max(1, rowH));
    g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(px(hv.x), 0, 1, plotH);
    var hp = (hr + 0.5) * bstep, hyc = Math.max(8, Math.min(plotH - 8, hy + rowH / 2));
    g.fillStyle = K.acc; g.fillRect(W - R + 2, hyc - 8, R - 4, 16); g.fillStyle = K.bg; g.fillText(fmt(hr * bstep, tdd), W - R + 6, hyc);
  }
  var steps = [5, 10, 15, 30, 60, 120, 300, 600], pxs = cw * 1000 / SAMPLE_MS, ts = steps.filter(function(s_){ return s_ * pxs >= 80 })[0] || 900;
  g.fillStyle = 'rgb(13,16,22)'; g.fillRect(0, plotH, W, B); g.fillStyle = K.faint; g.textAlign = 'center';
  for (var tt = Math.floor(t1 / (ts * 1000)) * ts * 1000; tt >= tLeft; tt -= ts * 1000) {
    var xx = X(tt) + cw / 2; if (xx < 24 || xx > plotW - 24) continue;
    g.fillRect(px(xx), plotH, 1, 4); g.fillText(ts >= 60 ? hm(tt) : hms(tt), xx, plotH + 11);
  }
  g.textAlign = 'left';
  var lgx = plotW + 4, lgy = plotH + 6, lgw = 44, la = qty(fl_), lb = qty(top) + ' ' + m.coin;
  g.font = '10px ' + getComputedStyle(document.body).fontFamily;
  g.fillStyle = K.faint; g.fillText(la, lgx, lgy + 4);
  var gx = lgx + g.measureText(la).width + 4, gr = g.createLinearGradient(gx, 0, gx + lgw, 0);
  for (var gs = 0; gs <= 6; gs++) { var gi = Math.round(shade(fl_ + (top - fl_) * Math.pow(gs / 6, 1 / 0.55)) * 255) * 3; gr.addColorStop(gs / 6, 'rgb(' + LUT[gi] + ',' + LUT[gi + 1] + ',' + LUT[gi + 2] + ')') }
  g.fillStyle = gr; g.fillRect(gx, lgy, lgw, 8);
  g.fillStyle = K.faint; g.fillText(lb, gx + lgw + 4, lgy + 4);
  g.font = '11px ' + getComputedStyle(document.body).fontFamily;
  label(g, TX('fl_row') + ' ' + fmt(bstep, Math.max(0, Math.ceil(-Math.log10(bstep) - 1e-9))) + ' · ◐ ' + (fl.con + 1) + '/' + CONTRAST.length, 6, 12, K);
  if (z.off) label(g, '⟲ ' + hms(t1), 6, plotH - 10, K);
  c.cv.onmousemove = function(e){
    var rc = c.cv.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top;
    fl.hov = {x: x, y: y};
    if (!paintHeat.raf) paintHeat.raf = requestAnimationFrame(function(){ paintHeat.raf = 0; if (wrap.__paint) try { wrap.__paint() } catch(err){} });
    if (x > plotW || y > plotH || x < X0) return untip();
    var i = Math.max(0, Math.min(n - 1, Math.floor((x - X0) / cw))), col = view[i], rr = Math.floor((hi - y / pxPer) / bstep + 1e-9) - bLo;
    if (rr < 0 || rr >= nr) return untip();
    var v = vals[i * nr + rr], p0 = (bLo + rr) * bstep, pm = p0 + bstep / 2, side = pm < col.mid ? TX('fl_bids') : TX('fl_asks');
    tipShow([[hms(col.t)], [TX('fl_price') + ' ' + fmt(p0, tdd) + ' – ' + fmt(p0 + bstep, tdd)],
      [v < 0 ? TX('fl_unknown') : TX('fl_resting') + ' ' + qty(v) + ' ' + m.coin + ' · ' + usdShort(v * pm) + ' · ' + side],
      [TX('fl_dist') + ' ' + (pm >= col.mid ? '+' : '') + fmt((pm / col.mid - 1) * 100, 3) + '%', 'muted']], e);
  };
  c.cv.onmouseleave = function(){ fl.hov = null; untip() };
}

function paintBook(wrap){
  var c = canvasIn(wrap); if (!c) return;
  var g = c.g, W = c.W, H = c.H, K = C(), m = M;
  if (!m || !m.synced) return waiting(wrap, g, W, H);
  var bb = bestBid(m), ba = bestAsk(m), mid = (bb + ba) / 2, dd = dg(mid), grp = (m.step || stepFor(mid)) * 5;
  var tapeW = Math.min(330, Math.max(240, W * 0.42)), LW = W - tapeW - 10, rowH = 16, n = Math.max(6, Math.floor((H - 40) / rowH / 2));
  var levels = function(map, side){ var out = {}; map.forEach(function(q, p){ var k = side ? Math.ceil(p / grp) * grp : Math.floor(p / grp) * grp; out[k] = (out[k] || 0) + q }); return out };
  var B = levels(m.bids, 0), A = levels(m.asks, 1);
  var bk = Object.keys(B).map(Number).sort(function(a, b){ return b - a }).slice(0, n), ak = Object.keys(A).map(Number).sort(function(a, b){ return a - b }).slice(0, n);
  var qmax = Math.max.apply(null, bk.map(function(k){ return B[k] }).concat(ak.map(function(k){ return A[k] }))) || 1;
  var since = Date.now() - 300e3, tv = {}; m.trades.forEach(function(t){ if (t.t < since) return; var k = Math.round(t.p / grp) * grp; tv[k] = (tv[k] || 0) + t.q });
  var tvmax = Math.max.apply(null, Object.keys(tv).map(function(k){ return tv[k] }).concat([1]));
  var cy = 26 + n * rowH, colP = LW * 0.42, barW = LW * 0.36;
  g.fillStyle = K.faint; g.fillText(TX('fl_bids'), 8, 10); g.fillText(TX('fl_price'), colP - 20, 10); g.fillText(TX('fl_asks'), colP + 60, 10); g.fillText(TX('fl_traded5'), LW - 70, 10);
  var drawRow = function(k, q, y, side){
    var w = q / qmax * barW;
    g.fillStyle = alpha(side ? K.down : K.up, 0.28); side ? g.fillRect(colP + 54, y - rowH / 2 + 1, w, rowH - 2) : g.fillRect(colP - 6 - w, y - rowH / 2 + 1, w, rowH - 2);
    g.fillStyle = side ? K.down : K.up; g.textAlign = side ? 'left' : 'right'; g.fillText(qty(q), side ? colP + 58 : colP - 10, y);
    g.textAlign = 'center'; g.fillStyle = K.text; g.fillText(fmt(k, dd), colP + 24, y); g.textAlign = 'left';
    var v = tv[k]; if (v) { g.fillStyle = alpha(K.acc, 0.35); g.fillRect(LW - 70, y - 4, v / tvmax * 64, 8) }
  };
  ak.forEach(function(k, i){ drawRow(k, A[k], cy - (i + 1) * rowH, 1) });
  bk.forEach(function(k, i){ drawRow(k, B[k], cy + (i + 1) * rowH, 0) });
  g.fillStyle = K.muted; g.textAlign = 'center';
  var spread = ba - bb, imb = (function(){ var b = 0, a = 0, lim = mid * 0.001; m.bids.forEach(function(q, p){ if (mid - p <= lim) b += q }); m.asks.forEach(function(q, p){ if (p - mid <= lim) a += q }); return b + a ? (b - a) / (b + a) * 100 : 0 })();
  g.fillText(TX('fl_spread') + ' ' + fmt(spread, dd + 1) + ' · ' + TX('fl_imb') + ' ' + pct(imb, 0), colP + 24, cy);
  g.textAlign = 'left';
  var tx = LW + 10, rows2 = Math.floor((H - 20) / 15), list = m.trades.slice(-rows2).reverse();
  g.fillStyle = K.faint; g.fillText(TX('fl_tape'), tx, 10);
  list.forEach(function(t, i){
    var y = 26 + i * 15, big = isBig(m, t);
    if (big) { g.fillStyle = alpha(t.sell ? K.down : K.up, 0.22); g.fillRect(tx - 4, y - 7, tapeW, 14) }
    g.fillStyle = K.faint; g.fillText(hms(t.t), tx, y);
    g.fillStyle = t.sell ? K.down : K.up; g.fillText(fmt(t.p, dd), tx + 64, y);
    g.textAlign = 'right'; g.fillText(qty(t.q), tx + tapeW - 78, y); g.fillStyle = big ? K.text : K.faint; g.fillText(usdShort(t.q * t.p), tx + tapeW - 8, y); g.textAlign = 'left';
  });
}

function paintFoot(wrap){
  var c = canvasIn(wrap); if (!c) return;
  var g = c.g, W = c.W, H = c.H, K = C(), m = M;
  var keys = m ? Object.keys(m.foot).map(Number).sort(function(a, b){ return a - b }) : [];
  if (!keys.length) return waiting(wrap, g, W, H);
  var z = fl.z.FOOT, R = 66, B = 34, colW = Math.round(96 * z.w), cap = Math.max(1, Math.floor((W - R) / colW));
  z.off = Math.max(0, Math.min(Math.round(z.off), keys.length - Math.min(cap, keys.length)));
  var sel = keys.slice(Math.max(0, keys.length - cap - z.off), keys.length - z.off), n = sel.length;
  var mult = FOOT_MULT[z.p], bars = sel.map(function(k){
    var b = m.foot[k], lv = {};
    Object.keys(b.lv).forEach(function(x){ var gi = Math.floor(+x / mult), c = lv[gi] || (lv[gi] = [0, 0]); c[0] += b.lv[x][0]; c[1] += b.lv[x][1] });
    return {t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, buy: b.buy, sell: b.sell, lv: lv};
  });
  var lo = Infinity, hi = -Infinity, lstep = (m.step || stepFor(bars[0].c)) * mult;
  bars.forEach(function(b){ lo = Math.min(lo, b.l); hi = Math.max(hi, b.h) });
  lo = Math.floor(lo / lstep) * lstep - lstep; hi = Math.ceil(hi / lstep) * lstep + lstep;
  var nl = Math.round((hi - lo) / lstep), rowH = (H - B - 6) / nl, Y = function(p){ return 4 + (hi - p) / (hi - lo) * (H - B - 6) }, dd = dg(bars[0].c);
  var YP = function(p){ return px(Y(p)) }, showNums = rowH >= 11 && colW >= 70;
  g.font = (rowH >= 15 ? '11px ' : '10px ') + g.font.replace(/^\S+\s+/, '');
  bars.forEach(function(b, i){
    var x = i * colW, vmax = 0, poc = null;
    Object.keys(b.lv).forEach(function(k){ var v = b.lv[k][0] + b.lv[k][1]; if (v > vmax) { vmax = v; poc = +k } });
    Object.keys(b.lv).forEach(function(k){
      var li = +k, p = li * lstep, s = b.lv[k][0], a = b.lv[k][1], y = YP(p + lstep), h = Math.max(1 / PXR, YP(p) - y - (rowH >= 4 ? 1 : 0));
      var below = b.lv[li - 1];
      var tot = s + a, dlt = tot ? (a - s) / tot : 0;
      g.fillStyle = dlt >= 0 ? alpha(K.up, 0.12 + 0.5 * Math.abs(dlt) * Math.min(1, tot / vmax * 2)) : alpha(K.down, 0.12 + 0.5 * Math.abs(dlt) * Math.min(1, tot / vmax * 2));
      g.fillRect(x + 6, y, colW - 10, h);
      var sb = below ? below[0] : 0;
      if (h >= 3 && a >= 3 * Math.max(sb, 1e-9) && a > vmax * 0.05) { g.strokeStyle = K.up; g.strokeRect(Math.round(x + colW / 2) + 0.5, y + 0.5, Math.round(colW / 2) - 5, h - 1) }
      if (li === poc) { g.strokeStyle = K.warm; g.strokeRect(x + 6.5, y + 0.5, colW - 11, Math.max(1, h - 1)) }
      if (showNums) { g.fillStyle = K.down; g.textAlign = 'right'; g.fillText(qty(s), x + colW / 2 - 4, y + h / 2); g.fillStyle = K.up; g.textAlign = 'left'; g.fillText(qty(a), x + colW / 2 + 4, y + h / 2) }
    });
    var up = b.c >= b.o; g.fillStyle = up ? K.up : K.down; g.fillRect(x + 2, YP(b.h), 1, Math.max(1, YP(b.l) - YP(b.h)));
    var by = YP(Math.max(b.o, b.c)); g.fillRect(x + 1, by, 3, Math.max(1, YP(Math.min(b.o, b.c)) - by));
    if (i) { g.fillStyle = alpha(K.text, 0.05); g.fillRect(x, 0, 1, H - B) }
    var dlt = b.buy - b.sell; g.textAlign = 'center'; g.fillStyle = dlt >= 0 ? K.up : K.down; g.fillText('Δ ' + (dlt >= 0 ? '+' : '−') + qty(Math.abs(dlt)), x + colW / 2, H - B + 10);
    g.fillStyle = K.faint; g.fillText(hm(b.t), x + colW / 2, H - B + 24); g.textAlign = 'left';
  });
  g.fillStyle = K.faint; for (var j = 0; j <= nl; j += Math.max(1, Math.ceil(nl / 14))) g.fillText(fmt(lo + j * lstep, lstep < 1 ? dd : Math.max(0, dd - 1)), W - R + 6, Y(lo + j * lstep));
  var lb = bars[n - 1], lyy = YP(lb.c); g.fillStyle = lb.c >= lb.o ? K.up : K.down; g.fillRect(W - R + 2, lyy - 8, R - 4, 16); g.fillStyle = K.bg; g.fillText(fmt(lb.c, dd), W - R + 6, lyy);
  label(g, TX('fl_row') + ' ' + fmt(lstep, lstep < 1 ? dd : 0) + (z.off ? ' ⟲' : ''), W - R + 4, H - 12, K);
  c.cv.onmousemove = function(e){
    var r = c.cv.getBoundingClientRect(), i = Math.floor((e.clientX - r.left) / colW), p = hi - (e.clientY - r.top - 4) / (H - B - 6) * (hi - lo);
    var b = bars[i]; if (!b) return untip();
    var li = Math.floor(p / lstep), lv = b.lv[li] || [0, 0];
    tipShow([[hm(b.t) + ' · ' + fmt(li * lstep, dd)], [TX('fl_sold') + ' ' + qty(lv[0]), 'down'], [TX('fl_bought') + ' ' + qty(lv[1]), 'up'], ['Δ ' + qty(lv[1] - lv[0]), cls(lv[1] - lv[0])], [TX('fl_bar_delta') + ' ' + qty(b.buy - b.sell)]], e);
  };
  c.cv.onmouseleave = untip;
}

function paintCvd(wrap){
  var c = canvasIn(wrap); if (!c) return;
  var g = c.g, W = c.W, H = c.H, K = C(), m = M;
  if (m && !m.kl && m.opened && !m.klLoading && !(Date.now() - (m.klFailAt || 0) < 15000)) {
    m.klLoading = true;
    klines(m).catch(function(e){ m.klFailAt = Date.now(); status(TX('fl_fail', e.message || e), true) }).then(function(){ m.klLoading = false });
  }
  if (!m || !m.kl || !m.kl.bars.length) return waiting(wrap, g, W, H);
  var z = fl.z.CVD, R = 66, L = 6, bars = m.kl.bars, fit = Math.min(bars.length, Math.floor((W - L - R) / 3));
  if (!z.n) z.n = Math.min(bars.length, 160);
  z.n = Math.max(15, Math.min(fit, Math.round(z.n)));
  z.off = Math.max(0, Math.min(Math.round(z.off), bars.length - z.n));
  var v = bars.slice(bars.length - z.n - z.off, bars.length - z.off), n = v.length;
  var h1 = H * 0.55, h2 = H * 0.27, h3 = H - h1 - h2 - 18, bw = (W - L - R) / n, X = function(i){ return Math.round(L + (i + 0.5) * bw) + 0.5 };
  var lo = Infinity, hi = -Infinity; v.forEach(function(b){ lo = Math.min(lo, b.l); hi = Math.max(hi, b.h) });
  var pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
  var Y = function(p){ return 6 + (hi - p) / (hi - lo) * (h1 - 12) }, dd = dg(v[v.length - 1].c);
  var gs = niceStep((hi - lo) / 5);
  for (var p = Math.ceil(lo / gs) * gs; p <= hi; p += gs) { var gy = Math.round(Y(p)) + 0.5; if (gy > h1 - 8) continue; g.strokeStyle = alpha(K.text, 0.05); g.beginPath(); g.moveTo(L, gy); g.lineTo(W - R, gy); g.stroke(); g.fillStyle = K.faint; g.fillText(fmt(p, gs < 1 ? dd : Math.max(0, dd - 1)), W - R + 6, gy) }
  var lc = v[n - 1].c, ly = Math.round(Y(lc)) + 0.5, lup = lc >= v[n - 1].o;
  g.setLineDash([2, 3]); g.strokeStyle = alpha(lup ? K.up : K.down, 0.6); g.beginPath(); g.moveTo(L, ly); g.lineTo(W - R, ly); g.stroke(); g.setLineDash([]);
  g.fillStyle = lup ? K.up : K.down; g.fillRect(W - R + 2, ly - 8, R - 4, 16); g.fillStyle = K.bg; g.fillText(fmt(lc, dd), W - R + 6, ly);
  v.forEach(function(b, i){ var up = b.c >= b.o, x = X(i); g.strokeStyle = up ? K.up : K.down; g.fillStyle = g.strokeStyle; g.beginPath(); g.moveTo(x, Y(b.h)); g.lineTo(x, Y(b.l)); g.stroke(); var y1 = Y(Math.max(b.o, b.c)), y2 = Y(Math.min(b.o, b.c)); var bwp = Math.max(1, 2 * Math.floor(bw * 0.35) + 1), yt = Math.round(y1); g.fillRect(x - 0.5 - (bwp - 1) / 2, yt, bwp, Math.max(1, Math.round(y2) - yt)) });
  var t0 = v[0].t, span = TF[m.kl.tf];
  m.big.forEach(function(t){ var i = (t.t - t0) / span; if (i < 0 || i > n) return; var r = Math.max(2.5, Math.min(12, Math.sqrt(t.q * t.p / 50000) * 2)); g.beginPath(); g.arc(X(Math.floor(i)), Y(t.p), r, 0, 6.283); g.strokeStyle = t.sell ? K.down : K.up; g.lineWidth = 1.5; g.stroke(); g.lineWidth = 1 });
  g.strokeStyle = alpha(K.text, 0.08); g.beginPath(); g.moveTo(L, Math.round(h1) + 0.5); g.lineTo(W - R, Math.round(h1) + 0.5); g.moveTo(L, Math.round(h1 + h2) + 0.5); g.lineTo(W - R, Math.round(h1 + h2) + 0.5); g.stroke();
  var cum = 0, cv = v.map(function(b){ cum += b.d; return cum }), clo = Math.min.apply(null, cv.concat([0])), chi = Math.max.apply(null, cv.concat([0])), csp = (chi - clo) || 1;
  var Y2 = function(x){ return h1 + 6 + (chi - x) / csp * (h2 - 12) };
  g.strokeStyle = alpha(K.text, 0.12); g.beginPath(); g.moveTo(L, Y2(0)); g.lineTo(W - R, Y2(0)); g.stroke();
  g.beginPath(); cv.forEach(function(x, i){ i ? g.lineTo(X(i), Y2(x)) : g.moveTo(X(i), Y2(x)) });
  g.lineTo(X(n - 1), Y2(0)); g.lineTo(X(0), Y2(0)); g.closePath(); g.fillStyle = alpha(K.acc, 0.10); g.fill();
  g.beginPath(); cv.forEach(function(x, i){ i ? g.lineTo(X(i), Y2(x)) : g.moveTo(X(i), Y2(x)) }); g.strokeStyle = K.acc; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke(); g.lineWidth = 1;
  label(g, 'CVD ' + (cum >= 0 ? '+' : '−') + qty(Math.abs(cum)) + ' ' + m.coin, L + 4, h1 + 12, K);
  g.fillStyle = K.faint; g.fillText(qty(chi), W - R + 6, Y2(chi)); g.fillText(qty(clo), W - R + 6, Y2(clo));
  var dmax = Math.max.apply(null, v.map(function(b){ return Math.abs(b.d) })) || 1, y0 = h1 + h2 + 4 + h3 / 2;
  y0 = Math.round(y0);
  v.forEach(function(b, i){ var hh = Math.round(b.d / dmax * (h3 / 2 - 2)), bwp = Math.max(1, 2 * Math.floor(bw * 0.35) + 1); g.fillStyle = b.d >= 0 ? alpha(K.up, 0.75) : alpha(K.down, 0.75); g.fillRect(X(i) - 0.5 - (bwp - 1) / 2, Math.min(y0, y0 - hh), bwp, Math.max(1, Math.abs(hh))) });
  label(g, TX('fl_bar_delta'), L + 4, h1 + h2 + 10, K);
  g.fillStyle = K.faint; g.textAlign = 'center';
  var every = Math.max(1, Math.floor(n / Math.max(2, Math.floor((W - L - R) / 80))));
  for (var i = 0; i < n; i += every) if (X(i) > 18 && X(i) < W - R - 14) g.fillText(hm(v[i].t), X(i), H - 6);
  g.textAlign = 'left';
  c.cv.onmousemove = function(e){
    var r = c.cv.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left - L) / bw))), b = v[i];
    tipShow([[hm(b.t)], ['O ' + fmt(b.o, dd) + '  C ' + fmt(b.c, dd)], [TX('fl_vol') + ' ' + qty(b.v)], ['Δ ' + (b.d >= 0 ? '+' : '−') + qty(Math.abs(b.d)), cls(b.d)], ['CVD ' + qty(cv[i])]], e);
  };
  c.cv.onmouseleave = untip;
}

/* ======================= commands ======================= */
function open(tab, arg){
  var a = String(arg || '').trim().toUpperCase().replace(/(\/)?USDT$/, '').replace(/^BINANCE:/, '');
  if (/^[A-Z0-9]{2,10}$/.test(a) && a !== fl.coin) { fl.coin = a; store('flow_coin', a); stop() }
  fl.tab = tab; F.setTab($('flow-tabs'), 't', tab);
  T.show('p-flow'); render();
}
var Cm = T.CMDS;
var imapHeat = Cm.HEAT;
Cm.HEAT = function(a){ var s = String(a || '').trim().toUpperCase(); if (s && (COINS.indexOf(s.replace(/USDT$/, '')) >= 0 || /USDT$/.test(s))) return open('HEAT', a); return imapHeat ? imapHeat(a) : open('HEAT', a) };
Cm.OBH = function(a){ open('HEAT', a) }; Cm.BOOKMAP = Cm.OBH; Cm['СТАКАН'] = function(a){ open('BOOK', a) };
Cm.BOOK = function(a){ open('BOOK', a) }; Cm.DOM = Cm.BOOK; Cm.TAPE = Cm.BOOK;
Cm.FOOT = function(a){ open('FOOT', a) }; Cm.FOOTPRINT = Cm.FOOT; Cm['КЛАСТЕРЫ'] = Cm.FOOT;
Cm.CVD = function(a){ open('CVD', a) }; Cm.DELTA = Cm.CVD; Cm['ДЕЛЬТА'] = Cm.CVD;
Cm.FLOW = function(a){ open(fl.tab, a) }; Cm['ПОТОК'] = Cm.FLOW;
['OBH', 'BOOK', 'FOOT', 'CVD', 'FLOW', 'DOM'].forEach(function(k){ T.SUFFIX[k] = 1 });
window.FLOWX = {open: open, state: fl, stop: stop, market: function(){ return M }, sample: function(){ if (M) sample(M) }};
})();
