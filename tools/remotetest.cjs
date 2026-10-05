// Smoke test the card on a remote HA (through a tunnel) with an access token:
// node tools/remotetest.cjs <base url> <token file> <light to shoot>
const { chromium } = require('playwright');
const fs = require('fs');
const SP = process.env.SP || '/tmp';
(async () => {
  const [base, tokFile, lightId] = process.argv.slice(2);
  const tok = fs.readFileSync(tokFile, 'utf8').trim();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/housewad|Uncaught/i.test(m.text())) console.log('console:', m.text().slice(0, 200)); });
  await page.addInitScript(([t, b]) => {
    localStorage.setItem('hassTokens', JSON.stringify({ access_token: t, token_type: 'Bearer', expires_in: 1800, hassUrl: b, clientId: b + '/', expires: Date.now() + 1700e3, refresh_token: '' }));
  }, [tok, base]);
  await page.goto(base + '/house-wad/doom');
  const card = page.locator('housewad-card');
  await card.waitFor({ timeout: 40000 });
  await page.waitForTimeout(2000);
  console.log('start:', await card.evaluate((el) => el.shadowRoot.querySelector('.sub').textContent));
  await page.screenshot({ path: SP + '/remote-start.png' });
  await card.evaluate((el) => el.shadowRoot.querySelector('button.real').click());
  await page.waitForFunction(() => {
    const find = (root) => { for (const el of root.querySelectorAll('*')) { if (el.tagName === 'HOUSEWAD-CARD') return el; if (el.shadowRoot) { const f = find(el.shadowRoot); if (f) return f; } } return null; };
    const c = find(document); window.__card = c; return c && c.link && c.link.ready;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const l = window.__card.link;
    return { rooms: l.house.rooms.map((r) => `${r.name}: ${r.lights.map((x) => x.entity_id)} | ${r.switches.map((x) => x.entity_id)} | presence ${r.presence.length}`),
      lamps: l.manifest.lamps, boxes: Object.fromEntries(l.manifest.rooms.map((r) => [r.id, r.bbox])), monsters: [...l.monsters.keys()] };
  });
  console.log('rooms:\n ' + info.rooms.join('\n '));
  console.log('monsters:', info.monsters.join(', ') || 'none');
  await page.screenshot({ path: SP + '/remote-running.png' });
  const lamp = info.lamps.find((l) => l.entity === lightId);
  if (lamp) {
    const st = () => page.evaluate((i) => window.__card.hass.states[i].state, lightId);
    if ((await st()) !== 'on') { await page.evaluate((i) => window.__card.hass.callService('light', 'turn_on', { entity_id: i }), lightId); await page.waitForTimeout(2000); }
    const b = info.boxes[lamp.room];
    const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2, d = Math.hypot(lamp.x - cx, lamp.y - cy) || 1;
    const px = Math.round(lamp.x + ((cx - lamp.x) * 100) / d), py = Math.round(lamp.y + ((cy - lamp.y) * 100) / d);
    await page.evaluate(([x, y, a]) => window.__card.engine.module._hw_teleport(x, y, a), [px, py, Math.round((Math.atan2(lamp.y - py, lamp.x - px) * 180) / Math.PI + 360) % 360]);
    await page.evaluate(() => window.__card.shadowRoot.querySelector('.screen').focus());
    await page.waitForTimeout(400);
    console.log(lightId, 'before:', await st());
    await page.screenshot({ path: SP + '/remote-lamp-before.png' });
    await page.keyboard.down('ControlLeft'); await page.waitForTimeout(120); await page.keyboard.up('ControlLeft');
    await page.waitForTimeout(2500);
    console.log(lightId, 'after shot:', await st());
    await page.screenshot({ path: SP + '/remote-lamp-after.png' });
  }
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
