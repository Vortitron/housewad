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
