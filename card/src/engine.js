// Runs one Doom session in a canvas: boots the WebAssembly engine with an
// IWAD and the generated house PWAD, blits frames, plays sound and feeds input.

import { DoomSound } from './sound.js';

const EV_KEYDOWN = 0;
const EV_KEYUP = 1;
const EV_MOUSE = 2;

export const KEY = {
  RIGHT: 0xae,
  LEFT: 0xac,
  UP: 0xad,
  DOWN: 0xaf,
  STRAFE_L: 0xa0,
  STRAFE_R: 0xa1,
  USE: 0xa2,
  FIRE: 0xa3,
  ESCAPE: 27,
  ENTER: 13,
  TAB: 9,
  BACKSPACE: 0x7f,
  RSHIFT: 0x80 + 0x36,
  RALT: 0x80 + 0x38,
};

// Browser KeyboardEvent.code -> Doom key. Letters and digits not listed here
// pass through as their lowercase character (menus, cheats, weapon numbers).
const CODE_TO_KEY = {
  ArrowUp: KEY.UP,
  ArrowDown: KEY.DOWN,
  ArrowLeft: KEY.LEFT,
  ArrowRight: KEY.RIGHT,
  KeyW: KEY.UP,
  KeyS: KEY.DOWN,
  KeyA: KEY.STRAFE_L,
  KeyD: KEY.STRAFE_R,
  KeyE: KEY.USE,
  Space: KEY.USE,
  ControlLeft: KEY.FIRE,
  ControlRight: KEY.FIRE,
  ShiftLeft: KEY.RSHIFT,
  ShiftRight: KEY.RSHIFT,
  AltLeft: KEY.RALT,
  AltRight: KEY.RALT,
  Escape: KEY.ESCAPE,
  Enter: KEY.ENTER,
  Tab: KEY.TAB,
  Backspace: KEY.BACKSPACE,
  Minus: 0x2d,
  Equal: 0x3d,
};

export class DoomEngine {
  constructor(module, canvas) {
    this.module = module;
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d');
    this.image = null;
    this.sound = new DoomSound();
    this.mouseButtons = 0;
    this.stopped = false;
    this.pressed = new Set();
    this.frames = 0;
  }

  // engineFactory: the createHouseWadEngine export of housewad-engine.js.
  // files: { 'name.wad': Uint8Array } written into the engine's filesystem.
  static async start({ engineFactory, wasmUrl, canvas, files, args, onHouseEvent, onExit, onFatal, beforeMain, print }) {
    let engine = null;
    const module = await engineFactory({
      locateFile: (path, prefix) => (path.endsWith('.wasm') && wasmUrl ? wasmUrl : prefix + path),
      print: print || (() => {}),
      printErr: print || (() => {}),
      hwPresent: (ptr, w, h) => engine && engine._present(ptr, w, h),
      hwSoundStart: (lump, ptr, len, channel, vol, sep) =>
        engine && engine.sound.start(lump, module.HEAPU8.subarray(ptr, ptr + len), channel, vol, sep),
      hwSoundUpdate: (channel, vol, sep) => engine && engine.sound.update(channel, vol, sep),
      hwSoundStop: (channel) => engine && engine.sound.stop(channel),
      hwSoundPlaying: (channel) => engine && engine.sound.playing(channel),
      hwEvent: (...a) => onHouseEvent && onHouseEvent(...a),
      quit: (status) => onExit && onExit(status),
      hwFatal: (message) => {
        if (engine) engine.stopped = true;
        if (onFatal) onFatal(message);
      },
    });
    engine = new DoomEngine(module, canvas);
    for (const [name, bytes] of Object.entries(files)) module.FS.writeFile(name, bytes);
    if (beforeMain) beforeMain(module);
    try {
      module.callMain(args);
    } catch (e) {
      if (!(e && e.name === 'ExitStatus')) throw e;
    }
    return engine;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    try {
      this.module._hw_stop();
    } catch (e) {
      // Runtime already gone.
    }
    this.sound.close();
  }

  _present(ptr, w, h) {
    if (!this.image || this.image.width !== w || this.image.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.image = this.ctx2d.createImageData(w, h);
      this.out32 = new Uint32Array(this.image.data.buffer);
    }
    // XRGB words to RGBA bytes (little-endian ABGR words).
    const src = this.module.HEAPU32.subarray(ptr >> 2, (ptr >> 2) + w * h);
    const out = this.out32;
    for (let i = 0; i < src.length; i++) {
      const p = src[i];
      out[i] = 0xff000000 | ((p & 0xff) << 16) | (p & 0xff00) | ((p >> 16) & 0xff);
    }
    this.ctx2d.putImageData(this.image, 0, 0);
    this.frames++;
  }

  // Doom-level input -----------------------------------------------------

  keyDown(key, ch = 0) {
    if (this.stopped) return;
    this.pressed.add(key);
    this.module._hw_post_event(EV_KEYDOWN, key, ch || key, 0);
  }

  keyUp(key) {
    if (this.stopped) return;
    this.pressed.delete(key);
    this.module._hw_post_event(EV_KEYUP, key, 0, 0);
  }

  releaseAll() {
    for (const key of [...this.pressed]) this.keyUp(key);
    this.mouse(0, 0, 0);
  }

  tap(key, ms = 120) {
    this.keyDown(key);
    setTimeout(() => this.keyUp(key), ms);
  }

  // Mouse turn and buttons: bit 0 fire, bit 1 strafe, bit 2 forward.
  mouse(dx, dy, buttons = this.mouseButtons) {
    if (this.stopped) return;
    this.mouseButtons = buttons;
    this.module._hw_post_event(EV_MOUSE, buttons, dx | 0, dy | 0);
  }

  // Browser event translation ---------------------------------------------

  // Returns true when the event was used (the caller then prevents default).
  handleKeyboard(event) {
    const down = event.type === 'keydown';
    let key = CODE_TO_KEY[event.code];
    let ch = 0;
    if (key === undefined) {
      if (event.key && event.key.length === 1) {
        key = event.key.toLowerCase().charCodeAt(0);
        if (key > 127) return false;
      } else {
        return false;
      }
    }
    if (event.key && event.key.length === 1) ch = event.key.toLowerCase().charCodeAt(0);
    if (down) {
      if (event.repeat) return true;
      this.keyDown(key, ch);
    } else {
      this.keyUp(key);
    }
    return true;
  }
}
