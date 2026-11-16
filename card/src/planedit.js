// Drawing the floor plan, in the card's settings: start from a sketch of
// your Home Assistant areas (or the plan you have), drag rooms where they
// really are, pull a corner to size them, add a part for an L-shaped room,
// and trace over a drawing or photo of the floor. Doors go wherever two
// rooms share a metre of wall unless you put them in yourself; stairs and
// where each floor sits in the map are worked out too (see plancomplete.js).
//
// Adapted from Mosaic's plan editor (github.com/Vortitron/mosaic, MIT); the
// plan format is the same, so a plan drawn in either works in both.
//
//   <housewad-plan-editor> .hass = hass; .plan = plan or null
//   fires 'plan-changed' { detail: { plan } } whenever the plan changes

import { completePlan } from './plancomplete.js';
import { grid, runs, r2 } from './plangrid.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SNAP = 0.25;
const snap = (v) => Math.round(v / SNAP) * SNAP;
const norm = ([a, b, c, d]) => [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
const OUTDOOR = /garden|yard|trädgård|tradgard|lawn|walkway|path|drive|uppfart|patio|terrace|balcony|altan|veranda|porch|outside|ute/i;
const roomArea = (n) => Math.max(6, Math.min(36, 7 + n * 2.2));

const bbox = (rects) => {
  const b = rects.reduce((a, q) => [Math.min(a[0], q[0], q[2]), Math.min(a[1], q[1], q[3]), Math.max(a[2], q[0], q[2]), Math.max(a[3], q[1], q[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  return { x1: b[0], y1: b[1], x2: b[2], y2: b[3], w: b[2] - b[0], h: b[3] - b[1] };
};

// Squarified treemap (Bruls, Huijsen & van Wijk): near-square boxes for
// `items` ({ weight }) in the rectangle x, y, w, h.
export function squarify(items, x, y, w, h) {
  const total = items.reduce((s, i) => s + i.weight, 0);
  if (!items.length || total <= 0) return [];
  const scale = (w * h) / total;
  const nodes = items.map((i) => ({ ...i, a: i.weight * scale })).sort((p, q) => q.a - p.a);
  const out = [];
  let rect = { x, y, w, h };
  const worst = (row, side) => {
    const s = row.reduce((t, n) => t + n.a, 0);
    const max = Math.max(...row.map((n) => n.a));
    const min = Math.min(...row.map((n) => n.a));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  const place = (row) => {
    const s = row.reduce((t, n) => t + n.a, 0);
    if (rect.w >= rect.h) {
      const cw = s / rect.h;
      let cy = rect.y;
      for (const n of row) {
        const ch = n.a / cw;
        out.push({ ...n, rect: [rect.x, cy, rect.x + cw, cy + ch] });
        cy += ch;
      }
      rect = { x: rect.x + cw, y: rect.y, w: rect.w - cw, h: rect.h };
    } else {
      const rh = s / rect.w;
      let cx = rect.x;
      for (const n of row) {
        const cw = n.a / rh;
        out.push({ ...n, rect: [cx, rect.y, cx + cw, rect.y + rh] });
        cx += cw;
      }
      rect = { x: rect.x, y: rect.y + rh, w: rect.w, h: rect.h - rh };
    }
  };
  let row = [];
  for (const n of nodes) {
    const side = Math.min(rect.w, rect.h);
    if (!row.length || worst([...row, n], side) <= worst(row, side)) row.push(n);
    else {
      place(row);
      row = [n];
    }
  }
  if (row.length) place(row);
  return out;
}

// A sketch of the home: each Home Assistant floor a block of near-square
// rooms sized by how much is in them, gardens in a strip down one side.
// rooms: [{ area, name, floor, devices }]; floors: [{ floor_id, level }]
export function sketchPlan(rooms, floors) {
  const plan = { sketch: true, rooms: [], levels: {} };
  const byFloor = new Map();
  for (const r of rooms) {
    const key = r.floor || '';
    if (!byFloor.has(key)) byFloor.set(key, []);
    byFloor.get(key).push(r);
  }
  // The ground floor (or the lowest) is the plan's main floor.
  const ground = floors.find((f) => f.level === 0) || [...floors].sort((a, b) => (a.level ?? 0) - (b.level ?? 0))[0];
  for (const [floorId, list] of byFloor) {
    const key = ground && floorId === ground.floor_id ? '' : floorId;
    const indoor = list.filter((r) => !OUTDOOR.test(r.name));
    const outdoor = list.filter((r) => OUTDOOR.test(r.name));
    const total = indoor.reduce((s, r) => s + roomArea(r.devices), 0);
    const w = Math.sqrt(total * 1.35);
    const h = total / w || 0;
    for (const n of squarify(indoor.map((r) => ({ r, weight: roomArea(r.devices) })), 0, 0, w, h)) {
      plan.rooms.push({ id: n.r.area, name: n.r.name, area: n.r.area, level: key || undefined, rects: [n.rect.map(r2)] });
    }
    if (outdoor.length) {
      const each = (h || 8) / outdoor.length;
      outdoor.forEach((r, i) => plan.rooms.push({ id: r.area, name: r.name, area: r.area, level: key || undefined, outdoor: true, rects: [[r2(w), r2(i * each), r2(w + 3.5), r2((i + 1) * each)]] }));
    }
    const floor = floors.find((f) => f.floor_id === floorId);
    if (key) plan.levels[key] = { floor: r2(floor && typeof floor.level === 'number' ? floor.level * 2.7 : 2.7) };
  }
  if (!Object.keys(plan.levels).length) delete plan.levels;
  return plan;
}

export function sketchFromHass(hass) {
  const counts = new Map();
  for (const d of Object.values(hass.devices || {})) if (d.area_id) counts.set(d.area_id, (counts.get(d.area_id) || 0) + 1);
  const floors = Object.values(hass.floors || {}).map((f) => ({ floor_id: f.floor_id, name: f.name, level: f.level }));
  const ground = floors.find((f) => f.level === 0) || [...floors].sort((a, b) => (a.level ?? 0) - (b.level ?? 0))[0];
  const rooms = Object.values(hass.areas || {}).map((a) => ({ area: a.area_id, name: a.name, floor: a.floor_id || (ground ? ground.floor_id : ''), devices: counts.get(a.area_id) || 0 }));
  return sketchPlan(rooms, floors);
}

const STYLE = `
  :host { display: block; }
  .pe { display: flex; flex-direction: column; gap: 8px; background: var(--card-background-color, #1c1c1c); }
  :host(.full) .pe { position: fixed; inset: 0; z-index: 9999; padding: 12px; box-sizing: border-box; }
  .top { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .top .sp { flex: 1; }
  button { font: inherit; font-size: 13px; padding: 5px 10px; border-radius: 6px; border: 1px solid var(--divider-color, #555); background: var(--secondary-background-color, #333); color: var(--primary-text-color); cursor: pointer; }
  button.on { background: var(--primary-color, #03a9f4); border-color: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); }
  button.danger { color: var(--error-color, #e55); }
  .body { display: flex; gap: 10px; flex-wrap: wrap; }
  .canvas { flex: 3 1 320px; min-height: 340px; background: #0d0f12; border-radius: 8px; overflow: hidden; touch-action: none; }
  :host(.full) .canvas { min-height: 0; height: calc(100vh - 110px); }
  .panel { flex: 1 1 220px; font-size: 13px; color: var(--primary-text-color); }
  .panel h4 { margin: 10px 0 4px; font-size: 13px; text-transform: lowercase; color: var(--secondary-text-color); }
  .panel label { display: block; margin: 6px 0; }
  .panel label span { display: block; font-size: 12px; color: var(--secondary-text-color); }
  .panel select, .panel input:not([type=range]):not([type=file]) { width: 100%; box-sizing: border-box; font: inherit; padding: 4px 6px; }
  .links { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
  .note { color: var(--secondary-text-color); font-size: 12px; margin: 4px 0; }
  svg { width: 100%; height: 100%; display: block; user-select: none; }
  .grid line { stroke: #ffffff12; stroke-width: 0.02; }
  .grid line.m5 { stroke: #ffffff26; }
  .room rect { fill: #2b3442; stroke: #d8d2c0; stroke-width: 0.06; cursor: move; }
  .room.out rect { fill: #2d4630; stroke-dasharray: 0.2 0.12; }
  .room.sel rect { fill: #3a5a85; }
  .room rect.part { fill: #4c78b5; }
  .room text { fill: #f4efe2; font-family: system-ui, sans-serif; text-anchor: middle; dominant-baseline: middle; pointer-events: none; paint-order: stroke; stroke: #000a; stroke-width: 0.08; }
  .door { stroke: #e0a050; stroke-width: 0.18; stroke-linecap: round; }
  .door.auto { stroke: #e0a05088; stroke-dasharray: 0.15 0.1; }
  .stair { fill: #e0a05044; stroke: #e0a050; stroke-width: 0.04; }
  .handle { fill: #fff; stroke: #000; stroke-width: 0.05; cursor: nwse-resize; }
  .doors .room rect { cursor: crosshair; }
  image.moving { cursor: move; }
`;

export class HouseWadPlanEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._plan = null;
    this.level = '';
    this.sel = null;
    this.mode = 'rooms'; // or 'doors'
    this.moveDrawing = false;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first && !this._plan) this._start(null);
  }

  // The plan to edit; null starts from a sketch of the home's areas.
  set plan(plan) {
    if (plan && this._plan && JSON.stringify(plan) === this._lastSent) return;
    this._start(plan);
  }

  get plan() {
    return this._plan;
  }

  _start(plan) {
    const usable = plan && Array.isArray(plan.rooms) && plan.rooms.some((r) => Array.isArray(r.rects) && r.rects.length);
    if (!usable && !this._hass) return;
    this._plan = JSON.parse(JSON.stringify(usable ? plan : sketchFromHass(this._hass)));
    this._plan.rooms = this._plan.rooms.filter((r) => Array.isArray(r.rects) && r.rects.length);
    this._plan.backdrops = this._plan.backdrops || {};
    this.sketched = !usable;
    const levels = this._levels();
    if (!levels.some((l) => l.key === this.level)) this.level = levels[0] ? levels[0].key : '';
    this.sel = null;
    this.frame = null;
    this._render();
    if (this.sketched) this._changed();
  }

  // The floors: the plan's own and every Home Assistant floor, top first.
  _levels() {
    const plan = this._plan;
    const hass = this._hass || {};
    const height = (k) => (k ? Number(((plan.levels || {})[k] || {}).floor) || 0 : 0);
    const keys = new Set(plan.rooms.map((r) => r.level || ''));
    keys.add('');
    for (const k of Object.keys(plan.levels || {})) keys.add(k);
    const floors = Object.values(hass.floors || {});
    const out = [...keys].map((k) => {
      const f = k && floors.find((x) => x.floor_id === k);
      return { key: k, name: f ? f.name : k ? k.replace(/_/g, ' ') : 'main floor', height: height(k) };
    });
    for (const f of floors) {
      if (out.some((l) => l.key === f.floor_id)) continue;
      // The ground floor is the plan's main floor.
      if (f.level === 0) continue;
      out.push({ key: f.floor_id, name: f.name, height: typeof f.level === 'number' ? f.level * 2.7 : 0, empty: true });
    }
    return out.sort((a, b) => b.height - a.height);
  }

  _rooms() {
    return this._plan.rooms.map((r, i) => ({ r, i })).filter(({ r }) => (r.level || '') === this.level);
  }

  _name(r) {
    const a = r.area && this._hass && this._hass.areas && this._hass.areas[r.area];
    return (a && a.name) || r.name || r.id || 'room';
  }

  _changed() {
    const plan = this._clean();
    this._lastSent = JSON.stringify(plan);
    this.dispatchEvent(new CustomEvent('plan-changed', { detail: { plan }, bubbles: true, composed: true }));
  }

  // What is saved: rects tidy, no empty bits, no sketch marker once touched.
  _clean() {
    const plan = JSON.parse(JSON.stringify(this._plan));
    for (const r of plan.rooms) r.rects = r.rects.map((q) => norm(q).map(r2));
    for (const [k, bd] of Object.entries(plan.backdrops || {})) if (!bd || !bd.url) delete plan.backdrops[k];
    if (plan.backdrops && !Object.keys(plan.backdrops).length) delete plan.backdrops;
    if (!this.sketched) delete plan.sketch;
    return plan;
  }

  _render() {
    if (!this._plan) return;
    const levels = this._levels();
    const auto = !Array.isArray(this._plan.doors);
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>
      <div class="pe">
        <div class="top">
          ${levels.map((l) => `<button data-level="${esc(l.key)}" class="${l.key === this.level ? 'on' : ''}">${esc(l.name)}</button>`).join('')}
          <span class="sp"></span>
          <button data-act="mode-rooms" class="${this.mode === 'rooms' ? 'on' : ''}">Rooms</button>
          <button data-act="mode-doors" class="${this.mode === 'doors' ? 'on' : ''}">Doors</button>
          <button data-act="full">${this.classList.contains('full') ? 'Done' : 'Full screen'}</button>
        </div>
        ${this.sketched ? `<div class="note">A sketch of your rooms from Home Assistant's areas: drag them to where they really are.${auto ? ' Doors and stairs are added for you.' : ''}</div>` : ''}
        <div class="body"><div class="canvas"></div><div class="panel"></div></div>
      </div>`;
    const root = this.shadowRoot;
    root.querySelector('.pe').addEventListener('click', (e) => this._click(e));
    root.querySelector('.pe').addEventListener('change', (e) => this._change(e));
    root.querySelector('.pe').addEventListener('input', (e) => this._input(e));
    this._wire(root.querySelector('.canvas'));
    this._draw();
    this._panel();
  }

  // The canvas: a metre grid, the drawing to trace, the rooms, doors and stairs.
  _draw() {
    const box = this.shadowRoot.querySelector('.canvas');
    if (!box) return;
    const rooms = this._rooms();
    const bd = this._plan.backdrops[this.level || 'main'];
    const parts = rooms.flatMap(({ r }) => r.rects);
    const frame = parts.length ? bbox(parts) : { x1: 0, y1: 0, x2: 12, y2: 9 };
    if (bd) {
      frame.x1 = Math.min(frame.x1, bd.x);
      frame.y1 = Math.min(frame.y1, bd.y);
      frame.x2 = Math.max(frame.x2, bd.x + bd.w);
      frame.y2 = Math.max(frame.y2, bd.y + bd.w * (bd.ratio || 0.7));
    }
    const pad = 2;
    const vb = [Math.floor(frame.x1 - pad), Math.floor(frame.y1 - pad), Math.ceil(frame.x2 - frame.x1 + pad * 2), Math.ceil(frame.y2 - frame.y1 + pad * 2)];
    if (!this.frame || !this.drag) this.frame = vb; // the frame holds still while dragging
    const [vx, vy, vw, vh] = this.frame;
    const lines = [];
    for (let x = Math.ceil(vx); x <= vx + vw; x++) lines.push(`<line class="${x % 5 ? '' : 'm5'}" x1="${x}" y1="${vy}" x2="${x}" y2="${vy + vh}"/>`);
    for (let y = Math.ceil(vy); y <= vy + vh; y++) lines.push(`<line class="${y % 5 ? '' : 'm5'}" x1="${vx}" y1="${y}" x2="${vx + vw}" y2="${y}"/>`);
    const sel = this.sel;
    // Names go on what each room keeps once overlaps are settled (the room
    // placed last wins), which is what the game builds.
    const auto = !Array.isArray(this._plan.doors);
    const done = completePlan(this._clean()).plan;
    const kept = new Map(done.rooms.map((r) => [r.id, r.rects]));
    const shapes = rooms
      .map(({ r, i }) => {
        const own = kept.get(r.id) || r.rects;
        const big = [...own].sort((p, q) => (q[2] - q[0]) * (q[3] - q[1]) - (p[2] - p[0]) * (p[3] - p[1]))[0];
        const size = Math.max(0.28, Math.min(0.55, Math.min(big[2] - big[0], big[3] - big[1]) * 0.18));
        return `<g class="room${r.outdoor ? ' out' : ''}${sel && sel.r === i ? ' sel' : ''}">${r.rects
          .map((q, j) => `<rect data-r="${i}" data-q="${j}" class="${sel && sel.r === i && sel.q === j ? 'part' : ''}" x="${q[0]}" y="${q[1]}" width="${q[2] - q[0]}" height="${q[3] - q[1]}"/>`)
          .join('')}<text x="${(big[0] + big[2]) / 2}" y="${(big[1] + big[3]) / 2}" font-size="${size}">${esc(this._name(r))}</text></g>`;
      })
      .join('');
    // Doors and stairs as they will be in the game: the plan's own, or the
    // ones house.wad adds (dashed).
    const here = new Set(rooms.map(({ r }) => r.id));
    const doorLine = (d, i, kind) => `<line class="door${auto ? ' auto' : ''}" data-door="${kind}:${i}" x1="${d.at[0][0]}" y1="${d.at[0][1]}" x2="${d.at[1][0]}" y2="${d.at[1][1]}"/>`;
    const doors = [
      ...(done.doors || []).map((d, i) => (d.rooms.some((id) => here.has(id)) ? doorLine(d, i, 'd') : '')),
      ...(done.exits || []).map((d, i) => (here.has(d.room) ? doorLine(d, i, 'x') : '')),
    ].join('');
    const stairs = (done.stairs || [])
      .flatMap((s) => [s.from, s.to])
      .filter((end) => here.has(end.room))
      .map((end) => `<rect class="stair" x="${end.rect[0]}" y="${end.rect[1]}" width="${end.rect[2] - end.rect[0]}" height="${end.rect[3] - end.rect[1]}"/>`)
      .join('');
    const q = sel && this._plan.rooms[sel.r] && this._plan.rooms[sel.r].rects[sel.q];
    const handle = q && this.mode === 'rooms' ? `<circle class="handle" data-h="1" cx="${q[2]}" cy="${q[3]}" r="0.3"/>` : '';
    const image = bd ? `<image href="${esc(bd.url)}" x="${bd.x}" y="${bd.y}" width="${bd.w}" height="${bd.w * (bd.ratio || 0.7)}" opacity="${bd.opacity ?? 0.5}" preserveAspectRatio="none" class="${this.moveDrawing ? 'moving' : ''}"/>` : '';
    box.innerHTML = `<svg class="${this.mode}" viewBox="${vx} ${vy} ${vw} ${vh}" preserveAspectRatio="xMidYMid meet" role="application" aria-label="floor plan">${image}<g class="grid">${lines.join('')}</g>${shapes}${stairs}${doors}${handle}</svg>`;
  }

  _panel() {
    const box = this.shadowRoot.querySelector('.panel');
    if (!box) return;
    const hass = this._hass || {};
    const areas = Object.values(hass.areas || {}).sort((a, b) => a.name.localeCompare(b.name));
    const placed = new Set(this._plan.rooms.map((r) => r.area).filter(Boolean));
    const r = this.sel && this._plan.rooms[this.sel.r];
    const bd = this._plan.backdrops[this.level || 'main'];
    const auto = !Array.isArray(this._plan.doors);
    if (this.mode === 'doors') {
      box.innerHTML = `<h4>doors</h4>
        <p class="note">${auto ? 'house.wad puts a door wherever two rooms share a metre of wall, and one out to each garden drawn against the house (dashed). Click a wall to choose them yourself.' : 'Click a wall between two rooms, or an outside wall, to put a door there; click a door to take it away.'}</p>
        ${auto ? '' : '<div class="links"><button data-act="autodoors">let house.wad place the doors</button></div>'}`;
      return;
    }
    const room = r
      ? `<h4>${esc(this._name(r))}</h4>
        <label><span>which Home Assistant area this is</span><select data-act="area"><option value="">not an area</option>${areas
          .map((a) => `<option value="${esc(a.area_id)}" ${a.area_id === r.area ? 'selected' : ''}>${esc(a.name)}</option>`)
          .join('')}</select></label>
        ${r.area ? '' : `<label><span>its name</span><input data-act="name" value="${esc(r.name || '')}" placeholder="landing, WC, store…"></label>`}
        <div class="links"><button data-act="part">+ part (L-shaped)</button>${r.rects.length > 1 ? '<button data-act="unpart">remove this part</button>' : ''}<button data-act="outdoor">${r.outdoor ? 'indoors' : 'outside'}</button><button data-act="remove" class="danger">take off the plan</button></div>`
      : '<p class="note">Click a room to change it. Drag it to move it, the round handle to size it.</p>';
    const missing = areas.filter((a) => !placed.has(a.area_id));
    const add = `<h4>add</h4><label><span>an area not on the plan yet</span><select data-act="addarea"><option value="">choose…</option>${missing
      .map((a) => `<option value="${esc(a.area_id)}">${esc(a.name)}</option>`)
      .join('')}</select></label><div class="links"><button data-act="addother">+ a space that isn't an area</button></div>`;
    const drawing = `<h4>a drawing to trace</h4>
      ${bd
        ? `<label><span>its width, in metres</span><input data-act="bdw" inputmode="decimal" value="${esc(bd.w)}"></label>
        <label><span>how faint</span><input type="range" min="0.1" max="1" step="0.05" data-act="bdo" value="${esc(bd.opacity ?? 0.5)}"></label>
        <div class="links"><button data-act="movedrawing">${this.moveDrawing ? 'done moving it' : 'move it'}</button><button data-act="nodrawing" class="danger">remove it</button></div>`
        : `<p class="note">A floor plan, an estate agent's drawing, a photo of a sketch: put it under the rooms and trace them.</p>
        <div class="links"><label class="pick"><button data-act="pick">choose a picture</button><input type="file" accept="image/*" data-act="upload" hidden></label></div>
        <label><span>or its address</span><input data-act="bdurl" placeholder="/local/plans/ground.png"></label>`}`;
    const more = `<h4>more</h4><div class="links"><button data-act="resketch">start again from a sketch</button></div>`;
    box.innerHTML = room + add + drawing + more;
  }

  // --- the mouse and fingers ------------------------------------------------------------

  _point(e) {
    const svg = this.shadowRoot.querySelector('svg');
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }

  _wire(box) {
    box.addEventListener('pointerdown', (e) => {
      if (!this.shadowRoot.querySelector('svg')) return;
      const at = this._point(e);
      if (this.mode === 'doors') return this._doorAt(at, e.target.closest('[data-door]'));
      const handle = e.target.closest('[data-h]');
      const part = e.target.closest('rect[data-r]');
      const bd = this._plan.backdrops[this.level || 'main'];
      if (this.moveDrawing && bd) this.drag = { kind: 'drawing', from: at, start: { x: bd.x, y: bd.y } };
      else if (handle && this.sel) this.drag = { kind: 'size', from: at, start: [...this._plan.rooms[this.sel.r].rects[this.sel.q]] };
      else if (part) {
        this.sel = { r: Number(part.dataset.r), q: Number(part.dataset.q) };
        this.drag = { kind: 'move', from: at, start: [...this._plan.rooms[this.sel.r].rects[this.sel.q]] };
        this._panel();
      } else {
        this.sel = null;
        this.drag = null;
        this._draw();
        this._panel();
        return;
      }
      box.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    box.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const at = this._point(e);
      const dx = at.x - this.drag.from.x;
      const dy = at.y - this.drag.from.y;
      if (this.drag.kind === 'drawing') {
        const bd = this._plan.backdrops[this.level || 'main'];
        bd.x = r2(this.drag.start.x + dx);
        bd.y = r2(this.drag.start.y + dy);
      } else {
        const [x1, y1, x2, y2] = this.drag.start;
        const q =
          this.drag.kind === 'move'
            ? [snap(x1 + dx), snap(y1 + dy), snap(x1 + dx) + (x2 - x1), snap(y1 + dy) + (y2 - y1)]
            : [x1, y1, Math.max(x1 + 0.5, snap(x2 + dx)), Math.max(y1 + 0.5, snap(y2 + dy))];
        this._plan.rooms[this.sel.r].rects[this.sel.q] = q.map(r2);
      }
      this.drag.moved = true;
      this._draw();
    });
    const end = () => {
      if (!this.drag) return;
      const moved = this.drag.moved;
      // The room just placed goes last, so it keeps any space it now
      // overlaps (see plancomplete.js).
      if (moved && this.sel && this.drag.kind !== 'drawing') {
        const [room] = this._plan.rooms.splice(this.sel.r, 1);
        this._plan.rooms.push(room);
        this.sel = { r: this._plan.rooms.length - 1, q: this.sel.q };
      }
      this.drag = null;
      this.frame = null;
      this._draw();
      if (moved) this._touched();
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
  }

  // Any change by hand: the plan is no longer a sketch, and is sent.
  _touched() {
    this.sketched = false;
    this._changed();
  }

  // Doors mode: a click on a door takes it away; on a wall puts one there.
  _doorAt(at, doorEl) {
    const plan = this._plan;
    if (!Array.isArray(plan.doors)) {
      // From now on the doors are as drawn: start from the ones house.wad would add.
      const done = completePlan(this._clean()).plan;
      plan.doors = done.doors || [];
      plan.exits = done.exits || [];
      if (done.open) plan.open = done.open;
    }
    if (doorEl) {
      const [kind, i] = doorEl.dataset.door.split(':');
      // Indices are of the completed plan, which has the same doors and exits now.
      if (kind === 'd') plan.doors.splice(Number(i), 1);
      else plan.exits.splice(Number(i), 1);
      this._touched();
      this._draw();
      this._panel();
      return;
    }
    // The wall nearest the click: between two rooms, or a room and outside.
    const lr = this._rooms().map(({ r }) => r);
    let best = null;
    for (const e of runs(grid(lr))) {
      const along = e.dir === 'v' ? at.y : at.x;
      const across = e.dir === 'v' ? at.x : at.y;
      if (along < e.from - 0.2 || along > e.to + 0.2) continue;
      const d = Math.abs(across - e.at);
      if (d <= 0.5 && (!best || d < best.d)) best = { e, d, along };
    }
    if (!best) return;
    const { e } = best;
    const A = e.a >= 0 ? lr[e.a] : null;
    const B = e.b >= 0 ? lr[e.b] : null;
    const w = Math.min(0.9, e.to - e.from - 0.1);
    if (w < 0.5) return;
    const mid = Math.min(e.to - w / 2, Math.max(e.from + w / 2, best.along));
    const at2 = e.dir === 'v' ? [[r2(e.at), r2(mid - w / 2)], [r2(e.at), r2(mid + w / 2)]] : [[r2(mid - w / 2), r2(e.at)], [r2(mid + w / 2), r2(e.at)]];
    const indoor = [A, B].filter((r) => r && !r.outdoor);
    if (!indoor.length) return; // between two gardens, or a garden and nowhere
    if (A && B && !A.outdoor && !B.outdoor) plan.doors.push({ rooms: [A.id, B.id], at: at2 });
    else {
      const garden = [A, B].find((r) => r && r.outdoor);
      const exit = { room: indoor[0].id, name: garden ? `Door to the ${this._name(garden).toLowerCase()}` : 'Door out', at: at2 };
      if (garden) exit.outside = garden.id;
      plan.exits.push(exit);
    }
    this._touched();
    this._draw();
  }

  // --- buttons and fields ------------------------------------------------------------

  _click(e) {
    const lvl = e.target.closest('[data-level]');
    if (lvl) {
      this.level = lvl.dataset.level;
      this.sel = null;
      this.frame = null;
      return this._render();
    }
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const plan = this._plan;
    const r = this.sel && plan.rooms[this.sel.r];
    if (act === 'mode-rooms' || act === 'mode-doors') {
      this.mode = act === 'mode-rooms' ? 'rooms' : 'doors';
      this.sel = null;
      return this._render();
    }
    if (act === 'full') {
      this.classList.toggle('full');
      this.frame = null;
      return this._render();
    }
    if (act === 'pick') return this.shadowRoot.querySelector('input[data-act=upload]').click();
    if (act === 'autodoors') {
      delete plan.doors;
      delete plan.exits;
      delete plan.open;
    }
    if (act === 'part' && r) {
      const q = r.rects[this.sel.q];
      r.rects.push([q[2], q[1], r2(q[2] + 2), r2(q[1] + 2)]);
      this.sel = { r: this.sel.r, q: r.rects.length - 1 };
    }
    if (act === 'unpart' && r && r.rects.length > 1) {
      r.rects.splice(this.sel.q, 1);
      this.sel = { r: this.sel.r, q: 0 };
    }
    if (act === 'outdoor' && r) r.outdoor = r.outdoor ? undefined : true;
    if (act === 'remove' && r) {
      plan.rooms.splice(this.sel.r, 1);
      this.sel = null;
    }
    if (act === 'addother') this._add(null, 'new space');
    if (act === 'movedrawing') this.moveDrawing = !this.moveDrawing;
    if (act === 'nodrawing') {
      delete plan.backdrops[this.level || 'main'];
      this.moveDrawing = false;
    }
    if (act === 'resketch') {
      // Twice, to be sure: the first press only asks.
      if (!this.reallyResketch) {
        this.reallyResketch = true;
        b.textContent = 'really start again? (press again)';
        setTimeout(() => (this.reallyResketch = false), 4000);
        return;
      }
      this.reallyResketch = false;
      const keep = plan.backdrops;
      this._plan = sketchFromHass(this._hass);
      this._plan.backdrops = keep || {};
      this.sel = null;
      this.frame = null;
      this.sketched = true;
      this._changed();
      return this._render();
    }
    this.frame = null;
    this._touched();
    this._draw();
    this._panel();
  }

  _change(e) {
    const t = e.target;
    const act = t.dataset.act;
    const plan = this._plan;
    const r = this.sel && plan.rooms[this.sel.r];
    if (act === 'area' && r) {
      r.area = t.value || undefined;
      if (r.area) r.id = r.area;
    } else if (act === 'name' && r) r.name = t.value.trim();
    else if (act === 'addarea' && t.value) {
      const a = this._hass.areas[t.value];
      this._add(t.value, a ? a.name : t.value);
    } else if (act === 'bdw') {
      const w = Number(String(t.value).replace(',', '.'));
      if (w > 0) plan.backdrops[this.level || 'main'].w = w;
    } else if (act === 'bdurl' && t.value.trim()) this._backdrop(t.value.trim());
    else if (act === 'upload' && t.files && t.files[0]) return this._upload(t.files[0]);
    else return;
    this.frame = null;
    this._touched();
    this._draw();
    this._panel();
  }

  _input(e) {
    if (e.target.dataset.act !== 'bdo') return;
    this._plan.backdrops[this.level || 'main'].opacity = Number(e.target.value);
    const img = this.shadowRoot.querySelector('svg image');
    if (img) img.setAttribute('opacity', e.target.value);
    clearTimeout(this._opTimer);
    this._opTimer = setTimeout(() => this._touched(), 400);
  }

  // A new room beside what is on this floor, about the size it should be.
  _add(areaId, name) {
    const here = this._rooms().flatMap(({ r }) => r.rects);
    const b = here.length ? bbox(here) : { x1: 0, y1: 0, x2: 0, y2: 0 };
    const side = r2(Math.sqrt(roomArea(0)) + 0.5);
    const x = snap(b.x2 + 1);
    const y = snap(b.y1);
    const room = { id: areaId || `space_${Date.now().toString(36)}`, rects: [[r2(x), r2(y), r2(x + side), r2(y + side)]] };
    if (areaId) room.area = areaId;
    else room.name = name;
    if (this.level) room.level = this.level;
    if (this.level && !(this._plan.levels || {})[this.level]) {
      const l = this._levels().find((v) => v.key === this.level);
      this._plan.levels = { ...(this._plan.levels || {}), [this.level]: { floor: r2(l ? l.height : 2.7) } };
    }
    this._plan.rooms.push(room);
    this.sel = { r: this._plan.rooms.length - 1, q: 0 };
  }

  // The drawing goes under this floor; its width is a guess to correct.
  _backdrop(url) {
    const key = this.level || 'main';
    const here = this._rooms().flatMap(({ r }) => r.rects);
    const b = here.length ? bbox(here) : { x1: 0, y1: 0, w: 15 };
    const img = new Image();
    img.onload = () => {
      const bd = this._plan.backdrops[key];
      if (bd) bd.ratio = r2(img.naturalHeight / img.naturalWidth);
      this.frame = null;
      this._draw();
      this._changed();
    };
    img.src = url;
    this._plan.backdrops[key] = { url, x: r2(b.x1), y: r2(b.y1), w: r2(Math.max(8, b.w || 15)), opacity: 0.5, ratio: 0.7 };
    this.moveDrawing = false;
  }

  // A picture from this device, kept by Home Assistant's own image store
  // (as area and person pictures are).
  async _upload(file) {
    const fd = new FormData();
    fd.append('file', file);
    const note = this.shadowRoot.querySelector('.panel');
    try {
      const res = await this._hass.fetchWithAuth('/api/image/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const { id } = await res.json();
      this._backdrop(`/api/image/serve/${id}/original`);
      this._touched();
    } catch (err) {
      if (note) note.insertAdjacentHTML('afterbegin', `<p class="note">Couldn't keep the picture: ${esc((err && err.message) || err)}</p>`);
      return;
    }
    this.frame = null;
    this._draw();
    this._panel();
  }
}

if (!customElements.get('housewad-plan-editor')) customElements.define('housewad-plan-editor', HouseWadPlanEditor);
