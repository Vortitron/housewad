// Home Assistant -> house model.
//
// Uses only what the frontend's hass object already holds: floors, areas,
// devices, the entity registry display entries and states. Rooms are areas;
// entities without an area land in one catch-all room.

export const UNASSIGNED = '_unassigned';

const DOOR_SENSOR_CLASSES = ['door', 'garage_door'];
const DOOR_COVER_CLASSES = ['door', 'garage', 'gate'];
const PRESENCE_CLASSES = ['motion', 'occupancy', 'presence'];
const ALARM_CLASSES = ['smoke', 'gas', 'carbon_monoxide'];
// Appliance sensors by what they say (Home Connect, Miele and the like name
// them this way): its state, a finished programme, its door, a refill.
const APPLIANCE_PARTS = [
  ['state', /_(operation_state|operating_state)$/],
  ['finished', /_(programme|program)_finished$/],
  ['door', /_door$/],
  ['low', /_(nearly_empty|refill|low)$/],
];
// A percentage that runs out: coffee beans, salt, pellets, toner, ink.
const LEVEL_NAME = /\b(beans?|coffee|salt|pellets?|toner|ink|food|feed)\b/i;
const NOT_HOUSE_PLATFORMS = ['hassio', 'hacs'];

export function domainOf(entityId) {
  return entityId.split('.')[0];
}

// '*' matches any run of characters; patterns are whole-string matches.
export function matches(pattern, entityId) {
  const re = new RegExp('^' + pattern.split('*').map(escapeRe).join('.*') + '$');
  return re.test(entityId);
}

function escapeRe(s) {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

const objectIdOf = (entityId) => entityId.split('.')[1];

export function friendlyName(hass, entityId) {
  const st = hass.states[entityId];
  return (st && st.attributes && st.attributes.friendly_name) || entityId;
}

export function buildHouse(hass, { exclude = [] } = {}) {
  const entities = hass.entities || {};
  const devices = hass.devices || {};
  const areas = hass.areas || {};
  const floors = hass.floors || {};

  const areaOf = (entityId) => {
    const e = entities[entityId];
    if (e && e.area_id) return e.area_id;
    if (e && e.device_id && devices[e.device_id]) return devices[e.device_id].area_id || null;
    return null;
  };
  const deviceOf = (entityId) => (entities[entityId] && entities[entityId].device_id) || null;
  const visible = (entityId) => {
    const e = entities[entityId];
    if (e && (e.hidden || e.entity_category)) return false;
    // Supervisor entities are add-ons and the host, not the house: their
    // switches would let a stray shot stop an add-on.
    if (e && NOT_HOUSE_PLATFORMS.includes(e.platform)) return false;
    if (exclude.some((p) => matches(p, entityId))) return false;
    const st = hass.states[entityId];
    return !!st && st.state !== 'unavailable';
  };

  const rooms = new Map();
  for (const area of Object.values(areas)) {
    rooms.set(area.area_id, {
      id: area.area_id,
      name: area.name,
      floor: area.floor_id || null,
      lights: [],
      switches: [],
      media: [],
      vacuums: [],
      presence: [],
      windows: [],
      climates: [],
      cameras: [],
      doors: [],
      appliances: [],
      alarms: [],
      levels: [],
    });
  }
  const roomFor = (entityId) => {
    const id = areaOf(entityId);
    if (id && rooms.has(id)) return rooms.get(id);
    if (!rooms.has(UNASSIGNED)) {
      rooms.set(UNASSIGNED, {
        id: UNASSIGNED,
        name: 'Somewhere',
        floor: null,
        lights: [],
        switches: [],
        media: [],
        vacuums: [],
        presence: [],
        windows: [],
        climates: [],
        cameras: [],
        doors: [],
        appliances: [],
        alarms: [],
        levels: [],
      });
    }
    return rooms.get(UNASSIGNED);
  };

  const world = [];
  const powerByDevice = new Map();
  const locks = [];
  const doorCovers = [];
  const doorSensors = [];

  for (const entityId of Object.keys(hass.states).sort()) {
    if (!visible(entityId)) continue;
    const st = hass.states[entityId];
    const domain = domainOf(entityId);
    const dc = st.attributes.device_class;
    const item = { entity_id: entityId, name: st.attributes.friendly_name || entityId };
    // VomeSync shared switches are signals between homes, not devices in this
    // one. The ones this home only watches (a sensor, or a switch it does not
    // own) are the outside world; the ones it owns stay out of the game.
    if (isVomeSync(entities[entityId], st)) {
      if (!st.attributes.is_owner) {
        const name = st.attributes.name || item.name.replace(/ Status$/, '');
        world.push({ entity_id: entityId, name, kind: worldKind(name, st.attributes.category) });
      }
      continue;
    }
    switch (domain) {
      case 'light':
        roomFor(entityId).lights.push(item);
        break;
      case 'switch':
        roomFor(entityId).switches.push(item);
        break;
      case 'media_player':
        roomFor(entityId).media.push(item);
        break;
      case 'vacuum':
        roomFor(entityId).vacuums.push(item);
        break;
      case 'climate':
        roomFor(entityId).climates.push(item);
        break;
      case 'camera':
        roomFor(entityId).cameras.push(item);
        break;
      case 'lock':
        locks.push(item);
        break;
      case 'cover':
        if (DOOR_COVER_CLASSES.includes(dc)) doorCovers.push(item);
        break;
      case 'binary_sensor':
        if (DOOR_SENSOR_CLASSES.includes(dc)) doorSensors.push(item);
        else if (PRESENCE_CLASSES.includes(dc)) roomFor(entityId).presence.push(item);
        else if (dc === 'window') roomFor(entityId).windows.push(item);
        else if (ALARM_CLASSES.includes(dc)) roomFor(entityId).alarms.push(item);
        break;
      case 'sensor':
        if (dc === 'power' && deviceOf(entityId) && !powerByDevice.has(deviceOf(entityId)))
          powerByDevice.set(deviceOf(entityId), entityId);
        else if (st.attributes.unit_of_measurement === '%' && dc !== 'battery' && dc !== 'humidity' && LEVEL_NAME.test(`${objectIdOf(entityId).replace(/_/g, ' ')} ${item.name}`))
          roomFor(entityId).levels.push(item);
        break;
      default:
        break;
    }
  }

  // Appliances: sensors grouped by device (or by name when there is none).
  // Something with a state or a finished programme is an appliance; its door
  // and refill warnings join it.
  const parts = new Map();
  for (const entityId of Object.keys(hass.states).sort()) {
    if (!entityId.startsWith('sensor.') && !entityId.startsWith('binary_sensor.')) continue;
    if (!visible(entityId)) continue;
    for (const [part, re] of APPLIANCE_PARTS) {
      const m = objectIdOf(entityId).match(re);
      if (!m) continue;
      const key = deviceOf(entityId) || objectIdOf(entityId).slice(0, m.index);
      if (!parts.has(key)) parts.set(key, { state: null, finished: null, door: null, low: [], first: entityId, prefix: objectIdOf(entityId).slice(0, m.index) });
      const ap = parts.get(key);
      if (part === 'low') ap.low.push(entityId);
      else if (!ap[part]) ap[part] = entityId;
      break;
    }
  }
  for (const [key, ap] of parts) {
    if (!ap.state && !ap.finished) continue;
    const dev = devices[key];
    const name = (dev && (dev.name_by_user || dev.name)) || ap.prefix.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    roomFor(ap.state || ap.finished).appliances.push({ id: key.replace(/[^a-z0-9_]/gi, '_'), name, state: ap.state, finished: ap.finished, door: ap.door, low: ap.low });
  }

  // A vacuum that reports which room it is in (Dreame, Valetudo and others
  // have a "current room" sensor on the vacuum's device).
  const roomSensorByDevice = new Map();
  for (const entityId of Object.keys(hass.states)) {
    if (!/^sensor\..*(current_room|current_segment|_room)$/.test(entityId)) continue;
    const dev = deviceOf(entityId);
    if (dev && !roomSensorByDevice.has(dev)) roomSensorByDevice.set(dev, entityId);
  }
  // Without a device (template entities), go by name: sensor.<vacuum>_current_room.
  const objectId = (entityId) => entityId.split('.')[1];
  for (const room of rooms.values()) {
    for (const v of room.vacuums) {
      const dev = deviceOf(v.entity_id);
      const byName = `sensor.${objectId(v.entity_id)}_current_room`;
      if (dev && roomSensorByDevice.has(dev)) v.roomSensor = roomSensorByDevice.get(dev);
      else if (hass.states[byName]) v.roomSensor = byName;
    }
  }

  // Switches learn their power sensor (same device), for standby hunting.
  for (const room of rooms.values()) {
    for (const sw of room.switches) {
      const dev = deviceOf(sw.entity_id);
      const byName = `sensor.${sw.entity_id.split('.')[1]}_power`;
      if (dev && powerByDevice.has(dev)) sw.power = powerByDevice.get(dev);
      else if (hass.states[byName]?.attributes?.device_class === 'power') sw.power = byName;
    }
  }

  // Doors: a lock or door cover, joined with a door sensor on the same
  // device or, failing that, in the same room. A lone sensor is a door too.
  const unpaired = [...doorSensors];
  const takeSensor = (entityId) => {
    let i = unpaired.findIndex((s) => deviceOf(s.entity_id) && deviceOf(s.entity_id) === deviceOf(entityId));
    if (i < 0) i = unpaired.findIndex((s) => areaOf(s.entity_id) === areaOf(entityId));
    return i < 0 ? null : unpaired.splice(i, 1)[0];
  };
  const doorId = (entityId) => entityId.replace(/[^a-z0-9_]/gi, '_');
  for (const lock of locks) {
    const sensor = takeSensor(lock.entity_id);
    roomFor(lock.entity_id).doors.push({
      id: doorId(lock.entity_id),
      name: lock.name,
      lock: lock.entity_id,
      sensor: sensor && sensor.entity_id,
    });
  }
  for (const cover of doorCovers) {
    const sensor = takeSensor(cover.entity_id);
    roomFor(cover.entity_id).doors.push({
      id: doorId(cover.entity_id),
      name: cover.name,
      cover: cover.entity_id,
      sensor: sensor && sensor.entity_id,
    });
  }
  for (const sensor of unpaired) {
    roomFor(sensor.entity_id).doors.push({ id: doorId(sensor.entity_id), name: sensor.name, sensor: sensor.entity_id });
  }

  // Keep rooms that have something in them, plus every area on a floor so
  // the house still looks like the house.
  const houseRooms = [...rooms.values()].filter(
    (r) =>
      r.id !== UNASSIGNED ||
      r.lights.length + r.switches.length + r.media.length + r.vacuums.length + r.doors.length + r.cameras.length + r.appliances.length + r.alarms.length + r.levels.length > 0,
  );

  const people = findPeople(hass, exclude);
  return {
    floors: Object.values(floors).map((f) => ({ id: f.floor_id, name: f.name, level: f.level ?? 0 })),
    rooms: houseRooms,
    flies: findFlies(hass, exclude),
    // A phone that is a person is not a keycard lying about.
    trackers: findTrackers(hass, exclude).filter((t) => !people.some((p) => p.area === t.entity_id)),
    people,
    // Tablets and phones that listen for beacons (the Companion app's Beacon
    // monitor) and are in an area: a phone close to one is in that room.
    listeners: Object.keys(hass.states)
      .filter((id) => /^sensor\..+_beacon_monitor$/.test(id) && areaOf(id) && rooms.has(areaOf(id)))
      .map((id) => ({ entity_id: id, room: areaOf(id) })),
    persons: Object.keys(hass.states).filter((id) => id.startsWith('person.')),
    world,
  };
}

// Phones that send the Home Assistant Companion app's BLE beacon, followed
// from room to room by Bermuda: people, where they really are. The app tells
// us the beacon's id (sensor.<phone>_ble_transmitter, attribute "id"), and
// Bermuda names its room sensor after the same id. A wall tablet (Fully
// Kiosk on it) is a fixed screen, not somebody walking about.
export function findPeople(hass, exclude = []) {
  const ids = Object.keys(hass.states);
  const persons = ids.filter((id) => id.startsWith('person.')).map((id) => hass.states[id]);
  const out = [];
  for (const id of ids.sort()) {
    const m = id.match(/^sensor\.(.+)_ble_transmitter$/);
    if (!m || exclude.some((p) => matches(p, id))) continue;
    const phone = m[1];
    const beacon = hass.states[id].attributes.id;
    if (!beacon) continue;
    if (ids.some((e) => e.endsWith(`.${phone}_kiosk_mode`) || e.endsWith(`.${phone}_kiosk_lock`))) continue;
    const key = String(beacon).replace(/-/g, '').toLowerCase();
    const area = ids.find((e) => e.startsWith('sensor.') && e.endsWith('_area') && e.includes(key));
    if (!area) continue;
    const person = persons.find((p) => (p.attributes.device_trackers || []).includes(`device_tracker.${phone}`));
    const tracker = hass.states[`device_tracker.${phone}`];
    const name = person ? person.attributes.friendly_name || person.entity_id : (tracker && tracker.attributes.friendly_name) || phone.replace(/_/g, ' ');
    out.push({ id: phone, name, person: person ? person.entity_id : null, area, beacon: String(beacon).toLowerCase() });
  }
  return out;
}

// HouseFly (github.com/Vortitron/HouseFly) flies: a simulated fruit-fly brain
// per config entry, each with <prefix>_mode and <prefix>_heading sensors.
// The registry says which platform made them; without a registry, a mode
// sensor with a heading and Kenyon-cell sibling is a fly.
export function findFlies(hass, exclude = []) {
  const entities = hass.entities || {};
  const flies = [];
  for (const entityId of Object.keys(hass.states).sort()) {
    const m = /^sensor\.(.+)_mode$/.exec(entityId);
    if (!m) continue;
    const prefix = m[1];
    const heading = `sensor.${prefix}_heading`;
    const reg = entities[entityId];
    const isFly = reg && reg.platform ? reg.platform === 'fly_house' : !!hass.states[`sensor.${prefix}_kenyon_cells_active`];
    if (!isFly || !hass.states[heading]) continue;
    if (exclude.some((p) => matches(p, entityId))) continue;
    const name = (hass.states[entityId].attributes.friendly_name || prefix).replace(/ Mode$/, '');
    flies.push({ id: prefix, name, mode: entityId, heading });
  }
  return flies;
}

// Things tracked room by room over Bluetooth: Bermuda's "<thing>_area"
// sensors and ESPresense (mqtt_room) sensors, whose state is a room name.
export function findTrackers(hass, exclude = []) {
  const entities = hass.entities || {};
  const out = [];
  for (const entityId of Object.keys(hass.states).sort()) {
    if (!entityId.startsWith('sensor.')) continue;
    const reg = entities[entityId] || {};
    const bermuda = reg.platform === 'bermuda' && entityId.endsWith('_area');
    // Any other "<thing>_area" sensor whose state is one of the home's areas.
    const areaNames = new Set(Object.values(hass.areas || {}).map((a) => String(a.name).toLowerCase()));
    const named = entityId.endsWith('_area') && areaNames.has(String(hass.states[entityId].state).toLowerCase());
    if (!bermuda && !named && reg.platform !== 'mqtt_room') continue;
    if (exclude.some((p) => matches(p, entityId))) continue;
    const name = (hass.states[entityId].attributes.friendly_name || entityId).replace(/ Area$/, '');
    out.push({ entity_id: entityId, name });
  }
  return out;
}

function isVomeSync(reg, st) {
  return (reg && reg.platform === 'vomesync') || (!!st.attributes.switch_uid && 'is_owner' in st.attributes);
}

// What a world signal is, from its name. The public catalogue on
// sync.vome.io names things plainly ("GitHub is up", "Tower Bridge open").
export function worldKind(name, category = '') {
  const n = String(name || '').toLowerCase();
  if (category === 'IsUp' || / is up$/.test(n)) return 'uptime';
  if (/geomagnetic|aurora/.test(n)) return 'aurora';
  if (/earthquake|volcano|hurricane|flood|gdacs|tsunami|eruption/.test(n)) return 'disaster';
  if (/launch/.test(n)) return 'launch';
  if (/bridge|brug|underground|disruption|tunnel/.test(n)) return 'transport';
  return 'event';
}
