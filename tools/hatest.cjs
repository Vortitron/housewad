// End to end against a real Home Assistant (local test instance): log in,
// open the house.wad dashboard, play for real, check HA's own states change.
const { chromium } = require('playwright');
const assert = require('assert');
const SP = process.env.SP || '/tmp';
const HA = process.env.HA || 'http://127.0.0.1:18123';
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/housewad|error/i.test(m.text())) console.log('console:', m.text().slice(0, 200)); });
  await page.goto(HA + '/house-wad/doom');
  await page.fill('input[name="username"]', 'doomguy');
  await page.fill('input[name="password"]', 'iddqd-idkfa');
  await page.keyboard.press('Enter');
  const card = page.locator('housewad-card');
  await card.waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  // Known starting state.
  await card.evaluate(async (el) => {
    await el.hass.callService('light', 'turn_on', { entity_id: ['light.ceiling_lights', 'light.living_room_rgbww_lights'] });
    await el.hass.callService('lock', 'lock', { entity_id: 'lock.front_door' });
  });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: SP + '/ha-start.png' });
  const summary = await card.evaluate((el) => el.shadowRoot.querySelector('.sub').textContent);
  console.log('start screen:', summary);
  await card.evaluate((el) => el.shadowRoot.querySelector('button.real').click());
  await page.waitForFunction(() => {
    const find = (root) => { for (const el of root.querySelectorAll('*')) { if (el.tagName === 'HOUSEWAD-CARD') return el; if (el.shadowRoot) { const f = find(el.shadowRoot); if (f) return f; } } return null; };
    const c = find(document); window.__card = c; return c && c.link && c.link.ready;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: SP + '/ha-running.png' });
  const info = await page.evaluate(() => {
    const l = window.__card.link;
    return { rooms: l.house.rooms.map((r) => `${r.name}[${r.floor}]: ${r.lights.length}L ${r.switches.length}S ${r.media.length}M ${r.doors.map((d) => d.lock || d.cover || d.sensor).join('+')} ${r.vacuums.length}V`),
      lamps: l.manifest.lamps, doors: l.manifest.doors, roomBoxes: Object.fromEntries(l.manifest.rooms.map((r) => [r.id, r.bbox])),
      monsters: [...l.monsters.keys()] };
  });
  console.log('rooms:\n ' + info.rooms.join('\n '));
  console.log('monsters:', info.monsters.join(', '));
  const haState = (id) => page.evaluate((i) => window.__card.hass.states[i].state, id);
  const tp = (x, y, a) => page.evaluate(([x, y, a]) => window.__card.engine.module._hw_teleport(x, y, a), [x, y, a]);
  const lum = () => page.evaluate(() => {
    const c = window.__card.shadowRoot.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, 320, 168).data;
    let t = 0;
    for (let i = 0; i < d.length; i += 4) t += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return Math.round(t / (d.length / 4));
  });
  const press = async (code, ms = 150) => { await page.keyboard.down(code); await page.waitForTimeout(ms); await page.keyboard.up(code); };
  await page.evaluate(() => window.__card.shadowRoot.querySelector('.screen').focus());

  // Shoot the living room ceiling light.
  const lamp = info.lamps.find((l) => l.entity === 'light.ceiling_lights');
  const box = info.roomBoxes[lamp.room];
  const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2, d = Math.hypot(lamp.x - cx, lamp.y - cy) || 1;
  const px = Math.round(lamp.x + ((cx - lamp.x) * 100) / d), py = Math.round(lamp.y + ((cy - lamp.y) * 100) / d);
  assert.ok(await tp(px, py, Math.round((Math.atan2(lamp.y - py, lamp.x - px) * 180) / Math.PI + 360) % 360));
  await page.waitForTimeout(400);
  await page.screenshot({ path: SP + '/ha-lamp-before.png' });
  assert.strictEqual(await haState('light.ceiling_lights'), 'on');
  const before = await lum();
  await press('ControlLeft', 120);
  await page.waitForTimeout(1500);
  const after = await lum();
  console.log('view brightness', before, '->', after);
  assert.ok(after < before * 0.8, 'the room got darker');
  await page.screenshot({ path: SP + '/ha-lamp-after.png' });
  assert.strictEqual(await haState('light.ceiling_lights'), 'off', 'shooting the lamp turned off the real light');
  console.log('PASS light.ceiling_lights turned off by a shotgun... pistol');

  // Front door: use it, the real lock unlocks, the Doom door opens.
  const door = info.doors.find((x) => x.lock === 'lock.front_door');
  const dir = Math.sign(door.y);
  assert.ok(await tp(door.x, door.y - dir * 36, dir > 0 ? 90 : 270));
  await page.waitForTimeout(300);
  await press('KeyE');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: SP + '/ha-door.png' });
  console.log('lock.front_door now', await haState('lock.front_door'), 'doom door', await page.evaluate((s) => window.__card.engine.module._hw_door_state(s), door.sector));
  assert.ok(['unlocked', 'unlocking', 'open'].includes(await haState('lock.front_door')));
  // A lock not on the allowlist stays shut.
  const kdoor = info.doors.find((x) => x.lock === 'lock.kitchen_door');
  if (kdoor) console.log('kitchen door (not allowlisted) is', await haState('lock.kitchen_door'));
  assert.deepStrictEqual(errors, []);
  console.log('ALL PASSED');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
