# Finpepe — Finanzas personales

Web app simple y profesional para ordenar tus finanzas: ingresos, gastos,
tarjetas, ahorros y presupuestos, en **pesos argentinos y dólares**.

Es 100 % estática (HTML + CSS + JavaScript, sin frameworks ni build), pensada
para publicarse gratis en **GitHub Pages**. Los datos se guardan únicamente en
tu navegador (localStorage): nada sale de tu dispositivo.

## Funciones

- **Movimientos** de ingresos y gastos con categorías editables, en ARS o USD.
- **Medios de pago**: efectivo, débito, crédito y billeteras (Mercado Pago, etc.).
- **Tarjetas de crédito** con día de **cierre** y de **vencimiento**: la app
  calcula el resumen en curso, lo que vas a pagar y las próximas fechas.
- **Compras en cuotas**: cargás el total y la cantidad de cuotas, y la app
  genera una cuota por mes que cae en el resumen correspondiente.
- **Movimientos fijos** (alquiler, suscripciones, sueldo): se registran solos
  cada mes.
- **Presupuestos** mensuales por categoría con avance y alertas.
- **Ahorros**: fondos en ARS o USD, con metas opcionales, aportes y retiros.
- **Doble moneda**: toda la app se puede ver en ARS o USD con un clic. La
  cotización se trae de [DolarAPI](https://dolarapi.com) (oficial, blue, MEP,
  tarjeta o cripto) o se define a mano.
- **Resumen** con gráficos de gastos por categoría y de ingresos vs. gastos de
  los últimos 6 meses.
- **Respaldo**: exportar/importar todos los datos en JSON y exportar
  movimientos a CSV (compatible con Excel).

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
index.html      Página única con todas las vistas
styles.css      Estilos
js/store.js     Estado y persistencia (localStorage)
js/fx.js        Cotización del dólar y conversión de monedas
js/charts.js    Gráficos SVG/HTML sin dependencias
js/app.js       Vistas y lógica de la aplicación
```

## Notas

- Los datos viven en el navegador donde usás la app. Para cambiar de
  dispositivo, exportá el respaldo JSON desde **Ajustes → Datos** e importalo
  en el otro.
- Las conversiones ARS ⇄ USD usan la cotización vigente (cada movimiento
  conserva su moneda original, así que podés cambiar de fuente cuando quieras).
