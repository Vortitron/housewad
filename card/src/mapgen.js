// House model -> Doom map.
//
// With no floor plan to go on, every floor becomes a corridor with its rooms
// down both sides, and floors are joined by staircases. A room's real doors
// sit in its outer wall and open onto a yard under the sky.
//
// Input (see model.js):
//   { floors: [{ id, name, level }],
//     rooms: [{ id, name, floor, lights: [...], switches: [...], media: [...],
//               doors: [{ id, name, lock, cover, sensor }] }] }
// Output: { lumps, manifest } where lumps still need nodes (nodes.js).

import { MapBuilder, encodeMap, ML } from './geometry.js';

export const SPECIAL = { SWITCH: 900, MEDIA: 901, DOOR: 902, CAMERA: 903 };

// 128x128 textures the generated house never uses otherwise; each camera's
// picture is written into one of them while the game runs.
export const CAMERA_TEXTURES = ['COMPUTE1', 'COMPUTE3', 'SP_DUDE1', 'SP_DUDE2', 'MARBFACE', 'ZZWOLF1', 'SKULWALL', 'CRATWIDE'];

export const THING = {
  PLAYER1: 1,
  SHOTGUN: 2001,
  CHAINSAW: 2005,
  SHELLS: 2008,
  CLIP: 2007,
  STIMPACK: 2011,
  MEDIKIT: 2012,
  GREEN_ARMOR: 2018,
};

const CORRIDOR = 160; // corridor width
const WALL = 16; // wall thickness between spaces
const DOORWAY = 96; // room-to-corridor opening
const DOOR = 128; // real door width (BIGDOOR2 is 128 wide)
const YARD = 256;
const STOREY = 128; // floor-to-floor height
const STEP = 32; // stair tread depth
const SLOT = 96; // wall fixture spacing

// Room themes by name. First match wins; English and Swedish names.
const THEMES = [
  { re: /kitchen|kök|kok/i, wall: 'COMPTILE', floor: 'FLOOR1_1', ceil: 'CEIL1_1' },
  { re: /bath|toilet|wc|shower|badrum|toalett|dusch|tvätt|laundry|utility/i, wall: 'MARBGRAY', floor: 'FLAT1_3', ceil: 'CEIL3_1' },
  { re: /bed|sov|nursery|guest|gäst|barn|kid/i, wall: 'WOOD1', floor: 'FLAT14', ceil: 'CEIL1_3' },
  { re: /living|lounge|vardag|family|sitting|\btv\b|\bden\b|sällskap/i, wall: 'WOOD3', floor: 'FLAT5_1', ceil: 'CEIL3_5' },
  { re: /office|study|kontor|work|arbet|server|network|data/i, wall: 'COMPBLUE', floor: 'FLOOR7_1', ceil: 'CEIL5_1' },
  { re: /garage|workshop|verkstad|shed|förråd|storage|cellar|källare|basement|boiler|pann/i, wall: 'CEMENT1', floor: 'FLOOR4_8', ceil: 'CEIL5_2' },
  { re: /hall|entr|porch|hall|farstu|stair|trapp|landing|corridor/i, wall: 'BROWN1', floor: 'FLAT5_4', ceil: 'CEIL3_5' },
  { re: /dining|matsal|matrum/i, wall: 'PANEL1', floor: 'FLAT5_2', ceil: 'CEIL3_5' },
  { re: /garden|trädgård|patio|terrace|balcon|altan|outdoor|ute|yard|deck/i, wall: 'BRICK7', floor: 'GRASS1', ceil: 'F_SKY1', outdoor: true },
];
const DEFAULT_THEME = { wall: 'STARTAN2', floor: 'FLOOR0_1', ceil: 'CEIL3_5' };

export function themeFor(name) {
  return THEMES.find((t) => t.re.test(name || '')) || DEFAULT_THEME;
}

function roomSize(room) {
  const switches = room.switches.length;
  const media = room.media.length;
  const doors = room.doors.length;
  let width = 384;
  let depth = 384;
  // Wall fixtures go on the side walls first, then the outer wall.
  const need = switches + (media + (room.cameras || []).length) * 2;
  const sideSlots = (d) => 2 * Math.floor((d - 96) / SLOT);
  const outerSlots = (w) => Math.max(0, Math.floor((w - 64 - doors * (DOOR + 64)) / SLOT));
  while (sideSlots(depth) + outerSlots(width) < need && depth < 1024) depth += SLOT;
  while (sideSlots(depth) + outerSlots(width) < need && width < 1536) width += SLOT;
  width = Math.max(width, doors * (DOOR + 96) + 64);
  width += Math.min(room.lights.length, 8) * 16;
  return { width: Math.round(width / 16) * 16, depth: Math.round(depth / 16) * 16 };
}

export function generateMap(house) {
  const b = new MapBuilder();
  const manifest = {
    rooms: [],
    lamps: [],
    lines: {},
    doors: [],
    cameras: [],
    sectorRoom: {},
    start: null,
  };

  const floors = [...(house.floors.length ? house.floors : [{ id: '_ground', name: 'Home', level: 0 }])];
  floors.sort((a, b2) => (a.level ?? 0) - (b2.level ?? 0));
  const floorIds = new Set(floors.map((f) => f.id));
  const groundFloor = floors.reduce((best, f) =>
    Math.abs(f.level ?? 0) < Math.abs(best.level ?? 0) ? f : best,
  );
  const roomsByFloor = new Map(floors.map((f) => [f.id, []]));
  for (const room of house.rooms) {
    const fid = floorIds.has(room.floor) ? room.floor : groundFloor.id;
    roomsByFloor.get(fid).push(room);
  }
  // An empty house still gets one room to stand in.
  if (!house.rooms.length) {
    roomsByFloor.get(groundFloor.id).push({ id: '_home', name: 'Home', lights: [], switches: [], media: [], doors: [] });
  }

  let x = 0;
  let prevCorridor = null;
  let prevZ = 0;
  let doorCount = 0;

  floors.forEach((floor, fi) => {
    const z = (floor.level ?? 0) * STOREY;
    const rooms = roomsByFloor.get(floor.id);

    // Staircase from the previous floor's corridor east end.
    if (prevCorridor !== null) {
      const rise = z - prevZ;
      const steps = Math.max(1, Math.round(Math.abs(rise) / 16));
      const top = Math.max(z, prevZ) + 128;
      for (let i = 1; i < steps; i++) {
        const sz = prevZ + Math.round((rise * i) / steps);
        const s = b.addSector({ floor: sz, ceil: top, floorTex: 'STEP1', ceilTex: 'CEIL3_5', wall: 'BROWN1', riser: 'STEP1', light: 160 });
        b.addRect(s, x, -CORRIDOR / 2, x + STEP, CORRIDOR / 2);
        x += STEP;
      }
      if (steps === 1) {
        const s = b.addSector({ floor: prevZ, ceil: top, floorTex: 'FLAT5_4', wall: 'BROWN1', light: 160 });
        b.addRect(s, x, -CORRIDOR / 2, x + 64, CORRIDOR / 2);
        x += 64;
      }
    }

    // Place rooms either side, balancing the two sides' lengths.
    const sides = { north: [], south: [] };
    const len = { north: 64, south: 64 };
    for (const room of rooms) {
      const size = roomSize(room);
      const side = len.north <= len.south ? 'north' : 'south';
      sides[side].push({ room, size, x0: x + len[side] });
      len[side] += size.width + WALL;
    }
    const corridorLen = Math.max(len.north, len.south, 256) + 48;
    const corridor = b.addSector({
      floor: z,
      ceil: z + 128,
      floorTex: 'FLAT5_4',
      ceilTex: 'CEIL3_5',
      wall: 'BROWN1',
      riser: 'STEP1',
      light: 176,
    });
    b.addRect(corridor, x, -CORRIDOR / 2, x + corridorLen, CORRIDOR / 2);
    if (floor.id === groundFloor.id) {
      manifest.start = { x: x + 64, y: 0, z };
      b.addThing(x + 64, 0, THING.PLAYER1, 0);
      b.addThing(x + 128, 32, THING.SHOTGUN);
      b.addThing(x + 160, -32, THING.SHELLS);
      b.addThing(x + 192, 32, THING.SHELLS);
    }
    manifest.sectorRoom[corridor] = { id: `_corridor_${floor.id}`, name: floor.name || 'Corridor' };

    for (const sideName of ['north', 'south']) {
      const dir = sideName === 'north' ? 1 : -1;
      for (const { room, size, x0 } of sides[sideName]) {
        placeRoom(b, manifest, room, {
          x0,
          z,
          dir,
          width: size.width,
          depth: size.depth,
          floorName: floor.name,
          doorIndexStart: () => doorCount++,
        });
      }
    }

    prevCorridor = corridor;
    prevZ = z;
    x += corridorLen;
  });

  const map = b.build();
  map.linedefs.forEach((l, i) => {
    if (l.ref) manifest.lines[i] = l.ref;
  });
  for (const d of manifest.doors) {
    d.lines = map.linedefs.flatMap((l, i) => (l.ref && l.ref.kind === 'door' && l.ref.door === d.id ? [i] : []));
  }
  return { lumps: encodeMap(map), manifest, map };
}

function placeRoom(b, manifest, room, { x0, z, dir, width, depth, doorIndexStart }) {
  const theme = themeFor(room.name);
  const yIn = dir * (CORRIDOR / 2 + WALL); // corridor-side wall
  const yOut = dir * (CORRIDOR / 2 + WALL + depth); // outer wall
  const x1 = x0;
  const x2 = x0 + width;
  const cx = x0 + width / 2;

  // Outdoor areas (garden, patio) are rooms open to the sky.
  const sector = b.addSector({
    floor: z,
    ceil: z + (theme.outdoor ? 256 : 128),
    floorTex: theme.floor,
    ceilTex: theme.ceil,
    wall: theme.wall,
    light: theme.outdoor ? 200 : 160,
    priority: 2,
  });
  b.addRect(sector, x1, yIn, x2, yOut);

  // Doorway to the corridor.
  const doorway = b.addSector({
    floor: z,
    ceil: z + 112,
    floorTex: theme.floor,
    ceilTex: theme.ceil,
    wall: theme.wall,
    light: 160,
    priority: 0,
  });
  b.addRect(doorway, cx - DOORWAY / 2, dir * (CORRIDOR / 2), cx + DOORWAY / 2, yIn);
  b.addFeature([cx - DOORWAY / 2, dir * (CORRIDOR / 2)], [cx - DOORWAY / 2, yIn], { mid: 'DOORTRAK', flags: ML.DONTPEGBOTTOM });
  b.addFeature([cx + DOORWAY / 2, dir * (CORRIDOR / 2)], [cx + DOORWAY / 2, yIn], { mid: 'DOORTRAK', flags: ML.DONTPEGBOTTOM });

  const info = {
    id: room.id,
    name: room.name,
    sectors: [sector, doorway],
    floorZ: z,
    bbox: { x1, y1: Math.min(yIn, yOut), x2, y2: Math.max(yIn, yOut) },
    spawns: [],
  };
  manifest.sectorRoom[sector] = { id: room.id, name: room.name };
  manifest.sectorRoom[doorway] = { id: room.id, name: room.name };

  // Real doors in the outer wall, each onto its own stretch of yard.
  const doorXs = room.doors.map((_, i) => x1 + ((i + 1) * width) / (room.doors.length + 1));
  if (room.doors.length) {
    const yard = b.addSector({
      floor: z,
      ceil: z + 256,
      floorTex: 'GRASS1',
      ceilTex: 'F_SKY1',
      wall: 'BRICK7',
      light: 200,
      priority: 1,
    });
    const yYard = yOut + dir * WALL;
    b.addRect(yard, x1, yYard, x2, yYard + dir * YARD);
    manifest.sectorRoom[yard] = { id: `_yard_${room.id}`, name: `Outside ${room.name}`, outdoor: true };
    info.yard = yard;
    room.doors.forEach((door, i) => {
      const dx = Math.round(doorXs[i] / 16) * 16;
      const ds = b.addSector({
        floor: z,
        ceil: z,
        floorTex: theme.floor,
        ceilTex: theme.ceil,
        wall: 'DOORTRAK',
        light: 160,
        priority: 0,
      });
      b.addRect(ds, dx - DOOR / 2, yOut, dx + DOOR / 2, yYard);
      const index = doorIndexStart();
      const ref = { kind: 'door', door: door.id };
      const faceTex = door.cover ? 'BIGDOOR3' : 'BIGDOOR2';
      b.addFeature([dx - DOOR / 2, yOut], [dx + DOOR / 2, yOut], { special: SPECIAL.DOOR, tag: index + 1, tex: faceTex, ref });
      b.addFeature([dx - DOOR / 2, yYard], [dx + DOOR / 2, yYard], { special: SPECIAL.DOOR, tag: index + 1, tex: faceTex, ref });
      const jamb = door.lock ? 'DOORRED' : 'DOORTRAK';
      b.addFeature([dx - DOOR / 2, yOut], [dx - DOOR / 2, yYard], { mid: jamb, flags: ML.DONTPEGBOTTOM });
      b.addFeature([dx + DOOR / 2, yOut], [dx + DOOR / 2, yYard], { mid: jamb, flags: ML.DONTPEGBOTTOM });
      info.sectors.push(ds);
      manifest.sectorRoom[ds] = { id: room.id, name: room.name };
      manifest.doors.push({ ...door, sector: ds, room: room.id, x: dx, y: yOut });
    });
  }

  // Wall fixtures: switches (64 wide) and media panels (128 wide). Side
  // walls first, working out from the corridor end, then the outer wall.
  const slots = [];
  for (let d = 96; d + 64 <= depth - 32; d += SLOT) {
    const y = yIn + dir * d;
    slots.push({ wall: 'west', a: [x1, y], b: [x1, y + dir * 64], c: [x1 + 24, y + dir * 32], len: 64 });
    slots.push({ wall: 'east', a: [x2, y], b: [x2, y + dir * 64], c: [x2 - 24, y + dir * 32], len: 64 });
  }
  const doorKeepOut = (sx) => doorXs.some((dx) => Math.abs(sx - dx) < DOOR / 2 + 48);
  for (let sx = x1 + 48; sx + 64 <= x2 - 48; sx += SLOT) {
    if (doorKeepOut(sx) || doorKeepOut(sx + 64)) continue;
    slots.push({ wall: 'outer', a: [sx, yOut], b: [sx + 64, yOut], c: [sx + 32, yOut - dir * 24], len: 64 });
  }
  const take = (wide) => {
    if (!wide) return slots.shift();
    // A media panel needs two neighbouring slots on the same wall.
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const step = [Math.sign(s.b[0] - s.a[0]) * SLOT, Math.sign(s.b[1] - s.a[1]) * SLOT];
      const j = slots.findIndex((u) => u.wall === s.wall && u.a[0] === s.a[0] + step[0] && u.a[1] === s.a[1] + step[1]);
      if (j < 0) continue;
      const end = [s.a[0] + Math.sign(step[0]) * 128, s.a[1] + Math.sign(step[1]) * 128];
      const slot = { a: s.a, b: end, len: 128, c: s.c };
      slots.splice(Math.max(i, j), 1);
      slots.splice(Math.min(i, j), 1);
      return slot;
    }
    return null;
  };
  info.fixtures = [];
  for (const media of room.media) {
    const slot = take(true);
    if (!slot) break;
    b.addFeature(slot.a, slot.b, { tex: 'COMPSTA1', special: SPECIAL.MEDIA, ref: { kind: 'media', entity: media.entity_id } });
    info.fixtures.push(slot.c);
  }
  for (const cam of room.cameras || []) {
    if (manifest.cameras.length >= CAMERA_TEXTURES.length) break;
    const slot = take(true);
    if (!slot) break;
    const texture = CAMERA_TEXTURES[manifest.cameras.length];
    b.addFeature(slot.a, slot.b, { tex: texture, special: SPECIAL.CAMERA, ref: { kind: 'camera', entity: cam.entity_id } });
    manifest.cameras.push({ entity: cam.entity_id, texture, room: room.id, x: (slot.a[0] + slot.b[0]) / 2, y: (slot.a[1] + slot.b[1]) / 2 });
    info.fixtures.push(slot.c);
  }
  for (const sw of room.switches) {
    const slot = take(false);
    if (!slot) break;
    b.addFeature(slot.a, slot.b, { tex: 'SW1COMP', special: SPECIAL.SWITCH, ref: { kind: 'switch', entity: sw.entity_id } });
    info.fixtures.push(slot.c);
  }

  // Free floor positions for lamps, monsters and pickups.
  const free = [];
  const inner = { x1: x1 + 48, x2: x2 - 48, y1: Math.min(yIn, yOut) + 48, y2: Math.max(yIn, yOut) - 48 };
  for (let sx = inner.x1; sx <= inner.x2; sx += 64) {
    for (let sy = inner.y1; sy <= inner.y2; sy += 64) {
      if (Math.abs(sx - cx) < 72 && Math.abs(sy - yIn) < 96) continue; // keep the doorway clear
      if (doorXs.some((dx) => Math.abs(sx - dx) < 96) && Math.abs(sy - yOut) < 96) continue;
      free.push([sx, sy]);
    }
  }
  placeLamps(manifest, room, info, free);
  info.spawns = free;

  // A few pickups, for flavour.
  const pick = () => free.splice(Math.floor(free.length / 2), 1)[0];
  const name = room.name || '';
  if (/kitchen|kök/i.test(name) && free.length) b.addThing(...pick(), THING.CHAINSAW);
  if (/bath|badrum|toilet|toalett/i.test(name) && free.length) b.addThing(...pick(), THING.MEDIKIT);
  if (/bed|sov/i.test(name) && free.length) b.addThing(...pick(), THING.GREEN_ARMOR);
  if (/garage|förråd|shed|workshop/i.test(name) && free.length) b.addThing(...pick(), THING.SHELLS);

  manifest.rooms.push(info);
}

// Lamps stand near the walls, spread around the room. Positions come off the
// free list so nothing else is put on top of them.
function placeLamps(manifest, room, info, free) {
  if (!room.lights.length) return;
  const { x1, y1, x2, y2 } = info.bbox;
  const nearWall = (p) => Math.min(p[0] - x1, x2 - p[0], p[1] - y1, y2 - p[1]);
  const candidates = free
    .map((p) => ({ p, d: nearWall(p) }))
    .filter((c) => c.d <= 64)
    .map((c) => c.p);
  // Spread: take every k-th candidate around the perimeter ordering.
  const cxm = (x1 + x2) / 2;
  const cym = (y1 + y2) / 2;
  candidates.sort((a, b) => Math.atan2(a[1] - cym, a[0] - cxm) - Math.atan2(b[1] - cym, b[0] - cxm));
  const step = Math.max(1, Math.floor(candidates.length / room.lights.length));
  room.lights.forEach((light, i) => {
    const p = candidates[(i * step) % Math.max(1, candidates.length)] || [cxm, cym];
    const idx = free.findIndex((q) => q[0] === p[0] && q[1] === p[1]);
    if (idx >= 0) free.splice(idx, 1);
    manifest.lamps.push({ entity: light.entity_id, room: room.id, x: p[0], y: p[1] });
  });
}
