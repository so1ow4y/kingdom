// Поддельный Google Диск в памяти: тот же интерфейс, что у src/google/drive.js.
// Поддерживает ревизии и «вклинивание» чужой записи (hook beforeUpdate) для проверки гонок.

import { SyncError } from '../src/core/errors.js';

const FOLDER = 'application/vnd.google-apps.folder';
const toBytes = (c) => (c instanceof Uint8Array ? c : new TextEncoder().encode(String(c)));

export function createFakeDrive() {
  let seq = 0;
  let clock = Date.parse('2026-10-02T09:00:00.000Z');
  const files = new Map();
  const nextId = (p) => `${p}${++seq}`;
  const tick = () => new Date((clock += 1000)).toISOString();

  const meta = (f) => ({
    id: f.id, name: f.name, mimeType: f.mimeType, appProperties: f.appProperties, parents: f.parents,
    createdTime: f.createdTime, modifiedTime: f.modifiedTime, trashed: f.trashed,
    headRevisionId: f.revisions.length ? f.revisions.at(-1).id : undefined,
    size: f.content ? String(f.content.length) : undefined,
  });
  const get = (id) => {
    const f = files.get(id);
    if (!f) throw new SyncError('E-NOT-FOUND', 'File not found: ' + id, { status: 404 });
    return f;
  };
  const addRevision = (f, content) => {
    f.content = content;
    f.modifiedTime = tick();
    f.revisions.push({ id: nextId('rev'), modifiedTime: f.modifiedTime, content });
  };

  const drive = {
    files,
    calls: [],
    beforeUpdate: null, // async (fileId) => {} — вызывается перед записью содержимого

    async about() {
      return { user: { emailAddress: 'test@example.com', displayName: 'Test' } };
    },

    async findFiles(q, { orderBy = 'createdTime' } = {}) {
      let list = [...files.values()];
      if (/value='root'/.test(q)) list = list.filter((f) => f.appProperties?.lifetasks === 'root' && f.mimeType === FOLDER);
      const parent = q.match(/'([^']+)' in parents/);
      if (parent) list = list.filter((f) => f.parents?.includes(parent[1]));
      if (/trashed=false/.test(q)) list = list.filter((f) => !f.trashed);
      list.sort((a, b) => a.createdTime.localeCompare(b.createdTime));
      if (/desc/.test(orderBy)) list.reverse();
      return list.map(meta);
    },

    async getMeta(id) {
      return meta(get(id));
    },

    async download(id) {
      return get(id).content;
    },

    async createFolder(name, parentId, appProperties) {
      const f = { id: nextId('folder'), name, mimeType: FOLDER, appProperties, parents: parentId ? [parentId] : ['root'],
        createdTime: tick(), modifiedTime: null, trashed: false, revisions: [], content: null };
      files.set(f.id, f);
      return meta(f);
    },

    async createFile({ name, parentId, mimeType, appProperties }, content) {
      const f = { id: nextId('file'), name, mimeType, appProperties, parents: parentId ? [parentId] : ['root'],
        createdTime: tick(), trashed: false, revisions: [] };
      addRevision(f, toBytes(content));
      files.set(f.id, f);
      return meta(f);
    },

    async updateContent(id, content) {
      if (drive.beforeUpdate) {
        const hook = drive.beforeUpdate;
        drive.beforeUpdate = null; // срабатывает один раз
        await hook(id);
      }
      const f = get(id);
      addRevision(f, toBytes(content));
      drive.calls.push(['update', id]);
      return meta(f);
    },

    async copy(id, { name, parentId, appProperties }) {
      const src = get(id);
      return drive.createFile({ name, parentId, mimeType: src.mimeType, appProperties }, src.content);
    },

    async trash(id) {
      get(id).trashed = true;
      return { id, trashed: true };
    },

    async listRevisions(id) {
      return get(id).revisions.map((r) => ({ id: r.id, modifiedTime: r.modifiedTime }));
    },

    async downloadRevision(fileId, revId) {
      const r = get(fileId).revisions.find((x) => x.id === revId);
      if (!r) throw new SyncError('E-NOT-FOUND', 'Revision not found', { status: 404 });
      return r.content;
    },
  };
  return drive;
}
