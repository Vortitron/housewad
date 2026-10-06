// Positions within a room: Follow walks the player to where three Bluetooth
// listeners put the phone, smoothly, hands back control on a movement key,
// and in a room with a radar goes where the radar sees somebody.
// node tools/positiontest.cjs  (harness served on :18765)
const { chromium } = require('playwright');
const assert = require('assert');
const U = 64;
const at = ([x, y]) => [x * U, -y * U]; // plan metres -> map units
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:18765/tools/harness/card.html?plan=positions.json&people=positions');
  const card = page.locator('housewad-card');
  await card.waitFor();
  await page.waitForTimeout(800);
  await page.evaluate(() => { try { localStorage.removeItem('housewad-follow'); } catch (e) {} });
  await card.evaluate((el) => el.shadowRoot.querySelector('button.practice').click());
  await page.waitForFunction(() => window.card.link && window.card.link.ready, null, { timeout: 60000 });
  const me = () => page.evaluate(() => { const l = window.card.link; const p = l.player(); return { x: p.x, y: p.y, room: (l.manifest.sectorRoom[p.sector] || {}).id }; });
  const off = (p, q) => Math.hypot(p.x - q[0], p.y - q[1]);
  const moveAlex = (m) => page.evaluate((m) => { const h = window.card.hass; const states = { ...h.states }; const copy = { ...h, states }; window.setAlexAt(copy, m); window.card.hass = copy; }, m);

  await card.evaluate((el) => el.shadowRoot.querySelector('button.follow').click());
  await page.waitForTimeout(11000);
  let p = await me();
  console.log('in the kitchen at', [p.x, p.y], 'truth', at([2, 4]), 'off by', Math.round(off(p, at([2, 4]))));
  assert.equal(p.room, 'kitchen');
  assert.ok(off(p, at([2, 4])) < 80, 'within about a metre of where the listeners put Alex');

  // Alex walks across the kitchen: the player walks too, no jumps.
  await moveAlex([4.5, 1.5]);
  let prev = await me();
  let biggest = 0;
  for (let i = 0; i < 28; i++) {
    await page.waitForTimeout(250);
    const q = await me();
    biggest = Math.max(biggest, Math.hypot(q.x - prev.x, q.y - prev.y));
    prev = q;
  }
  console.log('walked to', [prev.x, prev.y], 'truth', at([4.5, 1.5]), 'largest step per 250 ms', Math.round(biggest));
  assert.ok(off(prev, at([4.5, 1.5])) < 90, 'got there');
  assert.ok(biggest < 40, 'a walk, not a jump');

  // A movement key: you take over, and Follow lets go for a while.
  await page.evaluate(() => window.card.shadowRoot.querySelector('.screen').focus());
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyS');
  const last = await page.evaluate(() => window.card.link.status().last.text);
  assert.match(last, /You took over/);
  await page.waitForTimeout(800); // let the player's own step slide to a stop
  const held = await me();
  await moveAlex([1, 5]);
  await page.waitForTimeout(3000);
  // Monsters may knock the player about; what matters is no pull towards Alex.
  const towards = off(held, at([1, 5])) - off(await me(), at([1, 5]));
  // A pull would cover ~300 units in 3 s; a monster's knock is a few dozen.
  assert.ok(towards < 64, `not pulled towards Alex while you are in control (${Math.round(towards)})`);

  // The living room has a radar: Follow goes where it sees somebody.
  await page.evaluate(() => { const l = window.card.link; l.followPausedUntil = 0; });
  await page.evaluate(() => {
    const h = window.card.hass;
    const id = 'sensor.bermuda_aaaa1111222233334444555566667777_100_1_area';
    window.card.hass = { ...h, states: { ...h.states, [id]: { ...h.states[id], state: 'Living Room', last_changed: new Date().toISOString() } } };
  });
  await page.waitForTimeout(12000);
  p = await me();
  const radarSees = at([9.3, 6]);
  console.log('living room at', [p.x, p.y], 'radar sees', radarSees, 'off by', Math.round(off(p, radarSees)));
  assert.equal(p.room, 'living_room');
  assert.ok(off(p, radarSees) < 80, 'where the radar sees somebody');

  // Follow off: Alex is an imp again, and it walks to where Alex is.
  await card.evaluate((el) => el.shadowRoot.querySelector('button.follow').click());
  await page.evaluate(() => window.card.engine.module._hw_teleport(400, -64, 0)); // out of its way
  await page.waitForTimeout(9000);
  const imp = await page.evaluate(() => {
    const l = window.card.link;
    const m = l.monsters.get('imp:living_room');
    if (!m || !l.m._hw_slot_pos(m.slot, l.out)) return null;
    return { x: l.m.HEAP32[l.out >> 2], y: l.m.HEAP32[(l.out >> 2) + 1], label: m.spec.label };
  });
  console.log('Alex the imp:', imp);
  assert.ok(imp && /Alex/.test(imp.label), 'an imp named after Alex');
  assert.ok(off(imp, radarSees) < 96, 'standing about where the radar sees Alex');
  assert.deepEqual(errors, []);
  console.log('positions: all passed');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
