import * as U from './util.js';
import * as store from './store.js';
import * as sync from './sync.js';
import * as charts from './charts.js';
import * as fx from './fx.js';
import * as plan from './plan.js';
import * as Fi from './finance.js';
import {ico, paintIcons} from './icons.js';

const {esc, CAT, EXP, INC, catOf} = U;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

/**
 * Estos contenedores se repintan con cada cambio de datos (incluidos los de sincronización). Si el HTML nuevo es idéntico
 * al anterior no se vuelve a escribir: así no parpadean, no se interrumpen las animaciones de entrada y se conserva el
 * estado (hover, desplazamiento). Los de formularios (p. ej. presupuestos) no entran aquí a propósito.
 */
function skipSameHTML(el){
  if (!el) return;
  const d = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(el, 'innerHTML', {configurable:true, get(){ return d.get.call(this); }, set(v){ if (this._html === v) return; this._html = v; d.set.call(this, v); }});
}

/* ---------- Estado de la interfaz ---------- */
const now = U.todayParts();
const view = {y:now.y, m:now.m};
const filters = {q:'', type:'all', cat:'all', sort:'date-desc', allMonths:false};
const VIEWS = ['resumen', 'movimientos', 'presupuestos', 'metas', 'planear', 'fijos', 'deudas'];
const TAB_OF = {resumen:'resumen', movimientos:'movimientos', planear:'planear', fijos:'planear', deudas:'planear', metas:'metas', presupuestos:'metas'};
const PLAN_AHEAD = 12; // meses hacia adelante que se pueden ver en «Planear»
let route = 'resumen', lastRoute = null, listLimit = 80, renderQueued = false, pickQType;
const today = () => U.todayStr();
const viewKey = () => U.mk(view.y, view.m);
const isCurrentMonth = () => viewKey() === today().slice(0, 7);

/* ---------- Formato de moneda ---------- */
let nf, nf0, cf = new Intl.NumberFormat('es-MX', {notation:'compact', maximumFractionDigits:1}), pf = new Intl.NumberFormat('es-MX', {maximumFractionDigits:1});
function makeNF(){
  const cur = store.settings().currency || 'MXN', mk = (c, o) => new Intl.NumberFormat('es-MX', Object.assign({style:'currency', currency:c}, o));
  try { nf = mk(cur); nf0 = mk(cur, {minimumFractionDigits:0, maximumFractionDigits:0}); } catch(e){ nf = mk('MXN'); nf0 = mk('MXN', {minimumFractionDigits:0, maximumFractionDigits:0}); }
}
/** Montos en pantalla: sin «.00» cuando no hay centavos ($54,617 en vez de $54,617.00). */
const money = c => (c % 100 === 0 ? nf0 : nf).format(c / 100);
const units = v => nf.format(v);
/** Monto corto, sin símbolo, para las casillas del calendario: 1,250,000 centavos → «12.5k». */
const compact = c => { const v = Math.abs(c) / 100; return (c < 0 ? '−' : '') + (v < 1000 ? String(Math.round(v)) : v < 1e6 ? (v / 1e3).toFixed(v < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'k' : (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'); };
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
let pickTheme;
function renderThemeBtn(){
  const dark = currentTheme() === 'dark', forced = document.documentElement.getAttribute('data-theme');
  $$('meta[name="theme-color"]').forEach(m => { if (!m.dataset.orig) m.dataset.orig = m.content; m.content = forced ? (dark ? '#070B16' : '#E8EEFC') : m.dataset.orig; });
}
function repaintCharts(){ charts.dropAll(); plan.themeChanged(); render(); }
/** «auto» sigue al sistema; «light» y «dark» fijan el tema. */
function setTheme(t){
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  try { if (t === 'auto') localStorage.removeItem('gastos:theme'); else localStorage.setItem('gastos:theme', t); } catch(e){}
  renderThemeBtn(); repaintCharts();
}

/* ---------- Render general ---------- */
/** Agrupa varios cambios en un solo repintado por cuadro. */
function render(){ if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderNow(); }); }
function renderNow(){
  renderPeriod(); renderSync(); renderBanner();
  $$('.cur-sym').forEach(s => s.textContent = curSymbol());
  ({resumen:renderResumen, movimientos:renderList, presupuestos:renderBudgets, metas:renderGoals, planear:plan.renderPlan, fijos:renderRecurring, deudas:renderDebts})[route]();
  renderLiquid();
  fx.counters($('.view[data-view="' + route + '"]'), money);
  $('#foot').textContent = !store.storageOk ? 'Tu navegador bloqueó el almacenamiento: exporta un respaldo desde «Datos y ajustes».'
    : sync.enabled ? 'Tus datos se guardan en este dispositivo y se sincronizan con tu cuenta.' : 'Tus datos se guardan solo en este dispositivo.';
}
function renderPeriod(){
  $('#periodLabel').textContent = U.monthLabel(viewKey());
  const t = today().slice(0, 7);
  $('#nextM').disabled = viewKey() >= (route === 'planear' ? U.addMonths(t, PLAN_AHEAD) : t);
  $('#periodLabel').disabled = viewKey() === t;
}
function renderBanner(){ $('#banner').hidden = !store.all('transactions').some(t => t.id.startsWith('smp-')); }

const SYNC_UI = {
  local:['device', 'Solo este dispositivo'], idle:['cloud', 'Conectando…'], syncing:['refresh', 'Sincronizando…'],
  ok:['cloud', 'Sincronizado'], pending:['cloud', 'Cambios pendientes'], offline:['cloudOff', 'Sin conexión'], error:['cloudOff', 'Error al sincronizar']
};
/** La sincronización ya no ocupa la cabecera: es un punto sobre el botón de ajustes, visible solo si hay algo que avisar. */
function renderSync(){
  const s = sync.status, label = (SYNC_UI[s.state] || SYNC_UI.idle)[1], b = $('#settingsBtn');
  const pending = store.pendingCount();
  const text = s.state === 'offline' && pending ? 'Sin conexión · ' + pending + ' por subir' : label;
  $('#syncDot').dataset.state = s.state;
  b.setAttribute('aria-label', 'Datos y ajustes' + (s.state === 'local' ? '' : ' · ' + text));
  b.title = s.error || (s.state === 'local' ? 'Datos y ajustes' : text);
}

/* ---------- Navegación ---------- */
function setRoute(r, focus){
  const report = r === 'reporte'; // enlace del aviso semanal: abre el reporte sobre el Resumen
  route = VIEWS.includes(r) ? r : 'resumen';
  // Los meses futuros solo existen en «Planear»: al salir se vuelve al mes actual.
  if (route !== 'planear' && viewKey() > today().slice(0, 7)){ const t = U.todayParts(); view.y = t.y; view.m = t.m; }
  $$('.view').forEach(v => v.hidden = v.dataset.view !== route);
  // Cuatro pestañas: «Fijos» vive dentro de Planear y «Límites» dentro de Metas (con su propio selector arriba).
  const tab = TAB_OF[route];
  $$('.tabs a').forEach(a => { if (a.dataset.view === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $$('.subnav a').forEach(a => { if (a.dataset.sub === route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $('#app').dataset.route = route;
  renderNow();
  fx.moveIndicator($('.tabs'));
  if (lastRoute !== route){ // entrada animada solo la primera vez que se abre cada sección
    fx.enter($('.view[data-view="' + route + '"]')); lastRoute = route;
  }
  if (route === 'resumen' || route === 'planear') requestAnimationFrame(charts.resizeAll);
  if (report){ history.replaceState(null, '', '#resumen'); plan.openReport(); }
  if (focus){ window.scrollTo({top:0, behavior:'instant'}); $('#main').focus({preventScroll:true}); }
}

/* ---------- Inicio: lo esencial a la vista, el detalle en «Ver análisis» ---------- */
const dayShort = s => U.fmtDate(s).replace(/ \d{4}$/, '');
const item = (icon, cls, title, body) => '<li class="ins"><span class="ins-ico ' + cls + '">' + ico(icon, 18) + '</span><div><h3>' + title + '</h3>' + body + '</div></li>';

/** Una sola frase bajo el saldo: si hay un problema en los próximos 30 días, ese; si no, tranquilidad. */
function renderBalStatus(){
  const el = $('#balStatus'), set = store.settings();
  let cls = '', txt;
  if (!set.opening_date) txt = 'Toca la cifra para decirme cuánto tienes hoy.';
  else {
    const sf = plan.nextShortfall();
    if (sf.negative){ cls = 'bad'; txt = 'Ojo: el ' + dayShort(sf.negative.from) + ' te faltaría dinero.'; }
    else if (sf.low){ cls = 'warn'; txt = 'Del ' + dayShort(sf.low.from) + ' al ' + dayShort(sf.low.to) + ' quedarías justo.'; }
    else { cls = 'good'; txt = 'Vas bien: no se ve ningún faltante este mes.'; }
  }
  el.className = 'bal-status ' + cls;
  el.innerHTML = (cls ? ico(cls === 'good' ? 'check' : 'alert', 16) : '') + '<span>' + txt + '</span>';
}

/** Lo que entró y lo que salió en el mes: dos cifras, sin porcentajes. */
function renderDuo(){
  const s = U.sums(store.byMonth(viewKey()));
  const half = (cls, icon, label, v) => '<div class="duo-i ' + cls + '"><span class="duo-ico">' + ico(icon, 18) + '</span><div><p class="duo-lbl">' + label + '</p><p class="duo-val">' + money(v) + '</p></div></div>';
  $('#duo').innerHTML = half('income', 'inflow', 'Entró', s.inc) + half('expense', 'outflow', 'Salió', s.exp);
}

/** «Lo importante»: como máximo tres avisos, el más urgente primero y en lenguaje simple. */
function renderInsights(){
  const key = viewKey(), list = store.byMonth(key), rules = store.all('recurring'), t = today(), out = [], s = U.sums(list);
  const budTotal = store.all('budgets').reduce((a, b) => a + (b.amount || 0), 0);
  const cur = isCurrentMonth();
  if (cur){
    const sf = plan.nextShortfall();
    if (sf.negative) out.push(item('alert', 'bad', 'Te faltaría dinero el ' + dayShort(sf.negative.from), '<p>Tu saldo bajaría a <strong>' + money(sf.negative.min) + '</strong>. <a href="#planear">Ver qué pagos son</a></p>'));
    else if (sf.low) out.push(item('calendar', 'warn', 'Unos días justos', '<p>Del ' + dayShort(sf.low.from) + ' al ' + dayShort(sf.low.to) + ' te quedaría poco dinero. <a href="#planear">Ver calendario</a></p>'));
  }
  const lims = Object.values(limitsFor(key));
  const over = lims.filter(l => l.left < 0).sort((a, b) => a.left - b.left);
  const near = lims.filter(l => l.kind === 'limite' && l.limit > 0 && l.left >= 0 && l.spent / l.limit >= .8);
  if (over.length){
    const b = over[0], more = over.length > 1 ? ' y ' + (over.length - 1) + (over.length > 2 ? ' más' : ' otra') : '';
    out.push(item('alert', 'bad', 'Te pasaste en ' + esc(catOf(b.id).name) + more, '<p>Gastaste <strong>' + money(-b.left) + '</strong> de más. <button type="button" class="linklike" data-cover="' + esc(b.id) + '">Cubrirlo con otro límite</button></p>'));
  } else if (near.length){
    out.push(item('gauge', 'warn', 'Casi llegas a tu límite', '<p>' + esc(near.map(b => catOf(b.id).name).join(', ')) + '. <a href="#presupuestos">Revisar</a></p>'));
  }
  if (cur){
    const p = U.projectMonth(list, rules, key, t), limit = budTotal || s.inc;
    if (limit > 0 && p.projected > limit) out.push(item('gauge', 'warn', 'Vas a un ritmo alto', '<p>A este paso gastarías <strong>' + money(p.projected - limit) + '</strong> más que tu ' + (budTotal ? 'límite total' : 'ingreso') + ' del mes.</p>'));
    const next = rules.map(r => ({r, n:U.nextDue(r, t)})).filter(x => x.r.active && x.r.type === 'expense' && x.n).sort((a, b) => a.n.date < b.n.date ? -1 : 1)[0];
    if (next) out.push(item('calendar', '', 'Próximo pago: ' + esc(next.r.name), '<p>' + money(next.r.amount) + ' el ' + dayShort(next.n.date) + '.</p>'));
    if (!out.some(x => x.includes('ins-ico bad') || x.includes('ins-ico warn')) && limit > 0)
      out.unshift(item('check', 'good', 'Vas bien este mes', '<p>' + (budTotal ? 'Estás dentro de tus límites de gasto.' : 'A este ritmo te sobrarían unos <strong>' + money(limit - p.projected) + '</strong>.') + '</p>'));
  } else if (s.inc || s.exp){
    out.unshift(item(s.net < 0 ? 'alert' : 'check', s.net < 0 ? 'bad' : 'good', s.net < 0 ? 'Ese mes gastaste de más' : 'Ese mes te sobró dinero', '<p>' + (s.net < 0 ? 'Saliste con ' + money(-s.net) + ' de menos.' : 'Te quedaron ' + money(s.net) + '.') + '</p>'));
  }
  if (!out.length) out.push(item('info', '', 'Todo en orden', '<p>Registra tus ingresos y gastos y aquí te diré lo que necesitas saber.</p>'));
  $('#insights').innerHTML = out.slice(0, 3).join('');
}

/** En qué se va el dinero: las categorías más grandes, con una barra relativa a la mayor. Tocar una abre sus movimientos. */
function renderTopCats(){
  const key = viewKey(), rows = Object.entries(U.byCategory(store.byMonth(key))).sort((a, b) => b[1] - a[1]), total = rows.reduce((s, r) => s + r[1], 0);
  $('#catsSub').textContent = total ? 'Gastaste ' + money(total) + ' en ' + U.monthLabel(key).replace(/ \d{4}$/, '').toLowerCase() : '';
  if (!total){ $('#topCats').innerHTML = '<li class="empty sm">' + ico('pie', 26) + 'Aún no hay gastos este mes.</li>'; return; }
  const top = rows.slice(0, 5), max = top[0][1];
  $('#topCats').innerHTML = top.map(([id, v]) => {
    const c = catOf(id);
    return '<li><button type="button" class="cat-row" data-cat="' + esc(id) + '" style="--c:' + c.color + '" aria-label="' + esc(c.name) + ': ' + money(v) + '. Ver movimientos">' +
      '<span class="catdot">' + ico(c.icon, 18) + '</span><span class="cat-row-main"><span class="cat-row-top"><span>' + esc(c.name) + '</span><span class="cat-row-amt">' + money(v) + '</span></span>' +
      '<span class="bar thin"><span style="width:' + Math.max(3, v / max * 100) + '%"></span></span></span></button></li>';
  }).join('') + (rows.length > 5 ? '<li class="hint cat-more">Y ' + (rows.length - 5) + (rows.length - 5 === 1 ? ' categoría más' : ' categorías más') + ' en Movimientos.</li>' : '');
}

/**
 * Gastos hormiga: compras chicas que se repiten en los últimos 30 días. Tocar una abre sus movimientos.
 * El tope de «chica» depende de la moneda: $200 en pesos, 15 en dólares o euros.
 */
function renderAnt(){
  const box = $('#antCard'), cur = store.settings().currency || 'MXN';
  const r = Fi.antSpending(store.all('transactions'), today(), {max:cur === 'MXN' ? 20000 : 1500});
  box.hidden = !r.groups.length; if (!r.groups.length) return;
  const rows = r.groups.slice(0, 3).map(g => {
    const c = catOf(g.category), label = g.label || c.name, attr = g.label ? ' data-ant-q="' + esc(g.label) + '"' : ' data-ant-cat="' + esc(g.category) + '"';
    return '<li><button type="button" class="ant-row"' + attr + ' style="--c:' + c.color + '" aria-label="' + esc(label) + ': ' + g.count + ' compras, ' + money(g.total) + '. Ver movimientos">' +
      '<span class="catdot">' + ico(c.icon, 18) + '</span><span class="ant-main"><span class="ant-name">' + esc(label) + '</span><span class="ant-meta">' + g.count + ' veces</span></span><span class="ant-amt">' + money(g.total) + '</span></button></li>';
  }).join('');
  box.innerHTML = '<div class="card-head"><div><h2 id="antTitle">Gastos hormiga</h2><p class="sub">Compras chicas que se repiten · últimos 30 días</p></div><span class="ant-ico">' + ico('bug', 20) + '</span></div>' +
    '<ul class="ant-list">' + rows + '</ul><p class="ant-year">A este ritmo serían <strong>' + money(Math.round(r.yearly / 100) * 100) + '</strong> al año.</p>';
}

/* ---------- Fondo «nivel de dinero» ---------- */
/**
 * El fondo es un líquido cuyo nivel es lo que te queda del dinero del mes (lo que entró más los ingresos fijos que
 * faltan, menos lo que ya gastaste). Si no hay ingresos registrados usa tus límites de gasto. Siempre del mes actual.
 * Color: bien, justo (queda poco o se ve un tramo justo) o faltante. Se mueve solo cuando cambia el valor.
 */
let liquidLast = '';
function renderLiquid(){
  const el = $('#liquid'), on = document.documentElement.getAttribute('data-bg') !== 'plain';
  $('#levelHint').hidden = !on;
  if (!el || !on) return;
  const t = today(), key = t.slice(0, 7), list = store.byMonth(key).filter(x => x.date <= t), s = U.sums(list);
  let pending = 0;
  for (const r of store.all('recurring')){
    if (!r.active || r.type !== 'income') continue;
    const i = U.monthDiff(r.start_month.slice(0, 7), key);
    if (i >= 0 && (!r.occurrences || i < r.occurrences) && U.dueDate(r, key) > t) pending += r.amount;
  }
  let total = s.inc + pending, used = s.exp;
  if (!total){ const L = Object.values(limitsFor(key)).filter(l => l.kind === 'limite'); total = L.reduce((a, l) => a + l.limit, 0); used = L.reduce((a, l) => a + l.spent, 0); }
  const level = total > 0 ? Math.max(0, Math.min(1, 1 - used / total)) : .5;
  const sf = plan.nextShortfall();
  const state = sf.negative || (total > 0 && used > total) ? 'bad' : sf.low || (total > 0 && level < .2) ? 'warn' : 'good';
  const vis = .06 + level * .86, sig = state + vis.toFixed(3);
  if (sig === liquidLast) return;
  liquidLast = sig;
  el.dataset.state = state;
  el.style.transform = 'translateY(' + ((1 - vis) * 100).toFixed(2) + '%)';
  if (!el.classList.contains('ready')) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('ready'))); // la primera vez, sin animar
}

/* ---------- Análisis del mes (plegado: solo se calcula y dibuja al abrirlo) ---------- */
function delta(cur, prev, goodWhenUp){
  if (!prev) return {txt:'Sin datos del mes anterior', cls:'', icon:''};
  const p = (cur - prev) / Math.abs(prev) * 100, up = p >= 0, good = Math.abs(p) < .05 || up === goodWhenUp;
  return {txt:(up ? '+' : '−') + pf.format(Math.abs(p)) + '% vs. mes anterior', cls:good ? 'good' : 'bad', icon:up ? 'up' : 'down'};
}
function renderKPIs(){
  const key = viewKey(), cur = U.sums(store.byMonth(key)), prev = U.sums(store.byMonth(U.addMonths(key, -1)));
  const rate = cur.inc > 0 ? cur.net / cur.inc * 100 : null;
  const dI = delta(cur.inc, prev.inc, true), dE = delta(cur.exp, prev.exp, false), dB = delta(cur.net, prev.net, true);
  const subD = d => '<p class="kpi-sub ' + d.cls + '">' + (d.icon ? ico(d.icon, 14) : '') + '<span>' + d.txt + '</span></p>';
  const card = (label, val, valCls, sub) => '<article class="kpi"><p class="kpi-top">' + label + '</p><p class="kpi-val ' + valCls + '">' + val + '</p>' + sub + '</article>';
  $('#kpis').innerHTML =
    card('Ingresos', money(cur.inc), '', subD(dI)) + card('Gastos', money(cur.exp), '', subD(dE)) +
    card('Balance del mes', money(cur.net), cur.net < 0 ? 'neg' : '', subD(dB)) +
    card('Tasa de ahorro', rate === null ? '—' : pf.format(rate) + '%', rate !== null && rate < 0 ? 'neg' : '', '<p class="kpi-sub">' + (rate === null ? 'Sin ingresos este mes' : rate < 0 ? 'Gastaste más de lo que ingresaste' : rate >= 20 ? 'Arriba del 20% recomendado' : 'Meta sugerida: 20% o más') + '</p>');
}
function renderStats(){
  const key = viewKey(), list = store.byMonth(key), rules = store.all('recurring'), t = today(), out = [];
  const budTotal = store.all('budgets').reduce((s, b) => s + (b.amount || 0), 0);
  if (isCurrentMonth()){
    const p = U.projectMonth(list, rules, key, t);
    out.push(item('gauge', '', 'Proyección de cierre', '<p>A este ritmo terminarás el mes con <strong>' + money(p.projected) + '</strong> en gastos' + (p.fixedPending ? ' (incluye ' + money(p.fixedPending) + ' de fijos por venir)' : '') + '.</p>'));
  }
  const r = U.rule503020(list);
  if (r.inc > 0){
    const pc = v => Math.max(0, v / r.inc * 100), save = Math.max(0, r.save);
    out.push(item('scale', pc(r.need) > 50 || r.save < 0 ? 'warn' : 'good', 'Regla 50/30/20',
      '<div class="split" role="img" aria-label="Necesidades ' + pf.format(pc(r.need)) + '%, deseos ' + pf.format(pc(r.want)) + '%, ahorro ' + pf.format(pc(save)) + '% de tus ingresos">' +
      '<span style="width:' + Math.min(100, pc(r.need)) + '%;background:var(--primary)"></span><span style="width:' + Math.min(100, pc(r.want)) + '%;background:var(--warn)"></span><span style="width:' + Math.min(100, pc(save)) + '%;background:var(--income)"></span></div>' +
      '<p class="split-legend"><span><i style="background:var(--primary)"></i>Necesidades ' + pf.format(pc(r.need)) + '% <small>(50)</small></span><span><i style="background:var(--warn)"></i>Deseos ' + pf.format(pc(r.want)) + '% <small>(30)</small></span><span><i style="background:var(--income)"></i>Ahorro ' + (r.save < 0 ? '−' : '') + pf.format(Math.abs(r.save) / r.inc * 100) + '% <small>(20)</small></span></p>'));
  }
  const e = U.emergencyMonths(store.all('transactions'), today().slice(0, 7));
  if (e && e.months !== null){
    const m = e.months, cls = m >= 6 ? 'good' : m >= 3 ? 'warn' : 'bad';
    out.push(item('shield', cls, 'Fondo de emergencia', '<p>Tu saldo cubre <strong>' + (m <= 0 ? '0' : pf.format(m)) + ' ' + (Math.abs(m - 1) < .05 ? 'mes' : 'meses') + '</strong> de gastos (promedio ' + money(e.avg) + '/mes). Lo recomendado son 3 a 6 meses.</p>'));
  }
  const cards = U.byCard(list).slice(0, 4);
  if (cards.length){
    const total = U.sums(list).exp;
    out.push(item('card', '', 'Gasto por método de pago',
      '<ul class="upcoming">' + cards.map(([name, v]) => '<li><span>' + esc(name) + '</span><span>' + money(v) + (total ? ' <small>(' + pf.format(v / total * 100) + '%)</small>' : '') + '</span></li>').join('') + '</ul>'));
  }
  if (budTotal){ const spent = U.sums(list).exp; out.push(item('pie', spent > budTotal ? 'bad' : '', 'Límites de gasto', '<p>Llevas ' + money(spent) + ' de ' + money(budTotal) + ' en total.</p>')); }
  $('#stats').innerHTML = out.join('');
}

/* ---------- Gráficas del análisis ---------- */
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
  if (budgetTotal > 0) datasets.push({label:'Límite total', data:new Array(dim).fill(budgetTotal), borderColor:C.primary, borderWidth:1.5, borderDash:[2, 4], pointRadius:0, pointHoverRadius:0, fill:false});
  $('#flowCanvas').setAttribute('aria-label', 'Flujo acumulado del mes. Gastos: ' + units(ce / 100) + '. Ingresos: ' + units(ci / 100) + '.');
  charts.upsert('flow', $('#flowCanvas'), {
    type:'line',
    data:{labels:Array.from({length:dim}, (_, i) => String(i + 1)), datasets},
    options:{responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false}, spanGaps:false,
      plugins:{legend:{position:'bottom', labels:{usePointStyle:true, boxWidth:8, color:C.text}}, tooltip:{callbacks:{title:items => 'Día ' + items[0].label, label:ctx => ctx.parsed.y == null ? null : ' ' + ctx.dataset.label + ': ' + units(ctx.parsed.y)}}},
      scales:{x:{grid:{display:false}, ticks:{color:C.muted, maxTicksLimit:10}}, y:{beginAtZero:true, grid:{color:C.grid}, ticks:{color:C.muted, callback:v => cf.format(v)}}}}
  });
}
function renderAnalysis(){
  if (!$('#analysis').open) return;
  renderKPIs(); renderStats();
  if (charts.available()){ const C = charts.palette(); renderBars(C); renderFlow(C); }
  else ['#barsBox', '#flowBox'].forEach(s => { $(s).hidden = true; });
}
function renderResumen(){
  renderBalance(); renderBalStatus(); renderReview(); renderDuo(); renderInsights(); renderTopCats(); renderAnt(); plan.renderWeekCard();
  const recent = store.all('transactions').sort(cmpDateDesc).slice(0, 3);
  $('#recentList').innerHTML = recent.length ? recent.map(t => txRow(t, true)).join('') : emptyTx();
  renderAnalysis();
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
  const lead = t.recurring_id ? ico('repeat', 12) : t.source ? ico('device', 12) : '';
  return '<button type="button" class="tx" data-tx="' + esc(t.id) + '" style="--c:' + c.color + '" aria-label="' + esc(title) + ', ' + (t.type === 'income' ? 'ingreso' : 'gasto') + ' de ' + money(t.amount) + ', ' + U.fmtDate(t.date) + (t.review ? ', por revisar' : '') + '. Editar">' +
    '<span class="catdot">' + ico(c.icon, 20) + '</span>' +
    '<span class="tx-main"><span class="tx-title" style="display:block">' + esc(title) + '</span><span class="tx-meta">' + lead + esc(c.name) + (withDate ? ' · ' + (t.date.slice(0, 4) === today().slice(0, 4) ? U.fmtDate(t.date).replace(/ \d{4}$/, '') : U.fmtDate(t.date)) : '') + (t.card ? ' · ' + esc(t.card) : '') + (t.review ? ' <span class="badge warn">Por revisar</span>' : '') + '</span></span>' +
    '<span class="tx-amt ' + t.type + '">' + sign + money(t.amount) + '</span></button>';
}
const txRow = (t, withDate) => '<li>' + txBtn(t, withDate) + '</li>';

/* ---------- Saldo actual ---------- */
const currentBalance = () => U.balanceNow(store.settings().opening_balance, store.all('transactions'), today());
function renderBalance(){
  const bal = currentBalance(), el = $('#balValue');
  el.textContent = money(bal); el.dataset.count = bal; el.dataset.countKey = 'bal'; el.classList.toggle('neg', bal < 0);
}
const balInput = () => U.parseSigned($('#bAmount').value);
function renderBalHint(){
  const n = balInput(), hint = $('#bHint');
  if (!Number.isFinite(n)){ hint.textContent = ''; return; }
  const diff = U.toCents(n) - currentBalance();
  hint.textContent = diff === 0 ? 'Coincide con lo que calcula la app.' : 'La app calcula ' + money(currentBalance()) + '. Se ajustará ' + (diff > 0 ? '+' : '−') + money(Math.abs(diff)) + '.';
}
function openBalance(){
  $('#bAmount').value = U.centsToInput(currentBalance()); setErr('bAmount', ''); renderBalHint();
  openDlg($('#balDlg')); setTimeout(() => { $('#bAmount').focus(); $('#bAmount').select(); }, 50);
}
function submitBalance(){
  const n = balInput();
  if (!Number.isFinite(n) || Math.abs(n) > 999999999.99){ setErr('bAmount', 'Escribe tu saldo (puede ser 0 o negativo, por ejemplo 1250.50).'); $('#bAmount').focus(); return; }
  setErr('bAmount', '');
  const prev = store.settings(), before = {opening_balance:prev.opening_balance || 0, opening_date:prev.opening_date || null};
  // El saldo inicial es lo que falta para que ingresos y gastos ya registrados den el saldo indicado.
  const opening = U.toCents(n) - U.balanceNow(0, store.all('transactions'), today());
  store.put('settings', {id:'main', currency:prev.currency, opening_balance:opening, opening_date:today()});
  closeDlg($('#balDlg'));
  toast('Saldo ajustado a ' + money(U.toCents(n)), 'Deshacer', () => store.put('settings', Object.assign({id:'main', currency:store.settings().currency}, before)));
}

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
const emptyTx = () => '<li class="empty">' + ico('inbox', 28) + (store.all('transactions').length === 0 ? 'Aún no tienes movimientos. Toca + para registrar tu primer ingreso o gasto.' : 'No hay movimientos con estos filtros.') + '</li>';
/** Cuántos filtros «escondidos» (categoría, orden, todos los meses) están activos: se muestra en el botón «Filtros». */
function renderFilterCount(){
  const n = (filters.cat !== 'all') + (filters.sort !== 'date-desc') + filters.allMonths, c = $('#qMoreCount');
  c.hidden = !n; c.textContent = n || '';
}
function renderList(){
  const all = filteredTx(), shown = all.slice(0, listLimit), s = U.sums(all);
  const scope = filters.allMonths ? 'en todo el historial' : 'en ' + U.monthLabel(viewKey()).replace(/ \d{4}$/, '').toLowerCase();
  const tot = filters.type === 'income' ? 'entraron ' + money(s.inc) : filters.type === 'expense' ? 'salieron ' + money(s.exp) : 'salieron ' + money(s.exp);
  $('#listSummary').textContent = all.length ? all.length + (all.length === 1 ? ' movimiento ' : ' movimientos ') + scope + ' · ' + tot : '';
  renderFilterCount();
  if (!all.length){ $('#txList').innerHTML = '<ul class="tx-list">' + emptyTx() + '</ul>'; }
  else if (filters.sort.startsWith('date')){
    // Agrupado por día: solo la fecha como encabezado, sin sumas que distraigan.
    const groups = []; let g = null;
    for (const t of shown){ if (!g || g.date !== t.date){ g = {date:t.date, items:[]}; groups.push(g); } g.items.push(t); }
    const td = today();
    $('#txList').innerHTML = groups.map(g => '<h2 class="day-head">' + U.fmtDay(g.date, td) + '</h2><ul class="tx-list">' + g.items.map(t => txRow(t, false)).join('') + '</ul>').join('');
  } else {
    $('#txList').innerHTML = '<ul class="tx-list">' + shown.map(t => txRow(t, true)).join('') + '</ul>';
  }
  const more = $('#moreBtn'); more.hidden = all.length <= listLimit;
  more.textContent = 'Mostrar más (' + (all.length - listLimit) + ' restantes)';
}

/* ---------- Apartados propios ---------- */
/** Carga los apartados propios en las listas de categorías y refresca el filtro de Movimientos. */
function loadCats(){
  U.setCustomCats(store.allRaw('categories'));
  const sel = $('#qCat'), cur = sel.value || filters.cat;
  const html = '<option value="all">Todas</option><optgroup label="Gastos">' + EXP.map(c => '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>').join('') + '</optgroup><optgroup label="Ingresos">' + INC.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('') + '</optgroup>';
  if (sel._html !== html){ sel._html = html; sel.innerHTML = html; }
  sel.value = CAT[cur] ? cur : 'all';
  if (sel.value === 'all') filters.cat = 'all';
}
/** Límite efectivo de cada categoría en el mes: base ± dinero movido; los apartados que acumulan arrastran lo no gastado. */
const limitsFor = key => Fi.monthlyLimits(key, {budgets:store.all('budgets'), cats:CAT, moves:store.all('budget_moves'), tx:store.all('transactions')});

/* ---------- Límites de gasto (presupuestos) ---------- */
/** Arriba, las categorías y apartados con límite; las demás esperan plegadas en «Poner límite a otra categoría». */
function renderBudgets(){
  const key = viewKey(), L = limitsFor(key), t = today();
  let tb = 0, ts = 0;
  // No repintar el campo que se está editando.
  const active = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.bud : null;
  const input = (c, bud, label) => '<input id="bud-' + c.id + '" class="bud-input" data-bud="' + esc(c.id) + '" type="text" inputmode="decimal" autocomplete="off" placeholder="Sin límite" value="' + U.centsToInput(bud) + '" aria-label="' + label + ' de ' + esc(c.name) + '">';
  const edit = c => c.custom ? '<button type="button" class="icon-btn bud-edit" data-edit-cat="' + esc(c.id) + '" aria-label="Editar el apartado ' + esc(c.name) + '" title="Editar">' + ico('pencil', 16) + '</button>' : '';
  const tag = c => c.custom ? '<span class="badge">' + (c.kind === 'acumula' ? 'Ahorro' : 'Apartado') + '</span>' : '';
  const withB = [], free = [];
  EXP.forEach(c => {
    const l = L[c.id];
    if (!l){ free.push('<li class="bud-row" style="--c:' + c.color + '"><div class="bud-top"><span class="catdot">' + ico(c.icon, 18) + '</span><label class="bud-name" for="bud-' + c.id + '">' + esc(c.name) + ' ' + tag(c) + '</label>' + edit(c) + input(c, 0, 'Límite mensual') + '</div></li>'); return; }
    let pct, cls, text, sub = '';
    if (l.kind === 'acumula'){
      const goal = l.target || Math.max(l.saved, 1);
      pct = Math.max(0, l.left) / goal * 100;
      cls = l.left < 0 ? 'over' : 'save';
      text = l.left < 0 ? 'Te pasaste por ' + money(-l.left) : 'Llevas ' + money(l.left) + (l.target ? ' de ' + money(l.target) : '');
      sub = !l.due ? 'Apartas ' + money(l.base) + ' al mes' : l.due < t ? 'Ya pasó la fecha: edítalo para el siguiente pago' : 'Para el ' + dayShort(l.due) + ' · apartas ' + money(l.base) + ' al mes';
    } else {
      tb += l.limit; ts += l.spent;
      pct = l.limit > 0 ? l.spent / l.limit * 100 : (l.spent ? 101 : 0);
      cls = pct > 100 ? 'over' : pct >= 80 ? 'warn' : '';
      text = pct > 100 ? 'Te pasaste por ' + money(l.spent - l.limit) : pct === 100 ? 'Ya llegaste al límite' : 'Te quedan ' + money(l.left);
      if (l.limit !== l.base) sub = 'Este mes: ' + money(l.limit) + ' (movido ' + (l.limit > l.base ? '+' : '−') + money(Math.abs(l.limit - l.base)) + ')';
    }
    const cover = l.left < 0 ? '<button type="button" class="btn sm bud-cover" data-cover="' + esc(c.id) + '">' + ico('move', 16) + '<span>Cubrir</span></button>' : '';
    withB.push('<li class="bud-row" style="--c:' + c.color + '"><div class="bud-top"><span class="catdot">' + ico(c.icon, 18) + '</span><div class="bud-name"><label for="bud-' + c.id + '">' + esc(c.name) + ' ' + tag(c) + '</label>' +
      '<p class="bud-msg ' + (cls === 'save' ? '' : cls) + '">' + (cls === 'over' || cls === 'warn' ? ico('alert', 14) : '') + text + '</p>' + (sub ? '<p class="bud-sub">' + sub + '</p>' : '') + '</div>' + edit(c) +
      input(c, l.base, l.kind === 'acumula' ? 'Apartado mensual' : 'Límite mensual') + '</div>' +
      '<div class="bar ' + cls + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.min(Math.round(pct), 100) + '" aria-label="' + esc(c.name) + ': ' + Math.round(pct) + (l.kind === 'acumula' ? '% juntado' : '% del límite') + '"><span style="width:' + Math.min(100, pct) + '%"></span></div>' + cover + '</li>');
  });
  $('#budList').innerHTML = withB.length ? withB.join('') : '<li class="empty sm">' + ico('pie', 26) + 'Aún no tienes límites. Crea un apartado («Café», «Mascota», «Predial») o ponle límite a lo que más te cuesta controlar.</li>';
  $('#budFree').innerHTML = free.join('');
  $('#budMore').hidden = !free.length;
  $('#budMoreLbl').textContent = withB.length ? 'Poner límite a otra categoría' : 'Poner límite a una categoría';
  if (active){ const el = $('#bud-' + active); if (el) el.focus(); }
  const tot = $('#budTotal'); tot.hidden = tb === 0;
  if (tb){
    const pct = ts / tb * 100, cls = pct > 100 ? 'over' : pct >= 80 ? 'warn' : '';
    tot.innerHTML = '<p>Llevas <strong>' + money(ts) + '</strong> de ' + money(tb) + ' en tus límites del mes</p><div class="bar ' + cls + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.min(100, Math.round(pct)) + '" aria-label="Límite total usado"><span style="width:' + Math.min(100, pct) + '%"></span></div>';
  }
  $('#budSub').textContent = 'Cuánto quieres gastar en ' + U.monthLabel(key).replace(/ \d{4}$/, '').toLowerCase() + ' en cada cosa. Te aviso al llegar al 80%.';
}

/* ---------- Diálogo de apartado ---------- */
const CAT_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#06B6D4', '#F97316', '#84CC16', '#EF4444', '#64748B'];
let catEditing = null, catKind = 'limite', pickCatKind;
const KIND_HINT = {
  limite:'Un tope para lo que gastas cada mes en esto. Se reinicia el día 1.',
  acumula:'Para un pago grande que llega una vez (predial, seguro, tenencia, regalos de diciembre): apartas un poco cada mes y lo que no gastas se va juntando.'
};
function renderCatKind(){
  $('#kKindHint').textContent = KIND_HINT[catKind];
  $('#kLimitBox').hidden = catKind !== 'limite'; $('#kSaveBox').hidden = catKind !== 'acumula';
  renderCatPlan();
}
const catStart = () => { const c = catEditing && store.get('categories', catEditing); return (c && c.start_month || today().slice(0, 7) + '-01').slice(0, 7); };
/** «Apartarás $X al mes durante N meses»: se recalcula al escribir el costo o la fecha. */
function renderCatPlan(){
  const box = $('#kPlan'), target = U.parseAmount($('#kTarget').value), due = $('#kDue').value;
  const m = catKind === 'acumula' && target > 0 && due ? Fi.monthlyForTarget(U.toCents(target), catStart(), due) : null;
  box.hidden = !m; if (!m) return;
  const months = Math.max(1, U.monthDiff(catStart(), due.slice(0, 7)) + 1);
  box.innerHTML = ico('check', 16) + '<span>Apartarás <strong>' + money(m) + '</strong> al mes durante ' + months + (months === 1 ? ' mes' : ' meses') + '.</span>';
}
function openCat(id){
  const c = id ? store.get('categories', id) : null, b = c ? store.get('budgets', c.id) : null; catEditing = c ? c.id : null;
  $('#catTitle').textContent = c ? 'Editar apartado' : 'Nuevo apartado';
  $('#kName').value = c ? c.name : '';
  pickCatKind(c && c.kind === 'acumula' ? 'acumula' : 'limite');
  $('#kAmount').value = b && !(c && c.kind === 'acumula') ? U.centsToInput(b.amount) : '';
  $('#kTarget').value = c && c.target ? U.centsToInput(c.target) : ''; $('#kDue').value = c && c.due ? c.due : '';
  const icon = c ? c.icon : 'coffee', col = c ? c.color : CAT_COLORS[store.all('categories').length % CAT_COLORS.length];
  $('#kIcons').innerHTML = U.CUSTOM_ICONS.map(n => '<label class="icon-opt"><input type="radio" name="kicon" value="' + n + '"' + (n === icon ? ' checked' : '') + ' aria-label="Ícono ' + n + '"><span>' + ico(n, 20) + '</span></label>').join('');
  $('#kColors').innerHTML = CAT_COLORS.map((cc, i) => '<label style="--c:' + cc + '"><input type="radio" name="kcolor" value="' + cc + '"' + (cc === col ? ' checked' : '') + ' aria-label="Color ' + (i + 1) + '">' + ico('check', 20) + '<span class="ring"></span></label>').join('');
  ['kName', 'kAmount', 'kTarget', 'kDue'].forEach(k => setErr(k, ''));
  $('#kDelete').hidden = !c; $('#kSubmit').textContent = c ? 'Guardar cambios' : 'Crear apartado';
  renderCatKind();
  openDlg($('#catDlg')); if (!c) setTimeout(() => $('#kName').focus(), 50);
}
function submitCat(){
  const name = $('#kName').value.trim(), due = $('#kDue').value;
  const e = {kName:name ? '' : 'Ponle un nombre.', kAmount:'', kTarget:'', kDue:''};
  if (catKind === 'limite') e.kAmount = amountRule('kAmount');
  else { e.kTarget = amountRule('kTarget'); e.kDue = !/^\d{4}-\d{2}-\d{2}$/.test(due) ? 'Elige la fecha del pago.' : due < today() ? 'Elige una fecha que no haya pasado.' : ''; }
  Object.entries(e).forEach(([k, m]) => setErr(k, m));
  const first = Object.keys(e).find(k => e[k]); if (first){ $('#' + first).focus(); return; }
  const id = catEditing || ('c-' + U.uid()).slice(0, 40), start = catStart() + '-01';
  const target = catKind === 'acumula' ? U.toCents(U.parseAmount($('#kTarget').value)) : null;
  const monthly = catKind === 'acumula' ? Fi.monthlyForTarget(target, start, due) : U.toCents(U.parseAmount($('#kAmount').value));
  store.put('categories', {id, name:name.slice(0, 40), color:($('input[name="kcolor"]:checked') || {}).value || CAT_COLORS[0], icon:($('input[name="kicon"]:checked') || {}).value || 'more',
    kind:catKind, target, due:catKind === 'acumula' ? due : null, start_month:start});
  store.put('budgets', {id, amount:monthly});
  closeDlg($('#catDlg'));
  toast(catEditing ? 'Apartado actualizado' : catKind === 'acumula' ? 'Listo: aparta ' + money(monthly) + ' al mes' : 'Apartado creado');
}
function deleteCat(){
  const c = store.remove('categories', catEditing); if (!c) return;
  const b = store.remove('budgets', c.id);
  closeDlg($('#catDlg'));
  toast('Apartado eliminado (sus movimientos se conservan)', 'Deshacer', () => { store.put('categories', Object.assign({}, c)); if (b) store.put('budgets', Object.assign({}, b)); });
}

/* ---------- Cubrir un sobregasto con lo que sobra en otro límite ---------- */
let covTo = null;
function openCover(id){
  const key = viewKey(), L = limitsFor(key), l = L[id]; if (!l) return;
  covTo = id;
  const need = Math.max(0, -l.left), src = Object.values(L).filter(x => x.id !== id && x.left > 0).sort((a, b) => b.left - a.left);
  $('#covTitle').textContent = 'Cubrir ' + catOf(id).name;
  $('#covText').innerHTML = need ? 'Te pasaste por <strong>' + money(need) + '</strong> en ' + U.monthLabel(key).replace(/ \d{4}$/, '').toLowerCase() + '. Toma lo que te sobra de otro límite.' : 'Pasa dinero que te sobra de otro límite a este.';
  $('#covText').dataset.need = need;
  $('#covList').innerHTML = src.length ? src.map((x, i) => { const c = catOf(x.id); return '<li><label class="cov-opt" style="--c:' + c.color + '"><input type="radio" name="covFrom" value="' + esc(x.id) + '" data-left="' + x.left + '"' + (i === 0 ? ' checked' : '') + '><span class="catdot">' + ico(c.icon, 18) + '</span><span class="cov-name">' + esc(c.name) + '</span><span class="cov-left">le sobran ' + money(x.left) + '</span></label></li>'; }).join('')
    : '<li class="empty sm">Ningún otro límite tiene dinero de sobra este mes.</li>';
  ['covList', 'covAmount'].forEach(k => setErr(k, ''));
  $('#covSubmit').disabled = !src.length;
  fillCoverAmount();
  openDlg($('#covDlg'));
}
function fillCoverAmount(){
  const r = $('input[name="covFrom"]:checked'), need = Number($('#covText').dataset.need) || 0;
  $('#covAmount').value = r ? U.centsToInput(need ? Math.min(need, Number(r.dataset.left)) : Number(r.dataset.left)) : '';
}
function submitCover(){
  const r = $('input[name="covFrom"]:checked');
  if (!r){ setErr('covList', 'Elige de dónde tomarlo.'); return; }
  const amt = U.toCents(U.parseAmount($('#covAmount').value)), left = Number(r.dataset.left);
  const m = !(amt > 0) ? 'Escribe un monto mayor a 0.' : amt > left ? 'A ' + catOf(r.value).name + ' solo le sobran ' + money(left) + '.' : '';
  setErr('covAmount', m); if (m){ $('#covAmount').focus(); return; }
  const mv = store.put('budget_moves', {id:U.uid(), month:viewKey(), from_cat:r.value, to_cat:covTo, amount:amt});
  closeDlg($('#covDlg'));
  toast('Moviste ' + money(amt) + ' de ' + catOf(r.value).name + ' a ' + catOf(covTo).name, 'Deshacer', () => store.remove('budget_moves', mv.id));
}

/* ---------- Plan para salir de deudas ---------- */
const DEBT_EXTRA = 'gastos:debtExtra';
/** En el plan de deudas los saldos e intereses son estimaciones: se muestran en pesos enteros. */
const pesos = c => money(Math.round(c / 100) * 100);
const debtExtra = () => { const n = U.parseAmount($('#debtExtra').value); return n > 0 && n < 1e9 ? U.toCents(n) : 0; };
function saveDebtExtra(){ try { localStorage.setItem(DEBT_EXTRA, $('#debtExtra').value.trim()); } catch(e){} }
/**
 * Compara avalancha (primero la de mayor interés) contra bola de nieve (primero la más chica) con lo que puedes pagar
 * de más al mes. Recomienda avalancha solo si el ahorro en intereses es claro; si no, bola de nieve (motiva más).
 */
function renderDebts(){
  const t = today(), list = Fi.debtList(store.all('recurring'), t);
  $('#debtEmpty').hidden = !!list.length; $('#debtMain').hidden = !list.length;
  if (!list.length){
    $('#debtEmpty').innerHTML = ico('flag', 32) + '<p>No tienes deudas a plazo registradas.</p><p class="muted">Agrega tus compras a meses o créditos con su número de pagos y te digo cómo liquidarlos más rápido.</p><button type="button" class="btn primary" data-new-debt>' + ico('plus', 18) + '<span>Agregar deuda</span></button>';
    return;
  }
  const extra = debtExtra(), total = list.reduce((s, d) => s + d.balance, 0), monthly = list.reduce((s, d) => s + d.payment, 0);
  const first = list.map(d => U.nextDue(store.get('recurring', d.id), t).date.slice(0, 7)).sort()[0];
  const end = months => U.monthLabel(U.addMonths(first, months - 1)).toLowerCase();
  const min = Fi.payoffPlan(list, 0, 'minimo'), av = Fi.payoffPlan(list, extra, 'avalancha'), bo = Fi.payoffPlan(list, extra, 'bola');
  $('#debtSum').innerHTML = '<p class="plan-lbl">Debes</p><p class="plan-val">' + pesos(total) + '</p><p class="plan-sub">' + list.length + (list.length === 1 ? ' deuda' : ' deudas') + ' · pagas ' + money(monthly) + ' al mes</p>' +
    '<p class="debt-min">Sin pagar de más terminas en <strong>' + end(min.months) + '</strong>' + (min.interest > 0 ? ' y pagas ' + pesos(min.interest) + ' de intereses.' : ', sin intereses.') + '</p>';
  const cur = store.settings().currency || 'MXN', steps = cur === 'MXN' ? [50000, 100000, 200000] : [5000, 10000, 20000];
  const chips = steps.map(v => '<button type="button" class="chip-btn" data-extra="' + v + '">+' + money(v) + '</button>').join('');
  if ($('#debtChips')._html !== chips){ $('#debtChips')._html = chips; $('#debtChips').innerHTML = chips; }

  const allZero = list.every(d => !d.rate), saving = bo.interest - av.interest;
  const rec = list.length === 1 ? 'av' : allZero ? 'bo' : saving >= Math.max(50000, total * .01) ? 'av' : 'bo';
  const name = id => esc((list.find(d => d.id === id) || {}).name || '');
  $('#debtWhy').innerHTML = list.length === 1 ? '' : allZero
    ? ico('info', 16) + '<span>Tus deudas no cobran intereses: adelantar pagos no te ahorra dinero, pero liberas mensualidades antes. Empieza por la más chica.</span>'
    : rec === 'av' ? ico('check', 16) + '<span>Empezar por la de mayor interés te ahorra <strong>' + pesos(saving) + '</strong> en intereses.</span>'
    : ico('check', 16) + '<span>La diferencia en intereses es pequeña (' + pesos(Math.max(0, saving)) + '): empezar por la más chica te deja ver avances antes.</span>';
  const card = (key, title, desc, r) => {
    const faster = min.months - r.months, best = rec === key, order = r.order.map((id, i) => '<li><span>' + (i + 1) + '. ' + name(id) + '</span><span>' + end(r.finish[id]) + '</span></li>').join('');
    return '<article class="card strat' + (best ? ' best' : '') + '">' + (best ? '<span class="badge new">Te conviene</span>' : '') + '<h3>' + title + '</h3><p class="sub">' + desc + '</p>' +
      '<p class="strat-end">Terminas en <strong>' + end(r.months) + '</strong></p><p class="strat-meta">' + (faster > 0 ? faster + (faster === 1 ? ' mes antes' : ' meses antes') : 'Igual que sin pagar de más') + ' · ' + (r.interest ? 'intereses ' + pesos(r.interest) : 'sin intereses') + '</p>' +
      '<ol class="strat-order upcoming">' + order + '</ol></article>';
  };
  $('#debtCmp').innerHTML = list.length === 1
    ? card('av', 'Con ' + money(extra) + ' de más al mes', 'Todo va a tu única deuda', av)
    : card('av', 'Avalancha', 'Primero la de mayor interés: pagas menos intereses', av) + card('bo', 'Bola de nieve', 'Primero la más chica: la liquidas antes y te motiva', bo);

  $('#debtList').innerHTML = list.map(d => { const c = catOf((store.get('recurring', d.id) || {}).category);
    return '<div class="rec" style="--c:' + c.color + '"><span class="catdot">' + ico(c.icon, 20) + '</span><div style="min-width:0"><p class="rec-name">' + esc(d.name) + '</p><p class="rec-meta">Faltan ' + d.remaining + ' de ' + d.of + ' pagos de ' + money(d.payment) + ' · ' + (d.rate ? d.rate + '% anual' : 'sin intereses') + '</p></div>' +
      '<p class="tx-amt">' + pesos(d.balance) + '</p><div class="rec-acts"><button type="button" class="icon-btn" data-rec="' + esc(d.id) + '" aria-label="Editar ' + esc(d.name) + ' (pagos y tasa)">' + ico('pencil', 18) + '</button></div></div>'; }).join('');
}

/* ---------- Metas ---------- */
const GOAL_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#06B6D4', '#F97316', '#84CC16'];
function renderGoals(){
  const goals = store.all('goals').sort((a, b) => (a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1), t = today();
  if (!goals.length){
    $('#goalList').innerHTML = '<div class="card empty">' + ico('target', 32) + '<p>Aún no tienes metas. Crea una para tu fondo de emergencia, un viaje o algo grande.</p><button type="button" class="btn primary" data-new-goal>' + ico('plus', 18) + '<span>Crear mi primera meta</span></button></div>';
    return;
  }
  $('#goalList').innerHTML = goals.map(g => {
    const pct = Math.min(100, g.saved / g.target * 100), plan = U.goalPlan(g, t);
    let planTxt, cls = '';
    if (plan.left === 0){ planTxt = ico('check', 16) + '<span>¡Lo lograste!</span>'; cls = 'done'; }
    else if (plan.late){ planTxt = ico('alert', 16) + '<span>Se pasó la fecha; te faltan ' + money(plan.left) + '.</span>'; cls = 'late'; }
    else if (plan.monthly){ planTxt = ico('calendar', 16) + '<span>Aparta <strong>' + money(plan.monthly) + '</strong> al mes para llegar a tiempo.</span>'; }
    else planTxt = ico('target', 16) + '<span>Te faltan ' + money(plan.left) + '.</span>';
    return '<article class="card goal" style="--c:' + esc(g.color) + '"><div class="goal-top"><div class="goal-ring" style="--p:' + pct.toFixed(1) + '" role="img" aria-label="' + Math.floor(pct) + '% completado"><span>' + Math.floor(pct) + '%</span></div><div><h2>' + esc(g.name) + '</h2><p class="goal-amt"><strong>' + money(g.saved) + '</strong> de ' + money(g.target) + '</p></div></div>' +
      '<p class="goal-plan ' + cls + '">' + planTxt + '</p><div class="goal-actions"><button type="button" class="btn primary" data-contrib="' + esc(g.id) + '">' + ico('plus', 18) + '<span>Abonar</span></button><button type="button" class="btn" data-goal="' + esc(g.id) + '">' + ico('pencil', 18) + '<span>Editar</span></button></div></article>';
  }).join('');
}

/* ---------- Fijos (recurrentes) ---------- */
function renderRecurring(){
  const rules = store.all('recurring').sort((a, b) => (b.active - a.active) || (a.type === b.type ? b.amount - a.amount : a.type === 'income' ? -1 : 1)), t = today(), key = viewKey();
  const appliesIn = r => { const i = U.monthDiff(r.start_month.slice(0, 7), key); return r.active && i >= 0 && (!r.occurrences || i < r.occurrences); };
  let fe = 0, fi = 0; rules.forEach(r => { if (appliesIn(r)){ if (r.type === 'income') fi += r.amount; else fe += r.amount; } });
  // Una frase en lugar de tres tarjetas de cifras.
  const sum = $('#recSummary'); sum.hidden = !(fe || fi);
  if (fe || fi) sum.innerHTML = '<p>' + (fe ? 'Pagas <strong>' + money(fe) + '</strong> al mes en fijos' : 'No tienes pagos fijos') + (fi ? ' y recibes <strong class="income">' + money(fi) + '</strong>.' : '.') +
    (fi && fe ? ' <span class="muted">Ya tiene destino el ' + Math.round(fe / fi * 100) + '% de lo que recibes.</span>' : '') + '</p>';
  if (!rules.length){ $('#recList').innerHTML = '<div class="empty">' + ico('repeat', 32) + '<p>Registra lo que pagas o cobras cada mes y se anotará solo el día que toque.</p></div>'; return; }
  $('#recList').innerHTML = rules.map(r => {
    const c = catOf(r.category), n = U.nextDue(r, t);
    const idx = U.monthDiff(r.start_month.slice(0, 7), t.slice(0, 7)) + 1;
    let meta = r.active && n ? 'Próximo: ' + U.fmtDate(n.date).replace(/ \d{4}$/, '') : 'Cada día ' + r.day;
    if (r.occurrences) meta += ' · ' + (idx > r.occurrences ? 'terminado' : 'pago ' + Math.max(1, Math.min(idx, r.occurrences)) + ' de ' + r.occurrences);
    if (!r.active) meta += ' · <span class="badge">Pausado</span>';
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
function openDlg(d){ if (d.open) return; if (d.showModal) d.showModal(); else d.setAttribute('open', ''); fx.dialogIn(d); }
function closeDlg(d){
  if (!d.open || d._closing) return;
  d._closing = true;
  fx.dialogOut(d).then(() => { d._closing = false; fx.clear(d); if (d.close) d.close(); else d.removeAttribute('open'); });
}
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
  $('#fAmount').value = t ? (t.amount / 100).toFixed(2) : preset && preset.amount ? U.centsToInput(preset.amount) : '';
  $('#fDate').value = t ? t.date : preset && preset.date ? preset.date : (isCurrentMonth() ? today() : viewKey() + '-01');
  $('#fDesc').value = t ? t.description || '' : (preset && preset.description) || '';
  $('#fCard').value = t ? t.card || '' : '';
  $('#fMore').open = !!($('#fDesc').value || $('#fCard').value);
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
/** `preset` precarga un fijo nuevo (desde el calendario o al registrar una compra simulada a meses). */
function openRec(id, preset){
  const r = id ? store.get('recurring', id) : null, p = !r && preset || {}; recEditing = r ? r.id : null;
  pickRecType(r ? r.type : p.type || 'expense'); fillRecCats(recType, r ? r.category : p.category || '');
  $('#recTitle').textContent = r ? 'Editar fijo' : 'Nuevo fijo';
  $('#rName').value = r ? r.name : (p.name || '').slice(0, 60); $('#rAmount').value = r ? U.centsToInput(r.amount) : p.amount ? U.centsToInput(p.amount) : '';
  $('#rDay').value = r ? r.day : p.day || Number(today().slice(8, 10)); $('#rStart').value = r ? r.start_month.slice(0, 7) : p.start || today().slice(0, 7);
  $('#rOcc').value = r && r.occurrences ? r.occurrences : p.occ || '';
  $('#rRate').value = r && r.rate ? String(r.rate) : '';
  $('#recTitle').textContent = r ? (r.occurrences ? 'Editar deuda o fijo' : 'Editar fijo') : p.debt ? 'Nueva deuda' : 'Nuevo fijo';
  syncRateField();
  ['rName', 'rAmount', 'rCat', 'rDay', 'rStart', 'rOcc', 'rRate'].forEach(k => setErr(k, ''));
  $('#rDelete').hidden = !r;
  openDlg($('#recDlg')); if (!r) setTimeout(() => $('#rName').focus(), 50);
}
/** La tasa solo tiene sentido en algo con número de pagos (compras a meses, créditos). */
function syncRateField(){ $('#rRateField').hidden = !$('#rOcc').value.trim(); }
function submitRec(){
  const day = Number($('#rDay').value), occ = $('#rOcc').value.trim(), start = $('#rStart').value;
  const e = {rName:$('#rName').value.trim() ? '' : 'Escribe un nombre.', rAmount:amountRule('rAmount'), rCat:$('#rCat').value ? '' : 'Elige una categoría.',
    rDay:Number.isInteger(day) && day >= 1 && day <= 31 ? '' : 'Un día entre 1 y 31.', rStart:/^\d{4}-\d{2}$/.test(start) ? '' : 'Elige el mes de inicio.',
    rOcc:!occ || (/^\d+$/.test(occ) && +occ >= 1 && +occ <= 600) ? '' : 'Un número entre 1 y 600, o déjalo vacío.',
    rRate:!occ || !$('#rRate').value.trim() || (U.parseAmount($('#rRate').value) >= 0 && U.parseAmount($('#rRate').value) <= 500) ? '' : 'Una tasa entre 0 y 500%, o déjala vacía.'};
  Object.entries(e).forEach(([k, m]) => setErr(k, m));
  const first = Object.keys(e).find(k => e[k]); if (first){ $('#' + first).focus(); return; }
  const prev = recEditing ? store.get('recurring', recEditing) : null;
  store.put('recurring', {id:recEditing || U.uid(), name:$('#rName').value.trim().slice(0, 60), type:recType, category:$('#rCat').value, amount:U.toCents(U.parseAmount($('#rAmount').value)),
    day, start_month:start + '-01', occurrences:occ ? Number(occ) : null, active:prev ? prev.active : true,
    rate:occ && $('#rRate').value.trim() ? Math.round(U.parseAmount($('#rRate').value) * 100) / 100 || null : null});
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
  return JSON.stringify({app:'gastos', version:2, exportado:new Date().toISOString(), nota:'Montos en centavos', currency:store.settings().currency, opening_balance:store.settings().opening_balance || 0, opening_date:store.settings().opening_date || null,
    transactions:store.all('transactions').map(strip), budgets:store.all('budgets').map(strip), goals:store.all('goals').map(strip), recurring:store.all('recurring').map(strip), merchant_rules:store.all('merchant_rules').map(strip),
    categories:store.all('categories').map(strip), budget_moves:store.all('budget_moves').map(strip)}, null, 2);
}
let pendingImport = null;
function parseBackup(text){
  const d = JSON.parse(text);
  const srcTx = Array.isArray(d) ? d : d.transactions || d.tx;
  if (!Array.isArray(srcTx)) throw new Error('No encontré movimientos en el archivo.');
  // Apartados primero: sus ids deben valer como categoría al revisar movimientos, límites y fijos del archivo.
  const cats = Array.isArray(d.categories) ? d.categories.filter(c => c && typeof c.id === 'string' && /^[\w-]{1,40}$/.test(c.id) && !U.CAT[c.id] && typeof c.name === 'string' && c.name.trim())
    .map(c => ({id:c.id, name:c.name.trim().slice(0, 40), color:/^#[0-9A-Fa-f]{6}$/.test(c.color) ? c.color : '#94A3B8', icon:U.CUSTOM_ICONS.includes(c.icon) ? c.icon : 'more', kind:c.kind === 'acumula' ? 'acumula' : 'limite',
      target:Number.isInteger(c.target) && c.target > 0 ? c.target : null, due:/^\d{4}-\d{2}-\d{2}$/.test(c.due) ? c.due : null, start_month:/^\d{4}-\d{2}-\d{2}$/.test(c.start_month) ? c.start_month : null})) : null;
  if (cats) U.setCustomCats(store.allRaw('categories').concat(cats));
  const seen = new Set(), tx = []; let skipped = 0;
  srcTx.forEach(t => { const c = U.cleanTx(t); if (!c || seen.has(c.id)){ skipped++; return; } seen.add(c.id); tx.push(c); });
  const budgets = [];
  if (Array.isArray(d.budgets)) d.budgets.forEach(b => { if (b && CAT[b.id] && CAT[b.id].type === 'expense' && Number.isInteger(b.amount) && b.amount > 0) budgets.push({id:b.id, amount:b.amount}); });
  else if (d.budgets && typeof d.budgets === 'object') Object.entries(d.budgets).forEach(([k, v]) => { if (CAT[k] && CAT[k].type === 'expense' && Number.isInteger(v) && v > 0) budgets.push({id:k, amount:v}); });
  const okId = s => typeof s === 'string' && /^[\w-]{1,64}$/.test(s);
  const goals = (Array.isArray(d.goals) ? d.goals : []).filter(g => g && okId(g.id) && typeof g.name === 'string' && Number.isInteger(g.target) && g.target > 0)
    .map(g => ({id:g.id, name:g.name.slice(0, 60), target:g.target, saved:Number.isInteger(g.saved) && g.saved > 0 ? g.saved : 0, deadline:/^\d{4}-\d{2}-\d{2}$/.test(g.deadline) ? g.deadline : null, color:/^#[0-9A-Fa-f]{6}$/.test(g.color) ? g.color : GOAL_COLORS[0]}));
  const recurring = (Array.isArray(d.recurring) ? d.recurring : []).filter(r => r && okId(r.id) && typeof r.name === 'string' && (r.type === 'income' || r.type === 'expense') && CAT[r.category] && CAT[r.category].type === r.type && Number.isInteger(r.amount) && r.amount > 0 && Number.isInteger(r.day) && r.day >= 1 && r.day <= 31 && /^\d{4}-\d{2}-\d{2}$/.test(r.start_month))
    .map(r => ({id:r.id, name:r.name.slice(0, 60), type:r.type, category:r.category, amount:r.amount, day:r.day, start_month:r.start_month.slice(0, 7) + '-01', occurrences:Number.isInteger(r.occurrences) && r.occurrences > 0 ? r.occurrences : null, active:r.active !== false,
      rate:typeof r.rate === 'number' && r.rate > 0 && r.rate <= 500 ? r.rate : null}));
  const currency = ['MXN', 'USD', 'EUR'].includes(d.currency) ? d.currency : null;
  const rules = Array.isArray(d.merchant_rules) ? d.merchant_rules.filter(r => r && typeof r.id === 'string' && r.id.length >= 1 && r.id.length <= 60 && CAT[r.category] && CAT[r.category].type === 'expense')
    .map(r => ({id:r.id, name:String(r.name || '').slice(0, 60), category:r.category})) : null; // null = el respaldo no trae reglas: se conservan las actuales
  const opening = Number.isInteger(d.opening_balance) && Math.abs(d.opening_balance) <= 99999999999 ? {opening_balance:d.opening_balance, opening_date:/^\d{4}-\d{2}-\d{2}$/.test(d.opening_date) ? d.opening_date : null} : null;
  const moves = Array.isArray(d.budget_moves) ? d.budget_moves.filter(m => m && okId(m.id) && /^\d{4}-\d{2}$/.test(m.month) && CAT[m.from_cat] && CAT[m.to_cat] && Number.isInteger(m.amount) && m.amount > 0)
    .map(m => ({id:m.id, month:m.month, from_cat:m.from_cat, to_cat:m.to_cat, amount:m.amount})) : null;
  loadCats(); // deja las categorías como estaban hasta que se confirme la importación
  return {tx, budgets, goals, recurring, rules, currency, opening, skipped, cats, moves};
}
function applyImport(p){
  if (p.cats) store.replaceTable('categories', p.cats);
  if (p.moves) store.replaceTable('budget_moves', p.moves);
  store.replaceTable('transactions', p.tx); store.replaceTable('budgets', p.budgets); store.replaceTable('goals', p.goals); store.replaceTable('recurring', p.recurring);
  if (p.rules) store.replaceTable('merchant_rules', p.rules);
  if (p.currency || p.opening) store.put('settings', Object.assign({id:'main', currency:p.currency || store.settings().currency}, p.opening || {}));
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
  else info.textContent = has ? 'Activo desde el ' + new Date(wallet.date).toLocaleDateString('es-MX', {day:'numeric', month:'long', year:'numeric'}) + '. Tus atajos ya pueden registrar gastos.' : 'Desactivado. Actívalo para registrar gastos automáticamente desde el aviso de tu banco o Apple Pay.';
  const off = wallet.busy || wallet.date === undefined;
  btns.innerHTML = has
    ? '<button type="button" class="btn" id="walletNew"' + (off ? ' disabled' : '') + '>' + ico('refresh', 18) + '<span>Generar token nuevo</span></button><button type="button" class="btn danger" id="walletOff"' + (off ? ' disabled' : '') + '>Desactivar</button>'
    : '<button type="button" class="btn primary" id="walletNew"' + (off || wallet.error ? ' disabled' : '') + '>' + ico('plus', 18) + '<span>Activar registro automático</span></button>';
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
    else { await sync.revokeWalletToken(); wallet.token = null; wallet.date = null; toast('Registro automático desactivado'); }
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
  if (sync.enabled) sync.sync();
  pickTheme(document.documentElement.getAttribute('data-theme') || 'auto');
  $('#bgLevel').checked = document.documentElement.getAttribute('data-bg') !== 'plain';
  $('#dbUpdate').hidden = !(sync.enabled && sync.schemaOutdated());
  renderRules(); renderWallet(); refreshWallet(); plan.renderPush(true);
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
function showAuth(mode = 'login'){ $('#app').hidden = true; $('#authView').hidden = false; lastRoute = null; fx.enter($('#authView')); setAuthMode(mode); setTimeout(() => $(mode === 'newpass' ? '#aPass' : '#aEmail').focus(), 50); }
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
  pickTheme = bindSeg($('#themeSeg'), t => { const cur = document.documentElement.getAttribute('data-theme') || 'auto'; if (t !== cur) setTheme(t); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!document.documentElement.getAttribute('data-theme')){ renderThemeBtn(); repaintCharts(); } });
  $('#settingsBtn').onclick = openSettings;
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

  // Saldo
  $('#balBtn').onclick = openBalance;
  $('#bAmount').addEventListener('input', renderBalHint);
  $('#balForm').addEventListener('submit', e => { e.preventDefault(); submitBalance(); });

  // Movimiento
  pickTxType = bindSeg($('#typeSeg'), t => { const changed = txType !== t; txType = t; if (changed && $('#fCats').children.length) renderCatGrid(t); renderTxSubmit(); });
  $('#txForm').addEventListener('submit', e => { e.preventDefault(); submitTx(); });
  $('#fDelete').onclick = () => deleteTx(txEditing);
  $('#errSummary').addEventListener('click', e => { const b = e.target.closest('[data-focus]'); if (!b) return; const el = $('#' + b.dataset.focus); (el.querySelector ? el.querySelector('input') || el : el).focus(); });
  ['fAmount', 'fDate'].forEach(id => $('#' + id).addEventListener('blur', () => { if ($('#' + id).value !== '' || !$('#' + id + 'Err').hidden) setErr(id, txRules[id]()); }));
  $('#fCats').addEventListener('change', () => setErr('fCats', ''));
  document.addEventListener('click', e => {
    const tx = e.target.closest('[data-tx]'); if (tx){ openTx(tx.dataset.tx); return; }
    const cov = e.target.closest('[data-cover]'); if (cov){ openCover(cov.dataset.cover); return; }
    const ec = e.target.closest('[data-edit-cat]'); if (ec){ openCat(ec.dataset.editCat); return; }
    const ant = e.target.closest('[data-ant-q], [data-ant-cat]');
    if (ant){
      filters.q = ant.dataset.antQ || ''; filters.cat = ant.dataset.antCat || 'all'; filters.allMonths = false; listLimit = 80;
      $('#qSearch').value = filters.q; $('#qCat').value = filters.cat; $('#qAll').checked = false; pickQType('expense'); filters.type = 'expense';
      location.hash = '#movimientos'; return;
    }
    if (e.target.closest('[data-new-debt]')){ openRec(null, {debt:true, occ:12, category:'deudas'}); return; }
    const ex = e.target.closest('[data-extra]'); if (ex){ $('#debtExtra').value = U.centsToInput(Number(ex.dataset.extra)); saveDebtExtra(); renderDebts(); return; }
    const lg = e.target.closest('[data-cat]');
    if (lg){ filters.cat = lg.dataset.cat; filters.allMonths = false; $('#qCat').value = filters.cat; $('#qAll').checked = false; pickQType('all'); location.hash = '#movimientos'; return; }
    if (e.target.closest('[data-new-goal]')){ openGoal(); return; }
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
  pickQType = bindSeg($('#qTypeSeg'), t => { if (filters.type === t) return; filters.type = t; listLimit = 80; if (route === 'movimientos') renderList(); });
  $('#qMoreBtn').onclick = () => { const box = $('#qMore'), open = box.hidden; box.hidden = !open; $('#qMoreBtn').setAttribute('aria-expanded', open); };
  $('#qCat').onchange = e => { filters.cat = e.target.value; listLimit = 80; renderList(); };
  $('#qSort').onchange = e => { filters.sort = e.target.value; renderList(); };
  $('#qAll').onchange = e => { filters.allMonths = e.target.checked; listLimit = 80; renderList(); };
  $('#moreBtn').onclick = () => { listLimit += 80; renderList(); };

  // Límites de gasto
  $('#budMore').addEventListener('toggle', e => { e.currentTarget.dataset.touched = '1'; });
  // Inicio: el análisis solo se calcula al abrirlo
  $('#analysis').addEventListener('toggle', () => { if ($('#analysis').open){ renderAnalysis(); requestAnimationFrame(charts.resizeAll); } });
  // Escucha toda la vista: los campos de «Poner límite a otra categoría» viven fuera de #budList.
  $('#v-presupuestos').addEventListener('change', e => {
    const inp = e.target.closest('input[data-bud]'); if (!inp) return;
    const id = inp.dataset.bud, raw = inp.value.trim();
    if (!raw){ store.remove('budgets', id); return; }
    const n = U.parseAmount(raw);
    if (!(n > 0) || n > 999999999){ toast('Escribe un límite válido (mayor a 0) o déjalo vacío.'); renderBudgets(); return; }
    store.put('budgets', {id, amount:U.toCents(n)});
  });

  // Metas
  $('#newGoal').onclick = () => openGoal();
  $('#goalForm').addEventListener('submit', e => { e.preventDefault(); submitGoal(); });
  $('#gDelete').onclick = () => { const g = store.remove('goals', goalEditing); closeDlg($('#goalDlg')); if (g) toast('Meta eliminada', 'Deshacer', () => store.put('goals', Object.assign({}, g))); };
  pickContrib = bindSeg($('#cSeg'), m => { contribMode = m; $('#cSubmit').textContent = m === 'add' ? 'Abonar' : 'Retirar'; });
  $('#contribForm').addEventListener('submit', e => { e.preventDefault(); submitContrib(); });

  // Apartados propios y cubrir sobregastos
  $('#newCat').onclick = () => openCat();
  pickCatKind = bindSeg($('#kSeg'), k => { catKind = k; renderCatKind(); });
  ['kTarget', 'kDue'].forEach(id => $('#' + id).addEventListener('input', renderCatPlan));
  $('#catForm').addEventListener('submit', e => { e.preventDefault(); submitCat(); });
  $('#kDelete').onclick = deleteCat;
  $('#covList').addEventListener('change', fillCoverAmount);
  $('#covForm').addEventListener('submit', e => { e.preventDefault(); submitCover(); });

  // Deudas
  $('#newDebt').onclick = () => openRec(null, {debt:true, occ:12, category:'deudas'});
  try { $('#debtExtra').value = localStorage.getItem(DEBT_EXTRA) || ''; } catch(e){}
  let dT = null;
  $('#debtExtra').addEventListener('input', () => { clearTimeout(dT); dT = setTimeout(() => { saveDebtExtra(); renderDebts(); }, 200); });

  // Fondo
  $('#bgLevel').addEventListener('change', e => {
    if (e.target.checked) document.documentElement.removeAttribute('data-bg'); else document.documentElement.setAttribute('data-bg', 'plain');
    try { if (e.target.checked) localStorage.removeItem('gastos:bg'); else localStorage.setItem('gastos:bg', 'plain'); } catch(err){}
    liquidLast = ''; renderLiquid();
  });

  // Fijos
  $('#newRec').onclick = () => openRec();
  $('#rOcc').addEventListener('input', syncRateField);
  pickRecType = bindSeg($('#rSeg'), t => { const changed = recType !== t; recType = t; if (changed) fillRecCats(t, ''); });
  $('#recForm').addEventListener('submit', e => { e.preventDefault(); submitRec(); });
  $('#rDelete').onclick = () => { const r = store.remove('recurring', recEditing); closeDlg($('#recDlg')); if (r) toast('Fijo eliminado (los movimientos ya registrados se conservan)', 'Deshacer', () => store.put('recurring', Object.assign({}, r))); };

  // Ajustes
  $('#curSel').onchange = e => { store.put('settings', {id:'main', currency:e.target.value}); makeNF(); repaintCharts(); };
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
      $('#impConfirmTxt').textContent = 'El archivo trae ' + pendingImport.tx.length + ' movimientos, ' + pendingImport.budgets.length + ' presupuestos, ' + pendingImport.goals.length + ' metas, ' + pendingImport.recurring.length + ' fijos' + (pendingImport.cats && pendingImport.cats.length ? ' y ' + pendingImport.cats.length + ' apartados' : '') + (pendingImport.skipped ? ' (' + pendingImport.skipped + ' movimientos inválidos se omitirán)' : '') + '. Reemplazará tus datos actuales' + (sync.enabled ? ' en todos tus dispositivos' : '') + '.';
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
    store.put('settings', {id:'main', currency:store.settings().currency, opening_balance:0, opening_date:null});
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
  fx.init(); paintIcons();
  ['#kpis', '#stats', '#duo', '#topCats', '#insights', '#recentList', '#reviewList', '#txList', '#goalList', '#recList', '#recSummary', '#planKpis', '#planAlerts', '#calGrid', '#planDay', '#weekCard', '#antCard', '#debtSum', '#debtCmp', '#debtList'].forEach(sel => skipSameHTML($(sel)));
  store.load(); makeNF(); loadCats();
  plan.init({money, units, compact, cf:v => cf.format(v), today, view, viewKey, toast, openTx, openRec, openDlg, closeDlg, txRow, render});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); // pide que el sistema no borre los datos locales

  renderThemeBtn(); bind();
  { const nav = $('.tabs'); if (window.ResizeObserver) new ResizeObserver(() => fx.moveIndicator(nav, true)).observe(nav); if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fx.moveIndicator(nav, true)); }
  store.onChange(origin => {
    loadCats();
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
