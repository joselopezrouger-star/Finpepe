'use strict';

/* Finpepe — lógica de la aplicación. */
(() => {
  const S = () => Store.state;

  /* ================= Helpers ================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  const fmtDay = (d) => dayMonthFmt.format(d);
  const fmtDateShort = (str) => dateShortFmt.format(parseDate(str));
  const fmtDateFull = (str) => {
    const s = dateFullFmt.format(parseDate(str));
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  const nfARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  const nfUSD = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtMoney = (n, cur) => (cur === 'USD' ? nfUSD : nfARS).format(n);
  const nfHero = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

  // Número protagonista (ej. Patrimonio neto): parte entera grande + centavos
  // chicos en superíndice, como el saldo de una billetera/homebanking.
  function heroMoneyHTML(n, cur) {
    if (n == null || !isFinite(n)) return '—';
    const symbol = cur === 'USD' ? 'US$' : '$';
    const sign = n < 0 ? '−' : '';
    const [intPart, decPart] = nfHero.format(Math.abs(n)).split(',');
    return `<span class="hero-amount">
      <span class="hero-amount-sym">${symbol}</span>${sign}<span class="hero-amount-int">${esc(intPart)}</span><sup class="hero-amount-dec">${esc(decPart)}</sup>
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
    efectivo: 'Efectivo', debito: 'Débito', credito: 'Crédito', billetera: 'Billetera virtual',
  };

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
  };

  /* ================= Ciclo de tarjetas de crédito ================= */
  function cardCycle(card) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    let close = clampDate(now.getFullYear(), now.getMonth(), card.closingDay);
    if (close < now) close = clampDate(now.getFullYear(), now.getMonth() + 1, card.closingDay);
    const prevClose = clampDate(close.getFullYear(), close.getMonth() - 1, card.closingDay);
    const prevPrevClose = clampDate(prevClose.getFullYear(), prevClose.getMonth() - 1, card.closingDay);
    const dueAfter = (c) => {
      let d = clampDate(c.getFullYear(), c.getMonth(), card.dueDay);
      if (d <= c) d = clampDate(c.getFullYear(), c.getMonth() + 1, card.dueDay);
      return d;
    };
    return { close, prevClose, prevPrevClose, due: dueAfter(close), prevDue: dueAfter(prevClose) };
  }

  /* Total de gastos de una tarjeta en el período (from, to], en moneda visible. */
  function cardPeriodTotal(cardId, from, to) {
    const a = dateToStr(from), b = dateToStr(to);
    return sumDisp(S().transactions.filter(
      (t) => t.type === 'gasto' && t.methodId === cardId && t.date > a && t.date <= b
    ));
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
      Store.save();
    } catch (e) {
      console.warn('No se pudo actualizar la cotización', e);
    }
    fetchingRates = false;
    render();
  }

  function renderRateChip() {
    const chip = $('#rate-chip');
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
  function updateThemeButton() {
    const btn = $('#theme-toggle');
    const dark = currentTheme() === 'dark';
    btn.textContent = dark ? '☀' : '◐';
    btn.title = dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  }
  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    localStorage.setItem(THEME_KEY, next);
    updateThemeButton();
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
    dlg.showModal();
    return dlg;
  }

  const selOptions = (items, sel) => items
    .map((i) => `<option value="${esc(i.id)}" ${i.id === sel ? 'selected' : ''}>${esc(i.name)}</option>`)
    .join('');

  /* ================= Formulario de movimiento ================= */

  /* Carga de movimientos: una sola pantalla con calculadora para el importe
     y listas que se despliegan ahí mismo para categoría/cuenta (sin navegar
     a otra hoja: se abren y cierran en el lugar). */
  function txForm(tx) {
    const editing = !!tx;
    const partner = sharedPartner();
    const canShare = !editing && !!partner && !!(shared.household);

    const draft = {
      type: editing ? tx.type : 'gasto',
      date: editing ? tx.date : todayStr(),
      currency: editing ? tx.currency : 'ARS',
      categoryId: editing ? tx.categoryId : '',
      methodId: editing ? tx.methodId : (S().methods[0] ? S().methods[0].id : ''),
      shareIt: false,
      sharePct: 50,
      acc: editing ? tx.amount : null,
      op: null,
      cur: '',
      expand: null, // null | 'category' | 'method' — qué lista está desplegada
    };

    const dlg = $('#dialog');
    dlg.className = 'dialog dialog-tx';

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
      if (d === '.' && draft.cur.includes('.')) return;
      if (draft.cur.length > 12) return;
      draft.cur = (draft.cur === '0' && d !== '.') ? d : draft.cur + d;
      paint();
    }
    function pressOp(op) {
      const curVal = draft.cur === '' ? null : parseFloat(draft.cur);
      if (draft.op && curVal != null) draft.acc = applyOp(draft.acc, draft.op, curVal);
      else if (curVal != null) draft.acc = curVal;
      draft.op = op;
      draft.cur = '';
      paint();
    }
    function pressEquals() {
      const curVal = draft.cur === '' ? null : parseFloat(draft.cur);
      if (draft.op && curVal != null) draft.acc = applyOp(draft.acc, draft.op, curVal);
      else if (curVal != null) draft.acc = curVal;
      draft.op = null;
      draft.cur = draft.acc != null ? numFmt(draft.acc) : '';
      paint();
    }
    function pressBack() {
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

    function pickRowHTML(item, selId, indent) {
      return `<div class="tx-pick-row ${indent ? 'indent' : ''} ${item.id === selId ? 'sel' : ''}" data-pickid="${esc(item.id)}">
        <span>${esc(item.name)}</span>${item.id === selId ? '<span class="tx-pick-check">✓</span>' : ''}
      </div>`;
    }
    function categoryOptionsHTML() {
      if (!useSubcats()) {
        const items = S().categories.filter((c) => c.type === draft.type);
        return items.length ? items.map((i) => pickRowHTML(i, draft.categoryId)).join('')
          : '<div class="empty">No hay categorías. Agregá una desde Ajustes.</div>';
      }
      const groups = catGroups(draft.type);
      if (!groups.length) return '<div class="empty">No hay categorías. Agregá una desde Ajustes.</div>';
      return groups.map((g) => {
        const children = catChildren(g.id);
        if (!children.length) return pickRowHTML(g, draft.categoryId);
        return `<div class="tx-pick-group">${esc(g.name)}</div>` +
          children.map((c) => pickRowHTML(c, draft.categoryId, true)).join('');
      }).join('');
    }
    function methodOptionsHTML() {
      const items = S().methods;
      return items.length ? items.map((i) => pickRowHTML(i, draft.methodId)).join('')
        : '<div class="empty">No hay medios. Agregá uno desde Tarjetas y medios.</div>';
    }

    function formHTML() {
      return `
      <div class="dialog-head tx-head">
        <button type="button" class="row-del" data-close aria-label="Cerrar">✕</button>
        <span class="tx-head-title">${draft.type === 'gasto' ? 'Gasto' : 'Ingreso'}</span>
        <span></span>
      </div>
      <div class="tx-tabs">
        <button type="button" class="tx-tab ${draft.type === 'ingreso' ? 'active tx-tab-income' : ''}" data-ttype="ingreso">Ingreso</button>
        <button type="button" class="tx-tab ${draft.type === 'gasto' ? 'active tx-tab-expense' : ''}" data-ttype="gasto">Gasto</button>
      </div>
      <div class="tx-body">
        <div class="tx-row" data-openrow="date">
          <span class="tx-row-label">Fecha</span>
          <span class="tx-row-value">${esc(fmtDateFull(draft.date))}</span>
        </div>
        <input type="date" id="tx-date-input" class="tx-visually-hidden" value="${esc(draft.date)}">

        <div class="tx-amount-block">
          <div class="tx-cur-toggle">
            <button type="button" class="cur-pill ${draft.currency === 'ARS' ? 'active' : ''}" data-cur="ARS">$</button>
            <button type="button" class="cur-pill ${draft.currency === 'USD' ? 'active' : ''}" data-cur="USD">US$</button>
          </div>
          <div class="tx-amount-display ${draft.type === 'ingreso' ? 'is-income' : 'is-expense'}">
            <span>${esc(displayExpr())}</span>
            <button type="button" class="tx-amount-back" data-back aria-label="Borrar">⌫</button>
          </div>
        </div>

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
        ${draft.expand === 'method' ? `<div class="tx-pick-inline" data-kind="method">${methodOptionsHTML()}</div>` : ''}

        ${showInstallments() ? `
        <div class="tx-row-note">
          <label>Cuotas</label>
          <input type="number" id="tx-inst" min="1" max="36" step="1" value="1">
        </div>` : ''}

        ${canShare ? `
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
          <input type="text" id="tx-note" maxlength="80" value="${editing ? esc(tx.note || '') : ''}">
        </div>
      </div>
      <div class="tx-keypad">
        <button type="button" data-k="7">7</button><button type="button" data-k="8">8</button><button type="button" data-k="9">9</button><button type="button" data-op="÷">÷</button>
        <button type="button" data-k="4">4</button><button type="button" data-k="5">5</button><button type="button" data-k="6">6</button><button type="button" data-op="×">×</button>
        <button type="button" data-k="1">1</button><button type="button" data-k="2">2</button><button type="button" data-k="3">3</button><button type="button" data-op="-">−</button>
        <button type="button" data-k=".">.</button><button type="button" data-k="0">0</button><button type="button" data-eq>=</button><button type="button" data-op="+">+</button>
      </div>
      <div class="dialog-foot">
        ${editing ? '<button type="button" class="btn btn-danger" data-del style="margin-right:auto">Eliminar</button>' : ''}
        <button type="button" class="btn btn-primary" data-save>Guardar</button>
      </div>`;
    }

    function paint() {
      dlg.innerHTML = formHTML();
      wire();
    }

    function wire() {
      $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
      $$('.tx-tab', dlg).forEach((b) => b.addEventListener('click', () => {
        draft.type = b.dataset.ttype;
        if (draft.categoryId && !selectableCats(draft.type).some((c) => c.id === draft.categoryId)) draft.categoryId = '';
        draft.expand = null;
        paint();
      }));
      $('[data-openrow="date"]', dlg).addEventListener('click', () => {
        const input = $('#tx-date-input', dlg);
        if (input.showPicker) { try { input.showPicker(); return; } catch (e) {} }
        input.focus();
      });
      $('#tx-date-input', dlg).addEventListener('change', (e) => { draft.date = e.target.value; paint(); });
      $$('.cur-pill', dlg).forEach((b) => b.addEventListener('click', () => { draft.currency = b.dataset.cur; paint(); }));
      $$('[data-toggle]', dlg).forEach((row) => row.addEventListener('click', () => {
        const k = row.dataset.toggle;
        draft.expand = draft.expand === k ? null : k;
        paint();
      }));
      $$('.tx-pick-inline [data-pickid]', dlg).forEach((row) => row.addEventListener('click', () => {
        const kind = row.closest('.tx-pick-inline').dataset.kind;
        if (kind === 'category') draft.categoryId = row.dataset.pickid;
        else draft.methodId = row.dataset.pickid;
        draft.expand = null;
        paint();
      }));
      const shareBox = $('#tx-share', dlg);
      if (shareBox) shareBox.addEventListener('change', (e) => { draft.shareIt = e.target.checked; paint(); });
      $$('.tx-keypad [data-k]', dlg).forEach((b) => b.addEventListener('click', () => pressDigit(b.dataset.k)));
      $$('.tx-keypad [data-op]', dlg).forEach((b) => b.addEventListener('click', () => pressOp(b.dataset.op)));
      $('[data-eq]', dlg).addEventListener('click', pressEquals);
      $('[data-back]', dlg).addEventListener('click', pressBack);
      $('[data-save]', dlg).addEventListener('click', onSave);
      const delBtn = $('[data-del]', dlg);
      if (delBtn) delBtn.addEventListener('click', () => { dlg.close(); deleteTx(tx); });
    }

    async function onSave() {
      const amount = Math.round(finalAmount() * 100) / 100;
      if (!(amount > 0)) { alert('Ingresá un monto mayor a 0.'); return; }
      if (!draft.categoryId) { alert('Elegí una categoría.'); return; }
      if (!draft.methodId) { alert('Elegí una cuenta.'); return; }
      const note = ($('#tx-note', dlg) || {}).value || '';
      const base = {
        date: draft.date, type: draft.type, amount, currency: draft.currency,
        categoryId: draft.categoryId, methodId: draft.methodId, note: note.trim(),
      };

      if (editing) {
        // El equivalente en USD queda como estaba si el monto/moneda no
        // cambiaron (para no perder el valor histórico por editar la nota o
        // la categoría); si cambian, se recalcula con la cotización actual.
        const keepSnapshot = tx.currency === draft.currency && tx.amount === amount && tx.usdSnapshot != null;
        base.usdSnapshot = keepSnapshot ? tx.usdSnapshot : usdSnapshotFor(amount, draft.currency);
        Object.assign(tx, base);
      } else {
        const instEl = $('#tx-inst', dlg);
        const n = showInstallments() ? Math.max(1, parseInt((instEl && instEl.value) || '1', 10) || 1) : 1;
        if (n === 1) {
          S().transactions.push({ id: Store.uid(), ...base, usdSnapshot: usdSnapshotFor(amount, draft.currency) });
        } else {
          const groupId = Store.uid();
          const per = Math.round((amount / n) * 100) / 100;
          const start = parseDate(draft.date);
          for (let k = 1; k <= n; k++) {
            const cuota = (k === n) ? Math.round((amount - per * (n - 1)) * 100) / 100 : per;
            const dk = clampDate(start.getFullYear(), start.getMonth() + (k - 1), start.getDate());
            S().transactions.push({
              id: Store.uid(), ...base, amount: cuota, date: dateToStr(dk),
              groupId, installment: { k, n }, usdSnapshot: usdSnapshotFor(cuota, draft.currency),
            });
          }
        }
      }
      Store.save();

      if (canShare && draft.shareIt) {
        const pctEl = $('#tx-share-pct', dlg);
        const pct = Math.min(100, Math.max(0, parseFloat((pctEl && pctEl.value) || '50')));
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
    dlg.showModal();
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
    const inMonth = txs.filter((t) => monthKeyOf(t.date) === mk);
    const prevMk = addMonthsKey(mk, -1);
    const inPrev = txs.filter((t) => monthKeyOf(t.date) === prevMk);

    const inc = sumDisp(inMonth.filter((t) => t.type === 'ingreso'));
    const exp = sumDisp(inMonth.filter((t) => t.type === 'gasto'));
    const incPrev = sumDisp(inPrev.filter((t) => t.type === 'ingreso'));
    const expPrev = sumDisp(inPrev.filter((t) => t.type === 'gasto'));
    const balance = inc - exp;

    let savTotal = 0;
    for (const s of S().savings) {
      const bal = s.entries.reduce((a, e) => a + e.amount, 0);
      const v = convOrNull(bal, s.currency);
      if (v != null) savTotal += v;
    }

    const delta = (cur, prev, upIsGood) => {
      if (!(prev > 0)) return '';
      const pct = Math.round(((cur - prev) / prev) * 100);
      if (pct === 0) return `<div class="tile-delta">= vs. ${esc(monthLabel(prevMk))}</div>`;
      const up = pct > 0;
      const cls = (up === upIsGood) ? 'up-good' : 'down-bad';
      return `<div class="tile-delta"><span class="${cls}">${up ? '▲' : '▼'} ${Math.abs(pct)}%</span> vs. ${esc(monthLabel(prevMk))}</div>`;
    };

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
    if (catItems.length > 8) {
      const rest = catItems.slice(7);
      catItems = catItems.slice(0, 7);
      catItems.push({ label: `Otras (${rest.length})`, value: rest.reduce((a, i) => a + i.value, 0) });
    }

    // Tendencia: últimos 6 meses hasta el mes elegido
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(addMonthsKey(mk, -i));
    const trendRows = months.map((m) => {
      const list = txs.filter((t) => monthKeyOf(t.date) === m);
      const [y, mo] = m.split('-').map(Number);
      return {
        label: monthShortFmt.format(new Date(y, mo - 1, 1)).replace('.', ''),
        income: sumDisp(list.filter((t) => t.type === 'ingreso')),
        expense: sumDisp(list.filter((t) => t.type === 'gasto')),
      };
    });

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

    // Patrimonio neto = activos (ahorros) − deudas (resúmenes de tarjeta a pagar)
    const activos = savTotal;
    const deudas = cardRows.reduce((a, r) => a + r.current + r.toPay, 0);
    const neto = activos - deudas;

    el.innerHTML = `
      <div class="hero">
        <div class="hero-label">◇ Patrimonio neto</div>
        <div class="hero-value">${heroMoneyHTML(neto, disp())}</div>
        <div class="hero-split">
          <div><div class="k">Activos (ahorros)</div><div class="v">${fmtDisp(activos)}</div></div>
          <div><div class="k">Deudas (tarjetas)</div><div class="v">${fmtDisp(deudas)}</div></div>
        </div>
      </div>

      <div class="toolbar">
        <div class="month-nav">
          <button class="icon-btn" data-mnav="-1" aria-label="Mes anterior">‹</button>
          <span class="month-label">${esc(monthLabel(mk))}</span>
          <button class="icon-btn" data-mnav="1" aria-label="Mes siguiente">›</button>
        </div>
        ${mk !== curMonth() ? '<button class="link-btn" data-mtoday>volver al mes actual</button>' : ''}
      </div>

      <div class="grid-tiles">
        <div class="card tile">
          <div class="tile-label">Ingresos</div>
          <div class="tile-value pos">${fmtDisp(inc)}</div>
          ${delta(inc, incPrev, true)}
        </div>
        <div class="card tile">
          <div class="tile-label">Gastos</div>
          <div class="tile-value">${fmtDisp(exp)}</div>
          ${delta(exp, expPrev, false)}
        </div>
        <div class="card tile">
          <div class="tile-label">Balance del mes</div>
          <div class="tile-value ${balance > 0 ? 'pos' : balance < 0 ? 'neg' : ''}">${fmtDisp(balance)}</div>
        </div>
        <div class="card tile">
          <div class="tile-label">Ahorros totales</div>
          <div class="tile-value">${fmtDisp(savTotal)}</div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <h2 class="card-title">Gastos por categoría · ${esc(monthLabel(mk))}</h2>
          <div id="chart-cats">${catItems.length ? '' : '<div class="empty">Sin gastos registrados este mes.</div>'}</div>
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
      </div>

      <div class="card">
        <h2 class="card-title">Tarjetas de crédito · cierres y vencimientos</h2>
        ${cards.length ? `
        <div class="table-scroll"><table class="data">
          <thead><tr>
            <th>Tarjeta</th><th>Cierre actual</th><th>Resumen en curso</th>
            <th>Último resumen</th><th>Vencimiento</th>
          </tr></thead>
          <tbody>
            ${cardRows.map((r) => `
              <tr>
                <td><b>${esc(r.card.name)}</b></td>
                <td>${esc(fmtDay(r.cy.close))}</td>
                <td class="num">${fmtDisp(r.current)}</td>
                <td class="num">${fmtDisp(r.toPay)}</td>
                <td>${esc(fmtDay(r.cy.prevDue))}</td>
              </tr>`).join('')}
          </tbody>
        </table></div>
        <div class="hint" style="margin-top:8px">“Último resumen” es lo facturado en el período ya cerrado, que vence en la fecha indicada. “Resumen en curso” es lo que se está acumulando para el próximo cierre.</div>`
        : '<div class="empty">Agregá tus tarjetas de crédito en “Tarjetas y medios” para ver cierres, vencimientos y cuánto vas a pagar.</div>'}
      </div>`;

    // Gráficos
    if (catItems.length) {
      Charts.hBars($('#chart-cats', el), catItems, {
        fmt: fmtDisp, color: Charts.COLORS.category,
      });
    }
    const trendEl = $('#chart-trend', el);
    if (ui.trendTable) {
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
      Charts.trend(trendEl, trendRows, { fmt: fmtDisp });
    }

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
  }

  /* ================= Vista: Movimientos ================= */
  function vMovimientos(el) {
    const txs = S().transactions;
    const monthsPresent = [...new Set(txs.map((t) => monthKeyOf(t.date)))];
    if (!monthsPresent.includes(curMonth())) monthsPresent.push(curMonth());
    monthsPresent.sort().reverse();
    if (ui.fMonth && !monthsPresent.includes(ui.fMonth)) ui.fMonth = curMonth();

    let list = txs.slice();
    if (ui.fMonth) list = list.filter((t) => monthKeyOf(t.date) === ui.fMonth);
    if (ui.fType) list = list.filter((t) => t.type === ui.fType);
    if (ui.fCat) list = list.filter((t) => t.categoryId === ui.fCat);
    if (ui.fMethod) list = list.filter((t) => t.methodId === ui.fMethod);
    list.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

    const inc = sumDisp(list.filter((t) => t.type === 'ingreso'));
    const exp = sumDisp(list.filter((t) => t.type === 'gasto'));

    el.innerHTML = `
      <div class="card">
        <div class="toolbar" style="margin-bottom:12px">
          <select id="fil-month" aria-label="Mes">
            <option value="">Todos los meses</option>
            ${monthsPresent.map((m) => `<option value="${m}" ${m === ui.fMonth ? 'selected' : ''}>${esc(monthLabel(m))}</option>`).join('')}
          </select>
          <select id="fil-type" aria-label="Tipo">
            <option value="">Ingresos y gastos</option>
            <option value="ingreso" ${ui.fType === 'ingreso' ? 'selected' : ''}>Solo ingresos</option>
            <option value="gasto" ${ui.fType === 'gasto' ? 'selected' : ''}>Solo gastos</option>
          </select>
          <select id="fil-cat" aria-label="Categoría">
            <option value="">Todas las categorías</option>
            ${selOptions(S().categories, ui.fCat)}
          </select>
          <select id="fil-method" aria-label="Medio de pago">
            <option value="">Todos los medios</option>
            ${selOptions(S().methods, ui.fMethod)}
          </select>
          <div class="spacer"></div>
          <button class="btn btn-primary btn-sm" id="btn-add-tx">+ Movimiento</button>
        </div>

        ${list.length ? `
        <div class="table-scroll"><table class="data">
          <thead><tr>
            <th>Fecha</th><th>Detalle</th><th>Categoría</th><th>Medio</th>
            <th class="num">Monto</th><th></th>
          </tr></thead>
          <tbody>
            ${list.map((t) => {
              const inst = t.installment ? ` <span class="badge">cuota ${t.installment.k}/${t.installment.n}</span>` : '';
              const rec = t.recurringId ? ' <span class="badge">fijo</span>' : '';
              const cur = t.currency === 'USD' ? ' <span class="badge badge-cur">USD</span>' : '';
              const sign = t.type === 'gasto' ? '−' : '+';
              const cls = t.type === 'gasto' ? 'amount-out' : 'amount-in';
              const usdLine = (t.currency === 'ARS' && t.usdSnapshot != null)
                ? `<div class="cell-sub">≈ ${esc(fmtMoney(t.usdSnapshot, 'USD'))}</div>` : '';
              return `<tr class="rowlink" data-tx="${esc(t.id)}">
                <td class="cell-sub">${esc(fmtDateShort(t.date))}</td>
                <td>${esc(t.note || catName(t.categoryId))}${inst}${rec}${cur}</td>
                <td class="cell-sub">${esc(catName(t.categoryId))}</td>
                <td class="cell-sub">${esc(methodName(t.methodId))}</td>
                <td class="num ${cls}">${sign} ${fmtMoney(t.amount, t.currency)}${usdLine}</td>
                <td><button class="row-del" data-del="${esc(t.id)}" aria-label="Eliminar">✕</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
        <div class="totals-row">
          <span>Movimientos: <b>${list.length}</b></span>
          <span>Ingresos: <b class="amount-in">${fmtDisp(inc)}</b></span>
          <span>Gastos: <b>${fmtDisp(exp)}</b></span>
          <span>Balance: <b>${fmtDisp(inc - exp)}</b></span>
        </div>`
        : '<div class="empty">No hay movimientos con estos filtros. Cargá el primero con “+ Movimiento”.</div>'}
      </div>`;

    $('#fil-month', el).addEventListener('change', (e) => { ui.fMonth = e.target.value; render(); });
    $('#fil-type', el).addEventListener('change', (e) => { ui.fType = e.target.value; render(); });
    $('#fil-cat', el).addEventListener('change', (e) => { ui.fCat = e.target.value; render(); });
    $('#fil-method', el).addEventListener('change', (e) => { ui.fMethod = e.target.value; render(); });
    $('#btn-add-tx', el).addEventListener('click', () => txForm(null));

    $$('tr[data-tx]', el).forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-del]')) return;
        const tx = S().transactions.find((t) => t.id === row.dataset.tx);
        if (tx) txForm(tx);
      });
    });
    $$('[data-del]', el).forEach((b) => b.addEventListener('click', () => {
      const tx = S().transactions.find((t) => t.id === b.dataset.del);
      if (tx) deleteTx(tx);
    }));
  }

  /* ================= Vista: Tarjetas y medios ================= */
  function methodForm(method) {
    const editing = !!method;
    const m = method || { name: '', kind: 'credito', closingDay: 25, dueDay: 5 };
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
          <input type="number" name="closingDay" id="m-close" min="1" max="28" step="1" value="${esc(m.closingDay ?? 25)}">
        </div>
        <div class="field">
          <label for="m-due">Día de vencimiento</label>
          <input type="number" name="dueDay" id="m-due" min="1" max="28" step="1" value="${esc(m.dueDay ?? 5)}">
        </div>
      </div>
      <span class="hint" id="m-hint" hidden>Usá días entre 1 y 28. Si tu tarjeta cierra el 29, 30 o 31, poné 28.</span>`;

    const dlg = openDialog(editing ? 'Editar medio de pago' : 'Nuevo medio de pago', body, {
      onSubmit(d) {
        const data = { name: d.name.trim(), kind: d.kind };
        if (d.kind === 'credito') {
          data.closingDay = Math.min(28, Math.max(1, parseInt(d.closingDay, 10) || 25));
          data.dueDay = Math.min(28, Math.max(1, parseInt(d.dueDay, 10) || 5));
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
            details = `<dl>
              <dt>Cierra el día</dt><dd>${m.closingDay} · próximo: ${esc(fmtDay(cy.close))}</dd>
              <dt>Vence el día</dt><dd>${m.dueDay} · próximo: ${esc(fmtDay(cy.prevDue))}</dd>
              <dt>Resumen en curso</dt><dd>${fmtDisp(current)}</dd>
              <dt>Último resumen</dt><dd>${fmtDisp(toPay)}</dd>
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
      const due = clampDate(y, mo - 1, c.dueDay);
      // Resumen que vence en esa fecha: el que cerró justo antes del vencimiento.
      let close = clampDate(due.getFullYear(), due.getMonth(), c.closingDay);
      if (close >= due) close = clampDate(due.getFullYear(), due.getMonth() - 1, c.closingDay);
      const prevClose = clampDate(close.getFullYear(), close.getMonth() - 1, c.closingDay);
      const amount = cardPeriodTotal(c.id, prevClose, close); // ya en moneda visible
      events.push({
        date: dateToStr(due), kind: 'card', icon: '💳',
        title: c.name, sub: 'Vencimiento tarjeta · día ' + c.dueDay,
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
        <select name="categoryId" id="r-cat" required>${selOptions(selectableCats(r.type), r.categoryId)}</select>
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
      sel.innerHTML = selOptions(selectableCats($('#r-type', dlg).value), sel.value);
    });
  }

  function vPlan(el) {
    const mk = curMonth();
    const monthTx = S().transactions.filter(
      (t) => t.type === 'gasto' && monthKeyOf(t.date) === mk);

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
        <div class="table-scroll"><table class="data">
          <thead><tr>
            <th>Nombre</th><th>Tipo</th><th class="num">Monto</th><th>Día</th>
            <th>Categoría</th><th>Medio</th><th></th>
          </tr></thead>
          <tbody>${S().recurring.map((r) => `
            <tr class="rowlink" data-rid="${esc(r.id)}">
              <td><b>${esc(r.name)}</b></td>
              <td class="cell-sub">${r.type === 'gasto' ? 'Gasto' : 'Ingreso'}</td>
              <td class="num">${fmtMoney(r.amount, r.currency)}</td>
              <td class="cell-sub">${r.day}</td>
              <td class="cell-sub">${esc(catName(r.categoryId))}</td>
              <td class="cell-sub">${esc(methodName(r.methodId))}</td>
              <td><button class="row-del" data-rdel="${esc(r.id)}" aria-label="Eliminar">✕</button></td>
            </tr>`).join('')}</tbody>
        </table></div>
        <div class="hint" style="margin-top:8px">Al abrir la app en un mes nuevo, estos movimientos se cargan solos. Los ya generados se pueden editar o borrar como cualquier movimiento.</div>`
        : '<div class="empty">Cargá tus gastos e ingresos fijos (alquiler, suscripciones, sueldo) y se registran solos cada mes.</div>'}
      </div>`;

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
    $$('tr[data-rid]', el).forEach((row) => row.addEventListener('click', (e) => {
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
      lines.push([
        t.date, t.type, String(t.amount).replace('.', ','), t.currency,
        q(catName(t.categoryId)), q(methodName(t.methodId)), q(t.note || ''),
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
          <h2 class="card-title">Cotización del dólar</h2>
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
          <h2 class="card-title">
            <span>Categorías</span>
            <label class="subcats-toggle">
              Subcategorías
              <input type="checkbox" id="set-subcats" ${useSubcats() ? 'checked' : ''}>
            </label>
          </h2>
          <div style="display:grid;gap:16px">
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

  function onAccountChip() {
    if (Cloud.isConfigured() && !Cloud.user()) authDialog();
    else { ui.view = 'ajustes'; render(); }
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
      await Cloud.signOut();
      onAuthChanged();
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
          <div class="mark" aria-hidden="true">F</div>
          <h2>${draft.mode === 'in' ? 'Ingresá a tu cuenta' : 'Creá tu cuenta'}</h2>
          <p>Para sincronizar tus datos entre tus dispositivos.</p>
        </div>
        <div class="auth-tabs">
          <button type="button" class="auth-tab ${draft.mode === 'in' ? 'active' : ''}" data-amode="in">Ingresar</button>
          <button type="button" class="auth-tab ${draft.mode === 'up' ? 'active' : ''}" data-amode="up">Crear cuenta</button>
        </div>
        <div class="auth-body">
          <input type="text" id="au-user" autocomplete="username" placeholder="Usuario (por ej. jose)" value="${esc(draft.user)}">
          <input type="password" id="au-pass" autocomplete="${draft.mode === 'in' ? 'current-password' : 'new-password'}"
                 placeholder="Contraseña (mínimo 6 caracteres)" value="${esc(draft.pass)}">
          <div class="auth-msg" id="au-msg"></div>
          <button type="button" class="btn btn-primary auth-submit" id="au-submit">${draft.mode === 'in' ? 'Ingresar' : 'Crear cuenta'}</button>
          <button type="button" class="link-btn" data-close style="justify-self:center">Cancelar</button>
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
    }

    paint();
    dlg.showModal();
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

  // Al cambiar el estado de sesión: traer datos remotos o subir los locales.
  async function onAuthChanged() {
    renderAccountChip();
    // Cambió la sesión (login/logout/otra cuenta): invalida la caché de
    // "Compartido" para no arrastrar el hogar de una cuenta anterior.
    shared.loaded = false;
    shared.household = null;
    shared.expenses = [];
    shared.settlements = [];
    if (Cloud.user()) {
      try {
        const remote = await Cloud.pull();
        if (remote && remote.data && Array.isArray(remote.data.transactions)) {
          const localTs = S()._updatedAt || 0;
          const remoteTs = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
          // La nube manda salvo que lo local sea más nuevo y la nube esté vacía de cambios.
          if (remoteTs >= localTs || !S().transactions.length) {
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
    } catch (e) {
      console.error('Init nube', e);
      renderAccountChip();
    }
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
    if (ui.view === 'compartido') render();
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
        } catch (e) { alert('No se pudo crear: ' + e.message); }
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
        }).catch((e) => { $('#j-msg', dlg).textContent = e.message || 'Código inválido.'; });
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
        } catch (e) { alert('No se pudo guardar: ' + e.message); return false; }
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
        } catch (e) { alert('No se pudo guardar: ' + e.message); return false; }
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
      } catch (e) { alert('No se pudo generar el código: ' + e.message); }
    });
    $('#btn-leave-house', el).addEventListener('click', async () => {
      if (!confirm('¿Salir de este hogar compartido? Vas a dejar de ver el historial de gastos en común.')) return;
      try {
        await Cloud.leaveHousehold(shared.household.id);
        shared.loaded = false;
        await loadShared();
      } catch (e) { alert('No se pudo salir: ' + e.message); }
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
    compartido: vCompartido,
    tarjetas: vTarjetas,
    ahorros: vAhorros,
    plan: vPlan,
    ajustes: vAjustes,
  };

  function render() {
    Charts.tipHide();
    $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === ui.view));
    $$('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.cur === disp()));
    renderRateChip();
    renderAccountChip();
    renderBanner();
    const el = $('#view');
    VIEWS[ui.view](el);
  }

  function init() {
    generateRecurring();

    $$('.tabs button').forEach((b) => b.addEventListener('click', () => {
      ui.view = b.dataset.view;
      // "Compartido" vive en la nube y lo puede cambiar la otra persona en
      // cualquier momento: siempre se recarga al entrar a la pestaña.
      if (ui.view === 'compartido') shared.loaded = false;
      render();
    }));
    $$('.seg-btn').forEach((b) => b.addEventListener('click', () => {
      S().settings.displayCurrency = b.dataset.cur;
      Store.save();
      render();
    }));
    $('#btn-new-tx').addEventListener('click', () => txForm(null));
    $('#rate-chip').addEventListener('click', refreshRates);
    $('#account-chip').addEventListener('click', onAccountChip);
    $('#theme-toggle').addEventListener('click', toggleTheme);
    updateThemeButton();
    $('#footer-backup').addEventListener('click', (e) => {
      e.preventDefault();
      ui.view = 'ajustes';
      render();
    });

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
