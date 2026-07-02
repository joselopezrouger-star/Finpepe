'use strict';

/* Store — estado de la aplicación y persistencia en localStorage. */
const Store = (() => {
  const KEY = 'finpepe:v1';

  const uid = () =>
    Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

  // Categorías con dos niveles: un grupo (parentId: null) y, opcionalmente,
  // subcategorías dentro de ese grupo (parentId apunta al grupo). Un grupo
  // sin subcategorías se usa directamente como categoría.
  const seedCategories = () => [
    // Gastos — grupos
    { id: 'c-casa',      name: 'Casa',            type: 'gasto', parentId: null },
    { id: 'c-comida',    name: 'Comida',          type: 'gasto', parentId: null },
    { id: 'c-auto',      name: 'Auto y transporte', type: 'gasto', parentId: null },
    { id: 'c-salud',     name: 'Salud',           type: 'gasto', parentId: null },
    { id: 'c-entret',    name: 'Entretenimiento', type: 'gasto', parentId: null },
    { id: 'c-ropa',      name: 'Ropa',            type: 'gasto', parentId: null },
    { id: 'c-educ',      name: 'Educación',       type: 'gasto', parentId: null },
    { id: 'c-viajes',    name: 'Viajes',          type: 'gasto', parentId: null },
    { id: 'c-impuestos', name: 'Impuestos',       type: 'gasto', parentId: null },
    { id: 'c-otros-g',   name: 'Otros gastos',    type: 'gasto', parentId: null },
    // Gastos — subcategorías
    { id: 'c-casa-super',    name: 'Supermercado', type: 'gasto', parentId: 'c-casa' },
    { id: 'c-casa-serv',     name: 'Servicios',    type: 'gasto', parentId: 'c-casa' },
    { id: 'c-casa-alquiler', name: 'Alquiler',     type: 'gasto', parentId: 'c-casa' },
    { id: 'c-casa-limpieza', name: 'Limpieza',     type: 'gasto', parentId: 'c-casa' },
    { id: 'c-comida-deliv',  name: 'Delivery',     type: 'gasto', parentId: 'c-comida' },
    { id: 'c-comida-resto',  name: 'Restaurantes', type: 'gasto', parentId: 'c-comida' },
    { id: 'c-comida-cafe',   name: 'Cafés',        type: 'gasto', parentId: 'c-comida' },
    { id: 'c-auto-nafta',    name: 'Nafta',        type: 'gasto', parentId: 'c-auto' },
    { id: 'c-auto-peajes',   name: 'Peajes',       type: 'gasto', parentId: 'c-auto' },
    { id: 'c-auto-mecanico', name: 'Mecánico',     type: 'gasto', parentId: 'c-auto' },
    { id: 'c-auto-publico',  name: 'Transporte público', type: 'gasto', parentId: 'c-auto' },
    { id: 'c-salud-farmacia',name: 'Farmacia',     type: 'gasto', parentId: 'c-salud' },
    { id: 'c-salud-medico',  name: 'Médico',       type: 'gasto', parentId: 'c-salud' },
    { id: 'c-salud-seguro',  name: 'Seguro médico', type: 'gasto', parentId: 'c-salud' },
    { id: 'c-entret-stream', name: 'Streaming',    type: 'gasto', parentId: 'c-entret' },
    { id: 'c-entret-salidas',name: 'Salidas',      type: 'gasto', parentId: 'c-entret' },
    // Ingresos
    { id: 'c-sueldo',   name: 'Sueldo',         type: 'ingreso', parentId: null },
    { id: 'c-free',     name: 'Freelance',      type: 'ingreso', parentId: null },
    { id: 'c-invers',   name: 'Inversiones',    type: 'ingreso', parentId: null },
    { id: 'c-ventas',   name: 'Ventas',         type: 'ingreso', parentId: null },
    { id: 'c-otros-i',  name: 'Otros ingresos', type: 'ingreso', parentId: null },
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
      useSubcategories: true,   // false = todas las categorías en una sola lista plana
    },
    categories: seedCategories(),
    methods: seedMethods(),
    // {id, date:'YYYY-MM-DD', type:'ingreso'|'gasto', amount, currency,
    //  categoryId, methodId, note, groupId?, installment?:{k,n}, recurringId?,
    //  usdSnapshot?: equivalente en USD al momento de cargarlo (solo ARS)}
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
    // Categorías creadas antes de las subcategorías: quedan como grupo (sin padre).
    for (const c of s.categories) if (c.parentId === undefined) c.parentId = null;
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
