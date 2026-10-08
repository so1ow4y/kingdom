// Единственное место для настроек, которые не зависят от пользователя.
import { tr } from './core/i18n.js';

// Google (используется с этапа 2). Client ID не секретный.
export const GOOGLE_CLIENT_ID = '296129493975-miqcedk33ufcll0dshtm34hrssttktdm.apps.googleusercontent.com';
// Смена scope (например, на 'https://www.googleapis.com/auth/drive' для бота) — правка только здесь. См. docs/TZ.md §17.3.
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];

export const APP_NAME = 'lifetasks-web';
export const DB_NAME = 'lifetasks';
// Feast (0.11, счётчик калорий): своя локальная база и своя папка на Диске
export const FEAST_DB_NAME = 'lifetasks-feast';

// Ограничения приложения. Экран «Настройки → Ограничения и хранилище» показывает их отсюда же.
export const LIMITS = {
  titleMax: 500,
  noteMax: 20000,
  noteCounterFrom: 18000,
  listNameMax: 40,
  focusMax: 3,
  maxDepth: 4, // уровней вложенности задач
  remindersMax: 10, // напоминаний у задачи
  reminderOffsetMax: 10080, // «за … до» — не больше недели (минуты)
  nagMin: 1, // «Повторять, пока не отмечу» — от 1 минуты
  nagMax: 1440,
  presetsMax: 12, // быстрых вариантов в настройках
};

// Медиа (обновление 0.5; docs/TZ.md §10, §22). Настраиваемые значения — в настройках (DATA_FORMAT §13), здесь — общие правила.
export const MEDIA = {
  autoDownloadMaxBytes: 5 * 1024 * 1024, // картинки и голос до 5 МБ скачиваются сами при открытии задачи
  resumableFromBytes: 5 * 1024 * 1024, // больше — resumable upload
  downloadConcurrency: 3,
  bigFileWarnMB: 20, // перед загрузкой файла больше — предупреждение о размере
  cacheLimitMBDefault: 300, // кэш медиа на устройстве (настройка устройства)
  voiceMaxSecondsRange: [30, 3600],
  attachmentMaxMBRange: [1, 500],
};

// Хранение выполненных задач (обновление 0.5, §2 задания): лимит в настройках, здесь — рамки.
export const RETENTION = {
  completedDefault: 1000,
  completedMin: 100,
  completedMax: 10000,
  keepRecentDays: 7, // выполненные за последние 7 дней не удаляются никогда
};

// Feast (0.11): лимит записей дневника — старые дни удаляются, их итоги остаются сводками (DATA_FORMAT §19).
export const FEAST_RETENTION = {
  entryDefault: 5000,
  entryMin: 500,
  entryMax: 50000,
  keepRecentDays: 30, // записи последних 30 дней не удаляются никогда
};

export const DRIVE_QUOTA_URL = 'https://console.cloud.google.com/apis/api/drive.googleapis.com/quotas';
export const DRIVE_STORAGE_URL = 'https://drive.google.com/settings/storage';

export const TIMINGS = {
  snackbarMs: 5000,
  completeDelayMs: 1500,      // сколько выполненная задача видна зачёркнутой перед уходом
  textSaveDebounceMs: 400,
  swUpdateCheckMinMs: 30 * 60 * 1000,
};

export const SOON_DEADLINE_DAYS = 3;
export const TOMBSTONE_TTL_DAYS = 365;
export const BACKUPS_KEEP = 20; // бэкапов вида «push» на Диске (pre-migration-* и pre-restore-* не удаляются)

// Фиксированные id (docs/DATA_FORMAT.md §5.1, §5.2).
export const SETTINGS_ID = '00000000-0000-7000-8000-000000000001';
export const DEFAULTS_DEVICE_ID = '00000000-0000-7000-8000-000000000000';
export const DEFAULTS_CREATED_AT = '2026-01-01T00:00:00.000Z';
export const DEFAULT_LISTS = [
  { id: '00000000-0000-7000-8000-000000000101', name: tr('Пересдача'), emoji: '📚', color: '#E53935', order: 'a0' },
  { id: '00000000-0000-7000-8000-000000000102', name: tr('Универ'), emoji: '🎓', color: '#1E88E5', order: 'a1' },
  { id: '00000000-0000-7000-8000-000000000103', name: 'YouTube', emoji: '🎬', color: '#D81B60', order: 'a2' },
  { id: '00000000-0000-7000-8000-000000000104', name: tr('Игра'), emoji: '🎮', color: '#8E24AA', order: 'a3' },
  { id: '00000000-0000-7000-8000-000000000105', name: tr('Дом'), emoji: '🏠', color: '#43A047', order: 'a4' },
];
export const CHORES_LIST_ID = '00000000-0000-7000-8000-000000000105';

export const LIST_COLORS = [
  { hex: '#E53935', name: tr('Красный') },
  { hex: '#FB8C00', name: tr('Оранжевый') },
  { hex: '#FDD835', name: tr('Жёлтый') },
  { hex: '#43A047', name: tr('Зелёный') },
  { hex: '#00897B', name: tr('Бирюзовый') },
  { hex: '#1E88E5', name: tr('Синий') },
  { hex: '#3949AB', name: tr('Индиго') },
  { hex: '#8E24AA', name: tr('Фиолетовый') },
  { hex: '#D81B60', name: tr('Розовый') },
  { hex: '#6D4C41', name: tr('Коричневый') },
  { hex: '#757575', name: tr('Серый') },
  { hex: '#546E7A', name: tr('Графит') },
];

export const EMOJI_SUGGESTIONS = ['📚', '🎓', '🎬', '🎮', '🏠', '💼', '🛒', '🍳', '🧹', '💪', '🏃', '💰',
  '🎵', '✍️', '💡', '🧪', '🖥', '📱', '🎨', '📷', '✈️', '🐱', '❤️', '⭐'];
