// Деревня на экране (обновление 0.7, полный фон — 0.7.1): холст низкого разрешения во весь экран за приложением.
//  • На вкладках деревня приглушена (затемнение настраивается), чтобы не отвлекала; по пустым местам можно нажимать.
//  • На экране «Деревня» — без затемнения: смотреть, листать, нажимать на жителей, дома, фонари.
//  • Гость у экрана: житель выходит из леса в нижнем углу и стучит по «стеклу».
//  • 0.7.2: приближение («Авто» — чем больше деревня, тем дальше; ползунок, щипок, Ctrl + колесо), перестановка
//    объектов (тянуть «призрак» или нажать на клетку), выбор пустой клетки — «Построить здесь».

import { html, useEffect, useRef, useMemo } from '../html.js';
import { store, notify } from '../../store/appState.js';
import * as G from '../../core/game.js';
import { ownedVillage, villageObjects, happiness, villageStyle, gemsEarned } from '../../core/village.js';
import { world, env, setEnv, configureVillage, setViewSize, attachView } from '../../village/runtime.js';
import { canPlace, TILE, DRAW } from '../../village/map.js';
import { SPRITE_H } from '../../village/world.js';
import { VillageRenderer, drawVisitor, flavorOf } from '../../village/draw.js';
import { charHeight } from '../../village/puppets.js';
import { getPrefs, setPrefs, SCHEMES } from '../prefs.js';
import { useMedia, readLocal } from '../hooks.js';
import { getFocus } from '../../store/focus.js';
import { keepersOf } from '../../village/keepers.js';
import { skillsNow } from './Skills.js';
import { openTalk, closeTalk, talk, VillageDialog } from './VillageDialog.js';
import * as S from '../../core/selectors.js';
import * as M from '../../core/model.js';

const LEGACY = G.COSMETICS.filter((c) => c.legacy).map((c) => c.id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Включена ли деревня вообще (игровой режим). */
export const villageOn = () => !!store.data.settings?.gameEnabled;

/** Купленное старое оформление 0.6, которое теперь живёт в деревне. */
export function legacyOwned(data) {
  return new Set(LEGACY.filter((id) => G.ownsItem(data, id)));
}

/** Что выбрано нажатием на экране «Деревня» (житель, постройка, фонарь, пустая клетка) — для карточки внизу. */
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
  else if (h.type === 'scenery') {
    world.touchScenery(h);
    return null;
  } else if (h.type === 'building') {
    const b = h.building;
    if (b.type.startsWith('house')) {
      // 0.9: потревожили дом — жители выбегают
      world.disturb(b);
      const c = world.chimney(b);
      if (c) world.burst(c.x, c.y, c.z, 'smoke', 4, 6);
    } else if (b.type === 'tavern' || b.type === 'tower' || b.type === 'windmill') {
      if (env.n > 0.3) setPrefs({ villageLightsOff: world.toggleLight(b.id) });
    } else if (b.type === 'fountain') world.burst(b.x + b.w / 2, b.y + b.h * 0.6, 14, 'drop', 22, 34);
    else if (b.type === 'field') world.burst(b.x + b.w / 2, b.y + b.h / 2, 6, 'star', 10, 20);
    else if (b.type.endsWith('mine')) world.burst(b.door.x, b.door.y - 4, 8, b.type === 'gemmine' ? 'gem' : 'coin', 6, 26);
    else if (b.type === 'forge') world.burst(b.x + b.w * 0.7, b.base - 2, 8, 'spark', 12, 24);
  } else if (h.type === 'object') {
    const o = h.obj;
    if (o.place === 'bonfire') world.burst(o.x + o.w / 2, o.base - 6, 6, 'spark', 10, 22);
    else if (o.place === 'flowerbed' || o.place === 'tree') world.burst(o.x + o.w / 2, o.base - 4, 8, 'star', 5, 16);
  }
  return h;
}

// ---------- Приближение (0.7.2) ----------
// z — сколько CSS-пикселей на пиксель деревни. Холст рисуется в пикселях деревни и растягивается без сглаживания;
// в пикселях экрана (z · devicePixelRatio) шаг — половинка или целое, чтобы пиксели были ровными.

const ZOOM_MAX = 5;

/** Пределы приближения на этом экране: { min, max, dpr }. */
export function zoomRange() {
  const dpr = window.devicePixelRatio || 1;
  return { min: Math.max(0.5, 1 / dpr), max: ZOOM_MAX, dpr };
}

/** Округлить приближение до ровных пикселей экрана (floor — в сторону «дальше»). */
export function snapZoom(z, floor = false) {
  const { min, max, dpr } = zoomRange();
  const f = floor ? Math.floor : Math.round;
  let d = clamp(z, min, max) * dpr;
  d = d < 4 ? Math.max(1, f(d * 2) / 2) : f(d);
  return Math.max(min, d / dpr);
}

/** «Авто»: земля деревни целиком (с запасом) в кадре; чем больше деревня, тем дальше. На узком экране — компромисс. */
export function autoZoom(iw, ih) {
  const { land } = world.map;
  const fw = iw / ((land.w + 16) * TILE);
  const fh = ih / ((land.h + 12) * TILE);
  return snapZoom(Math.min(3.5, iw >= ih ? Math.min(fw, fh) : Math.sqrt(fw * fh)), true);
}

/** Текущее приближение (для ползунка): { z, auto }. */
export const viewZoom = { z: 2, auto: 2 };

// ---------- Перестановка ----------

/** Объект деревни на карте по ключу (id покупки). */
export const findObject = (key) => (key ? [...world.map.buildings, ...world.map.smalls].find((o) => o.key === key) || null : null);

/** Что переставляем: { key, place, tw, th, tx, ty, ok, from: [tx, ty] } или null. */
export const villageMove = { current: null };

export function startMove(key) {
  const o = findObject(key);
  if (!o || o.fixed || o.virtual) return;
  villageMove.current = { key: o.key, place: o.place, tw: o.tw, th: o.th, tx: o.tx, ty: o.ty, ok: true, from: [o.tx, o.ty] };
  villageSel.current = null;
  notify();
}

export function cancelMove() {
  villageMove.current = null;
  notify();
}

/** Поставить «призрак» в клетку (tx, ty) — левый верхний угол. */
function setGhost(tx, ty) {
  const m = villageMove.current;
  if (!m) return;
  const { land } = world.map;
  tx = clamp(tx, land.x0, land.x1 - m.tw + 1);
  ty = clamp(ty, land.y0, land.y1 - m.th + 1);
  if (tx === m.tx && ty === m.ty) return;
  const ok = canPlace(world.map, m.place, tx, ty, m.key);
  const changed = ok !== m.ok;
  Object.assign(m, { tx, ty, ok });
  if (changed) notify();
}

/** Высота спрайта над основанием в клетках — чтобы «взять» объект можно было и за крышу. */
const spriteTiles = (m) => Math.ceil((SPRITE_H[DRAW[m.place] || m.place] || 24) / TILE);

/** Деревня во весь экран за приложением. interactive — экран «Деревня» (клики, прокрутка, приближение). */
export function VillageBackdrop({ interactive = false, dim = 0 }) {
  const wrap = useRef(null);
  const cv = useRef(null);
  const layer = useRef(null);
  const geo = useRef({ z: 2, dpr: 1, R: 1, W: 0, H: 0, camX: 0, camY: 0, override: null, raw: null });
  const cam = useRef({ user: null, drag: null, pinch: null, pointers: new Map(), last: null });
  const mode = useRef(interactive);
  mode.current = interactive;

  useEffect(() => {
    const canvas = cv.current;
    const ctx = canvas.getContext('2d');
    const renderer = new VillageRenderer();
    const g = geo.current;
    let zoomSave = 0;
    /** Размер холста под окно и приближение; карта — не меньше экрана при самом дальнем отдалении. */
    const layout = () => {
      const iw = window.innerWidth;
      const ih = window.innerHeight;
      const { min, dpr } = zoomRange();
      setViewSize(Math.ceil(iw / min / TILE / 8) * 8 + 8, Math.ceil(ih / min / TILE / 8) * 8 + 8);
      const pref = getPrefs().villageZoom;
      const auto = autoZoom(iw, ih);
      const z = g.override ?? (Number.isFinite(pref) ? snapZoom(pref) : auto);
      viewZoom.auto = auto;
      viewZoom.z = z;
      const d = z * dpr;
      const W = Math.ceil((iw * dpr) / d);
      const H = Math.ceil((ih * dpr) / d);
      // 0.8: холст вдвое подробнее мира, если на пиксель деревни приходится хотя бы 2 пикселя экрана (для чиби)
      const R = d >= 2 ? 2 : 1;
      if (g.z === z && g.W === W && g.H === H && g.dpr === dpr && g.R === R) return;
      const cx = g.camX + g.W / 2;
      const cy = g.camY + g.H / 2;
      const had = g.W > 0;
      Object.assign(g, { z, dpr, W, H, R });
      canvas.width = W * R;
      canvas.height = H * R;
      canvas.style.width = (W * d) / dpr + 'px';
      canvas.style.height = (H * d) / dpr + 'px';
      if (had && cam.current.user) cam.current.user = { x: cx - W / 2, y: cy - H / 2 };
    };
    layout();
    window.addEventListener('resize', layout);
    const toWorld = (cx, cy) => ({ wx: cx / g.z + g.camX, wy: cy / g.z + g.camY });
    const bubbles = new Map();
    const updateBubbles = () => {
      const seen = new Set();
      const maxX = g.W * g.z;
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
        const x = clamp((a.x - g.camX) * g.z, 60, maxX - 60);
        const y = Math.max(24, (a.y - a.z - charHeight(a.kind) * a.u - 6 - g.camY) * g.z);
        el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
      }
      for (const [id, el] of bubbles) {
        if (!seen.has(id)) {
          el.remove();
          bubbles.delete(id);
        }
      }
    };
    /** Куда можно смотреть: земля деревни с каймой (дальше — только лес), и не за край карты. */
    const bounds = () => {
      const v = world.map.village;
      const rx0 = v.x0 - 10 * TILE;
      const rx1 = v.x1 + 10 * TILE;
      const ry0 = v.y0 - 8 * TILE;
      const ry1 = v.y1 + 8 * TILE;
      const fit = (a, b, size, total) => {
        let lo = b - a >= size ? a : (a + b - size) / 2;
        let hi = b - a >= size ? b - size : lo;
        lo = clamp(lo, 0, Math.max(0, total - size));
        hi = clamp(hi, lo, Math.max(0, total - size));
        return [lo, hi];
      };
      return { x: fit(rx0, rx1, g.W, world.W), y: fit(ry0, ry1, g.H, world.H) };
    };
    const draw = () => {
      layout();
      if (!g.W) return;
      if (world.shift) {
        if (cam.current.user) cam.current.user = { x: cam.current.user.x + world.shift.dx, y: cam.current.user.y + world.shift.dy };
        world.shift = null;
      }
      const B = bounds();
      let camX;
      let camY;
      const d = cam.current.drag;
      if (d && (d.ghost || d.grabbed) && d.moved && cam.current.last && mode.current) {
        // тянем объект к краю экрана — карта сама едет следом
        const { x, y } = cam.current.last;
        const edge = 48;
        const sx = x < edge ? -1 : x > window.innerWidth - edge ? 1 : 0;
        const sy = y < edge + 40 ? -1 : y > window.innerHeight - edge - 60 ? 1 : 0;
        if (sx || sy) {
          const cur = cam.current.user || { x: g.camX, y: g.camY };
          cam.current.user = { x: cur.x + sx * 4, y: cur.y + sy * 4 };
          const p = toWorld(x, y);
          if (d.ghost) setGhost(Math.floor(p.wx / TILE) - d.ghost.ox, Math.floor(p.wy / TILE) - d.ghost.oy);
        }
      }
      // житель в «руке»: держим под пальцем/курсором и при движении камеры у края
      const dd = cam.current.drag;
      if (dd?.grabbed && cam.current.last) {
        const p = toWorld(cam.current.last.x, cam.current.last.y);
        world.holdAt(dd.actor, p.wx, p.wy);
        g.hand = { x: p.wx, y: p.wy, closed: true };
      } else g.hand = null;
      const tk = mode.current ? talk.current : null;
      if (tk && !tk.actor.hidden) {
        // разговор: камера плавно подъезжает к жителю (он — в верхней половине экрана, над окном диалога)
        const cur = cam.current.user || { x: g.camX, y: g.camY };
        const tx = tk.actor.x - g.W / 2;
        const ty = tk.actor.y - g.H * 0.36;
        cam.current.user = { x: cur.x + (tx - cur.x) * 0.12, y: cur.y + (ty - cur.y) * 0.12 };
      }
      if (cam.current.user && mode.current) {
        camX = clamp(cam.current.user.x, B.x[0], B.x[1]);
        camY = clamp(cam.current.user.y, B.y[0], B.y[1]);
        cam.current.user = { x: camX, y: camY };
      } else {
        // сама плавно гуляет вокруг площади, не уходя за жилую часть
        const c = world.map.spots.plaza;
        const rx = Math.max(0, (B.x[1] - B.x[0]) / 2 - 4 * TILE);
        const ry = Math.max(0, (B.y[1] - B.y[0]) / 2 - 4 * TILE);
        camX = clamp(c.x - g.W / 2 + Math.sin((world.t * Math.PI * 2) / 240) * Math.min(rx, 10 * TILE), B.x[0], B.x[1]);
        camY = clamp(c.y - 18 - g.H / 2 + Math.sin((world.t * Math.PI * 2) / 330) * Math.min(ry, 5 * TILE), B.y[0], B.y[1]);
      }
      g.camX = Math.round(camX);
      g.camY = Math.round(camY);
      // выбранное и переставляемое
      let marks = null;
      let pointer = null;
      const sel = mode.current ? villageSel.current : null;
      if (sel?.type === 'tile') marks = [{ tx: sel.tx, ty: sel.ty, kind: 'tile' }];
      else if (sel?.obj) {
        const o = findObject(sel.obj.key) || sel.obj;
        const h = o.place === 'lantern' ? 28 : o.place === 'tree' ? 34 : SPRITE_H[o.type] || 16;
        pointer = { x: o.x + o.w / 2, y: o.base - h - 2 };
      }
      const move = mode.current ? villageMove.current : null;
      renderer.render(ctx, world, {
        W: g.W, H: g.H, R: g.R, camX: g.camX, camY: g.camY, phase: env.phase, n: env.n, style: env.style, letter: env.letter, marks, pointer, ghost: move, hand: g.hand,
      });
      updateBubbles();
    };
    const detach = attachView(draw);
    draw();
    // На вкладках фон под карточками: клики по пустому месту страницы долетают до жителей.
    const onDocClick = (e) => {
      if (mode.current || e.defaultPrevented || !(e.target instanceof Element)) return;
      if (e.target.closest('button, a, input, textarea, select, label, summary, [role], [contenteditable], .card-block, .sheet, .overlay, .dock-wrap, .topbar, li, .task-row, .village-visitor')) return;
      const p = toWorld(e.clientX, e.clientY);
      const h = world.hit(p.wx, p.wy);
      if (h && h.type !== 'tile') interact(h);
    };
    document.addEventListener('click', onDocClick);
    /** Приближение жестом (щипок, Ctrl + колесо) вокруг точки (sx, sy) экрана; в настройки — когда жест закончился. */
    const zoomAt = (z, sx, sy) => {
      const before = toWorld(sx, sy);
      const { min, max } = zoomRange();
      g.raw = clamp(z, min, max); // без округления — чтобы мелкие шаги колеса копились
      g.override = snapZoom(g.raw);
      layout();
      cam.current.user = { x: before.wx - sx / g.z, y: before.wy - sy / g.z };
      clearTimeout(zoomSave);
      zoomSave = setTimeout(() => {
        if (cam.current.pinch) return;
        const z1 = g.override;
        g.override = null;
        g.raw = null;
        if (z1 != null) setPrefs({ villageZoom: z1 });
      }, 400);
    };
    // Экран «Деревня»: тянуть — двигать карту (или объект при перестановке), нажать — выбрать, два пальца — приближение.
    const ps = cam.current.pointers;
    const capture = (id) => {
      try {
        canvas.setPointerCapture?.(id);
      } catch {
        // указатель уже отпущен — не страшно
      }
    };
    const down = (e) => {
      if (!mode.current) return;
      ps.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ps.size === 2) {
        const [a, b] = [...ps.values()];
        cam.current.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: g.z };
        cam.current.drag = null;
        return;
      }
      let ghost = null;
      const m = villageMove.current;
      if (m) {
        const p = toWorld(e.clientX, e.clientY);
        const tx = Math.floor(p.wx / TILE);
        const ty = Math.floor(p.wy / TILE);
        const top = m.ty + m.th - spriteTiles(m);
        if (tx >= m.tx - 1 && tx <= m.tx + m.tw && ty >= top && ty < m.ty + m.th + 1) ghost = { ox: tx - m.tx, oy: ty - m.ty };
      }
      // житель под пальцем: потянуть или подержать — взять «рукой» (0.9)
      let actor = null;
      if (!m) {
        const p = toWorld(e.clientX, e.clientY);
        const h = world.hit(p.wx, p.wy);
        if (h?.type === 'actor') actor = h.actor;
      }
      const d = { x0: e.clientX, y0: e.clientY, cx: g.camX, cy: g.camY, moved: false, id: e.pointerId, ghost, actor, grabbed: false };
      cam.current.drag = d;
      cam.current.last = { x: e.clientX, y: e.clientY };
      if (actor) {
        clearTimeout(grabTimer);
        grabTimer = setTimeout(() => {
          if (cam.current.drag === d && !d.moved && !d.grabbed) grabActor(d, e.pointerId);
        }, 380);
      }
    };
    let grabTimer = 0;
    const grabActor = (d, pointerId) => {
      if (talk.current?.actor === d.actor) closeTalk();
      if (!world.grab(d.actor)) return;
      d.grabbed = true;
      d.moved = true;
      capture(pointerId);
      canvas.style.cursor = 'none';
      selectInVillage(null);
    };
    const move = (e) => {
      if (!mode.current) return;
      if (ps.has(e.pointerId)) ps.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pinch = cam.current.pinch;
      if (pinch && ps.size >= 2) {
        const [a, b] = [...ps.values()];
        zoomAt(pinch.z0 * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0), (a.x + b.x) / 2, (a.y + b.y) / 2);
        return;
      }
      const d = cam.current.drag;
      if (d && d.id === e.pointerId) {
        cam.current.last = { x: e.clientX, y: e.clientY };
        const dx = (e.clientX - d.x0) / g.z;
        const dy = (e.clientY - d.y0) / g.z;
        if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 6 && !d.moved) {
          if (d.actor) {
            clearTimeout(grabTimer);
            grabActor(d, e.pointerId);
          } else {
            d.moved = true;
            capture(e.pointerId);
          }
        }
        if (!d.moved) return;
        if (d.grabbed) return; // держим — позицию обновляет кадр
        if (d.ghost) {
          const p = toWorld(e.clientX, e.clientY);
          setGhost(Math.floor(p.wx / TILE) - d.ghost.ox, Math.floor(p.wy / TILE) - d.ghost.oy);
        } else cam.current.user = { x: d.cx - dx, y: d.cy - dy };
        return;
      }
      if (e.pointerType === 'mouse') {
        const p = toWorld(e.clientX, e.clientY);
        const h = world.hit(p.wx, p.wy);
        canvas.style.cursor = villageMove.current ? 'crosshair' : h?.type === 'actor' ? 'grab' : h && h.type !== 'tile' ? 'pointer' : 'default';
      }
    };
    const up = (e) => {
      ps.delete(e.pointerId);
      if (cam.current.pinch) {
        if (ps.size < 2) {
          cam.current.pinch = null;
          cam.current.drag = null;
          zoomAt(g.z, e.clientX, e.clientY);
        }
        return;
      }
      const d = cam.current.drag;
      cam.current.drag = null;
      cam.current.last = null;
      clearTimeout(grabTimer);
      if (d?.grabbed) {
        // отпустили — житель падает
        world.drop(d.actor);
        g.hand = null;
        canvas.style.cursor = 'grab';
        return;
      }
      if (!mode.current || !d || d.moved) return;
      const p = toWorld(e.clientX, e.clientY);
      const m = villageMove.current;
      if (m) {
        setGhost(Math.floor(p.wx / TILE) - Math.floor(m.tw / 2), Math.floor(p.wy / TILE) - Math.floor(m.th / 2));
        return;
      }
      const h = world.hit(p.wx, p.wy);
      if (h?.type === 'actor') {
        // житель — разговор «как в новелле» (0.8)
        selectInVillage(null);
        openTalk(h.actor);
        return;
      }
      if (talk.current) closeTalk();
      selectInVillage(interact(h));
    };
    const wheel = (e) => {
      if (!mode.current) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAt((g.raw ?? g.z) * Math.exp(-e.deltaY * 0.004), e.clientX, e.clientY);
        return;
      }
      const cur = cam.current.user || { x: g.camX, y: g.camY };
      const sx = e.shiftKey ? e.deltaY : e.deltaX;
      const sy = e.shiftKey ? 0 : e.deltaY;
      cam.current.user = { x: cur.x + sx / g.z, y: cur.y + sy / g.z };
    };
    const cancel = (e) => {
      ps.delete(e.pointerId);
      const d = cam.current.drag;
      if (d?.grabbed) world.drop(d.actor);
      g.hand = null;
      clearTimeout(grabTimer);
      cam.current.drag = null;
      cam.current.pinch = null;
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      detach();
      clearTimeout(zoomSave);
      window.removeEventListener('resize', layout);
      document.removeEventListener('click', onDocClick);
      for (const el of bubbles.values()) el.remove();
    };
  }, []);

  useEffect(() => {
    if (!interactive) {
      cam.current.user = null; // на вкладках камера снова гуляет сама
      if (villageSel.current) villageSel.current = null;
      if (villageMove.current) villageMove.current = null;
      if (talk.current) closeTalk();
    }
  }, [interactive]);

  return html`<div class=${'village-bg' + (interactive ? ' interactive' : '')} ref=${wrap} aria-hidden=${interactive ? 'false' : 'true'}>
    <canvas ref=${cv} role=${interactive ? 'img' : undefined}
      aria-label=${interactive ? 'Деревня: нажми на жителя, дом или пустую клетку; потяни, чтобы прокрутить; два пальца или Ctrl + колесо — приближение' : undefined}></canvas>
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
    canvas.width = W * 2; // 0.8: вдвое подробнее — для чиби
    canvas.height = H * 2;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
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
    <button class="visitor-hit" ref=${hit} aria-label="Поговорить с гостем"
      onClick=${() => (world.visitor?.actor ? openTalk(world.visitor.actor) : world.pokeVisitor())}></button>
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
  const objects = useMemo(() => villageObjects(data), [store.version]);
  // хранители и их невыполненные задачи (на сегодня и просроченные) — «!» над головой, стучат в экран только они
  const keepers = useMemo(() => {
    const alerts = listAlerts(data, store.now.today, store.now.time);
    return keepersOf(data, skillsNow()).map((k) => ({ ...k, alert: alerts.get(k.listId) || 0 }));
  }, [store.version, store.now.today, store.now.time]);
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
    configureVillage({
      owned, objects, keepers, legacy, flavor: flavorOf(villageStyle(scheme)), mood: mood.value, focus: !!focus && !focus.pausedAt,
      visitors: on && motion && p.visitors !== false, lightsOff: p.villageLightsOff || [],
    });
  });
  // выполненная задача — праздник в деревне (и монетки из домика)
  useEffect(() => {
    if (prev.current && on && exp > prev.current.exp) world.celebrate(exp - prev.current.exp, Math.max(0, gems - prev.current.gems));
    prev.current = { exp, gems };
  }, [exp, gems]);

  if (!on) return null;
  return html`
    ${full || p.villageBackdrop !== false ? html`<${VillageBackdrop} interactive=${full} dim=${dim}/>` : null}
    ${motion && p.visitors !== false ? html`<${VillageVisitor}/>` : null}
    ${!full && talk.current ? html`<div class="village-bottom talking village-talk-global"><${VillageDialog}/></div>` : null}`;
}

/** Невыполненные задачи по спискам: на сегодня (дата, дедлайн, «главное», повтор) и просроченные. */
export function listAlerts(data, today, time) {
  const out = new Map();
  for (const t of data.tasks.values()) {
    if (t.deletedAt || t.trashedAt || t.status !== 'active') continue;
    const due = S.isOverdue(t, today, time) || S.plannedDate(t, today) === today || t.deadlineDate === today || t.focusDate === today;
    if (!due) continue;
    for (const id of M.taskListIds(t)) out.set(id, (out.get(id) || 0) + 1);
  }
  return out;
}
