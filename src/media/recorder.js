// Запись голоса (обновление 0.5; docs/TZ.md §10.2): MediaRecorder, Opus моно 16–24 кбит/с (Safari — AAC в mp4),
// пауза и продолжение, уровень громкости, длительность по таймеру (у WebM от MediaRecorder её нет в метаданных).

const TYPES = [
  ['audio/webm;codecs=opus', 'webm', 'opus'],
  ['audio/ogg;codecs=opus', 'ogg', 'opus'],
  ['audio/mp4;codecs=opus', 'm4a', 'opus'],
  ['audio/mp4', 'm4a', 'aac'],
];

export const recordingSupported = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/** 'granted' | 'denied' | 'prompt' | 'unknown' */
export async function micPermission() {
  try {
    const p = await navigator.permissions.query({ name: 'microphone' });
    return p.state;
  } catch {
    return 'unknown';
  }
}

export function pickFormat() {
  for (const [mime, ext, codec] of TYPES) {
    if (MediaRecorder.isTypeSupported?.(mime)) return { mime, ext, codec };
  }
  return { mime: '', ext: 'webm', codec: null };
}

/**
 * Запись. events: onLevel(0…1), onTick(ms), onLimit() — достигнут лимит длины (запись уже остановлена).
 * Использование: const r = await VoiceRecorder.start(...); r.pause(); r.resume(); const res = await r.stop(); r.cancel();
 */
export class VoiceRecorder {
  static async start({ bitrate = 24000, maxMs = 600000, onLevel, onTick, onLimit } = {}) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    return new VoiceRecorder(stream, { bitrate, maxMs, onLevel, onTick, onLimit });
  }

  constructor(stream, { bitrate, maxMs, onLevel, onTick, onLimit }) {
    this.stream = stream;
    this.format = pickFormat();
    this.chunks = [];
    this.maxMs = maxMs;
    this.elapsed = 0;
    this.since = performance.now();
    this.paused = false;
    this.rec = new MediaRecorder(stream, { ...(this.format.mime ? { mimeType: this.format.mime } : {}), audioBitsPerSecond: bitrate });
    this.rec.ondataavailable = (e) => {
      if (e.data && e.data.size) this.chunks.push(e.data);
    };
    this.stopped = new Promise((resolve) => {
      this.rec.onstop = resolve;
    });
    this.rec.start(1000);
    // Уровень громкости
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ac = new AC();
      const src = this.ac.createMediaStreamSource(stream);
      this.an = this.ac.createAnalyser();
      this.an.fftSize = 512;
      src.connect(this.an);
      this.buf = new Uint8Array(this.an.fftSize);
    } catch {
      this.an = null;
    }
    this.timer = setInterval(() => {
      const ms = this.duration();
      onTick?.(ms);
      if (this.an && !this.paused) {
        this.an.getByteTimeDomainData(this.buf);
        let sum = 0;
        for (const v of this.buf) sum += (v - 128) * (v - 128);
        onLevel?.(Math.min(1, Math.sqrt(sum / this.buf.length) / 50));
      } else onLevel?.(0);
      if (ms >= this.maxMs && this.rec.state !== 'inactive') {
        this.finish();
        onLimit?.();
      }
    }, 100);
  }

  duration() {
    return this.elapsed + (this.paused ? 0 : performance.now() - this.since);
  }

  pause() {
    if (this.paused || this.rec.state !== 'recording') return;
    this.elapsed += performance.now() - this.since;
    this.paused = true;
    this.rec.pause();
  }

  resume() {
    if (!this.paused || this.rec.state !== 'paused') return;
    this.since = performance.now();
    this.paused = false;
    this.rec.resume();
  }

  finish() {
    if (this.rec.state === 'inactive') return;
    this.durationMs = Math.round(this.duration());
    this.paused = true;
    this.rec.stop();
    this.release();
  }

  /** → { blob, mime, ext, codec, durationMs } */
  async stop() {
    this.finish();
    await this.stopped;
    const mime = this.rec.mimeType || this.format.mime || 'audio/webm';
    const base = mime.split(';')[0];
    const blob = new Blob(this.chunks, { type: base });
    const ext = base === 'audio/mp4' ? 'm4a' : base === 'audio/ogg' ? 'ogg' : 'webm';
    const codec = /opus/.test(mime) || ext !== 'm4a' ? 'opus' : 'aac';
    return { blob, mime: base, ext, codec, durationMs: this.durationMs ?? Math.round(this.duration()) };
  }

  cancel() {
    this.finish();
    this.chunks = [];
  }

  release() {
    clearInterval(this.timer);
    for (const tr of this.stream.getTracks()) tr.stop();
    this.ac?.close?.().catch(() => {});
  }
}
