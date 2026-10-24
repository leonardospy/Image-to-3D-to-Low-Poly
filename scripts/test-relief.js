import { buildRelief, stats } from '../docs/js/relief.js';
const w = 200, h = 150, mask = new Uint8Array(w * h), depth = new Uint8Array(w * h);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const d = Math.hypot((x - 100) / 80, (y - 75) / 50);
  if (d < 1) { mask[y * w + x] = 255; depth[y * w + x] = Math.round(255 * (1 - d)); }
}
const r = buildRelief({ mask, depth, w, h }, { cells: 80 });
console.log('tris', r.indices.length / 3, 'verts', r.positions.length / 3, stats(r.indices, r.positions));
