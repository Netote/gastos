# Gastos · Control de ingresos y gastos

App web personal para llevar ingresos, gastos, presupuestos, metas de ahorro y pagos fijos.
Funciona en computadora y celular (se instala como app), sin conexión, y sincroniza tus datos entre dispositivos con tu cuenta.

## Funciones

- **Resumen del mes:** ingresos, gastos, balance y tasa de ahorro, con comparación contra el mes anterior.
- **Indicadores:**
  - proyección de cierre de mes (gastos fijos más el ritmo de los variables);
  - regla 50/30/20;
  - meses cubiertos por tu fondo de emergencia;
  - alertas de presupuesto al 80 %;
  - próximos pagos fijos.
- **Gráficas:** gastos por categoría, ingresos contra gastos de los últimos 6 meses y flujo acumulado del mes.
- **Movimientos:** búsqueda, filtros, agrupación por día, edición y eliminación con opción de deshacer.
- **Presupuestos:** límite mensual por categoría.
- **Metas de ahorro:** avance y monto sugerido por mes según la fecha límite.
- **Fijos:** renta, suscripciones, quincena y meses sin intereses. Se registran solos el día que toca y se detienen al llegar al número de pagos.
- **Respaldo:** exportar a CSV o JSON e importar un JSON (también acepta el formato de la versión anterior).
- **Uso diario:** tema claro y oscuro, PWA instalable y funcionamiento sin conexión.

## Arquitectura

```
Navegador (GitHub Pages, archivos estáticos)
  ├─ localStorage  ← fuente de verdad en el dispositivo (funciona sin internet)
  └─ Supabase      ← PostgreSQL + login; sincroniza cambios pendientes ↔ servidor
```

- No hay servidor propio. Supabase es la base de datos y el login, y la seguridad la pone **Row Level Security**: cada usuario solo puede leer y escribir sus filas (`supabase/schema.sql`).
- Montos en **centavos** (enteros) para evitar errores de redondeo.
- **Sincronización "offline first":** los cambios se guardan en el dispositivo y se suben al recuperar conexión. Los borrados son lógicos (`deleted`) para que también se propaguen.
- **Movimientos de fijos con id determinista** (`r_<regla>_<AAAAMM>`): aunque dos dispositivos los generen a la vez, nunca se duplican.

```
index.html            Estructura y diálogos
css/app.css           Estilos (tokens, modo oscuro, móvil)
js/app.js             Interfaz y eventos
js/util.js            Lógica pura: fechas, montos, indicadores (con pruebas)
js/store.js           Almacén local y cola de cambios
js/sync.js            Login y sincronización con Supabase
js/config.js          ← aquí van tu URL y clave de Supabase
sw.js                 Service worker (uso sin conexión)
supabase/schema.sql   Tablas, índices, triggers y políticas RLS
tests/                Pruebas (npm test)
```

## Puesta en marcha

### 1. Probar en tu computadora

Con Docker:

```bash
docker compose up -d        # abre http://localhost:8080
```

Con Node:

```bash
npm run dev
```

Sin `js/config.js` configurado, la app funciona en **modo local**: los datos se guardan solo en ese navegador.

### 2. Crear la base de datos (Supabase, gratis)

1. Crea una cuenta en https://supabase.com y un proyecto nuevo. Elige la región más cercana (por ejemplo, `East US`).
2. Ve a **SQL Editor**, pega todo el contenido de `supabase/schema.sql` y ejecútalo.
3. Ve a **Project Settings → API**. Copia la **Project URL** y la clave **publishable** (o `anon`) en `js/config.js`:
   ```js
   export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   export const SUPABASE_KEY = 'sb_publishable_...';
   ```
   La clave publishable es pública por diseño. **Nunca** pongas la clave `secret` ni la `service_role`.
4. Ve a **Authentication → URL Configuration** y en **Site URL** pon la dirección de tu GitHub Pages, por ejemplo `https://TU-USUARIO.github.io/gastos/`. Agrégala también en *Redirect URLs*.
5. Abre la app, crea tu cuenta y confirma el correo.
6. **Recomendado:** ve a **Authentication → Sign In / Providers** y desactiva *Allow new users to sign up*. Así nadie más puede crear cuentas en tu proyecto.

### 3. Publicar en GitHub Pages

```bash
gh repo create gastos --public --source=. --push
gh api repos/{owner}/gastos/pages -X POST -f "source[branch]=main" -f "source[path]=/"
```

También se puede hacer desde GitHub: **Settings → Pages → Deploy from a branch → main / (root)**. En uno o dos minutos queda en `https://TU-USUARIO.github.io/gastos/`.

### 4. Instalar en el celular

- **Android (Chrome):** abre la URL → menú ⋮ → *Instalar app*.
- **iPhone (Safari):** abre la URL → Compartir → *Agregar a pantalla de inicio*.

La sesión queda guardada; solo inicias sesión una vez por dispositivo.

## Mantenimiento

- **Publicar cambios:** sube la versión en `VERSION` dentro de `sw.js` para que los celulares descarguen lo nuevo.
- **Pruebas:** `npm test`.
- **Plan gratuito de Supabase:** el proyecto se pausa tras 7 días sin uso. Se reactiva desde el panel y **no se pierden datos**. Igual conviene exportar un respaldo JSON de vez en cuando.
- **Dominio propio de Supabase:** si lo usas, agrégalo a `connect-src` en la etiqueta CSP de `index.html`.
