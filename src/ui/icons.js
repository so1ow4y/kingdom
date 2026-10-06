// Иконки — инлайновый SVG, цвет наследуется (currentColor).

import { html } from './html.js';

const PATHS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 5l-7 7 7 7',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1.5 2.5h5L16 13h5',
  lists: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  dots: 'M12 5h.01M12 12h.01M12 19h.01',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  flag: 'M5 21V4h12l-2 4 2 4H5',
  trash: 'M4 7h16M10 11v6M14 11v6M9 7V4h6v3M6 7l1 13h10l1-13',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  settings: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  clock: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  upload: 'M12 16V5M7 10l5-5 5 5M5 19h14',
  ok: 'M20 6L9 17l-5-5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  restore: 'M4 12a8 8 0 108-8 8 8 0 00-6.3 3M4 4v4h4',
  list: 'M4 6h16M4 12h16M4 18h10',
  sync: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5',
  warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  key: 'M8 15a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM11 12h10M17 12v4M20 12v3',
  offline: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.8M19 13a10 10 0 0 0-2.6-1.9M2 9a15 15 0 0 1 4-2.6M22 9a15 15 0 0 0-10-3.9M12 20h.01',
  download: 'M12 5v11M7 11l5 5 5-5M5 19h14',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  shop: 'M4 8h16l-1.5 11h-13zM8 8V6a4 4 0 0 1 8 0v2',
  coin: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v10M9 9.5c0-1 1.3-1.5 3-1.5s3 .7 3 1.7-1 1.3-3 1.8-3 .8-3 1.8 1.3 1.7 3 1.7 3-.5 3-1.5',
  bell: 'M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20a2 2 0 004 0',
  village: 'M2 20h20M4 20v-8l5-4 5 4v8M14 20v-6l4-3 3 3v6M8 20v-4h2v4M17 4l1 2 2 .3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1L14 6.3l2-.3z',
  focus: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM12 11.5v1M12 2v3M12 19v3M2 12h3M19 12h3',
  pause: 'M9 6v12M15 6v12',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 01-4 4H4',
  play: 'M8 5.5v13l10.5-6.5z',
  move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  zoomout: 'M10.5 4a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM15.5 15.5L20 20M7.5 10.5h6',
};

export function Icon({ name, size = 22, filled = false, className = '' }) {
  if (name === 'star') {
    return html`<svg class=${'icon ' + className} width=${size} height=${size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"
        fill=${filled ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    </svg>`;
  }
  const d = PATHS[name] || PATHS.dots;
  return html`<svg class=${'icon ' + className} width=${size} height=${size} viewBox="0 0 24 24" aria-hidden="true"
    fill="none" stroke="currentColor" stroke-width=${['more', 'dots', 'grip'].includes(name) ? 3 : 2}
    stroke-linecap="round" stroke-linejoin="round"><path d=${d}/></svg>`;
}
