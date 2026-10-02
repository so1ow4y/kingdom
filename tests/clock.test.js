import { test, assert } from './runner.js';
import { createClock } from '../src/core/clock.js';

test('clock: метки строго растут, даже если время стоит', () => {
  const c = createClock(0, () => 1000);
  assert.equal(c.stamp(), 1000);
  assert.equal(c.stamp(), 1001);
  assert.equal(c.stamp(), 1002);
});

test('clock: системное время пошло назад — метки всё равно растут', () => {
  let now = 5000;
  const c = createClock(0, () => now);
  assert.equal(c.stamp(), 5000);
  now = 3000;
  assert.equal(c.stamp(), 5001);
});

test('clock: продолжает с сохранённой метки', () => {
  const c = createClock(9000, () => 1000);
  assert.equal(c.stamp(), 9001);
});

test('clock: observe сдвигает часы к увиденной метке', () => {
  const c = createClock(0, () => 1000);
  c.observe(50000, 100000);
  assert.equal(c.stamp(), 50001);
});

test('clock: метка из далёкого будущего (> serverNow + 24 ч) часы не сдвигает', () => {
  const c = createClock(0, () => 1000);
  c.observe(1000 + 2 * 86400000, 1000);
  assert.equal(c.stamp(), 1000);
});
