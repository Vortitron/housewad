import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completePlan } from '../card/src/plancomplete.js';
import { generateFromPlan } from '../card/src/planmap.js';
import { writeWad, readWad } from '../card/src/wad.js';
import { buildNodes } from '../card/src/nodes.js';
import createZdbsp from '../dist/housewad-zdbsp.js';

// What Mosaic sketches from Home Assistant's areas, or its editor saves:
// rooms on floors, and nothing else.
const sketch = {
  sketch: true,
  rooms: [
    { id: 'kitchen', name: 'Kitchen', area: 'kitchen', rects: [[0, 0, 4, 4]] },
    { id: 'living', name: 'Living Room', area: 'living_room', rects: [[4, 0, 9, 4]] },
    { id: 'hall', name: 'Hall', area: 'hall', rects: [[0, 4, 9, 6]] },
    { id: 'garden', name: 'Garden', area: 'garden', outdoor: true, rects: [[9.5, 0, 13, 6]] },
    { id: 'patio', name: 'Patio', area: 'patio', outdoor: true, rects: [[9, 0, 9.5, 6]] },
    { id: 'bedroom', name: 'Bedroom', area: 'bedroom', level: 'upstairs', rects: [[0, 0, 5, 4]] },
    { id: 'bath', name: 'Bathroom', area: 'bathroom', level: 'upstairs', rects: [[5, 0, 9, 4]] },
  ],
  levels: { upstairs: { floor: 2.7 } },
};

test('a plan of rooms only gets doors, a way out, stairs and a place for each floor', () => {
  const { plan, added } = completePlan(sketch);
  const pairs = plan.doors.map((d) => d.rooms.slice().sort().join('+')).sort();
  assert.deepEqual(pairs, ['bath+bedroom', 'hall+kitchen', 'hall+living', 'kitchen+living']);
  for (const d of plan.doors) {
    const [[x1, y1], [x2, y2]] = d.at;
    assert.ok(Math.hypot(x2 - x1, y2 - y1) <= 0.9 + 1e-9, 'a door-sized gap');
  }
  assert.deepEqual(plan.exits.map((e) => `${e.room}>${e.outside}`).sort(), ['hall>patio', 'living>patio'], 'doors out onto the patio drawn against the house');
  assert.deepEqual(plan.open.map((p) => p.slice().sort()), [['garden', 'patio']], 'no wall between the patio and the garden');
  assert.equal(plan.stairs.length, 1);
  assert.equal(plan.stairs[0].from.room, 'kitchen', 'the rooms that overlap most: kitchen under the bedroom');
  assert.equal(plan.stairs[0].to.room, 'bedroom');
  assert.ok(plan.levels.upstairs.offset[0] >= 13, 'upstairs sits beside the house in the map');
  assert.deepEqual(added, { doors: 4, exits: 2, open: 1, stairs: 1, levels: ['upstairs'], trimmed: [], dropped: 0 });
});

test('a plan that lists its own doors and stairs keeps exactly those', () => {
  const own = { ...sketch, doors: [], exits: [], stairs: [], levels: { upstairs: { floor: 2.7, offset: [20, 0] } } };
  const { plan, added } = completePlan(own);
  assert.deepEqual(plan.doors, []);
  assert.deepEqual(plan.exits, []);
  assert.deepEqual(plan.stairs, []);
  assert.deepEqual(plan.levels.upstairs.offset, [20, 0]);
  assert.deepEqual(added, { doors: 0, exits: 0, open: 0, stairs: 0, levels: [], trimmed: [], dropped: 0 });
});

test('a sketched plan builds a playable level', async () => {
  const { map, manifest, lumps } = generateFromPlan(sketch, { rooms: [] });
  assert.equal(map.linedefs.filter((l) => l.special === 97).length, 2, 'a teleporting flight each way');
  assert.equal(map.linedefs.filter((l) => l.special === 1).length, 4, 'two doors out onto the patio, two faces each');
  assert.equal(manifest.completed.doors, 4);
  const wad = readWad(await buildNodes(createZdbsp, writeWad(lumps)));
  assert.equal(wad.find('LINEDEFS').size / 14, map.linedefs.length);
});

test('rooms drawn over each other: the one listed later keeps the space; a door left in mid-air goes', () => {
  const drawn = {
    rooms: [
      { id: 'a', rects: [[0, 0, 5, 4]] },
      { id: 'b', rects: [[4, 0, 8, 4]] },
    ],
    doors: [
      { rooms: ['a', 'b'], at: [[4, 1], [4, 2]] }, // on b's wall: kept
      { rooms: ['a', 'b'], at: [[2, 1], [2, 2]] }, // in the middle of a: dropped
    ],
  };
  const { plan, added } = completePlan(drawn);
  assert.deepEqual(plan.rooms.find((r) => r.id === 'a').rects, [[0, 0, 4, 4]], 'a gives way to b, listed later');
  assert.deepEqual(plan.doors.map((d) => d.at[0][0]), [4]);
  assert.deepEqual(added.trimmed, ['a']);
  assert.equal(added.dropped, 1);
  assert.doesNotThrow(() => generateFromPlan(drawn, { rooms: [] }));
});

test("GamlaBio-style stairs beside their room, and its tiny overlaps, survive", async () => {
  const { readFileSync } = await import('node:fs');
  const two = JSON.parse(readFileSync(new URL('../tools/harness/twostorey.json', import.meta.url)));
  const { plan, added } = completePlan(two);
  assert.equal(plan.stairs.length, two.stairs.length);
  assert.equal(plan.doors.length, two.doors.length);
  assert.equal(added.dropped, 0);
});
