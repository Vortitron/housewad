// The card's sharp overhead map: while Doom's map is up the card draws it
// again over the game at the screen's resolution, each room in the colours
// of its lights that are on (a stripe each), dark when they are off; it goes
// away with Doom's map. Saves a screenshot to look at.
// node tools/hiresmaptest.cjs  (harness served on :18765)
const { chromium } = require('playwright');
const assert = require('assert');
const SP = process.env.SP || '/tmp';
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:18765/tools/harness/card.html?plan=twostorey.json');
  const card = page.locator('housewad-card');
  await card.waitFor();
  await page.waitForTimeout(800);
  await card.evaluate((el) => el.shadowRoot.querySelector('button.practice').click());
  await page.waitForFunction(() => window.card.link && window.card.link.ready, null, { timeout: 60000 });
  await page.keyboard.type('iddqd');
  await page.waitForTimeout(1000);
  const shown = () => card.evaluate((el) => el.shadowRoot.querySelector('canvas.hires').style.display === 'block');
  assert.equal(await shown(), false, 'no sharp map during the game');
  await card.evaluate((el) => el.shadowRoot.querySelector('button.map').click());
  await page.waitForTimeout(700);
  assert.equal(await shown(), true, 'the Map button brings up the sharp map');
  const size = await card.evaluate((el) => { const c = el.shadowRoot.querySelector('canvas.hires'); return [c.width, c.clientWidth]; });
  assert.ok(size[0] >= size[1] * 2 - 1, `drawn at the screen's resolution (${size[0]} pixels for ${size[1]} CSS pixels)`);
  await page.screenshot({ path: `${SP}/hiresmap.png` });

  // The colours inside a room, as counts of rough colour names.
  const roomColours = (area) =>
    card.evaluate((el, area) => {
      const l = el.link;
      const room = l.manifest.rooms.find((r) => r.id === area);
      const c = el.shadowRoot.querySelector('canvas.hires');
      const f = el.overmap.fit;
      const dpr = c.width / c.clientWidth;
      const r = (room.rects || [room.bbox])[0];
      const X = (x) => Math.round((f.w / 2 + (x - f.cx) * f.s) * dpr);
      const Y = (y) => Math.round((f.h / 2 - (y - f.cy) * f.s) * dpr);
      const x1 = X(r.x1) + 6, x2 = X(r.x2) - 6, y1 = Y(r.y2) + 6, y2 = Y(r.y1) - 6;
      const d = c.getContext('2d').getImageData(x1, y1, x2 - x1, y2 - y1).data;
      const seen = { magenta: 0, cool: 0, warm: 0, dark: 0, n: 0 };
      for (let i = 0; i < d.length; i += 16) {
        const [R, G, B] = [d[i], d[i + 1], d[i + 2]];
        seen.n++;
        if (R > 150 && B > 90 && G < 90) seen.magenta++;
        else if (B > 170 && G > 150 && R > 150 && B >= R - 10) seen.cool++;
        else if (R > 170 && G > 120 && B < 140) seen.warm++;
        else if (R < 50 && G < 50 && B < 60) seen.dark++;
      }
      return seen;
    }, area);
  const set = (id, state, attributes) =>
    page.evaluate(([id, state, attributes]) => {
      const h = window.card.hass;
      window.card.hass = { ...h, states: { ...h.states, [id]: { ...h.states[id], state, attributes: { ...h.states[id].attributes, ...attributes }, last_changed: new Date().toISOString() } } };
    }, [id, state, attributes]);
  const living = await roomColours('living_room');
  console.log('living room:', living);
  assert.ok(living.magenta > living.n * 0.15 && living.cool > living.n * 0.15, 'two lights on: a stripe of each colour');
  const hall = await roomColours('hallway');
  console.log('hallway:', hall);
  assert.ok(hall.warm > hall.n * 0.6, 'a plain light on: warm white');
  // The kitchen's light goes off in Home Assistant: the room goes dark.
  await set('light.kitchen_ceiling', 'off', { brightness: null });
  await page.waitForTimeout(400);
  const dark = await roomColours('kitchen');
  console.log('kitchen, off:', dark);
  assert.ok(dark.dark > dark.n * 0.8, 'its lights off: the kitchen is dark');
  // Another comes on, magenta: the room takes its colour.
  await set('light.kitchen_island', 'on', { brightness: 255, rgb_color: [255, 30, 200] });
  await page.waitForTimeout(400);
  const lit = await roomColours('kitchen');
  console.log('kitchen, island on:', lit);
  assert.ok(lit.magenta > lit.n * 0.6, "the kitchen takes its light's colour");

  await card.evaluate((el) => el.shadowRoot.querySelector('button.map').click());
  await page.waitForTimeout(500);
  assert.equal(await shown(), false, 'and goes away with the map');
  assert.deepEqual(errors, []);
  console.log('hires map: all passed');
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
