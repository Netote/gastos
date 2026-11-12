// Ejecutar con: npm test
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../js/forecast.js';

const rule = (o = {}) => Object.assign({id:'r1', name:'Renta', type:'expense', category:'vivienda', amount:850000, day:1, start_month:'2026-07-01', occurrences:null, active:true}, o);
const tx = (date, amount, o = {}) => Object.assign({id:'t' + date + amount, type:'expense', category:'alimentacion', amount, date, description:'', recurring_id:null}, o);
const TODAY = '2026-11-11';

test('fechas: sumar días, diferencia, lunes de la semana', () => {
  assert.equal(F.addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(F.addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(F.dayDiff('2026-11-11', '2026-12-11'), 30);
  assert.equal(F.weekday('2026-11-11'), 3); // miércoles
  assert.equal(F.monday('2026-11-11'), '2026-11-09');
  assert.equal(F.monday('2026-11-15'), '2026-11-09'); // domingo pertenece a la semana que empezó el lunes 9
  assert.equal(F.monday('2026-11-09'), '2026-11-09');
});

test('ruleEvents respeta fin de mes, número de pagos, pausa y lo ya registrado', () => {
  const ev = F.ruleEvents([rule({day:31})], '2027-02-01', '2027-04-30');
  assert.deepEqual(ev.map(e => e.date), ['2027-02-28', '2027-03-31', '2027-04-30']);
  const msi = F.ruleEvents([rule({id:'m', start_month:'2026-10-01', day:20, occurrences:3})], TODAY, '2027-06-30');
  assert.deepEqual(msi.map(e => [e.date, e.index, e.of]), [['2026-11-20', 2, 3], ['2026-12-20', 3, 3]]);
  assert.equal(F.ruleEvents([rule({active:false})], TODAY, '2027-01-31').length, 0);
  const skip = F.ruleEvents([rule()], TODAY, '2027-01-31', id => id === 'r_r1_202612');
  assert.deepEqual(skip.map(e => e.date), ['2027-01-01']);
});

test('variableDaily promedia los gastos no fijos y mide la confianza', () => {
  assert.deepEqual(F.variableDaily([], TODAY), {daily:0, days:0, confidence:'none'});
  const few = F.variableDaily([tx('2026-11-01', 100000)], TODAY);
  assert.equal(few.days, 10); assert.equal(few.daily, 10000); assert.equal(few.confidence, 'baja');
  // 90 días de historial: el fijo no cuenta, lo de hoy tampoco (ya está en el saldo).
  const many = F.variableDaily([tx('2026-05-01', 1), tx('2026-10-01', 900000), tx('2026-10-02', 500000, {recurring_id:'r1'}), tx(TODAY, 999999)], TODAY);
  assert.equal(many.days, 90); assert.equal(many.daily, 10000); assert.equal(many.confidence, 'alta');
  // La renta capturada a mano deja de contar como gasto variable cuando ya existe como fijo.
  const hand = [tx('2026-05-01', 1), tx('2026-10-01', 900000), tx('2026-10-01', 850000, {category:'vivienda'})];
  assert.equal(F.variableDaily(hand, TODAY).daily, Math.round(1750000 / 90));
  assert.equal(F.variableDaily(hand, TODAY, [rule()]).daily, 10000);
});

test('inferIncome detecta la quincena capturada a mano y no la duplica si ya es un fijo', () => {
  const inc = (date, amount = 1350000, description = 'Quincena') => tx(date, amount, {type:'income', category:'salario', description, id:date});
  const hist = [inc('2026-08-15'), inc('2026-08-30'), inc('2026-09-15'), inc('2026-09-30'), inc('2026-10-15'), inc('2026-10-30'),
    inc('2026-09-07', 300000, 'Proyecto'), inc('2026-10-22', 900000, 'Proyecto')];
  const got = F.inferIncome(hist, [], TODAY).sort((a, b) => a.day - b.day);
  assert.deepEqual(got.map(s => [s.name, s.day, s.amount, s.paidThisMonth]), [['Quincena', 15, 1350000, false], ['Quincena', 30, 1350000, false]]);
  const withRule = F.inferIncome(hist, [rule({type:'income', category:'salario', amount:1350000, day:15})], TODAY);
  assert.deepEqual(withRule.map(s => s.day), [30]);
  // Ya cobrada este mes: no se vuelve a proyectar en noviembre.
  const paid = F.inferIncome([...hist, inc('2026-11-13')], [], '2026-11-14').find(s => s.day === 15);
  assert.equal(paid.paidThisMonth, true);
});

test('project: saldo día a día con fijos, movimientos futuros y gasto variable', () => {
  const data = {opening:1000000, today:TODAY, rules:[rule({day:15, amount:300000}), rule({id:'q', type:'income', category:'salario', name:'Quincena', amount:500000, day:30})],
    tx:[tx('2026-11-01', 100000), tx('2026-11-20', 50000, {id:'fut', description:'Dentista'})]};
  const fc = F.forecast({...data, days:30});
  assert.equal(fc.start, 900000);                       // el movimiento futuro aún no cuenta
  assert.equal(fc.days.length, 31);
  assert.equal(fc.days[0].balance, 900000);             // hoy no descuenta gasto variable
  const daily = 10000;                                  // 100,000 entre 10 días
  assert.equal(fc.days[4].date, '2026-11-15');
  assert.equal(fc.days[4].balance, 900000 - 4 * daily - 300000);
  assert.equal(fc.days[9].events[0].name, 'Dentista');
  assert.equal(fc.days[19].balance, 900000 - 19 * daily - 300000 - 50000 + 500000);
  assert.equal(fc.min.date, '2026-11-29');
  assert.equal(fc.firstNegative, null);
  assert.equal(fc.cushion, 70000);
});

test('shortfalls y clusters: faltante con sus causas y coincidencia de pagos antes del ingreso', () => {
  const fc = F.forecast({opening:500000, today:TODAY, days:30, tx:[],
    rules:[rule({day:14, amount:300000}), rule({id:'s', name:'Seguro', day:15, amount:250000}), rule({id:'n', name:'Streaming', day:25, amount:20000}),
      rule({id:'q', type:'income', category:'salario', name:'Quincena', amount:400000, day:20})]});
  const sf = F.shortfalls(fc);
  assert.equal(sf.negative.length, 1);
  assert.deepEqual([sf.negative[0].from, sf.negative[0].to, sf.negative[0].min], ['2026-11-15', '2026-11-19', -50000]);
  assert.deepEqual(sf.negative[0].causes.map(e => e.name), ['Renta', 'Seguro']);
  const cl = F.clusters(fc);
  assert.equal(cl.length, 1);
  assert.deepEqual([cl[0].from, cl[0].to, cl[0].total, cl[0].items.length], ['2026-11-14', '2026-11-15', 550000, 2]);
  assert.equal(cl[0].nextIncome.name, 'Quincena');
  assert.ok(cl[0].share > 1);
});

test('debts cuenta pagos restantes e installment calcula MSI e interés', () => {
  const d = F.debts([rule({id:'m', name:'Laptop', amount:125000, day:20, start_month:'2026-09-01', occurrences:12}), rule()], TODAY);
  assert.deepEqual([d.list.length, d.list[0].paid, d.list[0].remaining, d.total, d.monthly, d.list[0].end], [1, 2, 10, 1250000, 125000, '2027-08-20']);
  assert.equal(F.debts([rule({occurrences:2})], TODAY).list.length, 0); // ya terminó
  assert.equal(F.installment(1500000, 12), 125000);
  assert.equal(F.installment(1000000, 3), 333334);     // redondea hacia arriba: nunca queda un centavo sin pagar
  assert.equal(F.installment(1200000, 12, 36), 120555); // 36 % anual
});

test('simulatePurchase: veredictos, filas a 30 y 60 días y alternativas', () => {
  const ctx = {opening:2000000, today:TODAY, tx:[tx('2026-05-01', 1), tx('2026-09-01', 9000 * 90)],
    rules:[rule({day:1, amount:800000}), rule({id:'q', type:'income', category:'salario', name:'Nómina', amount:1500000, day:28})]};
  const prep = F.prepare(ctx);
  assert.equal(prep.vd.daily, 9000);

  const ok = F.simulatePurchase(prep, {amount:300000, mode:'contado'});
  assert.equal(ok.verdict, 'si');
  assert.equal(ok.rows.now.sim, ok.rows.now.base - 300000);
  assert.equal(ok.rows.d30.base - ok.rows.d30.sim, 300000);
  assert.equal(ok.purchase.date, TODAY);

  const no = F.simulatePurchase(prep, {amount:2500000, mode:'contado'});
  assert.equal(no.verdict, 'no'); assert.equal(no.reason, 'faltante');
  assert.ok(no.worst.balance < 0);
  assert.ok(no.alt.months && no.alt.months.n >= 3);     // a meses sí cabe
  assert.equal(no.alt.maxSafe, ok.base.min.balance - prep.cushion);

  const msi = F.simulatePurchase(prep, {amount:1200000, mode:'meses', months:12, name:'Laptop'}, {budgets:[{id:'compras', amount:50000}]});
  assert.equal(msi.purchase.pay, 100000);
  assert.deepEqual(msi.events.slice(0, 2).map(e => e.date), ['2026-12-11', '2027-01-11']);
  assert.equal(msi.rows.now.sim, msi.rows.now.base);    // a meses no baja el saldo hoy
  assert.equal(msi.rows.d60.base - msi.rows.d60.sim, 100000); // un pago dentro de 60 días (11 dic); el del 11 ene cae en el día 61
  assert.equal(msi.debts.after.total, 1200000);
  assert.equal(msi.budget.over, 50000);
  assert.ok(msi.committed.after > msi.committed.before);

  const justo = F.simulatePurchase(prep, {amount:prep.start - 20000, mode:'contado'});
  assert.notEqual(justo.verdict, 'si');
  const interes = F.simulatePurchase(prep, {amount:1200000, mode:'meses', months:12, rate:36});
  assert.equal(interes.purchase.interest, 120555 * 12 - 1200000);
});

test('simulatePurchase: una mensualidad que no cabe en el mes es un «no» aunque el saldo aguante 60 días', () => {
  const prep = F.prepare({opening:5000000, today:TODAY, tx:[], rules:[rule({amount:900000}), rule({id:'q', type:'income', category:'salario', amount:1000000, day:28})]});
  const r = F.simulatePurchase(prep, {amount:2400000, mode:'meses', months:12});
  assert.deepEqual([r.verdict, r.reason, r.marginAfter], ['no', 'mensualidad', -100000]);
  assert.equal(r.alt.contado, true);  // de contado sí alcanza: se ofrece como alternativa
  assert.equal(r.alt.waitDate, null);
});
