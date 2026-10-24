// Uso: npm run postprocess -- modelo.obj [saida] [triangulosLowPoly]
// Converte qualquer OBJ texturizado (Meshroom, RealityCapture, Blender...) em realistic.glb + lowpoly.glb
import { buildModels } from '../lib/postprocess.js';

const [obj, out = './saida', tris = '5000'] = process.argv.slice(2);
if (!obj) {
  console.log('Uso: npm run postprocess -- modelo.obj [pastaSaida] [triangulosLowPoly]');
  process.exit(1);
}
const r = await buildModels(obj, out, { lowPolyTris: +tris });
console.log(r);
