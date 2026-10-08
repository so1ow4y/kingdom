// Протокол синхронизации на поддельном Диске: два «устройства» в памяти пушат и забирают по правилам TZ §9.3.

import { test, assert } from './runner.js';
import { createFakeDrive } from './fakeDrive.js';
import { createClock } from '../src/core/clock.js';
import { newTask, touch, tombstone, defaultLists, defaultSettings } from '../src/core/model.js';
import { buildDb, buildManifest } from '../src/data/envelope.js';
import { gzipJson } from '../src/data/serialize.js';
import { ensureLayout, recreateDb } from '../src/google/layout.js';
import { parseDbBytes, mergeRemote, writeDbChecked, pushedKeys, baseFrom } from '../src/sync/protocol.js';
import { makeBackup, rotateBackups } from '../src/sync/backups.js';
import { MERGE_COLLECTIONS } from '../src/core/merge.js';
import { canonicalJson } from '../src/core/canonical.js';
import { SCHEMA_VERSION } from '../src/version.js';

let now = Date.parse('2026-10-02T09:00:00.000Z');

function device(id, tz) {
  const clock = createClock(0, () => now);
  const d = {
    id,
    clock,
    data: { settings: new Map(), lists: new Map(), tasks: new Map(), media: new Map(), devices: new Map(), priorities: new Map(), coinEvents: new Map(), rewards: new Map(), doneArchive: new Map() },
    base: new Map(),
    dirty: new Set(),
    lastRev: null,
    layout: null,
    conflicts: [],
    ctx: () => ({ now: (now += 1000), stamp: () => clock.stamp(), deviceId: id }),
  };
  const s = defaultSettings(tz);
  d.data.settings.set(s.id, s);
  for (const l of defaultLists()) d.data.lists.set(l.id, l);
  return d;
}

const arrays = (d) => Object.fromEntries(MERGE_COLLECTIONS.map((c) => [c, [...d.data[c].values()]]));
const getE = (d) => (c, id) => (c === 'settings' ? [...d.data.settings.values()][0] : d.data[c].get(id));

function put(d, coll, e) {
  d.data[coll].set(e.id, e);
  d.dirty.add(`${coll}/${e.id}`);
  return e;
}

function applyMerge(d, db, revId) {
  const res = mergeRemote({ local: arrays(d), remote: db.data, base: d.base });
  for (const { coll, entity } of res.changes) d.data[coll].set(entity.id, entity);
  for (const k of res.dirtyAdd) d.dirty.add(k);
  for (const k of res.dirtyRemove) d.dirty.delete(k);
  d.base = res.baseNext;
  d.conflicts.push(...res.conflicts);
  d.clock.observe(res.maxRemoteStamp, now + 1e9);
  if (revId) d.lastRev = revId;
  return res;
}

async function bytesOf(d, data) {
  return gzipJson(buildDb(data, { deviceId: d.id }));
}

async function ensure(d, drive) {
  let snap = null;
  const r = await ensureLayout(drive, {
    cached: d.layout,
    makeDbBytes: async () => bytesOf(d, (snap = arrays(d))),
    makeManifest: (layout) => buildManifest({ layout, deviceId: d.id }),
  });
  d.layout = r.layout;
  if (r.created) finish(d, snap, r.dbMeta.headRevisionId);
  return r;
}

function finish(d, snapshot, rev) {
  for (const k of pushedKeys([...d.dirty], snapshot, getE(d))) d.dirty.delete(k);
  d.base = baseFrom(snapshot);
  d.lastRev = rev;
}

async function pull(d, drive) {
  const r = await ensure(d, drive);
  if (r.created || r.dbMeta.headRevisionId === d.lastRev) return null;
  const { db } = await parseDbBytes(await drive.download(r.layout.dbId));
  return applyMerge(d, db, r.dbMeta.headRevisionId);
}

async function push(d, drive, { duringWrite } = {}) {
  const r = await ensure(d, drive);
  if (r.created) return;
  let expected = d.lastRev;
  if (r.dbMeta.headRevisionId !== expected) {
    const { db } = await parseDbBytes(await drive.download(r.layout.dbId));
    applyMerge(d, db, r.dbMeta.headRevisionId);
    expected = r.dbMeta.headRevisionId;
  }
  if (!d.dirty.size) return;
  await makeBackup(drive, r.layout, 'push', d.id);
  if (duringWrite) drive.beforeUpdate = duringWrite;
  const { meta, snapshot } = await writeDbChecked({
    drive, dbId: r.layout.dbId, expectedPrevRev: expected,
    makeBytes: async () => {
      const data = arrays(d);
      return { bytes: await bytesOf(d, data), snapshot: data };
    },
    onForeign: async (bytes) => applyMerge(d, (await parseDbBytes(bytes)).db, null),
  });
  finish(d, snapshot, meta.headRevisionId);
}

async function remoteDb(drive, d) {
  return (await parseDbBytes(await drive.download(d.layout.dbId))).db;
}

const title = (d, id) => d.data.tasks.get(id)?.title;

test('первый пуш создаёт папку Chronicle (в общей Kingdom) с media/, backups/, db.json.gz и manifest.json', async () => {
  const drive = createFakeDrive();
  const A = device('A', 'Europe/Moscow');
  put(A, 'tasks', newTask({ title: 'Билеты 1–5' }, A.ctx()));
  await push(A, drive);
  const names = [...drive.files.values()].map((f) => f.name).sort();
  assert.deepEqual(names, ['Chronicle', 'Kingdom', 'backups', 'db.json.gz', 'manifest.json', 'media']);
  assert.equal(A.dirty.size, 0, 'после создания всё запушено');
  const db = await remoteDb(drive, A);
  assert.equal(db.data.tasks.length, 1);
  assert.equal(db.data.lists.length, 5);
});

test('второе устройство находит папку и забирает данные; списки по умолчанию не дублируются', async () => {
  const drive = createFakeDrive();
  const A = device('A', 'Europe/Moscow');
  const t = put(A, 'tasks', newTask({ title: 'Сценарий' }, A.ctx()));
  await push(A, drive);
  const B = device('B', 'Europe/Samara');
  await pull(B, drive);
  assert.equal(title(B, t.id), 'Сценарий');
  assert.equal(B.data.lists.size, 5);
  assert.equal(B.layout.dbId, A.layout.dbId);
});

test('правки разных полей одной задачи на двух устройствах сохраняются обе (TZ §9.6, пример 1)', async () => {
  const drive = createFakeDrive();
  const A = device('A', 'Europe/Moscow');
  const t = put(A, 'tasks', newTask({ title: 'Билеты' }, A.ctx()));
  await push(A, drive);
  const B = device('B', 'Europe/Moscow');
  await pull(B, drive);
  put(A, 'tasks', touch(A.data.tasks.get(t.id), { note: 'с телефона' }, A.ctx()));
  put(B, 'tasks', touch(B.data.tasks.get(t.id), { deadlineDate: '2026-10-12' }, B.ctx()));
  await push(A, drive);
  await push(B, drive);
  await pull(A, drive);
  for (const d of [A, B]) {
    const x = d.data.tasks.get(t.id);
    assert.equal(x.note, 'с телефона', d.id);
    assert.equal(x.deadlineDate, '2026-10-12', d.id);
  }
  assert.equal(canonicalJson(A.data.tasks.get(t.id)), canonicalJson(B.data.tasks.get(t.id)), 'устройства сошлись');
  assert.equal(B.conflicts.length, 0, 'разные поля — не конфликт');
});

test('одно поле на двух устройствах: побеждает более поздняя правка, проигравшая — в журнале', async () => {
  const drive = createFakeDrive();
  const A = device('A', 'Europe/Moscow');
  const t = put(A, 'tasks', newTask({ title: 'Билеты' }, A.ctx()));
  await push(A, drive);
  const B = device('B', 'Europe/Moscow');
  await pull(B, drive);
  put(A, 'tasks', touch(A.data.tasks.get(t.id), { note: '1–10' }, A.ctx()));
  put(B, 'tasks', touch(B.data.tasks.get(t.id), { note: '1–7' }, B.ctx())); // позже
  await push(A, drive);
  await push(B, drive);
  assert.equal((await remoteDb(drive, B)).data.tasks[0].note, '1–7');
  assert.equal(B.conflicts.length, 1);
  assert.equal(B.conflicts[0].loserValue, '1–10');
});

test('гонка: чужая запись между чтением и записью — обе правки на Диске (шаг P10)', async () => {
  const drive = createFakeDrive();
  const A = device('A', 'Europe/Moscow');
  const t1 = put(A, 'tasks', newTask({ title: 'Первая' }, A.ctx()));
  await push(A, drive);
  const B = device('B', 'Europe/Moscow');
  await pull(B, drive);
  const tB = put(B, 'tasks', newTask({ title: 'От B' }, B.ctx()));
  const tA = put(A, 'tasks', newTask({ title: 'От A' }, A.ctx()));
  // A прочитал Диск, а B успел записать прямо перед записью A.
  await push(A, drive, { duringWrite: async () => push(B, drive) });
  const db = await remoteDb(drive, A);
  const titles = db.data.tasks.map((x) => x.title).sort();
  assert.deepEqual(titles, ['Первая', 'От A', 'От B'].sort());
  assert.equal(title(A, tB.id), 'От B', 'A слил чужую ревизию к себе');
  assert.ok(A.data.tasks.has(t1.id) && A.data.tasks.has(tA.id));
  assert.equal(A.dirty.size, 0);
});

test('удалено навсегда на одном, изменено позже на другом → задача остаётся (пример 2b)', async () => {
  const drive = createFakeDrive();
  const A = device('A', 'Europe/Moscow');
  const t = put(A, 'tasks', newTask({ title: 'Задача' }, A.ctx()));
  await push(A, drive);
  const B = device('B', 'Europe/Moscow');
  await pull(B, drive);
  put(A, 'tasks', tombstone(A.data.tasks.get(t.id), A.ctx()));
  await push(A, drive);
  put(B, 'tasks', touch(B.data.tasks.get(t.id), { title: 'Изменена после' }, B.ctx()));
  await push(B, drive);
  const r = (await remoteDb(drive, B)).data.tasks.find((x) => x.id === t.id);
  assert.ok(!r.deletedAt, 'живая');
  assert.equal(r.title, 'Изменена после');
  assert.equal(B.conflicts.at(-1).kind, 'resurrected');
});

test('правка во время пуша остаётся непушнутой', async () => {
  const drive = createFakeDrive();
  const A = device('A', 'Europe/Moscow');
  const t = put(A, 'tasks', newTask({ title: 'A' }, A.ctx()));
  await push(A, drive);
  put(A, 'tasks', touch(A.data.tasks.get(t.id), { title: 'B' }, A.ctx()));
  const snapshot = arrays(A);
  put(A, 'tasks', touch(A.data.tasks.get(t.id), { title: 'C' }, A.ctx())); // после снимка
  assert.deepEqual(pushedKeys([...A.dirty], snapshot, getE(A)), []);
  assert.deepEqual(pushedKeys([...A.dirty], arrays(A), getE(A)), [`tasks/${t.id}`]);
});

test('база на Диске новее приложения → E-READONLY, Диск не меняется', async () => {
  const drive = createFakeDrive();
  const A = device('A', 'Europe/Moscow');
  await push(A, drive);
  put(A, 'tasks', newTask({ title: 'x' }, A.ctx()));
  await push(A, drive);
  const db = await remoteDb(drive, A);
  await drive.updateContent(A.layout.dbId, await gzipJson({ ...db, schemaVersion: SCHEMA_VERSION + 1 }));
  const revBefore = (await drive.getMeta(A.layout.dbId)).headRevisionId;
  const B = device('B', 'Europe/Moscow');
  put(B, 'tasks', newTask({ title: 'y' }, B.ctx()));
  let code = null;
  try {
    await push(B, drive);
  } catch (e) {
    code = e.code;
  }
  assert.equal(code, 'E-READONLY');
  assert.equal((await drive.getMeta(A.layout.dbId)).headRevisionId, revBefore);
});

test('папку с базой удалили руками → E-DB-MISSING; «Создать заново» восстанавливает из локальных данных', async () => {
  const drive = createFakeDrive();
  const A = device('A', 'Europe/Moscow');
  const t = put(A, 'tasks', newTask({ title: 'Важное' }, A.ctx()));
  await push(A, drive);
  await drive.trash(A.layout.dbId);
  let code = null;
  try {
    await pull(A, drive);
  } catch (e) {
    code = e.code;
  }
  assert.equal(code, 'E-DB-MISSING');
  const r = await recreateDb(drive, {
    makeDbBytes: async () => bytesOf(A, arrays(A)),
    makeManifest: (layout) => buildManifest({ layout, deviceId: 'A' }),
  });
  assert.equal(r.layout.rootId, A.layout.rootId, 'та же папка');
  const db = (await parseDbBytes(await drive.download(r.layout.dbId))).db;
  assert.equal(db.data.tasks.find((x) => x.id === t.id).title, 'Важное');
});

test('несколько папок LifeTasks → используется самая старая', async () => {
  const drive = createFakeDrive();
  const A = device('A', 'Europe/Moscow');
  await push(A, drive);
  await drive.createFolder('LifeTasks', null, { lifetasks: 'root' });
  const B = device('B', 'Europe/Moscow');
  const r = await ensure(B, drive);
  assert.equal(r.layout.rootId, A.layout.rootId);
  assert.equal(r.extraRoots.length, 1);
});

test('бэкапы: копия перед пушем, хранятся 20 последних, pre-migration не удаляются', async () => {
  const drive = createFakeDrive();
  const A = device('A', 'Europe/Moscow');
  await push(A, drive);
  await makeBackup(drive, A.layout, 'pre-migration-v1', 'A');
  for (let i = 0; i < 23; i++) await makeBackup(drive, A.layout, 'push', 'A');
  const trashed = await rotateBackups(drive, A.layout);
  assert.equal(trashed, 3);
  const left = await drive.findFiles(`'${A.layout.backupsFolderId}' in parents and trashed=false`);
  assert.equal(left.filter((f) => f.appProperties.backupKind === 'push').length, 20);
  assert.equal(left.filter((f) => f.appProperties.backupKind === 'pre-migration-v1').length, 1);
});

test('неизвестные поля конверта, коллекций и сущностей переживают забор и пуш', async () => {
  const drive = createFakeDrive();
  const A = device('A', 'Europe/Moscow');
  const t = put(A, 'tasks', { ...newTask({ title: 'X' }, A.ctx()), x_future: { k: 1 } });
  await push(A, drive);
  const B = device('B', 'Europe/Moscow');
  await pull(B, drive);
  assert.deepEqual(B.data.tasks.get(t.id).x_future, { k: 1 });
  put(B, 'tasks', touch(B.data.tasks.get(t.id), { title: 'Y' }, B.ctx()));
  await push(B, drive);
  const r = (await remoteDb(drive, B)).data.tasks.find((x) => x.id === t.id);
  assert.deepEqual(r.x_future, { k: 1 });
  assert.equal(r.title, 'Y');
});
