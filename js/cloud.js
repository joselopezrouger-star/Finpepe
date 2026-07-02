'use strict';

/* Cloud — sincronización opcional con Supabase.
   La app funciona 100% offline con localStorage; si configurás un proyecto de
   Supabase e iniciás sesión, el estado se guarda también en la nube y se
   sincroniza entre dispositivos. Las credenciales (URL + anon key) las carga
   el usuario y viven en su navegador: nada queda en el repositorio. */
const Cloud = (() => {
  const CFG_KEY = 'finpepe:cloud';
  const TABLE = 'finance_state';

  let client = null;
  let session = null;
  let onChange = () => {};
  let pushTimer = null;

  const available = () => typeof window !== 'undefined' && !!window.supabase;

  function config() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; }
    catch { return {}; }
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

  return {
    available, config, saveConfig, clearConfig, isConfigured,
    init, user, signUp, signIn, signOut, pull, push, schedulePush,
    get lastError() { return lastError; },
  };
})();
