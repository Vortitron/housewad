// The plan card: the floor plan without the game. Rooms in their lights'
// colours, floor tabs, people as named dots, a click on a lamp switches it,
// and the plan can come from another dashboard. Saves screenshots.
// node tools/plancardtest.cjs  (harness served on :18765)
const { chromium } = require('playwright');
const assert = require('assert');
const SP = process.env.SP || '/tmp';
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const open = async (q) => {
    await page.goto(`http://127.0.0.1:18765/tools/harness/plan.html${q}`);
    await page.waitForFunction(() => window.booted && window.card.built, null, { timeout: 30000 });
    await page.waitForTimeout(600);
  };
  await open('?plan=positions.json&people=positions');
  const info = await page.evaluate(() => {
    const root = window.card.shadowRoot;
    return { people: root.querySelector('.people').textContent, canvas: root.querySelector('canvas').width, tabs: root.querySelectorAll('.floors button').length };
  });
  console.log(info);
  assert.match(info.people, /Alex \(Alex phone\): /, 'people are listed with their phone');
  assert.ok(info.canvas > 800, 'drawn at the screen resolution');
  await page.screenshot({ path: `${SP}/plancard.png` });

  // A click on a lamp switches its light.
  const lamp = await page.evaluate(() => {
    const c = window.card;
    const l = c.built.manifest.lamps[0];
    const f = c.overmap.fit;
    const r = c.shadowRoot.querySelector('canvas').getBoundingClientRect();
    return { entity: l.entity, x: r.left + f.w / 2 + (l.x - f.cx) * f.s, y: r.top + f.h / 2 - (l.y - f.cy) * f.s };
  });
  await page.mouse.click(lamp.x, lamp.y);
  const calls = await page.evaluate(() => window.calls);
  assert.deepEqual(calls[0], ['light', 'toggle', { entity_id: lamp.entity }], 'the lamp was switched');

  // Floors are tabs; the plan can come from the house.wad dashboard.
  await open('?plan=twostorey.json&from');
  const tabs = await page.evaluate(() => [...window.card.shadowRoot.querySelectorAll('.floors button')].map((x) => x.textContent));
  console.log('floors:', tabs);
  assert.ok(tabs.length === 3, 'three floors, three tabs');
  await page.evaluate(() => window.card.shadowRoot.querySelectorAll('.floors button')[1].click());
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SP}/plancard-up.png` });
  assert.deepEqual(errors, []);
  console.log('plan card: all passed');
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
