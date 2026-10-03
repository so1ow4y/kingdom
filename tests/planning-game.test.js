import { test, assert } from './runner.js';
import { makeCtx, makeData, addTask, DEVICE } from './helpers.js';
import { planningDate } from '../src/core/planning.js';
import { sessionRevoked } from '../src/core/sessions.js';
import { todayView } from '../src/core/selectors.js';
import { gameStats, COSMETICS, purchaseEvent, ownsItem, balance } from '../src/core/game.js';
import { newList, tombstone, touch, newDevice } from '../src/core/model.js';
import { archiveRecord } from '../src/core/retention.js';
import { mergeData } from '../src/core/merge.js';

test('планирование: валидная дата, високосный год и повреждённый URL', () => {
  for (const input of ['', null, 'bad', '2026-02-29', '2026-13-01', '2026-10-03junk']) assert.equal(planningDate(input, '2026-10-03'), '2026-10-03');
  assert.equal(planningDate('2028-02-29', '2026-10-03'), '2028-02-29');
  assert.equal(planningDate('2026-12-31', '2026-10-03'), '2026-12-31');
});

test('выбранный день: задача с прежней датой и дедлайном в этот день не пропадает', () => {
  const d = makeData(), c = makeCtx();
  const t = addTask(d, c, {title:'Дедлайн', scheduledDate:'2026-10-01', deadlineDate:'2026-10-04'});
  const view = todayView(d, '2026-10-04', '00:00', Date.parse('2026-10-04T12:00Z'), true);
  assert.ok(view.today.some(x => x.id === t.id));
  assert.equal(view.overdue.length, 0);
  assert.ok(todayView(d, '2026-10-04', '12:00').overdue.some(x => x.id === t.id));
});

test('выбранный день: главное и историческое выполнение относятся к выбранной дате', () => {
  const d = makeData(), c = makeCtx();
  addTask(d, c, {title:'Главное'}, {focusDate:'2026-09-01'});
  addTask(d, c, {title:'Сделано'}, {status:'done', completedAt:'2026-09-01T08:00:00Z'});
  addTask(d, c, {title:'Завтра', scheduledDate:'2026-09-02'});
  const v = todayView(d, '2026-09-01', '00:00', Date.parse('2026-09-01T12:00Z'), true);
  assert.equal(v.focus.length, 1);
  assert.equal(v.doneToday.length, 1);
  assert.equal(v.today.length, 0);
});

test('новый список автоматически получает 4 достижения со стабильными id', () => {
  const d = makeData(), c = makeCtx();
  const l = newList({name:'Экспедиция', color:'#123456', emoji:'🧭', order:'a9'}, c);
  d.lists.set(l.id,l);
  const get = () => gameStats(d,'UTC','2026-10-02').achievements.filter(a => a.group === l.id);
  const ids = get().map(a => a.id);
  assert.equal(ids.length,4);
  assert.ok(get().every(a => !a.unlocked && a.progress === 0));
  d.lists.set(l.id,touch(l,{name:'Новая экспедиция'},c));
  assert.deepEqual(get().map(a => a.id),ids);
  assert.ok(get().every(a => a.groupName === 'Новая экспедиция'));
});

test('достижения списка учитывают сохранённую сводку и не дублируют живую задачу', () => {
  const d = makeData(), c = makeCtx(), listId = [...d.lists.keys()][0];
  const t = addTask(d,c,{title:'Квест',listIds:[listId]}, {status:'done', completedAt:'2026-10-02T08:00:00Z'});
  d.doneArchive.set(t.id,archiveRecord(d,t));
  const get = () => gameStats(d,'UTC','2026-10-02');
  assert.equal(get().done,1);
  d.tasks.set(t.id,tombstone(t,c));
  assert.equal(get().done,1);
  assert.ok(get().achievements.find(a => a.id === `list:${listId}:1`).unlocked);
  assert.equal(get().achievements.find(a => a.id === `list:${listId}:10`).progress,1);
});

test('неудачи исправляются, не начисляют и не списывают монет', () => {
  const d = makeData(), c = makeCtx();
  const t = addTask(d,c,{title:'Опоздал',scheduledDate:'2026-10-01'});
  assert.ok(gameStats(d,'UTC','2026-10-02').achievements.find(a => a.id === 'overdue').unlocked);
  d.tasks.set(t.id,touch(t,{scheduledDate:'2026-10-03'},c));
  assert.ok(!gameStats(d,'UTC','2026-10-02').achievements.find(a => a.id === 'overdue').unlocked);
  assert.equal(balance(d),0);
});

test('косметика: уникальные товары, положительные цены и возврат права владения', () => {
  assert.equal(new Set(COSMETICS.map(c => c.id)).size,COSMETICS.length);
  assert.ok(COSMETICS.every(c => Number.isInteger(c.price) && c.price > 0));
  const d = makeData(), c = makeCtx();
  const e = purchaseEvent({price:160,title:'Лиса',itemId:'pet:fox'},c);
  d.coinEvents.set(e.id,e);
  assert.ok(ownsItem(d,'pet:fox'));
  d.coinEvents.set(e.id,touch(e,{active:false},c));
  assert.ok(!ownsItem(d,'pet:fox'));
  assert.equal(balance(d),0);
});

test('сессии: удалённое устройство блокируется до нового явного входа', () => {
  const c = makeCtx();
  const d = newDevice({id:DEVICE,name:'Комп',platform:'other',appVersion:'0.6.0'},c);
  const removed = tombstone(d,c);
  assert.ok(!sessionRevoked([d],DEVICE));
  assert.ok(sessionRevoked([removed],DEVICE));
  assert.ok(sessionRevoked([removed],DEVICE,c.now));
  assert.ok(!sessionRevoked([removed],DEVICE,c.now+1));
  assert.ok(!sessionRevoked([removed],'another-device'));
});

test('сессии: удаление передаётся слиянием, повторный вход создаёт полноценную запись', () => {
  const c = makeCtx();
  const d = newDevice({id:DEVICE,name:'Комп',platform:'other',appVersion:'0.6.0'},c);
  c.now += 100;
  const removed = tombstone(d,c);
  const merged = mergeData({devices:[d]},{devices:[removed]});
  assert.ok(sessionRevoked(merged.devices,DEVICE));
  c.now += 100;
  const restored = newDevice({id:DEVICE,name:'Комп',platform:'other',appVersion:'0.6.0'},c);
  const again = mergeData({devices:[restored]},{devices:[removed]});
  assert.ok(!sessionRevoked(again.devices,DEVICE));
  assert.equal(again.devices[0].name,'Комп');
});
