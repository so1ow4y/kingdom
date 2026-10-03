// Синхронизация медиа (обновление 0.5; docs/TZ.md §10.4, §10.6).
//   • Заливка при «Пуш»: каждое вложение — отдельный файл LifeTasks/media/<sha256>.<ext>, никогда не перезаписывается;
//     если файл с таким sha256 уже есть на Диске (залило другое устройство) — используется он. Больше 5 МБ — resumable.
//   • Скачивание лениво — когда открыта задача; хэш проверяется; файл кладётся в кэш устройства.
//   • Сборка мусора: сироты отмечаются, через settings.orphanMediaRetentionDays — в корзину Диска.

import { store, notify } from '../store/appState.js';
import { commitMedia } from '../store/actions.js';
import { gcPlan, pendingUploads, formatBytes } from '../core/media.js';
import { getBlob, putBlob, hasBlob, unpinBlob, removeBlob, blobUrl, cachedUrl } from '../media/cache.js';
import { sha256Hex } from '../media/process.js';
import { MEDIA } from '../config.js';

// ---------- Состояние скачивания для интерфейса ----------

const status = new Map(); // mediaId → 'loading' | 'missing' | 'corrupt' | 'offline' | 'error'
export const mediaStatus = (id) => status.get(id) || null;

const setStatus = (id, s) => {
  if (s) status.set(id, s);
  else status.delete(id);
  notify();
};

let running = 0;
const queue = [];
const inflight = new Map();

function slot(fn) {
  return new Promise((resolve, reject) => {
    const go = () => {
      running++;
      fn().then(resolve, reject).finally(() => {
        running--;
        queue.shift()?.();
      });
    };
    if (running < MEDIA.downloadConcurrency) go();
    else queue.push(go);
  });
}

/**
 * Получить ссылку на файл: из кэша или скачать с Диска (если онлайн и есть вход). → url или null.
 * drive — клиент Диска, layout — папки на Диске.
 */
export function ensureMedia(media, { drive, layout, canDownload }) {
  const id = media.id;
  const ready = cachedUrl(id);
  if (ready) return Promise.resolve(ready);
  if (inflight.has(id)) return inflight.get(id);
  const p = (async () => {
    const local = await blobUrl(id);
    if (local) return local;
    if (!canDownload) {
      setStatus(id, 'offline');
      return null;
    }
    setStatus(id, 'loading');
    try {
      const blob = await slot(() => downloadMedia(media, { drive, layout }));
      if (!blob) return null;
      await putBlob(id, blob);
      setStatus(id, null);
      return blobUrl(id);
    } catch (e) {
      setStatus(id, e.code === 'E-OFFLINE' ? 'offline' : 'error');
      return null;
    }
  })().finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

async function downloadMedia(media, { drive, layout }) {
  let fileId = media.driveFileId;
  let bytes = null;
  if (fileId) {
    try {
      bytes = await drive.download(fileId);
    } catch (e) {
      if (e.code !== 'E-NOT-FOUND') throw e;
      fileId = null;
    }
  }
  if (!bytes && layout?.mediaFolderId) {
    const f = await drive.findMediaBySha(layout.mediaFolderId, media.id);
    if (f) bytes = await drive.download(f.id);
  }
  if (!bytes) {
    setStatus(media.id, 'missing');
    return null;
  }
  const blob = new Blob([bytes], { type: media.mime });
  if ((await sha256Hex(blob)) !== media.id) {
    setStatus(media.id, 'corrupt');
    return null;
  }
  return blob;
}

/** Нужно ли качать сразу при открытии задачи (картинки и голос до 5 МБ) или по нажатию. */
export const autoDownload = (media) => (media.kind === 'image' || media.kind === 'audio') && (media.size | 0) <= MEDIA.autoDownloadMaxBytes;

// ---------- Пуш: заливка и сборка мусора ----------

/**
 * Залить на Диск медиа, на которые есть ссылки и которых там ещё нет. report(text) — шаг для индикатора.
 * → { uploaded, reused, missing } (missing — байтов нет на этом устройстве: зальёт устройство, где они есть).
 */
export async function uploadPending(drive, layout, report = () => {}) {
  const list = pendingUploads(store.data);
  const out = { uploaded: 0, reused: 0, missing: 0 };
  const updates = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    report(`Медиа ${i + 1}/${list.length} · ${formatBytes(m.size)}`);
    const existing = await drive.findMediaBySha(layout.mediaFolderId, m.id);
    let fileId = existing?.id || null;
    if (fileId) out.reused++;
    else {
      const blob = await getBlob(m.id);
      if (!blob) {
        out.missing++;
        continue;
      }
      const meta = { name: `${m.id}.${m.ext}`, parentId: layout.mediaFolderId, mimeType: m.mime || 'application/octet-stream', appProperties: { lifetasks: 'media', sha256: m.id } };
      const f = blob.size > MEDIA.resumableFromBytes ? await drive.uploadResumable(meta, blob) : await drive.createFile(meta, blob);
      fileId = f.id;
      out.uploaded++;
    }
    updates.push({ id: m.id, fields: { driveFileId: fileId } });
    await unpinBlob(m.id).catch(() => {});
  }
  if (updates.length) await commitMedia(updates);
  return out;
}

/** Сборка мусора (TZ §10.6). → { marked, expired } */
export async function collectGarbage(drive, nowMs = Date.now()) {
  const plan = gcPlan(store.data, nowMs, store.data.settings.orphanMediaRetentionDays ?? 30);
  const at = new Date(nowMs).toISOString();
  const updates = [
    ...plan.mark.map((id) => ({ id, fields: { orphanedAt: at } })),
    ...plan.unmark.map((id) => ({ id, fields: { orphanedAt: null } })),
  ];
  const tombs = [];
  for (const m of plan.expire) {
    if (m.driveFileId) {
      try {
        await drive.trash(m.driveFileId);
      } catch (e) {
        if (e.code !== 'E-NOT-FOUND') throw e;
      }
    }
    if (await hasBlob(m.id)) await removeBlob(m.id);
    tombs.push(m.id);
  }
  if (updates.length || tombs.length) await commitMedia(updates, tombs);
  return { marked: plan.mark.length, expired: tombs.length };
}
