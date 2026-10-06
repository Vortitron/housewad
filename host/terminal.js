// house.wad in a terminal: the card's own game, run by Node instead of a
// browser, for a Claude Code pane (the vome-doom plugin) or anything else that
// can start a process and draw what it says.
//
// The same modules as the card build the level from a Home Assistant snapshot
// and run the same engine; only the edges differ:
//
//   stdin   one JSON snapshot of the home, read at start, then closed:
//           { floors, areas, devices, entities, states, location_name }
//   stdout  one JSON message a line:
//           {"t":"ready","columns":c,"rows":r}       the frame size in cells
//           {"t":"frame","cells":"<base64>"}         c*r cells of 12 bytes
//                                                    (u32 code point, u32 top
//                                                    RGB, u32 bottom RGB, LE)
//           {"t":"status","room","aim","last","world"}
//           {"t":"call","id":n,"domain","service","data"}  a real action
//           {"t":"error","text"}                     then it exits
//   --input a file the caller appends JSON lines to, as stdin cannot stay
//           open: {"t":"key","key":"up"} (a terminal key name or a character),
//           {"t":"reply","id":n,"error":null}, {"t":"state","entity_id",
//           "state":{...}}, {"t":"quit"}.
//
// A terminal reports key presses, never releases, so a press holds the Doom
// key for a moment and its auto-repeat keeps holding it.
//
// Copyright (C) 2026 Vome. GPL-2.0-or-later, like the card it reuses.

import { openSync, readSync, fstatSync, readFileSync, existsSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { KEY, DoomEngine } from '../card/src/engine.js';
import { buildHouse } from '../card/src/model.js';
import { generateMap } from '../card/src/mapgen.js';
import { writeWad, readWad, textPatch } from '../card/src/wad.js';
import { buildNodes } from '../card/src/nodes.js';
import { HouseActions, makeAllow, DEFAULT_ALLOW } from '../card/src/actions.js';
import { HouseLink, hudText } from '../card/src/house.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []),
);
const assets = args.assets || '.';
const inputPath = args.input;
const mode = args.mode === 'practice' ? 'practice' : 'real';
const skill = Number(args.skill || 3);
const wantColumns = Math.max(40, Math.min(240, Number(args.columns || 100)));
const wantRows = Math.max(12, Math.min(120, Number(args.rows || 38)));
const fps = Math.max(5, Math.min(35, Number(args.fps || 20)));

const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const fail = (text) => {
  send({ t: 'error', text: String(text) });
  setTimeout(() => process.exit(1), 50);
};
process.on('uncaughtException', (e) => fail(e && e.message ? e.message : e));
process.on('unhandledRejection', (e) => fail(e && e.message ? e.message : e));

// The frame: 320x200 Doom pixels, shown at 4:3 (Doom's pixels are taller than
// wide), fitted into the cells asked for, two pixels a cell with a half block.
const aspectHeight = 240;
const scale = Math.min(wantColumns / 320, (wantRows * 2) / aspectHeight);
const columns = Math.max(1, Math.round(320 * scale));
const pixelRows = Math.max(2, Math.round(aspectHeight * scale));
const rows = Math.ceil(pixelRows / 2);
const cellBytes = Buffer.alloc(columns * rows * 12);
for (let i = 0; i < columns * rows; i++) cellBytes.writeUInt32LE(0x2580, i * 12);

function present(rgba, width, height) {
  // Box-average each output pixel's source block.
  const pixel = (px, py) => {
    const x0 = Math.floor((px * width) / columns);
    const x1 = Math.max(x0 + 1, Math.floor(((px + 1) * width) / columns));
    const y0 = Math.floor((py * height) / pixelRows);
    const y1 = Math.max(y0 + 1, Math.floor(((py + 1) * height) / pixelRows));
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        r += rgba[i];
        g += rgba[i + 1];
        b += rgba[i + 2];
        n++;
      }
    }
    return ((r / n) << 16) | ((g / n) << 8) | (b / n);
  };
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const at = (row * columns + col) * 12;
      cellBytes.writeUInt32LE(pixel(col, row * 2) >>> 0, at + 4);
      cellBytes.writeUInt32LE(row * 2 + 1 < pixelRows ? pixel(col, row * 2 + 1) >>> 0 : 0, at + 8);
    }
  }
  send({ t: 'frame', cells: cellBytes.toString('base64') });
}

// A canvas that hands each finished frame to present(), at most fps a second.
function terminalCanvas() {
  let last = 0;
  return {
    width: 320,
    height: 200,
    getContext: () => ({
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (image) => {
        const now = Date.now();
        if (now - last < 1000 / fps) return;
        last = now;
        present(image.data, image.width, image.height);
      },
    }),
  };
}

// The home, as the card's hass object holds it -------------------------------

function readSnapshot() {
  const text = readFileSync(0, 'utf8');
  const snap = JSON.parse(text || '{}');
  const byId = (list, key) => (Array.isArray(list) ? Object.fromEntries(list.map((x) => [x[key], x])) : list || {});
  return {
    floors: byId(snap.floors, 'floor_id'),
    areas: byId(snap.areas, 'area_id'),
    devices: byId(snap.devices, 'id'),
    entities: byId(snap.entities, 'entity_id'),
    states: byId(snap.states, 'entity_id'),
    config: { location_name: snap.location_name || 'Home' },
    user: { id: 'vome-doom', name: 'Claude Code', is_admin: false },
  };
}

const calls = new Map();
let nextCall = 1;

function makeHass(snapshot) {
  return {
    ...snapshot,
    callService(domain, service, data) {
      const id = nextCall++;
      send({ t: 'call', id, domain, service, data: data || {} });
      return new Promise((resolve, reject) => {
        calls.set(id, { resolve, reject });
        setTimeout(() => {
          if (calls.delete(id)) reject(new Error('no answer from Home Assistant'));
        }, 20000);
      });
    },
  };
}

// Keys ----------------------------------------------------------------------

// A terminal key name or character to a Doom key. Characters not listed pass
// through as themselves: menus, cheats, weapon numbers, Y/N.
const KEYS = {
  up: KEY.UP,
  down: KEY.DOWN,
  left: KEY.LEFT,
  right: KEY.RIGHT,
  w: KEY.UP,
  s: KEY.DOWN,
  a: KEY.STRAFE_L,
  d: KEY.STRAFE_R,
  e: KEY.USE,
  ' ': KEY.FIRE,
  f: KEY.FIRE,
  return: KEY.ENTER,
  enter: KEY.ENTER,
  tab: KEY.TAB,
  backspace: KEY.BACKSPACE,
  // A terminal pane never sees Escape (it hands the focus back), so the menu is M.
  m: KEY.ESCAPE,
};
// Movement keys are held over the terminal's auto-repeat delay; a turn only briefly.
const HOLD = { [KEY.UP]: 450, [KEY.DOWN]: 450, [KEY.STRAFE_L]: 400, [KEY.STRAFE_R]: 400, [KEY.LEFT]: 160, [KEY.RIGHT]: 160 };
const releases = new Map();

function press(engine, name) {
  const lower = name.length === 1 ? name.toLowerCase() : name.toLowerCase();
  let key = KEYS[lower];
  if (key === undefined) {
    if (lower.length !== 1 || lower.charCodeAt(0) > 127) return;
    key = lower.charCodeAt(0);
  }
  const ch = lower.length === 1 ? lower.charCodeAt(0) : 0;
  const held = releases.get(key);
  if (held) clearTimeout(held);
  else engine.keyDown(key, ch);
  releases.set(
    key,
    setTimeout(() => {
      releases.delete(key);
      engine.keyUp(key);
    }, HOLD[key] || 120),
  );
}

// The input file --------------------------------------------------------------

function watchInput(onMessage) {
  if (!inputPath) return;
  let fd = null;
  let offset = 0;
  let partial = '';
  const buffer = Buffer.alloc(65536);
  setInterval(() => {
    try {
      if (fd === null) {
        if (!existsSync(inputPath)) return;
        fd = openSync(inputPath, 'r');
      }
      const size = fstatSync(fd).size;
      while (offset < size) {
        const n = readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset);
        if (n <= 0) break;
        offset += n;
        partial += buffer.toString('utf8', 0, n);
      }
      const lines = partial.split('\n');
      partial = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          onMessage(JSON.parse(line));
        } catch (e) {
          // A torn or foreign line: skip it.
        }
      }
    } catch (e) {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch (_) {}
      }
      fd = null;
    }
  }, 25);
}

// The game --------------------------------------------------------------------

function playpal(iwad) {
  try {
    const w = readWad(iwad);
    const lump = w.find('PLAYPAL');
    return lump ? w.data(lump).slice(0, 768) : null;
  } catch (e) {
    return null;
  }
}

async function main() {
  const snapshot = readSnapshot();
  let hass = makeHass(snapshot);
  const file = (name) => join(assets, name);
  for (const name of ['freedoom2.wad', 'housewad-engine.js', 'housewad-engine.wasm', 'housewad-zdbsp.js', 'housewad-zdbsp.wasm']) {
    if (!existsSync(file(name))) throw new Error(`missing ${name} in ${assets}`);
  }
  const house = buildHouse(hass, {});
  const { lumps, manifest } = generateMap(house);
  const iwad = new Uint8Array(readFileSync(file('freedoom2.wad')));
  const home = hudText(snapshot.config.location_name).slice(0, 24);
  try {
    const title = textPatch(readWad(iwad), home);
    lumps.push({ name: 'CWILV00', data: title }, { name: 'CWILV01', data: title });
  } catch (e) {
    // Freedoom's own titles will do.
  }
  const [{ default: createZdbsp }, { default: createEngine }] = await Promise.all([
    import(pathToFileURL(file('housewad-zdbsp.js')).href),
    import(pathToFileURL(file('housewad-engine.js')).href),
  ]);
  const pwad = await buildNodes(createZdbsp, writeWad(lumps), { wasmUrl: file('housewad-zdbsp.wasm') });

  const actions = new HouseActions({
    getHass: () => hass,
    mode,
    allow: makeAllow(DEFAULT_ALLOW),
    onChange: (change) => {
      if (change.error && link) link.message(`Home Assistant says no: ${change.error}`);
      setTimeout(() => link && link.sync(), 100);
    },
  });
  let link = null;
  let pending = [];
  // The size first, so the caller can lay out before the first frame.
  send({ t: 'ready', columns, rows });
  const engine = await DoomEngine.start({
    engineFactory: createEngine,
    wasmUrl: file('housewad-engine.wasm'),
    canvas: terminalCanvas(),
    files: { 'freedoom2.wad': iwad, 'house.wad': pwad },
    args: ['-iwad', 'freedoom2.wad', '-file', 'house.wad', '-warp', '1', '-skill', String(skill)],
    onHouseEvent: (...e) => (link ? link.onEvent(...e) : pending.push(e)),
    onFatal: (message) => fail(`The game stopped: ${message}`),
    beforeMain: (m) => m.ccall('hw_level_title', null, ['string'], [hudText(`MAP01: ${snapshot.config.location_name}`)]),
    print: (s) => process.stderr.write(`[housewad] ${s}\n`),
  });
  link = new HouseLink({
    engine,
    manifest,
    house,
    actions,
    rules: {},
    confirmUnlock: true,
    follow: false,
    palette: playpal(iwad),
    onConfirm: () => {},
    log: (s) => process.stderr.write(`[housewad] ${s}\n`),
  });
  for (const e of pending) link.onEvent(...e);
  pending = [];

  setInterval(() => link.tick(), 250);
  setInterval(() => link.sync(), 1000);
  let lastStatus = '';
  setInterval(() => {
    const s = link.status();
    const age = s.last ? Math.round((Date.now() - s.last.at) / 1000) : 0;
    const status = {
      t: 'status',
      room: s.room || '',
      aim: s.target || '',
      last: s.last ? `${s.last.text}${age > 2 ? ` (${age < 90 ? age + 's' : Math.round(age / 60) + 'm'} ago)` : ''}` : '',
      world: s.world || '',
    };
    const text = JSON.stringify(status);
    if (text !== lastStatus) {
      lastStatus = text;
      send(status);
    }
  }, 500);

  watchInput((m) => {
    if (m.t === 'key' && typeof m.key === 'string') press(engine, m.key);
    else if (m.t === 'reply') {
      const call = calls.get(m.id);
      if (!call) return;
      calls.delete(m.id);
      if (m.error) call.reject(new Error(m.error));
      else call.resolve(m.response || {});
    } else if (m.t === 'state' && m.entity_id) {
      const states = { ...hass.states };
      if (m.state) states[m.entity_id] = m.state;
      else delete states[m.entity_id];
      hass = { ...hass, states };
    } else if (m.t === 'quit') {
      engine.stop();
      process.exit(0);
    }
  });
}

main().catch((e) => fail(e && e.message ? e.message : e));
