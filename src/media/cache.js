// Кэш медиа на устройстве (обновление 0.5; docs/TZ.md §10.3). Байты — в IndexedDB (стор blobs).
// pinned = ещё не залито на Диск: такие файлы никогда не вытесняются. Остальные вытесняются по давности обращения,
// когда кэш больше лимита (настройка устройства, по умолчанию 300 МБ), пока не станет ≤ 90 % лимита.

import { getRepo } from '../store/localRepo.js';
import { readLocal, writeLocal } from '../ui/hooks.js';
import { MEDIA } from '../config.js';

const urls = new Map(); // id → objectURL (живут, пока открыто приложение)

export const cacheLimitMB = () => readLocal('mediaCacheMB', MEDIA.cacheLimitMBDefault);
export const setCacheLimitMB = (mb) => writeLocal('mediaCacheMB', mb);

export async function putBlob(id, blob, { pinned = false } = {}) {
  await getRepo().putBlob(id, blob, { pinned });
  if (!pinned) evict().catch(() => {});
}

export const hasBlob = (id) => getRepo().hasBlob(id);
export const unpinBlob = (id) => getRepo().setBlobPinned(id, false);

/** Готовая ссылка для <img>/<audio>/<video>, если файл уже есть на устройстве. */
export const cachedUrl = (id) => urls.get(id) || null;

/** Ссылка на файл из кэша или null, если его нет на устройстве. */
export async function blobUrl(id) {
  if (urls.has(id)) return urls.get(id);
  const blob = await getRepo().getBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

export async function getBlob(id) {
  return getRepo().getBlob(id);
}

export async function removeBlob(id) {
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
  await getRepo().deleteBlob(id);
}

/** { count, total, pinned, pinnedCount } в байтах. */
export async function cacheUsage() {
  const rows = await getRepo().listBlobs();
  let total = 0;
  let pinned = 0;
  let pinnedCount = 0;
  for (const r of rows) {
    total += r.size || 0;
    if (r.pinned) {
      pinned += r.size || 0;
      pinnedCount++;
    }
  }
  return { count: rows.length, total, pinned, pinnedCount };
}

/** Вытеснить незакреплённые файлы по давности обращения, пока кэш не станет ≤ 90 % лимита. → сколько удалено. */
export async function evict(limitBytes = cacheLimitMB() * 1024 * 1024) {
  const rows = await getRepo().listBlobs();
  let total = rows.reduce((n, r) => n + (r.size || 0), 0);
  if (total <= limitBytes) return 0;
  const target = limitBytes * 0.9;
  let removed = 0;
  for (const r of rows.filter((x) => !x.pinned).sort((a, b) => a.lastAccess - b.lastAccess)) {
    if (total <= target) break;
    await removeBlob(r.id);
    total -= r.size || 0;
    removed++;
  }
  return removed;
}

/** Очистить кэш медиа (кроме ещё не залитых на Диск). */
export async function clearCache() {
  return evict(0);
}
