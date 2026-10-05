// Monster rules end to end through the card harness, in real and practice mode.
const { chromium } = require('playwright');
const assert = require('assert');
const SP = process.env.SP || '/tmp';
async function run(mode, query = '') {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 860, height: 760 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/housewad\]/.test(m.text())) errors.push(m.text()); });
  await page.goto('http://127.0.0.1:18765/tools/harness/card.html' + query);
  await page.waitForFunction(() => window.booted);
  await page.evaluate((m) => window.card.shadowRoot.querySelector('button.' + m).click(), mode);
  await page.waitForFunction(() => window.card.link && window.card.link.ready, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  const mon = () => page.evaluate(() => Object.fromEntries([...window.card.link.monsters].map(([k, m]) => [k, { slot: m.slot, state: window.card.engine.module._hw_slot_state(m.slot), dormant: m.dormant }])));
  const hit = (key, dmg) => page.evaluate(([k, d]) => window.card.engine.module._hw_debug_damage(window.card.link.monsters.get(k).slot, d), [key, dmg]);
  const calls = () => page.evaluate(() => window.hass.calls.map((c) => `${c.domain}.${c.service} ${c.data.entity_id}`));
  const state = (id) => page.evaluate((i) => window.card.actions.state(i).state, id);
  return { browser, page, mon, hit, calls, state, errors };
}
(async () => {
  // Real mode.
  let t = await run('real');
  let m = await t.mon();
  assert.deepStrictEqual(Object.keys(m).sort(), ['caco:binary_sensor.bedroom_window', 'fly:test_fly', 'soul:light.desk', 'soul:light.kitchen_ceiling', 'vac:vacuum.roborock', 'zombie:switch.tv_plug']);
  // The fly walks where its heading points.
  const flyPos = () => t.page.evaluate(() => { const l = window.card.link; const o = l.out; l.m._hw_slot_pos(l.monsters.get('fly:test_fly').slot, o); return [l.m.HEAP32[o >> 2], l.m.HEAP32[(o >> 2) + 1]]; });
  const p0 = await flyPos();
  await t.page.waitForTimeout(2500);
  const p1 = await flyPos();
  console.log('fly moved', p0, '->', p1);
  assert.ok(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 16, 'the fly walks');
  // Shooting it looms the real fly; it escapes.
  await t.hit('fly:test_fly', 20);
  await t.page.waitForTimeout(800);
  assert.ok((await t.calls()).includes('fly_house.loom sensor.test_fly_mode'), 'loomed');
  assert.strictEqual(await t.state('sensor.test_fly_mode'), 'escape');
  assert.ok(m['vac:vacuum.roborock'].dormant, 'docked vacuum sleeps');
  await t.hit('soul:light.desk', 1000);
  await t.hit('zombie:switch.tv_plug', 1000);
  await t.hit('vac:vacuum.roborock', 1);          // wake it: starts cleaning
  await t.page.waitForTimeout(600);
  assert.strictEqual(await t.state('vacuum.roborock'), 'cleaning');
  await t.hit('vac:vacuum.roborock', 1000);       // kill it: sends it home
  await t.page.waitForTimeout(1200);
  let c = await t.calls();
  console.log('real calls', c);
  for (const want of ['light.turn_off light.desk', 'switch.turn_off switch.tv_plug', 'vacuum.start vacuum.roborock', 'vacuum.return_to_base vacuum.roborock'])
    assert.ok(c.includes(want), 'missing ' + want);
  m = await t.mon();
  assert.ok(!m['soul:light.desk'] || m['soul:light.desk'].state !== 1, 'soul gone once the light is off');
  assert.ok(!m['zombie:switch.tv_plug'] || m['zombie:switch.tv_plug'].state !== 1, 'zombie gone once the plug is off');
  // Vacuum docks after 3 s: a fresh sleeping demon comes back.
  await t.page.waitForTimeout(9000);
  m = await t.mon();
  assert.ok(m['vac:vacuum.roborock'] && m['vac:vacuum.roborock'].state === 1 && m['vac:vacuum.roborock'].dormant, 'vacuum demon back asleep');
  // Motion in the kitchen: an imp turns up; and the kitchen soul goes (occupied).
  await t.page.evaluate(() => window.hass.set('binary_sensor.kitchen_motion', 'on'));
  await t.page.waitForTimeout(1200);
  m = await t.mon();
  assert.ok(m['imp:kitchen'] && m['imp:kitchen'].state === 1, 'imp for motion');
  assert.ok(!m['soul:light.kitchen_ceiling'], 'no wasted-light soul while someone is there');
  // Closing the window removes the cacodemon.
  await t.page.evaluate(() => window.hass.set('binary_sensor.bedroom_window', 'off'));
  await t.page.waitForTimeout(1200);
  m = await t.mon();
  assert.ok(!m['caco:binary_sensor.bedroom_window'], 'caco gone with the window shut');
  // Tagged keys lie in the room Bluetooth says; picking them up tells you where.
  let keys = await t.page.evaluate(() => { const l = window.card.link; const it = l.items.get('tag:sensor.car_keys_area'); if (!it) return null; l.m._hw_slot_pos(it.slot, l.out); return { room: it.room, x: l.m.HEAP32[l.out >> 2], y: l.m.HEAP32[(l.out >> 2) + 1] }; });
  assert.ok(keys && keys.room === 'kitchen', 'keys in the kitchen');
  await t.page.evaluate(([x, y]) => window.card.engine.module._hw_teleport(x - 48, y, 0), [keys.x, keys.y]);
  await t.page.evaluate(() => window.card.shadowRoot.querySelector('.screen').focus());
  await t.page.keyboard.down('KeyW'); await t.page.waitForTimeout(500); await t.page.keyboard.up('KeyW');
  await t.page.waitForTimeout(300);
  const found = await t.page.evaluate(() => window.card.link.last && window.card.link.last.text);
  console.log('pickup:', found);
  assert.match(found, /Found: Car Keys\. It's in the Kitchen/);
  await t.page.evaluate(() => window.hass.set('sensor.car_keys_area', 'Bedroom'));
  await t.page.waitForTimeout(1300);
  keys = await t.page.evaluate(() => { const it = window.card.link.items.get('tag:sensor.car_keys_area'); return it && it.present ? it.room : null; });
  assert.strictEqual(keys, 'bedroom', 'keys moved rooms with the tag');
  // The vacuum, cleaning, is in whichever room it reports.
  await t.page.evaluate(() => { window.hass.set('vacuum.roborock', 'cleaning'); window.hass.set('sensor.roborock_current_room', 'Kitchen'); });
  await t.page.waitForTimeout(1500);
  const vacRoom = await t.page.evaluate(() => window.card.link.monsters.get('vac:vacuum.roborock')?.spec.room);
  assert.strictEqual(vacRoom, 'kitchen', 'vacuum demon follows the room sensor');
  // The outside world: GitHub goes down, a baron turns up; back up, it goes.
  await t.page.evaluate(() => window.hass.set('switch.github_is_up', 'off'));
  await t.page.waitForTimeout(1300);
  m = await t.mon();
  assert.ok(m['down:switch.github_is_up'] && m['down:switch.github_is_up'].state === 1, 'baron for the outage');
  assert.match(await t.page.evaluate(() => window.card.link.last.text), /GitHub is down/);
  await t.page.evaluate(() => window.hass.set('switch.github_is_up', 'on'));
  await t.page.waitForTimeout(1300);
  m = await t.mon();
  assert.ok(!m['down:switch.github_is_up'], 'baron gone when GitHub is back');
  // An earthquake shakes the lights; a launch window drops a rocket launcher.
  await t.page.evaluate(() => { window.hass.set('switch.significant_earthquake', 'on'); window.hass.set('switch.orbital_launch_window', 'on'); });
  await t.page.waitForTimeout(1300);
  assert.ok(await t.page.evaluate(() => Date.now() < window.card.link.effects.quakeUntil), 'quaking');
  assert.ok(await t.page.evaluate(() => window.card.link.items.get('world:launcher')?.present), 'rocket launcher by the start');
  await t.page.evaluate(() => window.hass.set('switch.orbital_launch_window', 'off'));
  await t.page.waitForTimeout(1300);
  assert.ok(!(await t.page.evaluate(() => window.card.link.items.has('world:launcher'))), 'launcher gone with the window');
  // The bridge opening flickers the corridor.
  await t.page.evaluate(() => window.hass.set('switch.tower_bridge_open', 'on'));
  await t.page.waitForTimeout(1500);
  assert.ok(await t.page.evaluate(() => window.card.link.effects.flickering), 'corridor flickers');
  console.log('world events ok');
  assert.deepStrictEqual(t.errors, []);
  await t.page.screenshot({ path: SP + '/rules-real.png' });
  await t.browser.close();

  // Practice mode: same actions, nothing reaches Home Assistant.
  t = await run('practice');
  await t.hit('soul:light.desk', 1000);
  await t.page.waitForTimeout(800);
  assert.deepStrictEqual(await t.calls(), [], 'practice never calls the house');
  assert.strictEqual(await t.state('light.desk'), 'off', 'practice plays the change out locally');
  m = await t.mon();
  assert.ok(!m['soul:light.desk'] || m['soul:light.desk'].state !== 1);
  await t.browser.close();

  // Narrow allowlist: the lock is not on it, lights are.
  t = await run('real', '?allow=light.*,lock.*');
  await t.hit('zombie:switch.tv_plug', 1000);
  await t.page.waitForTimeout(500);
  assert.deepStrictEqual(await t.calls(), [], 'switch not allowed, lock.* pattern ignored');
  const warn = await t.page.evaluate(() => window.card.allow.warnings);
  assert.strictEqual(warn.length, 1);
  await t.browser.close();
  console.log('rules: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
