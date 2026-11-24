// The terminal's service worker: needed to install it as an app and for an offline splash.
// Quotes, news and charts are NOT cached here — they come fresh from the network (the page keeps its own last copy).
const CACHE = 'econ-terminal-v23';
const SHELL = ['./', './i18n.js', './i18n.xl.js', './fn.js', './tech.js', './mon.js', './map.js', './opt.js', './flow.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

// GitHub Pages lets a browser keep a file for 10 minutes without asking. Right after an update that mixed a new page
// with the old texts file (keys such as gex_flip on screen instead of words), so every copy is asked from the server.
const fresh = req => req.mode === 'navigate'
  ? new Request(req.url, {cache: 'no-cache', credentials: 'same-origin'})   // a navigation cannot be copied with options
  : new Request(req, {cache: 'no-cache'});

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: 'reload'}))))
    .then(() => self.skipWaiting()));
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
  // the page and its scripts: the server's current copy if it answers within 1.5 s, otherwise the saved copy at once
  // (the network answer still refreshes the copy, so an update shows on the next opening)
  const net = fetch(fresh(req)).then(res => {
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
