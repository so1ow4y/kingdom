// Разговор с жителем деревни «как в новеллах» (обновление 0.8): снизу окно с крупным пиксельным портретом,
// табличкой с именем, сердечками дружбы и навыком, текст печатается по буквам, дальше — выбор ответа.
// Дерево реплик — village/dialogs.js. Житель в это время стоит и смотрит на нас, камера подъезжает к нему.
// 0.12.5: «Что у нас по делам?» — задачи по дням прямо в окне: выбрать задачу для фокуса или закрыть её, не уходя
// из разговора; житель радуется каждой закрытой задаче.

import { html, useEffect, useRef, useState } from '../html.js';
import { store, notify, openSheet } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as M from '../../core/model.js';
import * as S from '../../core/selectors.js';
import { world, env } from '../../village/runtime.js';
import { talkTree, whoTitle, RESIDENTS, hearts } from '../../village/dialogs.js';
import { portrait } from '../../village/portraits.js';
import { keeperOf } from '../../village/keepers.js';
import { LOOKS } from '../../village/chibi.js';
import { affinityOf } from '../../core/skills.js';
import { happiness } from '../../core/village.js';
import { doneEntries } from '../../core/retention.js';
import { localDateOf, dayLabel, daysBetween } from '../../core/dates.js';
import { countLabel } from '../../core/plural.js';
import { getFocus } from '../../store/focus.js';
import { navigate } from '../router.js';
import { skillsNow, SkillBadge } from './Skills.js';
import { tr } from '../../core/i18n.js';

/** Текущий разговор: { actor, who, ctx, tree, node, line } или null. */
export const talk = { current: null };

function keeperTasks(data, listId, today) {
  const tasks = [...data.tasks.values()].filter((t) => !t.deletedAt && !t.trashedAt && t.status === 'active' && M.taskListIds(t).includes(listId));
  const late = (t) => (t.deadlineDate && t.deadlineDate < today) || (t.scheduledDate && t.scheduledDate < today);
  const day = (t) => t.deadlineDate || t.scheduledDate || (t.focusDate === today ? today : '9999');
  const sorted = [...tasks].sort((a, b) => (late(b) - late(a)) || (day(a) < day(b) ? -1 : day(a) > day(b) ? 1 : 0) || (a.order < b.order ? -1 : 1));
  const tz = data.settings.timeZone;
  const doneToday = doneEntries(data, tz).filter((e) => e.date === today && e.listIds.includes(listId)).length;
  return { open: tasks.length, overdue: tasks.filter(late).length, today: doneToday, any: tasks.length > 0, next: sorted[0] ? { id: sorted[0].id, title: sorted[0].title } : null };
}

/** Дела на сегодня во всех списках — для жителей из магазина (0.12.5). */
function todayTasks(data, today) {
  const { groups, total } = S.dayGroups(data, today, store.now.time);
  const td = groups.find((g) => g.key === 'today')?.tasks || [];
  return { open: td.length, overdue: td.filter((x) => x.overdue).length, any: total > 0, next: null };
}

const CHEERS = [
  (g, x) => tr('Готово: «{x}»! Горжусь тобой!', { x }),
  (g, x) => tr('Ура, «{x}» — всё! Деревня это почувствовала.', { x }),
  (g, x) => tr('«{x}» — закрыто! Так держать!', { x }),
  (g, x) => tr('Вот это да! «{x}» уже позади.', { x }),
];

/** Кто это: имя, роль, внешность, симпатия — для портрета и дерева реплик. */
function whoOf(a) {
  const data = store.data;
  const tz = data.settings.timeZone;
  const today = store.now.today;
  if (a.kind === 'keeper') {
    const list = data.lists.get(a.listId);
    const skill = skillsNow().get(a.listId);
    const k = list && keeperOf(list, skill);
    if (!k) return null;
    return {
      who: { kind: 'keeper', keeper: true, name: a.name || k.name, title: k.title, gender: k.gender, role: k.role, stage: k.stage, listId: list.id, listName: list.name, look: k.look, color: list.color },
      affinity: skill?.affinity || affinityOf(0), skill, tasks: keeperTasks(data, list.id, today),
    };
  }
  const R = RESIDENTS[a.kind] || RESIDENTS.wanderer;
  // симпатия жителя из магазина — по задачам, выполненным с тех пор, как он поселился (каждые две)
  let since = '';
  for (const e of data.coinEvents.values()) if (!e.deletedAt && e.active && e.type === 'purchase' && e.itemId === a.id) since = localDateOf(e.at, tz);
  const n = doneEntries(data, tz).filter((e) => e.date >= since).length;
  return {
    who: { kind: a.kind, keeper: false, name: R.name, title: R.title, gender: R.gender, look: LOOKS[a.kind] || null, color: null },
    affinity: affinityOf(Math.floor(n / 2)), tasks: R.beast ? null : todayTasks(data, today),
  };
}

export function openTalk(actor) {
  if (!actor) return;
  const info = whoOf(actor);
  if (!info) return;
  const ctx = {
    ...info,
    mood: happiness(store.data, store.data.settings.timeZone, store.now.today).value,
    night: env.n, focus: !!getFocus(), seed: Math.floor(Date.now() / 60000) + (actor.n || 0),
    knock: world.visitor?.actor === actor, // 0.9: разговор с гостем у экрана
  };
  const tree = talkTree(ctx);
  world.talkTo(actor);
  talk.current = { actor, who: info.who, ctx, tree, node: tree.start, line: 0 };
  onLine();
  notify();
}

export function closeTalk() {
  const t = talk.current;
  if (!t) return;
  world.release(t.actor);
  talk.current = null;
  notify();
}

/** Жест жителя под эмоцию реплики. */
function onLine() {
  const t = talk.current;
  const l = t?.tree.nodes[t.node]?.lines[t.line];
  if (!l) return;
  const a = t.actor;
  if (l.e === 'grin') world.gesture(a, 'jump');
  if (l.e === 'sad') world.gesture(a, 'sad');
  if (l.e === 'blush' || l.e === 'closed') world.gesture(a, 'heart');
  a.happy = l.e === 'grin' || l.e === 'smile' || l.e === 'closed';
}

function goNode(id) {
  const t = talk.current;
  if (!t) return;
  const node = t.tree.nodes[id];
  if (!node) return closeTalk();
  t.node = id;
  t.line = 0;
  t.reply = null;
  if (node.act === 'poke') {
    world.gesture(t.actor, 'wave');
    world.gesture(t.actor, 'heart');
  }
  onLine();
  notify();
}

function choose(ch) {
  const t = talk.current;
  if (!t) return;
  const node = t.tree.nodes[t.node];
  const listId = t.who.listId;
  if (ch.act === 'openList') navigate(listId ? '/list/' + listId : '/today');
  else if (ch.act === 'focus' && t.ctx.tasks?.next) openSheet('focus', { taskId: t.ctx.tasks.next.id });
  else if (ch.act === 'prestige' && listId) A.prestigeList(listId);
  if (ch.close) {
    const actor = t.actor;
    closeTalk();
    if (node.act === 'come') world.sendVisitor(actor);
    return;
  }
  goNode(ch.go);
}

/** Ответ жителя на действие в окне (не узел дерева): печатается вместо реплики. */
function reply(text, e = 'grin') {
  const t = talk.current;
  if (!t) return;
  t.reply = { t: text, e };
  t.replyN = (t.replyN || 0) + 1;
  onLine();
  notify();
}

/** Обновить симпатию, навык и счётчики дел после закрытой задачи. */
function refreshWho() {
  const t = talk.current;
  const info = t && whoOf(t.actor);
  if (info) t.ctx = { ...t.ctx, ...info };
}

async function completeFromTalk(task) {
  const t = talk.current;
  if (!t) return;
  await A.toggleComplete(task.id);
  const now = store.data.tasks.get(task.id);
  const done = !now || now.status === 'done' || (task.repeat && now.repeat && S.plannedDate(now, store.now.today) !== S.plannedDate(task, store.now.today));
  if (!done) return;
  refreshWho();
  const g = (m, f) => (t.who.gender === 'm' ? m : f);
  world.gesture(t.actor, 'jump');
  world.gesture(t.actor, 'heart');
  reply(CHEERS[(t.replyN || 0) % CHEERS.length](g, task.title.length > 40 ? task.title.slice(0, 39) + '…' : task.title));
}

function focusFromTalk(task) {
  openSheet('focus', { taskId: task.id });
  reply(tr('«{p0}» — отличный выбор. Удачи, я буду рядом!', { p0: task.title.length > 40 ? task.title.slice(0, 39) + '…' : task.title }), 'smile');
}

function groupLabel(g, today) {
  if (g.key === 'today') return tr('Сегодня');
  if (g.key === 'none') return tr('Без даты');
  const year = g.date.slice(0, 4) !== today.slice(0, 4) ? ' ' + g.date.slice(0, 4) : '';
  return (daysBetween(today, g.date) === 1 ? tr('Завтра · ') : '') + dayLabel(g.date) + year;
}
const PICK_LIMIT = 60;

/** Задачи по дням внутри окна разговора: «▶» — фокус, «✓» — выполнить. */
function TalkTasks({ mode, listId }) {
  const today = store.now.today;
  const { groups, total } = S.dayGroups(store.data, today, store.now.time, { listId });
  const [all, setAll] = useState(false);
  const lists = store.data.lists;
  let left = all ? Infinity : PICK_LIMIT;
  if (!total) return html`<p class="vn-empty">Открытых задач нет.</p>`;
  return html`<div class="vn-tasks" role="list" aria-label=${mode === 'focus' ? tr('Выбери задачу для фокуса') : tr('Отметь выполненные задачи')}>
    ${groups.map((g) => {
      if (left <= 0) return null;
      const rows = g.tasks.slice(0, left);
      left -= rows.length;
      return html`<div class="vn-day" key=${g.key}>
        <p class="vn-day-title">${groupLabel(g, today)} <small>${g.tasks.length}</small></p>
        ${rows.map(({ task, overdue, star }) => {
          const time = task.scheduledTime || task.deadlineTime || '';
          const other = !listId ? M.taskListIds(task).map((id) => lists.get(id)).find((l) => l && !l.deletedAt) : null;
          const parent = task.parentId ? store.data.tasks.get(task.parentId) : null;
          return html`<div class="vn-task" role="listitem" key=${task.id}>
            ${mode === 'done' ? html`<button type="button" class="vn-check" aria-label=${tr('Выполнить: ') + task.title} title="Выполнить"
              onClick=${() => completeFromTalk(task)}>✓</button>` : null}
            <span class="vn-task-main">
              <span class="vn-task-title">${star ? '★ ' : ''}${task.title}</span>
              <small>${[overdue ? tr('⚠ просрочено') : '', time, task.repeat ? '↻' : '', parent && !parent.deletedAt ? '↳ ' + parent.title : '', other ? other.name : ''].filter(Boolean).join(' · ')}</small>
            </span>
            ${mode === 'focus' ? html`<button type="button" class="vn-play" aria-label=${tr('Фокус: ') + task.title} title="Взяться — фокус-таймер"
              onClick=${() => focusFromTalk(task)}>▶</button>` : null}
          </div>`;
        })}
      </div>`;
    })}
    ${!all && total > PICK_LIMIT ? html`<button type="button" class="link-btn vn-all" onClick=${() => setAll(true)}>Показать все (${countLabel(total, ['задача', 'задачи', 'задач'])})</button>` : null}
  </div>`;
}

/** Окно разговора (на экране «Деревня»). */
export function VillageDialog() {
  const t = talk.current;
  const cv = useRef(null);
  const [shown, setShown] = useState(0);
  const node = t ? t.tree.nodes[t.node] : null;
  const line = t?.reply || (node ? node.lines[t.line] : null);
  const text = line?.t || '';
  const full = shown >= text.length;
  const last = node ? !!t.reply || t.line >= node.lines.length - 1 : true;
  // печать по буквам
  useEffect(() => {
    setShown(0);
    if (!text) return undefined;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setShown(text.length);
      return undefined;
    }
    const id = setInterval(() => setShown((n) => {
      if (n >= text.length) {
        clearInterval(id);
        return n;
      }
      return n + 2;
    }), 28);
    return () => clearInterval(id);
  }, [t?.node, t?.line, t?.replyN, text]);
  // портрет с эмоцией
  useEffect(() => {
    if (!t || !cv.current) return;
    const p = portrait(t.who, line?.e || 'neutral');
    const el = cv.current;
    if (el.width !== p.width) {
      el.width = p.width;
      el.height = p.height;
    }
    const c = el.getContext('2d');
    c.clearRect(0, 0, el.width, el.height);
    c.imageSmoothingEnabled = false;
    c.drawImage(p, 0, 0);
  }, [t?.who, line?.e]);
  // клавиатура: Enter/пробел — дальше, цифры — ответ, Esc — закрыть
  useEffect(() => {
    if (!t) return undefined;
    const onKey = (e) => {
      if (store.ui.sheet || store.ui.dialog) return; // сверху окно фокуса или вопрос — клавиши его
      if (e.target instanceof Element && e.target.closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'Escape') return closeTalk();
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        next();
      }
      const n = Number(e.key);
      if (n >= 1 && full && last && node?.choices?.[n - 1]) choose(node.choices[n - 1]);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  if (!t || !node) return null;
  function next() {
    if (!full) return setShown(text.length);
    if (!last) {
      t.line++;
      onLine();
      notify();
    }
  }
  const w = t.who;
  const aff = t.ctx.affinity;
  // пока открыто окно фокуса или вопрос («Выполнить и подзадачи?») — разговор прячется и ждёт (0.12.5)
  const away = !!(store.ui.sheet || store.ui.dialog);
  return html`<div class=${'vn-dialog' + (away ? ' vn-away' : '')} role="dialog" aria-label=${tr('Разговор: {name}', { name: w.name })} aria-hidden=${away} style=${{ '--vn-color': w.color || 'var(--accent)' }}>
    <div class="vn-portrait" aria-hidden="true"><canvas ref=${cv} width="128" height="128"></canvas></div>
    <div class="vn-box">
      <div class="vn-name">
        <b>${w.name}</b><small>${whoTitle(w)}</small>
        ${aff ? html`<span class="vn-hearts" title=${tr('Дружба: {name}', { name: aff.name })}>${hearts(aff.tier)}</span>` : null}
        ${w.keeper ? html`<${SkillBadge} listId=${w.listId}/>` : null}
      </div>
      <button class="icon-btn small vn-close" onClick=${closeTalk} aria-label="Закончить разговор" title="Закончить разговор (Esc)">×</button>
      <p class="vn-text" onClick=${next} aria-live="polite">${text.slice(0, shown)}${full && !last ? html`<span class="vn-more" aria-hidden="true">▼</span>` : null}</p>
      ${node.picker && last ? html`<${TalkTasks} mode=${node.picker} listId=${w.keeper ? w.listId : null}/>` : null}
      ${full && last ? html`<div class="vn-choices">
        ${node.choices.map((ch, i) => html`<button class="vn-choice" key=${i} onClick=${() => choose(ch)}><span class="vn-num">${i + 1}</span>${ch.label}</button>`)}
      </div>` : html`<button class="vn-next" onClick=${next}>${full ? tr('Дальше ▸') : tr('Пропустить ▸▸')}</button>`}
    </div>
  </div>`;
}
