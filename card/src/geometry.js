// Polygon-to-Doom-map builder.
//
// Sectors are added as non-overlapping polygons. build() splits every edge at
// any vertex lying on it (so T-junctions line up), pairs opposite edges into
// two-sided linedefs and leaves the rest one-sided. "Features" are segments
// that give the lines lying on them special attributes: a switch texture, a
// line special, a door face.

export const ML = {
  BLOCKING: 1,
  BLOCKMONSTERS: 2,
  TWOSIDED: 4,
  DONTPEGTOP: 8,
  DONTPEGBOTTOM: 16,
  SECRET: 32,
  SOUNDBLOCK: 64,
  DONTDRAW: 128,
  MAPPED: 256,
};

const key = (p) => `${p[0]},${p[1]}`;

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

// Is p on segment a-b, strictly between the ends?
function between(a, b, p) {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (cross !== 0) return false;
  const dot = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]);
  const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  return dot > 0 && dot < len2;
}

// Does segment s (a sub-edge) lie within feature segment f, in either direction?
function within(f, a, b) {
  const on = (p) =>
    (p[0] === f.a[0] && p[1] === f.a[1]) || (p[0] === f.b[0] && p[1] === f.b[1]) || between(f.a, f.b, p);
  return on(a) && on(b);
}

export class MapBuilder {
  constructor() {
    this.sectors = [];
    this.polys = [];
    this.features = [];
    this.things = [];
  }

  // props: floor, ceil, floorTex, ceilTex, light, special, tag, wall, riser, priority
  addSector(props) {
    this.sectors.push({
      floor: 0,
      ceil: 128,
      floorTex: 'FLOOR0_1',
      ceilTex: 'CEIL3_5',
      light: 160,
      special: 0,
      tag: 0,
      wall: 'STARTAN2',
      riser: null,
      priority: 1,
      ...props,
    });
    return this.sectors.length - 1;
  }

  addPoly(sector, pts) {
    const p = pts.map((q) => [Math.round(q[0]), Math.round(q[1])]);
    // Doom puts a linedef's front side on its right: clockwise with y up.
    if (signedArea(p) > 0) p.reverse();
    this.polys.push({ sector, pts: p });
  }

  addRect(sector, x1, y1, x2, y2) {
    const [ax, bx] = [Math.min(x1, x2), Math.max(x1, x2)];
    const [ay, by] = [Math.min(y1, y2), Math.max(y1, y2)];
    this.addPoly(sector, [
      [ax, ay],
      [ax, by],
      [bx, by],
      [bx, ay],
    ]);
  }

  // attrs: special, tag, flags, tex (front side; mid if one-sided, upper and
  // lower if two-sided), upper, lower, mid, frontSector (preferred front), ref
  addFeature(a, b, attrs) {
    this.features.push({ a: [Math.round(a[0]), Math.round(a[1])], b: [Math.round(b[0]), Math.round(b[1])], attrs });
  }

  addThing(x, y, type, angle = 0, flags = 7) {
    this.things.push({ x: Math.round(x), y: Math.round(y), type, angle, flags });
    return this.things.length - 1;
  }

  build() {
    // Every vertex any polygon or feature uses is a potential split point.
    const points = new Map();
    for (const poly of this.polys) for (const p of poly.pts) points.set(key(p), p);
    for (const f of this.features) {
      points.set(key(f.a), f.a);
      points.set(key(f.b), f.b);
    }
    const allPoints = [...points.values()];

    // Directed sub-edges keyed "x1,y1>x2,y2".
    const edges = new Map();
    for (const poly of this.polys) {
      const n = poly.pts.length;
      for (let i = 0; i < n; i++) {
        const a = poly.pts[i];
        const b = poly.pts[(i + 1) % n];
        const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
        const cuts = allPoints
          .filter((p) => between(a, b, p))
          .map((p) => ({ p, t: ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / len2 }))
          .sort((x, y) => x.t - y.t)
          .map((c) => c.p);
        const chain = [a, ...cuts, b];
        for (let j = 0; j < chain.length - 1; j++) {
          const k = `${key(chain[j])}>${key(chain[j + 1])}`;
          if (edges.has(k)) throw new Error(`overlapping sectors at ${k}`);
          edges.set(k, { a: chain[j], b: chain[j + 1], sector: poly.sector });
        }
      }
    }

    const vertices = [];
    const vertexIndex = new Map();
    const vtx = (p) => {
      const k = key(p);
      if (!vertexIndex.has(k)) {
        vertexIndex.set(k, vertices.length);
        vertices.push(p);
      }
      return vertexIndex.get(k);
    };

    const sidedefs = [];
    const linedefs = [];
    const done = new Set();
    for (const [k, e] of edges) {
      if (done.has(k)) continue;
      done.add(k);
      const rk = `${key(e.b)}>${key(e.a)}`;
      const other = edges.get(rk);
      if (other) done.add(rk);
      const feature = this.features.find((f) => within(f, e.a, e.b));
      const attrs = feature ? feature.attrs : {};

      let front = e;
      let back = other || null;
      if (back) {
        const pf = attrs.frontSector !== undefined ? (front.sector === attrs.frontSector ? 1 : -1) : 0;
        const sf = this.sectors[front.sector].priority;
        const sb = this.sectors[back.sector].priority;
        if (pf < 0 || (pf === 0 && sb > sf)) [front, back] = [back, front];
      }

      const fs = this.sectors[front.sector];
      const bs = back ? this.sectors[back.sector] : null;
      let flags = attrs.flags || 0;
      const frontSide = {
        xoff: attrs.xoff || 0,
        yoff: attrs.yoff || 0,
        upper: '-',
        lower: '-',
        mid: '-',
        sector: front.sector,
      };
      if (!back) {
        flags |= ML.BLOCKING;
        frontSide.mid = attrs.mid || attrs.tex || fs.wall;
      } else {
        flags |= ML.TWOSIDED;
        frontSide.upper = attrs.upper || attrs.tex || fs.wall;
        frontSide.lower = attrs.lower || attrs.tex || bs.riser || fs.wall;
        if (attrs.mid) frontSide.mid = attrs.mid;
      }
      const frontIndex = sidedefs.push(frontSide) - 1;
      let backIndex = 0xffff;
      if (back) {
        backIndex =
          sidedefs.push({
            xoff: 0,
            yoff: 0,
            upper: attrs.backUpper || attrs.backTex || bs.wall,
            lower: attrs.backLower || attrs.backTex || fs.riser || bs.wall,
            mid: '-',
            sector: back.sector,
          }) - 1;
      }
      linedefs.push({
        v1: vtx(front.a),
        v2: vtx(front.b),
        flags,
        special: attrs.special || 0,
        tag: attrs.tag || 0,
        front: frontIndex,
        back: backIndex,
        ref: attrs.ref,
      });
    }

    return { vertices, linedefs, sidedefs, sectors: this.sectors, things: this.things };
  }
}

// Encode a built map as Doom-format lumps (without nodes).
export function encodeMap(map, name = 'MAP01') {
  const enc = (count, size, fill) => {
    const data = new Uint8Array(count * size);
    const view = new DataView(data.buffer);
    for (let i = 0; i < count; i++) fill(view, i * size, i, data);
    return data;
  };
  const name8 = (data, at, s) => {
    for (let i = 0; i < 8; i++) data[at + i] = i < s.length ? s.toUpperCase().charCodeAt(i) : 0;
  };
  const things = enc(map.things.length, 10, (v, o, i) => {
    const t = map.things[i];
    v.setInt16(o, t.x, true);
    v.setInt16(o + 2, t.y, true);
    v.setInt16(o + 4, t.angle, true);
    v.setInt16(o + 6, t.type, true);
    v.setInt16(o + 8, t.flags, true);
  });
  const linedefs = enc(map.linedefs.length, 14, (v, o, i) => {
    const l = map.linedefs[i];
    v.setUint16(o, l.v1, true);
    v.setUint16(o + 2, l.v2, true);
    v.setUint16(o + 4, l.flags, true);
    v.setUint16(o + 6, l.special, true);
    v.setUint16(o + 8, l.tag, true);
    v.setUint16(o + 10, l.front, true);
    v.setUint16(o + 12, l.back, true);
  });
  const sidedefs = enc(map.sidedefs.length, 30, (v, o, i, d) => {
    const s = map.sidedefs[i];
    v.setInt16(o, s.xoff, true);
    v.setInt16(o + 2, s.yoff, true);
    name8(d, o + 4, s.upper);
    name8(d, o + 12, s.lower);
    name8(d, o + 20, s.mid);
    v.setInt16(o + 28, s.sector, true);
  });
  const vertexes = enc(map.vertices.length, 4, (v, o, i) => {
    v.setInt16(o, map.vertices[i][0], true);
    v.setInt16(o + 2, map.vertices[i][1], true);
  });
  const sectors = enc(map.sectors.length, 26, (v, o, i, d) => {
    const s = map.sectors[i];
    v.setInt16(o, s.floor, true);
    v.setInt16(o + 2, s.ceil, true);
    name8(d, o + 4, s.floorTex);
    name8(d, o + 12, s.ceilTex);
    v.setInt16(o + 20, s.light, true);
    v.setInt16(o + 22, s.special, true);
    v.setInt16(o + 24, s.tag, true);
  });
  const empty = new Uint8Array(0);
  return [
    { name, data: empty },
    { name: 'THINGS', data: things },
    { name: 'LINEDEFS', data: linedefs },
    { name: 'SIDEDEFS', data: sidedefs },
    { name: 'VERTEXES', data: vertexes },
    { name: 'SEGS', data: empty },
    { name: 'SSECTORS', data: empty },
    { name: 'NODES', data: empty },
    { name: 'SECTORS', data: sectors },
    { name: 'REJECT', data: empty },
    { name: 'BLOCKMAP', data: empty },
  ];
}
