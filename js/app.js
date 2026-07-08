'use strict';

/* Finpepe — lógica de la aplicación. */
(() => {
  const S = () => Store.state;

  /* ================= Helpers ================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Vibración cortita al tocar el teclado numérico (feedback táctil). No
  // todos los navegadores exponen navigator.vibrate (iOS Safari no), así
  // que es un no-op silencioso ahí.
  function haptic() {
    if (navigator.vibrate) navigator.vibrate(10);
  }

  const pad = (n) => String(n).padStart(2, '0');
  const dateToStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => dateToStr(new Date());
  const parseDate = (str) => {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const monthKeyOf = (dateStr) => dateStr.slice(0, 7);
  const curMonth = () => monthKeyOf(todayStr());
  const addMonthsKey = (mk, n) => {
    const [y, m] = mk.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  };
  const clampDate = (y, m0, day) => {
    const dim = new Date(y, m0 + 1, 0).getDate();
    return new Date(y, m0, Math.min(day, dim));
  };

  const monthLongFmt = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' });
  const monthShortFmt = new Intl.DateTimeFormat('es-AR', { month: 'short' });
  const dayMonthFmt = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' });
  const dateShortFmt = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const dateFullFmt = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' });

  const monthLabel = (mk) => {
    const [y, m] = mk.split('-').map(Number);
    const s = monthLongFmt.format(new Date(y, m - 1, 1));
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  // Solo el nombre del mes, sin año: para las variaciones de la tarjeta
  // principal ("vs. Junio"), donde repetir el año de a poco sobra.
  const monthNameFmt = new Intl.DateTimeFormat('es-AR', { month: 'long' });
  const monthNameOnly = (mk) => {
    const [y, m] = mk.split('-').map(Number);
    const s = monthNameFmt.format(new Date(y, m - 1, 1));
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const fmtDay = (d) => dayMonthFmt.format(d);
  const fmtDateShort = (str) => dateShortFmt.format(parseDate(str));
  const fmtDateFull = (str) => {
    const s = dateFullFmt.format(parseDate(str));
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const weekdayFmt = new Intl.DateTimeFormat('es-AR', { weekday: 'long' });
  function dayGroupLabel(dateStr) {
    const yesterday = new Date(); yesterday.setHours(0, 0, 0, 0); yesterday.setDate(yesterday.getDate() - 1);
    let rel;
    if (dateStr === todayStr()) rel = 'Hoy';
    else if (dateStr === dateToStr(yesterday)) rel = 'Ayer';
    else {
      const w = weekdayFmt.format(parseDate(dateStr));
      rel = w.charAt(0).toUpperCase() + w.slice(1);
    }
    return `${rel}, ${fmtDay(parseDate(dateStr))}`;
  }
  /* Agrupa una lista ya ordenada por fecha (desc) en bloques por día. */
  function dayGroups(list) {
    const groups = [];
    for (const t of list) {
      const last = groups[groups.length - 1];
      if (last && last.dateStr === t.date) last.items.push(t);
      else groups.push({ dateStr: t.date, items: [t] });
    }
    return groups;
  }

  const nfARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  const nfUSD = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const fmtMoney = (n, cur) => (cur === 'USD' ? nfUSD : nfARS).format(n);
  const nfHero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

  const disp = () => S().settings.displayCurrency;
  const rate = () => FX.currentRate(S());
  const toDisp = (amount, cur) => FX.convert(amount, cur, disp(), rate() ? rate().value : null);
  const fmtDisp = (n) => (n == null || !isFinite(n)) ? '—' : fmtMoney(n, disp());
  const convOrNull = (amount, cur) => toDisp(amount, cur);

  /* Monto de un movimiento guardado, en la moneda de visualización.
     Los gastos/ingresos en ARS llevan un "usdSnapshot": el equivalente en
     dólares al momento de cargarlos (con la cotización de ese día), para que
     ver el historial en USD no se distorsione por la inflación entre medio.
     Si no hay snapshot (movimientos viejos) o se muestra en ARS, se
     convierte con la cotización actual como antes. */
  function txDispAmount(t) {
    if (t.currency === disp()) return t.amount;
    if (disp() === 'USD' && t.currency === 'ARS' && t.usdSnapshot != null) return t.usdSnapshot;
    return convOrNull(t.amount, t.currency);
  }

  /* Equivalente en USD de un monto en ARS, con la cotización del momento
     (null si no hay cotización disponible todavía). */
  function usdSnapshotFor(amount, currency) {
    if (currency !== 'ARS') return null;
    const r = rate();
    return r ? Math.round(FX.convert(amount, 'ARS', 'USD', r.value) * 100) / 100 : null;
  }

  /* Igual que usdSnapshotFor, pero busca la cotización DEL DÍA del
     movimiento (no la del momento en que se carga) — para que un gasto
     viejo cargado hoy quede en USD a la cotización de su propia fecha, no a
     la de hoy. Si no hay dato histórico para esa fecha/fuente (fecha
     futura, feriado, fuente sin cobertura, sin conexión) o hay una
     cotización manual fijada, cae de vuelta a usdSnapshotFor(). */
  async function usdSnapshotForDate(amount, currency, dateStr) {
    if (currency !== 'ARS') return null;
    const s = S().settings;
    if (typeof s.manualRate === 'number' && s.manualRate > 0) return usdSnapshotFor(amount, currency);
    // Fechas futuras (ej. próximas cuotas de una compra en cuotas) no tienen
    // cotización histórica todavía: ni vale la pena pedirla por red, se usa
    // la vigente directo.
    if (dateStr > todayStr()) return usdSnapshotFor(amount, currency);
    const hist = await FX.fetchHistoricalRate(s.fxSource, dateStr);
    if (hist && hist.venta > 0) return Math.round(FX.convert(amount, 'ARS', 'USD', hist.venta) * 100) / 100;
    return usdSnapshotFor(amount, currency);
  }

  // Número protagonista (ej. Patrimonio neto): sin decimales, como el resto
  // de los montos de la app.
  function heroMoneyHTML(n, cur) {
    if (n == null || !isFinite(n)) return '—';
    const symbol = cur === 'USD' ? 'US$' : '$';
    const sign = n < 0 ? '−' : '';
    return `<span class="hero-amount">
      <span class="hero-amount-sym">${symbol}</span>${sign}<span class="hero-amount-int">${esc(nfHero.format(Math.abs(n)))}</span>
    </span>`;
  }

  /* Suma una lista de transacciones en la moneda de visualización.
     Las que no se pueden convertir (sin cotización) se omiten. */
  function sumDisp(txs) {
    let total = 0;
    for (const t of txs) {
      const v = txDispAmount(t);
      if (v != null) total += v;
    }
    return total;
  }

  const catById = (id) => S().categories.find((c) => c.id === id);
  const methodById = (id) => S().methods.find((m) => m.id === id);
  const catName = (id) => (catById(id) || {}).name || '—';
  const methodName = (id) => (methodById(id) || {}).name || '—';

  /* Categorías con dos niveles: un grupo (parentId null) puede tener
     subcategorías (parentId = id del grupo). Un grupo sin hijos se usa
     directamente como categoría. */
  const catGroups = (type) => S().categories.filter((c) => c.type === type && !c.parentId);
  const catChildren = (parentId) => S().categories.filter((c) => c.parentId === parentId);
  const useSubcats = () => S().settings.useSubcategories;

  // Categorías que se pueden asignar a un movimiento: con subcategorías
  // activas, solo hojas (grupos sin hijos + subcategorías); si no, todas.
  function selectableCats(type) {
    if (!useSubcats()) return S().categories.filter((c) => c.type === type);
    return S().categories.filter((c) => c.type === type && (c.parentId || !catChildren(c.id).length));
  }

  // Sube hasta el grupo de más arriba (para agrupar reportes por categoría).
  function topCategoryOf(id) {
    const c = catById(id);
    if (!c || !c.parentId) return id;
    return topCategoryOf(c.parentId);
  }

  const KIND_LABEL = {
    efectivo: 'Efectivo', debito: 'Débito', caja_ahorro: 'Caja de ahorro', credito: 'Crédito', billetera: 'Billetera virtual',
  };

  /* ================= Iconos (SVG propios, sin depender de una librería externa) ================= */
  const ICON_PATHS = {
    home: '<path d="M3 9.5 10 3l7 6.5"/><path d="M5 8v9h10V8"/><path d="M8.3 17v-4.3h3.4V17"/>',
    food: '<path d="M6 3v6a2 2 0 0 0 4 0V3"/><path d="M8 9v8"/><path d="M14 3c-1.5 0-2 2-2 4s.9 3 2 3v7"/>',
    car: '<path d="M4 12l1.4-4.4A2 2 0 0 1 7.3 6.2h5.4a2 2 0 0 1 1.9 1.4L16 12"/><rect x="3" y="12" width="14" height="4" rx="1.4"/><circle cx="6.6" cy="17" r="1.2"/><circle cx="13.4" cy="17" r="1.2"/>',
    heart: '<path d="M10 17s-6-3.7-6-8.2A3.8 3.8 0 0 1 10 6a3.8 3.8 0 0 1 6 2.8C16 13.3 10 17 10 17z"/>',
    film: '<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M8.3 7.3v5.4l4.3-2.7-4.3-2.7z"/>',
    shirt: '<path d="M7 3 4 5.5 5.5 8 7 6.8V17h6V6.8L14.5 8 16 5.5 13 3l-1.4 1.4a2.2 2.2 0 0 1-3 0L7 3z"/>',
    book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H10v14H5.5A1.5 1.5 0 0 0 4 18.5z"/><path d="M16 4.5A1.5 1.5 0 0 0 14.5 3H10v14h4.5a1.5 1.5 0 0 1 1.5 1.5z"/>',
    plane: '<path d="M10 3v6l6 3v2l-6-1.5V17l2 1.4v1L10 19l-2 .4v-1l2-1.4v-4.6l-6 1.5v-2l6-3V3z"/>',
    receipt: '<path d="M5 3h10v14l-2-1.3L11 17l-2-1.3L7 17l-2-1.3z"/><path d="M7.5 8h5M7.5 11h3"/>',
    tag: '<path d="M11 3 17 9l-8 8-6-6 8-8z"/><circle cx="13" cy="6" r="1" fill="currentColor" stroke="none"/>',
    wallet: '<rect x="3" y="6" width="14" height="10" rx="2"/><path d="M3 9h14"/><circle cx="14" cy="12.5" r="1.1" fill="currentColor" stroke="none"/>',
    briefcase: '<rect x="3" y="7" width="14" height="9" rx="1.5"/><path d="M7 7V5.5A1.5 1.5 0 0 1 8.5 4h3A1.5 1.5 0 0 1 13 5.5V7"/><path d="M3 11h14"/>',
    trend: '<path d="M3 13l5-5 3 3 6-6"/><path d="M13 4h4v4"/>',
    bag: '<path d="M5 7h10l1 10a1.5 1.5 0 0 1-1.5 1.7h-9A1.5 1.5 0 0 1 4 17z"/><path d="M7 7V5.5a3 3 0 0 1 6 0V7"/>',
    dots: '<circle cx="6" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="14" cy="10" r="1.2" fill="currentColor" stroke="none"/>',
    card: '<rect x="3" y="5" width="14" height="10" rx="2"/><path d="M3 8.5h14"/><path d="M6 12h3"/>',
    cash: '<rect x="2.5" y="5.5" width="15" height="9" rx="1.5"/><circle cx="10" cy="10" r="2.2"/>',
    plus: '<circle cx="10" cy="10" r="7.2"/><path d="M10 6.8v6.4M6.8 10h6.4"/>',
    swap: '<path d="M4 7h10.5M12 4.2 15 7l-3 2.8"/><path d="M16 13H5.5M8 10.2 5 13l3 2.8"/>',
    calendar: '<rect x="3" y="4.5" width="14" height="12" rx="1.5"/><path d="M3 8h14"/><path d="M6.5 3v3M13.5 3v3"/>',
  };
  function iconSvg(name, cls) {
    const body = ICON_PATHS[name] || ICON_PATHS.tag;
    return `<svg class="${cls || ''}" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }
  // El logo de Google es multicolor (no monocromo como los íconos de arriba),
  // así que va como su propio SVG fijo en vez de sumarse a ICON_PATHS.
  const GOOGLE_G_SVG = `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
    <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.68 9c0-.593.102-1.17.284-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"/>
  </svg>`;
  // Engranaje de verdad (dientes, no rayos): el ícono anterior -un círculo
  // con líneas radiales- se confundía con el típico ícono de "sol" para
  // cambiar a modo claro. Este es el clásico ícono de ajustes (viewBox
  // propio de 24x24, no encaja en el sistema de 20x20 de ICON_PATHS).
  const SETTINGS_GEAR_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>`;
  // Anillo doble: aro externo = % del ingreso que todavía no se gastó, aro
  // interno = % del mes que todavía falta transcurrir. Comparar los dos de
  // un vistazo muestra si el ritmo de gasto va por delante o por detrás del
  // calendario (ej. "me queda 50% de plata pero 70% del mes", voy flojo).
  function ringSvg2(pctOuter, pctInner, size) {
    size = size || 76;
    const arc = (r, stroke, pct, colorVar) => {
      const c = 2 * Math.PI * r;
      const p = Math.max(0, Math.min(100, pct));
      const off = c * (1 - p / 100);
      return `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" style="stroke:var(--border)" stroke-width="${stroke}"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" style="stroke:var(${colorVar})" stroke-width="${stroke}"
          stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}"
          transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
    };
    const strokeO = 7, strokeI = 6, gap = 3;
    const rO = size / 2 - strokeO / 2 - 1;
    const rI = rO - strokeO / 2 - gap - strokeI / 2;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      ${arc(rO, strokeO, pctOuter, '--accent')}
      ${arc(rI, strokeI, pctInner, '--warn')}
    </svg>`;
  }
  // Mismo criterio de color en todo el degradé del velocímetro
  // (crit→warn→good): se usa tanto para pintar la barra como el número
  // grande de adentro.
  function speedoColorFor(pct) {
    const p = Math.max(0, Math.min(100, pct)) / 100;
    return p <= 0.5
      ? `color-mix(in srgb, var(--gauge-warn) ${Math.round((p / 0.5) * 100)}%, var(--gauge-crit))`
      : `color-mix(in srgb, var(--gauge-good) ${Math.round(((p - 0.5) / 0.5) * 100)}%, var(--gauge-warn))`;
  }
  // "Velocímetro" horizontal (barra recta, no arco): a la izquierda 0%
  // (rojo), a la derecha 100% (verde). Arriba de la barra van el % grande
  // y la etiqueta "Balance del mes", centrados; debajo de la barra sólo
  // quedan las referencias 0% y 100% (los extremos, no toda la escala).
  // El ancho real en pantalla lo fija el CSS (hero-speedo-section svg),
  // acá sólo se define la proporción interna.
  function speedoGaugeSvg(pct, viewW) {
    viewW = viewW || 220;
    const padX = 14;
    const labelSize = Math.round(viewW * 0.16);
    const sublabelSize = Math.round(viewW * 0.065);
    const labelTopY = 2;
    const sublabelTopY = labelTopY + labelSize + 4;
    const barH = Math.max(10, Math.round(viewW * 0.055));
    const barTopY = sublabelTopY + sublabelSize + 10;
    const barCenterY = barTopY + barH / 2;
    const tickY = barCenterY + barH / 2 + 14;
    const height = tickY + 4;
    const p0 = { x: padX, y: barCenterY };
    const p1 = { x: viewW - padX, y: barCenterY };
    const p = Math.max(0, Math.min(100, pct)) / 100;
    const markerX = p0.x + (p1.x - p0.x) * p;
    const gradId = 'speedoGrad' + Math.round(Math.random() * 1e6);
    const tick0 = `<text x="${p0.x}" y="${tickY}" text-anchor="start" font-size="10.5" fill="var(--muted)" font-family="var(--font)">0%</text>`;
    const tick100 = `<text x="${p1.x}" y="${tickY}" text-anchor="end" font-size="10.5" fill="var(--muted)" font-family="var(--font)">100%</text>`;
    const textColor = speedoColorFor(pct);
    return `<svg width="100%" height="${height}" viewBox="0 0 ${viewW} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Balance del mes: ${Math.round(pct)}%">
      <defs>
        <linearGradient id="${gradId}" x1="${p0.x}" y1="${p0.y}" x2="${p1.x}" y2="${p1.y}" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="var(--gauge-crit)"/>
          <stop offset="50%" stop-color="var(--gauge-warn)"/>
          <stop offset="100%" stop-color="var(--gauge-good)"/>
        </linearGradient>
      </defs>
      <line x1="${p0.x}" y1="${p0.y}" x2="${p1.x}" y2="${p1.y}" stroke="url(#${gradId})" stroke-width="${barH}" stroke-linecap="round"/>
      <line x1="${markerX}" y1="${barCenterY - 9}" x2="${markerX}" y2="${barCenterY + 9}" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>
      ${tick0}${tick100}
      <text x="${viewW / 2}" y="${labelTopY}" text-anchor="middle" dominant-baseline="hanging" font-size="${labelSize}" font-weight="800" fill="${textColor}" font-family="var(--font-heading)">${Math.round(pct)}%</text>
      <text x="${viewW / 2}" y="${sublabelTopY}" text-anchor="middle" dominant-baseline="hanging" font-size="${sublabelSize}" fill="var(--muted)" font-family="var(--font)">Balance del mes</text>
    </svg>`;
  }
  // % del mes elegido que todavía falta transcurrir (100 = no empezó, 0 = ya
  // terminó) — para dibujar el arco del anillo, que necesita una escala 0-100.
  function monthLeftPct(mk) {
    const cm = curMonth();
    if (mk < cm) return 0;
    if (mk > cm) return 100;
    const [y, m] = mk.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const day = new Date().getDate();
    return Math.max(0, Math.min(100, Math.round(((daysInMonth - day) / daysInMonth) * 100)));
  }
  // Días que faltan para que termine el mes elegido, en nominal (no %):
  // lo que se muestra en la leyenda, más fácil de leer que un porcentaje.
  function daysLeftInMonth(mk) {
    const cm = curMonth();
    const [y, m] = mk.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    if (mk < cm) return 0;
    if (mk > cm) return daysInMonth;
    return Math.max(0, daysInMonth - new Date().getDate());
  }
  // Paleta fija para diferenciar categorías en "Gastos por categoría" (barras
  // + anillo de participación): distinta de los colores semánticos
  // (ingreso/gasto/acento), que ya están reservados para otras cosas.
  const CAT_PALETTE = ['#08d59d', '#f5d142', '#ff8a5c', '#5b8def', '#c77dff', '#ff5e5b', '#4dd0e1', '#94a3b8'];
  const CAT_ICON = {
    'c-casa': 'home', 'c-comida': 'food', 'c-auto': 'car', 'c-salud': 'heart',
    'c-entret': 'film', 'c-ropa': 'shirt', 'c-educ': 'book', 'c-viajes': 'plane',
    'c-impuestos': 'receipt', 'c-otros-g': 'tag',
    'c-sueldo': 'wallet', 'c-free': 'briefcase', 'c-invers': 'trend', 'c-ventas': 'bag', 'c-otros-i': 'dots',
  };
  function categoryIconName(catId) {
    const top = topCategoryOf(catId);
    if (CAT_ICON[top]) return CAT_ICON[top];
    const c = catById(catId);
    return c && c.type === 'ingreso' ? 'dots' : 'tag';
  }
  const METHOD_ICON = { efectivo: 'cash', debito: 'card', caja_ahorro: 'wallet', credito: 'card', billetera: 'wallet' };
  function methodIconName(methodId) {
    const m = methodById(methodId);
    return (m && METHOD_ICON[m.kind]) || 'card';
  }

  /* ================= Estado de la interfaz ================= */
  const ui = {
    view: 'resumen',
    month: curMonth(),        // mes del resumen
    fMonth: curMonth(),       // filtros de movimientos
    fType: '', fCat: '', fMethod: '',
    trendTable: false,
    openSavings: {},          // id -> bool (historial expandido)
    calMonth: curMonth(),     // mes del calendario
    calSel: null,             // 'YYYY-MM-DD' día seleccionado en el calendario
    catAnalysisId: null,      // categoría elegida para el gráfico de evolución
  };

  /* ================= Ciclo de tarjetas de crédito ================= */
  /* El día de cierre/vencimiento de una tarjeta puede variar puntualmente en
     algún período (el banco lo corre). card.overrides guarda, por mes de
     cierre ('YYYY-MM'), el día que pisa al general de la tarjeta ese mes. */
  function periodKey(y, m0) {
    const d = new Date(y, m0, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  function cardDayFor(card, kind, y, m0) {
    const key = periodKey(y, m0);
    const ov = card.overrides && card.overrides[key];
    return (ov && ov[kind] != null) ? ov[kind] : card[kind];
  }
  function cardDate(card, kind, y, m0) {
    const d = new Date(y, m0, 1);
    return clampDate(d.getFullYear(), d.getMonth(), cardDayFor(card, kind, y, m0));
  }
  /* Los candidatos de 'kind' (closingDay/dueDay) para un mes dado: el
     valor "efectivo" de ese mes (el ajuste puntual si tiene uno, si no el
     día habitual de la tarjeta) y, si tiene un ajuste puntual, TAMBIÉN el
     día habitual sin ajustar — porque en la vida real ambos pueden caer
     el mismo mes calendario. Por ejemplo: cierre habitual día 30, pero un
     ajuste puntual corrió el cierre de julio al día 2 (el banco lo
     adelantó); el ciclo siguiente vuelve a cerrar normalmente, y ese
     cierre "de siempre" (30) cae en el mismo julio, ~28 días después del
     ajustado. Ignorar esa segunda fecha hace que el próximo cierre salte
     directo a agosto, un mes de más. */
  function cardDateCandidates(card, kind, y, m0) {
    const eff = cardDate(card, kind, y, m0);
    const base = clampDate(y, m0, card[kind]);
    return base.getTime() === eff.getTime() ? [eff] : [eff, base].sort((a, b) => a - b);
  }
  /* Próxima fecha de 'kind' a partir de 'from' (inclusive, o estrictamente
     posterior si strict=true), revisando primero los candidatos del
     propio mes de 'from', y si no encuentra ninguno, mes por mes hacia
     adelante. */
  function nextCardDate(card, kind, from, strict) {
    for (let dm = 0; dm < 3; dm++) {
      const d = new Date(from.getFullYear(), from.getMonth() + dm, 1);
      for (const c of cardDateCandidates(card, kind, d.getFullYear(), d.getMonth())) {
        if (strict ? c > from : c >= from) return c;
      }
    }
    return cardDate(card, kind, from.getFullYear(), from.getMonth() + 3);
  }
  /* Misma idea que nextCardDate pero hacia atrás: la fecha de 'kind' más
     reciente estrictamente ANTERIOR a 'before'. */
  function prevCardDate(card, kind, before) {
    for (let dm = 0; dm < 3; dm++) {
      const d = new Date(before.getFullYear(), before.getMonth() - dm, 1);
      const cands = cardDateCandidates(card, kind, d.getFullYear(), d.getMonth());
      for (let i = cands.length - 1; i >= 0; i--) {
        if (cands[i] < before) return cands[i];
      }
    }
    return cardDate(card, kind, before.getFullYear(), before.getMonth() - 3);
  }
  function cardCycle(card) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const close = nextCardDate(card, 'closingDay', now, false);
    const prevClose = prevCardDate(card, 'closingDay', close);
    const prevPrevClose = prevCardDate(card, 'closingDay', prevClose);
    const dueAfter = (c) => nextCardDate(card, 'dueDay', c, true);
    return { close, prevClose, prevPrevClose, due: dueAfter(close), prevDue: dueAfter(prevClose) };
  }

  /* Próximos N resúmenes (cierre + vencimiento), arrancando por el ciclo
     actual, respetando los overrides puntuales que ya estén cargados. */
  function cardUpcomingCycles(card, n) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    let close = nextCardDate(card, 'closingDay', now, false);
    const out = [];
    for (let i = 0; i < n; i++) {
      const due = nextCardDate(card, 'dueDay', close, true);
      out.push({ close, due });
      close = nextCardDate(card, 'closingDay', close, true);
    }
    return out;
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  /* Línea de tiempo del ciclo: último cierre → su vencimiento → próximo
     cierre, con los puntos y el tramo recorrido pintados. */
  function cardCycleTimeline(card) {
    const cy = cardCycle(card);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const daysToClose = Math.round((cy.close - today) / DAY_MS);
    const segTotal = cy.close - cy.prevDue;
    const segDone = Math.min(Math.max(today - cy.prevDue, 0), Math.max(segTotal, 1));
    const pct2 = segTotal > 0 ? Math.round((segDone / segTotal) * 100) : 100;
    const shortDate = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
    return `
      <div class="cycle-card">
        <div class="cycle-days">${daysToClose <= 0 ? 'Cierra hoy.' : `Faltan ${daysToClose} día${daysToClose === 1 ? '' : 's'} para el cierre.`}</div>
        <div class="cycle-track">
          <span class="cd-date" style="grid-column:1;grid-row:1;justify-self:start">${esc(shortDate(cy.prevClose))}</span>
          <span class="cd-date" style="grid-column:3;grid-row:1;justify-self:center">${esc(shortDate(cy.prevDue))}</span>
          <span class="cd-date" style="grid-column:5;grid-row:1;justify-self:end">${esc(shortDate(cy.close))}</span>

          <span class="cycle-dot filled" style="grid-column:1;grid-row:2;justify-self:start"></span>
          <span class="cycle-line" style="grid-column:2;grid-row:2;--p:100%"></span>
          <span class="cycle-dot filled" style="grid-column:3;grid-row:2;justify-self:center"></span>
          <span class="cycle-line" style="grid-column:4;grid-row:2;--p:${pct2}%"></span>
          <span class="cycle-dot" style="grid-column:5;grid-row:2;justify-self:end"></span>

          <span class="cd-tag" style="grid-column:1;grid-row:3;justify-self:start">Cierre</span>
          <span class="cd-tag" style="grid-column:3;grid-row:3;justify-self:center">Vencimiento</span>
          <span class="cd-tag" style="grid-column:5;grid-row:3;justify-self:end">Próx. cierre</span>
        </div>
      </div>`;
  }

  /* Total de gastos de una tarjeta en el período (from, to], en moneda visible. */
  function cardPeriodTotal(cardId, from, to) {
    const a = dateToStr(from), b = dateToStr(to);
    return sumDisp(S().transactions.filter(
      (t) => t.type === 'gasto' && t.methodId === cardId && t.date > a && t.date <= b
    ));
  }

  /* Igual que cardCycle(), pero para el cierre/vencimiento que le toca a una
     COMPRA puntual (no a "hoy"): a qué resumen cae y cuándo vence ese resumen. */
  function cardCycleFor(card, purchaseDate) {
    const p = new Date(purchaseDate); p.setHours(0, 0, 0, 0);
    const close = nextCardDate(card, 'closingDay', p, false);
    const due = nextCardDate(card, 'dueDay', close, true);
    return { close, due };
  }

  /* Mes en el que un gasto "pega" en los totales mensuales (Balance del mes,
     filtro de Movimientos, presupuestos). Por defecto es el mes de la fecha
     de compra; si en Ajustes se eligió "vencimiento", un gasto con tarjeta
     de crédito cuenta en el mes en que vence ese resumen en vez del mes en
     que se hizo la compra (decisión del usuario, ver settings.cardMonthBasis). */
  function effectiveMonthOf(t) {
    if (t.type === 'gasto' && S().settings.cardMonthBasis === 'vencimiento') {
      const m = methodById(t.methodId);
      if (m && m.kind === 'credito') return monthKeyOf(dateToStr(cardCycleFor(m, parseDate(t.date)).due));
    }
    return monthKeyOf(t.date);
  }

  /* ================= Recurrentes: generación automática ================= */
  function generateRecurring() {
    const cm = curMonth();
    let changed = false;
    for (const r of S().recurring) {
      let m = r.lastGen ? addMonthsKey(r.lastGen, 1) : cm;
      while (m <= cm) {
        const [y, mo] = m.split('-').map(Number);
        const d = clampDate(y, mo - 1, r.day);
        S().transactions.push({
          id: Store.uid(), date: dateToStr(d), type: r.type, amount: r.amount,
          currency: r.currency, categoryId: r.categoryId, methodId: r.methodId,
          note: r.name, recurringId: r.id, usdSnapshot: usdSnapshotFor(r.amount, r.currency),
        });
        r.lastGen = m;
        changed = true;
        m = addMonthsKey(m, 1);
      }
    }
    if (changed) Store.save();
  }

  /* ================= Cotización ================= */
  let fetchingRates = false;
  async function refreshRates() {
    if (fetchingRates) return;
    fetchingRates = true;
    const chip = $('#rate-chip');
    if (chip) chip.textContent = 'Actualizando…';
    try {
      const map = await FX.fetchRates();
      S().settings.cachedRates = map;
      S().settings.ratesUpdatedAt = new Date().toISOString();
      Store.saveLocal();
    } catch (e) {
      console.warn('No se pudo actualizar la cotización', e);
    }
    fetchingRates = false;
    render();
  }

  function renderRateChip() {
    const chip = $('#rate-chip');
    if (!chip) return;
    const r = rate();
    chip.classList.toggle('rate-missing', !r);
    chip.textContent = r
      ? `US$ 1 = ${nfARS.format(r.value)} · ${r.label}`
      : 'Sin cotización — tocá para actualizar';
  }

  /* ================= Tema claro / oscuro ================= */
  const THEME_KEY = 'finpepe:theme';
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }
  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    localStorage.setItem(THEME_KEY, next);
    render(); // Repinta los gráficos con los colores del nuevo tema.
  }

  function renderBanner() {
    const b = $('#banner');
    const anyUSD = disp() === 'USD' ||
      S().transactions.some((t) => t.currency !== disp()) ||
      S().savings.some((s) => s.currency !== disp());
    if (!rate() && anyUSD) {
      b.hidden = false;
      b.textContent = 'No hay cotización del dólar disponible: los montos en otra moneda no se incluyen en los totales. Actualizá la cotización o definí una manual en Ajustes.';
    } else {
      b.hidden = true;
    }
  }

  // El <dialog> nativo no bloquea por sí solo el scroll de la página que
  // queda atrás (no es un CSS que se nos escapó, es una limitación real del
  // elemento): sin esto, en el celular se puede arrastrar y scrollear lo de
  // atrás mientras el modal está abierto (se nota sobre todo con el
  // formulario de movimiento, que es el más alto). El listener de 'close'
  // que restaura el overflow se registra una sola vez, en init().
  function openModal(dlg) {
    document.body.style.overflow = 'hidden';
    dlg.showModal();
  }

  /* ================= Diálogo genérico ================= */
  function openDialog(title, bodyHTML, { submitLabel = 'Guardar', onSubmit, footExtra = '' } = {}) {
    const dlg = $('#dialog');
    dlg.className = 'dialog'; // por si quedó una clase de txForm/authDialog de un uso anterior
    dlg.innerHTML = `
      <form novalidate="false">
        <div class="dialog-head">
          <span>${esc(title)}</span>
          <button type="button" class="row-del" data-close aria-label="Cerrar">✕</button>
        </div>
        <div class="dialog-body">${bodyHTML}</div>
        <div class="dialog-foot">
          ${footExtra}
          <button type="button" class="btn" data-close>Cancelar</button>
          <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
        </div>
      </form>`;
    $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
    $('form', dlg).addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      if (!form.reportValidity()) return;
      const data = {};
      for (const el of form.elements) {
        if (!el.name) continue;
        data[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      }
      if (onSubmit(data, dlg) !== false) dlg.close();
    });
    openModal(dlg);
    return dlg;
  }

  const selOptions = (items, sel) => items
    .map((i) => `<option value="${esc(i.id)}" ${i.id === sel ? 'selected' : ''}>${esc(i.name)}</option>`)
    .join('');

  // Como selOptions(), pero agrupando las subcategorías bajo su categoría
  // madre con <optgroup>: en un <select> plano (sin la grilla con drill-down
  // que tiene la carga de movimientos) una subcategoría suelta como
  // "Alquiler" es difícil de ubicar si no se ve que depende de "Casa".
  function catSelectOptionsHTML(type, selId) {
    if (!useSubcats()) return selOptions(S().categories.filter((c) => c.type === type), selId);
    return catGroups(type).map((g) => {
      const children = catChildren(g.id);
      if (!children.length) return `<option value="${esc(g.id)}" ${g.id === selId ? 'selected' : ''}>${esc(g.name)}</option>`;
      return `<optgroup label="${esc(g.name)}">${selOptions(children, selId)}</optgroup>`;
    }).join('');
  }

  /* ================= Formulario de movimiento ================= */

  /* Carga de movimientos: una sola pantalla con calculadora para el importe
     y listas que se despliegan ahí mismo para categoría/cuenta (sin navegar
     a otra hoja: se abren y cierran en el lugar). */
  function txForm(tx) {
    const editing = !!tx;
    const partner = sharedPartner();
    // Compartir con la pareja solo tiene sentido para gastos (se reparte
    // quién pagó qué); un ingreso o una transferencia entre tus propias
    // cuentas no es algo que "se deba" entre los dos.
    const canShare = () => !editing && draft.type === 'gasto' && !!partner && !!(shared.household);

    const draft = {
      type: editing ? tx.type : 'gasto',
      date: editing ? tx.date : todayStr(),
      currency: editing ? tx.currency : 'ARS',
      categoryId: editing ? tx.categoryId : '',
      methodId: editing ? tx.methodId : (S().methods[0] ? S().methods[0].id : ''),
      toMethodId: editing ? (tx.toMethodId || '') : '',
      shareIt: false,
      sharePct: 50,
      acc: editing ? tx.amount : null,
      op: null,
      cur: '',
      expand: null, // null | 'category' | 'method' | 'methodTo' — qué lista está desplegada
      catGroupExpand: null, // id del grupo de categoría "abierto" en la grilla, o null (nivel superior)
      note: editing ? (tx.note || '') : '',
      inst: 1,
      // Al cargar un movimiento nuevo se pide de a una cosa por vez (tipo,
      // fecha, monto, categoría, cuenta...) en vez de mostrar todo el
      // formulario junto; wstep es el índice dentro de wizardSteps(). Editar
      // uno existente sigue siendo un formulario único (ahí sí conviene ver
      // todo para poder corregir cualquier campo sin pasos de por medio).
      wstep: 0,
    };

    const dlg = $('#dialog');
    dlg.className = editing ? 'dialog dialog-tx' : 'dialog dialog-tx dialog-tx-wiz';

    function applyOp(a, op, b) {
      a = a || 0;
      if (op === '+') return a + b;
      if (op === '-') return a - b;
      if (op === '×') return a * b;
      if (op === '÷') return b !== 0 ? a / b : a;
      return b;
    }
    function numFmt(n) { return (Math.round(n * 100) / 100).toString(); }
    // Formatea SOLO para mostrar (puntos de miles, coma decimal); el valor
    // interno sigue siendo un string parseable con punto decimal.
    function formatTyped(s) {
      if (!s) return s === '' ? '' : s;
      const neg = s.startsWith('-');
      if (neg) s = s.slice(1);
      const dot = s.indexOf('.');
      const intPart = (dot === -1 ? s : s.slice(0, dot)) || '0';
      const decPart = dot === -1 ? null : s.slice(dot + 1);
      const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      return (neg ? '−' : '') + grouped + (decPart !== null ? ',' + decPart : '');
    }
    function finalAmount() {
      const curVal = draft.cur === '' ? null : parseFloat(draft.cur);
      if (draft.op && curVal != null) return applyOp(draft.acc, draft.op, curVal);
      if (curVal != null) return curVal;
      return draft.acc != null ? draft.acc : 0;
    }
    function displayExpr() {
      const parts = [];
      if (draft.acc != null) parts.push(formatTyped(numFmt(draft.acc)));
      if (draft.op) parts.push(draft.op);
      if (draft.cur !== '') parts.push(formatTyped(draft.cur));
      return parts.length ? parts.join(' ') : '0';
    }
    function pressDigit(d) {
      haptic();
      if (d === '.' && draft.cur.includes('.')) return;
      if (draft.cur.length > 12) return;
      draft.cur = (draft.cur === '0' && d !== '.') ? d : draft.cur + d;
      paint();
    }
    function pressOp(op) {
      haptic();
      const curVal = draft.cur === '' ? null : parseFloat(draft.cur);
      if (draft.op && curVal != null) draft.acc = applyOp(draft.acc, draft.op, curVal);
      else if (curVal != null) draft.acc = curVal;
      draft.op = op;
      draft.cur = '';
      paint();
    }
    function pressEquals() {
      haptic();
      const curVal = draft.cur === '' ? null : parseFloat(draft.cur);
      if (draft.op && curVal != null) draft.acc = applyOp(draft.acc, draft.op, curVal);
      else if (curVal != null) draft.acc = curVal;
      draft.op = null;
      draft.cur = draft.acc != null ? numFmt(draft.acc) : '';
      paint();
    }
    function pressBack() {
      haptic();
      if (draft.cur) draft.cur = draft.cur.slice(0, -1);
      else if (draft.op) draft.op = null;
      else if (draft.acc != null) { draft.cur = numFmt(draft.acc); draft.acc = null; }
      paint();
    }

    function currentInstMethod() { return methodById(draft.methodId); }
    function showInstallments() {
      const m = currentInstMethod();
      return !editing && draft.type === 'gasto' && m && m.kind === 'credito';
    }

    // Elegir cuotas como mini-tarjetas (1/3/6/12/otra) en vez de un campo
    // numérico pelado: las opciones más comunes quedan a un toque, y "Otra"
    // despliega el número para casos puntuales.
    const INST_PRESETS = [1, 3, 6, 12];
    function installmentsPickerHTML() {
      const cur = Number(draft.inst);
      const isCustom = !INST_PRESETS.includes(cur);
      return `
        <div class="tx-row-note">
          <label>Cuotas</label>
          <div class="inst-picker">
            ${INST_PRESETS.map((n) => `<button type="button" class="inst-opt ${!isCustom && cur === n ? 'sel' : ''}" data-inst-preset="${n}">${n}</button>`).join('')}
            <button type="button" class="inst-opt ${isCustom ? 'sel' : ''}" data-inst-custom>Otra</button>
          </div>
          ${isCustom ? `<input type="number" id="tx-inst" min="1" max="36" step="1" value="${esc(draft.inst)}" placeholder="Cantidad de cuotas" class="inst-custom-input">` : ''}
        </div>`;
    }

    // Grilla de tarjetas (categoría/subcategoría), con las que tienen hijos
    // llevando a una "sub-grilla" en vez de mostrar todo mezclado en una lista.
    function catTileGridHTML(items, checkChildren, selId) {
      selId = selId === undefined ? draft.categoryId : selId;
      return `<div class="cat-tile-grid">${items.map((item) => {
        const hasKids = checkChildren && catChildren(item.id).length > 0;
        if (hasKids) {
          return `<div class="cat-tile" data-catgroup="${esc(item.id)}">
            <span class="cat-tile-name">${esc(item.name)}</span>
            <span class="cat-tile-chev">⌄</span>
          </div>`;
        }
        const sel = item.id === selId;
        return `<div class="cat-tile ${sel ? 'sel' : ''}" data-pickid="${esc(item.id)}">
          <span class="cat-tile-name">${esc(item.name)}</span>
        </div>`;
      }).join('')}</div>`;
    }
    function categoryOptionsHTML() {
      if (!useSubcats()) {
        const items = S().categories.filter((c) => c.type === draft.type);
        return items.length ? catTileGridHTML(items)
          : '<div class="empty">No hay categorías. Agregá una desde Ajustes.</div>';
      }
      const groups = catGroups(draft.type);
      if (!groups.length) return '<div class="empty">No hay categorías. Agregá una desde Ajustes.</div>';
      if (draft.catGroupExpand) {
        const g = groups.find((x) => x.id === draft.catGroupExpand);
        const children = g ? catChildren(g.id) : [];
        if (g && children.length) {
          return `<div class="cat-tile-crumb" data-catback>‹ ${esc(g.name)}</div>${catTileGridHTML(children)}`;
        }
        draft.catGroupExpand = null;
      }
      return catTileGridHTML(groups, true);
    }
    function methodOptionsHTML(selId, excludeId) {
      let items = S().methods;
      if (excludeId) items = items.filter((m) => m.id !== excludeId);
      return items.length ? catTileGridHTML(items, false, selId)
        : '<div class="empty">No hay medios. Agregá uno desde Tarjetas y medios.</div>';
    }

    function formHTML() {
      const titles = { gasto: 'Gasto', ingreso: 'Ingreso', transferencia: 'Transferencia' };
      return `
      <div class="dialog-head tx-head">
        <button type="button" class="row-del" data-close aria-label="Cerrar">✕</button>
        <span class="tx-head-title">${titles[draft.type]}</span>
        <span></span>
      </div>
      <div class="tx-tabs">
        <button type="button" class="tx-tab ${draft.type === 'ingreso' ? 'active tx-tab-income' : ''}" data-ttype="ingreso">Ingreso</button>
        <button type="button" class="tx-tab ${draft.type === 'gasto' ? 'active tx-tab-expense' : ''}" data-ttype="gasto">Gasto</button>
        <button type="button" class="tx-tab ${draft.type === 'transferencia' ? 'active tx-tab-transfer' : ''}" data-ttype="transferencia">Transferencia</button>
      </div>
      <div class="tx-body">
        <label class="tx-row tx-row-date">
          <span class="tx-row-label">Fecha</span>
          <span class="tx-row-value tx-row-value-date">${esc(fmtDateFull(draft.date))}</span>
          <input type="date" id="tx-date-input" class="tx-date-native" value="${esc(draft.date)}">
        </label>

        <div class="tx-amount-block">
          <div class="tx-cur-toggle">
            <button type="button" class="cur-pill ${draft.currency === 'ARS' ? 'active' : ''}" data-cur="ARS">ARS</button>
            <button type="button" class="cur-pill ${draft.currency === 'USD' ? 'active' : ''}" data-cur="USD">USD</button>
          </div>
          <div class="tx-amount-display ${draft.type === 'ingreso' ? 'is-income' : draft.type === 'gasto' ? 'is-expense' : ''}">
            <span>${esc(displayExpr())}</span>
            <button type="button" class="tx-amount-back" data-back aria-label="Borrar">⌫</button>
          </div>
        </div>

        ${draft.type === 'transferencia' ? `
        <div class="tx-row" data-toggle="method">
          <span class="tx-row-label">Desde</span>
          <span class="tx-row-value">${draft.methodId ? esc(methodName(draft.methodId)) : 'Elegir'}</span>
          <span class="tx-row-chev ${draft.expand === 'method' ? 'open' : ''}">›</span>
        </div>
        ${draft.expand === 'method' ? `<div class="tx-pick-inline" data-kind="method">${methodOptionsHTML(draft.methodId, draft.toMethodId)}</div>` : ''}

        <div class="tx-row" data-toggle="methodTo">
          <span class="tx-row-label">Hacia</span>
          <span class="tx-row-value">${draft.toMethodId ? esc(methodName(draft.toMethodId)) : 'Elegir'}</span>
          <span class="tx-row-chev ${draft.expand === 'methodTo' ? 'open' : ''}">›</span>
        </div>
        ${draft.expand === 'methodTo' ? `<div class="tx-pick-inline" data-kind="methodTo">${methodOptionsHTML(draft.toMethodId, draft.methodId)}</div>` : ''}
        ` : `
        <div class="tx-row" data-toggle="category">
          <span class="tx-row-label">Categoría</span>
          <span class="tx-row-value">${draft.categoryId ? esc(catName(draft.categoryId)) : 'Elegir'}</span>
          <span class="tx-row-chev ${draft.expand === 'category' ? 'open' : ''}">›</span>
        </div>
        ${draft.expand === 'category' ? `<div class="tx-pick-inline" data-kind="category">${categoryOptionsHTML()}</div>` : ''}

        <div class="tx-row" data-toggle="method">
          <span class="tx-row-label">Cuenta</span>
          <span class="tx-row-value">${draft.methodId ? esc(methodName(draft.methodId)) : 'Elegir'}</span>
          <span class="tx-row-chev ${draft.expand === 'method' ? 'open' : ''}">›</span>
        </div>
        ${draft.expand === 'method' ? `<div class="tx-pick-inline" data-kind="method">${methodOptionsHTML(draft.methodId)}</div>` : ''}
        `}

        ${showInstallments() ? installmentsPickerHTML() : ''}

        ${canShare() ? `
        <label class="tx-check-row">
          <input type="checkbox" id="tx-share" ${draft.shareIt ? 'checked' : ''}>
          <span>Es un gasto compartido con ${esc(partnerLabel(partner))}</span>
        </label>
        ${draft.shareIt ? `
        <div class="tx-row-note">
          <label>Vos te quedás con este % del gasto (el resto le corresponde a ${esc(partnerLabel(partner))})</label>
          <input type="number" id="tx-share-pct" min="0" max="100" step="1" value="${draft.sharePct}">
        </div>` : ''}` : ''}

        <div class="tx-row-note">
          <label>Nota <span class="hint">(opcional)</span></label>
          <input type="text" id="tx-note" maxlength="80" value="${esc(draft.note)}">
        </div>
      </div>
      ${!draft.expand ? keypadHTML() : ''}
      <div class="dialog-foot">
        ${editing ? '<button type="button" class="btn btn-danger" data-del style="margin-right:auto">Eliminar</button>' : ''}
        <button type="button" class="btn btn-primary" data-save>Guardar</button>
      </div>`;
    }

    function keypadHTML() {
      return `
      <div class="tx-keypad">
        <button type="button" data-k="7">7</button><button type="button" data-k="8">8</button><button type="button" data-k="9">9</button><button type="button" data-op="÷">÷</button>
        <button type="button" data-k="4">4</button><button type="button" data-k="5">5</button><button type="button" data-k="6">6</button><button type="button" data-op="×">×</button>
        <button type="button" data-k="1">1</button><button type="button" data-k="2">2</button><button type="button" data-k="3">3</button><button type="button" data-op="-">−</button>
        <button type="button" data-k=".">.</button><button type="button" data-k="0">0</button><button type="button" data-eq>=</button><button type="button" data-op="+">+</button>
      </div>`;
    }

    function wireKeypad() {
      $$('.tx-keypad [data-k]', dlg).forEach((b) => b.addEventListener('click', () => pressDigit(b.dataset.k)));
      $$('.tx-keypad [data-op]', dlg).forEach((b) => b.addEventListener('click', () => pressOp(b.dataset.op)));
      const eqBtn = $('[data-eq]', dlg);
      if (eqBtn) eqBtn.addEventListener('click', pressEquals);
    }

    function paint() {
      dlg.innerHTML = editing ? formHTML() : wizardHTML();
      if (editing) wire(); else wizardWire();
    }

    /* ---------- Alta de movimiento nuevo: de a una etapa por vez ---------- */
    const STEP_TITLE = {
      type: 'Tipo de movimiento', date: 'Fecha', amount: 'Monto',
      category: 'Categoría', method: 'Cuenta', from: 'Desde', to: 'Hacia', extra: 'Detalles',
    };
    function wizardSteps() {
      return draft.type === 'transferencia'
        ? ['type', 'date', 'amount', 'from', 'to', 'extra']
        : ['type', 'date', 'amount', 'category', 'method', 'extra'];
    }
    function wizardSummaryHTML() {
      const steps = wizardSteps();
      const chips = [{ gasto: 'Gasto', ingreso: 'Ingreso', transferencia: 'Transferencia' }[draft.type]];
      const past = (k) => steps.indexOf(k) < draft.wstep;
      if (past('date')) chips.push(fmtDateFull(draft.date));
      if (past('amount') && finalAmount() > 0) chips.push(fmtMoney(finalAmount(), draft.currency));
      if (draft.type === 'transferencia') {
        if (past('from') && draft.methodId) chips.push(methodName(draft.methodId));
        if (past('to') && draft.toMethodId) chips.push(methodName(draft.toMethodId));
      } else {
        if (past('category') && draft.categoryId) chips.push(catName(draft.categoryId));
        if (past('method') && draft.methodId) chips.push(methodName(draft.methodId));
      }
      return chips.map((c) => `<span class="tx-wiz-chip">${esc(c)}</span>`).join('');
    }
    function wizardStepBodyHTML(key) {
      if (key === 'type') {
        const opts = [
          { t: 'ingreso', label: 'Ingreso', cls: 'type-income', icon: 'trend', rowIcon: 'row-icon-income' },
          { t: 'gasto', label: 'Gasto', cls: 'type-expense', icon: 'cash', rowIcon: 'row-icon-expense' },
          { t: 'transferencia', label: 'Transferencia', cls: 'type-transfer', icon: 'swap', rowIcon: 'row-icon-transfer' },
        ];
        return `<div class="tx-wiz-type-options">${opts.map((o) => `
          <button type="button" class="tx-wiz-type-opt ${o.cls} ${draft.type === o.t ? 'sel' : ''}" data-wtype="${o.t}">
            <span class="row-icon ${o.rowIcon}">${iconSvg(o.icon)}</span>
            <span>${esc(o.label)}</span>
          </button>`).join('')}</div>`;
      }
      if (key === 'date') {
        return `
          <label class="tx-row tx-row-date">
            <span class="tx-row-label">Fecha</span>
            <span class="tx-row-value tx-row-value-date">${esc(fmtDateFull(draft.date))}</span>
            <input type="date" id="tx-date-input" class="tx-date-native" value="${esc(draft.date)}">
          </label>
          ${draft.date !== todayStr() ? '<button type="button" class="link-btn" data-wtoday>Usar hoy</button>' : ''}`;
      }
      if (key === 'amount') {
        return `
          <div class="tx-amount-block">
            <div class="tx-cur-toggle">
              <button type="button" class="cur-pill ${draft.currency === 'ARS' ? 'active' : ''}" data-cur="ARS">ARS</button>
              <button type="button" class="cur-pill ${draft.currency === 'USD' ? 'active' : ''}" data-cur="USD">USD</button>
            </div>
            <div class="tx-amount-display ${draft.type === 'ingreso' ? 'is-income' : draft.type === 'gasto' ? 'is-expense' : ''}">
              <span>${esc(displayExpr())}</span>
              <button type="button" class="tx-amount-back" data-back aria-label="Borrar">⌫</button>
            </div>
          </div>`;
      }
      if (key === 'category') {
        return `<div class="tx-pick-inline" data-kind="category">${categoryOptionsHTML()}</div>`;
      }
      if (key === 'method') {
        return `<div class="tx-pick-inline" data-kind="method">${methodOptionsHTML(draft.methodId)}</div>`;
      }
      if (key === 'from') {
        return `<div class="tx-pick-inline" data-kind="from">${methodOptionsHTML(draft.methodId, draft.toMethodId)}</div>`;
      }
      if (key === 'to') {
        return `<div class="tx-pick-inline" data-kind="to">${methodOptionsHTML(draft.toMethodId, draft.methodId)}</div>`;
      }
      // 'extra': cuotas (si aplica) + compartido (si aplica) + nota, antes de guardar.
      return `
        ${showInstallments() ? installmentsPickerHTML() : ''}
        ${canShare() ? `
        <label class="tx-check-row">
          <input type="checkbox" id="tx-share" ${draft.shareIt ? 'checked' : ''}>
          <span>Es un gasto compartido con ${esc(partnerLabel(partner))}</span>
        </label>
        ${draft.shareIt ? `
        <div class="tx-row-note">
          <label>Vos te quedás con este % del gasto (el resto le corresponde a ${esc(partnerLabel(partner))})</label>
          <input type="number" id="tx-share-pct" min="0" max="100" step="1" value="${draft.sharePct}">
        </div>` : ''}` : ''}
        <div class="tx-row-note">
          <label>Nota <span class="hint">(opcional)</span></label>
          <input type="text" id="tx-note" maxlength="80" value="${esc(draft.note)}">
        </div>`;
    }
    function wizardFootHTML(key) {
      if (key === 'date') {
        return '<div class="dialog-foot"><button type="button" class="btn btn-primary" data-wnext>Siguiente</button></div>';
      }
      if (key === 'amount') {
        return `<div class="dialog-foot"><button type="button" class="btn btn-primary" data-wnext ${finalAmount() > 0 ? '' : 'disabled'}>Siguiente</button></div>`;
      }
      if (key === 'extra') {
        return '<div class="dialog-foot"><button type="button" class="btn btn-primary" data-save>Guardar</button></div>';
      }
      return ''; // type/category/method/from/to: avanzan solos al tocar una opción
    }
    function wizardHTML() {
      const steps = wizardSteps();
      draft.wstep = Math.min(draft.wstep, steps.length - 1);
      const key = steps[draft.wstep];
      return `
      <div class="dialog-head tx-head">
        ${draft.wstep > 0 ? '<button type="button" class="row-del" data-wiz-back aria-label="Atrás">‹</button>' : '<span></span>'}
        <span class="tx-head-title">${esc(STEP_TITLE[key])}</span>
        <button type="button" class="row-del" data-wiz-close aria-label="Cancelar">✕</button>
      </div>
      <div class="tx-wiz-progress">${steps.map((_, i) => `<span class="tx-wiz-dot ${i === draft.wstep ? 'active' : i < draft.wstep ? 'done' : ''}"></span>`).join('')}</div>
      ${draft.wstep > 0 ? `<div class="tx-wiz-summary">${wizardSummaryHTML()}</div>` : ''}
      <div class="tx-body tx-wiz-body">${wizardStepBodyHTML(key)}</div>
      ${key === 'amount' ? keypadHTML() : ''}
      ${wizardFootHTML(key)}`;
    }
    function wireCatGroupNav() {
      $$('[data-catgroup]', dlg).forEach((elx) => elx.addEventListener('click', (e) => {
        e.stopPropagation();
        draft.catGroupExpand = elx.dataset.catgroup;
        paint();
      }));
      $$('[data-catback]', dlg).forEach((elx) => elx.addEventListener('click', (e) => {
        e.stopPropagation();
        draft.catGroupExpand = null;
        paint();
      }));
    }
    function wizardWire() {
      const backBtn = $('[data-wiz-back]', dlg);
      if (backBtn) backBtn.addEventListener('click', () => { draft.wstep -= 1; paint(); });
      $('[data-wiz-close]', dlg).addEventListener('click', () => dlg.close());
      const key = wizardSteps()[draft.wstep];
      if (key === 'type') {
        $$('[data-wtype]', dlg).forEach((b) => b.addEventListener('click', () => {
          draft.type = b.dataset.wtype;
          if (draft.categoryId && !selectableCats(draft.type).some((c) => c.id === draft.categoryId)) draft.categoryId = '';
          draft.catGroupExpand = null;
          draft.wstep = 1;
          paint();
        }));
      } else if (key === 'date') {
        $('#tx-date-input', dlg).addEventListener('change', (e) => { draft.date = e.target.value; paint(); });
        const todayBtn = $('[data-wtoday]', dlg);
        if (todayBtn) todayBtn.addEventListener('click', () => { draft.date = todayStr(); paint(); });
        $('[data-wnext]', dlg).addEventListener('click', () => { draft.wstep += 1; paint(); });
      } else if (key === 'amount') {
        $$('.cur-pill', dlg).forEach((b) => b.addEventListener('click', () => { draft.currency = b.dataset.cur; paint(); }));
        wireKeypad();
        $('[data-back]', dlg).addEventListener('click', pressBack);
        const nextBtn = $('[data-wnext]', dlg);
        if (nextBtn) nextBtn.addEventListener('click', () => {
          if (!(finalAmount() > 0)) return;
          draft.acc = finalAmount();
          draft.op = null;
          draft.cur = '';
          draft.wstep += 1;
          paint();
        });
      } else if (key === 'category') {
        wireCatGroupNav();
        $$('.tx-pick-inline [data-pickid]', dlg).forEach((row) => row.addEventListener('click', () => {
          draft.categoryId = row.dataset.pickid;
          draft.catGroupExpand = null;
          draft.wstep += 1;
          paint();
        }));
      } else if (key === 'method' || key === 'from' || key === 'to') {
        $$('.tx-pick-inline [data-pickid]', dlg).forEach((row) => row.addEventListener('click', () => {
          if (key === 'to') draft.toMethodId = row.dataset.pickid;
          else draft.methodId = row.dataset.pickid;
          draft.wstep += 1;
          paint();
        }));
      } else if (key === 'extra') {
        const shareBox = $('#tx-share', dlg);
        if (shareBox) shareBox.addEventListener('change', (e) => { draft.shareIt = e.target.checked; paint(); });
        wireDraftInputs();
        $('[data-save]', dlg).addEventListener('click', onSave);
      }
    }

    function wire() {
      $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
      $$('.tx-tab', dlg).forEach((b) => b.addEventListener('click', () => {
        draft.type = b.dataset.ttype;
        if (draft.categoryId && !selectableCats(draft.type).some((c) => c.id === draft.categoryId)) draft.categoryId = '';
        draft.expand = null;
        draft.catGroupExpand = null;
        paint();
      }));
      $('#tx-date-input', dlg).addEventListener('change', (e) => { draft.date = e.target.value; paint(); });
      $$('.cur-pill', dlg).forEach((b) => b.addEventListener('click', () => { draft.currency = b.dataset.cur; paint(); }));
      $$('[data-toggle]', dlg).forEach((row) => row.addEventListener('click', () => {
        const k = row.dataset.toggle;
        draft.expand = draft.expand === k ? null : k;
        if (k === 'category') draft.catGroupExpand = null;
        paint();
      }));
      wireCatGroupNav();
      $$('.tx-pick-inline [data-pickid]', dlg).forEach((row) => row.addEventListener('click', () => {
        const kind = row.closest('.tx-pick-inline').dataset.kind;
        if (kind === 'category') draft.categoryId = row.dataset.pickid;
        else if (kind === 'methodTo') draft.toMethodId = row.dataset.pickid;
        else draft.methodId = row.dataset.pickid;
        draft.expand = null;
        draft.catGroupExpand = null;
        paint();
      }));
      const shareBox = $('#tx-share', dlg);
      if (shareBox) shareBox.addEventListener('change', (e) => { draft.shareIt = e.target.checked; paint(); });
      wireKeypad();
      $('[data-back]', dlg).addEventListener('click', pressBack);
      wireDraftInputs();
      $('[data-save]', dlg).addEventListener('click', onSave);
      const delBtn = $('[data-del]', dlg);
      if (delBtn) delBtn.addEventListener('click', () => { dlg.close(); deleteTx(tx); });
    }

    // Nota/cuotas/% compartido se guardan en draft en cada tecla (no solo al
    // guardar): tocar el checkbox de "compartido" repinta el diálogo, y sin
    // esto se perdía lo ya tipeado en esos campos.
    function wireDraftInputs() {
      const noteEl = $('#tx-note', dlg);
      if (noteEl) noteEl.addEventListener('input', (e) => { draft.note = e.target.value; });
      $$('[data-inst-preset]', dlg).forEach((b) => b.addEventListener('click', () => {
        draft.inst = b.dataset.instPreset;
        paint();
      }));
      const instCustomBtn = $('[data-inst-custom]', dlg);
      if (instCustomBtn) instCustomBtn.addEventListener('click', () => { draft.inst = ''; paint(); });
      const instEl = $('#tx-inst', dlg);
      if (instEl) instEl.addEventListener('input', (e) => { draft.inst = e.target.value; });
      const pctEl = $('#tx-share-pct', dlg);
      if (pctEl) pctEl.addEventListener('input', (e) => { draft.sharePct = e.target.value; });
    }

    async function onSave() {
      if (draft._saving) return;
      const amount = Math.round(finalAmount() * 100) / 100;
      if (!(amount > 0)) { alert('Ingresá un monto mayor a 0.'); return; }
      if (!draft.methodId) { alert(draft.type === 'transferencia' ? 'Elegí la cuenta de origen.' : 'Elegí una cuenta.'); return; }
      if (draft.type === 'transferencia') {
        if (!draft.toMethodId) { alert('Elegí la cuenta de destino.'); return; }
        if (draft.toMethodId === draft.methodId) { alert('Elegí dos cuentas distintas para transferir.'); return; }
      } else if (!draft.categoryId) {
        alert('Elegí una categoría.'); return;
      }
      // Buscar la cotización histórica es una llamada de red: evita que un
      // doble click dispare el guardado dos veces mientras espera.
      draft._saving = true;
      const saveBtn = $('[data-save]', dlg);
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Guardando…'; }
      const note = draft.note || '';
      const base = draft.type === 'transferencia'
        ? { date: draft.date, type: draft.type, amount, currency: draft.currency,
            methodId: draft.methodId, toMethodId: draft.toMethodId, note: note.trim() }
        : { date: draft.date, type: draft.type, amount, currency: draft.currency,
            categoryId: draft.categoryId, methodId: draft.methodId, note: note.trim() };

      if (editing) {
        // El equivalente en USD queda como estaba si el monto/moneda no
        // cambiaron (para no perder el valor histórico por editar la nota o
        // la categoría); si cambian, se recalcula a la cotización DE LA
        // FECHA del movimiento (no la de hoy).
        const keepSnapshot = tx.currency === draft.currency && tx.amount === amount && tx.usdSnapshot != null;
        base.usdSnapshot = keepSnapshot ? tx.usdSnapshot : await usdSnapshotForDate(amount, draft.currency, draft.date);
        Object.assign(tx, base);
      } else {
        const n = showInstallments() ? Math.max(1, parseInt(draft.inst || '1', 10) || 1) : 1;
        if (n === 1) {
          S().transactions.push({ id: Store.uid(), ...base, usdSnapshot: await usdSnapshotForDate(amount, draft.currency, draft.date) });
        } else {
          const groupId = Store.uid();
          const per = Math.round((amount / n) * 100) / 100;
          const start = parseDate(draft.date);
          for (let k = 1; k <= n; k++) {
            const cuota = (k === n) ? Math.round((amount - per * (n - 1)) * 100) / 100 : per;
            const dk = clampDate(start.getFullYear(), start.getMonth() + (k - 1), start.getDate());
            const dkStr = dateToStr(dk);
            S().transactions.push({
              id: Store.uid(), ...base, amount: cuota, date: dkStr,
              groupId, installment: { k, n }, usdSnapshot: await usdSnapshotForDate(cuota, draft.currency, dkStr),
            });
          }
        }
      }
      Store.save();

      if (canShare() && draft.shareIt) {
        const pct = Math.min(100, Math.max(0, parseFloat(draft.sharePct || '50')));
        try {
          await Cloud.addSharedExpense({
            household_id: shared.household.id, paid_by: sharedMe().id,
            payer_share: pct / 100, amount, currency: draft.currency,
            date: draft.date, note: note.trim() || null,
          });
          shared.expenses = await Cloud.listSharedExpenses(shared.household.id);
        } catch (e) {
          alert('El movimiento se guardó, pero no se pudo avisar a la cuenta compartida: ' + e.message);
        }
      }
      dlg.close();
      render();
    }

    paint();
    openModal(dlg);
  }

  function deleteTx(tx) {
    if (tx.groupId) {
      const group = S().transactions.filter((t) => t.groupId === tx.groupId);
      if (!confirm(`Este movimiento es una compra en ${group.length} cuotas. Se eliminarán todas las cuotas.`)) return;
      S().transactions = S().transactions.filter((t) => t.groupId !== tx.groupId);
    } else {
      if (!confirm('¿Eliminar este movimiento?')) return;
      S().transactions = S().transactions.filter((t) => t.id !== tx.id);
    }
    Store.save();
    render();
  }

  /* ================= Vista: Resumen ================= */
  function vResumen(el) {
    const mk = ui.month;
    const txs = S().transactions;
    const inMonth = txs.filter((t) => effectiveMonthOf(t) === mk);
    const prevMk = addMonthsKey(mk, -1);
    const inPrev = txs.filter((t) => effectiveMonthOf(t) === prevMk);

    const inc = sumDisp(inMonth.filter((t) => t.type === 'ingreso'));
    const exp = sumDisp(inMonth.filter((t) => t.type === 'gasto'));
    const incPrev = sumDisp(inPrev.filter((t) => t.type === 'ingreso'));
    const expPrev = sumDisp(inPrev.filter((t) => t.type === 'gasto'));

    // Ahorros: no el total acumulado histórico, sino lo aportado (neto de
    // retiros) durante ESE mes puntual — es la diferencia entre el total
    // acumulado al final del mes y al final del mes anterior. Usar el
    // total acumulado directo rompería "Balance del mes" (se iría cada vez
    // más negativo con los meses, aunque no cambie el ritmo de ahorro).
    const savingsUpTo = (cutoff) => {
      let total = 0;
      for (const s of S().savings) {
        const v = convOrNull(s.entries.filter((e) => e.date < cutoff).reduce((a, e) => a + e.amount, 0), s.currency);
        if (v != null) total += v;
      }
      return total;
    };
    const savingsAtEndOf = (mkk) => savingsUpTo(`${addMonthsKey(mkk, 1)}-01`);
    const totalSavings = savingsAtEndOf(mk);
    const totalSavingsPrev = savingsAtEndOf(prevMk);
    const savingsMonth = totalSavings - totalSavingsPrev;
    const savingsMonthPrev = totalSavingsPrev - savingsAtEndOf(addMonthsKey(mk, -2));

    // El dinero que se destina a ahorro ese mes deja de estar disponible,
    // así que resta del balance del mes igual que un gasto (un retiro de
    // ahorros, en cambio, sería un aporte negativo y sumaría).
    const balance = inc - exp - savingsMonth;

    // Cada variación va siempre en dos líneas: arriba el %, abajo el monto
    // nominal de la diferencia (ambos contra el mismo mes anterior).
    const delta = (cur, prev, upIsGood) => {
      if (!(prev > 0)) return '';
      const diff = cur - prev;
      const pct = Math.round((diff / prev) * 100);
      if (pct === 0) return `<div class="tile-delta">= vs. ${esc(monthNameOnly(prevMk))}</div>`;
      const up = pct > 0;
      const cls = (up === upIsGood) ? 'up-good' : 'down-bad';
      return `<div class="tile-delta tile-delta-2l">
        <span class="${cls}">${up ? '▲' : '▼'} ${Math.abs(pct)}%</span>
        <span class="tile-delta-nom">${up ? '+' : '−'}${fmtDisp(Math.abs(diff))} vs. ${esc(monthNameOnly(prevMk))}</span>
      </div>`;
    };
    // Variación de Ahorros: el aporte mensual puede ser $0 o negativo (un
    // retiro), así que si no hay un aporte previo positivo contra el cual
    // comparar, el % no tiene una base válida ("nuevo" en vez de un
    // porcentaje inventado). El monto nominal, en cambio, siempre se puede
    // calcular.
    const savingsDelta = (() => {
      const diff = savingsMonth - savingsMonthPrev;
      if (diff === 0) return `<div class="tile-delta">= vs. ${esc(monthNameOnly(prevMk))}</div>`;
      const up = diff > 0;
      const cls = up ? 'up-good' : 'down-bad';
      const pctLabel = savingsMonthPrev > 0
        ? `${up ? '▲' : '▼'} ${Math.abs(Math.round((diff / savingsMonthPrev) * 100))}%`
        : `${up ? '▲' : '▼'} nuevo`;
      return `<div class="tile-delta tile-delta-2l">
        <span class="${cls}">${pctLabel}</span>
        <span class="tile-delta-nom">${up ? '+' : '−'}${fmtDisp(Math.abs(diff))} vs. ${esc(monthNameOnly(prevMk))}</span>
      </div>`;
    })();

    // Gastos por categoría (top 8 + Otros)
    const byCat = new Map();
    for (const t of inMonth.filter((x) => x.type === 'gasto')) {
      const v = txDispAmount(t);
      if (v == null) continue;
      const topId = topCategoryOf(t.categoryId);
      byCat.set(topId, (byCat.get(topId) || 0) + v);
    }
    let catItems = [...byCat.entries()]
      .map(([id, value]) => ({ label: catName(id), value }))
      .sort((a, b) => b.value - a.value);
    if (catItems.length > 4) {
      const rest = catItems.slice(4);
      catItems = catItems.slice(0, 4);
      catItems.push({ label: 'Otros', value: rest.reduce((a, i) => a + i.value, 0) });
    }
    catItems = catItems.map((it, i) => ({ ...it, color: CAT_PALETTE[i % CAT_PALETTE.length] }));

    // Tendencia: últimos 6 meses hasta el mes elegido, salvo los que no
    // tengan ningún movimiento (no tiene sentido mostrar un mes vacío en
    // el eje si nunca se cargó nada ese mes).
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(addMonthsKey(mk, -i));
    const trendRows = months.map((m) => {
      const list = txs.filter((t) => effectiveMonthOf(t) === m);
      const [y, mo] = m.split('-').map(Number);
      return {
        label: monthShortFmt.format(new Date(y, mo - 1, 1)).replace('.', ''),
        income: sumDisp(list.filter((t) => t.type === 'ingreso')),
        expense: sumDisp(list.filter((t) => t.type === 'gasto')),
      };
    }).filter((r) => r.income > 0 || r.expense > 0);

    // Vencimientos de tarjetas
    const cards = S().methods.filter((m) => m.kind === 'credito');
    const cardRows = cards.map((c) => {
      const cy = cardCycle(c);
      return {
        card: c, cy,
        current: cardPeriodTotal(c.id, cy.prevClose, cy.close),
        toPay: cardPeriodTotal(c.id, cy.prevPrevClose, cy.prevClose),
      };
    }).sort((a, b) => a.cy.due - b.cy.due);

    const pctLeft = (exp <= 0 && savingsMonth <= 0) ? 100 : (inc > 0 ? Math.max(0, Math.min(100, Math.round((balance / inc) * 100))) : 0);
    const pctMonthLeft = monthLeftPct(mk);
    const daysLeft = daysLeftInMonth(mk);

    // Balance acumulado día a día del mes (cuánto queda de plata a medida
    // que pasan los días, no el mes completo de un saque): usa la fecha
    // calendario real de cada movimiento, no el mes "efectivo" (que puede
    // correr un gasto de tarjeta al mes de vencimiento). En el mes en curso
    // corta en el día de hoy (no tiene sentido proyectar una línea plana a
    // futuro); en un mes que todavía no llegó no hay nada que mostrar.
    const [mkY, mkM] = mk.split('-').map(Number);
    const daysInMk = new Date(mkY, mkM, 0).getDate();
    const lastDayToShow = mk > curMonth() ? 0 : (mk === curMonth() ? new Date().getDate() : daysInMk);
    const calMonthTxs = txs.filter((t) => monthKeyOf(t.date) === mk);
    const dailyDelta = new Array(daysInMk + 1).fill(0);
    for (const t of calMonthTxs) {
      const v = txDispAmount(t);
      if (v == null) continue;
      dailyDelta[parseDate(t.date).getDate()] += t.type === 'ingreso' ? v : -v;
    }
    let dailyRunning = 0;
    const dailyBalance = [];
    for (let d = 1; d <= daysInMk; d++) {
      if (d > lastDayToShow) { dailyBalance.push({ day: d, value: null }); continue; }
      dailyRunning += dailyDelta[d];
      dailyBalance.push({ day: d, value: dailyRunning });
    }

    // Muestra el nombre del hogar (no "Compartido con {pareja}"): el nombre
    // de la pareja ya aparece en el balance de al lado ("ana te debe..."),
    // repetirlo en el título quedaba redundante.
    const sharedPartnerM = Cloud.user() ? sharedPartner() : null;
    const sharedWidget = (shared.household && sharedPartnerM) ? (() => {
      const bal = sharedBalance();
      const balAbs = Math.abs(bal);
      const balTxt = balAbs < 0.01 ? 'Están a mano'
        : (bal > 0 ? `${esc(partnerLabel(sharedPartnerM))} te debe ${fmtDisp(balAbs)}`
                   : `Le debés a ${esc(partnerLabel(sharedPartnerM))} ${fmtDisp(balAbs)}`);
      return `<div class="shared-mini" data-goto-shared>
        <span class="shared-mini-label">${esc(shared.household.name || 'Hogar compartido')}</span>
        <span class="shared-mini-value ${bal > 0 ? 'pos' : bal < 0 ? 'neg' : ''}">${esc(balTxt)}</span>
      </div>`;
    })() : '';

    el.innerHTML = `
      <div class="hero">
        <div class="hero-month-bar">
          <button class="icon-btn" data-mnav="-1" aria-label="Mes anterior">‹</button>
          <span class="hero-month-bar-label">${iconSvg('calendar')}${esc(monthLabel(mk))}</span>
          <button class="icon-btn" data-mnav="1" aria-label="Mes siguiente">›</button>
        </div>
        <button class="link-btn hero-mtoday" data-mtoday ${mk === curMonth() ? 'style="visibility:hidden"' : ''}>volver al mes actual</button>
        <div class="hero-balance-center">
          <div class="hero-label">Balance del mes</div>
          <div class="hero-value ${balance < 0 ? 'neg' : ''}">${heroMoneyHTML(balance, disp())}</div>
        </div>
        <div class="hero-speedo-mini">
          ${speedoGaugeSvg(pctLeft, 220)}
        </div>
        <div class="hero-split-3">
          <div><div class="k">Ingresos</div><div class="v pos">${fmtDisp(inc)}</div>${delta(inc, incPrev, true)}</div>
          <div><div class="k">Gastos</div><div class="v">${fmtDisp(exp)}</div>${delta(exp, expPrev, false)}</div>
          <div><div class="k">Ahorros</div><div class="v ${savingsMonth < 0 ? 'neg' : ''}">${fmtDisp(savingsMonth)}</div>${savingsDelta}</div>
        </div>
      </div>

      <button class="pill-cta" id="btn-cta-tx" type="button">${iconSvg('plus')}Añadir movimiento</button>
      ${sharedWidget}

      <div class="grid-2 grid-2-tight">
        <div class="card card-compact">
          <h2 class="card-title">
            <span>Gastos por categoría</span>
            <button class="link-btn" data-goto-categorias>Ver análisis</button>
          </h2>
          ${catItems.length ? `<div id="chart-cats" class="cats-bars cats-bars-compact"></div>` : '<div class="empty">Sin gastos registrados este mes.</div>'}
        </div>
        <div class="card card-compact">
          <h2 class="card-title">Balance y días del mes</h2>
          <div class="hero-ring-standalone">
            <div class="hero-ring-legend hero-ring-legend-mirror" aria-hidden="true">
              <div class="hero-ring-item"><span class="dot dot-accent"></span>Balance: <b>${pctLeft}%</b></div>
              <div class="hero-ring-item"><span class="dot dot-warn"></span>Faltan <b>${daysLeft} día${daysLeft === 1 ? '' : 's'}</b></div>
            </div>
            <div class="hero-ring">${ringSvg2(pctLeft, pctMonthLeft, 108)}</div>
            <div class="hero-ring-legend">
              <div class="hero-ring-item"><span class="dot dot-accent"></span>Balance: <b>${pctLeft}%</b></div>
              <div class="hero-ring-item"><span class="dot dot-warn"></span>Faltan <b>${daysLeft} día${daysLeft === 1 ? '' : 's'}</b></div>
            </div>
          </div>
          <h2 class="card-title card-title-mirror" aria-hidden="true">Balance y días del mes</h2>
        </div>
      </div>

      <div class="card">
        <h2 class="card-title">
          <span>Ingresos vs. gastos · últimos 6 meses</span>
          <button class="link-btn" data-trendtable>${ui.trendTable ? 'Ver gráfico' : 'Ver tabla'}</button>
        </h2>
        <div class="chart-legend">
          <span><span class="key" style="background:${Charts.COLORS.income}"></span>Ingresos</span>
          <span><span class="key" style="background:${Charts.COLORS.expense}"></span>Gastos</span>
        </div>
        <div id="chart-trend"></div>
      </div>

      <div class="card">
        <h2 class="card-title">Balance por día</h2>
        <div id="chart-daily-balance"></div>
      </div>

      <div class="card">
        <h2 class="card-title">Próximos vencimientos</h2>
        ${cards.length ? `
        <div class="due-card-list">
          ${cardRows.slice().sort((a, b) => a.cy.prevDue - b.cy.prevDue).map((r) => {
            const today0 = new Date(); today0.setHours(0, 0, 0, 0);
            const days = Math.round((r.cy.prevDue - today0) / DAY_MS);
            const daysLabel = days < 0 ? `Venció hace ${-days} día${-days === 1 ? '' : 's'}`
              : days === 0 ? 'Vence hoy' : `Vence en ${days} día${days === 1 ? '' : 's'}`;
            return `<div class="due-card-row" data-goto-card="${esc(r.card.id)}">
              <div class="row-icon row-icon-due">${iconSvg('card')}</div>
              <div class="due-card-main">
                <div class="due-card-title">${esc(r.card.name)}</div>
                <div class="due-card-sub">${esc(daysLabel)} · ${esc(fmtDay(r.cy.prevDue))}</div>
              </div>
              <div class="due-card-amount">
                <div class="v">${fmtDisp(r.toPay)}</div>
                <span class="due-card-pill">Ver</span>
              </div>
            </div>`;
          }).join('')}
        </div>`
        : '<div class="empty">Agregá tus tarjetas de crédito en “Tarjetas y medios” para ver cierres, vencimientos y cuánto vas a pagar.</div>'}
      </div>`;

    // Gráficos
    if (catItems.length) {
      Charts.hBars($('#chart-cats', el), catItems, {
        fmt: fmtDisp, color: Charts.COLORS.category,
      });
    }
    const trendEl = $('#chart-trend', el);
    if (!trendRows.length) {
      trendEl.innerHTML = '<div class="empty">Sin movimientos en los últimos 6 meses.</div>';
    } else if (ui.trendTable) {
      trendEl.innerHTML = `
        <div class="table-scroll"><table class="data">
          <thead><tr><th>Mes</th><th class="num">Ingresos</th><th class="num">Gastos</th><th class="num">Balance</th></tr></thead>
          <tbody>${trendRows.map((r) => `
            <tr><td>${esc(r.label)}</td>
            <td class="num amount-in">${fmtDisp(r.income)}</td>
            <td class="num">${fmtDisp(r.expense)}</td>
            <td class="num">${fmtDisp(r.income - r.expense)}</td></tr>`).join('')}
          </tbody>
        </table></div>`;
    } else {
      Charts.trend(trendEl, trendRows, {});
    }
    Charts.dailyBalance($('#chart-daily-balance', el), dailyBalance, {});

    $$('[data-mnav]', el).forEach((b) => b.addEventListener('click', () => {
      ui.month = addMonthsKey(ui.month, Number(b.dataset.mnav));
      render();
    }));
    const btnToday = $('[data-mtoday]', el);
    if (btnToday) btnToday.addEventListener('click', () => { ui.month = curMonth(); render(); });
    $('[data-trendtable]', el).addEventListener('click', () => {
      ui.trendTable = !ui.trendTable;
      render();
    });
    $('#btn-cta-tx', el).addEventListener('click', () => txForm(null));
    $$('[data-goto-card]', el).forEach((row) => row.addEventListener('click', () => {
      ui.view = 'tarjetas';
      render();
    }));
    const gotoShared = $('[data-goto-shared]', el);
    if (gotoShared) gotoShared.addEventListener('click', () => {
      ui.view = 'compartido';
      loadShared();
      render();
    });
    const gotoCats = $('[data-goto-categorias]', el);
    if (gotoCats) gotoCats.addEventListener('click', () => {
      ui.view = 'categorias';
      render();
    });
  }

  /* ================= Vista: Movimientos ================= */
  function vMovimientos(el) {
    const txs = S().transactions;
    const monthsPresent = [...new Set(txs.map((t) => effectiveMonthOf(t)))];
    if (!monthsPresent.includes(curMonth())) monthsPresent.push(curMonth());
    monthsPresent.sort().reverse();
    if (ui.fMonth && !monthsPresent.includes(ui.fMonth)) ui.fMonth = curMonth();

    let list = txs.slice();
    if (ui.fMonth) list = list.filter((t) => effectiveMonthOf(t) === ui.fMonth);
    if (ui.fType) list = list.filter((t) => t.type === ui.fType);
    if (ui.fCat) list = list.filter((t) => t.categoryId === ui.fCat);
    if (ui.fMethod) list = list.filter((t) => t.methodId === ui.fMethod);
    list.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

    // Para resaltar gastos grandes en la lista: relativo al gasto más alto
    // de lo que se está viendo (con los filtros actuales), no a un monto
    // fijo, así se adapta a la escala de cada quien.
    const gastoVals = list.filter((t) => t.type === 'gasto').map((t) => txDispAmount(t)).filter((v) => v > 0);
    const maxGasto = gastoVals.length ? Math.max(...gastoVals) : 0;
    const bigClass = (t) => {
      if (t.type !== 'gasto' || !maxGasto) return '';
      const ratio = (txDispAmount(t) || 0) / maxGasto;
      return ratio >= 0.66 ? ' amount-huge' : ratio >= 0.33 ? ' amount-big' : '';
    };

    el.innerHTML = `
      <div class="card">
        <div class="mov-filters">
          <select id="fil-month" aria-label="Mes">
            <option value="">Todos los meses</option>
            ${monthsPresent.map((m) => `<option value="${m}" ${m === ui.fMonth ? 'selected' : ''}>${esc(monthLabel(m))}</option>`).join('')}
          </select>
          <select id="fil-type" aria-label="Tipo">
            <option value="">Ingresos y gastos</option>
            <option value="ingreso" ${ui.fType === 'ingreso' ? 'selected' : ''}>Solo ingresos</option>
            <option value="gasto" ${ui.fType === 'gasto' ? 'selected' : ''}>Solo gastos</option>
            <option value="transferencia" ${ui.fType === 'transferencia' ? 'selected' : ''}>Solo transferencias</option>
          </select>
          <select id="fil-cat" aria-label="Categoría">
            <option value="">Todas las categorías</option>
            ${selOptions(S().categories, ui.fCat)}
          </select>
          <select id="fil-method" aria-label="Medio de pago">
            <option value="">Todos los medios</option>
            ${selOptions(S().methods, ui.fMethod)}
          </select>
        </div>
        <button class="btn btn-primary btn-sm mov-add" id="btn-add-tx">+ Movimiento</button>

        ${list.length ? `
        ${dayGroups(list).map(({ dateStr, items }) => `
          <div class="tx-day-group">
            <div class="tx-day-label">${esc(dayGroupLabel(dateStr))}</div>
            <div class="tx-card-list">
              ${items.map((t) => {
                if (t.type === 'transferencia') {
                  const usdLineT = (t.currency === 'ARS' && t.usdSnapshot != null)
                    ? `<div class="usd">≈ ${esc(fmtMoney(t.usdSnapshot, 'USD'))}</div>` : '';
                  return `<div class="tx-card-row" data-tx="${esc(t.id)}">
                    <div class="row-icon row-icon-transfer">${iconSvg('swap')}</div>
                    <div class="tx-card-main">
                      <div class="tx-card-title">${esc(t.note || 'Transferencia')}</div>
                      <div class="tx-card-sub">${esc(methodName(t.methodId))} → ${esc(methodName(t.toMethodId))}</div>
                    </div>
                    <div class="tx-card-amount">
                      <div class="v">${fmtMoney(t.amount, t.currency)}</div>
                      ${usdLineT}
                    </div>
                    <button class="tx-card-del" data-del="${esc(t.id)}" aria-label="Eliminar">✕</button>
                  </div>`;
                }
                const inst = t.installment ? ` · cuota ${t.installment.k}/${t.installment.n}` : '';
                const rec = t.recurringId ? ' · fijo' : '';
                const cur = t.currency === 'USD' ? ' · USD' : '';
                const isIncome = t.type === 'ingreso';
                const sign = isIncome ? '+' : '−';
                const usdLine = (t.currency === 'ARS' && t.usdSnapshot != null)
                  ? `<div class="usd">≈ ${esc(fmtMoney(t.usdSnapshot, 'USD'))}</div>` : '';
                // El título ya es el nombre de la categoría cuando no hay nota
                // propia: repetirlo abajo en el subtítulo era redundante.
                const title = t.note || catName(t.categoryId);
                const subParts = [];
                if (t.note) subParts.push(catName(t.categoryId));
                subParts.push(methodName(t.methodId));
                return `<div class="tx-card-row" data-tx="${esc(t.id)}">
                  <div class="row-icon ${isIncome ? 'row-icon-income' : 'row-icon-expense'}">${iconSvg(categoryIconName(t.categoryId))}</div>
                  <div class="tx-card-main">
                    <div class="tx-card-title">${esc(title)}</div>
                    <div class="tx-card-sub">${esc(subParts.join(' · '))}${inst}${rec}${cur}</div>
                  </div>
                  <div class="tx-card-amount">
                    <div class="v ${isIncome ? 'pos' : ''}${bigClass(t)}">${sign} ${fmtMoney(t.amount, t.currency)}</div>
                    ${usdLine}
                  </div>
                  <button class="tx-card-del" data-del="${esc(t.id)}" aria-label="Eliminar">✕</button>
                </div>`;
              }).join('')}
            </div>
          </div>`).join('')}`
        : '<div class="empty">No hay movimientos con estos filtros. Cargá el primero con “+ Movimiento”.</div>'}
      </div>`;

    $('#fil-month', el).addEventListener('change', (e) => { ui.fMonth = e.target.value; render(); });
    $('#fil-type', el).addEventListener('change', (e) => { ui.fType = e.target.value; render(); });
    $('#fil-cat', el).addEventListener('change', (e) => { ui.fCat = e.target.value; render(); });
    $('#fil-method', el).addEventListener('change', (e) => { ui.fMethod = e.target.value; render(); });
    $('#btn-add-tx', el).addEventListener('click', () => txForm(null));

    $$('.tx-card-row', el).forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-del]')) return;
        const tx = S().transactions.find((t) => t.id === row.dataset.tx);
        if (tx) txForm(tx);
      });
    });
    $$('[data-del]', el).forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const tx = S().transactions.find((t) => t.id === b.dataset.del);
      if (tx) deleteTx(tx);
    }));
  }

  /* ================= Vista: Categorías (análisis) ================= */
  // A qué "grupo" pertenece un gasto para el análisis: el id del grupo de
  // más arriba, o '__sin' si no tiene categoría asignada (o se borró).
  function topCatKeyOf(t) {
    return (t.categoryId && catById(t.categoryId)) ? topCategoryOf(t.categoryId) : '__sin';
  }

  // Agrupa una lista de gastos por categoría de nivel superior, con el
  // detalle de subcategorías debajo de cada una (fusionando movimientos
  // repetidos de la misma subcategoría en una sola fila).
  function categoryBreakdown(list) {
    const groups = new Map();
    for (const t of list) {
      const v = txDispAmount(t);
      if (v == null) continue;
      const topId = topCatKeyOf(t);
      if (!groups.has(topId)) {
        groups.set(topId, { id: topId, name: topId === '__sin' ? 'Sin categoría' : catName(topId), total: 0, subs: [], direct: 0 });
      }
      const g = groups.get(topId);
      g.total += v;
      if (topId !== '__sin' && t.categoryId !== topId) {
        g.subs.push({ id: t.categoryId, value: v });
      } else {
        g.direct += v;
      }
    }
    for (const g of groups.values()) {
      const merged = new Map();
      for (const s of g.subs) merged.set(s.id, (merged.get(s.id) || 0) + s.value);
      g.subs = [...merged.entries()].map(([id, value]) => ({ id, name: catName(id), value }));
      // Si además hay gasto cargado directo en el grupo (sin subcategoría
      // hija) se suma como una fila "Otros"; si el grupo no tiene
      // subcategorías reales, ese monto directo ES el total del grupo y no
      // hace falta desglosarlo en una fila aparte.
      if (g.direct > 0 && g.subs.length) {
        g.subs.push({ id: g.id + ':directo', name: 'Otros (sin subcategoría)', value: g.direct });
      }
      g.subs.sort((a, b) => b.value - a.value);
    }
    return [...groups.values()].sort((a, b) => b.total - a.total);
  }

  function vCategorias(el) {
    const mk = ui.month;
    const txs = S().transactions;
    const inMonth = txs.filter((t) => effectiveMonthOf(t) === mk);
    const inc = sumDisp(inMonth.filter((t) => t.type === 'ingreso'));
    const exp = sumDisp(inMonth.filter((t) => t.type === 'gasto'));
    const breakdown = categoryBreakdown(inMonth.filter((t) => t.type === 'gasto'));

    // Últimos 6 meses hasta el mes elegido, para el selector y el gráfico
    // de evolución (una categoría sin gasto este mes puede igual mostrarse
    // si tuvo peso en algún mes reciente).
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(addMonthsKey(mk, -i));
    const windowBreakdown = categoryBreakdown(txs.filter((t) => t.type === 'gasto' && months.includes(effectiveMonthOf(t))));

    if (!windowBreakdown.some((g) => g.id === ui.catAnalysisId)) {
      ui.catAnalysisId = windowBreakdown[0] ? windowBreakdown[0].id : null;
    }
    const selId = ui.catAnalysisId;
    const selGroup = windowBreakdown.find((g) => g.id === selId) || null;

    const monthLabels = months.map((m) => {
      const [y, mo] = m.split('-').map(Number);
      return monthShortFmt.format(new Date(y, mo - 1, 1)).replace('.', '');
    });
    const pctExpSeries = [];
    const pctIncSeries = [];
    months.forEach((m) => {
      const listM = txs.filter((t) => effectiveMonthOf(t) === m);
      const gastoM = listM.filter((t) => t.type === 'gasto');
      const expM = sumDisp(gastoM);
      const incM = sumDisp(listM.filter((t) => t.type === 'ingreso'));
      const catValM = selGroup ? sumDisp(gastoM.filter((t) => topCatKeyOf(t) === selId)) : 0;
      pctExpSeries.push(expM > 0 ? (catValM / expM) * 100 : 0);
      pctIncSeries.push(incM > 0 ? (catValM / incM) * 100 : 0);
    });

    const pct = (v, total) => (total > 0 ? Math.round((v / total) * 100) : 0) + '%';

    const rowsHtml = breakdown.map((g) => {
      const showSubs = g.subs.length && !(g.subs.length === 1 && g.total === g.direct && g.subs[0].name === 'Otros (sin subcategoría)');
      const subsHtml = showSubs ? g.subs.map((s) => `
        <tr class="cat-sub-row">
          <td class="cell-sub">${esc(s.name)}</td>
          <td class="num cell-sub">${fmtDisp(s.value)}</td>
          <td class="num cell-sub">${pct(s.value, exp)}</td>
          <td class="num cell-sub">${pct(s.value, inc)}</td>
        </tr>`).join('') : '';
      return `<tr>
        <td>${esc(g.name)}</td>
        <td class="num amount-out">${fmtDisp(g.total)}</td>
        <td class="num">${pct(g.total, exp)}</td>
        <td class="num">${pct(g.total, inc)}</td>
      </tr>${subsHtml}`;
    }).join('');

    el.innerHTML = `
      <div class="card">
        <h2 class="card-title"><span>Análisis de categorías</span></h2>
        <div class="cat-month-nav">
          <button class="icon-btn" data-mnav="-1" aria-label="Mes anterior">‹</button>
          <span class="month-label">${esc(monthLabel(mk))}</span>
          <button class="icon-btn" data-mnav="1" aria-label="Mes siguiente">›</button>
          ${mk !== curMonth() ? '<button class="link-btn" data-mtoday>volver al mes actual</button>' : ''}
        </div>
        ${breakdown.length ? `
        <div class="table-scroll"><table class="data cat-breakdown-table">
          <thead><tr><th>Categoría</th><th class="num">Monto</th><th class="num">% gastos</th><th class="num">% ingr.</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table></div>` : `<div class="empty">Sin gastos registrados en ${esc(monthLabel(mk))}.</div>`}
      </div>

      <div class="card">
        <h2 class="card-title"><span>Evolución del peso por categoría · últimos 6 meses</span></h2>
        ${windowBreakdown.length ? `
        <div class="field">
          <select id="cat-analysis-sel" aria-label="Categoría a graficar">
            ${windowBreakdown.map((g) => `<option value="${esc(g.id)}" ${g.id === selId ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
          </select>
        </div>
        <div class="chart-legend">
          <span><span class="key" style="background:${Charts.COLORS.expense}"></span>% de tus gastos</span>
          <span><span class="key" style="background:${Charts.COLORS.income}"></span>% de tus ingresos</span>
        </div>
        <div id="chart-cat-evo"></div>` : '<div class="empty">Todavía no hay suficientes movimientos para ver una evolución.</div>'}
      </div>`;

    if (windowBreakdown.length) {
      Charts.lines($('#chart-cat-evo', el), monthLabels, [
        { label: '% de tus gastos', color: Charts.COLORS.expense, values: pctExpSeries },
        { label: '% de tus ingresos', color: Charts.COLORS.income, values: pctIncSeries },
      ], {
        fmtAxis: (v) => Math.round(v) + '%',
        ariaLabel: `Evolución del peso de ${selGroup ? selGroup.name : ''} sobre ingresos y gastos`,
      });
    }

    $$('[data-mnav]', el).forEach((b) => b.addEventListener('click', () => {
      ui.month = addMonthsKey(ui.month, Number(b.dataset.mnav));
      render();
    }));
    const btnToday = $('[data-mtoday]', el);
    if (btnToday) btnToday.addEventListener('click', () => { ui.month = curMonth(); render(); });
    const sel = $('#cat-analysis-sel', el);
    if (sel) sel.addEventListener('change', (e) => {
      ui.catAnalysisId = e.target.value;
      render();
    });
  }

  /* ================= Vista: Tarjetas y medios ================= */
  function methodForm(method) {
    const editing = !!method;
    const m = method || { name: '', kind: 'efectivo', closingDay: 25, dueDay: 5 };
    const body = `
      <div class="field">
        <label for="m-name">Nombre</label>
        <input type="text" name="name" id="m-name" required maxlength="40"
               placeholder="Visa Galicia, Ualá, Efectivo…" value="${esc(m.name)}">
      </div>
      <div class="field">
        <label for="m-kind">Tipo</label>
        <select name="kind" id="m-kind">
          ${Object.entries(KIND_LABEL).map(([k, v]) =>
            `<option value="${k}" ${m.kind === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="field-row" id="m-card-days" hidden>
        <div class="field">
          <label for="m-close">Día de cierre</label>
          <input type="number" name="closingDay" id="m-close" min="1" max="31" step="1" value="${esc(m.closingDay ?? 25)}">
        </div>
        <div class="field">
          <label for="m-due">Día de vencimiento</label>
          <input type="number" name="dueDay" id="m-due" min="1" max="31" step="1" value="${esc(m.dueDay ?? 5)}">
        </div>
      </div>
      <span class="hint" id="m-hint" hidden>Si el vencimiento cae con un número de día menor al de cierre (por ej. cierre 25, vencimiento 5), la app entiende que es al mes siguiente. En meses más cortos, el día 29-31 se ajusta solo al último día del mes. Si un mes puntual el banco corre la fecha, lo podés ajustar después desde "Ajustar fechas" en la tarjeta.</span>`;

    const dlg = openDialog(editing ? 'Editar medio de pago' : 'Nuevo medio de pago', body, {
      onSubmit(d) {
        const data = { name: d.name.trim(), kind: d.kind };
        if (d.kind === 'credito') {
          data.closingDay = Math.min(31, Math.max(1, parseInt(d.closingDay, 10) || 25));
          data.dueDay = Math.min(31, Math.max(1, parseInt(d.dueDay, 10) || 5));
        }
        if (editing) Object.assign(method, data);
        else S().methods.push({ id: Store.uid(), ...data });
        Store.save();
        render();
      },
    });
    const toggle = () => {
      const isCredit = $('#m-kind', dlg).value === 'credito';
      $('#m-card-days', dlg).hidden = !isCredit;
      $('#m-hint', dlg).hidden = !isCredit;
    };
    $('#m-kind', dlg).addEventListener('change', toggle);
    toggle();
  }

  /* Ajuste puntual de cierre/vencimiento para un período (mes) puntual,
     para cuando el banco corre la fecha ese mes en particular. */
  // Ajuste puntual: se pide la fecha REAL de cierre/vencimiento (no un
  // número de día suelto) para no tener que adivinar a qué mes corresponde
  // cada uno — el día de mes que usa la lógica de ciclos se saca de ahí.
  function cardOverrideForm(card) {
    const cy = cardCycle(card);
    const overrides = card.overrides || {};
    const rows = Object.keys(overrides).sort().map((key) => {
      const ov = overrides[key];
      const label = monthLabel(key);
      const parts = [];
      if (ov.closeDateStr) parts.push(`cierre ${esc(fmtDateShort(ov.closeDateStr))}`);
      else if (ov.closingDay != null) parts.push(`cierre día ${ov.closingDay}`);
      if (ov.dueDateStr) parts.push(`vencimiento ${esc(fmtDateShort(ov.dueDateStr))}`);
      else if (ov.dueDay != null) parts.push(`vencimiento día ${ov.dueDay}`);
      return `<div class="ov-row" data-ovrow="${esc(key)}">
        <span>${esc(label)}: ${parts.join(' · ') || 'sin cambios'}</span>
        <button type="button" class="row-del" data-ovdel="${esc(key)}" aria-label="Quitar ajuste">✕</button>
      </div>`;
    }).join('');

    const body = `
      <div class="field">
        <label for="ov-close">Fecha real de cierre este período</label>
        <input type="date" name="closeDate" id="ov-close" value="${esc(dateToStr(cy.close))}" required>
      </div>
      <div class="field">
        <label for="ov-due">Fecha real de vencimiento este período <span class="hint">(opcional, si también cambió)</span></label>
        <input type="date" name="dueDate" id="ov-due" placeholder="usual: ${esc(dateToStr(cy.due))}">
      </div>
      <span class="hint">Elegí la fecha de cierre tal cual va a caer este período (aunque no cambie, ancla a qué mes aplica el ajuste); la de vencimiento solo si también se corrió.</span>
      ${rows ? `<div class="ov-list"><span class="hint">Ajustes ya cargados:</span>${rows}</div>` : ''}
      <button type="button" class="link-btn" id="ov-toggle-upcoming">Ver próximos resúmenes</button>
      <div id="ov-upcoming" hidden></div>`;

    const dlg = openDialog(`Ajustar fechas de ${card.name}`, body, {
      submitLabel: 'Guardar ajuste',
      onSubmit(d) {
        if (!d.closeDate) return false;
        const closeDate = parseDate(d.closeDate);
        const key = periodKey(closeDate.getFullYear(), closeDate.getMonth());
        const dueDate = d.dueDate ? parseDate(d.dueDate) : null;
        card.overrides = card.overrides || {};
        card.overrides[key] = {
          closingDay: closeDate.getDate(),
          closeDateStr: d.closeDate,
          ...(dueDate ? { dueDay: dueDate.getDate(), dueDateStr: d.dueDate } : {}),
        };
        Store.save();
        render();
      },
    });
    $$('[data-ovdel]', dlg).forEach((b) => b.addEventListener('click', () => {
      delete card.overrides[b.dataset.ovdel];
      Store.save();
      dlg.close();
      render();
      cardOverrideForm(card);
    }));
    const upcomingBox = $('#ov-upcoming', dlg);
    $('#ov-toggle-upcoming', dlg).addEventListener('click', (ev) => {
      const btn = ev.currentTarget;
      const willShow = upcomingBox.hidden;
      if (willShow && !upcomingBox.dataset.filled) {
        const rowsHtml = cardUpcomingCycles(card, 6).map((c) => `<tr>
          <td>${esc(monthLabel(periodKey(c.close.getFullYear(), c.close.getMonth())))}</td>
          <td>${esc(fmtDateShort(dateToStr(c.close)))}</td>
          <td>${esc(fmtDateShort(dateToStr(c.due)))}</td>
        </tr>`).join('');
        upcomingBox.innerHTML = `<div class="table-scroll"><table class="data">
          <thead><tr><th>Resumen</th><th>Cierre</th><th>Vencimiento</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table></div>`;
        upcomingBox.dataset.filled = '1';
      }
      upcomingBox.hidden = !willShow;
      btn.textContent = willShow ? 'Ocultar próximos resúmenes' : 'Ver próximos resúmenes';
    });
  }

  function vTarjetas(el) {
    const methods = S().methods;
    el.innerHTML = `
      <div class="toolbar">
        <h2 class="card-title" style="margin:0">Tarjetas y medios de pago</h2>
        <div class="spacer"></div>
        <button class="btn btn-primary btn-sm" id="btn-add-method">+ Agregar medio</button>
      </div>
      <div class="entity-grid">
        ${methods.map((m) => {
          let details = '';
          if (m.kind === 'credito') {
            const cy = cardCycle(m);
            const current = cardPeriodTotal(m.id, cy.prevClose, cy.close);
            const toPay = cardPeriodTotal(m.id, cy.prevPrevClose, cy.prevClose);
            const closeAdj = cy.close.getDate() !== m.closingDay;
            const dueAdj = cy.prevDue.getDate() !== m.dueDay;
            const nOv = Object.keys(m.overrides || {}).length;
            details = `${cardCycleTimeline(m)}
            <dl>
              <dt>Resumen en curso</dt><dd>${fmtDisp(current)}</dd>
              <dt>Último resumen</dt><dd>${fmtDisp(toPay)}</dd>
              ${nOv ? `<dt>Ajustes puntuales</dt><dd>${nOv}${(closeAdj || dueAdj) ? ' (aplicado este período)' : ''}</dd>` : ''}
            </dl>`;
          } else {
            const monthTotal = sumDisp(S().transactions.filter(
              (t) => t.methodId === m.id && t.type === 'gasto' && monthKeyOf(t.date) === curMonth()));
            details = `<dl><dt>Gastado este mes</dt><dd>${fmtDisp(monthTotal)}</dd></dl>`;
          }
          return `<div class="entity">
            <div class="entity-head">
              <span class="entity-name">${esc(m.name)}</span>
              <span class="entity-kind">${KIND_LABEL[m.kind] || m.kind}</span>
            </div>
            ${details}
            <div class="entity-actions">
              ${m.kind === 'credito' ? `<button class="btn btn-sm" data-adjust="${esc(m.id)}">Ajustar fechas</button>` : ''}
              <button class="btn btn-sm" data-edit="${esc(m.id)}">Editar</button>
              <button class="btn btn-sm btn-danger" data-del="${esc(m.id)}">Eliminar</button>
            </div>
          </div>`;
        }).join('')}
      </div>
      ${methods.some((m) => m.kind === 'credito') ? '' :
        '<div class="card"><div class="empty">Todavía no cargaste ninguna tarjeta de crédito. Agregala con su día de cierre y de vencimiento para seguir tus resúmenes y compras en cuotas.</div></div>'}`;

    $('#btn-add-method', el).addEventListener('click', () => methodForm(null));
    $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => {
      methodForm(methodById(b.dataset.edit));
    }));
    $$('[data-adjust]', el).forEach((b) => b.addEventListener('click', () => {
      cardOverrideForm(methodById(b.dataset.adjust));
    }));
    $$('[data-del]', el).forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.del;
      const used = S().transactions.some((t) => t.methodId === id) ||
                   S().recurring.some((r) => r.methodId === id);
      if (used) {
        alert('Este medio tiene movimientos asociados. Eliminá o reasigná esos movimientos primero.');
        return;
      }
      if (!confirm('¿Eliminar este medio de pago?')) return;
      S().methods = S().methods.filter((m) => m.id !== id);
      Store.save();
      render();
    }));
  }

  /* ================= Vista: Calendario ================= */
  // Eventos (pagos e ingresos previstos) de un mes: fijos + vencimientos de tarjeta.
  function eventsForMonth(mk) {
    const [y, mo] = mk.split('-').map(Number);
    const events = [];

    for (const r of S().recurring) {
      const d = clampDate(y, mo - 1, r.day);
      events.push({
        date: dateToStr(d), kind: r.type, // 'gasto' | 'ingreso'
        icon: r.type === 'ingreso' ? '💰' : '🔁',
        title: r.name, sub: (r.type === 'ingreso' ? 'Ingreso fijo' : 'Gasto fijo') + ' · día ' + r.day,
        amount: r.amount, currency: r.currency,
      });
    }

    for (const c of S().methods.filter((m) => m.kind === 'credito')) {
      const due = cardDate(c, 'dueDay', y, mo - 1);
      // Resumen que vence en esa fecha: el que cerró justo antes del vencimiento.
      let close = cardDate(c, 'closingDay', due.getFullYear(), due.getMonth());
      if (close >= due) close = cardDate(c, 'closingDay', due.getFullYear(), due.getMonth() - 1);
      const prevClose = cardDate(c, 'closingDay', close.getFullYear(), close.getMonth() - 1);
      const amount = cardPeriodTotal(c.id, prevClose, close); // ya en moneda visible
      events.push({
        date: dateToStr(due), kind: 'card', icon: '💳',
        title: c.name, sub: 'Vencimiento tarjeta · día ' + due.getDate(),
        amountDisp: amount,
      });
    }
    return events;
  }

  function eventAmountDisp(ev) {
    return ev.kind === 'card' ? ev.amountDisp : convOrNull(ev.amount, ev.currency);
  }

  function vCalendario(el) {
    const mk = ui.calMonth;
    const [y, mo] = mk.split('-').map(Number);
    const events = eventsForMonth(mk);
    const byDay = new Map();
    for (const ev of events) {
      if (!byDay.has(ev.date)) byDay.set(ev.date, []);
      byDay.get(ev.date).push(ev);
    }

    // Total del mes a pagar (gastos fijos + tarjetas) en moneda visible
    let mesPagos = 0;
    for (const ev of events) {
      if (ev.kind === 'ingreso') continue;
      const v = eventAmountDisp(ev);
      if (v != null) mesPagos += v;
    }

    // Grilla: semanas empiezan el lunes
    const first = new Date(y, mo - 1, 1);
    const daysInMonth = new Date(y, mo, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // lunes=0
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);

    const dow = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const today = todayStr();

    const cellHTML = (d) => {
      if (d == null) return '<div class="cal-cell pad"></div>';
      const ds = `${y}-${pad(mo)}-${pad(d)}`;
      const evs = byDay.get(ds) || [];
      const kinds = [...new Set(evs.map((e) => e.kind))].slice(0, 3);
      const dots = kinds.map((k) => `<i class="dot-${k}"></i>`).join('');
      const cls = ['cal-cell'];
      if (evs.length) cls.push('has');
      if (ds === today) cls.push('today');
      if (ds === ui.calSel) cls.push('sel');
      return `<div class="${cls.join(' ')}" ${evs.length ? `data-day="${ds}"` : ''}>
        <span class="cal-num">${d}</span>
        <span class="cal-dots">${dots}</span>
      </div>`;
    };

    // Agenda: día seleccionado, o todos los eventos del mes ordenados
    const agendaEvents = (ui.calSel && byDay.has(ui.calSel))
      ? byDay.get(ui.calSel).map((e) => ({ ...e }))
      : events.slice();
    agendaEvents.sort((a, b) => a.date.localeCompare(b.date));

    let agendaHTML = '';
    let lastDay = '';
    if (!agendaEvents.length) {
      agendaHTML = '<div class="empty">No hay pagos ni ingresos previstos este mes. Cargá tus gastos fijos y tarjetas en “Planificar” y “Tarjetas”.</div>';
    } else {
      for (const ev of agendaEvents) {
        if (ev.date !== lastDay) {
          lastDay = ev.date;
          const dd = parseDate(ev.date);
          agendaHTML += `<div class="agenda-day">${esc(new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(dd))}</div>`;
        }
        const v = eventAmountDisp(ev);
        const amountTxt = ev.kind === 'card'
          ? fmtDisp(v)
          : (ev.kind === 'ingreso' ? '+ ' : '− ') + fmtMoney(ev.amount, ev.currency);
        const amountCls = ev.kind === 'ingreso' ? 'amount-in' : '';
        agendaHTML += `<div class="agenda-item">
          <div class="agenda-icon">${ev.icon}</div>
          <div class="agenda-body">
            <div class="agenda-name">${esc(ev.title)}</div>
            <div class="agenda-sub">${esc(ev.sub)}</div>
          </div>
          <div class="agenda-amount ${amountCls}">${amountTxt}</div>
        </div>`;
      }
    }

    el.innerHTML = `
      <div class="grid-2">
        <div class="card tile">
          <div class="tile-label">Pagos previstos · ${esc(monthLabel(mk))}</div>
          <div class="tile-value">${fmtDisp(mesPagos)}</div>
          <div class="tile-delta">Gastos fijos y vencimientos de tarjeta</div>
        </div>
        <div class="card tile">
          <div class="tile-label">Eventos este mes</div>
          <div class="tile-value">${events.length}</div>
          <div class="tile-delta">Anticipate: nunca se te pasa un pago</div>
        </div>
      </div>

      <div class="card">
        <div class="cal-head">
          <button class="icon-btn" data-cnav="-1" aria-label="Mes anterior">‹</button>
          <span class="month-label">${esc(monthLabel(mk))}</span>
          <button class="icon-btn" data-cnav="1" aria-label="Mes siguiente">›</button>
        </div>
        <div class="cal-grid">
          ${dow.map((d) => `<div class="cal-dow">${d}</div>`).join('')}
          ${cells.map(cellHTML).join('')}
        </div>
        <div class="chart-legend" style="margin-top:12px">
          <span><span class="key" style="background:var(--expense-series)"></span>Gasto fijo</span>
          <span><span class="key" style="background:var(--income-series)"></span>Ingreso fijo</span>
          <span><span class="key" style="background:var(--accent)"></span>Tarjeta</span>
        </div>
      </div>

      <div class="card">
        <h2 class="card-title">
          <span>${ui.calSel ? 'Día seleccionado' : 'Agenda del mes'}</span>
          ${ui.calSel ? '<button class="link-btn" data-calall>ver todo el mes</button>' : ''}
        </h2>
        <div class="agenda">${agendaHTML}</div>
      </div>`;

    $$('[data-cnav]', el).forEach((b) => b.addEventListener('click', () => {
      ui.calMonth = addMonthsKey(ui.calMonth, Number(b.dataset.cnav));
      ui.calSel = null;
      render();
    }));
    $$('[data-day]', el).forEach((c) => c.addEventListener('click', () => {
      ui.calSel = (ui.calSel === c.dataset.day) ? null : c.dataset.day;
      render();
    }));
    const calAll = $('[data-calall]', el);
    if (calAll) calAll.addEventListener('click', () => { ui.calSel = null; render(); });
  }

  /* ================= Vista: Ahorros ================= */
  function savingForm(saving) {
    const editing = !!saving;
    const s = saving || { name: '', currency: 'USD', target: '' };
    const body = `
      <div class="field">
        <label for="s-name">Nombre</label>
        <input type="text" name="name" id="s-name" required maxlength="40"
               placeholder="Colchón en USD, plazo fijo, viaje…" value="${esc(s.name)}">
      </div>
      <div class="field-row">
        <div class="field">
          <label for="s-cur">Moneda</label>
          <select name="currency" id="s-cur">
            <option value="ARS" ${s.currency === 'ARS' ? 'selected' : ''}>ARS — pesos</option>
            <option value="USD" ${s.currency === 'USD' ? 'selected' : ''}>USD — dólares</option>
          </select>
        </div>
        <div class="field">
          <label for="s-target">Meta <span class="hint">(opcional)</span></label>
          <input type="number" name="target" id="s-target" min="0" step="0.01" value="${esc(s.target || '')}">
        </div>
      </div>`;
    openDialog(editing ? 'Editar ahorro' : 'Nuevo ahorro', body, {
      onSubmit(d) {
        const target = parseFloat(d.target);
        const data = {
          name: d.name.trim(),
          currency: d.currency,
          target: target > 0 ? target : null,
        };
        if (editing) Object.assign(saving, data);
        else S().savings.push({ id: Store.uid(), ...data, entries: [] });
        Store.save();
        render();
      },
    });
  }

  function savingEntryForm(saving, sign) {
    const body = `
      <div class="field-row">
        <div class="field">
          <label for="e-date">Fecha</label>
          <input type="date" name="date" id="e-date" value="${todayStr()}" required>
        </div>
        <div class="field">
          <label for="e-amount">Monto (${esc(saving.currency)})</label>
          <input type="number" name="amount" id="e-amount" min="0.01" step="0.01" required>
        </div>
      </div>
      <div class="field">
        <label for="e-note">Detalle <span class="hint">(opcional)</span></label>
        <input type="text" name="note" id="e-note" maxlength="60">
      </div>`;
    openDialog(sign > 0 ? `Aporte a “${saving.name}”` : `Retiro de “${saving.name}”`, body, {
      submitLabel: sign > 0 ? 'Registrar aporte' : 'Registrar retiro',
      onSubmit(d) {
        const amount = Math.round(parseFloat(d.amount) * 100) / 100;
        if (!(amount > 0)) return false;
        saving.entries.push({
          id: Store.uid(), date: d.date, amount: amount * sign, note: d.note.trim(),
        });
        Store.save();
        render();
      },
    });
  }

  function vAhorros(el) {
    const savings = S().savings;
    let total = 0;
    for (const s of savings) {
      const v = convOrNull(s.entries.reduce((a, e) => a + e.amount, 0), s.currency);
      if (v != null) total += v;
    }

    el.innerHTML = `
      <div class="toolbar">
        <div class="card tile" style="min-width:220px">
          <div class="tile-label">Total ahorrado</div>
          <div class="tile-value">${fmtDisp(total)}</div>
        </div>
        <div class="spacer"></div>
        <button class="btn btn-primary btn-sm" id="btn-add-saving">+ Nuevo ahorro</button>
      </div>
      ${savings.length ? `<div class="entity-grid">
        ${savings.map((s) => {
          const bal = s.entries.reduce((a, e) => a + e.amount, 0);
          const other = s.currency === 'ARS' ? 'USD' : 'ARS';
          const conv = FX.convert(bal, s.currency, other, rate() ? rate().value : null);
          const pct = s.target ? Math.min(100, Math.round((bal / s.target) * 100)) : null;
          const open = !!ui.openSavings[s.id];
          const entries = s.entries.slice().sort((a, b) => b.date.localeCompare(a.date));
          return `<div class="entity">
            <div class="entity-head">
              <span class="entity-name">${esc(s.name)}</span>
              <span class="badge badge-cur">${esc(s.currency)}</span>
            </div>
            <div class="tile-value" style="font-size:21px">${fmtMoney(bal, s.currency)}</div>
            <div class="cell-sub">${conv != null ? '≈ ' + fmtMoney(conv, other) : ''}</div>
            ${s.target ? `
              <div class="meter ${pct >= 100 ? 'meter-ok' : 'meter-ok'}"><span style="width:${pct}%"></span></div>
              <div class="cell-sub">Meta: ${fmtMoney(s.target, s.currency)} · ${pct}%</div>` : ''}
            <div class="entity-actions">
              <button class="btn btn-sm" data-add="${esc(s.id)}">+ Aporte</button>
              <button class="btn btn-sm" data-sub="${esc(s.id)}">− Retiro</button>
              <button class="btn btn-sm" data-hist="${esc(s.id)}">${open ? 'Ocultar' : 'Historial'}</button>
              <button class="btn btn-sm" data-edit="${esc(s.id)}">Editar</button>
              <button class="btn btn-sm btn-danger" data-del="${esc(s.id)}">Eliminar</button>
            </div>
            ${open ? `<div class="table-scroll"><table class="data">
              <tbody>${entries.length ? entries.map((e) => `
                <tr>
                  <td class="cell-sub">${esc(fmtDateShort(e.date))}</td>
                  <td>${esc(e.note || (e.amount >= 0 ? 'Aporte' : 'Retiro'))}</td>
                  <td class="num ${e.amount >= 0 ? 'amount-in' : ''}">${e.amount >= 0 ? '+' : '−'} ${fmtMoney(Math.abs(e.amount), s.currency)}</td>
                  <td><button class="row-del" data-edel="${esc(s.id)}:${esc(e.id)}" aria-label="Eliminar">✕</button></td>
                </tr>`).join('') : '<tr><td class="empty">Sin movimientos.</td></tr>'}
              </tbody>
            </table></div>` : ''}
          </div>`;
        }).join('')}
      </div>`
      : '<div class="card"><div class="empty">Creá tu primer fondo de ahorro: un colchón en dólares, un plazo fijo o una meta puntual (viaje, auto, mudanza).</div></div>'}`;

    $('#btn-add-saving', el).addEventListener('click', () => savingForm(null));
    const byId = (id) => savings.find((s) => s.id === id);
    $$('[data-add]', el).forEach((b) => b.addEventListener('click', () => savingEntryForm(byId(b.dataset.add), 1)));
    $$('[data-sub]', el).forEach((b) => b.addEventListener('click', () => savingEntryForm(byId(b.dataset.sub), -1)));
    $$('[data-hist]', el).forEach((b) => b.addEventListener('click', () => {
      ui.openSavings[b.dataset.hist] = !ui.openSavings[b.dataset.hist];
      render();
    }));
    $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => savingForm(byId(b.dataset.edit))));
    $$('[data-del]', el).forEach((b) => b.addEventListener('click', () => {
      const s = byId(b.dataset.del);
      if (!confirm(`¿Eliminar “${s.name}” y todo su historial?`)) return;
      S().savings = savings.filter((x) => x.id !== s.id);
      Store.save();
      render();
    }));
    $$('[data-edel]', el).forEach((b) => b.addEventListener('click', () => {
      const [sid, eid] = b.dataset.edel.split(':');
      const s = byId(sid);
      s.entries = s.entries.filter((e) => e.id !== eid);
      Store.save();
      render();
    }));
  }

  /* ================= Vista: Planificar ================= */
  function budgetForm(budget) {
    const editing = !!budget;
    const b = budget || { categoryId: '', amount: '', currency: 'ARS' };
    const usados = new Set(S().budgets.map((x) => x.categoryId));
    const cats = catGroups('gasto').filter((c) => editing || !usados.has(c.id));
    if (!cats.length) { alert('Todas las categorías de gasto ya tienen presupuesto.'); return; }
    const body = `
      <div class="field">
        <label for="b-cat">Categoría</label>
        <select name="categoryId" id="b-cat" ${editing ? 'disabled' : ''} required>
          ${selOptions(cats, b.categoryId)}
        </select>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="b-amount">Presupuesto mensual</label>
          <input type="number" name="amount" id="b-amount" min="1" step="0.01" required value="${esc(b.amount || '')}">
        </div>
        <div class="field">
          <label for="b-cur">Moneda</label>
          <select name="currency" id="b-cur">
            <option value="ARS" ${b.currency === 'ARS' ? 'selected' : ''}>ARS</option>
            <option value="USD" ${b.currency === 'USD' ? 'selected' : ''}>USD</option>
          </select>
        </div>
      </div>`;
    openDialog(editing ? 'Editar presupuesto' : 'Nuevo presupuesto', body, {
      onSubmit(d) {
        const amount = parseFloat(d.amount);
        if (!(amount > 0)) return false;
        if (editing) Object.assign(budget, { amount, currency: d.currency });
        else S().budgets.push({ id: Store.uid(), categoryId: d.categoryId, amount, currency: d.currency });
        Store.save();
        render();
      },
    });
  }

  function recurringForm(rec) {
    const editing = !!rec;
    const r = rec || {
      name: '', type: 'gasto', amount: '', currency: 'ARS',
      categoryId: '', methodId: S().methods[0] ? S().methods[0].id : '', day: 1,
    };
    const body = `
      <div class="field">
        <label for="r-name">Nombre</label>
        <input type="text" name="name" id="r-name" required maxlength="60"
               placeholder="Alquiler, Netflix, sueldo…" value="${esc(r.name)}">
      </div>
      <div class="field-row">
        <div class="field">
          <label for="r-type">Tipo</label>
          <select name="type" id="r-type">
            <option value="gasto" ${r.type === 'gasto' ? 'selected' : ''}>Gasto</option>
            <option value="ingreso" ${r.type === 'ingreso' ? 'selected' : ''}>Ingreso</option>
          </select>
        </div>
        <div class="field">
          <label for="r-day">Día del mes</label>
          <input type="number" name="day" id="r-day" min="1" max="28" step="1" required value="${esc(r.day)}">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="r-amount">Monto</label>
          <input type="number" name="amount" id="r-amount" min="0.01" step="0.01" required value="${esc(r.amount || '')}">
        </div>
        <div class="field">
          <label for="r-cur">Moneda</label>
          <select name="currency" id="r-cur">
            <option value="ARS" ${r.currency === 'ARS' ? 'selected' : ''}>ARS</option>
            <option value="USD" ${r.currency === 'USD' ? 'selected' : ''}>USD</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label for="r-cat">Categoría</label>
        <select name="categoryId" id="r-cat" required>${catSelectOptionsHTML(r.type, r.categoryId)}</select>
      </div>
      <div class="field">
        <label for="r-method">Medio de pago</label>
        <select name="methodId" id="r-method" required>${selOptions(S().methods, r.methodId)}</select>
      </div>
      <span class="hint">Se genera un movimiento automáticamente cada mes, a partir de este mes.</span>`;
    const dlg = openDialog(editing ? 'Editar movimiento fijo' : 'Nuevo movimiento fijo', body, {
      onSubmit(d) {
        const amount = parseFloat(d.amount);
        if (!(amount > 0)) return false;
        const data = {
          name: d.name.trim(), type: d.type, amount, currency: d.currency,
          categoryId: d.categoryId, methodId: d.methodId,
          day: Math.min(28, Math.max(1, parseInt(d.day, 10) || 1)),
        };
        if (editing) {
          Object.assign(rec, data);
        } else {
          S().recurring.push({ id: Store.uid(), ...data, lastGen: null });
          generateRecurring();
        }
        Store.save();
        render();
      },
    });
    $('#r-type', dlg).addEventListener('change', () => {
      const sel = $('#r-cat', dlg);
      sel.innerHTML = catSelectOptionsHTML($('#r-type', dlg).value, sel.value);
    });
  }

  // Agrupa las cuotas activas (compras en cuotas) por groupId: junta todas
  // las cuotas de una misma compra para saber en cuál va y cuánto falta.
  // Los grupos que ya terminaron de pagarse (todas las cuotas con fecha
  // pasada) no se muestran.
  function activeInstallmentGroups() {
    const groups = new Map();
    for (const t of S().transactions) {
      if (!t.groupId || !t.installment) continue;
      if (!groups.has(t.groupId)) groups.set(t.groupId, []);
      groups.get(t.groupId).push(t);
    }
    const today = todayStr();
    const rows = [];
    for (const txs of groups.values()) {
      txs.sort((a, b) => a.installment.k - b.installment.k);
      const pending = txs.filter((t) => t.date > today);
      if (!pending.length) continue;
      const next = pending[0];
      const totalPending = pending.reduce((a, t) => a + t.amount, 0);
      rows.push({
        groupId: txs[0].groupId, note: txs[0].note, categoryId: txs[0].categoryId,
        methodId: txs[0].methodId, currency: txs[0].currency,
        n: next.installment.n, nextK: next.installment.k, next, totalPending,
      });
    }
    return rows.sort((a, b) => a.next.date.localeCompare(b.next.date));
  }

  function vPlan(el) {
    const mk = curMonth();
    const monthTx = S().transactions.filter(
      (t) => t.type === 'gasto' && effectiveMonthOf(t) === mk);
    const instRows = activeInstallmentGroups();

    const budgetRows = S().budgets.map((b) => {
      const spent = sumDisp(monthTx.filter((t) => topCategoryOf(t.categoryId) === b.categoryId));
      const limit = convOrNull(b.amount, b.currency);
      const pct = limit > 0 ? (spent / limit) * 100 : null;
      return { b, spent, limit, pct };
    }).sort((a, x) => (x.pct || 0) - (a.pct || 0));

    el.innerHTML = `
      <div class="card">
        <h2 class="card-title">
          <span>Presupuestos por categoría · ${esc(monthLabel(mk))}</span>
          <button class="link-btn" id="btn-add-budget">+ Presupuesto</button>
        </h2>
        ${budgetRows.length ? `
        <div class="table-scroll"><table class="data">
          <thead><tr>
            <th>Categoría</th><th class="num">Presupuesto</th><th class="num">Gastado</th>
            <th style="width:30%">Avance</th><th class="num">%</th><th></th>
          </tr></thead>
          <tbody>${budgetRows.map(({ b, spent, limit, pct }) => {
            const cls = pct == null ? 'meter-ok' : pct >= 100 ? 'meter-crit' : pct >= 80 ? 'meter-warn' : 'meter-ok';
            const over = pct != null && pct >= 100;
            return `<tr class="rowlink" data-bid="${esc(b.id)}">
              <td><b>${esc(catName(b.categoryId))}</b></td>
              <td class="num">${fmtMoney(b.amount, b.currency)}</td>
              <td class="num">${fmtDisp(spent)}</td>
              <td><div class="meter ${cls}"><span style="width:${Math.min(100, pct || 0)}%"></span></div></td>
              <td class="num" ${over ? 'style="color:var(--crit);font-weight:600"' : ''}>${pct == null ? '—' : Math.round(pct) + '%'}${over ? ' ⚠' : ''}</td>
              <td><button class="row-del" data-bdel="${esc(b.id)}" aria-label="Eliminar">✕</button></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`
        : '<div class="empty">Definí cuánto querés gastar por mes en cada categoría y controlá el avance acá.</div>'}
      </div>

      <div class="card">
        <h2 class="card-title">
          <span>Movimientos fijos (se repiten todos los meses)</span>
          <button class="link-btn" id="btn-add-rec">+ Fijo</button>
        </h2>
        ${S().recurring.length ? `
        <div class="tx-card-list">
          ${S().recurring.map((r) => {
            const isIncome = r.type === 'ingreso';
            return `<div class="tx-card-row" data-rid="${esc(r.id)}">
              <div class="row-icon ${isIncome ? 'row-icon-income' : 'row-icon-expense'}">${iconSvg(isIncome ? 'trend' : 'cash')}</div>
              <div class="tx-card-main">
                <div class="tx-card-title">${esc(r.name)}</div>
                <div class="tx-card-sub">${esc(catName(r.categoryId))} · ${esc(methodName(r.methodId))} · día ${r.day}</div>
              </div>
              <div class="tx-card-amount">
                <div class="v ${isIncome ? 'pos' : ''}">${isIncome ? '+' : '−'} ${fmtMoney(r.amount, r.currency)}</div>
              </div>
              <button class="tx-card-del" data-rdel="${esc(r.id)}" aria-label="Eliminar">✕</button>
            </div>`;
          }).join('')}
        </div>
        <div class="hint" style="margin-top:8px">Al abrir la app en un mes nuevo, estos movimientos se cargan solos. Los ya generados se pueden editar o borrar como cualquier movimiento.</div>`
        : '<div class="empty">Cargá tus gastos e ingresos fijos (alquiler, suscripciones, sueldo) y se registran solos cada mes.</div>'}
      </div>

      <div class="card">
        <h2 class="card-title">Compras en cuotas</h2>
        ${instRows.length ? `
        <div class="table-scroll"><table class="data">
          <thead><tr>
            <th>Compra</th><th>Cuota</th><th class="num">Monto de la cuota</th><th>Próximo cargo</th><th class="num">Restan pagar</th>
          </tr></thead>
          <tbody>${instRows.map((r) => `
            <tr class="rowlink" data-instgroup="${esc(r.groupId)}">
              <td><b>${esc(r.note || catName(r.categoryId))}</b><div class="cell-sub">${esc(methodName(r.methodId))}</div></td>
              <td class="cell-sub">${r.nextK}/${r.n}</td>
              <td class="num">${fmtMoney(r.next.amount, r.currency)}</td>
              <td class="cell-sub">${esc(fmtDateShort(r.next.date))}</td>
              <td class="num">${fmtMoney(r.totalPending, r.currency)}</td>
            </tr>`).join('')}</tbody>
        </table></div>`
        : '<div class="empty">Cuando cargues una compra en cuotas desde "+ Movimiento", la vas a ver acá con cuántas cuotas faltan.</div>'}
      </div>`;

    $$('tr[data-instgroup]', el).forEach((row) => row.addEventListener('click', () => {
      const g = instRows.find((r) => r.groupId === row.dataset.instgroup);
      if (g) txForm(g.next);
    }));
    $('#btn-add-budget', el).addEventListener('click', () => budgetForm(null));
    $('#btn-add-rec', el).addEventListener('click', () => recurringForm(null));
    $$('tr[data-bid]', el).forEach((row) => row.addEventListener('click', (e) => {
      if (e.target.closest('[data-bdel]')) return;
      budgetForm(S().budgets.find((b) => b.id === row.dataset.bid));
    }));
    $$('[data-bdel]', el).forEach((b) => b.addEventListener('click', () => {
      S().budgets = S().budgets.filter((x) => x.id !== b.dataset.bdel);
      Store.save();
      render();
    }));
    $$('[data-rid]', el).forEach((row) => row.addEventListener('click', (e) => {
      if (e.target.closest('[data-rdel]')) return;
      recurringForm(S().recurring.find((r) => r.id === row.dataset.rid));
    }));
    $$('[data-rdel]', el).forEach((b) => b.addEventListener('click', () => {
      if (!confirm('¿Eliminar este movimiento fijo? Los ya generados no se borran.')) return;
      S().recurring = S().recurring.filter((r) => r.id !== b.dataset.rdel);
      Store.save();
      render();
    }));
  }

  /* ================= Vista: Ajustes ================= */
  function exportCSV() {
    const sep = ';';
    const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = ['fecha;tipo;monto;moneda;categoria;medio;detalle;cuota'];
    const txs = S().transactions.slice().sort((a, b) => a.date.localeCompare(b.date));
    for (const t of txs) {
      const catCol = t.type === 'transferencia' ? `→ ${methodName(t.toMethodId)}` : catName(t.categoryId);
      lines.push([
        t.date, t.type, String(t.amount).replace('.', ','), t.currency,
        q(catCol), q(methodName(t.methodId)), q(t.note || ''),
        t.installment ? `${t.installment.k}/${t.installment.n}` : '',
      ].join(sep));
    }
    downloadFile('finpepe-movimientos.csv', '﻿' + lines.join('\r\n'), 'text/csv');
  }

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type: type + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* Crear/editar un grupo de categoría: nombre, sus subcategorías (agregar,
     renombrar, borrar) y borrar el grupo entero si queda vacío y sin uso. */
  function categoryGroupForm(group, newType) {
    const editing = !!group;
    const type = editing ? group.type : newType;
    const children = editing ? catChildren(group.id) : [];

    function catInUse(id) {
      return S().transactions.some((t) => t.categoryId === id) ||
        S().budgets.some((x) => x.categoryId === id) ||
        S().recurring.some((r) => r.categoryId === id);
    }

    function body() {
      return `
      <div class="field">
        <label for="cg-name">Nombre</label>
        <input type="text" name="name" id="cg-name" required maxlength="30" value="${esc(editing ? group.name : '')}">
      </div>
      ${editing ? `
      <div class="field">
        <label>Subcategorías</label>
        <div class="cat-list" id="cg-children">
          ${children.map((c) => `<span class="cat-chip">${esc(c.name)}<button type="button" data-childdel="${esc(c.id)}" aria-label="Eliminar ${esc(c.name)}">✕</button></span>`).join('') || '<span class="hint">Ninguna todavía.</span>'}
        </div>
      </div>
      <div class="field">
        <div class="inline-form">
          <input type="text" id="cg-newchild" placeholder="Nueva subcategoría…" maxlength="30">
          <button type="button" class="btn btn-sm" id="cg-addchild">Agregar</button>
        </div>
      </div>` : ''}`;
    }

    const dlg = openDialog(editing ? 'Editar categoría' : 'Nueva categoría', body(), {
      footExtra: editing ? '<button type="button" class="btn btn-danger" data-delgroup style="margin-right:auto">Eliminar</button>' : '',
      onSubmit(d) {
        const name = d.name.trim();
        if (!name) return false;
        if (editing) {
          group.name = name;
        } else {
          S().categories.push({ id: Store.uid(), name, type, parentId: null });
        }
        Store.save();
        render();
      },
    });

    if (editing) {
      const refreshChildren = () => {
        $('#cg-children', dlg).innerHTML = catChildren(group.id).map((c) =>
          `<span class="cat-chip">${esc(c.name)}<button type="button" data-childdel="${esc(c.id)}" aria-label="Eliminar ${esc(c.name)}">✕</button></span>`
        ).join('') || '<span class="hint">Ninguna todavía.</span>';
        $$('[data-childdel]', dlg).forEach((b) => b.addEventListener('click', onChildDel));
      };
      function onChildDel(e) {
        const id = e.currentTarget.dataset.childdel;
        if (catInUse(id)) { alert('Esa subcategoría está en uso (movimientos, presupuestos o fijos). Reasignalos primero.'); return; }
        S().categories = S().categories.filter((c) => c.id !== id);
        Store.save();
        refreshChildren();
      }
      $$('[data-childdel]', dlg).forEach((b) => b.addEventListener('click', onChildDel));
      $('#cg-addchild', dlg).addEventListener('click', () => {
        const input = $('#cg-newchild', dlg);
        const name = input.value.trim();
        if (!name) return;
        S().categories.push({ id: Store.uid(), name, type, parentId: group.id });
        Store.save();
        input.value = '';
        refreshChildren();
      });
      $('[data-delgroup]', dlg).addEventListener('click', () => {
        if (catChildren(group.id).length) { alert('Primero borrá sus subcategorías.'); return; }
        if (catInUse(group.id)) { alert('Esta categoría está en uso (movimientos, presupuestos o fijos). Reasignala primero.'); return; }
        if (!confirm(`¿Eliminar “${group.name}”?`)) return;
        S().categories = S().categories.filter((c) => c.id !== group.id);
        Store.save();
        dlg.close();
        render();
      });
    }
  }

  function vAjustes(el) {
    const s = S().settings;
    const updated = s.ratesUpdatedAt
      ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(s.ratesUpdatedAt))
      : 'nunca';
    const counts = {
      tx: S().transactions.length,
      sav: S().savings.length,
    };

    el.innerHTML = `
      <div class="settings-grid">
        <div class="card" id="account-card">${accountCardHTML()}</div>

        <div class="card">
          <h2 class="card-title">Apariencia</h2>
          <div class="inline-form">
            <button class="btn btn-sm" id="btn-theme-toggle" type="button">
              ${currentTheme() === 'dark' ? '☀ Cambiar a modo claro' : '◐ Cambiar a modo oscuro'}
            </button>
          </div>
        </div>

        <div class="card">
          <h2 class="card-title">Cotización del dólar</h2>
          <div class="fx-current">
            ${rate() ? `US$ 1 = ${esc(fmtMoney(rate().value, 'ARS'))} <span class="cell-sub">(${esc(rate().label)})</span>` : '<span class="cell-sub">Sin cotización disponible</span>'}
          </div>
          <div class="inline-form" style="margin-bottom:10px">
            <label for="set-fx" class="hint">Tipo de cambio:</label>
            <select id="set-fx">
              ${FX.SOURCES.map((x) => `<option value="${x.id}" ${s.fxSource === x.id ? 'selected' : ''}>${x.name}</option>`).join('')}
            </select>
            <button class="btn btn-sm" id="btn-fx-refresh">Actualizar ahora</button>
            <span class="hint">Última actualización: ${esc(updated)} · fuente: DolarAPI</span>
          </div>
          <div class="inline-form">
            <label for="set-manual" class="hint">Cotización manual (pisa la automática):</label>
            <input type="number" id="set-manual" min="0" step="0.01" placeholder="p. ej. 1250"
                   value="${s.manualRate ?? ''}" style="width:120px">
            <button class="btn btn-sm" id="btn-manual-save">Aplicar</button>
            ${s.manualRate ? '<button class="btn btn-sm" id="btn-manual-clear">Volver a automática</button>' : ''}
          </div>
          <div class="hint" style="margin-top:10px">
            Las conversiones ARS ⇄ USD de toda la app usan esta cotización (valor venta).
            Cada movimiento guarda su moneda original, así que podés cambiar de fuente cuando quieras.
          </div>
        </div>

        <div class="card">
          <h2 class="card-title">Tarjetas de crédito</h2>
          <div class="inline-form">
            <label for="set-cardmonth" class="hint">Un gasto con tarjeta de crédito cuenta en el balance del mes de:</label>
            <select id="set-cardmonth">
              <option value="compra" ${s.cardMonthBasis === 'compra' ? 'selected' : ''}>la compra</option>
              <option value="vencimiento" ${s.cardMonthBasis === 'vencimiento' ? 'selected' : ''}>el vencimiento del resumen</option>
            </select>
          </div>
          <div class="hint" style="margin-top:10px">
            ${s.cardMonthBasis === 'vencimiento'
              ? 'Un gasto con tarjeta pega en el balance del mes en que vence ese resumen (cuando efectivamente lo pagás), no en el mes en que compraste.'
              : 'Un gasto con tarjeta pega en el balance del mes en que lo compraste, aunque el resumen recién venza el mes siguiente.'}
            Solo afecta a los medios de pago tipo "Crédito"; el resto siempre cuenta por su fecha.
          </div>
        </div>

        <div class="card">
          <h2 class="card-title">
            <span>Categorías</span>
            <label class="subcats-toggle">
              Subcategorías
              <input type="checkbox" id="set-subcats" ${useSubcats() ? 'checked' : ''}>
            </label>
          </h2>
          <div class="cat-type-grid">
            ${['gasto', 'ingreso'].map((type) => `
              <div>
                <div class="hint" style="margin-bottom:6px">${type === 'gasto' ? 'De gastos' : 'De ingresos'}</div>
                <div class="cat-group-list">
                  ${catGroups(type).map((g) => {
                    const children = catChildren(g.id);
                    return `<div class="cat-group-row">
                      <div class="cat-group-main">
                        <div><b>${esc(g.name)}</b>${children.length ? ` <span class="cell-sub">(${children.length})</span>` : ''}</div>
                        ${children.length ? `<div class="cell-sub">${esc(children.map((c) => c.name).join(', '))}</div>` : ''}
                      </div>
                      <button class="btn btn-sm" data-editgroup="${esc(g.id)}" aria-label="Editar ${esc(g.name)}">✎</button>
                    </div>`;
                  }).join('') || '<div class="empty">Sin categorías todavía.</div>'}
                </div>
                <button class="link-btn" data-addgroup="${type}" style="margin-top:8px">+ Agregar categoría</button>
              </div>`).join('')}
          </div>
        </div>

        <div class="card">
          <h2 class="card-title">Datos y copias de seguridad</h2>
          <div class="hint" style="margin-bottom:10px">
            Todo se guarda en este navegador (${counts.tx} movimientos, ${counts.sav} ahorros).
            Si borrás los datos del navegador o cambiás de dispositivo, se pierde: exportá un respaldo cada tanto.
          </div>
          <div class="inline-form">
            <button class="btn btn-sm" id="btn-export-json">Descargar respaldo (JSON)</button>
            <button class="btn btn-sm" id="btn-import-json">Restaurar respaldo…</button>
            <button class="btn btn-sm" id="btn-export-csv">Exportar movimientos (CSV)</button>
            <input type="file" id="file-import" accept="application/json,.json" hidden>
          </div>
          <div class="inline-form" style="margin-top:14px">
            <button class="btn btn-sm btn-danger" id="btn-wipe">Borrar todos los datos</button>
          </div>
        </div>
      </div>`;

    wireAccountCard(el);
    $('#btn-theme-toggle', el).addEventListener('click', toggleTheme);
    $('#set-fx', el).addEventListener('change', (e) => {
      S().settings.fxSource = e.target.value;
      Store.save();
      render();
    });
    $('#btn-fx-refresh', el).addEventListener('click', refreshRates);
    $('#btn-manual-save', el).addEventListener('click', () => {
      const v = parseFloat($('#set-manual', el).value);
      S().settings.manualRate = v > 0 ? v : null;
      Store.save();
      render();
    });
    const clearBtn = $('#btn-manual-clear', el);
    if (clearBtn) clearBtn.addEventListener('click', () => {
      S().settings.manualRate = null;
      Store.save();
      render();
    });

    $('#set-cardmonth', el).addEventListener('change', (e) => {
      S().settings.cardMonthBasis = e.target.value;
      Store.save();
      render();
    });
    $('#set-subcats', el).addEventListener('change', (e) => {
      S().settings.useSubcategories = e.target.checked;
      Store.save();
      render();
    });
    $$('[data-addgroup]', el).forEach((b) => b.addEventListener('click', () => categoryGroupForm(null, b.dataset.addgroup)));
    $$('[data-editgroup]', el).forEach((b) => b.addEventListener('click', () => {
      categoryGroupForm(catById(b.dataset.editgroup), null);
    }));

    $('#btn-export-json', el).addEventListener('click', () => {
      downloadFile(`finpepe-respaldo-${todayStr()}.json`, Store.exportJSON(), 'application/json');
    });
    $('#btn-import-json', el).addEventListener('click', () => $('#file-import', el).click());
    $('#file-import', el).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!data || !Array.isArray(data.transactions)) throw new Error('Formato inválido');
        if (!confirm('Esto reemplaza todos los datos actuales por el respaldo. ¿Continuar?')) return;
        Store.replace(data);
        render();
      } catch (err) {
        alert('No se pudo leer el respaldo: ' + err.message);
      }
    });
    $('#btn-export-csv', el).addEventListener('click', exportCSV);
    $('#btn-wipe', el).addEventListener('click', () => {
      if (!confirm('Se borran TODOS los datos de la app en este navegador. Esta acción no se puede deshacer.')) return;
      if (!confirm('¿Seguro? Si no tenés un respaldo JSON, no hay forma de recuperarlos.')) return;
      Store.reset();
      render();
    });
  }

  /* ================= Nube / cuenta (Supabase) ================= */
  // Supabase Auth pide un email, pero acá se usa como un login simple de
  // "usuario": puertas adentro se arma un email falso con un dominio que no
  // existe (.invalid, reservado por RFC 2606 justo para esto). Nadie ve ese
  // dominio: siempre se muestra solo la parte de usuario.
  const AUTH_DOMAIN = 'finpepe.invalid';
  function usernameToEmail(u) {
    const slug = u.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    return slug ? `${slug}@${AUTH_DOMAIN}` : '';
  }
  function usernameOf(email) {
    return (email || '').split('@')[0] || 'sesión activa';
  }
  let cloudBusy = false;

  function renderAccountChip() {
    const chip = $('#account-chip');
    if (!chip) return;
    chip.classList.add('account-chip');
    chip.classList.remove('synced', 'offline');
    if (!Cloud.isConfigured()) {
      chip.innerHTML = '<span class="dot"></span>Nube: desconectada';
    } else if (Cloud.user()) {
      chip.classList.add('synced');
      chip.innerHTML = `<span class="dot"></span>${esc(usernameOf(Cloud.user().email))}`;
    } else {
      chip.classList.add('offline');
      chip.innerHTML = '<span class="dot"></span>Iniciar sesión';
    }
  }


  function accountCardHTML() {
    const c = Cloud.config();
    if (!Cloud.available()) {
      return `<h2 class="card-title">Sincronización en la nube</h2>
        <div class="empty">No se pudo cargar el cliente de Supabase (¿estás sin conexión?). La app sigue funcionando y guardando en este navegador.</div>`;
    }
    if (Cloud.user()) {
      return `<h2 class="card-title">Sincronización en la nube</h2>
        <div class="auth-status"><span class="dot"></span> Conectado como <b>${esc(usernameOf(Cloud.user().email))}</b></div>
        <div class="hint" style="margin-bottom:10px">Tus datos se guardan en tu proyecto de Supabase y se sincronizan en todos tus dispositivos donde inicies sesión.</div>
        ${Cloud.hasGoogle()
          ? '<div class="hint" style="margin-bottom:10px">✓ Google vinculado: también podés entrar con esa cuenta.</div>'
          : `<div class="inline-form" style="margin-bottom:10px">
               <button class="btn btn-sm" id="btn-cloud-link-google">${GOOGLE_G_SVG}Vincular con Google</button>
             </div>`}
        <div class="inline-form">
          <button class="btn btn-sm" id="btn-cloud-pull">Traer datos de la nube</button>
          <button class="btn btn-sm btn-danger" id="btn-cloud-signout">Cerrar sesión</button>
        </div>`;
    }
    if (Cloud.isConfigured()) {
      return `<h2 class="card-title">Sincronización en la nube</h2>
        <div class="hint" style="margin-bottom:10px">Iniciá sesión (o creá tu cuenta) para sincronizar tus datos entre dispositivos.</div>
        <div class="inline-form">
          <button class="btn btn-primary btn-sm" id="btn-cloud-login">Iniciar sesión / crear cuenta</button>
          ${Cloud.hasDefaults() ? '' : '<button class="btn btn-sm" id="btn-cloud-config">Cambiar proyecto</button>'}
        </div>`;
    }
    return `<h2 class="card-title">Sincronización en la nube (opcional)</h2>
      <div class="hint" style="margin-bottom:10px">
        Por defecto los datos viven solo en este navegador. Si querés que se
        guarden en una base de datos y se sincronicen entre tu teléfono y la
        computadora, conectá tu proyecto de <b>Supabase</b> (gratis).
      </div>
      <ol class="hint" style="margin:0 0 12px 18px;line-height:1.7">
        <li>En Supabase → <b>SQL Editor</b>, ejecutá el script <code>supabase-schema.sql</code> del repo.</li>
        <li>En <b>Project Settings → API</b>, copiá la <b>Project URL</b> y la <b>anon public key</b>.</li>
        <li>Pegalas acá abajo. (Son claves públicas: es seguro usarlas en el navegador.)</li>
      </ol>
      <div class="field" style="margin-bottom:8px">
        <label for="sb-url">Project URL</label>
        <input type="text" id="sb-url" placeholder="https://xxxx.supabase.co" value="${esc(c.url || '')}">
      </div>
      <div class="field" style="margin-bottom:10px">
        <label for="sb-key">anon public key</label>
        <input type="text" id="sb-key" placeholder="eyJhbGciOi…" value="${esc(c.anonKey || '')}">
      </div>
      <button class="btn btn-primary btn-sm" id="btn-cloud-save">Conectar proyecto</button>`;
  }

  function refreshAccountCard() {
    const card = $('#account-card');
    if (card) { card.innerHTML = accountCardHTML(); wireAccountCard(document); }
    renderAccountChip();
  }

  function wireAccountCard(root) {
    const save = $('#btn-cloud-save', root);
    if (save) save.addEventListener('click', () => {
      const url = $('#sb-url', root).value.trim();
      const key = $('#sb-key', root).value.trim();
      if (!/^https:\/\/.+\.supabase\.co/.test(url)) { alert('La Project URL debería verse como https://xxxx.supabase.co'); return; }
      if (key.length < 20) { alert('La anon key parece incompleta.'); return; }
      Cloud.saveConfig(url, key);
      Cloud.init(onAuthChanged).then(() => { refreshAccountCard(); authDialog(); });
    });
    const config = $('#btn-cloud-config', root);
    if (config) config.addEventListener('click', () => { Cloud.clearConfig(); refreshAccountCard(); });
    const login = $('#btn-cloud-login', root);
    if (login) login.addEventListener('click', authDialog);
    const out = $('#btn-cloud-signout', root);
    if (out) out.addEventListener('click', async () => {
      // Sube lo pendiente ANTES de cerrar sesión (una vez deslogueado,
      // Cloud.push ya no tiene usuario y no podría subir nada).
      try { await Cloud.push(S()); } catch (e) { console.error(e); }
      await Cloud.signOut();
      // Si no se borrara lo local acá, quien abra la app después en este
      // mismo navegador (por ejemplo tu pareja con su propia cuenta) vería
      // — o peor, terminaría subiendo a su cuenta — los datos de la sesión
      // anterior. Store.reset() ya no dispara sincronización porque para
      // este momento Cloud.user() es null.
      Store.reset();
      onAuthChanged();
    });
    const linkGoogle = $('#btn-cloud-link-google', root);
    if (linkGoogle) linkGoogle.addEventListener('click', async () => {
      try {
        await Cloud.linkGoogle();
        refreshAccountCard();
      } catch (e) { alert('No se pudo vincular: ' + friendlyCloudError(e)); }
    });
    const pull = $('#btn-cloud-pull', root);
    if (pull) pull.addEventListener('click', async () => {
      try {
        const remote = await Cloud.pull();
        if (remote && remote.data && Array.isArray(remote.data.transactions)) {
          Store.applyRemote(remote.data);
          render();
        } else alert('Todavía no hay datos en la nube.');
      } catch (e) { alert('No se pudo traer: ' + e.message); }
    });
  }

  function authDialog() {
    const dlg = $('#dialog');
    dlg.className = 'dialog dialog-auth';
    const draft = { mode: 'in', user: '', pass: '' };

    function paint() {
      dlg.innerHTML = `
        <div class="auth-hero">
          <img class="mark" src="assets/logo.png" alt="" aria-hidden="true">
          <h2>${draft.mode === 'in' ? 'Ingresá a tu cuenta' : 'Creá tu cuenta'}</h2>
          <p>Con Google o con usuario y contraseña: guardá tus datos y sincronizalos entre tus dispositivos.</p>
        </div>
        <div class="auth-tabs">
          <button type="button" class="auth-tab ${draft.mode === 'in' ? 'active' : ''}" data-amode="in">Ingresar</button>
          <button type="button" class="auth-tab ${draft.mode === 'up' ? 'active' : ''}" data-amode="up">Crear cuenta</button>
        </div>
        <div class="auth-body">
          <button type="button" class="btn btn-google" id="au-google">${GOOGLE_G_SVG}Continuar con Google</button>
          <div class="auth-divider"><span>o con usuario</span></div>
          <input type="text" id="au-user" autocomplete="username" placeholder="Usuario, no tu email (por ej. jose)" value="${esc(draft.user)}">
          ${draft.mode === 'up' ? '<span class="hint">Elegí un nombre corto, no hace falta que sea tu email.</span>' : ''}
          <input type="password" id="au-pass" autocomplete="${draft.mode === 'in' ? 'current-password' : 'new-password'}"
                 placeholder="Contraseña (mínimo 6 caracteres)" value="${esc(draft.pass)}">
          <div class="auth-msg" id="au-msg"></div>
          <button type="button" class="btn btn-primary auth-submit" id="au-submit">${draft.mode === 'in' ? 'Ingresar' : 'Crear cuenta'}</button>
          <button type="button" class="link-btn" data-close style="justify-self:center">Continuar sin cuenta</button>
        </div>`;
      wire();
    }

    function readInputs() {
      draft.user = $('#au-user', dlg).value.trim();
      draft.pass = $('#au-pass', dlg).value;
    }

    function wire() {
      $('[data-close]', dlg).addEventListener('click', () => dlg.close());
      $$('.auth-tab', dlg).forEach((b) => b.addEventListener('click', () => {
        readInputs();
        draft.mode = b.dataset.amode;
        paint();
      }));
      const submit = () => { readInputs(); doAuth(draft.mode, draft.user, draft.pass, dlg); };
      $('#au-submit', dlg).addEventListener('click', submit);
      $('#au-pass', dlg).addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      const google = $('#au-google', dlg);
      if (google) google.addEventListener('click', doGoogleAuth);
    }

    paint();
    openModal(dlg);
  }

  async function doAuth(mode, username, password, dlg) {
    if (cloudBusy) return;
    const email = usernameToEmail(username);
    if (!email || password.length < 6) {
      $('#au-msg', dlg).textContent = 'Completá un usuario y una contraseña de 6 caracteres o más.';
      return;
    }
    cloudBusy = true;
    const msg = $('#au-msg', dlg);
    msg.textContent = mode === 'up' ? 'Creando cuenta…' : 'Ingresando…';
    try {
      if (mode === 'up') {
        await Cloud.signUp(email, password);
        if (!Cloud.user()) {
          msg.textContent = 'No se pudo crear la sesión automáticamente. En el proyecto de Supabase, ' +
            'desactivá "Confirm email" (Authentication → Sign In / Providers → Email) y volvé a intentar.';
          cloudBusy = false;
          return;
        }
      } else {
        await Cloud.signIn(email, password);
      }
      dlg.close();
      await onAuthChanged();
    } catch (e) {
      const raw = e.message || String(e);
      msg.textContent = /already registered|already exists/i.test(raw)
        ? 'Ese usuario ya existe. Probá con "Ingresar" en vez de "Crear cuenta".'
        : /invalid login/i.test(raw)
        ? 'Usuario o contraseña incorrectos.'
        : 'No se pudo: ' + raw;
    }
    cloudBusy = false;
  }

  // Inicia sesión con Google: el navegador redirige a Google y vuelve a esta
  // misma URL, donde Supabase retoma la sesión sola (ver Cloud.init). No usa
  // cloudBusy: si por algo la redirección no llega a pasar, no queremos que
  // el formulario de usuario/contraseña quede trabado para siempre.
  async function doGoogleAuth() {
    try {
      await Cloud.signInWithGoogle();
    } catch (e) {
      alert('No se pudo iniciar sesión con Google: ' + friendlyCloudError(e));
    }
  }

  // Supabase dispara onAuthStateChange no solo en login/logout sino también
  // en cada TOKEN_REFRESHED periódico (autoRefreshToken: true). Antes,
  // onAuthChanged() vaciaba shared.* en cada llamada sin distinguir el
  // motivo, así que un simple refresh de token borraba de la vista el
  // hogar/gastos compartidos hasta que loadShared() terminara de volver a
  // traerlos — y si esa recarga se demoraba o fallaba, parecía que el
  // historial se había "borrado". Ahora solo se invalida cuando realmente
  // cambió la cuenta (login/logout/otra persona).
  let lastAuthUserId; // undefined = todavía no se llamó ni una vez
  // Al cambiar el estado de sesión: traer datos remotos o subir los locales.
  async function onAuthChanged() {
    renderAccountChip();
    const uid = Cloud.user() ? Cloud.user().id : null;
    if (lastAuthUserId !== undefined && uid !== lastAuthUserId) {
      // Cambió de cuenta (login/logout/otra cuenta): invalida la caché de
      // "Compartido" para no arrastrar el hogar de una cuenta anterior.
      shared.loaded = false;
      shared.household = null;
      shared.expenses = [];
      shared.settlements = [];
    }
    lastAuthUserId = uid;
    if (Cloud.user()) {
      try {
        const remote = await Cloud.pull();
        if (remote && remote.data && Array.isArray(remote.data.transactions)) {
          const localTs = S()._updatedAt || 0;
          const remoteTs = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
          const localEmpty = !S().transactions.length;
          // Si lo local tiene movimientos y la nube trae menos, no la
          // dejamos mandar aunque su timestamp sea "más nuevo": eso pasa
          // cuando otro dispositivo viejo/inactivo queda con menos datos
          // pero de todos modos sincroniza (ver Store.saveLocal). Preferimos
          // no perder datos en vez de confiar ciegamente en el reloj.
          const remoteLooksStale = !localEmpty && remote.data.transactions.length < S().transactions.length;
          // La nube manda salvo que lo local sea más nuevo y la nube esté vacía de cambios.
          if (localEmpty || (remoteTs >= localTs && !remoteLooksStale)) {
            Store.applyRemote(remote.data);
          } else {
            await Cloud.push(S());
          }
        } else {
          await Cloud.push(S()); // primera vez: sembrar la nube con lo local
        }
      } catch (e) {
        console.error(e);
      }
      loadShared(); // en segundo plano, para que "+ Movimiento" ya sepa si hay hogar compartido
    }
    render();
  }

  async function initCloud() {
    if (!Cloud.available() || !Cloud.isConfigured()) { renderAccountChip(); return; }
    try {
      await Cloud.init(onAuthChanged);
      await onAuthChanged();
      // Lo primero que se ve al abrir la app (si no hay sesión): invitar a
      // iniciar sesión o crear cuenta, con Google o usuario/contraseña. El
      // diálogo tiene su propio botón para seguir sin cuenta, así que no
      // bloquea el uso offline.
      if (!Cloud.user()) authDialog();
    } catch (e) {
      console.error('Init nube', e);
      renderAccountChip();
    }
  }

  // Cuando falta correr (o falta actualizar) supabase-schema.sql en el
  // proyecto, Postgres rechaza el insert con este mensaje — lo detectamos
  // para dar una pista accionable en vez de mostrar el error crudo.
  function friendlyCloudError(e) {
    const raw = (e && (e.message || String(e))) || 'Error desconocido.';
    if (/row-level security/i.test(raw)) {
      return raw + '\n\nProbablemente falta correr (o está desactualizado) el script supabase-schema.sql ' +
        'en tu proyecto de Supabase: Supabase → SQL Editor → pegá todo el contenido de ese archivo → Run. ' +
        'Es seguro volver a correrlo, no borra datos existentes.';
    }
    return raw;
  }

  /* ================= Vista: Compartido (gastos en pareja) ================= */
  // Caché en memoria: esta vista vive en Supabase, no en Store (la usan dos
  // cuentas distintas a la vez), así que se carga aparte de forma asíncrona.
  const shared = { loaded: false, loading: false, household: null, expenses: [], settlements: [] };

  function sharedMe() { return Cloud.user(); }
  function sharedPartner() {
    if (!shared.household) return null;
    const me = sharedMe();
    return shared.household.members.find((m) => m.user_id !== me.id) || null;
  }

  async function loadShared() {
    if (shared.loading) return;
    shared.loading = true;
    try {
      shared.household = await Cloud.getHousehold();
      if (shared.household) {
        [shared.expenses, shared.settlements] = await Promise.all([
          Cloud.listSharedExpenses(shared.household.id),
          Cloud.listSettlements(shared.household.id),
        ]);
      } else {
        shared.expenses = [];
        shared.settlements = [];
      }
    } catch (e) {
      console.error('Error al cargar gastos compartidos', e);
    }
    shared.loaded = true;
    shared.loading = false;
    // No solo la pestaña "Compartido" muestra datos de shared.* -- el
    // mini resumen de Resumen también depende de esto, y antes se quedaba
    // sin aparecer nunca si en ese momento no estabas en "Compartido".
    render();
  }

  function sharedBalance() {
    const me = sharedMe();
    const partner = sharedPartner();
    if (!me || !partner) return 0;
    let bal = 0;
    for (const e of shared.expenses) {
      const amt = convOrNull(Number(e.amount), e.currency);
      if (amt == null) continue;
      const owedToPayer = amt * (1 - Number(e.payer_share));
      bal += (e.paid_by === me.id) ? owedToPayer : -owedToPayer;
    }
    for (const s of shared.settlements) {
      const amt = convOrNull(Number(s.amount), s.currency);
      if (amt == null) continue;
      if (s.from_user === partner.user_id && s.to_user === me.id) bal -= amt;
      if (s.from_user === me.id && s.to_user === partner.user_id) bal += amt;
    }
    return bal;
  }

  function partnerLabel(m) {
    return (m && m.email) ? m.email.split('@')[0] : 'tu pareja';
  }

  function createHouseholdForm() {
    const body = `
      <div class="field">
        <label for="h-name">Nombre <span class="hint">(opcional)</span></label>
        <input type="text" name="name" id="h-name" maxlength="40" placeholder="Nuestro hogar">
      </div>
      <span class="hint">Después vas a poder generar un código para invitar a tu pareja.</span>`;
    openDialog('Crear hogar compartido', body, {
      submitLabel: 'Crear',
      async onSubmit(d) {
        try {
          await Cloud.createHousehold(d.name.trim());
          shared.loaded = false;
          await loadShared();
        } catch (e) { alert('No se pudo crear: ' + friendlyCloudError(e)); }
      },
    });
  }

  function joinHouseholdForm() {
    const body = `
      <div class="field">
        <label for="j-code">Código de invitación</label>
        <input type="text" name="code" id="j-code" required maxlength="10" style="text-transform:uppercase" placeholder="ABC1234">
      </div>
      <div class="hint" id="j-msg"></div>`;
    const dlg = openDialog('Unirme a un hogar', body, {
      submitLabel: 'Unirme',
      onSubmit(d) {
        Cloud.redeemInvite(d.code).then(async () => {
          shared.loaded = false;
          await loadShared();
          dlg.close();
        }).catch((e) => { $('#j-msg', dlg).textContent = friendlyCloudError(e); });
        return false;
      },
    });
  }

  function sharedExpenseForm() {
    const partner = sharedPartner();
    const body = `
      <div class="field-row">
        <div class="field">
          <label for="se-amount">Monto</label>
          <input type="number" name="amount" id="se-amount" min="0.01" step="0.01" required inputmode="decimal">
        </div>
        <div class="field">
          <label for="se-currency">Moneda</label>
          <select name="currency" id="se-currency">
            <option value="ARS">ARS — pesos</option>
            <option value="USD">USD — dólares</option>
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="se-date">Fecha</label>
          <input type="date" name="date" id="se-date" value="${todayStr()}" required>
        </div>
        <div class="field">
          <label for="se-who">¿Quién pagó?</label>
          <select name="paidBy" id="se-who">
            <option value="me">Yo</option>
            ${partner ? `<option value="partner">${esc(partnerLabel(partner))}</option>` : ''}
          </select>
        </div>
      </div>
      <div class="field">
        <label for="se-share">El que pagó se queda con este % del gasto</label>
        <input type="number" name="payerPct" id="se-share" min="0" max="100" step="1" value="50" required>
        <span class="hint">50% = se divide por igual. El resto le corresponde al otro.</span>
      </div>
      <div class="field">
        <label for="se-note">Detalle <span class="hint">(opcional)</span></label>
        <input type="text" name="note" id="se-note" maxlength="60" placeholder="Supermercado, alquiler, salida…">
      </div>`;
    openDialog('Nuevo gasto compartido', body, {
      async onSubmit(d) {
        const amount = Math.round(parseFloat(d.amount) * 100) / 100;
        const pct = Math.min(100, Math.max(0, parseFloat(d.payerPct)));
        if (!(amount > 0) || isNaN(pct)) return false;
        const me = sharedMe();
        const paidById = d.paidBy === 'partner' && partner ? partner.user_id : me.id;
        try {
          await Cloud.addSharedExpense({
            household_id: shared.household.id, paid_by: paidById,
            payer_share: pct / 100, amount, currency: d.currency,
            date: d.date, note: d.note.trim() || null,
          });
          shared.expenses = await Cloud.listSharedExpenses(shared.household.id);
          render();
        } catch (e) { alert('No se pudo guardar: ' + friendlyCloudError(e)); return false; }
      },
    });
  }

  function settlementForm() {
    const partner = sharedPartner();
    const me = sharedMe();
    if (!partner) return;
    const body = `
      <div class="field">
        <label for="st-dir">¿Quién le paga a quién?</label>
        <select name="dir" id="st-dir">
          <option value="me-to-partner">Yo le pago a ${esc(partnerLabel(partner))}</option>
          <option value="partner-to-me">${esc(partnerLabel(partner))} me paga a mí</option>
        </select>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="st-amount">Monto</label>
          <input type="number" name="amount" id="st-amount" min="0.01" step="0.01" required inputmode="decimal">
        </div>
        <div class="field">
          <label for="st-currency">Moneda</label>
          <select name="currency" id="st-currency">
            <option value="ARS">ARS — pesos</option>
            <option value="USD">USD — dólares</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label for="st-date">Fecha</label>
        <input type="date" name="date" id="st-date" value="${todayStr()}" required>
      </div>
      <div class="field">
        <label for="st-note">Detalle <span class="hint">(opcional)</span></label>
        <input type="text" name="note" id="st-note" maxlength="60">
      </div>`;
    openDialog('Registrar pago', body, {
      submitLabel: 'Registrar',
      async onSubmit(d) {
        const amount = Math.round(parseFloat(d.amount) * 100) / 100;
        if (!(amount > 0)) return false;
        const fromMe = d.dir === 'me-to-partner';
        try {
          await Cloud.addSettlement({
            household_id: shared.household.id,
            from_user: fromMe ? me.id : partner.user_id,
            to_user: fromMe ? partner.user_id : me.id,
            amount, currency: d.currency, date: d.date, note: d.note.trim() || null,
          });
          shared.settlements = await Cloud.listSettlements(shared.household.id);
          render();
        } catch (e) { alert('No se pudo guardar: ' + friendlyCloudError(e)); return false; }
      },
    });
  }

  function vCompartido(el) {
    if (!Cloud.available() || !Cloud.isConfigured() || !Cloud.user()) {
      el.innerHTML = `<div class="card">
        <h2 class="card-title">Gastos compartidos</h2>
        <div class="empty">
          Esta función es para compartir gastos con tu pareja: necesitás conectar
          la nube e iniciar sesión primero.<br><br>
          <button class="btn btn-primary btn-sm" id="go-settings">Ir a Ajustes</button>
        </div>
      </div>`;
      $('#go-settings', el).addEventListener('click', () => { ui.view = 'ajustes'; render(); });
      return;
    }

    if (!shared.loaded) {
      el.innerHTML = `<div class="card"><div class="empty">Cargando…</div></div>`;
      loadShared();
      return;
    }

    if (!shared.household) {
      el.innerHTML = `<div class="card">
        <h2 class="card-title">Gastos compartidos con tu pareja</h2>
        <div class="hint" style="margin-bottom:14px">
          Creá un hogar y compartile un código a tu pareja para que se una.
          Desde ahí, cada uno carga lo que paga y la app calcula quién le debe
          a quién — sin duplicar categorías ni movimientos de la cuenta de cada uno.
        </div>
        <div class="inline-form">
          <button class="btn btn-primary btn-sm" id="btn-create-house">Crear hogar</button>
          <button class="btn btn-sm" id="btn-join-house">Ya tengo un código</button>
        </div>
      </div>`;
      $('#btn-create-house', el).addEventListener('click', createHouseholdForm);
      $('#btn-join-house', el).addEventListener('click', joinHouseholdForm);
      return;
    }

    const partner = sharedPartner();
    const bal = sharedBalance();
    const balAbs = Math.abs(bal);
    const balTxt = balAbs < 0.01
      ? 'Están a mano'
      : (bal > 0
          ? `${esc(partnerLabel(partner))} te debe ${fmtDisp(balAbs)}`
          : `Le debés a ${esc(partnerLabel(partner))} ${fmtDisp(balAbs)}`);

    // Combina gastos y pagos en una sola lista cronológica.
    const feed = [
      ...shared.expenses.map((e) => ({ kind: 'expense', ...e })),
      ...shared.settlements.map((s) => ({ kind: 'settlement', ...s })),
    ].sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));

    const me = sharedMe();
    const rowHTML = (item) => {
      if (item.kind === 'settlement') {
        const fromMe = item.from_user === me.id;
        const title = fromMe ? `Le pagaste a ${esc(partnerLabel(partner))}` : `${esc(partnerLabel(partner))} te pagó`;
        return `<div class="agenda-item">
          <div class="agenda-icon">✅</div>
          <div class="agenda-body">
            <div class="agenda-name">${title}</div>
            <div class="agenda-sub">${esc(fmtDateShort(item.date))}${item.note ? ' · ' + esc(item.note) : ''}</div>
          </div>
          <div class="agenda-amount">${fmtMoney(item.amount, item.currency)}</div>
          <button class="row-del" data-delset="${esc(item.id)}" aria-label="Eliminar">✕</button>
        </div>`;
      }
      const paidByMe = item.paid_by === me.id;
      const who = paidByMe ? 'Vos' : esc(partnerLabel(partner));
      const pct = Math.round(Number(item.payer_share) * 100);
      return `<div class="agenda-item">
        <div class="agenda-icon">🧾</div>
        <div class="agenda-body">
          <div class="agenda-name">${esc(item.note || 'Gasto compartido')}</div>
          <div class="agenda-sub">${esc(fmtDateShort(item.date))} · Pagó ${who} · reparto ${pct}/${100 - pct}</div>
        </div>
        <div class="agenda-amount">${fmtMoney(item.amount, item.currency)}</div>
        <button class="row-del" data-delexp="${esc(item.id)}" aria-label="Eliminar">✕</button>
      </div>`;
    };

    el.innerHTML = `
      <div class="hero">
        <div class="hero-label">◇ Balance con ${esc(partnerLabel(partner))}</div>
        <div class="hero-value" style="font-size:26px">${balTxt}</div>
        ${!partner ? '<div class="hero-split"><div class="k">Esperando a que tu pareja se una con el código de invitación.</div></div>' : ''}
      </div>

      <div class="toolbar">
        <button class="btn btn-primary btn-sm" id="btn-add-se">+ Gasto compartido</button>
        ${partner ? '<button class="btn btn-sm" id="btn-add-settle">Registrar pago</button>' : ''}
        <div class="spacer"></div>
        <button class="link-btn" id="btn-refresh-shared">↻ Actualizar</button>
        ${!partner ? '<button class="link-btn" id="btn-invite">Generar código para tu pareja</button>' : ''}
        <button class="link-btn" id="btn-leave-house">Salir del hogar</button>
      </div>
      <div id="invite-box"></div>

      <div class="card">
        <h2 class="card-title">Historial</h2>
        <div class="agenda">${feed.length ? feed.map(rowHTML).join('') : '<div class="empty">Todavía no cargaron ningún gasto compartido.</div>'}</div>
      </div>`;

    $('#btn-add-se', el).addEventListener('click', sharedExpenseForm);
    const addSettle = $('#btn-add-settle', el);
    if (addSettle) addSettle.addEventListener('click', settlementForm);
    $('#btn-refresh-shared', el).addEventListener('click', () => {
      shared.loaded = false;
      render();
    });
    const inviteBtn = $('#btn-invite', el);
    if (inviteBtn) inviteBtn.addEventListener('click', async () => {
      try {
        const code = await Cloud.createInvite(shared.household.id);
        $('#invite-box', el).innerHTML = `<div class="card">
          <div class="hint">Compartile este código a tu pareja (vale 7 días). Lo carga en <b>Compartido → Ya tengo un código</b>:</div>
          <div class="tile-value" style="letter-spacing:0.08em;margin-top:6px">${esc(code)}</div>
        </div>`;
      } catch (e) { alert('No se pudo generar el código: ' + friendlyCloudError(e)); }
    });
    $('#btn-leave-house', el).addEventListener('click', async () => {
      if (!confirm('¿Salir de este hogar compartido? Vas a dejar de ver el historial de gastos en común.')) return;
      try {
        await Cloud.leaveHousehold(shared.household.id);
        shared.loaded = false;
        await loadShared();
      } catch (e) { alert('No se pudo salir: ' + friendlyCloudError(e)); }
    });
    $$('[data-delexp]', el).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este gasto compartido?')) return;
      await Cloud.deleteSharedExpense(b.dataset.delexp);
      shared.expenses = await Cloud.listSharedExpenses(shared.household.id);
      render();
    }));
    $$('[data-delset]', el).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este pago?')) return;
      await Cloud.deleteSettlement(b.dataset.delset);
      shared.settlements = await Cloud.listSettlements(shared.household.id);
      render();
    }));
  }

  /* ================= Router / render ================= */
  const VIEWS = {
    resumen: vResumen,
    movimientos: vMovimientos,
    calendario: vCalendario,
    categorias: vCategorias,
    compartido: vCompartido,
    tarjetas: vTarjetas,
    ahorros: vAhorros,
    plan: vPlan,
    ajustes: vAjustes,
  };

  // Navegación de 4 botones abajo (máximo); cada uno puede contener más de
  // una vista, que se elige con una sub-pestaña dentro de la sección.
  const GROUPS = [
    { key: 'inicio', views: ['resumen'] },
    { key: 'movimientos', views: ['movimientos', 'calendario', 'categorias'] },
    { key: 'cuentas', views: ['tarjetas', 'ahorros'] },
    { key: 'mas', views: ['plan', 'compartido'] },
  ];
  const VIEW_LABELS = {
    resumen: 'Resumen', movimientos: 'Movimientos', calendario: 'Calendario',
    categorias: 'Categorías', tarjetas: 'Tarjetas y medios', ahorros: 'Ahorros',
    plan: 'Planificar', compartido: 'Compartido', ajustes: 'Ajustes',
  };
  // Ajustes ya no vive dentro de ningún grupo de la nav inferior — se abre
  // directo con el botón del encabezado, así que groupOf() puede no
  // encontrar nada para esa vista (y para ninguna otra que se agregue suelta).
  function groupOf(view) { return GROUPS.find((g) => g.views.includes(view)) || null; }

  function render() {
    const grp = groupOf(ui.view);
    $$('.bottom-nav button').forEach((b) => b.classList.toggle('active', !!grp && b.dataset.group === grp.key));
    $$('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.cur === disp()));
    const thumb = $('.seg-thumb');
    if (thumb) thumb.classList.toggle('pos-usd', disp() === 'USD');
    renderRateChip();
    renderAccountChip();
    renderBanner();
    // Dentro de Ajustes el engranaje pasa a ser un ícono de "volver a
    // Inicio" (antes no había forma de salir de Ajustes salvo la nav de
    // abajo, que ni siquiera queda resaltada ahí).
    const settingsBtn = $('#btn-open-settings');
    if (settingsBtn) {
      settingsBtn.innerHTML = ui.view === 'ajustes' ? iconSvg('home') : SETTINGS_GEAR_SVG;
      settingsBtn.setAttribute('aria-label', ui.view === 'ajustes' ? 'Volver a Inicio' : 'Ajustes');
    }
    const el = $('#view');
    el.innerHTML = (grp && grp.views.length > 1)
      ? `<div class="subtabs">${grp.views.map((v) => `<button type="button" data-subview="${v}" class="${v === ui.view ? 'active' : ''}">${esc(VIEW_LABELS[v])}</button>`).join('')}</div><div class="view-content"></div>`
      : '<div class="view-content"></div>';
    $$('[data-subview]', el).forEach((b) => b.addEventListener('click', () => {
      ui.view = b.dataset.subview;
      // Se refresca en segundo plano sin borrar lo ya cargado (ver
      // comentario en init()): así no aparece "Cargando…" cada vez.
      if (ui.view === 'compartido') loadShared();
      render();
    }));
    VIEWS[ui.view]($('.view-content', el));
  }

  function init() {
    generateRecurring();

    $$('.bottom-nav button').forEach((b) => b.addEventListener('click', () => {
      const grp = GROUPS.find((g) => g.key === b.dataset.group);
      if (!grp.views.includes(ui.view)) ui.view = grp.views[0];
      // "Compartido" vive en la nube y lo puede cambiar la otra persona en
      // cualquier momento, así que se refresca al entrar — pero en segundo
      // plano, sin borrar lo que ya se había mostrado (loadShared() re-
      // renderiza solo cuando termina), para no mostrar "Cargando…" cada
      // vez que volvés a la pestaña.
      if (ui.view === 'compartido') loadShared();
      render();
    }));
    $$('.seg-btn').forEach((b) => b.addEventListener('click', () => {
      S().settings.displayCurrency = b.dataset.cur;
      Store.save();
      render();
    }));
    $('#btn-open-settings').addEventListener('click', () => {
      ui.view = ui.view === 'ajustes' ? 'resumen' : 'ajustes';
      render();
    });
    // Restaura el scroll de la página al cerrar el diálogo, sin importar
    // cómo se cerró (botón, Escape, o dlg.close() desde código): ver openModal().
    $('#dialog').addEventListener('close', () => { document.body.style.overflow = ''; });

    // Cada guardado local se sube a la nube (si hay sesión activa).
    Store.onSave((state) => Cloud.schedulePush(state));

    render();
    initCloud();

    // Actualiza cotización si nunca se trajo o si tiene más de 6 horas
    const s = S().settings;
    const stale = !s.ratesUpdatedAt ||
      (Date.now() - new Date(s.ratesUpdatedAt).getTime()) > 6 * 3600 * 1000;
    if (stale) refreshRates();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
