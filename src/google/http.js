// fetch к Google API: токен, повторы, разбор ошибок в коды docs/TZ.md §14.

import { SyncError } from '../core/errors.js';
import { tr } from '../core/i18n.js';

export { SyncError };

let getToken = () => null;

/** Откуда брать access token (задаёт google/auth.js). */
export function setTokenProvider(fn) {
  getToken = fn;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms * (0.8 + Math.random() * 0.4);

async function parseError(res) {
  let reason = '';
  let message = '';
  try {
    const j = await res.json();
    reason = j?.error?.errors?.[0]?.reason || j?.error?.status || '';
    message = j?.error?.message || '';
  } catch {
    // тело не JSON
  }
  return { reason, message };
}

/**
 * Запрос к Google API.
 * opts: { method, headers, body, as: 'json' | 'bytes' | 'text' | 'none' | 'response', auth: true }
 * Ошибки: SyncError с code E-OFFLINE, E-AUTH-EXPIRED, E-QUOTA-DRIVE, E-RATE, E-SERVER, E-NOT-FOUND, E-HTTP.
 */
export async function gfetch(url, opts = {}) {
  const { method = 'GET', headers = {}, body, as = 'json', auth = true } = opts;
  let rateTries = 0;
  let serverTries = 0;
  for (;;) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new SyncError('E-OFFLINE', tr('Нет сети'));
    }
    const h = { ...headers };
    if (auth) {
      const token = getToken();
      if (!token) throw new SyncError('E-AUTH-EXPIRED', tr('Нужен вход в Google'));
      h.Authorization = 'Bearer ' + token;
    }
    let res;
    try {
      res = await fetch(url, { method, headers: h, body });
    } catch (e) {
      throw new SyncError('E-OFFLINE', tr('Нет сети'), { cause: e });
    }
    if (res.ok) {
      if (as === 'response') return res;
      if (as === 'none' || res.status === 204) return null;
      if (as === 'bytes') return new Uint8Array(await res.arrayBuffer());
      if (as === 'text') return res.text();
      return res.json();
    }
    const { reason, message } = await parseError(res);
    if (res.status === 401) throw new SyncError('E-AUTH-EXPIRED', tr('Сессия Google истекла'), { status: 401 });
    if (res.status === 403 && reason === 'storageQuotaExceeded') {
      throw new SyncError('E-QUOTA-DRIVE', message, { status: 403, reason });
    }
    const rate = res.status === 429 || (res.status === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(reason));
    if (rate && rateTries < 4) {
      await sleep(jitter(1000 * 2 ** rateTries++));
      continue;
    }
    if (rate) throw new SyncError('E-RATE', message, { status: res.status, reason });
    if (res.status >= 500 && serverTries < 3) {
      await sleep(jitter(1000 * 2 ** serverTries++));
      continue;
    }
    if (res.status >= 500) throw new SyncError('E-SERVER', message, { status: res.status, reason });
    if (res.status === 404) throw new SyncError('E-NOT-FOUND', message, { status: 404, reason });
    if (res.status === 403 && /accessNotConfigured|SERVICE_DISABLED/i.test(reason + message)) {
      throw new SyncError('E-API-DISABLED', message, { status: 403, reason });
    }
    if (res.status === 403 && /insufficient/i.test(reason + message)) {
      throw new SyncError('E-AUTH-SCOPE', message, { status: 403, reason });
    }
    throw new SyncError('E-HTTP', `${res.status} ${reason}: ${message}`, { status: res.status, reason });
  }
}
