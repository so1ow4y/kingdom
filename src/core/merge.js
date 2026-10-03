// Слияние баз (docs/DATA_FORMAT.md §6, нормативно). Чистые функции, без браузерных API —
// этот файл без изменений переносится в бота.
//
// Правила: last-write-wins по каждому полю (метки fieldTimes); при равных метках — детерминированный выбор
// по каноническому JSON; надгробие (deletedAt) побеждает, если после удаления не было правок.

import { canonicalJson, sameValue } from './canonical.js';

const SERVICE = new Set(['id', 'createdAt', 'updatedAt', 'updatedBy', 'fieldTimes']);
// Вложенные коллекции: массивы элементов с id, сливаются поэлементно (subtasks — только формат v1).
export const NESTED_ARRAYS = ['subtasks', 'notes', 'attachments', 'reminders'];
// Словари «ключ → значение с меткой t», сливаются по ключу: экземпляры повторов и членство в списках (v2).
export const KEYED_MAPS = ['occurrences', 'lists'];
const STRUCTURAL = new Set([...SERVICE, ...NESTED_ARRAYS, ...KEYED_MAPS]);
export const MERGE_COLLECTIONS = ['settings', 'lists', 'tasks', 'media', 'devices', 'priorities', 'coinEvents', 'rewards', 'doneArchive'];

const isTomb = (e) => !!e.deletedAt;
const ft = (e, k) => {
  const v = e.fieldTimes?.[k];
  return Number.isInteger(v) ? v : 0;
};
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const larger = (a, b) => (canonicalJson(a) >= canonicalJson(b) ? a : b);

/** Максимальная метка сущности (включая вложенные элементы и экземпляры повторов). */
export function maxStamp(e, skipDeleted = false) {
  let m = 0;
  for (const [k, v] of Object.entries(e.fieldTimes || {})) {
    if (skipDeleted && k === 'deletedAt') continue;
    if (Number.isInteger(v) && v > m) m = v;
  }
  for (const n of NESTED_ARRAYS) {
    if (!Array.isArray(e[n])) continue;
    for (const x of e[n]) {
      const s = maxStamp(x);
      if (s > m) m = s;
    }
  }
  for (const k of KEYED_MAPS) {
    if (!e[k] || typeof e[k] !== 'object' || Array.isArray(e[k])) continue;
    for (const o of Object.values(e[k])) if (o && Number.isInteger(o.t) && o.t > m) m = o.t;
  }
  return m;
}

function mergeNested(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (!Array.isArray(a) || !Array.isArray(b)) return larger(a, b);
  const m = new Map();
  for (const x of a) m.set(x.id, x);
  for (const y of b) m.set(y.id, m.has(y.id) ? mergeEntity(m.get(y.id), y) : y);
  return [...m.values()].sort(byId);
}

function mergeKeyed(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return larger(a, b);
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k];
    const y = b[k];
    if (x === undefined) out[k] = y;
    else if (y === undefined) out[k] = x;
    else if ((x.t || 0) !== (y.t || 0)) out[k] = (x.t || 0) > (y.t || 0) ? x : y;
    else out[k] = sameValue(x, y) ? x : larger(x, y);
  }
  return out;
}

/** Слить две версии одной сущности (верхнего уровня или вложенной). */
export function mergeEntity(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  const da = isTomb(a);
  const db = isTomb(b);
  if (da && db) {
    const ta = ft(a, 'deletedAt');
    const tb = ft(b, 'deletedAt');
    return ta !== tb ? (ta > tb ? a : b) : larger(a, b);
  }
  // Правка, сделанная после удаления, «воскрешает» сущность (TZ §9.6, пример 2b).
  if (da) return maxStamp(b, true) > ft(a, 'deletedAt') ? b : a;
  if (db) return maxStamp(a, true) > ft(b, 'deletedAt') ? a : b;

  const fields = {};
  const times = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b),
    ...Object.keys(a.fieldTimes || {}), ...Object.keys(b.fieldTimes || {})]);
  for (const k of keys) {
    if (STRUCTURAL.has(k)) continue;
    const ta = ft(a, k);
    const tb = ft(b, k);
    const va = a[k];
    const vb = b[k];
    let v;
    if (ta > tb) v = va;
    else if (tb > ta) v = vb;
    else if (va === undefined) v = vb; // поле есть только с одной стороны — берём его
    else if (vb === undefined) v = va;
    else v = sameValue(va, vb) ? va : larger(va, vb);
    if (v !== undefined) fields[k] = v;
    if ((a.fieldTimes && k in a.fieldTimes) || (b.fieldTimes && k in b.fieldTimes)) times[k] = Math.max(ta, tb);
  }
  for (const n of NESTED_ARRAYS) {
    const v = mergeNested(a[n], b[n]);
    if (v !== undefined) fields[n] = v;
  }
  for (const k of KEYED_MAPS) {
    const v = mergeKeyed(a[k], b[k]);
    if (v !== undefined) fields[k] = v;
  }

  const r = { id: a.id };
  if (a.createdAt !== undefined || b.createdAt !== undefined) {
    r.createdAt = a.createdAt === undefined ? b.createdAt : b.createdAt === undefined ? a.createdAt
      : a.createdAt <= b.createdAt ? a.createdAt : b.createdAt;
  }
  if (a.updatedAt !== undefined || b.updatedAt !== undefined) {
    const ua = a.updatedAt || '';
    const ub = b.updatedAt || '';
    const src = ua > ub ? a : ub > ua ? b : (a.updatedBy || '') <= (b.updatedBy || '') ? a : b;
    r.updatedAt = src.updatedAt;
    r.updatedBy = src.updatedBy;
  }
  r.fieldTimes = times;
  return Object.assign(r, fields);
}

/** Слить данные двух баз: { coll: Entity[] } → { coll: Entity[] } (по id, отсортировано). */
export function mergeData(A, B, collections = MERGE_COLLECTIONS) {
  const out = {};
  for (const c of collections) {
    const m = new Map();
    for (const e of A[c] || []) m.set(e.id, e);
    for (const e of B[c] || []) m.set(e.id, m.has(e.id) ? mergeEntity(m.get(e.id), e) : e);
    out[c] = [...m.values()].sort(byId);
  }
  return out;
}

// ---------- Журнал конфликтов (DATA_FORMAT §6.5) ----------

const IGNORED_FIELDS = new Set(['order', 'focusOrder', 'driveFileId', 'orphanedAt', 'deletedAt', 'appVersion', 'lastPushAt']);
const CONFLICT_COLLECTIONS = ['tasks', 'lists', 'settings', 'priorities', 'rewards'];

const titleOf = (e) => e.title || e.name || e.id;

/**
 * Найти правки, сделанные на обеих сторонах после последней синхронизации (base: Map<'coll/id', fieldTimes>).
 * merged — результат mergeData(local, remote). Возвращает записи журнала.
 */
export function detectConflicts(local, remote, merged, base, at) {
  const out = [];
  for (const c of CONFLICT_COLLECTIONS) {
    const L = new Map((local[c] || []).map((e) => [e.id, e]));
    const M = new Map((merged[c] || []).map((e) => [e.id, e]));
    for (const r of remote[c] || []) {
      const l = L.get(r.id);
      if (!l || l === r) continue;
      const key = `${c}/${r.id}`;
      const b = base.get(key) || {};
      const baseMax = Math.max(0, ...Object.values(b).filter(Number.isInteger));
      const m = M.get(r.id);
      if (isTomb(l) !== isTomb(r)) {
        const live = isTomb(l) ? r : l;
        const liveSide = isTomb(l) ? 'remote' : 'local';
        if (maxStamp(live, true) <= baseMax) continue; // живую версию не трогали с прошлой синхронизации
        const survived = !isTomb(m);
        out.push({
          at, entityKey: key, field: 'tombstone', title: titleOf(live), resolved: false,
          kind: survived ? 'resurrected' : 'deleted',
          deletedOn: liveSide === 'local' ? 'remote' : 'local',
          winnerValue: null,
          loserValue: survived ? null : live,
          winnerDevice: (isTomb(l) ? l : r).updatedBy || null,
          loserDevice: live.updatedBy || null,
        });
        continue;
      }
      if (isTomb(l)) continue;
      for (const k of new Set([...Object.keys(l.fieldTimes || {}), ...Object.keys(r.fieldTimes || {})])) {
        if (IGNORED_FIELDS.has(k)) continue;
        const lt = ft(l, k);
        const rt = ft(r, k);
        const bt = Number.isInteger(b[k]) ? b[k] : 0;
        if (Math.min(lt, rt) <= 1) continue; // значения по умолчанию (метка 1) конфликтом не считаются
        if (!(lt > bt && rt > bt) || sameValue(l[k], r[k])) continue;
        const localWon = sameValue(m[k], l[k]);
        out.push({
          at, entityKey: key, field: k, title: titleOf(m), resolved: false, kind: 'field',
          winnerValue: localWon ? l[k] : r[k],
          loserValue: localWon ? r[k] : l[k],
          winnerDevice: localWon ? l.updatedBy : r.updatedBy,
          loserDevice: localWon ? r.updatedBy : l.updatedBy,
        });
      }
    }
  }
  return out;
}
