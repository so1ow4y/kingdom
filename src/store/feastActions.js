// Действия Crimson Harvest (счётчик калорий; 0.11 — «Feast»): все изменения его данных. Как store/actions.js у задач:
// одна транзакция IndexedDB на действие, «непушнутые» ключи, «Отменить», рассылка другим вкладкам.
// 0.12: рационы (общие и на день), заметки к рационам, записи из нескольких продуктов со временем и заметкой.

import { store, bumpData, setUi, showSnackbar, confirm } from './appState.js';
import { touch, tombstone, revert } from '../core/model.js';
import { keyForIndex } from '../core/order.js';
import * as F from '../core/feast.js';
import { normalizeBarcode } from '../core/barcode.js';
import { num, fmt, entryKcal, checkGoals, goalChanges, kcalGoalChanges } from '../core/nutrition.js';
import { countLabel } from '../core/plural.js';
import { FEAST_RETENTION } from '../config.js';

let repo = null;
let clock = null;
let deviceId = null;
let channel = null;

export function initFeastActions(opts) {
  ({ repo, clock, deviceId } = opts);
  if ('BroadcastChannel' in self) {
    channel = new BroadcastChannel('lifetasks-feast');
    channel.onmessage = (e) => onBroadcast(e.data);
  }
}

const ctx = () => ({ now: Date.now(), stamp: () => clock.stamp(), deviceId });
const D = () => store.feast;

function getEntity(coll, id) {
  return coll === 'settings' ? D().settings : D()[coll].get(id);
}

function setEntity(coll, e) {
  if (coll === 'settings') D().settings = e;
  else D()[coll].set(e.id, e);
}

function change(coll, id, fn) {
  const prev = getEntity(coll, id);
  if (!prev) return null;
  return { coll, prev, next: fn(prev) };
}

async function commit(changes) {
  const list = changes.filter((c) => c && c.next && c.next !== c.prev);
  if (!list.length) return false;
  if (store.ui.feastReadOnly) {
    showSnackbar('Crimson Harvest только для чтения: сначала обнови приложение');
    return false;
  }
  for (const c of list) setEntity(c.coll, c.next);
  bumpData();
  try {
    await repo.commit({
      puts: list.map((c) => [c.coll, c.next]),
      dirty: list.map((c) => `${c.coll}/${c.next.id}`),
      meta: { 'clock.lastStamp': clock.last },
    });
  } catch (e) {
    for (const c of list) {
      if (c.prev) setEntity(c.coll, c.prev);
      else if (c.coll !== 'settings') D()[c.coll].delete(c.next.id);
    }
    bumpData();
    console.error(e);
    showSnackbar(`Не удалось сохранить: ${e?.message || e}`);
    return false;
  }
  refreshFeastDirty();
  channel?.postMessage({ type: 'changed', keys: list.map((c) => [c.coll, c.next.id]) });
  return true;
}

export async function refreshFeastDirty() {
  try {
    setUi({ feastDirty: await repo.dirtyCount() });
  } catch {
    // счётчик не критичен
  }
}

function offerUndo(text, changes) {
  const done = changes.filter((c) => c && c.next !== c.prev);
  if (!done.length) return showSnackbar(text);
  showSnackbar(text, 'Отменить', () => undo(done));
}

async function undo(changes) {
  const c0 = ctx();
  await commit(changes.map((c) => {
    const current = getEntity(c.coll, c.next.id);
    if (!current) return null;
    // новая сущность — отмена значит удалить её (надгробие)
    if (!c.prev) return current.deletedAt ? null : { coll: c.coll, prev: current, next: tombstone(current, c0) };
    // base — запись 0.11, уже переведённая на продукты: «Отменить» возвращает состав, а не убирает его
    return { coll: c.coll, prev: current, next: revert(current, c.base || c.prev, c0) };
  }));
}

async function onBroadcast(msg) {
  if (!msg || msg.type !== 'changed' || !repo) return;
  for (const [coll, id] of msg.keys) {
    const e = await repo.get(coll, id);
    if (e) setEntity(coll, e);
  }
  bumpData();
  refreshFeastDirty();
}

/** Для синхронизации (sync/syncEngine.js). */
export const feastHooks = {
  getEntity,
  setEntity,
  deleteEntity: (coll, id) => D()[coll].delete(id),
  broadcast: (keys) => channel?.postMessage({ type: 'changed', keys }),
};

// ---------- Настройки, цели, «Обо мне» ----------

export async function updateFeastSettings(changes) {
  return commit([change('settings', F.FEAST_SETTINGS_ID, (s) => touch(s, changes, ctx()))]);
}

/**
 * Сохранить лимит калорий и БЖУ (0.12): { kcal, mode: 'pct' | 'grams', pct, grams }. Вне границ (доли не дают 100 %,
 * граммы дают больше калорий, чем лимит) — не сохраняется.
 */
export async function saveGoals(input) {
  const check = checkGoals(input);
  if (!check.ok) {
    showSnackbar(check.error);
    return false;
  }
  const ok = await updateFeastSettings(goalChanges(input));
  if (ok) showSnackbar('Цели сохранены');
  return ok;
}

/** Только лимит калорий («Сделать лимитом»): доли пересчитывают граммы сами, заданные граммы — проверяются. */
export async function setKcalGoal(kcal) {
  const r = kcalGoalChanges(D().settings, kcal);
  if (!r.ok) {
    showSnackbar(`${r.error}. Поправь БЖУ: Настройки → Цели и лимиты.`);
    return false;
  }
  const ok = await updateFeastSettings(r.changes);
  if (ok) showSnackbar(`Лимит — ${r.changes.kcalGoal} ккал`);
  return ok;
}

// ---------- Продукты ----------

/** Новый продукт; barcode — сразу привязать. Возвращает продукт или null. */
export async function createFood(input) {
  const f = F.newFood({ ...input, barcodes: input.barcode ? [input.barcode] : input.barcodes || [] }, ctx());
  return (await commit([{ coll: 'foods', prev: undefined, next: f }])) ? f : null;
}

export async function updateFood(id, changes) {
  return commit([change('foods', id, (f) => F.editFood(f, changes, ctx()))]);
}

/**
 * Привязать штрихкод. Если код уже у другого продукта — спрашиваем и переносим (один код — один продукт).
 * Возвращает true, если привязан.
 */
export async function attachBarcode(foodId, raw) {
  const code = normalizeBarcode(raw);
  if (!code) return false;
  const other = F.findByBarcode(D(), code);
  if (other?.id === foodId) {
    showSnackbar('Этот штрихкод уже привязан');
    return false;
  }
  const changes = [];
  if (other) {
    const ok = await confirm({
      title: 'Штрихкод уже занят',
      text: `Код ${code} привязан к «${other.name}». Перенести его сюда?`,
      confirmLabel: 'Перенести',
    });
    if (!ok) return false;
    changes.push(change('foods', other.id, (f) => F.setBarcode(f, code, false, ctx())));
  }
  changes.push(change('foods', foodId, (f) => F.setBarcode(f, code, true, ctx())));
  if (await commit(changes)) {
    offerUndo(`Штрихкод ${code} привязан`, changes);
    return true;
  }
  return false;
}

export async function detachBarcode(foodId, code) {
  const c = change('foods', foodId, (f) => F.setBarcode(f, code, false, ctx()));
  if (await commit([c])) offerUndo(`Штрихкод ${code} отвязан`, [c]);
}

export async function toggleFavorite(id) {
  const f = D().foods.get(id);
  if (f) await commit([change('foods', id, (x) => touch(x, { favorite: !x.favorite }, ctx()))]);
}

/** Удалить продукты (записи дневника остаются — в них снимок продукта). */
export async function deleteFoods(ids) {
  const list = ids.map((id) => D().foods.get(id)).filter((f) => f && !f.deletedAt);
  if (!list.length) return null;
  const c0 = ctx();
  const changes = list.map((f) => ({ coll: 'foods', prev: f, next: tombstone(f, c0) }));
  if (await commit(changes)) {
    offerUndo(list.length === 1 ? `Продукт «${list[0].name}» удалён` : `Удалено ${countLabel(list.length, ['продукт', 'продукта', 'продуктов'])}`, changes);
    return { total: ids.length, succeeded: list.length, failed: [] };
  }
  return null;
}

/** Копия продукта (без штрихкодов: код принадлежит одному продукту). */
export async function duplicateFood(id) {
  const f = D().foods.get(id);
  if (!f) return null;
  return createFood({ name: f.name + ' (копия)', brand: f.brand, unit: f.unit, servingName: f.servingName, servingSize: f.servingSize, nutrients: f.nutrients });
}

// ---------- Дневник ----------

/** Продукты для записи: [{ foodId, amount } | { quick: { name, nutrients }, amount }] → спецификации core/feast. */
function itemSpecs(items) {
  const out = [];
  const s = D().settings;
  for (const it of items || []) {
    if (it.foodId) {
      const food = D().foods.get(it.foodId);
      if (food && !food.deletedAt) out.push({ food, amount: it.amount, rewards: F.rewardsOf(food, s) });
    } else if (it.quick) {
      const n = it.quick.nutrients || {};
      if (num(n.kcal) || num(n.protein) || num(n.fat) || num(n.carbs)) out.push({ quick: it.quick, amount: it.amount, rewards: F.rewardDefaults(s) });
    }
  }
  return out;
}

/** «+1 ✨ · +0,2 🪙 · +0,05 💎» — для подсказок (пусто, если игра выключена или награды нет). */
export function rewardText(r) {
  if (!store.data.settings?.gameEnabled || !F.hasRewards(r)) return '';
  return F.REWARD_KEYS.filter((k) => r[k] > 0).map((k) => `+${fmt(r[k], 'x')} ${F.REWARD_ICONS[k]}`).join(' ');
}

let earnMemo = { v: -1, value: null };
/** Всё заработанное едой (для баланса игры; пересчитывается при изменении данных). */
export function feastEarnings() {
  if (earnMemo.v !== store.version || !earnMemo.value) earnMemo = { v: store.version, value: F.feastRewards(D()) };
  return earnMemo.value;
}

const productsLabel = (n) => countLabel(n, ['продукт', 'продукта', 'продуктов']);

/**
 * Новая запись дневника: рацион, время (по умолчанию — сейчас), заметка, продукты.
 * Для краткости — один продукт: { date, meal, foodId, amount }. Возвращает запись или null.
 */
export async function addEntry({ date, meal, time = store.now.time, note = '', items = null, foodId = null, amount = null }) {
  const specs = itemSpecs(items || [{ foodId, amount }]);
  if (!specs.length) return null;
  const e = F.newEntry({ date, meal, time, note, items: specs }, ctx());
  const changes = [{ coll: 'entries', prev: undefined, next: e }];
  if (await commit(changes)) {
    const rw = rewardText(F.entryRewards(e));
    offerUndo(`${specs.length === 1 ? F.entryTitle(e) : 'Записано: ' + productsLabel(specs.length)} · ${fmt(entryKcal(e), 'kcal')} ккал${rw ? ' · ' + rw : ''}`, changes);
    return e;
  }
  return null;
}

/** Быстрая запись без продукта: { name, kcal, protein, fat, carbs }. */
export async function addQuickEntry({ date, meal, time = store.now.time, note = '', name, nutrients }) {
  return addEntry({ date, meal, time, note, items: [{ quick: { name, nutrients }, amount: 1 }] });
}

/** Изменение записи; запись 0.11 сначала переводится на продукты (base — для «Отменить»). */
function changeEntry(id, fn) {
  const prev = D().entries.get(id);
  if (!prev || prev.deletedAt) return null;
  const c0 = ctx();
  const base = F.upgradeEntry(prev, c0);
  return { coll: 'entries', prev, base, next: fn(base, c0) };
}

/** Добавить продукты в существующую запись. */
export async function addToEntry(id, items) {
  const specs = itemSpecs(items);
  if (!specs.length) return false;
  const c = changeEntry(id, (e, c0) => F.addItems(e, specs, c0));
  if (await commit([c])) {
    offerUndo(`Добавлено в запись: ${specs.length === 1 ? specs[0].food?.name || specs[0].quick?.name || 'продукт' : productsLabel(specs.length)}`, [c]);
    return true;
  }
  return false;
}

/**
 * Сохранить запись из листа: { time, note, meal, date, amounts: { itemId: количество }, removed: [itemId] }.
 * Убрали все продукты — запись удаляется (с «Отменить»).
 */
export async function saveEntry(id, { amounts = {}, removed = [], ...fields }) {
  const c = changeEntry(id, (e, c0) => {
    let next = F.editEntry(e, fields, c0);
    for (const [itemId, a] of Object.entries(amounts)) {
      const it = (next.items || []).find((x) => x.id === itemId);
      if (it && !it.deletedAt && num(a) && num(a) !== it.amount) next = F.setItemAmount(next, itemId, a, c0);
    }
    for (const itemId of removed) next = F.removeItem(next, itemId, c0);
    return next;
  });
  if (!c) return false;
  if (!F.entryItems(c.next).length) return deleteEntries([id], 'Запись удалена: в ней не осталось продуктов');
  return commit([c]);
}

/** Совместимость с 0.11: изменить количество и рацион записи из одного продукта. */
export async function updateEntry(id, changes) {
  const e = D().entries.get(id);
  if (!e) return false;
  const items = F.entryItems(e);
  const amounts = 'amount' in changes && items.length === 1 ? { [items[0].id]: changes.amount } : {};
  const { amount, ...rest } = changes;
  return saveEntry(id, { ...rest, amounts });
}

export async function deleteEntries(ids, text = null) {
  const c0 = ctx();
  const changes = ids.map((id) => D().entries.get(id)).filter((e) => e && !e.deletedAt)
    .map((e) => ({ coll: 'entries', prev: e, next: tombstone(e, c0) }));
  if (await commit(changes)) {
    offerUndo(text || (changes.length === 1 ? 'Запись удалена' : `Удалено записей: ${changes.length}`), changes);
    return true;
  }
  return false;
}

/**
 * Скопировать записи (рацион или весь день) на другую дату — «как вчера». Записи копируются с продуктами,
 * временем и заметкой; рацион «только на тот день» копируется вместе с ними.
 */
export async function copyEntries(fromDate, toDate, meal = null) {
  const byMeal = F.dayEntries(D(), fromDate);
  const src = meal ? byMeal[meal] || [] : Object.values(byMeal).flat();
  if (!src.length) return 0;
  const c0 = ctx();
  const changes = [];
  const mealMap = new Map();
  const target = F.mealsForDay(D(), toDate);
  for (const e of src) {
    let m = e.meal || 'snack';
    const info = D().meals.get(m);
    if (info && !info.deletedAt && info.date) {
      if (!mealMap.has(m)) {
        const same = target.find((x) => x.date === toDate && x.name === info.name);
        if (same) mealMap.set(m, same.id);
        else {
          const copy = F.newMeal({ name: info.name, icon: info.icon, time: info.time, order: info.order, date: toDate }, c0);
          changes.push({ coll: 'meals', prev: undefined, next: copy });
          mealMap.set(m, copy.id);
        }
      }
      m = mealMap.get(m);
    }
    // снимки продуктов копируются как есть — значения не пересчитываются по нынешней карточке
    const items = F.entryItems(e).map((it) => ({ snapshot: it }));
    changes.push({ coll: 'entries', prev: undefined, next: F.newEntry({ date: toDate, meal: m, time: e.time, note: e.note, items }, c0) });
  }
  if (await commit(changes)) offerUndo(`Скопировано: ${countLabel(src.length, ['запись', 'записи', 'записей'])}`, changes);
  return src.length;
}

// ---------- Рационы (0.12) ----------

/** Список, в котором стоит рацион: рационы дня (если день задан) или общие. */
const mealList = (date) => (date ? F.mealsForDay(D(), date).filter((m) => !m.missing) : F.globalMeals(D()));

/**
 * Новый рацион. date — день, на котором его создают (для порядка среди рационов дня); onlyDay — только на этот день;
 * afterId — вставить после этого рациона (null — в начало, undefined — в конец).
 */
export async function createMeal({ name, icon, time = null, date = null, onlyDay = false, afterId }) {
  const list = mealList(date);
  const after = afterId === undefined ? list.at(-1)?.id ?? null : afterId;
  const m = F.newMeal({ name, icon, time, order: F.orderAfter(list, after), date: onlyDay ? date : null }, ctx());
  const changes = [{ coll: 'meals', prev: undefined, next: m }];
  if (await commit(changes)) {
    offerUndo(`Рацион «${m.name}» ${m.date ? 'добавлен на этот день' : 'добавлен'}`, changes);
    return m;
  }
  return null;
}

export async function updateMeal(id, changes) {
  return commit([change('meals', id, (m) => F.editMeal(m, changes, ctx()))]);
}

/** Сдвинуть рацион на шаг выше (−1) или ниже (+1) среди рационов дня (или общих). */
export async function moveMeal(id, dir, date = null) {
  const list = mealList(date);
  const i = list.findIndex((m) => m.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return false;
  const rest = list.filter((m) => m.id !== id);
  return commit([change('meals', id, (m) => touch(m, { order: keyForIndex(rest, j) }, ctx()))]);
}

/** Скрыть общий рацион с новых дней (записи в нём остаются и видны в своих днях) или вернуть. */
export async function setMealHidden(id, hidden) {
  const c = change('meals', id, (m) => F.editMeal(m, { archived: hidden }, ctx()));
  if (await commit([c])) offerUndo(hidden ? 'Рацион скрыт: в новых днях его нет, старые записи на месте' : 'Рацион снова показывается', [c]);
}

/** Удалить рацион (основные — только скрыть). Записи в нём и заметки к нему удаляются вместе с ним — с вопросом. */
export async function deleteMeal(id) {
  const m = D().meals.get(id);
  if (!m || m.deletedAt || F.isDefaultMeal(m)) return false;
  const entries = [...D().entries.values()].filter((e) => !e.deletedAt && e.meal === id);
  if (entries.length) {
    const ok = await confirm({
      title: `Удалить рацион «${m.name}»?`,
      text: `В нём ${countLabel(entries.length, ['запись', 'записи', 'записей'])} — они удалятся вместе с ним. Можно будет отменить.`,
      confirmLabel: 'Удалить',
      danger: true,
    });
    if (!ok) return false;
  }
  const c0 = ctx();
  const changes = [{ coll: 'meals', prev: m, next: tombstone(m, c0) }];
  for (const e of entries) changes.push({ coll: 'entries', prev: e, next: tombstone(e, c0) });
  for (const n of D().mealNotes.values()) if (!n.deletedAt && n.meal === id) changes.push({ coll: 'mealNotes', prev: n, next: tombstone(n, c0) });
  if (await commit(changes)) {
    offerUndo(`Рацион «${m.name}» удалён`, changes);
    return true;
  }
  return false;
}

/** Заметка к рациону на день; пустой текст — убрать заметку. */
export async function setMealNote(date, meal, text) {
  const id = F.mealNoteId(date, meal);
  const cur = D().mealNotes.get(id);
  const clean = String(text || '').trim() ? String(text) : '';
  if (cur && !cur.deletedAt) {
    if (cur.text === clean) return false;
    return commit([change('mealNotes', id, (n) => touch(n, { text: clean }, ctx()))]);
  }
  if (!clean) return false;
  return commit([{ coll: 'mealNotes', prev: cur, next: F.newMealNote(date, meal, clean, ctx()) }]);
}

// ---------- Замеры ----------

/** Сохранить замер на дату (обновить, если на эту дату уже есть). */
export async function saveBodyLog(date, values) {
  const cur = F.bodyLogOn(D(), date);
  const clean = {};
  for (const k of ['weightKg', 'waistCm', 'neckCm', 'hipCm', 'bodyFatPct']) if (k in values) clean[k] = num(values[k]) || null;
  if ('note' in values) clean.note = String(values.note || '').slice(0, 500);
  if (cur) return commit([change('body', cur.id, (b) => touch(b, clean, ctx()))]);
  if (!Object.values(clean).some((v) => v)) return false;
  return commit([{ coll: 'body', prev: undefined, next: F.newBodyLog({ date, ...clean }, ctx()) }]);
}

export async function deleteBodyLog(id) {
  const b = D().body.get(id);
  if (!b || b.deletedAt) return;
  const changes = [{ coll: 'body', prev: b, next: tombstone(b, ctx()) }];
  if (await commit(changes)) offerUndo('Замер удалён', changes);
}

// ---------- Лимит записей ----------

/**
 * Удалить самые старые дни сверх лимита записей; их итоги остаются в сводках дней (статистика не теряется).
 * interactive — спросить перед удалением и показать итог.
 */
export async function purgeOldEntries({ interactive = false, today = store.now.today } = {}) {
  if (!D().settings) return 0;
  const plan = F.purgePlan(D(), today);
  if (!plan.entries.length) {
    if (interactive) showSnackbar('Удалять нечего: записей меньше лимита');
    return 0;
  }
  if (interactive) {
    const ok = await confirm({
      title: 'Удалить старые записи?',
      text: `${countLabel(plan.entries.length, ['запись', 'записи', 'записей'])} за ${countLabel(plan.dates.length, ['день', 'дня', 'дней'])} `
        + `(с ${plan.dates[0]} по ${plan.dates.at(-1)}) удалятся. Итоги этих дней останутся в аналитике.`,
      confirmLabel: 'Удалить',
      danger: true,
    });
    if (!ok) return 0;
  }
  const c0 = ctx();
  const changes = [];
  const byDate = new Map();
  for (const e of plan.entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  for (const [date, list] of byDate) {
    const prev = D().dayArchive.get(F.archiveId(date));
    changes.push({ coll: 'dayArchive', prev, next: F.archiveFor(date, list, prev, c0) });
    for (const e of list) changes.push({ coll: 'entries', prev: e, next: tombstone(e, c0) });
  }
  if (!(await commit(changes))) return 0;
  if (interactive) showSnackbar(`Удалено ${countLabel(plan.entries.length, ['запись', 'записи', 'записей'])}, итоги дней сохранены`);
  return plan.entries.length;
}

export const entryLimitRange = () => [FEAST_RETENTION.entryMin, FEAST_RETENTION.entryMax];
