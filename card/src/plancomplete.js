// A plan with only its rooms is enough. Plans drawn in an editor, sketched
// from Home Assistant's areas (Mosaic does this) or imported often have no
// doors, no stairs and no idea where an upper floor goes in a Doom map, and
// without them every room is sealed and the floors sit on top of each other.
// This fills in what is missing, and only what is missing: a plan that lists
// its own doors (even none: "doors": []) keeps exactly those.
//
//   doors:  one between every two indoor rooms that share a metre or more of
//           wall, in the middle of the longest stretch; a door out to every
//           garden drawn against the house; no wall between gardens.
//   stairs: one flight between each floor and the next, in the rooms that
//           overlap most (one above the other), else the biggest.
//   levels: every floor a room is on, its height guessed if not given, and
//           placed beside the house (Doom has no room over a room).
//
// And it tidies what a person draws: where two rooms overlap the one listed
// later keeps the space (the plan editor lists the room you last moved
// last), and doors, ways out and stairs that no longer sit where they can
// be built (a wall moved away from under a door) are dropped, not built
// wrong.

import { grid, runs, r2, norm, segment } from './plangrid.js';

const MIN_SHARED = 1.0; // metres of wall two rooms share before they get a door
const DOOR = 0.9;
const STAIR = [1.0, 1.4]; // a flight's width and depth, metres
const STOREY = 2.7;

const levelOf = (r) => r.level || '';
const area = ([x1, y1, x2, y2]) => (x2 - x1) * (y2 - y1);
const overlap = (p, q) => {
  const x1 = Math.max(p[0], q[0]);
  const y1 = Math.max(p[1], q[1]);
  const x2 = Math.min(p[2], q[2]);
  const y2 = Math.min(p[3], q[3]);
  return x2 > x1 && y2 > y1 ? [x1, y1, x2, y2] : null;
};
const boxOf = (rooms) =>
  rooms.flatMap((r) => r.rects).reduce((b, q) => [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])], [Infinity, Infinity, -Infinity, -Infinity]);

// p minus q: what is left of rect p, as up to four rects.
function cut(p, q) {
  const o = overlap(p, q);
  if (!o) return [p];
  const out = [];
  if (p[1] < o[1]) out.push([p[0], p[1], p[2], o[1]]);
  if (o[3] < p[3]) out.push([p[0], o[3], p[2], p[3]]);
  if (p[0] < o[0]) out.push([p[0], o[1], o[0], o[3]]);
  if (o[2] < p[2]) out.push([o[2], o[1], p[2], o[3]]);
  return out;
}

const SLIVER = 0.3;

export function completePlan(plan) {
  const out = { ...plan, rooms: (plan.rooms || []).filter((r) => Array.isArray(r.rects) && r.rects.length).map((r) => ({ ...r, rects: r.rects.map(norm) })) };
  const added = { doors: 0, exits: 0, open: 0, stairs: 0, levels: [], trimmed: [], dropped: 0 };

  // Overlaps: a room listed later keeps the space it covers.
  for (let i = 0; i < out.rooms.length; i++) {
    const r = out.rooms[i];
    const before = JSON.stringify(r.rects);
    for (let j = i + 1; j < out.rooms.length; j++) {
      if (levelOf(out.rooms[j]) !== levelOf(r)) continue;
      for (const q of out.rooms[j].rects) r.rects = r.rects.flatMap((p) => cut(p, q));
    }
    r.rects = r.rects.filter((q) => q[2] - q[0] >= SLIVER && q[3] - q[1] >= SLIVER).map((q) => q.map(r2));
    if (JSON.stringify(r.rects) !== before) added.trimmed.push(r.id);
  }
  out.rooms = out.rooms.filter((r) => r.rects.length);
  const keys = [...new Set(out.rooms.map(levelOf))];

  // Doors, ways out and stairs the plan gives, kept only where they can be built.
  const ids = new Map(out.rooms.map((r) => [r.id, r]));
  const wallsOf = new Map(keys.map((k) => {
    const lr = out.rooms.filter((r) => levelOf(r) === k);
    return [k, runs(grid(lr)).map((e) => ({ ...e, A: e.a >= 0 ? lr[e.a] : null, B: e.b >= 0 ? lr[e.b] : null }))];
  }));
  const onWall = (at, ok) => {
    const s = segment(at);
    return [...wallsOf.values()].some((list) => list.some((e) => e.dir === s.dir && Math.abs(e.at - s.at) < 0.06 && e.from <= s.lo + 0.06 && e.to >= s.hi - 0.06 && ok(e.A, e.B)));
  };
  const between = (a, b) => (A, B) => A && B && [A.id, B.id].sort().join('|') === [a, b].sort().join('|');
  const outOf = (room, outside) => (A, B) => {
    const inside = [A, B].find((x) => x && x.id === room);
    const other = A === inside ? B : A;
    return !!inside && (!other || (other.outdoor && (!outside || other.id === outside || other.area === outside)) || (!!outside && !ids.has(outside) && !other));
  };
  const keep = (list, ok) => {
    if (!Array.isArray(list)) return list;
    const kept = list.filter(ok);
    added.dropped += list.length - kept.length;
    return kept;
  };
  if (Array.isArray(plan.doors)) out.doors = keep(plan.doors, (d) => d.rooms && ids.has(d.rooms[0]) && ids.has(d.rooms[1]) && onWall(d.at, between(d.rooms[0], d.rooms[1])));
  if (Array.isArray(plan.exits)) out.exits = keep(plan.exits, (x) => ids.has(x.room) && onWall(x.at, (A, B) => outOf(x.room, x.outside)(A, B) || outOf(x.room, null)(A, B)));
  // A flight may sit in its room or just outside it, opening into it.
  const touches = (room, rect) => {
    const r = ids.get(room);
    const q = rect && norm(rect);
    return !!r && !!q && r.rects.some((p) => q[0] <= p[2] + 0.1 && q[2] >= p[0] - 0.1 && q[1] <= p[3] + 0.1 && q[3] >= p[1] - 0.1);
  };
  if (Array.isArray(plan.stairs)) out.stairs = keep(plan.stairs, (st) => st.from && st.to && touches(st.from.room, st.from.rect) && touches(st.to.room, st.to.rect));

  // Floors: every level a room is on, with a height.
  out.levels = { ...(plan.levels || {}) };
  const others = keys.filter((k) => k);
  others.forEach((k, i) => {
    if (out.levels[k] && Number.isFinite(Number(out.levels[k].floor))) return;
    out.levels[k] = { ...(out.levels[k] || {}), floor: (i + 1) * STOREY };
  });

  // Doors where rooms meet, unless the plan says which.
  if (!Array.isArray(plan.doors)) {
    out.doors = [];
    const autoExits = !Array.isArray(plan.exits);
    out.exits = autoExits ? [] : [...plan.exits];
    out.open = [...(plan.open || [])];
    const isOpen = (a, b) => out.open.some((p) => p.includes(a) && p.includes(b));
    for (const key of keys) {
      const lr = out.rooms.filter((r) => levelOf(r) === key);
      const longest = new Map();
      for (const e of runs(grid(lr))) {
        if (e.a < 0 || e.b < 0) continue;
        const len = e.to - e.from;
        const pair = [e.a, e.b].sort((p, q) => p - q).join('|');
        if (len >= MIN_SHARED && (!longest.has(pair) || len > longest.get(pair).to - longest.get(pair).from)) longest.set(pair, e);
      }
      for (const e of longest.values()) {
        const A = lr[e.a];
        const B = lr[e.b];
        const mid = (e.from + e.to) / 2;
        const w = Math.min(DOOR, e.to - e.from - 0.3);
        const at = e.dir === 'v' ? [[r2(e.at), r2(mid - w / 2)], [r2(e.at), r2(mid + w / 2)]] : [[r2(mid - w / 2), r2(e.at)], [r2(mid + w / 2), r2(e.at)]];
        if (A.outdoor && B.outdoor) {
          if (!isOpen(A.id, B.id)) {
            out.open.push([A.id, B.id]);
            added.open++;
          }
        } else if (A.outdoor || B.outdoor) {
          if (!autoExits) continue;
          const inside = A.outdoor ? B : A;
          const garden = A.outdoor ? A : B;
          out.exits.push({ room: inside.id, name: `Door to the ${String(garden.name || garden.id).toLowerCase()}`, at, outside: garden.id });
          added.exits++;
        } else {
          out.doors.push({ rooms: [A.id, B.id], at });
          added.doors++;
        }
      }
    }
    if (!out.open.length) delete out.open;
  }

  // Stairs between consecutive floors, unless the plan has its own.
  if (!Array.isArray(plan.stairs) && keys.length > 1) {
    out.stairs = [];
    const height = (k) => (k ? Number(out.levels[k].floor) || 0 : 0);
    const order = [...keys].sort((a, b) => height(a) - height(b));
    const fits = (q) => q[2] - q[0] >= STAIR[0] + 0.6 && q[3] - q[1] >= STAIR[1] + 0.6;
    const flight = (q) => [r2(q[0] + 0.3), r2(q[1] + 0.3), r2(q[0] + 0.3 + STAIR[0]), r2(q[1] + 0.3 + STAIR[1])];
    const biggest = (r) => [...r.rects].sort((p, q) => area(q) - area(p))[0];
    for (let i = 0; i + 1 < order.length; i++) {
      const lower = out.rooms.filter((r) => levelOf(r) === order[i] && !r.outdoor);
      const upper = out.rooms.filter((r) => levelOf(r) === order[i + 1] && !r.outdoor);
      // One above the other, where there is room for a flight in both.
      let best = null;
      for (const A of lower)
        for (const B of upper)
          for (const p of A.rects)
            for (const q of B.rects) {
              const o = overlap(p, q);
              if (o && fits(o) && (!best || area(o) > area(best.o))) best = { A, B, o };
            }
      if (best) {
        out.stairs.push({ name: `Stairs to the ${order[i + 1] || 'main floor'}`.replace(/_/g, ' '), from: { room: best.A.id, rect: flight(best.o), enter: 's' }, to: { room: best.B.id, rect: flight(best.o), enter: 's' } });
        added.stairs++;
        continue;
      }
      // Else the biggest rooms, each its own flight.
      const A = lower.filter((r) => fits(biggest(r))).sort((p, q) => area(biggest(q)) - area(biggest(p)))[0];
      const B = upper.filter((r) => fits(biggest(r))).sort((p, q) => area(biggest(q)) - area(biggest(p)))[0];
      if (!A || !B) continue;
      out.stairs.push({ name: `Stairs to the ${order[i + 1] || 'main floor'}`.replace(/_/g, ' '), from: { room: A.id, rect: flight(biggest(A)), enter: 's' }, to: { room: B.id, rect: flight(biggest(B)), enter: 's' } });
      added.stairs++;
    }
  }

  // Where each other floor goes in the map: beside the house, never on it.
  const main = out.rooms.filter((r) => !levelOf(r));
  if (main.length) {
    const mb = boxOf(main);
    let x = mb[2] + 4;
    for (const k of others) {
      if (Array.isArray(out.levels[k].offset)) {
        const lb = boxOf(out.rooms.filter((r) => levelOf(r) === k));
        x = Math.max(x, lb[2] + out.levels[k].offset[0] + 4);
        continue;
      }
      const lb = boxOf(out.rooms.filter((r) => levelOf(r) === k));
      out.levels[k] = { ...out.levels[k], offset: [r2(x - lb[0]), r2(mb[1] - lb[1])] };
      added.levels.push(k);
      x += lb[2] - lb[0] + 4;
    }
  }
  if (!Object.keys(out.levels).length) delete out.levels;
  return { plan: out, added };
}
