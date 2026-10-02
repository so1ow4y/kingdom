// Service Worker LifeTasks (docs/ARCHITECTURE.md §8.1).
// Блок между маркерами генерирует tools/release.py — руками не править.

// <generated>
const VERSION = '0.2.0';
const PRECACHE = [
  './',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './index.html',
  './manifest.webmanifest',
  './src/config.js',
  './src/core/canonical.js',
  './src/core/clock.js',
  './src/core/dates.js',
  './src/core/errors.js',
  './src/core/ids.js',
  './src/core/merge.js',
  './src/core/model.js',
  './src/core/order.js',
  './src/core/plural.js',
  './src/core/selectors.js',
  './src/data/envelope.js',
  './src/data/migrations/index.js',
  './src/data/serialize.js',
  './src/data/validate.js',
  './src/google/auth.js',
  './src/google/drive.js',
  './src/google/http.js',
  './src/google/layout.js',
  './src/main.js',
  './src/pwa/swClient.js',
  './src/store/actions.js',
  './src/store/appState.js',
  './src/store/bootstrap.js',
  './src/store/idb.js',
  './src/store/localRepo.js',
  './src/sync/backups.js',
  './src/sync/errors.js',
  './src/sync/protocol.js',
  './src/sync/status.js',
  './src/sync/syncEngine.js',
  './src/ui/app.js',
  './src/ui/components/ListEditor.js',
  './src/ui/components/Overlays.js',
  './src/ui/components/QuickAdd.js',
  './src/ui/components/Section.js',
  './src/ui/components/Sheet.js',
  './src/ui/components/Sheets.js',
  './src/ui/components/Sortable.js',
  './src/ui/components/Sync.js',
  './src/ui/components/TaskRow.js',
  './src/ui/hooks.js',
  './src/ui/html.js',
  './src/ui/icons.js',
  './src/ui/router.js',
  './src/ui/screens/ArchiveTrash.js',
  './src/ui/screens/Inbox.js',
  './src/ui/screens/Journal.js',
  './src/ui/screens/Lists.js',
  './src/ui/screens/Settings.js',
  './src/ui/screens/Task.js',
  './src/ui/screens/Today.js',
  './src/ui/theme.js',
  './src/version.js',
  './styles/app.css',
  './vendor/htm-preact-standalone.mjs',
];
// </generated>

const CACHE = 'lifetasks-shell-' + VERSION;
const SCOPE = new URL(self.registration.scope);
// На localhost — сначала сеть (правки кода видны сразу), на GitHub Pages — сначала кэш.
const DEV = SCOPE.hostname === 'localhost' || SCOPE.hostname === '127.0.0.1';
const INDEX = new URL('index.html', SCOPE).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE.map((p) => new Request(new URL(p, SCOPE).href, { cache: 'reload' })));
  })());
  // skipWaiting не вызываем: новая версия ждёт, пока пользователь нажмёт «Обновить».
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('lifetasks-shell-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') event.ports[0]?.postMessage({ version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Чужие адреса (Google API) не трогаем. Тесты не кэшируем.
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  if (url.pathname.startsWith(SCOPE.pathname + 'tests/')) return;
  const key = req.mode === 'navigate' ? INDEX : req;
  event.respondWith(DEV ? networkFirst(req, key) : cacheFirst(req, key));
});

async function cacheFirst(req, key) {
  const cached = await caches.match(key, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) (await caches.open(CACHE)).put(key, res.clone());
  return res;
}

async function networkFirst(req, key) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(CACHE)).put(key, res.clone());
    return res;
  } catch (e) {
    const cached = await caches.match(key, { ignoreSearch: true });
    if (cached) return cached;
    throw e;
  }
}
