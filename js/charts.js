'use strict';

/* Charts — gráficos SVG/HTML sin dependencias.
   Especificación: marcas finas, extremos redondeados (4px) contra datos y
   rectos contra la línea de base, grilla hairline. Sin tooltips ni
   interacción al tocar/pasar el mouse: el dato se lee directo del tamaño
   de la marca, la leyenda o los ejes. */
const Charts = (() => {
  // Los colores de las marcas siguen el tema activo (claro/oscuro): se leen
  // de las variables CSS en vez de quedar fijos, así los gráficos se
  // repintan bien cuando el usuario cambia de tema.
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  const COLORS = {
    get income() { return cssVar('--income-series', '#0a8f3c'); },
    get expense() { return cssVar('--expense-series', '#d03b3b'); },
    get category() { return cssVar('--category-series', '#b5760a'); },
  };

  /* ---------- Escalas ---------- */
  function niceStep(raw) {
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return m * pow;
  }

  function niceTicks(max, count) {
    if (!(max > 0)) max = 1;
    // Los montos siempre se muestran redondeados al peso entero (ver
    // compact() más abajo): un paso menor a 1 generaría marcas distintas
    // que se ven repetidas en el eje (ej. 0.5 y 1 redondean los dos a "1").
    const step = Math.max(1, niceStep(max / count));
    const top = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
    return { top, ticks };
  }

  /* ---------- Barras horizontales (una serie) ----------
     items: [{label, value, color?}] · opts: {fmt, color} — color por ítem
     pisa el color general (para diferenciar categorías, emparejado con el
     mismo orden de colores que Charts.donut). Cada fila va en dos líneas:
     arriba el nombre y el monto (el monto queda sobre la barra, no al
     lado), abajo la barra con su % del total a la derecha. */
  function hBars(el, items, opts) {
    el.replaceChildren();
    if (!items.length) return;
    const max = Math.max(...items.map((i) => i.value));
    const total = items.reduce((a, i) => a + i.value, 0);
    const fallbackColor = opts.color || COLORS.expense;

    for (const it of items) {
      const color = it.color || fallbackColor;
      const row = document.createElement('div');
      row.className = 'hbar-row';

      const top = document.createElement('div');
      top.className = 'hbar-toprow';
      const label = document.createElement('span');
      label.className = 'hbar-label';
      if (it.color) {
        const dot = document.createElement('span');
        dot.className = 'hbar-dot';
        dot.style.background = color;
        label.appendChild(dot);
      }
      label.appendChild(document.createTextNode(it.label));
      const amount = document.createElement('span');
      amount.className = 'hbar-amount';
      amount.textContent = opts.fmt(it.value);
      top.appendChild(label);
      top.appendChild(amount);

      const bottom = document.createElement('div');
      bottom.className = 'hbar-trackrow';
      const track = document.createElement('span');
      track.className = 'hbar-track';
      const bar = document.createElement('span');
      bar.className = 'hbar-bar';
      bar.style.width = Math.max(0.5, (it.value / max) * 100) + '%';
      bar.style.background = color;
      track.appendChild(bar);
      const pct = document.createElement('span');
      pct.className = 'hbar-pct';
      pct.textContent = (total > 0 ? Math.round((it.value / total) * 100) : 0) + '%';
      bottom.appendChild(track);
      bottom.appendChild(pct);

      row.appendChild(top);
      row.appendChild(bottom);

      el.appendChild(row);
    }
  }

  /* ---------- Columnas agrupadas: ingresos vs gastos por mes ----------
     rows: [{label, income, expense}] · opts: {ariaLabel} */
  function trend(el, rows, opts) {
    el.replaceChildren();
    if (!rows.length) return;
    const W = 640, H = 236;
    const m = { t: 10, r: 8, b: 26, l: 56 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;

    const maxVal = Math.max(1, ...rows.map((r) => Math.max(r.income, r.expense)));
    const { top, ticks } = niceTicks(maxVal, 4);
    const y = (v) => m.t + ih - (v / top) * ih;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'trend-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', opts.ariaLabel || 'Ingresos y gastos por mes');

    const NS = 'http://www.w3.org/2000/svg';
    const add = (parent, tag, attrs, text) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      if (text !== undefined) n.textContent = text;
      parent.appendChild(n);
      return n;
    };

    // Grilla + ticks del eje Y (hairline, recesiva)
    for (const t of ticks) {
      const yy = y(t);
      add(svg, 'line', {
        x1: m.l, x2: W - m.r, y1: yy, y2: yy,
        stroke: t === 0 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1,
        'shape-rendering': 'crispEdges',
      });
      add(svg, 'text', {
        x: m.l - 8, y: yy + 3.5, 'text-anchor': 'end', class: 'tick-label',
      }, compact(t));
    }

    // Columna con extremo superior redondeado 4px, base recta
    const colPath = (x, v, w) => {
      const yy = y(v);
      const h = m.t + ih - yy;
      const r = Math.min(4, h, w / 2);
      return `M${x},${m.t + ih} L${x},${yy + r} Q${x},${yy} ${x + r},${yy}` +
             ` L${x + w - r},${yy} Q${x + w},${yy} ${x + w},${yy + r}` +
             ` L${x + w},${m.t + ih} Z`;
    };

    const band = iw / rows.length;
    const colW = Math.min(20, band * 0.28);
    const gap = 2; // separación en color de superficie entre columnas vecinas

    rows.forEach((r, i) => {
      const cx = m.l + band * i + band / 2;
      const x1 = cx - colW - gap / 2;
      const x2 = cx + gap / 2;
      if (r.income > 0) add(svg, 'path', { d: colPath(x1, r.income, colW), fill: COLORS.income });
      if (r.expense > 0) add(svg, 'path', { d: colPath(x2, r.expense, colW), fill: COLORS.expense });
      add(svg, 'text', {
        x: cx, y: H - 8, 'text-anchor': 'middle', class: 'tick-label',
      }, r.label);
    });

    el.appendChild(svg);
  }

  /* ---------- Barras de una sola serie, con signo ----------
     Para valores que pueden ser negativos (ej. ahorro nominal por mes: un
     mes de retiro neto queda por debajo de la línea de cero) — mismo
     estilo de columna redondeada que trend(), pero con eje que baja de
     cero sólo si hace falta, igual que dailyBalance().
     rows: [{label, value}] · opts: {ariaLabel} */
  function singleBars(el, rows, opts) {
    el.replaceChildren();
    if (!rows.length) return;
    const W = 640, H = 236;
    const m = { t: 10, r: 8, b: 26, l: 56 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;

    const maxVal = Math.max(0, ...rows.map((r) => r.value));
    const minVal = Math.min(0, ...rows.map((r) => r.value));
    let top, bottom, ticks;
    if (minVal >= 0) {
      const nt = niceTicks(Math.max(1, maxVal), 4);
      top = nt.top; bottom = 0; ticks = nt.ticks;
    } else {
      top = niceTicks(Math.max(maxVal, -minVal, 1), 3).top;
      bottom = -top;
      ticks = [bottom, bottom / 2, 0, top / 2, top];
    }
    const range = top - bottom;
    const y = (v) => m.t + ih - ((v - bottom) / range) * ih;
    const yZero = y(0);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'trend-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', opts.ariaLabel || 'Valor por mes');

    const NS = 'http://www.w3.org/2000/svg';
    const add = (parent, tag, attrs, text) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      if (text !== undefined) n.textContent = text;
      parent.appendChild(n);
      return n;
    };

    for (const t of ticks) {
      const yy = y(t);
      add(svg, 'line', {
        x1: m.l, x2: W - m.r, y1: yy, y2: yy,
        stroke: t === 0 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1,
        'shape-rendering': 'crispEdges',
      });
      add(svg, 'text', {
        x: m.l - 8, y: yy + 3.5, 'text-anchor': 'end', class: 'tick-label',
      }, compact(t));
    }

    const band = iw / rows.length;
    const colW = Math.min(28, band * 0.5);

    rows.forEach((r, i) => {
      const cx = m.l + band * i + band / 2;
      const x0 = cx - colW / 2;
      const yy = y(r.value);
      const color = r.value >= 0 ? COLORS.income : COLORS.expense;
      const h = Math.abs(yy - yZero);
      const rad = Math.min(4, h, colW / 2);
      if (r.value !== 0) {
        const d = r.value >= 0
          ? `M${x0},${yZero} L${x0},${yy + rad} Q${x0},${yy} ${x0 + rad},${yy}` +
            ` L${x0 + colW - rad},${yy} Q${x0 + colW},${yy} ${x0 + colW},${yy + rad} L${x0 + colW},${yZero} Z`
          : `M${x0},${yZero} L${x0},${yy - rad} Q${x0},${yy} ${x0 + rad},${yy}` +
            ` L${x0 + colW - rad},${yy} Q${x0 + colW},${yy} ${x0 + colW},${yy - rad} L${x0 + colW},${yZero} Z`;
        add(svg, 'path', { d, fill: color });
      }
      add(svg, 'text', {
        x: cx, y: H - 8, 'text-anchor': 'middle', class: 'tick-label',
      }, r.label);
    });

    el.appendChild(svg);
  }

  // Curva suave (Catmull-Rom → Bézier cúbica) a través de una lista de
  // puntos, en vez del trazo recto punto-a-punto de siempre — opcional
  // (opts.smooth), así los gráficos que ya la usan sin pedirla no cambian.
  function smoothPathD(pts) {
    if (pts.length < 2) return '';
    if (pts.length === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`;
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
    }
    return d;
  }

  /* ---------- Líneas: evolución de una o más series por mes ----------
     months: [label] · series: [{label, color, values: [n, ...]}] (mismo
     largo que months) · opts: {fmt, ariaLabel, smooth, pointLabels,
     markerRadius} */
  function lines(el, months, series, opts) {
    el.replaceChildren();
    if (!months.length) return;
    const W = 640, H = 220;
    const m = { t: opts.topPad || 10, r: 8, b: 26, l: 34 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;

    // El eje sólo baja de cero si alguna serie realmente tiene un valor
    // negativo (ej. una tasa de ahorro negativa un mes) — si todo es
    // positivo, no tiene sentido reservar la mitad del gráfico de más.
    const allVals = series.flatMap((s) => s.values);
    const maxVal = Math.max(0, ...allVals);
    const minVal = Math.min(0, ...allVals);
    let top, bottom, ticks;
    if (minVal >= 0) {
      const nt = niceTicks(Math.max(1, maxVal), 4);
      top = nt.top; bottom = 0; ticks = nt.ticks;
    } else {
      top = niceTicks(Math.max(maxVal, -minVal, 1), 3).top;
      bottom = -top;
      ticks = [bottom, bottom / 2, 0, top / 2, top];
    }
    const range = top - bottom;
    const y = (v) => m.t + ih - ((v - bottom) / range) * ih;
    const band = iw / months.length;
    const x = (i) => m.l + band * i + band / 2;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'trend-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', opts.ariaLabel || 'Evolución mensual');

    const NS = 'http://www.w3.org/2000/svg';
    const add = (parent, tag, attrs, text) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      if (text !== undefined) n.textContent = text;
      parent.appendChild(n);
      return n;
    };

    for (const t of ticks) {
      const yy = y(t);
      add(svg, 'line', {
        x1: m.l, x2: W - m.r, y1: yy, y2: yy,
        stroke: t === 0 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1,
        'shape-rendering': 'crispEdges',
      });
      add(svg, 'text', {
        x: m.l - 6, y: yy + 3.5, 'text-anchor': 'end', class: 'tick-label',
      }, (opts.fmtAxis ? opts.fmtAxis(t) : Math.round(t)));
    }

    months.forEach((lbl, i) => {
      add(svg, 'text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'tick-label' }, lbl);
    });

    const markerR = opts.markerRadius || 3;
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => ({ x: x(i), y: y(v) }));
      const d = opts.smooth ? smoothPathD(pts) : pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
      add(svg, 'path', {
        d, fill: 'none', stroke: s.color, 'stroke-width': 2,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      });
      pts.forEach((p, i) => {
        add(svg, 'circle', { cx: p.x, cy: p.y, r: markerR, fill: s.color });
        if (opts.pointLabels) {
          const attrs = {
            x: p.x, y: p.y + (si === 0 ? -8 : 14), 'text-anchor': 'middle',
            class: 'point-label', fill: s.color,
          };
          // font-size como atributo de presentación pierde contra la regla
          // CSS ".point-label" (shorthand "font"); hace falta "style" inline
          // para poder pisarlo.
          if (opts.pointLabelSize) attrs.style = `font-size:${opts.pointLabelSize}px`;
          add(svg, 'text', attrs, opts.fmtAxis ? opts.fmtAxis(s.values[i]) : Math.round(s.values[i]));
        }
      });
    });

    el.appendChild(svg);
  }

  // Oscurece un color hex (para la pared del gráfico de torta cilindro).
  function darken(hex, factor) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
    const d = (c) => Math.max(0, Math.min(255, Math.round(c * factor)));
    return `rgb(${d(r)},${d(g)},${d(b)})`;
  }

  /* ---------- Torta con look de cilindro/tambor (pseudo-3D) ----------
     items: [{label, value, color}] · opts: {ariaLabel}. La "pared" del
     frente (mitad inferior de la elipse) se pinta en tiras finas de 2° cada
     una, coloreadas según a qué porción le toca ese ángulo — así la pared
     queda dividida igual que la cara de arriba sin tener que recortar el
     arco de cada gajo a mano. */
  function pieCylinder(el, items, opts) {
    el.replaceChildren();
    const total = items.reduce((a, i) => a + i.value, 0);
    if (!items.length || total <= 0) return;

    const W = 300, H = 210;
    const cx = W / 2, cy = 88, rx = 108, ry = 62, wallH = 20;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', opts.ariaLabel || 'Distribución por categoría');

    const add = (parent, tag, attrs) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      parent.appendChild(n);
      return n;
    };
    const pt = (deg, yOff) => {
      const rad = (deg * Math.PI) / 180;
      return { x: cx + rx * Math.cos(rad), y: cy + ry * Math.sin(rad) + (yOff || 0) };
    };

    // Ángulo acumulado de cada gajo, arrancando arriba (-90°) en sentido horario.
    let acc = 0;
    const segs = items.map((it) => {
      const a0 = -90 + (acc / total) * 360;
      acc += it.value;
      const a1 = -90 + (acc / total) * 360;
      return { ...it, a0, a1 };
    });
    const colorAt = (deg) => {
      let d = deg;
      while (d < -90) d += 360;
      while (d >= 270) d -= 360;
      const seg = segs.find((s) => d >= s.a0 - 0.01 && d < s.a1 + 0.01);
      return (seg || segs[segs.length - 1]).color;
    };

    // Pared frontal (0° a 180°, "sur" de la elipse — la única mitad visible
    // porque la cara de arriba tapa el resto).
    for (let d = 0; d < 180; d += 2) {
      const d2 = Math.min(d + 2, 180);
      const p1 = pt(d, 0), p2 = pt(d2, 0), p3 = pt(d2, wallH), p4 = pt(d, wallH);
      add(svg, 'path', {
        d: `M${p1.x},${p1.y} L${p2.x},${p2.y} L${p3.x},${p3.y} L${p4.x},${p4.y} Z`,
        fill: darken(colorAt((d + d2) / 2), 0.7), stroke: 'none',
      });
    }

    // Cara de arriba: los gajos de la torta.
    segs.forEach((s) => {
      if (s.a1 <= s.a0) return;
      const large = s.a1 - s.a0 > 180 ? 1 : 0;
      const p0 = pt(s.a0, 0), p1 = pt(s.a1, 0);
      add(svg, 'path', {
        d: `M${cx},${cy} L${p0.x},${p0.y} A${rx},${ry} 0 ${large} 1 ${p1.x},${p1.y} Z`,
        fill: s.color, stroke: 'var(--surface)', 'stroke-width': 1.5,
      });
    });

    el.appendChild(svg);
  }

  /* ---------- Barras apiladas al 100%: participación de cada categoría
     mes a mes ----------
     rows: [{label, total, shares:[pct,...]}] (shares en el mismo orden que
     cats) · cats: [{name, color}] · opts: {ariaLabel}. Un mes sin gastos se
     pinta como una barra gris entera (no hay participación que mostrar). */
  function stacked100(el, rows, cats, opts) {
    el.replaceChildren();
    if (!rows.length) return;
    const W = 640, H = 240;
    const m = { t: 10, r: 8, b: 26, l: 40 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'trend-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', opts.ariaLabel || 'Participación de cada categoría por mes');

    const NS = 'http://www.w3.org/2000/svg';
    const add = (parent, tag, attrs, text) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      if (text !== undefined) n.textContent = text;
      parent.appendChild(n);
      return n;
    };

    [0, 25, 50, 75, 100].forEach((p) => {
      const yy = m.t + ih - (p / 100) * ih;
      add(svg, 'line', {
        x1: m.l, x2: W - m.r, y1: yy, y2: yy,
        stroke: p === 0 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1,
        'shape-rendering': 'crispEdges',
      });
      add(svg, 'text', { x: m.l - 6, y: yy + 3.5, 'text-anchor': 'end', class: 'tick-label' }, p + '%');
    });

    const band = iw / rows.length;
    const colW = Math.min(34, band * 0.5);
    rows.forEach((r, i) => {
      const cx = m.l + band * i + band / 2;
      const x0 = cx - colW / 2;
      if (r.total > 0) {
        let yCursor = m.t + ih;
        r.shares.forEach((pct, ci) => {
          if (pct <= 0) return;
          const h = (pct / 100) * ih;
          yCursor -= h;
          add(svg, 'rect', { x: x0, y: yCursor, width: colW, height: h, fill: cats[ci].color });
        });
      } else {
        add(svg, 'rect', { x: x0, y: m.t, width: colW, height: ih, fill: 'var(--surface-2)', rx: 3 });
      }
      add(svg, 'text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'tick-label' }, r.label);
    });

    el.appendChild(svg);
  }

  function compact(n) {
    const sign = n < 0 ? '-' : '';
    const a = Math.abs(n);
    if (a >= 1e6) return sign + Math.round(a / 1e6) + ' M';
    if (a >= 1e3) return sign + Math.round(a / 1e3) + ' mil';
    return String(Math.round(n));
  }

  /* ---------- Balance acumulado por día del mes ----------
     points: [{day, value}] uno por cada día DEL MES ENTERO (1 al último),
     con value en null para los días que todavía no llegaron (no se
     proyecta una línea plana a futuro, pero el eje sigue mostrando el mes
     completo) · opts: {ariaLabel, prevPoints}. El eje Y baja de cero sólo si
     el balance acumulado realmente llega a ser negativo algún día.
     opts.prevPoints (mismo formato, mes anterior) se dibuja como línea
     punteada detrás de la línea del mes actual, alineada por número de día,
     para comparar de un vistazo si un tramo en rojo ya venía del mes pasado. */
  function dailyBalance(el, points, opts) {
    el.replaceChildren();
    if (!points.length) return;
    const known = points.filter((p) => p.value != null);
    if (!known.length) {
      el.innerHTML = '<div class="empty">Todavía no hay movimientos este mes.</div>';
      return;
    }
    const prevPoints = (opts.prevPoints || []).filter((p) => p.value != null);
    const W = 640, H = 200;
    const m = { t: 10, r: 8, b: 22, l: 58 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;

    // El eje sólo baja de cero si el balance realmente llega a ser negativo
    // algún día (no tiene sentido reservar la mitad del gráfico para
    // negativos si el mes nunca se fue en rojo). Si hay mes anterior de
    // comparación, sus valores también entran en la escala para que ambas
    // líneas queden a la misma altura relativa.
    const allVals = known.map((p) => p.value).concat(prevPoints.map((p) => p.value));
    const maxVal = Math.max(0, ...allVals);
    const minVal = Math.min(0, ...allVals);
    let top, bottom, ticks;
    if (minVal >= 0) {
      const nt = niceTicks(Math.max(1, maxVal), 4);
      top = nt.top; bottom = 0; ticks = nt.ticks;
    } else {
      top = niceTicks(Math.max(maxVal, -minVal, 1), 3).top;
      bottom = -top;
      ticks = [bottom, bottom / 2, 0, top / 2, top];
    }
    const range = top - bottom;
    const y = (v) => m.t + ih - ((v - bottom) / range) * ih;
    const dayCount = Math.max(points.length, opts.prevPoints ? opts.prevPoints.length : 0);
    const band = iw / dayCount;
    const x = (i) => m.l + band * i + band / 2;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'trend-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', opts.ariaLabel || 'Balance acumulado por día del mes');

    const NS = 'http://www.w3.org/2000/svg';
    const add = (parent, tag, attrs, text) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      if (text !== undefined) n.textContent = text;
      parent.appendChild(n);
      return n;
    };

    for (const t of ticks) {
      const yy = y(t);
      add(svg, 'line', {
        x1: m.l, x2: W - m.r, y1: yy, y2: yy,
        stroke: t === 0 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1,
        'shape-rendering': 'crispEdges',
      });
      add(svg, 'text', {
        x: m.l - 8, y: yy + 3.5, 'text-anchor': 'end', class: 'tick-label',
      }, compact(t));
    }

    // Días en el eje X: no entran los 31 números sin amontonarse, así que
    // se etiqueta el primero, el último y cada 5.
    points.forEach((p, i) => {
      if (p.day === 1 || p.day === points.length || p.day % 5 === 0) {
        add(svg, 'text', { x: x(i), y: H - 6, 'text-anchor': 'middle', class: 'tick-label' }, String(p.day));
      }
    });

    // Mes anterior primero (detrás), punteado, para que la línea del mes
    // actual quede siempre arriba y sea la que más salta a la vista.
    if (prevPoints.length) {
      const dPrev = prevPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day - 1)},${y(p.value)}`).join(' ');
      add(svg, 'path', {
        d: dPrev, fill: 'none', stroke: 'var(--muted)', 'stroke-width': 2,
        'stroke-dasharray': '5,4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      });
    }

    const d = known.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day - 1)},${y(p.value)}`).join(' ');
    add(svg, 'path', {
      d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    // Punto de hoy (último día cargado): destaca dónde está parado el mes.
    const last = known[known.length - 1];
    add(svg, 'circle', { cx: x(last.day - 1), cy: y(last.value), r: 3.5, fill: 'var(--accent)' });

    el.appendChild(svg);
  }

  return { COLORS, hBars, trend, lines, singleBars, dailyBalance, pieCylinder, stacked100, compact };
})();
