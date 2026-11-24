const CACHE = 'econ-terminal-v23';
const SHELL = ['./', './i18n.js', './i18n.xl.js', './fn.js', './tech.js', './mon.js', './map.js', './opt.js', './flow.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

const fresh = req => req.mode === 'navigate'
  ? new Request(req.url, {cache: 'no-cache', credentials: 'same-origin'})
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
