# Plan de implementación del rediseño

Nueve etapas. Cada una tiene un prompt para pegar tal cual en Claude Code y una lista para verificar. Hacé **una etapa por sesión y un PR por etapa**, probalo en el iPhone (modo oscuro y claro) y recién después seguí.

Todos los prompts suponen que el kit está en `docs/rediseno/`.

---

## Etapa 0 · Reconocimiento (sin cambios)

```
Leé docs/rediseno/README.md, PLAN.md y REGLAS-DISENO.md. Abrí docs/rediseno/referencia.html y mirá las capturas de docs/rediseno/capturas/.

Después explorá el código de FinPep y, SIN EDITAR NADA, contame:
1. Cómo está organizado (archivos HTML, CSS y JS; dónde se arma cada pantalla y cada pop-up).
2. Cómo se manejan hoy el modo claro/oscuro, el selector ARS/USD, el ojo que oculta montos y el mes elegido.
3. Dónde se definen hoy los colores (hex sueltos, variables, etc.) y cuántos hay.
4. Cómo se guardan las categorías y subcategorías, y si tienen un color asignado.
5. Qué riesgos ves para aplicar el plan y si cambiarías el orden de alguna etapa.

Por último, agregá el contenido de REGLAS-DISENO.md al final del CLAUDE.md del repo (crealo si no existe) y abrí un PR solo con eso.
```

**Verificá:** que el resumen tenga sentido y que el PR solo toque `CLAUDE.md`.

---

## Etapa 1 · Tokens, color y tipografía

```
Etapa 1 del rediseño (docs/rediseno/PLAN.md).

1. Copiá docs/rediseno/tokens.css a la carpeta de estilos de la app y cargalo antes que el resto del CSS. Si el modo claro hoy no usa [data-theme="light"] en <html>, adaptá el selector de tokens.css a lo que use la app.
2. Reemplazá TODOS los colores fijos del CSS y del JS por las variables de tokens.css. Si un color no tiene equivalente, decime cuál es antes de inventar uno.
3. Separá verde de relleno y verde de texto: --brand solo para fondos (botones, barras), --brand-text para texto y links.
4. Los montos de gastos en listas (Movimientos, Fijos, Calendario, detalle) pasan al color de texto con "−". Los ingresos quedan en verde con "+". El rojo queda solo para alertas, deltas malos y botones de borrar.
5. Colores de categoría: agregá un campo de color a cada categoría (si no existe) y asignale los de tokens.css (Casa, Compras, Comida, Auto, Teléfono, Supermercado). Las demás usan --c-otros. Usá ese color en TODOS los lugares donde aparece una categoría (puntos, barras, tortas, íconos), para que sea el mismo en todas las pantallas. Ninguna categoría puede ser verde.
6. Tipografías: Inter y Barlow alojadas en el repo (self-hosted, con font-display: swap) para que funcionen sin conexión. Todos los montos con la clase .num (cifras tabulares). Nada de texto menor a 11px.
7. Revisá dos inconsistencias y explicámelas antes de corregirlas:
   a) Inicio muestra Casa 59% y Categorías 57%: parece que Inicio calcula el % sobre las 5 categorías que muestra en vez de sobre el total.
   b) "Gastos" de Inicio ($ 1.898.703 en octubre) no coincide con el total de Categorías ($ 937.810). ¿Es por cómo se imputa la tarjeta de crédito? Si es así, mostralo explicado en la pantalla.

No cambies layouts todavía: esta etapa es solo color, tipografía y datos.
```

**Verificá:**
- [ ] En claro, los links y los "+$" verdes se leen bien al sol.
- [ ] Movimientos ya no es una lista roja.
- [ ] Compras tiene el mismo color en Inicio y en Categorías.
- [ ] Los números no "bailan" al cambiar de mes.

---

## Etapa 2 · Estructura: barra inferior, mes arriba y ajustes de PWA

```
Etapa 2 del rediseño. Referencia: capturas 1-inicio y 3-movimientos, y componentes.css (.tabbar, .fab, .bar, .month, .icb, .mseg).

1. Barra inferior pegada al borde, con fondo translúcido y blur (var(--glass) + backdrop-filter), padding de env(safe-area-inset-bottom) y 5 lugares: Inicio, Movimientos, un botón + central (.fab) que abre la carga, Cuentas y Más. El contenido tiene padding inferior igual a var(--tabbar-h) para que nada quede tapado.
2. Barra superior: el mes ("Octubre 2026") con flechas ‹ › a la izquierda, y a la derecha el ojo y ARS/USD (.mseg). El engranaje de Ajustes pasa a "Más". Sacá el bloque verde con olas del mes en Inicio, Movimientos y el resto.
3. Cambiar de mes deslizando horizontalmente sobre el contenido. Si el navegador soporta document.startViewTransition, animalo con un deslizamiento; si no, que cambie sin animación.
4. PWA en iPhone: meta theme-color para oscuro y claro, apple-mobile-web-app-status-bar-style=black-translucent, viewport-fit=cover con paddings env(safe-area-inset-*), overscroll-behavior-y: none en html y body, e inputs de 16px o más.
5. Botones de 44×44px mínimo en toda la app. Al tocarlos se achican apenas (:active scale .97) y no aparece el resaltado gris de WebKit.
6. Sacá el botón grande "Añadir movimiento" de Inicio: ahora se carga desde el +.
```

**Verificá:**
- [ ] Nada queda tapado por la barra inferior; se ve el contenido desenfocado detrás.
- [ ] El + abre la carga (por ahora la carga vieja está bien).
- [ ] En el iPhone, la barra de estado toma el color del fondo.

---

## Etapa 3 · Cargar movimiento en una sola pantalla

```
Etapa 3 del rediseño. Referencia: captura 2-cargar y el mockup "Cargar movimiento" en referencia.html (incluye el JS de la calculadora y de las subcategorías al final del archivo).

Reemplazá el asistente de 6 pasos por un panel que sube desde abajo (.sheet), con todo en una sola pantalla:
1. Arriba: agarradera, X para cerrar y el título "Nuevo movimiento". Se cierra con la X o deslizando hacia abajo (más de 120px o un gesto rápido). Al abrirse, la pantalla de atrás se achica apenas (scale .94).
2. Segmentado Gasto | Ingreso | Transferencia, con Gasto por defecto.
3. Monto grande con el cursor, botón ARS ⇄ USD y el equivalente "≈ US$ X" usando el TC actual. Mantené la calculadora: si se escribe 12000+8500, debajo aparece "= $ 20.500". Teclado fijo: 7 8 9 ⌫ / 4 5 6 × / 1 2 3 − / 000 0 , +. Si hoy usás ÷, sumalo. ⌫ borra un dígito y mantenido borra todo.
4. Chips con valores por defecto (se tocan solo si cambian):
   - Fecha: "Hoy, 19 oct" → abre un selector de fecha.
   - Cuenta: la última usada → abre la lista de cuentas.
   - Cuotas: "1 pago" → selector de 1 a 24 cuotas. Una vez elegido, el chip dice "6 cuotas de $ 4.167" y queda marcado.
   - Compartido: se activa con un toque y dice "Compartido con Ana · 50/50". Mantenido o tocado de nuevo, permite cambiar la proporción. Tiene que usar la lógica que ya existe en Compartido.
   - Nota.
5. Categorías: grilla de 4 columnas con las 8 más usadas, en círculos con ícono y su color (.catgrid/.catb/.cic). Al tocar una categoría con subcategorías, LOS MISMOS CÍRCULOS pasan a mostrar sus subcategorías, con el color de la categoría y la más usada ya elegida. El primer círculo es "Volver". El título de la sección cambia a "Comida · elegí subcategoría". "Todas" abre la lista completa.
6. Botón "Guardar gasto · Delivery" (dice tipo y categoría/subcategoría), fijo arriba del teclado.
7. Al guardar: se cierra el panel, el movimiento aparece arriba de la lista con un fondo verde suave que se desvanece (.row.is-new) y el saldo de Inicio anima su cambio.

Mantené intacta la lógica de guardado actual (moneda, TC del momento, cuotas, compartido, fijos). Cambia la interfaz, no el modelo de datos.
```

**Verificá:**
- [ ] Un gasto común sale con monto + categoría + subcategoría + Guardar.
- [ ] Cuotas y compartido se guardan igual que antes (revisá Cuotas y Compartido después de cargar).
- [ ] El teclado del sistema nunca aparece.

---

## Etapa 4 · Inicio

```
Etapa 4 del rediseño. Referencia: capturas 1-inicio (oscuro, claro y -completa) y el mockup "Inicio" en referencia.html.

Orden de la pantalla, de arriba a abajo:
1. Barra superior de la etapa 2 (mes, ojo, ARS/USD).
2. Tarjeta del saldo (.hz-body/.saldo-row/.ring/.minis). Conserva el diseño actual: "Saldo" grande en verde, "44% balance" y "12 días restantes" con puntos de color, y a la derecha el anillo doble (balance afuera, días restantes adentro) con "$ 140.954 por día" en el centro. El anillo mide 120px para que el número no se corte. Abajo, las tres tarjetitas Ingresos / Gastos / Ahorros con su ícono de color y la variación en % (sin la sigla "MoM").
3. Fila de Compartido: avatares, "Le debés a Ana" y el monto en color neutro (no rojo), con flecha que abre Compartido.
4. Gastos por categoría a todo el ancho: barra apilada + top 4 y "Otras N", con % sobre el TOTAL del mes y los colores fijos de categoría. "Ver todo" lleva a Categorías.
5. Tasa de ahorro: línea suave con marcadores, degradé verde debajo, grilla de 0 a 75% y el mes actual destacado con una pastilla ("6%"). Usá lineaSuave/areaSuave/marcador de docs/rediseno/graficos.js.
6. Al final, "Para tener en cuenta": hasta 3 avisos de una línea, con ícono SVG (no emojis), color según gravedad (--neg, --warn o --brand-text) y flecha. Ejemplos: "Compras subió 124%", "Ahorraste el 6% de lo que entró", "Macro VISA viene bien".

Sacá de Inicio: el botón "Añadir movimiento", "Próximos vencimientos", "Ingresos vs. gastos" y "Balance por día" (los dos gráficos van a Movimientos › General en la etapa 6).
El ojo desenfoca los montos (.hide-amounts .money { filter: blur(7px) }) en vez de reemplazarlos por puntos, para que no cambie el ancho.
```

**Verificá:**
- [ ] "$ 140.954" entra completo en el anillo.
- [ ] Con el ojo activado no se mueve nada de lugar.
- [ ] Los % de categorías coinciden con Categorías.

---

## Etapa 5 · Movimientos (lista)

```
Etapa 5 del rediseño. Referencia: captura 3-movimientos y el mockup "Movimientos".

1. Título grande "Movimientos" y chip del mes. Debajo, el segmentado Lista | Categorías | Calendario.
2. Buscador (input de 16px) y chips de filtro deslizables: Todos, Gastos, Ingresos, cada cuenta y Categoría ▾. Reemplazan los 3 selects y el checkbox "Todos los meses" (eso pasa al selector de mes).
3. Bloque "Programados" arriba, con borde punteado: cuotas y fijos con fecha futura dentro del mes. Ya no se mezclan con lo que ya pasó.
4. Lista agrupada por día: encabezado fijo (sticky) con el día ("Ayer · dom 18 oct", "Miércoles 7 oct") y el total del día a la derecha. Un solo grupo por día (.group) con filas (.row): ícono de categoría en su color, título, subtítulo "Categoría · Cuenta · cuota 2/12", monto a la derecha y el equivalente en la otra moneda debajo.
5. Deslizar una fila hacia la izquierda muestra Editar y Borrar (se puede hacer con scroll-snap, sin JS). Tocar la fila abre el detalle como panel inferior.
6. Al borrar: aviso con "Deshacer" durante 5 segundos (.toast); el borrado real se hace al terminar ese tiempo.
7. Sacá el botón "+ Movimiento" de esta pantalla (ya está el + de la barra inferior).
```

**Verificá:**
- [ ] Los movimientos del 23 y 29 de octubre aparecen en Programados.
- [ ] Al scrollear, el encabezado del día queda fijo arriba.
- [ ] Deshacer recupera el movimiento.

---

## Etapa 6 · Categorías y General

```
Etapa 6 del rediseño. Referencia: capturas 4-general y 5-categorias, y esos dos mockups.

Dentro de Movimientos › Categorías, chips General | Gastos | Ingresos. General es la primera opción.

GENERAL (dos tarjetas):
1. "Ingresos y gastos por mes": últimos 4 meses, dos líneas suaves con marcadores (ingresos en --brand y gastos en --t1). Valor en millones arriba o abajo de cada punto ("3,82"). El tramo del mes en curso de la línea de gastos va punteado y su marcador también, porque el mes no terminó. El área entre las dos líneas va sombreada con --brand al 8%. Debajo: "Lo sombreado es lo que quedó entre lo que entró y lo que salió cada mes."
2. "Gastos día a día" (acumulado): arriba, el total acumulado hasta hoy ("$ 870.677 al día 19") y un chip con la diferencia contra el mes anterior AL MISMO DÍA. En el gráfico: escalones del mes actual hasta hoy (línea llena --t1 con degradé), el mes anterior completo como línea punteada (--t3), una línea horizontal punteada con los ingresos del mes (--brand) y otra con ingresos − ahorro (--c-super), cada una con su etiqueta. Una línea vertical "Hoy", con un marcador en cada serie y la diferencia anotada ("≈ 0,9 M menos"). Eje X: 1, 5, 10, 15, 20, 25 y último día. Usá escalones/acumulado de graficos.js.

GASTOS:
1. Tarjeta con dona plana (no 3D) y el % de la categoría más grande en el centro ("57% es Casa"). Al lado: "Gastado en octubre", el total y "Hasta hoy, día 19. N categorías con gastos."
2. Lista de categorías en filas de dos líneas (.crow): ícono, nombre y monto arriba; barra en el color de la categoría, % del total y chip de variación abajo. Sin fondos de colores por fila. Al tocar una categoría se despliegan sus subcategorías y "Ver movimientos de X".
3. Las categorías en $ 0 se pliegan en una fila: "5 sin gastos todavía".
4. La variación se calcula contra el MISMO DÍA del mes anterior (gasto del 1 al 19 de octubre vs. del 1 al 19 de septiembre), no contra septiembre completo. El chip va en rojo si el gasto sube y en verde si baja.
5. Debajo, "Por medio de pago" en grises (son cuentas, no categorías).
6. El "% de ingresos" que hoy está en la tabla pasa al detalle de cada categoría.

INGRESOS: misma estructura que Gastos (dona + lista + evolución) con las categorías de ingreso. Para ingresos, subir es bueno (verde).
```

**Verificá:**
- [ ] Ninguna categoría muestra "▼100%" por no tener gastos todavía.
- [ ] El tramo del mes en curso se ve punteado.
- [ ] La diferencia contra el mes anterior coincide con un cálculo a mano.

---

## Etapa 7 · Tarjeta "Cómo vengo"

```
Etapa 7 del rediseño. Referencia: captura 6-como-vengo y su mockup.

Pasá "Cómo vengo" a un panel inferior con este orden:
1. Encabezado: "Cómo vengo", "Macro VISA · cierra 29/10 · faltan 10 días" y la X.
2. Caja de estado (.statusbox): veredicto ("Vas bien" / "Ojo" / "Te estás pasando", con --brand, --warn o --neg), "Al ritmo actual cerrás en" y la proyección grande, y debajo la comparación con el promedio de los últimos resúmenes.
3. Barra del resumen en curso (.gauge) con las marcas rotuladas directamente: Llevás, Proyectado, Promedio y Último. Lo gastado va sólido, lo ya cargado (cuotas y fijos) en verde más claro y la proyección rayada. Debajo, una leyenda corta con los tres montos.
4. Tres datos (.kpis): Podés gastar $ X por día · Venís gastando $ Y por día · Día 18 de 28. Sumá "Te quedan $ 725.828 hasta el cierre".
5. "En qué se va": barra apilada Consumos / Cuotas / Fijos.
6. "Últimos resúmenes": barras de los resúmenes cerrados en gris y el resumen en curso con lo gastado sólido y la proyección rayada, más la línea punteada del promedio. Debajo, la tabla de resúmenes (cierre, vencimiento, total, variación) y la aclaración "Según lo cargado en la app (sin impuestos ni cargos del banco)".
7. Botones: "Poner un tope" (secundario) y "Ver los movimientos del resumen" (link). Sin botón "Cerrar" al pie.
```

**Verificá:**
- [ ] El veredicto cambia de color según la proyección contra la referencia o el tope.
- [ ] Las etiquetas de la barra no se pisan con montos altos.

---

## Etapa 8 · Compartido

```
Etapa 8 del rediseño. Referencia: captura 7-compartido y su mockup.

1. Botón "‹ Más" arriba a la izquierda y menú ⋮ a la derecha con: editar hogar, actualizar y "Salir del hogar" (con confirmación dentro del panel, no con un diálogo nativo).
2. Tarjeta principal: avatares de cada persona, nombre del hogar, "Le debés a Ana" (o "Ana te debe") en color neutro y el monto grande. Botones "Saldar deuda" (primario; permite pagos parciales) y "+ Gasto" (secundario).
3. "Quién pagó en octubre": barra dividida por persona, con un color fijo por persona (Jose --c-tel, Ana --c-super) que se repite en avatares y gráficos, y los montos de cada uno.
4. Un solo gráfico "Gastos en común por mes": barras apiladas por persona con el total arriba de cada barra. Reemplaza los dos gráficos actuales.
5. "Últimos en común": las últimas 3 filas con quién pagó, la fecha, el monto y "tu parte", y "Ver los N" para la lista completa.
```

**Verificá:**
- [ ] La deuda ya no es roja en Inicio ni verde acá.
- [ ] Las barras suman lo mismo que el total del mes.

---

## Etapa 9 · Pulido

```
Etapa 9 del rediseño (pulido). Referencia: sección 5 "Detalles nativos" de referencia.html.

1. Todos los pop-ups que quedan (detalle de movimiento, resúmenes, ahorro, notificaciones, presupuestos) pasan al mismo panel inferior: agarradera, X, un solo botón primario abajo y sin "Cancelar".
2. Borrar y reordenar detrás de "⋯" o de deslizar la fila en Cuentas, Presupuestos, Fijos y Resúmenes. Reordenar, con un modo "Editar".
3. Ajustes como lista agrupada estilo iOS: filas con el valor a la derecha y chevron, interruptores <input type="checkbox" switch> en vez de checkboxes, íconos SVG en vez de emojis. "Borrar todos los datos" y "Cerrar sesión" al final, en un grupo aparte.
4. Notificaciones: interruptores, un solo botón primario.
5. Estados vacíos con sugerencias en Presupuestos y Fijos (ej.: "Compras va $ 172.358 este mes. ¿Le ponés un presupuesto?").
6. Título grande que se achica al scrollear (IntersectionObserver) en Movimientos, Cuentas y Más.
7. Esqueletos mientras sincroniza con la nube, y todo respetando prefers-reduced-motion.
```

**Verificá:**
- [ ] Ya no queda ningún modal centrado.
- [ ] En Ajustes no hay botones de menos de 44px.
