// Conclui um job TRELLIS.2 que foi interrompido depois que o ComfyUI ja tinha gerado os GLBs
// (ex.: o servidor foi reiniciado no meio). Uso:
//   node scripts/finish-trellis-job.mjs <jobId> [comprimento=4.3] [largura=0] [altura=0] [front|rear=front] [triangulosLow]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { finalizeCar } from '../lib/car.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [id, length = '4.3', width = '0', height = '0', side = 'front'] = process.argv.slice(2);
if (!id) throw new Error('Informe o id do job');
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')); } catch {}
const py = cfg.aiPython || path.join(root, 'ai', 'venv', 'Scripts', 'python.exe');
const outDir3d = path.join(root, 'data', 'comfy', 'output', '3d');
const jobDir = path.join(root, 'data', 'jobs', id);
const car = path.join(jobDir, 'car');
const out = path.join(jobDir, 'out');
fs.mkdirSync(car, { recursive: true });
fs.mkdirSync(out, { recursive: true });

const find = (tag) => {
  const f = fs.readdirSync(outDir3d).filter((x) => x.startsWith(`${id}_${tag}`) && x.endsWith('.glb')).sort().pop();
  if (!f) throw new Error(`GLB ${tag} do job ${id} nao encontrado em ${outDir3d}`);
  return path.join(outDir3d, f);
};

for (const [name, src, wheels, tex, cc] of [['realistic', find('hi'), 'original', 4096, true], ['lowpoly', find('lo'), 'procedural', 2048, false]]) {
  const raw = path.join(car, `${name}.glb`), metaPath = path.join(car, `${name}.json`);
  const r = spawnSync(py, [path.join(root, 'ai', 'car_textured.py'), src, raw, '--wheels', wheels,
    '--front-dir', side === 'rear' ? '-z' : '+z', '--length', length, '--width', width, '--height', height, '--meta', metaPath], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('car_textured.py falhou');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  meta.dims = { length: meta.length, width: meta.width, height: meta.height };
  const size = await finalizeCar(raw, path.join(out, `${name}.glb`), meta, { textureSize: tex, clearcoatBody: cc });
  console.log(name, (size / 1e6).toFixed(1) + ' MB', meta.triangles + ' tris');
}
