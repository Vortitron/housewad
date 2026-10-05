// Record the promo clip on a remote HA: node tools/record.cjs <base> <token file> <out dir>
// Plays a scripted run on the house-wad/clip view (game left, live tiles
// right) with big captions, for viewers watching muted.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const [base, tokFile, outDir] = process.argv.slice(2);
  const tok = fs.readFileSync(tokFile, 'utf8').trim();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: outDir, size: { width: 1280, height: 720 } } });
  await ctx.addInitScript(([t, b]) => {
    localStorage.setItem('hassTokens', JSON.stringify({ access_token: t, token_type: 'Bearer', expires_in: 1800, hassUrl: b, clientId: b + '/', expires: Date.now() + 1700e3, refresh_token: '' }));
    localStorage.setItem('dockedSidebar', '"always_hidden"');
  }, [tok, base]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(base + '/house-wad/clip');
  const card = page.locator('housewad-card');
  await card.waitFor({ timeout: 60000 });
  await page.waitForTimeout(2000);

  // Caption overlay, outside Home Assistant's DOM.
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.id = 'cap';
    el.style.cssText = 'position:fixed;left:0;right:0;bottom:28px;z-index:99999;display:flex;justify-content:center;pointer-events:none;transition:opacity .25s';
    el.innerHTML = '<span style="max-width:1100px;background:rgba(0,0,0,.82);color:#fff;font:800 34px/1.25 system-ui,Segoe UI,Roboto,sans-serif;padding:14px 26px;border-radius:14px;text-align:center;box-shadow:0 6px 30px #0008"></span>';
    document.body.appendChild(el);
    const end = document.createElement('div');
    end.id = 'end';
    end.style.cssText = 'position:fixed;inset:0;z-index:100000;display:none;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:radial-gradient(circle at 50% 40%,#3a0a05,#0b0000 75%);color:#f2d7a6;font-family:ui-monospace,Menlo,Consolas,monospace;text-align:center';
    end.innerHTML = '<div style="font:900 96px ui-monospace,monospace;color:#ff3b1f;text-shadow:0 5px 0 #5a0000,0 0 40px #ff3b1f66">HOUSE.WAD</div><div style="font-size:34px">Your Home Assistant, as a Doom level</div><div style="font-size:28px;opacity:.9">Free on HACS · github.com/Vortitron/housewad</div><div style="font-size:22px;opacity:.6">Simulated demo house. Made by Vome</div>';
    document.body.appendChild(end);
  });
  const caption = (text) => page.evaluate((t) => {
    const el = document.getElementById('cap');
    el.style.opacity = t ? '1' : '0';
    if (t) el.firstChild.textContent = t;
  }, text);

  // Start every take from the same house: lights on, door locked, window open.
  await card.evaluate(async (el) => {
    const s = el.hass.states;
    const lights = Object.keys(s).filter((e) => e.startsWith('light.'));
    await el.hass.callService('light', 'turn_on', { entity_id: lights, brightness_pct: 80 });
    if (s['lock.front_door'] && s['lock.front_door'].state !== 'locked') await el.hass.callService('lock', 'lock', { entity_id: 'lock.front_door' });
  });
  await page.waitForTimeout(1500);
  await caption('My Home Assistant, as a Doom level');
  await page.waitForTimeout(2200);
  await card.evaluate((el) => el.shadowRoot.querySelector('button.real').click());
  await page.waitForFunction(() => {
    const find = (root) => { for (const el of root.querySelectorAll('*')) { if (el.tagName === 'HOUSEWAD-CARD') return el; if (el.shadowRoot) { const f = find(el.shadowRoot); if (f) return f; } } return null; };
    const c = find(document); window.__card = c; return c && c.link && c.link.ready;
  }, null, { timeout: 90000 });
  await page.evaluate(() => window.__card.shadowRoot.querySelector('.screen').focus());
  const info = await page.evaluate(() => {
    const l = window.__card.link;
    return { lamps: l.manifest.lamps, boxes: Object.fromEntries(l.manifest.rooms.map((r) => [r.id, r.bbox])), doors: l.manifest.doors, cams: l.manifest.cameras, start: l.manifest.start };
  });
  const tp = (x, y, a) => page.evaluate(([x, y, a]) => window.__card.engine.module._hw_teleport(Math.round(x), Math.round(y), Math.round(a)), [x, y, a]);
  const press = async (code, ms = 130) => { await page.keyboard.down(code); await page.waitForTimeout(ms); await page.keyboard.up(code); };
  const slotPos = (key) => page.evaluate((k) => { const l = window.__card.link; const m = l.monsters.get(k); if (!m || !l.m._hw_slot_pos(m.slot, l.out)) return null; return [l.m.HEAP32[l.out >> 2], l.m.HEAP32[(l.out >> 2) + 1]]; }, key);
  const face = (from, to) => (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
  // Stand `dist` from a point, on the room-centre side, facing it.
  const approach = async (pt, roomId, dist) => {
    const b = info.boxes[roomId];
    const c = [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2];
    const d = Math.hypot(pt[0] - c[0], pt[1] - c[1]) || 1;
    const p = [pt[0] + ((c[0] - pt[0]) * dist) / d, pt[1] + ((c[1] - pt[1]) * dist) / d];
    await tp(p[0], p[1], (face(p, pt) + 360) % 360);
  };

  // Every weapon, quietly, then the shotgun.
  await page.keyboard.type('idkfa', { delay: 30 });
  await page.waitForTimeout(300);
  await press('Digit3');

  // 1. The lamp.
  const lamp = info.lamps.find((l) => l.entity === 'light.living_room');
  await approach([lamp.x, lamp.y], lamp.room, 190);
  await caption('Shoot the lamp…');
  await page.waitForTimeout(900);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(250); await page.keyboard.up('KeyW');
  await press('ControlLeft');
  await page.waitForTimeout(700);
  await caption('…and the real light goes off');
  await page.waitForTimeout(2300);
  await page.screenshot({ path: path.join(outDir, 'still-lamp.png') });

  // 2. The fly.
  const fly = await slotPos('fly:housefly');
  if (fly) {
    // Flies stand mid-room, so come at one from the side with more room.
    const flyRoom = await page.evaluate(() => window.__card.link.monsters.get('fly:housefly').spec.room);
    const fb = info.boxes[flyRoom];
    // The Meddler fly switches lights; make sure this room is lit for the shot.
    await page.evaluate((room) => {
      const r = window.__card.link.house.rooms.find((x) => x.id === room);
      if (r && r.lights.length) window.__card.hass.callService('light', 'turn_on', { entity_id: r.lights.map((l) => l.entity_id) });
    }, flyRoom);
    await page.waitForTimeout(600);
    const side = fly[0] - fb.x1 > fb.x2 - fly[0] ? -1 : 1;
    const from = [Math.max(fb.x1 + 40, Math.min(fb.x2 - 40, fly[0] + side * 230)), fly[1]];
    await tp(from[0], from[1], side < 0 ? 0 : 180);
    await caption('That spider is a real fruit-fly brain. 4,724 neurons');
    await page.waitForTimeout(1600);
    await press('ControlLeft');
    await page.waitForTimeout(500);
    await caption('Shoot it and its escape neurons fire');
    await page.waitForTimeout(2600);
  }

  // 3. The front door.
  const door = info.doors.find((d) => d.lock === 'lock.front_door');
  const dir = Math.sign(door.y);
  await tp(door.x, door.y - dir * 70, dir > 0 ? 90 : 270);
  await caption('The front door asks first');
  await page.waitForTimeout(900);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(220); await page.keyboard.up('KeyW');
  await press('KeyE');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(outDir, 'still-door.png') });
  await press('KeyY');
  await caption('Y: it really unlocks');
  await page.waitForTimeout(3000);

  // 4. The vacuum, with the chainsaw.
  await press('Digit1');
  const vac = await slotPos('vac:vacuum.robot_vacuum');
  if (vac) {
    const vacRoom = await page.evaluate(() => window.__card.link.monsters.get('vac:vacuum.robot_vacuum').spec.room);
    await approach(vac, vacRoom, 70);
    await caption('The robot vacuum is a demon, asleep on its dock');
    await page.waitForTimeout(1500);
    await page.keyboard.down('ControlLeft');
    await page.waitForTimeout(600);
    await caption('Wake it: it starts cleaning. Kill it: it goes home');
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(300);
      const p = await slotPos('vac:vacuum.robot_vacuum');
      const alive = await page.evaluate(() => { const m = window.__card.link.monsters.get('vac:vacuum.robot_vacuum'); return m && window.__card.engine.module._hw_slot_state(m.slot) === 1; });
      if (!alive) break;
      if (p) {
        const me = await page.evaluate(() => window.__card.link.player());
        if (Math.hypot(p[0] - me.x, p[1] - me.y) > 100) {
          // It moved rooms with the real vacuum: follow it there.
          const r = await page.evaluate(() => window.__card.link.monsters.get('vac:vacuum.robot_vacuum').spec.room);
          await approach(p, r, 70);
        } else {
          await tp(me.x, me.y, (face([me.x, me.y], p) + 360) % 360);
        }
      }
    }
    await page.keyboard.up('ControlLeft');
    await page.waitForTimeout(2200);
  }

  // 5. The camera.
  const cam = info.cams.find((c) => c.entity === 'camera.garden');
  if (cam) {
    await approach([cam.x, cam.y], cam.room, 170);
    await caption('Your cameras are screens on the walls');
    await page.waitForTimeout(3200);
    await page.screenshot({ path: path.join(outDir, 'still-camera.png') });
  }

  // 6. The way out.
  await tp(info.start.x - 32, 40, 90);
  await caption('Exit switch: what you fixed, on the tally screen');
  await page.waitForTimeout(900);
  await press('KeyE');
  await page.waitForTimeout(3600);
  await caption('');
  await page.evaluate(() => { document.getElementById('end').style.display = 'flex'; });
  await page.waitForTimeout(3200);

  const video = page.video();
  await ctx.close();
  console.log('video', await video.path());
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
