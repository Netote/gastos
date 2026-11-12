/*
 * Reporte semanal: hechos de una semana cerrada (lunes a domingo), calculados al vuelo con los datos que ya existen.
 * No guarda nada: cualquier semana anterior se puede recalcular. Lógica pura; los textos los arma la interfaz.
 */
import {sums, byCategory, balanceNow, daysIn, parseKey, goalPlan, merchantKey} from './util.js';
import {addDays, dayDiff, monday, prepare, project, shortfalls, clusters, debts} from './forecast.js';

/** Lunes de la última semana completa. */
export const lastClosedWeek = today => addDays(monday(today), -7);

export function weeklyReport({opening = 0, tx = [], rules = [], budgets = [], goals = [], today}, ws){
  const we = addDays(ws, 6), pws = addDays(ws, -7), d90 = addDays(ws, -90);
  const cur = [], prev = [], hist = []; let first = null;
  for (const t of tx){
    if (!first || t.date < first) first = t.date;
    if (t.date >= ws && t.date <= we) cur.push(t);
    else if (t.date >= pws && t.date < ws) prev.push(t);
    if (t.date >= d90 && t.date < ws) hist.push(t);
  }
  const totals = sums(cur), prevTotals = sums(prev);

  // Promedio de las semanas completas anteriores (hasta 4) de las que hay historial.
  const weeks = first ? Math.max(0, Math.min(4, Math.floor(dayDiff(first, ws) / 7))) : 0;
  const avgFrom = addDays(ws, -7 * weeks), base = hist.filter(t => t.date >= avgFrom);
  const baseTot = sums(base), baseCat = byCategory(base);
  const avg = weeks ? {exp:Math.round(baseTot.exp / weeks), inc:Math.round(baseTot.inc / weeks)} : null;

  const cats = Object.entries(byCategory(cur)).map(([id, amount]) => ({id, amount, avg:weeks ? Math.round((baseCat[id] || 0) / weeks) : null}))
    .sort((a, b) => b.amount - a.amount);
  const growth = cats.filter(c => c.avg != null && c.amount - c.avg > 0 && c.amount >= c.avg * 1.25).sort((a, b) => (b.amount - b.avg) - (a.amount - a.avg))[0] || null;

  const expenses = cur.filter(t => t.type === 'expense');
  const biggest = [...expenses].sort((a, b) => b.amount - a.amount).slice(0, 3);
  const mer = new Map();
  for (const t of expenses){
    const k = merchantKey(t.merchant || t.description || ''); if (!k) continue;
    const m = mer.get(k) || {name:t.merchant || t.description, count:0, total:0}; m.count++; m.total += t.amount; mer.set(k, m);
  }
  const merchants = [...mer.values()].filter(m => m.count >= 2).sort((a, b) => b.count - a.count || b.total - a.total).slice(0, 3);

  const days = Array.from({length:7}, (_, i) => ({date:addDays(ws, i), exp:0}));
  for (const t of expenses) days[dayDiff(ws, t.date)].exp += t.amount;
  const topDay = days.reduce((a, b) => b.exp > a.exp ? b : a, days[0]);
  const noSpend = days.filter(d => d.date <= today && !d.exp).length;

  // Gastos inusuales: más del doble de lo normal en su categoría, o un comercio nuevo con monto alto.
  const stat = {}, seen = new Set(); let hn = 0, hs = 0;
  for (const t of hist){
    if (t.type !== 'expense' || t.recurring_id) continue;
    const s = stat[t.category] || (stat[t.category] = {n:0, sum:0}); s.n++; s.sum += t.amount; hn++; hs += t.amount;
    const k = merchantKey(t.merchant || t.description || ''); if (k) seen.add(k);
  }
  const unusual = [];
  for (const t of expenses){
    if (t.recurring_id) continue;
    const s = stat[t.category], k = merchantKey(t.merchant || t.description || '');
    if (s && s.n >= 3 && t.amount > 2 * s.sum / s.n) unusual.push({tx:t, kind:'alto', avg:Math.round(s.sum / s.n), times:t.amount / (s.sum / s.n)});
    else if (hn >= 5 && k && !seen.has(k) && t.amount > 2 * hs / hn) unusual.push({tx:t, kind:'nuevo', avg:Math.round(hs / hn), times:t.amount / (hs / hn)});
  }
  unusual.sort((a, b) => b.times - a.times); unusual.length = Math.min(unusual.length, 3);

  const fixedPaid = cur.filter(t => t.recurring_id && t.type === 'expense');

  // Lo que viene: solo tiene sentido para la semana más reciente (se calcula desde hoy).
  let forward = null;
  if (ws >= lastClosedWeek(today)){
    const fc = project(prepare({opening, tx, rules, today}), 30), lim7 = addDays(today, 7), lim14 = addDays(today, 14);
    const next = []; fc.days.forEach(d => { if (d.date <= lim7) d.events.forEach(e => next.push(e)); });
    const sf = shortfalls(fc);
    forward = {next, shortfall:sf.negative[0] || null, low:sf.low[0] || null, clusters:clusters(fc).filter(c => c.from <= lim14), balance:fc.start, in7:fc.days[7].balance};
  }

  // Presupuestos del mes en que termina la semana, medidos contra el avance del mes.
  const key = we.slice(0, 7), {y, m} = parseKey(key), dim = daysIn(y, m), day = Number(we.slice(8, 10));
  const spentBy = byCategory(tx.filter(t => t.date.slice(0, 7) === key && t.date <= we));
  const buds = budgets.filter(b => b.amount > 0).map(b => {
    const spent = spentBy[b.id] || 0, pct = spent / b.amount, pace = day / dim;
    return {id:b.id, limit:b.amount, spent, pct, pace, status:spent > b.amount ? 'over' : pct >= .8 && pct < 1 && pct - pace > .15 ? 'riesgo' : 'ok'};
  }).sort((a, b) => b.pct - a.pct);

  const goalList = goals.map(g => ({id:g.id, name:g.name, saved:g.saved, target:g.target, pct:Math.min(1, g.saved / g.target), plan:goalPlan(g, today)}));
  const debt = debts(rules, today);
  const review = tx.filter(t => t.review).length;

  // Lo más importante, de lo más grave a lo más leve.
  const hl = [];
  if (forward && forward.shortfall) hl.push({kind:'faltante', level:'bad', ...forward.shortfall});
  const over = buds.filter(b => b.status === 'over');
  if (over.length) hl.push({kind:'presupuesto', level:'bad', items:over});
  if (unusual.length) hl.push({...unusual[0], kind:'inusual', sub:unusual[0].kind, level:'warn'});
  if (avg && avg.exp > 0 && totals.exp > avg.exp * 1.25) hl.push({kind:'arriba', level:'warn', pct:totals.exp / avg.exp - 1, exp:totals.exp, avg:avg.exp});
  if (forward){ const c = forward.clusters.find(x => x.share >= .4); if (c && !forward.shortfall) hl.push({kind:'coincidencia', level:'warn', ...c}); }
  const risk = buds.filter(b => b.status === 'riesgo');
  if (risk.length && !over.length) hl.push({kind:'presupuesto-riesgo', level:'warn', items:risk});
  if (avg && avg.exp > 0 && totals.exp < avg.exp * .8) hl.push({kind:'abajo', level:'good', pct:1 - totals.exp / avg.exp, exp:totals.exp, avg:avg.exp});
  const ending = debt.list.find(d => d.remaining === 1 && dayDiff(today, d.end) <= 35);
  if (ending) hl.push({kind:'deuda-termina', level:'good', ...ending});
  if (!hl.length) hl.push({kind:'normal', level:'', net:totals.net, exp:totals.exp});

  return {ws, we, empty:!cur.length && !prev.length, count:cur.length, totals, prev:prevTotals, avg, weeks,
    balStart:balanceNow(opening, tx, addDays(ws, -1)), balEnd:balanceNow(opening, tx, we < today ? we : today),
    cats, growth, biggest, merchants, days, topDay:topDay.exp ? topDay : null, noSpend, unusual, fixedPaid, forward,
    budgets:buds, goals:goalList, debts:debt, review, highlights:hl.slice(0, 3)};
}
