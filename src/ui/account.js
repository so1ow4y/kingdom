// Выход из Google — общий для «Настроек» и меню аккаунта в доке (обновление 0.10).

import { store, ask, showSnackbar, setUi, totalDirty } from '../store/appState.js';
import * as A from '../store/actions.js';
import { countLabel } from '../core/plural.js';
import { logout } from '../google/auth.js';

export async function confirmLogout() {
  const n = totalDirty();
  const buttons = [{ label: 'Отмена', value: null }, { label: 'Выйти', value: 'logout', kind: 'primary' }];
  if (!n) buttons.push({ label: 'Выйти и удалить данные с устройства', value: 'wipe', kind: 'danger' });
  const v = await ask({
    title: 'Выйти из Google?',
    text: n
      ? `Локальные данные останутся на устройстве. Есть ${countLabel(n, ['непушнутое изменение', 'непушнутых изменения', 'непушнутых изменений'])} — удалить данные с устройства можно только после пуша.`
      : 'Локальные данные останутся на устройстве, если не выбрать удаление. На Диске всё сохранится.',
    buttons,
  });
  if (!v) return;
  await logout();
  if (v === 'wipe') A.clearLocalData();
  else {
    setUi({});
    showSnackbar('Выход выполнен');
  }
}
