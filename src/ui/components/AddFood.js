// Crimson Harvest (0.11, «Feast»): лист «Записать еду» — поиск продукта, недавние и частые, количество и рацион;
// штрихкод (свой продукт найдётся сразу, нового — создаём с этим кодом), новый продукт, быстрая запись калорий.
// 0.12: запись — из нескольких продуктов («+ Ещё продукт»), со временем (по умолчанию сейчас) и заметкой.
// 0.12.5: каталог общий — продукты и лекарства; лекарства записываются так же (и запись только из лекарств),
// лекарства, привязанные к продукту, добавляются вместе с ним; у записи — сколько угодно заметок.
// 0.13: замеры (глюкоза, давление… — значение по частям, норма), привязанные замеры у продукта и лекарства,
// известные замеры при создании, запись без продуктов — просто заметка.
// Лист записи дневника (продукты, время, рацион, заметки, удалить) и лист сканера для «Продуктов».

import { html, useState, useMemo } from '../html.js';
import { Icon } from '../icons.js';
import { Sheet } from './Sheet.js';
import { BarcodeScanner } from './Scanner.js';
import { MealChips, macroLine, NutrientEditor, NumField, rewardLine, IconPicker } from './FeastParts.js';
import { TimeInput } from './TimeInput.js';
import { store, closeSheet, openSheet, showSnackbar } from '../../store/appState.js';
import * as FA from '../../store/feastActions.js';
import * as F from '../../core/feast.js';
import {
  num, nv, fmt, scaleNutrients, sumNutrients, entryNutrients, itemNutrients, amountLabel, MACROS, NUTRIENT, MED_UNITS, MED_UNIT,
} from '../../core/nutrition.js';
import { countLabel } from '../../core/plural.js';
import { normalizeBarcode, barcodeWarning } from '../../core/barcode.js';
import { humanDate } from '../../core/dates.js';
import { foldYo } from '../../core/query.js';
import { openFood } from '../router.js';
import { tr, dec } from '../../core/i18n.js';
import * as MS from '../../core/measures.js';

const readOnly = () => !!store.ui.feastReadOnly;
/** autofocus у вставленных позже элементов браузер не выполняет — фокусируем сами, один раз. */
const focusOnce = (el) => {
  if (el && !el.dataset.focused) {
    el.dataset.focused = '1';
    setTimeout(() => el.focus({ preventScroll: true }), 40);
  }
};
/** «г», «мл», у лекарства — «ед.», «табл.»… */
export const unitLabel = (food) => (F.isMeasure(food) ? (food.unit ? tr(food.unit) : '') : F.isMed(food) ? MED_UNIT[food.unit]?.short || tr('шт.') : food?.unit === 'ml' ? tr('мл') : tr('г'));
const KINDS = [['all', tr('Всё')], ['food', tr('Продукты')], ['med', tr('💊 Лекарства')], ['measure', tr('📏 Замеры')]];
const ofKind = (kind, f) => kind === 'all' || (kind === 'med' ? F.isMed(f) : kind === 'measure' ? F.isMeasure(f) : !F.isMed(f) && !F.isMeasure(f));
let noteKey = 0;
const newNote = (text = '') => ({ key: 'n' + ++noteKey, text });

/** Продукты и лекарства для выбора: по запросу (название, бренд, начало штрихкода) или недавние, избранные, остальные. */
function pickList(q, kind = 'all') {
  const foods = [...store.feast.foods.values()].filter((f) => !f.deletedAt && ofKind(kind, f));
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
  if (F.isMeasure(food)) {
    const norm = MS.normText(food);
    return html`<button type="button" class="food-pick measure" onClick=${() => onPick(food)}>
      <span class="fp-main">
        <span class="fp-name">${food.icon || '📏'} ${food.name}</span>
        <small class="muted">${tr('замер')}${food.unit ? ' · ' + tr(food.unit) : ''}${norm ? ' · ' + tr('норма {p0}', { p0: norm }) : ''}</small>
      </span>
    </button>`;
  }
  if (F.isMed(food)) {
    return html`<button type="button" class="food-pick med" onClick=${() => onPick(food)}>
      <span class="fp-main">
        <span class="fp-name">${F.kindIcon(food)} ${food.favorite ? '★ ' : ''}${food.name}${food.brand ? html` <small class="muted">${food.brand}</small>` : null}</span>
        <small class="muted">лекарство · обычно ${amountLabel({ unit: food.unit, amount: food.dose || 1 })}</small>
      </span>
    </button>`;
  }
  return html`<button type="button" class="food-pick" onClick=${() => onPick(food)}>
    <span class="fp-main">
      <span class="fp-name">${food.favorite ? '★ ' : ''}${food.name}${food.brand ? html` <small class="muted">${food.brand}</small>` : null}</span>
      <small class="muted">${macroLine(food.nutrients)} на 100 ${unitLabel(food)}${food.meds?.length ? ' · 💊' : ''}</small>
    </span>
    <b class="fp-kcal">${fmt(nv(food.nutrients, 'kcal'), 'kcal')}<small> ккал</small></b>
  </button>`;
}

/** Значения продукта корзины: продукт × количество или быстрая запись (значения на порцию); у лекарства — ничего. */
function basketNutrients(it) {
  if (it.quick) return scaleNutrients(it.quick.nutrients || {}, it.amount || 1);
  const f = store.feast.foods.get(it.foodId);
  if (!f || F.isMeasure(f)) return {};
  // лекарство (0.13): значения на 1 единицу формы
  return scaleNutrients(f.nutrients || {}, F.isMed(f) ? it.amount || 0 : (it.amount || 0) / 100);
}
const basketFood = (it) => (it.quick ? null : store.feast.foods.get(it.foodId));
const kindIcon = (f) => (F.kindIcon(f) ? F.kindIcon(f) + ' ' : '');
const basketName = (it) => (it.quick ? it.quick.name || tr('Быстрая запись') : kindIcon(basketFood(it)) + (basketFood(it)?.name || tr('Продукт')));
const basketAmount = (it) => (it.quick ? amountLabel({ unit: 'portion', amount: it.amount || 1 })
  : F.isMeasure(basketFood(it)) ? MS.readingText({ values: it.values, unit: basketFood(it).unit })
    : amountLabel({ unit: basketFood(it)?.unit, amount: it.amount }));
const itemReady = (it) => (it.values ? !!MS.cleanValues(it.values, it.values.length) : !!it.amount);

/** Поля значения замера: по одному на часть (у давления — верхнее и нижнее). values — строки. */
function MeasureInputs({ m, values, setValues, autoFocus = false, onEnter }) {
  const n = MS.partCount(m);
  const parts = m.parts?.length ? m.parts : [m.name];
  const ranges = m.ranges || [];
  return html`<div class="measure-inputs">
    ${Array.from({ length: n }, (_, i) => html`<label class="num-field big" key=${i}>
      <span class="nf-label">${n > 1 ? parts[i] : tr('Значение')}</span>
      <span class="nf-box"><input inputmode="decimal" value=${values[i] ?? ''} ref=${autoFocus && i === 0 ? focusOnce : null}
        placeholder=${ranges[i] ? MS.rangeText(ranges[i]) : ''} aria-label=${(n > 1 ? parts[i] : m.name) + (m.unit ? ', ' + tr(m.unit) : '')}
        onInput=${(e) => setValues(values.map((v, j) => (j === i ? e.target.value : v)))} onKeyDown=${(e) => e.key === 'Enter' && onEnter?.()}/>
        <small>${m.unit ? tr(m.unit) : ''}</small></span>
    </label>`)}
  </div>`;
}

/** Замеры, привязанные к продукту или лекарству (0.13): поле для каждого, пустое — не записывается. */
function LinkedMeasures({ food, values, setValues }) {
  const links = (food.measures || []).map((l) => store.feast.foods.get(l.measureId)).filter((m) => m && !m.deletedAt);
  if (!links.length) return null;
  return html`<div class="linked-meds linked-measures">
    <span class="muted small">${tr('Замеры (необязательно):')}</span>
    ${links.map((m) => html`<div class="lme-row" key=${m.id}>
      <span class="lme-name">${m.icon || '📏'} ${m.name}</span>
      <${MeasureInputs} m=${m} values=${values[m.id] || Array.from({ length: MS.partCount(m) }, () => '')}
        setValues=${(v) => setValues({ ...values, [m.id]: v })}/>
    </div>`)}
  </div>`;
}

/** Шаг «замер»: значение (или значения), заметка к показанию, время и рацион. */
function MeasureStep({ food, meta, entryMode, onBack, onAdd, onSave }) {
  const [values, setValues] = useState(() => Array.from({ length: MS.partCount(food) }, () => ''));
  const [itemNote, setItemNote] = useState('');
  const clean = MS.cleanValues(values, MS.partCount(food));
  const status = clean ? MS.readingStatus(clean, food.ranges) : null;
  const items = () => [{ key: ++basketKey, foodId: food.id, values: clean, note: itemNote }];
  const save = () => clean && onSave(items());
  const norm = MS.normText(food);
  return html`<div class="add-amount">
    <div class="aa-head">
      <b>${food.icon || '📏'} ${food.name}</b>
      <button type="button" class="link-btn" onClick=${() => { closeSheet(); openFood(food.id); }}>Карточка</button>
    </div>
    ${food.note ? html`<p class="muted small aa-food-note">📝 ${food.note}</p>` : null}
    <${MeasureInputs} m=${food} values=${values} setValues=${setValues} autoFocus onEnter=${save}/>
    ${norm ? html`<p class=${'small ' + (status === 'low' || status === 'high' ? 'tone-danger' : 'muted')}>
      ${status === 'low' || status === 'high' ? '⚠ ' + MS.STATUS_LABEL[status] + ' · ' : status === 'ok' ? '✓ ' + MS.STATUS_LABEL.ok + ' · ' : ''}${tr('норма {p0}', { p0: norm })}</p>` : null}
    <input class="item-note-input" value=${itemNote} maxlength=${F.NOTE_MAX} placeholder=${tr('Заметка к замеру: натощак, после еды, самочувствие…')}
      aria-label="Заметка к замеру" onInput=${(e) => setItemNote(e.target.value)}/>
    ${entryMode ? null : html`<${EntryMeta} ...${meta}/>`}
    <div class="sheet-actions">
      <button type="button" class="btn" onClick=${onBack}>Назад</button>
      <button type="button" class="btn" disabled=${!clean || readOnly()} onClick=${() => clean && onAdd(items())}
        data-hint="Добавить и выбрать ещё — получится одна запись"><${Icon} name="plus" size=${18}/> Ещё</button>
      <button type="button" class="btn primary" disabled=${!clean || readOnly()} onClick=${save}>${entryMode ? tr('Добавить в запись') : tr('Записать')}</button>
    </div>
  </div>`;
}

/** Шаг «только заметка» (0.13): запись без продуктов — время, рацион и заметки. */
function NoteStep({ meta, onBack, onSave }) {
  const ok = meta.notes.some((n) => n.text.trim());
  return html`<div class="add-amount">
    <p class="muted small">Запись без продуктов — например, самочувствие, сон или что-то важное о дне.</p>
    <${EntryMeta} ...${meta}/>
    <div class="sheet-actions">
      <button type="button" class="btn" onClick=${onBack}>Назад</button>
      <button type="button" class="btn primary" disabled=${!ok || readOnly()} onClick=${() => ok && onSave([])}>Записать заметку</button>
    </div>
  </div>`;
}
let basketKey = 0;

/** Заметки записи: сколько угодно — «+ Заметка», крестик убирает. notes — [{ key, text }]. */
export function NotesEditor({ notes, setNotes, placeholder = tr('Заметка к записи: как приготовлено, где, самочувствие…'), disabled = false, autoFocus = false }) {
  const set = (key, text) => setNotes(notes.map((n) => (n.key === key ? { ...n, text } : n)));
  return html`<div class="notes-editor">
    ${notes.map((n, i) => html`<div class="ne-note" key=${n.key}>
      <textarea class="note-area" rows="2" maxlength=${F.NOTE_MAX} value=${n.text} disabled=${disabled}
        ref=${autoFocus && i === notes.length - 1 ? focusOnce : null}
        aria-label=${tr('Заметка {p0}', { p0: i + 1 })} placeholder=${i === 0 ? placeholder : tr('Ещё заметка')} onInput=${(e) => set(n.key, e.target.value)}></textarea>
      <button type="button" class="icon-btn small" disabled=${disabled} aria-label=${tr('Убрать заметку {p0}', { p0: i + 1 })} data-hint="Убрать заметку"
        onClick=${() => setNotes(notes.filter((x) => x.key !== n.key))}><${Icon} name="close" size=${14}/></button>
    </div>`)}
    <button type="button" class="link-btn em-note-btn" disabled=${disabled} onClick=${() => setNotes([...notes, newNote()])}>
      <${Icon} name="plus" size=${14}/> ${notes.length ? tr('Ещё заметка') : tr('Заметка')}</button>
  </div>`;
}

/** Время, рацион и заметки записи. Время по умолчанию — сейчас, можно поставить своё. */
function EntryMeta({ date, meal, setMeal, time, setTime, notes, setNotes, allowEmptyTime = false }) {
  return html`<div class="entry-meta">
    <${MealChips} value=${meal} onChange=${setMeal} date=${date}/>
    <div class="em-row">
      <span class="em-time"><${Icon} name="clock" size=${16}/>
        <${TimeInput} value=${time} onChange=${setTime} allowEmpty=${allowEmptyTime} label="Время записи"/></span>
      ${time !== store.now.time ? html`<button type="button" class="link-btn" onClick=${() => setTime(store.now.time)}>Сейчас</button>` : null}
    </div>
    <${NotesEditor} notes=${notes} setNotes=${setNotes} autoFocus=${notes.length > 0 && !notes.at(-1).text}/>
  </div>`;
}

/** Полоса «В записи»: продукты, которые уже собраны в одну запись (несколько продуктов — одна запись). */
function BasketStrip({ items, onRemove, onDone, doneLabel }) {
  if (!items.length) return null;
  const kcal = items.reduce((s, it) => s + nv(basketNutrients(it), 'kcal'), 0);
  return html`<div class="basket-strip" role="region" aria-label="Продукты записи">
    <div class="bs-items">
      ${items.map((it) => html`<span class="bs-chip" key=${it.key}>${basketName(it)} · ${basketAmount(it)}
        <button type="button" class="bs-remove" aria-label=${tr('Убрать ') + basketName(it)} onClick=${() => onRemove(it.key)}><${Icon} name="close" size=${12}/></button></span>`)}
    </div>
    <button type="button" class="btn primary small" onClick=${onDone}>${doneLabel}${kcal ? tr(' · {p0} ккал', { p0: fmt(kcal, 'kcal') }) : ''}</button>
  </div>`;
}

/** Лекарства, привязанные к продукту: галочка — записать вместе с ним, количество — поправить. */
function LinkedMeds({ food, picked, setPicked }) {
  const links = (food.meds || []).map((l) => ({ ...l, med: store.feast.foods.get(l.medId) })).filter((l) => l.med && !l.med.deletedAt);
  if (!links.length) return null;
  return html`<div class="linked-meds">
    <span class="muted small">Вместе с продуктом:</span>
    ${links.map((l) => {
      const on = picked[l.medId] != null;
      return html`<label class="lm-row" key=${l.medId}>
        <input type="checkbox" checked=${on} onChange=${(e) => setPicked({ ...picked, [l.medId]: e.target.checked ? l.amount : null })}/>
        <span>${F.kindIcon(l.med)} ${l.med.name}</span>
        <input class="lm-amount" inputmode="decimal" value=${dec(on ? picked[l.medId] : l.amount)} disabled=${!on}
          aria-label=${tr('Сколько: ') + l.med.name} onInput=${(e) => setPicked({ ...picked, [l.medId]: num(e.target.value) })}/>
        <small class="muted">${MED_UNIT[l.med.unit]?.short || ''}</small>
      </label>`;
    })}
  </div>`;
}

/**
 * Шаг «сколько»: у продукта — граммы (или порции), итог по калориям и БЖУ и привязанные лекарства; у лекарства —
 * доза. «+ Ещё продукт» собирает запись из нескольких.
 */
function AmountStep({ food, meta, basket, entryMode, onBack, onAdd, onSave }) {
  const med = F.isMed(food);
  const servings = med ? [] : F.servingsOf(food);
  const serving = servings[0]?.size ?? null;
  const usage = F.foodUsage(store.feast).get(food.id);
  const [amount, setAmount] = useState(dec(usage?.amount ?? (med ? food.dose || 1 : serving ?? 100)));
  const [itemNote, setItemNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [picked, setPicked] = useState(() => Object.fromEntries((food.meds || []).map((l) => [l.medId, l.amount])));
  const [measureValues, setMeasureValues] = useState({});
  const a = num(amount);
  const n = scaleNutrients(food.nutrients || {}, med ? a : a / 100);
  const presets = med ? [...new Set([food.dose || 1, 1, 2, 4, 6, 8, 10].filter(Boolean))].slice(0, 7)
    : [50, 100, 150, 200, 250].filter((p) => !servings.some((s) => s.size === p));
  const items = () => [
    { key: ++basketKey, foodId: food.id, amount: a, note: itemNote },
    ...Object.entries(picked).filter(([, v]) => num(v)).map(([medId, v]) => ({ key: ++basketKey, foodId: medId, amount: num(v) })),
    ...Object.entries(measureValues).map(([measureId, vs]) => ({ key: ++basketKey, foodId: measureId, values: MS.cleanValues(vs, vs.length) })).filter((x) => x.values),
  ];
  const save = () => a && onSave(items());
  const total = basket.length ? basket.reduce((s, it) => s + nv(basketNutrients(it), 'kcal'), 0) + nv(n, 'kcal') : null;
  const u = unitLabel(food);
  return html`<div class="add-amount">
    <div class="aa-head">
      <b>${med ? F.kindIcon(food) + ' ' : ''}${food.name}</b>${food.brand ? html` <span class="muted">${food.brand}</span>` : null}
      <button type="button" class="link-btn" onClick=${() => { closeSheet(); openFood(food.id); }}>Карточка</button>
    </div>
    ${food.note ? html`<p class="muted small aa-food-note">📝 ${food.note}</p>` : null}
    <label class="num-field big aa-amount">
      <span class="nf-label">${med ? tr('Доза') : tr('Сколько')}</span>
      <span class="nf-box"><input inputmode="decimal" value=${amount} ref=${focusOnce} onInput=${(e) => setAmount(e.target.value)}
        onKeyDown=${(e) => e.key === 'Enter' && save()}/><small>${u}</small></span>
    </label>
    <div class="chip-row wrap">
      ${servings.map((s) => html`<button type="button" key=${'s' + s.id} class=${'chip serving-chip' + (a === s.size ? ' selected' : '')} onClick=${() => setAmount(dec(s.size))}>
        ${s.name || tr('Порция')} <small>${fmt(s.size, 'x')} ${u}</small></button>`)}
      ${presets.map((p) => html`<button type="button" key=${p} class=${'chip' + (a === p ? ' selected' : '')} onClick=${() => setAmount(String(p))}>${`${fmt(p, 'x')} ${u}`}</button>`)}
    </div>
    ${med ? null : html`<${LinkedMeds} food=${food} picked=${picked} setPicked=${setPicked}/>`}
    <${LinkedMeasures} food=${food} values=${measureValues} setValues=${setMeasureValues}/>
    ${noteOpen ? html`<input class="item-note-input" value=${itemNote} maxlength=${F.NOTE_MAX} ref=${focusOnce}
        placeholder=${med ? tr('Заметка к приёму: например, после еды') : tr('Заметка к продукту: например, 4 ед. инсулина')} aria-label="Заметка к продукту" onInput=${(e) => setItemNote(e.target.value)}/>`
      : html`<button type="button" class="link-btn item-note-btn" onClick=${() => setNoteOpen(true)}><${Icon} name="edit" size=${14}/> ${med ? tr('Заметка к приёму') : tr('Заметка к продукту')}</button>`}
    ${entryMode ? null : html`<${EntryMeta} ...${meta}/>`}
    <div class="aa-total">
      ${med ? html`<b>${F.kindIcon(food)} ${amountLabel({ unit: food.unit, amount: a })}</b>${Object.keys(n).length ? html`<span class="muted">${fmt(nv(n, 'kcal'), 'kcal')} ккал · ${macroLine(n)}</span>` : null}` : html`<b>${fmt(nv(n, 'kcal'), 'kcal')} ккал</b>
      <span class="muted">${macroLine(n)}</span>
      ${store.data.settings?.gameEnabled ? html`<span class="muted">Награда: ${rewardLine(F.rewardsOf(food, store.feast.settings)) || tr('нет')}</span>` : null}`}
      ${total !== null ? html`<span class="muted">Вся запись: ${countLabel(basket.length + 1, ['позиция', 'позиции', 'позиций'])} · ${fmt(total, 'kcal')} ккал</span>` : null}
      ${entryMode ? null : html`<span class="muted">${humanDate(meta.date, store.now.today)} · ${meta.time || ''} · ${F.mealName(F.mealInfo(store.feast, meta.meal))}</span>`}
    </div>
    <div class="sheet-actions">
      <button type="button" class="btn" onClick=${onBack}>Назад</button>
      <button type="button" class="btn" disabled=${!a || readOnly()} onClick=${() => a && onAdd(items())}
        data-hint="Добавить и выбрать ещё продукт или лекарство — получится одна запись"><${Icon} name="plus" size=${18}/> Ещё</button>
      <button type="button" class="btn primary" disabled=${!a || readOnly()} onClick=${save}>
        ${entryMode ? tr('Добавить в запись') : tr('Записать')}</button>
    </div>
  </div>`;
}

/** Шаг «новый продукт» или «новое лекарство» (у продукта — КБЖУ; остальное — потом в карточке). */
function CreateStep({ barcode, name: initialName = '', kind: initialKind = 'food', onBack, onCreated }) {
  const [kind, setKind] = useState(['med', 'measure'].includes(initialKind) ? initialKind : 'food');
  const med = kind === 'med';
  const measure = kind === 'measure';
  const [mUnit, setMUnit] = useState('');
  const [mParts, setMParts] = useState([]);
  const [mRanges, setMRanges] = useState([{ min: '', max: '' }]);
  const [mIcon, setMIcon] = useState('');
  const [medNutrOpen, setMedNutrOpen] = useState(false);
  const usePreset = (p) => {
    setName(p.name);
    setMUnit(p.unit);
    setMParts(p.parts || []);
    setMRanges((p.ranges || [null]).map((r) => ({ min: r?.min == null ? '' : dec(r.min), max: r?.max == null ? '' : dec(r.max) })));
    setMIcon(p.icon || '');
    setNote(p.hint || '');
  };
  const [name, setName] = useState(initialName);
  const [brand, setBrand] = useState('');
  const [unit, setUnit] = useState(med ? 'tab' : 'g');
  const [serving, setServing] = useState('');
  const [servingName, setServingName] = useState('');
  const [icon, setIcon] = useState('');
  const [dose, setDose] = useState('1');
  const [nutr, setNutr] = useState({});
  const [note, setNote] = useState('');
  const [code, setCode] = useState(barcode || '');
  const switchKind = (k) => {
    setKind(k);
    setUnit(k === 'med' ? 'tab' : 'g');
  };
  const save = async (e) => {
    e?.preventDefault();
    if (!name.trim()) return;
    const f = await FA.createFood(measure
      ? { kind: 'measure', name, unit: mUnit, parts: mParts, ranges: MS.cleanRanges(mRanges, Math.max(1, mParts.length)), icon: mIcon, note }
      : med
        ? { kind: 'med', name, brand, unit, dose, note, icon, nutrients: nutr, barcode: normalizeBarcode(code) }
        : { name, brand, unit, servings: num(serving) > 0 ? [{ name: servingName, size: num(serving) }] : [], nutrients: nutr, note, barcode: normalizeBarcode(code) });
    if (f) onCreated(f);
  };
  const mCount = Math.max(1, mParts.length);
  const warn = code ? barcodeWarning(normalizeBarcode(code)) : '';
  return html`<form class="add-create" onSubmit=${save}>
    <div class="chip-row" role="radiogroup" aria-label="Что создаём">
      <button type="button" role="radio" aria-checked=${!med} class=${'chip' + (!med ? ' selected' : '')} onClick=${() => switchKind('food')}>Продукт</button>
      <button type="button" role="radio" aria-checked=${med} class=${'chip' + (med ? ' selected' : '')} onClick=${() => switchKind('med')}>💊 Лекарство</button>
      <button type="button" role="radio" aria-checked=${measure} class=${'chip' + (measure ? ' selected' : '')} onClick=${() => switchKind('measure')}>📏 Замер</button>
    </div>
    ${measure ? html`<div class="measure-presets">
      <span class="muted small">Известные:</span>
      <div class="chip-row wrap">${MS.MEASURE_PRESETS.map((p) => html`<button type="button" class=${'chip' + (name === p.name ? ' selected' : '')} key=${p.key}
        title=${p.hint || ''} onClick=${() => usePreset(p)}>${p.icon} ${p.name}</button>`)}</div>
    </div>` : null}
    <label class="field"><span>Название</span>
      <input value=${name} maxlength=${F.FOOD_NAME_MAX} ref=${focusOnce} required placeholder=${measure ? tr('Например, глюкоза после еды') : med ? tr('Например, инсулин короткий') : tr('Например, Творог 5 %')} onInput=${(e) => setName(e.target.value)}/></label>
    ${measure ? html`
    <div class="field-row">
      <label class="field"><span>Единица</span><input list="measure-units-new" value=${mUnit} maxlength=${MS.MEASURE_UNIT_MAX} placeholder="ммоль/л, мм рт. ст., балл…" onInput=${(e) => setMUnit(e.target.value)}/>
        <datalist id="measure-units-new">${MS.UNIT_SUGGESTIONS.map((u) => html`<option value=${u} key=${u}></option>`)}</datalist></label>
      <label class="field"><span>Значение</span>
        <select value=${String(mCount)} onChange=${(e) => { const n2 = +e.target.value; setMParts(n2 === 1 ? [] : Array.from({ length: n2 }, (_, i) => mParts[i] || [tr('Верхнее'), tr('Нижнее'), tr('Третье')][i])); setMRanges(Array.from({ length: n2 }, (_, i) => mRanges[i] || { min: '', max: '' })); }}>
          <option value="1">${tr('Одно число')}</option><option value="2">${tr('Два (как давление)')}</option><option value="3">${tr('Три')}</option></select></label>
    </div>
    ${Array.from({ length: mCount }, (_, i) => html`<div class="field-row" key=${i}>
      ${mCount > 1 ? html`<label class="field"><span>${tr('Часть {n}', { n: i + 1 })}</span><input value=${mParts[i] || ''} maxlength=${MS.PART_NAME_MAX} onInput=${(e) => setMParts(mParts.map((p, j) => (j === i ? e.target.value : p)))}/></label>` : null}
      <label class="field"><span>${tr('Норма от')}</span><input inputmode="decimal" value=${mRanges[i]?.min ?? ''} placeholder="—"
        onInput=${(e) => setMRanges(mRanges.map((r, j) => (j === i ? { ...r, min: e.target.value } : r)))}/></label>
      <label class="field"><span>до</span><input inputmode="decimal" value=${mRanges[i]?.max ?? ''} placeholder="—"
        onInput=${(e) => setMRanges(mRanges.map((r, j) => (j === i ? { ...r, max: e.target.value } : r)))}/></label>
    </div>`)}
    <${IconPicker} value=${mIcon} fallback="📏" onChange=${setMIcon}/>` : html`
    <div class="field-row">
      <label class="field"><span>${med ? tr('Форма') : tr('Единица')}</span>
        <select value=${unit} onChange=${(e) => setUnit(e.target.value)}>${(med ? MED_UNITS : F.UNITS).map((u) => html`<option value=${u.key}>${u.label}</option>`)}</select></label>
      ${med ? html`<label class="field"><span>Обычная доза, ${MED_UNIT[unit]?.short || ''}</span><input inputmode="decimal" value=${dose} onInput=${(e) => setDose(e.target.value)}/></label>`
        : html`<label class="field"><span>Штрихкод</span><input inputmode="numeric" value=${code} placeholder="необязательно" onInput=${(e) => setCode(e.target.value)}/></label>`}
    </div>
    ${med ? html`<div class="field-row">
      <label class="field"><span>Штрихкод</span><input inputmode="numeric" value=${code} placeholder="необязательно" onInput=${(e) => setCode(e.target.value)}/></label>
    </div>` : html`<div class="field-row">
      <label class="field"><span>${tr('Порция — название')}</span><input value=${servingName} maxlength="40" placeholder=${tr('например, стакан')} onInput=${(e) => setServingName(e.target.value)}/></label>
      <label class="field"><span>Порция, ${unit === 'ml' ? tr('мл') : tr('г')}</span><input inputmode="decimal" value=${serving} placeholder="необязательно" onInput=${(e) => setServing(e.target.value)}/></label>
    </div>`}
    ${warn ? html`<p class="hint warn">${warn}</p>` : null}`}
    <label class="field"><span>Заметка</span>
      <textarea class="note-area" rows="2" maxlength=${F.NOTE_MAX} value=${note} placeholder=${med ? tr('необязательно: как принимать, курс…') : tr('необязательно: где купить, как готовить…')}
        onInput=${(e) => setNote(e.target.value)}></textarea></label>
    ${measure ? null : html`<label class="field"><span>${med ? tr('Производитель') : tr('Бренд')}</span><input value=${brand} placeholder="необязательно" onInput=${(e) => setBrand(e.target.value)}/></label>`}
    ${med ? html`<${IconPicker} value=${icon} fallback="💊" onChange=${setIcon}/>` : null}
    ${measure ? null : med ? html`<button type="button" class="link-btn" aria-expanded=${medNutrOpen} onClick=${() => setMedNutrOpen(!medNutrOpen)}>
        <${Icon} name=${medNutrOpen ? 'chevronDown' : 'chevron'} size=${16}/> КБЖУ, витамины и минералы (сироп, витамины)</button>
      ${medNutrOpen ? html`<${NutrientEditor} nutrients=${nutr} unit="g" per=${tr('1 {u}', { u: MED_UNIT[unit]?.short || '' })} onChange=${setNutr}/>` : null}`
      : html`<${NutrientEditor} nutrients=${nutr} unit=${unit} onChange=${setNutr}/>`}
    <div class="sheet-actions">
      <button type="button" class="btn" onClick=${onBack}>Назад</button>
      <button type="submit" class="btn primary" disabled=${!name.trim() || readOnly()}>${measure ? tr('Сохранить замер') : med ? tr('Сохранить лекарство') : tr('Сохранить продукт')}</button>
    </div>
  </form>`;
}

/** Быстрая запись: только калории (и, если хочется, БЖУ) — без продукта. */
function QuickStep({ meta, entryMode, onBack, onAdd, onSave }) {
  const [name, setName] = useState('');
  const [n, setN] = useState({});
  const ok = num(n.kcal) || num(n.protein) || num(n.fat) || num(n.carbs);
  const [itemNote, setItemNote] = useState('');
  const items = () => [{ key: ++basketKey, quick: { name, nutrients: n }, amount: 1, note: itemNote }];
  const go = (fn) => (ok ? fn(items()) : showSnackbar(tr('Укажи калории или БЖУ')));
  return html`<form class="add-quick" onSubmit=${(e) => { e.preventDefault(); go(onSave); }}>
    <label class="field"><span>Что съел(а)</span><input value=${name} ref=${focusOnce} placeholder="Быстрая запись" onInput=${(e) => setName(e.target.value)}/></label>
    <div class="ne-main">
      ${['kcal', ...MACROS].map((k) => html`<${NumField} key=${k} big label=${NUTRIENT[k].label} unit=${NUTRIENT[k].unit}
        value=${nv(n, k)} onCommit=${(v) => setN({ ...n, [k]: v })}/>`)}
    </div>
    <input class="item-note-input" value=${itemNote} maxlength=${F.NOTE_MAX} placeholder="Заметка к продукту (необязательно)"
      aria-label="Заметка к продукту" onInput=${(e) => setItemNote(e.target.value)}/>
    ${entryMode ? null : html`<${EntryMeta} ...${meta}/>`}
    <div class="sheet-actions">
      <button type="button" class="btn" onClick=${onBack}>Назад</button>
      <button type="button" class="btn" disabled=${readOnly()} onClick=${() => go(onAdd)}><${Icon} name="plus" size=${18}/> Ещё</button>
      <button type="submit" class="btn primary" disabled=${readOnly()}>${entryMode ? tr('Добавить в запись') : tr('Записать')}</button>
    </div>
  </form>`;
}

/** Шаг «Запись»: собранные продукты и лекарства (количество можно поправить), время, рацион, заметки. */
function ReviewStep({ basket, setBasket, meta, entryMode, onMore, onSave }) {
  const setAmount = (key, v) => setBasket(basket.map((it) => (it.key === key ? { ...it, amount: num(v) } : it)));
  const setNote = (key, v) => setBasket(basket.map((it) => (it.key === key ? { ...it, note: v } : it)));
  const total = sumNutrients(basket.map(basketNutrients));
  return html`<div class="add-review">
    <ul class="item-edit-list">
      ${basket.map((it) => html`<li key=${it.key} class="item-edit">
        <span class="ie-name">${basketName(it)}</span>
        ${it.values ? html`<span class="ie-values">${basketAmount(it)}</span>` : html`<${NumField} label="Сколько" value=${it.amount} unit=${it.quick ? tr('порц.') : unitLabel(basketFood(it))}
          onCommit=${(v) => setAmount(it.key, v)}/>`}
        <b class="ie-kcal">${F.isMeasure(basketFood(it)) ? '' : F.isMed(basketFood(it)) && !nv(basketNutrients(it), 'kcal') ? F.kindIcon(basketFood(it)) : fmt(nv(basketNutrients(it), 'kcal'), 'kcal')}</b>
        <button type="button" class="icon-btn small" aria-label=${tr('Убрать ') + basketName(it)} onClick=${() => setBasket(basket.filter((x) => x.key !== it.key))}>
          <${Icon} name="close" size=${16}/></button>
        <input class="item-note-input ie-note" value=${it.note || ''} maxlength=${F.NOTE_MAX} placeholder="Заметка к продукту"
          aria-label=${tr('Заметка: ') + basketName(it)} onInput=${(e) => setNote(it.key, e.target.value)}/>
      </li>`)}
    </ul>
    <button type="button" class="btn small" onClick=${onMore}><${Icon} name="plus" size=${16}/> Ещё продукт или лекарство</button>
    ${entryMode ? null : html`<${EntryMeta} ...${meta}/>`}
    <div class="aa-total"><b>${fmt(nv(total, 'kcal'), 'kcal')} ккал</b><span class="muted">${macroLine(total)}</span></div>
    <div class="sheet-actions">
      <button type="button" class="btn primary" disabled=${!basket.length || basket.some((it) => !itemReady(it)) || readOnly()} onClick=${() => onSave(null)}>
        ${entryMode ? tr('Добавить в запись') : tr('Записать: {p0}', { p0: countLabel(basket.length, ['позиция', 'позиции', 'позиций']) })}</button>
    </div>
  </div>`;
}

/**
 * Лист «Записать еду». date — день дневника, meal — рацион (по умолчанию — по времени), foodId — сразу к количеству,
 * scan — сразу открыть сканер, entryId — добавить в уже существующую запись, kind — 'med', чтобы сразу показать лекарства.
 * Запись может состоять из нескольких продуктов и лекарств: «+ Ещё» собирает их, «Записать» сохраняет одной записью.
 */
export function AddFoodSheet({ date = store.now.today, meal: initialMeal = null, foodId = null, scan = false, entryId = null, kind: initialKind = 'all', note: noteMode = false }) {
  const entry = entryId ? store.feast.entries.get(entryId) : null;
  const entryMode = !!entry && !entry.deletedAt;
  const [meal, setMeal] = useState(initialMeal || F.mealByTime(store.feast, date, store.now.time));
  const [time, setTime] = useState(store.now.time);
  const [notes, setNotes] = useState(() => (noteMode ? [newNote()] : []));
  const [basket, setBasket] = useState([]);
  const [step, setStep] = useState(foodId ? (F.isMeasure(store.feast.foods.get(foodId)) ? 'measure' : 'amount') : scan ? 'scan' : noteMode ? 'note' : 'pick');
  const [food, setFood] = useState(foodId ? store.feast.foods.get(foodId) : null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState(initialKind);
  const [newCode, setNewCode] = useState(null);
  const [createKind, setCreateKind] = useState('food');
  const list = useMemo(() => pickList(q, kind), [q, kind, store.version]);
  const meta = { date, meal, setMeal, time, setTime, notes, setNotes };
  const pick = (f) => {
    setFood(f);
    setStep(F.isMeasure(f) ? 'measure' : 'amount');
  };
  const noteOnly = () => {
    if (!notes.length) setNotes([newNote()]);
    setStep('note');
  };
  const onCode = (code) => {
    const f = F.findByBarcode(store.feast, code);
    if (f) {
      showSnackbar(tr('Найден: {name}', { name: f.name }));
      pick(f);
    } else {
      setNewCode(code);
      setCreateKind(kind === 'med' || kind === 'measure' ? kind : 'food');
      setStep('create');
    }
  };
  const add = (items) => {
    setBasket([...basket, ...items]);
    setQ('');
    setStep('pick');
  };
  const save = async (items) => {
    const all = (items ? [...basket, ...items] : basket).filter(itemReady);
    // 0.13: без продуктов — запись-заметка (если заметка есть)
    if (!all.length && !(items && !items.length && notes.some((n) => n.text.trim()))) return;
    const clean = all.map(({ key, ...rest }) => rest);
    if (entryMode) {
      if (await FA.addToEntry(entryId, clean)) openSheet('entry', { id: entryId });
      return;
    }
    if (await FA.addEntry({ date, meal, time, notes: notes.map((n) => n.text), items: clean })) closeSheet();
  };
  const create = (k) => {
    setNewCode(null);
    setCreateKind(k);
    setStep('create');
  };
  const titles = {
    pick: entryMode ? tr('Добавить в запись') : basket.length ? tr('Ещё') : kind === 'med' ? tr('Записать лекарство') : kind === 'measure' ? tr('Записать замер') : tr('Записать еду'),
    amount: food && F.isMed(food) ? tr('Доза') : tr('Сколько'), scan: tr('Штрихкод'), measure: tr('Замер'), note: tr('Заметка'),
    create: newCode ? `${createKind === 'med' ? tr('Новое лекарство') : tr('Новый продукт')} · ${newCode}` : createKind === 'med' ? tr('Новое лекарство') : createKind === 'measure' ? tr('Новый замер') : tr('Новый продукт'),
    quick: tr('Быстрая запись'), review: entryMode ? tr('Добавить в запись') : tr('Запись'),
  };
  const back = () => setStep(basket.length && step === 'pick' ? 'review' : 'pick');
  const empty = kind === 'measure' ? tr('Замеров пока нет — создай свой или выбери из известных: глюкоза, давление, пульс…')
    : kind === 'med' ? tr('Лекарств пока нет — создай первое: название, форма и обычная доза.')
    : tr('Продуктов пока нет. Создай свой или отсканируй штрихкод — он сохранится в базе.');

  return html`
    <${Sheet} title=${titles[step]} onClose=${closeSheet} className="add-food-sheet">
      ${step === 'pick' ? html`
        ${entryMode ? html`<p class="muted small">В запись «${F.entryTitle(entry)}» · ${humanDate(entry.date, store.now.today)}${entry.time ? ' · ' + entry.time : ''}</p>` : null}
        <${BasketStrip} items=${basket} onRemove=${(k) => setBasket(basket.filter((x) => x.key !== k))} onDone=${() => setStep('review')}
          doneLabel=${entryMode ? tr('Добавить') : tr('Записать')}/>
        <div class="search-field add-search">
          <${Icon} name="search" size=${16}/>
          <input type="search" value=${q} ref=${focusOnce} placeholder="Продукт, лекарство, бренд или цифры штрихкода" aria-label="Найти продукт или лекарство"
            onInput=${(e) => setQ(e.target.value)}/>
        </div>
        <div class="chip-row add-kinds" role="radiogroup" aria-label="Что показывать">
          ${KINDS.map(([k, l]) => html`<button type="button" role="radio" key=${k} aria-checked=${kind === k} class=${'chip' + (kind === k ? ' selected' : '')} onClick=${() => setKind(k)}>${l}</button>`)}
        </div>
        <div class="add-actions">
          <button type="button" class="btn" onClick=${() => setStep('scan')}><${Icon} name="barcode" size=${18}/> Штрихкод</button>
          ${kind === 'all' || kind === 'food' ? html`<button type="button" class="btn" onClick=${() => create('food')}><${Icon} name="plus" size=${18}/> Новый продукт</button>` : null}
          ${kind === 'all' || kind === 'med' ? html`<button type="button" class="btn" onClick=${() => create('med')}><${Icon} name="plus" size=${18}/> Новое лекарство</button>` : null}
          ${kind === 'all' || kind === 'measure' ? html`<button type="button" class="btn" onClick=${() => create('measure')}><${Icon} name="plus" size=${18}/> Новый замер</button>` : null}
          ${kind === 'all' || kind === 'food' ? html`<button type="button" class="btn" onClick=${() => setStep('quick')}><${Icon} name="flame" size=${18}/> Только калории</button>` : null}
          ${!entryMode && !basket.length ? html`<button type="button" class="btn" onClick=${noteOnly}>📝 Только заметка</button>` : null}
        </div>
        ${Array.isArray(list) ? html`
          ${list.length ? list.slice(0, 60).map((f) => html`<${FoodPickRow} key=${f.id} food=${f} onPick=${pick}/>`)
            : html`<p class="muted add-empty">Не нашлось. <button type="button" class="link-btn" onClick=${() => create(kind === 'med' || kind === 'measure' ? kind : 'food')}>Создать «${q.trim()}»</button></p>`}` : html`
          ${list.recent.length ? html`<h4 class="add-sub">Недавние</h4>${list.recent.map((f) => html`<${FoodPickRow} key=${f.id} food=${f} onPick=${pick}/>`)}` : null}
          ${list.rest.length ? html`<h4 class="add-sub">${list.recent.length ? tr('Все') : kind === 'med' ? tr('Лекарства') : kind === 'measure' ? tr('Замеры') : tr('Продукты')}</h4>${list.rest.slice(0, 80).map((f) => html`<${FoodPickRow} key=${f.id} food=${f} onPick=${pick}/>`)}` : null}
          ${!list.recent.length && !list.rest.length ? html`<p class="muted add-empty">${empty}</p>` : null}`}` : null}
      ${step === 'amount' && food ? html`<${AmountStep} key=${food.id} food=${food} meta=${meta} basket=${basket} entryMode=${entryMode}
        onBack=${back} onAdd=${add} onSave=${save}/>` : null}
      ${step === 'measure' && food ? html`<${MeasureStep} key=${food.id} food=${food} meta=${meta} entryMode=${entryMode} onBack=${back} onAdd=${add} onSave=${save}/>` : null}
      ${step === 'note' ? html`<${NoteStep} meta=${meta} onBack=${back} onSave=${save}/>` : null}
      ${step === 'scan' ? html`<${BarcodeScanner} onCode=${onCode} onCancel=${back}/>` : null}
      ${step === 'create' ? html`<${CreateStep} key=${createKind} barcode=${newCode} name=${q} kind=${createKind} onBack=${back}
        onCreated=${(f) => { showSnackbar(tr('{p0} «{name}» сохранено', { p0: F.isMed(f) ? tr('Лекарство') : F.isMeasure(f) ? tr('Замер') : tr('Продукт'), name: f.name })); pick(f); }}/>` : null}
      ${step === 'quick' ? html`<${QuickStep} meta=${meta} entryMode=${entryMode} onBack=${back} onAdd=${add} onSave=${save}/>` : null}
      ${step === 'review' ? html`<${ReviewStep} basket=${basket} setBasket=${setBasket} meta=${meta} entryMode=${entryMode}
        onMore=${() => setStep('pick')} onSave=${save}/>` : null}
    <//>`;
}

/** Лист записи дневника: время, рацион, продукты и лекарства (количество, убрать, добавить ещё), заметки, удалить. */
export function EntrySheet({ id }) {
  const e = store.feast.entries.get(id);
  const items = e && !e.deletedAt ? F.entryItems(e) : [];
  const [amounts, setAmounts] = useState(() => Object.fromEntries(items.map((it) => [it.id, it.amount])));
  const [vals, setVals] = useState(() => Object.fromEntries(items.filter(F.isMeasure).map((it) => [it.id, (it.values || [it.amount]).map((v) => (v == null ? '' : dec(v)))])));
  const [notes, setNotes] = useState(() => Object.fromEntries(items.map((it) => [it.id, it.note || ''])));
  const [entryNotes, setEntryNotes] = useState(() => F.entryNoteList(e).map((n) => ({ key: n.id, id: n.id, text: n.text })));
  const [removed, setRemoved] = useState([]);
  const [moving, setMoving] = useState(null);
  const [meal, setMeal] = useState(e?.meal || 'snack');
  const [time, setTime] = useState(e?.time || null);
  if (!e || e.deletedAt) return null;
  const live = items.filter((it) => !removed.includes(it.id));
  const amountOf = (it) => (it.id in amounts ? amounts[it.id] : it.amount);
  const preview = sumNutrients(live.map((it) => itemNutrients({ ...it, amount: amountOf(it) })));
  const noteChanges = () => {
    const before = F.entryNoteList(e);
    const edits = {};
    for (const n of before) {
      const now = entryNotes.find((x) => x.id === n.id);
      edits[n.id] = now ? now.text : '';
    }
    // если первую (основную) заметку убрали, а новые есть — первая новая становится основной
    const added = entryNotes.filter((x) => !x.id && x.text.trim()).map((x) => x.text);
    return { edits, added };
  };
  const valuesOf = (it) => MS.cleanValues(vals[it.id], (vals[it.id] || []).length);
  const changes = () => ({ meal, time, amounts: Object.fromEntries(live.filter((it) => !F.isMeasure(it)).map((it) => [it.id, amountOf(it)])),
    values: Object.fromEntries(live.filter(F.isMeasure).map((it) => [it.id, valuesOf(it)]).filter(([, v]) => v)),
    notes: Object.fromEntries(live.map((it) => [it.id, notes[it.id] ?? ''])), removed, entryNotes: noteChanges() });
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
  const unitOf = (it) => (it.unit === 'portion' ? tr('шт.') : MED_UNIT[it.unit] ? MED_UNIT[it.unit].short : it.unit === 'ml' ? tr('мл') : tr('г'));
  // 0.14.1: перенести продукт в другую запись этого дня или отдельной записью (без перетаскивания — с телефона)
  const others = Object.values(F.dayEntries(store.feast, e.date)).flat().filter((x) => x.id !== id && !x.deletedAt)
    .sort((a, b) => ((a.time || '') < (b.time || '') ? -1 : 1));
  const moveTo = async (itemId, value) => {
    if (!value) return;
    await FA.saveEntry(id, changes());
    closeSheet();
    await FA.moveEntryItem(id, itemId, value === 'new' ? { meal } : { entryId: value });
  };
  return html`
    <${Sheet} title=${F.entryTitle(e)} onClose=${closeSheet} className="entry-sheet">
      <ul class="item-edit-list">
        ${live.map((it) => html`<li key=${it.id} class="item-edit">
          <span class="ie-name">${F.isMed(it) || F.isMeasure(it) ? (F.kindIcon(foodOf(it)) || F.kindIcon(it)) + ' ' : ''}${foodOf(it) ? html`<button type="button" class="link-btn" onClick=${() => { closeSheet(); openFood(it.foodId); }}>${it.name}</button>` : it.name}</span>
          ${F.isMeasure(it) ? html`<${MeasureInputs} m=${foodOf(it) || { name: it.name, unit: it.unit, parts: (it.values || []).length > 1 ? it.values.map((_, i) => tr('Значение {n}', { n: i + 1 })) : [] }}
            values=${vals[it.id] || ['']} setValues=${(v) => setVals({ ...vals, [it.id]: v })}/>` : html`<${NumField} label=${it.unit === 'portion' ? tr('Порций') : F.isMed(it) ? tr('Доза') : tr('Сколько')} value=${amountOf(it)} unit=${unitOf(it)}
            onCommit=${(v) => setAmounts({ ...amounts, [it.id]: num(v) })}/>`}
          <b class="ie-kcal">${F.isMed(it) || F.isMeasure(it) ? '' : fmt(nv(itemNutrients({ ...it, amount: amountOf(it) }), 'kcal'), 'kcal')}</b>
          <button type="button" class=${'icon-btn small' + (moving === it.id ? ' active' : '')} aria-label=${tr('Перенести в другую запись: ') + it.name} title=${tr('Перенести в другую запись')}
            aria-expanded=${moving === it.id} disabled=${readOnly() || (!others.length && live.length < 2)} onClick=${() => setMoving(moving === it.id ? null : it.id)}><${Icon} name="move" size=${16}/></button>
          <button type="button" class="icon-btn small" aria-label=${tr('Убрать из записи: ') + it.name} disabled=${readOnly()}
            onClick=${() => setRemoved([...removed, it.id])}><${Icon} name="close" size=${16}/></button>
          ${moving === it.id ? html`<label class="field ie-move"><span>${tr('Перенести «{name}» в', { name: it.name })}</span>
            <select onChange=${(ev) => moveTo(it.id, ev.target.value)}>
              <option value="">${tr('Выбери запись…')}</option>
              ${others.map((x) => html`<option value=${x.id} key=${x.id}>${[x.time, F.mealName(F.mealInfo(store.feast, x.meal)), F.entryTitle(x)].filter(Boolean).join(' · ')}</option>`)}
              ${live.length > 1 || F.entryNoteList(e).length ? html`<option value="new">${tr('Отдельной записью')}</option>` : null}
            </select></label>` : null}
          <input class="item-note-input ie-note" value=${notes[it.id] ?? ''} maxlength=${F.NOTE_MAX} disabled=${readOnly()}
            placeholder=${F.isMed(it) ? tr('Заметка к приёму') : tr('Заметка к продукту: например, 4 ед. инсулина')} aria-label=${tr('Заметка: ') + it.name}
            onInput=${(ev) => setNotes({ ...notes, [it.id]: ev.target.value })}/>
        </li>`)}
      </ul>
      ${!live.length && !entryNotes.some((n) => n.text.trim()) ? html`<p class="hint warn">В записи не осталось ни продуктов, ни заметок — при сохранении она удалится.</p>` : null}
      <button type="button" class="btn small" disabled=${readOnly()} onClick=${addMore}><${Icon} name="plus" size=${16}/> Добавить продукт, лекарство или замер</button>
      <${EntryMeta} date=${e.date} meal=${meal} setMeal=${setMeal} time=${time} setTime=${setTime} notes=${entryNotes} setNotes=${setEntryNotes} allowEmptyTime=${!e.time}/>
      <div class="aa-total"><b>${fmt(nv(preview, 'kcal'), 'kcal')} ккал</b><span class="muted">${macroLine(preview)}</span>
        <span class="muted">${humanDate(e.date, store.now.today)} · было ${fmt(nv(entryNutrients(e), 'kcal'), 'kcal')} ккал</span></div>
      <div class="sheet-actions">
        <button type="button" class="btn danger-outline" disabled=${readOnly()} onClick=${() => { closeSheet(); FA.deleteEntries([id]); }}>
          <${Icon} name="trash" size=${16}/> Удалить запись</button>
        <button type="button" class="btn primary" disabled=${readOnly() || live.some((it) => (F.isMeasure(it) ? !valuesOf(it) : !amountOf(it)))} onClick=${save}>Сохранить</button>
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
    <${Sheet} title=${code ? tr('Новый продукт · {code}', { code }) : tr('Сканировать штрихкод')} onClose=${closeSheet}>
      ${code ? html`<p class="hint">Такого кода в твоей базе ещё нет — заполни продукт или лекарство, и в следующий раз оно найдётся по штрихкоду.</p>
        <${CreateStep} barcode=${code} onBack=${() => setCode(null)} onCreated=${(f) => { closeSheet(); openFood(f.id); }}/>`
        : html`<${BarcodeScanner} onCode=${onCode} onCancel=${closeSheet}
          hint=${target === 'open' ? tr('Наведи камеру на штрихкод: своё откроется, новое — создадим') : tr('Наведи камеру на штрихкод — он привяжется')}/>`}
    <//>`;
}

/** Открыть лист «Записать еду» на день дневника (из дока, клавишей N, из рациона); kind: 'med' — сразу лекарства. */
export function openAddFood(opts = {}) {
  if (store.ui.feastReadOnly) {
    showSnackbar(store.ui.feastReadOnly);
    return;
  }
  openSheet('addFood', { date: opts.date || currentDiaryDate(), meal: opts.meal || null, foodId: opts.foodId || null, scan: !!opts.scan,
    entryId: opts.entryId || null, kind: opts.kind || 'all', note: !!opts.note });
}

/** День, открытый в дневнике (из адреса #/diary?date=…), иначе сегодня. */
export function currentDiaryDate() {
  const m = location.hash.match(/^#\/diary\?(?:.*&)?date=(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : store.now.today;
}
