// The card editor: ticks reflect the config, unticking removes the pattern,
// locks and important switches are offered one by one, the rest is kept.
// node tools/editortest.cjs  (harness served on :18765)
const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage();
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
  console.log('editor: all passed');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
