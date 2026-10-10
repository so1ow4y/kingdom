// «Архив и корзина» (docs/TZ.md §6.8, §6.9; с 0.10 — один пункт дока с вкладками «Выполненные» и «Корзина»)
// и «Поиск задач». Все три экрана — обозреватель задач (components/Explorer.js), перенос обработки
// пользователей и сработок из license-store: поиск «поле:значение», топ значений, массовые действия.

import { html, useRef, useLayoutEffect } from '../html.js';
import { Icon } from '../icons.js';
import { Link, navigate } from '../router.js';
import { store } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';
import { plural } from '../../core/plural.js';
import { doneCount } from '../../core/retention.js';
import { INBOX_NAME } from '../../core/explore.js';
import { TaskExplorer } from '../components/Explorer.js';
import { TaskBank } from './Bank.js';
import { tr } from '../../core/i18n.js';

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
  if (listId === 'inbox') return tr('список:{p0}', { p0: INBOX_NAME.toLowerCase() });
  const l = S.liveList(store.data, listId);
  if (!l) return '';
  return /[\s()|"]/.test(l.name) ? tr('список:"{p0}"', { p0: l.name.replace(/"/g, '') }) : tr('список:{name}', { name: l.name });
}

export function ArchiveScreen({ query = {} }) {
  const limit = store.data.settings.completedLimit;
  return html`
    <div class="screen">
      <${PageHeader}>
        Выполненные задачи. Хранится: ${doneCount(store.data)}${limit == null ? tr(' · без лимита') : tr(' из {limit}', { limit })} — старые сверх лимита
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

/** Вкладки «Поиска» (0.15) — как «Продукты · Лекарства · Замеры»: те же пункты — веткой в доке. */
const SEARCH_TABS = [
  ['all', tr('Все задачи'), '/tasks'],
  ['active', tr('Активные'), '/tasks/active'],
  ['repeat', tr('Повторяющиеся'), '/tasks/repeat'],
  ['bank', tr('Банк задач'), '/tasks/bank'],
];

const SEARCH_DESC = {
  all: tr('Все задачи: активные, выполненные и в корзине. Ищи словами или условиями «поле:значение», отмечай галочками — и делай с выбранными что нужно сразу.'),
  active: tr('Активные задачи — ещё не выполненные, без корзины: с датой и без, в любых списках.'),
  repeat: tr('Повторяющиеся задачи и их правила. Выполненные — те, у которых повтор закончился.'),
};

export function TasksScreen({ query = {}, tab = null }) {
  const kind = SEARCH_TABS.some(([k]) => k === tab) ? tab : 'all';
  // на узком экране вкладки прокручиваются: выбранная — всегда видна
  const bar = useRef(null);
  useLayoutEffect(() => {
    const el = bar.current;
    const on = el?.querySelector('.section-tab.active');
    if (on && el.scrollWidth > el.clientWidth) el.scrollLeft += on.getBoundingClientRect().left - el.getBoundingClientRect().left - (el.clientWidth - on.offsetWidth) / 2;
  }, [kind]);
  return html`
    <div class="screen">
      <div class="section-tabs" role="tablist" aria-label="Поиск" ref=${bar}>
        ${SEARCH_TABS.map(([k, label, to]) => html`<button type="button" role="tab" key=${k} aria-selected=${kind === k}
          class=${'section-tab' + (kind === k ? ' active' : '')} onClick=${() => navigate(to, { replace: true })}>
          ${k === 'bank' ? html`<${Icon} name="bank" size=${15}/>` : null}${label}</button>`)}
      </div>
      ${kind === 'bank' ? html`<${TaskBank}/>` : html`
        <${PageHeader}>${SEARCH_DESC[kind]}<//>
        <${TaskExplorer} key=${kind} kind=${kind} initialQ=${query.q || ''}/>`}
    </div>`;
}
