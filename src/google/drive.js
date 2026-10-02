// Тонкий клиент Google Drive REST v3. Все функции возвращают промисы; ошибки — SyncError из http.js.
// Тот же интерфейс реализует поддельный Диск в tests/fakeDrive.js.

import { gfetch } from './http.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FILE_FIELDS = 'id,name,mimeType,appProperties,headRevisionId,modifiedTime,createdTime,size,trashed,parents';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

const qs = (o) => new URLSearchParams(o).toString();

function toBytes(content) {
  if (content instanceof Uint8Array) return content;
  return new TextEncoder().encode(String(content));
}

function multipart(metadata, content, mimeType) {
  const boundary = 'lifetasks' + Math.random().toString(36).slice(2);
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
    + `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  return {
    body: new Blob([head, toBytes(content), tail]),
    contentType: `multipart/related; boundary=${boundary}`,
  };
}

export function createDrive() {
  return {
    async about() {
      return gfetch(`${API}/about?${qs({ fields: 'user(displayName,emailAddress)' })}`);
    },

    /** Все файлы по запросу q (с постраничной загрузкой). */
    async findFiles(q, { orderBy = 'createdTime' } = {}) {
      const out = [];
      let pageToken = '';
      do {
        const p = { q, fields: `nextPageToken,files(${FILE_FIELDS})`, pageSize: '1000', spaces: 'drive', orderBy };
        if (pageToken) p.pageToken = pageToken;
        const r = await gfetch(`${API}/files?${qs(p)}`);
        out.push(...(r.files || []));
        pageToken = r.nextPageToken || '';
      } while (pageToken);
      return out;
    },

    async getMeta(id, fields = FILE_FIELDS) {
      return gfetch(`${API}/files/${encodeURIComponent(id)}?${qs({ fields })}`);
    },

    async download(id) {
      return gfetch(`${API}/files/${encodeURIComponent(id)}?alt=media`, { as: 'bytes' });
    },

    async createFolder(name, parentId, appProperties) {
      const meta = { name, mimeType: FOLDER_MIME, appProperties };
      if (parentId) meta.parents = [parentId];
      return gfetch(`${API}/files?${qs({ fields: FILE_FIELDS })}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(meta),
      });
    },

    /** Новый файл с содержимым (multipart, до 5 МБ). */
    async createFile({ name, parentId, mimeType, appProperties }, content) {
      const meta = { name, mimeType, appProperties };
      if (parentId) meta.parents = [parentId];
      const { body, contentType } = multipart(meta, content, mimeType);
      return gfetch(`${UPLOAD}/files?${qs({ uploadType: 'multipart', fields: FILE_FIELDS })}`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      });
    },

    /** Перезаписать содержимое существующего файла. */
    async updateContent(id, content, mimeType) {
      return gfetch(`${UPLOAD}/files/${encodeURIComponent(id)}?${qs({ uploadType: 'media', fields: FILE_FIELDS })}`, {
        method: 'PATCH',
        headers: { 'Content-Type': mimeType },
        body: new Blob([toBytes(content)]),
      });
    },

    async copy(id, { name, parentId, appProperties }) {
      return gfetch(`${API}/files/${encodeURIComponent(id)}/copy?${qs({ fields: FILE_FIELDS })}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ name, parents: parentId ? [parentId] : undefined, appProperties }),
      });
    },

    /** В корзину Google Диска (не окончательное удаление). */
    async trash(id) {
      return gfetch(`${API}/files/${encodeURIComponent(id)}?${qs({ fields: 'id,trashed' })}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ trashed: true }),
      });
    },

    /** Ревизии файла от старых к новым. */
    async listRevisions(id) {
      const out = [];
      let pageToken = '';
      do {
        const p = { fields: 'nextPageToken,revisions(id,modifiedTime,size)', pageSize: '1000' };
        if (pageToken) p.pageToken = pageToken;
        const r = await gfetch(`${API}/files/${encodeURIComponent(id)}/revisions?${qs(p)}`);
        out.push(...(r.revisions || []));
        pageToken = r.nextPageToken || '';
      } while (pageToken);
      return out;
    },

    async downloadRevision(fileId, revId) {
      return gfetch(`${API}/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revId)}?alt=media`, { as: 'bytes' });
    },
  };
}
