// Motor "imagem -> 3D" com IA (TripoSR) rodando local, seguido do mesmo pos-processamento do modo fotogrametria.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildModels } from './postprocess.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let config = {};
try { config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')); } catch {}

// modelos e caches ficam na pasta do projeto (nada vai para o disco C:)
const aiEnv = () => {
  const base = config.aiCache || path.join(root, 'ai', 'cache');
  return { HF_HOME: path.join(base, 'hf'), U2NET_HOME: path.join(base, 'u2net'), TORCH_HOME: path.join(base, 'torch') };
};

export const aiPython = () => {
  const p = config.aiPython || process.env.AI_PYTHON || path.join(root, 'ai', 'venv', 'Scripts', 'python.exe');
  return fs.existsSync(p) ? p : null;
};

export async function runAiJob(job, imagePath, { lowPolyTris = 5000, resolution = 320, removeBg = true } = {}, log, step, signal) {
  const py = aiPython();
  if (!py) throw new Error('Ambiente de IA nao instalado (veja ai/README.md).');
  const out = path.join(job.dir, 'out');
  fs.mkdirSync(out, { recursive: true });
  const raw = path.join(job.dir, 'ai_raw.glb');

  step('IA: gerando modelo 3D a partir da foto', 15);
  await new Promise((resolve, reject) => {
    const args = [path.join(root, 'ai', 'run_triposr.py'), imagePath, raw, String(resolution)];
    if (!removeBg) args.push('--no-rembg');
    log(`> python ${args.map((a) => path.basename(a)).join(' ')}`);
    const p = spawn(py, args, { windowsHide: true, signal, env: { ...process.env, ...aiEnv(), PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' } });
    const pipe = (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => log(l));
    p.stdout.on('data', pipe);
    p.stderr.on('data', pipe);
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`IA terminou com codigo ${c}`))));
  });
  if (!fs.existsSync(raw)) throw new Error('A IA nao gerou o modelo.');

  step('Gerando GLB realista e low poly', 85);
  const stats = await buildModels(raw, out, { lowPolyTris }, log);
  step('Concluido', 100);
  return stats;
}
