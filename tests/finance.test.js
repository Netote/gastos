// Ejecutar con: npm test
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../js/util.js';
import {monthlyLimits, monthlyForTarget, antSpending, debtBalance, debtList, payoffPlan} from '../js/finance.js';

const tx = (id, date, category, amount, extra = {}) => ({id, type:'expense', date, category, amount, ...extra});

/* ---------- Apartados propios ---------- */
test('setCustomCats agrega apartados sin romper las categorías base', () => {
  const before = U.EXP.length;
  U.setCustomCats([{id:'c-cafe', name:'Café', color:'#F59E0B', icon:'coffee', kind:'limite'}, {id:'c-viejo', name:'Viejo', deleted:true}]);
  assert.equal(U.EXP.length, before + 1);
  assert.equal(U.EXP[U.EXP.length - 1].id, 'otros-gasto', '«Otros gastos» sigue al final');
  assert.equal(U.catOf('c-cafe').name, 'Café');
  assert.equal(U.catOf('c-viejo').name, 'Viejo (eliminado)', 'los borrados conservan nombre para sus movimientos');
  assert.ok(!U.EXP.some(c => c.id === 'c-viejo'));
  assert.ok(U.CAT.salario, 'los ingresos siguen');
  U.setCustomCats([]);
  assert.equal(U.EXP.length, before);
  assert.equal(U.catOf('c-cafe').name, 'Sin categoría');
});

test('monthlyLimits: límite del mes con dinero movido entre categorías', () => {
  const budgets = [{id:'ocio', amount:100000}, {id:'compras', amount:200000}];
  const moves = [{id:'m1', month:'2026-11', from_cat:'compras', to_cat:'ocio', amount:30000}, {id:'m2', month:'2026-10', from_cat:'compras', to_cat:'ocio', amount:99999}];
  const t = [tx('a', '2026-11-03', 'ocio', 120000), tx('b', '2026-10-20', 'ocio', 50000), tx('c', '2026-11-05', 'compras', 10000)];
  const L = monthlyLimits('2026-11', {budgets, moves, tx:t});
  assert.equal(L.ocio.limit, 130000, 'solo cuentan los movimientos de este mes');
  assert.equal(L.ocio.spent, 120000);
  assert.equal(L.ocio.left, 10000);
  assert.equal(L.compras.limit, 170000);
  assert.equal(L.compras.left, 160000);
});

test('monthlyLimits: un apartado que acumula guarda lo que no se gasta', () => {
  const budgets = [{id:'c-predial', amount:50000}];
  const cats = {'c-predial':{kind:'acumula', target:300000, due:'2027-01-31', start_month:'2026-09-01'}};
  const t = [tx('a', '2026-08-30', 'c-predial', 99999), tx('b', '2026-10-10', 'c-predial', 20000)];
  const L = monthlyLimits('2026-11', {budgets, cats, tx:t});
  assert.equal(L['c-predial'].months, 3, 'septiembre, octubre y noviembre');
  assert.equal(L['c-predial'].saved, 150000);
  assert.equal(L['c-predial'].left, 130000, 'lo gastado antes de empezar no cuenta');
  assert.equal(L['c-predial'].target, 300000);
});

test('monthlyForTarget reparte el costo entre los meses que faltan', () => {
  assert.equal(monthlyForTarget(300000, '2026-11', '2027-01-31'), 100000);
  assert.equal(monthlyForTarget(100000, '2026-11', '2026-11-20'), 100000);
  assert.equal(monthlyForTarget(100000, '2026-11', '2026-01-20'), 100000, 'fecha pasada: todo en un mes');
  assert.equal(monthlyForTarget(0, '2026-11', '2027-01-01'), null);
});

/* ---------- Gastos hormiga ---------- */
test('antSpending agrupa compras chicas que se repiten', () => {
  const t = [
    tx('1', '2026-11-20', 'alimentacion', 6500, {description:'Café Punta del Cielo'}),
    tx('2', '2026-11-18', 'alimentacion', 7000, {description:'café punta del cielo'}),
    tx('3', '2026-11-10', 'alimentacion', 6500, {merchant:'CAFE PUNTA DEL CIELO 123'}),
    tx('4', '2026-11-11', 'alimentacion', 900000, {description:'Café Punta del Cielo'}),   // demasiado caro
    tx('5', '2026-10-01', 'alimentacion', 6500, {description:'Café Punta del Cielo'}),     // fuera de los 30 días
    tx('6', '2026-11-12', 'ocio', 3000), tx('7', '2026-11-13', 'ocio', 3000),                // solo dos: no es hábito
    tx('8', '2026-11-14', 'servicios', 9900, {description:'Netflix', recurring_id:'r1'}),    // fijo: no cuenta
    {id:'9', type:'income', date:'2026-11-15', category:'salario', amount:5000}
  ];
  const r = antSpending(t, '2026-11-24');
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].count, 3);
  assert.equal(r.groups[0].total, 20000);
  assert.equal(r.yearly, Math.round(20000 / 30 * 365));
});

/* ---------- Deudas ---------- */
test('debtBalance: sin intereses es pago × pagos; con intereses es el valor presente', () => {
  assert.equal(debtBalance(100000, 6, 0), 600000);
  const b = debtBalance(100000, 12, 36);
  assert.ok(b < 1200000 && b > 990000, 'saldo menor que la suma de pagos');
});

test('debtList toma los fijos con número de pagos que siguen activos', () => {
  const rules = [
    {id:'tv', name:'TV', type:'expense', amount:50000, day:10, start_month:'2026-06-01', occurrences:12, active:true},
    {id:'renta', name:'Renta', type:'expense', amount:800000, day:1, start_month:'2026-01-01', occurrences:null, active:true},
    {id:'fin', name:'Terminada', type:'expense', amount:1000, day:1, start_month:'2025-01-01', occurrences:3, active:true}
  ];
  const d = debtList(rules, '2026-11-24');
  assert.equal(d.length, 1);
  assert.equal(d[0].remaining, 6, 'de diciembre a mayo: 6 pagos');
  assert.equal(d[0].balance, 300000);
  assert.equal(d[0].end, '2027-05');
});

test('payoffPlan: avalancha ahorra intereses, bola de nieve termina antes la chica', () => {
  const debts = [
    {id:'chica', balance:300000, payment:50000, rate:10},
    {id:'cara', balance:1200000, payment:60000, rate:60}
  ];
  const min = payoffPlan(debts, 0, 'minimo'), av = payoffPlan(debts, 100000, 'avalancha'), bo = payoffPlan(debts, 100000, 'bola');
  assert.deepEqual(av.order, ['cara', 'chica']);
  assert.deepEqual(bo.order, ['chica', 'cara']);
  assert.ok(av.months < min.months && bo.months < min.months, 'pagar extra termina antes');
  assert.ok(av.interest <= bo.interest, 'avalancha paga menos intereses');
  assert.ok(bo.finish.chica < av.finish.chica, 'bola de nieve liquida antes la chica');
});

test('payoffPlan sin intereses: el mínimo termina en el número de pagos', () => {
  const r = payoffPlan([{id:'a', balance:600000, payment:100000, rate:0}], 0, 'minimo');
  assert.equal(r.months, 6);
  assert.equal(r.interest, 0);
});
