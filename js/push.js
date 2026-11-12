/*
 * Aviso semanal por notificación push (Web Push).
 * El navegador crea una suscripción con la clave pública VAPID; se guarda en Supabase (tabla push_subscriptions) y la
 * función programada `weekly-push` la usa cada lunes. Sin clave configurada, el reporte sigue apareciendo dentro de la app.
 */
import {VAPID_PUBLIC_KEY} from './config.js';
import * as sync from './sync.js';

export const configured = !!VAPID_PUBLIC_KEY && sync.enabled;
export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const permission = () => supported() ? Notification.permission : 'unsupported';

const bytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
/** El service worker activo; falla con un mensaje claro si no está (p. ej. la app no se sirve por HTTPS). */
function registration(){
  return Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('La app aún no termina de instalarse. Ciérrala, ábrela de nuevo e inténtalo otra vez.')), 6000))]);
}

/** Suscripción de este dispositivo, o null. */
export async function current(){
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}
export async function enable(){
  if (await Notification.requestPermission() !== 'granted') throw new Error('denied');
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:bytes(VAPID_PUBLIC_KEY)});
  const j = sub.toJSON();
  try { await sync.savePush({endpoint:j.endpoint, p256dh:j.keys.p256dh, auth:j.keys.auth}); }
  catch(e){ await sub.unsubscribe().catch(() => {}); throw e; } // sin registro en el servidor no llegaría nada: no dejarla a medias
  return sub;
}
export async function disable(){
  const sub = await current(); if (!sub) return;
  await sync.removePush(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}
/** Muestra un aviso local idéntico al semanal, para comprobar permisos y cómo se ve. */
export async function test(){
  const reg = await registration();
  await reg.showNotification('Gastos · reporte semanal', {body:'Así se verá el aviso de cada lunes. Toca para abrir tu reporte.', icon:'icons/icon-192.png', badge:'icons/icon-192.png', tag:'reporte-semanal', data:{url:'./#reporte'}});
}
