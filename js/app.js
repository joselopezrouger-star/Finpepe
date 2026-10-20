'use strict';

/* Finpepe — lógica de la aplicación. */
(() => {
  const S = () => Store.state;

  /* ================= Helpers ================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Comillado CSV (RFC 4180): usado tanto al exportar como al armar la
  // plantilla de importación.
  const csvQuote = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  // Un color (hex o var(--…)) con alfa bajo, para teñir de fondo sin tapar
  // el texto (usado para pintar cada fila de categoría con su propio color).
  const tint = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
  // Vibración cortita al tocar el teclado numérico (feedback táctil). No
  // todos los navegadores exponen navigator.vibrate (iOS Safari no), así
  // que es un no-op silencioso ahí.
  function haptic() {
    if (navigator.vibrate) navigator.vibrate(10);
  }

  const pad = (n) => String(n).padStart(2, '0');
  // Variación porcentual para mostrar (sin signo): con decimal si es menos
  // de 1% — antes se redondeaba a entero y una suba real chica (ej. +0,5%,
  // $17.000 más) aparecía como "=", como si no hubiera cambiado nada.
  // Devuelve null si la variación es prácticamente cero (< 0,05%).
  const fmtVarPct = (pct) => {
    const a = Math.abs(pct);
    if (!(a >= 0.05)) return null;
    return a < 0.95 ? a.toFixed(1).replace('.', ',') : String(Math.round(a));
  };
  // Participación sobre un total: un decimal debajo de 10% ("4,5%"), entero arriba.
  const fmtShare = (pct) => (pct < 9.95 ? pct.toFixed(1).replace('.', ',') : String(Math.round(pct)));
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
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

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
  const monthShortLabel = (mk) => {
    const [y, m] = mk.split('-').map(Number);
    const s = monthShortFmt.format(new Date(y, m - 1, 1)).replace('.', '');
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
  // Ocultar montos (botón del ojo, al lado del selector de moneda): todos
  // los importes de la app pasan por fmtMoney/heroMoneyHTML/Charts.compact,
  // así que alcanza con enmascararlos acá; los % no se tocan. Se guarda
  // por dispositivo (no viaja a la nube): es para no mostrar los números
  // en una pantalla puntual.
  const HIDE_KEY = 'finpepe:hideAmounts';
  let hideAmounts = false;
  try { hideAmounts = localStorage.getItem(HIDE_KEY) === '1'; } catch (e) { /* sin storage */ }
  const MASK = '•••••';
  const fmtMoney = (n, cur) => (hideAmounts
    ? `${cur === 'USD' ? 'US$' : '$'} ${MASK}`
    : (cur === 'USD' ? nfUSD : nfARS).format(n));
  const nfHero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
  // Monto sin ocultar, para las pantallas del rediseño: ahí el ojo no
  // reemplaza el número por puntos sino que lo desenfoca (.money dentro de
  // body.hide-amounts), así no cambia el ancho ni se mueve nada.
  const fmtPlain = (n, cur) => ((cur || disp()) === 'USD' ? nfUSD : nfARS).format(n);
  const money = (n, cur) => `<span class="money">${esc(fmtPlain(n, cur))}</span>`;

  /* Puntos de miles en vivo para inputs de monto sueltos (presupuesto,
     movimiento fijo) — la calculadora de "+ Movimiento" ya los mostraba a
     medida que se tipeaba, pero estos son <input> nativos aparte, sin ese
     formateo. Punto para miles, coma para decimales (igual que la
     calculadora). formatAmountDisplay() arma el valor inicial al abrir el
     formulario; wireAmountInput() reformatea en cada tecla; parseAmountInput()
     deshace el formato para guardar el número real. */
  function formatAmountDisplay(n) {
    if (n === '' || n == null || !isFinite(n)) return '';
    const s = (Math.round(Number(n) * 100) / 100).toString();
    const neg = s.startsWith('-');
    const [intRaw, decPart] = (neg ? s.slice(1) : s).split('.');
    const grouped = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + grouped + (decPart ? ',' + decPart : '');
  }
  function parseAmountInput(raw) {
    if (!raw) return NaN;
    return parseFloat(raw.replace(/\./g, '').replace(',', '.'));
  }
  function wireAmountInput(input) {
    if (!input) return;
    input.addEventListener('input', () => {
      const fromEnd = input.value.length - input.selectionStart;
      const neg = input.value.trim().startsWith('-');
      const dot = input.value.indexOf(',');
      const intRaw = (dot === -1 ? input.value : input.value.slice(0, dot)).replace(/\D/g, '');
      const decPart = dot === -1 ? null : input.value.slice(dot + 1).replace(/\D/g, '').slice(0, 2);
      const grouped = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      input.value = (neg ? '-' : '') + grouped + (decPart !== null ? ',' + decPart : '');
      const pos = Math.max(0, input.value.length - fromEnd);
      input.setSelectionRange(pos, pos);
    });
  }

  const disp = () => S().settings.displayCurrency;
  const rate = () => FX.currentRate(S());
  const toDisp = (amount, cur) => FX.convert(amount, cur, disp(), rate() ? rate().value : null);
  const fmtDisp = (n) => (n == null || !isFinite(n)) ? '—' : fmtMoney(n, disp());
  const convOrNull = (amount, cur) => toDisp(amount, cur);

  /* Monto de un movimiento guardado, en la moneda de visualización.
     Todo gasto/ingreso guarda el equivalente en la OTRA moneda al momento de
     cargarlo, con la cotización de ese día: "usdSnapshot" para uno en ARS,
     "arsSnapshot" para uno en USD (ver usdSnapshotForDate/arsSnapshotForDate
     más arriba). Sin esto, un movimiento en USD mostrado en ARS se convertía
     siempre con la cotización DE HOY sin importar su fecha — lo que además
     de mostrar un monto histórico incorrecto, hacía que la variación % de
     ese gasto contra el mes anterior diera idéntica en ARS y en USD (un
     mismo factor de conversión para los dos meses se cancela en la cuenta
     de la variación), tapando la inflación/devaluación real entre medio.
     Si no hay snapshot (movimientos viejos, sin cotización disponible en su
     momento), se convierte con la cotización actual como respaldo. */
  // Misma lógica que txDispAmount(), pero para una moneda destino puntual en
  // vez de la moneda de visualización actual — la usa también exportCSV()
  // para poder mostrar el equivalente en ARS Y en USD de cada movimiento a
  // la vez, sin depender de cuál esté elegida en el selector de arriba.
  function amountInCurrency(t, target) {
    if (t.currency === target) return t.amount;
    if (target === 'USD' && t.currency === 'ARS' && t.usdSnapshot != null) return t.usdSnapshot;
    if (target === 'ARS' && t.currency === 'USD' && t.arsSnapshot != null) return t.arsSnapshot;
    const r = rate();
    return r ? Math.round(FX.convert(t.amount, t.currency, target, r.value) * 100) / 100 : null;
  }
  function txDispAmount(t) {
    return amountInCurrency(t, disp());
  }

  /* Mismo mecanismo que amountInCurrency(), pero para un aporte/retiro de
     un ahorro (savingEntryForm) — la entrada no tiene su propio campo
     "currency" (la hereda de la cuenta), así que se arma un objeto liviano
     con la forma que amountInCurrency() espera. */
  function savingEntryAmountIn(saving, entry, target) {
    return amountInCurrency(
      { currency: saving.currency, amount: entry.amount, usdSnapshot: entry.usdSnapshot, arsSnapshot: entry.arsSnapshot },
      target);
  }

  /* Retiro automático de un ahorro cuando un gasto se paga "con un ahorro"
     (ver canPayFromSavings() en txForm): arma la entrada negativa que va a
     saving.entries, reutilizando el usdSnapshot/arsSnapshot que el propio
     gasto ya resolvió (a la cotización DE SU FECHA) en vez de pedir la
     cotización de nuevo — así no hace falta otro round-trip de red y el
     monto en la moneda del ahorro queda consistente con el del gasto. */
  function withdrawalEntryForTx(tx, saving) {
    const amt = amountInCurrency(tx, saving.currency);
    if (amt == null) return null;
    const other = saving.currency === 'ARS' ? 'USD' : 'ARS';
    const otherAmt = amountInCurrency(tx, other);
    const entry = {
      id: Store.uid(), date: tx.date, amount: -Math.round(amt * 100) / 100,
      note: tx.note || catName(tx.categoryId), linkedTxId: tx.id,
    };
    if (other === 'USD') entry.usdSnapshot = otherAmt != null ? -otherAmt : null;
    else entry.arsSnapshot = otherAmt != null ? -otherAmt : null;
    return entry;
  }

  // Saca, de cualquier ahorro, la entrada de retiro vinculada a un gasto
  // puntual — se usa antes de recrearla (el gasto se editó) y al borrar el
  // gasto, para que el saldo del ahorro no quede mal por un retiro
  // "huérfano" que ya no corresponde a ningún movimiento real.
  function removeLinkedSavingEntry(txId) {
    for (const s of S().savings) {
      const before = s.entries.length;
      s.entries = s.entries.filter((e) => e.linkedTxId !== txId);
      if (s.entries.length !== before) return;
    }
  }

  // Después de guardar/editar un gasto, deja el retiro vinculado en el
  // ahorro correspondiente al día: lo saca si ya no corresponde (se borró
  // el vínculo o cambió de medio de pago) y lo vuelve a crear con los
  // datos finales si el medio elegido sigue siendo un ahorro.
  function syncSavingWithdrawalForTx(tx) {
    removeLinkedSavingEntry(tx.id);
    if (tx.type !== 'gasto') return;
    const saving = savingById(tx.methodId);
    if (!saving) return;
    const entry = withdrawalEntryForTx(tx, saving);
    if (entry) saving.entries.push(entry);
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

  /* Mismo mecanismo que usdSnapshotFor/usdSnapshotForDate, pero para el
     sentido inverso: el equivalente en ARS de un movimiento cargado en
     dólares, con la cotización DEL DÍA — para poder mostrar el tipo de
     cambio de ese momento en el detalle de un gasto en USD. */
  function arsSnapshotFor(amount, currency) {
    if (currency !== 'USD') return null;
    const r = rate();
    return r ? Math.round(FX.convert(amount, 'USD', 'ARS', r.value) * 100) / 100 : null;
  }
  async function arsSnapshotForDate(amount, currency, dateStr) {
    if (currency !== 'USD') return null;
    const s = S().settings;
    if (typeof s.manualRate === 'number' && s.manualRate > 0) return arsSnapshotFor(amount, currency);
    if (dateStr > todayStr()) return arsSnapshotFor(amount, currency);
    const hist = await FX.fetchHistoricalRate(s.fxSource, dateStr);
    if (hist && hist.venta > 0) return Math.round(FX.convert(amount, 'USD', 'ARS', hist.venta) * 100) / 100;
    return arsSnapshotFor(amount, currency);
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
  // Un ahorro también se puede elegir como "de dónde salió la plata" para un
  // gasto (ver canPayFromSavings()/onSave) — methodId puede entonces ser el
  // id de un ahorro en vez de uno de S().methods. Se resuelve acá, en un
  // solo lugar, así el resto de la app (CSV, detalle de movimiento,
  // Movimientos) no necesita saber la diferencia.
  const savingById = (id) => S().savings.find((s) => s.id === id);
  const isSavingMethod = (id) => !!(id && savingById(id));
  const methodById = (id) => {
    const m = S().methods.find((m) => m.id === id);
    if (m) return m;
    const s = savingById(id);
    return s ? { id: s.id, name: s.name, kind: 'ahorro' } : undefined;
  };
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

  /* Un presupuesto puede ser de un grupo entero (ej. "Casa", suma todas sus
     subcategorías) o de una subcategoría puntual (ej. solo "Supermercado")
     — según de qué nivel sea la categoría del presupuesto, el gasto se
     compara distinto: contra el grupo de más arriba del movimiento, o
     contra su categoría exacta. */
  function txMatchesBudgetCategory(t, categoryId) {
    const cat = catById(categoryId);
    if (!cat) return false;
    return cat.parentId ? t.categoryId === categoryId : topCategoryOf(t.categoryId) === categoryId;
  }

  const KIND_LABEL = {
    efectivo: 'Efectivo', debito: 'Débito', caja_ahorro: 'Caja de ahorro', credito: 'Crédito', billetera: 'Billetera virtual',
    ahorro: 'Ahorro',
  };
  // Un color por tipo de medio, para diferenciar las tarjetas de un vistazo
  // en "Tarjetas y medios" (fondo tenue + borde), tomados de la misma
  // paleta que las categorías.
  const KIND_COLOR = {
    efectivo: 'var(--c-super)', debito: 'var(--c-casa)', caja_ahorro: 'var(--brand)', credito: 'var(--c-auto)', billetera: 'var(--c-tel)',
    ahorro: 'var(--c-comida)',
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
    expand: '<path d="M7 3H3v4M13 3h4v4M3 13v4h4M17 13v4h-4"/>',
    arrowDown: '<path d="M10 4v12M5 11l5 5 5-5"/>',
    arrowUp: '<path d="M10 16V4M5 9l5-5 5 5"/>',
    trash: '<path d="M4 6h12"/><path d="M8 6V4h4v2"/><path d="M5.5 6l.8 10.2a1 1 0 0 0 1 .8h5.4a1 1 0 0 0 1-.8L14.5 6"/>',
    minus: '<path d="M5 10h10"/>',
    chevLeft: '<path d="M12 4.5 6.5 10l5.5 5.5"/>',
    chevRight: '<path d="M8 4.5 13.5 10 8 15.5"/>',
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
  // Íconos del sprite de index.html (docs/rediseno/iconos.svg).
  const spriteIcon = (id) => `<svg class="ic" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  // Tendencia de la tasa de ahorro (media tarjeta del Resumen): curva suave
  // con marcador en cada mes y relleno en degradé debajo. Sin eje numérico:
  // los valores los dan las etiquetas. rows: [{label, rate}] (rate en %,
  // puede ser negativo).
  function savingsRateTrendSvg(rows) {
    if (!rows.length) return '';
    const W = 300, H = 165;
    const topPad = 38, bottomPad = 26, padX = 24;
    const plotTop = topPad, plotBottom = H - bottomPad;
    const plotH = plotBottom - plotTop;
    const plotW = W - padX * 2;
    const x = (i) => rows.length > 1 ? padX + (plotW * i) / (rows.length - 1) : W / 2;

    const rates = rows.map((r) => r.rate);
    const domainMax = Math.max(...rates);
    const domainMin = Math.min(...rates);
    const span = Math.max(domainMax - domainMin, 1);
    const scaledMax = domainMax + span * 0.15, scaledMin = domainMin - span * 0.25;
    const y = (v) => plotTop + (scaledMax - v) / (scaledMax - scaledMin) * plotH;

    // Verde si el mes en curso quedó ahorrando; si fue un retiro neto
    // (negativo), toda la curva pasa a la paleta de alerta.
    const bad = rates[rates.length - 1] < 0;
    const lineColor = bad ? 'var(--crit)' : 'var(--income)';
    const gradId = 'savRateGrad' + Math.round(Math.random() * 1e6);

    const pts = rows.map((r, i) => ({ x: x(i), y: y(r.rate), rate: r.rate, label: r.label }));
    const linePath = Charts.smoothPathD(pts);
    const areaPath = `${linePath} L${pts[pts.length - 1].x},${plotBottom} L${pts[0].x},${plotBottom} Z`;

    const gridLines = pts.map((p) => `<line x1="${p.x}" y1="${p.y}" x2="${p.x}" y2="${plotBottom}"
      stroke="var(--border)" stroke-width="1.5" stroke-dasharray="3 4"/>`).join('');
    const dots = pts.map((p, i) => {
      const isLast = i === pts.length - 1;
      return `<circle cx="${p.x}" cy="${p.y}" r="${isLast ? 7.5 : 5.5}" fill="${isLast ? lineColor : 'var(--surface)'}" stroke="${lineColor}" stroke-width="3.5"/>`;
    }).join('');

    const svg = `<svg viewBox="0 0 ${W} ${H}" class="trend-svg" role="img" aria-label="Evolución de la tasa de ahorro">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="${lineColor}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <line x1="${padX - 10}" y1="${plotBottom}" x2="${W - padX + 10}" y2="${plotBottom}" stroke="var(--axis)" stroke-width="1.5"/>
      ${gridLines}
      <path d="${areaPath}" fill="url(#${gradId})" stroke="none"/>
      <path d="${linePath}" fill="none" stroke="${lineColor}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}
    </svg>`;

    // Etiquetas como HTML encima del SVG (en % del contenedor) para que el
    // tamaño de letra no se achique junto con el dibujo. El mes actual va
    // en una píldora de color; los demás, como texto chico sin fondo (en
    // una media tarjeta las píldoras de todos se pisaban entre sí). Con
    // más de 4 meses no entran todos: quedan el primero y el actual.
    const pctX = (px) => (px / W) * 100;
    const pctY = (py) => (py / H) * 100;
    const showLabel = (i) => rows.length <= 4 || i === 0 || i === pts.length - 1;
    const labelsHTML = pts.map((p, i) => {
      if (!showLabel(i)) return '';
      const isLast = i === pts.length - 1;
      const pos = `left:${pctX(p.x)}%;top:${pctY(p.y)}%`;
      return isLast
        ? `<span class="savings-rate-bubble current" style="${pos};background:${lineColor}">${p.rate}%</span>`
        : `<span class="savings-rate-bubble" style="${pos}">${p.rate}%</span>`;
    }).join('');
    const monthLabelsHTML = pts.map((p) => `<span class="savings-rate-xlabel" style="left:${pctX(p.x)}%;top:${pctY(plotBottom + 6)}%">${esc(p.label)}</span>`).join('');

    return `<div class="savings-rate-chart-inner">${svg}${labelsHTML}${monthLabelsHTML}</div>`;
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
  // Colores de categoría: fijos y guardados en cada grupo (c.color, una
  // clave de los tokens --c-* de tokens.css; ver Store.assignCategoryColors).
  // Las subcategorías usan el de su grupo. Así una categoría tiene el mismo
  // color en todas las pantallas, sin depender de su lugar en el ranking.
  const CAT_COLOR_LABELS = {
    casa: 'Azul', compras: 'Rosa', comida: 'Naranja', auto: 'Violeta', tel: 'Celeste', super: 'Amarillo', otros: 'Gris',
  };
  const OTROS_COLOR = 'var(--c-otros)';
  function catColorKey(catId) {
    const g = catById(topCategoryOf(catId));
    return g && Store.CATEGORY_COLORS.includes(g.color) ? g.color : 'otros';
  }
  const catColor = (catId) => `var(--c-${catColorKey(catId)})`;
  // Para series que no son categorías (cuentas de ahorro): los mismos tonos
  // de los tokens, sin el gris de "Otros".
  const SERIES_PALETTE = ['var(--c-casa)', 'var(--c-tel)', 'var(--c-auto)', 'var(--c-comida)', 'var(--c-compras)', 'var(--c-super)'];
  // Medios de pago: no son categorías, van en grises para no confundirse.
  const NEUTRAL_PALETTE = ['var(--t1)', 'var(--t2)', 'var(--t3)', 'color-mix(in srgb, var(--t3) 55%, var(--bg))', 'var(--s3)'];
  const CAT_ICON = {
    'c-casa': 'home', 'c-comida': 'food', 'c-auto': 'car', 'c-salud': 'heart',
    'c-entret': 'film', 'c-ropa': 'shirt', 'c-educ': 'book', 'c-viajes': 'plane',
    'c-impuestos': 'receipt', 'c-otros-g': 'tag',
    'c-sueldo': 'wallet', 'c-free': 'briefcase', 'c-invers': 'trend', 'c-ventas': 'bag', 'c-otros-i': 'dots',
  };
  const ICON_BY_NAME = [
    [/^(casa|hogar|vivienda|alquiler|expensas)/, 'home'], [/^(comida|super|almacen|resto|delivery)/, 'food'],
    [/^(auto|transporte|nafta|movilidad)/, 'car'], [/^(salud|farmacia|medic|prepaga)/, 'heart'],
    [/^(entret|ocio|salidas|stream)/, 'film'], [/^(ropa|indument)/, 'shirt'], [/^(educ|estudio|curso|facu)/, 'book'],
    [/^(viaje|vacacion|turismo)/, 'plane'], [/^(impuesto|servicio|tarjeta|banco)/, 'receipt'],
    [/^(compras|regalo|shopping)/, 'bag'], [/^(sueldo|salario|honorario)/, 'wallet'], [/^(freelance|trabajo|negocio)/, 'briefcase'],
    [/^(invers|plazo|interes|dividend)/, 'trend'], [/^(venta)/, 'bag'],
  ];
  function categoryIconName(catId) {
    const top = topCategoryOf(catId);
    if (CAT_ICON[top]) return CAT_ICON[top];
    // Categorías creadas por cada uno (otro id): el ícono sale del nombre.
    const g = catById(top);
    const name = g ? normName(g.name) : '';
    const hit = name && ICON_BY_NAME.find(([re]) => re.test(name));
    if (hit) return hit[1];
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
    // Un solo mes compartido por Inicio, Movimientos, Categorías y
    // Calendario: elegir un mes en cualquiera de esas hojas te lo deja
    // elegido en todas — antes cada una tenía su propia variable
    // (month/fMonth/calMonth) y quedaban desincronizadas entre sí.
    month: curMonth(),
    fAllMonths: false,        // true = ignora el mes, trae todos (filtro de Movimientos)
    fType: '', fCat: '', fMethod: '', fSearch: '',
    trendTable: false,
    savChart: 'rate',         // Ahorros: gráfico elegido (rate | nominal | cum)
    calSel: null,             // 'YYYY-MM-DD' día seleccionado en el calendario
    catKind: 'general',       // Categorías: General, Gastos o Ingresos
    catEvoExp: null, catEvoInc: null, // Categorías: categoría elegida en "Evolución"
    catOpen: {},              // Categorías: grupo -> true si sus subcategorías están desplegadas
  };

  /* ================= Ciclo de tarjetas de crédito ================= */
  /* Cada resumen (cierre + vencimiento) se carga a mano desde "Resúmenes",
     con su fecha real — no hay un "día habitual" fijo que se define una
     sola vez al crear la tarjeta. card.overrides guarda cada resumen
     cargado, con clave = su fecha de cierre ('YYYY-MM-DD'; los cargados
     antes de este cambio quedaron con clave 'YYYY-MM', y se siguen leyendo
     igual). Al ser por fecha y no por mes, un mes puede tener dos cierres
     (ej. un banco que cierra el 01/10 y de nuevo el 29/10) — antes el
     segundo pisaba al primero.
     Fechas que no se cargaron:
       - después del último resumen cargado, se proyectan mes a mes con el
         mismo día que ese último (así no hace falta cargar seis meses para
         adelante para que el Gantt de cuotas tenga algo que mostrar);
       - entre el primero y el último cargado, valen sólo los reales (un
         ciclo largo, sin cierre en algún mes, no inventa uno en el medio);
       - antes del primero, el día fijo de compatibilidad de tarjetas
         viejas, si lo tiene. */
  function cardResumes(card) {
    const overrides = card.overrides || {};
    return Object.keys(overrides).map((key) => {
      const ov = overrides[key];
      let close = ov.closeDateStr ? parseDate(ov.closeDateStr) : null;
      if (!close && ov.closingDay != null && /^\d{4}-\d{2}/.test(key)) {
        close = clampDate(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, ov.closingDay);
      }
      if (!close) return null;
      let due = ov.dueDateStr ? parseDate(ov.dueDateStr) : null;
      if (!due && ov.dueDay != null) {
        due = clampDate(close.getFullYear(), close.getMonth(), ov.dueDay);
        if (due <= close) due = clampDate(close.getFullYear(), close.getMonth() + 1, ov.dueDay);
      }
      return { key, close, due, dueAssumed: !ov.dueDateStr };
    }).filter(Boolean).sort((x, y) => x.close - y.close);
  }
  function cardDateCandidates(card, kind, y, m0) {
    const field = kind === 'closingDay' ? 'close' : 'due';
    const mk = monthKeyOf(dateToStr(new Date(y, m0, 1)));
    const dates = cardResumes(card).map((r) => r[field]).filter(Boolean).sort((a, b) => a - b);
    const inMonth = dates.filter((d) => monthKeyOf(dateToStr(d)) === mk);
    if (inMonth.length) return inMonth;
    if (dates.length) {
      const last = dates[dates.length - 1];
      if (mk > monthKeyOf(dateToStr(last))) return [clampDate(y, m0, last.getDate())];
      if (mk >= monthKeyOf(dateToStr(dates[0]))) return [];
    }
    return card[kind] != null ? [clampDate(y, m0, card[kind])] : [];
  }
  /* Próxima fecha de 'kind' a partir de 'from' (inclusive, o estrictamente
     posterior si strict=true), mes por mes hacia adelante (alcanza para un
     ciclo largo sin cierre en algún mes). */
  function nextCardDate(card, kind, from, strict) {
    for (let dm = 0; dm < 4; dm++) {
      const d = new Date(from.getFullYear(), from.getMonth() + dm, 1);
      for (const c of cardDateCandidates(card, kind, d.getFullYear(), d.getMonth())) {
        if (strict ? c > from : c >= from) return c;
      }
    }
    return null;
  }
  /* Misma idea que nextCardDate pero hacia atrás: la fecha de 'kind' más
     reciente estrictamente ANTERIOR a 'before'. */
  function prevCardDate(card, kind, before) {
    for (let dm = 0; dm < 4; dm++) {
      const d = new Date(before.getFullYear(), before.getMonth() - dm, 1);
      const cands = cardDateCandidates(card, kind, d.getFullYear(), d.getMonth());
      for (let i = cands.length - 1; i >= 0; i--) {
        if (cands[i] < before) return cands[i];
      }
    }
    return null;
  }
  // Devuelve null si la tarjeta todavía no tiene ningún resumen cargado
  // (ni uno propio ni el día fijo de compatibilidad de tarjetas viejas):
  // no hay nada de qué partir para calcular un ciclo.
  function cardCycle(card) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const close = nextCardDate(card, 'closingDay', now, false);
    if (!close) return null;
    const prevClose = prevCardDate(card, 'closingDay', close);
    const prevPrevClose = prevClose ? prevCardDate(card, 'closingDay', prevClose) : null;
    const dueAfter = (c) => c ? nextCardDate(card, 'dueDay', c, true) : null;
    return { close, prevClose, prevPrevClose, due: dueAfter(close), prevDue: dueAfter(prevClose) };
  }

  /* Próximos N resúmenes (cierre + vencimiento), arrancando por el ciclo
     actual, respetando los resúmenes puntuales que ya estén cargados. */
  function cardUpcomingCycles(card, n) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    let close = nextCardDate(card, 'closingDay', now, false);
    const out = [];
    for (let i = 0; i < n && close; i++) {
      const due = nextCardDate(card, 'dueDay', close, true);
      out.push({ close, due });
      close = nextCardDate(card, 'closingDay', close, true);
    }
    return out;
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  /* Línea de tiempo del ciclo: último cierre → su vencimiento → próximo
     cierre, con los puntos y el tramo recorrido pintados. Si todavía no
     se cargó ningún resumen (tarjeta nueva) o solo se cargó el que viene
     (sin uno anterior de referencia), se muestra una versión más simple
     en vez de romper con datos faltantes. */
  function cardCycleTimeline(card) {
    const cy = cardCycle(card);
    if (!cy) {
      return `<div class="cycle-card"><div class="empty">Todavía no cargaste ningún resumen de esta tarjeta. Usá "Resúmenes" para agregar el cierre y vencimiento actuales.</div></div>`;
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const daysToClose = Math.round((cy.close - today) / DAY_MS);
    const daysLine = `<div class="cycle-days">${daysToClose <= 0 ? 'Cierra hoy.' : `Faltan ${daysToClose} día${daysToClose === 1 ? '' : 's'} para el cierre.`}</div>`;
    const shortDate = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;

    if (!cy.prevClose || !cy.prevDue) {
      // Solo tenemos el próximo cierre (y su vencimiento): timeline de 2
      // puntos, sin el tramo recorrido del ciclo anterior.
      return `
        <div class="cycle-card">
          ${daysLine}
          <div class="cycle-track cycle-track-2">
            <span class="cd-date" style="grid-column:1;grid-row:1;justify-self:start">${esc(shortDate(cy.close))}</span>
            <span class="cd-date" style="grid-column:3;grid-row:1;justify-self:end">${cy.due ? esc(shortDate(cy.due)) : '—'}</span>

            <span class="cycle-dot filled" style="grid-column:1;grid-row:2;justify-self:start"></span>
            <span class="cycle-line" style="grid-column:2;grid-row:2;--p:0%"></span>
            <span class="cycle-dot" style="grid-column:3;grid-row:2;justify-self:end"></span>

            <span class="cd-tag" style="grid-column:1;grid-row:3;justify-self:start">Próx. cierre</span>
            <span class="cd-tag" style="grid-column:3;grid-row:3;justify-self:end">Vencimiento</span>
          </div>
          <div class="hint" style="margin-top:8px">Cargá también el resumen anterior desde "Resúmenes" para ver el progreso completo del ciclo.</div>
        </div>`;
    }

    // Progreso real de hoy sobre cada tramo: antes del vencimiento el
    // primer tramo (cierre → vencimiento) va llenándose y el punto del
    // vencimiento queda vacío; recién después avanza el segundo tramo.
    const segPct = (from, to) => {
      const total = to - from;
      if (total <= 0) return today >= to ? 100 : 0;
      return Math.round(Math.min(Math.max((today - from) / total, 0), 1) * 100);
    };
    const pct1 = segPct(cy.prevClose, cy.prevDue);
    const pct2 = segPct(cy.prevDue, cy.close);
    const dueReached = today >= cy.prevDue;
    const daysToDue = Math.round((cy.prevDue - today) / DAY_MS);
    const cycleDaysLine = dueReached ? daysLine : `<div class="cycle-days">${daysToDue === 0
      ? 'Vence hoy.'
      : `Faltan ${daysToDue} día${daysToDue === 1 ? '' : 's'} para el vencimiento y ${daysToClose} para el cierre.`}</div>`;
    return `
      <div class="cycle-card">
        ${cycleDaysLine}
        <div class="cycle-track">
          <span class="cd-date" style="grid-column:1;grid-row:1;justify-self:start">${esc(shortDate(cy.prevClose))}</span>
          <span class="cd-date" style="grid-column:3;grid-row:1;justify-self:center">${esc(shortDate(cy.prevDue))}</span>
          <span class="cd-date" style="grid-column:5;grid-row:1;justify-self:end">${esc(shortDate(cy.close))}</span>

          <span class="cycle-dot filled" style="grid-column:1;grid-row:2;justify-self:start"></span>
          <span class="cycle-line" style="grid-column:2;grid-row:2;--p:${pct1}%"></span>
          <span class="cycle-dot ${dueReached ? 'filled' : ''}" style="grid-column:3;grid-row:2;justify-self:center"></span>
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
     COMPRA puntual (no a "hoy"): a qué resumen cae y cuándo vence ese resumen.
     Devuelve null si la tarjeta todavía no tiene ningún resumen cargado. */
  function cardCycleFor(card, purchaseDate) {
    const p = new Date(purchaseDate); p.setHours(0, 0, 0, 0);
    const close = nextCardDate(card, 'closingDay', p, false);
    if (!close) return null;
    const due = nextCardDate(card, 'dueDay', close, true);
    return { close, due };
  }

  /* Fecha de la cuota k (1 = la compra) de una compra en cuotas. El banco
     cobra UNA cuota por resumen: la k cae en el resumen número k contando
     desde el de la compra — no necesariamente "el mismo día, k-1 meses
     después" (si un ciclo dura 7 semanas, como cuando el banco cambia la
     fecha de cierre, dos fechas mensuales caerían en el mismo resumen).
     Se mantiene la fecha mensual natural si ya cae en el resumen correcto;
     si no, el mismo día del mes dentro de ese resumen (el más cercano a la
     natural) y, si ningún día así entra, la fecha de cierre del resumen.
     Sin resúmenes cargados (o con otro medio de pago): fecha mensual. */
  function installmentDate(methodId, purchase, k) {
    const natural = clampDate(purchase.getFullYear(), purchase.getMonth() + (k - 1), purchase.getDate());
    if (k <= 1) return natural;
    const m = methodById(methodId);
    if (!m || m.kind !== 'credito') return natural;
    const first = cardCycleFor(m, purchase);
    if (!first) return natural;
    let close = first.close, prevClose = null;
    for (let i = 1; i < k; i++) {
      prevClose = close;
      close = nextCardDate(m, 'closingDay', close, true);
      if (!close) return natural;
    }
    if (natural > prevClose && natural <= close) return natural;
    let best = null;
    for (let d = new Date(prevClose.getFullYear(), prevClose.getMonth(), 1); d <= close; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const c = clampDate(d.getFullYear(), d.getMonth(), purchase.getDate());
      if (c > prevClose && c <= close && (!best || Math.abs(c - natural) < Math.abs(best - natural))) best = c;
    }
    return best || close;
  }
  /* Reacomoda las cuotas ya cargadas de compras con tarjeta de crédito
     según los resúmenes actuales (ver installmentDate). Se corre al abrir
     la app y cada vez que se carga, corrige o borra un resumen, así una
     cuota no queda en el resumen equivocado porque el banco cambió las
     fechas de cierre después de cargar la compra. */
  function realignCardInstallments() {
    const groups = new Map();
    for (const t of S().transactions) {
      if (!t.groupId || !t.installment || t.type !== 'gasto') continue;
      const m = methodById(t.methodId);
      if (!m || m.kind !== 'credito') continue;
      if (!groups.has(t.groupId)) groups.set(t.groupId, []);
      groups.get(t.groupId).push(t);
    }
    let changed = false;
    for (const txs of groups.values()) {
      const first = txs.find((t) => t.installment.k === 1);
      if (!first) continue;
      const purchase = parseDate(first.date);
      for (const t of txs) {
        if (t.installment.k === 1) continue;
        const target = dateToStr(installmentDate(t.methodId, purchase, t.installment.k));
        if (target !== t.date) {
          t.date = target;
          refineSnapshotLater(t);
          changed = true;
        }
      }
    }
    if (changed) Store.save();
    return changed;
  }

  /* Mes en el que un gasto "pega" para "Balance del mes" (y el sobrante
     automático del mes anterior, que es el mismo cálculo — ver
     monthBalance()). Por defecto es el mes de la fecha de compra; si en
     Ajustes se eligió "vencimiento", un gasto con tarjeta de crédito cuenta
     en el mes en que vence ese resumen en vez del mes en que se hizo la
     compra (decisión del usuario, ver settings.cardMonthBasis).
     También lo usa la sección Cuotas ("cuánto pagás de cuotas cada mes"),
     que con ese ajuste tiene que mostrar el mes en que se paga cada cuota.
     A propósito NO se usa en el resto (gastos por categoría,
     Movimientos, presupuestos, tendencias): esas vistas siempre
     usan la fecha real de carga (monthKeyOf(t.date)), igual que "Balance
     por día" — así "Balance del mes" puede diferir un poco de la suma de
     "Gastos por categoría" ese mes, a propósito, sin que el resto de la
     app se corra de mes por un ajuste que solo afecta a ese número. */
  function effectiveMonthOf(t) {
    return monthKeyOf(paymentDateOf(t));
  }
  // Fecha en que "se paga" un gasto según ese mismo ajuste: con
  // "vencimiento", el vencimiento del resumen de la tarjeta; si no, la
  // fecha del movimiento.
  function paymentDateOf(t) {
    if (t.type === 'gasto' && S().settings.cardMonthBasis === 'vencimiento') {
      const m = methodById(t.methodId);
      if (m && m.kind === 'credito') {
        const cyc = cardCycleFor(m, parseDate(t.date));
        if (cyc && cyc.due) return dateToStr(cyc.due);
      }
    }
    return t.date;
  }

  /* Ahorros acumulados hasta fin de un mes (suma de entries con fecha
     anterior al 1° del mes siguiente, convertidos a moneda de
     visualización). Se usa tanto en Resumen ("aportado este mes" = la
     diferencia entre dos de estos) como en monthBalance() de abajo.
     opts.excludeOpening deja afuera los aportes marcados como "ya lo tenía
     ahorrado antes" (ver savingEntryForm) — sirve para calcular cuánto se
     ahorró REALMENTE ese mes puntual, sin que un aporte histórico cargado
     de una sola vez (para asentar plata que ya existía) infle el mes en
     que se cargó como si ahí se hubiera ahorrado todo eso. El total real
     acumulado (para "Total ahorrado" y el % de cada meta) sigue usando
     todos los aportes, con o sin ese flag. */
  function savingsAtEndOf(mk, opts = {}) {
    const cutoff = `${addMonthsKey(mk, 1)}-01`;
    let total = 0;
    for (const s of S().savings) {
      const entries = opts.excludeOpening ? s.entries.filter((e) => !e.opening) : s.entries;
      // Convierte cada entrada por separado (con su propia cotización
      // histórica/manual si la tiene, ver savingEntryForm) en vez de sumar
      // todo en la moneda nativa y convertir el total con la cotización de
      // HOY — así un aporte viejo no queda mal valuado en la otra moneda.
      for (const e of entries) {
        if (e.date >= cutoff) continue;
        const v = savingEntryAmountIn(s, e, opts.cur || disp());
        if (v != null) total += v;
      }
    }
    return total;
  }

  /* Balance de un mes cualquiera: mismo cálculo que "Balance del mes" en
     Resumen (ingresos − gastos − aportado a ahorros ese mes). Se usa para
     el sobrante automático del mes anterior, ver generateLeftoverIncome(). */
  function monthBalance(mk) {
    const inMonth = S().transactions.filter((t) => effectiveMonthOf(t) === mk);
    const inc = sumDisp(inMonth.filter((t) => t.type === 'ingreso'));
    const exp = sumDisp(inMonth.filter((t) => t.type === 'gasto'));
    const savingsMonth = savingsAtEndOf(mk, { excludeOpening: true }) - savingsAtEndOf(addMonthsKey(mk, -1), { excludeOpening: true });
    return inc - exp - savingsMonth;
  }

  /* ================= Sobrante del mes anterior: generación automática =================
     Si está activado en Ajustes, cada vez que arranca un mes nuevo se le
     acredita como Ingreso el Balance del mes recién terminado, cuando dio
     positivo. Sin esto, si ese sobrante se termina usando más adelante
     (por ejemplo, para comprar más ahorro), "Balance del mes" de ESE mes
     posterior queda mentiroso: resta el aporte a ahorros completo aunque
     una parte de esa plata no salió del ingreso de ese mes. */
  function otrosIngresosCategoryId() {
    if (S().categories.some((c) => c.id === 'c-otros-i')) return 'c-otros-i';
    const fallback = S().categories.find((c) => c.type === 'ingreso');
    return fallback ? fallback.id : null;
  }
  // Al generar automáticamente el sobrante o un fijo de un mes que NO es
  // el actual (poniendo al día varios meses de una sola vez — la primera
  // vez que se crea el recurrente, o después de un tiempo sin abrir la
  // app), el snapshot con usdSnapshotFor/arsSnapshotFor de más arriba usa
  // la cotización de HOY como aproximación instantánea para no bloquear la
  // generación de los demás meses. Acá se corrige en segundo plano con la
  // cotización real de esa fecha en cuanto se consigue — mutar "tx" es
  // seguro porque es la MISMA referencia que ya vive en S().transactions.
  // Sin esto, un fijo puesto al día quedaba con el mismo tipo de cambio
  // repetido en todos los meses atrasados, y la variación % contra el mes
  // anterior daba igual en ARS que en USD para esos movimientos.
  function refineSnapshotLater(tx) {
    (async () => {
      if (tx.currency === 'ARS') tx.usdSnapshot = await usdSnapshotForDate(tx.amount, 'ARS', tx.date);
      else if (tx.currency === 'USD') tx.arsSnapshot = await arsSnapshotForDate(tx.amount, 'USD', tx.date);
      // Si se pagó con un ahorro, el retiro se rehace con la cotización
      // corregida (un ahorro en la otra moneda descuenta el equivalente).
      if (isSavingMethod(tx.methodId)) syncSavingWithdrawalForTx(tx);
      Store.save();
      render();
    })();
  }

  function generateLeftoverIncome() {
    if (!S().settings.autoLeftoverIncome) return;
    const catId = otrosIngresosCategoryId();
    if (!catId) return; // no hay ninguna categoría de ingreso para asignarle
    const cm = curMonth();
    const s = S().settings;
    let m = s.leftoverLastGen ? addMonthsKey(s.leftoverLastGen, 1) : cm;
    let changed = false;
    while (m <= cm) {
      const amt = Math.round(monthBalance(addMonthsKey(m, -1)) * 100) / 100;
      if (amt > 0) {
        const [y, mo] = m.split('-').map(Number);
        const d = clampDate(y, mo - 1, 1);
        const dateStr = dateToStr(d);
        const tx = {
          id: Store.uid(), date: dateStr, type: 'ingreso', amount: amt,
          currency: disp(), categoryId: catId, note: 'Sobrante mes anterior',
          leftoverGen: true, usdSnapshot: usdSnapshotFor(amt, disp()), arsSnapshot: arsSnapshotFor(amt, disp()),
        };
        S().transactions.push(tx);
        if (dateStr !== todayStr()) refineSnapshotLater(tx);
        changed = true;
      }
      s.leftoverLastGen = m;
      m = addMonthsKey(m, 1);
    }
    if (changed) Store.save();
  }

  /* ================= Recurrentes: generación automática ================= */
  // Un fijo "monthly" (o sin freq, para los ya cargados antes de esto) sigue
  // generándose mes a mes por r.day, con r.lastGen como mes-clave. Uno
  // "weekly"/"biweekly" no tiene un "mes" natural (puede caer 4 o 5 veces
  // en el mismo mes), así que se genera por fecha real: cada 7 o 14 días
  // desde r.startDate, con r.lastGenDate (una fecha, no un mes) llevando la
  // cuenta de la última ocurrencia ya creada.
  function pushRecurringTx(r, dateStr) {
    const tx = {
      id: Store.uid(), date: dateStr, type: r.type, amount: r.amount,
      currency: r.currency, categoryId: r.categoryId, methodId: r.methodId,
      note: r.name, recurringId: r.id,
      usdSnapshot: usdSnapshotFor(r.amount, r.currency), arsSnapshot: arsSnapshotFor(r.amount, r.currency),
    };
    S().transactions.push(tx);
    // Fijo pagado con un ahorro: retiro automático en ese ahorro, igual que
    // un gasto cargado a mano con "Pagar con un ahorro".
    syncSavingWithdrawalForTx(tx);
    if (dateStr !== todayStr()) refineSnapshotLater(tx);
  }
  function generateRecurring() {
    const cm = curMonth();
    const todayD = new Date(); todayD.setHours(0, 0, 0, 0);
    const monthEnd = new Date(todayD.getFullYear(), todayD.getMonth() + 1, 0);
    let changed = false;
    for (const r of S().recurring) {
      if (r.freq === 'weekly' || r.freq === 'biweekly') {
        if (!r.startDate) continue;
        const step = r.freq === 'weekly' ? 7 : 14;
        let cursor = r.lastGenDate ? addDays(parseDate(r.lastGenDate), step) : parseDate(r.startDate);
        // Hasta el fin del mes en curso (no solo hasta hoy), igual que un
        // fijo mensual, que se genera apenas arranca el mes aunque su día
        // todavía no haya llegado: antes uno semanal que arrancaba mañana
        // no aparecía en Movimientos ni en el balance hasta ese día.
        while (cursor <= monthEnd) {
          const dateStr = dateToStr(cursor);
          pushRecurringTx(r, dateStr);
          r.lastGenDate = dateStr;
          changed = true;
          cursor = addDays(cursor, step);
        }
      } else {
        let m = r.lastGen ? addMonthsKey(r.lastGen, 1) : cm;
        while (m <= cm) {
          const [y, mo] = m.split('-').map(Number);
          const d = clampDate(y, mo - 1, r.day);
          pushRecurringTx(r, dateToStr(d));
          r.lastGen = m;
          changed = true;
          m = addMonthsKey(m, 1);
        }
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
  // Refresca la cotización si nunca se trajo o tiene más de 6 horas. Se
  // llama al abrir la app y también cada vez que vuelve a primer plano
  // (ver 'visibilitychange' en init()): en el celular, sobre todo como PWA
  // instalada, volver de segundo plano casi nunca recarga la página del
  // todo, así que sin ese segundo chequeo la cotización podía quedar
  // congelada días enteros aunque la app "estuviera abierta".
  function maybeRefreshRates() {
    const s = S().settings;
    const stale = !s.ratesUpdatedAt ||
      (Date.now() - new Date(s.ratesUpdatedAt).getTime()) > 6 * 3600 * 1000;
    if (stale) refreshRates();
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
  // Oscuro por defecto (tokens.css); el claro se activa con data-theme="light".
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }
  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    if (next === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    localStorage.setItem(THEME_KEY, next);
    const meta = $('#meta-theme-color');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
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
  // Todos los pop-ups de la app son paneles inferiores (ver openSheet()).
  function openModal(dlg) { openSheet(dlg); }
  function showModalBase(dlg) {
    document.body.style.overflow = 'hidden';
    dlg.showModal();
  }

  /* ================= Diálogo genérico ================= */
  // viewOnly: true es para diálogos de solo lectura (un detalle, una lista)
  // que no tienen nada que "cancelar" — antes esos usaban submitLabel:
  // 'Cerrar' igual, así que el pie terminaba con "Cancelar" Y "Cerrar" una
  // al lado de la otra haciendo exactamente lo mismo. Acá el pie queda con
  // un solo botón.
  // Panel genérico con formulario: agarradera, X, título, un solo botón
  // primario abajo (sin "Cancelar"). Lo destructivo que se pase en
  // footExtra (ej. "Eliminar") va detrás de un menú ⋯ arriba a la derecha.
  // viewOnly: true es para paneles de solo lectura (sin botón abajo).
  function openDialog(title, bodyHTML, { submitLabel = 'Guardar', onSubmit, footExtra = '', viewOnly = false } = {}) {
    const dlg = $('#dialog');
    dlg.className = 'dialog'; // por si quedó una clase de otro uso anterior
    dlg.innerHTML = `
      <form novalidate="false">
        <div class="dialog-head">
          <button type="button" class="icb" data-close aria-label="Cerrar">${spriteIcon('x')}</button>
          <span class="dialog-title">${esc(title)}</span>
          ${footExtra ? `<button type="button" class="icb" data-more aria-label="Más opciones" aria-expanded="false">${spriteIcon('dots-v')}</button>` : '<span></span>'}
        </div>
        ${footExtra ? `<div class="sh-menu" hidden>${footExtra}</div>` : ''}
        <div class="dialog-body">${bodyHTML}</div>
        ${viewOnly ? '' : `<div class="dialog-foot"><button type="submit" class="btn btn-primary btn-full btn-save">${esc(submitLabel)}</button></div>`}
      </form>`;
    $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => closeSheet(dlg)));
    const more = $('[data-more]', dlg);
    if (more) more.addEventListener('click', () => {
      const menu = $('.sh-menu', dlg);
      menu.hidden = !menu.hidden;
      more.setAttribute('aria-expanded', String(!menu.hidden));
    });
    $('form', dlg).addEventListener('submit', (e) => {
      e.preventDefault();
      if (viewOnly) { closeSheet(dlg); return; }
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

  // Como catSelectOptionsHTML(), pero para el filtro de Movimientos: ahí el
  // grupo (ej. "Casa") también tiene que poder elegirse — filtra ese grupo
  // MÁS todas sus subcategorías — a diferencia del formulario de carga, que
  // solo permite elegir hojas. Por eso el grupo va como una opción más
  // dentro de su propio <optgroup>, en vez de quedar afuera.
  function catFilterOptionsHTML(selId) {
    if (!useSubcats()) return selOptions(S().categories, selId);
    return S().categories.filter((c) => !c.parentId).map((g) => {
      const children = catChildren(g.id);
      if (!children.length) return `<option value="${esc(g.id)}" ${g.id === selId ? 'selected' : ''}>${esc(g.name)}</option>`;
      const groupOpt = `<option value="${esc(g.id)}" ${g.id === selId ? 'selected' : ''}>${esc(g.name)} (todas)</option>`;
      return `<optgroup label="${esc(g.name)}">${groupOpt}${selOptions(children, selId)}</optgroup>`;
    }).join('');
  }

  /* ================= Formulario de movimiento ================= */

  /* Carga y edición de movimientos en un panel que sube desde abajo, todo
     en una sola pantalla: tipo, monto con calculadora (teclado propio, el
     del sistema nunca aparece), chips con valores por defecto (fecha,
     cuenta, cuotas, compartido, nota) y la grilla de categorías, que al
     tocar una con subcategorías pasa a mostrar sus subcategorías en los
     mismos círculos. Lo que cambia es la interfaz: el guardado (moneda,
     cotización del momento, cuotas, compartido, pagar con un ahorro) es
     el mismo de siempre, en onSave(). */
  const TX_TYPE_LABEL = { gasto: 'Gasto', ingreso: 'Ingreso', transferencia: 'Transferencia' };
  const INST_MAX = 24;
  // Cuenta de la última vez (la del último movimiento cargado de ese tipo),
  // para que el chip de Cuenta ya venga con la que se usa siempre.
  function lastUsedMethodId(type) {
    const txs = S().transactions;
    for (let i = txs.length - 1; i >= 0; i--) {
      const t = txs[i];
      if (type && t.type !== type) continue;
      if (methodById(t.methodId) || (type === 'gasto' && isSavingMethod(t.methodId))) return t.methodId;
    }
    if (type) return lastUsedMethodId(null);
    return S().methods[0] ? S().methods[0].id : '';
  }
  // Cuántas veces se usó cada categoría (contando por grupo y por hoja).
  function categoryUsage(type) {
    const counts = new Map();
    for (const t of S().transactions) {
      if (t.type !== type || !t.categoryId) continue;
      counts.set(t.categoryId, (counts.get(t.categoryId) || 0) + 1);
      const top = topCategoryOf(t.categoryId);
      if (top !== t.categoryId) counts.set(top, (counts.get(top) || 0) + 1);
    }
    return counts;
  }
  const relDayLabel = (dateStr) => {
    const short = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(parseDate(dateStr)).replace('.', '');
    if (dateStr === todayStr()) return `Hoy, ${short}`;
    if (dateStr === dateToStr(addDays(parseDate(todayStr()), -1))) return `Ayer, ${short}`;
    return short.charAt(0).toUpperCase() + short.slice(1);
  };

  /* Carga desde un link de otra app: ?nuevo=gasto&monto=40000&moneda=ARS
     &fecha=2026-10-15&categoria=Supermercado&subcategoria=…&medio=Visa&nota=…
     Abre el formulario ya completo (no guarda nada solo) y deja la
     dirección limpia para que recargar no lo vuelva a abrir. */
  function readLinkPrefill() {
    let params;
    try { params = new URLSearchParams(location.search); } catch (e) { return null; }
    if (!params.has('nuevo')) return null;
    const keys = ['nuevo', 'monto', 'moneda', 'fecha', 'categoria', 'subcategoria', 'medio', 'nota'];
    const raw = {};
    for (const k of keys) raw[k] = (params.get(k) || '').trim();
    keys.forEach((k) => params.delete(k));
    const rest = params.toString();
    try { history.replaceState(history.state, '', location.pathname + (rest ? `?${rest}` : '') + location.hash); } catch (e) { /* sin history */ }
    const type = raw.nuevo.toLowerCase();
    if (type !== 'gasto' && type !== 'ingreso') return null;
    return { ...raw, type };
  }
  // "40000", "40.000,50", "40000.5", "1,5" → número (null si no sirve).
  function parseLinkAmount(str) {
    let t = String(str || '').replace(/[\s$]/g, '').replace(/^(ARS|USD|US)/i, '');
    if (!t) return null;
    const lastDot = t.lastIndexOf('.'), lastComma = t.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      const dec = lastDot > lastComma ? '.' : ',';
      t = t.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
    } else if (lastComma >= 0) {
      t = (t.split(',').length > 2) ? t.split(',').join('') : t.replace(',', '.');
    } else if (t.split('.').length > 2) {
      t = t.split('.').join('');
    }
    const n = Number(t);
    return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  }
  const normName = (str) => String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim();
  // Parecido entre dos nombres, de 0 a 1: igual = 1, uno contiene al otro
  // = 0,85; si no, coincidencia de pares de letras (Dice).
  function nameScore(a, b) {
    const x = normName(a), y = normName(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `)) return 0.85;
    if (x.includes(y) || y.includes(x)) return 0.75;
    const pairs = (w) => { const out = []; for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2)); return out; };
    const px = pairs(x), py = pairs(y);
    if (!px.length || !py.length) return 0;
    const pool = py.slice();
    let hits = 0;
    for (const pr of px) { const i = pool.indexOf(pr); if (i >= 0) { hits++; pool.splice(i, 1); } }
    return (2 * hits) / (px.length + py.length);
  }
  function bestByName(list, name, min = 0.6) {
    let best = null, bestScore = -1;
    for (const it of list) {
      const sc = nameScore(it.name, name);
      if (sc >= min && sc > bestScore) { best = it; bestScore = sc; }
    }
    return best;
  }
  // Lo que se le pasa a txForm como valores iniciales.
  function linkPrefillToDraft(p) {
    const out = { type: p.type, note: p.nota.slice(0, 200) };
    const amount = parseLinkAmount(p.monto);
    if (amount != null) out.amount = amount;
    out.currency = p.moneda.toUpperCase() === 'USD' ? 'USD' : 'ARS';
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.fecha) && !isNaN(parseDate(p.fecha)) && dateToStr(parseDate(p.fecha)) === p.fecha) out.date = p.fecha;
    // Categoría: primero el grupo por "categoria" y, adentro, la
    // subcategoría; si no, la más parecida entre todas las del tipo.
    const cats = S().categories.filter((c) => c.type === p.type);
    let cat = null;
    if (p.categoria || p.subcategoria) {
      const group = p.categoria ? bestByName(cats, p.categoria) : null;
      if (p.subcategoria) {
        cat = (group && bestByName(catChildren(group.id), p.subcategoria))
          || bestByName(cats.filter((c) => c.parentId), p.subcategoria);
      }
      if (!cat) cat = group;
    }
    if (cat) {
      if (selectableCats(p.type).some((c) => c.id === cat.id)) out.categoryId = cat.id;
      else if (!cat.parentId && catChildren(cat.id).length) out.catGroupExpand = cat.id;
    }
    // Medio de pago: solo si coincide (sin mayúsculas ni acentos); si no,
    // queda vacío para elegirlo.
    if (p.medio) {
      const opts = S().methods.concat(p.type === 'gasto' ? S().savings : []);
      const want = normName(p.medio);
      const exact = opts.find((m) => normName(m.name) === want);
      const partial = opts.filter((m) => { const n = normName(m.name); return n && (n.includes(want) || want.includes(n)); });
      out.methodId = exact ? exact.id : partial.length === 1 ? partial[0].id : '';
    }
    return out;
  }

  function txForm(tx, prefill = null) {
    const editing = !!tx;
    // El hogar compartido se carga en segundo plano al abrir la app: si el
    // panel se abría antes de que terminara, la opción "compartido" no
    // aparecía hasta cerrar y volver a abrir. Ahora se vuelve a mirar en
    // cada repintado y, si todavía está cargando, se repinta al terminar.
    let partner = sharedPartner();
    // Compartir con la pareja solo tiene sentido para gastos (se reparte
    // quién pagó qué); un ingreso o una transferencia entre tus propias
    // cuentas no es algo que "se deba" entre los dos.
    const canShare = () => {
      if (!partner) partner = sharedPartner();
      return !editing && draft.type === 'gasto' && !!partner && !!(shared.household);
    };

    const pf = !editing && prefill ? prefill : null;
    const startType = editing ? tx.type : (pf ? pf.type : 'gasto');
    const draft = {
      type: startType,
      date: editing ? tx.date : (pf && pf.date) || todayStr(),
      currency: editing ? tx.currency : (pf && pf.currency) || 'ARS',
      categoryId: editing ? tx.categoryId : (pf && pf.categoryId) || '',
      methodId: editing ? tx.methodId : pf && pf.methodId !== undefined ? pf.methodId : lastUsedMethodId(startType),
      toMethodId: editing ? (tx.toMethodId || '') : '',
      shareIt: false,
      sharePct: 50,
      // Al editar, el monto guardado queda como "resultado" de la
      // calculadora: ⌫ lo corrige de a un dígito y un número nuevo lo pisa.
      acc: null,
      op: null,
      cur: editing ? (Math.round(tx.amount * 100) / 100).toString() : pf && pf.amount ? String(pf.amount) : '',
      // true justo después de presionar "=": el próximo dígito tipeado tiene
      // que arrancar un número nuevo (como una calculadora física), en vez
      // de agregarse al final del resultado que ya se mostró.
      justEq: editing || !!(pf && pf.amount),
      // Qué se ve debajo de los chips: null = grilla de categorías; si no,
      // la lista de un chip ('method' | 'methodTo' | 'inst' | 'share' | 'note').
      panel: null,
      catGroupExpand: (pf && pf.catGroupExpand) || null, // grupo cuyas subcategorías se están mostrando en la grilla
      showAllCats: false,
      note: editing ? (tx.note || '') : (pf && pf.note) || '',
      inst: 1,
      // 'total': el monto tipeado es el precio total de la compra (se
      // reparte entre las n cuotas). 'per': el monto tipeado ya es el valor
      // de UNA cuota (se multiplica por n para saber el total).
      instMode: 'total',
      error: '',
    };

    const dlg = $('#dialog');
    dlg.className = 'sheet sheet-tx';

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
    const OP_SHOWN = { '+': '+', '-': '−', '×': '×', '÷': '÷' };
    function displayExpr() {
      const parts = [];
      if (draft.acc != null) parts.push(formatTyped(numFmt(draft.acc)));
      if (draft.op) parts.push(OP_SHOWN[draft.op]);
      if (draft.cur !== '') parts.push(formatTyped(draft.cur));
      return parts.length ? parts.join(' ') : '0';
    }
    function pressDigit(d) {
      haptic();
      // Si se venía de "=" (o de abrir un movimiento para editarlo), este
      // dígito arranca un número nuevo, como en una calculadora física.
      if (draft.justEq) { draft.acc = null; draft.cur = ''; draft.justEq = false; }
      if (d === '.' && draft.cur.includes('.')) return;
      if (draft.cur.length > 12) return;
      if (d === '.' && draft.cur === '') { draft.cur = '0.'; paintAmount(); return; }
      draft.cur = (draft.cur + d).replace(/^0+(?=\d)/, ''); // sin ceros a la izquierda
      paintAmount();
    }
    function pressOp(op) {
      haptic();
      draft.justEq = false;
      const curVal = draft.cur === '' ? null : parseFloat(draft.cur);
      if (draft.op && curVal != null) draft.acc = applyOp(draft.acc, draft.op, curVal);
      else if (curVal != null) draft.acc = curVal;
      if (draft.acc == null) return; // un operador sin número antes no hace nada
      draft.op = op;
      draft.cur = '';
      paintAmount();
    }
    function pressEquals() {
      haptic();
      const curVal = draft.cur === '' ? null : parseFloat(draft.cur);
      if (draft.op && curVal != null) draft.acc = applyOp(draft.acc, draft.op, curVal);
      else if (curVal != null) draft.acc = curVal;
      draft.op = null;
      draft.cur = draft.acc != null ? numFmt(draft.acc) : '';
      draft.acc = null;
      draft.justEq = true;
      paintAmount();
    }
    function pressBack() {
      haptic();
      draft.justEq = false;
      if (draft.cur) draft.cur = draft.cur.slice(0, -1);
      else if (draft.op) draft.op = null;
      else if (draft.acc != null) { draft.cur = numFmt(draft.acc); draft.acc = null; }
      paintAmount();
    }
    // ⌫ mantenido: reinicia toda la cuenta.
    function pressClear() {
      haptic();
      draft.acc = null;
      draft.op = null;
      draft.cur = '';
      draft.justEq = false;
      paintAmount();
    }

    function currentInstMethod() { return methodById(draft.methodId); }
    // Se puede comprar en cuotas con cualquier medio de pago (tarjeta,
    // financiación de la tienda, acuerdo informal…). Pagar con un ahorro
    // queda afuera: ahí se retira el total de una sola vez (ver onSave()).
    function showInstallments() {
      return !editing && draft.type === 'gasto' && !!currentInstMethod() && !isSavingMethod(draft.methodId);
    }
    // Con cuotas, el monto tipeado es ambiguo (¿el total o lo que sale cada
    // cuota?): instMode lo define y esto calcula los dos valores.
    function instAmounts(n) {
      const entered = Math.round(finalAmount() * 100) / 100;
      if (!(entered > 0) || !(n > 1)) return null;
      if (draft.instMode === 'per') {
        return { per: entered, total: Math.round(entered * n * 100) / 100 };
      }
      return { per: Math.round((entered / n) * 100) / 100, total: entered };
    }
    const instN = () => Math.max(1, parseInt(draft.inst || '1', 10) || 1);

    /* ---------- Partes del panel ---------- */
    // Equivalente en la otra moneda a la cotización de hoy (y, mientras se
    // está haciendo una cuenta, el resultado parcial).
    function amountSubHTML() {
      const v = Math.round(finalAmount() * 100) / 100;
      const parts = [];
      if (draft.op && draft.cur !== '') parts.push(`= ${fmtMoney(v, draft.currency)}`);
      const other = draft.currency === 'ARS' ? usdSnapshotFor(v, 'ARS') : arsSnapshotFor(v, 'USD');
      if (v > 0 && other != null) parts.push(`≈ ${fmtMoney(other, draft.currency === 'ARS' ? 'USD' : 'ARS')}`);
      return parts.map(esc).join(' · ');
    }
    function amountHTML() {
      const shown = displayExpr();
      const size = shown.length > 14 ? ' is-xs' : shown.length > 10 ? ' is-sm' : '';
      return `
        <div class="amount${size}" data-amount>
          <div class="val num" aria-live="polite"><small>${draft.currency === 'USD' ? 'US$' : '$'}</small><span>${esc(shown)}</span><span class="caret" aria-hidden="true"></span></div>
          <div class="amount-sub">
            <button type="button" class="cur" data-curtoggle aria-label="Moneda: ${draft.currency}. Cambiar a ${draft.currency === 'ARS' ? 'USD' : 'ARS'}">
              <b>${draft.currency}</b>${spriteIcon('swap')}<span>${draft.currency === 'ARS' ? 'USD' : 'ARS'}</span>
            </button>
            <span class="amount-eq num" data-amount-sub>${amountSubHTML()}</span>
          </div>
        </div>`;
    }
    const chip = (attrs, icon, label, on) =>
      `<button type="button" class="chip${on ? ' on' : ''}" ${attrs}>${spriteIcon(icon)}<span>${esc(label)}</span></button>`;
    function chipsHTML() {
      const out = [];
      out.push(`<label class="chip chip-date">${spriteIcon('cal')}<span>${esc(relDayLabel(draft.date))}</span>
        <input type="date" id="tx-date-input" value="${esc(draft.date)}" aria-label="Fecha"></label>`);
      if (draft.type === 'transferencia') {
        out.push(chip('data-panel="method"', 'card', draft.methodId ? `Desde ${methodName(draft.methodId)}` : 'Desde…', draft.panel === 'method'));
        out.push(chip('data-panel="methodTo"', 'wallet', draft.toMethodId ? `Hacia ${methodName(draft.toMethodId)}` : 'Hacia…', draft.panel === 'methodTo'));
      } else {
        out.push(chip('data-panel="method"', isSavingMethod(draft.methodId) ? 'target' : 'card', draft.methodId ? methodName(draft.methodId) : 'Cuenta', draft.panel === 'method'));
      }
      if (showInstallments()) {
        const n = instN();
        const a = instAmounts(n);
        const label = n === 1 ? '1 pago' : a ? `${n} cuotas de ${fmtMoney(a.per, draft.currency)}` : `${n} cuotas`;
        out.push(chip('data-panel="inst"', 'repeat', label, n > 1 || draft.panel === 'inst'));
      }
      if (canShare()) {
        const pct = Math.round(Number(draft.sharePct) || 0);
        // Corto, para que los chips no bajen a una tercera fila.
        const label = draft.shareIt ? `Con ${partnerLabel(partner)} · ${pct}/${100 - pct}` : 'Compartido';
        out.push(chip('data-share', 'users', label, draft.shareIt));
      }
      out.push(chip('data-panel="note"', 'note', draft.note ? draft.note : 'Nota', !!draft.note || draft.panel === 'note'));
      return `<div class="chips chips-wrap">${out.join('')}</div>`;
    }

    // Grilla de categorías: las 8 más usadas (o todas), en círculos con su
    // color. Un grupo con subcategorías pasa a mostrar sus subcategorías en
    // los mismos círculos, con la más usada ya elegida.
    const catb = (attrs, color, icon, name, on) =>
      `<button type="button" class="catb${on ? ' on' : ''}" style="--c:${color}" ${attrs}><span class="cic">${icon}</span><span class="catb-name">${esc(name)}</span></button>`;
    function catSectionHTML() {
      const selTop = draft.categoryId ? topCategoryOf(draft.categoryId) : null;
      if (useSubcats() && draft.catGroupExpand) {
        const g = catById(draft.catGroupExpand);
        const kids = g ? catChildren(g.id) : [];
        if (g && kids.length) {
          return `
            <div class="cat-head"><span class="ovl">${esc(g.name)} · elegí subcategoría</span></div>
            <div class="catgrid swap" data-catgrid>
              ${catb('data-catback aria-label="Volver a las categorías"', 'var(--t2)', spriteIcon('cl'), 'Volver', false)}
              ${kids.map((c) => catb(`data-pickid="${esc(c.id)}"`, catColor(c.id), iconSvg(categoryIconName(c.id)), c.name, c.id === draft.categoryId)).join('')}
            </div>`;
        }
        draft.catGroupExpand = null;
      }
      const usage = categoryUsage(draft.type);
      const all = useSubcats() ? catGroups(draft.type) : S().categories.filter((c) => c.type === draft.type);
      if (!all.length) return '<div class="empty">No hay categorías. Agregá una desde Ajustes.</div>';
      // Orden estable: por uso y, a igual uso, el orden en que están en Ajustes.
      const ranked = all.map((c, i) => ({ c, i })).sort((a, b) => (usage.get(b.c.id) || 0) - (usage.get(a.c.id) || 0) || a.i - b.i).map((x) => x.c);
      let shown = draft.showAllCats ? ranked : ranked.slice(0, 8);
      const selShownId = useSubcats() ? selTop : draft.categoryId;
      if (!draft.showAllCats && selShownId && !shown.some((c) => c.id === selShownId)) {
        const sel = catById(selShownId);
        if (sel) shown = [...shown.slice(0, 7), sel];
      }
      return `
        <div class="cat-head">
          <span class="ovl">Categoría</span>
          ${all.length > 8 ? `<button type="button" class="link-btn" data-allcats>${draft.showAllCats ? 'Menos' : 'Todas'}</button>` : ''}
        </div>
        <div class="catgrid" data-catgrid>
          ${shown.map((c) => {
            const hasKids = useSubcats() && catChildren(c.id).length > 0;
            const on = useSubcats() ? c.id === selTop : c.id === draft.categoryId;
            return catb(hasKids ? `data-catgroup="${esc(c.id)}"` : `data-pickid="${esc(c.id)}"`, catColor(c.id), iconSvg(categoryIconName(c.id)), c.name, on);
          }).join('')}
        </div>`;
    }

    // Lista de cuentas (y, para gastos, "Pagar con un ahorro").
    function methodPanelHTML(kind) {
      const selId = kind === 'methodTo' ? draft.toMethodId : draft.methodId;
      const excludeId = draft.type === 'transferencia' ? (kind === 'methodTo' ? draft.methodId : draft.toMethodId) : null;
      const row = (id, name, icon) => `
        <button type="button" class="pick-row${id === selId ? ' on' : ''}" data-pickmethod="${esc(id)}">
          <span class="cic" style="--c:var(--t2)">${iconSvg(icon)}</span><span>${esc(name)}</span>
          ${id === selId ? spriteIcon('check') : ''}
        </button>`;
      const methods = S().methods.filter((m) => m.id !== excludeId);
      const savings = draft.type === 'gasto' ? S().savings : [];
      const title = draft.type === 'transferencia' ? (kind === 'methodTo' ? 'Hacia' : 'Desde') : 'Cuenta';
      return `
        <div class="cat-head"><span class="ovl">${title}</span><button type="button" class="link-btn" data-panelclose>Listo</button></div>
        <div class="pick-list">
          ${methods.length ? methods.map((m) => row(m.id, m.name, methodIconName(m.id))).join('') : '<div class="empty">No hay medios. Agregá uno desde Cuentas.</div>'}
          ${savings.length ? `<div class="ovl pick-sep">Pagar con un ahorro</div>${savings.map((s) => row(s.id, s.name, 'wallet')).join('')}` : ''}
        </div>`;
    }
    function instPanelHTML() {
      const n = instN();
      const a = instAmounts(n);
      return `
        <div class="cat-head"><span class="ovl">Cuotas</span><button type="button" class="link-btn" data-panelclose>Listo</button></div>
        <div class="inst-grid">
          ${Array.from({ length: INST_MAX }, (_, i) => i + 1).map((k) => `<button type="button" class="inst-opt${k === n ? ' sel' : ''}" data-inst="${k}">${k === 1 ? '1 pago' : k}</button>`).join('')}
        </div>
        ${n > 1 ? `
        <div class="tseg tseg-small" role="group" aria-label="El monto es">
          <button type="button" class="${draft.instMode !== 'per' ? 'on' : ''}" data-inst-mode="total">Es el total</button>
          <button type="button" class="${draft.instMode === 'per' ? 'on' : ''}" data-inst-mode="per">Es cada cuota</button>
        </div>
        <div class="hint inst-preview">${a
          ? `${n} cuotas de <b>${esc(fmtMoney(a.per, draft.currency))}</b> · total <b>${esc(fmtMoney(a.total, draft.currency))}</b>`
          : 'Cargá un monto para ver cuánto queda cada cuota.'}</div>` : ''}`;
    }
    const SHARE_PRESETS = [50, 60, 70, 40, 30, 100];
    function sharePanelHTML() {
      const pct = Math.round(Number(draft.sharePct) || 0);
      const who = partnerLabel(partner);
      return `
        <div class="cat-head"><span class="ovl">Compartido con ${esc(who)}</span><button type="button" class="link-btn" data-panelclose>Listo</button></div>
        <div class="hint">Cuánto te toca a vos y cuánto a ${esc(who)}.</div>
        <div class="inst-grid share-grid">
          ${SHARE_PRESETS.map((p) => `<button type="button" class="inst-opt${draft.shareIt && p === pct ? ' sel' : ''}" data-sharepct="${p}">${p}/${100 - p}</button>`).join('')}
        </div>
        <label class="share-custom">
          <span>Tu parte</span>
          <input type="number" id="tx-share-pct" min="0" max="100" step="1" inputmode="numeric" value="${pct}">
          <span>%</span>
        </label>
        <button type="button" class="btn btn-full share-off" data-shareoff>No compartir</button>`;
    }
    function notePanelHTML() {
      return `
        <div class="cat-head"><span class="ovl">Nota</span><button type="button" class="link-btn" data-panelclose>Listo</button></div>
        <input type="text" id="tx-note" maxlength="80" value="${esc(draft.note)}" placeholder="Ej.: cumple de Ana" enterkeyhint="done">`;
    }
    // Para que nunca haya que scrollear: mientras está abierta la lista de
    // un chip (cuenta, cuotas, compartido, nota), todas las categorías o
    // una categoría con muchas subcategorías, el teclado se esconde y esa
    // lista usa su lugar. Vuelve al cerrarla.
    function keysHidden() {
      if (draft.panel || draft.showAllCats) return true;
      return !!(useSubcats() && draft.catGroupExpand && catChildren(draft.catGroupExpand).length > 7);
    }
    function lowerHTML() {
      if (draft.panel === 'method' || draft.panel === 'methodTo') return methodPanelHTML(draft.panel);
      if (draft.panel === 'inst' && showInstallments()) return instPanelHTML();
      if (draft.panel === 'share' && canShare()) return sharePanelHTML();
      if (draft.panel === 'note') return notePanelHTML();
      draft.panel = null;
      if (draft.type === 'transferencia') return '';
      return catSectionHTML();
    }

    function keysHTML() {
      const k = (v, label, cls = '', extra = '') => `<button type="button" class="key${cls}" ${extra} data-k="${v}">${label}</button>`;
      const op = (v, label, aria) => `<button type="button" class="key op" data-op="${v}" aria-label="${aria}">${label}</button>`;
      return `
        <div class="keys" data-keys>
          ${k('7', '7')}${k('8', '8')}${k('9', '9')}<button type="button" class="key op key-wide" data-back aria-label="Borrar (mantené para borrar todo)">${spriteIcon('back')}</button>
          ${k('4', '4')}${k('5', '5')}${k('6', '6')}${op('÷', '÷', 'Dividir')}${op('×', '×', 'Multiplicar')}
          ${k('1', '1')}${k('2', '2')}${k('3', '3')}${op('-', '−', 'Restar')}${op('+', '+', 'Sumar')}
          ${k('000', '000')}${k('0', '0')}${k('.', ',', '', 'aria-label="Coma"')}<button type="button" class="key op key-wide" data-eq aria-label="Igual">=</button>
        </div>`;
    }

    function saveLabel() {
      if (editing) return 'Guardar cambios';
      if (draft.type === 'transferencia') return 'Guardar transferencia';
      const base = `Guardar ${TX_TYPE_LABEL[draft.type].toLowerCase()}`;
      return draft.categoryId ? `${base} · ${catName(draft.categoryId)}` : base;
    }

    function sheetHTML() {
      return `
        <div class="sh-top" data-drag>
          <div class="grab" aria-hidden="true"></div>
          <div class="sh-h">
            <button type="button" class="icb" data-close aria-label="Cerrar">${spriteIcon('x')}</button>
            <h2>${editing ? 'Editar movimiento' : pf ? 'Revisá y guardá' : 'Nuevo movimiento'}</h2>
            ${editing ? `<button type="button" class="icb icb-danger" data-del aria-label="Eliminar movimiento">${iconSvg('trash')}</button>` : '<span></span>'}
          </div>
        </div>
        <div class="sh-body" data-shbody>
          <div class="tseg" role="group" aria-label="Tipo de movimiento">
            ${['gasto', 'ingreso', 'transferencia'].map((t) => `<button type="button" class="${draft.type === t ? 'on' : ''}" data-ttype="${t}" aria-pressed="${draft.type === t}">${TX_TYPE_LABEL[t]}</button>`).join('')}
          </div>
          ${amountHTML()}
          ${chipsHTML()}
          <div class="sh-lower">${lowerHTML()}</div>
        </div>
        ${keysHidden() ? '' : keysHTML()}
        <div class="savebar">
          ${draft.error ? `<div class="sh-error" role="alert">${esc(draft.error)}</div>` : ''}
          <button type="button" class="btn btn-primary btn-full btn-save" data-save>${esc(saveLabel())}</button>
        </div>`;
    }

    // El monto se repinta solo (sin rehacer todo el panel) en cada tecla:
    // así no se pierde el scroll ni parpadea la grilla.
    function paintAmount() {
      draft.error = '';
      const a = $('[data-amount]', dlg);
      if (a) a.outerHTML = amountHTML();
      const chips = $('.chips', dlg);
      if (chips && showInstallments() && instN() > 1) chips.outerHTML = chipsHTML();
      if (draft.panel === 'inst') { const lower = $('.sh-lower', dlg); if (lower) lower.innerHTML = lowerHTML(); }
      const err = $('.sh-error', dlg);
      if (err) err.remove();
    }

    function paint() {
      const body = $('[data-shbody]', dlg);
      const scroll = body ? body.scrollTop : 0;
      dlg.innerHTML = sheetHTML();
      const nb = $('[data-shbody]', dlg);
      if (nb) nb.scrollTop = scroll;
      requestAnimationFrame(fit);
      if (draft.panel === 'note') {
        const n = $('#tx-note', dlg);
        if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
      }
    }

    // En pantallas bajas, si el contenido no entra arriba del teclado, se
    // compacta (teclas y monto más chicos) en vez de quedar tapado.
    function fit() {
      const nb = $('[data-shbody]', dlg);
      dlg.classList.remove('fit1', 'fit2');
      if (!nb || !dlg.open) return;
      const over = () => nb.scrollHeight > nb.clientHeight + 1;
      if (over()) dlg.classList.add('fit1');
      if (over()) dlg.classList.add('fit2');
    }

    function setType(t) {
      draft.type = t;
      if (draft.categoryId && !selectableCats(draft.type).some((c) => c.id === draft.categoryId)) draft.categoryId = '';
      // Pagar con un ahorro solo es válido para un gasto.
      if (draft.methodId && isSavingMethod(draft.methodId) && draft.type !== 'gasto') draft.methodId = '';
      if (!draft.methodId) draft.methodId = lastUsedMethodId(t === 'transferencia' ? null : t);
      draft.catGroupExpand = null;
      draft.panel = null;
      draft.error = '';
      paint();
    }
    function pickCategoryGroup(groupId) {
      const kids = catChildren(groupId);
      const usage = categoryUsage(draft.type);
      // La subcategoría más usada queda elegida; si ya había una de este
      // grupo, se respeta.
      const already = kids.find((c) => c.id === draft.categoryId);
      const best = already || [...kids].sort((a, b) => (usage.get(b.id) || 0) - (usage.get(a.id) || 0))[0];
      draft.categoryId = best ? best.id : draft.categoryId;
      draft.catGroupExpand = groupId;
      draft.showAllCats = false;
      draft.error = '';
      paint();
    }

    // Todos los toques del panel pasan por acá (el HTML se rehace entero en
    // cada paint(), así que se escucha una sola vez en el <dialog>).
    function onClick(e) {
      const t = e.target;
      const q = (sel) => t.closest(sel);
      let b;
      if (q('[data-close]')) { closeSheet(dlg); return; }
      if ((b = q('.chip-date'))) {
        // En la compu el selector de fecha no se abre tocando el campo
        // invisible; en el iPhone sí, con la ruedita del sistema.
        const inp = $('input', b);
        if (inp && inp.showPicker && e.target !== inp) { try { inp.showPicker(); } catch (err) { /* sin showPicker */ } }
        return;
      }
      if (q('[data-del]')) { closeSheet(dlg).then(() => deleteTx(tx)); return; }
      if ((b = q('[data-ttype]'))) { if (b.dataset.ttype !== draft.type) setType(b.dataset.ttype); return; }
      if ((b = q('[data-keys] [data-k]'))) { pressDigit(b.dataset.k); return; }
      if ((b = q('[data-keys] [data-op]'))) { pressOp(b.dataset.op); return; }
      if (q('[data-keys] [data-eq]')) { pressEquals(); return; }
      if (q('[data-keys] [data-back]')) { if (!backHeld) pressBack(); backHeld = false; return; }
      if (q('[data-curtoggle]')) { draft.currency = draft.currency === 'ARS' ? 'USD' : 'ARS'; paint(); return; }
      if ((b = q('[data-panel]'))) {
        const p = b.dataset.panel;
        draft.panel = draft.panel === p ? null : p;
        paint();
        return;
      }
      if (q('[data-share]')) {
        if (shareHeld) { shareHeld = false; return; }
        if (!draft.shareIt) { draft.shareIt = true; draft.panel = null; } else draft.panel = draft.panel === 'share' ? null : 'share';
        paint();
        return;
      }
      if (q('[data-panelclose]')) { draft.panel = null; paint(); return; }
      if ((b = q('[data-pickmethod]'))) {
        if (draft.panel === 'methodTo') draft.toMethodId = b.dataset.pickmethod;
        else draft.methodId = b.dataset.pickmethod;
        if (!showInstallments()) draft.inst = 1;
        draft.panel = null;
        draft.error = '';
        paint();
        return;
      }
      if ((b = q('[data-inst]'))) { draft.inst = Number(b.dataset.inst); paint(); return; }
      if ((b = q('[data-inst-mode]'))) { draft.instMode = b.dataset.instMode; paint(); return; }
      if ((b = q('[data-sharepct]'))) { draft.shareIt = true; draft.sharePct = Number(b.dataset.sharepct); paint(); return; }
      if (q('[data-shareoff]')) { draft.shareIt = false; draft.panel = null; paint(); return; }
      if (q('[data-allcats]')) { draft.showAllCats = !draft.showAllCats; paint(); return; }
      if (q('[data-catback]')) { draft.catGroupExpand = null; paint(); return; }
      if ((b = q('[data-catgroup]'))) { pickCategoryGroup(b.dataset.catgroup); return; }
      if ((b = q('[data-pickid]'))) { draft.categoryId = b.dataset.pickid; draft.showAllCats = false; draft.error = ''; paint(); return; }
      if (q('[data-save]')) { onSave(); }
    }
    function onInput(e) {
      const t = e.target;
      if (t.id === 'tx-note') draft.note = t.value;
      else if (t.id === 'tx-share-pct') {
        const v = Math.min(100, Math.max(0, parseFloat(t.value)));
        if (isFinite(v)) { draft.sharePct = v; draft.shareIt = true; }
      }
    }
    function onChange(e) {
      const t = e.target;
      if (t.id === 'tx-date-input' && t.value) { draft.date = t.value; paint(); }
      else if (t.id === 'tx-share-pct' || t.id === 'tx-note') paint();
    }
    function onKeydown(e) {
      if (e.target.id === 'tx-note' && e.key === 'Enter') { e.preventDefault(); draft.panel = null; paint(); }
    }
    // ⌫ y "Compartido" mantenidos: borrar todo / elegir la proporción.
    let backHeld = false, shareHeld = false, holdTimer = null;
    function onPointerDown(e) {
      const back = e.target.closest('[data-keys] [data-back]');
      const share = e.target.closest('[data-share]');
      if (!back && !share) return;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        if (back) { backHeld = true; pressClear(); }
        else { shareHeld = true; draft.shareIt = true; draft.panel = 'share'; haptic(); paint(); }
      }, 500);
    }
    const cancelHold = () => clearTimeout(holdTimer);

    async function onSave() {
      if (draft._saving) return;
      const fail = (msg) => { draft.error = msg; paint(); };
      const entered = Math.round(finalAmount() * 100) / 100;
      if (!(entered > 0)) return fail('Cargá un monto mayor a 0.');
      if (!draft.methodId) return fail(draft.type === 'transferencia' ? 'Elegí la cuenta de origen.' : 'Elegí una cuenta.');
      if (draft.type === 'transferencia') {
        if (!draft.toMethodId) return fail('Elegí la cuenta de destino.');
        if (draft.toMethodId === draft.methodId) return fail('Elegí dos cuentas distintas para transferir.');
      } else if (!draft.categoryId) {
        return fail('Elegí una categoría.');
      }
      // Con cuotas en modo "es cada cuota", lo tipeado no es el total sino el
      // valor de cada cuota: se multiplica por n para saber el total.
      const n = !editing && showInstallments() ? instN() : 1;
      const amount = (n > 1 && draft.instMode === 'per') ? Math.round(entered * n * 100) / 100 : entered;
      // Buscar la cotización histórica es una llamada de red: evita que un
      // doble toque dispare el guardado dos veces mientras espera.
      draft._saving = true;
      const saveBtn = $('[data-save]', dlg);
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Guardando…'; }
      const note = draft.note || '';
      const wantShare = canShare() && draft.shareIt;
      let createdTxs = [];
      const sharePctVal = Math.min(100, Math.max(0, parseFloat(draft.sharePct || '50')));
      const base = draft.type === 'transferencia'
        ? { date: draft.date, type: draft.type, amount, currency: draft.currency,
            methodId: draft.methodId, toMethodId: draft.toMethodId, note: note.trim() }
        : { date: draft.date, type: draft.type, amount, currency: draft.currency,
            categoryId: draft.categoryId, methodId: draft.methodId, note: note.trim() };
      // Se guarda localmente si el gasto se marcó como compartido con la
      // pareja — el registro "de verdad" vive en Cloud.addSharedExpense() de
      // abajo (sin referencia al id de este movimiento), así que sin esto no
      // había forma de saber después, mirando el detalle de un movimiento
      // viejo, si en su momento se había compartido o no.
      if (wantShare) { base.shared = true; base.sharePct = sharePctVal; }

      if (editing) {
        // El equivalente en USD/ARS queda como estaba si el monto/moneda no
        // cambiaron (para no perder el valor histórico por editar la nota o
        // la categoría); si cambian, se recalcula a la cotización DE LA
        // FECHA del movimiento (no la de hoy).
        // Gasto compartido vinculado (se busca ANTES de modificar el
        // movimiento: para los viejos sin vínculo guardado se reconoce por
        // monto/fecha originales).
        const linkedShared = (!tx.groupId && tx.type === 'gasto') ? linkedSharedExpense(tx) : null;
        const sameAmount = tx.currency === draft.currency && tx.amount === amount;
        base.usdSnapshot = (sameAmount && tx.usdSnapshot != null) ? tx.usdSnapshot : await usdSnapshotForDate(amount, draft.currency, draft.date);
        base.arsSnapshot = (sameAmount && tx.arsSnapshot != null) ? tx.arsSnapshot : await arsSnapshotForDate(amount, draft.currency, draft.date);
        Object.assign(tx, base);
        // Editar el monto, la moneda, la fecha o la nota de un gasto
        // compartido actualiza también el gasto en Compartido.
        if (linkedShared) {
          tx.sharedExpenseId = linkedShared.id;
          const patch = { amount, currency: draft.currency, date: draft.date, note: (note.trim() || null) };
          Cloud.updateSharedExpense(linkedShared.id, patch)
            .then(() => Cloud.listSharedExpenses(shared.household.id))
            .then((list) => { shared.expenses = list; render(); })
            .catch((e) => alert('El movimiento se guardó, pero no se pudo actualizar en Compartido: ' + friendlyCloudError(e)));
        }
        // Si se pagó (o se dejó de pagar) con un ahorro, o cambió de monto/
        // fecha/moneda, el retiro vinculado en ese ahorro se rehace desde
        // cero con los datos finales (ver syncSavingWithdrawalForTx()).
        syncSavingWithdrawalForTx(tx);
        createdTxs = [tx];
      } else {
        createdTxs = [];
        if (n === 1) {
          const newTx = {
            id: Store.uid(), ...base,
            usdSnapshot: await usdSnapshotForDate(amount, draft.currency, draft.date),
            arsSnapshot: await arsSnapshotForDate(amount, draft.currency, draft.date),
          };
          S().transactions.push(newTx);
          createdTxs.push(newTx);
          syncSavingWithdrawalForTx(newTx);
        } else {
          const groupId = Store.uid();
          const per = (draft.instMode === 'per') ? entered : Math.round((amount / n) * 100) / 100;
          const start = parseDate(draft.date);
          for (let k = 1; k <= n; k++) {
            const cuota = (k === n) ? Math.round((amount - per * (n - 1)) * 100) / 100 : per;
            const dk = installmentDate(base.methodId, start, k);
            const dkStr = dateToStr(dk);
            const cuotaTx = {
              id: Store.uid(), ...base, amount: cuota, date: dkStr,
              groupId, installment: { k, n },
              usdSnapshot: await usdSnapshotForDate(cuota, draft.currency, dkStr),
              arsSnapshot: await arsSnapshotForDate(cuota, draft.currency, dkStr),
            };
            S().transactions.push(cuotaTx);
            createdTxs.push(cuotaTx);
          }
        }
      }
      Store.save();

      if (wantShare) {
        try {
          const sharedId = await Cloud.addSharedExpense({
            household_id: shared.household.id, paid_by: sharedMe().id,
            payer_share: sharePctVal / 100, amount, currency: draft.currency,
            date: draft.date, note: note.trim() || null,
          });
          // Vínculo movimiento ↔ gasto compartido: borrar uno borra el otro.
          if (sharedId) {
            for (const t of createdTxs) t.sharedExpenseId = sharedId;
            Store.save();
          }
          shared.expenses = await Cloud.listSharedExpenses(shared.household.id);
        } catch (e) {
          alert('El movimiento se guardó, pero no se pudo avisar a la cuenta compartida: ' + e.message);
        }
      }
      // El movimiento recién guardado se resalta un momento en la lista.
      ui.newTxIds = { ids: new Set(createdTxs.map((t) => t.id)), at: Date.now() };
      await closeSheet(dlg);
      render();
    }

    paint();
    openSheet(dlg, {
      listeners: { click: onClick, input: onInput, change: onChange, keydown: onKeydown,
        pointerdown: onPointerDown, pointerup: cancelHold, pointercancel: cancelHold, pointerleave: cancelHold },
    });
    // Si el hogar compartido todavía no terminó de cargar, se repinta al
    // terminar para que aparezca la opción "compartido".
    if (!editing && Cloud.user() && (!shared.loaded || shared.loading)) {
      loadShared().then(() => {
        if (dlg.open && !partner && sharedPartner()) { partner = sharedPartner(); paint(); }
      }).catch(() => {});
    }
  }

  /* ---------- Panel inferior (sheet) ----------
     Usa el mismo <dialog> de la app (queda en la capa superior, con su
     fondo y el foco atrapado adentro). Sube desde abajo; atrás, la pantalla
     se achica apenas. Se cierra con la X, con Escape o deslizándolo hacia
     abajo (más de 120px, o un gesto rápido). Los listeners que se le pasan
     se sacan solos al cerrarse, así el próximo uso del <dialog> arranca
     limpio. */
  function openSheet(dlg, { listeners = {} } = {}) {
    for (const [ev, fn] of Object.entries(listeners)) dlg.addEventListener(ev, fn);
    const onCancel = (e) => { e.preventDefault(); closeSheet(dlg); };
    dlg.addEventListener('cancel', onCancel);
    // Tocar afuera del panel (el fondo oscuro) es lo mismo que cerrarlo: el
    // toque en el fondo llega al <dialog> mismo, con coordenadas afuera de
    // su rectángulo.
    const onBackdrop = (e) => {
      if (e.target !== dlg) return;
      const r = dlg.getBoundingClientRect();
      if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) closeSheet(dlg);
    };
    dlg.addEventListener('click', onBackdrop);
    const drag = sheetDrag(dlg);
    // El evento "close" llega un instante después de cerrar: si este panel
    // se abrió justo al cerrar otro diálogo (ej. detalle → Editar), ese
    // "close" viejo llega con el panel ya abierto y se ignora.
    const onClose = () => {
      if (dlg.open) return;
      dlg.removeEventListener('close', onClose);
      for (const [ev, fn] of Object.entries(listeners)) dlg.removeEventListener(ev, fn);
      dlg.removeEventListener('cancel', onCancel);
      dlg.removeEventListener('click', onBackdrop);
      drag.off();
      dlg.classList.remove('open');
      dlg.style.transform = '';
      document.body.classList.remove('sheet-behind');
    };
    dlg.addEventListener('close', onClose);
    showModalBase(dlg);
    document.body.classList.add('sheet-behind');
    requestAnimationFrame(() => requestAnimationFrame(() => dlg.classList.add('open')));
  }
  const prefersReducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function closeSheet(dlg) {
    return new Promise((resolve) => {
      if (!dlg.open) { resolve(); return; }
      document.body.classList.remove('sheet-behind');
      if (prefersReducedMotion() || !dlg.classList.contains('open')) { dlg.close(); resolve(); return; }
      dlg.style.transform = '';
      dlg.classList.remove('open');
      let done = false;
      const finish = () => { if (done) return; done = true; if (dlg.open) dlg.close(); resolve(); };
      dlg.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, 450);
    });
  }
  // Arrastrar el panel hacia abajo para cerrarlo: desde la agarradera o el
  // encabezado, o desde el contenido si ya está scrolleado arriba de todo.
  function sheetDrag(dlg) {
    let s = null;
    const down = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const fromTop = e.target.closest('[data-drag], .dialog-head') || e.target === dlg;
      const body = e.target.closest('[data-shbody], .dialog-body');
      if (!fromTop && !(body && body.scrollTop <= 0)) return;
      if (e.target.closest('input, [data-keys]')) return;
      s = { y: e.clientY, x: e.clientX, t: performance.now(), dy: 0, active: false };
    };
    const move = (e) => {
      if (!s) return;
      const dy = e.clientY - s.y, dx = e.clientX - s.x;
      if (!s.active) {
        if (Math.abs(dy) < 8) return;
        if (dy < 0 || Math.abs(dx) > Math.abs(dy)) { s = null; return; }
        s.active = true;
        dlg.classList.add('dragging');
      }
      s.dy = Math.max(0, dy);
      dlg.style.transform = `translateY(${s.dy}px)`;
    };
    let justDragged = false;
    const up = () => {
      if (!s) return;
      const st = s; s = null;
      if (!st.active) return;
      dlg.classList.remove('dragging');
      justDragged = true;
      setTimeout(() => { justDragged = false; }, 0);
      const v = st.dy / Math.max(1, performance.now() - st.t);
      if (st.dy > 120 || v > 0.6) closeSheet(dlg);
      else dlg.style.transform = '';
    };
    // Si el gesto fue un arrastre, el toque no tiene que "apretar" el botón
    // que quedó abajo del dedo al soltar.
    const swallow = (e) => { if (justDragged) { e.stopPropagation(); e.preventDefault(); } };
    dlg.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    dlg.addEventListener('click', swallow, true);
    return {
      off() {
        dlg.removeEventListener('pointerdown', down);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        dlg.removeEventListener('click', swallow, true);
      },
    };
  }

  /* Gasto compartido vinculado a un movimiento propio: el id guardado al
     crearlo o, para los cargados antes de guardar ese vínculo, el gasto del
     hogar que pagaste vos con el mismo monto, moneda y fecha. */
  function linkedSharedExpense(tx) {
    if (!shared.household || !shared.expenses) return null;
    if (tx.sharedExpenseId) return shared.expenses.find((e) => e.id === tx.sharedExpenseId) || null;
    if (!tx.shared || !Cloud.user()) return null;
    const me = sharedMe();
    return shared.expenses.find((e) => e.paid_by === me.id && e.date === tx.date && e.currency === tx.currency
      && Math.abs(Number(e.amount) - Number(tx.amount)) < 0.01) || null;
  }

  /* Borrar un movimiento (o la compra entera, si es una cuota): sale de
     la lista enseguida y aparece un aviso con "Deshacer" durante 5
     segundos, en vez de un diálogo de confirmación. El borrado de verdad
     (guardar, sacar el retiro de ahorro vinculado y el gasto de
     Compartido) se hace al terminar ese tiempo, o antes si se borra otra
     cosa o la app pasa a segundo plano. */
  let pendingDelete = null;
  function deleteTx(tx) {
    flushPendingDelete();
    const group = tx.groupId ? S().transactions.filter((t) => t.groupId === tx.groupId) : [tx];
    const ids = new Set(group.map((t) => t.id));
    const removed = group.map((t) => ({ t, idx: S().transactions.indexOf(t) })).sort((a, b) => a.idx - b.idx);
    // El gasto de Compartido se busca ahora, mientras el movimiento existe.
    const linked = tx.groupId ? null : linkedSharedExpense(tx);
    S().transactions = S().transactions.filter((t) => !ids.has(t.id));
    pendingDelete = { removed, linked, timer: setTimeout(flushPendingDelete, 5000) };
    render();
    const msg = group.length > 1 ? `Se borró la compra en ${group.length} cuotas`
      : linked ? 'Se borró el movimiento (también de Compartido)' : 'Se borró el movimiento';
    showToast(msg, { action: 'Deshacer', onAction: undoDelete, duration: 5000 });
  }
  function undoDelete() {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timer);
    const arr = S().transactions;
    for (const { t, idx } of pendingDelete.removed) arr.splice(Math.min(idx, arr.length), 0, t);
    pendingDelete = null;
    render();
  }
  function flushPendingDelete() {
    if (!pendingDelete) return;
    const { removed, linked, timer } = pendingDelete;
    clearTimeout(timer);
    pendingDelete = null;
    for (const { t } of removed) removeLinkedSavingEntry(t.id);
    Store.save();
    if (linked) {
      Cloud.deleteSharedExpense(linked.id)
        .then(() => Cloud.listSharedExpenses(shared.household.id))
        .then((list) => { shared.expenses = list; render(); })
        .catch((e) => alert('El movimiento se borró, pero no se pudo borrar de Compartido: ' + friendlyCloudError(e)));
    }
    hideToast();
    render();
  }

  /* Borra un elemento de una lista del estado (medios, presupuestos,
     fijos) y ofrece "Deshacer" durante 5 segundos, que lo vuelve a poner
     en el mismo lugar. */
  function removeWithUndo(key, item, msg) {
    flushPendingDelete();
    const idx = S()[key].indexOf(item);
    if (idx < 0) return;
    S()[key] = S()[key].filter((x) => x !== item);
    Store.save();
    render();
    showToast(msg, {
      action: 'Deshacer', duration: 5000,
      onAction: () => {
        const arr = S()[key];
        arr.splice(Math.min(idx, arr.length), 0, item);
        Store.save();
        render();
      },
    });
  }

  /* Aviso breve abajo (arriba de la barra inferior), con una acción
     opcional como "Deshacer". */
  let toastTimer = null;
  function showToast(text, { action, onAction, duration = 4000 } = {}) {
    hideToast();
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
    if (action) $('button', t).addEventListener('click', () => { hideToast(); onAction(); });
    document.body.appendChild(t);
    toastTimer = setTimeout(hideToast, duration);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    $$('.toast').forEach((x) => x.remove());
  }

  /* Panel inferior genérico: agarradera, X, título, un ícono de acción
     opcional arriba a la derecha (ej. borrar), el contenido y a lo sumo un
     botón primario abajo. onClick recibe los toques del contenido. */
  function openPanel({ title, subtitle, body, primary, action, onClick }) {
    const dlg = $('#dialog');
    dlg.className = 'sheet sheet-panel';
    dlg.innerHTML = `
      <div class="sh-top" data-drag>
        <div class="grab" aria-hidden="true"></div>
        <div class="sh-h">
          <button type="button" class="icb" data-close aria-label="Cerrar">${spriteIcon('x')}</button>
          <div class="sh-title"><h2>${esc(title)}</h2>${subtitle ? `<div class="sh-sub">${esc(subtitle)}</div>` : ''}</div>
          ${action ? `<button type="button" class="icb${action.danger ? ' icb-danger' : ''}" data-action aria-label="${esc(action.label)}">${action.icon}</button>` : '<span></span>'}
        </div>
      </div>
      <div class="sh-body" data-shbody>${body}</div>
      <div class="savebar${primary ? '' : ' savebar-empty'}">${primary ? `<button type="button" class="btn btn-primary btn-full btn-save" data-primary>${esc(primary.label)}</button>` : ''}</div>`;
    const click = (e) => {
      if (e.target.closest('[data-close]')) { closeSheet(dlg); return; }
      if (action && e.target.closest('[data-action]')) { closeSheet(dlg).then(action.onClick); return; }
      if (primary && e.target.closest('[data-primary]')) { primary.onClick(dlg); return; }
      if (onClick) onClick(e, dlg);
    };
    openSheet(dlg, { listeners: { click } });
    return dlg;
  }


  /* Diálogo de solo lectura con el resumen de un movimiento (fecha,
     categoría, cuenta, cotización usada en ese momento, si se compartió con
     la pareja, etc.) — tocar una fila en Movimientos abría directo el
     formulario de edición con la calculadora, sin mostrar antes un detalle
     legible. El TC se deriva del snapshot cruzado guardado al cargar el
     movimiento (con la cotización DEL DÍA), no de la cotización actual:
     usdSnapshot para uno cargado en ARS, arsSnapshot para uno en USD. */
  function txDetailDialog(tx) {
    const isTransfer = tx.type === 'transferencia';
    const isIncome = tx.type === 'ingreso';
    const sign = isTransfer ? '' : (isIncome ? '+ ' : '− ');
    const amtClass = isTransfer ? '' : (isIncome ? 'pos' : 'neg');
    const isUSD = tx.currency === 'USD';
    const crossAmount = isUSD ? tx.arsSnapshot : (tx.currency === 'ARS' ? tx.usdSnapshot : null);
    const crossCur = isUSD ? 'ARS' : 'USD';
    const crossLine = crossAmount != null
      ? `<div class="usd">≈ ${esc(fmtMoney(crossAmount, crossCur))}</div>` : '';
    let tcValue = null;
    if (tx.currency === 'ARS' && tx.usdSnapshot > 0) tcValue = tx.amount / tx.usdSnapshot;
    else if (isUSD && tx.arsSnapshot > 0) tcValue = tx.arsSnapshot / tx.amount;
    const tcLine = tcValue != null
      ? `<div class="tx-detail-row"><span class="tx-row-label">TC del momento</span><span class="tx-row-value">${esc(fmtMoney(tcValue, 'ARS'))} / USD</span></div>` : '';
    const whoRows = isTransfer
      ? `<div class="tx-detail-row"><span class="tx-row-label">Desde</span><span class="tx-row-value">${esc(methodName(tx.methodId))}</span></div>
         <div class="tx-detail-row"><span class="tx-row-label">Hacia</span><span class="tx-row-value">${esc(methodName(tx.toMethodId))}</span></div>`
      : `<div class="tx-detail-row"><span class="tx-row-label">Categoría</span><span class="tx-row-value">${esc(catName(tx.categoryId))}</span></div>
         <div class="tx-detail-row"><span class="tx-row-label">Cuenta</span><span class="tx-row-value">${esc(methodName(tx.methodId))}</span></div>`;
    const instRow = tx.installment
      ? `<div class="tx-detail-row"><span class="tx-row-label">Cuotas</span><span class="tx-row-value">${tx.installment.k} de ${tx.installment.n}</span></div>` : '';
    const origin = tx.recurringId ? 'Gasto fijo' : (tx.leftoverGen ? 'Sobrante del mes anterior' : '');
    const originRow = origin
      ? `<div class="tx-detail-row"><span class="tx-row-label">Origen</span><span class="tx-row-value">${esc(origin)}</span></div>` : '';
    const sharedRow = tx.shared
      ? `<div class="tx-detail-row"><span class="tx-row-label">Compartido</span><span class="tx-row-value">Sí${tx.sharePct != null ? ` · te quedás ${tx.sharePct}%` : ''}</span></div>` : '';
    const noteRow = tx.note
      ? `<div class="tx-detail-row"><span class="tx-row-label">Nota</span><span class="tx-row-value">${esc(tx.note)}</span></div>` : '';

    const bodyHTML = `
      <div class="tx-detail-amount">
        <div class="v ${amtClass}">${sign}${fmtMoney(tx.amount, tx.currency)}</div>
        ${crossLine}
      </div>
      <div class="tx-detail-row"><span class="tx-row-label">Fecha</span><span class="tx-row-value">${esc(fmtDateFull(tx.date))}</span></div>
      ${whoRows}
      ${tcLine}
      ${instRow}
      ${originRow}
      ${sharedRow}
      ${noteRow}`;

    const titles = { gasto: 'Detalle del gasto', ingreso: 'Detalle del ingreso', transferencia: 'Detalle de la transferencia' };
    openPanel({
      title: titles[tx.type] || 'Detalle',
      body: `<div class="tx-detail">${bodyHTML}</div>`,
      primary: { label: 'Editar', onClick: (dlg) => closeSheet(dlg).then(() => txForm(tx)) },
      action: { icon: iconSvg('trash'), label: 'Eliminar', danger: true, onClick: () => deleteTx(tx) },
    });
  }

  /* ================= Vista: Resumen ================= */
  const INSIGHT_COLOR = { neg: 'var(--neg)', warn: 'var(--warn)', good: 'var(--brand-text)', info: 'var(--t2)' };
  // Saldo grande de Inicio: "$" chico y el número (que anima su cambio,
  // ver animateHeroBalance()).
  function heroBigHTML(n) {
    const sym = disp() === 'USD' ? 'US$' : '$';
    return `<small>${sym}</small><span class="money">${n < 0 ? '−' : ''}<span class="hero-amount-int">${esc(nfHero.format(Math.abs(n)))}</span></span>`;
  }
  // Tasa de ahorro por mes: línea suave con marcadores, degradé verde
  // debajo, grilla cada 25% (de 0 a 75% como mínimo) y el mes elegido
  // destacado con una pastilla. rows: [{label, rate, isSel}].
  let rateChartSeq = 0;
  function savingsRateChartSvg(rows) {
    const G = Charts.g;
    const W = 320, H = 140, x0 = 44, x1 = 290, yTop = 18, yBase = 112;
    const rates = rows.map((r) => r.rate);
    // El techo es 5 puntos arriba del máximo que se lee (así la curva usa
    // todo el alto); la grilla va en pasos redondos, de 3 a 5 líneas.
    const hi = Math.max(5, Math.max(...rates) + 5);
    const minR = Math.min(...rates);
    const step = [5, 10, 20, 25, 50, 100].find((st) => (hi - Math.min(0, minR)) / st <= 4) || 100;
    const lo = Math.min(0, Math.floor(minR / step) * step);
    const ticks = [];
    for (let v = lo; v <= hi; v += step) ticks.push(v);
    const x = rows.length > 1 ? G.escala([0, rows.length - 1], [x0, x1]) : () => (x0 + x1) / 2;
    const y = G.escala([lo, hi], [yBase, yTop]);
    const pts = rows.map((r, i) => [x(i), y(r.rate)]);
    const selFound = rows.findIndex((r) => r.isSel);
    const selIdx = selFound >= 0 ? selFound : rows.length - 1;
    const id = `gAh${++rateChartSeq}`;
    const baseY = y(Math.max(lo, 0));
    const labels = rows.map((r, i) => {
      const [px, py] = pts[i];
      if (i === selIdx) {
        const txt = `${r.rate}%`;
        const w = 12 + txt.length * 7.5;
        const ty = py - 28 < 2 ? py + 10 : py - 28;
        return `<rect x="${(px - w / 2).toFixed(1)}" y="${ty.toFixed(1)}" width="${w.toFixed(1)}" height="19" rx="9.5" style="fill:var(--brand)"/>
          <text x="${px.toFixed(1)}" y="${(ty + 13.5).toFixed(1)}" text-anchor="middle" class="g-pill">${txt}</text>`;
      }
      return `<text x="${px.toFixed(1)}" y="${(py - 12).toFixed(1)}" text-anchor="middle" class="g-lab">${r.rate}%</text>`;
    }).join('');
    const months = rows.map((r, i) => `<text x="${pts[i][0].toFixed(1)}" y="132" text-anchor="middle"${i === selIdx ? ' class="g-sel"' : ''}>${esc(r.label)}</text>`).join('');
    const aria = `Tasa de ahorro: ${rows.map((r) => `${r.label} ${r.rate}%`).join(', ')}`;
    return `<svg class="gchart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(aria)}">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--brand);stop-opacity:.32"/><stop offset="1" style="stop-color:var(--brand);stop-opacity:0"/></linearGradient></defs>
      ${G.grillaY(ticks, y, 34, 312, (v) => `${v}%`)}
      ${pts.length > 1 ? `<path d="${G.areaSuave(pts, baseY)}" style="fill:url(#${id})"/>
      <path d="${G.lineaSuave(pts)}" fill="none" stroke-width="2.5" stroke-linecap="round" style="stroke:var(--brand)"/>` : ''}
      ${pts.map((p, i) => (i === selIdx ? `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="10" style="fill:var(--brand);opacity:.18"/>` : '') + G.marcador(p[0], p[1], 'var(--brand)', i === selIdx)).join('')}
      ${labels}${months}
    </svg>`;
  }

  function vResumen(el) {
    const mk = ui.month;
    const txs = S().transactions;
    // "Balance del mes" (y todo lo que se deriva de él: los tres tiles de
    // arriba, sus variaciones MoM, el anillo y el aviso de rojo) es lo
    // ÚNICO que respeta el ajuste "contar tarjetas por vencimiento" — ver
    // effectiveMonthOf(). Todo lo demás en esta vista (gastos por
    // categoría, tendencia de 6 meses) usa la fecha real de carga
    // (inMonthCal/inPrevCal más abajo), igual que "Balance por día".
    const inMonth = txs.filter((t) => effectiveMonthOf(t) === mk);
    const prevMk = addMonthsKey(mk, -1);
    const inPrev = txs.filter((t) => effectiveMonthOf(t) === prevMk);
    const inMonthCal = txs.filter((t) => monthKeyOf(t.date) === mk);
    const inPrevCal = txs.filter((t) => monthKeyOf(t.date) === prevMk);

    const inc = sumDisp(inMonth.filter((t) => t.type === 'ingreso'));
    const exp = sumDisp(inMonth.filter((t) => t.type === 'gasto'));
    const incPrev = sumDisp(inPrev.filter((t) => t.type === 'ingreso'));
    const expPrev = sumDisp(inPrev.filter((t) => t.type === 'gasto'));

    // Ahorros: no el total acumulado histórico, sino lo aportado (neto de
    // retiros) durante ESE mes puntual — es la diferencia entre el total
    // acumulado al final del mes y al final del mes anterior. Usar el
    // total acumulado directo rompería "Balance del mes" (se iría cada vez
    // más negativo con los meses, aunque no cambie el ritmo de ahorro).
    const totalSavings = savingsAtEndOf(mk, { excludeOpening: true });
    const totalSavingsPrev = savingsAtEndOf(prevMk, { excludeOpening: true });
    const savingsMonth = totalSavings - totalSavingsPrev;
    const savingsMonthPrev = totalSavingsPrev - savingsAtEndOf(addMonthsKey(mk, -2), { excludeOpening: true });

    // El dinero que se destina a ahorro ese mes deja de estar disponible,
    // así que resta del balance del mes igual que un gasto (un retiro de
    // ahorros, en cambio, sería un aporte negativo y sumaría).
    const balance = inc - exp - savingsMonth;

    // Tasa de ahorro del mes: qué % de los ingresos terminó ahorrado (puede
    // ser negativa si el aporte del mes fue un retiro). Sin ingresos ese mes
    // el % no tiene una base válida.
    const savingsRatePct = inc > 0 ? Math.round((savingsMonth / inc) * 100) : null;
    const savingsRatePctPrev = incPrev > 0 ? Math.round((savingsMonthPrev / incPrev) * 100) : null;
    const monthName = (m) => {
      const [y, mo] = m.split('-').map(Number);
      return new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(new Date(y, mo - 1, 1));
    };
    const isCurMonth = mk === curMonth();
    const todayDay = new Date().getDate();
    // Comparaciones contra el MISMO DÍA del mes anterior (no contra el mes
    // anterior completo) mientras el mes elegido está en curso: el 19 de
    // octubre se compara con lo que había al 19 de septiembre.
    const upToToday = (dateStr) => !isCurMonth || Number(dateStr.slice(8, 10)) <= todayDay;

    // Gastos por categoría — por fecha real de carga, no por el mes de
    // vencimiento (ver comentario al principio de la función). El % es
    // sobre el TOTAL del mes, el mismo que muestra Categorías.
    const byCat = new Map();
    for (const t of inMonthCal.filter((x) => x.type === 'gasto' && upToToday(x.date))) {
      const v = txDispAmount(t);
      if (v == null) continue;
      const topId = topCategoryOf(t.categoryId);
      byCat.set(topId, (byCat.get(topId) || 0) + v);
    }
    const catRanked = [...byCat.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const catTotal = catRanked.reduce((a, [, v]) => a + v, 0);
    const CAT_TOP = 4;
    const catRows = catRanked.slice(0, CAT_TOP).map(([id, value]) => ({ id, name: catName(id), value, color: catColor(id) }));
    const catRest = catRanked.slice(CAT_TOP);
    if (catRest.length) {
      catRows.push({ id: null, name: `Otras ${catRest.length}`, value: catRest.reduce((a, [, v]) => a + v, 0), color: OTROS_COLOR });
    }
    const pctOf = (v) => (catTotal > 0 ? Math.round((v / catTotal) * 100) : 0);

    // "Para tener en cuenta": avisos de una línea a partir de reglas simples
    // (heurísticas sobre los datos, nada de IA). Solo para el mes EN CURSO:
    // uno pasado ya está cerrado y uno futuro no tiene datos.
    const insights = !isCurMonth ? [] : (() => {
      const out = [];
      // QUÉ avisos aparecen se decide siempre en PESOS, sin importar la
      // moneda elegida arriba (un umbral pensado en pesos no sirve en
      // dólares, y cada moneda valúa a la cotización de su fecha). Los
      // montos del texto sí van en la moneda elegida.
      const BASE = 'ARS';
      const amtA = (t) => amountInCurrency(t, BASE);
      const sumA = (list) => list.reduce((acc, t) => { const v = amtA(t); return v == null ? acc : acc + v; }, 0);
      const incA = sumA(inMonth.filter((t) => t.type === 'ingreso'));
      const expA = sumA(inMonth.filter((t) => t.type === 'gasto'));
      const savA = (m) => savingsAtEndOf(m, { excludeOpening: true, cur: BASE });
      const savMonthA = savA(mk) - savA(prevMk);
      const balanceA = incA - expA - savMonthA;
      const prevName = monthName(prevMk);

      // Fecha REAL de cada movimiento (no el mes de vencimiento de la
      // tarjeta), igual que Categorías y Presupuestos.
      const gastoCal = inMonthCal.filter((t) => t.type === 'gasto');
      const gastoPrevCal = inPrevCal.filter((t) => t.type === 'gasto');
      const gastoPrevSameDay = gastoPrevCal.filter((t) => upToToday(t.date));

      if (balanceA < 0) {
        out.push({ tone: 'neg', severity: 6, icon: 'down', go: 'movimientos',
          title: 'Este mes vas en rojo', sub: `Gastaste ${fmtPlain(Math.abs(balance))} más de lo que entró`, money: true });
      }

      // En la moneda del propio presupuesto (no depende de la elegida arriba).
      const budgetHits = S().budgets.map((b) => {
        const list = gastoCal.filter((t) => txMatchesBudgetCategory(t, b.categoryId));
        const spentOwn = list.reduce((acc, t) => acc + (amountInCurrency(t, b.currency) || 0), 0);
        return {
          name: catName(b.categoryId), spent: sumDisp(list), limit: convOrNull(b.amount, b.currency),
          overRatio: b.amount > 0 ? spentOwn / b.amount - 1 : 0,
        };
      }).filter((x) => x.overRatio > 0).sort((a, b) => b.overRatio - a.overRatio);
      if (budgetHits.length) {
        const w = budgetHits[0];
        out.push({ tone: 'neg', severity: 5, icon: 'target', go: 'presupuestos',
          title: `Pasaste el presupuesto de ${w.name}`, sub: `${fmtPlain(w.spent)} de ${fmtPlain(w.limit)}`, money: true });
      }

      // Un gasto fijo (recurrente o una cuota) es el mismo te portes como te
      // portes, así que estos dos avisos comparan solo lo variable.
      const isVar = (t) => !t.recurringId && !t.installment;
      const varCal = gastoCal.filter(isVar);
      const varPrevCal = gastoPrevCal.filter(isVar);
      const varExpA = sumA(varCal), varExpPrevA = sumA(varPrevCal);
      if (varExpPrevA > 0 && varExpA > varExpPrevA) {
        const left = daysLeftInMonth(mk);
        out.push({ tone: 'neg', severity: 4, icon: 'up', go: 'movimientos',
          title: `Ya gastaste más que en todo ${prevName}`,
          sub: `Sin contar fijos, y quedan ${left} día${left === 1 ? '' : 's'}` });
      }

      // La categoría que más subió contra el mismo día del mes anterior.
      const byCatA = (list) => {
        const m = new Map();
        for (const t of list) {
          const topId = topCategoryOf(t.categoryId);
          const cur = m.get(topId) || { a: 0, d: 0 };
          cur.a += amtA(t) || 0;
          cur.d += txDispAmount(t) || 0;
          m.set(topId, cur);
        }
        return m;
      };
      const nowByCat = byCatA(gastoCal);
      const prevByCat = byCatA(gastoPrevSameDay);
      let worstCat = null;
      for (const [id, val] of nowByCat.entries()) {
        const prevVal = prevByCat.get(id) || { a: 0, d: 0 };
        const diffA = val.a - prevVal.a;
        if (prevVal.a <= 0 || diffA <= 0) continue;
        const pct = diffA / prevVal.a;
        // Umbral doble (% Y monto mínimo, en pesos) para no avisar por una
        // categoría chica que pasó de $500 a $1.000.
        if (pct >= 0.3 && diffA >= Math.max(3000, incA * 0.02)) {
          if (!worstCat || diffA > worstCat.diffA) worstCat = { id, diffA, diffD: val.d - prevVal.d, pct };
        }
      }
      if (worstCat) {
        out.push({ tone: 'neg', severity: 3, icon: 'up', go: 'categorias', catId: worstCat.id,
          title: `${catName(worstCat.id)} subió ${Math.round(worstCat.pct * 100)}%`,
          sub: `${fmtPlain(Math.max(0, worstCat.diffD))} más que al ${todayDay} de ${prevName}`, money: true });
      }

      // Tasa de ahorro: siempre informa; avisa si bajó mucho.
      if (savingsRatePct != null) {
        const dropped = savingsRatePctPrev != null && savingsRatePct < savingsRatePctPrev - 10;
        const improved = savingsRatePctPrev != null && savingsRatePct > savingsRatePctPrev + 5;
        out.push({
          tone: dropped ? 'warn' : improved ? 'good' : 'info', severity: dropped ? 2 : 0.5,
          icon: dropped ? 'down' : 'dollar', go: 'ahorros',
          title: savingsRatePct >= 0 ? `Ahorraste el ${savingsRatePct}% de lo que entró` : `Sacaste de ahorros el ${-savingsRatePct}% de lo que entró`,
          sub: savingsRatePctPrev != null ? `En ${prevName} fue ${savingsRatePctPrev}%` : '',
        });
      }

      // Una línea por tarjeta de crédito con cómo viene su resumen en curso
      // (el mismo análisis que "Cómo vengo", que se abre al tocarla).
      const short = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
      for (const card of S().methods.filter((m) => m.kind === 'credito')) {
        const A = cardAnalysis(card);
        if (!A || ((A.spent + A.committed) <= 0 && !A.ref)) continue;
        const v = A.verdict;
        const closeS = short(A.cy.close);
        if (!v) {
          out.push({ tone: 'info', severity: 0.4, icon: 'card', cardId: card.id,
            title: `${card.name}: resumen en curso`, sub: `Llevás ${fmtPlain(A.spent + A.committed)} · cierra el ${closeS}`, money: true });
        } else if (v.tone === 'crit') {
          out.push({ tone: 'neg', severity: 4.5, icon: 'card', cardId: card.id,
            title: `${card.name} ya superó ${A.refLabel}`, sub: `${fmtPlain(-v.room)} de más · cierra el ${closeS}`, money: true });
        } else if (v.tone === 'warn') {
          out.push({ tone: 'warn', severity: 2.5, icon: 'card', cardId: card.id,
            title: `Ojo con ${card.name}`, sub: `Al ritmo actual llegás ${A.refLabel.startsWith('el ') ? 'al ' + A.refLabel.slice(3) : 'a ' + A.refLabel} el ${short(v.hit)}` });
        } else {
          out.push({ tone: 'good', severity: 1, icon: 'check', cardId: card.id,
            title: `${card.name} viene bien`, sub: `Cerrarías el ${closeS} en ${fmtPlain(A.projected)}`, money: true });
        }
      }

      // Si no hay nada que avisar, una línea buena contra el mismo día del
      // mes anterior.
      const expPrevSameDayA = sumA(gastoPrevSameDay);
      if (!out.some((x) => x.tone === 'neg' || x.tone === 'warn') && expPrevSameDayA > 0 && sumA(gastoCal) < expPrevSameDayA * 0.9) {
        out.push({ tone: 'good', severity: 1.5, icon: 'check', go: 'categorias',
          title: `Gastaste ${Math.round((1 - sumA(gastoCal) / expPrevSameDayA) * 100)}% menos que en ${prevName}`,
          sub: `Al día ${todayDay} de cada mes` });
      }
      return out.sort((a, b) => b.severity - a.severity).slice(0, 3);
    })();

    // Tasa de ahorro de los últimos 6 meses (hasta el elegido), salvo los
    // que no tuvieron ingresos (sin ingresos el % no tiene base).
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(addMonthsKey(mk, -i));
    const savingsRateRows = months.map((m) => {
      const incM = sumDisp(txs.filter((t) => monthKeyOf(t.date) === m && t.type === 'ingreso'));
      const savM = savingsAtEndOf(m, { excludeOpening: true }) - savingsAtEndOf(addMonthsKey(m, -1), { excludeOpening: true });
      const [y, mo] = m.split('-').map(Number);
      return {
        label: monthShortFmt.format(new Date(y, mo - 1, 1)).replace('.', ''),
        incM, rate: incM > 0 ? Math.round((savM / incM) * 100) : null, isSel: m === mk,
      };
    }).filter((r) => r.incM > 0);
    const rateDiff = savingsRatePct != null && savingsRatePctPrev != null ? savingsRatePct - savingsRatePctPrev : null;

    const pctLeft = (exp <= 0 && savingsMonth <= 0) ? 100 : (inc > 0 ? Math.max(0, Math.min(100, Math.round((balance / inc) * 100))) : 0);
    const pctMonthLeft = monthLeftPct(mk);
    const daysLeft = daysLeftInMonth(mk);
    const [mkY, mkM] = mk.split('-').map(Number);
    const daysInMk = new Date(mkY, mkM, 0).getDate();
    // Cuánto se puede gastar por día sin pasarse del saldo: solo para el
    // mes en curso, con el día de hoy incluido (el último día no divide por 0).
    const perDayLeft = isCurMonth ? balance / Math.max(1, daysLeft) : null;

    // Variaciones de los tres números de abajo, solo en % (sin "MoM"). Con
    // el mes en curso, contra el mismo día del mes anterior.
    const inPrevSameDay = inPrev.filter((t) => upToToday(paymentDateOf(t)));
    const incPrevCmp = sumDisp(inPrevSameDay.filter((t) => t.type === 'ingreso'));
    const expPrevCmp = sumDisp(inPrevSameDay.filter((t) => t.type === 'gasto'));
    const deltaHTML = (cur, prev, upIsGood) => {
      if (!(prev > 0)) return '<span class="dl">&nbsp;</span>';
      const diff = cur - prev;
      const pctLabel = fmtVarPct((diff / prev) * 100);
      if (pctLabel == null) return '<span class="dl t3">= igual</span>';
      const up = diff > 0;
      return `<span class="dl ${(up === upIsGood) ? 'bt' : 'neg'}">${up ? '▲' : '▼'} ${pctLabel}%</span>`;
    };
    const savDeltaHTML = (() => {
      const diff = savingsMonth - savingsMonthPrev;
      if (Math.abs(diff) < 1) return savingsMonthPrev ? '<span class="dl t3">= igual</span>' : '<span class="dl">&nbsp;</span>';
      const up = diff > 0;
      const label = savingsMonthPrev > 0 ? `${fmtVarPct((diff / savingsMonthPrev) * 100) || '0'}%` : 'nuevo';
      return `<span class="dl ${up ? 'bt' : 'neg'}">${up ? '▲' : '▼'} ${label}</span>`;
    })();

    // Detalle de cada número de arriba (Ingresos, Gastos, Ahorros) en un
    // panel. En Gastos se separan los resúmenes de tarjeta que caen en el
    // mes de los gastos corrientes (débito, efectivo, billeteras).
    const homeDetail = (kind) => {
      const chev = spriteIcon('cr').replace('class="ic"', 'class="ic chev"');
      const shortDate = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
      const groups = []; // { title, rows: [{ icon, color, name, sub, value, txs, go }] }
      let total = 0, title = '', note = '';
      if (kind === 'gasto') {
        title = 'Gastos';
        total = exp;
        const list = inMonth.filter((t) => t.type === 'gasto');
        const cards = [], cur = new Map();
        const byVto = S().settings.cardMonthBasis === 'vencimiento';
        for (const m of S().methods.filter((x) => x.kind === 'credito')) {
          const txsM = list.filter((t) => t.methodId === m.id);
          if (!txsM.length) continue;
          const dues = [...new Set(txsM.map((t) => paymentDateOf(t)))].sort();
          cards.push({ icon: iconSvg(methodIconName(m.id)), color: KIND_COLOR.credito, name: m.name,
            sub: byVto && cardCycle(m) ? `Resumen que vence el ${shortDate(parseDate(dues[dues.length - 1]))}` : 'Compras del mes',
            value: sumDisp(txsM), txs: txsM });
        }
        for (const t of list) {
          const m = methodById(t.methodId);
          if (m && m.kind === 'credito') continue;
          const k = m ? m.id : (isSavingMethod(t.methodId) ? t.methodId : '__sin');
          if (!cur.has(k)) cur.set(k, []);
          cur.get(k).push(t);
        }
        const curRows = [...cur.entries()].map(([id, txsM]) => ({
          icon: id === '__sin' ? spriteIcon('more') : iconSvg(methodIconName(id)),
          color: (methodById(id) && KIND_COLOR[methodById(id).kind]) || OTROS_COLOR,
          name: id === '__sin' ? 'Sin medio de pago' : methodName(id), sub: `${txsM.length} movimiento${txsM.length === 1 ? '' : 's'}`,
          value: sumDisp(txsM), txs: txsM,
        })).sort((a, b) => b.value - a.value);
        if (cards.length) groups.push({ title: byVto ? 'Tarjetas · resúmenes del mes anterior' : 'Tarjetas de crédito', rows: cards });
        if (curRows.length) groups.push({ title: 'Gastos corrientes del mes', rows: curRows });
      } else if (kind === 'ingreso') {
        title = 'Ingresos';
        total = inc;
        const byCatI = new Map();
        for (const t of inMonth.filter((x) => x.type === 'ingreso')) {
          const k = topCategoryOf(t.categoryId) || '__sin';
          if (!byCatI.has(k)) byCatI.set(k, []);
          byCatI.get(k).push(t);
        }
        groups.push({ title: 'Por categoría', rows: [...byCatI.entries()].map(([id, txsC]) => ({
          icon: id === '__sin' ? spriteIcon('more') : iconSvg(categoryIconName(id)), color: id === '__sin' ? OTROS_COLOR : catColor(id),
          name: id === '__sin' ? 'Sin categoría' : catName(id), sub: `${txsC.length} movimiento${txsC.length === 1 ? '' : 's'}`,
          value: sumDisp(txsC), txs: txsC,
        })).sort((a, b) => b.value - a.value) });
      } else {
        title = 'Ahorros';
        total = savingsMonth;
        const first = `${mk}-01`, cutoff = `${addMonthsKey(mk, 1)}-01`;
        const rows = S().savings.map((sv) => {
          const es = sv.entries.filter((e) => !e.opening && e.date >= first && e.date < cutoff);
          const value = es.reduce((a, e) => a + (savingEntryAmountIn(sv, e, disp()) || 0), 0);
          return { icon: spriteIcon('wallet'), color: 'var(--c-super)', name: sv.name,
            sub: `${es.length} movimiento${es.length === 1 ? '' : 's'} en ${monthName(mk)}`, value, go: true, n: es.length };
        }).filter((r) => r.n);
        if (rows.length) groups.push({ title: 'Por cuenta de ahorro', rows });
        if (inc > 0) note = `Ahorraste el ${Math.round((savingsMonth / inc) * 100)}% de lo que entró en ${monthName(mk)}.`;
      }
      const flat = groups.flatMap((g) => g.rows);
      const body = `
        <div class="dt-total"><span class="t2">Total de ${esc(monthName(mk))}</span><span class="num dt-big">${fmtDisp(total)}</span></div>
        ${note ? `<p class="t2 dt-note">${esc(note)}</p>` : ''}
        ${groups.map((g) => `
          <h3 class="ovl dt-h">${esc(g.title)}<span class="num">${fmtDisp(g.rows.reduce((a, r) => a + r.value, 0))}</span></h3>
          <div class="dt-list">${g.rows.map((r) => `
            <button type="button" class="dt-row" data-dtrow="${flat.indexOf(r)}">
              <span class="cic" style="--c:${r.color}">${r.icon}</span>
              <div class="row-main"><div class="tt">${esc(r.name)}</div><div class="st">${esc(r.sub)}</div></div>
              <span class="num">${fmtDisp(r.value)}</span>${chev}
            </button>`).join('')}</div>`).join('')}
        ${flat.length ? '' : '<div class="empty">Sin movimientos este mes.</div>'}`;
      openPanel({
        title, subtitle: monthName(mk).replace(/^./, (c) => c.toUpperCase()), body,
        onClick(e, dlg) {
          const b = e.target.closest('[data-dtrow]');
          if (!b) return;
          const r = flat[Number(b.dataset.dtrow)];
          if (r.go) { closeSheet(dlg).then(() => { ui.view = 'ahorros'; render(); }); return; }
          closeSheet(dlg).then(() => methodPeriodDetailDialog(`${r.name} · ${monthName(mk)}`, r.txs));
        },
      });
    };

    // Compartido en una fila neutra (deber plata no es un error).
    const me = Cloud.user() ? sharedMe() : null;
    const sharedPartnerM = Cloud.user() ? sharedPartner() : null;
    const sharedRow = (shared.household && sharedPartnerM) ? (() => {
      const bal = sharedBalance();
      const who = partnerLabel(sharedPartnerM);
      const title = Math.abs(bal) < 0.01 ? 'Están a mano' : (bal > 0 ? `${who} te debe` : `Le debés a ${who}`);
      const nMonth = (shared.expenses || []).filter((e) => e.date && monthKeyOf(e.date) === mk).length;
      return `
      <button type="button" class="group home-shared" data-goto-shared>
        <div class="row">
          <span class="avs" aria-hidden="true">
            <span class="av" style="background:var(--c-tel)">${esc(initials(partnerLabel(me)))}</span><span class="av" style="background:var(--c-super)">${esc(initials(who))}</span>
          </span>
          <div class="row-main"><div class="tt">${esc(title)}</div><div class="st">${esc(shared.household.name || 'Hogar compartido')} · ${nMonth} gasto${nMonth === 1 ? '' : 's'} en común este mes</div></div>
          ${Math.abs(bal) < 0.01 ? '' : `<span class="num home-shared-amt">${money(Math.abs(bal))}</span>`}
          ${spriteIcon('cr').replace('class="ic"', 'class="ic chev"')}
        </div>
      </button>`;
    })() : '';

    // Anillo doble: afuera el % de balance, adentro el % del mes que falta.
    const ringSvg = (() => {
      const arc = (r, w, pct, color) => {
        const c = 2 * Math.PI * r;
        const p = Math.max(0, Math.min(100, pct)) / 100;
        return `<circle cx="60" cy="60" r="${r}" stroke-width="${w}" style="stroke:var(--s2)"/>
          ${p > 0 ? `<circle cx="60" cy="60" r="${r}" stroke-width="${w}" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" style="stroke:${color}"/>` : ''}`;
      };
      return `<svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true"><g transform="rotate(-90 60 60)" fill="none" stroke-linecap="round">
        ${arc(54, 9, pctLeft, 'var(--brand)')}${arc(42, 7, pctMonthLeft, 'var(--c-super)')}</g></svg>`;
    })();
    const ringLabel = `Balance ${pctLeft}%, quedan ${daysLeft} de ${daysInMk} días${perDayLeft != null ? `, podés gastar ${fmtPlain(perDayLeft)} por día` : ''}`;

    el.innerHTML = `
      <div class="hero2">
        <div class="hz-body">
          <div class="saldo-row">
            <div class="saldo-main">
              <span class="ovl">Saldo</span>
              <div class="big num ${balance < 0 ? 'neg' : 'bt'} hero-value" data-balance="${balance}" data-balance-key="${esc(mk + ':' + disp())}">${heroBigHTML(balance)}</div>
              <div class="kv"><i style="background:var(--brand)"></i><b>${pctLeft}%</b> balance</div>
              <div class="kv"><i style="background:var(--c-super)"></i><b>${daysLeft}</b> día${daysLeft === 1 ? '' : 's'} restante${daysLeft === 1 ? '' : 's'}</div>
            </div>
            <div class="ring2" role="img" aria-label="${esc(hideAmounts ? `Balance ${pctLeft}%, quedan ${daysLeft} de ${daysInMk} días` : ringLabel)}">
              ${ringSvg}
              ${perDayLeft != null ? `<div class="ring-c"><span class="num ${perDayLeft < 0 ? 'neg' : ''}">${money(perDayLeft)}</span><small>por día</small></div>` : ''}
            </div>
          </div>
          <div class="minis">
            <div role="button" tabindex="0" data-mini="ingreso"><span class="lbl"><i class="dotic" style="--c:var(--brand)">${spriteIcon('in')}</i>Ingresos</span><span class="num val">${money(inc)}</span>${deltaHTML(inc, isCurMonth ? incPrevCmp : incPrev, true)}</div>
            <div role="button" tabindex="0" data-mini="gasto"><span class="lbl"><i class="dotic" style="--c:var(--neg)">${spriteIcon('in').replace('class="ic"', 'class="ic flip"')}</i>Gastos</span><span class="num val">${money(exp)}</span>${deltaHTML(exp, isCurMonth ? expPrevCmp : expPrev, false)}</div>
            <div role="button" tabindex="0" data-mini="ahorro"><span class="lbl"><i class="dotic" style="--c:var(--c-super)">${spriteIcon('dollar')}</i>Ahorros</span><span class="num val ${savingsMonth < 0 ? 'neg' : ''}">${money(savingsMonth)}</span>${savDeltaHTML}</div>
          </div>
        </div>
      </div>

      ${sharedRow}

      <section class="k-card">
        <div class="k-card-h"><h2>Gastos por categoría</h2>${catRows.length ? `<button type="button" class="link" data-goto-categorias>Ver todo${spriteIcon('cr').replace('class="ic"', 'class="ic chev"')}</button>` : ''}</div>
        ${catRows.length ? `
        <div class="stack" role="img" aria-label="${esc(catRows.map((r) => `${r.name} ${pctOf(r.value)}%`).join(', '))}">
          ${catRows.map((r) => `<i style="width:${((r.value / catTotal) * 100).toFixed(2)}%;background:${r.color}"></i>`).join('')}
        </div>
        <div class="cat-lines">
          ${catRows.map((r) => `
          <button type="button" class="cat-line" ${r.id ? `data-goto-cat="${esc(r.id)}"` : 'data-goto-categorias'}>
            <i style="background:${r.color}"></i><span class="cat-line-name">${esc(r.name)}</span>
            <span class="t3 cat-line-pct">${pctOf(r.value)}%</span><span class="num">${money(r.value)}</span>
          </button>`).join('')}
        </div>
        ` : '<div class="empty">Sin gastos registrados este mes.</div>'}
      </section>

      <section class="k-card" data-goto-savings role="button" tabindex="0">
        <div class="k-card-h"><h2>Tasa de ahorro</h2>${rateDiff == null ? '' : rateDiff === 0 ? '<span class="dchip flat">= igual</span>' : `<span class="dchip ${rateDiff > 0 ? 'good' : 'bad'}">${rateDiff > 0 ? '▲' : '▼'} ${Math.abs(rateDiff)} pp</span>`}</div>
        ${savingsRateRows.length ? savingsRateChartSvg(savingsRateRows) : '<div class="empty">Sin ingresos registrados en los últimos 6 meses.</div>'}
      </section>

      ${insights.length ? `
      <h2 class="ovl home-ovl">Para tener en cuenta</h2>
      <div class="group">
        ${insights.map((ins) => `
        <button type="button" class="insight" ${ins.cardId ? `data-insight-card="${esc(ins.cardId)}"` : `data-insight-go="${esc(ins.go || '')}"${ins.catId ? ` data-insight-cat="${esc(ins.catId)}"` : ''}`}>
          <span class="cic" style="--c:${INSIGHT_COLOR[ins.tone]}">${spriteIcon(ins.icon)}</span>
          <div class="row-main"><div class="tt">${esc(ins.title)}</div>${ins.sub ? `<div class="st${ins.money ? ' money' : ''}">${esc(ins.sub)}</div>` : ''}</div>
          ${spriteIcon('cr').replace('class="ic"', 'class="ic chev"')}
        </button>`).join('')}
      </div>` : ''}`;

    $$('[data-mini]', el).forEach((b) => {
      const open = () => homeDetail(b.dataset.mini);
      b.addEventListener('click', open);
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    $$('[data-insight-card]', el).forEach((row) => row.addEventListener('click', () => cardAnalysisDialog(row.dataset.insightCard)));
    $$('[data-insight-go]', el).forEach((row) => row.addEventListener('click', () => {
      const go = row.dataset.insightGo;
      if (!go || !VIEWS[go]) return;
      ui.view = go;
      // Un aviso de categoría abre Categorías › Gastos con esa categoría
      // desplegada (no la vista General).
      if (go === 'categorias') {
        ui.catKind = 'gasto';
        const cat = row.dataset.insightCat;
        if (cat) ui.catOpen = { ...ui.catOpen, ['gasto:' + cat]: true };
      }
      render();
    }));
    const gotoSavings = $('[data-goto-savings]', el);
    if (gotoSavings) {
      const open = () => { ui.view = 'ahorros'; render(); };
      gotoSavings.addEventListener('click', open);
      gotoSavings.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    }
    const gotoShared = $('[data-goto-shared]', el);
    if (gotoShared) gotoShared.addEventListener('click', () => {
      ui.view = 'compartido';
      loadShared();
      render();
    });
    $$('[data-goto-categorias]', el).forEach((b) => b.addEventListener('click', () => {
      ui.view = 'categorias';
      ui.catKind = 'gasto';
      render();
    }));
    $$('[data-goto-cat]', el).forEach((b) => b.addEventListener('click', () => {
      ui.view = 'categorias';
      ui.catKind = 'gasto';
      ui.catOpen = { ...ui.catOpen, ['gasto:' + b.dataset.gotoCat]: true };
      render();
    }));
  }

  /* ================= Vista: Movimientos ================= */
  // "Ayer · dom 18 oct" / "Miércoles 7 oct": encabezado de cada día.
  function movDayLabel(dateStr) {
    const d = parseDate(dateStr);
    const dayMonth = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(d).replace('.', '');
    const yesterday = dateToStr(addDays(parseDate(todayStr()), -1));
    if (dateStr === todayStr() || dateStr === yesterday) {
      const wd = new Intl.DateTimeFormat('es-AR', { weekday: 'short' }).format(d).replace('.', '');
      return `${dateStr === todayStr() ? 'Hoy' : 'Ayer'} · ${wd} ${dayMonth}`;
    }
    const wd = new Intl.DateTimeFormat('es-AR', { weekday: 'long' }).format(d);
    return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${dayMonth}`;
  }
  const shortDayLabel = (dateStr) => {
    const s = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).format(parseDate(dateStr)).replace(/\./g, '').replace(',', '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const plainText = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  /* Una fila de Movimientos: ícono en el color de su categoría, título
     (nota o categoría), "Categoría · Cuenta · cuota 2/12" abajo, el monto
     a la derecha (gastos en el color del texto con "−", ingresos en verde
     con "+") y el equivalente en la otra moneda. Deslizándola hacia la
     izquierda aparecen Editar y Borrar (scroll-snap, sin JS). */
  function movRowHTML(t, { scheduled = false } = {}) {
    const isNew = ui.newTxIds && ui.newTxIds.ids.has(t.id) ? ' is-new' : '';
    const other = t.currency === 'USD' ? t.arsSnapshot : t.usdSnapshot;
    const otherCur = t.currency === 'USD' ? 'ARS' : 'USD';
    const otherLine = other != null ? `<small class="money">${esc(fmtPlain(Math.abs(other), otherCur))}</small>` : '';
    let icon, color, title, sub = [], sign = '', amtCls = '';
    if (t.type === 'transferencia') {
      icon = iconSvg('swap'); color = 'var(--t2)';
      title = t.note || 'Transferencia';
      sub.push(`${methodName(t.methodId)} → ${methodName(t.toMethodId)}`);
    } else {
      const cat = catById(t.categoryId);
      icon = iconSvg(categoryIconName(t.categoryId)); color = catColor(t.categoryId);
      title = t.note || catName(t.categoryId);
      // Sin nota, el título ya es la categoría: abajo va su grupo (si es una
      // subcategoría) en vez de repetirla.
      if (t.note) sub.push(catName(t.categoryId));
      else if (cat && cat.parentId) sub.push(catName(cat.parentId));
      sub.push(methodName(t.methodId));
      if (t.installment) sub.push(`cuota ${t.installment.k}/${t.installment.n}`);
      if (t.recurringId) sub.push('fijo');
      else if (t.leftoverGen) sub.push('sobrante');
      sign = t.type === 'ingreso' ? '+ ' : '− ';
      amtCls = t.type === 'ingreso' ? ' pos' : '';
    }
    if (scheduled) sub.unshift(shortDayLabel(t.date));
    return `
      <div class="swipe">
        <button type="button" class="row mrow${isNew}" data-tx="${esc(t.id)}">
          <span class="cic" style="--c:${color}">${icon}</span>
          <div class="row-main"><div class="tt">${esc(title)}</div><div class="st">${esc(sub.join(' · '))}</div></div>
          <div class="amt"><span class="num money${amtCls}">${esc(sign + fmtPlain(t.amount, t.currency))}</span>${otherLine}</div>
        </button>
        <div class="swipe-actions">
          <button type="button" class="sw-edit" data-edit="${esc(t.id)}" aria-label="Editar ${esc(title)}">${spriteIcon('note')}<span>Editar</span></button>
          <button type="button" class="sw-del" data-del="${esc(t.id)}" aria-label="Borrar ${esc(title)}">${iconSvg('trash')}<span>Borrar</span></button>
        </div>
      </div>`;
  }

  function movFilteredList() {
    let list = S().transactions.slice();
    // Por fecha real de carga, no de vencimiento: un gasto con tarjeta
    // aparece en el mes en que se hizo, aunque el balance lo cuente para
    // el mes en que vence el resumen (ver settings.cardMonthBasis).
    if (!ui.fAllMonths) {
      const months = new Set(ui.fMonths && ui.fMonths.length > 1 ? ui.fMonths : [ui.month]);
      list = list.filter((t) => months.has(monthKeyOf(t.date)));
    }
    if (ui.fType) list = list.filter((t) => t.type === ui.fType);
    if (ui.fCat) {
      // Un grupo (ej. "Casa") trae también sus subcategorías.
      const filterCat = catById(ui.fCat);
      list = list.filter((t) => filterCat && !filterCat.parentId
        ? topCategoryOf(t.categoryId) === ui.fCat
        : t.categoryId === ui.fCat);
    }
    if (ui.fMethod) list = list.filter((t) => t.methodId === ui.fMethod || t.toMethodId === ui.fMethod);
    const q = plainText(ui.fSearch).trim();
    if (q) {
      const qDigits = q.replace(/[.\s$]/g, '');
      list = list.filter((t) => {
        const hay = plainText([t.note, catName(t.categoryId), t.categoryId && catById(t.categoryId) && catById(t.categoryId).parentId ? catName(catById(t.categoryId).parentId) : '',
          methodName(t.methodId), t.toMethodId ? methodName(t.toMethodId) : ''].join(' '));
        return hay.includes(q) || (/^\d+$/.test(qDigits) && String(Math.round(t.amount)).includes(qDigits));
      });
    }
    return list;
  }

  function movListHTML() {
    const list = movFilteredList();
    if (!list.length) {
      return `<div class="empty">${ui.fSearch || ui.fType || ui.fCat || ui.fMethod
        ? 'No hay movimientos con estos filtros.'
        : 'Todavía no hay movimientos este mes. Cargá uno con el +.'}</div>`;
    }
    const today = todayStr();
    // Cuotas y fijos con fecha futura van aparte: todavía no pasaron.
    const scheduled = list.filter((t) => t.date > today).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const past = list.filter((t) => t.date <= today).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    const dayTotal = (items) => {
      let n = 0;
      for (const t of items) {
        if (t.type === 'transferencia') continue;
        const v = txDispAmount(t);
        if (v != null) n += t.type === 'ingreso' ? v : -v;
      }
      if (Math.abs(n) < 0.5) return '';
      return `<span class="num money">${esc((n < 0 ? '− ' : '+ ') + fmtPlain(Math.abs(n)))}</span>`;
    };
    return `
      ${scheduled.length ? `
      <section class="sched">
        <h3 class="dayh"><span>Programados</span><span class="num">${scheduled.length}</span></h3>
        <div class="group">${scheduled.map((t) => movRowHTML(t, { scheduled: true })).join('')}</div>
      </section>` : ''}
      ${dayGroups(past).map(({ dateStr, items }) => `
      <section>
        <h3 class="dayh"><span>${esc(movDayLabel(dateStr))}</span>${dayTotal(items)}</h3>
        <div class="group">${items.map((t) => movRowHTML(t)).join('')}</div>
      </section>`).join('')}`;
  }

  function vMovimientos(el) {
    const cat = ui.fCat ? catById(ui.fCat) : null;
    const TYPE_LABEL = { '': 'Tipo', gasto: 'Gastos', ingreso: 'Ingresos', transferencia: 'Transferencias' };
    const methodLabel = ui.fMethod ? (methodById(ui.fMethod) || savingById(ui.fMethod) || {}).name : '';
    el.innerHTML = `
      <label class="search">
        ${spriteIcon('search')}
        <input type="search" id="mov-search" placeholder="Buscar" value="${esc(ui.fSearch || '')}" enterkeyhint="search" autocomplete="off" aria-label="Buscar movimientos">
      </label>
      <div class="filter-row" role="toolbar" aria-label="Filtros">
        <button type="button" class="chip${ui.fType ? ' on' : ''}" data-ftypesheet><span>${esc(TYPE_LABEL[ui.fType] || 'Tipo')}</span>${spriteIcon('cd')}</button>
        <button type="button" class="chip${ui.fMethod ? ' on' : ''}" data-fmethodsheet><span>${esc(methodLabel || 'Cuenta')}</span>${spriteIcon('cd')}</button>
        <button type="button" class="chip${cat ? ' on' : ''}" data-fcat><span>${esc(cat ? cat.name : 'Categoría')}</span>${spriteIcon('cd')}</button>
      </div>
      <div class="mov-list" id="mov-list">${movListHTML()}</div>`;

    const listEl = $('#mov-list', el);
    $('#mov-search', el).addEventListener('input', (e) => {
      ui.fSearch = e.target.value;
      listEl.innerHTML = movListHTML();
    });
    el.addEventListener('click', (e) => {
      let b;
      if (e.target.closest('[data-ftypesheet]')) { typeFilterSheet(); return; }
      if (e.target.closest('[data-fmethodsheet]')) { methodFilterSheet(); return; }
      if (e.target.closest('[data-fcat]')) { categoryFilterSheet(); return; }
      const byId = (id) => S().transactions.find((t) => t.id === id);
      if ((b = e.target.closest('[data-edit]'))) { const tx = byId(b.dataset.edit); if (tx) txForm(tx); return; }
      if ((b = e.target.closest('[data-del]'))) { const tx = byId(b.dataset.del); if (tx) deleteTx(tx); return; }
      if ((b = e.target.closest('[data-tx]'))) { const tx = byId(b.dataset.tx); if (tx) txDetailDialog(tx); }
    });
  }

  // Elegir la categoría del filtro (grupo entero o una subcategoría).
  function categoryFilterSheet() {
    const row = (id, name, color, icon, on, sub) => `
      <button type="button" class="pick-row${on ? ' on' : ''}${sub ? ' pick-sub' : ''}" data-pickcat="${esc(id)}">
        <span class="cic" style="--c:${color}">${icon}</span><span>${esc(name)}</span>${on ? spriteIcon('check') : ''}
      </button>`;
    const section = (type, label) => {
      const groups = S().categories.filter((c) => c.type === type && !c.parentId);
      if (!groups.length) return '';
      return `<div class="ovl pick-sep">${label}</div>${groups.map((g) => row(g.id, g.name, catColor(g.id), iconSvg(categoryIconName(g.id)), ui.fCat === g.id, false)
        + (useSubcats() ? catChildren(g.id).map((c) => row(c.id, c.name, catColor(c.id), iconSvg(categoryIconName(c.id)), ui.fCat === c.id, true)).join('') : '')).join('')}`;
    };
    openPanel({
      title: 'Categoría',
      body: `<div class="pick-list">
        ${row('', 'Todas las categorías', 'var(--t2)', spriteIcon('more'), !ui.fCat, false)}
        ${section('gasto', 'Gastos')}${section('ingreso', 'Ingresos')}
      </div>`,
      onClick(e, dlg) {
        const b = e.target.closest('[data-pickcat]');
        if (!b) return;
        ui.fCat = b.dataset.pickcat;
        closeSheet(dlg).then(render);
      },
    });
  }

  // Elegir el mes (o "Todos los meses", solo para la lista).
  /* Elegir el mes. En la lista de Movimientos se pueden elegir varios
     meses juntos, o "Todos los meses"; en Categorías y Calendario, uno. */
  function monthPickerSheet() {
    const months = new Set();
    const cm = curMonth();
    for (let i = -24; i <= 3; i++) months.add(addMonthsKey(cm, i));
    for (const t of S().transactions) months.add(monthKeyOf(t.date));
    const sorted = [...months].sort().reverse();
    const multi = ui.view === 'movimientos';
    let all = multi && ui.fAllMonths;
    const sel = new Set(multi && ui.fMonths && ui.fMonths.length > 1 ? ui.fMonths : [ui.month]);
    const row = (value, label, on) => `
      <button type="button" class="pick-row${on ? ' on' : ''}" data-pickmonth="${esc(value)}" aria-pressed="${on}">
        <span class="cic" style="--c:var(--t2)">${spriteIcon('cal')}</span><span>${esc(label)}</span>${on ? spriteIcon('check') : ''}
      </button>`;
    const listHTML = () => `<div class="pick-list">
        ${multi ? row('all', 'Todos los meses', all) : ''}
        ${sorted.map((m) => row(m, topbarMonthLabel(m) + (m === cm ? ' · actual' : ''), !all && sel.has(m))).join('')}
      </div>`;
    const applyLabel = () => (all ? 'Ver todos los meses' : sel.size > 1 ? `Ver ${sel.size} meses` : 'Ver el mes');
    const dlg = openPanel({
      title: multi ? 'Meses' : 'Mes',
      subtitle: multi ? 'Tocá uno o varios' : '',
      body: listHTML(),
      primary: multi ? {
        label: applyLabel(),
        onClick: (d) => {
          if (all) { ui.fAllMonths = true; ui.fMonths = null; }
          else {
            const list = [...sel].sort();
            ui.fAllMonths = false;
            ui.month = list[list.length - 1];
            ui.fMonths = list.length > 1 ? list : null;
          }
          closeSheet(d).then(render);
        },
      } : null,
      onClick(e, d) {
        const b = e.target.closest('[data-pickmonth]');
        if (!b) return;
        const v = b.dataset.pickmonth;
        if (!multi) { ui.month = v; closeSheet(d).then(render); return; }
        if (v === 'all') { all = !all; if (!all && !sel.size) sel.add(ui.month); }
        else {
          if (all) { all = false; sel.clear(); }
          if (sel.has(v) && sel.size > 1) sel.delete(v); else sel.add(v);
        }
        const body = $('[data-shbody]', d);
        const top = body.scrollTop;
        body.innerHTML = listHTML();
        body.scrollTop = top;
        $('[data-primary]', d).textContent = applyLabel();
      },
    });
    const on = $('.pick-row.on', dlg);
    if (on) on.scrollIntoView({ block: 'center' });
  }

  // Filtros de Movimientos en paneles desde abajo.
  function filterSheet(title, options, current, apply) {
    openPanel({
      title,
      body: `<div class="pick-list">${options.map((o) => `
        <button type="button" class="pick-row${o.sub ? ' pick-child' : ''}${o.value === current ? ' on' : ''}" data-pickf="${esc(o.value)}">
          <span class="cic" style="--c:${o.color || 'var(--t2)'}">${o.icon}</span><span>${esc(o.label)}</span>${o.value === current ? spriteIcon('check') : ''}
        </button>`).join('')}</div>`,
      onClick(e, dlg) {
        const b = e.target.closest('[data-pickf]');
        if (!b) return;
        apply(b.dataset.pickf);
        closeSheet(dlg).then(render);
      },
    });
  }
  function typeFilterSheet() {
    const opts = [
      { value: '', label: 'Todos', icon: spriteIcon('moves') },
      { value: 'gasto', label: 'Gastos', icon: spriteIcon('up') },
      { value: 'ingreso', label: 'Ingresos', icon: spriteIcon('down'), color: 'var(--brand-text)' },
    ];
    if (S().transactions.some((t) => t.type === 'transferencia')) opts.push({ value: 'transferencia', label: 'Transferencias', icon: spriteIcon('swap') });
    filterSheet('Tipo', opts, ui.fType, (v) => { ui.fType = v; });
  }
  function methodFilterSheet() {
    const opts = [{ value: '', label: 'Todas las cuentas', icon: spriteIcon('card') }]
      .concat(S().methods.map((m) => ({ value: m.id, label: m.name, icon: iconSvg(methodIconName(m.id)), color: KIND_COLOR[m.kind] })))
      .concat(S().savings.map((sv) => ({ value: sv.id, label: sv.name, icon: spriteIcon('wallet') })));
    filterSheet('Cuenta', opts, ui.fMethod, (v) => { ui.fMethod = v; });
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



  /* ---------- Escalas y formatos de los gráficos del rediseño ---------- */
  // Tope "redondo" del eje y su paso, para 3 a 5 líneas de grilla.
  function niceScale(max, count = 4) {
    if (!(max > 0)) max = 1;
    const raw = max / count;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
    return { top: Math.ceil(max / step) * step, step };
  }
  // Montos de los gráficos siempre en nominal ("$ 3.820.000"), sin
  // abreviar en millones ni miles. Con el ojo activado, "•••".
  const chartMoney = (v) => (hideAmounts ? '•••' : fmtPlain(v));
  // Solo las líneas de la grilla (sin rótulos en el eje: cada punto ya
  // lleva su monto).
  const gridLines = (ticks, y, x0, x1) => ticks.map((v, i) =>
    `<line x1="${x0}" x2="${x1}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="g-grid"${i ? ' stroke-dasharray="2 4"' : ''}/>`).join('');

  /* ---------- Movimientos › Categorías › General ---------- */
  // Ingresos y gastos por mes (los últimos 4 hasta el elegido): dos líneas
  // suaves con marcadores y el monto de cada punto. Si el último mes está
  // en curso, ese tramo de gastos va punteado (el mes no terminó).
  function incomeExpenseChartSvg(rows, inProgress) {
    const G = Charts.g;
    const W = 320, H = 156, x0 = 52, x1 = 268, yTop = 22, yBase = 130;
    const max = Math.max(1, ...rows.map((r) => Math.max(r.inc, r.exp)));
    const { top, step } = niceScale(max, 4);
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
    const x = rows.length > 1 ? G.escala([0, rows.length - 1], [x0, x1]) : () => (x0 + x1) / 2;
    const y = G.escala([0, top], [yBase, yTop]);
    const inc = rows.map((r, i) => [x(i), y(r.inc)]);
    const exp = rows.map((r, i) => [x(i), y(r.exp)]);
    const last = rows.length - 1;
    const expDone = inProgress ? exp.slice(0, last) : exp;
    const area = rows.length > 1 ? `<path d="${G.areaEntre(inc, exp)}" style="fill:var(--brand);opacity:.08"/>` : '';
    const expSolid = expDone.length > 1 ? `<path d="${G.lineaSuave(expDone)}" fill="none" stroke-width="2.5" stroke-linecap="round" style="stroke:var(--t1)"/>` : '';
    const expDash = inProgress && last > 0 ? `<path d="${G.lineaSuave(exp.slice(last - 1))}" fill="none" stroke-width="2.5" stroke-dasharray="4 4" stroke-linecap="round" style="stroke:var(--t1)"/>` : '';
    const incLine = rows.length > 1 ? `<path d="${G.lineaSuave(inc)}" fill="none" stroke-width="2.5" stroke-linecap="round" style="stroke:var(--brand)"/>` : '';
    const markers = rows.map((r, i) => {
      const isLast = i === last;
      const expMk = isLast && inProgress
        ? `<circle cx="${exp[i][0].toFixed(1)}" cy="${exp[i][1].toFixed(1)}" r="4.5" stroke-width="2.4" stroke-dasharray="2 2" style="fill:var(--s1);stroke:var(--t1)"/>`
        : G.marcador(exp[i][0], exp[i][1], 'var(--t1)', false);
      return G.marcador(inc[i][0], inc[i][1], 'var(--brand)', isLast) + expMk;
    }).join('');
    const labels = rows.map((r, i) => {
      const incAbove = r.inc >= r.exp;
      const iy = incAbove ? inc[i][1] - 10 : inc[i][1] + 18;
      const ey = incAbove ? exp[i][1] + 18 : exp[i][1] - 10;
      return `<text x="${inc[i][0].toFixed(1)}" y="${Math.max(11, iy).toFixed(1)}" text-anchor="middle" class="g-lab"${i === last ? ' style="fill:var(--brand-text)"' : ''}>${esc(chartMoney(r.inc))}</text>
        <text x="${exp[i][0].toFixed(1)}" y="${Math.min(yBase - 2, ey).toFixed(1)}" text-anchor="middle" class="g-lab">${esc(chartMoney(r.exp))}</text>`;
    }).join('');
    const months = rows.map((r, i) => `<text x="${x(i).toFixed(1)}" y="148" text-anchor="middle"${i === last ? ' class="g-sel"' : ''}>${esc(r.label)}</text>`).join('');
    const aria = `Ingresos y gastos por mes: ${rows.map((r, i) => `${r.label} ${hideAmounts ? '' : `${fmtPlain(r.inc)} y ${fmtPlain(r.exp)}`}${i === last && inProgress ? ' (en curso)' : ''}`).join('; ')}`;
    return `<svg class="gchart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(aria)}">
      ${gridLines(ticks, y, 8, 312)}
      ${area}${incLine}${expSolid}${expDash}${markers}${labels}${months}
    </svg>`;
  }

  // Gastos acumulados día a día: el mes elegido como una línea limpia (con
  // degradé debajo) hasta hoy, el mes anterior completo punteado, los
  // ingresos del mes y los ingresos − ahorro como referencias, y en el día
  // de hoy el monto y la diferencia en % contra el mes anterior.
  function dailySpendChartSvg({ cur, prev, daysInMonth, upTo, income, incomeMinusSav, isCurrent, prevLabel, prevShort }) {
    const G = Charts.g;
    const W = 320, H = 180, x0 = 12, x1 = 300, yTop = 26, yBase = 150;
    const curPts = G.acumulado(cur, upTo);
    const prevDays = Object.keys(prev).length ? Math.max(...Object.keys(prev).map(Number)) : 0;
    const prevPts = prevDays ? G.acumulado(prev, prevDays) : [];
    // La escala la marcan los gastos; las referencias de ingresos solo se
    // dibujan si quedan cerca (si no, aplastan la curva contra el piso).
    const spendMax = Math.max(1, ...curPts.map((p) => p[1]), ...prevPts.map((p) => p[1]));
    const fits = (v) => v > 0 && v <= spendMax * 1.5;
    const max = Math.max(spendMax, ...[income, incomeMinusSav].filter(fits));
    const { top, step } = niceScale(max * 1.06, 4);
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
    const x = G.escala([1, daysInMonth], [x0, x1]);
    const y = G.escala([0, top], [yBase, yTop]);
    // Arranca en 0 el día 1, así la línea no empieza "en el aire".
    const line = (pts) => [[x(1), y(0)], ...pts.map(([d, v]) => [x(Math.min(d, daysInMonth)), y(v)])];
    const curXY = curPts.length ? line(curPts) : [];
    const prevXY = prevPts.length ? line(prevPts) : [];
    const path = (xy) => `M${xy.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L')}`;
    const prevPath = prevXY.length > 1 ? `<path d="${path(prevXY)}" fill="none" stroke-width="1.6" stroke-dasharray="4 4" stroke-linejoin="round" stroke-linecap="round" style="stroke:var(--t3)"/>` : '';
    const area = curXY.length > 1 ? `<path d="${path(curXY)} L${curXY[curXY.length - 1][0].toFixed(1)} ${yBase} L${curXY[0][0].toFixed(1)} ${yBase} Z" style="fill:url(#gDia)"/>` : '';
    const curPath = curXY.length > 1 ? `<path d="${path(curXY)}" fill="none" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" style="stroke:var(--c-tel)"/>` : '';
    const hline = (v, color, label, below) => {
      if (!(v > 0)) return '';
      const yy = y(v);
      return `<line x1="${x0}" x2="${x1}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke-width="1.2" stroke-dasharray="5 4" style="stroke:${color};opacity:.85"/>
        <text x="${below ? x0 : x1}" y="${(below ? yy + 13 : yy - 5).toFixed(1)}" text-anchor="${below ? 'start' : 'end'}" style="fill:${color};font-weight:600">${esc(label)} ${esc(chartMoney(v))}</text>`;
    };
    const refs = (fits(income) ? hline(income, 'var(--brand-text)', 'Ingresos', false) : '')
      + (fits(incomeMinusSav) && Math.abs(income - incomeMinusSav) >= 1 ? hline(incomeMinusSav, 'var(--c-super)', 'Ingresos − ahorro', true) : '');
    let today = '';
    if (curPts.length) {
      const [hx, hy] = curXY[curXY.length - 1];
      const prevAt = prevPts.length ? prevPts[Math.min(upTo, prevPts.length) - 1][1] : null;
      if (isCurrent) today += `<line x1="${hx.toFixed(1)}" x2="${hx.toFixed(1)}" y1="${hy.toFixed(1)}" y2="${yBase}" stroke-width="1" stroke-dasharray="2 3" style="stroke:var(--t3)"/>`;
      if (prevAt != null) today += `<circle cx="${hx.toFixed(1)}" cy="${y(prevAt).toFixed(1)}" r="3.5" style="fill:var(--t3)"/>`;
      today += `<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="9" style="fill:var(--c-tel);opacity:.18"/><circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="4.5" stroke-width="2.5" style="fill:var(--c-tel);stroke:var(--s1)"/>`;
    }
    const xTicks = [1, 5, 10, 15, 20, 25, daysInMonth].filter((d, i, a) => d <= daysInMonth && a.indexOf(d) === i && !(d !== daysInMonth && daysInMonth - d < 3));
    const xLabels = xTicks.map((d) => `<text x="${x(d).toFixed(1)}" y="170" text-anchor="middle"${isCurrent && d === upTo ? ' class="g-sel"' : ''}>${d}</text>`).join('');
    const aria = `Gastos acumulados día a día${hideAmounts ? '' : `: ${fmtPlain(curPts.length ? curPts[curPts.length - 1][1] : 0)} al día ${upTo}; ${prevLabel} cerró en ${fmtPlain(prevPts.length ? prevPts[prevPts.length - 1][1] : 0)}`}.`;
    return `<svg class="gchart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(aria)}">
      <defs><linearGradient id="gDia" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--c-tel);stop-opacity:.28"/><stop offset="1" style="stop-color:var(--c-tel);stop-opacity:0"/></linearGradient></defs>
      ${gridLines(ticks, y, x0, x1)}
      ${refs}${prevPath}${area}${curPath}${today}${xLabels}
    </svg>`;
  }

  // Evolución de una categoría por mes: línea suave en su color, con el
  // valor de cada mes (en pesos o en %) y el último destacado.
  function categoryEvoSvg(rows, color, isPct) {
    const G = Charts.g;
    const W = 320, H = 140, x0 = 40, x1 = 280, yTop = 24, yBase = 112;
    const vals = rows.map((r) => r.value).filter((v) => v != null);
    const max = Math.max(isPct ? 1 : 1, ...vals);
    const { top, step } = niceScale(max, 3);
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
    const x = rows.length > 1 ? G.escala([0, rows.length - 1], [x0, x1]) : () => (x0 + x1) / 2;
    const y = G.escala([0, top], [yBase, yTop]);
    const pts = rows.map((r, i) => (r.value == null ? null : [x(i), y(r.value)]));
    const solid = pts.filter(Boolean);
    const last = rows.length - 1;
    const lab = (v) => (v == null ? '' : isPct ? `${v.toFixed(v < 10 ? 1 : 0).replace('.', ',')}%` : chartMoney(v));
    return `<svg class="gchart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(rows.map((r) => `${r.label} ${hideAmounts && !isPct ? '' : lab(r.value)}`).join(', '))}">
      ${gridLines(ticks, y, 8, 312)}
      ${solid.length > 1 ? `<path d="${G.lineaSuave(solid)}" fill="none" stroke-width="2.5" stroke-linecap="round" style="stroke:${color}"/>` : ''}
      ${pts.map((p, i) => (p ? G.marcador(p[0], p[1], color, i === last) : '')).join('')}
      ${pts.map((p, i) => {
        // En pesos con muchos meses los rótulos no entran en una fila:
        // se alternan arriba y abajo de la línea (el último, siempre arriba).
        const below = !isPct && rows.length > 4 && (last - i) % 2 === 1;
        return p ? `<text x="${p[0].toFixed(1)}" y="${(below ? p[1] + 19 : p[1] - 10).toFixed(1)}" text-anchor="middle" class="g-lab g-halo"${i === last ? ' style="fill:var(--t1);font-weight:700"' : ''}>${esc(lab(rows[i].value))}</text>` : '';
      }).join('')}
      ${rows.map((r, i) => `<text x="${x(i).toFixed(1)}" y="132" text-anchor="middle"${i === last ? ' class="g-sel"' : ''}>${esc(r.label)}</text>`).join('')}
    </svg>`;
  }


  // Dona plana con el % de la categoría más grande en el centro.
  function donutSvg(items, total) {
    const r = 54, c = 2 * Math.PI * r, gap = items.length > 1 ? 2 : 0;
    let off = 0;
    const arcs = items.map((it) => {
      const len = Math.max(0, (it.value / total) * c - gap);
      const s = `<circle cx="66" cy="66" r="${r}" style="stroke:${it.color}" stroke-dasharray="${len.toFixed(2)} ${c.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`;
      off += (it.value / total) * c;
      return s;
    }).join('');
    const top = items[0];
    const topPct = total > 0 ? Math.round((top.value / total) * 100) : 0;
    return `<svg viewBox="0 0 132 132" width="120" height="120" role="img" aria-label="${esc(items.map((it) => `${it.label} ${Math.round((it.value / total) * 100)}%`).join(', '))}">
      <g transform="rotate(-90 66 66)" fill="none" stroke-width="16">${arcs}</g>
      <text x="66" y="66" text-anchor="middle" style="font:600 22px var(--f-num);fill:var(--t1)">${topPct}%</text>
      <text x="66" y="84" text-anchor="middle" style="font:500 11px var(--f-text);fill:var(--t2)">es ${esc(top.label.length > 14 ? top.label.slice(0, 13) + '…' : top.label)}</text>
    </svg>`;
  }

  function vCategorias(el) {
    const mk = ui.month;
    const txs = S().transactions;
    const kind = ['general', 'gasto', 'ingreso'].includes(ui.catKind) ? ui.catKind : 'general';
    const isCurrent = mk === curMonth();
    const todayDay = new Date().getDate();
    const [mkY, mkM] = mk.split('-').map(Number);
    const daysInMk = new Date(mkY, mkM, 0).getDate();
    const prevMk = addMonthsKey(mk, -1);
    const monthName = (m) => {
      const [yy, mm] = m.split('-').map(Number);
      return new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(new Date(yy, mm - 1, 1));
    };
    // Todo por fecha real de carga (no de vencimiento) y, en el mes en
    // curso, solo lo que ya pasó: sin los programados (cuotas y fijos con
    // fecha futura). Las comparaciones van contra el MISMO DÍA del mes
    // anterior (del 1 al 19 de octubre contra del 1 al 19 de septiembre).
    const cutDay = isCurrent ? todayDay : daysInMk;
    const inMonth = txs.filter((t) => monthKeyOf(t.date) === mk && Number(t.date.slice(8, 10)) <= cutDay);
    const inPrevSameDay = txs.filter((t) => monthKeyOf(t.date) === prevMk && (!isCurrent || Number(t.date.slice(8, 10)) <= todayDay));
    const inPrevFull = txs.filter((t) => monthKeyOf(t.date) === prevMk);

    const chipsHTML = `
      <div class="chips" role="tablist" aria-label="Vista">
        ${[['general', 'General'], ['gasto', 'Gastos'], ['ingreso', 'Ingresos']].map(([k, label]) =>
          `<button type="button" class="chip${kind === k ? ' on' : ''}" data-catkind="${k}" role="tab" aria-selected="${kind === k}">${label}</button>`).join('')}
      </div>`;

    if (kind === 'general') {
      // Ingresos y gastos de los últimos 4 meses hasta el elegido.
      const months = [];
      for (let i = 3; i >= 0; i--) months.push(addMonthsKey(mk, -i));
      const rows = months.map((m) => {
        const cut = m === curMonth() ? todayDay : 99;
        const list = txs.filter((t) => monthKeyOf(t.date) === m && Number(t.date.slice(8, 10)) <= cut);
        return { label: monthShortLabel(m).toLowerCase(), inc: sumDisp(list.filter((t) => t.type === 'ingreso')), exp: sumDisp(list.filter((t) => t.type === 'gasto')) };
      });
      const first = rows.findIndex((r) => r.inc > 0 || r.exp > 0);
      const shown = first >= 0 ? rows.slice(first) : [];
      const chart = shown.length ? incomeExpenseChartSvg(shown, isCurrent) : null;

      // Gastos acumulados por día.
      const perDay = (list) => {
        const o = {};
        for (const t of list) {
          if (t.type !== 'gasto') continue;
          const v = txDispAmount(t);
          if (v == null) continue;
          const d = Number(t.date.slice(8, 10));
          o[d] = (o[d] || 0) + v;
        }
        return o;
      };
      const curDaily = perDay(inMonth);
      const prevDaily = perDay(inPrevFull);
      const [py, pm] = prevMk.split('-').map(Number);
      const daysInPrev = new Date(py, pm, 0).getDate();
      for (let d = 1; d <= daysInPrev; d++) if (!(d in prevDaily)) prevDaily[d] = 0;
      const spentToDate = Object.values(curDaily).reduce((a, v) => a + v, 0);
      const prevAtSameDay = sumDisp(inPrevSameDay.filter((t) => t.type === 'gasto'));
      const incomeMonth = sumDisp(txs.filter((t) => monthKeyOf(t.date) === mk && t.type === 'ingreso'));
      const savMonth = savingsAtEndOf(mk, { excludeOpening: true }) - savingsAtEndOf(prevMk, { excludeOpening: true });
      const hasPrev = inPrevFull.some((t) => t.type === 'gasto');
      const diff = spentToDate - prevAtSameDay;
      // Ingresos que no entran en la escala del gráfico: van acá como dato.
      const spendMax = Math.max(1, spentToDate, sumDisp(inPrevFull.filter((t) => t.type === 'gasto')));
      const refsOff = [];
      if (incomeMonth > spendMax * 1.5) refsOff.push(`<span>Ingresos <b class="num money pos">${esc(fmtPlain(incomeMonth))}</b></span>`);
      if (Math.abs(savMonth) >= 1 && incomeMonth - savMonth > spendMax * 1.5) refsOff.push(`<span>Ingresos − ahorro <b class="num money">${esc(fmtPlain(incomeMonth - savMonth))}</b></span>`);
      const prevShort = isCurrent ? `${todayDay} ${monthShortLabel(prevMk).toLowerCase()}` : monthShortLabel(prevMk).toLowerCase();
      const diffPct = prevAtSameDay > 0 ? fmtVarPct((diff / prevAtSameDay) * 100) : null;
      const diffChip = hasPrev && Math.abs(diff) >= 1
        ? `<span class="dchip ${diff > 0 ? 'bad' : 'good'}">${diff > 0 ? '▲' : '▼'} ${diffPct != null ? `${diffPct}% · ` : ''}<span class="money">${esc(fmtPlain(Math.abs(diff)))}</span> ${diff > 0 ? 'más' : 'menos'} que al ${esc(prevShort)}</span>` : '';

      el.innerHTML = `${chipsHTML}
        <section class="k-card">
          <div class="k-card-h k-card-h-tight"><h2>Ingresos y gastos por mes</h2>${chart ? `<button type="button" class="link" data-iedetail>Ver detalle${spriteIcon('cr').replace('class="ic"', 'class="ic chev"')}</button>` : ''}</div>
          ${chart ? `
          <div class="legend">
            <span><i class="lg-line" style="border-color:var(--brand)"></i>Ingresos</span>
            <span><i class="lg-line" style="border-color:var(--t1)"></i>Gastos</span>
            ${isCurrent ? `<span><i class="lg-line lg-dash" style="border-color:var(--t1)"></i>${esc(monthShortLabel(mk))} en curso</span>` : ''}
          </div>
          <div class="ie-tap" data-iedetail role="button" tabindex="0" aria-label="Ver los totales de cada mes">${chart}</div>`
          : '<div class="empty">Todavía no hay movimientos para comparar meses.</div>'}
        </section>

        <section class="k-card">
          <div class="k-card-h k-card-h-tight"><h2>Gastos día a día</h2><span class="t3 k-card-note">acumulado</span></div>
          <div class="daily-head">
            <span class="num money daily-total">${esc(fmtPlain(spentToDate))}</span>
            <span class="t2">${isCurrent ? `al día ${todayDay}` : `en ${esc(monthName(mk))}`}</span>
            ${diffChip}
          </div>
          <div class="legend">
            <span><i class="lg-line" style="border-color:var(--c-tel)"></i>${esc(monthShortLabel(mk))}</span>
            ${hasPrev ? `<span><i class="lg-line lg-dash" style="border-color:var(--t3)"></i>${esc(monthShortLabel(prevMk))}</span>` : ''}
          </div>
          ${refsOff.length ? `<div class="daily-refs">${refsOff.join('')}</div>` : ''}
          ${dailySpendChartSvg({ cur: curDaily, prev: hasPrev ? prevDaily : {}, daysInMonth: daysInMk, upTo: cutDay, income: incomeMonth, incomeMinusSav: incomeMonth - savMonth, isCurrent, prevLabel: monthName(prevMk), prevShort })}
        </section>`;
      wireCatKindChips(el);
      $$('[data-iedetail]', el).forEach((b) => b.addEventListener('click', () => incomeExpenseDetail(mk)));
      return;
    }

    /* ---------- Gastos / Ingresos ---------- */
    const isInc = kind === 'ingreso';
    const type = isInc ? 'ingreso' : 'gasto';
    const breakdown = categoryBreakdown(inMonth.filter((t) => t.type === type)).filter((g) => g.total > 0);
    // Acá la variación va contra el mes anterior COMPLETO.
    const prevBreakdown = categoryBreakdown(inPrevFull.filter((t) => t.type === type));
    const prevTotals = new Map(prevBreakdown.map((g) => [g.id, g.total]));
    const prevSubTotals = new Map(prevBreakdown.flatMap((g) => g.subs.map((sb) => [sb.id, sb.value])));
    const total = breakdown.reduce((a, g) => a + g.total, 0);
    const incMonth = sumDisp(inMonth.filter((t) => t.type === 'ingreso'));
    const expMonth = sumDisp(inMonth.filter((t) => t.type === 'gasto'));
    const pctOf = (v) => (total > 0 ? Math.round((v / total) * 100) : 0);
    // Dona: hasta 5 categorías + "Otras".
    const DONUT_MAX = 5;
    const donutItems = breakdown.slice(0, DONUT_MAX).map((g) => ({ label: g.name, value: g.total, color: g.id === '__sin' ? OTROS_COLOR : catColor(g.id) }));
    const restDonut = breakdown.slice(DONUT_MAX).reduce((a, g) => a + g.total, 0);
    if (restDonut > 0) donutItems.push({ label: 'Otras', value: restDonut, color: OTROS_COLOR });
    // Las mismas cifras, con rótulo, para categorías y subcategorías:
    // % de los gastos, % de los ingresos y la variación (en % y en pesos)
    // contra el mes anterior completo.
    const prevShortM = monthShortLabel(prevMk).toLowerCase();
    const metricsHTML = (v, prev) => {
      const sh = (base) => (base > 0 ? `${fmtShare((v / base) * 100)}%` : '–');
      const cell = (label, value, cls = '') => `<div class="${cls}"><span class="cmet-l">${label}</span><b class="num">${value}</b></div>`;
      const diff = v - prev;
      let varVal, varSub = '';
      if (!(prev > 0)) { varVal = v > 0 ? 'nuevo' : '–'; if (v > 0) varSub = `+${fmtPlain(v)}`; }
      else {
        const pctVar = fmtVarPct((diff / prev) * 100);
        varVal = pctVar == null ? '= igual' : `${diff > 0 ? '▲' : '▼'} ${pctVar}%`;
        if (pctVar != null) varSub = `${diff > 0 ? '+' : '−'}${fmtPlain(Math.abs(diff))}`;
      }
      const varCls = !(prev > 0) || Math.abs(diff) < 1 ? 'flat' : (diff > 0) !== isInc ? 'bad' : 'good';
      return `<div class="cmet${isInc ? ' cmet-2' : ''}">
        ${isInc ? cell('% ingresos', sh(incMonth)) : cell('% gastos', sh(expMonth)) + cell('% ingresos', sh(incMonth))}
        <div class="cmet-var ${varCls}"><span class="cmet-l">vs. ${esc(prevShortM)}</span><b class="num">${varVal}</b>${varSub ? `<span class="num money cmet-sub">${esc(varSub)}</span>` : ''}</div>
      </div>`;
    };
    // Dentro de cada categoría con movimientos, también las subcategorías
    // que este mes están en $ 0 pero el mes pasado no (para ver cuánto
    // bajaron). Las categorías enteras en $ 0 van agrupadas más abajo.
    const listRows = breakdown.map((g) => ({ ...g, subs: g.subs.slice() }));
    for (const pg of prevBreakdown) {
      const g = listRows.find((x) => x.id === pg.id);
      if (!g) continue;
      for (const ps of pg.subs) if (ps.value > 0 && !g.subs.some((x) => x.id === ps.id)) g.subs.push({ id: ps.id, name: ps.name, value: 0 });
    }
    const zeroGroups = S().categories.filter((c) => c.type === type && !c.parentId && !listRows.some((g) => g.id === c.id));
    const rowsHTML = listRows.map((g) => {
      const key = `${type}:${g.id}`;
      const open = !!ui.catOpen[key];
      const color = g.id === '__sin' ? OTROS_COLOR : catColor(g.id);
      const icon = g.id === '__sin' ? spriteIcon('more') : iconSvg(categoryIconName(g.id));
      const subs = g.subs.filter((s) => s.value > 0 || prevSubTotals.get(s.id) > 0);
      const detail = open ? `
        ${subs.map((s) => `
        <button type="button" class="crow sub" data-catmoves="${esc(g.id)}" data-subid="${esc(s.id)}">
          <div class="l1"><b>${esc(s.name)}</b><span class="num money">${esc(fmtPlain(s.value))}</span></div>
          ${metricsHTML(s.value, prevSubTotals.get(s.id) || 0)}
        </button>`).join('')}
        <div class="crow sub"><button type="button" class="link" data-catmoves="${esc(g.id)}">Ver movimientos de ${esc(g.name)}${spriteIcon('cr').replace('class="ic"', 'class="ic chev"')}</button></div>` : '';
      return `
      <div class="${open ? 'expanded' : ''}">
        <button type="button" class="crow" data-catopen="${esc(key)}" aria-expanded="${open}">
          <span class="cic" style="--c:${color}">${icon}</span>
          <div class="crow-main">
            <div class="l1"><b>${esc(g.name)}</b><span class="num money">${esc(fmtPlain(g.total))}</span></div>
            <div class="l2"><div class="barline" style="--c:${color}"><i style="width:${Math.max(1, pctOf(g.total))}%"></i></div></div>
            ${metricsHTML(g.total, prevTotals.get(g.id) || 0)}
          </div>
          ${spriteIcon('cr').replace('class="ic"', `class="ic chev${open ? ' rot' : ''}"`)}
        </button>${detail}
      </div>`;
    }).join('');
    const zeroOpen = !!ui.catOpen[`${type}:__zero`];
    // El grupo de las que están en $ 0: cuánto bajaron en total contra el
    // mes anterior y, abiertas, cada una con su variación.
    zeroGroups.sort((a, b) => (prevTotals.get(b.id) || 0) - (prevTotals.get(a.id) || 0));
    const zeroPrev = zeroGroups.reduce((a, c) => a + (prevTotals.get(c.id) || 0), 0);
    const zeroHTML = zeroGroups.length ? `
      <div class="${zeroOpen ? 'expanded' : ''}">
        <button type="button" class="crow" data-catopen="${type}:__zero" aria-expanded="${zeroOpen}">
          <span class="cic" style="--c:var(--t3)">${spriteIcon('more')}</span>
          <div class="crow-main"><div class="l1"><b class="t2">${zeroGroups.length} sin ${isInc ? 'ingresos' : 'gastos'} todavía</b></div>
            <div class="st t3">${zeroPrev > 0 ? `<span class="money zero-drop${isInc ? ' bad' : ''}">−${esc(fmtPlain(zeroPrev))} vs. ${esc(prevShortM)}</span> · ` : ''}${esc(zeroGroups.map((c) => c.name).join(', '))}</div></div>
          ${spriteIcon('cd').replace('class="ic"', `class="ic chev${zeroOpen ? ' rot180' : ''}"`)}
        </button>
        ${zeroOpen ? zeroGroups.map((c) => `
        <button type="button" class="crow sub" data-catmoves="${esc(c.id)}">
          <div class="l1"><b>${esc(c.name)}</b><span class="num money t3">${esc(fmtPlain(0))}</span></div>
          ${prevTotals.get(c.id) > 0 ? metricsHTML(0, prevTotals.get(c.id)) : ''}
        </button>`).join('') : ''}
      </div>` : '';

    // Por medio de pago (solo gastos), en grises: son cuentas, no categorías.
    const byMethod = new Map();
    if (!isInc) {
      for (const t of inMonth) {
        if (t.type !== 'gasto') continue;
        const v = txDispAmount(t);
        if (v == null) continue;
        const k = methodById(t.methodId) || isSavingMethod(t.methodId) ? t.methodId : '__sin';
        byMethod.set(k, (byMethod.get(k) || 0) + v);
      }
    }
    const methodRows = [...byMethod.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
      .map(([id, value], i) => ({ id, value, name: id === '__sin' ? 'Sin medio de pago' : methodName(id), color: NEUTRAL_PALETTE[Math.min(i + 1, NEUTRAL_PALETTE.length - 1)] }));

    // Evolución de una categoría (o subcategoría) en los últimos 6 meses:
    // en pesos, en % de los gastos o en % de los ingresos de cada mes.
    const evoMonths = [];
    for (let i = 5; i >= 0; i--) evoMonths.push(addMonthsKey(mk, -i));
    const evoTxs = txs.filter((t) => t.type === type && evoMonths.includes(monthKeyOf(t.date)));
    const evoOptions = [];
    for (const c of S().categories.filter((x) => x.type === type && !x.parentId)) {
      if (!evoTxs.some((t) => topCategoryOf(t.categoryId) === c.id)) continue;
      evoOptions.push({ id: c.id, name: c.name, top: c.id });
      for (const sc of S().categories.filter((x) => x.parentId === c.id)) {
        if (evoTxs.some((t) => t.categoryId === sc.id)) evoOptions.push({ id: sc.id, name: sc.name, top: c.id, sub: true });
      }
    }
    const evoKey = isInc ? 'catEvoInc' : 'catEvoExp';
    if (!evoOptions.some((o) => o.id === ui[evoKey])) ui[evoKey] = breakdown[0] && breakdown[0].id !== '__sin' ? breakdown[0].id : (evoOptions[0] ? evoOptions[0].id : null);
    const evoOpt = evoOptions.find((o) => o.id === ui[evoKey]);
    const evoId = evoOpt ? evoOpt.id : null;
    const evoMode = ['nom', 'gastos', 'ingresos'].includes(ui.catEvoMode) ? ui.catEvoMode : 'nom';
    const evoRows = evoOpt ? evoMonths.map((m) => {
      const cut = m === curMonth() ? todayDay : 99;
      const list = txs.filter((t) => monthKeyOf(t.date) === m && Number(t.date.slice(8, 10)) <= cut);
      const v = sumDisp(list.filter((t) => t.type === type && (evoOpt.sub ? t.categoryId === evoOpt.id : topCategoryOf(t.categoryId) === evoOpt.id)));
      let value = v;
      if (evoMode !== 'nom') {
        const base = sumDisp(list.filter((t) => t.type === (evoMode === 'gastos' ? 'gasto' : 'ingreso')));
        value = base > 0 ? (v / base) * 100 : null;
      }
      return { label: monthShortLabel(m).toLowerCase(), value, raw: v };
    }) : [];
    const evoFirst = evoRows.findIndex((r) => r.raw > 0);
    const evoParent = evoOpt && evoOpt.sub ? catName(evoOpt.top) : '';

    el.innerHTML = `${chipsHTML}
      <section class="k-card donut-card">
        ${breakdown.length ? donutSvg(donutItems, total) : ''}
        <div class="donut-text">
          <span class="ovl">${isInc ? 'Entró' : 'Gastado'} en ${esc(monthName(mk))}</span>
          <span class="num money donut-total">${esc(fmtPlain(total))}</span>
          <span class="t2">${isCurrent ? `Hasta hoy, día ${todayDay}. ` : ''}${breakdown.length === 1 ? 'Una categoría' : `${breakdown.length} categorías`} con ${isInc ? 'ingresos' : 'gastos'}.</span>
        </div>
      </section>

      ${listRows.length || zeroGroups.length ? `
      <div class="group cat-group">${rowsHTML}${zeroHTML}</div>` : ''}

      ${methodRows.length ? `
      <section class="k-card">
        <div class="k-card-h"><h2>Por medio de pago</h2></div>
        <div class="stack">${methodRows.map((r) => `<i style="width:${((r.value / total) * 100).toFixed(2)}%;background:${r.color}"></i>`).join('')}</div>
        <div class="cat-lines">
          ${methodRows.map((r) => `
          <button type="button" class="cat-line" data-methodmoves="${esc(r.id)}">
            <i style="background:${r.color}"></i><span class="cat-line-name">${esc(r.name)}</span>
            <span class="t3 cat-line-pct">${pctOf(r.value)}%</span><span class="num">${money(r.value)}</span>
          </button>`).join('')}
        </div>
      </section>` : ''}

      ${evoOptions.length ? `
      <section class="k-card">
        <div class="k-card-h"><h2>Evolución por categoría</h2></div>
        <button type="button" class="evo-pick" data-evopick>
          <span class="cic" style="--c:${catColor(evoOpt.top)}">${iconSvg(categoryIconName(evoOpt.top))}</span>
          <span class="evo-pick-name">${evoParent ? `<small class="t3">${esc(evoParent)} ›</small> ` : ''}${esc(evoOpt.name)}</span>
          ${spriteIcon('cd').replace('class="ic"', 'class="ic chev"')}
        </button>
        <div class="tseg tseg-small evo-mode" role="tablist" aria-label="Mostrar en">
          ${[['nom', 'En $'], ['gastos', '% de gastos'], ['ingresos', '% de ingresos']].map(([k, l]) => `<button type="button" role="tab" class="${evoMode === k ? 'on' : ''}" aria-selected="${evoMode === k}" data-evomode="${k}">${l}</button>`).join('')}
        </div>
        ${evoFirst >= 0 ? categoryEvoSvg(evoRows.slice(evoFirst), catColor(evoOpt.top), evoMode !== 'nom') : '<div class="empty">Sin movimientos en los últimos meses.</div>'}
      </section>` : ''}`;

    wireCatKindChips(el);
    // Los movimientos de una categoría (o subcategoría, o medio de pago)
    // del mes, comparados con el mes anterior.
    const forRow = (list, gid, subId) => {
      const m = list.filter((t) => t.type === type);
      if (subId) return subId.endsWith(':directo') ? m.filter((t) => t.categoryId === gid) : m.filter((t) => t.categoryId === subId);
      if (gid === '__sin') return m.filter((t) => !t.categoryId || !catById(t.categoryId));
      return m.filter((t) => topCategoryOf(t.categoryId) === gid);
    };
    const monthAll = txs.filter((t) => monthKeyOf(t.date) === mk);
    el.addEventListener('click', (e) => {
      let b;
      if ((b = e.target.closest('[data-catopen]'))) {
        const k = b.dataset.catopen;
        ui.catOpen = { ...ui.catOpen, [k]: !ui.catOpen[k] };
        render();
        return;
      }
      if ((b = e.target.closest('[data-catmoves]'))) {
        const gid = b.dataset.catmoves, subId = b.dataset.subid;
        const g = listRows.find((x) => x.id === gid);
        const label = subId ? ((g && g.subs.find((s) => s.id === subId)) || {}).name || catName(gid) : (g ? g.name : catName(gid));
        categoryCompareDialog(label, mk, forRow(monthAll, gid, subId), prevMk, forRow(inPrevFull, gid, subId));
        return;
      }
      if ((b = e.target.closest('[data-methodmoves]'))) {
        const id = b.dataset.methodmoves;
        const pick = (list) => list.filter((t) => t.type === 'gasto' && (id === '__sin' ? !(methodById(t.methodId) || isSavingMethod(t.methodId)) : t.methodId === id));
        categoryCompareDialog(id === '__sin' ? 'Sin medio de pago' : methodName(id), mk, pick(monthAll), prevMk, pick(inPrevFull));
        return;
      }
      if ((b = e.target.closest('[data-evomode]'))) { ui.catEvoMode = b.dataset.evomode; render(); return; }
      if (e.target.closest('[data-evopick]')) {
        filterSheet('Categoría', evoOptions.map((o) => ({
          value: o.id, label: o.name, sub: o.sub,
          icon: o.sub ? '' : iconSvg(categoryIconName(o.id)), color: catColor(o.top),
        })), evoId, (v) => { ui[evoKey] = v; });
      }
    });
  }
  // Totales de ingresos y gastos de cada mes (los últimos 12 con datos).
  function incomeExpenseDetail(mk) {
    const txs = S().transactions;
    const rows = [];
    for (let i = 0; i < 12; i++) {
      const m = addMonthsKey(mk, -i);
      const list = txs.filter((t) => monthKeyOf(t.date) === m && (m !== curMonth() || t.date <= todayStr()));
      const inc = sumDisp(list.filter((t) => t.type === 'ingreso'));
      const exp = sumDisp(list.filter((t) => t.type === 'gasto'));
      if (inc > 0 || exp > 0) rows.push({ m, inc, exp });
    }
    const tot = rows.reduce((a, r) => ({ inc: a.inc + r.inc, exp: a.exp + r.exp }), { inc: 0, exp: 0 });
    const line = (label, inc, exp, cls = '') => {
      const d = inc - exp;
      return `<div class="ie-row${cls}">
        <div class="ie-m">${label}</div>
        <span class="num money ie-d${d < 0 ? ' neg' : ''}">${d < 0 ? '−' : ''}${esc(fmtPlain(Math.abs(d)))}</span>
        <div class="ie-sub"><span>Entró <b class="num money pos">+${esc(fmtPlain(inc))}</b></span><span>Salió <b class="num money">−${esc(fmtPlain(exp))}</b></span></div>
      </div>`;
    };
    openPanel({
      title: 'Ingresos y gastos',
      subtitle: rows.length ? `Últimos ${rows.length} ${rows.length === 1 ? 'mes' : 'meses'}` : '',
      body: rows.length ? `<div class="ie-table">
        <div class="ie-row ie-head"><span>Mes</span><span>Quedó</span></div>
        ${rows.map((r) => line(`${esc(monthShortLabel(r.m))}${r.m === curMonth() ? '<small class="t3"> en curso</small>' : ''}`, r.inc, r.exp)).join('')}
        ${rows.length > 1 ? line('Total', tot.inc, tot.exp, ' ie-total') : ''}
      </div>` : '<div class="empty">Sin movimientos.</div>',
    });
  }
  function wireCatKindChips(el) {
    $$('[data-catkind]', el).forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.catkind === ui.catKind) return;
      ui.catKind = b.dataset.catkind;
      render();
    }));
  }


  /* ================= Vista: Tarjetas y medios ================= */
  function methodForm(method) {
    const editing = !!method;
    const m = method || { name: '', kind: 'efectivo' };
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
      <span class="hint" id="m-hint" hidden>El cierre y vencimiento de cada resumen se cargan a mano, con su fecha real, desde "Resúmenes" en la tarjeta (una vez guardada acá).</span>`;

    const dlg = openDialog(editing ? 'Editar medio de pago' : 'Nuevo medio de pago', body, {
      onSubmit(d) {
        const data = { name: d.name.trim(), kind: d.kind };
        if (editing) Object.assign(method, data);
        else S().methods.push({ id: Store.uid(), ...data });
        Store.save();
        render();
      },
    });
    const toggle = () => {
      const isCredit = $('#m-kind', dlg).value === 'credito';
      $('#m-hint', dlg).hidden = !isCredit;
    };
    $('#m-kind', dlg).addEventListener('change', toggle);
    toggle();
  }

  /* Cada resumen se identifica por sus DOS fechas (cierre y vencimiento),
     nunca por "el mes" — es ambiguo apenas cierre y vencimiento caen en
     meses distintos, o el vencimiento de un resumen cae en medio del
     ciclo siguiente (algo bastante común). cardResumeRows() arma la
     lista cronológica de resúmenes ya cargados, más uno "fantasma" al
     final con la fecha que se ASUME (mismo día que el último cargado)
     para poder cargarlo con un toque en vez de adivinar a qué mes
     corresponde un formulario suelto. */
  function cardResumeRows(card) {
    const rows = cardResumes(card).map((r) => ({
      ...r, due: r.due || nextCardDate(card, 'dueDay', r.close, true), real: true,
    }));

    const lastClose = rows.length ? rows[rows.length - 1].close : null;
    let nextClose = lastClose
      ? nextCardDate(card, 'closingDay', lastClose, true)
      : nextCardDate(card, 'closingDay', new Date(), false);
    // Tarjeta sin ningún resumen cargado todavía (ni un día habitual de
    // compatibilidad): no hay ninguna fecha de la cual partir. Mostrar
    // igual una fila para cargar el primer resumen, arrancando de hoy
    // como sugerencia editable en vez de dejar la lista vacía.
    if (!nextClose && !lastClose) {
      nextClose = new Date();
      nextClose.setHours(0, 0, 0, 0);
    }
    if (nextClose) {
      rows.push({
        key: dateToStr(nextClose),
        close: nextClose, due: nextCardDate(card, 'dueDay', nextClose, true),
        dueAssumed: true, real: false,
      });
    }
    return rows;
  }

  /* El resumen "actual" de la lista: el último que ya cerró pero todavía
     no venció (el que hay que pagar ahora). Si no hay ninguno así (por
     ejemplo, recién arrancando la tarjeta), el próximo que va a cerrar. */
  function cardActualRowIndex(rows) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let idx = -1;
    rows.forEach((r, i) => { if (r.close <= today && (!r.due || today <= r.due)) idx = i; });
    if (idx === -1) idx = rows.findIndex((r) => r.close > today);
    return idx === -1 ? rows.length - 1 : idx;
  }

  /* Lista de resúmenes de una tarjeta: cada fila son sus dos fechas, sin
     nombre de mes. Tocar una fila abre su edición puntual (sin adivinar
     a qué período corresponde un formulario suelto). */
  function cardResumesDialog(card) {
    const rows = cardResumeRows(card);
    const actualIdx = cardActualRowIndex(rows);
    const rowsHTML = rows.map((r, i) => {
      const closeLabel = fmtDateShort(dateToStr(r.close));
      const dueLabel = r.due ? `${r.dueAssumed ? '~' : ''}${fmtDateShort(dateToStr(r.due))}` : 'sin cargar';
      return `<div class="${r.real ? 'swipe swipe-card' : ''}"><div class="resume-row ${r.real ? '' : 'is-ghost'}" data-resumeidx="${i}">
        <div class="resume-row-main">
          <div class="resume-row-top">
            ${i === actualIdx ? '<span class="resume-badge">Actual</span>' : ''}
            <span class="resume-row-dates">Cierre ${esc(closeLabel)} → Vence ${esc(dueLabel)}</span>
          </div>
          ${!r.real ? '<div class="hint">Todavía no cargado — tocá para confirmar la fecha real</div>' : ''}
        </div>
      </div>${r.real ? `<div class="swipe-actions"><button type="button" class="sw-del" data-resumedel="${esc(r.key)}" aria-label="Quitar el resumen del ${esc(closeLabel)}">${iconSvg('trash')}<span>Quitar</span></button></div>` : ''}</div>`;
    }).join('');

    const body = `
      <div class="resume-list">${rowsHTML}</div>
      <div class="hint" style="margin-top:10px">Tocá un resumen para cargar o corregir su fecha real; deslizalo a la izquierda para quitarlo.</div>
      <button type="button" class="link-btn" id="ov-toggle-upcoming">Ver más adelante</button>
      <div id="ov-upcoming" hidden></div>`;

    const dlg = openDialog(`Resúmenes de ${card.name}`, body, { submitLabel: 'Cerrar', viewOnly: true });
    $$('[data-resumeidx]', dlg).forEach((rowEl) => rowEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-resumedel]')) return;
      const row = rows[Number(rowEl.dataset.resumeidx)];
      dlg.close();
      cardResumeEditForm(card.id, row);
    }));
    $$('[data-resumedel]', dlg).forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const c = methodById(card.id);
      if (!c) { dlg.close(); return; }
      const key = b.dataset.resumedel;
      const saved = (c.overrides || {})[key];
      delete (c.overrides || {})[key];
      realignCardInstallments();
      Store.save();
      dlg.close();
      render();
      cardResumesDialog(c);
      showToast('Se quitó el resumen', {
        action: 'Deshacer', duration: 5000,
        onAction: () => {
          const c2 = methodById(card.id);
          if (!c2) return;
          c2.overrides = c2.overrides || {};
          c2.overrides[key] = saved;
          realignCardInstallments();
          Store.save();
          render();
          if ($('#dialog').open) { $('#dialog').close(); cardResumesDialog(c2); }
        },
      });
    }));
    const upcomingBox = $('#ov-upcoming', dlg);
    $('#ov-toggle-upcoming', dlg).addEventListener('click', (ev) => {
      const btn = ev.currentTarget;
      const willShow = upcomingBox.hidden;
      if (willShow && !upcomingBox.dataset.filled) {
        const cycles = cardUpcomingCycles(card, 6);
        upcomingBox.innerHTML = cycles.length
          ? `<div class="table-scroll"><table class="data">
              <thead><tr><th>Cierre</th><th>Vencimiento</th></tr></thead>
              <tbody>${cycles.map((c) => `<tr>
                <td>${esc(fmtDateShort(dateToStr(c.close)))}</td>
                <td>${c.due ? esc(fmtDateShort(dateToStr(c.due))) : '—'}</td>
              </tr>`).join('')}</tbody>
            </table></div>`
          : '<div class="empty">Cargá el cierre de un resumen arriba para poder proyectar los próximos.</div>';
        upcomingBox.dataset.filled = '1';
      }
      upcomingBox.hidden = !willShow;
      btn.textContent = willShow ? 'Ocultar' : 'Ver más adelante';
    });
  }

  /* Carga o corrige el cierre y vencimiento REALES de UN resumen puntual
     ya identificado (row viene de cardResumeRows/cardResumesDialog, así
     que no hay que adivinar a qué período corresponde el formulario). */
  function cardResumeEditForm(cardId, row) {
    const body = `
      <div class="field">
        <label for="ov-close">Fecha real de cierre de este resumen</label>
        <input type="date" name="closeDate" id="ov-close" value="${esc(dateToStr(row.close))}" required>
      </div>
      <div class="field">
        <label for="ov-due">Fecha real de vencimiento de este resumen</label>
        <input type="date" name="dueDate" id="ov-due" value="${row.due ? esc(dateToStr(row.due)) : ''}">
      </div>
      <span class="hint">${row.real
        ? 'Corregí las fechas de este resumen si hace falta.'
        : 'Es una fecha estimada (mismo día que tu último resumen cargado) — confirmala o corregila con la real.'}</span>`;

    openDialog(row.real ? 'Editar resumen' : 'Cargar resumen', body, {
      submitLabel: 'Guardar',
      onSubmit(d, dlg) {
        if (!d.closeDate) return false;
        const closeDate = parseDate(d.closeDate);
        const newKey = d.closeDate;
        const dueDate = d.dueDate ? parseDate(d.dueDate) : null;
        // Un resumen vence siempre DESPUÉS de cerrar: con las fechas al
        // revés (ej. cierre 01/10 → vence 30/09) todo el ciclo de la
        // tarjeta y la proyección de los próximos resúmenes quedaban mal.
        if (dueDate && dueDate <= closeDate) {
          alert('El vencimiento tiene que ser posterior al cierre del resumen.');
          return false;
        }
        // La tarjeta se busca recién ACÁ (no se guarda el objeto al abrir
        // el formulario): si mientras tanto la app se sincronizó con la
        // nube, el estado en memoria es otro y editar el objeto viejo no
        // guardaba nada.
        const card = methodById(cardId);
        if (!card) { dlg.close(); return false; }
        card.overrides = card.overrides || {};
        // Si cambió la fecha de cierre, mover la entrada a la clave nueva
        // en vez de dejar una copia vieja huérfana.
        if (row.real && row.key !== newKey) delete card.overrides[row.key];
        card.overrides[newKey] = {
          closingDay: closeDate.getDate(), closeDateStr: d.closeDate,
          ...(dueDate ? { dueDay: dueDate.getDate(), dueDateStr: d.dueDate } : {}),
        };
        realignCardInstallments();
        Store.save();
        render();
        // Hay que cerrar ESTE diálogo antes de reabrir la lista: son el
        // mismo <dialog> nativo por debajo, y reabrirlo (showModal) antes
        // de que termine de cerrarse lo dejaba en un estado roto.
        dlg.close();
        cardResumesDialog(card);
        return false;
      },
    });
  }

  /* ================= Tarjeta: cómo venís con el resumen en curso ================= */
  /* Todo lo que hace falta para el pop-up "Cómo vengo": el resumen en
     curso (lo gastado, lo ya cargado a futuro dentro del ciclo —cuotas,
     fijos— y una proyección al cierre al ritmo actual), los últimos
     resúmenes cerrados y una referencia contra la cual medir (el tope que
     haya puesto el usuario o, si no, el promedio de los últimos 3). Todo
     en la moneda de visualización y por fecha real de cada compra. */
  function cardAnalysis(card) {
    const cy = cardCycle(card);
    if (!cy || !cy.prevClose) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const txsIn = (from, to) => {
      const a = dateToStr(from), b = dateToStr(to);
      return S().transactions.filter((t) => t.type === 'gasto' && t.methodId === card.id && t.date > a && t.date <= b);
    };
    const isVar = (t) => !t.installment && !t.recurringId;
    const days = (a, b) => Math.max(0, Math.round((b - a) / DAY_MS));

    // Resúmenes cerrados, del más nuevo al más viejo (hasta 6).
    const history = [];
    let to = cy.prevClose;
    for (let i = 0; i < 6; i++) {
      const from = prevCardDate(card, 'closingDay', to);
      if (!from) break;
      const list = txsIn(from, to);
      history.push({
        from, to, due: nextCardDate(card, 'dueDay', to, true), txs: list,
        total: sumDisp(list), variable: sumDisp(list.filter(isVar)), days: days(from, to),
      });
      to = from;
    }

    // Resumen en curso.
    const curTxs = txsIn(cy.prevClose, cy.close);
    const todayStrV = dateToStr(today);
    const done = curTxs.filter((t) => t.date <= todayStrV);
    const ahead = curTxs.filter((t) => t.date > todayStrV);
    const spent = sumDisp(done);
    const committed = sumDisp(ahead);
    const elapsed = Math.max(1, days(cy.prevClose, today));
    const remaining = days(today, cy.close);
    const totalDays = Math.max(1, days(cy.prevClose, cy.close));
    // Ritmo diario de consumos (sin cuotas ni fijos, que no dependen de
    // cuánto uses la tarjeta). Con muy pocos días andados, un solo gasto
    // grande dispara cualquier proyección: hasta el día 5 se usa el ritmo
    // del resumen anterior.
    const varSpent = sumDisp(done.filter(isVar));
    let pace = varSpent / elapsed;
    let paceFromPrev = false;
    if (elapsed < 5 && history[0] && history[0].days > 0) {
      pace = history[0].variable / history[0].days;
      paceFromPrev = true;
    }
    const projected = spent + committed + pace * remaining;

    // Referencia: tope propio o promedio de los últimos 3 resúmenes.
    const lastN = history.filter((h) => h.total > 0).slice(0, 3);
    const avg = lastN.length ? lastN.reduce((a, h) => a + h.total, 0) / lastN.length : null;
    const capOwn = card.cap && card.cap.amount > 0 ? convOrNull(card.cap.amount, card.cap.currency) : null;
    const ref = capOwn != null ? capOwn : avg;
    const refLabel = capOwn != null ? 'tu tope' : (lastN.length === 1 ? 'tu último resumen' : `el promedio de tus últimos ${lastN.length} resúmenes`);

    // Cuándo conviene dejar de usarla.
    let verdict = null;
    if (ref != null) {
      const room = ref - spent - committed;
      if (room <= 0) {
        verdict = { tone: 'crit', room };
      } else if (pace > 0) {
        const hit = new Date(today.getTime() + Math.ceil(room / pace) * DAY_MS);
        verdict = hit < cy.close ? { tone: 'warn', room, hit } : { tone: 'ok', room };
      } else {
        verdict = { tone: 'ok', room };
      }
      verdict.perDay = remaining > 0 ? Math.max(0, verdict.room) / remaining : 0;
    }
    return {
      cy, history, curTxs, spent, committed, pace, paceFromPrev, projected, remaining, elapsed, totalDays,
      ref, refLabel, avg, capOwn, verdict,
      parts: {
        consumos: sumDisp(curTxs.filter(isVar)),
        cuotas: sumDisp(curTxs.filter((t) => t.installment)),
        fijos: sumDisp(curTxs.filter((t) => !t.installment && t.recurringId)),
      },
    };
  }

  /* "Cómo vengo" con una tarjeta, en un panel inferior: primero la
     respuesta (veredicto y proyección al cierre), después el detalle. */
  function cardAnalysisDialog(cardId) {
    const card = methodById(cardId);
    if (!card) return;
    const A = cardAnalysis(card);
    const short = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
    if (!A) {
      openPanel({
        title: 'Cómo vengo', subtitle: card.name,
        body: '<div class="empty">Cargá al menos el resumen anterior y el actual desde "Resúmenes" para ver cómo venís con esta tarjeta.</div>',
      });
      return;
    }
    const { cy, history, verdict } = A;
    // Montos cortos para las etiquetas de la barra y del gráfico ("$ 1,04 M").
    const shortMoney = (v) => (Math.abs(v) >= 1e6
      ? `${disp() === 'USD' ? 'US$' : '$'} ${(v / 1e6).toFixed(2).replace('.', ',')} M`
      : fmtPlain(v));
    const llevas = A.spent + A.committed;
    const extra = Math.max(0, A.projected - llevas);
    const last = history[0];
    const isCap = A.capOwn != null;
    // de/del, a/al según la referencia ("tu tope" / "el promedio de…").
    const refWith = (prep) => (A.refLabel.startsWith('el ') ? `${prep}l ${A.refLabel.slice(3)}` : `${prep} ${A.refLabel}`);

    // 1. Veredicto.
    const TONE = {
      ok: { label: 'Vas bien', color: 'var(--brand-text)', soft: 'var(--brand-soft)', icon: 'check' },
      warn: { label: 'Ojo', color: 'var(--warn)', soft: 'var(--warn-soft)', icon: 'bolt' },
      crit: { label: 'Te estás pasando', color: 'var(--neg)', soft: 'var(--neg-soft)', icon: 'up' },
      none: { label: 'Resumen en curso', color: 'var(--t2)', soft: 'var(--s2)', icon: 'card' },
    };
    const tone = verdict ? verdict.tone : 'none';
    const T = TONE[tone];
    let cmp = '';
    if (A.ref != null) {
      const d = A.projected - A.ref;
      cmp = Math.abs(d) < 1 ? `Igual que ${A.refLabel}` : `${fmtPlain(Math.abs(d))} ${d < 0 ? 'menos' : 'más'} que ${A.refLabel}`;
    } else {
      cmp = 'Todavía no hay resúmenes cerrados para comparar.';
    }
    const statusHTML = `
      <div class="statusbox" style="--tone:${T.color};--tone-soft:${T.soft}">
        <span class="k">${spriteIcon(T.icon)}${T.label}</span>
        <span class="t2">Al ritmo actual cerrás en</span>
        <span class="num money statusbox-big">${esc(fmtPlain(A.projected))}</span>
        <span class="t2 money statusbox-cmp">${esc(cmp)}</span>
      </div>`;

    // 2. Barra del resumen en curso con las marcas rotuladas directamente.
    const scale = Math.max(llevas, A.projected, A.ref || 0, last ? last.total : 0, 1) * 1.04;
    const pctOf = (v) => Math.max(0, Math.min(100, (v / scale) * 100));
    const marks = [
      { key: 'llevas', label: 'Llevás', v: llevas, row: 'top', bar: false },
      { key: 'ref', label: isCap ? 'Tope' : 'Promedio', v: A.ref, row: 'top', bar: true, color: 'var(--t2)' },
      { key: 'proj', label: 'Proyectado', v: A.projected, row: 'bottom', bar: false },
      { key: 'last', label: 'Último', v: last ? last.total : null, row: 'bottom', bar: true, color: 'var(--t3)' },
    ].filter((m) => m.v != null && m.v > 0 && !(m.key === 'proj' && Math.abs(A.projected - llevas) < 1));
    // Que las etiquetas no se pisen aunque los montos sean altos: cada una
    // se centra en su marca, o se alinea a un lado, o pasa a la otra fila;
    // si no entra en ningún lado, queda solo la marca (el monto está en la
    // leyenda de abajo).
    const LW = 27; // ancho estimado de una etiqueta, en % de la barra
    const rows = { top: [], bottom: [] };
    for (const m of marks) {
      const p = m.key === 'llevas' ? 0 : pctOf(m.v);
      const txs = m.key === 'llevas' ? [0] : [-50, 0, -100];
      const tryRow = (row) => {
        for (const tx of txs) {
          const s0 = p + (tx * LW) / 100, s1 = s0 + LW;
          if (s0 < -1 || s1 > 101) continue;
          if (rows[row].every((q) => s0 >= q.s1 + 1 || s1 <= q.s0 - 1)) {
            rows[row].push({ m, p, tx, s0, s1 });
            return true;
          }
        }
        return false;
      };
      if (!tryRow(m.row)) tryRow(m.row === 'top' ? 'bottom' : 'top');
    }
    const labelsHTML = ['top', 'bottom'].flatMap((row) => rows[row].map(({ m, p, tx }) =>
      `<span class="ml ml-${row}" style="left:${p.toFixed(1)}%;transform:translateX(${tx}%)">${m.label}<b class="money">${esc(shortMoney(m.v))}</b></span>`)).join('');
    const gaugeAria = marks.map((m) => `${m.label} ${hideAmounts ? '' : fmtPlain(m.v)}`).join(', ');
    const gaugeHTML = `
      <section class="k-card" style="--tone:${tone === 'none' ? 'var(--brand)' : T.color}">
        <span class="ovl">Resumen en curso</span>
        <div class="gauge" role="img" aria-label="${esc(gaugeAria)}">
          ${labelsHTML}
          <div class="track">
            <i style="width:${pctOf(A.spent).toFixed(2)}%;background:var(--tone)"></i><i style="width:${pctOf(A.committed).toFixed(2)}%;background:color-mix(in srgb,var(--tone) 50%,transparent)"></i><i class="hatch" style="width:${pctOf(extra).toFixed(2)}%"></i>
          </div>
          ${marks.filter((m) => m.bar).map((m) => `<span class="mk" style="left:${pctOf(m.v).toFixed(1)}%;background:${m.color}"></span>`).join('')}
        </div>
        <div class="legend gauge-legend">
          <span><i style="background:var(--tone)"></i>Gastado <b class="money">${esc(fmtPlain(A.spent))}</b></span>
          ${A.committed > 0 ? `<span><i style="background:color-mix(in srgb,var(--tone) 50%,transparent)"></i>Cuotas y fijos <b class="money">${esc(fmtPlain(A.committed))}</b></span>` : ''}
          ${extra > 0 ? `<span><i class="hatch"></i>Proyección <b class="money">${esc(fmtPlain(extra))}</b></span>` : ''}
        </div>
      </section>`;

    // 3. Tres datos.
    const kpisHTML = `
      <div class="kpis">
        ${verdict ? `<div><span>Podés gastar</span><span class="num money">${esc(fmtPlain(verdict.perDay))}</span><small>por día</small></div>` : ''}
        <div><span>Venís gastando</span><span class="num money">${esc(fmtPlain(A.pace))}</span><small>por día${A.paceFromPrev ? ' (ciclo anterior)' : ''}</small></div>
        <div><span>Ciclo</span><span class="num">Día ${Math.min(A.elapsed, A.totalDays)}</span><small>de ${A.totalDays}</small></div>
      </div>
      ${verdict ? `<p class="k-note k-note-out">${verdict.room > 0
        ? `Te quedan <b class="money">${esc(fmtPlain(verdict.room))}</b> hasta el cierre${tone === 'warn' ? `; al ritmo actual llegás ${esc(refWith('a'))} el ${esc(short(verdict.hit))}` : ''}.`
        : `Ya superás ${esc(A.refLabel)} por <b class="money">${esc(fmtPlain(-verdict.room))}</b>. Lo que compres desde el ${esc(short(new Date(cy.close.getTime() + DAY_MS)))} entra en el resumen siguiente.`}</p>` : ''}`;

    // 4. En qué se va.
    const partsTotal = A.parts.consumos + A.parts.cuotas + A.parts.fijos;
    const PARTS = [
      ['Consumos', A.parts.consumos, 'var(--brand)'],
      ['Cuotas', A.parts.cuotas, 'color-mix(in srgb,var(--brand) 50%,transparent)'],
      ['Fijos', A.parts.fijos, 'var(--s3)'],
    ];
    const partsHTML = `
      <section class="k-card">
        <div class="k-card-h"><h2>En qué se va</h2></div>
        <div class="stack">${partsTotal > 0 ? PARTS.filter(([, v]) => v > 0).map(([, v, c]) => `<i style="width:${((v / partsTotal) * 100).toFixed(2)}%;background:${c}"></i>`).join('') : ''}</div>
        <div class="legend">${PARTS.map(([l, v, c]) => `<span><i style="background:${c}"></i>${l} <b class="money">${esc(fmtPlain(v))}</b></span>`).join('')}</div>
      </section>`;

    // 5. Últimos resúmenes: barras grises de los cerrados y el en curso con
    // lo gastado sólido y la proyección rayada; línea punteada de la
    // referencia.
    const closed = history.slice(0, 5).reverse();
    const bars = [...closed.map((h) => ({ label: `Cierre ${short(h.to)}`, value: h.total })), { label: 'En curso', value: llevas, proj: A.projected, current: true }];
    const W = 320, H = 150, base = 120, topY = 22;
    const maxV = Math.max(1, ...bars.map((b) => Math.max(b.value, b.proj || 0)), A.ref || 0);
    const yv = (v) => base - (v / maxV) * (base - topY);
    const slot = W / bars.length;
    const bw = Math.min(48, slot * 0.55);
    const barsSvg = bars.map((b, i) => {
      const cx = slot * i + slot / 2, x = cx - bw / 2;
      const lab = hideAmounts ? '•••' : shortMoney(b.current ? b.proj : b.value).replace(/^US?\$ /, '');
      const body = b.current
        ? `${b.proj > b.value ? `<rect x="${x.toFixed(1)}" y="${yv(b.proj).toFixed(1)}" width="${bw.toFixed(1)}" height="${(base - yv(b.proj)).toFixed(1)}" rx="6" style="fill:url(#hatch)"/>` : ''}
           <rect x="${x.toFixed(1)}" y="${yv(b.value).toFixed(1)}" width="${bw.toFixed(1)}" height="${(base - yv(b.value)).toFixed(1)}" rx="4" style="fill:var(--brand)"/>`
        : `<rect x="${x.toFixed(1)}" y="${yv(b.value).toFixed(1)}" width="${bw.toFixed(1)}" height="${(base - yv(b.value)).toFixed(1)}" rx="6" style="fill:var(--s3)"/>`;
      const topV = b.current ? Math.max(b.value, b.proj) : b.value;
      return `${body}
        <text x="${cx.toFixed(1)}" y="${(yv(topV) - 7).toFixed(1)}" text-anchor="middle" class="g-lab"${b.current ? ' style="fill:var(--brand-text)"' : ''}>${esc(lab)}</text>
        <text x="${cx.toFixed(1)}" y="138" text-anchor="middle"${b.current ? ' class="g-sel"' : ''}>${esc(bars.length > 4 && !b.current ? b.label.replace('Cierre ', '') : b.label)}</text>`;
    }).join('');
    // La referencia se rotula en el encabezado de la tarjeta (no adentro
    // del gráfico, donde se pisaba con las barras altas).
    const refLine = A.ref ? `<line x1="4" x2="316" y1="${yv(A.ref).toFixed(1)}" y2="${yv(A.ref).toFixed(1)}" style="stroke:var(--brand-text)" stroke-width="1.5" stroke-dasharray="4 4"/>` : '';
    const varChip = (cur, prev) => {
      if (!(prev > 0)) return '';
      const lbl = fmtVarPct(((cur - prev) / prev) * 100);
      if (lbl == null) return '<span class="dchip flat">=</span>';
      return `<span class="dchip ${cur > prev ? 'bad' : 'good'}">${cur > prev ? '▲' : '▼'} ${lbl}%</span>`;
    };
    const histHTML = history.length ? `
      <section class="k-card">
        <div class="k-card-h"><h2>Últimos resúmenes</h2>${A.ref ? `<span class="legend legend-inline"><span><i class="lg-line lg-dash" style="border-color:var(--brand-text)"></i>${isCap ? 'Tope' : 'Promedio'} <b class="money">${esc(shortMoney(A.ref))}</b></span></span>` : ''}</div>
        <svg class="gchart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(bars.map((b) => `${b.label} ${hideAmounts ? '' : fmtPlain(b.current ? b.proj : b.value)}${b.current ? ' proyectado' : ''}`).join(', '))}">
          <defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" style="fill:var(--brand-soft)"/><line x1="0" y1="0" x2="0" y2="5" style="stroke:var(--brand)" stroke-width="2.4"/></pattern></defs>
          <line x1="0" x2="320" y1="${base}" y2="${base}" class="g-grid"/>
          ${barsSvg}${refLine}
        </svg>
        <div class="stmt-table">
          <div class="stmt-row stmt-head"><span>Cierre</span><span>Vence</span><span>Total</span><span></span></div>
          ${history.map((h, i) => `
          <button type="button" class="stmt-row" data-hist="${i}">
            <span>${esc(short(h.to))}</span><span class="t2">${h.due ? esc(short(h.due)) : '—'}</span>
            <span class="num money">${esc(fmtPlain(h.total))}</span><span>${history[i + 1] ? varChip(h.total, history[i + 1].total) : ''}</span>
          </button>`).join('')}
        </div>
        <p class="k-note">Según lo cargado en la app (sin impuestos ni cargos del banco).</p>
      </section>` : '';

    const days = A.remaining > 0 ? `faltan ${A.remaining} día${A.remaining === 1 ? '' : 's'}` : 'cierra hoy';
    openPanel({
      title: 'Cómo vengo',
      subtitle: `${card.name} · cierra ${short(cy.close)} · ${days}`,
      body: `<div class="como">
        ${statusHTML}${gaugeHTML}${kpisHTML}${partsHTML}${histHTML}
        <button type="button" class="btn btn-full btn-sec" data-cap>${spriteIcon('target')}${isCap ? 'Cambiar el tope' : 'Poner un tope'}</button>
        <button type="button" class="btn-ter" data-curmoves>Ver los movimientos del resumen</button>
      </div>`,
      onClick(e, dlg) {
        let b;
        if ((b = e.target.closest('[data-hist]'))) {
          const h = history[Number(b.dataset.hist)];
          closeSheet(dlg).then(() => methodPeriodDetailDialog(`${card.name} · resumen ${short(h.to)}`, h.txs));
          return;
        }
        if (e.target.closest('[data-curmoves]')) {
          closeSheet(dlg).then(() => methodPeriodDetailDialog(`${card.name} · resumen en curso`, A.curTxs));
          return;
        }
        if (e.target.closest('[data-cap]')) closeSheet(dlg).then(() => cardCapForm(card.id));
      },
    });
  }

  /* Tope propio por tarjeta para el pop-up "Cómo vengo" (vacío = usar el
     promedio de los últimos resúmenes). */
  function cardCapForm(cardId) {
    const card = methodById(cardId);
    if (!card) return;
    const cap = card.cap || {};
    openDialog('Tope del resumen', `
      <div class="field">
        <label for="cap-amount">Cuánto querés gastar como máximo por resumen</label>
        <input type="text" inputmode="decimal" name="amount" id="cap-amount" value="${cap.amount ? esc(String(cap.amount)) : ''}" placeholder="Vacío = usar el promedio">
      </div>
      <div class="field">
        <label for="cap-cur">Moneda</label>
        <select name="currency" id="cap-cur">
          <option value="ARS" ${cap.currency !== 'USD' ? 'selected' : ''}>ARS</option>
          <option value="USD" ${cap.currency === 'USD' ? 'selected' : ''}>USD</option>
        </select>
      </div>
      <span class="hint">Se usa para avisarte cuándo conviene dejar de usar la tarjeta en el resumen en curso.</span>`, {
      onSubmit(d, dlg) {
        const c = methodById(cardId);
        if (!c) return;
        const amount = parseAmountInput(d.amount || '');
        if (amount > 0) c.cap = { amount, currency: d.currency };
        else delete c.cap;
        Store.save();
        render();
        dlg.close();
        cardAnalysisDialog(cardId);
        return false;
      },
    });
    wireAmountInput($('#cap-amount'));
  }

  function vTarjetas(el) {
    const methods = S().methods;
    // Reordenar va en un modo "Editar" aparte; borrar y editar, detrás del ⋯.
    const editMode = !!ui.editMethods;
    const chev = spriteIcon('cr').replace('class="ic"', 'class="ic chev"');
    // A la derecha de cada cuenta: el ⋯ (editar, borrar) o, en modo
    // Ordenar, las flechas para moverla.
    const tail = (m) => {
      const i = methods.indexOf(m);
      return editMode ? `<span class="acc-reorder">
          <button type="button" class="icb" data-move="${esc(m.id)}:-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir ${esc(m.name)}">${spriteIcon('up')}</button>
          <button type="button" class="icb" data-move="${esc(m.id)}:1" ${i === methods.length - 1 ? 'disabled' : ''} aria-label="Bajar ${esc(m.name)}">${spriteIcon('down')}</button>
        </span>`
        : `<button type="button" class="icb ghost" data-more="${esc(m.id)}" aria-label="Opciones de ${esc(m.name)}">${spriteIcon('more')}</button>`;
    };
    const cards = methods.filter((m) => m.kind === 'credito');
    const others = methods.filter((m) => m.kind !== 'credito');
    const monthLabel = new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(new Date());
    const cardHTML = (m) => {
      const cy = cardCycle(m);
      const nOv = Object.keys(m.overrides || {}).length;
      return `<section class="k-card acc-card">
        <div class="acc-head">
          <span class="cic" style="--c:${KIND_COLOR[m.kind] || OTROS_COLOR}">${iconSvg(methodIconName(m.id))}</span>
          <div class="row-main"><div class="tt">${esc(m.name)}</div><div class="st">Tarjeta de crédito${nOv ? ` · ${nOv} resumen${nOv === 1 ? '' : 'es'} cargado${nOv === 1 ? '' : 's'}` : ''}</div></div>
          ${tail(m)}
        </div>
        ${cardCycleTimeline(m)}
        ${cy ? `<div class="acc-lines">
          <button type="button" class="acc-line" data-detail="cur:${esc(m.id)}"><span>Resumen en curso</span><span class="num">${fmtDisp(cardPeriodTotal(m.id, cy.prevClose || new Date(0), cy.close))}</span>${chev}</button>
          ${cy.prevPrevClose ? `<button type="button" class="acc-line" data-detail="last:${esc(m.id)}"><span>Último resumen</span><span class="num">${fmtDisp(cardPeriodTotal(m.id, cy.prevPrevClose, cy.prevClose))}</span>${chev}</button>` : ''}
        </div>` : ''}
        <div class="acc-actions">
          <button type="button" class="btn btn-sm btn-sec" data-adjust="${esc(m.id)}">Resúmenes</button>
          ${cy ? `<button type="button" class="link" data-analysis="${esc(m.id)}">Cómo vengo${chev}</button>` : ''}
        </div>
      </section>`;
    };
    const otherRow = (m) => {
      const monthTotal = sumDisp(S().transactions.filter(
        (t) => t.methodId === m.id && t.type === 'gasto' && monthKeyOf(t.date) === curMonth()));
      return `<div class="row acc-row">
        <button type="button" class="acc-row-main" data-detail="month:${esc(m.id)}">
          <span class="cic" style="--c:${KIND_COLOR[m.kind] || OTROS_COLOR}">${iconSvg(methodIconName(m.id))}</span>
          <div class="row-main"><div class="tt">${esc(m.name)}</div><div class="st">Gastado en ${esc(monthLabel)}</div></div>
          <span class="num acc-amt">${fmtDisp(monthTotal)}</span>
        </button>
        ${tail(m)}
      </div>`;
    };
    el.innerHTML = `
      <div class="bar acc-bar">
        <h2 class="ovl">Tarjetas de crédito</h2>
        <span class="bar-actions">
          ${methods.length > 1 ? `<button type="button" class="link" id="btn-edit-methods">${editMode ? 'Listo' : 'Ordenar'}</button>` : ''}
          <button type="button" class="link" id="btn-add-method">${spriteIcon('plus')}Agregar</button>
        </span>
      </div>
      ${cards.length ? cards.map(cardHTML).join('')
        : '<div class="k-card"><div class="empty">Todavía no cargaste ninguna tarjeta de crédito. Agregala y después cargá el cierre y vencimiento con "Resúmenes".</div></div>'}
      ${others.length ? `<h2 class="ovl set-h">Otras cuentas</h2>
      <div class="group">${others.map(otherRow).join('')}</div>` : ''}`;

    $('#btn-add-method', el).addEventListener('click', () => methodForm(null));
    const editBtn = $('#btn-edit-methods', el);
    if (editBtn) editBtn.addEventListener('click', () => { ui.editMethods = !ui.editMethods; render(); });
    $$('[data-more]', el).forEach((b) => b.addEventListener('click', () => {
      const m = methodById(b.dataset.more);
      if (!m) return;
      openPanel({
        title: m.name,
        body: `<div class="pick-list">
          <button type="button" class="pick-row" data-mopt="edit"><span class="cic" style="--c:var(--t2)">${spriteIcon('note')}</span><span>Editar</span></button>
          <button type="button" class="pick-row pick-danger" data-mopt="del"><span class="cic" style="--c:var(--neg)">${iconSvg('trash')}</span><span>Borrar</span></button>
        </div>`,
        onClick(e, dlg) {
          const o = e.target.closest('[data-mopt]');
          if (!o) return;
          if (o.dataset.mopt === 'edit') { closeSheet(dlg).then(() => methodForm(m)); return; }
          const used = S().transactions.some((t) => t.methodId === m.id) || S().recurring.some((r) => r.methodId === m.id);
          if (used) {
            $('[data-shbody]', dlg).innerHTML = '<p class="t2">Este medio tiene movimientos o fijos asociados. Borrá o pasá esos movimientos a otra cuenta primero.</p>';
            return;
          }
          closeSheet(dlg).then(() => removeWithUndo('methods', m, `Se borró ${m.name}`));
        },
      });
    }));
    $$('[data-move]', el).forEach((b) => b.addEventListener('click', () => {
      const [id, dir] = b.dataset.move.split(':');
      moveMethod(id, Number(dir));
    }));
    $$('[data-adjust]', el).forEach((b) => b.addEventListener('click', () => {
      cardResumesDialog(methodById(b.dataset.adjust));
    }));
    $$('[data-analysis]', el).forEach((b) => b.addEventListener('click', () => cardAnalysisDialog(b.dataset.analysis)));
    $$('[data-detail]', el).forEach((b) => b.addEventListener('click', () => {
      const [kind, id] = b.dataset.detail.split(':');
      const m = methodById(id);
      if (!m) return;
      if (kind === 'month') {
        accountMonthDetailDialog(m);
        return;
      }
      const cy = cardCycle(m);
      if (!cy) return;
      const from = kind === 'cur' ? (cy.prevClose || new Date(0)) : cy.prevPrevClose;
      const to = kind === 'cur' ? cy.close : cy.prevClose;
      if (!from || !to) return;
      const a = dateToStr(from), bStr = dateToStr(to);
      const txs = S().transactions.filter(
        (t) => t.type === 'gasto' && t.methodId === id && t.date > a && t.date <= bStr);
      methodPeriodDetailDialog(`${m.name} · ${kind === 'cur' ? 'Resumen en curso' : 'Último resumen'}`, txs);
    }));
  }

  /* Una fila de movimiento, igual en Movimientos y en todos los pop-ups
     que listan movimientos: ícono, título (nota o categoría), categoría ·
     medio abajo, y el monto con signo y color (+ el equivalente en USD).
     amountClass(t) permite sumar una clase al monto (ej. resaltar los
     gastos grandes en Movimientos). */
  function txRowHTML(t, amountClass) {
    const usdLine = (t.currency === 'ARS' && t.usdSnapshot != null)
      ? `<div class="usd">≈ ${esc(fmtMoney(t.usdSnapshot, 'USD'))}</div>` : '';
    if (t.type === 'transferencia') {
      return `<div class="tx-card-row${ui.newTxIds && ui.newTxIds.ids.has(t.id) ? ' is-new' : ''}" data-tx="${esc(t.id)}">
        <div class="row-icon row-icon-transfer">${iconSvg('swap')}</div>
        <div class="tx-card-main">
          <div class="tx-card-title">${esc(t.note || 'Transferencia')}</div>
          <div class="tx-card-sub">${esc(methodName(t.methodId))} → ${esc(methodName(t.toMethodId))}</div>
        </div>
        <div class="tx-card-amount">
          <div class="v">${fmtMoney(t.amount, t.currency)}</div>
          ${usdLine}
        </div>
      </div>`;
    }
    const inst = t.installment ? ` · cuota ${t.installment.k}/${t.installment.n}` : '';
    const rec = t.recurringId ? ' · fijo' : (t.leftoverGen ? ' · sobrante' : '');
    const cur = t.currency === 'USD' ? ' · USD' : '';
    const isIncome = t.type === 'ingreso';
    const sign = isIncome ? '+' : '−';
    // El título ya es el nombre de la categoría cuando no hay nota
    // propia: repetirlo abajo en el subtítulo era redundante.
    const title = t.note || catName(t.categoryId);
    const subParts = [];
    if (t.note) subParts.push(catName(t.categoryId));
    subParts.push(methodName(t.methodId));
    return `<div class="tx-card-row${ui.newTxIds && ui.newTxIds.ids.has(t.id) ? ' is-new' : ''}" data-tx="${esc(t.id)}">
      <div class="row-icon cic" style="--c:${catColor(t.categoryId)}">${iconSvg(categoryIconName(t.categoryId))}</div>
      <div class="tx-card-main">
        <div class="tx-card-title">${esc(title)}</div>
        <div class="tx-card-sub">${esc(subParts.join(' · '))}${inst}${rec}${cur}</div>
      </div>
      <div class="tx-card-amount">
        <div class="v ${isIncome ? 'pos' : 'neg'}${amountClass ? amountClass(t) : ''}">${sign} ${fmtMoney(t.amount, t.currency)}</div>
        ${usdLine}
      </div>
    </div>`;
  }

  // Lista de movimientos agrupada por día: un bloque por día con la fecha
  // como encabezado ADENTRO del bloque (no suelta arriba) y las filas
  // separadas por una línea fina. La usan Movimientos y los pop-ups de
  // detalle (resumen de tarjeta, cuenta por mes, categoría vs. mes
  // anterior), así todos se ven igual.
  function txDayGroupsHTML(txs, emptyMsg, opts = {}) {
    const sorted = opts.presorted ? txs : txs.slice().sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    if (!sorted.length) return emptyMsg ? `<div class="empty">${esc(emptyMsg)}</div>` : '';
    return `<div class="tx-day-blocks">${dayGroups(sorted).map(({ dateStr, items }) => `
      <div class="tx-card-list tx-list-compact">
        <div class="tx-day-head">${esc(dayGroupLabel(dateStr))}</div>
        ${items.map((t) => txRowHTML(t, opts.amountClass)).join('')}
      </div>`).join('')}</div>`;
  }
  // Los diálogos de detalle de abajo son de solo lectura (no modifican
  // nada); tocar un movimiento abre su detalle, igual que en Movimientos.
  function wireTxDetailRows(dlg) {
    $$('.tx-card-row', dlg).forEach((row) => row.addEventListener('click', () => {
      const tx = S().transactions.find((t) => t.id === row.dataset.tx);
      if (tx) { dlg.close(); txDetailDialog(tx); }
    }));
  }

  /* Detalle de los movimientos que componen un total mostrado en "Tarjetas y
     medios" (resumen de tarjeta o gasto mensual de una cuenta): fecha, monto
     y descripción de cada uno que se está sumando. */
  function methodPeriodDetailDialog(title, txs) {
    const bodyHTML = `
      <div class="dialog-total">Total: ${fmtDisp(sumDisp(txs))}</div>
      ${txDayGroupsHTML(txs, 'No hay movimientos en este período.')}`;
    const dlg = openDialog(title, bodyHTML, { submitLabel: 'Cerrar', viewOnly: true });
    wireTxDetailRows(dlg);
  }

  /* Los mismos datos de un gráfico (Ahorros, por ahora), pero en tabla —
     para cuando "leer la curva" no alcanza y hace falta el número exacto
     de cada punto sin depender de un hover que en el celular no existe. */
  function chartTableDialog(title, headers, rows, opts = {}) {
    // opts.numFrom: desde qué columna los valores son números (alineados a
    // la derecha); opts.boldLast: la última columna resaltada (ej. total).
    const cls = (i) => [
      opts.numFrom != null && i >= opts.numFrom ? 'num' : '',
      opts.boldLast && i === headers.length - 1 ? 'col-strong' : '',
    ].filter(Boolean).join(' ');
    const bodyHTML = `<div class="table-scroll"><table class="data">
      <thead><tr>${headers.map((h, i) => `<th class="${cls(i)}">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${cls(i)}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
    openDialog(title, bodyHTML, { submitLabel: 'Cerrar', viewOnly: true });
  }

  /* Como methodPeriodDetailDialog(), pero para una cuenta sin resúmenes
     (débito, efectivo, caja de ahorro): antes solo mostraba el mes actual
     sin forma de moverse — acá se puede navegar mes a mes, igual que en
     Inicio, para ver por ejemplo cuánto se gastó el mes pasado con esa
     cuenta. */
  function accountMonthDetailDialog(method) {
    const dlg = $('#dialog');
    dlg.className = 'dialog';
    let month = curMonth();

    function paint() {
      const txs = S().transactions.filter(
        (t) => t.methodId === method.id && t.type === 'gasto' && monthKeyOf(t.date) === month);
      dlg.innerHTML = `
        <div class="dialog-head">
          <button type="button" class="icb" data-close aria-label="Cerrar">${spriteIcon('x')}</button>
          <span class="dialog-title">${esc(method.name)}</span>
          <span></span>
        </div>
        <div class="dialog-body">
          <div class="month panel-month">
            <button type="button" class="icb ghost" data-mnav="-1" aria-label="Mes anterior">${spriteIcon('cl')}</button>
            <span class="topbar-title">${esc(topbarMonthLabel(month))}</span>
            <button type="button" class="icb ghost" data-mnav="1" aria-label="Mes siguiente">${spriteIcon('cr')}</button>
            ${month === curMonth() ? '' : '<button type="button" class="link" data-mtoday>Volver al actual</button>'}
          </div>
          <div class="dialog-total">Total: ${fmtDisp(sumDisp(txs))}</div>
          ${txDayGroupsHTML(txs, 'No hay movimientos en este período.')}
        </div>`;
      $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => closeSheet(dlg)));
      $$('[data-mnav]', dlg).forEach((b) => b.addEventListener('click', () => {
        month = addMonthsKey(month, Number(b.dataset.mnav));
        paint();
      }));
      const btnToday = $('[data-mtoday]', dlg);
      if (btnToday) btnToday.addEventListener('click', () => { month = curMonth(); paint(); });
      wireTxDetailRows(dlg);
    }
    paint();
    openModal(dlg);
  }

  /* Detalle de una categoría (o subcategoría) desde "Análisis de
     categorías": a diferencia de methodPeriodDetailDialog(), muestra DOS
     meses en el mismo diálogo (el elegido y el anterior) — pedido
     puntualmente para poder comparar qué compone un total que aparece en
     rojo (aumentó) contra el mes de antes, sin ir y volver. */
  function categoryCompareDialog(label, mk, curTxs, prevMk, prevTxs) {
    const section = (mkLabel, list) => `
      <div class="cat-detail-section">
        <div class="cat-detail-section-head">
          <span>${esc(mkLabel)}</span>
          <span class="cat-detail-section-total">${fmtDisp(sumDisp(list))}</span>
        </div>
        ${txDayGroupsHTML(list, 'Sin movimientos ese mes.')}
      </div>`;
    const bodyHTML = section(monthLabel(mk), curTxs) +
      '<div class="cat-detail-divider"></div>' + section(monthLabel(prevMk), prevTxs);
    const dlg = openDialog(label, bodyHTML, { submitLabel: 'Cerrar', viewOnly: true });
    wireTxDetailRows(dlg);
  }

  /* ================= Vista: Calendario ================= */
  // Eventos (pagos e ingresos previstos) de un mes: fijos + vencimientos de tarjeta.
  function eventsForMonth(mk) {
    const [y, mo] = mk.split('-').map(Number);
    const events = [];

    for (const r of S().recurring) {
      const label = r.type === 'ingreso' ? 'Ingreso fijo' : 'Gasto fijo';
      if (r.freq === 'weekly' || r.freq === 'biweekly') {
        // No hay un "día del mes" fijo: puede caer 4 o 5 veces en el mismo
        // mes, así que se listan todas las ocurrencias reales que entran
        // dentro de ese mes en vez de una sola.
        if (!r.startDate) continue;
        const step = r.freq === 'weekly' ? 7 : 14;
        const monthStart = new Date(y, mo - 1, 1);
        const monthEnd = new Date(y, mo, 0);
        let cursor = parseDate(r.startDate);
        if (cursor < monthStart) {
          const steps = Math.ceil((monthStart - cursor) / DAY_MS / step);
          cursor = addDays(cursor, steps * step);
        }
        for (; cursor <= monthEnd; cursor = addDays(cursor, step)) {
          events.push({
            date: dateToStr(cursor), kind: r.type,
            icon: r.type === 'ingreso' ? '💰' : '🔁',
            title: r.name, sub: label + (r.freq === 'weekly' ? ' · semanal' : ' · quincenal'),
            amount: r.amount, currency: r.currency,
          });
        }
      } else {
        const d = clampDate(y, mo - 1, r.day);
        events.push({
          date: dateToStr(d), kind: r.type, // 'gasto' | 'ingreso'
          icon: r.type === 'ingreso' ? '💰' : '🔁',
          title: r.name, sub: label + ' · día ' + r.day,
          amount: r.amount, currency: r.currency,
        });
      }
    }

    for (const c of S().methods.filter((m) => m.kind === 'credito')) {
      for (const due of cardDateCandidates(c, 'dueDay', y, mo - 1)) {
        // Resumen que vence en esa fecha: el que cerró justo antes del vencimiento.
        const close = prevCardDate(c, 'closingDay', due);
        if (!close) continue;
        const prevClose = prevCardDate(c, 'closingDay', close);
        const amount = cardPeriodTotal(c.id, prevClose || new Date(0), close); // ya en moneda visible
        events.push({
          date: dateToStr(due), kind: 'card', icon: '💳',
          title: c.name, sub: 'Vencimiento tarjeta · día ' + due.getDate(),
          amountDisp: amount,
        });
      }
    }
    return events;
  }

  function eventAmountDisp(ev) {
    return ev.kind === 'card' ? ev.amountDisp : convOrNull(ev.amount, ev.currency);
  }

  /* Pop-up con el detalle de ingresos/gastos REALES de un día del
     Calendario — distinto de la "Agenda", que muestra compromisos
     previstos (fijos, tarjeta), no lo que efectivamente se cargó. Tocar
     una fila abre su detalle completo, igual que en Movimientos. */
  function dayDetailDialog(dateStr) {
    const dayTxs = S().transactions.filter((t) => t.date === dateStr && t.type !== 'transferencia');
    const gastoTotal = sumDisp(dayTxs.filter((t) => t.type === 'gasto'));
    const incomeTotal = sumDisp(dayTxs.filter((t) => t.type === 'ingreso'));
    const sorted = dayTxs.slice().sort((a, b) => b.id.localeCompare(a.id));
    const rowsHTML = sorted.length
      ? `<div class="tx-card-list tx-list-compact">${sorted.map((t) => txRowHTML(t)).join('')}</div>`
      : '<div class="empty">No cargaste gastos ni ingresos este día.</div>';

    const bodyHTML = `
      <div class="dialog-total">Gastos: ${fmtDisp(gastoTotal)} · Ingresos: ${fmtDisp(incomeTotal)}</div>
      ${rowsHTML}`;
    const dlg = openDialog(fmtDateFull(dateStr), bodyHTML, { submitLabel: 'Cerrar', viewOnly: true });
    $$('.tx-card-row', dlg).forEach((row) => row.addEventListener('click', () => {
      const tx = S().transactions.find((t) => t.id === row.dataset.tx);
      if (tx) { dlg.close(); txDetailDialog(tx); }
    }));
  }

  function vCalendario(el) {
    const mk = ui.month;
    // Si el mes se cambió desde otra hoja (Movimientos/Categorías comparten
    // el mismo estado), un día seleccionado de un mes distinto ya no tiene
    // sentido — sin esto quedaba resaltado un día que no corresponde al mes
    // que se está mostrando.
    if (ui.calSel && monthKeyOf(ui.calSel) !== mk) ui.calSel = null;
    const [y, mo] = mk.split('-').map(Number);
    const events = eventsForMonth(mk);
    const byDay = new Map();
    for (const ev of events) {
      if (!byDay.has(ev.date)) byDay.set(ev.date, []);
      byDay.get(ev.date).push(ev);
    }

    // Gastado por día calendario (fecha real del movimiento, no el mes
    // "efectivo" de una compra en cuotas o con tarjeta): sirve para pintar
    // cada celda con un gradiente según cuánto se gastó ese día puntual.
    const daySpend = new Map();
    for (const t of S().transactions) {
      if (t.type !== 'gasto' || monthKeyOf(t.date) !== mk) continue;
      const v = txDispAmount(t);
      if (v == null) continue;
      daySpend.set(t.date, (daySpend.get(t.date) || 0) + v);
    }
    const maxDaySpend = Math.max(0, ...daySpend.values());

    // Días con algún ingreso o gasto REAL cargado (no un evento previsto de
    // la agenda, que es otra cosa) — determina qué días abren el pop-up de
    // detalle al tocarlos.
    const daysWithTx = new Set();
    for (const t of S().transactions) {
      if ((t.type === 'gasto' || t.type === 'ingreso') && monthKeyOf(t.date) === mk) daysWithTx.add(t.date);
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
      // Clickeable si hay eventos previstos (agenda) O movimientos reales
      // cargados ese día — antes solo lo primero, así que un día con
      // gastos/ingresos pero sin gasto fijo/tarjeta no abría nada al tocarlo.
      const clickable = evs.length > 0 || daysWithTx.has(ds);
      const cls = ['cal-cell'];
      if (clickable) cls.push('has');
      if (ds === today) cls.push('today');
      if (ds === ui.calSel) cls.push('sel');
      // Gradiente de fondo según lo gastado ese día (relativo al día de más
      // gasto del mes que se está viendo): a la selección no se le toca el
      // fondo para que se siga viendo resaltada con su propio color.
      const spend = daySpend.get(ds) || 0;
      const heatStyle = (spend > 0 && maxDaySpend > 0 && ds !== ui.calSel)
        ? ` style="background:color-mix(in srgb, var(--expense-series) ${10 + Math.round((spend / maxDaySpend) * 60)}%, transparent)"`
        : '';
      return `<div class="${cls.join(' ')}"${heatStyle} ${clickable ? `data-day="${ds}"` : ''}>
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
      <div class="card">
        <h2 class="card-title"><span>Calendario</span></h2>
        <div class="cal-grid">
          ${dow.map((d) => `<div class="cal-dow">${d}</div>`).join('')}
          ${cells.map(cellHTML).join('')}
        </div>
        <div class="chart-legend" style="margin-top:12px">
          <span><span class="key" style="background:var(--expense-series)"></span>Gasto fijo</span>
          <span><span class="key" style="background:var(--income-series)"></span>Ingreso fijo</span>
          <span><span class="key" style="background:var(--accent)"></span>Tarjeta</span>
        </div>
        ${maxDaySpend > 0 ? '<div class="hint" style="margin-top:6px">El fondo de cada día se pinta más oscuro cuanto más gastaste esa fecha.</div>' : ''}
      </div>

      <div class="card">
        <h2 class="card-title">
          <span>${ui.calSel ? 'Día seleccionado' : 'Agenda del mes'}</span>
          ${ui.calSel ? '<button class="link-btn" data-calall>ver todo el mes</button>' : ''}
        </h2>
        <div class="agenda">${agendaHTML}</div>
      </div>`;

    $$('[data-day]', el).forEach((c) => c.addEventListener('click', () => {
      const ds = c.dataset.day;
      ui.calSel = (ui.calSel === ds) ? null : ds;
      render();
      dayDetailDialog(ds);
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
      </div>
      <div class="field">
        <label for="e-fxrate">Cotización del dólar de este movimiento <span class="hint">(opcional)</span></label>
        <input type="number" name="fxrate" id="e-fxrate" min="0" step="0.01" placeholder="${rate() ? String(rate().value) : 'p. ej. 1250'}">
      </div>
      <div class="hint">Si lo dejás vacío, se usa la cotización real de la fecha elegida (o la actual si no hay dato para ese día) — cargala solo si tu dólar fue distinto (cripto, cambio informal, etc.), para que el equivalente en la otra moneda quede bien.</div>
      ${sign > 0 ? `
      <label class="field field-check">
        <input type="checkbox" name="opening" id="e-opening">
        Ya lo tenía ahorrado antes (no contarlo como aporte de este mes)
      </label>
      <div class="hint">Usalo para cargar plata que ya tenías de meses anteriores, sin que ese mes puntual parezca que ahorraste todo eso de una — no afecta el total, sólo cómo se ve tu ritmo de ahorro mes a mes.</div>` : ''}`;
    openDialog(sign > 0 ? `Aporte a “${saving.name}”` : `Retiro de “${saving.name}”`, body, {
      submitLabel: sign > 0 ? 'Registrar aporte' : 'Registrar retiro',
      async onSubmit(d) {
        const amount = Math.round(parseFloat(d.amount) * 100) / 100;
        if (!(amount > 0)) return false;
        const signedAmount = amount * sign;
        const manualRate = parseFloat(d.fxrate);
        const entry = {
          id: Store.uid(), date: d.date, amount: signedAmount, note: d.note.trim(),
          opening: sign > 0 && !!d.opening,
        };
        // Mismo criterio que un movimiento normal: guarda el equivalente en
        // la otra moneda con la cotización DE ESE DÍA (o la manual, si se
        // cargó una) — así "Total ahorrado" y los gráficos no lo convierten
        // siempre con la cotización de HOY sin importar cuándo fue.
        if (manualRate > 0) {
          if (saving.currency === 'ARS') entry.usdSnapshot = Math.round((signedAmount / manualRate) * 100) / 100;
          else entry.arsSnapshot = Math.round((signedAmount * manualRate) * 100) / 100;
        } else if (saving.currency === 'ARS') {
          entry.usdSnapshot = await usdSnapshotForDate(signedAmount, 'ARS', d.date);
        } else {
          entry.arsSnapshot = await arsSnapshotForDate(signedAmount, 'USD', d.date);
        }
        saving.entries.push(entry);
        Store.save();
        render();
      },
    });
  }

  /* Saldo de un ahorro en su moneda y en la otra (cada aporte convertido
     con su propia cotización, ver savingEntryAmountIn). */
  function savingBalances(s) {
    const other = s.currency === 'ARS' ? 'USD' : 'ARS';
    const bal = s.entries.reduce((a, e) => a + e.amount, 0);
    const conv = s.entries.reduce((a, e) => {
      const v = savingEntryAmountIn(s, e, other);
      return v != null ? a + v : a;
    }, 0);
    const inDisp = s.entries.reduce((a, e) => {
      const v = savingEntryAmountIn(s, e, disp());
      return v != null ? a + v : a;
    }, 0);
    return { bal, conv, other, inDisp };
  }

  /* Detalle de un ahorro: saldo, meta, acciones e historial de aportes y
     retiros (antes todo vivía en la tarjeta, con cinco botones y la tabla
     desplegada adentro). */
  function savingDetailDialog(id) {
    const s = S().savings.find((x) => x.id === id);
    if (!s) return;
    const { bal, conv, other } = savingBalances(s);
    const pct = s.target ? Math.min(100, Math.round((bal / s.target) * 100)) : null;
    const entries = s.entries.slice().sort((a, b) => b.date.localeCompare(a.date));
    const body = `
      <div class="sav-det-head">
        <div class="sav-det-bal">${fmtMoney(bal, s.currency)}</div>
        ${s.entries.length ? `<div class="sav-det-conv">≈ ${fmtMoney(conv, other)}</div>` : ''}
        ${s.target ? `
        <div class="sav-goal">
          <div class="sav-goal-bar"><span style="width:${pct}%"></span></div>
          <div class="sav-goal-txt"><span>Meta ${fmtMoney(s.target, s.currency)}</span><b>${pct}%</b></div>
          ${bal < s.target ? `<div class="sav-goal-left">Te faltan ${fmtMoney(s.target - bal, s.currency)}</div>` : '<div class="sav-goal-left">¡Meta cumplida!</div>'}
        </div>` : ''}
      </div>
      <div class="sav-det-actions">
        <button type="button" class="btn btn-primary btn-sm" data-sav-act="add">+ Aporte</button>
        <button type="button" class="btn btn-sm" data-sav-act="sub">− Retiro</button>
        <button type="button" class="btn btn-sm" data-sav-act="edit">Editar</button>
      </div>
      <div class="ca-section-title">Historial</div>
      ${entries.length ? `<div class="tx-card-list tx-list-compact sav-hist">
        ${entries.map((e) => `<div class="tx-card-row sav-hist-row">
          <div class="row-icon ${e.amount >= 0 ? 'row-icon-income' : 'row-icon-expense'}">${iconSvg(e.amount >= 0 ? 'trend' : 'cash')}</div>
          <div class="tx-card-main">
            <div class="tx-card-title">${esc(e.note || (e.amount >= 0 ? 'Aporte' : 'Retiro'))}${e.opening ? ' <span class="badge">histórico</span>' : ''}${e.linkedTxId ? ' <span class="badge">gasto</span>' : ''}</div>
            <div class="tx-card-sub">${esc(fmtDateFull(e.date))}</div>
          </div>
          <div class="tx-card-amount"><div class="v ${e.amount >= 0 ? 'pos' : 'neg'}">${e.amount >= 0 ? '+' : '−'} ${fmtMoney(Math.abs(e.amount), s.currency)}</div></div>
          ${e.linkedTxId
            ? '<span class="sav-lock" title="Se borra junto con el gasto que lo generó">🔒</span>'
            : `<button type="button" class="tx-card-del" data-edel="${esc(e.id)}" aria-label="Eliminar">✕</button>`}
        </div>`).join('')}
      </div>` : '<div class="empty">Todavía no hay aportes ni retiros.</div>'}`;
    const dlg = openDialog(s.name, body, {
      submitLabel: 'Cerrar', viewOnly: true,
      footExtra: '<button type="button" class="btn btn-danger" data-sav-act="del" style="margin-right:auto">Eliminar</button>',
    });
    $$('[data-sav-act]', dlg).forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.savAct;
      if (act === 'del') {
        if (!confirm(`¿Eliminar “${s.name}” y todo su historial?`)) return;
        S().savings = S().savings.filter((x) => x.id !== s.id);
        Store.save();
        dlg.close();
        render();
        return;
      }
      dlg.close();
      if (act === 'add') savingEntryForm(s, 1);
      else if (act === 'sub') savingEntryForm(s, -1);
      else savingForm(s);
    }));
    $$('[data-edel]', dlg).forEach((b) => b.addEventListener('click', () => {
      if (!confirm('¿Eliminar este movimiento del ahorro?')) return;
      s.entries = s.entries.filter((e) => e.id !== b.dataset.edel);
      Store.save();
      render();
      dlg.close();
      savingDetailDialog(id);
    }));
  }

  function vAhorros(el) {
    const savings = S().savings;
    const otherCur = disp() === 'ARS' ? 'USD' : 'ARS';
    let total = 0, totalOther = 0;
    for (const s of savings) {
      for (const e of s.entries) {
        const v = savingEntryAmountIn(s, e, disp());
        if (v != null) total += v;
        const o = savingEntryAmountIn(s, e, otherCur);
        if (o != null) totalOther += o;
      }
    }

    // Ventana de meses para los gráficos de abajo: desde el primer mes
    // con algún movimiento cargado hasta el actual, sin pasar de 12 meses
    // (para que una cuenta vieja no termine con un gráfico ilegible).
    const savAllMonths = [...new Set(savings.flatMap((s) => s.entries.map((e) => monthKeyOf(e.date))))].sort();
    let savMonths = [];
    if (savAllMonths.length) {
      let m = savAllMonths[0];
      const cm = curMonth();
      while (m <= cm) { savMonths.push(m); m = addMonthsKey(m, 1); }
      // Los meses sin ingresos no entran a ningún gráfico (tampoco al
      // nominal ni al acumulado), igual que en el resto de la app.
      savMonths = savMonths.filter((m) => S().transactions.some((t) => t.type === 'ingreso' && effectiveMonthOf(t) === m));
      if (savMonths.length > 12) savMonths = savMonths.slice(-12);
    }
    const savDeltaOf = (m) => savingsAtEndOf(m, { excludeOpening: true }) - savingsAtEndOf(addMonthsKey(m, -1), { excludeOpening: true });
    // Igual que en Resumen: sin ingresos ese mes no hay tasa que calcular
    // (no un 0% engañoso), así que directamente no entra al gráfico.
    const savRateRows = savMonths.map((m) => {
      const incM = sumDisp(S().transactions.filter((t) => effectiveMonthOf(t) === m && t.type === 'ingreso'));
      return { label: monthShortLabel(m), rate: Math.round((savDeltaOf(m) / incM) * 100), incM };
    }).filter((r) => r.incM > 0);
    const savNominalRows = savMonths.map((m) => ({ label: monthShortLabel(m), value: savDeltaOf(m) }));
    // El total acumulado sí incluye los aportes históricos (es el saldo
    // real de la cuenta a fin de cada mes), a diferencia de la tasa y el
    // aporte nominal de arriba, que los dejan afuera para no mostrar un
    // salto en el mes en que se cargó un aporte histórico.
    const savCumulativeSeries = savMonths.map((m) => savingsAtEndOf(m));

    // Este mes: aporte neto y tasa sobre los ingresos del mes.
    const cm = curMonth();
    const monthDelta = savDeltaOf(cm);
    const incCm = sumDisp(S().transactions.filter((t) => effectiveMonthOf(t) === cm && t.type === 'ingreso'));
    const monthRate = incCm > 0 ? Math.round((monthDelta / incCm) * 100) : null;

    // Cada cuenta con su saldo en la moneda elegida, para la barra de
    // composición del total (mismo color en la barra y en la lista).
    const accounts = savings.map((s, i) => ({ s, ...savingBalances(s), color: SERIES_PALETTE[i % SERIES_PALETTE.length] }));
    const posTotal = accounts.reduce((a, x) => a + Math.max(0, x.inDisp), 0);

    const CHARTS = {
      rate: { label: 'Tasa', title: 'Tasa de ahorro por mes', hint: 'Qué parte de lo que ingresó cada mes terminó ahorrada.' },
      nominal: { label: 'Aportes', title: 'Ahorro nominal por mes', hint: 'Cuánto aportaste (o retiraste, si queda por debajo de la línea) cada mes.' },
      cum: { label: 'Acumulado', title: 'Ahorro total acumulado', hint: 'El saldo real de todas tus cuentas de ahorro a fin de cada mes.' },
    };
    const chartKeys = Object.keys(CHARTS);
    if (!CHARTS[ui.savChart]) ui.savChart = 'rate';

    el.innerHTML = `
      <div class="card sav-hero">
        <div class="sav-hero-label">Total ahorrado</div>
        <div class="sav-hero-total">${fmtDisp(total)}</div>
        ${savings.length ? `<div class="sav-hero-conv">≈ ${fmtMoney(totalOther, otherCur)}</div>` : ''}
        <div class="sav-hero-stats">
          <div><span>Este mes</span><b class="${monthDelta >= 0 ? 'pos' : 'neg'}">${monthDelta >= 0 ? '+' : '−'} ${fmtDisp(Math.abs(monthDelta))}</b></div>
          <div><span>Tasa del mes</span><b>${monthRate == null ? '—' : monthRate + '%'}</b></div>
        </div>
        ${posTotal > 0 && accounts.length > 1 ? `
        <div class="sav-mix">${accounts.filter((a) => a.inDisp > 0).map((a) => `<span style="width:${(a.inDisp / posTotal) * 100}%;background:${a.color}" title="${esc(a.s.name)}"></span>`).join('')}</div>
        <div class="sav-mix-legend">${accounts.filter((a) => a.inDisp > 0).map((a) => `<span><i style="background:${a.color}"></i>${esc(a.s.name)} · ${Math.round((a.inDisp / posTotal) * 100)}%</span>`).join('')}</div>` : ''}
      </div>

      <div class="card">
        <h2 class="card-title">
          <span>Tus cuentas</span>
          <button type="button" class="link-btn" id="btn-add-saving">+ Nueva</button>
        </h2>
        ${savings.length ? `<div class="sav-list">
          ${accounts.map(({ s, bal, conv, other, color }) => {
            const pct = s.target ? Math.min(100, Math.round((bal / s.target) * 100)) : null;
            return `<div class="sav-row" data-sav="${esc(s.id)}" role="button" tabindex="0" style="--sav-color:${color}">
              <div class="sav-row-top">
                <div class="sav-row-name"><span>${esc(s.name)}</span><span class="sav-cur">${esc(s.currency)}</span></div>
                <div class="sav-row-bal">${fmtMoney(bal, s.currency)}</div>
              </div>
              <div class="sav-row-mid">
                <div class="sav-row-sub">${s.entries.length ? '≈ ' + fmtMoney(conv, other) : 'Sin movimientos'}</div>
                <div class="sav-row-quick">
                  <button type="button" class="sav-q sav-q-add" data-add="${esc(s.id)}" aria-label="Aporte a ${esc(s.name)}">+</button>
                  <button type="button" class="sav-q" data-sub="${esc(s.id)}" aria-label="Retiro de ${esc(s.name)}">−</button>
                </div>
              </div>
              ${s.target ? `
              <div class="sav-goal sav-goal-row">
                <div class="sav-goal-bar"><span style="width:${pct}%"></span></div>
                <div class="sav-goal-txt"><span>Meta ${fmtMoney(s.target, s.currency)}</span><b>${pct}%</b></div>
              </div>` : ''}
            </div>`;
          }).join('')}
        </div>
        <div class="hint" style="margin-top:8px">Tocá una cuenta para ver su historial, editarla o eliminarla.</div>`
        : '<div class="empty">Creá tu primer fondo de ahorro: un colchón en dólares, un plazo fijo o una meta puntual (viaje, auto, mudanza).</div>'}
      </div>

      ${savMonths.length ? `
      <div class="card">
        <h2 class="card-title">
          <span id="sav-chart-title">${CHARTS[ui.savChart].title}</span>
          <button type="button" class="link-btn" id="btn-sav-detail">Ver detalle</button>
        </h2>
        <div class="subtabs kind-tabs sav-tabs" data-pos="${chartKeys.indexOf(ui.savChart)}" role="tablist">
          <span class="subtabs-thumb" aria-hidden="true"></span>
          ${chartKeys.map((k) => `<button type="button" data-savchart="${k}" class="${k === ui.savChart ? 'active' : ''}" role="tab">${CHARTS[k].label}</button>`).join('')}
        </div>
        <div class="hint" id="sav-chart-hint" style="margin-bottom:8px">${CHARTS[ui.savChart].hint}</div>
        <div id="sav-chart"></div>
      </div>` : ''}`;

    // Un solo gráfico a la vez, con selector: se redibuja sin rearmar la
    // vista (así no salta el scroll).
    function drawSavChart() {
      const box = $('#sav-chart', el);
      if (!box) return;
      const k = ui.savChart;
      $('#sav-chart-title', el).textContent = CHARTS[k].title;
      $('#sav-chart-hint', el).textContent = CHARTS[k].hint;
      if (k === 'rate') {
        box.innerHTML = savRateRows.length ? savingsRateTrendSvg(savRateRows)
          : '<div class="empty">Ningún mes de esta ventana tuvo ingresos registrados.</div>';
      } else if (k === 'nominal') {
        Charts.singleBars(box, savNominalRows, {
          ariaLabel: 'Ahorro nominal por mes',
          valueLabels: true, valueLabelSize: 18, topPad: 30, bottomPad: 30,
          fmt: (v) => Charts.compact(v),
        });
      } else {
        Charts.lines(box, savMonths.map((m) => monthShortLabel(m)), [
          { label: 'Ahorro acumulado', color: Charts.COLORS.income, values: savCumulativeSeries },
        ], {
          fmtAxis: (v) => Charts.compact(v),
          ariaLabel: 'Ahorro total acumulado por mes',
          smooth: true, markerRadius: 5, pointLabels: true, pointLabelSize: 18, topPad: 34, leftPad: 52,
        });
      }
    }
    drawSavChart();
    $$('[data-savchart]', el).forEach((b) => b.addEventListener('click', () => {
      ui.savChart = b.dataset.savchart;
      $$('[data-savchart]', el).forEach((x) => x.classList.toggle('active', x === b));
      $('.sav-tabs', el).dataset.pos = String(chartKeys.indexOf(ui.savChart));
      drawSavChart();
    }));
    const btnDetail = $('#btn-sav-detail', el);
    // "Ver detalle" muestra siempre la misma tabla, con los tres datos
    // juntos (tasa, aporte del mes y acumulado), sin importar qué gráfico
    // esté elegido. El mes más reciente arriba.
    if (btnDetail) btnDetail.addEventListener('click', () => {
      const rows = savMonths.map((m, i) => {
        const incM = sumDisp(S().transactions.filter((t) => effectiveMonthOf(t) === m && t.type === 'ingreso'));
        const rate = incM > 0 ? Math.round((savNominalRows[i].value / incM) * 100) + '%' : '—';
        return [monthShortLabel(m), rate, fmtDisp(savNominalRows[i].value), fmtDisp(savCumulativeSeries[i])];
      }).reverse();
      chartTableDialog('Ahorro por mes', ['Mes', 'Tasa', 'Aporte', 'Acumulado'], rows, { numFrom: 1, boldLast: true });
    });

    $('#btn-add-saving', el).addEventListener('click', () => savingForm(null));
    const byId = (id) => savings.find((x) => x.id === id);
    $$('[data-add]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); savingEntryForm(byId(b.dataset.add), 1); }));
    $$('[data-sub]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); savingEntryForm(byId(b.dataset.sub), -1); }));
    $$('[data-sav]', el).forEach((row) => {
      const open = () => savingDetailDialog(row.dataset.sav);
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => { if (e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } });
    });
  }

  /* Categoría de un presupuesto: grupo entero O una subcategoría puntual
     (ver txMatchesBudgetCategory) — el grupo queda como opción "(todas)"
     al lado de sus subcategorías, en vez de forzar a elegir una sola cosa.
     selId siempre se deja disponible aunque ya esté "usada" (es la propia
     fila que se está editando). */
  function budgetCategoryOptionsHTML(selId, usados) {
    const usable = (id) => id === selId || !usados.has(id);
    const groups = catGroups('gasto');
    if (!useSubcats()) return selOptions(groups.filter(usable), selId);
    return groups.map((g) => {
      const children = catChildren(g.id).filter((c) => usable(c.id));
      if (!children.length) return usable(g.id) ? `<option value="${esc(g.id)}" ${g.id === selId ? 'selected' : ''}>${esc(g.name)}</option>` : '';
      const groupOpt = usable(g.id) ? `<option value="${esc(g.id)}" ${g.id === selId ? 'selected' : ''}>${esc(g.name)} (todas)</option>` : '';
      return `<optgroup label="${esc(g.name)}">${groupOpt}${selOptions(children, selId)}</optgroup>`;
    }).join('');
  }

  /* ================= Vista: Planificar ================= */
  function budgetForm(budget, preset = {}) {
    const editing = !!budget;
    const b = budget || { categoryId: '', amount: '', currency: 'ARS', ...preset };
    // Al editar, la categoría actual del presupuesto tiene que seguir en la
    // lista (si no, no habría forma de "no cambiarla") aunque ya esté
    // usada — lo que no puede pasar es elegir una categoría que YA tiene
    // presupuesto en OTRA fila.
    const usados = new Set(S().budgets.filter((x) => x !== budget).map((x) => x.categoryId));
    const catOptionsHTML = budgetCategoryOptionsHTML(b.categoryId, usados);
    if (!catOptionsHTML) { alert('Todas las categorías de gasto ya tienen presupuesto.'); return; }
    const body = `
      <div class="field">
        <label for="b-cat">Categoría</label>
        <select name="categoryId" id="b-cat" required>
          ${catOptionsHTML}
        </select>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="b-amount">Presupuesto mensual</label>
          <input type="text" inputmode="decimal" name="amount" id="b-amount" required value="${esc(formatAmountDisplay(b.amount))}">
        </div>
        <div class="field">
          <label for="b-cur">Moneda</label>
          <select name="currency" id="b-cur">
            <option value="ARS" ${b.currency === 'ARS' ? 'selected' : ''}>ARS</option>
            <option value="USD" ${b.currency === 'USD' ? 'selected' : ''}>USD</option>
          </select>
        </div>
      </div>`;
    const dlg = openDialog(editing ? 'Editar presupuesto' : 'Nuevo presupuesto', body, {
      onSubmit(d) {
        const amount = parseAmountInput(d.amount);
        if (!(amount > 0)) return false;
        if (editing) Object.assign(budget, { categoryId: d.categoryId, amount, currency: d.currency });
        else S().budgets.push({ id: Store.uid(), categoryId: d.categoryId, amount, currency: d.currency });
        Store.save();
        render();
      },
    });
    wireAmountInput($('#b-amount', dlg));
  }

  const RECURRING_FREQ_HINT = {
    monthly: 'Se genera un movimiento automáticamente cada mes, a partir de este mes.',
    weekly: 'Se genera un movimiento automáticamente cada 7 días, a partir de la fecha elegida.',
    biweekly: 'Se genera un movimiento automáticamente cada 15 días, a partir de la fecha elegida.',
  };
  // Medios para un fijo: los de siempre y, si es un gasto, también los
  // ahorros ("Pagar con un ahorro", igual que al cargar un gasto suelto):
  // cada vez que se genera, se descuenta solo de ese ahorro.
  function recurringMethodOptionsHTML(type, selId) {
    const base = selOptions(S().methods, selId);
    if (type !== 'gasto' || !S().savings.length) return base;
    return `${base}<optgroup label="Pagar con un ahorro">${selOptions(S().savings, selId)}</optgroup>`;
  }

  function recurringForm(rec, preset = {}) {
    const editing = !!rec;
    const r = rec || {
      name: '', type: 'gasto', amount: '', currency: 'ARS',
      categoryId: '', methodId: S().methods[0] ? S().methods[0].id : '', day: 1,
      freq: 'monthly', ...preset,
    };
    const freq = r.freq || 'monthly';
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
          <label for="r-freq">Frecuencia</label>
          <select name="freq" id="r-freq">
            <option value="monthly" ${freq === 'monthly' ? 'selected' : ''}>Mensual</option>
            <option value="weekly" ${freq === 'weekly' ? 'selected' : ''}>Semanal</option>
            <option value="biweekly" ${freq === 'biweekly' ? 'selected' : ''}>Quincenal</option>
          </select>
        </div>
      </div>
      <div class="field" id="r-day-wrap">
        <label for="r-day">Día del mes</label>
        <input type="number" name="day" id="r-day" min="1" max="28" step="1" value="${esc(r.day || 1)}">
      </div>
      <div class="field" id="r-start-wrap">
        <label for="r-start">Fecha del primer pago</label>
        <input type="date" name="startDate" id="r-start" value="${esc(r.startDate || todayStr())}">
      </div>
      <div class="field-row">
        <div class="field">
          <label for="r-amount">Monto</label>
          <input type="text" inputmode="decimal" name="amount" id="r-amount" required value="${esc(formatAmountDisplay(r.amount))}">
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
        <select name="methodId" id="r-method" required>${recurringMethodOptionsHTML(r.type, r.methodId)}</select>
      </div>
      <span class="hint" id="r-hint">${RECURRING_FREQ_HINT[freq]}</span>`;
    const dlg = openDialog(editing ? 'Editar movimiento fijo' : 'Nuevo movimiento fijo', body, {
      onSubmit(d) {
        const amount = parseAmountInput(d.amount);
        if (!(amount > 0)) return false;
        const data = {
          name: d.name.trim(), type: d.type, amount, currency: d.currency,
          categoryId: d.categoryId, methodId: d.methodId, freq: d.freq,
        };
        if (d.freq === 'monthly') {
          data.day = Math.min(28, Math.max(1, parseInt(d.day, 10) || 1));
        } else {
          if (!d.startDate) return false;
          data.startDate = d.startDate;
        }
        if (editing) {
          Object.assign(rec, data);
        } else {
          S().recurring.push({ id: Store.uid(), ...data, lastGen: null, lastGenDate: null });
          generateRecurring();
        }
        Store.save();
        render();
      },
    });
    $('#r-type', dlg).addEventListener('change', () => {
      const sel = $('#r-cat', dlg);
      sel.innerHTML = catSelectOptionsHTML($('#r-type', dlg).value, sel.value);
      // Un ingreso no puede "salir" de un ahorro: se rearman los medios.
      const ms = $('#r-method', dlg);
      const prev = ms.value;
      ms.innerHTML = recurringMethodOptionsHTML($('#r-type', dlg).value, prev);
      if (!ms.value && S().methods[0]) ms.value = S().methods[0].id;
    });
    // Alterna entre "Día del mes" (mensual) y "Fecha del primer pago"
    // (semanal/quincenal, que no tienen un día de mes fijo) sin dos campos
    // a la vez ocupando lugar.
    const syncFreqFields = () => {
      const f = $('#r-freq', dlg).value;
      const isMonthly = f === 'monthly';
      $('#r-day-wrap', dlg).hidden = !isMonthly;
      $('#r-day', dlg).required = isMonthly;
      $('#r-start-wrap', dlg).hidden = isMonthly;
      $('#r-start', dlg).required = !isMonthly;
      $('#r-hint', dlg).textContent = RECURRING_FREQ_HINT[f];
    };
    syncFreqFields();
    $('#r-freq', dlg).addEventListener('change', syncFreqFields);
    wireAmountInput($('#r-amount', dlg));
  }

  // Agrupa las cuotas activas (compras en cuotas) por groupId: junta todas
  // las cuotas de una misma compra para saber en cuál va y cuánto falta.
  // Se cuenta por MES, igual que el Gantt: la cuota del mes en curso es la
  // "actual" aunque su fecha sea hoy o ya haya pasado (antes, una compra
  // cargada hoy figuraba en la cuota 2 porque la 1 no era "futura"). Los
  // grupos sin cuotas del mes actual en adelante ya terminaron y no se
  // muestran.
  function activeInstallmentGroups() {
    const groups = new Map();
    for (const t of S().transactions) {
      if (!t.groupId || !t.installment) continue;
      if (!groups.has(t.groupId)) groups.set(t.groupId, []);
      groups.get(t.groupId).push(t);
    }
    const cm = curMonth();
    const rows = [];
    for (const txs of groups.values()) {
      txs.sort((a, b) => a.installment.k - b.installment.k);
      // Por mes de pago (ver paymentDateOf): con "vencimiento" en Ajustes,
      // una cuota de tarjeta cuenta en el mes en que vence su resumen.
      const pending = txs.filter((t) => effectiveMonthOf(t) >= cm);
      if (!pending.length) continue;
      const next = pending[0];
      // "Restan" = lo que todavía no se pagó (fecha de pago posterior a
      // hoy): la cuota de este mes que ya pasó cuenta como actual pero no
      // como deuda.
      const today = todayStr();
      const totalPending = pending.filter((t) => paymentDateOf(t) > today).reduce((a, t) => a + t.amount, 0);
      rows.push({
        groupId: txs[0].groupId, note: txs[0].note, categoryId: txs[0].categoryId,
        methodId: txs[0].methodId, currency: txs[0].currency,
        n: next.installment.n, nextK: next.installment.k, next, totalPending, pending, all: txs,
      });
    }
    // Primero la compra que arrancó antes (por la fecha de pago de su
    // primera cuota, y si empatan, por la fecha de compra).
    return rows.sort((a, b) => paymentDateOf(a.all[0]).localeCompare(paymentDateOf(b.all[0]))
      || a.all[0].date.localeCompare(b.all[0].date));
  }

  // Cuánto se paga en total de cuotas cada mes, desde el actual en
  // adelante (a diferencia del Gantt, que también mira para atrás si una
  // compra vieja todavía no terminó) — responde directo "cuánto tengo
  // comprometido este mes y los que vienen", sin tener que sumarlo a ojo
  // mirando las barras.
  function installmentMonthTotals(rows) {
    const today = curMonth();
    let maxMk = today;
    for (const r of rows) {
      for (const t of r.pending) {
        const mo = effectiveMonthOf(t);
        if (mo > maxMk) maxMk = mo;
      }
    }
    const months = [];
    for (let mk = today, guard = 0; mk <= maxMk && guard < 60; mk = addMonthsKey(mk, 1), guard++) months.push(mk);
    // r.pending ya incluye la cuota del mes en curso aunque su fecha haya
    // pasado (ver activeInstallmentGroups), así que el mes actual suma todo
    // lo que se paga de cuotas en él.
    const totals = new Map(months.map((m) => [m, 0]));
    for (const r of rows) {
      for (const t of r.pending) {
        const mo = effectiveMonthOf(t);
        if (!totals.has(mo)) continue;
        const v = txDispAmount(t);
        if (v != null) totals.set(mo, totals.get(mo) + v);
      }
    }
    return months.map((m) => ({ mk: m, label: monthShortLabel(m), total: totals.get(m) }));
  }

  // Gantt de verdad: una fila por compra, una barra que va del mes de la
  // primera cuota al mes de la última (mostrando cuánto dura en el tiempo),
  // y una columna resaltada marcando en qué mes estás parado hoy. La
  // ventana de meses se arma sola: desde el arranque más viejo entre las
  // compras activas hasta el final más nuevo (siempre incluyendo el mes
  // actual, aunque ninguna compra arranque o termine justo ahí).
  function installmentGanttHTML(rows) {
    const today = curMonth();
    let minMk = today, maxMk = today;
    for (const r of rows) {
      const start = effectiveMonthOf(r.all[0]);
      const end = effectiveMonthOf(r.all[r.all.length - 1]);
      if (start < minMk) minMk = start;
      if (end > maxMk) maxMk = end;
    }
    const months = [];
    for (let mk = minMk, guard = 0; mk <= maxMk && guard < 60; mk = addMonthsKey(mk, 1), guard++) months.push(mk);
    const todayIdx = months.indexOf(today);

    const barRows = rows.map((r, i) => ({
      groupId: r.groupId,
      label: r.note || catName(r.categoryId),
      color: catColor(r.categoryId),
      startIdx: months.indexOf(effectiveMonthOf(r.all[0])),
      endIdx: months.indexOf(effectiveMonthOf(r.all[r.all.length - 1])),
    }));

    const nRows = barRows.length;
    // La columna de nombres achica proporcionalmente en vez de un ancho
    // fijo (minmax con piso/techo) y el texto pasa a envolver en vez de
    // cortarse con "…" — así la compra se lee completa sin forzar scroll
    // lateral. Las filas de datos crecen (minmax con "auto") por si el
    // nombre necesita más de una línea.
    const cols = `minmax(72px, 120px) repeat(${months.length}, minmax(26px, 1fr))`;
    const gridRows = `auto repeat(${nRows}, minmax(30px, auto))`;
    const cells = [];
    if (todayIdx >= 0) {
      cells.push(`<div class="gantt-today" style="grid-row:1 / span ${nRows + 1};grid-column:${todayIdx + 2}"></div>`);
    }
    cells.push(`<div class="gantt-cell gantt-corner" style="grid-row:1;grid-column:1"></div>`);
    months.forEach((mo, i) => {
      cells.push(`<div class="gantt-cell gantt-monthlabel ${i === todayIdx ? 'is-today' : ''}" style="grid-row:1;grid-column:${i + 2}">${esc(monthShortLabel(mo))}</div>`);
    });
    barRows.forEach((r, ri) => {
      const gr = ri + 2;
      // Toda la fila (nombre, fondo y barra) abre el detalle de la compra.
      const g = `data-instgroup="${esc(r.groupId)}"`;
      cells.push(`<div class="gantt-cell gantt-label gantt-link" ${g} role="button" tabindex="0" style="grid-row:${gr};grid-column:1" title="${esc(r.label)}">${esc(r.label)}</div>`);
      cells.push(`<div class="gantt-track gantt-link" ${g} style="grid-row:${gr};grid-column:2 / -1"></div>`);
      cells.push(`<div class="gantt-bar gantt-link" ${g} style="grid-row:${gr};grid-column:${r.startIdx + 2} / ${r.endIdx + 3};background:${r.color}"></div>`);
    });

    return `<div class="gantt-wrap"><div class="gantt" style="grid-template-columns:${cols};grid-template-rows:${gridRows}">${cells.join('')}</div></div>`;
  }

  // El detalle de cada compra en cuotas (antes vivía siempre desplegado
  // debajo del Gantt) ahora es un pop-up: el Gantt ya responde "cuándo",
  // y este detalle es para cuando hace falta el "cuánto/con qué medio" de
  // una compra puntual — no hace falta tenerlo abierto de entrada.
  function installmentRowHTML(r, link = true) {
    // Progreso de la compra: cuánto de las cuotas ya vas pagando —
    // 1 de 3 = un tercio coloreado, la última cuota = toda coloreada.
    const prog = Math.round((r.nextK / r.n) * 100);
    return `
          <div class="inst-row ${link ? 'rowlink' : ''}" ${link ? `data-instgroup="${esc(r.groupId)}"` : ''} style="--prog:${prog}%">
            <div class="row-icon cic" style="--c:${catColor(r.categoryId)}">${iconSvg(categoryIconName(r.categoryId))}</div>
            <div class="inst-row-main">
              <div class="inst-row-title">${esc(r.note || catName(r.categoryId))}</div>
              <div class="inst-row-sub">${esc(methodName(r.methodId))} · cuota ${r.nextK}/${r.n} · ${paymentDateOf(r.next) > todayStr() ? 'próx. ' + esc(fmtDateShort(paymentDateOf(r.next))) : 'este mes'}</div>
            </div>
            <div class="inst-row-amounts">
              <div class="inst-row-amount">${fmtMoney(r.next.amount, r.currency)} <span class="inst-row-amount-label">cuota</span></div>
              <div class="inst-row-total">${fmtMoney(r.totalPending, r.currency)} <span class="inst-row-amount-label">restan</span></div>
            </div>
          </div>`;
  }
  function installmentListDialog(rows) {
    const bodyHTML = `<div class="inst-row-list">${rows.map((r) => installmentRowHTML(r)).join('')}</div>`;
    const dlg = openDialog('Compras en cuotas', bodyHTML, { submitLabel: 'Cerrar', viewOnly: true });
    $$('[data-instgroup]', dlg).forEach((row) => row.addEventListener('click', () => {
      const g = rows.find((r) => r.groupId === row.dataset.instgroup);
      if (g) { dlg.close(); installmentPurchaseDialog(g); }
    }));
  }

  // Detalle de UNA compra en cuotas (al tocarla en el Gantt o en la
  // lista): la misma fila resumen de "Ver el detalle de cada compra" y,
  // abajo, todas sus cuotas con cuándo se paga cada una y si ya se pagó.
  function installmentPurchaseDialog(r) {
    const today = todayStr();
    const cm = curMonth();
    const total = r.all.reduce((a, t) => a + t.amount, 0);
    const first = r.all[0], last = r.all[r.all.length - 1];
    const status = (t) => {
      const pay = paymentDateOf(t);
      if (pay <= today) return '<span class="inst-st paid">Pagada</span>';
      if (effectiveMonthOf(t) === cm) return '<span class="inst-st now">Este mes</span>';
      return '<span class="inst-st">Pendiente</span>';
    };
    const bodyHTML = `
      ${installmentRowHTML(r, false)}
      <div class="inst-detail-rows">
      <div class="tx-detail-row"><span class="tx-row-label">Total de la compra</span><span class="tx-row-value">${fmtMoney(total, r.currency)}</span></div>
      <div class="tx-detail-row"><span class="tx-row-label">Fecha de compra</span><span class="tx-row-value">${esc(fmtDateFull(first.date))}</span></div>
      <div class="tx-detail-row"><span class="tx-row-label">Categoría</span><span class="tx-row-value">${esc(catName(r.categoryId))}</span></div>
      <div class="tx-detail-row"><span class="tx-row-label">Termina</span><span class="tx-row-value">${esc(monthLabel(effectiveMonthOf(last)))}</span></div>
      </div>
      <div class="table-scroll inst-cuotas-table"><table class="data">
        <thead><tr><th>Cuota</th><th>Se paga</th><th class="num">Monto</th><th class="num">Estado</th></tr></thead>
        <tbody>${r.all.map((t) => `<tr class="${t === r.next ? 'is-next' : ''}">
          <td>${t.installment.k}/${t.installment.n}</td>
          <td>${esc(fmtDateShort(paymentDateOf(t)))}</td>
          <td class="num">${fmtMoney(t.amount, t.currency)}</td>
          <td class="num">${status(t)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
    openDialog(r.note || catName(r.categoryId), bodyHTML, {
      submitLabel: 'Editar compra',
      onSubmit: (data, d) => { d.close(); txForm(r.next); return false; },
    });
  }

  // Evolución mensual del peso de las cuotas: qué % de los gastos y de los
  // ingresos de cada mes se fue en cuotas (por mes de pago, mismo criterio
  // que el bloque del mes actual y "Gastos" en Inicio). Arranca en el primer mes con alguna
  // cuota dentro del último año, para no llenar el gráfico de ceros, y
  // salta los meses sin ingresos.
  function installmentShareHistoryDialog() {
    const cm = curMonth();
    const months = [];
    for (let i = 11; i >= 0; i--) months.push(addMonthsKey(cm, -i));
    const rows = months.map((mo) => {
      const txs = S().transactions.filter((t) => effectiveMonthOf(t) === mo);
      const cuotas = sumDisp(txs.filter((t) => t.type === 'gasto' && t.installment));
      const exp = sumDisp(txs.filter((t) => t.type === 'gasto'));
      const inc = sumDisp(txs.filter((t) => t.type === 'ingreso'));
      return {
        mo, cuotas,
        pctExp: exp > 0 ? Math.round((cuotas / exp) * 100) : null,
        pctInc: inc > 0 ? Math.round((cuotas / inc) * 100) : null,
      };
    });
    // Sólo meses con ingresos (sin ingresos no hay % sobre ingresos, y un
    // mes con un gasto suelto no es comparable con el resto).
    const withIncome = rows.filter((r) => r.pctInc != null);
    const first = withIncome.findIndex((r) => r.cuotas > 0);
    const shown = first < 0 ? withIncome.slice(-1) : withIncome.slice(first);
    const dlg = openDialog('Peso de las cuotas por mes', `
      <div class="chart-legend">
        <span><span class="key" style="background:var(--crit)"></span>% de tus gastos</span>
        <span><span class="key" style="background:var(--income)"></span>% de tus ingresos</span>
      </div>
      <div id="chart-inst-share"></div>
      <div class="table-scroll inst-share-table"><table class="data">
        <thead><tr><th>Mes</th><th class="num">Cuotas</th><th class="num">% gastos</th><th class="num">% ingr.</th></tr></thead>
        <tbody>${shown.slice().reverse().map((r) => `<tr>
          <td>${esc(monthShortLabel(r.mo))}</td>
          <td class="num">${fmtDisp(r.cuotas)}</td>
          <td class="num">${r.pctExp == null ? '—' : r.pctExp + '%'}</td>
          <td class="num">${r.pctInc == null ? '—' : r.pctInc + '%'}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    `, { submitLabel: 'Cerrar', viewOnly: true });
    Charts.lines($('#chart-inst-share', dlg), shown.map((r) => monthShortLabel(r.mo)), [
      { label: '% de tus gastos', color: 'var(--crit)', values: shown.map((r) => r.pctExp) },
      { label: '% de tus ingresos', color: 'var(--income)', values: shown.map((r) => r.pctInc) },
    ], {
      smooth: true, pointLabels: true, pointLabelSize: 18, markerRadius: 4, topPad: 30,
      fmtAxis: (v) => Math.round(v) + '%',
      ariaLabel: 'Porcentaje de gastos e ingresos que se fue en cuotas, por mes',
    });
  }

  // Cuántas veces cae un fijo en un mes: uno mensual, una vez; uno
  // semanal/quincenal, las ocurrencias reales de ese mes desde su fecha de
  // inicio (4 o 5 si es semanal, 2 o 3 si es quincenal) — mismo criterio
  // que el calendario (eventsForMonth).
  function recurringCountInMonth(r, mk) {
    if (r.freq !== 'weekly' && r.freq !== 'biweekly') return 1;
    if (!r.startDate) return 0;
    const [y, mo] = mk.split('-').map(Number);
    const step = r.freq === 'weekly' ? 7 : 14;
    const monthStart = new Date(y, mo - 1, 1);
    const monthEnd = new Date(y, mo, 0);
    let cursor = parseDate(r.startDate);
    if (cursor < monthStart) cursor = addDays(cursor, Math.ceil((monthStart - cursor) / DAY_MS / step) * step);
    let n = 0;
    for (; cursor <= monthEnd; cursor = addDays(cursor, step)) n++;
    return n;
  }

  // Más → Cuotas / Presupuestos / Fijos: antes era una sola hoja
  // "Planificar" con las tres tarjetas una debajo de la otra; ahora cada
  // una es su propia sub-pestaña (section) y sólo se arma esa.
  /* Estados vacíos con una sugerencia concreta a partir de tus datos. */
  // Presupuestos: la categoría en la que más gastaste este mes.
  function budgetSuggestionHTML(monthTx) {
    const by = new Map();
    for (const t of monthTx) {
      const v = txDispAmount(t);
      if (v == null) continue;
      const top = topCategoryOf(t.categoryId);
      if (catById(top)) by.set(top, (by.get(top) || 0) + v);
    }
    const best = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) return '<div class="empty">Definí cuánto querés gastar por mes en cada categoría y seguí el avance acá.</div>';
    return `<div class="suggest">
      <span class="cic" style="--c:${catColor(best[0])}">${iconSvg(categoryIconName(best[0]))}</span>
      <div><p><b>${esc(catName(best[0]))}</b> va <span class="money">${esc(fmtPlain(best[1]))}</span> este mes. ¿Le ponés un presupuesto?</p>
      <button type="button" class="btn btn-primary btn-sm" data-suggest-budget="${esc(best[0])}">Poner presupuesto</button></div>
    </div>`;
  }
  // Fijos: algo que se repite (misma nota o categoría y monto parecido) en
  // al menos dos de los últimos tres meses.
  function recurringSuggestionHTML() {
    const cm = curMonth();
    const months = [addMonthsKey(cm, -2), addMonthsKey(cm, -1), cm];
    const groups = new Map();
    for (const t of S().transactions) {
      if (t.type === 'transferencia' || t.recurringId || t.installment || !months.includes(monthKeyOf(t.date))) continue;
      const key = `${t.type}|${(t.note || '').trim().toLowerCase() || t.categoryId}|${t.currency}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    let best = null;
    for (const list of groups.values()) {
      const ms = new Set(list.map((t) => monthKeyOf(t.date)));
      if (ms.size < 2) continue;
      const amounts = list.map((t) => t.amount);
      const avg = amounts.reduce((a, v) => a + v, 0) / amounts.length;
      if (amounts.some((a) => Math.abs(a - avg) > avg * 0.15)) continue;
      if (!best || ms.size > best.n || (ms.size === best.n && avg > best.avg)) best = { list, n: ms.size, avg };
    }
    if (!best) return '<div class="empty">Cargá tus gastos e ingresos fijos (alquiler, suscripciones, sueldo) y se registran solos todos los meses.</div>';
    const last = best.list.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    const name = last.note || catName(last.categoryId);
    const preset = {
      name, type: last.type, amount: Math.round(best.avg * 100) / 100, currency: last.currency,
      categoryId: last.categoryId, methodId: last.methodId, day: Number(last.date.slice(8, 10)), freq: 'monthly',
    };
    return `<div class="suggest">
      <span class="cic" style="--c:${catColor(last.categoryId)}">${spriteIcon('repeat')}</span>
      <div><p><b>${esc(name)}</b> se repite todos los meses (<span class="money">${esc(fmtPlain(best.avg, last.currency))}</span>). ¿Lo cargás como fijo?</p>
      <button type="button" class="btn btn-primary btn-sm" data-suggest-rec="${esc(JSON.stringify(preset))}">Cargar como fijo</button></div>
    </div>`;
  }

  function vPlan(el, section) {
    const mk = curMonth();
    // Presupuestos por fecha real de carga, no de vencimiento — mismo
    // criterio que el aviso de presupuesto superado en Inicio.
    const monthTx = S().transactions.filter(
      (t) => t.type === 'gasto' && monthKeyOf(t.date) === mk);
    const instRows = activeInstallmentGroups();
    const monthTotals = installmentMonthTotals(instRows);
    // Peso de las cuotas del mes sobre el total de gastos y de ingresos del
    // mismo mes (por mes de pago, igual que el gráfico de cuotas y que
    // "Gastos" en Inicio).
    const cuotasMonth = monthTotals.length ? monthTotals[0].total : 0;
    const calMonthTx = S().transactions.filter((t) => effectiveMonthOf(t) === mk);
    const expMonthCal = sumDisp(calMonthTx.filter((t) => t.type === 'gasto'));
    const incMonthCal = sumDisp(calMonthTx.filter((t) => t.type === 'ingreso'));
    const shareRow = (label, base, cls) => {
      const pct = base > 0 ? Math.round((cuotasMonth / base) * 100) : null;
      return `<div class="inst-share-row">
        <span class="inst-share-label">${label}</span>
        <span class="inst-share-bar ${cls}"><span style="width:${pct == null ? 0 : Math.min(100, pct)}%"></span></span>
        <b class="inst-share-pct">${pct == null ? '—' : pct + '%'}</b>
      </div>`;
    };

    const budgetRows = S().budgets.map((b) => {
      const spent = sumDisp(monthTx.filter((t) => txMatchesBudgetCategory(t, b.categoryId)));
      const limit = convOrNull(b.amount, b.currency);
      const pct = limit > 0 ? (spent / limit) * 100 : null;
      return { b, spent, limit, pct };
    }).sort((a, x) => (x.pct || 0) - (a.pct || 0));

    const cards = {};
    cards.cuotas = `
      <div class="card">
        <h2 class="card-title">Compras en cuotas</h2>
        ${instRows.length ? `
        <div class="inst-share rowlink" id="btn-inst-share" role="button" tabindex="0" aria-label="Ver evolución por mes">
          <div class="inst-share-head"><span>Cuotas de ${esc(monthLabel(mk))}</span><b>${fmtDisp(cuotasMonth)}</b></div>
          ${shareRow('De tus gastos', expMonthCal, 'exp')}
          ${shareRow('De tus ingresos', incMonthCal, 'inc')}
          <span class="inst-share-more">Ver evolución por mes ›</span>
        </div>
        ${monthTotals.length ? `
        <div class="hint" style="margin-bottom:6px">Cuánto pagás de cuotas cada mes.</div>
        <div id="chart-inst-months"></div>` : ''}
        <div class="hint" style="margin:10px 0">Cuándo empieza y termina cada compra, con hoy marcado.</div>
        ${installmentGanttHTML(instRows)}
        <button class="link-btn" id="btn-inst-detail" style="margin-top:14px">Ver el detalle de cada compra ›</button>`
        : '<div class="empty">Cuando cargues una compra en cuotas desde "+ Movimiento", la vas a ver acá con cuántas cuotas faltan.</div>'}
      </div>`;
    cards.presupuestos = `
      <div class="card">
        <h2 class="card-title">
          <span>Presupuestos por categoría · ${esc(monthLabel(mk))}</span>
          <button class="link-btn" id="btn-add-budget">+ Presupuesto</button>
        </h2>
        ${budgetRows.length ? `
        <div class="budget-row-list">
          ${budgetRows.map(({ b, spent, limit, pct }) => {
            const cls = pct == null ? 'meter-ok' : pct >= 100 ? 'meter-crit' : pct >= 80 ? 'meter-warn' : 'meter-ok';
            const over = pct != null && pct >= 100;
            return `<div class="swipe swipe-card"><div class="budget-row rowlink" data-bid="${esc(b.id)}">
              <div class="budget-row-main">
                <div class="budget-row-top">
                  <span class="budget-row-name">${esc(catName(b.categoryId))}</span>
                  <span class="budget-row-pct ${over ? 'over' : ''}">${pct == null ? '—' : Math.round(pct) + '%'}${over ? ' ⚠' : ''}</span>
                </div>
                <div class="meter ${cls}"><span style="width:${Math.min(100, pct || 0)}%"></span></div>
                <div class="budget-row-amounts">${fmtDisp(spent)} <span class="inst-row-amount-label">de</span> ${fmtMoney(b.amount, b.currency)}</div>
              </div>
            </div>
            <div class="swipe-actions"><button type="button" class="sw-del" data-bdel="${esc(b.id)}" aria-label="Borrar el presupuesto de ${esc(catName(b.categoryId))}">${iconSvg('trash')}<span>Borrar</span></button></div></div>`;
          }).join('')}
        </div>`
        : budgetSuggestionHTML(monthTx)}
      </div>`;
    // Total por mes de los fijos: cada uno multiplicado por las veces que
    // cae en el mes (un semanal suma 4 o 5 veces), en moneda visible.
    let recExp = 0, recInc = 0;
    for (const r of S().recurring) {
      const v = convOrNull(r.amount, r.currency);
      if (v == null) continue;
      const total = v * recurringCountInMonth(r, mk);
      if (r.type === 'ingreso') recInc += total; else recExp += total;
    }
    const recNet = recInc - recExp;
    cards.fijos = `
      <div class="card">
        <h2 class="card-title">
          <span>Movimientos fijos</span>
          <button class="link-btn" id="btn-add-rec">+ Fijo</button>
        </h2>
        ${S().recurring.length ? `
        <div class="rec-total">
          <div class="rec-total-head">Total por mes · ${esc(monthLabel(mk))}</div>
          <div class="rec-total-row"><span>Gastos fijos</span><b>− ${fmtDisp(recExp)}</b></div>
          <div class="rec-total-row"><span>Ingresos fijos</span><b class="pos">+ ${fmtDisp(recInc)}</b></div>
          ${recInc > 0 && recExp > 0 ? `
          <div class="rec-total-bar" title="Gastos fijos sobre ingresos fijos"><span style="width:${Math.min(100, Math.round((recExp / recInc) * 100))}%"></span></div>
          <div class="rec-total-note">Los gastos fijos se llevan el ${Math.round((recExp / recInc) * 100)}% de los ingresos fijos.</div>` : ''}
          <div class="rec-total-row rec-total-net"><span>Neto</span><b class="${recNet >= 0 ? 'pos' : 'neg'}">${recNet >= 0 ? '+' : '−'} ${fmtDisp(Math.abs(recNet))}</b></div>
        </div>
        <div class="tx-card-list">
          ${S().recurring.map((r) => {
            const isIncome = r.type === 'ingreso';
            const times = recurringCountInMonth(r, mk);
            const multi = r.freq === 'weekly' || r.freq === 'biweekly';
            const freqSub = r.freq === 'weekly' ? 'Semanal'
              : r.freq === 'biweekly' ? 'Quincenal'
              : `Día ${r.day}`;
            const perOcc = convOrNull(r.amount, r.currency);
            return `<div class="swipe swipe-card"><div class="tx-card-row" data-rid="${esc(r.id)}">
              <div class="row-icon ${isIncome ? 'row-icon-income' : 'row-icon-expense'}">${iconSvg(isIncome ? 'trend' : 'cash')}</div>
              <div class="tx-card-main">
                <div class="tx-card-title">${esc(r.name)}</div>
                <div class="tx-card-sub">${esc(catName(r.categoryId))} · ${esc(methodName(r.methodId))} · ${esc(freqSub)}</div>
              </div>
              <div class="tx-card-amount">
                <div class="v ${isIncome ? 'pos' : ''}">${isIncome ? '+' : '−'} ${fmtMoney(r.amount, r.currency)}</div>
                ${multi && perOcc != null ? `<div class="rec-times">× ${times} = ${fmtDisp(perOcc * times)}/mes</div>` : ''}
              </div>
            </div>
            <div class="swipe-actions"><button type="button" class="sw-del" data-rdel="${esc(r.id)}" aria-label="Borrar ${esc(r.name)}">${iconSvg('trash')}<span>Borrar</span></button></div></div>`;
          }).join('')}
        </div>
        <div class="hint" style="margin-top:8px">Se cargan solos según su frecuencia (mensual, semanal o quincenal). Los ya generados se pueden editar o borrar como cualquier movimiento.</div>`
        : recurringSuggestionHTML()}
      </div>`;
    el.innerHTML = cards[section];

    const instMonthsEl = $('#chart-inst-months', el);
    if (instMonthsEl) {
      Charts.lines(instMonthsEl, monthTotals.map((m) => m.label), [
        { label: 'Cuotas', color: Charts.COLORS.expense, values: monthTotals.map((m) => m.total) },
      ], {
        smooth: true, pointLabels: 'changes', pointLabelSize: 20, topPad: 30, leftPad: 52,
        fmtAxis: (v) => Charts.compact(v),
        ariaLabel: 'Total de cuotas por mes',
      });
    }
    const instShareBtn = $('#btn-inst-share', el);
    if (instShareBtn) {
      instShareBtn.addEventListener('click', installmentShareHistoryDialog);
      instShareBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); installmentShareHistoryDialog(); } });
    }
    const instDetailBtn = $('#btn-inst-detail', el);
    if (instDetailBtn) instDetailBtn.addEventListener('click', () => installmentListDialog(instRows));
    $$('.gantt-link[data-instgroup]', el).forEach((cell) => {
      const open = () => {
        const g = instRows.find((r) => r.groupId === cell.dataset.instgroup);
        if (g) installmentPurchaseDialog(g);
      };
      cell.addEventListener('click', open);
      cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    const addBudgetBtn = $('#btn-add-budget', el);
    if (addBudgetBtn) addBudgetBtn.addEventListener('click', () => budgetForm(null));
    const addRecBtn = $('#btn-add-rec', el);
    if (addRecBtn) addRecBtn.addEventListener('click', () => recurringForm(null));
    // Sugerencias de los estados vacíos.
    const sugB = $('[data-suggest-budget]', el);
    if (sugB) sugB.addEventListener('click', () => budgetForm(null, { categoryId: sugB.dataset.suggestBudget }));
    const sugR = $('[data-suggest-rec]', el);
    if (sugR) sugR.addEventListener('click', () => recurringForm(null, JSON.parse(sugR.dataset.suggestRec)));
    $$('.budget-row[data-bid]', el).forEach((row) => row.addEventListener('click', (e) => {
      if (e.target.closest('[data-bdel]')) return;
      budgetForm(S().budgets.find((b) => b.id === row.dataset.bid));
    }));
    $$('[data-bdel]', el).forEach((b) => b.addEventListener('click', () => {
      const bud = S().budgets.find((x) => x.id === b.dataset.bdel);
      if (bud) removeWithUndo('budgets', bud, `Se borró el presupuesto de ${catName(bud.categoryId)}`);
    }));
    $$('[data-rid]', el).forEach((row) => row.addEventListener('click', (e) => {
      if (e.target.closest('[data-rdel]')) return;
      recurringForm(S().recurring.find((r) => r.id === row.dataset.rid));
    }));
    $$('[data-rdel]', el).forEach((b) => b.addEventListener('click', () => {
      const rec = S().recurring.find((r) => r.id === b.dataset.rdel);
      if (rec) removeWithUndo('recurring', rec, `Se borró ${rec.name} (los ya cargados quedan)`);
    }));
  }

  /* ================= Vista: Ajustes ================= */
  // Con todas las columnas disponibles (no solo las mínimas para leer la
  // lista): incluye el equivalente en ARS y en USD de cada movimiento (con
  // el mismo criterio de cotización histórica que usa el resto de la app,
  // ver amountInCurrency()), categoría madre y subcategoría por separado,
  // y el origen/metadata de cada uno — para poder auditar a fondo desde
  // una planilla si las cuentas de la app cierran bien.
  function exportCSV() {
    const sep = ';';
    const q = csvQuote;
    const numCol = (n) => (n == null ? '' : String(Math.round(n * 100) / 100).replace('.', ','));
    const header = [
      'id', 'fecha', 'tipo', 'monto', 'moneda', 'monto_ars', 'monto_usd',
      'categoria', 'subcategoria', 'medio_pago', 'tipo_medio', 'cuenta_destino',
      'nota', 'cuota', 'id_compra_cuotas', 'origen',
      'compartido', 'porcentaje_tuyo', 'tu_parte_ars', 'tu_parte_usd',
    ].join(sep);
    const lines = [header];
    const txs = S().transactions.slice().sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    for (const t of txs) {
      const isTransfer = t.type === 'transferencia';
      const cat = !isTransfer ? catById(t.categoryId) : null;
      const grupoNombre = !isTransfer ? catName(topCategoryOf(t.categoryId)) : '';
      const subNombre = (cat && cat.parentId) ? cat.name : '';
      const method = methodById(t.methodId);
      const origen = t.recurringId ? 'Fijo' : (t.leftoverGen ? 'Sobrante mes anterior' : 'Manual');
      // sharePct es el % que te queda a vos del total (ver tx-detail-row
      // "Compartido" en el detalle del movimiento) — sin esta columna, el
      // CSV mostraba el monto TOTAL de la compra y no quedaba claro cuánto
      // de eso era realmente tuyo.
      const share = t.shared && t.sharePct != null ? t.sharePct / 100 : 1;
      lines.push([
        t.id, t.date, t.type, numCol(t.amount), t.currency,
        numCol(amountInCurrency(t, 'ARS')), numCol(amountInCurrency(t, 'USD')),
        q(grupoNombre), q(subNombre), q(methodName(t.methodId)),
        q(method ? (KIND_LABEL[method.kind] || method.kind) : ''),
        q(isTransfer ? methodName(t.toMethodId) : ''),
        q(t.note || ''),
        t.installment ? q(`${t.installment.k} de ${t.installment.n}`) : '',
        t.groupId || '',
        origen,
        t.shared ? 'Sí' : 'No',
        (t.shared && t.sharePct != null) ? String(t.sharePct).replace('.', ',') : '',
        numCol(amountInCurrency(t, 'ARS') * share),
        numCol(amountInCurrency(t, 'USD') * share),
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

  /* ================= Importar movimientos desde CSV ================= */

  const IMPORT_COLS = ['fecha', 'tipo', 'monto', 'moneda', 'categoria', 'subcategoria', 'medio_pago', 'nota'];

  // Plantilla con las categorías/medios reales del usuario como ejemplo (si
  // ya tiene algo cargado) — así ve de entrada el formato esperado en vez
  // de nombres inventados que después tendría que reemplazar igual.
  function csvImportTemplate() {
    const sep = ';';
    const header = IMPORT_COLS.join(sep);
    const incomeCat = catGroups('ingreso')[0];
    const expenseCat = catGroups('gasto')[0];
    const method = S().methods[0];
    const mName = method ? method.name : 'Efectivo';
    const incName = incomeCat ? incomeCat.name : 'Sueldo';
    const expName = expenseCat ? expenseCat.name : 'Comida';
    const rows = [header];
    rows.push(['2026-08-01', 'ingreso', '150000', 'ARS', csvQuote(incName), '', csvQuote(mName), csvQuote('Ejemplo — reemplazá o borrá esta fila')].join(sep));
    rows.push(['2026-08-05', 'gasto', '8500', 'ARS', csvQuote(expName), '', csvQuote(mName), csvQuote('Ejemplo — reemplazá o borrá esta fila')].join(sep));
    return '﻿' + rows.join('\r\n');
  }

  // Parser CSV genérico (no solo la plantilla propia): soporta comillas,
  // saltos de línea adentro de un campo y separador ";" o "," según cuál
  // aparezca más en el encabezado (Excel en configuración regional
  // argentina exporta con ";" — igual que exportCSV() — pero otras
  // configuraciones usan ",").
  function parseCSVRows(text) {
    const raw = text.replace(/^﻿/, '');
    const firstLine = raw.split(/\r\n|\n|\r/, 1)[0] || '';
    const semi = (firstLine.match(/;/g) || []).length;
    const comma = (firstLine.match(/,/g) || []).length;
    const delim = semi >= comma ? ';' : ',';
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inQuotes) {
        if (c === '"') {
          if (raw[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === delim) {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && raw[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((f) => f.trim() !== '')) rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
    row.push(field);
    if (row.some((f) => f.trim() !== '')) rows.push(row);
    return rows;
  }

  // Acepta "," o "." como separador decimal (si hay coma, los puntos se
  // toman como separador de miles — la convención que usa el resto de la
  // app) para no depender de qué formato de número haya quedado al guardar
  // el CSV desde Excel.
  function parseAmountLoose(str) {
    let s = String(str ?? '').trim();
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    return parseFloat(s);
  }

  // Acepta AAAA-MM-DD (lo que usa la app) y DD/MM/AAAA o DD-MM-AAAA (lo que
  // Excel suele mostrar/guardar según la configuración regional). Valida
  // que la fecha exista de verdad (ej. "2026-08-99" o "31/02/2026" no
  // pasan) dejando que Date() la normalice y comparando que no haya
  // "desbordado" a otro día/mes.
  function parseDateLoose(str) {
    const s = String(str ?? '').trim();
    const build = (y, mo, d) => {
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      const dt = new Date(y, mo - 1, d);
      if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
      return `${y}-${pad(mo)}-${pad(d)}`;
    };
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return build(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m) return build(+m[3], +m[2], +m[1]);
    return null;
  }

  // Lee y valida cada fila del CSV subido, sin tocar el estado todavía —
  // separado de runImport() para poder mostrar una vista previa (qué se va
  // a crear, qué filas tienen error) antes de que el usuario confirme.
  function analyzeImportRows(text) {
    const rows = parseCSVRows(text);
    if (!rows.length) return { items: [], headerError: 'El archivo está vacío.' };
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = {};
    for (const col of IMPORT_COLS) idx[col] = header.indexOf(col);
    if (idx.fecha < 0 || idx.tipo < 0 || idx.monto < 0 || idx.categoria < 0 || idx.medio_pago < 0) {
      return { items: [], headerError: 'Faltan columnas obligatorias (fecha, tipo, monto, categoria, medio_pago) — usá la plantilla como base.' };
    }
    const items = [];
    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r];
      const get = (col) => (idx[col] >= 0 ? (cols[idx[col]] || '').trim() : '');
      const errors = [];

      const date = parseDateLoose(get('fecha'));
      if (!date) errors.push('fecha inválida (usá AAAA-MM-DD o DD/MM/AAAA)');

      const typeRaw = get('tipo').toLowerCase();
      const type = typeRaw === 'ingreso' ? 'ingreso' : typeRaw === 'gasto' ? 'gasto' : null;
      if (!type) errors.push('tipo debe ser "ingreso" o "gasto"');

      const amount = parseAmountLoose(get('monto'));
      if (!(amount > 0)) errors.push('monto inválido');

      const currency = get('moneda').toUpperCase() || 'ARS';
      if (currency !== 'ARS' && currency !== 'USD') errors.push('moneda debe ser ARS o USD');

      const catNameIn = get('categoria');
      if (!catNameIn) errors.push('falta la categoría');

      const subNameIn = get('subcategoria');

      const methodNameIn = get('medio_pago');
      let methodId = null;
      if (!methodNameIn) {
        errors.push('falta el medio de pago');
      } else {
        const mm = S().methods.find((m) => m.name.toLowerCase() === methodNameIn.toLowerCase());
        if (!mm) errors.push(`el medio de pago "${methodNameIn}" no existe`);
        else methodId = mm.id;
      }

      let catMatch = null, willCreateCat = false, willCreateSub = false;
      if (catNameIn && type) {
        catMatch = S().categories.find((c) => c.type === type && !c.parentId && c.name.toLowerCase() === catNameIn.toLowerCase());
        willCreateCat = !catMatch;
        if (subNameIn) {
          willCreateSub = catMatch
            ? !S().categories.some((c) => c.parentId === catMatch.id && c.name.toLowerCase() === subNameIn.toLowerCase())
            : true;
        }
      }

      items.push({
        lineNo: r + 1, ok: errors.length === 0, errors,
        date, type, amount, currency, catNameIn, subNameIn,
        willCreateCat, willCreateSub, methodId, methodNameIn,
        note: get('nota'),
      });
    }
    return { items };
  }

  // Crea las categorías/subcategorías nuevas que hagan falta (una sola vez
  // aunque varias filas las repitan) y después va empujando cada
  // movimiento con su cotización histórica real, igual que si se hubiera
  // cargado a mano uno por uno.
  async function runImportRows(items, dlg) {
    const btn = $('#btn-confirm-import', dlg);
    const status = $('#import-status', dlg);
    if (!btn || btn.disabled) return;
    btn.disabled = true;

    const catCache = new Map();
    for (const c of S().categories) {
      if (!c.parentId) catCache.set(`${c.type}::${c.name.toLowerCase()}`, c.id);
      else {
        const parent = catById(c.parentId);
        if (parent) catCache.set(`${parent.type}::${parent.name.toLowerCase()}::${c.name.toLowerCase()}`, c.id);
      }
    }
    const resolveCategory = (item) => {
      const topKey = `${item.type}::${item.catNameIn.toLowerCase()}`;
      let topId = catCache.get(topKey);
      if (!topId) {
        topId = Store.uid();
        S().categories.push({ id: topId, name: item.catNameIn.trim(), type: item.type, parentId: null });
        catCache.set(topKey, topId);
      }
      if (!item.subNameIn) return topId;
      const subKey = `${topKey}::${item.subNameIn.toLowerCase()}`;
      let subId = catCache.get(subKey);
      if (!subId) {
        subId = Store.uid();
        S().categories.push({ id: subId, name: item.subNameIn.trim(), type: item.type, parentId: topId });
        catCache.set(subKey, subId);
      }
      return subId;
    };

    let done = 0;
    for (const item of items) {
      if (status) status.textContent = `Importando ${done + 1}/${items.length}…`;
      const categoryId = resolveCategory(item);
      S().transactions.push({
        id: Store.uid(), date: item.date, type: item.type, amount: item.amount, currency: item.currency,
        categoryId, methodId: item.methodId, note: item.note,
        usdSnapshot: await usdSnapshotForDate(item.amount, item.currency, item.date),
        arsSnapshot: await arsSnapshotForDate(item.amount, item.currency, item.date),
      });
      done++;
    }
    Store.save();
    dlg.close();
    render();
    alert(`Listo: se importaron ${done} movimiento${done === 1 ? '' : 's'}.`);
  }

  function importCSVDialog() {
    const dlg = $('#dialog');
    dlg.className = 'dialog';

    const catListText = (type) => catGroups(type).map((g) => {
      const subs = catChildren(g.id).map((c) => c.name).join(', ');
      return subs ? `${g.name} (${subs})` : g.name;
    }).join(' · ') || '—';
    const methodListText = S().methods.map((m) => m.name).join(' · ') || '—';

    function renderIntro() {
      dlg.innerHTML = `
        <div class="dialog-head"><button type="button" class="icb" data-close aria-label="Cerrar">${spriteIcon('x')}</button><span class="dialog-title">Importar movimientos</span><span></span></div>
        <div class="dialog-body">
          <div class="hint">Descargá la plantilla, completala en Excel (una fila por movimiento) y subila acá. El separador decimal es la coma (,), igual que en el resto de la app.</div>
          <button type="button" class="btn btn-sm" id="btn-dl-template">Descargar plantilla (CSV)</button>
          <div class="hint" style="margin-top:8px"><b>Tus categorías de gasto:</b> ${esc(catListText('gasto'))}</div>
          <div class="hint"><b>Tus categorías de ingreso:</b> ${esc(catListText('ingreso'))}</div>
          <div class="hint"><b>Tus medios de pago:</b> ${esc(methodListText)}</div>
          <div class="hint">Una categoría que no exista se crea sola; el medio de pago tiene que coincidir con uno de los de arriba (así que si hace falta, cargalo antes en Ajustes).</div>
          <div class="inline-form" style="margin-top:8px">
            <button type="button" class="btn btn-sm btn-primary" id="btn-choose-file">Elegir archivo…</button>
            <input type="file" id="csv-import-file" accept=".csv,text/csv" hidden>
          </div>
          <div id="csv-import-preview" style="min-width:0"></div>
        </div>`;
      $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => closeSheet(dlg)));
      $('#btn-dl-template', dlg).addEventListener('click', () => {
        downloadFile('finpepe-plantilla-movimientos.csv', csvImportTemplate(), 'text/csv');
      });
      $('#btn-choose-file', dlg).addEventListener('click', () => $('#csv-import-file', dlg).click());
      $('#csv-import-file', dlg).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        showPreview(await file.text());
      });
    }

    function showPreview(text) {
      const { items, headerError } = analyzeImportRows(text);
      const previewEl = $('#csv-import-preview', dlg);
      if (headerError) {
        previewEl.innerHTML = `<div class="banner">${esc(headerError)}</div>`;
        return;
      }
      const valid = items.filter((it) => it.ok);
      const invalid = items.filter((it) => !it.ok);
      const newCats = new Set();
      for (const it of valid) {
        const tipoLbl = it.type === 'ingreso' ? 'Ingreso' : 'Gasto';
        if (it.willCreateCat) newCats.add(`${tipoLbl}: ${it.catNameIn}`);
        if (it.willCreateSub) newCats.add(`${tipoLbl}: ${it.catNameIn} › ${it.subNameIn}`);
      }
      previewEl.innerHTML = `
        <div class="hint" style="margin-top:10px"><b>${valid.length}</b> movimiento${valid.length === 1 ? '' : 's'} listo${valid.length === 1 ? '' : 's'} para importar${invalid.length ? `, <b>${invalid.length}</b> con error${invalid.length === 1 ? '' : 'es'} (no se importan)` : ''}.</div>
        ${newCats.size ? `<div class="hint">Se van a crear estas categorías nuevas: ${esc([...newCats].join(' · '))}</div>` : ''}
        ${invalid.length ? `<div class="banner" style="display:grid; gap:4px">${invalid.slice(0, 15).map((it) => `<span>Fila ${it.lineNo}: ${esc(it.errors.join(', '))}</span>`).join('')}${invalid.length > 15 ? `<span>…y ${invalid.length - 15} más.</span>` : ''}</div>` : ''}
        ${valid.length ? `
        <div style="overflow-x:auto; margin-top:8px; min-width:0">
          <table class="data">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Monto</th><th>Categoría</th><th>Medio</th></tr></thead>
            <tbody>
              ${valid.slice(0, 30).map((it) => `<tr><td>${esc(fmtDateShort(it.date))}</td><td>${it.type === 'ingreso' ? 'Ingreso' : 'Gasto'}</td><td>${esc(fmtMoney(it.amount, it.currency))}</td><td>${esc(it.catNameIn)}${it.subNameIn ? ' › ' + esc(it.subNameIn) : ''}</td><td>${esc(it.methodNameIn)}</td></tr>`).join('')}
            </tbody>
          </table>
          ${valid.length > 30 ? `<div class="hint">…y ${valid.length - 30} más.</div>` : ''}
        </div>` : ''}
        <div class="inline-form" style="margin-top:12px">
          <button type="button" class="btn btn-sm btn-primary" id="btn-confirm-import" ${valid.length ? '' : 'disabled'}>Importar ${valid.length} movimiento${valid.length === 1 ? '' : 's'}</button>
          <span class="hint" id="import-status"></span>
        </div>`;
      if (valid.length) {
        $('#btn-confirm-import', dlg).addEventListener('click', () => runImportRows(valid, dlg));
      }
    }

    renderIntro();
    openModal(dlg);
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
      <div class="field">
        <label>Color</label>
        <div class="cat-colors" role="radiogroup" aria-label="Color de la categoría">
          ${Store.CATEGORY_COLORS.map((k) => `<label class="cat-color" style="--c:var(--c-${k})">
            <input type="radio" name="cgcolor" value="${k}" ${(editing ? catColorKey(group.id) : 'otros') === k ? 'checked' : ''}>
            <span class="cat-color-dot" aria-hidden="true"></span>
            <span class="cat-color-name">${CAT_COLOR_LABELS[k]}</span>
          </label>`).join('')}
        </div>
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
        const picked = $('input[name="cgcolor"]:checked', dlg);
        const color = picked ? picked.value : 'otros';
        if (editing) {
          group.name = name;
          group.color = color;
        } else {
          S().categories.push({ id: Store.uid(), name, type, parentId: null, color });
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

  /* Antes esta configuración vivía siempre desplegada en Ajustes; ahora es
     un pop-up aparte (botón "Configurar categorías"), para que Ajustes no
     tenga tanto texto/listas a la vista de entrada. */
  function categoriesSettingsDialog() {
    const bodyHTML = `
      <label class="subcats-toggle">
        Subcategorías
        <input type="checkbox" id="set-subcats" ${useSubcats() ? 'checked' : ''}>
      </label>
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
      </div>`;
    const dlg = openDialog('Categorías y subcategorías', bodyHTML, { submitLabel: 'Cerrar', viewOnly: true });
    $('#set-subcats', dlg).addEventListener('change', (e) => {
      S().settings.useSubcategories = e.target.checked;
      Store.save();
      render();
    });
    // Agregar/editar un grupo abre su propio diálogo (reutiliza el mismo
    // <dialog> de la app), así que este se cierra primero — mismo criterio
    // que "ver detalle → editar" en otros lugares de la app.
    $$('[data-addgroup]', dlg).forEach((b) => b.addEventListener('click', () => {
      dlg.close();
      categoryGroupForm(null, b.dataset.addgroup);
    }));
    $$('[data-editgroup]', dlg).forEach((b) => b.addEventListener('click', () => {
      dlg.close();
      categoryGroupForm(catById(b.dataset.editgroup), null);
    }));
  }

  /* ================= Notificaciones push ================= */
  // En iPhone solo funcionan con la app agregada a la pantalla de inicio
  // (iOS 16.4+): ahí corre como "standalone" y tiene PushManager. El
  // servidor que manda los avisos es la Edge Function "notify" de Supabase.
  const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  function urlB64ToUint8Array(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }
  async function currentPushSub() {
    if (!pushSupported()) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }
  async function enablePush() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('No diste permiso para las notificaciones. Podés habilitarlo en Ajustes del iPhone → Notificaciones → FinPep.');
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    const { publicKey } = await Cloud.notifyFn({ action: 'vapid' });
    if (!publicKey) throw new Error('El servidor de notificaciones todavía no está configurado (falta la clave VAPID).');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) });
    await Cloud.savePushSubscription(sub);
  }
  async function disablePush() {
    const sub = await currentPushSub();
    if (!sub) return;
    try { await Cloud.deletePushSubscription(sub.endpoint); } catch (e) { console.error(e); }
    await sub.unsubscribe();
  }
  async function paintNotifCard(card) {
    const box = $('.notif-body', card);
    if (!box) return;
    // Qué avisos querés recibir: se guarda en tu cuenta (settings.notifPrefs,
    // sincronizado con la nube), así vale para todos tus dispositivos; el
    // servidor solo manda los tildados.
    const prefs = S().settings.notifPrefs || {};
    const NOTIF_OPTS = [
      ['due', 'card', 'Vencimientos de tarjeta', 'Un día antes y el día que vence, con el total del resumen.'],
      ['alerts', 'target', 'Alertas de tope', 'Cuando el resumen en curso llega al 85% y al 100% del tope (o del promedio).'],
      ['fixed', 'repeat', 'Se genera un fijo', 'El día que se carga cada gasto o ingreso fijo.'],
      ['partner', 'users', 'Tu pareja carga un gasto', 'Apenas tu pareja carga un gasto compartido.'],
      ['reminder', 'cal', 'Recordatorio', 'A las 21 h, si ese día no cargaste ningún movimiento.'],
    ];
    const what = `<h3 class="ovl set-h">Qué avisos querés</h3><div class="group">${NOTIF_OPTS.map(([k, icon, t, d]) => `
      <label class="row set-row">
        <span class="cic" style="--c:var(--t2)">${spriteIcon(icon)}</span>
        <div class="row-main"><div class="tt">${t}</div><div class="st st-wrap">${d}</div></div>
        <input type="checkbox" switch class="switch" data-notif="${k}" ${prefs[k] === false ? '' : 'checked'}>
      </label>`).join('')}</div>`;
    const wirePrefs = () => $$('[data-notif]', box).forEach((cb) => cb.addEventListener('change', () => {
      S().settings.notifPrefs = { ...(S().settings.notifPrefs || {}), [cb.dataset.notif]: cb.checked };
      Store.save();
      paintNotifSummary();
    }));
    if (!Cloud.user()) { box.innerHTML = `<p class="t2">Iniciá sesión (en Ajustes › Cuenta) para activar las notificaciones.</p>${what}`; wirePrefs(); return; }
    if (isIOS() && !isStandalone()) {
      box.innerHTML = `<p class="t2">En iPhone las notificaciones funcionan solo con FinPep agregada a la pantalla de inicio: en Safari tocá <b>Compartir → Agregar a inicio</b> y abrila desde ese ícono.</p>${what}`;
      wirePrefs();
      return;
    }
    if (!pushSupported()) { box.innerHTML = '<p class="t2">Este navegador no soporta notificaciones push.</p>'; return; }
    const sub = await currentPushSub();
    const on = !!sub && Notification.permission === 'granted';
    // Activadas: un interruptor para apagarlas y "Enviar prueba" como link.
    // Desactivadas: un solo botón primario para activarlas.
    box.innerHTML = `
      ${on ? `<div class="group">
        <label class="row set-row">
          <span class="cic" style="--c:var(--brand-text)">${spriteIcon('bolt')}</span>
          <div class="row-main"><div class="tt">En este dispositivo</div><div class="st">Activadas</div></div>
          <input type="checkbox" switch class="switch" id="sw-push" checked>
        </label>
      </div>` : ''}
      ${what}
      ${on ? '<button type="button" class="btn-ter" id="btn-push-test">Enviar una prueba</button>'
        : '<button type="button" class="btn btn-primary btn-full btn-save" id="btn-push-on">Activar notificaciones</button>'}
      <div class="hint notif-msg" aria-live="polite"></div>`;
    wirePrefs();
    const msg = (t) => { const m = $('.notif-msg', box); if (m) m.textContent = t; };
    const run = (id, fn) => { const b = $(id, box); if (b) b.addEventListener('click', async () => {
      b.disabled = true;
      try { await fn(); } catch (e) { msg(e.message || String(e)); b.disabled = false; return; }
      b.disabled = false;
    }); };
    run('#btn-push-on', async () => { msg('Activando…'); await enablePush(); await paintNotifCard(card); paintNotifSummary(); msg('Listo. Probá con "Enviar una prueba".'); });
    const sw = $('#sw-push', box);
    if (sw) sw.addEventListener('change', async () => {
      sw.disabled = true;
      try { await disablePush(); } catch (e) { msg(e.message || String(e)); }
      await paintNotifCard(card);
      paintNotifSummary();
    });
    run('#btn-push-test', async () => {
      msg('Enviando…');
      const r = await Cloud.notifyFn({ action: 'test' });
      msg(r && r.sent ? 'Enviada. Debería llegarte en unos segundos.' : 'No se pudo enviar (' + ((r && r.error) || 'sin detalle') + ').');
    });
  }

  // Ajustes: la tarjeta de notificaciones muestra solo un resumen y un
  // botón; todo lo demás (activar, tipos, prueba) vive en un pop-up.
  async function paintNotifSummary() {
    const box = $('#notif-summary');
    if (!box) return;
    const prefs = S().settings.notifPrefs || {};
    const nOn = ['due', 'alerts', 'fixed', 'partner', 'reminder'].filter((k) => prefs[k] !== false).length;
    let state;
    if (!Cloud.user()) state = 'Sin sesión';
    else if (!pushSupported() || (isIOS() && !isStandalone())) state = 'No disponibles';
    else {
      const sub = await currentPushSub().catch(() => null);
      state = sub && Notification.permission === 'granted' ? 'Activadas' : 'Desactivadas';
    }
    box.textContent = state;
  }
  function notifDialog() {
    const dlg = openDialog('Notificaciones', '<div class="notif-body"><div class="skeleton-list"><i></i><i></i><i></i></div></div>', { viewOnly: true });
    paintNotifCard(dlg).catch((e) => console.error(e));
  }

  /* Confirmación dentro de un panel (en vez de confirm() nativo). */
  function confirmPanel({ title, text, confirmLabel, onConfirm }) {
    openPanel({
      title,
      body: `<div class="confirm-box">
        <p class="t2">${esc(text)}</p>
        <button type="button" class="btn btn-full btn-danger-fill" data-cyes>${esc(confirmLabel)}</button>
        <button type="button" class="btn-ter" data-cno>Cancelar</button>
      </div>`,
      onClick(e, dlg) {
        if (e.target.closest('[data-cno]')) { closeSheet(dlg); return; }
        if (e.target.closest('[data-cyes]')) closeSheet(dlg).then(onConfirm);
      },
    });
  }

  /* Ajustes como lista agrupada estilo iOS: cada fila con su ícono, el
     valor a la derecha y chevron; interruptores en vez de checkboxes. Lo
     destructivo (cerrar sesión, borrar todo) va al final, aparte. */
  function setRow({ id, icon, color = 'var(--t2)', label, value = '', chevron = true, sub = '' }) {
    return `<button type="button" class="row set-row" id="${id}">
      <span class="cic" style="--c:${color}">${spriteIcon(icon)}</span>
      <div class="row-main"><div class="tt">${esc(label)}</div>${sub ? `<div class="st">${esc(sub)}</div>` : ''}</div>
      <span class="set-value">${value}</span>
      ${chevron ? spriteIcon('cr').replace('class="ic"', 'class="ic chev"') : '<span></span>'}
    </button>`;
  }
  function setSelectRow({ id, icon, color = 'var(--t2)', label, options, selected }) {
    const sel = options.find((o) => o.value === selected) || options[0];
    return `<label class="row set-row set-select">
      <span class="cic" style="--c:${color}">${spriteIcon(icon)}</span>
      <div class="row-main"><div class="tt">${esc(label)}</div></div>
      <span class="set-value">${esc(sel ? sel.label : '')}</span>
      ${spriteIcon('cd').replace('class="ic"', 'class="ic chev"')}
      <select id="${id}" aria-label="${esc(label)}">${options.map((o) => `<option value="${esc(o.value)}" ${o.value === selected ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
    </label>`;
  }
  function setSwitchRow({ id, icon, color = 'var(--t2)', label, sub = '', checked }) {
    return `<label class="row set-row">
      <span class="cic" style="--c:${color}">${spriteIcon(icon)}</span>
      <div class="row-main"><div class="tt">${esc(label)}</div>${sub ? `<div class="st st-wrap">${esc(sub)}</div>` : ''}</div>
      <input type="checkbox" switch class="switch" id="${id}" ${checked ? 'checked' : ''}>
    </label>`;
  }

  function vAjustes(el) {
    const s = S().settings;
    const updated = s.ratesUpdatedAt
      ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(s.ratesUpdatedAt))
      : 'nunca';
    const r = rate();
    const nCats = S().categories.filter((c) => !c.parentId).length;

    el.innerHTML = `
      <h2 class="ovl set-h">Apariencia</h2>
      <div class="group">
        ${setSwitchRow({ id: 'set-light', icon: 'eye', color: 'var(--c-super)', label: 'Modo claro', checked: currentTheme() === 'light' })}
      </div>

      <h2 class="ovl set-h">General</h2>
      <div class="group">
        ${setRow({ id: 'btn-notif-config', icon: 'bolt', color: 'var(--c-comida)', label: 'Notificaciones', value: '<span id="notif-summary" class="t3"></span>' })}
        ${setRow({ id: 'btn-open-categories', icon: 'target', color: 'var(--c-compras)', label: 'Categorías', value: `${nCats}` })}
      </div>

      <h2 class="ovl set-h">Cotización del dólar</h2>
      <div class="group">
        ${setSelectRow({ id: 'set-fx', icon: 'dollar', color: 'var(--brand-text)', label: 'Tipo de cambio', selected: s.fxSource, options: FX.SOURCES.map((x) => ({ value: x.id, label: x.name })) })}
        ${setRow({ id: 'btn-manual', icon: 'note', label: 'Cotización', value: r ? `US$ 1 = ${esc(fmtPlain(r.value, 'ARS'))}` : 'Sin datos', sub: s.manualRate ? 'Manual (pisa la automática)' : `Automática · ${updated}` })}
        ${setRow({ id: 'btn-fx-refresh', icon: 'repeat', label: 'Actualizar ahora', chevron: false })}
      </div>
      <p class="set-foot">Se usa para convertir ARS ⇄ USD en toda la app. Fuente: DolarAPI.</p>

      <h2 class="ovl set-h">Balance del mes</h2>
      <div class="group">
        ${setSelectRow({ id: 'set-cardmonth', icon: 'card', color: 'var(--c-auto)', label: 'Tarjetas de crédito cuentan por', selected: s.cardMonthBasis, options: [{ value: 'compra', label: 'Fecha de compra' }, { value: 'vencimiento', label: 'Vencimiento' }] })}
        ${setSwitchRow({ id: 'set-leftover', icon: 'wallet', color: 'var(--c-tel)', label: 'Sobrante del mes anterior', sub: 'Acredita como ingreso lo que sobró el mes anterior, al empezar cada mes.', checked: !!s.autoLeftoverIncome })}
      </div>

      <h2 class="ovl set-h">Datos</h2>
      <div class="group">
        ${setRow({ id: 'btn-export-json', icon: 'down', label: 'Descargar respaldo (JSON)', chevron: false })}
        ${setRow({ id: 'btn-import-json', icon: 'up', label: 'Restaurar respaldo…' })}
        ${setRow({ id: 'btn-export-csv', icon: 'down', label: 'Exportar movimientos (CSV)', chevron: false })}
        ${setRow({ id: 'btn-import-csv', icon: 'up', label: 'Importar movimientos (CSV)…' })}
      </div>
      <input type="file" id="file-import" accept="application/json,.json" hidden>
      <p class="set-foot">Todo se guarda en este dispositivo${Cloud.user() ? ' y en la nube' : ''}. Descargá un respaldo cada tanto.</p>

      <h2 class="ovl set-h">Cuenta</h2>
      <div class="k-card set-account" id="account-card">${accountCardHTML()}</div>

      <div class="group set-danger-group">
        ${Cloud.user() ? '<button type="button" class="row set-row set-danger" id="btn-signout"><span class="tt">Cerrar sesión</span></button>' : ''}
        <button type="button" class="row set-row set-danger" id="btn-wipe"><span class="tt">Borrar todos los datos</span></button>
      </div>`;

    wireAccountCard(el);
    $('#set-light', el).addEventListener('change', toggleTheme);
    paintNotifSummary().catch((e) => console.error(e));
    $('#btn-notif-config', el).addEventListener('click', notifDialog);
    $('#btn-open-categories', el).addEventListener('click', () => categoriesSettingsDialog());
    $('#set-fx', el).addEventListener('change', (e) => {
      S().settings.fxSource = e.target.value;
      Store.save();
      render();
    });
    $('#btn-fx-refresh', el).addEventListener('click', refreshRates);
    $('#btn-manual', el).addEventListener('click', () => {
      const dlg = openDialog('Cotización manual', `
        <div class="field">
          <label for="set-manual">Pesos por dólar</label>
          <input type="number" name="manual" id="set-manual" min="0" step="0.01" inputmode="decimal" placeholder="Vacío = automática" value="${S().settings.manualRate ?? ''}">
          <span class="hint">Si la cargás, pisa la cotización automática en toda la app. Dejala vacía para volver a la automática.</span>
        </div>`, {
        submitLabel: 'Guardar',
        onSubmit(d) {
          const v = parseFloat(d.manual);
          S().settings.manualRate = v > 0 ? v : null;
          Store.save();
          render();
        },
      });
      $('#set-manual', dlg).focus();
    });
    $('#set-cardmonth', el).addEventListener('change', (e) => {
      S().settings.cardMonthBasis = e.target.value;
      Store.save();
      render();
    });
    $('#set-leftover', el).addEventListener('change', (e) => {
      S().settings.autoLeftoverIncome = e.target.checked;
      // Al activarlo por primera vez, arranca desde el mes actual (no
      // acredita retroactivamente años de historial sin que el usuario lo
      // pida) — igual que un movimiento fijo nuevo.
      if (e.target.checked && !S().settings.leftoverLastGen) {
        S().settings.leftoverLastGen = addMonthsKey(curMonth(), -1);
      }
      Store.save();
      generateLeftoverIncome();
      render();
    });
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
        confirmPanel({
          title: 'Restaurar respaldo',
          text: 'Esto reemplaza todos los datos actuales por los del respaldo.',
          confirmLabel: 'Reemplazar mis datos',
          onConfirm: () => { Store.replace(data); render(); showToast('Se restauró el respaldo'); },
        });
      } catch (err) {
        alert('No se pudo leer el respaldo: ' + err.message);
      }
      e.target.value = '';
    });
    $('#btn-export-csv', el).addEventListener('click', exportCSV);
    $('#btn-import-csv', el).addEventListener('click', importCSVDialog);
    const out = $('#btn-signout', el);
    if (out) out.addEventListener('click', () => confirmPanel({
      title: 'Cerrar sesión',
      text: 'Tus datos quedan guardados en la nube. En este dispositivo se borran hasta que vuelvas a entrar.',
      confirmLabel: 'Cerrar sesión',
      onConfirm: signOutNow,
    }));
    $('#btn-wipe', el).addEventListener('click', () => confirmPanel({
      title: 'Borrar todos los datos',
      text: 'Se borran TODOS los datos de la app en este dispositivo. No se puede deshacer: si no tenés un respaldo, no hay forma de recuperarlos.',
      confirmLabel: 'Borrar todo',
      onConfirm: () => { Store.reset(); render(); },
    }));
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
        <div class="hint" style="margin-bottom:10px">Tus datos se sincronizan en todos tus dispositivos donde inicies sesión.</div>
        ${Cloud.hasGoogle()
          ? '<div class="hint" style="margin-bottom:10px">✓ Google vinculado: también podés entrar con esa cuenta.</div>'
          : `<div class="inline-form" style="margin-bottom:10px">
               <button class="btn btn-sm" id="btn-cloud-link-google">${GOOGLE_G_SVG}Vincular con Google</button>
             </div>`}
        <div class="inline-form">
          <button class="btn btn-sm" id="btn-cloud-pull">Traer datos de la nube</button>
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

  async function signOutNow() {
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
      // loadShared() no depende de Cloud.pull() (son datos independientes:
      // movimientos propios vs. hogar compartido) — antes se disparaba
      // recién DESPUÉS de esperar el pull, sumando ese tiempo al de sus
      // propias consultas y haciendo tardar bastante más de la cuenta en
      // aparecer la tarjeta de compartidos. Ahora arrancan en paralelo.
      loadShared();
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
          // Si la nube tiene exactamente lo mismo que ya está acá (lo que
          // este mismo dispositivo subió), no se reemplaza nada. Supabase
          // dispara este chequeo cada vez que la app vuelve a primer plano,
          // y reemplazar el estado en memoria dejaba "desenganchado" el
          // objeto que tenía abierto un diálogo (ej. editar un resumen de
          // tarjeta después de ir a mirar el PDF del banco): lo que se
          // guardaba ahí no llegaba a los datos reales y "no cambiaba nada".
          const sameAsLocal = !localEmpty && remote.data._updatedAt != null && remote.data._updatedAt === S()._updatedAt;
          // La nube manda salvo que lo local sea más nuevo y la nube esté vacía de cambios.
          if (sameAsLocal) {
            // nada que hacer
          } else if (localEmpty || (remoteTs >= localTs && !remoteLooksStale)) {
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
    }
    // Recién ACÁ, después de resolver qué versión ganó (remota o local) —
    // no antes: si generateRecurring()/generateLeftoverIncome() corrieran
    // apenas se abre la app (como antes), Store.save() pisaría _updatedAt
    // con la hora actual justo antes de comparar arriba, y este dispositivo
    // "ganaría" la sincronización SIEMPRE que generara algo, aunque el otro
    // dispositivo tuviera cambios más nuevos todavía no bajados acá — eso
    // podía duplicar un gasto recurrente y de paso pisar en la nube los
    // datos reales de la otra persona con una copia vieja + el duplicado.
    generateRecurring();
    generateLeftoverIncome();
    realignCardInstallments();
    render();
  }

  async function initCloud() {
    if (!Cloud.available() || !Cloud.isConfigured()) { renderAccountChip(); return; }
    // Mientras se sincroniza con la nube, los montos se muestran como
    // esqueletos (body.syncing) en vez de números que después cambian.
    document.body.classList.add('syncing');
    setTimeout(() => document.body.classList.remove('syncing'), 10000); // por si la red no responde
    try {
      await Cloud.init(onAuthChanged);
      await onAuthChanged();
      document.body.classList.remove('syncing');
      // Lo primero que se ve al abrir la app (si no hay sesión): invitar a
      // iniciar sesión o crear cuenta, con Google o usuario/contraseña. El
      // diálogo tiene su propio botón para seguir sin cuenta, así que no
      // bloquea el uso offline.
      if (!Cloud.user()) authDialog();
    } catch (e) {
      console.error('Init nube', e);
      document.body.classList.remove('syncing');
      renderAccountChip();
      // Si falló acá (ej. sin señal) nunca se llega a onAuthChanged(): sin
      // esto, un recurrente o el sobrante del mes no se generarían nunca
      // esta sesión.
      generateRecurring();
      generateLeftoverIncome();
      realignCardInstallments();
      render();
    }
  }

  // Cuando falta correr (o falta actualizar) supabase-schema.sql en el
  // proyecto, Postgres rechaza el insert con este mensaje — lo detectamos
  // para dar una pista accionable en vez de mostrar el error crudo.
  function friendlyCloudError(e) {
    const raw = (e && (e.message || String(e))) || 'Error desconocido.';
    if (/row-level security/i.test(raw) || /column .* does not exist/i.test(raw)) {
      return raw + '\n\nProbablemente falta correr (o está desactualizado) el script supabase-schema.sql ' +
        'en tu proyecto de Supabase: Supabase → SQL Editor → pegá todo el contenido de ese archivo → Run. ' +
        'Es seguro volver a correrlo, no borra datos existentes.';
    }
    return raw;
  }

  /* ================= Vista: Compartido (gastos en pareja) ================= */
  // Caché en memoria: esta vista vive en Supabase, no en Store (la usan dos
  // cuentas distintas a la vez), así que se carga aparte de forma asíncrona.
  const shared = { loaded: false, loading: false, household: null, expenses: [], settlements: [], error: null };

  function sharedMe() { return Cloud.user(); }
  function sharedPartner() {
    if (!shared.household) return null;
    const me = sharedMe();
    return shared.household.members.find((m) => m.user_id !== me.id) || null;
  }

  // Devuelve siempre una promesa que termina cuando se cargó el hogar
  // (aunque ya hubiera una carga en curso): así quien la necesita — por
  // ejemplo el formulario de un gasto, para ofrecer "compartido" — puede
  // esperarla en vez de asumir que no hay hogar.
  let sharedLoadPromise = null;
  function loadShared() {
    if (shared.loading && sharedLoadPromise) return sharedLoadPromise;
    sharedLoadPromise = loadSharedNow();
    return sharedLoadPromise;
  }
  async function loadSharedNow() {
    shared.loading = true;
    shared.error = null;
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
      // No pisar shared.household con null: si ya lo teníamos cargado de
      // antes (ej. un refresh que falló), mejor mostrar lo viejo que hacer
      // desaparecer de golpe el hogar y ofrecer "crear hogar" de nuevo.
      shared.error = friendlyCloudError(e);
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
    if (!m) return 'tu pareja';
    return m.display_name || (m.email ? m.email.split('@')[0] : 'tu pareja');
  }

  function meMember() {
    if (!shared.household) return null;
    const me = sharedMe();
    return shared.household.members.find((m) => m.user_id === me.id) || null;
  }

  function meLabel() {
    const me = sharedMe();
    const mine = meMember();
    if (mine && mine.display_name) return mine.display_name;
    return (me && me.email) ? me.email.split('@')[0] : 'Vos';
  }

  function editNameForm() {
    const mine = meMember();
    const body = `
      <div class="field">
        <label for="nm-name">Tu nombre</label>
        <input type="text" name="name" id="nm-name" maxlength="24" required value="${esc((mine && mine.display_name) || '')}" placeholder="${esc(meLabel())}">
        <span class="hint">Así te va a ver tu pareja en Compartido.</span>
      </div>`;
    openDialog('Cambiar tu nombre', body, {
      submitLabel: 'Guardar',
      async onSubmit(d) {
        try {
          await Cloud.updateDisplayName(shared.household.id, d.name);
          shared.household = await Cloud.getHousehold();
          render();
        } catch (e) { alert('No se pudo guardar: ' + friendlyCloudError(e)); return false; }
      },
    });
  }

  // Total pagado por cada uno (no el balance neto): alimenta la hoja de
  // balance de la vista Compartido.
  function sharedTotals() {
    const me = sharedMe();
    const partner = sharedPartner();
    let mine = 0, theirs = 0;
    for (const e of shared.expenses) {
      const amt = convOrNull(Number(e.amount), e.currency);
      if (amt == null) continue;
      if (e.paid_by === me.id) mine += amt;
      else if (partner && e.paid_by === partner.user_id) theirs += amt;
    }
    return { mine, theirs };
  }

  function initials(label) {
    return (label || '?').trim().charAt(0).toUpperCase() || '?';
  }

  // Fecha relativa en español para el feed de Compartido ("hace 3 semanas"),
  // más fácil de leer de un vistazo que la fecha corta de fmtDateShort.
  function timeAgo(str) {
    const d = parseDate(str);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today - d) / 86400000);
    if (diffDays <= 0) return 'Hoy';
    if (diffDays === 1) return 'Ayer';
    if (diffDays < 7) return `hace ${diffDays} días`;
    if (diffDays < 30) { const w = Math.round(diffDays / 7); return `hace ${w} semana${w > 1 ? 's' : ''}`; }
    if (diffDays < 365) { const m = Math.round(diffDays / 30); return `hace ${m} mes${m > 1 ? 'es' : ''}`; }
    const y = Math.round(diffDays / 365);
    return `hace ${y} año${y > 1 ? 's' : ''}`;
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
      submitLabel: 'Guardar gasto',
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

  // Saldar la deuda (todo o una parte): viene con el monto y la dirección
  // de la deuda actual, y se puede cambiar el monto para un pago parcial.
  function settlementForm(prefill = {}) {
    const partner = sharedPartner();
    const me = sharedMe();
    if (!partner) return;
    const meToPartner = prefill.meToPartner !== false;
    const body = `
      <div class="field">
        <label for="st-dir">¿Quién le paga a quién?</label>
        <select name="dir" id="st-dir">
          <option value="me-to-partner" ${meToPartner ? 'selected' : ''}>Yo le pago a ${esc(partnerLabel(partner))}</option>
          <option value="partner-to-me" ${meToPartner ? '' : 'selected'}>${esc(partnerLabel(partner))} me paga a mí</option>
        </select>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="st-amount">Monto</label>
          <input type="number" name="amount" id="st-amount" min="0.01" step="0.01" required inputmode="decimal" value="${prefill.amount ? Math.round(prefill.amount * 100) / 100 : ''}">
          <span class="hint">Podés pagar una parte.</span>
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
    openDialog('Saldar deuda', body, {
      submitLabel: 'Registrar pago',
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
      el.innerHTML = `<div class="k-card skeleton-card" aria-busy="true" aria-label="Cargando"><i class="sk sk-avs"></i><i class="sk sk-line"></i><i class="sk sk-big"></i><i class="sk sk-line"></i></div>
        <div class="group skeleton-list" aria-hidden="true"><i></i><i></i><i></i></div>`;
      loadShared();
      return;
    }

    if (!shared.household && shared.error) {
      // Si falló la carga no hay forma de saber si es porque de verdad no
      // tenés hogar o porque la consulta explotó (ej. falta correr una
      // migración de supabase-schema.sql) — mostrar el onboarding de
      // "crear hogar" en ese caso arriesga a que crees uno duplicado.
      el.innerHTML = `<div class="card">
        <h2 class="card-title">Gastos compartidos</h2>
        <div class="empty">
          No se pudo cargar tu hogar compartido.<br><br>
          <span class="hint">${esc(shared.error)}</span><br><br>
          <button class="btn btn-primary btn-sm" id="btn-retry-shared">Reintentar</button>
        </div>
      </div>`;
      $('#btn-retry-shared', el).addEventListener('click', () => {
        shared.loaded = false;
        render();
      });
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
    const myName = meLabel();
    const partnerName = partner ? partnerLabel(partner) : null;
    const meIsDebtor = bal < -0.01;
    const hasDebt = partner && balAbs >= 0.01;
    const me = sharedMe();
    // Un color fijo por persona, el mismo en avatares, barras y gráfico.
    const ME_COLOR = 'var(--c-tel)', PARTNER_COLOR = 'var(--c-super)';
    const avatar = (name, color) => `<span class="av" style="background:${color}">${esc(initials(name))}</span>`;

    // Deber plata no es una alerta ni un logro: el monto va en color neutro.
    const headline = !partner
      ? 'Esperando a que tu pareja se una'
      : !hasDebt ? 'Están a mano'
        : meIsDebtor ? `Le debés a ${partnerName}` : `${partnerName} te debe`;

    // Tu parte de un gasto compartido (lo que te toca pagar a vos).
    const myPart = (e) => {
      const amt = Number(e.amount);
      return e.paid_by === me.id ? amt * Number(e.payer_share) : amt * (1 - Number(e.payer_share));
    };
    const conv = (v, cur) => convOrNull(Number(v), cur);

    // Quién pagó en el mes en curso.
    const cm = curMonth();
    const paidIn = (m, uid) => shared.expenses.reduce((acc, e) => {
      if (monthKeyOf(e.date) !== m || e.paid_by !== uid) return acc;
      const v = conv(e.amount, e.currency);
      return v == null ? acc : acc + v;
    }, 0);
    const mineCm = paidIn(cm, me.id);
    const theirsCm = partner ? paidIn(cm, partner.user_id) : 0;
    const totalCm = mineCm + theirsCm;

    // Gastos en común por mes (los últimos 6 desde el primero con gastos):
    // barras apiladas por persona con el total arriba.
    const shMonths = [];
    if (shared.expenses.length) {
      const first = shared.expenses.map((e) => monthKeyOf(e.date)).sort()[0];
      for (let i = 5; i >= 0; i--) { const m = addMonthsKey(cm, -i); if (m >= first) shMonths.push(m); }
    }
    const monthRows = shMonths.map((m) => ({ label: monthShortLabel(m).toLowerCase(), mine: paidIn(m, me.id), theirs: partner ? paidIn(m, partner.user_id) : 0 }));
    const chartSvg = (() => {
      if (!partner || !monthRows.length) return '';
      const W = 320, H = 140, base = 118, top = 26;
      const max = Math.max(1, ...monthRows.map((r) => r.mine + r.theirs));
      const slot = W / monthRows.length, bw = Math.min(44, slot * 0.55);
      const yh = (v) => (v / max) * (base - top);
      const short = (v) => (hideAmounts ? '•••' : v >= 1e6 ? `${(v / 1e6).toFixed(2).replace('.', ',')} M` : v >= 1e3 ? `${Math.round(v / 1e3)} mil` : String(Math.round(v)));
      return `<svg class="gchart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(`Gastos en común por mes: ${monthRows.map((r) => `${r.label} ${hideAmounts ? '' : fmtPlain(r.mine + r.theirs)} (${myName} ${hideAmounts ? '' : fmtPlain(r.mine)}, ${partnerName} ${hideAmounts ? '' : fmtPlain(r.theirs)})`).join('; ')}`)}">
        <line x1="0" x2="320" y1="${base}" y2="${base}" class="g-grid"/>
        ${monthRows.map((r, i) => {
          const x = slot * i + (slot - bw) / 2, cx = slot * i + slot / 2;
          const hMe = yh(r.mine), hTh = yh(r.theirs), tot = r.mine + r.theirs;
          return `${hMe > 0 ? `<rect x="${x.toFixed(1)}" y="${(base - hMe).toFixed(1)}" width="${bw.toFixed(1)}" height="${hMe.toFixed(1)}" rx="${hTh > 0 ? 0 : 5}" style="fill:${ME_COLOR}"/>` : ''}
            ${hTh > 0 ? `<rect x="${x.toFixed(1)}" y="${(base - hMe - hTh).toFixed(1)}" width="${bw.toFixed(1)}" height="${hTh.toFixed(1)}" rx="5" style="fill:${PARTNER_COLOR}"/>` : ''}
            ${tot > 0 ? `<text x="${cx.toFixed(1)}" y="${(base - hMe - hTh - 8).toFixed(1)}" text-anchor="middle" class="g-lab">${short(tot)}</text>` : ''}
            <text x="${cx.toFixed(1)}" y="135" text-anchor="middle"${shMonths[i] === cm ? ' class="g-sel"' : ''}>${esc(r.label)}</text>`;
        }).join('')}
      </svg>`;
    })();

    // Últimos en común (gastos y pagos), los más nuevos primero.
    const feed = [
      ...shared.expenses.map((e) => ({ kind: 'expense', ...e })),
      ...shared.settlements.map((x) => ({ kind: 'settlement', ...x })),
    ].sort((x, y) => y.date.localeCompare(x.date) || (y.created_at || '').localeCompare(x.created_at || ''));
    const shortDate = (d) => new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(parseDate(d)).replace('.', '');
    const feedRow = (item) => {
      if (item.kind === 'settlement') {
        const fromMe = item.from_user === me.id;
        return `<button type="button" class="row sh-row" data-shared-item="settlement:${esc(item.id)}">
          <span class="cic" style="--c:var(--brand-text)">${spriteIcon('swap')}</span>
          <div class="row-main"><div class="tt">${fromMe ? `Le pagaste a ${esc(partnerName)}` : `${esc(partnerName)} te pagó`}</div><div class="st">Pago · ${esc(shortDate(item.date))}${item.note ? ' · ' + esc(item.note) : ''}</div></div>
          <div class="amt"><span class="num money">${esc(fmtPlain(Number(item.amount), item.currency))}</span></div>
        </button>`;
      }
      const paidByMe = item.paid_by === me.id;
      // Si el gasto salió de un movimiento tuyo, toma el ícono y el color de
      // su categoría; si no, el color de quien pagó.
      const myTx = S().transactions.find((t) => t.sharedExpenseId === item.id);
      const icon = myTx ? `<span class="cic" style="--c:${catColor(myTx.categoryId)}">${iconSvg(categoryIconName(myTx.categoryId))}</span>`
        : `<span class="cic" style="--c:${paidByMe ? ME_COLOR : PARTNER_COLOR}">${spriteIcon('users')}</span>`;
      return `<button type="button" class="row sh-row" data-shared-item="expense:${esc(item.id)}">
        ${icon}
        <div class="row-main"><div class="tt">${esc(item.note || (myTx ? catName(myTx.categoryId) : 'Gasto compartido'))}</div><div class="st">Pagó ${esc(paidByMe ? myName : partnerName)} · ${esc(shortDate(item.date))}</div></div>
        <div class="amt"><span class="num money">${esc(fmtPlain(Number(item.amount), item.currency))}</span><small class="money">tu parte ${esc(fmtPlain(myPart(item), item.currency))}</small></div>
      </button>`;
    };

    el.innerHTML = `
      <section class="k-card sh-card">
        <div class="sh-who">
          <span class="avs">${avatar(myName, ME_COLOR)}${partner ? avatar(partnerName, PARTNER_COLOR) : ''}</span>
          <span class="ovl">${esc(shared.household.name || 'Hogar compartido')}</span>
        </div>
        <p class="t2 sh-headline">${esc(headline)}</p>
        ${hasDebt ? `<div class="big num money sh-big">${esc(fmtPlain(balAbs))}</div>` : ''}
        <div class="sh-actions${hasDebt ? '' : ' single'}">
          ${hasDebt ? '<button type="button" class="btn btn-primary" data-settle>Saldar deuda</button>' : ''}
          ${partner ? `<button type="button" class="btn btn-sec" data-addse>${spriteIcon('plus')}Gasto</button>` : '<button type="button" class="btn btn-primary" data-invite>Generar código para tu pareja</button>'}
        </div>
        <div id="invite-box"></div>
        ${partner ? `
        <div class="sh-paid">
          <div class="sh-paid-h"><span class="ovl">Quién pagó en ${esc(new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(parseDate(cm + '-01')))}</span><span class="t2 num money">${esc(fmtPlain(totalCm))}</span></div>
          <div class="stack">${totalCm > 0 ? `<i style="width:${((mineCm / totalCm) * 100).toFixed(2)}%;background:${ME_COLOR}"></i><i style="width:${((theirsCm / totalCm) * 100).toFixed(2)}%;background:${PARTNER_COLOR}"></i>` : ''}</div>
          <div class="sh-paid-who"><span><span class="t2">${esc(myName)}</span> <b class="num money">${esc(fmtPlain(mineCm))}</b></span><span><span class="t2">${esc(partnerName)}</span> <b class="num money">${esc(fmtPlain(theirsCm))}</b></span></div>
        </div>` : ''}
      </section>

      ${chartSvg ? `
      <section class="k-card">
        <div class="k-card-h k-card-h-tight"><h2>Gastos en común por mes</h2></div>
        <div class="legend"><span><i style="background:${ME_COLOR}"></i>${esc(myName)}</span><span><i style="background:${PARTNER_COLOR}"></i>${esc(partnerName)}</span></div>
        ${chartSvg}
      </section>` : ''}

      ${feed.length ? `
      <div class="sh-feed-h"><span class="ovl">Últimos en común</span>${feed.length > 3 ? `<button type="button" class="link" data-allfeed>Ver los ${feed.length}${spriteIcon('cr').replace('class="ic"', 'class="ic chev"')}</button>` : ''}</div>
      <div class="group">${feed.slice(0, 3).map(feedRow).join('')}</div>` : (partner ? '<div class="empty">Todavía no cargaron ningún gasto compartido. Tocá "+ Gasto" o marcá un gasto como compartido al cargarlo.</div>' : '')}`;

    // Menú ⋮ de la hoja: editar, actualizar y salir del hogar (con la
    // confirmación adentro del mismo panel, sin diálogo nativo).
    const right = $('#bar-right');
    if (right) {
      right.innerHTML = `<button type="button" class="icb" data-shmenu aria-label="Opciones del hogar">${spriteIcon('dots-v')}</button>`;
      $('[data-shmenu]', right).addEventListener('click', sharedMenuSheet);
    }
    function sharedMenuSheet() {
      const item = (key, icon, label, danger) => `<button type="button" class="pick-row${danger ? ' pick-danger' : ''}" data-shopt="${key}"><span class="cic" style="--c:${danger ? 'var(--neg)' : 'var(--t2)'}">${icon}</span><span>${esc(label)}</span></button>`;
      openPanel({
        title: shared.household.name || 'Hogar compartido',
        body: `<div class="pick-list" data-shmenu-list>
          ${partner ? item('name', spriteIcon('note'), 'Cambiar tu nombre') : item('invite', spriteIcon('users'), 'Generar código para tu pareja')}
          ${item('refresh', spriteIcon('repeat'), 'Actualizar')}
          ${item('leave', spriteIcon('back'), 'Salir del hogar', true)}
        </div>`,
        onClick(e, dlg) {
          const b = e.target.closest('[data-shopt]');
          if (!b) return;
          const k = b.dataset.shopt;
          if (k === 'name') { closeSheet(dlg).then(editNameForm); return; }
          if (k === 'invite') { closeSheet(dlg).then(makeInvite); return; }
          if (k === 'refresh') { closeSheet(dlg).then(() => { shared.loaded = false; render(); }); return; }
          if (k === 'leave') {
            $('[data-shbody]', dlg).innerHTML = `
              <div class="confirm-box">
                <p><b>¿Salir de este hogar?</b></p>
                <p class="t2">Vas a dejar de ver el historial de gastos en común. Tu pareja lo sigue viendo.</p>
                <button type="button" class="btn btn-full btn-danger-fill" data-shopt="leave-yes">Salir del hogar</button>
                <button type="button" class="btn-ter" data-shopt="leave-no">No, quedarme</button>
              </div>`;
            return;
          }
          if (k === 'leave-no') { closeSheet(dlg); return; }
          if (k === 'leave-yes') {
            b.disabled = true;
            Cloud.leaveHousehold(shared.household.id)
              .then(() => { shared.loaded = false; return closeSheet(dlg); })
              .then(() => loadShared())
              .catch((err) => { b.disabled = false; alert('No se pudo salir: ' + friendlyCloudError(err)); });
          }
        },
      });
    }
    async function makeInvite() {
      try {
        const code = await Cloud.createInvite(shared.household.id);
        const box = $('#invite-box', el);
        if (box) box.innerHTML = `<div class="invite-code">
          <div class="t2">Compartile este código a tu pareja (vale 7 días). Lo carga en <b>Compartido → Ya tengo un código</b>:</div>
          <div class="num invite-code-v">${esc(code)}</div>
        </div>`;
      } catch (e) { alert('No se pudo generar el código: ' + friendlyCloudError(e)); }
    }

    // Todos los movimientos compartidos en un panel.
    const allFeed = $('[data-allfeed]', el);
    if (allFeed) allFeed.addEventListener('click', () => {
      const dlg = openDialog('Movimientos compartidos', `<div class="group">${feed.map(feedRow).join('')}</div>`, { viewOnly: true });
      $$('[data-shared-item]', dlg).forEach((row) => row.addEventListener('click', () => {
        closeSheet(dlg).then(() => openSharedItem(row.dataset.sharedItem));
      }));
    });
    $$('[data-shared-item]', el).forEach((row) => row.addEventListener('click', () => openSharedItem(row.dataset.sharedItem)));

    // Detalle de un gasto o pago compartido: borrar va detrás del ⋯.
    function openSharedItem(key) {
      const [kind, id] = key.split(':');
      const item = kind === 'expense' ? shared.expenses.find((x) => x.id === id) : shared.settlements.find((x) => x.id === id);
      if (!item) return;
      const r = (label, value) => `<div class="tx-detail-row"><span class="tx-row-label">${label}</span><span class="tx-row-value">${value}</span></div>`;
      let body;
      if (kind === 'expense') {
        const paidByMe = item.paid_by === me.id;
        const payerPct = Math.round(Number(item.payer_share) * 100);
        body = `<div class="tx-detail-amount"><div class="v">${fmtMoney(item.amount, item.currency)}</div></div>
          ${r('Fecha', esc(fmtDateFull(item.date)))}
          ${r('Pagó', esc(paidByMe ? myName : partnerName))}
          ${r(`Parte de ${esc(myName)}`, `${fmtMoney(myPart(item), item.currency)} (${paidByMe ? payerPct : 100 - payerPct}%)`)}
          ${r(`Parte de ${esc(partnerName)}`, `${fmtMoney(Number(item.amount) - myPart(item), item.currency)} (${paidByMe ? 100 - payerPct : payerPct}%)`)}`;
      } else {
        const fromMe = item.from_user === me.id;
        body = `<div class="tx-detail-amount"><div class="v pos">${fmtMoney(item.amount, item.currency)}</div></div>
          ${r('Fecha', esc(fmtDateFull(item.date)))}
          ${r('De', esc(fromMe ? myName : partnerName))}
          ${r('Para', esc(fromMe ? partnerName : myName))}
          ${item.note ? r('Nota', esc(item.note)) : ''}`;
      }
      const myTx = kind === 'expense' ? (S().transactions.find((t) => t.sharedExpenseId === id)
        || (item.paid_by === me.id ? S().transactions.find((t) => t.shared && !t.sharedExpenseId && t.date === item.date
          && t.currency === item.currency && Math.abs(Number(t.amount) - Number(item.amount)) < 0.01) : null)) : null;
      // Borrar pide confirmación adentro del mismo panel: es un dato que
      // también ve tu pareja, así que no hay "Deshacer".
      openPanel({
        title: kind === 'expense' ? (item.note || 'Gasto compartido') : 'Pago',
        body: `<div class="tx-detail">${body}
          <button type="button" class="btn-ter btn-ter-danger" data-shdel>${kind === 'expense' ? 'Borrar gasto' : 'Borrar pago'}</button></div>`,
        onClick(e, dlg) {
          if (e.target.closest('[data-shdel]')) {
            $('[data-shbody]', dlg).innerHTML = `
              <div class="confirm-box">
                <p><b>${kind === 'expense' ? '¿Borrar este gasto compartido?' : '¿Borrar este pago?'}</b></p>
                <p class="t2">${myTx ? 'También se va a borrar de tus movimientos. ' : ''}Tu pareja tampoco lo va a ver más.</p>
                <button type="button" class="btn btn-full btn-danger-fill" data-shdel-yes>Borrar</button>
                <button type="button" class="btn-ter" data-shdel-no>No, dejarlo</button>
              </div>`;
            return;
          }
          if (e.target.closest('[data-shdel-no]')) { closeSheet(dlg); return; }
          const yes = e.target.closest('[data-shdel-yes]');
          if (!yes) return;
          yes.disabled = true;
          (async () => {
            try {
              if (kind === 'expense') {
                await Cloud.deleteSharedExpense(id);
                shared.expenses = await Cloud.listSharedExpenses(shared.household.id);
                if (myTx) {
                  const drop = myTx.groupId ? S().transactions.filter((t) => t.groupId === myTx.groupId) : [myTx];
                  for (const t of drop) removeLinkedSavingEntry(t.id);
                  const ids = new Set(drop.map((t) => t.id));
                  S().transactions = S().transactions.filter((t) => !ids.has(t.id));
                  Store.save();
                }
              } else {
                await Cloud.deleteSettlement(id);
                shared.settlements = await Cloud.listSettlements(shared.household.id);
              }
              await closeSheet(dlg);
              render();
              showToast(kind === 'expense' ? 'Se borró el gasto compartido' : 'Se borró el pago');
            } catch (err) { yes.disabled = false; alert('No se pudo eliminar: ' + friendlyCloudError(err)); }
          })();
        },
      });
    }

    const addSe = $('[data-addse]', el);
    if (addSe) addSe.addEventListener('click', sharedExpenseForm);
    const settle = $('[data-settle]', el);
    if (settle) settle.addEventListener('click', () => settlementForm({ amount: balAbs, meToPartner: meIsDebtor }));
    const invite = $('[data-invite]', el);
    if (invite) invite.addEventListener('click', makeInvite);
  }


  /* ================= Vista: Más (lista) ================= */
  function vMas(el) {
    const today = todayStr();
    const instGroups = new Set(S().transactions.filter((t) => t.groupId && t.installment && t.date > today).map((t) => t.groupId));
    const nB = S().budgets.length, nR = S().recurring.length;
    let sharedSub = 'Gastos en común con tu pareja';
    if (shared.household && sharedPartner()) {
      const bal = sharedBalance();
      const who = partnerLabel(sharedPartner());
      sharedSub = Math.abs(bal) < 0.01 ? 'Están a mano' : (bal > 0 ? `${who} te debe ${fmtPlain(Math.abs(bal))}` : `Le debés a ${who} ${fmtPlain(Math.abs(bal))}`);
    }
    const row = (view, icon, color, title, sub) => `
      <button type="button" class="row mas-row" data-goview="${view}">
        <span class="cic" style="--c:${color}">${icon}</span>
        <div class="row-main"><div class="tt">${esc(title)}</div><div class="st${view === 'compartido' ? ' money' : ''}">${esc(sub)}</div></div>
        ${spriteIcon('cr').replace('class="ic"', 'class="ic chev"')}
      </button>`;
    el.innerHTML = `
      <div class="group">
        ${row('cuotas', spriteIcon('repeat'), 'var(--c-auto)', 'Cuotas', instGroups.size ? `${instGroups.size} compra${instGroups.size === 1 ? '' : 's'} con cuotas pendientes` : 'Sin cuotas pendientes')}
        ${row('presupuestos', spriteIcon('target'), 'var(--c-comida)', 'Presupuestos', nB ? `${nB} presupuesto${nB === 1 ? '' : 's'}` : 'Ponele un tope a cada categoría')}
        ${row('fijos', spriteIcon('cal'), 'var(--c-casa)', 'Fijos', nR ? `${nR} movimiento${nR === 1 ? '' : 's'} fijo${nR === 1 ? '' : 's'}` : 'Alquiler, suscripciones, sueldo')}
        ${row('compartido', spriteIcon('users'), 'var(--c-tel)', 'Compartido', sharedSub)}
      </div>
      <div class="group">
        ${row('ajustes', spriteIcon('bolt'), 'var(--t2)', 'Ajustes', 'Tema, cotización y datos')}
      </div>
      <footer class="brand-mark" aria-hidden="true">
        <img src="assets/logo.png" alt="" width="44" height="44">
        <span class="brand-name">FinPep</span>
        <span class="brand-sub">Tus finanzas, claras</span>
      </footer>`;
    $$('[data-goview]', el).forEach((b) => b.addEventListener('click', () => {
      ui.view = b.dataset.goview;
      if (ui.view === 'compartido') loadShared();
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
    cuotas: (el) => vPlan(el, 'cuotas'),
    presupuestos: (el) => vPlan(el, 'presupuestos'),
    fijos: (el) => vPlan(el, 'fijos'),
    ajustes: vAjustes,
    mas: vMas,
  };

  // Navegación de 4 botones abajo (máximo); cada uno puede contener más de
  // una vista, que se elige con una sub-pestaña dentro de la sección.
  const GROUPS = [
    { key: 'inicio', views: ['resumen'] },
    { key: 'movimientos', views: ['movimientos', 'categorias', 'calendario'] },
    { key: 'cuentas', views: ['tarjetas', 'ahorros'] },
    // Más es una lista (vMas) y cada opción se abre como su propia hoja,
    // con "‹ Más" para volver (sin pestañas).
    { key: 'mas', views: ['mas', 'cuotas', 'presupuestos', 'fijos', 'compartido', 'ajustes'], list: true },
  ];
  const VIEW_LABELS = {
    resumen: 'Resumen', movimientos: 'Lista', calendario: 'Calendario',
    categorias: 'Categorías', tarjetas: 'Tarjetas y medios', ahorros: 'Ahorros',
    cuotas: 'Cuotas', presupuestos: 'Presupuestos', fijos: 'Fijos', compartido: 'Compartido', ajustes: 'Ajustes', mas: 'Más',
  };
  // Puede no encontrar nada para una vista que se agregue suelta.
  function groupOf(view) { return GROUPS.find((g) => g.views.includes(view)) || null; }

  // Al cambiar de hoja (no en cualquier re-render — eso incluiría cosas
  // como cambiar de mes o cerrar un diálogo, que no deberían tirarte para
  // arriba) se vuelve al principio: si quedaste scrolleado abajo del todo
  // en una hoja, la siguiente no debería abrir en ese mismo nivel.
  let lastRenderedView = null;
  const lastSubIdx = {};

  /* El saldo de Inicio anima su cambio (de lo que mostraba antes a lo
     nuevo) cuando cambia sin cambiar de mes ni de moneda, por ejemplo al
     guardar un movimiento. */
  let lastHeroBalance = null;
  function animateHeroBalance(el) {
    const box = $('.hero-value[data-balance]', el);
    if (!box) return;
    const to = Number(box.dataset.balance);
    const key = box.dataset.balanceKey;
    const prev = lastHeroBalance;
    lastHeroBalance = { key, value: to };
    const out = $('.hero-amount-int', box);
    if (!prev || prev.key !== key || prev.value === to || !out || hideAmounts || prefersReducedMotion()) return;
    const from = prev.value;
    const t0 = performance.now(), dur = 600;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const v = from + (to - from) * (1 - Math.pow(1 - k, 3));
      if (!out.isConnected) return;
      out.textContent = nfHero.format(Math.abs(k === 1 ? to : v));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------- Mes elegido (barra superior) ----------
     Inicio y Movimientos (con Categorías y Calendario) dependen del mes:
     la barra superior muestra el mes con flechas ‹ › y, en esas hojas, se
     cambia también deslizando el contenido hacia los costados. El resto de
     las secciones muestra su nombre en ese lugar. */
  const MONTH_GROUPS = ['inicio', 'movimientos'];
  const GROUP_TITLES = { inicio: 'Inicio', movimientos: 'Movimientos', cuentas: 'Cuentas', mas: 'Más' };
  const usesMonth = (grp) => !!grp && MONTH_GROUPS.includes(grp.key);
  const topbarMonthLabel = (mk) => {
    const [y, m] = mk.split('-').map(Number);
    const name = new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(new Date(y, m - 1, 1));
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
  };
  // Título grande que se achica al scrollear: cuando sale de la pantalla
  // (queda debajo de la barra superior), su nombre aparece chico arriba.
  let largeTitleObserver = null;
  function watchLargeTitle(el) {
    if (largeTitleObserver) largeTitleObserver.disconnect();
    document.body.classList.remove('title-collapsed');
    const t = $('.largetitle', el);
    if (!t || !('IntersectionObserver' in window)) return;
    const topbar = $('.topbar');
    const h = topbar ? topbar.getBoundingClientRect().height : 60;
    largeTitleObserver = new IntersectionObserver(([entry]) => {
      document.body.classList.toggle('title-collapsed', !entry.isIntersecting && entry.boundingClientRect.top < h);
    }, { rootMargin: `-${Math.round(h)}px 0px 0px 0px`, threshold: 0 });
    largeTitleObserver.observe(t);
  }

  function renderTopbar(grp) {
    const left = $('#topbar-left');
    if (!left) return;
    if (!usesMonth(grp)) {
      // El nombre de la hoja aparece arriba recién cuando el título grande
      // sale de la pantalla al scrollear (ver watchLargeTitle()).
      const inner = grp && grp.list && ui.view !== grp.views[0];
      const title = inner ? VIEW_LABELS[ui.view] : ((grp && GROUP_TITLES[grp.key]) || VIEW_LABELS[ui.view] || '');
      // Adentro de una opción de Más: "‹ Volver" arriba a la izquierda.
      left.innerHTML = `${inner ? `<button type="button" class="back-btn" data-topback>${spriteIcon('cl')}Volver</button>` : ''}<span class="topbar-title section-title" aria-hidden="true">${esc(title)}</span>`;
      return;
    }
    // Fuera del mes actual, el nombre del mes queda en verde y al tocarlo
    // vuelve al mes actual (no entra un botón "Hoy" al lado sin cortar
    // "Septiembre 2026" en un celular).
    const isCur = ui.month === curMonth();
    const label = topbarMonthLabel(ui.month);
    const longCls = label.length > 13 ? ' is-long' : '';
    left.innerHTML = `
      <button type="button" class="icb ghost" data-mnav="-1" aria-label="Mes anterior">${spriteIcon('cl')}</button>
      ${isCur
        ? `<h1 class="topbar-title topbar-month${longCls}">${esc(label)}</h1>`
        : `<h1 class="topbar-title topbar-month${longCls}"><button type="button" class="topbar-month-btn" data-mtoday aria-label="${esc(label)}. Volver a ${esc(topbarMonthLabel(curMonth()))}">${esc(label)}</button></h1>`}
      <button type="button" class="icb ghost" data-mnav="1" aria-label="Mes siguiente">${spriteIcon('cr')}</button>`;
  }
  // Cambia de mes (delta = ±1, o 0 para volver al actual). Si el navegador
  // tiene View Transitions, el contenido se desliza hacia el lado que
  // corresponde; si no (o con "reducir movimiento"), cambia sin animación.
  function changeMonth(delta) {
    const target = delta ? addMonthsKey(ui.month, delta) : curMonth();
    if (target === ui.month) return;
    const dir = target > ui.month ? 'next' : 'prev';
    const go = () => { ui.month = target; ui.fAllMonths = false; ui.fMonths = null; render(); };
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduce) { go(); return; }
    const root = document.documentElement;
    root.dataset.slide = dir;
    const t = document.startViewTransition(go);
    t.finished.finally(() => { delete root.dataset.slide; });
  }
  // Deslizar el contenido hacia los costados cambia de mes. Se ignora si el
  // gesto empieza adentro de algo que se scrollea de costado (tablas,
  // gráficos anchos, chips) o de un campo de texto, y si es más vertical
  // que horizontal (eso es scrollear la página).
  function initMonthSwipe() {
    const view = $('#view');
    let start = null;
    const scrollsSideways = (node) => {
      for (let n = node; n && n !== view; n = n.parentElement) {
        if (n.matches('input, select, textarea, [data-noswipe]')) return true;
        if (n.scrollWidth > n.clientWidth + 1) {
          const ox = getComputedStyle(n).overflowX;
          if (ox === 'auto' || ox === 'scroll') return true;
        }
      }
      return false;
    };
    view.addEventListener('touchstart', (e) => {
      start = null;
      if (e.touches.length !== 1 || !usesMonth(groupOf(ui.view)) || scrollsSideways(e.target)) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, at: Date.now() };
    }, { passive: true });
    view.addEventListener('touchend', (e) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x, dy = t.clientY - start.y;
      const quick = Date.now() - start.at < 600;
      start = null;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || !quick) return;
      changeMonth(dx < 0 ? 1 : -1);
    }, { passive: true });
    view.addEventListener('touchcancel', () => { start = null; }, { passive: true });
  }
  function render() {
    const changingView = ui.view !== lastRenderedView;
    // Re-render en la misma hoja (ej. cambiar de moneda): mientras se arma
    // de nuevo, la página queda un instante casi vacía y algunas mediciones
    // (la píldora de las sub-pestañas) fuerzan al navegador a recortar el
    // scroll a esa altura — volvía arriba de todo. Se guarda y se repone.
    const prevScrollY = window.scrollY;
    lastRenderedView = ui.view;
    const grp = groupOf(ui.view);
    document.body.dataset.grp = grp ? grp.key : '';
    $$('.tabbar [data-group]').forEach((b) => {
      const on = !!grp && b.dataset.group === grp.key;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    renderTopbar(grp);
    $$('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.cur === disp()));
    const eye = $('#btn-privacy');
    if (eye) {
      eye.innerHTML = spriteIcon(hideAmounts ? 'eyeoff' : 'eye');
      eye.classList.toggle('active', hideAmounts);
      eye.setAttribute('aria-pressed', String(hideAmounts));
      eye.setAttribute('aria-label', hideAmounts ? 'Mostrar montos' : 'Ocultar montos');
      eye.title = hideAmounts ? 'Mostrar montos' : 'Ocultar montos';
    }
    document.body.classList.toggle('hide-amounts', hideAmounts);
    const thumb = $('.seg-thumb');
    if (thumb) thumb.classList.toggle('pos-usd', disp() === 'USD');
    renderRateChip();
    renderAccountChip();
    renderBanner();
    const el = $('#view');
    // Sub-pestañas con el mismo look que el selector de moneda: una píldora
    // que se desliza atrás de la activa. Se dibuja primero en la posición
    // de la pestaña anterior del mismo grupo y en el próximo frame se mueve
    // a la nueva, así el cambio se ve animado aunque se re-arme todo el HTML.
    let subtabsHTML = '';
    let subIdx = -1, fromIdx = -1;
    if (grp && grp.views.length > 1 && !grp.list) {
      subIdx = grp.views.indexOf(ui.view);
      fromIdx = lastSubIdx[grp.key] != null ? lastSubIdx[grp.key] : subIdx;
      lastSubIdx[grp.key] = subIdx;
      subtabsHTML = `<div class="subtabs${grp.views.length > 3 ? ' subtabs-dense' : ''}">
        <span class="subtabs-thumb" aria-hidden="true"></span>
        ${grp.views.map((v) => `<button type="button" data-subview="${v}" class="${v === ui.view ? 'active' : ''}">${esc(VIEW_LABELS[v])}</button>`).join('')}
      </div>`;
    }
    // Movimientos (Lista, Categorías, Calendario): título grande y chip del
    // mes arriba del segmentado. El chip abre el selector de mes (con
    // "Todos los meses" para la lista).
    let titleBarHTML = '';
    if (grp && grp.key === 'movimientos') {
      titleBarHTML = `
      <div class="bar">
        <h1 class="largetitle">Movimientos</h1>
        <button type="button" class="chip" data-monthchip>${esc(ui.view === 'movimientos' && ui.fAllMonths ? 'Todos los meses' : ui.view === 'movimientos' && ui.fMonths && ui.fMonths.length > 1 ? `${ui.fMonths.length} meses` : monthShortLabel(ui.month) + ' ' + ui.month.slice(0, 4))}${spriteIcon('cd')}</button>
      </div>`;
    } else if (grp && grp.key === 'cuentas') {
      titleBarHTML = '<h1 class="largetitle">Cuentas</h1>';
    } else if (grp && grp.key === 'mas' && ui.view !== 'mas') {
      // Cada opción de Más: "‹ Más" para volver y, a la derecha, el lugar
      // para un menú propio de la hoja (ver vCompartido).
      titleBarHTML = `
      <div class="bar title-row">
        <h1 class="largetitle">${esc(VIEW_LABELS[ui.view] || '')}</h1>
        <span class="bar-right" id="bar-right"></span>
      </div>`;
    } else if (grp && grp.key === 'mas') {
      titleBarHTML = '<h1 class="largetitle">Más</h1>';
    }
    el.innerHTML = titleBarHTML + subtabsHTML + '<div class="view-content"></div>';
    const monthChip = $('[data-monthchip]', el);
    if (monthChip) monthChip.addEventListener('click', monthPickerSheet);
    watchLargeTitle(el);
    if (subIdx >= 0) {
      // Las pestañas miden según su texto (no todas iguales), así que la
      // píldora toma la posición y el ancho reales del botón.
      const thumbEl = $('.subtabs-thumb', el);
      const btns = $$('.subtabs button', el);
      const placeOn = (b) => {
        thumbEl.style.width = `${b.offsetWidth}px`;
        thumbEl.style.transform = `translateX(${b.offsetLeft - 2}px)`;
      };
      thumbEl.style.transition = 'none';
      placeOn(btns[fromIdx] || btns[subIdx]);
      if (fromIdx !== subIdx) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          thumbEl.style.transition = '';
          placeOn(btns[subIdx]);
        }));
      } else {
        requestAnimationFrame(() => { thumbEl.style.transition = ''; });
      }
    }
    $$('[data-subview]', el).forEach((b) => b.addEventListener('click', () => {
      b.blur();
      ui.view = b.dataset.subview;
      // Se refresca en segundo plano sin borrar lo ya cargado (ver
      // comentario en init()): así no aparece "Cargando…" cada vez.
      if (ui.view === 'compartido') loadShared();
      render();
    }));
    VIEWS[ui.view]($('.view-content', el));
    // El resaltado de lo recién guardado se ve una sola vez (en la primera
    // lista que lo muestre, dentro de los 15 segundos de guardarlo).
    if (ui.newTxIds && ($('.is-new', el) || Date.now() - ui.newTxIds.at > 15000)) ui.newTxIds = null;
    animateHeroBalance(el);
    if (changingView) window.scrollTo(0, 0);
    else if (window.scrollY !== prevScrollY) window.scrollTo(0, prevScrollY);
  }

  // Ordena las tarjetas de crédito primero en "Tarjetas y medios" — pero
  // solo la primera vez que se abre la app después de este cambio: si el
  // usuario después reordena a mano (moveMethod), no queremos volver a
  // pisar ese orden en cada carga.
  function sortMethodsOnce() {
    if (S().settings.methodsSortedOnce) return;
    S().methods.sort((a, b) => (b.kind === 'credito' ? 1 : 0) - (a.kind === 'credito' ? 1 : 0));
    S().settings.methodsSortedOnce = true;
    Store.save();
  }

  /* Reordena manualmente un medio de pago en "Tarjetas y medios". */
  function moveMethod(id, dir) {
    const arr = S().methods;
    const idx = arr.findIndex((m) => m.id === id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= arr.length) return;
    [arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]];
    Store.save();
    render();
  }

  function init() {
    // Con la nube configurada, generar acá (antes de sincronizar) puede
    // duplicar un recurrente/sobrante si este dispositivo está desactualizado
    // — ver el comentario en onAuthChanged(), que se encarga de generarlos
    // ahí en ese caso, ya con los datos sincronizados. Sin nube no hay con
    // quién pisarse, así que no hace falta esperar nada.
    if (!Cloud.available() || !Cloud.isConfigured()) {
      generateRecurring();
      generateLeftoverIncome();
      realignCardInstallments();
    }
    sortMethodsOnce();

    $$('.tabbar [data-group]').forEach((b) => b.addEventListener('click', () => {
      // El botón queda enfocado al tocarlo, y en algunos navegadores
      // mobile eso dispara un scroll automático para "mostrar" el elemento
      // enfocado — aunque sea uno fijo (position: fixed) que ya está
      // siempre a la vista. Sacarle el foco apenas se toca evita ese salto.
      b.blur();
      const grp = GROUPS.find((g) => g.key === b.dataset.group);
      // Tocar Más estando adentro de una de sus opciones vuelve a la lista.
      if (grp.list && grp.views.includes(ui.view)) ui.view = grp.views[0];
      else if (!grp.views.includes(ui.view)) ui.view = grp.views[0];
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
    // Service worker solo para recibir notificaciones push (no cachea nada:
    // la app siempre se carga fresca de la red).
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
    }
    Charts.setMasked(hideAmounts);
    $('#btn-privacy').addEventListener('click', () => {
      hideAmounts = !hideAmounts;
      try { localStorage.setItem(HIDE_KEY, hideAmounts ? '1' : '0'); } catch (e) { /* sin storage */ }
      Charts.setMasked(hideAmounts);
      render();
    });
    $('#btn-fab').addEventListener('click', (e) => { e.currentTarget.blur(); txForm(null); });
    $('#topbar-left').addEventListener('click', (e) => {
      const nav = e.target.closest('[data-mnav]');
      if (e.target.closest('[data-topback]')) { ui.view = 'mas'; render(); return; }
      if (nav) changeMonth(Number(nav.dataset.mnav));
      else if (e.target.closest('[data-mtoday]')) changeMonth(0);
    });
    initMonthSwipe();
    // La píldora de las sub-pestañas está en px (ver render()): si cambia el
    // ancho de pantalla (ej. girar el celular) se reacomoda sobre la activa.
    window.addEventListener('resize', () => {
      const t = $('.subtabs-thumb');
      const a = $('.subtabs button.active');
      if (!t || !a) return;
      t.style.transition = 'none';
      t.style.width = `${a.offsetWidth}px`;
      t.style.transform = `translateX(${a.offsetLeft - 2}px)`;
    });
    // Restaura el scroll de la página al cerrar el diálogo, sin importar
    // cómo se cerró (botón, Escape, o dlg.close() desde código): ver openModal().
    $('#dialog').addEventListener('close', (e) => { if (!e.target.open) document.body.style.overflow = ''; });

    // Cada guardado local se sube a la nube (si hay sesión activa).
    Store.onSave((state) => Cloud.schedulePush(state));

    // Un link con ?nuevo=… se lee (y se borra de la dirección) antes que
    // nada; el formulario se abre cuando terminó la sincronización (para
    // buscar la categoría y el medio en tus datos reales) o a los 5 s.
    const linkPf = readLinkPrefill();
    render();
    const cloudReady = initCloud();
    if (linkPf) {
      const openLink = () => {
        const dlg = $('#dialog');
        // Si está abierto el panel de iniciar sesión, espera a que se cierre.
        if (dlg.open) { dlg.addEventListener('close', () => setTimeout(openLink, 400), { once: true }); return; }
        txForm(null, linkPrefillToDraft(linkPf));
      };
      Promise.race([Promise.resolve(cloudReady).catch(() => {}), new Promise((r) => setTimeout(r, 5000))]).then(openLink);
    }
    maybeRefreshRates();
    // Volver a la app después de tenerla en segundo plano (cambiar de
    // pestaña/app y volver) no siempre la recarga del todo, así que sin
    // esto la cotización podía quedar vieja por días aunque el chequeo de
    // arriba diga que "hace 6 horas que no se actualiza" — porque ese
    // chequeo solo corrió una vez, al abrir la app la última vez de cero.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') maybeRefreshRates();
      else flushPendingDelete(); // un borrado con "Deshacer" pendiente se hace ya
    });
    window.addEventListener('pagehide', flushPendingDelete);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
