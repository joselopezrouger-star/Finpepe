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
    const step = niceStep(max / count);
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

  /* ---------- Líneas: evolución de una o más series por mes ----------
     months: [label] · series: [{label, color, values: [n, ...]}] (mismo
     largo que months) · opts: {fmt, ariaLabel} */
  function lines(el, months, series, opts) {
    el.replaceChildren();
    if (!months.length) return;
    const W = 640, H = 220;
    const m = { t: 10, r: 8, b: 26, l: 34 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;

    const maxVal = Math.max(1, ...series.flatMap((s) => s.values));
    const { top, ticks } = niceTicks(maxVal, 4);
    const y = (v) => m.t + ih - (v / top) * ih;
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

    series.forEach((s) => {
      const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ');
      add(svg, 'path', {
        d, fill: 'none', stroke: s.color, 'stroke-width': 2,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      });
      s.values.forEach((v, i) => add(svg, 'circle', { cx: x(i), cy: y(v), r: 3, fill: s.color }));
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
     completo) · opts: {ariaLabel, compact}. El eje Y baja de cero sólo si
     el balance acumulado realmente llega a ser negativo algún día.
     Con opts.compact: versión mini tipo "sparkline" para vivir pegada
     debajo del número de Balance del mes (sin ejes ni grilla, sólo la
     línea y el punto de hoy). */
  function dailyBalance(el, points, opts) {
    el.replaceChildren();
    if (!points.length) return;
    const known = points.filter((p) => p.value != null);
    if (!known.length) {
      el.innerHTML = '<div class="empty">Todavía no hay movimientos este mes.</div>';
      return;
    }
    const isCompact = !!opts.compact;
    const W = isCompact ? 640 : 640, H = isCompact ? 72 : 200;
    const m = isCompact ? { t: 6, r: 2, b: 6, l: 2 } : { t: 10, r: 8, b: 22, l: 58 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;

    // El eje sólo baja de cero si el balance realmente llega a ser negativo
    // algún día (no tiene sentido reservar la mitad del gráfico para
    // negativos si el mes nunca se fue en rojo).
    const maxVal = Math.max(0, ...known.map((p) => p.value));
    const minVal = Math.min(0, ...known.map((p) => p.value));
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
    const band = iw / points.length;
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

    if (!isCompact) {
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
    } else if (bottom < 0 && top > 0) {
      // Compacto: sin grilla, pero conserva la línea de cero como
      // referencia si el balance llegó a ser negativo algún día.
      const yy = y(0);
      add(svg, 'line', {
        x1: m.l, x2: W - m.r, y1: yy, y2: yy,
        stroke: 'var(--axis)', 'stroke-width': 1, 'stroke-dasharray': '3 3',
      });
    }

    const d = known.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day - 1)},${y(p.value)}`).join(' ');
    add(svg, 'path', {
      d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': isCompact ? 2.5 : 2,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    // Punto de hoy (último día cargado): destaca dónde está parado el mes.
    const last = known[known.length - 1];
    add(svg, 'circle', { cx: x(last.day - 1), cy: y(last.value), r: isCompact ? 3 : 3.5, fill: 'var(--accent)' });

    el.appendChild(svg);
  }

  return { COLORS, hBars, trend, lines, dailyBalance };
})();
