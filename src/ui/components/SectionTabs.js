// Вкладки раздела из нескольких экранов (обновление 0.10): «Прогресс» — деревня, аналитика, магазин;
// «Архив и корзина» — выполненные и корзина. Как вкладки «Безопасности» в license-store (TabsList/TabsTrigger):
// у каждой вкладки свой адрес, поэтому «Назад» в браузере возвращает на прошлую вкладку.

import { html } from '../html.js';
import { Icon } from '../icons.js';
import { navigate } from '../router.js';
import { sectionTabs, isTargetActive } from '../nav.js';
import { shortcutText } from '../keys.js';

export function SectionTabs({ route }) {
  const s = sectionTabs(route.name);
  if (!s || s.items.length < 2) return null;
  const onKey = (e) => {
    // стрелки — по вкладкам, как у Radix Tabs
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = s.items.findIndex((it) => isTargetActive(route, it));
    const next = s.items[(i + (e.key === 'ArrowRight' ? 1 : s.items.length - 1)) % s.items.length];
    e.preventDefault();
    e.stopPropagation();
    navigate(next.to, { replace: true });
    setTimeout(() => document.querySelector('.section-tabs [aria-selected="true"]')?.focus(), 0);
  };
  return html`
    <div class="section-tabs" role="tablist" aria-label=${s.title} onKeyDown=${onKey}>
      ${s.items.map((it) => {
        const on = isTargetActive(route, it);
        const kbd = it.key ? shortcutText(it.key) : '';
        return html`
          <button type="button" role="tab" key=${it.to} aria-selected=${on} tabIndex=${on ? 0 : -1}
            class=${'section-tab' + (on ? ' active' : '')} title=${kbd ? `${it.title} · ${kbd}` : it.title}
            onClick=${() => !on && navigate(it.to)}>
            <${Icon} name=${it.icon} size=${16}/><span>${it.title}</span>
            ${it.count ? html`<span class="tab-count">${it.count}</span>` : null}
          </button>`;
      })}
    </div>`;
}
