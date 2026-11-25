/* Aplica el tema guardado antes de pintar, para evitar un parpadeo de color. */
try {
  var t = localStorage.getItem('gastos:theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  if (localStorage.getItem('gastos:bg') === 'plain') document.documentElement.setAttribute('data-bg', 'plain');
} catch (e) {}
