import { test, assert } from './runner.js';
import { canonicalJson, sameValue } from '../src/core/canonical.js';

test('canonical: порядок ключей не важен, вложенность учитывается', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }), '{"a":{"c":null,"d":[1,{"x":1,"y":2}]},"b":1}');
});

test('canonical: sameValue', () => {
  assert.ok(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 }));
  assert.ok(!sameValue(1, '1'));
  assert.ok(!sameValue(null, {}));
  assert.ok(sameValue(null, null));
  assert.ok(!sameValue([1, 2], [2, 1]));
});
