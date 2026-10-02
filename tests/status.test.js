import { test, assert } from './runner.js';
import { indicator } from '../src/sync/status.js';

const base = { readOnly: false, phase: null, lastError: null, needAuth: false, offline: false, remoteNewer: false, dirty: 0 };
const ind = (patch) => indicator({ ...base, ...patch });

test('индикатор: тексты восьми состояний (TZ §5.3)', () => {
  assert.equal(ind({}).text, 'Всё запушено');
  assert.equal(ind({ dirty: 3 }).text, '3 непушнутых изменения');
  assert.equal(ind({ dirty: 1 }).text, '1 непушнутое изменение');
  assert.equal(ind({ remoteNewer: true }).text, 'На Диске есть версия новее');
  assert.equal(ind({ offline: true, dirty: 5 }).text, 'Нет сети · 5 непушнутых');
  assert.equal(ind({ needAuth: true, dirty: 2 }).text, 'Нужен вход · 2 непушнутых');
  assert.equal(ind({ lastError: { code: 'E-SERVER' } }).text, 'Ошибка синхронизации');
  assert.equal(ind({ phase: 'push' }).text, 'Отправка…');
  assert.equal(ind({ phase: 'pull' }).text, 'Загрузка…');
  assert.equal(ind({ readOnly: true }).text, 'Обнови приложение');
});

test('индикатор: приоритет состояний', () => {
  assert.equal(ind({ readOnly: true, phase: 'push', needAuth: true }).key, 'readonly');
  assert.equal(ind({ phase: 'pull', lastError: {}, offline: true }).key, 'busy');
  assert.equal(ind({ lastError: {}, needAuth: true }).key, 'error');
  assert.equal(ind({ needAuth: true, offline: true }).key, 'auth');
  assert.equal(ind({ offline: true, remoteNewer: true }).key, 'offline');
  assert.equal(ind({ remoteNewer: true, dirty: 4 }).key, 'newer');
});
