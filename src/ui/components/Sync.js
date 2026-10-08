// Индикатор синхронизации, кнопка «Пуш», панель синхронизации, стартовый экран и экран перехода к Google.

import { html, useEffect, useState } from '../html.js';
import { Icon } from '../icons.js';
import { Sheet } from './Sheet.js';
import { navigate } from '../router.js';
import { store, openSheet, closeSheet, setUi, totalDirty } from '../../store/appState.js';
import { getRepo, getFeastRepo } from '../../store/localRepo.js';
import { indicator } from '../../sync/status.js';
import { push, pull } from '../../sync/syncEngine.js';
import { tokenValid, startLogin } from '../../google/auth.js';
import { formatMoment } from '../../core/dates.js';
import { entryTitle } from '../../core/feast.js';

export function syncState() {
  return {
    readOnly: !!store.ui.readOnly,
    phase: store.sync.phase,
    step: store.sync.step,
    lastError: store.sync.lastError,
    needAuth: !tokenValid(),
    offline: store.sync.offline,
    remoteNewer: store.sync.remoteNewer,
    dirty: totalDirty(),
  };
}

export function SyncIndicator() {
  const ind = indicator(syncState());
  return html`
    <button class=${'sync-indicator tone-' + ind.tone} onClick=${() => openSheet('sync')} title=${ind.text} aria-label=${'Синхронизация: ' + ind.text}>
      <${Icon} name=${ind.icon} size=${16} className=${ind.key === 'busy' ? 'spin' : ''}/>
      <span class="sync-long">${ind.text}</span><span class="sync-short">${ind.short}</span>
    </button>`;
}

export function PushButton() {
  const n = totalDirty();
  const busy = !!store.sync.phase;
  return html`
    <button class="push-btn" onClick=${() => push()} disabled=${busy || !!store.ui.readOnly} title="Пуш — отправить изменения на Google Диск">
      <${Icon} name="upload" size=${16}/><span>Пуш</span>${n ? html`<span class="push-badge">${n}</span>` : null}
    </button>`;
}

const when = (iso) => (iso ? formatMoment(iso, store.data.settings.timeZone) : 'ещё не было');

/** Непушнутое в Feast (0.11). */
function feastName(key) {
  const [coll, id] = key.split('/');
  const d = store.feast;
  if (coll === 'settings') return 'Crimson Harvest: цели и «Обо мне»';
  if (coll === 'foods') {
    const f = d.foods.get(id);
    return f ? (f.deletedAt ? 'Crimson Harvest: удалённый продукт' : `Crimson Harvest: продукт «${f.name}»`) : 'Crimson Harvest: продукт';
  }
  if (coll === 'entries') {
    const e = d.entries.get(id);
    return e ? (e.deletedAt ? 'Crimson Harvest: удалённая запись' : `Crimson Harvest: ${entryTitle(e)}, ${e.date}`) : 'Crimson Harvest: запись';
  }
  if (coll === 'meals') {
    const m = d.meals.get(id);
    return m ? (m.deletedAt ? 'Crimson Harvest: удалённый рацион' : `Crimson Harvest: рацион «${m.name}»`) : 'Crimson Harvest: рацион';
  }
  if (coll === 'mealNotes') return 'Crimson Harvest: заметка к рациону';
  if (coll === 'body') return 'Crimson Harvest: замер';
  if (coll === 'dayArchive') return 'Crimson Harvest: итоги дня';
  return 'Crimson Harvest: ' + key;
}

function entityName(key) {
  const [coll, id] = key.split('/');
  const d = store.data;
  if (coll === 'settings') return 'Настройки';
  if (coll === 'tasks') {
    const t = d.tasks.get(id);
    return t ? (t.deletedAt ? 'Удалённая задача' : t.title) : 'Задача';
  }
  if (coll === 'lists') {
    const l = d.lists.get(id);
    return l ? (l.deletedAt ? 'Удалённый список' : `Список «${l.name}»`) : 'Список';
  }
  if (coll === 'devices') return `Устройство «${d.devices.get(id)?.name || '?'}»`;
  return key;
}

export function SyncPanel() {
  const s = syncState();
  const ind = indicator(s);
  const [names, setNames] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    Promise.all([getRepo().dirtyKeys(), getFeastRepo()?.dirtyKeys() || []])
      .then(([keys, fk]) => setNames([...keys.slice(0, 50).map(entityName), ...fk.slice(0, 50).map(feastName)]));
  }, [store.ui.dirtyCount, store.ui.feastDirty]);
  const email = store.auth?.email;
  return html`
    <${Sheet} title="Синхронизация" onClose=${closeSheet}>
      <div class=${'sync-status tone-' + ind.tone}>
        <${Icon} name=${ind.icon} size=${20} className=${ind.key === 'busy' ? 'spin' : ''}/>
        <div>
          <div class="sync-status-text">${ind.text}</div>
          ${s.phase && s.step ? html`<div class="muted small">${s.step}…</div>` : null}
        </div>
      </div>
      ${s.lastError ? html`<p class="hint warn">${s.lastError.text}<br/><small>${when(s.lastError.at)}</small></p>` : null}
      ${s.needAuth && store.sync.authError ? html`<p class="hint warn">${store.sync.authError.text}</p>` : null}
      <div class="set-row"><div class="set-label">Google</div>
        <div class="set-control">${tokenValid() ? email || 'вход выполнен' : html`
          <button class="btn small primary" onClick=${() => startLogin({ action: 'pull' })} disabled=${s.offline}>Войти</button>`}</div></div>
      <div class="set-row"><div class="set-label">Непушнутых изменений</div>
        <div class="set-control">${s.dirty
          ? html`<button class="link-btn" onClick=${() => setOpen(!open)}>${s.dirty} ${open ? '▲' : '▼'}</button>` : '0'}</div></div>
      ${open && names.length ? html`<ul class="dirty-list">${names.map((n) => html`<li>${n}</li>`)}</ul>` : null}
      <div class="set-row"><div class="set-label">Последний пуш</div><div class="set-control">${when(store.sync.lastPushAt)}</div></div>
      <div class="set-row"><div class="set-label">Последнее обновление</div><div class="set-control">${when(store.sync.lastPullAt)}</div></div>
      <div class="form-actions">
        <button class="btn primary" onClick=${() => push()} disabled=${!!s.phase || s.readOnly}><${Icon} name="upload" size=${18}/> Пуш</button>
        <button class="btn" onClick=${() => pull()} disabled=${!!s.phase}><${Icon} name="download" size=${18}/> Обновить</button>
      </div>
      <button class="link-btn" onClick=${() => { closeSheet(); navigate('/settings?section=sync'); }}>Настройки синхронизации</button>
    <//>`;
}

/** Стартовый экран (docs/TZ.md §6.1): показывается, пока ни разу не входили и не выбрали «Пока без входа». */
export function StartScreen() {
  if (!store.ui.start) return null;
  const offline = store.sync.offline;
  const later = async () => {
    await getRepo().setMeta('start.dismissed', true);
    setUi({ start: false });
  };
  return html`
    <div class="start-screen" role="dialog" aria-modal="true" aria-label="Вход">
      <div class="start-card">
        <img src="icons/icon-192.png" alt="" width="72" height="72"/>
        <h1>Kingdom</h1>
        <p>Chronicle — задачи, Crimson Harvest — еда и калории. Данные хранятся у тебя на Google Диске — в папке Kingdom (внутри — Chronicle и Crimson Harvest).</p>
        ${offline
          ? html`<p class="hint warn">Для входа нужен интернет. Можно начать без входа — данные сохранятся на устройстве и отправятся на Диск после входа.</p>`
          : null}
        ${store.sync.authError ? html`<p class="hint warn">${store.sync.authError.text}</p>` : null}
        <button class="btn primary wide big" onClick=${() => startLogin({ action: 'pull' })} disabled=${offline}>Войти через Google</button>
        <p class="small muted">Google может предупредить, что приложение не проверено, — это нормально, приложение твоё: нажми «Продолжить».
          На экране доступа оставь галочку про Google Диск.</p>
        <button class="link-btn" onClick=${later}>Пока без входа</button>
      </div>
    </div>`;
}

export function RedirectingScreen() {
  if (!store.ui.redirecting) return null;
  return html`<div class="start-screen"><div class="start-card"><${Icon} name="sync" size=${36} className="spin"/><p>Вход в Google…</p></div></div>`;
}
