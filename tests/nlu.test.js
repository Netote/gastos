// Ejecutar con: npm test
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parse} from '../js/nlu.js';

const TODAY = '2026-11-11'; // miércoles
const p = (t, o = {}) => parse(t, {today:TODAY, ...o});

test('compra de contado: monto en varios formatos', () => {
  assert.equal(p('¿Puedo comprar una laptop de 15,000?').amount, 1500000);
  assert.equal(p('quiero comprar un celular de $8,499.50').amount, 849950);
  assert.equal(p('me alcanza para una tele de 12 mil').amount, 1200000);
  assert.equal(p('comprar tenis 2.5k').amount, 250000);
  assert.equal(p('gastar 800 pesos en una cena').amount, 80000);
  assert.equal(p('un viaje de dos mil pesos').amount, 200000);
  const r = p('¿Puedo comprar una laptop de 15,000?');
  assert.deepEqual([r.intent, r.mode, r.category, r.item], ['compra', null, 'compras', 'laptop']);
});

test('compra a meses, con interés y de contado', () => {
  const a = p('laptop de 15000 a 12 meses');
  assert.deepEqual([a.intent, a.amount, a.mode, a.months, a.rate, a.item], ['compra', 1500000, 'meses', 12, null, 'laptop']);
  assert.equal(p('una tele de 12 mil el 20').item, 'tele');
  assert.equal(p('¿y si fueran 20 mil?').item, null);
  assert.equal(p('mejor de contado').item, null);
  assert.equal(p('una mesa de 3,000').item, 'mesa');   // «me…» no es la palabra «me»
  assert.equal(p('silla de 900 pesos').item, 'silla');
  assert.equal(p('y de 20 mil').item, null);           // una muletilla no es el nombre de la compra
  const b = p('comprar refri de 18 mil a 18 MSI');
  assert.deepEqual([b.amount, b.months, b.category, b.rate], [1800000, 18, 'vivienda', null]);
  const c = p('un coche de 250000 en 48 pagos con 14.5% de interés');
  assert.deepEqual([c.amount, c.months, c.rate, c.category], [25000000, 48, 14.5, 'transporte']);
  const d = p('celular 9000 de contado');
  assert.deepEqual([d.amount, d.mode, d.months], [900000, 'contado', null]);
  const e = p('comprar una consola de 9,999 a doce meses sin intereses');
  assert.deepEqual([e.amount, e.months, e.rate, e.category], [999900, 12, 0, 'ocio']);
  assert.equal(p('comprar una bici a meses').mode, 'meses'); // falta el monto y el plazo: el chat los pregunta
  assert.equal(p('comprar una bici a meses').amount, null);
});

test('fechas: hoy, mañana, día de la semana, día del mes, quincena', () => {
  assert.equal(p('comprar 500 hoy').date, TODAY);
  assert.equal(p('comprar 500 mañana').date, '2026-11-12');
  assert.equal(p('comprar 500 el viernes').date, '2026-11-13');
  assert.equal(p('comprar 500 el miércoles').date, '2026-11-18'); // hoy es miércoles: el siguiente
  assert.equal(p('comprar 500 el 15').date, '2026-11-15');
  assert.equal(p('comprar 500 el 5').date, '2026-12-05');          // el 5 ya pasó
  assert.equal(p('comprar 500 el 15 de diciembre').date, '2026-12-15');
  assert.equal(p('comprar 500 el 3 de enero').date, '2027-01-03');
  assert.equal(p('comprar 500 en la quincena').date, '2026-11-15');
  assert.equal(p('comprar 500 a fin de mes').date, '2026-11-30');
  assert.equal(p('comprar 500 en 10 días').date, '2026-11-21');
  assert.equal(p('comprar 500 la próxima semana').date, '2026-11-18');
  const r = p('laptop de 15,000 el 15 a 6 meses');
  assert.deepEqual([r.amount, r.date, r.months], [1500000, '2026-11-15', 6]);
});

test('no confunde el día, el plazo ni el interés con el monto', () => {
  assert.equal(p('comprar algo el 15 a 12 meses').amount, null);
  assert.equal(p('a 24 meses con 30%').amount, null);
  assert.equal(p('comprar una tele de 15,000 el 20').amount, 1500000);
});

test('otras intenciones', () => {
  assert.equal(p('¿Cuánto debo?').intent, 'deudas');
  assert.equal(p('mis deudas pendientes').intent, 'deudas');
  assert.equal(p('¿Qué pagos vienen?').intent, 'pagos');
  assert.equal(p('¿qué tengo que pagar esta quincena?').intent, 'pagos');
  assert.equal(p('¿Cuánto puedo gastar hoy?').intent, 'libre');
  const s = p('¿Cuánto tendré el 30?');
  assert.deepEqual([s.intent, s.date, s.amount], ['saldo', '2026-11-30', null]);
  assert.equal(p('¿cómo voy esta semana?').intent, 'semana');
  assert.equal(p('hola').intent, 'ayuda');
  assert.equal(p('asdf qwerty').intent, 'desconocido');
});

test('ajustes de una simulación anterior', () => {
  assert.deepEqual([p('¿y a 6 meses?').intent, p('¿y a 6 meses?').months], ['ajuste', 6]);
  assert.deepEqual([p('mejor de contado').intent, p('mejor de contado').mode], ['ajuste', 'contado']);
  assert.deepEqual([p('¿y si espero a la quincena?').intent, p('¿y si espero a la quincena?').date], ['ajuste', '2026-11-15']);
  assert.equal(p('¿y si fueran 20 mil?').amount, 2000000);
});

test('las reglas por comercio del usuario mandan sobre las palabras clave', () => {
  const r = p('comprar 600 en Costco', {rules:[{id:'costco', category:'alimentacion'}]});
  assert.equal(r.category, 'alimentacion');
});
