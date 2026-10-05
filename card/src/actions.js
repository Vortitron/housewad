// What the game is allowed to do to the house, and how it does it.
//
// Real mode calls Home Assistant services. Practice mode starts from a
// snapshot of the house and plays the same calls out locally, so nothing in
// the real house moves. Live changes still show through for anything the
// game has not touched.

import { domainOf, matches } from './model.js';

export const DEFAULT_ALLOW = ['light.*', 'switch.*', 'media_player.*', 'vacuum.*'];

// Locks and doors only ever by exact entity id, never by pattern.
const EXACT_ONLY = ['lock', 'cover', 'alarm_control_panel', 'garage_door'];

const MIN_GAP_PER_ENTITY = 1500; // ms; a chaingun on a bulb is a strobe
const MIN_GAP_GLOBAL = 200;

export function makeAllow(patterns = DEFAULT_ALLOW) {
  const warnings = [];
  const usable = [];
  for (const p of patterns) {
    const domain = p.split('.')[0];
    if (EXACT_ONLY.includes(domain) && p.includes('*')) {
      warnings.push(`"${p}" ignored: ${domain} entities must be listed one by one`);
      continue;
    }
    usable.push(p);
  }
  return {
    patterns: usable,
    warnings,
    allows: (entityId) => usable.some((p) => matches(p, entityId)),
  };
}

export class HouseActions {
  // getHass: () => current hass object. mode: 'real' | 'practice'.
  constructor({ getHass, mode, allow, onChange }) {
    this.getHass = getHass;
    this.mode = mode;
    this.allow = allow;
    this.onChange = onChange || (() => {});
    this.overrides = new Map();
    this.lastCall = new Map();
    this.lastAny = 0;
    this.timers = new Set();
  }

  close() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  state(entityId) {
    if (!entityId) return null;
    const override = this.overrides.get(entityId);
    if (override) return override;
    const hass = this.getHass();
    return (hass && hass.states[entityId]) || null;
  }

  allowed(entityId) {
    return this.mode === 'practice' || this.allow.allows(entityId);
  }

  // Returns { ok, reason } straight away; the house catches up later.
  call(entityId, service, data = {}) {
    const domain = domainOf(entityId);
    if (!this.allowed(entityId)) return { ok: false, reason: 'not-allowed' };
    const now = Date.now();
    if (now - (this.lastCall.get(entityId) || 0) < MIN_GAP_PER_ENTITY) return { ok: false, reason: 'too-fast' };
    if (now - this.lastAny < MIN_GAP_GLOBAL) return { ok: false, reason: 'too-fast' };
    this.lastCall.set(entityId, now);
    this.lastAny = now;

    if (this.mode === 'practice') {
      this._simulate(entityId, domain, service, data);
      return { ok: true };
    }
    const hass = this.getHass();
    Promise.resolve(hass.callService(domain, service, { entity_id: entityId, ...data })).catch((err) => {
      this.onChange({ entityId, error: (err && err.message) || String(err) });
    });
    return { ok: true };
  }

  _set(entityId, state, attributes = {}) {
    const base = this.state(entityId) || { entity_id: entityId, state: 'off', attributes: {} };
    this.overrides.set(entityId, {
      ...base,
      state,
      attributes: { ...base.attributes, ...attributes },
      last_changed: new Date().toISOString(),
    });
    this.onChange({ entityId });
  }

  _later(ms, fn) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  _simulate(entityId, domain, service, data) {
    const cur = this.state(entityId);
    const on = cur && cur.state === 'on';
    switch (`${domain}.${service}`) {
      case 'light.turn_on':
        return this._set(entityId, 'on', { brightness: data.brightness ?? 255 });
      case 'light.turn_off':
      case 'switch.turn_off':
        return this._set(entityId, 'off');
      case 'switch.turn_on':
        return this._set(entityId, 'on');
      case 'light.toggle':
      case 'switch.toggle':
        return this._set(entityId, on ? 'off' : 'on', domain === 'light' && !on ? { brightness: 255 } : {});
      case 'media_player.media_play_pause':
        return this._set(entityId, cur && cur.state === 'playing' ? 'paused' : 'playing');
      case 'media_player.volume_mute':
        return this._set(entityId, cur ? cur.state : 'on', { is_volume_muted: !!data.is_volume_muted });
      case 'vacuum.start':
        return this._set(entityId, 'cleaning');
      case 'vacuum.return_to_base':
        this._set(entityId, 'returning');
        return this._later(8000, () => this._set(entityId, 'docked'));
      case 'lock.unlock':
        this._set(entityId, 'unlocking');
        return this._later(1500, () => this._set(entityId, 'unlocked'));
      case 'lock.lock':
        this._set(entityId, 'locking');
        return this._later(1500, () => this._set(entityId, 'locked'));
      case 'cover.open_cover':
        this._set(entityId, 'opening');
        return this._later(3000, () => this._set(entityId, 'open'));
      case 'cover.close_cover':
        this._set(entityId, 'closing');
        return this._later(3000, () => this._set(entityId, 'closed'));
      default:
        return undefined;
    }
  }
}
