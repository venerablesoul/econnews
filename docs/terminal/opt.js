(function(){
'use strict';
var T = window.TERM, F = window.FN;
if (!T || !F) return;
var $ = T.$, el = T.el, TX = T.TX, I = T.I, fmt = T.fmt, pct = T.pct, cls = T.cls, store = T.store, clear = F.clear;

var MAIN = ['SPX', 'NDX', 'SPY', 'QQQ', 'IWM', 'BTC', 'ETH'];
var STOCKS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'AMD', 'NFLX', 'JPM', 'BAC', 'XOM', 'WMT', 'COST', 'LLY', 'UNH', 'V', 'MA', 'ORCL', 'INTC', 'PLTR'];
var ALL = MAIN.concat(STOCKS);
var SYN = {'S&P': 'SPX', 'SP500': 'SPX', 'SPX500': 'SPX', 'ES': 'SPX', 'NASDAQ': 'NDX', 'NQ': 'NDX', 'NDX100': 'NDX', 'RTY': 'IWM', 'RUSSELL': 'IWM',
  'BINANCE:BTCUSDT': 'BTC', 'BTCUSDT': 'BTC', 'BTCUSD': 'BTC', 'XBT': 'BTC', 'BINANCE:ETHUSDT': 'ETH', 'ETHUSDT': 'ETH', 'ETHUSD': 'ETH', 'БИТКОИН': 'BTC', 'ЭФИР': 'ETH'};
function norm(s){ s = F.upSym(s).replace(/^\^/, ''); return SYN[s] || s }

var ox = {tab: 'GEX', sym: store('gex_sym') || 'SPX', measure: store('gex_meas') || 'cp', vmode: '3d', grk: 'g', gmode: 'table', exp: null, day: null, seq: 0};
if (ALL.indexOf(ox.sym) < 0) ox.sym = 'SPX';
F.tabs($('gex-tabs'), 't', function(t){ ox.tab = t; render() });

/* ---------- colors from the page theme (index.html :root) ---------- */
function css(name, fb){ try { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fb } catch(e){ return fb } }
function C(){ return {up: css('--up', '#3fb68b'), down: css('--down', '#e5534b'), acc: css('--accent', '#d9a441'), text: css('--text', '#e6e9ef'),
  muted: css('--muted', '#8b94a3'), faint: css('--faint', '#5c6573'), line: css('--line', '#1f2630'), blue: css('--blue', '#5b9bf0'),
  violet: css('--violet', '#a78bfa'), cyan: css('--cyan', '#56c1d6'), panel: css('--panel', '#12161d'), bg: css('--bg', '#0e1116')} }
function alpha(hex, a){
  var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim()); if (!m) return hex;
  var n = parseInt(m[1], 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
var SEQ = [[30, 41, 66], [37, 88, 120], [41, 135, 140], [96, 170, 128], [190, 190, 120], [232, 196, 120]];
function seq(t){
  t = Math.max(0, Math.min(1, t)) * (SEQ.length - 1); var i = Math.min(SEQ.length - 2, Math.floor(t)), f = t - i, a = SEQ[i], b = SEQ[i + 1];
  return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')';
}
function div(t){
  t = Math.max(-1, Math.min(1, t || 0)); var g = [70, 76, 86], e = t > 0 ? [52, 160, 115] : [205, 80, 72], f = Math.abs(t);
  return 'rgb(' + Math.round(g[0] + (e[0] - g[0]) * f) + ',' + Math.round(g[1] + (e[1] - g[1]) * f) + ',' + Math.round(g[2] + (e[2] - g[2]) * f) + ')';
}

/* ---------- numbers ---------- */
function usd(v){ return v == null ? '—' : F.money(v) }
function dgt(p){ return p >= 1000 ? 0 : p >= 100 ? 1 : 2 }
function px(v, ref){ return v == null ? '—' : fmt(v, dgt(ref || v)) }
function ivp(v){ return v == null ? '—' : fmt(v * 100, 1) + '%' }
function dist(v, S){ return v == null || !S ? '' : pct((v / S - 1) * 100, 1) }
function ago(iso){
  if (!iso) return '';
  var m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? TX('ago_now') : m < 90 ? TX('ago_min', m) : m < 48 * 60 ? TX('ago_h', Math.round(m / 60)) : T.dmy ? T.dmy(iso.slice(0, 10)) : iso.slice(0, 10);
}
function ticks(lo, hi, n){
  var span = hi - lo; if (!(span > 0)) return [lo];
  var step = Math.pow(10, Math.floor(Math.log10(span / n))), err = span / n / step;
  step *= err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  var out = []; for (var v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/* ---------- canvas ---------- */
function canvasIn(wrap){
  clear(wrap);
  var W = wrap.clientWidth, H = wrap.clientHeight; if (!W || !H) return null;
  var cv = el('canvas'), dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; wrap.appendChild(cv);
  var g = cv.getContext('2d'); g.scale(dpr, dpr);
  g.font = '11px ' + getComputedStyle(document.body).fontFamily; g.textBaseline = 'middle';
  return {cv: cv, g: g, W: W, H: H};
}
function keep(wrap, draw){ wrap.__draw = draw; if (F.canvases().indexOf(wrap) < 0) F.canvases().push(wrap); draw() }
function tip(lines, e){
  var t = $('tm-tip'); clear(t);
  lines.forEach(function(l, i){ var n = el(i ? 'div' : 'b', l[1] || null, l[0]); t.appendChild(n) });
  t.style.display = 'block';
  var x = e.clientX + 14, y = e.clientY + 14;
  if (x + t.offsetWidth > window.innerWidth - 6) x = e.clientX - t.offsetWidth - 14;
  if (y + t.offsetHeight > window.innerHeight - 6) y = e.clientY - t.offsetHeight - 10;
  t.style.left = x + 'px'; t.style.top = y + 'px';
}
function untip(){ $('tm-tip').style.display = 'none' }

function plot(wrap, spec){
  keep(wrap, function(){
    var c = canvasIn(wrap); if (!c) return;
    var g = c.g, W = c.W, H = c.H, K = C(), L = 8, R = 58, TOP = spec.title ? 20 : 8, B = 20;
    var xs = [], ys = [];
    (spec.lines || []).concat(spec.bars || []).forEach(function(s){ s.x.forEach(function(x, i){ if (s.y[i] != null && x != null) { xs.push(x); ys.push(s.y[i]) } }) });
    (spec.hl || []).forEach(function(h){ if (h.y != null && spec.hlScale !== false) ys.push(h.y) });
    if (!xs.length) { g.fillStyle = K.faint; g.fillText(TX('no_data_yet'), L, H / 2); return }
    var x0 = spec.xmin != null ? spec.xmin : Math.min.apply(null, xs), x1 = spec.xmax != null ? spec.xmax : Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (spec.zero || (spec.bars && spec.bars.length)) { y0 = Math.min(y0, 0); y1 = Math.max(y1, 0) }
    var pad = (y1 - y0) * 0.08 || Math.abs(y1) * 0.05 || 1; y0 -= pad; y1 += pad;
    if (x1 === x0) { x0 -= 1; x1 += 1 }
    var X = function(x){ return L + (x - x0) / (x1 - x0) * (W - L - R) }, Y = function(y){ return TOP + (y1 - y) / (y1 - y0) * (H - TOP - B) };
    if (spec.title) { g.fillStyle = K.muted; g.fillText(spec.title, L, 10) }
    ticks(y0, y1, 4).forEach(function(v){ var y = Y(v); g.strokeStyle = alpha(K.text, 0.05); g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.fillStyle = K.faint; g.fillText((spec.yfmt || fmt)(v), W - R + 6, y) });
    var xt = spec.xticks ? spec.xticks(x0, x1) : ticks(x0, x1, Math.max(2, Math.floor((W - L - R) / 90)));
    g.textAlign = 'center';
    xt.forEach(function(v){ var x = X(v); if (x < L || x > W - R) return; g.fillStyle = K.faint; g.fillText((spec.xfmt || fmt)(v), x, H - B / 2) });
    g.textAlign = 'left';
    if (spec.zero) { g.strokeStyle = alpha(K.text, 0.25); g.beginPath(); g.moveTo(L, Y(0)); g.lineTo(W - R, Y(0)); g.stroke() }
    (spec.bars || []).forEach(function(s){
      var n = s.x.length, bw = Math.max(1, (W - L - R) / Math.max(n, 1) * 0.7);
      s.x.forEach(function(x, i){ var v = s.y[i]; if (v == null) return; g.fillStyle = s.color ? s.color(v, i) : (v >= 0 ? alpha(K.up, 0.6) : alpha(K.down, 0.6)); var y = Y(v), yz = Y(0); g.fillRect(X(x) - bw / 2, Math.min(y, yz), bw, Math.max(1, Math.abs(yz - y))) });
    });
    (spec.vl || []).forEach(function(v){ if (v.x == null) return; var x = X(v.x); if (x < L || x > W - R) return; g.strokeStyle = v.color; g.setLineDash(v.dash || [4, 4]); g.beginPath(); g.moveTo(x, TOP); g.lineTo(x, H - B); g.stroke(); g.setLineDash([]); if (v.label) { g.fillStyle = v.color; g.fillText(v.label, Math.min(x + 4, W - R - g.measureText(v.label).width - 2), TOP + 6) } });
    (spec.hl || []).forEach(function(h){ if (h.y == null) return; var y = Y(h.y); if (y < TOP || y > H - B) return; g.strokeStyle = h.color; g.setLineDash(h.dash || [4, 4]); g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.setLineDash([]); if (h.label) { g.fillStyle = h.color; g.fillText(h.label, L + 4, y - 7) } });
    (spec.lines || []).forEach(function(s){
      g.beginPath(); var on = false;
      s.x.forEach(function(x, i){ var v = s.y[i]; if (v == null || x == null) { on = false; return } var a = X(x), b = (s.Y || Y)(v); if (!on) { g.moveTo(a, b); on = true } else g.lineTo(a, b) });
      g.strokeStyle = s.color; g.lineWidth = s.width || 1.5; g.setLineDash(s.dash || []); g.stroke(); g.setLineDash([]); g.lineWidth = 1;
    });
    var lx = L + (spec.title ? g.measureText(spec.title + '   ').width : 0);
    (spec.lines || []).concat(spec.bars || []).forEach(function(s){ if (!s.name) return; g.fillStyle = s.legend || s.color || K.muted; g.fillText(s.name, lx, 10); lx += g.measureText(s.name + '   ').width });
    c.cv.onmousemove = function(e){
      var r = c.cv.getBoundingClientRect(), mx = e.clientX - r.left, xv = x0 + (mx - L) / (W - L - R) * (x1 - x0);
      var lines = [[(spec.xfmt || fmt)(xv)]];
      (spec.lines || []).concat(spec.bars || []).forEach(function(s){
        var best = -1, bd = Infinity; s.x.forEach(function(x, i){ if (s.y[i] == null) return; var d = Math.abs(x - xv); if (d < bd) { bd = d; best = i } });
        if (best >= 0) { lines[0][0] = (spec.xfmt || fmt)(s.x[best]); lines.push([(s.name ? s.name + ': ' : '') + (s.tfmt || spec.yfmt || fmt)(s.y[best])]) }
      });
      tip(lines, e);
    };
    c.cv.onmouseleave = untip;
  });
}

/* ======================= loading ======================= */
function load(sym, hist){
  var name = 'gex/' + (hist ? 'hist/' : '') + sym + '.json';
  return F.page(name, 120).catch(function(e){ throw /404/.test(e.message) ? new Error(TX('gex_none', sym)) : e });
}
function open(tab, arg){
  var a = String(arg || '').trim().split(/\s+/).filter(Boolean);
  a.forEach(function(w){
    var u = w.toUpperCase();
    if (/^(NET|CP|FRONT|0DTE|VANNA|CHARM|OI)$/.test(u)) ox.measure = u === '0DTE' ? 'front' : u.toLowerCase();
    else ox.sym = norm(w);
  });
  store('gex_sym', ox.sym); store('gex_meas', ox.measure);
  ox.tab = tab || ox.tab; F.setTab($('gex-tabs'), 't', ox.tab);
  T.show('p-gex'); render();
}
function render(){
  if (!F.visible('p-gex')) return;
  var host = $('gex-body'); clear(host);
  var box = el('div', 'mon-in'); host.appendChild(box);
  $('gex-code').textContent = ox.tab;
  $('gex-title').textContent = TX('gex_t_' + ox.tab, ox.sym);
  $('gex-sub').textContent = '';
  symBar(box);
  if (ALL.indexOf(ox.sym) < 0) { box.appendChild(el('div', 'empty', TX('gex_which', MAIN.join(', '), STOCKS.slice(0, 8).join(', ')))); return }
  var seq = ++ox.seq;
  F.loading(box);
  var want = ox.tab === 'GEXH' ? Promise.all([load(ox.sym), load(ox.sym, true)]) : load(ox.sym).then(function(d){ return [d, null] });
  want.then(function(r){
    if (seq !== ox.seq) return;
    var d = r[0];
    var ld = box.querySelector('.loading'); if (ld) ld.remove();
    $('gex-sub').textContent = (d.n || d.s) + ' · ' + srcName(d.src) + ' · ' + ago(d.updated);
    ({GEX: drawGex, LVL: drawLvl, VOLS: drawVols, GRK: drawGrk, GEXH: drawHist}[ox.tab] || drawGex)(box, d, r[1]);
  }).catch(function(e){ if (seq !== ox.seq) return; var ld = box.querySelector('.loading'); if (ld) ld.remove(); box.appendChild(el('div', 'empty', e.message || String(e))) });
}
F.RENDER['p-gex'] = function(){ if (!$('gex-body').querySelector('canvas,table,.empty')) render() };
function srcName(s){ return {cboe: 'Cboe', yahoo: 'Yahoo Finance', deribit: 'Deribit'}[s] || s || '' }

function chip(text, on, onclick, title){ var b = el('button', 'chipbtn' + (on ? ' on' : ''), text); b.type = 'button'; if (title) b.title = title; b.onclick = onclick; return b }
function symBar(box){
  var f = el('form', 'frm'); f.autocomplete = 'off';
  MAIN.forEach(function(s){ f.appendChild(chip(s, s === ox.sym, function(){ ox.sym = s; store('gex_sym', s); render() })) });
  var i = el('input', 't'); i.placeholder = TX('gex_other'); i.style.width = '90px'; i.value = MAIN.indexOf(ox.sym) < 0 ? ox.sym : '';
  i.title = STOCKS.join(' ');
  f.appendChild(i);
  f.onsubmit = function(e){ e.preventDefault(); if (i.value.trim()) { ox.sym = norm(i.value); store('gex_sym', ox.sym); render() } };
  box.appendChild(f);
  return f;
}
function stat(box, pairs){
  var st = el('div', 'stat');
  pairs.forEach(function(x){ if (!x) return; var s = el('span', null, x[0] + ': '); s.appendChild(el('b', x[2] || null, x[1])); if (x[3]) s.title = x[3]; st.appendChild(s) });
  box.appendChild(st); return st;
}
function note(box, text){ box.appendChild(el('div', 'note', text)) }
function regime(d){ var g = d.tot && d.tot.gex; return g == null ? null : g >= 0 ? TX('gex_pos') : TX('gex_neg') }

/* ======================= GEX: exposure by strike ======================= */
var MEAS = [['cp', 'gex_m_cp'], ['net', 'gex_m_net'], ['front', 'gex_m_front'], ['vanna', 'gex_m_vanna'], ['charm', 'gex_m_charm'], ['oi', 'gex_m_oi']];
function drawGex(box, d){
  var S = d.px, lv = d.levels || {}, tot = d.tot || {};
  stat(box, [[TX('gex_spot'), px(S)], [TX('gex_total'), usd(tot.gex), tot.gex >= 0 ? 'up' : 'down', TX('gex_total_t')], [TX('gex_flip'), px(lv.zero, S) + ' ' + dist(lv.zero, S), null, TX('gex_flip_t')],
    [TX('gex_cwall'), px(lv.cwall, S), 'up', TX('gex_cwall_t')], [TX('gex_pwall'), px(lv.pwall, S), 'down', TX('gex_pwall_t')], [TX('gex_pcr'), tot.pcr_oi == null ? '—' : fmt(tot.pcr_oi, 2)]]);
  var f = el('div', 'frm');
  MEAS.forEach(function(m){ f.appendChild(chip(TX(m[1]), ox.measure === m[0], function(){ ox.measure = m[0]; store('gex_meas', m[0]); clear(box); symBar(box); drawGex(box, d) })) });
  box.appendChild(f);
  var wrap = el('div', 'cv gx-cv'); box.appendChild(wrap);
  bars(wrap, d);
  note(box, (regime(d) || '') + ' ' + TX('gex_note'));
}
function series(d){
  var m = ox.measure, k = d.k || [];
  if (m === 'cp') return {a: d.gc, b: d.gp, fmt: usd};
  if (m === 'net') return {n: k.map(function(_, i){ return (d.gc[i] || 0) + (d.gp[i] || 0) }), fmt: usd};
  if (m === 'front') return {n: d.gf, fmt: usd};
  if (m === 'vanna') return {n: d.vx, fmt: usd};
  if (m === 'charm') return {n: d.cx, fmt: usd};
  return {a: d.oc, b: (d.op || []).map(function(v){ return -v }), fmt: function(v){ return fmt(Math.abs(v), 0) }};
}
function bars(wrap, d){
  keep(wrap, function(){
    var c = canvasIn(wrap); if (!c) return;
    var g = c.g, W = c.W, H = c.H, K = C(), ks = (d.k || []).slice(), n = ks.length, S = d.px, lv = d.levels || {};
    if (!n) return;
    var s = series(d), LBL = 62, R = 12, TOP = 8, B = 18, rowH = (H - TOP - B) / n;
    var vals = s.n ? s.n : s.a.concat(s.b), mx = Math.max.apply(null, vals.map(function(v){ return Math.abs(v || 0) })) || 1;
    var x0 = LBL + (W - LBL - R) / 2, half = (W - LBL - R) / 2 - 4;
    var Yk = function(i){ return TOP + (n - 1 - i + 0.5) * rowH };
    var Yp = function(p){
      if (p == null) return null;
      if (p <= ks[0]) return Yk(0) + (ks[0] - p) / ((ks[1] - ks[0]) || 1) * rowH;
      for (var i = 1; i < n; i++) if (p <= ks[i]) return Yk(i - 1) - (p - ks[i - 1]) / (ks[i] - ks[i - 1]) * rowH;
      return Yk(n - 1) - (p - ks[n - 1]) / ((ks[n - 1] - ks[n - 2]) || 1) * rowH;
    };
    var every = Math.max(1, Math.ceil(13 / rowH)), wall = function(k){ return k === lv.cwall || k === lv.pwall }, lastY = -99;
    g.strokeStyle = alpha(K.text, 0.18); g.beginPath(); g.moveTo(x0, TOP); g.lineTo(x0, H - B); g.stroke();
    for (var i = 0; i < n; i++) {
      var y = Yk(i), bh = Math.max(1, Math.min(rowH * 0.72, 14));
      var nearWall = !wall(ks[i]) && ks.some(function(k, j){ return wall(k) && Math.abs(j - i) * rowH < 12 });
      if ((i % every === 0 && !nearWall && Math.abs(y - lastY) >= 12) || wall(ks[i])) { g.fillStyle = ks[i] === lv.cwall ? K.up : ks[i] === lv.pwall ? K.down : K.muted; g.textAlign = 'right'; g.fillText(fmt(ks[i], ks[i] % 1 ? 1 : 0), LBL - 8, y); g.textAlign = 'left'; lastY = y }
      if (s.n) { var v = s.n[i] || 0, w = Math.abs(v) / mx * half; g.fillStyle = v >= 0 ? alpha(K.up, 0.75) : alpha(K.down, 0.75); g.fillRect(v >= 0 ? x0 : x0 - w, y - bh / 2, Math.max(w, v ? 1 : 0), bh) }
      else {
        var a = s.a[i] || 0, b = s.b[i] || 0;
        g.fillStyle = alpha(K.up, 0.75); g.fillRect(x0, y - bh / 2, Math.abs(a) / mx * half, bh);
        g.fillStyle = alpha(K.down, 0.75); var wb = Math.abs(b) / mx * half; g.fillRect(x0 - wb, y - bh / 2, wb, bh);
      }
    }
    var mark = function(p, col, label, dash){ var y = Yp(p); if (y == null || y < TOP - 2 || y > H - B + 2) return; g.strokeStyle = col; g.setLineDash(dash || []); g.beginPath(); g.moveTo(LBL - 4, y); g.lineTo(W - R, y); g.stroke(); g.setLineDash([]); var tw = g.measureText(label).width; g.fillStyle = alpha(K.panel, 0.85); g.fillRect(W - R - tw - 6, y - 15, tw + 6, 14); g.fillStyle = col; g.fillText(label, W - R - tw - 3, y - 8) };
    mark(lv.zero, K.acc, TX('gex_flip') + ' ' + px(lv.zero, S), [5, 4]);
    mark(S, K.text, TX('gex_spot') + ' ' + px(S), [2, 3]);
    g.fillStyle = K.faint; g.textAlign = 'center';
    g.fillText(ox.measure === 'oi' ? TX('gex_puts_oi') : '← ' + TX('gex_neg_side'), LBL + (W - LBL - R) / 4, H - B / 2);
    g.fillText(ox.measure === 'oi' ? TX('gex_calls_oi') : TX('gex_pos_side') + ' →', LBL + (W - LBL - R) * 3 / 4, H - B / 2);
    g.textAlign = 'left';
    c.cv.onmousemove = function(e){
      var r = c.cv.getBoundingClientRect(), y = e.clientY - r.top, i = n - 1 - Math.floor((y - TOP) / rowH);
      if (i < 0 || i >= n) return untip();
      var net = (d.gc[i] || 0) + (d.gp[i] || 0);
      tip([[TX('gex_strike') + ' ' + fmt(ks[i], ks[i] % 1 ? 1 : 0) + '  ' + dist(ks[i], S)], [TX('gex_calls') + ': ' + usd(d.gc[i]), 'up'], [TX('gex_puts') + ': ' + usd(d.gp[i]), 'down'],
        [TX('gex_net') + ': ' + usd(net), cls(net)], [TX('gex_m_front') + ': ' + usd(d.gf && d.gf[i])], ['Vanna: ' + usd(d.vx && d.vx[i]) + ' · Charm: ' + usd(d.cx && d.cx[i])],
        [TX('gex_m_oi') + ': ' + fmt(d.oc && d.oc[i] || 0, 0) + ' / ' + fmt(d.op && d.op[i] || 0, 0)]], e);
    };
    c.cv.onmouseleave = untip;
  });
}

/* ======================= LVL: levels and the expected move ======================= */
function drawLvl(box, d){
  var S = d.px, lv = d.levels || {}, em = d.em || {}, K = C();
  var t = F.table([{t: TX('gex_level'), l: true}, {t: TX('gex_value')}, {t: TX('gex_dist')}, {t: TX('gex_what'), l: true}]);
  var row = function(name, v, what, cl){ var tr = el('tr'); tr.appendChild(F.td(name, 'l')); tr.appendChild(F.td(px(v, S), cl || null)); tr.appendChild(F.td(dist(v, S), v == null ? null : cls(v - S))); var w = F.td(what, 'l'); w.style.whiteSpace = 'normal'; w.style.color = 'var(--muted)'; tr.appendChild(w); t.body.appendChild(tr) };
  row(TX('gex_spot'), S, '');
  row(TX('gex_flip'), lv.zero, TX('gex_flip_t'));
  row(TX('gex_cwall'), lv.cwall, TX('gex_cwall_t'), 'up');
  row(TX('gex_pwall'), lv.pwall, TX('gex_pwall_t'), 'down');
  row(TX('gex_maxpos'), lv.pos, TX('gex_maxpos_t'));
  row(TX('gex_maxneg'), lv.neg, TX('gex_maxneg_t'));
  row(TX('gex_pain'), lv.pain, TX('gex_pain_t', F.dmy(lv.pain_d)));
  if (em.d1) { row(TX('gex_em_lo'), S - em.d1, TX('gex_em_t', fmt(em.d1_pct, 2), ivp(em.iv30))); row(TX('gex_em_hi'), S + em.d1, '') }
  if (em.w1) { row(TX('gex_emw_lo'), S - em.w1, ''); row(TX('gex_emw_hi'), S + em.w1, '') }
  if (em.straddle) row(TX('gex_straddle', F.dmy(em.front)), S + em.straddle, TX('gex_straddle_t', px(em.straddle, S), fmt(em.straddle_pct, 2)));
  var vix = d.s === 'SPX' && T.Q.VIX && T.Q.VIX.value, vol = vix || d.dvol;
  if (vol) { var sd = S * vol / 100 / Math.sqrt(d.kind === 'crypto' ? 365 : 252); row(TX(vix ? 'gex_vix' : 'gex_dvol', fmt(vol, 1)), S + sd, TX('gex_vix_t', '±' + px(sd, S), px(S - sd, S))) }
  var sc = el('div', 'gx-tbl'); sc.appendChild(t.t); box.appendChild(sc);
  if (chartSym(d.s)) {
    var a = el('div', 'actions');
    var b = el('button', null, TX('gex_on_chart')); b.onclick = function(){ if (window.TECH && TECH.showGex) TECH.showGex(chartSym(d.s)) }; a.appendChild(b);
    box.appendChild(a);
  }
  var wrap = el('div', 'cv gx-small'); box.appendChild(wrap);
  var p = d.prof || {};
  plot(wrap, {title: TX('gex_prof'), lines: [{x: p.x || [], y: p.y || [], color: K.acc, name: TX('gex_total'), tfmt: usd}], zero: true, yfmt: usd, xfmt: function(v){ return px(v, S) },
    vl: [{x: S, color: K.text, label: TX('gex_spot'), dash: [2, 3]}, {x: lv.zero, color: K.acc, label: TX('gex_flip')}]});
  note(box, TX('gex_lvl_note'));
}
function chartSym(s){ return s === 'NDX' ? null : {SPX: 'S&P', BTC: 'BTC', ETH: 'ETH'}[s] || s }

/* ======================= VOLS: the volatility surface ======================= */
function drawVols(box, d){
  var sf = d.surf || {}, K = C();
  var f = el('div', 'frm');
  [['3d', 'gex_3d'], ['heat', 'gex_heat']].forEach(function(m){ f.appendChild(chip(TX(m[1]), ox.vmode === m[0], function(){ ox.vmode = m[0]; clear(box); symBar(box); drawVols(box, d) })) });
  var term = d.term || [], iv30 = d.em && d.em.iv30;
  stat(box, [[TX('gex_iv30'), ivp(iv30)], term.length ? [TX('gex_front_iv'), ivp(term[0][2])] : null, term.length > 1 ? [TX('gex_back_iv'), ivp(term[term.length - 1][2])] : null,
    d.dvol ? ['DVOL', fmt(d.dvol, 1)] : null, d.s === 'SPX' && T.Q.VIX ? ['VIX', fmt(T.Q.VIX.value, 2)] : null]);
  box.appendChild(f);
  if (!sf.iv || !sf.iv.length) { box.appendChild(el('div', 'empty', TX('no_data_yet'))); return }
  var top = el('div', 'cv gx-3d'); box.appendChild(top);
  var zs = sf.iv, xl = sf.m.map(function(m){ return fmt(m * 100, 0) + '%' }), yl = sf.d.map(function(x){ return I.dm(x) });
  if (ox.vmode === '3d') surface(top, zs, {xl: xl, yl: yl, zfmt: ivp, xname: TX('gex_moneyness'), yname: TX('gex_expiry'), zname: 'IV'});
  else heatGrid(top, zs, {xl: xl, yl: yl, zfmt: ivp, xname: TX('gex_moneyness')});
  if (!ox.exp || sf.d.indexOf(ox.exp) < 0) ox.exp = sf.d[0];
  var f2 = el('div', 'frm');
  sf.d.forEach(function(x){ f2.appendChild(chip(I.dm(x), x === ox.exp, function(){ ox.exp = x; clear(box); symBar(box); drawVols(box, d) })) });
  box.appendChild(f2);
  var two = el('div', 'gx-two'); box.appendChild(two);
  var w1 = el('div', 'cv gx-small'), w2 = el('div', 'cv gx-small'); two.appendChild(w1); two.appendChild(w2);
  var row = zs[sf.d.indexOf(ox.exp)] || [];
  plot(w1, {title: TX('gex_smile', F.dmy(ox.exp)), lines: [{x: sf.m.map(function(m){ return m * 100 }), y: row.map(function(v){ return v == null ? null : v * 100 }), color: K.cyan, tfmt: function(v){ return fmt(v, 1) + '%' }}],
    yfmt: function(v){ return fmt(v, 0) + '%' }, xfmt: function(v){ return fmt(v, 0) + '%' }, vl: [{x: 100, color: K.faint, dash: [2, 3]}]});
  var t2 = term.filter(function(x){ return x[2] != null });
  plot(w2, {title: TX('gex_term'), lines: [{x: t2.map(function(x){ return x[1] }), y: t2.map(function(x){ return x[2] * 100 }), color: K.acc, tfmt: function(v){ return fmt(v, 1) + '%' }}],
    yfmt: function(v){ return fmt(v, 0) + '%' }, xfmt: function(v){ return fmt(v, 0) + TX('gex_d') }});
  if (d.dvol_hist && d.dvol_hist.length) {
    var w3 = el('div', 'cv gx-small'); box.appendChild(w3);
    var h = d.dvol_hist;
    plot(w3, {title: TX('gex_dvol_t'), lines: [{x: h.map(function(r){ return Date.parse(r[0] + 'Z') }), y: h.map(function(r){ return r[1] }), color: K.violet}],
      yfmt: function(v){ return fmt(v, 0) }, xfmt: function(v){ return new Date(v).toLocaleDateString(I.date, {day: 'numeric', month: 'short'}) }});
  }
  note(box, TX('gex_vols_note'));
}

function surface(wrap, zs, o){
  var st = wrap.__st || (wrap.__st = {yaw: -0.75, pitch: 0.55});
  keep(wrap, function(){
    var c = canvasIn(wrap); if (!c) return;
    var g = c.g, W = c.W, H = c.H, K = C(), ny = zs.length, nx = zs[0].length;
    var zv = []; zs.forEach(function(r){ r.forEach(function(v){ if (v != null) zv.push(v) }) });
    if (!zv.length) return;
    var zlo = Math.min.apply(null, zv), zhi = Math.max.apply(null, zv), zsp = (zhi - zlo) || 1;
    var cy = Math.cos(st.yaw), sy = Math.sin(st.yaw), cp = Math.cos(st.pitch), sp = Math.sin(st.pitch);
    var raw = function(i, j, z){
      var x = (i / (nx - 1) - 0.5) * 2, y = (j / Math.max(ny - 1, 1) - 0.5) * 2, h = (z - 0.5) * 1.5;
      var rx = x * cy - y * sy, ry = x * sy + y * cy;
      return [rx, -(h * cp - ry * sp) * 0.9, ry * cp + h * sp];
    };
    var bx = [], by = [];
    [0, nx - 1].forEach(function(i){ [0, ny - 1].forEach(function(j){ [0, 1].forEach(function(z){ var q = raw(i, j, z); bx.push(q[0]); by.push(q[1]) }) }) });
    var minx = Math.min.apply(null, bx), maxx = Math.max.apply(null, bx), miny = Math.min.apply(null, by), maxy = Math.max.apply(null, by);
    var sc = Math.min((W - 110) / (maxx - minx || 1), (H - 70) / (maxy - miny || 1));
    var ox_ = W / 2 - (minx + maxx) / 2 * sc, oy = 34 + (H - 70) / 2 - (miny + maxy) / 2 * sc;
    var P = function(i, j, z){ var q = raw(i, j, z); return [ox_ + q[0] * sc, oy + q[1] * sc, q[2]] };
    var quads = [];
    for (var j = 0; j < ny - 1; j++) for (var i = 0; i < nx - 1; i++) {
      var v = [zs[j][i], zs[j][i + 1], zs[j + 1][i + 1], zs[j + 1][i]];
      if (v.some(function(x){ return x == null })) continue;
      var n = v.map(function(x){ return (x - zlo) / zsp });
      var p = [P(i, j, n[0]), P(i + 1, j, n[1]), P(i + 1, j + 1, n[2]), P(i, j + 1, n[3])];
      quads.push({p: p, d: (p[0][2] + p[1][2] + p[2][2] + p[3][2]) / 4, t: (n[0] + n[1] + n[2] + n[3]) / 4});
    }
    g.strokeStyle = alpha(K.text, 0.08);
    for (var a = 0; a < nx; a += Math.max(1, Math.floor(nx / 6))) { var f0 = P(a, 0, 0), f1 = P(a, ny - 1, 0); g.beginPath(); g.moveTo(f0[0], f0[1]); g.lineTo(f1[0], f1[1]); g.stroke() }
    for (var b = 0; b < ny; b += Math.max(1, Math.floor(ny / 6))) { var e0 = P(0, b, 0), e1 = P(nx - 1, b, 0); g.beginPath(); g.moveTo(e0[0], e0[1]); g.lineTo(e1[0], e1[1]); g.stroke() }
    quads.sort(function(a, b){ return b.d - a.d });
    quads.forEach(function(q){
      g.beginPath(); g.moveTo(q.p[0][0], q.p[0][1]); for (var k = 1; k < 4; k++) g.lineTo(q.p[k][0], q.p[k][1]); g.closePath();
      g.fillStyle = seq(q.t); g.fill(); g.strokeStyle = 'rgba(0,0,0,0.18)'; g.stroke();
    });
    g.fillStyle = K.faint; g.textAlign = 'center';
    for (var xi = 0; xi < nx; xi += Math.max(1, Math.floor(nx / 5))) { var q0 = P(xi, 0, 0); g.fillText(o.xl[xi], q0[0], q0[1] + 12) }
    for (var yi = 0; yi < ny; yi += Math.max(1, Math.floor(ny / 5))) { var q1 = P(nx - 1, yi, 0); g.fillText(o.yl[yi], q1[0] + 18, q1[1] + 4) }
    g.textAlign = 'left';
    var gw = 120, gx = W - gw - 12, gy = 12;
    for (var s = 0; s < gw; s++) { g.fillStyle = seq(s / gw); g.fillRect(gx + s, gy, 1, 7) }
    g.fillStyle = K.muted; g.fillText(o.zfmt(zlo), gx, gy + 16); var hi = o.zfmt(zhi); g.fillText(hi, gx + gw - g.measureText(hi).width, gy + 16);
    g.fillText(o.zname + ' · ' + o.xname + ' × ' + o.yname, 10, 12);
    g.fillStyle = K.faint; g.fillText(TX('gex_drag'), 10, H - 10);
  });
  if (!wrap.__drag) {
    wrap.__drag = true;
    var down = null;
    wrap.addEventListener('pointerdown', function(e){ down = [e.clientX, e.clientY, st.yaw, st.pitch]; try { wrap.setPointerCapture(e.pointerId) } catch(x){} });
    wrap.addEventListener('pointermove', function(e){ if (!down) return; st.yaw = down[2] + (e.clientX - down[0]) / 150; st.pitch = Math.max(0.1, Math.min(1.3, down[3] + (e.clientY - down[1]) / 200)); wrap.__draw() });
    wrap.addEventListener('pointerup', function(){ down = null });
    wrap.addEventListener('pointercancel', function(){ down = null });
    wrap.style.touchAction = 'none';
  }
}
function heatGrid(wrap, zs, o){
  keep(wrap, function(){
    var c = canvasIn(wrap); if (!c) return;
    var g = c.g, W = c.W, H = c.H, K = C(), ny = zs.length, nx = zs[0].length, L = 64, TOP = 8, B = 20;
    var zv = []; zs.forEach(function(r){ r.forEach(function(v){ if (v != null) zv.push(v) }) });
    var lo = Math.min.apply(null, zv), hi = Math.max.apply(null, zv), sp = (hi - lo) || 1;
    var cw = (W - L - 8) / nx, ch = (H - TOP - B) / ny;
    for (var j = 0; j < ny; j++) {
      g.fillStyle = K.muted; g.textAlign = 'right'; g.fillText(o.yl[j], L - 6, TOP + (j + 0.5) * ch); g.textAlign = 'left';
      for (var i = 0; i < nx; i++) {
        var v = zs[j][i]; if (v == null) continue;
        g.fillStyle = seq((v - lo) / sp); g.fillRect(L + i * cw + 0.5, TOP + j * ch + 0.5, cw - 1, ch - 1);
        if (cw > 38 && ch > 13) { g.fillStyle = 'rgba(0,0,0,0.75)'; g.textAlign = 'center'; g.fillText(o.zfmt(v), L + (i + 0.5) * cw, TOP + (j + 0.5) * ch); g.textAlign = 'left' }
      }
    }
    g.fillStyle = K.faint; g.textAlign = 'center';
    for (var x = 0; x < nx; x += Math.max(1, Math.ceil(nx / 8))) g.fillText(o.xl[x], L + (x + 0.5) * cw, H - B / 2);
    g.textAlign = 'left';
    c.cv.onmousemove = function(e){
      var r = c.cv.getBoundingClientRect(), i = Math.floor((e.clientX - r.left - L) / cw), j = Math.floor((e.clientY - r.top - TOP) / ch);
      if (i < 0 || j < 0 || i >= nx || j >= ny || zs[j][i] == null) return untip();
      tip([[o.yl[j] + ' · ' + o.xl[i]], [o.zfmt(zs[j][i])]], e);
    };
    c.cv.onmouseleave = untip;
  });
}

/* ======================= GRK: greeks ======================= */
var GRK = [['dc', 'Δ ' + 'C'], ['dp', 'Δ ' + 'P'], ['g', 'Γ'], ['tc', 'Θ C'], ['tp', 'Θ P'], ['v', 'ν']];
function gfmt(k){ return function(v){ return v == null ? '—' : k === 'dc' || k === 'dp' ? fmt(v, 2) : k === 'g' ? fmt(v, 3) : fmt(v, Math.abs(v) >= 100 ? 0 : 2) } }
function drawGrk(box, d){
  var gk = d.grk || {}, S = d.px;
  var f = el('div', 'frm');
  GRK.forEach(function(x){ f.appendChild(chip(x[1], ox.grk === x[0], function(){ ox.grk = x[0]; clear(box); symBar(box); drawGrk(box, d) }, TX('grk_' + x[0]))) });
  f.appendChild(el('span', 'tc-sep'));
  [['table', 'gex_table'], ['3d', 'gex_3d']].forEach(function(m){ f.appendChild(chip(TX(m[1]), ox.gmode === m[0], function(){ ox.gmode = m[0]; clear(box); symBar(box); drawGrk(box, d) })) });
  box.appendChild(f);
  if (!gk.k || !gk.k.length || !gk[ox.grk]) { box.appendChild(el('div', 'empty', TX('no_data_yet'))); return }
  var M = gk[ox.grk], fm = gfmt(ox.grk);
  if (ox.gmode === '3d') {
    var wrap = el('div', 'cv gx-3d'); box.appendChild(wrap);
    surface(wrap, M, {xl: gk.k.map(function(k){ return fmt(k, dgt(S)) }), yl: gk.d.map(function(x){ return I.dm(x) }), zfmt: fm, xname: TX('gex_strike'), yname: TX('gex_expiry'), zname: TX('grk_' + ox.grk)});
  } else {
    var cols = [{t: TX('gex_strike'), l: true}].concat(gk.d.map(function(x){ return {t: I.dm(x)} }));
    var t = F.table(cols); t.t.classList.add('mx');
    var all = []; M.forEach(function(r){ r.forEach(function(v){ if (v != null) all.push(v) }) });
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), amax = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    var nearest = gk.k.reduce(function(a, k){ return Math.abs(k - S) < Math.abs(a - S) ? k : a }, gk.k[0]);
    gk.k.slice().reverse().forEach(function(k){
      var j = gk.k.indexOf(k), tr = el('tr', k === nearest ? 'me' : null);
      tr.appendChild(F.td(fmt(k, dgt(S)), 'l'));
      gk.d.forEach(function(_, i){
        var v = M[i] && M[i][j], cell = F.td(fm(v));
        if (v != null) { cell.style.background = ox.grk === 'dc' || ox.grk === 'dp' || ox.grk === 'tc' || ox.grk === 'tp' ? div(v / amax) : seq((v - lo) / ((hi - lo) || 1)); cell.style.color = '#0b0d10' }
        tr.appendChild(cell);
      });
      t.body.appendChild(tr);
    });
    var sc = el('div', 'gx-tbl'); sc.appendChild(t.t); box.appendChild(sc);
    var me = t.body.querySelector('tr.me'); if (me) setTimeout(function(){ sc.scrollTop = Math.max(0, me.offsetTop - sc.clientHeight / 2) }, 0);
  }
  note(box, TX('grk_note'));
}

/* ======================= GEXH: history ======================= */
function drawHist(box, d, h){
  h = h || {}; var K = C(), intra = h.intra || [], days = h.days || [];
  var sess = []; intra.forEach(function(x){ if (sess.indexOf(x.day) < 0) sess.push(x.day) });
  if (!ox.day || sess.indexOf(ox.day) < 0) ox.day = sess[sess.length - 1];
  var f = el('div', 'frm');
  sess.forEach(function(s){ f.appendChild(chip(I.dm(s), s === ox.day, function(){ ox.day = s; clear(box); symBar(box); drawHist(box, d, h) })) });
  box.appendChild(f);
  var pts = intra.filter(function(x){ return x.day === ox.day });
  var wrap = el('div', 'cv gx-imap'); box.appendChild(wrap);
  if (pts.length) intervalMap(wrap, pts, d);
  else wrap.appendChild(el('div', 'empty', TX('gex_hist_none')));
  var two = el('div', 'gx-two'); box.appendChild(two);
  var w1 = el('div', 'cv gx-small'), w2 = el('div', 'cv gx-small'); two.appendChild(w1); two.appendChild(w2);
  var tt = function(x){ return Date.parse(x) };
  var tf = function(v){ return new Date(v).toLocaleTimeString(I.date, {hour: '2-digit', minute: '2-digit', timeZone: T.MSK}) };
  plot(w1, {title: TX('gex_iv_day'), lines: [{x: pts.map(function(p){ return tt(p.t) }), y: pts.map(function(p){ return p.iv == null ? null : p.iv * 100 }), color: K.violet, name: 'IV30', tfmt: function(v){ return fmt(v, 1) + '%' }},
    {x: pts.map(function(p){ return tt(p.t) }), y: pts.map(function(p){ return p.st }), color: K.cyan, name: TX('gex_st_short'), tfmt: function(v){ return fmt(v, 2) + '%' }}], yfmt: function(v){ return fmt(v, 1) }, xfmt: tf});
  var dd = days.slice(-250);
  plot(w2, {title: TX('gex_daily'), bars: [{x: dd.map(function(r){ return Date.parse(r.d) }), y: dd.map(function(r){ return r.gex }), name: TX('gex_total'), tfmt: usd}], yfmt: usd,
    xfmt: function(v){ return new Date(v).toLocaleDateString(I.date, {day: 'numeric', month: 'short', timeZone: 'UTC'}) }});
  if (dd.length) {
    var w3 = el('div', 'cv gx-small'); box.appendChild(w3);
    plot(w3, {title: TX('gex_px_flip'), lines: [{x: dd.map(function(r){ return Date.parse(r.d) }), y: dd.map(function(r){ return r.px }), color: K.text, name: TX('gex_spot')},
      {x: dd.map(function(r){ return Date.parse(r.d) }), y: dd.map(function(r){ return r.zero }), color: K.acc, name: TX('gex_flip'), dash: [5, 4]},
      {x: dd.map(function(r){ return Date.parse(r.d) }), y: dd.map(function(r){ return r.cw }), color: alpha(K.up, 0.7), name: TX('gex_cwall'), width: 1},
      {x: dd.map(function(r){ return Date.parse(r.d) }), y: dd.map(function(r){ return r.pw }), color: alpha(K.down, 0.7), name: TX('gex_pwall'), width: 1}],
      yfmt: function(v){ return px(v, d.px) }, xfmt: function(v){ return new Date(v).toLocaleDateString(I.date, {day: 'numeric', month: 'short', timeZone: 'UTC'}) }});
  }
  note(box, TX('gex_hist_note'));
}
function intervalMap(wrap, pts, d){
  keep(wrap, function(){
    var c = canvasIn(wrap); if (!c) return;
    var g = c.g, W = c.W, H = c.H, K = C(), L = 8, R = 62, TOP = 10, B = 20;
    var t0 = Date.parse(pts[0].t), t1 = Date.parse(pts[pts.length - 1].t); if (t1 === t0) { t0 -= 9e5; t1 += 9e5 }
    var lo = Infinity, hi = -Infinity, mx = 0;
    pts.forEach(function(p){ p.k.forEach(function(k, i){ lo = Math.min(lo, k); hi = Math.max(hi, k); mx = Math.max(mx, Math.abs(p.g[i] || 0)) }); lo = Math.min(lo, p.px); hi = Math.max(hi, p.px) });
    var pad = (hi - lo) * 0.04 || 1; lo -= pad; hi += pad; mx = mx || 1;
    var X = function(t){ return L + 14 + (t - t0) / (t1 - t0) * (W - L - R - 28) }, Y = function(v){ return TOP + (hi - v) / (hi - lo) * (H - TOP - B) };
    ticks(lo, hi, 6).forEach(function(v){ var y = Y(v); g.strokeStyle = alpha(K.text, 0.05); g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.fillStyle = K.faint; g.fillText(px(v, d.px), W - R + 6, y) });
    var step = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor((W - L - R) / 70))));
    g.textAlign = 'center';
    pts.forEach(function(p, i){ if (i % step) return; g.fillStyle = K.faint; g.fillText(new Date(p.t).toLocaleTimeString(I.date, {hour: '2-digit', minute: '2-digit', timeZone: T.MSK}), X(Date.parse(p.t)), H - B / 2) });
    g.textAlign = 'left';
    var rmax = Math.max(3, Math.min(16, (W - L - R) / pts.length / 2.2));
    pts.forEach(function(p){
      var x = X(Date.parse(p.t));
      p.k.forEach(function(k, i){ var v = p.g[i] || 0; if (!v) return; var r = Math.max(1.2, Math.sqrt(Math.abs(v) / mx) * rmax); g.beginPath(); g.arc(x, Y(k), r, 0, 6.283); g.fillStyle = v > 0 ? alpha(K.up, 0.55) : alpha(K.down, 0.55); g.fill() });
    });
    var path = function(key, col, dash, w){ g.beginPath(); var on = false; pts.forEach(function(p){ var v = p[key]; if (v == null) { on = false; return } var x = X(Date.parse(p.t)), y = Y(v); if (!on) { g.moveTo(x, y); on = true } else g.lineTo(x, y) }); g.strokeStyle = col; g.lineWidth = w || 1.5; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]); g.lineWidth = 1 };
    path('zero', K.acc, [5, 4], 1.2); path('px', K.text, null, 1.8);
    g.fillStyle = K.text; g.fillText(TX('gex_spot'), L + 4, TOP + 4); g.fillStyle = K.acc; g.fillText(TX('gex_flip'), L + 4 + g.measureText(TX('gex_spot') + '   ').width, TOP + 4);
    c.cv.onmousemove = function(e){
      var r = c.cv.getBoundingClientRect(), mx_ = e.clientX - r.left, my_ = e.clientY - r.top, best = null, bd = Infinity;
      pts.forEach(function(p){ var x = X(Date.parse(p.t)); p.k.forEach(function(k, i){ var dd = Math.hypot(x - mx_, Y(k) - my_); if (dd < bd) { bd = dd; best = [p, k, p.g[i]] } }) });
      if (!best || bd > 30) return untip();
      tip([[new Date(best[0].t).toLocaleString(I.date, {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: T.MSK}) + ' ' + I.tz], [TX('gex_strike') + ' ' + px(best[1], d.px)],
        [TX('gex_net') + ': ' + usd(best[2]), cls(best[2])], [TX('gex_spot') + ': ' + px(best[0].px)], [TX('gex_flip') + ': ' + px(best[0].zero, d.px)]], e);
    };
    c.cv.onmouseleave = untip;
  });
}

/* ======================= levels for other functions (TECH, the bot brief) ======================= */
var CHART = {'S&P': 'SPX', 'SPX': 'SPX', 'SP500': 'SPX', 'BTCUSDT': 'BTC', 'BINANCE:BTCUSDT': 'BTC', 'ETHUSDT': 'ETH', 'BINANCE:ETHUSDT': 'ETH'};
var NOT_SAME = {'NDX': 1, 'NASDAQ': 1, 'RTY': 1, 'RUSSELL': 1};
function chartUnderlying(chartSymbol){
  var u = F.upSym(chartSymbol);
  if (NOT_SAME[u]) return null;
  var s = CHART[u] || u;
  return ALL.indexOf(s) >= 0 && s !== 'NDX' ? s : null;
}
var lvCache = {};
function levelsFor(chartSymbol){
  var s = chartUnderlying(chartSymbol);
  if (!s) return Promise.resolve(null);
  var c = lvCache[s]; if (c && Date.now() - c.at < 300e3) return Promise.resolve(c.v);
  return load(s).then(function(d){
    var lv = d.levels || {}, em = d.em || {}, out = {sym: s, px: d.px, zero: lv.zero, cwall: lv.cwall, pwall: lv.pwall, pos: lv.pos, neg: lv.neg, d1: em.d1, updated: d.updated};
    lvCache[s] = {at: Date.now(), v: out}; return out;
  }).catch(function(){ lvCache[s] = {at: Date.now(), v: null}; return null });
}
window.OPTX = {levels: levelsFor, norm: norm, ALL: ALL, open: open};

/* ======================= commands ======================= */
var Cm = T.CMDS;
Cm.GEX = function(a){ open('GEX', a) }; Cm.GAMMA = Cm.GEX; Cm['ГАММА'] = Cm.GEX;
Cm.LVL = function(a){ open('LVL', a) }; Cm.LEVELS = Cm.LVL; Cm.EXPM = Cm.LVL; Cm['УРОВНИ'] = Cm.LVL;
Cm.VOLS = function(a){ open('VOLS', a) }; Cm.SKEW = Cm.VOLS; Cm.SMILE = Cm.VOLS; Cm['ВОЛАТИЛЬНОСТЬ'] = Cm.VOLS;
Cm.GRK = function(a){ open('GRK', a) }; Cm.GREEKS = Cm.GRK; Cm['ГРЕКИ'] = Cm.GRK;
Cm.GEXH = function(a){ open('GEXH', a) }; Cm.IMAPG = Cm.GEXH;
['GEX', 'LVL', 'VOLS', 'GRK', 'GEXH'].forEach(function(k){ T.SUFFIX[k] = 1 });
})();
