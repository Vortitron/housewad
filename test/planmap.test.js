import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFromPlan } from '../card/src/planmap.js';
import { writeWad, readWad } from '../card/src/wad.js';
import { buildNodes } from '../card/src/nodes.js';
import createZdbsp from '../dist/housewad-zdbsp.js';

// A small made-up house: an L-shaped hall, a kitchen through a door, a
// bedroom open to the hall, a front door with a real lock and a plain back door.
const plan = {
  rooms: [
    { id: 'hall', name: 'Hall', area: 'hall', height: 2, rects: [[0, 0, 6, 3], [0, 3, 3, 6]] },
    { id: 'kitchen', name: 'Kitchen', area: 'kitchen', height: 2, rects: [[6, 0, 10, 4]] },
    { id: 'bed', name: 'Bedroom', area: 'bedroom', height: 2, rects: [[3, 3, 6, 6]] },
    { id: 'hall2', name: 'Cinema', height: 4, rects: [[0, 6, 10, 12]] },
  ],
  open: [['hall', 'bed']],
  doors: [
    { rooms: ['hall', 'kitchen'], at: [[6, 1], [6, 2]] },
    { rooms: ['hall', 'hall2'], at: [[1, 6], [2, 6]] },
  ],
  exits: [
    { room: 'hall', name: 'Front door', at: [[0, 1], [0, 2]], outside: 'garden' },
    { room: 'hall2', name: 'Back door', at: [[4, 12], [5, 12]] },
  ],
  start: { room: 'hall', at: [1.5, 1.5] },
};
const room = (id, name, extra = {}) => ({ id, name, floor: null, lights: [], switches: [], media: [], vacuums: [], presence: [], windows: [], climates: [], cameras: [], doors: [], ...extra });
const house = {
  floors: [],
  rooms: [
    room('hall', 'Hall', { lights: [{ entity_id: 'light.hall' }], switches: [{ entity_id: 'switch.radio' }], doors: [{ id: 'front', name: 'Front door', lock: 'lock.front' }] }),
    room('kitchen', 'Kitchen', { lights: [{ entity_id: 'light.kitchen' }] }),
    room('bedroom', 'Bedroom', { lights: [{ entity_id: 'light.bed' }] }),
    room('garden', 'Garden', { lights: [{ entity_id: 'light.garden' }] }),
    room('shed', 'Shed', { lights: [{ entity_id: 'light.shed' }] }),
  ],
};

test('a floor plan builds a valid map with its rooms, doors and real lock', async () => {
  const { map, manifest, lumps } = generateFromPlan(plan, house);
  assert.equal(map.things.filter((t) => t.type === 1).length, 1);
  assert.equal(manifest.doors.length, 1, 'the front door is the real lock');
  assert.equal(manifest.doors[0].lock, 'lock.front');
  assert.equal(map.linedefs.filter((l) => l.special === 1).length, 2, 'the back door is a plain Doom door (two faces)');
  assert.equal(map.linedefs.filter((l) => l.special === 11).length, 1, 'one exit switch');
  const ids = manifest.rooms.map((r) => r.id).sort();
  for (const id of ['hall', 'kitchen', 'bedroom', 'garden', 'shed']) assert.ok(ids.includes(id), `${id} is in the level`);
  // Lamps stand inside their rooms; the bedroom is open to the hall.
  for (const l of manifest.lamps) {
    const r = manifest.rooms.find((x) => x.id === l.room);
    assert.ok(l.x >= r.bbox.x1 && l.x <= r.bbox.x2 && l.y >= r.bbox.y1 && l.y <= r.bbox.y2, `lamp for ${l.entity} inside ${r.name}`);
  }
  const hallSector = manifest.rooms.find((r) => r.id === 'hall').sectors[0];
  const bedSector = manifest.rooms.find((r) => r.id === 'bedroom').sectors[0];
  const open = map.linedefs.some((l) => l.back !== 0xffff && [map.sidedefs[l.front].sector, map.sidedefs[l.back].sector].sort().join() === [hallSector, bedSector].sort().join());
  assert.ok(open, 'no wall between the hall and the bedroom');
  assert.equal(map.sectors[manifest.rooms.find((r) => r.id === '_plan_hall2').sectors[0]].ceil, 256, '4 m ceiling');
  const wad = readWad(await buildNodes(createZdbsp, writeWad(lumps)));
  assert.equal(wad.find('LINEDEFS').size / 14, map.linedefs.length);
});

test('levels sit beside the house and stairs teleport between them', () => {
  const twoStorey = {
    ...plan,
    levels: { up: { offset: [0, -10], floor: 2.6 } },
    rooms: [...plan.rooms, { id: 'loft', name: 'Loft', area: 'loft', level: 'up', height: 2, rects: [[0, 0, 6, 3]] }],
    stairs: [{ name: 'Stairs up', from: { room: 'kitchen', rect: [7, -1.5, 8.2, 0], enter: 's' }, to: { room: 'loft', rect: [1, 3, 2.2, 4.5], enter: 'n' } }],
    anywhere: ['residence'],
  };
  const withLoft = {
    ...house,
    rooms: [...house.rooms, room('loft', 'Loft', { lights: [{ entity_id: 'light.loft' }] }), room('residence', 'Residence', { lights: [{ entity_id: 'light.house_wide' }] })],
  };
  const { manifest, map } = generateFromPlan(twoStorey, withLoft);
  const loft = manifest.rooms.find((r) => r.id === 'loft');
  assert.equal(loft.floorZ, Math.round(2.6 * 64), 'the loft is up a storey');
  const kitchen = manifest.rooms.find((r) => r.id === 'kitchen');
  assert.ok(loft.bbox.y1 > kitchen.bbox.y2, 'and beside the house, not on top of it');
  // Two teleport lines, each pointing at a sector the other end owns, with a destination in it.
  const lines = map.linedefs.filter((l) => l.special === 97);
  assert.equal(lines.length, 2);
  for (const l of lines) {
    const target = map.sectors.findIndex((s) => s.tag === l.tag);
    assert.ok(target >= 0, `tag ${l.tag} has a sector`);
    const sideFront = map.sidedefs[l.front];
    assert.notEqual(sideFront.sector, target, 'you never land on the line you just crossed');
  }
  assert.equal(map.things.filter((t) => t.type === 14).length, 2, 'a destination at each end');
  // Steps are walkable: no rise of more than 24 between neighbours.
  const stairSectors = Object.entries(manifest.sectorRoom).filter(([, r]) => r.name === 'Stairs up').map(([s]) => Number(s));
  assert.ok(stairSectors.length >= 4);
  for (const l of map.linedefs) {
    if (l.back === 0xffff || l.back === -1 || l.back === undefined) continue;
    const a = map.sidedefs[l.front].sector;
    const c = map.sidedefs[l.back].sector;
    if (stairSectors.includes(a) || stairSectors.includes(c)) assert.ok(Math.abs(map.sectors[a].floor - map.sectors[c].floor) <= 24, `step ${a}->${c}`);
  }
  // The whole-house area has no room; its lamp hangs in one of the plan's rooms.
  assert.ok(!manifest.rooms.some((r) => r.id === 'residence'));
  const lamp = manifest.lamps.find((l) => l.entity === 'light.house_wide');
  assert.ok(lamp && manifest.rooms.some((r) => r.id === lamp.room));
});

test("an outside area's camera that the yard has no wall for goes inside, by its door", () => {
  const withCams = {
    ...house,
    rooms: house.rooms.map((r) => (r.id === 'garden' ? { ...r, cameras: [{ entity_id: 'camera.front_snapshot' }], media: [{ entity_id: 'media_player.porch' }] } : r)),
  };
  if (!withCams.rooms.some((r) => r.id === 'garden')) withCams.rooms.push(room('garden', 'Garden', { cameras: [{ entity_id: 'camera.front_snapshot' }], media: [{ entity_id: 'media_player.porch' }] }));
  const { manifest } = generateFromPlan(plan, withCams);
  const cam = manifest.cameras.find((c) => c.entity === 'camera.front_snapshot');
  assert.ok(cam, 'the camera has a screen somewhere');
  // The hall (the front door's room) is all doors here, so the nearest room
  // with a wall to spare takes it: indoors, on the same floor.
  const host = manifest.rooms.find((r) => r.id === cam.room);
  assert.ok(host && !host.outdoor, `indoors, not out in the yard (${cam.room})`);
  assert.equal(host.floorZ, 0);
  assert.ok(Object.values(manifest.lines).some((r) => r.kind === 'media' && r.entity === 'media_player.porch'), 'and so does the media player');
  assert.ok(Object.values(manifest.lines).some((r) => r.kind === 'exit'), 'the exit switch keeps its place');
});

test('a narrow room still gets its props and somewhere for a demon to stand', () => {
  const narrow = {
    ...plan,
    rooms: [...plan.rooms, { id: 'spooky', name: 'Spooky toilet', height: 2, rects: [[10, 0, 13.6, 1.25]], things: ['barrel', 'barrel', 'barrel', 'candle'] }],
    doors: [...plan.doors, { rooms: ['kitchen', 'spooky'], at: [[10, 0.2], [10, 1.05]] }],
  };
  const { manifest, map } = generateFromPlan(narrow, house);
  assert.equal(map.things.filter((t) => t.type === 2035).length, 3, 'three barrels');
  assert.equal(map.things.filter((t) => t.type === 34).length, 1, 'and a candle');
  const room = manifest.rooms.find((r) => r.name === 'Spooky toilet');
  assert.ok(room.spawns.length > 0 || room.center, 'a spot, or at least its middle');
});
