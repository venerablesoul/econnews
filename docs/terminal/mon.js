/* Market monitors and the remaining Bloomberg functions from the lists.
   MOV — what drives the index (S&P 500 through its ~100 largest members, the MOEX index with its real weights)
   MOST — most active, gainers, losers, 52-week highs and lows · MRR — members ranked by return · MEMB — members and weights
   WPE — world valuations (P/E, P/B, yield of country ETFs) · BI — sector dashboards · FPC — ETF returns ranked · CDR — exchange hours and holidays
   Rates panel: WB — world bond markets, BTMM — a country's rates at a glance, MMR — money-market rates, SRCH — US Treasury securities
   News: NSE topics (MNA, OPN, USS, CNS, US COS, BBEA), TOPCA, MA, RATC.
   Aliases: WFX, ECDR, PDF, CRVF, FIT, USSW, EM, PHDC, ISSD, BQ, RELS, FUND. */
(function(){
'use strict';
var T = window.TERM, F = window.FN;
if (!T || !F) return;
var $ = T.$, el = T.el, TX = T.TX, I = T.I, fmt = T.fmt, pct = T.pct, cls = T.cls, store = T.store;
var clear = F.clear, table = F.table, td = F.td, cols = F.cols, num = F.num, price = F.price, dmy = F.dmy, money = F.money;

var mon = {tab: 'MOV', reg: store('mon_reg') || 'US', most: 'dollar', mrrSort: 'ch', mrrDir: -1, biSec: null, fpcSort: 'ytd', fpcDir: -1};
F.tabs($('mon-tabs'), 't', function(t){ mon.tab = t; renderMon() });
function openMon(tab, arg){
  mon.tab = tab; F.setTab($('mon-tabs'), 't', tab);
  var a = String(arg || '').trim().toUpperCase();
  if (/^(RU|RUS|MOEX|IMOEX|РФ|РОССИЯ)$/.test(a)) mon.reg = 'RU'; else if (/^(US|SPX|S&P|USA|США)$/.test(a)) mon.reg = 'US';
  store('mon_reg', mon.reg);
  T.show('p-mon'); renderMon();
}
function renderMon(){
  if (!F.visible('p-mon')) return;
  $('mon-code').textContent = mon.tab;
  $('mon-sub').textContent = '';
  // each drawing gets its own container: an answer that comes late (after a switch of tab) fills a detached one
  var host = $('mon-body'); clear(host);
  var box = el('div', 'mon-in'); host.appendChild(box);
  ({MOV: drawMov, MOST: drawMost, MRR: drawMrr, MEMB: drawMemb, WPE: drawWpe, BI: drawBi, FPC: drawFpc, CDR: drawCdr, NA: drawNa}[mon.tab] || drawMov)(box);
}
F.RENDER['p-mon'] = function(){ if (!$('mon-body').querySelector('table,.empty')) renderMon() };
function title(k, a){ $('mon-title').textContent = TX(k, a) }
function regionTabs(box, redraw){
  var t = el('div', 'ptabs');
  [['US', TX('reg_us')], ['RU', TX('reg_ru')]].forEach(function(r){
    var b = el('button', mon.reg === r[0] ? 'on' : null, r[1]); b.onclick = function(){ mon.reg = r[0]; store('mon_reg', r[0]); redraw(box) }; t.appendChild(b);
  });
  t.appendChild(el('span', 'sp'));
  box.appendChild(t);
  return t;
}
function stat(box, pairs){
  var st = el('div', 'stat');
  pairs.forEach(function(x){ if (!x) return; var s = el('span', null, x[0] + ': '); s.appendChild(el('b', x[2] || null, x[1])); st.appendChild(s) });
  box.appendChild(st);
}
// the members of an index: US — the ~100 largest stocks (stocks.json), Russia — the MOEX index (moex.json, weights from the exchange)
function members(){
  if (mon.reg === 'RU') return F.page('moex.json', 120).then(function(d){
    var rows = (d.rows || []).filter(function(r){ return r.w > 0 && r.px });
    var lvl = T.Q.IMOEX && T.Q.IMOEX.value;
    return {updated: d.updated, idx: 'IMOEX', level: lvl, cur: '₽', rows: rows.map(function(r){ return {s: r.s, n: I.ru ? r.n : r.en || r.n, sec: r.sec, px: r.px, ch: r.ch, w: r.w, val: r.val, cap: r.cap} }), exact: true};
  });
  return F.page('stocks.json', 120).then(function(d){
    var rows = (d.stocks || []).filter(function(r){ return r.px && r.mcap });
    var tot = rows.reduce(function(a, r){ return a + r.mcap }, 0);
    return {updated: d.updated, idx: 'S&P', level: T.Q['S&P'] && T.Q['S&P'].value, cur: '$', rows: rows.map(function(r){
      return {s: r.s, n: r.n, sec: r.sec, px: r.px, ch: r.ch, w: r.mcap / tot * 100, vol: r.vol, val: r.vol && r.px ? r.vol * r.px : null, cap: r.mcap * 1e6,
        r5d: r.r5d, r13w: r.r13w, rytd: r.rytd, r52: r.r52, h52: r.h52, l52: r.l52, pe: r.pe};
    }), exact: false};
  });
}
function openRow(s){ if (mon.reg === 'RU') F.openDes('MOEX:' + s, 'DES'); else F.openDes(s, 'DES') }

/* ---------- MOV: index movers ---------- */
function drawMov(box){
  title('mov_title');
  F.loading(box);
  members().then(function(m){
    if (mon.tab !== 'MOV') return;
    clear(box); regionTabs(box, drawMov);
    $('mon-sub').textContent = m.updated ? TX('updated_at', T.hm(m.updated)) : '';
    m.rows.forEach(function(r){ r.pts = m.level && r.ch != null ? r.w / 100 * r.ch / 100 * m.level : null; r.ctb = r.ch != null ? r.w * r.ch / 100 : null });
    var adv = m.rows.filter(function(r){ return r.ch > 0 }).length, dec = m.rows.filter(function(r){ return r.ch < 0 }).length;
    var sum = m.rows.reduce(function(a, r){ return a + (r.ctb || 0) }, 0);
    stat(box, [[TX('mov_idx'), I.mktName(m.idx) + (m.level ? ' ' + fmt(m.level, 0) : '')], [TX('mov_adv'), adv + ' / ' + dec], [TX('mov_sum'), pct(sum), cls(sum)],
      [TX('mov_members'), fmt(m.rows.length, 0)]]);
    var up = m.rows.filter(function(r){ return r.ctb > 0 }).sort(function(a, b){ return b.ctb - a.ctb }).slice(0, 12);
    var dn = m.rows.filter(function(r){ return r.ctb < 0 }).sort(function(a, b){ return a.ctb - b.ctb }).slice(0, 12);
    var maxAbs = Math.max.apply(null, up.concat(dn).map(function(r){ return Math.abs(r.ctb) }).concat([1e-9]));
    var grid = el('div', 'mon-2');
    [[TX('mov_up'), up], [TX('mov_dn'), dn]].forEach(function(g){
      var d = el('div'); d.appendChild(el('div', 'sec', g[0]));
      var tb = table(cols(TX('mov_cols'), [0]));
      g[1].forEach(function(r){
        // the ticker with the company's name beside it, cut to fit: four columns fit half a panel
        var tr = el('tr', 'row'), nmc = el('td', 'l'), nmw = el('div', 'mv-nm'); nmw.appendChild(el('b', 'tkc', r.s)); nmw.appendChild(el('small', null, ' ' + (r.n || ''))); nmc.appendChild(nmw); tr.appendChild(nmc);
        tr.appendChild(F.chg(r.ch)); tr.appendChild(td(fmt(r.w, 2) + '%', 'num'));
        var c = el('td', 'num ' + cls(r.ctb)), bar = el('i', 'mbar'); bar.style.width = Math.max(2, Math.round(Math.abs(r.ctb) / maxAbs * 28)) + 'px'; bar.style.background = r.ctb >= 0 ? '#1f7a45' : '#8a2a2a';
        c.appendChild(bar); c.appendChild(document.createTextNode(r.pts != null ? (r.pts > 0 ? '+' : '') + fmt(r.pts, 2) : pct(r.ctb, 3))); tr.appendChild(c);
        tr.title = r.n + ' · ' + price(r.px);
        tr.onclick = function(){ openRow(r.s) }; tb.body.appendChild(tr);
      });
      d.appendChild(tb.t); grid.appendChild(d);
    });
    box.appendChild(grid);
    box.appendChild(el('div', 'note', TX(m.exact ? 'mov_note_ru' : 'mov_note_us')));
  }).catch(function(e){ F.errBox(box, e) });
}

/* ---------- MOST: most active ---------- */
var MOST_MODES = ['dollar', 'vol', 'gain', 'lose', 'hi52', 'lo52'];
function drawMost(box){
  title('most_title');
  F.loading(box);
  members().then(function(m){
    if (mon.tab !== 'MOST') return;
    clear(box); var rt = regionTabs(box, drawMost);
    var modes = mon.reg === 'RU' ? ['dollar', 'gain', 'lose'] : MOST_MODES;
    if (modes.indexOf(mon.most) < 0) mon.most = 'dollar';
    var ch = el('div', 'gm-chips');
    modes.forEach(function(k){ var b = el('button', 'chipbtn' + (mon.most === k ? ' on' : ''), TX('most_' + k + (k === 'dollar' && mon.reg === 'RU' ? '_ru' : ''))); b.onclick = function(){ mon.most = k; drawMost(box) }; ch.appendChild(b) });
    box.appendChild(ch);
    var rows = m.rows.slice();
    if (mon.reg === 'RU') return F.page('moex.json', 120).then(function(d){ drawMostRu(box, d, rows) });
    var k = mon.most;
    if (k === 'dollar') rows.sort(function(a, b){ return (b.val || 0) - (a.val || 0) });
    else if (k === 'vol') rows.sort(function(a, b){ return (b.vol || 0) - (a.vol || 0) });
    else if (k === 'gain') rows.sort(function(a, b){ return b.ch - a.ch });
    else if (k === 'lose') rows.sort(function(a, b){ return a.ch - b.ch });
    else if (k === 'hi52') rows = rows.filter(function(r){ return r.h52 && r.px >= r.h52 * 0.98 }).sort(function(a, b){ return b.px / b.h52 - a.px / a.h52 });
    else rows = rows.filter(function(r){ return r.l52 && r.px <= r.l52 * 1.03 }).sort(function(a, b){ return a.px / a.l52 - b.px / b.l52 });
    var tb = table(cols(TX('most_cols'), [0, 1]));
    rows.slice(0, 30).forEach(function(r){
      var tr = el('tr', 'row'); tr.appendChild(td(r.s, 'l tkc')); tr.appendChild(td(r.n, 'l nm')); tr.appendChild(td(price(r.px), 'num')); tr.appendChild(F.chg(r.ch));
      tr.appendChild(td(r.vol ? fmt(r.vol / 1e6, 1) + (I.ru ? ' млн' : 'M') : '—', 'num')); tr.appendChild(td(money(r.val), 'num'));
      tr.appendChild(td(r.h52 ? pct((r.px / r.h52 - 1) * 100, 1) : '—', 'num')); tr.appendChild(td(r.l52 ? pct((r.px / r.l52 - 1) * 100, 1) : '—', 'num'));
      tr.onclick = function(){ openRow(r.s) }; tb.body.appendChild(tr);
    });
    if (!rows.length) box.appendChild(el('div', 'empty', TX('nothing'))); else box.appendChild(tb.t);
    box.appendChild(el('div', 'note', TX('most_note')));
  }).catch(function(e){ F.errBox(box, e) });
}
function drawMostRu(box, d, idxRows){
  var rows = (d.rows || []).filter(function(r){ return r.px }), k = mon.most;
  if (k === 'dollar') rows.sort(function(a, b){ return (b.val || 0) - (a.val || 0) });
  else if (k === 'gain') rows.sort(function(a, b){ return b.ch - a.ch }); else rows.sort(function(a, b){ return a.ch - b.ch });
  var tb = table(cols(TX('most_cols_ru'), [0, 1]));
  rows.slice(0, 30).forEach(function(r){
    var tr = el('tr', 'row'); tr.appendChild(td(r.s, 'l tkc')); tr.appendChild(td(I.ru ? r.n : r.en || r.n, 'l nm')); tr.appendChild(td(fmt(r.px, r.px < 10 ? 3 : 2) + ' ₽', 'num'));
    tr.appendChild(F.chg(r.ch)); tr.appendChild(td(money(r.val, '₽'), 'num')); tr.appendChild(td(r.w ? fmt(r.w, 2) + '%' : '—', 'num'));
    tr.onclick = function(){ F.openDes('MOEX:' + r.s, 'DES') }; tb.body.appendChild(tr);
  });
  box.appendChild(tb.t);
  box.appendChild(el('div', 'note', TX('most_note_ru')));
}

/* ---------- MRR: members ranked by return ---------- */
function drawMrr(box){
  title('mrr_title');
  F.loading(box);
  members().then(function(m){
    if (mon.tab !== 'MRR') return;
    clear(box); regionTabs(box, drawMrr);
    var keys = mon.reg === 'RU' ? [['ch', TX('per_1d')]] : [['ch', TX('per_1d')], ['r5d', TX('per_1w')], ['r13w', TX('per_3m')], ['rytd', TX('per_ytd')], ['r52', TX('per_1y')]];
    if (!keys.some(function(k){ return k[0] === mon.mrrSort })) mon.mrrSort = 'ch';
    var rows = m.rows.slice().sort(function(a, b){ var x = a[mon.mrrSort], y = b[mon.mrrSort]; return (x == null) - (y == null) || (y - x) * -mon.mrrDir });
    var colsDef = [{t: '#', l: true}, {t: TX('ticker'), l: true}, {t: TX('company'), l: true}].concat(keys.map(function(k){ return {t: k[1], k: k[0], sort: true} })).concat([{t: TX('weight')}]);
    var tb = table(colsDef, {sortKey: mon.mrrSort, sortDir: -mon.mrrDir, onSort: function(k){ if (mon.mrrSort === k) mon.mrrDir = -mon.mrrDir; else { mon.mrrSort = k; mon.mrrDir = -1 } drawMrr(box) }});
    rows.forEach(function(r, i){
      var tr = el('tr', 'row'); tr.appendChild(td(String(i + 1), 'l')); tr.appendChild(td(r.s, 'l tkc')); tr.appendChild(td(r.n, 'l nm'));
      keys.forEach(function(k){ var v = r[k[0]], c = td(v == null ? '—' : pct(v, 1), 'num'); if (v != null) { c.style.background = F.heat(v, k[0] === 'ch' ? 3 : k[0] === 'r5d' ? 6 : 30); c.style.color = '#fff' } tr.appendChild(c) });
      tr.appendChild(td(fmt(r.w, 2) + '%', 'num'));
      tr.onclick = function(){ openRow(r.s) }; tb.body.appendChild(tr);
    });
    box.appendChild(tb.t);
    box.appendChild(el('div', 'note', TX(mon.reg === 'RU' ? 'mrr_note_ru' : 'mrr_note_us')));
  }).catch(function(e){ F.errBox(box, e) });
}

/* ---------- MEMB: members and weights ---------- */
function drawMemb(box){
  title('memb_title');
  F.loading(box);
  members().then(function(m){
    if (mon.tab !== 'MEMB') return;
    clear(box); regionTabs(box, drawMemb);
    var rows = m.rows.slice().sort(function(a, b){ return b.w - a.w });
    var secs = {};
    rows.forEach(function(r){ var s = r.sec || 'Other'; secs[s] = (secs[s] || 0) + r.w });
    var keys = Object.keys(secs).sort(function(a, b){ return secs[b] - secs[a] });
    var bar = el('div', 'anr-bar'); bar.style.height = '16px'; bar.style.margin = '8px 10px 2px';
    var lg = el('div', 'legend'); lg.style.padding = '0 10px 6px';
    keys.forEach(function(s, i){ var c = F.COLORS[i % F.COLORS.length], x = el('i'); x.style.width = secs[s] + '%'; x.style.background = c; x.title = I.sector(s) + ': ' + fmt(secs[s], 1) + '%'; bar.appendChild(x);
      var sp = el('span'), ic = el('i'); ic.style.background = c; sp.appendChild(ic); sp.appendChild(document.createTextNode(I.sector(s) + ' ' + fmt(secs[s], 1) + '%')); lg.appendChild(sp) });
    box.appendChild(bar); box.appendChild(lg);
    var top10 = rows.slice(0, 10).reduce(function(a, r){ return a + r.w }, 0);
    stat(box, [[TX('mov_idx'), I.mktName(m.idx)], [TX('mov_members'), fmt(rows.length, 0)], [TX('memb_top10'), fmt(top10, 1) + '%']]);
    var tb = table(cols(TX('memb_cols'), [0, 1, 2]));
    rows.forEach(function(r){
      var tr = el('tr', 'row'); tr.appendChild(td(r.s, 'l tkc')); tr.appendChild(td(r.n, 'l nm')); tr.appendChild(td(I.sector(r.sec || 'Other'), 'l'));
      tr.appendChild(td(fmt(r.w, 2) + '%', 'num')); tr.appendChild(td(money(r.cap, m.cur), 'num')); tr.appendChild(td(price(r.px), 'num')); tr.appendChild(F.chg(r.ch));
      tr.onclick = function(){ openRow(r.s) }; tb.body.appendChild(tr);
    });
    box.appendChild(tb.t);
    box.appendChild(el('div', 'note', TX(m.exact ? 'memb_note_ru' : 'memb_note_us')));
  }).catch(function(e){ F.errBox(box, e) });
}

/* ---------- WPE: world valuations ---------- */
function drawWpe(box){
  title('wpe_title');
  F.loading(box);
  Promise.all([F.page('wpe.json', 1800).catch(function(){ return null }), F.page('stocks.json', 600).catch(function(){ return null })]).then(function(r){
    if (mon.tab !== 'WPE') return;
    clear(box);
    var d = r[0], s = r[1], rows = (d && d.rows) || [];
    $('mon-sub').textContent = d && d.updated ? TX('updated_at', T.hm(d.updated)) : '';
    // a check computed here: the ~100 largest US stocks, P/E weighted by market cap (Σcap / Σearnings)
    if (s && s.stocks) {
      var cap = 0, earn = 0, fe = 0, fcap = 0;
      s.stocks.forEach(function(x){ if (x.mcap && x.pe > 0) { cap += x.mcap; earn += x.mcap / x.pe } if (x.mcap && x.fpe > 0) { fcap += x.mcap; fe += x.mcap / x.fpe } });
      if (earn) stat(box, [[TX('wpe_us100'), fmt(cap / earn, 1) + (fe ? ' · ' + TX('wpe_fwd') + ' ' + fmt(fcap / fe, 1) : '')]]);
    }
    if (!rows.length) { box.appendChild(el('div', 'empty', TX('wpe_wait'))); return }
    var tb = table(cols(TX('wpe_cols'), [0, 1]));
    var pes = rows.map(function(x){ return x.pe }).filter(function(v){ return v > 0 }).sort(function(a, b){ return a - b }), med = pes.length ? pes[Math.floor(pes.length / 2)] : null;
    rows.forEach(function(x){
      var tr = el('tr', 'row'); tr.appendChild(td((x.flag || '') + ' ' + (I.ru ? x.ru || x.en : x.en), 'l')); tr.appendChild(td(x.s, 'l tkc'));
      var pe = td(x.pe != null ? fmt(x.pe, 1) : '—', 'num'); if (x.pe != null && med) { pe.style.background = F.heat(-(x.pe / med - 1) * 2, 1); pe.style.color = '#fff' } tr.appendChild(pe);
      tr.appendChild(td(x.pb != null ? fmt(x.pb, 2) : '—', 'num')); tr.appendChild(td(x.ps != null ? fmt(x.ps, 2) : '—', 'num'));
      tr.appendChild(td(x.dy != null ? fmt(x.dy, 2) + '%' : '—', 'num')); tr.appendChild(F.chg(x.ch)); tr.appendChild(F.chg(x.rytd, 1));
      tr.onclick = function(){ T.runCommand('TECH ' + x.s) }; tb.body.appendChild(tr);
    });
    box.appendChild(tb.t);
    box.appendChild(el('div', 'note', TX('wpe_note')));
  }).catch(function(e){ F.errBox(box, e) });
}

/* ---------- BI: sector dashboards ---------- */
function wavg(rows, k){ var s = 0, w = 0; rows.forEach(function(r){ if (r[k] != null && r.mcap) { s += r[k] * r.mcap; w += r.mcap } }); return w ? s / w : null }
function median(rows, k){ var v = rows.map(function(r){ return r[k] }).filter(function(x){ return x != null }).sort(function(a, b){ return a - b }); return v.length ? v[Math.floor(v.length / 2)] : null }
function drawBi(box){
  title('bi_title');
  F.loading(box);
  F.page('stocks.json', 300).then(function(d){
    if (mon.tab !== 'BI') return;
    clear(box);
    $('mon-sub').textContent = d.updated ? TX('updated_at', T.hm(d.updated)) : '';
    var by = {};
    (d.stocks || []).forEach(function(r){ (by[r.sec || 'Other'] = by[r.sec || 'Other'] || []).push(r) });
    var secs = Object.keys(by).map(function(s){
      var rows = by[s], cap = rows.reduce(function(a, r){ return a + (r.mcap || 0) }, 0), earn = rows.reduce(function(a, r){ return a + (r.mcap && r.pe > 0 ? r.mcap / r.pe : 0) }, 0);
      return {s: s, rows: rows, cap: cap, ch: wavg(rows, 'ch'), r5d: wavg(rows, 'r5d'), rytd: wavg(rows, 'rytd'), r52: wavg(rows, 'r52'), pe: earn ? cap / earn : null,
        fpe: median(rows, 'fpe'), nm: median(rows, 'nm'), revg: median(rows, 'revg'), roe: median(rows, 'roe'), dy: median(rows, 'dy')};
    }).sort(function(a, b){ return b.cap - a.cap });
    var tb = table(cols(TX('bi_cols'), [0]));
    secs.forEach(function(x){
      var tr = el('tr', 'row' + (mon.biSec === x.s ? ' sel' : '')); tr.appendChild(td(I.sector(x.s) + ' (' + x.rows.length + ')', 'l'));
      tr.appendChild(td(money(x.cap * 1e6), 'num')); tr.appendChild(F.chg(x.ch)); tr.appendChild(F.chg(x.r5d, 1)); tr.appendChild(F.chg(x.rytd, 1)); tr.appendChild(F.chg(x.r52, 1));
      tr.appendChild(td(x.pe ? fmt(x.pe, 1) : '—', 'num')); tr.appendChild(td(x.fpe ? fmt(x.fpe, 1) : '—', 'num')); tr.appendChild(td(x.nm != null ? fmt(x.nm, 1) + '%' : '—', 'num'));
      tr.appendChild(td(x.revg != null ? pct(x.revg, 1) : '—', 'num ' + cls(x.revg))); tr.appendChild(td(x.roe != null ? fmt(x.roe, 0) + '%' : '—', 'num')); tr.appendChild(td(x.dy != null ? fmt(x.dy, 2) + '%' : '—', 'num'));
      tr.onclick = function(){ mon.biSec = mon.biSec === x.s ? null : x.s; drawBi(box) };
      tb.body.appendChild(tr);
      if (mon.biSec === x.s) {
        var sub = el('tr'), c = el('td'); c.colSpan = 12; c.style.padding = '0';
        var t2 = table(cols(TX('bi_sub_cols'), [0, 1]));
        x.rows.slice().sort(function(a, b){ return (b.mcap || 0) - (a.mcap || 0) }).forEach(function(r){
          var r2 = el('tr', 'row'); r2.appendChild(td(r.s, 'l tkc')); r2.appendChild(td(r.n, 'l nm')); r2.appendChild(td(money(r.mcap * 1e6), 'num')); r2.appendChild(F.chg(r.ch)); r2.appendChild(F.chg(r.rytd, 1));
          r2.appendChild(td(r.pe ? fmt(r.pe, 1) : '—', 'num')); r2.appendChild(td(r.nm != null ? fmt(r.nm, 1) + '%' : '—', 'num')); r2.appendChild(td(r.revg != null ? pct(r.revg, 1) : '—', 'num ' + cls(r.revg)));
          r2.onclick = function(e){ e.stopPropagation(); F.openDes(r.s, 'DES') }; t2.body.appendChild(r2);
        });
        c.appendChild(t2.t); sub.appendChild(c); tb.body.appendChild(sub);
      }
    });
    box.appendChild(tb.t);
    box.appendChild(el('div', 'note', TX('bi_note')));
  }).catch(function(e){ F.errBox(box, e) });
}

/* ---------- FPC: ETF returns ranked ---------- */
var FUNDS = [['SPY', 'eq'], ['QQQ', 'eq'], ['DIA', 'eq'], ['IWM', 'eq'], ['VTI', 'eq'], ['EFA', 'eq'], ['VGK', 'eq'], ['EWJ', 'eq'], ['EEM', 'eq'], ['FXI', 'eq'], ['INDA', 'eq'], ['EWZ', 'eq'],
  ['XLK', 'sec'], ['XLF', 'sec'], ['XLE', 'sec'], ['XLV', 'sec'], ['XLY', 'sec'], ['XLP', 'sec'], ['XLI', 'sec'], ['XLU', 'sec'], ['XLB', 'sec'], ['XLRE', 'sec'], ['XLC', 'sec'], ['SMH', 'sec'],
  ['TLT', 'bond'], ['IEF', 'bond'], ['SHY', 'bond'], ['LQD', 'bond'], ['HYG', 'bond'], ['TIP', 'bond'], ['EMB', 'bond'],
  ['GLD', 'cmd'], ['SLV', 'cmd'], ['USO', 'cmd'], ['UNG', 'cmd'], ['DBA', 'cmd'], ['VNQ', 'alt'], ['IBIT', 'alt']];
var FPC_P = ['1d', '1w', '1m', '3m', 'ytd', '1y', '3y'];
mon.fpcGrp = 'all';
function drawFpc(box){
  title('fpc_title');
  if (!T.api()) return F.noApi(box, TX('m_fpc'));
  clear(box);
  var ch = el('div', 'gm-chips');
  ['all', 'eq', 'sec', 'bond', 'cmd', 'alt'].forEach(function(k){ var b = el('button', 'chipbtn' + (mon.fpcGrp === k ? ' on' : ''), TX('fpc_' + k)); b.onclick = function(){ mon.fpcGrp = k; drawFpc(box) }; ch.appendChild(b) });
  box.appendChild(ch);
  var note = el('div', 'loading', TX('loading_d')); box.appendChild(note);
  var list = FUNDS.filter(function(f){ return mon.fpcGrp === 'all' || f[1] === mon.fpcGrp }).map(function(f){ return f[0] });
  perfRows(list).then(function(rows){
    if (mon.tab !== 'FPC') return;
    note.remove();
    rows = rows.filter(function(r){ return r.r });
    rows.sort(function(a, b){ var x = a.r[mon.fpcSort], y = b.r[mon.fpcSort]; return (x == null) - (y == null) || (y - x) * -mon.fpcDir });
    var colsDef = [{t: '#', l: true}, {t: 'ETF', l: true}, {t: TX('name'), l: true}].concat(FPC_P.map(function(p){ return {t: TX('per_' + p), k: p, sort: true, title: p === '3y' ? TX('per_ann') : ''} }));
    var tb = table(colsDef, {sortKey: mon.fpcSort, sortDir: -mon.fpcDir, onSort: function(k){ if (mon.fpcSort === k) mon.fpcDir = -mon.fpcDir; else { mon.fpcSort = k; mon.fpcDir = -1 } drawFpc(box) }});
    rows.forEach(function(r, i){
      var tr = el('tr', 'row'); tr.appendChild(td(String(i + 1), 'l')); tr.appendChild(td(r.s, 'l tkc')); tr.appendChild(td(r.name || '', 'l nm'));
      FPC_P.forEach(function(p){ var v = r.r[p], c = td(v == null ? '—' : pct(v, 1), 'num'); if (v != null) { c.style.background = F.heat(v, /^(1d|1w)$/.test(p) ? 2 : /^(1m)$/.test(p) ? 5 : 20); c.style.color = '#fff' } tr.appendChild(c) });
      tr.onclick = function(){ T.runCommand('TECH ' + r.s) }; tb.body.appendChild(tr);
    });
    box.appendChild(tb.t);
    box.appendChild(el('div', 'note', TX('fpc_note')));
  }).catch(function(e){ note.remove(); F.errBox(box, e) });
}
function perfRows(syms){
  return F.api('/api/perf?s=' + encodeURIComponent(syms.join(',')), {ttl: 900, timeout: 50, allowError: true}).then(function(d){
    if (!d || !d.rows) throw new Error((d && d.error) || 'old server');
    return d.rows;
  }).catch(function(e){
    if (!/old server|HTTP 404/.test(e.message)) throw e;
    return Promise.all(syms.map(function(s){
      return Promise.all([F.history(s, '1y'), F.history(s, '5y').catch(function(){ return null })]).then(function(x){ return {s: s, name: x[0].name, r: window.TECH.returnsFrom(x[0], x[1])} }, function(){ return {s: s, r: null} });
    }));
  });
}

/* ---------- CDR: exchanges — hours, open now, holidays ---------- */
// [code, English, Russian, time zone, sessions [[open, close], …] local time, country for holidays, trading days (0 = Sunday)]
var EXCHANGES = [
  ['NYSE', 'New York (NYSE, Nasdaq)', 'Нью-Йорк (NYSE, Nasdaq)', 'America/New_York', [['09:30', '16:00']], 'US', [1, 2, 3, 4, 5]],
  ['TSX', 'Toronto', 'Торонто', 'America/Toronto', [['09:30', '16:00']], 'CA', [1, 2, 3, 4, 5]],
  ['B3', 'São Paulo', 'Сан-Паулу', 'America/Sao_Paulo', [['10:00', '17:00']], 'BR', [1, 2, 3, 4, 5]],
  ['LSE', 'London', 'Лондон', 'Europe/London', [['08:00', '16:30']], 'GB', [1, 2, 3, 4, 5]],
  ['XETRA', 'Frankfurt (Xetra)', 'Франкфурт (Xetra)', 'Europe/Berlin', [['09:00', '17:30']], 'DE', [1, 2, 3, 4, 5]],
  ['EPA', 'Paris (Euronext)', 'Париж (Euronext)', 'Europe/Paris', [['09:00', '17:30']], 'FR', [1, 2, 3, 4, 5]],
  ['SIX', 'Zurich (SIX)', 'Цюрих (SIX)', 'Europe/Zurich', [['09:00', '17:30']], 'CH', [1, 2, 3, 4, 5]],
  ['MOEX', 'Moscow Exchange', 'Мосбиржа', 'Europe/Moscow', [['10:00', '18:50'], ['19:05', '23:50']], 'RU', [1, 2, 3, 4, 5]],
  ['BIST', 'Istanbul', 'Стамбул', 'Europe/Istanbul', [['10:00', '18:00']], 'TR', [1, 2, 3, 4, 5]],
  ['TADAWUL', 'Riyadh (Tadawul)', 'Эр-Рияд (Tadawul)', 'Asia/Riyadh', [['10:00', '15:00']], 'SA', [0, 1, 2, 3, 4]],
  ['JSE', 'Johannesburg', 'Йоханнесбург', 'Africa/Johannesburg', [['09:00', '17:00']], 'ZA', [1, 2, 3, 4, 5]],
  ['NSE', 'Mumbai (NSE, BSE)', 'Мумбаи (NSE, BSE)', 'Asia/Kolkata', [['09:15', '15:30']], 'IN', [1, 2, 3, 4, 5]],
  ['SSE', 'Shanghai', 'Шанхай', 'Asia/Shanghai', [['09:30', '11:30'], ['13:00', '15:00']], 'CN', [1, 2, 3, 4, 5]],
  ['HKEX', 'Hong Kong', 'Гонконг', 'Asia/Hong_Kong', [['09:30', '12:00'], ['13:00', '16:00']], 'HK', [1, 2, 3, 4, 5]],
  ['TSE', 'Tokyo', 'Токио', 'Asia/Tokyo', [['09:00', '11:30'], ['12:30', '15:30']], 'JP', [1, 2, 3, 4, 5]],
  ['KRX', 'Seoul', 'Сеул', 'Asia/Seoul', [['09:00', '15:30']], 'KR', [1, 2, 3, 4, 5]],
  ['SGX', 'Singapore', 'Сингапур', 'Asia/Singapore', [['09:00', '12:00'], ['13:00', '17:00']], 'SG', [1, 2, 3, 4, 5]],
  ['ASX', 'Sydney', 'Сидней', 'Australia/Sydney', [['10:00', '16:00']], 'AU', [1, 2, 3, 4, 5]]
];
function localParts(tz, d){
  var p = new Intl.DateTimeFormat('en-GB', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false}).formatToParts(d || new Date());
  var g = function(t){ return (p.find(function(x){ return x.type === t }) || {}).value };
  var wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday'));
  return {date: g('year') + '-' + g('month') + '-' + g('day'), min: (+g('hour') % 24) * 60 + +g('minute'), wd: wd, hm: ('0' + (+g('hour') % 24)).slice(-2) + ':' + g('minute')};
}
function hmMin(s){ var a = s.split(':'); return +a[0] * 60 + +a[1] }
// NYSE holidays (rule-based: the exchange closes on Good Friday, stays open on Columbus and Veterans Day)
function nyseHolidays(y){
  var out = [], d2 = function(m, d){ return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2) };
  var nth = function(m, wd, n){ var d = new Date(Date.UTC(y, m - 1, 1)), c = 0; while (true) { if (d.getUTCDay() === wd && ++c === n) return d2(m, d.getUTCDate()); d.setUTCDate(d.getUTCDate() + 1) } };
  var last = function(m, wd){ var d = new Date(Date.UTC(y, m, 0)); while (d.getUTCDay() !== wd) d.setUTCDate(d.getUTCDate() - 1); return d2(m, d.getUTCDate()) };
  var obs = function(m, d, name){ var dt = new Date(Date.UTC(y, m - 1, d)), w = dt.getUTCDay(); if (w === 6) dt.setUTCDate(d - 1); if (w === 0) dt.setUTCDate(d + 1); if (dt.getUTCFullYear() === y) out.push([dt.toISOString().slice(0, 10), name]) };
  // Easter (Anonymous Gregorian algorithm) → Good Friday
  var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mon_ = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  var gf = new Date(Date.UTC(y, mon_ - 1, day - 2)).toISOString().slice(0, 10);
  obs(1, 1, "New Year's Day"); out.push([nth(1, 1, 3), 'Martin Luther King Jr. Day']); out.push([nth(2, 1, 3), "Washington's Birthday"]); out.push([gf, 'Good Friday']);
  out.push([last(5, 1), 'Memorial Day']); obs(6, 19, 'Juneteenth'); obs(7, 4, 'Independence Day'); out.push([nth(9, 1, 1), 'Labor Day']); out.push([nth(11, 4, 4), 'Thanksgiving Day']); obs(12, 25, 'Christmas Day');
  return out.sort(function(x, z){ return x[0] < z[0] ? -1 : 1 });
}
var holCache = {};
function holidays(cc){
  var y = new Date().getUTCFullYear();
  if (cc === 'US') return Promise.resolve(nyseHolidays(y).concat(nyseHolidays(y + 1)).map(function(h){ return {date: h[0], name: h[1]} }));
  if (holCache[cc]) return holCache[cc];
  var get = function(yy){
    var url = 'https://date.nager.at/api/v3/PublicHolidays/' + yy + '/' + cc;
    return fetch(url).then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() }).catch(function(e){
      if (!T.api()) throw e;
      return fetch(T.api() + '/api/geo?u=' + encodeURIComponent(url)).then(function(r){ return r.json() });
    });
  };
  holCache[cc] = Promise.all([get(y), get(y + 1).catch(function(){ return [] })]).then(function(a){
    return a[0].concat(a[1]).filter(function(h){ return !h.types || h.types.indexOf('Public') >= 0 || h.global !== false })
      .map(function(h){ return {date: h.date, name: I.ru && h.localName && /[а-яё]/i.test(h.localName) ? h.localName : h.name} });
  }).catch(function(e){ delete holCache[cc]; throw e });
  return holCache[cc];
}
function exStatus(x, hol){
  var p = localParts(x[3]), today = p.date, isHol = hol && hol.some(function(h){ return h.date === today });
  var trading = x[6].indexOf(p.wd) >= 0 && !isHol, s = x[4], st = 'closed', nextIn = null;
  if (trading) {
    for (var i = 0; i < s.length; i++) {
      var o = hmMin(s[i][0]), c = hmMin(s[i][1]);
      if (p.min >= o && p.min < c) { st = 'open'; nextIn = c - p.min; break }
      if (p.min < o) { st = i ? 'lunch' : 'pre'; nextIn = o - p.min; break }
    }
  }
  return {st: st, isHol: isHol, local: p.hm, nextIn: nextIn, wd: p.wd};
}
function drawCdr(box){
  title('cdr_title');
  clear(box);
  var tb = table(cols(TX('cdr_cols'), [0, 1, 4, 5]));
  var rows = EXCHANGES.map(function(x){
    var tr = el('tr'), s0 = exStatus(x, null);
    tr.appendChild(td(x[0], 'l tkc')); tr.appendChild(td(I.ru ? x[2] : x[1], 'l'));
    tr.appendChild(td(s0.local, 'num'));
    var msk = x[4].map(function(s){ return toMsk(x[3], s[0]) + '–' + toMsk(x[3], s[1]) }).join(', ');
    tr.appendChild(td(msk, 'num'));
    var stc = el('td', 'l'), nx = el('td', 'l');
    tr.appendChild(stc); tr.appendChild(nx);
    tb.body.appendChild(tr);
    var paint = function(hol){
      var s = exStatus(x, hol);
      stc.textContent = TX('cdr_' + (s.isHol ? 'hol' : s.st)) + (s.nextIn != null ? ' · ' + TX(s.st === 'open' ? 'cdr_closes' : 'cdr_opens', TX('dur', s.nextIn)) : '');
      stc.className = 'l ' + (s.st === 'open' ? 'up' : s.isHol ? 'down' : 'flat');
      var today = localParts(x[3]).date, next = (hol || []).filter(function(h){ return h.date >= today }).slice(0, 2);
      nx.textContent = next.length ? next.map(function(h){ return dmy(h.date) + ' ' + h.name }).join(' · ') : (hol ? '—' : '…');
    };
    paint(null);
    holidays(x[5]).then(paint).catch(function(){ nx.textContent = TX('cdr_nohol') });
    return tr;
  });
  box.appendChild(tb.t);
  box.appendChild(el('div', 'note', TX('cdr_note')));
}
function toMsk(tz, hm){
  // today's local session time shown in Moscow time
  var now = new Date(), p = localParts(tz, now), offs = (localParts('Europe/Moscow', now).min - p.min);
  if (localParts('Europe/Moscow', now).date !== p.date) offs += localParts('Europe/Moscow', now).date > p.date ? 1440 : -1440;
  var m = ((hmMin(hm) + offs) % 1440 + 1440) % 1440;
  return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2);
}
setInterval(function(){ if (mon.tab === 'CDR' && F.visible('p-mon') && !document.hidden) drawCdr($('mon-body').querySelector('.mon-in') || $('mon-body')) }, 60000);

/* ---------- functions with no free data ---------- */
function drawNa(box){
  title('na_title', mon.na);
  clear(box);
  box.appendChild(el('div', 'empty', TX('na_' + mon.na.toLowerCase())));
}

/* ======================= rates panel: WB, BTMM, MMR, SRCH ======================= */
var CURVE_FLAG = {US: '🇺🇸', DE: '🇩🇪', UK: '🇬🇧', JP: '🇯🇵', RU: '🇷🇺', CA: '🇨🇦', AU: '🇦🇺', CH: '🇨🇭', EA: '🇪🇺', IT: '🇮🇹', FR: '🇫🇷', ES: '🇪🇸'};
function at(cv, t){ var i = cv.t.indexOf(t); return i >= 0 ? {y: cv.y[i], w: cv.w ? cv.w[i] : null, m: cv.m ? cv.m[i] : null} : null }
function bp(a, b){ return a != null && b != null ? Math.round((a - b) * 100) : null }
function bpTd(v, bad){ return td(v == null ? '—' : (v > 0 ? '+' : '') + v, 'num ' + (v == null ? 'flat' : bad ? (v > 0 ? 'down' : v < 0 ? 'up' : 'flat') : (v > 0 ? 'up' : v < 0 ? 'down' : 'flat'))) }
F.GC_TABS.WB = function(box, d){
  clear(box);
  $('gc-title').textContent = TX('wb_title'); $('gc-sub').textContent = d.updated ? TX('updated_at', T.hm(d.updated)) : '';
  var curves = d.curves || {}, codes = Object.keys(curves), us = curves.US && at(curves.US, '10Y'), de = curves.DE && at(curves.DE, '10Y');
  (d.y10 || []).forEach(function(x){ if (!curves[x.c]) codes.push(x.c) });
  var rows = codes.map(function(c){
    var cv = curves[c];
    if (cv) { var t10 = at(cv, '10Y'); return {c: c, name: F.locName(cv), flag: cv.flag || CURVE_FLAG[c], y2: (at(cv, '2Y') || {}).y, y5: (at(cv, '5Y') || {}).y, y10: t10 && t10.y, w10: t10 && t10.w, y30: (at(cv, '30Y') || {}).y, date: cv.date} }
    var x = (d.y10 || []).filter(function(z){ return z.c === c })[0];
    return {c: c, name: I.ru ? x.name_ru || x.name : x.name, flag: CURVE_FLAG[c] || '', y10: x.y, w10: x.prev, date: x.date, monthly: x.monthly};
  }).filter(function(r){ return r.y10 != null }).sort(function(a, b){ return b.y10 - a.y10 });
  if (!rows.length) { box.appendChild(el('div', 'empty', TX('gc_wait'))); return }
  var tb = table(cols(TX('wb_cols'), [0]));
  rows.forEach(function(r){
    var tr = el('tr', 'row'); tr.appendChild(td(r.flag + ' ' + r.name, 'l'));
    [r.y2, r.y5, r.y10, r.y30].forEach(function(v){ tr.appendChild(td(v != null ? num(v, 2) + '%' : '—', 'num')) });
    tr.appendChild(bpTd(bp(r.y10, r.w10), true));
    tr.appendChild(bpTd(us && r.c !== 'US' ? bp(r.y10, us.y) : null)); tr.appendChild(bpTd(de && r.c !== 'DE' ? bp(r.y10, de.y) : null));
    tr.appendChild(bpTd(r.y2 != null ? bp(r.y10, r.y2) : null)); tr.appendChild(td(r.date ? dmy(r.date) + (r.monthly ? ' *' : '') : '—', 'num'));
    tr.onclick = function(){ T.runCommand('BTMM ' + r.c) };
    tb.body.appendChild(tr);
  });
  box.appendChild(tb.t);
  // the 10-year yields as bars
  var NS = 'http://www.w3.org/2000/svg', W = 520, H = 22 * rows.length + 8, svg = document.createElementNS(NS, 'svg'), mx = Math.max.apply(null, rows.map(function(r){ return r.y10 })) || 1;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('class', 'gc-svg'); svg.style.maxWidth = W + 'px'; svg.style.height = 'auto';
  rows.forEach(function(r, i){
    var w = Math.max(0, r.y10) / mx * (W - 170), y = 4 + i * 22;
    var t = document.createElementNS(NS, 'text'); t.setAttribute('x', 4); t.setAttribute('y', y + 14); t.setAttribute('fill', '#8c8c8c'); t.setAttribute('font-size', '11'); t.textContent = r.c; svg.appendChild(t);
    var rc = document.createElementNS(NS, 'rect'); rc.setAttribute('x', 40); rc.setAttribute('y', y + 3); rc.setAttribute('width', w); rc.setAttribute('height', 14); rc.setAttribute('fill', r.c === 'US' ? '#4fa3ff' : '#ffa028'); svg.appendChild(rc);
    var t2 = document.createElementNS(NS, 'text'); t2.setAttribute('x', 46 + w); t2.setAttribute('y', y + 14); t2.setAttribute('fill', '#e6e6e6'); t2.setAttribute('font-size', '11'); t2.textContent = num(r.y10, 2) + '%'; svg.appendChild(t2);
  });
  var blk = F.h4(box, TX('wb_bars')); blk.appendChild(svg);
  box.appendChild(el('div', 'note', TX('wb_note')));
};
var MM_OF = {US: ['SOFR', 'EFFR', 'OBFR'], EA: ['ESTR'], DE: ['ESTR'], FR: ['ESTR'], IT: ['ESTR'], UK: ['SONIA'], RU: ['RUONIA', 'RUSFAR'], JP: ['TONA'], CH: ['SARON'], CA: ['CORRA'], AU: ['AONIA']};
// rates.json keeps central banks under BIS codes: XM — the ECB, GB — the Bank of England
var CB_OF = {US: 'US', DE: 'XM', FR: 'XM', IT: 'XM', EA: 'XM', UK: 'GB', GB: 'GB', JP: 'JP', RU: 'RU', CA: 'CA', AU: 'AU', CH: 'CH', CN: 'CN', IN: 'IN', BR: 'BR', TR: 'TR'};
var CUR_OF = {US: 'USD', DE: 'EUR', FR: 'EUR', IT: 'EUR', EA: 'EUR', UK: 'GBP', JP: 'JPY', RU: 'RUB', CA: 'CAD', AU: 'AUD', CH: 'CHF', CN: 'CNY'};
var FX_OF = {DE: 'EUR/USD', EA: 'EUR/USD', FR: 'EUR/USD', IT: 'EUR/USD', UK: 'GBPUSD', JP: 'USDJPY', RU: 'USD/RUB', CH: 'USDCHF', CN: 'USDCNY', US: 'DXY'};
var gcArg = '';
F.GC_TABS.BTMM = function(box, d){
  clear(box);
  var c = (gcArg || store('btmm_c') || 'US').toUpperCase(); if (c === 'GB') c = 'UK'; if (c === 'EU') c = 'EA';
  $('gc-title').textContent = TX('btmm_title', c); $('gc-sub').textContent = d.updated ? TX('updated_at', T.hm(d.updated)) : '';
  var t = el('div', 'gm-chips');
  ['US', 'EA', 'DE', 'UK', 'JP', 'RU', 'CA', 'AU', 'CH'].forEach(function(k){ var b = el('button', 'chipbtn' + (c === k ? ' on' : ''), (CURVE_FLAG[k] || '') + ' ' + k); b.onclick = function(){ gcArg = k; store('btmm_c', k); F.GC_TABS.BTMM(box, d) }; t.appendChild(b) });
  box.appendChild(t);
  var blocks = el('div', 'mon-2'); box.appendChild(blocks);
  // policy rate
  var cb = (d.cb || []).filter(function(x){ return x.c === (CB_OF[c] || c) })[0];
  var b1 = el('div', 'blk'); b1.appendChild(el('h4', null, TX('btmm_cb')));
  if (cb) {
    F.kv(b1, [[F.locName(cb), cb.lo != null ? num(cb.lo, 2) + '–' + num(cb.hi, 2) + '%' : num(cb.rate, 2) + '%'], [TX('btmm_prev'), cb.prev != null ? num(cb.prev, 2) + '%' : '—'],
      [TX('btmm_since'), cb.since ? dmy(cb.since) : '—']]);
  } else b1.appendChild(el('div', 'note', TX('no_data_yet')));
  if (c === 'US' && d.wirp && d.wirp.meetings && d.wirp.meetings.length) {
    var m0 = d.wirp.meetings[0];
    F.kv(b1, [[TX('btmm_next'), dmy(m0.date)], [TX('btmm_implied'), num(m0.after, 3) + '% (' + (m0.d_bp > 0 ? '+' : '') + num(m0.d_bp, 1) + TX('bp') + ')']]);
  }
  blocks.appendChild(b1);
  // money markets
  var b2 = el('div', 'blk'); b2.appendChild(el('h4', null, TX('btmm_mm')));
  var mm = (d.mm || []).filter(function(x){ return (MM_OF[c] || []).indexOf(x.k) >= 0 });
  if (mm.length) F.kv(b2, mm.map(function(x){ return [x.k, num(x.v, 3) + '%', null, dmy(x.date)] }));
  else b2.appendChild(el('div', 'note', TX(d.mm ? 'btmm_nomm' : 'mmr_wait')));
  var fx = FX_OF[c] && T.Q[FX_OF[c]];
  if (fx) F.kv(b2, [[fx.name, fmt(fx.value, fx.digits) + ' ' + pct(fx.change), cls(fx.change)]]);
  blocks.appendChild(b2);
  // the curve
  var cv = (d.curves || {})[c];
  if (cv) {
    var tb = table(cols(TX('btmm_curve_cols'), [0]));
    cv.t.forEach(function(tn, i){ var tr = el('tr'); tr.appendChild(td(tn, 'l')); tr.appendChild(td(num(cv.y[i], 3) + '%', 'num')); tr.appendChild(bpTd(cv.w ? bp(cv.y[i], cv.w[i]) : null, true)); tr.appendChild(bpTd(cv.m ? bp(cv.y[i], cv.m[i]) : null, true)); tb.body.appendChild(tr) });
    var y2 = at(cv, '2Y'), y10 = at(cv, '10Y'), y3m = at(cv, '3M'), y30 = at(cv, '30Y'), y5 = at(cv, '5Y');
    var foot = el('tfoot');
    [['2s10s', y2, y10], ['3m10y', y3m, y10], ['5s30s', y5, y30]].forEach(function(s){ if (!s[1] || !s[2]) return; var fr = el('tr'); fr.appendChild(td(s[0], 'l')); fr.appendChild(td(bp(s[2].y, s[1].y) + TX('bp'), 'num ' + (s[2].y < s[1].y ? 'down' : ''))); fr.appendChild(td('')); fr.appendChild(td('')); foot.appendChild(fr) });
    tb.t.appendChild(foot);
    var b3 = F.h4(box, TX('btmm_curve', dmy(cv.date))); b3.appendChild(tb.t);
  } else box.appendChild(el('div', 'note', TX('btmm_nocurve')));
  // the calendar for this currency
  var cur = CUR_OF[c], ev = ((T.data() && T.data().calendar) || []).filter(function(e){ return e.country === cur && new Date(e.ts) > Date.now() - 864e5 });
  var b4 = F.h4(box, TX('btmm_eco', cur || c));
  if (!ev.length) b4.appendChild(el('div', 'note', TX('btmm_noeco')));
  else { var t4 = table(cols(TX('btmm_eco_cols'), [0, 1])); ev.forEach(function(e){ var tr = el('tr'); tr.appendChild(td(T.dayLabel(e.ts) + ' ' + T.hm(e.ts), 'l')); tr.appendChild(td((I.ru ? e.title_ru || e.title : e.title), 'l')); tr.appendChild(td(e.actual || '—', 'num')); tr.appendChild(td(e.forecast || '—', 'num')); tr.appendChild(td(e.previous || '—', 'num')); t4.body.appendChild(tr) }); b4.appendChild(t4.t) }
};
F.GC_TABS.MMR = function(box, d){
  clear(box);
  $('gc-title').textContent = TX('mmr_title'); $('gc-sub').textContent = d.updated ? TX('updated_at', T.hm(d.updated)) : '';
  var mm = d.mm || [];
  if (!mm.length) { box.appendChild(el('div', 'empty', TX('mmr_wait'))); return }
  var tb = table(cols(TX('mmr_cols'), [0, 1]));
  mm.forEach(function(x){
    var tr = el('tr'); tr.appendChild(td(x.k, 'l tkc')); tr.appendChild(td((CURVE_FLAG[x.c] || '') + ' ' + (I.ru ? x.ru || x.en : x.en), 'l'));
    tr.appendChild(td(num(x.v, 3) + '%', 'num')); tr.appendChild(bpTd(x.prev != null ? bp(x.v, x.prev) : null, true));
    var cb = (d.cb || []).filter(function(z){ return z.c === (CB_OF[x.c] || x.c) })[0];
    tr.appendChild(td(cb ? num(cb.rate, 2) + '%' : '—', 'num')); tr.appendChild(bpTd(cb ? bp(x.v, cb.rate) : null));
    tr.appendChild(td(x.date ? dmy(x.date) : '—', 'num'));
    tb.body.appendChild(tr);
  });
  box.appendChild(tb.t);
  box.appendChild(el('div', 'note', TX('mmr_note')));
};
// US Treasury securities: auctions and their results (the Treasury's Fiscal Data API — open to browsers)
var srch = {type: 'Bill', q: ''};
var FD = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query';
function fdNum(x){ var v = parseFloat(x); return x == null || x === 'null' || isNaN(v) ? null : v }
F.GC_TABS.SRCH = function(box){
  clear(box);
  $('gc-title').textContent = TX('srch_title'); $('gc-sub').textContent = 'Treasury Fiscal Data';
  var f = el('form', 'frm'); f.autocomplete = 'off';
  ['Bill', 'Note', 'Bond'].forEach(function(k){ var b = el('button', 'chipbtn' + (srch.type === k ? ' on' : ''), k); b.type = 'button'; b.onclick = function(){ srch.type = k; F.GC_TABS.SRCH(box) }; f.appendChild(b) });
  var inp = el('input', 't'); inp.placeholder = TX('srch_ph'); inp.value = srch.q; inp.style.width = '150px'; f.appendChild(inp);
  f.onsubmit = function(e){ e.preventDefault(); srch.q = inp.value.trim().toUpperCase(); paint() };
  inp.oninput = function(){ srch.q = inp.value.trim().toUpperCase(); paint() };
  box.appendChild(f);
  var out = el('div'); box.appendChild(out); F.loading(out);
  var from = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
  var url = FD + '?filter=' + encodeURIComponent('auction_date:gte:' + from + ',security_type:eq:' + srch.type) + '&sort=-auction_date&page[size]=400';
  var rows = null, type = srch.type, today = new Date().toISOString().slice(0, 10);
  var paint = function(){
    if (!rows) return;
    clear(out);
    var list = rows.filter(function(x){ return !srch.q || (x.cusip + ' ' + x.security_term + (x.inflation_index_security === 'Yes' ? ' TIPS' : '') + (x.floating_rate === 'Yes' ? ' FRN' : '')).toUpperCase().indexOf(srch.q) >= 0 });
    var tb = table(cols(TX('srch_cols'), [0, 1]));
    list.slice(0, 200).forEach(function(x){
      var tr = el('tr'), term = x.security_term + (x.inflation_index_security === 'Yes' ? ' TIPS' : '') + (x.floating_rate === 'Yes' ? ' FRN' : '') + (x.reopening === 'Yes' ? ' ' + TX('srch_reopen') : '');
      tr.appendChild(td(x.cusip, 'l tkc')); tr.appendChild(td(term, 'l'));
      tr.appendChild(td(dmy(x.auction_date), 'num')); tr.appendChild(td(dmy(x.issue_date), 'num')); tr.appendChild(td(dmy(x.maturity_date), 'num'));
      var y = fdNum(x.high_yield) != null ? fdNum(x.high_yield) : fdNum(x.high_investment_rate) != null ? fdNum(x.high_investment_rate) : fdNum(x.high_discnt_rate);
      var soon = y == null && fdNum(x.bid_to_cover_ratio) == null && x.auction_date >= today;
      tr.appendChild(td(y != null ? num(y, 3) + '%' : soon ? TX('srch_coming') : '—', 'num' + (soon ? ' flat' : '')));
      tr.appendChild(td(fdNum(x.int_rate) != null ? num(fdNum(x.int_rate), 3) + '%' : '—', 'num'));
      tr.appendChild(td(fdNum(x.bid_to_cover_ratio) != null ? num(fdNum(x.bid_to_cover_ratio), 2) : '—', 'num'));
      tr.appendChild(td(fdNum(x.offering_amt) != null ? money(fdNum(x.offering_amt)) : '—', 'num'));
      tb.body.appendChild(tr);
    });
    if (!list.length) out.appendChild(el('div', 'empty', TX('nothing'))); else out.appendChild(tb.t);
    out.appendChild(el('div', 'note', TX('srch_note')));
  };
  fetch(url).then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() }).catch(function(e){
    if (!T.api()) throw e;
    return fetch(T.api() + '/api/geo?u=' + encodeURIComponent(url)).then(function(r){ return r.json() }).then(function(d){ if (d && d.ok === false) throw new Error(d.error); return d });
  }).then(function(d){
    if (srch.type !== type) return;
    rows = (d && d.data) || [];
    paint();
  }).catch(function(e){ F.errBox(out, e) });
};
function openGcTab(tab, arg){ gcArg = arg ? String(arg).trim().toUpperCase().split(/\s+/)[0] : gcArg; if (arg && tab === 'BTMM') store('btmm_c', gcArg); F.openGc(tab) }

/* ======================= news topics ======================= */
var TOPICS = {
  MNA: /merg|acqui|takeover|buyout|to buy\b|deal to|bid for|tender offer|слияни|поглощ|купит|покупк|сделк/i,
  OPN: /open(s|ed|ing)? (higher|lower|flat|mixed)|futures|pre-?market|before the bell|market open|stocks? (rise|fall|slip|gain|drop) (at|in) (the )?open|открыти|фьючерс/i,
  USS: /wall street|s&p 500|nasdaq|dow jones|u\.?s\.? stocks|nyse|american stocks|уолл-стрит|американск/i,
  CNS: /canad|tsx|toronto|bank of canada|loonie|канад/i,
  COS: /earnings|revenue|profit|shares (rose|fell|jump|slump|surge|plunge)|ceo|guidance|layoffs|recall|выручк|прибыл|акции компании|гендиректор/i,
  BBEA: /earnings|quarterly|results|beats?|miss(es|ed)?|guidance|outlook|upgrade|downgrade|price target|отчёт|отчет|прогноз|рейтинг/i,
  RATC: /moody|fitch|s&p global ratings|credit rating|rating (cut|downgrade|upgrade|affirm)|outlook (to|revised|negative|positive)|sovereign rating|кредитн\w* рейтинг|рейтинг\w* агентств/i
};
function newsText(n){ return [n.title, n.title_en, n.title_ru, n.original, n.lead, n.lead_en, n.lead_ru].join(' ') }
function topic(key, high){
  var rx = TOPICS[key];
  T.newsTopic(function(n){ if (high && n.level !== 'high') return false; if (key === 'USS' && (n.tk || []).some(function(t){ return !/^MOEX:/.test(t) })) return true; if (key === 'COS' && (n.tk || []).length) return true; return rx.test(newsText(n)) }, TX('nse_' + key.toLowerCase()) + (high ? ' · TOP' : ''));
}
var C = T.CMDS;
C.NSE = function(arg){
  var a = String(arg || '').trim().toUpperCase().replace(/^US\s+COS$/, 'COS');
  if (TOPICS[a]) return topic(a);
  C.N(arg);
};
C.TOPCA = function(){ topic('CNS', true) };
C.MA = function(){ topic('MNA') }; C.MNA = C.MA; C['СЛИЯНИЯ'] = C.MA;
C.RATC = function(){ topic('RATC') }; C['РЕЙТИНГИ'] = C.RATC;

/* ======================= commands ======================= */
C.MOV = function(a){ openMon('MOV', a) }; C.MOST = function(a){ openMon('MOST', a) }; C.MRR = function(a){ openMon('MRR', a) }; C.MEMB = function(a){ openMon('MEMB', a) };
C.WPE = function(){ openMon('WPE') }; C.BI = function(){ openMon('BI') }; C.FPC = function(){ openMon('FPC') }; C.CDR = function(){ openMon('CDR') };
C['ЛИДЕРЫ'] = C.MOV; C['АКТИВНЫЕ'] = C.MOST; C['СОСТАВ'] = C.MEMB; C['ОЦЕНКА'] = C.WPE; C['СЕКТОРЫ'] = C.BI; C['ФОНДЫ'] = C.FPC; C['БИРЖИ'] = C.CDR; C['ПРАЗДНИКИ'] = C.CDR;
C.WB = function(){ openGcTab('WB') }; C.BTMM = function(a){ openGcTab('BTMM', a) }; C.MMR = function(){ openGcTab('MMR') }; C.SRCH = function(){ openGcTab('SRCH') };
C.USSW = function(){ openGcTab('BTMM', 'US') }; C.FIT = C.WB; C.CRVF = function(){ F.openGc('GC') };
C['ДОХОДНОСТИ'] = C.WB; C['ДЕНРЫНОК'] = C.MMR; C['ТРЕЖЕРИС'] = C.SRCH;
C.WFX = function(){ C.FX() }; C.ECDR = function(){ C.IPO() }; C.PDF = function(){ C.SET() };
C.EM = function(a){ F.openDes(a, 'EE') }; C.PHDC = function(a){ F.openDes(a, 'HDS') }; C.ISSD = function(a){ F.openDes(a, 'DES') }; C.BQ = C.ISSD;
C.RELS = function(a){ F.openDes(a, 'RV') }; C.FUND = function(a){ F.openDes(a, 'FA') };
['EM', 'PHDC', 'ISSD', 'BQ', 'RELS', 'FUND'].forEach(function(k){ T.SUFFIX[k] = 1 });
['BAS', 'PICK'].forEach(function(k){ C[k] = function(){ mon.na = k; mon.tab = 'NA'; F.setTab($('mon-tabs'), 't', ''); T.show('p-mon'); renderMon() } });

window.MON = {open: openMon, nyseHolidays: nyseHolidays, exStatus: exStatus, EXCHANGES: EXCHANGES, TOPICS: TOPICS, state: mon};
})();
