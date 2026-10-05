// Stairs between levels of a floor plan: walk up, arrive upstairs; walk back
// down, arrive where you started; same for steps down to a lower level.
// node tools/stairtest.cjs  (harness served on :18765)
const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1000, height: 900 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:18765/tools/harness/card.html?plan=twostorey.json');
  const card = page.locator('housewad-card');
  await card.waitFor();
  await page.waitForTimeout(800);
  await card.evaluate((el) => el.shadowRoot.querySelector('button.practice').click());
  await page.waitForFunction(() => window.card.link && window.card.link.ready, null, { timeout: 60000 });
  await page.evaluate(() => window.card.shadowRoot.querySelector('.screen').focus());

  const where = () => page.evaluate(() => {
    const l = window.card.link;
    const p = l.player();
    const r = l.manifest.sectorRoom[p.sector] || {};
    return { room: r.id, name: r.name, status: l.status().room, x: p.x, y: p.y, z: window.card.engine.module._hw_player_z ? window.card.engine.module._hw_player_z() : null };
  });
  const box = (id) => page.evaluate((id) => window.card.link.manifest.rooms.find((r) => r.id === id).bbox, id);
  const tp = (x, y, a) => page.evaluate(([x, y, a]) => window.card.engine.module._hw_teleport(Math.round(x), Math.round(y), a), [x, y, a]);
  const walk = async (ms) => { await page.keyboard.down('KeyW'); await page.waitForTimeout(ms); await page.keyboard.up('KeyW'); await page.waitForTimeout(400); };
  const S = 64;

  // Up: the hall's stair is north of the hall, x 1..2.2 m.
  const hall = await box('hallway');
  await tp(1.6 * S, hall.y2 - 40, 90);
  await walk(1500);
  let w = await where();
  console.log('after the stairs up:', JSON.stringify(w));
  assert.equal(w.room, 'bedroom', 'walking up the stairs lands upstairs');
  // You arrive facing the bedroom: keep going and you are in it.
  await walk(600);
  w = await where();
  assert.equal(w.room, 'bedroom');
  assert.equal(w.status, 'Bedroom', 'the status line says where you are');

  // Down again: the bedroom's stairwell is south of it.
  const bed = await box('bedroom');
  await tp(1.6 * S, bed.y1 + 40, 270);
  await walk(1500);
  w = await where();
  console.log('after the stairs down:', JSON.stringify(w));
  assert.equal(w.room, 'hallway', 'and back down to the hall');
  await walk(600);
  assert.equal((await where()).status, 'Hallway');

  // The garage is a level below the living room, off its east wall.
  const living = await box('living_room');
  await tp(living.x2 - 40, -1.6 * S, 0);
  await walk(1500);
  w = await where();
  console.log('after the garage steps:', JSON.stringify(w));
  assert.equal(w.room, 'garage', 'steps down reach the garage');

  // Nothing upstairs got lost: the bedroom's lamps are there.
  const lamps = await page.evaluate(() => window.card.link.manifest.lamps.filter((l) => l.room === 'bedroom').length);
  assert.ok(lamps > 0, 'upstairs rooms get their lamps');
  console.log('stairs: all passed');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
