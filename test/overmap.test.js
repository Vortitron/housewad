import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lightColour, kelvinToRgb, wallsFromLumps, joinStrips } from '../card/src/overmap.js';
import { encodeMap } from '../card/src/geometry.js';

test('a light that is off gives no colour', () => {
  assert.equal(lightColour({ state: 'off', attributes: { rgb_color: [255, 0, 0] } }), null);
  assert.equal(lightColour(undefined), null);
});

test("a light's colour: rgb, then colour temperature, else warm white", () => {
  assert.deepEqual(lightColour({ state: 'on', attributes: { rgb_color: [10, 20, 30], brightness: 255 } }), [10, 20, 30, 1]);
  const cool = lightColour({ state: 'on', attributes: { color_temp_kelvin: 6500 } });
  assert.ok(cool[2] > 240 && cool[0] > 240, 'daylight is near white');
  const candle = lightColour({ state: 'on', attributes: { color_temp: 500 } });
  assert.ok(candle[0] === 255 && candle[2] < 120, '2000 K (500 mireds) is orange');
  const plain = lightColour({ state: 'on', attributes: { brightness: 128 } });
  assert.deepEqual(plain.slice(0, 3), [255, 196, 120]);
  assert.ok(Math.abs(plain[3] - 128 / 255) < 1e-9, 'brightness is the strength');
  const red = lightColour({ state: 'on', attributes: { hs_color: [0, 100] } });
  assert.deepEqual(red.slice(0, 3), [255, 0, 0]);
});

test('colour temperature: warm is red-heavy, cool is blue-heavy', () => {
  const [r1, , b1] = kelvinToRgb(2700);
  const [r2, , b2] = kelvinToRgb(9000);
  assert.ok(r1 > b1 && b2 > r2);
});

test('walls and doors come out of the level itself', () => {
  const map = {
    things: [],
    vertices: [[0, 0], [64, 0], [64, 64], [0, 64]],
    sidedefs: [],
    sectors: [],
    linedefs: [
      { v1: 0, v2: 1, flags: 1, special: 0, tag: 0, front: 0, back: 0xffff },
      { v1: 1, v2: 2, flags: 4, special: 1, tag: 0, front: 0, back: 1 },
      { v1: 2, v2: 3, flags: 4, special: 0, tag: 0, front: 0, back: 1 },
    ],
  };
  const { walls, doors } = wallsFromLumps(encodeMap(map));
  assert.deepEqual(walls, [[0, 0, 64, 0]]);
  assert.deepEqual(doors, [[64, 0, 64, 64]], 'a door; the plain two-sided line is no wall');
});

test("the strip between two rects of one room is the room's too", () => {
  const strips = joinStrips([{ x1: 0, y1: 0, x2: 100, y2: 50 }, { x1: 108, y1: 10, x2: 200, y2: 80 }, { x1: 0, y1: 58, x2: 60, y2: 90 }]);
  assert.deepEqual(strips, [{ x1: 100, x2: 108, y1: 10, y2: 50 }, { y1: 50, y2: 58, x1: 0, x2: 60 }]);
});
