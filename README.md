# Finpepe — Finanzas personales

Web app simple y profesional para ordenar tus finanzas: ingresos, gastos,
tarjetas, ahorros y presupuestos, en **pesos argentinos y dólares**.

Es 100 % estática (HTML + CSS + JavaScript, sin frameworks ni build), pensada
para publicarse gratis en **GitHub Pages**. Funciona sin conexión guardando los
datos en tu navegador, y **opcionalmente** los sincroniza entre dispositivos con
una base de datos **Supabase**.

## Funciones

- **Patrimonio neto** (activos vs. deudas) destacado en el Resumen.
- **Movimientos** de ingresos y gastos con categorías editables, en ARS o USD.
- **Medios de pago**: efectivo, débito, crédito y billeteras (Mercado Pago, etc.).
- **Tarjetas de crédito** con día de **cierre** y de **vencimiento**: la app
  calcula el resumen en curso, lo que vas a pagar y las próximas fechas.
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
  un código, y cada uno carga lo que paga (con reparto 50/50 o personalizado).
  La app calcula quién le debe a quién y permite registrar pagos para saldar
  la deuda. Las cuentas de cada uno siguen siendo privadas — esto es aparte.
- **Respaldo**: exportar/importar todos los datos en JSON y exportar
  movimientos a CSV (compatible con Excel).

## Base de datos con Supabase (opcional)

La app anda perfecta sin base de datos (todo en el navegador). Si querés
sincronizar entre el teléfono y la computadora, conectá tu proyecto de Supabase
(el plan gratis alcanza de sobra):

1. Creá un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor**, pegá y ejecutá el contenido de
   [`supabase-schema.sql`](supabase-schema.sql). Crea una tabla `finance_state`
   con **Row Level Security**: cada usuario solo ve y edita sus propios datos.
3. En **Project Settings → API**, copiá la **Project URL** y la **anon public
   key**.
4. En la app, andá a **Ajustes → Sincronización en la nube**, pegá esos dos
   valores y **Conectar proyecto**. Después **Crear cuenta** / **Iniciar sesión**
   con tu email.

La `anon key` es una clave **pública** pensada para usarse en el navegador: es
seguro dejarla en la app publicada, porque Row Level Security es lo que protege
los datos. Por eso el modelo funciona sobre GitHub Pages sin backend propio.

En la interfaz nueva de Supabase, la "anon key" se llama **"Publishable key"** y
el **Project URL** está en **Settings → Data API**, o tocando el botón verde
**"Connect"** arriba a la derecha del dashboard.

### Cuentas separadas y gastos compartidos

Cada persona crea su **propia cuenta** (su email y contraseña) contra el mismo
proyecto de Supabase: sus movimientos, tarjetas y ahorros quedan totalmente
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
