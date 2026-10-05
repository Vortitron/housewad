// Status line, cheats and the exit, in practice mode on the harness.
const { chromium } = require('playwright');
const assert = require('assert');
const SP = process.env.SP || '/tmp';
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 860, height: 820 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:18765/tools/harness/card.html');
  await page.waitForFunction(() => window.booted);
  await page.evaluate(() => window.card.shadowRoot.querySelector('button.practice').click());
  await page.waitForFunction(() => window.card.link && window.card.link.ready, null, { timeout: 30000 });
  const status = () => page.evaluate(() => Object.fromEntries(['where', 'aim', 'last'].map((c) => [c, window.card.shadowRoot.querySelector('.status .' + c).textContent])));
  const tp = (x, y, a) => page.evaluate(([x, y, a]) => window.card.engine.module._hw_teleport(x, y, a), [x, y, a]);
  const press = async (code, ms = 120) => { await page.keyboard.down(code); await page.waitForTimeout(ms); await page.keyboard.up(code); };
  const st = (id) => page.evaluate((i) => window.card.actions.state(i).state, id);
  await page.evaluate(() => window.card.shadowRoot.querySelector('.screen').focus());

  // Aim at the floor lamp.
  const { lamp, box } = await page.evaluate(() => { const l = window.card.link; const lamp = l.manifest.lamps.find((x) => x.entity === 'light.floor_lamp'); return { lamp, box: l.manifest.rooms.find((r) => r.id === lamp.room).bbox }; });
  const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2, d = Math.hypot(lamp.x - cx, lamp.y - cy);
  const px = Math.round(lamp.x + ((cx - lamp.x) * 110) / d), py = Math.round(lamp.y + ((cy - lamp.y) * 110) / d);
  await tp(px, py, Math.round((Math.atan2(lamp.y - py, lamp.x - px) * 180) / Math.PI + 360) % 360);
  await page.waitForTimeout(600);
  let s = await status();
  console.log('aiming:', s);
  assert.strictEqual(s.where, 'Living Room');
  assert.match(s.aim, /Floor Lamp \(on, 71%\)/);
  await press('ControlLeft');
  await page.waitForTimeout(700);
  s = await status();
  console.log('after shot:', s);
  assert.match(s.last, /Floor Lamp: off/);
  assert.match(s.aim, /Floor Lamp \(off\)/);
  await page.screenshot({ path: SP + '/status-shot.png' });

  // Cheats.
  await page.keyboard.type('idbeholdl', { delay: 40 });
  await page.waitForTimeout(1500);
  s = await status();
  console.log('idbeholdl:', s.last);
  // Every light on: empty rooms promptly grow lost souls, which is the point.
  assert.strictEqual(await st('light.kitchen_island'), 'on');
  await page.keyboard.type('idcoffee', { delay: 40 });
  await page.waitForTimeout(800);
  assert.strictEqual(await st('switch.kettle'), 'on', 'custom cheat toggled the kettle');

  // The exit.
  const start = await page.evaluate(() => window.card.link.manifest.start);
  await tp(start.x - 32, 40, 90);
  await page.waitForTimeout(500);
  s = await status();
  console.log('at the exit:', s.aim);
  assert.strictEqual(s.aim, 'Exit: leave the house');
  const towel = await st('switch.towel_rail');
  await press('KeyE');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: SP + '/status-tally.png' });
  s = await status();
  console.log('after exit:', s.last);
  assert.match(s.last, /You left the house: .*1 light switched off/);
  assert.notStrictEqual(await st('switch.towel_rail'), towel, 'exit scene ran');
  // Past the tally screen, the house loads again.
  await page.evaluate(() => { window.card.link.ready = false; });
  for (let i = 0; i < 6; i++) { await press('ControlLeft', 80); await page.waitForTimeout(700); }
  await page.waitForFunction(() => window.card.link.ready, null, { timeout: 15000 });
  console.log('next day: level reloaded');
  assert.deepStrictEqual(errors, []);
  console.log('status: all passed');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
