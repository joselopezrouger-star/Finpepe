'use strict';

/* Charts — gráficos SVG/HTML sin dependencias.
   Especificación: marcas finas, extremos redondeados (4px) contra datos y rectos
   contra la línea de base, grilla hairline, tooltip en hover y foco. */
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

  /* ---------- Tooltip único ---------- */
  let tipEl = null;
  function tip() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'chart-tip';
      tipEl.setAttribute('role', 'status');
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }

  /* rows: [{swatch?, label, value}] — labels con textContent (datos no confiables). */
  function tipShow(title, rows, clientX, clientY) {
    const el = tip();
    el.replaceChildren();
    if (title) {
      const h = document.createElement('div');
      h.className = 'chart-tip-title';
      h.textContent = title;
      el.appendChild(h);
    }
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'chart-tip-row';
      if (r.swatch) {
        const k = document.createElement('span');
        k.className = 'chart-tip-key';
        k.style.background = r.swatch;
        row.appendChild(k);
      }
      const v = document.createElement('span');
      v.className = 'chart-tip-value';
      v.textContent = r.value;
      const l = document.createElement('span');
      l.className = 'chart-tip-label';
      l.textContent = r.label;
      row.appendChild(v);
      row.appendChild(l);
      el.appendChild(row);
    }
    el.style.display = 'block';
    position(clientX, clientY);
  }

  function position(x, y) {
    const el = tip();
    const pad = 12;
    const r = el.getBoundingClientRect();
    let left = x + pad;
    let top = y - r.height - pad;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - pad;
    if (top < 8) top = y + pad;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  function tipHide() {
    if (tipEl) tipEl.style.display = 'none';
  }

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
     mismo orden de colores que Charts.donut). */
  function hBars(el, items, opts) {
    el.replaceChildren();
    if (!items.length) return;
    const max = Math.max(...items.map((i) => i.value));
    const fallbackColor = opts.color || COLORS.expense;

    for (const it of items) {
      const color = it.color || fallbackColor;
      const row = document.createElement('div');
      row.className = 'hbar-row';

      const label = document.createElement('span');
      label.className = 'hbar-label';
      if (it.color) {
        const dot = document.createElement('span');
        dot.className = 'hbar-dot';
        dot.style.background = color;
        label.appendChild(dot);
      }
      label.appendChild(document.createTextNode(it.label));

      const track = document.createElement('span');
      track.className = 'hbar-track';
      const bar = document.createElement('span');
      bar.className = 'hbar-bar';
      bar.style.width = Math.max(0.5, (it.value / max) * 100) + '%';
      bar.style.background = color;
      track.appendChild(bar);

      const value = document.createElement('span');
      value.className = 'hbar-value';
      value.textContent = opts.fmt(it.value);

      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(value);

      el.appendChild(row);
    }
  }

  /* ---------- Anillo de participación (donut, sin interacción: el reparto
     se lee por el tamaño de cada arco, no por hover/tap) ----------
     items: [{label, value, color?}] · opts: {size, stroke, color} */
  function donut(el, items, opts) {
    el.replaceChildren();
    const o = opts || {};
    const total = items.reduce((a, i) => a + i.value, 0);
    if (!items.length || total <= 0) return;
    const size = o.size || 104;
    const stroke = o.stroke || 14;
    const r = size / 2 - stroke / 2;
    const c = 2 * Math.PI * r;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', o.ariaLabel || 'Participación de cada categoría en el total');

    const NS = 'http://www.w3.org/2000/svg';
    const add = (attrs) => {
      const n = document.createElementNS(NS, 'circle');
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      svg.appendChild(n);
      return n;
    };

    const gap = items.length > 1 ? 2 : 0; // separación chica entre arcos
    let acc = 0;
    items.forEach((it, i) => {
      const frac = it.value / total;
      const dash = Math.max(0, c * frac - gap);
      add({
        cx: size / 2, cy: size / 2, r, fill: 'none',
        stroke: it.color || COLORS.category,
        'stroke-width': stroke,
        'stroke-linecap': items.length > 1 ? 'round' : 'butt',
        'stroke-dasharray': `${dash} ${c - dash}`,
        'stroke-dashoffset': c * (1 - acc),
        transform: `rotate(-90 ${size / 2} ${size / 2})`,
      });
      acc += frac;
    });

    el.appendChild(svg);
  }

  /* ---------- Columnas agrupadas: ingresos vs gastos por mes ----------
     rows: [{label, income, expense}] · opts: {fmt} */
  function trend(el, rows, opts) {
    el.replaceChildren();
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

      // Zona de hover por mes: un solo tooltip con las dos series
      const hit = add(svg, 'rect', {
        x: m.l + band * i, y: m.t, width: band, height: ih,
        fill: 'transparent', tabindex: 0,
      });
      const show = (x, yy) =>
        tipShow(r.label, [
          { swatch: COLORS.income, label: 'Ingresos', value: opts.fmt(r.income) },
          { swatch: COLORS.expense, label: 'Gastos', value: opts.fmt(r.expense) },
        ], x, yy);
      hit.addEventListener('pointermove', (e) => show(e.clientX, e.clientY));
      hit.addEventListener('pointerleave', tipHide);
      hit.addEventListener('focus', () => {
        const b = hit.getBoundingClientRect();
        show(b.left + b.width / 2, b.top + 30);
      });
      hit.addEventListener('blur', tipHide);
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

    // Zona de hover por mes: un solo tooltip con el valor de cada serie.
    months.forEach((lbl, i) => {
      const hit = add(svg, 'rect', {
        x: m.l + band * i, y: m.t, width: band, height: ih,
        fill: 'transparent', tabindex: 0,
      });
      const show = (cx, cy) =>
        tipShow(lbl, series.map((s) => ({
          swatch: s.color, label: s.label, value: opts.fmt(s.values[i]),
        })), cx, cy);
      hit.addEventListener('pointermove', (e) => show(e.clientX, e.clientY));
      hit.addEventListener('pointerleave', tipHide);
      hit.addEventListener('focus', () => {
        const b = hit.getBoundingClientRect();
        show(b.left + b.width / 2, b.top + 30);
      });
      hit.addEventListener('blur', tipHide);
    });

    el.appendChild(svg);
  }

  function compact(n) {
    if (n >= 1e6) return trim(n / 1e6) + ' M';
    if (n >= 1e3) return trim(n / 1e3) + ' mil';
    return String(Math.round(n));
  }
  function trim(x) {
    return (Math.round(x * 10) / 10).toString().replace('.', ',');
  }

  return { COLORS, hBars, donut, trend, lines, tipHide };
})();
