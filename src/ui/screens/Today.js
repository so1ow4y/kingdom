// Экран «Сегодня» (docs/TZ.md §6.2).

import { html, useMemo } from '../html.js';
import { Section, Empty } from '../components/Section.js';
import { TaskRow, TaskList } from '../components/TaskRow.js';
import { SortableList } from '../components/Sortable.js';
import { Banner } from '../components/Overlays.js';
import { Icon } from '../icons.js';
import { useLocal } from '../hooks.js';
import { store, openSheet } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';
import { countLabel } from '../../core/plural.js';
import { LIMITS } from '../../config.js';

export function TodayScreen() {
  const { today, time, ms } = store.now;
  const v = useMemo(() => S.todayView(store.data, today, time, ms), [store.version, today, time]);
  const inboxCount = useMemo(() => S.inboxView(store.data).length, [store.version]);
  const [dismissedOn, setDismissedOn] = useLocal('yesterdayDismissed', null);
  const readOnly = !!store.ui.readOnly;

  const choresList = S.liveList(store.data, store.data.settings.choresListId);
  const focusDone = v.focus.filter((t) => t.status === 'done').length;
  const mainUndone = v.focus.some((t) => t.status === 'active') || v.overdue.length || v.today.length;
  const everythingEmpty = !v.focus.length && !v.overdue.length && !v.today.length && !v.chores.length && !v.soon.length;

  const showYesterday = v.yesterdayFocus.length > 0 && dismissedOn !== today && !readOnly;

  return html`
    <div class="screen today">
      ${showYesterday ? html`
        <${Banner} tone="warn" onClose=${() => setDismissedOn(today)} actions=${html`
          <button class="btn small primary" onClick=${() => A.carryYesterdayFocus(v.yesterdayFocus.map((t) => t.id))}>Перенести на сегодня</button>
          <button class="btn small" onClick=${() => A.clearFocus(v.yesterdayFocus.map((t) => t.id))}>Убрать из главного</button>`}>
          Вчера не сделано главное: ${v.yesterdayFocus.length}
          <div class="banner-sub">${v.yesterdayFocus.map((t) => t.title).join(' · ')}</div>
        <//>` : null}

      <${Section} title=${html`<${Icon} name="star" filled size=${18}/> Главное`}
        count=${v.focus.length ? `${focusDone}/${v.focus.length}` : null} className="focus-section"
        actions=${!readOnly && v.focus.length < LIMITS.focusMax
          ? html`<button class="btn small ghost" onClick=${() => openSheet('focusPicker')}>Выбрать</button>` : null}>
        ${v.focus.length > LIMITS.focusMax ? html`<p class="hint warn">Главных больше трёх — убери лишние</p>` : null}
        ${v.focus.length
          ? html`<${SortableList} items=${v.focus} disabled=${readOnly}
              onMove=${(id, index) => A.reorderTask(id, v.focus, index, 'focusOrder')}
              render=${(t, handle) => html`<${TaskRow} task=${t} handle=${handle}/>`}/>`
          : html`<${Empty}>Выбери до ${LIMITS.focusMax} главных задач на сегодня — нажми ★ у задачи или «Выбрать».<//>`}
      <//>

      ${v.overdue.length ? html`
        <${Section} title="Просрочено" count=${v.overdue.length} tone="danger"
          actions=${readOnly ? null : html`<button class="btn small ghost" onClick=${() => A.moveOverdueToToday(v.overdue.map((t) => t.id))}>Всё на сегодня</button>`}>
          <${TaskList} tasks=${v.overdue}/>
        <//>` : null}

      ${v.today.length ? html`
        <${Section} title="На сегодня" count=${v.today.length}>
          <${TaskList} tasks=${v.today}/>
        <//>` : null}

      ${v.soon.length ? html`
        <${Section} title="Скоро дедлайн" count=${v.soon.length} collapsible defaultOpen=${false} storageKey="today.soon">
          <${TaskList} tasks=${v.soon}/>
        <//>` : null}

      ${v.chores.length ? html`
        <${Section} key=${'chores-' + (mainUndone ? 1 : 0)} className="chores"
          title=${`${choresList?.emoji ? choresList.emoji + ' ' : ''}Быт`} count=${v.chores.length}
          collapsible defaultOpen=${!mainUndone}>
          <${TaskList} tasks=${v.chores} showList=${false}/>
        <//>` : null}

      ${everythingEmpty ? html`
        <div class="empty-state">
          <div class="empty-emoji">🌤</div>
          <p>На сегодня ничего.</p>
          <p class="muted">Загляни во «Входящие» (${countLabel(inboxCount, ['задача', 'задачи', 'задач'])}) или запланируй что-нибудь на сегодня.</p>
        </div>` : null}

      ${v.doneToday.length ? html`
        <${Section} title="Выполнено сегодня" count=${v.doneToday.length} collapsible defaultOpen=${false} storageKey="today.done">
          <${TaskList} tasks=${v.doneToday}/>
        <//>` : null}
    </div>`;
}
