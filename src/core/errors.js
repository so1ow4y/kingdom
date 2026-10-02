// Ошибка синхронизации с кодом из docs/TZ.md §14 (E-OFFLINE, E-DB-CORRUPT, …).

export class SyncError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.name = 'SyncError';
    this.code = code;
    Object.assign(this, extra);
  }
}
