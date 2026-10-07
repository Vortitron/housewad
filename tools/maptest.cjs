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
  await card.evaluate((el) => el.shadowRoot.querySelector('button.map').click());
  await page.waitForTimeout(500);
  assert.equal(await on(), 0, 'and closes it again');
  assert.deepEqual(errors, []);
  console.log('map: all passed');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
