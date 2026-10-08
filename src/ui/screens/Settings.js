// Настройки (docs/TZ.md §6.10) и меню «Ещё». С 0.10 — как окно настроек license-store (routes/_app/settings.tsx,
// features/settings/settings-nav.tsx): дерево разделов слева (сверху на телефоне) с поиском по названиям и
// ключевым словам, группы раскрываются и запоминают это; раздел — справа, у каждого свой адрес ?section=…

import { html, useMemo, useState, useEffect, useRef } from '../html.js';
import { Icon } from '../icons.js';
import { Link, navigate } from '../router.js';
import { store, ask, showSnackbar, setUi, totalDirty } from '../../store/appState.js';
import { getRepo } from '../../store/localRepo.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';
import { allTimeZones, deviceTimeZone, formatMoment } from '../../core/dates.js';
import { countLabel } from '../../core/plural.js';
import { APP_VERSION, SCHEMA_VERSION } from '../../version.js';
import { checkForUpdate } from '../../pwa/swClient.js';
import { PrioritiesSection } from '../components/PrioritiesEditor.js';
import { AppearanceSection } from '../components/Appearance.js';
import { NotificationsSection } from '../components/Reminders.js';
import { DataSection, LimitsSection } from '../components/DataSettings.js';
import { ShortcutsSection } from '../components/Shortcuts.js';
import { FeastGoalsSection, FeastDataSection, FeastRewardsSection } from '../components/FeastSettings.js';
import { MealsSection } from '../components/Meals.js';
import { activeApp } from '../prefs.js';
import { APPS, otherApp, switchApp } from '../apps.js';
import { GameSettingsSection } from './Shop.js';
import { VillageSettings } from './Village.js';
import { useMedia, readLocal, writeLocal } from '../hooks.js';
import { tokenValid, startLogin, expireToken } from '../../google/auth.js';
import { push, pull, revisionSpike } from '../../sync/syncEngine.js';
import { confirmLogout } from '../account.js';
import { buildMenu } from '../nav.js';

/** «Ещё» (#/more): всё меню дока одним списком — для старых ссылок и узких экранов. */
export function MoreScreen() {
  const app = activeApp();
  const groups = buildMenu(S.activeCounts(store.data), app);
  return html`
    <div class="screen">
      ${groups.map((g) => html`
        <section class="more-group" key=${g.title}>
          <h2 class="more-title">${g.title}</h2>
          <nav class="menu-list">
            ${g.items.flatMap((it) => (it.items ? it.items.map((sub) => ({ ...sub, title: sub.title === 'Все списки' ? 'Списки' : sub.title, icon: sub.icon || it.icon })) : [it]))
              .filter((it) => !it.color)
              .map((it) => html`
                <${Link} key=${it.to} to=${it.to} className="menu-item">
                  <span class="mi-icon"><${Icon} name=${it.icon}/></span><span class="mi-label">${it.title}</span>
                  ${it.count ? html`<span class="mi-count">${it.count}</span>` : null}
                <//>`)}
          </nav>
        </section>`)}
      <nav class="menu-list">
        <button type="button" class="menu-item" onClick=${() => switchApp()}><span class="mi-icon"><${Icon} name="swap"/></span>
          <span class="mi-label">Перейти в ${APPS[otherApp(app)].name} — ${APPS[otherApp(app)].what}</span></button>
        <${Link} to="/journal" className="menu-item"><span class="mi-icon"><${Icon} name="list"/></span><span class="mi-label">Журнал конфликтов и ошибок</span><//>
      </nav>
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
  return html`
    <section class="set-section">
      <h2>Аккаунт Google</h2>
      ${email || valid ? html`
        <${Row} label=${email || 'Вход выполнен'} hint=${valid ? 'Доступ к Диску есть' : 'Сессия истекла — войдёт заново при пуше'}>
          ${valid
            ? html`<button class="btn small" onClick=${confirmLogout}><${Icon} name="logout" size=${16}/> Выйти</button>`
            : html`<button class="btn small primary" onClick=${() => startLogin({ action: 'pull' })} disabled=${offline}>Войти</button>`}
        <//>` : html`
        <${Row} label="Вход не выполнен" hint="Без входа задачи хранятся только в этом браузере">
          <button class="btn small primary" onClick=${() => startLogin({ action: 'pull' })} disabled=${offline}>Войти через Google</button>
        <//>`}
      ${store.sync.kingdomId ? html`
        <${Row} label="Общая папка Kingdom" hint="Всё приложение на Диске; папки приложений — внутри неё">
          <a href=${`https://drive.google.com/drive/folders/${store.sync.kingdomId}`} target="_blank" rel="noopener noreferrer">Открыть Kingdom</a>
        <//>` : null}
      ${store.sync.layout?.rootId ? html`
        <${Row} label="Папка задач (Chronicle)">
          <a href=${`https://drive.google.com/drive/folders/${store.sync.layout.rootId}`} target="_blank" rel="noopener noreferrer">Открыть Chronicle</a>
        <//>` : null}
      ${store.sync.feastLayout?.rootId ? html`
        <${Row} label="Папка еды (Crimson Harvest)">
          <a href=${`https://drive.google.com/drive/folders/${store.sync.feastLayout.rootId}`} target="_blank" rel="noopener noreferrer">Открыть Crimson Harvest</a>
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
      <${Row} label="Непушнутых изменений" hint=${store.ui.feastDirty ? `Chronicle — ${store.ui.dirtyCount}, Crimson Harvest — ${store.ui.feastDirty}` : null}>${totalDirty()}<//>
      <${Row} label="Последний пуш">${when(store.sync.lastPushAt)}<//>
      <${Row} label="Последнее обновление с Диска">${when(store.sync.lastPullAt)}<//>
      <div class="form-actions">
        <button class="btn primary" onClick=${() => push()} disabled=${busy || !!store.ui.readOnly}><${Icon} name="upload" size=${18}/> Пуш</button>
        <button class="btn" onClick=${() => pull()} disabled=${busy}><${Icon} name="download" size=${18}/> Обновить</button>
        <button class="btn" onClick=${() => navigate('/journal')}>Журнал конфликтов и ошибок</button>
      </div>
    </section>
    <section class="set-section">
      <h2>Устройства</h2>
      <p class="muted small">Удаление завершает сессию Kingdom при следующей синхронизации устройства. Старые версии могут не поддерживать выход; доступ к аккаунту Google сохраняется.</p>
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

function TasksSection() {
  const s = store.data.settings;
  const readOnly = !!store.ui.readOnly;
  const lists = S.sortedLists(store.data);
  const deviceTz = deviceTimeZone();
  const zones = useMemo(() => {
    const z = allTimeZones();
    return z.includes(s.timeZone) ? z : [s.timeZone, ...z];
  }, [s.timeZone]);
  return html`
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
    </section>`;
}

function VillagePage() {
  if (!store.data.settings.gameEnabled) {
    return html`<section class="set-section"><h2>Деревня</h2>
      <p class="muted">Деревня — часть игрового режима. Включи его в разделе «Игровой режим».</p>
      <${Link} to="/settings?section=game" className="link-btn">Открыть «Игровой режим»<//></section>`;
  }
  return html`<section class="set-section"><h2>Деревня</h2><${VillageSettings}/>
    <a class="link-btn" href="#/village">Открыть деревню</a></section>`;
}

function AboutSection() {
  const checkUpdate = async () => {
    const r = await checkForUpdate();
    if (r === 'none') showSnackbar('Установлена последняя версия');
    else if (r === 'unsupported') showSnackbar('Service Worker недоступен в этом браузере');
    else if (r === 'error') showSnackbar('Не удалось проверить обновление (нет сети?)');
  };
  return html`
    <section class="set-section">
      <h2>О приложении</h2>
      <${Row} label="Версия приложения">${APP_VERSION}<//>
      <${Row} label="Формат данных">v${SCHEMA_VERSION}<//>
      <button class="btn" onClick=${checkUpdate}>Проверить обновление</button>
    </section>`;
}

function DangerSection() {
  const clearLocal = async () => {
    const n = totalDirty();
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
  return html`
    <section class="set-section danger-zone">
      <h2>Опасная зона</h2>
      <p class="muted">Удаляет базу IndexedDB, кэш приложения и локальные настройки этого браузера. Данные на Google Диске не трогаются.</p>
      <button class="btn danger-outline" onClick=${clearLocal}>Очистить локальные данные</button>
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

// ---------- Дерево разделов ----------

/** Группы и разделы: название, описание шапки, ключевые слова для поиска. */
const TREE = [
  {
    id: 'account', title: 'Аккаунт', icon: 'user',
    items: [
      { key: 'account', title: 'Google и вход', desc: 'Вход через Google нужен только для синхронизации: задачи живут в браузере и в файле на твоём Google Диске.', keywords: 'google аккаунт вход выход почта диск папка login logout email' },
      { key: 'sync', title: 'Синхронизация и устройства', desc: 'Пуш отправляет изменения на Диск, «Обновить» забирает изменения других устройств.', keywords: 'пуш обновить синхронизация устройства сессии имя устройства журнал конфликты push pull devices sync' },
    ],
  },
  {
    id: 'tasks', title: 'Задачи', icon: 'check',
    items: [
      { key: 'tasks', title: 'Общие', desc: 'Блок «Быт», часовой пояс и срок хранения корзины — общие для всех устройств.', keywords: 'быт дом часовой пояс корзина срок хранения timezone trash chores' },
      { key: 'priorities', title: 'Приоритеты и опыт', desc: 'Цвет приоритета, монеты и опыт навыка за выполненную задачу.', keywords: 'приоритет приоритеты монеты опыт xp навык цвет priority coins' },
      { key: 'notifications', title: 'Уведомления', desc: 'Напоминания о задачах на этом устройстве.', keywords: 'напоминания уведомления звук пропущенные настойчивые nag reminders notifications' },
    ],
  },
  {
    id: 'feast', title: 'Crimson Harvest — еда', icon: 'flame',
    items: [
      { key: 'feast-goals', title: 'Цели и лимиты', desc: 'Дневной лимит калорий и цели по белкам, жирам и углеводам. Общие для всех устройств.', keywords: 'калории лимит цель белки жиры углеводы бжу ккал норма feast crimson harvest фитнес' },
      { key: 'feast-rewards', title: 'Награды за еду', desc: 'Сколько опыта, монет и алмазов 💎 приносит запись продукта по умолчанию.', keywords: 'награда опыт монеты алмазы изумруды xp игра продукт еда' },
      { key: 'feast-meals', title: 'Рационы', desc: 'Завтрак, обед, ужин, перекус и свои рационы: названия, значки, время, порядок.', keywords: 'рацион рационы приём пищи завтрак обед ужин перекус полдник время порядок значок' },
      { key: 'feast-data', title: 'Дневник и хранение', desc: 'Сколько записей дневника хранить: старые дни удаляются, а их итоги остаются в аналитике.', keywords: 'дневник записи лимит хранение удаление сводки экспорт json feast' },
    ],
  },
  {
    id: 'interface', title: 'Интерфейс', icon: 'palette',
    items: [
      { key: 'appearance', title: 'Внешний вид', desc: 'Положение и вид док-панели, тема и цвета — у Chronicle и Crimson Harvest свои. Хранится только на этом устройстве.', keywords: 'тема цвет схема панель док буква квадрат автоскрытие тёмная светлая dock theme color appearance panel' },
      { key: 'shortcuts', title: 'Горячие клавиши', desc: 'Клавиши для частых действий: переназначить, отключить, вернуть как было. Хранятся только на этом устройстве.', keywords: 'клавиши горячие сочетания клавиатура shortcut shortcuts hotkey keyboard' },
    ],
  },
  {
    id: 'game', title: 'Игра', icon: 'village',
    items: [
      { key: 'game', title: 'Игровой режим', desc: 'Монеты за задачи, магазин, уровни, серии и достижения.', keywords: 'игра монеты достижения украшения уровни серия game coins achievements' },
      { key: 'village', title: 'Деревня', desc: 'Полоса деревни на фоне, гости у экрана, приближение, смена дня и ночи, строгий фокус.', keywords: 'деревня фон затемнение гости жители свет день ночь приближение фокус строгий анимация village' },
    ],
  },
  {
    id: 'data', title: 'Данные', icon: 'archive',
    items: [
      { key: 'data', title: 'Хранение и вложения', desc: 'Сколько хранить выполненных, архив zip, вложения, голосовые и кэш медиа.', keywords: 'данные архив zip выполненные лимит вложения фото видео голос кэш медиа export' },
      { key: 'limits', title: 'Ограничения и хранилище', desc: 'Сколько места занято и какие ограничения действуют.', keywords: 'ограничения хранилище место квота лимиты storage limits' },
    ],
  },
  {
    id: 'app', title: 'Приложение', icon: 'settings',
    items: [
      { key: 'about', title: 'О приложении', desc: 'Версия приложения и формата данных, проверка обновления.', keywords: 'версия обновление формат about version update' },
      { key: 'danger', title: 'Сброс данных', desc: 'Удаление данных этого браузера.', keywords: 'очистить локальные данные удалить сброс опасная зона reset clear' },
      { key: 'debug', title: 'Отладка', desc: 'Проверки для разработчика.', keywords: 'отладка debug', debug: true },
    ],
  },
];

const LEAVES = TREE.flatMap((g) => g.items.map((it) => ({ ...it, group: g.id })));

function SettingsNav({ current, debug }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(() => {
    const v = readLocal('settings.open', []);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  });
  const tree = TREE.map((g) => ({ ...g, items: g.items.filter((it) => !it.debug || debug) })).filter((g) => g.items.length);
  const needle = search.trim().toLowerCase();
  const visible = needle
    ? tree.map((g) => ({ ...g, items: g.items.filter((it) => `${g.title} ${it.title} ${it.keywords}`.toLowerCase().includes(needle)) }))
      .filter((g) => g.items.length)
    : tree;
  const toggle = (id, value) => {
    const next = value ? [...new Set([...open, id])] : open.filter((g) => g !== id);
    setOpen(next);
    writeLocal('settings.open', next);
  };
  const href = (key) => '/settings?section=' + key + (debug ? '&debug=1' : '');

  return html`
    <nav class="settings-nav" aria-label="Разделы настроек">
      <div class="search-field">
        <${Icon} name="search" size=${16}/>
        <input type="search" value=${search} placeholder="Найти настройку" aria-label="Найти настройку"
          onInput=${(e) => setSearch(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter' && visible[0]?.items[0]) navigate(href(visible[0].items[0].key)); }}/>
      </div>
      ${!visible.length ? html`<p class="muted small sn-empty">Ничего не найдено.</p>` : null}
      <div class="sn-groups">
        ${visible.map((g) => {
          const containsActive = g.items.some((it) => it.key === current);
          const isOpen = !!needle || containsActive || open.includes(g.id);
          return html`
            <div class=${'sn-group' + (isOpen ? ' open' : '')} key=${g.id}>
              <button type="button" class=${'sn-trigger' + (containsActive ? ' active' : '')} aria-expanded=${isOpen}
                onClick=${() => toggle(g.id, !isOpen)}>
                <${Icon} name=${g.icon} size=${16}/><span>${g.title}</span><${Icon} name="chevron" size=${16} className="sn-chevron"/>
              </button>
              <div class="dock-collapse" inert=${!isOpen}><div class="dock-collapse-inner"><div class="sn-leaves">
                ${g.items.map((it) => html`
                  <${Link} key=${it.key} to=${href(it.key)} className=${'sn-leaf' + (it.key === current ? ' active' : '')}>${it.title}<//>`)}
              </div></div></div>
            </div>`;
        })}
      </div>
    </nav>`;
}

export function SettingsScreen({ query = {} }) {
  const debug = query.debug === '1';
  const asked = query.section;
  const fallback = activeApp() === 'feast' ? LEAVES.find((l) => l.key === 'feast-goals') : LEAVES[0];
  const leaf = LEAVES.find((l) => l.key === asked && (!l.debug || debug)) || (debug && !asked ? LEAVES.find((l) => l.key === 'debug') : fallback);
  const phone = !useMedia('(min-width: 900px)');
  // На телефоне дерево стоит над разделом: после выбора раздела показываем его начало.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (phone) document.querySelector('.settings-page')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [leaf.key]);

  const page = (() => {
    switch (leaf.key) {
      case 'account': return html`<${AccountSection}/>`;
      case 'sync': return html`<${SyncSection}/>`;
      case 'tasks': return html`<${TasksSection}/>`;
      case 'priorities': return html`<${PrioritiesSection}/>`;
      case 'notifications': return html`<${NotificationsSection}/>`;
      case 'appearance': return html`<${AppearanceSection} phone=${phone}/>`;
      case 'feast-goals': return html`<${FeastGoalsSection}/>`;
      case 'feast-data': return html`<${FeastDataSection}/>`;
      case 'feast-meals': return html`<${MealsSection}/>`;
      case 'feast-rewards': return html`<${FeastRewardsSection}/>`;
      case 'shortcuts': return html`<${ShortcutsSection}/>`;
      case 'game': return html`<${GameSettingsSection}/>`;
      case 'village': return html`<${VillagePage}/>`;
      case 'data': return html`<${DataSection}/>`;
      case 'limits': return html`<${LimitsSection}/>`;
      case 'about': return html`<${AboutSection}/>`;
      case 'danger': return html`<${DangerSection}/>`;
      case 'debug': return html`<${DebugSection}/>`;
      default: return null;
    }
  })();

  return html`
    <div class="screen settings settings-layout">
      <${SettingsNav} current=${leaf.key} debug=${debug}/>
      <div class="settings-page" key=${leaf.key}>
        <header class="settings-head">
          <h2>${leaf.title}</h2>
          <p class="muted">${leaf.desc}</p>
        </header>
        ${page}
      </div>
    </div>`;
}
