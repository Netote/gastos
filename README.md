# Gastos · Control de ingresos y gastos

App web personal para llevar ingresos, gastos, presupuestos, metas de ahorro y pagos fijos.
Funciona en computadora y celular (se instala como app), sin conexión, y sincroniza tus datos entre dispositivos con tu cuenta.

## Funciones

- **Saldo actual:** cuánto dinero tienes hoy. Lo ajustas una vez con lo que traes y después se actualiza solo con cada ingreso, gasto o pago de Apple Pay. Los movimientos con fecha futura no cuentan hasta su día.
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
- **Apple Pay (iPhone):** cada pago con Wallet se registra solo, con monto, comercio y tarjeta (ver [Registro automático](#registro-automático-desde-apple-pay)).
- **Por revisar y reglas por comercio:** los gastos automáticos llegan a una bandeja; al corregir uno puedes recordar el comercio y los siguientes llegan ya categorizados.
- **Método de pago:** cada gasto puede llevar su tarjeta, y el resumen muestra cuánto gastaste por tarjeta.
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

## Registro automático desde Apple Pay

Una página web no puede leer tu Wallet, pero la app **Atajos** del iPhone sí: con una *automatización de transacción* se ejecuta cada vez que pagas con Apple Pay y manda el monto y el comercio a tu Supabase.

**Requisitos:** iOS 17 o posterior y pagar con el iPhone o el Apple Watch (no aplica a la tarjeta física ni a compras en línea con los datos de la tarjeta).

1. **Actualiza la base de datos:** vuelve a ejecutar `supabase/schema.sql` en el SQL Editor de Supabase (es idempotente) **antes** de publicar esta versión de la app.
2. En la app: **Ajustes → Apple Pay (Wallet) → Activar**. Se muestra la URL, la clave pública y tu **token secreto** (solo se ve una vez).
3. En el iPhone: **Atajos → Automatización → + → Transacción**, elige tus tarjetas y activa *Ejecutar inmediatamente*.
4. Agrega **Obtener contenido de URL** con método **POST**:
   - URL: la que muestra la app (`…/rest/v1/rpc/ingest_wallet`).
   - Encabezados: `apikey` = la clave pública, `Content-Type` = `application/json`.
   - Cuerpo JSON (todos Texto): `p_token` = tu token, `p_amount` = *Monto*, `p_merchant` = *Comerciante*, `p_card` = nombre de la *Tarjeta o pase*, y opcional `p_date` = fecha actual con formato `yyyy-MM-dd`.
5. Haz un pago de prueba: en un minuto aparece en **Gastos por revisar**.

Cómo funciona y qué esperar:
- El token no es tu contraseña: solo permite **agregar gastos** a tu cuenta, nada más. En la base solo se guarda su huella SHA-256. Si se filtra, **genera uno nuevo** (el anterior deja de servir) o desactívalo desde Ajustes.
- Si el comercio ya tiene una regla, el gasto llega categorizado y confirmado. Si no, entra como *Otros gastos* **por revisar**.
- Las reglas ignoran los números de sucursal: «OXXO 4521 CDMX» y «OXXO 77 CDMX» son el mismo comercio.
- Los reembolsos (montos negativos) se rechazan; si el mismo cargo llega dos veces en menos de 45 segundos, se ignora el duplicado.
- Si no mandas `p_date`, se usa la fecha de Ciudad de México.
- Los nombres exactos de las variables de la transacción (*Monto*, *Comerciante*, *Tarjeta o pase*) pueden variar un poco según la versión de iOS. Si el monto llega vacío con algún banco, el registro falla y Atajos lo muestra: el gasto se captura a mano.

## Mantenimiento

- **Publicar cambios:** sube la versión en `VERSION` dentro de `sw.js` para que los celulares descarguen lo nuevo.
- **Pruebas:** `npm test` (utilidades). Las funciones SQL de Wallet se pueden probar contra un Postgres local ejecutando `supabase/schema.sql`.
- **Plan gratuito de Supabase:** el proyecto se pausa tras 7 días sin uso. Se reactiva desde el panel y **no se pierden datos**. Igual conviene exportar un respaldo JSON de vez en cuando.
- **Dominio propio de Supabase:** si lo usas, agrégalo a `connect-src` en la etiqueta CSP de `index.html`.
