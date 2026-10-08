// Crimson Harvest (0.11, «Feast»): лист «Записать еду» — поиск продукта, недавние и частые, количество и рацион;
// штрихкод (свой продукт найдётся сразу, нового — создаём с этим кодом), новый продукт, быстрая запись калорий.
// 0.12: запись — из нескольких продуктов («+ Ещё продукт»), со временем (по умолчанию сейчас) и заметкой.
// Лист записи дневника (продукты, время, рацион, заметка, удалить) и лист сканера для «Продуктов».

import { html, useState, useMemo } from '../html.js';
import { Icon } from '../icons.js';
import { Sheet } from './Sheet.js';
import { BarcodeScanner } from './Scanner.js';
import { MealChips, macroLine, NutrientEditor, NumField, rewardLine } from './FeastParts.js';
import { TimeInput } from './TimeInput.js';
import { store, closeSheet, openSheet, showSnackbar } from '../../store/appState.js';
import * as FA from '../../store/feastActions.js';
import * as F from '../../core/feast.js';
import {
  num, nv, fmt, scaleNutrients, sumNutrients, entryNutrients, itemNutrients, amountLabel, MACROS, NUTRIENT,
} from '../../core/nutrition.js';
import { countLabel } from '../../core/plural.js';
import { normalizeBarcode, barcodeWarning } from '../../core/barcode.js';
import { humanDate } from '../../core/dates.js';
import { foldYo } from '../../core/query.js';
import { openFood } from '../router.js';

const readOnly = () => !!store.ui.feastReadOnly;
/** autofocus у вставленных позже элементов браузер не выполняет — фокусируем сами, один раз. */
const focusOnce = (el) => {
  if (el && !el.dataset.focused) {
    el.dataset.focused = '1';
    setTimeout(() => el.focus({ preventScroll: true }), 40);
  }
};
const unitLabel = (food) => (food?.unit === 'ml' ? 'мл' : 'г');

/** Продукты для выбора: по запросу (название, бренд, начало штрихкода) или недавние, избранные, остальные. */
function pickList(q) {
  const foods = [...store.feast.foods.values()].filter((f) => !f.deletedAt);
  const usage = F.foodUsage(store.feast);
  const needle = foldYo(q.trim().toLowerCase());
  if (needle) {
    const digits = /^\d{3,}$/.test(needle);
    return foods.filter((f) => (digits ? F.foodBarcodes(f).some((c) => c.startsWith(needle)) : false)
      || foldYo(`${f.name} ${f.brand}`.toLowerCase()).includes(needle))
      .sort((a, b) => (usage.get(b.id)?.count || 0) - (usage.get(a.id)?.count || 0) || a.name.localeCompare(b.name, 'ru'));
  }
  const recent = foods.filter((f) => usage.has(f.id)).sort((a, b) => (usage.get(a.id).last < usage.get(b.id).last ? 1 : -1)).slice(0, 8);
  const rest = foods.filter((f) => !recent.includes(f))
    .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || (usage.get(b.id)?.count || 0) - (usage.get(a.id)?.count || 0) || a.name.localeCompare(b.name, 'ru'));
  return { recent, rest };
}

function FoodPickRow({ food, onPick }) {
  return html`<button type="button" class="food-pick" onClick=${() => onPick(food)}>
    <span class="fp-main">
      <span class="fp-name">${food.favorite ? '★ ' : ''}${food.name}${food.brand ? html` <small class="muted">${food.brand}</small>` : null}</span>
      <small class="muted">${macroLine(food.nutrients)} на 100 ${unitLabel(food)}</small>
    </span>
    <b class="fp-kcal">${fmt(nv(food.nutrients, 'kcal'), 'kcal')}<small> ккал</small></b>
  </button>`;
}

/** Значения продукта корзины: продукт × количество или быстрая запись (значения на порцию). */
function basketNutrients(it) {
  if (it.quick) return scaleNutrients(it.quick.nutrients || {}, it.amount || 1);
  const f = store.feast.foods.get(it.foodId);
  return f ? scaleNutrients(f.nutrients, (it.amount || 0) / 100) : {};
}
const basketName = (it) => (it.quick ? it.quick.name || 'Быстрая запись' : store.feast.foods.get(it.foodId)?.name || 'Продукт');
const basketAmount = (it) => (it.quick ? amountLabel({ unit: 'portion', amount: it.amount || 1 }) : amountLabel({ unit: store.feast.foods.get(it.foodId)?.unit, amount: it.amount }));
let basketKey = 0;

/**
 * Время, рацион и заметка записи. Время по умолчанию — сейчас, можно поставить своё; заметка — по кнопке.
 */
function EntryMeta({ date, meal, setMeal, time, setTime, note, setNote, noteOpen = false, allowEmptyTime = false }) {
  const [showNote, setShowNote] = useState(noteOpen || !!note);
  return html`<div class="entry-meta">
    <${MealChips} value=${meal} onChange=${setMeal} date=${date}/>
    <div class="em-row">
      <span class="em-time"><${Icon} name="clock" size=${16}/>
        <${TimeInput} value=${time} onChange=${setTime} allowEmpty=${allowEmptyTime} label="Время записи"/></span>
      ${time !== store.now.time ? html`<button type="button" class="link-btn" onClick=${() => setTime(store.now.time)}>Сейчас</button>` : null}
      ${showNote ? null : html`<button type="button" class="link-btn em-note-btn" onClick=${() => setShowNote(true)}><${Icon} name="edit" size=${14}/> Заметка</button>`}
    </div>
    ${showNote ? html`<textarea class="note-area" rows="2" maxlength=${F.NOTE_MAX} value=${note} ref=${noteOpen ? null : focusOnce}
      aria-label="Заметка к записи" placeholder="Заметка к записи: как приготовлено, где, самочувствие…" onInput=${(e) => setNote(e.target.value)}></textarea>` : null}
  </div>`;
}

/** Полоса «В записи»: продукты, которые уже собраны в одну запись (несколько продуктов — одна запись). */
function BasketStrip({ items, onRemove, onDone, doneLabel }) {
  if (!items.length) return null;
  const kcal = items.reduce((s, it) => s + nv(basketNutrients(it), 'kcal'), 0);
  return html`<div class="basket-strip" role="region" aria-label="Продукты записи">
    <div class="bs-items">
      ${items.map((it) => html`<span class="bs-chip" key=${it.key}>${basketName(it)} · ${basketAmount(it)}
        <button type="button" class="bs-remove" aria-label=${'Убрать ' + basketName(it)} onClick=${() => onRemove(it.key)}><${Icon} name="close" size=${12}/></button></span>`)}
    </div>
    <button type="button" class="btn primary small" onClick=${onDone}>${doneLabel} · ${fmt(kcal, 'kcal')} ккал</button>
  </div>`;
}

/** Шаг «сколько»: граммы (или порции), итог по калориям и БЖУ; «+ Ещё продукт» собирает запись из нескольких. */
function AmountStep({ food, meta, basket, entryMode, onBack, onAdd, onSave }) {
  const serving = F.servingOf(food);
  const usage = F.foodUsage(store.feast).get(food.id);
  const [amount, setAmount] = useState(String(usage?.amount ?? serving ?? 100).replace('.', ','));
  const a = num(amount);
  const n = scaleNutrients(food.nutrients, a / 100);
  const presets = [...new Set([serving, 50, 100, 150, 200, 250].filter(Boolean))];
  const item = () => ({ key: ++basketKey, foodId: food.id, amount: a });
  const save = () => a && onSave(item());
  const total = basket.length ? basket.reduce((s, it) => s + nv(basketNutrients(it), 'kcal'), 0) + nv(n, 'kcal') : null;
  return html`<div class="add-amount">
    <div class="aa-head">
      <b>${food.name}</b>${food.brand ? html` <span class="muted">${food.brand}</span>` : null}
      <button type="button" class="link-btn" onClick=${() => { closeSheet(); openFood(food.id); }}>Карточка</button>
    </div>
    <label class="num-field big aa-amount">
      <span class="nf-label">Сколько</span>
      <span class="nf-box"><input inputmode="decimal" value=${amount} ref=${focusOnce} onInput=${(e) => setAmount(e.target.value)}
        onKeyDown=${(e) => e.key === 'Enter' && save()}/><small>${unitLabel(food)}</small></span>
    </label>
    <div class="chip-row wrap">
      ${presets.map((p) => html`<button type="button" class=${'chip' + (a === p ? ' selected' : '')} onClick=${() => setAmount(String(p))}>
        ${p === serving && food.servingName ? `${food.servingName} (${fmt(p, 'x')} ${unitLabel(food)})` : p === serving ? `Порция ${fmt(p, 'x')} ${unitLabel(food)}` : `${p} ${unitLabel(food)}`}</button>`)}
      ${serving ? html`<button type="button" class="chip" onClick=${() => setAmount(String(serving * 2))}>2 порции</button>` : null}
    </div>
    ${entryMode ? null : html`<${EntryMeta} ...${meta}/>`}
    <div class="aa-total">
      <b>${fmt(nv(n, 'kcal'), 'kcal')} ккал</b>
      <span class="muted">${macroLine(n)}</span>
      ${store.data.settings?.gameEnabled ? html`<span class="muted">Награда: ${rewardLine(F.rewardsOf(food, store.feast.settings)) || 'нет'}</span>` : null}
      ${total !== null ? html`<span class="muted">Вся запись: ${countLabel(basket.length + 1, ['продукт', 'продукта', 'продуктов'])} · ${fmt(total, 'kcal')} ккал</span>` : null}
      ${entryMode ? null : html`<span class="muted">${humanDate(meta.date, store.now.today)} · ${meta.time || ''} · ${F.mealInfo(store.feast, meta.meal).name}</span>`}
    </div>
    <div class="sheet-actions">
      <button type="button" class="btn" onClick=${onBack}>Назад</button>
      <button type="button" class="btn" disabled=${!a || readOnly()} onClick=${() => a && onAdd(item())}
        data-hint="Добавить и выбрать ещё продукт — получится одна запись"><${Icon} name="plus" size=${18}/> Ещё продукт</button>
      <button type="button" class="btn primary" disabled=${!a || readOnly()} onClick=${save}>
        ${entryMode ? 'Добавить в запись' : 'Записать'}</button>
    </div>
  </div>`;
}

/** Шаг «новый продукт» (КБЖУ; остальное — потом в карточке). */
function CreateStep({ barcode, name: initialName = '', onBack, onCreated }) {
  const [name, setName] = useState(initialName);
  const [brand, setBrand] = useState('');
  const [unit, setUnit] = useState('g');
  const [serving, setServing] = useState('');
  const [nutr, setNutr] = useState({});
  const [code, setCode] = useState(barcode || '');
  const save = async (e) => {
    e?.preventDefault();
    if (!name.trim()) return;
    const f = await FA.createFood({ name, brand, unit, servingSize: serving, nutrients: nutr, barcode: normalizeBarcode(code) });
    if (f) onCreated(f);
  };
  const warn = code ? barcodeWarning(normalizeBarcode(code)) : '';
  return html`<form class="add-create" onSubmit=${save}>
    <label class="field"><span>Название</span>
      <input value=${name} maxlength=${F.FOOD_NAME_MAX} ref=${focusOnce} required placeholder="Например, Творог 5 %" onInput=${(e) => setName(e.target.value)}/></label>
    <div class="field-row">
      <label class="field"><span>Бренд</span><input value=${brand} placeholder="необязательно" onInput=${(e) => setBrand(e.target.value)}/></label>
      <label class="field"><span>Единица</span>
        <select value=${unit} onChange=${(e) => setUnit(e.target.value)}>${F.UNITS.map((u) => html`<option value=${u.key}>${u.label}</option>`)}</select></label>
    </div>
    <div class="field-row">
      <label class="field"><span>Штрихкод</span><input inputmode="numeric" value=${code} placeholder="необязательно" onInput=${(e) => setCode(e.target.value)}/></label>
      <label class="field"><span>Порция, ${unit === 'ml' ? 'мл' : 'г'}</span><input inputmode="decimal" value=${serving} placeholder="необязательно" onInput=${(e) => setServing(e.target.value)}/></label>
    </div>
    ${warn ? html`<p class="hint warn">${warn}</p>` : null}
    <${NutrientEditor} nutrients=${nutr} unit=${unit} onChange=${setNutr}/>
    <div class="sheet-actions">
      <button type="button" class="btn" onClick=${onBack}>Назад</button>
      <button type="submit" class="btn primary" disabled=${!name.trim() || readOnly()}>Сохранить продукт</button>
    </div>
  </form>`;
}

/** Быстрая запись: только калории (и, если хочется, БЖУ) — без продукта. */
function QuickStep({ meta, entryMode, onBack, onAdd, onSave }) {
  const [name, setName] = useState('');
  const [n, setN] = useState({});
  const ok = num(n.kcal) || num(n.protein) || num(n.fat) || num(n.carbs);
  const item = () => ({ key: ++basketKey, quick: { name, nutrients: n }, amount: 1 });
  const go = (fn) => (ok ? fn(item()) : showSnackbar('Укажи калории или БЖУ'));
  return html`<form class="add-quick" onSubmit=${(e) => { e.preventDefault(); go(onSave); }}>
    <label class="field"><span>Что съел(а)</span><input value=${name} ref=${focusOnce} placeholder="Быстрая запись" onInput=${(e) => setName(e.target.value)}/></label>
    <div class="ne-main">
      ${['kcal', ...MACROS].map((k) => html`<${NumField} key=${k} big label=${NUTRIENT[k].label} unit=${NUTRIENT[k].unit}
        value=${nv(n, k)} onCommit=${(v) => setN({ ...n, [k]: v })}/>`)}
    </div>
    ${entryMode ? null : html`<${EntryMeta} ...${meta}/>`}
    <div class="sheet-actions">
      <button type="button" class="btn" onClick=${onBack}>Назад</button>
      <button type="button" class="btn" disabled=${readOnly()} onClick=${() => go(onAdd)}><${Icon} name="plus" size=${18}/> Ещё продукт</button>
      <button type="submit" class="btn primary" disabled=${readOnly()}>${entryMode ? 'Добавить в запись' : 'Записать'}</button>
    </div>
  </form>`;
}

/** Шаг «Запись»: собранные продукты (количество можно поправить), время, рацион, заметка. */
function ReviewStep({ basket, setBasket, meta, entryMode, onMore, onSave }) {
  const setAmount = (key, v) => setBasket(basket.map((it) => (it.key === key ? { ...it, amount: num(v) } : it)));
  const total = sumNutrients(basket.map(basketNutrients));
  return html`<div class="add-review">
    <ul class="item-edit-list">
      ${basket.map((it) => html`<li key=${it.key} class="item-edit">
        <span class="ie-name">${basketName(it)}</span>
        <${NumField} label="Сколько" value=${it.amount} unit=${it.quick ? 'порц.' : unitLabel(store.feast.foods.get(it.foodId))}
          onCommit=${(v) => setAmount(it.key, v)}/>
        <b class="ie-kcal">${fmt(nv(basketNutrients(it), 'kcal'), 'kcal')}</b>
        <button type="button" class="icon-btn small" aria-label=${'Убрать ' + basketName(it)} onClick=${() => setBasket(basket.filter((x) => x.key !== it.key))}>
          <${Icon} name="close" size=${16}/></button>
      </li>`)}
    </ul>
    <button type="button" class="btn small" onClick=${onMore}><${Icon} name="plus" size=${16}/> Ещё продукт</button>
    ${entryMode ? null : html`<${EntryMeta} ...${meta}/>`}
    <div class="aa-total"><b>${fmt(nv(total, 'kcal'), 'kcal')} ккал</b><span class="muted">${macroLine(total)}</span></div>
    <div class="sheet-actions">
      <button type="button" class="btn primary" disabled=${!basket.length || basket.some((it) => !it.amount) || readOnly()} onClick=${() => onSave(null)}>
        ${entryMode ? 'Добавить в запись' : `Записать ${countLabel(basket.length, ['продукт', 'продукта', 'продуктов'])}`}</button>
    </div>
  </div>`;
}

/**
 * Лист «Записать еду». date — день дневника, meal — рацион (по умолчанию — по времени), foodId — сразу к количеству,
 * scan — сразу открыть сканер, entryId — добавить продукты в уже существующую запись.
 * Запись может состоять из нескольких продуктов: «+ Ещё продукт» собирает их, «Записать» сохраняет одной записью.
 */
export function AddFoodSheet({ date = store.now.today, meal: initialMeal = null, foodId = null, scan = false, entryId = null }) {
  const entry = entryId ? store.feast.entries.get(entryId) : null;
  const entryMode = !!entry && !entry.deletedAt;
  const [meal, setMeal] = useState(initialMeal || F.mealByTime(store.feast, date, store.now.time));
  const [time, setTime] = useState(store.now.time);
  const [note, setNote] = useState('');
  const [basket, setBasket] = useState([]);
  const [step, setStep] = useState(foodId ? 'amount' : scan ? 'scan' : 'pick');
  const [food, setFood] = useState(foodId ? store.feast.foods.get(foodId) : null);
  const [q, setQ] = useState('');
  const [newCode, setNewCode] = useState(null);
  const list = useMemo(() => pickList(q), [q, store.version]);
  const meta = { date, meal, setMeal, time, setTime, note, setNote };
  const pick = (f) => {
    setFood(f);
    setStep('amount');
  };
  const onCode = (code) => {
    const f = F.findByBarcode(store.feast, code);
    if (f) {
      showSnackbar(`Найден: ${f.name}`);
      pick(f);
    } else {
      setNewCode(code);
      setStep('create');
    }
  };
  const add = (item) => {
    setBasket([...basket, item]);
    setQ('');
    setStep('pick');
  };
  const save = async (item) => {
    const items = (item ? [...basket, item] : basket).filter((it) => it.amount);
    if (!items.length) return;
    const clean = items.map(({ key, ...rest }) => rest);
    if (entryMode) {
      if (await FA.addToEntry(entryId, clean)) openSheet('entry', { id: entryId });
      return;
    }
    if (await FA.addEntry({ date, meal, time, note, items: clean })) closeSheet();
  };
  const titles = {
    pick: entryMode ? 'Добавить в запись' : basket.length ? 'Ещё продукт' : 'Записать еду',
    amount: 'Сколько', scan: 'Штрихкод', create: newCode ? `Новый продукт · ${newCode}` : 'Новый продукт', quick: 'Быстрая запись',
    review: entryMode ? 'Добавить в запись' : 'Запись',
  };
  const back = () => setStep(basket.length && step === 'pick' ? 'review' : 'pick');

  return html`
    <${Sheet} title=${titles[step]} onClose=${closeSheet} className="add-food-sheet">
      ${step === 'pick' ? html`
        ${entryMode ? html`<p class="muted small">В запись «${F.entryTitle(entry)}» · ${humanDate(entry.date, store.now.today)}${entry.time ? ' · ' + entry.time : ''}</p>` : null}
        <${BasketStrip} items=${basket} onRemove=${(k) => setBasket(basket.filter((x) => x.key !== k))} onDone=${() => setStep('review')}
          doneLabel=${entryMode ? 'Добавить' : 'Записать'}/>
        <div class="search-field add-search">
          <${Icon} name="search" size=${16}/>
          <input type="search" value=${q} ref=${focusOnce} placeholder="Продукт, бренд или цифры штрихкода" aria-label="Найти продукт"
            onInput=${(e) => setQ(e.target.value)}/>
        </div>
        <div class="add-actions">
          <button type="button" class="btn" onClick=${() => setStep('scan')}><${Icon} name="barcode" size=${18}/> Штрихкод</button>
          <button type="button" class="btn" onClick=${() => { setNewCode(null); setStep('create'); }}><${Icon} name="plus" size=${18}/> Новый продукт</button>
          <button type="button" class="btn" onClick=${() => setStep('quick')}><${Icon} name="flame" size=${18}/> Только калории</button>
        </div>
        ${Array.isArray(list) ? html`
          ${list.length ? list.slice(0, 60).map((f) => html`<${FoodPickRow} key=${f.id} food=${f} onPick=${pick}/>`)
            : html`<p class="muted add-empty">Не нашлось. <button type="button" class="link-btn" onClick=${() => setStep('create')}>Создать «${q.trim()}»</button></p>`}` : html`
          ${list.recent.length ? html`<h4 class="add-sub">Недавние</h4>${list.recent.map((f) => html`<${FoodPickRow} key=${f.id} food=${f} onPick=${pick}/>`)}` : null}
          ${list.rest.length ? html`<h4 class="add-sub">${list.recent.length ? 'Все продукты' : 'Продукты'}</h4>${list.rest.slice(0, 80).map((f) => html`<${FoodPickRow} key=${f.id} food=${f} onPick=${pick}/>`)}` : null}
          ${!list.recent.length && !list.rest.length ? html`<p class="muted add-empty">Продуктов пока нет. Создай свой или отсканируй штрихкод — он сохранится в базе.</p>` : null}`}` : null}
      ${step === 'amount' && food ? html`<${AmountStep} key=${food.id} food=${food} meta=${meta} basket=${basket} entryMode=${entryMode}
        onBack=${back} onAdd=${add} onSave=${save}/>` : null}
      ${step === 'scan' ? html`<${BarcodeScanner} onCode=${onCode} onCancel=${back}/>` : null}
      ${step === 'create' ? html`<${CreateStep} barcode=${newCode} name=${q} onBack=${back} onCreated=${(f) => { showSnackbar(`Продукт «${f.name}» сохранён`); pick(f); }}/>` : null}
      ${step === 'quick' ? html`<${QuickStep} meta=${meta} entryMode=${entryMode} onBack=${back} onAdd=${add} onSave=${save}/>` : null}
      ${step === 'review' ? html`<${ReviewStep} basket=${basket} setBasket=${setBasket} meta=${meta} entryMode=${entryMode}
        onMore=${() => setStep('pick')} onSave=${save}/>` : null}
    <//>`;
}

/** Лист записи дневника: время, рацион, продукты (количество, убрать, добавить ещё), заметка, удалить. */
export function EntrySheet({ id }) {
  const e = store.feast.entries.get(id);
  const items = e && !e.deletedAt ? F.entryItems(e) : [];
  const [amounts, setAmounts] = useState(() => Object.fromEntries(items.map((it) => [it.id, it.amount])));
  const [removed, setRemoved] = useState([]);
  const [meal, setMeal] = useState(e?.meal || 'snack');
  const [time, setTime] = useState(e?.time || null);
  const [note, setNote] = useState(e?.note || '');
  if (!e || e.deletedAt) return null;
  const live = items.filter((it) => !removed.includes(it.id));
  const amountOf = (it) => (it.id in amounts ? amounts[it.id] : it.amount);
  const preview = sumNutrients(live.map((it) => itemNutrients({ ...it, amount: amountOf(it) })));
  const changes = () => ({ meal, time, note, amounts: Object.fromEntries(live.map((it) => [it.id, amountOf(it)])), removed });
  const save = async () => {
    await FA.saveEntry(id, changes());
    closeSheet();
  };
  const addMore = async () => {
    await FA.saveEntry(id, changes());
    openSheet('addFood', { date: e.date, meal, entryId: id });
  };
  const foodOf = (it) => {
    const f = it.foodId && store.feast.foods.get(it.foodId);
    return f && !f.deletedAt ? f : null;
  };
  return html`
    <${Sheet} title=${F.entryTitle(e)} onClose=${closeSheet} className="entry-sheet">
      <ul class="item-edit-list">
        ${live.map((it) => html`<li key=${it.id} class="item-edit">
          <span class="ie-name">${foodOf(it) ? html`<button type="button" class="link-btn" onClick=${() => { closeSheet(); openFood(it.foodId); }}>${it.name}</button>` : it.name}</span>
          <${NumField} label=${it.unit === 'portion' ? 'Порций' : 'Сколько'} value=${amountOf(it)} unit=${it.unit === 'portion' ? 'шт.' : it.unit === 'ml' ? 'мл' : 'г'}
            onCommit=${(v) => setAmounts({ ...amounts, [it.id]: num(v) })}/>
          <b class="ie-kcal">${fmt(nv(itemNutrients({ ...it, amount: amountOf(it) }), 'kcal'), 'kcal')}</b>
          <button type="button" class="icon-btn small" aria-label=${'Убрать из записи: ' + it.name} disabled=${readOnly()}
            onClick=${() => setRemoved([...removed, it.id])}><${Icon} name="close" size=${16}/></button>
        </li>`)}
      </ul>
      ${!live.length ? html`<p class="hint warn">В записи не осталось продуктов — при сохранении она удалится.</p>` : null}
      <button type="button" class="btn small" disabled=${readOnly()} onClick=${addMore}><${Icon} name="plus" size=${16}/> Добавить продукт</button>
      <${EntryMeta} date=${e.date} meal=${meal} setMeal=${setMeal} time=${time} setTime=${setTime} note=${note} setNote=${setNote} noteOpen=${true} allowEmptyTime=${!e.time}/>
      <div class="aa-total"><b>${fmt(nv(preview, 'kcal'), 'kcal')} ккал</b><span class="muted">${macroLine(preview)}</span>
        <span class="muted">${humanDate(e.date, store.now.today)} · было ${fmt(nv(entryNutrients(e), 'kcal'), 'kcal')} ккал</span></div>
      <div class="sheet-actions">
        <button type="button" class="btn danger-outline" disabled=${readOnly()} onClick=${() => { closeSheet(); FA.deleteEntries([id]); }}>
          <${Icon} name="trash" size=${16}/> Удалить запись</button>
        <button type="button" class="btn primary" disabled=${readOnly() || live.some((it) => !amountOf(it))} onClick=${save}>Сохранить</button>
      </div>
    <//>`;
}

/**
 * Сканер для «Продуктов» и карточки: target — 'open' (найти или создать продукт) или id продукта (привязать код).
 */
export function ScanSheet({ target = 'open' }) {
  const [code, setCode] = useState(null);
  const onCode = async (c) => {
    if (target !== 'open') {
      closeSheet();
      await FA.attachBarcode(target, c);
      return;
    }
    const f = F.findByBarcode(store.feast, c);
    if (f) {
      closeSheet();
      openFood(f.id);
      return;
    }
    setCode(c);
  };
  return html`
    <${Sheet} title=${code ? `Новый продукт · ${code}` : 'Сканировать штрихкод'} onClose=${closeSheet}>
      ${code ? html`<p class="hint">Такого кода в твоей базе ещё нет — заполни продукт, и в следующий раз он найдётся по штрихкоду.</p>
        <${CreateStep} barcode=${code} onBack=${() => setCode(null)} onCreated=${(f) => { closeSheet(); openFood(f.id); }}/>`
        : html`<${BarcodeScanner} onCode=${onCode} onCancel=${closeSheet}
          hint=${target === 'open' ? 'Наведи камеру на штрихкод: свой продукт откроется, новый — создадим' : 'Наведи камеру на штрихкод — он привяжется к продукту'}/>`}
    <//>`;
}

/** Открыть лист «Записать еду» на день дневника (из дока, клавишей N, из рациона). */
export function openAddFood(opts = {}) {
  if (store.ui.feastReadOnly) {
    showSnackbar(store.ui.feastReadOnly);
    return;
  }
  openSheet('addFood', { date: opts.date || currentDiaryDate(), meal: opts.meal || null, foodId: opts.foodId || null, scan: !!opts.scan, entryId: opts.entryId || null });
}

/** День, открытый в дневнике (из адреса #/diary?date=…), иначе сегодня. */
export function currentDiaryDate() {
  const m = location.hash.match(/^#\/diary\?(?:.*&)?date=(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : store.now.today;
}
