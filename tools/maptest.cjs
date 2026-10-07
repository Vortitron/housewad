// The overhead map: the Map button opens Doom's automap, which shows the
// house at a glance (lamps, demons, people, room names); press it again to
// get back to the game. Saves a screenshot to look at.
// node tools/maptest.cjs  (harness served on :18765)
const { chromium } = require('playwright');
const assert = require('assert');
const SP = process.env.SP || '/tmp';
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1000, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:18765/tools/harness/card.html?plan=chores.json&chores&people');
  const card = page.locator('housewad-card');
  await card.waitFor();
  await page.waitForTimeout(800);
  await card.evaluate((el) => el.shadowRoot.querySelector('button.practice').click());
  await page.waitForFunction(() => window.card.link && window.card.link.ready, null, { timeout: 60000 });
  await page.keyboard.type('iddqd');
  await page.waitForTimeout(1500);
  const on = () => page.evaluate(() => window.card.engine.module._hw_automap_on());
  assert.equal(await on(), 0);
  await card.evaluate((el) => el.shadowRoot.querySelector('button.map').click());
  await page.waitForTimeout(700);
  assert.equal(await on(), 1, 'the Map button opens the overhead map');
  await page.screenshot({ path: `${SP}/automap.png` });
  // Count the colours the house view draws (palette entries as RGB).
  const colours = await page.evaluate(() => {
    const c = window.card.shadowRoot.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const pal = window.card.engine.palette || null;
    const seen = {};
    for (let i = 0; i < d.length; i += 4) { const k = `${d[i]},${d[i + 1]},${d[i + 2]}`; seen[k] = (seen[k] || 0) + 1; }
    return seen;
  });
  const has = (pred) => Object.entries(colours).some(([k, n]) => { const [r, g, bl] = k.split(',').map(Number); return n > 3 && pred(r, g, bl); });
  assert.ok(has((r, g, bl) => r > 200 && g > 200 && bl < 120), 'yellow: a lamp that is on');
  assert.ok(has((r, g, bl) => g > 120 && g > r + 40 && g > bl + 40), 'green: Alex or a fly brain');
  // The mouse works the map. Screen pixels of the 320x200 frame, to page pixels.
  const box = await card.evaluate((el) => { const r = el.shadowRoot.querySelector('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  // Over the card's own sharp map, through its view; else Doom's frame stretched.
  const hires = await card.evaluate((el) => !!el.overmap);
  let toPage = (fx, fy) => [box.x + (fx / 320) * box.w, box.y + (fy / 200) * box.h];
  if (hires) {
    const pts = {};
    toPage = (fx, fy) => pts[`${fx},${fy}`];
    const want = async (fx, fy) => (pts[`${fx},${fy}`] = await card.evaluate((el, [x, y]) => { const r = el.shadowRoot.querySelector('canvas.hires').getBoundingClientRect(); const p = el.overmap.fromDoom(x, y); return [r.left + p[0], r.top + p[1]]; }, [fx, fy]));
    toPage.want = want;
  }
  const at = async (fx, fy) => (toPage.want ? (await toPage.want(fx, fy)) : toPage(fx, fy));
  const world = (fx, fy) => page.evaluate(([x, y]) => window.card.link.mapPoint(x, y), [fx, fy]);
  const before = await world(160, 84);
  // Wheel in: one map pixel covers less of the house.
  await page.mouse.move(...(await at(160, 84)));
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(300);
  const zoomed = await world(160, 84);
  assert.ok(zoomed.tol < before.tol, `zooms in (${before.tol} -> ${zoomed.tol})`);
  assert.ok(Math.hypot(zoomed.x - before.x, zoomed.y - before.y) < before.tol, 'about the point under the pointer');
  // Drag: the map moves with the pointer.
  await page.mouse.down();
  await page.mouse.move(...(await at(200, 84)), { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const panned = await world(160, 84);
  assert.ok(panned.x < zoomed.x - 10, `drags to pan (${zoomed.x} -> ${panned.x})`);
  // Hover over a lamp says what it is; a click switches it (practice: locally).
  const lamp = await page.evaluate(() => {
    const l = window.card.link;
    const lamp = l.manifest.lamps.find((x) => x.entity === 'light.kitchen_ceiling') || l.manifest.lamps[0];
    // Where the lamp is on screen: search the frame for the pixel over it.
    for (let y = 2; y < 166; y += 2) for (let x = 2; x < 318; x += 2) {
      const p = l.mapPoint(x, y);
      if (p && Math.hypot(p.x - lamp.x, p.y - lamp.y) < p.tol / 2) return { x, y, entity: lamp.entity };
    }
    return { entity: lamp.entity };
  });
  assert.ok(lamp.x !== undefined, 'the lamp is on the map');
  await page.mouse.move(...(await at(lamp.x, lamp.y)));
  await page.waitForTimeout(300);
  const hover = await page.evaluate(() => window.card.link.status().target);
  console.log('hover:', hover);
  assert.match(hover, /click to switch/);
  const wasOn = await page.evaluate((e) => window.card.link.actions.state(e).state, lamp.entity);
  await page.mouse.click(...(await at(lamp.x, lamp.y)));
  await page.waitForTimeout(800);
  const nowOn = await page.evaluate((e) => window.card.link.actions.state(e).state, lamp.entity);
  assert.notEqual(nowOn, wasOn, `clicking the lamp switched it (${wasOn} -> ${nowOn})`);
  // Double-click a room: you go there.
  const kitchen = await page.evaluate(() => {
    const l = window.card.link;
    const k = l.manifest.rooms.find((r) => r.id === 'kitchen');
    for (let y = 2; y < 166; y += 3) for (let x = 2; x < 318; x += 3) {
      const p = l.mapPoint(x, y);
      if (p && p.x > k.bbox.x1 + 64 && p.x < k.bbox.x2 - 64 && p.y > k.bbox.y1 + 64 && p.y < k.bbox.y2 - 64) return { x, y };
    }
    return null;
  });
  assert.ok(kitchen, 'the kitchen is on the map');
  await page.mouse.dblclick(...(await at(kitchen.x, kitchen.y)));
  await page.waitForTimeout(500);
  const where = await page.evaluate(() => { const l = window.card.link; return (l.manifest.sectorRoom[l.player().sector] || {}).id; });
  assert.equal(where, 'kitchen', 'double-click took you there');
  await page.screenshot({ path: `${SP}/automap-mouse.png` });

  await card.evaluate((el) => el.shadowRoot.querySelector('button.map').click());
  await page.waitForTimeout(500);
  assert.equal(await on(), 0, 'and closes it again');
  assert.deepEqual(errors, []);
  console.log('map: all passed');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
