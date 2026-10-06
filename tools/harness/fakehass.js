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
  // Watched VomeSync switches: the outside world, read only.
  const watch = (id, name, on) => {
    add(`switch.${id}`, on ? 'on' : 'off', { friendly_name: name, switch_uid: `vs_${id}`, is_owner: false }, null);
    entities[`switch.${id}`].platform = 'vomesync';
  };
  watch('github_is_up', 'GitHub is up', true);
  watch('tower_bridge_open', 'Tower Bridge open', false);
  watch('significant_earthquake', 'Significant earthquake', false);
  watch('orbital_launch_window', 'Orbital launch window', false);
  // How the integration really shows a watched switch: a sensor.
  add('sensor.cloudflare_is_up_status', 'on', { friendly_name: 'Cloudflare is up Status', name: 'Cloudflare is up', category: 'IsUp', switch_uid: 'vs_cf', is_owner: false }, null);
  entities['sensor.cloudflare_is_up_status'].platform = 'vomesync';
  add('switch.my_shared_switch', 'off', { friendly_name: 'My shared switch', switch_uid: 'vs_mine', is_owner: true }, 'kitchen');
  entities['switch.my_shared_switch'].platform = 'vomesync';
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
    user: { id: 'user-test', name: 'Test', is_admin: true },
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

// Chores and alarms, as a real house reports them (names as Home Connect
// gives them): a dishwasher that has finished with its door open and the salt
// running out, coffee beans at 12%, and the kitchen smoke alarm. Added to an
// existing fake hass on request, so other tests keep their quiet house.
export function addChores(hass, { smoke = true } = {}) {
  const old = new Date(Date.now() - 3600e3).toISOString();
  const add = (entityId, state, attributes, areaId, deviceId) => {
    hass.states[entityId] = { entity_id: entityId, state, attributes, last_changed: old, last_updated: old };
    hass.entities[entityId] = { entity_id: entityId, area_id: deviceId ? null : areaId, device_id: deviceId || null };
    if (deviceId && !hass.devices[deviceId]) hass.devices[deviceId] = { id: deviceId, area_id: areaId, name: 'Dishwasher' };
  };
  add('sensor.dishwasher_operation_state', 'finished', { friendly_name: 'Dishwasher Operation state', device_class: 'enum' }, 'kitchen', 'dev_dishwasher');
  add('sensor.dishwasher_programme_finished', 'present', { friendly_name: 'Dishwasher Programme finished', device_class: 'enum' }, 'kitchen', 'dev_dishwasher');
  add('sensor.dishwasher_door', 'open', { friendly_name: 'Dishwasher Door', device_class: 'enum' }, 'kitchen', 'dev_dishwasher');
  add('sensor.dishwasher_salt_nearly_empty', 'present', { friendly_name: 'Dishwasher Salt nearly empty', device_class: 'enum' }, 'kitchen', 'dev_dishwasher');
  add('sensor.dishwasher_rinse_aid_nearly_empty', 'off', { friendly_name: 'Dishwasher Rinse aid nearly empty', device_class: 'enum' }, 'kitchen', 'dev_dishwasher');
  add('sensor.espresso_bean_level', '12', { friendly_name: 'Espresso Bean Level', unit_of_measurement: '%' }, 'kitchen');
  add('sensor.kitchen_humidity', '12', { friendly_name: 'Kitchen Humidity', unit_of_measurement: '%', device_class: 'humidity' }, 'kitchen');
  add('binary_sensor.kitchen_smoke', smoke ? 'on' : 'off', { friendly_name: 'Kitchen Smoke', device_class: 'smoke' }, 'kitchen');
  return hass;
}

// People Bermuda follows: Alex's phone sends the Companion app's beacon and
// Bermuda has it in the Kitchen; the hall tablet sends one too, but it is a
// Fully Kiosk wall screen. withSam adds a second person nobody follows.
export function addPeople(hass, { withSam = false, nearHall = false } = {}) {
  const old = new Date(Date.now() - 3600e3).toISOString();
  const add = (entityId, state, attributes, platform) => {
    hass.states[entityId] = { entity_id: entityId, state, attributes, last_changed: old, last_updated: old };
    hass.entities[entityId] = { entity_id: entityId, area_id: null, device_id: null, platform };
  };
  // Alex is the one logged in (hass.user), so Follow follows Alex's phone.
  add('person.alex', 'home', { friendly_name: 'Alex', device_trackers: ['device_tracker.alex_phone'], user_id: 'user-test' }, 'person');
  add('device_tracker.alex_phone', 'home', { friendly_name: 'Alex phone', source_type: 'gps' }, 'mobile_app');
  add('sensor.alex_phone_ble_transmitter', 'Transmitting', { friendly_name: 'Alex phone BLE transmitter', id: 'aaaa1111-2222-3333-4444-555566667777_100_1' }, 'mobile_app');
  add('sensor.bermuda_aaaa1111222233334444555566667777_100_1_area', 'Kitchen', { friendly_name: 'Alex phone Area' }, 'bermuda');
  add('sensor.hall_tablet_ble_transmitter', 'Transmitting', { friendly_name: 'Hall tablet BLE transmitter', id: 'bbbb1111-2222-3333-4444-555566667777_100_1' }, 'mobile_app');
  add('sensor.bermuda_bbbb1111222233334444555566667777_100_1_area', 'Hallway', { friendly_name: 'Hall tablet Area' }, 'bermuda');
  add('binary_sensor.hall_tablet_kiosk_mode', 'on', { friendly_name: 'Hall tablet Kiosk mode' }, 'fully_kiosk');
  if (withSam) add('person.sam', 'home', { friendly_name: 'Sam', device_trackers: ['device_tracker.sam_phone'] }, 'person');
  // The hall tablet's Beacon monitor hears Alex's phone 1.5 m away: Alex is
  // in the hall, whatever Bermuda's nearest proxy says.
  // nearHall: 'fresh' (a reading just now) or 'stale' (an hour old, which
  // says nothing about where Alex is now).
  add('sensor.hall_tablet_beacon_monitor', 'Monitoring', { friendly_name: 'Hall tablet Beacon monitor', 'aaaa1111-2222-3333-4444-555566667777_100_1': nearHall ? 1.5 : 9.2 }, 'mobile_app');
  hass.entities['sensor.hall_tablet_beacon_monitor'].area_id = 'hallway';
  if (nearHall === 'fresh') hass.states['sensor.hall_tablet_beacon_monitor'].last_updated = new Date().toISOString();
  return hass;
}
