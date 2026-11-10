// Solo la interfaz está disponible sin internet. Nunca cachea datos privados de Firebase.
const CACHE = 'gps-control-pro-shell-v1';
const SHELL = ['./', './index.html', './app.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method!=='GET' || url.origin!==self.location.origin) return;
  if (event.request.mode==='navigate') {
    event.respondWith(fetch(event.request).catch(()=>caches.match('./index.html')));
    return;
  }
  if (SHELL.some(p=>url.pathname.endsWith(p.replace('./','')))) {
    event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
  }
});
