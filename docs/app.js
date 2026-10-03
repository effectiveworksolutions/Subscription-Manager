// ═══════════════════════════════════════════════════════════════════════
//  SubTracker — application logic
// ═══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const CFG = window.SUBTRACKER_CONFIG || {};
  const CUR = CFG.CURRENCY || '$';
  const BRAND_SVGS = window.BRAND_SVGS || {};
  const EMOJI_MAP = window.EMOJI_MAP || {};
  const SERVICE_LIBRARY = window.SERVICE_LIBRARY || [];
  const CATEGORIES = Object.keys(EMOJI_MAP);
  const CAT_COLORS = ['#a855f7','#34d399','#f59e0b','#38bdf8','#f472b6','#fb923c','#a3e635','#22d3ee','#e879f9','#facc15','#4ade80','#94a3b8'];

  // ── State ────────────────────────────────────────────────────────────
  let subs = [];
  let settings = { notifyEnabled: false, notifyDays: 3, onboarded: false };
  let view = 'home';
  let editId = null, selectedService = null;
  let filterStatus = 'all', filterCycle = 'all', sortBy = 'renewal';
  let syncState = { state: 'off', lastSyncAt: null, error: null };

  // ── Storage + migration ──────────────────────────────────────────────
  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function load() {
    try { subs = JSON.parse(localStorage.getItem('subs') || '[]') || []; } catch { subs = []; }
    try { Object.assign(settings, JSON.parse(localStorage.getItem('subtracker_settings') || '{}')); } catch {}
    // migrate: numeric ids → uuid, add updatedAt
    let changed = false;
    subs = subs.map(s => {
      const n = { ...s };
      if (typeof n.id !== 'string' || n.id.length < 20) { n.id = uuid(); changed = true; }
      if (!n.updatedAt) { n.updatedAt = new Date().toISOString(); changed = true; }
      if (typeof n.price !== 'number') { n.price = parseFloat(n.price) || 0; changed = true; }
      return n;
    });
    if (changed) saveLocal();
  }
  function saveLocal() { localStorage.setItem('subs', JSON.stringify(subs)); }
  function saveSettings() { localStorage.setItem('subtracker_settings', JSON.stringify(settings)); }

  // ── Helpers ──────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => CUR + (Math.round(n * 100) / 100).toFixed(2);
  const isMobile = () => window.innerWidth < 700;
  const isBillable = s => s.status === 'active' || s.status === 'trial';
  const toMonthly = s => s.cycle === 'yearly' ? s.price / 12 : s.price;
  const toYearly = s => s.cycle === 'yearly' ? s.price : s.price * 12;

  function nextRenewalDate(sd, cycle) {
    if (!sd) return null;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const d = new Date(sd + 'T00:00:00');
    if (isNaN(d)) return null;
    if (cycle === 'yearly') { while (d <= now) d.setFullYear(d.getFullYear() + 1); }
    else { while (d <= now) d.setMonth(d.getMonth() + 1); }
    return d;
  }
  function daysUntil(d) { if (!d) return 9999; const n = new Date(); n.setHours(0, 0, 0, 0); return Math.round((d - n) / 86400000); }
  const fmtDate = d => d ? d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' }) : '—';
  const fmtDateLong = d => d ? d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const isoDate = d => d.toISOString().slice(0, 10);
  function logoHtml(name, emoji) { return BRAND_SVGS[name] || `<span class="icon-fallback">${esc(emoji || '📦')}</span>`; }
  const getSvc = name => SERVICE_LIBRARY.find(s => s.name.toLowerCase() === String(name).toLowerCase()) || null;
  const badgeHtml = st => `<span class="badge badge-${esc(st)}">${esc(st)}</span>`;

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

  // ── Mutations (single path: local → cloud → notify → render) ─────────
  function commit(sub) {
    sub.updatedAt = new Date().toISOString();
    const i = subs.findIndex(s => s.id === sub.id);
    if (i >= 0) subs[i] = sub; else subs.push(sub);
    saveLocal();
    if (window.Sync && window.Sync.user) window.Sync.pushOne(sub);
    scheduleNotifications();
    render();
  }
  function remove(id) {
    subs = subs.filter(s => s.id !== id);
    saveLocal();
    if (window.Sync && window.Sync.user) window.Sync.deleteOne(id);
    scheduleNotifications();
    render();
  }

  // Exposed for sync.js
  window.App = {
    getSubs: () => subs,
    setSubs: (arr, fromSync) => { subs = arr; saveLocal(); if (fromSync) { scheduleNotifications(); render(); } },
  };

  // ── Notifications ────────────────────────────────────────────────────
  function hashInt(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h) % 2147483647; }

  async function requestNotifyPermission() {
    const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
    if (LN) { const r = await LN.requestPermissions(); return r.display === 'granted'; }
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const p = await Notification.requestPermission(); return p === 'granted';
  }

  async function scheduleNotifications() {
    if (!settings.notifyEnabled) return;
    const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
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
            title: `${s.name} renews ${settings.notifyDays === 0 ? 'today' : 'in ' + settings.notifyDays + ' day' + (settings.notifyDays === 1 ? '' : 's')}`,
            body: `${money(s.price)}${s.paymentMethod ? ' · ' + s.paymentMethod : ''}`,
            schedule: { at },
            smallIcon: 'ic_stat_icon',
          });
        }
      });
      if (list.length) await LN.schedule({ notifications: list });
    } catch (e) { /* non-fatal */ }
  }

  function checkDueSoon() {
    // Web fallback: fires when the app is opened
    if (!settings.notifyEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return;
    let notified = {}; try { notified = JSON.parse(localStorage.getItem('subtracker_notified') || '{}'); } catch {}
    const todayKey = isoDate(new Date());
    subs.filter(isBillable).forEach(s => {
      const rd = nextRenewalDate(s.startDate, s.cycle); const days = daysUntil(rd);
      if (days >= 0 && days <= settings.notifyDays) {
        const key = s.id + ':' + isoDate(rd);
        if (notified[key] !== todayKey) {
          try {
            new Notification(`${s.name} renews ${days === 0 ? 'today' : 'in ' + days + ' day' + (days === 1 ? '' : 's')}`, {
              body: `${money(s.price)}${s.paymentMethod ? ' · ' + s.paymentMethod : ''}`, icon: 'icon-192.png', tag: key,
            });
          } catch {}
          notified[key] = todayKey;
        }
      }
    });
    localStorage.setItem('subtracker_notified', JSON.stringify(notified));
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
      <div class="metric"><div class="metric-label">Annual</div><div class="metric-value">${CUR}${Math.round(yearly).toLocaleString()}</div><div class="metric-sub">${isFiltered ? 'shown subs' : 'excl. paused'}</div></div>
      <div class="metric"><div class="metric-label">Due soon</div><div class="metric-value">${dueSoon}</div><div class="metric-sub">within 7 days</div></div>`;
    if ($('m-summary')) $('m-summary').innerHTML = html;
    if ($('d-summary')) $('d-summary').innerHTML = html;
  }

  // ── Render: home list ────────────────────────────────────────────────
  function emptyHtml(q, fs) {
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
    const { q, fs } = currentFilters();

    if ($('m-label')) $('m-label').textContent = filtered.length ? count : '';
    if ($('m-list')) {
      $('m-list').innerHTML = filtered.length ? filtered.map(s => `
        <div class="m-card" data-id="${s.id}">
          <div class="sub-icon" style="width:48px;height:48px">${logoHtml(s.name, s.emoji || EMOJI_MAP[s.category])}</div>
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
            ${badgeHtml(s.status)}
          </div>
        </div>`).join('') : emptyHtml(q, fs);
    }

    if ($('d-label')) $('d-label').textContent = filtered.length ? count : '';
    if ($('d-list')) {
      $('d-list').innerHTML = filtered.length ? filtered.map(s => `
        <div class="d-card" data-id="${s.id}">
          <div class="sub-icon" style="width:46px;height:46px">${logoHtml(s.name, s.emoji || EMOJI_MAP[s.category])}</div>
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
            ${badgeHtml(s.status)}
            <button class="d-icon-btn" data-edit="${s.id}" title="Edit">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            ${s.url ? `<a class="d-icon-link" href="${esc(s.url)}" target="_blank" rel="noopener" data-stop title="Manage">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>` : ''}
          </div>
        </div>`).join('') : emptyHtml(q, fs);
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

    // category breakdown
    const byCat = {};
    billable.forEach(s => { byCat[s.category || 'other'] = (byCat[s.category || 'other'] || 0) + toMonthly(s); });
    const segs = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ label: k, value: v, color: CAT_COLORS[i % CAT_COLORS.length] }));

    // next 30 days
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
        <div class="metric"><div class="metric-label">Per year</div><div class="metric-value">${CUR}${Math.round(yearly).toLocaleString()}</div></div>
        <div class="metric"><div class="metric-label">Avg / sub</div><div class="metric-value">${money(avg)}</div></div>
        <div class="metric"><div class="metric-label">Next 30 days</div><div class="metric-value">${money(next30Total)}</div></div>
      </div>
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
              <div class="sub-icon">${logoHtml(s.name, s.emoji || EMOJI_MAP[s.category])}</div>
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
            <div class="tl-items">${d.items.map(s => `<div class="tl-item"><div class="sub-icon">${logoHtml(s.name, s.emoji || EMOJI_MAP[s.category])}</div><span>${esc(s.name)}</span><b>${money(s.price)}</b></div>`).join('')}
              ${d.items.length > 1 ? `<div class="tl-total">Day total <b>${money(dayTotal)}</b></div>` : ''}</div>
          </div>`; }).join('')}</div>
          <div class="tl-total" style="padding-top:12px;border-top:1px solid var(--border);margin-top:4px">Total next ${horizon} days <b>${money(next30Total)}</b></div>`
          : `<div class="empty-sub">Nothing due in the next ${horizon} days.</div>`}
      </div>`;
    if ($('m-insights')) $('m-insights').innerHTML = html;
    if ($('d-insights')) $('d-insights').innerHTML = html;
  }

  // ── Render: settings ─────────────────────────────────────────────────
  function renderSettings() {
    const S = window.Sync; const u = S && S.user;
    const canSync = S && S.configured;
    const lastSync = syncState.lastSyncAt ? new Date(syncState.lastSyncAt).toLocaleString('en-AU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : 'never';
    const dot = !canSync ? 'off' : syncState.state === 'error' ? 'err' : u ? 'on' : 'off';
    const nativeNotify = !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications);
    const perm = ('Notification' in window) ? Notification.permission : 'unsupported';

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
          <div class="set-row clickable" data-action="sync-now"><div class="set-row-main"><div class="set-row-label">Sync now</div><div class="set-row-sub">${syncState.error ? esc(syncState.error) : 'Pull latest from all your devices'}</div></div><svg class="set-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg></div>
          <div class="set-row clickable" data-action="sign-out"><div class="set-row-main"><div class="set-row-label">Sign out</div><div class="set-row-sub">Your data stays on this device</div></div><span class="set-row-val danger">Sign out</span></div>` : `
          <div class="account-card">
            <div class="avatar off">👤</div>
            <div class="account-info"><div class="account-name">Not signed in</div><div class="account-sub">Sign in to sync across your phone and computer</div></div>
          </div>
          <div class="set-row clickable" data-action="auth"><div class="set-row-main"><div class="set-row-label">Sign in or create account</div><div class="set-row-sub">Free · email and password</div></div><svg class="set-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></div>`}
      </div>

      <div class="set-group">
        <div class="set-group-title">Payment reminders</div>
        <div class="set-row">
          <div class="set-row-main"><div class="set-row-label">Remind me before renewals</div><div class="set-row-sub">${nativeNotify ? 'Notifications fire even when the app is closed' : perm === 'denied' ? 'Blocked in browser settings' : perm === 'unsupported' ? 'Not supported in this browser' : 'Shows when you open the app · install the app for background alerts'}</div></div>
          <label class="toggle"><input type="checkbox" id="set-notify" ${settings.notifyEnabled ? 'checked' : ''} ${perm === 'denied' || perm === 'unsupported' ? 'disabled' : ''}/><span class="track"></span></label>
        </div>
        <div class="set-row">
          <div class="set-row-main"><div class="set-row-label">Days before</div></div>
          <select id="set-notify-days">${[0, 1, 2, 3, 5, 7].map(n => `<option value="${n}" ${settings.notifyDays === n ? 'selected' : ''}>${n === 0 ? 'On the day' : n + ' day' + (n === 1 ? '' : 's')}</option>`).join('')}</select>
        </div>
        <div class="set-row clickable" data-action="test-notify"><div class="set-row-main"><div class="set-row-label">Send a test notification</div></div><svg class="set-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></div>
      </div>

      <div class="set-group">
        <div class="set-group-title">Your data</div>
        <div class="set-row clickable" data-action="export-json"><div class="set-row-main"><div class="set-row-label">Back up to file</div><div class="set-row-sub">JSON · can be restored into SubTracker</div></div><svg class="set-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg></div>
        <div class="set-row clickable" data-action="export-csv"><div class="set-row-main"><div class="set-row-label">Export to spreadsheet</div><div class="set-row-sub">CSV · opens in Excel or Google Sheets</div></div><svg class="set-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg></div>
        <div class="set-row clickable" data-action="import"><div class="set-row-main"><div class="set-row-label">Restore from backup</div><div class="set-row-sub">Import a JSON file · merges with existing</div></div><svg class="set-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg></div>
        <div class="set-row clickable" data-action="clear"><div class="set-row-main"><div class="set-row-label">Delete all data</div><div class="set-row-sub">${subs.length} subscription${subs.length !== 1 ? 's' : ''} on this device${u ? ' and in the cloud' : ''}</div></div><span class="set-row-val danger">Delete</span></div>
        <input type="file" id="import-file" accept=".json,application/json" class="hidden"/>
      </div>

      <div class="about"><b>SubTracker</b> v${esc(CFG.APP_VERSION || '1.0.0')}<br>Your data lives on your device${u ? ' and in your private cloud account' : ''}. Nobody else can see it.</div>
      </div>`;
    if ($('m-settings')) $('m-settings').innerHTML = html;
    if ($('d-settings')) $('d-settings').innerHTML = html;
  }

  function render() {
    if (view === 'home') renderHome();
    else if (view === 'insights') renderInsights();
    else if (view === 'settings') renderSettings();
    // keep summary fresh even on other tabs
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
        <div class="detail-icon">${logoHtml(s.name, s.emoji || EMOJI_MAP[s.category])}</div>
        <div><div class="detail-name">${esc(s.name)}</div><div class="detail-cat">${esc(s.category)}</div></div>
      </div>
      <div class="detail-row"><span class="detail-label">Price</span><span class="detail-value">${s.cycle === 'yearly' ? `${money(s.price)}/yr <span style="color:var(--text-faint);font-weight:400">(${money(toMonthly(s))}/mo)</span>` : `${money(s.price)}/mo`}</span></div>
      <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${badgeHtml(s.status)}</span></div>
      <div class="detail-row"><span class="detail-label">Next payment</span><span class="detail-value">${rd && isBillable(s) ? `${money(s.price)} · ${fmtDateLong(rd)}` : '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Payment method</span><span class="detail-value">${esc(s.paymentMethod) || '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Billing</span><span class="detail-value" style="text-transform:capitalize">${esc(s.cycle)}</span></div>
      <div class="detail-row"><span class="detail-label">Billing start</span><span class="detail-value">${s.startDate ? fmtDateLong(new Date(s.startDate + 'T00:00:00')) : '—'}</span></div>
      ${s.notes ? `<div class="detail-row"><span class="detail-label">Notes</span><span class="detail-value" style="font-style:italic;font-weight:400">${esc(s.notes)}</span></div>` : ''}
      <div class="detail-actions">
        <button class="btn-primary" data-detail-edit="${s.id}">Edit</button>
        ${s.url ? `<a class="btn-link" href="${esc(s.url)}" target="_blank" rel="noopener"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Manage</a>` : ''}
      </div>`;
    $('detail-overlay').classList.add('open');
  }
  const closeDetail = () => $('detail-overlay').classList.remove('open');

  // ── Form sheet ───────────────────────────────────────────────────────
  function openAdd() { editId = null; selectedService = null; showForm({}); }
  function openEdit(id) { const s = subs.find(x => x.id === id); if (!s) return; editId = id; selectedService = null; showForm(s); }

  function tileHtml() {
    return SERVICE_LIBRARY.map((svc, i) => {
      const svg = BRAND_SVGS[svc.name];
      const icon = svg ? `<div class="tile-brand-svg">${svg}</div>` : `<span class="tile-emoji">${esc(svc.emoji)}</span>`;
      return `<div class="service-tile" data-tile="${i}">${icon}<span>${esc(svc.name)}</span></div>`;
    }).join('');
  }
  function pickSvc(idx) {
    selectedService = idx;
    document.querySelectorAll('.service-tile').forEach((t, i) => t.classList.toggle('selected', i === idx));
    const svc = SERVICE_LIBRARY[idx]; if (!svc) return;
    if (svc.name !== 'Custom…') {
      const n = $('f-name'); if (n && !n.value) n.value = svc.name;
      const c = $('f-cat'); if (c) c.value = svc.category;
      const u = $('f-url'); if (u && !u.value && svc.url) u.value = svc.url;
    }
    const p = $('f-price'); if (p) p.focus();
  }
  function updRenew() {
    const sd = ($('f-start') || {}).value, cy = ($('f-cycle') || {}).value || 'monthly', el = $('renew-preview');
    if (!el) return;
    if (!sd) { el.textContent = 'Enter the billing start date to calculate'; return; }
    const rd = nextRenewalDate(sd, cy), d = daysUntil(rd);
    el.textContent = rd ? `${fmtDateLong(rd)} (in ${d} day${d !== 1 ? 's' : ''})` : '—';
  }
  function showForm(s) {
    $('form-title').textContent = editId ? 'Edit Subscription' : 'Add Subscription';
    $('form-body').innerHTML = `
      ${editId ? '' : `<div style="margin-bottom:14px"><div class="filter-section-label" style="margin-bottom:8px">Quick pick a service</div><div class="service-grid">${tileHtml()}</div></div><div class="or-divider">or enter manually</div>`}
      <div class="form-row"><label>Name</label><input id="f-name" type="text" value="${esc(s.name || '')}" placeholder="e.g. Netflix" autocomplete="off"/></div>
      <div class="form-grid">
        <div class="form-row"><label>Price (${CUR})</label><input id="f-price" type="number" min="0" step="0.01" value="${s.price != null ? s.price : ''}" placeholder="9.99" inputmode="decimal"/></div>
        <div class="form-row"><label>Billing</label><select id="f-cycle"><option value="monthly" ${s.cycle !== 'yearly' ? 'selected' : ''}>Monthly</option><option value="yearly" ${s.cycle === 'yearly' ? 'selected' : ''}>Yearly</option></select></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>Category</label><select id="f-cat">${CATEGORIES.map(c => `<option value="${c}" ${s.category === c ? 'selected' : ''}>${EMOJI_MAP[c]} ${c[0].toUpperCase() + c.slice(1)}</option>`).join('')}</select></div>
        <div class="form-row"><label>Status</label><select id="f-status">${['active', 'trial', 'paused', 'cancelled'].map(st => `<option value="${st}" ${(s.status || 'active') === st ? 'selected' : ''}>${st[0].toUpperCase() + st.slice(1)}</option>`).join('')}</select></div>
      </div>
      <div class="form-row"><label>Billing start date</label><input id="f-start" type="date" value="${esc(s.startDate || '')}"/><div class="form-hint">Any past payment date works — we roll it forward automatically.</div></div>
      <div class="form-row"><label>Next renewal (auto)</label><div class="renew-display" id="renew-preview"></div></div>
      <div class="form-row"><label>Payment method</label><input id="f-payment" type="text" value="${esc(s.paymentMethod || '')}" placeholder="e.g. Visa 1234, PayPal" autocomplete="off"/></div>
      <div class="form-row"><label>Manage URL (optional)</label><input id="f-url" type="url" value="${esc(s.url || '')}" placeholder="https://…" autocomplete="off"/></div>
      <div class="form-row"><label>Notes (optional)</label><input id="f-notes" type="text" value="${esc(s.notes || '')}" placeholder="e.g. Family plan, 2 seats"/></div>
      <div id="f-error" class="form-error hidden"></div>
      <div class="sheet-actions">
        ${editId ? `<button class="btn-danger" data-form-delete>Delete</button>` : ''}
        <button class="btn-secondary" data-form-cancel>Cancel</button>
        <button class="btn-primary" data-form-save>Save</button>
      </div>`;
    updRenew();
    $('form-overlay').classList.add('open');
    setTimeout(() => { const n = $('f-name'); if (n && !n.value) n.focus(); }, 300);
  }
  const closeForm = () => { $('form-overlay').classList.remove('open'); selectedService = null; editId = null; };

  function saveForm() {
    const name = $('f-name').value.trim();
    const price = parseFloat($('f-price').value);
    const err = $('f-error');
    if (!name) { err.textContent = 'Please enter a name.'; err.classList.remove('hidden'); return; }
    if (isNaN(price) || price < 0) { err.textContent = 'Please enter a valid price.'; err.classList.remove('hidden'); return; }
    err.classList.add('hidden');
    const existing = editId ? subs.find(x => x.id === editId) : null;
    let emoji = existing ? existing.emoji : null;
    if (selectedService !== null && SERVICE_LIBRARY[selectedService]) emoji = SERVICE_LIBRARY[selectedService].emoji;
    if (!emoji) { const m = getSvc(name); if (m) emoji = m.emoji; }
    let url = $('f-url').value.trim();
    if (!url) { const m = getSvc(name); if (m) url = m.url || ''; }
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    commit({
      id: existing ? existing.id : uuid(),
      name, price, emoji: emoji || null,
      cycle: $('f-cycle').value, category: $('f-cat').value, status: $('f-status').value,
      startDate: $('f-start').value, paymentMethod: $('f-payment').value.trim(),
      url, notes: $('f-notes').value.trim(),
    });
    closeForm(); toast(existing ? 'Saved' : `${name} added`);
  }
  function deleteSub(id) {
    const s = subs.find(x => x.id === id); if (!s) return;
    if (!confirm(`Delete ${s.name}?`)) return;
    remove(id); closeForm(); closeDetail(); toast('Deleted');
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
  function openAuth(mode = 'signin') {
    $('auth-body').innerHTML = `
      <div class="auth-tabs"><button class="auth-tab ${mode === 'signin' ? 'active' : ''}" data-auth-tab="signin">Sign in</button><button class="auth-tab ${mode === 'signup' ? 'active' : ''}" data-auth-tab="signup">Create account</button></div>
      <div class="form-row"><label>Email</label><input id="a-email" type="email" placeholder="you@example.com" autocomplete="email" inputmode="email"/></div>
      <div class="form-row"><label>Password</label><input id="a-pass" type="password" placeholder="${mode === 'signup' ? 'At least 6 characters' : '••••••••'}" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"/></div>
      <div id="a-error" class="form-error hidden"></div>
      <button class="btn-primary btn-block" data-auth-submit="${mode}">${mode === 'signin' ? 'Sign in' : 'Create account'}</button>
      ${mode === 'signin' ? `<button class="btn-secondary btn-block" style="margin-top:10px" data-auth-reset>Forgot password?</button>` : ''}
      <div class="auth-note">${mode === 'signup' ? 'Your subscriptions on this device will be uploaded to your new account.' : 'Signing in merges this device\'s data with your account.'}</div>`;
    $('auth-overlay').classList.add('open');
    setTimeout(() => { const e = $('a-email'); if (e) e.focus(); }, 300);
  }
  const closeAuth = () => $('auth-overlay').classList.remove('open');
  async function submitAuth(mode) {
    const email = $('a-email').value.trim(), pass = $('a-pass').value, err = $('a-error'), btn = document.querySelector('[data-auth-submit]');
    err.classList.add('hidden');
    if (!email || !pass) { err.textContent = 'Email and password are required.'; err.classList.remove('hidden'); return; }
    btn.disabled = true; btn.textContent = mode === 'signin' ? 'Signing in…' : 'Creating…';
    try {
      if (mode === 'signup') {
        const r = await window.Sync.signUp(email, pass);
        if (r.needsConfirm) {
          $('auth-body').innerHTML = `<div class="auth-ok"><div class="big">📬</div><p><b>Check your email.</b><br>We sent a confirmation link to <b>${esc(email)}</b>. Tap it, then come back and sign in.</p><button class="btn-primary btn-block" style="margin-top:18px" data-auth-close>Done</button></div>`;
          return;
        }
      } else {
        await window.Sync.signIn(email, pass);
      }
      // push local data up, then pull merged
      if (subs.length && window.Sync.user) await window.Sync.pushAll(subs);
      closeAuth(); toast(mode === 'signup' ? 'Account created' : 'Signed in');
    } catch (e) {
      err.textContent = e.message || 'Something went wrong.'; err.classList.remove('hidden');
      btn.disabled = false; btn.textContent = mode === 'signin' ? 'Sign in' : 'Create account';
    }
  }

  // ── Export / import ──────────────────────────────────────────────────
  async function downloadFile(filename, content, mime) {
    const C = window.Capacitor && window.Capacitor.Plugins;
    if (C && C.Filesystem && C.Share) {
      try {
        const res = await C.Filesystem.writeFile({ path: filename, data: content, directory: 'CACHE', encoding: 'utf8' });
        await C.Share.share({ title: filename, url: res.uri });
        return;
      } catch (e) { /* fall through to web */ }
    }
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function exportJSON() {
    const payload = { app: 'SubTracker', version: CFG.APP_VERSION || '1.0.0', exportedAt: new Date().toISOString(), subscriptions: subs };
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
        let added = 0, updated = 0;
        list.forEach(raw => {
          if (!raw || !raw.name) return;
          const s = {
            id: typeof raw.id === 'string' && raw.id.length >= 20 ? raw.id : uuid(),
            name: String(raw.name), emoji: raw.emoji || null, category: CATEGORIES.includes(raw.category) ? raw.category : 'other',
            price: parseFloat(raw.price) || 0, cycle: raw.cycle === 'yearly' ? 'yearly' : 'monthly',
            status: ['active', 'trial', 'paused', 'cancelled'].includes(raw.status) ? raw.status : 'active',
            startDate: raw.startDate || '', paymentMethod: raw.paymentMethod || '', url: raw.url || '', notes: raw.notes || '',
            updatedAt: raw.updatedAt || new Date().toISOString(),
          };
          const i = subs.findIndex(x => x.id === s.id);
          if (i >= 0) { if ((s.updatedAt || '') > (subs[i].updatedAt || '')) { subs[i] = s; updated++; } }
          else { subs.push(s); added++; }
        });
        saveLocal();
        if (window.Sync && window.Sync.user) window.Sync.pushAll(subs);
        scheduleNotifications(); render();
        toast(`Imported ${added} new, ${updated} updated`);
      } catch (e) { toast('Could not read that file'); }
    };
    r.readAsText(file);
  }
  async function clearAll() {
    if (!confirm(`Delete all ${subs.length} subscriptions? This cannot be undone.`)) return;
    if (!confirm('Really delete everything?')) return;
    subs = []; saveLocal();
    if (window.Sync && window.Sync.user) await window.Sync.deleteAll();
    scheduleNotifications(); render(); toast('All data deleted');
  }

  // ── Onboarding ───────────────────────────────────────────────────────
  function maybeOnboard() {
    const ob = $('onboarding'); if (!ob) return;
    if (settings.onboarded || subs.length > 0) { ob.classList.add('hidden'); return; }
    ob.classList.remove('hidden');
  }
  function finishOnboarding(openAuthAfter) {
    settings.onboarded = true; saveSettings();
    $('onboarding').classList.add('hidden');
    if (openAuthAfter && window.Sync && window.Sync.configured) openAuth('signup');
  }

  // ── Event wiring (delegated) ─────────────────────────────────────────
  function wire() {
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-action],[data-view],[data-id],[data-edit],[data-tile],[data-form-save],[data-form-cancel],[data-form-delete],[data-detail-edit],[data-auth-tab],[data-auth-submit],[data-auth-reset],[data-auth-close],[data-close],[data-ob-start],[data-ob-skip],[data-stop],.opt-pill,.chip');
      if (!t) return;
      if (t.hasAttribute('data-stop')) { e.stopPropagation(); return; }

      if (t.dataset.view) { showView(t.dataset.view); return; }
      if (t.dataset.edit) { e.stopPropagation(); openEdit(t.dataset.edit); return; }
      if (t.dataset.id && (t.classList.contains('m-card') || t.classList.contains('d-card'))) { openDetail(t.dataset.id); return; }
      if (t.dataset.detailEdit) { closeDetail(); openEdit(t.dataset.detailEdit); return; }
      if (t.dataset.tile !== undefined) { pickSvc(+t.dataset.tile); return; }
      if (t.hasAttribute('data-form-save')) { saveForm(); return; }
      if (t.hasAttribute('data-form-cancel')) { closeForm(); return; }
      if (t.hasAttribute('data-form-delete')) { deleteSub(editId); return; }
      if (t.hasAttribute('data-ob-start')) { finishOnboarding(false); return; }
      if (t.hasAttribute('data-ob-skip')) { finishOnboarding(false); return; }
      if (t.dataset.authTab) { openAuth(t.dataset.authTab); return; }
      if (t.dataset.authSubmit) { submitAuth(t.dataset.authSubmit); return; }
      if (t.hasAttribute('data-auth-reset')) {
        const email = ($('a-email') || {}).value || '';
        if (!email) { toast('Enter your email first'); return; }
        window.Sync.resetPassword(email).then(() => toast('Reset link sent')).catch(err => toast(err.message || 'Could not send'));
        return;
      }
      if (t.hasAttribute('data-auth-close')) { closeAuth(); return; }
      if (t.dataset.close) { const el = $(t.dataset.close); if (el) el.classList.remove('open'); return; }

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
        case 'auth': openAuth('signin'); break;
        case 'sign-out': window.Sync.signOut().then(() => { toast('Signed out'); render(); }); break;
        case 'sync-now': toast('Syncing…'); window.Sync.pull().then(() => toast('Up to date')); break;
        case 'test-notify': testNotify(); break;
        case 'export-json': exportJSON(); break;
        case 'export-csv': exportCSV(); break;
        case 'import': $('import-file').click(); break;
        case 'clear': clearAll(); break;
      }
    });

    // overlays close on backdrop tap
    document.querySelectorAll('.sheet-overlay').forEach(ov => ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('open'); }));

    // inputs
    document.addEventListener('input', e => {
      if (e.target.id === 'm-search' || e.target.id === 'd-search') render();
      if (e.target.id === 'f-start' || e.target.id === 'f-cycle') updRenew();
    });
    document.addEventListener('change', async e => {
      if (['d-status', 'd-cycle', 'd-sort', 'f-cycle'].includes(e.target.id)) { if (e.target.id === 'f-cycle') updRenew(); else render(); }
      if (e.target.id === 'set-notify') {
        if (e.target.checked) {
          const ok = await requestNotifyPermission();
          if (!ok) { e.target.checked = false; toast('Notifications were not allowed'); renderSettings(); return; }
          settings.notifyEnabled = true; saveSettings(); scheduleNotifications(); checkDueSoon(); toast('Reminders on');
        } else { settings.notifyEnabled = false; saveSettings(); const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications; if (LN) LN.getPending().then(p => p.notifications.length && LN.cancel(p)).catch(() => {}); toast('Reminders off'); }
        renderSettings();
      }
      if (e.target.id === 'set-notify-days') { settings.notifyDays = +e.target.value; saveSettings(); scheduleNotifications(); }
      if (e.target.id === 'import-file' && e.target.files[0]) { importJSON(e.target.files[0]); e.target.value = ''; }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') document.querySelectorAll('.sheet-overlay.open').forEach(o => o.classList.remove('open'));
      if (e.key === 'Enter' && e.target.closest('#auth-body')) { const b = document.querySelector('[data-auth-submit]'); if (b) b.click(); }
    });
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 120); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); checkDueSoon(); if (window.Sync && window.Sync.user) window.Sync.pull(); } });
  }

  async function testNotify() {
    const ok = await requestNotifyPermission();
    if (!ok) { toast('Notifications are blocked for this app'); return; }
    const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
    if (LN) { await LN.schedule({ notifications: [{ id: 999999, title: 'SubTracker', body: 'Reminders are working 🎉', schedule: { at: new Date(Date.now() + 3000) } }] }); toast('Test arrives in 3 seconds'); return; }
    try { new Notification('SubTracker', { body: 'Reminders are working 🎉', icon: 'icon-192.png' }); } catch { toast('Could not show notification'); }
  }

  // ── Boot ─────────────────────────────────────────────────────────────
  function boot() {
    load();
    wire();
    // Sync
    if (window.Sync) {
      window.Sync.on('onAuth', () => { render(); });
      window.Sync.on('onStatus', st => { syncState = st; if (view === 'settings') renderSettings(); });
      window.Sync.init();
    }
    maybeOnboard();
    showView('home');
    syncChips(); updateFilterDot();
    checkDueSoon();
    scheduleNotifications();

    // iOS install tip
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS && !window.navigator.standalone && !localStorage.getItem('subtracker_ios_tip') && isMobile()) {
      setTimeout(() => { const t = $('ios-tip'); if (t) t.style.display = 'block'; }, 3000);
    }
    const tipBtn = $('ios-tip-close'); if (tipBtn) tipBtn.onclick = () => { $('ios-tip').style.display = 'none'; localStorage.setItem('subtracker_ios_tip', '1'); };

    // Service worker (only on http/https, not file://)
    if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    // Capacitor status bar
    const SB = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
    if (SB) { try { SB.setBackgroundColor({ color: '#0a0a0f' }); SB.setStyle({ style: 'DARK' }); } catch {} }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
