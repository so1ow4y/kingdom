// События для деревни (обновление 0.7): фокус начат / завершён / прерван, покупка. Действия (store/actions.js)
// сообщают, деревня (village/runtime.js) реагирует анимацией. Без DOM.

const listeners = new Set();

export function onVillage(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitVillage(type, payload = {}) {
  for (const fn of listeners) {
    try {
      fn(type, payload);
    } catch (e) {
      console.error(e);
    }
  }
}
