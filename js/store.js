'use strict';

/* Store — estado de la aplicación y persistencia en localStorage. */
const Store = (() => {
  const KEY = 'finpepe:v1';

  const uid = () =>
    Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

  const seedCategories = () => [
    // Gastos
    { id: 'c-super',    name: 'Supermercado',   type: 'gasto' },
    { id: 'c-comida',   name: 'Comida afuera',  type: 'gasto' },
    { id: 'c-transp',   name: 'Transporte',     type: 'gasto' },
    { id: 'c-vivienda', name: 'Vivienda',       type: 'gasto' },
    { id: 'c-servicios',name: 'Servicios',      type: 'gasto' },
    { id: 'c-salud',    name: 'Salud',          type: 'gasto' },
    { id: 'c-educ',     name: 'Educación',      type: 'gasto' },
    { id: 'c-entret',   name: 'Entretenimiento',type: 'gasto' },
    { id: 'c-ropa',     name: 'Ropa',           type: 'gasto' },
    { id: 'c-viajes',   name: 'Viajes',         type: 'gasto' },
    { id: 'c-impuestos',name: 'Impuestos',      type: 'gasto' },
    { id: 'c-subs',     name: 'Suscripciones',  type: 'gasto' },
    { id: 'c-otros-g',  name: 'Otros gastos',   type: 'gasto' },
    // Ingresos
    { id: 'c-sueldo',   name: 'Sueldo',         type: 'ingreso' },
    { id: 'c-free',     name: 'Freelance',      type: 'ingreso' },
    { id: 'c-invers',   name: 'Inversiones',    type: 'ingreso' },
    { id: 'c-ventas',   name: 'Ventas',         type: 'ingreso' },
    { id: 'c-otros-i',  name: 'Otros ingresos', type: 'ingreso' },
  ];

  const seedMethods = () => [
    { id: 'm-efectivo', name: 'Efectivo',          kind: 'efectivo' },
    { id: 'm-debito',   name: 'Tarjeta de débito', kind: 'debito' },
    { id: 'm-mp',       name: 'Mercado Pago',      kind: 'billetera' },
  ];

  const defaults = () => ({
    version: 1,
    settings: {
      displayCurrency: 'ARS',   // 'ARS' | 'USD'
      fxSource: 'blue',         // oficial | blue | bolsa | tarjeta | cripto
      manualRate: null,         // number | null — pisa la cotización de la API
      cachedRates: null,        // { casa: {compra, venta, nombre} }
      ratesUpdatedAt: null,     // ISO string
    },
    categories: seedCategories(),
    methods: seedMethods(),
    // {id, date:'YYYY-MM-DD', type:'ingreso'|'gasto', amount, currency,
    //  categoryId, methodId, note, groupId?, installment?:{k,n}, recurringId?}
    transactions: [],
    // {id, name, currency, target|null, entries:[{id, date, amount, note}]}
    savings: [],
    // {id, categoryId, amount, currency}  — presupuesto mensual por categoría
    budgets: [],
    // {id, name, type, amount, currency, categoryId, methodId, day, lastGen:'YYYY-MM'|null}
    recurring: [],
  });

  function migrate(s) {
    const d = defaults();
    // Completa claves faltantes sin pisar datos existentes.
    for (const k of Object.keys(d)) if (s[k] === undefined) s[k] = d[k];
    for (const k of Object.keys(d.settings)) {
      if (s.settings[k] === undefined) s.settings[k] = d.settings[k];
    }
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return migrate(JSON.parse(raw));
    } catch (e) {
      console.error('No se pudo leer el estado guardado', e);
    }
    return defaults();
  }

  let state = load();
  const saveHooks = [];

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.error('No se pudo guardar', e);
    }
  }

  // Guardado del usuario: persiste en localStorage y notifica a los hooks
  // (por ejemplo, la sincronización con la nube).
  function save() {
    state._updatedAt = Date.now();
    persist();
    for (const h of saveHooks) {
      try { h(state); } catch (e) { console.error(e); }
    }
  }

  function onSave(cb) { saveHooks.push(cb); }

  function replace(next) {
    state = migrate(next);
    save();
  }

  // Aplica un estado traído de la nube sin volver a disparar una subida.
  function applyRemote(next) {
    state = migrate(next);
    persist();
  }

  function reset() {
    state = defaults();
    save();
  }

  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }

  return {
    get state() { return state; },
    uid, save, onSave, replace, applyRemote, reset, exportJSON, defaults,
  };
})();
