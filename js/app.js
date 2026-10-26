import * as U from './util.js';
import * as store from './store.js';
import * as sync from './sync.js';
import * as charts from './charts.js';
import {ico, paintIcons} from './icons.js';

const {esc, CAT, EXP, INC, catOf} = U;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

/* ---------- Estado de la interfaz ---------- */
const now = U.todayParts();
const view = {y:now.y, m:now.m};
const filters = {q:'', type:'all', cat:'all', sort:'date-desc', allMonths:false};
const VIEWS = ['resumen', 'movimientos', 'presupuestos', 'metas', 'fijos'];
let route = 'resumen', listLimit = 80, renderQueued = false;
const today = () => U.todayStr();
const viewKey = () => U.mk(view.y, view.m);
const isCurrentMonth = () => viewKey() === today().slice(0, 7);

/* ---------- Formato de moneda ---------- */
let nf, cf = new Intl.NumberFormat('es-MX', {notation:'compact', maximumFractionDigits:1}), pf = new Intl.NumberFormat('es-MX', {maximumFractionDigits:1});
function makeNF(){ const cur = store.settings().currency || 'MXN'; try { nf = new Intl.NumberFormat('es-MX', {style:'currency', currency:cur}); } catch(e){ nf = new Intl.NumberFormat('es-MX', {style:'currency', currency:'MXN'}); } }
const money = c => nf.format(c / 100);
const units = v => nf.format(v);
const curSymbol = () => { const p = nf.formatToParts(0).find(x => x.type === 'currency'); return p ? p.value : '$'; };

/* ---------- Toast con deshacer ---------- */
let toastTimer = null;
function toast(msg, actionLabel, fn){
  const el = $('#toast'); clearTimeout(toastTimer);
  el.innerHTML = '<span>' + esc(msg) + '</span>' + (actionLabel ? '<button type="button">' + esc(actionLabel) + '</button>' : '');
  if (actionLabel) el.querySelector('button').onclick = () => { el.classList.remove('show'); fn(); };
  requestAnimationFrame(() => el.classList.add('show'));
  toastTimer = setTimeout(() => el.classList.remove('show'), actionLabel ? 7000 : 3500);
}

/* ---------- Tema ---------- */
function currentTheme(){ const a = document.documentElement.getAttribute('data-theme'); if (a) return a; return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
function renderThemeBtn(){
  const dark = currentTheme() === 'dark', b = $('#themeBtn');
  b.innerHTML = ico(dark ? 'sun' : 'moon'); b.setAttribute('aria-label', dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
  const forced = document.documentElement.getAttribute('data-theme');
  $$('meta[name="theme-color"]').forEach(m => { if (!m.dataset.orig) m.dataset.orig = m.content; m.content = forced ? (dark ? '#0F172A' : '#EAF0FB') : m.dataset.orig; });
}
function setTheme(t){ document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('gastos:theme', t); } catch(e){} renderThemeBtn(); charts.dropAll(); render(); }

/* ---------- Render general ---------- */
/** Agrupa varios cambios en un solo repintado por cuadro. */
function render(){ if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderNow(); }); }
function renderNow(){
  renderPeriod(); renderSync(); renderBanner();
  $$('.cur-sym').forEach(s => s.textContent = curSymbol());
  ({resumen:renderResumen, movimientos:renderList, presupuestos:renderBudgets, metas:renderGoals, fijos:renderRecurring})[route]();
  $('#foot').textContent = !store.storageOk ? 'Tu navegador bloqueó el almacenamiento: exporta un respaldo desde «Datos y ajustes».'
    : sync.enabled ? 'Tus datos se guardan en este dispositivo y se sincronizan con tu cuenta.' : 'Tus datos se guardan solo en este dispositivo.';
}
function renderPeriod(){
  $('#periodLabel').textContent = U.monthLabel(viewKey());
  const t = today().slice(0, 7);
  $('#nextM').disabled = viewKey() >= t;
  $('#periodLabel').disabled = viewKey() === t;
}
function renderBanner(){ $('#banner').hidden = !store.all('transactions').some(t => t.id.startsWith('smp-')); }

const SYNC_UI = {
  local:['device', 'Solo este dispositivo'], idle:['cloud', 'Conectando…'], syncing:['refresh', 'Sincronizando…'],
  ok:['cloud', 'Sincronizado'], pending:['cloud', 'Cambios pendientes'], offline:['cloudOff', 'Sin conexión'], error:['cloudOff', 'Error al sincronizar']
};
function renderSync(){
  const s = sync.status, [icon, label] = SYNC_UI[s.state] || SYNC_UI.idle, b = $('#syncBtn');
  const pending = store.pendingCount();
  const text = s.state === 'offline' && pending ? 'Sin conexión · ' + pending + ' por subir' : label;
  b.dataset.state = s.state;
  b.innerHTML = '<span class="dot" aria-hidden="true"></span>' + ico(icon, 16) + '<span class="lbl">' + text + '</span>';
  b.setAttribute('aria-label', 'Estado de sincronización: ' + text + '. Abrir ajustes');
  b.title = s.error || text;
}

/* ---------- Navegación ---------- */
function setRoute(r, focus){
  route = VIEWS.includes(r) ? r : 'resumen';
  $$('.view').forEach(v => v.hidden = v.dataset.view !== route);
  $$('.tabs a').forEach(a => { if (a.dataset.view === route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  renderNow();
  if (route === 'resumen') requestAnimationFrame(charts.resizeAll);
  if (focus){ window.scrollTo({top:0, behavior:'instant'}); $('#main').focus({preventScroll:true}); }
}

/* ---------- Resumen: KPIs ---------- */
function delta(cur, prev, goodWhenUp){
  if (!prev) return {txt:'Sin datos del mes anterior', cls:'', icon:''};
  const p = (cur - prev) / Math.abs(prev) * 100, up = p >= 0, good = Math.abs(p) < .05 || up === goodWhenUp;
  return {txt:(up ? '+' : '−') + pf.format(Math.abs(p)) + '% vs. mes anterior', cls:good ? 'good' : 'bad', icon:up ? 'up' : 'down'};
}
function renderKPIs(){
  const key = viewKey(), cur = U.sums(store.byMonth(key)), prev = U.sums(store.byMonth(U.addMonths(key, -1))), total = U.sums(store.all('transactions')).net;
  const rate = cur.inc > 0 ? cur.net / cur.inc * 100 : null;
  const dI = delta(cur.inc, prev.inc, true), dE = delta(cur.exp, prev.exp, false), dB = delta(cur.net, prev.net, true);
  const subD = d => '<p class="kpi-sub ' + d.cls + '">' + (d.icon ? ico(d.icon, 14) : '') + '<span>' + d.txt + '</span></p>';
  const card = (cls, label, icon, val, valCls, sub) => '<article class="card kpi"><div class="kpi-top"><h2 class="sr-only">' + label + '</h2><span aria-hidden="true">' + label + '</span><span class="kpi-ico ' + cls + '">' + ico(icon, 18) + '</span></div><p class="kpi-val ' + valCls + '">' + val + '</p>' + sub + '</article>';
  $('#kpis').innerHTML =
    card('income', 'Ingresos', 'inflow', money(cur.inc), '', subD(dI)) +
    card('expense', 'Gastos', 'outflow', money(cur.exp), '', subD(dE)) +
    card('balance', 'Balance del mes', 'wallet', money(cur.net), cur.net < 0 ? 'neg' : '', subD(dB) + '<p class="kpi-sub">Saldo acumulado: ' + money(total) + '</p>') +
    card('rate', 'Tasa de ahorro', 'percent', rate === null ? '—' : pf.format(rate) + '%', rate !== null && rate < 0 ? 'neg' : '', '<p class="kpi-sub">' + (rate === null ? 'Sin ingresos este mes' : rate < 0 ? 'Gastaste más de lo que ingresaste' : rate >= 20 ? 'Vas arriba del 20% recomendado' : 'Meta sugerida: 20% o más') + '</p>');
}

/* ---------- Resumen: indicadores ---------- */
function renderInsights(){
  const key = viewKey(), list = store.byMonth(key), rules = store.all('recurring'), t = today(), out = [];
  const budTotal = store.all('budgets').reduce((s, b) => s + (b.amount || 0), 0);
  const item = (icon, cls, title, body) => '<li class="ins"><span class="ins-ico ' + cls + '">' + ico(icon, 18) + '</span><div><h3>' + title + '</h3>' + body + '</div></li>';
  const s = U.sums(list);

  if (isCurrentMonth()){
    const p = U.projectMonth(list, rules, key, t), limit = budTotal || s.inc;
    const over = limit > 0 && p.projected > limit;
    out.push(item('gauge', over ? 'bad' : 'good', 'Proyección de cierre',
      '<p>A este ritmo terminarás el mes con <strong>' + money(p.projected) + '</strong> en gastos' + (p.fixedPending ? ' (incluye ' + money(p.fixedPending) + ' de fijos por venir)' : '') + '.' +
      (limit > 0 ? ' Eso es ' + (over ? '<strong>' + money(p.projected - limit) + ' más</strong> que' : money(limit - p.projected) + ' menos que') + ' tu ' + (budTotal ? 'presupuesto' : 'ingreso') + ' del mes.' : '') + '</p>'));
  } else if (s.exp || s.inc){
    out.push(item('gauge', s.net < 0 ? 'bad' : 'good', 'Mes cerrado', '<p>Gastaste <strong>' + money(s.exp) + '</strong> e ingresaste <strong>' + money(s.inc) + '</strong>.</p>'));
  }

  const r = U.rule503020(list);
  if (r.inc > 0){
    const pc = v => Math.max(0, v / r.inc * 100), save = Math.max(0, r.save);
    out.push(item('scale', pc(r.need) > 50 || r.save < 0 ? 'warn' : 'good', 'Regla 50/30/20',
      '<div class="split" role="img" aria-label="Necesidades ' + pf.format(pc(r.need)) + '%, deseos ' + pf.format(pc(r.want)) + '%, ahorro ' + pf.format(pc(save)) + '% de tus ingresos">' +
      '<span style="width:' + Math.min(100, pc(r.need)) + '%;background:var(--primary)"></span><span style="width:' + Math.min(100, pc(r.want)) + '%;background:var(--warn)"></span><span style="width:' + Math.min(100, pc(save)) + '%;background:var(--income)"></span></div>' +
      '<p class="split-legend"><span><i style="background:var(--primary)"></i>Necesidades ' + pf.format(pc(r.need)) + '% <small>(50)</small></span><span><i style="background:var(--warn)"></i>Deseos ' + pf.format(pc(r.want)) + '% <small>(30)</small></span><span><i style="background:var(--income)"></i>Ahorro ' + (r.save < 0 ? '−' : '') + pf.format(Math.abs(r.save) / r.inc * 100) + '% <small>(20)</small></span></p>'));
  } else {
    out.push(item('scale', '', 'Regla 50/30/20', '<p>Registra tus ingresos del mes para ver cómo se reparte tu dinero entre necesidades, deseos y ahorro.</p>'));
  }

  const e = U.emergencyMonths(store.all('transactions'), today().slice(0, 7));
  if (e && e.months !== null){
    const m = e.months, cls = m >= 6 ? 'good' : m >= 3 ? 'warn' : 'bad';
    out.push(item('shield', cls, 'Fondo de emergencia', '<p>Tu saldo cubre <strong>' + (m <= 0 ? '0' : pf.format(m)) + ' ' + (Math.abs(m - 1) < .05 ? 'mes' : 'meses') + '</strong> de gastos (promedio ' + money(e.avg) + '/mes). Lo recomendado son 3 a 6 meses.</p>'));
  }

  const buds = store.all('budgets').filter(b => b.amount > 0), by = U.byCategory(list);
  const over = buds.filter(b => (by[b.id] || 0) > b.amount), near = buds.filter(b => { const p = (by[b.id] || 0) / b.amount; return p >= .8 && p <= 1; });
  if (over.length || near.length){
    out.push(item('alert', over.length ? 'bad' : 'warn', 'Presupuestos',
      '<p>' + (over.length ? '<strong>' + over.map(b => esc(catOf(b.id).name)).join(', ') + '</strong> ' + (over.length > 1 ? 'superaron' : 'superó') + ' su límite. ' : '') +
      (near.length ? near.map(b => esc(catOf(b.id).name)).join(', ') + (near.length > 1 ? ' están' : ' está') + ' por arriba del 80%. ' : '') + '<a href="#presupuestos">Revisar</a></p>'));
  }

  const cards = U.byCard(list).slice(0, 4);
  if (cards.length){
    const total = U.sums(list).exp;
    out.push(item('card', '', 'Gasto por tarjeta',
      '<ul class="upcoming">' + cards.map(([name, v]) => '<li><span>' + esc(name) + '</span><span>' + money(v) + (total ? ' <small>(' + pf.format(v / total * 100) + '%)</small>' : '') + '</span></li>').join('') + '</ul>'));
  }

  const up = rules.map(rr => ({r:rr, n:U.nextDue(rr, t)})).filter(x => x.r.active && x.n && x.n.date <= U.addMonths(t.slice(0, 7), 1) + t.slice(7))
    .sort((a, b) => a.n.date < b.n.date ? -1 : 1).slice(0, 4);
  out.push(item('calendar', '', 'Próximos fijos', up.length
    ? '<ul class="upcoming">' + up.map(x => '<li><span>' + esc(x.r.name) + ' · ' + U.fmtDate(x.n.date).replace(/ \d{4}$/, '') + '</span><span class="' + (x.r.type === 'income' ? 'tx-amt income' : '') + '">' + (x.r.type === 'income' ? '+' : '−') + money(x.r.amount) + '</span></li>').join('') + '</ul>'
    : '<p>Sin pagos en los próximos 30 días. <a href="#fijos">Agrega renta, suscripciones o tu quincena</a> para que se registren solos.</p>'));

  $('#insights').innerHTML = out.join('');
}

/* ---------- Resumen: gráficas ---------- */
function renderDonut(C){
  const key = viewKey(), by = U.byCategory(store.byMonth(key));
  const rows = Object.entries(by).sort((a, b) => b[1] - a[1]), total = rows.reduce((s, r) => s + r[1], 0);
  $('#donutSub').textContent = U.monthLabel(key);
  const has = total > 0;
  $('#donutWrap').hidden = !has; $('#donutEmpty').hidden = has;
  if (!has){ charts.drop('donut'); return; }
  $('#donutTotal').textContent = money(total);
  $('#legend').innerHTML = rows.map(([id, v]) => {
    const c = catOf(id), p = v / total * 100;
    return '<li><button type="button" class="lg-item" data-cat="' + esc(id) + '" style="--c:' + c.color + '" aria-label="Ver movimientos de ' + esc(c.name) + ': ' + money(v) + ', ' + pf.format(p) + '%"><span class="lg-dot" aria-hidden="true"></span><span>' + esc(c.name) + '</span><span class="lg-amt">' + money(v) + '</span><span class="lg-pct">' + pf.format(p) + '%</span></button></li>';
  }).join('');
  const top = rows[0];
  $('#donutCanvas').setAttribute('aria-label', 'Gráfica de dona de gastos por categoría. Mayor categoría: ' + catOf(top[0]).name + ', ' + pf.format(top[1] / total * 100) + '%. Los detalles están en la lista contigua.');
  charts.upsert('donut', $('#donutCanvas'), {
    type:'doughnut',
    data:{labels:rows.map(r => catOf(r[0]).name), datasets:[{data:rows.map(r => r[1] / 100), backgroundColor:rows.map(r => catOf(r[0]).color), borderColor:C.gap, borderWidth:3, hoverOffset:6}]},
    options:{responsive:true, maintainAspectRatio:false, cutout:'70%', plugins:{legend:{display:false}, tooltip:{callbacks:{label:ctx => ' ' + units(ctx.parsed) + ' (' + pf.format(ctx.parsed / (total / 100) * 100) + '%)'}}}}
  });
}
function renderBars(C){
  const labels = [], inc = [], exp = [], net = [];
  for (let i = 5; i >= 0; i--){
    const k = U.addMonths(viewKey(), -i), s = U.sums(store.byMonth(k)), {y, m} = U.parseKey(k);
    labels.push(U.MSHORT[m] + ' ' + String(y).slice(2)); inc.push(s.inc / 100); exp.push(s.exp / 100); net.push(s.net / 100);
  }
  const has = inc.some(v => v) || exp.some(v => v);
  $('#barsBox').hidden = !has; $('#barsEmpty').hidden = has; $('#barsDetails').hidden = !has;
  if (!has){ charts.drop('bars'); return; }
  $('#barsTable').innerHTML = '<table><thead><tr><th scope="col">Mes</th><th scope="col">Ingresos</th><th scope="col">Gastos</th><th scope="col">Balance</th></tr></thead><tbody>' +
    labels.map((l, i) => '<tr><th scope="row" style="font-weight:500">' + l + '</th><td>' + units(inc[i]) + '</td><td>' + units(exp[i]) + '</td><td>' + units(net[i]) + '</td></tr>').join('') + '</tbody></table>';
  charts.upsert('bars', $('#barsCanvas'), {
    data:{labels, datasets:[
      {type:'bar', label:'Ingresos', data:inc, backgroundColor:C.income, borderRadius:6, maxBarThickness:30, order:2},
      {type:'bar', label:'Gastos', data:exp, backgroundColor:C.expense, borderRadius:6, maxBarThickness:30, order:2},
      {type:'line', label:'Balance', data:net, borderColor:C.primary, backgroundColor:C.primary, borderWidth:2, borderDash:[6, 4], pointStyle:'rectRot', pointRadius:5, tension:.3, order:1}
    ]},
    options:{responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false},
      plugins:{legend:{position:'bottom', labels:{usePointStyle:true, boxWidth:8, color:C.text}}, tooltip:{callbacks:{label:ctx => ' ' + ctx.dataset.label + ': ' + units(ctx.parsed.y)}}},
      scales:{x:{grid:{display:false}, ticks:{color:C.muted}}, y:{grid:{color:C.grid}, ticks:{color:C.muted, callback:v => cf.format(v)}}}}
  });
}
function renderFlow(C){
  const key = viewKey(), list = store.byMonth(key), dim = U.daysIn(view.y, view.m);
  const has = list.length > 0;
  $('#flowBox').hidden = !has; $('#flowEmpty').hidden = has;
  if (!has){ charts.drop('flow'); return; }
  const t = today(), last = isCurrentMonth() ? Number(t.slice(8, 10)) : dim;
  const di = new Array(dim).fill(0), de = new Array(dim).fill(0);
  list.forEach(x => { const d = Number(x.date.slice(8, 10)) - 1; if (x.type === 'income') di[d] += x.amount; else de[d] += x.amount; });
  let ci = 0, ce = 0; const si = [], se = [];
  for (let i = 0; i < dim; i++){ ci += di[i]; ce += de[i]; si.push(i < last ? ci / 100 : null); se.push(i < last ? ce / 100 : null); }
  const budgetTotal = store.all('budgets').reduce((s, b) => s + (b.amount || 0), 0) / 100;
  const datasets = [
    {label:'Gastos acumulados', data:se, borderColor:C.expense, backgroundColor:C.expense + '22', fill:true, borderWidth:2.5, pointRadius:0, pointHoverRadius:5, tension:.25},
    {label:'Ingresos acumulados', data:si, borderColor:C.income, backgroundColor:C.income, borderWidth:2.5, borderDash:[8, 5], pointRadius:0, pointHoverRadius:5, tension:.25}
  ];
  if (budgetTotal > 0) datasets.push({label:'Presupuesto total', data:new Array(dim).fill(budgetTotal), borderColor:C.primary, borderWidth:1.5, borderDash:[2, 4], pointRadius:0, pointHoverRadius:0, fill:false});
  $('#flowCanvas').setAttribute('aria-label', 'Flujo acumulado del mes. Gastos: ' + units(ce / 100) + '. Ingresos: ' + units(ci / 100) + '.');
  charts.upsert('flow', $('#flowCanvas'), {
    type:'line',
    data:{labels:Array.from({length:dim}, (_, i) => String(i + 1)), datasets},
    options:{responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false}, spanGaps:false,
      plugins:{legend:{position:'bottom', labels:{usePointStyle:true, boxWidth:8, color:C.text}}, tooltip:{callbacks:{title:items => 'Día ' + items[0].label, label:ctx => ctx.parsed.y == null ? null : ' ' + ctx.dataset.label + ': ' + units(ctx.parsed.y)}}},
      scales:{x:{grid:{display:false}, ticks:{color:C.muted, maxTicksLimit:10}}, y:{beginAtZero:true, grid:{color:C.grid}, ticks:{color:C.muted, callback:v => cf.format(v)}}}}
  });
}
function renderResumen(){
  renderReview(); renderKPIs(); renderInsights();
  if (charts.available()){ const C = charts.palette(); renderDonut(C); renderBars(C); renderFlow(C); }
  else ['#donutWrap', '#barsBox', '#flowBox'].forEach(s => { $(s).hidden = true; });
  const recent = store.all('transactions').sort(cmpDateDesc).slice(0, 5);
  $('#recentList').innerHTML = recent.length ? recent.map(t => txRow(t, true)).join('') : emptyTx();
}

/* ---------- Movimientos ---------- */
const cmpDateDesc = (a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : (b.created || 0) - (a.created || 0);
function filteredTx(){
  const q = U.norm(filters.q.trim());
  const src = filters.allMonths ? store.all('transactions') : store.byMonth(viewKey());
  const list = src.filter(t => {
    if (filters.type !== 'all' && t.type !== filters.type) return false;
    if (filters.cat !== 'all' && t.category !== filters.cat) return false;
    if (q && !U.norm((t.description || '') + ' ' + catOf(t.category).name + ' ' + U.fmtDate(t.date) + ' ' + (t.amount / 100)).includes(q)) return false;
    return true;
  });
  const s = filters.sort;
  list.sort((a, b) => s === 'amt-desc' ? b.amount - a.amount : s === 'amt-asc' ? a.amount - b.amount : s === 'date-asc' ? -cmpDateDesc(a, b) : cmpDateDesc(a, b));
  return list;
}
function txBtn(t, withDate){
  const c = catOf(t.category), title = t.description || c.name, sign = t.type === 'income' ? '+' : '−';
  const lead = t.recurring_id ? ico('repeat', 12) : t.source === 'wallet' ? ico('device', 12) : '';
  return '<button type="button" class="tx" data-tx="' + esc(t.id) + '" style="--c:' + c.color + '" aria-label="' + esc(title) + ', ' + (t.type === 'income' ? 'ingreso' : 'gasto') + ' de ' + money(t.amount) + ', ' + U.fmtDate(t.date) + (t.review ? ', por revisar' : '') + '. Editar">' +
    '<span class="catdot">' + ico(c.icon, 20) + '</span>' +
    '<span class="tx-main"><span class="tx-title" style="display:block">' + esc(title) + '</span><span class="tx-meta">' + lead + esc(c.name) + (withDate ? ' · ' + U.fmtDate(t.date) : '') + (t.card ? ' · ' + esc(t.card) : '') + (t.review ? ' <span class="badge warn">Por revisar</span>' : '') + '</span></span>' +
    '<span class="tx-amt ' + t.type + '">' + sign + money(t.amount) + '</span></button>';
}
const txRow = (t, withDate) => '<li>' + txBtn(t, withDate) + '</li>';

/* ---------- Bandeja "por revisar" (gastos que llegan solos desde Apple Pay) ---------- */
const REVIEW_SHOWN = 6;
const pendingReview = () => store.all('transactions').filter(t => t.review).sort(cmpDateDesc);
function renderReview(){
  const list = pendingReview(), box = $('#reviewCard');
  box.hidden = !list.length; if (!list.length) return;
  $('#reviewTitle').textContent = list.length === 1 ? '1 gasto por revisar' : list.length + ' gastos por revisar';
  $('#reviewList').innerHTML = list.slice(0, REVIEW_SHOWN).map(t =>
    '<li class="rv">' + txBtn(t, true) + '<button type="button" class="icon-btn" data-confirm="' + esc(t.id) + '" aria-label="Confirmar ' + esc(t.description || catOf(t.category).name) + ' tal como está" title="Confirmar">' + ico('check', 20) + '</button></li>').join('');
  $('#reviewMore').textContent = list.length > REVIEW_SHOWN ? 'Y ' + (list.length - REVIEW_SHOWN) + ' más. Confirma los que ya revisaste para ver el resto.' : '';
  $('#reviewMore').hidden = list.length <= REVIEW_SHOWN;
}
function confirmReview(ids){
  const prev = ids.map(id => store.get('transactions', id)).filter(Boolean).map(t => t.id);
  prev.forEach(id => store.put('transactions', {id, review:false}));
  if (prev.length) toast(prev.length === 1 ? 'Gasto confirmado' : prev.length + ' gastos confirmados', 'Deshacer', () => prev.forEach(id => store.put('transactions', {id, review:true})));
}
/** Guarda «este comercio → esta categoría» y la aplica a los demás pendientes del mismo comercio. Devuelve cuántos actualizó. */
function learnRule(merchant, category){
  const key = U.merchantKey(merchant); if (!key) return 0;
  const name = merchant.replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim(); // sin el número de sucursal
  store.put('merchant_rules', {id:key.slice(0, 60), name:name.slice(0, 60), category});
  let n = 0;
  for (const t of pendingReview()){
    if (t.type === 'expense' && t.merchant && U.merchantKey(t.merchant) === key){ store.put('transactions', {id:t.id, category, review:false}); n++; }
  }
  return n;
}
const emptyTx = () => '<li class="empty">' + ico('inbox', 28) + (store.all('transactions').length === 0 ? 'Aún no tienes movimientos. Toca «Agregar» para registrar tu primer ingreso o gasto.' : 'No hay movimientos con estos filtros.') + '</li>';
function renderList(){
  const all = filteredTx(), shown = all.slice(0, listLimit), s = U.sums(all);
  const scope = filters.allMonths ? 'en todo el historial' : 'en ' + U.monthLabel(viewKey()).toLowerCase();
  $('#listSummary').textContent = all.length ? all.length + (all.length === 1 ? ' movimiento ' : ' movimientos ') + scope + ' · Ingresos ' + money(s.inc) + ' · Gastos ' + money(s.exp) : '';
  if (!all.length){ $('#txList').innerHTML = '<ul class="tx-list">' + emptyTx() + '</ul>'; }
  else if (filters.sort.startsWith('date')){
    // Agrupado por día, con el neto de cada día.
    const groups = []; let g = null;
    for (const t of shown){ if (!g || g.date !== t.date){ g = {date:t.date, items:[], net:0}; groups.push(g); } g.items.push(t); g.net += t.type === 'income' ? t.amount : -t.amount; }
    const td = today();
    $('#txList').innerHTML = groups.map(g => '<h2 class="day-head"><span>' + U.fmtDay(g.date, td) + '</span><span>' + (g.net >= 0 ? '+' : '−') + money(Math.abs(g.net)) + '</span></h2><ul class="tx-list">' + g.items.map(t => txRow(t, false)).join('') + '</ul>').join('');
  } else {
    $('#txList').innerHTML = '<ul class="tx-list">' + shown.map(t => txRow(t, true)).join('') + '</ul>';
  }
  const more = $('#moreBtn'); more.hidden = all.length <= listLimit;
  more.textContent = 'Mostrar más (' + (all.length - listLimit) + ' restantes)';
}

/* ---------- Presupuestos ---------- */
function renderBudgets(){
  const spentBy = U.byCategory(store.byMonth(viewKey()));
  let tb = 0, ts = 0;
  // No repintar el campo que se está editando.
  const active = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.bud : null;
  $('#budList').innerHTML = EXP.map(c => {
    const spent = spentBy[c.id] || 0, b = store.get('budgets', c.id), bud = b ? b.amount : 0;
    let bar = '', msg = '<p class="bud-msg">Sin límite definido</p>';
    if (bud > 0){
      tb += bud; ts += spent;
      const pct = spent / bud * 100, cls = pct > 100 ? 'over' : pct >= 80 ? 'warn' : '';
      const text = pct > 100 ? 'Excedido por ' + money(spent - bud) : pct === 100 ? 'Presupuesto agotado' : 'Quedan ' + money(bud - spent) + ' (' + Math.floor(pct) + '% usado)';
      bar = '<div class="bar ' + cls + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.min(Math.round(pct), 100) + '" aria-label="' + esc(c.name) + ': ' + Math.round(pct) + '% del presupuesto"><span style="width:' + Math.min(100, pct) + '%"></span></div>';
      msg = '<p class="bud-msg ' + cls + '">' + (cls ? ico('alert', 14) : '') + text + '</p>';
    }
    return '<li class="bud-row" style="--c:' + c.color + '"><div class="bud-top"><span class="catdot">' + ico(c.icon, 18) + '</span><div class="bud-name"><label for="bud-' + c.id + '">' + esc(c.name) + '</label><span class="bud-spent">Gastado: ' + money(spent) + '</span></div><input id="bud-' + c.id + '" class="bud-input" data-bud="' + c.id + '" type="text" inputmode="decimal" autocomplete="off" placeholder="Sin límite" value="' + U.centsToInput(bud) + '" aria-label="Presupuesto mensual de ' + esc(c.name) + '"></div>' + bar + msg + '</li>';
  }).join('');
  if (active){ const el = $('#bud-' + active); if (el) el.focus(); }
  const tot = $('#budTotal'); tot.hidden = tb === 0;
  if (tb){
    const pct = ts / tb * 100, cls = pct > 100 ? 'over' : pct >= 80 ? 'warn' : '';
    tot.innerHTML = '<p><strong>' + money(ts) + '</strong> de ' + money(tb) + ' presupuestado en ' + U.monthLabel(viewKey()).toLowerCase() + '</p><div class="bar ' + cls + '" style="margin-top:8px" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.min(100, Math.round(pct)) + '" aria-label="Presupuesto total usado"><span style="width:' + Math.min(100, pct) + '%"></span></div>';
  }
  $('#budSub').textContent = 'Límite mensual por categoría · se avisa al llegar al 80%';
}

/* ---------- Metas ---------- */
const GOAL_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#06B6D4', '#F97316', '#84CC16'];
function renderGoals(){
  const goals = store.all('goals').sort((a, b) => (a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1), t = today();
  if (!goals.length){
    $('#goalList').innerHTML = '<div class="card empty">' + ico('target', 32) + '<p>Aún no tienes metas. Crea una para tu fondo de emergencia, un viaje o el enganche de algo grande.</p></div>';
    return;
  }
  $('#goalList').innerHTML = goals.map(g => {
    const pct = Math.min(100, g.saved / g.target * 100), plan = U.goalPlan(g, t);
    let planTxt, cls = '';
    if (plan.left === 0){ planTxt = ico('check', 16) + '<span>¡Meta cumplida!</span>'; cls = 'done'; }
    else if (plan.late){ planTxt = ico('alert', 16) + '<span>La fecha límite pasó; faltan ' + money(plan.left) + '.</span>'; cls = 'late'; }
    else if (plan.monthly){ planTxt = ico('calendar', 16) + '<span>Aparta <strong>' + money(plan.monthly) + '</strong> al mes durante ' + plan.months + (plan.months === 1 ? ' mes' : ' meses') + ' (hasta ' + U.fmtDate(g.deadline) + ').</span>'; }
    else planTxt = ico('target', 16) + '<span>Faltan ' + money(plan.left) + '. Agrega una fecha límite para calcular cuánto apartar al mes.</span>';
    return '<article class="card goal" style="--c:' + esc(g.color) + '"><div class="goal-top"><div class="goal-ring" style="--p:' + pct.toFixed(1) + '" role="img" aria-label="' + Math.floor(pct) + '% completado"><span>' + Math.floor(pct) + '%</span></div><div><h2>' + esc(g.name) + '</h2><p class="goal-amt"><strong>' + money(g.saved) + '</strong> de ' + money(g.target) + '</p></div></div>' +
      '<p class="goal-plan ' + cls + '">' + planTxt + '</p><div class="goal-actions"><button type="button" class="btn primary" data-contrib="' + esc(g.id) + '">' + ico('plus', 18) + '<span>Abonar</span></button><button type="button" class="btn" data-goal="' + esc(g.id) + '">' + ico('pencil', 18) + '<span>Editar</span></button></div></article>';
  }).join('');
}

/* ---------- Fijos (recurrentes) ---------- */
function renderRecurring(){
  const rules = store.all('recurring').sort((a, b) => (b.active - a.active) || (a.type === b.type ? b.amount - a.amount : a.type === 'income' ? -1 : 1)), t = today(), key = viewKey();
  const appliesIn = r => { const i = U.monthDiff(r.start_month.slice(0, 7), key); return r.active && i >= 0 && (!r.occurrences || i < r.occurrences); };
  let fe = 0, fi = 0; rules.forEach(r => { if (appliesIn(r)){ if (r.type === 'income') fi += r.amount; else fe += r.amount; } });
  const kpi = (label, val, sub) => '<article class="card kpi"><div class="kpi-top"><span>' + label + '</span></div><p class="kpi-val">' + val + '</p><p class="kpi-sub">' + sub + '</p></article>';
  $('#recSummary').innerHTML = kpi('Gastos fijos del mes', money(fe), U.monthLabel(key)) + kpi('Ingresos fijos del mes', money(fi), 'Quincenas, rentas cobradas…') +
    kpi('Comprometido', fi ? pf.format(fe / fi * 100) + '%' : '—', fi ? 'De tus ingresos fijos ya tiene destino' : 'Agrega tus ingresos fijos');
  if (!rules.length){ $('#recList').innerHTML = '<div class="empty">' + ico('repeat', 32) + '<p>Registra lo que pagas o cobras cada mes y se anotará solo el día que toque.</p></div>'; return; }
  $('#recList').innerHTML = rules.map(r => {
    const c = catOf(r.category), n = U.nextDue(r, t);
    const idx = U.monthDiff(r.start_month.slice(0, 7), t.slice(0, 7)) + 1;
    let meta = 'Día ' + r.day + ' · ' + esc(c.name);
    if (r.occurrences) meta += ' · ' + (idx > r.occurrences ? 'Terminado (' + r.occurrences + ' pagos)' : 'Pago ' + Math.max(1, Math.min(idx, r.occurrences)) + ' de ' + r.occurrences);
    if (!r.active) meta += ' · <span class="badge">Pausado</span>';
    else if (n) meta += ' · Próximo: ' + U.fmtDate(n.date);
    return '<div class="rec' + (r.active ? '' : ' paused') + '" style="--c:' + c.color + '"><span class="catdot">' + ico(c.icon, 20) + '</span><div style="min-width:0"><p class="rec-name">' + esc(r.name) + '</p><p class="rec-meta">' + meta + '</p></div>' +
      '<p class="tx-amt ' + r.type + '">' + (r.type === 'income' ? '+' : '−') + money(r.amount) + '</p>' +
      '<div class="rec-acts"><button type="button" class="icon-btn" data-rec-toggle="' + esc(r.id) + '" aria-label="' + (r.active ? 'Pausar ' : 'Reanudar ') + esc(r.name) + '" title="' + (r.active ? 'Pausar' : 'Reanudar') + '">' + ico(r.active ? 'pause' : 'play', 18) + '</button><button type="button" class="icon-btn" data-rec="' + esc(r.id) + '" aria-label="Editar ' + esc(r.name) + '">' + ico('pencil', 18) + '</button></div></div>';
  }).join('');
}

/** Registra los movimientos de los fijos que ya vencieron (ids deterministas: no se duplican entre dispositivos). */
function generateRecurring(){
  if (!sync.ready()) return;
  const pend = U.pendingRecurring(store.all('recurring'), id => store.has('transactions', id), today());
  if (pend.length){ store.putMany('transactions', pend.map(t => Object.assign(t, {created:Date.now()}))); toast(pend.length === 1 ? 'Se registró 1 movimiento fijo' : 'Se registraron ' + pend.length + ' movimientos fijos'); }
}

/* ---------- Utilidades de formularios ---------- */
function setErr(id, msg){
  const p = $('#' + id + 'Err'), inp = $('#' + id);
  if (p){ p.textContent = msg || ''; p.hidden = !msg; }
  if (inp){ if (msg){ inp.setAttribute('aria-invalid', 'true'); inp.setAttribute('aria-describedby', id + 'Err'); } else { inp.removeAttribute('aria-invalid'); inp.removeAttribute('aria-describedby'); } }
}
function bindSeg(seg, onPick){
  const pick = v => { $$('button', seg).forEach(b => { const on = b.dataset.type === v; b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; }); onPick(v); };
  seg.addEventListener('click', e => { const b = e.target.closest('button[data-type]'); if (b) pick(b.dataset.type); });
  seg.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault(); const bs = $$('button', seg), i = bs.findIndex(b => b.getAttribute('aria-checked') === 'true'), n = bs[(i + 1) % bs.length]; pick(n.dataset.type); n.focus();
  });
  return pick;
}
function openDlg(d){ if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
function closeDlg(d){ if (d.close) d.close(); else d.removeAttribute('open'); }
function amountRule(id, opts = {}){
  const v = $('#' + id).value; if (!v.trim() && opts.optional) return '';
  const n = U.parseAmount(v); if (!(n > 0) || n > 999999999.99) return 'Escribe un monto mayor a 0 (por ejemplo, 250.50).'; return '';
}

/* ---------- Diálogo de movimiento ---------- */
const txDlg = () => $('#txDlg');
let txType = 'expense', txEditing = null, pickTxType;
function renderCatGrid(type, selected){
  $('#fCats').innerHTML = (type === 'income' ? INC : EXP).map(c => '<label class="cat-opt" style="--c:' + c.color + '"><input type="radio" name="fcat" value="' + c.id + '"' + (c.id === selected ? ' checked' : '') + '><span>' + ico(c.icon, 22) + esc(c.name) + '</span></label>').join('');
}
const txRules = {
  fAmount:() => amountRule('fAmount'),
  fCats:() => $('input[name="fcat"]:checked') ? '' : 'Elige una categoría.',
  fDate:() => /^\d{4}-\d{2}-\d{2}$/.test($('#fDate').value) ? '' : 'Elige una fecha.'
};
const txLabels = {fAmount:'Monto', fCats:'Categoría', fDate:'Fecha'};
function openTx(id, preset){
  const t = id ? store.get('transactions', id) : null;
  txEditing = t ? t.id : null;
  const type = t ? t.type : (preset && preset.type) || 'expense';
  pickTxType(type);
  renderCatGrid(type, t ? t.category : preset && preset.category);
  $('#fAmount').value = t ? (t.amount / 100).toFixed(2) : '';
  $('#fDate').value = t ? t.date : (isCurrentMonth() ? today() : viewKey() + '-01');
  $('#fDesc').value = t ? t.description || '' : '';
  $('#fCard').value = t ? t.card || '' : '';
  $('#cardList').innerHTML = [...new Set(store.all('transactions').map(x => x.card).filter(Boolean))].sort().map(c => '<option value="' + esc(c) + '"></option>').join('');
  // «Recordar comercio» solo aplica a gastos que traen comercio (los de Wallet).
  const canLearn = !!(t && t.merchant && t.type === 'expense' && U.merchantKey(t.merchant));
  $('#fRememberRow').hidden = !canLearn; $('#fRemember').checked = canLearn && !!t.review;
  if (canLearn) $('#fRememberTxt').textContent = 'Recordar: cuando el comercio sea «' + t.merchant + '», usar esta categoría';
  Object.keys(txRules).forEach(k => setErr(k, '')); $('#errSummary').hidden = true;
  $('#txTitle').textContent = t ? 'Editar movimiento' : 'Nuevo movimiento';
  $('#fDelete').hidden = !t;
  const rule = t && t.recurring_id ? store.get('recurring', t.recurring_id) : null;
  $('#fRecHint').hidden = !(t && t.recurring_id);
  $('#fRecHint').textContent = rule ? 'Generado por el fijo «' + rule.name + '». Cambiarlo aquí no modifica los siguientes.' : 'Generado por un pago fijo.';
  renderTxSubmit();
  openDlg(txDlg());
  if (!t) setTimeout(() => $('#fAmount').focus(), 50);
}
function renderTxSubmit(){ $('#fSubmit').textContent = txEditing ? 'Guardar cambios' : (txType === 'income' ? 'Agregar ingreso' : 'Agregar gasto'); }
function submitTx(){
  const errs = [];
  Object.keys(txRules).forEach(k => { const m = txRules[k](); setErr(k, m); if (m) errs.push({id:k, m}); });
  const box = $('#errSummary');
  if (errs.length){
    box.innerHTML = '<h3>Revisa estos campos</h3><ul>' + errs.map(e => '<li><button type="button" class="linklike" data-focus="' + e.id + '">' + txLabels[e.id] + ': ' + esc(e.m) + '</button></li>').join('') + '</ul>';
    box.hidden = false; box.focus(); return;
  }
  box.hidden = true;
  const rec = {type:txType, category:$('input[name="fcat"]:checked').value, date:$('#fDate').value, amount:U.toCents(U.parseAmount($('#fAmount').value)), description:$('#fDesc').value.trim().slice(0, 120), card:$('#fCard').value.trim().slice(0, 40) || null};
  const [y, m] = rec.date.split('-').map(Number); view.y = y; view.m = m - 1;
  if (txEditing){
    const orig = store.get('transactions', txEditing);
    store.put('transactions', Object.assign({id:txEditing, review:false}, rec)); closeDlg(txDlg());
    const learned = orig && !$('#fRememberRow').hidden && $('#fRemember').checked && txType === 'expense' ? learnRule(orig.merchant, rec.category) : -1;
    toast(learned < 0 ? 'Cambios guardados' : 'Comercio recordado' + (learned ? ' · se actualizaron ' + learned + ' más' : ''));
  } else {
    const t = store.put('transactions', Object.assign({id:U.uid(), recurring_id:null, created:Date.now()}, rec));
    closeDlg(txDlg());
    toast((rec.type === 'income' ? 'Ingreso: ' : 'Gasto: ') + money(rec.amount) + ' en ' + catOf(rec.category).name, 'Deshacer', () => store.remove('transactions', t.id));
  }
}
function deleteTx(id){
  const t = store.remove('transactions', id); if (!t) return;
  closeDlg(txDlg());
  toast('Movimiento eliminado', 'Deshacer', () => store.put('transactions', Object.assign({}, t)));
}

/* ---------- Diálogo de meta ---------- */
let goalEditing = null;
function openGoal(id){
  const g = id ? store.get('goals', id) : null; goalEditing = g ? g.id : null;
  $('#goalTitle').textContent = g ? 'Editar meta' : 'Nueva meta';
  $('#gName').value = g ? g.name : ''; $('#gTarget').value = g ? U.centsToInput(g.target) : ''; $('#gSaved').value = g ? U.centsToInput(g.saved) : '';
  $('#gDeadline').value = g && g.deadline ? g.deadline : '';
  const col = g ? g.color : GOAL_COLORS[store.all('goals').length % GOAL_COLORS.length];
  $('#gColors').innerHTML = GOAL_COLORS.map((c, i) => '<label style="--c:' + c + '"><input type="radio" name="gcolor" value="' + c + '"' + (c === col ? ' checked' : '') + ' aria-label="Color ' + (i + 1) + '">' + ico('check', 20) + '<span class="ring"></span></label>').join('');
  ['gName', 'gTarget', 'gSaved'].forEach(k => setErr(k, ''));
  $('#gDelete').hidden = !g;
  openDlg($('#goalDlg')); if (!g) setTimeout(() => $('#gName').focus(), 50);
}
function submitGoal(){
  const e = {gName:$('#gName').value.trim() ? '' : 'Ponle un nombre a tu meta.', gTarget:amountRule('gTarget'), gSaved:amountRule('gSaved', {optional:true})};
  if (!e.gSaved && $('#gSaved').value.trim() === '0') e.gSaved = '';
  Object.entries(e).forEach(([k, m]) => setErr(k, m));
  const first = Object.keys(e).find(k => e[k]); if (first){ $('#' + first).focus(); return; }
  const saved = $('#gSaved').value.trim() ? U.toCents(U.parseAmount($('#gSaved').value) || 0) : 0;
  store.put('goals', {id:goalEditing || U.uid(), name:$('#gName').value.trim().slice(0, 60), target:U.toCents(U.parseAmount($('#gTarget').value)), saved, deadline:$('#gDeadline').value || null, color:($('input[name="gcolor"]:checked') || {}).value || GOAL_COLORS[0]});
  closeDlg($('#goalDlg')); toast(goalEditing ? 'Meta actualizada' : 'Meta creada');
}
let contribGoal = null, contribMode = 'add', pickContrib;
function openContrib(id){
  const g = store.get('goals', id); if (!g) return; contribGoal = id;
  pickContrib('add'); $('#cAmount').value = ''; setErr('cAmount', '');
  $('#cTitle').textContent = g.name;
  $('#cHint').textContent = 'Llevas ' + money(g.saved) + ' de ' + money(g.target) + '.';
  openDlg($('#contribDlg')); setTimeout(() => $('#cAmount').focus(), 50);
}
function submitContrib(){
  const m = amountRule('cAmount'); setErr('cAmount', m); if (m){ $('#cAmount').focus(); return; }
  const g = store.get('goals', contribGoal); if (!g) return;
  const amt = U.toCents(U.parseAmount($('#cAmount').value)), before = g.saved;
  const saved = contribMode === 'add' ? before + amt : Math.max(0, before - amt);
  store.put('goals', {id:g.id, saved}); closeDlg($('#contribDlg'));
  toast((contribMode === 'add' ? 'Abonaste ' : 'Retiraste ') + money(amt) + ' a ' + g.name, 'Deshacer', () => store.put('goals', {id:g.id, saved:before}));
}

/* ---------- Diálogo de fijo ---------- */
let recEditing = null, recType = 'expense', pickRecType;
function fillRecCats(type, sel){ $('#rCat').innerHTML = '<option value="">Elige una categoría</option>' + (type === 'income' ? INC : EXP).map(c => '<option value="' + c.id + '"' + (c.id === sel ? ' selected' : '') + '>' + esc(c.name) + '</option>').join(''); }
function openRec(id){
  const r = id ? store.get('recurring', id) : null; recEditing = r ? r.id : null;
  pickRecType(r ? r.type : 'expense'); fillRecCats(recType, r ? r.category : '');
  $('#recTitle').textContent = r ? 'Editar fijo' : 'Nuevo fijo';
  $('#rName').value = r ? r.name : ''; $('#rAmount').value = r ? U.centsToInput(r.amount) : '';
  $('#rDay').value = r ? r.day : Number(today().slice(8, 10)); $('#rStart').value = r ? r.start_month.slice(0, 7) : today().slice(0, 7);
  $('#rOcc').value = r && r.occurrences ? r.occurrences : '';
  ['rName', 'rAmount', 'rCat', 'rDay', 'rStart', 'rOcc'].forEach(k => setErr(k, ''));
  $('#rDelete').hidden = !r;
  openDlg($('#recDlg')); if (!r) setTimeout(() => $('#rName').focus(), 50);
}
function submitRec(){
  const day = Number($('#rDay').value), occ = $('#rOcc').value.trim(), start = $('#rStart').value;
  const e = {rName:$('#rName').value.trim() ? '' : 'Escribe un nombre.', rAmount:amountRule('rAmount'), rCat:$('#rCat').value ? '' : 'Elige una categoría.',
    rDay:Number.isInteger(day) && day >= 1 && day <= 31 ? '' : 'Un día entre 1 y 31.', rStart:/^\d{4}-\d{2}$/.test(start) ? '' : 'Elige el mes de inicio.',
    rOcc:!occ || (/^\d+$/.test(occ) && +occ >= 1 && +occ <= 600) ? '' : 'Un número entre 1 y 600, o déjalo vacío.'};
  Object.entries(e).forEach(([k, m]) => setErr(k, m));
  const first = Object.keys(e).find(k => e[k]); if (first){ $('#' + first).focus(); return; }
  const prev = recEditing ? store.get('recurring', recEditing) : null;
  store.put('recurring', {id:recEditing || U.uid(), name:$('#rName').value.trim().slice(0, 60), type:recType, category:$('#rCat').value, amount:U.toCents(U.parseAmount($('#rAmount').value)),
    day, start_month:start + '-01', occurrences:occ ? Number(occ) : null, active:prev ? prev.active : true});
  closeDlg($('#recDlg')); toast(recEditing ? 'Fijo actualizado' : 'Fijo creado: se registrará cada día ' + day);
  generateRecurring();
}

/* ---------- Respaldo ---------- */
function download(name, data, type){
  const blob = new Blob([data], {type}), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function toCSV(){
  const rows = [['fecha', 'tipo', 'categoria', 'descripcion', 'monto', 'fijo', 'tarjeta']];
  store.all('transactions').sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
    .forEach(t => rows.push([t.date, t.type === 'income' ? 'ingreso' : 'gasto', catOf(t.category).name, t.description || '', (t.amount / 100).toFixed(2), t.recurring_id ? 'sí' : '', t.card || '']));
  return '﻿' + rows.map(r => r.map(U.csvCell).join(',')).join('\r\n');
}
function toJSON(){
  const strip = r => { const {deleted, updated_at, created, ...x} = r; return x; };
  return JSON.stringify({app:'gastos', version:2, exportado:new Date().toISOString(), nota:'Montos en centavos', currency:store.settings().currency,
    transactions:store.all('transactions').map(strip), budgets:store.all('budgets').map(strip), goals:store.all('goals').map(strip), recurring:store.all('recurring').map(strip), merchant_rules:store.all('merchant_rules').map(strip)}, null, 2);
}
let pendingImport = null;
function parseBackup(text){
  const d = JSON.parse(text);
  const srcTx = Array.isArray(d) ? d : d.transactions || d.tx;
  if (!Array.isArray(srcTx)) throw new Error('No encontré movimientos en el archivo.');
  const seen = new Set(), tx = []; let skipped = 0;
  srcTx.forEach(t => { const c = U.cleanTx(t); if (!c || seen.has(c.id)){ skipped++; return; } seen.add(c.id); tx.push(c); });
  const budgets = [];
  if (Array.isArray(d.budgets)) d.budgets.forEach(b => { if (b && CAT[b.id] && CAT[b.id].type === 'expense' && Number.isInteger(b.amount) && b.amount > 0) budgets.push({id:b.id, amount:b.amount}); });
  else if (d.budgets && typeof d.budgets === 'object') Object.entries(d.budgets).forEach(([k, v]) => { if (CAT[k] && CAT[k].type === 'expense' && Number.isInteger(v) && v > 0) budgets.push({id:k, amount:v}); });
  const okId = s => typeof s === 'string' && /^[\w-]{1,64}$/.test(s);
  const goals = (Array.isArray(d.goals) ? d.goals : []).filter(g => g && okId(g.id) && typeof g.name === 'string' && Number.isInteger(g.target) && g.target > 0)
    .map(g => ({id:g.id, name:g.name.slice(0, 60), target:g.target, saved:Number.isInteger(g.saved) && g.saved > 0 ? g.saved : 0, deadline:/^\d{4}-\d{2}-\d{2}$/.test(g.deadline) ? g.deadline : null, color:/^#[0-9A-Fa-f]{6}$/.test(g.color) ? g.color : GOAL_COLORS[0]}));
  const recurring = (Array.isArray(d.recurring) ? d.recurring : []).filter(r => r && okId(r.id) && typeof r.name === 'string' && (r.type === 'income' || r.type === 'expense') && CAT[r.category] && CAT[r.category].type === r.type && Number.isInteger(r.amount) && r.amount > 0 && Number.isInteger(r.day) && r.day >= 1 && r.day <= 31 && /^\d{4}-\d{2}-\d{2}$/.test(r.start_month))
    .map(r => ({id:r.id, name:r.name.slice(0, 60), type:r.type, category:r.category, amount:r.amount, day:r.day, start_month:r.start_month.slice(0, 7) + '-01', occurrences:Number.isInteger(r.occurrences) && r.occurrences > 0 ? r.occurrences : null, active:r.active !== false}));
  const currency = ['MXN', 'USD', 'EUR'].includes(d.currency) ? d.currency : null;
  const rules = Array.isArray(d.merchant_rules) ? d.merchant_rules.filter(r => r && typeof r.id === 'string' && r.id.length >= 1 && r.id.length <= 60 && CAT[r.category] && CAT[r.category].type === 'expense')
    .map(r => ({id:r.id, name:String(r.name || '').slice(0, 60), category:r.category})) : null; // null = el respaldo no trae reglas: se conservan las actuales
  return {tx, budgets, goals, recurring, rules, currency, skipped};
}
function applyImport(p){
  store.replaceTable('transactions', p.tx); store.replaceTable('budgets', p.budgets); store.replaceTable('goals', p.goals); store.replaceTable('recurring', p.recurring);
  if (p.rules) store.replaceTable('merchant_rules', p.rules);
  if (p.currency) store.put('settings', {id:'main', currency:p.currency});
  makeNF();
}

/* ---------- Datos de ejemplo ---------- */
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function sampleData(){
  const td = today(), tx = []; let n = 0;
  const add = (date, type, category, description, pesos) => { if (date > td) return; tx.push({id:'smp-' + (n++), type, category, description, date, amount:Math.round(pesos * 100), recurring_id:null, created:n}); };
  for (let k = 5; k >= 0; k--){
    const key = U.addMonths(td.slice(0, 7), -k), {y, m} = U.parseKey(key), dim = U.daysIn(y, m), rnd = mulberry32(y * 100 + m + 7);
    const ds = day => key + '-' + U.pad(Math.min(day, dim)), r = (a, b) => Math.round(a + rnd() * (b - a));
    add(ds(15), 'income', 'salario', 'Quincena', 13500); add(ds(30), 'income', 'salario', 'Quincena', 13500);
    if (rnd() > .45) add(ds(r(5, 25)), 'income', 'freelance', 'Proyecto freelance', r(2500, 6500));
    add(ds(r(3, 20)), 'income', 'inversiones', 'Rendimientos', r(250, 900));
    add(ds(1), 'expense', 'vivienda', 'Renta', 8500); add(ds(5), 'expense', 'servicios', 'Internet', 599); add(ds(8), 'expense', 'servicios', 'Celular', 399);
    add(ds(r(10, 18)), 'expense', 'servicios', 'Luz', r(450, 900)); add(ds(10), 'expense', 'suscripciones', 'Streaming', 219);
    for (let i = 0; i < 5; i++) add(ds(r(2, 28)), 'expense', 'alimentacion', 'Supermercado', r(350, 1100));
    for (let i = 0; i < 3; i++) add(ds(r(2, 28)), 'expense', 'alimentacion', 'Restaurante', r(180, 520));
    for (let i = 0; i < 3; i++) add(ds(r(2, 28)), 'expense', 'transporte', 'Gasolina', r(450, 750));
    if (rnd() > .5) add(ds(r(2, 28)), 'expense', 'salud', 'Farmacia', r(150, 600));
    add(ds(r(2, 28)), 'expense', 'ocio', 'Salida con amigos', r(300, 900));
    if (rnd() > .4) add(ds(r(2, 28)), 'expense', 'compras', 'Ropa', r(500, 1800));
  }
  return {tx, budgets:[['vivienda', 850000], ['alimentacion', 550000], ['transporte', 300000], ['servicios', 200000], ['ocio', 180000], ['compras', 200000]].map(([id, amount]) => ({id, amount}))};
}

/* ---------- Ajustes ---------- */
let installEvt = null;
function renderAccount(){
  const info = $('#accountInfo'), btns = $('#accountBtns'), u = sync.currentUser(), s = sync.status, pend = store.pendingCount();
  if (!sync.enabled){
    info.innerHTML = 'Modo local: tus datos viven solo en este navegador. Para verlos en tu celular y tu computadora conecta Supabase (instrucciones en el README).';
    btns.innerHTML = ''; return;
  }
  const last = s.last ? s.last.toLocaleTimeString('es-MX', {hour:'2-digit', minute:'2-digit'}) : 'aún no';
  info.innerHTML = 'Sesión: <strong>' + esc(u ? u.email : '—') + '</strong><br>Última sincronización: ' + last + (pend ? ' · ' + pend + ' cambios por subir' : '') + (s.state === 'error' ? '<br><span class="err">' + esc(s.error) + '</span>' : '');
  btns.innerHTML = '<button type="button" class="btn" id="syncNow">' + ico('refresh', 18) + '<span>Sincronizar ahora</span></button><button type="button" class="btn" id="logoutBtn">' + ico('logout', 18) + '<span>Cerrar sesión</span></button>';
}
/* ---------- Apple Pay (Wallet) ---------- */
const wallet = {date:undefined, token:null, busy:false, error:''};
const walletErr = e => /Could not find the function|schema cache/i.test(e && e.message || '') ? 'Falta actualizar la base de datos: ejecuta de nuevo supabase/schema.sql en Supabase.' : (e && e.message) || String(e);
async function refreshWallet(){
  if (!sync.enabled || !sync.currentUser()) return;
  try { wallet.date = await sync.walletTokenInfo(); wallet.error = ''; } catch(e){ wallet.error = walletErr(e); }
  renderWallet();
}
function renderWallet(){
  $('#walletSec').hidden = !sync.enabled; if (!sync.enabled) return;
  const info = $('#walletInfo'), btns = $('#walletBtns'), has = !!wallet.date;
  if (wallet.error) info.innerHTML = '<span class="err">' + esc(wallet.error) + '</span>';
  else if (wallet.date === undefined) info.textContent = 'Consultando…';
  else info.textContent = has ? 'Activo desde el ' + new Date(wallet.date).toLocaleDateString('es-MX', {day:'numeric', month:'long', year:'numeric'}) + '. Cada pago con Apple Pay se registra solo.' : 'Desactivado. Actívalo para que tus pagos con Apple Pay se registren solos, con monto y comercio.';
  const off = wallet.busy || wallet.date === undefined;
  btns.innerHTML = has
    ? '<button type="button" class="btn" id="walletNew"' + (off ? ' disabled' : '') + '>' + ico('refresh', 18) + '<span>Generar token nuevo</span></button><button type="button" class="btn danger" id="walletOff"' + (off ? ' disabled' : '') + '>Desactivar</button>'
    : '<button type="button" class="btn primary" id="walletNew"' + (off || wallet.error ? ' disabled' : '') + '>' + ico('plus', 18) + '<span>Activar registro con Apple Pay</span></button>';
  const secret = $('#walletSecret'); secret.hidden = !wallet.token;
  if (wallet.token){ const c = sync.apiConfig(); $('#wUrl').value = c.url; $('#wKey').value = c.key; $('#wToken').value = wallet.token; }
}
async function walletAction(kind){
  if (wallet.busy) return;
  if (kind === 'new' && wallet.date && !confirm('El token anterior dejará de funcionar y tendrás que actualizarlo en tu atajo. ¿Continuar?')) return;
  if (kind === 'off' && !confirm('Tus pagos con Apple Pay dejarán de registrarse hasta que lo actives de nuevo. ¿Desactivar?')) return;
  wallet.busy = true; wallet.error = ''; renderWallet();
  try {
    if (kind === 'new'){ wallet.token = await sync.createWalletToken(); wallet.date = new Date().toISOString(); }
    else { await sync.revokeWalletToken(); wallet.token = null; wallet.date = null; toast('Registro con Apple Pay desactivado'); }
  } catch(e){ wallet.error = walletErr(e); }
  wallet.busy = false; renderWallet();
}
async function copyField(id, btn){
  const el = $('#' + id);
  try { await navigator.clipboard.writeText(el.value); } catch(e){ el.select(); document.execCommand && document.execCommand('copy'); }
  const old = btn.textContent; btn.textContent = 'Copiado'; setTimeout(() => { btn.textContent = old; }, 1500);
}

/* ---------- Reglas por comercio ---------- */
function renderRules(){
  const rules = store.all('merchant_rules').sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'es'));
  $('#ruleList').innerHTML = rules.map(r => '<li><span class="rule-name">' + esc(r.name || r.id) + '</span><span class="rule-cat">→ ' + esc(catOf(r.category).name) + '</span><button type="button" class="icon-btn" data-rule-del="' + esc(r.id) + '" aria-label="Olvidar la regla de ' + esc(r.name || r.id) + '" title="Olvidar">' + ico('trash', 18) + '</button></li>').join('');
  $('#ruleHint').textContent = rules.length ? 'Los pagos de estos comercios se categorizan solos.' : 'Aún no hay reglas. Al revisar un gasto de Apple Pay, marca «Recordar» y la próxima vez llegará ya categorizado.';
}

function openSettings(){
  renderRules(); renderWallet(); refreshWallet();
  $('#curSel').value = store.settings().currency; $('#impMsg').textContent = ''; $('#impConfirm').hidden = true; pendingImport = null;
  const hasTx = store.all('transactions').length > 0;
  $('#seedBtn').disabled = hasTx; $('#seedBtn').title = hasTx ? 'Solo disponible sin movimientos registrados' : '';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $('#installHint').innerHTML = standalone ? '' : installEvt ? '<button type="button" class="btn" id="installBtn">' + ico('download', 18) + '<span>Instalar como app</span></button>' : ios ? 'Para instalarla en iPhone: Compartir → «Agregar a pantalla de inicio».' : '';
  renderAccount(); openDlg($('#setDlg'));
}

/* ---------- Acceso ---------- */
let authMode = 'login';
const AUTH_UI = {
  login:{btn:'Entrar', sub:'Inicia sesión para ver tus datos en todos tus dispositivos.'},
  signup:{btn:'Crear cuenta', sub:'Crea tu cuenta personal. Solo tú podrás ver tus datos.'},
  reset:{btn:'Enviar enlace', sub:'Te enviaremos un enlace para crear una contraseña nueva.'},
  newpass:{btn:'Guardar contraseña', sub:'Escribe tu contraseña nueva.'}
};
function setAuthMode(m){
  authMode = m;
  $('#authSubmit').textContent = AUTH_UI[m].btn; $('#authSub').textContent = AUTH_UI[m].sub;
  $('#authToggle').textContent = m === 'login' ? '¿No tienes cuenta? Crear una' : 'Ya tengo cuenta';
  $('#authToggle').hidden = m === 'newpass';
  $('#authForgot').hidden = m !== 'login';
  $('#aEmail').closest('.field').hidden = m === 'newpass';
  $('#aPassField').hidden = m === 'reset';
  $('#aPassHint').hidden = !(m === 'signup' || m === 'newpass');
  $('#aPass').autocomplete = m === 'signup' || m === 'newpass' ? 'new-password' : 'current-password';
  $('#aPass').previousElementSibling.textContent = m === 'newpass' ? 'Contraseña nueva' : 'Contraseña';
  $('#authErr').hidden = true; $('#authOk').hidden = true;
}
const AUTH_ERR = {'Invalid login credentials':'Correo o contraseña incorrectos.', 'Email not confirmed':'Confirma tu correo: revisa tu bandeja de entrada.', 'User already registered':'Ese correo ya tiene cuenta. Inicia sesión.', 'Signups not allowed for this instance':'El registro de cuentas nuevas está desactivado.'};
async function submitAuth(){
  const email = $('#aEmail').value.trim(), pass = $('#aPass').value, err = $('#authErr'), ok = $('#authOk'), btn = $('#authSubmit');
  const newPass = authMode === 'signup' || authMode === 'newpass';
  err.hidden = true; ok.hidden = true;
  if (authMode !== 'newpass' && !/^\S+@\S+\.\S+$/.test(email)){ err.textContent = 'Escribe un correo válido.'; err.hidden = false; $('#aEmail').focus(); return; }
  if (authMode !== 'reset' && pass.length < (newPass ? 8 : 1)){ err.textContent = newPass ? 'La contraseña necesita al menos 8 caracteres.' : 'Escribe tu contraseña.'; err.hidden = false; $('#aPass').focus(); return; }
  btn.disabled = true; btn.textContent = 'Un momento…';
  let next = authMode, okMsg = '', errMsg = '';
  try {
    if (authMode === 'login') await sync.signIn(email, pass);
    else if (authMode === 'signup'){ const r = await sync.signUp(email, pass); if (r.needsConfirm){ next = 'login'; okMsg = 'Listo. Te enviamos un correo para confirmar tu cuenta; después inicia sesión aquí.'; } }
    else if (authMode === 'reset'){ okMsg = 'Si el correo tiene cuenta, recibirás un enlace en unos minutos.'; }
    if (authMode === 'reset') await sync.resetPassword(email);
    if (authMode === 'newpass'){ await sync.updatePassword(pass); toast('Contraseña actualizada'); onSignedIn(sync.currentUser()); }
  } catch(e){ errMsg = AUTH_ERR[e.message] || 'No se pudo completar: ' + (e.message || e); }
  btn.disabled = false; setAuthMode(next);
  if (errMsg){ err.textContent = errMsg; err.hidden = false; }
  else if (okMsg){ ok.textContent = okMsg; ok.hidden = false; }
}
function showApp(){ $('#authView').hidden = true; $('#app').hidden = false; setRoute((location.hash || '#resumen').slice(1)); }
function showAuth(mode = 'login'){ $('#app').hidden = true; $('#authView').hidden = false; setAuthMode(mode); setTimeout(() => $(mode === 'newpass' ? '#aPass' : '#aEmail').focus(), 50); }
async function onSignedIn(user){
  store.setOwner(user.id); makeNF(); showApp();
  await sync.sync(); generateRecurring();
}

/* ---------- Eventos ---------- */
function bind(){
  const shift = n => { view.m += n; if (view.m < 0){ view.m = 11; view.y--; } if (view.m > 11){ view.m = 0; view.y++; } listLimit = 80; render(); };
  $('#prevM').onclick = () => shift(-1);
  $('#nextM').onclick = () => shift(1);
  $('#periodLabel').onclick = () => { const t = U.todayParts(); view.y = t.y; view.m = t.m; render(); };
  $('#addTop').onclick = () => openTx();
  $('#fab').onclick = () => openTx();
  $('#themeBtn').onclick = () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!document.documentElement.getAttribute('data-theme')){ renderThemeBtn(); charts.dropAll(); render(); } });
  $('#settingsBtn').onclick = openSettings;
  $('#syncBtn').onclick = () => { if (sync.enabled) sync.sync(); openSettings(); };
  window.addEventListener('hashchange', () => setRoute(location.hash.slice(1), true));
  $('#clearSample').onclick = () => {
    store.all('transactions').filter(t => t.id.startsWith('smp-')).forEach(t => store.remove('transactions', t.id));
    store.all('budgets').forEach(b => store.remove('budgets', b.id)); toast('Listo: empiezas desde cero');
  };
  document.addEventListener('keydown', e => {
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.querySelector('dialog[open]') && !$('#app').hidden){ e.preventDefault(); openTx(); }
  });

  // Diálogos: cerrar con botón o tocando fuera.
  $$('dialog').forEach(d => {
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) closeDlg(d); });
  });

  // Movimiento
  pickTxType = bindSeg($('#typeSeg'), t => { const changed = txType !== t; txType = t; if (changed && $('#fCats').children.length) renderCatGrid(t); renderTxSubmit(); });
  $('#txForm').addEventListener('submit', e => { e.preventDefault(); submitTx(); });
  $('#fDelete').onclick = () => deleteTx(txEditing);
  $('#errSummary').addEventListener('click', e => { const b = e.target.closest('[data-focus]'); if (!b) return; const el = $('#' + b.dataset.focus); (el.querySelector ? el.querySelector('input') || el : el).focus(); });
  ['fAmount', 'fDate'].forEach(id => $('#' + id).addEventListener('blur', () => { if ($('#' + id).value !== '' || !$('#' + id + 'Err').hidden) setErr(id, txRules[id]()); }));
  $('#fCats').addEventListener('change', () => setErr('fCats', ''));
  document.addEventListener('click', e => {
    const tx = e.target.closest('[data-tx]'); if (tx){ openTx(tx.dataset.tx); return; }
    const lg = e.target.closest('[data-cat]');
    if (lg){ filters.cat = lg.dataset.cat; filters.type = 'all'; filters.allMonths = false; $('#qCat').value = filters.cat; $('#qType').value = 'all'; $('#qAll').checked = false; location.hash = '#movimientos'; return; }
    const cf = e.target.closest('[data-confirm]'); if (cf){ confirmReview([cf.dataset.confirm]); return; }
    if (e.target.closest('#confirmAll')){ confirmReview(pendingReview().map(t => t.id)); return; }
    const rd = e.target.closest('[data-rule-del]');
    if (rd){ const r = store.remove('merchant_rules', rd.dataset.ruleDel); if (r) toast('Regla olvidada', 'Deshacer', () => store.put('merchant_rules', Object.assign({}, r))); return; }
    const g = e.target.closest('[data-goal]'); if (g){ openGoal(g.dataset.goal); return; }
    const c = e.target.closest('[data-contrib]'); if (c){ openContrib(c.dataset.contrib); return; }
    const r = e.target.closest('[data-rec]'); if (r){ openRec(r.dataset.rec); return; }
    const rt = e.target.closest('[data-rec-toggle]');
    if (rt){ const rule = store.get('recurring', rt.dataset.recToggle); if (rule){ store.put('recurring', {id:rule.id, active:!rule.active}); toast(rule.active ? 'Pausado: no se registrará hasta reanudarlo' : 'Reanudado'); if (!rule.active) generateRecurring(); } }
  });

  // Filtros
  let qT = null;
  $('#qSearch').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { filters.q = e.target.value; listLimit = 80; renderList(); }, 150); });
  $('#qType').onchange = e => { filters.type = e.target.value; listLimit = 80; renderList(); };
  $('#qCat').onchange = e => { filters.cat = e.target.value; listLimit = 80; renderList(); };
  $('#qSort').onchange = e => { filters.sort = e.target.value; renderList(); };
  $('#qAll').onchange = e => { filters.allMonths = e.target.checked; listLimit = 80; renderList(); };
  $('#moreBtn').onclick = () => { listLimit += 80; renderList(); };

  // Presupuestos
  $('#budList').addEventListener('change', e => {
    const inp = e.target.closest('input[data-bud]'); if (!inp) return;
    const id = inp.dataset.bud, raw = inp.value.trim();
    if (!raw){ store.remove('budgets', id); return; }
    const n = U.parseAmount(raw);
    if (!(n > 0) || n > 999999999){ toast('Escribe un presupuesto válido (mayor a 0) o déjalo vacío.'); renderBudgets(); return; }
    store.put('budgets', {id, amount:U.toCents(n)});
  });

  // Metas
  $('#newGoal').onclick = () => openGoal();
  $('#goalForm').addEventListener('submit', e => { e.preventDefault(); submitGoal(); });
  $('#gDelete').onclick = () => { const g = store.remove('goals', goalEditing); closeDlg($('#goalDlg')); if (g) toast('Meta eliminada', 'Deshacer', () => store.put('goals', Object.assign({}, g))); };
  pickContrib = bindSeg($('#cSeg'), m => { contribMode = m; $('#cSubmit').textContent = m === 'add' ? 'Abonar' : 'Retirar'; });
  $('#contribForm').addEventListener('submit', e => { e.preventDefault(); submitContrib(); });

  // Fijos
  $('#newRec').onclick = () => openRec();
  pickRecType = bindSeg($('#rSeg'), t => { const changed = recType !== t; recType = t; if (changed) fillRecCats(t, ''); });
  $('#recForm').addEventListener('submit', e => { e.preventDefault(); submitRec(); });
  $('#rDelete').onclick = () => { const r = store.remove('recurring', recEditing); closeDlg($('#recDlg')); if (r) toast('Fijo eliminado (los movimientos ya registrados se conservan)', 'Deshacer', () => store.put('recurring', Object.assign({}, r))); };

  // Ajustes
  $('#curSel').onchange = e => { store.put('settings', {id:'main', currency:e.target.value}); makeNF(); charts.dropAll(); };
  $('#expCsv').onclick = () => download('gastos-' + today() + '.csv', toCSV(), 'text/csv;charset=utf-8');
  $('#expJson').onclick = () => download('gastos-respaldo-' + today() + '.json', toJSON(), 'application/json');
  $('#impFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const msg = $('#impMsg');
    if (f.size > 20 * 1024 * 1024){ msg.textContent = 'El archivo es demasiado grande.'; return; }
    try {
      pendingImport = parseBackup(await f.text());
      if (!pendingImport.tx.length && !pendingImport.goals.length && !pendingImport.recurring.length){ msg.textContent = 'El respaldo no contiene datos válidos.'; pendingImport = null; return; }
      msg.textContent = '';
      $('#impConfirmTxt').textContent = 'El archivo trae ' + pendingImport.tx.length + ' movimientos, ' + pendingImport.budgets.length + ' presupuestos, ' + pendingImport.goals.length + ' metas y ' + pendingImport.recurring.length + ' fijos' + (pendingImport.skipped ? ' (' + pendingImport.skipped + ' movimientos inválidos se omitirán)' : '') + '. Reemplazará tus datos actuales' + (sync.enabled ? ' en todos tus dispositivos' : '') + '.';
      $('#impConfirm').hidden = false; $('#impYes').focus();
    } catch(err){ msg.textContent = err instanceof SyntaxError ? 'No pude leer el archivo: no es un JSON válido.' : err.message; }
  });
  $('#impYes').onclick = () => { if (!pendingImport) return; const n = pendingImport.tx.length; applyImport(pendingImport); pendingImport = null; $('#impConfirm').hidden = true; $('#impMsg').textContent = 'Importados ' + n + ' movimientos.'; };
  $('#impNo').onclick = () => { pendingImport = null; $('#impConfirm').hidden = true; };
  $('#seedBtn').onclick = () => { const s = sampleData(); store.putMany('transactions', s.tx); s.budgets.forEach(b => store.put('budgets', b)); closeDlg($('#setDlg')); location.hash = '#resumen'; toast('Datos de ejemplo cargados'); };
  let wipeT = null; const wb = $('#wipeBtn');
  wb.onclick = () => {
    if (!wb.dataset.armed){ wb.dataset.armed = '1'; wb.textContent = '¿Seguro? Pulsa de nuevo'; wipeT = setTimeout(() => { delete wb.dataset.armed; wb.textContent = 'Borrar todo'; }, 4000); return; }
    clearTimeout(wipeT); delete wb.dataset.armed; wb.textContent = 'Borrar todo';
    store.TABLES.forEach(t => store.all(t).forEach(r => { if (t !== 'settings') store.remove(t, r.id); }));
    closeDlg($('#setDlg')); toast('Se borraron todos los datos');
  };
  $('#setDlg').addEventListener('click', async e => {
    if (e.target.closest('#syncNow')){ await sync.sync(); renderAccount(); }
    if (e.target.closest('#walletNew')) walletAction('new');
    if (e.target.closest('#walletOff')) walletAction('off');
    const cp = e.target.closest('[data-copy]'); if (cp) copyField(cp.dataset.copy, cp);
    if (e.target.closest('#installBtn') && installEvt){ installEvt.prompt(); installEvt = null; $('#installHint').innerHTML = ''; }
    if (e.target.closest('#logoutBtn')){
      const pend = store.pendingCount();
      if (pend && !confirm('Hay ' + pend + ' cambios sin subir que se perderán. ¿Cerrar sesión de todos modos?')) return;
      await sync.signOut(); store.wipeLocal(); closeDlg($('#setDlg')); showAuth();
    }
  });
  $('#setDlg').addEventListener('close', () => { wallet.token = null; renderWallet(); }); // el token solo se muestra una vez
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });

  // Acceso
  $('#authForm').addEventListener('submit', e => { e.preventDefault(); submitAuth(); });
  $('#authToggle').onclick = () => setAuthMode(authMode === 'login' ? 'signup' : 'login');
  $('#authForgot').onclick = () => setAuthMode('reset');

  // Sincronización: al volver a la app, al recuperar conexión y cada minuto con la app visible.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible'){ sync.sync(); generateRecurring(); render(); } else store.flush(); });
  window.addEventListener('online', () => sync.sync());
  window.addEventListener('offline', () => { sync.status.state = 'offline'; renderSync(); });
  window.addEventListener('pagehide', () => store.flush());
  setInterval(() => { if (document.visibilityState === 'visible') sync.sync(); }, 60000);
}

/* ---------- Inicio ---------- */
async function init(){
  paintIcons();
  store.load(); makeNF();
  $('#qCat').innerHTML = '<option value="all">Todas</option><optgroup label="Gastos">' + EXP.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('') + '</optgroup><optgroup label="Ingresos">' + INC.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('') + '</optgroup>';
  renderThemeBtn(); bind();
  store.onChange(origin => {
    render(); if ($('#setDlg').open){ renderAccount(); renderRules(); }
    if (origin === 'local') sync.soon();
    else setTimeout(generateRecurring); // pudieron llegar fijos nuevos desde otro dispositivo
  });
  sync.onStatus(() => { renderSync(); if ($('#setDlg').open) renderAccount(); });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')){
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (!sync.enabled){ showApp(); generateRecurring(); return; }
  try {
    // Si la sesión caduca no se borran los datos locales: al volver a entrar se suben los pendientes.
    const user = await sync.init(u => { if (u && sync.isRecovery()) showAuth('newpass'); else if (u) onSignedIn(u); else showAuth(); });
    if (user && sync.isRecovery()) showAuth('newpass'); else if (user) onSignedIn(user); else showAuth();
  } catch(e){
    // Sin conexión y sin la librería en caché: se trabaja con lo guardado en el dispositivo.
    showApp(); sync.status.state = 'offline'; renderSync();
  }
}
init();
