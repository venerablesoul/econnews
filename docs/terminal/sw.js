// The terminal's service worker: needed to install it as an app and for an offline splash.
// Quotes, news and charts are NOT cached here — they come fresh from the network (the page keeps its own last copy).
const CACHE = 'econ-terminal-v11';
const SHELL = ['./', './i18n.js', './fn.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) return;
  // the page and its scripts: the network if it answers within 1.5 s, otherwise the saved copy at once
  // (the network answer still refreshes the copy, so an update shows on the next opening)
  const net = fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)) }
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  e.respondWith(new Promise(resolve => {
    let done = false;
    const fallback = () => caches.match(req, {ignoreSearch: true}).then(r => r || (req.mode === 'navigate' ? caches.match('./') : undefined));
    const timer = setTimeout(() => fallback().then(r => { if (r && !done) { done = true; resolve(r) } }), 1500);
    net.then(res => { if (!done) { done = true; clearTimeout(timer); resolve(res) } })
       .catch(() => { clearTimeout(timer); fallback().then(r => { if (!done) { done = true; resolve(r || Response.error()) } }) });
  }));
});
