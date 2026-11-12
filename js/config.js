/*
 * Conexión a Supabase. Déjalo vacío para usar la app solo en este dispositivo.
 * Ambos valores están en Supabase → Project Settings → API (o "Connect").
 * La clave publishable/anon es pública por diseño: tus datos los protege el login + Row Level Security.
 * NUNCA pongas aquí la clave secret / service_role.
 */
export const SUPABASE_URL = 'https://htbhocyphwuaahkmtkip.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_5Q5d30ukntGFX_fbUEqSsQ_eRJWsp-p';

/*
 * Clave PÚBLICA VAPID para el aviso semanal (notificación push). Déjala vacía si no quieres avisos:
 * el reporte aparece de todos modos dentro de la app. La clave privada NUNCA va aquí: es un secreto de Supabase.
 * Cómo generarla: sección «Aviso semanal» del README.
 */
export const VAPID_PUBLIC_KEY = '';
