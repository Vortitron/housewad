// A stand-in for the frontend's hass object: registries, states and a
// callService that records every call and applies it like a real house would.

export function makeFakeHass(onUpdate) {
  const floors = {
    ground: { floor_id: 'ground', name: 'Ground floor', level: 0 },
    upstairs: { floor_id: 'upstairs', name: 'Upstairs', level: 1 },
  };
  const areas = {};
  const area = (id, name, floor) => (areas[id] = { area_id: id, name, floor_id: floor });
  area('hallway', 'Hallway', 'ground');
  area('kitchen', 'Kitchen', 'ground');
  area('living_room', 'Living Room', 'ground');
  area('garage', 'Garage', 'ground');
  area('bedroom', 'Bedroom', 'upstairs');
  area('bathroom', 'Bathroom', 'upstairs');
  area('office', 'Office', 'upstairs');

  const devices = {};
  const entities = {};
  const states = {};
  const old = new Date(Date.now() - 3600e3).toISOString();
  const add = (entityId, state, attributes, areaId, deviceId) => {
    states[entityId] = { entity_id: entityId, state, attributes, last_changed: old, last_updated: old };
    entities[entityId] = { entity_id: entityId, area_id: deviceId ? null : areaId, device_id: deviceId || null };
    if (deviceId && !devices[deviceId]) devices[deviceId] = { id: deviceId, area_id: areaId, name: deviceId };
  };
  const light = (id, name, areaId, on = true, brightness = 255) =>
    add(`light.${id}`, on ? 'on' : 'off', { friendly_name: name, brightness: on ? brightness : null }, areaId);

  light('hallway', 'Hallway Light', 'hallway');
  light('kitchen_ceiling', 'Kitchen Ceiling', 'kitchen');
  light('kitchen_island', 'Kitchen Island', 'kitchen', false);
  light('floor_lamp', 'Floor Lamp', 'living_room', true, 180);
  light('sofa', 'Sofa Lamp', 'living_room');
  light('garage', 'Garage Light', 'garage', false);
  light('bedside', 'Bedside Lamp', 'bedroom');
  light('bathroom', 'Bathroom Light', 'bathroom', false);
  light('desk', 'Desk Lamp', 'office');

  add('switch.kettle', 'off', { friendly_name: 'Kettle' }, 'kitchen', 'kettle_plug');
  add('sensor.kettle_power', '0', { friendly_name: 'Kettle Power', device_class: 'power', unit_of_measurement: 'W' }, 'kitchen', 'kettle_plug');
  add('switch.tv_plug', 'on', { friendly_name: 'TV Plug' }, 'living_room', 'tv_plug');
  add('sensor.tv_plug_power', '4.2', { friendly_name: 'TV Plug Power', device_class: 'power', unit_of_measurement: 'W' }, 'living_room', 'tv_plug');
  add('switch.monitor', 'on', { friendly_name: 'Monitor' }, 'office');
  add('switch.towel_rail', 'off', { friendly_name: 'Towel Rail' }, 'bathroom');
  add('media_player.tv', 'playing', { friendly_name: 'Living Room TV', is_volume_muted: false }, 'living_room');
  add('media_player.bedroom_speaker', 'paused', { friendly_name: 'Bedroom Speaker' }, 'bedroom');
  add('vacuum.roborock', 'docked', { friendly_name: 'Roborock' }, 'hallway', 'robo');
  add('sensor.roborock_current_room', 'Hallway', { friendly_name: 'Roborock Current room' }, 'hallway', 'robo');
  add('sensor.car_keys_area', 'Kitchen', { friendly_name: 'Car Keys Area' }, null);
  add('lock.front_door', 'locked', { friendly_name: 'Front Door' }, 'hallway', 'front_door_lock');
  add('binary_sensor.front_door', 'off', { friendly_name: 'Front Door Contact', device_class: 'door' }, 'hallway', 'front_door_lock');
  add('cover.garage_door', 'closed', { friendly_name: 'Garage Door', device_class: 'garage' }, 'garage');
  add('binary_sensor.kitchen_motion', 'off', { friendly_name: 'Kitchen Motion', device_class: 'motion' }, 'kitchen');
  add('binary_sensor.office_motion', 'off', { friendly_name: 'Office Motion', device_class: 'motion' }, 'office');
  add('binary_sensor.bedroom_window', 'on', { friendly_name: 'Bedroom Window', device_class: 'window' }, 'bedroom');
  add('climate.house', 'heat', { friendly_name: 'House Heating', hvac_action: 'heating' }, 'hallway');
  add('sun.sun', 'above_horizon', { friendly_name: 'Sun' }, null);
  add('camera.living_room', 'idle', { friendly_name: 'Living Room Camera', entity_picture: '/tools/harness/cam.svg' }, 'living_room');
  add('sensor.test_fly_mode', 'walk', { friendly_name: 'Test Fly Mode' }, null);
  add('sensor.test_fly_heading', '90', { friendly_name: 'Test Fly Heading' }, null);
  add('sensor.test_fly_kenyon_cells_active', '30', { friendly_name: 'Test Fly Kenyon cells active' }, null);
  entities['sensor.car_keys_area'].platform = 'bermuda';
  for (const id of ['sensor.test_fly_mode', 'sensor.test_fly_heading', 'sensor.test_fly_kenyon_cells_active']) entities[id].platform = 'fly_house';
  add('switch.config_thing', 'on', { friendly_name: 'Hidden config switch' }, 'kitchen');
  entities['switch.config_thing'].entity_category = 'config';

  const calls = [];
  let hass;
  const rebuild = () => {
    hass = { ...hass, states: { ...states } };
    onUpdate && onUpdate(hass);
  };
  const set = (entityId, state, attrs = {}) => {
    states[entityId] = {
      ...states[entityId],
      state,
      attributes: { ...states[entityId].attributes, ...attrs },
      last_changed: new Date().toISOString(),
    };
    rebuild();
  };
  const later = (ms, fn) => setTimeout(fn, ms);

  hass = {
    states: { ...states },
    entities,
    devices,
    areas,
    floors,
    user: { name: 'Test', is_admin: true },
    config: { location_name: 'Test House' },
    calls,
    set,
    callService: async (domain, service, data) => {
      calls.push({ domain, service, data, at: Date.now() });
      const id = data.entity_id;
      const st = states[id];
      later(150, () => {
        switch (`${domain}.${service}`) {
          case 'light.turn_off':
          case 'switch.turn_off':
            return set(id, 'off');
          case 'light.turn_on':
            return set(id, 'on', { brightness: 255 });
          case 'switch.turn_on':
            return set(id, 'on');
          case 'switch.toggle':
          case 'light.toggle':
            return set(id, st.state === 'on' ? 'off' : 'on');
          case 'media_player.media_play_pause':
            return set(id, st.state === 'playing' ? 'paused' : 'playing');
          case 'media_player.volume_mute':
            return set(id, st.state, { is_volume_muted: data.is_volume_muted });
          case 'vacuum.start':
            return set(id, 'cleaning');
          case 'vacuum.return_to_base':
            set(id, 'returning');
            return later(3000, () => set(id, 'docked'));
          case 'lock.unlock':
            set(id, 'unlocking');
            return later(800, () => set(id, 'unlocked'));
          case 'lock.lock':
            set(id, 'locking');
            return later(800, () => set(id, 'locked'));
          case 'cover.open_cover':
            set(id, 'opening');
            return later(1500, () => set(id, 'open'));
          case 'cover.close_cover':
            set(id, 'closing');
            return later(1500, () => set(id, 'closed'));
          case 'fly_house.loom':
            set('sensor.test_fly_mode', 'escape');
            return later(4000, () => set('sensor.test_fly_mode', 'walk'));
          default:
            return undefined;
        }
      });
    },
  };
  return hass;
}
