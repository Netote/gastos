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
- **Diseño de vidrio:** superficies translúcidas con desenfoque, barra inferior flotante en el móvil y animaciones con resorte (entrada en cascada, contadores que ruedan, indicador de pestaña deslizante, diálogos). Ver [Diseño y animaciones](#diseño-y-animaciones).
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

**Requisitos:** iPhone con iOS 17 o posterior (los pasos de abajo son los de iOS 27; en versiones anteriores el disparador se llama *Transacción* o *Wallet* y está en la pestaña Automatización) y pagar con el iPhone o el Apple Watch (no aplica a la tarjeta física ni a compras en línea con los datos de la tarjeta).

1. **Actualiza la base de datos:** vuelve a ejecutar `supabase/schema.sql` en el SQL Editor de Supabase (es idempotente) **antes** de publicar esta versión de la app.
2. En la app: **Ajustes → Apple Pay (Wallet) → Activar**. Se muestra la URL, la clave pública y tu **token secreto** (solo se ve una vez).
3. En el iPhone (**iOS 27**): abre **Atajos → Nuevo atajo**. Ya no hay pestaña de automatizaciones: el disparador es un bloque del propio atajo. Agrega **When Any Card is tapped** y elige tus tarjetas (si no lo encuentras, descríbelo en *Describe a shortcut*: «cuando pague con Apple Pay»). Verifica que corra solo, sin pedir confirmación.
4. Agrega **Get contents of** (URL) con método **POST**:
   - URL: la que muestra la app (`…/rest/v1/rpc/ingest_wallet`).
   - Headers: `apikey` = la clave pública, `Content-Type` = `application/json`. Sin filas vacías.
   - Request Body → JSON: `p_token` = tu token, `p_amount` = *Amount*, `p_merchant` = *Merchant*, `p_card` = *Card or Pass*, y opcional `p_date` = fecha actual con formato `yyyy-MM-dd`.
   - **Pega el token a mano en el editor**; no lo escribas en la caja de Siri.
   - Prueba sin pagar: toca ▶ (con **Show Content** al final para ver la respuesta). Debe decir `invalid amount`: el servidor aceptó todo y solo rechazó el monto vacío. Quita **Show Content** después.
5. Haz un pago de prueba: en un minuto aparece en **Gastos por revisar**.

Cómo funciona y qué esperar:
- El token no es tu contraseña: solo permite **agregar gastos** a tu cuenta, nada más. En la base solo se guarda su huella SHA-256. Si se filtra, **genera uno nuevo** (el anterior deja de servir) o desactívalo desde Ajustes.
- Si el comercio ya tiene una regla, el gasto llega categorizado y confirmado. Si no, entra como *Otros gastos* **por revisar**.
- Las reglas ignoran los números de sucursal: «OXXO 4521 CDMX» y «OXXO 77 CDMX» son el mismo comercio.
- Los reembolsos (montos negativos) se rechazan; si el mismo cargo llega dos veces en menos de 45 segundos, se ignora el duplicado.
- Si no mandas `p_date`, se usa la fecha de Ciudad de México.
- Las variables del disparador son *Amount*, *Merchant* y *Card or Pass*. Si alguna llega vacía, el registro falla y Atajos lo muestra: el gasto se captura a mano.

### Respaldo: el aviso de tu banco

El disparador de Wallet solo ve pagos físicos con NFC y a veces no se ejecuta. El aviso que el banco manda por **cada compra** cubre también tarjeta física y compras en línea, así que sirve como segunda fuente.

1. **Vuelve a ejecutar `supabase/schema.sql`** en Supabase (agrega columnas y la función `ingest_notification`; es idempotente).
2. En el iPhone crea **otro atajo** con el disparador de **notificación** (iOS 27) de la app de tu banco y la acción **Get contents of** (URL) con método **POST**, mismos encabezados que el atajo de Wallet y la dirección terminada en `/rest/v1/rpc/ingest_notification`.
3. Cuerpo JSON: `p_token` (el mismo token) y `p_text` (el mensaje de la notificación). Opcional: `p_title` y `p_card`.

El servidor extrae monto, comercio, tarjeta y fecha. Ejemplo reconocido (BBVA México):
`Compra con TDD 1985 en ANTHROPIC* CLAUDE $349.00 10 noviembre 15:49h`

- Solo se registran **compras**. Depósitos, transferencias, retiros, promociones, compras rechazadas, cancelaciones y devoluciones se ignoran sin error.
- **No se duplica:** reenviar el mismo texto no crea otro gasto, y si Wallet y el aviso llegan por la misma compra (mismo monto, hasta 15 minutos de diferencia) queda una sola. Dos compras distintas del mismo monto se conservan como dos.
- Si el comercio ya tiene una regla, llega categorizado. Si no, entra **por revisar**.
- El aviso trae «10 noviembre» sin año: se toma el año en curso (si saliera en el futuro, el anterior).
- Solo se probó con ese formato de aviso. Si el banco redacta otro tipo de compra distinto, se ignorará hasta agregar su formato en `ingest_notification`.
- No se ha confirmado que el disparador de notificaciones de iOS 27 entregue el texto completo al atajo: se comprueba con una compra real.

## Diseño y animaciones

- **Vidrio:** los tokens están al inicio de [css/app.css](css/app.css) (`--glass`, `--glass-strong`, `--edge-*`, `--orb*`). El fondo son cuatro manchas de color (`.bg`); el borde de luz de cada superficie es un degradado de 1 px con máscara.
- **Animaciones:** [js/fx.js](js/fx.js) usa [Motion](https://motion.dev) (el motor de Framer Motion sin React), empaquetado en `vendor/motion.min.js` (MIT, ver `vendor/LICENSE-motion.txt`). Solo se animan `opacity` y `transform`. Si la librería no carga, la app funciona igual y sin movimiento.
- **Accesibilidad:** se respetan «Reducir movimiento» (sin animaciones, números finales desde el primer instante), «Reducir transparencia» (superficies sólidas, sin desenfoque) y «Aumentar contraste». En las cuatro combinaciones de tema y tamaño, los textos cumplen WCAG AA (≥ 4.5:1), medidos contra el fondo real del vidrio; el peor caso fue 5.1:1.
- **Rendimiento:** el fondo está quieto en el móvil. Mover algo detrás de tarjetas con desenfoque obliga a recalcular el desenfoque de todas en cada cuadro, y eso gasta batería. La deriva lenta de las manchas solo se activa en pantallas de 900 px o más con ratón.
- **Si cambias colores:** vuelve a comprobar el contraste. Con vidrio, el color detrás del texto cambia al desplazarse, y los acentos (rojo, verde, naranja) son los primeros en fallar.

## Mantenimiento

- **Publicar cambios:** sube la versión en `VERSION` dentro de `sw.js` para que los celulares descarguen lo nuevo.
- **Pruebas:** `npm test` (utilidades). Las funciones SQL de Wallet se pueden probar contra un Postgres local ejecutando `supabase/schema.sql`.
- **Plan gratuito de Supabase:** el proyecto se pausa tras 7 días sin uso. Se reactiva desde el panel y **no se pierden datos**. Igual conviene exportar un respaldo JSON de vez en cuando.
- **Dominio propio de Supabase:** si lo usas, agrégalo a `connect-src` en la etiqueta CSP de `index.html`.
