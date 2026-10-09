// Точка входа: ответ Google из адреса → тема → локальная база → интерфейс → Service Worker → синхронизация.
// Crimson Harvest (0.11): в одном приложении — Chronicle (задачи) и Feast (калории).

import { html, render } from './ui/html.js';
import { App } from './ui/app.js';
import { applyTheme } from './ui/theme.js';
import { applyScheme } from './ui/prefs.js';
import { navigate } from './ui/router.js';
import { bootstrap } from './store/bootstrap.js';
import { startNowTicker } from './store/appState.js';
import { registerSW } from './pwa/swClient.js';
import { takeOAuthFragment } from './google/auth.js';
import { startSync } from './sync/syncEngine.js';
import { startNotifier } from './ui/notifier.js';
import { runRetention } from './ui/components/DataSettings.js';
import { purgeOldEntries, purgeFeastTrash, purgeHistory } from './store/feastActions.js';
import { tr } from './core/i18n.js';

// Самым первым: забрать токен из адреса и убрать его оттуда (до роутера и до любых логов).
const oauth = takeOAuthFragment();
applyTheme();
applyScheme();
const root = document.getElementById('app');

function showFatal(e) {
  console.error(e);
  root.textContent = '';
  const box = document.createElement('div');
  box.className = 'fatal';
  const h = document.createElement('h1');
  h.textContent = tr('Не удалось запустить Kingdom');
  const p = document.createElement('p');
  p.textContent = tr('Не открылось локальное хранилище браузера: {p0}. ', { p0: e?.message || e })
    + tr('Проверь, что сайт открыт не в режиме инкогнито и что браузеру хватает места. Данные на устройстве не тронуты.');
  const b = document.createElement('button');
  b.className = 'btn primary';
  b.textContent = tr('Перезагрузить');
  b.onclick = () => location.reload();
  box.append(h, p, b);
  root.append(box);
}

try {
  await bootstrap();
  startNowTicker();
  root.textContent = '';
  render(html`<${App}/>`, root);
  registerSW();
  startNotifier();
  // Лимит выполненных (обновление 0.5): чистка после запуска, не мешая первой отрисовке и синхронизации
  setTimeout(() => runRetention().catch((e) => console.warn('retention', e)), 4000);
  // Feast (0.11): лимит записей дневника — старые дни уходят в сводки
  setTimeout(() => purgeOldEntries().catch((e) => console.warn('feast retention', e)), 6000);
  // 0.14: корзина старше срока и история дневника старше срока хранения (если задан)
  setTimeout(() => purgeFeastTrash().then(() => purgeHistory()).catch((e) => console.warn('feast trash/history', e)), 7000);
  navigator.storage?.persist?.().catch(() => {});
  startSync(oauth, { navigate: (route) => navigate(route, { replace: true }) }).catch((e) => console.error('startSync', e));
} catch (e) {
  showFatal(e);
}
