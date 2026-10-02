// Бэкапы базы в LifeTasks/backups/ (docs/TZ.md §11.3, D-13): копия через files.copy, без скачивания.

export const KEEP_PUSH_BACKUPS = 20;

export function backupName(kind, deviceId, now = new Date()) {
  const ts = now.toISOString().replace(/[:.]/g, '-');
  return `db-${ts}-${kind}-${String(deviceId).slice(-8)}.json.gz`;
}

export async function makeBackup(drive, layout, kind, deviceId, now = new Date()) {
  return drive.copy(layout.dbId, {
    name: backupName(kind, deviceId, now),
    parentId: layout.backupsFolderId,
    appProperties: { lifetasks: 'backup', backupKind: kind },
  });
}

/** Оставить KEEP_PUSH_BACKUPS последних бэкапов вида push, остальные — в корзину Диска. pre-* не трогаются. */
export async function rotateBackups(drive, layout, keep = KEEP_PUSH_BACKUPS) {
  const files = await drive.findFiles(`'${layout.backupsFolderId}' in parents and trashed=false`, { orderBy: 'createdTime desc' });
  const push = files.filter((f) => (f.appProperties?.backupKind || 'push') === 'push');
  for (const f of push.slice(keep)) await drive.trash(f.id);
  return Math.max(0, push.length - keep);
}

export async function listBackups(drive, layout) {
  return drive.findFiles(`'${layout.backupsFolderId}' in parents and trashed=false`, { orderBy: 'createdTime desc' });
}
