// Kuldkala service worker: hoiab äpi faile vahemälus, et see avaneks ka nõrga netiga.
importScripts('config.js');
const VERSION = 'kk-v5';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'parse.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/badge-96.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Ainult oma failid: kõigepealt võrk, siis vahemälu. Serveri ja Google'i päringuid ei puutu.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request)
    .then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return res;
    })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});

// ---------- teated ----------
self.addEventListener('push', (e) => {
  let d = {};
  try { const j = e.data.json(); d = j.data || j; } catch { /* tühi teade */ }
  const isTask = d.kind === 'task' && d.taskId;
  e.waitUntil(self.registration.showNotification(d.title || 'Kuldkala', {
    body: d.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: isTask ? 'task-' + d.taskId : (d.kind || 'kk'),
    renotify: true,
    requireInteraction: isTask,
    data: d,
    actions: isTask ? [{ action: 'done', title: '✓ Tehtud' }, { action: 'snooze', title: '1h hiljem' }] : [],
  }));
});

async function deviceSecret() {
  const r = await (await caches.open('kk-device')).match('secret');
  return r ? r.text() : '';
}

self.addEventListener('notificationclick', (e) => {
  const n = e.notification;
  const d = n.data || {};
  n.close();
  if ((e.action === 'done' || e.action === 'snooze') && d.taskId) {
    e.waitUntil(deviceSecret().then((secret) => fetch(self.KULDKALA_CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ device: secret, action: e.action, data: { id: d.taskId, minutes: 60 } }),
    })).catch(() => {}));
    return;
  }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => c.url.includes(self.registration.scope));
    return w ? w.focus() : self.clients.openWindow('./');
  }));
});
