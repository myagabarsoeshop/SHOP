/**
 * ==============================================================================
 * မြကမ္ဘာစိုး ပိုးထည်တိုက် - POS & GARMENT ERP SERVICE WORKER
 * File: cashbook-frontend/sw.js
 * ==============================================================================
 */

const CACHE_NAME = 'myagabarsoe-pos-v2.4.0';

// လက်ရှိ စနစ်အသစ်တွင် အမှန်တကယ် ရှိသော ဖိုင်လမ်းကြောင်း အတိအကျများ
const PRECACHE_ASSETS = [
  '/',
  '/index.html',

  // HTML Views (6 files)
  '/views/login.html',
  '/views/pos.html',
  '/views/cashbook.html',
  '/views/inventory.html',
  '/views/yarn.html',
  '/views/customers.html',

  // Core JS Scripts (3 files)
  '/js/app.js',
  '/js/core/api.js',
  '/js/core/state.js',

  // Module JS Scripts (6 files)
  '/js/modules/auth.js',
  '/js/modules/pos.js',
  '/js/modules/cashbook.js',
  '/js/modules/inventory.js',
  '/js/modules/yarn.js',
  '/js/modules/customers.js'
];

/**
 * 1. Install Event - Pre-cache current POS assets
 */
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        PRECACHE_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn(`[SW] Skipping pre-cache for ${asset}:`, err.message);
          })
        )
      );
    })
  );
});

/**
 * 2. Activate Event - Delete all old Golden ERP caches ('xxxxx', etc.)
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log(`[SW] Removing old cache: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

/**
 * 3. Fetch Event - Network-First for HTML/JS (so updates show immediately), Cache Fallback for Offline
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (!request.url.startsWith('http') || request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // API calls (/api/*) ကို လုံးဝ Cache မလုပ်ပါ (D1 Database မှ တိုက်ရိုက်ယူမည်)
  if (url.pathname.startsWith('/api')) {
    return;
  }

  // Network-First Strategy: အင်တာနက်ရှိလျှင် အမြဲတမ်း ကုတ်အသစ်ကို ပြပြီး၊ အင်တာနက်ပြတ်မှသာ Cache ထဲက ပြမည်
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(request, { ignoreSearch: true });
        if (cachedResponse) {
          return cachedResponse;
        }
        if (request.mode === 'navigate') {
          const fallback = await caches.match('/index.html');
          if (fallback) return fallback;
        }
        return new Response('Offline', { status: 503 });
      })
  );
});
