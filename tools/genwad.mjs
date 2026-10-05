// node tools/genwad.mjs <house.json> <out.wad>  -- generate a house PWAD with nodes
import { readFileSync, writeFileSync } from 'fs';
import { generateMap } from '../card/src/mapgen.js';
import { writeWad } from '../card/src/wad.js';
import { buildNodes } from '../card/src/nodes.js';
import createZdbsp from '../dist/housewad-zdbsp.js';
const [inFile, outFile] = process.argv.slice(2);
const house = JSON.parse(readFileSync(inFile, 'utf8'));
const { lumps, manifest, map } = generateMap(house);
console.log(`sectors ${map.sectors.length} lines ${map.linedefs.length} sides ${map.sidedefs.length} verts ${map.vertices.length} things ${map.things.length}`);
const wad = await buildNodes(createZdbsp, writeWad(lumps), { log: (s) => process.env.V && console.log(s) });
writeFileSync(outFile, wad);
writeFileSync(outFile.replace(/\.wad$/, '.json'), JSON.stringify(manifest, null, 1));
console.log('wrote', outFile, wad.length, 'bytes; lines with refs', Object.keys(manifest.lines).length, 'lamps', manifest.lamps.length, 'doors', manifest.doors.length);
