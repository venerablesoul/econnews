/* Terminal: panel layouts and functions.
   DES/FA/ERN/ANR/CN/HDS — companies, HP/COMP — history and comparison, EQS — screener, IMAP — market map,
   GC/CB/WIRP — bonds and rates, W/PORT/ALRT — personal, the live news feed.
   Data: the bot server (/api/…, keys only there) and the bot's files on the site (stocks.json, rates.json).
   Texts: i18n.js (TX), English by default. */
(function(){
'use strict';
var T = window.TERM;
if (!T) return;
var $ = T.$, el = T.el, fmt = T.fmt, pct = T.pct, cls = T.cls, store = T.store, I = T.I, TX = T.TX;

/* ======================= utilities ======================= */
function clear(n){ while (n && n.firstChild) n.removeChild(n.firstChild); return n }
function txt(n, t){ n.textContent = t; return n }
function money(v, cur){
  cur = cur == null ? '$' : cur;
  if (v == null || isNaN(v)) return '—';
  var a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e12) return s + cur + fmt(a / 1e12, 2) + (I.ru ? ' трлн' : 'T');
  if (a >= 1e9) return s + cur + fmt(a / 1e9, a >= 1e11 ? 0 : 1) + (I.ru ? ' млрд' : 'B');
  if (a >= 1e6) return s + cur + fmt(a / 1e6, a >= 1e8 ? 0 : 1) + (I.ru ? ' млн' : 'M');
  return s + cur + fmt(a, a >= 1e4 ? 0 : 2);
}
function dg(p){ var a = Math.abs(p || 0); return a >= 1000 ? 0 : a >= 10 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 4 : 6 }
function price(v){ return v == null ? '—' : fmt(v, dg(v)) }
var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function dmy(d){ return d && d.length >= 10 ? (I.ru ? d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4) : +d.slice(8, 10) + ' ' + MON[+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4)) : '—' }
function dmShort(d){ return d && d.length >= 10 ? (I.ru ? d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(2, 4) : MON[+d.slice(5, 7) - 1] + " '" + d.slice(2, 4)) : '—' }
function num(v, d){ return v == null || isNaN(v) ? '—' : fmt(v, d == null ? 2 : d) }
function upSym(s){ return String(s || '').trim().toUpperCase().replace(/\s+(US\s+)?EQUITY$/, '').replace(/\s+US$/, '') }
var ETF = {SPY: 1, QQQ: 1, DIA: 1, IWM: 1, VOO: 1, VTI: 1, GLD: 1, TLT: 1};
function isStock(s){
  s = upSym(s);
  if (/^MOEX:/.test(s)) return true;
  if (ETF[s] || (T.ALIAS[s] && T.ALIAS[s] !== s) || T.COINS.some(function(c){ return c[0] === s })) return false;
  return /^[A-Z][A-Z0-9]{0,6}([.\-][A-Z])?$/.test(s);
}
function noApi(box, what){
  clear(box).appendChild(el('div', 'empty', TX('no_api', what)));
}
function errBox(box, e){ clear(box).appendChild(el('div', 'err', TX('load_fail') + (e && e.message || e))) }
function loading(box, t){ clear(box).appendChild(el('div', 'loading', t || TX('loading'))) }

var apiCache = {};
function api(path, opts){
  opts = opts || {};
  var base = T.api();
  if (!base) return Promise.reject(new Error(TX('srv_not_set_e')));
  var key = path, c = apiCache[key];
  if (!opts.method && opts.ttl && c && Date.now() - c.at < opts.ttl * 1000) return Promise.resolve(c.v);
  var h = T.authHeaders();
  var init = {headers: h, cache: 'no-store'};
  if (opts.method) { init.method = opts.method; h['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body || {}) }
  return fetch(base + path, init).then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() }).then(function(d){
    if (d && d.ok === false && d.error && !opts.allowError) throw new Error(d.error);
    if (!opts.method && opts.ttl) apiCache[key] = {at: Date.now(), v: d};
    return d;
  });
}
var pageCache = {};
function page(name, ttl){
  var c = pageCache[name];
  if (c && Date.now() - c.at < (ttl || 120) * 1000) return Promise.resolve(c.v);
  return fetch('../' + name + '?t=' + Math.floor(Date.now() / 60000), {cache: 'no-store'}).then(function(r){
    if (!r.ok) throw new Error(name + ': HTTP ' + r.status); return r.json();
  }).then(function(d){ pageCache[name] = {at: Date.now(), v: d}; return d });
}
function table(cols, opts){
  opts = opts || {};
  var t = el('table', 'tbl'), thead = el('thead'), tr = el('tr');
  cols.forEach(function(c, i){
    var th = el('th', c.sort ? 'sort' : null, c.t);
    if (c.title) th.title = c.title;
    if (c.l) th.style.textAlign = 'left';
    if (opts.sortKey && c.k === opts.sortKey) { th.classList.add('on'); th.textContent += opts.sortDir > 0 ? ' ▲' : ' ▼' }
    if (c.sort && opts.onSort) th.onclick = function(){ opts.onSort(c.k) };
    tr.appendChild(th);
  });
  thead.appendChild(tr); t.appendChild(thead);
  var tb = el('tbody'); t.appendChild(tb);
  return {t: t, body: tb};
}
function td(text, cl){ return el('td', cl || null, text) }
// column headers from a list of names; `left` lists the indexes aligned left
function cols(names, left){ return names.map(function(t, i){ return {t: t, l: (left || []).indexOf(i) >= 0} }) }
// curve and central bank names: "name" is English, "name_ru" Russian (older data had only a Russian "name")
function locName(x){ return I.ru ? x.name_ru || x.name : x.name }
function chg(c, d){ return el('td', 'num ' + cls(c), pct(c, d)) }
function downloadText(name, text, mime){
  try {
    var blob = new Blob(['﻿' + text], {type: mime || 'text/csv;charset=utf-8'});
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove() }, 1000);
    return true;
  } catch(e){ return false }
}
function copyText(text){
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  return Promise.reject(new Error(TX('no_clip')));
}
function tabs(box, attr, onPick){
  box.addEventListener('click', function(e){
    var b = e.target.closest('button[data-' + attr + ']'); if (!b) return;
    box.querySelectorAll('button[data-' + attr + ']').forEach(function(x){ x.classList.toggle('on', x === b) });
    onPick(b.getAttribute('data-' + attr));
  });
}
function setTab(box, attr, val){ box.querySelectorAll('button[data-' + attr + ']').forEach(function(x){ x.classList.toggle('on', x.getAttribute('data-' + attr) === val) }) }
function visible(pid){
  var p = $(pid); if (!p) return false;
  if (T.isMobile()) return p.classList.contains('show');
  return !p.classList.contains('off');
}
var COLORS = ['#ffa028', '#4fa3ff', '#21c66f', '#ff4b4b', '#c77dff', '#ffd400', '#56d6d6'];

/* ======================= layouts ======================= */
var PANELS = [
  {id:'p-mkt', code:'WEI', name:TX('fn_mkt')}, {id:'p-chart', code:'GP', name:TX('fn_chart')},
  {id:'p-crypto', code:'CRYPTO', name:TX('fn_crypto')}, {id:'p-news', code:'N', name:TX('fn_news')},
  {id:'p-eco', code:'ECO', name:TX('fn_eco')}, {id:'p-trd', code:'TRD', name:TX('fn_trd')},
  {id:'p-des', code:'DES', name:TX('fn_des')}, {id:'p-hp', code:'HP', name:TX('fn_hp')},
  {id:'p-eqs', code:'EQS', name:TX('fn_eqs')}, {id:'p-imap', code:'IMAP', name:TX('fn_imap')},
  {id:'p-gc', code:'GC', name:TX('fn_gc')}, {id:'p-my', code:'W', name:TX('fn_my')}
];
var LAYOUTS = {
  '1': {cols:'minmax(330px,26%) 1fr minmax(320px,25%)', rows:'62% 38%', areas:'"a b c" "a d e"', slots:['a','b','c','d','e'],
        def:['p-mkt','p-chart','p-crypto','p-news','p-eco'],
        pref:{'p-des':'c','p-gc':'c','p-my':'c','p-crypto':'c','p-hp':'b','p-eqs':'b','p-imap':'b','p-chart':'b','p-news':'d','p-eco':'e','p-trd':'e','p-mkt':'a'}},
  '4': {cols:'1fr 1fr', rows:'1fr 1fr', areas:'"a b" "c d"', slots:['a','b','c','d'], def:['p-chart','p-des','p-news','p-mkt'],
        pref:{'p-chart':'a','p-hp':'a','p-imap':'a','p-eqs':'c','p-des':'b','p-gc':'b','p-my':'d','p-mkt':'d','p-news':'c','p-eco':'d','p-trd':'d','p-crypto':'d'}},
  '6': {cols:'1fr 1fr 1fr', rows:'1fr 1fr', areas:'"a b c" "d e f"', slots:['a','b','c','d','e','f'],
        def:['p-mkt','p-chart','p-des','p-news','p-eqs','p-my'],
        pref:{'p-mkt':'a','p-chart':'b','p-hp':'b','p-des':'c','p-news':'d','p-eqs':'e','p-imap':'e','p-my':'f','p-gc':'f','p-eco':'f','p-trd':'f','p-crypto':'a'}},
  't': {cols:'minmax(300px,40%) 1fr', rows:'55% 45%', areas:'"a b" "c d"', slots:['a','b','c','d'], def:['p-mkt','p-chart','p-crypto','p-news'],
        pref:{'p-mkt':'a','p-chart':'b','p-hp':'b','p-imap':'b','p-eqs':'b','p-des':'c','p-gc':'c','p-my':'c','p-crypto':'c','p-news':'d','p-eco':'d','p-trd':'d'}}
};
var RENDER = {};   // pid → function to call when the panel appears on screen
var Layout = (function(){
  var st = {mode: '1', assign: {}};
  try { var saved = JSON.parse(store('layout2') || 'null'); if (saved && saved.assign) st = saved } catch(e){}
  if (!LAYOUTS[st.mode] || st.mode === 't') st.mode = '1';
  var activeSlot = null;
  function mode(){ return window.matchMedia('(max-width:1100px)').matches ? 't' : st.mode }
  function assign(m){
    var L = LAYOUTS[m], a = st.assign[m];
    if (!a || a.length !== L.slots.length || a.some(function(p){ return !$(p) })) a = st.assign[m] = L.def.slice();
    return a;
  }
  function save(){ store('layout2', JSON.stringify(st)) }
  function apply(){
    if (T.isMobile()) {
      // on a phone — one panel: keep the focused one, otherwise markets
      var shown = [].slice.call(document.querySelectorAll('.panel.show'));
      var keep = shown.length === 1 ? shown[0] : (document.querySelector('.panel.focus') || $('p-mkt'));
      document.querySelectorAll('.panel').forEach(function(p){ p.classList.remove('off'); p.style.gridArea = ''; p.classList.toggle('show', p === keep) });
      document.querySelectorAll('#tabs button[data-p]').forEach(function(b){ b.classList.toggle('on', b.dataset.p === keep.id) });
      return;
    }
    var m = mode(), L = LAYOUTS[m], a = assign(m), main = $('main');
    main.style.gridTemplateColumns = L.cols; main.style.gridTemplateRows = L.rows; main.style.gridTemplateAreas = L.areas;
    PANELS.forEach(function(p){
      var node = $(p.id), i = a.indexOf(p.id);
      if (!node) return;
      if (i >= 0) { node.style.gridArea = L.slots[i]; node.classList.remove('off'); node.classList.add('show'); node.dataset.slot = L.slots[i] }
      else { node.classList.add('off'); node.style.gridArea = ''; delete node.dataset.slot }
    });
    document.querySelectorAll('#lay button').forEach(function(b){ b.classList.toggle('on', b.dataset.l === st.mode) });
    a.forEach(function(pid){ if (RENDER[pid]) try { RENDER[pid]() } catch(e){ console.error(e) } });
    clearTimeout(apply._t); apply._t = setTimeout(function(){ window.dispatchEvent(new Event('resize')) }, 60);
  }
  function focus(pid){
    var p = $(pid); if (!p) return;
    p.classList.add('focus'); setTimeout(function(){ p.classList.remove('focus') }, 1200);
    if (p.dataset.slot) activeSlot = p.dataset.slot;
  }
  function place(pid, slot){
    if (T.isMobile()) return;
    var m = mode(), L = LAYOUTS[m], a = assign(m);
    if (a.indexOf(pid) >= 0 && !slot) { focus(pid); if (RENDER[pid]) RENDER[pid](); return }
    var target = slot || L.pref[pid] || activeSlot || L.slots[1];
    var ti = L.slots.indexOf(target); if (ti < 0) ti = 1;
    var cur = a.indexOf(pid);
    if (cur >= 0) a[cur] = a[ti];   // the panel is already on screen — swap places
    a[ti] = pid;
    save(); apply(); focus(pid);
    if (pid === 'p-chart' && !$('ownc')) T.openChart(T.curChart(), null, true);
  }
  function setMode(m){ if (!LAYOUTS[m] || m === 't') return; st.mode = m; save(); apply() }
  function slotOf(pid){ var p = $(pid); return p && p.dataset.slot }
  return {apply: apply, place: place, setMode: setMode, focus: focus, slotOf: slotOf, mode: function(){ return st.mode },
    setActive: function(s){ activeSlot = s }};
})();
window.Layout = Layout;

// the ▾ button in every panel title: put any function here
function openMenu(anchor, items, onPick, head){
  closeMenu();
  var m = el('div', 'menu'); m.id = 'fnmenu';
  if (head) m.appendChild(el('div', 'mh', head));
  items.forEach(function(it){
    var b = el('button'); b.appendChild(el('b', null, it.code)); b.appendChild(el('span', null, it.name));
    b.onclick = function(e){ e.stopPropagation(); closeMenu(); onPick(it) }; m.appendChild(b);
  });
  document.body.appendChild(m);
  var r = anchor.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(r.left, window.innerWidth - m.offsetWidth - 4)) + 'px';
  m.style.top = Math.min(r.bottom + 2, window.innerHeight - m.offsetHeight - 4) + 'px';
  setTimeout(function(){ document.addEventListener('click', closeMenu, {once: true}) }, 0);
}
function closeMenu(){ var m = $('fnmenu'); if (m) m.remove() }
document.querySelectorAll('.panel').forEach(function(p){
  var ph = p.querySelector('.ph'); if (!ph) return;
  var b = el('button', 'pick', '▾'); b.title = TX('pick_t');
  var code = ph.querySelector('.code');
  if (code && code.nextSibling) ph.insertBefore(b, code.nextSibling); else ph.appendChild(b);
  b.onclick = function(e){
    e.stopPropagation();
    openMenu(b, PANELS.filter(function(x){ return x.id !== p.id }), function(it){ Layout.place(it.id, p.dataset.slot) }, TX('pick_head'));
  };
  p.addEventListener('mousedown', function(){ if (p.dataset.slot) Layout.setActive(p.dataset.slot) });
});
var phStyle = document.createElement('style');
phStyle.textContent = '@media (max-width:760px){ .ph .pick{display:none} }';
document.head.appendChild(phStyle);
document.querySelectorAll('#lay button').forEach(function(b){ b.onclick = function(){ Layout.setMode(b.dataset.l) } });
// the "⇄" buttons in the calendar and trades switch the function in the same panel
document.querySelectorAll('.ph .swap').forEach(function(b){
  b.onclick = function(e){ e.stopPropagation(); var p = b.closest('.panel'); if (!T.isMobile() && p.dataset.slot) Layout.place(b.dataset.to, p.dataset.slot); else T.show(b.dataset.to) };
});
var rzT = null;
window.addEventListener('resize', function(){ clearTimeout(rzT); rzT = setTimeout(function(){
  var was = Layout._mob; Layout._mob = T.isMobile();
  if (was !== Layout._mob || !Layout._mob) { Layout.apply() }
  redrawCanvases();
  if (visible('p-imap')) renderImap();
}, 150) });

// the mobile menu of all functions
(function(){
  var list = $('fnlist');
  var FN = [
    ['WEI', TX('fn_mkt'), 'p-mkt'], ['GP', TX('fn_chart'), 'p-chart'], ['CRYPTO', TX('fn_crypto'), 'p-crypto'], ['N', TX('fn_news'), 'p-news'],
    ['ECO', TX('fn_eco'), 'p-eco'], ['TRD', TX('m_trd'), 'p-trd'], ['DES', TX('m_des'), 'p-des'], ['HP', TX('m_hp'), 'p-hp'],
    ['COMP', TX('m_comp'), 'p-hp', 'COMP'], ['EQS', TX('m_eqs'), 'p-eqs'], ['IMAP', TX('m_imap'), 'p-imap'], ['GC', TX('m_gc'), 'p-gc'],
    ['CB', TX('m_cb'), 'p-gc', 'CB'], ['WIRP', TX('m_wirp'), 'p-gc', 'WIRP'], ['W', TX('m_w'), 'p-my', 'W'],
    ['PORT', TX('m_port'), 'p-my', 'PORT'], ['ALRT', TX('m_alrt'), 'p-my', 'ALRT'], ['HELP', TX('m_help'), null, 'HELP']
  ];
  FN.forEach(function(f){
    var b = el('button'); b.appendChild(el('b', null, f[0])); b.appendChild(el('span', null, f[1]));
    b.onclick = function(){ $('ov-fn').classList.remove('on'); if (f[3]) T.runCommand(f[3]); else T.show(f[2]) };
    list.appendChild(b);
  });
  $('b-more').onclick = function(){ T.openOverlay('ov-fn') };
})();

/* ======================= DES: company ======================= */
var des = {sym: '', tab: 'DES', data: null, faMode: 'q', loadingSym: ''};
function openDes(sym, tab){
  sym = upSym(sym || des.sym);
  if (tab) des.tab = tab;
  setTab($('des-tabs'), 't', des.tab);
  T.show('p-des');
  if (!sym) return renderDes();
  if (sym !== des.sym || !des.data) { des.sym = sym; des.data = null; loadDes() } else renderDes();
}
function loadDes(){
  var box = $('des-body'), sym = des.sym;
  $('des-title').textContent = TX('company_x', sym);
  if (!T.api()) return noApi(box, TX('co_card'));
  loading(box, TX('loading_x', sym));
  des.loadingSym = sym;
  api('/api/company?s=' + encodeURIComponent(sym) + (I.ru ? '&lang=ru' : ''), {ttl: 120}).then(function(d){
    if (des.sym !== sym) return;
    des.data = d; des.sym = (d.s || sym); renderDes();
  }).catch(function(e){ if (des.sym === sym) errBox(box, e) });
}
tabs($('des-tabs'), 't', function(t){ des.tab = t; renderDes() });
function renderDes(){
  var box = $('des-body');
  var d = des.data;
  if (!d) { if (!des.sym) return; return }
  var p = d.profile || {}, q = d.quote || {};
  $('des-title').textContent = (p.name || d.s) + ' · ' + d.s;
  $('des-sub').textContent = q.px != null ? (d.kind === 'moex' ? '' : '$') + price(q.px) + (d.kind === 'moex' ? ' ₽' : '') + ' ' + pct(q.ch) : '';
  clear(box);
  if (d.kind === 'moex' && des.tab !== 'DES') { box.appendChild(el('div', 'empty', TX('moex_only_des'))); return }
  ({DES: desMain, FA: desFa, ERN: desErn, ANR: desAnr, CN: desCn, HDS: desHds}[des.tab] || desMain)(box, d);
}
function kv(box, pairs){
  var g = el('div', 'kv');
  pairs.forEach(function(x){ if (!x) return; var c = el('div'); c.appendChild(el('span', null, x[0])); var b = el('b', x[2] || null, x[1]); c.appendChild(b); if (x[3]) c.title = x[3]; g.appendChild(c) });
  box.appendChild(g);
}
function consensus(anr){
  var r = anr && anr[0]; if (!r) return null;
  var n = r.sb + r.b + r.h + r.s + r.ss; if (!n) return null;
  var sc = (r.sb * 5 + r.b * 4 + r.h * 3 + r.s * 2 + r.ss) / n;
  return {n: n, score: sc, word: TX('rec')[sc >= 4.2 ? 0 : sc >= 3.6 ? 1 : sc >= 2.8 ? 2 : sc >= 2.2 ? 3 : 4], r: r};
}
var ANR_COL = ['#0f7a3e', '#21c66f', '#8c8c8c', '#e07a3c', '#ff4b4b'];
function anrBar(r, n){
  var bar = el('div', 'anr-bar');
  [r.sb, r.b, r.h, r.s, r.ss].forEach(function(v, i){ if (!v) return; var x = el('i'); x.style.width = (v / n * 100) + '%'; x.style.background = ANR_COL[i]; x.title = v; bar.appendChild(x) });
  return bar;
}
function desMain(box, d){
  var p = d.profile || {}, q = d.quote || {}, m = d.m || {};
  var head = el('div', 'co-head');
  head.appendChild(el('span', 'tk', d.s)); head.appendChild(el('span', 'nm', p.name || ''));
  if (q.px != null) { head.appendChild(el('span', 'px', (d.kind === 'moex' ? '' : '$') + price(q.px) + (d.kind === 'moex' ? ' ₽' : ''))); head.appendChild(el('span', cls(q.ch), pct(q.ch) + TX('today_ch'))) }
  var meta = el('div', 'meta', [p.ind, p.exch && String(p.exch).replace(/ - .*$/, ''), p.country, p.ipo ? 'IPO ' + dmy(p.ipo) : '', p.isin ? 'ISIN ' + p.isin : '', p.type].filter(Boolean).join(' · '));
  if (p.web) { var a = el('a', null, ' ' + p.web.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')); a.href = p.web; a.target = '_blank'; a.rel = 'noopener'; meta.appendChild(document.createTextNode(' · ')); meta.appendChild(a) }
  head.appendChild(meta); box.appendChild(head);
  if (d.kind === 'moex') {
    kv(box, [[TX('k_lot'), p.lot ? p.lot + TX('k_pcs') : '—'], [TX('k_issue'), p.issue ? fmt(p.issue, 0) + TX('k_pcs') : '—'], [TX('k_mcap'), p.issue && q.px ? money(p.issue * q.px, '₽') : '—'],
      [TX('k_list'), p.list ? TX('k_level', p.list) : '—'], [TX('k_dayhi'), price(q.h)], [TX('k_daylo'), price(q.l)]]);
  } else {
    kv(box, [
      [TX('k_mcap'), money((m.mcap || p.mcap) * 1e6), null, TX('k_mcap_t')], ['P/E', num(m.pe, 1), null, TX('k_pe_t')], [TX('k_fpe'), num(m.fpe, 1)],
      ['P/S', num(m.ps, 1), null, TX('k_ps_t')], ['P/B', num(m.pb, 1), null, TX('k_pb_t')], ['EV/EBITDA', num(m.evebitda, 1)],
      [TX('k_div'), m.dy ? num(m.dy, 2) + '%' : TX('k_none')], [TX('k_beta'), num(m.beta, 2), null, TX('k_beta_t')], [TX('k_eps'), m.eps != null ? '$' + num(m.eps, 2) : '—'],
      [TX('k_revg'), pct(m.revg, 1), cls(m.revg)], [TX('k_epsg'), pct(m.epsg, 1), cls(m.epsg)], ['ROE', m.roe != null ? num(m.roe, 1) + '%' : '—'],
      [TX('k_gm'), m.gm != null ? num(m.gm, 1) + '%' : '—'], [TX('k_om'), m.om != null ? num(m.om, 1) + '%' : '—'], [TX('k_nm'), m.nm != null ? num(m.nm, 1) + '%' : '—'],
      [TX('k_de'), num(m.de, 2)], [TX('k_cr'), num(m.cr, 2)], [TX('k_shares'), p.shares ? fmt(p.shares, 0) + TX('k_mln') : '—'],
      [TX('k_5d'), pct(m.r5d), cls(m.r5d)], [TX('k_3m'), pct(m.r13w), cls(m.r13w)], [TX('k_ytd'), pct(m.rytd), cls(m.rytd)], [TX('k_1y'), pct(m.r52), cls(m.r52)]
    ]);
    if (m.h52 && m.l52 && q.px) {
      var r = el('div', 'r52'), pos = Math.max(0, Math.min(1, (q.px - m.l52) / ((m.h52 - m.l52) || 1)));
      r.appendChild(el('div', null, TX('r52_title')));
      var bar = el('div', 'bar'), mark = el('i'); mark.style.left = 'calc(' + (pos * 100) + '% - 1px)'; bar.appendChild(mark); r.appendChild(bar);
      var ends = el('div', 'ends'); ends.appendChild(el('span', null, '$' + price(m.l52) + (m.l52d ? ' · ' + dmShort(m.l52d) : ''))); ends.appendChild(el('span', null, '$' + price(m.h52) + (m.h52d ? ' · ' + dmShort(m.h52d) : ''))); r.appendChild(ends);
      box.appendChild(r);
    }
    var c = consensus(d.anr);
    var blk = el('div', 'blk');
    if (c) {
      blk.appendChild(el('h4', null, TX('anr_line', c.word, fmt(c.score, 1), c.n)));
      blk.appendChild(anrBar(c.r, c.n));
    }
    if (d.next) blk.appendChild(el('div', null, TX('next_rep') + dmy(d.next.date) + (d.next.hour === 'bmo' ? TX('bmo') : d.next.hour === 'amc' ? TX('amc') : '') +
      (d.next.eps_e != null ? TX('eps_fcst') + num(d.next.eps_e, 2) : '') + (d.next.rev_e ? TX('rev_fcst') + money(d.next.rev_e) : '')));
    if (blk.childNodes.length) box.appendChild(blk);
  }
  var act = el('div', 'actions');
  [[TX('a_chart'), function(){ T.openChart(d.s, d.s) }], ['HP', function(){ openHP(d.s) }], [TX('a_watch'), function(){ My.addWatch([d.s]); My.open('W') }],
   [TX('a_alert'), function(){ My.open('ALRT', d.s + ' > ' + (q.px ? String(+(q.px * 1.05).toPrecision(4)) : '')) }],
   [TX('a_port'), function(){ My.open('PORT', d.s) }]].forEach(function(x){ var b = el('button', null, x[0]); b.onclick = x[1]; act.appendChild(b) });
  box.appendChild(act);
  if (d.peers && d.peers.length) {
    var pb = el('div', 'chips'); pb.appendChild(el('span', 'note', TX('peers')));
    d.peers.forEach(function(s){ var b = el('button', 'chipbtn', s); b.onclick = function(){ openDes(s) }; pb.appendChild(b) });
    box.appendChild(pb);
  }
  if (d.errors && d.errors.length) box.appendChild(el('div', 'note', TX('part_fail') + d.errors.join('; ')));
}
function svgBars(rows, keys, colors, h){
  // rows: [{label, values:[...]}] — grouped bars
  var NS = 'http://www.w3.org/2000/svg', W = 600, H = h || 130, pad = 24;
  var s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 ' + W + ' ' + H); s.setAttribute('class', 'gc-svg'); s.style.height = H + 'px';
  var vals = []; rows.forEach(function(r){ r.values.forEach(function(v){ if (v != null) vals.push(v) }) });
  if (!vals.length) return s;
  var hi = Math.max(0, Math.max.apply(null, vals)), lo = Math.min(0, Math.min.apply(null, vals)), sp = (hi - lo) || 1;
  var Y = function(v){ return 6 + (hi - v) / sp * (H - pad - 6) };
  var bw = (W - 10) / rows.length, gw = bw * 0.8 / keys.length;
  var zero = document.createElementNS(NS, 'line'); zero.setAttribute('x1', 0); zero.setAttribute('x2', W); zero.setAttribute('y1', Y(0)); zero.setAttribute('y2', Y(0)); zero.setAttribute('stroke', '#333'); s.appendChild(zero);
  rows.forEach(function(r, i){
    r.values.forEach(function(v, k){
      if (v == null) return;
      var rect = document.createElementNS(NS, 'rect');
      var x = 5 + i * bw + bw * 0.1 + k * gw, y = Math.min(Y(v), Y(0)), hh = Math.max(1, Math.abs(Y(v) - Y(0)));
      rect.setAttribute('x', x); rect.setAttribute('y', y); rect.setAttribute('width', Math.max(1, gw - 2)); rect.setAttribute('height', hh);
      rect.setAttribute('fill', typeof colors[k] === 'function' ? colors[k](v, r) : colors[k]);
      var t = document.createElementNS(NS, 'title'); t.textContent = r.label + ': ' + r.fmt(v, k); rect.appendChild(t);
      s.appendChild(rect);
    });
    var lb = document.createElementNS(NS, 'text'); lb.setAttribute('x', 5 + i * bw + bw / 2); lb.setAttribute('y', H - 7); lb.setAttribute('text-anchor', 'middle');
    lb.setAttribute('fill', '#8c8c8c'); lb.setAttribute('font-size', '11'); lb.textContent = r.label; s.appendChild(lb);
  });
  return s;
}
function desFa(box, d){
  var fin = d.fin && d.fin.quarterly && d.fin.quarterly.length ? d.fin : null;
  var t = el('div', 'ptabs'), bq = el('button', des.faMode === 'q' ? 'on' : null, TX('quarters')), ba = el('button', des.faMode === 'a' ? 'on' : null, TX('years'));
  bq.onclick = function(){ des.faMode = 'q'; renderDes() }; ba.onclick = function(){ des.faMode = 'a'; renderDes() };
  t.appendChild(bq); t.appendChild(ba); t.appendChild(el('span', 'sp'));
  box.appendChild(t);
  if (fin) {
    var rows = (des.faMode === 'q' ? fin.quarterly : fin.annual) || [];
    box.appendChild(el('div', 'note', TX('fa_sec_note')));
    var chart = svgBars(rows.slice(0, 8).reverse().map(function(r){ return {label: des.faMode === 'q' ? dmShort(r.end) : r.end.slice(0, 4), values: [r.rev, r.ni], fmt: function(v, k){ return TX(k ? 'profit' : 'revenue_') + money(v) }} }),
      ['rev', 'ni'], ['#4fa3ff', function(v){ return v >= 0 ? '#21c66f' : '#ff4b4b' }], 140);
    var cw = el('div', 'blk'); var lg = el('div', 'legend'); [['#4fa3ff', TX('revenue')], ['#21c66f', TX('net_income')]].forEach(function(x){ var s = el('span'); var i = el('i'); i.style.background = x[0]; s.appendChild(i); s.appendChild(document.createTextNode(x[1])); lg.appendChild(s) });
    cw.appendChild(lg); cw.appendChild(chart); box.appendChild(cw);
    var tb = table(cols(TX('fa_cols')));
    rows.forEach(function(r){
      var tr = el('tr'); tr.appendChild(td(des.faMode === 'q' ? dmy(r.end) : r.end.slice(0, 4) + ' (' + dmShort(r.end) + ')', 'l'));
      [r.rev, r.gp, r.op, r.ni].forEach(function(v){ tr.appendChild(td(money(v), 'num' + (v < 0 ? ' down' : ''))) });
      tr.appendChild(td(r.eps != null ? '$' + num(r.eps, 2) : '—', 'num'));
      [r.ocf, r.fcf, r.cash, r.debt].forEach(function(v){ tr.appendChild(td(money(v), 'num' + (v < 0 ? ' down' : ''))) });
      tb.body.appendChild(tr);
    });
    box.appendChild(tb.t);
  } else {
    var fs = d.faSeries || {}, rows2 = (des.faMode === 'q' ? fs.quarterly : fs.annual) || [];
    box.appendChild(el('div', 'note', TX('fa_fh_note', d.s)));
    if (!rows2.length) { box.appendChild(el('div', 'empty', TX('fa_none'))); return }
    var tb2 = table(cols(TX('fa_fh_cols')));
    rows2.forEach(function(r){
      var tr = el('tr'); tr.appendChild(td(dmy(r.end), 'l'));
      tr.appendChild(td(r.eps != null ? '$' + num(r.eps, 2) : '—', 'num')); tr.appendChild(td(r.salesPerShare != null ? '$' + num(r.salesPerShare, 2) : '—', 'num'));
      [r.grossMargin, r.operatingMargin, r.netMargin, r.roe].forEach(function(v){ tr.appendChild(td(v != null ? num(v * 100, 1) + '%' : '—', 'num')) });
      tr.appendChild(td(num(r.totalDebtToEquity, 2), 'num')); tb2.body.appendChild(tr);
    });
    box.appendChild(tb2.t);
  }
}
function desErn(box, d){
  if (d.next) {
    var b = el('div', 'blk');
    b.appendChild(el('h4', null, TX('ern_next', dmy(d.next.date), d.next.hour === 'bmo' ? TX('bmo_l') : d.next.hour === 'amc' ? TX('amc_l') : '', d.next.q, d.next.y)));
    b.appendChild(el('div', null, TX('ern_fcst', num(d.next.eps_e, 2), money(d.next.rev_e))));
    box.appendChild(b);
  }
  var e = d.ern || [];
  if (!e.length) { box.appendChild(el('div', 'empty', TX('ern_none'))); return }
  var rows = e.slice(0, 8).reverse();
  var lg = el('div', 'legend'); [['#5a5a5a', TX('est')], ['#21c66f', TX('beat')], ['#ff4b4b', TX('miss')]].forEach(function(x){ var s = el('span'); var i = el('i'); i.style.background = x[0]; s.appendChild(i); s.appendChild(document.createTextNode(x[1])); lg.appendChild(s) });
  var cw = el('div', 'blk'); cw.appendChild(el('h4', null, TX('ern_chart'))); cw.appendChild(lg);
  cw.appendChild(svgBars(rows.map(function(r){ return {label: 'Q' + r.q + "'" + String(r.y).slice(2), values: [r.est, r.act], act: r.act, est: r.est, fmt: function(v, k){ return TX(k ? 'act_' : 'est_') + num(v, 2) }} }),
    ['est', 'act'], ['#5a5a5a', function(v, r){ return r.act >= r.est ? '#21c66f' : '#ff4b4b' }], 130));
  box.appendChild(cw);
  var tb = table(cols(TX('ern_cols')));
  e.forEach(function(r){
    var tr = el('tr'); tr.appendChild(td('Q' + r.q + ' ' + r.y, 'l')); tr.appendChild(td(dmy(r.period), 'num'));
    tr.appendChild(td(r.act != null ? '$' + num(r.act, 2) : '—', 'num')); tr.appendChild(td(r.est != null ? '$' + num(r.est, 2) : '—', 'num'));
    tr.appendChild(chg(r.sp, 1)); tb.body.appendChild(tr);
  });
  box.appendChild(tb.t);
}
function desAnr(box, d){
  var c = consensus(d.anr);
  if (!c) { box.appendChild(el('div', 'empty', TX('anr_none'))); return }
  var b = el('div', 'blk'); b.appendChild(el('h4', null, TX('consensus', c.word, fmt(c.score, 1))));
  var lg = el('div', 'legend'); TX('rec_l').forEach(function(x, i){ var s = el('span'); var ic = el('i'); ic.style.background = ANR_COL[i]; s.appendChild(ic); s.appendChild(document.createTextNode(x)); lg.appendChild(s) });
  b.appendChild(lg); box.appendChild(b);
  var tb = table(cols(TX('anr_cols'), [1]));
  d.anr.forEach(function(r){
    var n = r.sb + r.b + r.h + r.s + r.ss, tr = el('tr');
    tr.appendChild(td(r.period.slice(0, 7), 'l'));
    var cell = el('td', 'l'); cell.style.width = '45%'; if (n) cell.appendChild(anrBar(r, n)); tr.appendChild(cell);
    tr.appendChild(td(String(r.sb + r.b), 'num up')); tr.appendChild(td(String(r.h), 'num')); tr.appendChild(td(String(r.s + r.ss), 'num down')); tr.appendChild(td(String(n), 'num'));
    tb.body.appendChild(tr);
  });
  box.appendChild(tb.t);
}
// Russian readers: headlines are translated right in the browser (translators often block Cloudflare servers)
var trCache = {};
try { trCache = JSON.parse(sessionStorage.getItem('tr_cache') || '{}') || {} } catch(e){}
function translateHere(text){
  if (trCache[text]) return Promise.resolve(trCache[text]);
  return fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t&q=' + encodeURIComponent(text))
    .then(function(r){ if (!r.ok) throw new Error(r.status); return r.json() })
    .then(function(j){
      var t = (j[0] || []).map(function(x){ return x[0] || '' }).join('').trim();
      if (t) { trCache[text] = t; try { sessionStorage.setItem('tr_cache', JSON.stringify(trCache)) } catch(e){} }
      return t || text;
    });
}
function desCn(box, d){
  var items = d.cn || [];
  if (!items.length) { box.appendChild(el('div', 'empty', TX('cn_none'))); return }
  var raw = I.ru ? items.filter(function(n){ return n.en && n.h === n.en && !n._tr }) : [];
  if (raw.length) {
    var sym = d.s;
    Promise.all(raw.map(function(n){ return translateHere(n.en).then(function(t){ n.h = t; n._tr = 1 }, function(){ n._tr = 1 }) })).then(function(){
      if (des.data === d && des.tab === 'CN' && des.sym === sym) renderDes();
    });
  }
  var ul = el('ul', 'news');
  items.forEach(function(n){
    var li = el('li');
    li.appendChild(el('span', 't', new Date(n.t * 1000).toLocaleString(I.date, {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: T.MSK})));
    var a = el('a', null, n.h); if (/^https?:\/\//.test(n.url || '')) { a.href = n.url; a.target = '_blank'; a.rel = 'noopener' }
    li.appendChild(a);
    if (I.ru && n.en && n.en !== n.h) li.appendChild(el('div', 'lead', n.en));
    li.appendChild(el('div', 'meta', n.src || ''));
    ul.appendChild(li);
  });
  box.appendChild(ul);
}
function desHds(box, d){
  box.appendChild(el('div', 'note', TX('hds_note')));
  var rows = d.ins || [];
  if (!rows.length) { box.appendChild(el('div', 'empty', TX('hds_none'))); return }
  var tb = table(cols(TX('hds_cols'), [1]));
  rows.forEach(function(r){
    var tr = el('tr'); tr.appendChild(td(dmy(r.date), 'l')); tr.appendChild(td(r.name, 'l'));
    tr.appendChild(td(TX(r.code === 'P' ? 't_buy' : 't_sell'), 'num ' + (r.code === 'P' ? 'up' : 'down')));
    tr.appendChild(td(fmt(Math.abs(r.ch), 0), 'num')); tr.appendChild(td(r.px ? '$' + num(r.px, 2) : '—', 'num'));
    tr.appendChild(td(r.px ? money(Math.abs(r.ch) * r.px) : '—', 'num')); tr.appendChild(td(r.sh != null ? fmt(r.sh, 0) : '—', 'num'));
    tb.body.appendChild(tr);
  });
  box.appendChild(tb.t);
}
RENDER['p-des'] = function(){ if (des.data) renderDes() };

/* ======================= HP and COMP ======================= */
var hp = {tab: 'HP', sym: '', range: '1y', comp: [], data: null};
try { var savedComp = JSON.parse(store('comp_syms') || '[]'); if (Array.isArray(savedComp)) hp.comp = savedComp.slice(0, 6) } catch(e){}
function history(sym, range){ return api('/api/history?s=' + encodeURIComponent(sym) + '&r=' + range, {ttl: 600}) }
function openHP(sym, range){
  if (range) hp.range = range;
  if (sym) hp.sym = upSym(sym);
  hp.tab = 'HP'; setTab($('hp-tabs'), 't', 'HP'); setTab($('hp-tabs'), 'r', hp.range);
  T.show('p-hp'); renderHP();
}
function openComp(syms, range){
  if (range) hp.range = range;
  if (syms && syms.length) { hp.comp = syms.map(upSym).filter(Boolean).slice(0, 6); store('comp_syms', JSON.stringify(hp.comp)) }
  hp.tab = 'COMP'; setTab($('hp-tabs'), 't', 'COMP'); setTab($('hp-tabs'), 'r', hp.range);
  T.show('p-hp'); renderHP();
}
tabs($('hp-tabs'), 't', function(t){ hp.tab = t; renderHP() });
tabs($('hp-tabs'), 'r', function(r){ hp.range = r; renderHP() });
var RANGES = TX('ranges');
function renderHP(){
  var box = $('hp-body');
  $('hp-code').textContent = hp.tab;
  if (!T.api()) return noApi(box, TX('m_hp'));
  if (hp.tab === 'COMP') return renderComp(box);
  if (!hp.sym) { clear(box).appendChild(el('div', 'empty', TX('hp_ask'))); $('hp-title').textContent = TX('hp_x'); return }
  $('hp-title').textContent = TX('hp_x', hp.sym);
  var sym = hp.sym, range = hp.range;
  loading(box, TX('loading_x', sym));
  history(sym, range).then(function(h){
    if (sym !== hp.sym || range !== hp.range || hp.tab !== 'HP') return;
    hp.data = h; drawHP(box, h);
  }).catch(function(e){ errBox(box, e) });
}
function drawHP(box, h){
  clear(box);
  var n = h.c.length, first = h.c[0], last = h.c[n - 1];
  var lows = h.l.filter(function(x){ return x != null }), highs = h.h.filter(function(x){ return x != null });
  var vol = h.v.filter(function(x){ return x }), avgv = vol.length ? vol.reduce(function(a, b){ return a + b }, 0) / vol.length : null;
  $('hp-sub').textContent = ((I.ru && h.name_ru) || h.name || '') + ' · ' + (h.src || '');
  var st = el('div', 'stat');
  [[TX('over_range', RANGES[h.range || hp.range]), pct((last / first - 1) * 100), cls(last - first)], [TX('hp_now'), price(last)], [TX('hp_min'), price(Math.min.apply(null, lows))],
   [TX('hp_max'), price(Math.max.apply(null, highs))], [TX('hp_vol'), avgv ? fmt(avgv, 0) : '—'], [TX('hp_pts'), String(n)]].forEach(function(x){
    var s = el('span', null, x[0] + ': '); s.appendChild(el('b', x[2] || null, x[1])); st.appendChild(s);
  });
  var csv = el('button', 'chipbtn', '⤓ CSV'); csv.title = TX('csv_t');
  var csvText = function(){
    var lines = ['date,open,high,low,close,volume'];
    for (var i = 0; i < n; i++) lines.push([new Date(h.t[i] * 1000).toISOString().slice(0, 10), h.o[i], h.h[i], h.l[i], h.c[i], h.v[i] == null ? '' : h.v[i]].join(','));
    return lines.join('\n') + '\n';
  };
  csv.onclick = function(){ if (!downloadText(h.s.replace(/[^A-Za-z0-9_.-]/g, '_') + '_' + (h.range || hp.range) + '.csv', csvText())) alert(TX('save_fail')) };
  var cp = el('button', 'chipbtn', TX('copy')); cp.title = TX('copy_t');
  cp.onclick = function(){ copyText(csvText().replace(/,/g, '\t')).then(function(){ cp.textContent = TX('copied') }, function(e){ cp.textContent = '✕ ' + e.message }) };
  st.appendChild(csv); st.appendChild(cp);
  box.appendChild(st);
  var cv = el('div', 'cv'); cv.style.flex = 'none'; cv.style.height = '150px'; cv.style.minHeight = '150px'; box.appendChild(cv);
  drawLines(cv, [{name: h.s, color: last >= first ? '#21c66f' : '#ff4b4b', t: h.t, v: h.c}], {pct: false});
  var wrap = el('div'); wrap.style.flex = '1'; wrap.style.overflow = 'auto';
  var tb = table(cols(TX('hp_cols')));
  var frag = document.createDocumentFragment();
  for (var i = n - 1; i >= 0; i--) {
    var tr = el('tr'), c = i > 0 ? (h.c[i] / h.c[i - 1] - 1) * 100 : null;
    tr.appendChild(td(dmy(new Date(h.t[i] * 1000).toISOString()), 'l'));
    tr.appendChild(td(price(h.o[i]), 'num')); tr.appendChild(td(price(h.h[i]), 'num')); tr.appendChild(td(price(h.l[i]), 'num'));
    tr.appendChild(td(price(h.c[i]), 'num')); tr.appendChild(chg(c)); tr.appendChild(td(h.v[i] ? fmt(h.v[i], 0) : '—', 'num'));
    frag.appendChild(tr);
  }
  tb.body.appendChild(frag); wrap.appendChild(tb.t); box.appendChild(wrap);
}
function renderComp(box){
  $('hp-title').textContent = TX('comp_x', hp.comp.join(' / '));
  clear(box);
  var f = el('form', 'frm'); f.autocomplete = 'off';
  var inp = el('input', 't'); inp.placeholder = TX('add_ticker'); inp.style.width = '140px'; f.appendChild(inp);
  var add = el('button', 'btn', TX('add')); add.type = 'submit'; f.appendChild(add);
  hp.comp.forEach(function(s, i){
    var b = el('button', 'chipbtn', s + ' ✕'); b.type = 'button'; b.style.color = COLORS[i % COLORS.length];
    b.onclick = function(){ hp.comp.splice(i, 1); store('comp_syms', JSON.stringify(hp.comp)); renderHP() }; f.appendChild(b);
  });
  f.onsubmit = function(e){ e.preventDefault(); inp.value.split(/[\s,]+/).filter(Boolean).forEach(function(s){ s = upSym(s); if (hp.comp.indexOf(s) < 0 && hp.comp.length < 6) hp.comp.push(s) }); store('comp_syms', JSON.stringify(hp.comp)); renderHP() };
  box.appendChild(f);
  if (!hp.comp.length) { box.appendChild(el('div', 'empty', TX('comp_empty'))); return }
  var cv = el('div', 'cv'); box.appendChild(cv);
  var note = el('div', 'note', TX('loading_d')); box.appendChild(note);
  var syms = hp.comp.slice(), range = hp.range;
  Promise.all(syms.map(function(s){ return history(s, range).catch(function(e){ return {error: e.message, s: s} }) })).then(function(arr){
    if (hp.tab !== 'COMP' || range !== hp.range || syms.join() !== hp.comp.join()) return;
    var series = [], bad = [];
    arr.forEach(function(h, i){ if (h.error || !h.c) bad.push(syms[i] + ': ' + (h.error || TX('no_data'))); else series.push({name: syms[i], color: COLORS[i % COLORS.length], t: h.t, v: h.c}) });
    drawLines(cv, series, {pct: true});
    var rows = series.map(function(s){ return s.name + ' ' + pct((s.v[s.v.length - 1] / s.v[0] - 1) * 100) });
    note.textContent = TX('over_range', RANGES[range]) + ': ' + rows.join(' · ') + (bad.length ? TX('not_loaded') + bad.join('; ') : '');
  });
}
RENDER['p-hp'] = function(){ if (hp.tab === 'COMP' ? hp.comp.length : hp.sym) { if (!$('hp-body').querySelector('.cv canvas')) renderHP() } };

// lines on a canvas: over time, in % from the start (comparison) or in prices
var canvases = [];
function drawLines(box, series, opts){
  box.__draw = function(){ paintLines(box, series, opts) };
  if (canvases.indexOf(box) < 0) canvases.push(box);
  box.__draw();
}
function redrawCanvases(){ canvases = canvases.filter(function(b){ return document.body.contains(b) }); canvases.forEach(function(b){ try { b.__draw() } catch(e){} }) }
function paintLines(box, series, opts){
  clear(box);
  var cv = document.createElement('canvas'); box.appendChild(cv);
  var w = box.clientWidth, h = box.clientHeight; if (!w || !h) return;
  var dpr = window.devicePixelRatio || 1; cv.width = w * dpr; cv.height = h * dpr;
  var g = cv.getContext('2d'); g.scale(dpr, dpr);
  if (!series.length) { g.fillStyle = '#5a5a5a'; g.font = '12px monospace'; g.fillText(TX('no_data_c'), 12, 20); return }
  var pts = series.map(function(s){ var b = s.v[0]; return s.v.map(function(v, i){ return [s.t[i], opts.pct ? (v / b - 1) * 100 : v] }) });
  var t0 = Infinity, t1 = -Infinity, lo = Infinity, hi = -Infinity;
  pts.forEach(function(p){ p.forEach(function(x){ if (x[1] == null || isNaN(x[1])) return; t0 = Math.min(t0, x[0]); t1 = Math.max(t1, x[0]); lo = Math.min(lo, x[1]); hi = Math.max(hi, x[1]) }) });
  var pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  var L = 8, R = 64, Tp = 8, B = 20, W = w - L - R, H = h - Tp - B;
  var X = function(t){ return L + (t - t0) / ((t1 - t0) || 1) * W }, Y = function(v){ return Tp + (hi - v) / (hi - lo) * H };
  g.font = '11px monospace'; g.textBaseline = 'middle';
  for (var k = 0; k <= 4; k++) {
    var v = lo + (hi - lo) * k / 4, y = Y(v);
    g.strokeStyle = 'rgba(255,255,255,0.06)'; g.beginPath(); g.moveTo(L, y); g.lineTo(L + W, y); g.stroke();
    g.fillStyle = '#5a5a5a'; g.fillText(opts.pct ? pct(v, 1) : fmt(v, dg(hi)), L + W + 6, y);
  }
  if (opts.pct && lo < 0 && hi > 0) { g.strokeStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.moveTo(L, Y(0)); g.lineTo(L + W, Y(0)); g.stroke() }
  g.textBaseline = 'top';
  for (var j = 0; j <= 4; j++) {
    var tt = t0 + (t1 - t0) * j / 4, x = X(tt);
    g.fillStyle = '#5a5a5a'; var lb = dmShort(new Date(tt * 1000).toISOString());
    g.fillText(lb, Math.min(Math.max(L, x - 24), L + W - 50), Tp + H + 5);
  }
  pts.forEach(function(p, i){
    g.beginPath(); var started = false;
    p.forEach(function(x){ if (x[1] == null || isNaN(x[1])) return; var px = X(x[0]), py = Y(x[1]); if (!started) { g.moveTo(px, py); started = true } else g.lineTo(px, py) });
    g.strokeStyle = series[i].color; g.lineWidth = 1.6; g.stroke();
  });
  if (series.length > 1 || opts.pct) {
    var lg = el('div', 'legend');
    series.forEach(function(s, i){ var last = pts[i][pts[i].length - 1]; var sp = el('span'); var ic = el('i'); ic.style.background = s.color; sp.appendChild(ic);
      sp.appendChild(document.createTextNode(s.name + (opts.pct && last ? ' ' + pct(last[1], 1) : ''))); lg.appendChild(sp) });
    box.appendChild(lg);
  }
}

/* ======================= EQS: screener ======================= */
var eqs = {sec: '', mcap: '', pemax: '', pemin: '', dymin: '', q: '', sort: 'mcap', dir: -1, preset: ''};
try { var se = JSON.parse(store('eqs') || 'null'); if (se) Object.keys(eqs).forEach(function(k){ if (se[k] != null) eqs[k] = se[k] }) } catch(e){}
var EQS_NAMES = TX('eqs_p');
var EQS_PRESETS = {
  '': [EQS_NAMES[''], null], leaders: [EQS_NAMES.leaders, {sort: 'ch', dir: -1}], losers: [EQS_NAMES.losers, {sort: 'ch', dir: 1}],
  value: [EQS_NAMES.value, {sort: 'pe', dir: 1, pemin: '0.01'}], div: [EQS_NAMES.div, {sort: 'dy', dir: -1, dymin: '1'}],
  growth: [EQS_NAMES.growth, {sort: 'revg', dir: -1}], year: [EQS_NAMES.year, {sort: 'r52', dir: -1}]
};
var EQS_T = TX('eqs_cols');
var EQS_COLS = ['s', 'n', 'sec', 'px', 'ch', 'mcap', 'pe', 'fpe', 'dy', 'revg', 'roe', 'rytd', 'r52', 'beta'].map(function(k){
  return {k: k, t: EQS_T[k], sort: 1, l: k === 'n' || k === 'sec' ? 1 : 0, title: k === 'revg' ? TX('revg_t') : null};
});
// presets can be named in either language: EQS GAINERS, EQS ЛИДЕРЫ
var EQS_ALIAS = {GAINERS: 'leaders', LEADERS: 'leaders', 'ЛИДЕРЫ': 'leaders', LOSERS: 'losers', 'АУТСАЙДЕРЫ': 'losers', VALUE: 'value', CHEAP: 'value',
  'ДЕШЁВЫЕ': 'value', 'ДЕШЕВЫЕ': 'value', DIV: 'div', DIVIDENDS: 'div', 'ДИВИДЕНДЫ': 'div', GROWTH: 'growth', 'РОСТ': 'growth', YEAR: 'year', 'ГОД': 'year', ALL: '', 'ВСЕ': ''};
function openEqs(preset){
  if (preset != null) {
    var P = String(preset).toUpperCase();
    var key = EQS_PRESETS[preset] ? preset : EQS_ALIAS[P] != null ? EQS_ALIAS[P] : Object.keys(EQS_PRESETS).find(function(k){ return EQS_PRESETS[k][0].indexOf(P) === 0 });
    if (key != null) applyPreset(key);
  }
  T.show('p-eqs'); renderEqs();
}
function applyPreset(k){
  eqs = {sec: '', mcap: '', pemax: '', pemin: '', dymin: '', q: '', sort: 'mcap', dir: -1, preset: k};
  var p = EQS_PRESETS[k] && EQS_PRESETS[k][1]; if (p) Object.keys(p).forEach(function(x){ eqs[x] = p[x] });
  store('eqs', JSON.stringify(eqs));
}
function eqsFilter(rows){
  var n = function(x){ return x === '' || x == null ? null : parseFloat(String(x).replace(',', '.')) };
  var mc = n(eqs.mcap), pmax = n(eqs.pemax), pmin = n(eqs.pemin), dmin = n(eqs.dymin), q = String(eqs.q || '').toLowerCase();
  return rows.filter(function(r){
    if (eqs.sec && I.sector(r.sec) !== I.sector(eqs.sec)) return false;
    if (mc != null && !((r.mcap || 0) >= mc * 1000)) return false;
    if (pmax != null && !(r.pe != null && r.pe > 0 && r.pe <= pmax)) return false;
    if (pmin != null && !(r.pe != null && r.pe >= pmin)) return false;
    if (dmin != null && !((r.dy || 0) >= dmin)) return false;
    if (q && (r.s + ' ' + r.n).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
}
function renderEqs(){
  var box = $('eqs-body');
  page('stocks.json', 120).then(function(d){ drawEqs(box, d) }).catch(function(e){
    clear(box).appendChild(el('div', 'empty', TX('eqs_wait') + e.message));
  });
}
function drawEqs(box, d){
  var keepScroll = box.scrollTop;
  clear(box);
  var rows = d.stocks || [];
  $('eqs-sub').textContent = TX('n_companies', rows.length) + ' · ' + (d.updated ? TX('msk_at', T.hm(d.updated)) : '');
  var pr = el('div', 'ptabs');
  Object.keys(EQS_PRESETS).forEach(function(k){ var b = el('button', eqs.preset === k ? 'on' : null, EQS_PRESETS[k][0]); b.onclick = function(){ applyPreset(k); renderEqs() }; pr.appendChild(b) });
  pr.appendChild(el('span', 'sp')); box.appendChild(pr);
  var f = el('div', 'frm');
  var secs = [];
  rows.forEach(function(r){ var x = I.sector(r.sec); if (secs.indexOf(x) < 0) secs.push(x) });
  var sel = el('select'); sel.appendChild(new Option(TX('all_sectors'), ''));
  secs.sort().forEach(function(s){ sel.appendChild(new Option(s, s)) }); sel.value = eqs.sec ? I.sector(eqs.sec) : '';
  var field = function(label, key, ph, w){ var l = el('label', null, label); var i = el('input', 'n'); i.value = eqs[key]; i.placeholder = ph; if (w) i.style.width = w; i.inputMode = 'decimal';
    i.oninput = function(){ eqs[key] = i.value; eqs.preset = ''; store('eqs', JSON.stringify(eqs)); clearTimeout(drawEqs._t); drawEqs._t = setTimeout(function(){ drawEqs(box, d); var x = box.querySelector('input[data-k="' + key + '"]'); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length) } }, 300) };
    i.dataset.k = key; l.appendChild(i); return l };
  sel.onchange = function(){ eqs.sec = sel.value; eqs.preset = ''; store('eqs', JSON.stringify(eqs)); drawEqs(box, d) };
  f.appendChild(sel);
  f.appendChild(field(TX('f_mcap'), 'mcap', '100', '60px'));
  f.appendChild(field(TX('f_pe'), 'pemin', '0', '50px'));
  f.appendChild(field(TX('f_to'), 'pemax', '25', '50px'));
  f.appendChild(field(TX('f_div'), 'dymin', '2', '50px'));
  f.appendChild(field(TX('f_q'), 'q', TX('f_q_ph'), '110px'));
  box.appendChild(f);
  var list = eqsFilter(rows);
  var k = eqs.sort, dir = eqs.dir;
  list.sort(function(a, b){
    var x = k === 'sec' ? I.sector(a[k]) : a[k], y = k === 'sec' ? I.sector(b[k]) : b[k];
    if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
  });
  var tb = table(EQS_COLS, {sortKey: k, sortDir: dir, onSort: function(key){ if (eqs.sort === key) eqs.dir = -eqs.dir; else { eqs.sort = key; eqs.dir = ['s', 'n', 'sec', 'pe', 'fpe', 'beta'].indexOf(key) >= 0 ? 1 : -1 } store('eqs', JSON.stringify(eqs)); drawEqs(box, d) }});
  list.forEach(function(r){
    var tr = el('tr', 'row'); tr.dataset.s = r.s;
    tr.appendChild(td(r.s, 'l tkc')); tr.appendChild(td(r.n, 'l')); tr.appendChild(td(I.sector(r.sec), 'l'));
    tr.appendChild(td(price(r.px), 'num')); tr.appendChild(chg(r.ch)); tr.appendChild(td(r.mcap ? money(r.mcap * 1e6) : '—', 'num'));
    tr.appendChild(td(num(r.pe, 1), 'num')); tr.appendChild(td(num(r.fpe, 1), 'num')); tr.appendChild(td(r.dy ? num(r.dy, 2) + '%' : '—', 'num'));
    tr.appendChild(chg(r.revg, 0)); tr.appendChild(td(r.roe != null ? num(r.roe, 0) + '%' : '—', 'num'));
    tr.appendChild(chg(r.rytd, 0)); tr.appendChild(chg(r.r52, 0)); tr.appendChild(td(num(r.beta, 2), 'num'));
    tb.body.appendChild(tr);
  });
  tb.t.onclick = function(e){ var tr = e.target.closest('tr.row'); if (tr) openDes(tr.dataset.s, 'DES') };
  box.appendChild(tb.t);
  box.appendChild(el('div', 'note', TX('eqs_found', list.length)));
  box.scrollTop = keepScroll;
}
RENDER['p-eqs'] = function(){ if (!$('eqs-body').querySelector('table')) renderEqs() };

/* ======================= IMAP: heat map ======================= */
var imapMode = 'ch';
tabs($('imap-tabs'), 'm', function(m){ imapMode = m; renderImap() });
var IMAP_SCALE = {ch: 3, r5d: 6, rytd: 40, r52: 60};
function heat(v, scale){
  if (v == null || isNaN(v)) return '#2a2a2a';
  var x = Math.max(-1, Math.min(1, v / scale));
  var a = Math.abs(x), base = [42, 42, 42], to = x >= 0 ? [20, 140, 70] : [190, 40, 40];
  var c = base.map(function(b, i){ return Math.round(b + (to[i] - b) * Math.sqrt(a)) });
  return 'rgb(' + c.join(',') + ')';
}
function squarify(items, x, y, w, h){
  var out = [], rest = items.slice();
  var worst = function(row, sum, side){ var th = sum / side, m = 0; row.forEach(function(it){ var len = it.a / th; var r = Math.max(th / len, len / th); if (r > m) m = r }); return m };
  while (rest.length && w > 0.5 && h > 0.5) {
    var side = Math.min(w, h), row = [], sum = 0, best = Infinity;
    while (rest.length) {
      var it = rest[0], s2 = sum + it.a, wv = worst(row.concat([it]), s2, side);
      if (row.length && wv > best) break;
      row.push(rest.shift()); sum = s2; best = wv;
    }
    var th = sum / side, off = 0;
    row.forEach(function(it){
      var len = it.a / th;
      if (w >= h) out.push({it: it, x: x, y: y + off, w: th, h: len}); else out.push({it: it, x: x + off, y: y, w: len, h: th});
      off += len;
    });
    if (w >= h) { x += th; w -= th } else { y += th; h -= th }
  }
  return out;
}
function renderImap(){
  var box = $('imap');
  page('stocks.json', 120).then(function(d){ drawImap(box, d) }).catch(function(e){ clear(box).appendChild(el('div', 'empty', TX('imap_wait'))) });
}
function drawImap(box, d){
  clear(box);
  var W = box.clientWidth, H = box.clientHeight;
  if (!W || !H) return;
  var rows = (d.stocks || []).filter(function(r){ return r.mcap > 0 });
  $('imap-sub').textContent = d.updated ? TX('imap_sub', T.hm(d.updated)) : '';
  if (!rows.length) { box.appendChild(el('div', 'empty', TX('imap_mcap_wait'))); return }
  var secs = {};
  rows.forEach(function(r){ var k = I.sector(r.sec); (secs[k] = secs[k] || {sec: k, v: 0, rows: []}); secs[k].v += r.mcap; secs[k].rows.push(r) });
  var list = Object.keys(secs).map(function(k){ return secs[k] }).sort(function(a, b){ return b.v - a.v });
  var total = list.reduce(function(s, x){ return s + x.v }, 0), area = W * H;
  list.forEach(function(s){ s.a = s.v / total * area });
  var tip = $('tm-tip'), scale = IMAP_SCALE[imapMode];
  squarify(list, 0, 0, W, H).forEach(function(sr){
    var sec = sr.it, inner = sec.rows.sort(function(a, b){ return b.mcap - a.mcap }).map(function(r){ return {r: r, a: r.mcap / sec.v * sr.w * sr.h} });
    var top = 14;
    squarify(inner, sr.x, sr.y + top, sr.w, Math.max(1, sr.h - top)).forEach(function(c){
      var r = c.it.r, v = r[imapMode], tile = el('div', 'tile');
      tile.style.left = c.x + 'px'; tile.style.top = c.y + 'px'; tile.style.width = c.w + 'px'; tile.style.height = c.h + 'px';
      tile.style.background = heat(v, scale);
      if (c.w > 34 && c.h > 22) { tile.appendChild(el('b', null, r.s)); if (c.h > 34) tile.appendChild(el('span', null, pct(v, 1))) }
      if (c.w > 90 && c.h > 60) tile.style.fontSize = '13px';
      tile.onclick = function(){ openDes(r.s, 'DES') };
      tile.onmousemove = function(e){ tip.style.display = 'block'; tip.style.left = Math.min(e.clientX + 12, window.innerWidth - 220) + 'px'; tip.style.top = (e.clientY + 12) + 'px';
        tip.textContent = r.s + ' · ' + r.n + ' · ' + price(r.px) + ' · ' + pct(v) + TX('mcap_s') + money(r.mcap * 1e6) };
      tile.onmouseleave = function(){ tip.style.display = 'none' };
      box.appendChild(tile);
    });
    var lab = el('div', 'sec', sec.sec + ' ' + pct(sectorChange(sec.rows, imapMode), 1));
    lab.style.left = sr.x + 'px'; lab.style.top = sr.y + 'px'; lab.style.width = sr.w + 'px';
    box.appendChild(lab);
  });
}
function sectorChange(rows, k){
  var w = 0, x = 0;
  rows.forEach(function(r){ if (r[k] != null) { w += r.mcap; x += r.mcap * r[k] } });
  return w ? x / w : null;
}
RENDER['p-imap'] = function(){ setTimeout(renderImap, 30) };

/* ======================= GC / CB / WIRP ======================= */
var gc = {tab: 'GC', sel: ['US', 'DE', 'UK', 'JP']};
try { var sg = JSON.parse(store('gc_sel') || 'null'); if (Array.isArray(sg) && sg.length) gc.sel = sg } catch(e){}
var GC_COL = {US: '#4fa3ff', DE: '#ffd400', UK: '#c77dff', JP: '#ff4b4b', RU: '#21c66f', EA: '#ffd400'};
tabs($('gc-tabs'), 't', function(t){ gc.tab = t; renderGc() });
function openGc(tab){ gc.tab = tab || 'GC'; setTab($('gc-tabs'), 't', gc.tab); T.show('p-gc'); renderGc() }
function renderGc(){
  $('gc-code').textContent = gc.tab;
  var box = $('gc-body');
  page('rates.json', 300).then(function(d){ ({GC: drawGc, CB: drawCb, WIRP: drawWirp}[gc.tab])(box, d) })
    .catch(function(e){ clear(box).appendChild(el('div', 'empty', TX('gc_wait'))) });
}
function drawGc(box, d){
  clear(box);
  var curves = d.curves || {}, codes = ['US', 'DE', 'UK', 'JP', 'RU'].filter(function(c){ return curves[c] });
  $('gc-title').textContent = TX('gc_title'); $('gc-sub').textContent = d.updated ? TX('updated_at', T.hm(d.updated)) : '';
  var chips = el('div', 'gc-c');
  codes.forEach(function(c){
    var b = el('button', 'chip' + (gc.sel.indexOf(c) >= 0 ? ' on' : ''), curves[c].flag + ' ' + locName(curves[c]));
    b.style.color = gc.sel.indexOf(c) >= 0 ? GC_COL[c] : '';
    b.onclick = function(){ var i = gc.sel.indexOf(c); if (i >= 0) gc.sel.splice(i, 1); else gc.sel.push(c); store('gc_sel', JSON.stringify(gc.sel)); drawGc(box, d) };
    chips.appendChild(b);
  });
  box.appendChild(chips);
  var sel = gc.sel.filter(function(c){ return curves[c] });
  if (!sel.length) { box.appendChild(el('div', 'empty', TX('pick_countries'))); return }
  var wrap = el('div', 'gc-wrap'); box.appendChild(wrap);
  var single = sel.length === 1 ? curves[sel[0]] : null;
  var draw = function(){ drawCurves(wrap, sel.map(function(c){ return {c: c, cv: curves[c]} }), single) };
  wrap.__draw = draw; if (canvases.indexOf(wrap) < 0) canvases.push(wrap); draw();
  if (single) box.appendChild(el('div', 'note', TX('gc_note', dmy(single.date), single.md)));
  // table: term × country
  var labels = [];
  sel.forEach(function(c){ curves[c].t.forEach(function(t, i){ if (!labels.some(function(x){ return x[0] === t })) labels.push([t, curves[c].x[i]]) }) });
  labels.sort(function(a, b){ return a[1] - b[1] });
  var gcols = [{t: TX('term')}];
  sel.forEach(function(c){ gcols.push({t: curves[c].flag + ' ' + c}); gcols.push({t: TX('wk'), title: TX('wk_t')}) });
  var tb = table(gcols);
  labels.forEach(function(L){
    var tr = el('tr'); tr.appendChild(td(L[0], 'l'));
    sel.forEach(function(c){
      var cv = curves[c], i = cv.t.indexOf(L[0]);
      if (i < 0) { tr.appendChild(td('—', 'num')); tr.appendChild(td('', 'num')); return }
      tr.appendChild(td(num(cv.y[i], 2) + '%', 'num'));
      var w = cv.w && cv.w[i] != null ? Math.round((cv.y[i] - cv.w[i]) * 100) : null;
      tr.appendChild(td(w == null ? '—' : (w > 0 ? '+' : '') + w, 'num ' + (w == null ? 'flat' : w > 0 ? 'up' : w < 0 ? 'down' : 'flat')));
    });
    tb.body.appendChild(tr);
  });
  var foot = el('tfoot'), fr = el('tr'); fr.appendChild(td('10Y−2Y', 'l'));
  sel.forEach(function(c){
    var cv = curves[c], a = cv.t.indexOf('10Y'), b = cv.t.indexOf('2Y');
    var sp = a >= 0 && b >= 0 ? Math.round((cv.y[a] - cv.y[b]) * 100) : null;
    fr.appendChild(td(sp == null ? '—' : sp + TX('bp'), 'num ' + (sp < 0 ? 'down' : ''))); fr.appendChild(td(sp != null && sp < 0 ? TX('inv_s') : '', 'num'));
  });
  foot.appendChild(fr); tb.t.appendChild(foot);
  box.appendChild(tb.t);
}
function drawCurves(wrap, list, single){
  clear(wrap);
  var NS = 'http://www.w3.org/2000/svg', W = Math.max(280, wrap.clientWidth || 0), H = Math.max(160, Math.min(420, wrap.clientHeight || 0));
  var s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 ' + W + ' ' + H); s.setAttribute('class', 'gc-svg');
  s.setAttribute('width', W); s.setAttribute('height', H); s.style.width = W + 'px'; s.style.height = H + 'px';
  var all = [];
  list.forEach(function(x){ x.cv.y.forEach(function(v){ all.push(v) }); if (single) [x.cv.w, x.cv.m].forEach(function(a){ (a || []).forEach(function(v){ if (v != null) all.push(v) }) }) });
  var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), pad = (hi - lo) * 0.1 || 0.5; lo -= pad; hi += pad;
  var xs = []; list.forEach(function(x){ x.cv.x.forEach(function(v){ xs.push(v) }) });
  var x0 = Math.sqrt(Math.min.apply(null, xs)), x1 = Math.sqrt(Math.max.apply(null, xs));
  var L = 10, R = 52, Tp = 10, B = 22;
  var X = function(v){ return L + (Math.sqrt(v) - x0) / ((x1 - x0) || 1) * (W - L - R) }, Y = function(v){ return Tp + (hi - v) / (hi - lo) * (H - Tp - B) };
  var line = function(x1_, y1_, x2_, y2_, col){ var l = document.createElementNS(NS, 'line'); l.setAttribute('x1', x1_); l.setAttribute('y1', y1_); l.setAttribute('x2', x2_); l.setAttribute('y2', y2_); l.setAttribute('stroke', col); s.appendChild(l) };
  var text = function(x, y, t, anchor){ var e = document.createElementNS(NS, 'text'); e.setAttribute('x', x); e.setAttribute('y', y); e.setAttribute('fill', '#6a6a6a'); e.setAttribute('font-size', '11'); if (anchor) e.setAttribute('text-anchor', anchor); e.textContent = t; s.appendChild(e) };
  for (var k = 0; k <= 4; k++) { var v = lo + (hi - lo) * k / 4; line(L, Y(v), W - R, Y(v), 'rgba(255,255,255,0.06)'); text(W - R + 6, Y(v) + 4, fmt(v, 2) + '%') }
  var ticks = [[0.25, '3M'], [1, '1Y'], [2, '2Y'], [5, '5Y'], [10, '10Y'], [20, '20Y'], [30, '30Y']];
  ticks.forEach(function(t){ if (Math.sqrt(t[0]) >= x0 - 1e-9 && Math.sqrt(t[0]) <= x1 + 1e-9) text(X(t[0]), H - 6, t[1], 'middle') });
  var path = function(xv, yv, col, dash, width){
    var dd = ''; xv.forEach(function(x, i){ if (yv[i] == null) return; dd += (dd ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(yv[i]).toFixed(1) });
    if (!dd) return; var p = document.createElementNS(NS, 'path'); p.setAttribute('d', dd); p.setAttribute('fill', 'none'); p.setAttribute('stroke', col);
    p.setAttribute('stroke-width', width || 2); if (dash) p.setAttribute('stroke-dasharray', dash); s.appendChild(p);
  };
  list.forEach(function(x){
    var col = GC_COL[x.c] || '#ffa028';
    if (single) { if (x.cv.m) path(x.cv.x, x.cv.m, col, '1 4', 1.4); if (x.cv.w) path(x.cv.x, x.cv.w, col, '5 4', 1.4) }
    path(x.cv.x, x.cv.y, col, null, 2.2);
    x.cv.x.forEach(function(xx, i){ var c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', X(xx)); c.setAttribute('cy', Y(x.cv.y[i])); c.setAttribute('r', 2.6); c.setAttribute('fill', col);
      var t = document.createElementNS(NS, 'title'); t.textContent = locName(x.cv) + ' ' + x.cv.t[i] + ': ' + fmt(x.cv.y[i], 2) + '%'; c.appendChild(t); s.appendChild(c) });
  });
  wrap.appendChild(s);
}
function drawCb(box, d){
  clear(box);
  $('gc-title').textContent = TX('cb_title'); $('gc-sub').textContent = TX('cb_src');
  var rows = d.cb || [];
  if (!rows.length) { box.appendChild(el('div', 'empty', TX('no_data_yet'))); return }
  var tb = table(cols(TX('cb_cols')));
  rows.forEach(function(c){
    var tr = el('tr'); tr.appendChild(td(c.flag + ' ' + locName(c), 'l'));
    tr.appendChild(td(c.lo != null ? num(c.lo, 2) + '–' + num(c.hi, 2) + '%' : num(c.rate, 2) + '%', 'num'));
    tr.appendChild(td(c.prev != null ? num(c.prev, 2) + '%' : '—', 'num'));
    var dlt = c.prev != null ? Math.round((c.rate - c.prev) * 100) : null;
    tr.appendChild(td(dlt == null ? '—' : (dlt > 0 ? '+' : '') + dlt + TX('bp'), 'num ' + (dlt > 0 ? 'up' : dlt < 0 ? 'down' : 'flat')));
    tr.appendChild(td(c.since ? dmy(c.since) : '—', 'num')); tr.appendChild(td(c.date ? dmy(c.date) : '—', 'num'));
    tb.body.appendChild(tr);
  });
  box.appendChild(tb.t);
  box.appendChild(el('div', 'note', TX('cb_note')));
}
function drawWirp(box, d){
  clear(box);
  var w = d.wirp;
  $('gc-title').textContent = TX('wirp_title'); $('gc-sub').textContent = TX('wirp_sub');
  if (!w || !w.meetings || !w.meetings.length) { box.appendChild(el('div', 'empty', TX('wirp_wait'))); return }
  var st = el('div', 'stat');
  [[TX('w_target'), num(w.lo, 2) + '–' + num(w.hi, 2) + '%'], [TX('w_effr'), num(w.effr, 2) + '%'], [TX('w_asof'), dmy(w.date)]].forEach(function(x){ var s = el('span', null, x[0] + ': '); s.appendChild(el('b', null, x[1])); st.appendChild(s) });
  box.appendChild(st);
  var tb = table(cols(TX('wirp_cols'), [4]));
  var pn = TX('w_probs');
  w.meetings.forEach(function(m){
    var tr = el('tr'); tr.appendChild(td(dmy(m.date), 'l')); tr.appendChild(td(num(m.after, 3) + '%', 'num'));
    tr.appendChild(td((m.d_bp > 0 ? '+' : '') + num(m.d_bp, 1) + TX('bp'), 'num ' + (m.d_bp > 0.5 ? 'up' : m.d_bp < -0.5 ? 'down' : 'flat')));
    tr.appendChild(td((m.cum_bp > 0 ? '+' : '') + num(m.cum_bp, 1) + TX('bp'), 'num ' + (m.cum_bp > 0.5 ? 'up' : m.cum_bp < -0.5 ? 'down' : 'flat')));
    var cell = el('td', 'l'), bar = el('div', 'prob');
    var parts = [['cut50', '#a01818', pn.cut50], ['cut', '#ff4b4b', pn.cut], ['hold', '#6a6a6a', pn.hold], ['hike', '#21c66f', pn.hike], ['hike50', '#0f7a3e', pn.hike50]];
    var lbl = [];
    parts.forEach(function(p){ var v = m[p[0]]; if (!v) return; var i = el('i'); i.style.width = v + '%'; i.style.background = p[1]; i.title = p[2] + ': ' + v + '%'; bar.appendChild(i); lbl.push(p[2] + ' ' + v + '%') });
    cell.appendChild(bar); cell.appendChild(el('div', 'note', lbl.join(' · '))); cell.lastChild.style.padding = '2px 0 0';
    tr.appendChild(cell); tb.body.appendChild(tr);
  });
  box.appendChild(tb.t);
  box.appendChild(el('div', 'note', TX('wirp_note')));
}
RENDER['p-gc'] = function(){ if (!$('gc-body').querySelector('table,svg')) renderGc() };

/* ======================= W / PORT / ALRT ======================= */
var My = (function(){
  var st = {tab: 'W', w: [], p: [], alerts: [], server: false, synced: false, quotes: {}, timer: null, msg: ''};
  try { st.w = JSON.parse(store('my_w') || '[]') || []; st.p = JSON.parse(store('my_p') || '[]') || [] } catch(e){}
  tabs($('my-tabs'), 't', function(t){ st.tab = t; render() });
  function saveLocal(){ store('my_w', JSON.stringify(st.w)); store('my_p', JSON.stringify(st.p)) }
  var pushT = null;
  function push(){
    saveLocal();
    if (!st.server) return;
    clearTimeout(pushT);
    st.pending = (st.pending || 0) + 1;   // until changes reach the server, its old copy does not overwrite them
    pushT = setTimeout(function(){
      api('/api/me', {method: 'POST', body: {w: st.w, p: st.p}}).then(function(d){ if (d.ok && st.pending === 1) { st.w = d.w; st.p = d.p; saveLocal(); render(true) } })
        .catch(function(e){ st.msg = TX('not_saved') + e.message; render() })
        .then(function(){ st.pending = Math.max(0, st.pending - 1) });
    }, 400);
  }
  function sync(){
    if (!T.api() || !T.hasIdentity()) { st.server = false; return Promise.resolve() }
    return api('/api/me' + (I.ru ? '?lang=ru' : ''), {allowError: true}).then(function(d){
      if (!d.ok) { st.server = false; return }
      st.server = true;
      st.alerts = d.alerts || [];
      if (st.pending) return;
      var lw = st.w.slice(), lp = st.p.slice();
      st.w = d.w || []; st.p = d.p || [];
      // first sign-in: move over what was saved only in this browser
      if (!st.synced && (lw.some(function(s){ return st.w.indexOf(s) < 0 }) || (!st.p.length && lp.length))) {
        lw.forEach(function(s){ if (st.w.indexOf(s) < 0) st.w.push(s) });
        if (!st.p.length) st.p = lp;
        push();
      }
      st.synced = true; saveLocal();
    }).catch(function(){ st.server = false });
  }
  function syms(){ var a = st.w.slice(); st.p.forEach(function(x){ if (a.indexOf(x.s) < 0) a.push(x.s) }); return a }
  function loadQuotes(){
    var s = syms();
    if (!s.length || !T.api()) return Promise.resolve();
    return api('/api/quote?s=' + encodeURIComponent(s.join(','))).then(function(d){
      var q = d.quotes || {};
      // server keys: AAPL, BTC, MOEX:SBER, Brent — matched with what is in the list
      Object.keys(q).forEach(function(k){ st.quotes[k] = q[k] });
    }).catch(function(){});
  }
  function q(s){ return st.quotes[s] || st.quotes[upSym(s)] || null }
  function loop(){
    clearTimeout(st.timer);
    if (visible('p-my') && !document.hidden) loadQuotes().then(function(){ render(true) });
    st.timer = setTimeout(loop, 30000);
  }
  function addWatch(list){
    list.map(upSym).filter(Boolean).forEach(function(s){ if (st.w.indexOf(s) < 0 && st.w.length < 40) st.w.push(s) });
    push(); loadQuotes().then(function(){ render() });
  }
  function open(tab, prefill){
    st.tab = tab || st.tab; setTab($('my-tabs'), 't', st.tab); T.show('p-my');
    st.prefill = prefill ? {tab: st.tab, v: prefill} : null;
    sync().then(function(){ return loadQuotes() }).then(function(){ render() });
    render();
  }
  function render(quiet){
    var box = $('my-body'), keep = box.scrollTop;
    $('my-code').textContent = st.tab;
    $('my-sub').textContent = TX(st.server ? 'shared' : 'local_only');
    if (quiet && box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') { patchQuotes(box); return }
    // what the person started typing is not lost when prices refresh
    var drafts = {}, focused = document.activeElement && box.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    if (!st.noDraft) box.querySelectorAll('input[data-k]').forEach(function(i){ if (i.value) drafts[i.dataset.k] = i.value });
    st.noDraft = false;
    clear(box);
    // an error stays visible for 8 seconds even if prices refresh and the panel redraws meanwhile
    if (st.msg) {
      if (st.msg !== st.msgShown) { st.msgShown = st.msg; st.msgAt = Date.now() }
      if (Date.now() - st.msgAt < 8000) box.appendChild(el('div', 'err', st.msg)); else st.msg = st.msgShown = '';
    }
    ({W: renderW, PORT: renderPort, ALRT: renderAlrt})[st.tab](box);
    box.querySelectorAll('input[data-k]').forEach(function(i){ if (drafts[i.dataset.k] && !i.value) i.value = drafts[i.dataset.k]; if (i.dataset.k === focused) i.focus() });
    box.scrollTop = keep;
  }
  function patchQuotes(box){
    box.querySelectorAll('tr[data-s]').forEach(function(tr){
      var x = q(tr.dataset.s); if (!x) return;
      var p = tr.querySelector('[data-k=p]'), c = tr.querySelector('[data-k=c]');
      if (p) { var t = price(x.px); if (p.textContent !== t) { p.textContent = t; T.flash(p, 1) } }
      if (c) { c.textContent = pct(x.ch); c.className = 'num ' + cls(x.ch) }
    });
  }
  function takePrefill(tab){ var p = st.prefill; if (p && p.tab === tab) { st.prefill = null; return p.v } return '' }
  function form(ph, btn, onSubmit, extra){
    var f = el('form', 'frm'); f.autocomplete = 'off';
    var i = el('input', 't'); i.placeholder = ph; i.style.width = '170px'; i.dataset.k = st.tab + '-main'; f.appendChild(i);
    (extra || []).forEach(function(x){ f.appendChild(x) });
    var b = el('button', 'btn solid', btn); b.type = 'submit'; f.appendChild(b);
    f.onsubmit = function(e){ e.preventDefault(); onSubmit(i.value, f) };
    return {f: f, i: i};
  }
  function openSym(s){ if (isStock(s)) openDes(s, 'DES'); else T.runCommand(s) }
  function renderW(box){
    var fm = form(TX('w_ph'), TX('add'), function(v){ st.noDraft = true; addWatch(v.split(/[\s,]+/).filter(Boolean)) });
    box.appendChild(fm.f);
    if (!st.w.length) { box.appendChild(el('div', 'empty', TX('w_empty'))); return }
    var tb = table(cols(TX('w_cols'), [1]));
    st.w.forEach(function(s){
      var x = q(s) || {}, tr = el('tr', 'row'); tr.dataset.s = s;
      var nm = (I.ru && x.name_ru) || x.name;
      tr.appendChild(td(s, 'l tkc')); tr.appendChild(td(nm && nm !== s ? nm : '', 'l'));
      var p = td(x.px != null ? price(x.px) + (x.cur === '₽' ? ' ₽' : '') : '—', 'num'); p.dataset.k = 'p'; tr.appendChild(p);
      var c = chg(x.ch); c.dataset.k = 'c'; tr.appendChild(c);
      var xx = el('td', 'x'), del = el('button', null, '✕'); del.title = TX('remove');
      del.onclick = function(e){ e.stopPropagation(); st.w = st.w.filter(function(z){ return z !== s }); push(); render() };
      xx.appendChild(del); tr.appendChild(xx);
      tr.onclick = function(){ openSym(s) };
      tb.body.appendChild(tr);
    });
    box.appendChild(tb.t);
    box.appendChild(el('div', 'note', TX('w_note')));
  }
  function renderPort(box){
    var qty = el('input', 'n'); qty.placeholder = TX('qty'); qty.inputMode = 'decimal'; qty.dataset.k = 'port-q';
    var pr = el('input', 'n'); pr.placeholder = TX('px_ph'); pr.inputMode = 'decimal'; pr.title = TX('px_t'); pr.dataset.k = 'port-p';
    var sell = el('button', 'btn', TX('sell')); sell.type = 'button';
    var fm = form(TX('ticker'), TX('buy'), function(v){ trade(v, qty.value, pr.value, 1) }, [qty, pr]);
    fm.f.appendChild(sell);
    sell.onclick = function(){ trade(fm.i.value, qty.value, pr.value, -1) };
    fm.i.value = takePrefill('PORT');
    box.appendChild(fm.f);
    if (!st.p.length) { box.appendChild(el('div', 'empty', TX('port_empty'))); return }
    var tb = table(cols(TX('port_cols')));
    var tot = {};
    st.p.forEach(function(x){
      var qq = q(x.s) || {}, cur = qq.cur === '₽' ? '₽' : '$', val = qq.px != null ? qq.px * x.q : null, pl = val != null ? val - x.c * x.q : null;
      var t = tot[cur] = tot[cur] || {val: 0, cost: 0, day: 0};
      if (val != null) { t.val += val; t.cost += x.c * x.q; if (qq.ch != null) t.day += val - val / (1 + qq.ch / 100) }
      var tr = el('tr', 'row'); tr.dataset.s = x.s;
      tr.appendChild(td(x.s, 'l tkc')); tr.appendChild(td(fmt(x.q, x.q % 1 ? 4 : 0), 'num')); tr.appendChild(td(price(x.c), 'num'));
      var p = td(price(qq.px), 'num'); p.dataset.k = 'p'; tr.appendChild(p);
      var c = chg(qq.ch); c.dataset.k = 'c'; tr.appendChild(c);
      tr.appendChild(td(money(val, cur), 'num')); tr.appendChild(td(pl == null ? '—' : (pl >= 0 ? '+' : '') + money(pl, cur), 'num ' + cls(pl)));
      tr.appendChild(chg(pl != null && x.c ? (qq.px / x.c - 1) * 100 : null, 1));
      var xx = el('td', 'x'), del = el('button', null, '✕'); del.title = TX('remove_pos');
      del.onclick = function(e){ e.stopPropagation(); if (!confirm(TX('remove_q', x.s))) return; st.p = st.p.filter(function(z){ return z !== x }); push(); render() };
      xx.appendChild(del); tr.appendChild(xx);
      tr.onclick = function(){ openSym(x.s) };
      tb.body.appendChild(tr);
    });
    var foot = el('tfoot');
    Object.keys(tot).forEach(function(cur){
      var t = tot[cur], fr = el('tr');
      fr.appendChild(td(TX('total') + cur, 'l')); fr.appendChild(td('')); fr.appendChild(td(''));
      fr.appendChild(td('')); fr.appendChild(chg(t.val ? t.day / (t.val - t.day) * 100 : null));
      fr.appendChild(td(money(t.val, cur), 'num')); fr.appendChild(td((t.val - t.cost >= 0 ? '+' : '') + money(t.val - t.cost, cur), 'num ' + cls(t.val - t.cost)));
      fr.appendChild(chg(t.cost ? (t.val / t.cost - 1) * 100 : null, 1)); fr.appendChild(td(''));
      foot.appendChild(fr);
    });
    tb.t.appendChild(foot);
    box.appendChild(tb.t);
  }
  function trade(sym, qty, px, sign){
    sym = upSym(sym); var n = parseFloat(String(qty).replace(',', '.')), p = px === '' ? null : parseFloat(String(px).replace(',', '.'));
    if (!sym || !(n > 0)) { st.msg = TX('need_qty'); return render() }
    var go = function(price_){
      var pos = st.p.find(function(x){ return x.s === sym });
      if (sign > 0) { if (pos) { var nq = pos.q + n; pos.c = (pos.q * pos.c + n * price_) / nq; pos.q = nq } else st.p.push({s: sym, q: n, c: price_}) }
      else { if (!pos) { st.msg = TX('not_in_port', sym); return render() } pos.q -= n; if (pos.q <= 1e-9) st.p = st.p.filter(function(x){ return x !== pos }) }
      st.noDraft = true; push(); loadQuotes().then(function(){ render() });
    };
    if (p != null && !isNaN(p)) return go(p);
    api('/api/quote?s=' + encodeURIComponent(sym)).then(function(d){
      var x = Object.values(d.quotes || {})[0];
      if (!x || x.px == null) throw new Error(TX('no_price_x', sym));
      if (x.key && x.key !== sym) sym = x.key;
      st.quotes[sym] = x; go(x.px);
    }).catch(function(e){ st.msg = TX('price_fail', e.message); render() });
  }
  function renderAlrt(box){
    if (!T.api()) return noApi(box, TX('alrt_fn'));
    if (!st.server) {
      box.appendChild(el('div', 'empty', TX('alrt_signin')));
      if (T.hasIdentity()) sync().then(function(){ if (st.server) render() });
      return;
    }
    var fm = form(TX('alrt_ph'), TX('set_btn'), function(v){
      api('/api/me' + (I.ru ? '?lang=ru' : ''), {method: 'POST', body: {op: 'alert_add', text: v}, allowError: true}).then(function(d){
        if (!d.ok) { st.msg = d.error; return render() }
        st.alerts = d.alerts; st.noDraft = true; render();
      }).catch(function(e){ st.msg = e.message; render() });
    });
    fm.i.style.width = '320px'; fm.i.style.textTransform = 'none';
    fm.i.value = takePrefill('ALRT');
    box.appendChild(fm.f);
    if (!st.alerts.length) { box.appendChild(el('div', 'empty', TX('alrt_empty'))); return }
    var tb = table(cols(TX('alrt_cols'), [1]));
    st.alerts.forEach(function(a){
      var tr = el('tr'); tr.appendChild(td(String(a.id), 'l'));
      var cond = a.k === 'news' ? TX('a_news', a.kw) : a.k === 'chg' ? TX('a_chg', a.s, fmt(a.v, a.v % 1 ? 1 : 0)) : TX('a_px', a.s, a.op, price(a.v));
      tr.appendChild(td(cond, 'l'));
      var x = a.s ? q(a.s) : null; tr.appendChild(td(x && x.px != null ? price(x.px) + ' ' + pct(x.ch) : '', 'num'));
      tr.appendChild(td(a.t ? dmy(a.t.slice(0, 10)) : '', 'num'));
      var xx = el('td', 'x'), del = el('button', null, '✕'); del.title = TX('del');
      del.onclick = function(){ api('/api/me', {method: 'POST', body: {op: 'alert_del', id: a.id}}).then(function(d){ st.alerts = d.alerts || []; render() }).catch(function(e){ st.msg = e.message; render() }) };
      xx.appendChild(del); tr.appendChild(xx); tb.body.appendChild(tr);
    });
    box.appendChild(tb.t);
    var ps = st.alerts.filter(function(a){ return a.s }).map(function(a){ return a.s });
    if (ps.some(function(s){ return !q(s) })) { api('/api/quote?s=' + encodeURIComponent(ps.join(','))).then(function(d){ Object.keys(d.quotes || {}).forEach(function(k){ st.quotes[k] = d.quotes[k] }); render(true) }).catch(function(){}) }
  }
  document.addEventListener('visibilitychange', function(){ if (!document.hidden) loop() });
  setTimeout(function(){ sync().then(loop) }, 1500);
  return {open: open, addWatch: addWatch, render: render, sync: sync, state: st};
})();
RENDER['p-my'] = function(){ My.render() };

/* ======================= ECO: the "Earnings" tab ======================= */
var ecoTab = 'macro';
tabs($('eco-tabs'), 't', function(t){ ecoTab = t; renderEarn() });
function renderEarn(){
  var e = $('earn'), m = $('eco'), nx = $('eco-next');
  e.style.display = ecoTab === 'earn' ? '' : 'none'; m.style.display = ecoTab === 'earn' ? 'none' : ''; nx.style.display = ecoTab === 'earn' ? 'none' : '';
  if (ecoTab !== 'earn') return;
  page('stocks.json', 300).then(function(d){
    clear(e);
    var today = new Date().toISOString().slice(0, 10);
    var rows = (d.earnings || []).filter(function(x){ return x.d >= new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10) });
    if (!rows.length) { e.appendChild(el('div', 'empty', TX('earn_none'))); return }
    var tb = table(cols(TX('earn_cols'), [1]));
    var last = '';
    rows.forEach(function(x){
      if (x.d !== last) { var r = el('tr'), c = el('td', 'day', T.dayLabel(x.d + 'T12:00:00Z')); c.colSpan = 5; r.appendChild(c); tb.body.appendChild(r); last = x.d }
      var tr = el('tr', 'row' + (x.d < today ? ' past' : '')); tr.dataset.s = x.s;
      tr.appendChild(td(x.h === 'bmo' ? TX('bmo_s') : x.h === 'amc' ? TX('amc_s') : '', 'l'));
      var nm = el('td', 'l'); nm.appendChild(el('b', null, x.s + ' ')); nm.lastChild.style.color = 'var(--amber)'; nm.appendChild(document.createTextNode(x.n)); tr.appendChild(nm);
      tr.appendChild(td(x.eps_e != null ? '$' + num(x.eps_e, 2) : '—', 'num'));
      var beat = x.eps_a != null && x.eps_e != null ? (x.eps_a >= x.eps_e ? 'up' : 'down') : '';
      tr.appendChild(td(x.eps_a != null ? '$' + num(x.eps_a, 2) : '—', 'num ' + beat));
      tr.appendChild(td(money(x.rev_e), 'num'));
      tb.body.appendChild(tr);
    });
    tb.t.onclick = function(ev){ var tr = ev.target.closest('tr.row'); if (tr) openDes(tr.dataset.s, 'ERN') };
    e.appendChild(tb.t);
  }).catch(function(){ clear(e).appendChild(el('div', 'empty', TX('earn_wait'))) });
}

/* ======================= live news feed ======================= */
var live = null;
function mergeLive(d){
  if (!live || !live.news || !d) return d;
  if ((live.updated || '') <= (d.updated || '')) return d;
  var seen = {}, out = [];
  live.news.concat(d.news || []).forEach(function(n){ var k = (n.link || '') + '|' + n.title; if (seen[k]) return; seen[k] = 1; out.push(n) });
  out.sort(function(a, b){ return a.ts < b.ts ? 1 : -1 });
  var m = d.market;
  if (live.market && live.market.length) m = live.market;
  return Object.assign({}, d, {news: out.slice(0, 200), updated: live.updated, market: m, live: true});
}
window.onData = function(d){ return mergeLive(d) };
function pollLive(){
  if (!T.api() || document.hidden) return;
  fetch(T.api() + '/api/live', {cache: 'no-store'}).then(function(r){ return r.json() }).then(function(l){
    if (!l || !l.ok || !l.news) return;
    var fresh = !live || l.updated !== live.updated;
    live = l;
    var d = T.data();
    if (fresh && d && (l.updated || '') > (d.updated || '')) {
      T.setData(mergeLive(d)); T.renderNews();
      $('news-upd').textContent = TX('updated_at', T.hm(l.updated)) + ' · LIVE';
    }
  }).catch(function(){});
}
setInterval(pollLive, 60000);

/* ======================= commands ======================= */
var C = T.CMDS;
function desCmd(tab){ return function(arg){ openDes(arg, tab) } }
['DES', 'FA', 'ERN', 'ANR', 'CN', 'HDS'].forEach(function(k){ C[k] = desCmd(k); T.SUFFIX[k] = 1 });
C.EE = C.ERN; T.SUFFIX.EE = 1; C.DVD = C.DES;
C['КОМПАНИЯ'] = desCmd('DES'); C['ОТЧЁТНОСТЬ'] = C['ОТЧЕТНОСТЬ'] = desCmd('FA'); C['АНАЛИТИКИ'] = desCmd('ANR');
C.HP = function(arg){ var p = String(arg || '').trim().split(/\s+/), r = p.length > 1 && /^(1M|3M|6M|YTD|1Y|2Y|5Y)$/i.test(p[p.length - 1]) ? p.pop().toLowerCase() : null; openHP(p.join(' ') || hp.sym, r) };
T.SUFFIX.HP = 1; T.SUFFIX.GP = 1;
C['ИСТОРИЯ'] = C.HP;
C.COMP = function(arg){ var p = String(arg || '').trim().split(/[\s,]+/).filter(Boolean), r = p.length && /^(1M|3M|6M|YTD|1Y|2Y|5Y)$/i.test(p[p.length - 1]) ? p.pop().toLowerCase() : null; openComp(p, r) };
C.COMPARE = C.COMP; C['СРАВНИ'] = C['СРАВНЕНИЕ'] = C.COMP;
C.EQS = function(arg){ openEqs(arg ? arg : null) }; C.SCREENER = C.EQS; C['СКРИНЕР'] = C.EQS;
C.IMAP = function(){ T.show('p-imap') }; C.MAP = C.IMAP; C.HEAT = C.IMAP; C['КАРТА'] = C.IMAP;
C.GC = function(){ openGc('GC') }; C.CURVE = C.GC; C.YCRV = C.GC; C['КРИВЫЕ'] = C.GC; C['ОБЛИГАЦИИ'] = C.GC; C['GOVT'] = C.GC;
C.CB = function(){ openGc('CB') }; C.CBR = C.CB; C['СТАВКИ'] = C.CB;
C.WIRP = function(){ openGc('WIRP') }; C.FEDWATCH = C.WIRP;
C.W = function(arg){ if (arg) My.addWatch(String(arg).split(/[\s,]+/)); My.open('W') };
C.WATCH = C.W; C['СПИСОК'] = C.W;
C.PORT = function(arg){ My.open('PORT', arg || '') }; C['ПОРТФЕЛЬ'] = C.PORT;
C.ALRT = function(arg){ My.open('ALRT', arg || '') }; C.ALERT = C.ALRT; C['АЛЕРТ'] = C['АЛЕРТЫ'] = C.ALRT;
C.LAYOUT = function(arg){ var m = String(arg || '').trim(); if (m === '5') m = '1'; Layout.setMode(LAYOUTS[m] ? m : (Layout.mode() === '1' ? '4' : '1')) };
C.LP = C.LAYOUT; C['РАСКЛАДКА'] = C.LAYOUT;
C.EVTS = function(){ T.show('p-eco'); ecoTab = 'earn'; setTab($('eco-tabs'), 't', 'earn'); renderEarn() };
C.ERNS = C.EVTS; C['ОТЧЁТЫ'] = C['ОТЧЕТЫ'] = C.EVTS;
C.ECO = function(){ T.show('p-eco'); ecoTab = 'macro'; setTab($('eco-tabs'), 't', 'macro'); renderEarn() };
C.CAL = C.ECO; C['КАЛЕНДАРЬ'] = C.ECO;

// a ticker typed without a function: the chart, and if the company card is on screen it switches too
window.onSymbol = function(s){ if (isStock(s) && visible('p-des') && T.api()) { des.tab = des.tab || 'DES'; des.sym = upSym(s); des.data = null; loadDes() } };

// on a phone the main script shows the panel — here we only draw its content
window.onPanelShow = function(pid){ if (RENDER[pid]) RENDER[pid]() };

/* ======================= start ======================= */
Layout._mob = T.isMobile();
Layout.apply();
renderEarn();
T.loadConfig().then(function(){
  pollLive();
  try {
    var start = new URLSearchParams(location.search).get('cmd');
    if (start) T.runCommand(start);
  } catch(e){}
  My.sync().then(function(){ if (visible('p-my')) My.render() });
});
})();
