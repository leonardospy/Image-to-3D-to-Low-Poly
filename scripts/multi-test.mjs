// Teste do TRELLIS.2 com varias fotos: node scripts/multi-test.mjs <prefixo> <foto1> <foto2> [...]
import { ensureComfy, stopComfy } from '../lib/ai.js';
import { runTrellis } from '../lib/comfy.js';
const [prefix, ...imgs] = process.argv.slice(2);
const comfy = await ensureComfy('D:/Projetos Claude/Gerando 3D/data/jobs', console.log);
const t0 = Date.now();
const f = await runTrellis(comfy, imgs, { faces: 6000, texRes: 2048, prefix, outputDir: comfy.outputDir }, console.log);
console.log('GLB:', f, ((Date.now() - t0) / 1000).toFixed(0) + 's');
stopComfy();
process.exit(0);
