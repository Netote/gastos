/*
 * Service worker: permite abrir la app sin conexión.
 * Estrategia "red primero" para archivos propios (siempre la versión más nueva si hay internet)
 * con respaldo en caché. Las llamadas a Supabase no se tocan.
 * También muestra el aviso semanal (push) y abre el reporte al tocarlo.
 * Cambia VERSION al publicar cambios para limpiar cachés viejas.
 */
const VERSION = 'gastos-v2.5.0';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/boot.js', 'js/app.js', 'js/util.js', 'js/store.js', 'js/sync.js', 'js/config.js', 'js/charts.js', 'js/icons.js', 'js/fx.js',
  'js/forecast.js', 'js/nlu.js', 'js/report.js', 'js/plan.js', 'js/push.js',
  'vendor/chart.umd.min.js', 'vendor/supabase.min.js', 'vendor/motion.min.js',
  'fonts/ibm-plex-sans-400.woff2', 'fonts/ibm-plex-sans-500.woff2', 'fonts/ibm-plex-sans-600.woff2', 'fonts/ibm-plex-sans-700.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(req, {signal:ctrl.signal}); clearTimeout(t);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, {ignoreSearch:true}) || (req.mode === 'navigate' && await cache.match('index.html'));
      if (hit) return hit;
      throw err;
    }
  })());
});

/* ---------- Aviso semanal ---------- */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {body:e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.title || 'Gastos · reporte semanal', {
    body:d.body || 'Tu reporte de la semana está listo.', icon:'icons/icon-192.png', badge:'icons/icon-192.png', tag:'reporte-semanal', data:{url:d.url || './#reporte'}
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './#reporte', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    if (open){ open.postMessage({type:'open-report'}); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
