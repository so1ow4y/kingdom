// «Входящие» (docs/TZ.md §6.4).

import { html, useMemo } from '../html.js';
import { TaskRow } from '../components/TaskRow.js';
import { SortableList } from '../components/Sortable.js';
import { Empty } from '../components/Section.js';
import { store } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';

export function InboxScreen() {
  const tasks = useMemo(() => S.inboxView(store.data), [store.version]);
  const readOnly = !!store.ui.readOnly;
  if (!tasks.length) {
    return html`<div class="screen"><${Empty}>Входящие пусты. Всё разобрано 👌<//></div>`;
  }
  return html`
    <div class="screen">
      <p class="screen-hint">Разбери задачи: «Когда», «Список» или ★. Порядок меняется перетаскиванием за ⋮⋮.</p>
      <${SortableList} items=${tasks} disabled=${readOnly}
        onMove=${(id, index) => A.reorderTask(id, tasks, index)}
        render=${(t, handle) => html`<${TaskRow} task=${t} showList=${S.hasMissingList(store.data, t)} quickActions handle=${handle}/>`}/>
    </div>`;
}
