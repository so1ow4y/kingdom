// Индикатор синхронизации (docs/TZ.md §5.3): одно состояние из восьми по приоритету.

import { plural } from '../core/plural.js';

export const UNPUSHED = ['непушнутое изменение', 'непушнутых изменения', 'непушнутых изменений'];

/**
 * s: { readOnly, phase, step, lastError, needAuth, offline, remoteNewer, dirty }
 * → { key, icon, text, short, tone }
 */
export function indicator(s) {
  const n = s.dirty || 0;
  const tail = n ? ` · ${n} ${plural(n, ['непушнутое', 'непушнутых', 'непушнутых'])}` : '';
  if (s.readOnly) return { key: 'readonly', icon: 'close', text: 'Обнови приложение', short: 'Обнови', tone: 'danger' };
  if (s.phase) {
    const t = s.phase === 'push' ? 'Отправка…' : 'Загрузка…';
    return { key: 'busy', icon: 'sync', text: t, short: t, tone: 'busy' };
  }
  if (s.lastError) return { key: 'error', icon: 'warn', text: 'Ошибка синхронизации', short: 'Ошибка', tone: 'danger' };
  if (s.needAuth) return { key: 'auth', icon: 'key', text: 'Нужен вход' + tail, short: n ? `Вход · ${n}` : 'Вход', tone: 'warn' };
  if (s.offline) return { key: 'offline', icon: 'offline', text: 'Нет сети' + tail, short: n ? `Офлайн · ${n}` : 'Офлайн', tone: 'warn' };
  if (s.remoteNewer) return { key: 'newer', icon: 'download', text: 'На Диске есть версия новее' + tail, short: n ? `Новее · ${n}` : 'Новее', tone: 'info' };
  if (n) return { key: 'dirty', icon: 'upload', text: `${n} ${plural(n, UNPUSHED)}`, short: String(n), tone: 'accent' };
  return { key: 'ok', icon: 'ok', text: 'Всё запушено', short: 'OK', tone: 'ok' };
}
