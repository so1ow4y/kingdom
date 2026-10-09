// Feast (обновление 0.11): «Продукты» — своя база продуктов таблицей, как обозреватель задач: строка
// «поле:значение», топ значений справа, галочки и массовые действия, раскрытие строки; карточка продукта
// открывается справа (на широком экране) или на весь экран: КБЖУ, витамины и минералы (по умолчанию нули),
// несколько штрихкодов (сканер или вручную), дата создания. 0.12.5: каталог общий — продукты и лекарства (фильтр
// «Всё / Продукты / Лекарства», поле «тип:»); у лекарства — форма, обычная доза, без КБЖУ и наград; к продукту можно
// привязать лекарства, которые предлагаются при записи. 0.13: три раздела — «Продукты» (#/foods), «Лекарства»
// (#/foods/meds), «Замеры» (#/foods/measures); у лекарства — скрытое описание и КБЖУ с витаминами на 1 единицу формы,
// у продукта и лекарства — замеры, которые предлагаются при записи; карточка замера — единица, части, норма.

import { html, useState, useMemo } from '../html.js';
import { Icon } from '../icons.js';
import { openFood, currentFoodId, Link, navigate } from '../router.js';
import { store, openSheet, confirm } from '../../store/appState.js';
import * as FA from '../../store/feastActions.js';
import * as F from '../../core/feast.js';
import { FOOD_FIELDS, FOOD_PLACEHOLDER, makeFoodContext, searchFoods, foodFacets, facetTerm, foodFieldLabel } from '../../core/foodQuery.js';
import { withTerm } from '../../core/query.js';
import { nv, fmt, num, MACROS, NUTRIENT, MED_UNITS, MED_UNIT, amountLabel } from '../../core/nutrition.js';
import { encodeEan, normalizeBarcode, barcodeWarning } from '../../core/barcode.js';
import { formatMoment, localDateOf, longDate, humanDate } from '../../core/dates.js';
import * as MS from '../../core/measures.js';
import { countLabel } from '../../core/plural.js';
import { useSelection } from '../components/Explorer.js';
import { NutrientEditor, NutrientTable, macroLine, RewardEditor, IconPicker } from '../components/FeastParts.js';
import { openAddFood } from '../components/AddFood.js';
import { tr, dec } from '../../core/i18n.js';

const PAGE = 50;
const SYNTAX = tr('· * — подстановка · пробел — оба условия · OR — любое · - — исключить · числа: >200, <5, 100..300');
const readOnly = () => !!store.ui.feastReadOnly;

/** Штрихкод картинкой (EAN-13/EAN-8) или просто цифрами. */
export function BarcodeImage({ code, height = 34 }) {
  const mods = encodeEan(code);
  if (!mods) return null; // не EAN (или контрольная цифра не сходится) — только цифры рядом
  const w = mods.length + 14;
  return html`<svg class="bc-svg" viewBox=${`0 0 ${w} ${height}`} width=${w * 1.6} height=${height} role="img" aria-label=${tr('Штрихкод ') + code}
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
        <p class="ex-facet-title">Топ: ${f.label || foodFieldLabel(f.field)}</p>
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

const SORTS = [['created', tr('Сначала новые')], ['name', tr('По названию')], ['kcal', tr('Калорийнее')], ['protein', tr('Больше белка')], ['uses', tr('Чаще ем')]];
export const CATALOG_TABS = [['food', tr('Продукты'), '/foods'], ['med', tr('Лекарства'), '/foods/meds'], ['measure', tr('Замеры'), '/foods/measures']];
const kindOk = (kind, f) => (kind === 'med' ? F.isMed(f) : kind === 'measure' ? F.isMeasure(f) : !F.isMed(f) && !F.isMeasure(f));
const catalogLabel = (n) => countLabel(n, ['запись', 'записи', 'записей']);

/** Новый продукт, лекарство или замер (preset — известный замер) — сразу открыть карточку. */
export async function createCatalogItem(kind = 'food', preset = null) {
  const f = await FA.createFood(kind === 'med' ? { name: tr('Новое лекарство'), kind: 'med', unit: 'tab', dose: 1 }
    : kind === 'measure' ? (preset ? { kind: 'measure', name: preset.name, unit: preset.unit, parts: preset.parts || [], ranges: preset.ranges || [], icon: preset.icon, desc: preset.hint || '' }
      : { kind: 'measure', name: tr('Новый замер'), unit: '' })
      : { name: tr('Новый продукт') });
  if (f) openFood(f.id);
}

/** Вкладки раздела сверху — как у «Аналитики»; в доке те же три пункта. */
function CatalogTabs({ kind }) {
  return html`<div class="section-tabs" role="tablist" aria-label="Каталог">
    ${CATALOG_TABS.map(([k, l, to]) => html`<button type="button" role="tab" key=${k} aria-selected=${kind === k}
      class=${'section-tab' + (kind === k ? ' active' : '')} onClick=${() => navigate(to, { replace: true })}>${l}</button>`)}
  </div>`;
}

/** Раздел «Замеры»: свои и известные замеры, сколько показаний и последнее. */
function MeasuresCatalog() {
  const today = store.now.today;
  const list = [...store.feast.foods.values()].filter((f) => !f.deletedAt && F.isMeasure(f)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const st = useMemo(() => F.measureStats(store.feast, '0000-01-01', today), [store.version, today]);
  const statOf = (id) => st.types.find((t) => t.key === id);
  const presets = MS.MEASURE_PRESETS.filter((p) => !list.some((f) => f.name.toLowerCase() === p.name.toLowerCase()));
  return html`
    <header class="page-header">
      <p class="page-desc">Замеры — глюкоза, давление, пульс, температура, анализы — с единицей и нормой. Показания записываются в «Дневнике»
        (отдельно или вместе с едой и лекарствами), их видно в «Аналитике → Замеры». Можно создать свой замер с любой единицей.</p>
      <div class="page-actions">
        <button type="button" class="btn primary" disabled=${readOnly()} onClick=${() => createCatalogItem('measure')}><${Icon} name="plus" size=${16}/> Новый замер</button>
      </div>
    </header>
    ${presets.length ? html`<section class="card-block">
      <h2 class="block-title">Известные замеры</h2>
      <div class="chip-row wrap">${presets.map((p) => html`<button type="button" class="chip" key=${p.key} disabled=${readOnly()} title=${p.hint || ''}
        onClick=${() => createCatalogItem('measure', p)}>${p.icon} ${p.name} <small class="muted">${p.unit}</small></button>`)}</div>
      <p class="muted small">Нажми — замер появится в списке; единицу, норму и название можно поменять в его карточке.</p>
    </section>` : null}
    <div class="ex-table-wrap"><table class="ex-table foods-table measures-table">
      <thead><tr><th>Замер</th><th>Единица</th><th>Норма</th><th class="num">Показаний</th><th>Последнее</th></tr></thead>
      <tbody>
        ${!list.length ? html`<tr><td colSpan="5" class="ex-empty-row">Замеров пока нет — добавь известный или создай свой.</td></tr>` : null}
        ${list.map((f) => {
          const s = statOf(f.id);
          const st2 = s?.last ? MS.readingStatus(s.last.values, f.ranges) : null;
          return html`<tr key=${f.id} class="ex-row" onClick=${() => openFood(f.id)}>
            <td class="ex-title-cell"><button type="button" class="ex-title" onClick=${(e) => { e.stopPropagation(); openFood(f.id); }}>${f.icon || '📏'} ${f.name}</button>
              ${f.parts?.length ? html`<div class="ex-narrow-meta"><span>${f.parts.join(' / ')}</span></div>` : null}</td>
            <td>${f.unit ? tr(f.unit) : html`<span class="muted">—</span>`}</td>
            <td>${MS.normText({ ...f, unit: '' }) || html`<span class="muted">—</span>`}</td>
            <td class="num">${s?.count || 0}</td>
            <td>${s?.last ? html`${MS.valuesText(s.last.values)}${st2 === 'low' || st2 === 'high' ? html` <span class="tone-danger">⚠</span>` : null}
              <small class="muted"> · ${humanDate(s.last.date, today)}${s.last.time ? ' ' + s.last.time : ''}</small>` : html`<span class="muted">—</span>`}</td>
          </tr>`;
        })}
      </tbody>
    </table></div>`;
}

export function FoodsScreen({ query = {}, tab = null }) {
  const kind = tab === 'meds' || query.kind === 'med' ? 'med' : tab === 'measures' ? 'measure' : 'food';
  if (kind === 'measure') {
    return html`<div class="screen foods"><${CatalogTabs} kind=${kind}/><${MeasuresCatalog}/></div>`;
  }
  return html`<${FoodsExplorer} key=${kind} kind=${kind} query=${query}/>`;
}

function FoodsExplorer({ kind, query = {} }) {
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
    const rows = r.rows.filter((f) => kindOk(kind, f));
    return { ...r, rows, ctx, facets: foodFacets(ctx, rows) };
  }, [store.version, q, sort, tz, kind]);
  const total = res.rows.length;
  const page = res.rows.slice(skip, skip + PAGE);
  const apply = (next) => {
    setDraft(next);
    setQ(next);
    setSkip(0);
  };
  const addTerm = (field, value, negate = false) => {
    const [f, v, neg] = facetTerm(field, value);
    apply(withTerm(q, foodFieldLabel(f), v, negate !== neg));
  };
  const toggleOpen = (id) => setOpen((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const del = async (ids) => {
    if (!(await confirm({ title: tr('Удалить из каталога?'), text: tr('Затронет {p0}. Записи в дневнике останутся.', { p0: catalogLabel(ids.length) }), confirmLabel: tr('Удалить'), danger: true }))) return;
    const r = await FA.deleteFoods(ids);
    if (r) selection.clear();
  };
  const current = currentFoodId();
  const picked = page.map((f) => f.id);
  const pickedOnPage = picked.filter((id) => selection.has(id)).length;
  const count = [...store.feast.foods.values()].filter((f) => !f.deletedAt && kindOk(kind, f)).length;
  const med = kind === 'med';

  return html`
    <div class="screen foods">
      <${CatalogTabs} kind=${kind}/>
      <header class="page-header">
        <p class="page-desc">${med
          ? tr('Твои лекарства: {p0}. У лекарства — форма и обычная доза; если нужно — описание, КБЖУ и витамины на 1 единицу (сиропы, витамины) и замеры, которые предлагаются при приёме.', { p0: count })
          : tr('Твои продукты: {p0}. Значения — на 100 г (или 100 мл), чего не указано — ноль. Можно привязать несколько штрихкодов, лекарства и замеры.', { p0: count })}</p>
        <div class="page-actions">
          <button type="button" class="btn" disabled=${readOnly()} onClick=${() => openSheet('scan', { target: 'open' })}><${Icon} name="barcode" size=${16}/> Сканировать</button>
          <button type="button" class="btn primary" disabled=${readOnly()} onClick=${() => createCatalogItem(kind)}>
            <${Icon} name="plus" size=${16}/> ${med ? tr('Новое лекарство') : tr('Новый продукт')}</button>
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
            ${Object.keys(FOOD_FIELDS).map((f) => html`<button type="button" class="ex-field" key=${f} onClick=${() => setDraft((d) => `${d.trim()} ${foodFieldLabel(f)}:`.trim())}>${foodFieldLabel(f)}:</button>`)}
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
                  <th>${kind === 'med' ? tr('Лекарство') : tr('Продукт')}</th>
                  <th class="num">${kind === 'med' ? tr('доза') : tr('ккал')}</th>
                  ${MACROS.map((k) => html`<th class="num ex-col-list" key=${k}>${NUTRIENT[k].short}</th>`)}
                  <th class="ex-col-prio">Штрихкоды</th>
                  <th class="ex-col-time">Создан</th>
                </tr></thead>
                <tbody>
                  ${!page.length ? html`<tr><td colSpan="9" class="ex-empty-row">${q ? tr('Ничего не найдено.') : kind === 'med' ? tr('Лекарств пока нет — нажми «Новое лекарство».') : tr('Продуктов пока нет — создай свой или отсканируй штрихкод.')}</td></tr>` : null}
                  ${page.map((f) => {
                    const codes = F.foodBarcodes(f);
                    const isOpen = open.has(f.id);
                    const uses = res.ctx.usage.get(f.id)?.count || 0;
                    const med = F.isMed(f);
                    return html`
                      <tr key=${f.id} class=${'ex-row' + (selection.has(f.id) ? ' selected' : '') + (current === f.id ? ' current' : '')} onClick=${() => toggleOpen(f.id)} aria-expanded=${isOpen}>
                        <td class="ex-w-check" onClick=${(e) => e.stopPropagation()}><input type="checkbox" class="ex-check" aria-label="Выбрать строку"
                          checked=${selection.has(f.id)} onChange=${() => selection.toggle(f.id)}/></td>
                        <td class="ex-w-chev"><${Icon} name=${isOpen ? 'chevronDown' : 'chevron'} size=${16}/></td>
                        <td class="ex-title-cell">
                          <button type="button" class="ex-title" onClick=${(e) => { e.stopPropagation(); openFood(f.id); }}>${f.favorite ? '★ ' : ''}${med ? F.kindIcon(f) + ' ' : ''}${f.name}</button>
                          ${f.brand ? html`<button type="button" class="ex-value fd-brand" onClick=${(e) => { e.stopPropagation(); addTerm('бренд', f.brand); }}>${f.brand}</button>` : null}
                          <div class="ex-narrow-meta"><span>${med ? tr('Лекарство · ') + (MED_UNIT[f.unit]?.label || '') : macroLine(f.nutrients)}</span>${codes.length ? html`<span>▮ ${codes.length}</span>` : null}</div>
                        </td>
                        <td class="num">${med ? html`<span class="med-dose">${amountLabel({ amount: f.dose || 1, unit: f.unit })}</span>` : html`<b>${fmt(nv(f.nutrients, 'kcal'), 'kcal')}</b>`}</td>
                        ${MACROS.map((k) => html`<td class="num ex-col-list" key=${k}>${med ? html`<span class="muted">—</span>` : fmt(nv(f.nutrients, k), k)}</td>`)}
                        <td class="ex-col-prio">${codes.length ? codes.map((c) => html`<button type="button" key=${c} class="ex-value bc-chip" title="Искать по штрихкоду"
                          onClick=${(e) => { e.stopPropagation(); apply(withTerm(q, foodFieldLabel('штрихкод'), c)); }}>${c}</button>`) : html`<span class="muted">—</span>`}</td>
                        <td class="ex-col-time ex-time">${formatMoment(f.createdAt, tz)}</td>
                      </tr>
                      ${isOpen ? html`<tr class="ex-details" key=${f.id + ':d'}><td colSpan="9">
                        <div class="ex-details-body">
                          ${f.note ? html`<p class="fd-note">${f.note}</p>` : null}
                          ${med ? html`<p class="muted small">${MED_UNIT[f.unit]?.label || ''} · обычная доза ${amountLabel({ amount: f.dose || 1, unit: f.unit })} · принято: ${countLabel(uses, ['раз', 'раза', 'раз'])}</p>` : html`
                          <${NutrientTable} values=${f.nutrients} pct=${false}/>
                          <p class="muted small">${f.unit === 'ml' ? tr('На 100 мл') : tr('На 100 г')}${F.servingsOf(f).length ? tr(' · порции: {p0}', { p0: F.servingsOf(f).map((x) => `${x.name ? x.name + ' ' : ''}${fmt(x.size, 'x')} ${f.unit === 'ml' ? tr('мл') : tr('г')}`).join(', ') }) : ''} · в дневнике: ${countLabel(uses, ['раз', 'раза', 'раз'])}</p>`}
                          <div class="ex-details-actions">
                            <button type="button" class="btn small" onClick=${() => openFood(f.id)}><${Icon} name="chevron" size=${16}/> Открыть карточку</button>
                            <button type="button" class="btn small" disabled=${readOnly()} onClick=${() => openAddFood({ foodId: f.id })}><${Icon} name="plus" size=${16}/> ${med ? tr('Записать приём') : tr('В дневник')}</button>
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

/** Заметка к продукту или лекарству целиком — многострочная, сохраняется при уходе из поля. */
function AreaField({ label, value, onCommit, placeholder = '', disabled = false }) {
  const [draft, setDraft] = useState(null);
  const commit = () => {
    if (draft === null) return;
    if (draft !== (value || '')) onCommit(draft);
    setDraft(null);
  };
  return html`<label class="field fc-note"><span>${label}</span>
    <textarea class="note-area" rows="3" value=${draft ?? value ?? ''} placeholder=${placeholder} maxlength=${F.NOTE_MAX} disabled=${disabled}
      onInput=${(e) => setDraft(e.target.value)} onBlur=${commit}></textarea></label>`;
}

/** Лекарства, которые записываются вместе с продуктом (при записи — галочки, их можно снять или поменять дозу). */
function LinkedMedsEditor({ f, ro }) {
  const [pick, setPick] = useState('');
  const links = (f.meds || []).map((l) => ({ ...l, med: store.feast.foods.get(l.medId) })).filter((l) => l.med && !l.med.deletedAt);
  const meds = [...store.feast.foods.values()].filter((m) => !m.deletedAt && F.isMed(m) && !links.some((l) => l.medId === m.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const save = (list) => FA.updateFood(f.id, { meds: list.map(({ medId, amount }) => ({ medId, amount })) });
  const add = () => {
    const m = store.feast.foods.get(pick);
    if (!m) return;
    save([...links, { medId: m.id, amount: m.dose || 1 }]);
    setPick('');
  };
  return html`
    <h3 class="set-sub">Лекарства вместе с продуктом</h3>
    ${links.length ? html`<ul class="fc-meds">${links.map((l) => html`<li key=${l.medId}>
      <button type="button" class="link-btn" onClick=${() => openFood(l.medId)}>${F.kindIcon(l.med)} ${l.med.name}</button>
      <input class="lm-amount" inputmode="decimal" value=${dec(l.amount)} disabled=${ro} aria-label=${tr('Доза: ') + l.med.name}
        onChange=${(e) => save(links.map((x) => (x.medId === l.medId ? { ...x, amount: num(e.target.value) || x.amount } : x)))}/>
      <small class="muted">${MED_UNIT[l.med.unit]?.short || ''}</small>
      <button type="button" class="icon-btn small" disabled=${ro} aria-label=${tr('Отвязать ') + l.med.name} data-hint="Отвязать"
        onClick=${() => save(links.filter((x) => x.medId !== l.medId))}><${Icon} name="close" size=${16}/></button>
    </li>`)}</ul>` : html`<p class="muted small">Например, инсулин к сладкому: при записи продукта лекарство предложится галочкой — её можно снять.</p>`}
    ${meds.length ? html`<div class="bc-add">
      <select value=${pick} disabled=${ro} aria-label="Лекарство" onChange=${(e) => setPick(e.target.value)}>
        <option value="">Выбери лекарство…</option>
        ${meds.map((m) => html`<option value=${m.id} key=${m.id}>${m.name}</option>`)}
      </select>
      <button type="button" class="btn" disabled=${ro || !pick} onClick=${add}>Привязать</button>
    </div>` : html`<button type="button" class="btn small" disabled=${ro} onClick=${() => createCatalogItem('med')}>💊 Новое лекарство</button>`}`;
}

/** Замеры, которые предлагаются при записи продукта или лекарства (сколько угодно; значение вводится при записи). */
function LinkedMeasuresEditor({ f, ro }) {
  const [pick, setPick] = useState('');
  const links = (f.measures || []).map((l) => ({ ...l, m: store.feast.foods.get(l.measureId) })).filter((l) => l.m && !l.m.deletedAt);
  const all = [...store.feast.foods.values()].filter((m) => !m.deletedAt && F.isMeasure(m) && !links.some((l) => l.measureId === m.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const save = (list) => FA.updateFood(f.id, { measures: list.map(({ measureId }) => ({ measureId })) });
  return html`
    <h3 class="set-sub">${F.isMed(f) ? tr('Замеры вместе с лекарством') : tr('Замеры вместе с продуктом')}</h3>
    ${links.length ? html`<ul class="fc-meds">${links.map((l) => html`<li key=${l.measureId}>
      <button type="button" class="link-btn" onClick=${() => openFood(l.measureId)}>${l.m.icon || '📏'} ${l.m.name}</button>
      <small class="muted">${l.m.unit ? tr(l.m.unit) : ''}</small>
      <button type="button" class="icon-btn small" disabled=${ro} aria-label=${tr('Отвязать ') + l.m.name} data-hint="Отвязать"
        onClick=${() => save(links.filter((x) => x.measureId !== l.measureId))}><${Icon} name="close" size=${16}/></button>
    </li>`)}</ul>` : html`<p class="muted small">Например, глюкоза к инсулину: при записи появится поле для показания — его можно оставить пустым.</p>`}
    ${all.length ? html`<div class="bc-add">
      <select value=${pick} disabled=${ro} aria-label="Замер" onChange=${(e) => setPick(e.target.value)}>
        <option value="">Выбери замер…</option>
        ${all.map((m) => html`<option value=${m.id} key=${m.id}>${m.name}</option>`)}
      </select>
      <button type="button" class="btn" disabled=${ro || !pick} onClick=${() => { if (pick) save([...links, { measureId: pick }]); setPick(''); }}>Привязать</button>
    </div>` : html`<button type="button" class="btn small" disabled=${ro} onClick=${() => navigate('/foods/measures')}>📏 Замеры…</button>`}`;
}

/** Скрытое описание: свёрнуто, пока его не откроют (0.13). */
function HiddenDesc({ f, ro, set, label = tr('Описание') }) {
  const [open, setOpen] = useState(false);
  return html`<div class="fc-desc">
    <button type="button" class="link-btn" aria-expanded=${open} onClick=${() => setOpen(!open)}>
      <${Icon} name=${open ? 'chevronDown' : 'chevron'} size=${16}/> ${label}${f.desc ? '' : tr(' (необязательно)')}</button>
    ${open ? html`<${AreaField} label="" value=${f.desc} placeholder="Подробное описание: состав, показания, побочные эффекты, назначение врача… Видно только здесь." disabled=${ro}
      onCommit=${(v) => set({ desc: v })}/>` : f.desc ? html`<p class="muted small fc-desc-hint">${tr('Есть описание — нажми, чтобы открыть.')}</p>` : null}
  </div>`;
}

/** Карточка замера: значок, единица, одно или несколько значений (как у давления), норма, описание, заметка. */
function MeasureFields({ f, ro, set }) {
  const parts = f.parts || [];
  const count = Math.max(1, parts.length);
  const ranges = MS.cleanRanges(f.ranges, count);
  const setCount = (n) => set({ parts: n === 1 ? [] : Array.from({ length: n }, (_, i) => parts[i] || [tr('Верхнее'), tr('Нижнее'), tr('Третье')][i]) });
  const setRange = (i, k, v) => set({ ranges: ranges.map((r, j) => (j === i ? { ...(r || {}), [k]: v } : r)) });
  return html`
    <div class="field-row">
      <label class="field"><span>Единица</span>
        <input list="measure-units" value=${f.unit || ''} maxlength=${MS.MEASURE_UNIT_MAX} disabled=${ro} placeholder="ммоль/л, мм рт. ст., балл…"
          onChange=${(e) => set({ unit: e.target.value })}/>
        <datalist id="measure-units">${MS.UNIT_SUGGESTIONS.map((u) => html`<option value=${u} key=${u}></option>`)}</datalist></label>
    </div>
    <div class="field"><span>Значение</span>
      <div class="chip-row" role="radiogroup" aria-label="Сколько чисел">
        ${[[1, tr('Одно число')], [2, tr('Два (как давление)')], [3, tr('Три')]].map(([n, l]) => html`<button type="button" role="radio" key=${n} aria-checked=${count === n}
          class=${'chip' + (count === n ? ' selected' : '')} disabled=${ro} onClick=${() => setCount(n)}>${l}</button>`)}
      </div>
    </div>
    ${Array.from({ length: count }, (_, i) => html`<div class="field-row measure-part" key=${i}>
      ${count > 1 ? html`<${TextField} label=${tr('Часть {n}', { n: i + 1 })} value=${parts[i]} maxLength=${MS.PART_NAME_MAX} disabled=${ro}
        onCommit=${(v) => set({ parts: parts.map((p, j) => (j === i ? v : p)) })}/>` : null}
      <${TextField} label=${count > 1 ? tr('Норма от') : tr('Норма от (необязательно)')} value=${ranges[i]?.min != null ? dec(ranges[i].min) : ''} placeholder="—" maxLength=${10} disabled=${ro}
        onCommit=${(v) => setRange(i, 'min', v)}/>
      <${TextField} label="до" value=${ranges[i]?.max != null ? dec(ranges[i].max) : ''} placeholder="—" maxLength=${10} disabled=${ro}
        onCommit=${(v) => setRange(i, 'max', v)}/>
    </div>`)}
    <p class="muted small">Норма — для подсветки: показания вне её отмечаются ⚠ в дневнике и аналитике. Это ориентир, а не диагноз.</p>
    <${IconPicker} value=${f.icon || ''} fallback="📏" disabled=${ro} onChange=${(v) => set({ icon: v })}/>
    <${HiddenDesc} f=${f} ro=${ro} set=${set}/>
    <${AreaField} label="Заметка" value=${f.note} placeholder="Когда мерить, каким прибором, что важно…" disabled=${ro} onCommit=${(v) => set({ note: v })}/>`;
}

/** Карточка лекарства: название, производитель, форма, обычная доза, заметка, штрихкоды; без КБЖУ и наград. */
function MedFields({ f, ro, set }) {
  const unit = MED_UNIT[f.unit] || MED_UNITS[0];
  const foods = [...store.feast.foods.values()].filter((x) => !x.deletedAt && (x.meds || []).some((l) => l.medId === f.id));
  return html`
    <div class="field-row">
      <label class="field"><span>Форма</span>
        <select value=${unit.key} disabled=${ro} onChange=${(e) => set({ unit: e.target.value })}>${MED_UNITS.map((u) => html`<option value=${u.key}>${u.label}</option>`)}</select></label>
      <${TextField} label=${tr('Обычная доза, {short}', { short: unit.short })} value=${dec(f.dose || 1)} maxLength=${8} disabled=${ro} onCommit=${(v) => set({ dose: num(v) || 1 })}/>
    </div>
    <${AreaField} label="Заметка" value=${f.note} placeholder="Как принимать, назначение, что важно помнить…" disabled=${ro} onCommit=${(v) => set({ note: v })}/>
    <${TextField} label="Производитель" value=${f.brand} placeholder="необязательно" disabled=${ro} onCommit=${(v) => set({ brand: v })}/>
    <${IconPicker} value=${f.icon || ''} fallback="💊" disabled=${ro} onChange=${(v) => set({ icon: v })}/>
    <${HiddenDesc} f=${f} ro=${ro} set=${set}/>
    <${MedNutrients} f=${f} ro=${ro} set=${set}/>
    ${foods.length ? html`<p class="muted small">Предлагается вместе с: ${foods.map((x, i) => html`${i ? ', ' : ''}<button type="button" class="link-btn" key=${x.id} onClick=${() => openFood(x.id)}>${x.name}</button>`)}</p>` : null}`;
}

/** КБЖУ, витамины и минералы лекарства — на 1 единицу формы (сироп, витамины), свёрнуто, пока не нужно (0.13). */
function MedNutrients({ f, ro, set }) {
  const has = Object.keys(f.nutrients || {}).length > 0;
  const [open, setOpen] = useState(has);
  const short = MED_UNIT[f.unit]?.short || '';
  return html`<div class="fc-desc">
    <button type="button" class="link-btn" aria-expanded=${open} onClick=${() => setOpen(!open)}>
      <${Icon} name=${open ? 'chevronDown' : 'chevron'} size=${16}/> ${tr('КБЖУ, витамины и минералы')}${has ? '' : tr(' (необязательно)')}</button>
    ${open ? html`<${NutrientEditor} key=${'m' + f.id} nutrients=${f.nutrients || {}} unit="g" per=${tr('1 {u}', { u: short })} disabled=${ro} onChange=${(n) => set({ nutrients: n })}/>
      <p class="muted small">${tr('Для сиропов, витаминов и всего, что даёт калории или вещества: значения на 1 {u}. В дневнике они складываются с едой.', { u: short })}</p>` : null}
  </div>`;
}

/** Порции продукта (0.14): сколько угодно своих — название и граммы (мл); первая предлагается при записи первой. */
function ServingsEditor({ f, ro }) {
  const list = F.servingsOf(f);
  const [name, setName] = useState('');
  const [size, setSize] = useState('');
  const u = f.unit === 'ml' ? tr('мл') : tr('г');
  const save = (next) => FA.updateFood(f.id, { servings: next });
  const add = (e) => {
    e?.preventDefault();
    if (!(num(size) > 0)) return;
    save([...list, { id: null, name, size: num(size) }]);
    setName('');
    setSize('');
  };
  return html`<div class="servings-editor">
    <h3 class="set-sub">${tr('Порции')}</h3>
    ${list.length ? html`<ul class="servings-list">${list.map((s, i) => html`<li key=${s.id + ':' + i} class="serving-row">
      <${TextField} label=${tr('Название')} value=${s.name} placeholder=${tr('например, стакан')} maxLength=${40} disabled=${ro}
        onCommit=${(v) => save(list.map((x, j) => (j === i ? { ...x, name: v } : x)))}/>
      <${TextField} label=${u} value=${dec(s.size)} maxLength=${8} disabled=${ro}
        onCommit=${(v) => (num(v) > 0 ? save(list.map((x, j) => (j === i ? { ...x, size: num(v) } : x))) : null)}/>
      <button type="button" class="icon-btn small" disabled=${ro} title=${tr('Убрать порцию')} aria-label=${tr('Убрать порцию {p0}', { p0: s.name || dec(s.size) })}
        onClick=${() => save(list.filter((_, j) => j !== i))}><${Icon} name="close" size=${16}/></button>
    </li>`)}</ul>` : html`<p class="muted small">${tr('Порций нет — при записи можно ввести граммы. Добавь свои: «стакан», «ложка», «пачка»…')}</p>`}
    ${list.length >= F.SERVINGS_MAX ? null : html`<form class="serving-row serving-add" onSubmit=${add}>
      <label class="field"><span>${tr('Новая порция')}</span><input value=${name} maxlength="40" placeholder=${tr('например, стакан')} disabled=${ro} onInput=${(e) => setName(e.target.value)}/></label>
      <label class="field"><span>${u}</span><input inputmode="decimal" value=${size} placeholder="250" disabled=${ro} onInput=${(e) => setSize(e.target.value)}/></label>
      <button type="submit" class="btn small" disabled=${ro || !(num(size) > 0)}><${Icon} name="plus" size=${14}/> ${tr('Добавить')}</button>
    </form>`}
  </div>`;
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
  const med = F.isMed(f);
  const measure = F.isMeasure(f);
  const codes = F.foodBarcodes(f);
  const uses = F.foodUsage(store.feast).get(f.id);
  const typed = normalizeBarcode(code);
  const warn = typed ? barcodeWarning(typed) : '';
  const set = (changes) => FA.updateFood(f.id, changes);
  const remove = async () => {
    if (await confirm({ title: tr('Удалить «{name}»?', { name: f.name }), text: tr('Записи в дневнике останутся — в них сохранены название и значения.'), confirmLabel: tr('Удалить'), danger: true })) {
      onClose();
      FA.deleteFoods([f.id]);
    }
  };
  const addCode = async (e) => {
    e?.preventDefault();
    if (typed && (await FA.attachBarcode(f.id, typed))) setCode('');
  };
  const head = html`
      <div class="task-header">
        <button class="icon-btn" onClick=${onClose} aria-label="Закрыть"><${Icon} name=${panel ? 'close' : 'back'}/></button>
        <span class="fc-kind">${med ? F.kindIcon(f) + ' ' + tr('Лекарство') : measure ? F.kindIcon(f) + ' ' + tr('Замер') : tr('Продукт')}</span>
        <span class="ds-spacer"></span>
        <button class=${'icon-btn' + (f.favorite ? ' fav' : '')} disabled=${ro} onClick=${() => FA.toggleFavorite(f.id)}
          aria-pressed=${!!f.favorite} title=${f.favorite ? tr('Убрать из избранного') : tr('В избранное')} aria-label="Избранное"><${Icon} name="star" filled=${!!f.favorite}/></button>
        <button class="icon-btn" disabled=${ro} onClick=${() => FA.duplicateFood(f.id).then((c) => c && openFood(c.id))} title="Копия" aria-label="Копия"><${Icon} name="copy2"/></button>
        <button class="icon-btn danger" disabled=${ro} onClick=${remove} title="Удалить" aria-label="Удалить"><${Icon} name="trash"/></button>
      </div>
      <${TextField} label="Название" value=${f.name} disabled=${ro} onCommit=${(v) => set({ name: v })}/>`;
  if (measure) {
    return html`<div class=${'screen food-card' + (panel ? ' in-panel' : '')}>
      ${head}
      <${MeasureFields} f=${f} ro=${ro} set=${set}/>
      <div class="form-actions">
        <button type="button" class="btn primary" disabled=${ro} onClick=${() => openAddFood({ foodId: f.id })}><${Icon} name="plus" size=${16}/> Записать замер</button>
        <button type="button" class="btn" onClick=${() => navigate('/nutrition/measures')}>Аналитика замеров</button>
      </div>
      <p class="muted small fc-meta">Создан ${longDate(localDateOf(f.createdAt, tz))} ${localDateOf(f.createdAt, tz).slice(0, 4)} · ${tr('показаний: {n}', { n: uses?.count || 0 })}</p>
    </div>`;
  }
  return html`
    <div class=${'screen food-card' + (panel ? ' in-panel' : '')}>
      ${head}
      ${med ? html`<${MedFields} f=${f} ro=${ro} set=${set}/><${LinkedMeasuresEditor} f=${f} ro=${ro}/>` : html`
      <div class="field-row">
        <label class="field"><span>Единица</span>
          <select value=${f.unit} disabled=${ro} onChange=${(e) => set({ unit: e.target.value })}>${F.UNITS.map((u) => html`<option value=${u.key}>${u.label}</option>`)}</select></label>
      </div>
      <${AreaField} label="Заметка к продукту" value=${f.note} placeholder="Например, сколько единиц инсулина обычно нужно, где покупать…" disabled=${ro} onCommit=${(v) => set({ note: v })}/>
      <${TextField} label="Бренд" value=${f.brand} placeholder="необязательно" disabled=${ro} onCommit=${(v) => set({ brand: v })}/>
      <${ServingsEditor} f=${f} ro=${ro}/>

      <h3 class="set-sub">Пищевая ценность</h3>
      <${NutrientEditor} key=${f.id} nutrients=${f.nutrients} unit=${f.unit} disabled=${ro} onChange=${(n) => set({ nutrients: n })}/>
      <${LinkedMedsEditor} f=${f} ro=${ro}/>
      <${LinkedMeasuresEditor} f=${f} ro=${ro}/>`}

      <h3 class="set-sub">Штрихкоды</h3>
      ${codes.length ? html`<ul class="bc-list">${codes.map((c) => html`<li key=${c}>
        <${BarcodeImage} code=${c}/><span class="bc-code">${c}</span>
        <button type="button" class="icon-btn small" disabled=${ro} aria-label=${tr('Отвязать ') + c} title="Отвязать" onClick=${() => FA.detachBarcode(f.id, c)}><${Icon} name="close" size=${16}/></button>
      </li>`)}</ul>` : html`<p class="muted small">Штрихкодов нет — продукт можно найти по названию. Привяжи код, чтобы находить его сканером.</p>`}
      <form class="bc-add" onSubmit=${addCode}>
        <input inputmode="numeric" value=${code} placeholder="Цифры штрихкода" aria-label="Штрихкод" disabled=${ro} onInput=${(e) => setCode(e.target.value)}/>
        <button type="submit" class="btn" disabled=${!typed || ro}>Привязать</button>
        <button type="button" class="btn" disabled=${ro} onClick=${() => openSheet('scan', { target: f.id })}><${Icon} name="barcode" size=${16}/> Сканировать</button>
      </form>
      ${warn ? html`<p class="hint warn">${warn}</p>` : null}

      ${med ? null : html`
      <h3 class="set-sub">Награда за запись</h3>
      <${RewardEditor} key=${'r' + f.id} rewards=${f.rewards || {}} defaults=${F.rewardDefaults(store.feast.settings)} disabled=${ro}
        onChange=${(r) => set({ rewards: r })}/>
      <p class="muted small">Начисляется за каждую запись этого продукта в дневнике, сколько бы ни съел(а). Пустое поле — по умолчанию
        (<${Link} to="/settings?section=feast-rewards">настройки наград<//>). Дробные монеты и 💎 копятся: тратятся целые. Уже сделанные записи
        не пересчитываются.${store.data.settings?.gameEnabled ? '' : tr(' Игра сейчас выключена — награды копятся, но не видны.')}</p>`}

      <div class="form-actions">
        <button type="button" class="btn primary" disabled=${ro} onClick=${() => openAddFood({ foodId: f.id })}><${Icon} name="plus" size=${16}/> ${med ? tr('Записать приём') : tr('В дневник')}</button>
      </div>
      <p class="muted small fc-meta">Создан ${longDate(localDateOf(f.createdAt, tz))} ${localDateOf(f.createdAt, tz).slice(0, 4)} · изменён ${formatMoment(f.updatedAt, tz)}
        · ${med ? tr('принято') : tr('в дневнике')} ${countLabel(uses?.count || 0, ['раз', 'раза', 'раз'])}</p>
    </div>`;
}
