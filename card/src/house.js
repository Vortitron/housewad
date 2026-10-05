// The live link between a running level and the house.
//
// House -> game: room light levels follow the real lights, lamps light up,
// switches and screens show their state, doors open and close, and the
// house's problems turn up as monsters.
// Game -> house: shooting, using and killing things become service calls,
// through HouseActions (allowlist, rate limits, practice mode).

import { friendlyName } from './model.js';
import { SPECIAL } from './mapgen.js';

const EV = { LEVEL: 1, SHOT: 2, WAKE: 3, KILL: 4, GONE: 5, USE: 6, SHOOT_LINE: 7, CONFIRM: 8, HURT: 9, EXIT: 10 };
const SPAWN = { FOG: 1, DORMANT: 2, AMBUSH: 4, COUNT: 8 };

const MONSTER_SLOT_BASE = 2000;
const MAX_MONSTERS = 14;
const MAX_IMPS = 6;

export const DEFAULT_RULES = {
  empty_minutes: 10, // a light on in a room nobody has been in for this long is wasted
  standby_min: 0.3, // watts: below this a switched-on plug is really idle
  standby_max: 15, // watts: above this it is doing something useful
};

// Doom's HUD font has capitals and ASCII punctuation only.
// Doom's message box: same font, but line breaks allowed.
export function boxText(s) {
  return String(s)
    .split('\n')
    .map((line) => hudText(line))
    .join('\n');
}

export function hudText(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .toUpperCase()
    .slice(0, 100);
}

const isOn = (st) => !!st && st.state === 'on';
const ago = (st) => (st && st.last_changed ? Date.now() - new Date(st.last_changed).getTime() : Infinity);

export class HouseLink {
  constructor({ engine, manifest, house, actions, rules = {}, confirmUnlock = true, flies = true, palette = null, cheats = {}, exitScene = null, onConfirm, log }) {
    this.engine = engine;
    this.m = engine.module;
    this.manifest = manifest;
    this.house = house;
    this.actions = actions;
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.log = log || (() => {});
    this.confirmUnlock = confirmUnlock;
    this.fliesOn = flies !== false;
    this.cheats = cheats || {};
    this.exitScene = exitScene;
    this.tally = new Map();
    this.last = null;
    this.items = new Map(); // key -> { slot, room, present, pickedAt, tracker }
    this.itemSlot = new Map(); // slot -> key
    this.onConfirm = onConfirm || (() => {});
    this.confirms = new Map();
    this.nextConfirm = 1;
    this.ready = false;
    this.out = this.m._malloc(8 * 4);
    this.monsters = new Map(); // key -> { slot, alive, killedAt, dormant, spot }
    this.slotKey = new Map(); // slot -> key
    this.nextSlot = MONSTER_SLOT_BASE;
    this.currentRoom = null;
    this.type = {};
    for (const name of ['lamp', 'zombieman', 'imp', 'demon', 'lostsoul', 'cacodemon', 'arachnotron', 'redcard', 'bluecard', 'yellowcard', 'redskull', 'blueskull', 'yellowskull', 'backpack'])
      this.type[name] = this.m.ccall('hw_type', 'number', ['string'], [name]);

    this.roomInfo = new Map(manifest.rooms.map((r) => [r.id, r]));
    this.houseRoom = new Map(house.rooms.map((r) => [r.id, r]));
    this.lampSlot = new Map(manifest.lamps.map((l, i) => [i + 1, l]));
    this.lines = new Map(Object.entries(manifest.lines).map(([k, v]) => [Number(k), v]));
    this.doorById = new Map(manifest.doors.map((d) => [d.id, d]));
    this._initCameras(palette);
  }

  // Cameras: each screen on the wall is a texture the camera's picture is
  // written into, about once a second while the player is near enough to see.
  _initCameras(palette) {
    this.cams = [];
    if (!palette || !this.manifest.cameras || !this.manifest.cameras.length || typeof document === 'undefined') return;
    this.palette = palette;
    this.paletteCache = new Int16Array(32768).fill(-1);
    for (const cam of this.manifest.cameras) {
      const tex = this.m.ccall('hw_texture_lookup', 'number', ['string', 'number'], [cam.texture, this.out]);
      if (tex < 0) continue;
      const w = this.m.HEAP32[this.out >> 2];
      const h = this.m.HEAP32[(this.out >> 2) + 1];
      this.cams.push({ ...cam, tex, w, h, busy: false, last: 0 });
    }
    if (!this.cams.length) return;
    const max = Math.max(...this.cams.map((c) => c.w * c.h));
    this.camBuf = this.m._malloc(max);
    this.camCanvas = document.createElement('canvas');
    this.camCtx = this.camCanvas.getContext('2d', { willReadFrequently: true });
  }

  _nearestColour(r, g, b) {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let idx = this.paletteCache[key];
    if (idx >= 0) return idx;
    let best = 0;
    let bestD = Infinity;
    const p = this.palette;
    for (let i = 0; i < 256; i++) {
      const dr = p[i * 3] - r;
      const dg = p[i * 3 + 1] - g;
      const db = p[i * 3 + 2] - b;
      const d = 3 * dr * dr + 4 * dg * dg + 2 * db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.paletteCache[key] = best;
    return best;
  }

  cameraTick() {
    if (!this.ready || !this.cams.length) return;
    const p = this.player();
    if (!p) return;
    const now = Date.now();
    for (const cam of this.cams) {
      if (cam.busy || now - cam.last < 900) continue;
      if (Math.hypot(cam.x - p.x, cam.y - p.y) > 1400) continue;
      const st = this.actions.state(cam.entity);
      const url = st && st.attributes && st.attributes.entity_picture;
      if (!url) continue;
      cam.busy = true;
      cam.last = now;
      const img = new Image();
      img.onload = () => {
        cam.busy = false;
        if (this.ready) this._paint(cam, img);
      };
      img.onerror = () => {
        cam.busy = false;
      };
      img.src = url + (url.includes('?') ? '&' : '?') + '_hw=' + now;
    }
  }

  _paint(cam, img) {
    const { w, h } = cam;
    this.camCanvas.width = w;
    this.camCanvas.height = h;
    // Fill the screen, cropping the long side.
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.max(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    this.camCtx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    const px = this.camCtx.getImageData(0, 0, w, h).data;
    const out = this.m.HEAPU8.subarray(this.camBuf, this.camBuf + w * h);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const i = (y * w + x) * 4;
        out[x * h + y] = this._nearestColour(px[i], px[i + 1], px[i + 2]);
      }
    }
    this.m._hw_texture_write(cam.tex, this.camBuf);
  }

  close() {
    this.ready = false;
    this.m._free(this.out);
    if (this.camBuf) this.m._free(this.camBuf);
  }

  // Engine calls ------------------------------------------------------------

  // record: false for chatter (entering a room) that the status line shows
  // anyway, so "last" stays the last thing that happened.
  message(text, record = true) {
    this.m.ccall('hw_message', null, ['string'], [hudText(text)]);
    if (record) this.last = { text, at: Date.now() };
  }

  count(what, n = 1) {
    this.tally.set(what, (this.tally.get(what) || 0) + n);
  }

  sound(name, sector = -1) {
    this.m.ccall('hw_sound', null, ['string', 'number'], [name, sector]);
  }

  lineTexture(line, name) {
    this.m.ccall('hw_line_texture', null, ['number', 'number', 'number', 'string'], [line, 0, 0, name]);
  }

  player() {
    if (!this.m._hw_player(this.out)) return null;
    const v = this.m.HEAP32.subarray(this.out >> 2, (this.out >> 2) + 6);
    return { x: v[0], y: v[1], angle: v[2], sector: v[3], health: v[4], alive: v[5] === 1 };
  }

  // Events from the engine ----------------------------------------------------

  onEvent(type, a, b, c) {
    try {
      switch (type) {
        case EV.LEVEL:
          return this._levelReady();
        case EV.SHOT:
          return this._lampShot(a, c === 1);
        case EV.WAKE:
          return this._monsterWoken(a, c === 1);
        case EV.KILL:
          return this._monsterKilled(a, c === 1);
        case EV.GONE:
          return this._slotGone(a);
        case EV.USE:
          return this._lineUsed(a);
        case EV.SHOOT_LINE:
          return this._lineShot(a);
        case EV.CONFIRM:
          return this._confirmed(a, b === 1);
        case EV.HURT:
          return this._monsterHurt(a, b, c === 1);
        case EV.EXIT:
          return this._levelExit(b, c);
        default:
          return undefined;
      }
    } catch (e) {
      this.log(`house event ${type} failed: ${e && e.stack}`);
      return undefined;
    }
  }

  _levelReady() {
    this.ready = true;
    this.tally = new Map();
    this.items.clear();
    this.itemSlot.clear();
    this.monsters.clear();
    this.slotKey.clear();
    this.currentRoom = null;
    for (const [slot, lamp] of this.lampSlot) {
      this.m._hw_spawn(slot, this.type.lamp, lamp.x, lamp.y, 0, 0);
    }
    this.sync({ instant: true });
  }

  _lampShot(slot, byPlayer) {
    const lamp = this.lampSlot.get(slot);
    if (!lamp || !byPlayer) return;
    const st = this.actions.state(lamp.entity);
    if (!isOn(st)) return;
    const r = this.actions.call(lamp.entity, 'turn_off');
    if (r.ok) {
      this.m._hw_set_lamp(slot, 0);
      this.count('lights switched off');
      this.message(`${friendlyName(this._hass(), lamp.entity)}: off`);
    } else if (r.reason === 'not-allowed') {
      this._refused(lamp.entity, r);
    }
  }

  // Use near a lamp switches it on (Doom can only "use" walls, so the card
  // asks this when the use key goes down).
  useNearLamp() {
    if (!this.ready) return false;
    const p = this.player();
    if (!p || !p.alive) return false;
    let best = null;
    const facing = (x, y, reach) => {
      const dist = Math.hypot(x - p.x, y - p.y);
      if (dist > reach) return null;
      const diff = Math.abs((((Math.atan2(y - p.y, x - p.x) * 180) / Math.PI - p.angle + 540) % 360) - 180);
      return diff > 35 ? null : dist;
    };
    // A fly in front of you, nearer than any lamp, gets fed instead.
    const fly = this._flyInFront(facing);
    for (const [slot, lamp] of this.lampSlot) {
      const dist = facing(lamp.x, lamp.y, 128);
      if (dist !== null && (!best || dist < best.dist)) best = { slot, lamp, dist };
    }
    if (fly && (!best || fly.dist < best.dist)) return this._feed(fly.mon);
    if (!best) return false;
    const st = this.actions.state(best.lamp.entity);
    const service = isOn(st) ? 'turn_off' : 'turn_on';
    const r = this.actions.call(best.lamp.entity, service);
    const name = friendlyName(this._hass(), best.lamp.entity);
    if (r.ok) {
      this.m._hw_set_lamp(best.slot, service === 'turn_on' ? 1 : 0);
      this.sound('swtchn');
      this.message(`${name}: ${service === 'turn_on' ? 'on' : 'off'}`);
    } else if (r.reason === 'not-allowed') {
      this._refused(best.lamp.entity, r);
    }
    return true;
  }

  // Flies -------------------------------------------------------------------

  _flyFor(slot) {
    const key = this.slotKey.get(slot);
    const mon = key && this.monsters.get(key);
    return mon && mon.spec.fly ? mon : null;
  }

  // Shooting a fly monster looms the real fly: its escape neurons fire, and
  // it learns to dislike where it was standing.
  _monsterHurt(slot, damage, byPlayer) {
    const mon = this._flyFor(slot);
    if (!mon || !byPlayer) return;
    const fly = mon.spec.fly;
    const strength = Math.round(Math.max(0.2, Math.min(3, 0.4 + damage / 20)) * 10) / 10;
    const r = this.actions.call(fly.mode, 'loom', { strength }, 'fly_house', true);
    if (r.ok) {
      this.count('flies loomed');
      this.message(`${fly.name}: loomed. Escape neurons firing.`);
    }
  }

  _flyInFront(facing) {
    let best = null;
    for (const mon of this.monsters.values()) {
      if (!mon.spec.fly || this.m._hw_slot_state(mon.slot) !== 1) continue;
      if (!this.m._hw_slot_pos(mon.slot, this.out)) continue;
      const v = this.m.HEAP32.subarray(this.out >> 2, (this.out >> 2) + 2);
      const dist = facing(v[0], v[1], 160);
      if (dist !== null && (!best || dist < best.dist)) best = { mon, dist };
    }
    return best;
  }

  _feed(mon) {
    const fly = mon.spec.fly;
    const r = this.actions.call(fly.mode, 'feed', { amount: 1 }, 'fly_house', true);
    if (r.ok) {
      this.count('flies fed');
      this.message(`${fly.name}: fed. Dopamine.`);
    }
    return true;
  }

  // Walk each fly monster the way its brain is heading. Escaping flies bolt
  // away from the player instead.
  _steerFlies() {
    const p = this.player();
    for (const mon of this.monsters.values()) {
      if (!mon.spec.fly || this.m._hw_slot_state(mon.slot) !== 1) continue;
      const fly = mon.spec.fly;
      const mode = this.actions.state(fly.mode)?.state;
      let heading = parseFloat(this.actions.state(fly.heading)?.state) || 0;
      let speed = { walk: 8, forage: 10, escape: 20 }[mode] || 0;
      if (mode === 'escape' && p && this.m._hw_slot_pos(mon.slot, this.out)) {
        const v = this.m.HEAP32.subarray(this.out >> 2, (this.out >> 2) + 2);
        heading = (Math.atan2(v[1] - p.y, v[0] - p.x) * 180) / Math.PI;
      }
      this.m._hw_puppet(mon.slot, 1, Math.round(heading), speed);
    }
  }

  _lineUsed(line) {
    const ref = this.lines.get(line);
    if (!ref) return;
    if (ref.kind === 'switch') {
      const r = this.actions.call(ref.entity, 'toggle');
      this._report(ref.entity, r, () => {
        const on = !isOn(this.actions.state(ref.entity));
        this.lineTexture(line, on ? 'SW2COMP' : 'SW1COMP');
        this.sound('swtchn');
        return on ? 'on' : 'off';
      });
    } else if (ref.kind === 'media') {
      const r = this.actions.call(ref.entity, 'media_play_pause');
      this._report(ref.entity, r, () => {
        this.sound('swtchn');
        return this.actions.state(ref.entity)?.state === 'playing' ? 'pause' : 'play';
      });
    } else if (ref.kind === 'door') {
      this._doorUsed(this.doorById.get(ref.door));
    } else if (ref.kind === 'camera') {
      this.message(`${friendlyName(this._hass(), ref.entity)}: live`);
    }
  }

  _lineShot(line) {
    const ref = this.lines.get(line);
    if (!ref) return;
    if (ref.kind === 'switch' && isOn(this.actions.state(ref.entity))) {
      const r = this.actions.call(ref.entity, 'turn_off');
      this._report(ref.entity, r, () => {
        this.lineTexture(line, 'SW1COMP');
        return 'off';
      });
    } else if (ref.kind === 'media') {
      const st = this.actions.state(ref.entity);
      if (!st || st.state === 'off' || st.attributes.is_volume_muted) return;
      const r = this.actions.call(ref.entity, 'volume_mute', { is_volume_muted: true });
      this._report(ref.entity, r, () => 'muted');
    }
  }

  _report(entityId, r, applied) {
    const name = friendlyName(this._hass(), entityId);
    if (r.ok) this.message(`${name}: ${applied()}`);
    else if (r.reason === 'not-allowed') {
      this.sound('noway');
      this._refused(entityId, r);
    }
  }

  _doorUsed(door) {
    if (!door) return;
    const a = this.actions;
    const lock = door.lock && a.state(door.lock);
    const cover = door.cover && a.state(door.cover);
    const sensorOpen = isOn(door.sensor && a.state(door.sensor));
    if (door.cover) {
      const open = cover && ['open', 'opening'].includes(cover.state);
      return this._doorCall(door, door.cover, open ? 'close_cover' : 'open_cover', open ? 'closing' : 'opening');
    }
    if (door.lock) {
      const unlocked = lock && ['unlocked', 'open', 'unlocking', 'opening'].includes(lock.state);
      if (unlocked && sensorOpen) {
        this.sound('noway');
        return this.message(`${door.name} is open. Close it first.`);
      }
      return this._doorCall(door, door.lock, unlocked ? 'lock' : 'unlock', unlocked ? 'locking' : 'unlocking');
    }
    this.sound('noway');
    return this.message(`${door.name} is a real door. Go and open it.`);
  }

  // Ask before anything that lets people into the house.
  confirm(text, action) {
    const token = this.nextConfirm++;
    this.confirms.set(token, action);
    this.m.ccall('hw_confirm', null, ['string', 'number'], [boxText(text), token]);
    this.onConfirm(true);
  }

  _confirmed(token, yes) {
    const action = this.confirms.get(token);
    this.confirms.delete(token);
    this.onConfirm(false);
    if (!action) return;
    if (yes) action();
    else this.message('Sensible.');
  }

  _doorCall(door, entityId, service, doing) {
    const opening = service === 'unlock' || service === 'open_cover';
    if (opening && this.confirmUnlock && this.actions.mode === 'real' && this.actions.allowed(entityId)) {
      const verb = service === 'unlock' ? 'unlock' : 'open';
      return this.confirm(`This will ${verb} the real\n${door.name}.\n\nPress Y to ${verb} it, N to stay in.`, () => this._doDoorCall(door, entityId, service, doing));
    }
    return this._doDoorCall(door, entityId, service, doing);
  }

  _doDoorCall(door, entityId, service, doing) {
    const r = this.actions.call(entityId, service);
    if (r.ok) return this.message(`${door.name}: ${doing}...`);
    if (r.reason === 'not-allowed') {
      this.sound('noway');
      return this.message(door.lock ? `${door.name} is locked. You need the real key.` : `${door.name} is not on the allowlist`);
    }
    return undefined;
  }

  // Monsters -----------------------------------------------------------------

  _monsterWoken(slot, byPlayer) {
    const key = this.slotKey.get(slot);
    const mon = key && this.monsters.get(key);
    if (!mon) return;
    mon.dormant = false;
    mon.wokenAt = Date.now();
    if (mon.spec.onWake && byPlayer) mon.spec.onWake();
  }

  _monsterKilled(slot, byPlayer) {
    const key = this.slotKey.get(slot);
    const mon = key && this.monsters.get(key);
    if (!mon) return;
    mon.alive = false;
    mon.killedAt = Date.now();
    if (byPlayer && mon.spec.onKill) mon.spec.onKill();
  }

  _slotGone(slot) {
    const itemKey = this.itemSlot.get(slot);
    if (itemKey) {
      this.itemSlot.delete(slot);
      const it = this.items.get(itemKey);
      if (it && it.present && !it.removing) {
        // Picked up by the player: say where the real thing is.
        it.present = false;
        it.pickedAt = Date.now();
        const where = this.houseRoom.get(it.room);
        this.count('things found');
        this.message(`Found: ${it.tracker.name}. It's in the ${where ? where.name : 'house'}.`);
      }
      return;
    }
    const key = this.slotKey.get(slot);
    if (!key) return;
    const mon = this.monsters.get(key);
    if (mon && mon.slot === slot) this.monsters.delete(key);
    this.slotKey.delete(slot);
  }

  // What the house says should be roaming the level right now.
  wantedMonsters() {
    const a = this.actions;
    const hass = this._hass();
    const want = new Map();
    const r = this.rules;
    let imps = 0;
    const heatingAnywhere = this.house.rooms.some((room) =>
      room.climates.some((c) => a.state(c.entity_id)?.attributes?.hvac_action === 'heating'),
    );

    // Fruit-fly brains, each walking an arachnotron (a brain on legs).
    if (this.fliesOn) {
      // One fly to a room while there are rooms to go round; arachnotrons
      // are too big to share a doorway, let alone a spawn point.
      const rooms = this.manifest.rooms.filter((r) => r.spawns.length && !r.outdoor);
      (this.house.flies || []).forEach((fly, i) => {
        if (!rooms.length) return;
        want.set(`fly:${fly.id}`, {
          type: 'arachnotron',
          room: rooms[(i + 1) % rooms.length].id,
          slotInRoom: Math.floor(i / rooms.length),
          fly,
          label: `${fly.name}: a fruit-fly brain on legs`,
          respawn: 20000,
          onKill: () => this.message(`${fly.name} is a connectome. You can't shoot a connectome.`),
        });
      });
    }

    for (const room of this.house.rooms) {
      const info = this.roomInfo.get(room.id);
      if (!info) continue;
      const presence = room.presence.map((p) => a.state(p.entity_id)).filter(Boolean);
      const occupied = presence.some(isOn);
      const emptyFor = presence.length ? Math.min(...presence.map(ago)) : 0;

      // Lights left on in a room nobody has been in for a while.
      if (presence.length && !occupied && emptyFor >= r.empty_minutes * 60000) {
        for (const light of room.lights) {
          if (!isOn(a.state(light.entity_id))) continue;
          const lamp = this.manifest.lamps.find((l) => l.entity === light.entity_id);
          want.set(`soul:${light.entity_id}`, {
            type: 'lostsoul',
            problem: true,
            room: room.id,
            near: lamp ? [lamp.x, lamp.y] : null,
            label: `Wasted light: ${friendlyName(hass, light.entity_id)}`,
            respawn: 20000,
            onKill: () => this._killAction(light.entity_id, 'turn_off', 'off'),
          });
        }
      }

      // Plugs switched on but only drawing standby power.
      for (const sw of room.switches) {
        if (!sw.power || !isOn(a.state(sw.entity_id))) continue;
        const watts = parseFloat(a.state(sw.power)?.state);
        if (!(watts >= r.standby_min && watts <= r.standby_max)) continue;
        want.set(`zombie:${sw.entity_id}`, {
          type: 'zombieman',
          problem: true,
          room: room.id,
          label: `Standby hog: ${friendlyName(hass, sw.entity_id)} (${watts} W)`,
          respawn: 20000,
          onKill: () => this._killAction(sw.entity_id, 'turn_off', 'off'),
        });
      }

      // Somebody is in the room: one imp, however many sensors agree.
      if (occupied && imps < MAX_IMPS) {
        imps++;
        want.set(`imp:${room.id}`, {
          type: 'imp',
          room: room.id,
          label: `Movement in the ${room.name}`,
          onKill: () => this.message(`That was only movement in the ${room.name}. It'll be back.`),
        });
      }

      // A window open while the heating runs.
      const heating =
        room.climates.length > 0
          ? room.climates.some((c) => a.state(c.entity_id)?.attributes?.hvac_action === 'heating')
          : heatingAnywhere;
      for (const w of room.windows) {
        if (!heating || !isOn(a.state(w.entity_id))) continue;
        want.set(`caco:${w.entity_id}`, {
          type: 'cacodemon',
          problem: true,
          room: room.id,
          label: `${friendlyName(hass, w.entity_id)} open with the heating on`,
          onKill: () => this.message(`Now go and close ${friendlyName(hass, w.entity_id)} yourself.`),
        });
      }

      // The robot vacuum: asleep on its dock, a demon when it cleans.
      for (const v of room.vacuums) {
        const st = a.state(v.entity_id);
        const cleaning = !!st && ['cleaning', 'on'].includes(st.state);
        // Out cleaning and saying where: the demon is in that room.
        const there = cleaning && v.roomSensor ? this._roomByName(a.state(v.roomSensor)?.state) : null;
        want.set(`vac:${v.entity_id}`, {
          type: 'demon',
          room: there || room.id,
          dormant: !cleaning,
          vacuum: true,
          label: friendlyName(hass, v.entity_id),
          onWake: () => {
            const res = this.actions.call(v.entity_id, 'start');
            if (res.ok) this.message(`You woke the ${friendlyName(hass, v.entity_id)}.`);
          },
          onKill: () => this._killAction(v.entity_id, 'return_to_base', 'sent home'),
        });
      }
    }
    return want;
  }

  _refused(entityId, r) {
    if (r.important) this.message(`${friendlyName(this._hass(), entityId)} looks important. Allow it by name.`);
    else this.message(`${entityId} is not on the allowlist`);
  }

  _killAction(entityId, service, done) {
    const r = this.actions.call(entityId, service);
    const name = friendlyName(this._hass(), entityId);
    if (r.ok) {
      this.count({ turn_off: entityId.startsWith('light.') ? 'lights switched off' : 'plugs switched off', return_to_base: 'vacuums sent home' }[service] || 'things fixed');
      this.message(`${name}: ${done}`);
    } else if (r.reason === 'not-allowed') this._refused(entityId, r);
  }

  _spawnMonster(key, spec, fog) {
    let slot = this.monsters.get(key)?.slot;
    if (!slot) slot = this.nextSlot++;
    const spot = this._spotFor(spec, key);
    if (!spot) return;
    const flags = (fog ? SPAWN.FOG : 0) | (spec.dormant ? SPAWN.DORMANT : 0) | (spec.problem ? SPAWN.COUNT : 0);
    if (!this.m._hw_spawn(slot, this.type[spec.type], spot[0], spot[1], 90, flags)) return;
    this.slotKey.set(slot, key);
    this.monsters.set(key, { slot, alive: true, killedAt: 0, dormant: !!spec.dormant, spec, spot });
    if (fog && spec.label && !spec.dormant) this.message(spec.label);
  }

  _spotFor(spec, key) {
    const info = this.roomInfo.get(spec.room);
    if (!info) return null;
    if (spec.type === 'arachnotron') {
      // 128 units across: only the middle of a room is clear of the walls.
      const off = [[0, 0], [-100, 0], [100, 0], [0, -100], [0, 100]][(spec.slotInRoom || 0) % 5];
      return [Math.round((info.bbox.x1 + info.bbox.x2) / 2) + off[0], Math.round((info.bbox.y1 + info.bbox.y2) / 2) + off[1]];
    }
    if (spec.near) {
      const cx = (info.bbox.x1 + info.bbox.x2) / 2;
      const cy = (info.bbox.y1 + info.bbox.y2) / 2;
      const d = Math.hypot(cx - spec.near[0], cy - spec.near[1]) || 1;
      return [Math.round(spec.near[0] + ((cx - spec.near[0]) * 48) / d), Math.round(spec.near[1] + ((cy - spec.near[1]) * 48) / d)];
    }
    const taken = new Set([...this.monsters.entries()].filter(([k]) => k !== key).map(([, m]) => m.spot && m.spot.join(',')));
    const p = this.player();
    const spots = info.spawns.filter((s) => !taken.has(s.join(',')));
    if (!spots.length) return info.spawns[0] || null;
    const far = p ? spots.filter((s) => Math.hypot(s[0] - p.x, s[1] - p.y) > 160) : spots;
    const pool = far.length ? far : spots;
    // Stable choice per key so a monster comes back where it was.
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return pool[h % pool.length];
  }

  // Reconcile ----------------------------------------------------------------

  sync({ instant = false } = {}) {
    if (!this.ready) return;
    const a = this.actions;
    const hass = this._hass();

    // Room light levels follow the room's lights.
    for (const room of this.house.rooms) {
      const info = this.roomInfo.get(room.id);
      if (!info) continue;
      let level = info.outdoor ? null : 160;
      if (room.lights.length) {
        // Each light carries its share, so every lamp shot out shows.
        const sum = room.lights
          .map((l) => a.state(l.entity_id))
          .filter(isOn)
          .reduce((n, st) => n + (st.attributes.brightness ?? 255) / 255, 0);
        level = 88 + Math.round((167 * sum) / room.lights.length);
      }
      if (info.outdoor || /garden|patio|terrace|balcon|yard|altan|ute/i.test(room.name)) {
        const sun = hass && hass.states['sun.sun'];
        const day = !sun || sun.state === 'above_horizon';
        level = Math.max(level ?? 0, day ? 208 : 72);
      }
      for (const s of info.sectors) this.m._hw_sector_light(s, level);
      if (info.yard !== undefined) {
        const sun = hass && hass.states['sun.sun'];
        this.m._hw_sector_light(info.yard, !sun || sun.state === 'above_horizon' ? 208 : 72);
      }
    }

    // Lamps, switches, screens.
    for (const [slot, lamp] of this.lampSlot) this.m._hw_set_lamp(slot, isOn(a.state(lamp.entity)) ? 1 : 0);
    for (const [line, ref] of this.lines) {
      const st = a.state(ref.entity);
      if (ref.kind === 'switch') this.lineTexture(line, isOn(st) ? 'SW2COMP' : 'SW1COMP');
      if (ref.kind === 'media') this.lineTexture(line, st && ['playing', 'on', 'paused', 'idle'].includes(st.state) ? 'COMPSTA1' : 'COMPSTA2');
    }

    // Doors open when the real door is open, unlocked, or the cover is up.
    for (const door of this.manifest.doors) {
      const open =
        isOn(door.sensor && a.state(door.sensor)) ||
        (door.lock && ['unlocked', 'open', 'opening'].includes(a.state(door.lock)?.state)) ||
        (door.cover && ['open', 'opening'].includes(a.state(door.cover)?.state));
      const now = this.m._hw_door_state(door.sector);
      if (now === 2) continue;
      if ((now === 1) !== !!open) this.m._hw_door(door.sector, open ? 1 : 0, instant ? 1 : 0);
    }

    this._syncMonsters(instant);
  }

  _syncMonsters(instant) {
    const want = this.wantedMonsters();
    const now = Date.now();

    for (const [key, mon] of [...this.monsters]) {
      const spec = want.get(key);
      const state = this.m._hw_slot_state(mon.slot);
      if (!spec) {
        // The problem went away: an alive monster vanishes; corpses stay.
        if (state === 1) this.m._hw_remove(mon.slot, 1);
        this.monsters.delete(key);
        this.slotKey.delete(mon.slot);
        continue;
      }
      if (state === 1 && spec.room !== mon.spec.room) {
        // It moved to another room in the real house: so does the monster.
        this.m._hw_remove(mon.slot, 1);
        this.monsters.delete(key);
        this.slotKey.delete(mon.slot);
        continue;
      }
      if (spec.vacuum) {
        if (state === 1 && spec.dormant && !mon.dormant && now - (mon.wokenAt || 0) > 15000) {
          // Gone back to the dock (or never left it): back to sleep.
          this.m._hw_remove(mon.slot, 1);
          this.monsters.delete(key);
        } else if (state === 1 && !spec.dormant && mon.dormant) {
          this.m._hw_set_dormant(mon.slot, 0);
          mon.dormant = false;
        } else if (state !== 1 && spec.dormant && now - mon.killedAt > 5000) {
          this.monsters.delete(key);
        }
        continue;
      }
      if (state !== 1 && spec.respawn && now - mon.killedAt > spec.respawn) {
        // Killed, but the house did not change: it comes back.
        this.monsters.delete(key);
      }
    }

    let alive = [...this.monsters.values()].filter((m) => this.m._hw_slot_state(m.slot) === 1).length;
    for (const [key, spec] of want) {
      if (this.monsters.has(key) || alive >= MAX_MONSTERS) continue;
      this._spawnMonster(key, spec, !instant);
      alive++;
    }
    this._steerFlies();
    this._syncItems();
  }

  // The exit: Doom shows its tally screen (kills = house problems fixed);
  // the status line says what was actually done, and a configured scene runs.
  _levelExit(kills, total) {
    const one = {
      'lights switched off': 'light switched off',
      'plugs switched off': 'plug switched off',
      'vacuums sent home': 'vacuum sent home',
      'flies loomed': 'fly loomed',
      'flies fed': 'fly fed',
      'things fixed': 'thing fixed',
    };
    const parts = [...this.tally].map(([what, n]) => `${n} ${n === 1 ? one[what] || what : what}`);
    const summary = parts.length ? `You left the house: ${parts.join(', ')}.` : 'You left the house. Nothing fixed.';
    if (this.exitScene) this._runEntity(this.exitScene, 'leaving home');
    this.last = { text: summary, at: Date.now() };
    this.lastExit = { kills, total, parts };
  }

  // Run whatever an entity id names: a scene, script, automation, button, or
  // anything that toggles. Things the owner named in the card config count
  // as allowed; they chose them.
  _runEntity(entityId, why) {
    const domain = entityId.split('.')[0];
    const service =
      { scene: 'turn_on', script: 'turn_on', automation: 'trigger', button: 'press', input_button: 'press' }[domain] || 'toggle';
    const r = this.actions.call(entityId, service, {}, domain, true);
    if (r.ok) this.message(`${friendlyName(this._hass(), entityId)}: ${why}`);
    return r.ok;
  }

  // Cheat codes typed in the game. Doom's own still work as well.
  runCheat(code) {
    const target = this.cheats[code];
    if (target) return this._runEntity(target, code);
    if (code === 'idbeholdl') {
      // Light amplification: every light the game may touch comes on.
      let n = 0;
      for (const room of this.house.rooms) {
        for (const l of room.lights) {
          if (isOn(this.actions.state(l.entity_id))) continue;
          if (this.actions.call(l.entity_id, 'turn_on').ok) n++;
        }
      }
      this.message(n ? `Light amplification: ${n} lights on` : 'Light amplification');
      return true;
    }
    return false;
  }

  // Room names as Home Assistant states give them ("Kitchen", "kitchen").
  _roomByName(name) {
    if (!name) return null;
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9åäöæøü]/g, '');
    const n = norm(name);
    const room = this.house.rooms.find((r) => norm(r.name) === n || norm(r.id) === n);
    return room && this.roomInfo.has(room.id) ? room.id : null;
  }

  // Tagged things (keys, wallet, bag) lie in whichever room Bluetooth says
  // they are in. Pick one up and the game tells you where the real one is.
  _syncItems() {
    const now = Date.now();
    for (const t of this.house.trackers || []) {
      const key = `tag:${t.entity_id}`;
      const roomId = this._roomByName(this.actions.state(t.entity_id)?.state);
      let it = this.items.get(key);
      if (it && it.room !== roomId) {
        if (it.present && this.m._hw_slot_state(it.slot)) {
          it.removing = true;
          this.m._hw_remove(it.slot, 0);
        }
        this.items.delete(key);
        it = null;
      }
      if (!roomId || (it && (it.present || now - it.pickedAt < 120000))) continue;
      const n = t.name.toLowerCase();
      const type = /key|nyckel/.test(n) ? 'redcard' : /wallet|purse|plånbok/.test(n) ? 'yellowcard' : /bag|väska|ryggsäck/.test(n) ? 'backpack' : /phone|telefon|watch|klocka/.test(n) ? 'bluecard' : 'yellowskull';
      const slot = (it && it.slot) || this.nextSlot++;
      const spot = this._spotFor({ room: roomId, type }, key);
      if (!spot || !this.m._hw_spawn(slot, this.type[type], spot[0], spot[1], 0, 0)) continue;
      this.items.set(key, { slot, room: roomId, present: true, pickedAt: 0, tracker: t });
      this.itemSlot.set(slot, key);
    }
  }

  // What the player is looking at, for the status line.
  aimed() {
    if (!this.ready || !this.m._hw_aim(this.out)) return null;
    const v = this.m.HEAP32.subarray(this.out >> 2, (this.out >> 2) + 4);
    const [slot, thingDist, line, lineDist] = [v[0], v[1], v[2], v[3]];
    const useThing = slot && (line < 0 || thingDist <= lineDist);
    return useThing ? this._describeSlot(slot) : line >= 0 ? this._describeLine(line) : null;
  }

  _stateText(entityId) {
    const st = this.actions.state(entityId);
    if (!st) return '';
    if (entityId.startsWith('light.') && isOn(st) && st.attributes.brightness != null)
      return `on, ${Math.round((st.attributes.brightness / 255) * 100)}%`;
    return String(st.state).replace(/_/g, ' ');
  }

  _describeSlot(slot) {
    const hass = this._hass();
    const lamp = this.lampSlot.get(slot);
    if (lamp) return `${friendlyName(hass, lamp.entity)} (${this._stateText(lamp.entity)})`;
    const key = this.slotKey.get(slot);
    const mon = key && this.monsters.get(key);
    if (!mon) return null;
    if (mon.spec.fly) return `${mon.spec.fly.name}, a fly brain (${this._stateText(mon.spec.fly.mode)})`;
    if (mon.spec.vacuum) return `${mon.spec.label} (${this._stateText(key.slice(4))})`;
    return mon.spec.label;
  }

  _describeLine(line) {
    const ref = this.lines.get(line);
    if (!ref) return null;
    const hass = this._hass();
    if (ref.kind === 'exit') return 'Exit: leave the house';
    if (ref.kind === 'door') {
      const d = this.doorById.get(ref.door);
      if (!d) return null;
      const bits = [d.lock && this._stateText(d.lock), d.cover && this._stateText(d.cover), d.sensor && (isOn(this.actions.state(d.sensor)) ? 'open' : 'shut')];
      return `${d.name} (${bits.filter(Boolean).join(', ')})`;
    }
    return `${friendlyName(hass, ref.entity)} (${this._stateText(ref.entity)})`;
  }

  status() {
    const p = this.ready ? this.player() : null;
    const room = p && this.manifest.sectorRoom[p.sector];
    return { room: room ? room.name : '', target: this.aimed(), last: this.last };
  }

  // Called a few times a second: room announcements.
  tick() {
    if (!this.ready) return;
    const p = this.player();
    if (!p) return;
    const room = this.manifest.sectorRoom[p.sector];
    const id = room ? room.id : null;
    if (id && id !== this.currentRoom) {
      this.currentRoom = id;
      const house = this.houseRoom.get(id);
      let text = room.name;
      if (house && house.lights.length) {
        const on = house.lights.filter((l) => isOn(this.actions.state(l.entity_id))).length;
        text += ` - ${on} of ${house.lights.length} lights on`;
      }
      this.message(text, false);
    }
  }

  _hass() {
    return this.actions.getHass();
  }
}

export { SPECIAL };
