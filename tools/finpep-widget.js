// FinPep — widget para el iPhone (app Scriptable, gratis en la App Store).
//
// Muestra el saldo del mes, cuánto podés gastar por día hasta fin de mes y
// un botón para cargar un gasto. Lee el resumen que FinPep guarda en la nube
// cada vez que cambia algo (no recalcula nada por su cuenta).
//
// Cómo instalarlo: https://finpep.vercel.app/tools/widget.html

const SUPABASE_URL = 'https://fwldbohbsohuzxyxpqte.supabase.co';
const SUPABASE_KEY = 'sb_publishable_XzLob0A3xYNNIgyXJNIwtA_hGkTbuAu';
const APP_URL = 'https://finpep.vercel.app/';
const NEW_EXPENSE_URL = APP_URL + '?nuevo=gasto';
const KC_CRED = 'finpep-widget-cred';
const KC_TOKEN = 'finpep-widget-token';

// Colores de tokens.css (oscuro / claro).
const C = {
  bg: Color.dynamic(new Color('#FFFFFF'), new Color('#121826')),
  t1: Color.dynamic(new Color('#0F1726'), new Color('#EEF2F7')),
  t2: Color.dynamic(new Color('#4A5568'), new Color('#A3ADBF')),
  t3: Color.dynamic(new Color('#6B7280'), new Color('#7D889C')),
  brand: new Color('#10D39E'),
  onBrand: new Color('#04261B'),
  brandText: Color.dynamic(new Color('#047857'), new Color('#10D39E')),
  neg: Color.dynamic(new Color('#D93A3A'), new Color('#FF6B6B')),
};

/* ---------- Cuenta ---------- */
function toEmail(user) {
  const u = String(user || '').trim().toLowerCase();
  if (u.includes('@')) return u;
  return u.replace(/[^a-z0-9_.-]/g, '') + '@finpepe.invalid';
}
function readKC(key) {
  try { return Keychain.contains(key) ? JSON.parse(Keychain.get(key)) : null; } catch (e) { return null; }
}
async function askCredentials() {
  const a = new Alert();
  a.title = 'FinPep';
  a.message = 'Tu usuario de FinPep (o tu email, si entrás con Google) y tu contraseña. Si no tenés contraseña, creala en FinPep › Ajustes › Cuenta. Quedan guardados solo en este iPhone.';
  a.addTextField('Usuario o email', '');
  a.addSecureTextField('Contraseña', '');
  a.addAction('Guardar');
  a.addCancelAction('Cancelar');
  if ((await a.presentAlert()) === -1) return null;
  const cred = { user: a.textFieldValue(0).trim(), pass: a.textFieldValue(1) };
  if (!cred.user || !cred.pass) return null;
  Keychain.set(KC_CRED, JSON.stringify(cred));
  if (Keychain.contains(KC_TOKEN)) Keychain.remove(KC_TOKEN);
  if (Keychain.contains('finpep-widget-last')) Keychain.remove('finpep-widget-last');
  return cred;
}

async function authRequest(grant, body) {
  const req = new Request(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`);
  req.method = 'POST';
  req.headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  req.body = JSON.stringify(body);
  const r = await req.loadJSON();
  if (!r || !r.access_token) {
    const msg = (r && (r.error_description || r.msg || r.error)) || 'sin respuesta';
    throw new Error(/invalid login/i.test(msg) ? 'Usuario o contraseña incorrectos' : msg);
  }
  const tok = { access: r.access_token, refresh: r.refresh_token, exp: Date.now() + (r.expires_in || 3600) * 1000 };
  Keychain.set(KC_TOKEN, JSON.stringify(tok));
  return tok;
}
// Reusa el token mientras dure; si venció, lo renueva; si no se puede, entra
// de nuevo con usuario y contraseña.
async function accessToken(cred) {
  const tok = readKC(KC_TOKEN);
  if (tok && tok.exp - Date.now() > 60 * 1000) return tok.access;
  if (tok && tok.refresh) {
    try { return (await authRequest('refresh_token', { refresh_token: tok.refresh })).access; } catch (e) { /* sigue */ }
  }
  return (await authRequest('password', { email: toEmail(cred.user), password: cred.pass })).access;
}

async function fetchSummary(cred) {
  const token = await accessToken(cred);
  const req = new Request(`${SUPABASE_URL}/rest/v1/finance_state?select=widget:data->widget`);
  req.headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` };
  const rows = await req.loadJSON();
  if (!Array.isArray(rows)) throw new Error((rows && rows.message) || 'No se pudo leer');
  return rows[0] && rows[0].widget ? rows[0].widget : null;
}

/* ---------- Cuentas del mes ---------- */
function curMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
// Igual que la app: días que quedan después de hoy (mínimo 1 para dividir).
function daysLeft() {
  const d = new Date();
  const total = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return Math.max(0, total - d.getDate());
}
function money(n, cur) {
  const s = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(n)));
  return `${n < 0 ? '−' : ''}${cur === 'USD' ? 'US$' : '$'} ${s}`;
}

/* ---------- Widget ---------- */
function text(stack, str, size, color, weight = 'semibold') {
  const t = stack.addText(str);
  t.font = weight === 'bold' ? Font.boldRoundedSystemFont(size)
    : weight === 'regular' ? Font.regularSystemFont(size) : Font.semiboldSystemFont(size);
  t.textColor = color;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.6;
  return t;
}
function addButton(stack, small) {
  const b = stack.addStack();
  b.backgroundColor = C.brand;
  b.cornerRadius = small ? 12 : 16;
  b.setPadding(small ? 7 : 10, 12, small ? 7 : 10, 12);
  b.centerAlignContent();
  b.url = NEW_EXPENSE_URL;
  if (!small) b.layoutVertically();
  const plus = b.addText(small ? '+  Gasto' : '+');
  plus.font = small ? Font.semiboldSystemFont(14) : Font.boldSystemFont(30);
  plus.textColor = C.onBrand;
  if (!small) {
    const l = b.addText('Gasto');
    l.font = Font.semiboldSystemFont(13);
    l.textColor = C.onBrand;
  }
  return b;
}

/* ---------- Pantalla de bloqueo ---------- */
// Los mismos anillos que Inicio: afuera el % de balance que queda, adentro
// el % del mes que falta. En la pantalla de bloqueo iOS los pinta de un solo
// color, así que van en blanco con distinta opacidad.
const LOCK_FAMILIES = ['accessoryCircular', 'accessoryRectangular', 'accessoryInline'];
function monthLeftPct() {
  const d = new Date();
  const total = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return Math.max(0, Math.min(100, Math.round(((total - d.getDate()) / total) * 100)));
}
function ringsImage(pctOut, pctIn, size) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const c = size / 2;
  const ring = (r, width, pct, alpha) => {
    const stroke = (frac, a) => {
      if (frac <= 0) return;
      const n = Math.max(2, Math.round(120 * frac));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const ang = -Math.PI / 2 + 2 * Math.PI * frac * (i / n);
        pts.push(new Point(c + r * Math.cos(ang), c + r * Math.sin(ang)));
      }
      const path = new Path();
      path.addLines(pts);
      ctx.addPath(path);
      ctx.setStrokeColor(new Color('#FFFFFF', a));
      ctx.setLineWidth(width);
      ctx.strokePath();
      // Puntas redondeadas (solo en el trazo opaco: en los translúcidos el
      // punto encima se vería más claro).
      if (a >= 1 && frac < 1) {
        ctx.setFillColor(new Color('#FFFFFF', a));
        for (const p of [pts[0], pts[pts.length - 1]]) ctx.fillEllipse(new Rect(p.x - width / 2, p.y - width / 2, width, width));
      }
    };
    stroke(1, 0.22 * alpha);
    stroke(Math.max(0, Math.min(100, pct)) / 100, alpha);
  };
  const w1 = size * 0.11, w2 = size * 0.085;
  ring(c - w1 / 2 - 1, w1, pctOut, 1);
  ring(c - w1 - 3 - w2 / 2, w2, pctIn, 0.7);
  return ctx.getImage();
}
function shortMoney(n, cur) {
  // En la pantalla de bloqueo no entra el número entero con los miles.
  const a = Math.abs(n), sign = n < 0 ? '−' : '', sym = cur === 'USD' ? 'US$' : '$';
  if (a >= 1e6) return `${sign}${sym} ${(a / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`;
  if (a >= 1e4) return `${sign}${sym} ${Math.round(a / 1e3).toLocaleString('es-AR')} mil`;
  return money(n, cur);
}
function buildLockWidget(family, { summary, error, needsSetup }) {
  const w = new ListWidget();
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  w.url = needsSetup ? URLScheme.forRunningScript() : NEW_EXPENSE_URL;
  const ok = !needsSetup && !error && summary && summary.month === curMonth();
  const white = Color.white();
  if (!ok) {
    const t = w.addText(needsSetup ? 'FinPep: tocá para configurar' : 'FinPep: abrí la app');
    t.font = Font.semiboldSystemFont(12);
    t.textColor = white;
    t.minimumScaleFactor = 0.6;
    return w;
  }
  const saldo = summary.saldo || 0;
  const days = daysLeft();
  const perDay = saldo / Math.max(1, days);
  const pctOut = summary.pctLeft != null ? summary.pctLeft : 0;
  if (family === 'accessoryInline') {
    const t = w.addText(`${shortMoney(saldo, summary.currency)} · ${shortMoney(perDay, summary.currency)}/día`);
    t.font = Font.semiboldSystemFont(14);
    return w;
  }
  if (family === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    w.backgroundImage = ringsImage(pctOut, monthLeftPct(), 76);
    w.setPadding(0, 0, 0, 0);
    const col = w.addStack();
    col.layoutVertically();
    col.centerAlignContent();
    const t = col.addText(`${pctOut}%`);
    t.font = Font.boldRoundedSystemFont(14);
    t.textColor = white;
    t.centerAlignText();
    t.minimumScaleFactor = 0.6;
    return w;
  }
  // Rectangular: anillos a la izquierda, saldo y por día a la derecha.
  w.setPadding(2, 2, 2, 2);
  const row = w.addStack();
  row.centerAlignContent();
  const img = row.addImage(ringsImage(pctOut, monthLeftPct(), 54));
  img.imageSize = new Size(50, 50);
  row.addSpacer(8);
  const col = row.addStack();
  col.layoutVertically();
  const l = col.addText('Saldo');
  l.font = Font.mediumSystemFont(11);
  l.textColor = new Color('#FFFFFF', 0.7);
  const v = col.addText(money(saldo, summary.currency));
  v.font = Font.boldRoundedSystemFont(17);
  v.textColor = white;
  v.lineLimit = 1;
  v.minimumScaleFactor = 0.5;
  const d = col.addText(`${money(perDay, summary.currency)}/día`);
  d.font = Font.semiboldSystemFont(12);
  d.textColor = white;
  d.lineLimit = 1;
  d.minimumScaleFactor = 0.6;
  row.addSpacer();
  return w;
}

function buildWidget(state, forceFamily) {
  const family = forceFamily || config.widgetFamily || 'medium';
  if (LOCK_FAMILIES.includes(family)) return buildLockWidget(family, state);
  const { summary, error, needsSetup } = state;
  const small = family === 'small';
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(14, 16, 14, 16);
  w.url = small ? NEW_EXPENSE_URL : APP_URL;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  const row = w.addStack();
  row.centerAlignContent();
  const info = row.addStack();
  info.layoutVertically();
  if (!small) info.url = APP_URL;

  text(info, 'FinPep · Saldo', 12, C.t2);
  info.addSpacer(2);

  if (needsSetup || error || !summary || summary.month !== curMonth()) {
    const msg = needsSetup ? 'Tocá para configurar'
      : error ? error
      : !summary ? 'Abrí FinPep una vez para ver tu saldo acá'
      : 'Abrí FinPep para actualizar el mes';
    const t = text(info, msg, 13, C.t1, 'regular');
    t.lineLimit = 3;
    // Sin cuenta configurada, tocar el texto abre el script en Scriptable
    // (para pedir usuario y contraseña), no FinPep.
    if (needsSetup) { w.url = URLScheme.forRunningScript(); info.url = w.url; }
  } else {
    const saldo = summary.saldo || 0;
    const days = daysLeft();
    const perDay = saldo / Math.max(1, days);
    text(info, money(saldo, summary.currency), small ? 24 : 30, saldo < 0 ? C.neg : C.brandText, 'bold');
    info.addSpacer(4);
    text(info, `${money(perDay, summary.currency)} por día`, small ? 13 : 15, perDay < 0 ? C.neg : C.t1);
    text(info, days === 1 ? 'queda 1 día' : `quedan ${days} días`, 12, C.t3, 'regular');
  }

  if (small) {
    w.addSpacer();
    addButton(w, true);
  } else {
    row.addSpacer();
    addButton(row, false);
  }
  return w;
}

/* ---------- Arranque ---------- */
const KC_LAST = 'finpep-widget-last';

async function main() {
  let cred = readKC(KC_CRED);
  let previewLock = false;
  // Abierto desde Scriptable (no como widget): pedir o cambiar la cuenta.
  if (!config.runsInWidget) {
    if (!cred) cred = await askCredentials();
    else {
      const a = new Alert();
      a.title = 'FinPep';
      a.message = `Conectado como ${cred.user}.`;
      a.addAction('Ver el widget');
      a.addAction('Cambiar de cuenta');
      a.addAction('Ver el de bloqueo');
      a.addCancelAction('Cerrar');
      const r = await a.presentSheet();
      if (r === -1) return;
      if (r === 1) cred = await askCredentials();
      if (r === 2) previewLock = true;
    }
  }

  const state = { needsSetup: !cred };
  if (cred) {
    try {
      state.summary = await fetchSummary(cred);
      if (state.summary) Keychain.set(KC_LAST, JSON.stringify(state.summary));
    } catch (e) {
      // Sin conexión: muestra lo último que se leyó, si hay.
      const last = readKC(KC_LAST);
      if (last) state.summary = last;
      else state.error = `No se pudo actualizar: ${e.message}`;
    }
  }
  if (previewLock) {
    await buildWidget(state, 'accessoryRectangular').presentAccessoryRectangular();
    return;
  }
  const widget = buildWidget(state);
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
}

await main();
Script.complete();
