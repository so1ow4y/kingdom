// «Входящие» (docs/TZ.md §6.4): корневые задачи без списков; подзадачи — деревом под родителем.
// С 0.9 — две вкладки: «Задачи» и «Повторяющиеся» (все повторяющиеся задачи из любых списков, их можно удалить);
// с 0.12.3 повторяющиеся разбиты на группы (по дням, неделям, месяцам, годам) и ищутся.

import { html, useMemo, useState } from '../html.js';
import { TaskTree } from '../components/TaskTree.js';
import { TaskRow } from '../components/TaskRow.js';
import { Empty } from '../components/Section.js';
import { Icon } from '../icons.js';
import { store, openSheet, confirm } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';
import { useLocal } from '../hooks.js';
import { Link } from '../router.js';
import * as RP from '../../core/repeat.js';
import { foldYo } from '../../core/query.js';
import { tr } from '../../core/i18n.js';

export const INBOX_ZONE = { manual: true, listId: 'inbox' };

/** Строка повторяющейся задачи: сама задача и «Правило», «Пропустить раз», «Удалить». */
function RepeatItem({ t, readOnly }) {
  return html`<div class="repeat-item">
    <${TaskRow} task=${t} showList/>
    <div class="repeat-actions">
      <button class="btn small" disabled=${readOnly} onClick=${() => openSheet('repeat', { taskId: t.id })}><${Icon} name="repeat" size=${15}/> Правило</button>
      ${t.status === 'active' ? html`<button class="btn small" disabled=${readOnly} onClick=${() => A.skipOccurrence(t.id)}>Пропустить раз</button>` : null}
      <button class="btn small danger-outline" disabled=${readOnly} onClick=${() => A.trashTask(t.id)}><${Icon} name="trash" size=${15}/> Удалить</button>
    </div>
  </div>`;
}

/**
 * Вкладка «Повторяющиеся» (0.9; 0.12.3 — группы и поиск): «Все» — разделами «По дням», «По неделям», «По месяцам»,
 * «По годам»; фильтр по группе и поиск по названию и правилу («март», «будни»).
 */
function RepeatingTab() {
  const tasks = useMemo(() => S.repeatingView(store.data, store.now.today), [store.version, store.now.today]);
  const [cat, setCat] = useLocal('repeatCat', 'all');
  const [q, setQ] = useState('');
  const readOnly = !!store.ui.readOnly;
  const counts = Object.fromEntries(RP.CATEGORIES.map((c) => [c.key, 0]));
  for (const t of tasks) counts[RP.ruleCategory(t.repeat)]++;
  const group = RP.CATEGORIES.some((c) => c.key === cat) ? cat : 'all';
  const needle = foldYo(q.trim().toLowerCase());
  const shown = tasks.filter((t) => (group === 'all' || RP.ruleCategory(t.repeat) === group)
    && (!needle || foldYo(`${t.title} ${RP.describeRule(t.repeat)}`.toLowerCase()).includes(needle)));
  const filtered = group !== 'all' || !!needle;
  const removeAll = async () => {
    const ok = await confirm({
      title: filtered ? tr('Удалить показанные повторяющиеся задачи?') : tr('Удалить все повторяющиеся задачи?'),
      text: tr('{length} шт. уйдут в корзину — оттуда их можно вернуть.', { length: shown.length }), confirmLabel: tr('Удалить'), danger: true,
    });
    if (ok) for (const t of shown) await A.trashTask(t.id);
  };
  if (!tasks.length) {
    return html`<${Empty}>Повторяющихся задач нет. Создай задачу с «↻ Повтор»: каждый день, по дням недели, раз в месяц или раз в год.<//>`;
  }
  const searchQ = group === 'all' ? tr('повтор:есть') : tr('повтор:') + RP.CATEGORIES.find((c) => c.key === group).aliases[0];
  return html`
    <p class="screen-hint">Повторяющиеся задачи из всех списков. Отметка закрывает только текущий раз; удалить — всю серию (в корзину).</p>
    <div class="chip-row wrap repeat-cats" role="radiogroup" aria-label="Группа повторов">
      <button type="button" role="radio" aria-checked=${group === 'all'} class=${'chip' + (group === 'all' ? ' selected' : '')}
        onClick=${() => setCat('all')}>Все · ${tasks.length}</button>
      ${RP.CATEGORIES.filter((c) => counts[c.key] || group === c.key).map((c) => html`<button type="button" role="radio" key=${c.key}
        aria-checked=${group === c.key} class=${'chip' + (group === c.key ? ' selected' : '')} title=${c.hint}
        onClick=${() => setCat(c.key)}>${c.label} · ${counts[c.key]}</button>`)}
    </div>
    <div class="repeat-tools">
      <div class="search-field repeat-search">
        <${Icon} name="search" size=${16}/>
        <input type="search" value=${q} placeholder="Найти: название, «март», «будни»" aria-label="Найти среди повторяющихся"
          onInput=${(e) => setQ(e.target.value)}/>
      </div>
      <${Link} to=${'/tasks?q=' + encodeURIComponent(searchQ)} className="link-btn" title=${tr("Открыть в «Поиске»: ") + searchQ}>В «Поиске» →<//>
    </div>
    ${!shown.length ? html`<${Empty}>Ничего не нашлось${needle ? tr(' по «{p0}»', { p0: q.trim() }) : ''}.<//>`
      : group === 'all' && !needle ? RP.CATEGORIES.filter((c) => counts[c.key]).map((c) => html`
        <section class="repeat-group" key=${c.key}>
          <h3 class="repeat-group-title">${c.label} <small class="muted">· ${c.hint} · ${counts[c.key]}</small></h3>
          <div class="task-list repeating-list">
            ${shown.filter((t) => RP.ruleCategory(t.repeat) === c.key).map((t) => html`<${RepeatItem} key=${t.id} t=${t} readOnly=${readOnly}/>`)}
          </div>
        </section>`)
      : html`<div class="task-list repeating-list">${shown.map((t) => html`<${RepeatItem} key=${t.id} t=${t} readOnly=${readOnly}/>`)}</div>`}
    ${shown.length > 1 ? html`<button class="link-btn danger-link" disabled=${readOnly} onClick=${removeAll}>
      ${filtered ? tr('Удалить показанные ({length})', { length: shown.length }) : tr('Удалить все повторяющиеся ({length})', { length: shown.length })}</button>` : null}`;
}

export function InboxScreen() {
  const tasks = useMemo(() => S.inboxView(store.data), [store.version]);
  const repeating = useMemo(() => S.repeatingView(store.data, store.now.today).length, [store.version, store.now.today]);
  const [tab, setTab] = useLocal('inboxTab', 'tasks');
  const cur = tab === 'repeat' ? 'repeat' : 'tasks';
  return html`
    <div class="screen">
      <div class="chip-row inbox-tabs" role="tablist">
        <button role="tab" aria-selected=${cur === 'tasks'} class=${'chip' + (cur === 'tasks' ? ' selected' : '')} onClick=${() => setTab('tasks')}>Задачи${tasks.length ? ' · ' + tasks.length : ''}</button>
        <button role="tab" aria-selected=${cur === 'repeat'} class=${'chip' + (cur === 'repeat' ? ' selected' : '')} onClick=${() => setTab('repeat')}><${Icon} name="repeat" size=${15}/> Повторяющиеся${repeating ? ' · ' + repeating : ''}</button>
      </div>
      ${cur === 'repeat' ? html`<${RepeatingTab}/>` : tasks.length ? html`
        <p class="screen-hint">Разбери задачи: «Когда», «Списки» или ★. Тащи за ⋮⋮: между задачами — сменить порядок, на середину задачи или со сдвигом вправо — сделать подзадачей.</p>
        <${TaskTree} zone="inbox" roots=${tasks} cfg=${INBOX_ZONE} quickActions/>` : html`<${Empty}>Входящие пусты. Всё разобрано 👌<//>`}
    </div>`;
}
