const CACHE_NAME = 'bc-dashboard-v2';
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
// Push Notifications
// ============================================
self.addEventListener('push', (e) => {
  if (!e.data) return;
  try {
    const data = e.data.json();
    e.waitUntil(
      self.registration.showNotification(data.title || 'BarberClub', {
        body: data.body || '',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-96x96.png',
        tag: data.tag || 'default',
        data: { url: data.url || '/' },
      })
    );
  } catch {
    // ignore malformed push
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing tab if one is open
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      // Open new tab
      return self.clients.openWindow(url);
    })
  );
});
