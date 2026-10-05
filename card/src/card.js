// <housewad-card>: your house as a Doom level, in a Lovelace card.
//
//   type: custom:housewad-card
//   allow:                 # what "Play for real" may control
//     - light.*
//     - switch.*
//     - media_player.*
//     - vacuum.*
//     - lock.front_door    # locks and door covers: one by one, never by pattern
//   exclude: [switch.server_rack]   # leave things out of the house entirely
//   skill: 3               # 1 (too young to die) .. 5 (nightmare)
//   confirm_unlock: true   # ask (Y/N) before unlocking a lock or opening a door cover
//   flies: true            # HouseFly brains walk the level (shoot one: it gets loomed)
//   exit_scene: scene.leaving_home   # the exit switch runs this
//   cheats: { idcoffee: script.make_coffee }   # type a cheat code, run a thing
//   floorplan: { rooms: [...], doors: [...], exits: [...] }   # the real layout (see planmap.js)
//   rules: { empty_minutes: 10, standby_min: 0.3, standby_max: 15 }

import { DoomEngine, KEY } from './engine.js';
import { buildHouse } from './model.js';
import { generateMap } from './mapgen.js';
import { generateFromPlan } from './planmap.js';
import { writeWad, readWad, textPatch } from './wad.js';
import { buildNodes } from './nodes.js';
import { HouseActions, makeAllow, DEFAULT_ALLOW, entityContext } from './actions.js';
import { HouseLink, hudText } from './house.js';

const VERSION = '0.1.0';
const ASSETS = new URL('./', import.meta.url);

// Every file the card loads carries its version, so an upgrade never pairs a
// new card with an engine the browser kept from the last one.
function asset(name, base) {
  const url = new URL(name, base);
  url.searchParams.set('v', VERSION);
  return url.href;
}

// The engine exports the card needs; a missing one means mismatched files.
const ENGINE_EXPORTS = ['_hw_spawn', '_hw_aim', '_hw_level_title', '_hw_puppet', '_hw_texture_write', '_hw_confirm'];

let iwadPromise = null;
function loadIwad(base) {
  if (!iwadPromise) {
    iwadPromise = fetch(asset('freedoom2.wad', base)).then((r) => {
      if (!r.ok) throw new Error(`could not load the game data (${r.status})`);
      return r.arrayBuffer().then((b) => new Uint8Array(b));
    });
    iwadPromise.catch(() => {
      iwadPromise = null;
    });
  }
  return iwadPromise;
}

const STYLE = `
  :host { display: block; }
  ha-card, .card { display: block; overflow: hidden; background: var(--ha-card-background, var(--card-background-color, #111)); color: var(--primary-text-color, #eee); border-radius: var(--ha-card-border-radius, 12px); }
  /* Never taller than the window: in a panel view the strip under the game stays in sight. */
  :host { --hw-width: min(100%, calc((100dvh - var(--header-height, 56px) - 96px) * 4 / 3)); }
  .screen { position: relative; width: var(--hw-width); margin: 0 auto; aspect-ratio: 4 / 3; background: #000; outline: none; touch-action: none; user-select: none; -webkit-user-select: none; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; image-rendering: crisp-edges; }
  .start, .busy { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 16px; box-sizing: border-box; text-align: center; background: radial-gradient(circle at 50% 40%, #3a0a05 0%, #0b0000 75%); color: #f2d7a6; font-family: ui-monospace, Menlo, Consolas, monospace; }
  .title { font-size: clamp(28px, 7vw, 56px); font-weight: 900; letter-spacing: 2px; color: #ff3b1f; text-shadow: 0 3px 0 #5a0000, 0 0 24px #ff3b1f66; }
  .sub { font-size: 14px; opacity: .85; max-width: 32em; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
  button { font: inherit; font-size: 14px; padding: 10px 16px; border-radius: 8px; border: 2px solid #ff3b1f; background: #200; color: #ffe6c0; cursor: pointer; }
  button.real { background: #ff3b1f; color: #200; font-weight: 800; }
  button:focus-visible { outline: 3px solid #ffd27a; outline-offset: 2px; }
  .small { font-size: 12px; opacity: .75; max-width: 36em; }
  .warn { color: #ffb347; }
  .bar { display: flex; align-items: center; gap: 8px; width: var(--hw-width); margin: 0 auto; box-sizing: border-box; padding: 6px 10px; font-size: 12px; font-family: ui-monospace, Menlo, Consolas, monospace; }
  .bar .mode { padding: 2px 8px; border-radius: 999px; font-weight: 800; }
  .bar .mode.real { background: #ff3b1f; color: #200; }
  .bar .mode.practice { background: #444; color: #eee; }
  .bar .spacer { flex: 1; }
  .bar button { padding: 4px 10px; font-size: 12px; border-width: 1px; }
  .touch { position: absolute; inset: auto 0 17% 0; display: none; justify-content: space-between; padding: 8px; pointer-events: none; }
  .touch.on { display: flex; }
  .pad { display: grid; grid-template-columns: repeat(3, 44px); grid-template-rows: repeat(3, 44px); gap: 4px; pointer-events: auto; }
  .pad div, .act div { background: #fff2; border: 1px solid #fff5; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #fff; font: 700 12px ui-monospace, monospace; }
  .act { display: flex; flex-direction: column; gap: 8px; pointer-events: auto; }
  .act div { width: 64px; height: 48px; }
  .hint { opacity: .6; }
  .status { display: flex; flex-wrap: wrap; gap: 4px 14px; width: var(--hw-width); margin: 0 auto; box-sizing: border-box; padding: 6px 10px 0; min-height: 18px; font: 12px ui-monospace, Menlo, Consolas, monospace; }
  .status span:empty { display: none; }
  .status .where { font-weight: 800; color: #ff7a5c; }
  .status .aim::before { content: 'Aiming at: '; opacity: .6; }
  .status .last::before { content: 'Last: '; opacity: .6; }
  .status .world::before { content: 'Out there: '; opacity: .6; }
  .wrap:fullscreen { display: flex; flex-direction: column; justify-content: center; background: #000; color: #eee; }
  .wrap:fullscreen { --hw-width: min(100vw, calc((100vh - 64px) * 4 / 3)); }
  .confirm { position: absolute; left: 0; right: 0; bottom: 22%; display: none; justify-content: center; gap: 16px; }
  .confirm.on { display: flex; }
  .confirm button { font-size: 18px; padding: 10px 28px; }
`;

class HouseWadCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this.config = {};
    this.engine = null;
    this.link = null;
    this.actions = null;
    this.timers = [];
    this.syncQueued = false;
  }

  static getStubConfig() {
    return { allow: DEFAULT_ALLOW };
  }

  setConfig(config) {
    this.config = { skill: 3, ...config };
    this.allow = makeAllow(this.config.allow || DEFAULT_ALLOW);
    if (!this.engine) this._renderStart();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first && !this.engine) this._renderStart();
    this._queueSync();
  }

  get hass() {
    return this._hass;
  }

  getCardSize() {
    return 9;
  }

  connectedCallback() {
    if (!this.shadowRoot.firstChild) this._renderStart();
  }

  disconnectedCallback() {
    this._stop();
  }

  // Start screen --------------------------------------------------------------

  _renderStart(error) {
    this._stop();
    const hass = this._hass;
    let summary = 'Waiting for Home Assistant...';
    let reach = '';
    if (hass) {
      const house = buildHouse(hass, { exclude: this.config.exclude || [] });
      const count = (k) => house.rooms.reduce((n, r) => n + r[k].length, 0);
      summary = `${house.rooms.length} rooms, ${count('lights')} lights, ${count('switches')} switches, ${count('doors')} doors`;
      if (this.allow) {
        // What "Play for real" could actually touch, so nobody finds out by shooting it.
        let yes = 0;
        let guarded = 0;
        const ids = new Set();
        for (const r of house.rooms) for (const k of ['lights', 'switches', 'media', 'vacuums', 'doors']) for (const e of r[k] || []) ids.add(e.entity_id || e.lock || e.cover || e);
        for (const id of ids) {
          if (typeof id !== 'string') continue;
          const st = hass.states[id];
          const v = this.allow.verdict(id, (st && st.attributes.friendly_name) || '', entityContext(hass, id));
          if (v === 'yes') yes++;
          else if (v === 'important') guarded++;
        }
        reach = ` (${yes} things${guarded ? `; ${guarded} ${guarded === 1 ? 'switch that looks' : 'switches that look'} important ${guarded === 1 ? 'is' : 'are'} left alone` : ''})`;
      }
    }
    const allowText = this.allow ? this.allow.patterns.join(', ') : '';
    const warnings = this.allow && this.allow.warnings.length ? `<div class="small warn">${this.allow.warnings.map(esc).join('<br>')}</div>` : '';
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="screen">
          <div class="start">
            <div class="title">HOUSE.WAD</div>
            <div class="sub">Your house, as a Doom level. ${esc(summary)}.</div>
            ${error ? `<div class="small warn">${esc(error)}</div>` : ''}
            <div class="row">
              <button class="practice">Practice</button>
              <button class="real">Play for real</button>
            </div>
            <div class="small">Practice: nothing in the house moves.<br>For real: shooting and using things controls <b>${esc(allowText)}</b>${esc(reach)}.</div>
            ${warnings}
            <div class="small hint">${matchMedia('(pointer: coarse)').matches ? 'Arrows to move, FIRE and USE buttons. Full screen and turn the phone sideways for a bigger view.' : 'WASD or arrows, mouse to turn, click or Ctrl to fire, E or Space to use'}</div>
          </div>
        </div>
      </ha-card>`;
    const root = this.shadowRoot;
    root.querySelector('button.practice').addEventListener('click', () => this._start('practice'));
    root.querySelector('button.real').addEventListener('click', () => this._start('real'));
  }

  // Running ---------------------------------------------------------------------

  async _start(mode) {
    if (!this._hass) return;
    const base = this.config.assets_url ? new URL(this.config.assets_url, location.href) : ASSETS;
    this.shadowRoot.querySelector('.start').innerHTML = `<div class="title">HOUSE.WAD</div><div class="sub">Building your house...</div>`;
    try {
      const house = buildHouse(this._hass, { exclude: this.config.exclude || [] });
      // A floor plan in the card config builds the house as it really is;
      // without one, rooms go off a corridor. (Inline, not a /local file:
      // /local is served without a login.)
      const { lumps, manifest } = this.config.floorplan ? generateFromPlan(this.config.floorplan, house) : generateMap(house);
      const [{ default: createZdbsp }, { default: createEngine }, iwad] = await Promise.all([
        import(/* @vite-ignore */ asset('housewad-zdbsp.js', base)),
        import(/* @vite-ignore */ asset('housewad-engine.js', base)),
        loadIwad(base),
      ]);
      // The tally screen names the level with a picture: make one of the home.
      const home = hudText((this._hass.config && this._hass.config.location_name) || 'Home').slice(0, 24);
      try {
        const title = textPatch(readWad(iwad), home);
        lumps.push({ name: 'CWILV00', data: title }, { name: 'CWILV01', data: title });
      } catch (e) {
        // Freedoom's own titles will do.
      }
      const pwad = await buildNodes(createZdbsp, writeWad(lumps), { wasmUrl: asset('housewad-zdbsp.wasm', base) });
      this._renderGame(mode);
      const canvas = this.shadowRoot.querySelector('canvas');
      this.actions = new HouseActions({
        getHass: () => this._hass,
        mode,
        allow: this.allow,
        onChange: (change) => {
          if (change.error && this.link) this.link.message(`Home Assistant says no: ${change.error}`);
          this._queueSync();
        },
      });
      let pending = [];
      this.engine = await DoomEngine.start({
        engineFactory: createEngine,
        wasmUrl: asset('housewad-engine.wasm', base),
        canvas,
        files: { 'freedoom2.wad': iwad, 'house.wad': pwad },
        args: ['-iwad', 'freedoom2.wad', '-file', 'house.wad', '-warp', '1', '-skill', String(this.config.skill || 3)],
        onHouseEvent: (...e) => (this.link ? this.link.onEvent(...e) : pending.push(e)),
        onFatal: (message) => setTimeout(() => this._renderStart(`The game stopped: ${message}`), 0),
        beforeMain: (m) => {
          const missing = ENGINE_EXPORTS.filter((f) => typeof m[f] !== 'function');
          if (missing.length) {
            throw new Error(`the game engine is out of date (${missing.join(', ')} missing). Reload the page; if that does not help, clear the browser cache for this site.`);
          }
          const home = (this._hass.config && this._hass.config.location_name) || 'Home';
          m.ccall('hw_level_title', null, ['string'], [hudText(`MAP01: ${home}`)]);
        },
        print: (s) => this.config.debug && console.log('[housewad]', s),
      });
      this.link = new HouseLink({
        engine: this.engine,
        manifest,
        house,
        actions: this.actions,
        rules: this.config.rules || {},
        confirmUnlock: this.config.confirm_unlock !== false,
        flies: this.config.flies,
        cheats: Object.fromEntries(Object.entries(this.config.cheats || {}).map(([k, v]) => [k.toLowerCase(), v])),
        exitScene: this.config.exit_scene || null,
        palette: playpal(iwad),
        onConfirm: (pending) => {
          const box = this.shadowRoot.querySelector('.confirm');
          if (box) box.classList.toggle('on', pending);
        },
        log: (s) => console.warn('[housewad]', s),
      });
      for (const e of pending) this.link.onEvent(...e);
      pending = [];
      this.engine.sound.resume();
      this._bindInput();
      this.timers.push(setInterval(() => this.link && this.link.tick(), 250));
      this.timers.push(setInterval(() => this.link && this.link.cameraTick(), 300));
      this.timers.push(setInterval(() => this._showStatus(), 250));
      this.timers.push(setInterval(() => this.link && this.link.sync(), 1000));
      this.shadowRoot.querySelector('.screen').focus();
    } catch (e) {
      console.error('[housewad]', e);
      this._renderStart(`Could not start: ${e.message || e}`);
    }
  }

  _renderGame(mode) {
    const touch = matchMedia('(pointer: coarse)').matches;
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="wrap">
        <div class="screen" tabindex="0" aria-label="house.wad game. Click to capture the mouse.">
          <canvas width="320" height="200"></canvas>
          <div class="confirm">
            <button data-answer="y">YES</button>
            <button data-answer="n">NO</button>
          </div>
          <div class="touch ${touch ? 'on' : ''}">
            <div class="pad">
              <span></span><div data-key="${KEY.UP}">&#9650;</div><span></span>
              <div data-key="${KEY.LEFT}">&#9664;</div><div data-key="${KEY.USE}">USE</div><div data-key="${KEY.RIGHT}">&#9654;</div>
              <span></span><div data-key="${KEY.DOWN}">&#9660;</div><span></span>
            </div>
            <div class="act">
              <div data-key="${KEY.FIRE}">FIRE</div>
              <div data-key="${KEY.USE}">USE</div>
            </div>
          </div>
        </div>
        <div class="status" aria-live="polite">
          <span class="where"></span>
          <span class="aim"></span>
          <span class="last"></span>
          <span class="world"></span>
        </div>
        <div class="bar">
          <span class="mode ${mode}">${mode === 'real' ? 'LIVE: THIS IS YOUR HOUSE' : 'PRACTICE'}</span>
          <span class="spacer"></span>
          <button class="full">Full screen</button>
          <button class="quit">Quit</button>
        </div>
        </div>
      </ha-card>`;
    this.shadowRoot.querySelector('button.quit').addEventListener('click', () => this._renderStart());
    this.shadowRoot.querySelector('button.full').addEventListener('click', () => {
      const wrap = this.shadowRoot.querySelector('.wrap');
      if (wrap.requestFullscreen) wrap.requestFullscreen();
    });
  }

  _bindInput() {
    const screen = this.shadowRoot.querySelector('.screen');
    const engine = this.engine;
    // In a shadow root the document reports the host as the locked element.
    const locked = () => this.shadowRoot.pointerLockElement === screen || document.pointerLockElement === this;
    const onKey = (e) => {
      if (!this.engine) return;
      if (engine.handleKeyboard(e)) {
        e.preventDefault();
        e.stopPropagation();
        const midCheat = e.code === 'KeyE' && this._midCheat();
        if (e.type === 'keydown' && /^[a-z0-9]$/i.test(e.key)) this._typed(e.key.toLowerCase());
        if (e.type === 'keydown' && !e.repeat && !midCheat && (e.code === 'KeyE' || e.code === 'Space')) this.link && this.link.useNearLamp();
      }
    };
    screen.addEventListener('keydown', onKey);
    screen.addEventListener('keyup', onKey);
    screen.addEventListener('blur', () => engine.releaseAll());

    screen.addEventListener('mousedown', (e) => {
      screen.focus();
      engine.sound.resume();
      if (!locked() && screen.requestPointerLock && !matchMedia('(pointer: coarse)').matches) {
        screen.requestPointerLock();
        return;
      }
      if (e.button === 0) engine.mouse(0, 0, engine.mouseButtons | 1);
    });
    screen.addEventListener('mouseup', (e) => {
      if (e.button === 0) engine.mouse(0, 0, engine.mouseButtons & ~1);
    });
    screen.addEventListener('mousemove', (e) => {
      if (locked()) engine.mouse(Math.round(e.movementX * 4), 0);
    });

    for (const el of this.shadowRoot.querySelectorAll('[data-answer]')) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        engine.tap(el.dataset.answer.charCodeAt(0));
        screen.focus();
      });
      el.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    for (const el of this.shadowRoot.querySelectorAll('[data-key]')) {
      const key = Number(el.dataset.key);
      const down = (e) => {
        e.preventDefault();
        engine.sound.resume();
        engine.keyDown(key);
        if (key === KEY.USE) this.link && this.link.useNearLamp();
      };
      const up = (e) => {
        e.preventDefault();
        engine.keyUp(key);
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointerleave', up);
      el.addEventListener('pointercancel', up);
    }
  }

  // Halfway through typing a cheat code? (Its "e" is not a lamp switch.)
  _midCheat() {
    const buf = this.typedBuf || '';
    const codes = ['idbeholdl', ...Object.keys((this.link && this.link.cheats) || {})];
    return codes.some((c) => {
      for (let n = 2; n < c.length; n++) if (buf.endsWith(c.slice(0, n))) return true;
      return false;
    });
  }

  _typed(ch) {
    this.typedBuf = ((this.typedBuf || '') + ch).slice(-24);
    if (!this.link) return;
    const codes = ['idbeholdl', ...Object.keys(this.link.cheats)];
    const hit = codes.find((c) => this.typedBuf.endsWith(c));
    if (hit) {
      this.typedBuf = '';
      this.link.runCheat(hit);
    }
  }

  _showStatus() {
    if (!this.link) return;
    const s = this.link.status();
    const set = (cls, text) => {
      const el = this.shadowRoot.querySelector(`.status .${cls}`);
      if (el && el.textContent !== text) el.textContent = text;
    };
    set('where', s.room || '');
    set('aim', s.target || '');
    const age = s.last ? Math.round((Date.now() - s.last.at) / 1000) : 0;
    set('last', s.last ? `${s.last.text}${age > 2 ? ` (${age < 90 ? age + 's' : Math.round(age / 60) + 'm'} ago)` : ''}` : '');
    set('world', s.world || '');
  }

  _queueSync() {
    if (!this.link || this.syncQueued) return;
    this.syncQueued = true;
    setTimeout(() => {
      this.syncQueued = false;
      if (this.link) this.link.sync();
    }, 100);
  }

  _stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.link) this.link.close();
    this.link = null;
    if (this.actions) this.actions.close();
    this.actions = null;
    if (this.engine) this.engine.stop();
    this.engine = null;
    if (document.pointerLockElement === this) document.exitPointerLock();
  }
}

// The game's first palette: 256 RGB triples.
function playpal(iwad) {
  try {
    const w = readWad(iwad);
    const lump = w.find('PLAYPAL');
    return lump ? w.data(lump).slice(0, 768) : null;
  } catch (e) {
    return null;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

if (!customElements.get('housewad-card')) {
  customElements.define('housewad-card', HouseWadCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'housewad-card',
    name: 'house.wad',
    description: 'Your house as a Doom level. Shooting the lamp turns off the light.',
    preview: false,
  });
  console.info(`%c house.wad %c ${VERSION} `, 'background:#ff3b1f;color:#200;font-weight:700', 'background:#200;color:#ffe6c0');
}
