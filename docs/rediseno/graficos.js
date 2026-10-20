/* FinPep · ayudantes para gráficos en SVG, sin librerías.
   Usalos desde tu JS: import { lineaSuave, ... } from './graficos.js'  (o copiá las funciones).

   Reglas de los gráficos del rediseño:
   - Líneas suaves con marcadores para evoluciones en el tiempo. La curva pasa
     exactamente por cada punto y nunca se pasa de los datos (tangentes horizontales).
   - Escalones (stepPath) para acumulados día a día.
   - Ejes y etiquetas de 11px como mínimo; 3 a 5 líneas de grilla.
   - Colores siempre desde los tokens (style="stroke:var(--brand)"), nunca hex fijos.
*/

/** Escala lineal: devuelve una función v -> px */
export function escala(dominio, rango) {
  const [d0, d1] = dominio, [r0, r1] = rango;
  return v => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
}

/** Path suave que pasa por cada punto sin sobrepasarlo.
 *  puntos: [[x, y], ...] ya en píxeles. */
export function lineaSuave(puntos) {
  if (!puntos.length) return '';
  let d = `M${f(puntos[0][0])} ${f(puntos[0][1])}`;
  for (let i = 1; i < puntos.length; i++) {
    const [x0, y0] = puntos[i - 1], [x1, y1] = puntos[i];
    const mx = (x0 + x1) / 2;
    d += ` C${f(mx)} ${f(y0)} ${f(mx)} ${f(y1)} ${f(x1)} ${f(y1)}`;
  }
  return d;
}

/** Área debajo de una línea suave, hasta la base (y en px). */
export function areaSuave(puntos, baseY) {
  if (!puntos.length) return '';
  const last = puntos[puntos.length - 1], first = puntos[0];
  return `${lineaSuave(puntos)} L${f(last[0])} ${f(baseY)} L${f(first[0])} ${f(baseY)} Z`;
}

/** Área entre dos líneas suaves (ej.: lo que quedó entre ingresos y gastos). */
export function areaEntre(arriba, abajo) {
  const vuelta = [...abajo].reverse();
  return `${lineaSuave(arriba)} L${f(vuelta[0][0])} ${f(vuelta[0][1])} ${lineaSuave(vuelta).replace(/^M[^C]*/, '')} Z`;
}

/** Escalones para acumulados (gastos día a día). */
export function escalones(puntos) {
  if (!puntos.length) return '';
  let d = `M${f(puntos[0][0])} ${f(puntos[0][1])}`;
  for (let i = 1; i < puntos.length; i++) {
    const [x, y] = puntos[i], yPrev = puntos[i - 1][1];
    d += ` L${f(x)} ${f(yPrev)}`;
    if (y !== yPrev) d += ` L${f(x)} ${f(y)}`;
  }
  return d;
}

/** Acumula montos diarios: {1: 550647, 2: 37600, ...} -> [[1, 550647], [2, 588247], ...] hasta 'hasta'. */
export function acumulado(porDia, hasta) {
  const out = []; let total = 0;
  for (let d = 1; d <= hasta; d++) { total += porDia[d] || 0; out.push([d, total]); }
  return out;
}

/** Formato corto en millones para etiquetas: 3821152 -> "3,82" */
export function millones(v, dec = 2) {
  return (v / 1e6).toFixed(dec).replace('.', ',');
}

/** Grilla horizontal + etiquetas del eje Y. Devuelve un string SVG. */
export function grillaY(valores, y, x0, x1, etiqueta = v => v) {
  return valores.map((v, i) =>
    `<line x1="${x0}" x2="${x1}" y1="${f(y(v))}" y2="${f(y(v))}" class="grid"${i ? ' stroke-dasharray="2 4"' : ''}/>` +
    `<text x="${x0 - 6}" y="${f(y(v) + 3.5)}" text-anchor="end">${etiqueta(v)}</text>`
  ).join('');
}

/** Marcador: hueco para puntos normales, lleno para el destacado (mes actual / hoy). */
export function marcador(x, y, color, destacado = false) {
  return destacado
    ? `<circle cx="${f(x)}" cy="${f(y)}" r="5" stroke-width="2.4" style="fill:${color};stroke:var(--s1)"/>`
    : `<circle cx="${f(x)}" cy="${f(y)}" r="4" stroke-width="2.4" style="fill:var(--s1);stroke:${color}"/>`;
}

const f = n => Math.round(n * 10) / 10;

/* Ejemplo: tasa de ahorro (jul–oct)
   const x = escala([0, 3], [44, 290]), y = escala([0, 75], [112, 18]);
   const pts = [66, 19, 25, 6].map((v, i) => [x(i), y(v)]);
   svg.innerHTML = grillaY([0, 25, 50, 75], y, 34, 312, v => v + '%')
     + `<path d="${areaSuave(pts, 112)}" style="fill:url(#degrade)"/>`
     + `<path d="${lineaSuave(pts)}" fill="none" stroke-width="2.5" style="stroke:var(--brand)"/>`
     + pts.map((p, i) => marcador(p[0], p[1], 'var(--brand)', i === pts.length - 1)).join('');
*/
