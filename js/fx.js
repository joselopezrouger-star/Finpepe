'use strict';

/* FX — cotización del dólar (DolarAPI) y conversión de monedas. */
const FX = (() => {
  const API = 'https://dolarapi.com/v1/dolares';
  // Cotización histórica por día (ArgentinaDatos, mismo dato que usa
  // DolarAPI pero con serie por fecha). No cubre todas las "casas" de
  // DolarAPI (ej. no tiene "tarjeta") ni fechas futuras/sin dato — para
  // esos casos el llamador cae de vuelta a la cotización vigente.
  const API_HIST = 'https://api.argentinadatos.com/v1/cotizaciones/dolares';
  const histCache = {}; // "casa:YYYY-MM-DD" -> {compra, venta} | null

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

  /* Cotización de una "casa" en una fecha puntual (YYYY-MM-DD), o null si no
     hay dato disponible (fecha futura, feriado, casa sin cobertura, sin
     conexión). Nunca tira — el llamador decide el respaldo. */
  async function fetchHistoricalRate(casa, dateStr) {
    const key = `${casa}:${dateStr}`;
    if (key in histCache) return histCache[key];
    try {
      const [y, m, d] = dateStr.split('-');
      const res = await fetch(`${API_HIST}/${casa}/${y}/${m}/${d}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) { histCache[key] = null; return null; }
      const j = await res.json();
      const out = (j && typeof j.venta === 'number') ? { compra: j.compra, venta: j.venta } : null;
      histCache[key] = out;
      return out;
    } catch (e) {
      histCache[key] = null;
      return null;
    }
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

  return { SOURCES, fetchRates, fetchHistoricalRate, currentRate, convert };
})();
