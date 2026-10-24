// Escultura por silhuetas (visual hull) para fotos de mesa giratoria. Puro JS, sem IA, sem DOM.
// Modelo de camera: projecao ortografica, eixo de rotacao vertical passando pelo centro do objeto,
// uma foto a cada passo angular constante. Coordenadas "pixel": x, y (para cima), z.

// ---------- 1. Segmentacao por cor de fundo ----------
export function segment(rgba, w, h, thr) {
  // cor de fundo = mediana dos pixels da borda
  const ch = [[], [], []];
  const take = (x, y) => { const i = (y * w + x) * 4; ch[0].push(rgba[i]); ch[1].push(rgba[i + 1]); ch[2].push(rgba[i + 2]); };
  for (let x = 0; x < w; x++) { take(x, 0); take(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { take(0, y); take(w - 1, y); }
  const bg = ch.map((a) => a.sort((p, q) => p - q)[a.length >> 1]);

  const mask = new Uint8Array(w * h);
  const t2 = thr * thr;
  for (let p = 0; p < w * h; p++) {
    const dr = rgba[p * 4] - bg[0], dg = rgba[p * 4 + 1] - bg[1], db = rgba[p * 4 + 2] - bg[2];
    mask[p] = dr * dr + dg * dg + db * db > t2 ? 1 : 0;
  }
  return { mask: cleanMask(mask, w, h), bg };
}

// mantem so o maior componente e preenche buracos internos
function cleanMask(mask, w, h) {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let best = 0, bestSize = 0, n = 0;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s]) continue;
    n++;
    let sp = 0, size = 0;
    stack[sp++] = s; label[s] = n;
    while (sp) {
      const p = stack[--sp]; size++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = n; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = n; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = n; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = n; stack[sp++] = p + w; }
    }
    if (size > bestSize) { bestSize = size; best = n; }
  }
  const out = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) out[p] = label[p] === best ? 1 : 0;
  // buracos: fundo (0) nao alcancavel a partir da borda vira 1
  const outside = new Uint8Array(w * h);
  let sp = 0;
  const push = (p) => { if (!out[p] && !outside[p]) { outside[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) {
    const p = stack[--sp];
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  for (let p = 0; p < w * h; p++) if (!outside[p]) out[p] = 1;
  return out;
}

function erode(mask, w, h, times) {
  let a = mask;
  for (let t = 0; t < times; t++) {
    const b = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        b[p] = a[p] & a[p - 1] & a[p + 1] & a[p - w] & a[p + w];
      }
    a = b;
  }
  return a;
}

// ---------- 2. Escultura de voxels ----------
// views: [{ mask, w, h }], angles em radianos
export function carve(views, angles, { res = 96, miss = 0, blur = 2 } = {}) {
  const { w, h } = views[0];
  let cxSum = 0, top = h, bottom = 0;
  const boxes = views.map((v) => {
    let x0 = v.w, x1 = -1, y0 = v.h, y1 = -1;
    for (let y = 0; y < v.h; y++)
      for (let x = 0; x < v.w; x++)
        if (v.mask[y * v.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) throw new Error('Uma das fotos nao tem objeto segmentado. Ajuste a tolerancia do fundo.');
    return { x0, x1, y0, y1 };
  });
  for (const b of boxes) { cxSum += (b.x0 + b.x1 + 1) / 2; top = Math.min(top, b.y0); bottom = Math.max(bottom, b.y1 + 1); }
  const cx = cxSum / boxes.length;
  let R = 0;
  for (const b of boxes) R = Math.max(R, cx - b.x0, b.x1 + 1 - cx);
  const pad = 2;
  R += pad;
  const rowTop = top - pad - 2 * ((2 * (R)) / res), rowSpan = bottom + pad - rowTop;
  const vs = (2 * R) / res;
  const nx = res, nz = res, ny = Math.max(8, Math.ceil(rowSpan / vs) + 4);

  const nv = views.length;
  const cos = angles.map(Math.cos), sin = angles.map(Math.sin);
  const occ = new Uint8Array(nx * ny * nz);
  const rowOf = new Int32Array(ny);
  for (let j = 0; j < ny; j++) rowOf[j] = Math.floor(rowTop + (j + 0.5) * vs);
  const ui = new Int32Array(nv);

  for (let k = 2; k < nz - 2; k++) {
    const z = -R + (k + 0.5) * vs;
    for (let i = 2; i < nx - 2; i++) {
      const x = -R + (i + 0.5) * vs;
      for (let v = 0; v < nv; v++) ui[v] = Math.floor(cx + x * cos[v] + z * sin[v]);
      for (let j = 2; j < ny - 2; j++) {
        const row = rowOf[j];
        if (row < 0 || row >= h) continue;
        let bad = 0;
        for (let v = 0; v < nv; v++) {
          const u = ui[v];
          if (u < 0 || u >= w || !views[v].mask[row * w + u]) { if (++bad > miss) break; }
        }
        if (bad <= miss) occ[i + nx * (j + ny * k)] = 1;
      }
    }
  }

  const field = blurField(occ, nx, ny, nz, blur);
  return { field, nx, ny, nz, vs, R, cx, rowTop };
}

function blurField(occ, nx, ny, nz, passes) {
  let a = Float32Array.from(occ), b = new Float32Array(a.length);
  const strides = [1, nx, nx * ny], dims = [nx, ny, nz];
  for (let p = 0; p < passes; p++)
    for (let ax = 0; ax < 3; ax++) {
      const s = strides[ax], d = dims[ax];
      for (let k = 0; k < nz; k++)
        for (let j = 0; j < ny; j++)
          for (let i = 0; i < nx; i++) {
            const idx = i + nx * (j + ny * k), c = [i, j, k][ax];
            const lo = c > 0 ? a[idx - s] : 0, hi = c < d - 1 ? a[idx + s] : 0;
            b[idx] = 0.25 * lo + 0.5 * a[idx] + 0.25 * hi;
          }
      [a, b] = [b, a];
    }
  return a;
}

// ---------- 3. Surface Nets ----------
export function surfaceNets(grid, iso = 0.5) {
  const { field, nx, ny, nz, vs, R, rowTop } = grid;
  const at = (i, j, k) => i + nx * (j + ny * k);
  const vidx = new Int32Array(nx * ny * nz).fill(-1);
  const pos = [];
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [];
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
    const d = (corner[a][0] ^ corner[b][0]) + (corner[a][1] ^ corner[b][1]) + (corner[a][2] ^ corner[b][2]);
    if (d === 1) edges.push([a, b]);
  }
  const g = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) { g[c] = field[at(i + corner[c][0], j + corner[c][1], k + corner[c][2])] - iso; if (g[c] >= 0) inside++; }
        if (inside === 0 || inside === 8) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of edges) {
          if ((g[a] >= 0) === (g[b] >= 0)) continue;
          const t = g[a] / (g[a] - g[b]);
          sx += corner[a][0] + t * (corner[b][0] - corner[a][0]);
          sy += corner[a][1] + t * (corner[b][1] - corner[a][1]);
          sz += corner[a][2] + t * (corner[b][2] - corner[a][2]);
          n++;
        }
        vidx[at(i, j, k)] = pos.length / 3;
        // indice -> coordenada "pixel" (y para cima = -linha)
        pos.push(-R + (i + sx / n + 0.5) * vs, -(rowTop + (j + sy / n + 0.5) * vs), -R + (k + sz / n + 0.5) * vs);
      }

  const idx = [];
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const c = [i, j, k], f0 = field[at(i, j, k)] >= iso;
        for (let ax = 0; ax < 3; ax++) {
          const c1 = [i, j, k]; c1[ax]++;
          if (c1[ax] >= [nx, ny, nz][ax]) continue;
          if (f0 === (field[at(c1[0], c1[1], c1[2])] >= iso)) continue;
          const b = (ax + 1) % 3, d = (ax + 2) % 3;
          const cell = (db, dd) => { const q = [...c]; q[b] -= db; q[d] -= dd; return vidx[at(q[0], q[1], q[2])]; };
          const v0 = cell(0, 0), v1 = cell(1, 0), v2 = cell(1, 1), v3 = cell(0, 1);
          if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) continue;
          if (f0) idx.push(v0, v1, v2, v0, v2, v3); else idx.push(v0, v2, v1, v0, v3, v2);
        }
      }
  const positions = Float32Array.from(pos), indices = Uint32Array.from(idx);
  if (signedVolume(positions, indices) < 0) for (let t = 0; t < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]];
  return { positions, indices };
}

export function signedVolume(P, I) {
  let v = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}

// suavizacao Laplaciana leve (remove escadinhas dos voxels)
export function smooth(positions, indices, iterations = 2, lambda = 0.5) {
  const n = positions.length / 3;
  let p = Float32Array.from(positions);
  for (let it = 0; it < iterations; it++) {
    const sum = new Float32Array(n * 3), cnt = new Uint16Array(n);
    for (let t = 0; t < indices.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = indices[t + e], b = indices[t + (e + 1) % 3];
        for (let c = 0; c < 3; c++) { sum[a * 3 + c] += p[b * 3 + c]; sum[b * 3 + c] += p[a * 3 + c]; }
        cnt[a]++; cnt[b]++;
      }
    const q = new Float32Array(p.length);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) q[i * 3 + c] = cnt[i] ? p[i * 3 + c] * (1 - lambda) + (sum[i * 3 + c] / cnt[i]) * lambda : p[i * 3 + c];
    p = q;
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

// ---------- 4. Cor por projecao das fotos ----------
// views: [{ rgba, mask, w, h }]; devolve rgb sRGB 0..1 por ponto
export function prepareColorViews(views) {
  return views.map((v) => ({ ...v, inner: erode(v.mask, v.w, v.h, 3) }));
}

export function colorize(points, normals, views, angles, cx) {
  const n = points.length / 3, out = new Float32Array(n * 3);
  const cos = angles.map(Math.cos), sin = angles.map(Math.sin);
  for (let i = 0; i < n; i++) {
    const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
    const nx = normals[i * 3], nz = normals[i * 3 + 2];
    let r = 0, g = 0, b = 0, wsum = 0, bestNd = -2, bestV = 0;
    for (let v = 0; v < views.length; v++) {
      const nd = -nx * sin[v] + nz * cos[v];
      if (nd > bestNd) { bestNd = nd; bestV = v; }
      if (nd <= 0.1) continue;
      const vw = views[v];
      const u = cx + x * cos[v] + z * sin[v] - 0.5, row = -y - 0.5;
      const x0 = Math.floor(u), y0 = Math.floor(row);
      if (x0 < 0 || y0 < 0 || x0 >= vw.w - 1 || y0 >= vw.h - 1 || !vw.inner[y0 * vw.w + x0]) continue;
      const fx = u - x0, fy = row - y0;
      const wt = nd * nd * nd;
      for (let k = 0; k < 4; k++) {
        const px = x0 + (k & 1), py = y0 + (k >> 1), p = (py * vw.w + px) * 4;
        const bw = wt * ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy);
        r += vw.rgba[p] * bw; g += vw.rgba[p + 1] * bw; b += vw.rgba[p + 2] * bw; wsum += bw;
      }
    }
    if (wsum <= 0) { // sem vista valida: pega a foto mais frontal, sem teste de mascara
      const vw = views[bestV];
      const u = Math.min(vw.w - 1, Math.max(0, Math.round(cx + x * cos[bestV] + z * sin[bestV])));
      const row = Math.min(vw.h - 1, Math.max(0, Math.round(-y)));
      const p = (row * vw.w + u) * 4;
      r = vw.rgba[p]; g = vw.rgba[p + 1]; b = vw.rgba[p + 2]; wsum = 1;
    }
    out[i * 3] = r / wsum / 255; out[i * 3 + 1] = g / wsum / 255; out[i * 3 + 2] = b / wsum / 255;
  }
  return out;
}

// centraliza e escala para ~2 unidades (mesma convencao do modo servidor)
export function normalizePositions(P, ref = P) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < ref.length; i += 3) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], ref[i + c]); mx[c] = Math.max(mx[c], ref[i + c]); }
  const size = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1, s = 2 / size;
  const ctr = mn.map((v, c) => (v + mx[c]) / 2);
  const out = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) for (let c = 0; c < 3; c++) out[i + c] = (P[i + c] - ctr[c]) * s;
  return out;
}

// remove vertices nao usados
export function compact(P, I, extra = []) {
  const map = new Int32Array(P.length / 3).fill(-1);
  let n = 0;
  const idx = new Uint32Array(I.length);
  for (let t = 0; t < I.length; t++) { const v = I[t]; if (map[v] < 0) map[v] = n++; idx[t] = map[v]; }
  const pos = new Float32Array(n * 3);
  for (let v = 0; v < map.length; v++) if (map[v] >= 0) for (let c = 0; c < 3; c++) pos[map[v] * 3 + c] = P[v * 3 + c];
  return { positions: pos, indices: idx };
}
