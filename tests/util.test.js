// Ejecutar con: npm test
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../js/util.js';

test('parseAmount acepta formatos comunes y rechaza basura', () => {
  assert.equal(U.parseAmount('1,250.50'), 1250.5);
  assert.equal(U.parseAmount('1250,5'), 1250.5);
  assert.equal(U.parseAmount('$ 300'), 300);
  assert.equal(U.parseAmount('.5'), .5);
  assert.ok(Number.isNaN(U.parseAmount('')));
  assert.ok(Number.isNaN(U.parseAmount('12a')));
  assert.ok(Number.isNaN(U.parseAmount('1.2.3')));
  assert.equal(U.toCents(0.1 + 0.2), 30);
});

test('esc neutraliza HTML', () => {
  assert.equal(U.esc('"><img src=x onerror=alert(1)>'), '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
});

test('aritmética de meses', () => {
  assert.equal(U.addMonths('2026-01', -1), '2025-12');
  assert.equal(U.addMonths('2026-11', 3), '2027-02');
  assert.equal(U.monthDiff('2025-11', '2026-02'), 3);
  assert.equal(U.dueDate({day:31}, '2026-02'), '2026-02-28');
  assert.equal(U.dueDate({day:31}, '2028-02'), '2028-02-29');
});

test('fmtDay usa Hoy y Ayer', () => {
  assert.equal(U.fmtDay('2026-09-30', '2026-09-30'), 'Hoy');
  assert.equal(U.fmtDay('2026-09-29', '2026-09-30'), 'Ayer');
  assert.equal(U.fmtDay('2026-03-01', '2026-03-02'), 'Ayer');
  assert.equal(U.fmtDay('2026-09-01', '2026-09-30'), 'Martes 1 de septiembre');
});

const rule = (o = {}) => Object.assign({id:'r1', name:'Renta', type:'expense', category:'vivienda', amount:850000, day:1, start_month:'2026-07-01', occurrences:null, active:true}, o);

test('pendingRecurring genera los meses vencidos con ids deterministas', () => {
  const out = U.pendingRecurring([rule()], () => false, '2026-09-30');
  assert.deepEqual(out.map(t => t.date), ['2026-07-01', '2026-08-01', '2026-09-01']);
  assert.equal(out[0].id, 'r_r1_202607');
  assert.equal(out[0].recurring_id, 'r1');
});

test('pendingRecurring respeta lo existente (incluso borrado), pausas, fin y fechas futuras', () => {
  const seen = new Set(['r_r1_202607']);
  assert.deepEqual(U.pendingRecurring([rule()], id => seen.has(id), '2026-09-30').map(t => t.id), ['r_r1_202608', 'r_r1_202609']);
  assert.equal(U.pendingRecurring([rule({active:false})], () => false, '2026-09-30').length, 0);
  assert.equal(U.pendingRecurring([rule({occurrences:2})], () => false, '2026-12-31').length, 2);
  assert.equal(U.pendingRecurring([rule({day:15})], () => false, '2026-07-14').length, 0);
  assert.equal(U.pendingRecurring([rule({start_month:'2026-10-01'})], () => false, '2026-09-30').length, 0);
});

test('nextDue encuentra el siguiente cobro o null si terminó', () => {
  assert.deepEqual(U.nextDue(rule({day:15}), '2026-09-10'), {date:'2026-09-15', index:3});
  assert.deepEqual(U.nextDue(rule({day:5}), '2026-09-10'), {date:'2026-10-05', index:4});
  assert.equal(U.nextDue(rule({occurrences:3, day:5}), '2026-09-10'), null);
  assert.deepEqual(U.nextDue(rule({start_month:'2026-12-01', day:5}), '2026-09-10'), {date:'2026-12-05', index:1});
});

test('projectMonth separa fijos de variables', () => {
  const list = [
    {type:'expense', amount:850000, recurring_id:'r1', date:'2026-09-01'},
    {type:'expense', amount:100000, recurring_id:null, date:'2026-09-05'},
    {type:'income', amount:2700000, recurring_id:null, date:'2026-09-15'}
  ];
  const p = U.projectMonth(list, [rule(), rule({id:'r2', day:20, amount:50000})], '2026-09', '2026-09-10');
  assert.equal(p.spent, 950000);
  assert.equal(p.fixedPending, 50000);
  assert.equal(p.projected, 300000 + 850000 + 50000); // 1000/día variable × 30 días + fijos
});

test('regla 50/30/20 y fondo de emergencia', () => {
  const list = [
    {type:'income', amount:1000, category:'salario', date:'2026-09-01'},
    {type:'expense', amount:500, category:'vivienda', date:'2026-09-01'},
    {type:'expense', amount:200, category:'ocio', date:'2026-09-01'}
  ];
  assert.deepEqual(U.rule503020(list), {inc:1000, need:500, want:200, save:300});
  const hist = [
    {type:'income', amount:9000, date:'2026-06-01'}, {type:'expense', amount:1000, date:'2026-06-02'},
    {type:'expense', amount:2000, date:'2026-07-02'}, {type:'expense', amount:3000, date:'2026-08-02'}
  ];
  const e = U.emergencyMonths(hist, '2026-09');
  assert.equal(e.avg, 2000); assert.equal(e.balance, 3000); assert.equal(e.months, 1.5);
  assert.equal(U.emergencyMonths([], '2026-09'), null);
});

test('goalPlan calcula el ahorro mensual', () => {
  assert.deepEqual(U.goalPlan({target:120000, saved:20000, deadline:'2026-12-31'}, '2026-09-15'), {left:100000, monthly:25000, months:4, late:false});
  assert.equal(U.goalPlan({target:100, saved:100, deadline:'2026-12-31'}, '2026-09-15').left, 0);
  assert.equal(U.goalPlan({target:100, saved:0, deadline:'2026-08-31'}, '2026-09-15').late, true);
  assert.equal(U.goalPlan({target:100, saved:0, deadline:null}, '2026-09-15').monthly, null);
});

test('csvCell escapa fórmulas y comillas', () => {
  assert.equal(U.csvCell('=1+1'), "'=1+1");
  assert.equal(U.csvCell('a,"b"'), '"a,""b"""');
});

test('cleanTx valida respaldos y rechaza ids peligrosos', () => {
  const ok = U.cleanTx({id:'abc-1', type:'expense', category:'ocio', date:'2026-09-01', amount:100, desc:'Cine'});
  assert.equal(ok.description, 'Cine'); assert.equal(ok.id, 'abc-1');
  const evil = U.cleanTx({id:'x" onmouseover="alert(1)', type:'expense', category:'ocio', date:'2026-09-01', amount:100});
  assert.notEqual(evil.id, 'x" onmouseover="alert(1)');
  assert.equal(U.cleanTx({type:'income', category:'ocio', date:'2026-09-01', amount:100}), null); // categoría de otro tipo
  assert.equal(U.cleanTx({type:'expense', category:'ocio', date:'2026-09-01', amount:1.5}), null);
});

test('merchantKey ignora acentos, signos y números sueltos', () => {
  assert.equal(U.merchantKey('OXXO 1234 CDMX'), 'oxxo cdmx');
  assert.equal(U.merchantKey('  Café  Ñandú #12 '), 'cafe nandu');
  assert.equal(U.merchantKey('7-Eleven MX01'), 'eleven mx01'); // "mx01" mezcla letras y números: se conserva
  assert.equal(U.merchantKey('12345'), '');
  assert.equal(U.merchantKey(''), '');
});

test('byCard suma gastos por tarjeta y omite los que no tienen', () => {
  const list = [
    {type:'expense', amount:500, card:'BBVA'}, {type:'expense', amount:1500, card:'Nu'}, {type:'expense', amount:700, card:'BBVA'},
    {type:'expense', amount:900}, {type:'income', amount:9000, card:'BBVA'}
  ];
  assert.deepEqual(U.byCard(list), [['BBVA', 1200], ['Nu', 1500]].sort((a, b) => b[1] - a[1]));
  assert.deepEqual(U.byCard([]), []);
});

test('cleanTx conserva tarjeta y comercio, y recorta longitudes', () => {
  const t = U.cleanTx({type:'expense', category:'ocio', date:'2026-09-01', amount:100, card:'  Nu  ', merchant:'x'.repeat(100), source:'wallet', review:true});
  assert.equal(t.card, 'Nu'); assert.equal(t.merchant.length, 60); assert.equal(t.source, 'wallet'); assert.equal(t.review, true);
  const plain = U.cleanTx({type:'expense', category:'ocio', date:'2026-09-01', amount:100, source:'otro', review:'yes'});
  assert.equal(plain.source, null); assert.equal(plain.review, false); assert.equal(plain.card, null);
});

test('balanceNow suma saldo inicial, ingresos y gastos hasta hoy', () => {
  const list = [
    {type:'income', amount:100000, date:'2026-10-20'}, {type:'expense', amount:30000, date:'2026-10-25'},
    {type:'expense', amount:5000, date:'2026-10-26'}, {type:'income', amount:999999, date:'2026-10-27'} // futuro: no cuenta
  ];
  assert.equal(U.balanceNow(50000, list, '2026-10-26'), 115000);
  assert.equal(U.balanceNow(0, list, '2026-10-26'), 65000);
  assert.equal(U.balanceNow(undefined, [], '2026-10-26'), 0);
  assert.equal(U.balanceNow(-20000, [{type:'income', amount:5000, date:'2026-10-01'}], '2026-10-26'), -15000);
});

test('parseSigned acepta cero y negativos', () => {
  assert.equal(U.parseSigned('1,250.50'), 1250.5);
  assert.equal(U.parseSigned('-300'), -300);
  assert.equal(U.parseSigned('−45.5'), -45.5);
  assert.equal(U.parseSigned('0'), 0);
  assert.ok(Number.isNaN(U.parseSigned('')));
  assert.ok(Number.isNaN(U.parseSigned('-')));
  assert.ok(Number.isNaN(U.parseSigned('abc')));
});
