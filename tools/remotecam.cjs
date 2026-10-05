// Look at each camera screen on a remote HA. node tools/remotecam.cjs <base> <token file>
const { chromium } = require('playwright');
const fs = require('fs');
const SP = process.env.SP || '/tmp';
(async () => {
  const [base, tokFile] = process.argv.slice(2);
  const tok = fs.readFileSync(tokFile, 'utf8').trim();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 860 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.addInitScript(([t, b]) => localStorage.setItem('hassTokens', JSON.stringify({ access_token: t, token_type: 'Bearer', expires_in: 1800, hassUrl: b, clientId: b + '/', expires: Date.now() + 1700e3, refresh_token: '' })), [tok, base]);
  await page.goto(base + '/house-wad/doom');
  const card = page.locator('housewad-card');
  await card.waitFor({ timeout: 40000 });
  await page.waitForTimeout(1500);
  console.log(await card.evaluate((el) => el.shadowRoot.querySelector('.sub').textContent));
  await card.evaluate((el) => el.shadowRoot.querySelector('button.practice').click());
  await page.waitForFunction(() => {
    const find = (root) => { for (const el of root.querySelectorAll('*')) { if (el.tagName === 'HOUSEWAD-CARD') return el; if (el.shadowRoot) { const f = find(el.shadowRoot); if (f) return f; } } return null; };
    const c = find(document); window.__card = c; return c && c.link && c.link.ready;
  }, null, { timeout: 90000 });
  const info = await page.evaluate(() => {
    const l = window.__card.link;
    return { cams: l.manifest.cameras, rooms: Object.fromEntries(l.manifest.rooms.map((r) => [r.id, r.bbox])), names: l.house.rooms.map((r) => r.name), monsters: [...l.monsters.keys()] };
  });
  console.log('rooms:', info.names.join(', '), '\nmonsters:', info.monsters.join(', '));
  for (const [i, cam] of info.cams.entries()) {
    const b = info.rooms[cam.room];
    const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2, d = Math.hypot(cam.x - cx, cam.y - cy) || 1;
    const px = Math.round(cam.x + ((cx - cam.x) * 150) / d), py = Math.round(cam.y + ((cy - cam.y) * 150) / d);
    await page.evaluate(([x, y, a]) => window.__card.engine.module._hw_teleport(x, y, a), [px, py, Math.round((Math.atan2(cam.y - py, cam.x - px) * 180) / Math.PI + 360) % 360]);
    await page.waitForTimeout(3500);
    const painted = await page.evaluate((k) => window.__card.link.cams[k].last, i);
    console.log(cam.entity, cam.room, 'fetched', painted > 0);
    await page.screenshot({ path: `${SP}/cam-${cam.entity.replace('.', '_')}.png` });
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
