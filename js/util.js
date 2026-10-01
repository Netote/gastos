/* Utilidades puras: sin DOM, para poder probarlas con `node --test`. */

export const pad = n => String(n).padStart(2, '0');
export const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
export const uid = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

/* ---------- Fechas (cadenas YYYY-MM-DD, sin zonas horarias) ---------- */
export const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
export const MSHORT = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
export const DAYS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
/** Clave de mes 'YYYY-MM' a partir de año y mes 0-11. */
export const mk = (y, m) => y + '-' + pad(m + 1);
export const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
export function todayParts(now = new Date()){ return {y:now.getFullYear(), m:now.getMonth(), d:now.getDate()}; }
export function todayStr(now = new Date()){ const t = todayParts(now); return t.y + '-' + pad(t.m + 1) + '-' + pad(t.d); }
export function parseKey(key){ const [y, m] = key.split('-').map(Number); return {y, m:m - 1}; }
export function addMonths(key, n){ const {y, m} = parseKey(key); const t = y * 12 + m + n; return mk(Math.floor(t / 12), ((t % 12) + 12) % 12); }
export function monthDiff(a, b){ const A = parseKey(a), B = parseKey(b); return (B.y - A.y) * 12 + (B.m - A.m); }
export function fmtDate(s){ const [y, m, d] = s.split('-').map(Number); return d + ' ' + MSHORT[m - 1] + ' ' + y; }
export function fmtDay(s, today){
  if (s === today) return 'Hoy';
  const [y, m, d] = s.split('-').map(Number), dt = new Date(y, m - 1, d);
  const [ty, tm, td] = today.split('-').map(Number);
  if ((new Date(ty, tm - 1, td) - dt) / 864e5 === 1) return 'Ayer';
  return cap(DAYS[dt.getDay()]) + ' ' + d + ' de ' + MONTHS[m - 1] + (y !== ty ? ' de ' + y : '');
}
export const monthLabel = key => { const {y, m} = parseKey(key); return cap(MONTHS[m]) + ' ' + y; };

/* ---------- Montos (siempre en centavos enteros) ---------- */
/** Interpreta "1,250.50", "1250,5", "$ 300" → número; NaN si no es válido. */
export function parseAmount(str){
  let s = String(str).trim().replace(/\s/g, '').replace(/^\$/, '');
  if (!s) return NaN;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return NaN;
  const n = Number(s); return Number.isFinite(n) ? n : NaN;
}
export const toCents = n => Math.round(n * 100);
export const centsToInput = c => c ? (c / 100).toFixed(2).replace(/\.00$/, '') : '';

/* ---------- Categorías ---------- */
// group: 'need' (necesidades), 'want' (deseos) para la regla 50/30/20.
export const CATS = [
  {id:'vivienda', name:'Vivienda', type:'expense', color:'#3B82F6', icon:'home', group:'need'},
  {id:'alimentacion', name:'Alimentación', type:'expense', color:'#F59E0B', icon:'utensils', group:'need'},
  {id:'transporte', name:'Transporte', type:'expense', color:'#8B5CF6', icon:'car', group:'need'},
  {id:'servicios', name:'Servicios', type:'expense', color:'#06B6D4', icon:'zap', group:'need'},
  {id:'salud', name:'Salud', type:'expense', color:'#EC4899', icon:'heart', group:'need'},
  {id:'educacion', name:'Educación', type:'expense', color:'#84CC16', icon:'cap', group:'need'},
  {id:'deudas', name:'Deudas y créditos', type:'expense', color:'#EF4444', icon:'card', group:'need'},
  {id:'ocio', name:'Ocio', type:'expense', color:'#F97316', icon:'game', group:'want'},
  {id:'compras', name:'Compras', type:'expense', color:'#14B8A6', icon:'bag', group:'want'},
  {id:'suscripciones', name:'Suscripciones', type:'expense', color:'#A855F7', icon:'repeat', group:'want'},
  {id:'otros-gasto', name:'Otros gastos', type:'expense', color:'#94A3B8', icon:'more', group:'want'},
  {id:'salario', name:'Salario', type:'income', color:'#10B981', icon:'briefcase'},
  {id:'freelance', name:'Freelance', type:'income', color:'#38BDF8', icon:'laptop'},
  {id:'inversiones', name:'Inversiones', type:'income', color:'#A3E635', icon:'up'},
  {id:'otros-ingreso', name:'Otros ingresos', type:'income', color:'#94A3B8', icon:'more'}
];
export const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));
export const EXP = CATS.filter(c => c.type === 'expense');
export const INC = CATS.filter(c => c.type === 'income');
export const catOf = id => CAT[id] || {id, name:id, type:'expense', color:'#94A3B8', icon:'more', group:'want'};

/* ---------- Cálculos ---------- */
export function sums(list){ let inc = 0, exp = 0; for (const t of list){ if (t.type === 'income') inc += t.amount; else exp += t.amount; } return {inc, exp, net:inc - exp}; }
export function byCategory(list, type = 'expense'){ const o = {}; for (const t of list){ if (t.type === type) o[t.category] = (o[t.category] || 0) + t.amount; } return o; }

/** Fecha de cobro de una regla recurrente en un mes dado (día ajustado al último día del mes). */
export function dueDate(rule, key){ const {y, m} = parseKey(key); return key + '-' + pad(Math.min(rule.day, daysIn(y, m))); }
/** Id determinista del movimiento generado por una regla: evita duplicados entre dispositivos. */
export const recTxId = (ruleId, key) => 'r_' + ruleId + '_' + key.replace('-', '');

/**
 * Movimientos que una regla recurrente debió generar hasta hoy y aún no existen.
 * `exists(id)` debe devolver true también para movimientos borrados, para no resucitarlos.
 */
export function pendingRecurring(rules, exists, today){
  const out = [], cur = today.slice(0, 7);
  for (const r of rules){
    if (!r.active || r.deleted) continue;
    const start = r.start_month.slice(0, 7);
    const span = Math.min(monthDiff(start, cur), 120);
    for (let i = 0; i <= span; i++){
      if (r.occurrences && i >= r.occurrences) break;
      const key = addMonths(start, i), date = dueDate(r, key), id = recTxId(r.id, key);
      if (date > today || exists(id)) continue;
      out.push({id, type:r.type, category:r.category, amount:r.amount, date, description:r.name, recurring_id:r.id});
    }
  }
  return out;
}

/** Próxima fecha de cobro (>= hoy) de una regla, o null si ya terminó. */
export function nextDue(rule, today){
  const cur = today.slice(0, 7), start = rule.start_month.slice(0, 7);
  for (let i = Math.max(0, monthDiff(start, cur)); i < Math.max(0, monthDiff(start, cur)) + 2; i++){
    if (rule.occurrences && i >= rule.occurrences) return null;
    const d = dueDate(rule, addMonths(start, i));
    if (d >= today) return {date:d, index:i + 1};
  }
  return null;
}

/** Proyección de gasto al cierre del mes: fijos del mes + ritmo diario de gastos variables. */
export function projectMonth(monthList, rules, key, today){
  const {y, m} = parseKey(key), dim = daysIn(y, m), day = Number(today.slice(8, 10));
  let variable = 0, fixedDone = 0;
  for (const t of monthList){ if (t.type !== 'expense') continue; if (t.recurring_id) fixedDone += t.amount; else variable += t.amount; }
  let fixedPending = 0;
  for (const r of rules){
    if (!r.active || r.deleted || r.type !== 'expense') continue;
    const idx = monthDiff(r.start_month.slice(0, 7), key);
    if (idx < 0 || (r.occurrences && idx >= r.occurrences)) continue;
    if (dueDate(r, key) > today) fixedPending += r.amount;
  }
  const spent = variable + fixedDone;
  const projected = Math.round(variable / day * dim) + fixedDone + fixedPending;
  return {spent, projected, fixedPending, day, dim};
}

/** Distribución 50/30/20 sobre los ingresos del mes. */
export function rule503020(monthList){
  const s = sums(monthList); let need = 0, want = 0;
  for (const t of monthList){ if (t.type === 'expense'){ if (catOf(t.category).group === 'need') need += t.amount; else want += t.amount; } }
  return {inc:s.inc, need, want, save:s.inc - need - want};
}

/** Meses de gasto cubiertos por el saldo acumulado (promedio de los 3 meses completos previos). */
export function emergencyMonths(allTx, curKey){
  const keys = [1, 2, 3].map(i => addMonths(curKey, -i)), set = new Set(keys);
  let exp = 0, months = new Set();
  for (const t of allTx){ const k = t.date.slice(0, 7); if (t.type === 'expense' && set.has(k)){ exp += t.amount; months.add(k); } }
  if (!months.size) return null;
  const avg = exp / months.size, balance = sums(allTx).net;
  return {avg:Math.round(avg), balance, months:avg > 0 ? balance / avg : null};
}

/** Monto mensual sugerido para alcanzar una meta antes de su fecha límite. */
export function goalPlan(goal, today){
  const left = Math.max(0, goal.target - goal.saved);
  if (!goal.deadline || left === 0) return {left, monthly:null, months:null, late:false};
  const months = monthDiff(today.slice(0, 7), goal.deadline.slice(0, 7)) + (goal.deadline >= today ? 1 : 0);
  if (months <= 0) return {left, monthly:null, months:0, late:true};
  return {left, monthly:Math.ceil(left / months), months, late:false};
}

/* ---------- CSV ---------- */
export const csvCell = v => { v = String(v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

/** Valida un movimiento proveniente de un respaldo; devuelve el registro limpio o null. */
export function cleanTx(t){
  if (!t || typeof t !== 'object') return null;
  const desc = t.description != null ? t.description : t.desc;
  const ok = (t.type === 'income' || t.type === 'expense') && CAT[t.category] && CAT[t.category].type === t.type &&
    typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && Number.isInteger(t.amount) && t.amount > 0 && t.amount <= 99999999999;
  if (!ok) return null;
  const id = typeof t.id === 'string' && /^[\w-]{1,64}$/.test(t.id) ? t.id : uid();
  return {id, type:t.type, category:t.category, date:t.date, amount:t.amount, description:String(desc || '').slice(0, 120),
    recurring_id:typeof t.recurring_id === 'string' && /^[\w-]{1,64}$/.test(t.recurring_id) ? t.recurring_id : null};
}
