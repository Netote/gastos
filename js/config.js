/*
 * Conexión a Supabase. Déjalo vacío para usar la app solo en este dispositivo.
 * Ambos valores están en Supabase → Project Settings → API (o "Connect").
 * La clave publishable/anon es pública por diseño: tus datos los protege el login + Row Level Security.
 * NUNCA pongas aquí la clave secret / service_role.
 */
export const SUPABASE_URL = 'https://htbhocyphwuaahkmtkip.supabase.co';
/* Dirección pública de la versión web. La app de iPhone la usa en los enlaces de los correos (confirmar cuenta, recuperar contraseña). */
export const APP_URL = 'https://netote.github.io/gastos/';
export const SUPABASE_KEY = 'sb_publishable_5Q5d30ukntGFX_fbUEqSsQ_eRJWsp-p';
