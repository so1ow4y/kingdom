// Действия Crimson Harvest (счётчик калорий; 0.11 — «Feast»): все изменения его данных. Как store/actions.js у задач:
// одна транзакция IndexedDB на действие, «непушнутые» ключи, «Отменить», рассылка другим вкладкам.
// 0.12: рационы (общие и на день), заметки к рационам, записи из нескольких продуктов со временем и заметкой.

import { store, bumpData, setUi, showSnackbar, confirm } from './appState.js';
import { touch, tombstone, revert } from '../core/model.js';
import { keyForIndex } from '../core/order.js';
import * as F from '../core/feast.js';
import * as B from '../core/body.js';
import * as V from '../core/village.js';
import { uuidv7 } from '../core/ids.js';
import { normalizeBarcode } from '../core/barcode.js';
import { num, fmt, entryKcal, checkGoals, goalChanges, kcalGoalChanges } from '../core/nutrition.js';
import { countLabel } from '../core/plural.js';
import { FEAST_RETENTION } from '../config.js';
import { tr } from '../core/i18n.js';
import { cleanValues, partCount } from '../core/measures.js';

let repo = null;
let clock = null;

/** Удаление в корзину (0.14): надгробие в своей коллекции и снимок в корзине — вернуть можно trashDays дней. */
function trashChanges(coll, list, c0) {
  const out = [];
  for (const e of list) {
    out.push({ coll, prev: e, next: tombstone(e, c0) });
    out.push({ coll: 'trash', prev: D().trash.get(F.trashId(coll, e.id)), next: F.newTrashRecord(coll, e, c0) });
  }
  return out;
}
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
    showSnackbar(tr('Crimson Harvest только для чтения: сначала обнови приложение'));
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
    showSnackbar(tr('Не удалось сохранить: {p0}', { p0: e?.message || e }));
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
  showSnackbar(text, tr('Отменить'), () => undo(done));
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
  if (ok) showSnackbar(tr('Цели сохранены'));
  return ok;
}

/** Своя активность (0.12.2): название, описание, сколько ккал в день сверх базового обмена. Возвращает её id. */
export async function addActivity({ name, hint = '', kcal }) {
  const s = D().settings;
  const list = B.customActivities(s.activities);
  const n = F.normalizeName(name).slice(0, B.ACTIVITY_NAME_MAX);
  const k = Math.round(num(kcal));
  if (!n) {
    showSnackbar(tr('Назови активность'));
    return null;
  }
  if (!(k >= 0 && k <= B.ACTIVITY_KCAL_MAX) || !String(kcal).trim()) {
    showSnackbar(tr('Калории в день — от 0 до {ACTIVITY_KCAL_MAX}', { ACTIVITY_KCAL_MAX: B.ACTIVITY_KCAL_MAX }));
    return null;
  }
  if (list.length >= B.CUSTOM_ACTIVITY_MAX) {
    showSnackbar(tr('Своих активностей — не больше {CUSTOM_ACTIVITY_MAX}', { CUSTOM_ACTIVITY_MAX: B.CUSTOM_ACTIVITY_MAX }));
    return null;
  }
  const a = { id: 'c:' + uuidv7(Date.now()), name: n, hint: F.normalizeName(hint).slice(0, 80), kcal: k };
  const ok = await updateFeastSettings({ activities: [...list, a], activity: a.id });
  return ok ? a.id : null;
}

/** Удалить свою активность; если она выбрана — снова «Лёгкая активность». */
export async function removeActivity(id) {
  const s = D().settings;
  const list = B.customActivities(s.activities);
  const a = list.find((x) => x.id === id);
  if (!a) return false;
  const changes = { activities: list.filter((x) => x.id !== id) };
  if (s.activity === id) changes.activity = 'light';
  const c = change('settings', F.FEAST_SETTINGS_ID, (x) => touch(x, changes, ctx()));
  if (await commit([c])) {
    offerUndo(tr('Активность «{name}» удалена', { name: a.name }), [c]);
    return true;
  }
  return false;
}

/** Только лимит калорий («Сделать лимитом»): доли пересчитывают граммы сами, заданные граммы — проверяются. */
export async function setKcalGoal(kcal) {
  const r = kcalGoalChanges(D().settings, kcal);
  if (!r.ok) {
    showSnackbar(tr('{error}. Поправь БЖУ: Настройки → Цели и лимиты.', { error: r.error }));
    return false;
  }
  const ok = await updateFeastSettings(r.changes);
  if (ok) showSnackbar(tr('Лимит — {kcalGoal} ккал', { kcalGoal: r.changes.kcalGoal }));
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
    showSnackbar(tr('Этот штрихкод уже привязан'));
    return false;
  }
  const changes = [];
  if (other) {
    const ok = await confirm({
      title: tr('Штрихкод уже занят'),
      text: tr('Код {code} привязан к «{name}». Перенести его сюда?', { code, name: other.name }),
      confirmLabel: tr('Перенести'),
    });
    if (!ok) return false;
    changes.push(change('foods', other.id, (f) => F.setBarcode(f, code, false, ctx())));
  }
  changes.push(change('foods', foodId, (f) => F.setBarcode(f, code, true, ctx())));
  if (await commit(changes)) {
    offerUndo(tr('Штрихкод {code} привязан', { code }), changes);
    return true;
  }
  return false;
}

export async function detachBarcode(foodId, code) {
  const c = change('foods', foodId, (f) => F.setBarcode(f, code, false, ctx()));
  if (await commit([c])) offerUndo(tr('Штрихкод {code} отвязан', { code }), [c]);
}

export async function toggleFavorite(id) {
  const f = D().foods.get(id);
  if (f) await commit([change('foods', id, (x) => touch(x, { favorite: !x.favorite }, ctx()))]);
}

/** Удалить продукты (записи дневника остаются — в них снимок продукта). */
export async function deleteFoods(ids) {
  const list = ids.map((id) => D().foods.get(id)).filter((f) => f && !f.deletedAt);
  if (!list.length) return null;
  const changes = trashChanges('foods', list, ctx());
  if (await commit(changes)) {
    offerUndo(list.length === 1 ? tr('«{p0}» — в корзине', { p0: list[0].name }) : tr('В корзину: {p0}', { p0: countLabel(list.length, ['позиция', 'позиции', 'позиций']) }), changes);
    return { total: ids.length, succeeded: list.length, failed: [] };
  }
  return null;
}

/** Копия продукта (без штрихкодов: код принадлежит одному продукту). */
export async function duplicateFood(id) {
  const f = D().foods.get(id);
  if (!f) return null;
  const copy = await createFood({ name: f.name + tr(' (копия)'), brand: f.brand, unit: f.unit, servingName: f.servingName, servingSize: f.servingSize,
    nutrients: f.nutrients, kind: f.kind || 'food', dose: f.dose, note: f.note, parts: f.parts, ranges: f.ranges, desc: f.desc, icon: f.icon });
  if (copy && (f.meds?.length || f.measures?.length)) await updateFood(copy.id, { meds: f.meds || [], measures: f.measures || [] });
  return copy;
}

// ---------- Дневник ----------

/** Продукты для записи: [{ foodId, amount } | { quick: { name, nutrients }, amount }] → спецификации core/feast. */
function itemSpecs(items) {
  const out = [];
  const s = D().settings;
  // ветряная мельница, огороды и замок деревни (0.12.4) прибавляют к наградам за еду
  const boost = 1 + (store.data?.coinEvents ? V.villageBonuses(store.data).food : 0) / 100;
  const boosted = (r) => (boost === 1 ? r : Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v * boost * 100) / 100])));
  for (const it of items || []) {
    if (it.foodId) {
      const food = D().foods.get(it.foodId);
      if (!food || food.deletedAt) continue;
      // замер (0.13) — значения по частям; пустой не записывается
      if (F.isMeasure(food)) {
        const vs = cleanValues(it.values ?? it.amount, partCount(food));
        if (vs) out.push({ measure: food, values: vs, note: it.note });
        continue;
      }
      // лекарство (0.12.5) — без наград
      if (F.isMed(food)) out.push({ med: food, amount: it.amount, note: it.note });
      else out.push({ food, amount: it.amount, note: it.note, rewards: boosted(F.rewardsOf(food, s)) });
    } else if (it.quick) {
      const n = it.quick.nutrients || {};
      if (num(n.kcal) || num(n.protein) || num(n.fat) || num(n.carbs)) out.push({ quick: it.quick, amount: it.amount, note: it.note, rewards: boosted(F.rewardDefaults(s)) });
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
/** «Торт», «2 продукта», «Торт + 💊 Инсулин», «3 продукта + 💊 2 лекарства» — для уведомлений. */
function specsLabel(specs) {
  const foods = specs.filter((s) => !s.med && !s.measure);
  const meds = specs.filter((s) => s.med);
  const ms = specs.filter((s) => s.measure);
  const name = (s) => s.food?.name || s.quick?.name || s.med?.name || s.measure?.name || tr('продукт');
  const f = foods.length === 1 ? name(foods[0]) : foods.length ? productsLabel(foods.length) : '';
  const m = meds.length === 1 ? '💊 ' + name(meds[0]) : meds.length ? '💊 ' + countLabel(meds.length, ['лекарство', 'лекарства', 'лекарств']) : '';
  const x = ms.length === 1 ? '📏 ' + name(ms[0]) : ms.length ? '📏 ' + countLabel(ms.length, ['замер', 'замера', 'замеров']) : '';
  return [f, m, x].filter(Boolean).join(' + ');
}

/**
 * Новая запись дневника: рацион, время (по умолчанию — сейчас), заметка, продукты.
 * Для краткости — один продукт: { date, meal, foodId, amount }. Возвращает запись или null.
 */
export async function addEntry({ date, meal, time = store.now.time, note = '', notes = null, items = null, foodId = null, amount = null }) {
  const specs = itemSpecs(items || [{ foodId, amount }]);
  // 0.13: запись может быть просто заметкой — без продуктов
  const texts = (notes || [note]).filter((t) => String(t || '').trim());
  if (!specs.length && !texts.length) return null;
  const e = F.newEntry({ date, meal, time, note, notes, items: specs }, ctx());
  const changes = [{ coll: 'entries', prev: undefined, next: e }];
  if (await commit(changes)) {
    const rw = rewardText(F.entryRewards(e));
    const onlyMeds = !F.hasFood(e);
    if (!specs.length) {
      offerUndo(tr('📝 Заметка записана'), changes);
      return e;
    }
    offerUndo(onlyMeds ? tr('Записано: {p0}', { p0: specsLabel(specs) })
      : tr('{p0} · {p1} ккал{p2}', { p0: specs.length === 1 ? F.entryTitle(e) : tr('Записано: ') + specsLabel(specs), p1: fmt(entryKcal(e), 'kcal'), p2: rw ? ' · ' + rw : '' }), changes);
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
    offerUndo(tr('Добавлено в запись: {p0}', { p0: specsLabel(specs) }), [c]);
    return true;
  }
  return false;
}

/**
 * Сохранить запись из листа: { time, note, meal, date, amounts: { itemId: количество }, removed: [itemId] }.
 * Убрали все продукты — запись удаляется (с «Отменить»).
 */
/**
 * entryNotes (0.12.5) — заметки записи: { edits: { id: текст } (пусто — убрать), added: [текст] }.
 */
export async function saveEntry(id, { amounts = {}, values = {}, notes = {}, removed = [], entryNotes = null, ...fields }) {
  const c = changeEntry(id, (e, c0) => {
    let next = F.editEntry(e, fields, c0);
    if (entryNotes) {
      const cur = new Map(F.entryNoteList(next).map((n) => [n.id, n.text]));
      for (const [nid, text] of Object.entries(entryNotes.edits || {})) {
        if ((cur.get(nid) ?? '') !== String(text || '')) next = F.editEntryNote(next, nid, text, c0);
      }
      for (const text of entryNotes.added || []) next = F.addEntryNote(next, text, c0);
    }
    for (const [itemId, a] of Object.entries(amounts)) {
      const it = (next.items || []).find((x) => x.id === itemId);
      if (it && !it.deletedAt && num(a) && num(a) !== it.amount) next = F.setItemAmount(next, itemId, a, c0);
    }
    for (const [itemId, vs] of Object.entries(values)) {
      const it = (next.items || []).find((x) => x.id === itemId);
      if (it && !it.deletedAt && JSON.stringify(it.values || []) !== JSON.stringify(vs)) next = F.setItemValues(next, itemId, vs, c0);
    }
    for (const [itemId, text] of Object.entries(notes)) {
      const it = (next.items || []).find((x) => x.id === itemId);
      if (it && !it.deletedAt && (it.note || '') !== String(text || '')) next = F.setItemNote(next, itemId, text, c0);
    }
    for (const itemId of removed) next = F.removeItem(next, itemId, c0);
    return next;
  });
  if (!c) return false;
  // без продуктов и без заметок запись не нужна (0.13: заметка без продуктов — тоже запись)
  if (!F.entryItems(c.next).length && !F.entryNoteList(c.next).length) return deleteEntries([id], tr('Запись удалена: в ней не осталось продуктов'));
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
  const changes = trashChanges('entries', ids.map((id) => D().entries.get(id)).filter((e) => e && !e.deletedAt), ctx());
  if (await commit(changes)) {
    offerUndo(text || (changes.length === 1 ? tr('Запись удалена') : tr('Удалено записей: {length}', { length: changes.length })), changes);
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
    changes.push({ coll: 'entries', prev: undefined, next: F.newEntry({ date: toDate, meal: m, time: e.time, notes: F.entryNoteList(e).map((n) => n.text), items }, c0) });
  }
  if (await commit(changes)) offerUndo(tr('Скопировано: {p0}', { p0: countLabel(src.length, ['запись', 'записи', 'записей']) }), changes);
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
    offerUndo(tr('Рацион «{name}» {p1}', { name: F.mealName(m), p1: m.date ? tr('добавлен на этот день') : tr('добавлен') }), changes);
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
  if (await commit([c])) offerUndo(hidden ? tr('Рацион скрыт: в новых днях его нет, старые записи на месте') : tr('Рацион снова показывается'), [c]);
}

/** Удалить рацион (основные — только скрыть). Записи в нём и заметки к нему удаляются вместе с ним — с вопросом. */
export async function deleteMeal(id) {
  const m = D().meals.get(id);
  if (!m || m.deletedAt || F.isDefaultMeal(m)) return false;
  const entries = [...D().entries.values()].filter((e) => !e.deletedAt && e.meal === id);
  if (entries.length) {
    const ok = await confirm({
      title: tr('Удалить рацион «{name}»?', { name: F.mealName(m) }),
      text: tr('В нём {p0} — они удалятся вместе с ним. Можно будет отменить.', { p0: countLabel(entries.length, ['запись', 'записи', 'записей']) }),
      confirmLabel: tr('Удалить'),
      danger: true,
    });
    if (!ok) return false;
  }
  const c0 = ctx();
  const changes = [...trashChanges('meals', [m], c0), ...trashChanges('entries', entries, c0)];
  for (const n of D().mealNotes.values()) if (!n.deletedAt && n.meal === id) changes.push({ coll: 'mealNotes', prev: n, next: tombstone(n, c0) });
  if (await commit(changes)) {
    offerUndo(tr('Рацион «{name}» удалён', { name: F.mealName(m) }), changes);
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
  for (const k of F.BODY_NUM_FIELDS) if (k in values) clean[k] = num(values[k]) || null;
  if ('note' in values) clean.note = String(values.note || '').slice(0, 500);
  if (cur) return commit([change('body', cur.id, (b) => touch(b, clean, ctx()))]);
  if (!Object.values(clean).some((v) => v)) return false;
  return commit([{ coll: 'body', prev: undefined, next: F.newBodyLog({ date, ...clean }, ctx()) }]);
}

export async function deleteBodyLog(id) {
  const b = D().body.get(id);
  if (!b || b.deletedAt) return;
  const changes = trashChanges('body', [b], ctx());
  if (await commit(changes)) offerUndo(tr('Замер удалён'), changes);
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
    if (interactive) showSnackbar(tr('Удалять нечего: записей меньше лимита'));
    return 0;
  }
  if (interactive) {
    const ok = await confirm({
      title: tr('Удалить старые записи?'),
      text: tr('{p0} за {p1} ', { p0: countLabel(plan.entries.length, ['запись', 'записи', 'записей']), p1: countLabel(plan.dates.length, ['день', 'дня', 'дней']) })
        + tr('(с {p0} по {p1}) удалятся. Итоги этих дней останутся в аналитике.', { p0: plan.dates[0], p1: plan.dates.at(-1) }),
      confirmLabel: tr('Удалить'),
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
  if (interactive) showSnackbar(tr('Удалено {p0}, итоги дней сохранены', { p0: countLabel(plan.entries.length, ['запись', 'записи', 'записей']) }));
  return plan.entries.length;
}

export const entryLimitRange = () => [FEAST_RETENTION.entryMin, FEAST_RETENTION.entryMax];

// ---------- Корзина (0.14) ----------

/** Вернуть из корзины: сущность — со свежими метками (на всех устройствах), запись корзины — убрать. */
export async function restoreTrash(ids) {
  const c0 = ctx();
  const changes = [];
  let n = 0;
  for (const id of ids) {
    const r = D().trash.get(id);
    if (!r || r.deletedAt || !D()[r.coll]) continue;
    const cur = D()[r.coll].get(r.entityId);
    if (!cur || cur.deletedAt) changes.push({ coll: r.coll, prev: cur, next: F.restoreEntity(cur, r.snapshot, c0) });
    changes.push({ coll: 'trash', prev: r, next: tombstone(r, c0) });
    n++;
  }
  if (!(await commit(changes))) return 0;
  offerUndo(n === 1 ? tr('Возвращено') : tr('Возвращено: {n}', { n }), changes);
  return n;
}

/** Удалить из корзины навсегда (без вопроса — спрашивает экран). */
export async function deleteTrashForever(ids) {
  const c0 = ctx();
  const changes = ids.map((id) => D().trash.get(id)).filter((r) => r && !r.deletedAt).map((r) => ({ coll: 'trash', prev: r, next: tombstone(r, c0) }));
  return (await commit(changes)) ? changes.length : 0;
}

/** Очистить корзину целиком (с вопросом). */
export async function emptyFeastTrash() {
  const list = F.trashList(D());
  if (!list.length) return 0;
  const ok = await confirm({
    title: tr('Очистить корзину?'),
    text: tr('{p0} удалятся навсегда — вернуть их будет нельзя.', { p0: countLabel(list.length, ['позиция', 'позиции', 'позиций']) }),
    confirmLabel: tr('Очистить'),
    danger: true,
  });
  if (!ok) return 0;
  const n = await deleteTrashForever(list.map((r) => r.id));
  if (n) showSnackbar(tr('Корзина очищена'));
  return n;
}

/** Корзина старше срока — навсегда (при запуске и при открытии корзины). */
export async function purgeFeastTrash(nowMs = Date.now()) {
  if (!D().settings || store.ui.feastReadOnly) return 0;
  const old = F.trashExpired(D(), nowMs);
  return old.length ? deleteTrashForever(old.map((r) => r.id)) : 0;
}

/** Срок корзины, дней (1…365). */
export async function setTrashDays(v) {
  const n = Math.round(num(v));
  if (!n) return false;
  const ok = await updateFeastSettings({ trashDays: Math.max(FEAST_RETENTION.trashMin, Math.min(FEAST_RETENTION.trashMax, n)) });
  if (ok) purgeFeastTrash();
  return ok;
}

// ---------- Срок хранения истории (0.14) ----------

/** Что удалит срок хранения days: записи и сводки дней старше него. */
export const historyPreview = (days, today = store.now.today) => F.historyPlan(D(), today, days ? F.historyDaysOf({ historyDays: days }) : null);

/**
 * Применить срок хранения истории: записи и статистика дней старше срока удаляются, награды за еду остаются
 * (монеты и 💎 не пропадают). interactive — спросить; без вопроса — при запуске, если срок задан.
 */
export async function purgeHistory({ interactive = false, today = store.now.today, days = undefined } = {}) {
  if (!D().settings || store.ui.feastReadOnly) return 0;
  const plan = days === undefined ? F.historyPlan(D(), today) : historyPreview(days, today);
  if (!plan.entries.length && !plan.archives.some((a) => !a.stripped)) return 0;
  if (interactive) {
    const ok = await confirm({
      title: tr('Удалить историю старше {p0}?', { p0: plan.cutoff }),
      text: tr('Удалятся {p0} и статистика {p1}. Монеты и 💎, полученные за еду, останутся. Вернуть нельзя.', {
        p0: countLabel(plan.entries.length, ['запись', 'записи', 'записей']),
        p1: countLabel(new Set([...plan.entries.map((e) => e.date), ...plan.archives.filter((a) => !a.stripped).map((a) => a.date)]).size, ['дня', 'дней', 'дней']),
      }),
      confirmLabel: tr('Удалить'),
      danger: true,
    });
    if (!ok) return -1;
  }
  const c0 = ctx();
  const byDate = new Map();
  for (const e of plan.entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  for (const a of plan.archives) if (!a.stripped && !byDate.has(a.date)) byDate.set(a.date, []);
  const changes = [];
  for (const [date, list] of byDate) {
    const prev = D().dayArchive.get(F.archiveId(date));
    const next = F.strippedArchive(date, list, prev && !prev.deletedAt ? prev : null, c0);
    if (next) changes.push({ coll: 'dayArchive', prev, next });
    else if (prev && !prev.deletedAt) changes.push({ coll: 'dayArchive', prev, next: tombstone(prev, c0) });
    for (const e of list) changes.push({ coll: 'entries', prev: e, next: tombstone(e, c0) });
  }
  if (!(await commit(changes))) return 0;
  if (interactive) showSnackbar(tr('История старше {p0} удалена', { p0: plan.cutoff }));
  return plan.entries.length + plan.archives.length;
}

/** Срок хранения истории: пусто или 0 — всегда; меньше — с вопросом, если что-то удалится. */
export async function setHistoryDays(v) {
  const raw = Math.round(num(v));
  const days = raw > 0 ? Math.max(FEAST_RETENTION.historyMin, Math.min(FEAST_RETENTION.historyMax, raw)) : null;
  if (days) {
    const r = await purgeHistory({ interactive: true, days });
    if (r < 0) return false;
  }
  return updateFeastSettings({ historyDays: days });
}

// ---------- Перенос продукта между записями (0.14.1) ----------

/**
 * Перенести один продукт (лекарство, замер) из записи в другую запись (to.entryId) или отдельной записью в рацион
 * (to.meal). Время и рацион — у целевой записи; запись, в которой ничего не осталось, удаляется. С «Отменить».
 */
export async function moveEntryItem(fromId, itemId, to = {}) {
  const from = D().entries.get(fromId);
  if (!from || from.deletedAt) return false;
  const target = to.entryId ? D().entries.get(to.entryId) : null;
  if (to.entryId && (!target || target.deletedAt || target.id === fromId)) return false;
  // единственный продукт без заметок и так отдельной записью в этом рационе — переносить нечего
  if (!to.entryId && (to.meal || from.meal) === from.meal && F.entryItems(from).length === 1 && !F.entryNoteList(from).length) return false;
  const c0 = ctx();
  const fromBase = F.upgradeEntry(from, c0);
  const toBase = target ? F.upgradeEntry(target, c0) : null;
  const res = F.moveItem(fromBase, itemId, toBase, c0, { meal: to.meal || null });
  if (!res) return false;
  const changes = [
    F.isEmptyEntry(res.from) ? { coll: 'entries', prev: from, base: fromBase, next: tombstone(res.from, c0) } : { coll: 'entries', prev: from, base: fromBase, next: res.from },
    target ? { coll: 'entries', prev: target, base: toBase, next: res.to } : { coll: 'entries', prev: undefined, next: res.to },
  ];
  if (!(await commit(changes))) return false;
  const where = target ? tr('в запись {time}', { time: target.time || F.entryTitle(target) }) : tr('отдельной записью');
  offerUndo(tr('Перенесено: «{name}» — {where}', { name: res.item.name, where }), changes);
  return true;
}
