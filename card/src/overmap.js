// The overhead map, drawn by the card at the screen's own resolution.
//
// Doom draws its automap into a 320x200 frame, where a room on a whole-floor
// map is a few dozen pixels and its name has to be squeezed into a 3x5 font.
// While the map is up the card lays a canvas of its own over the game and
// draws the same view again, sharp: the walls from the level itself, each
// room filled in the colour of its lights that are on (a stripe for each
// light), the lamps, the demons, the people and the player. Doom still owns
// the view (pan, zoom, which floor), so the mouse works the same either way.

import { SPECIAL } from './mapgen.js';

const DOOR_SPECIALS = new Set([1, SPECIAL.DOOR]);

// The level's walls and doors, as map-unit segments, from its lumps.
export function wallsFromLumps(lumps) {
  const lump = (name) => lumps.find((l) => l.name === name)?.data;
  const lines = lump('LINEDEFS');
  const verts = lump('VERTEXES');
  const walls = [];
  const doors = [];
  if (!lines || !verts) return { walls, doors };
  const lv = new DataView(lines.buffer, lines.byteOffset, lines.byteLength);
  const vv = new DataView(verts.buffer, verts.byteOffset, verts.byteLength);
  const vertex = (i) => [vv.getInt16(i * 4, true), vv.getInt16(i * 4 + 2, true)];
  for (let o = 0; o + 14 <= lines.byteLength; o += 14) {
    const [x1, y1] = vertex(lv.getUint16(o, true));
    const [x2, y2] = vertex(lv.getUint16(o + 2, true));
    const special = lv.getUint16(o + 6, true);
    const twoSided = lv.getUint16(o + 12, true) !== 0xffff;
    if (!twoSided) walls.push([x1, y1, x2, y2]);
    else if (DOOR_SPECIALS.has(special)) doors.push([x1, y1, x2, y2]);
  }
  return { walls, doors };
}

// Roughly the colour of a white light at this colour temperature.
export function kelvinToRgb(k) {
  const t = Math.min(40000, Math.max(1000, k)) / 100;
  const clamp = (v) => Math.round(Math.min(255, Math.max(0, v)));
  const r = t <= 66 ? 255 : 329.7 * (t - 60) ** -0.1332;
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * (t - 60) ** -0.0755;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  return [clamp(r), clamp(g), clamp(b)];
}

function hsToRgb(h, s) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return 255 * (1 - (s / 100) * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [Math.round(f(5)), Math.round(f(3)), Math.round(f(1))];
}

// The colour a light is giving off: [r, g, b, strength 0..1], or null when it
// is off. A light that says nothing about colour is a warm white.
export function lightColour(st) {
  if (!st || st.state !== 'on') return null;
  const a = st.attributes || {};
  let rgb = null;
  if (Array.isArray(a.rgb_color) && a.rgb_color.length === 3) rgb = a.rgb_color.map(Number);
  else if (Array.isArray(a.hs_color) && a.hs_color.length === 2) rgb = hsToRgb(Number(a.hs_color[0]), Number(a.hs_color[1]));
  else if (a.color_temp_kelvin) rgb = kelvinToRgb(Number(a.color_temp_kelvin));
  else if (a.color_temp) rgb = kelvinToRgb(1e6 / Number(a.color_temp));
  if (!rgb || rgb.some((v) => !Number.isFinite(v))) rgb = [255, 196, 120];
  const level = a.brightness === undefined || a.brightness === null ? 1 : Math.max(0, Math.min(255, Number(a.brightness))) / 255;
  return [...rgb, Number.isFinite(level) ? level : 1];
}

const css = (c, alpha) => `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;

export class OverMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = null;
  }

  // Map units to CSS pixels of the overlay, and back. The view is Doom's
  // window on the map, shown whole with square pixels (Doom's own are
  // stretched), so there is a little more map above and below.
  _fit(view, w, h) {
    const s = Math.min(w / view.w, h / view.h);
    return { s, cx: view.x + view.w / 2, cy: view.y + view.h / 2, w, h };
  }

  toWorld(px, py) {
    if (!this.fit) return null;
    const f = this.fit;
    return [f.cx + (px - f.w / 2) / f.s, f.cy - (py - f.h / 2) / f.s];
  }

  // A pointer on the overlay as a pixel of Doom's frame, which is what the
  // engine's pan, zoom and map-point calls take. Off the frame is fine.
  toDoom(px, py) {
    const p = this.toWorld(px, py);
    const v = this.view;
    if (!p || !v) return [NaN, NaN];
    return [((p[0] - v.x) / v.w) * v.fw, v.fh - ((p[1] - v.y) / v.h) * v.fh];
  }

  // A pixel of Doom's frame as a point on the overlay (CSS pixels).
  fromDoom(sx, sy) {
    const v = this.view;
    const f = this.fit;
    if (!v || !f) return null;
    const per = v.w / v.fw;
    const x = v.x + sx * per;
    const y = v.y + (v.fh - sy) * per;
    return [f.w / 2 + (x - f.cx) * f.s, f.h / 2 - (y - f.cy) * f.s];
  }

  // scene: { view, walls, doors, rooms, lamps, things, player, hoverRoom, unitsPerMetre }
  draw(scene) {
    const { canvas, ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h || !scene.view) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    this.view = scene.view;
    const f = (this.fit = this._fit(scene.view, w, h));
    const X = (x) => (w / 2 + (x - f.cx) * f.s) * dpr;
    const Y = (y) => (h / 2 - (y - f.cy) * f.s) * dpr;
    const px = dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Rooms: dark, or in their lights' colours.
    const rectPath = (rects) => {
      ctx.beginPath();
      for (const r of rects) ctx.rect(X(r.x1), Y(r.y2), (r.x2 - r.x1) * f.s * dpr, (r.y2 - r.y1) * f.s * dpr);
    };
    for (const room of scene.rooms) {
      rectPath(room.rects);
      if (!room.lit.length) {
        ctx.fillStyle = room.lights ? '#1c1c22' : '#141418';
        ctx.fill();
        continue;
      }
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#1c1c22';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const alpha = (c) => 0.35 + 0.6 * c[3];
      if (room.lit.length === 1) {
        ctx.fillStyle = css(room.lit[0], alpha(room.lit[0]));
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        // A diagonal stripe for each light, repeating across the room.
        const band = Math.max(8, 12 * px);
        const b = room.rects.reduce((a, r) => ({ x1: Math.min(a.x1, r.x1), x2: Math.max(a.x2, r.x2), y1: Math.min(a.y1, r.y1), y2: Math.max(a.y2, r.y2) }), { x1: Infinity, x2: -Infinity, y1: Infinity, y2: -Infinity });
        const left = X(b.x1);
        const top = Y(b.y2);
        const span = (b.x2 - b.x1 + (b.y2 - b.y1)) * f.s * dpr;
        for (let i = 0, at = left - (b.y2 - b.y1) * f.s * dpr; at < left + span; i++, at += band) {
          const c = room.lit[i % room.lit.length];
          ctx.fillStyle = css(c, alpha(c));
          ctx.beginPath();
          ctx.moveTo(at, top);
          ctx.lineTo(at + band, top);
          ctx.lineTo(at + band + span, top + span);
          ctx.lineTo(at + span, top + span);
          ctx.fill();
        }
      }
      ctx.restore();
    }
    if (scene.hoverRoom) {
      rectPath(scene.hoverRoom.rects);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();
    }

    // Walls, then doors as gaps with a thin leaf.
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#d8d2c0';
    ctx.lineWidth = Math.max(1.5, 2 * px);
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of scene.walls) {
      ctx.moveTo(X(x1), Y(y1));
      ctx.lineTo(X(x2), Y(y2));
    }
    ctx.stroke();
    ctx.strokeStyle = '#b07a3a';
    ctx.lineWidth = Math.max(1, 1.5 * px);
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of scene.doors) {
      ctx.moveTo(X(x1), Y(y1));
      ctx.lineTo(X(x2), Y(y2));
    }
    ctx.stroke();

    // Room names, as big as fits the room, on one line or two.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const room of scene.rooms) {
      if (!room.name || !room.box) continue;
      const bw = (room.box.x2 - room.box.x1) * f.s * dpr - 8 * px;
      const bh = (room.box.y2 - room.box.y1) * f.s * dpr - 6 * px;
      const fit = fitText(ctx, room.name, bw, bh, px);
      if (!fit) continue;
      ctx.font = fit.font;
      ctx.lineWidth = Math.max(2, fit.size / 4);
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.fillStyle = '#f4efe2';
      const x = X(room.c[0]);
      const y0 = Y(room.c[1]) - ((fit.lines.length - 1) * fit.size * 1.1) / 2;
      fit.lines.forEach((line, i) => {
        ctx.strokeText(line, x, y0 + i * fit.size * 1.1);
        ctx.fillText(line, x, y0 + i * fit.size * 1.1);
      });
    }

    // Lamps: a bulb in its own colour, with a glow, or a grey ring when off.
    const r = Math.max(3, Math.min(9, 0.12 * (scene.unitsPerMetre || 64) * f.s)) * dpr;
    for (const l of scene.lamps) {
      ctx.beginPath();
      ctx.arc(X(l.x), Y(l.y), r, 0, Math.PI * 2);
      if (l.colour) {
        ctx.save();
        ctx.shadowColor = css(l.colour, 1);
        ctx.shadowBlur = 12 * px;
        ctx.fillStyle = css(l.colour, 1);
        ctx.fill();
        ctx.restore();
        // A dark rim and a white one: it stands out on its own colour.
        ctx.lineWidth = 3.5 * px;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.stroke();
        ctx.lineWidth = 1.5 * px;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      } else {
        ctx.fillStyle = '#2a2a2e';
        ctx.fill();
        ctx.lineWidth = 1.5 * px;
        ctx.strokeStyle = '#8a8a90';
        ctx.stroke();
      }
    }

    // Demons, people and fly brains.
    const colours = { demon: '#ff3b1f', asleep: '#8a2418', person: '#3ddc6a', fly: '#c6f04a' };
    for (const t of scene.things) {
      const x = X(t.x);
      const y = Y(t.y);
      ctx.fillStyle = colours[t.kind] || '#4a9eff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = px;
      ctx.beginPath();
      if (t.kind === 'person') ctx.arc(x, y, r * 1.1, 0, Math.PI * 2);
      else {
        const s = r * (t.big ? 1.9 : 1.3);
        ctx.moveTo(x, y - s);
        ctx.lineTo(x + s * 0.9, y + s * 0.7);
        ctx.lineTo(x - s * 0.9, y + s * 0.7);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
    }

    // The player: a white arrow, the way they face.
    if (scene.player) {
      const a = (-scene.player.angle * Math.PI) / 180;
      const s = r * 2;
      ctx.save();
      ctx.translate(X(scene.player.x), Y(scene.player.y));
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(s, 0);
      ctx.lineTo(-s * 0.7, s * 0.65);
      ctx.lineTo(-s * 0.35, 0);
      ctx.lineTo(-s * 0.7, -s * 0.65);
      ctx.closePath();
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = px;
      ctx.strokeStyle = '#000';
      ctx.stroke();
      ctx.restore();
    }

    // A metre, for scale, when the level came from a floor plan.
    if (scene.unitsPerMetre) {
      const len = scene.unitsPerMetre * f.s * dpr;
      if (len > 12 * px && len < canvas.width / 3) {
        const x = 12 * px;
        const y = canvas.height - 12 * px;
        ctx.strokeStyle = '#d8d2c0';
        ctx.lineWidth = 2 * px;
        ctx.beginPath();
        ctx.moveTo(x, y - 4 * px);
        ctx.lineTo(x, y);
        ctx.lineTo(x + len, y);
        ctx.lineTo(x + len, y - 4 * px);
        ctx.stroke();
        ctx.font = `600 ${Math.round(10 * px)}px system-ui, sans-serif`;
        ctx.fillStyle = '#d8d2c0';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText('1 m', x + len + 4 * px, y + 2 * px);
      }
    }
  }
}

// The biggest font a name fits a box at, on one line or split over two.
function fitText(ctx, text, bw, bh, px) {
  if (bw <= 0 || bh <= 0) return null;
  const words = text.split(/\s+/);
  const options = [[text]];
  for (let i = 1; i < words.length; i++) options.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);
  for (let size = Math.round(16 * px); size >= Math.round(8 * px); size -= Math.max(1, Math.round(px))) {
    const font = `600 ${size}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.font = font;
    let best = null;
    for (const lines of options) {
      if (lines.length * size * 1.1 > bh) continue;
      const wide = Math.max(...lines.map((l) => ctx.measureText(l).width));
      if (wide <= bw && (!best || wide < best.wide)) best = { lines, wide };
    }
    if (best) return { font, size, lines: best.lines };
  }
  return null;
}
