# Gastos · Control de ingresos y gastos

App web personal para llevar ingresos, gastos, presupuestos, metas de ahorro y pagos fijos.
Funciona en computadora y celular (se instala como app), **sin conexión**, y sincroniza tus datos entre dispositivos con tu cuenta.
Cada compra con tarjeta puede registrarse sola en tu iPhone a partir del aviso de tu banco.

Versión publicada: https://netote.github.io/gastos/

## Funciones

- **Saldo actual:** cuánto dinero tienes hoy. Lo ajustas una vez con lo que traes y después se actualiza solo con cada ingreso o gasto. Los movimientos con fecha futura no cuentan hasta su día.
- **Resumen del mes:** ingresos, gastos, balance y tasa de ahorro, con comparación contra el mes anterior.
- **Indicadores:**
  - proyección de cierre de mes (gastos fijos más el ritmo de los variables);
  - regla 50/30/20;
  - meses cubiertos por tu fondo de emergencia;
  - alertas de presupuesto al 80 %;
  - gasto por tarjeta;
  - próximos pagos fijos.
- **Gráficas:** gastos por categoría, ingresos contra gastos de los últimos 6 meses y flujo acumulado del mes.
- **Movimientos:** búsqueda, filtros, agrupación por día, edición y eliminación con opción de deshacer.
- **Presupuestos:** límite mensual por categoría.
- **Metas de ahorro:** avance y monto sugerido por mes según la fecha límite.
- **Fijos:** renta, suscripciones, quincena y meses sin intereses. Se registran solos el día que toca y se detienen al llegar al número de pagos.
- **Registro automático (iPhone):** cada compra con tarjeta se registra sola desde el aviso de tu banco; los pagos con Apple Pay sirven de respaldo. Ver [Registro automático](#registro-automático-de-gastos-iphone).
- **Por revisar y reglas por comercio:** los gastos automáticos llegan a una bandeja; al corregir uno puedes recordar el comercio y los siguientes llegan ya categorizados.
- **Método de pago:** cada gasto puede llevar su tarjeta.
- **Respaldo:** exportar a CSV o JSON e importar un JSON (también acepta el formato de la versión anterior).
- **Sin conexión:** abre, muestra tus datos y deja capturar gastos sin internet; todo se sube solo al volver la red. Funciona incluso si tu sesión caducó mientras no tenías conexión.
- **Diseño de vidrio:** superficies translúcidas con desenfoque, barra inferior flotante en el móvil y animaciones con resorte. Ver [Diseño y animaciones](#diseño-y-animaciones).
- **Uso diario:** tema claro y oscuro e instalación como app (PWA).

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
css/app.css           Estilos (tokens de vidrio, modo oscuro, móvil)
js/app.js             Interfaz y eventos
js/fx.js              Animaciones (Motion)
js/util.js            Lógica pura: fechas, montos, indicadores (con pruebas)
js/store.js           Almacén local y cola de cambios
js/sync.js            Login y sincronización con Supabase
js/charts.js          Gráficas (Chart.js)
js/icons.js           Iconos
js/config.js          ← aquí van tu URL y clave de Supabase
sw.js                 Service worker (uso sin conexión)
vendor/               Librerías propias del sitio: Chart.js, Supabase, Motion
supabase/schema.sql   Tablas, índices, triggers, políticas RLS y funciones de registro automático
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
- **iPhone (Safari):** abre la URL → Compartir → *Agregar a pantalla de inicio*. Abre siempre la app desde ese icono.

La sesión queda guardada; solo inicias sesión una vez por dispositivo.

## Registro automático de gastos (iPhone)

Una página web no puede leer tu Wallet ni tus notificaciones, pero la app **Atajos** del iPhone sí. Un atajo envía el texto del aviso (o el pago) a una función de tu Supabase, que lo interpreta y crea el gasto en **Gastos por revisar**. Hay dos fuentes y conviene tener las dos:

| Fuente | Cubre | Notas |
|---|---|---|
| **A. Aviso del banco** (principal) | Cualquier compra con tarjeta: física, en línea o con Apple Pay | Depende de que tu banco mande un aviso por cada compra. Solo se ha probado con BBVA México. |
| **B. Apple Pay / Wallet** (respaldo) | Solo pagos físicos con el iPhone o el Apple Watch (NFC) | A veces no se ejecuta; por eso es respaldo. |

Si una misma compra llega por las dos, se guarda **una sola vez**.

**Requisitos:** iPhone con **iOS 27** (los nombres de abajo son los de esa versión, en inglés si tu teléfono está en inglés: en iOS 27 ya no hay pestaña de automatizaciones, el disparador es un bloque del propio atajo), la app Atajos y la base de datos configurada.

### Paso 0 · Preparar (una sola vez)

1. **Actualiza la base de datos:** ejecuta de nuevo `supabase/schema.sql` en el SQL Editor de Supabase (es idempotente y no borra datos).
2. En la app: **Ajustes → Registro automático → Activar**. Se muestran la **URL**, la **clave pública** y tu **token secreto**. El token **solo se ve una vez**: cópialo y guárdalo.

### Opción A · Aviso del banco (principal)

1. En **Atajos** toca **+** para crear un atajo nuevo.
2. Agrega el disparador **When I receive a notification**. Elige la app de tu banco y agrega el filtro **Title contains** `Compra`. Deja **Automation** encendido y **Confirm Before Run** apagado (si lo enciendes, pregunta en cada compra). **Notify** es opcional.
3. Agrega la acción **Get contents of** (URL) y pega la dirección que muestra la app, pero terminada en `/rest/v1/rpc/ingest_notification`.
4. Toca la flecha **›** de la acción y pon **Method** en **POST**.
5. En **Headers** agrega dos encabezados y no dejes filas vacías:
   - `apikey` = la clave pública;
   - `Content-Type` = `application/json`.
6. En **Request Body** elige **JSON** y agrega dos campos de tipo **Text**:
   - `p_token` = tu token;
   - `p_text` = la variable **Notification › Body**. Para elegirla, toca el valor, busca la variable **Notification** en la barra de variables y toca la propiedad **Body**.
7. **No uses `Title`** para `p_text`: solo trae «Compra con…», sin monto ni comercio. **No escribas el token en la caja de Siri ni en «Describe a shortcut»**: pégalo a mano en el editor.
8. Con la siguiente compra, el gasto aparece en **Gastos por revisar**.

El servidor extrae monto, comercio, tarjeta y fecha; no necesitas separar nada en el atajo. Ejemplo de aviso reconocido (BBVA México):

```
Compra con TDD 0000 en COMERCIO EJEMPLO $349.00 10 noviembre 15:49h
```

### Opción B · Apple Pay / Wallet (respaldo)

1. Crea otro atajo y agrega el disparador **When Any Card is tapped**; elige tus tarjetas y deja **Confirm Before Run** apagado.
2. Agrega **Get contents of** (URL) con la dirección terminada en `/rest/v1/rpc/ingest_wallet`, **Method** `POST` y los mismos dos encabezados.
3. En **Request Body → JSON**, campos de tipo **Text**:
   - `p_token` = tu token;
   - `p_amount` = variable **Amount**;
   - `p_merchant` = variable **Merchant**;
   - `p_card` = variable **Card or Pass**;
   - opcional `p_date` = fecha actual con formato `yyyy-MM-dd`.
4. Haz un pago pequeño con Apple Pay: en un minuto aparece en **Gastos por revisar**.

### Probar sin esperar una compra

Agrega **Show Content** (con **Contents of URL**) al final del atajo y toca **▶**. Quítalo después.

- Sin datos, el atajo de aviso responde `{"ignored":true,"reason":"empty"}`: la dirección, la clave y el token están bien.
- Para probar el análisis, cambia `p_text` por un texto fijo como el de arriba y vuelve a tocar **▶**. Debe responder con un `id` y `"review":true`, y el gasto aparece en **Gastos por revisar**. Bórralo desde la app y **vuelve a poner** `Notification › Body`.
- El atajo de Wallet, sin pago real, responde `invalid amount`: el servidor aceptó todo y solo rechazó el monto vacío.

### Cómo funciona y qué esperar

- **Solo compras:** depósitos, transferencias, retiros, promociones, compras rechazadas, cancelaciones y devoluciones se ignoran sin error. Los reembolsos (montos negativos) de Wallet se rechazan.
- **Sin duplicados:** reenviar el mismo texto no crea otro gasto, aunque ya lo hayas borrado. Si Wallet y el aviso llegan por la misma compra (mismo monto, con hasta 15 minutos de diferencia) queda una sola. Dos compras distintas del mismo monto se conservan como dos. Si el atajo de Wallet se dispara dos veces en menos de 45 segundos, se ignora la repetición.
- **Por revisar y reglas:** si el comercio ya tiene una regla, el gasto llega categorizado y confirmado; si no, entra como *Otros gastos* **por revisar**. Las reglas ignoran los números de sucursal: «OXXO 4521 CDMX» y «OXXO 77 CDMX» son el mismo comercio.
- **Fecha:** el aviso trae «10 noviembre» sin año: se toma el año en curso (si saliera en el futuro, el anterior). Si Wallet no manda `p_date`, se usa la fecha de Ciudad de México.
- **Sin internet:** el atajo necesita conexión en el momento de la compra. Si no la hay, ese gasto no se registra y hay que capturarlo a mano (la app sí funciona sin conexión).
- **Otros bancos:** el analizador se validó con un formato de aviso de BBVA (compra con tarjeta de débito). Si tu banco redacta distinto, el aviso se ignorará hasta que se agregue su formato en la función `ingest_notification` de `supabase/schema.sql`.

### Si algo falla

- **El gasto no aparece:** abre el historial del atajo en Atajos. Si no hay ninguna ejecución, iOS no lo disparó (revisa que **Automation** esté encendido y **Confirm Before Run** apagado, y que las notificaciones del banco estén activas). Si hay una ejecución con error, léelo.
- **`invalid token`:** el token está mal pegado (revisa que no tenga espacios) o lo regeneraste y el atajo tiene el anterior.
- **`Could not find the function … ingest_notification` / `ingest_wallet`:** falta ejecutar `supabase/schema.sql`, o el cuerpo tiene campos de más (por ejemplo, `p_amount` en el atajo del aviso).
- **`invalid amount` en Wallet con un pago real:** la variable **Amount** llegó vacía; captura el gasto a mano.
- **`{"ignored":true,"reason":"no_match"}`:** el texto no parece una compra con el formato conocido.

## Privacidad y seguridad

- El token no es tu contraseña: solo permite **agregar gastos** a tu cuenta. En la base solo se guarda su huella SHA-256. Si se filtra, **genera uno nuevo** (el anterior deja de servir) o desactívalo desde Ajustes.
- Cada usuario solo puede leer y escribir sus filas (Row Level Security). Quien administra el proyecto de Supabase puede ver el panel de la base de datos.
- **Borrar todo** en la app borra de forma lógica (los registros se marcan como eliminados). Para eliminar los datos de forma definitiva, borra la cuenta del usuario en Supabase: sus filas se borran en cascada.
- La clave `sb_publishable_…` de `js/config.js` es pública por diseño; nunca pongas ahí la `secret` ni la `service_role`.

## App de iPhone (experimental)

Existe una versión empaquetada con Capacitor en la rama [`ios-build`](https://github.com/Netote/gastos/tree/ios-build), con un flujo de GitHub Actions que compila un `.ipa` sin firmar para instalarlo desde Windows con Sideloadly. **No está en `main` ni se ha podido probar la compilación**; con un Apple ID gratuito la firma dura 7 días. La aplicación web instalada desde Safari es la versión recomendada.

## Diseño y animaciones

- **Vidrio:** los tokens están al inicio de [css/app.css](css/app.css) (`--glass`, `--glass-strong`, `--edge-*`, `--orb*`). El fondo son cuatro manchas de color (`.bg`); el borde de luz de cada superficie es un degradado de 1 px con máscara.
- **Animaciones:** [js/fx.js](js/fx.js) usa [Motion](https://motion.dev) (el motor de Framer Motion sin React), empaquetado en `vendor/motion.min.js` (MIT, ver `vendor/LICENSE-motion.txt`). Solo se animan `opacity` y `transform`. Si la librería no carga, la app funciona igual y sin movimiento.
- **Accesibilidad:** se respetan «Reducir movimiento» (sin animaciones, números finales desde el primer instante), «Reducir transparencia» (superficies sólidas, sin desenfoque) y «Aumentar contraste». En las cuatro combinaciones de tema y tamaño, los textos cumplen WCAG AA (≥ 4.5:1), medidos contra el fondo real del vidrio; el peor caso fue 5.08:1.
- **Rendimiento:** el fondo está quieto en el móvil. Mover algo detrás de tarjetas con desenfoque obliga a recalcular el desenfoque de todas en cada cuadro, y eso gasta batería. La deriva lenta de las manchas solo se activa en pantallas de 900 px o más con ratón.
- **Si cambias colores:** vuelve a comprobar el contraste. Con vidrio, el color detrás del texto cambia al desplazarse, y los acentos (rojo, verde, naranja) son los primeros en fallar.

## Mantenimiento

- **Publicar cambios:** sube la versión en `VERSION` dentro de `sw.js` (y en `package.json`) para que los celulares descarguen lo nuevo. Abre la app desde el icono, ciérrala por completo y vuelve a abrirla; a veces hace falta abrirla dos veces.
- **Pruebas:** `npm test` (utilidades). Las funciones SQL de registro automático se pueden probar contra un Postgres local ejecutando `supabase/schema.sql`.
- **Plan gratuito de Supabase:** el proyecto se pausa tras 7 días sin uso. Se reactiva desde el panel y **no se pierden datos**. Igual conviene exportar un respaldo JSON de vez en cuando.
- **Dominio propio de Supabase:** si lo usas, agrégalo a `connect-src` en la etiqueta CSP de `index.html`.
