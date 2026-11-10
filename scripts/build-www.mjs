/*
 * Arma la carpeta www/ que Capacitor empaqueta dentro de la app de iPhone.
 * Copia solo los archivos web de la app: sin service worker (la app ya lleva todo en el paquete,
 * así que funciona sin conexión por sí sola), sin pruebas ni archivos de servidor.
 */
import {cp, rm, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'www');
const ITEMS = ['index.html', 'manifest.webmanifest', 'css', 'js', 'fonts', 'icons', 'vendor'];

await rm(out, {recursive:true, force:true});
await mkdir(out, {recursive:true});
for (const item of ITEMS) await cp(path.join(root, item), path.join(out, item), {recursive:true});
console.log('www/ listo: ' + ITEMS.join(', '));
