'use strict';

/* FX — cotización del dólar (DolarAPI) y conversión de monedas. */
const FX = (() => {
  const API = 'https://dolarapi.com/v1/dolares';

  const SOURCES = [
    { id: 'oficial', name: 'Oficial' },
    { id: 'blue',    name: 'Blue' },
    { id: 'bolsa',   name: 'MEP (Bolsa)' },
    { id: 'tarjeta', name: 'Tarjeta' },
    { id: 'cripto',  name: 'Cripto' },
  ];

  async function fetchRates() {
    const res = await fetch(API, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const arr = await res.json();
    const map = {};
    for (const d of arr) {
      if (d && d.casa && typeof d.venta === 'number') {
        map[d.casa] = { compra: d.compra, venta: d.venta, nombre: d.nombre };
      }
    }
    if (!Object.keys(map).length) throw new Error('Respuesta vacía');
    return map;
  }

  /* Cotización efectiva: manual si está definida, si no la cacheada de la API.
     Devuelve { value, label } o null si no hay ninguna disponible. */
  function currentRate(state) {
    const s = state.settings;
    if (typeof s.manualRate === 'number' && s.manualRate > 0) {
      return { value: s.manualRate, label: 'manual' };
    }
    const r = s.cachedRates && s.cachedRates[s.fxSource];
    if (r && r.venta > 0) {
      const src = SOURCES.find((x) => x.id === s.fxSource);
      return { value: r.venta, label: src ? src.name : s.fxSource };
    }
    return null;
  }

  /* Convierte entre ARS y USD con rate = pesos por dólar.
     Devuelve null si hace falta convertir y no hay cotización. */
  function convert(amount, from, to, rate) {
    if (from === to) return amount;
    if (!rate) return null;
    return from === 'USD' ? amount * rate : amount / rate;
  }

  return { SOURCES, fetchRates, currentRate, convert };
})();
