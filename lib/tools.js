// Localiza COLMAP e OpenMVS: config.json -> variavel de ambiente -> PATH -> pasta ./tools
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const exe = (n) => (isWin ? `${n}.exe` : n);

let config = {};
try {
  config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
} catch {}

function walk(dir, name, depth = 0) {
  if (depth > 4 || !fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return p;
    if (e.isDirectory()) {
      const r = walk(p, name, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

function find(key, binName) {
  const fromCfg = config[key];
  if (fromCfg && fs.existsSync(fromCfg)) return fromCfg;
  const fromEnv = process.env[key.toUpperCase()];
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(d, exe(binName));
    if (d && fs.existsSync(p)) return p;
  }
  // COLMAP no Windows: COLMAP.bat / colmap.bat tambem funcionam
  if (isWin && binName === 'colmap') {
    for (const d of (process.env.PATH || '').split(path.delimiter)) {
      const p = path.join(d, 'colmap.bat');
      if (d && fs.existsSync(p)) return p;
    }
  }
  return walk(path.join(root, 'tools'), isWin && binName === 'colmap' ? 'colmap.bat' : exe(binName)) ||
    walk(path.join(root, 'tools'), exe(binName));
}

export function locateTools() {
  const t = {
    colmap: find('colmap', 'colmap'),
    interfaceColmap: find('interfaceColmap', 'InterfaceCOLMAP'),
    densify: find('densifyPointCloud', 'DensifyPointCloud'),
    reconstruct: find('reconstructMesh', 'ReconstructMesh'),
    refine: find('refineMesh', 'RefineMesh'),
    texture: find('textureMesh', 'TextureMesh'),
  };
  t.missing = Object.entries(t)
    .filter(([k, v]) => k !== 'missing' && k !== 'refine' && !v)
    .map(([k]) => k);
  return t;
}
