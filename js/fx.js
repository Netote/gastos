/*
 * Animaciones de la interfaz con Motion (https://motion.dev: el motor de Framer Motion, en su versión sin React).
 * La librería viene en vendor/motion.min.js. Si no carga, o el sistema pide menos movimiento
 * («Reducir movimiento»), todo queda estático y la app funciona igual.
 * Solo se animan opacity y transform: van en la GPU y no recalculan el diseño de la página.
 *
 * Criterio (skill de diseño de Emil Kowalski): lo que se repite muchas veces al día no se anima o apenas se mueve;
 * entradas con curva de salida fuerte, salidas más rápidas que las entradas y sin rebotes en la interfaz.
 */
const M = () => window.Motion;
const mq = matchMedia('(prefers-reduced-motion: reduce)');
export const enabled = () => !!(M() && M().animate) && !mq.matches;

/* Curva de salida fuerte para lo que entra y la de los cajones de iOS para las hojas inferiores. */
const EASE_OUT = [.23, 1, .32, 1], DRAWER = [.32, .72, 0, 1];

export function init(){
  const set = () => document.documentElement.classList.toggle('fx', enabled());
  set();
  if (mq.addEventListener) mq.addEventListener('change', set);
}

/**
 * Quita los estilos en línea que Motion deja al terminar. Motion los escribe justo DESPUÉS de resolver su promesa,
 * así que se limpia varias veces; y nunca se toca un elemento que todavía esté animándose.
 */
function settle(list, props){
  const clear = () => list.forEach(e => {
    if (e.getAnimations && e.getAnimations().some(a => a.playState === 'running')) return;
    props.forEach(p => e.style.removeProperty(p));
  });
  clear();
  requestAnimationFrame(clear);
  [80, 400, 1200, 2600].forEach(ms => setTimeout(clear, ms));
}

/** Corre una animación y, pase lo que pase, deja el elemento sin estilos en línea (nunca queda algo invisible). */
function run(els, keyframes, options, props){
  const list = Array.from(els.length === undefined ? [els] : els);
  try {
    const ctl = M().animate(list, keyframes, options);
    const done = () => settle(list, props);
    if (ctl && ctl.then) ctl.then(done, done);
    setTimeout(done, 2600); // red de seguridad
    return ctl;
  } catch(e){ settle(list, props); return null; }
}

const CARDS = '.card, .goal, .view-head, .banner, .duo, .subnav';
const seen = new Set();

/**
 * Entrada de una vista. Cambiar de pestaña pasa decenas de veces al día, así que solo se anima la PRIMERA vez que se
 * abre cada sección: una cascada corta (las primeras tarjetas a la vista, 40 ms entre cada una) y las barras que se
 * llenan. Después, las pantallas aparecen al instante.
 */
export function enter(root){
  if (!enabled() || !root) return;
  const key = root.id || root.dataset.view || '';
  if (seen.has(key)) return;
  seen.add(key);
  const visible = e => e.getClientRects().length > 0 && e.getBoundingClientRect().top < innerHeight;
  const cards = Array.from(root.querySelectorAll(CARDS)).filter(e => !e.parentElement.closest('.card')).filter(visible).slice(0, 6);
  const bars = Array.from(root.querySelectorAll('.bar > span, .split > span')).filter(visible);
  const rings = Array.from(root.querySelectorAll('.goal-ring')).filter(visible);

  if (cards.length){
    cards.forEach(e => { e.style.opacity = '0'; });
    run(cards, {opacity:[0, 1], transform:['translateY(8px)', 'translateY(0px)']},
      {duration:.32, ease:EASE_OUT, delay:M().stagger(.04)}, ['opacity', 'transform']);
  }
  if (bars.length){
    bars.forEach(e => { e.style.transformOrigin = 'left center'; e.style.transform = 'scaleX(0)'; });
    run(bars, {transform:['scaleX(0)', 'scaleX(1)']},
      {duration:.6, ease:EASE_OUT, delay:M().stagger(.03, {startDelay:.1})}, ['transform', 'transform-origin']);
  }
  rings.forEach((r, i) => {
    const to = parseFloat(r.style.getPropertyValue('--p')) || 0;
    r.style.setProperty('--p', '0');
    try {
      M().animate(0, to, {duration:.7, ease:EASE_OUT, delay:.1 + i * .04, onUpdate: v => r.style.setProperty('--p', v.toFixed(2)), onComplete: () => r.style.setProperty('--p', String(to))});
    } catch(e){ r.style.setProperty('--p', String(to)); }
    setTimeout(() => r.style.setProperty('--p', String(to)), 2500);
  });
}

/* ---------- Contadores: un monto «rueda» solo cuando cambia ---------- */
const last = new Map(), ctls = new Map();
/**
 * Anima los elementos con data-count (centavos) y data-count-key solo cuando el valor cambió desde la última vez
 * (por ejemplo, el saldo al registrar un gasto): así se ve qué cambió. Nunca al entrar a una pantalla.
 * El texto final ya lo puso quien pintó el elemento.
 */
export function counters(root, fmt){
  if (!root) return;
  root.querySelectorAll('[data-count]').forEach(el => {
    const key = el.dataset.countKey || el.id, to = Number(el.dataset.count);
    if (!Number.isFinite(to)) return;
    const prev = ctls.get(key); if (prev){ try { prev.stop(); } catch(e){} ctls.delete(key); }
    const from = last.has(key) ? last.get(key) : to;
    last.set(key, to);
    if (!enabled() || from === to || !el.getClientRects().length) return;
    el.textContent = fmt(from);
    try {
      ctls.set(key, M().animate(from, to, {duration:.6, ease:EASE_OUT,
        onUpdate: v => { el.textContent = fmt(Math.round(v / 100) * 100); }, // pesos enteros a medio camino: sin centavos bailando
        onComplete: () => { el.textContent = fmt(to); }}));
    } catch(e){ el.textContent = fmt(to); }
    setTimeout(() => { if (el.isConnected) el.textContent = fmt(to); }, 2500);
  });
}

/* ---------- Indicador deslizante de la barra de secciones (como «layoutId» en Framer Motion) ---------- */
export function moveIndicator(nav, instant){
  if (!nav) return;
  const ind = nav.querySelector('.tab-ind'), cur = nav.querySelector('a[aria-current="page"]');
  if (!ind || !cur || !cur.offsetWidth) return;
  const to = 'translate(' + cur.offsetLeft + 'px, ' + cur.offsetTop + 'px)', w = cur.offsetWidth + 'px', h = cur.offsetHeight + 'px';
  const from = ind.style.transform || to, fromW = ind.style.width || w;
  ind.style.height = h;
  if (instant || !enabled() || !ind.dataset.placed){
    ind.style.width = w; ind.style.transform = to; ind.dataset.placed = '1'; ind.style.opacity = '1'; return;
  }
  ind.style.width = w; ind.style.transform = to;
  try { M().animate(ind, {transform:[from, to], width:[fromW, w]}, {type:'spring', duration:.35, bounce:.08}); } catch(e){}
}

/* ---------- Diálogos ---------- */
const isSheet = d => d.classList.contains('sheet') && matchMedia('(max-width: 759px)').matches;
export function dialogIn(d){
  if (!enabled()) return;
  const sheet = isSheet(d);
  run(d, sheet ? {transform:['translateY(100%)', 'translateY(0%)']}
    : {opacity:[0, 1], transform:['translateY(8px) scale(.97)', 'translateY(0px) scale(1)']},
  sheet ? {duration:.42, ease:DRAWER} : {duration:.24, ease:EASE_OUT}, ['opacity', 'transform']);
}
/** Resuelve al terminar la animación de salida (más rápida que la entrada); quien llama cierra el diálogo y limpia con clear(). */
export function dialogOut(d){
  if (!enabled()) return Promise.resolve();
  try {
    const sheet = isSheet(d);
    const ctl = M().animate(d, sheet ? {transform:['translateY(0%)', 'translateY(100%)']}
      : {opacity:[1, 0], transform:['translateY(0px) scale(1)', 'translateY(6px) scale(.97)']}, sheet ? {duration:.26, ease:DRAWER} : {duration:.16, ease:EASE_OUT});
    return new Promise(ok => { if (ctl && ctl.then) ctl.then(ok, ok); else ok(); setTimeout(ok, 600); });
  } catch(e){ return Promise.resolve(); }
}
export const clear = d => settle([d], ['opacity', 'transform']);

/** Pequeño latido para confirmar una acción (por ejemplo, al guardar un saldo). */
export function pulse(el){
  if (!enabled() || !el) return;
  run(el, {transform:['scale(1)', 'scale(1.03)', 'scale(1)']}, {duration:.3, ease:EASE_OUT}, ['transform']);
}
