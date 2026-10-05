const { chromium, devices } = require('playwright');
const SP = process.env.SP || '/tmp';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto('http://127.0.0.1:18765/tools/harness/card.html');
  await page.waitForFunction(() => window.booted);
  await page.screenshot({ path: SP + '/phone-start.png' });
  console.log('innerWidth', await page.evaluate(() => window.innerWidth));
  await page.evaluate(() => window.card.shadowRoot.querySelector('button.practice').click());
  await page.waitForFunction(() => window.card.link && window.card.link.ready, null, { timeout: 30000 });
  // Hold forward on the touch pad for a moment.
  const up = await page.evaluateHandle(() => window.card.shadowRoot.querySelector('.pad [data-key="173"]'));
  const box = await up.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.evaluate(() => { const el = window.card.shadowRoot.querySelector('.pad [data-key="173"]'); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { const el = window.card.shadowRoot.querySelector('.pad [data-key="173"]'); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); });
  await page.waitForTimeout(400);
  console.log('innerWidth playing', await page.evaluate(() => window.innerWidth));
  await page.screenshot({ path: SP + '/phone-game.png' });
  await browser.close();
})();
