/*
 * Interfaz de «Planear»: calendario predictivo, simulador de compras en chat y reporte semanal.
 * Los cálculos viven en forecast.js, nlu.js y report.js; aquí solo se pinta y se atienden eventos.
 */
import * as U from './util.js';
import * as store from './store.js';
import * as F from './forecast.js';
import * as charts from './charts.js';
import * as push from './push.js';
import {parse} from './nlu.js';
import {weeklyReport, lastClosedWeek} from './report.js';
import {ico} from './icons.js';

const {esc, catOf} = U;
const $ = (s, r) => (r || document).querySelector(s);
let api; // lo que presta app.js: money, compact, today, view, viewKey, toast, openTx, openRec, openDlg, closeDlg, txRow, render…
const money = c => api.money(c);
const dS = s => U.fmtDate(s).replace(/ \d{4}$/, '');                  // «28 nov»
const dL = s => U.fmtDay(s, api.today());                              // «Hoy», «Viernes 15 de noviembre»
const pct = v => Math.round(v * 100) + '%';
const names = (list, max = 3) => { const n = [...new Set(list.map(e => e.name || catOf(e.category).name))]; return esc(n.slice(0, max).join(', ')) + (n.length > max ? ' y ' + (n.length - max) + ' más' : ''); };
const KIND = {fijo:'Fijo', mov:'Programado', estimado:'Ingreso estimado', sim:'Simulación'};

/* ---------- Datos y proyección (se recalculan solo cuando cambian los datos o el día) ---------- */
let cache = null;
function data(){
  const v = store.getVersion(), t = api.today();
  if (!cache || cache.v !== v || cache.t !== t){
    const ctx = {opening:store.settings().opening_balance, tx:store.all('transactions'), rules:store.all('recurring'), budgets:store.all('budgets'), goals:store.all('goals'), today:t, exists:id => store.has('transactions', id)};
    cache = {v, t, ctx, prep:F.prepare(ctx)};
  }
  return cache;
}
/** Para el Resumen: primer faltante (o tramo bajo el colchón) de los próximos 30 días. */
export function nextShortfall(){
  const d = data(); d.sf30 ||= F.shortfalls(F.project(d.prep, 30));
  return {negative:d.sf30.negative[0] || null, low:d.sf30.low[0] || null, cushion:d.prep.cushion};
}

/* ---------- Gráfica de saldo ---------- */
function balanceChart(key, canvas, labels, series){
  if (!charts.available() || !canvas) return;
  const C = charts.palette();
  charts.upsert(key, canvas, {type:'line',
    data:{labels, datasets:series.map(s => ({label:s.label, data:s.data.map(v => v / 100), borderColor:s.muted ? C.muted : C.primary, backgroundColor:C.primary + '1F', borderWidth:s.muted ? 1.5 : 2.5,
      borderDash:s.muted ? [5, 4] : [], pointRadius:0, pointHoverRadius:4, tension:0, fill:!!s.fill,
      segment:s.muted ? undefined : {borderColor:c => c.p1.parsed.y < 0 ? C.expense : undefined}}))},
    options:{responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false},
      plugins:{legend:{display:series.length > 1, position:'bottom', labels:{usePointStyle:true, pointStyle:'line', boxWidth:22, color:C.text}}, tooltip:{callbacks:{label:c => ' ' + c.dataset.label + ': ' + api.units(c.parsed.y)}}},
      scales:{x:{grid:{display:false}, ticks:{color:C.muted, maxTicksLimit:7, maxRotation:0}}, y:{grid:{color:C.grid}, ticks:{color:C.muted, callback:v => api.cf(v)}}}}});
}

/* ====================================================================== Calendario */
let sel = null, ghost = null; // día seleccionado y compra simulada que se muestra como «fantasma»

const alertLi = (cls, icon, html) => '<li class="alert ' + cls + '"><span class="ins-ico ' + cls + '">' + ico(icon, 18) + '</span><p>' + html + '</p></li>';
function alertsHTML(fc, sf, cl, prep, m){
  const out = [], end = fc.days[fc.days.length - 1].date;
  if (ghost) out.push('<li class="alert sim"><span class="ins-ico">' + ico('chat', 18) + '</span><p>Mostrando la simulación: <strong>' + esc(ghost.label) + '</strong>. Los días con <em>Simulación</em> no son reales.</p><button type="button" class="btn sm" data-ghost-off>Quitar</button></li>');
  sf.negative.slice(0, 2).forEach(r => out.push(alertLi('bad', 'alert',
    '<strong>Faltante previsto el ' + dS(r.from) + '.</strong> Tu saldo bajaría a ' + money(r.min) + (r.minDate !== r.from ? ' (el punto más bajo sería el ' + dS(r.minDate) + ')' : '') + ': te faltan <strong>' + money(-r.min) + '</strong> antes de esa fecha.' +
    (r.causes.length ? ' Pagos de esos días: ' + names(r.causes) + '.' : '') + (r.to < end ? ' Se recupera el ' + dS(F.addDays(r.to, 1)) + '.' : ''))));
  const low = sf.low.find(r => !sf.negative.some(n => n.from <= r.to && n.to >= F.addDays(r.from, -1))) || (!sf.negative.length && sf.low[0]);
  if (low) out.push(alertLi('warn', 'gauge', '<strong>Saldo justo del ' + dS(low.from) + ' al ' + dS(low.to) + '.</strong> Quedarías con ' + money(low.min) + ' el ' + dS(low.minDate) + ', menos que una semana de tu gasto habitual (' + money(fc.cushion) + ').'));
  cl.filter(c => c.share >= .2 || c.items.length >= 3).slice(0, 2).forEach(c => out.push(alertLi(c.share >= .4 ? 'warn' : '', 'calendar',
    '<strong>' + c.items.length + ' pagos coinciden ' + (c.from === c.to ? 'el ' + dS(c.from) : 'entre el ' + dS(c.from) + ' y el ' + dS(c.to)) + ':</strong> ' + names(c.items, 4) + ', por ' + money(c.total) + ' (' + pct(Math.min(c.share, 9.99)) + ' del saldo previsto).' +
    (c.nextIncome && !c.incomeInside ? ' Tu siguiente ingreso (' + esc(c.nextIncome.name) + ') llega hasta el ' + dS(c.nextIncome.date) + '.' : ''))));
  if (!sf.negative.length && !low) out.push(alertLi('good', 'check', 'Sin faltantes previstos. Tu saldo más bajo sería <strong>' + money(fc.min.balance) + '</strong> el ' + dS(fc.min.date) + '.'));
  if (prep.inferred.length) out.push(alertLi('', 'info', 'Incluye ingresos que detecté en tu historial: ' + prep.inferred.map(s => esc(s.name) + ' (día ' + s.day + ', ' + money(s.amount) + ')').join('; ') + '. <a href="#fijos">Agrégalos como fijos</a> para que sean exactos.'));
  else if (!m.income) out.push(alertLi('', 'info', 'No encuentro ingresos fijos ni habituales, así que la proyección solo descuenta gastos. <a href="#fijos">Agrega tu quincena o sueldo como fijo</a> para verla completa.'));
  if (prep.vd.confidence === 'baja' || prep.vd.confidence === 'none') out.push(alertLi('', 'info', prep.vd.confidence === 'none' ? 'Aún no hay movimientos: registra tus gastos unos días para estimar tu gasto diario.' : 'Estimación con pocos datos (' + prep.vd.days + ' días de historial). Mejora conforme registres más movimientos.'));
  return out.join('');
}

export function renderPlan(){
  const {prep} = data(), t = prep.today, key = api.viewKey(), {y, m} = U.parseKey(key), dim = U.daysIn(y, m), last = key + '-' + U.pad(dim);
  const fc = F.project(prep, Math.max(60, Math.min(430, F.dayDiff(t, last))), ghost ? ghost.events : []);
  const byDate = new Map(fc.days.map(d => [d.date, d])), sf = F.shortfalls(fc), cl = F.clusters(fc), mo = F.monthly(prep);
  const clash = new Set(); cl.forEach(c => { for (let d = c.from; d <= c.to; d = F.addDays(d, 1)) clash.add(d); });

  const kpi = (label, cents, sub, k) => '<article class="card kpi"><div class="kpi-top"><span>' + label + '</span></div><p class="kpi-val' + (cents < 0 ? ' neg' : '') + '" data-count="' + cents + '" data-count-key="' + k + '">' + money(cents) + '</p><p class="kpi-sub">' + sub + '</p></article>';
  $('#planKpis').innerHTML = kpi('Saldo hoy', fc.start, 'Antes de los pagos de hoy', 'pl-now') + kpi('En 30 días', fc.days[30].balance, dS(fc.days[30].date), 'pl-30') +
    kpi('En 60 días', fc.days[60].balance, dS(fc.days[60].date), 'pl-60') + kpi('Punto más bajo', fc.min.balance, 'El ' + dS(fc.min.date), 'pl-min');
  $('#planAlerts').innerHTML = alertsHTML(fc, sf, cl, prep, mo);

  // Cuadrícula del mes (lunes a domingo)
  const real = new Map();
  for (const x of store.byMonth(key)){ const r = real.get(x.date) || {inc:0, exp:0, cats:[]}; if (x.type === 'income') r.inc += x.amount; else r.exp += x.amount; r.cats.push(x.category); real.set(x.date, r); }
  if (!sel || sel.slice(0, 7) !== key) sel = t.slice(0, 7) === key ? t : key + '-01';
  let html = '<span class="cal-pad"></span>'.repeat((F.weekday(key + '-01') + 6) % 7);
  for (let d = 1; d <= dim; d++){
    const date = key + '-' + U.pad(d), r = real.get(date), f = byDate.get(date), past = date < t;
    let inc = 0, exp = 0, cats = [];
    if (date <= t && r){ inc += r.inc; exp += r.exp; cats = cats.concat(r.cats); }
    if (f){ inc += f.inc; exp += f.out; cats = cats.concat(f.events.map(e => e.category)); }
    const cls = ['cal-day', past ? 'past' : date === t ? 'today' : 'fut'];
    if (f && f.balance < 0) cls.push('neg'); else if (f && fc.cushion > 0 && f.balance < fc.cushion) cls.push('low');
    if (clash.has(date)) cls.push('clash'); if (date === sel) cls.push('sel');
    if (f && f.events.some(e => e.kind === 'sim')) cls.push('ghost');
    const label = dL(date) + (exp ? ': gastos ' + money(exp) : '') + (inc ? ', ingresos ' + money(inc) : '') + (!past && f ? ', saldo previsto ' + money(f.balance) : '') + (clash.has(date) ? ', coinciden varios pagos' : '');
    html += '<button type="button" class="' + cls.join(' ') + '" data-day="' + date + '" aria-label="' + esc(label) + '" aria-pressed="' + (date === sel) + '"><span class="cal-num">' + d + '</span>' +
      '<span class="cal-dots">' + [...new Set(cats)].slice(0, 3).map(c => '<i style="background:' + catOf(c).color + '"></i>').join('') + '</span>' +
      (inc ? '<span class="cal-in">+' + api.compact(inc) + '</span>' : '') + (exp ? '<span class="cal-out">−' + api.compact(exp) + '</span>' : '') +
      (!past && f ? '<span class="cal-bal">' + api.compact(f.balance) + '</span>' : '') + '</button>';
  }
  $('#calGrid').innerHTML = html;
  $('#calSub').textContent = U.monthLabel(key) + (key < t.slice(0, 7) ? ' · lo que pasó' : ' · pagos, ingresos y saldo previsto al cierre de cada día');

  renderDay(byDate, prep);
  const n = 61, days = fc.days.slice(0, n);
  balanceChart('plan', $('#planCanvas'), days.map(d => dS(d.date)), [{label:'Saldo previsto', data:days.map(d => d.balance), fill:true}]);
  $('#planCanvas').setAttribute('aria-label', 'Saldo previsto a 60 días. Hoy ' + money(fc.start) + ', mínimo ' + money(fc.min.balance) + ' el ' + dS(fc.min.date) + '.');
}

function renderDay(byDate, prep){
  const t = prep.today, f = byDate.get(sel), past = sel < t, box = $('#planDay');
  const txs = sel <= t ? store.byMonth(sel.slice(0, 7)).filter(x => x.date === sel) : [];
  const ev = e => {
    const c = catOf(e.category), attr = e.kind === 'fijo' ? ' data-rec="' + esc(e.ruleId) + '"' : e.kind === 'mov' ? ' data-tx="' + esc(e.id) + '"' : ' disabled';
    return '<li><button type="button" class="tx' + (e.kind === 'sim' ? ' ghost' : '') + '"' + attr + ' style="--c:' + c.color + '"><span class="catdot">' + ico(c.icon, 20) + '</span><span class="tx-main"><span class="tx-title" style="display:block">' + esc(e.name || c.name) +
      '</span><span class="tx-meta">' + KIND[e.kind] + (e.of ? ' · pago ' + e.index + ' de ' + e.of : '') + ' · ' + esc(c.name) + '</span></span><span class="tx-amt ' + e.type + '">' + (e.type === 'income' ? '+' : '−') + money(e.amount) + '</span></button></li>';
  };
  const rows = txs.map(x => api.txRow(x, false)).concat(f ? f.events.map(ev) : []);
  box.innerHTML = '<div class="card-head"><div><h2 id="dayTitle">' + dL(sel) + '</h2><p class="sub">' + (past ? 'Movimientos registrados' : sel === t ? 'Lo de hoy y lo que falta por cobrarse' : 'Lo que está programado') + '</p></div></div>' +
    '<ul class="tx-list">' + (rows.length ? rows.join('') : '<li class="empty sm">' + (past ? 'Sin movimientos ese día.' : 'Nada programado para este día.') + '</li>') + '</ul>' +
    (f ? '<dl class="day-sum">' + (f.variable ? '<div><dt>Gasto del día estimado</dt><dd>−' + money(f.variable) + '</dd></div>' : '') + '<div><dt>Saldo previsto al cierre</dt><dd class="' + (f.balance < 0 ? 'neg' : '') + '">' + money(f.balance) + '</dd></div></dl>' : '') +
    (past ? '' : '<div class="row day-acts"><button type="button" class="btn sm" data-plan-add="' + sel + '">' + ico('plus', 16) + '<span>Pago en esta fecha</span></button><button type="button" class="btn sm" data-plan-rec="' + Number(sel.slice(8, 10)) + '">' + ico('repeat', 16) + '<span>Nuevo fijo el día ' + Number(sel.slice(8, 10)) + '</span></button></div>');
}

/* ====================================================================== Chat simulador */
const chat = {msgs:[], sims:{}, n:0, draft:null, last:null, stale:false};
const VERDICT = {si:['good', 'check', 'Sí puedes'], justo:['warn', 'gauge', 'Puedes, pero quedarías justo'], no:['bad', 'alert', 'Mejor no por ahora']};
const HELP = [['¿Puedo comprar una laptop de 15,000?'], ['Tele de 12 mil a 12 meses'], ['¿Cuánto puedo gastar hoy?'], ['¿Cuánto debo?'], ['¿Qué pagos vienen?'], ['¿Cuánto tendré a fin de mes?']];
const chips = list => list.map(c => ({label:c[0], say:c[1] || c[0], act:c[2], id:c[3]}));

function simText(r){
  const p = r.purchase, w = r.worst, meses = p.months > 1;
  switch (r.reason){
    case 'faltante': return 'El ' + dS(w.date) + ' te faltarían <strong>' + money(-w.balance) + '</strong>: tu saldo quedaría en ' + money(w.balance) + '.';
    case 'ya-faltaba': return 'Incluso sin esta compra ya tienes un faltante previsto el ' + dS(r.base.min.date) + ' (' + money(r.base.min.balance) + '). Con la compra llegaría a <strong>' + money(w.balance) + '</strong>.';
    case 'mensualidad': return 'La mensualidad de ' + money(p.pay) + ' no cabe en tu mes: ' + (r.monthly.margin >= 0 ? 'hoy te quedan libres ' + money(r.monthly.margin) + ' y' : 'tu gasto habitual ya supera tus ingresos fijos por ' + money(-r.monthly.margin) + ' al mes, así que') + ' te faltarían <strong>' + money(-r.marginAfter) + '</strong> cada mes.';
    case 'colchon': return 'No te quedas sin dinero, pero el ' + dS(w.date) + ' tu saldo bajaría a <strong>' + money(w.balance) + '</strong>, menos que una semana de tu gasto habitual (' + money(r.base.cushion) + ').';
    case 'margen': return 'La mensualidad de ' + money(p.pay) + ' cabe, pero te deja solo <strong>' + money(r.marginAfter) + '</strong> libres al mes.';
    default: return meses ? 'Serían ' + p.months + ' pagos de <strong>' + money(p.pay) + '</strong> desde el ' + dS(r.events[0].date) + '. En 60 días tu saldo no bajaría de ' + money(w.balance) + ' (' + dS(w.date) + ').'
      : 'Después de pagar te quedan <strong>' + money(r.first ? r.first.balance : r.rows.now.sim) + '</strong>. En 60 días tu saldo no bajaría de ' + money(w.balance) + ' (' + dS(w.date) + ').';
  }
}
function simHTML(r, id){
  const p = r.purchase, [cls, icon, title] = VERDICT[r.verdict], meses = p.months > 1, cat = catOf(p.category), pts = [];
  const what = esc(p.name || 'Compra') + ' · ' + money(p.amount) + (meses ? ' a ' + p.months + ' meses' + (p.rate ? ' con ' + p.rate + '% anual' : ' sin intereses') : ' de contado') + (p.date > api.today() ? ' · ' + dS(p.date) : '');
  if (meses) pts.push(p.months + ' pagos de ' + money(p.pay) + ': en total ' + money(p.total) + (p.interest > 0 ? ' (<strong>' + money(p.interest) + ' de intereses</strong>)' : '') + '.');
  const b = r.debts.before, a = r.debts.after;
  if (meses) pts.push(b.list.length ? 'Tus deudas a plazo pasarían de ' + money(b.total) + ' (' + money(b.monthly) + '/mes) a <strong>' + money(a.total) + '</strong> (' + money(a.monthly) + '/mes).' : 'Hoy no tienes deudas a plazo; esta sería la primera: ' + money(a.total) + '.');
  else pts.push(b.list.length ? 'No agrega deuda. Sigues debiendo ' + money(b.total) + ' en ' + b.list.length + (b.list.length === 1 ? ' compromiso' : ' compromisos') + ' (' + money(b.monthly) + '/mes).' : 'No agrega deuda y hoy no tienes pagos a plazo pendientes.');
  if (meses && r.committed) pts.push('Tus gastos fijos pasarían de ' + pct(r.committed.before) + ' a <strong>' + pct(r.committed.after) + '</strong> de tus ingresos fijos.');
  if (r.budget) pts.push(r.budget.over > 0 ? 'Rebasaría tu presupuesto de ' + esc(cat.name) + ' de ' + U.monthLabel(r.budget.month).toLowerCase() + ' por <strong>' + money(r.budget.over) + '</strong> (' + money(r.budget.after) + ' de ' + money(r.budget.limit) + ').'
    : 'Cabe en tu presupuesto de ' + esc(cat.name) + ': llevarías ' + money(r.budget.after) + ' de ' + money(r.budget.limit) + '.');
  if (r.goals.hit) pts.push('Compite con tus metas de ahorro: necesitas apartar ' + money(r.goals.need) + ' al mes para llegar a tiempo.');
  const near = []; r.scenario.days.forEach(d => { if (d.date >= p.date && F.dayDiff(p.date, d.date) <= 7) d.events.forEach(e => { if (e.type !== 'income' && e.kind !== 'sim') near.push(e); }); });
  if (near.length) pts.push('En los 7 días siguientes también pagas: ' + near.slice(0, 4).map(e => esc(e.name || catOf(e.category).name) + ' (' + money(e.amount) + ')').join(', ') + '.');
  if (r.daysOfSpend >= 3) pts.push('Equivale a ' + Math.round(r.daysOfSpend) + ' días de tu gasto habitual.');
  if (r.verdict !== 'si'){
    if (r.alt.contado) pts.push('<strong>Alternativa:</strong> de contado sí te alcanza' + (p.date > api.today() ? ' ese día.' : ' hoy.'));
    if (r.alt.waitDate) pts.push('<strong>Alternativa:</strong> si esperas al ' + dS(r.alt.waitDate) + ', de contado sí alcanza.');
    if (r.alt.months) pts.push('<strong>Alternativa:</strong> a ' + r.alt.months.n + ' meses sin intereses (' + money(r.alt.months.pay) + '/mes) sí cabe.');
    if (!meses) pts.push(r.alt.maxSafe > 0 ? 'Hoy puedes gastar hasta ' + money(r.alt.maxSafe) + ' sin bajar de tu colchón.' : 'Hoy no hay margen para un gasto extra sin bajar de tu colchón.');
  }
  if (!r.hasIncome) pts.push('No tengo registrados tus ingresos fijos, así que solo descuento gastos: el resultado es más pesimista de lo real.');
  else if (r.confidence === 'baja' || r.confidence === 'none') pts.push('Tengo pocos días de historial; tómalo como una aproximación.');
  const row = (l, x) => '<tr><th scope="row">' + l + '</th><td>' + money(x.base) + '</td><td class="' + (x.sim < 0 ? 'neg' : '') + '">' + money(x.sim) + '</td></tr>';
  return '<div class="sim ' + cls + '"><p class="sim-what">' + what + '</p><p class="sim-verdict">' + ico(icon, 20) + '<strong>' + title + '</strong></p><p>' + simText(r) + '</p>' +
    '<table class="sim-table"><thead><tr><th scope="col"><span class="sr-only">Momento</span></th><th scope="col">Sin comprar</th><th scope="col">Comprando</th></tr></thead><tbody>' +
    row(r.rows.now.date > api.today() ? 'El ' + dS(r.rows.now.date) : 'Hoy', r.rows.now) + row('En 30 días', r.rows.d30) + row('En 60 días', r.rows.d60) + '</tbody></table>' +
    '<div class="sim-chart"><canvas id="simc-' + id + '" role="img" aria-label="Saldo a 60 días con y sin la compra"></canvas></div><ul class="sim-points">' + pts.map(x => '<li>' + x + '</li>').join('') + '</ul></div>';
}
function simChips(r, id){
  const p = r.purchase, out = [];
  if (p.months > 1) out.push(['¿Y de contado?']); else { out.push(['¿Y a 6 meses?']); out.push(['¿Y a 12 meses?']); }
  if (r.alt.waitDate){ const [, mm, dd] = r.alt.waitDate.split('-').map(Number); out.push(['¿Y si espero al ' + dS(r.alt.waitDate) + '?', '¿Y el ' + dd + ' de ' + U.MONTHS[mm - 1] + '?']); }
  if (r.alt.months && r.alt.months.n !== 6 && r.alt.months.n !== 12) out.push(['¿Y a ' + r.alt.months.n + ' meses?']);
  out.push(['Ver en el calendario', '', 'cal', id]); out.push(['Registrar esta compra', '', 'reg', id]);
  return chips(out);
}

function listHTML(rows){ return '<ul class="upcoming chat-list">' + rows.map(([a, b]) => '<li><span>' + a + '</span><span>' + b + '</span></li>').join('') + '</ul>'; }
function answer(q){
  const {prep, ctx} = data(), t = prep.today;
  if (q.intent === 'deudas'){
    const d = F.debts(ctx.rules, t), m = F.monthly(prep);
    if (!d.list.length) return {html:'<p>No tienes deudas a plazo registradas. Las compras a meses y los créditos se anotan en <a href="#fijos" data-close>Fijos</a> con su número de pagos, y aquí verás cuánto falta.</p>', chips:chips(HELP.slice(0, 3))};
    return {html:'<p>Debes <strong>' + money(d.total) + '</strong> en ' + d.list.length + (d.list.length === 1 ? ' compromiso' : ' compromisos') + ': ' + money(d.monthly) + ' al mes' + (m.income ? ', ' + pct(d.monthly / m.income) + ' de tus ingresos' : '') + '.</p>' +
      listHTML(d.list.map(x => [esc(x.name) + ' · faltan ' + x.remaining + ' de ' + x.of + ' (termina ' + dS(x.end) + ')', money(x.total)])), chips:chips([['¿Qué pagos vienen?'], ['¿Cuánto puedo gastar hoy?']])};
  }
  if (q.intent === 'pagos'){
    const fc = F.project(prep, 30), ev = []; fc.days.forEach(d => d.events.forEach(e => { if (e.type !== 'income') ev.push(e); }));
    if (!ev.length) return {html:'<p>No hay pagos programados en los próximos 30 días. Agrega tus pagos en <a href="#fijos" data-close>Fijos</a> o captura un gasto con fecha futura.</p>', chips:chips(HELP.slice(0, 3))};
    const cl = F.clusters(fc)[0];
    return {html:'<p>En los próximos 30 días pagas <strong>' + money(ev.reduce((s, e) => s + e.amount, 0)) + '</strong> en ' + ev.length + (ev.length === 1 ? ' pago' : ' pagos') + '.</p>' + listHTML(ev.slice(0, 10).map(e => [dS(e.date) + ' · ' + esc(e.name || catOf(e.category).name), money(e.amount)])) +
      (ev.length > 10 ? '<p class="hint">Y ' + (ev.length - 10) + ' más en el calendario.</p>' : '') + (cl ? '<p>Ojo: ' + cl.items.length + ' pagos coinciden ' + (cl.from === cl.to ? 'el ' + dS(cl.from) : 'entre el ' + dS(cl.from) + ' y el ' + dS(cl.to)) + ' por ' + money(cl.total) + '.</p>' : ''),
      chips:chips([['Abrir el calendario', '', 'plan'], ['¿Cuánto puedo gastar hoy?']])};
  }
  if (q.intent === 'libre'){
    const fc = F.project(prep, 60), free = Math.max(0, fc.min.balance - prep.cushion);
    return {html:'<p>' + (free > 0 ? 'Hoy puedes gastar hasta <strong>' + money(free) + '</strong> de más sin que tu saldo baje de tu colchón (' + money(prep.cushion) + ', una semana de tu gasto habitual) en los próximos 60 días.'
      : 'Hoy no hay margen para un gasto extra: ' + (fc.min.balance < 0 ? 'ya tienes un faltante previsto de ' + money(-fc.min.balance) : 'tu saldo bajaría a ' + money(fc.min.balance) + ', menos que tu colchón de ' + money(prep.cushion)) + '.') +
      ' Tu punto más bajo sería ' + money(fc.min.balance) + ' el ' + dS(fc.min.date) + '.</p>', chips:chips([['¿Qué pagos vienen?'], ['¿Cuánto tendré a fin de mes?']])};
  }
  if (q.intent === 'saldo'){
    const date = q.date && q.date > t ? q.date : F.addDays(t, 30), n = Math.min(430, F.dayDiff(t, date)), fc = F.project(prep, n);
    let inc = 0, out = 0, vari = 0; fc.days.forEach(d => { inc += d.inc; out += d.out; vari += d.variable; });
    const end = fc.days[fc.days.length - 1];
    return {html:'<p>El ' + dS(end.date) + ' tendrías alrededor de <strong>' + money(end.balance) + '</strong>.</p>' + listHTML([['Saldo de hoy', money(fc.start)], ['Ingresos previstos', '+' + money(inc)], ['Pagos programados', '−' + money(out)], ['Gasto diario estimado', '−' + money(vari)]]) +
      (fc.firstNegative ? '<p>Antes de esa fecha habría un faltante: el ' + dS(fc.firstNegative.date) + ' bajarías a ' + money(fc.firstNegative.balance) + '.</p>' : ''), chips:chips([['Abrir el calendario', '', 'plan'], ['¿Cuánto puedo gastar hoy?']])};
  }
  if (q.intent === 'semana'){
    const r = weeklyReport(ctx, lastClosedWeek(t));
    return {html:r.empty ? '<p>Todavía no hay movimientos en la última semana para armar un reporte.</p>' : '<p>Semana del ' + dS(r.ws) + ' al ' + dS(r.we) + ': gastaste <strong>' + money(r.totals.exp) + '</strong> e ingresaste ' + money(r.totals.inc) + '.</p><p>' + hlText(r.highlights[0]) + '</p>',
      chips:chips(r.empty ? HELP.slice(0, 3) : [['Abrir el reporte', '', 'rep']])};
  }
  return {html:q.intent === 'ayuda' ? '<p>Dime qué quieres comprar y cuánto cuesta, y te digo si te alcanza, cómo quedaría tu saldo a 30 y 60 días y qué pasa con tus deudas. Puedes agregar la forma de pago y la fecha: «a 12 meses», «con 30% de interés», «el viernes».</p>'
    : '<p>No entendí. Prueba con el monto y, si quieres, la forma de pago: «laptop de 15,000 a 12 meses».</p>', chips:chips(HELP)};
}

function handle(text){
  text = text.trim(); if (!text) return;
  const t = api.today(), q = parse(text, {today:t, rules:store.all('merchant_rules')});
  post({who:'me', html:esc(text)});
  const follow = q.intent === 'ajuste' || (q.intent === 'compra' && !q.item && /^[¿\s]*(?:y|mejor|pero|entonces|ahora|ok)\b/i.test(text));
  if (q.intent !== 'compra' && q.intent !== 'ajuste' && !(chat.draft && q.amount != null)){ chat.draft = null; post({who:'bot', ...answer(q)}); return; }
  const base = chat.draft || (follow ? chat.last : null);
  if (!base && q.amount == null && q.intent === 'ajuste'){ post({who:'bot', ...answer({intent:'ayuda'})}); return; }
  const d = {...(base || {})};
  ['amount', 'mode', 'months', 'rate', 'date', 'category'].forEach(k => { if (q[k] != null) d[k] = q[k]; });
  if (q.item) d.name = U.cap(q.item);
  if (q.mode === 'contado'){ d.months = null; d.rate = null; }
  if (q.months) d.mode = 'meses';
  if (d.date && d.date < t) d.date = t;
  if (d.amount == null){ chat.draft = d; post({who:'bot', html:'<p>¿Cuánto cuesta' + (d.name ? ' («' + esc(d.name) + '»)' : '') + '? Escribe el monto, por ejemplo «15,000».</p>', chips:[]}); return; }
  if (d.mode === 'meses' && !d.months){ chat.draft = d; post({who:'bot', html:'<p>¿A cuántos meses?</p>', chips:chips([['3 meses', 'a 3 meses'], ['6 meses', 'a 6 meses'], ['12 meses', 'a 12 meses'], ['18 meses', 'a 18 meses'], ['24 meses', 'a 24 meses']])}); return; }
  d.mode = d.mode || 'contado'; chat.draft = null; chat.last = d;
  const {prep, ctx} = data(), r = F.simulatePurchase(prep, d, ctx), id = ++chat.n;
  chat.sims[id] = r;
  post({who:'bot', sim:id, chips:simChips(r, id)});
}

function drawSim(id){
  const r = chat.sims[id], c = $('#simc-' + id); if (!r || !c) return;
  balanceChart('sim' + id, c, r.base.days.map(d => dS(d.date)), [{label:'Comprando', data:r.scenario.days.map(d => d.balance)}, {label:'Sin comprar', data:r.base.days.map(d => d.balance), muted:true}]);
}
function msgEl(m){
  const el = document.createElement('div'); el.className = 'msg ' + m.who + (m.sim ? ' wide' : '');
  el.innerHTML = m.sim ? simHTML(chat.sims[m.sim], m.sim) : m.html;
  return el;
}
function showChips(list){
  $('#chatChips').innerHTML = (list || []).map((c, i) => '<button type="button" class="chip-btn" data-chip="' + i + '">' + esc(c.label) + '</button>').join('');
  chat.chips = list || [];
}
function post(m){
  chat.msgs.push(m);
  const log = $('#chatLog'), el = msgEl(m); log.appendChild(el);
  if (m.sim) drawSim(m.sim);
  if (m.who === 'bot') showChips(m.chips);
  requestAnimationFrame(() => { if (m.who === 'bot' && el.offsetHeight > log.clientHeight) log.scrollTop = el.offsetTop - 8; else log.scrollTop = log.scrollHeight; });
}
function rebuildChat(){
  const log = $('#chatLog'); log.innerHTML = '';
  chat.msgs.forEach(m => { log.appendChild(msgEl(m)); if (m.sim) drawSim(m.sim); });
  const lastBot = [...chat.msgs].reverse().find(m => m.who === 'bot'); showChips(lastBot && lastBot.chips);
  log.scrollTop = log.scrollHeight; chat.stale = false;
}
export function openChat(){
  api.openDlg($('#chatDlg'));
  if (!chat.msgs.length) post({who:'bot', html:'<p>Hola. Soy tu simulador de compras: calculo con tus propios datos, en este dispositivo.</p><p>Dime qué quieres comprar y cuánto cuesta, y te digo si te alcanza y cómo quedarías a 30 y 60 días.</p>', chips:chips(HELP)});
  else if (chat.stale || !$('#chatLog').children.length) rebuildChat();
  setTimeout(() => { if (matchMedia('(min-width: 760px)').matches) $('#chatIn').focus(); }, 60);
}
/** Al cambiar de tema las gráficas se destruyen: el chat se vuelve a pintar la próxima vez que se abra. */
export function themeChanged(){ chat.stale = true; if ($('#chatDlg').open) rebuildChat(); }

function chipAct(c){
  if (c.act === 'plan' || c.act === 'cal'){
    if (c.act === 'cal'){
      const r = chat.sims[c.id], p = r.purchase;
      ghost = {label:(p.name || 'Compra') + ' · ' + money(p.amount) + (p.months > 1 ? ' a ' + p.months + ' meses' : ''), events:r.events};
      const [y, m] = r.events[0].date.split('-').map(Number); api.view.y = y; api.view.m = m - 1; sel = r.events[0].date;
    }
    api.closeDlg($('#chatDlg')); if (location.hash === '#planear') api.render(); else location.hash = '#planear';
  } else if (c.act === 'rep'){ api.closeDlg($('#chatDlg')); openReport(); }
  else if (c.act === 'reg'){
    const r = chat.sims[c.id], p = r.purchase; api.closeDlg($('#chatDlg'));
    if (p.months > 1){ const f = r.events[0].date; api.openRec(null, {type:'expense', name:(p.name || 'Compra') + ' a ' + p.months + ' meses', amount:p.pay, day:Number(f.slice(8, 10)), start:f.slice(0, 7), occ:p.months, category:p.category}); }
    else api.openTx(null, {type:'expense', category:p.category, amount:p.amount, date:p.date, description:p.name || ''});
  }
}

/* ====================================================================== Reporte semanal */
const SEEN = 'gastos:reportSeen';
const seen = () => { try { return localStorage.getItem(SEEN) || ''; } catch(e){ return ''; } };
const delta = (cur, ref, word) => !ref ? '' : cur === ref ? 'igual que ' + word : pct(Math.abs(cur - ref) / ref) + (cur > ref ? ' más que ' : ' menos que ') + word;

function hlText(h){
  switch (h.kind){
    case 'faltante': return '<strong>Faltante previsto:</strong> el ' + dS(h.from) + ' tu saldo bajaría a ' + money(h.min) + '. Te faltan ' + money(-h.min) + (h.causes.length ? ' (' + names(h.causes) + ')' : '') + '.';
    case 'presupuesto': return '<strong>' + esc(h.items.map(b => catOf(b.id).name).join(', ')) + '</strong> ' + (h.items.length > 1 ? 'superaron' : 'superó') + ' su presupuesto del mes: ' + h.items.map(b => money(b.spent) + ' de ' + money(b.limit)).join('; ') + '.';
    case 'presupuesto-riesgo': return esc(h.items.map(b => catOf(b.id).name).join(', ')) + (h.items.length > 1 ? ' ya usaron' : ' ya usó') + ' ' + pct(h.items[0].pct) + ' de su presupuesto y el mes va al ' + pct(h.items[0].pace) + '.';
    case 'inusual': return '<strong>Gasto ' + (h.sub === 'nuevo' ? 'nuevo y alto' : 'inusual') + ':</strong> ' + esc(h.tx.description || catOf(h.tx.category).name) + ' por ' + money(h.tx.amount) + ', ' + h.times.toFixed(1) + ' veces tu gasto típico' + (h.sub === 'nuevo' ? '' : ' en ' + esc(catOf(h.tx.category).name)) + ' (' + money(h.avg) + ').';
    case 'arriba': return 'Gastaste ' + money(h.exp) + ': <strong>' + pct(h.pct) + ' más</strong> que tu promedio semanal (' + money(h.avg) + ').';
    case 'abajo': return 'Gastaste ' + money(h.exp) + ': <strong>' + pct(h.pct) + ' menos</strong> que tu promedio semanal (' + money(h.avg) + ').';
    case 'coincidencia': return '<strong>' + h.items.length + ' pagos coinciden</strong> ' + (h.from === h.to ? 'el ' + dS(h.from) : 'entre el ' + dS(h.from) + ' y el ' + dS(h.to)) + ' por ' + money(h.total) + ': ' + pct(Math.min(h.share, 9.99)) + ' de tu saldo previsto.';
    case 'deuda-termina': return 'El ' + dS(h.end) + ' haces el <strong>último pago</strong> de ' + esc(h.name) + ': liberas ' + money(h.amount) + ' al mes.';
    default: return 'Semana sin sobresaltos: gastaste ' + money(h.exp) + ' y tu balance fue ' + money(h.net) + '.';
  }
}
const weekLabel = r => dS(r.ws) + ' – ' + dS(r.we);

export function renderWeekCard(){
  const box = $('#weekCard'), {ctx} = data(), r = weeklyReport(ctx, lastClosedWeek(ctx.today));
  box.hidden = r.empty; if (r.empty) return;
  const isNew = seen() < r.ws;
  box.innerHTML = '<div class="card-head"><div><h2 id="weekTitle">Tu semana' + (isNew ? ' <span class="badge new">Nuevo</span>' : '') + '</h2><p class="sub">' + weekLabel(r) + ' · gastaste ' + money(r.totals.exp) + (r.avg ? ', ' + delta(r.totals.exp, r.avg.exp, 'tu promedio') : '') + '</p></div>' +
    '<button type="button" class="btn sm" data-report>Ver reporte</button></div><ul class="hl">' + r.highlights.slice(0, 2).map(h => '<li class="' + h.level + '">' + hlText(h) + '</li>').join('') + '</ul>';
}

let repWeek = null;
function reportHTML(r){
  if (r.empty) return '<div class="empty">' + ico('inbox', 28) + '<p>Sin movimientos en esta semana ni en la anterior.</p></div>';
  const sec = (title, body) => body ? '<section class="rep-sec"><h3>' + title + '</h3>' + body + '</section>' : '';
  const t = r.totals, max = Math.max(1, ...r.days.map(d => d.exp)), DAY = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const f = r.forward;
  return sec('Lo más importante', '<ul class="hl">' + r.highlights.map(h => '<li class="' + h.level + '">' + hlText(h) + '</li>').join('') + '</ul>') +
    sec('Números de la semana', '<div class="rep-nums"><div><span>Ingresos</span><strong class="tx-amt income">' + money(t.inc) + '</strong></div><div><span>Gastos</span><strong>' + money(t.exp) + '</strong></div><div><span>Balance</span><strong class="' + (t.net < 0 ? 'neg' : '') + '">' + money(t.net) + '</strong></div></div>' +
      listHTML([['Saldo al empezar → al terminar', money(r.balStart) + ' → ' + money(r.balEnd)]].concat(r.prev.exp ? [['Gasto vs. semana anterior (' + money(r.prev.exp) + ')', delta(t.exp, r.prev.exp, 'antes')]] : [])
        .concat(r.avg ? [['Gasto vs. promedio de ' + r.weeks + (r.weeks === 1 ? ' semana' : ' semanas') + ' (' + money(r.avg.exp) + ')', delta(t.exp, r.avg.exp, 'el promedio')]] : []).concat([['Movimientos registrados', String(r.count)]]))) +
    sec('En qué se fue', r.cats.length ? '<ul class="rep-cats">' + r.cats.map(c => { const k = catOf(c.id); return '<li style="--c:' + k.color + '"><div class="rep-cat-top"><span>' + esc(k.name) + '</span><span><strong>' + money(c.amount) + '</strong>' +
      (c.avg ? ' <small class="' + (c.amount > c.avg * 1.25 ? 'bad' : c.amount < c.avg * .8 ? 'good' : '') + '">' + delta(c.amount, c.avg, 'lo normal') + '</small>' : c.avg === 0 ? ' <small>no sueles gastar aquí</small>' : '') + '</span></div><div class="bar"><span style="width:' + Math.max(2, c.amount / r.cats[0].amount * 100) + '%"></span></div></li>'; }).join('') + '</ul>' : '') +
    sec('Día por día', t.exp ? '<div class="rep-days" role="img" aria-label="Gasto por día. El más caro: ' + (r.topDay ? dL(r.topDay.date) + ', ' + money(r.topDay.exp) : 'ninguno') + '">' + r.days.map((d, i) => '<div><i style="height:' + Math.round(d.exp / max * 100) + '%"></i><span>' + DAY[i] + '</span></div>').join('') + '</div>' +
      '<p class="hint">' + (r.topDay ? 'El día más caro fue el ' + dL(r.topDay.date).toLowerCase() + ' (' + money(r.topDay.exp) + '). ' : '') + (r.noSpend ? r.noSpend + (r.noSpend === 1 ? ' día' : ' días') + ' sin gastar.' : 'Gastaste todos los días.') + '</p>' : '') +
    sec('Gastos más grandes', r.biggest.length ? listHTML(r.biggest.map(x => [dS(x.date) + ' · ' + esc(x.description || catOf(x.category).name) + (x.recurring_id ? ' (fijo)' : ''), money(x.amount)])) : '') +
    sec('Fuera de lo normal', r.unusual.length ? '<ul class="hl">' + r.unusual.map(u => '<li class="warn">' + hlText({...u, kind:'inusual', sub:u.kind}) + '</li>').join('') + '</ul>' : '') +
    sec('Donde más compraste', r.merchants.length ? listHTML(r.merchants.map(m => [esc(m.name) + ' · ' + m.count + ' veces', money(m.total)])) : '') +
    sec('Fijos pagados', r.fixedPaid.length ? listHTML(r.fixedPaid.map(x => [dS(x.date) + ' · ' + esc(x.description || catOf(x.category).name), money(x.amount)])) : '') +
    sec('Lo que viene (7 días)', f ? (f.next.length ? listHTML(f.next.map(e => [dS(e.date) + ' · ' + esc(e.name || catOf(e.category).name) + ' <small>' + KIND[e.kind] + '</small>', (e.type === 'income' ? '+' : '−') + money(e.amount)])) : '<p class="hint">Sin pagos ni ingresos programados.</p>') +
      '<p class="hint">Saldo hoy ' + money(f.balance) + ' → en 7 días ' + money(f.in7) + ' (incluye tu gasto diario estimado).</p>' +
      (f.shortfall ? '<ul class="hl"><li class="bad">' + hlText({kind:'faltante', ...f.shortfall}) + '</li></ul>' : f.low ? '<ul class="hl"><li class="warn">Del ' + dS(f.low.from) + ' al ' + dS(f.low.to) + ' quedarías con ' + money(f.low.min) + ', por debajo de tu colchón.</li></ul>' : '') : '') +
    sec('Presupuestos del mes', r.budgets.length ? '<ul class="rep-cats">' + r.budgets.map(b => { const k = catOf(b.id); return '<li style="--c:' + k.color + '"><div class="rep-cat-top"><span>' + esc(k.name) + '</span><span><strong>' + pct(b.pct) + '</strong> <small class="' + (b.status === 'over' ? 'bad' : b.status === 'riesgo' ? 'warn' : '') + '">' +
      (b.status === 'over' ? 'excedido por ' + money(b.spent - b.limit) : 'quedan ' + money(b.limit - b.spent)) + '</small></span></div><div class="bar ' + (b.status === 'over' ? 'over' : b.status === 'riesgo' ? 'warn' : '') + '"><span style="width:' + Math.min(100, b.pct * 100) + '%"></span></div></li>'; }).join('') +
      '</ul><p class="hint">El mes iba al ' + pct(r.budgets[0].pace) + ' al cerrar la semana.</p>' : '') +
    sec('Metas', r.goals.length ? listHTML(r.goals.map(g => [esc(g.name) + ' · ' + pct(g.pct), g.plan.left === 0 ? 'Cumplida' : g.plan.late ? 'Fecha vencida, faltan ' + money(g.plan.left) : g.plan.monthly ? 'Aparta ' + money(g.plan.monthly) + '/mes' : 'Faltan ' + money(g.plan.left)])) : '') +
    sec('Deudas a plazo', r.debts.list.length ? listHTML(r.debts.list.map(x => [esc(x.name) + ' · faltan ' + x.remaining + ' de ' + x.of, money(x.total)]).concat([['<strong>Total pendiente</strong>', '<strong>' + money(r.debts.total) + '</strong>']])) : '') +
    sec('Pendientes', r.review ? '<p>Tienes ' + r.review + (r.review === 1 ? ' gasto' : ' gastos') + ' por revisar: mientras no los confirmes, sus categorías pueden estar mal y el reporte también. <a href="#resumen" data-close>Revisarlos</a></p>' : '');
}
export function openReport(ws){
  const {ctx} = data(), latest = lastClosedWeek(ctx.today);
  repWeek = ws || latest;
  const r = weeklyReport(ctx, repWeek);
  $('#repTitle').textContent = 'Semana del ' + weekLabel(r);
  $('#repNext').disabled = repWeek >= latest;
  $('#repBody').innerHTML = reportHTML(r); $('#repBody').scrollTop = 0;
  api.openDlg($('#reportDlg'));
  if (repWeek === latest && seen() < latest){ try { localStorage.setItem(SEEN, latest); } catch(e){} renderWeekCard(); }
}

/* ====================================================================== Aviso semanal (push) */
const pushUI = {busy:false, on:false, error:''};
export async function renderPush(refresh){
  const sec = $('#pushSec'), info = $('#pushInfo'), btns = $('#pushBtns');
  if (refresh){ try { pushUI.on = !!(await push.current()); } catch(e){ pushUI.on = false; } }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let msg, can = false;
  if (!push.supported()) msg = ios && !standalone ? 'En iPhone los avisos solo funcionan con la app instalada: Compartir → «Agregar a pantalla de inicio», y ábrela desde ese icono.' : 'Este navegador no admite avisos. El reporte aparece de todos modos en el Resumen cada lunes.';
  else if (!push.configured) msg = 'El reporte aparece cada lunes en el Resumen. Para recibir además un aviso en el celular falta configurar el envío (ver «Aviso semanal» en el README).';
  else if (push.permission() === 'denied') msg = 'Los avisos están bloqueados para esta app. Actívalos en los ajustes de tu navegador o del teléfono y vuelve aquí.';
  else { can = true; msg = pushUI.on ? 'Activo en este dispositivo: cada lunes por la mañana recibirás un aviso con lo que gastaste en la semana.' : 'Recibe un aviso cada lunes por la mañana con lo que gastaste en la semana. Se activa por dispositivo.'; }
  info.innerHTML = esc(msg) + (pushUI.error ? '<br><span class="err">' + esc(pushUI.error) + '</span>' : '');
  btns.innerHTML = !can ? '' : pushUI.on
    ? '<button type="button" class="btn" id="pushTest"' + (pushUI.busy ? ' disabled' : '') + '>' + ico('bell', 18) + '<span>Probar aviso</span></button><button type="button" class="btn danger" id="pushOff"' + (pushUI.busy ? ' disabled' : '') + '>Desactivar</button>'
    : '<button type="button" class="btn primary" id="pushOn"' + (pushUI.busy ? ' disabled' : '') + '>' + ico('bell', 18) + '<span>Avisarme los lunes</span></button>';
  sec.hidden = false;
}
async function pushAction(kind){
  if (pushUI.busy) return; pushUI.busy = true; pushUI.error = ''; renderPush();
  try {
    if (kind === 'on'){ await push.enable(); pushUI.on = true; api.toast('Avisos activados en este dispositivo'); }
    else if (kind === 'off'){ await push.disable(); pushUI.on = false; api.toast('Avisos desactivados'); }
    else await push.test();
  } catch(e){
    pushUI.error = e && e.message === 'denied' ? 'No diste permiso para los avisos.' : /push_subscriptions|schema cache/i.test(e && e.message || '') ? 'Falta actualizar la base de datos: ejecuta de nuevo supabase/schema.sql en Supabase.' : 'No se pudo: ' + ((e && e.message) || e);
  }
  pushUI.busy = false; renderPush();
}

/* ====================================================================== Eventos */
export function init(a){
  api = a;
  document.addEventListener('click', e => {
    const day = e.target.closest('[data-day]'); if (day){ sel = day.dataset.day; renderPlan(); return; }
    if (e.target.closest('[data-chat]')){ openChat(); return; }
    if (e.target.closest('[data-report]')){ openReport(); return; }
    if (e.target.closest('[data-ghost-off]')){ ghost = null; renderPlan(); return; }
    const add = e.target.closest('[data-plan-add]'); if (add){ api.openTx(null, {type:'expense', date:add.dataset.planAdd}); return; }
    const rec = e.target.closest('[data-plan-rec]'); if (rec){ api.openRec(null, {day:Number(rec.dataset.planRec), start:sel.slice(0, 7)}); return; }
    const chip = e.target.closest('[data-chip]'); if (chip){ const c = chat.chips[Number(chip.dataset.chip)]; if (!c) return; if (c.act) chipAct(c); else handle(c.say); return; }
    if (e.target.closest('#repPrev')){ openReport(F.addDays(repWeek, -7)); return; }
    if (e.target.closest('#repNext')){ openReport(F.addDays(repWeek, 7)); return; }
    if (e.target.closest('#pushOn')) pushAction('on');
    else if (e.target.closest('#pushOff')) pushAction('off');
    else if (e.target.closest('#pushTest')) pushAction('test');
    // Enlaces dentro de un diálogo (p. ej. «Fijos» en una respuesta del chat): cerrar el diálogo al navegar.
    const link = e.target.closest('dialog a[href^="#"]'); if (link) api.closeDlg(link.closest('dialog'));
  });
  $('#chatForm').addEventListener('submit', e => { e.preventDefault(); const inp = $('#chatIn'), v = inp.value; inp.value = ''; handle(v); });
  // Aviso tocado con la app abierta: el service worker pide abrir el reporte.
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'open-report') openReport(); });
}
