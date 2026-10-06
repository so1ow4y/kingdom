// «Входящие» (docs/TZ.md §6.4): корневые задачи без списков; подзадачи — деревом под родителем.
// С 0.9 — две вкладки: «Задачи» и «Повторяющиеся» (все повторяющиеся задачи из любых списков, их можно удалить).

import { html, useMemo } from '../html.js';
import { TaskTree } from '../components/TaskTree.js';
import { TaskRow } from '../components/TaskRow.js';
import { Empty } from '../components/Section.js';
import { Icon } from '../icons.js';
import { store, openSheet, confirm } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';
import { useLocal } from '../hooks.js';

export const INBOX_ZONE = { manual: true, listId: 'inbox' };

function RepeatingTab() {
  const tasks = useMemo(() => S.repeatingView(store.data, store.now.today), [store.version, store.now.today]);
  const readOnly = !!store.ui.readOnly;
  const removeAll = async () => {
    const ok = await confirm({ title: 'Удалить все повторяющиеся задачи?', text: `${tasks.length} шт. уйдут в корзину — оттуда их можно вернуть.`, confirmLabel: 'Удалить все', danger: true });
    if (ok) for (const t of tasks) await A.trashTask(t.id);
  };
  if (!tasks.length) {
    return html`<${Empty}>Повторяющихся задач нет. Создай задачу с «↻ Повтор»: каждый день, по дням недели или раз в месяц.<//>`;
  }
  return html`
    <p class="screen-hint">Повторяющиеся задачи из всех списков. Отметка закрывает только текущий раз; удалить — всю серию (в корзину).</p>
    <div class="task-list repeating-list">
      ${tasks.map((t) => html`<div class="repeat-item" key=${t.id}>
        <${TaskRow} task=${t} showList/>
        <div class="repeat-actions">
          <button class="btn small" disabled=${readOnly} onClick=${() => openSheet('repeat', { taskId: t.id })}><${Icon} name="repeat" size=${15}/> Правило</button>
          ${t.status === 'active' ? html`<button class="btn small" disabled=${readOnly} onClick=${() => A.skipOccurrence(t.id)}>Пропустить раз</button>` : null}
          <button class="btn small danger-outline" disabled=${readOnly} onClick=${() => A.trashTask(t.id)}><${Icon} name="trash" size=${15}/> Удалить</button>
        </div>
      </div>`)}
    </div>
    ${tasks.length > 1 ? html`<button class="link-btn danger-link" disabled=${readOnly} onClick=${removeAll}>Удалить все повторяющиеся (${tasks.length})</button>` : null}`;
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
