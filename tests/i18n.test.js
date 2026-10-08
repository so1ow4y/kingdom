// Язык интерфейса (обновление 0.12.5): тесты идут по-русски (tests/index.html), здесь — проверки словаря и tr().

import { test, assert } from './runner.js';
import { tr, LANG, hasTr } from '../src/core/i18n.js';
import EN, { PLURALS } from '../src/core/i18n.en.js';
import { translateTemplate } from '../src/ui/html.js';
import { countLabel } from '../src/core/plural.js';

const params = (s) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

test('i18n: по-русски tr() отдаёт ключ с подстановками, шаблоны не меняются', () => {
  assert.equal(LANG, 'ru');
  assert.equal(tr('Удалить «{name}»?', { name: 'Хлеб' }), 'Удалить «Хлеб»?');
  assert.equal(tr('нет такой строки'), 'нет такой строки');
  const strings = ['<b>Привет</b> ', ''];
  assert.equal(translateTemplate(strings)[0], '<b>Привет</b> ');
  assert.equal(countLabel(3, ['задача', 'задачи', 'задач']), '3 задачи');
});

test('i18n: английский словарь — без лишних подстановок, формы числа по две, ключи переведены', () => {
  const keys = Object.keys(EN);
  assert.ok(keys.length > 2000, `строк в словаре: ${keys.length}`);
  for (const [k, v] of Object.entries(EN)) {
    assert.equal(typeof v, 'string', k);
    const kp = params(k);
    for (const p of params(v)) assert.ok(kp.has(p), `«${k}» → «${v}»: подстановки {${p}} нет в ключе`);
    assert.ok(!/[А-Яа-яЁё]/.test(v) || /Язык|Русский/.test(v), `в переводе осталась кириллица: «${v}»`);
  }
  for (const [k, v] of Object.entries(PLURALS)) {
    assert.ok(Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string' && x), `формы «${k}»`);
  }
  for (const k of ['Записать еду', 'Сегодня', 'Настройки', 'Лекарства']) assert.ok(hasTr(k), k);
});
