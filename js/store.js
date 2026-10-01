/*
 * Almacén local (fuente de verdad en el dispositivo).
 * Cada tabla es un mapa id → registro con las mismas columnas que la base de datos.
 * Los borrados son lógicos (`deleted: true`) para que se sincronicen entre dispositivos.
 * `dirty` guarda los cambios aún no subidos: id → versión local.
 */
import {uid} from './util.js';

export const TABLES = ['transactions', 'budgets', 'goals', 'recurring', 'settings'];
const KEY = 'gastos:v2';
const LEGACY_KEY = 'gastos-app:v1';

const empty = () => ({data:Object.fromEntries(TABLES.map(t => [t, {}])), dirty:Object.fromEntries(TABLES.map(t => [t, {}])), cursor:{}, owner:null, seq:0});

let db = empty();
export let storageOk = true;
const listeners = new Set();
let version = 0, monthCache = null, saveTimer = null;

export function load(){
  try {
    const raw = localStorage.getItem(KEY);
    if (raw){ const d = JSON.parse(raw); if (d && d.data) db = Object.assign(empty(), d); TABLES.forEach(t => { db.data[t] ||= {}; db.dirty[t] ||= {}; }); }
    else migrateLegacy();
  } catch(e){ storageOk = false; }
  bump();
}

/** Trae los datos de la versión anterior (un solo archivo HTML) si existen en este navegador. */
function migrateLegacy(){
  const raw = localStorage.getItem(LEGACY_KEY); if (!raw) return;
  const old = JSON.parse(raw); if (!old || !Array.isArray(old.tx) || old.sample) return;
  old.tx.forEach(t => put('transactions', {id:uid(), type:t.type, category:t.category, date:t.date, amount:t.amount, description:t.desc || '', recurring_id:null}, true));
  Object.entries(old.budgets || {}).forEach(([cat, amount]) => put('budgets', {id:cat, amount}, true));
  if (old.currency) put('settings', {id:'main', currency:old.currency}, true);
  flush();
}

function persist(){
  try { localStorage.setItem(KEY, JSON.stringify(db)); storageOk = true; }
  catch(e){ storageOk = false; }
}
/** Guarda en segundo plano (agrupa ráfagas de cambios). */
function schedule(){ clearTimeout(saveTimer); saveTimer = setTimeout(persist, 120); }
export function flush(){ clearTimeout(saveTimer); persist(); }

function bump(){ version++; monthCache = null; }
export const getVersion = () => version;
export function onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); }
function emit(origin){ bump(); listeners.forEach(fn => fn(origin)); }

/* ---------- Lectura ---------- */
export const get = (table, id) => { const r = db.data[table][id]; return r && !r.deleted ? r : null; };
export const has = (table, id) => !!db.data[table][id]; // incluye borrados
export const all = table => Object.values(db.data[table]).filter(r => !r.deleted);
export const settings = () => get('settings', 'main') || {id:'main', currency:'MXN'};

/** Movimientos agrupados por mes ('YYYY-MM'); se recalcula solo cuando cambian los datos. */
export function byMonth(key){
  if (!monthCache){
    monthCache = new Map();
    for (const t of all('transactions')){ const k = t.date.slice(0, 7); let a = monthCache.get(k); if (!a) monthCache.set(k, a = []); a.push(t); }
  }
  return monthCache.get(key) || [];
}

/* ---------- Escritura ---------- */
export function put(table, rec, silent){
  const prev = db.data[table][rec.id] || {};
  db.data[table][rec.id] = Object.assign({}, prev, rec, {deleted:false});
  db.dirty[table][rec.id] = ++db.seq;
  if (!silent){ schedule(); emit('local'); }
  return db.data[table][rec.id];
}
export function remove(table, id){
  const r = db.data[table][id]; if (!r || r.deleted) return null;
  r.deleted = true; db.dirty[table][id] = ++db.seq;
  schedule(); emit('local');
  return r;
}
export function putMany(table, recs){ recs.forEach(r => put(table, r, true)); schedule(); emit('local'); }
/** Reemplaza una tabla completa (importar respaldo): borra lógicamente lo anterior. */
export function replaceTable(table, recs){
  const keep = new Set(recs.map(r => r.id));
  Object.values(db.data[table]).forEach(r => { if (!r.deleted && !keep.has(r.id)){ r.deleted = true; db.dirty[table][r.id] = ++db.seq; } });
  recs.forEach(r => put(table, r, true));
  schedule(); emit('local');
}

/* ---------- Soporte para sincronización ---------- */
export const dirtyEntries = table => Object.entries(db.dirty[table]);
export const pendingCount = () => TABLES.reduce((n, t) => n + Object.keys(db.dirty[t]).length, 0);
export const raw = (table, id) => db.data[table][id];
/** Marca como subido solo si no cambió mientras se enviaba. */
export function markClean(table, id, ver){ if (db.dirty[table][id] === ver) delete db.dirty[table][id]; }
/** Aplica filas del servidor sin pisar cambios locales pendientes. */
export function applyRemote(table, rows){
  let changed = false;
  for (const row of rows){
    if (db.dirty[table][row.id]) continue;
    const {user_id, created_at, ...rec} = row;
    db.data[table][rec.id] = rec; changed = true;
  }
  if (changed){ schedule(); emit('remote'); }
}
export const getCursor = table => db.cursor[table] || null;
export function setCursor(table, iso){ db.cursor[table] = iso; schedule(); }
export const owner = () => db.owner;
/** Cambia de dueño: si es otra cuenta, vacía los datos locales para no mezclarlos. */
export function setOwner(id){
  if (db.owner && db.owner !== id){ db = empty(); }
  db.owner = id; flush(); emit('remote');
}
export function wipeLocal(){ db = empty(); flush(); emit('remote'); }
