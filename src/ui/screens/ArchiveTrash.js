// Архив выполненных и корзина (docs/TZ.md §6.8, §6.9).

import { html, useMemo, useState } from '../html.js';
import { Empty } from '../components/Section.js';
import { TaskList, TaskMeta } from '../components/TaskRow.js';
import { Icon } from '../icons.js';
import { navigate } from '../router.js';
import { store } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';
import { localDateOf, daysBetween, longDate } from '../../core/dates.js';
import { plural } from '../../core/plural.js';
import { doneCount } from '../../core/retention.js';
import { Link } from '../router.js';

const PAGE = 100;

export function ArchiveScreen({ query }) {
  const [filter, setFilter] = useState(query.list || '');
  const [limit, setLimit] = useState(PAGE);
  const all = useMemo(() => S.archiveView(store.data, filter || null), [store.version, filter]);
  const lists = S.sortedLists(store.data).concat(S.sortedLists(store.data, { archived: true }));
  const tz = store.data.settings.timeZone;
  const today = store.now.today;

  const groups = [];
  for (const t of all.slice(0, limit)) {
    const d = t.completedAt ? localDateOf(t.completedAt, tz) : '';
    if (!groups.length || groups.at(-1).date !== d) groups.push({ date: d, tasks: [] });
    groups.at(-1).tasks.push(t);
  }
  const label = (d) => {
    if (!d) return 'Без даты';
    const diff = daysBetween(d, today);
    return diff === 0 ? 'Сегодня' : diff === 1 ? 'Вчера' : longDate(d, today);
  };

  return html`
    <div class="screen">
      <div class="toolbar">
        <label class="field inline">
          <span>Список</span>
          <select value=${filter} onChange=${(e) => { setFilter(e.target.value); setLimit(PAGE); }}>
            <option value="">Все</option>
            <option value="inbox">Входящие</option>
            ${lists.map((l) => html`<option value=${l.id}>${(l.emoji ? l.emoji + ' ' : '') + l.name}</option>`)}
          </select>
        </label>
      </div>
      <p class="hint">Хранится выполненных: ${doneCount(store.data)}${store.data.settings.completedLimit == null ? ' · без лимита'
        : ` из ${store.data.settings.completedLimit}`} — старые сверх лимита удаляются, статистика остаётся. <${Link} to="/settings?section=data">Настроить<//></p>
      ${!all.length ? html`<${Empty}>Выполненных задач пока нет.<//>` : null}
      ${groups.map((g) => html`
        <section class="section" key=${g.date}>
          <header class="section-head"><span class="section-title">${label(g.date)}</span></header>
          <${TaskList} tasks=${g.tasks}/>
        </section>`)}
      ${all.length > limit ? html`<button class="btn wide" onClick=${() => setLimit(limit + PAGE)}>Показать ещё (${all.length - limit})</button>` : null}
    </div>`;
}

export function TrashScreen() {
  const list = useMemo(() => S.trashView(store.data), [store.version]);
  const days = store.data.settings.trashRetentionDays || 30;
  const readOnly = !!store.ui.readOnly;
  const left = (t) => Math.max(0, days - Math.floor((Date.now() - Date.parse(t.trashedAt)) / 86400000));
  return html`
    <div class="screen">
      ${list.length ? html`
        <div class="toolbar">
          <span class="muted">Задачи удаляются навсегда через ${days} ${plural(days, ['день', 'дня', 'дней'])} после попадания в корзину.</span>
          <button class="btn danger-outline" onClick=${A.emptyTrash} disabled=${readOnly}>Очистить корзину</button>
        </div>` : html`<${Empty}>Корзина пуста.<//>`}
      <div class="task-list">
        ${list.map((t) => html`
          <div class="task-row trash-row" key=${t.id} onClick=${() => navigate('/task/' + t.id)} role="button" tabIndex="0">
            <div class="task-main">
              <div class="task-title">${t.title}</div>
              <${TaskMeta} task=${t} showList=${true}/>
              <div class="trash-left">Удалится навсегда через ${left(t)} ${plural(left(t), ['день', 'дня', 'дней'])}</div>
            </div>
            <div class="row-actions visible">
              <button class="btn small" disabled=${readOnly}
                onClick=${(e) => { e.stopPropagation(); A.restoreTask(t.id); }}><${Icon} name="restore" size=${16}/> Восстановить</button>
              <button class="icon-btn danger" disabled=${readOnly} aria-label="Удалить навсегда" title="Удалить навсегда"
                onClick=${(e) => { e.stopPropagation(); A.deleteForever(t.id); }}><${Icon} name="trash" size=${18}/></button>
            </div>
          </div>`)}
      </div>
    </div>`;
}
