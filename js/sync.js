/*
 * Sincronización con Supabase (PostgreSQL + Auth).
 * Estrategia "offline first": todo se guarda primero en el dispositivo y luego
 *   1) se suben los cambios pendientes (upsert por user_id+id),
 *   2) se descargan las filas con updated_at posterior al último cursor.
 * El servidor fija updated_at con un trigger, así que el cursor no depende del reloj del teléfono.
 */
import {SUPABASE_URL, SUPABASE_KEY} from './config.js';
import * as store from './store.js';

export const enabled = !!(SUPABASE_URL && SUPABASE_KEY);
// El enlace de "olvidé mi contraseña" vuelve a la app con type=recovery en la URL.
let recovery = /type=recovery/.test(location.hash + location.search);
export const isRecovery = () => recovery;
let client = null, user = null, running = false, again = false, timer = null, pulledOnce = false;
const listeners = new Set();
export const status = {state:enabled ? 'idle' : 'local', last:null, error:''};
export const onStatus = fn => { listeners.add(fn); return () => listeners.delete(fn); };
function set(state, error = ''){ status.state = state; status.error = error; if (state === 'ok') status.last = new Date(); listeners.forEach(fn => fn(status)); }
export const currentUser = () => user;
/** true cuando ya se descargaron datos del servidor en esta sesión (o no hay nube). */
export const ready = () => !enabled || pulledOnce;

function loadLib(){
  if (window.supabase) return Promise.resolve();
  return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = 'vendor/supabase.min.js'; s.onload = ok; s.onerror = () => fail(new Error('No se pudo cargar la librería de Supabase')); document.head.appendChild(s); });
}

/** Inicia el cliente y devuelve el usuario con sesión guardada (o null). */
export async function init(onAuth){
  if (!enabled) return null;
  await loadLib();
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storageKey:'gastos:auth'}});
  const {data} = await client.auth.getSession();
  user = data.session ? data.session.user : null;
  // Supabase recomienda no llamar a la API dentro de este callback: se difiere con setTimeout.
  client.auth.onAuthStateChange((event, session) => {
    const next = session ? session.user : null;
    if (event === 'PASSWORD_RECOVERY'){ recovery = true; user = next; setTimeout(() => onAuth(user, event)); return; }
    if ((next && next.id) === (user && user.id)) { user = next; return; }
    user = next; pulledOnce = false; setTimeout(() => onAuth(user, event));
  });
  return user;
}

export async function signIn(email, password){
  const {data, error} = await client.auth.signInWithPassword({email, password});
  if (error) throw error; return data.user;
}
export async function signUp(email, password){
  const {data, error} = await client.auth.signUp({email, password, options:{emailRedirectTo:location.origin + location.pathname}});
  if (error) throw error; return {user:data.user, needsConfirm:!data.session};
}
export async function resetPassword(email){
  const {error} = await client.auth.resetPasswordForEmail(email, {redirectTo:location.origin + location.pathname});
  if (error) throw error;
}
export async function updatePassword(password){
  const {error} = await client.auth.updateUser({password});
  if (error) throw error; history.replaceState(null, '', location.pathname); recovery = false;
}
/* ---------- Token para registrar gastos desde Apple Pay (ver supabase/schema.sql) ---------- */
async function rpc(name){
  if (!client || !user) throw new Error('Inicia sesión para continuar.');
  const {data, error} = await client.rpc(name);
  if (error) throw error; return data;
}
/** Fecha (ISO) del token actual, o null si no hay. */
export const walletTokenInfo = () => rpc('ingest_token_info');
/** Crea o reemplaza el token; el valor solo se obtiene en este momento. */
export const createWalletToken = () => rpc('create_ingest_token');
export const revokeWalletToken = () => rpc('revoke_ingest_token');
export const apiConfig = () => ({url:SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/ingest_wallet', key:SUPABASE_KEY});

export async function signOut(){ user = null; pulledOnce = false; await client.auth.signOut(); }

const PAGE = 1000;
// Columnas que la app escribe en cada tabla (las demás las pone el servidor).
const COLS = {
  transactions:['id', 'type', 'category', 'amount', 'date', 'description', 'recurring_id', 'created', 'source', 'merchant', 'card', 'review', 'deleted'],
  budgets:['id', 'amount', 'deleted'],
  goals:['id', 'name', 'target', 'saved', 'deadline', 'color', 'deleted'],
  recurring:['id', 'name', 'type', 'category', 'amount', 'day', 'start_month', 'occurrences', 'active', 'deleted'],
  settings:['id', 'currency', 'deleted'],
  merchant_rules:['id', 'name', 'category', 'deleted']
};
const toRow = (table, rec) => {
  const row = {user_id:user.id};
  for (const c of COLS[table]) row[c] = rec[c] === undefined ? null : rec[c];
  if (table === 'transactions') row.review = rec.review === true; // la columna no admite null
  return row;
};
async function push(){
  for (const table of store.TABLES){
    const entries = store.dirtyEntries(table);
    for (let i = 0; i < entries.length; i += 500){
      const chunk = entries.slice(i, i + 500);
      const rows = chunk.map(([id]) => toRow(table, store.raw(table, id)));
      const {error} = await client.from(table).upsert(rows, {onConflict:'user_id,id'});
      if (error) throw error;
      chunk.forEach(([id, ver]) => store.markClean(table, id, ver));
    }
  }
}
async function pull(){
  for (const table of store.TABLES){
    const cur = store.getCursor(table);
    // Margen de 5 s para no perder filas confirmadas casi al mismo tiempo; aplicar dos veces es inofensivo.
    // Postgres devuelve microsegundos; se recortan a milisegundos para que Safari pueda leer la fecha.
    const since = cur ? new Date(new Date(cur.replace(/(\.\d{3})\d+/, '$1')).getTime() - 5000).toISOString() : '1970-01-01T00:00:00Z';
    let from = 0, max = cur;
    for (;;){
      const {data, error} = await client.from(table).select('*').gte('updated_at', since).order('updated_at').order('id').range(from, from + PAGE - 1);
      if (error) throw error;
      store.applyRemote(table, data);
      data.forEach(r => { if (!max || r.updated_at > max) max = r.updated_at; });
      if (data.length < PAGE) break;
      from += PAGE;
    }
    if (max) store.setCursor(table, max);
  }
}

/** Ejecuta un ciclo completo; si se pide otro mientras corre, se encadena. */
export async function sync(){
  if (!enabled || !client || !user) return;
  if (running){ again = true; return; }
  if (!navigator.onLine){ set('offline'); return; }
  running = true; set('syncing');
  try {
    await push(); await pull(); pulledOnce = true;
    set(store.pendingCount() ? 'pending' : 'ok');
  } catch(e){
    set(navigator.onLine ? 'error' : 'offline', e && e.message ? e.message : String(e));
  } finally {
    running = false;
    if (again){ again = false; soon(); }
  }
}
/** Agrupa cambios rápidos en una sola subida. */
export function soon(ms = 1200){ clearTimeout(timer); timer = setTimeout(sync, ms); }
