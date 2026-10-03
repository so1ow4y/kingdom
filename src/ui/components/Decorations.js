import { html, useEffect, useRef, useMemo, useState } from '../html.js';
import { store } from '../../store/appState.js';
import { COSMETICS, cosmeticAvailable, gameStats } from '../../core/game.js';
import { getPrefs, setPrefs } from '../prefs.js';
import { readLocal, writeLocal, useMedia } from '../hooks.js';

// Vector characters are shared by the shop previews and the background stage.
export function PetArt({ type }) {
  if (type === 'spider') return html`<svg viewBox="0 0 120 110" class="pet-art"><path d="M60 0v42" stroke="#b9b1da"/>
    <g class="pet-breathe" stroke="#756591" stroke-width="5" fill="none" stroke-linecap="round">
      <path d="M47 57L24 37 15 47M43 64L18 58 8 72M44 73L23 82 18 99M73 57L96 37 105 47M77 64L102 58 112 72M76 73L97 82 102 99"/>
    </g><ellipse cx="60" cy="65" rx="23" ry="26" fill="#83709f"/><circle cx="51" cy="60" r="7" fill="white"/><circle cx="69" cy="60" r="7" fill="white"/>
    <g class="pet-eyes" fill="#262538"><circle cx="52" cy="61" r="3"/><circle cx="70" cy="61" r="3"/></g><path d="M54 77q6 7 12 0" fill="none" stroke="#30253e" stroke-width="3"/></svg>`;
  if (type === 'neko') return html`<svg viewBox="0 0 120 130" class="pet-art">
    <path d="M22 68Q13 13 60 19Q107 13 98 78L87 110H30Z" fill="#beb0f0"/>
    <path class="pet-ears" d="M26 30L22 2 48 22M73 22L100 2 96 35" fill="#b8a1ee" stroke="#655587" stroke-width="3"/>
    <path d="M36 88Q60 75 83 88L94 123H24Z" fill="#6b73b8"/><path d="M48 87L60 101 73 87" fill="white"/>
    <ellipse cx="60" cy="55" rx="30" ry="32" fill="#ffdfcc"/><path d="M28 43Q31 13 63 22Q88 17 94 49L66 33 51 46 48 33Z" fill="#b8a1ee"/>
    <g class="pet-eyes" fill="#595174"><ellipse cx="48" cy="57" rx="3" ry="5"/><ellipse cx="73" cy="57" rx="3" ry="5"/></g>
    <path d="M55 71q6 6 12 0" fill="none" stroke="#a76580" stroke-width="2"/><g class="pet-wave"><path d="M85 98L101 76" stroke="#ffdfcc" stroke-width="11" stroke-linecap="round"/><circle cx="103" cy="71" r="8" fill="#ffdfcc"/></g>
    <path d="M40 124h17M67 124h17" stroke="#4e4469" stroke-width="8" stroke-linecap="round"/></svg>`;
  const fox = type === 'fox';
  const fur = fox ? '#eb9554' : type === 'kitten' ? '#9aa5c9' : '#d0af88';
  return html`<svg viewBox="0 0 140 110" class="pet-art">
    <path class="pet-tail" d="M90 80Q133 91 125 46Q106 52 99 64" fill=${fur} stroke=${fur} stroke-width="10" stroke-linecap="round"/>
    ${fox ? html`<path d="M124 43L129 61 113 56Z" fill="#ffedda"/>` : null}
    <ellipse class="pet-breathe" cx="70" cy="80" rx="34" ry="23" fill=${fur}/>
    <path class="pet-ears" d="M30 43L27 10 54 27M66 26L88 9 87 46" fill=${fur} stroke=${fur} stroke-width="5"/>
    <path d="M32 32L32 20 44 30M74 30L84 19 81 36" fill="#eaa6a0"/>
    <path d="M27 43Q25 19 60 25Q96 23 92 49L62 76Z" fill=${fur}/>
    <path d="M29 49L59 56 91 49Q80 78 60 77Q38 72 29 49" fill="#fff0dc"/>
    <g class="pet-eyes" fill="#343144"><ellipse cx="44" cy="46" rx="3" ry="4"/><ellipse cx="76" cy="46" rx="3" ry="4"/></g>
    <path d="M56 58h8l-4 5Z" fill="#514052"/><path d="M60 64q-6 8-12 1m12-1q6 8 12 1" fill="none" stroke="#514052" stroke-width="2"/>
    <path d="M46 99h15m15 0h14" stroke=${fur} stroke-width="9" stroke-linecap="round"/></svg>`;
}

export function SceneArt({ type }) {
  if (type === 'web') return html`<div class="scene-web">${[0, 1, 2, 3].map(i => html`<svg key=${i} class=${'web-corner corner-' + i} viewBox="0 0 220 220">
    <g fill="none" stroke="currentColor" stroke-width="1.3"><path d="M0 0L220 0M0 0L210 70M0 0L170 145M0 0L95 205M0 0L0 220"/>
      ${[45, 90, 140, 195].map(r => html`<path d=${`M${r} 0Q${r*.75} ${r*.12} ${r*.94} ${r*.32}Q${r*.64} ${r*.4} ${r*.76} ${r*.65}Q${r*.47} ${r*.65} ${r*.43} ${r*.92}Q${r*.17} ${r*.8} 0 ${r}`}/>`)}</g></svg>`)}</div>`;
  if (type === 'forest') return html`<div class="scene-forest"><div class="forest-moon"></div>${Array.from({length: 14}, (_, i) => html`<i class="pixel-tree" style=${{left: `${i*8-4}%`, height: `${85+(i*37)%120}px`, opacity: .3+(i%3)*.12}}/>`)}<div class="fireflies"></div></div>`;
  return html`<div class="scene-stars"><i></i><i></i><i></i><div class="orbit"></div></div>`;
}

export function CosmeticPreview({ item }) {
  return html`<div class=${'decor-preview preview-' + item.kind} aria-hidden="true">
    ${item.kind === 'pet' ? html`<${PetArt} type=${item.value}/>` : item.kind === 'scene' ? html`<${SceneArt} type=${item.value}/>` : html`<span class=${'prop-art prop-' + item.value}>${item.emoji}</span>`}
  </div>`;
}

export function Decorations() {
  const p = getPrefs();
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)');
  const root = useRef(null);
  const previousDone = useRef(null);
  const noticeTimer = useRef(null);
  const [notice, setNotice] = useState(null);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  const stats = useMemo(() => gameStats(store.data, store.data.settings.timeZone, store.now.today), [store.version, store.now.today]);
  const items = COSMETICS.filter(c => cosmeticAvailable(store.data, c.id));
  const scene = items.find(c => c.kind === 'scene' && c.value === p.scene);
  const pet = items.find(c => c.kind === 'pet' && c.value === p.pet);
  const props = items.filter(c => c.kind === 'prop' && (p.props || []).includes(c.value));
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (p.decorMotion === false || reducedMotion) { el.style.removeProperty('--look'); return; }
    const move = e => el.style.setProperty('--look', e.clientX > innerWidth/2 ? '2px' : '-2px');
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, [p.decorMotion, reducedMotion]);
  useEffect(() => {
    if (previousDone.current !== null && stats.done > previousDone.current && root.current) {
      root.current.classList.remove('celebrate');
      void root.current.offsetWidth;
      root.current.classList.add('celebrate');
    }
    previousDone.current = stats.done;
  }, [stats.done]);
  useEffect(() => {
    const unlocked = stats.achievements.filter(a => a.unlocked);
    const seen = readLocal('achievementsSeen', null);
    const fresh = seen ? unlocked.filter(a => !seen.includes(a.id)) : [];
    writeLocal('achievementsSeen', [...new Set([...(seen || []), ...unlocked.map(a => a.id)])]);
    if (store.data.settings.gameEnabled && p.achievementNotifications !== false && fresh.length) {
      setNotice(fresh.map(a => a.name).join(' · '));
      clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), 8000);
    }
  }, [store.version, store.now.today, p.achievementNotifications]);
  return html`<div ref=${root} class=${'decoration-stage' + (p.decorMotion === false || reducedMotion ? ' still' : '')} aria-hidden="true">
    ${scene ? html`<${SceneArt} type=${scene.value}/>` : null}
    ${pet ? html`<div class=${'stage-pet ' + pet.motion + ' pet-' + pet.value}><div class="pet-celebration"><${PetArt} type=${pet.value}/><span class="pet-heart">♥</span></div></div>` : null}
    ${props.map((c, i) => html`<span key=${c.id} class=${'stage-prop prop-art prop-' + c.value} style=${{'--slot': i}}>${c.emoji}</span>`)}
  </div>
  ${notice && p.achievementNotifications !== false && store.data.settings.gameEnabled ? html`<aside class="achievement-toast" role="status">
    <span>🏆</span><div><b>Новое достижение</b><p>${notice}</p></div><button class="icon-btn" aria-label="Закрыть достижение" onClick=${() => setNotice(null)}>×</button>
  </aside>` : null}`;
}

export function DecorationSettings() {
  const p = getPrefs();
  return html`<label class="toggle-row compact"><input type="checkbox" checked=${p.decorMotion !== false} onChange=${e => setPrefs({ decorMotion: e.target.checked })}/><span>Анимация оформления <small>Учитывает системное уменьшение движения</small></span></label>`;
}
