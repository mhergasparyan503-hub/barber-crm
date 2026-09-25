// Barber CRM service worker — for installability only. NO caching:
// every request goes to the network, so new versions always arrive.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // Remove any caches left by older versions.
      for (const k of await caches.keys()) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.mode !== 'navigate') return; // assets, /api: browser default (no SW involvement)
  e.respondWith(
    fetch(req).catch(
      () =>
        new Response(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;padding:24px;text-align:center"><h3>Нет интернета</h3><p>Проверьте связь и обновите страницу.</p><button onclick="location.reload()">Обновить</button>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        ),
    ),
  );
});
