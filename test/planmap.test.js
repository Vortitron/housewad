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
