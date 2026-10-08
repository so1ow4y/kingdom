// Фигура «как примерно выглядит» при данном проценте жира (0.13, вместо пиксельного манекена 0.11): схема в духе
// «Витрувианского человека» — круг и квадрат пропорций, человек анфас с чуть разведёнными руками и ногами.
// Мышцы — цветом схемы приложения (чем меньше жира, тем ярче и рельефнее), жир — жёлтым там, где он обычно
// откладывается (у мужчин — живот и бока, у женщин — бёдра, ягодицы и руки); силуэт шире с процентом жира.
// Обхваты (грудь, талия, бёдра, бицепс, бедро, шея), если есть, задают ширину по своим уровням.
// Спортивная форма — шорты (у женщин и топ): без подробностей тела. Это иллюстрация оценки, а не медицинская картинка.

import { html } from '../html.js';
import { tr } from '../../core/i18n.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const VW = 200;
const VH = 400;
const CX = 100;

/** Сглаженный путь через точки (Catmull-Rom → кривые Безье). closed — замкнуть. */
function smooth(pts, closed = true) {
  const n = pts.length;
  const p = (i) => pts[closed ? (i + n) % n : clamp(i, 0, n - 1)];
  let d = `M${p(0)[0].toFixed(1)},${p(0)[1].toFixed(1)}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return closed ? d + 'Z' : d;
}

/** Конечность: цепочка суставов [[x, y, r], …] → замкнутый контур (капсулы по отрезкам). */
function limb(joints) {
  const left = [];
  const right = [];
  for (let i = 0; i < joints.length; i++) {
    const [x, y, r] = joints[i];
    const a = joints[Math.max(0, i - 1)];
    const b = joints[Math.min(joints.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    left.push([x + nx * r, y + ny * r]);
    right.push([x - nx * r, y - ny * r]);
  }
  const end = joints.at(-1);
  const start = joints[0];
  return smooth([...left, [end[0] + (end[0] - joints.at(-2)[0]) * 0.15, end[1] + (end[1] - joints.at(-2)[1]) * 0.15], ...right.reverse(),
    [start[0] - (joints[1][0] - start[0]) * 0.12, start[1] - (joints[1][1] - start[1]) * 0.12]]);
}

/**
 * Геометрия тела: полуширины туловища на уровнях, суставы рук и ног, толщина жира по зонам.
 * bf — процент жира, ffmi — «мышечность» 0…1, m — обхваты (см), scale — единиц схемы на сантиметр роста.
 */
function geometry({ sex, bf, ffmi, m, scale }) {
  const female = sex === 'female';
  const essential = female ? 12 : 4;
  const k = clamp((bf - essential) / 28, 0, 1.4); // сколько жира сверх необходимого
  const mus = clamp(ffmi, 0, 1);
  // толщина жира по зонам (единицы схемы)
  const fat = female
    ? { chest: 4 * k, waist: 8 * k, belly: 9 * k, hips: 13 * k, thigh: 9 * k, arm: 4.5 * k, neck: 1.5 * k, calf: 2.5 * k }
    : { chest: 5 * k, waist: 12 * k, belly: 15 * k, hips: 8 * k, thigh: 5 * k, arm: 3 * k, neck: 2.5 * k, calf: 1.5 * k };
  // «сухие» полуширины (без жира)
  const lean = female
    ? { neck: 8.5, shoulder: 36 + 2 * mus, armpit: 28, chest: 28 + mus, under: 25, waist: 20, navel: 21.5, hips: 30, crotch: 18 }
    : { neck: 10 + mus, shoulder: 41 + 5 * mus, armpit: 31 + 2 * mus, chest: 32 + 3 * mus, under: 28 + mus, waist: 23 + mus, navel: 24 + mus, hips: 26.5, crotch: 19 };
  const limbR = female
    ? { upper: 8.5 + mus, elbow: 6, fore: 7, wrist: 4, thigh: 16.5 + mus, knee: 8.5, calf: 9.5 + mus, ankle: 4.5 }
    : { upper: 9.5 + 3 * mus, elbow: 6.8, fore: 8 + 1.5 * mus, wrist: 4.4, thigh: 16.5 + 3 * mus, knee: 9, calf: 10 + 2 * mus, ankle: 4.8 };
  // обхваты (если есть) задают внешнюю ширину: туловище — эллипс 1,4 : 1, конечности — круг
  const torsoHalf = (cm) => (cm / 5.39) * scale;
  const limbRad = (cm) => (cm / (2 * Math.PI)) * scale;
  const outer = {
    neck: m.neckCm ? limbRad(m.neckCm) : lean.neck + fat.neck,
    chest: m.chestCm ? torsoHalf(m.chestCm) : lean.chest + fat.chest,
    waist: m.waistCm ? torsoHalf(m.waistCm) : lean.waist + fat.waist,
    navel: m.waistCm ? torsoHalf(m.waistCm) + fat.belly * 0.15 : lean.navel + fat.belly,
    hips: m.hipCm ? torsoHalf(m.hipCm) : lean.hips + fat.hips,
    upper: m.armCm ? limbRad(m.armCm) : limbR.upper + fat.arm,
    thigh: m.thighCm ? limbRad(m.thighCm) : limbR.thigh + fat.thigh,
  };
  // жир, который «виден» по обхватам: снаружи минус сухая часть (не меньше нуля)
  const seen = {
    chest: Math.max(0, outer.chest - lean.chest), waist: Math.max(0, outer.waist - lean.waist), belly: Math.max(0, outer.navel - lean.navel),
    hips: Math.max(0, outer.hips - lean.hips), arm: Math.max(0, outer.upper - limbR.upper), thigh: Math.max(0, outer.thigh - limbR.thigh),
  };
  return { female, k, mus, lean, limbR, outer, fat, seen };
}

/** Контур туловища по полуширинам (от шеи до промежности). */
function torso(w, y) {
  const lvl = [
    [y.neck, w.neck], [y.trap, w.neck + 8], [y.shoulder, w.shoulder], [y.armpit, w.armpit], [y.chest, w.chest], [y.under, w.under],
    [y.waist, w.waist], [y.navel, w.navel], [y.hips, w.hips], [y.crotch, w.crotch],
  ];
  const right = lvl.map(([yy, hw]) => [CX + hw, yy]);
  const left = lvl.map(([yy, hw]) => [CX - hw, yy]).reverse();
  return smooth([...right, [CX + 6, y.crotch + 4], [CX - 6, y.crotch + 4], ...left]);
}

/** Пиксельная фигура заменена схемой: { sex, bf, heightCm, accent (цвет мышц), label, weightKg, m — обхваты }. */
export function BodyFigure({ sex = 'male', bf = 20, heightCm = 175, accent = 'var(--accent)', label = '', weightKg = null, m = {} }) {
  const stretch = clamp(heightCm / 175, 0.9, 1.1);
  const scale = 340 / Math.max(120, heightCm || 175); // единиц схемы на сантиметр
  const lean = weightKg ? weightKg * (1 - bf / 100) : null;
  const ffmiRaw = lean && heightCm ? lean / (heightCm / 100) ** 2 : null;
  const ffmi = ffmiRaw ? (ffmiRaw - (sex === 'female' ? 14 : 17)) / 7 : 0.4;
  const g = geometry({ sex, bf, ffmi, m: m || {}, scale });
  const sy = (v) => 24 + (v - 24) * stretch * 0.97;
  const y = {
    headTop: sy(20), chin: sy(64), neck: sy(70), trap: sy(76), shoulder: sy(84), armpit: sy(100), chest: sy(112), under: sy(128),
    waist: sy(152), navel: sy(164), hips: sy(188), crotch: sy(202), knee: sy(286), calf: sy(310), ankle: sy(352), sole: sy(364),
  };
  // руки чуть в стороны, ноги чуть расставлены — как на рисунке пропорций
  const armJ = (s) => [[CX + s * (g.outer.chest - 4), y.shoulder + 4, g.outer.upper], [CX + s * (g.outer.chest + 14), y.waist - 4, g.limbR.elbow + g.fat.arm * 0.3],
    [CX + s * (g.outer.chest + 24), y.hips + 4, g.limbR.wrist]];
  const legJ = (s) => [[CX + s * 13, y.crotch - 8, g.outer.thigh], [CX + s * 17, y.knee, g.limbR.knee + g.fat.thigh * 0.15],
    [CX + s * 19, y.calf, g.limbR.calf + g.fat.calf], [CX + s * 21, y.ankle, g.limbR.ankle]];
  const leanArmJ = (s) => armJ(s).map(([x, yy, r], i) => [x, yy, i === 0 ? g.limbR.upper : r - (i === 1 ? g.fat.arm * 0.3 : 0)]);
  const leanLegJ = (s) => legJ(s).map(([x, yy, r], i) => [x, yy, i === 0 ? g.limbR.thigh : i === 1 ? g.limbR.knee : i === 2 ? g.limbR.calf : r]);
  const wOuter = { ...g.lean, neck: g.outer.neck, chest: g.outer.chest, under: g.lean.under + (g.seen.chest + g.seen.waist) / 2, waist: g.outer.waist, navel: g.outer.navel, hips: g.outer.hips, crotch: g.lean.crotch + g.seen.hips * 0.4, shoulder: g.lean.shoulder + g.fat.chest * 0.3, armpit: g.lean.armpit + g.seen.chest * 0.6 };
  const wLean = g.lean;
  // насколько видны мышцы: сухо — ярко и рельефно, много жира — бледно
  const def = clamp(((g.female ? 34 : 26) - bf) / 16, 0.18, 1);
  const fatA = clamp(0.2 + g.k * 0.55, 0.2, 0.85);
  const muscle = { fill: accent, opacity: 0.25 + def * 0.6 };
  const line = 'var(--text)';
  const skin = 'var(--surface-2)';
  const arms = [-1, 1];
  // мышцы: дельты, грудные, бицепсы, предплечья, пресс, косые, квадрицепсы, икры
  const abs = [];
  for (let r = 0; r < 3; r++) for (const s of [-1, 1]) abs.push([CX + s * 6.2, y.under + 2 + r * 11.5, 5.2, 4.8]);
  const muscles = html`<g fill=${muscle.fill} opacity=${muscle.opacity}>
    ${arms.map((s) => html`<ellipse key=${'d' + s} cx=${CX + s * (wLean.shoulder - 4)} cy=${y.shoulder + 5} rx=${7 + g.mus * 2} ry=${9 + g.mus * 2}/>`)}
    ${g.female ? null : arms.map((s) => html`<path key=${'p' + s} d=${smooth([[CX + s * 2, y.trap + 8], [CX + s * (wLean.chest - 6), y.shoulder + 6], [CX + s * (wLean.chest - 4), y.chest + 6], [CX + s * 10, y.under - 1], [CX + s * 2, y.under - 3]])}/>`)}
    ${arms.map((s) => {
      const [a, b] = leanArmJ(s);
      return html`<ellipse key=${'b' + s} cx=${(a[0] + b[0]) / 2} cy=${(a[1] + b[1]) / 2 + 2} rx=${g.limbR.upper * 0.62} ry=${Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.36}
        transform=${`rotate(${(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI - 90} ${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2 + 2})`}/>`;
    })}
    ${arms.map((s) => {
      const [, b, c] = leanArmJ(s);
      return html`<ellipse key=${'f' + s} cx=${(b[0] * 0.6 + c[0] * 0.4)} cy=${(b[1] * 0.6 + c[1] * 0.4)} rx=${g.limbR.fore * 0.55} ry=${Math.hypot(c[0] - b[0], c[1] - b[1]) * 0.3}
        transform=${`rotate(${(Math.atan2(c[1] - b[1], c[0] - b[0]) * 180) / Math.PI - 90} ${(b[0] * 0.6 + c[0] * 0.4)} ${(b[1] * 0.6 + c[1] * 0.4)})`}/>`;
    })}
    ${abs.map(([x, yy, rw, rh], i) => html`<rect key=${'a' + i} x=${x - rw} y=${yy - rh} width=${rw * 2} height=${rh * 2} rx="2.5"/>`)}
    ${arms.map((s) => html`<path key=${'o' + s} d=${smooth([[CX + s * 13, y.under], [CX + s * (wLean.waist - 1), y.waist - 4], [CX + s * (wLean.navel - 2), y.navel + 8], [CX + s * 14, y.navel + 2]])}/>`)}
    ${arms.map((s) => {
      const [a, b] = leanLegJ(s);
      return html`<path key=${'q' + s} d=${smooth([[a[0] - s * 4, a[1] + 8], [a[0] + s * (g.limbR.thigh - 5), a[1] + 10], [b[0] + s * 6, b[1] - 12], [b[0], b[1] - 6], [b[0] - s * 5, b[1] - 14], [a[0] - s * 8, a[1] + 24]])}/>`;
    })}
    ${arms.map((s) => {
      const [, b, c] = leanLegJ(s);
      return html`<ellipse key=${'c' + s} cx=${c[0] + s * 1.5} cy=${c[1] - 4} rx=${g.limbR.calf * 0.62} ry=${(c[1] - b[1]) * 0.75}/>`;
    })}
  </g>`;
  // рельеф: тонкие линии мышц, когда жира мало
  const relief = def > 0.55 ? html`<g fill="none" stroke=${accent} stroke-width="0.9" opacity=${(def - 0.5) * 1.6}>
    <line x1=${CX} y1=${y.under - 4} x2=${CX} y2=${y.navel + 8}/>
    ${[0, 1, 2].map((r) => html`<line key=${'h' + r} x1=${CX - 11} y1=${y.under + 8 + r * 11.5} x2=${CX + 11} y2=${y.under + 8 + r * 11.5}/>`)}
  </g>` : null;
  // жир: где откладывается (полупрозрачно поверх мышц), сильнее с процентом жира
  const fatZones = html`<g fill="var(--fat)" opacity=${fatA}>
    <ellipse cx=${CX} cy=${(y.waist + y.navel) / 2 + 4} rx=${wLean.waist - 2 + g.seen.belly * 0.6} ry=${18 + g.seen.belly * 0.5}/>
    ${arms.map((s) => html`<ellipse key=${'lh' + s} cx=${CX + s * (wLean.navel + g.seen.waist * 0.3)} cy=${y.navel + 6} rx=${4 + g.seen.waist * 0.6 + (g.female ? g.seen.hips * 0.5 : 0)} ry=${14 + g.seen.hips * 0.5}/>`)}
    ${arms.map((s) => {
      const [a, b] = legJ(s);
      return html`<ellipse key=${'th' + s} cx=${a[0] + s * 3} cy=${a[1] + (b[1] - a[1]) * 0.32} rx=${g.limbR.thigh * 0.7 + g.seen.thigh * 0.8} ry=${(b[1] - a[1]) * 0.36}/>`;
    })}
    ${arms.map((s) => {
      const [a, b] = armJ(s);
      return html`<ellipse key=${'ar' + s} cx=${(a[0] + b[0]) / 2 + s * 2} cy=${(a[1] + b[1]) / 2 + 4} rx=${3 + g.seen.arm * 0.8} ry=${Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.32}/>`;
    })}
    ${g.seen.chest > 1 ? arms.map((s) => html`<ellipse key=${'ch' + s} cx=${CX + s * 13} cy=${y.chest + 4} rx=${9 + g.seen.chest * 0.6} ry=${7 + g.seen.chest * 0.4}/>`) : null}
  </g>`;
  const outerArms = arms.map((s) => html`<path key=${'oa' + s} d=${limb(armJ(s))}/>`);
  const outerLegs = arms.map((s) => html`<path key=${'ol' + s} d=${limb(legJ(s))}/>`);
  const hands = arms.map((s) => {
    const w = armJ(s)[2];
    return html`<ellipse key=${'hd' + s} cx=${w[0] + s * 2.5} cy=${w[1] + 8} rx="5.5" ry="8"/>`;
  });
  const feet = arms.map((s) => html`<ellipse key=${'ft' + s} cx=${CX + s * 23} cy=${y.sole - 3} rx="8.5" ry="4.5"/>`);
  const headRx = 17 + g.fat.neck * 0.6;
  const vitruvian = html`<g fill="none" stroke="var(--border)" stroke-width="0.8" opacity="0.9">
    <circle cx=${CX} cy=${y.navel} r=${(y.sole - y.navel) * 1.02}/>
    <rect x=${CX - (y.sole - y.headTop) / 2} y=${y.headTop} width=${y.sole - y.headTop} height=${y.sole - y.headTop}/>
  </g>`;
  return html`<figure class="body-figure body-figure-svg">
    <svg viewBox=${`0 0 ${VW} ${VH}`} width="170" height="340" role="img" aria-label=${label || tr('Фигура')}>
      ${vitruvian}
      <g fill="var(--fat)" opacity=${clamp(0.35 + g.k * 0.5, 0.35, 0.95)}>
        <path d=${torso(wOuter, y)}/>${outerArms}${outerLegs}
      </g>
      <g fill=${skin} stroke=${line} stroke-width="1" stroke-opacity="0.45">
        ${arms.map((s) => html`<path key=${'la' + s} d=${limb(leanArmJ(s))}/>`)}
        ${arms.map((s) => html`<path key=${'ll' + s} d=${limb(leanLegJ(s))}/>`)}
        <path d=${torso(wLean, y)}/>
        ${hands}${feet}
        <rect x=${CX - wLean.neck} y=${y.chin - 4} width=${wLean.neck * 2} height=${y.trap - y.chin + 6} rx="4"/>
        <ellipse cx=${CX} cy=${(y.headTop + y.chin) / 2} rx=${headRx} ry=${(y.chin - y.headTop) / 2}/>
      </g>
      ${muscles}${relief}${fatZones}
      <path d=${smooth([[CX - headRx + 1, (y.headTop + y.chin) / 2 - 2], [CX - headRx * 0.6, y.headTop + 3], [CX, y.headTop - 1], [CX + headRx * 0.6, y.headTop + 3], [CX + headRx - 1, (y.headTop + y.chin) / 2 - 2], [CX, y.headTop + 8]])}
        fill="var(--muted)" opacity="0.55"/>
      <path class="bf-shorts" d=${smooth([[CX - wOuter.navel + 1, y.navel + 10], [CX + wOuter.navel - 1, y.navel + 10], [CX + wOuter.hips + 1, y.hips + 4],
        [CX + 13 + g.outer.thigh + 1, y.crotch + 18], [CX + 4, y.crotch + 14], [CX - 4, y.crotch + 14], [CX - 13 - g.outer.thigh - 1, y.crotch + 18], [CX - wOuter.hips - 1, y.hips + 4]])}/>
      ${g.female ? html`<path class="bf-shorts" d=${smooth([[CX - wOuter.chest + 2, y.armpit + 2], [CX, y.armpit - 2], [CX + wOuter.chest - 2, y.armpit + 2], [CX + wOuter.chest - 3, y.under + 2], [CX, y.under + 4], [CX - wOuter.chest + 3, y.under + 2]])}/>` : null}
    </svg>
    ${label ? html`<figcaption>${label}</figcaption>` : null}
  </figure>`;
}

/** Подпись цветов под фигурами. */
export function FigureLegend({ accent }) {
  return html`<div class="fchart-legend figure-legend">
    <span><i class="swatch" style=${{ background: accent }}></i>${tr('мышцы (ярче — рельефнее)')}</span>
    <span><i class="swatch" style=${{ background: 'var(--fat)' }}></i>${tr('жир — где он откладывается')}</span>
  </div>`;
}
