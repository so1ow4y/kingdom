// Открытие локальной базы, первый запуск, проверка и миграция версии формата, загрузка в память.

import { openRepo, openFeastRepo } from './localRepo.js';
import { initFeastActions, refreshFeastDirty, feastEarnings } from './feastActions.js';
import { setExtraEarnings } from '../core/earnings.js';
import { defaultFeastSettings, defaultMeals, FEAST_COLLECTIONS } from '../core/feast.js';
import { store, bumpData, setUi, refreshNow } from './appState.js';
import { initActions, refreshDirty, purgeExpiredTrash, syncDeviceInfo } from './actions.js';
import { createClock } from '../core/clock.js';
import { uuidv7 } from '../core/ids.js';
import { defaultLists, defaultSettings, defaultPriorities, newDevice } from '../core/model.js';
import { deviceTimeZone } from '../core/dates.js';
import { buildDb, COLLECTIONS } from '../data/envelope.js';
import { migrateDb } from '../data/migrations/index.js';
import { SCHEMA_VERSION, APP_VERSION } from '../version.js';
import { tr } from '../core/i18n.js';

export function detectPlatform() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return { platform: 'android-chrome', name: tr('Телефон') };
  if (/iPhone|iPad/i.test(ua)) return { platform: 'ios-safari', name: 'iPhone' };
  if (/Windows/i.test(ua)) return { platform: /Edg\//.test(ua) ? 'windows-edge' : 'windows-chrome', name: tr('Комп') };
  return { platform: 'other', name: tr('Устройство') };
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

/**
 * Feast (0.11): своя база IndexedDB. Не открылась — задачи работают как обычно, Feast — только для чтения.
 * → { repo, loaded } или null.
 */
async function openFeast() {
  try {
    const repo = await openFeastRepo();
    let loaded = await repo.loadAll();
    const puts = [];
    if (!loaded.settings.length) puts.push(['settings', defaultFeastSettings()]);
    // основные рационы (0.12): одинаковые на всех устройствах — создаются, если их ещё нет
    const have = new Set(loaded.meals.map((m) => m.id));
    for (const m of defaultMeals()) if (!have.has(m.id)) puts.push(['meals', m]);
    if (puts.length) {
      await repo.commit({ puts, meta: loaded.settings.length ? {} : { createdAt: new Date().toISOString() } });
      loaded = await repo.loadAll();
    }
    return { repo, loaded };
  } catch (e) {
    console.error('Feast', e);
    setUi({ feastLocalBroken: true, feastReadOnly: tr('Не открылась локальная база Crimson Harvest: {p0}. Задачи работают как обычно.', { p0: e?.message || e }) });
    return null;
  }
}

function loadFeast(f) {
  const d = store.feast;
  d.settings = f.loaded.settings[0] || defaultFeastSettings();
  for (const c of FEAST_COLLECTIONS) if (c !== 'settings') d[c] = new Map((f.loaded[c] || []).map((x) => [x.id, x]));
  store.sync.feastLayout = f.loaded.meta['sync.layout'] || null;
  store.sync.feastRevisionId = f.loaded.meta['sync.lastRevisionId'] || null;
}

export async function bootstrap() {
  const repo = await openRepo();
  let loaded = await repo.loadAll();
  const feast = await openFeast();
  // Одни часы меток на оба приложения: метки растут и после правок то в задачах, то в Feast
  const clock = createClock(Math.max(loaded.meta['clock.lastStamp'] || 0, feast?.loaded.meta['clock.lastStamp'] || 0));

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
      readOnly: tr('Данные на этом устройстве записаны более новой версией приложения (формат v{localSchema}, у тебя v{SCHEMA_VERSION}). Обнови приложение — до этого правки недоступны.', { localSchema, SCHEMA_VERSION }),
    });
  } else if (localSchema < SCHEMA_VERSION) {
    try {
      await migrateLocal(repo, loaded, localSchema);
      loaded = await repo.loadAll();
    } catch (e) {
      setUi({ readOnlySource: 'local', readOnly: tr('Не удалось обновить формат данных (v{localSchema} → v{SCHEMA_VERSION}): {message}. Данные не изменены.', { localSchema, SCHEMA_VERSION, message: e.message }) });
    }
  }

  const m = loaded.meta;
  store.deviceId = m.deviceId;
  store.auth = m.auth || null;
  Object.assign(store.sync, {
    layout: m['sync.layout'] || null,
    kingdomId: m['sync.kingdomId'] || null,
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
  for (const c of ['priorities', 'coinEvents', 'rewards', 'doneArchive', 'templates']) store.data[c] = new Map((loaded[c] || []).map((x) => [x.id, x]));

  initActions({ repo, clock, deviceId: store.deviceId });
  if (feast) {
    loadFeast(feast);
    initFeastActions({ repo: feast.repo, clock, deviceId: store.deviceId });
    // опыт, монеты и 💎 за еду (0.12) — в общий баланс игры
    setExtraEarnings(feastEarnings);
    await refreshFeastDirty();
  }
  refreshNow();
  bumpData();
  await refreshDirty();
  if (!store.ui.readOnly) {
    await purgeExpiredTrash();
    await syncDeviceInfo();
  }
  return repo;
}
