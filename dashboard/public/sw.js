const CACHE_NAME = 'bc-dashboard-v3';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/logo.png',
];

// Install — pre-cache static assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch — network-first for API, cache-first for assets
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Skip non-GET and API calls — always go to network
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api') || url.origin !== self.location.origin) {
    return;
  }

  // For navigation (HTML pages) — network first, fallback to cache
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request) || caches.match('/'))
    );
    return;
  }

  // For static assets (JS, CSS, images) — cache first, fallback to network
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return res;
      });
    })
  );
});

// ============================================
// Push Notifications — rich payloads with actions
// ============================================
self.addEventListener('push', (e) => {
  if (!e.data) return;
  try {
    const data = e.data.json();
    const options = {
      body: data.body || '',
      icon: data.icon || '/icons/icon-192x192.png',
      badge: data.badge || '/icons/icon-96x96.png',
      tag: data.tag || 'default',
      vibrate: data.vibrate || [180, 90, 180],
      requireInteraction: data.requireInteraction === true,
      renotify: data.renotify === true,
      silent: data.silent === true,
      lang: data.lang || 'fr',
      dir: data.dir || 'ltr',
      timestamp: data.timestamp || Date.now(),
      data: data.data || { url: data.url || '/' },
    };
    if (data.image) options.image = data.image;
    if (Array.isArray(data.actions) && data.actions.length > 0) {
      options.actions = data.actions.slice(0, 2);
    }
    e.waitUntil(self.registration.showNotification(data.title || 'BarberClub', options));
  } catch {
    // ignore malformed push
  }
});

self.addEventListener('notificationclick', (e) => {
  const action = e.action;
  const d = e.notification.data || {};
  e.notification.close();

  // Action "Appeler" (SMS failed) -> ouvre tel:... directement
  if (action === 'call' && d.phone) {
    e.waitUntil(self.clients.openWindow(`tel:${d.phone}`));
    return;
  }

  // Tout le reste (action "view" ou clic body) -> ouvre dashboard
  const url = d.url || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          if (client.navigate) client.navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
