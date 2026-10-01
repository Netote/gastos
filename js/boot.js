/* Aplica el tema guardado antes de pintar, para evitar un parpadeo de color. */
try {
  var t = localStorage.getItem('gastos:theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
