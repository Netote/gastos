/*
 * Aviso semanal de Gastos (Supabase Edge Function, Deno).
 * La llama cada lunes la tarea de supabase/cron.sql. Para cada usuario con dispositivos suscritos calcula cuánto
 * gastó en la semana que acaba de cerrar (lunes a domingo, hora de Ciudad de México) y envía una notificación push.
 * El reporte completo se calcula en la app; aquí solo va el titular.
 *
 * Secretos necesarios (Supabase → Edge Functions → Secrets):
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  claves de Web Push (la pública es la misma de js/config.js)
 *   VAPID_SUBJECT                        mailto:tu-correo o la URL de tu app
 *   CRON_SECRET                          cadena larga al azar; la tarea programada la manda en x-cron-secret
 * SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase.
 * Despliegue: supabase functions deploy weekly-push --no-verify-jwt
 */
import webpush from 'npm:web-push@3.6.7';
import {createClient} from 'npm:@supabase/supabase-js@2';

const env = (k: string) => Deno.env.get(k) ?? '';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json'}});
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Lunes y domingo de la última semana completa, y lunes de la anterior, en hora de Ciudad de México. */
function lastWeek(now = new Date()){
  const local = new Date(now.toLocaleString('en-US', {timeZone:'America/Mexico_City'}));
  const today = new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 864e5);
  return {start:iso(new Date(monday.getTime() - 7 * 864e5)), end:iso(new Date(monday.getTime() - 864e5)), prev:iso(new Date(monday.getTime() - 14 * 864e5))};
}

Deno.serve(async req => {
  const secret = env('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({error:'forbidden'}, 403);
  if (!env('VAPID_PUBLIC_KEY') || !env('VAPID_PRIVATE_KEY')) return json({error:'faltan las claves VAPID'}, 500);
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {auth:{persistSession:false}});

  const {data:subs, error} = await db.from('push_subscriptions').select('user_id, endpoint, p256dh, auth');
  if (error) return json({error:error.message}, 500);
  if (!subs || !subs.length) return json({sent:0, users:0});

  const w = lastWeek(), users = [...new Set(subs.map(s => s.user_id))];
  const spent = new Map<string, {cur:number, prev:number}>(users.map(u => [u, {cur:0, prev:0}]));
  for (let from = 0; ; from += 1000){
    const {data, error:e} = await db.from('transactions').select('user_id, amount, date')
      .in('user_id', users).eq('type', 'expense').eq('deleted', false).gte('date', w.prev).lte('date', w.end).order('id').range(from, from + 999);
    if (e) return json({error:e.message}, 500);
    for (const t of data ?? []){ const s = spent.get(t.user_id); if (s){ if (t.date >= w.start) s.cur += Number(t.amount); else s.prev += Number(t.amount); } }
    if (!data || data.length < 1000) break;
  }
  const {data:prefs} = await db.from('settings').select('user_id, currency').in('user_id', users).eq('id', 'main');
  const currency = new Map((prefs ?? []).map(p => [p.user_id, p.currency]));

  let sent = 0; const gone: {user_id:string, endpoint:string}[] = [], failed: string[] = [];
  await Promise.all(subs.map(async s => {
    const t = spent.get(s.user_id)!, fmt = new Intl.NumberFormat('es-MX', {style:'currency', currency:currency.get(s.user_id) || 'MXN', maximumFractionDigits:0});
    const diff = t.prev > 0 ? Math.round((t.cur - t.prev) / t.prev * 100) : null;
    const body = t.cur === 0 ? 'No registraste gastos esta semana. Toca para ver tu reporte y lo que viene.'
      : 'Gastaste ' + fmt.format(t.cur / 100) + ' esta semana' + (diff === null || diff === 0 ? '' : ' (' + Math.abs(diff) + '% ' + (diff > 0 ? 'más' : 'menos') + ' que la anterior)') + '. Toca para ver tu reporte.';
    try {
      await webpush.sendNotification({endpoint:s.endpoint, keys:{p256dh:s.p256dh, auth:s.auth}}, JSON.stringify({title:'Tu reporte semanal está listo', body, url:'./#reporte'}), {TTL:60 * 60 * 24 * 2});
      sent++;
    } catch (err){
      const code = (err as {statusCode?:number}).statusCode;
      if (code === 404 || code === 410) gone.push({user_id:s.user_id, endpoint:s.endpoint}); // el dispositivo ya no existe o quitó el permiso
      else failed.push(String(code ?? (err as Error).message));
    }
  }));
  for (const g of gone) await db.from('push_subscriptions').delete().eq('user_id', g.user_id).eq('endpoint', g.endpoint);
  return json({week:w, users:users.length, sent, removed:gone.length, failed});
});
