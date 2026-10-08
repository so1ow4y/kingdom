// «Архив и корзина» (docs/TZ.md §6.8, §6.9; с 0.10 — один пункт дока с вкладками «Выполненные» и «Корзина»)
// и «Поиск задач». Все три экрана — обозреватель задач (components/Explorer.js), перенос обработки
// пользователей и сработок из license-store: поиск «поле:значение», топ значений, массовые действия.

import { html } from '../html.js';
import { Icon } from '../icons.js';
import { Link } from '../router.js';
import { store } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';
import { plural } from '../../core/plural.js';
import { doneCount } from '../../core/retention.js';
import { INBOX_NAME } from '../../core/explore.js';
import { TaskExplorer } from '../components/Explorer.js';

/** Шапка экрана: описание и действия справа (AdminPageHeader license-store). */
function PageHeader({ children, actions = null }) {
  return html`<header class="page-header">
    <p class="page-desc">${children}</p>
    ${actions ? html`<div class="page-actions">${actions}</div>` : null}
  </header>`;
}

/** Условие «список:…» для перехода из списка («Все выполненные — в архиве»). */
function listTerm(listId) {
  if (!listId) return '';
  if (listId === 'inbox') return `список:${INBOX_NAME.toLowerCase()}`;
  const l = S.liveList(store.data, listId);
  if (!l) return '';
  return /[\s()|"]/.test(l.name) ? `список:"${l.name.replace(/"/g, '')}"` : `список:${l.name}`;
}

export function ArchiveScreen({ query = {} }) {
  const limit = store.data.settings.completedLimit;
  return html`
    <div class="screen">
      <${PageHeader}>
        Выполненные задачи. Хранится: ${doneCount(store.data)}${limit == null ? ' · без лимита' : ` из ${limit}`} — старые сверх лимита
        удаляются, статистика остаётся. <${Link} to="/settings?section=data">Настроить<//>
      <//>
      <${TaskExplorer} kind="done" initialQ=${listTerm(query.list)}/>
    </div>`;
}

export function TrashScreen() {
  const days = store.data.settings.trashRetentionDays || 30;
  const n = S.trashView(store.data).length;
  return html`
    <div class="screen">
      <${PageHeader} actions=${n ? html`<button class="btn danger-outline" onClick=${A.emptyTrash} disabled=${!!store.ui.readOnly}>
        <${Icon} name="trash" size=${16}/> Очистить корзину</button>` : null}>
        Задачи удаляются навсегда через ${days} ${plural(days, ['день', 'дня', 'дней'])} после попадания в корзину.${' '}
        <${Link} to="/settings?section=tasks">Изменить срок<//>
      <//>
      <${TaskExplorer} kind="trash"/>
    </div>`;
}

export function TasksScreen({ query = {} }) {
  return html`
    <div class="screen">
      <${PageHeader}>
        Все задачи: активные, выполненные и в корзине. Ищи словами или условиями «поле:значение», отмечай галочками —
        и делай с выбранными что нужно сразу.
      <//>
      <${TaskExplorer} kind="all" initialQ=${query.q || ''}/>
    </div>`;
}
