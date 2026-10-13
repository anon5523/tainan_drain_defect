/* 臺南市雨水下水道缺失圖台 — Service Worker */
const VERSION = 'v3';
const SHELL = `shell-${VERSION}`;
const TILES = `tiles-${VERSION}`;
const PHOTOS = `photos-${VERSION}`;
const TILE_MAX = 400;
const PHOTO_MAX = 400;

const SHELL_FILES = [
  './',
  './index.html',
  './assets/app.css',
  './assets/app.js',
  './vendor/leaflet.js',
  './vendor/leaflet.css',
  './data/records.json',
  './data/tainan.json',
  './data/photo_index.json',
  './data/network.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => Promise.allSettled(SHELL_FILES.map(f => c.add(f))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => ![SHELL, TILES, PHOTOS].includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

async function trim(name, max){
  const c = await caches.open(name);
  const keys = await c.keys();
  if(keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map(k => c.delete(k)));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  // 底圖磚：先用快取，同時背景更新
  if(/tile\.openstreetmap\.org/.test(url.hostname)){
    e.respondWith((async () => {
      const c = await caches.open(TILES);
      const hit = await c.match(req);
      const net = fetch(req).then(res => {
        if(res && (res.ok || res.type === 'opaque')){ c.put(req, res.clone()); trim(TILES, TILE_MAX); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })());
    return;
  }

  if(url.origin !== location.origin) return;

  // 照片：用過才快取
  if(url.pathname.includes('/photos/')){
    e.respondWith((async () => {
      const c = await caches.open(PHOTOS);
      const hit = await c.match(req);
      if(hit) return hit;
      try{
        const res = await fetch(req);
        if(res.ok){ c.put(req, res.clone()); trim(PHOTOS, PHOTO_MAX); }
        return res;
      }catch(err){ return new Response('', {status:504}); }
    })());
    return;
  }

  // 其餘同源資源：快取優先，背景更新
  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    const hit = await c.match(req, {ignoreSearch:true});
    const net = fetch(req).then(res => {
      if(res && res.ok) c.put(req, res.clone());
      return res;
    }).catch(() => hit || caches.match('./index.html'));
    return hit || net;
  })());
});
