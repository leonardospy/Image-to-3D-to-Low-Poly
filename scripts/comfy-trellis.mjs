// Teste: imagem -> TRELLIS.2 (ComfyUI) -> GLB.   node scripts/comfy-trellis.mjs <imagem> <prefixo> [faces] [texRes]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Comfy, runTrellis } from '../lib/comfy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [img, prefix = 'trellis', faces = '700000', texRes = '4096'] = process.argv.slice(2);
const comfy = new Comfy('http://127.0.0.1:8189', path.join(root, 'data/comfy/input'));
if (!(await comfy.alive())) throw new Error('ComfyUI nao esta rodando em 8189');
const t0 = Date.now();
const f = await runTrellis(comfy, img, { faces: +faces, texRes: +texRes, prefix, outputDir: path.join(root, 'data/comfy/output') }, console.log);
console.log(f, ((Date.now() - t0) / 1000).toFixed(0) + 's');
