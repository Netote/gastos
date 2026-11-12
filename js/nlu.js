/*
 * Intérprete del chat: convierte una frase en español en una intención con sus datos (monto, forma de pago, fecha…).
 * Lógica pura y local: no usa ninguna IA ni sale del dispositivo. Montos en centavos, fechas 'YYYY-MM-DD'.
 */
import {norm, parseAmount, toCents, pad, daysIn, addMonths, merchantKey, MONTHS} from './util.js';
import {addDays, weekday} from './forecast.js';

const WORDS = {un:1, uno:1, una:1, dos:2, tres:3, cuatro:4, cinco:5, seis:6, siete:7, ocho:8, nueve:9, diez:10, once:11, doce:12, quince:15, dieciocho:18, veinte:20, veinticuatro:24, treinta:30, cuarenta:40, cincuenta:50, cien:100};
const NUM = '(\\d{1,3}|' + Object.keys(WORDS).join('|') + ')';
const num = s => /^\d+$/.test(s) ? Number(s) : WORDS[s];
const WD = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MON = MONTHS.map(norm);

// Palabras que delatan la categoría de una compra. El orden importa: gana la primera que coincide.
const KEYWORDS = [
  ['suscripciones', /netflix|spotify|disney|hbo|prime video|youtube premium|icloud|suscripcion|membresia/],
  ['transporte', /coche|carro|auto\b|moto|llantas?|gasolina|bici|uber|taxi|camion|afinacion|verificacion|tenencia/],
  ['salud', /doctor|medico|dentista|lentes|medicinas?|farmacia|hospital|consulta|analisis|terapia|gimnasio|gym/],
  ['educacion', /curso|colegiatura|escuela|universidad|libros?|diplomado|maestria|inscripcion|clases/],
  ['alimentacion', /super\b|supermercado|despensa|restaurante|comida|cena|mandado|cafe\b/],
  ['vivienda', /renta|refri|refrigerador|lavadora|estufa|colchon|muebles?|sala\b|comedor|cama\b|microondas|boiler|remodel/],
  ['servicios', /internet|luz\b|agua\b|gas\b|telefono|plan de celular|recibo/],
  ['ocio', /viaje|vuelo|boletos?|hotel|concierto|vacaciones|cine|fiesta|videojuegos?|consola|playstation|xbox|nintendo|switch/],
  ['deudas', /deuda|prestamo|tarjeta de credito|abono|credito\b/],
  ['compras', /laptop|compu|computadora|celular|iphone|telefono nuevo|tele\b|television|pantalla|tablet|ipad|ropa|tenis|zapatos|reloj|audifonos|bocina|camara|regalo|mochila|bolsa/]
];

/** Día `d` del mes más próximo que no haya pasado. */
function nextDom(today, d){
  let key = today.slice(0, 7);
  for (let i = 0; i < 3; i++, key = addMonths(key, 1)){
    const [y, m] = key.split('-').map(Number), date = key + '-' + pad(Math.min(d, daysIn(y, m - 1)));
    if (date >= today) return date;
  }
  return today;
}
function nextQuincena(today){
  const [y, m] = today.split('-').map(Number), mid = today.slice(0, 8) + '15', end = today.slice(0, 8) + pad(daysIn(y, m - 1));
  return mid > today ? mid : end > today ? end : addMonths(today.slice(0, 7), 1) + '-15';
}

/**
 * Devuelve {intent, amount, mode, months, rate, date, category, item}.
 * intent: 'compra' | 'deudas' | 'pagos' | 'libre' | 'saldo' | 'semana' | 'ayuda' | 'ajuste' (solo cambia un dato de la
 * simulación anterior: «¿y a 6 meses?») | 'desconocido'.
 */
export function parse(text, {today, rules = []} = {}){
  const full = ' ' + norm(text).replace(/[¿?¡!]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const out = {intent:'desconocido', amount:null, mode:null, months:null, rate:null, date:null, category:null, item:null};
  let s = full;
  const cut = (re, fn) => { const m = s.match(re); if (m){ s = s.replace(m[0], ' '); if (fn) fn(m); } return !!m; };

  // Interés
  cut(/(\d+(?:[.,]\d+)?)\s*(?:%|por ?ciento)(?:\s*(?:de\s+)?(?:interes(?:es)?|anual))*/, m => { out.rate = Number(m[1].replace(',', '.')); });
  if (cut(/sin\s+interes(?:es)?/)) out.rate = 0;

  // Fechas relativas con número (antes que los meses de pago: «en 2 meses» es una fecha, «a 2 meses» un plazo)
  if (today){
    cut(new RegExp('(?:dentro de|en)\\s+' + NUM + '\\s+(dias?|semanas?|meses|mes)\\b'), m => {
      const n = num(m[1]), u = m[2][0];
      out.date = u === 'd' ? addDays(today, n) : u === 's' ? addDays(today, n * 7) : nextDom(addMonths(today.slice(0, 7), n) + '-01', Number(today.slice(8, 10)));
    });
  }

  // Forma de pago
  cut(new RegExp('(?:a|en|de)?\\s*' + NUM + '\\s*(?:meses|mes|msi|mensualidades|pagos)\\b'), m => { out.mode = 'meses'; out.months = num(m[1]); });
  if (cut(/\b(?:a meses|msi|mensualidades|a plazos|a credito|en pagos)\b/)) out.mode = 'meses';
  if (cut(/\b(?:de contado|al contado|contado|de una|un solo pago|en efectivo|una sola exhibicion)\b/)){ out.mode = 'contado'; out.months = null; }
  if (out.rate && !out.mode) out.mode = 'meses';

  // Fechas
  if (today && !out.date){
    cut(/\bpasado manana\b/, () => { out.date = addDays(today, 2); }) ||
    cut(/\bmanana\b/, () => { out.date = addDays(today, 1); }) ||
    cut(/\b(?:hoy|ahorita|ahora mismo)\b/, () => { out.date = today; }) ||
    cut(new RegExp('(?:el|este|proximo|para el)\\s+(' + WD.join('|') + ')\\b'), m => { const d = (WD.indexOf(m[1]) - weekday(today) + 7) % 7 || 7; out.date = addDays(today, d); }) ||
    cut(new RegExp('(?:el\\s+|dia\\s+)?(\\d{1,2})\\s+de\\s+(' + MON.join('|') + ')\\b'), m => {
      const mi = MON.indexOf(m[2]); let y = Number(today.slice(0, 4));
      let date = y + '-' + pad(mi + 1) + '-' + pad(Math.min(Number(m[1]), daysIn(y, mi)));
      if (date < today){ y++; date = y + '-' + pad(mi + 1) + '-' + pad(Math.min(Number(m[1]), daysIn(y, mi))); }
      out.date = date;
    }) ||
    cut(/(?:el dia|el|dia)\s+(\d{1,2})\b(?![.,]?\d)(?!\s*(?:mil|k\b|pesos))/, m => { const d = Number(m[1]); if (d >= 1 && d <= 31) out.date = nextDom(today, d); }) ||
    cut(/\b(?:a\s+)?fin(?:es)? de mes\b/, () => { out.date = nextDom(today, 31); }) ||
    cut(/\b(?:la |mi |proxima |siguiente )*quincena\b/, () => { out.date = nextQuincena(today); }) ||
    cut(/\b(?:la )?(?:proxima semana|semana que viene|semana que entra)\b/, () => { out.date = addDays(today, 7); }) ||
    cut(/\b(?:el )?(?:proximo mes|mes que viene|mes que entra)\b/, () => { out.date = nextDom(addMonths(today.slice(0, 7), 1) + '-01', Number(today.slice(8, 10))); });
  }

  // Monto: primero los que traen marca ($, mil, k, pesos); si no hay, el número más grande que quede.
  const cands = [];
  s.replace(/(\$)?\s*(\d[\d.,]*\d|\d)\s*(millones|millon|mil|k)?\b\s*(pesos|mxn|varos|lana)?/g, (all, sym, n, mult, unit) => {
    const v = parseAmount(n.replace(/[.,]$/, '')); if (!(v > 0)) return all;
    cands.push({v:v * (mult ? (mult[0] === 'k' || mult === 'mil' ? 1e3 : 1e6) : 1), marked:!!(sym || mult || unit)}); return all;
  });
  if (!cands.length){
    const w = s.match(new RegExp('\\b(?:' + NUM + '\\s+)?mil\\b'));
    if (w) cands.push({v:(w[1] ? num(w[1]) : 1) * 1e3, marked:true});
  }
  const pick = cands.filter(c => c.marked).sort((a, b) => b.v - a.v)[0] || cands.sort((a, b) => b.v - a.v)[0];
  if (pick && pick.v <= 999999999) out.amount = toCents(pick.v);

  // Categoría: primero las reglas por comercio del usuario, luego palabras clave.
  const mk = ' ' + merchantKey(text) + ' ';
  const rule = rules.find(r => r.id && mk.includes(' ' + r.id + ' '));
  if (rule) out.category = rule.category;
  else { const k = KEYWORDS.find(([, re]) => re.test(full)); if (k) out.category = k[0]; }

  // Qué se quiere comprar (para nombrar la simulación)
  const it = full.match(/(?:comprar(?:me|nos)?|compro|compra de|pagar|gastar en|para|adquirir|cambiar)\s+(?:(?:un|una|unos|unas|el|la|los|las|mi|mis|otro|otra)\s+)?([a-z][a-z ]*?)(?=\s+(?:de|por|a|en|con|el|que|si|hoy|manana|este|al|cuesta|vale|sale)\b|\s*\$|\s+\d|\s*$)/);
  // Sin verbo («tele de 12 mil a 12 meses»): lo que va antes del precio.
  const lead = it ? null : full.match(/^ (?:(?:un|una|unos|unas|el|la|los|las|mi|mis)\s+)?([a-z][a-z ]*?)\s+(?:de|por|en|a|cuesta|vale|sale)\s+\$?\s*\d/);
  const name = ((it || lead || [])[1] || '').trim();
  if (name.length > 2 && !/^(?:contado|meses|credito|plazos|pagos)$/.test(name) && !/^(?:y|o|mejor|pero|entonces|ahora|ok|si|no|cuanto|que|como|puedo|me|quiero|hola|para)\b/.test(name)) out.item = name.slice(0, 40);

  // Intención
  const has = re => re.test(full);
  if (out.amount != null && !has(/cuanto (?:tendre|voy a tener|me quedara|me va a quedar)/)) out.intent = 'compra';
  else if (has(/\b(?:debo|deudas?|adeudos?|msi pendientes|me falta por pagar|cuanto me falta de)\b/)) out.intent = 'deudas';
  else if (has(/(?:que|cuales|proximos|mis) pagos|pagos (?:vienen|proximos|pendientes|que vienen|tengo)|que (?:viene|vence|tengo que pagar|me toca pagar)|vencimientos/)) out.intent = 'pagos';
  else if (has(/cuanto (?:puedo|podria|me puedo) gastar|(?:libre|disponible) para gastar|cuanto (?:tengo|me queda) (?:libre|disponible)/)) out.intent = 'libre';
  else if (has(/cuanto (?:tendre|voy a tener|me quedara|me va a quedar|tendria|habra)|saldo (?:el|para|al|a fin|en|de)|como (?:voy a estar|estare|andare)|me alcanza (?:hasta|para llegar)/)) out.intent = 'saldo';
  else if (has(/reporte|resumen|como (?:voy|me fue|vamos)|esta semana|semana pasada/)) out.intent = 'semana';
  else if (has(/^ (?:hola|buenas|buenos|hey|ayuda|gracias)\b|que (?:puedes|sabes) hacer|como funciona|que te puedo preguntar/)) out.intent = 'ayuda';
  else if (has(/compr|gastar|me alcanza|adquirir|puedo pagar|quiero (?:un|una|unos|unas)\b/)) out.intent = 'compra';
  else if (out.mode || out.months || out.rate != null || out.date) out.intent = 'ajuste';
  return out;
}
