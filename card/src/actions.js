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
const MIN_GAP_GLOBAL = 200; // ms between calls; extra calls wait their turn
const MAX_QUEUE = 8;
const STROBE_DOMAINS = ['light', 'switch'];

// Switches that look like they matter. A pattern like switch.* never reaches
// them; naming one exactly in the allowlist does, because then somebody
// chose it. Names alone miss too much on a real home (a PDU's outlets, a
// hypervisor's VMs, a home battery), so the integration behind a switch and
// the room it is in count too.
export const IMPORTANT_HINTS = [
  'boiler', 'heater', 'heating', 'furnace', 'immersion', 'hot_water', 'water_heater', 'geyser',
  'freezer', 'fridge', 'refrigerator',
  'pump', 'sump', 'well',
  'oven', 'hob', 'stove', 'kettle',
  'dishwasher', 'washer', 'washing', 'dryer', 'child_lock',
  'server', 'router', 'modem', 'network', 'firewall', 'switchport',
  'esxi', 'proxmox', 'hypervisor', 'virtual', 'rack',
  'battery', 'inverter', 'solar', 'grid',
  'alarm', 'siren', 'smoke', 'security', 'door', 'gate', 'garage', 'lock',
  'medical', 'oxygen', 'cpap',
  'charger', 'ev_', 'car',
  'irrigation', 'sprinkler',
];
// Too short to match as a word start ("ups" in "upstairs"): whole words only.
export const IMPORTANT_WORDS = ['nas', 'vm', 'host', 'ups', 'pdu', 'poe', 'ems', 'nvr'];
// Integrations whose switches run machines, not lamps.
export const IMPORTANT_PLATFORMS = [
  'esxi_stats', 'vmware', 'proxmoxve', 'unraid', 'truenas', 'synology_dsm', 'qnap', 'qnap_qsw',
  'apc_pdu', 'apcupsd', 'nut', 'snmp', 'netgear', 'fritz', 'unifi', 'tplink_omada', 'omada',
  'opnsense', 'pfsense', 'mikrotik', 'openwrt', 'wake_on_lan', 'shell_command', 'command_line',
  'home_connect', 'miele', 'electrolux', 'candy', 'smartthinq_sensors', 'lg_thinq',
  'victron', 'solaredge', 'sma', 'huawei_solar', 'growatt_server', 'goodwe', 'fronius',
  'enphase_envoy', 'solax', 'foxess', 'tesla_fleet', 'teslemetry', 'tessie', 'powerwall',
  'wallbox', 'easee', 'zaptec', 'ocpp', 'myenergi', 'ohme', 'evcc',
];
// Rooms where a switch is infrastructure.
export const IMPORTANT_ROOMS = ['comms', 'server', 'network', 'rack', 'plant', 'boiler'];
const IMPORTANT_DOMAINS = ['switch'];

const words = (text) => ` ${String(text || '').toLowerCase().replace(/[^a-z0-9_]+/g, ' ')} `;
const startsWord = (text, h) => new RegExp(`[ ._]${h.replace('_', '[ _]?')}`).test(text);
const wholeWord = (text, w) => new RegExp(`[ ._]${w}[0-9]*(?=[ ._])`).test(text);

// context: { platform, area } from the entity registry, when known.
export function looksImportant(entityId, name = '', context = {}) {
  if (!IMPORTANT_DOMAINS.includes(entityId.split('.')[0])) return false;
  if (context.platform && IMPORTANT_PLATFORMS.includes(context.platform)) return true;
  if (context.area && IMPORTANT_ROOMS.some((r) => startsWord(words(context.area), r))) return true;
  const text = words(`${entityId} ${name}`);
  return IMPORTANT_HINTS.some((h) => startsWord(text, h)) || IMPORTANT_WORDS.some((w) => wholeWord(text, w));
}

// Which integration an entity comes from and which room it is in.
export function entityContext(hass, entityId) {
  const entry = hass && hass.entities && hass.entities[entityId];
  if (!entry) return {};
  const device = entry.device_id && hass.devices ? hass.devices[entry.device_id] : null;
  const areaId = entry.area_id || (device && device.area_id);
  const area = areaId && hass.areas && hass.areas[areaId];
  return { platform: entry.platform, area: area ? `${area.area_id} ${area.name || ''}` : areaId || '' };
}

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
  const exact = new Set(usable.filter((p) => !p.includes('*')));
  return {
    patterns: usable,
    warnings,
    // 'yes', 'no', or 'important' (matched only by a pattern, and it looks
    // like something that matters).
    verdict(entityId, name = '', context = {}) {
      if (exact.has(entityId)) return 'yes';
      if (!usable.some((p) => matches(p, entityId))) return 'no';
      return looksImportant(entityId, name, context) ? 'important' : 'yes';
    },
    allows(entityId, name = '', context = {}) {
      return this.verdict(entityId, name, context) === 'yes';
    },
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
    this.queue = [];
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
    return this.mode === 'practice' || this.allow.allows(entityId, this._name(entityId), this._context(entityId));
  }

  _name(entityId) {
    const st = this.state(entityId);
    return (st && st.attributes && st.attributes.friendly_name) || '';
  }

  _context(entityId) {
    return entityContext(this.getHass(), entityId);
  }

  // Returns { ok, reason } straight away; the house catches up later.
  // domain defaults to the entity's own (fly_house.loom targets a sensor).
  call(entityId, service, data = {}, domain = domainOf(entityId), allowedAnyway = false) {
    if (!allowedAnyway && !this.allowed(entityId)) {
      const important = this.allow.verdict(entityId, this._name(entityId), this._context(entityId)) === 'important';
      return { ok: false, reason: 'not-allowed', important };
    }
    const now = Date.now();
    // Lights and plugs are limited per entity (flicker is the risk); anything
    // else only per action, so waking the vacuum then killing it both count.
    const limitKey = STROBE_DOMAINS.includes(domain) ? entityId : `${entityId} ${service}`;
    if (now - (this.lastCall.get(limitKey) || 0) < MIN_GAP_PER_ENTITY) return { ok: false, reason: 'too-fast' };
    if (this.queue.length >= MAX_QUEUE) return { ok: false, reason: 'too-fast' };
    this.lastCall.set(limitKey, now);
    this.queue.push({ entityId, domain, service, data });
    this._drain();
    return { ok: true };
  }

  _drain() {
    if (this.draining) return;
    const wait = Math.max(0, this.lastAny + MIN_GAP_GLOBAL - Date.now());
    if (wait > 0) {
      this.draining = true;
      this._later(wait, () => {
        this.draining = false;
        this._drain();
      });
      return;
    }
    const next = this.queue.shift();
    if (!next) return;
    this.lastAny = Date.now();
    this._send(next);
    if (this.queue.length) this._drain();
  }

  _send({ entityId, domain, service, data }) {
    if (this.mode === 'practice') {
      this._simulate(entityId, domain, service, data);
      return;
    }
    const hass = this.getHass();
    Promise.resolve(hass.callService(domain, service, { entity_id: entityId, ...data })).catch((err) => {
      this.onChange({ entityId, error: (err && err.message) || String(err) });
    });
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
