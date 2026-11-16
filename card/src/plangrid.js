// A plan's rooms as a grid, for finding where rooms meet: every x and y where
// a rect starts or ends, each cell owned by the room over its middle, and the
// runs of wall between two owners. Used to turn plans into Sweet Home 3D walls
// and back, and to give a plan its doors and stairs when it has none.

export const r2 = (v) => Math.round(v * 100) / 100;

export const norm = ([x1, y1, x2, y2]) => [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
export const uniq = (vals) => [...new Set(vals.map((v) => Math.round(v * 10000) / 10000))].sort((a, b) => a - b);

// A level as a grid: every x and y where a rect starts or ends, each cell
// owned by the room over its middle, or -1.
export function grid(rooms) {
  const xs = uniq(rooms.flatMap((r) => r.rects.flatMap((q) => [q[0], q[2]])));
  const ys = uniq(rooms.flatMap((r) => r.rects.flatMap((q) => [q[1], q[3]])));
  const owner = [];
  for (let j = 0; j < ys.length - 1; j++) {
    const row = [];
    const cy = (ys[j] + ys[j + 1]) / 2;
    for (let i = 0; i < xs.length - 1; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      row.push(rooms.findIndex((r) => r.rects.some((q) => cx > q[0] && cx < q[2] && cy > q[1] && cy < q[3])));
    }
    owner.push(row);
  }
  const own = (i, j) => (i < 0 || j < 0 || j >= ys.length - 1 || i >= xs.length - 1 ? -1 : owner[j][i]);
  return { xs, ys, own };
}

// Where two owners meet, as runs along a line: { dir: 'v' (x = at) or 'h'
// (y = at), at, from, to, a, b } (a left of / above b).
export function runs(g) {
  const { xs, ys, own } = g;
  const bits = [];
  for (let i = 0; i < xs.length; i++)
    for (let j = 0; j < ys.length - 1; j++) {
      const a = own(i - 1, j);
      const b = own(i, j);
      if (a !== b) bits.push({ dir: 'v', at: xs[i], from: ys[j], to: ys[j + 1], a, b });
    }
  for (let j = 0; j < ys.length; j++)
    for (let i = 0; i < xs.length - 1; i++) {
      const a = own(i, j - 1);
      const b = own(i, j);
      if (a !== b) bits.push({ dir: 'h', at: ys[j], from: xs[i], to: xs[i + 1], a, b });
    }
  const out = [];
  for (const e of bits) {
    const last = out[out.length - 1];
    if (last && last.dir === e.dir && last.at === e.at && last.a === e.a && last.b === e.b && Math.abs(last.to - e.from) < 1e-6) last.to = e.to;
    else out.push({ ...e });
  }
  return out;
}

// Intervals [lo, hi] on a line.
export function union(list) {
  const s = list.filter(([lo, hi]) => hi - lo > 1e-6).sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const [lo, hi] of s) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1e-6) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}
export function subtract(from, cuts) {
  let out = union(from);
  for (const [clo, chi] of union(cuts)) {
    out = out.flatMap(([lo, hi]) => (chi <= lo || clo >= hi ? [[lo, hi]] : [[lo, clo], [chi, hi]].filter(([a, b]) => b - a > 1e-6)));
  }
  return out;
}
export const total = (list) => list.reduce((s, [lo, hi]) => s + hi - lo, 0);
export const clip = (list, lo, hi) => list.map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)]).filter(([a, b]) => b - a > 1e-6);

// A door's "at" ([[x, y], [x, y]]) as a line and an interval.
export function segment(at) {
  const [[ax, ay], [bx, by]] = at;
  return Math.abs(ax - bx) < Math.abs(ay - by)
    ? { dir: 'v', at: (ax + bx) / 2, lo: Math.min(ay, by), hi: Math.max(ay, by) }
    : { dir: 'h', at: (ay + by) / 2, lo: Math.min(ax, bx), hi: Math.max(ax, bx) };
}
export const atOf = (dir, at, lo, hi) => (dir === 'v' ? [[r2(at), r2(lo)], [r2(at), r2(hi)]] : [[r2(lo), r2(at)], [r2(hi), r2(at)]]);

