// The card editor: ticks reflect the config, unticking removes the pattern,
// locks and important switches are offered one by one, the rest is kept.
// node tools/editortest.cjs  (harness served on :18765)
const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ acceptDownloads: true });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:18765/tools/harness/card.html');
  await page.waitForFunction(() => window.booted && customElements.get('housewad-card-editor'));
  const r = await page.evaluate(async () => {
    const Card = customElements.get('housewad-card');
    const ed = Card.getConfigElement();
    document.body.appendChild(ed);
    const events = [];
    ed.addEventListener('config-changed', (e) => events.push(e.detail.config));
    ed.setConfig({ type: 'custom:housewad-card', allow: ['light.*', 'switch.*'], floorplan: { rooms: [] }, skill: 2 });
    ed.hass = window.hass;
    const root = ed.shadowRoot;
    const box = (item) => root.querySelector(`input[data-item="${item}"]`);
    const before = { light: box('light.*').checked, sw: box('switch.*').checked, media: box('media_player.*').checked };
    // Each change redraws the form, so look each box up again.
    box('switch.*').click();
    box('lock.front_door').click();
    const important = [...root.querySelectorAll('input[data-item^="switch."]')].map((i) => i.dataset.item).filter((i) => !i.includes('*'));
    root.querySelector('select[data-skill]').value = '4';
    root.querySelector('select[data-skill]').dispatchEvent(new Event('change'));
    return { before, events, important, text: root.textContent };
  });
  assert.deepEqual(r.before, { light: true, sw: true, media: false });
  assert.deepEqual(r.events[0].allow, ['light.*'], 'unticking switches removes switch.*');
  assert.deepEqual(r.events[1].allow, ['light.*', 'lock.front_door'], 'a lock is added by name: ' + JSON.stringify(r.events.map((e) => e.allow)));
  assert.ok(r.events[1].floorplan, 'the floor plan is kept');
  assert.equal(r.events[2].skill, 4);
  assert.ok(r.important.length > 0, 'important switches are offered one by one: ' + r.important.join(', '));
  console.log('important offered:', r.important.join(', '));

  // The floor plan to Sweet Home 3D and back: Download gives a .sh3d, and
  // loading that file sets the same rooms.
  const plan = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'harness/twostorey.json'), 'utf8'));
  await page.evaluate((plan) => {
    const ed = customElements.get('housewad-card').getConfigElement();
    ed.id = 'ed2';
    document.body.appendChild(ed);
    window.planEvents = [];
    ed.addEventListener('config-changed', (e) => window.planEvents.push(e.detail.config));
    ed.setConfig({ type: 'custom:housewad-card', floorplan: plan });
    ed.hass = window.hass;
  }, plan);
  const [download] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => document.getElementById('ed2').shadowRoot.querySelector('[data-export]').click())]);
  assert.match(download.suggestedFilename(), /\.sh3d$/);
  const file = await download.path();
  await page.locator('#ed2 input[data-import]').setInputFiles({ name: 'house.sh3d', mimeType: 'application/octet-stream', buffer: require('fs').readFileSync(file) });
  await page.waitForFunction(() => window.planEvents.length > 0);
  const got = await page.evaluate(() => ({ plan: window.planEvents[0].floorplan, note: document.getElementById('ed2').shadowRoot.querySelector('.note').textContent }));
  assert.deepEqual(got.plan.rooms.map((x) => x.id).sort(), plan.rooms.map((x) => x.id).sort(), 'the same rooms come back');
  console.log('loaded:', got.note);
  assert.match(got.note, /Loaded house.sh3d: 6 rooms/);
  console.log('editor: all passed');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
