import { run } from './runner.js';

await run([
  './ids.test.js',
  './clock.test.js',
  './order.test.js',
  './dates.test.js',
  './plural.test.js',
  './canonical.test.js',
  './model.test.js',
  './selectors.test.js',
  './merge.test.js',
  './format.test.js',
  './sync.test.js',
  './status.test.js',
]);
