// Разговор с жителем деревни «как в новеллах» (обновление 0.8): снизу окно с крупным пиксельным портретом,
// табличкой с именем, сердечками дружбы и навыком, текст печатается по буквам, дальше — выбор ответа.
// Дерево реплик — village/dialogs.js. Житель в это время стоит и смотрит на нас, камера подъезжает к нему.

import { html, useEffect, useRef, useState } from '../html.js';
import { store, notify, openSheet } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as M from '../../core/model.js';
import { world, env } from '../../village/runtime.js';
import { talkTree, whoTitle, RESIDENTS, hearts } from '../../village/dialogs.js';
import { portrait } from '../../village/portraits.js';
import { keeperOf } from '../../village/keepers.js';
import { LOOKS } from '../../village/chibi.js';
import { affinityOf } from '../../core/skills.js';
import { happiness } from '../../core/village.js';
import { doneEntries } from '../../core/retention.js';
import { localDateOf } from '../../core/dates.js';
import { getFocus } from '../../store/focus.js';
import { navigate } from '../router.js';
import { skillsNow, SkillBadge } from './Skills.js';

/** Текущий разговор: { actor, who, ctx, tree, node, line } или null. */
export const talk = { current: null };

function keeperTasks(data, listId, today) {
  const tasks = [...data.tasks.values()].filter((t) => !t.deletedAt && !t.trashedAt && t.status === 'active' && M.taskListIds(t).includes(listId));
  const late = (t) => (t.deadlineDate && t.deadlineDate < today) || (t.scheduledDate && t.scheduledDate < today);
  const day = (t) => t.deadlineDate || t.scheduledDate || (t.focusDate === today ? today : '9999');
  const sorted = [...tasks].sort((a, b) => (late(b) - late(a)) || (day(a) < day(b) ? -1 : day(a) > day(b) ? 1 : 0) || (a.order < b.order ? -1 : 1));
  const tz = data.settings.timeZone;
  const doneToday = doneEntries(data, tz).filter((e) => e.date === today && e.listIds.includes(listId)).length;
  return { open: tasks.length, overdue: tasks.filter(late).length, today: doneToday, next: sorted[0] ? { id: sorted[0].id, title: sorted[0].title } : null };
}

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
  return { who: { kind: a.kind, keeper: false, name: R.name, title: R.title, gender: R.gender, look: LOOKS[a.kind] || null, color: null }, affinity: affinityOf(Math.floor(n / 2)) };
}

export function openTalk(actor) {
  if (!actor) return;
  const info = whoOf(actor);
  if (!info) return;
  const ctx = {
    ...info,
    mood: happiness(store.data, store.data.settings.timeZone, store.now.today).value,
    night: env.n, focus: !!getFocus(), seed: Math.floor(Date.now() / 60000) + (actor.n || 0),
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
  if (ch.act === 'openList' && listId) navigate('/list/' + listId);
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

/** Окно разговора (на экране «Деревня»). */
export function VillageDialog() {
  const t = talk.current;
  const cv = useRef(null);
  const [shown, setShown] = useState(0);
  const node = t ? t.tree.nodes[t.node] : null;
  const line = node ? node.lines[t.line] : null;
  const text = line?.t || '';
  const full = shown >= text.length;
  const last = node ? t.line >= node.lines.length - 1 : true;
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
  }, [t?.node, t?.line, text]);
  // портрет с эмоцией
  useEffect(() => {
    if (!t || !cv.current) return;
    const c = cv.current.getContext('2d');
    c.clearRect(0, 0, 64, 64);
    c.imageSmoothingEnabled = false;
    c.drawImage(portrait(t.who, line?.e || 'neutral'), 0, 0);
  }, [t?.who, line?.e]);
  // клавиатура: Enter/пробел — дальше, цифры — ответ, Esc — закрыть
  useEffect(() => {
    if (!t) return undefined;
    const onKey = (e) => {
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
  return html`<div class="vn-dialog" role="dialog" aria-label=${`Разговор: ${w.name}`} style=${{ '--vn-color': w.color || 'var(--accent)' }}>
    <div class="vn-portrait" aria-hidden="true"><canvas ref=${cv} width="64" height="64"></canvas></div>
    <div class="vn-box">
      <div class="vn-name">
        <b>${w.name}</b><small>${whoTitle(w)}</small>
        ${aff ? html`<span class="vn-hearts" title=${`Дружба: ${aff.name}`}>${hearts(aff.tier)}</span>` : null}
        ${w.keeper ? html`<${SkillBadge} listId=${w.listId}/>` : null}
      </div>
      <button class="icon-btn small vn-close" onClick=${closeTalk} aria-label="Закончить разговор" title="Закончить разговор (Esc)">×</button>
      <p class="vn-text" onClick=${next} aria-live="polite">${text.slice(0, shown)}${full && !last ? html`<span class="vn-more" aria-hidden="true">▼</span>` : null}</p>
      ${full && last ? html`<div class="vn-choices">
        ${node.choices.map((ch, i) => html`<button class="vn-choice" key=${i} onClick=${() => choose(ch)}><span class="vn-num">${i + 1}</span>${ch.label}</button>`)}
      </div>` : html`<button class="vn-next" onClick=${next}>${full ? 'Дальше ▸' : 'Пропустить ▸▸'}</button>`}
    </div>
  </div>`;
}
