// Горячие клавиши и массовые действия над задачами (обновление 0.10); 0.16 — несколько сочетаний на действие,
// клавиши списков с панелью справа и дока, проверка настроек дока и панели.

import { test, assert } from './runner.js';
import { makeData } from './helpers.js';
import {
  SHORTCUTS, comboFromEvent, normalizeCombo, comboParts, keyLabel, ruLetter, bindingOf, bindingsOf, bindingMap, conflictOf, assignPatch,
  addPatch, removePatch, defaultsOf, isReserved, actionFor, recorder,
} from '../src/ui/keys.js';
import { moveCursor, openCursor, syncCursor } from '../src/ui/listKeys.js';
import { cleanPrefs, PANEL_MIN, DOCK_WIDTH_MAX } from '../src/ui/prefs.js';
import { store } from '../src/store/appState.js';
import * as A from '../src/store/actions.js';
import { makeRule } from '../src/core/repeat.js';

const ev = (code, mods = {}, target = { tagName: 'BODY' }) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, target, ...mods });
const prefs = (shortcuts = {}, on = true) => ({ shortcuts, shortcutsOn: on });

test('клавиши: сочетание из события по физической кнопке, порядок модификаторов, только модификатор — ничего', () => {
  assert.equal(comboFromEvent(ev('KeyN')), 'KeyN');
  assert.equal(comboFromEvent(ev('KeyS', { metaKey: true, ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+Meta+KeyS');
  assert.equal(comboFromEvent(ev('ShiftLeft', { shiftKey: true })), null);
  assert.equal(comboFromEvent(ev('ControlRight', { ctrlKey: true })), null);
  assert.equal(comboFromEvent(ev('')), null);
  assert.equal(normalizeCombo('Shift+Ctrl+KeyA'), 'Ctrl+Shift+KeyA');
  assert.deepEqual(comboParts('Shift+Slash'), ['?']);
  assert.equal(comboParts('Ctrl+KeyS').at(-1), 'S');
  assert.deepEqual(['Digit1', 'BracketLeft', 'ArrowLeft', 'Numpad5', 'F2'].map(keyLabel), ['1', '[', '←', 'Num 5', 'F2']);
  assert.equal(ruLetter('KeyN'), 'Т');
  assert.equal(ruLetter('Digit1'), '');
  assert.ok(isReserved('Ctrl+KeyW') && isReserved('Escape') && !isReserved('Ctrl+KeyS'));
});

test('клавиши: умолчания без повторов, переназначение снимает сочетание у другого действия', () => {
  const defs = SHORTCUTS.flatMap((s) => defaultsOf(s.id).map((d) => [s.id, d]));
  assert.equal(new Set(defs.map(([, d]) => d)).size, defs.length, 'у двух действий одно сочетание по умолчанию');
  for (const [id, d] of defs) assert.ok(!isReserved(d, id), 'умолчание не должно быть занято браузером: ' + d);
  const p0 = prefs();
  assert.equal(bindingOf('newTask', p0), 'KeyN');
  assert.equal(bindingOf('pull', p0), null);
  assert.equal(conflictOf('Slash', 'newTask', p0).id, 'search');
  const p1 = prefs(assignPatch('newTask', 'Slash', p0).shortcuts);
  assert.equal(bindingOf('newTask', p1), 'Slash');
  assert.equal(bindingOf('search', p1), null, 'у «Поиска» сочетание снято');
  const p2 = prefs(assignPatch('newTask', 'KeyN', p1).shortcuts);
  assert.ok(!('newTask' in p2.shortcuts), 'вернули умолчание — переназначение убрано');
  assert.equal(p2.shortcuts.search, '', '«Поиск» остаётся отключённым, пока его не вернут');
  const p3 = prefs(assignPatch('pull', null, p0).shortcuts);
  assert.deepEqual(p3.shortcuts, {}, 'отключить то, что и так не назначено, — ничего не менять');
  assert.equal(bindingMap(p1).get('Slash'), 'newTask');
});

test('клавиши: при вводе текста и в открытом окне — только с Ctrl/Alt/⌘; выключены — ничего', () => {
  const p = prefs();
  assert.equal(actionFor(ev('KeyN'), { prefs: p }), 'newTask');
  assert.equal(actionFor(ev('KeyN', {}, { tagName: 'INPUT' }), { prefs: p }), null);
  assert.equal(actionFor(ev('KeyN', {}, { tagName: 'DIV', isContentEditable: true }), { prefs: p }), null);
  assert.equal(actionFor(ev('KeyN'), { prefs: p, overlay: true }), null);
  const push = SHORTCUTS.find((s) => s.id === 'push').def;
  const mods = { ctrlKey: push.includes('Ctrl'), metaKey: push.includes('Meta') };
  assert.equal(actionFor(ev('KeyS', mods, { tagName: 'TEXTAREA' }), { prefs: p }), 'push');
  assert.equal(actionFor(ev('Slash', { shiftKey: true }), { prefs: p }), 'help');
  assert.equal(actionFor(ev('KeyN'), { prefs: prefs({}, false) }), null);
  assert.equal(actionFor({ ...ev('KeyN'), defaultPrevented: true }, { prefs: p }), null);
  recorder.active = true;
  assert.equal(actionFor(ev('KeyN'), { prefs: p }), null, 'пока записывают сочетание — молчим');
  recorder.active = false;
});

test('клавиши 0.16: списки и док по умолчанию как в license-store, несколько сочетаний на действие', () => {
  const p0 = prefs();
  assert.deepEqual(['listDown', 'listUp', 'listOpen', 'listClose', 'menuUp', 'menuDown'].map((id) => bindingOf(id, p0)),
    ['KeyS', 'KeyW', 'KeyD', 'KeyA', 'KeyQ', 'KeyE']);
  assert.deepEqual(bindingsOf('menuActivate', p0), ['Enter', 'Space']);
  assert.equal(actionFor(ev('KeyS'), { prefs: p0 }), 'listDown');
  assert.equal(actionFor(ev('Enter'), { prefs: p0 }), 'menuActivate');
  assert.equal(actionFor(ev('KeyS', {}, { tagName: 'INPUT' }), { prefs: p0 }), null, 'при вводе текста S — это буква');
  assert.ok(isReserved('Enter') && !isReserved('Enter', 'menuActivate'), 'Enter разрешён только «открыть пункт»');

  // добавить второе сочетание: оба работают; занятое другим действием переходит сюда
  const p1 = prefs(addPatch('listDown', 'ArrowDown', p0).shortcuts);
  assert.deepEqual(bindingsOf('listDown', p1), ['KeyS', 'ArrowDown']);
  assert.equal(actionFor(ev('ArrowDown'), { prefs: p1 }), 'listDown');
  const p2 = prefs(addPatch('listDown', 'KeyW', p1).shortcuts);
  assert.deepEqual(bindingsOf('listDown', p2), ['KeyS', 'ArrowDown', 'KeyW']);
  assert.deepEqual(bindingsOf('listUp', p2), [], 'у «Предыдущей строки» W снято');
  assert.equal(p2.shortcuts.listUp, '');
  // убрать одно — остальные на месте; вернулись к умолчанию — переназначение исчезает
  const p3 = prefs(removePatch('listDown', 'ArrowDown', p2).shortcuts);
  assert.deepEqual(bindingsOf('listDown', p3), ['KeyS', 'KeyW']);
  const p4 = prefs(removePatch('listDown', 'KeyW', p3).shortcuts);
  assert.ok(!('listDown' in p4.shortcuts), 'остались одни умолчания');
  // «открыть пункт»: убрать Пробел — остаётся Enter строкой; старая запись строкой читается как раньше
  const p5 = prefs(removePatch('menuActivate', 'Space', p0).shortcuts);
  assert.equal(p5.shortcuts.menuActivate, 'Enter');
  assert.deepEqual(bindingsOf('newTask', prefs({ newTask: 'Ctrl+KeyM' })), ['Ctrl+KeyM']);
  assert.deepEqual(bindingsOf('newTask', prefs({ newTask: ['KeyM', 'KeyM', 7, ''] })), ['KeyM'], 'мусор в списке отбрасывается');
});

test('настройки 0.16: чужие значения дока и панели отбрасываются, числа — в пределах', () => {
  const c = cleanPrefs({ dock: 'middle', dockSubMode: 'inline', dockGrow: 'sideways', dockPush: 'all', dockWidth: 9999, panelWidth: 10,
    dockSize: 'big', panelPush: 'yes', expanded: false });
  assert.ok(!('dock' in c) && !('dockGrow' in c) && !('dockSize' in c) && !('panelPush' in c));
  assert.equal(c.dockSubMode, 'inline');
  assert.equal(c.dockPush, 'all');
  assert.equal(c.dockWidth, DOCK_WIDTH_MAX);
  assert.equal(c.panelWidth, PANEL_MIN);
  assert.equal(c.expanded, false);
  assert.equal(cleanPrefs({ dock: null }).dock, null, 'null — «по устройству»');
});

test('клавиши списков: курсор ходит по видимым строкам основной области, по краям стоит, другой экран — сначала', () => {
  const main = document.createElement('main');
  main.id = 'main';
  main.innerHTML = '<div data-row="task:a">a</div><div data-row="task:b" style="display:none">b</div>'
    + '<div data-row="entry:c">c</div><div data-row="food:d">d</div>';
  document.body.append(main);
  const at = () => main.querySelector('[data-cursor]')?.dataset.row ?? null;
  try {
    syncCursor('test-1');
    assert.equal(at(), null);
    assert.ok(moveCursor(1));
    assert.equal(at(), 'task:a', 'первое «вниз» — на первую строку');
    moveCursor(1);
    assert.equal(at(), 'entry:c', 'скрытая строка пропускается');
    moveCursor(1);
    moveCursor(1);
    assert.equal(at(), 'food:d', 'дальше последней не уходит');
    moveCursor(-1);
    assert.equal(at(), 'entry:c');
    // строку перерисовали заново — подсветка возвращается
    const fresh = main.querySelector('[data-row="entry:c"]').cloneNode(true);
    fresh.removeAttribute('data-cursor');
    main.querySelector('[data-row="entry:c"]').replaceWith(fresh);
    syncCursor('test-1');
    assert.equal(at(), 'entry:c');
    syncCursor('test-2');
    assert.equal(at(), null, 'на другом экране курсор сброшен');
    moveCursor(-1);
    assert.equal(at(), 'food:d', 'первое «вверх» — на последнюю строку');
    main.innerHTML = '';
    assert.ok(!moveCursor(1) && !openCursor(), 'строк нет — нажатие не наше');
  } finally {
    syncCursor('test-done');
    main.remove();
  }
});

// ---------- Массовые действия ----------

const HOME = '00000000-0000-7000-8000-000000000105';
const UNI = '00000000-0000-7000-8000-000000000102';
const HIGH = '00000000-0000-7000-8000-000000000203';

/** Действия над store в памяти: запись в базу — заглушка, без рассылки другим вкладкам. */
async function withStore(fn) {
  const saved = { data: store.data, version: store.version, ui: { ...store.ui }, now: store.now, deviceId: store.deviceId };
  const BC = self.BroadcastChannel;
  delete self.BroadcastChannel;
  let k = 0;
  try {
    store.data = makeData();
    store.data.settings.gameEnabled = true;
    store.now = { today: '2026-10-06', time: '12:00', ms: Date.parse('2026-10-06T09:00:00.000Z') };
    store.ui.readOnly = null;
    A.initActions({
      repo: { commit: async () => {}, dirtyCount: async () => 0, logError() {}, get: async () => null },
      clock: { stamp: () => '0000000000001-' + String(k++).padStart(4, '0') + '-test', get last() { return ''; } },
      deviceId: 'bulk-test',
    });
    await fn();
  } finally {
    if (BC) self.BroadcastChannel = BC;
    Object.assign(store, { data: saved.data, version: saved.version, now: saved.now, deviceId: saved.deviceId });
    Object.assign(store.ui, saved.ui);
  }
}

const byTitle = (title) => [...store.data.tasks.values()].find((t) => t.title === title);
const create = async (input) => {
  await A.createTask(input);
  return byTitle(input.title);
};

test('массовые действия: выполнить, вернуть, в корзину с подзадачами, восстановить, удалить навсегда', async () => {
  await withStore(async () => {
    const a = await create({ title: 'Первая', listIds: [HOME], priorityId: HIGH });
    const b = await create({ title: 'Вторая' });
    const parent = await create({ title: 'Родитель' });
    await A.addChild(parent.id, 'Ребёнок');
    const rep = await create({ title: 'Повтор', repeat: makeRule({ kind: 'daily' }, '2026-10-01') });

    let r = await A.bulkTasks('complete', [a.id, b.id, rep.id, 'нет-такой']);
    assert.deepEqual([r.total, r.succeeded], [4, 2]);
    assert.deepEqual(r.failed.map((f) => f.code).sort(), ['NOT_FOUND', 'REPEATING']);
    assert.equal(byTitle('Первая').status, 'done');
    assert.ok([...store.data.coinEvents.values()].some((e) => e.taskId === a.id && e.active), 'монеты начислены');
    assert.ok(store.ui.snackbar.text.startsWith('Выполнено: 2 из 4'));

    r = await A.bulkTasks('complete', [a.id]);
    assert.deepEqual(r.failed.map((f) => f.code), ['ALREADY_DONE']);
    r = await A.bulkTasks('reopen', [a.id, parent.id]);
    assert.deepEqual([r.succeeded, r.failed[0].code], [1, 'NOT_DONE']);
    assert.equal(byTitle('Первая').status, 'active');
    assert.ok(![...store.data.coinEvents.values()].some((e) => e.taskId === a.id && e.active), 'монеты вернулись');

    r = await A.bulkTasks('trash', [parent.id, b.id]);
    assert.equal(r.succeeded, 2);
    assert.ok(byTitle('Ребёнок').trashedAt && byTitle('Ребёнок').trashedAt === byTitle('Родитель').trashedAt, 'подзадача — вместе с родителем');
    r = await A.bulkTasks('trash', [b.id]);
    assert.equal(r.failed[0].code, 'IN_TRASH');
    r = await A.bulkTasks('restore', [parent.id, a.id]);
    assert.deepEqual([r.succeeded, r.failed[0].code], [1, 'NOT_IN_TRASH']);
    assert.ok(!byTitle('Ребёнок').trashedAt, 'восстановилась вместе с родителем');

    r = await A.bulkTasks('purge', [b.id]);
    assert.equal(r.succeeded, 1);
    assert.ok(store.data.tasks.get(b.id).deletedAt, 'надгробие');
    r = await A.bulkTasks('purge', [b.id]);
    assert.equal(r.failed[0].code, 'NOT_FOUND');
  });
});

test('массовые действия: перенести в список и сменить приоритет; «и так такие» — не ошибка, а отказ с причиной', async () => {
  await withStore(async () => {
    const a = await create({ title: 'А', listIds: [HOME, UNI] });
    const b = await create({ title: 'Б' });
    let r = await A.bulkTasks('move', [a.id, b.id], UNI);
    assert.equal(r.succeeded, 2);
    assert.deepEqual(Object.entries(byTitle('А').lists).filter(([, v]) => v.in).map(([k]) => k), [UNI]);
    assert.ok(byTitle('Б').lists[UNI].in);
    r = await A.bulkTasks('move', [b.id], UNI);
    assert.equal(r.failed[0].code, 'UNCHANGED');
    r = await A.bulkTasks('move', [a.id], null);
    assert.ok(!Object.values(byTitle('А').lists).some((v) => v.in), 'во «Входящие» — без списков');
    r = await A.bulkTasks('priority', [a.id, b.id], HIGH);
    assert.equal(r.succeeded, 2);
    assert.equal(byTitle('Б').priorityId, HIGH);
    r = await A.bulkTasks('priority', [b.id], HIGH);
    assert.equal(r.failed[0].code, 'UNCHANGED');
  });
});
