// «Настройки → Данные» и «Ограничения и хранилище» (обновление 0.5), чистка выполненных, экспорт в zip.

import { html, useState, useEffect } from '../html.js';
import { store, ask, showSnackbar, setUi } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import { doneCount } from '../../core/retention.js';
import { formatBytes, mediaUsage } from '../../core/media.js';
import { countLabel } from '../../core/plural.js';
import { buildDb, COLLECTIONS } from '../../data/envelope.js';
import { buildExport } from '../../data/exportZip.js';
import { gzipJson } from '../../data/serialize.js';
import { getRepo } from '../../store/localRepo.js';
import { cacheUsage, cacheLimitMB, setCacheLimitMB, clearCache, getBlob } from '../../media/cache.js';
import { ensureMedia } from '../../sync/mediaSync.js';
import { drive } from '../../sync/syncEngine.js';
import { tokenValid } from '../../google/auth.js';
import { readLocal, writeLocal } from '../hooks.js';
import { LIMITS, MEDIA, RETENTION, BACKUPS_KEEP, TOMBSTONE_TTL_DAYS, DRIVE_QUOTA_URL, DRIVE_STORAGE_URL } from '../../config.js';
import { SCHEMA_VERSION } from '../../version.js';

const TASKS = ['задача', 'задачи', 'задач'];

function dataArrays() {
  const d = store.data;
  const out = { settings: d.settings ? [d.settings] : [] };
  for (const c of COLLECTIONS) if (c !== 'settings') out[c] = [...(d[c]?.values() || [])];
  return out;
}

/** Скачать архив .zip со всеми данными и вложениями (недостающие вложения — с Диска, если можно). */
export async function exportNow() {
  setUi({ busyText: 'Готовлю архив…' });
  try {
    const canDl = navigator.onLine && tokenValid() && !!store.sync.layout;
    const { blob, name, mediaMissing } = await buildExport({
      data: dataArrays(),
      deviceId: store.deviceId,
      createdAt: await getRepo().getMeta('db.createdAt'),
      getMediaBytes: async (m) => {
        let b = await getBlob(m.id);
        if (!b && canDl) {
          await ensureMedia(m, { drive, layout: store.sync.layout, canDownload: true });
          b = await getBlob(m.id);
        }
        return b ? new Uint8Array(await b.arrayBuffer()) : null;
      },
    });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    showSnackbar(mediaMissing.length
      ? `Архив скачан без ${countLabel(mediaMissing.length, ['вложения', 'вложений', 'вложений'])} (их нет на устройстве)`
      : `Архив скачан · ${formatBytes(blob.size)}`);
    return true;
  } catch (e) {
    showSnackbar(`Не удалось собрать архив: ${e?.message || e}`);
    return false;
  } finally {
    setUi({ busyText: null });
  }
}

/**
 * Чистка выполненных сверх лимита. Перед первым срабатыванием на устройстве — окно с предложением сначала
 * скачать архив. interactive=false — тихо при запуске (если уже подтверждали).
 */
export async function runRetention({ interactive = false } = {}) {
  if (store.ui.readOnly) return 0;
  const plan = A.completedPlan();
  if (!plan.count) {
    if (interactive) showSnackbar(store.data.settings.completedLimit == null ? 'Лимит выключен' : 'Удалять нечего — выполненных не больше лимита');
    return 0;
  }
  if (!readLocal('retentionConfirmed', false) || interactive) {
    const v = await ask({
      title: `Будет удалено ${countLabel(plan.count, ['старая выполненная задача', 'старые выполненные задачи', 'старых выполненных задач'])}`,
      text: `Хранится ${plan.total} выполненных, лимит — ${store.data.settings.completedLimit}. Удаляются самые старые (выполненные за последние ${RETENTION.keepRecentDays} дней остаются). `
        + 'Статистика, серии, уровни и монеты не изменятся. Задачи удаляются навсегда — можно сначала скачать архив со всеми данными.',
      buttons: [
        { label: 'Не сейчас', value: null },
        { label: 'Сначала архив (zip)', value: 'export' },
        { label: 'Удалить', value: 'yes', kind: 'danger' },
      ],
    });
    if (!v) return 0;
    if (v === 'export') {
      if (!(await exportNow())) return 0;
      const again = await ask({
        title: 'Архив скачан',
        text: `Удалить ${countLabel(plan.count, TASKS)} сейчас?`,
        buttons: [{ label: 'Не сейчас', value: null }, { label: 'Удалить', value: 'yes', kind: 'danger' }],
      });
      if (again !== 'yes') return 0;
    }
    writeLocal('retentionConfirmed', true);
  }
  const n = await A.purgeCompleted(A.completedPlan());
  if (n) showSnackbar(`Удалено ${countLabel(n, ['старая выполненная', 'старые выполненные', 'старых выполненных'])} · статистика сохранена`);
  return n;
}

function Row({ label, hint, children }) {
  return html`<div class="set-row"><div class="set-label">${label}${hint ? html`<small>${hint}</small>` : null}</div>
    <div class="set-control">${children}</div></div>`;
}

/** «Настройки → Данные». */
export function DataSection() {
  const s = store.data.settings;
  const readOnly = !!store.ui.readOnly;
  const limit = s.completedLimit;
  const [draft, setDraft] = useState(String(limit ?? RETENTION.completedDefault));
  const [cache, setCache] = useState(null);
  const [cacheMB, setCacheMB] = useState(cacheLimitMB());
  const done = doneCount(store.data);
  useEffect(() => {
    cacheUsage().then(setCache);
  }, [store.version]);
  const saveLimit = (v) => {
    const n = Math.round(+v);
    if (!(n >= RETENTION.completedMin && n <= RETENTION.completedMax)) {
      showSnackbar(`Лимит — от ${RETENTION.completedMin} до ${RETENTION.completedMax}`);
      setDraft(String(limit ?? RETENTION.completedDefault));
      return;
    }
    A.updateSettings({ completedLimit: n }).then(() => runRetention());
  };
  return html`
    <section class="set-section" id="data">
      <h2>Данные</h2>
      <${Row} label="Хранить выполненных задач" hint=${`Сейчас: ${done}. Старые сверх лимита удаляются навсегда (кроме выполненных за ${RETENTION.keepRecentDays} дней), статистика сохраняется`}>
        <label class="switch"><input type="checkbox" checked=${limit != null} disabled=${readOnly}
          onChange=${(e) => A.updateSettings({ completedLimit: e.target.checked ? +draft || RETENTION.completedDefault : null })}/> ${limit != null ? 'не больше' : 'без лимита'}</label>
        ${limit != null ? html`<input type="number" min=${RETENTION.completedMin} max=${RETENTION.completedMax} step="100" value=${draft} disabled=${readOnly}
          style="width: 96px" aria-label="Лимит выполненных" onInput=${(e) => setDraft(e.target.value)} onChange=${(e) => saveLimit(e.target.value)}/>` : null}
      <//>
      <div class="btn-row">
        <button class="btn" onClick=${() => runRetention({ interactive: true })} disabled=${readOnly || limit == null}>Очистить сейчас</button>
        <button class="btn" onClick=${exportNow}>Скачать архив (zip)</button>
      </div>
      <h3 class="set-sub">Вложения</h3>
      <${Row} label="Размер вложения" hint="Видео и файлы больше лимита не добавляются (фото сжимаются)">
        <select value=${String(s.attachmentMaxMB)} disabled=${readOnly} onChange=${(e) => A.updateSettings({ attachmentMaxMB: +e.target.value })}>
          ${[...new Set([10, 25, 50, 100, 200, 500, s.attachmentMaxMB])].sort((a, b) => a - b).map((n) => html`<option value=${String(n)}>до ${n} МБ</option>`)}
        </select>
      <//>
      <${Row} label="Длина голосовой записи">
        <select value=${String(s.voiceMaxSeconds)} disabled=${readOnly} onChange=${(e) => A.updateSettings({ voiceMaxSeconds: +e.target.value })}>
          ${[...new Set([60, 180, 300, 600, 1200, 1800, 3600, s.voiceMaxSeconds])].sort((a, b) => a - b).map((n) => html`<option value=${String(n)}>до ${n / 60} мин</option>`)}
        </select>
      <//>
      <${Row} label="Качество голоса" hint="Около 120 / 180 / 240 КБ на минуту">
        <select value=${String(s.voiceBitrate)} disabled=${readOnly} onChange=${(e) => A.updateSettings({ voiceBitrate: +e.target.value })}>
          <option value="16000">16 кбит/с</option><option value="24000">24 кбит/с</option><option value="32000">32 кбит/с</option>
        </select>
      <//>
      <${Row} label="Неиспользуемые файлы удаляются с Диска через" hint="Вложение удалили или задачу удалили навсегда — файл ждёт этот срок, потом уходит в корзину Google Диска">
        <select value=${String(s.orphanMediaRetentionDays)} disabled=${readOnly} onChange=${(e) => A.updateSettings({ orphanMediaRetentionDays: +e.target.value })}>
          ${[0, 7, 14, 30, 60, 90].map((n) => html`<option value=${String(n)}>${n ? `${n} дн.` : 'сразу'}</option>`)}
        </select>
      <//>
      <${Row} label="Кэш медиа на этом устройстве" hint=${cache ? `Занято ${formatBytes(cache.total)}${cache.pinnedCount ? `, из них ещё не на Диске: ${formatBytes(cache.pinned)}` : ''}` : '…'}>
        <select value=${String(cacheMB)} onChange=${(e) => { setCacheLimitMB(+e.target.value); setCacheMB(+e.target.value); }}>
          ${[100, 300, 500, 1000, 2000].map((n) => html`<option value=${String(n)}>до ${n} МБ</option>`)}
        </select>
      <//>
      <button class="btn small" onClick=${async () => { const n = await clearCache(); setCache(await cacheUsage()); showSnackbar(n ? `Удалено из кэша: ${n}` : 'Кэш пуст (незалитые файлы не трогаются)'); }}>Очистить кэш медиа</button>
    </section>`;
}

/** «Настройки → Ограничения и хранилище»: лимиты приложения и сколько занято. */
export function LimitsSection() {
  const s = store.data.settings;
  const [db, setDb] = useState(null);
  const [cache, setCache] = useState(null);
  const [quota, setQuota] = useState(null);
  const [persisted, setPersisted] = useState(null);
  const data = store.data;
  let active = 0;
  let trash = 0;
  for (const t of data.tasks.values()) {
    if (t.deletedAt) continue;
    if (t.trashedAt) trash++;
    else if (t.status === 'active') active++;
  }
  const done = doneCount(data);
  const media = mediaUsage(data);
  useEffect(() => {
    const json = JSON.stringify(buildDb(dataArrays(), { deviceId: store.deviceId }));
    gzipJson(JSON.parse(json)).then((gz) => setDb({ raw: new TextEncoder().encode(json).length, gz: gz.length }));
    cacheUsage().then(setCache);
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {});
  }, []);
  const loadQuota = async () => {
    setQuota('loading');
    try {
      setQuota(await drive.quota());
    } catch (e) {
      setQuota({ error: e?.code === 'E-AUTH-EXPIRED' ? 'Нужен вход в Google' : e?.code === 'E-OFFLINE' ? 'Нет сети' : String(e?.message || e) });
    }
  };
  useEffect(() => {
    if (tokenValid() && navigator.onLine) loadQuota();
  }, []);
  const q = quota && quota !== 'loading' && !quota.error ? quota : null;
  const limit = q && q.limit ? +q.limit : null;
  const used = q ? +q.usage || 0 : 0;
  return html`
    <section class="set-section" id="limits">
      <h2>Ограничения и хранилище</h2>
      <h3 class="set-sub">Ограничения</h3>
      <table class="kv">
        <tr><td>Название задачи</td><td>до ${LIMITS.titleMax} символов</td></tr>
        <tr><td>Текст заметки</td><td>до ${LIMITS.noteMax.toLocaleString('ru-RU')} символов</td></tr>
        <tr><td>«Главных» на день</td><td>${LIMITS.focusMax}</td></tr>
        <tr><td>Вложенность задач</td><td>${LIMITS.maxDepth} уровня</td></tr>
        <tr><td>Напоминаний у задачи</td><td>до ${LIMITS.remindersMax}</td></tr>
        <tr><td>Хранить выполненных</td><td>${s.completedLimit == null ? 'без лимита' : `до ${s.completedLimit}`} (настраивается: ${RETENTION.completedMin}–${RETENTION.completedMax})</td></tr>
        <tr><td>Вложение (видео, файл)</td><td>до ${s.attachmentMaxMB} МБ; фото — сжатие до ${s.photoMaxSide} px</td></tr>
        <tr><td>Голосовая запись</td><td>до ${Math.round(s.voiceMaxSeconds / 60)} мин, ${s.voiceBitrate / 1000} кбит/с</td></tr>
        <tr><td>Автозагрузка вложений с Диска</td><td>картинки и голос до ${formatBytes(MEDIA.autoDownloadMaxBytes)}</td></tr>
        <tr><td>Бэкапов на Диске</td><td>${BACKUPS_KEEP} последних (+ перед миграцией формата)</td></tr>
        <tr><td>Надгробия удалённого</td><td>хранятся ${TOMBSTONE_TTL_DAYS} дней</td></tr>
        <tr><td>Корзина</td><td>очищается через ${s.trashRetentionDays} дн.</td></tr>
        <tr><td>Формат данных</td><td>v${SCHEMA_VERSION}</td></tr>
      </table>
      <h3 class="set-sub">Использование</h3>
      <table class="kv">
        <tr><td>Задачи</td><td>активных ${active}, выполненных ${done}, в корзине ${trash}; сводок удалённых выполненных — ${[...data.doneArchive.values()].filter((a) => !a.deletedAt).length}</td></tr>
        <tr><td>Размер базы</td><td>${db ? `${formatBytes(db.raw)} (сжатая на Диске — ${formatBytes(db.gz)})` : '…'}</td></tr>
        <tr><td>Медиа на Диске</td><td>${formatBytes(media.onDrive)}${media.total > media.onDrive ? ` · ждут «Пуш»: ${formatBytes(media.total - media.onDrive)}` : ''} (файлов: ${media.count})</td></tr>
        <tr><td>Кэш медиа на устройстве</td><td>${cache ? `${formatBytes(cache.total)} из ${cacheLimitMB()} МБ` : '…'}</td></tr>
        <tr><td>Google Диск</td><td>${q ? html`занято ${formatBytes(used)}${limit ? ` из ${formatBytes(limit)}, свободно ${formatBytes(Math.max(0, limit - used))}` : ' (без ограничения)'}
          <div class="quota-bar"><i style=${{ width: limit ? Math.min(100, (used / limit) * 100) + '%' : '0' }}></i></div>
          <small class="muted">Место общее для Диска, Gmail и Google Фото</small>`
          : quota === 'loading' ? 'загрузка…' : html`${quota?.error || 'не загружено'} <button class="btn small" onClick=${loadQuota}>Узнать</button>`}</td></tr>
        <tr><td>Хранилище браузера</td><td>${persisted == null ? '…' : persisted ? 'постоянное (браузер не очистит само)' : 'может быть очищено браузером при нехватке места — делай «Пуш» регулярно'}</td></tr>
      </table>
      <p class="hint">Квоты Google Drive API (число запросов) — <a href=${DRIVE_QUOTA_URL} target="_blank" rel="noopener">в Google Cloud Console</a>; место на Диске — <a href=${DRIVE_STORAGE_URL} target="_blank" rel="noopener">в настройках Google Диска</a>.</p>
    </section>`;
}

