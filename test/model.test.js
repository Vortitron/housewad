import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHouse, matches, UNASSIGNED } from '../card/src/model.js';
import { makeFakeHass } from '../tools/harness/fakehass.js';

test('areas become rooms, floors carry over', () => {
  const house = buildHouse(makeFakeHass());
  assert.equal(house.floors.length, 2);
  const kitchen = house.rooms.find((r) => r.id === 'kitchen');
  assert.deepEqual(kitchen.lights.map((l) => l.entity_id), ['light.kitchen_ceiling', 'light.kitchen_island']);
  assert.equal(kitchen.floor, 'ground');
});

test('config entities and excluded entities stay out', () => {
  const house = buildHouse(makeFakeHass(), { exclude: ['switch.monitor'] });
  const all = house.rooms.flatMap((r) => r.switches.map((s) => s.entity_id));
  assert.ok(!all.includes('switch.config_thing'));
  assert.ok(!all.includes('switch.monitor'));
  assert.ok(all.includes('switch.kettle'));
});

test('a lock pairs with the door sensor on its device', () => {
  const hall = buildHouse(makeFakeHass()).rooms.find((r) => r.id === 'hallway');
  assert.deepEqual(hall.doors, [{ id: 'lock_front_door', name: 'Front Door', lock: 'lock.front_door', sensor: 'binary_sensor.front_door' }]);
});

test('a garage cover is a door; switches find their power sensor', () => {
  const house = buildHouse(makeFakeHass());
  const garage = house.rooms.find((r) => r.id === 'garage');
  assert.equal(garage.doors[0].cover, 'cover.garage_door');
  const living = house.rooms.find((r) => r.id === 'living_room');
  assert.equal(living.switches[0].power, 'sensor.tv_plug_power');
});

test('things with no area gather in one room; unavailable things are left out', () => {
  const hass = makeFakeHass();
  hass.states['light.stray'] = { entity_id: 'light.stray', state: 'on', attributes: { friendly_name: 'Stray' } };
  hass.states['light.gone'] = { entity_id: 'light.gone', state: 'unavailable', attributes: {} };
  const house = buildHouse(hass);
  const somewhere = house.rooms.find((r) => r.id === UNASSIGNED);
  assert.deepEqual(somewhere.lights.map((l) => l.entity_id), ['light.stray']);
});

test('works without floors or registries (old frontends)', () => {
  const hass = makeFakeHass();
  const house = buildHouse({ states: hass.states });
  assert.equal(house.floors.length, 0);
  assert.equal(house.rooms.length, 1);
  assert.equal(house.rooms[0].id, UNASSIGNED);
});

test('patterns match whole entity ids', () => {
  assert.ok(matches('light.*', 'light.kitchen'));
  assert.ok(!matches('light.*', 'switch.light'));
  assert.ok(matches('lock.front_door', 'lock.front_door'));
  assert.ok(!matches('lock.front', 'lock.front_door'));
});
