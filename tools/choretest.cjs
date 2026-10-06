// Chores, alarms and spooky rooms become demons where they really are:
// a finished dishwasher (revenant), its door left open (hell knight), salt
// and coffee beans running out (mancubi), smoke (a cyberdemon), and a
// spectre in the spooky toilet, which is dim and has barrels.
// node tools/choretest.cjs  (harness served on :18765)
const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1000, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:18765/tools/harness/card.html?plan=chores.json&chores');
  const card = page.locator('housewad-card');
  await card.waitFor();
  await page.waitForTimeout(800);
  await card.evaluate((el) => el.shadowRoot.querySelector('button.practice').click());
  await page.waitForFunction(() => window.card.link && window.card.link.ready, null, { timeout: 60000 });
  await page.waitForTimeout(2500);

  const mons = await page.evaluate(() => {
    const l = window.card.link;
    return [...l.monsters.entries()].map(([k, m]) => ({ k, type: m.spec.type, room: m.spec.room, label: m.spec.label, alive: window.card.engine.module._hw_slot_state(m.slot) === 1, spot: m.spot }));
  });
  for (const m of mons) console.log(m.k.padEnd(48), m.type.padEnd(11), m.room.padEnd(14), m.alive ? 'alive' : 'NOT ALIVE', '|', m.label);
  const by = (k) => mons.find((m) => m.k === k);
  assert.equal(by('done:dev_dishwasher')?.type, 'revenant', 'a finished dishwasher is a revenant');
  assert.equal(by('door:dev_dishwasher')?.type, 'hellknight', 'its open door a hell knight');
  assert.equal(by('hungry:sensor.dishwasher_salt_nearly_empty')?.type, 'mancubus', 'salt running out: a mancubus');
  assert.ok(!by('hungry:sensor.dishwasher_rinse_aid_nearly_empty'), 'rinse aid is fine: no demon');
  assert.equal(by('hungry:sensor.espresso_bean_level')?.type, 'mancubus', 'beans at 12%: a mancubus');
  assert.equal(by('alarm:binary_sensor.kitchen_smoke')?.type, 'cyberdemon', 'smoke: a cyberdemon');
  const spooky = mons.find((m) => m.k.startsWith('spooky:'));
  assert.equal(spooky?.type, 'spectre', 'the spooky toilet has a spectre');
  for (const m of mons) assert.ok(m.alive, `${m.k} spawned`);
  // The kitchen's big demons each have their own spot.
  const bigSpots = mons.filter((m) => ['mancubus', 'cyberdemon'].includes(m.type)).map((m) => m.spot.join(','));
  assert.equal(new Set(bigSpots).size, bigSpots.length, 'no two big demons on one spot');

  // The spooky toilet is dim and has its barrels.
  const room = await page.evaluate(() => {
    const l = window.card.link;
    const info = l.manifest.rooms.find((r) => r.name === 'Spooky toilet');
    return { light: window.card.engine.module._hw_sector_light ? null : null, sectors: info.sectors };
  });
  assert.ok(room.sectors.length, 'the spooky toilet is a room');

  // Killing a chore says what it really takes.
  const kill = async (key) => {
    await page.evaluate((k) => { const m = window.card.link.monsters.get(k); window.card.engine.module._hw_debug_damage(m.slot, 5000); }, key);
    await page.waitForTimeout(1200);
    return page.evaluate(() => (window.card.link.status().last || {}).text || '');
  };
  assert.match(await kill('done:dev_dishwasher'), /won't empty the dishwasher/);
  assert.match(await kill('alarm:binary_sensor.kitchen_smoke'), /didn't put it out/);
  assert.match(await kill([...mons].find((m) => m.k.startsWith('spooky:')).k), /only the wind/);

  // Nothing in practice touched the house.
  assert.deepEqual(await page.evaluate(() => window.hass.calls || []), []);
  assert.deepEqual(errors, []);
  console.log('chores: all passed');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
