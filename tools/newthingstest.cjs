// The level is built once: a device added during a game is announced, once,
// with what to do about it. node tools/newthingstest.cjs  (harness on :18765)
const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:18765/tools/harness/card.html');
  const card = page.locator('housewad-card');
  await card.waitFor();
  await page.waitForTimeout(800);
  await card.evaluate((el) => el.shadowRoot.querySelector('button.practice').click());
  await page.waitForFunction(() => window.card.link && window.card.link.ready, null, { timeout: 60000 });
  const last = () => page.evaluate(() => (window.card.link.status().last || {}).text || '');

  // Nothing new yet: no message.
  await page.evaluate(() => window.card._lookForNewThings());
  assert.ok(!/New in the house/.test(await last()), 'quiet while nothing changed');

  // Someone adds a camera to the hallway.
  await page.evaluate(() => {
    const h = window.card.hass;
    const states = { ...h.states, 'camera.porch_snapshot': { entity_id: 'camera.porch_snapshot', state: 'idle', attributes: { friendly_name: 'Porch snapshot' }, last_changed: new Date().toISOString() } };
    const entities = { ...h.entities, 'camera.porch_snapshot': { entity_id: 'camera.porch_snapshot', area_id: 'hallway', device_id: null } };
    window.card.hass = { ...h, states, entities };
    window.card._lookForNewThings();
  });
  const msg = await last();
  console.log('message:', msg);
  assert.match(msg, /New in the house: Porch snapshot\. Quit and play again to add it\./);

  // Said once, not every 15 seconds.
  await page.evaluate(() => { window.card.link.message('something else'); window.card._lookForNewThings(); });
  assert.equal(await last(), 'something else', 'announced once');
  assert.deepEqual(errors, []);
  console.log('new things: all passed');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
