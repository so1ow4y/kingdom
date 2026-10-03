// Экран «Сегодня» (docs/TZ.md §6.2). Все блоки — деревьями в одной области перетаскивания (обновление 0.4):
// подзадача, чей родитель тоже на экране, показывается под ним; вложить можно и в задачу соседнего блока,
// а переставлять между блоками нельзя. Ручной порядок — только в «Главном», в остальных блоках он автоматический.

import { html, useMemo } from '../html.js';
import { Section, Empty } from '../components/Section.js';
import { TaskTree, DragScope } from '../components/TaskTree.js';
import { Banner } from '../components/Overlays.js';
import { Icon } from '../icons.js';
import { useLocal } from '../hooks.js';
import { store, openSheet } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';
import { countLabel } from '../../core/plural.js';
import { LIMITS } from '../../config.js';
import { addDays, humanDate } from '../../core/dates.js';
import { planningDate } from '../../core/planning.js';
import { navigate } from '../router.js';
import { DayContext } from '../dayContext.js';

export function TodayScreen({ query = {} }) {
  const today = planningDate(query.date, store.now.today);
  const current = today === store.now.today;
  const time = current ? store.now.time : '00:00';
  const ms = current ? store.now.ms : Date.parse(today + 'T12:00:00Z');
  const go = (date) => navigate(date === store.now.today ? '/today' : '/today?date=' + date);
  const v = useMemo(() => {
    const view = S.todayView(store.data, today, time, ms, !current);
    if (!current) { view.overdue = []; view.soon = []; view.chores = view.chores.filter(t => t.scheduledDate === today || t.deadlineDate === today); }
    return view;
  }, [store.version, today, time, current]);
  const f = useMemo(() => S.selectionForest(store.data, {
    focus: v.focus, overdue: v.overdue, today: v.today, chores: v.chores, soon: v.soon, doneToday: v.doneToday,
  }), [v]);
  const zone = (key, autoReason) => ({
    manual: !autoReason,
    orderField: key === 'focus' ? 'focusOrder' : 'order',
    accepts: (t) => f.home.get(t.id) === key,
    rejectReason: key === 'focus' ? 'В «Главное» — звёздочкой ★' : 'Задача из другого блока — сюда её можно только вложить',
    autoReason,
  });
  const tree = (key, autoReason, props = {}) => html`<${TaskTree} zone=${key} roots=${f.roots[key]} index=${f.index}
    cfg=${zone(key, autoReason)} ...${props}/>`;
  const inboxCount = useMemo(() => S.inboxView(store.data).length, [store.version]);
  const [dismissedOn, setDismissedOn] = useLocal('yesterdayDismissed', null);
  const readOnly = !!store.ui.readOnly;

  const choresList = S.liveList(store.data, store.data.settings.choresListId);
  const focusDone = v.focus.filter((t) => t.status === 'done').length;
  const mainUndone = v.focus.some((t) => t.status === 'active') || v.overdue.length || v.today.length;
  const everythingEmpty = !v.focus.length && !v.overdue.length && !v.today.length && !v.chores.length && !v.soon.length;

  const showYesterday = current && v.yesterdayFocus.length > 0 && dismissedOn !== today && !readOnly;

  return html`
    <${DayContext.Provider} value=${today}>
    <${DragScope} className="screen today">
      <div class="day-navigation card-block">
        <button class="btn" aria-label="Предыдущий день" onClick=${() => go(addDays(today, -1))}>←</button>
        <label class="field"><span>${humanDate(today, store.now.today)}</span><input type="date" aria-label="День планирования" value=${today}
          onChange=${e => e.target.value && go(planningDate(e.target.value, store.now.today))}/></label>
        <button class="btn" aria-label="Следующий день" onClick=${() => go(addDays(today, 1))}>→</button>
        <button class="chip" onClick=${() => go(store.now.today)}>Сегодня</button>
        <button class="chip" onClick=${() => go(addDays(store.now.today, 1))}>Завтра</button>
      </div>
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
          ? html`<button class="btn small ghost" onClick=${() => openSheet('focusPicker', { date: today })}>Выбрать</button>` : null}>
        ${v.focus.length > LIMITS.focusMax ? html`<p class="hint warn">Главных больше трёх — убери лишние</p>` : null}
        ${f.roots.focus.length
          ? tree('focus', null)
          : html`<${Empty}>Выбери до ${LIMITS.focusMax} главных задач на этот день — нажми ★ у задачи или «Выбрать».<//>`}
      <//>

      ${f.roots.overdue.length ? html`
        <${Section} title="Просрочено" count=${f.roots.overdue.length} tone="danger"
          actions=${readOnly ? null : html`<button class="btn small ghost" onClick=${() => A.moveOverdueToToday(v.overdue.map((t) => t.id))}>Всё на сегодня</button>`}>
          ${tree('overdue', 'Порядок здесь по дате — можно вложить или вынести')}
        <//>` : null}

      ${f.roots.today.length ? html`
        <${Section} title=${current ? 'На сегодня' : 'На этот день'} count=${f.roots.today.length}>
          ${tree('today', 'Порядок здесь по времени и приоритету — можно вложить или вынести')}
        <//>` : null}

      ${f.roots.soon.length ? html`
        <${Section} title="Скоро дедлайн" count=${f.roots.soon.length} collapsible defaultOpen=${false} storageKey="today.soon">
          ${tree('soon', 'Порядок здесь по дедлайну — можно вложить или вынести')}
        <//>` : null}

      ${f.roots.chores.length ? html`
        <${Section} key=${'chores-' + (mainUndone ? 1 : 0)} className="chores"
          title=${`${choresList?.emoji ? choresList.emoji + ' ' : ''}Быт`} count=${f.roots.chores.length}
          collapsible defaultOpen=${!mainUndone}>
          ${tree('chores', 'Порядок здесь по времени — можно вложить или вынести', { showList: false })}
        <//>` : null}

      ${everythingEmpty ? html`
        <div class="empty-state">
          <div class="empty-emoji">🌤</div>
          <p>На этот день ничего.</p>
          <p class="muted">Загляни во «Входящие» (${countLabel(inboxCount, ['задача', 'задачи', 'задач'])}) или добавь задачу кнопкой «+».</p>
        </div>` : null}

      ${f.roots.doneToday.length ? html`
        <${Section} title="Выполнено в этот день" count=${f.roots.doneToday.length} collapsible defaultOpen=${false} storageKey=${'today.done.' + today}>
          ${tree('doneToday', 'Порядок здесь по времени выполнения')}
        <//>` : null}
    <//><//>`;
}
