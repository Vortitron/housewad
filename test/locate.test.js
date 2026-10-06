import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trilaterate, keepInside, radarPoint, Smooth } from '../card/src/locate.js';

const near = (p, q, tol, msg) => assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol, `${msg}: ${p.map(Math.round)} vs ${q}`);

test('three listeners: the point that fits their distances', () => {
  const truth = [300, 200];
  const anchors = [[0, 0], [600, 0], [300, 600]].map(([x, y]) => ({ x, y, d: Math.hypot(truth[0] - x, truth[1] - y) }));
  near(trilaterate(anchors, [100, 100]), truth, 4, 'exact distances');
  // Bluetooth is never exact: 15% out each way still lands close.
  const noisy = anchors.map((a, i) => ({ ...a, d: a.d * [1.15, 0.85, 1.1][i] }));
  near(trilaterate(noisy, [100, 100]), truth, 90, 'noisy distances');
});

test('one listener: on its circle, the side we were on', () => {
  const p = trilaterate([{ x: 0, y: 0, d: 200 }], [50, 0]);
  near(p, [200, 0], 1, 'one listener');
});

test('nothing to go on: stay where we were', () => {
  assert.deepEqual(trilaterate([], [10, 20]), [10, 20]);
  assert.equal(trilaterate([], null), null);
});

test('a point is kept inside the room', () => {
  const rects = [{ x1: 0, y1: 0, x2: 400, y2: 300 }];
  assert.deepEqual(keepInside([900, 150], rects), [368, 150]);
  assert.deepEqual(keepInside([100, 100], rects), [100, 100]);
});

test('radar readings become map points', () => {
  // An LD2410 facing east, 2 m (128 units) away.
  near(radarPoint([0, 0], 0, { distance: 128 }), [128, 0], 0.01, 'straight ahead');
  // An LD2450 facing north (90): 1 m ahead, 1 m to its right (east).
  near(radarPoint([0, 0], 90, { x: 64, y: 64 }), [64, 64], 0.01, 'ahead and to the right');
});

test('smoothing walks rather than jumps', () => {
  const s = new Smooth(0.25);
  s.next([0, 0]);
  const p = s.next([400, 0]);
  assert.equal(p[0], 100, 'a quarter of the way');
  for (let i = 0; i < 30; i++) s.next([400, 0]);
  near(s.p, [400, 0], 1, 'and gets there');
});
