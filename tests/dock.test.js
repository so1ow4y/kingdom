// Док 1.1: раскладка пунктов (у телефона и компьютера своя), настройки ленты и «всего пространства», автопуш.

import { test, assert } from './runner.js';
import { dockLayout, defaultOrder, mergeOrder, chunkByGroup, moveKey, menuKey } from '../src/ui/dockLayout.js';
import { cleanPrefs } from '../src/ui/prefs.js';
import { autoPushDue, isEditing, shouldGuardClose } from '../src/sync/autoPush.js';

const FEAST = [
  { title: 'Питание', items: [
    { title: 'Дневник', to: '/diary' }, { title: 'Обо мне', to: '/body' },
    { id: 'catalog', title: 'Продукты и лекарства', items: [{ to: '/foods' }, { to: '/foods/meds' }] },
    { id: 'meals', title: 'Рационы', items: [{ to: '/meals' }, { to: '/meal/x' }] },
  ] },
  { title: 'Обзор', items: [{ title: 'Корзина', to: '/bin' }] },
  { title: 'Приложение', items: [{ title: 'Настройки', to: '/settings' }] },
];

test('док 1.1: на телефоне сначала переход, добавить, дневник, «Обо мне», продукты; поиск и настройки — в «Ещё»', () => {
  assert.equal(menuKey(FEAST[0].items[2]), 'b:catalog');
  assert.deepEqual(defaultOrder(FEAST, { phone: true, app: 'feast' }).slice(0, 5), ['switch', 'add', 'l:/diary', 'l:/body', 'b:catalog']);
  const phone = dockLayout(FEAST, {}, { phone: true, app: 'feast' });
  assert.deepEqual(phone.filter((e) => e.on).map((e) => e.key),
    ['switch', 'add', 'l:/diary', 'l:/body', 'b:catalog', 'b:meals', 'l:/bin', 'push', 'letter']);
  assert.ok(!phone.find((e) => e.key === 'l:/settings').on && !phone.find((e) => e.key === 'sync').on);
  const desk = dockLayout(FEAST, {}, { phone: false, app: 'feast' });
  assert.deepEqual(desk.slice(0, 4).map((e) => e.key), ['letter', 'switch', 'add', 'l:/diary']);
  assert.ok(desk.every((e) => e.on), 'на компьютере по умолчанию видно всё');
  assert.deepEqual(chunkByGroup(desk).map((c) => c.group), ['top', 'Питание', 'Обзор', 'Приложение', 'bottom']);
});

test('док 1.1: свой порядок — у телефона и компьютера свой; новый пункт встаёт рядом с соседом по умолчанию', () => {
  // сохранённый порядок — весь список; «Корзины» в нём нет (появилась позже), зато есть мусор и повтор
  const saved = moveKey(defaultOrder(FEAST, { phone: true, app: 'feast' }), 'l:/body', 0).filter((k) => k !== 'l:/bin').concat(['nonsense', 'add']);
  const prefs = { barOrder: saved, barOff: ['letter'], dockOrder: moveKey(defaultOrder(FEAST, { phone: false, app: 'feast' }), 'l:/bin', 0) };
  const phone = dockLayout(FEAST, prefs, { phone: true, app: 'feast' });
  const keys = phone.map((e) => e.key);
  assert.deepEqual(keys.slice(0, 3), ['l:/body', 'switch', 'add']);
  assert.equal(keys[keys.indexOf('b:meals') + 1], 'l:/bin', 'новый пункт — после соседа по умолчанию');
  assert.ok(!keys.includes('nonsense') && keys.filter((k) => k === 'add').length === 1, 'неизвестное и повторы — прочь');
  assert.ok(!phone.find((e) => e.key === 'letter').on && phone.find((e) => e.key === 'l:/settings').on, 'свой список выключенных');
  const desk = dockLayout(FEAST, prefs, { phone: false, app: 'feast' });
  assert.equal(desk[0].key, 'l:/bin', 'порядок компьютера — свой');
  assert.deepEqual(mergeOrder(['a', 'b', 'c', 'd'], ['c', 'a']), ['c', 'd', 'a', 'b'], 'b — после a, d — после c');
  assert.deepEqual(mergeOrder(['a', 'b'], null), ['a', 'b']);
  assert.deepEqual(moveKey(['a', 'b', 'c'], 'c', 0), ['c', 'a', 'b']);
  assert.deepEqual(moveKey(['a', 'b', 'c'], 'a', 9), ['b', 'c', 'a']);
});

test('док 1.1: настройки из хранилища проверяются — всё пространство, лента, списки пунктов', () => {
  const p = cleanPrefs({ dockFill: 'yes', barSize: 'xxl', barCount: 42, barLabels: 'no', barOrder: 'x', dockOff: ['a', 1, 'a'], barOff: null,
    autoPushMinutes: 0, autoPush: 1 });
  assert.ok(!('dockFill' in p) && !('barSize' in p) && !('barLabels' in p) && !('barOrder' in p) && !('autoPush' in p));
  assert.equal(p.barCount, 8);
  assert.deepEqual(p.dockOff, ['a']);
  assert.equal(p.barOff, null);
  assert.equal(p.autoPushMinutes, 1);
  assert.deepEqual(cleanPrefs({ dockFill: false, barSize: 'xl', barCount: 4 }), { dockFill: false, barSize: 'xl', barCount: 4 });
});

test('автопуш 1.1: через N минут без изменений, есть что пушить и не идёт ввод', () => {
  const base = { enabled: true, minutes: 5, now: 10 * 60000, lastChange: 4 * 60000, dirty: 3, editing: false, ready: true };
  assert.ok(autoPushDue(base));
  assert.ok(!autoPushDue({ ...base, lastChange: 6 * 60000 }), 'прошло 4 минуты — рано');
  assert.ok(!autoPushDue({ ...base, editing: true }), 'идёт ввод — ждём');
  assert.ok(!autoPushDue({ ...base, dirty: 0 }), 'нечего пушить');
  assert.ok(!autoPushDue({ ...base, enabled: false }));
  assert.ok(!autoPushDue({ ...base, ready: false }), 'без входа или сети');
  assert.ok(autoPushDue({ ...base, minutes: 1, lastChange: 9 * 60000 }));
  const doc = (tag, cls = '') => ({ activeElement: { tagName: tag }, body: { classList: { contains: (c) => c === cls } } });
  assert.ok(isEditing({ sheet: { type: 'addFood' } }, doc('BODY')), 'открыт лист записи');
  assert.ok(isEditing({ quickAdd: {} }, doc('BODY')));
  assert.ok(isEditing({}, doc('TEXTAREA')), 'курсор в поле');
  assert.ok(isEditing({}, doc('BODY', 'entry-dragging')), 'тянут запись');
  assert.ok(!isEditing({}, doc('BUTTON')));
});

test('1.1.1: при закрытии спросить «Покинуть сайт?», если пуш идёт или есть что отправить', () => {
  assert.ok(shouldGuardClose({ dirty: 2, canPush: true }), 'непушнутое и есть вход — спросить и допушить');
  assert.ok(shouldGuardClose({ pushing: true, dirty: 0 }), 'пуш ещё идёт — дождаться');
  assert.ok(!shouldGuardClose({ dirty: 0 }), 'всё на Диске — закрывается молча');
  assert.ok(!shouldGuardClose({ dirty: 2, canPush: false }), 'без входа или сети отправить нельзя — не держим');
  assert.ok(!shouldGuardClose({ dirty: 2, reloading: true }), 'своя перезагрузка (язык, обновление)');
  assert.ok(!shouldGuardClose({ dirty: 2, guard: false }), 'выключено в настройках');
});
