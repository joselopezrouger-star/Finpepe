# Finpepe — Finanzas personales

Web app simple y profesional para ordenar tus finanzas: ingresos, gastos,
tarjetas, ahorros y presupuestos, en **pesos argentinos y dólares**.

Es 100 % estática (HTML + CSS + JavaScript, sin frameworks ni build), pensada
para publicarse gratis en **GitHub Pages**. Funciona sin conexión guardando los
datos en tu navegador, y **opcionalmente** los sincroniza entre dispositivos con
una base de datos **Supabase**.

## Funciones

- **Navegación en 4 botones** fijos abajo (Inicio, Movimientos, Cuentas, Más);
  las secciones que no entran en esos 4 viven adentro como sub-pestañas (por
  ejemplo Calendario adentro de Movimientos, o Planificar/Compartido/Ajustes
  adentro de Más).
- **Balance del mes** destacado en el Resumen, con un anillo que muestra qué
  porcentaje de tu ingreso todavía no gastaste.
- **Movimientos** de ingresos, gastos y **transferencias entre tus propias
  cuentas** (por ejemplo de efectivo a una caja de ahorro), con categorías
  editables, en ARS o USD, con **fecha elegible** (por defecto hoy, pero se
  puede tocar y elegir cualquier otra desde el selector nativo). Las
  transferencias no se cuentan como ingreso ni gasto.
- **Medios de pago**: efectivo, débito, caja de ahorro, crédito y billeteras
  (Mercado Pago, etc.).
- **Tarjetas de crédito** con día de **cierre** y de **vencimiento**: la app
  calcula el resumen en curso, lo que vas a pagar y las próximas fechas.
  Además, si el banco corre la fecha un mes puntual, se puede cargar un
  **ajuste para ese período** sin cambiar el día general de la tarjeta
  (botón "Ajustar fechas" en Tarjetas y medios).
- **Compras en cuotas**: cargás el total y la cantidad de cuotas, y la app
  genera una cuota por mes que cae en el resumen correspondiente.
- **Calendario de pagos**: agenda mensual con los vencimientos de tarjeta y los
  movimientos fijos, para anticiparte y no olvidar ninguna suscripción.
- **Movimientos fijos** (alquiler, suscripciones, sueldo): se registran solos
  cada mes.
- **Presupuestos** mensuales por categoría con avance y alertas.
- **Ahorros**: fondos en ARS o USD, con metas opcionales, aportes y retiros.
- **Doble moneda**: toda la app se puede ver en ARS o USD con un clic. La
  cotización se trae de [DolarAPI](https://dolarapi.com) (oficial, blue, MEP,
  tarjeta o cripto) o se define a mano.
- **Resumen** con gráficos de gastos por categoría y de ingresos vs. gastos de
  los últimos 6 meses.
- **Sincronización en la nube (opcional)** con Supabase: iniciás sesión y tus
  datos se guardan en tu base de datos y aparecen en todos tus dispositivos.
- **Gastos compartidos en pareja**: creás un "hogar", invitás a tu pareja con
  un código, y las cuentas de cada uno siguen siendo privadas. Para no cargar
  cada gasto dos veces, en el mismo formulario de "+ Movimiento" hay un
  tilde **"Es un gasto compartido"**: guarda tu gasto personal como siempre y
  además avisa al hogar compartido con el reparto que elijas (50/50 por
  defecto). La app calcula quién le debe a quién y permite registrar pagos
  para saldar la deuda.
- **Carga rápida de movimientos**: una sola pantalla con calculadora integrada
  para el importe (con puntos de miles mientras tipeás, y podés sumar/restar
  varios montos antes de guardar) y categoría/cuenta que se eligen de una
  lista que se despliega ahí mismo, sin cambiar de pantalla.
- **Categorías con subcategorías**: cada categoría de gasto puede tener
  subcategorías (por ejemplo "Casa" → Supermercado, Servicios, Alquiler). Se
  gestionan desde Ajustes, con un interruptor para usar subcategorías o una
  lista plana simple. Los reportes agrupan el gasto por la categoría madre.
- **Todo en pesos, también en dólares**: cada gasto o ingreso cargado en ARS
  guarda además su equivalente en USD a la cotización del momento, para que
  el historial en dólares no se distorsione con la inflación entre medio.
- **Tema claro y oscuro**, con el interruptor en el encabezado.
- **Respaldo**: exportar/importar todos los datos en JSON y exportar
  movimientos a CSV (compatible con Excel).

## Base de datos con Supabase

La app anda perfecta sin base de datos (todo en el navegador). Para
sincronizar entre el teléfono y la computadora (y usar gastos compartidos),
ya viene conectada a un proyecto de Supabase (el plan gratis alcanza de
sobra) — no hace falta pegar nada:

1. En Supabase → **SQL Editor**, ejecutá el contenido de
   [`supabase-schema.sql`](supabase-schema.sql). Crea las tablas con **Row
   Level Security**: cada usuario solo ve y edita sus propios datos.
2. En Supabase → **Authentication → Sign In / Providers → Email**, desactivá
   **"Confirm email"**. Es necesario porque la app no pide tu email real (ver
   abajo) y una dirección inventada nunca puede confirmar nada.
3. En la app, cada quien toca **"Iniciar sesión / Crear cuenta"** y elige un
   **usuario** (por ejemplo `jose` o `ana`) y una contraseña. Nada de emails.

Las credenciales del proyecto (`DEFAULT_URL`/`DEFAULT_KEY` en `js/cloud.js`)
son datos **públicos** por diseño: es seguro dejarlas escritas en la app
publicada, porque Row Level Security es lo que protege los datos. Por eso el
modelo funciona sobre GitHub Pages sin backend propio. Si alguna vez querés
apuntar a otro proyecto, se puede seguir pegando una URL/key distinta desde
Ajustes cuando esas constantes estén vacías.

### Login con usuario, no con email

Supabase Auth pide internamente algo con forma de email, así que la app arma
uno por dentro con un dominio que no existe (`usuario@finpepe.invalid`,
reservado justo para esto). Nadie ve ese dominio: en toda la app solo se
muestra el usuario. La contraparte es que **no hay recuperación de
contraseña por email** (una dirección inventada no puede recibirlo) — si
alguien la olvida, se resetea a mano desde el dashboard de Supabase
(**Authentication → Users**).

### Cuentas separadas y gastos compartidos

Cada persona crea su **propia cuenta** (su usuario y contraseña) contra el
mismo proyecto de Supabase: sus movimientos, tarjetas y ahorros quedan totalmente
privados entre sí gracias a Row Level Security — no hace falta nada especial
para esto.

Para llevar los **gastos compartidos** (por ejemplo alquiler o el super, que
pagan entre los dos), andá a la pestaña **Compartido**: uno de los dos crea un
"hogar" y genera un código de invitación; el otro lo carga desde la misma
pestaña para unirse. A partir de ahí, cada uno registra lo que pagó y la app
calcula el saldo (quién le debe a quién) y permite anotar cuando se paga esa
deuda. Esto vive en tablas separadas (`households`, `shared_expenses`, etc.) y
no mezcla ni duplica los movimientos personales de cada cuenta.

## Publicar en GitHub Pages

1. En GitHub, entrá a **Settings → Pages** del repositorio.
2. En *Build and deployment*, elegí **Deploy from a branch**.
3. Seleccioná la rama `main` y la carpeta `/ (root)`. Guardá.
4. En un minuto la app queda disponible en
   `https://<tu-usuario>.github.io/Finpepe/`.

## Uso local

Basta con abrir `index.html` en el navegador; no requiere servidor.

## Estructura

```
index.html           Página única con todas las vistas
styles.css           Estilos
js/store.js          Estado y persistencia (localStorage)
js/fx.js             Cotización del dólar y conversión de monedas
js/cloud.js          Sincronización opcional con Supabase (auth + sync)
js/charts.js         Gráficos SVG/HTML sin dependencias
js/app.js            Vistas y lógica de la aplicación
supabase-schema.sql  Tabla y políticas RLS para la sincronización
```

## Notas

- Los datos viven en el navegador donde usás la app. Para cambiar de
  dispositivo, exportá el respaldo JSON desde **Ajustes → Datos** e importalo
  en el otro.
- Las conversiones ARS ⇄ USD usan la cotización vigente (cada movimiento
  conserva su moneda original, así que podés cambiar de fuente cuando quieras).
