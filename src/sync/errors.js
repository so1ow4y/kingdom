// Тексты ошибок синхронизации (docs/TZ.md §14).

import { tr } from '../core/i18n.js';

export function errorText(e) {
  const code = e?.code || 'E-INTERNAL';
  switch (code) {
    case 'E-OFFLINE': return tr('Нет сети. Изменения сохранены на устройстве — сделай пуш, когда появится интернет');
    case 'E-AUTH-EXPIRED': return tr('Сессия Google истекла — нужен повторный вход');
    case 'E-AUTH-DENIED': return tr('Вход отменён. Без входа данные хранятся только на этом устройстве');
    case 'E-AUTH-SCOPE': return tr('Не выдан доступ к Google Диску. Нажми «Войти» и оставь галочку про файлы Google Диска, созданные этим приложением');
    case 'E-AUTH-STATE': return tr('Не удалось проверить ответ Google. Попробуй войти ещё раз');
    case 'E-AUTH-ORIGIN': return tr('Адрес приложения не добавлен в настройки Google. См. GOOGLE_SETUP.md');
    case 'E-AUTH': return tr('Ошибка входа Google: {p0}', { p0: e.detail || e.message });
    case 'E-API-DISABLED': return tr('В проекте Google Cloud не включён Google Drive API. См. GOOGLE_SETUP.md, шаг 2');
    case 'E-QUOTA-DRIVE': return tr('На Google Диске закончилось место. Освободи место и повтори пуш');
    case 'E-RATE': return tr('Google просит подождать. Повтори через минуту');
    case 'E-SERVER': return tr('Google Диск временно недоступен (код {p0}). Изменения сохранены на устройстве', { p0: e.status || '5xx' });
    case 'E-DB-MISSING': return tr('Файл базы на Диске не найден (удалён или в корзине)');
    case 'E-DB-CORRUPT': return tr('Файл базы на Диске повреждён: {message}. Ничего не перезаписано', { message: e.message });
    case 'E-MIGRATION': return tr('Не удалось обновить формат данных: {message}. Данные не изменены', { message: e.message });
    case 'E-RACE': return tr('Не удалось записать: база на Диске одновременно меняется с другого устройства. Повтори пуш через минуту. Ничего не потеряно');
    case 'E-BROWSER': return e.message;
    case 'E-HTTP': return tr('Ошибка Google Диска: {message}', { message: e.message });
    case 'E-NOT-FOUND': return tr('Файл на Диске не найден: {message}', { message: e.message });
    default: return tr('Что-то пошло не так: {p0}. Данные на устройстве не пострадали', { p0: e?.message || e });
  }
}

/** Ошибки, которые не считаются «Ошибкой синхронизации» в индикаторе (у них своё состояние). */
export const SOFT_CODES = new Set(['E-OFFLINE', 'E-AUTH-EXPIRED', 'E-READONLY']);
