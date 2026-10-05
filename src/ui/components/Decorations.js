// Всплывающее «Новое достижение» и переключатель анимации оформления.
// Питомцы, миры и предметы 0.6 с версии 0.7 живут в деревне (ui/components/VillageView.js).

import { html, useEffect, useMemo, useRef, useState } from '../html.js';
import { store } from '../../store/appState.js';
import { gameStats } from '../../core/game.js';
import { getPrefs, setPrefs } from '../prefs.js';
import { readLocal, writeLocal } from '../hooks.js';

export function AchievementToast() {
  const p = getPrefs();
  const timer = useRef(null);
  const [notice, setNotice] = useState(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const stats = useMemo(() => gameStats(store.data, store.data.settings.timeZone, store.now.today), [store.version, store.now.today]);
  useEffect(() => {
    const unlocked = stats.achievements.filter((a) => a.unlocked);
    const seen = readLocal('achievementsSeen', null);
    const fresh = seen ? unlocked.filter((a) => !seen.includes(a.id)) : [];
    writeLocal('achievementsSeen', [...new Set([...(seen || []), ...unlocked.map((a) => a.id)])]);
    if (store.data.settings.gameEnabled && p.achievementNotifications !== false && fresh.length) {
      setNotice(fresh.map((a) => a.name).join(' · '));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setNotice(null), 8000);
    }
  }, [store.version, store.now.today, p.achievementNotifications]);
  if (!notice || p.achievementNotifications === false || !store.data.settings.gameEnabled) return null;
  return html`<aside class="achievement-toast" role="status">
    <span>🏆</span><div><b>Новое достижение</b><p>${notice}</p></div>
    <button class="icon-btn" aria-label="Закрыть достижение" onClick=${() => setNotice(null)}>×</button>
  </aside>`;
}

export function DecorationSettings() {
  const p = getPrefs();
  return html`<label class="toggle-row compact"><input type="checkbox" checked=${p.decorMotion !== false} onChange=${(e) => setPrefs({ decorMotion: e.target.checked })}/><span>Анимация деревни <small>Жители двигаются; учитывает системное уменьшение движения</small></span></label>`;
}
