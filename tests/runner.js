// Мини-раннер тестов в браузере: test(name, fn), затем run(files).

import { canonicalJson } from '../src/core/canonical.js';

const registry = [];
let currentFile = '';

export function test(name, fn) {
  registry.push({ file: currentFile, name, fn });
}

export class AssertionError extends Error {}

export const assert = {
  ok(v, msg = 'ожидалось истинное значение') {
    if (!v) throw new AssertionError(msg);
  },
  equal(actual, expected, msg = '') {
    if (actual !== expected) {
      throw new AssertionError(`${msg ? msg + ': ' : ''}ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`);
    }
  },
  deepEqual(actual, expected, msg = '') {
    const a = canonicalJson(actual);
    const e = canonicalJson(expected);
    if (a !== e) throw new AssertionError(`${msg ? msg + ': ' : ''}\nожидалось ${e}\nполучено  ${a}`);
  },
  throws(fn, msg = 'ожидалось исключение') {
    try {
      fn();
    } catch {
      return;
    }
    throw new AssertionError(msg);
  },
};

export async function run(files) {
  const grep = new URLSearchParams(location.search).get('grep');
  const out = document.getElementById('results');
  const summary = document.getElementById('summary');
  let passed = 0;
  let failed = 0;
  for (const f of files) {
    currentFile = f;
    try {
      await import(f);
    } catch (e) {
      registry.push({ file: f, name: 'загрузка модуля', fn: () => { throw e; } });
    }
  }
  let lastFile = null;
  for (const t of registry) {
    if (grep && !(t.file + ' ' + t.name).includes(grep)) continue;
    if (t.file !== lastFile) {
      lastFile = t.file;
      const h = document.createElement('div');
      h.className = 'file';
      h.textContent = t.file;
      out.append(h);
    }
    const row = document.createElement('div');
    row.className = 't';
    row.textContent = t.name;
    try {
      await t.fn();
      row.classList.add('ok');
      passed++;
    } catch (e) {
      row.classList.add('fail');
      const pre = document.createElement('pre');
      pre.textContent = (e && e.stack) || String(e);
      row.append(pre);
      failed++;
      console.error(t.file, t.name, e);
    }
    out.append(row);
  }
  summary.textContent = failed ? `Провалено: ${failed}, прошло: ${passed}` : `Все тесты прошли: ${passed}`;
  summary.className = failed ? 'fail' : 'ok';
  window.__testResult = { passed, failed };
}
