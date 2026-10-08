// Подготовка файлов к вложению (обновление 0.5; docs/TZ.md §10.1): хэш, сжатие фото, вырезание EXIF.
// Фото перекодируется через canvas — EXIF (в том числе геолокация) при этом не переносится по построению.

import { kindOf, extOf } from '../core/media.js';
import { tr } from '../core/i18n.js';

/** sha256 байтов → hex (id медиа). */
export async function sha256Hex(blob) {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function canvasBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Сжать фото: ≤ maxSide по большей стороне, WebP (или JPEG, если браузер не умеет WebP) с качеством quality.
 * → { blob, mime, ext, codec, width, height } или null, если декодировать не удалось (HEIC в Chrome и т. п.).
 */
export async function compressPhoto(file, { maxSide = 1600, quality = 0.7, format = 'webp' } = {}) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  let blob = format === 'webp' ? await canvasBlob(canvas, 'image/webp', quality).catch(() => null) : null;
  if (!blob || blob.type !== 'image/webp') {
    // JPEG не умеет прозрачность — подложка белая
    const c2 = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const x2 = c2.getContext('2d');
    x2.fillStyle = '#fff';
    x2.fillRect(0, 0, w, h);
    x2.drawImage(bmp, 0, 0, w, h);
    blob = await canvasBlob(c2, 'image/jpeg', quality);
  }
  bmp.close?.();
  const webp = blob.type === 'image/webp';
  return { blob, mime: blob.type, ext: webp ? 'webp' : 'jpg', codec: webp ? 'webp' : 'jpeg', width: w, height: h, scaled: scale < 1 };
}

/**
 * Вырезать из JPEG сегменты APP1 (EXIF/XMP) и APP13 (IPTC) без перекодирования — для «Сохранить оригинал».
 * Не JPEG или битый файл — возвращается как есть.
 */
export function stripJpegExif(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const out = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return bytes;
    const marker = bytes[i + 1];
    if (marker === 0xda) { // начало данных изображения — дальше всё как есть
      out.push(bytes.subarray(i));
      break;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) return bytes;
    if (marker !== 0xe1 && marker !== 0xed) out.push(bytes.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  const total = out.reduce((n, p) => n + p.length, 0);
  const res = new Uint8Array(total);
  let o = 0;
  for (const p of out) {
    res.set(p, o);
    o += p.length;
  }
  return res;
}

/** Размеры картинки (для оригинала) — или null. */
async function imageSize(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const s = { width: bmp.width, height: bmp.height };
    bmp.close?.();
    return s;
  } catch {
    return { width: null, height: null };
  }
}

/** Длительность видео или аудио по метаданным (мс) — или null. */
export function mediaDuration(blob, kind) {
  return new Promise((resolve) => {
    const el = document.createElement(kind === 'video' ? 'video' : 'audio');
    const url = URL.createObjectURL(blob);
    const done = (v) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : null);
    el.onerror = () => done(null);
    setTimeout(() => done(null), 4000);
    el.src = url;
  });
}

/**
 * Файл → что сохранить. Фото сжимается (или оригинал без EXIF у JPEG), видео и прочее — как есть.
 * → { blob, meta: { id, kind, mime, ext, codec, size, width, height, durationMs, original }, name, note? }
 */
export async function prepareFile(file, { photoMaxSide, photoQuality, photoFormat, original = false } = {}) {
  const mime = file.type || 'application/octet-stream';
  let kind = kindOf(mime);
  let blob = file;
  let ext = extOf(mime, file.name);
  let codec = null;
  let width = null;
  let height = null;
  let isOriginal = true;
  let note = null;
  if (kind === 'image' && !/gif|svg/.test(mime)) {
    if (original) {
      if (mime === 'image/jpeg') blob = new Blob([stripJpegExif(new Uint8Array(await file.arrayBuffer()))], { type: mime });
      else note = tr('Оригинал сохранён с метаданными (может содержать геолокацию)');
      ({ width, height } = await imageSize(blob));
    } else {
      const r = await compressPhoto(file, { maxSide: photoMaxSide, quality: photoQuality, format: photoFormat });
      if (!r) {
        kind = 'file';
        note = tr('Этот формат не удалось сжать — сохранён как есть');
      } else if (!r.scaled && r.blob.size >= file.size && mime === 'image/jpeg') {
        // Сжатие не помогло, а размер и так мал — исходник без EXIF
        blob = new Blob([stripJpegExif(new Uint8Array(await file.arrayBuffer()))], { type: mime });
        width = r.width;
        height = r.height;
      } else {
        ({ blob, ext, codec, width, height } = r);
        isOriginal = false;
      }
    }
  }
  let durationMs = null;
  if (kind === 'video' || kind === 'audio') durationMs = await mediaDuration(blob, kind);
  const id = await sha256Hex(blob);
  const name = renameExt(file.name || tr('файл'), ext, isOriginal);
  return {
    blob, name, note,
    meta: { id, kind, mime: blob.type || mime, ext, codec, size: blob.size, width, height, durationMs, original: isOriginal },
  };
}


function renameExt(name, ext, keep) {
  if (keep) return name.slice(0, 255);
  const base = name.replace(/\.[^.]+$/, '');
  return `${base}.${ext}`.slice(0, 255);
}
