// ARCHIVO GENERADO para pegar en el editor web de Supabase (Edge Functions →
// Deploy a new function → Via Editor, nombre: notify). Es index.ts + logic.js
// en un solo archivo. Si cambiás la lógica, editá logic.js / index.ts.
// En la configuración de la función, desactivá "Verify JWT".
// @ts-nocheck
// Edge Function "notify" de FinPep: notificaciones push (Web Push).
//
// Acciones (POST con JSON { action }):
//   - "vapid": devuelve la clave pública VAPID (la app la necesita para
//     suscribir el dispositivo). No requiere sesión.
//   - "test":  manda una notificación de prueba a los dispositivos del
//     usuario que llama (header Authorization: Bearer <access token>).
//   - "daily": la corre el cron una vez por día (header x-cron-secret):
//     revisa los datos de cada usuario suscripto y manda los avisos del día
//     (vencimientos de tarjeta, tope del resumen). Cada aviso se manda una
//     sola vez (tabla push_sent).
//
// Secrets necesarios (supabase secrets set ...): VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT (ej. mailto:vos@mail.com), CRON_SECRET.
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen en el entorno.
// Deploy: supabase functions deploy notify --no-verify-jwt

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Lógica de las notificaciones diarias de FinPep, sin dependencias: la usa
// la Edge Function (index.ts) y se puede probar con Node. Recibe el estado
// de la app de un usuario (lo mismo que se sincroniza en finance_state.data)
// y la fecha de "hoy" en Argentina, y devuelve las notificaciones a mandar,
// cada una con una clave única para no repetirla (ver push_sent).
//
// Replica, simplificado, el ciclo de tarjetas de la app (js/app.js):
//   - cada resumen cargado en card.overrides tiene su cierre y vencimiento;
//   - después del último cargado se proyecta mes a mes con los mismos días;
//   - el total de un resumen son los gastos con esa tarjeta con fecha en
//     (cierre anterior, cierre].

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const clampDate = (y, m0, day) => {
  const last = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m0, Math.min(day, last)));
};
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const short = (d) => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;

const nfARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const money = (n) => nfARS.format(Math.round(n));

// Resúmenes cargados de una tarjeta, del más viejo al más nuevo.
function loadedStatements(card) {
  const ov = card.overrides || {};
  return Object.keys(ov).map((key) => {
    const o = ov[key];
    let close = o.closeDateStr ? parse(o.closeDateStr) : null;
    if (!close && o.closingDay != null && /^\d{4}-\d{2}/.test(key)) {
      close = clampDate(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, o.closingDay);
    }
    if (!close) return null;
    let due = o.dueDateStr ? parse(o.dueDateStr) : null;
    if (!due && o.dueDay != null) {
      due = clampDate(close.getUTCFullYear(), close.getUTCMonth(), o.dueDay);
      if (due <= close) due = clampDate(close.getUTCFullYear(), close.getUTCMonth() + 1, o.dueDay);
    }
    return { close, due };
  }).filter(Boolean).sort((a, b) => a.close - b.close);
}

// Resúmenes cargados + proyectados hasta `until` (mismo día de cierre y de
// vencimiento que el último cargado, mes a mes).
function statements(card, until) {
  const list = loadedStatements(card);
  if (!list.length) return [];
  const last = list[list.length - 1];
  const closeDay = last.close.getUTCDate();
  const dueDay = last.due ? last.due.getUTCDate() : null;
  const dueOffset = last.due
    ? (last.due.getUTCFullYear() - last.close.getUTCFullYear()) * 12 + last.due.getUTCMonth() - last.close.getUTCMonth()
    : 1;
  for (let i = 1; i <= 24; i++) {
    const y = last.close.getUTCFullYear(), m = last.close.getUTCMonth() + i;
    const close = clampDate(y, m, closeDay);
    if (close > until) break;
    const due = dueDay != null ? clampDate(y, m + dueOffset, dueDay) : null;
    list.push({ close, due, projected: true });
  }
  return list;
}

// Monto en pesos de un movimiento (USD con su equivalente guardado o, si
// no lo tiene, con la cotización cacheada).
function ars(t, rate) {
  if (t.currency === 'USD') {
    if (t.arsSnapshot != null) return Number(t.arsSnapshot);
    return rate ? Number(t.amount) * rate : 0;
  }
  return Number(t.amount) || 0;
}

function periodTotal(state, cardId, from, to, rate) {
  const a = from ? ymd(from) : '0000-00-00', b = ymd(to);
  return (state.transactions || [])
    .filter((t) => t.type === 'gasto' && t.methodId === cardId && t.date > a && t.date <= b)
    .reduce((acc, t) => acc + ars(t, rate), 0);
}

function cachedRate(state) {
  const s = state.settings || {};
  if (typeof s.manualRate === 'number' && s.manualRate > 0) return s.manualRate;
  const r = s.cachedRates && s.cachedRates[s.fxSource || 'blue'];
  return r ? Number(r.venta) || null : null;
}

/* Notificaciones del día para un usuario. todayStr: 'YYYY-MM-DD' (hora
   argentina). Devuelve [{ key, title, body, url, tag }]. */
function buildDailyNotifications(state, todayStr) {
  const out = [];
  if (!state || !Array.isArray(state.methods)) return out;
  const today = parse(todayStr);
  const tomorrow = addDays(today, 1);
  const rate = cachedRate(state);

  for (const card of state.methods.filter((m) => m.kind === 'credito')) {
    const st = statements(card, addDays(today, 70));
    if (!st.length) continue;

    // 1) Vencimiento: mañana o hoy.
    st.forEach((s, i) => {
      if (!s.due) return;
      const isToday = ymd(s.due) === todayStr;
      const isTomorrow = ymd(s.due) === ymd(tomorrow);
      if (!isToday && !isTomorrow) return;
      const prev = st[i - 1];
      if (!prev) return; // sin cierre anterior no se puede saber el total
      const total = periodTotal(state, card.id, prev.close, s.close, rate);
      if (total <= 0) return;
      out.push({
        key: `due:${card.id}:${ymd(s.due)}:${isToday ? 'today' : 'tomorrow'}`,
        title: isToday ? `💳 Hoy vence la ${card.name}` : `💳 Mañana vence la ${card.name}`,
        body: `Resumen del ${short(s.close)}: ${money(total)} (según lo cargado en FinPep).`,
        url: './',
        tag: `due-${card.id}`,
      });
    });

    // 2) Resumen en curso contra el tope (o el promedio de los últimos 3).
    const curIdx = st.findIndex((s) => s.close >= today);
    if (curIdx <= 0) continue;
    const cur = st[curIdx], prev = st[curIdx - 1];
    const spent = periodTotal(state, card.id, prev.close, cur.close, rate);
    const closed = [];
    for (let i = curIdx - 1; i >= 1 && closed.length < 3; i--) {
      const t = periodTotal(state, card.id, st[i - 1].close, st[i].close, rate);
      if (t > 0) closed.push(t);
    }
    let ref = null, refLabel = '';
    if (card.cap && card.cap.amount > 0) {
      ref = card.cap.currency === 'USD' ? (rate ? card.cap.amount * rate : null) : card.cap.amount;
      refLabel = 'tu tope';
    } else if (closed.length) {
      ref = closed.reduce((a, v) => a + v, 0) / closed.length;
      refLabel = closed.length === 1 ? 'tu último resumen' : `el promedio de tus últimos ${closed.length} resúmenes`;
    }
    if (!ref) continue;
    const cycle = ymd(cur.close);
    const nextDay = short(addDays(cur.close, 1));
    if (spent >= ref) {
      out.push({
        key: `cap100:${card.id}:${cycle}`,
        title: `🛑 ${card.name}: llegaste a ${refLabel}`,
        body: `Llevás ${money(spent)} en el resumen que cierra el ${short(cur.close)}. Conviene dejar de usarla: lo que compres desde el ${nextDay} entra en el siguiente.`,
        url: './',
        tag: `cap-${card.id}`,
      });
    } else if (spent >= ref * 0.85) {
      out.push({
        key: `cap85:${card.id}:${cycle}`,
        title: `⚠️ ${card.name}: cerca de ${refLabel}`,
        body: `Llevás ${money(spent)} de ${money(ref)} (${Math.round((spent / ref) * 100)}%) y el resumen cierra el ${short(cur.close)}.`,
        url: './',
        tag: `cap-${card.id}`,
      });
    }
  }
  return out;
}

// Fecha de hoy en Argentina ('YYYY-MM-DD').
function todayInArgentina(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(now);
}

// ---------------------------------------------------------------------------

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:finpep@example.com';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
type Note = { key?: string; title: string; body: string; url?: string; tag?: string };

// Manda una notificación a una suscripción; si el servicio de push dice
// que ya no existe (el usuario la desactivó o desinstaló), se borra.
async function send(sub: Sub, note: Note): Promise<boolean> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ title: note.title, body: note.body, url: note.url ?? './', tag: note.tag }),
      { TTL: 60 * 60 * 12 },
    );
    return true;
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', sub.id);
    console.error('push error', code, (e as Error).message);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let body: { action?: string } = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  const action = body.action ?? 'daily';

  if (action === 'vapid') return json({ publicKey: VAPID_PUBLIC_KEY });

  if (action === 'test') {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u, error } = await admin.auth.getUser(token);
    if (error || !u?.user) return json({ error: 'Sesión inválida' }, 401);
    const { data: subs } = await admin.from('push_subscriptions').select('*').eq('user_id', u.user.id);
    if (!subs?.length) return json({ error: 'Este usuario no tiene dispositivos suscriptos' }, 404);
    let ok = 0;
    for (const s of subs as Sub[]) {
      if (await send(s, { title: '🔔 FinPep', body: 'Las notificaciones funcionan en este dispositivo.', tag: 'test' })) ok++;
    }
    return json({ sent: ok, devices: subs.length });
  }

  if (action === 'daily') {
    if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return json({ error: 'No autorizado' }, 401);
    const today = todayInArgentina();
    const { data: subs } = await admin.from('push_subscriptions').select('*');
    const byUser = new Map<string, Sub[]>();
    for (const s of (subs ?? []) as Sub[]) {
      if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
      byUser.get(s.user_id)!.push(s);
    }
    let sent = 0;
    for (const [userId, userSubs] of byUser) {
      const { data: row } = await admin.from('finance_state').select('data').eq('user_id', userId).maybeSingle();
      const notes: Note[] = buildDailyNotifications(row?.data, today);
      if (!notes.length) continue;
      const { data: already } = await admin.from('push_sent').select('key').eq('user_id', userId)
        .in('key', notes.map((n) => n.key));
      const done = new Set((already ?? []).map((r: { key: string }) => r.key));
      for (const n of notes) {
        if (done.has(n.key!)) continue;
        let any = false;
        for (const s of userSubs) if (await send(s, n)) any = true;
        if (any) {
          sent++;
          await admin.from('push_sent').insert({ user_id: userId, key: n.key });
        }
      }
    }
    return json({ today, users: byUser.size, sent });
  }

  return json({ error: 'Acción desconocida' }, 400);
});
