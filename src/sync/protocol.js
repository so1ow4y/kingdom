// Протокол синхронизации (docs/TZ.md §9.3): чтение и слияние удалённой базы, запись с проверкой гонки.
// Без IndexedDB и интерфейса — тестируется на поддельном Диске (tests/fakeDrive.js) и переносится в бота.

import { mergeData, detectConflicts, maxStamp, MERGE_COLLECTIONS } from '../core/merge.js';
import { canonicalJson } from '../core/canonical.js';
import { SyncError } from '../core/errors.js';
import { checkDb } from '../data/envelope.js';
import { validateDb } from '../data/validate.js';
import { gunzipJson } from '../data/serialize.js';
import { migrateDb } from '../data/migrations/index.js';

/** Байты db.json.gz → проверенная и (если нужно) мигрированная база. */
export async function parseDbBytes(bytes, { fakeNewerSchema = false } = {}) {
  const raw = checkDb(await gunzipJson(bytes));
  if (fakeNewerSchema) raw.schemaVersion += 1; // режим отладки: проверить «только чтение»
  const fromVersion = raw.schemaVersion;
  // Сначала миграция (E-READONLY, если база новее приложения), потом проверка структуры уже в текущем формате.
  const db = validateDb(migrateDb(raw));
  return { db, migratedFrom: db.schemaVersion !== fromVersion ? fromVersion : null };
}

/**
 * Слить удалённые данные с локальными.
 * local, remote — { coll: Entity[] }; base — Map<'coll/id', fieldTimes> последней синхронизации.
 * Возвращает:
 *   merged      — итоговые данные;
 *   changes     — [{ coll, entity }] сущности, которые изменились относительно локальных;
 *   dirtyAdd    — ключи, которых после слияния нет на Диске в таком виде (нужно запушить);
 *   dirtyRemove — ключи, которые совпадают с Диском (пушить не нужно);
 *   conflicts   — записи журнала конфликтов;
 *   baseNext    — новый снимок base (= то, что сейчас на Диске);
 *   maxRemoteStamp.
 */
export function mergeRemote({ local, remote, base, at = new Date().toISOString() }) {
  const merged = mergeData(local, remote);
  const changes = [];
  const dirtyAdd = [];
  const dirtyRemove = [];
  const baseNext = new Map();
  let maxRemote = 0;
  for (const c of MERGE_COLLECTIONS) {
    const L = new Map((local[c] || []).map((e) => [e.id, e]));
    const R = new Map((remote[c] || []).map((e) => [e.id, e]));
    for (const r of remote[c] || []) {
      baseNext.set(`${c}/${r.id}`, r.fieldTimes || {});
      const s = maxStamp(r);
      if (s > maxRemote) maxRemote = s;
    }
    for (const m of merged[c]) {
      const key = `${c}/${m.id}`;
      const cm = canonicalJson(m);
      const l = L.get(m.id);
      const r = R.get(m.id);
      if (!l || canonicalJson(l) !== cm) changes.push({ coll: c, entity: m });
      if (r && canonicalJson(r) === cm) dirtyRemove.push(key);
      else dirtyAdd.push(key);
    }
  }
  const conflicts = detectConflicts(local, remote, merged, base, at);
  return { merged, changes, dirtyAdd, dirtyRemove, conflicts, baseNext, maxRemoteStamp: maxRemote };
}

/**
 * Записать базу и проверить, что между чтением и записью никто не вклинился (шаги P9–P10).
 * makeBytes() → { bytes, snapshot }; onForeign(bytes) — слить чужую ревизию в локальные данные.
 * Возвращает { meta, snapshot, verified }.
 */
export async function writeDbChecked({ drive, dbId, expectedPrevRev, makeBytes, onForeign, attempts = 3 }) {
  let expected = expectedPrevRev;
  for (let i = 0; i < attempts; i++) {
    const { bytes, snapshot } = await makeBytes();
    const meta = await drive.updateContent(dbId, bytes, 'application/gzip');
    const revs = await drive.listRevisions(dbId);
    const idx = revs.findIndex((r) => r.id === meta.headRevisionId);
    // Нашей ревизии нет в списке или она самая старая из сохранённых — проверить нельзя, считаем успехом.
    if (idx <= 0) return { meta, snapshot, verified: false };
    const prev = revs[idx - 1].id;
    if (prev === expected) return { meta, snapshot, verified: true };
    await onForeign(await drive.downloadRevision(dbId, prev), prev);
    expected = meta.headRevisionId;
  }
  throw new SyncError('E-RACE', 'База на Диске одновременно меняется с другого устройства');
}

/** Ключи «непушнутых», которые совпали с записанным снимком (их можно снять). */
export function pushedKeys(dirtyKeys, snapshot, current) {
  const snap = new Map();
  for (const c of MERGE_COLLECTIONS) for (const e of snapshot[c] || []) snap.set(`${c}/${e.id}`, canonicalJson(e));
  return dirtyKeys.filter((key) => {
    const [c, id] = key.split('/');
    const cur = current(c, id);
    if (!cur) return !snap.has(key); // удалено локально (истёкшее надгробие) и не записано — снимаем
    return snap.get(key) === canonicalJson(cur);
  });
}

export function baseFrom(snapshot) {
  const m = new Map();
  for (const c of MERGE_COLLECTIONS) for (const e of snapshot[c] || []) m.set(`${c}/${e.id}`, e.fieldTimes || {});
  return m;
}
