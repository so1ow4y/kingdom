import { test, assert } from './runner.js';
import { keyBetween, keyForIndex, byOrder } from '../src/core/order.js';

test('order: базовые ключи', () => {
  assert.equal(keyBetween(null, null), 'a0');
  assert.equal(keyBetween('a0', null), 'a1');
  assert.equal(keyBetween(null, 'a0'), 'Zz');
  assert.equal(keyBetween('a0', 'a1'), 'a0V');
  assert.equal(keyBetween('a0', 'a0V'), 'a0G');
});

test('order: переходы целой части', () => {
  assert.equal(keyBetween('az', null), 'b00');
  assert.equal(keyBetween(null, 'b00'), 'az');
  assert.equal(keyBetween(null, 'Z0'), 'Yzz');
});

test('order: 1000 вставок в начало — порядок верный, ключи короткие', () => {
  let first = null;
  const keys = [];
  for (let i = 0; i < 1000; i++) {
    first = keyBetween(null, first);
    keys.push(first);
  }
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i] < keys[i - 1], `${keys[i]} < ${keys[i - 1]}`);
  assert.ok(first.length <= 4, 'длина ' + first.length);
});

test('order: 1000 вставок в конец', () => {
  let last = null;
  for (let i = 0; i < 1000; i++) {
    const k = keyBetween(last, null);
    if (last) assert.ok(k > last);
    last = k;
  }
  assert.ok(last.length <= 4, 'длина ' + last.length);
});

test('order: 40 вставок в одно место — порядок сохраняется', () => {
  const a = 'a0';
  let b = 'a1';
  for (let i = 0; i < 40; i++) {
    const k = keyBetween(a, b);
    assert.ok(a < k && k < b, `${a} < ${k} < ${b}`);
    b = k;
  }
});

test('order: неправильные аргументы — исключение', () => {
  assert.throws(() => keyBetween('a1', 'a0'));
  assert.throws(() => keyBetween('a0', 'a0'));
  assert.throws(() => keyBetween('a10', null), 'хвостовой ноль запрещён');
});

test('order: keyForIndex ставит элемент на нужное место', () => {
  const items = ['a0', 'a1', 'a2'].map((order, i) => ({ id: 'id' + i, order }));
  const k0 = keyForIndex(items, 0);
  const k1 = keyForIndex(items, 1);
  const k3 = keyForIndex(items, 3);
  assert.ok(k0 < 'a0');
  assert.ok('a0' < k1 && k1 < 'a1');
  assert.ok(k3 > 'a2');
});

test('order: keyForIndex при равных ключах (после слияния) не падает', () => {
  const items = [{ id: 'x', order: 'a1' }, { id: 'y', order: 'a1' }, { id: 'z', order: 'a2' }];
  const k = keyForIndex(items, 1);
  assert.ok(k > 'a1' && k < 'a2', k);
});

test('order: byOrder — при равных ключах по id', () => {
  const list = [{ id: 'b', order: 'a1' }, { id: 'a', order: 'a1' }, { id: 'c', order: 'a0' }];
  assert.deepEqual(list.sort(byOrder).map((x) => x.id), ['c', 'a', 'b']);
});
