// The plan editor in the card's settings: with no plan it starts from a
// sketch of the home's areas, rooms drag and snap, doors go where you click a
// wall, every change reaches the card's config, and the plan it makes builds
// a level you can walk: doors between rooms, stairs between floors.
// node tools/planedittest.cjs  (harness served on :18765)
const { chromium } = require('playwright');
const assert = require('assert');
const SP = process.env.SP || '/tmp';
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1200, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:18765/tools/harness/card.html');
  await page.waitForFunction(() => window.booted && customElements.get('housewad-card-editor'));
  await page.evaluate(() => {
    const ed = customElements.get('housewad-card').getConfigElement();
    ed.id = 'ed';
    document.body.prepend(ed);
    window.configs = [];
    ed.addEventListener('config-changed', (e) => window.configs.push(e.detail.config));
    ed.setConfig({ type: 'custom:housewad-card', allow: ['light.*'] });
    ed.hass = window.hass;
    ed.shadowRoot.querySelector('[data-draw]').click();
  });
  await page.waitForTimeout(300);
  const sketch = await page.evaluate(() => {
    const last = window.configs[window.configs.length - 1];
    const pe = document.getElementById('ed').shadowRoot.querySelector('housewad-plan-editor');
    return { plan: last && last.floorplan, tabs: [...pe.shadowRoot.querySelectorAll('[data-level]')].map((x) => x.textContent), rects: pe.shadowRoot.querySelectorAll('rect[data-r]').length, doors: pe.shadowRoot.querySelectorAll('line.door').length };
  });
  console.log('sketch:', sketch.plan.rooms.map((r) => `${r.id}${r.level ? '@' + r.level : ''}`).join(' '), '| tabs', sketch.tabs, '| rects', sketch.rects, '| doors shown', sketch.doors);
  assert.ok(sketch.plan && sketch.plan.sketch, 'no plan: a sketch of the areas, sent to the config');
  assert.ok(sketch.rects > 0, 'rooms drawn');
  assert.ok(sketch.doors > 0, 'the doors house.wad adds are shown');
  await page.screenshot({ path: `${SP}/planedit-sketch.png` });

  // Drag the first room one metre right: it snaps, and the config follows.
  const pe = page.locator('#ed housewad-plan-editor');
  await pe.evaluate((el) => el.shadowRoot.querySelector('.canvas').scrollIntoView({ block: 'center' }));
  const box = await pe.evaluate((el) => {
    const r = el.shadowRoot.querySelector('rect[data-r]');
    const i = Number(r.dataset.r);
    const b = r.getBoundingClientRect();
    const svg = el.shadowRoot.querySelector('svg');
    const m = svg.getScreenCTM();
    return { i, x: b.x + b.width / 2, y: b.y + b.height / 2, perMetre: m.a, before: el.plan.rooms[i].rects[0] };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.perMetre * 1.02, box.y, { steps: 6 });
  await page.mouse.up();
  const moved = await page.evaluate((id) => window.configs[window.configs.length - 1].floorplan.rooms.find((r) => r.id === id).rects[0], await pe.evaluate((el, i) => el.plan.rooms.find((r, j) => r.id && j >= 0 && r.rects) && el.plan.rooms[el.plan.rooms.length - 1].id, box.i));
  console.log('moved', box.before, '->', moved);
  assert.ok(Math.abs(moved[0] - box.before[0] - 1) < 0.26, 'moved about a metre, snapped');

  // Doors: a click on the wall between two rooms puts a door there.
  await pe.evaluate((el) => el.shadowRoot.querySelector('[data-act="mode-doors"]').click());
  await pe.evaluate((el) => el.shadowRoot.querySelector('.canvas').scrollIntoView({ block: 'center' }));
  const wall = await pe.evaluate((el) => {
    // The longest wall between two rooms on this floor, from the plan itself.
    const rooms = el.plan.rooms.filter((r) => (r.level || '') === el.level);
    let best = null;
    for (let i = 0; i < rooms.length; i++)
      for (let j = i + 1; j < rooms.length; j++)
        for (const p of rooms[i].rects)
          for (const q of rooms[j].rects) {
            if (Math.abs(p[2] - q[0]) < 1e-6 || Math.abs(q[2] - p[0]) < 1e-6) {
              const x = Math.abs(p[2] - q[0]) < 1e-6 ? p[2] : p[0];
              const lo = Math.max(p[1], q[1]);
              const hi = Math.min(p[3], q[3]);
              if (hi - lo > 1 && (!best || hi - lo > best.len)) best = { x, y: (lo + hi) / 2, len: hi - lo };
            }
          }
    if (!best) return null;
    const svg = el.shadowRoot.querySelector('svg');
    const pt = svg.createSVGPoint();
    pt.x = best.x;
    pt.y = best.y;
    const s = pt.matrixTransform(svg.getScreenCTM());
    return { x: s.x, y: s.y };
  });
  assert.ok(wall, 'two rooms share a wall');
  await page.mouse.click(wall.x, wall.y);
  const afterDoor = await page.evaluate(() => window.configs[window.configs.length - 1].floorplan);
  console.log('doors as drawn:', afterDoor.doors.length, 'exits:', (afterDoor.exits || []).length);
  assert.ok(Array.isArray(afterDoor.doors) && afterDoor.doors.length > 0, 'doors are now as drawn, the clicked one among them');
  await page.screenshot({ path: `${SP}/planedit-doors.png` });

  // The plan builds a level with stairs between the floors.
  const built = await page.evaluate(async (plan) => {
    const { generateFromPlan } = await import('/card/src/planmap.js');
    const { buildHouse } = await import('/card/src/model.js');
    const { map, manifest } = generateFromPlan(plan, buildHouse(window.hass));
    // A doorway between rooms is its own little sector, walled in door track.
    const doorways = map.sectors.filter((s, i) => map.sidedefs.some((sd) => sd.sector === i && sd.mid === 'DOORTRAK')).length;
    return { rooms: manifest.rooms.length, teleports: map.linedefs.filter((l) => l.special === 97).length, doorways, completed: manifest.completed };
  }, afterDoor);
  console.log('level:', built);
  assert.ok(built.teleports >= 2, 'stairs both ways between the floors');
  assert.ok(built.doorways >= afterDoor.doors.length, `a doorway for every door drawn (${built.doorways})`);
  assert.deepEqual(errors, []);
  console.log('plan editor: all passed');
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
