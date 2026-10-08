// Папки приложения на Диске: поиск по appProperties и создание (docs/DATA_FORMAT.md §2.1).
// С правами drive.file приложение видит только то, что создало само, поэтому папку создаёт оно.
// С 0.11 папок две: LifeTasks — задачи Chronicle, как раньше; вторая — счётчик калорий (DATA_FORMAT §19).
// Устройство одинаковое, различается ключ appProperties и имя; у счётчика калорий нет папки медиа.
// 0.12: всё приложение — в общей папке Kingdom, папки приложений — внутри неё. Папки ищутся по appProperties
// где угодно, поэтому старые папки можно перенести в Kingdom руками — ничего не сломается.
// Старые имена папок переименовываются: «LifeTasks» → «Chronicle», «Feast» (0.11) → «Crimson Harvest».

import { FOLDER_MIME } from './drive.js';
import { SyncError } from './http.js';
import { tr } from '../core/i18n.js';

/** Пространства: ключ appProperties, имя папки, нужна ли папка медиа. */
export const SPACES = {
  tasks: { key: 'lifetasks', rootName: 'Chronicle', media: true, legacyNames: ['LifeTasks'] },
  feast: { key: 'feast', rootName: 'Crimson Harvest', media: false, legacyNames: ['Feast'] },
};

/** Общая папка всего приложения (0.12). */
export const KINGDOM = { key: 'kingdom', rootName: 'Kingdom' };

export const NAMES = { root: 'Chronicle', db: 'db.json.gz', manifest: 'manifest.json', media: 'media', backups: 'backups' };

const rootQ = (space) => `appProperties has { key='${space.key}' and value='root' } and mimeType='${FOLDER_MIME}' and trashed=false`;
const props = (space, role) => ({ [space.key]: role });

async function discover(drive, space) {
  const roots = await drive.findFiles(rootQ(space), { orderBy: 'createdTime' });
  if (!roots.length) return null;
  const root = roots[0];
  const children = await drive.findFiles(`'${root.id}' in parents and trashed=false`);
  const byRole = (role) => children.find((f) => f.appProperties?.[space.key] === role) || null;
  return {
    root,
    extraRoots: roots.slice(1),
    db: byRole('db'),
    manifest: byRole('manifest'),
    media: byRole('media-folder'),
    backups: byRole('backups-folder'),
  };
}

async function createDb(drive, space, rootId, makeDbBytes) {
  return drive.createFile({
    name: NAMES.db, parentId: rootId, mimeType: 'application/gzip', appProperties: props(space, 'db'),
  }, await makeDbBytes());
}

async function createManifest(drive, space, rootId, layout, makeManifest) {
  return drive.createFile({
    name: NAMES.manifest, parentId: rootId, mimeType: 'application/json', appProperties: props(space, 'manifest'),
  }, makeManifest(layout));
}

async function folders(drive, space, rootId, d = null) {
  const media = space.media ? d?.media || await drive.createFolder(NAMES.media, rootId, props(space, 'media-folder')) : null;
  const backups = d?.backups || await drive.createFolder(NAMES.backups, rootId, props(space, 'backups-folder'));
  return { mediaFolderId: media?.id || null, backupsFolderId: backups.id };
}

/**
 * Найти или создать папку. cached — сохранённые id с прошлого раза.
 * makeDbBytes() — содержимое новой базы (локальные данные), makeManifest(layout) — текст manifest.json.
 * Возвращает { layout, dbMeta, created, extraRoots }.
 * Если папка есть, а база удалена пользователем, — SyncError E-DB-MISSING.
 */
export async function ensureLayout(drive, { cached, makeDbBytes, makeManifest, space = SPACES.tasks, parentId = null }) {
  if (cached?.dbId) {
    try {
      const m = await drive.getMeta(cached.dbId, 'id,trashed,headRevisionId,modifiedTime');
      if (!m.trashed) return { layout: cached, dbMeta: m, created: false, extraRoots: [] };
    } catch (e) {
      if (e.code !== 'E-NOT-FOUND') throw e;
    }
  }

  const d = await discover(drive, space);
  if (!d) {
    // новая папка приложения — сразу внутри Kingdom
    const kingdomId = parentId || await ensureKingdom(drive);
    const root = await drive.createFolder(space.rootName, kingdomId, props(space, 'root'));
    const f = await folders(drive, space, root.id);
    const db = await createDb(drive, space, root.id, makeDbBytes);
    const layout = { rootId: root.id, dbId: db.id, ...f, manifestId: null };
    const manifest = await createManifest(drive, space, root.id, layout, makeManifest);
    layout.manifestId = manifest.id;
    return { layout, dbMeta: db, created: true, extraRoots: [] };
  }

  let created = false;
  let db = d.db;
  if (!db) {
    // Манифест есть, а базы нет — её удалили руками. Без манифеста — прерванная первая инициализация.
    if (d.manifest) throw Object.assign(new SyncError('E-DB-MISSING', tr('Файл базы в папке {rootName} на Диске не найден', { rootName: space.rootName })), { space: space.key });
    db = await createDb(drive, space, d.root.id, makeDbBytes);
    created = true;
  }
  const f = await folders(drive, space, d.root.id, d);
  const layout = { rootId: d.root.id, dbId: db.id, ...f, manifestId: d.manifest?.id || null };
  if (!layout.manifestId) layout.manifestId = (await createManifest(drive, space, d.root.id, layout, makeManifest)).id;
  return { layout, dbMeta: db, created, extraRoots: d.extraRoots };
}

/** «Создать заново» после E-DB-MISSING: новая база из локальных данных в существующей (или новой) папке. */
export async function recreateDb(drive, { makeDbBytes, makeManifest, space = SPACES.tasks, parentId = null }) {
  const d = await discover(drive, space);
  if (!d) return ensureLayout(drive, { cached: null, makeDbBytes, makeManifest, space, parentId });
  const db = await createDb(drive, space, d.root.id, makeDbBytes);
  const f = await folders(drive, space, d.root.id, d);
  const layout = { rootId: d.root.id, dbId: db.id, ...f, manifestId: d.manifest?.id || null };
  if (layout.manifestId) await drive.updateContent(layout.manifestId, makeManifest(layout), 'application/json');
  else layout.manifestId = (await createManifest(drive, space, d.root.id, layout, makeManifest)).id;
  return { layout, dbMeta: db, created: true, extraRoots: d.extraRoots };
}

// ---------- Kingdom (0.12) ----------

const kingdomQ = `appProperties has { key='${KINGDOM.key}' and value='root' } and mimeType='${FOLDER_MIME}' and trashed=false`;

/**
 * id общей папки Kingdom: проверенный cachedId, иначе найденная по appProperties (самая старая), иначе новая
 * в корне «Моего диска».
 */
export async function ensureKingdom(drive, cachedId = null) {
  if (cachedId) {
    try {
      const m = await drive.getMeta(cachedId, 'id,trashed');
      if (!m.trashed) return cachedId;
    } catch (e) {
      if (e.code !== 'E-NOT-FOUND') throw e;
    }
  }
  const found = await drive.findFiles(kingdomQ, { orderBy: 'createdTime' });
  if (found.length) return found[0].id;
  return (await drive.createFolder(KINGDOM.rootName, null, { [KINGDOM.key]: 'root' })).id;
}

/**
 * Старое имя папки приложения → новое («LifeTasks» → «Chronicle», «Feast» → «Crimson Harvest»). Своё имя, которое
 * дал человек, не трогаем.
 * → true, если переименовали.
 */
export async function renameLegacyRoot(drive, rootId, space) {
  if (!rootId || !space.legacyNames?.length) return false;
  const m = await drive.getMeta(rootId, 'id,name,trashed');
  if (m.trashed || !space.legacyNames.includes(m.name)) return false;
  await drive.updateMeta(rootId, { name: space.rootName });
  return true;
}
