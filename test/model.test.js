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

test('add-on switches from the Supervisor are not part of the house', () => {
  const hass = makeFakeHass();
  hass.states['switch.vome'] = { entity_id: 'switch.vome', state: 'on', attributes: { friendly_name: 'Vome' } };
  hass.entities['switch.vome'] = { entity_id: 'switch.vome', platform: 'hassio', area_id: 'kitchen' };
  const all = buildHouse(hass).rooms.flatMap((r) => r.switches.map((s) => s.entity_id));
  assert.ok(!all.includes('switch.vome'));
});

test('template devices pair by name: plug power, vacuum room, tag area', () => {
  const hass = makeFakeHass();
  const add = (id, state, attributes, area) => {
    hass.states[id] = { entity_id: id, state, attributes };
    hass.entities[id] = { entity_id: id, area_id: area, platform: 'template' };
  };
  add('switch.lamp_plug', 'on', { friendly_name: 'Lamp Plug' }, 'bedroom');
  add('sensor.lamp_plug_power', '3', { device_class: 'power' }, 'bedroom');
  add('vacuum.robo2', 'docked', { friendly_name: 'Robo 2' }, 'kitchen');
  add('sensor.robo2_current_room', 'Kitchen', {}, 'kitchen');
  add('sensor.wallet_area', 'Office', { friendly_name: 'Wallet Area' }, null);
  add('sensor.weird_area', 'not a room', { friendly_name: 'Weird Area' }, null);
  const house = buildHouse(hass);
  const bedroom = house.rooms.find((r) => r.id === 'bedroom');
  assert.equal(bedroom.switches.find((s) => s.entity_id === 'switch.lamp_plug').power, 'sensor.lamp_plug_power');
  const kitchen = house.rooms.find((r) => r.id === 'kitchen');
  assert.equal(kitchen.vacuums.find((v) => v.entity_id === 'vacuum.robo2').roomSensor, 'sensor.robo2_current_room');
  assert.deepEqual(house.trackers.map((t) => t.entity_id).sort(), ['sensor.car_keys_area', 'sensor.wallet_area']);
});

test('watched VomeSync switches are the outside world; owned ones are left out', async () => {
  const { worldKind } = await import('../card/src/model.js');
  const house = buildHouse(makeFakeHass());
  const switches = house.rooms.flatMap((r) => r.switches.map((s) => s.entity_id));
  assert.ok(!switches.some((s) => s.startsWith('switch.github') || s === 'switch.my_shared_switch'));
  assert.deepEqual(house.world.map((w) => [w.entity_id, w.kind]).sort(), [
    ['sensor.cloudflare_is_up_status', 'uptime'],
    ['switch.github_is_up', 'uptime'],
    ['switch.orbital_launch_window', 'launch'],
    ['switch.significant_earthquake', 'disaster'],
    ['switch.tower_bridge_open', 'transport'],
  ]);
  assert.equal(worldKind('Geomagnetic storm G4+'), 'aurora');
  assert.equal(worldKind('Ketelbrug open'), 'transport');
  assert.equal(worldKind('Full moon'), 'event');
  assert.equal(house.world.find((w) => w.entity_id === 'sensor.cloudflare_is_up_status').name, 'Cloudflare is up');
});
