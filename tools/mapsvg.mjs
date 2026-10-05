// node tools/mapsvg.mjs <house.json> <out.html> -- top-down view of a generated map
import { readFileSync, writeFileSync } from 'fs';
import { generateMap } from '../card/src/mapgen.js';
const house = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { map, manifest } = generateMap(house);
const xs = map.vertices.map((v) => v[0]), ys = map.vertices.map((v) => v[1]);
const [minX, maxX, minY, maxY] = [Math.min(...xs) - 64, Math.max(...xs) + 64, Math.min(...ys) - 64, Math.max(...ys) + 64];
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${-maxY} ${maxX - minX} ${maxY - minY}" width="1400" style="background:#111">`;
map.linedefs.forEach((l, i) => {
  const [a, b] = [map.vertices[l.v1], map.vertices[l.v2]];
  const col = l.special === 902 ? '#f44' : l.special === 900 ? '#4f4' : l.special === 901 ? '#4cf' : l.back === 0xffff ? '#ddd' : '#666';
  svg += `<line x1="${a[0]}" y1="${-a[1]}" x2="${b[0]}" y2="${-b[1]}" stroke="${col}" stroke-width="${l.special ? 10 : 4}"/>`;
});
for (const t of map.things) svg += `<circle cx="${t.x}" cy="${-t.y}" r="12" fill="${t.type === 1 ? '#0f0' : '#fa0'}"/>`;
for (const l of manifest.lamps) svg += `<circle cx="${l.x}" cy="${-l.y}" r="14" fill="#ff0"/>`;
for (const r of manifest.rooms) svg += `<text x="${(r.bbox.x1 + r.bbox.x2) / 2}" y="${-(r.bbox.y1 + r.bbox.y2) / 2}" fill="#fff" font-size="40" text-anchor="middle">${r.name}</text>`;
svg += '</svg>';
writeFileSync(process.argv[3], `<!doctype html><body style="margin:0;background:#111">${svg}</body>`);
