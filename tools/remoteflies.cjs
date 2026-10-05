// On a remote HA with HouseFly: flies spawn, walk with their brains, and a
// shot looms the real fly. node tools/remoteflies.cjs <base> <token file> <fly id>
const { chromium } = require('playwright');
const fs = require('fs');
const SP = process.env.SP || '/tmp';
(async () => {
  const [base, tokFile, flyId] = process.argv.slice(2);
  const tok = fs.readFileSync(tokFile, 'utf8').trim();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 860 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.addInitScript(([t, b]) => localStorage.setItem('hassTokens', JSON.stringify({ access_token: t, token_type: 'Bearer', expires_in: 1800, hassUrl: b, clientId: b + '/', expires: Date.now() + 1700e3, refresh_token: '' })), [tok, base]);
  await page.goto(base + '/house-wad/doom');
  const card = page.locator('housewad-card');
  await card.waitFor({ timeout: 40000 });
  await page.waitForTimeout(1500);
  console.log('version', await page.evaluate(() => [...document.querySelectorAll('script')].length), await card.evaluate((el) => el.shadowRoot.querySelector('.sub').textContent));
  await card.evaluate((el) => el.shadowRoot.querySelector('button.real').click());
  await page.waitForFunction(() => {
    const find = (root) => { for (const el of root.querySelectorAll('*')) { if (el.tagName === 'HOUSEWAD-CARD') return el; if (el.shadowRoot) { const f = find(el.shadowRoot); if (f) return f; } } return null; };
    const c = find(document); window.__card = c; return c && c.link && c.link.ready;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  const flies = () => page.evaluate(() => {
    const l = window.__card.link;
    return [...l.monsters].filter(([k]) => k.startsWith('fly:')).map(([k, m]) => {
      l.m._hw_slot_pos(m.slot, l.out);
      return { k, room: m.spec.room, mode: l.actions.state(m.spec.fly.mode).state, heading: l.actions.state(m.spec.fly.heading).state, pos: [l.m.HEAP32[l.out >> 2], l.m.HEAP32[(l.out >> 2) + 1]] };
    });
  });
  const a = await flies();
  await page.waitForTimeout(3000);
  const b2 = await flies();
  for (let i = 0; i < a.length; i++) console.log(a[i].k, a[i].room, a[i].mode, a[i].heading, a[i].pos, '->', b2[i].pos);
  // Stand in the fly's room facing it, and shoot.
  const f = b2.find((x) => x.k === 'fly:' + flyId);
  await page.evaluate(([x, y]) => window.__card.engine.module._hw_teleport(x - 150, y, 0), f.pos);
  await page.evaluate(() => window.__card.shadowRoot.querySelector('.screen').focus());
  await page.waitForTimeout(500);
  await page.screenshot({ path: SP + '/fly-before.png' });
  const modeBefore = await page.evaluate((id) => window.__card.hass.states[`sensor.${id}_mode`].state, flyId);
  await page.keyboard.down('ControlLeft'); await page.waitForTimeout(150); await page.keyboard.up('ControlLeft');
  await page.waitForTimeout(400);
  await page.screenshot({ path: SP + '/fly-shot.png' });
  let modeAfter = modeBefore;
  for (let i = 0; i < 20 && modeAfter !== 'escape'; i++) {
    await page.waitForTimeout(500);
    modeAfter = await page.evaluate((id) => window.__card.hass.states[`sensor.${id}_mode`].state, flyId);
  }
  console.log(flyId, 'mode', modeBefore, '->', modeAfter);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: SP + '/fly-after.png' });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
