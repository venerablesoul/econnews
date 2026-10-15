// Bot commands: companies, quotes, charts, watchlist, portfolio, alerts, screener, market map, rates.
// Every reply is built in the chat's language: chat.lang is set by index.js ("en" by default, "ru" after /lang ru).
import { arrow, esc, pageJSON, pagesUrl, send, tg } from "./lib.js";
import { L, getLang, sectorName } from "./i18n.js";
import { chartImage, fh, getCompany, getHistory, getQuotes, normRange, parseSymbol } from "./market.js";
import {
  MAX_WATCH, addAlert, alertText, deleteAlert, getUser, parseAlert, portfolioView, saveUser, userAlerts,
} from "./user.js";

// a button that opens the terminal with a command (inside Telegram in private chats, as a link in groups)
export function terminalBtn(env, chat, cmd, text) {
  const base = pagesUrl(env);
  if (!base.startsWith("https://")) return null;
  const X = L(chat.lang);
  const url = base + "terminal/?cmd=" + encodeURIComponent(cmd) + (X.ru ? "&lang=ru" : "");
  text = text || X.t("btn_in_terminal");
  return chat.type === "private" ? { text, web_app: { url } } : { text, url };
}

function kb(rows) {
  const r = rows.map((row) => row.filter(Boolean)).filter((row) => row.length);
  return r.length ? { inline_keyboard: r } : undefined;
}

function rec(anr, X) {
  const r = anr && anr[0];
  if (!r) return null;
  const n = r.sb + r.b + r.h + r.s + r.ss;
  if (!n) return null;
  const score = (r.sb * 5 + r.b * 4 + r.h * 3 + r.s * 2 + r.ss) / n;
  const i = score >= 4.2 ? 0 : score >= 3.6 ? 1 : score >= 2.8 ? 2 : score >= 2.2 ? 3 : 4;
  return { n, buy: r.sb + r.b, hold: r.h, sell: r.s + r.ss, score, word: X.t("rec")[i], period: r.period };
}

const qName = (x, X) => (X.ru && x.name_ru) || x.name;

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------
export async function cmdQuote(env, chat, args) {
  const X = L(chat.lang);
  if (!args.length) return send(env, chat, X.t("q_usage"));
  const q = await getQuotes(env, args);
  const lines = args.map((a) => {
    const p = parseSymbol(a);
    const x = p && q[p.key];
    if (!x || x.px == null) return "⚪ " + esc(X.t("no_data_for", a));
    const name = qName(x, X);
    return `${arrow(x.ch)} <b>${esc(x.key)}</b> ${name && name !== x.key ? "<i>" + esc(name) + "</i> " : ""}` +
      `${x.cur === "$" ? "$" : ""}${X.price(x.px)}${x.cur === "₽" ? " ₽" : ""} ${X.pct(x.ch)}`;
  });
  return send(env, chat, X.t("q_head") + "\n\n" + lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------
function companyButtons(env, chat, s) {
  const X = L(chat.lang);
  return kb([
    [{ text: X.t("btn_fa"), callback_data: "fa:" + s }, { text: X.t("btn_ern"), callback_data: "ern:" + s }, { text: X.t("btn_ee"), callback_data: "ee:" + s }],
    [{ text: X.t("btn_anr"), callback_data: "anr:" + s }, { text: X.t("btn_hds"), callback_data: "hds:" + s }, { text: X.t("btn_dvd"), callback_data: "dvd:" + s }],
    [{ text: X.t("btn_omon"), callback_data: "omon:" + s }, { text: X.t("btn_rv"), callback_data: "rv:" + s }, { text: X.t("btn_cf"), callback_data: "cf:" + s }],
    [{ text: X.t("btn_cn"), callback_data: "cn:" + s }, { text: X.t("btn_chart1y"), callback_data: "chart:" + s + ":1y" }, { text: X.t("btn_add_watch"), callback_data: "w+:" + s }],
    [terminalBtn(env, chat, s + " DES")],
  ]);
}

export async function cmdDes(env, chat, args) {
  const X = L(chat.lang);
  if (!args[0]) return send(env, chat, X.t("need_symbol", "des"));
  const c = await getCompany(env, args[0], ["des", "co"], X.lang);
  const p = c.profile || {}, q = c.quote || {}, m = c.m || {};
  const co = c.co || {}, tg_ = co.targets || {};
  if (c.kind === "moex") {
    const t = [`🏢 <b>${esc(p.name)}</b> · ${esc(c.s)}`, esc(X.t("des_moex_line", p.type || "", p.isin || "—")),
      q.px != null ? "\n" + X.t("des_price", X.price(q.px) + " ₽", X.pct(q.ch)) : "", p.lot ? X.t("des_lot", p.lot) : "",
      p.issue ? X.t("des_issue", X.fmt(p.issue, 0)) : "", p.list ? X.t("des_list", p.list) : ""].filter(Boolean).join("\n");
    return send(env, chat, t, kb([[{ text: X.t("btn_chart1y"), callback_data: "chart:" + c.s + ":1y" }, { text: X.t("btn_add_watch"), callback_data: "w+:" + c.s }],
      [terminalBtn(env, chat, c.s + " DES")]]));
  }
  const r = rec(c.anr, X);
  const when = (h) => (h === "bmo" ? X.t("bmo") : h === "amc" ? X.t("amc") : "");
  const about = shortText(((co.wiki || {})[X.lang] || {}).x || (X.ru ? "" : (co.profile || {}).summary) || "", 420);
  const lines = [
    `🏢 <b>${esc(p.name || c.s)}</b> · ${esc(c.s)}`,
    [p.ind, p.exch && p.exch.replace(/ - .*$/, ""), p.country].filter(Boolean).map(esc).join(" · "),
    about ? "<i>" + esc(about) + "</i>" : "",
    (co.profile || {}).employees ? X.t("des_emp", X.fmt(co.profile.employees, 0)) : "",
    "",
    q.px != null ? X.t("des_price", "$" + X.price(q.px), X.pct(q.ch)) : "",
    m.h52 ? X.t("des_52w", "$" + X.price(m.l52), "$" + X.price(m.h52), X.pct(m.rytd), X.pct(m.r52)) : "",
    X.t("des_mcap", X.money((m.mcap || p.mcap) * 1e6)),
    X.t("des_pe", X.fmt(m.pe, 1), X.fmt(m.fpe, 1), X.fmt(m.ps, 1), X.fmt(m.pb, 1)),
    X.t("des_div", m.dy ? X.t("des_div_val", X.fmt(m.dy, 2), X.fmt(m.div, 2)) : X.t("des_div_none"), X.fmt(m.beta, 2)),
    X.t("des_margins", X.fmt(m.gm, 1), X.fmt(m.om, 1), X.fmt(m.nm, 1), X.fmt(m.roe, 0)),
    X.t("des_growth", X.pct(m.revg, 1), X.pct(m.epsg, 1)),
    r ? X.t("des_anr", r.n, r.word, r.buy, r.hold, r.sell) : "",
    tg_.mean && q.px ? X.t("des_target", X.fmt(tg_.mean, 2), "$" + X.fmt(tg_.low, 0), "$" + X.fmt(tg_.high, 0), X.pct((tg_.mean / q.px - 1) * 100, 1)) : "",
    c.next ? X.t("des_next", X.dmy(c.next.date), when(c.next.hour), c.next.eps_e != null ? X.t("eps_fcst", X.fmt(c.next.eps_e, 2)) : "") : "",
    c.peers && c.peers.length ? X.t("des_peers", c.peers.slice(0, 6).map(esc).join(", ")) : "",
    p.web ? `<a href="${esc(p.web)}">${esc(p.web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>` : "",
  ].filter((x, i, a) => x !== "" || (i > 0 && a[i - 1] !== ""));
  return send(env, chat, lines.join("\n"), companyButtons(env, chat, c.s));
}

function faRows(c) {
  if (c.fin && c.fin.quarterly && c.fin.quarterly.length) return { src: "sec", q: c.fin.quarterly, a: c.fin.annual || [] };
  return { src: "fh", q: (c.faSeries && c.faSeries.quarterly) || [], a: (c.faSeries && c.faSeries.annual) || [] };
}

export async function cmdFa(env, chat, args) {
  const X = L(chat.lang);
  if (!args[0]) return send(env, chat, X.t("need_symbol", "fa"));
  const c = await getCompany(env, args[0], ["fa"], X.lang);
  const p = c.profile || {};
  const f = faRows(c);
  let out = X.t("fa_head", esc(p.name || c.s), esc(c.s));
  const block = (row) => "\n\n<b>" + X.t("quarters") + "</b>\n" + f.q.slice(0, 6).map(row).join("\n") +
    (f.a.length ? "\n\n<b>" + X.t("years") + "</b>\n" + f.a.slice(0, 4).map(row).join("\n") : "");
  if (f.src === "sec") {
    out += X.t("fa_sec") + block((r) => X.t("fa_row", X.dmy(r.end), X.money(r.rev), X.money(r.ni),
      r.eps != null ? X.fmt(r.eps, 2) : "", r.fcf != null ? X.money(r.fcf) : ""));
    const last = f.a[0] || f.q[0];
    if (last && (last.cash != null || last.debt != null)) out += "\n\n" + X.t("fa_balance", X.money(last.cash), X.money(last.debt), X.money(last.eq));
  } else if (f.q.length || f.a.length) {
    out += X.t("fa_fh") + block((r) => X.t("fa_fh_row", X.dmy(r.end), X.fmt(r.eps, 2), X.fmt(r.salesPerShare, 2),
      X.fmt(r.grossMargin * 100, 1), X.fmt(r.netMargin * 100, 1)));
  } else out += X.t("fa_none");
  return send(env, chat, out, kb([[terminalBtn(env, chat, c.s + " FA", X.t("btn_terminal_fn", "FA"))]]));
}

export async function cmdErn(env, chat, args) {
  const X = L(chat.lang);
  if (!args[0]) return cmdEarnings(env, chat);
  const c = await getCompany(env, args[0], ["ern"], X.lang);
  let out = X.t("ern_head", esc(c.s));
  if (c.next) {
    const when = c.next.hour === "bmo" ? X.t("bmo_long") : c.next.hour === "amc" ? X.t("amc_long") : "";
    out += X.t("ern_next", X.dmy(c.next.date), when, c.next.q, c.next.y, X.fmt(c.next.eps_e, 2), X.money(c.next.rev_e));
  }
  const rows = (c.ern || []).slice(0, 8).map((e) => {
    const beat = e.act != null && e.est != null ? (e.act >= e.est ? "✅" : "❌") : "⚪";
    return beat + " " + X.t("ern_row", e.q, e.y, X.fmt(e.act, 2), X.fmt(e.est, 2), X.pct(e.sp, 1));
  });
  out += rows.length ? X.t("ern_table") + rows.join("\n") : X.t("ern_none");
  return send(env, chat, out, kb([[terminalBtn(env, chat, c.s + " ERN", X.t("btn_terminal_fn", "ERN"))]]));
}

export async function cmdAnr(env, chat, args) {
  const X = L(chat.lang);
  if (!args[0]) return send(env, chat, X.t("need_symbol", "anr"));
  const c = await getCompany(env, args[0], ["anr", "co"], X.lang);
  const r = rec(c.anr, X);
  const extra = anrExtra(c.co, X);
  if (!r) return send(env, chat, extra ? `🎯 <b>${esc(c.s)}</b>\n` + extra : X.t("anr_none", esc(c.s)));
  const bar = (n) => "█".repeat(Math.round(n / r.n * 20));
  const x = c.anr[0];
  const names = X.t("anr_rows");
  const vals = [x.sb, x.b, x.h, x.s, x.ss];
  let out = X.t("anr_head", esc(c.s), esc(x.period.slice(0, 7)), r.word, X.fmt(r.score, 1), r.n) +
    "<code>" + names.map((nm, i) => `${nm} ${String(vals[i]).padStart(3)} ${bar(vals[i])}`).join("\n") + "</code>";
  if (c.anr.length > 1) {
    const old = c.anr[c.anr.length - 1], on = old.sb + old.b + old.h + old.s + old.ss;
    if (on) out += "\n\n" + X.t("anr_old", old.period.slice(0, 7), old.sb + old.b, old.h, old.s + old.ss);
  }
  out += extra ? "\n" + extra : "";
  return send(env, chat, out, kb([[terminalBtn(env, chat, c.s + " ANR", X.t("btn_terminal_fn", "ANR"))]]));
}

export async function cmdCn(env, chat, args) {
  const X = L(chat.lang);
  if (!args[0]) return send(env, chat, X.t("need_symbol", "cn"));
  const c = await getCompany(env, args[0], ["cn"], X.lang);
  const items = (c.cn || []).slice(0, 8);
  if (!items.length) return send(env, chat, X.t("cn_none", esc(c.s)));
  const out = items.map((n) => `▪️ <b>${esc(n.h)}</b>\n<i>${esc(n.src)} · ${X.date(n.t * 1000, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</i>` +
    (/^https?:\/\//.test(n.url || "") ? ` · <a href="${esc(n.url)}">${X.t("read")}</a>` : ""));
  const untranslated = X.ru && items.every((n) => n.h === n.en);
  return send(env, chat, X.t("cn_head", esc(c.s)) + (untranslated ? X.t("cn_untranslated") : "") + "\n\n" + out.join("\n\n"),
    kb([[terminalBtn(env, chat, c.s + " CN", X.t("btn_terminal_fn", "CN"))]]));
}

export async function cmdHds(env, chat, args) {
  const X = L(chat.lang);
  if (!args[0]) return send(env, chat, X.t("need_symbol", "hds"));
  const c = await getCompany(env, args[0], ["hds", "co"], X.lang);
  const rows = (c.ins || []).slice(0, 8).map((t) => X.t("hds_row", t.code === "P", X.fmt(Math.abs(t.ch), 0),
    t.px ? X.fmt(t.px, 2) : "", t.px ? X.money(Math.abs(t.ch) * t.px) : "") + `\n<i>${esc(t.name)} · ${X.dmy(t.date)}</i>`);
  const h = (c.co || {}).holders;
  const owner = (o) => X.t("hds_owner", esc(o.n), X.fmt(o.pct, 2), X.money(o.val), o.chg != null ? X.pct(o.chg, 1) : "");
  let out;
  if (h) {
    out = X.t("hds_head2", esc(c.s)) + X.t("hds_break", X.fmt(h.ins, 1), X.fmt(h.inst, 1), h.inst_n ? X.fmt(h.inst_n, 0) : "") +
      ((h.top || []).length ? X.t("hds_top") + h.top.slice(0, 6).map(owner).join("\n") : "") +
      ((h.funds || []).length ? X.t("hds_funds") + h.funds.slice(0, 4).map(owner).join("\n") : "") +
      X.t("hds_trades") + (h.net6m ? X.t("hds_net", X.fmt(h.net6m.buy_n, 0), X.fmt(h.net6m.sell_n, 0)) + "\n\n" : "") +
      (rows.join("\n\n") || X.t("hds_none"));
  } else out = X.t("hds_head", esc(c.s)) + (rows.join("\n\n") || X.t("hds_none"));
  return send(env, chat, out, kb([[{ text: X.t("btn_si"), callback_data: "si:" + c.s }, terminalBtn(env, chat, c.s + " HDS", X.t("btn_terminal_fn", "HDS"))]]));
}

function shortText(t, n) {
  t = String(t || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const dot = cut.lastIndexOf(". ");
  return dot > n * 0.5 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, "") + "…";
}

function anrExtra(co, X) {
  if (!co) return "";
  const t = co.targets || {};
  let out = "";
  if (t.mean && t.px) out += X.t("anr_targets", X.fmt(t.px, 2), X.fmt(t.mean, 2), X.fmt(t.median, 2), X.fmt(t.low, 2), X.fmt(t.high, 2),
    X.fmt(t.n, 0), X.pct((t.mean / t.px - 1) * 100, 1)) + "\n";
  const acts = X.t("anr_act");
  const rows = (co.ratings || []).slice(0, 8).map((r) => `${X.dm(r.d)} <b>${esc(r.f)}</b>: ${acts[r.a] || "▪️"} ${esc(r.to || "")}` +
    (r.from && r.from !== r.to ? ` ← ${esc(r.from)}` : "") + (r.pt ? X.t("anr_pt", X.fmt(r.pt, 0), r.pt0 && r.pt0 !== r.pt ? X.fmt(r.pt0, 0) : "") : ""));
  if (rows.length) out += X.t("anr_changes") + rows.join("\n");
  return out;
}

// the deep file is only for the ~100 largest US companies: the others get a polite note
async function deepOr(env, chat, raw, parts, need) {
  const X = L(chat.lang);
  const c = await getCompany(env, raw, parts, X.lang);
  if (c.kind === "moex") return { c, note: X.t("no_deep", esc(c.s)) };
  if (need && !(c.co && need(c.co))) return { c, note: X.t("no_deep", esc(c.s)) };
  return { c };
}

const fnBtn = (env, chat, s, fn) => kb([[terminalBtn(env, chat, s + " " + fn, L(chat.lang).t("btn_terminal_fn", fn))]]);

export async function cmdEe(env, chat, args) {
  const X = L(chat.lang);
  if (!args[0]) return send(env, chat, X.t("need_symbol", "ee"));
  const { c, note } = await deepOr(env, chat, args[0], ["co"], (co) => co.est && co.est.length);
  if (note) return send(env, chat, note);
  const co = c.co, per = X.t("ee_periods");
  const n = Math.max(0, ...co.est.map((e) => (e.eps && e.eps.n) || 0));
  const blocks = co.est.map((e) => {
    const eps = e.eps || {}, rev = e.rev || {}, tr = e.trend || {};
    return X.t("ee_row", per[e.p] || e.p, X.dmy(e.end), X.fmt(eps.avg, 2), X.fmt(eps.low, 2), X.fmt(eps.high, 2), X.pct(eps.g, 1),
      X.money(rev.avg), X.pct(rev.g, 1)) + "\n" + X.t("ee_rev", X.fmt(e.up30 || 0, 0), X.fmt(e.dn30 || 0, 0), tr.d90 != null ? X.fmt(tr.d90, 2) : "");
  });
  let out = X.t("ee_head", esc(c.s), n) + "\n" + blocks.join("\n\n");
  if (co.next && co.next.date) out += "\n" + X.t("ee_next", X.dmy(co.next.date), co.next.estimated);
  const hist = (co.hist || []).slice(0, 4);
  if (hist.length) out += "\n" + X.t("ee_hist") + hist.map((h) => X.t("ee_hist_row", X.dmy(h.q), X.fmt(h.act, 2), X.fmt(h.est, 2), X.pct(h.sp, 1))).join("\n");
  return send(env, chat, out, fnBtn(env, chat, c.s, "EE"));
}

export async function cmdDvd(env, chat, args) {
  const X = L(chat.lang);
  if (!args[0]) return send(env, chat, X.t("need_symbol", "dvd"));
  const c = await getCompany(env, args[0], ["dvd"], X.lang);
  if (c.kind === "moex") return send(env, chat, X.t("dvd_moex"));
  const d = (c.co && c.co.div) || {};
  const hist = d.hist || (c.dvd && c.dvd.hist) || [];
  const splits = d.splits || (c.dvd && c.dvd.splits) || [];
  let out = X.t("dvd_head", esc(c.s));
  if (!hist.length) out += X.t("dvd_none", esc(c.s));
  else {
    if (d.rate) out += X.t("dvd_now", X.fmt(d.rate, 2), X.fmt(d.yield, 2), d.payout != null ? X.fmt(d.payout, 0) : "") + "\n";
    if (d.ex) out += X.t("dvd_dates", X.dmy(d.ex), d.pay ? X.dmy(d.pay) : "") + "\n";
    const years = {};
    for (const [day, v] of hist) years[day.slice(0, 4)] = (years[day.slice(0, 4)] || 0) + v;
    const ys = Object.keys(years).sort().reverse().slice(0, 6);
    out += X.t("dvd_years") + ys.map((y, i) => `${y}: $${X.fmt(years[y], 2)}` + (ys[i + 1] && i > 0 ? ` (${X.pct((years[y] / years[ys[i + 1]] - 1) * 100, 1)})` : "")).join("\n");
    out += "\n" + X.t("dvd_last") + hist.slice(0, 6).map(([day, v]) => `${X.dmy(day)}: $${X.fmt(v, 4).replace(/0+$/, "").replace(/[.,]$/, "")}`).join("\n");
  }
  if (splits.length) out += "\n" + X.t("dvd_splits", splits.slice(0, 5).map(([day, r]) => `${r} (${X.dmy(day)})`).join(", "));
  return send(env, chat, out, fnBtn(env, chat, c.s, "DVD"));
}

export async function cmdSi(env, chat, args) {
  const X = L(chat.lang);
  if (!args[0]) return send(env, chat, X.t("need_symbol", "si"));
  const { c, note } = await deepOr(env, chat, args[0], ["co"], (co) => co.short);
  if (note) return send(env, chat, note);
  const sh = c.co.short, rows = sh.rows || [];
  if (!sh.sh && !rows.length) return send(env, chat, X.t("si_none", esc(c.s)));
  const last = rows[0] || { d: sh.d, sh: sh.sh, days: sh.ratio };
  let out = X.t("si_head", esc(c.s)) + X.t("si_now", X.fmt(last.sh, 0), X.dmy(last.d), sh.pct_float != null ? X.fmt(sh.pct_float, 2) : "", X.fmt(last.days ?? sh.ratio, 1));
  const prev = rows[1] || (sh.prior ? { d: sh.prior_d, sh: sh.prior } : null);
  if (prev && prev.sh) out += "\n" + X.t("si_prior", X.fmt(prev.sh, 0), X.dmy(prev.d), X.pct((last.sh / prev.sh - 1) * 100, 1));
  if (rows.length > 2) out += "\n\n<code>" + rows.slice(0, 10).map((r) => X.t("si_row", X.dmy(r.d), X.fmt(r.sh, 0).padStart(13), X.fmt(r.days, 1))).join("\n") + "</code>";
  return send(env, chat, out, fnBtn(env, chat, c.s, "HDS"));
}

export async function cmdCf(env, chat, args) {
  const X = L(chat.lang);
  if (!args[0]) return send(env, chat, X.t("need_symbol", "cf"));
  const c = await getCompany(env, args[0], ["cf"], X.lang);
  if (c.kind === "moex") return send(env, chat, X.t("no_deep", esc(c.s)));
  const list = ((c.co && c.co.filings) || c.cf || []).slice(0, 12);
  if (!list.length) return send(env, chat, X.t("cf_none", esc(c.s)));
  const types = X.t("cf_types");
  const out = list.map((f) => `${X.dmy(f.d)} · <b>${esc(f.type)}</b>${types[f.type] ? " — " + types[f.type] : f.title && !X.ru ? " — " + esc(f.title) : ""}` +
    (/^https:\/\//.test(f.url || "") ? ` · <a href="${esc(f.url)}">${X.t("read")}</a>` : ""));
  return send(env, chat, X.t("cf_head", esc(c.s)) + out.join("\n"), fnBtn(env, chat, c.s, "CF"));
}

export async function cmdMgmt(env, chat, args) {
  const X = L(chat.lang);
  if (!args[0]) return send(env, chat, X.t("need_symbol", "mgmt"));
  const { c, note } = await deepOr(env, chat, args[0], ["co"], (co) => co.profile && co.profile.officers);
  if (note) return send(env, chat, note);
  const rows = c.co.profile.officers.slice(0, 10).map((o) => X.t("mgmt_row", esc(o.n), esc(o.t || ""), o.age || "", o.pay ? X.money(o.pay) : ""));
  return send(env, chat, X.t("mgmt_head", esc(c.s)) + rows.join("\n\n"), fnBtn(env, chat, c.s, "MGMT"));
}

export async function cmdRv(env, chat, args) {
  const X = L(chat.lang);
  if (!args[0]) return send(env, chat, X.t("need_symbol", "rv"));
  const c = await getCompany(env, args[0], ["rv"], X.lang);
  const rv = c.rv;
  if (!rv || !rv.in_list || rv.rows.length < 2) return send(env, chat, X.t("rv_none", esc(c.s)));
  const cell = (v, d, w) => (v == null ? "—" : X.fmt(v, d)).padStart(w);
  const line = (r, name) => (name || r.s).padEnd(7).slice(0, 7) + cell(r.pe, 1, 6) + cell(r.ps, 1, 6) + cell(r.revg, 0, 6) + cell(r.nm, 0, 6) + cell(r.r52, 0, 6);
  const table = [X.t("rv_cols"), ...rv.rows.map((r) => line(r)), line(rv.median, X.t("rv_median"))].join("\n");
  const fromPeers = rv.rows.slice(1).every((r) => r.sec === rv.rows[0].sec) ? "rv_src_sector" : "rv_src_peers";
  return send(env, chat, X.t("rv_head", esc(c.s), X.t(fromPeers)) + "<code>" + esc(table) + "</code>", fnBtn(env, chat, c.s, "RV"));
}

export async function cmdOmon(env, chat, args) {
  const X = L(chat.lang);
  if (!args[0]) return send(env, chat, X.t("need_symbol", "omon"));
  const c = await getCompany(env, args[0], ["opt"], X.lang);
  const o = c.opt;
  if (!o) return send(env, chat, X.t("omon_none", esc(c.s)));
  let out = X.t("omon_head", esc(c.s), X.price(o.px), X.fmt(o.iv30, 1), X.pct(o.iv30_chg, 2).replace("%", ""));
  if (o.lite) return send(env, chat, out + X.t("omon_lite"));
  out += "\n" + X.t("omon_pcr", X.fmt(o.pcr_vol, 2), X.fmt(o.pcr_oi, 2)) + "\n" + X.t("omon_exp_head") +
    (o.exp || []).slice(0, 8).map((e) => X.t("omon_exp", X.dm(e.d), e.dte, X.fmt(e.iv, 1), X.fmt(e.move, 2), X.fmt(e.move_pct, 1), "$" + X.fmt(e.pain, 0))).join("\n");
  if ((o.top_oi || []).length) out += "\n" + X.t("omon_top") + o.top_oi.slice(0, 6).map(([d, k, cp, oi]) => `${X.dm(d)} $${X.fmt(k, k % 1 ? 1 : 0)} ${cp === "C" ? "call" : "put"}: ${X.fmt(oi, 0)}`).join("\n");
  return send(env, chat, out, fnBtn(env, chat, c.s, "OMON"));
}

// ---------------------------------------------------------------------------
// World economy, IPOs, Moscow Exchange
// ---------------------------------------------------------------------------
const MACRO_ALIAS = { US: "USA", UK: "GBR", GB: "GBR", RU: "RUS", CN: "CHN", DE: "DEU", JP: "JPN", IN: "IND", FR: "FRA", IT: "ITA",
  CA: "CAN", BR: "BRA", KR: "KOR", AU: "AUS", ES: "ESP", MX: "MEX", ID: "IDN", TR: "TUR", SA: "SAU", CH: "CHE", ZA: "ZAF",
  KZ: "KAZ", EU: "EURO", EA: "EURO", EUROZONE: "EURO", WORLD: "WEOWORLD", "МИР": "WEOWORLD", "РФ": "RUS" };

export async function cmdMacro(env, chat, args) {
  const X = L(chat.lang);
  const d = await pageJSON(env, "macro.json", 3600).catch(() => null);
  if (!d || !(d.rows || []).length) return send(env, chat, X.t("macro_none"));
  const name = (r) => (X.ru ? r.ru : r.en);
  const y = new Date().getUTCFullYear();
  const iy = d.years.indexOf(y), iy2 = d.years.indexOf(y + 1);
  const v = (r, ind, i) => { const x = ((r.v || {})[ind] || [])[i]; return x == null ? "—" : X.fmt(x, 1); };
  const q = args.join(" ").trim().toUpperCase();
  if (q) {
    const code = MACRO_ALIAS[q] || q;
    const r = d.rows.find((x) => x.c === code || x.en.toUpperCase() === q || x.ru.toUpperCase() === q || x.en.toUpperCase().startsWith(q) || x.ru.toUpperCase().startsWith(q));
    if (r) {
      const yrs = d.years.slice(-5);
      const head = "<code>" + "".padEnd(17) + yrs.map((x) => String(x).padStart(7)).join("") + "\n";
      const lines = Object.keys(d.ind).filter((k) => r.v[k]).map((k) => {
        const lab = (X.t("macro_ind")[k] || d.ind[k].en).padEnd(17);
        return lab + yrs.map((yy) => { const x = r.v[k][d.years.indexOf(yy)]; return (x == null ? "—" : k === "NGDPD" ? X.fmt(x, 0) : X.fmt(x, 1)).padStart(7); }).join("");
      });
      return send(env, chat, X.t("macro_one", esc(name(r))) + head + esc(lines.join("\n")) + "</code>", kb([[terminalBtn(env, chat, "ECST " + r.c, X.t("btn_terminal_fn", "ECST"))]]));
    }
  }
  const rows = d.rows.map((r) => X.t("macro_row", esc(name(r)), v(r, "NGDP_RPCH", iy), v(r, "NGDP_RPCH", iy2), v(r, "PCPIPCH", iy), v(r, "PCPIPCH", iy2)));
  return send(env, chat, X.t("macro_head", y, y + 1) + "\n" + rows.join("\n") + "\n" + X.t("macro_hint"), kb([[terminalBtn(env, chat, "ECST", X.t("btn_terminal_fn", "ECST"))]]));
}

export async function cmdIpo(env, chat) {
  const X = L(chat.lang);
  const from = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const d = await fh(env, `/calendar/ipo?from=${from}&to=${to}`, 3 * 3600);
  const st = X.t("ipo_status");
  const list = ((d && d.ipoCalendar) || []).filter((x) => x.date >= from).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 20);
  if (!list.length) return send(env, chat, X.t("ipo_none"));
  return send(env, chat, X.t("ipo_head") + "\n" + list.map((x) => X.t("ipo_row", X.dm(x.date), esc(x.symbol || ""), esc(x.name || ""), esc(x.price || ""),
    x.numberOfShares ? X.fmt(x.numberOfShares, 0) : "", x.totalSharesValue ? X.money(x.totalSharesValue) : "", st[x.status] || esc(x.status || ""))).join("\n\n"),
  kb([[terminalBtn(env, chat, "IPO", X.t("btn_terminal_fn", "IPO"))]]));
}

export function moexSectors(rows) {
  const by = {};
  for (const r of rows) {
    if (r.ch == null || !r.cap) continue;
    const k = r.sec || "";
    const s = (by[k] = by[k] || { sec: k, cap: 0, w: 0, n: 0 });
    s.cap += r.cap; s.w += r.cap * r.ch; s.n++;
  }
  return Object.values(by).map((s) => ({ sec: s.sec, n: s.n, cap: s.cap, ch: s.w / s.cap })).sort((a, b) => b.ch - a.ch);
}

export async function cmdMoex(env, chat) {
  const X = L(chat.lang);
  const d = await pageJSON(env, "moex.json", 120).catch(() => null);
  const rows = (d && d.rows) || [];
  if (!rows.length) return send(env, chat, X.t("moex_none"));
  const bar = (c) => (c >= 0 ? "🟩" : "🟥").repeat(Math.min(5, Math.max(1, Math.round(Math.abs(c) / 0.5))));
  const idx = rows.filter((r) => r.w != null && r.ch != null);
  const top = [...idx].sort((a, b) => b.ch - a.ch).slice(0, 5), bot = [...idx].sort((a, b) => a.ch - b.ch).slice(0, 5);
  const nm = (r) => esc(X.ru ? r.n : r.en);
  const out = X.t("moex_head", d.time ? d.time.slice(0, 5) : "") + "\n" +
    moexSectors(rows).map((s) => `${bar(s.ch)} ${esc(s.sec ? sectorName(s.sec, X.lang) : X.t("other_sector"))} ${X.pct(s.ch)}`).join("\n") +
    "\n\n" + X.t("map_up") + top.map((r) => `${nm(r)} ${X.pct(r.ch, 1)}`).join(", ") +
    "\n" + X.t("map_down") + bot.map((r) => `${nm(r)} ${X.pct(r.ch, 1)}`).join(", ");
  return send(env, chat, out, kb([[terminalBtn(env, chat, "IMAP RU", X.t("btn_t_map"))]]));
}

// ---------------------------------------------------------------------------
// Morning note: companies from your watchlist that report today or tomorrow (09:00 MSK, once a day)
// ---------------------------------------------------------------------------
export async function watchReminders(env, now = new Date()) {
  if (!env.SUBS || now.getUTCHours() !== 6) return { skipped: true };
  const day = now.toISOString().slice(0, 10);
  if (await env.SUBS.get("daily:" + day)) return { done: true };
  await env.SUBS.put("daily:" + day, "1", { expirationTtl: 3 * 86400 });   // first: never twice a day, even if sending fails
  const st = await pageJSON(env, "stocks.json", 300);
  const tomorrow = new Date(now.getTime() + 864e5).toISOString().slice(0, 10);
  const by = {};
  for (const e of (st && st.earnings) || []) if (e.d === day || e.d === tomorrow) (by[e.s] = by[e.s] || []).push(e);
  if (!Object.keys(by).length) return { sent: 0 };
  let sent = 0, cursor;
  do {
    const page = await env.SUBS.list({ prefix: "p:", cursor });
    for (const k of page.keys) {
      if (sent >= 40) return { sent, capped: true };   // shortcut: ≤ 40 messages a run (Workers' subrequest limit), page by cursor when users grow
      const id = k.name.slice(2);
      const raw = await env.SUBS.get(k.name);
      let w = [];
      try { w = (JSON.parse(raw || "{}").w) || []; } catch { w = []; }
      const hits = w.flatMap((s) => by[s] || []);
      if (!hits.length) continue;
      const X = L(await getLang(env, id));
      const when = (e) => (e.d === day ? X.t("rem_today") : X.t("rem_tomorrow")) + (e.h === "bmo" ? X.t("bmo") : e.h === "amc" ? X.t("amc") : "");
      const text = X.t("rem_head") + "\n" + hits.map((e) => X.t("rem_earn", esc(e.s), esc(e.n || ""), when(e), e.eps_e != null ? X.t("eps_fcst", X.fmt(e.eps_e, 2)) : "")).join("\n");
      const chat = { id, type: "private", lang: X.lang };
      await send(env, chat, text, kb([[{ text: X.t("btn_ee"), callback_data: "ee:" + hits[0].s }, terminalBtn(env, chat, "W", X.t("btn_t_watch"))]]));
      sent++;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return { sent };
}

// ---------------------------------------------------------------------------
// Chart picture
// ---------------------------------------------------------------------------
export async function cmdChart(env, chat, args) {
  const X = L(chat.lang);
  if (!args[0]) return send(env, chat, X.t("chart_usage"));
  const range = normRange(args[1] || "1y");
  const h = await getHistory(env, args[0], range);
  const n = h.c.length;
  const ch = (h.c[n - 1] / h.c[0] - 1) * 100;
  const ranges = X.t("ranges");
  const name = (X.ru && h.name_ru) || h.name;
  const caption = X.t("chart_cap", esc(h.s), esc(name && name !== h.s ? name : ""), ranges[range], X.pct(ch), X.price(h.c[n - 1]),
    X.price(Math.min(...h.l.filter((x) => x != null))), X.price(Math.max(...h.h.filter((x) => x != null))));
  const buttons = kb([["1d", "1m", "6m", "1y", "5y"].map((r) => ({ text: r === range ? "• " + r + " •" : r, callback_data: "chart:" + h.s + ":" + r })),
    [terminalBtn(env, chat, h.s + " GP", X.t("btn_open_terminal"))]]);
  try {
    const url = await chartImage(h, `${h.s} · ${ranges[range]} · ${X.pct(ch)}`, X.lang);
    const r = await tg(env, "sendPhoto", { chat_id: chat.id, photo: url, caption, parse_mode: "HTML", reply_markup: buttons });
    if (r.ok) return r;
  } catch (e) { /* no picture — send as text */ }
  return send(env, chat, caption, buttons);
}

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------
export async function cmdWatch(env, chat, args, remove = false) {
  const X = L(chat.lang);
  const u = await getUser(env, chat.id);
  if (args.length) {
    const keys = args.map((a) => parseSymbol(a)).filter(Boolean).map((p) => p.key);
    const bad = args.filter((a) => !parseSymbol(a));
    if (remove) u.w = u.w.filter((s) => !keys.includes(s));
    else for (const k of keys) if (!u.w.includes(k)) u.w.push(k);
    const saved = await saveUser(env, chat.id, u);
    const note = X.t(remove ? "w_removed" : "w_added") + (keys.join(", ") || "—") + (bad.length ? "\n" + X.t("w_bad") + bad.join(", ") : "") +
      (saved.w.length >= MAX_WATCH ? "\n" + X.t("w_max", MAX_WATCH) : "");
    await send(env, chat, esc(note));
    return watchView(env, chat, saved.w);
  }
  return watchView(env, chat, u.w);
}

async function watchView(env, chat, w) {
  const X = L(chat.lang);
  if (!w.length) return send(env, chat, X.t("w_empty"));
  const q = await getQuotes(env, w);
  const lines = w.map((s) => {
    const x = q[s];
    return x && x.px != null ? `${arrow(x.ch)} <b>${esc(s)}</b> ${X.price(x.px)}${x.cur === "₽" ? " ₽" : ""} ${X.pct(x.ch)}` : `⚪ <b>${esc(s)}</b> —`;
  });
  return send(env, chat, X.t("w_head") + "\n\n" + lines.join("\n") + "\n\n" + X.t("w_remove_hint"),
    kb([[{ text: X.t("btn_refresh"), callback_data: "watch" }, terminalBtn(env, chat, "W", X.t("btn_t_watch"))]]));
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------
const num = (s) => Number(String(s == null ? "" : s).replace(",", "."));

export async function cmdPort(env, chat, args, mode) {
  const X = L(chat.lang);
  const u = await getUser(env, chat.id);
  if (mode === "buy" || mode === "sell") {
    const p = parseSymbol(args[0]);
    const qty = num(args[1]);
    let px = args[2] != null ? num(args[2]) : null;
    if (!p || !isFinite(qty) || qty <= 0) return send(env, chat, X.t(mode === "buy" ? "buy_usage" : "sell_usage"));
    if (px == null || !isFinite(px) || px < 0) {
      const q = (await getQuotes(env, [p.key]))[p.key];
      if (!q || q.px == null) return send(env, chat, esc(X.t("no_price", p.key, mode, qty)));
      px = q.px;
    }
    const pos = u.p.find((x) => x.s === p.key);
    if (mode === "buy") {
      if (pos) { const nq = pos.q + qty; pos.c = (pos.q * pos.c + qty * px) / nq; pos.q = nq; } else u.p.push({ s: p.key, q: qty, c: px });
    } else {
      if (!pos) return send(env, chat, esc(X.t("not_in_port", p.key)));
      pos.q -= qty;
      if (pos.q <= 1e-9) u.p = u.p.filter((x) => x !== pos);
    }
    await saveUser(env, chat.id, u);
    await send(env, chat, X.t(mode === "buy" ? "bought" : "sold", esc(p.key), X.fmt(qty, qty % 1 ? 4 : 0), X.price(px)));
  } else if (mode === "clear") {
    u.p = [];
    await saveUser(env, chat.id, u);
    return send(env, chat, X.t("port_cleared"));
  }
  const v = await portfolioView(env, u.p);
  if (!v.rows.length) return send(env, chat, X.t("port_empty"));
  const cur = (r) => (r.cur === "₽" ? "₽" : "$");
  const lines = v.rows.map((r) => `${arrow(r.pl)} <b>${esc(r.s)}</b> × ${X.fmt(r.q, r.q % 1 ? 4 : 0)}: ${r.val != null ? X.money(r.val, cur(r)) : "—"}` +
    (r.pl != null ? ` · ${r.pl >= 0 ? "+" : "−"}${X.money(Math.abs(r.pl), cur(r))} (${X.pct(r.plp, 1)})` : "") +
    "\n<i>" + X.t("port_row_sub", X.price(r.c), r.px != null ? X.price(r.px) : "—", X.pct(r.ch)) + "</i>");
  const mixed = new Set(v.rows.map(cur)).size > 1;
  const total = mixed ? "\n" + X.t("port_mixed") :
    "\n" + X.t("port_total", X.money(v.value, cur(v.rows[0])), X.pct(v.plp, 1), (v.pl < 0 ? "−" : "") + X.money(Math.abs(v.pl), cur(v.rows[0])), X.pct(v.dayp));
  return send(env, chat, X.t("port_head") + "\n\n" + lines.join("\n\n") + "\n" + total + "\n\n" + X.t("port_hint"),
    kb([[{ text: X.t("btn_refresh"), callback_data: "port" }, terminalBtn(env, chat, "PORT", X.t("btn_t_port"))]]));
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
export async function cmdAlert(env, chat, rest) {
  const X = L(chat.lang);
  if (!rest) return send(env, chat, X.t("alert_help"));
  const m = /^(?:del|delete|rm|удалить)\s+[#№]?(\d+)$/i.exec(rest.trim());
  if (m) {
    const ok = await deleteAlert(env, chat.id, m[1]);
    return send(env, chat, X.t(ok ? "alert_deleted" : "alert_no_such"));
  }
  const spec = parseAlert(rest);
  if (!spec) return send(env, chat, X.t("alert_bad"));
  try {
    const a = await addAlert(env, chat.id, spec, X.lang);
    return send(env, chat, X.t("alert_set", a.id, alertText(a, X.lang)));
  } catch (e) {
    return send(env, chat, esc(X.t("failed_short", e.message || e)));
  }
}

export async function cmdAlerts(env, chat) {
  const X = L(chat.lang);
  const list = await userAlerts(env, chat.id);
  if (!list.length) return send(env, chat, X.t("alert_none"));
  const plain = (a) => alertText(a, X.lang).replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").slice(0, 40);
  return send(env, chat, X.t("alerts_head") + "\n\n" + list.map((a) => `${X.t("a_num", a.id)} · ${alertText(a, X.lang)}`).join("\n"),
    kb(list.slice(0, 20).map((a) => [{ text: X.t("btn_alert_del", a.id, plain(a)), callback_data: "adel:" + a.id }])));
}

// ---------------------------------------------------------------------------
// Whole market: screener, map, earnings
// ---------------------------------------------------------------------------
export const EQS_PRESETS = {
  leaders: (a) => a.filter((r) => r.ch != null).sort((x, y) => y.ch - x.ch),
  losers: (a) => a.filter((r) => r.ch != null).sort((x, y) => x.ch - y.ch),
  value: (a) => a.filter((r) => r.pe > 0).sort((x, y) => x.pe - y.pe),
  div: (a) => a.filter((r) => r.dy > 0).sort((x, y) => y.dy - x.dy),
  growth: (a) => a.filter((r) => r.revg != null).sort((x, y) => y.revg - x.revg),
  big: (a) => a.filter((r) => r.mcap).sort((x, y) => y.mcap - x.mcap),
  year: (a) => a.filter((r) => r.r52 != null).sort((x, y) => y.r52 - x.r52),
  low52: (a) => a.filter((r) => r.px && r.l52).sort((x, y) => x.px / x.l52 - y.px / y.l52),
};
const EQS_ALIAS = { gainers: "leaders", top: "leaders", cheap: "value", pe: "value", dividends: "div", dividend: "div",
  largest: "big", biggest: "big", low: "low52", "лидеры": "leaders", "аутсайдеры": "losers", "дешевые": "value", "дешёвые": "value",
  "дивиденды": "div", "дивидендные": "div", "рост": "growth", "крупнейшие": "big", "год": "year", "минимум": "low52" };

export async function cmdEqs(env, chat, args) {
  const X = L(chat.lang);
  const names = X.t("eqs_presets");
  const a0 = (args[0] || "").toLowerCase();
  const key = EQS_PRESETS[a0] ? a0 : EQS_ALIAS[a0];
  if (!key) {
    const keys = Object.keys(EQS_PRESETS);
    return send(env, chat, X.t("eqs_choose"),
      kb([...Array(Math.ceil(keys.length / 2)).keys()].map((i) => keys.slice(i * 2, i * 2 + 2).map((k) => ({ text: names[k], callback_data: "eqs:" + k })))
        .concat([[terminalBtn(env, chat, "EQS", X.t("btn_eqs_filters"))]])));
  }
  const d = await pageJSON(env, "stocks.json", 120);
  const ex = X.t("eqs_row_extra");
  const rows = EQS_PRESETS[key](d.stocks || []).slice(0, 15);
  const lines = rows.map((r, i) => `${i + 1}. <b>${esc(r.s)}</b> ${esc(r.n)}: $${X.price(r.px)} ${X.pct(r.ch)}` +
    ` · ${ex.pe} ${X.fmt(r.pe, 1)}` + (r.dy ? ` · ${ex.div} ${X.fmt(r.dy, 1)}%` : "") + (key === "growth" ? ` · ${ex.rev} ${X.pct(r.revg, 0)}` : "") +
    (key === "year" ? ` · ${ex.year} ${X.pct(r.r52, 0)}` : "") + (key === "big" ? ` · ${X.money(r.mcap * 1e6)}` : ""));
  return send(env, chat, `🔎 <b>${names[key]}</b>\n\n` + (lines.join("\n") || X.t("nodata")) +
    X.t("eqs_updated", d.updated ? X.date(d.updated, { hour: "2-digit", minute: "2-digit" }) : "?"),
    kb([[{ text: X.t("btn_other_eqs"), callback_data: "eqs" }, terminalBtn(env, chat, "EQS", X.t("btn_t_eqs"))]]));
}

export async function cmdMap(env, chat) {
  const X = L(chat.lang);
  const d = await pageJSON(env, "stocks.json", 120);
  const sec = (d.sectors || []).filter((s) => s.ch != null).sort((a, b) => b.ch - a.ch);
  const rows = (d.stocks || []).filter((r) => r.ch != null);
  const top = [...rows].sort((a, b) => b.ch - a.ch).slice(0, 5), bot = [...rows].sort((a, b) => a.ch - b.ch).slice(0, 5);
  const bar = (c) => (c >= 0 ? "🟩" : "🟥").repeat(Math.min(5, Math.max(1, Math.round(Math.abs(c) / 0.5))));
  const out = X.t("map_head") + "\n\n" +
    sec.map((s) => `${bar(s.ch)} ${esc(sectorName(s.sec, X.lang))} ${X.pct(s.ch)}`).join("\n") +
    "\n\n" + X.t("map_up") + top.map((r) => `${esc(r.s)} ${X.pct(r.ch, 1)}`).join(", ") +
    "\n" + X.t("map_down") + bot.map((r) => `${esc(r.s)} ${X.pct(r.ch, 1)}`).join(", ");
  return send(env, chat, out, kb([[terminalBtn(env, chat, "IMAP", X.t("btn_t_map"))]]));
}

export async function cmdEarnings(env, chat) {
  const X = L(chat.lang);
  const d = await pageJSON(env, "stocks.json", 300);
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + 8 * 864e5).toISOString().slice(0, 10);
  const ev = (d.earnings || []).filter((e) => e.d >= today && e.d <= until);
  if (!ev.length) return send(env, chat, X.t("earn_none"));
  let last = "", out = X.t("earn_head");
  for (const e of ev.slice(0, 40)) {
    if (e.d !== last) {
      const day = new Date(e.d + "T12:00:00Z").toLocaleDateString(X.ru ? "ru-RU" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
      out += `\n\n<b>${esc(day)}</b>`;
      last = e.d;
    }
    out += `\n${e.h === "bmo" ? "☀️" : e.h === "amc" ? "🌙" : "▪️"} <b>${esc(e.s)}</b> ${esc(e.n)}` + (e.eps_e != null ? X.t("earn_eps", X.fmt(e.eps_e, 2)) : "");
  }
  return send(env, chat, out + "\n\n" + X.t("earn_legend"));
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------
function curvePoint(c, lbl) {
  const i = c.t.indexOf(lbl);
  return i < 0 ? null : { y: c.y[i], w: c.w ? c.w[i] : null };
}

const localName = (x, X) => (X.ru ? x.name_ru || x.name : x.name);

export async function cmdRates(env, chat) {
  const X = L(chat.lang);
  const d = await pageJSON(env, "rates.json", 600);
  const lines = [];
  for (const code of ["US", "DE", "UK", "JP", "RU"]) {
    const c = (d.curves || {})[code];
    if (!c) continue;
    const pts = ["2Y", "10Y", "30Y"].map((l) => [l, curvePoint(c, l)]).filter(([, p]) => p);
    const ten = curvePoint(c, "10Y"), two = curvePoint(c, "2Y");
    const parts = pts.map(([l, p]) => `${l} <b>${X.fmt(p.y, 2)}%</b>` + (p.w != null ? ` (${p.y - p.w >= 0 ? "+" : "−"}${Math.round(Math.abs(p.y - p.w) * 100)})` : ""));
    lines.push(`${c.flag} <b>${esc(localName(c, X))}</b> · ${X.dm(c.date)}\n${parts.join(" · ")}` +
      (ten && two ? "\n" + X.t("rates_spread", Math.round((ten.y - two.y) * 100), ten.y < two.y) : ""));
  }
  return send(env, chat, X.t("rates_head") + "\n\n" + (lines.join("\n\n") || X.t("rates_none")),
    kb([[terminalBtn(env, chat, "GC", X.t("btn_t_curves"))]]));
}

export async function cmdCb(env, chat) {
  const X = L(chat.lang);
  const d = await pageJSON(env, "rates.json", 600);
  const rows = (d.cb || []).map((c) => `${c.flag} ${esc(localName(c, X))}: <b>${c.lo != null ? X.fmt(c.lo, 2) + "–" + X.fmt(c.hi, 2) : X.fmt(c.rate, 2)}%</b>` +
    (c.prev != null ? X.t("cb_was", X.fmt(c.prev, 2), c.since ? X.dmy(c.since) : "") : ""));
  return send(env, chat, X.t("cb_head") + "\n\n" + (rows.join("\n") || X.t("rates_none")) + "\n\n" + X.t("cb_src"),
    kb([[terminalBtn(env, chat, "CB")]]));
}

export async function cmdWirp(env, chat) {
  const X = L(chat.lang);
  const d = await pageJSON(env, "rates.json", 600);
  const w = d.wirp;
  if (!w || !w.meetings || !w.meetings.length) return send(env, chat, X.t("wirp_none"));
  const pn = X.t("wirp_probs");
  const rows = w.meetings.map((m) => {
    const p = ["hike50", "hike", "hold", "cut", "cut50"].filter((k) => m[k]).map((k) => `${pn[k]}: ${m[k]}%`).join(", ");
    return X.t("wirp_row", X.dmy(m.date), X.fmt(m.after, 2), (m.cum_bp >= 0 ? "+" : "−") + X.fmt(Math.abs(m.cum_bp), 0)) + `\n<i>${p}</i>`;
  });
  return send(env, chat, X.t("wirp_head", X.fmt(w.lo, 2), X.fmt(w.hi, 2), X.fmt(w.effr, 2)) + rows.join("\n\n") + X.t("wirp_note"),
    kb([[terminalBtn(env, chat, "WIRP")]]));
}

// ---------------------------------------------------------------------------
// Command and button routing
// ---------------------------------------------------------------------------
export function newCommand(cmd, args, rest) {
  // returns a handler (env, chat) => Promise, or null if the command is not from this set
  switch (cmd) {
    case "q": case "quote": case "quotes": case "кот": return (env, chat) => cmdQuote(env, chat, args);
    case "des": case "d": case "company": case "компания": return (env, chat) => cmdDes(env, chat, args);
    case "fa": case "financials": return (env, chat) => cmdFa(env, chat, args);
    case "ern": return (env, chat) => cmdErn(env, chat, args);
    case "ee": case "estimates": case "прогнозы": return (env, chat) => cmdEe(env, chat, args);
    case "dvd": case "dividends": case "дивиденды": return (env, chat) => cmdDvd(env, chat, args);
    case "si": case "short": case "шорты": return (env, chat) => cmdSi(env, chat, args);
    case "cf": case "filings": return (env, chat) => cmdCf(env, chat, args);
    case "mgmt": case "management": case "руководство": return (env, chat) => cmdMgmt(env, chat, args);
    case "rv": case "peers": case "конкуренты": return (env, chat) => cmdRv(env, chat, args);
    case "omon": case "opt": case "options": case "опционы": return (env, chat) => cmdOmon(env, chat, args);
    case "macro": case "ecst": case "ecfc": case "макро": return (env, chat) => cmdMacro(env, chat, args);
    case "ipo": return (env, chat) => cmdIpo(env, chat);
    case "moex": case "мосбиржа": return (env, chat) => cmdMoex(env, chat);
    case "earnings": case "отчёты": case "отчеты": return (env, chat) => cmdEarnings(env, chat);
    case "anr": case "analysts": return (env, chat) => cmdAnr(env, chat, args);
    case "cn": return (env, chat) => cmdCn(env, chat, args);
    case "hds": case "insiders": return (env, chat) => cmdHds(env, chat, args);
    case "chart": case "gp": case "график": return (env, chat) => cmdChart(env, chat, args);
    case "watch": case "w": case "watchlist": case "список": return (env, chat) => cmdWatch(env, chat, args);
    case "unwatch": return (env, chat) => cmdWatch(env, chat, args, true);
    case "port": case "portfolio": case "портфель":
      if (args[0] === "clear") return (env, chat) => cmdPort(env, chat, [], "clear");
      if (args[0] === "add" || args[0] === "buy") return (env, chat) => cmdPort(env, chat, args.slice(1), "buy");
      if (args[0] === "del" || args[0] === "sell") return (env, chat) => cmdPort(env, chat, args.slice(1), "sell");
      return (env, chat) => cmdPort(env, chat, args);
    case "buy": return (env, chat) => cmdPort(env, chat, args, "buy");
    case "sell": return (env, chat) => cmdPort(env, chat, args, "sell");
    case "alert": case "alrt": case "алерт": return (env, chat) => cmdAlert(env, chat, rest);
    case "alerts": case "алерты": return (env, chat) => cmdAlerts(env, chat);
    case "eqs": case "screener": case "скринер": return (env, chat) => cmdEqs(env, chat, args);
    case "map": case "imap": case "карта": return (env, chat) => cmdMap(env, chat);
    case "rates": case "gc": case "curve": case "curves": case "кривые": return (env, chat) => cmdRates(env, chat);
    case "cb": case "ставки": return (env, chat) => cmdCb(env, chat);
    case "wirp": case "fedwatch": return (env, chat) => cmdWirp(env, chat);
    default: return null;
  }
}

export async function newCallback(data, chat, env) {
  const [k, a, b] = data.split(":");
  switch (k) {
    case "fa": return cmdFa(env, chat, [a]);
    case "ern": return cmdErn(env, chat, [a]);
    case "anr": return cmdAnr(env, chat, [a]);
    case "cn": return cmdCn(env, chat, [a]);
    case "ee": return cmdEe(env, chat, [a]);
    case "hds": return cmdHds(env, chat, [a]);
    case "dvd": return cmdDvd(env, chat, [a]);
    case "si": return cmdSi(env, chat, [a]);
    case "cf": return cmdCf(env, chat, [a]);
    case "rv": return cmdRv(env, chat, [a]);
    case "omon": return cmdOmon(env, chat, [a]);
    case "mgmt": return cmdMgmt(env, chat, [a]);
    case "chart": return cmdChart(env, chat, [a, b]);
    case "w+": return cmdWatch(env, chat, [a]);
    case "watch": return cmdWatch(env, chat, []);
    case "port": return cmdPort(env, chat, []);
    case "adel": {
      const X = L(chat.lang);
      const ok = await deleteAlert(env, chat.id, a);
      await send(env, chat, ok ? X.t("alert_del_n", a) : X.t("alert_gone"));
      return cmdAlerts(env, chat);
    }
    case "eqs": return cmdEqs(env, chat, a ? [a] : []);
    default: return null;
  }
}

// callback_data must be ≤ 64 bytes: tickers are short
export function isNewCallback(data) {
  return /^(fa|ern|anr|cn|ee|hds|dvd|si|cf|rv|omon|mgmt|chart|w\+|watch|port|adel|eqs)(:|$)/.test(data || "");
}
