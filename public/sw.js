// Service Worker for PWA support
// Phase 22: Mobile Web Optimization

const CACHE_NAME = 'interactive-stories-v1';
const urlsToCache = [
  '/',
  '/campaigns',
  '/offline',
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // Cache hit - return response
      if (response) {
        return response;
      }

      return fetch(event.request).then((response) => {
        // Check if valid response
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        // Clone the response
        const responseToCache = response.clone();

        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return response;
      });
    }).catch(() => {
      // If both cache and network fail, show offline page
      return caches.match('/offline');
    })
  );
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-actions') {
    event.waitUntil(syncPendingActions());
  }
});

async function syncPendingActions() {
  // Sync any pending player actions when connection is restored
  // This would integrate with IndexedDB to store offline actions
  console.log('Syncing pending actions...');
}

// Web push is deliberately NOT implemented here.
//
// A correct-looking `push` + `notificationclick` pair used to sit at this
// spot and could never fire: nothing in the app ever called
// pushManager.subscribe(), there were no VAPID keys, and no server-side
// web-push send — so the listener sat waiting for an event that had no
// way to exist (README #10/#63/#64). Real browser push needs a VAPID
// keypair, a subscription store, and a genuine push send; it's tracked as
// a feature rather than left here as scaffolding that reads like a
// working pipeline. In-app and email notifications both work today.
