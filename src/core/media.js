// Медиа (обновление 0.5; docs/TZ.md §10, DATA_FORMAT §5.5, §13): типы файлов, ссылки, сборка мусора. Чистые функции.

import { liveAttachments } from './model.js';

const EXT_BY_MIME = {
  'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/3gpp': '3gp',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'application/zip': 'zip',
};

/** Вид медиа по MIME: image | audio | video | file. */
export function kindOf(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  return 'file';
}

/** Расширение без точки (для имени на Диске): по MIME, иначе по имени файла, иначе bin. */
export function extOf(mime, name = '') {
  const base = String(mime || '').toLowerCase().split(';')[0].trim();
  if (EXT_BY_MIME[base]) return EXT_BY_MIME[base];
  const m = /\.([a-z0-9]{1,8})$/i.exec(name);
  return m ? m[1].toLowerCase() : 'bin';
}

/** «1,2 МБ», «340 КБ», «12 Б». */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} Б`;
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1).replace('.', ',') : Math.round(v)} ${units[i]}`;
}

/** «0:42», «12:05», «1:02:03». */
export function formatDuration(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** id медиа, на которые ссылаются живые вложения живых (не удалённых навсегда) задач. Задачи в корзине ссылаются. */
export function mediaRefs(data) {
  const refs = new Set();
  for (const t of data.tasks.values()) {
    if (t.deletedAt) continue;
    for (const n of t.notes || []) {
      if (n.deletedAt) continue;
      for (const a of liveAttachments(n)) refs.add(a.mediaId);
    }
    for (const a of t.attachments || []) if (!a.deletedAt && a.mediaId) refs.add(a.mediaId); // формат v1/v2
  }
  return refs;
}

/**
 * Сборка мусора (TZ §10.6): сирота — медиа без ссылок. → { mark: [id], unmark: [id], expire: [Media] }
 * mark — отметить orphanedAt = сейчас; unmark — на медиа снова ссылаются; expire — сироты старше срока:
 * файл на Диске → в корзину Диска, байты на устройстве удалить, Media → надгробие.
 */
export function gcPlan(data, nowMs, retentionDays) {
  const refs = mediaRefs(data);
  const out = { mark: [], unmark: [], expire: [] };
  const limit = nowMs - Math.max(0, retentionDays) * 86400000;
  for (const m of data.media.values()) {
    if (m.deletedAt) continue;
    if (refs.has(m.id)) {
      if (m.orphanedAt) out.unmark.push(m.id);
    } else if (!m.orphanedAt) {
      if (retentionDays <= 0) out.expire.push(m);
      else out.mark.push(m.id);
    } else if (Date.parse(m.orphanedAt) <= limit) out.expire.push(m);
  }
  return out;
}

/** Медиа, которые нужно залить на Диск: живые, есть ссылки, ещё без driveFileId. */
export function pendingUploads(data) {
  const refs = mediaRefs(data);
  return [...data.media.values()].filter((m) => !m.deletedAt && !m.driveFileId && refs.has(m.id));
}

/** Сколько места занимают живые медиа (по метаданным) — всего и уже на Диске. */
export function mediaUsage(data) {
  let total = 0;
  let onDrive = 0;
  let count = 0;
  for (const m of data.media.values()) {
    if (m.deletedAt) continue;
    count++;
    total += m.size | 0;
    if (m.driveFileId) onDrive += m.size | 0;
  }
  return { count, total, onDrive };
}
