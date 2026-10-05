// Trim Freedoom Phase 2 down to what a house level needs: no maps but MAP01
// (kept so the IWAD still reads as Doom II), no music, no demos.
// Output: dist/freedoom2.wad (BSD licence, see dist/FREEDOOM-COPYING.txt)
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { readWad, writeWad } from '../card/src/wad.js';
const src = process.argv[2] || 'third_party/freedoom-0.13.0/freedoom2.wad';
const w = readWad(new Uint8Array(readFileSync(src)));
const MAP_PARTS = new Set(['THINGS', 'LINEDEFS', 'SIDEDEFS', 'VERTEXES', 'SEGS', 'SSECTORS', 'NODES', 'SECTORS', 'REJECT', 'BLOCKMAP', 'BEHAVIOR']);
const out = [];
let skippingMap = false;
for (const l of w.lumps) {
  if (/^MAP\d\d$/.test(l.name)) {
    skippingMap = l.name !== 'MAP01';
    if (skippingMap) continue;
  } else if (skippingMap && MAP_PARTS.has(l.name)) {
    continue;
  } else {
    skippingMap = false;
  }
  if (/^D_/.test(l.name) || /^DEMO\d$/.test(l.name) || l.name === 'GENMIDI' || l.name === 'DMXGUS' || l.name === 'DMXGUSC') continue;
  out.push({ name: l.name, data: w.data(l) });
}
const bytes = writeWad(out, 'IWAD');
writeFileSync('dist/freedoom2.wad', bytes);
copyFileSync(src.replace(/freedoom2\.wad$/, 'COPYING.txt'), 'dist/FREEDOOM-COPYING.txt');
console.log(`dist/freedoom2.wad: ${out.length} lumps, ${(bytes.length / 1e6).toFixed(1)} MB (from ${(readFileSync(src).length / 1e6).toFixed(1)} MB)`);
