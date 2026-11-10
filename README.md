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
- **App de iPhone:** la misma app instalable en iPhone sin pagar, con sus límites (ver [App de iPhone](#app-de-iphone-gratis-sin-mac)).
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

## App de iPhone (gratis, sin Mac)

La misma app web, empaquetada con [Capacitor](https://capacitorjs.com) para instalarla como app de iPhone. Es el **mismo código**: no hay una segunda versión que mantener. Funciona sin conexión porque todos los archivos van dentro de la app, y sincroniza con Supabase igual que la web.

**Lo que debes saber antes (límites de Apple, no de la app):**
- Sin pagar el programa de desarrollador (99 USD/año), Apple firma la app solo **7 días**. Pasado ese plazo deja de abrir hasta que la vuelvas a firmar. Con cuenta gratuita también hay un tope de **3 apps** instaladas así.
- No hay TestFlight ni App Store con cuenta gratuita.
- Tus datos no corren riesgo: viven en Supabase, y la versión web (PWA) sigue funcionando todo el tiempo como respaldo.
- Esta ruta **no se ha probado en un iPhone real todavía**: sigue la lista de verificación del final.

### 1. Compilar la app (en la nube, sin Mac)
1. En GitHub abre la pestaña **Actions → «App de iPhone (.ipa sin firmar)» → Run workflow**.
2. Al terminar (unos 10 a 15 minutos), baja **Gastos-ipa** de la sección *Artifacts* y descomprime el `.zip`: dentro está `Gastos.ipa`.

El flujo corre en una Mac de GitHub, no en la tuya. El repositorio es público, y en repos públicos GitHub no cobra los minutos de macOS (confírmalo en tu pestaña Actions). Si falla, la ejecución muestra la versión de Xcode y el paso exacto que falló.

### 2. Instalarla desde Windows
1. Instala **iTunes** e **iCloud** desde la página de Apple (no las versiones de Microsoft Store) y [Sideloadly](https://sideloadly.io).
2. Conecta el iPhone por cable y acepta «Confiar en esta computadora».
3. En el iPhone activa **Ajustes → Privacidad y seguridad → Modo de desarrollador** (pide reiniciar).
4. Abre Sideloadly, arrastra `Gastos.ipa`, escribe tu Apple ID gratuito y pulsa **Start**.
5. En el iPhone: **Ajustes → General → VPN y gestión de dispositivos →** tu Apple ID **→ Confiar**. Abre «Gastos» e inicia sesión con tu cuenta.

### 3. Renovar cada 7 días
Repite el paso 2.4 con el **mismo** `Gastos.ipa` y el **mismo** Apple ID, sin borrar la app antes. Sideloadly puede renovarla solo mientras tu PC esté encendida y el iPhone en la misma red. Si se te pasa el plazo, no pierdes nada: solo vuelve a firmarla.

### Qué cambia respecto a la web
- Los correos de confirmar cuenta y de recuperar contraseña abren la **versión web** (`APP_URL` en `js/config.js`). Ahí cambias la contraseña y luego entras a la app como siempre.
- **Respaldo CSV/JSON** abre el menú de compartir de iOS (Archivos, AirDrop, correo…) en lugar de descargar.
- Una vez al mes la app te recuerda guardar un respaldo JSON. La copia principal sigue siendo Supabase; el archivo no depende de ningún servicio.
- La app pide al sistema que no borre los datos locales.

### Para el desarrollo
```bash
npm run build:www   # arma www/ con los archivos web
npx cap add ios     # genera ios/ (solo para inspeccionarlo; no se sube al repo)
```
Compilar y firmar exige macOS, por eso lo hace el flujo de GitHub. `www/` e `ios/` están en `.gitignore` porque se generan en cada compilación. Si cambias `appId` en `capacitor.config.json`, iOS la tratará como otra app distinta (no comparte datos locales con la anterior).

### Lista de verificación en el iPhone (primera vez)
- [ ] Se instala y abre; el icono es el de la billetera azul.
- [ ] Inicia sesión y ve tus datos.
- [ ] Modo avión: abre, crea un gasto; al volver la conexión aparece en la web.
- [ ] **Respaldo JSON** abre el menú de compartir.
- [ ] Las áreas seguras (muesca y barra inferior) no tapan botones.
- [ ] Recuperar contraseña: llega el correo y el enlace abre la web.

## Mantenimiento

- **Publicar cambios:** sube la versión en `VERSION` dentro de `sw.js` para que los celulares descarguen lo nuevo.
- **Pruebas:** `npm test` (utilidades). Las funciones SQL de Wallet se pueden probar contra un Postgres local ejecutando `supabase/schema.sql`.
- **Plan gratuito de Supabase:** el proyecto se pausa tras 7 días sin uso. Se reactiva desde el panel y **no se pierden datos**. Igual conviene exportar un respaldo JSON de vez en cuando.
- **Dominio propio de Supabase:** si lo usas, agrégalo a `connect-src` en la etiqueta CSP de `index.html`.
