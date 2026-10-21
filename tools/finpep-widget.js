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
  super: Color.dynamic(new Color('#C9A21A'), new Color('#E6C84F')),
  s2: Color.dynamic(new Color('#EEF1F5'), new Color('#1A2133')),
  // Versiones apagadas para el widget de inicio (los anillos y sus puntos).
  ringOut: new Color('#3BAE8C'),
  ringIn: new Color('#B9A25A'),
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
// opts: colores de cada anillo (out/in) y de la pista de fondo (track).
// Sin opts, todo blanco con distinta opacidad (pantalla de bloqueo).
function ringsImage(pctOut, pctIn, size, opts = {}) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const c = size / 2;
  const ring = (r, width, pct, hex, alpha, trackHex, trackAlpha) => {
    const stroke = (frac, color, a) => {
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
      ctx.setStrokeColor(new Color(color, a));
      ctx.setLineWidth(width);
      ctx.strokePath();
      // Puntas redondeadas (solo en el trazo opaco: en los translúcidos el
      // punto encima se vería más claro).
      if (a >= 1 && frac < 1) {
        ctx.setFillColor(new Color(color, a));
        for (const p of [pts[0], pts[pts.length - 1]]) ctx.fillEllipse(new Rect(p.x - width / 2, p.y - width / 2, width, width));
      }
    };
    stroke(1, trackHex, trackAlpha);
    stroke(Math.max(0, Math.min(100, pct)) / 100, hex, alpha);
  };
  const w1 = size * (opts.thin ? 0.075 : 0.11), w2 = size * (opts.thin ? 0.06 : 0.085);
  const gap = opts.thin ? size * 0.035 : 3;
  ring(c - w1 / 2 - 1, w1, pctOut, opts.out || '#FFFFFF', 1, opts.track || '#FFFFFF', opts.track ? 0.28 : 0.22);
  ring(c - w1 - gap - w2 / 2, w2, pctIn, opts.in || '#FFFFFF', opts.in ? 1 : 0.7, opts.track || '#FFFFFF', opts.track ? 0.28 : 0.154);
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
  w.setPadding(small ? 14 : 16, small ? 14 : 18, small ? 14 : 16, small ? 14 : 16);
  w.url = small ? NEW_EXPENSE_URL : APP_URL;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  if (needsSetup || error || !summary || summary.month !== curMonth()) {
    text(w, 'FinPep · Saldo', 12, C.t2);
    w.addSpacer(4);
    const msg = needsSetup ? 'Tocá para configurar'
      : error ? error
      : !summary ? 'Abrí FinPep una vez para ver tu saldo acá'
      : 'Abrí FinPep para actualizar el mes';
    const t = text(w, msg, 13, C.t1, 'regular');
    t.lineLimit = 3;
    // Sin cuenta configurada, tocar abre el script en Scriptable (para pedir
    // usuario y contraseña), no FinPep.
    if (needsSetup) w.url = URLScheme.forRunningScript();
    w.addSpacer();
    if (!needsSetup) addPill(w);
    return w;
  }

  const cur = summary.currency;
  const saldo = summary.saldo || 0;
  const days = daysLeft();
  const perDay = saldo / Math.max(1, days);
  const pctOut = summary.pctLeft != null ? summary.pctLeft : 0;
  // Colores apagados: el número manda, los anillos acompañan.
  const ringOpts = { out: '#3BAE8C', in: '#B9A25A', track: '#7D889C', thin: true };
  const legend = (stack, color, strong, rest) => {
    const r = stack.addStack();
    r.centerAlignContent();
    const dot = r.addText('●');
    dot.font = Font.systemFont(8);
    dot.textColor = color;
    r.addSpacer(5);
    const b = r.addText(strong);
    b.font = Font.semiboldSystemFont(12);
    b.textColor = C.t1;
    r.addSpacer(3);
    const t = r.addText(rest);
    t.font = Font.regularSystemFont(12);
    t.textColor = C.t2;
    t.lineLimit = 1;
  };
  const amountColor = saldo < 0 ? C.neg : C.t1;

  if (small) {
    // Chico: anillos y botón arriba, saldo y por día abajo. Todo el widget
    // abre el formulario de gasto (iOS no deja dos botones en el chico).
    const top = w.addStack();
    top.centerAlignContent();
    const img = top.addImage(ringsImage(pctOut, monthLeftPct(), 88, ringOpts));
    img.imageSize = new Size(44, 44);
    top.addSpacer();
    addPill(top, true);
    w.addSpacer();
    text(w, 'Saldo', 11, C.t2, 'regular');
    text(w, money(saldo, cur), 22, amountColor, 'bold');
    text(w, `${money(perDay, cur)} por día`, 12, perDay < 0 ? C.neg : C.t2, 'regular');
    return w;
  }

  // Mediano: anillos a la izquierda con el "por día" adentro; a la derecha
  // el saldo, la leyenda y el botón abajo a la derecha.
  const row = w.addStack();
  row.centerAlignContent();
  const ring = row.addStack();
  ring.size = new Size(112, 112);
  ring.backgroundImage = ringsImage(pctOut, monthLeftPct(), 224, ringOpts);
  ring.layoutVertically();
  ring.url = APP_URL;
  ring.setPadding(0, 20, 0, 20);
  ring.addSpacer();
  const v = ring.addStack();
  v.addSpacer();
  const vt = v.addText(money(perDay, cur));
  vt.font = Font.semiboldRoundedSystemFont(14);
  vt.textColor = perDay < 0 ? C.neg : C.t1;
  vt.lineLimit = 1;
  vt.minimumScaleFactor = 0.6;
  v.addSpacer();
  const l = ring.addStack();
  l.addSpacer();
  const lt = l.addText('por día');
  lt.font = Font.regularSystemFont(11);
  lt.textColor = C.t2;
  l.addSpacer();
  ring.addSpacer();

  row.addSpacer(16);
  const info = row.addStack();
  info.layoutVertically();
  info.url = APP_URL;
  text(info, 'Saldo del mes', 12, C.t2, 'regular');
  info.addSpacer(1);
  text(info, money(saldo, cur), 26, amountColor, 'bold');
  info.addSpacer(6);
  legend(info, C.ringOut, `${pctOut}%`, 'balance');
  info.addSpacer(2);
  legend(info, C.ringIn, `${days}`, days === 1 ? 'día restante' : 'días restantes');
  info.addSpacer(10);
  const bottom = info.addStack();
  bottom.addSpacer();
  addPill(bottom);
  return w;
}

// Botón "+ Gasto" (gris suave con el texto verde): abre el formulario de
// nuevo gasto. compact = solo el "+" (widget chico).
function addPill(stack, compact) {
  const b = stack.addStack();
  b.backgroundColor = C.s2;
  b.cornerRadius = 15;
  b.size = new Size(compact ? 32 : 0, 30);
  b.setPadding(0, compact ? 0 : 12, 0, compact ? 0 : 14);
  b.centerAlignContent();
  b.url = NEW_EXPENSE_URL;
  if (compact) b.addSpacer();
  const t = b.addText(compact ? '+' : '+  Gasto');
  t.font = compact ? Font.semiboldSystemFont(18) : Font.semiboldSystemFont(14);
  t.textColor = C.brandText;
  if (compact) b.addSpacer();
  return b;
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
