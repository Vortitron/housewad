// Dry run of the clip on a remote HA in real mode: the props are there, the
// door asks and unlocks, the vacuum wakes and goes home. Puts things back.
// node tools/remoteclip.cjs <base> <token file>
const { chromium } = require('playwright');
const fs = require('fs');
const assert = require('assert');
const SP = process.env.SP || '/tmp';
(async () => {
  const [base, tokFile] = process.argv.slice(2);
  const tok = fs.readFileSync(tokFile, 'utf8').trim();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.addInitScript(([t, b]) => localStorage.setItem('hassTokens', JSON.stringify({ access_token: t, token_type: 'Bearer', expires_in: 1800, hassUrl: b, clientId: b + '/', expires: Date.now() + 1700e3, refresh_token: '' })), [tok, base]);
  await page.goto(base + '/house-wad/clip');
  const card = page.locator('housewad-card');
  await card.waitFor({ timeout: 40000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: SP + '/clip-start.png' });
  await card.evaluate((el) => el.shadowRoot.querySelector('button.real').click());
  await page.waitForFunction(() => {
    const find = (root) => { for (const el of root.querySelectorAll('*')) { if (el.tagName === 'HOUSEWAD-CARD') return el; if (el.shadowRoot) { const f = find(el.shadowRoot); if (f) return f; } } return null; };
    const c = find(document); window.__card = c; return c && c.link && c.link.ready;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const l = window.__card.link;
    return { doors: l.manifest.doors.map((d) => ({ id: d.id, lock: d.lock, cover: d.cover, sensor: d.sensor, x: d.x, y: d.y, sector: d.sector })),
      monsters: [...l.monsters.keys()], items: [...l.items.keys()] };
  });
  console.log('doors:', JSON.stringify(info.doors));
  console.log('monsters:', info.monsters.join(', '));
  console.log('items:', info.items.join(', '));
  const ha = (id) => page.evaluate((i) => window.__card.hass.states[i].state, id);
  const call = (d, s, e) => page.evaluate(([d, s, e]) => window.__card.hass.callService(d, s, { entity_id: e }), [d, s, e]);
  const tp = (x, y, a) => page.evaluate(([x, y, a]) => window.__card.engine.module._hw_teleport(x, y, a), [x, y, a]);
  const press = async (code, ms = 140) => { await page.keyboard.down(code); await page.waitForTimeout(ms); await page.keyboard.up(code); };
  await page.evaluate(() => window.__card.shadowRoot.querySelector('.screen').focus());
  for (const k of ['soul:', 'zombie:switch.tv_plug', 'caco:binary_sensor.bedroom_window', 'vac:vacuum.robot_vacuum'])
    console.log(k, info.monsters.some((m) => m.startsWith(k)) ? 'present' : 'MISSING');

  // Front door: Use, Y, real lock unlocks, Doom door opens.
  const door = info.doors.find((d) => d.lock === 'lock.front_door');
  const dir = Math.sign(door.y);
  await tp(door.x, door.y - dir * 36, dir > 0 ? 90 : 270);
  await page.waitForTimeout(400);
  await press('KeyE');
  await page.waitForTimeout(600);
  await page.screenshot({ path: SP + '/clip-door-ask.png' });
  await press('KeyY');
  await page.waitForTimeout(3500);
  console.log('front door:', await ha('lock.front_door'), 'doom door state', await page.evaluate((s) => window.__card.engine.module._hw_door_state(s), door.sector));
  await page.screenshot({ path: SP + '/clip-door-open.png' });

  // Vacuum: wake it (starts cleaning), then kill it (sent home).
  const hit = (key, dmg) => page.evaluate(([k, d]) => { const m = window.__card.link.monsters.get(k); return m && window.__card.engine.module._hw_debug_damage(m.slot, d); }, [key, dmg]);
  await hit('vac:vacuum.robot_vacuum', 1);
  await page.waitForTimeout(1500);
  console.log('vacuum after wake:', await ha('vacuum.robot_vacuum'));
  await page.waitForTimeout(13000);
  console.log('vacuum room after 13 s:', await ha('sensor.robot_vacuum_current_room'), 'demon in', await page.evaluate(() => window.__card.link.monsters.get('vac:vacuum.robot_vacuum')?.spec.room));
  await hit('vac:vacuum.robot_vacuum', 1000);
  await page.waitForTimeout(1500);
  console.log('vacuum after kill:', await ha('vacuum.robot_vacuum'));
  await page.screenshot({ path: SP + '/clip-sidebar.png' });

  // Put the props back.
  await call('lock', 'lock', 'lock.front_door');
  await page.waitForTimeout(500);
  console.log('reset: lock', await ha('lock.front_door'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
