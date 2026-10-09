// Edge Function "notify" de FinPep: notificaciones push (Web Push).
//
// Acciones (POST con JSON { action }):
//   - "vapid": devuelve la clave pública VAPID (la app la necesita para
//     suscribir el dispositivo). No requiere sesión.
//   - "test":  manda una notificación de prueba a los dispositivos del
//     usuario que llama (header Authorization: Bearer <access token>).
//   - "daily": la corre el cron a la mañana (header x-cron-secret): revisa
//     los datos de cada usuario suscripto y manda los avisos del día
//     (vencimientos de tarjeta, alertas de tope, fijos que se cargan hoy).
//   - "reminder": la corre el cron a la noche: si el usuario no cargó nada
//     en el día, le recuerda hacerlo.
//   - "shared": la dispara la base (trigger en shared_expenses) cuando
//     alguien carga un gasto compartido: avisa a la otra persona del hogar.
// Cada aviso se manda una sola vez (tabla push_sent) y solo si el usuario
// tiene ese tipo tildado en Ajustes → Notificaciones (settings.notifPrefs).
//
// Secrets necesarios (supabase secrets set ...): VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT (ej. mailto:vos@mail.com), CRON_SECRET.
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen en el entorno.
// Deploy: supabase functions deploy notify --no-verify-jwt

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildDailyNotifications, buildReminder, notifPrefs, moneyIn, todayInArgentina } from './logic.js';

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

  const cronOk = () => !!CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET;

  // Recorre a cada usuario con dispositivos suscriptos, arma sus avisos con
  // `build` (a partir de sus datos sincronizados) y manda los que no se
  // mandaron antes.
  async function runForAll(build: (state: unknown, today: string) => Note[]) {
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
      const notes: Note[] = build(row?.data, today);
      sent += await deliver(userId, userSubs, notes);
    }
    return { today, users: byUser.size, sent };
  }
  async function deliver(userId: string, userSubs: Sub[], notes: Note[]) {
    if (!notes.length) return 0;
    const { data: already } = await admin.from('push_sent').select('key').eq('user_id', userId)
      .in('key', notes.map((n) => n.key));
    const done = new Set((already ?? []).map((r: { key: string }) => r.key));
    let sent = 0;
    for (const n of notes) {
      if (done.has(n.key!)) continue;
      let any = false;
      for (const s of userSubs) if (await send(s, n)) any = true;
      if (any) {
        sent++;
        await admin.from('push_sent').insert({ user_id: userId, key: n.key });
      }
    }
    return sent;
  }

  if (action === 'daily') {
    if (!cronOk()) return json({ error: 'No autorizado' }, 401);
    return json(await runForAll(buildDailyNotifications));
  }

  if (action === 'reminder') {
    if (!cronOk()) return json({ error: 'No autorizado' }, 401);
    return json(await runForAll(buildReminder));
  }

  if (action === 'shared') {
    if (!cronOk()) return json({ error: 'No autorizado' }, 401);
    const rec = (body as { record?: Record<string, unknown> }).record;
    if (!rec) return json({ error: 'Falta el gasto' }, 400);
    const { data: members } = await admin.from('household_members')
      .select('user_id, email, display_name').eq('household_id', rec.household_id as string);
    const author = (members ?? []).find((m: { user_id: string }) => m.user_id === rec.created_by);
    const authorName = author?.display_name || (author?.email ? String(author.email).split('@')[0] : 'Tu pareja');
    let sent = 0;
    for (const m of (members ?? []) as { user_id: string }[]) {
      if (m.user_id === rec.created_by) continue;
      const { data: row } = await admin.from('finance_state').select('data').eq('user_id', m.user_id).maybeSingle();
      if (!notifPrefs(row?.data).partner) continue;
      const { data: subs } = await admin.from('push_subscriptions').select('*').eq('user_id', m.user_id);
      if (!subs?.length) continue;
      const amount = Number(rec.amount);
      const share = rec.paid_by === m.user_id ? Number(rec.payer_share) : 1 - Number(rec.payer_share);
      sent += await deliver(m.user_id, subs as Sub[], [{
        key: `shared:${rec.id}`,
        title: `👥 ${authorName} cargó un gasto compartido`,
        body: `${rec.note || 'Gasto compartido'}: ${moneyIn(amount, String(rec.currency || 'ARS'))} · tu parte ${moneyIn(amount * share, String(rec.currency || 'ARS'))}`,
        url: './',
        tag: 'shared',
      }]);
    }
    return json({ sent });
  }

  return json({ error: 'Acción desconocida' }, 400);
});
