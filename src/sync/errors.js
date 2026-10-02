// Тексты ошибок синхронизации (docs/TZ.md §14).

export function errorText(e) {
  const code = e?.code || 'E-INTERNAL';
  switch (code) {
    case 'E-OFFLINE': return 'Нет сети. Изменения сохранены на устройстве — сделай пуш, когда появится интернет';
    case 'E-AUTH-EXPIRED': return 'Сессия Google истекла — нужен повторный вход';
    case 'E-AUTH-DENIED': return 'Вход отменён. Без входа данные хранятся только на этом устройстве';
    case 'E-AUTH-SCOPE': return 'Не выдан доступ к Google Диску. Нажми «Войти» и оставь галочку про файлы Google Диска, созданные этим приложением';
    case 'E-AUTH-STATE': return 'Не удалось проверить ответ Google. Попробуй войти ещё раз';
    case 'E-AUTH-ORIGIN': return 'Адрес приложения не добавлен в настройки Google. См. GOOGLE_SETUP.md';
    case 'E-AUTH': return `Ошибка входа Google: ${e.detail || e.message}`;
    case 'E-API-DISABLED': return 'В проекте Google Cloud не включён Google Drive API. См. GOOGLE_SETUP.md, шаг 2';
    case 'E-QUOTA-DRIVE': return 'На Google Диске закончилось место. Освободи место и повтори пуш';
    case 'E-RATE': return 'Google просит подождать. Повтори через минуту';
    case 'E-SERVER': return `Google Диск временно недоступен (код ${e.status || '5xx'}). Изменения сохранены на устройстве`;
    case 'E-DB-MISSING': return 'Файл базы на Диске не найден (удалён или в корзине)';
    case 'E-DB-CORRUPT': return `Файл базы на Диске повреждён: ${e.message}. Ничего не перезаписано`;
    case 'E-MIGRATION': return `Не удалось обновить формат данных: ${e.message}. Данные не изменены`;
    case 'E-RACE': return 'Не удалось записать: база на Диске одновременно меняется с другого устройства. Повтори пуш через минуту. Ничего не потеряно';
    case 'E-BROWSER': return e.message;
    case 'E-HTTP': return `Ошибка Google Диска: ${e.message}`;
    case 'E-NOT-FOUND': return `Файл на Диске не найден: ${e.message}`;
    default: return `Что-то пошло не так: ${e?.message || e}. Данные на устройстве не пострадали`;
  }
}

/** Ошибки, которые не считаются «Ошибкой синхронизации» в индикаторе (у них своё состояние). */
export const SOFT_CODES = new Set(['E-OFFLINE', 'E-AUTH-EXPIRED', 'E-READONLY']);
