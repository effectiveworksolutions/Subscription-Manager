// ═══════════════════════════════════════════════════════════════════════
//  SubTracker — Supabase auth + local-first cloud sync
//
//  Design:
//   • localStorage is the source of truth for the UI (instant, offline).
//   • When signed in and online, every change is pushed to Supabase.
//   • On sign-in / app open we pull remote rows and merge by updatedAt
//     (newest wins). Local-only rows get pushed; remote-only get added.
//   • Deletes made offline are queued and replayed on next sync.
//   • If config.js has no keys, Sync.enabled is false and the app runs
//     fully offline with no account UI shown.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  const CFG = window.SUBTRACKER_CONFIG || {};
  const TABLE = 'subscriptions';
  const PENDING_KEY = 'subtracker_pending_deletes';

  let client = null;
  let user = null;
  let syncing = false;
  let lastSyncAt = null;
  let lastError = null;

  // Hooks the app registers so sync can notify it.
  const hooks = { onAuth: () => {}, onPulled: () => {}, onStatus: () => {} };

  function configured() {
    return !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY
      && !CFG.SUPABASE_URL.includes('YOUR_') && !CFG.SUPABASE_ANON_KEY.includes('YOUR_'));
  }

  function init() {
    if (!configured()) return false;
    if (!window.supabase || !window.supabase.createClient) {
      lastError = 'Supabase library failed to load';
      return false;
    }
    client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    client.auth.onAuthStateChange((_event, session) => {
      user = session && session.user ? session.user : null;
      hooks.onAuth(user);
      if (user) pull().catch(() => {});
    });
    // Restore session on load
    client.auth.getSession().then(({ data }) => {
      user = data && data.session ? data.session.user : null;
      hooks.onAuth(user);
      if (user) pull().catch(() => {});
    });
    return true;
  }

  // ── Row mapping (JS camelCase ⇄ Postgres snake_case) ─────────────────
  function toRow(s) {
    return {
      id: s.id,
      user_id: user.id,
      name: s.name,
      emoji: s.emoji || null,
      category: s.category || 'other',
      price: s.price,
      cycle: s.cycle,
      status: s.status,
      start_date: s.startDate || null,
      payment_method: s.paymentMethod || null,
      url: s.url || null,
      notes: s.notes || null,
      updated_at: s.updatedAt || new Date().toISOString(),
    };
  }
  function fromRow(r) {
    return {
      id: r.id,
      name: r.name,
      emoji: r.emoji || null,
      category: r.category || 'other',
      price: Number(r.price),
      cycle: r.cycle,
      status: r.status,
      startDate: r.start_date || '',
      paymentMethod: r.payment_method || '',
      url: r.url || '',
      notes: r.notes || '',
      updatedAt: r.updated_at,
    };
  }

  // ── Pending deletes (offline queue) ──────────────────────────────────
  function getPending() { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; } }
  function setPending(arr) { localStorage.setItem(PENDING_KEY, JSON.stringify(arr)); }

  // ── Auth ─────────────────────────────────────────────────────────────
  async function signUp(email, password) {
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    // If email confirmation is on, session is null until they click the link.
    return { needsConfirm: !data.session };
  }
  async function signIn(email, password) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }
  async function resetPassword(email) {
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
    if (error) throw error;
  }
  async function signOut() {
    await client.auth.signOut();
    user = null;
    hooks.onAuth(null);
  }

  // ── Sync ─────────────────────────────────────────────────────────────
  function status(s, err) {
    lastError = err || null;
    hooks.onStatus({ state: s, lastSyncAt, error: lastError });
  }

  async function pull() {
    if (!client || !user || syncing) return;
    syncing = true; status('syncing');
    try {
      // 1. replay queued deletes first
      const pending = getPending();
      if (pending.length) {
        const { error } = await client.from(TABLE).delete().in('id', pending);
        if (!error) setPending([]);
      }
      // 2. fetch remote
      const { data: rows, error } = await client.from(TABLE).select('*').eq('user_id', user.id);
      if (error) throw error;
      const remote = (rows || []).map(fromRow);
      const local = window.App.getSubs();
      const byId = new Map(local.map(s => [s.id, s]));
      const toPush = [];
      const merged = [];

      // merge remote into local
      remote.forEach(r => {
        const l = byId.get(r.id);
        if (!l) { merged.push(r); return; }
        if ((l.updatedAt || '') > (r.updatedAt || '')) { merged.push(l); toPush.push(l); }
        else merged.push(r);
        byId.delete(r.id);
      });
      // anything left in byId is local-only → push
      byId.forEach(l => { merged.push(l); toPush.push(l); });

      if (toPush.length) {
        const { error: upErr } = await client.from(TABLE).upsert(toPush.map(toRow), { onConflict: 'id' });
        if (upErr) throw upErr;
      }
      window.App.setSubs(merged, /*fromSync*/ true);
      lastSyncAt = new Date().toISOString();
      status('ok');
      hooks.onPulled();
    } catch (e) {
      status('error', e.message || String(e));
    } finally {
      syncing = false;
    }
  }

  async function pushOne(sub) {
    if (!client || !user) return;
    try {
      const { error } = await client.from(TABLE).upsert(toRow(sub), { onConflict: 'id' });
      if (error) throw error;
      lastSyncAt = new Date().toISOString(); status('ok');
    } catch (e) { status('error', e.message || String(e)); }
  }

  async function pushAll(subs) {
    if (!client || !user || !subs.length) return;
    try {
      const { error } = await client.from(TABLE).upsert(subs.map(toRow), { onConflict: 'id' });
      if (error) throw error;
      lastSyncAt = new Date().toISOString(); status('ok');
    } catch (e) { status('error', e.message || String(e)); }
  }

  async function deleteOne(id) {
    if (!client || !user) return;
    try {
      const { error } = await client.from(TABLE).delete().eq('id', id);
      if (error) throw error;
      lastSyncAt = new Date().toISOString(); status('ok');
    } catch (e) {
      // queue for later
      const p = getPending(); if (!p.includes(id)) p.push(id); setPending(p);
      status('error', e.message || String(e));
    }
  }

  async function deleteAll() {
    if (!client || !user) return;
    try { await client.from(TABLE).delete().eq('user_id', user.id); } catch {}
  }

  window.Sync = {
    get enabled() { return configured() && !!client; },
    get user() { return user; },
    get lastSyncAt() { return lastSyncAt; },
    get lastError() { return lastError; },
    get configured() { return configured(); },
    init, signUp, signIn, signOut, resetPassword,
    pull, pushOne, pushAll, deleteOne, deleteAll,
    on(name, fn) { if (hooks[name] !== undefined) hooks[name] = fn; },
  };
})();
