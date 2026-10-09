// Service Worker LifeTasks (docs/ARCHITECTURE.md §8.1).
// Блок между маркерами генерирует tools/release.py — руками не править.

// <generated>
const VERSION = '0.14.4';
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
  './src/core/analytics.js',
  './src/core/barcode.js',
  './src/core/body.js',
  './src/core/canonical.js',
  './src/core/clock.js',
  './src/core/dates.js',
  './src/core/earnings.js',
  './src/core/errors.js',
  './src/core/explore.js',
  './src/core/feast.js',
  './src/core/foodQuery.js',
  './src/core/game.js',
  './src/core/i18n.en.js',
  './src/core/i18n.js',
  './src/core/ids.js',
  './src/core/measures.js',
  './src/core/media.js',
  './src/core/merge.js',
  './src/core/model.js',
  './src/core/nutrition.js',
  './src/core/order.js',
  './src/core/planning.js',
  './src/core/plural.js',
  './src/core/priorities.js',
  './src/core/query.js',
  './src/core/reminders.js',
  './src/core/repeat.js',
  './src/core/retention.js',
  './src/core/selectors.js',
  './src/core/sessions.js',
  './src/core/skills.js',
  './src/core/timeWindow.js',
  './src/core/treeDrop.js',
  './src/core/village.js',
  './src/data/envelope.js',
  './src/data/exportZip.js',
  './src/data/feastEnvelope.js',
  './src/data/migrations/index.js',
  './src/data/migrations/m001_to_002.js',
  './src/data/migrations/m002_to_003.js',
  './src/data/serialize.js',
  './src/data/validate.js',
  './src/google/auth.js',
  './src/google/drive.js',
  './src/google/http.js',
  './src/google/layout.js',
  './src/main.js',
  './src/media/cache.js',
  './src/media/process.js',
  './src/media/recorder.js',
  './src/pwa/swClient.js',
  './src/store/actions.js',
  './src/store/appState.js',
  './src/store/bootstrap.js',
  './src/store/feastActions.js',
  './src/store/focus.js',
  './src/store/idb.js',
  './src/store/localRepo.js',
  './src/sync/backups.js',
  './src/sync/errors.js',
  './src/sync/feastSync.js',
  './src/sync/mediaSync.js',
  './src/sync/protocol.js',
  './src/sync/status.js',
  './src/sync/syncEngine.js',
  './src/ui/account.js',
  './src/ui/app.js',
  './src/ui/apps.js',
  './src/ui/components/AddFood.js',
  './src/ui/components/Appearance.js',
  './src/ui/components/Attachments.js',
  './src/ui/components/BodyFigure.js',
  './src/ui/components/DataSettings.js',
  './src/ui/components/DayStrip.js',
  './src/ui/components/Decorations.js',
  './src/ui/components/Dock.js',
  './src/ui/components/EntryDrag.js',
  './src/ui/components/Explorer.js',
  './src/ui/components/FeastCharts.js',
  './src/ui/components/FeastParts.js',
  './src/ui/components/FeastProfile.js',
  './src/ui/components/FeastSettings.js',
  './src/ui/components/Focus.js',
  './src/ui/components/ItemLists.js',
  './src/ui/components/ListEditor.js',
  './src/ui/components/Meals.js',
  './src/ui/components/Overlays.js',
  './src/ui/components/Popup.js',
  './src/ui/components/PrioritiesEditor.js',
  './src/ui/components/QuickAdd.js',
  './src/ui/components/Reminders.js',
  './src/ui/components/Repeat.js',
  './src/ui/components/Scanner.js',
  './src/ui/components/Section.js',
  './src/ui/components/SectionTabs.js',
  './src/ui/components/Sheet.js',
  './src/ui/components/Sheets.js',
  './src/ui/components/Shortcuts.js',
  './src/ui/components/Skills.js',
  './src/ui/components/Sortable.js',
  './src/ui/components/Sync.js',
  './src/ui/components/TaskRow.js',
  './src/ui/components/TaskTree.js',
  './src/ui/components/TimeInput.js',
  './src/ui/components/TimeWindow.js',
  './src/ui/components/VillageDialog.js',
  './src/ui/components/VillageView.js',
  './src/ui/dayContext.js',
  './src/ui/hooks.js',
  './src/ui/html.js',
  './src/ui/icons.js',
  './src/ui/keys.js',
  './src/ui/nav.js',
  './src/ui/notifier.js',
  './src/ui/prefs.js',
  './src/ui/router.js',
  './src/ui/screens/Analytics.js',
  './src/ui/screens/ArchiveTrash.js',
  './src/ui/screens/Body.js',
  './src/ui/screens/Diary.js',
  './src/ui/screens/FeastTrash.js',
  './src/ui/screens/Foods.js',
  './src/ui/screens/Inbox.js',
  './src/ui/screens/Journal.js',
  './src/ui/screens/Lists.js',
  './src/ui/screens/Meals.js',
  './src/ui/screens/Nutrition.js',
  './src/ui/screens/Settings.js',
  './src/ui/screens/Shop.js',
  './src/ui/screens/Task.js',
  './src/ui/screens/Today.js',
  './src/ui/screens/Village.js',
  './src/ui/theme.js',
  './src/version.js',
  './src/village/bus.js',
  './src/village/chibi.js',
  './src/village/critters.js',
  './src/village/dialogs.js',
  './src/village/draw.js',
  './src/village/keepers.js',
  './src/village/map.js',
  './src/village/portrait128.js',
  './src/village/portraits.js',
  './src/village/puppets.js',
  './src/village/runtime.js',
  './src/village/world.js',
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

// Уведомления о задачах (обновление 0.3, п. 2.5): нажатие и кнопки «Готово» / «Отложить на 10 мин».
// Само действие выполняет открытое приложение (у SW нет доступа к состоянию); если окна нет — открываем его.
self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const { taskId } = n.data || {};
  n.close();
  if (!taskId) {
    // уведомление без задачи (например, «Фокус завершён») — просто показываем приложение
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((wins) => (wins[0] ? wins[0].focus() : self.clients.openWindow(new URL('./', SCOPE).href)))
      .catch(() => {}));
    return;
  }
  const action = event.action || 'open';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((c) => c.visibilityState === 'visible') || wins[0];
    if (win) {
      win.postMessage({ type: 'lt-notify', action, taskId });
      if (action === 'open') await win.focus().catch(() => {});
      return;
    }
    const act = action === 'open' ? '' : '?act=' + action;
    await self.clients.openWindow(new URL(`./#/task/${encodeURIComponent(taskId)}${act}`, SCOPE).href);
  })());
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
