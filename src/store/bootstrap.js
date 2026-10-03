// Открытие локальной базы, первый запуск, проверка и миграция версии формата, загрузка в память.

import { openRepo } from './localRepo.js';
import { store, bumpData, setUi, refreshNow } from './appState.js';
import { initActions, refreshDirty, purgeExpiredTrash, syncDeviceInfo } from './actions.js';
import { createClock } from '../core/clock.js';
import { uuidv7 } from '../core/ids.js';
import { defaultLists, defaultSettings, defaultPriorities, newDevice } from '../core/model.js';
import { deviceTimeZone } from '../core/dates.js';
import { buildDb, COLLECTIONS } from '../data/envelope.js';
import { migrateDb } from '../data/migrations/index.js';
import { SCHEMA_VERSION, APP_VERSION } from '../version.js';

export function detectPlatform() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return { platform: 'android-chrome', name: 'Телефон' };
  if (/iPhone|iPad/i.test(ua)) return { platform: 'ios-safari', name: 'iPhone' };
  if (/Windows/i.test(ua)) return { platform: /Edg\//.test(ua) ? 'windows-edge' : 'windows-chrome', name: 'Комп' };
  return { platform: 'other', name: 'Устройство' };
}

/** Миграция локальной базы при обновлении приложения (docs/TZ.md §12). Снимок до миграции — в сторе snapshots. */
async function migrateLocal(repo, loaded, fromVersion) {
  const data = {};
  for (const c of COLLECTIONS) data[c] = loaded[c];
  const db = { ...buildDb(data, { createdAt: loaded.meta['db.createdAt'], deviceId: loaded.meta.deviceId }), schemaVersion: fromVersion };
  const migrated = migrateDb(db);
  await repo.replaceAll(migrated.data, {
    meta: { schemaVersion: migrated.schemaVersion },
    snapshot: { key: `pre-migration-v${fromVersion}`, at: new Date().toISOString(), db },
  });
}

export async function bootstrap() {
  const repo = await openRepo();
  let loaded = await repo.loadAll();
  const clock = createClock(loaded.meta['clock.lastStamp'] || 0);

  if (!loaded.meta.deviceId) {
    // Первый запуск на этом устройстве.
    const deviceId = uuidv7();
    const { platform, name } = detectPlatform();
    const c = { now: Date.now(), stamp: () => clock.stamp(), deviceId };
    const puts = [];
    if (!loaded.settings.length) puts.push(['settings', defaultSettings(deviceTimeZone())]);
    if (!loaded.lists.length) for (const l of defaultLists()) puts.push(['lists', l]);
    if (!loaded.priorities.length) for (const p of defaultPriorities()) puts.push(['priorities', p]);
    puts.push(['devices', newDevice({ id: deviceId, name, platform, appVersion: APP_VERSION }, c)]);
    await repo.commit({
      puts,
      meta: {
        deviceId,
        deviceName: name,
        schemaVersion: SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        'clock.lastStamp': clock.last,
      },
    });
    loaded = await repo.loadAll();
  }

  const localSchema = loaded.meta.schemaVersion ?? SCHEMA_VERSION;
  if (localSchema > SCHEMA_VERSION) {
    setUi({
      readOnlySource: 'local',
      readOnly: `Данные на этом устройстве записаны более новой версией приложения (формат v${localSchema}, у тебя v${SCHEMA_VERSION}). Обнови приложение — до этого правки недоступны.`,
    });
  } else if (localSchema < SCHEMA_VERSION) {
    try {
      await migrateLocal(repo, loaded, localSchema);
      loaded = await repo.loadAll();
    } catch (e) {
      setUi({ readOnlySource: 'local', readOnly: `Не удалось обновить формат данных (v${localSchema} → v${SCHEMA_VERSION}): ${e.message}. Данные не изменены.` });
    }
  }

  const m = loaded.meta;
  store.deviceId = m.deviceId;
  store.auth = m.auth || null;
  Object.assign(store.sync, {
    layout: m['sync.layout'] || null,
    lastRevisionId: m['sync.lastRevisionId'] || null,
    lastPullAt: m['sync.lastPullAt'] || null,
    lastPushAt: m['sync.lastPushAt'] || null,
    everLoggedIn: !!m['auth.everLoggedIn'],
  });
  store.data.settings = loaded.settings[0] ?? defaultSettings(deviceTimeZone());
  store.data.lists = new Map(loaded.lists.map((x) => [x.id, x]));
  store.data.tasks = new Map(loaded.tasks.map((x) => [x.id, x]));
  store.data.media = new Map(loaded.media.map((x) => [x.id, x]));
  store.data.devices = new Map(loaded.devices.map((x) => [x.id, x]));
  for (const c of ['priorities', 'coinEvents', 'rewards']) store.data[c] = new Map(loaded[c].map((x) => [x.id, x]));

  initActions({ repo, clock, deviceId: store.deviceId });
  refreshNow();
  bumpData();
  await refreshDirty();
  if (!store.ui.readOnly) {
    await purgeExpiredTrash();
    await syncDeviceInfo();
  }
  return repo;
}
