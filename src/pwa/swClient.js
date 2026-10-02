// Регистрация Service Worker и обновление приложения (docs/TZ.md §13).
// Новый SW устанавливается и ждёт; приложение показывает баннер, по «Обновить» —
// сохраняет несохранённый ввод, активирует новый SW и перезагружается (во всех вкладках).

import { setUi, flushAll } from '../store/appState.js';
import { TIMINGS } from '../config.js';

let reg = null;
let lastCheck = 0;

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  try {
    reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch (e) {
    console.warn('Service Worker не зарегистрирован:', e);
    return;
  }
  lastCheck = Date.now();
  if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) announce(w);
    });
  });
  // При самой первой установке SW тоже берёт управление — тогда перезагружать не нужно.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > TIMINGS.swUpdateCheckMinMs) checkForUpdate();
  });
}

async function announce(worker) {
  setUi({ update: { version: await askVersion(worker) } });
}

function askVersion(worker) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 1000);
    ch.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data?.version ?? null);
    };
    worker.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
  });
}

/** 'found' | 'none' | 'error' | 'unsupported' */
export async function checkForUpdate() {
  if (!reg) return 'unsupported';
  lastCheck = Date.now();
  try {
    await reg.update();
  } catch {
    return 'error';
  }
  if (reg.waiting) {
    announce(reg.waiting);
    return 'found';
  }
  return reg.installing ? 'found' : 'none';
}

export async function applyUpdate() {
  await flushAll();
  const w = reg?.waiting;
  if (!w) {
    location.reload();
    return;
  }
  setUi({ update: null });
  w.postMessage({ type: 'SKIP_WAITING' });
}
