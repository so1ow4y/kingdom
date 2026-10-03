// Миграция формата 2 → 3 (обновление 0.5, DATA_FORMAT §13.5): вложения в заметках, doneArchive, настройки v3.

import { test, assert } from './runner.js';
import { validate } from './jsonschema-lite.js';
import m from '../src/data/migrations/m002_to_003.js';
import { migrateDb } from '../src/data/migrations/index.js';
import { mergeData } from '../src/core/merge.js';
import { canonicalJson } from '../src/core/canonical.js';
import { uuidFromString } from '../src/core/ids.js';

const load = async (p) => (await fetch(new URL(p, import.meta.url))).json();
const v1 = await load('../samples/v1/db.json');
const v2 = await load('../samples/v2/db.json');
const v3Schema = await load('../schemas/v3/db.schema.json');
const T1 = '01926f40-1a2b-7c3d-8e4f-5a6b7c8d9e0f'; // в v1 у неё вложение на уровне задачи

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
  for (const [k, v] of Object.entries(x)) leaves(v, path ? `${path}.${k}` : k, out);
  return out;
}

test('2→3: образец v2 после миграции проходит schemas/v3', () => {
  const errs = validate(v3Schema, migrateDb(structuredClone(v2)));
  assert.ok(!errs.length, errs.slice(0, 8).join('\n'));
});

test('2→3: v1 → v2 → v3 цепочкой проходит schemas/v3', () => {
  const errs = validate(v3Schema, migrateDb(structuredClone(v1)));
  assert.ok(!errs.length, errs.slice(0, 8).join('\n'));
});

test('2→3: чистая и детерминированная; слияние двух миграций ничего не меняет', () => {
  const before = canonicalJson(v2);
  const a = m.migrate(structuredClone(v2));
  const b = m.migrate(structuredClone(v2));
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(canonicalJson(v2), before, 'вход не изменён');
  assert.equal(canonicalJson(mergeData(a.data, b.data).tasks), canonicalJson(a.data.tasks));
});

test('2→3: инвентарь — все строки и числа входа есть в выходе', () => {
  const src = migrateDb(structuredClone(v1), undefined, 2);
  const out = new Set(leaves(m.migrate(structuredClone(src))).map(([, v]) => v));
  const lost = leaves(src).filter(([, v]) => v !== '' && !out.has(v));
  assert.deepEqual(lost, []);
});

test('2→3: вложения задачи переезжают в заметку без текста; надгробия вложений остаются', () => {
  const db = migrateDb(structuredClone(v1));
  const t = db.data.tasks.find((x) => x.id === T1);
  const note = t.notes.find((n) => n.id === uuidFromString(`${T1}:attachments`));
  assert.ok(note, 'заметка с вложениями создана');
  assert.equal(note.text, '');
  assert.equal(note.attachments.length, 1);
  assert.ok(note.attachments[0].mediaId.startsWith('9f86d081'));
  assert.ok(note.order > t.notes.filter((n) => n.id !== note.id).map((n) => n.order).sort().at(-1), 'в конце заметок');
  assert.equal(t.attachments.filter((a) => !a.deletedAt).length, 0);
});

test('2→3: настройки v3 с меткой 1, пустой doneArchive, неизвестные поля на месте', () => {
  const db = m.migrate(structuredClone(v2));
  const s = db.data.settings[0];
  assert.equal(s.completedLimit, 1000);
  assert.equal(s.voiceMaxSeconds, 600);
  assert.equal(s.attachmentMaxMB, 100);
  assert.deepEqual(s.nagPresets, [1, 5, 10, 15, 30, 60]);
  assert.equal(s.fieldTimes.completedLimit, 1);
  assert.deepEqual(db.data.doneArchive, []);
  assert.equal(db.schemaVersion, 3);
  if (v2.x_futureEnvelope !== undefined) assert.equal(db.x_futureEnvelope, v2.x_futureEnvelope);
});
