// Floor plans to and from Sweet Home 3D, from the command line.
//   node tools/sh3d.mjs export plan.json house.sh3d [name]
//   node tools/sh3d.mjs import house.sh3d [previous-plan.json] > plan.json
import { readFileSync, writeFileSync } from 'node:fs';
import { planToSh3d, sh3dToPlan } from '../card/src/sh3d.js';

const [cmd, a, b, c] = process.argv.slice(2);
if (cmd === 'export' && a && b) {
  writeFileSync(b, planToSh3d(JSON.parse(readFileSync(a, 'utf8')), c || 'House'));
} else if (cmd === 'import' && a) {
  const previous = b ? JSON.parse(readFileSync(b, 'utf8')) : null;
  process.stdout.write(JSON.stringify(await sh3dToPlan(new Uint8Array(readFileSync(a)), previous), null, 1) + '\n');
} else {
  console.error('node tools/sh3d.mjs export plan.json house.sh3d [name] | import house.sh3d [previous.json]');
  process.exit(2);
}
