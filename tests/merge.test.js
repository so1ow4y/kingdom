import { test, assert } from './runner.js';
import { mergeEntity, mergeData, detectConflicts, maxStamp } from '../src/core/merge.js';
import { canonicalJson } from '../src/core/canonical.js';

const vectors = await (await fetch(new URL('./vectors/merge/vectors.json', import.meta.url))).json();

for (const v of vectors.vectors) {
  test(`вектор: ${v.name}`, () => {
    assert.deepEqual(mergeEntity(v.a, v.b), v.expected, 'merge(a, b)');
    assert.deepEqual(mergeEntity(v.b, v.a), v.expected, 'merge(b, a)');
  });
}

// ---------- Свойства на случайных данных ----------

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genEntity(rnd, { allowTomb = true } = {}) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const time = () => 1 + Math.floor(rnd() * 6); // мало значений — много равных меток
  if (allowTomb && rnd() < 0.2) {
    const t = time();
    return { id: 'x', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: `2026-10-02T0${t}:00:00.000Z`, updatedBy: pick(['a', 'b', 'c']), deletedAt: '2026-10-02T00:00:00.000Z', fieldTimes: { deletedAt: t } };
  }
  const e = { id: 'x', createdAt: pick(['2026-10-01T00:00:00.000Z', '2026-10-01T01:00:00.000Z']), updatedAt: `2026-10-02T0${time()}:00:00.000Z`, updatedBy: pick(['a', 'b', 'c']), deletedAt: null, fieldTimes: { deletedAt: 1 } };
  for (const f of ['title', 'note', 'priority', 'listId']) {
    if (rnd() < 0.8) {
      e[f] = pick(f === 'priority' ? [0, 1, 2, 3] : f === 'listId' ? [null, 'L1', 'L2'] : ['А', 'Б', 'В', '']);
      e.fieldTimes[f] = time();
    }
  }
  if (rnd() < 0.5) {
    e.subtasks = [];
    for (const id of ['s1', 's2']) {
      if (rnd() < 0.6) e.subtasks.push({ id, createdAt: '2026-10-01T00:00:00.000Z', deletedAt: null, fieldTimes: { title: time(), done: time() }, title: pick(['раз', 'два']), done: rnd() < 0.5 });
    }
  }
  if (rnd() < 0.4) {
    e.occurrences = {};
    for (const d of ['2026-10-05', '2026-10-06']) {
      if (rnd() < 0.6) e.occurrences[d] = { state: pick(['open', 'done', 'skipped']), doneAt: null, date: null, time: null, t: time(), by: pick(['a', 'b']) };
    }
  }
  return e;
}

const same = (x, y) => canonicalJson(x) === canonicalJson(y);

test('свойство: коммутативность merge(a,b) = merge(b,a) — 2000 случайных пар', () => {
  const rnd = prng(42);
  for (let i = 0; i < 2000; i++) {
    const a = genEntity(rnd);
    const b = genEntity(rnd);
    assert.ok(same(mergeEntity(a, b), mergeEntity(b, a)), `итерация ${i}\na=${canonicalJson(a)}\nb=${canonicalJson(b)}`);
  }
});

test('свойство: идемпотентность merge(a,a) = a и merge(merge(a,b),b) = merge(a,b)', () => {
  const rnd = prng(7);
  for (let i = 0; i < 1000; i++) {
    const a = genEntity(rnd);
    const b = genEntity(rnd);
    assert.ok(same(mergeEntity(a, a), a), `итерация ${i}: merge(a,a)`);
    const ab = mergeEntity(a, b);
    assert.ok(same(mergeEntity(ab, b), ab), `итерация ${i}: merge(ab,b)`);
  }
});

test('свойство: ассоциативность для живых сущностей — 1000 троек', () => {
  // С надгробиями ассоциативность не гарантируется (DATA_FORMAT §6.1): сходимость обеспечивает Диск как общий центр.
  const rnd = prng(2026);
  for (let i = 0; i < 1000; i++) {
    const a = genEntity(rnd, { allowTomb: false });
    const b = genEntity(rnd, { allowTomb: false });
    const c = genEntity(rnd, { allowTomb: false });
    assert.ok(same(mergeEntity(mergeEntity(a, b), c), mergeEntity(a, mergeEntity(b, c))), `итерация ${i}`);
  }
});

test('mergeData: объединение по id, результат отсортирован', () => {
  const e = (id, title, t) => ({ id, createdAt: 'c', updatedAt: 'u', updatedBy: 'd', deletedAt: null, fieldTimes: { title: t }, title });
  const r = mergeData({ tasks: [e('b', 'B1', 1), e('a', 'A', 1)] }, { tasks: [e('b', 'B2', 2), e('c', 'C', 1)] }, ['tasks']);
  assert.deepEqual(r.tasks.map((x) => x.id), ['a', 'b', 'c']);
  assert.equal(r.tasks[1].title, 'B2');
});

test('maxStamp учитывает вложенные элементы и экземпляры', () => {
  const v = vectors.vectors.find((x) => x.name.startsWith('подзадачи'));
  assert.equal(maxStamp(v.b), 15);
  const o = vectors.vectors.find((x) => x.name.startsWith('экземпляры'));
  assert.equal(maxStamp(o.a), 13);
});

// ---------- Журнал конфликтов ----------

const task = (fields, ft, by = 'devA') => ({
  id: 't1', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T10:00:00.000Z', updatedBy: by, deletedAt: null,
  fieldTimes: { deletedAt: 5, ...ft }, title: 'Билеты', ...fields,
});

test('конфликт: одно поле изменено на обоих устройствах после синхронизации (TZ §9.6, пример 1)', () => {
  const base = new Map([['tasks/t1', { title: 5, note: 5, deadlineDate: 5, deletedAt: 5 }]]);
  const local = { tasks: [task({ note: '1–7', deadlineDate: '2026-10-12' }, { title: 5, note: 20, deadlineDate: 15 }, 'K')] };
  const remote = { tasks: [task({ note: '1–10', deadlineDate: '2026-10-10' }, { title: 5, note: 10, deadlineDate: 5 }, 'T')] };
  const merged = mergeData(local, remote, ['tasks']);
  assert.equal(merged.tasks[0].note, '1–7');
  assert.equal(merged.tasks[0].deadlineDate, '2026-10-12');
  const c = detectConflicts(local, remote, merged, base, 'now');
  assert.equal(c.length, 1, 'только note: дедлайн менялся с одной стороны');
  assert.equal(c[0].field, 'note');
  assert.equal(c[0].winnerValue, '1–7');
  assert.equal(c[0].loserValue, '1–10');
  assert.equal(c[0].loserDevice, 'T');
});

test('конфликт: без общей базы значения по умолчанию (метка 1) конфликтом не считаются', () => {
  const s = (tz) => ({ id: 's', createdAt: 'c', updatedAt: 'u', updatedBy: 'd', deletedAt: null, fieldTimes: { timeZone: 1 }, timeZone: tz });
  const local = { settings: [s('Europe/Moscow')] };
  const remote = { settings: [s('Europe/Samara')] };
  assert.equal(detectConflicts(local, remote, mergeData(local, remote, ['settings']), new Map(), 'now').length, 0);
});

test('конфликт: удалено на другом устройстве после локальной правки → запись «deleted» с полной копией', () => {
  const base = new Map([['tasks/t1', { title: 5, deletedAt: 5 }]]);
  const local = { tasks: [task({ title: 'Правка' }, { title: 20 })] };
  const tomb = { id: 't1', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: 'u', updatedBy: 'T', deletedAt: '2026-10-02T12:00:00.000Z', fieldTimes: { deletedAt: 30 } };
  const remote = { tasks: [tomb] };
  const merged = mergeData(local, remote, ['tasks']);
  assert.ok(merged.tasks[0].deletedAt, 'надгробие победило');
  const c = detectConflicts(local, remote, merged, base, 'now');
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, 'deleted');
  assert.equal(c[0].loserValue.title, 'Правка');
  // Правка позже удаления — задача остаётся, запись «resurrected».
  const local2 = { tasks: [task({ title: 'Правка' }, { title: 40 })] };
  const merged2 = mergeData(local2, remote, ['tasks']);
  assert.ok(!merged2.tasks[0].deletedAt);
  assert.equal(detectConflicts(local2, remote, merged2, base, 'now')[0].kind, 'resurrected');
});
