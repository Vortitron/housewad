// Usage: node tools/shot.js <url> <out.png> [actions json]
// actions: [["wait",ms],["key","KeyW",ms],["shot","file.png"],["eval","js"]]
const { chromium } = require('playwright');
(async () => {
  const [url, out, actionsJson] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 700, height: 560 } });
  page.on('console', (m) => console.log('console:', m.text()));
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.booted, null, { timeout: 30000 });
  for (const a of JSON.parse(actionsJson || '[["wait",2500]]')) {
    if (a[0] === 'wait') await page.waitForTimeout(a[1]);
    if (a[0] === 'key') { await page.keyboard.down(a[1]); await page.waitForTimeout(a[2] || 100); await page.keyboard.up(a[1]); }
    if (a[0] === 'type') await page.keyboard.type(a[1], { delay: 60 });
    if (a[0] === 'shot') await page.screenshot({ path: a[1] });
    if (a[0] === 'eval') console.log('eval:', JSON.stringify(await page.evaluate(a[1])));
  }
  await page.screenshot({ path: out });
  console.log('frames:', await page.evaluate(() => window.engine.frames));
  await browser.close();
})();
