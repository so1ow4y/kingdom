// Настройка приоритетов (п. 2.6, 2.9): переименовать, перекрасить, монеты, опыт навыка (0.8), порядок, добавить свой,
// архивировать.
// Удалить можно только неиспользуемый приоритет; «Без приоритета» — базовый, его нельзя убрать.

import { html, useState, useEffect, useRef } from '../html.js';
import { Icon } from '../icons.js';
import { SortableList, DragHandle } from './Sortable.js';
import { store } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';
import { PRIORITY_NONE_ID, priorityLabel } from '../../core/priorities.js';
import { xpOfPriority } from '../../core/skills.js';

function PriorityRow({ p, handle, readOnly }) {
  const [name, setName] = useState(priorityLabel(p));
  const [coins, setCoins] = useState(String(p.coins));
  const [xp, setXp] = useState(String(xpOfPriority(p)));
  useEffect(() => setName(priorityLabel(p)), [p.name]);
  useEffect(() => setCoins(String(p.coins)), [p.coins]);
  useEffect(() => setXp(String(xpOfPriority(p))), [p.xp, p.coins]);
  const base = p.id === PRIORITY_NONE_ID;
  const inUse = S.priorityInUse(store.data, p.id);
  const saveName = () => {
    const n = name.trim();
    if (n && n !== priorityLabel(p)) A.updatePriority(p.id, { name: n.slice(0, 40) });
    else setName(priorityLabel(p));
  };
  const saveCoins = () => {
    const v = Math.max(0, Math.min(100000, Math.round(Number(coins)) || 0));
    setCoins(String(v));
    if (v !== p.coins) A.updatePriority(p.id, { coins: v });
  };
  const saveXp = () => {
    const v = Math.max(0, Math.min(100000, Math.round(Number(xp)) || 0));
    setXp(String(v));
    if (v !== xpOfPriority(p) || !Number.isFinite(p.xp)) A.updatePriority(p.id, { xp: v });
  };
  return html`
    <div class="prio-row">
      <input type="color" value=${p.color} disabled=${readOnly} aria-label="Цвет"
        onChange=${(e) => A.updatePriority(p.id, { color: e.target.value.toUpperCase() })}/>
      <input type="text" value=${name} maxLength="40" disabled=${readOnly} aria-label="Название"
        onInput=${(e) => setName(e.target.value)} onBlur=${saveName} onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()}/>
      <input type="number" class="prio-coins" min="0" max="100000" value=${coins} disabled=${readOnly} aria-label="Монеты"
        title="Монет за выполнение" onInput=${(e) => setCoins(e.target.value)} onBlur=${saveCoins}/>
      <span class="muted small">🪙</span>
      <input type="number" class="prio-coins prio-xp" min="0" max="100000" value=${xp} disabled=${readOnly} aria-label="Опыт навыка"
        title="Опыт навыка списка за выполнение" onInput=${(e) => setXp(e.target.value)} onBlur=${saveXp}/>
      <span class="muted small" title="Опыт навыка">⭐</span>
      ${base ? html`<span class="muted small" title="Базовый приоритет">база</span>` : html`
        <button class="icon-btn" disabled=${readOnly} title="В архив" aria-label="В архив"
          onClick=${() => A.updatePriority(p.id, { archived: true })}><${Icon} name="archive" size=${18}/></button>
        ${inUse ? null : html`<button class="icon-btn danger" disabled=${readOnly} title="Удалить" aria-label="Удалить"
          onClick=${() => A.deletePriority(p.id)}><${Icon} name="trash" size=${18}/></button>`}`}
      <${DragHandle} handle=${handle}/>
    </div>`;
}

export function PrioritiesSection({ focus = false }) {
  const ref = useRef(null);
  const readOnly = !!store.ui.readOnly;
  const list = S.sortedPriorities(store.data);
  const archived = S.sortedPriorities(store.data, { archived: true });
  const [name, setName] = useState('');
  const [color, setColor] = useState('#00897B');
  const [coins, setCoins] = useState('3');
  const [xp, setXp] = useState('10');
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus]);
  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    await A.createPriority({ name: name.trim(), color: color.toUpperCase(), coins: Number(coins) || 0, xp: Number(xp) || 0 });
    setName('');
  };
  return html`
    <section class="set-section" ref=${ref} id="priorities">
      <h2>Приоритеты</h2>
      <p class="muted small">Сколько монет 🪙 и опыта навыка ⭐ даёт выполнение задачи с этим приоритетом (опыт получает
        каждый список задачи). Порядок — перетаскиванием за ⋮⋮. Используемый приоритет удалить нельзя — только убрать в архив.</p>
      <${SortableList} items=${list} disabled=${readOnly} onMove=${(id, index) => A.reorderPriority(id, list, index)}
        render=${(p, handle) => html`<${PriorityRow} key=${p.id} p=${p} handle=${handle} readOnly=${readOnly}/>`}/>
      <form class="prio-row" onSubmit=${add}>
        <input type="color" value=${color} onInput=${(e) => setColor(e.target.value)} aria-label="Цвет нового приоритета"/>
        <input type="text" value=${name} maxLength="40" placeholder="Новый приоритет" onInput=${(e) => setName(e.target.value)} disabled=${readOnly}/>
        <input type="number" class="prio-coins" min="0" value=${coins} onInput=${(e) => setCoins(e.target.value)} aria-label="Монеты" title="Монет за выполнение"/>
        <input type="number" class="prio-coins prio-xp" min="0" value=${xp} onInput=${(e) => setXp(e.target.value)} aria-label="Опыт навыка" title="Опыт навыка за выполнение"/>
        <button class="btn small primary" type="submit" disabled=${!name.trim() || readOnly}>Добавить</button>
      </form>
      ${archived.length ? html`
        <h3 class="set-sub">В архиве</h3>
        ${archived.map((p) => html`<div class="prio-row" key=${p.id}>
          <i class="dot big" style=${{ background: p.color }}></i><span class="prio-name">${priorityLabel(p)} · ${p.coins} 🪙 · ${xpOfPriority(p)} ⭐</span>
          <button class="btn small" disabled=${readOnly} onClick=${() => A.updatePriority(p.id, { archived: false })}>Вернуть</button>
        </div>`)}` : null}
    </section>`;
}
