// «Входящие» (docs/TZ.md §6.4): корневые задачи без списков; подзадачи — деревом под родителем.

import { html, useMemo } from '../html.js';
import { TaskTree } from '../components/TaskTree.js';
import { Empty } from '../components/Section.js';
import { store } from '../../store/appState.js';
import * as S from '../../core/selectors.js';

export const INBOX_ZONE = { manual: true, listId: 'inbox' };

export function InboxScreen() {
  const tasks = useMemo(() => S.inboxView(store.data), [store.version]);
  if (!tasks.length) {
    return html`<div class="screen"><${Empty}>Входящие пусты. Всё разобрано 👌<//></div>`;
  }
  return html`
    <div class="screen">
      <p class="screen-hint">Разбери задачи: «Когда», «Списки» или ★. Тащи за ⋮⋮: между задачами — сменить порядок, на середину задачи или со сдвигом вправо — сделать подзадачей.</p>
      <${TaskTree} zone="inbox" roots=${tasks} cfg=${INBOX_ZONE} quickActions/>
    </div>`;
}
