// Индикатор синхронизации (docs/TZ.md §5.3): одно состояние из восьми по приоритету.

import { plural } from '../core/plural.js';
import { tr } from '../core/i18n.js';

export const UNPUSHED = ['непушнутое изменение', 'непушнутых изменения', 'непушнутых изменений'];

/**
 * s: { readOnly, phase, step, lastError, needAuth, offline, remoteNewer, dirty }
 * → { key, icon, text, short, tone }
 */
export function indicator(s) {
  const n = s.dirty || 0;
  const tail = n ? ` · ${n} ${plural(n, ['непушнутое', 'непушнутых', 'непушнутых'])}` : '';
  if (s.readOnly) return { key: 'readonly', icon: 'close', text: tr('Обнови приложение'), short: tr('Обнови'), tone: 'danger' };
  if (s.phase) {
    const t = s.phase === 'push' ? tr('Отправка…') : tr('Загрузка…');
    return { key: 'busy', icon: 'sync', text: t, short: t, tone: 'busy' };
  }
  if (s.lastError) return { key: 'error', icon: 'warn', text: tr('Ошибка синхронизации'), short: tr('Ошибка'), tone: 'danger' };
  if (s.needAuth) return { key: 'auth', icon: 'key', text: tr('Нужен вход') + tail, short: n ? tr('Вход · {n}', { n }) : tr('Вход'), tone: 'warn' };
  if (s.offline) return { key: 'offline', icon: 'offline', text: tr('Нет сети') + tail, short: n ? tr('Офлайн · {n}', { n }) : tr('Офлайн'), tone: 'warn' };
  if (s.remoteNewer) return { key: 'newer', icon: 'download', text: tr('На Диске есть версия новее') + tail, short: n ? tr('Новее · {n}', { n }) : tr('Новее'), tone: 'info' };
  if (n) return { key: 'dirty', icon: 'upload', text: `${n} ${plural(n, UNPUSHED)}`, short: String(n), tone: 'accent' };
  return { key: 'ok', icon: 'ok', text: tr('Всё запушено'), short: 'OK', tone: 'ok' };
}
