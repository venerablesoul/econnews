/* Technical analysis and trading-day functions.
   TECH / G / GPO / GPC / GIP / TA / IND — the terminal's own chart: candles, bars or a line; moving averages, Bollinger bands,
     VWAP, volume, RSI, MACD, stochastic; trend lines, support and resistance, Fibonacci levels, candle and double top/bottom patterns
   VAP  — volume at price (point of control, value area), TSM / AQR — the trading day by hour with VWAP, QR — time & sales
   TRA  — total return of one security with dividends, TRAY — returns over many periods
   Company tabs: GE — P/E over time, CACS — corporate action calendar, CRPR — credit rating news
   Data: price history from the bot server (/api/history), crypto trades straight from Binance. */
(function(){
'use strict';
var T = window.TERM, F = window.FN;
if (!T || !F) return;
var $ = T.$, el = T.el, TX = T.TX, I = T.I, fmt = T.fmt, pct = T.pct, cls = T.cls, store = T.store;
var clear = F.clear, table = F.table, td = F.td, cols = F.cols, num = F.num, price = F.price, dmy = F.dmy;

/* ======================= indicators ======================= */
function sma(v, n){ return F.sma(v, n) }
function ema(v, n){
  var out = [], k = 2 / (n + 1), e = null, seed = 0, cnt = 0;
  for (var i = 0; i < v.length; i++) {
    var x = v[i];
    if (x == null) { out.push(e); continue }
    if (e == null) { seed += x; cnt++; if (cnt === n) e = seed / n; out.push(e); continue }
    e = x * k + e * (1 - k); out.push(e);
  }
  return out;
}
function stdev(v, n, m){
  return v.map(function(_, i){
    if (i < n - 1 || m[i] == null) return null;
    var s = 0; for (var j = i - n + 1; j <= i; j++) s += (v[j] - m[i]) * (v[j] - m[i]);
    return Math.sqrt(s / n);
  });
}
function boll(c, n, k){ var m = sma(c, n), sd = stdev(c, n, m); return {mid: m, up: m.map(function(x, i){ return x == null ? null : x + k * sd[i] }), lo: m.map(function(x, i){ return x == null ? null : x - k * sd[i] })} }
function macd(c){
  var a = ema(c, 12), b = ema(c, 26), line = a.map(function(x, i){ return x != null && b[i] != null ? x - b[i] : null });
  var first = line.findIndex(function(x){ return x != null }), sig = line.map(function(){ return null });
  if (first >= 0) { var s = ema(line.slice(first), 9); s.forEach(function(x, i){ sig[first + i] = x }) }
  return {line: line, sig: sig, hist: line.map(function(x, i){ return x != null && sig[i] != null ? x - sig[i] : null })};
}
function stoch(h, l, c, n, d){
  var k = c.map(function(x, i){
    if (i < n - 1) return null;
    var hh = -Infinity, ll = Infinity; for (var j = i - n + 1; j <= i; j++) { hh = Math.max(hh, h[j]); ll = Math.min(ll, l[j]) }
    return hh > ll ? (x - ll) / (hh - ll) * 100 : 50;
  });
  return {k: k, d: sma(k.map(function(x){ return x == null ? 0 : x }), d).map(function(x, i){ return k[i] == null || i < n + d - 2 ? null : x })};
}
function atr(h, l, c, n){
  var tr = c.map(function(x, i){ return i ? Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])) : h[i] - l[i] });
  var out = [], a = null;
  for (var i = 0; i < tr.length; i++) { if (i < n - 1) { out.push(null); continue } if (a == null) { a = 0; for (var j = 0; j <= i; j++) a += tr[j]; a /= (i + 1) } else a = (a * (n - 1) + tr[i]) / n; out.push(a) }
  return out;
}
function vwap(h, l, c, v, t, intraday){
  // intraday: restarts every trading day; otherwise over the whole period shown
  var out = [], pv = 0, vv = 0, day = null;
  for (var i = 0; i < c.length; i++) {
    var d = intraday ? new Date(t[i] * 1000).toISOString().slice(0, 10) : 'all';
    if (d !== day) { pv = 0; vv = 0; day = d }
    var tp = (h[i] + l[i] + c[i]) / 3, vol = v[i] || 0; pv += tp * vol; vv += vol;
    out.push(vv ? pv / vv : null);
  }
  return out;
}

/* ======================= technical patterns ======================= */
function pivots(h, l, k){
  var hi = [], lo = [];
  for (var i = k; i < h.length - k; i++) {
    var isH = true, isL = true;
    for (var j = i - k; j <= i + k; j++) { if (j === i) continue; if (h[j] > h[i]) isH = false; if (l[j] < l[i]) isL = false }
    if (isH) hi.push(i); if (isL) lo.push(i);
  }
  return {hi: hi, lo: lo};
}
// support/resistance: pivot prices grouped within 1.5 %; the most touched levels nearest the price
function levels(h, l, c, pv){
  var pts = pv.hi.map(function(i){ return h[i] }).concat(pv.lo.map(function(i){ return l[i] })), groups = [];
  pts.sort(function(a, b){ return a - b }).forEach(function(p){
    var g = groups[groups.length - 1];
    if (g && Math.abs(p / g.avg - 1) < 0.015) { g.n++; g.sum += p; g.avg = g.sum / g.n } else groups.push({n: 1, sum: p, avg: p});
  });
  var last = c[c.length - 1];
  var sup = groups.filter(function(g){ return g.avg < last && g.n >= 2 }).sort(function(a, b){ return b.avg - a.avg }).slice(0, 2);
  var res = groups.filter(function(g){ return g.avg > last && g.n >= 2 }).sort(function(a, b){ return a.avg - b.avg }).slice(0, 2);
  return {sup: sup.map(function(g){ return {p: g.avg, n: g.n} }), res: res.map(function(g){ return {p: g.avg, n: g.n} })};
}
// trend lines through the last two swing lows (support) and swing highs (resistance), extended to the right
function trendLines(h, l, pv){
  var out = [], n = h.length;
  var pick = function(idx, arr, rising){
    var cand = idx.filter(function(i){ return i > n * 0.3 });
    for (var a = cand.length - 1; a > 0; a--) for (var b = a - 1; b >= 0; b--) {
      var i1 = cand[b], i2 = cand[a]; if (i2 - i1 < Math.max(5, n * 0.08)) continue;
      var slope = (arr[i2] - arr[i1]) / (i2 - i1);
      if (rising ? slope <= 0 : slope >= 0) continue;
      return {i1: i1, p1: arr[i1], slope: slope};
    }
    return null;
  };
  var s = pick(pv.lo, l, true), r = pick(pv.hi, h, false);
  if (s) out.push({kind: 'sup', i1: s.i1, p1: s.p1, slope: s.slope});
  if (r) out.push({kind: 'res', i1: r.i1, p1: r.p1, slope: r.slope});
  return out;
}
function fibo(h, l){
  var hi = -Infinity, lo = Infinity, ih = 0, il = 0;
  h.forEach(function(x, i){ if (x > hi) { hi = x; ih = i } }); l.forEach(function(x, i){ if (x < lo) { lo = x; il = i } });
  var up = il < ih;   // the move went up: levels are retracements from the high down
  return {up: up, hi: hi, lo: lo, levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map(function(f){ return {f: f, p: up ? hi - (hi - lo) * f : lo + (hi - lo) * f} })};
}
// candle patterns; dir +1 bullish, −1 bearish
function candles(o, h, l, c){
  var out = [], n = c.length;
  var body = function(i){ return Math.abs(c[i] - o[i]) }, range = function(i){ return h[i] - l[i] || 1e-9 };
  var down = function(i){ return i >= 5 && c[i - 1] < c[i - 5] }, upTrend = function(i){ return i >= 5 && c[i - 1] > c[i - 5] };
  for (var i = Math.max(2, n - 160); i < n; i++) {
    var b = body(i), r = range(i), upper = h[i] - Math.max(o[i], c[i]), lower = Math.min(o[i], c[i]) - l[i];
    if (b <= r * 0.08) out.push({i: i, k: 'doji', dir: 0});
    else if (lower >= 2 * b && upper <= b * 0.4 && down(i)) out.push({i: i, k: 'hammer', dir: 1});
    else if (upper >= 2 * b && lower <= b * 0.4 && upTrend(i)) out.push({i: i, k: 'star', dir: -1});
    var p = i - 1;
    if (c[p] < o[p] && c[i] > o[i] && o[i] <= c[p] && c[i] >= o[p] && b > body(p) && down(i)) out.push({i: i, k: 'engulf_bull', dir: 1});
    if (c[p] > o[p] && c[i] < o[i] && o[i] >= c[p] && c[i] <= o[p] && b > body(p) && upTrend(i)) out.push({i: i, k: 'engulf_bear', dir: -1});
    var q = i - 2;
    if (c[q] < o[q] && body(q) > range(q) * 0.5 && body(p) < range(p) * 0.3 && c[i] > o[i] && c[i] > (o[q] + c[q]) / 2) out.push({i: i, k: 'morning', dir: 1});
    if (c[q] > o[q] && body(q) > range(q) * 0.5 && body(p) < range(p) * 0.3 && c[i] < o[i] && c[i] < (o[q] + c[q]) / 2) out.push({i: i, k: 'evening', dir: -1});
  }
  return out;
}
function doubles(h, l, c, pv){
  var out = [], n = c.length;
  for (var a = pv.hi.length - 1; a > 0; a--) {
    var i2 = pv.hi[a], i1 = pv.hi[a - 1];
    if (i2 < n * 0.4) break;
    if (Math.abs(h[i2] / h[i1] - 1) < 0.02 && i2 - i1 >= 8) {
      var trough = Math.min.apply(null, l.slice(i1, i2 + 1));
      if (trough < Math.min(h[i1], h[i2]) * 0.96) { out.push({k: 'dtop', i1: i1, i2: i2, p: (h[i1] + h[i2]) / 2, neck: trough, dir: -1, broken: c[n - 1] < trough}); break }
    }
  }
  for (var b = pv.lo.length - 1; b > 0; b--) {
    var j2 = pv.lo[b], j1 = pv.lo[b - 1];
    if (j2 < n * 0.4) break;
    if (Math.abs(l[j2] / l[j1] - 1) < 0.02 && j2 - j1 >= 8) {
      var peak = Math.max.apply(null, h.slice(j1, j2 + 1));
      if (peak > Math.max(l[j1], l[j2]) * 1.04) { out.push({k: 'dbot', i1: j1, i2: j2, p: (l[j1] + l[j2]) / 2, neck: peak, dir: 1, broken: c[n - 1] > peak}); break }
    }
  }
  return out;
}

/* ======================= state ======================= */
var DEF_IND = {sma50: 1, sma200: 1, vol: 1, rsi: 1};
var tc = {tab: 'TECH', sym: store('tech_sym') || 'S&P', range: store('tech_range') || '1y', style: store('tech_style') || 'candle', ind: null, ta: null, data: null, seq: 0};
try { tc.ind = JSON.parse(store('tech_ind') || 'null') } catch(e){}
try { tc.ta = JSON.parse(store('tech_ta') || 'null') } catch(e){}
tc.ind = tc.ind || Object.assign({}, DEF_IND); tc.ta = tc.ta || {trend: 1, sr: 1};
function saveTc(){ store('tech_sym', tc.sym); store('tech_range', tc.range); store('tech_style', tc.style); store('tech_ind', JSON.stringify(tc.ind)); store('tech_ta', JSON.stringify(tc.ta)) }
var IND_LIST = [['sma20', 'SMA 20', '#c77dff'], ['sma50', 'SMA 50', '#4fa3ff'], ['sma200', 'SMA 200', '#ffd400'], ['ema20', 'EMA 20', '#56d6d6'],
  ['boll', 'BOLL 20,2', '#8c8c8c'], ['vwap', 'VWAP', '#ff7ab6'], ['vol', 'VOL', '#555'], ['rsi', 'RSI 14', '#ffa028'], ['macd', 'MACD', '#4fa3ff'], ['stoch', 'STOCH 14', '#21c66f']];
var TA_LIST = [['trend', 'ta_trend'], ['sr', 'ta_sr'], ['fib', 'ta_fib'], ['pat', 'ta_pat']];
var RANGES = ['1d', '5d', '1m', '3m', '6m', 'ytd', '1y', '2y', '5y'];

F.tabs($('tech-tabs'), 't', function(t){ tc.tab = t; renderTech() });
function openTech(tab, arg, opts){
  opts = opts || {};
  var p = String(arg || '').trim().split(/\s+/).filter(Boolean), sym = [];
  p.forEach(function(w){
    var u = w.toUpperCase();
    if (RANGES.indexOf(u.toLowerCase()) >= 0) tc.range = u.toLowerCase();
    else if (IND_LIST.some(function(x){ return x[0].toUpperCase() === u })) tc.ind[u.toLowerCase()] = 1;
    else if (u === 'BOLL' || u === 'BB') tc.ind.boll = 1;
    else if (u === 'SMA') tc.ind.sma50 = 1;
    else if (u === 'EMA') tc.ind.ema20 = 1;
    else if (u === 'FIB' || u === 'FIBO') tc.ta.fib = 1;
    else sym.push(w);
  });
  if (sym.length) tc.sym = F.upSym(sym.join(' '));
  if (opts.style) tc.style = opts.style;
  if (opts.range) tc.range = opts.range;
  if (opts.ta) Object.keys(opts.ta).forEach(function(k){ tc.ta[k] = 1 });
  tc.tab = tab || tc.tab; F.setTab($('tech-tabs'), 't', tc.tab);
  saveTc();
  T.show('p-tech'); renderTech(true);
}
function load(range){
  var key = tc.sym + '|' + range;
  if (tc.data && tc.data.key === key) return Promise.resolve(tc.data);
  return F.history(tc.sym, range).then(function(h){ if (!h || !h.c || !h.c.length) throw new Error(TX('no_data_yet')); h.key = key; return h });
}
function renderTech(force){
  if (!F.visible('p-tech')) return;
  var box = $('tech-body');
  $('tech-code').textContent = tc.tab;
  $('tech-title').textContent = TX('tech_t_' + tc.tab, tc.sym);
  if (!T.api()) return F.noApi(box, TX('m_tech'));
  var seq = ++tc.seq;
  var range = tc.tab === 'VAP' || tc.tab === 'TSM' ? (/^(1d|5d)$/.test(tc.vapRange || '') ? tc.vapRange : '1d') : tc.tab === 'TRAY' || tc.tab === 'QR' ? null : tc.tab === 'TRA' ? (tc.traRange || '1y') : tc.range;
  if (tc.tab === 'TRAY' || tc.tab === 'QR') $('tech-sub').textContent = '';
  if (tc.tab === 'TRAY') return drawTray(box);
  if (tc.tab === 'QR') return drawQr(box);
  if (!box.querySelector('.tc-ctl') || force) F.loading(box, TX('loading_x', tc.sym));
  load(range).then(function(h){
    if (seq !== tc.seq) return;
    tc.data = h;
    $('tech-sub').textContent = (h.name || tc.sym) + (h.cur ? ' · ' + h.cur : '');
    ({TECH: drawTech, VAP: drawVap, TSM: drawTsm, TRA: drawTra}[tc.tab] || drawTech)(box, h);
  }).catch(function(e){ if (seq === tc.seq) F.errBox(box, e) });
}
F.RENDER['p-tech'] = function(){ if (!$('tech-body').querySelector('canvas,table,.loading')) renderTech() };

/* ======================= TECH: the chart ======================= */
function chip(text, on, onclick, title){ var b = el('button', 'chipbtn' + (on ? ' on' : ''), text); b.type = 'button'; if (title) b.title = title; b.onclick = onclick; return b }
function symForm(box, after){
  var f = el('form', 'frm tc-ctl'); f.autocomplete = 'off';
  var i = el('input', 't'); i.value = tc.sym; i.placeholder = TX('ticker'); i.style.width = '110px'; f.appendChild(i);
  f.onsubmit = function(e){ e.preventDefault(); if (i.value.trim()) { tc.sym = F.upSym(i.value); tc.data = null; saveTc(); renderTech(true) } };
  (after || []).forEach(function(x){ f.appendChild(x) });
  box.appendChild(f);
  return f;
}
function drawTech(box, h){
  clear(box);
  var f = symForm(box);
  RANGES.forEach(function(r){ f.appendChild(chip(r.toUpperCase(), r === tc.range, function(){ tc.range = r; saveTc(); renderTech() })) });
  f.appendChild(el('span', 'tc-sep'));
  [['line', TX('st_line')], ['bar', TX('st_bar')], ['candle', TX('st_candle')]].forEach(function(s){ f.appendChild(chip(s[1], tc.style === s[0], function(){ tc.style = s[0]; saveTc(); drawTech(box, h) })) });
  var f2 = el('div', 'frm tc-ctl');
  IND_LIST.forEach(function(x){ var b = chip(x[1], tc.ind[x[0]], function(){ tc.ind[x[0]] = tc.ind[x[0]] ? 0 : 1; saveTc(); drawTech(box, h) }); if (tc.ind[x[0]]) { b.style.borderColor = x[2] } f2.appendChild(b) });
  f2.appendChild(el('span', 'tc-sep'));
  TA_LIST.forEach(function(x){ f2.appendChild(chip(TX(x[1]), tc.ta[x[0]], function(){ tc.ta[x[0]] = tc.ta[x[0]] ? 0 : 1; saveTc(); drawTech(box, h) })) });
  box.appendChild(f2);
  var wrap = el('div', 'cv tc-cv'); box.appendChild(wrap);
  var A = analyse(h);
  wrap.__draw = function(){ paintChart(wrap, h, A) };
  if (F.canvases().indexOf(wrap) < 0) F.canvases().push(wrap);
  paintChart(wrap, h, A);
  summary(box, h, A);
}
function analyse(h){
  var c = h.c, o = h.o.map(function(x, i){ return x == null ? c[i] : x }), hi = h.h.map(function(x, i){ return x == null ? c[i] : x }), lo = h.l.map(function(x, i){ return x == null ? c[i] : x });
  var n = c.length, k = n > 300 ? 6 : n > 120 ? 4 : 3, pv = pivots(hi, lo, k), intraday = tc.range === '1d' || tc.range === '5d';
  return {o: o, h: hi, l: lo, c: c, v: h.v || [], n: n, intraday: intraday,
    sma20: sma(c, 20), sma50: sma(c, 50), sma200: sma(c, 200), ema20: ema(c, 20), boll: boll(c, 20, 2), vwap: vwap(hi, lo, c, h.v || [], h.t, intraday),
    rsi: F.rsi(c, 14), macd: macd(c), stoch: stoch(hi, lo, c, 14, 3), atr: atr(hi, lo, c, 14),
    pv: pv, lv: levels(hi, lo, c, pv), tl: trendLines(hi, lo, pv), fib: fibo(hi, lo), cdl: candles(o, hi, lo, c), dbl: doubles(hi, lo, c, pv)};
}
function tlabel(t, intraday, withYear){
  var d = new Date(t * 1000);
  if (intraday) return d.toLocaleString(I.date, {hour: '2-digit', minute: '2-digit', timeZone: T.MSK});
  return d.toLocaleDateString(I.date, withYear ? {day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC'} : {day: 'numeric', month: 'short', timeZone: 'UTC'});
}
function paintChart(wrap, h, A){
  clear(wrap);
  var W = wrap.clientWidth, H = wrap.clientHeight; if (!W || !H) return;
  var cv = el('canvas'), dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; wrap.appendChild(cv);
  var g = cv.getContext('2d'); g.scale(dpr, dpr);
  var lower = ['rsi', 'macd', 'stoch'].filter(function(k){ return tc.ind[k] });
  var L = 6, R = 64, B = 18, TOP = 18, paneH = Math.max(48, Math.min(110, H * 0.16)), mainH = H - TOP - B - lower.length * paneH;
  if (mainH < 150) { lower = lower.slice(0, Math.max(0, Math.floor((H - TOP - B - 150) / paneH))); mainH = H - TOP - B - lower.length * paneH }
  var n = A.n, bw = (W - L - R) / n, X = function(i){ return L + (i + 0.5) * bw };
  // price scale over the bars and the overlays shown
  var lo = Infinity, hi = -Infinity;
  for (var i = 0; i < n; i++) { if (A.l[i] < lo) lo = A.l[i]; if (A.h[i] > hi) hi = A.h[i] }
  if (tc.ind.boll) A.boll.up.forEach(function(v, i){ if (v != null) { hi = Math.max(hi, v); lo = Math.min(lo, A.boll.lo[i]) } });
  var pad = (hi - lo) * 0.06 || hi * 0.01 || 1; lo -= pad; hi += pad;
  var Y = function(v){ return TOP + (hi - v) / (hi - lo) * mainH };
  var font = getComputedStyle(document.body).fontFamily;
  g.font = '11px ' + font; g.textBaseline = 'middle';
  // grid and the price axis
  var dgt = Math.abs(hi) >= 1000 ? 0 : Math.abs(hi) >= 10 ? 2 : 4;
  for (var k = 0; k <= 5; k++) { var v = lo + (hi - lo) * k / 5, y = Y(v); g.strokeStyle = 'rgba(255,255,255,0.05)'; g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.fillStyle = '#5a5a5a'; g.fillText(fmt(v, dgt), W - R + 6, y) }
  // time axis
  var step = Math.max(1, Math.round(n / Math.max(2, Math.floor((W - L - R) / 90)))), longSpan = (h.t[n - 1] - h.t[0]) > 300 * 86400;
  g.fillStyle = '#5a5a5a'; g.textAlign = 'center';
  for (var j = step; j < n; j += step) { g.fillText(tlabel(h.t[j], A.intraday, longSpan), X(j), H - B / 2); g.strokeStyle = 'rgba(255,255,255,0.03)'; g.beginPath(); g.moveTo(X(j), TOP); g.lineTo(X(j), H - B); g.stroke() }
  g.textAlign = 'left';
  // volume at the bottom of the price pane
  if (tc.ind.vol && A.v.length) {
    var vmax = Math.max.apply(null, A.v.map(function(x){ return x || 0 })) || 1;
    for (var vi = 0; vi < n; vi++) { var vh = (A.v[vi] || 0) / vmax * mainH * 0.2; g.fillStyle = A.c[vi] >= A.o[vi] ? 'rgba(33,198,111,0.28)' : 'rgba(255,75,75,0.28)'; g.fillRect(X(vi) - Math.max(0.5, bw * 0.35), TOP + mainH - vh, Math.max(1, bw * 0.7), vh) }
  }
  // Bollinger band
  if (tc.ind.boll) {
    g.beginPath(); var started = false;
    A.boll.up.forEach(function(v, i){ if (v == null) return; if (!started) { g.moveTo(X(i), Y(v)); started = true } else g.lineTo(X(i), Y(v)) });
    for (var bi = n - 1; bi >= 0; bi--) if (A.boll.lo[bi] != null) g.lineTo(X(bi), Y(A.boll.lo[bi]));
    g.closePath(); g.fillStyle = 'rgba(140,140,140,0.08)'; g.fill();
    line(g, A.boll.up, X, Y, '#6a6a6a', 1); line(g, A.boll.lo, X, Y, '#6a6a6a', 1); line(g, A.boll.mid, X, Y, '#6a6a6a', 1, [3, 3]);
  }
  // Fibonacci
  if (tc.ta.fib) {
    A.fib.levels.forEach(function(L_){
      var y = Y(L_.p); g.strokeStyle = 'rgba(199,125,255,0.45)'; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#c77dff'; g.fillText(fmt(L_.f * 100, 1) + '%  ' + fmt(L_.p, dgt), L + 4, y - 7);
    });
  }
  // support and resistance
  if (tc.ta.sr) {
    A.lv.sup.concat(A.lv.res).forEach(function(s){
      var sup = A.lv.sup.indexOf(s) >= 0, y = Y(s.p);
      g.strokeStyle = sup ? 'rgba(33,198,111,0.6)' : 'rgba(255,75,75,0.6)'; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = sup ? '#21c66f' : '#ff4b4b'; g.fillRect(W - R + 1, y - 7, R - 2, 14); g.fillStyle = '#000'; g.fillText(fmt(s.p, dgt), W - R + 5, y);
    });
  }
  // price
  if (tc.style === 'line') {
    var up = A.c[n - 1] >= A.c[0];
    g.beginPath(); A.c.forEach(function(v, i){ i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)) }); g.strokeStyle = up ? '#21c66f' : '#ff4b4b'; g.lineWidth = 1.6; g.stroke(); g.lineWidth = 1;
  } else {
    var cw = Math.max(1, Math.min(14, bw * 0.7));
    for (var ci = 0; ci < n; ci++) {
      var x = X(ci), o = A.o[ci], c = A.c[ci], upb = c >= o, col = upb ? '#21c66f' : '#ff4b4b';
      g.strokeStyle = col; g.fillStyle = col;
      if (tc.style === 'bar') {
        g.beginPath(); g.moveTo(x, Y(A.h[ci])); g.lineTo(x, Y(A.l[ci])); g.moveTo(x - cw / 2, Y(o)); g.lineTo(x, Y(o)); g.moveTo(x, Y(c)); g.lineTo(x + cw / 2, Y(c)); g.stroke();
      } else {
        g.beginPath(); g.moveTo(x, Y(A.h[ci])); g.lineTo(x, Y(A.l[ci])); g.stroke();
        var y1 = Y(Math.max(o, c)), y2 = Y(Math.min(o, c)); g.fillRect(x - cw / 2, y1, cw, Math.max(1, y2 - y1));
      }
    }
  }
  // moving averages and VWAP
  IND_LIST.forEach(function(x){ if (tc.ind[x[0]] && /^(sma|ema|vwap)/.test(x[0])) line(g, A[x[0]], X, Y, x[2], 1.3) });
  // trend lines
  if (tc.ta.trend) A.tl.forEach(function(t){
    var y1 = Y(t.p1), y2 = Y(t.p1 + t.slope * (n - 1 - t.i1));
    g.strokeStyle = t.kind === 'sup' ? '#21c66f' : '#ff4b4b'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(X(t.i1), y1); g.lineTo(X(n - 1), y2); g.stroke(); g.lineWidth = 1;
  });
  // patterns
  if (tc.ta.pat) {
    A.cdl.forEach(function(p){
      var x = X(p.i), up = p.dir > 0, y = up ? Y(A.l[p.i]) + 10 : Y(A.h[p.i]) - 10;
      g.fillStyle = p.dir > 0 ? '#21c66f' : p.dir < 0 ? '#ff4b4b' : '#8c8c8c'; g.textAlign = 'center';
      g.fillText(p.dir > 0 ? '▲' : p.dir < 0 ? '▼' : '◆', x, y); g.textAlign = 'left';
    });
    A.dbl.forEach(function(d){
      g.strokeStyle = d.dir > 0 ? '#21c66f' : '#ff4b4b'; g.setLineDash([2, 2]); g.beginPath(); g.moveTo(X(d.i1), Y(d.neck)); g.lineTo(X(n - 1), Y(d.neck)); g.stroke(); g.setLineDash([]);
      g.fillStyle = g.strokeStyle; g.fillText(TX('pat_' + d.k) + ' · ' + TX('neck') + ' ' + fmt(d.neck, dgt), X(d.i2) + 6, Y(d.p) + (d.dir > 0 ? 12 : -12));
    });
  }
  // the last price
  var last = A.c[n - 1], ly = Y(last), lcol = last >= A.o[n - 1] ? '#21c66f' : '#ff4b4b';
  g.fillStyle = lcol; g.fillRect(W - R + 1, ly - 8, R - 2, 16); g.fillStyle = '#000'; g.fillText(fmt(last, dgt), W - R + 5, ly);
  // lower panes
  lower.forEach(function(k, pi){
    var top = TOP + mainH + pi * paneH + 4, ph = paneH - 6;
    g.strokeStyle = '#1c1c1c'; g.beginPath(); g.moveTo(L, top - 2); g.lineTo(W - R, top - 2); g.stroke();
    var vals = k === 'rsi' ? [A.rsi] : k === 'stoch' ? [A.stoch.k, A.stoch.d] : [A.macd.line, A.macd.sig];
    var plo = k === 'macd' ? Infinity : 0, phi = k === 'macd' ? -Infinity : 100;
    if (k === 'macd') A.macd.line.concat(A.macd.sig, A.macd.hist).forEach(function(v){ if (v != null) { plo = Math.min(plo, v); phi = Math.max(phi, v) } });
    if (!(phi > plo)) { plo = -1; phi = 1 }
    var PY = function(v){ return top + (phi - v) / (phi - plo) * ph };
    if (k !== 'macd') [k === 'rsi' ? 30 : 20, k === 'rsi' ? 70 : 80].forEach(function(lv){ g.strokeStyle = 'rgba(255,255,255,0.08)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(L, PY(lv)); g.lineTo(W - R, PY(lv)); g.stroke(); g.setLineDash([]); g.fillStyle = '#4a4a4a'; g.fillText(lv, W - R + 6, PY(lv)) });
    else { A.macd.hist.forEach(function(v, i){ if (v == null) return; g.fillStyle = v >= 0 ? 'rgba(33,198,111,0.5)' : 'rgba(255,75,75,0.5)'; var y0 = PY(0), y1_ = PY(v); g.fillRect(X(i) - Math.max(0.5, bw * 0.3), Math.min(y0, y1_), Math.max(1, bw * 0.6), Math.abs(y1_ - y0)) }) }
    var colsK = k === 'rsi' ? ['#ffa028'] : k === 'stoch' ? ['#21c66f', '#ff4b4b'] : ['#4fa3ff', '#ffa028'];
    vals.forEach(function(a, ai){ line(g, a, X, PY, colsK[ai], 1.2) });
    var lastV = vals[0][n - 1];
    g.fillStyle = '#8c8c8c'; g.fillText(IND_LIST.filter(function(x){ return x[0] === k })[0][1] + (lastV != null ? '  ' + fmt(lastV, k === 'macd' ? (Math.abs(lastV) < 1 ? 3 : 2) : 1) : ''), L + 4, top + 7);
  });
  // legend: name and change over the period
  var ch = (A.c[n - 1] / A.c[0] - 1) * 100;
  g.fillStyle = '#e6e6e6'; g.fillText((h.name || tc.sym) + '  ' + fmt(last, dgt), L + 4, 9);
  var tw = g.measureText((h.name || tc.sym) + '  ' + fmt(last, dgt) + '  ').width;
  g.fillStyle = ch >= 0 ? '#21c66f' : '#ff4b4b'; g.fillText(pct(ch) + ' ' + tc.range.toUpperCase(), L + 4 + tw, 9);
  var lx = L + 4 + tw + g.measureText(pct(ch) + ' ' + tc.range.toUpperCase() + '   ').width;
  IND_LIST.forEach(function(x){ if (tc.ind[x[0]] && /^(sma|ema|vwap|boll)/.test(x[0])) { g.fillStyle = x[2]; g.fillText(x[1], lx, 9); lx += g.measureText(x[1] + '  ').width } });
  // crosshair
  cv.onmousemove = function(e){
    var r = cv.getBoundingClientRect(), mx_ = e.clientX - r.left, my_ = e.clientY - r.top;
    var i2 = Math.max(0, Math.min(n - 1, Math.floor((mx_ - L) / bw)));
    paintCross(wrap, cv, g, dpr, h, A, i2, X(i2), my_, TOP, mainH, Y, lo, hi, W, H, R, B, dgt);
  };
  cv.onmouseleave = function(){ var tip = $('tm-tip'); tip.style.display = 'none'; var o2 = wrap.querySelector('.tc-x'); if (o2) o2.remove() };
}
function line(g, arr, X, Y, col, w, dash){
  g.beginPath(); var on = false;
  for (var i = 0; i < arr.length; i++) { var v = arr[i]; if (v == null) { on = false; continue } if (!on) { g.moveTo(X(i), Y(v)); on = true } else g.lineTo(X(i), Y(v)) }
  g.strokeStyle = col; g.lineWidth = w || 1; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]); g.lineWidth = 1;
}
function paintCross(wrap, cv, g, dpr, h, A, i, x, y, TOP, mainH, Y, lo, hi, W, H, R, B, dgt){
  var o = wrap.querySelector('.tc-x');
  if (!o) { o = el('canvas', 'tc-x'); o.width = cv.width; o.height = cv.height; o.style.pointerEvents = 'none'; wrap.appendChild(o) }
  var c = o.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  c.strokeStyle = 'rgba(255,212,0,0.35)'; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(x, TOP); c.lineTo(x, H - B); c.moveTo(6, y); c.lineTo(W - R, y); c.stroke(); c.setLineDash([]);
  if (y >= TOP && y <= TOP + mainH) { var v = hi - (y - TOP) / mainH * (hi - lo); c.fillStyle = '#ffd400'; c.fillRect(W - R + 1, y - 8, R - 2, 16); c.fillStyle = '#000'; c.font = '11px ' + getComputedStyle(document.body).fontFamily; c.textBaseline = 'middle'; c.fillText(fmt(v, dgt), W - R + 5, y) }
  var tip = $('tm-tip'); clear(tip);
  tip.appendChild(el('b', null, tlabel(h.t[i], A.intraday, true)));
  [['O', A.o[i]], ['H', A.h[i]], ['L', A.l[i]], ['C', A.c[i]]].forEach(function(p){ tip.appendChild(el('div', null, p[0] + ' ' + fmt(p[1], dgt))) });
  if (A.v[i]) tip.appendChild(el('div', null, 'Vol ' + fmt(A.v[i], 0)));
  if (i > 0) tip.appendChild(el('div', cls(A.c[i] / A.c[i - 1] - 1), pct((A.c[i] / A.c[i - 1] - 1) * 100)));
  IND_LIST.forEach(function(p){ if (!tc.ind[p[0]]) return; var val = p[0] === 'boll' ? A.boll.mid[i] : p[0] === 'macd' ? A.macd.line[i] : p[0] === 'stoch' ? A.stoch.k[i] : p[0] === 'vol' ? null : A[p[0]] && A[p[0]][i];
    if (val != null) tip.appendChild(el('div', null, p[1] + ' ' + fmt(val, p[0] === 'rsi' || p[0] === 'stoch' ? 1 : dgt))) });
  var r = cv.getBoundingClientRect(); tip.style.display = 'block';
  var tx = r.left + x + 14, ty = r.top + y + 14; if (tx + tip.offsetWidth > window.innerWidth - 6) tx = r.left + x - tip.offsetWidth - 14; if (ty + tip.offsetHeight > window.innerHeight - 6) ty = r.top + y - tip.offsetHeight - 10;
  tip.style.left = tx + 'px'; tip.style.top = ty + 'px';
}
// the reading of the chart in words and numbers
function summary(box, h, A){
  var n = A.n, c = A.c[n - 1], blk = el('div', 'tc-sum');
  var add = function(k, v, cl, title){ var d = el('div'); d.appendChild(el('span', null, k)); var b = el('b', cl || null, v); d.appendChild(b); if (title) d.title = title; blk.appendChild(d) };
  var s50 = A.sma50[n - 1], s200 = A.sma200[n - 1];
  var trend = s50 != null && s200 != null ? (c > s50 && s50 > s200 ? 'up' : c < s50 && s50 < s200 ? 'down' : 'side') : s50 != null ? (c > s50 ? 'up' : 'down') : null;
  add(TX('ts_trend'), trend ? TX('ts_trend_' + trend) : '—', trend === 'up' ? 'up' : trend === 'down' ? 'down' : 'flat', TX('ts_trend_t'));
  var cross = null;
  for (var i = n - 1; i > Math.max(0, n - 40); i--) { var a = A.sma50[i], b = A.sma200[i], a0 = A.sma50[i - 1], b0 = A.sma200[i - 1]; if (a != null && b != null && a0 != null && b0 != null && (a - b) * (a0 - b0) < 0) { cross = {i: i, gold: a > b}; break } }
  if (cross) add(TX('ts_cross'), TX(cross.gold ? 'ts_golden' : 'ts_death') + ' · ' + tlabel(h.t[cross.i], false, true), cross.gold ? 'up' : 'down');
  var r = A.rsi[n - 1]; if (r != null) add('RSI 14', fmt(r, 1) + (r >= 70 ? ' · ' + TX('ts_ob') : r <= 30 ? ' · ' + TX('ts_os') : ''), r >= 70 ? 'down' : r <= 30 ? 'up' : null);
  var m = A.macd, mx_ = null; for (var j = n - 1; j > Math.max(0, n - 15); j--) { if (m.line[j] != null && m.sig[j] != null && m.line[j - 1] != null && m.sig[j - 1] != null && (m.line[j] - m.sig[j]) * (m.line[j - 1] - m.sig[j - 1]) < 0) { mx_ = {i: j, up: m.line[j] > m.sig[j]}; break } }
  if (m.line[n - 1] != null) add('MACD', (m.line[n - 1] > m.sig[n - 1] ? TX('ts_macd_up') : TX('ts_macd_dn')) + (mx_ ? ' · ' + TX('ts_cross_on', tlabel(h.t[mx_.i], A.intraday, false)) : ''), m.line[n - 1] > m.sig[n - 1] ? 'up' : 'down');
  var bu = A.boll.up[n - 1], bl = A.boll.lo[n - 1]; if (bu != null) add('%B', fmt((c - bl) / ((bu - bl) || 1) * 100, 0) + '%', null, TX('ts_pctb_t'));
  var at = A.atr[n - 1]; if (at != null) add('ATR 14', fmt(at, c >= 100 ? 2 : 4) + ' (' + fmt(at / c * 100, 2) + '%)', null, TX('ts_atr_t'));
  if (A.lv.sup.length) add(TX('ts_sup'), A.lv.sup.map(function(s){ return fmt(s.p, c >= 100 ? 2 : 4) }).join(' · '), 'up');
  if (A.lv.res.length) add(TX('ts_res'), A.lv.res.map(function(s){ return fmt(s.p, c >= 100 ? 2 : 4) }).join(' · '), 'down');
  A.tl.forEach(function(t){ var at_ = t.p1 + t.slope * (n - 1 - t.i1); add(TX(t.kind === 'sup' ? 'ts_tl_sup' : 'ts_tl_res'), fmt(at_, c >= 100 ? 2 : 4) + ' (' + pct((c / at_ - 1) * 100, 1) + ')', t.kind === 'sup' ? 'up' : 'down') });
  A.dbl.forEach(function(d){ add(TX('pat_' + d.k), TX('neck') + ' ' + fmt(d.neck, c >= 100 ? 2 : 4) + (d.broken ? ' · ' + TX('ts_broken') : ''), d.dir > 0 ? 'up' : 'down') });
  box.appendChild(blk);
  // Fibonacci table and the latest candle patterns
  var wrap2 = el('div', 'tc-tabs2');
  if (tc.ta.fib) {
    var tb = table(cols(TX('fib_cols'), [0]));
    A.fib.levels.forEach(function(L_){ var tr = el('tr'); tr.appendChild(td(fmt(L_.f * 100, 1) + '%', 'l')); tr.appendChild(td(fmt(L_.p, c >= 100 ? 2 : 4), 'num')); tr.appendChild(td(pct((L_.p / c - 1) * 100, 1), 'num ' + cls(L_.p - c))); tb.body.appendChild(tr) });
    var d1 = el('div'); d1.appendChild(el('div', 'note', TX(A.fib.up ? 'fib_up' : 'fib_dn'))); d1.appendChild(tb.t); wrap2.appendChild(d1);
  }
  var pats = A.cdl.slice(-10).reverse();
  if (pats.length) {
    var tb2 = table(cols(TX('pat_cols'), [0, 1]));
    pats.forEach(function(p){ var tr = el('tr'); tr.appendChild(td(tlabel(h.t[p.i], A.intraday, true), 'l')); tr.appendChild(td(TX('pat_' + p.k), 'l ' + (p.dir > 0 ? 'up' : p.dir < 0 ? 'down' : 'flat'))); tr.appendChild(td(fmt(A.c[p.i], c >= 100 ? 2 : 4), 'num')); tb2.body.appendChild(tr) });
    var d2 = el('div'); d2.appendChild(el('div', 'note', TX('pat_note'))); d2.appendChild(tb2.t); wrap2.appendChild(d2);
  }
  if (wrap2.childNodes.length) box.appendChild(wrap2);
  box.appendChild(el('div', 'note', TX('ta_disclaimer')));
}

/* ======================= VAP: volume at price ======================= */
function vapRangeChips(f, onPick){ ['1d', '5d'].forEach(function(r){ f.appendChild(chip(r.toUpperCase(), (tc.vapRange || '1d') === r, function(){ tc.vapRange = r; tc.data = null; onPick() })) }) }
function drawVap(box, h){
  clear(box);
  var f = symForm(box); vapRangeChips(f, function(){ renderTech() });
  var c = h.c, hi = Math.max.apply(null, h.h.filter(isFinite)), lo = Math.min.apply(null, h.l.filter(isFinite));
  var NB = 30, step = (hi - lo) / NB || 1, bins = []; for (var b = 0; b < NB; b++) bins.push({lo: lo + b * step, hi: lo + (b + 1) * step, v: 0, up: 0});
  var tv = 0, pv = 0;
  c.forEach(function(x, i){
    var v = h.v[i] || 0, l_ = h.l[i] == null ? x : h.l[i], h_ = h.h[i] == null ? x : h.h[i], a = Math.floor((l_ - lo) / step), z = Math.min(NB - 1, Math.floor((h_ - lo) / step));
    a = Math.max(0, Math.min(NB - 1, a)); var k = z - a + 1;
    for (var j = a; j <= z; j++) { bins[j].v += v / k; if (x >= (h.o[i] == null ? x : h.o[i])) bins[j].up += v / k }
    tv += v; pv += (h_ + l_ + x) / 3 * v;
  });
  if (!tv) { box.appendChild(el('div', 'empty', TX('vap_novol'))); return }
  var poc = bins.reduce(function(a, x){ return x.v > a.v ? x : a }, bins[0]), pi = bins.indexOf(poc);
  // value area: 70 % of the volume around the point of control
  var inA = poc.v, a1 = pi, a2 = pi;
  while (inA < tv * 0.7 && (a1 > 0 || a2 < NB - 1)) { var dn = a1 > 0 ? bins[a1 - 1].v : -1, up = a2 < NB - 1 ? bins[a2 + 1].v : -1; if (up >= dn) { a2++; inA += up } else { a1--; inA += dn } }
  var vw = pv / tv, last = c[c.length - 1], dgt = last >= 1000 ? 0 : last >= 10 ? 2 : 4;
  var st = el('div', 'stat');
  [[TX('vap_poc'), fmt((poc.lo + poc.hi) / 2, dgt)], [TX('vap_vah'), fmt(bins[a2].hi, dgt)], [TX('vap_val'), fmt(bins[a1].lo, dgt)], ['VWAP', fmt(vw, dgt)],
    [TX('vap_last'), fmt(last, dgt) + ' (' + pct((last / vw - 1) * 100, 2) + ' ' + TX('vap_vs_vwap') + ')'], [TX('vap_total'), fmt(tv, 0)]].forEach(function(x){ var s = el('span', null, x[0] + ': '); s.appendChild(el('b', null, x[1])); st.appendChild(s) });
  box.appendChild(st);
  var wrap = el('div', 'cv'); box.appendChild(wrap);
  var paint = function(){
    clear(wrap); var W = wrap.clientWidth, H = wrap.clientHeight; if (!W || !H) return;
    var cv = el('canvas'), dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; wrap.appendChild(cv);
    var g = cv.getContext('2d'); g.scale(dpr, dpr); g.font = '11px ' + getComputedStyle(document.body).fontFamily; g.textBaseline = 'middle';
    var vmax = poc.v, L = 70, R = 10, bh = (H - 10) / NB;
    bins.forEach(function(x, i){
      var y = H - 5 - (i + 1) * bh, w = x.v / vmax * (W - L - R), inVA = i >= a1 && i <= a2;
      g.fillStyle = i === pi ? '#ffd400' : inVA ? 'rgba(33,198,111,0.8)' : 'rgba(33,198,111,0.35)'; g.fillRect(L, y + 1, w * (x.up / (x.v || 1)), bh - 2);
      g.fillStyle = i === pi ? '#d9b400' : inVA ? 'rgba(255,75,75,0.65)' : 'rgba(255,75,75,0.3)'; g.fillRect(L + w * (x.up / (x.v || 1)), y + 1, w * (1 - x.up / (x.v || 1)), bh - 2);
      if (i % Math.ceil(NB / 10) === 0) { g.fillStyle = '#5a5a5a'; g.fillText(fmt((x.lo + x.hi) / 2, dgt), 4, y + bh / 2) }
    });
    var yv = H - 5 - (vw - lo) / (hi - lo) * (H - 10), yl = H - 5 - (last - lo) / (hi - lo) * (H - 10);
    g.strokeStyle = '#ff7ab6'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(L, yv); g.lineTo(W - R, yv); g.stroke(); g.fillStyle = '#ff7ab6'; g.fillText('VWAP', W - R - 40, yv - 8);
    g.strokeStyle = '#e6e6e6'; g.beginPath(); g.moveTo(L, yl); g.lineTo(W - R, yl); g.stroke(); g.setLineDash([]); g.fillStyle = '#e6e6e6'; g.fillText(TX('vap_last'), W - R - 40, yl + 8);
  };
  wrap.__draw = paint; if (F.canvases().indexOf(wrap) < 0) F.canvases().push(wrap); paint();
  box.appendChild(el('div', 'note', TX('vap_note')));
}

/* ======================= TSM / AQR: the trading day by hour ======================= */
function drawTsm(box, h){
  clear(box);
  var f = symForm(box); vapRangeChips(f, function(){ renderTech() });
  var rows = {}, order = [], tv = 0, pvTot = 0;
  h.c.forEach(function(x, i){
    var d = new Date(h.t[i] * 1000), key = d.toLocaleString(I.date, {day: '2-digit', month: '2-digit', hour: '2-digit', timeZone: T.MSK});
    var r = rows[key]; if (!r) { r = rows[key] = {k: key, t: h.t[i], o: h.o[i] == null ? x : h.o[i], h: -Infinity, l: Infinity, c: x, v: 0, pv: 0}; order.push(key) }
    r.h = Math.max(r.h, h.h[i] == null ? x : h.h[i]); r.l = Math.min(r.l, h.l[i] == null ? x : h.l[i]); r.c = x;
    var v = h.v[i] || 0, tp = ((h.h[i] || x) + (h.l[i] || x) + x) / 3; r.v += v; r.pv += tp * v; tv += v; pvTot += tp * v;
  });
  var last = h.c[h.c.length - 1], dgt = last >= 1000 ? 0 : last >= 10 ? 2 : 4, vw = tv ? pvTot / tv : null;
  var st = el('div', 'stat');
  [[TX('tsm_open'), fmt(h.o[0] == null ? h.c[0] : h.o[0], dgt)], [TX('tsm_hi'), fmt(Math.max.apply(null, h.h.filter(isFinite)), dgt)], [TX('tsm_lo'), fmt(Math.min.apply(null, h.l.filter(isFinite)), dgt)],
    [TX('tsm_last'), fmt(last, dgt)], ['VWAP', vw ? fmt(vw, dgt) : '—'], [TX('vap_total'), fmt(tv, 0)]].forEach(function(x){ var s = el('span', null, x[0] + ': '); s.appendChild(el('b', null, x[1])); st.appendChild(s) });
  box.appendChild(st);
  var tb = table(cols(TX('tsm_cols'), [0]));
  order.forEach(function(k, i){
    var r = rows[k], tr = el('tr'), prev = i ? rows[order[i - 1]].c : null;
    tr.appendChild(td(k + ':00', 'l'));
    [r.o, r.h, r.l, r.c].forEach(function(v){ tr.appendChild(td(fmt(v, dgt), 'num')) });
    tr.appendChild(prev != null ? F.chg((r.c / prev - 1) * 100) : td('', 'num'));
    tr.appendChild(td(fmt(r.v, 0), 'num')); tr.appendChild(td(tv ? fmt(r.v / tv * 100, 1) + '%' : '—', 'num'));
    tr.appendChild(td(r.v ? fmt(r.pv / r.v, dgt) : '—', 'num'));
    tb.body.appendChild(tr);
  });
  box.appendChild(tb.t);
  box.appendChild(el('div', 'note', TX('tsm_note')));
}

/* ======================= QR: time & sales ======================= */
var qrTimer = null;
function coinOf(sym){ var s = String(sym || '').toUpperCase().replace(/^BINANCE:/, '').replace(/USDT$/, ''); return T.COINS.some(function(c){ return c[0] === s }) ? s : null }
function drawQr(box){
  clearTimeout(qrTimer);
  var coin = coinOf(tc.sym);
  if (!coin) {   // stocks and indices: no free tick feed — the day's 5-minute bars instead
    return load('1d').then(function(h){
      clear(box); symForm(box);
      box.appendChild(el('div', 'note', TX('qr_bars_note')));
      var tb = table(cols(TX('qr_bar_cols'), [0])), dgt = h.c[h.c.length - 1] >= 1000 ? 0 : 2;
      for (var i = h.c.length - 1; i >= 0 && i >= h.c.length - 120; i--) {
        var tr = el('tr'); tr.appendChild(td(tlabel(h.t[i], true), 'l')); tr.appendChild(td(fmt(h.c[i], dgt), 'num ' + (i ? cls(h.c[i] - h.c[i - 1]) : ''))); tr.appendChild(td(fmt(h.v[i] || 0, 0), 'num')); tb.body.appendChild(tr);
      }
      box.appendChild(tb.t);
    }).catch(function(e){ F.errBox(box, e) });
  }
  fetch('https://api.binance.com/api/v3/trades?symbol=' + coin + 'USDT&limit=80').then(function(r){ if (!r.ok) throw new Error('Binance: HTTP ' + r.status); return r.json() }).then(function(arr){
    if (tc.tab !== 'QR' || coinOf(tc.sym) !== coin) return;
    var keep = box.scrollTop; clear(box); symForm(box);
    var buy = 0, sell = 0; arr.forEach(function(x){ if (x.isBuyerMaker) sell += +x.qty; else buy += +x.qty });
    var st = el('div', 'stat'); [[TX('qr_buys'), fmt(buy, 4)], [TX('qr_sells'), fmt(sell, 4)], [TX('qr_n'), arr.length]].forEach(function(x){ var s = el('span', null, x[0] + ': '); s.appendChild(el('b', null, String(x[1]))); st.appendChild(s) });
    box.appendChild(st);
    var tb = table(cols(TX('qr_cols'), [0]));
    arr.slice().reverse().forEach(function(x){
      var tr = el('tr'); tr.appendChild(td(new Date(x.time).toLocaleTimeString(I.date, {timeZone: T.MSK}), 'l'));
      tr.appendChild(td(fmt(+x.price, +x.price >= 1000 ? 2 : 4), 'num ' + (x.isBuyerMaker ? 'down' : 'up'))); tr.appendChild(td(fmt(+x.qty, 5), 'num'));
      tr.appendChild(td(T.fmt(+x.price * +x.qty, 0), 'num')); tr.appendChild(td(TX(x.isBuyerMaker ? 'qr_sell' : 'qr_buy'), 'num ' + (x.isBuyerMaker ? 'down' : 'up')));
      tb.body.appendChild(tr);
    });
    box.appendChild(tb.t); box.appendChild(el('div', 'note', TX('qr_note')));
    box.scrollTop = keep;
    qrTimer = setTimeout(function(){ if (tc.tab === 'QR' && F.visible('p-tech') && !document.hidden) drawQr(box) }, 4000);
  }).catch(function(e){ F.errBox(box, e) });
}

/* ======================= TRA: total return with dividends ======================= */
function drawTra(box, h){
  clear(box);
  var f = symForm(box);
  ['1m', '3m', '6m', 'ytd', '1y', '2y', '5y'].forEach(function(r){ f.appendChild(chip(r.toUpperCase(), (tc.traRange || '1y') === r, function(){ tc.traRange = r; tc.data = null; renderTech() })) });
  var note = el('div', 'loading', TX('loading')); box.appendChild(note);
  var divP = F.isStock(tc.sym) ? F.api('/api/company?s=' + encodeURIComponent(tc.sym) + '&parts=co', {ttl: 600}).then(function(d){ return (d.co && d.co.div && d.co.div.hist) || [] }, function(){ return [] }) : Promise.resolve([]);
  divP.then(function(divs){
    note.remove();
    var t0 = h.t[0], c = h.c, n = c.length;
    var ev = divs.map(function(x){ return {t: Date.parse(x[0] + 'T00:00:00Z') / 1000, a: x[1]} }).filter(function(x){ return x.t > t0 && x.t <= h.t[n - 1] + 86400 }).sort(function(a, b){ return a.t - b.t });
    // reinvest each dividend at the close of the day before the ex-date
    var units = 1, k = 0, tr = [], cash = 0;
    for (var i = 0; i < n; i++) {
      while (k < ev.length && ev[k].t <= h.t[i]) { var px = c[Math.max(0, i - 1)]; units += units * ev[k].a / px; cash += ev[k].a; k++ }
      tr.push(units * c[i]);
    }
    var pr = (c[n - 1] / c[0] - 1) * 100, tot = (tr[n - 1] / c[0] - 1) * 100, yrs = (h.t[n - 1] - t0) / (365.25 * 86400);
    var st = el('div', 'stat');
    [[TX('tra_price'), pct(pr)], [TX('tra_div'), cash ? fmt(cash, 2) + ' (' + ev.length + ')' : '—'], [TX('tra_total'), pct(tot)],
      [TX('tra_ann'), yrs >= 0.95 ? pct((Math.pow(tr[n - 1] / c[0], 1 / yrs) - 1) * 100) : '—'], [TX('tra_from'), tlabel(t0, false, true)]].forEach(function(x){ var s = el('span', null, x[0] + ': '); s.appendChild(el('b', /%/.test(x[1]) ? cls(parseFloat(x[1].replace(',', '.'))) : null, x[1])); st.appendChild(s) });
    box.appendChild(st);
    var wrap = el('div', 'cv'); box.appendChild(wrap);
    F.drawLines(wrap, [{name: TX('tra_total_l'), color: '#ffa028', t: h.t, v: tr}, {name: TX('tra_price_l'), color: '#4fa3ff', t: h.t, v: c}], {pct: true, intraday: false});
    box.appendChild(el('div', 'note', TX(ev.length ? 'tra_note' : F.isStock(tc.sym) ? 'tra_nodiv' : 'tra_index')));
  });
}

/* ======================= TRAY: returns over many periods ======================= */
var TRAY_DEF = ['S&P', 'NASDAQ', 'DJI', 'DAX', 'FTSE', 'CAC', 'NIKKEI', 'HSI', 'SHCOMP', 'SENSEX', 'IMOEX', 'GOLD', 'BRENT', 'BTC'];
var PERIODS = ['1d', '1w', 'mtd', '1m', 'qtd', '3m', '6m', 'ytd', '1y', '2y', '3y', '5y'];
function returnsFrom(daily, weekly){
  // daily: 1y of daily bars, weekly: 5y of weekly bars → {period: % (annualised past one year)}
  var out = {}, dt = daily.t, dc = daily.c, n = dt.length, last = dc[n - 1], now = new Date(dt[n - 1] * 1000);
  var at = function(series, ts){ var i = 0; while (i < series.t.length - 1 && series.t[i + 1] <= ts) i++; return series.t[i] <= ts ? series.c[i] : null };
  var back = function(days){ return dt[n - 1] - days * 86400 };
  out['1d'] = n > 1 ? (last / dc[n - 2] - 1) * 100 : null;
  var p = {'1w': back(7), '1m': back(30.4), '3m': back(91.3), '6m': back(182.6), '1y': back(365.25)};
  Object.keys(p).forEach(function(k){ var v = at(daily, p[k]); out[k] = v ? (last / v - 1) * 100 : null });
  var mStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000 - 1, qStart = Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1) / 1000 - 1, yStart = Date.UTC(now.getUTCFullYear(), 0, 1) / 1000 - 1;
  [['mtd', mStart], ['qtd', qStart], ['ytd', yStart]].forEach(function(x){ var v = at(daily, x[1]); out[x[0]] = v ? (last / v - 1) * 100 : null });
  if (out['1y'] == null && weekly && weekly.t && weekly.t.length) { var vy = at(weekly, dt[n - 1] - 365.25 * 86400); out['1y'] = vy ? (last / vy - 1) * 100 : null }
  if (weekly && weekly.t && weekly.t.length) [['2y', 2], ['3y', 3], ['5y', 5]].forEach(function(x){
    var ts = dt[n - 1] - x[1] * 365.25 * 86400; if (weekly.t[0] > ts + 14 * 86400) return out[x[0]] = null;
    var v = at(weekly, ts); out[x[0]] = v ? (Math.pow(last / v, 1 / x[1]) - 1) * 100 : null;
  });
  return out;
}
function drawTray(box){
  clear(box);
  var syms = tc.traySyms || TRAY_DEF;
  var f = el('form', 'frm tc-ctl'); f.autocomplete = 'off';
  var inp = el('input', 't'); inp.placeholder = TX('tray_ph'); inp.style.width = '220px'; f.appendChild(inp);
  var b = el('button', 'btn', TX('show')); b.type = 'submit'; f.appendChild(b);
  if (tc.traySyms) f.appendChild(chip(TX('tray_reset'), false, function(){ tc.traySyms = null; drawTray(box) }));
  f.onsubmit = function(e){ e.preventDefault(); var p = inp.value.split(/[\s,]+/).filter(Boolean).map(F.upSym); if (p.length) { tc.traySyms = p.slice(0, 20); drawTray(box) } };
  box.appendChild(f);
  var note = el('div', 'loading', TX('loading_d')); box.appendChild(note);
  perf(syms).then(function(rows){
    note.remove();
    var tb = table([{t: '', l: true}].concat(PERIODS.map(function(p){ return {t: TX('per_' + p), title: /^[235]y$/.test(p) ? TX('per_ann') : ''} })));
    rows.forEach(function(r){
      var tr = el('tr', 'row'); tr.appendChild(td(r.name || r.s, 'l tkc'));
      PERIODS.forEach(function(p){ var v = r.r ? r.r[p] : null; var c_ = td(v == null ? '—' : pct(v, 1), 'num ' + cls(v)); if (v != null) { c_.style.background = F.heat(v / (/^(1d|1w)$/.test(p) ? 1 : /^(mtd|1m|qtd)$/.test(p) ? 3 : 10), 1); c_.style.color = '#fff' } tr.appendChild(c_) });
      tr.onclick = function(){ openTech('TECH', r.s) };
      tb.body.appendChild(tr);
    });
    box.appendChild(tb.t);
    var bad = rows.filter(function(r){ return !r.r }).map(function(r){ return r.s });
    box.appendChild(el('div', 'note', TX('tray_note') + (bad.length ? ' ' + TX('not_loaded') + bad.join(', ') : '')));
  }).catch(function(e){ note.remove(); F.errBox(box, e) });
}
// returns of several instruments: the server's /api/perf (one request), or two histories per instrument from an older server
function perf(syms){
  return F.api('/api/perf?s=' + encodeURIComponent(syms.join(',')), {ttl: 900, timeout: 45, allowError: true}).then(function(d){
    if (!d || !d.rows) throw new Error((d && d.error) || 'old server');
    return d.rows;
  }).catch(function(e){
    if (!/old server|HTTP 404/.test(e.message)) throw e;
    return Promise.all(syms.map(function(s){
      return Promise.all([F.history(s, '1y'), F.history(s, '5y').catch(function(){ return null })]).then(function(x){ return {s: s, name: x[0].name, r: returnsFrom(x[0], x[1])} }, function(){ return {s: s, r: null} });
    }));
  });
}

/* ======================= company tabs: GE, CACS, CRPR ======================= */
F.DES_TABS.GE = function(box, d){
  var fin = d.fin || {}, q = (fin.quarterly || []).slice().sort(function(a, b){ return a.end < b.end ? -1 : 1 }), an = (fin.annual || []).slice().sort(function(a, b){ return a.end < b.end ? -1 : 1 });
  // trailing 12-month EPS: four quarters, and before that the yearly reports
  var ttm = [];
  an.forEach(function(r){ if (r.eps != null) ttm.push({d: r.end, eps: r.eps}) });
  for (var i = 3; i < q.length; i++) { var s = 0, ok = true; for (var j = i - 3; j <= i; j++) { if (q[j].eps == null) ok = false; else s += q[j].eps } if (ok) ttm.push({d: q[i].end, eps: s}) }
  ttm.sort(function(a, b){ return a.d < b.d ? -1 : 1 });
  if (ttm.length < 2) { box.appendChild(el('div', 'empty', TX('ge_none'))); return }
  var note = el('div', 'loading', TX('loading')); box.appendChild(note);
  F.history(d.s, '5y').then(function(h){
    if (!box.contains(note)) return;   // the tab was drawn again meanwhile (fresh company data): that drawing fills it
    note.remove();
    var pts = [];
    h.t.forEach(function(t, i){
      var day = new Date(t * 1000).toISOString().slice(0, 10), e = null;
      for (var k = ttm.length - 1; k >= 0; k--) if (ttm[k].d <= day) { e = ttm[k].eps; break }
      if (e > 0) pts.push({t: t, pe: h.c[i] / e});
    });
    if (pts.length < 5) { box.appendChild(el('div', 'empty', TX('ge_none'))); return }
    var vals = pts.map(function(p){ return p.pe }), avg = vals.reduce(function(a, b){ return a + b }, 0) / vals.length;
    var sd = Math.sqrt(vals.reduce(function(a, b){ return a + (b - avg) * (b - avg) }, 0) / vals.length), cur = vals[vals.length - 1];
    var st = el('div', 'stat');
    [[TX('ge_now'), fmt(cur, 1)], [TX('ge_avg'), fmt(avg, 1)], ['±1σ', fmt(avg - sd, 1) + '…' + fmt(avg + sd, 1)], [TX('ge_z'), fmt((cur - avg) / (sd || 1), 2)],
      [TX('ge_fpe'), d.m && d.m.fpe != null ? fmt(d.m.fpe, 1) : (d.co && d.co.stats && d.co.stats.fpe != null ? fmt(d.co.stats.fpe, 1) : '—')], [TX('ge_lo_hi'), fmt(Math.min.apply(null, vals), 1) + '…' + fmt(Math.max.apply(null, vals), 1)]]
      .forEach(function(x){ var s = el('span', null, x[0] + ': '); s.appendChild(el('b', null, x[1])); st.appendChild(s) });
    box.appendChild(st);
    var wrap = el('div', 'cv'); wrap.style.minHeight = '220px'; box.appendChild(wrap);
    var tt = pts.map(function(p){ return p.t });
    F.drawLines(wrap, [{name: 'P/E', color: '#ffa028', t: tt, v: vals}, {name: TX('ge_avg'), color: '#8c8c8c', t: tt, v: vals.map(function(){ return avg })},
      {name: '+1σ', color: '#4a4a4a', t: tt, v: vals.map(function(){ return avg + sd }), dash: [4, 4]}, {name: '−1σ', color: '#4a4a4a', t: tt, v: vals.map(function(){ return avg - sd }), dash: [4, 4]}], {legend: true});
    box.appendChild(el('div', 'note', TX('ge_note')));
  }).catch(function(e){ if (!box.contains(note)) return; note.remove(); F.errBox(box, e) });
};
F.DES_TABS.CACS = function(box, d){
  var co = d.co || {}, dv = co.div || {}, ev = [], today = new Date().toISOString().slice(0, 10);
  var nx = d.next || co.next;
  if (nx && nx.date) ev.push({d: nx.date, k: TX('cacs_earn'), x: (nx.hour === 'bmo' ? TX('bmo_s') : nx.hour === 'amc' ? TX('amc_s') : '') + (nx.eps_e != null ? ' · EPS ' + TX('fcst') + '$' + num(nx.eps_e, 2) : nx.eps && nx.eps.avg ? ' · EPS ' + TX('fcst') + '$' + num(nx.eps.avg, 2) : '')});
  if (dv.ex) ev.push({d: dv.ex, k: TX('cacs_ex'), x: dv.rate ? '$' + num(dv.rate / 4, 3) + ' ' + TX('cacs_est_q') : ''});
  if (dv.pay) ev.push({d: dv.pay, k: TX('cacs_pay'), x: ''});
  (dv.hist || []).slice(0, 12).forEach(function(x){ ev.push({d: x[0], k: TX('cacs_div'), x: '$' + fmt(x[1], x[1] < 1 ? 4 : 2)}) });
  (dv.splits || []).forEach(function(x){ ev.push({d: x[0], k: TX('cacs_split'), x: x[1]}) });
  (co.filings || []).slice(0, 10).forEach(function(x){ ev.push({d: x.d, k: x.type, x: x.title || '', u: x.url}) });
  (d.ern || []).slice(0, 6).forEach(function(x){ if (x.period) ev.push({d: x.period, k: TX('cacs_rep'), x: 'EPS $' + num(x.act, 2) + (x.est != null ? ' / ' + TX('fcst') + '$' + num(x.est, 2) : '')}) });
  if (!ev.length) { box.appendChild(el('div', 'empty', TX('cacs_none'))); return }
  var seen = {}; ev = ev.filter(function(e){ var k = e.d + e.k + e.x; if (seen[k]) return false; seen[k] = 1; return e.d });
  ev.sort(function(a, b){ return a.d < b.d ? 1 : -1 });
  var up = ev.filter(function(e){ return e.d >= today }), past = ev.filter(function(e){ return e.d < today });
  [[TX('cacs_up'), up.reverse()], [TX('cacs_past'), past]].forEach(function(grp){
    if (!grp[1].length) return;
    F.h4(box, grp[0]);
    var tb = table(cols(TX('cacs_cols'), [0, 1, 2]));
    grp[1].forEach(function(e){ var tr = el('tr'); tr.appendChild(td(dmy(e.d), 'l')); tr.appendChild(td(e.k, 'l tkc')); var c = td('', 'l'); if (e.u && /^https?:/.test(e.u)) { var a = el('a', null, e.x || e.k); a.href = e.u; a.target = '_blank'; a.rel = 'noopener'; c.appendChild(a) } else c.textContent = e.x; tr.appendChild(c); tb.body.appendChild(tr) });
    box.appendChild(tb.t);
  });
  box.appendChild(el('div', 'note', TX('cacs_note')));
};
var RATING_RX = /moody|fitch|s&p global ratings|standard & poor|credit rating|rating(s)? (cut|downgrade|upgrade|affirm)|outlook (to|revised)|investment[- ]grade|junk|kroll|dbrs|рейтинг/i;
F.DES_TABS.CRPR = function(box, d){
  var items = (d.cn || []).filter(function(n){ return RATING_RX.test((n.en || '') + ' ' + (n.h || '')) });
  box.appendChild(el('div', 'note', TX('crpr_note')));
  if (!items.length) box.appendChild(el('div', 'empty', TX('crpr_none')));
  else {
    var ul = el('ul', 'news');
    items.forEach(function(n){ var li = el('li'); li.appendChild(el('span', 't', new Date(n.t * 1000).toLocaleDateString(I.date, {day: '2-digit', month: '2-digit', timeZone: T.MSK})));
      var a = el('a', null, n.h); if (/^https?:\/\//.test(n.url || '')) { a.href = n.url; a.target = '_blank'; a.rel = 'noopener' } li.appendChild(a); li.appendChild(el('div', 'meta', n.src || '')); ul.appendChild(li) });
    box.appendChild(ul);
  }
  var name = (d.profile && d.profile.name) || d.s, links = el('div', 'actions');
  [['Moody’s', 'https://www.moodys.com/search?keyword=' + encodeURIComponent(name)], ['S&P', 'https://www.spglobal.com/ratings/en/search-results?query=' + encodeURIComponent(name)],
    ['Fitch', 'https://www.fitchratings.com/search/?expanded=entity&query=' + encodeURIComponent(name)]].forEach(function(x){
    var a = el('a', 'chipbtn', x[0] + ' ↗'); a.href = x[1]; a.target = '_blank'; a.rel = 'noopener'; a.style.textDecoration = 'none'; links.appendChild(a);
  });
  box.appendChild(links);
};

// the hover card belongs to a chart, a map or a heat-map tile: elsewhere (the chart redrawn or gone) it hides
document.addEventListener('pointermove', function(e){
  var tip = $('tm-tip'), t = e.target;
  if (tip && tip.style.display === 'block' && t && t.tagName !== 'CANVAS' && !(t.closest && t.closest('.tile,.tm-tip'))) tip.style.display = 'none';
}, {passive: true});

/* ======================= commands ======================= */
var C = T.CMDS;
function techCmd(tab, opts){ return function(arg){ openTech(tab, arg, opts) } }
C.TECH = techCmd('TECH'); C.G = C.TECH; C.TA = techCmd('TECH', {ta: {trend: 1, sr: 1, fib: 1, pat: 1}}); C.IND = C.TECH;
C.GPO = techCmd('TECH', {style: 'bar'}); C.GPC = techCmd('TECH', {style: 'candle'}); C.GIP = techCmd('TECH', {range: '1d'});
C['ТЕХАНАЛИЗ'] = C.TECH; C['ТА'] = C.TA; C['СВЕЧИ'] = C.GPC;
C.VAP = techCmd('VAP'); C.TSM = techCmd('TSM'); C.AQR = C.TSM; C.VWAP = C.TSM; C.QR = techCmd('QR'); C.TRA = techCmd('TRA');
C.TRAY = function(arg){ var p = String(arg || '').trim().split(/[\s,]+/).filter(Boolean); tc.traySyms = p.length ? p.map(F.upSym).slice(0, 20) : null; tc.tab = 'TRAY'; F.setTab($('tech-tabs'), 't', 'TRAY'); T.show('p-tech'); renderTech() };
['TECH', 'G', 'TA', 'IND', 'GPO', 'GPC', 'GIP', 'VAP', 'TSM', 'AQR', 'QR', 'TRA'].forEach(function(k){ T.SUFFIX[k] = 1 });
['GE', 'CACS', 'CRPR'].forEach(function(k){ C[k] = function(arg){ F.openDes(arg, k) }; T.SUFFIX[k] = 1 });
C['P/E'] = C.GE;

window.TECH = {open: openTech, analyse: analyse, ind: {ema: ema, macd: macd, stoch: stoch, atr: atr, boll: boll, vwap: vwap}, returnsFrom: returnsFrom, candles: candles, fibo: fibo, state: tc};
})();
