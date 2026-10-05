import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HouseActions, makeAllow, DEFAULT_ALLOW } from '../card/src/actions.js';

const hassWith = (states) => {
  const calls = [];
  return {
    calls,
    states,
    callService: async (domain, service, data) => calls.push(`${domain}.${service} ${data.entity_id}`),
  };
};
const st = (state, attributes = {}) => ({ state, attributes });
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('default allowlist: lights, switches, media players, vacuums', () => {
  const allow = makeAllow(DEFAULT_ALLOW);
  for (const id of ['light.a', 'switch.b', 'media_player.c', 'vacuum.d']) assert.ok(allow.allows(id), id);
  for (const id of ['lock.front_door', 'cover.garage', 'climate.house', 'alarm_control_panel.home']) assert.ok(!allow.allows(id), id);
});

test('locks and covers are allowed only one by one', () => {
  const allow = makeAllow(['lock.*', 'cover.garage*', 'lock.front_door', 'cover.garage_door']);
  assert.equal(allow.warnings.length, 2);
  assert.ok(allow.allows('lock.front_door'));
  assert.ok(!allow.allows('lock.back_door'));
  assert.ok(allow.allows('cover.garage_door'));
  assert.ok(!allow.allows('cover.garage_side'));
});

test('real mode calls Home Assistant; refuses what is not allowed', async () => {
  const hass = hassWith({ 'light.a': st('on'), 'lock.door': st('locked') });
  const a = new HouseActions({ getHass: () => hass, mode: 'real', allow: makeAllow(DEFAULT_ALLOW) });
  assert.deepEqual(a.call('light.a', 'turn_off'), { ok: true });
  assert.equal(a.call('lock.door', 'unlock').reason, 'not-allowed');
  await tick(10);
  assert.deepEqual(hass.calls, ['light.turn_off light.a']);
  a.close();
});

test('a light cannot be flickered faster than the limit', async () => {
  const hass = hassWith({ 'light.a': st('on') });
  const a = new HouseActions({ getHass: () => hass, mode: 'real', allow: makeAllow() });
  assert.ok(a.call('light.a', 'turn_off').ok);
  assert.equal(a.call('light.a', 'turn_on').reason, 'too-fast');
  a.close();
});

test('calls close together are spaced out, not dropped', async () => {
  const hass = hassWith({ 'light.a': st('on'), 'light.b': st('on'), 'light.c': st('on') });
  const a = new HouseActions({ getHass: () => hass, mode: 'real', allow: makeAllow() });
  for (const id of ['light.a', 'light.b', 'light.c']) assert.ok(a.call(id, 'turn_off').ok);
  await tick(20);
  assert.equal(hass.calls.length, 1);
  await tick(500);
  assert.equal(hass.calls.length, 3);
  a.close();
});

test('practice mode never calls the house and plays changes out locally', async () => {
  const hass = hassWith({ 'light.a': st('on'), 'lock.door': st('locked'), 'vacuum.v': st('docked') });
  const changes = [];
  const a = new HouseActions({ getHass: () => hass, mode: 'practice', allow: makeAllow(), onChange: (c) => changes.push(c.entityId) });
  a.call('light.a', 'turn_off');
  a.call('lock.door', 'unlock');
  a.call('vacuum.v', 'start');
  await tick(700);
  assert.deepEqual(hass.calls, []);
  assert.equal(a.state('light.a').state, 'off');
  assert.equal(a.state('vacuum.v').state, 'cleaning');
  assert.equal(a.state('lock.door').state, 'unlocking');
  assert.equal(hass.states['light.a'].state, 'on', 'the real state is untouched');
  a.close();
});

test('switches that look important need naming, not a pattern', async () => {
  const { looksImportant } = await import('../card/src/actions.js');
  const allow = makeAllow(['switch.*', 'light.*', 'switch.kettle_plug']);
  assert.equal(allow.verdict('switch.freezer_socket', 'Freezer Socket'), 'important');
  assert.equal(allow.verdict('switch.network_rack'), 'important');
  assert.equal(allow.verdict('switch.plug_3', 'Garage Door Motor'), 'important');
  assert.equal(allow.verdict('switch.kettle_plug', 'Kettle'), 'yes', 'named exactly');
  assert.equal(allow.verdict('switch.tv_plug', 'TV Plug'), 'yes');
  assert.equal(allow.verdict('switch.wellness_lamp', 'Wellness lamp'), 'important', 'word starts count, cautiously');
  assert.equal(allow.verdict('light.front_door', 'Front Door Light'), 'yes', 'lights are never dangerous');
  assert.ok(!looksImportant('switch.scarecrow'), 'car only as a word start');
  assert.ok(looksImportant('switch.car_charger'));
});

test('a refused important switch says why', async () => {
  const hass = hassWith({ 'switch.freezer': st('on', { friendly_name: 'Freezer' }) });
  const a = new HouseActions({ getHass: () => hass, mode: 'real', allow: makeAllow(['switch.*']) });
  assert.deepEqual(a.call('switch.freezer', 'turn_off'), { ok: false, reason: 'not-allowed', important: true });
  a.close();
});
