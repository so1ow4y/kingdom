// Вложения заметок и голосовые заметки (обновление 0.5; docs/TZ.md §7.10, §22).
// Фото — плитками с полноэкранным просмотром, видео — встроенным плеером, голосовые — своим плеером
// (play/pause, перемотка, длительность, скорость), прочие файлы — иконка, имя, размер, «Открыть», «Скачать».
// Файлы, которых нет на устройстве, скачиваются с Диска лениво (картинки и голос до 5 МБ — сами, остальное — по нажатию).

import { html, useState, useRef, useEffect } from '../html.js';
import { Icon } from '../icons.js';
import { Sheet } from './Sheet.js';
import { store, closeSheet, openSheet, ask, showSnackbar } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import { liveAttachments } from '../../core/model.js';
import { formatBytes, formatDuration } from '../../core/media.js';
import { ensureMedia, mediaStatus, autoDownload } from '../../sync/mediaSync.js';
import { cachedUrl } from '../../media/cache.js';
import { VoiceRecorder, micPermission, recordingSupported } from '../../media/recorder.js';
import { drive } from '../../sync/syncEngine.js';
import { tokenValid } from '../../google/auth.js';
import { readLocal, writeLocal } from '../hooks.js';

const STATUS_TEXT = {
  loading: 'Загрузка…',
  offline: 'Нет на устройстве — нужен интернет и вход в Google',
  missing: 'Файл не найден на Диске',
  corrupt: 'Файл на Диске повреждён',
  error: 'Не удалось скачать',
};

const canDownload = () => navigator.onLine && tokenValid() && !!store.sync.layout;

/** Ссылка на файл вложения (из кэша или с Диска). auto — качать сразу; иначе — по load(). */
function useMediaUrl(media, auto) {
  const [url, setUrl] = useState(() => (media ? cachedUrl(media.id) : null));
  const [tried, setTried] = useState(false);
  const load = (force = false) => {
    if (!media) return;
    setTried(true);
    ensureMedia(media, { drive, layout: store.sync.layout, canDownload: force || auto ? canDownload() : false }).then((u) => u && setUrl(u));
  };
  useEffect(() => {
    if (media && !url) load(false);
  }, [media?.id]);
  return { url, load, tried };
}

const FILE_ICONS = { pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', ppt: '📙', pptx: '📙', zip: '🗜', txt: '📄', csv: '📊' };

function Missing({ media, onLoad, label }) {
  const st = mediaStatus(media.id);
  return html`<button type="button" class="att-missing" onClick=${onLoad} disabled=${st === 'loading'}>
    <span>${st === 'loading' ? '⏳' : '☁'}</span><span>${STATUS_TEXT[st] || label || `Загрузить · ${formatBytes(media.size)}`}</span></button>`;
}

/** Плеер голосового: play/pause, перемотка, длительность, скорость 1× / 1.5× / 2×. */
export function AudioPlayer({ media, url, name }) {
  const el = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [rate, setRate] = useState(() => readLocal('audioRate', 1));
  const dur = media?.durationMs || 0;
  useEffect(() => {
    if (el.current) el.current.playbackRate = rate;
  }, [rate, url]);
  const toggle = () => {
    const a = el.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => showSnackbar('Этот формат не воспроизводится в этом браузере — скачай файл'));
    else a.pause();
  };
  const nextRate = () => {
    const r = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(r);
    writeLocal('audioRate', r);
  };
  const total = dur || (el.current && Number.isFinite(el.current.duration) ? el.current.duration * 1000 : 0);
  return html`
    <div class="audio-player">
      <audio ref=${el} src=${url} preload="metadata" onPlay=${() => setPlaying(true)} onPause=${() => setPlaying(false)}
        onEnded=${() => { setPlaying(false); setPos(0); }} onTimeUpdate=${(e) => setPos(e.target.currentTime * 1000)}></audio>
      <button type="button" class="ap-play" onClick=${toggle} aria-label=${playing ? 'Пауза' : 'Слушать'} disabled=${!url}>
        ${playing ? html`<span class="ap-pause"></span>` : html`<span class="ap-tri"></span>`}</button>
      <div class="ap-main">
        <input type="range" class="ap-seek" min="0" max=${Math.max(1, Math.round(total))} step="100" value=${Math.round(pos)} disabled=${!url}
          aria-label="Перемотка" onInput=${(e) => { if (el.current) el.current.currentTime = +e.target.value / 1000; setPos(+e.target.value); }}/>
        <div class="ap-time"><span>${formatDuration(pos)} / ${formatDuration(total)}</span>${name ? html`<span class="ap-name">${name}</span>` : null}</div>
      </div>
      <button type="button" class="ap-rate" onClick=${nextRate} aria-label="Скорость">${String(rate).replace('.', ',')}×</button>
    </div>`;
}

function AttachmentTile({ att, media, onOpen, onDelete, locked, handle, dragging }) {
  const kind = media ? media.kind : 'file';
  const { url, load } = useMediaUrl(media, media ? autoDownload(media) : false);
  const del = locked ? null : html`<button type="button" class="att-del" onClick=${onDelete} aria-label="Удалить вложение" title="Удалить">×</button>`;
  const grip = locked ? null : html`<span class="att-grip" ...${handle} aria-label="Перетащить" title="Перетащить">⋮⋮</span>`;
  if (!media) return html`<div class="att-row att-file"><span class="att-icon">❔</span><div class="att-info"><b>${att.name}</b><small>Нет данных о файле</small></div>${del}</div>`;
  if (kind === 'image') {
    return html`<div class=${'att-tile' + (dragging ? ' dragging' : '')} data-aid=${att.id}>
      ${url ? html`<img src=${url} alt=${att.name} loading="lazy" onClick=${onOpen}/>` : html`<${Missing} media=${media} onLoad=${() => load(true)} label="☁"/>`}
      ${grip}${del}</div>`;
  }
  if (kind === 'video') {
    return html`<div class=${'att-tile att-video' + (dragging ? ' dragging' : '')} data-aid=${att.id}>
      ${url ? html`<video src=${url} preload="metadata" muted playsinline onClick=${onOpen}></video><span class="att-play" onClick=${onOpen}>▶</span>`
        : html`<${Missing} media=${media} onLoad=${() => load(true)} label=${`▶ ${formatBytes(media.size)}`}/>`}
      ${media.durationMs ? html`<span class="att-badge">${formatDuration(media.durationMs)}</span>` : null}
      ${grip}${del}</div>`;
  }
  if (kind === 'audio') {
    return html`<div class=${'att-row att-audio' + (dragging ? ' dragging' : '')} data-aid=${att.id}>
      ${grip}
      ${url ? html`<${AudioPlayer} media=${media} url=${url}/>` : html`<${Missing} media=${media} onLoad=${() => load(true)} label=${`🎤 ${formatDuration(media.durationMs)} · загрузить`}/>`}
      ${del}</div>`;
  }
  const icon = FILE_ICONS[media.ext] || '📎';
  return html`<div class=${'att-row att-file' + (dragging ? ' dragging' : '')} data-aid=${att.id}>
    ${grip}<span class="att-icon">${icon}</span>
    <div class="att-info"><b title=${att.name}>${att.name}</b><small>${formatBytes(media.size)}${mediaStatus(media.id) ? ' · ' + STATUS_TEXT[mediaStatus(media.id)] : ''}</small></div>
    <span class="att-actions">
      ${url ? html`<a class="btn small" href=${url} target="_blank" rel="noopener">Открыть</a><a class="btn small" href=${url} download=${att.name}>Скачать</a>`
        : html`<button type="button" class="btn small" onClick=${() => load(true)} disabled=${mediaStatus(media.id) === 'loading'}>☁ Загрузить</button>`}
      ${del}</span></div>`;
}

/** Полноэкранный просмотр фото и видео заметки: стрелки и свайп, «Скачать», «Удалить», Esc. */
function Viewer({ items, index, onClose, onDelete, locked }) {
  const [i, setI] = useState(index);
  const start = useRef(null);
  const it = items[Math.min(i, items.length - 1)];
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        // Только просмотр, а не карточку под ним
        e.stopImmediatePropagation();
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight') setI((x) => Math.min(items.length - 1, x + 1));
      else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [items.length]);
  if (!it) return null;
  const url = cachedUrl(it.media.id);
  const swipe = (e) => {
    if (start.current == null) return;
    const dx = e.clientX - start.current;
    start.current = null;
    if (dx < -50) setI(Math.min(items.length - 1, i + 1));
    if (dx > 50) setI(Math.max(0, i - 1));
  };
  return html`
    <div class="viewer" role="dialog" aria-label="Просмотр" onPointerDown=${(e) => { start.current = e.clientX; }} onPointerUp=${swipe}>
      <div class="viewer-top">
        <span class="viewer-name">${it.att.name} · ${i + 1}/${items.length}</span>
        ${url ? html`<a class="icon-btn" href=${url} download=${it.att.name} aria-label="Скачать" title="Скачать"><${Icon} name="download" size=${20}/></a>` : null}
        ${locked ? null : html`<button class="icon-btn" onClick=${() => { onDelete(it.att); if (items.length <= 1) onClose(); }} aria-label="Удалить" title="Удалить"><${Icon} name="trash" size=${20}/></button>`}
        <button class="icon-btn" onClick=${onClose} aria-label="Закрыть" title="Закрыть"><${Icon} name="close" size=${22}/></button>
      </div>
      <div class="viewer-body">
        ${i > 0 ? html`<button class="viewer-nav prev" onClick=${() => setI(i - 1)} aria-label="Предыдущее">‹</button>` : null}
        ${it.media.kind === 'video' ? html`<video src=${url} controls autoplay playsinline></video>` : html`<img src=${url} alt=${it.att.name}/>`}
        ${i < items.length - 1 ? html`<button class="viewer-nav next" onClick=${() => setI(i + 1)} aria-label="Следующее">›</button>` : null}
      </div>
    </div>`;
}

/** Вложения одной заметки + кнопки добавления. */
export function NoteAttachments({ taskId, note, locked }) {
  const atts = liveAttachments(note);
  const [viewer, setViewer] = useState(null);
  const [drag, setDrag] = useState(null); // { id, from, to }
  const box = useRef(null);
  const st = useRef(null);
  const items = atts.map((att) => ({ att, media: store.data.media.get(att.mediaId) }));
  const visual = items.filter((x) => x.media && (x.media.kind === 'image' || x.media.kind === 'video') && cachedUrl(x.media.id));

  // Порядок перетаскиванием (сетка: ближайшая плитка по центру)
  const handleFor = (att, idx) => ({
    onPointerDown: (e) => {
      if (locked || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      e.stopPropagation();
      const rects = [...box.current.querySelectorAll('[data-aid]')].map((el) => ({ id: el.dataset.aid, r: el.getBoundingClientRect() }));
      st.current = { id: att.id, from: idx, to: idx, x0: e.clientX, y0: e.clientY, rects };
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // не обязательно
      }
      setDrag({ id: att.id, from: idx, to: idx });
    },
    onPointerMove: (e) => {
      const s = st.current;
      if (!s) return;
      let best = s.from;
      let bd = Infinity;
      s.rects.forEach(({ r }, i) => {
        const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      s.to = best;
      const el = box.current.querySelector(`[data-aid="${s.id}"]`);
      if (el) el.style.transform = `translate(${e.clientX - s.x0}px, ${e.clientY - s.y0}px)`;
      setDrag({ id: s.id, from: s.from, to: best });
    },
    onPointerUp: () => {
      const s = st.current;
      st.current = null;
      const el = box.current?.querySelector(`[data-aid="${s?.id}"]`);
      if (el) el.style.transform = '';
      setDrag(null);
      if (s && s.to !== s.from) A.reorderAttachment(taskId, note.id, s.id, s.to);
    },
    onPointerCancel: () => {
      st.current = null;
      setDrag(null);
    },
  });

  return html`
    <div class="note-atts" ref=${box}>
      ${items.length ? html`<div class="att-grid">
        ${items.map(({ att, media }, idx) => html`<div key=${att.id} class=${'att-cell' + (drag && drag.to === idx && drag.id !== att.id ? ' drop-here' : '')
          + (!media || media.kind === 'audio' || media.kind === 'file' ? ' wide' : '')}>
          <${AttachmentTile} att=${att} media=${media} locked=${locked} handle=${handleFor(att, idx)} dragging=${drag?.id === att.id}
            onDelete=${() => A.deleteAttachment(taskId, note.id, att.id)}
            onOpen=${() => setViewer(Math.max(0, visual.findIndex((v) => v.att.id === att.id)))}/>
        </div>`)}
      </div>` : null}
      ${locked ? null : html`<${AttachBar} taskId=${taskId} noteId=${note.id}/>`}
      ${viewer != null && visual.length ? html`<${Viewer} items=${visual} index=${viewer} locked=${locked} onClose=${() => setViewer(null)}
        onDelete=${(att) => A.deleteAttachment(taskId, note.id, att.id)}/>` : null}
    </div>`;
}

/** Кнопки «Камера», «Фото и видео», «Файл», «Голос» и переключатель «Оригинал». */
function AttachBar({ taskId, noteId }) {
  const [original, setOriginal] = useState(() => !!sessionGet('photoOriginal'));
  const [open, setOpen] = useState(false);
  const pick = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (files.length) await A.attachFiles(taskId, noteId, files, { original });
  };
  const flip = () => {
    sessionSet('photoOriginal', !original);
    setOriginal(!original);
  };
  return html`
    <div class="attach-bar">
      <button type="button" class=${'mini-chip' + (open ? ' selected' : '')} onClick=${() => setOpen(!open)} aria-expanded=${open}>📎 Вложить</button>
      <button type="button" class="mini-chip" onClick=${() => startVoice(taskId, noteId, false)} title="Записать голос в эту заметку">🎤 Голос</button>
      ${open ? html`
        <div class="attach-more">
          <label class="mini-chip" title="Снять фото"><input type="file" accept="image/*" capture="environment" hidden onChange=${pick}/>📷 Камера</label>
          <label class="mini-chip" title="Фото и видео из галереи"><input type="file" accept="image/*,video/*" multiple hidden onChange=${pick}/>🖼 Фото и видео</label>
          <label class="mini-chip" title="Любые файлы"><input type="file" multiple hidden onChange=${pick}/>📄 Файл</label>
          <button type="button" class=${'mini-chip' + (original ? ' on' : '')} onClick=${flip} aria-pressed=${original}
            title=${original ? 'Фото сохраняются без сжатия (у JPEG удаляется геолокация)' : 'Фото сжимаются до ~1600 px (рекомендуется)'}>${original ? 'Фото: оригинал' : 'Фото: сжать'}</button>
        </div>` : null}
    </div>`;
}

// «Оригинал» запоминается до перезапуска приложения (TZ §7.10)
const session = new Map();
const sessionGet = (k) => session.get(k);
const sessionSet = (k, v) => session.set(k, v);

/**
 * Начать запись голоса в заметку. Сначала — своё окно с объяснением (если браузер ещё не спрашивал),
 * потом системный запрос микрофона. newNote — заметка создана только что для голоса (при отмене удаляется).
 */
export async function startVoice(taskId, noteId, newNote) {
  if (!recordingSupported()) {
    showSnackbar('Этот браузер не умеет записывать звук');
    if (newNote) A.dropEmptyNote(taskId, noteId);
    return;
  }
  const perm = await micPermission();
  if (perm === 'denied') {
    await ask({
      title: 'Нет доступа к микрофону',
      text: 'Браузер запретил LifeTasks микрофон. Чтобы разрешить: нажми на значок слева от адреса сайта (замок или «настройки сайта») → «Микрофон» → «Разрешить», затем попробуй снова. В установленном приложении на Android: Настройки телефона → Приложения → Chrome → Разрешения → Микрофон.',
      buttons: [{ label: 'Понятно', value: true, kind: 'primary' }],
    });
    if (newNote) A.dropEmptyNote(taskId, noteId);
    return;
  }
  if (perm !== 'granted' && !readLocal('micExplained', false)) {
    const ok = await ask({
      title: 'Запись голоса',
      text: 'Голосовая заметка записывается прямо в приложении и хранится как аудиофайл (без расшифровки в текст): на этом устройстве, а после «Пуш» — на твоём Google Диске. Сейчас браузер спросит разрешение на микрофон.',
      buttons: [{ label: 'Отмена', value: false }, { label: 'Продолжить', value: true, kind: 'primary' }],
    });
    if (!ok) {
      if (newNote) A.dropEmptyNote(taskId, noteId);
      return;
    }
    writeLocal('micExplained', true);
  }
  openSheet('recorder', { taskId, noteId, newNote });
}

/** Окно записи: таймер, уровень громкости, пауза и продолжение, «Отмена», «Готово». */
export function RecorderSheet({ taskId, noteId, newNote }) {
  const rec = useRef(null);
  const saved = useRef(false);
  const [ms, setMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [paused, setPaused] = useState(false);
  const [state, setState] = useState('starting'); // starting | recording | saving | error
  const [error, setError] = useState('');
  const s = store.data.settings;
  const maxMs = (s.voiceMaxSeconds || 600) * 1000;

  const save = async () => {
    const r = rec.current;
    if (!r || saved.current) return;
    saved.current = true;
    setState('saving');
    const res = await r.stop();
    if (res.blob.size) await A.attachRecording(taskId, noteId, res);
    closeSheet();
  };

  useEffect(() => {
    let alive = true;
    VoiceRecorder.start({
      bitrate: s.voiceBitrate || 24000,
      maxMs,
      onTick: (t) => alive && setMs(t),
      onLevel: (l) => alive && setLevel(l),
      onLimit: () => {
        showSnackbar(`Достигнута максимальная длина записи (${formatDuration(maxMs)}) — сохранено`);
        save();
      },
    }).then((r) => {
      if (!alive) {
        r.cancel();
        return;
      }
      rec.current = r;
      setState('recording');
    }).catch((e) => {
      setState('error');
      setError(e?.name === 'NotAllowedError' ? 'Нет доступа к микрофону. Разреши его в настройках сайта браузера (значок слева от адреса) и попробуй снова.'
        : e?.name === 'NotFoundError' ? 'Микрофон не найден.' : `Не удалось начать запись: ${e?.message || e}`);
    });
    return () => {
      alive = false;
      // Закрыли окно без «Готово» — запись отменяется, пустая голосовая заметка удаляется
      if (!saved.current) {
        rec.current?.cancel();
        if (newNote) A.dropEmptyNote(taskId, noteId);
      }
    };
  }, []);

  const pauseResume = () => {
    const r = rec.current;
    if (!r) return;
    if (paused) r.resume();
    else r.pause();
    setPaused(!paused);
  };
  return html`
    <${Sheet} title="Запись голоса" onClose=${closeSheet} className="recorder-sheet">
      ${state === 'error' ? html`<p class="hint warn">${error}</p><button class="btn" onClick=${closeSheet}>Закрыть</button>` : html`
        <div class="rec-face">
          <div class=${'rec-dot' + (paused || state !== 'recording' ? ' idle' : '')}></div>
          <div class="rec-time">${formatDuration(ms)}<small> / ${formatDuration(maxMs)}</small></div>
          <div class="rec-level" aria-hidden="true"><i style=${{ width: Math.round(level * 100) + '%' }}></i></div>
          <div class="rec-state">${state === 'starting' ? 'Включаю микрофон…' : state === 'saving' ? 'Сохраняю…' : paused ? 'Пауза' : 'Идёт запись'}</div>
        </div>
        <div class="rec-actions">
          <button class="btn rec-btn" onClick=${closeSheet} disabled=${state === 'saving'}>Отмена</button>
          <button class="btn rec-btn" onClick=${pauseResume} disabled=${state !== 'recording'}>${paused ? '▶ Продолжить' : '⏸ Пауза'}</button>
          <button class="btn primary rec-btn" onClick=${save} disabled=${state !== 'recording'}>✓ Готово</button>
        </div>`}
    <//>`;
}
