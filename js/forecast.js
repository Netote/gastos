/*
 * Motor de proyección: saldo previsto día a día. Lo comparten el calendario, el simulador de compras y el reporte
 * semanal, así los tres dan siempre las mismas cifras. Lógica pura (sin DOM), montos en centavos, fechas 'YYYY-MM-DD'.
 *
 * Qué se proyecta:
 *   + cobros de los fijos activos y movimientos ya capturados con fecha futura;
 *   + ingresos habituales detectados en el historial (p. ej. una quincena capturada a mano cada mes);
 *   − gasto variable diario promedio de los últimos 90 días.
 * Los ingresos esporádicos NO se proyectan: la estimación es conservadora a propósito.
 */
import {pad, norm, daysIn, parseKey, addMonths, monthDiff, dueDate, recTxId, balanceNow, goalPlan} from './util.js';

/* ---------- Fechas ---------- */
const utc = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export function addDays(s, n){ const d = new Date(utc(s) + n * 864e5); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
export const dayDiff = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
/** 0 = domingo … 6 = sábado. */
export const weekday = s => new Date(utc(s)).getUTCDay();
/** Lunes de la semana de una fecha. */
export const monday = s => addDays(s, -((weekday(s) + 6) % 7));
const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return !n ? 0 : n % 2 ? s[(n - 1) / 2] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2); };
const bucket = (map, k) => { let a = map.get(k); if (!a) map.set(k, a = []); return a; };

/* ---------- Piezas de la proyección ---------- */
/** Cobros de los fijos activos entre dos fechas (inclusive) que todavía no existen como movimiento. */
export function ruleEvents(rules, from, to, exists = () => false){
  const out = [], k0 = from.slice(0, 7), k1 = to.slice(0, 7);
  for (const r of rules){
    if (!r.active || r.deleted) continue;
    const start = r.start_month.slice(0, 7);
    for (let i = Math.max(0, monthDiff(start, k0)); ; i++){
      if (r.occurrences && i >= r.occurrences) break;
      const key = addMonths(start, i); if (key > k1) break;
      const date = dueDate(r, key);
      if (date < from || date > to || exists(recTxId(r.id, key))) continue;
      out.push({date, type:r.type, amount:r.amount, name:r.name, category:r.category, kind:'fijo', ruleId:r.id, index:i + 1, of:r.occurrences || null});
    }
  }
  return out;
}

/**
 * Gasto variable diario: gastos no fijos de los últimos 90 días entre los días con historial.
 * Si se pasan los fijos, se omiten los gastos capturados a mano que hoy ya cubre un fijo (misma categoría y monto ±5 %):
 * así la renta no se cuenta dos veces cuando se pasa de anotarla a mano a tenerla como fijo.
 */
export function variableDaily(tx, today, rules = []){
  const from = addDays(today, -90), fixed = rules.filter(r => r.active && !r.deleted && r.type === 'expense'); let first = null, sum = 0;
  const covered = t => fixed.some(r => r.category === t.category && Math.abs(r.amount - t.amount) <= r.amount * .05);
  for (const t of tx){
    if (t.date >= today) continue;
    if (!first || t.date < first) first = t.date;
    if (t.type === 'expense' && !t.recurring_id && t.date >= from && !covered(t)) sum += t.amount;
  }
  if (!first) return {daily:0, days:0, confidence:'none'};
  const days = Math.max(1, dayDiff(first < from ? from : first, today));
  return {daily:Math.round(sum / days), days, confidence:days < 14 ? 'baja' : days < 45 ? 'media' : 'alta'};
}

/**
 * Ingresos habituales capturados a mano: misma categoría y descripción, día del mes parecido (±3) y monto parecido
 * (±40 %) en al menos 2 de los 3 meses anteriores. Se omiten si ya hay un fijo de ingreso equivalente.
 */
export function inferIncome(tx, rules, today){
  const cur = today.slice(0, 7), from = addMonths(cur, -3) + '-01', groups = new Map(), out = [];
  for (const t of tx){
    if (t.type !== 'income' || t.recurring_id || t.date < from || t.date > today) continue;
    bucket(groups, t.category + '|' + norm(t.description || '')).push(t);
  }
  const dom = t => Number(t.date.slice(8, 10));
  const close = cl => {
    const months = new Set(cl.map(t => t.date.slice(0, 7))), paid = months.has(cur);
    if (months.size - (paid ? 1 : 0) < 2) return;
    const amount = median(cl.map(t => t.amount));
    if (cl.some(t => t.amount < amount * .6 || t.amount > amount * 1.4)) return;
    const day = Math.max(...cl.map(dom));
    if (rules.some(r => r.active && !r.deleted && r.type === 'income' && Math.abs(r.amount - amount) <= amount * .15 && Math.abs(r.day - day) <= 3)) return;
    out.push({name:cl[0].description || 'Ingreso habitual', category:cl[0].category, amount, day, paidThisMonth:paid});
  };
  for (const list of groups.values()){
    list.sort((a, b) => dom(a) - dom(b));
    let cl = [];
    for (const t of list){ if (cl.length && dom(t) - dom(cl[0]) > 3){ close(cl); cl = []; } cl.push(t); }
    close(cl);
  }
  return out;
}
function inferredEvents(inferred, today, to){
  const out = [], cur = today.slice(0, 7), last = to.slice(0, 7);
  for (const s of inferred){
    for (let key = cur; key <= last; key = addMonths(key, 1)){
      if (key === cur && s.paidThisMonth) continue;
      const date = dueDate(s, key);
      if (date >= today && date <= to) out.push({date, type:'income', amount:s.amount, name:s.name, category:s.category, kind:'estimado'});
    }
  }
  return out;
}

/** Calcula una sola vez lo que no depende del escenario; después `project` es barato y se puede llamar muchas veces. */
export function prepare({opening = 0, tx = [], rules = [], today, exists}){
  const ids = new Set(tx.map(t => t.id)), vd = variableDaily(tx, today, rules);
  return {today, tx, rules, exists:exists || (id => ids.has(id)), start:balanceNow(opening, tx, today), vd, cushion:vd.daily * 7, inferred:inferIncome(tx, rules, today)};
}

/**
 * Saldo previsto de hoy (día 0) a `days` días. `extra` son eventos hipotéticos (una compra simulada).
 * Hoy no descuenta gasto variable: lo ya gastado está en el saldo.
 */
export function project(prep, days = 60, extra = []){
  const {today} = prep, to = addDays(today, days), by = new Map();
  const add = e => { if (e.date >= today && e.date <= to) bucket(by, e.date).push(e); };
  ruleEvents(prep.rules, today, to, prep.exists).forEach(add);
  for (const t of prep.tx){ if (t.date > today && t.date <= to) add({date:t.date, type:t.type, amount:t.amount, name:t.description || '', category:t.category, kind:'mov', id:t.id}); }
  inferredEvents(prep.inferred, today, to).forEach(add);
  extra.forEach(add);
  const out = []; let bal = prep.start, min = null, firstNegative = null;
  for (let i = 0; i <= days; i++){
    const date = addDays(today, i), events = by.get(date) || []; let inc = 0, exp = 0;
    for (const e of events){ if (e.type === 'income') inc += e.amount; else exp += e.amount; }
    const variable = i ? prep.vd.daily : 0;
    bal += inc - exp - variable;
    const d = {date, events, inc, out:exp, variable, balance:bal}; out.push(d);
    if (!min || bal < min.balance) min = d;
    if (bal < 0 && !firstNegative) firstNegative = d;
  }
  return {today, start:prep.start, cushion:prep.cushion, days:out, min, firstNegative};
}
/** Atajo: preparar y proyectar. */
export const forecast = ({days = 60, extra = [], ...ctx}) => project(prepare(ctx), days, extra);

/* ---------- Lecturas de la proyección ---------- */
/**
 * Coincidencias: dos o más obligaciones en una ventana de 3 días. Indica cuánto del saldo previo se llevan y si caen
 * antes del siguiente ingreso. En orden de fecha.
 */
export function clusters(fc){
  const obs = [], incomes = [];
  fc.days.forEach((d, i) => d.events.forEach(e => (e.type === 'income' ? incomes : obs).push({e, i})));
  const out = []; let g = [];
  const close = () => {
    if (g.length >= 2){
      const i0 = g[0].i, i1 = g[g.length - 1].i, total = g.reduce((s, x) => s + x.e.amount, 0);
      const before = i0 ? fc.days[i0 - 1].balance : fc.start, next = incomes.find(x => x.i > i1), prev = incomes.some(x => x.i >= i0 && x.i <= i1);
      out.push({from:fc.days[i0].date, to:fc.days[i1].date, items:g.map(x => x.e), total, balanceBefore:before, balanceAfter:fc.days[i1].balance,
        share:before > 0 ? total / before : 1, nextIncome:next ? next.e : null, incomeInside:prev});
    }
    g = [];
  };
  for (const o of obs){ if (g.length && o.i - g[0].i > 2) close(); g.push(o); }
  close();
  return out;
}

/** Tramos con saldo previsto negativo (`negative`) y tramos por debajo del colchón sin llegar a cero (`low`). */
export function shortfalls(fc){
  const runs = test => {
    const out = []; let r = null;
    fc.days.forEach((d, i) => {
      if (!test(d.balance)){ r = null; return; }
      if (!r){
        // Causas: las obligaciones del día en que empieza el tramo y de los 3 días anteriores.
        const causes = []; for (let j = Math.max(0, i - 3); j <= i; j++) fc.days[j].events.forEach(e => { if (e.type !== 'income') causes.push(e); });
        out.push(r = {from:d.date, to:d.date, min:d.balance, minDate:d.date, causes});
      }
      r.to = d.date; if (d.balance < r.min){ r.min = d.balance; r.minDate = d.date; }
    });
    return out;
  };
  return {negative:runs(b => b < 0), low:fc.cushion > 0 ? runs(b => b >= 0 && b < fc.cushion) : []};
}

const applies = (r, key) => { if (!r.active || r.deleted) return false; const i = monthDiff(r.start_month.slice(0, 7), key); return i >= 0 && (!r.occurrences || i < r.occurrences); };
/** Dinero de un mes típico: ingresos fijos y habituales, gastos fijos, gasto variable y lo que queda libre. */
export function monthly(prep){
  const key = prep.today.slice(0, 7); let income = 0, fixed = 0;
  for (const r of prep.rules){ if (applies(r, key)){ if (r.type === 'income') income += r.amount; else fixed += r.amount; } }
  for (const s of prep.inferred) income += s.amount;
  const variable = Math.round(prep.vd.daily * 30.4);
  return {income, fixed, variable, margin:income - fixed - variable};
}

/** Deudas a plazo: fijos de gasto con número de pagos que aún no terminan. */
export function debts(rules, today){
  const list = []; let total = 0, monthlyPay = 0;
  for (const r of rules){
    if (!r.active || r.deleted || r.type !== 'expense' || !r.occurrences) continue;
    const start = r.start_month.slice(0, 7); let paid = 0;
    for (let i = 0; i < r.occurrences; i++){ if (dueDate(r, addMonths(start, i)) <= today) paid++; else break; }
    const remaining = r.occurrences - paid; if (remaining <= 0) continue;
    const owed = remaining * r.amount;
    list.push({id:r.id, name:r.name, amount:r.amount, paid, of:r.occurrences, remaining, total:owed, end:dueDate(r, addMonths(start, r.occurrences - 1))});
    total += owed; monthlyPay += r.amount;
  }
  list.sort((a, b) => a.end < b.end ? -1 : 1);
  return {list, total, monthly:monthlyPay};
}

/** Pago mensual fijo: sin interés reparte el monto; con tasa anual (%) usa la fórmula de amortización. */
export function installment(amount, months, annualRate = 0){
  const r = annualRate / 1200;
  return !r ? Math.ceil(amount / months) : Math.round(amount * r / (1 - Math.pow(1 + r, -months)));
}

/* ---------- Simulador de compras ---------- */
/** Convierte una compra en eventos: un cargo (contado) o mensualidades desde el mes siguiente, el mismo día. */
export function purchaseEvents(p, today){
  const date = p.date && p.date > today ? p.date : today, name = p.name || 'Compra simulada', category = p.category || 'compras';
  if (p.mode !== 'meses' || !(p.months > 1)) return {date, months:1, pay:p.amount, total:p.amount, events:[{date, type:'expense', amount:p.amount, name, category, kind:'sim'}]};
  const pay = installment(p.amount, p.months, p.rate || 0), day = Number(date.slice(8, 10)), key = date.slice(0, 7), events = [];
  for (let i = 1; i <= p.months; i++) events.push({date:dueDate({day}, addMonths(key, i)), type:'expense', amount:pay, name, category, kind:'sim', index:i, of:p.months});
  return {date, months:p.months, pay, total:pay * p.months, events};
}

const HORIZON = 60;
function judge(prep, p, base, m){
  const pe = purchaseEvents(p, prep.today), sc = project(prep, HORIZON, pe.events), meses = pe.months > 1;
  const marginAfter = m.margin - (meses ? pe.pay : 0);
  let verdict = 'si', reason = 'ok';
  if (sc.min.balance < 0){ verdict = 'no'; reason = base.min.balance < 0 ? 'ya-faltaba' : 'faltante'; }
  else if (meses && m.income > 0 && marginAfter < 0){ verdict = 'no'; reason = 'mensualidad'; }
  else if (sc.min.balance < prep.cushion){ verdict = 'justo'; reason = 'colchon'; }
  else if (meses && m.income > 0 && marginAfter < m.income * .1){ verdict = 'justo'; reason = 'margen'; }
  return {pe, sc, verdict, reason, marginAfter};
}

/**
 * Simula una compra `{amount, mode:'contado'|'meses', months, rate, date, category, name}` y compara contra no hacerla.
 * Veredicto: 'si' (el saldo nunca baja del colchón), 'justo' (no llega a cero pero queda bajo el colchón, o la
 * mensualidad deja menos de 10 % del ingreso libre) o 'no' (habría faltante, o la mensualidad no cabe en el mes).
 */
export function simulatePurchase(prep, p, {budgets = [], goals = []} = {}){
  const base = project(prep, HORIZON), m = monthly(prep);
  const {pe, sc, verdict, reason, marginAfter} = judge(prep, p, base, m), meses = pe.months > 1;
  const first = sc.days.find(d => d.events.some(e => e.kind === 'sim')) || null;
  const at = (fc, n) => fc.days[Math.min(n, fc.days.length - 1)].balance;

  const before = debts(prep.rules, prep.today);
  const after = meses ? {total:before.total + pe.total, monthly:before.monthly + pe.pay, count:before.list.length + 1} : {total:before.total, monthly:before.monthly, count:before.list.length};
  const committed = m.income > 0 ? {before:m.fixed / m.income, after:(m.fixed + (meses ? pe.pay : 0)) / m.income} : null;

  const category = p.category || 'compras', b = budgets.find(x => x.id === category && x.amount > 0);
  let budget = null;
  if (b){
    const key = pe.events[0].date.slice(0, 7); let spent = 0;
    for (const t of prep.tx){ if (t.type === 'expense' && t.category === category && t.date.slice(0, 7) === key) spent += t.amount; }
    const next = spent + pe.pay;
    budget = {limit:b.amount, spent, after:next, over:Math.max(0, next - b.amount), month:key};
  }
  const need = goals.reduce((s, g) => s + (goalPlan(g, prep.today).monthly || 0), 0);
  const goalsHit = need > 0 && (meses ? m.margin >= need && marginAfter < need : m.margin > 0 && p.amount > m.margin);

  // Alternativas: solo cuando la respuesta no es un «sí» limpio.
  const alt = {maxSafe:Math.max(0, base.min.balance - prep.cushion), waitDate:null, months:null, contado:false};
  if (verdict !== 'si'){
    if (meses) alt.contado = judge(prep, {...p, mode:'contado'}, base, m).verdict === 'si';
    const long = project(prep, 90), suffix = new Array(long.days.length); let mn = Infinity;
    for (let i = long.days.length - 1; i >= 0; i--){ mn = Math.min(mn, long.days[i].balance); suffix[i] = mn; }
    const d0 = dayDiff(prep.today, pe.date);
    if (!alt.contado) for (let i = d0 + 1; i <= 60; i++){ if (suffix[i] - p.amount >= prep.cushion){ alt.waitDate = long.days[i].date; break; } }
    if (!(p.rate > 0)){
      for (const n of [3, 6, 9, 12, 18, 24]){
        if (n <= pe.months) continue;
        if (judge(prep, {...p, mode:'meses', months:n, rate:0}, base, m).verdict === 'si'){ alt.months = {n, pay:installment(p.amount, n)}; break; }
      }
    }
  }
  return {
    verdict, reason, purchase:{...p, category, date:pe.date, months:pe.months, pay:pe.pay, total:pe.total, interest:pe.total - p.amount}, events:pe.events,
    base, scenario:sc, worst:sc.min, first:first ? {date:first.date, balance:first.balance} : null,
    rows:{now:{date:pe.date, base:at(base, dayDiff(prep.today, pe.date)), sim:at(sc, dayDiff(prep.today, pe.date))}, d30:{base:at(base, 30), sim:at(sc, 30)}, d60:{base:at(base, 60), sim:at(sc, 60)}},
    monthly:m, marginAfter, debts:{before, after}, committed, budget, goals:{need, hit:goalsHit}, alt,
    daysOfSpend:prep.vd.daily ? p.amount / prep.vd.daily : null, confidence:prep.vd.confidence, hasIncome:m.income > 0
  };
}
