// Feast (обновление 0.11): пиксельный манекен «как примерно выглядит» при данном проценте жира — для «Обо мне»
// и аналитики тела. Фигура строится по строкам: ширина плеч, талии, бёдер, рук и ног зависит от пола и процента
// жира, рост слегка вытягивает силуэт. Одежда — футболка (у женщин — топ с рукавами) и шорты: спокойный
// спортивный вид, без подробностей тела. Это иллюстрация оценки, а не медицинская картинка.

import { html, useEffect, useRef } from '../html.js';

const FW = 56; // ширина холста в пикселях фигуры
const FH = 112;

const SKINS = ['#f2c9a5', '#e0ac85', '#c68e64', '#8d5a3b'];

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

/**
 * Полуширины тела по высоте y (0…FH): { torso, arm (центр и толщина), legs }.
 * bf — процент жира, sex — 'male' | 'female', stretch — вытягивание по росту (0.92…1.08).
 */
function shapeAt(y, bf, sex, stretch) {
  const f = clamp((bf - 5) / 40, 0, 1.2); // 0 — сухой, 1 — около 45 %
  const male = sex !== 'female';
  const s = (v) => v * stretch; // вертикальные отметки
  const shoulderY = s(23);
  const waistY = s(46);
  const hipY = s(55);
  const crotchY = s(60);
  const footY = FH - 6;
  const shoulder = (male ? 12.5 : 10.5) + f * 2.2;
  const chest = (male ? 11 : 9.8) + f * 3.2;
  const waist = (male ? 8.4 : 7.2) + f * 7.5;
  const hip = (male ? 9 : 10.6) + f * 4.8;
  let torso = 0;
  if (y >= s(20) && y < shoulderY) torso = 3 + ((y - s(20)) / (shoulderY - s(20))) * (shoulder - 3);
  else if (y >= shoulderY && y < s(34)) torso = shoulder + ((y - shoulderY) / (s(34) - shoulderY)) * (chest - shoulder);
  else if (y >= s(34) && y < waistY) {
    const t = (y - s(34)) / (waistY - s(34));
    torso = chest + t * (waist - chest) + Math.sin(t * Math.PI) * f * 2.5; // живот
  } else if (y >= waistY && y < hipY) torso = waist + ((y - waistY) / (hipY - waistY)) * (hip - waist);
  else if (y >= hipY && y < crotchY) torso = hip;
  // ноги: от промежности к ступням; вверху бёдра сходятся, ниже колена — икры, у щиколотки тоньше
  let leg = null;
  if (y >= crotchY && y < footY) {
    const t = (y - crotchY) / (footY - crotchY);
    const lerp = (a, b, k) => a + (b - a) * k;
    const top = { c: (hip + 0.6) / 2, w: (hip - 0.6) / 2 };
    const knee = { c: 3.7 + f * 1.4, w: 2.9 + f * 1.1 };
    const calf = { c: 3.8 + f * 1.3, w: 3.2 + f * 1.2 };
    const ankle = { c: 3.5 + f * 0.6, w: 1.9 + f * 0.4 };
    const [a, b, k] = t < 0.45 ? [top, knee, t / 0.45] : t < 0.65 ? [knee, calf, (t - 0.45) / 0.2] : [calf, ankle, (t - 0.65) / 0.35];
    leg = { center: lerp(a.c, b.c, k), w: lerp(a.w, b.w, k) };
  }
  // руки: от плеча (заходят на него) вниз, чуть в стороны — тем больше, чем шире талия
  let arm = null;
  if (y >= shoulderY && y < s(64)) {
    const t = (y - shoulderY) / (s(64) - shoulderY);
    const w = (male ? 2.6 : 2.2) + f * 1.5 - t * 0.7;
    arm = { center: shoulder + w - 1.4 + t * (1.2 + f * 2.2), w };
  }
  return { torso, leg, arm, shoulderY, waistY, hipY, crotchY };
}

function draw(canvas, { sex, bf, heightCm, skin, shirt, shorts, hair }) {
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, FW, FH);
  const px = new Map(); // "x,y" → цвет
  const stretch = clamp(Number.isFinite(heightCm) ? 0.92 + ((heightCm - 150) / 50) * 0.16 : 1, 0.9, 1.08);
  const cx = FW / 2;
  const put = (x, y, c) => {
    if (x >= 0 && x < FW && y >= 0 && y < FH) px.set(x + ',' + y, c);
  };
  // голова и шея
  const headY = 4 * stretch + 6;
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - headY;
      if ((dx * dx) / 36 + (dy * dy) / 49 <= 1) put(x, y, skin);
      if (y >= headY + 6 && y < 20 * stretch && Math.abs(dx) < 2.6 + bf / 40) put(x, y, skin);
    }
  }
  // тело, руки, ноги
  for (let y = 0; y < FH; y++) {
    const s = shapeAt(y, bf, sex, stretch);
    for (let x = 0; x < FW; x++) {
      const dx = Math.abs(x + 0.5 - cx);
      let c = null;
      if (s.torso && dx <= s.torso) c = y < s.waistY + 2 ? shirt : y < s.crotchY + 2 ? shorts : skin;
      if (s.arm && Math.abs(dx - s.arm.center) <= s.arm.w) c = y < s.shoulderY + (sex === 'female' ? 5 : 8) ? shirt : skin;
      if (s.leg && Math.abs(dx - s.leg.center) <= s.leg.w) c = y < s.crotchY + 10 ? shorts : skin;
      // обувь
      if (y >= FH - 6 && y < FH - 3) {
        const foot = shapeAt(FH - 7, bf, sex, stretch).leg;
        if (foot && Math.abs(dx - foot.center) <= foot.w + 1.2) c = '#2a2630';
      }
      if (c) put(x, y, c);
    }
  }
  // волосы
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - headY;
      const inHead = (dx * dx) / 36 + (dy * dy) / 49 <= 1;
      if (inHead && dy < -2.2 + Math.abs(dx) * 0.15) put(x, y, hair);
      if (sex === 'female' && !inHead && dy > -6 && dy < 9 && Math.abs(dx) >= 5 && Math.abs(dx) <= 7.2 && (dx * dx) / 52 + (dy * dy) / 81 <= 1.15) put(x, y, hair);
    }
  }
  // глаза
  put(Math.round(cx - 3), Math.round(headY + 1), '#2b2b33');
  put(Math.round(cx + 2), Math.round(headY + 1), '#2b2b33');
  // заливка, светотень и обводка
  const shade = (hex, k) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => clamp(Math.round(v * k), 0, 255);
    return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
  };
  for (const [key, c] of px) {
    const [x, y] = key.split(',').map(Number);
    const right = !px.has(x + 1 + ',' + y);
    g.fillStyle = right ? shade(c, 0.82) : x < cx - 1 && !px.has(x - 2 + ',' + y) ? shade(c, 1.08) : c;
    g.fillRect(x, y, 1, 1);
  }
  g.fillStyle = 'rgba(20,14,18,.75)';
  for (const key of px.keys()) {
    const [x, y] = key.split(',').map(Number);
    for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!px.has(x + ax + ',' + (y + ay))) g.fillRect(x + ax, y + ay, 1, 1);
    }
  }
}

/** Фигура: sex, bf (процент жира), heightCm; label — подпись под ней. */
export function BodyFigure({ sex = 'male', bf = 20, heightCm = 175, label = '', scale = 3, accent = '#8e2a3a' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    draw(ref.current, {
      sex, bf: Number.isFinite(bf) ? bf : 20, heightCm,
      skin: SKINS[1], shirt: accent, shorts: '#3b3f52', hair: sex === 'female' ? '#4a2c22' : '#3a2a22',
    });
  }, [sex, Math.round((bf || 0) * 2), heightCm, accent]);
  return html`<figure class="body-figure">
    <canvas ref=${ref} width=${FW} height=${FH} style=${{ width: FW * scale + 'px', height: FH * scale + 'px' }}
      role="img" aria-label=${`Фигура при ${Math.round(bf)} % жира`}></canvas>
    ${label ? html`<figcaption>${label}</figcaption>` : null}
  </figure>`;
}
