// People Bermuda follows: the room they are in is occupied (an imp named
// after them, no wasted-light soul there), and other rooms count as empty
// only when everybody who lives here is followed.
// node tools/peopletest.cjs  (harness served on :18765)
const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const b = await chromium.launch();
  const run = async (query) => {
    const page = await b.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:18765/tools/harness/card.html' + query);
    const card = page.locator('housewad-card');
    await card.waitFor();
    await page.waitForTimeout(800);
    await card.evaluate((el) => el.shadowRoot.querySelector('button.practice').click());
    await page.waitForFunction(() => window.card.link && window.card.link.ready, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const mons = await page.evaluate(() => Object.fromEntries([...window.card.link.monsters.entries()].map(([k, m]) => [k, m.spec.label])));
    assert.deepEqual(errors, []);
    await page.close();
    return mons;
  };

  const plain = await run('');
  const alone = await run('?people');
  console.log('imps with Alex followed:', Object.entries(alone).filter(([k]) => k.startsWith('imp:')));
  assert.equal(alone['imp:kitchen'], 'Alex: in the Kitchen', 'an imp named after the person in the room');
  assert.ok(!Object.keys(alone).some((k) => k.includes('hallway') && k.startsWith('imp:')), 'the kiosk tablet in the hall is nobody');
  assert.ok(!alone['soul:light.kitchen_ceiling'], 'no wasted light where Alex is');
  // Everybody who lives here is followed: a light on where nobody is, is wasted.
  const extra = Object.keys(alone).filter((k) => k.startsWith('soul:') && !plain[k]);
  console.log('souls only people could tell:', extra);
  assert.ok(extra.length > 0, 'rooms without motion sensors get wasted lights too');

  const withSam = await run('?people=sam');
  const samExtra = Object.keys(withSam).filter((k) => k.startsWith('soul:') && !plain[k]);
  assert.deepEqual(samExtra, [], "with Sam unfollowed, nobody else's light is called wasted");
  assert.equal(withSam['imp:kitchen'], 'Alex: in the Kitchen', 'but Alex is still in the kitchen');
  // The hall tablet hears Alex close by: the hall, not Bermuda's kitchen.
  const hall = await run('?people=hall');
  assert.equal(hall['imp:hallway'], 'Alex: in the Hallway', 'a listening tablet close by wins');
  assert.ok(!hall['imp:kitchen'] || hall['imp:kitchen'] !== 'Alex: in the Kitchen', 'and Alex is not in two places');
  console.log('people: all passed');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
