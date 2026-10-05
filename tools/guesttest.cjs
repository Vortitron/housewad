// Play as a guest (non-admin) through a guest login URL read from a file.
// node tools/guesttest.cjs <url file>
const { chromium } = require('playwright');
const fs = require('fs');
const SP = process.env.SP || '/tmp';
(async () => {
  const url = fs.readFileSync(process.argv[2], 'utf8').trim();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/housewad|error/i.test(m.text())) console.log('console:', m.text().slice(0, 160)); });
  await page.goto(url);
  const card = page.locator('housewad-card');
  await card.waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
  console.log('landed on', new URL(page.url()).pathname);
  const who = await card.evaluate((el) => ({ user: el.hass.user.name, admin: el.hass.user.is_admin,
    entities: Object.keys(el.hass.entities || {}).length, devices: Object.keys(el.hass.devices || {}).length,
    areas: Object.keys(el.hass.areas || {}).length, floors: el.hass.floors ? Object.keys(el.hass.floors).length : 'none' }));
  console.log('as', JSON.stringify(who));
  const panels = await page.evaluate(() => Object.keys(document.querySelector('home-assistant').hass.panels));
  console.log('house-wad in panels:', panels.includes('house-wad'));
  console.log('start:', await card.evaluate((el) => el.shadowRoot.querySelector('.sub').textContent));
  await page.screenshot({ path: SP + '/guest-start.png' });
  await card.evaluate((el) => el.shadowRoot.querySelector('button.real').click());
  await page.waitForFunction(() => {
    const find = (root) => { for (const el of root.querySelectorAll('*')) { if (el.tagName === 'HOUSEWAD-CARD') return el; if (el.shadowRoot) { const f = find(el.shadowRoot); if (f) return f; } } return null; };
    const c = find(document); window.__card = c; return c && c.link && c.link.ready;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  const ha = (id) => page.evaluate((i) => window.__card.hass.states[i].state, id);
  const info = await page.evaluate(() => { const l = window.__card.link; return { lamps: l.manifest.lamps, boxes: Object.fromEntries(l.manifest.rooms.map((r) => [r.id, r.bbox])), doors: l.manifest.doors, monsters: [...l.monsters.keys()], rooms: l.house.rooms.map((r) => r.name) }; });
  console.log('rooms:', info.rooms.join(', '));
  console.log('monsters:', info.monsters.join(', '));
  const tp = (x, y, a) => page.evaluate(([x, y, a]) => window.__card.engine.module._hw_teleport(x, y, a), [x, y, a]);
  const press = async (code, ms = 140) => { await page.keyboard.down(code); await page.waitForTimeout(ms); await page.keyboard.up(code); };
  await page.evaluate(() => window.__card.shadowRoot.querySelector('.screen').focus());

  // Shoot the living room lamp.
  const lamp = info.lamps.find((l) => l.entity === 'light.living_room');
  if ((await ha('light.living_room')) !== 'on') { await page.evaluate(() => window.__card.hass.callService('light', 'turn_on', { entity_id: 'light.living_room' })); await page.waitForTimeout(1500); }
  const b = info.boxes[lamp.room], cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2, d = Math.hypot(lamp.x - cx, lamp.y - cy) || 1;
  const px = Math.round(lamp.x + ((cx - lamp.x) * 100) / d), py = Math.round(lamp.y + ((cy - lamp.y) * 100) / d);
  await tp(px, py, Math.round((Math.atan2(lamp.y - py, lamp.x - px) * 180) / Math.PI + 360) % 360);
  await page.waitForTimeout(400);
  await press('ControlLeft');
  await page.waitForTimeout(2000);
  console.log('lamp shot by guest -> light.living_room', await ha('light.living_room'));
  await page.evaluate(() => window.__card.hass.callService('light', 'turn_on', { entity_id: 'light.living_room' }));

  // Loom a fly.
  const before = await ha('sensor.the_meddler_mode');
  await page.evaluate(() => { const m = window.__card.link.monsters.get('fly:the_meddler'); if (m) window.__card.engine.module._hw_debug_damage(m.slot, 20); });
  let after = before;
  for (let i = 0; i < 16 && after !== 'escape'; i++) { await page.waitForTimeout(500); after = await ha('sensor.the_meddler_mode'); }
  console.log('fly loomed by guest:', before, '->', after);

  // Front door with Y, then lock it again.
  const door = info.doors.find((x) => x.lock === 'lock.front_door');
  const dir = Math.sign(door.y);
  await tp(door.x, door.y - dir * 36, dir > 0 ? 90 : 270);
  await page.waitForTimeout(400);
  await press('KeyE'); await page.waitForTimeout(600); await press('KeyY'); await page.waitForTimeout(3500);
  console.log('front door by guest:', await ha('lock.front_door'));
  await page.screenshot({ path: SP + '/guest-door.png' });
  await page.evaluate(() => window.__card.hass.callService('lock', 'lock', { entity_id: 'lock.front_door' }));
  await page.waitForTimeout(800);
  console.log('relocked:', await ha('lock.front_door'));
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
