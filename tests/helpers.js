// Общие заготовки для тестов: детерминированный ctx и сборка данных.

import { createClock } from '../src/core/clock.js';
import { defaultLists, defaultSettings, newTask, touch } from '../src/core/model.js';

export const DEVICE = '01926f3a-8c1e-7b2a-9f00-3c4d5e6f7a8b';

/** ctx с управляемым временем: ctx.now задаётся, метки растут. */
export function makeCtx(now = Date.parse('2026-10-02T09:00:00.000Z')) {
  const clock = createClock(0, () => c.now);
  const c = { now, stamp: () => clock.stamp(), deviceId: DEVICE };
  return c;
}

export function makeData({ timeZone = 'Europe/Moscow' } = {}) {
  return {
    settings: defaultSettings(timeZone),
    lists: new Map(defaultLists().map((l) => [l.id, l])),
    tasks: new Map(),
    media: new Map(),
    devices: new Map(),
  };
}

/** Добавить задачу в data; extra — поля, которые ставятся через touch (status, trashedAt, focusDate…). */
export function addTask(data, ctx, input, extra = {}) {
  let t = newTask({ order: 'a0', ...input }, ctx);
  if (Object.keys(extra).length) t = touch(t, extra, ctx);
  data.tasks.set(t.id, t);
  return t;
}
