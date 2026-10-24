// 1 foto -> vistas geradas -> 3D, leve o bastante para qualquer aparelho (sem IA generativa). Puro JS, sem DOM.
// A foto vira algumas "fotos" com camera conhecida: ela mesma, a espelhada (objeto simetrico: equivale a fotografar o
// lado oposto) ou copias giradas (objeto de revolucao). Um molde da categoria limita o que nenhuma vista mostra e o
// mapa de profundidade da IA cava as reentrancias do lado fotografado. Depois segue o mesmo caminho do "Fotos em volta".
import * as MV from './multiview.js';

const D2R = Math.PI / 180;

// medidas tipicas [largura X, altura Y, comprimento Z] em metros (frente em +Z)
const DIMS = {
  carro: [1.8, 1.45, 4.3], onibus: [2.5, 3.2, 10], moto: [0.8, 1.1, 2.1], bike: [0.6, 1.0, 1.75],
  busto: [0.5, 0.6, 0.35], pessoa: [0.5, 1.7, 0.3], animal: [0.3, 0.5, 0.6], cadeira: [0.5, 0.9, 0.55],
  mesa: [1.2, 0.75, 0.8], sofa: [2.0, 0.85, 0.9], caneca: [0.12, 0.1, 0.09], capacete: [0.25, 0.25, 0.3],
  eletronico: [0.15, 0.06, 0.1],
};

// ---------------------------------------------------------------- moldes (coordenadas locais: y de 0 ao topo)
function carOcc(x, y, z, W, H, L) {
  const ax = Math.abs(x), zf = z / (L / 2);
  if (ax > W / 2 || Math.abs(z) > L / 2 || y < 0 || y > H) return false;
  const R = 0.22 * H, wz = 0.33 * L, belt = 0.58 * H, clear = 0.12 * H;
  // rodas
  if (ax >= W / 2 - 0.15 * W && ((y - R) ** 2 + (z - wz) ** 2 <= R * R || (y - R) ** 2 + (z + wz) ** 2 <= R * R)) return true;
  // carroceria baixa, com capo e porta-malas caindo nas pontas
  if (y >= clear && y <= belt) {
    const top = belt - 0.16 * H * Math.max(0, (zf - 0.55) / 0.45) - 0.1 * H * Math.max(0, (-zf - 0.7) / 0.3);
    const side = W / 2 - 0.06 * W * Math.max(0, (Math.abs(zf) - 0.8) / 0.2);
    if (y <= top && ax <= side) return true;
  }
  // cabine com para-brisa e vidro traseiro inclinados
  if (y > belt) {
    const t = (y - belt) / (H - belt);
    const zFront = L * (0.14 - 0.22 * t), zRear = -L * (0.3 - 0.12 * t), half = (W / 2) * (0.93 - 0.22 * t);
    if (z <= zFront && z >= zRear && ax <= half) return true;
  }
  return false;
}

// caixa arredondada (superelipsoide) para as outras categorias simetricas
function boxOcc(x, y, z, W, H, L) {
  const q = (Math.abs(x) / (W / 2)) ** 4 + (Math.abs(y - H / 2) / (H / 2)) ** 4 + (Math.abs(z) / (L / 2)) ** 4;
  return q <= 1;
}

function template(category, dims) {
  const [W, H, L] = dims;
  const f = category === 'carro' ? carOcc : boxOcc;
  // mundo centrado no objeto (y de -H/2 a H/2)
  return { W, H, L, occ: (x, y, z) => f(x, y + H / 2, z, W, H, L) };
}

function templatePoints(T, res = 36) {
  const big = Math.max(T.W, T.H, T.L), vs = big / res, pts = [];
  for (let z = -T.L / 2 + vs / 2; z < T.L / 2; z += vs)
    for (let y = -T.H / 2 + vs / 2; y < T.H / 2; y += vs)
      for (let x = -T.W / 2 + vs / 2; x < T.W / 2; x += vs) if (T.occ(x, y, z)) pts.push(x, y, z);
  return { pts: Float32Array.from(pts), vs };
}

// posiciona a camera (escala e centro) para a silhueta do molde cobrir a caixa do objeto na foto
function placeCam(pts, az, el, persp, box) {
  const B = MV.basis(az, el);
  let u0 = Infinity, u1 = -Infinity, r0 = Infinity, r1 = -Infinity;
  for (let p = 0; p < pts.length; p += 3) {
    const x = pts[p], y = pts[p + 1], z = pts[p + 2];
    const k = 1 / Math.max(0.2, 1 - persp * (x * B.d[0] + y * B.d[1] + z * B.d[2]));
    const u = k * (x * B.r[0] + z * B.r[2]), r = -k * (x * B.u[0] + y * B.u[1] + z * B.u[2]);
    if (u < u0) u0 = u; if (u > u1) u1 = u; if (r < r0) r0 = r; if (r > r1) r1 = r;
  }
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const s = Math.sqrt((bw * bh) / Math.max(1e-9, (u1 - u0) * (r1 - r0)));
  return { az, el, persp, s, cu: (box.x0 + box.x1) / 2 - (s * (u0 + u1)) / 2, cr: (box.y0 + box.y1) / 2 - (s * (r0 + r1)) / 2 };
}

// Acha azimute, elevacao, perspectiva e (sem medidas dadas) as proporcoes do molde que melhor explicam a silhueta.
export async function fitTemplate(view, category, { dims, dimsGiven = false, az = null, tick = async () => {}, onProgress = () => {} }) {
  let T = template(category, dims), tp = templatePoints(T);
  const big = Math.max(...dims);
  const score = (c, P = tp) => MV.silhouetteIoU(P.pts, P.vs, c, view.lo);
  const azs = az == null ? Array.from({ length: 24 }, (_, i) => i * 15 * D2R) : [-20, -10, 0, 10, 20].map((d) => az + d * D2R);
  let best = { s: -1 };
  let n = 0;
  for (const a of azs) {
    for (const el of [0, 8, 16, 24, 32, 42])
      for (const pn of [0, 0.2, 0.4]) {
        const c = placeCam(tp.pts, a, el * D2R, pn / big, view.box);
        const s = score(c);
        if (s > best.s) best = { s, c };
      }
    onProgress(0.6 * (++n / azs.length));
    await tick();
  }
  let { c } = best;
  // proporcoes do molde
  if (!dimsGiven) {
    let bd = dims;
    for (const fW of [0.85, 1, 1.15]) for (const fH of [0.85, 1, 1.15]) for (const fL of [0.85, 1, 1.15]) {
      const d = [dims[0] * fW, dims[1] * fH, dims[2] * fL];
      const P = templatePoints(template(category, d), 28);
      const cc = placeCam(P.pts, c.az, c.el, c.persp, view.box);
      const s = score(cc, P);
      if (s > best.s) { best = { s, c: cc }; bd = d; }
    }
    dims = bd; T = template(category, dims); tp = templatePoints(T);
    c = placeCam(tp.pts, c.az, c.el, c.persp, view.box);
    onProgress(0.85);
    await tick();
  }
  // ajuste fino de azimute, elevacao e perspectiva
  let cur = score(c);
  for (const st of [4, 2, 1])
    for (let pass = 0; pass < 3; pass++) {
      let improved = false;
      for (const [k, d] of [['az', st * D2R], ['el', st * D2R], ['persp', (0.05 * st) / big]])
        for (const sg of [1, -1]) {
          const t = { ...c, [k]: c[k] + sg * d };
          if (t.persp < 0 || t.el < -5 * D2R || t.el > 60 * D2R) continue;
          const cc = placeCam(tp.pts, t.az, t.el, t.persp, view.box);
          const s = score(cc);
          if (s > cur + 1e-4) { cur = s; c = cc; improved = true; }
        }
      if (!improved) break;
    }
  return { cam: c, dims, T, fit: cur };
}

// ---------------------------------------------------------------- vistas geradas e volume
// mirror: foto espelhada no azimute oposto; rot: copias a 120 e 240 graus (objeto de revolucao)
export function virtualViews(view, cam, mode) {
  if (mode === 'mirror') {
    const mv = MV.mirrorViews([view])[0];
    return { views: [view, mv], cams: [cam, { ...cam, az: -cam.az, cu: view.w - cam.cu }], flip: [false, true] };
  }
  if (mode === 'rot') return { views: [view, view, view], cams: [cam, { ...cam, az: cam.az + 120 * D2R }, { ...cam, az: cam.az + 240 * D2R }], flip: [false, false, false] };
  return { views: [view], cams: [cam], flip: [false] };
}

// molde de revolucao tirado da propria silhueta (camera de lado, sem perspectiva)
export function revolveTemplate(view, H) {
  const b = view.box, s = (b.y1 - b.y0) / H, cu = (b.x0 + b.x1) / 2, cr = (b.y0 + b.y1) / 2;
  const prof = new Float32Array(b.y1 - b.y0);
  for (let r = b.y0; r < b.y1; r++) {
    let x0 = Infinity, x1 = -Infinity;
    for (let x = b.x0; x < b.x1; x++) if (view.mask[r * view.w + x] >= 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
    prof[r - b.y0] = x1 >= x0 ? Math.max(Math.abs(x0 - cu), Math.abs(x1 + 1 - cu)) / s : 0;
  }
  const R = Math.max(...prof) || H / 4;
  const occ = (x, y, z) => {
    const row = Math.floor(cr - y * s - b.y0);
    if (row < 0 || row >= prof.length) return false;
    return Math.hypot(x, z) <= prof[row];
  };
  return { T: { W: 2 * R, H, L: 2 * R, occ }, cam: { az: 0, el: 0, persp: 0, s, cu, cr } };
}

// volume = silhuetas das vistas geradas, limitado pelo molde (um pouco inflado para nao cortar o que a foto mostra)
export function buildField(views, cams, T, res) {
  const R = (Math.max(T.W, T.L) / 2) * 1.3, Ry = (T.H / 2) * 1.3;
  const g = MV.carve(views, cams, MV.makeGrid(Math.max(R, Ry), Ry, res), { miss: 0 });
  const infl = 1.1, sub = [-0.25, 0.25];
  for (let k = 0; k < g.nz; k++)
    for (let j = 0; j < g.ny; j++)
      for (let i = 0; i < g.nx; i++) {
        const idx = i + g.nx * (j + g.ny * k);
        if (g.field[idx] <= 0) continue;
        const x = g.x0 + (i + 0.5) * g.vs, y = g.y0 + (j + 0.5) * g.vs, z = g.z0 + (k + 0.5) * g.vs;
        let occ = 0;
        for (const a of sub) for (const b of sub) for (const c of sub) occ += T.occ((x + a * g.vs) / infl, y + b * g.vs, (z + c * g.vs) / infl) ? 1 : 0;
        // o chao: nada abaixo da base do molde
        if (y < -T.H / 2) occ = 0;
        g.field[idx] = Math.min(g.field[idx], occ / 8);
      }
  return g;
}

// borrao 3D leve no campo: tira degraus do molde e abas finas onde molde e silhuetas se cruzam
export function smoothField(g, passes = 2) {
  let a = g.field, b = new Float32Array(a.length);
  const st = [1, g.nx, g.nx * g.ny], dim = [g.nx, g.ny, g.nz];
  for (let p = 0; p < passes; p++)
    for (let ax = 0; ax < 3; ax++) {
      const s = st[ax], d = dim[ax];
      for (let k = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
        const idx = i + g.nx * (j + g.ny * k), c = ax === 0 ? i : ax === 1 ? j : k;
        b[idx] = 0.25 * (c > 0 ? a[idx - s] : 0) + 0.5 * a[idx] + 0.25 * (c < d - 1 ? a[idx + s] : 0);
      }
      [a, b] = [b, a];
    }
  g.field = a;
  return g;
}

// Cava o volume com o mapa de profundidade (0..255, maior = mais perto) visto pela camera cam: tudo o que estiver
// claramente na frente da superficie observada sai. A escala da profundidade e ajustada ao proprio volume.
export function carveDepth(g, view, cam, depth0, { margin = 4, maxCut = 0.25 } = {}) {
  const depth = blurDepth(depth0, view.w, view.h, Math.max(2, Math.round(Math.max(view.w, view.h) / 160)));
  const f = Math.min(1, 256 / Math.max(view.w, view.h));
  const W = Math.ceil(view.w * f), H = Math.ceil(view.h * f);
  const B = MV.basis(cam.az, cam.el);
  const zb = new Float32Array(W * H).fill(-Infinity);
  const proj = (x, y, z) => {
    const dep = x * B.d[0] + y * B.d[1] + z * B.d[2];
    const k = 1 / Math.max(0.2, 1 - cam.persp * dep);
    return [Math.floor((cam.cu + cam.s * k * (x * B.r[0] + z * B.r[2])) * f), Math.floor((cam.cr - cam.s * k * (x * B.u[0] + y * B.u[1] + z * B.u[2])) * f), dep];
  };
  const each = (fn) => {
    for (let k = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const idx = i + g.nx * (j + g.ny * k);
      if (g.field[idx] < 0.5) continue;
      fn(idx, g.x0 + (i + 0.5) * g.vs, g.y0 + (j + 0.5) * g.vs, g.z0 + (k + 0.5) * g.vs);
    }
  };
  each((idx, x, y, z) => { const [u, r, d] = proj(x, y, z); if (u >= 0 && r >= 0 && u < W && r < H && d > zb[r * W + u]) zb[r * W + u] = d; });
  // ajuste linear profundidade da IA -> profundidade do volume, nos pixels bem dentro do objeto
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  const dAt = (u, r) => depth[Math.min(view.h - 1, Math.floor((r + 0.5) / f)) * view.w + Math.min(view.w - 1, Math.floor((u + 0.5) / f))];
  const mAt = (u, r) => view.mask[Math.min(view.h - 1, Math.floor((r + 0.5) / f)) * view.w + Math.min(view.w - 1, Math.floor((u + 0.5) / f))];
  for (let r = 0; r < H; r++) for (let u = 0; u < W; u++) {
    if (!isFinite(zb[r * W + u]) || mAt(u, r) < 230) continue;
    const a = dAt(u, r), b = zb[r * W + u];
    n++; sx += a; sy += b; sxx += a * a; sxy += a * b;
  }
  if (n < 50) return 0;
  const den = n * sxx - sx * sx;
  const A = den > 1e-9 ? (n * sxy - sx * sy) / den : 0, Bc = (sy - A * sx) / n;
  if (A <= 0) return 0; // profundidade incoerente com o volume: nao arrisca
  const lim = maxCut * Math.min(g.nx, g.nz) * g.vs, mg = margin * g.vs;
  let removed = 0;
  each((idx, x, y, z) => {
    const [u, r, d] = proj(x, y, z);
    if (u < 0 || r < 0 || u >= W || r >= H || mAt(u, r) < 200) return;
    const surf = A * dAt(u, r) + Bc;
    const front = zb[r * W + u];
    if (d > surf + mg && front - surf < lim) { g.field[idx] = 0; removed++; }
  });
  return removed;
}

// borrao de caixa separavel (tira o ruido do mapa de profundidade antes de cavar)
function blurDepth(d, w, h, r) {
  const a = new Float32Array(w * h), b = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let acc = 0, n = 0;
      for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { acc += d[y * w + xx]; n++; } }
      a[y * w + x] = acc / n;
    }
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++) {
      let acc = 0, n = 0;
      for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { acc += a[yy * w + x]; n++; } }
      b[y * w + x] = acc / n;
    }
  return b;
}

export function flipDepth(depth, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = depth[y * w + w - 1 - x];
  return out;
}

export { DIMS };
