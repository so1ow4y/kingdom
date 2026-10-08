// Crimson Harvest (0.11, «Feast»): разделы настроек «Цели и лимиты», «Дневник и хранение», «Награды за еду» (0.12).

import { html, useState, useMemo, useEffect } from '../html.js';
import { Icon } from '../icons.js';
import { NumField, RewardEditor, rewardLine } from './FeastParts.js';
import { Link } from '../router.js';
import { getPrefs, setPrefs } from '../prefs.js';
import { store, showSnackbar } from '../../store/appState.js';
import * as FA from '../../store/feastActions.js';
import * as F from '../../core/feast.js';
import {
  dayGoals, num, macroMode, macroPcts, gramsFromPct, normalizedPct, macrosKcal, checkGoals, KCAL_RANGE, KCAL_PER_G, MACROS, NUTRIENT,
} from '../../core/nutrition.js';
import { recommendation, calcGoals } from '../../core/body.js';
import { bodyState } from './FeastProfile.js';
import { FEAST_RETENTION } from '../../config.js';
import { buildFeastDb } from '../../data/feastEnvelope.js';
import { tr } from '../../core/i18n.js';

/** Черновик формы целей из настроек. */
function goalsDraft(s) {
  const goals = dayGoals(s);
  const mode = macroMode(s);
  const grams = { protein: goals.protein, fat: goals.fat, carbs: goals.carbs };
  return { kcal: goals.kcal, mode, pct: mode === 'pct' ? macroPcts(s) : normalizedPct(grams), grams };
}

const sameDraft = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const intOf = (raw) => {
  const t = String(raw).trim();
  if (t === '') return NaN;
  const n = parseFloat(t.replace(',', '.').replace(/\s+/g, ''));
  return Number.isFinite(n) ? Math.round(n) : NaN;
};

/** Поле целого числа с черновиком (пусто или мусор — NaN, ошибку покажет проверка формы). */
function IntField({ label, value, unit, onChange, disabled, big = false, after = null, invalid = false }) {
  const [text, setText] = useState(null);
  const shown = text ?? (Number.isFinite(value) ? String(value) : '');
  return html`<label class=${'num-field' + (big ? ' big' : '') + (invalid ? ' invalid' : '')}>
    <span class="nf-label">${label}</span>
    <span class="nf-box">
      <input inputmode="numeric" value=${shown} disabled=${disabled} aria-invalid=${invalid}
        onInput=${(e) => { setText(e.target.value); onChange(intOf(e.target.value)); }} onBlur=${() => setText(null)}/>
      ${unit ? html`<small>${unit}</small>` : null}
    </span>
    ${after ? html`<small class="nf-after">${after}</small>` : null}
  </label>`;
}

/**
 * Настройки → Crimson Harvest → Цели и лимиты (0.12): лимит калорий и БЖУ — долями калорий (граммы считаются от лимита
 * сами) или граммами. Вне границ (доли не дают 100 %, граммы дают больше калорий, чем лимит) — «Сохранить» недоступна.
 */
export function FeastGoalsSection({ st = null }) {
  const s = store.feast.settings || {};
  const body = st || bodyState();
  const [calcNote, setCalcNote] = useState(null);
  const ro = !!store.ui.feastReadOnly;
  const saved = useMemo(() => goalsDraft(s), [s]);
  const [draft, setDraft] = useState(saved);
  const [base, setBase] = useState(saved);
  // настройки поменялись не из формы (другое устройство, «Сделать лимитом») — форма без правок следует за ними
  useEffect(() => {
    if (sameDraft(base, saved)) return;
    if (sameDraft(draft, base)) setDraft(saved);
    setBase(saved);
  }, [saved]);
  const r = recommendation(body.p, s);
  const calc = calcGoals(body.p, s);
  const check = checkGoals(draft);
  const dirty = !sameDraft(draft, saved);
  const kcalOk = Number.isFinite(draft.kcal) && draft.kcal >= KCAL_RANGE[0] && draft.kcal <= KCAL_RANGE[1];
  const grams = draft.mode === 'pct' ? (kcalOk ? gramsFromPct(draft.kcal, draft.pct) : null) : draft.grams;
  const setKcal = (v) => setDraft({ ...draft, kcal: v });
  const setMode = (mode) => {
    if (mode === draft.mode) return;
    // перевод без потерь смысла: доли → граммы по лимиту, граммы → доли
    if (mode === 'grams') setDraft({ ...draft, mode, grams: kcalOk ? gramsFromPct(draft.kcal, draft.pct) : draft.grams });
    else setDraft({ ...draft, mode, pct: normalizedPct(draft.grams) });
  };
  const setMacro = (k, v) => setDraft(draft.mode === 'pct' ? { ...draft, pct: { ...draft.pct, [k]: v } } : { ...draft, grams: { ...draft.grams, [k]: v } });
  const save = async (e) => {
    e?.preventDefault();
    if (check.ok && (await FA.saveGoals(draft))) {
      setDraft(goalsDraft(store.feast.settings));
      setCalcNote(null);
    }
  };
  // «Рассчитать»: лимит — рекомендация по параметрам, БЖУ — по весу и цели (в выбранном виде: граммы или доли)
  const runCalc = () => {
    if (!calc.kcal) return;
    // БЖУ посчитаны в граммах по весу — так и ставим (в процентах они бы округлились иначе); переключить можно потом
    setDraft({ ...draft, kcal: calc.kcal, mode: 'grams', grams: calc.grams, pct: normalizedPct(calc.grams) });
    setCalcNote(tr('Посчитано: {kcal} ккал ({p1}); {why}. ', { kcal: calc.kcal, p1: r.own ? tr('твоя рекомендация') : tr('расход с активностью и цель'), why: calc.why })
      + tr('БЖУ — в граммах. Проверь и нажми «Сохранить».'));
  };
  const total = draft.mode === 'pct' ? MACROS.reduce((t, k) => t + (draft.pct[k] || 0), 0) : grams ? macrosKcal(grams) : 0;
  return html`
    <form class="goals-form" onSubmit=${save}>
      <section class="set-section">
        <h2>Лимит калорий</h2>
        <div class="ne-main">
          <${IntField} big label="Лимит в день" unit="ккал" value=${draft.kcal} disabled=${ro} invalid=${!kcalOk} onChange=${setKcal}/>
        </div>
        <div class="form-actions wrap calc-row">
          <button type="button" class="btn primary" disabled=${ro || !calc.kcal} onClick=${runCalc}><${Icon} name="flame" size=${16}/> Рассчитать</button>
          <span class="muted small">${calc.kcal
            ? tr('По параметрам: {kcal} ккал, белки {protein} г, жиры {fat} г, углеводы {carbs} г', { kcal: calc.kcal, protein: calc.grams.protein, fat: calc.grams.fat, carbs: calc.grams.carbs })
            : tr('Для расчёта нужны: {p0} — заполни «Параметры» выше.', { p0: calc.missing.join(', ') })}</span>
        </div>
        ${calcNote ? html`<p class="hint" role="status">${calcNote}</p>` : null}
        <p class="muted small">От ${KCAL_RANGE[0]} до ${KCAL_RANGE[1]} ккал. В дневнике: «Осталось 247» — сколько ещё можно съесть, «−247» — насколько лимит превышен.</p>
      </section>
      <section class="set-section">
        <h2>Белки, жиры, углеводы</h2>
        <div class="chip-row" role="radiogroup" aria-label="Как задавать БЖУ">
          <button type="button" role="radio" aria-checked=${draft.mode === 'pct'} class=${'chip' + (draft.mode === 'pct' ? ' selected' : '')}
            disabled=${ro} onClick=${() => setMode('pct')}>В процентах от калорий</button>
          <button type="button" role="radio" aria-checked=${draft.mode === 'grams'} class=${'chip' + (draft.mode === 'grams' ? ' selected' : '')}
            disabled=${ro} onClick=${() => setMode('grams')}>В граммах</button>
        </div>
        <div class="ne-main macro-goals">
          ${MACROS.map((k) => {
            const kcalOf = grams ? Math.round((grams[k] || 0) * KCAL_PER_G[k]) : null;
            const after = draft.mode === 'pct'
              ? (grams ? tr('= {p0} г · {kcalOf} ккал', { p0: grams[k], kcalOf }) : '')
              : (kcalOk && Number.isFinite(grams[k]) ? tr('= {kcalOf} ккал · {p1} %', { kcalOf, p1: Math.round((kcalOf * 100) / draft.kcal) }) : '');
            return html`<${IntField} key=${draft.mode + k} label=${NUTRIENT[k].label} unit=${draft.mode === 'pct' ? '%' : tr('г')}
              value=${draft.mode === 'pct' ? draft.pct[k] : draft.grams[k]} disabled=${ro} after=${after} onChange=${(v) => setMacro(k, v)}/>`;
          })}
        </div>
        <p class=${'goals-total ' + (check.ok ? 'ok' : 'bad')} role="status">
          ${check.ok
            ? (draft.mode === 'pct' ? tr('✓ Сумма {total} % — граммы считаются от лимита сами', { total }) : tr('✓ БЖУ: {total} из {kcal} ккал{p2}', { total, kcal: draft.kcal, p2: draft.kcal - total > 0 ? tr(' (свободно {p0})', { p0: draft.kcal - total }) : '' }))
            : `⚠ ${check.error}`}
        </p>
        <p class="muted small">В процентах — доли калорий (белок и углеводы — 4 ккал в грамме, жир — 9); при смене лимита граммы пересчитываются.
          В граммах — свои числа; вместе они не могут дать больше калорий, чем лимит. По умолчанию — 20 / 30 / 50 %. Общие для всех устройств.</p>
        <div class="form-actions">
          <button type="submit" class="btn primary" disabled=${ro || !check.ok || !dirty}>Сохранить</button>
          ${dirty ? html`<button type="button" class="btn ghost" onClick=${() => setDraft(saved)}>Отменить изменения</button>` : null}
        </div>
      </section>
    </form>`;
}

function exportFeast() {
  const d = store.feast;
  const data = { settings: d.settings ? [d.settings] : [] };
  for (const c of F.FEAST_COLLECTIONS) if (c !== 'settings') data[c] = [...d[c].values()];
  const db = buildFeastDb(data, { deviceId: store.deviceId });
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `crimson-harvest-${store.now.today}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  showSnackbar(tr('Файл с данными Crimson Harvest сохранён'));
}

/** Какие заметки показывать в дневнике и на страницах рационов (0.12.5; только для этого устройства). */
function NoteDisplaySettings() {
  const p = getPrefs().feastNotes || {};
  const val = (k, def) => (typeof p[k] === 'boolean' ? p[k] : def);
  const set = (k, v) => setPrefs({ feastNotes: { ...(getPrefs().feastNotes || {}), [k]: v } });
  const row = (k, def, label, hint) => html`<label class="toggle-row compact"><input type="checkbox" checked=${val(k, def)} onChange=${(e) => set(k, e.target.checked)}/>
    <span>${label}<small>${hint}</small></span></label>`;
  return html`<section class="set-section">
    <h2>Заметки в дневнике и рационах</h2>
    ${row('itemDiary', true, tr('Заметки к продуктам записи — в дневнике'), tr('Например, «4 ед. инсулина» под продуктом'))}
    ${row('itemMeals', true, tr('Заметки к продуктам записи — на страницах рационов'), tr('Рационы → завтрак, обед…'))}
    ${row('foodDiary', false, tr('Заметка из карточки продукта — в дневнике'), tr('То, что написано в самом продукте или лекарстве'))}
    ${row('foodMeals', false, tr('Заметка из карточки продукта — на страницах рационов'), tr('Видна под продуктом на странице рациона'))}
    <p class="muted small">Только для этого устройства. Заметки к самим записям видны всегда.</p>
  </section>`;
}

export function FeastDataSection() {
  const s = store.feast.settings || {};
  const ro = !!store.ui.feastReadOnly;
  const count = F.entryCount(store.feast);
  const archived = [...store.feast.dayArchive.values()].filter((a) => !a.deletedAt).length;
  const limit = s.entryLimit || FEAST_RETENTION.entryDefault;
  const setLimit = (v) => {
    const n = Math.round(num(v));
    if (!n) return;
    FA.updateFeastSettings({ entryLimit: Math.max(FEAST_RETENTION.entryMin, Math.min(FEAST_RETENTION.entryMax, n)) });
  };
  return html`
    <${NoteDisplaySettings}/>
    <section class="set-section">
      <h2>Записи дневника</h2>
      <div class="ne-main">
        <${NumField} big label="Хранить записей" unit="шт." value=${limit} disabled=${ro} onCommit=${setLimit}/>
      </div>
      <p class="muted small">Сейчас записей: ${count}${archived ? tr(', дней в сводках: {archived}', { archived }) : ''}. Когда записей больше лимита, самые старые дни
        удаляются целиком, а их итоги (калории, БЖУ, витамины, продукты) остаются в аналитике. Записи последних ${FEAST_RETENTION.keepRecentDays} дней
        не удаляются никогда. От ${FEAST_RETENTION.entryMin} до ${FEAST_RETENTION.entryMax}.</p>
      <div class="form-actions">
        <button type="button" class="btn" disabled=${ro || count <= limit} onClick=${() => FA.purgeOldEntries({ interactive: true })}>Очистить сейчас</button>
        <button type="button" class="btn" onClick=${exportFeast}><${Icon} name="download" size=${18}/> Скачать данные Crimson Harvest (JSON)</button>
      </div>
    </section>`;
}

/** Настройки → Crimson Harvest → Награды за еду (0.12): опыт, монеты и 💎 за запись продукта по умолчанию. */
export function FeastRewardsSection() {
  const s = store.feast.settings || {};
  const ro = !!store.ui.feastReadOnly;
  const own = { xp: s.rewardXp ?? undefined, coins: s.rewardCoins ?? undefined, gems: s.rewardGems ?? undefined };
  const save = (r) => FA.updateFeastSettings({ rewardXp: r.xp ?? null, rewardCoins: r.coins ?? null, rewardGems: r.gems ?? null });
  const earned = FA.feastEarnings();
  const today = F.dayRewards(store.feast, store.now.today);
  return html`
    <section class="set-section" id="feast-rewards">
      <h2>Награды за еду</h2>
      <p class="muted">Каждая запись продукта в дневнике приносит опыт, монеты и алмазы 💎 — те же, что в деревне и магазине
        (в деревне 💎 зовутся изумрудами). Здесь — сколько по умолчанию; у любого продукта можно поставить своё в его карточке.</p>
      <${RewardEditor} rewards=${own} defaults=${F.REWARD_DEFAULTS} disabled=${ro} onChange=${save}/>
      <p class="muted small">Пустое поле — ${rewardLine(F.REWARD_DEFAULTS)}. Дробные монеты и 💎 копятся, тратятся целые.
        Награда запоминается в записи: изменения здесь действуют на новые записи. Удалил запись — награда за неё исчезает.</p>
      <div class="stat-tiles">
        <div class="stat-tile"><span>Сегодня за еду</span><b>${rewardLine(today) || '—'}</b></div>
        <div class="stat-tile"><span>За всё время</span><b>${rewardLine(earned) || '—'}</b></div>
      </div>
      ${store.data.settings?.gameEnabled ? null : html`<p class="hint">Игра выключена (Настройки → Игра): награды копятся, но монеты и уровни не показываются.</p>`}
    </section>`;
}
