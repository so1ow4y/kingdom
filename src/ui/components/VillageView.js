// Деревня на экране (обновление 0.7, полный фон — 0.7.1): холст низкого разрешения во весь экран за приложением.
//  • На вкладках деревня приглушена (затемнение настраивается), чтобы не отвлекала; по пустым местам можно нажимать.
//  • На экране «Деревня» — без затемнения: смотреть, листать, нажимать на жителей, дома, фонари.
//  • Гость у экрана: житель выходит из леса в нижнем углу и стучит по «стеклу».

import { html, useEffect, useRef, useMemo } from '../html.js';
import { store, notify } from '../../store/appState.js';
import * as G from '../../core/game.js';
import { ownedVillage, happiness, villageStyle, gemsEarned } from '../../core/village.js';
import { world, env, setEnv, configureVillage, setViewWidth, attachView } from '../../village/runtime.js';
import { VillageRenderer, drawVisitor, flavorOf } from '../../village/draw.js';
import { charHeight } from '../../village/puppets.js';
import { getPrefs, setPrefs, SCHEMES } from '../prefs.js';
import { useMedia, readLocal } from '../hooks.js';
import { getFocus } from '../../store/focus.js';

const LEGACY = G.COSMETICS.filter((c) => c.legacy).map((c) => c.id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Включена ли деревня вообще (игровой режим). */
export const villageOn = () => !!store.data.settings?.gameEnabled;

/** Купленное старое оформление 0.6, которое теперь живёт в деревне. */
export function legacyOwned(data) {
  return new Set(LEGACY.filter((id) => G.ownsItem(data, id)));
}

/** Что выбрано нажатием на экране «Деревня» (житель, постройка, фонарь) — для карточки внизу. */
export const villageSel = { current: null };
export function selectInVillage(h) {
  villageSel.current = h && h.type ? h : null;
  notify();
}

/** Нажатие на жителя, фонарь или дом: реакция в мире. Возвращает то, что под точкой. */
export function interact(h) {
  if (!h) return null;
  if (h.type === 'actor') world.poke(h.actor);
  else if (h.type === 'lantern') setPrefs({ villageLightsOff: world.toggleLight(h.lantern.id) });
  else if (h.type === 'building') {
    const b = h.building;
    if (b.type.startsWith('house') || b.type === 'tavern' || b.type === 'tower' || b.type === 'windmill') {
      if (env.n > 0.3) setPrefs({ villageLightsOff: world.toggleLight(b.id) });
      const c = world.chimney(b);
      if (c) world.burst(c.x, c.y, c.z, 'smoke', 4, 6);
    } else if (b.type === 'fountain') world.burst(b.x + b.w / 2, b.y + b.h * 0.6, 14, 'drop', 22, 34);
    else if (b.type.endsWith('mine')) world.burst(b.door.x, b.door.y - 4, 8, b.type === 'gemmine' ? 'gem' : 'coin', 6, 26);
    else if (b.type === 'forge') world.burst(b.x + b.w * 0.7, b.base - 2, 8, 'spark', 12, 24);
  }
  return h;
}

/** Масштаб «пикселя» деревни: экран видит около 260 пикселей карты по высоте и не больше самой карты. */
function pickScale(w, h, big) {
  let s = clamp(Math.round(Math.min(h / 260, w / 200)), 2, 5) + (big ? 1 : 0);
  while (s < 8 && (Math.ceil(w / s) > world.W || Math.ceil(h / s) > world.H)) s++;
  return s;
}

/** Деревня во весь экран за приложением. interactive — экран «Деревня» (клики и прокрутка прямо по холсту). */
export function VillageBackdrop({ interactive = false, dim = 0 }) {
  const wrap = useRef(null);
  const cv = useRef(null);
  const layer = useRef(null);
  const geo = useRef({ scale: 3, W: 0, H: 0, camX: 0, camY: 0 });
  const cam = useRef({ user: null, drag: null });
  const mode = useRef(interactive);
  mode.current = interactive;
  const scalePref = getPrefs().villageScale;

  useEffect(() => {
    const canvas = cv.current;
    const ctx = canvas.getContext('2d');
    const renderer = new VillageRenderer();
    const resize = () => {
      const iw = window.innerWidth;
      const ih = window.innerHeight;
      const scale = pickScale(iw, ih, getPrefs().villageScale === 'large');
      const W = Math.ceil(iw / scale);
      const H = Math.ceil(ih / scale);
      const g = geo.current;
      if (g.scale === scale && g.W === W && g.H === H) return;
      Object.assign(g, { scale, W, H });
      canvas.width = W;
      canvas.height = H;
      canvas.style.width = W * scale + 'px';
      canvas.style.height = H * scale + 'px';
      setViewWidth(W);
    };
    resize();
    window.addEventListener('resize', resize);
    const bubbles = new Map();
    const updateBubbles = () => {
      const g = geo.current;
      const seen = new Set();
      const maxX = g.W * g.scale;
      for (const a of world.actors) {
        if (!a.say || a.hidden) continue;
        seen.add(a.id);
        let el = bubbles.get(a.id);
        if (!el) {
          el = document.createElement('div');
          el.className = 'village-bubble';
          layer.current.appendChild(el);
          bubbles.set(a.id, el);
        }
        if (el.textContent !== a.say) el.textContent = a.say;
        const x = clamp((a.x - g.camX) * g.scale, 60, maxX - 60);
        const y = Math.max(24, (a.y - a.z - charHeight(a.kind) * a.u - 6 - g.camY) * g.scale);
        el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
      }
      for (const [id, el] of bubbles) {
        if (!seen.has(id)) {
          el.remove();
          bubbles.delete(id);
        }
      }
    };
    const draw = () => {
      const g = geo.current;
      if (!g.W) return;
      const spanX = world.W - g.W;
      const spanY = world.H - g.H;
      let camX;
      let camY;
      if (cam.current.user && mode.current) {
        camX = clamp(cam.current.user.x, Math.min(0, spanX / 2), Math.max(0, spanX));
        camY = clamp(cam.current.user.y, Math.min(0, spanY / 2), Math.max(0, spanY));
        cam.current.user = { x: camX, y: camY };
      } else {
        // сама плавно гуляет вокруг площади, не уходя за жилую часть
        const v = world.map.village;
        const c = world.map.spots.plaza;
        const rx = Math.max(0, (v.x1 - v.x0 - g.W) / 2);
        const ry = Math.max(0, (v.y1 - v.y0 - g.H) / 2);
        camX = c.x - g.W / 2 + Math.sin((world.t * Math.PI * 2) / 240) * rx;
        camY = c.y - 18 - g.H / 2 + Math.sin((world.t * Math.PI * 2) / 330) * ry;
        camX = spanX <= 0 ? spanX / 2 : clamp(camX, 0, spanX);
        camY = spanY <= 0 ? spanY / 2 : clamp(camY, 0, spanY);
      }
      g.camX = Math.round(camX);
      g.camY = Math.round(camY);
      renderer.render(ctx, world, { W: g.W, H: g.H, camX: g.camX, camY: g.camY, phase: env.phase, n: env.n, style: env.style, letter: env.letter });
      updateBubbles();
    };
    const detach = attachView(draw);
    draw();
    const toWorld = (cx, cy) => {
      const g = geo.current;
      return { wx: cx / g.scale + g.camX, wy: cy / g.scale + g.camY };
    };
    // На вкладках фон под карточками: клики по пустому месту страницы долетают до жителей.
    const onDocClick = (e) => {
      if (mode.current || e.defaultPrevented || !(e.target instanceof Element)) return;
      if (e.target.closest('button, a, input, textarea, select, label, summary, [role], [contenteditable], .card-block, .sheet, .overlay, .dock-wrap, .topbar, li, .task-row, .village-visitor')) return;
      const p = toWorld(e.clientX, e.clientY);
      interact(world.hit(p.wx, p.wy));
    };
    document.addEventListener('click', onDocClick);
    // Экран «Деревня»: тянуть — двигать карту, нажать — житель/дом/фонарь, наведение — курсор-рука.
    const down = (e) => {
      if (!mode.current) return;
      cam.current.drag = { x0: e.clientX, y0: e.clientY, cx: geo.current.camX, cy: geo.current.camY, moved: false, id: e.pointerId };
    };
    const move = (e) => {
      if (!mode.current) return;
      const d = cam.current.drag;
      if (d && d.id === e.pointerId) {
        const dx = (e.clientX - d.x0) / geo.current.scale;
        const dy = (e.clientY - d.y0) / geo.current.scale;
        if (Math.hypot(dx, dy) > 2 && !d.moved) {
          d.moved = true;
          canvas.setPointerCapture?.(e.pointerId);
        }
        if (d.moved) cam.current.user = { x: d.cx - dx, y: d.cy - dy };
        return;
      }
      if (e.pointerType === 'mouse') {
        const p = toWorld(e.clientX, e.clientY);
        canvas.style.cursor = world.hit(p.wx, p.wy) ? 'pointer' : 'grab';
      }
    };
    const up = (e) => {
      const d = cam.current.drag;
      cam.current.drag = null;
      if (!mode.current || !d || d.moved) return;
      const p = toWorld(e.clientX, e.clientY);
      selectInVillage(interact(world.hit(p.wx, p.wy)));
    };
    const wheel = (e) => {
      if (!mode.current) return;
      const g = geo.current;
      const cur = cam.current.user || { x: g.camX, y: g.camY };
      const sx = e.shiftKey ? e.deltaY : e.deltaX;
      const sy = e.shiftKey ? 0 : e.deltaY;
      cam.current.user = { x: cur.x + sx / g.scale, y: cur.y + sy / g.scale };
      e.preventDefault();
    };
    const cancel = () => {
      cam.current.drag = null;
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      detach();
      window.removeEventListener('resize', resize);
      document.removeEventListener('click', onDocClick);
      for (const el of bubbles.values()) el.remove();
    };
  }, [scalePref]);

  useEffect(() => {
    if (!interactive) {
      cam.current.user = null; // на вкладках камера снова гуляет сама
      if (villageSel.current) villageSel.current = null;
    }
  }, [interactive]);

  return html`<div class=${'village-bg' + (interactive ? ' interactive' : '')} ref=${wrap} aria-hidden=${interactive ? 'false' : 'true'}>
    <canvas ref=${cv} role=${interactive ? 'img' : undefined}
      aria-label=${interactive ? 'Деревня: нажми на жителя, дом или фонарь; потяни, чтобы прокрутить' : undefined}></canvas>
    <div class="village-layer" ref=${layer}></div>
    <div class="village-dim" style=${{ opacity: dim }}></div>
  </div>`;
}

/** Гость у экрана: житель вышел из деревни в лес, подошёл к «стеклу» и стучит. На него можно нажать. */
export function VillageVisitor() {
  const box = useRef(null);
  const cv = useRef(null);
  const bubble = useRef(null);
  const hit = useRef(null);
  useEffect(() => {
    const canvas = cv.current;
    const ctx = canvas.getContext('2d');
    const W = 30;
    const H = 40;
    const S = 6; // гость ближе к «стеклу» — крупнее жителей деревни (размер холста в CSS: 180 × 240)
    canvas.width = W;
    canvas.height = H;
    const draw = () => {
      const v = world.visitor;
      const el = box.current;
      if (!el) return;
      if (!v) {
        if (el.dataset.on) {
          delete el.dataset.on;
          ctx.clearRect(0, 0, W, H);
        }
        return;
      }
      el.dataset.on = '1';
      el.dataset.side = v.side < 0 ? 'left' : 'right';
      const r = drawVisitor(ctx, world, { W, H, u: v.u, n: env.n, style: env.style });
      if (!r) return;
      const hb = hit.current;
      hb.style.left = (r.x - r.w) * S + 'px';
      hb.style.top = r.top * S + 'px';
      hb.style.width = r.w * 2 * S + 'px';
      hb.style.height = (r.y - r.top) * S + 'px';
      const b = bubble.current;
      if (v.say) {
        if (b.textContent !== v.say) b.textContent = v.say;
        b.hidden = false;
        b.style.transform = `translate(${clamp(r.x * S, 40, W * S - 20)}px, ${Math.max(0, r.top * S - 34)}px) translate(-50%, -100%)`;
      } else b.hidden = true;
    };
    return attachView(draw, { always: false });
  }, []);
  return html`<div class="village-visitor" ref=${box}>
    <canvas ref=${cv} aria-hidden="true"></canvas>
    <div class="village-bubble visitor-bubble" ref=${bubble} hidden></div>
    <button class="visitor-hit" ref=${hit} aria-label="Погладить гостя" onClick=${() => world.pokeVisitor()}></button>
  </div>`;
}

/** Деревня в каркасе приложения. route — текущий экран (на «Деревне» без затемнения, в «Магазине → Деревня» — слабее). */
export function VillageHost({ route }) {
  const p = getPrefs();
  const data = store.data;
  const on = villageOn();
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  const sysDark = useMedia('(prefers-color-scheme: dark)');
  const tz = data.settings?.timeZone || 'UTC';
  const owned = useMemo(() => ownedVillage(data), [store.version]);
  const legacy = useMemo(() => legacyOwned(data), [store.version]);
  const mood = useMemo(() => happiness(data, tz, store.now.today), [store.version, store.now.today]);
  const exp = useMemo(() => G.experience(data), [store.version]);
  const gems = useMemo(() => gemsEarned(data), [store.version]);
  const prev = useRef(null);
  const focus = getFocus();
  const theme = document.documentElement.dataset.theme;
  const dark = theme ? theme === 'dark' : sysDark;
  const scheme = p.scheme && SCHEMES[p.scheme] ? p.scheme : 'indigo';
  const daynight = owned.has('v:daynight');
  const mode = daynight ? p.dayMode || 'theme' : 'theme';
  const motion = p.decorMotion !== false && !reduced;
  const full = route?.name === 'village';
  const shopVillage = route?.name === 'shop' && readLocal('shopTab', 'rewards') === 'village';
  const dimPref = Number.isFinite(p.villageDim) ? p.villageDim : 0.55;
  const dim = full ? 0 : shopVillage ? Math.min(dimPref, 0.3) : dimPref;

  setEnv({
    mode, dark, motion, dimmed: dim > 0.3, style: villageStyle(scheme),
    letter: p.letter || (dark ? SCHEMES[scheme].dark : SCHEMES[scheme].light),
  });
  useEffect(() => {
    configureVillage({ owned, legacy, flavor: flavorOf(villageStyle(scheme)), mood: mood.value, focus: !!focus, visitors: on && motion && p.visitors !== false, lightsOff: p.villageLightsOff || [] });
  });
  // выполненная задача — праздник в деревне (и монетки из домика)
  useEffect(() => {
    if (prev.current && on && exp > prev.current.exp) world.celebrate(exp - prev.current.exp, Math.max(0, gems - prev.current.gems));
    prev.current = { exp, gems };
  }, [exp, gems]);

  if (!on) return null;
  return html`
    ${full || p.villageBackdrop !== false ? html`<${VillageBackdrop} interactive=${full} dim=${dim}/>` : null}
    ${motion && p.visitors !== false ? html`<${VillageVisitor}/>` : null}`;
}
