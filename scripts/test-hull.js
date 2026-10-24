// Teste do modo navegador: caixa 120x200x60 fotografada em mesa giratoria (36 vistas ortograficas sinteticas)
import { carve, surfaceNets, smooth, vertexNormals, signedVolume, prepareColorViews, colorize, segment } from '../docs/js/hull.js';
import { MeshoptSimplifier } from '../docs/js/vendor/meshopt_simplifier.module.js';

const W = 400, H = 400, N = 36;
const angles = [...Array(N)].map((_, i) => (i / N) * 2 * Math.PI);
const views = angles.map((a) => {
  const rgba = new Uint8ClampedArray(W * H * 4);
  const half = 60 * Math.abs(Math.cos(a)) + 30 * Math.abs(Math.sin(a));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4, inside = Math.abs(x + 0.5 - 200) <= half && y >= 100 && y < 300;
    rgba.set(inside ? [220, 40 + (y - 100), 30, 255] : [30, 30, 30, 255], p);
  }
  const { mask } = segment(rgba, W, H, 40);
  return { rgba, mask, w: W, h: H };
});
const t0 = performance.now();
const grid = carve(views, angles, { res: 96, miss: 0, blur: 2 });
let { positions, indices } = surfaceNets(grid);
positions = smooth(positions, indices, 2);
const ext = [0, 1, 2].map((c) => { let mn = 1e9, mx = -1e9; for (let i = c; i < positions.length; i += 3) { mn = Math.min(mn, positions[i]); mx = Math.max(mx, positions[i]); } return +(mx - mn).toFixed(1); });
console.log('tris', indices.length / 3, 'extents xyz (esperado ~120 x 200 x 60):', ext, 'volume', signedVolume(positions, indices).toFixed(0), '(esperado ~1.44e6)');
const cols = colorize(positions, vertexNormals(positions, indices), prepareColorViews(views), angles, grid.cx);
console.log('cor do 1o vertice', [...cols.slice(0, 3)].map((v) => +v.toFixed(2)));
await MeshoptSimplifier.ready;
const [low] = MeshoptSimplifier.simplify(indices, positions, 3, 600 * 3, 0.5);
console.log('low poly tris', low.length / 3, 'ms', Math.round(performance.now() - t0));
