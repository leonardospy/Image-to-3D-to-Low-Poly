// Foto unica -> malha 3D fechada ("relevo inflado") a partir de mascara + mapa de profundidade. Puro JS, sem DOM.
// Entrada: mask (Uint8, 0..255) e depth (Uint8, 0..255, maior = mais perto), ambos w x h.
// Saida: { positions, uvs, indices } com o objeto centrado, maior dimensao = 2, frente voltada para +Z.

// distancia (em celulas) de cada celula interna ate a borda do objeto (chanfro 3-4)
function edgeDistance(fg, gw, gh) {
  const d = new Float32Array(gw * gh);
  const INF = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = fg[i] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= gw || y >= gh ? 0 : d[y * gw + x]);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (!fg[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.4, at(x + 1, y - 1) + 1.4);
    }
  for (let y = gh - 1; y >= 0; y--)
    for (let x = gw - 1; x >= 0; x--) {
      const i = y * gw + x;
      if (!fg[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.4, at(x - 1, y + 1) + 1.4);
    }
  return d;
}

export function buildRelief({ mask, depth, w, h }, { cells = 160, thickness = 0.45, back = 0.6, rounding = 0.35 } = {}) {
  // caixa do objeto
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (mask[y * w + x] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) throw new Error('Nenhum objeto encontrado na foto.');
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const long = Math.max(bw, bh);
  const gw = Math.max(8, Math.round((bw / long) * cells)), gh = Math.max(8, Math.round((bh / long) * cells));

  // amostra mascara e profundidade na grade (media por celula, mascara eroda 1 celula para tirar halo)
  const fg = new Uint8Array(gw * gh), dz = new Float32Array(gw * gh);
  const sx = bw / gw, sy = bh / gh;
  let dmin = 255, dmax = 0;
  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++) {
      const px = Math.min(w - 1, Math.floor(x0 + (i + 0.5) * sx)), py = Math.min(h - 1, Math.floor(y0 + (j + 0.5) * sy));
      const k = j * gw + i;
      if (mask[py * w + px] > 127) { fg[k] = 1; dz[k] = depth[py * w + px]; }
    }
  const inner = new Uint8Array(gw * gh);
  for (let j = 1; j < gh - 1; j++)
    for (let i = 1; i < gw - 1; i++) {
      const k = j * gw + i;
      inner[k] = fg[k] & fg[k - 1] & fg[k + 1] & fg[k - gw] & fg[k + gw];
    }
  for (let k = 0; k < fg.length; k++) if (inner[k]) { dmin = Math.min(dmin, dz[k]); dmax = Math.max(dmax, dz[k]); }
  if (dmax <= dmin) { dmax = dmin + 1; }
  const dist = edgeDistance(inner, gw, gh);
  const rr = Math.max(2, rounding * Math.min(gw, gh) * 0.5); // largura da borda arredondada, em celulas

  // vertices
  const scale = 2 / long;
  const idx = new Int32Array(gw * gh).fill(-1);
  const pos = [], uv = [], zf = [];
  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++) {
      const k = j * gw + i;
      if (!inner[k]) continue;
      const dn = (dz[k] - dmin) / (dmax - dmin); // 0 longe .. 1 perto
      const s = Math.min(1, dist[k] / rr);
      const edge = Math.sqrt(1 - (1 - s) * (1 - s)); // 0 na borda, 1 no miolo (perfil circular)
      const z = (0.15 + 0.85 * dn) * thickness * 2 * edge;
      idx[k] = pos.length / 3;
      pos.push((i + 0.5 - gw / 2) * (bw / gw) * scale, -(j + 0.5 - gh / 2) * (bh / gh) * scale, z);
      uv.push((x0 + (i + 0.5) * sx) / w, 1 - (y0 + (j + 0.5) * sy) / h);
      zf.push(z);
    }
  const nf = pos.length / 3;
  // verso: espelha a frente (z -> -z * back)
  for (let v = 0; v < nf; v++) {
    pos.push(pos[v * 3], pos[v * 3 + 1], -zf[v] * back);
    uv.push(uv[v * 2], uv[v * 2 + 1]);
  }

  const tris = [];
  const edges = new Map();
  const addEdge = (a, b) => edges.set(a * 1e7 + b, [a, b]);
  for (let j = 0; j < gh - 1; j++)
    for (let i = 0; i < gw - 1; i++) {
      const a = idx[j * gw + i], b = idx[j * gw + i + 1], c = idx[(j + 1) * gw + i + 1], d = idx[(j + 1) * gw + i];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      // frente (CCW visto de +Z; j cresce para baixo, entao a, d, c, b)
      tris.push(a, d, c, a, c, b);
      // verso (ordem invertida)
      tris.push(a + nf, b + nf, c + nf, a + nf, c + nf, d + nf);
      for (const [p, q] of [[a, d], [d, c], [c, b], [b, a]]) addEdge(p, q);
    }
  // paredes: arestas de borda da frente (sem aresta oposta) ligam frente e verso
  for (const [key, [p, q]] of edges) {
    if (edges.has(q * 1e7 + p)) continue;
    tris.push(p, p + nf, q + nf, p, q + nf, q);
  }
  return { positions: Float32Array.from(pos), uvs: Float32Array.from(uv), indices: Uint32Array.from(tris), crop: { x0, y0, bw, bh }, frontVertices: nf };
}

export function stats(indices, positions) {
  // volume com sinal e arestas abertas (para teste)
  let vol = 0;
  const e = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    vol += (positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) -
      positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])) / 6;
    for (const [p, q] of [[indices[t], indices[t + 1]], [indices[t + 1], indices[t + 2]], [indices[t + 2], indices[t]]]) e.set(p * 1e7 + q, 1);
  }
  let open = 0;
  for (const k of e.keys()) { const p = Math.floor(k / 1e7), q = k - p * 1e7; if (!e.has(q * 1e7 + p)) open++; }
  return { volume: vol, openEdges: open };
}
