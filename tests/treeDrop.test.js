// Перетаскивание в дереве (обновление 0.4): расчёт цели и применение. core/treeDrop.js.

import { test, assert } from './runner.js';
import { makeCtx, makeData, addTask } from './helpers.js';
import {
  blockRange, pointerTarget, resolveDrop, applyDrop, keyboardTarget, shiftLevels, keyBetweenSafe, menuMove, INDENT_STEP,
} from '../src/core/treeDrop.js';
import { setListMembership } from '../src/core/model.js';
import { childrenOf, MAX_DEPTH } from '../src/core/selectors.js';
import { DEFAULT_LISTS } from '../src/config.js';

const [L1, L2] = DEFAULT_LISTS.map((l) => l.id);
const TODAY = '2026-10-02';

/**
 * Дерево из описания: [['A', 0], ['a1', 1], ['B', 0]] — задачи с родителями по отступам.
 * → { d, c, ids: { A: id }, rows }
 */
function tree(spec, { zone = 'z', lists = [] } = {}) {
  const c = makeCtx();
  const d = makeData();
  const ids = {};
  const stack = [];
  const rows = [];
  let n = 0;
  for (const [title, depth] of spec) {
    stack.length = depth;
    const parentId = depth ? stack[depth - 1] : null;
    const t = addTask(d, c, { title, parentId, listIds: lists, order: 'a' + n++ });
    ids[title] = t.id;
    stack[depth] = t.id;
    rows.push({ id: t.id, depth, zone });
  }
  return { d, c, ids, rows };
}

const ZONES = { z: { manual: true, listId: 'inbox' } };

test('blockRange: задача с видимыми подзадачами', () => {
  const { ids, rows } = tree([['A', 0], ['a1', 1], ['a2', 1], ['B', 0]]);
  assert.deepEqual(blockRange(rows, ids.A), [0, 3]);
  assert.deepEqual(blockRange(rows, ids.a1), [1, 2]);
  assert.deepEqual(blockRange(rows, ids.B), [3, 4]);
});

test('сдвиг вбок: ±1 уровень примерно с 20 px, ±2 — с 48 px', () => {
  assert.equal(shiftLevels(0), 0);
  assert.equal(shiftLevels(15), 0);
  assert.equal(shiftLevels(20), 1);
  assert.equal(shiftLevels(-20), -1);
  assert.equal(shiftLevels(47), 1);
  assert.equal(shiftLevels(48), 2);
  assert.ok(INDENT_STEP >= 24 && INDENT_STEP <= 32);
});

test('pointerTarget: середина строки — вложить; верх и низ — промежутки; уровень — как у строки ниже', () => {
  const { ids, rows } = tree([['A', 0], ['a1', 1], ['B', 0], ['C', 0]]);
  assert.deepEqual(pointerTarget(rows, ids.C, { index: 0, part: 'middle' }, 0), { type: 'nest', index: 0 });
  // C между a1 и B: уровень строки ниже (B) — верхний
  assert.deepEqual(pointerTarget(rows, ids.C, { index: 2, part: 'top' }, 0), { type: 'gap', zone: 'z', prev: 1, next: 2, depth: 0 });
  // тот же промежуток со сдвигом вправо — последняя подзадача A
  assert.equal(pointerTarget(rows, ids.C, { index: 2, part: 'top' }, 30).depth, 1);
  // между A и a1 уровень только 1 (a1 остаётся подзадачей A)
  assert.equal(pointerTarget(rows, ids.C, { index: 0, part: 'bottom' }, -60).depth, 1);
  // в самом верху — только верхний уровень
  assert.equal(pointerTarget(rows, ids.C, { index: 0, part: 'top' }, 90).depth, 0);
});

test('pointerTarget: подзадачу можно вынести выше родителя и ниже его ветки', () => {
  const { ids, rows } = tree([['P', 0], ['A', 0], ['a1', 1], ['a2', 1], ['B', 0]]);
  // a2 над A (между P и A) — верхний уровень
  assert.equal(pointerTarget(rows, ids.a2, { index: 1, part: 'top' }, 0).depth, 0);
  // a1 ниже ветки A (между a2 и B) — верхний уровень, со сдвигом вправо — снова в A
  assert.equal(pointerTarget(rows, ids.a1, { index: 4, part: 'top' }, 0).depth, 0);
  assert.equal(pointerTarget(rows, ids.a1, { index: 4, part: 'top' }, 30).depth, 1);
});

test('pointerTarget: на своём месте уровень сохраняется; сдвиг вправо на месте — в соседа выше, влево — наружу', () => {
  const { ids, rows } = tree([['A', 0], ['a1', 1], ['a2', 1], ['B', 0]]);
  const own = pointerTarget(rows, ids.a2, { index: 3, part: 'top' }, 0);
  assert.deepEqual(own, { type: 'gap', zone: 'z', prev: 1, next: 3, depth: 1 });
  assert.equal(pointerTarget(rows, ids.a2, { index: 3, part: 'top' }, 30).depth, 2);
  assert.equal(pointerTarget(rows, ids.a2, { index: 3, part: 'top' }, -30).depth, 0);
  // строка самой задачи под указателем — тоже «своё место»
  assert.equal(pointerTarget(rows, ids.a2, { index: 2, part: 'middle' }, 0).depth, 1);
});

test('resolveDrop + applyDrop: вложить на середину строки — последней подзадачей, поддерево едет с задачей', () => {
  const { d, c, ids, rows } = tree([['A', 0], ['a1', 1], ['B', 0], ['b1', 1], ['b2', 2]]);
  const r = resolveDrop(d, rows, ZONES, ids.B, { type: 'nest', index: 0 });
  assert.ok(r.ok);
  assert.equal(r.label, 'Вложить в «A»');
  const ch = applyDrop(d, r.move, c);
  assert.equal(ch.length, 1);
  const B = ch[0].next;
  assert.equal(B.parentId, ids.A);
  assert.ok(B.order > d.tasks.get(ids.a1).order, 'после последней подзадачи');
  d.tasks.set(B.id, B);
  assert.deepEqual(childrenOf(d, ids.B).map((x) => x.id), [ids.b1], 'подзадачи остались у B');
  assert.equal(d.tasks.get(ids.b2).parentId, ids.b1);
});

test('resolveDrop: нельзя в саму себя и в свою подзадачу, нельзя глубже лимита, нельзя в «только чтении»', () => {
  const { d, ids, rows } = tree([['A', 0], ['a1', 1], ['B', 0], ['b1', 1], ['b2', 2], ['b3', 3]]);
  // a1 видна в другом блоке (например, на «Сегодня» с подписью ↳) — вложить A в неё нельзя
  const rows2 = [...rows, { id: ids.a1, depth: 0, zone: 'other' }];
  const cyc = resolveDrop(d, rows2, { ...ZONES, other: {} }, ids.A, { type: 'nest', index: rows2.length - 1 });
  assert.equal(cyc.ok, false);
  assert.equal(cyc.reason, 'Нельзя вложить задачу в её же подзадачу');
  // A (2 уровня) под b2 (уровень 3) — 5 уровней
  const deep = resolveDrop(d, rows, ZONES, ids.A, { type: 'nest', index: 4 });
  assert.equal(deep.ok, false);
  assert.equal(deep.reason, `Вложенность не больше ${MAX_DEPTH} уровней`);
  const ro = resolveDrop(d, rows, ZONES, ids.B, { type: 'nest', index: 0 }, { readOnly: true });
  assert.equal(ro.ok, false);
  assert.equal(ro.reason, 'Только чтение');
});

test('промежуток на уровне подзадачи: родитель — строка выше, порядок между соседями', () => {
  const { d, c, ids, rows } = tree([['A', 0], ['a1', 1], ['a2', 1], ['B', 0]]);
  const target = pointerTarget(rows, ids.B, { index: 2, part: 'top' }, 0); // между a1 и a2 → уровень 1
  const r = resolveDrop(d, rows, ZONES, ids.B, target);
  assert.ok(r.ok);
  const B = applyDrop(d, r.move, c)[0].next;
  assert.equal(B.parentId, ids.A);
  assert.ok(B.order > d.tasks.get(ids.a1).order && B.order < d.tasks.get(ids.a2).order);
});

test('вынос наверх: подзадача между корнями становится задачей верхнего уровня', () => {
  const { d, c, ids, rows } = tree([['A', 0], ['a1', 1], ['B', 0], ['C', 0]]);
  const target = pointerTarget(rows, ids.a1, { index: 3, part: 'top' }, 0); // между B и C
  const r = resolveDrop(d, rows, ZONES, ids.a1, target);
  assert.ok(r.ok);
  assert.equal(r.label, 'Вынести на верхний уровень');
  const x = applyDrop(d, r.move, c)[0].next;
  assert.equal(x.parentId, null);
  assert.ok(x.order > d.tasks.get(ids.B).order && x.order < d.tasks.get(ids.C).order);
});

test('на своём месте ничего не меняется', () => {
  const { d, ids, rows } = tree([['A', 0], ['B', 0], ['C', 0]]);
  const r = resolveDrop(d, rows, ZONES, ids.B, pointerTarget(rows, ids.B, { index: 2, part: 'top' }, 0));
  assert.ok(r.ok && r.noop);
});

test('крайние позиции: в самый верх и в самый низ блока', () => {
  const { d, c, ids, rows } = tree([['A', 0], ['B', 0], ['C', 0]]);
  const top = applyDrop(d, resolveDrop(d, rows, ZONES, ids.C, pointerTarget(rows, ids.C, { index: 0, part: 'top' }, 0)).move, c)[0].next;
  assert.ok(top.order < d.tasks.get(ids.A).order);
  const end = applyDrop(d, resolveDrop(d, rows, ZONES, ids.A, pointerTarget(rows, ids.A, { index: 2, part: 'bottom' }, 0)).move, c)[0].next;
  assert.ok(end.order > d.tasks.get(ids.C).order);
});

test('блок с автоматическим порядком: переставлять нельзя, вкладывать и выносить можно', () => {
  const { d, ids, rows } = tree([['A', 0], ['a1', 1], ['B', 0], ['C', 0]]);
  const zones = { z: { manual: false, autoReason: 'Порядок по времени' } };
  const re = resolveDrop(d, rows, zones, ids.C, pointerTarget(rows, ids.C, { index: 0, part: 'top' }, 0));
  assert.equal(re.ok, false);
  assert.equal(re.reason, 'Порядок по времени');
  assert.ok(resolveDrop(d, rows, zones, ids.C, { type: 'nest', index: 0 }).ok);
  const out = resolveDrop(d, rows, zones, ids.a1, pointerTarget(rows, ids.a1, { index: 3, part: 'top' }, 0));
  assert.ok(out.ok);
  assert.equal(out.move.order, null, 'порядок не трогаем');
  assert.equal(out.move.parentId, null);
});

test('корень чужого блока: если задача туда не попадает — нельзя (между блоками «Сегодня» не переставляют)', () => {
  const { d, ids, rows } = tree([['A', 0], ['B', 0]]);
  const rows2 = [rows[0], { ...rows[1], zone: 'today' }];
  const zones = { z: { manual: true, accepts: (t) => t.id === ids.A, rejectReason: 'Эта задача из другого блока' }, today: { manual: false } };
  const r = resolveDrop(d, rows2, zones, ids.B, { type: 'gap', zone: 'z', prev: 0, next: -1, depth: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'Эта задача из другого блока');
  // а вложить в задачу другого блока — можно
  assert.ok(resolveDrop(d, rows2, zones, ids.B, { type: 'nest', index: 0 }).ok);
});

test('переход между списками: между задачами другого списка — меняется список (и у подзадач из того же списка)', () => {
  const { d, c, ids } = tree([['A', 0], ['a1', 1], ['B', 0]], { lists: [L1] });
  // B — в списке L2
  let B = d.tasks.get(ids.B);
  B = setListMembership(setListMembership(B, L1, false, c), L2, true, c);
  d.tasks.set(B.id, B);
  const rows = [
    { id: ids.A, depth: 0, zone: 'l1' }, { id: ids.a1, depth: 1, zone: 'l1' },
    { id: ids.B, depth: 0, zone: 'l2' },
  ];
  const zones = { l1: { manual: true, listId: L1 }, l2: { manual: true, listId: L2 } };
  const r = resolveDrop(d, rows, zones, ids.A, { type: 'gap', zone: 'l2', prev: 2, next: -1, depth: 0 });
  assert.ok(r.ok);
  assert.equal(r.label.startsWith('В список'), true);
  const ch = applyDrop(d, r.move, c);
  const A = ch.find((x) => x.next.id === ids.A).next;
  const a1 = ch.find((x) => x.next.id === ids.a1).next;
  assert.ok(A.lists[L2].in && !A.lists[L1].in);
  assert.ok(a1.lists[L2].in && !a1.lists[L1].in, 'подзадача переехала вместе');
  // на середину задачи другого списка — вложение, списки не меняются
  const n = resolveDrop(d, rows, zones, ids.A, { type: 'nest', index: 2 });
  assert.equal(n.move.lists, undefined);
});

test('во «Входящие» из списка — задача уходит из всех списков', () => {
  const { d, c, ids } = tree([['A', 0], ['B', 0]], { lists: [L1] });
  let B = d.tasks.get(ids.B);
  B = setListMembership(B, L1, false, c);
  d.tasks.set(B.id, B);
  const rows = [{ id: ids.A, depth: 0, zone: 'l1' }, { id: ids.B, depth: 0, zone: 'in' }];
  const zones = { l1: { manual: true, listId: L1 }, in: { manual: true, listId: 'inbox' } };
  const r = resolveDrop(d, rows, zones, ids.A, { type: 'gap', zone: 'in', prev: 1, next: -1, depth: 0 });
  assert.equal(r.label, 'Во «Входящие»');
  const A = applyDrop(d, r.move, c)[0].next;
  assert.equal(Object.values(A.lists).some((v) => v.in), false);
});

test('экран списка: вынесенная наверх подзадача без списков попадает в этот список', () => {
  const { d, c, ids, rows } = tree([['A', 0], ['a1', 1], ['B', 0]]);
  let A = d.tasks.get(ids.A);
  A = setListMembership(A, L1, true, c);
  d.tasks.set(A.id, A);
  const zones = { z: { manual: true, listId: L1 } };
  const r = resolveDrop(d, rows, zones, ids.a1, pointerTarget(rows, ids.a1, { index: 2, part: 'bottom' }, 0));
  const x = applyDrop(d, r.move, c)[0].next;
  assert.equal(x.parentId, null);
  assert.ok(x.lists[L1].in);
});

test('★ только у задач верхнего уровня: вложенная главная отдаёт место верхней задаче ветки', () => {
  const { d, c, ids, rows } = tree([['A', 0], ['B', 0]]);
  d.tasks.set(ids.B, { ...d.tasks.get(ids.B), focusDate: TODAY, focusOrder: 'a5' });
  const r = resolveDrop(d, rows, ZONES, ids.B, { type: 'nest', index: 0 });
  const ch = applyDrop(d, r.move, c, { today: TODAY });
  const B = ch.find((x) => x.next.id === ids.B).next;
  const A = ch.find((x) => x.next.id === ids.A).next;
  assert.equal(B.focusDate, null);
  assert.equal(A.focusDate, TODAY);
  assert.equal(A.focusOrder, 'a5');
});

test('ручной порядок «Главного» — по focusOrder', () => {
  const { d, c, ids, rows } = tree([['A', 0], ['B', 0], ['C', 0]]);
  ['A', 'B', 'C'].forEach((k, i) => d.tasks.set(ids[k], { ...d.tasks.get(ids[k]), focusDate: TODAY, focusOrder: 'a' + (i + 1) }));
  const zones = { z: { manual: true, orderField: 'focusOrder' } };
  const r = resolveDrop(d, rows, zones, ids.C, pointerTarget(rows, ids.C, { index: 0, part: 'top' }, 0));
  const C = applyDrop(d, r.move, c, { today: TODAY })[0].next;
  assert.ok(C.focusOrder < 'a1');
  assert.equal(C.order, d.tasks.get(ids.C).order, 'обычный порядок не тронут');
});

test('клавиатура: Alt+↑/↓ — переставить, Tab — вложить в соседа выше, Shift+Tab — вынести за родителя', () => {
  const { ids, rows } = tree([['A', 0], ['a1', 1], ['a2', 1], ['B', 0], ['C', 0]]);
  assert.deepEqual(keyboardTarget(rows, ids.B, 'up'), { type: 'gap', zone: 'z', prev: -1, next: 0, depth: 0 });
  assert.deepEqual(keyboardTarget(rows, ids.A, 'down'), { type: 'gap', zone: 'z', prev: 3, next: 4, depth: 0 });
  assert.deepEqual(keyboardTarget(rows, ids.C, 'indent'), { type: 'nest', index: 3 });
  assert.equal(keyboardTarget(rows, ids.a1, 'up'), null);
  assert.deepEqual(keyboardTarget(rows, ids.a1, 'outdent'), { type: 'gap', zone: 'z', prev: 2, next: 3, depth: 0 });
  assert.deepEqual(keyboardTarget(rows, ids.a2, 'outdent'), { type: 'gap', zone: 'z', prev: 1, next: 3, depth: 0 });
  assert.equal(keyboardTarget(rows, ids.A, 'outdent'), null);
});

test('меню: «Вынести на верхний уровень» — сразу после бывшего родителя; «Сделать подзадачей» — в конец', () => {
  const { d, c, ids } = tree([['A', 0], ['a1', 1], ['B', 0]]);
  const up = applyDrop(d, menuMove(d, ids.a1, null), c)[0].next;
  assert.equal(up.parentId, null);
  assert.ok(up.order > d.tasks.get(ids.A).order && up.order < d.tasks.get(ids.B).order);
  const down = applyDrop(d, menuMove(d, ids.B, ids.A), c)[0].next;
  assert.equal(down.parentId, ids.A);
  assert.ok(down.order > d.tasks.get(ids.a1).order);
});

test('keyBetweenSafe: равные и перепутанные ключи не роняют перестановку', () => {
  assert.ok(keyBetweenSafe('a1', 'a1') > 'a1');
  assert.ok(keyBetweenSafe('a2', 'a1') > 'a2');
  assert.ok(keyBetweenSafe(null, 'a1') < 'a1');
  assert.equal(typeof keyBetweenSafe(null, null), 'string');
});

test('экран «Списки»: из другого списка можно бросить в любой раздел и в пустой список', () => {
  const { d, c, ids } = tree([['A', 0], ['B', 0]], { lists: [L1] });
  d.tasks.set(ids.B, { ...d.tasks.get(ids.B), scheduledDate: TODAY });
  // B (с датой) — в разделе «Без даты» списка L2 (там уже A из L2) и в пустом списке
  let A = setListMembership(setListMembership(d.tasks.get(ids.A), L1, false, c), L2, true, c);
  d.tasks.set(A.id, A);
  const rows = [
    { id: ids.B, depth: 0, zone: 'l1:scheduled' },
    { id: ids.A, depth: 0, zone: 'l2:noDate' },
    { id: '', depth: 0, zone: 'l3:empty' },
  ];
  const section = (s) => (t) => (t.scheduledDate ? 'scheduled' : 'noDate') === s;
  const zones = {
    'l1:scheduled': { manual: false, listId: L1, crossList: true, accepts: section('scheduled') },
    'l2:noDate': { manual: true, listId: L2, crossList: true, accepts: section('noDate'), rejectReason: 'Из другого раздела' },
    'l3:empty': { manual: false, listId: DEFAULT_LISTS[2].id, crossList: true, accepts: () => false },
  };
  const r = resolveDrop(d, rows, zones, ids.B, { type: 'gap', zone: 'l2:noDate', prev: 1, next: -1, depth: 0 });
  assert.ok(r.ok);
  assert.equal(r.move.order, null, 'место среди чужого раздела не учитываем');
  assert.deepEqual(r.move.lists, { add: L2, remove: L1 });
  const e = resolveDrop(d, rows, zones, ids.B, { type: 'gap', zone: 'l3:empty', prev: -1, next: 2, depth: 0 });
  assert.ok(e.ok);
  assert.equal(e.move.lists.add, DEFAULT_LISTS[2].id);
  // в свой же список, но в чужой раздел — нельзя
  const same = { ...zones, 'l2:noDate': { ...zones['l2:noDate'], listId: L1 } };
  assert.equal(resolveDrop(d, rows, same, ids.B, { type: 'gap', zone: 'l2:noDate', prev: 1, next: -1, depth: 0 }).reason, 'Из другого раздела');
});