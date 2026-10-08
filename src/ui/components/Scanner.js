// Сканер штрихкодов (обновление 0.11, Feast): камера телефона или компьютера, встроенный BarcodeDetector,
// а где его нет (Chrome на Windows, Firefox) — свой декодер EAN-13/EAN-8/UPC-A (core/barcode.js) по кадрам.
// Плюс ручной ввод и распознавание по фото. Код — только в устройство: никуда не отправляется.

import { html, useState, useEffect, useRef } from '../html.js';
import { Icon } from '../icons.js';
import { decodeImage, normalizeBarcode, barcodeWarning } from '../../core/barcode.js';
import { tr } from '../../core/i18n.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
const FRAME_MS = 140;
const MAX_SIDE = 960;

let detectorPromise = null;
/** BarcodeDetector, если браузер его умеет (с нужными форматами), иначе null. */
function nativeDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      if (!('BarcodeDetector' in self)) return null;
      try {
        const supported = await self.BarcodeDetector.getSupportedFormats();
        const formats = FORMATS.filter((f) => supported.includes(f));
        return formats.length ? new self.BarcodeDetector({ formats }) : null;
      } catch {
        return null;
      }
    })();
  }
  return detectorPromise;
}

/** Картинка (видео, ImageBitmap, img) → код или null: сначала встроенный распознаватель, потом свой. */
async function detectIn(source, canvas, w, h, { strict = true } = {}) {
  const det = await nativeDetector();
  if (det) {
    try {
      const found = await det.detect(source);
      if (found[0]?.rawValue) return normalizeBarcode(found[0].rawValue);
    } catch {
      // некоторые браузеры не любят видео в detect — дальше своим декодером
    }
  }
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(source, 0, 0, canvas.width, canvas.height);
  const r = decodeImage(g.getImageData(0, 0, canvas.width, canvas.height));
  if (!r) return null;
  return !strict || r.votes >= 2 ? r.code : null;
}

/**
 * onCode(code) — код найден или введён; onCancel — закрыть. hint — подпись над видео.
 */
export function BarcodeScanner({ onCode, onCancel = null, hint = tr('Наведи камеру на штрихкод') }) {
  const video = useRef(null);
  const canvas = useRef(null);
  const [status, setStatus] = useState('starting');
  const [manual, setManual] = useState('');
  const [photoMsg, setPhotoMsg] = useState('');
  const done = useRef(false);

  const finish = (code) => {
    if (done.current || !code) return;
    done.current = true;
    navigator.vibrate?.(60);
    onCode(code);
  };

  useEffect(() => {
    let stream = null;
    let stop = false;
    let timer = null;
    let last = null;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('nocamera');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        setStatus(e?.name === 'NotAllowedError' ? 'denied' : 'nocamera');
        return;
      }
      if (stop) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const v = video.current;
      v.srcObject = stream;
      try {
        await v.play();
      } catch {
        // play() может отказать без жеста — видео всё равно идёт после первого кадра
      }
      setStatus('scanning');
      const tick = async () => {
        if (stop || done.current) return;
        if (v.readyState >= 2 && v.videoWidth) {
          const code = await detectIn(v, canvas.current, v.videoWidth, v.videoHeight, { strict: false });
          // свой декодер может ошибиться на смазанном кадре: ждём один и тот же код два кадра подряд
          if (code && code === last) finish(code);
          last = code;
        }
        timer = setTimeout(tick, FRAME_MS);
      };
      tick();
    })();
    return () => {
      stop = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const fromPhoto = async (file) => {
    if (!file) return;
    setPhotoMsg(tr('Ищу штрихкод на фото…'));
    try {
      const bmp = await createImageBitmap(file);
      const code = await detectIn(bmp, canvas.current, bmp.width, bmp.height, { strict: false });
      bmp.close?.();
      if (code) finish(code);
      else setPhotoMsg(tr('Штрихкод на фото не найден. Сфотографируй ближе и ровнее или введи цифры.'));
    } catch {
      setPhotoMsg(tr('Не удалось открыть фото'));
    }
  };

  const typed = normalizeBarcode(manual);
  const warn = typed ? barcodeWarning(typed) : '';
  const STATUS = {
    starting: tr('Включаю камеру…'),
    scanning: hint,
    denied: tr('Браузер не дал доступ к камере. Разреши камеру для сайта (значок слева от адреса) или введи код вручную.'),
    nocamera: tr('Камера недоступна. Введи цифры под штрихкодом или распознай фото.'),
  };

  return html`
    <div class="scanner">
      ${status === 'starting' || status === 'scanning' ? html`
        <div class="scan-view">
          <video ref=${video} playsinline muted autoplay aria-label="Камера"></video>
          <div class="scan-frame" aria-hidden="true"><i class="scan-line"></i></div>
        </div>` : null}
      <canvas ref=${canvas} hidden></canvas>
      <p class=${'scan-status' + (status === 'denied' || status === 'nocamera' ? ' warn' : '')} role="status">${STATUS[status]}</p>
      <form class="scan-manual" onSubmit=${(e) => { e.preventDefault(); if (typed) finish(typed); }}>
        <label class="field">
          <span>Цифры под штрихкодом</span>
          <input inputmode="numeric" autocomplete="off" value=${manual} placeholder="4601234567890" maxlength="48"
            onInput=${(e) => setManual(e.target.value)}/>
        </label>
        <button type="submit" class="btn primary" disabled=${!typed}>Готово</button>
      </form>
      ${warn ? html`<p class="hint warn">${warn}</p>` : null}
      <div class="form-actions">
        <label class="btn">
          <${Icon} name="camera" size=${18}/> Распознать по фото
          <input type="file" accept="image/*" capture="environment" hidden onChange=${(e) => fromPhoto(e.target.files?.[0])}/>
        </label>
        ${onCancel ? html`<button type="button" class="btn ghost" onClick=${onCancel}>Отмена</button>` : null}
      </div>
      ${photoMsg ? html`<p class="hint">${photoMsg}</p>` : null}
    </div>`;
}
