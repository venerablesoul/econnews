// Новые команды бота: компании, котировки, графики, список, портфель, алерты, скринер, карта рынка, ставки.
import { arrow, dm, dmy, esc, fmt, money, msk, pageJSON, pagesUrl, pct, price, send, tg } from "./lib.js";
import { chartImage, getCompany, getHistory, getQuotes, normRange, parseSymbol } from "./market.js";
import {
  MAX_WATCH, addAlert, alertText, deleteAlert, getUser, parseAlert, portfolioView, saveUser, userAlerts,
} from "./user.js";

export const HELP_FULL = [
  "<b>Новости и рынки</b>",
  "/news — главное за сутки · /markets — рынки · /calendar — календарь",
  "/trades — сделки политиков США и инсайдеров",
  "",
  "<b>Компании и котировки</b>",
  "/q AAPL BTC нефть — котировки",
  "/des AAPL — карточка компании (DES)",
  "/fa AAPL — отчётность · /ern AAPL — отчёты и прогнозы",
  "/anr AAPL — рейтинги аналитиков · /cn AAPL — новости компании",
  "/hds AAPL — сделки инсайдеров",
  "/chart AAPL 1y — график (1m 3m 6m ytd 1y 2y 5y)",
  "",
  "<b>Личное</b> (общее с терминалом)",
  "/watch AAPL NVDA — добавить в список · /watch — список",
  "/unwatch AAPL — убрать из списка",
  "/buy AAPL 10 150 — купил 10 шт. по 150 · /sell AAPL 5",
  "/port — портфель с прибылью",
  "/alert AAPL > 200 · /alert BTC < 60000 · /alert нефть 5% · /alert новости ФРС",
  "/alerts — мои алерты",
  "",
  "<b>Рынок целиком</b>",
  "/map — секторы и лидеры дня · /eqs — скринер акций",
  "/earnings — отчёты компаний на неделе",
  "/rates — кривые доходности · /cb — ставки центробанков",
  "/wirp — ожидания по ставке ФРС",
  "",
  "/stop — отписаться",
].join("\n");

const terminalBtn = (env, chatType, cmd, text = "🖥 В терминале") => {
  const base = pagesUrl(env);
  if (!base.startsWith("https://")) return null;
  const url = base + "terminal/?cmd=" + encodeURIComponent(cmd);
  return chatType === "private" ? { text, web_app: { url } } : { text, url };
};

function kb(rows) {
  const r = rows.map((row) => row.filter(Boolean)).filter((row) => row.length);
  return r.length ? { inline_keyboard: r } : undefined;
}

function needSymbol(cmd) {
  return `Укажите тикер, например: /${cmd} AAPL`;
}

function rec(anr) {
  const r = anr && anr[0];
  if (!r) return null;
  const n = r.sb + r.b + r.h + r.s + r.ss;
  if (!n) return null;
  const score = (r.sb * 5 + r.b * 4 + r.h * 3 + r.s * 2 + r.ss) / n;
  const word = score >= 4.2 ? "активно покупать" : score >= 3.6 ? "покупать" : score >= 2.8 ? "держать" : score >= 2.2 ? "продавать" : "активно продавать";
  return { n, buy: r.sb + r.b, hold: r.h, sell: r.s + r.ss, score, word, period: r.period };
}

// ---------------------------------------------------------------------------
// Котировки
// ---------------------------------------------------------------------------
export async function cmdQuote(env, chat, args) {
  if (!args.length) return send(env, chat, "Напишите тикеры через пробел: /q AAPL MSFT BTC нефть золото SBER");
  const q = await getQuotes(env, args);
  const lines = args.map((a) => {
    const p = parseSymbol(a);
    const x = p && q[p.key];
    if (!x || x.px == null) return `⚪ ${esc(a)}: нет данных`;
    const cur = x.cur === "$" ? "$" : x.cur === "₽" ? " ₽" : "";
    return `${arrow(x.ch)} <b>${esc(x.key)}</b> ${x.name && x.name !== x.key ? "<i>" + esc(x.name) + "</i> " : ""}` +
      `${cur === "$" ? "$" : ""}${price(x.px)}${cur === " ₽" ? " ₽" : ""} ${pct(x.ch)}`;
  });
  return send(env, chat, "📈 <b>Котировки</b> <i>(изменение за день)</i>\n\n" + lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Компания
// ---------------------------------------------------------------------------
function companyButtons(env, chat, s) {
  return kb([
    [{ text: "FA отчётность", callback_data: "fa:" + s }, { text: "ERN отчёты", callback_data: "ern:" + s }, { text: "ANR аналитики", callback_data: "anr:" + s }],
    [{ text: "CN новости", callback_data: "cn:" + s }, { text: "📈 График 1г", callback_data: "chart:" + s + ":1y" }, { text: "⭐ В список", callback_data: "w+:" + s }],
    [terminalBtn(env, chat.type, s + " DES")],
  ]);
}

export async function cmdDes(env, chat, args) {
  if (!args[0]) return send(env, chat, needSymbol("des"));
  const c = await getCompany(env, args[0], ["des"]);
  const p = c.profile || {}, q = c.quote || {}, m = c.m || {};
  if (c.kind === "moex") {
    const t = [`🏢 <b>${esc(p.name)}</b> · ${esc(c.s)}`, `${esc(p.type || "")} · Мосбиржа · ISIN ${esc(p.isin || "—")}`,
      q.px != null ? `\nЦена: <b>${price(q.px)} ₽</b> ${pct(q.ch)} за день` : "", p.lot ? `Лот: ${p.lot} шт.` : "",
      p.issue ? `Выпуск: ${fmt(p.issue, 0)} шт.` : "", p.list ? `Уровень листинга: ${p.list}` : ""].filter(Boolean).join("\n");
    return send(env, chat, t, kb([[{ text: "📈 График 1г", callback_data: "chart:" + c.s + ":1y" }, { text: "⭐ В список", callback_data: "w+:" + c.s }], [terminalBtn(env, chat.type, c.s + " DES")]]));
  }
  const r = rec(c.anr);
  const lines = [
    `🏢 <b>${esc(p.name || c.s)}</b> · ${esc(c.s)}`,
    [p.ind, p.exch && p.exch.replace(/ - .*$/, ""), p.country].filter(Boolean).map(esc).join(" · "),
    "",
    q.px != null ? `Цена: <b>$${price(q.px)}</b> ${pct(q.ch)} за день` : "",
    m.h52 ? `52 недели: $${price(m.l52)} – $${price(m.h52)} · с начала года ${pct(m.rytd)}, за год ${pct(m.r52)}` : "",
    `Капитализация: <b>${money((m.mcap || p.mcap) * 1e6)}</b>`,
    `P/E: ${fmt(m.pe, 1)} · форвард ${fmt(m.fpe, 1)} · P/S ${fmt(m.ps, 1)} · P/B ${fmt(m.pb, 1)}`,
    `Дивиденды: ${m.dy ? fmt(m.dy, 2) + "% ($" + fmt(m.div, 2) + " в год)" : "нет"} · бета ${fmt(m.beta, 2)}`,
    `Рентабельность: валовая ${fmt(m.gm, 1)}%, операц. ${fmt(m.om, 1)}%, чистая ${fmt(m.nm, 1)}% · ROE ${fmt(m.roe, 0)}%`,
    `Рост за год: выручка ${pct(m.revg, 1)}, прибыль на акцию ${pct(m.epsg, 1)}`,
    r ? `Аналитики (${r.n}): <b>${r.word}</b> — купить ${r.buy}, держать ${r.hold}, продать ${r.sell}` : "",
    c.next ? `Следующий отчёт: <b>${dmy(c.next.date)}</b>${c.next.hour === "bmo" ? " до открытия" : c.next.hour === "amc" ? " после закрытия" : ""}` +
      (c.next.eps_e != null ? ` · прогноз EPS $${fmt(c.next.eps_e, 2)}` : "") : "",
    c.peers && c.peers.length ? `Похожие: ${c.peers.slice(0, 6).map(esc).join(", ")}` : "",
    p.web ? `<a href="${esc(p.web)}">${esc(p.web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>` : "",
  ].filter((x, i, a) => x !== "" || (i > 0 && a[i - 1] !== ""));
  return send(env, chat, lines.join("\n"), companyButtons(env, chat, c.s));
}

function faRows(c) {
  if (c.fin && c.fin.quarterly && c.fin.quarterly.length) return { src: "sec", q: c.fin.quarterly, a: c.fin.annual || [] };
  return { src: "fh", q: (c.faSeries && c.faSeries.quarterly) || [], a: (c.faSeries && c.faSeries.annual) || [] };
}

export async function cmdFa(env, chat, args) {
  if (!args[0]) return send(env, chat, needSymbol("fa"));
  const c = await getCompany(env, args[0], ["fa"]);
  const p = c.profile || {};
  const f = faRows(c);
  let out = `📑 <b>Отчётность ${esc(p.name || c.s)}</b> (${esc(c.s)})\n`;
  if (f.src === "sec") {
    const row = (r) => `<b>${dmy(r.end)}</b>: выручка ${money(r.rev)}, чистая прибыль ${money(r.ni)}` +
      (r.eps != null ? `, EPS $${fmt(r.eps, 2)}` : "") + (r.fcf != null ? `, своб. ден. поток ${money(r.fcf)}` : "");
    out += "<i>по данным отчётов в SEC</i>\n\n<b>Кварталы</b>\n" + f.q.slice(0, 6).map(row).join("\n");
    if (f.a.length) out += "\n\n<b>Годы</b>\n" + f.a.slice(0, 4).map(row).join("\n");
    const last = f.a[0] || f.q[0];
    if (last && (last.cash != null || last.debt != null)) out += `\n\nДенежные средства ${money(last.cash)} · долг ${money(last.debt)} · капитал ${money(last.eq)}`;
  } else if (f.q.length || f.a.length) {
    const row = (r) => `<b>${dmy(r.end)}</b>: EPS $${fmt(r.eps, 2)}, выручка на акцию $${fmt(r.salesPerShare, 2)}, маржа: валовая ${fmt(r.grossMargin * 100, 1)}%, чистая ${fmt(r.netMargin * 100, 1)}%`;
    out += "<i>показатели на акцию (Finnhub)</i>\n\n<b>Кварталы</b>\n" + f.q.slice(0, 6).map(row).join("\n");
    if (f.a.length) out += "\n\n<b>Годы</b>\n" + f.a.slice(0, 4).map(row).join("\n");
  } else out += "\nОтчётность не найдена.";
  return send(env, chat, out, kb([[terminalBtn(env, chat.type, c.s + " FA", "🖥 FA в терминале")]]));
}

export async function cmdErn(env, chat, args) {
  if (!args[0]) return cmdEarnings(env, chat);
  const c = await getCompany(env, args[0], ["ern"]);
  let out = `📊 <b>Отчёты ${esc(c.s)}</b>\n`;
  if (c.next) {
    out += `\nСледующий: <b>${dmy(c.next.date)}</b>${c.next.hour === "bmo" ? " до открытия рынка" : c.next.hour === "amc" ? " после закрытия" : ""}` +
      ` · Q${c.next.q} ${c.next.y}\nПрогноз: EPS $${fmt(c.next.eps_e, 2)}, выручка ${money(c.next.rev_e)}\n`;
  }
  const rows = (c.ern || []).slice(0, 8).map((e) => {
    const beat = e.act != null && e.est != null ? (e.act >= e.est ? "✅" : "❌") : "⚪";
    return `${beat} Q${e.q} ${e.y}: факт $${fmt(e.act, 2)} · прогноз $${fmt(e.est, 2)} · ${pct(e.sp, 1)}`;
  });
  out += rows.length ? "\n<b>Прибыль на акцию: факт против прогноза</b>\n" + rows.join("\n") : "\nИстории отчётов нет.";
  return send(env, chat, out, kb([[terminalBtn(env, chat.type, c.s + " ERN", "🖥 ERN в терминале")]]));
}

export async function cmdAnr(env, chat, args) {
  if (!args[0]) return send(env, chat, needSymbol("anr"));
  const c = await getCompany(env, args[0], ["anr"]);
  const r = rec(c.anr);
  if (!r) return send(env, chat, "Рейтингов аналитиков по " + esc(c.s) + " нет.");
  const bar = (n) => "█".repeat(Math.round(n / r.n * 20));
  const x = c.anr[0];
  let out = `🎯 <b>Аналитики о ${esc(c.s)}</b> · ${esc(x.period.slice(0, 7))}\nКонсенсус: <b>${r.word}</b> (${fmt(r.score, 1)} из 5, ${r.n} аналитиков)\n\n` +
    `<code>Активно покупать ${String(x.sb).padStart(3)} ${bar(x.sb)}\nПокупать         ${String(x.b).padStart(3)} ${bar(x.b)}\n` +
    `Держать          ${String(x.h).padStart(3)} ${bar(x.h)}\nПродавать        ${String(x.s).padStart(3)} ${bar(x.s)}\n` +
    `Активно продав.  ${String(x.ss).padStart(3)} ${bar(x.ss)}</code>`;
  if (c.anr.length > 1) {
    const old = c.anr[c.anr.length - 1], on = old.sb + old.b + old.h + old.s + old.ss;
    if (on) out += `\n\n${old.period.slice(0, 7)}: купить ${old.sb + old.b}, держать ${old.h}, продать ${old.s + old.ss}`;
  }
  return send(env, chat, out, kb([[terminalBtn(env, chat.type, c.s + " ANR", "🖥 ANR в терминале")]]));
}

export async function cmdCn(env, chat, args) {
  if (!args[0]) return send(env, chat, needSymbol("cn"));
  const c = await getCompany(env, args[0], ["cn"]);
  const items = (c.cn || []).slice(0, 8);
  if (!items.length) return send(env, chat, "Свежих новостей по " + esc(c.s) + " нет.");
  const out = items.map((n) => `▪️ <b>${esc(n.h)}</b>\n<i>${esc(n.src)} · ${msk(n.t * 1000, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</i>` +
    (/^https?:\/\//.test(n.url || "") ? ` · <a href="${esc(n.url)}">читать →</a>` : ""));
  return send(env, chat, `📰 <b>Новости ${esc(c.s)}</b>\n\n` + out.join("\n\n"), kb([[terminalBtn(env, chat.type, c.s + " CN", "🖥 CN в терминале")]]));
}

export async function cmdHds(env, chat, args) {
  if (!args[0]) return send(env, chat, needSymbol("hds"));
  const c = await getCompany(env, args[0], ["hds"]);
  const rows = (c.ins || []).slice(0, 10).map((t) => `${t.code === "P" ? "🟢 покупка" : "🔴 продажа"} ${fmt(Math.abs(t.ch), 0)} акций` +
    (t.px ? ` по $${fmt(t.px, 2)} (${money(Math.abs(t.ch) * t.px)})` : "") + `\n<i>${esc(t.name)} · ${dmy(t.date)}</i>`);
  return send(env, chat, `💼 <b>Сделки инсайдеров ${esc(c.s)}</b>\n<i>крупнейшие держатели (фонды) — только в платных источниках; здесь — сделки руководства из формы 4 SEC</i>\n\n` +
    (rows.join("\n\n") || "Сделок на открытом рынке за последнее время нет."));
}

// ---------------------------------------------------------------------------
// График картинкой
// ---------------------------------------------------------------------------
export async function cmdChart(env, chat, args) {
  if (!args[0]) return send(env, chat, "Например: /chart AAPL 1y · /chart BTC 3m · /chart нефть 6m · /chart SBER 1y");
  const range = normRange(args[1] || "1y");
  const h = await getHistory(env, args[0], range);
  const n = h.c.length;
  const ch = (h.c[n - 1] / h.c[0] - 1) * 100;
  const ranges = { "1m": "1 мес.", "3m": "3 мес.", "6m": "6 мес.", ytd: "с начала года", "1y": "1 год", "2y": "2 года", "5y": "5 лет" };
  const caption = `📈 <b>${esc(h.s)}</b> ${esc(h.name && h.name !== h.s ? h.name : "")}\n${ranges[range]}: ${pct(ch)} · сейчас ${price(h.c[n - 1])}` +
    ` · мин. ${price(Math.min(...h.l.filter((x) => x != null)))} · макс. ${price(Math.max(...h.h.filter((x) => x != null)))}`;
  const buttons = kb([["1m", "6m", "1y", "5y"].map((r) => ({ text: r === range ? "• " + r + " •" : r, callback_data: "chart:" + h.s + ":" + r })),
    [terminalBtn(env, chat.type, h.s + " GP", "🖥 Открыть в терминале")]]);
  try {
    const url = await chartImage(h, `${h.s} · ${ranges[range]} · ${pct(ch)}`);
    const r = await tg(env, "sendPhoto", { chat_id: chat.id, photo: url, caption, parse_mode: "HTML", reply_markup: buttons });
    if (r.ok) return r;
  } catch (e) { /* без картинки — текстом */ }
  return send(env, chat, caption, buttons);
}

// ---------------------------------------------------------------------------
// Список наблюдения
// ---------------------------------------------------------------------------
export async function cmdWatch(env, chat, args, remove = false) {
  const u = await getUser(env, chat.id);
  if (args.length) {
    const keys = args.map((a) => parseSymbol(a)).filter(Boolean).map((p) => p.key);
    const bad = args.filter((a) => !parseSymbol(a));
    if (remove) u.w = u.w.filter((s) => !keys.includes(s));
    else for (const k of keys) if (!u.w.includes(k)) u.w.push(k);
    const saved = await saveUser(env, chat.id, u);
    const note = (remove ? "Убрал: " : "Добавил: ") + (keys.join(", ") || "—") + (bad.length ? `\nНе понял: ${bad.map(esc).join(", ")}` : "") +
      (saved.w.length >= MAX_WATCH ? `\nВ списке максимум ${MAX_WATCH} инструментов.` : "");
    await send(env, chat, esc(note));
    return watchView(env, chat, saved.w);
  }
  return watchView(env, chat, u.w);
}

async function watchView(env, chat, w) {
  if (!w.length) return send(env, chat, "⭐ Список наблюдения пуст.\nДобавить: /watch AAPL NVDA BTC нефть SBER");
  const q = await getQuotes(env, w);
  const lines = w.map((s) => {
    const x = q[s];
    return x && x.px != null ? `${arrow(x.ch)} <b>${esc(s)}</b> ${price(x.px)}${x.cur === "₽" ? " ₽" : ""} ${pct(x.ch)}` : `⚪ <b>${esc(s)}</b> —`;
  });
  return send(env, chat, "⭐ <b>Мой список</b> <i>(изменение за день)</i>\n\n" + lines.join("\n") + "\n\nУбрать: /unwatch ТИКЕР",
    kb([[{ text: "🔄 Обновить", callback_data: "watch" }, terminalBtn(env, chat.type, "W", "🖥 Список в терминале")]]));
}

// ---------------------------------------------------------------------------
// Портфель
// ---------------------------------------------------------------------------
export async function cmdPort(env, chat, args, mode) {
  const u = await getUser(env, chat.id);
  if (mode === "buy" || mode === "sell") {
    const p = parseSymbol(args[0]);
    const qty = Number(String(args[1] || "").replace(",", "."));
    let px = args[2] != null ? Number(String(args[2]).replace(",", ".")) : null;
    if (!p || !isFinite(qty) || qty <= 0) {
      return send(env, chat, mode === "buy" ? "Например: /buy AAPL 10 150 — 10 акций по $150 (без цены — по текущей)" : "Например: /sell AAPL 5");
    }
    if (px == null || !isFinite(px)) {
      const q = (await getQuotes(env, [p.key]))[p.key];
      if (!q || q.px == null) return send(env, chat, "Не удалось получить цену " + esc(p.key) + " — укажите её: /" + mode + " " + esc(p.key) + " " + qty + " ЦЕНА");
      px = q.px;
    }
    const pos = u.p.find((x) => x.s === p.key);
    if (mode === "buy") {
      if (pos) { const nq = pos.q + qty; pos.c = (pos.q * pos.c + qty * px) / nq; pos.q = nq; } else u.p.push({ s: p.key, q: qty, c: px });
    } else {
      if (!pos) return send(env, chat, "В портфеле нет " + esc(p.key));
      pos.q -= qty;
      if (pos.q <= 1e-9) u.p = u.p.filter((x) => x !== pos);
    }
    await saveUser(env, chat.id, u);
    await send(env, chat, `${mode === "buy" ? "🟢 Куплено" : "🔴 Продано"}: ${esc(p.key)} × ${fmt(qty, qty % 1 ? 4 : 0)} по ${price(px)}`);
  } else if (mode === "clear") {
    u.p = [];
    await saveUser(env, chat.id, u);
    return send(env, chat, "Портфель очищен.");
  }
  const v = await portfolioView(env, u.p);
  if (!v.rows.length) return send(env, chat, "💼 Портфель пуст.\nДобавить позицию: /buy AAPL 10 150 (тикер, количество, цена покупки)");
  const lines = v.rows.map((r) => `${arrow(r.pl)} <b>${esc(r.s)}</b> × ${fmt(r.q, r.q % 1 ? 4 : 0)}: ${r.val != null ? money(r.val, r.cur === "₽" ? "₽" : "$") : "—"}` +
    (r.pl != null ? ` · ${r.pl >= 0 ? "+" : "−"}${money(Math.abs(r.pl), r.cur === "₽" ? "₽" : "$").replace(/^−/, "")} (${pct(r.plp, 1)})` : "") +
    `\n<i>куплено по ${price(r.c)}, сейчас ${price(r.px)} (${pct(r.ch)} за день)</i>`);
  const mixed = new Set(v.rows.map((r) => r.cur === "₽" ? "₽" : "$")).size > 1;
  const total = mixed ? "\n<i>в портфеле рубли и доллары — общий итог не считаю</i>" :
    `\n<b>Итого: ${money(v.value)}</b> · прибыль ${pct(v.plp, 1)} (${money(v.pl)}) · за день ${pct(v.dayp)}`;
  return send(env, chat, "💼 <b>Портфель</b>\n\n" + lines.join("\n\n") + "\n" + total + "\n\nКупить: /buy ТИКЕР КОЛ-ВО ЦЕНА · продать: /sell ТИКЕР КОЛ-ВО",
    kb([[{ text: "🔄 Обновить", callback_data: "port" }, terminalBtn(env, chat.type, "PORT", "🖥 Портфель в терминале")]]));
}

// ---------------------------------------------------------------------------
// Алерты
// ---------------------------------------------------------------------------
export async function cmdAlert(env, chat, rest) {
  if (!rest) return send(env, chat, "🔔 <b>Алерты</b> — бот пришлёт сообщение, когда условие выполнится (проверка каждые 2 минуты).\n\n" +
    "/alert AAPL > 200 — цена выше\n/alert BTC < 60000 — цена ниже\n/alert нефть 5% — изменение за день больше 5%\n" +
    "/alert новости ФРС — новость с этим словом\n\n/alerts — мои алерты");
  const m = /^(?:del|удалить|delete|rm)\s+(\d+)$/i.exec(rest.trim());
  if (m) {
    const ok = await deleteAlert(env, chat.id, m[1]);
    return send(env, chat, ok ? "Алерт удалён." : "Нет такого алерта. Список: /alerts");
  }
  const spec = parseAlert(rest);
  if (!spec) return send(env, chat, "Не понял. Примеры: /alert AAPL > 200 · /alert BTC < 60000 · /alert нефть 5% · /alert новости ФРС");
  try {
    const a = await addAlert(env, chat.id, spec);
    return send(env, chat, "✅ Алерт №" + a.id + ": " + alertText(a) + "\nСписок: /alerts");
  } catch (e) {
    return send(env, chat, "Не получилось: " + esc(e.message || e));
  }
}

export async function cmdAlerts(env, chat) {
  const list = await userAlerts(env, chat.id);
  if (!list.length) return send(env, chat, "🔔 Алертов нет. Поставить: /alert AAPL > 200");
  return send(env, chat, "🔔 <b>Мои алерты</b>\n\n" + list.map((a) => `№${a.id} · ${alertText(a)}`).join("\n"),
    kb(list.slice(0, 20).map((a) => [{ text: "✕ удалить №" + a.id + " · " + alertText(a).replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").slice(0, 40), callback_data: "adel:" + a.id }])));
}

// ---------------------------------------------------------------------------
// Рынок целиком: скринер, карта, отчёты
// ---------------------------------------------------------------------------
export const EQS_PRESETS = {
  leaders: ["🚀 Лидеры дня", (a) => a.filter((r) => r.ch != null).sort((x, y) => y.ch - x.ch)],
  losers: ["📉 Аутсайдеры дня", (a) => a.filter((r) => r.ch != null).sort((x, y) => x.ch - y.ch)],
  value: ["💰 Дешёвые по P/E", (a) => a.filter((r) => r.pe > 0).sort((x, y) => x.pe - y.pe)],
  div: ["🏦 Дивидендные", (a) => a.filter((r) => r.dy > 0).sort((x, y) => y.dy - x.dy)],
  growth: ["📈 Быстрый рост выручки", (a) => a.filter((r) => r.revg != null).sort((x, y) => y.revg - x.revg)],
  big: ["🏛 Крупнейшие", (a) => a.filter((r) => r.mcap).sort((x, y) => y.mcap - x.mcap)],
  year: ["🏆 Лучшие за год", (a) => a.filter((r) => r.r52 != null).sort((x, y) => y.r52 - x.r52)],
  low52: ["🧊 У минимума за год", (a) => a.filter((r) => r.px && r.l52).sort((x, y) => x.px / x.l52 - y.px / y.l52)],
};
const EQS_ALIAS = { "лидеры": "leaders", "аутсайдеры": "losers", "дешевые": "value", "дешёвые": "value", "дивиденды": "div",
  "дивидендные": "div", "рост": "growth", "крупнейшие": "big", "год": "year", "минимум": "low52" };

export async function cmdEqs(env, chat, args) {
  const key = EQS_PRESETS[args[0]] ? args[0] : EQS_ALIAS[(args[0] || "").toLowerCase()];
  if (!key) {
    const keys = Object.keys(EQS_PRESETS);
    return send(env, chat, "🔎 <b>Скринер акций США</b> (≈110 крупнейших компаний)\nВыберите отбор:",
      kb([...Array(Math.ceil(keys.length / 2)).keys()].map((i) => keys.slice(i * 2, i * 2 + 2).map((k) => ({ text: EQS_PRESETS[k][0], callback_data: "eqs:" + k })))
        .concat([[terminalBtn(env, chat.type, "EQS", "🖥 Скринер с фильтрами")]])));
  }
  const d = await pageJSON(env, "stocks.json", 120);
  const rows = EQS_PRESETS[key][1](d.stocks || []).slice(0, 15);
  const lines = rows.map((r, i) => `${i + 1}. <b>${esc(r.s)}</b> ${esc(r.n)}: $${price(r.px)} ${pct(r.ch)}` +
    ` · P/E ${fmt(r.pe, 1)}` + (r.dy ? ` · див. ${fmt(r.dy, 1)}%` : "") + (key === "growth" ? ` · выручка ${pct(r.revg, 0)}` : "") +
    (key === "year" ? ` · за год ${pct(r.r52, 0)}` : "") + (key === "big" ? ` · ${money(r.mcap * 1e6)}` : ""));
  return send(env, chat, `🔎 <b>${EQS_PRESETS[key][0]}</b>\n\n` + (lines.join("\n") || "Нет данных") +
    `\n\n<i>обновлено ${d.updated ? msk(d.updated, { hour: "2-digit", minute: "2-digit" }) : "?"} МСК</i>`,
    kb([[{ text: "← Другие отборы", callback_data: "eqs" }, terminalBtn(env, chat.type, "EQS", "🖥 Скринер в терминале")]]));
}

export async function cmdMap(env, chat) {
  const d = await pageJSON(env, "stocks.json", 120);
  const sec = (d.sectors || []).filter((s) => s.ch != null).sort((a, b) => b.ch - a.ch);
  const rows = (d.stocks || []).filter((r) => r.ch != null);
  const top = [...rows].sort((a, b) => b.ch - a.ch).slice(0, 5), bot = [...rows].sort((a, b) => a.ch - b.ch).slice(0, 5);
  const bar = (c) => (c >= 0 ? "🟩" : "🟥").repeat(Math.min(5, Math.max(1, Math.round(Math.abs(c) / 0.5))));
  const out = "🗺 <b>Акции США: секторы за день</b>\n<i>взвешено по капитализации</i>\n\n" +
    sec.map((s) => `${bar(s.ch)} ${esc(s.sec)} ${pct(s.ch)}`).join("\n") +
    "\n\n🚀 <b>Лидеры:</b> " + top.map((r) => `${esc(r.s)} ${pct(r.ch, 1)}`).join(", ") +
    "\n📉 <b>Аутсайдеры:</b> " + bot.map((r) => `${esc(r.s)} ${pct(r.ch, 1)}`).join(", ");
  return send(env, chat, out, kb([[terminalBtn(env, chat.type, "IMAP", "🖥 Тепловая карта")]]));
}

export async function cmdEarnings(env, chat) {
  const d = await pageJSON(env, "stocks.json", 300);
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + 8 * 864e5).toISOString().slice(0, 10);
  const ev = (d.earnings || []).filter((e) => e.d >= today && e.d <= until);
  if (!ev.length) return send(env, chat, "📊 В ближайшую неделю отчётов крупнейших компаний США нет.");
  let last = "", out = "📊 <b>Отчёты крупнейших компаний США</b>";
  for (const e of ev.slice(0, 40)) {
    if (e.d !== last) { out += `\n\n<b>${esc(new Date(e.d + "T12:00:00Z").toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }))}</b>`; last = e.d; }
    out += `\n${e.h === "bmo" ? "☀️" : e.h === "amc" ? "🌙" : "▪️"} <b>${esc(e.s)}</b> ${esc(e.n)}` + (e.eps_e != null ? ` · EPS прогноз $${fmt(e.eps_e, 2)}` : "");
  }
  return send(env, chat, out + "\n\n☀️ до открытия · 🌙 после закрытия\nПодробнее: /ern ТИКЕР");
}

// ---------------------------------------------------------------------------
// Ставки
// ---------------------------------------------------------------------------
function curvePoint(c, lbl) {
  const i = c.t.indexOf(lbl);
  return i < 0 ? null : { y: c.y[i], w: c.w ? c.w[i] : null };
}

export async function cmdRates(env, chat) {
  const d = await pageJSON(env, "rates.json", 600);
  const lines = [];
  for (const code of ["US", "DE", "UK", "JP", "RU"]) {
    const c = (d.curves || {})[code];
    if (!c) continue;
    const pts = ["2Y", "10Y", "30Y"].map((l) => [l, curvePoint(c, l)]).filter(([, p]) => p);
    const ten = curvePoint(c, "10Y"), two = curvePoint(c, "2Y");
    const parts = pts.map(([l, p]) => `${l} <b>${fmt(p.y, 2)}%</b>` + (p.w != null ? ` (${p.y - p.w >= 0 ? "+" : "−"}${Math.round(Math.abs(p.y - p.w) * 100)})` : ""));
    lines.push(`${c.flag} <b>${esc(c.name)}</b> · ${dm(c.date)}\n${parts.join(" · ")}` +
      (ten && two ? `\n<i>спред 10Y−2Y: ${Math.round((ten.y - two.y) * 100)} б.п.${ten.y < two.y ? " — инверсия" : ""}</i>` : ""));
  }
  return send(env, chat, "📐 <b>Доходности гособлигаций</b>\n<i>в скобках — изменение за неделю, б.п.</i>\n\n" + (lines.join("\n\n") || "Данных пока нет."),
    kb([[terminalBtn(env, chat.type, "GC", "🖥 Кривые в терминале")]]));
}

export async function cmdCb(env, chat) {
  const d = await pageJSON(env, "rates.json", 600);
  const rows = (d.cb || []).map((c) => `${c.flag} ${esc(c.name)}: <b>${c.lo != null ? fmt(c.lo, 2) + "–" + fmt(c.hi, 2) : fmt(c.rate, 2)}%</b>` +
    (c.prev != null ? ` <i>(было ${fmt(c.prev, 2)}%${c.since ? ", с " + dmy(c.since) : ""})</i>` : ""));
  return send(env, chat, "🏦 <b>Ставки центробанков</b>\n\n" + (rows.join("\n") || "Данных пока нет.") + "\n\n<i>Источники: BIS, ФРБ Нью-Йорка, ЦБ РФ</i>",
    kb([[terminalBtn(env, chat.type, "CB", "🖥 В терминале")]]));
}

export async function cmdWirp(env, chat) {
  const d = await pageJSON(env, "rates.json", 600);
  const w = d.wirp;
  if (!w || !w.meetings || !w.meetings.length) return send(env, chat, "Ожиданий по ставке ФРС пока нет — данные появятся после следующего обновления.");
  const rows = w.meetings.map((m) => {
    const p = [m.hike50 ? `повышение на 0,5: ${m.hike50}%` : "", m.hike ? `повышение: ${m.hike}%` : "", m.hold ? `без изменений: ${m.hold}%` : "",
      m.cut ? `снижение: ${m.cut}%` : "", m.cut50 ? `снижение на 0,5: ${m.cut50}%` : ""].filter(Boolean).join(", ");
    return `<b>${dmy(m.date)}</b>: ожидаемая ставка ${fmt(m.after, 2)}% (${m.cum_bp >= 0 ? "+" : "−"}${fmt(Math.abs(m.cum_bp), 0)} б.п. к текущей)\n<i>${p}</i>`;
  });
  return send(env, chat, `🏛 <b>Ожидания по ставке ФРС</b> (WIRP)\nСейчас: ${fmt(w.lo, 2)}–${fmt(w.hi, 2)}%, эффективная ${fmt(w.effr, 2)}%\n\n` + rows.join("\n\n") +
    "\n\n<i>Рассчитано по фьючерсам на ставку по федеральным фондам (как CME FedWatch)</i>", kb([[terminalBtn(env, chat.type, "WIRP", "🖥 В терминале")]]));
}

// ---------------------------------------------------------------------------
// Разбор команд и кнопок
// ---------------------------------------------------------------------------
export function newCommand(cmd, args, rest) {
  // возвращает обработчик (env, chat) => Promise или null, если команда не из этого набора
  switch (cmd) {
    case "q": case "quote": case "кот": return (env, chat) => cmdQuote(env, chat, args);
    case "des": case "d": case "company": case "компания": return (env, chat) => cmdDes(env, chat, args);
    case "fa": return (env, chat) => cmdFa(env, chat, args);
    case "ern": case "ee": return (env, chat) => cmdErn(env, chat, args);
    case "earnings": case "отчёты": case "отчеты": return (env, chat) => cmdEarnings(env, chat);
    case "anr": return (env, chat) => cmdAnr(env, chat, args);
    case "cn": return (env, chat) => cmdCn(env, chat, args);
    case "hds": case "insiders": return (env, chat) => cmdHds(env, chat, args);
    case "chart": case "gp": case "график": return (env, chat) => cmdChart(env, chat, args);
    case "watch": case "w": case "список": return (env, chat) => cmdWatch(env, chat, args);
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
    case "rates": case "gc": case "curve": case "кривые": return (env, chat) => cmdRates(env, chat);
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
    case "chart": return cmdChart(env, chat, [a, b]);
    case "w+": return cmdWatch(env, chat, [a]);
    case "watch": return cmdWatch(env, chat, []);
    case "port": return cmdPort(env, chat, []);
    case "adel": { const ok = await deleteAlert(env, chat.id, a); await send(env, chat, ok ? "Алерт №" + a + " удалён." : "Этого алерта уже нет."); return cmdAlerts(env, chat); }
    case "eqs": return cmdEqs(env, chat, a ? [a] : []);
    default: return null;
  }
}

// для callback_data длиной ≤ 64 байт: тикеры у нас короткие, но на всякий случай
export function isNewCallback(data) {
  return /^(fa|ern|anr|cn|chart|w\+|watch|port|adel|eqs)(:|$)/.test(data || "");
}
