// Minimal WAD reading and writing.

const decoder = new TextDecoder('latin1');

export function readWad(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ident = decoder.decode(bytes.subarray(0, 4));
  if (ident !== 'IWAD' && ident !== 'PWAD') throw new Error('not a WAD file');
  const count = view.getInt32(4, true);
  const dirOffset = view.getInt32(8, true);
  const lumps = [];
  for (let i = 0; i < count; i++) {
    const at = dirOffset + i * 16;
    const pos = view.getInt32(at, true);
    const size = view.getInt32(at + 4, true);
    let name = decoder.decode(bytes.subarray(at + 8, at + 16));
    const nul = name.indexOf('\0');
    if (nul >= 0) name = name.slice(0, nul);
    lumps.push({ name: name.toUpperCase(), pos, size });
  }
  return {
    ident,
    lumps,
    data: (lump) => bytes.subarray(lump.pos, lump.pos + lump.size),
    find: (name) => lumps.find((l) => l.name === name),
  };
}

// lumps: [{ name, data: Uint8Array }]
export function writeWad(lumps, ident = 'PWAD') {
  let size = 12;
  for (const l of lumps) size += l.data.length;
  const dirOffset = size;
  size += lumps.length * 16;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = ident.charCodeAt(i);
  view.setInt32(4, lumps.length, true);
  view.setInt32(8, dirOffset, true);
  let pos = 12;
  lumps.forEach((l, i) => {
    out.set(l.data, pos);
    const at = dirOffset + i * 16;
    view.setInt32(at, pos, true);
    view.setInt32(at + 4, l.data.length, true);
    writeName(out, at + 8, l.name);
    pos += l.data.length;
  });
  return out;
}

export function writeName(out, at, name) {
  for (let i = 0; i < 8; i++) out[at + i] = i < name.length ? name.charCodeAt(i) : 0;
}

// Texture names defined in TEXTURE1/TEXTURE2 of a WAD.
export function textureNames(wad) {
  const names = [];
  for (const lumpName of ['TEXTURE1', 'TEXTURE2']) {
    const lump = wad.find(lumpName);
    if (!lump) continue;
    const d = wad.data(lump);
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const n = v.getInt32(0, true);
    for (let i = 0; i < n; i++) {
      const off = v.getInt32(4 + i * 4, true);
      let name = decoder.decode(d.subarray(off, off + 8));
      const nul = name.indexOf('\0');
      if (nul >= 0) name = name.slice(0, nul);
      names.push({ name: name.toUpperCase(), width: v.getInt16(off + 12, true), height: v.getInt16(off + 14, true) });
    }
  }
  return names;
}

// Flat names between F_START and F_END markers.
export function flatNames(wad) {
  const names = [];
  let inside = false;
  for (const l of wad.lumps) {
    if (/^F?F_START$/.test(l.name)) inside = true;
    else if (/^F?F_END$/.test(l.name)) inside = false;
    else if (inside && l.size === 4096) names.push(l.name);
  }
  return names;
}

// Doom picture ("patch") format ----------------------------------------------

export function decodePatch(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = v.getInt16(0, true);
  const h = v.getInt16(2, true);
  const pixels = new Int16Array(w * h).fill(-1);
  for (let x = 0; x < w; x++) {
    let at = v.getInt32(8 + x * 4, true);
    while (bytes[at] !== 0xff) {
      const top = bytes[at];
      const len = bytes[at + 1];
      for (let i = 0; i < len; i++) if (top + i < h) pixels[(top + i) * w + x] = bytes[at + 3 + i];
      at += len + 4;
    }
  }
  return { w, h, pixels };
}

export function encodePatch(w, h, pixels) {
  const cols = [];
  for (let x = 0; x < w; x++) {
    const col = [];
    let y = 0;
    while (y < h) {
      while (y < h && pixels[y * w + x] < 0) y++;
      if (y >= h) break;
      const start = y;
      const run = [];
      while (y < h && pixels[y * w + x] >= 0 && run.length < 128) run.push(pixels[y++ * w + x]);
      col.push(start, run.length, 0, ...run, 0);
    }
    col.push(0xff);
    cols.push(col);
  }
  const size = 8 + w * 4 + cols.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  v.setInt16(0, w, true);
  v.setInt16(2, h, true);
  let at = 8 + w * 4;
  cols.forEach((c, x) => {
    v.setInt32(8 + x * 4, at, true);
    out.set(c, at);
    at += c.length;
  });
  return out;
}

// Text drawn in the game's own HUD font (STCFNxxx), scaled up, as a patch:
// what the intermission screen shows as the level's name.
export function textPatch(wad, text, scale = 2) {
  const glyphs = [];
  for (const ch of text.toUpperCase()) {
    const code = ch.charCodeAt(0);
    const lump = code > 32 && code < 96 ? wad.find(`STCFN${String(code).padStart(3, '0')}`) : null;
    glyphs.push(lump ? decodePatch(wad.data(lump)) : { w: 4, h: 0, pixels: new Int16Array(0) });
  }
  const h = Math.max(1, ...glyphs.map((g) => g.h));
  const w = Math.max(1, glyphs.reduce((n, g) => n + g.w + 1, 0));
  const pixels = new Int16Array(w * scale * h * scale).fill(-1);
  let x0 = 0;
  for (const g of glyphs) {
    for (let y = 0; y < g.h; y++)
      for (let x = 0; x < g.w; x++) {
        const p = g.pixels[y * g.w + x];
        if (p < 0) continue;
        for (let sy = 0; sy < scale; sy++)
          for (let sx = 0; sx < scale; sx++) pixels[(y * scale + sy) * w * scale + (x0 + x) * scale + sx] = p;
      }
    x0 += g.w + 1;
  }
  return encodePatch(w * scale, h * scale, pixels);
}
