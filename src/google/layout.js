// Папка LifeTasks на Диске: поиск по appProperties и создание (docs/DATA_FORMAT.md §2.1).
// С правами drive.file приложение видит только то, что создало само, поэтому папку создаёт оно.

import { FOLDER_MIME } from './drive.js';
import { SyncError } from './http.js';

const ROOT_Q = `appProperties has { key='lifetasks' and value='root' } and mimeType='${FOLDER_MIME}' and trashed=false`;

export const NAMES = { root: 'LifeTasks', db: 'db.json.gz', manifest: 'manifest.json', media: 'media', backups: 'backups' };

async function discover(drive) {
  const roots = await drive.findFiles(ROOT_Q, { orderBy: 'createdTime' });
  if (!roots.length) return null;
  const root = roots[0];
  const children = await drive.findFiles(`'${root.id}' in parents and trashed=false`);
  const byRole = (role) => children.find((f) => f.appProperties?.lifetasks === role) || null;
  return {
    root,
    extraRoots: roots.slice(1),
    db: byRole('db'),
    manifest: byRole('manifest'),
    media: byRole('media-folder'),
    backups: byRole('backups-folder'),
  };
}

async function createDb(drive, rootId, makeDbBytes) {
  return drive.createFile({
    name: NAMES.db, parentId: rootId, mimeType: 'application/gzip', appProperties: { lifetasks: 'db' },
  }, await makeDbBytes());
}

async function createManifest(drive, rootId, layout, makeManifest) {
  return drive.createFile({
    name: NAMES.manifest, parentId: rootId, mimeType: 'application/json', appProperties: { lifetasks: 'manifest' },
  }, makeManifest(layout));
}

/**
 * Найти или создать папку. cached — сохранённые id с прошлого раза.
 * makeDbBytes() — содержимое новой базы (локальные данные), makeManifest(layout) — текст manifest.json.
 * Возвращает { layout, dbMeta, created, extraRoots }.
 * Если папка есть, а база удалена пользователем, — SyncError E-DB-MISSING.
 */
export async function ensureLayout(drive, { cached, makeDbBytes, makeManifest }) {
  if (cached?.dbId) {
    try {
      const m = await drive.getMeta(cached.dbId, 'id,trashed,headRevisionId,modifiedTime');
      if (!m.trashed) return { layout: cached, dbMeta: m, created: false, extraRoots: [] };
    } catch (e) {
      if (e.code !== 'E-NOT-FOUND') throw e;
    }
  }

  const d = await discover(drive);
  if (!d) {
    const root = await drive.createFolder(NAMES.root, null, { lifetasks: 'root' });
    const media = await drive.createFolder(NAMES.media, root.id, { lifetasks: 'media-folder' });
    const backups = await drive.createFolder(NAMES.backups, root.id, { lifetasks: 'backups-folder' });
    const db = await createDb(drive, root.id, makeDbBytes);
    const layout = { rootId: root.id, dbId: db.id, mediaFolderId: media.id, backupsFolderId: backups.id, manifestId: null };
    const manifest = await createManifest(drive, root.id, layout, makeManifest);
    layout.manifestId = manifest.id;
    return { layout, dbMeta: db, created: true, extraRoots: [] };
  }

  let created = false;
  let db = d.db;
  if (!db) {
    // Манифест есть, а базы нет — её удалили руками. Без манифеста — прерванная первая инициализация.
    if (d.manifest) throw new SyncError('E-DB-MISSING', 'Файл базы на Диске не найден');
    db = await createDb(drive, d.root.id, makeDbBytes);
    created = true;
  }
  const media = d.media || await drive.createFolder(NAMES.media, d.root.id, { lifetasks: 'media-folder' });
  const backups = d.backups || await drive.createFolder(NAMES.backups, d.root.id, { lifetasks: 'backups-folder' });
  const layout = { rootId: d.root.id, dbId: db.id, mediaFolderId: media.id, backupsFolderId: backups.id, manifestId: d.manifest?.id || null };
  if (!layout.manifestId) layout.manifestId = (await createManifest(drive, d.root.id, layout, makeManifest)).id;
  return { layout, dbMeta: db, created, extraRoots: d.extraRoots };
}

/** «Создать заново» после E-DB-MISSING: новая база из локальных данных в существующей (или новой) папке. */
export async function recreateDb(drive, { makeDbBytes, makeManifest }) {
  const d = await discover(drive);
  if (!d) return ensureLayout(drive, { cached: null, makeDbBytes, makeManifest });
  const db = await createDb(drive, d.root.id, makeDbBytes);
  const media = d.media || await drive.createFolder(NAMES.media, d.root.id, { lifetasks: 'media-folder' });
  const backups = d.backups || await drive.createFolder(NAMES.backups, d.root.id, { lifetasks: 'backups-folder' });
  const layout = { rootId: d.root.id, dbId: db.id, mediaFolderId: media.id, backupsFolderId: backups.id, manifestId: d.manifest?.id || null };
  if (layout.manifestId) await drive.updateContent(layout.manifestId, makeManifest(layout), 'application/json');
  else layout.manifestId = (await createManifest(drive, d.root.id, layout, makeManifest)).id;
  return { layout, dbMeta: db, created: true, extraRoots: d.extraRoots };
}
