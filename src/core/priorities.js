// Приоритеты (обновление 0.3, п. 2.6/2.9). Базовые приоритеты имеют фиксированные id —
// два устройства, начавшие офлайн, не создадут дублей (как списки по умолчанию).

import { tr } from './i18n.js';

export const PRIORITY_NONE_ID = '00000000-0000-7000-8000-000000000200';

export const DEFAULT_PRIORITIES = [
  { id: PRIORITY_NONE_ID, name: tr('Без приоритета'), color: '#9E9E9E', coins: 1, order: 'a0', legacyRank: 0 },
  { id: '00000000-0000-7000-8000-000000000201', name: tr('Низкий'), color: '#1E88E5', coins: 2, order: 'a1', legacyRank: 1 },
  { id: '00000000-0000-7000-8000-000000000202', name: tr('Средний'), color: '#FB8C00', coins: 5, order: 'a2', legacyRank: 2 },
  { id: '00000000-0000-7000-8000-000000000203', name: tr('Высокий'), color: '#E53935', coins: 10, order: 'a3', legacyRank: 3 },
  { id: '00000000-0000-7000-8000-000000000204', name: tr('Критический'), color: '#8E24AA', coins: 20, order: 'a4', legacyRank: 4 },
];

// 0.12.5: базовые приоритеты, которые не переименовывали, показываются на языке интерфейса
const DEFAULT_RU = {
  [PRIORITY_NONE_ID]: 'Без приоритета',
  '00000000-0000-7000-8000-000000000201': 'Низкий',
  '00000000-0000-7000-8000-000000000202': 'Средний',
  '00000000-0000-7000-8000-000000000203': 'Высокий',
  '00000000-0000-7000-8000-000000000204': 'Критический',
};
/** Название приоритета для показа. */
export const priorityLabel = (p) => (p && DEFAULT_RU[p.id] === p.name ? tr(p.name) : p?.name || '');

/** id базового приоритета по числу из формата v1 (0…3). */
export function priorityIdFromLegacy(rank) {
  const p = DEFAULT_PRIORITIES.find((x) => x.legacyRank === rank);
  return p ? p.id : PRIORITY_NONE_ID;
}
