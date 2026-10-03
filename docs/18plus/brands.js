// ═══════════════════════════════════════════════════════════════════════
//  SubTracker — service library, categories, logo lookup helpers
//
//  Logos are NOT drawn by hand any more. Each service has a `domain`, and
//  the app fetches the service's own icon from a favicon service at run
//  time (see app.js → logoHtml). Custom subscriptions use the domain of
//  their "Manage URL". Anything without a domain falls back to an emoji.
// ═══════════════════════════════════════════════════════════════════════

// Category → emoji (also defines the category dropdown order)
window.EMOJI_MAP = {
  streaming: '🎬', music: '🎵', ai: '🤖', storage: '☁️', gaming: '🎮', news: '📰',
  fitness: '💪', productivity: '📋', design: '🎨', security: '🔐', education: '🎓',
  shopping: '🛍️', finance: '💰', utilities: '💡', telco: '📱', other: '📦',
};

// Categories that are only shown once the 18+ section has been unlocked
window.ADULT_CATEGORIES = ['adult'];

// ── Service library ────────────────────────────────────────────────────
//   name      shown on the tile and used to match existing subscriptions
//   domain    where the logo is fetched from
//   group     used by the AI review to spot overlapping services
//   annual    true when the service is known to offer a cheaper yearly plan
//   includes  other services that are bundled in (AI review "already included")
//   adult     true → only visible after the 18+ check (no entries shipped at the moment;
//             the section and its age gate appear automatically if any are added)
window.SERVICE_LIBRARY = [
  // Video streaming
  { name: 'Netflix',          emoji: '🎬', category: 'streaming', group: 'video', domain: 'netflix.com',        url: 'https://www.netflix.com/account' },
  { name: 'Stan',             emoji: '🎬', category: 'streaming', group: 'video', domain: 'stan.com.au',        url: 'https://www.stan.com.au/account' },
  { name: 'Disney+',          emoji: '🎬', category: 'streaming', group: 'video', domain: 'disneyplus.com',     url: 'https://www.disneyplus.com/account', annual: true },
  { name: 'Binge',            emoji: '🎬', category: 'streaming', group: 'video', domain: 'binge.com.au',       url: 'https://binge.com.au/account' },
  { name: 'Kayo Sports',      emoji: '🏅', category: 'streaming', group: 'sport', domain: 'kayosports.com.au',  url: 'https://kayosports.com.au/account' },
  { name: 'Foxtel',           emoji: '📺', category: 'streaming', group: 'video', domain: 'foxtel.com.au',      url: 'https://www.foxtel.com.au/got/account.html' },
  { name: 'Hubbl',            emoji: '📺', category: 'streaming', group: 'video', domain: 'hubbl.com.au',       url: 'https://hubbl.com.au' },
  { name: 'Paramount+',       emoji: '🎬', category: 'streaming', group: 'video', domain: 'paramountplus.com',  url: 'https://www.paramountplus.com/account/', annual: true },
  { name: 'HBO Max',          emoji: '🎬', category: 'streaming', group: 'video', domain: 'hbomax.com',         url: 'https://www.hbomax.com/account', annual: true },
  { name: 'Prime Video',      emoji: '🎬', category: 'streaming', group: 'video', domain: 'primevideo.com',     url: 'https://www.primevideo.com/settings' },
  { name: 'Amazon Prime',     emoji: '📦', category: 'shopping',  group: 'prime', domain: 'amazon.com.au',      url: 'https://www.amazon.com.au/gp/primecentral', annual: true, includes: ['Prime Video'] },
  { name: 'Apple TV+',        emoji: '🎬', category: 'streaming', group: 'video', domain: 'tv.apple.com',       url: 'https://tv.apple.com' },
  { name: 'YouTube Premium',  emoji: '▶️', category: 'streaming', group: 'video', domain: 'youtube.com',        url: 'https://www.youtube.com/paid_memberships', annual: true, includes: ['YouTube Music'] },
  { name: 'Hayu',             emoji: '🎬', category: 'streaming', group: 'video', domain: 'hayu.com',           url: 'https://www.hayu.com/account', annual: true },
  { name: 'Crunchyroll',      emoji: '🎬', category: 'streaming', group: 'video', domain: 'crunchyroll.com',    url: 'https://www.crunchyroll.com/account', annual: true },
  { name: 'BritBox',          emoji: '🎬', category: 'streaming', group: 'video', domain: 'britbox.com',        url: 'https://www.britbox.com/au/account', annual: true },
  { name: 'DocPlay',          emoji: '🎬', category: 'streaming', group: 'video', domain: 'docplay.com',        url: 'https://www.docplay.com', annual: true },
  { name: 'Optus Sport',      emoji: '⚽', category: 'streaming', group: 'sport', domain: 'sport.optus.com.au', url: 'https://sport.optus.com.au' },
  { name: 'Shudder',          emoji: '🎬', category: 'streaming', group: 'video', domain: 'shudder.com',        url: 'https://www.shudder.com', annual: true },
  { name: 'Twitch',           emoji: '🎮', category: 'streaming', group: 'video', domain: 'twitch.tv',          url: 'https://www.twitch.tv/subscriptions' },

  // Music & audio
  { name: 'Spotify',          emoji: '🎵', category: 'music',     group: 'music', domain: 'spotify.com',        url: 'https://www.spotify.com/account/overview/' },
  { name: 'Apple Music',      emoji: '🎵', category: 'music',     group: 'music', domain: 'music.apple.com',    url: 'https://music.apple.com' },
  { name: 'YouTube Music',    emoji: '🎵', category: 'music',     group: 'music', domain: 'music.youtube.com',  url: 'https://www.youtube.com/paid_memberships', annual: true },
  { name: 'Amazon Music',     emoji: '🎵', category: 'music',     group: 'music', domain: 'music.amazon.com',   url: 'https://music.amazon.com.au/settings' },
  { name: 'Tidal',            emoji: '🎵', category: 'music',     group: 'music', domain: 'tidal.com',          url: 'https://tidal.com/account' },
  { name: 'Deezer',           emoji: '🎵', category: 'music',     group: 'music', domain: 'deezer.com',         url: 'https://www.deezer.com/account', annual: true },
  { name: 'Audible',          emoji: '🎧', category: 'music',     group: 'audiobooks', domain: 'audible.com.au', url: 'https://www.audible.com.au/account', annual: true },
  { name: 'Everand',          emoji: '📚', category: 'news',      group: 'audiobooks', domain: 'everand.com',   url: 'https://www.everand.com/account-settings' },
  { name: 'Kindle Unlimited', emoji: '📚', category: 'news',      group: 'reading', domain: 'amazon.com.au',    url: 'https://www.amazon.com.au/kindle-dbs/hz/subscribe/ku' },

  // AI assistants
  { name: 'ChatGPT',          emoji: '🤖', category: 'ai',        group: 'ai',    domain: 'chatgpt.com',        url: 'https://chatgpt.com/#settings/Subscription' },
  { name: 'Claude',           emoji: '🤖', category: 'ai',        group: 'ai',    domain: 'claude.ai',          url: 'https://claude.ai/settings/billing', annual: true },
  { name: 'Gemini',           emoji: '🤖', category: 'ai',        group: 'ai',    domain: 'gemini.google.com',  url: 'https://one.google.com/about/ai-premium/', annual: true },
  { name: 'Copilot Pro',      emoji: '🤖', category: 'ai',        group: 'ai',    domain: 'copilot.microsoft.com', url: 'https://account.microsoft.com/services' },
  { name: 'Perplexity',       emoji: '🤖', category: 'ai',        group: 'ai',    domain: 'perplexity.ai',      url: 'https://www.perplexity.ai/settings/account', annual: true },
  { name: 'Midjourney',       emoji: '🎨', category: 'ai',        group: 'ai-image', domain: 'midjourney.com',  url: 'https://www.midjourney.com/account', annual: true },

  // Cloud storage
  { name: 'iCloud+',          emoji: '☁️', category: 'storage',   group: 'storage', domain: 'icloud.com',       url: 'https://appleid.apple.com' },
  { name: 'Google One',       emoji: '☁️', category: 'storage',   group: 'storage', domain: 'one.google.com',   url: 'https://one.google.com', annual: true },
  { name: 'Dropbox',          emoji: '☁️', category: 'storage',   group: 'storage', domain: 'dropbox.com',      url: 'https://www.dropbox.com/account/plan', annual: true },
  { name: 'OneDrive',         emoji: '☁️', category: 'storage',   group: 'storage', domain: 'onedrive.live.com', url: 'https://account.microsoft.com/services', annual: true },
  { name: 'Proton',           emoji: '🔐', category: 'storage',   group: 'storage', domain: 'proton.me',        url: 'https://account.proton.me/subscription', annual: true },

  // Productivity & work
  { name: 'Microsoft 365',    emoji: '📋', category: 'productivity', group: 'office', domain: 'microsoft365.com', url: 'https://account.microsoft.com/services', annual: true, includes: ['OneDrive'] },
  { name: 'Google Workspace', emoji: '📋', category: 'productivity', group: 'office', domain: 'workspace.google.com', url: 'https://admin.google.com/ac/billing', annual: true },
  { name: 'Notion',           emoji: '📋', category: 'productivity', group: 'notes',  domain: 'notion.so',       url: 'https://www.notion.so/profile/billing', annual: true },
  { name: 'Evernote',         emoji: '📋', category: 'productivity', group: 'notes',  domain: 'evernote.com',    url: 'https://www.evernote.com/Settings.action', annual: true },
  { name: 'Todoist',          emoji: '✅', category: 'productivity', group: 'tasks',  domain: 'todoist.com',     url: 'https://app.todoist.com/app/settings/subscription', annual: true },
  { name: 'Slack',            emoji: '💬', category: 'productivity', group: 'chat',   domain: 'slack.com',       url: 'https://slack.com/intl/en-au/pricing', annual: true },
  { name: 'Zoom',             emoji: '📹', category: 'productivity', group: 'video-calls', domain: 'zoom.us',    url: 'https://zoom.us/billing', annual: true },
  { name: 'GitHub',           emoji: '💻', category: 'productivity', group: 'dev',    domain: 'github.com',      url: 'https://github.com/settings/billing', annual: true },
  { name: 'LinkedIn Premium', emoji: '💼', category: 'productivity', group: 'career', domain: 'linkedin.com',    url: 'https://www.linkedin.com/premium/manage', annual: true },
  { name: 'Grammarly',        emoji: '✍️', category: 'productivity', group: 'writing', domain: 'grammarly.com',  url: 'https://account.grammarly.com/subscription', annual: true },
  { name: 'Xero',             emoji: '📊', category: 'finance',   group: 'accounting', domain: 'xero.com',       url: 'https://go.xero.com/Settings/Subscription' },
  { name: 'MYOB',             emoji: '📊', category: 'finance',   group: 'accounting', domain: 'myob.com',       url: 'https://my.myob.com' },
  { name: 'QuickBooks',       emoji: '📊', category: 'finance',   group: 'accounting', domain: 'quickbooks.intuit.com', url: 'https://app.qbo.intuit.com/app/billing', annual: true },
  { name: 'Shopify',          emoji: '🛒', category: 'productivity', group: 'ecommerce', domain: 'shopify.com',  url: 'https://admin.shopify.com', annual: true },
  { name: 'Squarespace',      emoji: '🌐', category: 'productivity', group: 'website', domain: 'squarespace.com', url: 'https://account.squarespace.com', annual: true },
  { name: 'Wix',              emoji: '🌐', category: 'productivity', group: 'website', domain: 'wix.com',        url: 'https://manage.wix.com/account/subscriptions', annual: true },
  { name: 'GoDaddy',          emoji: '🌐', category: 'utilities', group: 'domains', domain: 'godaddy.com',       url: 'https://account.godaddy.com/subscriptions' },

  // Design
  { name: 'Adobe CC',         emoji: '🎨', category: 'design',    group: 'design', domain: 'adobe.com',          url: 'https://account.adobe.com/plans', annual: true },
  { name: 'Figma',            emoji: '🎨', category: 'design',    group: 'design', domain: 'figma.com',          url: 'https://www.figma.com/settings', annual: true },
  { name: 'Canva',            emoji: '🎨', category: 'design',    group: 'design', domain: 'canva.com',          url: 'https://www.canva.com/settings/purchase-history', annual: true },

  // Security
  { name: '1Password',        emoji: '🔐', category: 'security',  group: 'passwords', domain: '1password.com',   url: 'https://my.1password.com/profile', annual: true },
  { name: 'Bitwarden',        emoji: '🔐', category: 'security',  group: 'passwords', domain: 'bitwarden.com',   url: 'https://vault.bitwarden.com/#/settings/subscription', annual: true },
  { name: 'LastPass',         emoji: '🔐', category: 'security',  group: 'passwords', domain: 'lastpass.com',    url: 'https://lastpass.com/company/#!/dashboard', annual: true },
  { name: 'NordVPN',          emoji: '🛡️', category: 'security',  group: 'vpn',   domain: 'nordvpn.com',         url: 'https://my.nordaccount.com', annual: true },
  { name: 'ExpressVPN',       emoji: '🛡️', category: 'security',  group: 'vpn',   domain: 'expressvpn.com',      url: 'https://www.expressvpn.com/subscriptions', annual: true },
  { name: 'Surfshark',        emoji: '🛡️', category: 'security',  group: 'vpn',   domain: 'surfshark.com',       url: 'https://my.surfshark.com', annual: true },

  // Gaming
  { name: 'PlayStation Plus', emoji: '🎮', category: 'gaming',    group: 'gaming', domain: 'playstation.com',    url: 'https://www.playstation.com/en-au/ps-store/my-account/', annual: true },
  { name: 'Xbox Game Pass',   emoji: '🎮', category: 'gaming',    group: 'gaming', domain: 'xbox.com',           url: 'https://account.microsoft.com/services' },
  { name: 'Nintendo Online',  emoji: '🎮', category: 'gaming',    group: 'gaming', domain: 'nintendo.com',       url: 'https://accounts.nintendo.com', annual: true },
  { name: 'EA Play',          emoji: '🎮', category: 'gaming',    group: 'gaming', domain: 'ea.com',             url: 'https://www.ea.com/ea-play', annual: true },
  { name: 'Apple Arcade',     emoji: '🎮', category: 'gaming',    group: 'gaming', domain: 'apple.com',          url: 'https://apps.apple.com/account/subscriptions' },
  { name: 'Discord Nitro',    emoji: '💬', category: 'gaming',    group: 'chat',   domain: 'discord.com',        url: 'https://discord.com/settings/premium', annual: true },

  // Apple bundle
  { name: 'Apple One',        emoji: '🍎', category: 'streaming', group: 'apple-one', domain: 'apple.com',       url: 'https://apps.apple.com/account/subscriptions', includes: ['Apple Music', 'Apple TV+', 'Apple Arcade', 'iCloud+'] },

  // News & reading
  { name: 'The Australian',   emoji: '📰', category: 'news',      group: 'news',  domain: 'theaustralian.com.au', url: 'https://www.theaustralian.com.au/my-account', annual: true },
  { name: 'Sydney Morning Herald', emoji: '📰', category: 'news', group: 'news',  domain: 'smh.com.au',          url: 'https://www.smh.com.au/my-account', annual: true },
  { name: 'The Age',          emoji: '📰', category: 'news',      group: 'news',  domain: 'theage.com.au',        url: 'https://www.theage.com.au/my-account', annual: true },
  { name: 'Courier-Mail',     emoji: '📰', category: 'news',      group: 'news',  domain: 'couriermail.com.au',   url: 'https://www.couriermail.com.au/my-account', annual: true },
  { name: 'The Guardian',     emoji: '📰', category: 'news',      group: 'news',  domain: 'theguardian.com',      url: 'https://manage.theguardian.com', annual: true },
  { name: 'New York Times',   emoji: '📰', category: 'news',      group: 'news',  domain: 'nytimes.com',          url: 'https://myaccount.nytimes.com/seg/subscription', annual: true },
  { name: 'Medium',           emoji: '📰', category: 'news',      group: 'news',  domain: 'medium.com',           url: 'https://medium.com/me/settings', annual: true },
  { name: 'Patreon',          emoji: '🎁', category: 'other',     group: 'creators', domain: 'patreon.com',       url: 'https://www.patreon.com/settings/memberships' },
  { name: 'X Premium',        emoji: '✖️', category: 'other',     group: 'social', domain: 'x.com',               url: 'https://x.com/i/premium', annual: true },

  // Fitness & wellbeing
  { name: 'Gym',              emoji: '💪', category: 'fitness',   group: 'gym',   domain: '',                     url: '' },
  { name: 'Anytime Fitness',  emoji: '💪', category: 'fitness',   group: 'gym',   domain: 'anytimefitness.com.au', url: 'https://www.anytimefitness.com.au' },
  { name: 'F45',              emoji: '💪', category: 'fitness',   group: 'gym',   domain: 'f45training.com',      url: 'https://f45training.com' },
  { name: 'Strava',           emoji: '🏃', category: 'fitness',   group: 'fitness-app', domain: 'strava.com',     url: 'https://www.strava.com/settings/subscription', annual: true },
  { name: 'Peloton',          emoji: '🚴', category: 'fitness',   group: 'fitness-app', domain: 'onepeloton.com', url: 'https://members.onepeloton.com/preferences/subscriptions' },
  { name: 'Headspace',        emoji: '🧘', category: 'fitness',   group: 'mindfulness', domain: 'headspace.com',  url: 'https://www.headspace.com/settings', annual: true },
  { name: 'Calm',             emoji: '🧘', category: 'fitness',   group: 'mindfulness', domain: 'calm.com',       url: 'https://www.calm.com/account', annual: true },

  // Learning
  { name: 'Duolingo',         emoji: '🎓', category: 'education', group: 'learning', domain: 'duolingo.com',     url: 'https://www.duolingo.com/settings/super', annual: true },
  { name: 'MasterClass',      emoji: '🎓', category: 'education', group: 'learning', domain: 'masterclass.com',  url: 'https://www.masterclass.com/account', annual: true },
  { name: 'Skillshare',       emoji: '🎓', category: 'education', group: 'learning', domain: 'skillshare.com',   url: 'https://www.skillshare.com/settings/payments', annual: true },
  { name: 'Coursera',         emoji: '🎓', category: 'education', group: 'learning', domain: 'coursera.org',     url: 'https://www.coursera.org/my-purchases', annual: true },

  // Shopping, food & lifestyle
  { name: 'Uber One',         emoji: '🚗', category: 'shopping',  group: 'delivery', domain: 'uber.com',         url: 'https://www.uber.com/au/en/u/uber-one/', annual: true },
  { name: 'DashPass',         emoji: '🍔', category: 'shopping',  group: 'delivery', domain: 'doordash.com',     url: 'https://www.doordash.com/consumer/membership/', annual: true },
  { name: 'Everyday Extra',   emoji: '🛒', category: 'shopping',  group: 'grocery', domain: 'woolworths.com.au', url: 'https://www.woolworths.com.au/shop/discover/everydayextra', annual: true },
  { name: 'Tinder',           emoji: '💘', category: 'other',     group: 'dating', domain: 'tinder.com',          url: 'https://tinder.com/app/settings' },
  { name: 'Bumble',           emoji: '💘', category: 'other',     group: 'dating', domain: 'bumble.com',          url: 'https://bumble.com/app/settings' },
  { name: 'Hinge',            emoji: '💘', category: 'other',     group: 'dating', domain: 'hinge.co',            url: 'https://hinge.co' },

  // Telco & utilities
  { name: 'Optus',            emoji: '📱', category: 'telco',     group: 'mobile', domain: 'optus.com.au',        url: 'https://www.optus.com.au/myaccount' },
  { name: 'Telstra',          emoji: '📱', category: 'telco',     group: 'mobile', domain: 'telstra.com.au',      url: 'https://www.telstra.com.au/myaccount' },
  { name: 'Vodafone',         emoji: '📱', category: 'telco',     group: 'mobile', domain: 'vodafone.com.au',     url: 'https://myaccount.vodafone.com.au' },
  { name: 'Boost Mobile',     emoji: '📱', category: 'telco',     group: 'mobile', domain: 'boost.com.au',        url: 'https://boost.com.au/pages/my-account' },
  { name: 'amaysim',          emoji: '📱', category: 'telco',     group: 'mobile', domain: 'amaysim.com.au',      url: 'https://www.amaysim.com.au/my-account' },
  { name: 'Aussie Broadband', emoji: '🌐', category: 'telco',     group: 'internet', domain: 'aussiebroadband.com.au', url: 'https://my.aussiebroadband.com.au' },

  { name: 'Custom…',          emoji: '📦', category: 'other', group: '', domain: '', url: '' },
];

// Older names still found in existing data → library entry to use for logos/groups
window.SERVICE_ALIASES = {
  'claude ai': 'Claude', 'claude pro': 'Claude', 'chatgpt plus': 'ChatGPT', 'chat gpt': 'ChatGPT',
  'microsoft': 'Microsoft 365', 'office 365': 'Microsoft 365', 'linkedin': 'LinkedIn Premium',
  'max': 'HBO Max', 'amazon prime video': 'Prime Video', 'youtube': 'YouTube Premium',
  'nintendo switch online': 'Nintendo Online', 'ps plus': 'PlayStation Plus', 'game pass': 'Xbox Game Pass',
  'adobe': 'Adobe CC', 'adobe creative cloud': 'Adobe CC', 'icloud': 'iCloud+', 'apple tv': 'Apple TV+',
  'disney': 'Disney+', 'disney plus': 'Disney+', 'paramount': 'Paramount+', 'paramount plus': 'Paramount+',
  'kayo': 'Kayo Sports', 'woolworths everyday extra': 'Everyday Extra', 'doordash': 'DashPass',
};

// Readable labels for the AI review
window.GROUP_LABELS = {
  video: 'video streaming', sport: 'sports streaming', music: 'music streaming', audiobooks: 'audiobook',
  ai: 'AI assistant', storage: 'cloud storage', office: 'office suite', notes: 'notes', passwords: 'password manager',
  vpn: 'VPN', gaming: 'gaming', news: 'news', gym: 'gym', 'fitness-app': 'fitness app', mindfulness: 'meditation',
  learning: 'learning', delivery: 'delivery', dating: 'dating', mobile: 'mobile plan', design: 'design tool',
  creators: 'creator platform', adult: 'adult', chat: 'chat', website: 'website builder', accounting: 'accounting',
};
