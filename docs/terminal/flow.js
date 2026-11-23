/* Order flow of crypto markets, live from Binance's public streams (no key; the browser connects directly).
   HEAT — the order book over time (a heatmap of resting bids and asks), with every trade as a bubble
   BOOK — the order book ladder (DOM) and the tape; big trades stand out
   FOOT — footprint candles: volume sold at the bid × bought at the ask at each price, delta, imbalances, POC
   CVD  — cumulative volume delta (buyers minus sellers) under the price, from 1-minute to 1-hour bars, and big trades
   Streams: <pair>@depth@100ms (kept in order with a REST snapshot, Binance's documented way), <pair>@aggTrade;
   history: /api/v3/klines (taker buy volume gives the delta of every past bar) and /api/v3/aggTrades.
   If binance.com does not answer (some countries), Binance's market-data mirror binance.vision is used.
   Nothing is sent anywhere: it is read-only public data, and the streams close when the panel is not on screen. */
(function(){
'use strict';
var T = window.TERM, F = window.FN;
if (!T || !F) return;
var $ = T.$, el = T.el, TX = T.TX, I = T.I, fmt = T.fmt, pct = T.pct, cls = T.cls, store = T.store, clear = F.clear;

var HOSTS = [{rest: 'https://api.binance.com', ws: 'wss://stream.binance.com:9443'}, {rest: 'https://data-api.binance.vision', ws: 'wss://data-stream.binance.vision'}];
var COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'];
var fl = {tab: 'HEAT', coin: store('flow_coin') || 'BTC', tf: store('flow_tf') || '1m', ftf: '1m', host: +(store('flow_host') || 0) % HOSTS.length};
if (!/^[A-Z0-9]{2,10}$/.test(fl.coin)) fl.coin = 'BTC';
F.tabs($('flow-tabs'), 't', function(t){ fl.tab = t; render() });

function css(name, fb){ try { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fb } catch(e){ return fb } }
function C(){ return {up: css('--up', '#3fb68b'), down: css('--down', '#e5534b'), acc: css('--accent', '#d9a441'), warm: css('--warm', '#e0b23c'), text: css('--text', '#e6e9ef'), muted: css('--muted', '#8b94a3'), faint: css('--faint', '#5c6573'), bg: css('--bg', '#0e1116'), panel: css('--panel', '#12161d')} }
function alpha(hex, a){ var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim()); if (!m) return hex; var n = parseInt(m[1], 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')' }
// the heatmap scale: almost background → blue → teal → warm yellow
var HEAT = [[16, 20, 28], [28, 52, 96], [36, 110, 140], [70, 170, 140], [220, 200, 110], [250, 230, 170]];
function heat(t){ t = Math.max(0, Math.min(1, t)) * (HEAT.length - 1); var i = Math.min(HEAT.length - 2, Math.floor(t)), f = t - i, a = HEAT[i], b = HEAT[i + 1]; return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')' }
function dg(p){ return p >= 1000 ? 1 : p >= 10 ? 2 : p >= 1 ? 3 : 5 }
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
function canvasIn(wrap){
  var W = wrap.clientWidth, H = wrap.clientHeight; if (!W || !H) return null;
  var cv = wrap.querySelector('canvas'), dpr = window.devicePixelRatio || 1;
  if (!cv) { cv = el('canvas'); wrap.appendChild(cv) }
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr) }
  var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  g.font = '11px ' + getComputedStyle(document.body).fontFamily; g.textBaseline = 'middle';
  return {cv: cv, g: g, W: W, H: H};
}

/* ======================= the live market (one pair at a time) ======================= */
var M = null;   // {coin, pair, ws, book:{bids:Map, asks:Map}, lastId, buf, synced, trades:[], cols:[], ...}
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

// Binance: buffer the stream, take a snapshot, drop what it already has, then apply in order (a gap → start again)
function snapshot(m){
  rest('/api/v3/depth?symbol=' + m.pair + '&limit=1000').then(function(s){
    if (M !== m) return;
    m.bids.clear(); m.asks.clear();
    (s.bids || []).forEach(function(b){ m.bids.set(+b[0], +b[1]) }); (s.asks || []).forEach(function(a){ m.asks.set(+a[0], +a[1]) });
    m.lastId = s.lastUpdateId; m.synced = true;
    var buf = m.buf; m.buf = [];
    buf.forEach(function(x){ depth(m, x) });
    status(m.pair + ' · Binance' + (fl.host ? ' (binance.vision)' : '') + ' · ' + TX('fl_live'));
    loop();
  }).catch(function(e){
    if (M !== m) return;
    // 400: Binance has no such pair — say so instead of trying again forever
    if (/HTTP 400/.test(e && e.message || '')) { status(TX('fl_nopair', m.pair), true); var ws_ = m.ws; M = null; try { ws_.onclose = null; ws_.close() } catch(x){} return }
    status(TX('fl_fail', e.message || e), true);
    // the stream of this try is closed before the next one opens (it would keep downloading the book for nothing)
    nextHost(); setTimeout(function(){ if (M === m) { var w_ = m.ws; M = null; try { w_.onclose = null; w_.close() } catch(x){} start() } }, 3000);
  });
}
function depth(m, x){
  if (!m.synced) { m.buf.push(x); if (m.buf.length > 2000) m.buf.shift(); return }
  if (x.u <= m.lastId) return;
  if (x.U > m.lastId + 1 && m.lastId) { m.synced = false; m.buf = [x]; return snapshot(m) }   // a gap: the book is no longer exact
  (x.b || []).forEach(function(b){ var p = +b[0], q = +b[1]; if (q) m.bids.set(p, q); else m.bids.delete(p) });
  (x.a || []).forEach(function(a){ var p = +a[0], q = +a[1]; if (q) m.asks.set(p, q); else m.asks.delete(p) });
  m.lastId = x.u;
}
function trade(m, x){
  var t = {t: x.T, p: +x.p, q: +x.q, sell: !!x.m};   // m = the buyer was the maker → the aggressor sold
  m.trades.push(t); if (m.trades.length > 6000) m.trades.splice(0, 1000);
  m.sizes.push(t.q); if (m.sizes.length > 3000) m.sizes.splice(0, 500);
  if (isBig(m, t)) { m.big.push(t); if (m.big.length > 200) m.big.shift() }
  addFoot(m, t);
  if (m.kl) liveBar(m, t);
}
function bestBid(m){ var b = -Infinity; m.bids.forEach(function(_, p){ if (p > b) b = p }); return b }
function bestAsk(m){ var a = Infinity; m.asks.forEach(function(_, p){ if (p < a) a = p }); return a }
// a trade is big if it is in the top 0.5% of recent sizes and worth at least $50K
function bigLimit(m){
  var now = Date.now();
  if (m.bigQ && now - m.bigAt < 2000) return m.bigQ;   // recounted at most every 2 s
  var s = m.sizes.slice().sort(function(a, b){ return a - b }); m.bigQ = s.length ? s[Math.floor(s.length * 0.995)] : Infinity; m.bigAt = now; return m.bigQ;
}
function isBig(m, t){ return t.q >= bigLimit(m) && t.q * t.p >= 50000 }
// the price step of the pictures: about 0.01% of the price, rounded to 1/2/5
function stepFor(p){ var raw = p * 0.0001, e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e; return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * e }

/* ---------- history: the last few minutes of trades and the bars ---------- */
function backfill(m){
  // up to ~8000 recent trades (BTC: a few minutes), newest page first
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
  var lvl = Math.floor(t.p / (m.step * 5)), c = b.lv[lvl] || (b.lv[lvl] = [0, 0]);   // the level's number: price = lvl × 5 steps
  if (t.sell) { c[0] += t.q; b.sell += t.q } else { c[1] += t.q; b.buy += t.q }
  b.h = Math.max(b.h, t.p); b.l = Math.min(b.l, t.p); b.c = t.p;
  var keys = Object.keys(m.foot); if (keys.length > 90) keys.sort(function(a, b2){ return a - b2 }).slice(0, keys.length - 90).forEach(function(x){ delete m.foot[x] });
}
var TF = {'1m': 60e3, '5m': 300e3, '15m': 900e3, '1h': 3600e3};
function klines(m){
  var tf = fl.tf;
  return rest('/api/v3/klines?symbol=' + m.pair + '&interval=' + tf + '&limit=500').then(function(a){
    if (M !== m) return;
    // [open time, o, h, l, c, volume, close time, quote vol, trades, taker buy base, taker buy quote, -]
    m.kl = {tf: tf, bars: a.map(function(r){ var v = +r[5], tb = +r[9]; return {t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: v, d: 2 * tb - v} })};
  });
}
function liveBar(m, t){
  var span = TF[m.kl.tf], bars = m.kl.bars, k = Math.floor(t.t / span) * span, last = bars[bars.length - 1];
  if (!last || k > last.t) { bars.push({t: k, o: t.p, h: t.p, l: t.p, c: t.p, v: 0, d: 0}); if (bars.length > 600) bars.shift(); last = bars[bars.length - 1] }
  else if (k < last.t) return;
  last.h = Math.max(last.h, t.p); last.l = Math.min(last.l, t.p); last.c = t.p; last.v += t.q; last.d += t.sell ? -t.q : t.q;
}

/* ---------- the heatmap columns: one per second ---------- */
function sample(m){
  var now = Date.now(); if (now - m.lastCol < 1000 || !m.synced) return;
  m.lastCol = now;
  var bb = bestBid(m), ba = bestAsk(m); if (!isFinite(bb) || !isFinite(ba)) return;
  var mid = (bb + ba) / 2, step = m.step || (m.step = stepFor(mid)), band = mid * 0.006, col = {t: now, bb: bb, ba: ba, mid: mid, q: {}};
  var add = function(p, q){ if (Math.abs(p - mid) > band) return; var k = Math.round(p / step); col.q[k] = (col.q[k] || 0) + q };
  m.bids.forEach(function(q, p){ add(p, q) }); m.asks.forEach(function(q, p){ add(p, q) });
  m.cols.push(col); if (m.cols.length > 900) m.cols.shift();
}

/* ======================= drawing ======================= */
// four pictures a second; a timer rather than animation frames, so the book keeps its seconds even when the
// browser skips frames (the heatmap needs one column every second)
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
  box.appendChild(f);
  var wrap = el('div', 'cv fl-cv'); box.appendChild(wrap);
  wrap.__paint = function(){ ({HEAT: paintHeat, BOOK: paintBook, FOOT: paintFoot, CVD: paintCvd}[fl.tab] || paintHeat)(wrap) };
  box.appendChild(el('div', 'note', TX('fl_note_' + fl.tab)));
  start();
  if (fl.tab === 'CVD' && M && !M.kl && M.opened) klines(M).catch(function(e){ status(TX('fl_fail', e.message || e), true) });
  if (M && M.synced) loop();
}
function setCoin(c){ fl.coin = c; store('flow_coin', c); stop(); render() }
F.RENDER['p-flow'] = function(){ if (!$('flow-body').querySelector('.fl-cv')) render(); else if (!M) start() };
document.addEventListener('visibilitychange', function(){ if (!document.hidden && F.visible('p-flow') && !M) render() });

function waiting(wrap, g, W, H){ var K = C(); g.fillStyle = K.faint; g.fillText(M && M.synced ? TX('fl_collect') : TX('fl_connecting', fl.coin + 'USDT'), 12, 16) }

// HEAT: time → right, price ↑; brightness = resting size; bubbles = trades
function paintHeat(wrap){
  var c = canvasIn(wrap); if (!c) return;
  var g = c.g, W = c.W, H = c.H, K = C(), m = M;
  if (!m || !m.cols.length) return waiting(wrap, g, W, H);
  var R = 70, PR = 90, cols = m.cols, last = cols[cols.length - 1], step = m.step;
  var plotW = W - R - PR, cw = 2, cap = Math.floor(plotW / cw), view = cols.slice(-cap), n = view.length;
  var X0 = plotW - n * cw;   // the newest second at the right edge; the left fills up as time goes
  var mid = last.mid, band = mid * 0.0035, lo = mid - band, hi = mid + band;
  var Y = function(p){ return (hi - p) / (hi - lo) * H }, rowH = Math.max(1, step / (hi - lo) * H);
  // the brightness scale: the 97th percentile of what is on screen
  var vals = []; view.forEach(function(col){ for (var k in col.q) { var p = k * step; if (p >= lo && p <= hi) vals.push(col.q[k]) } });
  vals.sort(function(a, b){ return a - b }); var top = vals[Math.floor(vals.length * 0.97)] || 1;
  g.fillStyle = 'rgb(16,20,28)'; g.fillRect(0, 0, plotW, H);
  view.forEach(function(col, i){
    var x = X0 + i * cw;
    for (var k in col.q) { var p = k * step; if (p < lo || p > hi) continue; g.fillStyle = heat(Math.sqrt(col.q[k] / top)); g.fillRect(x, Y(p) - rowH / 2, cw + 0.6, rowH + 0.6) }
  });
  // best bid and ask
  ['bb', 'ba'].forEach(function(key){
    g.beginPath(); view.forEach(function(col, i){ var y = Y(col[key]); i ? g.lineTo(X0 + (i + 1) * cw, y) : g.moveTo(X0, y) });
    g.strokeStyle = key === 'bb' ? K.up : K.down; g.lineWidth = 1.2; g.stroke(); g.lineWidth = 1;
  });
  // trades in the window
  var t0 = view[0].t, t1 = last.t, mx = 0, tr = m.trades.filter(function(t){ return t.t >= t0 - 1000 && t.p >= lo && t.p <= hi });
  tr.forEach(function(t){ if (t.q > mx) mx = t.q });
  tr.forEach(function(t){
    var x = plotW - (t1 - t.t) / 1000 * cw - cw / 2, r = Math.max(1.3, Math.sqrt(t.q / (mx || 1)) * 11);
    if (x < X0) return;
    g.beginPath(); g.arc(x, Y(t.p), r, 0, 6.283); g.fillStyle = t.sell ? alpha(K.down, isBig(m, t) ? 0.85 : 0.45) : alpha(K.up, isBig(m, t) ? 0.85 : 0.45); g.fill();
  });
  // the current book on the right
  var depthW = PR - 6, bx = plotW + 4, qmax = 0, rows = {};
  var addRow = function(p, q, side){ if (p < lo || p > hi) return; var k = Math.round(p / (step * 2)); rows[k] = rows[k] || [0, 0]; rows[k][side] += q; qmax = Math.max(qmax, rows[k][side]) };
  m.bids.forEach(function(q, p){ addRow(p, q, 0) }); m.asks.forEach(function(q, p){ addRow(p, q, 1) });
  for (var k in rows) { var y = Y(k * step * 2), bh = Math.max(1, rowH * 2 - 1); if (rows[k][0]) { g.fillStyle = alpha(K.up, 0.6); g.fillRect(bx, y - bh / 2, rows[k][0] / qmax * depthW, bh) } if (rows[k][1]) { g.fillStyle = alpha(K.down, 0.6); g.fillRect(bx, y - bh / 2, rows[k][1] / qmax * depthW, bh) } }
  // the price axis
  g.fillStyle = K.faint;
  var dd = dg(mid), tickStep = (hi - lo) / 8;
  for (var j = 0; j <= 8; j++) { var p = lo + tickStep * j; g.fillText(fmt(p, dd), W - R + 6, Y(p)) }
  g.fillStyle = K.text; g.fillRect(W - R + 2, Y(mid) - 8, R - 4, 16); g.fillStyle = K.bg; g.fillText(fmt(mid, dd), W - R + 6, Y(mid));
  g.fillStyle = K.muted; g.fillText(hms(t0) + ' → ' + hms(t1), 6, H - 8);
  c.cv.onmousemove = function(e){
    var r = c.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x > plotW) return untip();
    var i = Math.max(0, Math.min(view.length - 1, Math.floor((x - X0) / cw))), col = view[i], p = hi - y / H * (hi - lo), k = Math.round(p / step);
    tipShow([[hms(col.t)], [TX('fl_price') + ' ' + fmt(k * step, dd)], [TX('fl_resting') + ' ' + qty(col.q[k] || 0) + ' ' + m.coin]], e);
  };
  c.cv.onmouseleave = untip;
}

// BOOK: the ladder (left) and the tape (right)
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
  // traded volume at each price in the last 5 minutes
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
  // the tape
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

// FOOT: footprint candles, newest on the right
function paintFoot(wrap){
  var c = canvasIn(wrap); if (!c) return;
  var g = c.g, W = c.W, H = c.H, K = C(), m = M;
  var keys = m ? Object.keys(m.foot).map(Number).sort(function(a, b){ return a - b }) : [];
  if (!keys.length) return waiting(wrap, g, W, H);
  var R = 66, B = 34, colW = 96, n = Math.max(1, Math.min(keys.length, Math.floor((W - R) / colW))), bars = keys.slice(-n).map(function(k){ return m.foot[k] });
  var lo = Infinity, hi = -Infinity, lstep = (m.step || stepFor(bars[0].c)) * 5;
  bars.forEach(function(b){ lo = Math.min(lo, b.l); hi = Math.max(hi, b.h) });
  lo = Math.floor(lo / lstep) * lstep - lstep; hi = Math.ceil(hi / lstep) * lstep + lstep;
  var nl = Math.round((hi - lo) / lstep), rowH = (H - B - 6) / nl, Y = function(p){ return 4 + (hi - p) / (hi - lo) * (H - B - 6) }, dd = dg(bars[0].c);
  var showNums = rowH >= 11;
  bars.forEach(function(b, i){
    var x = i * colW, vmax = 0, poc = null;
    Object.keys(b.lv).forEach(function(k){ var v = b.lv[k][0] + b.lv[k][1]; if (v > vmax) { vmax = v; poc = +k } });
    Object.keys(b.lv).forEach(function(k){
      var li = +k, p = li * lstep, s = b.lv[k][0], a = b.lv[k][1], y = Y(p + lstep), h = Math.max(1, rowH - 1);
      var below = b.lv[li - 1];
      var tot = s + a, dlt = tot ? (a - s) / tot : 0;
      g.fillStyle = dlt >= 0 ? alpha(K.up, 0.12 + 0.5 * Math.abs(dlt) * Math.min(1, tot / vmax * 2)) : alpha(K.down, 0.12 + 0.5 * Math.abs(dlt) * Math.min(1, tot / vmax * 2));
      g.fillRect(x + 4, y, colW - 8, h);
      // a diagonal imbalance: buying at this price ≥ 3× selling one level lower (and the other way)
      var sb = below ? below[0] : 0;
      if (a >= 3 * Math.max(sb, 1e-9) && a > vmax * 0.05) { g.strokeStyle = K.up; g.strokeRect(x + colW / 2, y + 0.5, colW / 2 - 5, h - 1) }
      if (li === poc) { g.strokeStyle = K.warm; g.strokeRect(x + 4.5, y + 0.5, colW - 9, h - 1) }
      if (showNums) { g.fillStyle = K.down; g.textAlign = 'right'; g.fillText(qty(s), x + colW / 2 - 4, y + h / 2); g.fillStyle = K.up; g.textAlign = 'left'; g.fillText(qty(a), x + colW / 2 + 4, y + h / 2) }
    });
    // the candle body as a thin line on the left edge
    var up = b.c >= b.o; g.strokeStyle = up ? K.up : K.down; g.beginPath(); g.moveTo(x + 2, Y(b.h)); g.lineTo(x + 2, Y(b.l)); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.moveTo(x + 2, Y(b.o)); g.lineTo(x + 2, Y(b.c)); g.stroke(); g.lineWidth = 1;
    // delta and time under the candle
    var dlt = b.buy - b.sell; g.textAlign = 'center'; g.fillStyle = dlt >= 0 ? K.up : K.down; g.fillText('Δ ' + (dlt >= 0 ? '+' : '−') + qty(Math.abs(dlt)), x + colW / 2, H - B + 10);
    g.fillStyle = K.faint; g.fillText(hm(b.t), x + colW / 2, H - B + 24); g.textAlign = 'left';
  });
  g.fillStyle = K.faint; for (var j = 0; j <= nl; j += Math.max(1, Math.ceil(nl / 14))) g.fillText(fmt(lo + j * lstep, dd), W - R + 6, Y(lo + j * lstep));
  c.cv.onmousemove = function(e){
    var r = c.cv.getBoundingClientRect(), i = Math.floor((e.clientX - r.left) / colW), p = hi - (e.clientY - r.top - 4) / (H - B - 6) * (hi - lo);
    var b = bars[i]; if (!b) return untip();
    var li = Math.floor(p / lstep), lv = b.lv[li] || [0, 0];
    tipShow([[hm(b.t) + ' · ' + fmt(li * lstep, dd)], [TX('fl_sold') + ' ' + qty(lv[0]), 'down'], [TX('fl_bought') + ' ' + qty(lv[1]), 'up'], ['Δ ' + qty(lv[1] - lv[0]), cls(lv[1] - lv[0])], [TX('fl_bar_delta') + ' ' + qty(b.buy - b.sell)]], e);
  };
  c.cv.onmouseleave = untip;
}

// CVD: price (top), cumulative delta (middle), bar delta (bottom); big trades on the price
function paintCvd(wrap){
  var c = canvasIn(wrap); if (!c) return;
  var g = c.g, W = c.W, H = c.H, K = C(), m = M;
  // the bars once; after a failure, again in 15 s (not four times a second: Binance limits how often one may ask)
  if (m && !m.kl && m.opened && !m.klLoading && !(Date.now() - (m.klFailAt || 0) < 15000)) {
    m.klLoading = true;
    klines(m).catch(function(e){ m.klFailAt = Date.now(); status(TX('fl_fail', e.message || e), true) }).then(function(){ m.klLoading = false });
  }
  if (!m || !m.kl || !m.kl.bars.length) return waiting(wrap, g, W, H);
  var R = 66, L = 6, bars = m.kl.bars, n = Math.min(bars.length, Math.floor((W - L - R) / 3)), v = bars.slice(-n);
  var h1 = H * 0.55, h2 = H * 0.27, h3 = H - h1 - h2 - 18, bw = (W - L - R) / n, X = function(i){ return L + (i + 0.5) * bw };
  var lo = Infinity, hi = -Infinity; v.forEach(function(b){ lo = Math.min(lo, b.l); hi = Math.max(hi, b.h) });
  var pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
  var Y = function(p){ return 6 + (hi - p) / (hi - lo) * (h1 - 12) }, dd = dg(v[v.length - 1].c);
  for (var j = 0; j <= 4; j++) { var p = lo + (hi - lo) * j / 4; g.strokeStyle = alpha(K.text, 0.05); g.beginPath(); g.moveTo(L, Y(p)); g.lineTo(W - R, Y(p)); g.stroke(); g.fillStyle = K.faint; g.fillText(fmt(p, dd), W - R + 6, Y(p)) }
  v.forEach(function(b, i){ var up = b.c >= b.o, x = X(i); g.strokeStyle = up ? K.up : K.down; g.fillStyle = g.strokeStyle; g.beginPath(); g.moveTo(x, Y(b.h)); g.lineTo(x, Y(b.l)); g.stroke(); var y1 = Y(Math.max(b.o, b.c)), y2 = Y(Math.min(b.o, b.c)); g.fillRect(x - Math.max(0.5, bw * 0.35), y1, Math.max(1, bw * 0.7), Math.max(1, y2 - y1)) });
  // big trades since the panel opened (and the backfilled minutes)
  var t0 = v[0].t, span = TF[m.kl.tf];
  m.big.forEach(function(t){ var i = (t.t - t0) / span; if (i < 0 || i > n) return; var r = Math.max(2.5, Math.min(12, Math.sqrt(t.q * t.p / 50000) * 2)); g.beginPath(); g.arc(X(Math.floor(i)), Y(t.p), r, 0, 6.283); g.strokeStyle = t.sell ? K.down : K.up; g.lineWidth = 1.5; g.stroke(); g.lineWidth = 1 });
  // CVD
  var cum = 0, cv = v.map(function(b){ cum += b.d; return cum }), clo = Math.min.apply(null, cv.concat([0])), chi = Math.max.apply(null, cv.concat([0])), csp = (chi - clo) || 1;
  var Y2 = function(x){ return h1 + 6 + (chi - x) / csp * (h2 - 12) };
  g.strokeStyle = alpha(K.text, 0.12); g.beginPath(); g.moveTo(L, Y2(0)); g.lineTo(W - R, Y2(0)); g.stroke();
  g.beginPath(); cv.forEach(function(x, i){ i ? g.lineTo(X(i), Y2(x)) : g.moveTo(X(i), Y2(x)) }); g.strokeStyle = K.acc; g.lineWidth = 1.6; g.stroke(); g.lineWidth = 1;
  g.fillStyle = K.muted; g.fillText('CVD ' + (cum >= 0 ? '+' : '−') + qty(Math.abs(cum)) + ' ' + m.coin, L + 4, h1 + 12);
  g.fillStyle = K.faint; g.fillText(qty(chi), W - R + 6, Y2(chi)); g.fillText(qty(clo), W - R + 6, Y2(clo));
  // bar delta
  var dmax = Math.max.apply(null, v.map(function(b){ return Math.abs(b.d) })) || 1, y0 = h1 + h2 + 4 + h3 / 2;
  v.forEach(function(b, i){ var hh = b.d / dmax * (h3 / 2 - 2); g.fillStyle = b.d >= 0 ? alpha(K.up, 0.7) : alpha(K.down, 0.7); g.fillRect(X(i) - Math.max(0.5, bw * 0.35), Math.min(y0, y0 - hh), Math.max(1, bw * 0.7), Math.abs(hh)) });
  g.fillStyle = K.muted; g.fillText(TX('fl_bar_delta'), L + 4, h1 + h2 + 10);
  g.fillStyle = K.faint; g.textAlign = 'center';
  var every = Math.max(1, Math.floor(n / Math.max(2, Math.floor((W - L - R) / 80))));
  for (var i = 0; i < n; i += every) g.fillText(hm(v[i].t), X(i), H - 6);
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
// HEAT alone stays the market map (IMAP); "HEAT BTC" is the order book heatmap
var imapHeat = Cm.HEAT;
Cm.HEAT = function(a){ var s = String(a || '').trim().toUpperCase(); if (s && (COINS.indexOf(s.replace(/USDT$/, '')) >= 0 || /USDT$/.test(s))) return open('HEAT', a); return imapHeat ? imapHeat(a) : open('HEAT', a) };
Cm.OBH = function(a){ open('HEAT', a) }; Cm.BOOKMAP = Cm.OBH; Cm['СТАКАН'] = function(a){ open('BOOK', a) };
Cm.BOOK = function(a){ open('BOOK', a) }; Cm.DOM = Cm.BOOK; Cm.TAPE = Cm.BOOK;
Cm.FOOT = function(a){ open('FOOT', a) }; Cm.FOOTPRINT = Cm.FOOT; Cm['КЛАСТЕРЫ'] = Cm.FOOT;
Cm.CVD = function(a){ open('CVD', a) }; Cm.DELTA = Cm.CVD; Cm['ДЕЛЬТА'] = Cm.CVD;
Cm.FLOW = function(a){ open(fl.tab, a) }; Cm['ПОТОК'] = Cm.FLOW;
['OBH', 'BOOK', 'FOOT', 'CVD', 'FLOW', 'DOM'].forEach(function(k){ T.SUFFIX[k] = 1 });
window.FLOWX = {open: open, state: fl, stop: stop, market: function(){ return M }};
})();
