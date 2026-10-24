// Fotogrametria classica (sem IA): COLMAP (SfM) + OpenMVS (malha densa + textura) -> GLB
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { locateTools } from './tools.js';
import { buildModels } from './postprocess.js';

const PRESETS = {
  rapido: { colmap: 'low', densifyRes: 3, textureRes: 2048 },
  medio: { colmap: 'medium', densifyRes: 2, textureRes: 4096 },
  alto: { colmap: 'high', densifyRes: 1, textureRes: 8192 },
};

function run(cmd, args, cwd, log, signal) {
  return new Promise((resolve, reject) => {
    log(`> ${path.basename(cmd)} ${args.join(' ')}`);
    const p = spawn(cmd, args, { cwd, shell: /\.(bat|cmd)$/i.test(cmd), windowsHide: true, signal });
    const pipe = (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => log(l));
    p.stdout.on('data', pipe);
    p.stderr.on('data', pipe);
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} terminou com codigo ${code}`))));
  });
}

function findFile(dir, ext) {
  const hits = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(ext));
  return hits.length ? path.join(dir, hits[0]) : null;
}

export async function runJob(job, { quality = 'medio', lowPolyTris = 5000 } = {}, log, step, signal) {
  const preset = PRESETS[quality] || PRESETS.medio;
  const tools = locateTools();
  if (tools.missing.length)
    throw new Error(`Ferramentas nao encontradas: ${tools.missing.join(', ')}. Veja o README (npm run check).`);

  const ws = job.dir;
  const images = path.join(ws, 'images');
  const dense = path.join(ws, 'dense');
  const mvs = path.join(ws, 'mvs');
  await fsp.mkdir(mvs, { recursive: true });
  const gpu = process.platform !== 'darwin' && fs.existsSync(path.join(process.env.SystemRoot || '', 'System32', 'nvidia-smi.exe')) ? '1' : '0';

  step('Estrutura a partir do movimento (COLMAP)', 10);
  await run(tools.colmap, [
    'automatic_reconstructor', '--workspace_path', ws, '--image_path', images,
    '--dense', '0', '--single_camera', '1', '--quality', preset.colmap, '--use_gpu', gpu,
  ], ws, log, signal);
  if (!fs.existsSync(path.join(ws, 'sparse', '0')))
    throw new Error('COLMAP nao conseguiu alinhar as fotos. Use mais fotos com sobreposicao (60-80%) e boa textura.');

  step('Corrigindo distorcao das lentes', 35);
  await run(tools.colmap, [
    'image_undistorter', '--image_path', images, '--input_path', path.join(ws, 'sparse', '0'),
    '--output_path', dense, '--output_type', 'COLMAP',
  ], ws, log, signal);

  step('Preparando cena (OpenMVS)', 42);
  await run(tools.interfaceColmap, ['-i', dense, '-o', 'scene.mvs', '--image-folder', path.join(dense, 'images'), '-w', mvs], mvs, log, signal);

  step('Nuvem de pontos densa', 50);
  await run(tools.densify, ['scene.mvs', '--resolution-level', String(preset.densifyRes), '-w', mvs], mvs, log, signal);

  step('Reconstruindo malha', 65);
  await run(tools.reconstruct, ['scene_dense.mvs', '-w', mvs], mvs, log, signal);

  if (quality === 'alto' && tools.refine) {
    step('Refinando malha', 75);
    await run(tools.refine, ['scene_dense.mvs', '-m', 'scene_dense_mesh.ply', '--resolution-level', '1', '-w', mvs], mvs, log, signal);
  }

  step('Texturizando', 82);
  const meshFile = fs.existsSync(path.join(mvs, 'scene_dense_mesh_refine.ply')) ? 'scene_dense_mesh_refine.ply' : 'scene_dense_mesh.ply';
  await run(tools.texture, [
    'scene_dense.mvs', '-m', meshFile, '--export-type', 'obj', '-o', 'textured.mvs',
    '--max-texture-size', String(preset.textureRes), '-w', mvs,
  ], mvs, log, signal);

  const obj = findFile(mvs, '.obj');
  if (!obj) throw new Error('OpenMVS nao gerou OBJ texturizado.');

  step('Gerando GLB realista e low poly', 92);
  const out = path.join(ws, 'out');
  const stats = await buildModels(obj, out, { lowPolyTris }, log);
  step('Concluido', 100);
  return stats;
}
