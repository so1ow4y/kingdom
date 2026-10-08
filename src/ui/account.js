// Выход из Google — общий для «Настроек» и меню аккаунта в доке (обновление 0.10).

import { store, ask, showSnackbar, setUi, totalDirty } from '../store/appState.js';
import * as A from '../store/actions.js';
import { countLabel } from '../core/plural.js';
import { logout } from '../google/auth.js';
import { tr } from '../core/i18n.js';

export async function confirmLogout() {
  const n = totalDirty();
  const buttons = [{ label: tr('Отмена'), value: null }, { label: tr('Выйти'), value: 'logout', kind: 'primary' }];
  if (!n) buttons.push({ label: tr('Выйти и удалить данные с устройства'), value: 'wipe', kind: 'danger' });
  const v = await ask({
    title: tr('Выйти из Google?'),
    text: n
      ? tr('Локальные данные останутся на устройстве. Есть {p0} — удалить данные с устройства можно только после пуша.', { p0: countLabel(n, ['непушнутое изменение', 'непушнутых изменения', 'непушнутых изменений']) })
      : tr('Локальные данные останутся на устройстве, если не выбрать удаление. На Диске всё сохранится.'),
    buttons,
  });
  if (!v) return;
  await logout();
  if (v === 'wipe') A.clearLocalData();
  else {
    setUi({});
    showSnackbar(tr('Выход выполнен'));
  }
}
