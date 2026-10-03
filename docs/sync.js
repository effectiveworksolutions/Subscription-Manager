// ═══════════════════════════════════════════════════════════════════════
//  SubTracker — Supabase auth + local-first cloud sync + shared lists
//
//  Design:
//   • localStorage is the source of truth for the UI (instant, offline).
//   • Every signed-in user belongs to exactly one *list*. By default it is
//     their own; accepting an invite moves them (and their subscriptions)
//     into a friend's list so both people see and edit the same thing.
//   • Every change is upserted to Supabase. Deletes are "tombstones"
//     (deleted_at set) so other devices/people learn about them instead
//     of resurrecting the row on the next merge.
//   • On sign-in / app open / realtime change we pull the list and merge
//     by updatedAt (newest wins). Local-only rows get pushed.
//   • If config.js has no keys, Sync.configured is false and the app runs
//     fully offline with no account UI shown.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  const CFG = window.SUBTRACKER_CONFIG || {};
  const TABLE = 'subscriptions';

  let client = null;
  let user = null;
  let listId = null;
  let syncing = false, pullAgain = false;
  let lastSyncAt = null;
  let lastError = null;
  let channel = null;
  let pullTimer = null;
  let readyResolve; const ready = new Promise(r => { readyResolve = r; });

  // Hooks the app registers so sync can notify it.
  const hooks = { onAuth: () => {}, onPulled: () => {}, onStatus: () => {}, onList: () => {} };

  function configured() {
    return !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY
      && !CFG.SUPABASE_URL.includes('YOUR_') && !CFG.SUPABASE_ANON_KEY.includes('YOUR_'));
  }

  function init() {
    if (!configured()) { readyResolve(null); return false; }
    if (!window.supabase || !window.supabase.createClient) {
      lastError = 'Supabase library failed to load';
      readyResolve(null);
      return false;
    }
    client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    client.auth.onAuthStateChange((event, session) => {
      const next = session && session.user ? session.user : null;
      const changed = (next && next.id) !== (user && user.id);
      user = next;
      if (event === 'INITIAL_SESSION') readyResolve(user);
      if (changed || event === 'INITIAL_SESSION' || event === 'SIGNED_IN') afterAuth(changed || event === 'INITIAL_SESSION');
    });
    return true;
  }

  async function afterAuth(fresh) {
    hooks.onAuth(user);
    if (!user) { listId = null; unsubscribe(); hooks.onList(null); return; }
    if (fresh || !listId) {
      try { await ensureList(); } catch (e) { status('error', e.message || String(e)); }
    }
    subscribe();
    pull().catch(() => {});
  }

  // ── Lists ────────────────────────────────────────────────────────────
  const LIST_KEY = 'subtracker_list_id';
  async function ensureList() {
    const { data, error } = await client.rpc('ensure_list');
    if (error) throw error;
    const prev = listId, stored = localStorage.getItem(LIST_KEY);
    // Moved to a different list (joined one, left one, or removed by the owner):
    // drop the stale local copy so the old list's rows are not pushed into the new one.
    if ((prev && prev !== data) || (stored && stored !== data)) window.App.setAll([], true);
    listId = data;
    localStorage.setItem(LIST_KEY, data);
    if (prev !== data) { subscribe(); hooks.onList(listId); }
    return listId;
  }

  async function listInfo() {
    if (!client || !user) return null;
    const { data, error } = await client.rpc('my_list_info');
    if (error) throw error;
    return data;
  }
  async function createInvite() {
    const { data, error } = await client.rpc('create_invite');
    if (error) throw error;
    return data; // code
  }
  async function acceptInvite(code) {
    await pull(); // everything on this device goes to the cloud first, so it comes along
    const { data, error } = await client.rpc('accept_invite', { p_code: code });
    if (error) throw error;
    await ensureList(); // list changed → local copy cleared
    await pull(true);
    return data; // { list_id, owner_email, members }
  }
  async function leaveList() {
    const { error } = await client.rpc('leave_list');
    if (error) throw error;
    await ensureList(); // new personal list → local copy cleared (subscriptions stay with the shared list)
    await pull(true);
  }
  async function removeMember(userId) {
    const { error } = await client.rpc('remove_member', { p_user: userId });
    if (error) throw error;
  }
  async function renameList(name) {
    const { error } = await client.rpc('rename_list', { p_name: name });
    if (error) throw error;
  }

  // ── Profile (email reminder prefs) ───────────────────────────────────
  async function getProfile() {
    if (!client || !user) return null;
    const { data, error } = await client.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) throw error;
    return data;
  }
  async function setProfile(patch) {
    if (!client || !user) return;
    const row = Object.assign({ id: user.id, updated_at: new Date().toISOString() }, patch);
    const { error } = await client.from('profiles').upsert(row, { onConflict: 'id' });
    if (error) throw error;
  }

  // ── Realtime: pull when anyone in the list changes something ─────────
  function subscribe() {
    if (!client || !listId) return;
    if (channel && channel._listId === listId) return;
    unsubscribe();
    try {
      channel = client.channel('list-' + listId)
        .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `list_id=eq.${listId}` }, () => schedulePull())
        .subscribe();
      channel._listId = listId;
    } catch (e) { channel = null; }
  }
  function unsubscribe() {
    if (channel) { try { client.removeChannel(channel); } catch {} channel = null; }
  }
  function schedulePull() {
    clearTimeout(pullTimer);
    pullTimer = setTimeout(() => pull().catch(() => {}), 700);
  }

  // ── Row mapping (JS camelCase ⇄ Postgres snake_case) ─────────────────
  function toRow(s) {
    return {
      id: s.id,
      user_id: user.id,
      list_id: listId,
      name: s.name,
      emoji: s.emoji || null,
      category: s.category || 'other',
      price: s.price || 0,
      cycle: s.cycle || 'monthly',
      status: s.status || 'active',
      start_date: s.startDate || null,
      payment_method: s.paymentMethod || null,
      url: s.url || null,
      domain: s.domain || null,
      notes: s.notes || null,
      deleted_at: s.deletedAt || null,
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
      domain: r.domain || '',
      notes: r.notes || '',
      deletedAt: r.deleted_at || null,
      updatedAt: r.updated_at,
    };
  }

  // ── Auth ─────────────────────────────────────────────────────────────
  async function signUp(email, password) {
    const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: CFG.APP_URL || location.href.split('#')[0].split('?')[0] } });
    if (error) throw error;
    // If email confirmation is on, session is null until they click the link.
    return { needsConfirm: !data.session };
  }
  async function signIn(email, password) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }
  async function resetPassword(email) {
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: CFG.APP_URL || location.href.split('#')[0].split('?')[0] });
    if (error) throw error;
  }
  async function signOut() {
    unsubscribe();
    await client.auth.signOut();
    user = null; listId = null;
    localStorage.removeItem(LIST_KEY); // a later sign-in merges this device's data (documented behaviour)
    hooks.onAuth(null); hooks.onList(null);
  }

  // ── Sync ─────────────────────────────────────────────────────────────
  function status(s, err) {
    lastError = err || null;
    hooks.onStatus({ state: s, lastSyncAt, error: lastError });
  }

  // replace=true → remote wins outright (used right after joining/leaving a list)
  async function pull(replace) {
    if (!client || !user) return;
    if (syncing) {
      if (!replace) { pullAgain = true; return; }
      // a replace-pull must run: wait for the in-flight one to finish
      for (let i = 0; i < 50 && syncing; i++) await new Promise(r => setTimeout(r, 100));
    }
    if (!listId) { try { await ensureList(); } catch (e) { status('error', e.message || String(e)); return; } }
    syncing = true; status('syncing');
    try {
      const { data: rows, error } = await client.from(TABLE).select('*')
        .or(`list_id.eq.${listId},and(user_id.eq.${user.id},list_id.is.null)`);
      if (error) throw error;
      const remote = (rows || []).map(fromRow);
      const local = replace ? [] : window.App.getAll(); // live + tombstones
      const byId = new Map(local.map(s => [s.id, s]));
      const toPush = [];
      const merged = [];

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
      window.App.setAll(merged, /*fromSync*/ true);
      lastSyncAt = new Date().toISOString();
      status('ok');
      hooks.onPulled();
    } catch (e) {
      status('error', e.message || String(e));
    } finally {
      syncing = false;
      if (pullAgain) { pullAgain = false; schedulePull(); }
    }
  }

  async function pushOne(sub) {
    if (!client || !user) return;
    if (!listId) { try { await ensureList(); } catch (e) { status('error', e.message || String(e)); return; } }
    try {
      const { error } = await client.from(TABLE).upsert(toRow(sub), { onConflict: 'id' });
      if (error) throw error;
      lastSyncAt = new Date().toISOString(); status('ok');
    } catch (e) { status('error', e.message || String(e)); }
  }

  async function pushAll(subs) {
    if (!client || !user || !subs.length) return;
    if (!listId) { try { await ensureList(); } catch (e) { status('error', e.message || String(e)); return; } }
    try {
      const { error } = await client.from(TABLE).upsert(subs.map(toRow), { onConflict: 'id' });
      if (error) throw error;
      lastSyncAt = new Date().toISOString(); status('ok');
    } catch (e) { status('error', e.message || String(e)); }
  }

  // Deletes are tombstones: the app passes the sub with deletedAt set.
  const deleteOne = pushOne;

  window.Sync = {
    get enabled() { return configured() && !!client; },
    get user() { return user; },
    get listId() { return listId; },
    get lastSyncAt() { return lastSyncAt; },
    get lastError() { return lastError; },
    get configured() { return configured(); },
    get ready() { return ready; },
    init, signUp, signIn, signOut, resetPassword,
    pull, pushOne, pushAll, deleteOne,
    ensureList, listInfo, createInvite, acceptInvite, leaveList, removeMember, renameList,
    getProfile, setProfile,
    on(name, fn) { if (hooks[name] !== undefined) hooks[name] = fn; },
  };
})();
