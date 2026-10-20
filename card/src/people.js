// Where people are, from what Home Assistant knows: the room each phone
// Bermuda follows is in (a listening tablet close by first), and where in
// that room (a radar if it sees someone, else the point that best fits the
// distances to each Bluetooth listener). Used by the game and by the plan
// card; neither needs the other for it.

import { trilaterate, keepInside, radarPoint, Smooth } from './locate.js';

const isOn = (st) => !!st && st.state === 'on';

export class PeopleLocator {
  // state(entityId) -> a Home Assistant state object (or undefined).
  constructor({ manifest, house, rules = {}, state }) {
    this.manifest = manifest;
    this.house = house;
    this.rules = rules;
    this.state = state;
    this.roomInfo = new Map(manifest.rooms.map((r) => [r.id, r]));
    this.smooth = new Map(); // person -> Smooth
    this.lastRoom = new Map(); // person -> { room, at }
  }

  // Where each followed phone is: a listening tablet close by first (a
  // reading under a minute old), else Bermuda's room.
  peopleRooms() {
    const a = this;
    const people = (this.house.people || []).map((p) => ({ ...p, st: a.state(p.area) }));
    const listeners = [
      ...this.manifest.rooms.flatMap((m) => (m.listeners || []).map((entity) => ({ entity, room: m.id, near: m.near || 3 }))),
      ...(this.house.listeners || []).map((l) => ({ entity: l.entity_id, room: l.room, near: 3 })),
    ];
    const heardIn = (p) => {
      let best = null;
      for (const l of listeners) {
        const st = a.state(l.entity);
        if (!st || Date.now() - new Date(st.last_updated || st.last_changed || 0).getTime() > 60000) continue;
        const d = parseFloat(st.attributes?.[p.beacon]);
        if (d >= 0 && d <= l.near && (!best || d < best.d)) best = { room: l.room, d };
      }
      return best && best.room;
    };
    // Bermuda drops a phone to "unknown" for a few seconds now and then: keep
    // the last room through a short gap rather than blinking out.
    const hold = (this.rules.presence_hold_s ?? 90) * 1000;
        const whereIs = new Map(
      people.map((p) => {
        const room = heardIn(p) || (p.st ? this.roomByName(p.st.state) : null);
        const gone = p.st && ['not_home', 'away'].includes(p.st.state);
        if (room) this.lastRoom.set(p.id, { room, at: Date.now() });
        const last = this.lastRoom.get(p.id);
        return [p.id, room || (!gone && last && Date.now() - last.at < hold ? last.room : null)];
      }),
    );
    return { people, whereIs };
  }

  middle(info) {
    return info.center || [Math.round((info.bbox.x1 + info.bbox.x2) / 2), Math.round((info.bbox.y1 + info.bbox.y2) / 2)];
  }

  // Where in a room a person is: a radar there if it sees someone, else the
  // point that best fits Bermuda's distances to each listener, kept inside
  // the room and smoothed so it moves like a walk.
  position(person, room) {
    const info = this.roomInfo.get(room);
    if (!info) return null;
    const a = this;
    const U = this.manifest.unitsPerMetre || 64;
    const rects = info.rects || [info.bbox];
    const mid = this.middle(info);
    const smooth = this.smooth.get(person.id) || new Smooth(0.25);
    this.smooth.set(person.id, smooth);
    if (smooth.room !== room) {
      smooth.reset();
      smooth.room = room;
    }
    const prior = smooth.p || mid;
    let raw = null;
    for (const r of this.manifest.radars || []) {
      if (r.room !== room) continue;
      const pt = this.radarSees(r, U, prior);
      if (pt) raw = pt;
    }
    if (!raw) {
      const fresh = (st) => st && Date.now() - new Date(st.last_updated || st.last_changed || 0).getTime() < 120000;
      const anchors = (person.ranges || [])
        .map((rg) => {
          const st = a.state(rg.entity);
          const d = parseFloat(st?.state);
          const at = (this.manifest.scanners || {})[rg.scanner] || (rg.area && this.roomInfo.get(rg.area) && this.middle(this.roomInfo.get(rg.area)));
          return fresh(st) && d >= 0 && at ? { x: at[0], y: at[1], d: d * U } : null;
        })
        .filter(Boolean);
      raw = anchors.length ? trilaterate(anchors, prior) : null;
    }
    return smooth.next(keepInside(raw || prior, rects));
  }

  // A radar's reading: an LD2410's distance straight ahead of it, or the
  // LD2450 target nearest where we thought the person was.
  radarSees(r, U, prior) {
    const a = this;
    const hr = (this.house.radars || []).find((x) => x.prefix === r.radar || x.name === r.radar || x.id === r.radar);
    if (!hr) return null;
    if (hr.presence.length && !hr.presence.some((id) => isOn(a.state(id)))) return null;
    const metres = (id) => {
      const st = a.state(id);
      const v = parseFloat(st?.state);
      if (!Number.isFinite(v)) return null;
      const unit = st.attributes.unit_of_measurement || 'cm';
      return v / ({ mm: 1000, cm: 100, m: 1 }[unit] || 100);
    };
    if (hr.kind === 'distance') {
      const d = hr.distances.map(metres).find((v) => v > 0);
      return d ? radarPoint([r.x, r.y], r.facing, { distance: d * U }) : null;
    }
    const seen = hr.targets
      .map((t) => ({ x: metres(t.x), y: metres(t.y) }))
      .filter((t) => t.x !== null && t.y !== null && (t.x !== 0 || t.y !== 0))
      .map((t) => radarPoint([r.x, r.y], r.facing, { x: t.x * U, y: t.y * U }));
    if (!seen.length) return null;
    return seen.reduce((best, p) => (Math.hypot(p[0] - prior[0], p[1] - prior[1]) < Math.hypot(best[0] - prior[0], best[1] - prior[1]) ? p : best));
  }

  roomByName(name) {
    if (!name) return null;
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9åäöæøü]/g, '');
    const n = norm(name);
    const room = this.house.rooms.find((r) => norm(r.name) === n || norm(r.id) === n);
    return room && this.roomInfo.has(room.id) ? room.id : null;
  }
}
