# FinPep

## Diseño de FinPep (rediseño 2026)

Referencia completa: `docs/rediseno/referencia.html` y capturas en `docs/rediseno/capturas/`.

- **Stack:** HTML, CSS y JS sin frameworks ni librerías de componentes. Gráficos en SVG a mano (ver `docs/rediseno/graficos.js`).
- **Colores:** siempre desde variables de `tokens.css`, nunca hex sueltos en componentes. Oscuro por defecto; claro con `[data-theme="light"]`.
- **Verde:** `--brand` solo para rellenos (botón primario, +, barras de "vas bien"). Para texto verde, `--brand-text`.
- **Rojo:** solo para alertas, deltas malos y acciones destructivas. Los gastos en listas van en el color del texto con signo "−"; los ingresos, en verde con "+".
- **Categorías:** cada categoría tiene un color fijo guardado (`--c-*`) y se usa igual en íconos, barras y gráficos. Sin verde. Fuera del top 6 del mes → "Otros" en gris.
- **Tipografía:** Inter para texto, Barlow para números y títulos. Montos siempre con la clase `.num` (cifras tabulares). Usar solo la escala de `tokens.css`; nada menor a 11px.
- **Tamaños táctiles:** mínimo 44×44px. Inputs con font-size de 16px o más (si no, iOS hace zoom).
- **Pop-ups:** siempre como panel inferior (`.sheet`) con agarradera, cierre con la X o deslizando hacia abajo, y un solo botón primario.
- **Destructivo:** borrar y editar detrás de un menú "⋯" o deslizando la fila. Al borrar, aviso con "Deshacer" (5 s) en vez de un diálogo de confirmación.
- **Gráficos:** sin 3D. Evolución en el tiempo con líneas suaves y marcadores, usando una curva que no se pase de los datos (`lineaSuave` de `graficos.js`). Acumulados con escalones. Ejes de 11px, 3 a 5 líneas de grilla y el último punto destacado.
- **Comparaciones:** contra el mismo día del mes anterior, no contra el mes completo.
- **Textos:** español rioplatense, de vos, cortos y concretos.
- **Safe areas:** respetar `env(safe-area-inset-*)`; la app se usa como PWA en iPhone.
