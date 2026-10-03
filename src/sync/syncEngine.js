// Движок синхронизации: пуш, забор, авто-вход при запуске, опрос «на Диске новее» (docs/TZ.md §8–9).
// Протокол (слияние, проверка гонки) — в sync/protocol.js; здесь — связь с локальной базой и интерфейсом.

import { store, setSync, setUi, showSnackbar, ask, notify, bumpData, refreshNow } from '../store/appState.js';
import { getRepo } from '../store/localRepo.js';
import { syncHooks, refreshDirty, markDevicePushed } from '../store/actions.js';
import { createDrive } from '../google/drive.js';
import { tokenValid, startLogin, completeLogin } from '../google/auth.js';
import { ensureLayout, recreateDb } from '../google/layout.js';
import { buildDb, buildManifest, extrasOf } from '../data/envelope.js';
import { gzipJson } from '../data/serialize.js';
import { parseDbBytes, mergeRemote, writeDbChecked, pushedKeys, baseFrom } from './protocol.js';
import { makeBackup, rotateBackups } from './backups.js';
import { errorText, SOFT_CODES } from './errors.js';
import { MERGE_COLLECTIONS } from '../core/merge.js';
import { countLabel } from '../core/plural.js';
import { SCHEMA_VERSION } from '../version.js';
import { TOMBSTONE_TTL_DAYS } from '../config.js';

export const drive = createDrive();
const POLL_MS = 5 * 60000;
const CLOCK_SKEW_LIMIT_MS = 5 * 60000;
const CHANGES = ['изменение', 'изменения', 'изменений'];
let busy = false;

// ---------- Локальные данные ----------

function localData() {
  const d = store.data;
  const out = { settings: d.settings ? [d.settings] : [] };
  for (const c of MERGE_COLLECTIONS) if (c !== 'settings') out[c] = [...d[c].values()];
  return out;
}

async function dbFile(data) {
  const repo = getRepo();
  const extras = (await repo.getMeta('db.extras')) || {};
  const createdAt = await repo.getMeta('db.createdAt');
  const db = buildDb(data, {
    createdAt, deviceId: store.deviceId,
    extraEnvelope: extras.extraEnvelope, extraCollections: extras.extraCollections,
  });
  return { db, bytes: await gzipJson(db) };
}

const step = (text) => setSync({ step: text });

/** Слить удалённую базу в локальную. revId — ревизия, с которой теперь совпадаем (null — не менять). */
async function mergeIntoLocal(db, revId) {
  const repo = getRepo();
  const base = await repo.loadBase();
  // Снимок, слияние и применение в памяти — синхронно, без await: правки пользователя не вклинятся.
  const local = localData();
  const res = mergeRemote({ local, remote: db.data, base });
  for (const { coll, entity } of res.changes) syncHooks.setEntity(coll, entity);
  syncHooks.observeStamp(res.maxRemoteStamp);
  const meta = { 'db.createdAt': db.createdAt, 'db.extras': extrasOf(db), 'clock.lastStamp': syncHooks.clockLast() };
  if (revId) meta['sync.lastRevisionId'] = revId;
  const written = repo.applySync({
    puts: res.changes.map((c) => [c.coll, c.entity]),
    dirtyAdd: res.dirtyAdd,
    dirtyRemove: res.dirtyRemove,
    base: res.baseNext,
    conflicts: res.conflicts,
    meta,
  });
  if (res.changes.length) {
    bumpData();
    if (res.changes.some((c) => c.coll === 'settings')) refreshNow();
  }
  await written;
  if (revId) store.sync.lastRevisionId = revId;
  if (res.changes.length) syncHooks.broadcast(res.changes.map((c) => [c.coll, c.entity.id]));
  await refreshDirty();
  if (store.ui.readOnlySource === 'remote') setUi({ readOnly: null, readOnlySource: null });
  return res;
}

async function readRemote(dbId) {
  const fakeNewerSchema = !!(await getRepo().getMeta('debug.fakeNewerSchema'));
  return parseDbBytes(await drive.download(dbId), { fakeNewerSchema });
}

/** После записи базы: снять «непушнутые», которые ушли на Диск, обновить base. */
async function finishWrite(snapshot, newRev) {
  const repo = getRepo();
  const keys = await repo.dirtyKeys();
  const remove = pushedKeys(keys, snapshot, (c, id) => syncHooks.getEntity(c, id));
  const now = new Date().toISOString();
  await repo.applySync({
    dirtyRemove: remove,
    base: baseFrom(snapshot),
    meta: { 'sync.lastRevisionId': newRev, 'sync.lastPushAt': now },
  });
  setSync({ lastRevisionId: newRev, lastPushAt: now, remoteNewer: false });
  await refreshDirty();
}

/** Надгробия старше 365 дней удаляются перед записью (DATA_FORMAT §5.0). */
async function purgeOldTombstones() {
  const limit = Date.now() - TOMBSTONE_TTL_DAYS * 86400000;
  const dels = [];
  for (const c of ['lists', 'tasks', 'media', 'devices', 'priorities', 'rewards', 'coinEvents']) {
    for (const e of store.data[c].values()) if (e.deletedAt && Date.parse(e.deletedAt) < limit) dels.push([c, e.id]);
  }
  if (!dels.length) return;
  for (const [c, id] of dels) syncHooks.deleteEntity(c, id);
  bumpData();
  await getRepo().applySync({ deletes: dels, dirtyRemove: dels.map(([c, id]) => `${c}/${id}`) });
}

function checkClock(serverIso) {
  const server = Date.parse(serverIso);
  if (!Number.isFinite(server)) return;
  const skew = Date.now() - server;
  setSync({ clockSkewMin: Math.abs(skew) > CLOCK_SKEW_LIMIT_MS ? Math.round(skew / 60000) : 0 });
}

function reportConflicts(res) {
  const n = res?.conflicts?.length || 0;
  if (n) setUi({ conflictsNew: (store.ui.conflictsNew || 0) + n });
}

/** Найти или создать папку на Диске. Если база создана из локальных данных — это уже пуш. */
async function ensure() {
  const repo = getRepo();
  let createdSnapshot = null;
  const r = await ensureLayout(drive, {
    cached: store.sync.layout,
    makeDbBytes: async () => {
      createdSnapshot = localData();
      const { db, bytes } = await dbFile(createdSnapshot);
      await repo.setMeta('db.createdAt', db.createdAt);
      return bytes;
    },
    makeManifest: (layout) => buildManifest({ layout, deviceId: store.deviceId }),
  });
  if (JSON.stringify(r.layout) !== JSON.stringify(store.sync.layout)) {
    await repo.setMeta('sync.layout', r.layout);
    setSync({ layout: r.layout });
  }
  setSync({ extraRoots: (r.extraRoots || []).map((f) => ({ id: f.id, createdTime: f.createdTime })) });
  if (r.created && createdSnapshot) await finishWrite(createdSnapshot, r.dbMeta.headRevisionId);
  return r;
}

// ---------- Запуск операций ----------

async function run(kind, fn, { silent = false } = {}) {
  if (busy) {
    if (!silent) showSnackbar('Синхронизация уже идёт');
    return false;
  }
  if (kind === 'push' && store.ui.readOnly) {
    showSnackbar('Только чтение: сначала обнови приложение');
    return false;
  }
  if (!navigator.onLine) {
    setSync({ offline: true });
    if (!silent) showSnackbar(errorText({ code: 'E-OFFLINE' }));
    return false;
  }
  if (!tokenValid()) {
    if (!silent) await startLogin({ action: kind });
    else notify();
    return false;
  }
  const exec = async () => {
    busy = true;
    setSync({ phase: kind, step: 'Проверка Диска', lastError: null, offline: false });
    try {
      await fn();
      return true;
    } catch (e) {
      await handleError(e, kind, silent);
      return false;
    } finally {
      busy = false;
      setSync({ phase: null, step: null });
    }
  };
  if (navigator.locks?.request) {
    return navigator.locks.request('lifetasks-sync', { ifAvailable: true }, async (lock) => {
      if (!lock) {
        if (!silent) showSnackbar('Синхронизация идёт в другой вкладке');
        return false;
      }
      return exec();
    });
  }
  return exec();
}

async function handleError(e, kind, silent) {
  const code = e?.code || 'E-INTERNAL';
  if (code === 'E-OFFLINE') {
    setSync({ offline: true });
    if (!silent) showSnackbar(errorText(e));
    return;
  }
  if (code === 'E-AUTH-EXPIRED') {
    if (store.auth) {
      store.auth = { ...store.auth, expiresAt: 0 };
      await getRepo().setMeta('auth', store.auth);
    }
    notify();
    if (kind === 'push' && !silent) {
      showSnackbar('Сессия Google истекла — вхожу заново…');
      setTimeout(() => startLogin({ action: 'push' }), 1000);
    }
    return;
  }
  if (code === 'E-READONLY' || code === 'E-MIGRATION') {
    setUi({
      readOnlySource: 'remote',
      readOnly: code === 'E-READONLY'
        ? `Данные на Диске записаны более новой версией приложения (формат v${e.remoteVersion}, у тебя v${SCHEMA_VERSION}). Обнови приложение — до этого правки и пуш недоступны.`
        : errorText(e),
    });
    return;
  }
  const text = errorText(e);
  setSync({ lastError: { code, text, at: new Date().toISOString() } });
  getRepo()?.logError({ at: new Date().toISOString(), code, message: String(e?.message || e), stack: e?.stack || null });
  console.error(e);
  if (code === 'E-DB-MISSING') {
    offerRecreate();
    return;
  }
  if (!silent || !SOFT_CODES.has(code)) showSnackbar(text);
}

async function offerRecreate() {
  const v = await ask({
    title: 'Файл базы на Диске не найден',
    text: 'Его удалили или переместили в корзину Google Диска. Можно восстановить его из корзины Диска и нажать «Обновить» — '
      + 'или создать базу заново из данных этого устройства.',
    buttons: [{ label: 'Отмена', value: null }, { label: 'Создать заново', value: 'yes', kind: 'primary' }],
  });
  if (v !== 'yes') return;
  await run('push', async () => {
    let snap = null;
    const r = await recreateDb(drive, {
      makeDbBytes: async () => {
        snap = localData();
        const { db, bytes } = await dbFile(snap);
        await getRepo().setMeta('db.createdAt', db.createdAt);
        return bytes;
      },
      makeManifest: (layout) => buildManifest({ layout, deviceId: store.deviceId }),
    });
    await getRepo().setMeta('sync.layout', r.layout);
    setSync({ layout: r.layout, lastError: null });
    await finishWrite(snap, r.dbMeta.headRevisionId);
    showSnackbar('База на Диске создана заново');
  });
}

// ---------- Пуш и забор ----------

/** «Пуш» (docs/TZ.md §9.3). */
export function push() {
  return run('push', async () => {
    const before = store.ui.dirtyCount;
    const r = await ensure();
    if (r.created) {
      showSnackbar('На Диске создана папка LifeTasks, данные отправлены');
      return;
    }
    let expected = store.sync.lastRevisionId;
    let migratedFrom = null;
    if (r.dbMeta.headRevisionId !== expected) {
      step('Слияние с Диском');
      const parsed = await readRemote(r.layout.dbId);
      migratedFrom = parsed.migratedFrom;
      reportConflicts(await mergeIntoLocal(parsed.db, r.dbMeta.headRevisionId));
      expected = r.dbMeta.headRevisionId;
    }
    if (!migratedFrom && store.ui.dirtyCount === 0) {
      setSync({ remoteNewer: false });
      showSnackbar('Нечего пушить — всё уже на Диске');
      return;
    }
    step('Бэкап');
    await makeBackup(drive, r.layout, migratedFrom ? `pre-migration-v${SCHEMA_VERSION}` : 'push', store.deviceId);
    try {
      await rotateBackups(drive, r.layout);
    } catch (e) {
      console.warn('Ротация бэкапов не удалась — повторится при следующем пуше', e);
    }
    await purgeOldTombstones();
    const pushedAt = new Date().toISOString();
    await markDevicePushed(pushedAt);
    step('Запись базы');
    const { meta, snapshot, verified } = await writeDbChecked({
      drive,
      dbId: r.layout.dbId,
      expectedPrevRev: expected,
      makeBytes: async () => {
        const data = localData();
        const { bytes } = await dbFile(data);
        return { bytes, snapshot: data };
      },
      onForeign: async (bytes) => {
        step('Слияние с параллельной записью');
        const parsed = await parseDbBytes(bytes);
        reportConflicts(await mergeIntoLocal(parsed.db, null));
        step('Запись базы');
      },
    });
    if (!verified) console.info('LifeTasks: проверка параллельной записи пропущена (ревизия не найдена в списке)');
    checkClock(meta.modifiedTime);
    step('Манифест');
    try {
      await drive.updateContent(r.layout.manifestId, buildManifest({
        layout: r.layout,
        deviceId: store.deviceId,
        createdAt: await getRepo().getMeta('db.createdAt'),
        lastPush: { at: pushedAt, deviceId: store.deviceId, dbRevisionId: meta.headRevisionId },
      }), 'application/json');
    } catch (e) {
      console.warn('manifest.json не обновлён — не критично', e);
    }
    await finishWrite(snapshot, meta.headRevisionId);
    showSnackbar(before ? `Запушено: ${countLabel(before, CHANGES)}` : 'Запушено (формат данных обновлён)');
  });
}

/** «Обновить» — забрать данные с Диска и слить с локальными (docs/TZ.md §9.4). */
export function pull({ silent = false } = {}) {
  return run('pull', async () => {
    const r = await ensure();
    if (r.created) {
      showSnackbar('На Диске создана папка LifeTasks, данные отправлены');
      return;
    }
    const now = new Date().toISOString();
    if (r.dbMeta.headRevisionId !== store.sync.lastRevisionId) {
      step('Загрузка базы');
      const parsed = await readRemote(r.layout.dbId);
      step('Слияние');
      const res = await mergeIntoLocal(parsed.db, r.dbMeta.headRevisionId);
      reportConflicts(res);
      const n = res.changes.length;
      if (n || !silent) showSnackbar(n ? `Обновлено с Диска: ${countLabel(n, CHANGES)}` : 'Уже актуально');
    } else if (!silent) {
      showSnackbar('Уже актуально');
    }
    await getRepo().setMeta('sync.lastPullAt', now);
    setSync({ lastPullAt: now, remoteNewer: false });
  }, { silent });
}

// ---------- «На Диске есть версия новее» ----------

export async function checkRemote() {
  if (busy || !tokenValid() || !navigator.onLine || !store.sync.layout || document.visibilityState !== 'visible') return;
  try {
    const m = await drive.getMeta(store.sync.layout.dbId, 'headRevisionId,trashed');
    setSync({ remoteNewer: !!m.headRevisionId && m.headRevisionId !== store.sync.lastRevisionId, offline: false });
  } catch (e) {
    if (e.code === 'E-OFFLINE') setSync({ offline: true });
    else if (e.code === 'E-AUTH-EXPIRED' && store.auth) {
      store.auth = { ...store.auth, expiresAt: 0 };
      notify();
    }
  }
}

// ---------- Запуск приложения ----------

async function checkAccount(email) {
  const repo = getRepo();
  if (!email) return true;
  const bound = await repo.getMeta('account.email');
  if (!bound || bound === email) {
    if (!bound) await repo.setMeta('account.email', email);
    return true;
  }
  const v = await ask({
    title: 'Другой аккаунт Google',
    text: `Ты вошёл как ${email}, а данные этого устройства связаны с ${bound}. `
      + `Если переключиться, данные устройства будут слиты с Диском ${email}.`,
    buttons: [
      { label: `Войти как ${bound}`, value: 'back' },
      { label: 'Переключиться', value: 'switch', kind: 'primary' },
    ],
  });
  if (v === 'switch') {
    await repo.setMeta('account.email', email);
    await repo.applySync({ base: new Map(), meta: { 'sync.layout': null, 'sync.lastRevisionId': null } });
    setSync({ layout: null, lastRevisionId: null });
    return true;
  }
  await startLogin({ action: 'pull', selectAccount: true });
  return false;
}

/**
 * Вызывается при запуске после отрисовки (docs/TZ.md §8.2).
 * oauth — ответ Google из адреса; navigate(route) — вернуть пользователя на экран, с которого он уходил.
 */
export async function startSync(oauth, { navigate }) {
  const repo = getRepo();
  window.addEventListener('online', () => {
    setSync({ offline: false });
    checkRemote();
  });
  window.addEventListener('offline', () => setSync({ offline: true }));
  setInterval(checkRemote, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkRemote();
  });

  if (oauth) {
    setSync({ phase: 'pull', step: 'Вход в Google' });
    let r;
    try {
      r = await completeLogin(oauth);
    } finally {
      setSync({ phase: null, step: null });
    }
    navigate(r.returnRoute || '/today');
    if (!r.ok) {
      // Ошибка входа — не «ошибка синхронизации»: индикатор показывает «Нужен вход», текст — в панели и на стартовом экране.
      const text = errorText(r);
      setSync({ authError: { code: r.code, text, at: new Date().toISOString() } });
      showSnackbar(text);
      if (!store.sync.everLoggedIn) setUi({ start: true });
      return;
    }
    setSync({ everLoggedIn: true, lastError: null, authError: null });
    setUi({ start: false });
    if (!(await checkAccount(r.email))) return;
    if (r.action === 'push') await push();
    else await pull();
    return;
  }
  if (tokenValid()) {
    await pull({ silent: true });
    return;
  }
  if (!navigator.onLine) return;
  if (((await repo.getMeta('auth.blockedUntil')) || 0) > Date.now()) return;
  if (!store.sync.everLoggedIn) {
    if (!(await repo.getMeta('start.dismissed'))) setUi({ start: true });
    return;
  }
  await startLogin({ action: 'pull' });
}

// ---------- Режим отладки ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Спайк из ROADMAP (этап 2): создаёт ли Диск отдельную ревизию на каждую загрузку бинарного файла.
 * Создаёт LifeTasks/revision-test.bin, перезаписывает 3 раза (с паузой и без), смотрит ревизии, отправляет файл в корзину.
 */
export async function revisionSpike() {
  if (!tokenValid() || !store.sync.layout) throw new Error('Сначала войди и сделай «Обновить»');
  const mime = 'application/octet-stream';
  const f = await drive.createFile({ name: 'revision-test.bin', parentId: store.sync.layout.rootId, mimeType: mime, appProperties: { lifetasks: 'debug' } }, new Uint8Array([1]));
  await sleep(1500);
  const u1 = await drive.updateContent(f.id, new Uint8Array([2]), mime);
  await sleep(1500);
  const u2 = await drive.updateContent(f.id, new Uint8Array([3]), mime);
  const u3 = await drive.updateContent(f.id, new Uint8Array([4]), mime); // сразу, без паузы
  const revs = await drive.listRevisions(f.id);
  await drive.trash(f.id);
  const ids = revs.map((r) => r.id);
  const heads = [f.headRevisionId, u1.headRevisionId, u2.headRevisionId, u3.headRevisionId];
  const distinct = new Set(heads).size === 4;
  const allListed = heads.every((h) => ids.includes(h));
  const ordered = allListed && heads.every((h, i) => i === 0 || ids.indexOf(h) === ids.indexOf(heads[i - 1]) + 1);
  return { ok: distinct && allListed && ordered, count: revs.length, distinct, allListed, ordered };
}
