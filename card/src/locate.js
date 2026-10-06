// Where in a room somebody is.
//
// Bluetooth gives a distance from each listener that hears a phone; none of
// them is exact (a body in the way, a wall, a phone in a pocket), so the
// point that best fits all of them is the answer, nearer listeners counting
// for more. A radar gives a far better point, when there is one. Either way
// the result is kept inside the room Bermuda says the person is in, and
// smoothed, so the person walks about the room rather than jumping.

// anchors: [{ x, y, d }] in map units. prior: the last estimate, or the
// middle of the room, to start from (and to break ties with one listener).
export function trilaterate(anchors, prior) {
  const usable = anchors.filter((a) => Number.isFinite(a.d) && a.d >= 0);
  if (!usable.length) return prior ? [...prior] : null;
  const start = prior ? [...prior] : centroid(usable);
  if (usable.length === 1) {
    // One listener: somewhere on a circle round it; the bit nearest where we were.
    const [a] = usable;
    const dx = start[0] - a.x;
    const dy = start[1] - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return [a.x + (dx / len) * a.d, a.y + (dy / len) * a.d];
  }
  // Weighted least squares on the distances, by gradient descent: small,
  // stable and good enough for numbers this noisy.
  const w = usable.map((a) => 1 / Math.max(a.d, 32) ** 2);
  let [x, y] = start;
  for (let it = 0; it < 60; it++) {
    let gx = 0;
    let gy = 0;
    let wsum = 0;
    usable.forEach((a, i) => {
      const dx = x - a.x;
      const dy = y - a.y;
      const r = Math.hypot(dx, dy) || 1;
      const err = r - a.d;
      gx += w[i] * err * (dx / r);
      gy += w[i] * err * (dy / r);
      wsum += w[i];
    });
    x -= (gx / wsum) * 0.5;
    y -= (gy / wsum) * 0.5;
  }
  return [x, y];
}

function centroid(anchors) {
  const w = anchors.map((a) => 1 / Math.max(a.d, 32));
  const sum = w.reduce((s, v) => s + v, 0);
  return [anchors.reduce((s, a, i) => s + a.x * w[i], 0) / sum, anchors.reduce((s, a, i) => s + a.y * w[i], 0) / sum];
}

// The nearest point inside a room (its rects), margin units in from the walls.
export function keepInside(p, rects, margin = 32) {
  let best = null;
  for (const r of rects) {
    const lo = [r.x1 + margin, r.y1 + margin];
    const hi = [r.x2 - margin, r.y2 - margin];
    const q = [lo[0] > hi[0] ? (r.x1 + r.x2) / 2 : Math.min(hi[0], Math.max(lo[0], p[0])), lo[1] > hi[1] ? (r.y1 + r.y2) / 2 : Math.min(hi[1], Math.max(lo[1], p[1]))];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (!best || d < best.d) best = { q, d };
  }
  return best ? best.q : p;
}

// A radar's reading as a point on the map. at: where it is; facing: degrees
// it looks (map angle); target: { distance } (an LD2410: straight ahead) or
// { x, y } (an LD2450: x across, y ahead of it), all in map units.
export function radarPoint(at, facing, target) {
  const a = (facing * Math.PI) / 180;
  if (target.x === undefined) return [at[0] + Math.cos(a) * target.distance, at[1] + Math.sin(a) * target.distance];
  // y is straight ahead; x is to the radar's right, which on the map is a
  // quarter turn clockwise of ahead (y up, so -90 degrees).
  const ahead = [Math.cos(a), Math.sin(a)];
  const right = [Math.cos(a - Math.PI / 2), Math.sin(a - Math.PI / 2)];
  return [at[0] + ahead[0] * target.y + right[0] * target.x, at[1] + ahead[1] * target.y + right[1] * target.x];
}

// Eases towards each new estimate, so a noisy reading becomes a stroll.
export class Smooth {
  constructor(alpha = 0.3) {
    this.alpha = alpha;
    this.p = null;
  }
  next(p) {
    if (!p) return this.p;
    if (!this.p) this.p = [...p];
    else this.p = [this.p[0] + (p[0] - this.p[0]) * this.alpha, this.p[1] + (p[1] - this.p[1]) * this.alpha];
    return this.p;
  }
  reset() {
    this.p = null;
  }
}
