/* Gemgrind service worker · v6.0.6 (efficiency #8): stale-while-revalidate.
   · The game opens instantly from the cache, online or offline.
   · Every launch re-checks index.html in the background (a conditional request: cheap when nothing changed).
     When a newer upload is found it is cached and the page is told ({type:'gg-update'}), which offers
     "New version ready · tap to reload". Testers still get every upload, one tap (or one launch) later.
   · Images live in assets/ with content-hash names (tools/extract-assets.py), so they are cache-first: a changed
     image gets a new name, and names the current index.html no longer uses are pruned.
   · Requests made with cache:'no-store' or 'reload' (the debug Balance tab reading the game file) always go to the network. */
const CACHE = 'gemgrind-v2';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];
const PAGE = new URL('./index.html', self.location).href;
const ROOT = new URL('./', self.location).href;
const ASSET_RX = /assets\/[\w.-]+\.(?:webp|png|jpe?g|gif|avif)/g;
const assetsIn = html => [...new Set(html.match(ASSET_RX) || [])].map(p => new URL('./' + p, self.location).href);
let checking = null;

async function cacheAssets(c, html) {
  const want = assetsIn(html);
  await Promise.all(want.map(u => c.match(u).then(m => m || c.add(u).catch(() => {}))));
  /* prune images the current page no longer references */
  const keep = new Set(want);
  for (const req of await c.keys()) if (req.url.includes('/assets/') && !keep.has(req.url)) await c.delete(req);
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE).catch(() => {});
    const page = await c.match(PAGE);
    if (page) await cacheAssets(c, await page.text());
  })().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

/* fetch the newest index.html; when it differs from the cached copy, store it (plus its images) and tell open pages */
function revalidate() {
  if (checking) return checking;
  checking = (async () => {
    const c = await caches.open(CACHE);
    const old = await c.match(PAGE);
    const res = await fetch(PAGE, { cache: 'no-cache' });
    if (!res || !res.ok) return;
    const html = await res.clone().text();
    const before = old ? await old.text() : null;
    if (before === html) return;
    await c.put(PAGE, res.clone());
    await c.put(ROOT, res.clone());
    await cacheAssets(c, html);
    if (before !== null) for (const cl of await self.clients.matchAll({ type: 'window' })) cl.postMessage({ type: 'gg-update' });
  })().catch(() => {}).finally(() => { checking = null; });
  return checking;
}

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const url = new URL(r.url);
  if (url.origin !== location.origin) return;
  /* explicit "give me the real file" requests: network, cache only as an offline fallback */
  if (r.cache === 'no-store' || r.cache === 'reload') {
    e.respondWith(fetch(r).catch(() => caches.match(r, { ignoreSearch: true })));
    return;
  }
  const isPage = r.mode === 'navigate' || url.href.split(/[?#]/)[0] === PAGE || url.href.split(/[?#]/)[0] === ROOT;
  if (isPage) {
    e.respondWith((async () => {
      const hit = await caches.match(PAGE);
      if (hit) { e.waitUntil(revalidate()); return hit; }
      try { const res = await fetch(r); if (res && res.ok) { const c = await caches.open(CACHE); await c.put(PAGE, res.clone()); e.waitUntil(c.match(PAGE).then(p => p && p.text()).then(t => t && cacheAssets(c, t))); } return res; }
      catch (_) { return caches.match(ROOT); }
    })());
    return;
  }
  if (url.pathname.includes('/assets/')) {
    /* content-hash names never change meaning: cache-first */
    e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)).catch(() => {}); }
      return res;
    })));
    return;
  }
  /* manifest, icons, anything else: serve the cached copy now, refresh it in the background */
  e.respondWith(caches.match(r, { ignoreSearch: true }).then(hit => {
    const net = fetch(r).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)).catch(() => {}); }
      return res;
    }).catch(() => hit);
    if (hit) { e.waitUntil(net); return hit; }
    return net;
  }));
});
