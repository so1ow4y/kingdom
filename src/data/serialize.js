// JSON ↔ gzip через встроенные CompressionStream / DecompressionStream (docs/DATA_FORMAT.md §7).
// Целевые браузеры (Chrome, Edge) поддерживают их давно; фолбэк на fflate отложен до этапа 6 (zip).

import { SyncError } from '../core/errors.js';

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function gzipJson(obj) {
  if (typeof CompressionStream === 'undefined') {
    throw new SyncError('E-BROWSER', 'Браузер не умеет сжимать данные (нет CompressionStream). Обнови браузер');
  }
  return pipe(new TextEncoder().encode(JSON.stringify(obj)), new CompressionStream('gzip'));
}

export async function gunzipJson(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await pipe(bytes, new DecompressionStream('gzip')));
  } catch (e) {
    throw new SyncError('E-DB-CORRUPT', 'Не удалось распаковать файл базы', { cause: e });
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new SyncError('E-DB-CORRUPT', 'Файл базы — не корректный JSON', { cause: e });
  }
}
