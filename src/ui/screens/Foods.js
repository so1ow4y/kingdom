// Feast (обновление 0.11): «Продукты» — своя база продуктов таблицей, как обозреватель задач: строка
// «поле:значение», топ значений справа, галочки и массовые действия, раскрытие строки; карточка продукта
// открывается справа (на широком экране) или на весь экран: КБЖУ, витамины и минералы (по умолчанию нули),
// несколько штрихкодов (сканер или вручную), дата создания.

import { html, useState, useMemo } from '../html.js';
import { Icon } from '../icons.js';
import { openFood, currentFoodId, Link } from '../router.js';
import { store, openSheet, confirm } from '../../store/appState.js';
import * as FA from '../../store/feastActions.js';
import * as F from '../../core/feast.js';
import { FOOD_FIELDS, FOOD_PLACEHOLDER, makeFoodContext, searchFoods, foodFacets, facetTerm } from '../../core/foodQuery.js';
import { withTerm } from '../../core/query.js';
import { nv, fmt, MACROS, NUTRIENT } from '../../core/nutrition.js';
import { encodeEan, normalizeBarcode, barcodeWarning } from '../../core/barcode.js';
import { formatMoment, localDateOf, longDate } from '../../core/dates.js';
import { countLabel } from '../../core/plural.js';
import { useSelection } from '../components/Explorer.js';
import { NutrientEditor, NutrientTable, macroLine, RewardEditor } from '../components/FeastParts.js';
import { openAddFood } from '../components/AddFood.js';

const PAGE = 50;
const SYNTAX = '· * — подстановка · пробел — оба условия · OR — любое · - — исключить · числа: >200, <5, 100..300';
const readOnly = () => !!store.ui.feastReadOnly;

/** Штрихкод картинкой (EAN-13/EAN-8) или просто цифрами. */
export function BarcodeImage({ code, height = 34 }) {
  const mods = encodeEan(code);
  if (!mods) return null; // не EAN (или контрольная цифра не сходится) — только цифры рядом
  const w = mods.length + 14;
  return html`<svg class="bc-svg" viewBox=${`0 0 ${w} ${height}`} width=${w * 1.6} height=${height} role="img" aria-label=${'Штрихкод ' + code}
    preserveAspectRatio="none">
    <rect width=${w} height=${height} fill="#fff"/>
    ${mods.map((b, i) => (b ? html`<rect key=${i} x=${7 + i} y="2" width="1" height=${height - 4} fill="#000"/>` : null))}
  </svg>`;
}

function Facets({ list, onFilter }) {
  return html`<aside class="ex-facets" aria-label="Топ значений">
    ${list.map((f) => {
      const max = Math.max(1, ...f.values.map((v) => v.count));
      return html`<div class="ex-card" key=${f.field + (f.label || '')}>
        <p class="ex-facet-title">Топ: ${f.label || f.field}</p>
        ${!f.values.length ? html`<p class="ex-empty small">—</p>` : null}
        <ul class="ex-facet-list">
          ${f.values.map((v) => html`<li key=${v.value} class="ex-facet">
            <span class="ex-facet-bar" style=${{ width: (v.count / max) * 100 + '%' }}></span>
            <button type="button" class="ex-facet-value" title=${v.value} onClick=${() => onFilter(f.field, v.value)}>${v.value}</button>
            <span class="ex-facet-count">${v.count}</span>
            <button type="button" class="ex-facet-op" aria-label="Фильтровать по значению" title="Фильтровать по значению" onClick=${() => onFilter(f.field, v.value)}><${Icon} name="plus" size=${14}/></button>
            <button type="button" class="ex-facet-op" aria-label="Исключить значение" title="Исключить значение" onClick=${() => onFilter(f.field, v.value, true)}><${Icon} name="minus" size=${14}/></button>
          </li>`)}
        </ul>
      </div>`;
    })}
  </aside>`;
}

const SORTS = [['created', 'Сначала новые'], ['name', 'По названию'], ['kcal', 'Калорийнее'], ['protein', 'Больше белка'], ['uses', 'Чаще ем']];

export function FoodsScreen({ query = {} }) {
  const [draft, setDraft] = useState(query.q || '');
  const [q, setQ] = useState(query.q || '');
  const [sort, setSort] = useState('created');
  const [skip, setSkip] = useState(0);
  const [open, setOpen] = useState(() => new Set());
  const selection = useSelection();
  const tz = store.data.settings.timeZone;
  const res = useMemo(() => {
    const ctx = makeFoodContext(store.feast, tz);
    const r = searchFoods(ctx, q, sort);
    return { ...r, ctx, facets: foodFacets(ctx, r.rows) };
  }, [store.version, q, sort, tz]);
  const total = res.rows.length;
  const page = res.rows.slice(skip, skip + PAGE);
  const apply = (next) => {
    setDraft(next);
    setQ(next);
    setSkip(0);
  };
  const addTerm = (field, value, negate = false) => {
    const [f, v, neg] = facetTerm(field, value);
    apply(withTerm(q, f, v, negate !== neg));
  };
  const toggleOpen = (id) => setOpen((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const del = async (ids) => {
    if (!(await confirm({ title: 'Удалить продукты?', text: `Затронет ${countLabel(ids.length, ['продукт', 'продукта', 'продуктов'])}. Записи в дневнике останутся.`, confirmLabel: 'Удалить', danger: true }))) return;
    const r = await FA.deleteFoods(ids);
    if (r) selection.clear();
  };
  const current = currentFoodId();
  const picked = page.map((f) => f.id);
  const pickedOnPage = picked.filter((id) => selection.has(id)).length;

  return html`
    <div class="screen foods">
      <header class="page-header">
        <p class="page-desc">Твоя база продуктов: ${countLabel([...store.feast.foods.values()].filter((f) => !f.deletedAt).length, ['продукт', 'продукта', 'продуктов'])}.
          Значения — на 100 г (или 100 мл), чего не указано — ноль. К продукту можно привязать несколько штрихкодов.</p>
        <div class="page-actions">
          <button type="button" class="btn" disabled=${readOnly()} onClick=${() => openSheet('scan', { target: 'open' })}><${Icon} name="barcode" size=${16}/> Сканировать</button>
          <button type="button" class="btn primary" disabled=${readOnly()} onClick=${async () => { const f = await FA.createFood({ name: 'Новый продукт' }); if (f) openFood(f.id); }}>
            <${Icon} name="plus" size=${16}/> Новый продукт</button>
        </div>
      </header>
      <div class="explorer">
        <form class="ex-query" onSubmit=${(e) => { e.preventDefault(); apply(draft); }}>
          <div class="ex-query-row">
            <div class="search-field ex-search">
              <${Icon} name="search" size=${16}/>
              <input value=${draft} data-search-input placeholder=${FOOD_PLACEHOLDER} spellcheck="false" autocomplete="off" aria-label="Строка поиска"
                onInput=${(e) => setDraft(e.target.value)}/>
            </div>
            <select class="ex-range" value=${sort} aria-label="Порядок" onChange=${(e) => setSort(e.target.value)}>
              ${SORTS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
            </select>
            <button type="submit" class="btn primary">Найти</button>
            ${q ? html`<button type="button" class="btn ghost" onClick=${() => apply('')}><${Icon} name="close" size=${16}/> Сбросить фильтры</button>` : null}
          </div>
          <div class="ex-fields">
            <span>Поля:</span>
            ${Object.keys(FOOD_FIELDS).map((f) => html`<button type="button" class="ex-field" key=${f} onClick=${() => setDraft((d) => `${d.trim()} ${f}:`.trim())}>${f}:</button>`)}
            <span class="ex-syntax">${SYNTAX}</span>
          </div>
        </form>
        ${res.error ? html`<p class="ex-error" role="alert">${res.error}</p>` : null}
        <div class="ex-grid">
          <div class="ex-main">
            ${selection.size ? html`<div class="ex-bulk" role="region" aria-label="Действия с выбранными">
              <span class="ex-bulk-count">Выбрано ${selection.size}</span>
              <div class="ex-bulk-actions">
                <button type="button" class="btn small danger-outline" disabled=${readOnly()} onClick=${() => del(selection.ids)}><${Icon} name="trash" size=${16}/> Удалить</button>
              </div>
              <button type="button" class="btn small ghost ex-bulk-clear" onClick=${selection.clear}><${Icon} name="close" size=${16}/> Снять выбор</button>
            </div>` : null}
            <div class="ex-table-wrap">
              <table class="ex-table foods-table">
                <thead><tr>
                  <th class="ex-w-check"><input type="checkbox" class="ex-check" aria-label="Выбрать всю страницу"
                    checked=${pickedOnPage > 0 && pickedOnPage === picked.length} ref=${(el) => el && (el.indeterminate = pickedOnPage > 0 && pickedOnPage < picked.length)}
                    onChange=${() => selection.togglePage(picked)}/></th>
                  <th class="ex-w-chev"></th>
                  <th>Продукт</th>
                  <th class="num">ккал</th>
                  ${MACROS.map((k) => html`<th class="num ex-col-list" key=${k}>${NUTRIENT[k].short}</th>`)}
                  <th class="ex-col-prio">Штрихкоды</th>
                  <th class="ex-col-time">Создан</th>
                </tr></thead>
                <tbody>
                  ${!page.length ? html`<tr><td colSpan="9" class="ex-empty-row">${q ? 'Ничего не найдено.' : 'Продуктов пока нет — создай свой или отсканируй штрихкод.'}</td></tr>` : null}
                  ${page.map((f) => {
                    const codes = F.foodBarcodes(f);
                    const isOpen = open.has(f.id);
                    const uses = res.ctx.usage.get(f.id)?.count || 0;
                    return html`
                      <tr key=${f.id} class=${'ex-row' + (selection.has(f.id) ? ' selected' : '') + (current === f.id ? ' current' : '')} onClick=${() => toggleOpen(f.id)} aria-expanded=${isOpen}>
                        <td class="ex-w-check" onClick=${(e) => e.stopPropagation()}><input type="checkbox" class="ex-check" aria-label="Выбрать строку"
                          checked=${selection.has(f.id)} onChange=${() => selection.toggle(f.id)}/></td>
                        <td class="ex-w-chev"><${Icon} name=${isOpen ? 'chevronDown' : 'chevron'} size=${16}/></td>
                        <td class="ex-title-cell">
                          <button type="button" class="ex-title" onClick=${(e) => { e.stopPropagation(); openFood(f.id); }}>${f.favorite ? '★ ' : ''}${f.name}</button>
                          ${f.brand ? html`<button type="button" class="ex-value fd-brand" onClick=${(e) => { e.stopPropagation(); addTerm('бренд', f.brand); }}>${f.brand}</button>` : null}
                          <div class="ex-narrow-meta"><span>${macroLine(f.nutrients)}</span>${codes.length ? html`<span>▮ ${codes.length}</span>` : null}</div>
                        </td>
                        <td class="num"><b>${fmt(nv(f.nutrients, 'kcal'), 'kcal')}</b></td>
                        ${MACROS.map((k) => html`<td class="num ex-col-list" key=${k}>${fmt(nv(f.nutrients, k), k)}</td>`)}
                        <td class="ex-col-prio">${codes.length ? codes.map((c) => html`<button type="button" key=${c} class="ex-value bc-chip" title="Искать по штрихкоду"
                          onClick=${(e) => { e.stopPropagation(); apply(withTerm(q, 'штрихкод', c)); }}>${c}</button>`) : html`<span class="muted">—</span>`}</td>
                        <td class="ex-col-time ex-time">${formatMoment(f.createdAt, tz)}</td>
                      </tr>
                      ${isOpen ? html`<tr class="ex-details" key=${f.id + ':d'}><td colSpan="9">
                        <div class="ex-details-body">
                          <${NutrientTable} values=${f.nutrients} pct=${false}/>
                          <p class="muted small">${f.unit === 'ml' ? 'На 100 мл' : 'На 100 г'}${f.servingSize ? ` · порция ${fmt(f.servingSize, 'x')} ${f.unit === 'ml' ? 'мл' : 'г'}` : ''} · в дневнике: ${countLabel(uses, ['раз', 'раза', 'раз'])}</p>
                          <div class="ex-details-actions">
                            <button type="button" class="btn small" onClick=${() => openFood(f.id)}><${Icon} name="chevron" size=${16}/> Открыть карточку</button>
                            <button type="button" class="btn small" disabled=${readOnly()} onClick=${() => openAddFood({ foodId: f.id })}><${Icon} name="plus" size=${16}/> В дневник</button>
                            <button type="button" class="btn small danger-outline" disabled=${readOnly()} onClick=${() => del([f.id])}><${Icon} name="trash" size=${16}/> Удалить</button>
                          </div>
                        </div></td></tr>` : null}`;
                  })}
                </tbody>
              </table>
            </div>
            <div class="ex-pager">
              <span>Найдено: ${total}${total > PAGE ? ` · ${skip + 1}–${Math.min(skip + PAGE, total)}` : ''}</span>
              <div class="ex-pager-buttons">
                <button type="button" class="btn small" disabled=${skip === 0} onClick=${() => setSkip(Math.max(0, skip - PAGE))}>Назад</button>
                <button type="button" class="btn small" disabled=${skip + PAGE >= total} onClick=${() => setSkip(skip + PAGE)}>Вперёд</button>
              </div>
            </div>
          </div>
          <${Facets} list=${res.facets} onFilter=${addTerm}/>
        </div>
      </div>
    </div>`;
}

// ---------- Карточка продукта ----------

function TextField({ label, value, onCommit, placeholder = '', maxLength = F.FOOD_NAME_MAX, disabled = false }) {
  const [draft, setDraft] = useState(null);
  const commit = () => {
    if (draft === null) return;
    if (draft !== value) onCommit(draft);
    setDraft(null);
  };
  return html`<label class="field"><span>${label}</span>
    <input value=${draft ?? value ?? ''} placeholder=${placeholder} maxlength=${maxLength} disabled=${disabled}
      onInput=${(e) => setDraft(e.target.value)} onBlur=${commit} onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }}/></label>`;
}

export function FoodCard({ id, panel = false, onClose }) {
  const f = store.feast.foods.get(id);
  const [code, setCode] = useState('');
  const tz = store.data.settings.timeZone;
  if (!f || f.deletedAt) {
    return html`<div class="screen food-card"><div class="task-header"><button class="icon-btn" onClick=${onClose} aria-label="Закрыть"><${Icon} name="close"/></button></div>
      <p class="muted">Продукт удалён или ещё не пришёл с другого устройства.</p></div>`;
  }
  const ro = readOnly();
  const codes = F.foodBarcodes(f);
  const uses = F.foodUsage(store.feast).get(f.id);
  const typed = normalizeBarcode(code);
  const warn = typed ? barcodeWarning(typed) : '';
  const set = (changes) => FA.updateFood(f.id, changes);
  const remove = async () => {
    if (await confirm({ title: `Удалить «${f.name}»?`, text: 'Записи в дневнике останутся — в них сохранены название и значения.', confirmLabel: 'Удалить', danger: true })) {
      onClose();
      FA.deleteFoods([f.id]);
    }
  };
  const addCode = async (e) => {
    e?.preventDefault();
    if (typed && (await FA.attachBarcode(f.id, typed))) setCode('');
  };
  return html`
    <div class=${'screen food-card' + (panel ? ' in-panel' : '')}>
      <div class="task-header">
        <button class="icon-btn" onClick=${onClose} aria-label="Закрыть"><${Icon} name=${panel ? 'close' : 'back'}/></button>
        <span class="fc-kind">Продукт</span>
        <span class="ds-spacer"></span>
        <button class=${'icon-btn' + (f.favorite ? ' fav' : '')} disabled=${ro} onClick=${() => FA.toggleFavorite(f.id)}
          aria-pressed=${!!f.favorite} title=${f.favorite ? 'Убрать из избранного' : 'В избранное'} aria-label="Избранное"><${Icon} name="star" filled=${!!f.favorite}/></button>
        <button class="icon-btn" disabled=${ro} onClick=${() => FA.duplicateFood(f.id).then((c) => c && openFood(c.id))} title="Копия продукта" aria-label="Копия"><${Icon} name="copy2"/></button>
        <button class="icon-btn danger" disabled=${ro} onClick=${remove} title="Удалить продукт" aria-label="Удалить"><${Icon} name="trash"/></button>
      </div>
      <${TextField} label="Название" value=${f.name} disabled=${ro} onCommit=${(v) => set({ name: v })}/>
      <div class="field-row">
        <${TextField} label="Бренд" value=${f.brand} placeholder="необязательно" disabled=${ro} onCommit=${(v) => set({ brand: v })}/>
        <label class="field"><span>Единица</span>
          <select value=${f.unit} disabled=${ro} onChange=${(e) => set({ unit: e.target.value })}>${F.UNITS.map((u) => html`<option value=${u.key}>${u.label}</option>`)}</select></label>
      </div>
      <div class="field-row">
        <${TextField} label="Порция — название" value=${f.servingName} placeholder="например, стакан" maxLength=${40} disabled=${ro} onCommit=${(v) => set({ servingName: v })}/>
        <${TextField} label=${`Порция, ${f.unit === 'ml' ? 'мл' : 'г'}`} value=${f.servingSize ? String(f.servingSize) : ''} placeholder="—" maxLength=${8} disabled=${ro} onCommit=${(v) => set({ servingSize: v })}/>
      </div>

      <h3 class="set-sub">Пищевая ценность</h3>
      <${NutrientEditor} key=${f.id} nutrients=${f.nutrients} unit=${f.unit} disabled=${ro} onChange=${(n) => set({ nutrients: n })}/>

      <h3 class="set-sub">Штрихкоды</h3>
      ${codes.length ? html`<ul class="bc-list">${codes.map((c) => html`<li key=${c}>
        <${BarcodeImage} code=${c}/><span class="bc-code">${c}</span>
        <button type="button" class="icon-btn small" disabled=${ro} aria-label=${'Отвязать ' + c} title="Отвязать" onClick=${() => FA.detachBarcode(f.id, c)}><${Icon} name="close" size=${16}/></button>
      </li>`)}</ul>` : html`<p class="muted small">Штрихкодов нет — продукт можно найти по названию. Привяжи код, чтобы находить его сканером.</p>`}
      <form class="bc-add" onSubmit=${addCode}>
        <input inputmode="numeric" value=${code} placeholder="Цифры штрихкода" aria-label="Штрихкод" disabled=${ro} onInput=${(e) => setCode(e.target.value)}/>
        <button type="submit" class="btn" disabled=${!typed || ro}>Привязать</button>
        <button type="button" class="btn" disabled=${ro} onClick=${() => openSheet('scan', { target: f.id })}><${Icon} name="barcode" size=${16}/> Сканировать</button>
      </form>
      ${warn ? html`<p class="hint warn">${warn}</p>` : null}

      <h3 class="set-sub">Награда за запись</h3>
      <${RewardEditor} key=${'r' + f.id} rewards=${f.rewards || {}} defaults=${F.rewardDefaults(store.feast.settings)} disabled=${ro}
        onChange=${(r) => set({ rewards: r })}/>
      <p class="muted small">Начисляется за каждую запись этого продукта в дневнике, сколько бы ни съел(а). Пустое поле — по умолчанию
        (<${Link} to="/settings?section=feast-rewards">настройки наград<//>). Дробные монеты и 💎 копятся: тратятся целые. Уже сделанные записи
        не пересчитываются.${store.data.settings?.gameEnabled ? '' : ' Игра сейчас выключена — награды копятся, но не видны.'}</p>

      <${TextField} label="Заметка" value=${f.note} placeholder="необязательно" maxLength=${2000} disabled=${ro} onCommit=${(v) => set({ note: v })}/>
      <div class="form-actions">
        <button type="button" class="btn primary" disabled=${ro} onClick=${() => openAddFood({ foodId: f.id })}><${Icon} name="plus" size=${16}/> В дневник</button>
      </div>
      <p class="muted small fc-meta">Создан ${longDate(localDateOf(f.createdAt, tz))} ${localDateOf(f.createdAt, tz).slice(0, 4)} · изменён ${formatMoment(f.updatedAt, tz)}
        · в дневнике ${countLabel(uses?.count || 0, ['раз', 'раза', 'раз'])}</p>
    </div>`;
}
