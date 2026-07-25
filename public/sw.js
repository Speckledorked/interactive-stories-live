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

// Web push (README #92).
//
// These handlers previously existed with nothing behind them — no
// subscription flow, no VAPID keys, no server-side send — so they waited
// on an event that had no way to be produced. They're live now: the app
// calls pushManager.subscribe() with the server's VAPID public key and
// POSTs the result to /api/notifications/push, and push-service.ts signs
// and sends real Web Push messages to those endpoints.
self.addEventListener('push', (event) => {
  // A push with no payload is still worth showing — some services send
  // an empty "wake up" push — so fall back rather than bailing out.
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = {};
  }

  const options = {
    body: data.body || 'New activity in your campaign',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    // Collapse repeats from the same campaign rather than stacking a
    // separate banner for every scene resolution.
    tag: data.notificationId ? `mythos-${data.notificationId}` : 'mythos',
    data: {
      url: data.url || '/',
    },
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'MythOS', options)
  );
});

// Focus an existing tab if one is already open rather than piling up new
// windows every time a notification is clicked.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
