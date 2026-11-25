/*
 * Cálculos de la v2.7, puros (sin DOM) para probarlos con `node --test`:
 *   - límites del mes con apartados propios y dinero movido entre ellos,
 *   - detector de gastos hormiga,
 *   - plan para salir de deudas (avalancha contra bola de nieve).
 * Montos siempre en centavos enteros.
 */
import {addMonths, monthDiff, merchantKey, nextDue} from './util.js';

/* ====================================================================== Límites y apartados */
/**
 * Límite efectivo de cada categoría con presupuesto en el mes `month` ('YYYY-MM').
 *   kind 'limite'  → límite del mes + lo que le movieron − lo que se le quitó; se reinicia cada mes.
 *   kind 'acumula' → lo apartado desde start_month (monto × meses) ± movimientos − todo lo gastado desde entonces:
 *                    lo que no gastas pasa al mes siguiente.
 * `cats` son las definiciones de los apartados propios (id → {kind, target, due, start_month}).
 * Devuelve id → {id, kind, base, limit, spent, left, target, due, months, saved}.
 */
export function monthlyLimits(month, {budgets = [], cats = {}, moves = [], tx = []} = {}){
  const out = {};
  const ids = new Set(budgets.filter(b => b.amount > 0).map(b => b.id));
  if (!ids.size) return out;
  const spentIn = {}, spentAll = {};
  for (const t of tx){
    if (t.type !== 'expense' || !ids.has(t.category)) continue;
    const k = t.date.slice(0, 7);
    if (k === month) spentIn[t.category] = (spentIn[t.category] || 0) + t.amount;
    if (k <= month) (spentAll[t.category] ||= []).push(t);
  }
  for (const b of budgets){
    if (!(b.amount > 0)) continue;
    const def = cats[b.id] || {}, kind = def.kind === 'acumula' ? 'acumula' : 'limite';
    const spent = spentIn[b.id] || 0;
    if (kind === 'limite'){
      let delta = 0;
      for (const m of moves){ if (m.month !== month) continue; if (m.to_cat === b.id) delta += m.amount; if (m.from_cat === b.id) delta -= m.amount; }
      const limit = b.amount + delta;
      out[b.id] = {id:b.id, kind, base:b.amount, limit, spent, left:limit - spent, target:null, due:null, months:1, saved:null};
    } else {
      const start = (def.start_month || month).slice(0, 7);
      const months = Math.max(0, monthDiff(start, month) + 1);
      let delta = 0;
      for (const m of moves){ if (m.month < start || m.month > month) continue; if (m.to_cat === b.id) delta += m.amount; if (m.from_cat === b.id) delta -= m.amount; }
      const spentTotal = (spentAll[b.id] || []).filter(t => t.date.slice(0, 7) >= start).reduce((s, t) => s + t.amount, 0);
      const saved = b.amount * months + delta;
      out[b.id] = {id:b.id, kind, base:b.amount, limit:saved, spent, left:saved - spentTotal, target:def.target || null, due:def.due || null, months, saved};
    }
  }
  return out;
}

/** Cuánto apartar al mes para juntar `target` desde `start` ('YYYY-MM') hasta la fecha `due` ('YYYY-MM-DD'), incluyendo ambos meses. */
export function monthlyForTarget(target, start, due){
  if (!(target > 0) || !due) return null;
  const months = Math.max(1, monthDiff(start.slice(0, 7), due.slice(0, 7)) + 1);
  return Math.ceil(target / months);
}

/* ====================================================================== Gastos hormiga */
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };

/**
 * Compras chicas que se repiten (café, botanas, apps, propinas…) en los últimos `days` días hasta `today`.
 * Se agrupan por comercio o descripción normalizada (si no hay, por categoría). Los fijos no cuentan.
 * `max` es el monto máximo de una compra para considerarla «hormiga» (centavos).
 * Devuelve {groups:[{key, label, category, count, total}], total, count, yearly} con los grupos de mayor a menor gasto.
 */
export function antSpending(tx, today, {max = 20000, minCount = 3, days = 30} = {}){
  const from = addDays(today, -(days - 1)), map = new Map();
  for (const t of tx){
    if (t.type !== 'expense' || t.recurring_id || t.amount > max || t.date < from || t.date > today) continue;
    const name = (t.merchant || t.description || '').trim(), mk = merchantKey(name);
    const key = mk ? 'n:' + mk : 'c:' + t.category;
    let g = map.get(key);
    if (!g) map.set(key, g = {key, label:mk ? name : null, category:t.category, count:0, total:0});
    g.count++; g.total += t.amount;
  }
  const groups = [...map.values()].filter(g => g.count >= minCount).sort((a, b) => b.total - a.total || b.count - a.count);
  const total = groups.reduce((s, g) => s + g.total, 0), count = groups.reduce((s, g) => s + g.count, 0);
  return {groups, total, count, yearly:Math.round(total / days * 365)};
}

/* ====================================================================== Deudas */
/** Saldo pendiente de un crédito de pagos fijos: valor presente de los pagos que faltan (sin intereses = pago × pagos). */
export function debtBalance(payment, remaining, rate){
  const i = (Number(rate) || 0) / 1200;
  if (remaining <= 0) return 0;
  return i > 0 ? Math.round(payment * (1 - Math.pow(1 + i, -remaining)) / i) : payment * remaining;
}

/**
 * Deudas a plazo a partir de los fijos de gasto con número de pagos que siguen activos.
 * Devuelve [{id, name, payment, rate, remaining, of, balance, end}] con lo que falta por pagar desde hoy.
 */
export function debtList(rules, today){
  const out = [];
  for (const r of rules){
    if (r.deleted || !r.active || r.type !== 'expense' || !r.occurrences) continue;
    const n = nextDue(r, today); if (!n) continue;
    const remaining = r.occurrences - n.index + 1; if (remaining <= 0) continue;
    out.push({id:r.id, name:r.name, payment:r.amount, rate:Number(r.rate) || 0, remaining, of:r.occurrences,
      balance:debtBalance(r.amount, remaining, r.rate), end:addMonths(r.start_month.slice(0, 7), r.occurrences - 1)});
  }
  return out.sort((a, b) => a.balance - b.balance);
}

/**
 * Simula el pago de las deudas mes a mes.
 *   strategy 'avalancha'  → el dinero extra va primero a la de mayor tasa (ahorra más intereses).
 *   strategy 'bola'       → primero a la de menor saldo (se terminan antes y motiva).
 *   strategy 'minimo'     → cada una con su pago; lo que se libera no se reutiliza.
 * Con 'avalancha' y 'bola' el total al mes es constante: lo que pagabas de una deuda terminada se suma al extra.
 * Devuelve {months, interest, paid, order:[ids], finish:{id: mes 1..n}}.
 */
export function payoffPlan(debts, extra = 0, strategy = 'avalancha'){
  const list = debts.filter(d => d.balance > 0).map(d => ({id:d.id, bal:d.balance, pay:d.payment, i:(Number(d.rate) || 0) / 1200}));
  const order = strategy === 'avalancha' ? [...list].sort((a, b) => b.i - a.i || a.bal - b.bal) : [...list].sort((a, b) => a.bal - b.bal || b.i - a.i);
  const budget = list.reduce((s, d) => s + d.pay, 0) + (strategy === 'minimo' ? 0 : Math.max(0, Math.round(extra)));
  const finish = {}; let month = 0, interest = 0, paid = 0;
  while (list.some(d => d.bal > 0) && month < 600){
    month++;
    let pool = budget;
    for (const d of list){
      if (d.bal <= 0) continue;
      const int = Math.round(d.bal * d.i); d.bal += int; interest += int;
    }
    for (const d of list){
      if (d.bal <= 0) continue;
      const p = Math.min(d.pay, d.bal); d.bal -= p; paid += p; pool -= p;
    }
    if (strategy !== 'minimo'){
      for (const t of order){
        if (pool <= 0) break;
        const d = list.find(x => x.id === t.id); if (d.bal <= 0) continue;
        const p = Math.min(pool, d.bal); d.bal -= p; paid += p; pool -= p;
      }
    }
    for (const d of list) if (d.bal <= 0 && !finish[d.id]) finish[d.id] = month;
  }
  return {months:month, interest, paid, order:order.map(d => d.id), finish};
}
