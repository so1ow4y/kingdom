// Экспорт в .zip (docs/TZ.md §11.1, DATA_FORMAT §10.3): export.json, db.json (DEFLATE), media/<sha256>.<ext> (STORE).
// Свой небольшой ZIP-писатель без библиотек: CRC-32, локальные заголовки, центральный каталог (без ZIP64 — до 4 ГБ).

import { buildDb } from './envelope.js';
import { APP_NAME } from '../config.js';
import { APP_VERSION, SCHEMA_VERSION } from '../version.js';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  } catch {
    return null;
  }
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Собрать zip. entries: [{ name, bytes: Uint8Array, deflate?: boolean }] → Blob.
 * Имена — UTF-8 (флаг 11). Для сжатых записей CRC и размер — от исходных байтов.
 */
export async function makeZip(entries, now = new Date()) {
  const { time, date } = dosTime(now);
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.bytes);
    const packed = e.deflate ? await deflateRaw(e.bytes) : null;
    const method = packed ? 8 : 0;
    const data = packed || e.bytes;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, e.bytes.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, method, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, e.bytes.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + (p.byteLength ?? p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

/**
 * Экспорт данных: data — коллекции массивами ({ coll: Entity[] }), getMediaBytes(media) → Uint8Array | null.
 * → { blob, name, mediaMissing }
 */
export async function buildExport({ data, deviceId, createdAt, getMediaBytes, now = new Date() }) {
  const enc = new TextEncoder();
  const db = buildDb(data, { createdAt, deviceId });
  const entries = [];
  const mediaIncluded = [];
  const mediaMissing = [];
  for (const m of data.media || []) {
    if (m.deletedAt) continue;
    const bytes = await getMediaBytes(m);
    if (bytes) {
      entries.push({ name: `media/${m.id}.${m.ext}`, bytes });
      mediaIncluded.push(m.id);
    } else mediaMissing.push(m.id);
  }
  const iso = now.toISOString();
  const manifest = {
    format: 'lifetasks-export', schemaVersion: SCHEMA_VERSION, createdAt: iso, updatedAt: iso,
    writer: { app: APP_NAME, appVersion: APP_VERSION, deviceId },
    counts: {
      lists: (data.lists || []).filter((x) => !x.deletedAt).length,
      tasks: (data.tasks || []).filter((x) => !x.deletedAt).length,
      media: mediaIncluded.length + mediaMissing.length,
    },
    mediaIncluded, mediaMissing,
  };
  const blob = await makeZip([
    { name: 'export.json', bytes: enc.encode(JSON.stringify(manifest, null, 2)), deflate: true },
    { name: 'db.json', bytes: enc.encode(JSON.stringify(db)), deflate: true },
    ...entries,
  ], now);
  const p = (n) => String(n).padStart(2, '0');
  const name = `lifetasks-export-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.zip`;
  return { blob, name, mediaMissing };
}
