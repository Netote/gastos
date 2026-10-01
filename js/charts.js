/* Gráficas con Chart.js (cargado con `defer` desde vendor/). */
const charts = {};
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const available = () => typeof window.Chart !== 'undefined';

export function palette(){
  const C = {text:css('--text'), muted:css('--muted'), grid:css('--grid'), income:css('--income'), expense:css('--expense'), primary:css('--primary'), gap:css('--donut-gap')};
  if (available()){
    Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
    Chart.defaults.color = C.muted;
    Chart.defaults.animation = reduce() ? false : {duration:450};
  }
  return C;
}
export function upsert(key, canvas, cfg){
  if (!available()) return;
  const ex = charts[key];
  if (ex && ex.canvas === canvas){ ex.data = cfg.data; ex.options = cfg.options; ex.update(); }
  else { if (ex) ex.destroy(); charts[key] = new Chart(canvas, cfg); }
}
export function drop(key){ if (charts[key]){ charts[key].destroy(); delete charts[key]; } }
export function dropAll(){ Object.keys(charts).forEach(drop); }
/** Chart.js no detecta bien el tamaño de un canvas que estaba oculto: se fuerza al mostrar la vista. */
export function resizeAll(){ Object.values(charts).forEach(c => c.resize()); }
