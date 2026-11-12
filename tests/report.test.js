// Ejecutar con: npm test
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {weeklyReport, lastClosedWeek} from '../js/report.js';

let n = 0;
const tx = (date, amount, o = {}) => Object.assign({id:'t' + (n++), type:'expense', category:'alimentacion', amount, date, description:'Súper', recurring_id:null}, o);
const TODAY = '2026-11-11'; // miércoles; la última semana cerrada es del lunes 2 al domingo 8

test('lastClosedWeek devuelve el lunes de la semana anterior, también al cambiar de año', () => {
  assert.equal(lastClosedWeek(TODAY), '2026-11-02');
  assert.equal(lastClosedWeek('2026-11-09'), '2026-11-02'); // en lunes, la semana recién cerrada
  assert.equal(lastClosedWeek('2027-01-03'), '2026-12-21'); // domingo 3 ene: su semana aún no cierra
  assert.equal(lastClosedWeek('2027-01-04'), '2026-12-28');
});

test('semana sin datos', () => {
  const r = weeklyReport({today:TODAY}, '2026-11-02');
  assert.equal(r.empty, true); assert.equal(r.avg, null);
  assert.deepEqual(r.highlights.map(h => h.kind), ['normal']);
});

test('totales, comparación con semanas previas, categorías y días', () => {
  const data = [
    // cuatro semanas previas: 1,000 por semana en alimentación
    tx('2026-10-06', 100000), tx('2026-10-13', 100000), tx('2026-10-20', 100000), tx('2026-10-27', 100000),
    tx('2026-09-01', 50000),
    // semana del reporte
    tx('2026-11-02', 150000), tx('2026-11-04', 60000, {category:'ocio', description:'Cine'}), tx('2026-11-04', 40000, {description:'Súper'}),
    tx('2026-11-08', 1350000, {type:'income', category:'salario', description:'Quincena'}),
    tx('2026-11-10', 999999) // fuera de la semana
  ];
  const r = weeklyReport({opening:1000000, tx:data, today:TODAY}, '2026-11-02');
  assert.deepEqual([r.ws, r.we, r.count, r.empty], ['2026-11-02', '2026-11-08', 4, false]);
  assert.deepEqual(r.totals, {inc:1350000, exp:250000, net:1100000});
  assert.equal(r.prev.exp, 100000);
  assert.deepEqual([r.weeks, r.avg.exp], [4, 100000]);
  assert.deepEqual(r.cats.map(c => [c.id, c.amount, c.avg]), [['alimentacion', 190000, 100000], ['ocio', 60000, 0]]);
  assert.equal(r.growth.id, 'alimentacion');
  assert.deepEqual([r.topDay.date, r.topDay.exp, r.noSpend], ['2026-11-02', 150000, 5]);
  assert.equal(r.biggest[0].amount, 150000);
  assert.deepEqual(r.merchants.map(m => [m.name, m.count, m.total]), [['Súper', 2, 190000]]);
  assert.equal(r.balStart, 1000000 - 450000);
  assert.equal(r.balEnd, r.balStart + 1100000);
  assert.ok(r.highlights.some(h => h.kind === 'arriba' && Math.abs(h.pct - 1.5) < 1e-9));
});

test('gastos inusuales, presupuestos y deuda que termina', () => {
  const data = [tx('2026-09-10', 20000), tx('2026-09-20', 30000), tx('2026-10-05', 25000), tx('2026-10-15', 25000), tx('2026-10-25', 25000),
    tx('2026-11-03', 90000, {description:'Cena de aniversario'}), tx('2026-11-05', 20000)];
  const rules = [{id:'m', name:'Laptop', type:'expense', category:'compras', amount:100000, day:20, start_month:'2025-12-01', occurrences:12, active:true}];
  const r = weeklyReport({opening:5000000, tx:data, rules, budgets:[{id:'alimentacion', amount:100000}, {id:'ocio', amount:50000}], today:TODAY}, '2026-11-02');
  assert.equal(r.unusual.length, 1);
  assert.deepEqual([r.unusual[0].tx.description, r.unusual[0].kind, r.unusual[0].avg], ['Cena de aniversario', 'alto', 25000]);
  assert.deepEqual(r.budgets.map(b => [b.id, b.spent, b.status]), [['alimentacion', 110000, 'over'], ['ocio', 0, 'ok']]);
  assert.deepEqual([r.debts.list[0].remaining, r.debts.total], [1, 100000]);
  assert.deepEqual(r.highlights.map(h => h.kind), ['presupuesto', 'inusual', 'arriba']);
  assert.ok(r.forward.next.some(e => e.name === 'Laptop') === false); // el pago del 20 no cae en los próximos 7 días
});

test('lo que viene solo se calcula para la semana más reciente y detecta faltantes', () => {
  const rules = [{id:'r', name:'Renta', type:'expense', category:'vivienda', amount:900000, day:15, start_month:'2026-01-01', occurrences:null, active:true}];
  const data = [tx('2026-11-03', 10000)];
  const now = weeklyReport({opening:500000, tx:data, rules, today:TODAY}, '2026-11-02');
  assert.equal(now.forward.next[0].name, 'Renta');
  assert.equal(now.highlights[0].kind, 'faltante');
  assert.equal(now.highlights[0].from, '2026-11-15');
  const old = weeklyReport({opening:500000, tx:data, rules, today:TODAY}, '2026-10-19');
  assert.equal(old.forward, null);
});
