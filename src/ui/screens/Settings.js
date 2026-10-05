// Настройки (docs/TZ.md §6.10) и меню «Ещё».

import { html, useMemo, useState, useEffect } from '../html.js';
import { Icon } from '../icons.js';
import { Link, navigate } from '../router.js';
import { store, ask, showSnackbar, setUi } from '../../store/appState.js';
import { getRepo } from '../../store/localRepo.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';
import { allTimeZones, deviceTimeZone, formatMoment } from '../../core/dates.js';
import { countLabel } from '../../core/plural.js';
import { APP_VERSION, SCHEMA_VERSION } from '../../version.js';
import { checkForUpdate } from '../../pwa/swClient.js';
import { getTheme, setTheme } from '../theme.js';
import { PrioritiesSection } from '../components/PrioritiesEditor.js';
import { AppearanceSection } from '../components/Appearance.js';
import { NotificationsSection } from '../components/Reminders.js';
import { DataSection, LimitsSection } from '../components/DataSettings.js';
import { GameSettingsSection } from './Shop.js';
import { useMedia } from '../hooks.js';
import { tokenValid, startLogin, logout, expireToken } from '../../google/auth.js';
import { push, pull, revisionSpike } from '../../sync/syncEngine.js';

export function MoreScreen() {
  const trash = S.trashView(store.data).length;
  return html`
    <div class="screen">
      <nav class="menu-list">
        <${Link} to="/analytics" className="menu-item"><span class="mi-icon"><${Icon} name="chart"/></span><span class="mi-label">Аналитика</span><//>
        <${Link} to="/village" className="menu-item"><span class="mi-icon"><${Icon} name="village"/></span><span class="mi-label">Деревня</span><//>
        <${Link} to="/shop" className="menu-item"><span class="mi-icon"><${Icon} name="shop"/></span><span class="mi-label">Магазин</span><//>
        <${Link} to="/archive" className="menu-item"><span class="mi-icon"><${Icon} name="archive"/></span><span class="mi-label">Архив</span><//>
        <${Link} to="/trash" className="menu-item"><span class="mi-icon"><${Icon} name="trash"/></span>
          <span class="mi-label">Корзина</span><span class="mi-count">${trash || ''}</span><//>
        <${Link} to="/settings" className="menu-item"><span class="mi-icon"><${Icon} name="settings"/></span><span class="mi-label">Настройки</span><//>
        <${Link} to="/journal" className="menu-item"><span class="mi-icon"><${Icon} name="list"/></span><span class="mi-label">Журнал конфликтов и ошибок</span><//>
      </nav>
      <p class="muted small">Поиск, «Неделя» и «Просроченные» появятся на следующих этапах.</p>
    </div>`;
}

function Row({ label, hint, children }) {
  return html`<div class="set-row"><div class="set-label">${label}${hint ? html`<small>${hint}</small>` : null}</div>
    <div class="set-control">${children}</div></div>`;
}

const PLATFORM = {
  'android-chrome': 'Android, Chrome', 'windows-chrome': 'Windows, Chrome', 'windows-edge': 'Windows, Edge',
  'ios-safari': 'iPhone, Safari', bot: 'Telegram-бот', other: 'Другое',
};

function AccountSection() {
  const valid = tokenValid();
  const email = store.auth?.email;
  const offline = store.sync.offline;
  const doLogout = async () => {
    const n = store.ui.dirtyCount;
    const buttons = [{ label: 'Отмена', value: null }, { label: 'Выйти', value: 'logout', kind: 'primary' }];
    if (!n) buttons.push({ label: 'Выйти и удалить данные с устройства', value: 'wipe', kind: 'danger' });
    const v = await ask({
      title: 'Выйти из Google?',
      text: n
        ? `Локальные данные останутся на устройстве. Есть ${countLabel(n, ['непушнутое изменение', 'непушнутых изменения', 'непушнутых изменений'])} — удалить данные с устройства можно только после пуша.`
        : 'Локальные данные останутся на устройстве, если не выбрать удаление. На Диске всё сохранится.',
      buttons,
    });
    if (!v) return;
    await logout();
    if (v === 'wipe') A.clearLocalData();
    else {
      setUi({});
      showSnackbar('Выход выполнен');
    }
  };
  return html`
    <section class="set-section">
      <h2>Аккаунт Google</h2>
      ${email || valid ? html`
        <${Row} label=${email || 'Вход выполнен'} hint=${valid ? 'Доступ к Диску есть' : 'Сессия истекла — войдёт заново при пуше'}>
          ${valid
            ? html`<button class="btn small" onClick=${doLogout}><${Icon} name="logout" size=${16}/> Выйти</button>`
            : html`<button class="btn small primary" onClick=${() => startLogin({ action: 'pull' })} disabled=${offline}>Войти</button>`}
        <//>` : html`
        <${Row} label="Вход не выполнен" hint="Без входа задачи хранятся только в этом браузере">
          <button class="btn small primary" onClick=${() => startLogin({ action: 'pull' })} disabled=${offline}>Войти через Google</button>
        <//>`}
      ${store.sync.layout?.rootId ? html`
        <${Row} label="Папка на Диске">
          <a href=${`https://drive.google.com/drive/folders/${store.sync.layout.rootId}`} target="_blank" rel="noopener noreferrer">Открыть LifeTasks</a>
        <//>` : null}
    </section>`;
}

function SyncSection() {
  const tz = store.data.settings.timeZone;
  const when = (iso) => (iso ? formatMoment(iso, tz) : 'ещё не было');
  const me = store.data.devices.get(store.deviceId);
  const [name, setName] = useState(me?.name || '');
  const devices = [...store.data.devices.values()].filter((d) => !d.deletedAt)
    .sort((a, b) => (b.lastPushAt || '').localeCompare(a.lastPushAt || ''));
  const saveName = () => {
    if (name.trim() && name.trim() !== me?.name) A.renameDevice(name);
  };
  const busy = !!store.sync.phase;
  const [removing, setRemoving] = useState(false);
  const canRemove = tokenValid() && !busy && !removing && !store.ui.readOnly && !store.sync.offline;
  const remove = async (ids) => {
    setRemoving(true);
    try { if (await A.removeDevices(ids)) await push(); }
    finally { setRemoving(false); }
  };
  return html`
    <section class="set-section">
      <h2>Синхронизация</h2>
      <${Row} label="Имя устройства" hint="Видно в «Изменена на …» и в списке устройств">
        <input value=${name} maxLength="40" onInput=${(e) => setName(e.target.value)} onBlur=${saveName}
          onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} disabled=${!!store.ui.readOnly}/>
      <//>
      <${Row} label="Непушнутых изменений">${store.ui.dirtyCount}<//>
      <${Row} label="Последний пуш">${when(store.sync.lastPushAt)}<//>
      <${Row} label="Последнее обновление с Диска">${when(store.sync.lastPullAt)}<//>
      <div class="form-actions">
        <button class="btn primary" onClick=${() => push()} disabled=${busy || !!store.ui.readOnly}><${Icon} name="upload" size=${18}/> Пуш</button>
        <button class="btn" onClick=${() => pull()} disabled=${busy}><${Icon} name="download" size=${18}/> Обновить</button>
        <button class="btn" onClick=${() => navigate('/journal')}>Журнал конфликтов и ошибок</button>
      </div>
      <h3 class="set-sub">Устройства</h3>
      <p class="muted small">Удаление завершает сессию LifeTasks при следующей синхронизации устройства. Старые версии могут не поддерживать выход; доступ к аккаунту Google сохраняется.</p>
      <button class="btn" disabled=${!canRemove || devices.length < 2}
        onClick=${() => remove(devices.map(d => d.id))}>Очистить все сессии, кроме текущей</button>
      ${devices.map((d) => html`
        <${Row} key=${d.id} label=${d.name + (d.id === store.deviceId ? ' (это устройство)' : '')}
          hint=${`${PLATFORM[d.platform] || d.platform}, версия ${d.appVersion}`}>
          <span class="muted small">${d.lastPushAt ? 'пуш ' + when(d.lastPushAt) : 'пушей не было'}</span>
          ${d.id !== store.deviceId ? html`<button class="icon-btn" aria-label=${'Удалить устройство ' + d.name} title="Удалить устройство"
            disabled=${!canRemove} onClick=${() => remove([d.id])}><${Icon} name="trash" size=${18}/></button>` : null}
        <//>`)}
    </section>`;
}

function DebugSection() {
  const [fake, setFake] = useState(false);
  const repo = getRepo();
  useEffect(() => {
    repo.getMeta('debug.fakeNewerSchema').then((v) => setFake(!!v));
  }, []);
  const toggleFake = async () => {
    await repo.setMeta('debug.fakeNewerSchema', !fake);
    await repo.setMeta('sync.lastRevisionId', null); // чтобы следующий забор точно скачал базу
    store.sync.lastRevisionId = null;
    setFake(!fake);
    if (fake) setUi({ readOnly: null, readOnlySource: null });
    showSnackbar(!fake ? 'Теперь база с Диска считается форматом v' + (SCHEMA_VERSION + 1) + '. Нажми «Обновить»' : 'Режим выключен. Нажми «Обновить»');
  };
  const spike = async () => {
    showSnackbar('Проверяю ревизии… (около 5 секунд)');
    try {
      const r = await revisionSpike();
      await ask({
        title: r.ok ? 'Ревизии: всё в порядке ✓' : 'Ревизии: проверка НЕ прошла',
        text: `Ревизий у тестового файла: ${r.count} (ожидалось 4). Разные id: ${r.distinct ? 'да' : 'нет'}; все в списке: ${r.allListed ? 'да' : 'нет'}; `
          + `по порядку: ${r.ordered ? 'да' : 'нет'}. ${r.ok ? 'Защита от одновременной записи работает как задумано.' : 'Сообщи разработчику — нужен запасной механизм (lock.json).'}`,
        buttons: [{ label: 'OK', value: true, kind: 'primary' }],
      });
    } catch (e) {
      showSnackbar('Проверка не удалась: ' + (e.message || e));
    }
  };
  return html`
    <section class="set-section">
      <h2>Отладка</h2>
      <p class="muted small">Видно только по адресу #/settings?debug=1.</p>
      <div class="form-actions wrap-col">
        <button class="btn" onClick=${async () => { await expireToken(); setUi({}); showSnackbar('Токен испорчен. Нажми «Пуш» — будет повторный вход'); }}>Испортить токен</button>
        <button class="btn" onClick=${toggleFake}>${fake ? 'Выключить: база на Диске «новее»' : 'Притвориться, что база на Диске новее'}</button>
        <button class="btn" onClick=${spike} disabled=${!tokenValid()}>Проверить ревизии Диска</button>
      </div>
    </section>`;
}

export function SettingsScreen({ query = {} }) {
  const s = store.data.settings;
  const readOnly = !!store.ui.readOnly;
  const lists = S.sortedLists(store.data);
  const zones = useMemo(() => {
    const z = allTimeZones();
    return z.includes(s.timeZone) ? z : [s.timeZone, ...z];
  }, [s.timeZone]);
  const [theme, setThemeState] = useState(getTheme());
  const phone = !useMedia('(min-width: 900px)');
  const deviceTz = deviceTimeZone();

  const changeTheme = (v) => {
    setTheme(v);
    setThemeState(v);
  };

  const clearLocal = async () => {
    const n = store.ui.dirtyCount;
    const v = await ask({
      title: 'Очистить локальные данные?',
      text: n
        ? `Есть ${countLabel(n, ['непушнутое изменение', 'непушнутых изменения', 'непушнутых изменений'])}. Они пропадут. Сначала сделай пуш.`
        : 'Данные на этом устройстве будут удалены. На Google Диске всё останется — приложение заберёт данные заново после входа.',
      buttons: n
        ? [{ label: 'Отмена', value: null }, { label: 'Сделать пуш', value: 'push', kind: 'primary' }, { label: 'Удалить всё равно', value: 'yes', kind: 'danger' }]
        : [{ label: 'Отмена', value: null }, { label: 'Удалить', value: 'yes', kind: 'danger' }],
    });
    if (v === 'push') push();
    if (v === 'yes') A.clearLocalData();
  };

  const checkUpdate = async () => {
    const r = await checkForUpdate();
    if (r === 'none') showSnackbar('Установлена последняя версия');
    else if (r === 'unsupported') showSnackbar('Service Worker недоступен в этом браузере');
    else if (r === 'error') showSnackbar('Не удалось проверить обновление (нет сети?)');
  };

  return html`
    <div class="screen settings">
      <${AccountSection}/>
      <${SyncSection}/>

      <${NotificationsSection} focus=${query.section === 'notifications'}/>

      <${GameSettingsSection}/>

      <${DataSection}/>

      <${LimitsSection}/>

      <${PrioritiesSection} focus=${query.section === 'priorities'}/>

      <section class="set-section">
        <h2>Задачи</h2>
        <${Row} label="Блок «Быт» на «Сегодня»" hint="Задачи этого списка не конкурируют с главными">
          <select value=${s.choresListId || ''} disabled=${readOnly}
            onChange=${(e) => A.updateSettings({ choresListId: e.target.value || null })}>
            <option value="">Нет</option>
            ${lists.map((l) => html`<option value=${l.id}>${(l.emoji ? l.emoji + ' ' : '') + l.name}</option>`)}
          </select>
        <//>
        <${Row} label="Часовой пояс" hint=${s.timeZone !== deviceTz ? `На устройстве: ${deviceTz}` : 'Как на устройстве'}>
          <select value=${s.timeZone} disabled=${readOnly} onChange=${(e) => A.updateSettings({ timeZone: e.target.value })}>
            ${zones.map((z) => html`<option value=${z}>${z}</option>`)}
          </select>
        <//>
        <${Row} label="Корзина очищается через">
          <select value=${String(s.trashRetentionDays)} disabled=${readOnly}
            onChange=${(e) => A.updateSettings({ trashRetentionDays: +e.target.value })}>
            ${[7, 14, 30, 60, 90, 180, 365].map((d) => html`<option value=${String(d)}>${d} дн.</option>`)}
          </select>
        <//>
      </section>

      <${AppearanceSection} theme=${theme} onTheme=${changeTheme} phone=${phone}/>


      <section class="set-section">
        <h2>О приложении</h2>
        <${Row} label="Версия приложения">${APP_VERSION}<//>
        <${Row} label="Формат данных">v${SCHEMA_VERSION}<//>
        <button class="btn" onClick=${checkUpdate}>Проверить обновление</button>
      </section>

      ${query.debug === '1' ? html`<${DebugSection}/>` : null}

      <section class="set-section danger-zone">
        <h2>Опасная зона</h2>
        <p class="muted">Удаляет базу IndexedDB, кэш приложения и локальные настройки этого браузера. Данные на Google Диске не трогаются.</p>
        <button class="btn danger-outline" onClick=${clearLocal}>Очистить локальные данные</button>
      </section>
    </div>`;
}
