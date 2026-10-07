import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planToSh3d, sh3dToPlan, homeXmlToPlan, polygonToRects } from '../card/src/sh3d.js';
import { writeZip } from '../card/src/zip.js';
import { generateFromPlan } from '../card/src/planmap.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../tools/harness/${f}`, import.meta.url)));
const area = (rects) => rects.reduce((s, [x1, y1, x2, y2]) => s + Math.abs((x2 - x1) * (y2 - y1)), 0);
const pairs = (list) => (list || []).map((p) => [...p].sort().join('|')).sort();

for (const file of ['twostorey.json', 'positions.json', 'chores.json']) {
  test(`${file}: out to Sweet Home 3D and back is the same plan`, async () => {
    const plan = load(file);
    const back = await sh3dToPlan(planToSh3d(plan, 'Test'), null);
    assert.deepEqual(back.rooms.map((r) => r.id).sort(), plan.rooms.map((r) => r.id).sort());
    for (const r of plan.rooms) {
      const b = back.rooms.find((q) => q.id === r.id);
      assert.ok(Math.abs(area(b.rects) - area(r.rects)) < 0.01, `${r.id} keeps its floor area`);
      assert.equal(b.level || '', r.level || '');
      assert.equal(b.area, r.area);
    }
    assert.deepEqual(back.doors.map((d) => [...d.rooms].sort().join('|')).sort(), (plan.doors || []).map((d) => [...d.rooms].sort().join('|')).sort());
    assert.deepEqual(back.exits.map((e) => e.name).sort(), (plan.exits || []).map((e) => e.name).sort());
    assert.deepEqual(pairs(back.open), pairs(plan.open));
    for (const [k, lv] of Object.entries(plan.levels || {})) assert.equal(back.levels[k].floor, lv.floor);
    assert.equal((back.stairs || []).length, (plan.stairs || []).length);
    assert.doesNotThrow(() => generateFromPlan(back, { rooms: [] }));
  });
}

test('a home drawn in Sweet Home 3D: rooms inside their walls, a door from the catalogue, a window', () => {
  // Two rooms side by side, drawn (as Sweet Home 3D does) up to the faces of
  // 10 cm walls centred on x = 0, 400, 800 and y = 0, 300.
  const xml = `<?xml version='1.0'?>
<home version='7000' wallHeight='250'>
  <wall xStart='0' yStart='0' xEnd='800' yEnd='0' thickness='10' height='250'/>
  <wall xStart='800' yStart='0' xEnd='800' yEnd='300' thickness='10' height='250'/>
  <wall xStart='800' yStart='300' xEnd='0' yEnd='300' thickness='10' height='250'/>
  <wall xStart='0' yStart='300' xEnd='0' yEnd='0' thickness='10' height='250'/>
  <wall xStart='400' yStart='0' xEnd='400' yEnd='300' thickness='10' height='250'/>
  <doorOrWindow name='Door' x='400' y='150' width='90' depth='10' height='210' angle='1.5707964' elevation='0' model='door.obj'/>
  <doorOrWindow name='Window' x='200' y='0' width='120' depth='10' height='100' angle='0' elevation='90' model='window.obj'/>
  <room name='Kitchen'><point x='5' y='5'/><point x='395' y='5'/><point x='395' y='295'/><point x='5' y='295'/></room>
  <room name='Living room'><point x='405' y='5'/><point x='795' y='5'/><point x='795' y='295'/><point x='405' y='295'/></room>
  <label x='100' y='100'><text>Start</text></label>
  <label x='700' y='50'><text>BLE: LivingProxy</text></label>
</home>`;
  const plan = homeXmlToPlan(xml);
  const kitchen = plan.rooms.find((r) => r.name === 'Kitchen');
  const living = plan.rooms.find((r) => r.name === 'Living room');
  assert.deepEqual(kitchen.rects, [[0, 0, 4, 3]], 'out to the middle of its walls');
  assert.deepEqual(living.rects, [[4, 0, 8, 3]]);
  assert.equal(plan.doors.length, 1, 'the catalogue door, not the window');
  assert.deepEqual(plan.doors[0].rooms.sort(), [kitchen.id, living.id].sort());
  assert.deepEqual(plan.doors[0].at, [[4, 1.05], [4, 1.95]]);
  assert.equal(plan.exits.length, 0, 'the outside walls have no gaps');
  assert.equal(plan.open, undefined);
  assert.equal(kitchen.height, 2.5, 'as high as its walls');
  assert.deepEqual(plan.start, { room: kitchen.id, at: [1, 1] });
  assert.deepEqual(plan.scanners, { LivingProxy: [7, 0.5] });
  assert.doesNotThrow(() => generateFromPlan(plan, { rooms: [] }));
});

test('an L-shaped room comes in as rects', () => {
  const rects = polygonToRects([[0, 0], [4, 0], [4, 2], [2, 2], [2, 5], [0, 5]]);
  assert.equal(area(rects), 4 * 2 + 2 * 3);
});

test('a zip without Home.xml is refused, saying why', async () => {
  const old = writeZip([{ name: 'Home', data: new Uint8Array([1, 2, 3]) }]);
  await assert.rejects(sh3dToPlan(old), /old Sweet Home 3D/);
  await assert.rejects(sh3dToPlan(new Uint8Array([1, 2, 3])), /not a zip/);
});
