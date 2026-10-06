// house.wad in a terminal: the Node host builds the level and sends frames.
// Needs the built engine and game data in dist/ (npm run build); skipped
// without them, as on a checkout that has not built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeFakeHass } from '../tools/harness/fakehass.js';

const dist = new URL('../dist/', import.meta.url).pathname;
const built = ['housewad-term.mjs', 'housewad-engine.wasm', 'freedoom2.wad'].every((f) => existsSync(join(dist, f)));

test('the terminal host sends its size, then frames of half-block cells', { skip: !built && 'not built' }, async () => {
  const hass = makeFakeHass(() => {});
  const values = (o) => Object.values(o || {});
  const snapshot = JSON.stringify({
    floors: values(hass.floors), areas: values(hass.areas), devices: values(hass.devices),
    entities: values(hass.entities), states: values(hass.states), location_name: 'Test House',
  });
  const input = mkdtempSync(join(tmpdir(), 'housewad-'));
  const child = spawn(process.execPath, [join(dist, 'housewad-term.mjs'), '--assets', dist, '--input', input, '--columns', '80', '--rows', '30']);
  child.stdin.end(snapshot);
  const messages = [];
  let text = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no frames: ${JSON.stringify(messages.slice(0, 3))}`)), 20000);
    child.stdout.on('data', (chunk) => {
      text += chunk;
      const lines = text.split('\n');
      text = lines.pop();
      for (const line of lines) messages.push(JSON.parse(line));
      if (messages.filter((m) => m.t === 'frame').length >= 3) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  writeFileSync(join(input, '000001.json'), '{"t":"quit"}\n');
  child.kill();
  assert.equal(messages[0].t, 'ready');
  const { columns, rows } = messages[0];
  assert.equal(columns, 80);
  const frame = Buffer.from(messages.find((m) => m.t === 'frame').cells, 'base64');
  assert.equal(frame.length, columns * rows * 12);
  assert.equal(frame.readUInt32LE(0), 0x2580);
  assert.ok(!messages.some((m) => m.t === 'error'), JSON.stringify(messages.find((m) => m.t === 'error')));
});
