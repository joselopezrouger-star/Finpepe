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

function buildWidget({ summary, error, needsSetup }) {
  const family = config.widgetFamily || 'medium';
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
  // Abierto desde Scriptable (no como widget): pedir o cambiar la cuenta.
  if (!config.runsInWidget) {
    if (!cred) cred = await askCredentials();
    else {
      const a = new Alert();
      a.title = 'FinPep';
      a.message = `Conectado como ${cred.user}.`;
      a.addAction('Ver el widget');
      a.addAction('Cambiar de cuenta');
      a.addCancelAction('Cerrar');
      const r = await a.presentSheet();
      if (r === -1) return;
      if (r === 1) cred = await askCredentials();
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
  const widget = buildWidget(state);
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
}

await main();
Script.complete();
