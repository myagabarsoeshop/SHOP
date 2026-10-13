/**
 * GOLDEN ERP SYSTEM - PROGRESSIVE WEB APP (PWA) SERVICE WORKER
 * File: sw.js (Location: shop-frontend/sw.js)
 * 💡 Features: Fault-Tolerant Parallel Pre-caching (Zero Install Bottlenecks),
 *              Native Route Reconciliation via ignoreSearch (Phase 4.3),
 *              0ms Instant Offline Navigation (Stale-While-Revalidate Engine),
 *              🎯 Phase 4.1: Font Awesome WebFonts Pre-caching (Zero Broken Icons Offline),
 *              Crash-Proof Fetch Interceptor (Zero TypeError on Offline Drop)
 */

const CACHE_NAME = 'xxxxx';

// 💡 အော့ဖ်လိုင်းသုံးနိုင်ရန် စက်ထဲ ကြိုတင်သိမ်းဆည်းမည့် ဖိုင်များအားလုံး (CSS + JS + HTML Views + WebFonts)
const PRECACHE_ASSETS = [
  './',
  './index.html',
  
  // 💡 1. CORE STYLES
  './css/tailwind.min.css',
  './css/fontawesome.min.css',
  './css/style.css',

  // 🎯 Phase 4.1 Fix: Offline Font Icons Pre-caching (အော့ဖ်လိုင်းတွင် icon များ အပြည့်အဝ ပေါ်စေရန်)
  './webfonts/fa-solid-900.woff2',
  './webfonts/fa-regular-400.woff2',
  './webfonts/fa-brands-400.woff2',
  './webfonts/fa-v4compatibility.woff2',

  // 💡 2. CORE APPLICATION SCRIPTS
  './js/config.js',
  './js/offline-sync.js',
  './js/api.js',
  './js/auth.js',
  './js/reports.js',
  './js/settings.js',
  './js/dashboard.js',
  './js/app.js',

  // 💡 3. ALL 13 RECONCILED HTML VIEWS (Offline SPA View Routes)
  './views/dashboard.html',
  './views/reports.html',
  './views/settings.html'
];

/**
 * 💡 1. Install Event - Parallel Fault-Tolerant Pre-caching
 */
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing & Pre-caching All Styles, Scripts, Fonts & Views...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        PRECACHE_ASSETS.map(asset => {
          return cache.add(asset).catch(err => {
            console.warn(`[Service Worker] Warning caching ${asset}:`, err.message);
          });
        })
      );
    }).then(() => self.skipWaiting())
  );
});

/**
 * 💡 2. Activate Event - Clean Old Cache Versions
 */
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating & Cleaning Old Caches...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log(`[Service Worker] Deleting old cache: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

/**
 * 💡 3. Crash-Proof Fetch Interceptor & Route Reconciler
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Ignore non-HTTP/HTTPS requests
  if (!request.url.startsWith('http')) {
    return;
  }

  const url = new URL(request.url);

  // Bypass API calls & Cloudflare Worker endpoints (Handled by offline-sync.js)
  if (
    request.method !== 'GET' ||
    url.pathname.startsWith('/api') ||
    url.hostname.includes('workers.dev') ||
    url.searchParams.has('action')
  ) {
    return; 
  }

  // Stale-While-Revalidate Engine with Native ignoreSearch
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(request, { ignoreSearch: true });

      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => null);

      if (cachedResponse) {
        event.waitUntil(fetchPromise);
        return cachedResponse;
      }

      const networkResponse = await fetchPromise;
      if (networkResponse) {
        return networkResponse;
      }

      if (request.mode === 'navigate') {
        const indexFallback = await cache.match('./index.html', { ignoreSearch: true });
        if (indexFallback) return indexFallback;
      }

      return new Response('', {
        status: 503,
        statusText: 'Service Unavailable (Offline)'
      });
    })()
  );
});
