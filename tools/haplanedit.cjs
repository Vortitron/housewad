// The plan editor inside Home Assistant's own card editor dialog (local test
// instance): open the dashboard in edit mode, edit the house.wad card, draw
// the plan from the sketch, drag a room, and check the dialog's preview and
// config follow. Nothing is saved: the dialog is cancelled.
// HA=http://127.0.0.1:18126 node tools/haplanedit.cjs
const { chromium } = require('playwright');
const assert = require('assert');
const SP = process.env.SP || '/tmp';
const HA = process.env.HA || 'http://127.0.0.1:18123';
// Deep query through shadow roots.
const deep = (sel) => `(() => { const walk = (root) => { const hit = root.querySelector(${JSON.stringify(sel)}); if (hit) return hit; for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { const f = walk(el.shadowRoot); if (f) return f; } return null; }; return walk(document); })()`;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(HA + '/house-wad/doom?edit=1');
  await page.fill('input[name="username"]', 'doomguy');
  await page.fill('input[name="password"]', 'iddqd-idkfa');
  await page.keyboard.press('Enter');
  await page.waitForFunction(deep('housewad-card'), null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  // The card's edit button (hui-card-options in edit mode).
  const opened = await page.evaluate(`(() => { const o = ${deep('hui-card-options')}; if (!o) return 'no options'; const b = [...o.shadowRoot.querySelectorAll('ha-button, mwc-button, button')].find((x) => /edit/i.test(x.textContent)); if (!b) return 'no edit button: ' + o.shadowRoot.innerHTML.slice(0, 300); b.click(); return 'ok'; })()`);
  console.log('edit:', opened);
  await page.waitForFunction(deep('housewad-card-editor'), null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.evaluate(`${deep('housewad-card-editor')}.shadowRoot.querySelector('[data-draw]').click()`);
  await page.waitForTimeout(1200);
  const info = await page.evaluate(`(() => { const ed = ${deep('housewad-card-editor')}; const pe = ed.shadowRoot.querySelector('housewad-plan-editor'); return { rooms: pe.plan.rooms.length, rects: pe.shadowRoot.querySelectorAll('rect[data-r]').length, sketched: pe.sketched }; })()`);
  console.log('plan editor in the dialog:', info);
  assert.ok(info.rects > 0, 'rooms drawn in the dialog');
  // Drag a room: real pointer input through the dialog.
  const box = await page.evaluate(`(() => { const ed = ${deep('housewad-card-editor')}; const pe = ed.shadowRoot.querySelector('housewad-plan-editor'); pe.shadowRoot.querySelector('.canvas').scrollIntoView({ block: 'center' }); const r = pe.shadowRoot.querySelector('rect[data-r]'); const b = r.getBoundingClientRect(); const m = pe.shadowRoot.querySelector('svg').getScreenCTM(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, per: m.a, id: pe.plan.rooms[Number(r.dataset.r)].id, before: pe.plan.rooms[Number(r.dataset.r)].rects[0] }; })()`);
  await page.waitForTimeout(400);
  const again = await page.evaluate(`(() => { const ed = ${deep('housewad-card-editor')}; const pe = ed.shadowRoot.querySelector('housewad-plan-editor'); const r = pe.shadowRoot.querySelector('rect[data-r]'); const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  await page.mouse.move(again.x, again.y);
  await page.mouse.down();
  await page.mouse.move(again.x + box.per * 1.5, again.y + box.per * 1.0, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const after = await page.evaluate(`(() => { const ed = ${deep('housewad-card-editor')}; return ed._config.floorplan && ed._config.floorplan.rooms.find((r) => r.id === ${JSON.stringify(box.id)}).rects[0]; })()`);
  console.log('dragged', box.id, box.before, '->', after);
  assert.ok(after && Math.abs(after[0] - box.before[0] - 1.5) < 0.3 && Math.abs(after[1] - box.before[1] - 1) < 0.3, 'the drag reached the card config through HA\'s dialog');
  await page.screenshot({ path: `${SP}/ha-planedit.png` });
  // Cancel: nothing saved.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  console.log('errors:', errors.filter((e) => /housewad|plan/i.test(e)));
  assert.deepEqual(errors.filter((e) => /housewad|plan/i.test(e)), []);
  console.log('HA plan editor: all passed');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
