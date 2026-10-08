// Горячие клавиши (обновление 0.10): раздел настроек «Интерфейс → Горячие клавиши» (переназначить, отключить,
// вернуть по умолчанию) и шпаргалка по «?». Реестр и обработка нажатий — ui/keys.js.

import { html, useState, useEffect } from '../html.js';
import { Icon } from '../icons.js';
import { Sheet } from './Sheet.js';
import { navigate } from '../router.js';
import { closeSheet } from '../../store/appState.js';
import { getPrefs, setPrefs } from '../prefs.js';
import {
  SHORTCUTS, SHORTCUT_GROUPS, FIXED, bindingOf, comboParts, formatCombo, ruLetter, comboFromEvent, conflictOf, isReserved,
  assign, resetShortcut, resetAllShortcuts, recorder, shortcutsOn, IS_MAC,
} from '../keys.js';
import { tr } from '../../core/i18n.js';

/** Сочетание клавишами-«колпачками»: Ctrl + S. */
export function Keys({ combo, empty = tr('не назначено') }) {
  if (!combo) return html`<span class="keys none">${empty}</span>`;
  const parts = comboParts(combo);
  const ru = ruLetter(combo);
  return html`<span class="keys" title=${ru ? tr('В русской раскладке — та же кнопка «{ru}»', { ru }) : undefined}>
    ${parts.map((p, i) => html`${i && !IS_MAC ? html`<span class="keys-plus">+</span>` : null}<kbd class="keycap">${p}</kbd>`)}
    ${ru ? html`<small class="keys-ru">${ru}</small>` : null}
  </span>`;
}

function Recorder({ id, onDone }) {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    recorder.active = true;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        onDone();
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return; // пока только модификаторы — ждём основную кнопку
      if (isReserved(combo)) {
        setMsg({ text: tr('«{p0}» занято браузером или системой — выбери другое сочетание.', { p0: formatCombo(combo) }) });
        return;
      }
      const other = conflictOf(combo, id);
      if (other) {
        setMsg({ text: tr('«{p0}» уже у действия «{label}».', { p0: formatCombo(combo), label: other.label }), combo, other });
        return;
      }
      assign(id, combo);
      onDone();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      recorder.active = false;
      window.removeEventListener('keydown', onKey, true);
    };
  }, [id]);
  return html`
    <div class="sc-recorder" role="status" aria-live="polite">
      <span class="sc-wait"><span class="sc-dot"></span>Нажми сочетание… <small>Esc — отмена</small></span>
      ${msg ? html`<span class=${'sc-msg' + (msg.other ? ' warn' : ' danger')}>${msg.text}</span>` : null}
      ${msg?.other ? html`<span class="sc-actions">
        <button type="button" class="btn small primary" onClick=${() => { assign(id, msg.combo); onDone(); }}>Переназначить сюда</button>
        <button type="button" class="btn small" onClick=${onDone}>Отмена</button></span>` : html`
        <button type="button" class="btn small ghost" onClick=${onDone}>Отмена</button>`}
    </div>`;
}

/** Раздел настроек. */
export function ShortcutsSection() {
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('');
  const on = shortcutsOn();
  const own = getPrefs().shortcuts || {};
  const changed = Object.keys(own).length;
  const needle = filter.trim().toLowerCase();
  const visible = (s) => !needle || `${s.group} ${s.label} ${s.hint || ''} ${formatCombo(bindingOf(s.id))}`.toLowerCase().includes(needle);

  return html`
    <section class="set-section" id="shortcuts">
      <h2>Горячие клавиши</h2>
      <label class="toggle-row first">
        <input type="checkbox" checked=${on} onChange=${(e) => setPrefs({ shortcutsOn: e.target.checked })}/>
        <span>Включены<small>Работают, когда курсор не в поле ввода; сочетания с Ctrl, Alt или ⌘ — и при вводе текста.
          Кнопки узнаются по месту на клавиатуре, а не по букве: при русской раскладке «N» — это «Т».</small></span>
      </label>
      <div class="sc-toolbar">
        <div class="search-field">
          <${Icon} name="search" size=${16}/>
          <input type="search" value=${filter} placeholder="Найти действие или клавишу" aria-label="Найти действие"
            onInput=${(e) => setFilter(e.target.value)}/>
        </div>
        <button type="button" class="btn small" disabled=${!changed} onClick=${() => { setEditing(null); resetAllShortcuts(); }}>
          <${Icon} name="restore" size=${16}/> Всё по умолчанию</button>
      </div>
      <div class=${'sc-groups' + (on ? '' : ' off')}>
        ${SHORTCUT_GROUPS.map((g) => {
          const rows = SHORTCUTS.filter((s) => s.group === g && visible(s));
          if (!rows.length) return null;
          return html`
            <div class="sc-group" key=${g}>
              <h3 class="set-sub">${g}</h3>
              ${rows.map((s) => {
                const combo = bindingOf(s.id);
                const custom = Object.prototype.hasOwnProperty.call(own, s.id);
                return html`
                  <div class=${'sc-row' + (editing === s.id ? ' editing' : '')} key=${s.id}>
                    <div class="sc-label">${s.label}${s.hint ? html`<small>${s.hint}</small>` : null}</div>
                    ${editing === s.id ? html`<${Recorder} id=${s.id} onDone=${() => setEditing(null)}/>` : html`
                      <div class="sc-keys"><${Keys} combo=${combo}/>${custom ? html`<span class="sc-custom" title="Изменено">•</span>` : null}</div>
                      <div class="sc-buttons">
                        <button type="button" class="icon-btn" title="Изменить" aria-label=${tr('Изменить: ') + s.label} onClick=${() => setEditing(s.id)}>
                          <${Icon} name="edit" size=${17}/></button>
                        <button type="button" class="icon-btn" title="Отключить" aria-label=${tr('Отключить: ') + s.label} disabled=${!combo}
                          onClick=${() => assign(s.id, null)}><${Icon} name="close" size=${17}/></button>
                        <button type="button" class="icon-btn" title=${s.def ? tr('По умолчанию: ') + formatCombo(s.def) : tr('По умолчанию не назначено')}
                          aria-label=${tr('Вернуть по умолчанию: ') + s.label} disabled=${!custom} onClick=${() => resetShortcut(s.id)}>
                          <${Icon} name="restore" size=${17}/></button>
                      </div>`}
                  </div>`;
              })}
            </div>`;
        })}
        ${!needle || tr('esc закрыть').includes(needle) ? html`
          <div class="sc-group">
            <h3 class="set-sub">Всегда</h3>
            ${FIXED.map((f) => html`<div class="sc-row fixed" key=${f.combo}>
              <div class="sc-label">${f.label}<small>Не переназначается</small></div><div class="sc-keys"><${Keys} combo=${f.combo}/></div><div class="sc-buttons"></div></div>`)}
          </div>` : null}
      </div>
      <p class="muted small">Сочетания хранятся только на этом устройстве. Список всех клавиш открывается по <${Keys} combo=${bindingOf('help')} empty="(не назначено)"/>.</p>
    </section>`;
}

/** Шпаргалка: все назначенные клавиши по группам. */
export function ShortcutsSheet() {
  const on = shortcutsOn();
  return html`
    <${Sheet} title="Горячие клавиши" onClose=${closeSheet} className="shortcuts-sheet">
      ${on ? null : html`<p class="hint warn">Горячие клавиши выключены — включить можно в настройках.</p>`}
      <div class="sc-cheat">
        ${SHORTCUT_GROUPS.map((g) => html`
          <div class="sc-cheat-group" key=${g}>
            <h3>${g}</h3>
            ${SHORTCUTS.filter((s) => s.group === g && bindingOf(s.id)).map((s) => html`
              <div class="sc-cheat-row" key=${s.id}><span>${s.label}</span><${Keys} combo=${bindingOf(s.id)}/></div>`)}
          </div>`)}
        <div class="sc-cheat-group">
          <h3>Всегда</h3>
          ${FIXED.map((f) => html`<div class="sc-cheat-row" key=${f.combo}><span>${f.label}</span><${Keys} combo=${f.combo}/></div>`)}
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn" onClick=${() => { closeSheet(); navigate('/settings?section=shortcuts'); }}>
          <${Icon} name="keyboard" size=${18}/> Настроить</button>
      </div>
    <//>`;
}
