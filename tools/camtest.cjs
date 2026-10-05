// A camera in the living room shows up as a screen with its picture on it.
const { chromium } = require('playwright');
const assert = require('assert');
const SP = process.env.SP || '/tmp';
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 860, height: 760 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:18765/tools/harness/card.html');
  await page.waitForFunction(() => window.booted);
  await page.evaluate(() => window.card.shadowRoot.querySelector('button.practice').click());
  await page.waitForFunction(() => window.card.link && window.card.link.ready, null, { timeout: 30000 });
  const cam = await page.evaluate(() => window.card.link.manifest.cameras[0]);
  const room = await page.evaluate((id) => window.card.link.manifest.rooms.find((r) => r.id === id).bbox, cam.room);
  console.log('camera screen', cam);
  const cx = (room.x1 + room.x2) / 2, cy = (room.y1 + room.y2) / 2, d = Math.hypot(cam.x - cx, cam.y - cy);
  const px = Math.round(cam.x + ((cx - cam.x) * 160) / d), py = Math.round(cam.y + ((cy - cam.y) * 160) / d);
  const ang = Math.round((Math.atan2(cam.y - py, cam.x - px) * 180) / Math.PI + 360) % 360;
  await page.evaluate(([x, y, a]) => window.card.engine.module._hw_teleport(x, y, a), [px, py, ang]);
  await page.waitForTimeout(2500);
  const painted = await page.evaluate(() => window.card.link.cams[0].last > 0);
  assert.ok(painted, 'the camera picture was fetched');
  await page.screenshot({ path: SP + '/camera-wall.png' });
  console.log('camera on the wall: ok');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
