// Home Assistant -> house model.
//
// Uses only what the frontend's hass object already holds: floors, areas,
// devices, the entity registry display entries and states. Rooms are areas;
// entities without an area land in one catch-all room.

export const UNASSIGNED = '_unassigned';

const DOOR_SENSOR_CLASSES = ['door', 'garage_door'];
const DOOR_COVER_CLASSES = ['door', 'garage', 'gate'];
const PRESENCE_CLASSES = ['motion', 'occupancy', 'presence'];
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
      });
    }
    return rooms.get(UNASSIGNED);
  };

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
        break;
      case 'sensor':
        if (dc === 'power' && deviceOf(entityId) && !powerByDevice.has(deviceOf(entityId)))
          powerByDevice.set(deviceOf(entityId), entityId);
        break;
      default:
        break;
    }
  }

  // Switches learn their power sensor (same device), for standby hunting.
  for (const room of rooms.values()) {
    for (const sw of room.switches) {
      const dev = deviceOf(sw.entity_id);
      if (dev && powerByDevice.has(dev)) sw.power = powerByDevice.get(dev);
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
      r.lights.length + r.switches.length + r.media.length + r.vacuums.length + r.doors.length + r.cameras.length > 0,
  );

  return {
    floors: Object.values(floors).map((f) => ({ id: f.floor_id, name: f.name, level: f.level ?? 0 })),
    rooms: houseRooms,
    flies: findFlies(hass, exclude),
  };
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
