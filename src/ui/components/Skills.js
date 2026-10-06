// Навыки списков (обновление 0.8): значок «II · 37» у названия списка, шкала опыта до следующего уровня,
// кнопка «Престиж» на 100-м уровне и всплывающее «Новый уровень». Видны, когда включена игра.

import { html, useEffect, useMemo, useRef, useState } from '../html.js';
import { store } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import { allSkills, STAGES, MAX_LEVEL, roman } from '../../core/skills.js';
import { readLocal, writeLocal } from '../hooks.js';
import { getPrefs } from '../prefs.js';
import { emitVillage } from '../../village/bus.js';
import { keepersOf } from '../../village/keepers.js';

export const gameOn = () => !!store.data.settings?.gameEnabled;

let cache = { version: -1, skills: new Map() };
/** Навыки всех списков (пересчитываются один раз на версию данных). */
export function skillsNow() {
  if (cache.version !== store.version) cache = { version: store.version, skills: allSkills(store.data) };
  return cache.skills;
}

/** Значок навыка: римский престиж (как в Payday 2) и уровень. */
export function SkillBadge({ listId, className = '' }) {
  if (!gameOn()) return null;
  const s = skillsNow().get(listId);
  if (!s) return null;
  const title = `Навык: уровень ${s.level}${s.prestige ? `, престиж ${s.roman}` : ''}${s.max ? ' — можно повысить престиж' : ''}`;
  return html`<span class=${'skill-badge' + (s.prestige ? ' prestige' : '') + (s.max ? ' max' : '') + (className ? ' ' + className : '')} title=${title} aria-label=${title}>
    ${s.prestige ? html`<b>${s.roman}</b>` : null}<span>${s.level}</span></span>`;
}

/** Шкала опыта навыка: сколько до следующего уровня; на 100-м — «Престиж». */
export function SkillBar({ list }) {
  if (!gameOn() || !list) return null;
  const s = skillsNow().get(list.id);
  if (!s) return null;
  const k = keepersOf(store.data, skillsNow()).find((x) => x.listId === list.id);
  const readOnly = !!store.ui.readOnly;
  const pct = Math.round(s.progress * 100);
  return html`<div class=${'skill-bar' + (s.max ? ' max' : '')} style=${{ '--list-color': list.color }}>
    <div class="sb-head">
      <span class="sb-title">Навык <${SkillBadge} listId=${list.id}/></span>
      <span class="sb-next">${s.max ? 'Максимальный уровень' : `до ${s.level + 1} ур.: ${s.need - s.into} опыта`}</span>
    </div>
    <div class="sb-track" role="progressbar" aria-valuemin="0" aria-valuemax=${s.need || 1} aria-valuenow=${s.max ? 1 : s.into}
      aria-label=${`Опыт навыка «${list.name}»`}><i style=${{ width: (s.max ? 100 : pct) + '%' }}></i></div>
    <div class="sb-foot">
      <small class="muted">${[
        s.max ? `Престиж обнулит уровень и навсегда добавит ${roman(s.prestige + 1)}` : `${s.into} / ${s.need} ⭐`,
        `выполнено ${s.done}`,
        k ? `${k.name}, ${STAGES[k.stage][k.gender].toLowerCase()}` : '',
      ].filter(Boolean).join(' · ')}</small>
      ${s.max ? html`<button class="btn small primary sb-prestige" disabled=${readOnly} onClick=${() => A.prestigeList(list.id)}>✨ Престиж ${roman(s.prestige + 1)}</button>` : null}
    </div>
  </div>`;
}

/** «Новый уровень навыка» — как «Новое достижение»; хранитель списка в деревне радуется. */
export function SkillToast() {
  const p = getPrefs();
  const timer = useRef(null);
  const [notice, setNotice] = useState(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const skills = useMemo(() => skillsNow(), [store.version]);
  useEffect(() => {
    const seen = readLocal('skillsSeen', null);
    const now = {};
    const up = [];
    for (const [id, s] of skills) {
      const v = s.prestige * 1000 + s.level;
      now[id] = v;
      const l = store.data.lists.get(id);
      if (seen && seen[id] != null && v > seen[id] && l && !l.archived) up.push({ l, s, prestige: Math.floor(seen[id] / 1000) < s.prestige });
    }
    writeLocal('skillsSeen', now);
    if (!up.length || !gameOn()) return;
    for (const u of up) emitVillage('levelup', { listId: u.l.id, prestige: u.prestige });
    if (p.achievementNotifications === false) return;
    setNotice(up.map((u) => (u.prestige ? `«${u.l.name}» — престиж ${u.s.roman}` : `«${u.l.name}» — уровень ${u.s.level}${u.s.level >= MAX_LEVEL ? ' (можно повысить престиж!)' : ''}`)).join(' · '));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 7000);
  }, [skills]);
  if (!notice || !gameOn()) return null;
  return html`<aside class="achievement-toast skill-toast" role="status">
    <span>⬆️</span><div><b>Навык вырос</b><p>${notice}</p></div>
    <button class="icon-btn" aria-label="Закрыть" onClick=${() => setNotice(null)}>×</button>
  </aside>`;
}
