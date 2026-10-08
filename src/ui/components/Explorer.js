// Обозреватель задач (обновление 0.10) — перенос поведения license-store при обработке пользователей и сработок
// (features/admin-security/log-explorer.tsx, features/admin/bulk.tsx, routes/_app/admin.users.index.tsx):
// строка «поле:значение» с кнопками полей и подсказкой синтаксиса, диапазон времени, гистограмма, фильтры в шапке
// колонок, клик по значению — условие в строку, раскрытие строки с подробностями, галочки и полоса массовых действий
// (выбор переживает смену страницы и фильтра, до 500 штук), справа — топ значений по полям (+ добавить, − исключить).
// Карточка задачи по клику на название открывается справа (на широком экране) — список остаётся под рукой.

import { html, useState, useMemo } from '../html.js';
import { Icon } from '../icons.js';
import { openTask, currentTaskId } from '../router.js';
import { store, confirm } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';
import {
  KINDS, PLACEHOLDER, RANGES, RANGE_LABEL, HAS_HINT, REPEAT_HINT, fieldChips, rangeFrom, makeContext, search, facets, histogram,
  eventTime, listNames, priorityName, statusOf, STATUS_LABEL, deviceName, fieldLabel,
} from '../../core/explore.js';
import { withTerm, andQuery } from '../../core/query.js';
import { formatMoment, localDateOf, humanDate } from '../../core/dates.js';
import { describeRule } from '../../core/repeat.js';
import { liveNotes, liveAttachments, focusTotal } from '../../core/model.js';
import { countLabel, plural } from '../../core/plural.js';
import { openMenu } from './Popup.js';
import { shortcutText } from '../keys.js';
import { tr, locale } from '../../core/i18n.js';
import { priorityLabel } from '../../core/priorities.js';

const PAGE = 50;
/** Сколько строк можно выбрать за раз (BULK_MAX license-store). */
export const BULK_MAX = 500;

const SYNTAX = tr('· * — подстановка · пробел или AND — оба условия · OR или | — любое · NOT или - — исключить · ( ) — группировка · "фраза"');

/** Выбранные строки. Смена страницы или фильтра выбор не сбрасывает — как в SIEM. */
export function useSelection() {
  const [selected, setSelected] = useState(() => new Set());
  return useMemo(() => ({
    size: selected.size,
    ids: [...selected],
    has: (id) => selected.has(id),
    toggle: (id) => setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < BULK_MAX) next.add(id);
      return next;
    }),
    /** Отметить или снять всю страницу. */
    togglePage: (pageIds) => setSelected((prev) => {
      const next = new Set(prev);
      const all = pageIds.length > 0 && pageIds.every((id) => next.has(id));
      for (const id of pageIds) {
        if (all) next.delete(id);
        else if (next.size < BULK_MAX) next.add(id);
      }
      return next;
    }),
    clear: () => setSelected(new Set()),
  }), [selected]);
}

/** Галочка «вся страница» в шапке таблицы (частично — «минус»). */
function PageCheckbox({ selection, pageIds }) {
  const picked = pageIds.filter((id) => selection.has(id)).length;
  const all = picked > 0 && picked === pageIds.length;
  return html`<input type="checkbox" class="ex-check" aria-label="Выбрать всю страницу" checked=${all}
    ref=${(el) => el && (el.indeterminate = picked > 0 && !all)} onChange=${() => selection.togglePage(pageIds)}/>`;
}

/** Полоса над таблицей: «выбрано N» и кнопки действий. */
function BulkBar({ selection, children }) {
  if (!selection.size) return null;
  return html`
    <div class="ex-bulk" role="region" aria-label="Действия с выбранными">
      <span class="ex-bulk-count">Выбрано ${selection.size}</span>
      <div class="ex-bulk-actions">${children}</div>
      <button type="button" class="btn small ghost ex-bulk-clear" onClick=${selection.clear}><${Icon} name="close" size=${16}/> Снять выбор</button>
    </div>`;
}

function Histogram({ hist, title }) {
  const max = Math.max(1, ...hist.buckets.map((b) => b.count));
  const total = hist.buckets.reduce((s, b) => s + b.count, 0);
  const label = (ms) => new Date(ms).toLocaleString(locale(), hist.ms < 86400000
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' });
  return html`
    <div class="ex-card ex-hist">
      <div class="ex-card-head"><span>${title}</span><span>шаг ${hist.interval}</span></div>
      ${!total ? html`<p class="ex-empty">Ничего не найдено.</p>` : html`
        <div class="ex-bars">
          ${hist.buckets.map((b) => html`
            <div class="ex-bar" key=${b.start} title=${`${label(b.start)} — ${b.count}`}>
              <i style=${{ height: (b.count / max) * 100 + '%' }}></i>
            </div>`)}
        </div>`}
    </div>`;
}

function Facets({ list, onFilter }) {
  return html`
    <aside class="ex-facets" aria-label="Топ значений">
      ${list.map((f) => {
        const max = Math.max(1, ...f.values.map((v) => v.count));
        return html`
          <div class="ex-card" key=${f.field}>
            <p class="ex-facet-title">Топ: ${fieldLabel(f.field)}</p>
            ${!f.values.length ? html`<p class="ex-empty small">—</p>` : null}
            <ul class="ex-facet-list">
              ${f.values.map((v) => html`
                <li key=${v.value} class="ex-facet">
                  <span class="ex-facet-bar" style=${{ width: (v.count / max) * 100 + '%' }}></span>
                  <button type="button" class="ex-facet-value" title=${v.value} onClick=${() => onFilter(f.field, v.value)}>${v.value}</button>
                  <span class="ex-facet-count">${v.count}</span>
                  <button type="button" class="ex-facet-op" aria-label="Фильтровать по значению" title="Фильтровать по значению"
                    onClick=${() => onFilter(f.field, v.value)}><${Icon} name="plus" size=${14}/></button>
                  <button type="button" class="ex-facet-op" aria-label="Исключить значение" title="Исключить значение"
                    onClick=${() => onFilter(f.field, v.value, true)}><${Icon} name="minus" size=${14}/></button>
                </li>`)}
            </ul>
          </div>`;
      })}
    </aside>`;
}

/** Значение в ячейке: клик добавляет его условием в строку поиска. */
function Value({ field, value, onFilter, color = null, children = null }) {
  if (!value) return html`<span class="muted">—</span>`;
  return html`<button type="button" class="ex-value" title=${`${field}:${value}`}
    onClick=${(e) => { e.stopPropagation(); onFilter(field, value); }}>
    ${color ? html`<i class="dot" style=${{ background: color }}></i>` : null}${children ?? value}</button>`;
}

function Details({ ctx, t, kind, onFilter, actions }) {
  const tz = ctx.tz;
  const notes = liveNotes(t).map((n) => n.text || '').join('\n').trim();
  const files = liveNotes(t).reduce((s, n) => s + liveAttachments(n).length, 0);
  const kids = (ctx.kids.get(t.id) || []).length;
  const focus = focusTotal(t);
  const parent = S.parentOf(ctx.data, t);
  const rows = [
    [tr('Создана'), formatMoment(t.createdAt, tz)],
    [tr('Изменена'), `${formatMoment(t.updatedAt, tz)} · ${deviceName(ctx.data, t.updatedBy)}`],
    t.completedAt && [tr('Выполнена'), formatMoment(t.completedAt, tz)],
    t.trashedAt && [tr('В корзине с'), formatMoment(t.trashedAt, tz)],
    t.scheduledDate && [tr('План'), humanDate(t.scheduledDate, ctx.today) + (t.scheduledTime ? ', ' + t.scheduledTime : '')],
    t.deadlineDate && [tr('Срок'), humanDate(t.deadlineDate, ctx.today) + (t.deadlineTime ? ', ' + t.deadlineTime : '')],
    t.repeat && [tr('Повтор'), describeRule(t.repeat)],
    parent && [tr('Внутри задачи'), parent.title],
    kids && [tr('Подзадачи'), String(kids)],
    files && [tr('Вложения'), String(files)],
    focus.count && [tr('Фокус'), tr('{minutes} мин · {p1}', { minutes: focus.minutes, p1: countLabel(focus.count, ['сессия', 'сессии', 'сессий']) })],
  ].filter(Boolean);
  return html`
    <div class="ex-details-body">
      <dl class="ex-dl">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
      ${notes ? html`<pre class="ex-notes">${notes.length > 400 ? notes.slice(0, 400) + '…' : notes}</pre>` : null}
      <div class="ex-details-actions">
        <button type="button" class="btn small" onClick=${() => openTask(t.id)}><${Icon} name="chevron" size=${16}/> Открыть карточку</button>
        ${actions}
        <button type="button" class="btn small ghost" onClick=${() => onFilter(tr('дата'), localDateOf(eventTime(t, kind), tz))}>
          <${Icon} name="calendar" size=${16}/> Этот день</button>
      </div>
    </div>`;
}

/**
 * kind: 'all' | 'done' | 'trash' (core/explore.js KINDS). initialQ — строка поиска при открытии.
 */
export function TaskExplorer({ kind, initialQ = '' }) {
  const K = KINDS[kind];
  const [draft, setDraft] = useState(initialQ);
  const [q, setQ] = useState(initialQ);
  const [range, setRange] = useState('all');
  const [from, setFrom] = useState(null);
  const [skip, setSkip] = useState(0);
  const [columns, setColumns] = useState({});
  const [columnDraft, setColumnDraft] = useState({});
  const [open, setOpen] = useState(() => new Set());
  const selection = useSelection();
  const readOnly = !!store.ui.readOnly;
  const tz = store.data.settings.timeZone;
  const today = store.now.today;

  // Фильтры колонок уходят условиями «поле:значение» через AND к строке поиска.
  const fullQ = andQuery(q, ...Object.entries(columns).filter(([, v]) => v.trim())
    .map(([f, v]) => `${f}:${/\s/.test(v.trim()) ? `"${v.trim().replace(/"/g, '')}"` : v.trim()}`));

  const res = useMemo(() => {
    const ctx = makeContext(store.data, tz, today);
    const r = search(ctx, kind, { q: fullQ, from });
    return { ...r, ctx, facets: facets(ctx, r.rows, kind), hist: histogram(r.rows, kind, from) };
  }, [store.version, kind, fullQ, from, today, tz]);

  const total = res.rows.length;
  const page = res.rows.slice(skip, skip + PAGE);
  if (skip && skip >= total) setTimeout(() => setSkip(Math.max(0, Math.floor((total - 1) / PAGE) * PAGE)), 0);

  function apply(nextQ, nextRange = range) {
    setDraft(nextQ);
    setQ(nextQ);
    setRange(nextRange);
    setFrom(rangeFrom(nextRange));
    setSkip(0);
  }
  const addTerm = (field, value, negate = false) => apply(withTerm(q, fieldLabel(field), value, negate));
  const resetAll = () => {
    setColumns({});
    setColumnDraft({});
    apply('');
  };

  // ---- действия ----
  async function bulk(action, arg = null, ids = selection.ids) {
    if (!ids.length) return;
    if (action === 'trash' && !(await confirm({ title: tr('Убрать в корзину?'), text: tr('Затронет {p0} (вместе с подзадачами). Восстановить можно из корзины.', { p0: countLabel(ids.length, ['задачу', 'задачи', 'задач']) }), confirmLabel: tr('В корзину') }))) return;
    if (action === 'purge' && !(await confirm({ title: tr('Удалить навсегда?'), text: tr('Затронет {p0} вместе с подзадачами. Это нельзя отменить.', { p0: countLabel(ids.length, ['задачу', 'задачи', 'задач']) }), confirmLabel: tr('Удалить навсегда'), danger: true }))) return;
    const r = await A.bulkTasks(action, ids, arg);
    if (r && ids === selection.ids) selection.clear();
  }
  const listMenu = (e, ids = selection.ids) => openMenu({
    anchor: e.currentTarget, side: 'bottom', align: 'start', title: tr('Перенести в список'), viaKeyboard: e.detail === 0,
    items: [
      { label: tr('Входящие'), icon: 'inbox', onSelect: () => bulk('move', null, ids) },
      ...S.sortedLists(store.data).map((l) => ({ label: l.name, emoji: l.emoji, color: l.color, onSelect: () => bulk('move', l.id, ids) })),
    ],
  });
  const prioMenu = (e, ids = selection.ids) => openMenu({
    anchor: e.currentTarget, side: 'bottom', align: 'start', title: tr('Приоритет'), viaKeyboard: e.detail === 0,
    items: S.sortedPriorities(store.data).map((p) => ({ label: priorityLabel(p), color: p.color, onSelect: () => bulk('priority', p.id, ids) })),
  });

  /** Кнопки действий: для полосы выбора (ids не задан) или для одной раскрытой строки. */
  const actionButtons = (t = null) => {
    const ids = t ? [t.id] : undefined;
    const st = t ? statusOf(t) : null;
    const b = (label, icon, onClick, cls = '') => html`<button type="button" class=${'btn small ' + cls} disabled=${readOnly} onClick=${onClick}>
      <${Icon} name=${icon} size=${16}/> ${label}</button>`;
    if (kind === 'trash' || st === 'trash') {
      return html`${b(tr('Восстановить'), 'restore', () => bulk('restore', null, ids), t ? '' : 'primary')}
        ${b(tr('Удалить навсегда'), 'trash', () => bulk('purge', null, ids), 'danger-outline')}`;
    }
    return html`
      ${kind === 'all' && (!t || st === 'active') ? b(tr('Выполнить'), 'check', () => bulk('complete', null, ids), t ? '' : 'primary') : null}
      ${kind === 'done' || (kind === 'all' && (!t || st === 'done')) ? b(tr('Вернуть в работу'), 'restore', () => bulk('reopen', null, ids), kind === 'done' && !t ? 'primary' : '') : null}
      ${b(tr('Список…'), 'lists', (e) => listMenu(e, ids || selection.ids))}
      ${b(tr('Приоритет…'), 'flag', (e) => prioMenu(e, ids || selection.ids))}
      ${b(tr('В корзину'), 'trash', () => bulk('trash', null, ids), 'danger-outline')}`;
  };

  const toggleOpen = (id) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const colFilters = K.columns;
  const extraCol = kind === 'all' ? tr('Статус') : kind === 'trash' ? tr('Осталось') : null;
  const span = 6 + (extraCol ? 1 : 0);
  const retention = store.data.settings.trashRetentionDays || 30;
  const leftDays = (t) => Math.max(0, retention - Math.floor((Date.now() - Date.parse(t.trashedAt)) / 86400000));
  const activeTask = currentTaskId();
  const hasFilters = !!q || Object.values(columns).some((v) => v && v.trim());

  return html`
    <div class="explorer">
      <form class="ex-query" onSubmit=${(e) => { e.preventDefault(); apply(draft); }}>
        <div class="ex-query-row">
          <div class="search-field ex-search">
            <${Icon} name="search" size=${16}/>
            <input value=${draft} data-search-input placeholder=${PLACEHOLDER[kind]} spellcheck="false" autocomplete="off"
              aria-label="Строка поиска" title=${shortcutText('search') ? tr('Поиск: ') + shortcutText('search') : undefined}
              onInput=${(e) => setDraft(e.target.value)}/>
          </div>
          <select class="ex-range" value=${range} aria-label="Период" onChange=${(e) => apply(draft, e.target.value)}>
            ${RANGES.map((r) => html`<option value=${r}>${RANGE_LABEL[r]}</option>`)}
          </select>
          <button type="submit" class="btn primary">Найти</button>
          ${hasFilters ? html`<button type="button" class="btn ghost" onClick=${resetAll}><${Icon} name="close" size=${16}/> Сбросить фильтры</button>` : null}
        </div>
        <div class="ex-fields">
          <span>Поля:</span>
          ${fieldChips(kind).map((f) => html`<button type="button" class="ex-field" key=${f}
            title=${f === 'есть' ? HAS_HINT : f === 'повтор' ? REPEAT_HINT : undefined}
            onClick=${() => setDraft((d) => `${d.trim()} ${fieldLabel(f)}:`.trim())}>${fieldLabel(f)}:</button>`)}
          <span class="ex-syntax">${SYNTAX}</span>
        </div>
      </form>

      ${res.error ? html`<p class="ex-error" role="alert">${res.error}</p>` : null}

      <div class="ex-grid">
        <div class="ex-main">
          <${Histogram} hist=${res.hist} title=${K.histogram + tr(' во времени')}/>

          <${BulkBar} selection=${selection}>${actionButtons()}<//>

          <div class="ex-table-wrap">
            <table class="ex-table">
              <thead>
                <tr>
                  <th class="ex-w-check"><${PageCheckbox} selection=${selection} pageIds=${page.map((t) => t.id)}/></th>
                  <th class="ex-w-chev"></th>
                  <th class="ex-col-time">${K.timeLabel}</th>
                  <th>Задача</th>
                  <th class="ex-col-list">Список</th>
                  <th class="ex-col-prio">Приоритет</th>
                  ${extraCol ? html`<th class="ex-col-extra">${extraCol}</th>` : null}
                </tr>
                <tr class="ex-filter-row">
                  <th></th><th></th><th class="ex-col-time"></th>
                  ${colFilters.map((f) => html`
                    <th key=${f} class=${f === 'список' ? 'ex-col-list' : f === 'приоритет' ? 'ex-col-prio' : ''}>
                      <input class="ex-col-input" value=${columnDraft[f] ?? ''} placeholder=${fieldLabel(f) + '…'} aria-label=${tr('Фильтр: ') + fieldLabel(f)}
                        onInput=${(e) => setColumnDraft({ ...columnDraft, [f]: e.target.value })}
                        onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); setColumns({ ...columnDraft }); setSkip(0); } }}
                        onBlur=${() => { setColumns({ ...columnDraft }); }}/>
                    </th>`)}
                  ${extraCol ? html`<th class="ex-col-extra"></th>` : null}
                </tr>
              </thead>
              <tbody>
                ${!page.length ? html`<tr><td colSpan=${span} class="ex-empty-row">Ничего не найдено.</td></tr>` : null}
                ${page.map((t) => {
                  const isOpen = open.has(t.id);
                  const lists = listNames(res.ctx, t);
                  const prio = S.priorityOf(store.data, t);
                  const st = statusOf(t);
                  return html`
                    <tr key=${t.id} class=${'ex-row' + (selection.has(t.id) ? ' selected' : '') + (activeTask === t.id ? ' current' : '')}
                      onClick=${() => toggleOpen(t.id)} aria-expanded=${isOpen}>
                      <td class="ex-w-check" onClick=${(e) => e.stopPropagation()}>
                        <input type="checkbox" class="ex-check" aria-label="Выбрать строку" checked=${selection.has(t.id)} onChange=${() => selection.toggle(t.id)}/>
                      </td>
                      <td class="ex-w-chev"><${Icon} name=${isOpen ? 'chevronDown' : 'chevron'} size=${16}/></td>
                      <td class="ex-col-time ex-time">${formatMoment(eventTime(t, kind), tz)}</td>
                      <td class="ex-title-cell">
                        <button type="button" class=${'ex-title' + (st === 'done' ? ' done' : '')} title="Открыть карточку"
                          onClick=${(e) => { e.stopPropagation(); openTask(t.id); }}>${t.title}</button>
                        ${t.repeat ? html`<span class="ex-flag" title=${describeRule(t.repeat)}><${Icon} name="repeat" size=${13}/></span>` : null}
                        <div class="ex-narrow-meta">
                          <span>${formatMoment(eventTime(t, kind), tz)}</span>
                          ${lists.map((n) => html`<${Value} field="список" value=${n} onFilter=${addTerm}/>`)}
                          <${Value} field="приоритет" value=${priorityName(store.data, t)} color=${prio?.color} onFilter=${addTerm}/>
                        </div>
                      </td>
                      <td class="ex-col-list">${lists.map((n) => html`<${Value} key=${n} field="список" value=${n} onFilter=${addTerm}/>`)}</td>
                      <td class="ex-col-prio"><${Value} field="приоритет" value=${priorityName(store.data, t)} color=${prio?.color} onFilter=${addTerm}/></td>
                      ${kind === 'all' ? html`<td class="ex-col-extra"><${Value} field="статус" value=${STATUS_LABEL[st]} onFilter=${addTerm}/></td>` : null}
                      ${kind === 'trash' ? html`<td class="ex-col-extra ex-left">${leftDays(t)} ${plural(leftDays(t), ['день', 'дня', 'дней'])}</td>` : null}
                    </tr>
                    ${isOpen ? html`<tr class="ex-details" key=${t.id + ':d'}><td colSpan=${span}>
                      <${Details} ctx=${res.ctx} t=${t} kind=${kind} onFilter=${addTerm} actions=${actionButtons(t)}/></td></tr>` : null}`;
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
    </div>`;
}
