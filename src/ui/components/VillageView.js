// Деревня на экране (обновление 0.7): холст низкого разрешения с пиксельными жителями.
//  • VillageHost — всегда в приложении: передаёт деревне покупки, настроение, фокус и тему; празднует выполненные задачи;
//    рисует деревню полосой на фоне (за карточками) и гостя, который иногда подходит к экрану и стучит.
//  • VillageCanvas mode="full" — экран «Деревня»: смотреть, листать, кликать по жителям, домам и фонарям.

import { html, useEffect, useRef, useMemo } from '../html.js';
import { store, notify } from '../../store/appState.js';
import * as G from '../../core/game.js';
import { ownedVillage, happiness, villageStyle, gemsEarned } from '../../core/village.js';
import { world, env, setEnv, configureVillage, setViewWidth, attachView } from '../../village/runtime.js';
import { drawVillage, drawVisitor } from '../../village/draw.js';
import { charHeight } from '../../village/puppets.js';
import { getPrefs, setPrefs, SCHEMES } from '../prefs.js';
import { useMedia } from '../hooks.js';
import { getFocus } from '../../store/focus.js';

const LEGACY = G.COSMETICS.filter((c) => c.legacy).map((c) => c.id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Включена ли деревня вообще (игровой режим). */
export const villageOn = () => !!store.data.settings?.gameEnabled;

/** Купленное старое оформление 0.6, которое теперь живёт в деревне. */
export function legacyOwned(data) {
  return new Set(LEGACY.filter((id) => G.ownsItem(data, id)));
}

/** Клик по жителю, фонарю или дому: реакция в мире. Возвращает то, что под точкой. */
export function interact(h) {
  if (!h) return null;
  if (h.type === 'actor') world.poke(h.actor);
  else if (h.type === 'lantern') setPrefs({ villageLightsOff: world.toggleLight(h.lantern.id) });
  else if (h.type === 'building') {
    const b = h.building;
    if (b.type.startsWith('house') || b.type === 'tavern' || b.type === 'tower' || b.type === 'windmill') {
      if (env.n > 0.3) setPrefs({ villageLightsOff: world.toggleLight(b.id) });
      world.burst(b.x + b.w - 7, b.ground + b.h, 'smoke', 4, 6);
    } else if (b.type === 'fountain') world.burst(b.x + 10, b.ground + 10, 'drop', 18, 30);
    else if (b.type.endsWith('mine')) world.burst(b.x + 14, b.ground + 6, b.type === 'gemmine' ? 'gem' : 'coin', 5, 24);
    else if (b.type === 'forge') world.burst(b.x + 17, b.ground + 5, 'spark', 10, 22);
  }
  return h;
}

export function VillageCanvas({ mode = 'backdrop', onPick = null }) {
  const wrap = useRef(null);
  const cv = useRef(null);
  const layer = useRef(null);
  const geo = useRef({ scale: 3, W: 0, H: 0, baseY: 0, horizon: 0, camX: 0 });
  const cam = useRef({ x: null, drag: null });
  const pick = useRef(onPick);
  pick.current = onPick;
  const full = mode === 'full';
  const scalePref = getPrefs().villageScale;

  useEffect(() => {
    const canvas = cv.current;
    const ctx = canvas.getContext('2d');
    const land = document.createElement('canvas');
    const lctx = land.getContext('2d');
    if (full) {
      env.fullViews++;
      notify();
    }
    const resize = () => {
      const r = wrap.current?.getBoundingClientRect();
      if (!r || !r.width) return;
      const big = getPrefs().villageScale === 'large';
      // полный вид — около 125 «пикселей» деревни по высоте (на узком экране деревню листают пальцем)
      const scale = (full ? Math.max(2, Math.round(r.height / 125)) : r.width < 600 ? 2 : 3) + (big ? 1 : 0);
      const W = Math.max(60, Math.ceil(r.width / scale));
      const H = Math.max(40, Math.ceil(r.height / scale));
      const baseY = H - (full ? 12 : 6);
      Object.assign(geo.current, { scale, W, H, baseY, horizon: baseY - (full ? 26 : 15) });
      canvas.width = land.width = W;
      canvas.height = land.height = H;
      canvas.style.width = W * scale + 'px';
      canvas.style.height = H * scale + 'px';
      setViewWidth(W, full);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap.current);
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
        const x = clamp((a.x - g.camX) * g.scale, 50, maxX - 50);
        const y = Math.max(20, (g.baseY - a.y - charHeight(a.kind) * a.u - 6) * g.scale);
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
      let camX = (world.W - g.W) / 2;
      if (world.W > g.W) {
        const span = world.W - g.W;
        if (full) {
          if (cam.current.x == null) cam.current.x = span / 2;
          cam.current.x = clamp(cam.current.x, 0, span);
          camX = cam.current.x;
        } else camX = span * (0.5 + 0.5 * Math.sin((world.t * Math.PI * 2) / 160));
      }
      g.camX = Math.round(camX);
      drawVillage(ctx, lctx, world, {
        W: g.W, H: g.H, camX: g.camX, baseY: g.baseY, horizon: g.horizon, phase: env.phase, n: env.n, style: env.style, letter: env.letter, mode,
      });
      updateBubbles();
    };
    const detach = attachView(draw);
    draw();
    const toWorld = (cx, cy) => {
      const r = canvas.getBoundingClientRect();
      const g = geo.current;
      return { wx: (cx - r.left) / g.scale + g.camX, wy: g.baseY - (cy - r.top) / g.scale, inside: cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom };
    };
    // Фон лежит под карточками: клики по пустому месту страницы долетают до жителей.
    const onDocClick = (e) => {
      if (full || e.defaultPrevented || !(e.target instanceof Element)) return;
      if (e.target.closest('button, a, input, textarea, select, label, summary, [role], [contenteditable], .card-block, .sheet, .overlay, .dock-wrap, .topbar, li')) return;
      const p = toWorld(e.clientX, e.clientY);
      if (p.inside) interact(world.hit(p.wx, p.wy));
    };
    if (!full) document.addEventListener('click', onDocClick);
    return () => {
      detach();
      ro.disconnect();
      if (!full) document.removeEventListener('click', onDocClick);
      if (full) {
        env.fullViews--;
        notify();
      }
      for (const el of bubbles.values()) el.remove();
    };
  }, [mode, scalePref]);

  if (!full) {
    return html`<div class="village-backdrop" ref=${wrap} aria-hidden="true"><canvas ref=${cv}></canvas><div class="village-layer" ref=${layer}></div></div>`;
  }
  const down = (e) => {
    cam.current.drag = { x0: e.clientX, cam0: cam.current.x ?? 0, moved: false, id: e.pointerId };
  };
  const move = (e) => {
    const d = cam.current.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = (e.clientX - d.x0) / geo.current.scale;
    if (Math.abs(dx) > 2 && !d.moved) {
      d.moved = true;
      cv.current.setPointerCapture?.(e.pointerId);
    }
    if (d.moved) cam.current.x = d.cam0 - dx;
  };
  const up = (e) => {
    const d = cam.current.drag;
    cam.current.drag = null;
    if (!d || d.moved) return;
    const r = cv.current.getBoundingClientRect();
    const g = geo.current;
    const h = interact(world.hit((e.clientX - r.left) / g.scale + g.camX, g.baseY - (e.clientY - r.top) / g.scale));
    pick.current?.(h);
  };
  const wheel = (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
      cam.current.x = (cam.current.x ?? 0) + (e.deltaX || e.deltaY) / geo.current.scale;
      e.preventDefault();
    }
  };
  return html`<div class="village-full" ref=${wrap}>
    <canvas ref=${cv} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${() => { cam.current.drag = null; }} onWheel=${wheel}
      aria-label="Деревня: нажми на жителя, дом или фонарь; потяни, чтобы прокрутить" role="img"></canvas>
    <div class="village-layer" ref=${layer}></div>
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

/** Деревня в каркасе приложения. route — текущий экран (на экране «Деревня» фон не нужен). */
export function VillageHost() {
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

  setEnv({
    mode, dark, motion, style: villageStyle(scheme),
    letter: p.letter || (dark ? SCHEMES[scheme].dark : SCHEMES[scheme].light),
  });
  useEffect(() => {
    configureVillage({ owned, legacy, mood: mood.value, focus: !!focus, visitors: on && motion && p.visitors !== false, lightsOff: p.villageLightsOff || [] });
  });
  // выполненная задача — праздник в деревне (и монетки из домика)
  useEffect(() => {
    if (prev.current && on && exp > prev.current.exp) world.celebrate(exp - prev.current.exp, Math.max(0, gems - prev.current.gems));
    prev.current = { exp, gems };
  }, [exp, gems]);

  if (!on) return null;
  return html`
    ${p.villageBackdrop !== false && env.fullViews === 0 ? html`<${VillageCanvas} mode="backdrop"/>` : null}
    ${motion && p.visitors !== false ? html`<${VillageVisitor}/>` : null}`;
}
