// The overhead map on a phone: two fingers pinch to zoom, one drags it, a
// tap on a lamp switches it, a double tap goes to the room.
// node tools/touchmaptest.cjs  (harness served on :18765)
const { chromium } = require('playwright');
const assert = require('assert');
const SP = process.env.SP || '/tmp';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  await page.goto('http://127.0.0.1:18765/tools/harness/card.html?plan=chores.json&chores&people');
  const card = page.locator('housewad-card');
  await card.waitFor();
  await page.waitForTimeout(800);
  await card.evaluate((el) => el.shadowRoot.querySelector('button.practice').click());
  await page.waitForFunction(() => window.card.link && window.card.link.ready, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await card.evaluate((el) => el.shadowRoot.querySelector('button.map').click());
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => window.card.engine.module._hw_automap_on()), 1, 'the map is up');
  const keys = await card.evaluate((el) => [...el.shadowRoot.querySelectorAll('.touch [data-key]')].filter((k) => getComputedStyle(k).visibility === 'visible').map((k) => k.textContent.trim()));
  console.log('touch keys on the map:', keys);
  assert.deepEqual(keys, ['MAP'], 'on the map only the MAP key stays, so fingers reach the map');
  const rect = await card.evaluate((el) => { const r = el.shadowRoot.querySelector('canvas.hires').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const mid = [rect.x + rect.w / 2, rect.y + rect.h / 2];
  const view = () => page.evaluate(() => window.card.link.mapView());

  // Pinch out: two fingers apart, the map zooms in.
  const before = await view();
  await touch('touchStart', [[mid[0] - 30, mid[1]], [mid[0] + 30, mid[1]]]);
  for (let k = 1; k <= 8; k++) await touch('touchMove', [[mid[0] - 30 - k * 10, mid[1]], [mid[0] + 30 + k * 10, mid[1]]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(300);
  const zoomed = await view();
  console.log('width of the map shown:', Math.round(before.w), '->', Math.round(zoomed.w));
  assert.ok(zoomed.w < before.w * 0.6, 'pinching out zooms in');

  // One finger drags the map.
  await touch('touchStart', [[mid[0], mid[1]]]);
  for (let k = 1; k <= 6; k++) await touch('touchMove', [[mid[0] + k * 12, mid[1]]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(300);
  const panned = await view();
  console.log('map x:', Math.round(zoomed.x), '->', Math.round(panned.x));
  assert.ok(panned.x < zoomed.x - 10, 'dragging right moves the map with the finger');

  // Back out, and tap a lamp: it switches (practice: locally).
  await touch('touchStart', [[mid[0] - 120, mid[1]], [mid[0] + 120, mid[1]]]);
  for (let k = 1; k <= 8; k++) await touch('touchMove', [[mid[0] - 120 + k * 12, mid[1]], [mid[0] + 120 - k * 12, mid[1]]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(400);
  const lamp = await card.evaluate((el) => {
    const l = el.link.manifest.lamps.find((x) => x.entity === 'light.kitchen_ceiling') || el.link.manifest.lamps[0];
    const r = el.shadowRoot.querySelector('canvas.hires').getBoundingClientRect();
    const f = el.overmap.fit;
    return { entity: l.entity, x: r.left + f.w / 2 + (l.x - f.cx) * f.s, y: r.top + f.h / 2 - (l.y - f.cy) * f.s };
  });
  const was = await page.evaluate((e) => window.card.link.actions.state(e).state, lamp.entity);
  await touch('touchStart', [[lamp.x, lamp.y]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(800);
  const now = await page.evaluate((e) => window.card.link.actions.state(e).state, lamp.entity);
  console.log('tap on', lamp.entity, was, '->', now);
  assert.notEqual(now, was, 'a tap switches the lamp');
  await page.screenshot({ path: `${SP}/touchmap.png` });

  // A double tap on a room goes there.
  const room = await card.evaluate((el) => {
    // A room you are not in, whose middle is on screen and clear of lamps.
    const c = el.shadowRoot.querySelector('canvas.hires').getBoundingClientRect();
    const f = el.overmap.fit;
    const p = el.link.player();
    const here = el.link.manifest.sectorRoom[p.sector];
    const toScreen = ([mx, my]) => [c.left + f.w / 2 + (mx - f.cx) * f.s, c.top + f.h / 2 - (my - f.cy) * f.s];
    for (const r of el.link.manifest.rooms) {
      if (!r.name || r.outdoor || (here && r.id === here.id) || String(r.id).startsWith('_')) continue;
      const m = r.center || [(r.bbox.x1 + r.bbox.x2) / 2, (r.bbox.y1 + r.bbox.y2) / 2];
      const [x, y] = toScreen(m);
      const nearLamp = el.link.manifest.lamps.some((l) => Math.hypot(l.x - m[0], l.y - m[1]) < 48);
      if (x > c.left + 10 && x < c.right - 10 && y > c.top + 10 && y < c.bottom - 10 && !nearLamp) return { id: r.id, x, y };
    }
    return null;
  });
  assert.ok(room, 'a room to go to, on screen');
  for (let k = 0; k < 2; k++) {
    await touch('touchStart', [[room.x, room.y]]);
    await touch('touchEnd', []);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(600);
  const where = await page.evaluate(() => window.card.link.status().room);
  console.log('after a double tap on', room.id, ':', where);
  assert.ok(where, 'somewhere');
  const at = await page.evaluate(() => { const p = window.card.link.player(); return window.card.link.manifest.sectorRoom[p.sector]; });
  assert.equal(at && at.id, room.id, 'a double tap takes you to the room');
  assert.deepEqual(errors, []);
  console.log('touch map: all passed');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
