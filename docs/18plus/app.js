// ═══════════════════════════════════════════════════════════════════════
//  SubTracker — application logic
// ═══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const CFG = window.SUBTRACKER_CONFIG || {};
  const CUR = CFG.CURRENCY || '$';
  const APP_URL = CFG.APP_URL || (location.protocol.startsWith('http') && !/localhost|127\.0\.0\.1/.test(location.hostname) ? location.origin + location.pathname : '');
  const EMOJI_MAP = window.EMOJI_MAP || {};
  const SERVICE_LIBRARY = window.SERVICE_LIBRARY || [];
  const SERVICE_ALIASES = window.SERVICE_ALIASES || {};
  const GROUP_LABELS = window.GROUP_LABELS || {};
  const ADULT_CATS = window.ADULT_CATEGORIES || ['adult'];
  const HAS_ADULT = SERVICE_LIBRARY.some(s => s.adult); // 18+ section only exists if the library ships adult entries
  const CATEGORIES = Object.keys(EMOJI_MAP);
  const CAT_COLORS = ['#a855f7', '#34d399', '#f59e0b', '#38bdf8', '#f472b6', '#fb923c', '#a3e635', '#22d3ee', '#e879f9', '#facc15', '#4ade80', '#94a3b8'];
  const DAY = 86400000;

  // ── State ────────────────────────────────────────────────────────────
  let subs = [];          // live subscriptions
  let tombs = [];         // deleted ones, kept so other devices learn about the delete
  let settings = { notifyEnabled: false, notifyDays: 3, onboarded: false, adultUnlocked: false, authPromptAt: 0, pendingInvite: '' };
  let view = 'home';
  let editId = null, selectedService = null, tileQuery = '';
  let filterStatus = 'all', filterCycle = 'all', sortBy = 'renewal';
  let syncState = { state: 'off', lastSyncAt: null, error: null };
  let listInfo = null, listInfoFor = null, profile = null, profileFor = null, exactAlarm = null;
  let lastVisPull = 0;

  // ── Storage + migration ──────────────────────────────────────────────
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function load() {
    try { subs = JSON.parse(localStorage.getItem('subs') || '[]') || []; } catch { subs = []; }
    try { tombs = JSON.parse(localStorage.getItem('subtracker_tombstones') || '[]') || []; } catch { tombs = []; }
    try { Object.assign(settings, JSON.parse(localStorage.getItem('subtracker_settings') || '{}')); } catch {}
    let changed = false;
    subs = subs.map(s => {
      const n = { ...s };
      if (typeof n.id !== 'string' || n.id.length < 20) { n.id = uuid(); changed = true; }
      if (!n.updatedAt) { n.updatedAt = new Date().toISOString(); changed = true; }
      if (typeof n.price !== 'number') { n.price = parseFloat(n.price) || 0; changed = true; }
      if (n.deletedAt) { tombs.push(n); changed = true; return null; }
      return n;
    }).filter(Boolean);
    if (changed) saveLocal();
  }
  function saveLocal() {
    localStorage.setItem('subs', JSON.stringify(subs));
    const cutoff = Date.now() - 60 * DAY;
    tombs = tombs.filter(t => new Date(t.deletedAt || t.updatedAt || 0).getTime() > cutoff);
    localStorage.setItem('subtracker_tombstones', JSON.stringify(tombs));
  }
  function saveSettings() { localStorage.setItem('subtracker_settings', JSON.stringify(settings)); }

  // ── Helpers ──────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => CUR + (Math.round(n * 100) / 100).toFixed(2);
  const money0 = n => CUR + Math.round(n).toLocaleString();
  const isMobile = () => window.innerWidth < 700;
  const isBillable = s => s.status === 'active' || s.status === 'trial';
  const toMonthly = s => s.cycle === 'yearly' ? s.price / 12 : s.price;
  const toYearly = s => s.cycle === 'yearly' ? s.price : s.price * 12;
  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const plugin = name => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) || null;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  function nextRenewalDate(sd, cycle) {
    if (!sd) return null;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const d = new Date(sd + 'T00:00:00');
    if (isNaN(d)) return null;
    let guard = 0;
    if (cycle === 'yearly') { while (d <= now && guard++ < 200) d.setFullYear(d.getFullYear() + 1); }
    else { while (d <= now && guard++ < 1200) d.setMonth(d.getMonth() + 1); }
    return d;
  }
  function daysUntil(d) { if (!d) return 9999; const n = new Date(); n.setHours(0, 0, 0, 0); return Math.round((d - n) / DAY); }
  const fmtDate = d => d ? d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' }) : '—';
  const fmtDateLong = d => d ? d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const isoDate = d => d.toISOString().slice(0, 10);
  const badgeHtml = st => `<span class="badge badge-${esc(st)}">${esc(st)}</span>`;

  // Service library lookup (exact name → alias → logo domain)
  function svcFor(s) {
    if (!s) return null;
    const key = String(s.name || s).toLowerCase().trim();
    let svc = SERVICE_LIBRARY.find(x => x.name.toLowerCase() === key);
    if (!svc && SERVICE_ALIASES[key]) svc = SERVICE_LIBRARY.find(x => x.name === SERVICE_ALIASES[key]);
    if (!svc && s.domain) svc = SERVICE_LIBRARY.find(x => x.domain && x.domain === s.domain);
    return svc || null;
  }
  function hostOf(url) { try { return new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, ''); } catch { return ''; } }
  function logoDomain(s) {
    if (s.domain) return s.domain;
    const svc = svcFor(s); if (svc && svc.domain) return svc.domain;
    if (s.url) return hostOf(s.url);
    return '';
  }

  // ── Logos: fetched from the service's own site, emoji fallback ───────
  const FAVICON = d => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=128`;
  const FAVICON2 = d => `https://icons.duckduckgo.com/ip3/${encodeURIComponent(d)}.ico`;
  function logoHtml(s) {
    const emoji = (s && (s.emoji || EMOJI_MAP[s.category])) || '📦';
    const d = s ? logoDomain(s) : '';
    if (!d) return `<span class="icon-fallback">${esc(emoji)}</span>`;
    return `<img class="brand-img" src="${esc(FAVICON(d))}" data-alt="${esc(FAVICON2(d))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="App.logoOk(this)" onerror="App.logoErr(this)"/><span class="icon-fallback hidden">${esc(emoji)}</span>`;
  }
  function logoErr(img) {
    const alt = img.getAttribute('data-alt');
    if (alt) { img.removeAttribute('data-alt'); img.src = alt; return; }
    img.classList.add('hidden');
    const f = img.nextElementSibling; if (f) f.classList.remove('hidden');
    const box = img.parentElement; if (box) box.classList.remove('has-img');
  }
  function logoOk(img) {
    // Google returns a tiny generic globe when it has no icon → try the next source
    if (img.naturalWidth && img.naturalWidth <= 16 && img.getAttribute('data-alt')) { logoErr(img); return; }
    const box = img.parentElement; if (box) box.classList.add('has-img');
  }

  function nextPayHtml(s) {
    if (s.status === 'paused' || s.status === 'cancelled')
      return `<div class="next-pay next-pay-paused"><span class="next-pay-count">${esc(s.status)}</span></div>`;
    if (!s.startDate) return `<div class="next-pay next-pay-paused"><span class="next-pay-count">no date</span></div>`;
    const rd = nextRenewalDate(s.startDate, s.cycle), days = daysUntil(rd);
    let cls, cnt;
    if (days === 0) { cls = 'urgent'; cnt = 'today'; }
    else if (days <= 3) { cls = 'urgent'; cnt = `in ${days}d`; }
    else if (days <= 7) { cls = 'soon'; cnt = `in ${days}d`; }
    else if (days <= 30) { cls = 'ok'; cnt = `in ${days}d`; }
    else { cls = 'far'; cnt = `in ${days}d`; }
    return `<div class="next-pay next-pay-${cls}">${money(s.price)} · ${fmtDate(rd)}<span class="next-pay-count">${cnt}</span></div>`;
  }

  function toast(msg, ms = 2400) {
    const t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove('show'), ms);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); return true; } catch { return false; }
  }
  const isTouchPhone = () => isMobile() && (matchMedia('(pointer: coarse)').matches || /android|iphone|ipad|ipod/i.test(navigator.userAgent));
  async function shareText(title, text, url) {
    const S = plugin('Share');
    if (S && isNative()) { try { await S.share({ title, text, url, dialogTitle: title }); return true; } catch { return false; } }
    if (navigator.share && isTouchPhone()) { try { await navigator.share({ title, text: url ? `${text}\n${url}` : text, url }); return true; } catch (e) { if (e && e.name === 'AbortError') return false; } }
    openShareSheet(title, text, url);
    return true;
  }
  // Desktop share sheet: the link itself plus one-tap ways to send it
  function openShareSheet(title, text, url) {
    const full = url ? `${text}\n${url}` : text;
    const mail = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(full)}`;
    const wa = `https://wa.me/?text=${encodeURIComponent(full)}`;
    const body = $('share-body');
    body.innerHTML = `
      <div class="sheet-title">${esc(title)}</div>
      <p class="age-text">${esc(text)}</p>
      ${url ? `<div class="invite-link share-link" id="share-link-text">${esc(url)}</div>` : ''}
      <div class="btn-row">
        <button class="btn-primary" data-action="share-copy" data-text="${esc(url || full)}">Copy link</button>
        <a class="btn-secondary btn-link" href="${esc(mail)}">Email</a>
        <a class="btn-secondary btn-link" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>
      </div>
      <div class="auth-note">Paste the link into any message. On a phone it opens straight in the browser and can be added to the home screen like an app.</div>
      <button class="btn-secondary btn-block" style="margin-top:12px" data-close="share-overlay">Done</button>`;
    $('share-overlay').classList.add('open');
  }

  // ── Mutations (single path: local → cloud → notify → render) ─────────
  function commit(sub) {
    sub.updatedAt = new Date().toISOString();
    delete sub.deletedAt;
    tombs = tombs.filter(t => t.id !== sub.id);
    const i = subs.findIndex(s => s.id === sub.id);
    if (i >= 0) subs[i] = sub; else subs.push(sub);
    saveLocal();
    if (window.Sync && window.Sync.user) window.Sync.pushOne(sub);
    scheduleNotifications();
    render();
  }
  function remove(id) {
    const s = subs.find(x => x.id === id); if (!s) return;
    const now = new Date().toISOString();
    const t = { ...s, deletedAt: now, updatedAt: now };
    subs = subs.filter(x => x.id !== id);
    tombs = tombs.filter(x => x.id !== id); tombs.push(t);
    saveLocal();
    if (window.Sync && window.Sync.user) window.Sync.deleteOne(t);
    scheduleNotifications();
    render();
  }

  // Exposed for sync.js and inline logo handlers
  window.App = {
    getSubs: () => subs,
    getAll: () => subs.concat(tombs),
    setAll: (arr, fromSync) => {
      subs = arr.filter(s => !s.deletedAt);
      tombs = arr.filter(s => s.deletedAt);
      saveLocal();
      if (fromSync) { scheduleNotifications(); render(); }
    },
    setSubs: (arr, fromSync) => window.App.setAll(arr.concat(tombs), fromSync),
    logoErr, logoOk,
    showDiscoverResults: (items, email) => { openDiscover(''); disc.state = 'results'; disc.items = items; disc.email = email || ''; disc.stats = { scanned: items.length }; renderDiscover(); },
  };

  // ── Notifications ────────────────────────────────────────────────────
  function hashInt(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h) % 2147483647; }
  const webPerm = () => ('Notification' in window) ? Notification.permission : 'unsupported';

  async function requestNotifyPermission() {
    const LN = plugin('LocalNotifications');
    if (LN) {
      try {
        let r = await LN.checkPermissions();
        if (r.display !== 'granted') r = await LN.requestPermissions();
        return r.display === 'granted';
      } catch { return false; }
    }
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const p = await Notification.requestPermission(); return p === 'granted';
  }

  async function showWebNotification(title, opts) {
    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, opts); return true;
      }
    } catch {}
    try { new Notification(title, opts); return true; } catch { return false; }
  }

  async function scheduleNotifications() {
    if (!settings.notifyEnabled) return;
    const LN = plugin('LocalNotifications');
    if (!LN) return; // web path uses checkDueSoon() on open instead
    try {
      const pending = await LN.getPending();
      if (pending.notifications && pending.notifications.length) await LN.cancel(pending);
      const list = [];
      subs.filter(isBillable).forEach(s => {
        const rd = nextRenewalDate(s.startDate, s.cycle); if (!rd) return;
        const at = new Date(rd); at.setDate(at.getDate() - settings.notifyDays); at.setHours(9, 0, 0, 0);
        if (at > new Date()) {
          list.push({
            id: hashInt(s.id),
            title: `${s.name} renews ${settings.notifyDays === 0 ? 'today' : 'in ' + plural(settings.notifyDays, 'day')}`,
            body: `${money(s.price)}${s.paymentMethod ? ' · ' + s.paymentMethod : ''}`,
            schedule: { at, allowWhileIdle: true },
            smallIcon: 'ic_stat_icon',
          });
        }
      });
      if (list.length) await LN.schedule({ notifications: list });
    } catch (e) { /* non-fatal */ }
  }

  function checkDueSoon() {
    // Web fallback: fires when the app is opened
    if (!settings.notifyEnabled || isNative() || webPerm() !== 'granted') return;
    let notified = {}; try { notified = JSON.parse(localStorage.getItem('subtracker_notified') || '{}'); } catch {}
    const todayKey = isoDate(new Date());
    subs.filter(isBillable).forEach(s => {
      const rd = nextRenewalDate(s.startDate, s.cycle); const days = daysUntil(rd);
      if (days >= 0 && days <= settings.notifyDays) {
        const key = s.id + ':' + isoDate(rd);
        if (notified[key] !== todayKey) {
          showWebNotification(`${s.name} renews ${days === 0 ? 'today' : 'in ' + plural(days, 'day')}`, {
            body: `${money(s.price)}${s.paymentMethod ? ' · ' + s.paymentMethod : ''}`, icon: 'icon-192.png', badge: 'icon-192.png', tag: key,
          });
          notified[key] = todayKey;
        }
      }
    });
    localStorage.setItem('subtracker_notified', JSON.stringify(notified));
  }

  async function testNotify() {
    const ok = await requestNotifyPermission();
    if (!ok) { toast(isNative() ? 'Allow notifications for SubTracker in your phone settings' : 'Notifications are blocked for this site'); renderSettings(); return; }
    const LN = plugin('LocalNotifications');
    if (LN) {
      try { await LN.schedule({ notifications: [{ id: 999999, title: 'SubTracker', body: 'Reminders are working 🎉', smallIcon: 'ic_stat_icon' }] }); toast('Sent — check your notification shade'); }
      catch (e) { toast('Could not send: ' + (e.message || e)); }
      return;
    }
    const shown = await showWebNotification('SubTracker', { body: 'Reminders are working 🎉', icon: 'icon-192.png', badge: 'icon-192.png' });
    toast(shown ? 'Sent — check your notifications' : 'Could not show a notification here');
  }

  async function refreshExactAlarm() {
    const LN = plugin('LocalNotifications'); if (!LN || !LN.checkExactNotificationSetting) return;
    try { const r = await LN.checkExactNotificationSetting(); const v = r.exact_alarm || 'granted'; if (v !== exactAlarm) { exactAlarm = v; if (view === 'settings') renderSettings(); } } catch {}
  }

  // ── Filtering / sorting ──────────────────────────────────────────────
  function currentFilters() {
    if (isMobile()) return { q: ($('m-search') || {}).value || '', fs: filterStatus, fc: filterCycle, sb: sortBy };
    return {
      q: ($('d-search') || {}).value || '',
      fs: ($('d-status') || {}).value || 'all',
      fc: ($('d-cycle') || {}).value || 'all',
      sb: ($('d-sort') || {}).value || 'renewal',
    };
  }
  function getFiltered() {
    const { q, fs, fc, sb } = currentFilters(); const ql = q.toLowerCase();
    const ORDER = { active: 0, trial: 1, paused: 2, cancelled: 3 };
    return subs.filter(s =>
      (!ql || s.name.toLowerCase().includes(ql) || (s.paymentMethod || '').toLowerCase().includes(ql) || (s.category || '').includes(ql)) &&
      (fs === 'all' || s.status === fs) && (fc === 'all' || s.cycle === fc)
    ).sort((a, b) => {
      if (sb === 'name') return a.name.localeCompare(b.name);
      if (sb === 'status') { const d = (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9); return d || a.name.localeCompare(b.name); }
      if (sb === 'cost-asc') return toMonthly(a) - toMonthly(b);
      if (sb === 'cost-desc') return toMonthly(b) - toMonthly(a);
      return daysUntil(nextRenewalDate(a.startDate, a.cycle)) - daysUntil(nextRenewalDate(b.startDate, b.cycle));
    });
  }

  // ── Render: summary ──────────────────────────────────────────────────
  function renderSummary(filtered) {
    const pool = filtered || subs;
    const billable = pool.filter(isBillable);
    const monthly = billable.reduce((a, s) => a + toMonthly(s), 0);
    const yearly = billable.reduce((a, s) => a + toYearly(s), 0);
    const dueSoon = billable.filter(s => { const d = daysUntil(nextRenewalDate(s.startDate, s.cycle)); return d >= 0 && d <= 7; }).length;
    const isFiltered = filtered && filtered.length !== subs.length;
    const html = `
      <div class="metric"><div class="metric-label">Monthly</div><div class="metric-value">${money(monthly)}</div><div class="metric-sub">${billable.length} ${isFiltered ? 'shown' : 'active'}</div></div>
      <div class="metric"><div class="metric-label">Annual</div><div class="metric-value">${money0(yearly)}</div><div class="metric-sub">${isFiltered ? 'shown subs' : 'excl. paused'}</div></div>
      <div class="metric"><div class="metric-label">Due soon</div><div class="metric-value">${dueSoon}</div><div class="metric-sub">within 7 days</div></div>`;
    if ($('m-summary')) $('m-summary').innerHTML = html;
    if ($('d-summary')) $('d-summary').innerHTML = html;
  }

  function reviewBannerHtml() {
    if (subs.filter(isBillable).length < 2) return '';
    return `<button class="review-banner" data-action="review">
      <span class="review-banner-ic">✨</span>
      <span class="review-banner-text"><b>AI review</b><small>Spot duplicates, bundles and cheaper plans</small></span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
    </button>`;
  }

  // ── Render: home list ────────────────────────────────────────────────
  function emptyHtml() {
    const noData = subs.length === 0;
    return `<div class="empty">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="opacity:.35"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
      <div class="empty-title">${noData ? 'No subscriptions yet' : 'Nothing matches'}</div>
      <div class="empty-sub">${noData ? 'Tap <b style="color:var(--accent-text)">+</b> to add your first one' : 'Try changing your filters or search'}</div>
    </div>`;
  }

  function renderHome() {
    const filtered = getFiltered();
    renderSummary(filtered);
    const count = `${filtered.length} subscription${filtered.length !== 1 ? 's' : ''}`;
    const dupBanner = dupBannerHtml(), dups = dupIds();
    if ($('m-review')) $('m-review').innerHTML = dupBanner + reviewBannerHtml();
    if ($('d-review')) $('d-review').innerHTML = dupBanner + reviewBannerHtml();
    const dupBadge = s => dups.has(s.id) ? `<span class="badge badge-duplicate">duplicate?</span>` : '';

    if ($('m-label')) $('m-label').textContent = filtered.length ? count : '';
    if ($('m-list')) {
      $('m-list').innerHTML = filtered.length ? filtered.map(s => `
        <div class="m-card" data-id="${s.id}">
          <div class="sub-icon" style="width:48px;height:48px">${logoHtml(s)}</div>
          <div class="m-card-body">
            <div class="m-card-name">${esc(s.name)}</div>
            <div class="m-card-meta">${esc(s.category)}${s.paymentMethod ? ` · 💳 ${esc(s.paymentMethod)}` : ''}</div>
            ${nextPayHtml(s)}
          </div>
          <div class="m-card-right">
            <div style="text-align:right">
              <div class="price-main">${money(s.price)}/${s.cycle === 'yearly' ? 'yr' : 'mo'}</div>
              ${s.cycle === 'yearly' ? `<div class="price-per">${money(toMonthly(s))}/mo</div>` : ''}
            </div>
            ${dupBadge(s)}${badgeHtml(s.status)}
          </div>
        </div>`).join('') : emptyHtml();
    }

    if ($('d-label')) $('d-label').textContent = filtered.length ? count : '';
    if ($('d-list')) {
      $('d-list').innerHTML = filtered.length ? filtered.map(s => `
        <div class="d-card" data-id="${s.id}">
          <div class="sub-icon" style="width:46px;height:46px">${logoHtml(s)}</div>
          <div class="d-card-info">
            <div class="d-card-name">${esc(s.name)}</div>
            <div class="d-card-meta">${esc(s.category)}</div>
            ${s.paymentMethod ? `<div class="d-card-pay">💳 ${esc(s.paymentMethod)}</div>` : ''}
            ${nextPayHtml(s)}
          </div>
          <div class="d-card-right">
            <div class="d-price">
              <div class="price-main">${money(s.price)}/${s.cycle === 'yearly' ? 'yr' : 'mo'}</div>
              ${s.cycle === 'yearly' ? `<div class="price-per">${money(toMonthly(s))}/mo</div>` : ''}
            </div>
            ${dupBadge(s)}${badgeHtml(s.status)}
            <button class="d-icon-btn" data-edit="${s.id}" title="Edit">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            ${s.url ? `<a class="d-icon-link" href="${esc(s.url)}" target="_blank" rel="noopener" data-stop title="Manage">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>` : ''}
          </div>
        </div>`).join('') : emptyHtml();
    }
  }

  // ── Render: insights ─────────────────────────────────────────────────
  function donutSvg(segments, total) {
    const R = 50, r = 34, cx = 60, cy = 60;
    let angle = -Math.PI / 2, paths = '';
    segments.forEach(seg => {
      const frac = total ? seg.value / total : 0; if (frac <= 0) return;
      const a2 = angle + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle);
      const x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
      const x3 = cx + r * Math.cos(a2), y3 = cy + r * Math.sin(a2);
      const x4 = cx + r * Math.cos(angle), y4 = cy + r * Math.sin(angle);
      if (frac >= 0.9999) {
        paths += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${seg.color}" stroke-width="${R - r}"/>`;
      } else {
        paths += `<path d="M${x1} ${y1} A${R} ${R} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${r} ${r} 0 ${large} 0 ${x4} ${y4} Z" fill="${seg.color}"/>`;
      }
      angle = a2;
    });
    return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">${paths}
      <text x="60" y="56" text-anchor="middle" font-family="Inter,sans-serif" font-size="9" fill="#8888aa" letter-spacing="1">MONTHLY</text>
      <text x="60" y="72" text-anchor="middle" font-family="Bebas Neue,Impact,sans-serif" font-size="18" fill="#f0f0f8" letter-spacing="1">${money(total)}</text></svg>`;
  }

  function renderInsights() {
    const billable = subs.filter(isBillable);
    const monthly = billable.reduce((a, s) => a + toMonthly(s), 0);
    const yearly = billable.reduce((a, s) => a + toYearly(s), 0);
    const avg = billable.length ? monthly / billable.length : 0;
    const top = [...billable].sort((a, b) => toMonthly(b) - toMonthly(a));
    const yearlyCount = billable.filter(s => s.cycle === 'yearly').length;

    const byCat = {};
    billable.forEach(s => { byCat[s.category || 'other'] = (byCat[s.category || 'other'] || 0) + toMonthly(s); });
    const segs = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ label: k, value: v, color: CAT_COLORS[i % CAT_COLORS.length] }));

    const horizon = 30; const days = {};
    billable.forEach(s => {
      const rd = nextRenewalDate(s.startDate, s.cycle); if (!rd) return;
      const d = daysUntil(rd); if (d < 0 || d > horizon) return;
      const k = isoDate(rd); (days[k] = days[k] || { date: rd, items: [] }).items.push(s);
    });
    const dayKeys = Object.keys(days).sort();
    const next30Total = dayKeys.reduce((a, k) => a + days[k].items.reduce((b, s) => b + s.price, 0), 0);

    const html = subs.length === 0 ? `<div class="empty"><div class="empty-title">No data yet</div><div class="empty-sub">Add a few subscriptions and your insights will appear here.</div></div>` : `
      <div class="ins-grid">
        <div class="metric"><div class="metric-label">Per month</div><div class="metric-value">${money(monthly)}</div></div>
        <div class="metric"><div class="metric-label">Per year</div><div class="metric-value">${money0(yearly)}</div></div>
        <div class="metric"><div class="metric-label">Avg / sub</div><div class="metric-value">${money(avg)}</div></div>
        <div class="metric"><div class="metric-label">Next 30 days</div><div class="metric-value">${money(next30Total)}</div></div>
      </div>
      ${reviewBannerHtml()}
      <div class="ins-two">
        <div class="ins-card">
          <h3>Spend by category <small>${billable.length} active · ${yearlyCount} yearly</small></h3>
          ${segs.length ? `<div class="donut-wrap">${donutSvg(segs, monthly)}
            <div class="donut-legend">${segs.map(sg => `<div class="legend-row"><span class="legend-dot" style="background:${sg.color}"></span><span class="legend-name">${esc(sg.label)}</span><span class="legend-val">${money(sg.value)}</span><span class="legend-pct">${monthly ? Math.round(sg.value / monthly * 100) : 0}%</span></div>`).join('')}</div>
          </div>` : `<div class="empty-sub">No active subscriptions.</div>`}
        </div>
        <div class="ins-card">
          <h3>Biggest costs <small>monthly equivalent</small></h3>
          ${top.length ? top.slice(0, 6).map(s => { const pct = top[0] ? toMonthly(s) / toMonthly(top[0]) * 100 : 0; return `
            <div class="bar-row">
              <div class="sub-icon">${logoHtml(s)}</div>
              <div class="bar-info">
                <div class="bar-top"><span>${esc(s.name)}</span><span>${money(toMonthly(s))}/mo${s.cycle === 'yearly' ? ` · ${money(s.price)}/yr` : ''}</span></div>
                <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
              </div>
            </div>`; }).join('') : `<div class="empty-sub">No active subscriptions.</div>`}
        </div>
      </div>
      <div class="ins-card">
        <h3>Coming up <small>next ${horizon} days</small></h3>
        ${dayKeys.length ? `<div class="timeline">${dayKeys.map(k => { const d = days[k]; const dayTotal = d.items.reduce((a, s) => a + s.price, 0); return `
          <div class="tl-day">
            <div class="tl-date"><b>${d.date.getDate()}</b><small>${d.date.toLocaleDateString('en-AU', { month: 'short' })}</small></div>
            <div class="tl-items">${d.items.map(s => `<div class="tl-item"><div class="sub-icon">${logoHtml(s)}</div><span>${esc(s.name)}</span><b>${money(s.price)}</b></div>`).join('')}
              ${d.items.length > 1 ? `<div class="tl-total">Day total <b>${money(dayTotal)}</b></div>` : ''}</div>
          </div>`; }).join('')}</div>
          <div class="tl-total" style="padding-top:12px;border-top:1px solid var(--border);margin-top:4px">Total next ${horizon} days <b>${money(next30Total)}</b></div>`
          : `<div class="empty-sub">Nothing due in the next ${horizon} days.</div>`}
      </div>`;
    if ($('m-insights')) $('m-insights').innerHTML = html;
    if ($('d-insights')) $('d-insights').innerHTML = html;
  }

  // ── AI review (rules-based, runs on this device) ─────────────────────
  const OVERLAP_RULES = {
    music: { min: 2, keep: 1 }, ai: { min: 2, keep: 1 }, storage: { min: 2, keep: 1 }, video: { min: 3, keep: 2 },
    passwords: { min: 2, keep: 1 }, vpn: { min: 2, keep: 1 }, audiobooks: { min: 2, keep: 1 }, news: { min: 3, keep: 2 },
    mindfulness: { min: 2, keep: 1 }, 'fitness-app': { min: 2, keep: 1 }, gym: { min: 2, keep: 1 }, dating: { min: 2, keep: 1 },
    delivery: { min: 2, keep: 1 }, notes: { min: 2, keep: 1 }, office: { min: 2, keep: 1 }, design: { min: 3, keep: 2 },
    mobile: { min: 3, keep: 2 }, adult: { min: 2, keep: 1 }, sport: { min: 2, keep: 1 }, learning: { min: 2, keep: 1 },
    'video-calls': { min: 2, keep: 1 }, website: { min: 2, keep: 1 }, accounting: { min: 2, keep: 1 },
  };
  const CAT_GROUP = { streaming: 'video', music: 'music', ai: 'ai', storage: 'storage', gaming: 'gaming', news: 'news', security: 'security', telco: 'mobile', fitness: 'gym' };
  const groupOf = s => { const svc = svcFor(s); return (svc && svc.group) || CAT_GROUP[s.category] || null; };
  const canonName = s => { const svc = svcFor(s); return svc ? svc.name : s.name; };
  const names = list => list.map(s => s.name).reduce((a, n, i, arr) => a + (i === 0 ? '' : i === arr.length - 1 ? ' and ' : ', ') + n, '');

  function reviewSubs() {
    const live = subs.filter(isBillable);
    const F = [];
    const push = f => F.push(f);

    // 0. The same subscription entered twice
    findDuplicateGroups().forEach(g => {
      push({ kind: 'duplicate', icon: '⚠️', subs: g.members, savingLow: g.wasted, savingHigh: g.wasted, dup: true,
        title: `${g.name} is on your list ${g.members.length} times`,
        detail: g.exact.length ? `${g.exact.length + 1} entries with the same price — your totals count it ${g.exact.length + 1} times. Keep one and remove the rest.` : `Two entries with different prices or plans — if it's the same subscription, keep the right one.` });
    });

    // 1. Overlapping services of the same kind
    const byGroup = {};
    live.forEach(s => { const g = groupOf(s); if (g) (byGroup[g] = byGroup[g] || []).push(s); });
    Object.entries(byGroup).forEach(([g, list]) => {
      const rule = OVERLAP_RULES[g]; if (!rule || list.length < rule.min) return;
      const sorted = [...list].sort((a, b) => toMonthly(b) - toMonthly(a));
      const extra = list.length - rule.keep;
      const low = sorted.slice(rule.keep).reduce((a, s) => a + toMonthly(s), 0);   // drop the cheapest ones
      const high = sorted.slice(0, extra).reduce((a, s) => a + toMonthly(s), 0);   // drop the priciest ones
      const label = GROUP_LABELS[g] || g;
      push({
        kind: 'overlap', icon: '🔁', subs: list, savingLow: low, savingHigh: high,
        title: `${list.length} ${label} subscriptions`,
        detail: g === 'video'
          ? `You're paying for ${names(list)}. Most people only watch one or two at a time — pause or cancel the ones you're not using this month, and rotate when a new show drops.`
          : `You're paying for ${names(list)}. They do the same job — keep your favourite${rule.keep > 1 ? 's' : ''} and cancel the rest.`,
      });
    });

    // 2. Something you pay for twice because it's already included elsewhere
    live.forEach(s => {
      const svc = svcFor(s); if (!svc || !svc.includes) return;
      svc.includes.forEach(inc => {
        const dup = live.find(o => o !== s && canonName(o) === inc); if (!dup) return;
        push({ kind: 'bundle', icon: '🎁', subs: [s, dup], savingLow: toMonthly(dup), savingHigh: toMonthly(dup),
          title: `${inc} is already included in ${svc.name}`,
          detail: `${svc.name} comes with ${inc}, but you're also paying ${money(toMonthly(dup))}/mo for it separately. Cancel the separate ${inc} plan.` });
      });
    });
    // YouTube Premium includes YouTube Music → a second music service is optional
    const yt = live.find(s => canonName(s) === 'YouTube Premium');
    const musicOthers = live.filter(s => groupOf(s) === 'music' && canonName(s) !== 'YouTube Music');
    if (yt && musicOthers.length) {
      const cheapest = [...musicOthers].sort((a, b) => toMonthly(a) - toMonthly(b))[0];
      push({ kind: 'bundle', icon: '🎁', subs: [yt, ...musicOthers], savingLow: toMonthly(cheapest), savingHigh: musicOthers.reduce((a, s) => a + toMonthly(s), 0),
        title: 'YouTube Premium already includes YouTube Music',
        detail: `You have YouTube Premium and ${names(musicOthers)}. YouTube Music is part of Premium at no extra cost — worth a try before the next ${musicOthers[0].name} bill.` });
    }
    // Microsoft 365 includes 1 TB OneDrive → other storage may be redundant
    const m365 = live.find(s => canonName(s) === 'Microsoft 365');
    const storageOthers = live.filter(s => groupOf(s) === 'storage' && canonName(s) !== 'OneDrive');
    if (m365 && storageOthers.length) {
      push({ kind: 'bundle', icon: '🎁', subs: [m365, ...storageOthers], savingLow: Math.min(...storageOthers.map(toMonthly)), savingHigh: storageOthers.reduce((a, s) => a + toMonthly(s), 0),
        title: 'Microsoft 365 includes 1 TB of OneDrive storage',
        detail: `You're also paying for ${names(storageOthers)}. If you mainly need space for files and photos, OneDrive is already covered by Microsoft 365.` });
    }
    // Apple One
    const appleBits = live.filter(s => ['Apple Music', 'Apple TV+', 'Apple Arcade', 'iCloud+'].includes(canonName(s)));
    if (appleBits.length >= 2 && !live.find(s => canonName(s) === 'Apple One')) {
      const total = appleBits.reduce((a, s) => a + toMonthly(s), 0);
      push({ kind: 'bundle', icon: '🍎', subs: appleBits, savingLow: 0, savingHigh: Math.max(0, total * 0.3), estimate: true,
        title: 'Apple One could bundle these',
        detail: `You pay ${money(total)}/mo for ${names(appleBits)} separately. Apple One bundles Music, TV+, Arcade and iCloud+ for one price — usually cheaper once you have two or more.` });
    }
    // Foxtel group: Binge + Kayo (+ Foxtel)
    const fox = live.filter(s => ['Binge', 'Kayo Sports', 'Foxtel'].includes(canonName(s)));
    if (fox.length >= 2) {
      push({ kind: 'bundle', icon: '📺', subs: fox, savingLow: 0, savingHigh: fox.reduce((a, s) => a + toMonthly(s), 0) * 0.15, estimate: true,
        title: `${names(fox)} are ${fox.length === 2 ? 'both' : 'all'} Foxtel Group services`,
        detail: 'They are often cheaper together — check Hubbl "stack and save" bundles and Foxtel packages before renewing them separately.' });
    }

    // 3. Monthly plans where a yearly plan is known to be cheaper
    const annualable = live.filter(s => s.cycle !== 'yearly' && s.status === 'active' && s.price >= 5 && (svcFor(s) || {}).annual);
    if (annualable.length) {
      const total = annualable.reduce((a, s) => a + toMonthly(s), 0);
      push({ kind: 'annual', icon: '📅', subs: annualable, savingLow: total * 0.12, savingHigh: total * 0.2, estimate: true,
        title: `Switch ${annualable.length === 1 ? annualable[0].name : annualable.length + ' subscriptions'} to yearly billing`,
        detail: `${names(annualable)} offer${annualable.length === 1 ? 's' : ''} a yearly plan, typically 12–20% cheaper than paying monthly. Only worth it for the ones you'll definitely keep all year.` });
    }

    // 4. Trials about to convert
    live.filter(s => s.status === 'trial').forEach(s => {
      const d = daysUntil(nextRenewalDate(s.startDate, s.cycle));
      if (d <= 7) push({ kind: 'trial', icon: '⏳', subs: [s], savingLow: 0, savingHigh: toMonthly(s), estimate: true,
        title: `${s.name} trial ends ${d === 0 ? 'today' : d < 0 ? 'soon' : 'in ' + plural(d, 'day')}`,
        detail: `You'll be charged ${money(s.price)}/${s.cycle === 'yearly' ? 'yr' : 'mo'} unless you cancel first. Decide now while it's easy.` });
    });

    // 5. Big yearly renewal coming up
    live.filter(s => s.cycle === 'yearly' && s.price >= 100).forEach(s => {
      const d = daysUntil(nextRenewalDate(s.startDate, s.cycle));
      if (d >= 0 && d <= 30) push({ kind: 'info', icon: '💸', subs: [s], savingLow: 0, savingHigh: 0,
        title: `${s.name} renews for ${money(s.price)} ${d === 0 ? 'today' : 'in ' + plural(d, 'day')}`,
        detail: `${s.name} bills ${money(s.price)} for the year on ${fmtDateLong(nextRenewalDate(s.startDate, s.cycle))}. Yearly plans are hard to refund — make sure you still want it.` });
    });

    // 6. Small subscriptions add up
    const small = live.filter(s => toMonthly(s) < 10);
    if (small.length >= 3) {
      const total = small.reduce((a, s) => a + toMonthly(s), 0);
      push({ kind: 'info', icon: '🪙', subs: small, savingLow: 0, savingHigh: 0,
        title: `${small.length} small subscriptions add up to ${money0(total * 12)} a year`,
        detail: `${names(small)} each cost under ${money(10)}/mo, but together that's ${money(total)}/mo. Worth a quick look at which ones you actually open.` });
    }

    // 7. Paused subscriptions you may have forgotten
    const paused = subs.filter(s => s.status === 'paused');
    if (paused.length) push({ kind: 'info', icon: '⏸️', subs: paused, savingLow: 0, savingHigh: 0,
      title: `${plural(paused.length, 'paused subscription')}`,
      detail: `${names(paused)} ${paused.length === 1 ? 'is' : 'are'} paused. If you're not coming back, cancel properly so a pause doesn't quietly restart.` });

    // 8. One service dominates
    const monthly = live.reduce((a, s) => a + toMonthly(s), 0);
    const top = [...live].sort((a, b) => toMonthly(b) - toMonthly(a))[0];
    if (top && live.length >= 3 && toMonthly(top) / monthly >= 0.35) push({ kind: 'info', icon: '🏔️', subs: [top], savingLow: 0, savingHigh: 0,
      title: `${top.name} is ${Math.round(toMonthly(top) / monthly * 100)}% of your spend`,
      detail: `${money(toMonthly(top))}/mo of your ${money(monthly)}/mo goes to ${top.name}. Check whether a cheaper tier (fewer screens, ads, less storage) would do.` });

    // Rank: real savings first, then hints, then info
    const order = { bundle: 0, overlap: 1, trial: 2, annual: 3, info: 4 };
    F.sort((a, b) => (order[a.kind] - order[b.kind]) || (b.savingLow - a.savingLow));

    // Total: count each subscription's saving once (largest finding wins)
    const counted = new Set(); let totalLow = 0, totalHigh = 0;
    [...F].sort((a, b) => b.savingLow - a.savingLow).forEach(f => {
      if (!f.savingLow && !f.savingHigh) return;
      if (f.subs.some(s => counted.has(s.id))) return;
      f.subs.forEach(s => counted.add(s.id));
      totalLow += f.savingLow; totalHigh += f.savingHigh;
    });
    return { findings: F, totalLow, totalHigh, checked: live.length, monthly };
  }

  function openReview() {
    const r = reviewSubs();
    const savingTxt = f => !f.savingHigh ? '' : f.savingLow && Math.abs(f.savingHigh - f.savingLow) < 0.5 ? `Save ${money(f.savingLow)}/mo`
      : f.savingLow ? `Save ${money(f.savingLow)}–${money(f.savingHigh)}/mo` : `Up to ${money(f.savingHigh)}/mo`;
    $('review-body').innerHTML = `
      <div class="review-head">
        <div class="review-total">
          <div class="metric-label">Potential saving</div>
          <div class="review-amount">${r.totalHigh ? `${money0(r.totalLow * 12)}${r.totalHigh - r.totalLow > 1 ? '–' + money0(r.totalHigh * 12) : ''}<small>/yr</small>` : money0(0) + '<small>/yr</small>'}</div>
          <div class="metric-sub">${r.totalHigh ? `${money(r.totalLow)}${r.totalHigh - r.totalLow > 1 ? '–' + money(r.totalHigh) : ''} a month · ${plural(r.checked, 'active subscription')} checked` : `${plural(r.checked, 'active subscription')} checked`}</div>
        </div>
      </div>
      ${r.findings.length ? r.findings.map(f => `
        <div class="finding finding-${f.kind}">
          <div class="finding-top">
            <div class="finding-ic">${f.icon}</div>
            <div class="finding-main">
              <div class="finding-title">${esc(f.title)}</div>
              ${savingTxt(f) ? `<div class="finding-save ${f.estimate ? 'est' : ''}">${savingTxt(f)}${f.estimate ? ' · estimate' : ''}</div>` : ''}
            </div>
          </div>
          <div class="finding-detail">${esc(f.detail)}</div>
          <div class="finding-subs">${f.dup ? `<button class="finding-chip accent" data-action="duplicates-from-review">⚠️ Fix duplicates</button>` : f.subs.map(s => `<button class="finding-chip" data-edit="${s.id}"><span class="sub-icon">${logoHtml(s)}</span>${esc(s.name)} <b>${money(toMonthly(s))}/mo</b></button>`).join('')}</div>
        </div>`).join('')
      : `<div class="finding finding-ok"><div class="finding-top"><div class="finding-ic">✅</div><div class="finding-main"><div class="finding-title">No obvious savings — nice work</div></div></div>
          <div class="finding-detail">We checked for duplicate services, things you're paying for twice, bundles, cheaper yearly plans and trials about to convert. Add more subscriptions and run it again any time.</div></div>`}
      <div class="review-foot">Runs privately on your device using rules about overlapping services, bundles and plan types. Savings are estimates — check each service before cancelling.</div>
      <button class="btn-secondary btn-block" style="margin-top:14px" data-close="review-overlay">Done</button>`;
    $('review-overlay').classList.add('open');
  }

  // ── Render: settings ─────────────────────────────────────────────────
  function loadCloudExtras() {
    const S = window.Sync; if (!S || !S.user) { listInfo = null; profile = null; return; }
    const key = (S.user.id || '') + ':' + (S.listId || '');
    if (listInfoFor !== key) {
      listInfoFor = key;
      S.listInfo().then(i => { listInfo = i; if (view === 'settings') renderSettings(); }).catch(() => {});
    }
    if (profileFor !== S.user.id) {
      profileFor = S.user.id;
      S.getProfile().then(p => { profile = p; if (view === 'settings') renderSettings(); }).catch(() => {});
    }
    refreshExactAlarm();
  }

  const chev = `<svg class="set-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>`;
  const row = (action, label, sub, right) => `<div class="set-row clickable" data-action="${action}"><div class="set-row-main"><div class="set-row-label">${label}</div>${sub ? `<div class="set-row-sub">${sub}</div>` : ''}</div>${right || chev}</div>`;

  function renderSettings() {
    const S = window.Sync; const u = S && S.user;
    const canSync = S && S.configured;
    loadCloudExtras();
    const lastSync = syncState.lastSyncAt ? new Date(syncState.lastSyncAt).toLocaleString('en-AU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : 'never';
    const dot = !canSync ? 'off' : syncState.state === 'error' ? 'err' : u ? 'on' : 'off';
    const native = !!plugin('LocalNotifications');
    const perm = webPerm();
    const notifyBlocked = !native && (perm === 'denied' || perm === 'unsupported');
    const members = (listInfo && listInfo.members) || [];
    const shared = members.length > 1;
    const myRole = listInfo && listInfo.role;
    const emailOn = !!(profile && profile.email_reminders);

    const html = `
      <div class="set-wrap">
      <div class="set-group">
        <div class="set-group-title">Account & sync</div>
        ${!canSync ? `
          <div class="account-card">
            <div class="avatar off">☁️</div>
            <div class="account-info"><div class="account-name">Cloud sync not set up</div><div class="account-sub">Add Supabase keys to config.js to enable accounts</div></div>
          </div>` : u ? `
          <div class="account-card">
            <div class="avatar">${esc((u.email || '?')[0])}</div>
            <div class="account-info"><div class="account-name">${esc(u.email)}</div><div class="account-sub"><span class="sync-dot ${dot}"></span>${syncState.state === 'syncing' ? 'Syncing…' : syncState.state === 'error' ? 'Sync error' : 'Synced ' + lastSync}</div></div>
          </div>
          ${row('sync-now', 'Sync now', syncState.error ? esc(syncState.error) : shared ? 'Pull the latest from everyone on your list' : 'Pull latest from all your devices', `<svg class="set-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>`)}
          ${row('sign-out', 'Sign out', 'Your data stays on this device', '<span class="set-row-val danger">Sign out</span>')}` : `
          <div class="account-card">
            <div class="avatar off">👤</div>
            <div class="account-info"><div class="account-name">Not signed in</div><div class="account-sub">Sign in to sync across your phone and computer</div></div>
          </div>
          ${row('auth', 'Sign in or create account', 'Free · email and password')}`}
      </div>

      ${window.Discover ? `
      <div class="set-group">
        <div class="set-group-title">Find subscriptions</div>
        ${row('discover', 'Find subscriptions from your email', isNative() ? 'Gmail or Outlook · opens in your browser, syncs back here' : 'Connect Gmail or Outlook · we read the receipts, you pick what to add', '<span class="set-row-val accent">✉️</span>')}
        ${row('discover-paste', 'Paste a receipt email', 'iCloud, Yahoo, work mail — any mailbox')}
        ${(settings.mailboxes || []).length ? `<div class="set-row"><div class="set-row-main"><div class="set-row-label">Scanned mailboxes</div><div class="set-row-sub">${esc((settings.mailboxes || []).map(m => m.email).join(', '))}</div></div></div>` : ''}
      </div>` : ''}

      ${canSync ? `
      <div class="set-group">
        <div class="set-group-title">Share & invite</div>
        ${row('invite-friend', 'Invite a friend to SubTracker', 'Send them a link to try the app')}
        ${u ? `
          ${row('share-list', shared ? 'Invite someone else to this list' : 'Share my list with someone', shared ? 'They see and edit the same subscriptions' : 'Co-own one list — e.g. a partner or housemate')}
          ${row('join-list', 'Join someone\'s list', 'Enter the invite code they sent you')}
          ${listInfo ? `
          <div class="set-row"><div class="set-row-main"><div class="set-row-label">${shared ? esc(listInfo.name || 'Shared list') : 'Your list'}</div><div class="set-row-sub">${shared ? `Shared with ${members.length - 1} ${members.length - 1 === 1 ? 'person' : 'people'}` : 'Only you can see it'}</div></div>${myRole === 'owner' && shared ? `<span class="set-row-val">Owner</span>` : ''}</div>
          ${shared ? members.map(m => `
            <div class="set-row member-row">
              <div class="avatar sm ${m.user_id === u.id ? '' : 'alt'}">${esc(((m.email || '?')[0]))}</div>
              <div class="set-row-main"><div class="set-row-label">${esc(m.email || 'Pending')}${m.user_id === u.id ? ' <small class="muted">(you)</small>' : ''}</div><div class="set-row-sub">${m.role === 'owner' ? 'Owner' : 'Can add, edit and delete'}</div></div>
              ${myRole === 'owner' && m.user_id !== u.id ? `<button class="link-btn danger" data-action="remove-member" data-user="${esc(m.user_id)}">Remove</button>` : ''}
            </div>`).join('') : ''}
          ${shared && myRole !== 'owner' ? row('leave-list', 'Leave this list', 'You\'ll start a fresh, empty list of your own', '<span class="set-row-val danger">Leave</span>') : ''}` : ''}` : `
          ${row('auth-signup', 'Share my list with someone', 'Create a free account first — then you can co-own a list')}`}
      </div>` : ''}

      <div class="set-group">
        <div class="set-group-title">Payment reminders</div>
        <div class="set-row">
          <div class="set-row-main"><div class="set-row-label">Remind me before renewals</div><div class="set-row-sub">${native ? 'Notifications on this phone, even when the app is closed' : perm === 'denied' ? 'Blocked — allow notifications for this site in your browser' : perm === 'unsupported' ? 'Not supported in this browser' : 'Shows when you open the app · install the app for background alerts'}</div></div>
          <label class="toggle"><input type="checkbox" id="set-notify" ${settings.notifyEnabled ? 'checked' : ''} ${notifyBlocked ? 'disabled' : ''}/><span class="track"></span></label>
        </div>
        ${native && exactAlarm === 'denied' ? row('exact-alarm', 'Allow exact-time reminders', 'Android may otherwise delay reminders by a few hours', '<span class="set-row-val accent">Allow</span>') : ''}
        ${canSync ? `
        <div class="set-row">
          <div class="set-row-main"><div class="set-row-label">Email reminders</div><div class="set-row-sub">${u ? `Daily email to ${esc(u.email)} when renewals are due` : 'Sign in to get reminders by email'}</div></div>
          <label class="toggle"><input type="checkbox" id="set-email" ${emailOn ? 'checked' : ''} ${u ? '' : 'disabled'}/><span class="track"></span></label>
        </div>` : ''}
        <div class="set-row">
          <div class="set-row-main"><div class="set-row-label">Days before</div><div class="set-row-sub">Applies to phone and email reminders</div></div>
          <select id="set-notify-days">${[0, 1, 2, 3, 5, 7, 14].map(n => `<option value="${n}" ${settings.notifyDays === n ? 'selected' : ''}>${n === 0 ? 'On the day' : plural(n, 'day')}</option>`).join('')}</select>
        </div>
        ${row('test-notify', 'Send a test notification', notifyBlocked ? 'Unblock notifications in your browser first' : '')}
      </div>

      ${HAS_ADULT ? `<div class="set-group">
        <div class="set-group-title">Service picker</div>
        <div class="set-row">
          <div class="set-row-main"><div class="set-row-label">Show adults-only services</div><div class="set-row-sub">${settings.adultUnlocked ? 'Unlocked · 18+ confirmed on this device' : 'Hidden until you confirm you\'re 18 or older'}</div></div>
          <label class="toggle"><input type="checkbox" id="set-adult" ${settings.adultUnlocked ? 'checked' : ''}/><span class="track"></span></label>
        </div>
      </div>` : ''}

      <div class="set-group">
        <div class="set-group-title">Your data</div>
        ${row('export-json', 'Back up to file', 'JSON · can be restored into SubTracker', dlIcon)}
        ${row('export-csv', 'Export to spreadsheet', 'CSV · opens in Excel or Google Sheets', dlIcon)}
        ${row('import', 'Restore from backup', 'Import a JSON file · merges with existing', ulIcon)}
        ${row('clear', 'Delete all data', `${plural(subs.length, 'subscription')} on this device${u ? (shared ? ' and on the shared list' : ' and in the cloud') : ''}`, '<span class="set-row-val danger">Delete</span>')}
        <input type="file" id="import-file" accept=".json,application/json" class="hidden"/>
      </div>

      <div class="about"><b>SubTracker${CFG.EDITION === '18plus' ? ' 18+' : ''}</b> v${esc(CFG.APP_VERSION || '1.1.0')}<br>Your data lives on your device${u ? (shared ? ', in your private cloud account and with the people you share your list with' : ' and in your private cloud account') : ''}. Nobody else can see it.<br><a href="privacy.html" target="_blank" rel="noopener">Privacy policy</a></div>
      </div>`;
    if ($('m-settings')) $('m-settings').innerHTML = html;
    if ($('d-settings')) $('d-settings').innerHTML = html;
  }
  const dlIcon = `<svg class="set-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>`;
  const ulIcon = `<svg class="set-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>`;

  function render() {
    if (view === 'home') renderHome();
    else if (view === 'insights') renderInsights();
    else if (view === 'settings') renderSettings();
    if (view !== 'home') renderSummary();
  }

  // ── Views / navigation ───────────────────────────────────────────────
  function showView(v) {
    view = v;
    document.querySelectorAll('.m-view,.d-view').forEach(el => el.classList.toggle('active', el.dataset.view === v));
    document.querySelectorAll('.nav-item[data-view],.d-tab[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === v));
    const topActions = $('m-top-actions'); if (topActions) topActions.style.visibility = v === 'home' ? 'visible' : 'hidden';
    render();
    const c = $('m-content'); if (c) c.scrollTo({ top: 0 });
  }

  // ── Detail sheet ─────────────────────────────────────────────────────
  function openDetail(id) {
    const s = subs.find(x => x.id === id); if (!s) return;
    const rd = nextRenewalDate(s.startDate, s.cycle);
    $('detail-sheet').innerHTML = `
      <div class="sheet-handle"></div>
      <div class="detail-header">
        <div class="detail-icon sub-icon">${logoHtml(s)}</div>
        <div><div class="detail-name">${esc(s.name)}</div><div class="detail-cat">${esc(s.category)}</div></div>
      </div>
      <div class="detail-row"><span class="detail-label">Price</span><span class="detail-value">${s.cycle === 'yearly' ? `${money(s.price)}/yr <span style="color:var(--text-faint);font-weight:400">(${money(toMonthly(s))}/mo)</span>` : `${money(s.price)}/mo`}</span></div>
      <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${badgeHtml(s.status)}</span></div>
      <div class="detail-row"><span class="detail-label">Next payment</span><span class="detail-value">${rd && isBillable(s) ? `${money(s.price)} · ${fmtDateLong(rd)}` : '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Payment method</span><span class="detail-value">${esc(s.paymentMethod) || '—'}</span></div>
      ${s.accountEmail ? `<div class="detail-row"><span class="detail-label">Account email</span><span class="detail-value">${esc(s.accountEmail)}</span></div>` : ''}
      <div class="detail-row"><span class="detail-label">Billing</span><span class="detail-value" style="text-transform:capitalize">${esc(s.cycle)}</span></div>
      <div class="detail-row"><span class="detail-label">Billing start</span><span class="detail-value">${s.startDate ? fmtDateLong(new Date(s.startDate + 'T00:00:00')) : '—'}</span></div>
      ${s.notes ? `<div class="detail-row"><span class="detail-label">Notes</span><span class="detail-value" style="font-style:italic;font-weight:400">${esc(s.notes)}</span></div>` : ''}
      <div class="detail-actions">
        <button class="btn-primary" data-detail-edit="${s.id}">Edit</button>
        <button class="btn-secondary" data-action="ask" data-id="${s.id}">💬 Ask</button>
        ${s.url ? `<a class="btn-link" href="${esc(s.url)}" target="_blank" rel="noopener"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Manage</a>` : ''}
      </div>`;
    $('detail-overlay').classList.add('open');
  }
  const closeDetail = () => $('detail-overlay').classList.remove('open');

  // ── Form sheet ───────────────────────────────────────────────────────
  function openAdd() { editId = null; selectedService = null; tileQuery = ''; showForm({}); }
  function openEdit(id) { const s = subs.find(x => x.id === id); if (!s) return; editId = id; selectedService = null; showForm(s); }

  function tileHtml() {
    const q = tileQuery.toLowerCase().trim();
    const visible = SERVICE_LIBRARY.filter(svc => (!svc.adult || (HAS_ADULT && settings.adultUnlocked)) && (!q || svc.name.toLowerCase().includes(q) || (svc.category || '').includes(q)));
    const tile = svc => `<div class="service-tile ${svc.adult ? 'adult' : ''} ${selectedService && selectedService.name === svc.name ? 'selected' : ''}" data-tile="${esc(svc.name)}"><div class="sub-icon tile-icon">${logoHtml(svc)}</div><span>${esc(svc.name)}</span></div>`;
    const normal = visible.filter(s => !s.adult).map(tile).join('');
    const adult = visible.filter(s => s.adult).map(tile).join('');
    const gate = HAS_ADULT && !settings.adultUnlocked && !q ? `<div class="service-tile locked" data-action="age-gate"><span class="tile-emoji">🔞</span><span>Adults only<br>(18+ · tap to unlock)</span></div>` : '';
    return `${normal}${gate}${adult ? `<div class="tile-divider">Adults only (18+)</div>${adult}` : ''}${!normal && !adult && !gate ? `<div class="tile-none">No match — just type the name below</div>` : ''}`;
  }
  function refreshTiles() { const g = $('service-grid'); if (g) g.innerHTML = tileHtml(); }
  function pickSvc(name) {
    const svc = SERVICE_LIBRARY.find(s => s.name === name); if (!svc) return;
    selectedService = svc;
    document.querySelectorAll('.service-tile').forEach(t => t.classList.toggle('selected', t.dataset.tile === name));
    if (svc.name !== 'Custom…') {
      const n = $('f-name'); if (n) n.value = svc.name;
      const c = $('f-cat'); if (c) { ensureCatOption(svc.category); c.value = svc.category; }
      const u = $('f-url'); if (u && svc.url) u.value = svc.url;
    }
    const p = $('f-price'); if (p) p.focus();
  }
  function catOptions(current) {
    return CATEGORIES.filter(c => !ADULT_CATS.includes(c) || (HAS_ADULT && settings.adultUnlocked) || c === current)
      .map(c => `<option value="${c}" ${current === c ? 'selected' : ''}>${EMOJI_MAP[c]} ${c[0].toUpperCase() + c.slice(1)}</option>`).join('');
  }
  function ensureCatOption(cat) { const c = $('f-cat'); if (c && cat && ![...c.options].some(o => o.value === cat)) c.insertAdjacentHTML('beforeend', `<option value="${cat}">${EMOJI_MAP[cat] || ''} ${cat[0].toUpperCase() + cat.slice(1)}</option>`); }
  // Emails the app already knows: the SubTracker login, scanned mailboxes, and ones on other subscriptions
  function knownEmails() {
    const out = [];
    const add = e => { e = String(e || '').trim().toLowerCase(); if (e && e.includes('@') && !out.includes(e)) out.push(e); };
    if (window.Sync && window.Sync.user) add(window.Sync.user.email);
    (settings.mailboxes || []).forEach(m => add(m.email));
    subs.forEach(s => add(s.accountEmail));
    return out;
  }
  function updRenew() {
    const sd = ($('f-start') || {}).value, cy = ($('f-cycle') || {}).value || 'monthly', el = $('renew-preview');
    if (!el) return;
    if (!sd) { el.textContent = 'Enter the billing start date to calculate'; return; }
    const rd = nextRenewalDate(sd, cy), d = daysUntil(rd);
    el.textContent = rd ? `${fmtDateLong(rd)} (in ${plural(d, 'day')})` : '—';
  }
  function showForm(s) {
    $('form-title').textContent = editId ? 'Edit Subscription' : 'Add Subscription';
    $('form-body').innerHTML = `
      ${editId ? '' : `<div style="margin-bottom:14px">
        <div class="tile-head"><div class="filter-section-label" style="margin-bottom:0">Quick pick a service</div><input id="svc-search" type="search" placeholder="Search ${SERVICE_LIBRARY.length - 1}+ services…" autocomplete="off"/></div>
        <div class="service-grid" id="service-grid">${tileHtml()}</div></div><div class="or-divider">or enter manually</div>`}
      <div class="form-row"><label>Name</label><input id="f-name" type="text" value="${esc(s.name || '')}" placeholder="e.g. Netflix" autocomplete="off"/></div>
      <div class="form-grid">
        <div class="form-row"><label>Price (${CUR})</label><input id="f-price" type="number" min="0" step="0.01" value="${s.price != null ? s.price : ''}" placeholder="9.99" inputmode="decimal"/></div>
        <div class="form-row"><label>Billing</label><select id="f-cycle"><option value="monthly" ${s.cycle !== 'yearly' ? 'selected' : ''}>Monthly</option><option value="yearly" ${s.cycle === 'yearly' ? 'selected' : ''}>Yearly</option></select></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>Category</label><select id="f-cat">${catOptions(s.category || 'streaming')}</select></div>
        <div class="form-row"><label>Status</label><select id="f-status">${['active', 'trial', 'paused', 'cancelled'].map(st => `<option value="${st}" ${(s.status || 'active') === st ? 'selected' : ''}>${st[0].toUpperCase() + st.slice(1)}</option>`).join('')}</select></div>
      </div>
      <div class="form-row"><label>Billing start date</label><input id="f-start" type="date" value="${esc(s.startDate || '')}"/><div class="form-hint">Any past payment date works — we roll it forward automatically.</div></div>
      <div class="form-row"><label>Next renewal (auto)</label><div class="renew-display" id="renew-preview"></div></div>
      <div class="form-row"><label>Payment method</label><input id="f-payment" type="text" value="${esc(s.paymentMethod || '')}" placeholder="e.g. Visa 1234, PayPal" autocomplete="off"/></div>
      <div class="form-row"><label>Account email (optional)</label><input id="f-email" type="email" list="f-email-list" value="${esc(s.accountEmail || '')}" placeholder="e.g. you@gmail.com" autocomplete="off" inputmode="email" spellcheck="false"/><datalist id="f-email-list">${knownEmails().map(e => `<option value="${esc(e)}"></option>`).join('')}</datalist><div class="form-hint">The login this service is under — handy when bills land in different inboxes.</div></div>
      <div class="form-row"><label>Manage URL (optional)</label><input id="f-url" type="url" value="${esc(s.url || '')}" placeholder="https://…" autocomplete="off"/><div class="form-hint">Also used to fetch the logo.</div></div>
      <div class="form-row"><label>Notes (optional)</label><input id="f-notes" type="text" value="${esc(s.notes || '')}" placeholder="e.g. Family plan, 2 seats"/></div>
      <div id="f-error" class="form-error hidden"></div>
      ${editId ? `<div class="form-ask"><button class="link-btn" data-action="ask" data-id="${esc(editId)}">💬 Ask about this subscription — is it active, which email, next charge…</button></div>` : ''}
      <div class="sheet-actions">
        ${editId ? `<button class="btn-danger" data-form-delete>Delete</button>` : ''}
        <button class="btn-secondary" data-form-cancel>Cancel</button>
        <button class="btn-primary" data-form-save>Save</button>
      </div>`;
    updRenew();
    $('form-overlay').classList.add('open');
    setTimeout(() => { const n = $('f-name'); if (n && !n.value && !isMobile()) n.focus(); }, 300);
  }
  const closeForm = () => { $('form-overlay').classList.remove('open'); selectedService = null; editId = null; };

  function saveForm() {
    if (!editId) {
      const nm = ($('f-name').value || '').trim().toLowerCase();
      const twin = nm && subs.find(s => s.status !== 'cancelled' && dupKey(s) === dupKey({ name: nm }));
      if (twin && !window._dupAddOk) { window._dupAddOk = true; toast(`You already track ${twin.name} (${money(twin.price)}/${twin.cycle === 'yearly' ? 'yr' : 'mo'}) — tap Save again to add it anyway`, 4000); return; }
    }
    window._dupAddOk = false;
    const name = $('f-name').value.trim();
    const price = parseFloat($('f-price').value);
    const err = $('f-error');
    if (!name) { err.textContent = 'Please enter a name.'; err.classList.remove('hidden'); return; }
    if (isNaN(price) || price < 0) { err.textContent = 'Please enter a valid price.'; err.classList.remove('hidden'); return; }
    err.classList.add('hidden');
    const existing = editId ? subs.find(x => x.id === editId) : null;
    const svc = (selectedService && selectedService.name !== 'Custom…' && selectedService.name === name) ? selectedService : svcFor({ name });
    let url = $('f-url').value.trim();
    if (!url && svc) url = svc.url || '';
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    const emoji = (svc && svc.emoji) || (existing && existing.emoji) || null;
    let domain = svc && svc.domain ? svc.domain : '';
    if (!domain && existing && existing.domain && (!existing.url || existing.url === url)) domain = existing.domain;
    if (!domain) domain = hostOf(url);
    commit({
      ...(existing || {}), // keep what the form doesn't show (where it was imported from, etc.)
      id: existing ? existing.id : uuid(),
      name, price, emoji, domain,
      cycle: $('f-cycle').value, category: $('f-cat').value, status: $('f-status').value,
      startDate: $('f-start').value, paymentMethod: $('f-payment').value.trim(),
      accountEmail: (($('f-email') || {}).value || '').trim().toLowerCase(),
      url, notes: $('f-notes').value.trim(),
    });
    closeForm(); toast(existing ? 'Saved' : `${name} added`);
  }
  function deleteSub(id) {
    const s = subs.find(x => x.id === id); if (!s) return;
    if (!confirm(`Delete ${s.name}?`)) return;
    remove(id); closeForm(); closeDetail(); toast('Deleted');
  }

  // ── Duplicates: flag entries that are the same subscription twice ───────
  //  Same service (library name / alias / typed name) → a group. Entries with the
  //  same price and billing cycle are "exact" duplicates (removal pre-ticked);
  //  same service with a different plan is "possible" (shown, nothing pre-ticked).
  const dupKey = s => String(canonName(s) || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const dupPairKey = (a, b) => [a.id, b.id].sort().join('|');
  const dupIgnored = (a, b) => (settings.dupIgnore || []).includes(dupPairKey(a, b));
  // how "complete" an entry is — the keeper is the most complete, then the oldest
  const dupScore = s => (s.paymentMethod ? 2 : 0) + (s.url ? 1 : 0) + (s.notes ? 1 : 0) + (s.startDate ? 1 : 0) + (s.accountEmail ? 1 : 0) + (s.domain ? 1 : 0);
  function findDuplicateGroups() {
    const live = subs.filter(s => s.status !== 'cancelled');
    const by = new Map();
    live.forEach(s => { const k = dupKey(s); if (!k) return; if (!by.has(k)) by.set(k, []); by.get(k).push(s); });
    const groups = [];
    for (const [key, list] of by) {
      if (list.length < 2) continue;
      // drop entries the person has said are fine to keep together
      const members = list.filter(s => list.some(o => o !== s && !dupIgnored(s, o)));
      if (members.length < 2) continue;
      const sorted = [...members].sort((a, b) => dupScore(b) - dupScore(a) || String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')));
      const keep = sorted[0];
      const exact = sorted.filter(s => s !== keep && s.cycle === keep.cycle && Math.abs(Number(s.price) - Number(keep.price)) < 0.005);
      const possible = sorted.filter(s => s !== keep && !exact.includes(s));
      groups.push({ key, name: keep.name, members: sorted, keep, exact, possible, wasted: exact.reduce((a, s) => a + toMonthly(s), 0) });
    }
    return groups;
  }
  const dupSetKey = groups => groups.map(g => g.members.map(s => s.id).sort().join(',')).sort().join(';');
  let dupChoice = {}; // group key → id to keep (while the sheet is open)
  let dupRemove = {}; // group key → Set of ids ticked for removal

  function dupBannerHtml() {
    const groups = findDuplicateGroups();
    if (!groups.length) return '';
    const n = groups.reduce((a, g) => a + g.exact.length + g.possible.length, 0);
    const wasted = groups.reduce((a, g) => a + g.wasted, 0);
    return `<button class="review-banner dup-banner" data-action="duplicates">
      <span class="review-banner-ic">⚠️</span>
      <span class="review-banner-text"><b>${plural(n, 'possible duplicate')} found</b><small>${wasted ? `${money(wasted)}/mo is being counted twice · ` : ''}tap to tidy up</small></span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
    </button>`;
  }
  const dupIds = () => new Set(findDuplicateGroups().flatMap(g => g.members.map(s => s.id)));

  function openDuplicates() {
    const groups = findDuplicateGroups();
    dupChoice = {}; dupRemove = {};
    groups.forEach(g => { dupChoice[g.key] = g.keep.id; dupRemove[g.key] = new Set(g.exact.map(s => s.id)); });
    renderDuplicates();
    $('dup-overlay').classList.add('open');
  }
  function renderDuplicates() {
    const groups = findDuplicateGroups();
    const body = $('dup-body'); if (!body) return;
    if (!groups.length) {
      body.innerHTML = `<div class="sheet-title">✅ No duplicates</div><p class="disc-text">Every subscription on your list is only there once.</p><button class="btn-secondary btn-block" data-close="dup-overlay">Done</button>`;
      return;
    }
    const total = groups.reduce((a, g) => a + (dupRemove[g.key] ? dupRemove[g.key].size : 0), 0);
    const added = s => s.updatedAt ? new Date(s.updatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '';
    body.innerHTML = `
      <div class="sheet-title">⚠️ Duplicates</div>
      <p class="disc-text">${groups.length === 1 ? 'One subscription is' : `${groups.length} subscriptions are`} on your list more than once — usually from adding it twice, a double import, or two devices syncing the same entry. Pick the copy to keep; the ticked ones are removed (only from SubTracker — this never touches the real subscription).</p>
      ${groups.map(g => {
        const keepId = dupChoice[g.key];
        return `<div class="dup-group" data-dup-group="${esc(g.key)}">
          <div class="dup-head"><div class="sub-icon" style="width:36px;height:36px">${logoHtml(g.keep)}</div><div class="dup-head-main"><b>${esc(g.name)}</b><small>${g.members.length} entries${g.possible.length ? ` · ${g.possible.length} with a different price or plan` : ''}</small></div><button class="link-btn" data-action="dup-ignore" data-key="${esc(g.key)}">Keep all</button></div>
          ${g.members.map(s => {
            const isKeep = s.id === keepId, rm = dupRemove[g.key] && dupRemove[g.key].has(s.id);
            const meta = [`${money(s.price)}/${s.cycle === 'yearly' ? 'yr' : 'mo'}`, s.status !== 'active' ? s.status : '', s.paymentMethod ? `💳 ${s.paymentMethod}` : '', s.startDate ? `from ${s.startDate.split('-').reverse().join('/')}` : '', s.accountEmail ? `✉️ ${s.accountEmail}` : '', s.notes ? s.notes : '', added(s) ? `added ${added(s)}` : ''].filter(Boolean).join(' · ');
            return `<div class="dup-row ${isKeep ? 'keep' : rm ? 'rm' : ''}">
              <label class="dup-pick" title="Keep this one"><input type="radio" name="dupkeep-${esc(g.key)}" data-dup-keep="${s.id}" data-key="${esc(g.key)}" ${isKeep ? 'checked' : ''}/><span>Keep</span></label>
              <div class="dup-main"><div class="dup-meta">${esc(meta)}</div></div>
              ${isKeep ? `<span class="disc-badge">keeping</span>` : `<label class="disc-check" title="Remove this copy"><input type="checkbox" data-dup-rm="${s.id}" data-key="${esc(g.key)}" ${rm ? 'checked' : ''}/><span class="disc-box"></span></label>`}
            </div>`;
          }).join('')}
        </div>`;
      }).join('')}
      <div class="sheet-actions">
        <button class="btn-secondary" data-close="dup-overlay">Later</button>
        <button class="btn-primary" data-action="dup-remove" ${total ? '' : 'disabled'}>Remove ${total || ''} ${total === 1 ? 'copy' : 'copies'}</button>
      </div>`;
  }
  function dupSetKeep(key, id) {
    dupChoice[key] = id;
    // the kept one can't also be removed; an exact twin of the kept one gets pre-ticked
    const g = findDuplicateGroups().find(x => x.key === key); if (!g) return;
    const keep = g.members.find(s => s.id === id); if (!keep) return;
    dupRemove[key] = new Set(g.members.filter(s => s !== keep && s.cycle === keep.cycle && Math.abs(Number(s.price) - Number(keep.price)) < 0.005).map(s => s.id));
    renderDuplicates();
  }
  function dupToggleRemove(key, id, on) {
    if (!dupRemove[key]) dupRemove[key] = new Set();
    if (on) dupRemove[key].add(id); else dupRemove[key].delete(id);
    const total = Object.values(dupRemove).reduce((a, s) => a + s.size, 0);
    const b = document.querySelector('[data-action="dup-remove"]'); if (b) { b.disabled = !total; b.textContent = `Remove ${total || ''} ${total === 1 ? 'copy' : 'copies'}`.replace('  ', ' '); }
    const row = document.querySelector(`[data-dup-rm="${id}"]`); if (row) row.closest('.dup-row').classList.toggle('rm', on);
  }
  function dupIgnoreGroup(key) {
    const g = findDuplicateGroups().find(x => x.key === key); if (!g) return;
    settings.dupIgnore = settings.dupIgnore || [];
    g.members.forEach((a, i) => g.members.slice(i + 1).forEach(b => { const k = dupPairKey(a, b); if (!settings.dupIgnore.includes(k)) settings.dupIgnore.push(k); }));
    saveSettings(); renderDuplicates(); render();
  }
  function dupRemoveSelected() {
    const ids = Object.values(dupRemove).flatMap(s => [...s]);
    if (!ids.length) return;
    ids.forEach(id => remove(id));
    toast(`Removed ${plural(ids.length, 'duplicate')}`);
    const left = findDuplicateGroups();
    if (left.length) renderDuplicates(); else { $('dup-overlay').classList.remove('open'); }
    render();
  }
  // Prompt once per new set of duplicates (after an import, a sync, or on open)
  function maybePromptDuplicates(reason) {
    const groups = findDuplicateGroups();
    if (!groups.length) return;
    const key = dupSetKey(groups);
    if (settings.dupPromptedKey === key) return;
    settings.dupPromptedKey = key; saveSettings();
    if (document.querySelector('.sheet-overlay.open')) return; // don't stack on top of another sheet
    openDuplicates();
  }

  // ── Find subscriptions from email ────────────────────────────────────
  //  UI around docs/discover.js: pick a mailbox → scan → review → import.
  const DISC = window.Discover || null;
  let disc = { state: 'choose', provider: '', session: null, items: [], email: '', cancelled: false, running: false, stats: null, editing: -1, error: '' };
  const discProvider = id => DISC && DISC.providers[id];
  const discReady = id => !!(discProvider(id) && discProvider(id).ready());
  const fmtIso = iso => { if (!iso) return ''; const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')); return isNaN(d) ? iso : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }); };

  function openDiscover(prefer) {
    if (!DISC) { toast('Email discovery is not available in this build'); return; }
    disc = { state: isNative() ? 'handoff' : 'choose', provider: prefer || '', session: null, items: [], email: '', cancelled: false, running: false, stats: null, editing: -1, error: '', lastImport: null };
    renderDiscover();
    $('discover-overlay').classList.add('open');
    // warm up the sign-in SDKs now so the Connect tap can open the popup immediately
    if (!isNative()) Object.values(DISC.providers).forEach(p => { if (p.ready()) p.prepare().catch(() => {}); });
  }
  function closeDiscover() {
    disc.cancelled = true;
    if (disc.session && discProvider(disc.session.provider)) { try { discProvider(disc.session.provider).disconnect(disc.session); } catch {} }
    disc.session = null;
    if (settings.pendingConnect) { settings.pendingConnect = ''; saveSettings(); }
    $('discover-overlay').classList.remove('open');
  }
  const discoverOpen = () => { const o = $('discover-overlay'); return !!(o && o.classList.contains('open')); };
  const discWebUrl = () => (CFG.EDITION_URL || APP_URL || '') + ((CFG.EDITION_URL || APP_URL || '').includes('?') ? '&' : '?') + 'connect=1';

  function renderDiscover() {
    const body = $('discover-body'); if (!body) return;
    const u = window.Sync && window.Sync.user;
    const mailboxes = settings.mailboxes || [];
    const privacy = `<div class="disc-privacy">🔒 Read-only access, used once, on this device. We keep what you import (name, price, date, card last digits) — never your emails — and access is switched off when the scan ends. <a href="privacy.html#email" target="_blank" rel="noopener">Privacy policy</a></div>`;
    let html = '';

    if (disc.state === 'handoff') {
      html = `
        <div class="sheet-title">✉️ Find subscriptions</div>
        <p class="disc-text">Connecting Gmail or Outlook happens in your phone's browser — Google and Microsoft don't allow their sign-in inside apps.</p>
        <p class="disc-text">${u ? `In the browser, sign in to SubTracker with your login (<b>${esc(u.email)}</b>) so the results sync back here — then connect <b>any</b> Gmail or Outlook mailboxes you like, as many as you want. They don't have to match your login.` : `<b>Sign in to SubTracker first</b> (Settings → Sign in) so what you import in the browser can sync back to this app. The mailboxes you scan can be any Gmail or Outlook accounts.`}</p>
        <button class="btn-primary btn-block" data-action="discover-open-web">Open in browser</button>
        <button class="btn-secondary btn-block" style="margin-top:10px" data-action="discover-paste">Paste a receipt email instead</button>
        ${privacy}`;
    } else if (disc.state === 'choose') {
      const card = (id, logo, title, sub) => {
        const ready = discReady(id);
        return `<button class="disc-provider ${disc.provider === id ? 'hint' : ''}" data-action="discover-connect" data-provider="${id}" ${ready ? '' : 'disabled'}>
          <span class="disc-plogo">${logo}</span>
          <span class="disc-pmain"><b>${title}</b><small>${ready ? sub : 'Not set up yet — the app owner needs to add a client ID (see README)'}</small></span>
          <span class="disc-pstate">${ready ? 'Connect' : '—'}</span></button>`;
      };
      const canSync = !!(window.Sync && window.Sync.configured);
      html = `
        <div class="sheet-title">✉️ ${mailboxes.length || disc.lastImport ? 'Connect a mailbox' : 'Find subscriptions'}</div>
        ${disc.lastImport ? `<div class="auth-banner soft">✅ Added ${plural(disc.lastImport.n, 'subscription')}${disc.lastImport.email ? ` from <b>${esc(disc.lastImport.email)}</b>` : ''}. Bills land in another inbox? Connect it below.</div>` : ''}
        <p class="disc-text">We look through the last 12 months of a mailbox for receipts, renewals and trials, then show you what we found — nothing is added until you tick it. Connect <b>any</b> Gmail or Outlook account, not just the one you use for SubTracker, and as many as you like: each subscription remembers which inbox it came from.</p>
        ${canSync && !u ? `<div class="auth-banner soft">You're not signed in to SubTracker — what you import stays on this device only. <button class="link-btn inline" data-action="auth">Sign in</button> to sync it to your other devices.</div>` : ''}
        ${disc.error ? `<div class="auth-banner danger">${esc(disc.error)}</div>` : ''}
        <div class="disc-providers">
          ${card('gmail', '<svg width="22" height="22" viewBox="0 0 24 24"><path fill="#EA4335" d="M5 7.5v9h-.5A2.5 2.5 0 0 1 2 14V8.1c0-.9 1-1.4 1.7-.9L5 8.2z"/><path fill="#4285F4" d="M19 7.5v9h.5a2.5 2.5 0 0 0 2.5-2.5V8.1c0-.9-1-1.4-1.7-.9L19 8.2z"/><path fill="#FBBC04" d="M5 8.2 12 13l7-4.8V5.6c0-1.3-1.5-2-2.5-1.2L12 7.8 7.5 4.4C6.5 3.6 5 4.3 5 5.6z"/><path fill="#34A853" d="M5 7.5 12 12.4l7-4.9v2.1l-7 4.9-7-4.9z"/></svg>', 'Gmail', 'Google accounts (gmail.com and Google Workspace)')}
          ${card('outlook', '<svg width="22" height="22" viewBox="0 0 24 24"><rect x="2" y="5" width="12" height="14" rx="2" fill="#0078D4"/><ellipse cx="8" cy="12" rx="3" ry="3.6" fill="#fff"/><ellipse cx="8" cy="12" rx="1.5" ry="2.1" fill="#0078D4"/><path d="M14 8h7v9a2 2 0 0 1-2 2h-5z" fill="#28A8EA"/><path d="M14 8h7l-3.5 3z" fill="#50D9FF"/></svg>', 'Outlook / Hotmail', 'Outlook.com, Hotmail, Live and Microsoft 365')}
          <button class="disc-provider" data-action="discover-paste">
            <span class="disc-plogo">📋</span>
            <span class="disc-pmain"><b>iCloud, Yahoo, work mail…</b><small>Paste a receipt email — works with any mailbox</small></span>
            <span class="disc-pstate">Paste</span></button>
        </div>
        <div class="disc-text small disc-howto">You sign in on Google's or Microsoft's own page, pick the account, and allow <b>read-only</b> access. If your account uses an authenticator app or a code by text, approve that too — then you land straight back here and the scan starts.</div>
        ${mailboxes.length ? `<div class="disc-sub">Mailboxes you've scanned</div>${mailboxes.map(m => `<div class="set-row"><div class="set-row-main"><div class="set-row-label">${esc(m.email)}</div><div class="set-row-sub">${esc(m.provider === 'gmail' ? 'Gmail' : 'Outlook')} · last scan ${fmtIso((m.lastScanAt || '').slice(0, 10))} · ${plural(m.found || 0, 'subscription')} found</div></div><button class="link-btn" data-action="discover-connect" data-provider="${esc(m.provider)}" data-hint="${esc(m.email)}" ${discReady(m.provider) ? '' : 'disabled'}>Scan again</button><button class="link-btn danger" data-action="discover-forget" data-email="${esc(m.email)}">Forget</button></div>`).join('')}<div class="disc-text small" style="margin-top:8px">Tap Gmail or Outlook above to add another mailbox — you'll get to pick the account.</div>` : ''}
        ${disc.lastImport ? `<button class="btn-secondary btn-block" style="margin-top:14px" data-action="discover-cancel">Done</button>` : ''}
        ${privacy}`;
    } else if (disc.state === 'paste') {
      html = `
        <div class="sheet-title">📋 Paste a receipt</div>
        <p class="disc-text">Open the receipt or renewal email on your phone or computer, select all of it, copy, and paste it here. Works with iCloud Mail, Yahoo, work email — anything. The text stays on this device.</p>
        <textarea id="disc-paste" class="disc-textarea" rows="9" placeholder="From: Apple <no_reply@email.apple.com>&#10;Subject: Your receipt from Apple.&#10;&#10;iCloud+ with 200GB Storage (Monthly) … $4.49"></textarea>
        ${disc.error ? `<div class="auth-banner danger">${esc(disc.error)}</div>` : ''}
        <div class="sheet-actions"><button class="btn-secondary" data-action="discover-back">Back</button><button class="btn-primary" data-action="discover-paste-go">Find the subscription</button></div>`;
    } else if (disc.state === 'connecting') {
      const ms = disc.provider === 'outlook';
      const who = ms ? 'Microsoft' : 'Google';
      const redirect = disc.connectMode === 'redirect';
      html = `
        <div class="sheet-title">✉️ Signing in with ${who}…</div>
        <div class="disc-progress"><div class="disc-bar indeterminate"></div></div>
        ${redirect
          ? `<p class="disc-text">Taking you to ${who}'s sign-in page. Pick the mailbox, allow read-only access, and you'll come straight back here — the scan starts on its own.</p>`
          : `<p class="disc-text">Finish the sign-in in the window that just opened: pick the mailbox and allow read-only access. This page waits for you.</p>`}
        <ul class="disc-steps">
          <li>Using <b>${ms ? 'Microsoft Authenticator' : 'a Google prompt'}</b> or a code by text? Approve it on your phone first — ${who} waits for that before sending you back.</li>
          ${redirect ? '' : `<li>Can't see the window? It may have opened as a new tab. If it's gone, tap Cancel and try Connect again.</li>`}
          <li>${ms ? 'Work or school account that says it "needs admin approval"? That organisation blocks mail apps — use a personal Outlook or Hotmail account instead.' : 'Google says the app is unverified? That\'s expected while SubTracker is in testing — tap Continue.'}</li>
        </ul>
        <button class="btn-secondary btn-block" data-action="discover-back">Cancel</button>`;
    } else if (disc.state === 'scanning') {
      const st = disc.stats || { stage: 'connect', done: 0, total: 1 };
      const pct = st.stage === 'connect' ? 4 : st.stage === 'search' ? 8 + 22 * (st.done / Math.max(1, st.total)) : st.stage === 'headers' ? 30 + 40 * (st.done / Math.max(1, st.total)) : st.stage === 'read' ? 70 + 26 * (st.done / Math.max(1, st.total)) : 98;
      const label = st.stage === 'connect' ? 'Connecting…' : st.stage === 'search' ? `Searching your inbox (${st.done + 1} of ${st.total})…` : st.stage === 'headers' ? `Checking ${st.done} of ${st.total} emails…` : st.stage === 'read' ? `Reading ${st.done} of ${st.total} receipts…` : 'Working out what you pay…';
      html = `
        <div class="sheet-title">✉️ Scanning${disc.email ? ` <small class="disc-email">${esc(disc.email)}</small>` : ''}</div>
        <div class="disc-progress"><div class="disc-bar" style="width:${Math.round(pct)}%"></div></div>
        <div class="disc-stage">${label}</div>
        <p class="disc-text small">Only subjects, senders and the receipts themselves are read, right here in your browser. This usually takes under a minute.</p>
        <button class="btn-secondary btn-block" data-action="discover-cancel">Cancel</button>`;
    } else if (disc.state === 'results') {
      const items = disc.items;
      const mainIdx = items.map((it, i) => i).filter(i => items[i].kind !== 'oneoff');
      const oneIdx = items.map((it, i) => i).filter(i => items[i].kind === 'oneoff');
      const fresh = mainIdx.filter(i => !items[i].existing), known = mainIdx.filter(i => items[i].existing);
      const picked = items.filter(i => i.checked).length;
      const confBadge = it => it.existing ? `<span class="disc-badge muted">On your list</span>` : it.status === 'cancelled' ? `<span class="disc-badge danger">Cancelled</span>` : it.status === 'trial' ? `<span class="disc-badge warn">Trial</span>` : it.marketingOnly ? `<span class="disc-badge muted">Only marketing emails</span>` : it.kind === 'oneoff' ? `<span class="disc-badge muted">One-off purchase</span>` : it.kind === 'unsure' ? `<span class="disc-badge warn">One-off or subscription?</span>` : it.confidence === 'low' ? `<span class="disc-badge warn">Check price</span>` : '';
      const itemHtml = (it, i) => {
        const svcLike = { name: it.name, domain: it.domain || (it.svc && it.svc.domain) || '', emoji: it.svc ? it.svc.emoji : '📦', category: it.svc ? it.svc.category : 'other' };
        const price = it.price != null ? `${it.currency && it.currency !== 'AUD' ? it.currency + ' ' : ''}${money(it.price)}${it.kind === 'oneoff' ? ' once' : it.kind === 'unsure' ? '' : '/' + (it.cycle === 'yearly' ? 'yr' : 'mo')}` : 'Price unknown';
        const meta = [price, it.lastDate ? `last charged ${fmtIso(it.lastDate)}` : '', it.card || '', it.via ? `via ${it.via}` : '', it.count > 1 ? plural(it.count, 'receipt') : ''].filter(Boolean).join(' · ');
        const editing = disc.editing === i;
        return `<div class="disc-item ${it.checked ? 'on' : ''}" data-disc="${i}">
          <div class="disc-row">
            <label class="disc-check"><input type="checkbox" data-disc-check="${i}" ${it.checked ? 'checked' : ''}/><span class="disc-box"></span></label>
            <div class="sub-icon disc-icon">${logoHtml(svcLike)}</div>
            <div class="disc-main" data-disc-edit="${i}">
              <div class="disc-name">${esc(it.name)} ${confBadge(it)}</div>
              <div class="disc-meta">${esc(meta)}</div>
              ${it.note ? `<div class="disc-meta">${esc(it.note)}</div>` : ''}
              ${it.accountEmail && it.provider !== 'pasted' ? `<div class="disc-meta faint">${esc(it.accountEmail)}</div>` : ''}
            </div>
            <button class="link-btn" data-disc-edit="${i}">${editing ? 'Done' : 'Edit'}</button>
          </div>
          ${editing ? `<div class="disc-editor">
            <div class="form-row"><label>Name</label><input type="text" data-disc-field="name" data-i="${i}" value="${esc(it.name)}"/></div>
            <div class="form-grid">
              <div class="form-row"><label>Price (${esc(CUR)})</label><input type="number" step="0.01" min="0" inputmode="decimal" data-disc-field="price" data-i="${i}" value="${it.price != null ? it.price : ''}" placeholder="9.99"/></div>
              <div class="form-row"><label>Billing</label><select data-disc-field="cycle" data-i="${i}"><option value="monthly" ${it.cycle !== 'yearly' ? 'selected' : ''}>Monthly</option><option value="yearly" ${it.cycle === 'yearly' ? 'selected' : ''}>Yearly</option></select></div>
            </div>
            <div class="form-grid">
              <div class="form-row"><label>Status</label><select data-disc-field="status" data-i="${i}">${['active', 'trial', 'paused', 'cancelled'].map(s => `<option value="${s}" ${it.status === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></div>
              <div class="form-row"><label>Last charged</label><input type="date" data-disc-field="lastDate" data-i="${i}" value="${esc(it.lastDate || '')}"/></div>
            </div>
            ${it.evidence && it.evidence.length ? `<div class="disc-why"><b>Found in:</b> ${it.evidence.map(e => `${esc(e.subject || '(no subject)')} <span class="faint">(${fmtIso(e.date)})</span>`).join(' · ')}</div>` : ''}
          </div>` : ''}
        </div>`;
      };
      html = `
        <div class="sheet-title">✉️ ${mainIdx.length ? `Found ${plural(fresh.length, 'subscription')}` : items.length ? 'No subscriptions found' : 'Nothing found'}</div>
        <div class="disc-summary">${disc.email ? esc(disc.email) + ' · ' : ''}${disc.stats && disc.stats.scanned != null ? `${disc.stats.scanned} emails checked · ` : ''}${known.length ? `${known.length} already on your list · ` : ''}${oneIdx.length ? `${plural(oneIdx.length, 'one-off purchase')} set aside · ` : ''}${mainIdx.length ? 'tick what you want to add' : ''}</div>
        ${items.length ? '' : `<div class="finding finding-ok"><div class="finding-detail">No receipts or renewal emails turned up in the last 12 months. If your bills go to another address, scan that mailbox too — or paste a receipt.</div></div>`}
        ${items.length && !mainIdx.length ? `<div class="finding finding-ok"><div class="finding-detail">Everything we found looks like a one-off purchase rather than something that renews. They're listed below in case one of them is a subscription after all.</div></div>` : ''}
        <div class="disc-list">${mainIdx.map(i => itemHtml(items[i], i)).join('')}</div>
        ${oneIdx.length ? `<button class="disc-fold ${disc.showOneOff ? 'open' : ''}" data-action="discover-toggle-oneoff"><span><b>Probably one-off purchases (${oneIdx.length})</b><small>Orders, deliveries and app purchases — set aside, nothing is added unless you tick it</small></span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></button>
        ${disc.showOneOff ? `<div class="disc-list">${oneIdx.map(i => itemHtml(items[i], i)).join('')}</div>` : ''}` : ''}
        <div class="sheet-actions">
          <button class="btn-secondary" data-action="discover-back">${items.length ? 'Cancel' : 'Back'}</button>
          ${items.length ? `<button class="btn-primary" data-action="discover-import" ${picked ? '' : 'disabled'}>Add ${picked ? picked : ''} to my list</button>` : ''}
        </div>`;
    }
    body.innerHTML = html;
  }

  let discAttempt = 0; // bumped on every Connect tap and on Cancel, so a late sign-in result can't hijack the sheet
  async function discoverConnect(providerId, loginHint) {
    const p = discProvider(providerId); if (!p || !p.ready()) return;
    const attempt = ++discAttempt;
    disc.provider = providerId; disc.error = ''; disc.cancelled = false; disc.email = loginHint || '';
    // show what's happening while Google / Microsoft have the person (account picker, password, Authenticator…)
    disc.state = 'connecting'; disc.connectMode = p.mode ? p.mode({ loginHint }) : 'popup'; renderDiscover();
    let session;
    try {
      // the popup must open straight from the tap — prepare() was already called when the sheet opened
      await p.prepare();
      session = await p.connect({ loginHint: loginHint || '', prompt: loginHint ? '' : 'select_account', onRedirect: () => { disc.connectMode = 'redirect'; renderDiscover(); } });
    } catch (e) {
      if (attempt !== discAttempt) return; // cancelled or superseded meanwhile
      if (/^cancelled$|popup_closed/i.test(e && e.message || '')) { disc.state = 'choose'; renderDiscover(); return; }
      disc.error = (e && e.message) || 'Could not connect'; disc.state = 'choose'; renderDiscover(); return;
    }
    if (attempt !== discAttempt || disc.cancelled) { try { p.disconnect(session); } catch {} return; }
    disc.session = session; disc.state = 'scanning'; disc.stats = { stage: 'connect', done: 0, total: 1 }; renderDiscover();
    try {
      const res = await DISC.scan(session, { months: 12, existing: subs, onProgress: st => { if (disc.cancelled) return; disc.stats = st; renderDiscover(); } });
      if (disc.cancelled) return;
      disc.session = null; // scan() revokes the token when it finishes
      disc.email = res.email || disc.email; disc.items = res.items; disc.stats = { scanned: res.scanned }; disc.state = 'results'; disc.editing = -1;
      renderDiscover();
      rememberMailbox(providerId, disc.email, res.items.length);
      if (settings.pendingConnect) { settings.pendingConnect = ''; saveSettings(); } // the hand-off did its job
    } catch (e) {
      if (disc.cancelled) return;
      try { p.disconnect(session); } catch {}
      disc.session = null; disc.error = (e && e.message) || 'The scan failed'; disc.state = 'choose'; renderDiscover();
    }
  }
  function rememberMailbox(provider, email, found) {
    if (!email) return;
    const list = (settings.mailboxes || []).filter(m => m.email !== email);
    list.unshift({ provider, email, lastScanAt: new Date().toISOString(), found });
    settings.mailboxes = list.slice(0, 6); saveSettings();
  }
  function discoverPasteGo() {
    const ta = $('disc-paste'); const text = ta ? ta.value : '';
    if (!text || text.trim().length < 20) { disc.error = 'Paste the whole email — including the sender and subject if you can.'; renderDiscover(); return; }
    disc.error = '';
    const items = DISC.fromPasted(text, { existing: subs });
    disc.items = items; disc.state = 'results'; disc.email = ''; disc.stats = null; disc.editing = items.length === 1 && (items[0].price == null || items[0].confidence === 'low') ? 0 : -1;
    renderDiscover();
  }
  function discoverImport() {
    const picked = disc.items.filter(i => i.checked);
    if (!picked.length) return;
    let n = 0;
    for (const it of picked) {
      if (!String(it.name || '').trim()) continue;
      const sub = DISC.toSubscription(it, uuid);
      if (!(sub.price > 0) && it.price == null) sub.price = 0;
      commit(sub); n++;
    }
    toast(`Added ${plural(n, 'subscription')}${disc.email ? ' from ' + disc.email : ''}`);
    if (findDuplicateGroups().length) { closeDiscover(); setTimeout(() => maybePromptDuplicates('import'), 500); return; }
    disc.lastImport = { n, email: disc.email }; disc.items = []; disc.email = ''; disc.stats = null; disc.editing = -1; disc.error = '';
    disc.state = isNative() ? 'handoff' : 'choose';
    if (isNative()) { closeDiscover(); showView('home'); }
    else renderDiscover();
  }
  // Resume after a Microsoft full-page sign-in (popup-blocked browsers)
  async function discoverResume() {
    if (!DISC || isNative()) return;
    try {
      const session = await DISC.providers.outlook.resume();
      const pendingAsk = askPendingResume();
      if (!session) { if (settings.pendingConnect && !discoverOpen()) openDiscover(settings.pendingConnect === '1' ? '' : settings.pendingConnect); return; }
      if (pendingAsk && pendingAsk.id && subs.find(x => x.id === pendingAsk.id)) { openAsk(pendingAsk.id); await askRunCheck(session); return; }
      openDiscover('outlook');
      disc.session = session; disc.state = 'scanning'; disc.email = session.email || ''; disc.stats = { stage: 'connect', done: 0, total: 1 }; renderDiscover();
      const res = await DISC.scan(session, { months: 12, existing: subs, onProgress: st => { if (disc.cancelled) return; disc.stats = st; renderDiscover(); } });
      if (disc.cancelled) return;
      disc.session = null; disc.email = res.email || disc.email; disc.items = res.items; disc.stats = { scanned: res.scanned }; disc.state = 'results'; renderDiscover();
      rememberMailbox('outlook', disc.email, res.items.length);
      if (settings.pendingConnect) { settings.pendingConnect = ''; saveSettings(); }
    } catch (e) {
      if (!discoverOpen()) openDiscover('outlook');
      if (settings.pendingConnect) { settings.pendingConnect = ''; saveSettings(); }
      disc.error = /^cancelled$/.test(e && e.message || '') ? 'Microsoft sign-in was cancelled — tap Connect to try again.' : (e && e.message) || 'The scan failed';
      disc.state = 'choose'; renderDiscover();
    }
  }

  // ── Ask about this subscription ──────────────────────────────────────
  //  A small assistant for one subscription. It answers from what the app
  //  already knows (status, dates, price, card, linked email) and can look in a
  //  connected mailbox for the latest receipt or a cancellation email. It runs on
  //  the device like the AI review — nothing is sent anywhere.
  let ask = { id: null, thread: [], busy: false, pending: null, proposal: null };
  let pendingAskId = ''; // ?ask=<id> arrived before the list had synced
  const ASK_PROMPTS = [
    { id: 'active', label: 'Is it still active?' },
    { id: 'email', label: 'Which email is it under?' },
    { id: 'next', label: "When's the next charge?" },
    { id: 'paid', label: 'What have I paid this year?' },
    { id: 'cancel', label: 'How do I cancel?' },
    { id: 'check', label: '✉️ Check my inbox' },
  ];
  const askSub = () => subs.find(x => x.id === ask.id);
  const askOpen = () => { const o = $('ask-overlay'); return !!(o && o.classList.contains('open')); };
  function openAsk(id, first) {
    const s = subs.find(x => x.id === id); if (!s) return;
    ask = { id, thread: [], busy: false, pending: null, proposal: null };
    askSay('ai', `Ask me anything about <b>${esc(s.name)}</b> — tap a question or type your own.`);
    $('ask-overlay').classList.add('open');
    if (first) askIntent(first);
  }
  function closeAsk() { $('ask-overlay').classList.remove('open'); ask.busy = false; ask.pending = null; }
  function askSay(role, html, extra) { ask.thread.push({ role, html, ...(extra || {}) }); renderAsk(); }
  function renderAsk() {
    const body = $('ask-body'); if (!body) return;
    const s = askSub(); if (!s) { body.innerHTML = ''; return; }
    const last = ask.thread[ask.thread.length - 1] || {};
    body.innerHTML = `
      <div class="ask-head"><div class="sub-icon" style="width:36px;height:36px">${logoHtml(s)}</div><div class="ask-head-main"><b>${esc(s.name)}</b><small>${money(s.price)}/${s.cycle === 'yearly' ? 'yr' : 'mo'} · ${esc(s.status)}${s.accountEmail ? ` · ${esc(s.accountEmail)}` : ''}</small></div><button class="link-btn" data-close="ask-overlay">Done</button></div>
      <div class="ask-thread" id="ask-thread">${ask.thread.map(m => `<div class="ask-bubble ${m.role}">${m.html}${m.chips ? `<div class="ask-chips inline">${m.chips.map(c => `<button class="ask-chip" data-ask-chip="${esc(c.action)}" data-arg="${esc(c.arg || '')}">${esc(c.label)}</button>`).join('')}</div>` : ''}</div>`).join('')}${ask.busy ? `<div class="ask-bubble ai busy"><span class="ask-dots"><i></i><i></i><i></i></span></div>` : ''}</div>
      ${last.proposal ? '' : ''}
      <div class="ask-chips">${ASK_PROMPTS.map(p => `<button class="ask-chip" data-ask="${p.id}" ${ask.busy ? 'disabled' : ''}>${p.label}</button>`).join('')}</div>
      <form class="ask-form" id="ask-form"><input id="ask-input" type="text" placeholder="Ask about ${esc(s.name)}…" autocomplete="off" ${ask.busy ? 'disabled' : ''}/><button class="btn-primary" type="submit" ${ask.busy ? 'disabled' : ''}>Ask</button></form>`;
    const th = $('ask-thread'); if (th) th.scrollTop = th.scrollHeight;
  }
  // What is the person asking? (keyword rules — no model, no network)
  function askDetect(text) {
    const t = ' ' + String(text || '').toLowerCase().replace(/[^\w\s@'-]/g, ' ') + ' ';
    const has = re => re.test(t);
    if (has(/\b(which|what|whose)\s+(email|e-mail|address|account|login)\b/) || has(/\b(linked|under|signed up|registered|tied)\b/)) return 'email';
    if (has(/\b(check|look|search|scan|find|inbox|mailbox|receipts?|latest)\b/)) return 'check';
    if (has(/\b(how\s+(do|can|would|could)\s+i|how\s+to|want\s+to|help\s+me|where\s+(do|can)\s+i|steps?\s+to)\b/) && has(/\b(cancel|stop|quit|end|unsubscribe|leave|get\s+out|close)\b/)) return 'cancel';
    if (has(/\b(cancel\s+it|unsubscribe|stop\s+paying|get\s+rid|end\s+it)\b/)) return 'cancel';
    if (has(/\b(active|still|running|current|live|cancell?ed|paused|using|is\s+it\s+on|do\s+i\s+(still\s+)?have|have\s+i\s+got|status)\b/)) return 'active';
    if (has(/\b(next|when|due|renews?|renewal|charge[sd]?|bill(ing|ed)?|payment\s+date|coming\s+up|upcoming)\b/)) return 'next';
    if (has(/\b(paid|spent|spend|cost\s+me|total|so\s+far|this\s+year|last\s+year|how\s+much\s+have|altogether|lifetime)\b/)) return 'paid';
    if (has(/\b(price|cost|how\s+much|per\s+month|monthly|yearly|annual|plan|rate|fee)\b/)) return 'price';
    if (has(/\b(card|payment\s+method|pay\s+method|visa|mastercard|amex|paypal|debit|paying\s+with|which\s+card|how\s+(am|do)\s+i\s+pay)\b/)) return 'card';
    if (has(/\b(email|e-mail|address|account|login)\b/)) return 'email';
    if (has(/\b(notes?|details?|info|about|tell\s+me|summary|summar|everything|what\s+is\s+this)\b/)) return 'summary';
    return '';
  }
  function askIntent(idOrText) {
    const s = askSub(); if (!s || ask.busy) return;
    const known = ASK_PROMPTS.find(p => p.id === idOrText);
    const intent = known ? known.id : askDetect(idOrText);
    askSay('me', esc(known ? known.label.replace(/^✉️\s*/, '') : idOrText));
    if (intent === 'check') { askOfferMailboxes(); return; }
    askSay('ai', askAnswer(s, intent));
  }
  // ── the answers ──
  const lastChargeDate = s => {
    const n = nextRenewalDate(s.startDate, s.cycle); if (!n) return null;
    const d = new Date(n); if (s.cycle === 'yearly') d.setFullYear(d.getFullYear() - 1); else d.setMonth(d.getMonth() - 1);
    const start = new Date(s.startDate + 'T00:00:00'); return d < start ? null : d;
  };
  function chargesBetween(s, from, to) {
    if (!s.startDate) return 0;
    const d = new Date(s.startDate + 'T00:00:00'); if (isNaN(d)) return 0;
    let n = 0, guard = 0;
    while (d <= to && guard++ < 2500) { if (d >= from) n++; if (s.cycle === 'yearly') d.setFullYear(d.getFullYear() + 1); else d.setMonth(d.getMonth() + 1); }
    return n;
  }
  const askDate = d => d ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  function askAnswer(s, intent) {
    const rd = nextRenewalDate(s.startDate, s.cycle), last = lastChargeDate(s), days = rd ? daysUntil(rd) : null;
    const per = s.cycle === 'yearly' ? 'year' : 'month';
    const fromEmail = /^email:/.test(s.source || '');
    const inbox = s.accountEmail ? `<b>${esc(s.accountEmail)}</b>` : '';
    const checkHint = `Want me to look in your inbox for the latest receipt? Tap <b>Check my inbox</b> below.`;
    switch (intent) {
      case 'active': {
        if (s.status === 'cancelled') return `You've marked <b>${esc(s.name)}</b> as <b>cancelled</b>${s.notes ? ` — your note says “${esc(s.notes)}”` : ''}. It's not counted in your totals. If it's somehow still charging you, I can look for recent receipts — tap <b>Check my inbox</b> below.`;
        if (s.status === 'paused') return `It's marked <b>paused</b> — no charges are expected until you set it back to active. ${checkHint}`;
        if (s.status === 'trial') return `It's on a <b>free trial</b>${rd ? `. The first charge of <b>${money(s.price)}</b> is expected on <b>${askDate(rd)}</b> (in ${plural(days, 'day')}) unless you cancel before then` : ''}. ${checkHint}`;
        return `As far as SubTracker knows it's <b>active</b>${last ? ` — the last charge of ${money(s.price)} would have been around <b>${askDate(last)}</b>` : ''}${rd ? `, and the next is due <b>${askDate(rd)}</b> (in ${plural(days, 'day')})` : ''}.${fromEmail && s.accountEmail ? ` It was found from receipts in ${inbox}.` : ''} I can only be sure from a receipt — ${checkHint}`;
      }
      case 'email':
        if (s.accountEmail) return `It's under ${inbox}${fromEmail ? ` — that's the inbox the receipts were found in` : ''}. Bills and renewal notices for <b>${esc(s.name)}</b> should land there.`;
        return `I don't know which email <b>${esc(s.name)}</b> is under yet. You can type it in (Edit → <i>Account email</i>), or tap <b>Check my inbox</b> and I'll look for its receipts — whichever mailbox they're in is the one it's linked to.`;
      case 'next':
        if (!isBillable(s)) return `It's ${esc(s.status)}, so no charge is expected. Set it back to active if that changes.`;
        if (!rd) return `Add a billing start date (Edit → <i>Billing start date</i>) and I'll work out the next charge — any past payment date will do.`;
        return `<b>${money(s.price)}</b> on <b>${askDate(rd)}</b> — ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${plural(days, 'day')}`}${s.cycle === 'yearly' ? ` (that's ≈ ${money(toMonthly(s))} a month)` : ''}${s.paymentMethod ? `, charged to ${esc(s.paymentMethod)}` : ''}.`;
      case 'paid': {
        if (!s.startDate) return `Add a billing start date and I can add it up — any past payment date works.`;
        const now = new Date(); now.setHours(23, 59, 59, 0);
        const jan1 = new Date(now.getFullYear(), 0, 1);
        const y = chargesBetween(s, jan1, now), all = chargesBetween(s, new Date(2000, 0, 1), now);
        const since = new Date(s.startDate + 'T00:00:00');
        return `About <b>${money(y * s.price)}</b> so far this year (${plural(y, 'charge')} of ${money(s.price)}${s.cycle === 'yearly' ? ' a year' : ' a month'}). Since ${askDate(since)} that's roughly <b>${money(all * s.price)}</b> over ${plural(all, 'payment')}${isBillable(s) ? `, and it adds up to <b>${money(toYearly(s))}</b> a year if it keeps going` : ''}.`;
      }
      case 'cancel': {
        const svc = svcFor(s); const url = s.url || (svc && svc.url) || '';
        const steps = `Usually it's Account → Subscription (or Membership / Billing) → Cancel, and you keep access until the period you've paid for ends.`;
        return `${url ? `Open your <b>${esc(s.name)}</b> account page: <a href="${esc(url)}" target="_blank" rel="noopener">${esc(hostOf(url) || url)}</a>. ` : ''}${steps}${/paid through (apple|google play)/i.test(s.notes || '') ? ` This one is billed through ${/apple/i.test(s.notes) ? 'Apple — cancel it in Settings → your name → Subscriptions on your iPhone' : 'Google Play — cancel it in the Play Store → Payments & subscriptions'}.` : ''} Once you've done it, mark it here so it drops out of your totals: <button class="ask-chip" data-ask-chip="mark" data-arg="cancelled">Mark as cancelled</button>`;
      }
      case 'price':
        return `<b>${money(s.price)}</b> per ${per}${s.cycle === 'yearly' ? ` — about ${money(toMonthly(s))} a month` : ` — ${money(toYearly(s))} a year`}.${s.notes ? ` Note: “${esc(s.notes)}”.` : ''}`;
      case 'card':
        return s.paymentMethod ? `It's paid with <b>${esc(s.paymentMethod)}</b>${/paid through/i.test(s.notes || '') ? ` (${esc((s.notes.match(/paid through [^·]+/i) || [''])[0].trim())})` : ''}.` : `No payment method recorded. Add it under Edit → <i>Payment method</i>, or tap <b>Check my inbox</b> — receipts usually show the card's last four digits.`;
      case 'summary':
        return `<b>${esc(s.name)}</b> · ${money(s.price)}/${per === 'year' ? 'yr' : 'mo'} · ${esc(s.status)}${rd && isBillable(s) ? ` · next charge ${askDate(rd)}` : ''}${s.paymentMethod ? ` · ${esc(s.paymentMethod)}` : ''}${s.accountEmail ? ` · ${esc(s.accountEmail)}` : ''}${s.startDate ? ` · since ${askDate(new Date(s.startDate + 'T00:00:00'))}` : ''}${s.notes ? ` · “${esc(s.notes)}”` : ''}.`;
      default:
        return `I can tell you whether it's active, which email it's under, when the next charge is, what you've paid, how to cancel, or check your inbox for the latest receipt — tap one below or ask in your own words.`;
    }
  }
  // ── inbox check ──
  function askOfferMailboxes() {
    const chips = [];
    (settings.mailboxes || []).forEach(m => { if (discReady(m.provider)) chips.push({ label: `${m.provider === 'gmail' ? 'Gmail' : 'Outlook'} · ${m.email}`, action: 'check', arg: m.provider + '|' + m.email }); });
    if (discReady('gmail')) chips.push({ label: chips.some(c => c.arg.startsWith('gmail|')) ? 'Another Gmail account' : 'Gmail', action: 'check', arg: 'gmail|' });
    if (discReady('outlook')) chips.push({ label: chips.some(c => c.arg.startsWith('outlook|')) ? 'Another Outlook account' : 'Outlook / Hotmail', action: 'check', arg: 'outlook|' });
    if (!chips.length) { askSay('ai', `Email checking isn't set up in this build yet.`); return; }
    if (isNative()) { askSay('ai', `Looking in a mailbox happens in your phone's browser (Google and Microsoft don't allow their sign-in inside apps). I'll open the web app on this subscription — sign in to SubTracker there so any changes sync back.`, { chips: [{ label: 'Open in browser', action: 'open-web', arg: '' }] }); return; }
    askSay('ai', `Which mailbox should I look in? I'll search the last 6 months for <b>${esc(askSub().name)}</b> receipts, read-only, and switch access off again straight after.`, { chips });
  }
  async function askCheck(provider, email) {
    const s = askSub(); if (!s || !DISC || ask.busy) return;
    const p = discProvider(provider); if (!p || !p.ready()) return;
    ask.busy = true; ask.pending = { provider, email };
    const who = provider === 'gmail' ? 'Google' : 'Microsoft';
    askSay('ai', `Signing in with ${who}${email ? ` as ${esc(email)}` : ''}… finish the sign-in in the window that opens (approve it in your Authenticator app if you use one).`);
    let session;
    try {
      await p.prepare();
      session = await p.connect({ loginHint: email || '', prompt: email ? '' : 'select_account', onRedirect: () => { try { sessionStorage.setItem('subtracker_ask_pending', JSON.stringify({ id: s.id, provider })); } catch {} ask.thread.push({ role: 'ai', html: `Taking you to ${who} — you'll come straight back here.` }); renderAsk(); } });
    } catch (e) {
      ask.busy = false; ask.pending = null;
      askSay('ai', /^cancelled$/.test(e && e.message || '') ? 'Sign-in was cancelled — no problem.' : esc((e && e.message) || 'Could not connect'));
      return;
    }
    await askRunCheck(session);
  }
  async function askRunCheck(session) {
    const s = askSub(); if (!s) return;
    ask.busy = true;
    askSay('ai', `Looking for <b>${esc(s.name)}</b> receipts in ${esc(session.email || 'that mailbox')}…`);
    try {
      const svc = svcFor(s);
      const canon = svc ? svc.name : s.name;
      const aliases = Object.entries(window.SERVICE_ALIASES || {}).filter(([, v]) => v === canon).map(([k]) => k);
      if (svc && svc.name !== s.name) aliases.push(svc.name);
      const res = await DISC.check(session, { name: s.name, domain: s.domain || (svc && svc.domain) || hostOf(s.url || ''), aliases, months: 6 });
      rememberMailbox(session.provider, res.email || session.email || '', 0);
      ask.busy = false; ask.pending = null;
      askSay('ai', ...askCheckSummary(s, res));
    } catch (e) {
      ask.busy = false; ask.pending = null;
      askSay('ai', esc((e && e.message) || 'The check failed'));
    }
  }
  // Turn the check result into an answer + proposed changes → [html, { chips }]
  function askCheckSummary(s, res) {
    const email = res.email || '';
    if (!res.matched || (!res.latest && !res.cancelled && !res.failed && !res.trial)) {
      const chips = [];
      (settings.mailboxes || []).filter(m => m.email !== email && discReady(m.provider)).forEach(m => chips.push({ label: `Try ${m.email}`, action: 'check', arg: m.provider + '|' + m.email }));
      chips.push({ label: 'Another mailbox', action: 'check-pick', arg: '' });
      return [`Nothing from <b>${esc(s.name)}</b> turned up in <b>${esc(email)}</b> in the last 6 months (${res.scanned} emails looked at). It may be billed to a different address${s.accountEmail && s.accountEmail !== email ? ` — you have it down as ${esc(s.accountEmail)}` : ''}, or the receipts come through Apple/Google Play/PayPal under another name.`, { chips }];
    }
    const L = res.latest, parts = [], updates = {}, why = [];
    const isoToDate = iso => iso ? new Date(iso + 'T00:00:00') : null;
    let verdict = '';
    if (L) {
      parts.push(`Latest receipt: <b>${askDate(isoToDate(L.date))}</b>${L.amount != null ? ` — <b>${L.currency && L.currency !== 'AUD' ? L.currency + ' ' : ''}${money(L.amount)}</b>` : ''}${L.card ? ` on ${esc(L.card)}` : ''}${L.via ? ` via ${esc(L.via)}` : ''}${res.receipts > 1 ? ` · ${plural(res.receipts, 'receipt')} in 6 months` : ''}.`);
    }
    if (res.cancelled && (!L || res.cancelled.date >= L.date)) {
      verdict = 'cancelled';
      parts.push(`Then a cancellation email on <b>${askDate(isoToDate(res.cancelled.date))}</b> (“${esc(res.cancelled.subject)}”) — so it looks <b>cancelled</b>.`);
      if (s.status !== 'cancelled') { updates.status = 'cancelled'; why.push('mark it cancelled'); }
    } else if (res.failed && L && res.failed.date > L.date) {
      verdict = 'trouble';
      parts.push(`A failed-payment email arrived on <b>${askDate(isoToDate(res.failed.date))}</b> after that receipt — the card may need updating.`);
    } else if (L) {
      verdict = 'active';
      const cyc = L.cycle || s.cycle; const next = isoToDate(L.date); if (next) { if (cyc === 'yearly') next.setFullYear(next.getFullYear() + 1); else if (cyc === 'weekly') next.setDate(next.getDate() + 7); else next.setMonth(next.getMonth() + 1); }
      const renews = L.renews ? isoToDate(L.renews) : null;
      parts.push(`No cancellation or failed-payment emails since, so it looks <b>active</b>${renews ? ` — the receipt says it renews on <b>${askDate(renews)}</b>` : next ? ` — next charge expected around <b>${askDate(next)}</b>` : ''}.`);
      if (s.status === 'cancelled' || s.status === 'paused') { updates.status = 'active'; why.push('set it back to active'); }
    } else if (res.trial) {
      verdict = 'trial';
      parts.push(`Only a trial email so far (<b>${askDate(isoToDate(res.trial.date))}</b>) — no receipts yet.`);
      if (s.status !== 'trial') { updates.status = 'trial'; why.push('mark it as a trial'); }
    }
    parts.push(`Linked email: <b>${esc(email)}</b>.`);
    if (email && s.accountEmail !== email) { updates.accountEmail = email; why.push(s.accountEmail ? `change the account email from ${s.accountEmail}` : `record ${email} as the account email`); }
    if (L && L.date && (!s.startDate || L.date > s.startDate) && verdict !== 'cancelled') { updates.startDate = L.date; why.push(`set the billing date to ${askDate(isoToDate(L.date))}`); }
    if (L && L.amount != null && (!L.currency || L.currency === 'AUD') && Math.abs(Number(L.amount) - Number(s.price)) > 0.005 && (L.cycle || s.cycle) === s.cycle) { updates.price = L.amount; why.push(`update the price to ${money(L.amount)}`); }
    if (L && L.card && !s.paymentMethod) { updates.paymentMethod = L.card; why.push(`note the card (${L.card})`); }
    ask.proposal = Object.keys(updates).length ? updates : null;
    const chips = [];
    if (ask.proposal) { chips.push({ label: `Apply: ${why.join(', ')}`, action: 'apply', arg: '' }); chips.push({ label: 'Leave it as is', action: 'dismiss', arg: '' }); }
    else parts.push(`Everything on your entry already matches.`);
    return [parts.join(' '), { chips }];
  }
  function askApply() {
    const s = askSub(); if (!s || !ask.proposal) return;
    commit({ ...s, ...ask.proposal });
    const n = Object.keys(ask.proposal).length; ask.proposal = null;
    askSay('ai', `Done — ${plural(n, 'change')} saved.`);
    toast('Updated');
  }
  function askChip(action, arg) {
    const s = askSub(); if (!s) return;
    if (action === 'check') { const [provider, email] = String(arg || '').split('|'); askSay('me', email ? `Check ${esc(email)}` : `Check a ${provider === 'gmail' ? 'Gmail' : 'Outlook'} account`); askCheck(provider, email || ''); }
    else if (action === 'check-pick') { askOfferMailboxes(); }
    else if (action === 'apply') { askApply(); }
    else if (action === 'dismiss') { ask.proposal = null; askSay('ai', 'OK, left as is.'); }
    else if (action === 'mark') { commit({ ...s, status: arg || 'cancelled' }); askSay('ai', `Marked as <b>${esc(arg || 'cancelled')}</b>.`); }
    else if (action === 'open-web') { const u = (CFG.EDITION_URL || APP_URL || '') + ((CFG.EDITION_URL || APP_URL || '').includes('?') ? '&' : '?') + 'ask=' + encodeURIComponent(s.id); try { window.open(u, '_blank'); } catch { location.href = u; } }
  }
  // Return leg of a full-page Microsoft sign-in started from the Ask panel
  function askPendingResume() { try { const j = sessionStorage.getItem('subtracker_ask_pending'); if (!j) return null; sessionStorage.removeItem('subtracker_ask_pending'); return JSON.parse(j); } catch { return null; } }

  // ── Age gate (adults-only services) ─────────────────────────────────
  function openAgeGate() {
    $('age-body').innerHTML = `
      <div class="age-ic">🔞</div>
      <div class="sheet-title" style="text-align:center">Adults only</div>
      <p class="age-text">This unlocks adult subscription services (for example OnlyFans or Pornhub Premium) in the service picker, so you can track what they cost like anything else.</p>
      <p class="age-text">You must be <b>18 or older</b> to turn this on. It stays unlocked on this device until you switch it off in Settings.</p>
      <label class="check-row"><input type="checkbox" id="age-confirm"/><span>I confirm I am 18 years of age or older</span></label>
      <div class="sheet-actions">
        <button class="btn-secondary" data-close="age-overlay">Cancel</button>
        <button class="btn-primary" data-action="age-unlock" disabled>Unlock</button>
      </div>`;
    $('age-overlay').classList.add('open');
  }
  function unlockAdult() {
    settings.adultUnlocked = true; settings.adultUnlockedAt = new Date().toISOString(); saveSettings();
    $('age-overlay').classList.remove('open');
    refreshTiles();
    const c = $('f-cat'); if (c) c.innerHTML = catOptions(c.value);
    if (view === 'settings') renderSettings();
    toast('Adults-only services unlocked');
  }
  function lockAdult() {
    settings.adultUnlocked = false; saveSettings();
    refreshTiles(); if (view === 'settings') renderSettings();
    toast('Adults-only services hidden');
  }

  // ── Filter sheet (mobile) ────────────────────────────────────────────
  function openFilter() {
    document.querySelectorAll('#fp-status .opt-pill').forEach(p => p.classList.toggle('active', p.dataset.val === filterStatus));
    document.querySelectorAll('#fp-cycle .opt-pill').forEach(p => p.classList.toggle('active', p.dataset.val === filterCycle));
    document.querySelectorAll('#fp-sort .opt-pill').forEach(p => p.classList.toggle('active', p.dataset.val === sortBy));
    $('filter-overlay').classList.add('open');
  }
  const closeFilter = () => $('filter-overlay').classList.remove('open');
  function applyFilter() {
    filterStatus = (document.querySelector('#fp-status .opt-pill.active') || {}).dataset?.val || 'all';
    filterCycle = (document.querySelector('#fp-cycle .opt-pill.active') || {}).dataset?.val || 'all';
    sortBy = (document.querySelector('#fp-sort .opt-pill.active') || {}).dataset?.val || 'renewal';
    syncChips(); updateFilterDot(); closeFilter(); render();
  }
  function syncChips() { document.querySelectorAll('#m-chips .chip').forEach(c => c.classList.toggle('active', c.dataset.val === filterStatus)); }
  function updateFilterDot() { const d = $('filter-dot'); if (d) d.classList.toggle('hidden', filterStatus === 'all' && filterCycle === 'all' && sortBy === 'renewal'); }

  // ── Auth sheet ───────────────────────────────────────────────────────
  // opts.prompt → opened automatically (shows "Not now"); invite banner when a code is pending
  let authOpts = {};
  function openAuth(mode = 'signin', opts = {}) {
    authOpts = opts;
    const inv = settings.pendingInvite;
    $('auth-body').innerHTML = `
      ${inv ? `<div class="auth-banner">🎉 <b>You've been invited to share a subscription list.</b> ${mode === 'signup' ? 'Create a free account' : 'Sign in'} to join it — code <b>${esc(fmtCode(inv))}</b>.</div>`
        : opts.prompt ? `<div class="auth-banner soft">${mode === 'signup' ? '<b>Create a free account</b> to back up your subscriptions, sync your phone and computer, share a list with someone, and get email reminders.' : '<b>Welcome back.</b> Sign in to sync your subscriptions.'}</div>` : ''}
      <div class="auth-tabs"><button class="auth-tab ${mode === 'signin' ? 'active' : ''}" data-auth-tab="signin">Sign in</button><button class="auth-tab ${mode === 'signup' ? 'active' : ''}" data-auth-tab="signup">Create account</button></div>
      <div class="form-row"><label>Email</label><input id="a-email" type="email" placeholder="you@example.com" autocomplete="email" inputmode="email"/></div>
      <div class="form-row"><label>Password</label><input id="a-pass" type="password" placeholder="${mode === 'signup' ? 'At least 6 characters' : '••••••••'}" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"/></div>
      <div id="a-error" class="form-error hidden"></div>
      <button class="btn-primary btn-block" data-auth-submit="${mode}">${mode === 'signin' ? 'Sign in' : 'Create account'}</button>
      ${mode === 'signin' ? `<button class="btn-secondary btn-block" style="margin-top:10px" data-auth-reset>Forgot password?</button>` : ''}
      ${opts.prompt ? `<button class="link-btn block" data-auth-later>Not now</button>` : ''}
      <div class="auth-note">${mode === 'signup' ? 'Your subscriptions on this device will be uploaded to your new account.' : 'Signing in merges this device\'s data with your account.'}</div>`;
    $('auth-overlay').classList.add('open');
    setTimeout(() => { const e = $('a-email'); if (e && !isMobile()) e.focus(); }, 300);
  }
  const closeAuth = () => $('auth-overlay').classList.remove('open');
  function dismissAuthPrompt() { settings.authPromptAt = Date.now(); saveSettings(); closeAuth(); }
  async function submitAuth(mode) {
    const email = $('a-email').value.trim(), pass = $('a-pass').value, err = $('a-error'), btn = document.querySelector('[data-auth-submit]');
    err.classList.add('hidden');
    if (!email || !pass) { err.textContent = 'Email and password are required.'; err.classList.remove('hidden'); return; }
    btn.disabled = true; btn.textContent = mode === 'signin' ? 'Signing in…' : 'Creating…';
    try {
      if (mode === 'signup') {
        const r = await window.Sync.signUp(email, pass);
        if (r.needsConfirm) {
          $('auth-body').innerHTML = `<div class="auth-ok"><div class="big">📬</div><p><b>Check your email.</b><br>We sent a confirmation link to <b>${esc(email)}</b>. Tap it, then come back here and sign in.${settings.pendingInvite ? '<br><br>Your invite is saved — you\'ll join the shared list as soon as you sign in.' : ''}</p><button class="btn-primary btn-block" style="margin-top:18px" data-auth-close>Done</button></div>`;
          return;
        }
      } else {
        await window.Sync.signIn(email, pass);
      }
      closeAuth(); toast(mode === 'signup' ? 'Account created' : 'Signed in');
    } catch (e) {
      err.textContent = e.message || 'Something went wrong.'; err.classList.remove('hidden');
      btn.disabled = false; btn.textContent = mode === 'signin' ? 'Sign in' : 'Create account';
    }
  }

  // ── Share & invite ───────────────────────────────────────────────────
  const fmtCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-');
  const inviteUrl = code => (APP_URL ? APP_URL + (APP_URL.includes('?') ? '&' : '?') : '?') + 'invite=' + code;

  function inviteFriend() {
    const url = APP_URL || location.href;
    shareText('SubTracker', 'I use SubTracker to keep track of all my subscriptions and what they cost — free, works on phone and computer:', url);
  }
  async function openShareList() {
    if (!window.Sync.user) { openAuth('signup'); return; }
    const body = $('share-body');
    body.innerHTML = `<div class="sheet-title">Share your list</div><div class="empty-sub" style="padding:20px 0">Creating invite…</div>`;
    $('share-overlay').classList.add('open');
    try {
      const code = await window.Sync.createInvite();
      const url = inviteUrl(code);
      body.innerHTML = `
        <div class="sheet-title">Share your list</div>
        <p class="age-text">Whoever uses this code joins <b>your list</b>: you'll both see, add and edit the same subscriptions, and the totals include everything. Good for a partner, family or housemates.</p>
        <div class="invite-code">${esc(fmtCode(code))}</div>
        <div class="invite-link">${esc(url)}</div>
        <div class="btn-row">
          <button class="btn-primary" data-action="share-invite" data-code="${esc(code)}">Share link</button>
          <button class="btn-secondary" data-action="copy-code" data-code="${esc(code)}">Copy code</button>
        </div>
        <div class="auth-note">Code works for 14 days. Anyone who joins can add, edit and delete subscriptions on the list, and you can remove them in Settings at any time.</div>
        <button class="btn-secondary btn-block" style="margin-top:12px" data-close="share-overlay">Done</button>`;
    } catch (e) {
      body.innerHTML = `<div class="sheet-title">Share your list</div><div class="form-error">${esc(e.message || 'Could not create an invite. Check your connection and try again.')}</div><button class="btn-secondary btn-block" style="margin-top:12px" data-close="share-overlay">Close</button>`;
    }
  }
  function openJoinList(prefill) {
    if (!window.Sync.user) { openAuth('signin'); return; }
    $('share-body').innerHTML = `
      <div class="sheet-title">Join someone's list</div>
      <p class="age-text">Enter the invite code they sent you. You'll move onto their list — your current subscriptions come with you and are merged in.</p>
      <div class="form-row"><label>Invite code</label><input id="join-code" type="text" value="${esc(fmtCode(prefill || ''))}" placeholder="ABCD-EFGH" autocomplete="off" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.15em;font-weight:600"/></div>
      <div id="join-error" class="form-error hidden"></div>
      <div class="sheet-actions">
        <button class="btn-secondary" data-close="share-overlay">Cancel</button>
        <button class="btn-primary" data-action="join-submit">Join list</button>
      </div>`;
    $('share-overlay').classList.add('open');
    setTimeout(() => { const i = $('join-code'); if (i && !i.value) i.focus(); }, 300);
  }
  async function submitJoin() {
    const code = ($('join-code') || {}).value || '', err = $('join-error'), btn = document.querySelector('[data-action="join-submit"]');
    if (!code.replace(/[^A-Za-z0-9]/g, '')) { err.textContent = 'Enter the code first.'; err.classList.remove('hidden'); return; }
    err.classList.add('hidden'); btn.disabled = true; btn.textContent = 'Joining…';
    try {
      const r = await window.Sync.acceptInvite(code);
      settings.pendingInvite = ''; saveSettings();
      listInfoFor = null;
      $('share-overlay').classList.remove('open');
      toast(`You've joined ${r && r.owner_email ? r.owner_email + "'s" : 'the shared'} list`, 3500);
      showView('home');
    } catch (e) {
      err.textContent = e.message || 'Could not join.'; err.classList.remove('hidden');
      btn.disabled = false; btn.textContent = 'Join list';
    }
  }
  async function applyPendingInvite() {
    const code = settings.pendingInvite; if (!code || !window.Sync || !window.Sync.user) return;
    document.querySelectorAll('.sheet-overlay.open').forEach(o => o.classList.remove('open'));
    openJoinList(code);
  }
  async function leaveList() {
    if (!confirm('Leave this shared list? The subscriptions stay with the list, and you start with an empty one of your own.')) return;
    try { await window.Sync.leaveList(); listInfoFor = null; toast('You left the list'); showView('home'); }
    catch (e) { toast(e.message || 'Could not leave'); }
  }
  async function removeMember(uid, email) {
    if (!confirm(`Remove ${email || 'this person'} from your list? They will keep a copy of nothing — the subscriptions stay here.`)) return;
    try { await window.Sync.removeMember(uid); listInfoFor = null; toast('Removed'); renderSettings(); }
    catch (e) { toast(e.message || 'Could not remove'); }
  }

  // ── Email reminders ──────────────────────────────────────────────────
  async function setEmailReminders(on) {
    try {
      let tz = 'Australia/Brisbane'; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch {}
      await window.Sync.setProfile({ email_reminders: on, reminder_days: settings.notifyDays, timezone: tz });
      profile = Object.assign(profile || {}, { email_reminders: on, reminder_days: settings.notifyDays });
      toast(on ? `Email reminders on · ${plural(settings.notifyDays, 'day')} before` : 'Email reminders off');
    } catch (e) { toast('Could not save: ' + (e.message || e)); }
    renderSettings();
  }

  // ── Export / import ──────────────────────────────────────────────────
  async function downloadFile(filename, content, mime) {
    const FS = plugin('Filesystem'), SH = plugin('Share');
    if (FS && SH && isNative()) {
      try {
        const res = await FS.writeFile({ path: filename, data: content, directory: 'CACHE', encoding: 'utf8' });
        await SH.share({ title: filename, url: res.uri });
        return;
      } catch (e) { /* fall through to web */ }
    }
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function exportJSON() {
    const payload = { app: 'SubTracker', version: CFG.APP_VERSION || '1.1.0', exportedAt: new Date().toISOString(), subscriptions: subs };
    downloadFile(`subtracker-backup-${isoDate(new Date())}.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast('Backup ready');
  }
  function exportCSV() {
    const cols = ['name', 'category', 'price', 'cycle', 'status', 'startDate', 'nextRenewal', 'paymentMethod', 'url', 'notes'];
    const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = subs.map(s => { const rd = nextRenewalDate(s.startDate, s.cycle); return cols.map(c => q(c === 'nextRenewal' ? (rd ? isoDate(rd) : '') : s[c])).join(','); });
    downloadFile(`subtracker-${isoDate(new Date())}.csv`, [cols.join(','), ...rows].join('\r\n'), 'text/csv');
    toast('CSV ready');
  }
  function importJSON(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        const list = Array.isArray(data) ? data : data.subscriptions;
        if (!Array.isArray(list)) throw new Error('Not a SubTracker backup');
        let added = 0, updated = 0; const changed = [];
        list.forEach(raw => {
          if (!raw || !raw.name || raw.deletedAt) return;
          const s = {
            id: typeof raw.id === 'string' && raw.id.length >= 20 ? raw.id : uuid(),
            name: String(raw.name), emoji: raw.emoji || null, category: CATEGORIES.includes(raw.category) ? raw.category : 'other',
            price: parseFloat(raw.price) || 0, cycle: raw.cycle === 'yearly' ? 'yearly' : 'monthly',
            status: ['active', 'trial', 'paused', 'cancelled'].includes(raw.status) ? raw.status : 'active',
            startDate: raw.startDate || '', paymentMethod: raw.paymentMethod || '', url: raw.url || '', domain: raw.domain || '', notes: raw.notes || '',
            updatedAt: raw.updatedAt || new Date().toISOString(),
          };
          const i = subs.findIndex(x => x.id === s.id);
          if (i >= 0) { if ((s.updatedAt || '') > (subs[i].updatedAt || '')) { subs[i] = s; updated++; changed.push(s); } }
          else { subs.push(s); added++; changed.push(s); tombs = tombs.filter(t => t.id !== s.id); }
        });
        saveLocal();
        if (window.Sync && window.Sync.user && changed.length) window.Sync.pushAll(changed);
        scheduleNotifications(); render();
        toast(`Imported ${added} new, ${updated} updated`);
      } catch (e) { toast('Could not read that file'); }
    };
    r.readAsText(file);
  }
  async function clearAll() {
    if (!confirm(`Delete all ${subs.length} subscriptions? This cannot be undone.`)) return;
    if (!confirm('Really delete everything?')) return;
    const now = new Date().toISOString();
    const gone = subs.map(s => ({ ...s, deletedAt: now, updatedAt: now }));
    subs = []; tombs = tombs.filter(t => !gone.some(g => g.id === t.id)).concat(gone); saveLocal();
    if (window.Sync && window.Sync.user && gone.length) await window.Sync.pushAll(gone);
    scheduleNotifications(); render(); toast('All data deleted');
  }

  // ── Onboarding + automatic sign-up prompt ────────────────────────────
  function maybeOnboard() {
    const ob = $('onboarding'); if (!ob) return;
    if (settings.onboarded || subs.length > 0) { ob.classList.add('hidden'); return false; }
    ob.classList.remove('hidden'); return true;
  }
  function finishOnboarding() {
    settings.onboarded = true; saveSettings();
    $('onboarding').classList.add('hidden');
    maybePromptAuth(true);
  }
  function maybePromptAuth(force) {
    const S = window.Sync; if (!S || !S.configured) return;
    S.ready.then(u => {
      if (u) return;
      if (settings.pendingInvite) { openAuth('signup'); return; }
      if (!force && settings.authPromptAt && Date.now() - settings.authPromptAt < DAY) return;
      if (document.querySelector('.sheet-overlay.open')) return;
      openAuth('signup', { prompt: true });
    });
  }

  // ── Event wiring (delegated) ─────────────────────────────────────────
  function wire() {
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-action],[data-view],[data-id],[data-edit],[data-tile],[data-form-save],[data-form-cancel],[data-form-delete],[data-detail-edit],[data-auth-tab],[data-auth-submit],[data-auth-reset],[data-auth-close],[data-auth-later],[data-close],[data-ob-start],[data-ob-skip],[data-stop],[data-ask],[data-ask-chip],.opt-pill,.chip');
      if (!t) return;
      if (t.hasAttribute('data-stop')) { e.stopPropagation(); return; }

      if (t.dataset.view) { showView(t.dataset.view); return; }
      if (t.dataset.edit) { e.stopPropagation(); $('review-overlay').classList.remove('open'); openEdit(t.dataset.edit); return; }
      if (t.dataset.id && (t.classList.contains('m-card') || t.classList.contains('d-card'))) { openDetail(t.dataset.id); return; }
      if (t.dataset.detailEdit) { closeDetail(); openEdit(t.dataset.detailEdit); return; }
      if (t.dataset.tile !== undefined) { pickSvc(t.dataset.tile); return; }
      if (t.hasAttribute('data-form-save')) { saveForm(); return; }
      if (t.hasAttribute('data-form-cancel')) { closeForm(); return; }
      if (t.hasAttribute('data-form-delete')) { deleteSub(editId); return; }
      if (t.hasAttribute('data-ob-start') || t.hasAttribute('data-ob-skip')) { finishOnboarding(); return; }
      if (t.dataset.authTab) { openAuth(t.dataset.authTab, authOpts); return; }
      if (t.dataset.authSubmit) { submitAuth(t.dataset.authSubmit); return; }
      if (t.hasAttribute('data-auth-reset')) {
        const email = ($('a-email') || {}).value || '';
        if (!email) { toast('Enter your email first'); return; }
        window.Sync.resetPassword(email).then(() => toast('Reset link sent')).catch(err => toast(err.message || 'Could not send'));
        return;
      }
      if (t.hasAttribute('data-auth-close')) { closeAuth(); return; }
      if (t.hasAttribute('data-auth-later')) { dismissAuthPrompt(); return; }
      if (t.dataset.close) { const el = $(t.dataset.close); if (el) el.classList.remove('open'); if (t.dataset.close === 'ask-overlay') closeAsk(); return; }
      if (t.dataset.ask) { askIntent(t.dataset.ask); return; }
      if (t.dataset.askChip) { askChip(t.dataset.askChip, t.dataset.arg || ''); return; }

      if (t.classList.contains('chip') && t.closest('#m-chips')) {
        filterStatus = t.dataset.val; syncChips(); updateFilterDot(); render(); return;
      }
      if (t.classList.contains('opt-pill')) {
        t.closest('.option-pills').querySelectorAll('.opt-pill').forEach(p => p.classList.remove('active'));
        t.classList.add('active'); return;
      }

      const action = t.dataset.action;
      if (!action) return;
      switch (action) {
        case 'add': openAdd(); break;
        case 'filter': openFilter(); break;
        case 'apply-filter': applyFilter(); break;
        case 'review': openReview(); break;
        case 'auth': openAuth('signin'); break;
        case 'auth-signup': openAuth('signup'); break;
        case 'sign-out': window.Sync.signOut().then(() => { listInfo = null; profile = null; listInfoFor = profileFor = null; toast('Signed out'); render(); }); break;
        case 'sync-now': toast('Syncing…'); listInfoFor = null; window.Sync.pull().then(() => { toast('Up to date'); renderSettings(); }); break;
        case 'test-notify': testNotify(); break;
        case 'exact-alarm': { const LN = plugin('LocalNotifications'); if (LN && LN.changeExactNotificationSetting) LN.changeExactNotificationSetting().catch(() => {}); break; }
        case 'export-json': exportJSON(); break;
        case 'export-csv': exportCSV(); break;
        case 'import': $('import-file').click(); break;
        case 'clear': clearAll(); break;
        case 'invite-friend': inviteFriend(); break;
        case 'share-list': openShareList(); break;
        case 'join-list': openJoinList(''); break;
        case 'join-submit': submitJoin(); break;
        case 'share-invite': shareText('Share my SubTracker list', `Join my subscription list on SubTracker — use invite code ${fmtCode(t.dataset.code)} or open:`, inviteUrl(t.dataset.code)); break;
        case 'copy-code': copyText(fmtCode(t.dataset.code)).then(ok => toast(ok ? 'Code copied' : 'Could not copy')); break;
        case 'share-copy': copyText(t.dataset.text).then(ok => toast(ok ? 'Link copied' : 'Could not copy')); break;
        case 'leave-list': leaveList(); break;
        case 'remove-member': { const r = t.closest('.member-row'); removeMember(t.dataset.user, r ? (r.querySelector('.set-row-label') || {}).textContent : ''); break; }
        case 'age-gate': openAgeGate(); break;
        case 'age-unlock': unlockAdult(); break;
        case 'duplicates': openDuplicates(); break;
        case 'duplicates-from-review': $('review-overlay').classList.remove('open'); openDuplicates(); break;
        case 'dup-remove': dupRemoveSelected(); break;
        case 'dup-ignore': dupIgnoreGroup(t.dataset.key); break;
        case 'discover': openDiscover(''); break;
        case 'ask': closeDetail(); closeForm(); openAsk(t.dataset.id); break;
        case 'discover-paste': if (!$('discover-overlay').classList.contains('open')) openDiscover(''); disc.state = 'paste'; disc.error = ''; renderDiscover(); setTimeout(() => { const ta = $('disc-paste'); if (ta) ta.focus(); }, 50); break;
        case 'discover-paste-go': discoverPasteGo(); break;
        case 'discover-connect': discoverConnect(t.dataset.provider, t.dataset.hint || ''); break;
        case 'discover-open-web': { const w = window.open(discWebUrl(), '_blank'); if (!w) copyText(discWebUrl()).then(() => toast('Link copied — open it in your browser')); break; }
        case 'discover-cancel': closeDiscover(); break;
        case 'discover-toggle-oneoff': disc.showOneOff = !disc.showOneOff; renderDiscover(); break;
        case 'discover-back': discAttempt++; disc.state = isNative() ? 'handoff' : 'choose'; disc.error = ''; disc.items = []; renderDiscover(); break;
        case 'discover-import': discoverImport(); break;
        case 'discover-forget': settings.mailboxes = (settings.mailboxes || []).filter(m => m.email !== t.dataset.email); saveSettings(); renderDiscover(); if (view === 'settings') renderSettings(); break;
      }
    });
    // discover sheet: tick boxes, inline edits
    document.addEventListener('click', e => {
      const ed = e.target.closest('[data-disc-edit]');
      if (ed && !e.target.closest('input,select,label')) { const i = +ed.dataset.discEdit; disc.editing = disc.editing === i ? -1 : i; renderDiscover(); }
    });

    // overlays close on backdrop tap
    document.querySelectorAll('.sheet-overlay').forEach(ov => ov.addEventListener('click', e => {
      if (e.target !== ov) return;
      if (ov.id === 'auth-overlay' && authOpts.prompt) dismissAuthPrompt(); else if (ov.id === 'discover-overlay') closeDiscover(); else ov.classList.remove('open');
    }));

    // inputs
    document.addEventListener('input', e => {
      if (e.target.id === 'm-search' || e.target.id === 'd-search') render();
      if (e.target.id === 'f-start' || e.target.id === 'f-cycle') updRenew();
      if (e.target.id === 'svc-search') { tileQuery = e.target.value; refreshTiles(); }
      if (e.target.id === 'f-name') { const t = e.target.value.trim(); if (selectedService && selectedService.name !== t) { selectedService = null; document.querySelectorAll('.service-tile').forEach(x => x.classList.remove('selected')); } }
      if (e.target.dataset.discField) { const it = disc.items[+e.target.dataset.i]; if (it) { const f = e.target.dataset.discField; it[f] = f === 'price' ? (e.target.value === '' ? null : parseFloat(e.target.value)) : e.target.value; if (f === 'name') { const row = e.target.closest('.disc-item'); const n = row && row.querySelector('.disc-name'); if (n) n.firstChild.textContent = e.target.value + ' '; } } }
    });
    document.addEventListener('change', async e => {
      if (['d-status', 'd-cycle', 'd-sort', 'f-cycle'].includes(e.target.id)) { if (e.target.id === 'f-cycle') updRenew(); else render(); }
      if (e.target.id === 'set-notify') {
        if (e.target.checked) {
          const ok = await requestNotifyPermission();
          if (!ok) { e.target.checked = false; toast(isNative() ? 'Allow notifications for SubTracker in your phone settings' : webPerm() === 'denied' ? 'Blocked — allow notifications for this site in your browser' : 'Notifications were not allowed'); renderSettings(); return; }
          settings.notifyEnabled = true; saveSettings(); scheduleNotifications(); checkDueSoon(); toast('Reminders on');
        } else { settings.notifyEnabled = false; saveSettings(); const LN = plugin('LocalNotifications'); if (LN) LN.getPending().then(p => p.notifications.length && LN.cancel(p)).catch(() => {}); toast('Reminders off'); }
        renderSettings();
      }
      if (e.target.id === 'set-email') setEmailReminders(e.target.checked);
      if (e.target.id === 'set-notify-days') { settings.notifyDays = +e.target.value; saveSettings(); scheduleNotifications(); if (profile && profile.email_reminders) setEmailReminders(true); }
      if (e.target.id === 'set-adult') { if (e.target.checked) { e.target.checked = false; openAgeGate(); } else lockAdult(); }
      if (e.target.id === 'age-confirm') { const b = document.querySelector('[data-action="age-unlock"]'); if (b) b.disabled = !e.target.checked; }
      if (e.target.dataset.dupKeep) { dupSetKeep(e.target.dataset.key, e.target.dataset.dupKeep); }
      if (e.target.dataset.dupRm) { dupToggleRemove(e.target.dataset.key, e.target.dataset.dupRm, e.target.checked); }
      if (e.target.dataset.discCheck !== undefined) { const it = disc.items[+e.target.dataset.discCheck]; if (it) { it.checked = e.target.checked; const n = disc.items.filter(x => x.checked).length; const b = document.querySelector('[data-action="discover-import"]'); if (b) { b.disabled = !n; b.textContent = `Add ${n || ''} to my list`.replace('  ', ' '); } e.target.closest('.disc-item').classList.toggle('on', it.checked); } }
      if (e.target.dataset.discField === 'cycle' || e.target.dataset.discField === 'status' || e.target.dataset.discField === 'lastDate') { const it = disc.items[+e.target.dataset.i]; if (it) it[e.target.dataset.discField] = e.target.value; }
      if (e.target.id === 'import-file' && e.target.files[0]) { importJSON(e.target.files[0]); e.target.value = ''; }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') document.querySelectorAll('.sheet-overlay.open').forEach(o => { if (o.id === 'discover-overlay') closeDiscover(); else if (o.id === 'ask-overlay') closeAsk(); else o.classList.remove('open'); });
      if (e.key === 'Enter' && e.target.closest('#auth-body')) { const b = document.querySelector('[data-auth-submit]'); if (b) b.click(); }
      if (e.key === 'Enter' && e.target.id === 'join-code') submitJoin();
    });
    document.addEventListener('submit', e => {
      if (e.target.id === 'ask-form') { e.preventDefault(); const inp = $('ask-input'); const q = (inp && inp.value || '').trim(); if (q) askIntent(q); if (inp) inp.value = ''; }
    });
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 120); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      render(); checkDueSoon(); refreshExactAlarm();
      if (window.Sync && window.Sync.user && Date.now() - lastVisPull > 20000) { lastVisPull = Date.now(); window.Sync.pull(); }
    });
    const AppPlugin = plugin('App');
    if (AppPlugin && AppPlugin.addListener) {
      try { AppPlugin.addListener('appUrlOpen', ev => { const code = inviteFromUrl(ev.url); if (code) { settings.pendingInvite = code; saveSettings(); applyPendingInvite(); } }); } catch {}
    }
  }

  function inviteFromUrl(url) {
    try { const u = new URL(url); return (u.searchParams.get('invite') || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || ''; } catch { return ''; }
  }

  // ── Boot ─────────────────────────────────────────────────────────────
  function boot() {
    load();
    // invite link?
    const code = inviteFromUrl(location.href);
    if (code) {
      settings.pendingInvite = code; saveSettings();
      try { history.replaceState(null, '', location.pathname + location.hash); } catch {}
    }
    wire();
    if (window.Sync) {
      window.Sync.on('onAuth', u => { if (!u) { listInfo = null; profile = null; } render(); if (discoverOpen()) renderDiscover(); if (u && settings.pendingInvite) setTimeout(applyPendingInvite, 400); });
      window.Sync.on('onStatus', st => { syncState = st; if (view === 'settings') renderSettings(); });
      window.Sync.on('onList', () => { listInfoFor = null; if (view === 'settings') renderSettings(); });
      window.Sync.on('onPulled', () => { if (pendingAskId && subs.find(x => x.id === pendingAskId)) { const id = pendingAskId; pendingAskId = ''; openAsk(id); } setTimeout(() => maybePromptDuplicates('sync'), 600); });
      window.Sync.init();
    }
    const onboarding = maybeOnboard();
    showView('home');
    syncChips(); updateFilterDot();
    checkDueSoon();
    scheduleNotifications();
    let connect = '', askId = '';
    try { const u = new URL(location.href); connect = u.searchParams.get('connect') || ''; askId = u.searchParams.get('ask') || ''; if (connect || askId) history.replaceState(null, '', location.pathname + location.hash); } catch {}
    if (askId && !isNative()) { if (subs.find(x => x.id === askId)) setTimeout(() => openAsk(askId), 400); else pendingAskId = askId; } // not here yet → after the first sync pull
    if (connect && !isNative()) { settings.pendingConnect = connect; saveSettings(); }
    else if (settings.pendingConnect && !isNative()) connect = settings.pendingConnect; // came back after signing in / a reload
    const resuming = !!(DISC && DISC.pendingResume && DISC.pendingResume() && !isNative()); // Microsoft is sending us back — discoverResume() opens the sheet
    if (connect && !isNative() && !resuming) { setTimeout(() => openDiscover(connect === '1' ? '' : connect), onboarding ? 0 : 300); }
    else if (!onboarding && !resuming) { maybePromptAuth(false); setTimeout(() => maybePromptDuplicates('boot'), 900); }
    discoverResume();

    // iOS install tip
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS && !isNative() && !window.navigator.standalone && !localStorage.getItem('subtracker_ios_tip') && isMobile()) {
      setTimeout(() => { const t = $('ios-tip'); if (t) t.style.display = 'block'; }, 3000);
    }
    const tipBtn = $('ios-tip-close'); if (tipBtn) tipBtn.onclick = () => { $('ios-tip').style.display = 'none'; localStorage.setItem('subtracker_ios_tip', '1'); };

    // Service worker (only on http/https, not file://)
    if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    // Capacitor status bar
    const SB = plugin('StatusBar');
    if (SB) { try { SB.setBackgroundColor({ color: '#0a0a0f' }); SB.setStyle({ style: 'DARK' }); } catch {} }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
