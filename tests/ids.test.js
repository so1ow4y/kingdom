import { test, assert } from './runner.js';
import { uuidv7, UUID_RE } from '../src/core/ids.js';

test('uuidv7: формат RFC 9562, версия 7, вариант 10xx', () => {
  const id = uuidv7();
  assert.ok(UUID_RE.test(id), id);
  assert.equal(id[14], '7');
  assert.ok('89ab'.includes(id[19]), id);
});

test('uuidv7: сортируется по времени', () => {
  const a = uuidv7(1759389330000);
  const b = uuidv7(1759389330001);
  assert.ok(a < b, `${a} < ${b}`);
});

test('uuidv7: 2000 штук без повторов', () => {
  const s = new Set();
  for (let i = 0; i < 2000; i++) s.add(uuidv7());
  assert.equal(s.size, 2000);
});

test('uuidv7: время кодируется в первых 48 битах', () => {
  const ms = 1759389330123;
  const id = uuidv7(ms);
  const hex = id.replace(/-/g, '').slice(0, 12);
  assert.equal(parseInt(hex, 16), ms);
});
