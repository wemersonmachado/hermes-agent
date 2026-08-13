/* BROW PWA — Service Worker v6.6.2 */
const CACHE_NAME = 'brow-pwa-v7-0-0';
const ASSETS_TO_CACHE = [
  '/pwa/',
  '/pwa/index.html',
  '/pwa/manifest.json',
  '/pwa/pwa.css?v=7.0.0',
  '/pwa/pwa-mobile.css?v=7.0.0',
  '/pwa/pwa.js?v=7.0.0',
  '/pwa/pwa-sync.js?v=7.0.0',
  '/pwa/icons/icons/icon-192.png',
  '/pwa/icons/icons/icon-512.png'
];

// Instalação: Cache dos ativos fundamentais da PWA
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[BROW PWA SW] Caching App Shell v6.6.2');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Ativação: Limpeza total de caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[BROW PWA SW] Removendo cache antigo:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Interceptação de requisições: Estratégia Network-First com Fallback de Cache
self.addEventListener('fetch', (event) => {
  // Para chamadas de API (/api/hermes/*), sempre tenta rede diretamente
  if (new URL(event.request.url).pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: 'Você está offline no momento.', offline: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Para ativos estáticos, Network-First com Fallback para Cache -- cache:
  // 'no-store' é o que faz "network-first" ser network-first DE VERDADE
  // (ver comentário no topo do arquivo); sem isso, o navegador podia servir
  // uma resposta do PRÓPRIO cache HTTP sem o Service Worker perceber.
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('/pwa/index.html');
          }
        });
      })
  );
});

// Suporte para Notificações Push
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'BROW PWA', body: 'Nova atualização do seu Segundo Cérebro AI!' };
  const options = {
    body: data.body,
    icon: '/pwa/icons/icons/icon-192.png',
    badge: '/pwa/icons/icons/icon-192.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/pwa/' }
  };
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url || '/pwa/')
  );
});
