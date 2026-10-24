import { locateTools } from '../lib/tools.js';

const t = locateTools();
for (const [k, v] of Object.entries(t)) if (k !== 'missing') console.log(`${v ? 'OK     ' : 'FALTA  '} ${k.padEnd(16)} ${v || ''}`);
if (t.missing.length) {
  console.log('\nInstale COLMAP e OpenMVS (veja README.md) e coloque-os no PATH, em ./tools ou em config.json.');
  process.exit(1);
}
console.log('\nTudo pronto.');
