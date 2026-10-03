// Миграция формата 1 → 2 на samples/v1/db.json (DATA_FORMAT §12.4).

import { test, assert } from './runner.js';
import { validate } from './jsonschema-lite.js';
import m from '../src/data/migrations/m001_to_002.js';
import { migrateDb } from '../src/data/migrations/index.js';
import { mergeData } from '../src/core/merge.js';
import { canonicalJson } from '../src/core/canonical.js';
import { uuidFromString } from '../src/core/ids.js';

const load = async (p) => (await fetch(new URL(p, import.meta.url))).json();
const v1 = await load('../samples/v1/db.json');
const v2Schema = await load('../schemas/v2/db.schema.json');
const migrated = () => migrateDb(structuredClone(v1), undefined, 2); // только шаг 1→2

const HIGH = '00000000-0000-7000-8000-000000000203';
const MID = '00000000-0000-7000-8000-000000000202';
const NONE = '00000000-0000-7000-8000-000000000200';
const T1 = '01926f40-1a2b-7c3d-8e4f-5a6b7c8d9e0f'; // повтор, заметка, «Пересдача», высокий, подзадачи
const T2 = '01926f60-0000-7000-8000-000000000001'; // «Купить батарейки», без заметки и списка
const T3 = '01926f60-0000-7000-8000-000000000002'; // выполнена, «Универ», средний

/** Все строки и числа (значения и ключи объектов) с путями: [path, value]. */
function leaves(x, path = '', out = []) {
  if (x === null || x === undefined || typeof x === 'boolean') return out;
  if (typeof x !== 'object') {
    out.push([path, x]);
    return out;
  }
  if (Array.isArray(x)) {
    x.forEach((v) => leaves(v, path + '[]', out));
    return out;
  }
  for (const [k, v] of Object.entries(x)) {
    out.push([path + '{key}', k]);
    leaves(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

test('1→2: результат проходит schemas/v2/db.schema.json', () => {
  const errs = validate(v2Schema, migrated());
  assert.ok(!errs.length, errs.slice(0, 8).join('\n'));
});

test('1→2: чистая и детерминированная (два устройства получают одно и то же)', () => {
  const before = canonicalJson(v1);
  const a = m.migrate(structuredClone(v1));
  const b = m.migrate(structuredClone(v1));
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(canonicalJson(v1), before, 'вход не изменён');
  const merged = mergeData(a.data, b.data);
  assert.equal(canonicalJson(merged.tasks), canonicalJson(a.data.tasks), 'слияние двух миграций ничего не меняет');
});

test('1→2: инвентарь — все строки и числа входа есть в выходе (кроме allowedLosses)', () => {
  const outValues = new Set(leaves(migrated()).map(([, v]) => v));
  // Имена полей входа (ключи объектов) — это схема, а не данные: их переименование потерей не считается.
  const lost = leaves(v1)
    .filter(([p, v]) => !p.endsWith('{key}') && v !== '') // пустая строка не несёт данных (пустая заметка не создаётся)
    .filter(([p]) => !m.allowedLosses.some((a) => a.path.test(p)))
    .filter(([, v]) => !outValues.has(v));
  assert.deepEqual(lost, []);
});

test('1→2: note → notes, listId → lists, priority → priorityId', () => {
  const db = migrated();
  const t1 = db.data.tasks.find((t) => t.id === T1);
  assert.equal(t1.notes.length, 1);
  assert.equal(t1.notes[0].text, 'Лекции 3–5, особенно интегрирование по частям');
  assert.equal(t1.notes[0].id, uuidFromString(`${T1}:note`));
  assert.deepEqual(Object.keys(t1.lists), ['00000000-0000-7000-8000-000000000101']);
  assert.equal(t1.lists['00000000-0000-7000-8000-000000000101'].in, true);
  assert.equal(t1.priorityId, HIGH);
  assert.ok(!('note' in t1) && !('listId' in t1) && !('priority' in t1) && !('subtasks' in t1));
  assert.ok(!('note' in t1.fieldTimes) && 'priorityId' in t1.fieldTimes && 'parentId' in t1.fieldTimes);
  const t2 = db.data.tasks.find((t) => t.id === T2);
  assert.deepEqual(t2.notes, [], 'пустая заметка не создаётся');
  assert.deepEqual(t2.lists, {});
  assert.equal(t2.priorityId, NONE);
});

test('1→2: подзадачи-чеклист → дочерние задачи (id сохранены, надгробие → надгробие)', () => {
  const db = migrated();
  const kids = db.data.tasks.filter((t) => t.parentId === T1);
  assert.equal(kids.length, 1);
  assert.equal(kids[0].id, '01926f40-2000-7000-8000-000000000001');
  assert.equal(kids[0].title, 'Лекция 3');
  assert.equal(kids[0].status, 'active');
  const tomb = db.data.tasks.find((t) => t.id === '01926f40-2000-7000-8000-000000000002');
  assert.ok(tomb && tomb.deletedAt && !tomb.title);
});

test('1→2: начисления за уже выполненное — задача и экземпляр повтора, по базовым приоритетам', () => {
  const db = migrated();
  const ev = Object.fromEntries(db.data.coinEvents.map((e) => [e.id, e]));
  assert.equal(Object.keys(ev).length, 2);
  assert.equal(ev[`a:${T3}`].amount, 5);
  assert.equal(ev[`a:${T1}:2026-09-29`].amount, 10);
  assert.ok(!ev[`a:${T1}:2026-10-01`], 'пропущенный экземпляр монет не даёт');
  assert.equal(db.data.priorities.length, 5);
  assert.equal(db.data.priorities.find((p) => p.id === MID).coins, 5);
  assert.deepEqual(db.data.rewards, []);
});

test('1→2: неизвестные поля на месте; настройки v2 добавлены с меткой 1', () => {
  const db = migrated();
  assert.equal(db.x_futureEnvelope, v1.x_futureEnvelope);
  assert.deepEqual(db.data.x_futureCollection, v1.data.x_futureCollection);
  assert.deepEqual(db.data.tasks.find((t) => t.id === T1).x_future, v1.data.tasks[0].x_future);
  const s = db.data.settings[0];
  assert.equal(s.gameEnabled, true);
  assert.equal(s.dayReminderTime, '09:00');
  assert.equal(s.fieldTimes.gameEnabled, 1);
  assert.equal(s.timeZone, 'Europe/Moscow');
});
