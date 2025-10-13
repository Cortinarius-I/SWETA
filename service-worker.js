// service-worker.js
// SWETA PWA Service Worker - Version 1.0.0

const CACHE_NAME = 'sweta-v1.0.0';
const STATIC_CACHE = 'sweta-static-v1.0.0';
const DYNAMIC_CACHE = 'sweta-dynamic-v1.0.0';

// Files to cache for offline use
const staticAssets = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&display=swap'
];

// Install event - cache static assets
self.addEventListener('install', event => {
  console.log('[ServiceWorker] Installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      console.log('[ServiceWorker] Caching static assets');
      return cache.addAll(staticAssets.map(url => {
        return new Request(url, { cache: 'no-cache' });
      }));
    }).catch(err => {
      console.error('[ServiceWorker] Failed to cache static assets:', err);
    })
  );
  
  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('[ServiceWorker] Activating...');
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(cacheName => {
            // Delete old cache versions
            return cacheName.startsWith('sweta-') && 
                   cacheName !== STATIC_CACHE && 
                   cacheName !== DYNAMIC_CACHE;
          })
          .map(cacheName => {
            console.log('[ServiceWorker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          })
      );
    })
  );
  
  // Claim all clients immediately
  self.clients.claim();
});

// Fetch event - serve from cache when possible
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip Google Apps Script requests (they should always go to network)
  if (url.href.includes('script.google.com')) {
    event.respondWith(fetch(request));
    return;
  }
  
  // Skip cross-origin requests except for fonts
  if (url.origin !== location.origin && !url.href.includes('fonts.googleapis.com')) {
    return;
  }
  
  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (cachedResponse) {
        // Return cached response and fetch update in background
        fetchAndUpdate(request);
        return cachedResponse;
      }
      
      // Not in cache, fetch from network
      return fetch(request).then(response => {
        // Don't cache non-successful responses
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }
        
        // Clone the response since it can only be consumed once
        const responseToCache = response.clone();
        
        // Cache the fetched response for future use
        caches.open(DYNAMIC_CACHE).then(cache => {
          cache.put(request, responseToCache);
        });
        
        return response;
      }).catch(error => {
        console.error('[ServiceWorker] Fetch failed:', error);
        
        // Return offline page if available
        if (request.destination === 'document') {
          return caches.match('./index.html');
        }
        
        // Return a fallback response for other requests
        return new Response('Offline - Content not available', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({
            'Content-Type': 'text/plain'
          })
        });
      });
    })
  );
});

// Background fetch and update
function fetchAndUpdate(request) {
  fetch(request).then(response => {
    if (response && response.status === 200) {
      caches.open(DYNAMIC_CACHE).then(cache => {
        cache.put(request, response.clone());
      });
    }
  }).catch(err => {
    console.log('[ServiceWorker] Background update failed:', err);
  });
}

// Message event - handle messages from the app
self.addEventListener('message', event => {
  console.log('[ServiceWorker] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CACHE_URLS') {
    event.waitUntil(
      caches.open(DYNAMIC_CACHE).then(cache => {
        return cache.addAll(event.data.urls);
      })
    );
  }
});

// Sync event - background sync for offline messages
self.addEventListener('sync', event => {
  console.log('[ServiceWorker] Sync event fired:', event.tag);
  
  if (event.tag === 'sync-messages') {
    event.waitUntil(syncMessages());
  }
});

// Function to sync messages when back online
async function syncMessages() {
  try {
    // Get all clients
    const clients = await self.clients.matchAll();
    
    // Send message to all clients to trigger sync
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_REQUIRED'
      });
    });
    
    console.log('[ServiceWorker] Sync completed');
  } catch (error) {
    console.error('[ServiceWorker] Sync failed:', error);
    throw error; // Re-throw to retry sync later
  }
}

// Push event - handle push notifications for scheduled messages
self.addEventListener('push', event => {
  const options = {
    body: event.data ? event.data.text() : 'Time for your work check-in!',
    icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    badge: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    vibrate: [200, 100, 200],
    tag: 'sweta-notification',
    requireInteraction: true,
    actions: [
      {
        action: 'open',
        title: 'Open SWETA',
        icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
      },
      {
        action: 'dismiss',
        title: 'Dismiss'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('SWETA - Work Check-in! 💜', options)
  );
});

// Notification click event
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.action === 'dismiss') {
    return;
  }
  
  // Open or focus the app
  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(clientList => {
      // Check if app is already open
      for (let client of clientList) {
        if (client.url.includes('github.io') && 'focus' in client) {
          return client.focus();
        }
      }
      
      // App not open, open it
      if (clients.openWindow) {
        return clients.openWindow('./');
      }
    })
  );
});

// Periodic background sync for scheduled messages (if browser supports it)
self.addEventListener('periodicsync', event => {
  if (event.tag === 'check-schedule') {
    console.log('[ServiceWorker] Checking schedule...');
    event.waitUntil(checkScheduledMessages());
  }
});

async function checkScheduledMessages() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const day = now.getDay();
  
  // Check if it's time for a scheduled message
  let shouldNotify = false;
  let message = '';
  
  // Sunday noon check
  if (day === 0 && hours === 12 && minutes === 0) {
    message = "Happy Sunday! Time for your weekly check-in! 🌟";
    shouldNotify = true;
  }
  // Morning message (8:00 AM, Mon-Sat)
  else if (day !== 0 && hours === 8 && minutes === 0) {
    message = "Good morning! Time to log your morning activities! ☀️";
    shouldNotify = true;
  }
  // Hourly checks (8:30 AM to 9:30 PM, Mon-Sat)
  else if (day !== 0 && minutes === 30) {
    if ((hours === 8) || (hours >= 9 && hours <= 21)) {
      message = "Time to log what you did in the last hour! ⏰";
      shouldNotify = true;
    }
  }
  
  if (shouldNotify) {
    await self.registration.showNotification('SWETA - Work Check-in! 💜', {
      body: message,
      icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      badge: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      tag: 'scheduled-' + Date.now(),
      requireInteraction: true
    });
  }
}

// Log service worker version
console.log('[ServiceWorker] SWETA Service Worker v1.0.0 loaded');