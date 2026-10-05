// Одна деревня на всё приложение (обновление 0.7): общий мир для фона, экрана «Деревня» и гостя у экрана,
// один цикл анимации на все холсты (~30 кадров в секунду, на паузе, пока вкладка скрыта).

import { World } from './world.js';
import { dayPhase, nightness, villageStyle } from '../core/village.js';
import { onVillage } from './bus.js';

export const world = new World();

/** Окружение кадра: время суток, стиль, цвет флагов. Обновляет ui/components/VillageView.js (VillageHost). */
export const env = {
  mode: 'theme', dark: false, motion: true, phaseOverride: null, phase: 0.5, n: 0,
  style: villageStyle('indigo'), letter: '#3949ab', fullViews: 0, viewW: 320, backdropW: 320,
};

let cfg = null;

function computePhase(now = Date.now()) {
  env.phase = env.phaseOverride ?? dayPhase(env.mode, now, { dark: env.dark });
  env.n = nightness(env.phase);
}

export function setEnv(patch) {
  Object.assign(env, patch);
  computePhase();
}

/** Покупки, настроение, фокус и т. п. (см. World.configure). Ширину мира задаёт видимый холст. */
export function configureVillage(next) {
  cfg = next;
  world.configure({ ...cfg, viewW: env.viewW });
}

/** Холст сообщает свою ширину (в пикселях деревни). Пока открыт полный вид, фон ширину не меняет. */
export function setViewWidth(w, full) {
  if (!full && env.fullViews > 0) return;
  env.viewW = w;
  if (cfg) world.configure({ ...cfg, viewW: w });
}

const views = new Set();
let visible = 0; // холсты, где деревню видно всегда (фон, полный вид); гость у экрана — только когда пришёл
let raf = 0;
let last = 0;

function frame(ts) {
  raf = requestAnimationFrame(frame);
  if (document.hidden) {
    last = ts;
    return;
  }
  // деревни не видно и гостя нет — мир живёт, но редко (бережём батарею)
  const gap = !env.motion ? 1000 : visible > 0 || world.visitor ? 1000 / 31 : 250;
  if (last && ts - last < gap) return;
  const dt = last ? (ts - last) / 1000 : 0;
  last = ts;
  computePhase();
  world.step(dt, { phase: env.phase, night: env.n, motion: env.motion });
  for (const draw of views) {
    try {
      draw(dt);
    } catch (e) {
      console.error(e);
    }
  }
}

/** Подписать функцию отрисовки на кадры. Возвращает отписку. always — холст показывает деревню постоянно. */
export function attachView(draw, { always = true } = {}) {
  views.add(draw);
  if (always) visible++;
  if (!raf) {
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  return () => {
    if (always) visible--;
    views.delete(draw);
    if (!views.size && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}

onVillage((type, p) => {
  if (type === 'focus-start') world.focusStart();
  else if (type === 'focus-done') world.focusDone(p.gems || 0);
  else if (type === 'focus-fail') world.focusFailed();
});
