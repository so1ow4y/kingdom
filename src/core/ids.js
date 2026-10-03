// UUID v7 (RFC 9562): 48 бит времени в мс + случайные биты. Сортируется по времени создания.

export function uuidv7(now = Date.now()) {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  b[6] = (b[6] & 0x0f) | 0x70; // версия 7
  b[8] = (b[8] & 0x3f) | 0x80; // вариант RFC
  let hex = '';
  for (const x of b) hex += x.toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Детерминированный UUID (версия 8) из строки — для сущностей, которые два устройства должны создать
 * одинаково без договорённости (миграция 1→2). Алгоритм (DATA_FORMAT §12.3): четыре прохода FNV-1a 32 бит
 * по кодам UTF-16 строки с начальными значениями 0x811c9dc5, 0x050c5d1f, 0x1b873593, 0xcc9e2d51;
 * 32 hex-цифры подряд, затем версия 8 и вариант 10.
 */
export function uuidFromString(s) {
  let hex = '';
  for (const seed of [0x811c9dc5, 0x050c5d1f, 0x1b873593, 0xcc9e2d51]) {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    hex += h.toString(16).padStart(8, '0');
  }
  hex = hex.slice(0, 12) + '8' + hex.slice(13, 16) + ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) + hex.slice(17);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export const UUID_RE =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
