// Motor "imagem -> 3D" com IA (TripoSR) rodando local, seguido do mesmo pos-processamento do modo fotogrametria.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildModels } from './postprocess.js';
import { finalizeCar } from './car.js';

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
  let stats;
  if (carMode) {
    const car = path.join(job.dir, 'car');
    const meta = JSON.parse(fs.readFileSync(path.join(car, 'car_meta.json'), 'utf8'));
    meta.dims = { length: meta.length, width: meta.width, height: meta.height };
    const sizes = {};
    for (const f of ['realistic', 'lowpoly']) sizes[f] = await finalizeCar(path.join(car, f + '.glb'), path.join(out, f + '.glb'), meta);
    stats = { realisticTris: meta.realisticTris, lowTris: meta.lowTris, sizes };
  } else stats = await buildModels(raw, out, { lowPolyTris }, log);
  step('Concluido', 100);
  return stats;
}

// Hunyuan3D-2: forma por IA (1 foto = mini; 2+ = multi-vista) + cor projetada das fotos
export async function runHunyuanJob(job, views, { lowPolyTris = 5000, removeBg = true, carMode = true, lengthM = 4.3, widthM = 0, heightM = 0 } = {}, log, step, signal) {
  const py = aiPython();
  if (!py) throw new Error('Ambiente de IA nao instalado (veja ai/README.md).');
  const out = path.join(job.dir, 'out');
  fs.mkdirSync(out, { recursive: true });
  const raw = path.join(job.dir, 'ai_raw.glb');
  step('IA: gerando forma 3D (Hunyuan3D)', 15);
  await new Promise((resolve, reject) => {
    const args = [path.join(root, 'ai', 'run_hunyuan.py'), raw, ...Object.entries(views).map(([k, v]) => `${k}=${v}`)];
    if (!removeBg) args.push('--no-rembg');
    if (carMode) args.push('--car-out', path.join(job.dir, 'car'), '--length', String(lengthM), '--width', String(widthM), '--height', String(heightM), '--low', String(lowPolyTris));
    log(`> run_hunyuan.py (${Object.keys(views).join(', ')})`);
    const p = spawn(py, args, { windowsHide: true, signal, env: { ...process.env, ...aiEnv(), PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' } });
    const pipe = (d) => d.toString().split(/\r\n|\n|\r/).filter(Boolean).forEach((l) => log(l));
    p.stdout.on('data', pipe);
    p.stderr.on('data', pipe);
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`IA terminou com codigo ${c}`))));
  });
  if (!fs.existsSync(raw)) throw new Error('A IA nao gerou o modelo.');
  step('Gerando GLB realista e low poly', 85);
  let stats;
  if (carMode) {
    const car = path.join(job.dir, 'car');
    const meta = JSON.parse(fs.readFileSync(path.join(car, 'car_meta.json'), 'utf8'));
    meta.dims = { length: meta.length, width: meta.width, height: meta.height };
    const sizes = {};
    for (const f of ['realistic', 'lowpoly']) sizes[f] = await finalizeCar(path.join(car, f + '.glb'), path.join(out, f + '.glb'), meta);
    stats = { realisticTris: meta.realisticTris, lowTris: meta.lowTris, sizes };
  } else stats = await buildModels(raw, out, { lowPolyTris }, log);
  step('Concluido', 100);
  return stats;
}

// ---------------------------------------------------------------- TRELLIS.2 via ComfyUI
import { Comfy, runTrellis } from './comfy.js';

const COMFY_PORT = 8189;

function comfyInstall() {
  const local = path.join(root, 'comfyui', 'install', 'ComfyUI'); // copia dentro do projeto (disco D)
  for (const p of [config.comfyDir, local]) if (p && fs.existsSync(path.join(p, 'main.py'))) return p;
  try {
    const inst = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA || '', 'Comfy Desktop', 'installations.json'), 'utf8'));
    const p = path.join(inst[0].installPath, 'ComfyUI');
    if (fs.existsSync(path.join(p, 'main.py'))) return p;
  } catch {}
  return null;
}

function comfyModelsYaml() {
  for (const p of [config.comfyModelsYaml, path.join(root, 'comfyui', 'extra_model_paths.yaml'), path.join(process.env.APPDATA || '', 'Comfy Desktop', 'shared_model_paths.yaml')])
    if (p && fs.existsSync(p)) return p;
  return null;
}

export const comfyAvailable = () => !!comfyInstall();

// O ComfyUI que ESTE servidor iniciou: roda escondido (sem janela), morre junto com o servidor e
// e desligado depois de alguns minutos sem uso (libera a placa de video).
let comfyProc = null;
let comfyIdleTimer = null;
const IDLE_MIN = 10;

export function stopComfy() {
  clearTimeout(comfyIdleTimer);
  if (comfyProc?.pid) {
    spawnSync('taskkill', ['/PID', String(comfyProc.pid), '/T', '/F'], { windowsHide: true });
    comfyProc = null;
  }
}
/** Chamar quando um job termina: agenda o desligamento do ComfyUI se ele foi iniciado por este servidor. */
export function releaseComfy() {
  clearTimeout(comfyIdleTimer);
  if (comfyProc) comfyIdleTimer = setTimeout(stopComfy, IDLE_MIN * 60_000);
}
process.once('exit', stopComfy);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.once(sig, () => { stopComfy(); process.exit(0); });

/** Sobe o ComfyUI (headless, porta 8189) se ainda nao estiver rodando; saidas ficam na pasta de dados do projeto. */
export async function ensureComfy(dataDir, log = () => {}) {
  const comfyOut = path.join(path.dirname(dataDir), 'comfy');
  const comfy = new Comfy(`http://127.0.0.1:${COMFY_PORT}`, path.join(comfyOut, 'input'));
  comfy.outputDir = path.join(comfyOut, 'output');
  clearTimeout(comfyIdleTimer);
  if (await comfy.alive()) return comfy;
  const dir = comfyInstall();
  if (!dir) throw new Error('ComfyUI nao encontrado (defina comfyDir em config.json).');
  for (const d of ['output', 'input', 'temp']) fs.mkdirSync(path.join(comfyOut, d), { recursive: true });
  const models = comfyModelsYaml();
  const args = [path.join(dir, 'main.py'), '--listen', '127.0.0.1', '--port', String(COMFY_PORT), '--disable-auto-launch',
    ...(models ? ['--extra-model-paths-config', models] : []),
    '--output-directory', comfy.outputDir, '--input-directory', path.join(comfyOut, 'input'), '--temp-directory', path.join(comfyOut, 'temp')];
  log('Iniciando o ComfyUI...');
  const out = fs.openSync(path.join(comfyOut, 'comfy.log'), 'a');
  // sem 'detached': no Windows ele abriria uma janela de console que nunca fecha
  comfyProc = spawn(path.join(dir, '.venv', 'Scripts', 'python.exe'), args, { cwd: dir, stdio: ['ignore', out, out], windowsHide: true });
  comfyProc.on('exit', () => { comfyProc = null; });
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await comfy.alive()) return comfy;
  }
  throw new Error('O ComfyUI nao respondeu em 3 minutos.');
}

function runPy(py, args, log, signal) {
  return new Promise((resolve, reject) => {
    const p = spawn(py, args, { windowsHide: true, signal, env: { ...process.env, ...aiEnv(), PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' } });
    const pipe = (d) => d.toString().split(/\r\n|\n|\r/).filter(Boolean).forEach((l) => /Warn|warn/.test(l) || log(l));
    p.stdout.on('data', pipe);
    p.stderr.on('data', pipe);
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`python terminou com codigo ${c}`))));
  });
}

export async function runTrellisJob(job, imagePath, { lowPolyTris = 6000, hiFaces = 300000, lengthM = 4.3, widthM = 0, heightM = 0, photoSide = 'front' } = {}, log, step, signal) {
  const py = aiPython();
  if (!py) throw new Error('Ambiente de IA nao instalado (veja ai/README.md).');
  const out = path.join(job.dir, 'out');
  const car = path.join(job.dir, 'car');
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(car, { recursive: true });

  step('Iniciando o ComfyUI', 3);
  const comfy = await ensureComfy(path.dirname(job.dir), log);
  step('TRELLIS.2: modelo realista (alguns minutos)', 8);
  const hi = await runTrellis(comfy, imagePath, { faces: hiFaces, texRes: 4096, prefix: `${job.id}_hi`, outputDir: comfy.outputDir }, log, signal);
  step('TRELLIS.2: low poly com texturas assadas', 50);
  const lo = await runTrellis(comfy, imagePath, { faces: lowPolyTris, texRes: 2048, prefix: `${job.id}_lo`, outputDir: comfy.outputDir }, log, signal);

  step('Tratando o carro: rodas, farois, medidas reais', 75);
  const front = photoSide === 'rear' ? '-z' : '+z';
  const common = ['--front-dir', front, '--length', String(lengthM), '--width', String(widthM), '--height', String(heightM)];
  const jobs = [['realistic', hi, 'original'], ['lowpoly', lo, 'procedural']];
  const stats = { sizes: {} };
  for (const [name, src, wheels] of jobs) {
    const raw = path.join(car, `${name}.glb`);
    const metaPath = path.join(car, `${name}.json`);
    await runPy(py, [path.join(root, 'ai', 'car_textured.py'), src, raw, '--wheels', wheels, ...common, '--meta', metaPath], log, signal);
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.dims = { length: meta.length, width: meta.width, height: meta.height };
    stats.sizes[name] = await finalizeCar(raw, path.join(out, `${name}.glb`), meta, { textureSize: name === 'realistic' ? 4096 : 2048, clearcoatBody: name === 'realistic' });
    stats[name === 'realistic' ? 'realisticTris' : 'lowTris'] = meta.triangles;
  }
  step('Concluido', 100);
  return stats;
}
