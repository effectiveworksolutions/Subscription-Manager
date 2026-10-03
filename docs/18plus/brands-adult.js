// ═══════════════════════════════════════════════════════════════════════
//  SubTracker 18+ — adults-only service entries
//
//  This file only ships in the 18+ edition (docs/18plus/, built by
//  `node editions.js`). It is loaded straight after brands.js and adds the
//  adult services to the library. app.js notices that entries with
//  `adult: true` exist and switches on the age gate, the "Adults only"
//  Settings toggle and the adult category automatically.
//
//  The standard edition never loads this file, so it stays store-safe.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  const lib = window.SERVICE_LIBRARY;
  if (!Array.isArray(lib)) return;

  const ADULT_SERVICES = [
    { name: 'Pornhub Premium',  emoji: '🔞', category: 'adult', group: 'adult',    domain: 'pornhub.com',        url: 'https://www.pornhub.com/premium', adult: true, annual: true },
    { name: 'OnlyFans',         emoji: '🔞', category: 'adult', group: 'creators', domain: 'onlyfans.com',       url: 'https://onlyfans.com/my/settings/subscriptions', adult: true },
    { name: 'Fansly',           emoji: '🔞', category: 'adult', group: 'creators', domain: 'fansly.com',         url: 'https://fansly.com/settings/subscriptions', adult: true },
    { name: 'Brazzers',         emoji: '🔞', category: 'adult', group: 'adult',    domain: 'brazzers.com',       url: 'https://www.brazzers.com', adult: true, annual: true },
    { name: 'Adult Time',       emoji: '🔞', category: 'adult', group: 'adult',    domain: 'adulttime.com',      url: 'https://www.adulttime.com', adult: true, annual: true },
    { name: 'Reality Kings',    emoji: '🔞', category: 'adult', group: 'adult',    domain: 'realitykings.com',   url: 'https://www.realitykings.com', adult: true, annual: true },
    { name: 'Bang Bros',        emoji: '🔞', category: 'adult', group: 'adult',    domain: 'bangbros.com',       url: 'https://www.bangbros.com', adult: true, annual: true },
    { name: 'Naughty America',  emoji: '🔞', category: 'adult', group: 'adult',    domain: 'naughtyamerica.com', url: 'https://www.naughtyamerica.com', adult: true, annual: true },
  ];

  // Insert before the trailing "Custom…" tile so it stays last in the picker
  const customAt = lib.findIndex(s => s.name === 'Custom…');
  lib.splice(customAt < 0 ? lib.length : customAt, 0, ...ADULT_SERVICES.filter(a => !lib.some(s => s.name === a.name)));

  // Category + review labels + older names
  window.EMOJI_MAP = Object.assign({}, window.EMOJI_MAP, { adult: '🔞' });
  window.ADULT_CATEGORIES = ['adult'];
  window.GROUP_LABELS = Object.assign({}, window.GROUP_LABELS, { adult: 'adult', creators: 'creator platform' });
  window.SERVICE_ALIASES = Object.assign({}, window.SERVICE_ALIASES, {
    'onlyfans': 'OnlyFans', 'only fans': 'OnlyFans', 'pornhub': 'Pornhub Premium', 'porn hub': 'Pornhub Premium',
    'brazzers': 'Brazzers', 'adulttime': 'Adult Time', 'bangbros': 'Bang Bros',
  });
  window.SUBTRACKER_EDITION = '18plus';
})();
