// Sweet Home 3D (.sh3d) files, both ways.
//
// Sweet Home 3D (sweethome3d.com, free) is the easy way to draw a house: a
// .sh3d file is a zip, and since version 5.3 it holds the home as Home.xml,
// which is what is read and written here. Out: each room becomes a Sweet
// Home 3D room (its outline), walls go wherever two rooms (or a room and
// outside) meet, with a gap at every door, gardens are rooms without a
// ceiling, levels stack at their floor heights, and Bluetooth listeners,
// radars and the start are labels. In: the same, read back; a door is a gap
// in a wall or a door from Sweet Home 3D's catalogue, rooms with no wall
// between them are open to each other, and a room drawn inside its walls
// (as Sweet Home 3D draws them) is taken out to the middle of the walls.
//
// What Sweet Home 3D has no place for (the Home Assistant area of a room,
// stairs, the tablets that listen for phones, ...) rides along in the file
// as properties, so a plan that goes out and comes back is the same plan,
// with whatever was moved in Sweet Home 3D moved.

import { writeZip, readZip } from './zip.js';

const MIN_DOOR = 0.5; // metres: narrower gaps are cracks, not doors
const r2 = (v) => Math.round(v * 100) / 100;
const cm = (m) => Math.round(m * 1000) / 10;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'room';

// Shared geometry ----------------------------------------------------------

const norm = ([x1, y1, x2, y2]) => [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
const uniq = (vals) => [...new Set(vals.map((v) => Math.round(v * 10000) / 10000))].sort((a, b) => a - b);

// A level as a grid: every x and y where a rect starts or ends, each cell
// owned by the room over its middle, or -1.
function grid(rooms) {
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
function runs(g) {
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
function union(list) {
  const s = list.filter(([lo, hi]) => hi - lo > 1e-6).sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const [lo, hi] of s) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1e-6) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}
function subtract(from, cuts) {
  let out = union(from);
  for (const [clo, chi] of union(cuts)) {
    out = out.flatMap(([lo, hi]) => (chi <= lo || clo >= hi ? [[lo, hi]] : [[lo, clo], [chi, hi]].filter(([a, b]) => b - a > 1e-6)));
  }
  return out;
}
const total = (list) => list.reduce((s, [lo, hi]) => s + hi - lo, 0);
const clip = (list, lo, hi) => list.map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)]).filter(([a, b]) => b - a > 1e-6);

// A door's "at" ([[x, y], [x, y]]) as a line and an interval.
function segment(at) {
  const [[ax, ay], [bx, by]] = at;
  return Math.abs(ax - bx) < Math.abs(ay - by)
    ? { dir: 'v', at: (ax + bx) / 2, lo: Math.min(ay, by), hi: Math.max(ay, by) }
    : { dir: 'h', at: (ay + by) / 2, lo: Math.min(ax, bx), hi: Math.max(ax, bx) };
}
const atOf = (dir, at, lo, hi) => (dir === 'v' ? [[r2(at), r2(lo)], [r2(at), r2(hi)]] : [[r2(lo), r2(at)], [r2(hi), r2(at)]]);

// A room's outline(s) from its cells, as point lists (outer edges only).
function outlines(g, k) {
  const { xs, ys, own } = g;
  const segs = [];
  for (let j = 0; j < ys.length - 1; j++)
    for (let i = 0; i < xs.length - 1; i++) {
      if (own(i, j) !== k) continue;
      const [x0, x1, y0, y1] = [xs[i], xs[i + 1], ys[j], ys[j + 1]];
      if (own(i, j - 1) !== k) segs.push([x0, y0, x1, y0]);
      if (own(i + 1, j) !== k) segs.push([x1, y0, x1, y1]);
      if (own(i, j + 1) !== k) segs.push([x1, y1, x0, y1]);
      if (own(i - 1, j) !== k) segs.push([x0, y1, x0, y0]);
    }
  const key = (x, y) => `${x},${y}`;
  const from = new Map();
  segs.forEach((s, n) => from.set(key(s[0], s[1]), [...(from.get(key(s[0], s[1])) || []), n]));
  const used = new Set();
  const loops = [];
  segs.forEach((_, start) => {
    if (used.has(start)) return;
    const loop = [];
    let cur = start;
    while (cur !== undefined && !used.has(cur)) {
      used.add(cur);
      const [x0, y0, x1, y1] = segs[cur];
      loop.push([x0, y0]);
      cur = (from.get(key(x1, y1)) || []).find((n) => !used.has(n));
    }
    // Corners only: drop points in the middle of a straight side.
    const pts = loop.filter((p, i) => {
      const a = loop[(i + loop.length - 1) % loop.length];
      const c = loop[(i + 1) % loop.length];
      return !((a[0] === p[0] && p[0] === c[0]) || (a[1] === p[1] && p[1] === c[1]));
    });
    const area = pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0);
    if (pts.length >= 3 && area > 0) loops.push(pts);
  });
  return loops;
}

// Plan -> Sweet Home 3D ------------------------------------------------------

function levelRooms(plan, key) {
  return plan.rooms.filter((r) => (r.level || '') === key).map((r) => ({ ...r, rects: r.rects.map(norm) }));
}

export function planToHomeXml(plan, name = 'House') {
  const keys = ['', ...Object.keys(plan.levels || {})];
  const floorOf = (k) => (k ? Number(plan.levels[k].floor) || 0 : 0);
  const base = Math.min(...keys.map(floorOf));
  const multi = keys.length > 1;
  const lid = (k) => (k ? `level_${slug(k)}` : 'level_main');
  const levelAttr = (k) => (multi ? ` level='${lid(k)}'` : '');
  const open = new Set((plan.open || []).map((p) => [...p].sort().join('|')));
  const out = [`<?xml version='1.0'?>`, `<home version='6000' name='${esc(name)}' camera='topCamera'${multi ? ` selectedLevel='${lid('')}'` : ''} wallHeight='250'>`];
  out.push(`<property name='housewad.plan' value='${esc(JSON.stringify(plan))}'/>`);
  if (multi)
    keys.forEach((k, i) => {
      const rooms = levelRooms(plan, k);
      const height = Math.max(2.4, ...rooms.filter((r) => !r.outdoor).map((r) => r.height || 2.4));
      const label = k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Main floor';
      out.push(`<level id='${lid(k)}' name='${esc(label)}' elevation='${cm(floorOf(k) - base)}' floorThickness='12' height='${cm(height)}' elevationIndex='${i}'><property name='housewad.level' value='${esc(k)}'/></level>`);
    });
  const walls = [];
  const rooms = [];
  const labels = [];
  let n = 0;
  for (const k of keys) {
    const lr = levelRooms(plan, k);
    if (!lr.length) continue;
    const g = grid(lr);
    const gaps = [...(plan.doors || []), ...(plan.exits || [])]
      .filter((d) => {
        const r = lr.find((q) => q.id === (d.rooms ? d.rooms[0] : d.room));
        return !!r;
      })
      .map((d) => segment(d.at));
    for (const e of runs(g)) {
      const A = e.a >= 0 ? lr[e.a] : null;
      const B = e.b >= 0 ? lr[e.b] : null;
      // Gardens end where they end: no fence round the edge of the plan.
      if ((!A && B.outdoor) || (!B && A.outdoor)) continue;
      if (A && B && open.has([A.id, B.id].sort().join('|'))) continue;
      const indoor = [A, B].filter((r) => r && !r.outdoor);
      const height = indoor.length ? Math.max(...indoor.map((r) => r.height || 2.4)) : 1;
      const thick = !A || !B || A.outdoor !== B.outdoor ? 0.2 : 0.1;
      const cuts = gaps.filter((s) => s.dir === e.dir && Math.abs(s.at - e.at) < 0.06).map((s) => [s.lo, s.hi]);
      for (const [lo, hi] of subtract([[e.from, e.to]], cuts)) {
        const [x1, y1, x2, y2] = e.dir === 'v' ? [e.at, lo, e.at, hi] : [lo, e.at, hi, e.at];
        walls.push(`<wall id='wall_${++n}'${levelAttr(k)} xStart='${cm(x1)}' yStart='${cm(y1)}' xEnd='${cm(x2)}' yEnd='${cm(y2)}' height='${cm(height)}' thickness='${cm(thick)}' pattern='hatchUp'/>`);
      }
    }
    lr.forEach((r, i) => {
      for (const pts of outlines(g, i)) {
        const props = [['housewad.id', r.id], ['housewad.area', r.area], ['housewad.height', r.height], ['housewad.outdoor', r.outdoor ? 'true' : null]]
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([p, v]) => `<property name='${p}' value='${esc(v)}'/>`)
          .join('');
        const look = r.outdoor ? ` ceilingVisible='false' floorColor='FF6E8B3D'` : '';
        rooms.push(`<room id='room_${++n}'${levelAttr(k)} name='${esc(r.name || r.id)}' areaVisible='true'${look}>${props}${pts.map(([x, y]) => `<point x='${cm(x)}' y='${cm(y)}'/>`).join('')}</room>`);
      }
    });
  }
  const label = (k, x, y, text) => labels.push(`<label id='label_${++n}'${levelAttr(k)} x='${cm(x)}' y='${cm(y)}'><text>${esc(text)}</text></label>`);
  for (const [who, where] of Object.entries(plan.scanners || {})) {
    const at = Array.isArray(where) ? where : where.at;
    if (at) label(Array.isArray(where) ? '' : where.level || '', at[0], at[1], `BLE: ${who}`);
  }
  for (const r of plan.radars || []) label(r.level || '', r.at[0], r.at[1], `Radar: ${r.radar} facing ${r.facing || 0}`);
  if (plan.start && plan.start.at) {
    const room = plan.rooms.find((r) => r.id === plan.start.room);
    label((room && room.level) || '', plan.start.at[0], plan.start.at[1], 'Start');
  }
  out.push(...walls, ...rooms, ...labels, '</home>');
  return out.join('\n');
}

export function planToSh3d(plan, name) {
  return writeZip([{ name: 'Home.xml', data: new TextEncoder().encode(planToHomeXml(plan, name)) }]);
}

// Sweet Home 3D -> plan --------------------------------------------------------

// Enough XML for Home.xml: elements, attributes, text.
export function parseXml(text) {
  const unescape = (s) =>
    s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()];
    });
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[3]) {
      if (m[2] === '/') {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const attrs = {};
      for (const a of m[4].matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unescape(a[2] !== undefined ? a[2] : a[3]);
      const el = { name: m[3], attrs, children: [], text: '' };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined) top.text += unescape(m[6]);
  }
  return root;
}

const all = (el, name) => el.children.flatMap((c) => (c.name === name ? [c] : all(c, name)));
const propsOf = (el) => Object.fromEntries(el.children.filter((c) => c.name === 'property').map((c) => [c.attrs.name, c.attrs.value]));
const num = (v, d = 0) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

function pointIn(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// A polygon (metres) as rects: a grid on its corners (finer where a side
// slants), the cells inside it, merged into rows and then down.
export function polygonToRects(pts) {
  const xs = new Set(pts.map((p) => p[0]));
  const ys = new Set(pts.map((p) => p[1]));
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    if (Math.abs(p[0] - q[0]) > 1e-6 && Math.abs(p[1] - q[1]) > 1e-6) {
      for (let x = Math.min(p[0], q[0]); x < Math.max(p[0], q[0]); x += 0.25) xs.add(x);
      for (let y = Math.min(p[1], q[1]); y < Math.max(p[1], q[1]); y += 0.25) ys.add(y);
    }
  });
  const X = uniq([...xs]);
  const Y = uniq([...ys]);
  const inside = (x, y) => pointIn(pts, x, y);
  const rects = [];
  let open = new Map(); // "i0,i1" -> rect being grown downwards
  for (let j = 0; j < Y.length - 1; j++) {
    const cy = (Y[j] + Y[j + 1]) / 2;
    const row = [];
    let start = -1;
    for (let i = 0; i <= X.length - 1; i++) {
      const on = i < X.length - 1 && inside((X[i] + X[i + 1]) / 2, cy);
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        row.push(`${start},${i}`);
        start = -1;
      }
    }
    const next = new Map();
    for (const k of row) {
      const [i0, i1] = k.split(',').map(Number);
      const r = open.get(k) || { x1: X[i0], x2: X[i1], y1: Y[j] };
      r.y2 = Y[j + 1];
      next.set(k, r);
    }
    for (const [k, r] of open) if (!next.has(k)) rects.push(r);
    open = next;
  }
  rects.push(...open.values());
  return rects.map((r) => [r2(r.x1), r2(r.y1), r2(r.x2), r2(r.y2)]);
}

export async function sh3dToPlan(bytes, previous = null) {
  const files = await readZip(bytes);
  const xml = files.get('Home.xml');
  if (!xml) throw new Error(files.has('Home') ? 'this file is from an old Sweet Home 3D (before 5.3): open it in a newer one and save it again' : 'not a Sweet Home 3D file (there is no Home.xml in it)');
  return homeXmlToPlan(new TextDecoder().decode(xml), previous);
}

export function homeXmlToPlan(xml, previous = null) {
  const home = parseXml(xml).children.find((c) => c.name === 'home');
  if (!home) throw new Error('no <home> in Home.xml');
  let meta = previous || {};
  try {
    const saved = propsOf(home)['housewad.plan'];
    if (saved) meta = JSON.parse(saved);
  } catch (e) {
    // a damaged property: what the file draws is still the plan
  }
  const metaRooms = meta.rooms || [];
  const wallHeight = num(home.attrs.wallHeight, 250) / 100;

  // Levels: the one marked main (or with the most room) is the plan's own.
  const levels = home.children.filter((c) => c.name === 'level').map((l) => ({ id: l.attrs.id, name: l.attrs.name || l.attrs.id, elev: num(l.attrs.elevation) / 100, height: num(l.attrs.height, 250) / 100, key: propsOf(l)['housewad.level'] }));
  const rawRooms = home.children
    .filter((c) => c.name === 'room')
    .map((r) => ({ el: r, level: r.attrs.level || null, name: r.attrs.name || '', ceiling: r.attrs.ceilingVisible !== 'false', props: propsOf(r), pts: r.children.filter((c) => c.name === 'point').map((p) => [num(p.attrs.x) / 100, num(p.attrs.y) / 100]) }))
    .filter((r) => r.pts.length >= 3);
  const polyArea = (pts) => Math.abs(pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0)) / 2;
  let main = levels.find((l) => l.key === '');
  if (!main && levels.length) main = [...levels].sort((p, q) => rawRooms.filter((r) => r.level === q.id).reduce((s, r) => s + polyArea(r.pts), 0) - rawRooms.filter((r) => r.level === p.id).reduce((s, r) => s + polyArea(r.pts), 0))[0];
  const keyOf = new Map();
  const takenKeys = new Set(['']);
  for (const l of levels) {
    if (l === main) {
      keyOf.set(l.id, '');
      continue;
    }
    let k = l.key || slug(l.name);
    while (takenKeys.has(k)) k += '_';
    takenKeys.add(k);
    keyOf.set(l.id, k);
  }
  const levelKey = (id) => (id && keyOf.has(id) ? keyOf.get(id) : '');

  const walls = all(home, 'wall').map((w) => ({
    level: levelKey(w.attrs.level),
    x1: num(w.attrs.xStart) / 100,
    y1: num(w.attrs.yStart) / 100,
    x2: num(w.attrs.xEnd) / 100,
    y2: num(w.attrs.yEnd) / 100,
    thick: num(w.attrs.thickness, 10) / 100,
    height: num(w.attrs.height, wallHeight * 100) / 100,
  }));
  // Doors from the catalogue (windows sit higher up the wall: not doors).
  const pieces = all(home, 'doorOrWindow')
    .filter((d) => num(d.attrs.elevation) < 30)
    .map((d) => {
      const a = num(d.attrs.angle);
      const w = num(d.attrs.width, 90) / 100;
      const x = num(d.attrs.x) / 100;
      const y = num(d.attrs.y) / 100;
      const dx = (Math.cos(a) * w) / 2;
      const dy = (Math.sin(a) * w) / 2;
      return { level: levelKey(d.attrs.level), name: d.attrs.name, depth: num(d.attrs.depth, 20) / 100, seg: segment([[x - dx, y - dy], [x + dx, y + dy]]) };
    });
  const labels = all(home, 'label').map((l) => ({ level: levelKey(l.attrs.level), x: num(l.attrs.x) / 100, y: num(l.attrs.y) / 100, text: (l.children.find((c) => c.name === 'text') || l).text.trim() }));

  // Rooms: rects, out to the middle of the walls round them.
  const usedIds = new Set();
  const rooms = rawRooms.map((r, n) => {
    const level = levelKey(r.level);
    const byName = metaRooms.filter((m) => (m.name || m.id) === r.name);
    const before = metaRooms.find((m) => m.id === r.props['housewad.id']) || (byName.length === 1 ? byName[0] : null);
    let id = r.props['housewad.id'] || (before && before.id) || slug(r.name || `room_${n + 1}`);
    // A room drawn in two pieces is still one room.
    const twin = r.props['housewad.id'] && usedIds.has(id);
    if (!twin) {
      while (usedIds.has(id)) id += '_';
      usedIds.add(id);
    }
    // Only outwards, and only on the room's own outline (not where two of
    // its rects meet).
    const inRoom = (x, y) => pointIn(r.pts, x, y);
    const rects = polygonToRects(r.pts).map((q) => {
      const s = [...q];
      const my = (s[1] + s[3]) / 2;
      const mx = (s[0] + s[2]) / 2;
      for (const w of walls.filter((w) => w.level === level)) {
        const reach = w.thick / 2 + 0.03;
        if (Math.abs(w.x1 - w.x2) < 0.01) {
          const overlap = Math.min(s[3], Math.max(w.y1, w.y2)) - Math.max(s[1], Math.min(w.y1, w.y2));
          if (overlap <= 0.05) continue;
          if (w.x1 <= s[0] + 0.005 && s[0] - w.x1 <= reach && !inRoom(s[0] - 0.01, my)) s[0] = r2(w.x1);
          if (w.x1 >= s[2] - 0.005 && w.x1 - s[2] <= reach && !inRoom(s[2] + 0.01, my)) s[2] = r2(w.x1);
        } else if (Math.abs(w.y1 - w.y2) < 0.01) {
          const overlap = Math.min(s[2], Math.max(w.x1, w.x2)) - Math.max(s[0], Math.min(w.x1, w.x2));
          if (overlap <= 0.05) continue;
          if (w.y1 <= s[1] + 0.005 && s[1] - w.y1 <= reach && !inRoom(mx, s[1] - 0.01)) s[1] = r2(w.y1);
          if (w.y1 >= s[3] - 0.005 && w.y1 - s[3] <= reach && !inRoom(mx, s[3] + 0.01)) s[3] = r2(w.y1);
        }
      }
      return s;
    });
    const outdoor = r.props['housewad.outdoor'] === 'true' || !r.ceiling;
    return { id, twin, level, name: r.name || id, rects, outdoor, props: r.props, before };
  });
  // Pieces of one room join up.
  const merged = [];
  for (const r of rooms) {
    const same = r.twin && merged.find((m) => m.id === r.id);
    if (same) same.rects.push(...r.rects);
    else merged.push(r);
  }

  const plan = { scale: meta.scale || 64, rooms: [], open: [], doors: [], exits: [] };
  const openSet = new Set();
  const addOpen = (a, b) => {
    const k = [a, b].sort().join('|');
    if (!openSet.has(k)) {
      openSet.add(k);
      plan.open.push([a, b]);
    }
  };
  const levelKeys = [...new Set(['', ...merged.map((r) => r.level)])];
  for (const k of levelKeys) {
    const lr = merged.filter((r) => r.level === k);
    if (!lr.length) continue;
    const g = grid(lr);
    const lw = walls.filter((w) => w.level === k);
    const lp = pieces.filter((p) => p.level === k);
    for (const e of runs(g)) {
      // Slivers where two rooms' rects overlap a little: nothing to read.
      if (e.to - e.from < 0.2) continue;
      const A = e.a >= 0 ? lr[e.a] : null;
      const B = e.b >= 0 ? lr[e.b] : null;
      const wallsHere = lw
        .filter((w) => (e.dir === 'v' ? Math.abs(w.x1 - w.x2) < 0.01 && Math.abs(w.x1 - e.at) <= w.thick / 2 + 0.03 : Math.abs(w.y1 - w.y2) < 0.01 && Math.abs(w.y1 - e.at) <= w.thick / 2 + 0.03))
        .map((w) => (e.dir === 'v' ? [Math.min(w.y1, w.y2), Math.max(w.y1, w.y2)] : [Math.min(w.x1, w.x2), Math.max(w.x1, w.x2)]));
      const doorsHere = lp.filter((p) => p.seg.dir === e.dir && Math.abs(p.seg.at - e.at) <= Math.max(p.depth / 2, 0.15) + 0.05);
      const pieceGaps = clip(doorsHere.map((p) => [p.seg.lo, p.seg.hi]), e.from, e.to);
      const covered = subtract(clip(wallsHere, e.from, e.to), pieceGaps);
      const missing = subtract([[e.from, e.to]], covered);
      const walled = total(covered) > 0.05;
      const named = (lo, hi) => (doorsHere.find((p) => p.seg.hi > lo && p.seg.lo < hi) || {}).name;
      const indoor = [A, B].filter((r) => r && !r.outdoor);
      if (!indoor.length) {
        if (A && B && !walled) addOpen(A.id, B.id);
        else if (A && B) for (const [lo, hi] of missing) if (hi - lo >= MIN_DOOR) plan.doors.push({ rooms: [A.id, B.id], at: atOf(e.dir, e.at, lo, hi) });
        continue;
      }
      if (A && B && !walled) {
        addOpen(A.id, B.id);
        continue;
      }
      // Out of the house: through a gap in a wall that is there, or a door.
      const gaps = A && B ? missing : walled ? missing : pieceGaps;
      for (const [lo, hi] of gaps) {
        if (hi - lo < MIN_DOOR) continue;
        const at = atOf(e.dir, e.at, lo, hi);
        if (A && B && !A.outdoor && !B.outdoor) plan.doors.push({ rooms: [A.id, B.id], at });
        else {
          const inside = indoor[0];
          const outside = [A, B].find((r) => r && r.outdoor);
          const exit = { room: inside.id, name: named(lo, hi) || 'Door', at };
          if (outside) exit.outside = outside.id;
          plan.exits.push(exit);
        }
      }
    }
  }

  // Exits keep what the plan said about them (name, the lock it is, the
  // area outside) when one is still where it was.
  const mid = (at) => [(at[0][0] + at[1][0]) / 2, (at[0][1] + at[1][1]) / 2];
  for (const ex of plan.exits) {
    const [x, y] = mid(ex.at);
    const was = (meta.exits || []).find((m) => {
      const [mx, my] = mid(m.at);
      return m.room === ex.room && Math.hypot(mx - x, my - y) < 0.75;
    });
    if (!was) continue;
    if (was.name) ex.name = was.name;
    if (was.door) ex.door = was.door;
    if (!ex.outside && was.outside) ex.outside = was.outside;
  }

  // Rooms, with what the file can't hold carried over from before.
  for (const r of merged) {
    const b = r.before || {};
    const adjacentHeights = walls
      .filter((w) => w.level === r.level && r.rects.some((q) => Math.min(w.x1, w.x2) <= q[2] + 0.1 && Math.max(w.x1, w.x2) >= q[0] - 0.1 && Math.min(w.y1, w.y2) <= q[3] + 0.1 && Math.max(w.y1, w.y2) >= q[1] - 0.1))
      .map((w) => w.height);
    const lv = levels.find((l) => keyOf.get(l.id) === r.level);
    const height = num(r.props['housewad.height'], 0) || b.height || (r.outdoor ? 3 : adjacentHeights.length ? Math.max(...adjacentHeights) : lv ? lv.height : 2.4);
    const room = { id: r.id, name: r.name };
    const area = r.props['housewad.area'] || b.area;
    if (area) room.area = area;
    if (r.level) room.level = r.level;
    if (r.outdoor) room.outdoor = true;
    room.height = r2(height);
    room.rects = r.rects;
    for (const k of ['listeners', 'near', 'things']) if (b[k] !== undefined) room[k] = b[k];
    plan.rooms.push(room);
  }

  // Levels: floors from their heights; where each sits for Doom (beside the
  // house, never over it) is kept, or found.
  const box = (rs) => rs.flatMap((r) => r.rects).reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[2]), Math.max(a[3], q[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  const mainBox = box(plan.rooms.filter((r) => !r.level));
  let shift = 0;
  const others = levelKeys.filter((k) => k);
  if (others.length) {
    plan.levels = {};
    for (const k of others) {
      const l = levels.find((q) => keyOf.get(q.id) === k);
      const b = box(plan.rooms.filter((r) => r.level === k));
      const kept = meta.levels && meta.levels[k] && meta.levels[k].offset;
      const offset = kept || [r2(mainBox[2] - b[0] + 4 + shift), r2(mainBox[1] - b[1])];
      if (!kept) shift += b[2] - b[0] + 4;
      plan.levels[k] = { offset, floor: r2(l && main ? l.elev - main.elev : 0) };
    }
  }

  // Stairs and whole-house areas come over as they were, while their rooms do.
  const ids = new Set(plan.rooms.map((r) => r.id));
  const stairs = (meta.stairs || []).filter((s) => ids.has(s.from && s.from.room) && ids.has(s.to && s.to.room));
  if (stairs.length) plan.stairs = stairs;
  if (meta.anywhere) plan.anywhere = meta.anywhere;

  // Labels: listeners, radars and the start, where they were put.
  const roomAt = (x, y, level) => plan.rooms.find((r) => (r.level || '') === level && r.rects.some((q) => x >= q[0] && x <= q[2] && y >= q[1] && y <= q[3]));
  const scanners = { ...(meta.scanners || {}) };
  const radars = (meta.radars || []).map((r) => ({ ...r }));
  let start = meta.start && ids.has(meta.start.room) ? meta.start : null;
  for (const l of labels) {
    let m;
    if ((m = /^BLE:\s*(.+)$/i.exec(l.text))) scanners[m[1].trim()] = l.level ? { at: [r2(l.x), r2(l.y)], level: l.level } : [r2(l.x), r2(l.y)];
    else if ((m = /^Radar:\s*(\S+)(?:.*?facing\s*(-?\d+(?:\.\d+)?))?/i.exec(l.text))) {
      const r = radars.find((q) => q.radar === m[1]) || radars[radars.push({ radar: m[1], facing: 0 }) - 1];
      r.at = [r2(l.x), r2(l.y)];
      if (m[2] !== undefined) r.facing = Number(m[2]);
      if (l.level) r.level = l.level;
      else delete r.level;
    } else if (/^start$/i.test(l.text)) {
      const room = roomAt(l.x, l.y, l.level);
      if (room) start = { room: room.id, at: [r2(l.x), r2(l.y)] };
    }
  }
  if (!start) {
    const first = plan.rooms.find((r) => !r.level && !r.outdoor) || plan.rooms[0];
    if (first) start = { room: first.id, at: [r2((first.rects[0][0] + first.rects[0][2]) / 2), r2((first.rects[0][1] + first.rects[0][3]) / 2)] };
  }
  if (start) plan.start = start;
  if (Object.keys(scanners).length) plan.scanners = scanners;
  if (radars.length) plan.radars = radars;
  if (!plan.open.length) delete plan.open;
  return plan;
}
