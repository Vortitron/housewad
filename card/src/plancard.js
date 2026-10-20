// The floor plan on its own: a Home Assistant card that draws the house from
// its plan, live, without the game. Each room is filled in the colours of its
// lights that are on, lamps can be clicked to switch, and everybody Bermuda
// follows is a dot with their name (and phone) where they seem to be.
//
//   type: custom:housewad-plan-card
//   floorplan_from: house-wad   # borrow the plan from a dashboard with a house.wad card
//   # or floorplan: { rooms: [...], ... }   (the same plan the game takes)
//   floor: loft                 # the floor to open on (default: the main one)
//   title: Where is everyone

import { buildHouse } from './model.js';
import { generateFromPlan } from './planmap.js';
import { OverMap, wallsFromLumps, lightColour, joinStrips } from './overmap.js';
import { PeopleLocator } from './people.js';

const STYLE = `
  :host { display: block; }
  ha-card { overflow: hidden; }
  .head { display: flex; align-items: center; gap: 8px; padding: 12px 14px 6px; flex-wrap: wrap; }
  .title { font-size: 16px; font-weight: 600; flex: 1; min-width: 8em; }
  .floors { display: flex; gap: 4px; flex-wrap: wrap; }
  .floors button { font: inherit; font-size: 13px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--divider-color, #555); background: transparent; color: var(--primary-text-color); cursor: pointer; }
  .floors button.on { background: var(--primary-color, #03a9f4); border-color: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); }
  .map { position: relative; background: #0a0a0c; }
  canvas { display: block; width: 100%; height: 100%; }
  .people { padding: 8px 14px 12px; font-size: 13px; color: var(--secondary-text-color); display: flex; flex-wrap: wrap; gap: 4px 16px; }
  .people b { color: var(--primary-text-color); font-weight: 600; }
  .msg { padding: 16px; font-size: 14px; color: var(--secondary-text-color); }
`;

const ago = (st) => {
  const t = st && new Date(st.last_changed || st.last_updated || 0).getTime();
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

export class HouseWadPlanCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.config = {};
    this._hass = null;
    this.plan = null;
    this.built = null;
    this.floor = null;
  }

  setConfig(config) {
    if (!config.floorplan && !config.floorplan_from) throw new Error('give the card a floorplan, or floorplan_from: the dashboard with your house.wad card');
    this.config = { ...config };
    this.plan = config.floorplan || null;
    this.built = null;
    this.floor = null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this.plan && this.config.floorplan_from && !this._fetching) this._fetchPlan();
    if (this.plan && !this.built) this._build();
    this._queueDraw();
  }

  getCardSize() {
    return 8;
  }

  // The plan from another dashboard: the first house.wad card there.
  async _fetchPlan() {
    this._fetching = true;
    try {
      const config = await this._hass.callWS({ type: 'lovelace/config', url_path: this.config.floorplan_from });
      const cards = [];
      const walk = (c) => {
        if (!c || typeof c !== 'object') return;
        if (Array.isArray(c)) return c.forEach(walk);
        if (c.type === 'custom:housewad-card' && c.floorplan) cards.push(c);
        for (const k of ['views', 'cards', 'sections', 'card']) if (c[k]) walk(c[k]);
      };
      walk(config);
      if (!cards.length) throw new Error(`no house.wad card with a floor plan on the "${this.config.floorplan_from}" dashboard`);
      this.plan = cards[0].floorplan;
      this._build();
      this._queueDraw();
    } catch (e) {
      this._error = e.message || String(e);
      this._render();
    }
  }

  _build() {
    const hass = this._hass;
    if (!hass || !this.plan) return;
    try {
      const house = buildHouse(hass, { exclude: this.config.exclude || [] });
      const { lumps, manifest } = generateFromPlan(this.plan, house);
      const S = this.plan.scale || 64;
      // Floors: the main one and each level, by floor height.
      const levels = [{ key: '', name: 'Main floor', z: 0 }, ...Object.entries(this.plan.levels || {}).map(([key, lv]) => ({ key, name: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '), z: Math.round((lv.floor || 0) * S) }))];
      const floors = levels.filter((l) => manifest.rooms.some((r) => (r.floorZ || 0) === l.z && !r.annex));
      const houseRoom = new Map(house.rooms.map((r) => [r.id, r]));
      const rooms = manifest.rooms.map((r) => {
        const rects = r.rects || [r.bbox];
        const c = r.center || [(r.bbox.x1 + r.bbox.x2) / 2, (r.bbox.y1 + r.bbox.y2) / 2];
        const box = rects.find((q) => c[0] >= q.x1 && c[0] <= q.x2 && c[1] >= q.y1 && c[1] <= q.y2) || r.bbox;
        const named = r.name && !String(r.id).startsWith('_annex_path');
        return { id: r.id, z: r.floorZ || 0, annex: !!r.annex, rects: [...rects, ...joinStrips(rects)], c, box, name: named ? r.name : null, lights: (houseRoom.get(r.id)?.lights || []).map((l) => l.entity_id) };
      });
      this.built = {
        house,
        manifest,
        rooms,
        floors,
        walls: wallsFromLumps(lumps),
        locator: new PeopleLocator({ manifest, house, state: (id) => this._hass.states[id] }),
      };
      const want = floors.find((f) => f.key === (this.config.floor || ''));
      this.floor = (want || floors[0] || levels[0]).z;
      this._error = null;
    } catch (e) {
      this._error = `could not read the floor plan: ${e.message || e}`;
    }
    this._render();
  }

  _render() {
    const b = this.built;
    const title = this.config.title || 'Where is everyone';
    if (!b) {
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card><div class="head"><span class="title"></span></div><div class="msg"></div></ha-card>`;
      this.shadowRoot.querySelector('.title').textContent = title;
      this.shadowRoot.querySelector('.msg').textContent = this._error || 'Reading the floor plan...';
      return;
    }
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="head"><span class="title"></span><span class="floors"></span></div>
        <div class="map"><canvas></canvas></div>
        <div class="people" aria-live="polite"></div>
      </ha-card>`;
    this.shadowRoot.querySelector('.title').textContent = title;
    const tabs = this.shadowRoot.querySelector('.floors');
    if (b.floors.length > 1) {
      for (const f of b.floors) {
        const btn = document.createElement('button');
        btn.textContent = f.name;
        btn.dataset.z = String(f.z);
        btn.addEventListener('click', () => {
          this.floor = f.z;
          this._queueDraw();
        });
        tabs.appendChild(btn);
      }
    }
    const canvas = this.shadowRoot.querySelector('canvas');
    this.overmap = new OverMap(canvas);
    // Clicking a lamp switches its light; hovering says what is there.
    canvas.addEventListener('click', (e) => {
      const lamp = this._lampAt(e);
      if (lamp) this._hass.callService('light', 'toggle', { entity_id: lamp.entity });
    });
    canvas.addEventListener('mousemove', (e) => {
      const lamp = this._lampAt(e);
      const p = this._world(e);
      const room = p && b.rooms.find((r) => r.z === this.floor && r.name && r.rects.some((q) => p[0] >= q.x1 && p[0] <= q.x2 && p[1] >= q.y1 && p[1] <= q.y2));
      const name = (id) => this._hass.states[id]?.attributes.friendly_name || id;
      canvas.title = lamp ? `${name(lamp.entity)}: click to switch ${this._hass.states[lamp.entity]?.state === 'on' ? 'off' : 'on'}` : room ? room.name : '';
      canvas.style.cursor = lamp ? 'pointer' : '';
    });
    if (this._resize) this._resize.disconnect();
    this._resize = new ResizeObserver(() => this._queueDraw());
    this._resize.observe(this.shadowRoot.querySelector('.map'));
  }

  _world(e) {
    const canvas = this.shadowRoot.querySelector('canvas');
    if (!canvas || !this.overmap) return null;
    const r = canvas.getBoundingClientRect();
    return this.overmap.toWorld(e.clientX - r.left, e.clientY - r.top);
  }

  _lampAt(e) {
    const p = this._world(e);
    const f = this.overmap && this.overmap.fit;
    if (!p || !f) return null;
    const tol = 14 / f.s;
    let best = null;
    for (const l of this.built.manifest.lamps) {
      const room = this.built.rooms.find((r) => r.id === l.room);
      if (room && room.z !== this.floor) continue;
      const d = Math.hypot(l.x - p[0], l.y - p[1]);
      if (d <= tol && (!best || d < best.d)) best = { d, entity: l.entity };
    }
    return best;
  }

  _queueDraw() {
    if (this._raf || !this.built || !this.isConnected) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._draw();
    });
  }

  connectedCallback() {
    // People are smoothed towards where they seem to be: keep drawing a while.
    this._tick = setInterval(() => this._queueDraw(), 1500);
    this._queueDraw();
  }

  disconnectedCallback() {
    clearInterval(this._tick);
    if (this._resize) this._resize.disconnect();
  }

  _draw() {
    const b = this.built;
    const hass = this._hass;
    const map = this.shadowRoot.querySelector('.map');
    if (!b || !hass || !map || !this.overmap) return;
    for (const btn of this.shadowRoot.querySelectorAll('.floors button')) btn.classList.toggle('on', Number(btn.dataset.z) === this.floor);
    const onFloor = b.rooms.filter((r) => r.z === this.floor && !r.annex);
    const bb = onFloor.flatMap((r) => r.rects).reduce((a, q) => ({ x1: Math.min(a.x1, q.x1), y1: Math.min(a.y1, q.y1), x2: Math.max(a.x2, q.x2), y2: Math.max(a.y2, q.y2) }), { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity });
    if (!Number.isFinite(bb.x1)) return;
    const pad = 0.04 * Math.max(bb.x2 - bb.x1, bb.y2 - bb.y1);
    const view = { x: bb.x1 - pad, y: bb.y1 - pad, w: bb.x2 - bb.x1 + 2 * pad, h: bb.y2 - bb.y1 + 2 * pad, fw: 320, fh: 168 };
    // As tall as the floor is, for the card's width (within reason).
    const height = Math.round(Math.min(Math.max(map.clientWidth * (view.h / view.w), 180), 720));
    if (map.style.height !== `${height}px`) map.style.height = `${height}px`;

    const { people, whereIs } = b.locator.peopleRooms();
    const things = [];
    const lines = [];
    for (const p of people) {
      const room = whereIs.get(p.id);
      const info = room && b.rooms.find((r) => r.id === room);
      lines.push({ who: p.label || p.name, where: info ? info.name || room : p.st && ['not_home', 'away'].includes(p.st.state) ? 'away' : 'not heard', when: ago(p.st) });
      if (!info || info.z !== this.floor) continue;
      const pos = b.locator.position(p, room);
      if (pos) things.push({ x: pos[0], y: pos[1], kind: 'person', label: p.label || p.name });
    }
    const here = new Set(onFloor.map((r) => r.id));
    this.overmap.draw({
      view,
      walls: b.walls.walls,
      doors: b.walls.doors,
      rooms: b.rooms.filter((r) => r.z === this.floor).map((r) => ({ ...r, lit: r.lights.map((id) => lightColour(hass.states[id])).filter(Boolean), lights: r.lights.length })),
      lamps: b.manifest.lamps.filter((l) => here.has(l.room)).map((l) => ({ x: l.x, y: l.y, colour: lightColour(hass.states[l.entity]) })),
      things,
      player: null,
      hoverRoom: null,
      unitsPerMetre: b.manifest.unitsPerMetre || 0,
    });
    const list = this.shadowRoot.querySelector('.people');
    const text = lines.map((l) => `${l.who}|${l.where}|${l.when}`).join('\n');
    if (list.dataset.text !== text) {
      list.dataset.text = text;
      list.replaceChildren(
        ...(lines.length
          ? lines.map((l) => {
              const span = document.createElement('span');
              const who = document.createElement('b');
              who.textContent = l.who;
              span.append(who, `: ${l.where}${l.when && l.where !== 'not heard' ? ` (${l.when})` : ''}`);
              return span;
            })
          : [Object.assign(document.createElement('span'), { textContent: 'Nobody followed yet: turn on the Companion app’s BLE Transmitter and add the phone in Bermuda.' })]),
      );
    }
  }
}

if (!customElements.get('housewad-plan-card')) {
  customElements.define('housewad-plan-card', HouseWadPlanCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'housewad-plan-card',
    name: 'house.wad floor plan',
    description: 'Your floor plan, live: rooms in their lights’ colours, click a lamp to switch it, and where everybody’s phone is.',
  });
}
