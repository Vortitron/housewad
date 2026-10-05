import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateMap, SPECIAL } from '../card/src/mapgen.js';
import { writeWad, readWad } from '../card/src/wad.js';
import { buildNodes } from '../card/src/nodes.js';
import createZdbsp from '../dist/housewad-zdbsp.js';

const fixture = JSON.parse(readFileSync(new URL('../tools/fixtures/house.json', import.meta.url), 'utf8'));

const room = (id, name, floor, extra = {}) => ({ id, name, floor, lights: [], switches: [], media: [], doors: [], ...extra });

function checkMap(map, manifest) {
  const { vertices, linedefs, sidedefs, sectors, things } = map;
  for (const v of vertices) {
    assert.ok(Math.abs(v[0]) < 32000 && Math.abs(v[1]) < 32000, `vertex in range: ${v}`);
  }
  linedefs.forEach((l, i) => {
    assert.ok(l.v1 !== l.v2, `line ${i} has length`);
    assert.ok(l.front < sidedefs.length, `line ${i} front side`);
    if (l.back !== 0xffff) {
      assert.ok(l.flags & 4, `line ${i} two-sided flag`);
      assert.ok(l.back < sidedefs.length);
    }
  });
  for (const s of sidedefs) assert.ok(s.sector >= 0 && s.sector < sectors.length);
  // Every sector is closed: each vertex of a sector's lines has even degree.
  sectors.forEach((_, si) => {
    const degree = new Map();
    linedefs.forEach((l) => {
      const touches = sidedefs[l.front].sector === si || (l.back !== 0xffff && sidedefs[l.back].sector === si);
      if (!touches) return;
      if (l.back !== 0xffff && sidedefs[l.front].sector === si && sidedefs[l.back].sector === si) return;
      for (const v of [l.v1, l.v2]) degree.set(v, (degree.get(v) || 0) + 1);
    });
    for (const [v, d] of degree) assert.equal(d % 2, 0, `sector ${si} closed at vertex ${vertices[v]}`);
  });
  assert.equal(things.filter((t) => t.type === 1).length, 1, 'one player start');
  for (const [line, ref] of Object.entries(manifest.lines)) {
    const l = linedefs[line];
    const want = { switch: SPECIAL.SWITCH, media: SPECIAL.MEDIA, door: SPECIAL.DOOR }[ref.kind];
    assert.equal(l.special, want, `line ${line} special for ${ref.kind}`);
  }
  for (const d of manifest.doors) {
    assert.equal(d.lines.length, 2, `door ${d.id} has two faces`);
    assert.equal(sectors[d.sector].ceil, sectors[d.sector].floor, 'doors start closed');
  }
  for (const r of manifest.rooms) {
    for (const [x, y] of r.spawns) {
      assert.ok(x > r.bbox.x1 && x < r.bbox.x2 && y > r.bbox.y1 && y < r.bbox.y2, `spawn inside ${r.name}`);
    }
  }
  for (const lamp of manifest.lamps) {
    const r = manifest.rooms.find((x) => x.id === lamp.room);
    assert.ok(lamp.x > r.bbox.x1 && lamp.x < r.bbox.x2 && lamp.y > r.bbox.y1 && lamp.y < r.bbox.y2, `lamp inside ${r.name}`);
  }
}

async function nodesBuild(lumps, linedefCount) {
  const wad = await buildNodes(createZdbsp, writeWad(lumps));
  const w = readWad(wad);
  assert.equal(w.find('LINEDEFS').size / 14, linedefCount, 'node builder kept every line');
  assert.ok(w.find('NODES').size > 0, 'nodes built');
  return wad;
}

test('the fixture house builds a valid map', async () => {
  const { map, manifest, lumps } = generateMap(fixture);
  checkMap(map, manifest);
  assert.equal(manifest.lamps.length, 11);
  assert.equal(manifest.doors.length, 2);
  assert.equal(Object.values(manifest.lines).filter((r) => r.kind === 'switch').length, 5);
  await nodesBuild(lumps, map.linedefs.length);
});

test('an empty house still has somewhere to stand', async () => {
  const { map, manifest, lumps } = generateMap({ floors: [], rooms: [] });
  checkMap(map, manifest);
  assert.equal(manifest.rooms.length, 1);
  await nodesBuild(lumps, map.linedefs.length);
});

test('basement, ground and two upper floors join with stairs', async () => {
  const house = {
    floors: [
      { id: 'b', name: 'Basement', level: -1 },
      { id: 'g', name: 'Ground', level: 0 },
      { id: 'u', name: 'Up', level: 1 },
      { id: 'a', name: 'Attic', level: 2 },
    ],
    rooms: [room('cellar', 'Cellar', 'b'), room('hall', 'Hall', 'g'), room('bed', 'Bedroom', 'u'), room('loft', 'Loft', 'a')],
  };
  const { map, manifest, lumps } = generateMap(house);
  checkMap(map, manifest);
  const floors = new Set(map.sectors.map((s) => s.floor));
  for (const z of [-128, 0, 128, 256]) assert.ok(floors.has(z), `a sector at height ${z}`);
  // No step is higher than the player can climb.
  const start = manifest.start;
  assert.equal(start.z, 0, 'start on the ground floor');
  await nodesBuild(lumps, map.linedefs.length);
});

test('a big house with crowded rooms and odd names', async () => {
  const rooms = [];
  for (let i = 0; i < 30; i++) {
    rooms.push(
      room(`r${i}`, i % 3 ? `Rum ${i} – kök åäö` : `Room ${i}`, null, {
        lights: Array.from({ length: i % 7 }, (_, k) => ({ entity_id: `light.r${i}_${k}` })),
        switches: Array.from({ length: i % 13 }, (_, k) => ({ entity_id: `switch.r${i}_${k}` })),
        media: Array.from({ length: i % 3 }, (_, k) => ({ entity_id: `media_player.r${i}_${k}` })),
        doors: i % 5 === 0 ? [{ id: `d${i}`, name: 'Door', lock: `lock.d${i}` }, { id: `e${i}`, name: 'Back', sensor: `binary_sensor.e${i}` }] : [],
      }),
    );
  }
  const { map, manifest, lumps } = generateMap({ floors: [], rooms });
  checkMap(map, manifest);
  const placed = Object.values(manifest.lines).filter((r) => r.kind === 'switch').length;
  const wanted = rooms.reduce((n, r) => n + r.switches.length, 0);
  assert.equal(placed, wanted, 'every switch found a wall');
  await nodesBuild(lumps, map.linedefs.length);
});

test('rooms on an unknown floor go to the ground floor', () => {
  const { manifest } = generateMap({ floors: [{ id: 'g', name: 'G', level: 0 }], rooms: [room('x', 'X', 'nope')] });
  assert.equal(manifest.rooms[0].floorZ, 0);
});

test('a garden is outdoors, not a den', async () => {
  const { themeFor } = await import('../card/src/mapgen.js');
  assert.ok(themeFor('Garden').outdoor);
  assert.ok(!themeFor('Garden').wall.startsWith('WOOD'));
  assert.equal(themeFor('TV room').wall, 'WOOD3');
});
