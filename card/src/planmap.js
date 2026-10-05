// Floor plan -> Doom map.
//
// The other way to build the level (mapgen.js lays rooms off a corridor when
// there is no plan). A plan gives each room's real shape as rectangles in
// metres, the doors between rooms, the doors out, and ceiling heights:
//
//   { "scale": 64,                       // Doom units per metre (optional)
//     "rooms": [
//       { "id": "bio", "name": "Bio", "area": "bio", "height": 4,
//         "rects": [[x1, y1, x2, y2], ...] },          // metres, y downwards
//       ...],
//     "open":  [["bedroom", "living"]],                 // no wall where they touch
//     "doors": [{ "rooms": ["saga", "living"], "at": [[10.33, 7.04], [10.33, 8.83]] }],
//     "exits": [{ "room": "saga", "name": "Front door", "at": [[1.42, 7.84], [1.42, 9.62]],
//                 "outside": "front_walkway" }],         // HA area for the yard (optional)
//     "start": { "room": "saga", "at": [3, 8] } }
//
// More than one storey: give each other level an offset (metres, so it sits
// beside the house, not on top of it: Doom has no room over room) and a floor
// height, put its rooms on it, and join levels with stairs. A stair is a rect
// on each side, entered from the given edge of its room; it climbs or drops a
// few steps and then teleports you to the other side.
//
//     "levels": { "loft": { "offset": [0, -9], "floor": 2.7 } },
//     "rooms":  [{ "id": "loft", "area": "loft", "level": "loft", "rects": [...] }],
//     "stairs": [{ "name": "Stairs to the loft",
//                  "from": { "room": "living", "rect": [x1, y1, x2, y2], "enter": "s" },
//                  "to":   { "room": "loft",   "rect": [x1, y1, x2, y2], "enter": "n" } }],
//
// Areas that mean the whole house ("anywhere": ["residence"]) get no room of
// their own: their lamps and switches are spread over the plan's rooms.
//
// Rooms are matched to Home Assistant areas by "area" (id or name), so the
// lamps, switches, screens and doors of an area land in its room. Areas with
// devices that the plan has no room for go in an annex off the back garden.
// The output has the same shape as mapgen's, so the rest of the card does not
// care which way the level was made.

import { MapBuilder, encodeMap, ML } from './geometry.js';
import { SPECIAL, THING, CAMERA_TEXTURES, themeFor } from './mapgen.js';

const GAP = 4; // half a wall: rooms are inset this far, so walls are solid
const YARD_DEPTH = 3; // metres of outside beyond a door
const SLOT = 96;
const TELEPORT_DEST = 14; // Doom's teleport destination thing
const WR_TELEPORT = 97; // walk over, repeatable, front side only
const STAIR_TAG = 100; // stair tags start here, clear of the exit doors'

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9åäöæøü]/g, '');

export function generateFromPlan(plan, house) {
  const S = plan.scale || 64;
  const b = new MapBuilder();
  const manifest = { rooms: [], lamps: [], lines: {}, doors: [], cameras: [], sectorRoom: {}, start: null };

  // Plan rooms <-> house rooms (HA areas).
  const byKey = new Map();
  for (const r of house.rooms) {
    byKey.set(norm(r.id), r);
    byKey.set(norm(r.name), r);
  }
  const used = new Set();
  const anywhere = (plan.anywhere || []).map((a) => byKey.get(norm(a))).filter(Boolean);
  for (const hr of anywhere) used.add(hr.id);
  const levels = plan.levels || {};
  const levelOf = (name) => {
    const lv = (name && levels[name]) || {};
    const [dx, dy] = lv.offset || [0, 0];
    return { dx, dy, floor: Math.round((lv.floor || 0) * S) };
  };
  const planRooms = plan.rooms.map((pr) => {
    const hr = (pr.area && byKey.get(norm(pr.area))) || byKey.get(norm(pr.name)) || byKey.get(norm(pr.id));
    if (hr) used.add(hr.id);
    return { pr, hr: hr || null, id: hr ? hr.id : `_plan_${pr.id}` };
  });

  // Metres to Doom units; y flips so the plan reads the right way up.
  const X = (m) => Math.round(m * S);
  const Y = (m) => -Math.round(m * S);
  const rectU = ([x1, y1, x2, y2], lv = levelOf()) => ({
    x1: X(Math.min(x1, x2) + lv.dx),
    x2: X(Math.max(x1, x2) + lv.dx),
    y1: Y(Math.max(y1, y2) + lv.dy),
    y2: Y(Math.min(y1, y2) + lv.dy),
  });
  // Plan points on a room's level.
  const XL = (lv) => (m) => X(m + lv.dx);
  const YL = (lv) => (m) => Y(m + lv.dy);

  const roomOf = new Map(); // plan room id -> info
  const touch = []; // spans where walls open (joins, doors): no fixtures there

  for (const { pr, hr, id } of planRooms) {
    const theme = themeFor(pr.name);
    const outdoor = !!theme.outdoor || !!pr.outdoor;
    const heightU = Math.round((pr.height || 2.4) * S);
    const lv = levelOf(pr.level);
    const sector = b.addSector({
      floor: lv.floor,
      ceil: lv.floor + (outdoor ? Math.max(heightU, 256) : heightU),
      floorTex: theme.floor,
      ceilTex: outdoor ? 'F_SKY1' : theme.ceil,
      wall: theme.wall,
      light: outdoor ? 200 : 160,
      priority: 2,
    });
    const rects = pr.rects.map((r) => rectU(r, lv)).map((r) => ({ x1: r.x1 + GAP, x2: r.x2 - GAP, y1: r.y1 + GAP, y2: r.y2 - GAP }));
    for (const r of rects) b.addRect(sector, r.x1, r.y1, r.x2, r.y2);
    const info = {
      id,
      name: hr ? hr.name : pr.name,
      sectors: [sector],
      floorZ: lv.floor,
      level: lv,
      rects,
      bbox: bboxOf(rects),
      center: centreOf(rects),
      spawns: [],
      outdoor,
      fixtures: [],
      house: hr,
      height: heightU,
    };
    roomOf.set(pr.id, info);
    manifest.sectorRoom[sector] = { id, name: info.name, outdoor };
  }

  // Joins: rects of one room, and rooms the plan says are open to each
  // other, meet across the wall gap with a strip of the room's own sector.
  const join = (A, B, sector) => {
    for (const a of A.rects)
      for (const c of B.rects) {
        const strip = gapStrip(a, c);
        if (!strip) continue;
        b.addRect(sector, strip.x1, strip.y1, strip.x2, strip.y2);
        touch.push(strip);
      }
  };
  for (const info of roomOf.values()) {
    for (let i = 0; i < info.rects.length; i++)
      for (let j = i + 1; j < info.rects.length; j++) join({ rects: [info.rects[i]] }, { rects: [info.rects[j]] }, info.sectors[0]);
  }
  for (const [p, q] of plan.open || []) {
    const A = roomOf.get(p);
    const B = roomOf.get(q);
    if (A && B) join(A, B, A.sectors[0]);
  }

  // Doors between rooms: an opening through the wall, with a lintel.
  for (const d of plan.doors || []) {
    const [A, B] = d.rooms.map((r) => roomOf.get(r));
    if (!A || !B) continue;
    const span = doorSpan(d.at, XL(A.level), YL(A.level));
    const ceil = A.floorZ + Math.max(96, Math.min(A.height, B.height, Math.round(2.1 * S)));
    const s = b.addSector({ floor: A.floorZ, ceil, floorTex: themeFor(A.name).floor, ceilTex: 'CEIL3_5', wall: 'DOORTRAK', light: 160, priority: 0 });
    b.addRect(s, span.x1, span.y1, span.x2, span.y2);
    jambs(b, span);
    A.sectors.push(s);
    manifest.sectorRoom[s] = { id: A.id, name: A.name };
    touch.push(span);
  }

  // Doors out. A door whose room has a real door in Home Assistant (lock,
  // garage cover, door sensor) becomes that door; the rest are plain Doom
  // doors. Each opens onto a yard under the sky.
  const realDoors = new Map(); // room id -> remaining HA doors
  for (const info of roomOf.values()) if (info.house) realDoors.set(info.id, [...info.house.doors]);
  const yards = [];
  (plan.exits || []).forEach((ex, i) => {
    const info = roomOf.get(ex.room);
    if (!info) return;
    const span = doorSpan(ex.at, XL(info.level), YL(info.level));
    const vertical = span.x2 - span.x1 < span.y2 - span.y1;
    const outward = outwardDir(span, info, vertical);
    const yard = yardRect(span, vertical, outward, Math.round(YARD_DEPTH * S));
    const outsideHr = ex.outside ? byKey.get(norm(ex.outside)) : null;
    if (outsideHr) used.add(outsideHr.id);
    const yid = outsideHr ? outsideHr.id : `_yard_${i}`;
    const ys = b.addSector({ floor: info.floorZ, ceil: info.floorZ + 288, floorTex: 'GRASS1', ceilTex: 'F_SKY1', wall: 'BRICK7', light: 200, priority: 1 });
    b.addRect(ys, yard.x1, yard.y1, yard.x2, yard.y2);
    yards.push({ id: yid, name: outsideHr ? outsideHr.name : ex.name ? `Outside the ${ex.name.toLowerCase()}` : 'Outside', sector: ys, rect: yard, house: outsideHr, floorZ: info.floorZ, door: info });
    manifest.sectorRoom[ys] = { id: yid, name: yards[yards.length - 1].name, outdoor: true };

    const ds = b.addSector({ floor: info.floorZ, ceil: info.floorZ, floorTex: themeFor(info.name).floor, ceilTex: 'CEIL3_5', wall: 'DOORTRAK', light: 160, priority: 0 });
    b.addRect(ds, span.x1, span.y1, span.x2, span.y2);
    // The plan can name the door (lock.front_door, cover.garage); otherwise
    // the room's own doors in Home Assistant are used in order.
    const allDoors = house.rooms.flatMap((r) => r.doors);
    let real = ex.door ? allDoors.find((d) => [d.lock, d.cover, d.sensor].includes(ex.door)) : null;
    if (real) for (const list of realDoors.values()) { const k = list.indexOf(real); if (k >= 0) list.splice(k, 1); }
    else real = (realDoors.get(info.id) || []).shift();
    const faces = faceEdges(span, vertical);
    if (real) {
      const ref = { kind: 'door', door: real.id };
      const tex = real.cover ? 'BIGDOOR3' : 'BIGDOOR2';
      for (const [a, c] of faces) b.addFeature(a, c, { special: SPECIAL.DOOR, tag: i + 1, tex, ref });
      jambs(b, span, real.lock ? 'DOORRED' : 'DOORTRAK');
      manifest.doors.push({ ...real, name: real.name || ex.name, sector: ds, room: info.id, x: (span.x1 + span.x2) / 2, y: (span.y1 + span.y2) / 2 });
    } else {
      // An ordinary Doom door (use to open; it closes behind you).
      for (const [a, c] of faces) b.addFeature(a, c, { special: 1, tex: 'BIGDOOR1' });
      jambs(b, span);
    }
    info.sectors.push(ds);
    manifest.sectorRoom[ds] = { id: info.id, name: info.name };
    touch.push(span);
  });

  // Stairs between levels: a few steps up or down, then a teleport line.
  (plan.stairs || []).forEach((st, i) => {
    const A = roomOf.get(st.from && st.from.room);
    const B = roomOf.get(st.to && st.to.room);
    if (!A || !B) return;
    const tagA = STAIR_TAG + 2 * i;
    const tagB = tagA + 1;
    // Each end climbs (or drops) half the way, so the two halves meet.
    const half = (B.floorZ - A.floorZ) / 2;
    const name = st.name || 'Stairs';
    for (const s of addStair(b, A, rectU(st.from.rect, A.level), st.from.enter, half, tagA, tagB, touch)) manifest.sectorRoom[s] = { id: A.id, name };
    for (const s of addStair(b, B, rectU(st.to.rect, B.level), st.to.enter, -half, tagB, tagA, touch)) manifest.sectorRoom[s] = { id: B.id, name };
    manifest.stairs = manifest.stairs || [];
    manifest.stairs.push({ name: st.name || 'Stairs', from: A.id, to: B.id });
  });

  // Areas the plan has no room for: an annex beyond the last yard.
  const leftovers = house.rooms.filter(
    (r) => !used.has(r.id) && r.lights.length + r.switches.length + r.media.length + r.vacuums.length + (r.cameras || []).length + r.doors.length > 0,
  );
  if (leftovers.length) {
    const all = [...roomOf.values()].flatMap((r) => r.rects).concat(yards.map((y) => y.rect));
    const bb = bboxOf(all);
    let x = bb.x1;
    const y1 = bb.y1 - 64 - 384;
    const lane = b.addSector({ floor: 0, ceil: 288, floorTex: 'GRASS1', ceilTex: 'F_SKY1', wall: 'BRICK7', light: 200, priority: 1 });
    // A path along the bottom joins the annex to every yard that reaches it.
    b.addRect(lane, bb.x1, bb.y1 - 64, bb.x2, bb.y1);
    manifest.sectorRoom[lane] = { id: '_annex_path', name: 'The path', outdoor: true };
    for (const hr of leftovers) {
      const w = 384;
      const s = b.addSector({ floor: 0, ceil: 128, floorTex: themeFor(hr.name).floor, ceilTex: themeFor(hr.name).ceil, wall: themeFor(hr.name).wall, light: 160, priority: 2 });
      const r = { x1: x, x2: x + w, y1, y2: y1 + 320 };
      b.addRect(s, r.x1, r.y1, r.x2, r.y2);
      // doorway up to the path
      const dw = b.addSector({ floor: 0, ceil: 112, floorTex: themeFor(hr.name).floor, ceilTex: 'CEIL3_5', wall: 'DOORTRAK', light: 160, priority: 0 });
      const span = { x1: x + w / 2 - 48, x2: x + w / 2 + 48, y1: r.y2, y2: bb.y1 - 64 };
      b.addRect(dw, span.x1, span.y1, span.x2, span.y2);
      const info = { id: hr.id, name: hr.name, sectors: [s, dw], floorZ: 0, rects: [r], bbox: r, center: centreOf([r]), spawns: [], outdoor: false, fixtures: [], house: hr, height: 128 };
      roomOf.set(`_annex_${hr.id}`, info);
      manifest.sectorRoom[s] = { id: hr.id, name: hr.name };
      manifest.sectorRoom[dw] = { id: hr.id, name: hr.name };
      touch.push(span);
      x += w + 64;
    }
    // Make sure the path reaches a yard: stretch the south-most yard down.
    const south = yards.reduce((best, y) => (!best || y.rect.y1 < best.rect.y1 ? y : best), null);
    if (south && south.rect.y1 > bb.y1) b.addRect(south.sector, south.rect.x1, bb.y1, south.rect.x2, south.rect.y1);
  }

  // Yards are rooms too (lamps, spawns), named after their HA area if any.
  for (const y of yards) {
    if ([...roomOf.values()].some((r) => r.id === y.id)) {
      const r = [...roomOf.values()].find((q) => q.id === y.id);
      r.sectors.push(y.sector);
      r.rects.push(y.rect);
      if (!r.hosts.includes(y.door)) r.hosts.push(y.door);
      continue;
    }
    roomOf.set(`_yardroom_${y.id}`, { id: y.id, name: y.name, sectors: [y.sector], floorZ: y.floorZ, rects: [y.rect], bbox: y.rect, center: centreOf([y.rect]), spawns: [], outdoor: true, fixtures: [], house: y.house, height: 288, hosts: [y.door] });
  }

  // Whole-house areas: their things go round the plan's indoor rooms.
  const hosts = [...roomOf.values()].filter((r) => r.house && !r.outdoor && r.rects.length && !String(r.id).startsWith('_annex'));
  const extra = new Map(hosts.map((r) => [r, { lights: [], switches: [], media: [], cameras: [] }]));
  let turn = 0;
  for (const hr of anywhere)
    for (const k of ['lights', 'switches', 'media', 'cameras'])
      for (const e of hr[k] || []) if (hosts.length) extra.get(hosts[turn++ % hosts.length])[k].push(e);

  // Screens that find no wall wide enough in their own room (a yard is only
  // a few metres of garden) are hung somewhere else afterwards.
  const overflow = [];
  const placeScreen = (s, info, kind, entity) => {
    if (kind === 'media') {
      b.addFeature(s.a, s.b128, { tex: 'COMPSTA1', special: SPECIAL.MEDIA, ref: { kind: 'media', entity } });
      return;
    }
    const texture = CAMERA_TEXTURES[manifest.cameras.length];
    b.addFeature(s.a, s.b128, { tex: texture, special: SPECIAL.CAMERA, ref: { kind: 'camera', entity } });
    manifest.cameras.push({ entity, texture, room: info.id, x: (s.a[0] + s.b128[0]) / 2, y: (s.a[1] + s.b128[1]) / 2 });
  };

  // Fixtures, lamps, spawn spots, room by room.
  for (const info of roomOf.values()) {
    const more = extra.get(info);
    const hr = info.house && more ? Object.fromEntries(Object.entries(info.house).map(([k, v]) => [k, more[k] ? [...v, ...more[k]] : v])) : info.house;
    const slots = wallSlots(info, touch);
    const take = (wide) => {
      for (let i = 0; i < slots.length; i++) {
        if (slots[i].len >= (wide ? 128 : 64)) return slots.splice(i, 1)[0];
      }
      return null;
    };
    if (hr) {
      for (const media of hr.media) {
        const s = take(true);
        if (s) placeScreen(s, info, 'media', media.entity_id);
        else overflow.push({ kind: 'media', entity: media.entity_id, from: info });
      }
      for (const cam of hr.cameras || []) {
        const s = take(true);
        if (s) {
          if (manifest.cameras.length < CAMERA_TEXTURES.length) placeScreen(s, info, 'camera', cam.entity_id);
        } else overflow.push({ kind: 'camera', entity: cam.entity_id, from: info });
      }
      for (const sw of hr.switches) {
        const s = take(false);
        if (!s) break;
        b.addFeature(s.a, s.b64, { tex: 'SW1COMP', special: SPECIAL.SWITCH, ref: { kind: 'switch', entity: sw.entity_id } });
      }
    }
    info.spawns = freeSpots(info, manifest.doors, touch);
    if (hr) placeLamps(manifest, hr, info);
    info.slotsLeft = slots;
  }

  // The player starts where the plan says, or in the first room.
  const startRoom = roomOf.get(plan.start && plan.start.room) || [...roomOf.values()][0];
  const at = plan.start && plan.start.at ? [X(plan.start.at[0]), Y(plan.start.at[1])] : startRoom.center;
  manifest.start = { x: at[0], y: at[1], z: startRoom.floorZ };
  b.addThing(at[0], at[1], THING.PLAYER1, 0);
  b.addThing(at[0] + 48, at[1] + 24, THING.SHOTGUN);
  b.addThing(at[0] + 48, at[1] - 24, THING.SHELLS);
  // The way out: an exit switch on a free wall of the start room.
  // A narrow stretch of wall if there is one: the wide ones take screens.
  const narrow = (startRoom.slotsLeft || []).findIndex((sl) => sl.len < 128);
  const exitSlot = startRoom.slotsLeft && (narrow >= 0 ? startRoom.slotsLeft.splice(narrow, 1)[0] : startRoom.slotsLeft.shift());
  if (exitSlot) {
    const mid = [(exitSlot.a[0] + exitSlot.b64[0]) / 2, (exitSlot.a[1] + exitSlot.b64[1]) / 2];
    const half = [(exitSlot.b64[0] - exitSlot.a[0]) / 4, (exitSlot.b64[1] - exitSlot.a[1]) / 4];
    b.addFeature([mid[0] - half[0], mid[1] - half[1]], [mid[0] + half[0], mid[1] + half[1]], { mid: 'SW1EXIT', special: 11, ref: { kind: 'exit' } });
  }
  // The screens that did not fit: an outside camera goes on the wall inside
  // the door that leads out there, like a door entry screen; anything else
  // in the nearest room with a wall to spare.
  const indoor = [...roomOf.values()].filter((r) => !r.outdoor);
  for (const item of overflow) {
    if (item.kind === 'camera' && manifest.cameras.length >= CAMERA_TEXTURES.length) continue;
    const from = item.from.center;
    const near = (r) => Math.hypot(r.center[0] - from[0], r.center[1] - from[1]);
    const order = [...new Set([...(item.from.hosts || []), ...indoor.filter((r) => r.floorZ === item.from.floorZ).sort((p, q) => near(p) - near(q))])];
    for (const host of order) {
      const i = (host.slotsLeft || []).findIndex((sl) => sl.len >= 128);
      if (i < 0) continue;
      placeScreen(host.slotsLeft.splice(i, 1)[0], host, item.kind, item.entity);
      break;
    }
  }

  // Pickups, for flavour, by room theme.
  for (const info of roomOf.values()) {
    const n = info.name || '';
    const spot = () => info.spawns.splice(Math.floor(info.spawns.length / 2), 1)[0];
    if (/kitchen|kök/i.test(n) && info.spawns.length) b.addThing(...spot(), THING.CHAINSAW);
    if (/bath|shower|dusch|badrum|toilet|wc/i.test(n) && info.spawns.length) b.addThing(...spot(), THING.MEDIKIT);
    if (/bed|sov|quiet/i.test(n) && info.spawns.length) b.addThing(...spot(), THING.GREEN_ARMOR);
  }

  for (const info of roomOf.values()) {
    manifest.rooms.push({ id: info.id, name: info.name, sectors: info.sectors, floorZ: info.floorZ, bbox: info.bbox, center: info.center, spawns: info.spawns, outdoor: info.outdoor, fixtures: [] });
  }
  // Bridges and line problems flicker the lights of the room you start in.
  manifest.hallSectors = startRoom.sectors.slice(0, 1);
  const map = b.build();
  map.linedefs.forEach((l, i) => {
    if (l.ref) manifest.lines[i] = l.ref;
  });
  for (const d of manifest.doors) {
    d.lines = map.linedefs.flatMap((l, i) => (l.ref && l.ref.kind === 'door' && l.ref.door === d.id ? [i] : []));
  }
  return { lumps: encodeMap(map), manifest, map };
}

// Geometry helpers ---------------------------------------------------------------

// One end of a stair: steps that run away from the room's edge `enter`
// ('n', 's', 'e' or 'w' on the plan), climbing (rise > 0) or dropping that
// far in Doom units, then a short landing whose edge teleports you to the
// other end (tag `to`). You arrive on the last step (tag `own`) facing back
// out into the room. Returns the stair's sectors.
function addStair(b, info, raw, enter, rise, own, to, touch) {
  // Plan north is Doom +y. Inset like a room, except on the side it opens
  // onto, which reaches out to meet the room.
  const r = { x1: raw.x1 + GAP, x2: raw.x2 - GAP, y1: raw.y1 + GAP, y2: raw.y2 - GAP };
  const run = { n: [0, -1], s: [0, 1], e: [-1, 0], w: [1, 0] }[enter]; // Doom direction up the stair
  if (!run) throw new Error(`stair: enter must be n, s, e or w, not ${enter}`);
  if (enter === 'n') r.y2 = raw.y2 + GAP;
  if (enter === 's') r.y1 = raw.y1 - GAP;
  if (enter === 'e') r.x2 = raw.x2 + GAP;
  if (enter === 'w') r.x1 = raw.x1 - GAP;
  const alongX = run[0] !== 0;
  const depth = alongX ? r.x2 - r.x1 : r.y2 - r.y1;
  const landing = 24;
  const n = Math.max(2, Math.min(8, Math.floor((depth - landing) / 14)));
  const tread = (depth - landing) / n;
  // Distance from the open edge to a Doom coordinate range along the run.
  const slab = (d1, d2) => {
    if (run[0] > 0) return [r.x1 + d1, r.y1, r.x1 + d2, r.y2];
    if (run[0] < 0) return [r.x2 - d2, r.y1, r.x2 - d1, r.y2];
    if (run[1] > 0) return [r.x1, r.y1 + d1, r.x2, r.y1 + d2];
    return [r.x1, r.y2 - d2, r.x2, r.y2 - d1];
  };
  const base = info.floorZ;
  // Steps a player can walk (at most 24 high), however far the levels are apart.
  const step = Math.sign(rise || 1) * Math.min(24, Math.max(8, Math.round(Math.abs(rise) / n)));
  const ceil = base + info.height + Math.max(0, n * step);
  const sectors = [];
  let last = null;
  for (let k = 1; k <= n; k++) {
    const s = b.addSector({ floor: base + k * step, ceil, floorTex: 'STEP1', ceilTex: 'CEIL3_5', wall: 'BROWN1', riser: 'STEP1', light: 160, priority: 2, tag: k === n ? own : 0 });
    b.addRect(s, ...slab(Math.round((k - 1) * tread), Math.round(k * tread)));
    info.sectors.push(s);
    sectors.push(s);
    last = s;
  }
  const top = b.addSector({ floor: base + n * step, ceil, floorTex: 'STEP1', ceilTex: 'CEIL3_5', wall: 'BROWN1', light: 160, priority: 2 });
  const end = slab(Math.round(n * tread), depth);
  b.addRect(top, ...end);
  info.sectors.push(top);
  sectors.push(top);
  // The teleport line: the edge between the top step and the landing.
  const cut = Math.round(n * tread);
  const [x1, y1, x2, y2] = slab(cut, cut);
  b.addFeature([x1, y1], [x2, y2], { special: WR_TELEPORT, tag: to, frontSector: last });
  // Arrive on the top step, facing down it.
  const [ax1, ay1, ax2, ay2] = slab(Math.round((n - 1) * tread), cut);
  const angle = { '1,0': 180, '-1,0': 0, '0,1': 270, '0,-1': 90 }[run.join(',')];
  b.addThing((ax1 + ax2) / 2, (ay1 + ay2) / 2, TELEPORT_DEST, angle);
  // Nothing hangs on the wall where the stair opens.
  const mouth = slab(-GAP * 2, 0);
  touch.push({ x1: Math.min(mouth[0], mouth[2]), y1: Math.min(mouth[1], mouth[3]), x2: Math.max(mouth[0], mouth[2]), y2: Math.max(mouth[1], mouth[3]) });
  return sectors;
}

function bboxOf(rects) {
  return {
    x1: Math.min(...rects.map((r) => r.x1)),
    x2: Math.max(...rects.map((r) => r.x2)),
    y1: Math.min(...rects.map((r) => r.y1)),
    y2: Math.max(...rects.map((r) => r.y2)),
  };
}

// The middle of the biggest rect: always inside the room, even an L.
function centreOf(rects) {
  const big = rects.reduce((best, r) => ((r.x2 - r.x1) * (r.y2 - r.y1) > (best.x2 - best.x1) * (best.y2 - best.y1) ? r : best));
  return [Math.round((big.x1 + big.x2) / 2), Math.round((big.y1 + big.y2) / 2)];
}

// Two inset rects that faced each other across one wall: the strip between.
function gapStrip(a, c) {
  const near = (u, v) => Math.abs(u - v) <= 2 * GAP + 1;
  const oy1 = Math.max(a.y1, c.y1);
  const oy2 = Math.min(a.y2, c.y2);
  const ox1 = Math.max(a.x1, c.x1);
  const ox2 = Math.min(a.x2, c.x2);
  if (oy2 - oy1 > 8) {
    if (near(a.x2, c.x1) && c.x1 > a.x2) return { x1: a.x2, x2: c.x1, y1: oy1, y2: oy2 };
    if (near(c.x2, a.x1) && a.x1 > c.x2) return { x1: c.x2, x2: a.x1, y1: oy1, y2: oy2 };
  }
  if (ox2 - ox1 > 8) {
    if (near(a.y2, c.y1) && c.y1 > a.y2) return { x1: ox1, x2: ox2, y1: a.y2, y2: c.y1 };
    if (near(c.y2, a.y1) && a.y1 > c.y2) return { x1: ox1, x2: ox2, y1: c.y2, y2: a.y1 };
  }
  return null;
}

// A door given as two points on a wall line: the rect through the wall gap.
function doorSpan(at, X, Y) {
  const [[ax, ay], [bx, by]] = at;
  const vertical = Math.abs(ax - bx) < Math.abs(ay - by);
  if (vertical) {
    const x = X((ax + bx) / 2);
    return { x1: x - GAP, x2: x + GAP, y1: Math.min(Y(ay), Y(by)) + GAP, y2: Math.max(Y(ay), Y(by)) - GAP };
  }
  const y = Y((ay + by) / 2);
  return { x1: Math.min(X(ax), X(bx)) + GAP, x2: Math.max(X(ax), X(bx)) - GAP, y1: y - GAP, y2: y + GAP };
}

function jambs(b, span, tex = 'DOORTRAK') {
  const vertical = span.x2 - span.x1 < span.y2 - span.y1;
  if (vertical) {
    b.addFeature([span.x1, span.y1], [span.x2, span.y1], { mid: tex, flags: ML.DONTPEGBOTTOM });
    b.addFeature([span.x1, span.y2], [span.x2, span.y2], { mid: tex, flags: ML.DONTPEGBOTTOM });
  } else {
    b.addFeature([span.x1, span.y1], [span.x1, span.y2], { mid: tex, flags: ML.DONTPEGBOTTOM });
    b.addFeature([span.x2, span.y1], [span.x2, span.y2], { mid: tex, flags: ML.DONTPEGBOTTOM });
  }
}

function faceEdges(span, vertical) {
  return vertical
    ? [
        [[span.x1, span.y1], [span.x1, span.y2]],
        [[span.x2, span.y1], [span.x2, span.y2]],
      ]
    : [
        [[span.x1, span.y1], [span.x2, span.y1]],
        [[span.x1, span.y2], [span.x2, span.y2]],
      ];
}

// Which way is outside: away from the room the door belongs to.
function outwardDir(span, info, vertical) {
  const c = info.center;
  if (vertical) return (span.x1 + span.x2) / 2 > c[0] ? 1 : -1;
  return (span.y1 + span.y2) / 2 > c[1] ? 1 : -1;
}

function yardRect(span, vertical, dir, depth) {
  const margin = 32;
  if (vertical) {
    const x = dir > 0 ? span.x2 : span.x1;
    return { x1: dir > 0 ? x : x - depth, x2: dir > 0 ? x + depth : x, y1: span.y1 - margin, y2: span.y2 + margin };
  }
  const y = dir > 0 ? span.y2 : span.y1;
  return { x1: span.x1 - margin, x2: span.x2 + margin, y1: dir > 0 ? y : y - depth, y2: dir > 0 ? y + depth : y };
}

// Free stretches of solid wall in a room, cut into fixture slots. A slot
// knows its 64- and 128-wide ends and lies on the room's side of the wall.
function wallSlots(info, touch) {
  const slots = [];
  const blocked = (x1, y1, x2, y2) =>
    touch.some((t) => !(Math.max(x1, x2) < t.x1 - 24 || Math.min(x1, x2) > t.x2 + 24 || Math.max(y1, y2) < t.y1 - 24 || Math.min(y1, y2) > t.y2 + 24));
  for (const r of info.rects) {
    const edges = [
      { a: [r.x1, r.y1], d: [0, 1], len: r.y2 - r.y1 }, // west, going north
      { a: [r.x2, r.y2], d: [0, -1], len: r.y2 - r.y1 }, // east, going south
      { a: [r.x1, r.y2], d: [1, 0], len: r.x2 - r.x1 }, // north, going east
      { a: [r.x2, r.y1], d: [-1, 0], len: r.x2 - r.x1 }, // south, going west
    ];
    for (const e of edges) {
      for (let t = 48; t + 64 <= e.len - 48; t += SLOT) {
        const a = [e.a[0] + e.d[0] * t, e.a[1] + e.d[1] * t];
        const b64 = [a[0] + e.d[0] * 64, a[1] + e.d[1] * 64];
        const b128 = [a[0] + e.d[0] * 128, a[1] + e.d[1] * 128];
        if (blocked(a[0], a[1], b64[0], b64[1])) continue;
        const room128 = t + 128 <= e.len - 48 && !blocked(a[0], a[1], b128[0], b128[1]);
        slots.push({ a, b64, b128, len: room128 ? 128 : 64 });
        if (room128) t += SLOT; // a wide slot uses two
      }
    }
  }
  return slots;
}

function freeSpots(info, doors, touch) {
  const spots = [];
  for (const r of info.rects) {
    for (let x = r.x1 + 48; x <= r.x2 - 48; x += 64)
      for (let y = r.y1 + 48; y <= r.y2 - 48; y += 64) {
        if (touch.some((t) => Math.hypot(x - (t.x1 + t.x2) / 2, y - (t.y1 + t.y2) / 2) < 96)) continue;
        spots.push([x, y]);
      }
  }
  return spots;
}

function placeLamps(manifest, hr, info) {
  if (!hr.lights.length) return;
  const nearWall = (p) => Math.min(...info.rects.map((r) => (p[0] >= r.x1 && p[0] <= r.x2 && p[1] >= r.y1 && p[1] <= r.y2 ? Math.min(p[0] - r.x1, r.x2 - p[0], p[1] - r.y1, r.y2 - p[1]) : Infinity)));
  const candidates = info.spawns.filter((p) => nearWall(p) <= 64);
  const pool = candidates.length ? candidates : info.spawns;
  const lights = hr.lights.slice(0, 32);
  const step = Math.max(1, Math.floor(pool.length / lights.length));
  const used = new Set();
  lights.forEach((light, i) => {
    let p = pool[(i * step) % Math.max(1, pool.length)];
    if (!p || used.has(p.join(','))) p = pool.find((q) => !used.has(q.join(','))) || info.spawns.find((q) => !used.has(q.join(',')));
    if (!p) return;
    used.add(p.join(','));
    const idx = info.spawns.findIndex((q) => q[0] === p[0] && q[1] === p[1]);
    if (idx >= 0) info.spawns.splice(idx, 1);
    manifest.lamps.push({ entity: light.entity_id, room: info.id, x: p[0], y: p[1] });
  });
}
