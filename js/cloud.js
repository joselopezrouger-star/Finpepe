'use strict';

/* Cloud — sincronización opcional con Supabase.
   La app funciona 100% offline con localStorage; si configurás un proyecto de
   Supabase e iniciás sesión, el estado se guarda también en la nube y se
   sincroniza entre dispositivos. Las credenciales (URL + anon key) las carga
   el usuario y viven en su navegador: nada queda en el repositorio. */
const Cloud = (() => {
  const CFG_KEY = 'finpepe:cloud';
  const TABLE = 'finance_state';

  // Proyecto de Supabase "de fábrica": si se completan estos dos valores acá,
  // ni Jose ni su novia necesitan pegar nada en Ajustes — la app se conecta
  // sola y solo queda iniciar sesión. Son datos PÚBLICOS por diseño (la
  // seguridad la da Row Level Security en la base), así que es seguro
  // dejarlos escritos en este archivo publicado en GitHub Pages.
  const DEFAULT_URL = 'https://fwldbohbsohuzxyxpqte.supabase.co';
  const DEFAULT_KEY = 'sb_publishable_XzLob0A3xYNNIgyXJNIwtA_hGkTbuAu';

  let client = null;
  let session = null;
  let onChange = () => {};
  let pushTimer = null;

  const available = () => typeof window !== 'undefined' && !!window.supabase;

  function config() {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(CFG_KEY)) || {}; }
    catch { stored = {}; }
    return {
      url: stored.url || DEFAULT_URL,
      anonKey: stored.anonKey || DEFAULT_KEY,
    };
  }
  function saveConfig(url, anonKey) {
    localStorage.setItem(CFG_KEY, JSON.stringify({ url: url.trim(), anonKey: anonKey.trim() }));
    client = null; // fuerza recrear el cliente
  }
  function clearConfig() {
    localStorage.removeItem(CFG_KEY);
    client = null;
    session = null;
  }
  function isConfigured() {
    const c = config();
    return !!(c.url && c.anonKey);
  }
  // El formulario de "pegar URL/key" en Ajustes solo tiene sentido si no hay
  // un proyecto de fábrica embebido — si ya viene configurado, no hace falta.
  const hasDefaults = () => !!(DEFAULT_URL && DEFAULT_KEY);

  function ensureClient() {
    if (client) return client;
    const c = config();
    if (!available() || !c.url || !c.anonKey) return null;
    try {
      client = window.supabase.createClient(c.url, c.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'finpepe:auth' },
      });
    } catch (e) {
      console.error('No se pudo crear el cliente de Supabase', e);
      return null;
    }
    return client;
  }

  /* Inicializa: recupera la sesión guardada y escucha cambios de auth. */
  async function init(cb) {
    if (cb) onChange = cb;
    const cl = ensureClient();
    if (!cl) return null;
    try {
      const { data } = await cl.auth.getSession();
      session = data.session || null;
      cl.auth.onAuthStateChange((_event, s) => {
        session = s || null;
        onChange();
      });
    } catch (e) {
      console.error('Error al iniciar sesión con Supabase', e);
    }
    return session;
  }

  const user = () => (session ? session.user : null);

  async function signUp(email, password) {
    const cl = ensureClient();
    if (!cl) throw new Error('Supabase no está configurado.');
    const { data, error } = await cl.auth.signUp({ email, password });
    if (error) throw error;
    session = data.session || session;
    return data;
  }

  async function signIn(email, password) {
    const cl = ensureClient();
    if (!cl) throw new Error('Supabase no está configurado.');
    const { data, error } = await cl.auth.signInWithPassword({ email, password });
    if (error) throw error;
    session = data.session || null;
    return data;
  }

  async function signOut() {
    const cl = ensureClient();
    if (!cl) return;
    await cl.auth.signOut();
    session = null;
  }

  // La URL actual sin hash/query: adonde tiene que volver Google después del
  // login. Tiene que estar agregada en Supabase → Authentication → URL
  // Configuration → Redirect URLs (además de configurar el provider Google).
  const currentUrl = () => window.location.href.split('#')[0].split('?')[0];

  async function signInWithGoogle() {
    const cl = ensureClient();
    if (!cl) throw new Error('Supabase no está configurado.');
    const { error } = await cl.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: currentUrl() },
    });
    if (error) throw error;
  }

  // Vincula Google a la cuenta YA logueada (en vez de crear una cuenta
  // nueva separada) para no perder los datos que ya están asociados al
  // usuario/contraseña actual.
  async function linkGoogle() {
    const cl = ensureClient();
    if (!cl || !user()) throw new Error('Iniciá sesión primero.');
    const { error } = await cl.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo: currentUrl() },
    });
    if (error) throw error;
  }

  function hasGoogle() {
    const u = user();
    return !!(u && u.identities && u.identities.some((i) => i.provider === 'google'));
  }

  /* Trae el documento remoto del usuario, o null si todavía no existe. */
  async function pull() {
    const cl = ensureClient();
    if (!cl || !user()) return null;
    const { data, error } = await cl
      .from(TABLE)
      .select('data, updated_at')
      .eq('user_id', user().id)
      .maybeSingle();
    if (error) throw error;
    return data ? { data: data.data, updatedAt: data.updated_at } : null;
  }

  /* Sube (upsert) el estado completo del usuario. */
  async function push(state) {
    const cl = ensureClient();
    if (!cl || !user()) return;
    const { error } = await cl.from(TABLE).upsert(
      { user_id: user().id, data: state, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
    if (error) throw error;
  }

  let lastError = null;
  function schedulePush(state) {
    if (!user()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      push(state).then(() => { lastError = null; })
        .catch((e) => { lastError = e; console.error('Fallo al sincronizar', e); });
    }, 1200);
  }

  /* ---------------- Hogar compartido (gastos en pareja) ---------------- */

  function randomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin caracteres ambiguos
    let s = '';
    for (let i = 0; i < 7; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  /* Hogar del usuario actual (o null) + lista de miembros ({user_id, email}). */
  async function getHousehold() {
    const cl = ensureClient();
    if (!cl || !user()) return null;
    const { data: rows, error } = await cl
      .from('household_members')
      .select('household_id, households(id, name, created_by)')
      .eq('user_id', user().id)
      .limit(1);
    if (error) throw error;
    if (!rows || !rows.length) return null;
    const household = rows[0].households;
    const { data: members, error: mErr } = await cl
      .from('household_members')
      .select('user_id, email')
      .eq('household_id', household.id);
    if (mErr) throw mErr;
    return { ...household, members: members || [] };
  }

  async function createHousehold(name) {
    const cl = ensureClient();
    if (!cl || !user()) throw new Error('Iniciá sesión primero.');
    const { data, error } = await cl.from('households')
      .insert({ name: name || 'Nuestro hogar', created_by: user().id })
      .select().single();
    if (error) throw error;
    const { error: mErr } = await cl.from('household_members')
      .insert({ household_id: data.id, user_id: user().id, email: user().email });
    if (mErr) throw mErr;
    return data;
  }

  async function createInvite(householdId) {
    const cl = ensureClient();
    if (!cl || !user()) throw new Error('Iniciá sesión primero.');
    const code = randomCode();
    const { error } = await cl.from('household_invites')
      .insert({ code, household_id: householdId, created_by: user().id });
    if (error) throw error;
    return code;
  }

  async function redeemInvite(code) {
    const cl = ensureClient();
    if (!cl || !user()) throw new Error('Iniciá sesión primero.');
    const { data, error } = await cl.rpc('redeem_household_invite', { invite_code: code.trim().toUpperCase() });
    if (error) throw error;
    return data; // household_id
  }

  async function leaveHousehold(householdId) {
    const cl = ensureClient();
    if (!cl || !user()) return;
    const { error } = await cl.from('household_members')
      .delete().eq('household_id', householdId).eq('user_id', user().id);
    if (error) throw error;
  }

  async function listSharedExpenses(householdId) {
    const cl = ensureClient();
    if (!cl) return [];
    const { data, error } = await cl.from('shared_expenses')
      .select('*').eq('household_id', householdId)
      .order('date', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function addSharedExpense(row) {
    const cl = ensureClient();
    if (!cl || !user()) throw new Error('Iniciá sesión primero.');
    const { error } = await cl.from('shared_expenses').insert({ ...row, created_by: user().id });
    if (error) throw error;
  }

  async function deleteSharedExpense(id) {
    const cl = ensureClient();
    if (!cl) return;
    const { error } = await cl.from('shared_expenses').delete().eq('id', id);
    if (error) throw error;
  }

  async function listSettlements(householdId) {
    const cl = ensureClient();
    if (!cl) return [];
    const { data, error } = await cl.from('shared_settlements')
      .select('*').eq('household_id', householdId)
      .order('date', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function addSettlement(row) {
    const cl = ensureClient();
    if (!cl || !user()) throw new Error('Iniciá sesión primero.');
    const { error } = await cl.from('shared_settlements').insert(row);
    if (error) throw error;
  }

  async function deleteSettlement(id) {
    const cl = ensureClient();
    if (!cl) return;
    const { error } = await cl.from('shared_settlements').delete().eq('id', id);
    if (error) throw error;
  }

  return {
    available, config, saveConfig, clearConfig, isConfigured, hasDefaults,
    init, user, signUp, signIn, signOut, signInWithGoogle, linkGoogle, hasGoogle, pull, push, schedulePush,
    getHousehold, createHousehold, createInvite, redeemInvite, leaveHousehold,
    listSharedExpenses, addSharedExpense, deleteSharedExpense,
    listSettlements, addSettlement, deleteSettlement,
    get lastError() { return lastError; },
  };
})();
