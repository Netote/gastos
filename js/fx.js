/*
 * Animaciones de la interfaz con Motion (https://motion.dev: el motor de Framer Motion, en su versión sin React).
 * La librería viene en vendor/motion.min.js. Si no carga, o el sistema pide menos movimiento
 * («Reducir movimiento»), todo queda estático y la app funciona igual.
 * Solo se animan opacity y transform: van en la GPU y no recalculan el diseño de la página.
 */
const M = () => window.Motion;
const mq = matchMedia('(prefers-reduced-motion: reduce)');
export const enabled = () => !!(M() && M().animate) && !mq.matches;

const SPRING = {type:'spring', duration:.6, bounce:.18};

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

const CARDS = '.card, .goal, .view-head, .banner';
const ROWS = '.rv, .bud-row, .rec, .tx-list > li';

/** Entrada de una vista: las tarjetas suben en cascada con un resorte, luego las filas, y las barras se llenan. */
export function enter(root){
  if (!enabled() || !root) return;
  const visible = e => e.getClientRects().length > 0;
  const cards = Array.from(root.querySelectorAll(CARDS)).filter(visible).slice(0, 14);
  const rows = Array.from(root.querySelectorAll(ROWS)).filter(visible).slice(0, 14);
  const bars = Array.from(root.querySelectorAll('.bar > span, .split > span')).filter(visible);
  const rings = Array.from(root.querySelectorAll('.goal-ring')).filter(visible);

  if (cards.length){
    cards.forEach(e => { e.style.opacity = '0'; });
    run(cards, {opacity:[0, 1], transform:['translateY(20px) scale(.98)', 'translateY(0px) scale(1)']},
      {...SPRING, delay:M().stagger(.055)}, ['opacity', 'transform']);
  }
  if (rows.length){
    rows.forEach(e => { e.style.opacity = '0'; });
    run(rows, {opacity:[0, 1], transform:['translateY(10px)', 'translateY(0px)']},
      {type:'spring', duration:.5, bounce:.12, delay:M().stagger(.035, {startDelay:.16})}, ['opacity', 'transform']);
  }
  if (bars.length){
    bars.forEach(e => { e.style.transformOrigin = 'left center'; e.style.transform = 'scaleX(0)'; });
    run(bars, {transform:['scaleX(0)', 'scaleX(1)']},
      {duration:.9, ease:[.2, .8, .2, 1], delay:M().stagger(.04, {startDelay:.2})}, ['transform', 'transform-origin']);
  }
  rings.forEach((r, i) => {
    const to = parseFloat(r.style.getPropertyValue('--p')) || 0;
    r.style.setProperty('--p', '0');
    try {
      M().animate(0, to, {duration:1, ease:[.2, .8, .2, 1], delay:.2 + i * .05, onUpdate: v => r.style.setProperty('--p', v.toFixed(2)), onComplete: () => r.style.setProperty('--p', String(to))});
    } catch(e){ r.style.setProperty('--p', String(to)); }
    setTimeout(() => r.style.setProperty('--p', String(to)), 2500);
  });
}

/* ---------- Contadores: los montos «ruedan» hasta su valor ---------- */
const last = new Map(), ctls = new Map();
/**
 * Anima los elementos con data-count (centavos) y data-count-key. Solo anima cuando el valor cambió desde la última vez,
 * o desde cero si `fromZero` (al entrar a una vista). El texto final ya lo puso quien pintó el elemento.
 */
export function counters(root, fmt, fromZero){
  if (!root) return;
  root.querySelectorAll('[data-count]').forEach(el => {
    const key = el.dataset.countKey || el.id, to = Number(el.dataset.count);
    if (!Number.isFinite(to)) return;
    const prev = ctls.get(key); if (prev){ try { prev.stop(); } catch(e){} ctls.delete(key); }
    const from = fromZero ? 0 : (last.has(key) ? last.get(key) : 0);
    last.set(key, to);
    if (!enabled() || from === to || !el.getClientRects().length) return;
    el.textContent = fmt(from);
    try {
      ctls.set(key, M().animate(from, to, {duration:.85, ease:[.16, 1, .3, 1],
        onUpdate: v => { el.textContent = fmt(Math.round(v)); },
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
  try { M().animate(ind, {transform:[from, to], width:[fromW, w]}, {type:'spring', duration:.55, bounce:.25}); } catch(e){}
}

/* ---------- Diálogos ---------- */
const isSheet = d => d.classList.contains('sheet') && matchMedia('(max-width: 759px)').matches;
export function dialogIn(d){
  if (!enabled()) return;
  run(d, isSheet(d) ? {transform:['translateY(100%)', 'translateY(0%)']}
    : {opacity:[0, 1], transform:['translateY(22px) scale(.95)', 'translateY(0px) scale(1)']},
  {type:'spring', duration:.55, bounce:isSheet(d) ? .1 : .22}, ['opacity', 'transform']);
}
/** Resuelve al terminar la animación de salida; quien llama cierra el diálogo y limpia con clear(). */
export function dialogOut(d){
  if (!enabled()) return Promise.resolve();
  try {
    const ctl = M().animate(d, isSheet(d) ? {transform:['translateY(0%)', 'translateY(100%)']}
      : {opacity:[1, 0], transform:['translateY(0px) scale(1)', 'translateY(10px) scale(.97)']}, {duration:.2, ease:'easeIn'});
    return new Promise(ok => { if (ctl && ctl.then) ctl.then(ok, ok); else ok(); setTimeout(ok, 600); });
  } catch(e){ return Promise.resolve(); }
}
export const clear = d => settle([d], ['opacity', 'transform']);

/** Pequeño rebote para confirmar una acción (por ejemplo, al guardar un saldo). */
export function pulse(el){
  if (!enabled() || !el) return;
  run(el, {transform:['scale(1)', 'scale(1.04)', 'scale(1)']}, {duration:.45, ease:'easeOut'}, ['transform']);
}
