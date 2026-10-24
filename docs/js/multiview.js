// Reconstrucao 3D a partir de varias fotos tiradas em volta do objeto (camera na mao, qualquer fundo). Puro JS, sem DOM.
// 1) silhuetas (mascaras suaves 0..255 vindas da IA)  2) poses estimadas pela coerencia entre silhuetas
// 3) escultura por silhuetas em grade fina  4) simetria opcional  5) malha  6) textura escolhendo a melhor foto por triangulo.
//
// Camera de cada foto: perspectiva simplificada orbitando a origem (y para cima). az = azimute (0 = camera em +Z, vendo a
// face +Z), el = elevacao, s = pixels por unidade, (cu, cr) = pixel onde cai a origem, persp = 1 / distancia (0 = ortografica).
// Ponto P -> u = cu + s*k*(P.r), linha = cr - s*k*(P.up), k = 1 / (1 - persp*(P.d)); P.d maior = mais perto da camera.

const D2R = Math.PI / 180;

export function basis(az, el) {
  const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
  return { r: [ca, 0, -sa], u: [-sa * se, ce, -ca * se], d: [sa * ce, se, ca * ce] };
}

// ---------------------------------------------------------------- mascaras
// mantem so o maior componente (limiar 128); o resto vira 0. Devolve a mascara e a caixa do objeto.
export function cleanSoftMask(mask, w, h) {
  const label = new Int32Array(w * h), stack = new Int32Array(w * h);
  let best = 0, bestSize = 0, n = 0;
  for (let s = 0; s < w * h; s++) {
    if (mask[s] < 128 || label[s]) continue;
    n++;
    let sp = 0, size = 0;
    stack[sp++] = s; label[s] = n;
    while (sp) {
      const p = stack[--sp]; size++;
      const x = p % w;
      if (x > 0 && mask[p - 1] >= 128 && !label[p - 1]) { label[p - 1] = n; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] >= 128 && !label[p + 1]) { label[p + 1] = n; stack[sp++] = p + 1; }
      if (p >= w && mask[p - w] >= 128 && !label[p - w]) { label[p - w] = n; stack[sp++] = p - w; }
      if (p < w * (h - 1) && mask[p + w] >= 128 && !label[p + w]) { label[p + w] = n; stack[sp++] = p + w; }
    }
    if (size > bestSize) { bestSize = size; best = n; }
  }
  if (!best) return null;
  const out = Uint8Array.from(mask);
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let p = 0; p < w * h; p++) {
    if (label[p] && label[p] !== best) out[p] = 0;
    else if (label[p] === best) { const x = p % w, y = (p / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { mask: out, box: { x0, x1: x1 + 1, y0, y1: y1 + 1 }, area: bestSize };
}

function pyramid(mask, w, h) {
  const lv = [{ m: mask, w, h, f: 1 }];
  while (lv.length < 8) {
    const a = lv[lv.length - 1];
    if (a.w < 24 || a.h < 24) break;
    const W = a.w >> 1, H = a.h >> 1, m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = 2 * y * a.w + 2 * x;
        m[y * W + x] = (a.m[p] + a.m[p + 1] + a.m[p + a.w] + a.m[p + a.w + 1] + 2) >> 2;
      }
    lv.push({ m, w: W, h: H, f: a.f / 2 });
  }
  return lv;
}

function bilinear(L, x, y) {
  x -= 0.5; y -= 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= L.w - 1 || y0 >= L.h - 1) return 0;
  const fx = x - x0, fy = y - y0, p = y0 * L.w + x0, m = L.m;
  return (m[p] * (1 - fx) + m[p + 1] * fx) * (1 - fy) + (m[p + L.w] * (1 - fx) + m[p + L.w + 1] * fx) * fy;
}

// views: [{ mask, w, h }] -> acrescenta box, pyr e nivel baixo (<=128 px) para avaliar poses
export function prepareViews(raw) {
  return raw.map((r) => {
    const c = cleanSoftMask(r.mask, r.w, r.h);
    if (!c) throw new Error('Uma das fotos ficou sem objeto recortado.');
    const pyr = pyramid(c.mask, r.w, r.h);
    let lo = pyr.length - 1;
    for (let i = 0; i < pyr.length; i++) if (Math.max(pyr[i].w, pyr[i].h) <= 160) { lo = i; break; }
    const L = pyr[lo];
    let area = 0;
    for (let i = 0; i < L.m.length; i++) if (L.m[i] >= 128) area++;
    return { ...r, mask: c.mask, box: c.box, pyr, lo: { ...L, area } };
  });
}

// ---------------------------------------------------------------- cameras iniciais
// span: angulo total percorrido (2*PI = volta completa); dir: +1/-1; start: azimute da 1a foto
export function initialCameras(views, { span = 2 * Math.PI, dir = 1, start = 0, el = 15 * D2R } = {}) {
  const n = views.length;
  const full = span > 2 * Math.PI - 1e-3;
  const step = n > 1 ? span / (full ? n : n - 1) : 0;
  const hs = views.map((v) => v.box.y1 - v.box.y0).sort((a, b) => a - b);
  const s0 = hs[hs.length >> 1]; // escala comum: altura mediana do objeto nas fotos = 1 unidade
  return views.map((v, i) => {
    const b = v.box;
    return { az: start + dir * i * step, el, s: s0, cu: (b.x0 + b.x1) / 2, cr: (b.y0 + b.y1) / 2, persp: 0 };
  });
}

// limites do volume de trabalho (meia largura R, meia altura Ry) a partir das caixas e escalas
function bounds(views, cams) {
  let R = 0.5, Ry = 0.5;
  views.forEach((v, i) => {
    const c = cams[i], b = v.box;
    R = Math.max(R, Math.max(c.cu - b.x0, b.x1 - c.cu) / c.s);
    Ry = Math.max(Ry, Math.max(c.cr - b.y0, b.y1 - c.cr) / c.s);
  });
  return { R: R * 1.15, Ry: Ry * 1.15 };
}

export function makeGrid(R, Ry, res) {
  const vs = (2 * R) / res;
  const ny = Math.max(8, Math.ceil((2 * Ry) / vs) + 2);
  return { nx: res, ny, nz: res, vs, x0: -R, y0: -(ny * vs) / 2, z0: -R, R, Ry };
}

// ---------------------------------------------------------------- escultura
// campo de ocupacao 0..1 = (miss+1)-esimo menor valor das mascaras que veem o voxel (tolera "miss" fotos com erro)
export function carve(views, cams, grid, { miss = 0, skip = -1, lowRes = false } = {}) {
  const { nx, ny, nz, vs, x0, y0, z0 } = grid;
  const field = new Float32Array(nx * ny * nz);
  const V = [];
  views.forEach((v, i) => {
    if (i === skip) return;
    const c = cams[i], B = basis(c.az, c.el);
    let L;
    if (lowRes) L = v.lo;
    else {
      const vpx = c.s * vs; // tamanho do voxel em pixels
      let lvl = 0;
      while (lvl + 1 < v.pyr.length && v.pyr[lvl + 1].f * vpx >= 1.2) lvl++;
      L = v.pyr[lvl];
    }
    V.push({ c, B, L, f: L.f });
  });
  const nv = V.length, K = Math.min(miss + 1, nv);
  const small = new Float32Array(K);
  const col = new Float32Array(nv * 3);
  for (let k = 0; k < nz; k++) {
    const z = z0 + (k + 0.5) * vs;
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * vs;
      for (let q = 0; q < nv; q++) {
        const B = V[q].B;
        col[q * 3] = x * B.r[0] + z * B.r[2];
        col[q * 3 + 1] = x * B.u[0] + z * B.u[2];
        col[q * 3 + 2] = x * B.d[0] + z * B.d[2];
      }
      for (let j = 0; j < ny; j++) {
        const y = y0 + (j + 0.5) * vs;
        small.fill(255);
        for (let q = 0; q < nv; q++) {
          const { c, B, L, f } = V[q];
          const dep = col[q * 3 + 2] + y * B.d[1];
          const kk = 1 / Math.max(0.2, 1 - c.persp * dep);
          const u = (c.cu + c.s * kk * col[q * 3]) * f;
          const r = (c.cr - c.s * kk * (col[q * 3 + 1] + y * B.u[1])) * f;
          const val = bilinear(L, u, r);
          if (val < small[K - 1]) {
            let p = K - 1;
            while (p > 0 && small[p - 1] > val) { small[p] = small[p - 1]; p--; }
            small[p] = val;
            if (small[K - 1] === 0) break;
          }
        }
        field[i + nx * (j + ny * k)] = small[K - 1] / 255;
      }
    }
  }
  grid.field = field;
  return grid;
}

function occupied(grid) {
  const { field, nx, ny, nz, vs, x0, y0, z0 } = grid;
  const pts = [];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        if (field[i + nx * (j + ny * k)] >= 0.5) pts.push(x0 + (i + 0.5) * vs, y0 + (j + 0.5) * vs, z0 + (k + 0.5) * vs);
  return Float32Array.from(pts);
}

// IoU entre a silhueta projetada dos voxels e a mascara (nivel baixo)
let splatBuf = null;
function silhouetteIoU(pts, vs, c, lo) {
  const W = lo.w, H = lo.h, f = lo.f;
  if (!splatBuf || splatBuf.length < W * H) splatBuf = new Uint8Array(W * H);
  const img = splatBuf;
  img.fill(0, 0, W * H);
  const B = basis(c.az, c.el);
  for (let p = 0; p < pts.length; p += 3) {
    const x = pts[p], y = pts[p + 1], z = pts[p + 2];
    const dep = x * B.d[0] + y * B.d[1] + z * B.d[2];
    const kk = 1 / Math.max(0.2, 1 - c.persp * dep);
    const hs = 0.5 * vs * c.s * kk * f;
    const u = (c.cu + c.s * kk * (x * B.r[0] + z * B.r[2])) * f;
    const r = (c.cr - c.s * kk * (x * B.u[0] + y * B.u[1] + z * B.u[2])) * f;
    const ua = Math.max(0, Math.floor(u - hs)), ub = Math.min(W - 1, Math.ceil(u + hs) - 1);
    const ra = Math.max(0, Math.floor(r - hs)), rb = Math.min(H - 1, Math.ceil(r + hs) - 1);
    for (let yy = ra; yy <= rb; yy++) for (let xx = ua; xx <= ub; xx++) img[yy * W + xx] = 1;
  }
  let inter = 0, uni = lo.area;
  for (let i = 0; i < W * H; i++) if (img[i]) { if (lo.m[i] >= 128) inter++; else uni++; }
  return uni ? inter / uni : 0;
}

// desloca (cu, cr) para o centro da silhueta projetada coincidir com o centro da caixa da mascara
function recenter(pts, c, box) {
  const B = basis(c.az, c.el);
  let u0 = Infinity, u1 = -Infinity, r0 = Infinity, r1 = -Infinity;
  for (let p = 0; p < pts.length; p += 3) {
    const x = pts[p], y = pts[p + 1], z = pts[p + 2];
    const kk = 1 / Math.max(0.2, 1 - c.persp * (x * B.d[0] + y * B.d[1] + z * B.d[2]));
    const u = c.cu + c.s * kk * (x * B.r[0] + z * B.r[2]), r = c.cr - c.s * kk * (x * B.u[0] + y * B.u[1] + z * B.u[2]);
    if (u < u0) u0 = u; if (u > u1) u1 = u; if (r < r0) r0 = r; if (r > r1) r1 = r;
  }
  if (u1 < u0) return;
  c.cu += (box.x0 + box.x1) / 2 - (u0 + u1) / 2;
  c.cr += (box.y0 + box.y1) / 2 - (r0 + r1) / 2;
}

// busca grossa de elevacao e escala de uma foto (com recentralizacao), para fotos de alturas e zoom diferentes
function sweepElScale(pts, vs, c, view, scaleFree, obj, elMin, elMax) {
  if (!pts.length) return;
  let best = { s: -Infinity };
  const s0 = c.s;
  for (let el = Math.max(elMin, 0); el <= elMax + 1e-6; el += 7 * D2R)
    for (const f of scaleFree ? [0.7, 0.8, 0.9, 1, 1.12, 1.25, 1.4] : [1]) {
      c.el = el; c.s = s0 * f;
      recenter(pts, c, view.box);
      const s = obj();
      if (s > best.s) best = { s, el, sc: c.s, cu: c.cu, cr: c.cr };
    }
  Object.assign(c, { el: best.el, s: best.sc, cu: best.cu, cr: best.cr });
}

// pontuacao de uma vista: casco feito pelas OUTRAS fotos, projetado nesta
function looScore(views, cams, v, res, miss) {
  const { R, Ry } = bounds(views, cams);
  const g = carve(views, cams, makeGrid(R, Ry, res), { miss, skip: v, lowRes: true });
  return { pts: occupied(g), vs: g.vs };
}

export function meanScore(views, cams, res, miss) {
  let s = 0;
  for (let v = 0; v < views.length; v++) {
    const { pts, vs } = looScore(views, cams, v, res, miss);
    s += silhouetteIoU(pts, vs, cams[v], views[v].lo);
  }
  return s / views.length;
}

// Ajusta as poses: primeiro elevacao/perspectiva comuns, depois cada foto (azimute, elevacao, deslocamento e, no fim,
// escala). Os azimutes ficam na ordem das fotos (cada um entre os vizinhos), o que evita trocar um lado pelo outro.
export async function refinePoses(views, cams, { rounds = 3, miss = 0, onProgress = () => {}, tick = async () => {}, fixEl = null, global = true, free = ['az', 'el', 's', 'cu', 'cr'], dir = 1, span = 2 * Math.PI, azPrior = 0.00015, varied = false } = {}) {
  const n = views.length;
  cams = cams.map((c) => ({ ...c }));
  const prior = cams.map((c) => c.az);
  const setAll = (key, val) => cams.forEach((c) => (c[key] = val));
  const full = span > 2 * Math.PI - 1e-3;

  // 1) elevacao e perspectiva globais
  let best = -1, bestEl = cams[0].el, bestP = cams[0].persp;
  const els = !global ? [] : fixEl != null ? [fixEl] : [0, 8, 16, 24, 32, 42].map((d) => d * D2R);
  const ps = [0, 0.12, 0.24];
  let t = 0;
  for (const el of els)
    for (const p of ps) {
      setAll('el', el); setAll('persp', p);
      const s = meanScore(views, cams, 32, miss);
      if (s > best) { best = s; bestEl = el; bestP = p; }
      onProgress(0.25 * (++t / (els.length * ps.length)), `elevação ${Math.round(el / D2R)}°`);
      await tick();
    }
  if (global) { setAll('el', bestEl); setAll('persp', bestP); }
  const el0 = cams[0].el;
  // fotos variadas (alturas e zoom diferentes): cada foto procura a propria elevacao e escala
  const elMin = varied ? -5 * D2R : el0 - 8 * D2R, elMax = varied ? 65 * D2R : el0 + 8 * D2R;

  // 2) por foto (descida coordenada); a foto 0 fixa o azimute e a origem; a escala so entra na ultima rodada
  const gap = 1.5 * D2R;
  const azOk = (v, az) => {
    if (n < 3) return true;
    const t = dir * az, lo = dir * cams[v - 1].az + gap;
    const hi = v + 1 < n ? dir * cams[v + 1].az - gap : full ? dir * cams[0].az + 2 * Math.PI - gap : Infinity;
    return t > lo && t < hi;
  };
  const steps = [1, 0.5, 0.25];
  for (let round = 0; round < rounds; round++) {
    const last = round === rounds - 1;
    for (let v = 0; v < n; v++) {
      const { pts, vs } = looScore(views, cams, v, last ? 56 : 40, miss);
      const c = cams[v], b = views[v].box, bw = b.x1 - b.x0, bh = b.y1 - b.y0;
      let params = v === 0 ? [['el', 4 * D2R]] : [['az', 8 * D2R], ['cu', 0.04 * bw], ['cr', 0.04 * bh], ['el', 3 * D2R]];
      if ((last || varied) && v > 0) params.push(['s', 0.04]);
      params = params.filter(([k]) => free.includes(k));
      // custo extra por se afastar do espacamento uniforme: so silhuetas deixam o azimute mal determinado
      const obj = () => silhouetteIoU(pts, vs, c, views[v].lo) - azPrior * ((c.az - prior[v]) / D2R) ** 2;
      if (varied && round < rounds - 1) sweepElScale(pts, vs, c, views[v], v > 0, obj, elMin, elMax);
      let cur = obj();
      for (const sc of steps)
        for (let pass = 0; pass < 3; pass++) {
          let improved = false;
          for (const [key, base] of params) {
            const d = base * sc;
            for (const sgn of [1, -1]) {
              const old = c[key];
              c[key] = key === 's' ? old * (1 + sgn * d) : old + sgn * d;
              const ok = (key !== 'az' || azOk(v, c.az)) && (key !== 'el' || (c.el >= elMin && c.el <= elMax));
              const s = ok ? obj() : -1;
              if (s > cur + 1e-4) { cur = s; improved = true; break; }
              c[key] = old;
            }
          }
          if (!improved) break;
        }
      c.score = silhouetteIoU(pts, vs, c, views[v].lo);
      onProgress(0.25 + 0.75 * ((round * n + v + 1) / (rounds * n)), `rodada ${round + 1}, foto ${v + 1}`);
      await tick();
    }
  }
  return cams;
}

// ---------------------------------------------------------------- chao
// Com a camera sempre acima do objeto, as silhuetas nao esculpem por baixo e sobra uma "quilha" abaixo do chao.
// Sobe um plano de corte enquanto o volume cortado ainda cobre as silhuetas; aplica o corte no campo denso.
export function groundCut(views, cams, dense, { tol = 0.004 } = {}) {
  const res = 72;
  const g = carve(views, cams, makeGrid(dense.R, dense.Ry, res), { miss: 0, lowRes: true });
  const pts = occupied(g);
  if (!pts.length) return null;
  const cover = (yCut) => {
    let s = 0;
    views.forEach((v, i) => {
      const lo = v.lo, c = cams[i], B = basis(c.az, c.el), W = lo.w, H = lo.h, f = lo.f;
      if (!splatBuf || splatBuf.length < W * H) splatBuf = new Uint8Array(W * H);
      const img = splatBuf;
      img.fill(0, 0, W * H);
      for (let p = 0; p < pts.length; p += 3) {
        const x = pts[p], y = pts[p + 1], z = pts[p + 2];
        if (y < yCut) continue;
        const dep = x * B.d[0] + y * B.d[1] + z * B.d[2];
        const kk = 1 / Math.max(0.2, 1 - c.persp * dep), hs = 0.5 * g.vs * c.s * kk * f;
        const u = (c.cu + c.s * kk * (x * B.r[0] + z * B.r[2])) * f, r = (c.cr - c.s * kk * (x * B.u[0] + y * B.u[1] + z * B.u[2])) * f;
        for (let yy = Math.max(0, Math.floor(r - hs)); yy <= Math.min(H - 1, Math.ceil(r + hs) - 1); yy++)
          for (let xx = Math.max(0, Math.floor(u - hs)); xx <= Math.min(W - 1, Math.ceil(u + hs) - 1); xx++) img[yy * W + xx] = 1;
      }
      let hit = 0;
      for (let q = 0; q < W * H; q++) if (img[q] && lo.m[q] >= 128) hit++;
      s += lo.area ? hit / lo.area : 1;
    });
    return s / views.length;
  };
  let ymin = Infinity;
  for (let p = 1; p < pts.length; p += 3) ymin = Math.min(ymin, pts[p]);
  const base = cover(-Infinity);
  let cut = ymin - g.vs;
  for (let y = ymin + g.vs; y < ymin + 0.6 * dense.Ry * 2; y += g.vs / 2) {
    if (cover(y) < base - tol) break;
    cut = y;
  }
  // corte suave no campo denso (meio voxel abaixo do primeiro nivel que ainda faz falta)
  const yc = cut - g.vs / 2;
  for (let j = 0; j < dense.ny; j++) {
    const y = dense.y0 + (j + 0.5) * dense.vs;
    const w = Math.min(1, Math.max(0, (y - yc) / dense.vs + 0.5));
    if (w >= 1) continue;
    for (let k = 0; k < dense.nz; k++) for (let i = 0; i < dense.nx; i++) dense.field[i + dense.nx * (j + dense.ny * k)] *= w;
  }
  return { y: yc, removed: yc - ymin };
}

// ---------------------------------------------------------------- simetria
function sampleField(g, x, y, z) {
  const fx = (x - g.x0) / g.vs - 0.5, fy = (y - g.y0) / g.vs - 0.5, fz = (z - g.z0) / g.vs - 0.5;
  const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
  if (i < 0 || j < 0 || k < 0 || i >= g.nx - 1 || j >= g.ny - 1 || k >= g.nz - 1) return 0;
  const a = fx - i, b = fy - j, c = fz - k, F = g.field, nx = g.nx, nxy = g.nx * g.ny;
  const p = i + nx * j + nxy * k;
  const l00 = F[p] * (1 - a) + F[p + 1] * a, l10 = F[p + nx] * (1 - a) + F[p + nx + 1] * a;
  const l01 = F[p + nxy] * (1 - a) + F[p + nxy + 1] * a, l11 = F[p + nxy + nx] * (1 - a) + F[p + nxy + nx + 1] * a;
  return (l00 * (1 - b) + l10 * b) * (1 - c) + (l01 * (1 - b) + l11 * b) * c;
}

// procura o plano vertical de simetria (normal (cos a, 0, -sin a), deslocamento c) e aplica min(f, espelho(f))
export function mirrorSymmetry(g) {
  const pts = occupied(g);
  const stride = Math.max(1, Math.floor(pts.length / 3 / 15000)) * 3;
  const score = (a, c) => {
    const nx = Math.cos(a), nz = -Math.sin(a);
    let s = 0;
    for (let p = 0; p < pts.length; p += stride) {
      const x = pts[p], y = pts[p + 1], z = pts[p + 2];
      const dd = 2 * (x * nx + z * nz - c);
      s += sampleField(g, x - dd * nx, y, z - dd * nz) >= 0.5 ? 1 : 0;
    }
    return s;
  };
  let best = -1, A = 0, C = 0;
  for (let a = 0; a < 180; a += 5)
    for (let c = -0.2; c <= 0.2001; c += 0.04) { const s = score(a * D2R, c * g.R); if (s > best) { best = s; A = a; C = c * g.R; } }
  for (let a = A - 4; a <= A + 4; a += 1)
    for (let c = C - 0.04 * g.R; c <= C + 0.04 * g.R; c += 0.008 * g.R) { const s = score(a * D2R, c); if (s > best) { best = s; A = a; C = c; } }
  const nxv = Math.cos(A * D2R), nzv = -Math.sin(A * D2R);
  const out = new Float32Array(g.field.length);
  for (let k = 0; k < g.nz; k++)
    for (let j = 0; j < g.ny; j++)
      for (let i = 0; i < g.nx; i++) {
        const x = g.x0 + (i + 0.5) * g.vs, y = g.y0 + (j + 0.5) * g.vs, z = g.z0 + (k + 0.5) * g.vs;
        const idx = i + g.nx * (j + g.ny * k);
        const dd = 2 * (x * nxv + z * nzv - C);
        out[idx] = Math.min(g.field[idx], sampleField(g, x - dd * nxv, y, z - dd * nzv));
      }
  g.field = out;
  return { angle: A * D2R, offset: C, agreement: best / (pts.length / stride) };
}

// simetria de revolucao em torno de um eixo vertical (garrafas, vasos, copos)
export function rotationalSymmetry(g) {
  const { field, nx, ny, nz, vs, x0, z0 } = g;
  let sx = 0, sz = 0, sw = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const f = field[i + nx * (j + ny * k)];
    if (f >= 0.5) { sx += x0 + (i + 0.5) * vs; sz += z0 + (k + 0.5) * vs; sw++; }
  }
  if (!sw) return null;
  const cx = sx / sw, cz = sz / sw;
  const nr = Math.ceil(Math.hypot(nx, nz)) + 2;
  const out = new Float32Array(field.length);
  const acc = new Float32Array(nr), cnt = new Float32Array(nr);
  for (let j = 0; j < ny; j++) {
    acc.fill(0); cnt.fill(0);
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const r = Math.hypot(x0 + (i + 0.5) * vs - cx, z0 + (k + 0.5) * vs - cz) / vs;
      const b = Math.min(nr - 1, Math.floor(r)), t = r - b;
      const f = field[i + nx * (j + ny * k)];
      acc[b] += f * (1 - t); cnt[b] += 1 - t;
      if (b + 1 < nr) { acc[b + 1] += f * t; cnt[b + 1] += t; }
    }
    for (let b = 0; b < nr; b++) acc[b] = cnt[b] ? acc[b] / cnt[b] : 0;
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const r = Math.hypot(x0 + (i + 0.5) * vs - cx, z0 + (k + 0.5) * vs - cz) / vs;
      const b = Math.min(nr - 2, Math.floor(r)), t = Math.min(1, r - b);
      out[i + nx * (j + ny * k)] = acc[b] * (1 - t) + acc[b + 1] * t;
    }
  }
  g.field = out;
  return { cx, cz };
}

// ---------------------------------------------------------------- malha (Surface Nets) e suavizacao
export function surfaceNets(g, iso = 0.5) {
  const { field, nx, ny, nz, vs, x0, y0, z0 } = g;
  const at = (i, j, k) => i + nx * (j + ny * k);
  const vidx = new Int32Array(nx * ny * nz).fill(-1);
  const pos = [];
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [];
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++)
    if ((corner[a][0] ^ corner[b][0]) + (corner[a][1] ^ corner[b][1]) + (corner[a][2] ^ corner[b][2]) === 1) edges.push([a, b]);
  const gv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) { gv[c] = field[at(i + corner[c][0], j + corner[c][1], k + corner[c][2])] - iso; if (gv[c] >= 0) inside++; }
        if (inside === 0 || inside === 8) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of edges) {
          if ((gv[a] >= 0) === (gv[b] >= 0)) continue;
          const t = gv[a] / (gv[a] - gv[b]);
          sx += corner[a][0] + t * (corner[b][0] - corner[a][0]);
          sy += corner[a][1] + t * (corner[b][1] - corner[a][1]);
          sz += corner[a][2] + t * (corner[b][2] - corner[a][2]);
          n++;
        }
        vidx[at(i, j, k)] = pos.length / 3;
        pos.push(x0 + (i + sx / n + 0.5) * vs, y0 + (j + sy / n + 0.5) * vs, z0 + (k + sz / n + 0.5) * vs);
      }
  const idx = [];
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const c = [i, j, k], f0 = field[at(i, j, k)] >= iso;
        for (let ax = 0; ax < 3; ax++) {
          const c1 = [i, j, k]; c1[ax]++;
          if (f0 === (field[at(c1[0], c1[1], c1[2])] >= iso)) continue;
          const b = (ax + 1) % 3, d = (ax + 2) % 3;
          const cell = (db, dd) => { const q = [...c]; q[b] -= db; q[d] -= dd; return vidx[at(q[0], q[1], q[2])]; };
          const v0 = cell(0, 0), v1 = cell(1, 0), v2 = cell(1, 1), v3 = cell(0, 1);
          if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) continue;
          if (f0) idx.push(v0, v1, v2, v0, v2, v3); else idx.push(v0, v2, v1, v0, v3, v2);
        }
      }
  const positions = Float32Array.from(pos), indices = Uint32Array.from(idx);
  let vol = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3, P = positions;
    vol += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  if (vol < 0) for (let t = 0; t < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]];
  return { positions, indices };
}

function neighbors(n, I) {
  const deg = new Uint32Array(n + 1);
  for (let t = 0; t < I.length; t++) deg[I[t] + 1] += 2;
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
  const adj = new Uint32Array(deg[n]), fill = deg.slice(0, n);
  for (let t = 0; t < I.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = I[t + e], b = I[t + (e + 1) % 3];
      adj[fill[a]++] = b; adj[fill[b]++] = a;
    }
  return { off: deg, adj };
}

// suavizacao de Taubin (nao encolhe a malha como a Laplaciana pura)
export function taubin(P, I, iterations = 6, lambda = 0.5, mu = -0.53) {
  const n = P.length / 3, { off, adj } = neighbors(n, I);
  let p = Float32Array.from(P), q = new Float32Array(P.length);
  for (let it = 0; it < iterations * 2; it++) {
    const f = it % 2 ? mu : lambda;
    for (let i = 0; i < n; i++) {
      const a = off[i], b = off[i + 1];
      if (a === b) { q[i * 3] = p[i * 3]; q[i * 3 + 1] = p[i * 3 + 1]; q[i * 3 + 2] = p[i * 3 + 2]; continue; }
      let sx = 0, sy = 0, sz = 0;
      for (let e = a; e < b; e++) { const v = adj[e] * 3; sx += p[v]; sy += p[v + 1]; sz += p[v + 2]; }
      const m = 1 / (b - a);
      q[i * 3] = p[i * 3] + f * (sx * m - p[i * 3]);
      q[i * 3 + 1] = p[i * 3 + 1] + f * (sy * m - p[i * 3 + 1]);
      q[i * 3 + 2] = p[i * 3 + 2] + f * (sz * m - p[i * 3 + 2]);
    }
    [p, q] = [q, p];
  }
  return p;
}

export function vertexNormals(P, I) {
  const N = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { N[i] += nx; N[i + 1] += ny; N[i + 2] += nz; }
  }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  return N;
}

export function compact(P, I) {
  const map = new Int32Array(P.length / 3).fill(-1);
  let n = 0;
  const idx = new Uint32Array(I.length);
  for (let t = 0; t < I.length; t++) { const v = I[t]; if (map[v] < 0) map[v] = n++; idx[t] = map[v]; }
  const pos = new Float32Array(n * 3);
  for (let v = 0; v < map.length; v++) if (map[v] >= 0) for (let c = 0; c < 3; c++) pos[map[v] * 3 + c] = P[v * 3 + c];
  return { positions: pos, indices: idx };
}

// ---------------------------------------------------------------- textura
function projectAll(P, c) {
  const B = basis(c.az, c.el), n = P.length / 3;
  const U = new Float32Array(n), R = new Float32Array(n), Dp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const dep = x * B.d[0] + y * B.d[1] + z * B.d[2];
    const kk = 1 / Math.max(0.2, 1 - c.persp * dep);
    U[i] = c.cu + c.s * kk * (x * B.r[0] + z * B.r[2]);
    R[i] = c.cr - c.s * kk * (x * B.u[0] + y * B.u[1] + z * B.u[2]);
    Dp[i] = dep;
  }
  return { U, R, Dp, B };
}

// z-buffer (maior profundidade = mais perto) em resolucao reduzida
function zbuffer(I, pr, W, H, f) {
  const zb = new Float32Array(W * H).fill(-1e9);
  const { U, R, Dp } = pr;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const ax = U[a] * f, ay = R[a] * f, bx = U[b] * f, by = R[b] * f, cx = U[c] * f, cy = R[c] * f;
    const minx = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxx = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const miny = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxy = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    if (minx > maxx || miny > maxy) continue;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) { const p = Math.round(ay) * W + Math.round(ax); if (p >= 0 && p < W * H) zb[p] = Math.max(zb[p], Dp[a]); continue; }
    for (let y = miny; y <= maxy; y++)
      for (let x = minx; x <= maxx; x++) {
        const px = x + 0.5, py = y + 0.5;
        let w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        let w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        let w2 = 1 - w0 - w1;
        if (w0 < -0.01 || w1 < -0.01 || w2 < -0.01) continue;
        const d = w0 * Dp[a] + w1 * Dp[b] + w2 * Dp[c];
        const p = y * W + x;
        if (d > zb[p]) zb[p] = d;
      }
  }
  return zb;
}

// Escolhe a melhor foto para cada triangulo (visivel, de frente, longe da borda da silhueta), suaviza a escolha entre
// vizinhos e calcula ganhos de cor por foto para disfarcar emendas. Devolve tudo o que o montador do atlas precisa.
export async function chooseViews(P, I, views, cams, { eps, colors, tick = async () => {}, onProgress = () => {} }) {
  const T = I.length / 3, nv = views.length, KC = 4;
  const candV = new Int16Array(T * KC).fill(-1), candQ = new Float32Array(T * KC);
  const fn = new Float32Array(T * 3), cen = new Float32Array(T * 3);
  for (let t = 0; t < T; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l;
    for (let k = 0; k < 3; k++) cen[t * 3 + k] = (P[a + k] + P[b + k] + P[c + k]) / 3;
  }
  const sMax = Math.max(...cams.map((c) => c.s));
  const proj = [];
  for (let v = 0; v < nv; v++) {
    const c = cams[v], vw = views[v], pr = projectAll(P, c);
    proj.push(pr);
    const f = Math.min(1, 512 / Math.max(vw.w, vw.h));
    const W = Math.ceil(vw.w * f), H = Math.ceil(vw.h * f);
    const zb = zbuffer(I, pr, W, H, f);
    // mascara borrada (nivel 2 da piramide) mede a distancia da borda
    const blur = vw.pyr[Math.min(2, vw.pyr.length - 1)];
    const zAt = (u, r) => {
      const x = Math.floor(u * f), y = Math.floor(r * f);
      if (x < 0 || y < 0 || x >= W || y >= H) return -1e9;
      let m = zb[y * W + x];
      if (x > 0) m = Math.max(m, zb[y * W + x - 1]);
      if (x < W - 1) m = Math.max(m, zb[y * W + x + 1]);
      if (y > 0) m = Math.max(m, zb[(y - 1) * W + x]);
      if (y < H - 1) m = Math.max(m, zb[(y + 1) * W + x]);
      return m;
    };
    const { U, R, Dp, B } = pr;
    for (let t = 0; t < T; t++) {
      const cosA = fn[t * 3] * B.d[0] + fn[t * 3 + 1] * B.d[1] + fn[t * 3 + 2] * B.d[2];
      if (cosA < 0.12) continue;
      let vis = 0;
      for (let e = 0; e < 3; e++) { const q = I[t * 3 + e]; if (Dp[q] >= zAt(U[q], R[q]) - eps) vis++; }
      const x = cen[t * 3], y = cen[t * 3 + 1], z = cen[t * 3 + 2];
      const dep = x * B.d[0] + y * B.d[1] + z * B.d[2];
      const kk = 1 / Math.max(0.2, 1 - c.persp * dep);
      const cu = c.cu + c.s * kk * (x * B.r[0] + z * B.r[2]), cr = c.cr - c.s * kk * (x * B.u[0] + y * B.u[1] + z * B.u[2]);
      if (dep >= zAt(cu, cr) - eps) vis++;
      if (vis < 3) continue;
      const inner = bilinear(blur, cu * blur.f, cr * blur.f) / 255;
      if (inner < 0.5) continue;
      const q = cosA * cosA * (inner * inner) * (0.5 + 0.5 * (c.s * kk) / sMax);
      // insere entre os KC melhores
      let p = KC - 1;
      if (candV[t * KC + p] >= 0 && candQ[t * KC + p] >= q) continue;
      while (p > 0 && (candV[t * KC + p - 1] < 0 || candQ[t * KC + p - 1] < q)) { candV[t * KC + p] = candV[t * KC + p - 1]; candQ[t * KC + p] = candQ[t * KC + p - 1]; p--; }
      candV[t * KC + p] = v; candQ[t * KC + p] = q;
    }
    onProgress((v + 1) / nv * 0.7);
    await tick();
  }

  // triangulos sem vista valida: foto mais de frente, sem teste de visibilidade
  const label = new Int16Array(T);
  for (let t = 0; t < T; t++) {
    if (candV[t * KC] >= 0) { label[t] = candV[t * KC]; continue; }
    let bv = 0, bq = -2;
    for (let v = 0; v < nv; v++) { const d = proj[v].B.d, q = fn[t * 3] * d[0] + fn[t * 3 + 1] * d[1] + fn[t * 3 + 2] * d[2]; if (q > bq) { bq = q; bv = v; } }
    label[t] = bv; candV[t * KC] = bv; candQ[t * KC] = 0.01;
  }

  // vizinhanca entre triangulos (arestas compartilhadas)
  const edgeMap = new Map(), tadj = new Int32Array(T * 3).fill(-1);
  for (let t = 0; t < T; t++)
    for (let e = 0; e < 3; e++) {
      const a = I[t * 3 + e], b = I[t * 3 + (e + 1) % 3];
      const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      const o = edgeMap.get(key);
      if (o === undefined) edgeMap.set(key, t * 3 + e);
      else { tadj[t * 3 + e] = (o / 3) | 0; tadj[o] = t; edgeMap.delete(key); }
    }
  // suavizacao: prefere a foto dos vizinhos quando a qualidade e parecida (menos emendas)
  for (let it = 0; it < 6; it++) {
    let changed = 0;
    for (let t = 0; t < T; t++) {
      let bestL = label[t], bestS = -1;
      for (let k = 0; k < KC; k++) {
        const l = candV[t * KC + k];
        if (l < 0) break;
        let agree = 0;
        for (let e = 0; e < 3; e++) { const nb = tadj[t * 3 + e]; if (nb >= 0 && label[nb] === l) agree++; }
        const s = candQ[t * KC + k] / (candQ[t * KC] || 1) + 0.35 * agree;
        if (s > bestS) { bestS = s; bestL = l; }
      }
      if (bestL !== label[t]) { label[t] = bestL; changed++; }
    }
    if (!changed) break;
  }
  onProgress(0.85);
  await tick();

  // ganhos de cor por foto: compara a cor de cada triangulo nas fotos candidatas
  const gains = Array.from({ length: nv }, () => [1, 1, 1]);
  if (colors) {
    const sample = (v, t) => {
      const pr = proj[v], col = colors[v];
      let r = 0, g = 0, b = 0;
      for (let e = 0; e < 3; e++) {
        const q = I[t * 3 + e];
        const x = Math.min(col.w - 1, Math.max(0, Math.floor(pr.U[q] * col.f))), y = Math.min(col.h - 1, Math.max(0, Math.floor(pr.R[q] * col.f)));
        const p = (y * col.w + x) * 4;
        r += col.rgba[p]; g += col.rgba[p + 1]; b += col.rgba[p + 2];
      }
      return [r / 3, g / 3, b / 3];
    };
    const pairs = [];
    const step = Math.max(1, Math.floor(T / 40000));
    for (let t = 0; t < T; t += step) {
      const vs = [];
      for (let k = 0; k < KC; k++) { const l = candV[t * KC + k]; if (l >= 0 && candQ[t * KC + k] > 0.05) vs.push(l); }
      if (vs.length >= 2) pairs.push([vs, vs.map((v) => sample(v, t))]);
    }
    for (let it = 0; it < 8; it++) {
      const num = Array.from({ length: nv }, () => [0, 0, 0]), den = Array.from({ length: nv }, () => [0, 0, 0]);
      for (const [vs, cs] of pairs) {
        const mean = [0, 1, 2].map((ch) => vs.reduce((s, v, i) => s + gains[v][ch] * cs[i][ch], 0) / vs.length);
        vs.forEach((v, i) => { for (let ch = 0; ch < 3; ch++) { num[v][ch] += mean[ch] * cs[i][ch]; den[v][ch] += cs[i][ch] * cs[i][ch]; } });
      }
      for (let v = 0; v < nv; v++) for (let ch = 0; ch < 3; ch++) if (den[v][ch] > 0) gains[v][ch] = Math.min(1.6, Math.max(0.6, 0.5 * gains[v][ch] + 0.5 * (num[v][ch] / den[v][ch])));
      for (let ch = 0; ch < 3; ch++) { const m = gains.reduce((s, g) => s + g[ch], 0) / nv; gains.forEach((g) => (g[ch] /= m)); }
    }
  }
  return { label, proj, gains };
}

// empacota os recortes usados de cada foto num atlas quadrado (prateleiras) e calcula UVs
export function layoutAtlas(P, I, choice, views, atlasSize, pad = 6) {
  const { label, proj } = choice, nv = views.length;
  const rect = Array.from({ length: nv }, () => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, used: false }));
  for (let t = 0; t < I.length / 3; t++) {
    const v = label[t], r = rect[v], pr = proj[v];
    r.used = true;
    for (let e = 0; e < 3; e++) {
      const q = I[t * 3 + e];
      r.x0 = Math.min(r.x0, pr.U[q]); r.x1 = Math.max(r.x1, pr.U[q]);
      r.y0 = Math.min(r.y0, pr.R[q]); r.y1 = Math.max(r.y1, pr.R[q]);
    }
  }
  const items = [];
  rect.forEach((r, v) => {
    if (!r.used) return;
    const vw = views[v];
    r.x0 = Math.max(0, Math.floor(r.x0) - pad); r.y0 = Math.max(0, Math.floor(r.y0) - pad);
    r.x1 = Math.min(vw.w, Math.ceil(r.x1) + pad); r.y1 = Math.min(vw.h, Math.ceil(r.y1) + pad);
    items.push({ v, ...r, w: Math.max(1, r.x1 - r.x0), h: Math.max(1, r.y1 - r.y0) });
  });
  const pack = (k) => {
    const order = [...items].sort((a, b) => b.h - a.h);
    let x = 0, y = 0, rowH = 0;
    for (const it of order) {
      const w = Math.ceil(it.w * k) + 2, h = Math.ceil(it.h * k) + 2;
      if (w > atlasSize) return false;
      if (x + w > atlasSize) { x = 0; y += rowH; rowH = 0; }
      if (y + h > atlasSize) return false;
      it.ax = x + 1; it.ay = y + 1; it.k = k;
      x += w; rowH = Math.max(rowH, h);
    }
    return true;
  };
  let lo = 0.01, hi = 1;
  if (pack(hi)) lo = hi;
  else for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (pack(m)) lo = m; else hi = m; }
  pack(lo);
  const byView = new Map(items.map((it) => [it.v, it]));

  // vertices duplicados por (vertice, foto)
  const key = new Map(), pos = [], uv = [], src = [], idx = new Uint32Array(I.length);
  for (let t = 0; t < I.length / 3; t++) {
    const v = label[t], it = byView.get(v), pr = proj[v];
    for (let e = 0; e < 3; e++) {
      const q = I[t * 3 + e], kq = q * 1024 + v;
      let id = key.get(kq);
      if (id === undefined) {
        id = pos.length / 3;
        key.set(kq, id);
        pos.push(P[q * 3], P[q * 3 + 1], P[q * 3 + 2]);
        src.push(q);
        uv.push((it.ax + (pr.U[q] - it.x0) * it.k) / atlasSize, 1 - (it.ay + (pr.R[q] - it.y0) * it.k) / atlasSize);
      }
      idx[t * 3 + e] = id;
    }
  }
  return { positions: Float32Array.from(pos), uvs: Float32Array.from(uv), indices: idx, source: Uint32Array.from(src), items };
}

// estima o sentido da volta: com o objeto sempre no centro, se a camera anda para a direita dela, os detalhes da
// superficie escorregam para a esquerda entre fotos seguidas. Devolve +1 (azimute crescente), -1 ou 0 (indeciso).
export function estimateDirection(grays) {
  // grays: [{ g: Float32Array W*H (objeto normalizado pela caixa), m: Uint8Array, W, H }]
  let votes = 0, total = 0;
  for (let i = 0; i + 1 < grays.length; i++) {
    const A = grays[i], B = grays[i + 1], W = A.W, H = A.H, maxS = Math.round(W * 0.15);
    let best = 0, bestE = Infinity, e0 = Infinity;
    for (let s = -maxS; s <= maxS; s++) {
      let e = 0, n = 0;
      for (let y = 0; y < H; y++)
        for (let x = Math.max(0, -s); x < Math.min(W, W - s); x++) {
          const pa = y * W + x + s, pb = y * W + x;
          if (!A.m[pa] || !B.m[pb]) continue;
          const d = B.g[pb] - A.g[pa];
          e += d * d; n++;
        }
      if (n < W * H * 0.1) continue;
      e /= n;
      if (s === 0) e0 = e;
      if (e < bestE) { bestE = e; best = s; }
    }
    if (best !== 0 && bestE < e0 * 0.97) { votes += Math.sign(best); total++; }
  }
  if (!total || Math.abs(votes) < total * 0.3) return 0;
  return votes > 0 ? 1 : -1;
}
