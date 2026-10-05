// Drive the card harness: start for real, shoot a lamp, use a switch, open
// the front door, check what reached "Home Assistant".
const { chromium } = require('playwright');
const SP = process.env.SP || '/tmp';
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 860, height: 760 } });
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto('http://127.0.0.1:18765/tools/harness/card.html' + (process.argv[2] || ''));
  await page.waitForFunction(() => window.booted);
  await page.screenshot({ path: SP + '/card-start.png' });
  await page.evaluate(() => window.card.shadowRoot.querySelector('button.real').click());
  await page.waitForFunction(() => window.card.link && window.card.link.ready, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: SP + '/card-running.png' });
  const info = await page.evaluate(() => {
    const l = window.card.link;
    return { lamps: l.manifest.lamps, doors: l.manifest.doors, rooms: l.manifest.rooms.map((r) => ({ id: r.id, bbox: r.bbox })),
      monsters: [...l.monsters.entries()].map(([k, m]) => [k, m.slot, window.card.engine.module._hw_slot_state(m.slot)]) };
  });
  console.log('monsters:', JSON.stringify(info.monsters));
  const tp = (x, y, a) => page.evaluate(([x, y, a]) => window.card.engine.module._hw_teleport(x, y, a), [x, y, a]);
  const press = async (code, ms = 150) => { await page.keyboard.down(code); await page.waitForTimeout(ms); await page.keyboard.up(code); };
  await page.evaluate(() => window.card.shadowRoot.querySelector('.screen').focus());

  // 1. Shoot the floor lamp in the living room.
  const lamp = info.lamps.find((l) => l.entity === 'light.floor_lamp');
  const room = info.rooms.find((r) => r.id === lamp.room);
  const cx = (room.bbox.x1 + room.bbox.x2) / 2, cy = (room.bbox.y1 + room.bbox.y2) / 2;
  const d = Math.hypot(lamp.x - cx, lamp.y - cy);
  const px = Math.round(lamp.x + ((cx - lamp.x) * 110) / d), py = Math.round(lamp.y + ((cy - lamp.y) * 110) / d);
  const ang = Math.round((Math.atan2(lamp.y - py, lamp.x - px) * 180) / Math.PI + 360) % 360;
  console.log('teleport to lamp', await tp(px, py, ang), px, py, ang);
  await page.waitForTimeout(300);
  await page.screenshot({ path: SP + '/card-lamp-before.png' });
  await press('ControlLeft', 120);
  await page.waitForTimeout(900);
  await page.screenshot({ path: SP + '/card-lamp-after.png' });

  // 2. Use: turn it back on (after the 1.5 s per-entity rate limit).
  await page.waitForTimeout(1200);
  await press('KeyE');
  await page.waitForTimeout(900);
  await page.screenshot({ path: SP + '/card-lamp-on.png' });

  // 3. Front door: walk up and use it.
  const door = info.doors.find((x) => x.lock === 'lock.front_door');
  const dir = Math.sign(door.y);
  console.log('teleport to door', await tp(door.x, door.y - dir * 36, dir > 0 ? 90 : 270));
  await page.waitForTimeout(300);
  await press('KeyE');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: SP + '/card-door.png' });

  const calls = await page.evaluate(() => window.hass.calls.map((c) => `${c.domain}.${c.service} ${c.data.entity_id}`));
  console.log('calls:', JSON.stringify(calls, null, 1));
  console.log('door state', await page.evaluate((s) => window.card.engine.module._hw_door_state(s), door.sector));
  console.log(logs.filter((l) => /housewad|error/i.test(l)).slice(0, 10).join('\n'));
  await browser.close();
})();
