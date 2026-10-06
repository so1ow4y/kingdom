// Формат данных: образцы и схемы, сборка базы приложением, gzip, миграции (docs/DATA_FORMAT.md §8.4).

import { test, assert } from './runner.js';
import { validate } from './jsonschema-lite.js';
import { makeCtx } from './helpers.js';
import { buildDb, buildManifest, checkDb, extrasOf } from '../src/data/envelope.js';
import { gzipJson, gunzipJson } from '../src/data/serialize.js';
import { validateDb } from '../src/data/validate.js';
import { migrateDb } from '../src/data/migrations/index.js';
import { parseDbBytes } from '../src/sync/protocol.js';
import { newTask, newList, newDevice, newReward, defaultLists, defaultSettings, defaultPriorities, tombstone, touch, addFocusSession } from '../src/core/model.js';
import { purchaseEvent, focusEvent } from '../src/core/game.js';
import { canonicalJson } from '../src/core/canonical.js';
import { SCHEMA_VERSION } from '../src/version.js';

const load = async (p) => (await fetch(new URL(p, import.meta.url))).json();
const dbSchema = await load('../schemas/v1/db.schema.json');
const dbSchemaV2 = await load('../schemas/v2/db.schema.json');
const dbSchemaV3 = await load('../schemas/v3/db.schema.json');
const manifestSchema = await load('../schemas/v1/manifest.schema.json');
const sampleDb = await load('../samples/v1/db.json');
const sampleManifest = await load('../samples/v1/manifest.json');

function assertValid(schema, data, what) {
  const errs = validate(schema, data);
  assert.ok(errs.length === 0, `${what} не проходит схему:\n${errs.slice(0, 10).join('\n')}`);
}

test('samples/v1/db.json проходит schemas/v1/db.schema.json', () => assertValid(dbSchema, sampleDb, 'образец базы'));
test('samples/v1/manifest.json проходит schemas/v1/manifest.schema.json', () => assertValid(manifestSchema, sampleManifest, 'образец манифеста'));

test('схема ловит ошибки (проверка самого валидатора)', () => {
  const bad = structuredClone(sampleDb);
  bad.data.tasks[1].priority = 7;
  bad.data.tasks[1].scheduledDate = '2026-13-01';
  delete bad.data.lists[0].name;
  const errs = validate(dbSchema, bad);
  assert.ok(errs.some((e) => e.includes('priority')), 'priority');
  assert.ok(errs.some((e) => e.includes('scheduledDate')), 'scheduledDate');
  assert.ok(errs.some((e) => e.includes('name')), 'name');
});

function appData() {
  const c = makeCtx();
  const deviceId = c.deviceId;
  const l = newList({ name: 'Спорт', color: '#43A047', emoji: '💪', order: 'a5' }, c);
  const t1 = addFocusSession(newTask({ title: 'Бег', listIds: [l.id], scheduledDate: '2026-10-03', scheduledTime: '07:30', priorityId: '00000000-0000-7000-8000-000000000202', notes: ['Кроссовки взять'], order: 'a0' }, c),
    { startedAt: '2026-10-03T07:30:00.000Z', minutes: 25 }, c); // 0.7.1: фокус-сессия в задаче
  const t4 = newTask({ title: 'Разминка', parentId: t1.id, order: 'a0' }, c);
  const t2 = touch(newTask({ title: 'Главная', order: 'Zz' }, c), { focusDate: '2026-10-02', focusOrder: 'a0', status: 'done', completedAt: new Date(c.now).toISOString() }, c);
  const t3 = tombstone(newTask({ title: 'Удалить' }, c), c);
  return {
    deviceId,
    data: {
      settings: [defaultSettings('Europe/Moscow')],
      lists: [...defaultLists(), l],
      tasks: [t1, t2, t3, t4],
      priorities: defaultPriorities(),
      rewards: [newReward({ name: 'Пицца', emoji: '🍕', price: 300, repeatable: true, order: 'a0' }, c)],
      coinEvents: [
        purchaseEvent({ price: 300, title: 'Пицца' }, c),
        purchaseEvent({ gems: 3, title: 'Смена дня и ночи', itemId: 'v:daynight' }, c), // 0.7: покупка за изумруды
        focusEvent({ coinEvents: new Map() }, { minutes: 25, taskId: t1.id, title: 'Бег' }, c), // 0.7: фокус-сессия
      ],
      media: [],
      devices: [newDevice({ id: deviceId, name: 'Комп', platform: 'windows-chrome', appVersion: '0.1.0' }, c)],
    },
  };
}

test('база, которую пишет приложение, проходит схему', () => {
  const { data, deviceId } = appData();
  assertValid(dbSchemaV3, buildDb(data, { deviceId }), 'база приложения');
});

test('манифест, который пишет приложение, проходит схему', () => {
  const layout = { rootId: 'r', dbId: 'd', mediaFolderId: 'm', backupsFolderId: 'b', manifestId: 'x' };
  assertValid(manifestSchema, JSON.parse(buildManifest({ layout, deviceId: 'dev' })), 'манифест');
  assertValid(manifestSchema, JSON.parse(buildManifest({ layout, deviceId: 'dev', lastPush: { at: new Date().toISOString(), deviceId: 'dev', dbRevisionId: 'rev' } })), 'манифест после пуша');
});

test('gzip: туда и обратно без потерь, сжатие заметное', async () => {
  const { data, deviceId } = appData();
  const db = buildDb(data, { deviceId });
  const bytes = await gzipJson(db);
  assert.equal(bytes[0], 0x1f, 'сигнатура gzip');
  assert.equal(bytes[1], 0x8b, 'сигнатура gzip');
  assert.ok(bytes.length < JSON.stringify(db).length / 2, `сжато до ${bytes.length} байт`);
  assert.equal(canonicalJson(await gunzipJson(bytes)), canonicalJson(db));
});

test('образец v1 → gzip → чтение: мигрирован до текущей версии, проходит её схему, неизвестные поля на месте', async () => {
  const { db, migratedFrom } = await parseDbBytes(await gzipJson(sampleDb));
  assert.equal(migratedFrom, 1);
  assert.equal(db.schemaVersion, SCHEMA_VERSION);
  assertValid(dbSchemaV3, db, 'мигрированный образец');
  const { extraEnvelope, extraCollections } = extrasOf(db);
  assert.equal(extraEnvelope.x_futureEnvelope, sampleDb.x_futureEnvelope);
  assert.deepEqual(extraCollections.x_futureCollection, sampleDb.data.x_futureCollection);
  const rebuilt = buildDb(db.data, { createdAt: db.createdAt, deviceId: 'dev', extraEnvelope, extraCollections });
  assert.deepEqual(rebuilt.data.lists, sampleDb.data.lists, 'списки не тронуты');
  assert.deepEqual(rebuilt.data.tasks.find((t) => t.x_future).x_future, sampleDb.data.tasks[0].x_future);
  assert.equal(rebuilt.x_futureEnvelope, sampleDb.x_futureEnvelope);
  assert.equal(rebuilt.createdAt, sampleDb.createdAt, 'createdAt файла не меняется');
});

test('повреждённые данные → E-DB-CORRUPT', async () => {
  const codes = [];
  for (const bytes of [new Uint8Array([1, 2, 3]), await gzipJson({ format: 'другое' }), await gzipJson({ format: 'lifetasks-db', schemaVersion: 1, data: { tasks: [{ title: 'без id' }] } })]) {
    try {
      await parseDbBytes(bytes);
      codes.push('ok');
    } catch (e) {
      codes.push(e.code);
    }
  }
  assert.deepEqual(codes, ['E-DB-CORRUPT', 'E-DB-CORRUPT', 'E-DB-CORRUPT']);
});

test('validateDb дополняет пустыми вложенными коллекциями (задача от бота без subtasks)', () => {
  const db = { format: 'lifetasks-db', schemaVersion: 2, data: { tasks: [{ id: 't', fieldTimes: {}, title: 'x' }] } };
  validateDb(checkDb(db));
  assert.deepEqual(db.data.tasks[0].notes, []);
  assert.deepEqual(db.data.tasks[0].lists, {});
  assert.deepEqual(db.data.lists, []);
});

test('миграции: текущая версия проходит как есть, новее — E-READONLY, нет шага — E-MIGRATION', () => {
  const db = { schemaVersion: SCHEMA_VERSION, data: {} };
  assert.equal(migrateDb(db), db);
  let code = null;
  try {
    migrateDb({ schemaVersion: SCHEMA_VERSION + 1, data: {} });
  } catch (e) {
    code = e.code;
  }
  assert.equal(code, 'E-READONLY');
  try {
    migrateDb({ schemaVersion: 1, data: {} }, [], 3);
  } catch (e) {
    code = e.code;
  }
  assert.equal(code, 'E-MIGRATION');
});

test('миграции: цепочка применяется по порядку и ставит schemaVersion', () => {
  const steps = [
    { from: 1, to: 2, migrate: (d) => ({ ...d, data: { ...d.data, log: [...(d.data.log || []), '1→2'] } }) },
    { from: 2, to: 3, migrate: (d) => ({ ...d, data: { ...d.data, log: [...d.data.log, '2→3'] } }) },
  ];
  const r = migrateDb({ schemaVersion: 1, data: {} }, steps, 3);
  assert.equal(r.schemaVersion, 3);
  assert.deepEqual(r.data.log, ['1→2', '2→3']);
});

const sampleDbV2 = await load('../samples/v2/db.json');
const sampleManifestV2 = await load('../samples/v2/manifest.json');
const manifestSchemaV2 = await load('../schemas/v2/manifest.schema.json');
test('samples/v2/*.json проходят schemas/v2/*', () => {
  assertValid(dbSchemaV2, sampleDbV2, 'образец базы v2');
  assertValid(manifestSchemaV2, sampleManifestV2, 'образец манифеста v2');
});

const sampleDbV3 = await load('../samples/v3/db.json');
const sampleManifestV3 = await load('../samples/v3/manifest.json');
const manifestSchemaV3 = await load('../schemas/v3/manifest.schema.json');
test('samples/v3/*.json проходят schemas/v3/*', () => {
  assertValid(dbSchemaV3, sampleDbV3, 'образец базы v3');
  assertValid(manifestSchemaV3, sampleManifestV3, 'образец манифеста v3');
});