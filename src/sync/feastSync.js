// Синхронизация Feast (обновление 0.11; DATA_FORMAT §19): та же схема, что у задач (sync/protocol.js) —
// слияние по полям, запись с проверкой гонки, бэкап перед записью, — но своя база в своей папке Feast на Диске.
// Вызывается из sync/syncEngine.js внутри общей операции «Пуш» / «Обновить» (один вход, один замок).

import { store, setSync, setUi, bumpData } from '../store/appState.js';
import { getFeastRepo } from '../store/localRepo.js';
import { feastHooks, refreshFeastDirty } from '../store/feastActions.js';
import { syncHooks } from '../store/actions.js';
import { ensureLayout, recreateDb, renameLegacyRoot, SPACES } from '../google/layout.js';
import { buildFeastDb, buildFeastManifest, feastExtrasOf, parseFeastBytes, FEAST_SCHEMA_VERSION } from '../data/feastEnvelope.js';
import { gzipJson } from '../data/serialize.js';
import { mergeRemote, writeDbChecked, pushedKeys, baseFrom } from './protocol.js';
import { makeBackup, rotateBackups } from './backups.js';
import { FEAST_COLLECTIONS } from '../core/feast.js';
import { TOMBSTONE_TTL_DAYS } from '../config.js';
import { tr } from '../core/i18n.js';

const SPACE = SPACES.feast;

const available = () => !!getFeastRepo() && !!store.feast.settings;

function feastLocal() {
  const d = store.feast;
  const out = { settings: d.settings ? [d.settings] : [] };
  for (const c of FEAST_COLLECTIONS) if (c !== 'settings') out[c] = [...d[c].values()];
  return out;
}

async function dbFile(data) {
  const repo = getFeastRepo();
  const extras = (await repo.getMeta('db.extras')) || {};
  const createdAt = await repo.getMeta('db.createdAt');
  const db = buildFeastDb(data, { createdAt, deviceId: store.deviceId, extraEnvelope: extras.extraEnvelope, extraCollections: extras.extraCollections });
  return { db, bytes: await gzipJson(db) };
}

const makeManifest = (layout) => buildFeastManifest({ layout, deviceId: store.deviceId });

async function finishWrite(snapshot, newRev) {
  const repo = getFeastRepo();
  const keys = await repo.dirtyKeys();
  const remove = pushedKeys(keys, snapshot, (c, id) => feastHooks.getEntity(c, id), FEAST_COLLECTIONS);
  await repo.applySync({
    dirtyRemove: remove,
    base: baseFrom(snapshot, FEAST_COLLECTIONS),
    meta: { 'sync.lastRevisionId': newRev, 'sync.lastPushAt': new Date().toISOString() },
  });
  setSync({ feastRevisionId: newRev });
  await refreshFeastDirty();
}

let renameChecked = false;

async function ensure(drive) {
  const repo = getFeastRepo();
  let createdSnapshot = null;
  const r = await ensureLayout(drive, {
    cached: store.sync.feastLayout,
    parentId: store.sync.kingdomId,
    space: SPACE,
    makeDbBytes: async () => {
      createdSnapshot = feastLocal();
      const { db, bytes } = await dbFile(createdSnapshot);
      await repo.setMeta('db.createdAt', db.createdAt);
      return bytes;
    },
    makeManifest,
  });
  if (JSON.stringify(r.layout) !== JSON.stringify(store.sync.feastLayout)) {
    await repo.setMeta('sync.layout', r.layout);
    setSync({ feastLayout: r.layout });
  }
  if (r.created && createdSnapshot) await finishWrite(createdSnapshot, r.dbMeta.headRevisionId);
  // 0.12: папка «Feast» → «Crimson Harvest» (раз за запуск; своё имя, данное человеком, не трогаем)
  if (!renameChecked) {
    try {
      await renameLegacyRoot(drive, r.layout.rootId, SPACE);
      renameChecked = true;
    } catch (e) {
      console.warn('Crimson Harvest: папку не переименовать — попробуем при следующей синхронизации', e);
    }
  }
  return r;
}

/** Слить удалённую базу Feast в локальную (без журнала конфликтов: продукты и записи — last-write-wins). */
async function mergeIntoLocal(db, revId) {
  const repo = getFeastRepo();
  const base = await repo.loadBase();
  const res = mergeRemote({ local: feastLocal(), remote: db.data, base, collections: FEAST_COLLECTIONS, withConflicts: false });
  for (const { coll, entity } of res.changes) feastHooks.setEntity(coll, entity);
  syncHooks.observeStamp(res.maxRemoteStamp);
  const meta = { 'db.createdAt': db.createdAt, 'db.extras': feastExtrasOf(db), 'clock.lastStamp': syncHooks.clockLast() };
  if (revId) meta['sync.lastRevisionId'] = revId;
  const written = repo.applySync({
    puts: res.changes.map((c) => [c.coll, c.entity]),
    dirtyAdd: res.dirtyAdd,
    dirtyRemove: res.dirtyRemove,
    base: res.baseNext,
    meta,
  });
  if (res.changes.length) bumpData();
  await written;
  if (revId) store.sync.feastRevisionId = revId;
  if (res.changes.length) feastHooks.broadcast(res.changes.map((c) => [c.coll, c.entity.id]));
  await refreshFeastDirty();
  return res;
}

async function purgeOldTombstones() {
  const limit = Date.now() - TOMBSTONE_TTL_DAYS * 86400000;
  const dels = [];
  for (const c of FEAST_COLLECTIONS) {
    if (c === 'settings') continue;
    for (const e of store.feast[c].values()) if (e.deletedAt && Date.parse(e.deletedAt) < limit) dels.push([c, e.id]);
  }
  if (!dels.length) return;
  for (const [c, id] of dels) feastHooks.deleteEntity(c, id);
  bumpData();
  await getFeastRepo().applySync({ deletes: dels, dirtyRemove: dels.map(([c, id]) => `${c}/${id}`) });
}

/** Ошибки Feast, которые не должны ронять общую операцию. true — обработано. */
export function feastSoftError(e) {
  if (e?.code === 'E-READONLY') {
    setUi({ feastReadOnly: tr('База Crimson Harvest на Диске записана более новой версией приложения (формат v{remoteVersion}, у тебя v{FEAST_SCHEMA_VERSION}). Обнови приложение — до этого правки в Crimson Harvest недоступны.', { remoteVersion: e.remoteVersion, FEAST_SCHEMA_VERSION }) });
    return true;
  }
  return false;
}

/** Пуш Feast → { created, pushed } или { skipped }. */
export async function feastPush(drive, step) {
  if (!available() || store.ui.feastReadOnly) return { skipped: true };
  const before = store.ui.feastDirty;
  const r = await ensure(drive);
  if (r.created) return { created: true, pushed: before };
  let expected = store.sync.feastRevisionId;
  if (r.dbMeta.headRevisionId !== expected) {
    step(tr('Crimson Harvest: слияние с Диском'));
    await mergeIntoLocal(await parseFeastBytes(await drive.download(r.layout.dbId)), r.dbMeta.headRevisionId);
    expected = r.dbMeta.headRevisionId;
  }
  if (!store.ui.feastDirty) return { pushed: 0 };
  step(tr('Crimson Harvest: бэкап'));
  await makeBackup(drive, r.layout, 'push', store.deviceId, new Date(), SPACE.key);
  try {
    await rotateBackups(drive, r.layout);
  } catch (e) {
    console.warn('Crimson Harvest: ротация бэкапов не удалась — повторится при следующем пуше', e);
  }
  await purgeOldTombstones();
  step(tr('Crimson Harvest: запись базы'));
  const pushedAt = new Date().toISOString();
  const { meta, snapshot } = await writeDbChecked({
    drive,
    dbId: r.layout.dbId,
    expectedPrevRev: expected,
    makeBytes: async () => {
      const data = feastLocal();
      const { bytes } = await dbFile(data);
      return { bytes, snapshot: data };
    },
    onForeign: async (bytes) => {
      step(tr('Crimson Harvest: слияние с параллельной записью'));
      await mergeIntoLocal(await parseFeastBytes(bytes), null);
      step(tr('Crimson Harvest: запись базы'));
    },
  });
  try {
    await drive.updateContent(r.layout.manifestId, buildFeastManifest({
      layout: r.layout,
      deviceId: store.deviceId,
      createdAt: await getFeastRepo().getMeta('db.createdAt'),
      lastPush: { at: pushedAt, deviceId: store.deviceId, dbRevisionId: meta.headRevisionId },
    }), 'application/json');
  } catch (e) {
    console.warn('Crimson Harvest: manifest.json не обновлён — не критично', e);
  }
  await finishWrite(snapshot, meta.headRevisionId);
  return { pushed: before };
}

/** «Обновить» Feast → { created, changes } или { skipped }. */
export async function feastPull(drive, step) {
  if (!available()) return { skipped: true };
  const r = await ensure(drive);
  if (r.created) return { created: true, changes: 0 };
  if (r.dbMeta.headRevisionId === store.sync.feastRevisionId) return { changes: 0 };
  step(tr('Crimson Harvest: загрузка базы'));
  const res = await mergeIntoLocal(await parseFeastBytes(await drive.download(r.layout.dbId)), r.dbMeta.headRevisionId);
  if (store.ui.feastReadOnly && !store.ui.feastReadOnly.startsWith('Не открылась')) setUi({ feastReadOnly: null });
  return { changes: res.changes.length };
}

/** На Диске есть версия базы Feast новее? */
export async function feastRemoteNewer(drive) {
  if (!available() || !store.sync.feastLayout) return false;
  const m = await drive.getMeta(store.sync.feastLayout.dbId, 'headRevisionId,trashed');
  return !!m.headRevisionId && m.headRevisionId !== store.sync.feastRevisionId;
}

/** Другой аккаунт Google: забыть, где лежит Feast, слияние начнётся заново. */
export async function resetFeastSync() {
  const repo = getFeastRepo();
  if (!repo) return;
  await repo.applySync({ base: new Map(), meta: { 'sync.layout': null, 'sync.lastRevisionId': null } });
  setSync({ feastLayout: null, feastRevisionId: null });
  renameChecked = false;
}

/** «Создать заново» базу Feast после E-DB-MISSING. */
export async function recreateFeastDb(drive) {
  const repo = getFeastRepo();
  let snap = null;
  const r = await recreateDb(drive, {
    space: SPACE,
    parentId: store.sync.kingdomId,
    makeDbBytes: async () => {
      snap = feastLocal();
      const { db, bytes } = await dbFile(snap);
      await repo.setMeta('db.createdAt', db.createdAt);
      return bytes;
    },
    makeManifest,
  });
  await repo.setMeta('sync.layout', r.layout);
  setSync({ feastLayout: r.layout });
  await finishWrite(snap, r.dbMeta.headRevisionId);
}
