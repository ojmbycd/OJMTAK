// Offline support for JumpMaster Pro.
// The app page and its map library are kept on the phone so the app opens with no signal.
// Map tiles saved with "Download map area" are served from the phone first.
const APP = 'jmet-app-v2', TILES = 'jmet-tiles';
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
  'https://cdn.jsdelivr.net/npm/leaflet-rotate@0.2.8/dist/leaflet-rotate.js',
];
const PAGE = new URL('./', self.registration.scope).href;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => Promise.all([c.add(PAGE), ...LIBS.map(u => c.add(new Request(u, { mode: 'cors' })))])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('jmet-app-') && k !== APP).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// one key per tile, whichever server letter (a/b/c) it came from
const tileKey = u => u.replace(/\/\/[abc]\.tile\.opentopomap\.org/, '//a.tile.opentopomap.org');
const isTile = u => /arcgisonline\.com\/.*\/tile\/|tile\.openstreetmap\.org\/|tile\.opentopomap\.org\/|elevation-tiles-prod\/terrarium\//.test(u);

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  // the app page: newest from the network when there is signal, the saved copy when not
  if (req.mode === 'navigate' || (url.origin === location.origin && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')))) {
    e.respondWith((async () => {
      try {
        const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000);
        const r = await fetch(req, { cache: 'no-store', signal: ctl.signal }); clearTimeout(t);
        // only the app page itself is saved, and an error page (404, server down) never replaces it
        const isApp = url.origin === location.origin && (url.href.split(/[?#]/)[0] === PAGE || url.pathname.endsWith('/index.html'));
        if (r.ok && isApp) (await caches.open(APP)).put(PAGE, r.clone());
        if (!r.ok && isApp) { const saved = await caches.match(PAGE); if (saved) return saved; }
        return r;
      } catch (_) { return (await caches.match(PAGE)) || Response.error(); }
    })());
    return;
  }
  if (LIBS.includes(req.url)) { e.respondWith(caches.match(req.url).then(r => r || fetch(req))); return; }
  if (isTile(req.url)) {
    e.respondWith((async () => {
      const c = await caches.open(TILES), hit = await c.match(tileKey(req.url));
      if (hit) return hit;
      try { return await fetch(req); } catch (_) { return new Response('', { status: 504 }); }
    })());
  }
});
