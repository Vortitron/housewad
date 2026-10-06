// Follow: the player goes to the room the viewer's phone is in, once the
// phone has stayed there a few seconds, and not while Follow is off.
// node tools/followtest.cjs  (harness served on :18765)
const { chromium } = require('playwright');
const assert = require('assert');
const AREA = 'sensor.bermuda_aaaa1111222233334444555566667777_100_1_area';
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:18765/tools/harness/card.html?people');
  const card = page.locator('housewad-card');
  await card.waitFor();
  await page.waitForTimeout(800);
  await page.evaluate(() => { try { localStorage.removeItem('housewad-follow'); } catch (e) {} });
  await card.evaluate((el) => el.shadowRoot.querySelector('button.practice').click());
  await page.waitForFunction(() => window.card.link && window.card.link.ready, null, { timeout: 60000 });
  const room = () => page.evaluate(() => { const l = window.card.link; return (l.manifest.sectorRoom[l.player().sector] || {}).id; });
  const moveAlex = (where) => page.evaluate(([id, w]) => {
    const h = window.card.hass;
    window.card.hass = { ...h, states: { ...h.states, [id]: { ...h.states[id], state: w, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() } } };
  }, [AREA, where]);

  const btn = await card.evaluate((el) => { const b = el.shadowRoot.querySelector('button.follow'); return { hidden: b.hidden, text: b.textContent }; });
  assert.deepEqual(btn, { hidden: false, text: 'Follow Alex' }, 'the logged-in person has a phone to follow');
  const start = await room();
  console.log('start in', start);
  assert.notEqual(start, 'kitchen');

  // Off: Alex is in the kitchen, the player stays put.
  await page.waitForTimeout(7500);
  assert.equal(await room(), start, 'no following while it is off');

  await card.evaluate((el) => el.shadowRoot.querySelector('button.follow').click());
  assert.equal(await page.evaluate(() => window.card.link.following), true);
  await page.waitForTimeout(7500);
  console.log('after following:', await room(), '|', await page.evaluate(() => window.card.link.status().last.text));
  assert.equal(await room(), 'kitchen', 'followed Alex to the kitchen');

  // A two-second flip to the bedroom is Bermuda being Bermuda: stay.
  await moveAlex('Bedroom');
  await page.waitForTimeout(2000);
  await moveAlex('Kitchen');
  await page.waitForTimeout(7500);
  assert.equal(await room(), 'kitchen', 'a flip is not a move');

  // Alex goes to the living room and stays: so does the player.
  await moveAlex('Living Room');
  await page.waitForTimeout(7500);
  assert.equal(await room(), 'living_room', 'followed to the living room');

  // Bermuda loses the phone for a few seconds: Alex is still in the living room.
  await moveAlex('unknown');
  await page.waitForTimeout(3000);
  assert.equal(await page.evaluate(() => window.card.link._peopleRooms().whereIs.get('alex_phone')), 'living_room', 'no blinking out on a short unknown');
  assert.equal(await page.evaluate(() => window.card.link.monsters.has('imp:living_room')), false, 'and no imp of Alex while Alex is the player');
  await moveAlex('Living Room');

  // Off again, Alex moves on: the player doesn't.
  await card.evaluate((el) => el.shadowRoot.querySelector('button.follow').click());
  await moveAlex('Office');
  await page.waitForTimeout(7500);
  assert.equal(await room(), 'living_room', 'off means off');
  assert.equal(await page.evaluate(() => localStorage.getItem('housewad-follow')), '0', 'remembered per browser');
  assert.deepEqual(errors, []);
  console.log('follow: all passed');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
