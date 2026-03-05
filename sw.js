// BarberClub Service Worker
// Bump version on each deploy to invalidate stale cache
const CACHE_VERSION = 3;
const CACHE_NAME = `barberclub-v${CACHE_VERSION}`;
const OFFLINE_URL = 'index.html';

// Assets to cache on install
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/pages/grenoble/',
    '/pages/meylan/',
    '/pages/grenoble/prestations.html',
    '/pages/meylan/prestations.html',
    '/assets/images/common/logo-blanc.png',
    '/assets/images/common/couronne.png',
    '/assets/images/salons/grenoble/salon-grenoble.jpg',
    '/assets/images/salons/meylan/salon-meylan.jpg',
    '/assets/fonts/Orbitron-ExtraBold.ttf',
    '/config/manifest.json'
];

// Never cache API calls or booking pages (always need fresh data)
const NEVER_CACHE = ['/api/', '/pages/meylan/reserver.html', '/pages/meylan/mon-rdv.html', '/pages/meylan/reset-password.html'];

// Install event - precache core assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(PRECACHE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate event - delete ALL old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', event => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip external requests
    if (!event.request.url.startsWith(self.location.origin)) return;

    // Never cache API calls or dynamic booking pages
    const url = new URL(event.request.url);
    if (NEVER_CACHE.some(path => url.pathname.startsWith(path))) {
        return; // Let browser handle normally (no SW interception)
    }

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Clone the response before caching
                const responseToCache = response.clone();

                // Cache successful responses
                if (response.status === 200) {
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseToCache);
                    });
                }

                return response;
            })
            .catch(() => {
                // Network failed, try cache
                return caches.match(event.request)
                    .then(cachedResponse => {
                        if (cachedResponse) {
                            return cachedResponse;
                        }

                        // If it's a navigation request, show offline page
                        if (event.request.mode === 'navigate') {
                            return caches.match(OFFLINE_URL);
                        }

                        return new Response('Offline', {
                            status: 503,
                            statusText: 'Service Unavailable'
                        });
                    });
            })
    );
});
