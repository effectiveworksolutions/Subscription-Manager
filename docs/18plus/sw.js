// SubTracker service worker — offline support
// Strategy: stale-while-revalidate for our own files and service logos
// (fast load, updates land on the next open). Network-only for Supabase
// and the Google Fonts API.
// Bump CACHE_VERSION whenever you deploy to force a clean refresh.
const CACHE_VERSION = 'subtracker-v8-18plus';
const PRECACHE = ['./', './index.html', './app.css', './app.js', './brands.js', './brands-adult.js', './sync.js', './discover.js', './config.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(PRECACHE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // never cache API calls or font CSS (font CSS varies by UA)
  if (url.hostname.endsWith('supabase.co') || url.hostname === 'fonts.googleapis.com') return;
  if (/accounts\.google\.com|googleapis\.com|gstatic\.com\/gsi|microsoftonline\.com|graph\.microsoft\.com|msauth\.net|login\.live\.com/.test(url.hostname + url.pathname) && url.hostname !== 'fonts.gstatic.com') return;

  e.respondWith(
    caches.open(CACHE_VERSION).then(async cache => {
      const cached = await cache.match(req);
      const network = fetch(req).then(res => {
        const logo = (url.hostname === 'www.google.com' && url.pathname.startsWith('/s2/favicons')) || url.hostname === 'icons.duckduckgo.com';
        if (res && (res.ok || (logo && res.type === 'opaque')) && (url.origin === location.origin || url.hostname === 'fonts.gstatic.com' || url.hostname === 'cdn.jsdelivr.net' || logo)) {
          cache.put(req, res.clone());
        }
        return res;
      }).catch(() => null);
      if (cached) { network; return cached; }
      const res = await network;
      if (res) return res;
      // offline fallback for navigations
      if (req.mode === 'navigate') return cache.match('./index.html');
      return new Response('', { status: 503, statusText: 'Offline' });
    })
  );
});
