// The card's settings in Home Assistant's card editor: what "Play for real"
// may control, without writing YAML. Everything it does not show (the floor
// plan, cheats, rules) is kept as it is.

import { DEFAULT_ALLOW, looksImportant, entityContext } from './actions.js';
import { findPeople } from './model.js';

const KINDS = [
  { pattern: 'light.*', label: 'Lights', hint: 'shoot a lamp: off; use it: on' },
  { pattern: 'switch.*', label: 'Switches and plugs', hint: 'use one on the wall: on/off; shoot it: off. Not the ones below that look important' },
  { pattern: 'media_player.*', label: 'Media players', hint: 'use the screen: play/pause; shoot it: mute' },
  { pattern: 'vacuum.*', label: 'Robot vacuums', hint: 'wake it: it cleans; kill it: it goes home' },
];
const DOOR_CLASSES = ['door', 'garage', 'gate'];

const STYLE = `
  :host { display: block; }
  h3 { margin: 18px 0 6px; font-size: 15px; font-weight: 600; }
  h3:first-child { margin-top: 4px; }
  p { margin: 0 0 8px; font-size: 13px; color: var(--secondary-text-color); }
  label { display: flex; gap: 10px; align-items: flex-start; padding: 5px 0; cursor: pointer; font-size: 14px; }
  label input { margin-top: 2px; }
  label small { display: block; color: var(--secondary-text-color); font-size: 12px; }
  .list { max-height: 220px; overflow: auto; border: 1px solid var(--divider-color, #444); border-radius: 8px; padding: 2px 10px; }
  .none { font-size: 13px; color: var(--secondary-text-color); padding: 6px 0; }
  select { font: inherit; padding: 4px 6px; }
  code { font-size: 12px; }
`;

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export class HouseWadCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._drawn = '';
  }

  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _allow() {
    return [...(this._config.allow || DEFAULT_ALLOW)];
  }

  _set(allow) {
    this._config = { ...this._config, allow };
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
    this._render();
  }

  _toggle(item, on) {
    const allow = this._allow().filter((p) => p !== item);
    if (on) allow.push(item);
    this._set(allow);
  }

  _render() {
    const hass = this._hass;
    const allow = this._allow();
    const name = (id) => (hass && hass.states[id] && hass.states[id].attributes.friendly_name) || id;
    const ids = hass ? Object.keys(hass.states).sort((a, b) => name(a).localeCompare(name(b))) : [];
    const doors = ids.filter((id) => id.startsWith('lock.') || (id.startsWith('cover.') && DOOR_CLASSES.includes(hass.states[id].attributes.device_class)));
    const important = ids.filter((id) => id.startsWith('switch.') && looksImportant(id, name(id), entityContext(hass, id)));
    const box = (item, label, hint = '') =>
      `<label><input type="checkbox" data-item="${escape(item)}" ${allow.includes(item) ? 'checked' : ''}><span>${escape(label)}${hint ? `<small>${escape(hint)}</small>` : ''}</span></label>`;
    const list = (items, empty) => (items.length ? `<div class="list">${items.map((id) => box(id, name(id), id)).join('')}</div>` : `<div class="none">${empty}</div>`);
    const skill = Number(this._config.skill || 3);
    const phones = hass ? findPeople(hass) : [];
    const follow = this._config.follow === undefined ? true : this._config.follow;
    const followOpts = [[true, 'My phone (the one linked to my person)'], ...phones.map((p) => [p.id, `${p.name}${p.person ? '' : ` (${p.id})`}`]), [false, 'Off']];
    const html = `
      <style>${STYLE}</style>
      <h3>What "Play for real" may control</h3>
      <p>Practice never touches the house. Playing for real can only change what is ticked here.</p>
      ${KINDS.map((k) => box(k.pattern, k.label, k.hint)).join('')}
      <h3>Locks and doors</h3>
      <p>One at a time: a lock or door only opens from the game if you tick it, and it asks Y/N first.</p>
      ${list(doors, 'No locks or door covers in this home.')}
      <h3>Switches left alone</h3>
      <p>These look like they run something that matters (by name, integration or room), so "Switches and plugs" never reaches them. Tick one only if you really mean it.</p>
      ${list(important, 'None: every switch looks safe to play with.')}
      <h3>Follow</h3>
      <p>With Follow on in the game, you are moved to the room your phone is in, as Bermuda sees it.${phones.length ? '' : ' No phones found yet: turn on the Companion app\'s BLE Transmitter and add it in Bermuda.'}</p>
      <label><span>Follow <select data-follow>${followOpts.map(([v, l]) => `<option value="${escape(JSON.stringify(v))}" ${JSON.stringify(v) === JSON.stringify(follow) ? 'selected' : ''}>${escape(l)}</option>`).join('')}</select></span></label>
      <h3>Difficulty</h3>
      <label><span>Skill <select data-skill>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === skill ? 'selected' : ''}>${n} ${['', "I'm too young to die", 'Hey, not too rough', 'Hurt me plenty', 'Ultra-Violence', 'Nightmare!'][n]}</option>`).join('')}</select></span></label>
      <p>The floor plan and the other options stay in the code editor${this._config.floorplan ? ' (this card has a floor plan)' : ''}.</p>`;
    if (html === this._drawn) return;
    this._drawn = html;
    const scroll = [...this.shadowRoot.querySelectorAll('.list')].map((l) => l.scrollTop);
    this.shadowRoot.innerHTML = html;
    this.shadowRoot.querySelectorAll('.list').forEach((l, i) => (l.scrollTop = scroll[i] || 0));
    this.shadowRoot.querySelectorAll('input[data-item]').forEach((el) => el.addEventListener('change', () => this._toggle(el.dataset.item, el.checked)));
    const fol = this.shadowRoot.querySelector('select[data-follow]');
    fol.addEventListener('change', () => {
      this._config = { ...this._config, follow: JSON.parse(fol.value) };
      this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
    });
    const sel = this.shadowRoot.querySelector('select[data-skill]');
    sel.addEventListener('change', () => {
      this._config = { ...this._config, skill: Number(sel.value) };
      this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
    });
  }
}

if (!customElements.get('housewad-card-editor')) customElements.define('housewad-card-editor', HouseWadCardEditor);
