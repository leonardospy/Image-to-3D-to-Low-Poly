// Modo "Fotos em volta": varias fotos tiradas em volta do objeto -> modelo 3D completo e texturizado, tudo no navegador.
import * as THREE from 'three';
import { MeshoptSimplifier } from './vendor/meshopt_simplifier.module.js';
import * as ai from './ai.js';
import * as MV from './multiview.js';
import { parseScene } from './scene-text.js';

const D2R = Math.PI / 180;
const TEXMAX = matchMedia('(pointer: coarse)').matches ? 1024 : 1280; // maior lado das fotos usadas na textura (menor no celular)
const tick = () => new Promise((r) => setTimeout(r, 0));
// vista de cada foto (azimute: 0 = frente, +90 = lado esquerdo do objeto)
const VIEWS = [['', 'vista: auto'], ['0', 'frente'], ['45', 'frente-esq.'], ['90', 'lado esq.'], ['135', 'tras.-esq.'], ['180', 'traseira'], ['225', 'tras.-dir.'], ['270', 'lado dir.'], ['315', 'frente-dir.']];
const QUALITY = {
  fast: { res: 128, faces: 80000, atlas: 2048, lowAtlas: 1024 },
  medium: { res: 176, faces: 160000, atlas: 4096, lowAtlas: 2048 },
  high: { res: 232, faces: 300000, atlas: 4096, lowAtlas: 2048 },
};

export function init({ models, show, setStep, $ }) {
  let photos = []; // { name, bitmap, w, h, mask, small }
  let maskJob = 0;

  // ------------------------------------------------------------ descricao da cena
  const renderChips = () => {
    const h = parseScene($('mdesc').value);
    $('mchips').innerHTML = h.chips.length ? 'Entendi: ' + h.chips.map((c) => `<span class="chip">${c}</span>`).join(' ') : '';
    if (h.size && !$('msize').dataset.user) $('msize').value = h.size;
    return h;
  };
  $('mdesc').oninput = renderChips;
  $('msize').oninput = () => ($('msize').dataset.user = $('msize').value ? '1' : '');

  // ------------------------------------------------------------ fotos
  const natural = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  async function setFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|gif|bmp|heic)$/i.test(f.name)).sort(natural).slice(0, 60);
    if (!files.length) return;
    const job = ++maskJob;
    photos = [];
    $('mthumbs').innerHTML = '';
    $('mgo').disabled = true;
    $('mcount').innerHTML = `<small>${files.length} foto(s)</small>`;
    for (const f of files) {
      const probe = await createImageBitmap(f);
      const k = Math.min(1, TEXMAX / Math.max(probe.width, probe.height));
      const w = Math.round(probe.width * k), h = Math.round(probe.height * k);
      const bitmap = k < 1 ? await createImageBitmap(f, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }) : probe;
      if (k < 1) probe.close();
      const thumb = document.createElement('canvas');
      const tk = 160 / Math.max(w, h);
      thumb.width = Math.round(w * tk); thumb.height = Math.round(h * tk);
      thumb.getContext('2d').drawImage(bitmap, 0, 0, thumb.width, thumb.height);
      const cell = document.createElement('div');
      cell.className = 'mth';
      const view = document.createElement('select');
      view.title = 'O que esta foto mostra (opcional; use se as fotos estiverem fora de ordem)';
      view.innerHTML = VIEWS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
      cell.append(thumb, view, Object.assign(document.createElement('span'), { textContent: '' }));
      $('mthumbs').append(cell);
      photos.push({ name: f.name, bitmap, w, h, mask: null, thumb, cell, view });
    }
    if (photos.length < 4) {
      setStep('Use pelo menos 4 fotos (ideal: 16 a 36). Para uma foto só, use o modo "Qualquer foto".', 0);
      return;
    }
    await computeMasks(job);
  }

  async function computeMasks(job) {
    try {
      await ai.loadSegmenter(setStep);
      const tf = await ai.getTF();
      for (let i = 0; i < photos.length; i++) {
        if (job !== maskJob) return;
        const p = photos[i];
        if (p.mask) continue;
        setStep(`Recortando o objeto: foto ${i + 1} de ${photos.length}...`, 10 + (80 * i) / photos.length);
        const cv = document.createElement('canvas');
        cv.width = p.w; cv.height = p.h;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(p.bitmap, 0, 0);
        const rgba = ctx.getImageData(0, 0, p.w, p.h).data;
        const img = tf.RawImage.fromCanvas(cv).rgb();
        p.mask = await ai.foregroundMask(img, p.w, p.h, rgba);
        // copia pequena para cor e sentido de giro
        const f = Math.min(1, 256 / Math.max(p.w, p.h));
        const sw = Math.max(1, Math.round(p.w * f)), sh = Math.max(1, Math.round(p.h * f));
        const sc = document.createElement('canvas');
        sc.width = sw; sc.height = sh;
        sc.getContext('2d').drawImage(p.bitmap, 0, 0, sw, sh);
        p.small = { rgba: sc.getContext('2d').getImageData(0, 0, sw, sh).data, w: sw, h: sh, f: sw / p.w };
        drawThumbMask(p);
        await tick();
      }
      setStep(`${photos.length} fotos recortadas. Confira os recortes e gere o modelo.`, 100);
      $('mgo').disabled = false;
    } catch (e) {
      console.error(e);
      setStep('Erro ao recortar: ' + e.message, 0);
    }
  }

  function drawThumbMask(p) {
    const c = p.thumb, ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const sx = p.w / c.width, sy = p.h / c.height;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const m = p.mask[Math.min(p.h - 1, Math.floor((y + 0.5) * sy)) * p.w + Math.min(p.w - 1, Math.floor((x + 0.5) * sx))] / 255;
        const i = (y * c.width + x) * 4;
        img.data[i] = img.data[i] * (0.25 + 0.75 * m);
        img.data[i + 1] = img.data[i + 1] * (0.25 + 0.75 * m);
        img.data[i + 2] = img.data[i + 2] * (0.25 + 0.75 * m) + 60 * (1 - m);
      }
    ctx.putImageData(img, 0, 0);
  }

  const dz = $('mdrop');
  dz.onclick = () => $('mfiles').click();
  $('mfiles').onchange = (e) => setFiles(e.target.files);
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); setFiles(e.dataTransfer.files); };

  // ------------------------------------------------------------ geracao
  function grayOf(p, box) {
    const W = 96, H = 48, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(p.bitmap, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data, g = new Float32Array(W * H), m = new Uint8Array(W * H);
    let mean = 0, n = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const px = Math.min(p.w - 1, Math.floor(box.x0 + ((x + 0.5) / W) * (box.x1 - box.x0)));
        const py = Math.min(p.h - 1, Math.floor(box.y0 + ((y + 0.5) / H) * (box.y1 - box.y0)));
        const i = y * W + x;
        m[i] = p.mask[py * p.w + px] > 200 ? 1 : 0;
        g[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];
        if (m[i]) { mean += g[i]; n++; }
      }
    mean /= n || 1;
    for (let i = 0; i < g.length; i++) g[i] -= mean;
    return { g, m, W, H };
  }

  function texturedMesh(ph, P, I, N, views, cams, choice, atlasSize, mat) {
    const lay = MV.layoutAtlas(P, I, choice, views, atlasSize);
    const atlas = document.createElement('canvas');
    atlas.width = atlas.height = atlasSize;
    const actx = atlas.getContext('2d', { willReadFrequently: true });
    actx.fillStyle = '#808080';
    actx.fillRect(0, 0, atlasSize, atlasSize);
    for (const it of lay.items) {
      const dw = Math.max(1, Math.round(it.w * it.k)), dh = Math.max(1, Math.round(it.h * it.k));
      actx.drawImage(ph[it.v].bitmap, it.x0, it.y0, it.w, it.h, it.ax, it.ay, dw, dh);
      const g = choice.gains[it.v];
      if (Math.abs(g[0] - 1) + Math.abs(g[1] - 1) + Math.abs(g[2] - 1) > 0.01) {
        const im = actx.getImageData(it.ax, it.ay, dw, dh), d = im.data;
        for (let i = 0; i < d.length; i += 4) { d[i] = d[i] * g[0]; d[i + 1] = d[i + 1] * g[1]; d[i + 2] = d[i + 2] * g[2]; }
        actx.putImageData(im, it.ax, it.ay);
      }
    }
    const nrm = new Float32Array(lay.positions.length);
    for (let i = 0; i < lay.source.length; i++) for (let c = 0; c < 3; c++) nrm[i * 3 + c] = N[lay.source[i] * 3 + c];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(lay.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(lay.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(lay.indices, 1));
    const tex = new THREE.CanvasTexture(atlas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.userData.mimeType = 'image/jpeg';
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: mat.rough, metalness: mat.metal }));
    m.name = mat.name;
    return m;
  }

  // transformacao final: simetria alinhada a x=0, frente da 1a foto em +Z, chao em y=0, metros
  // dims (opcional): medidas reais { L: comprimento em Z, W: largura em X, H: altura em Y } -> escala por eixo
  function outputTransform(P, sym, size, dims) {
    let beta = 0;
    if (sym) { beta = -sym.angle; if (Math.cos(beta) < 0) beta += Math.PI; }
    const cb = Math.cos(beta), sb = Math.sin(beta);
    const rot = (x, z) => [x * cb + z * sb, -x * sb + z * cb];
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) {
      const [x, z] = rot(P[i], P[i + 2]), q = [x, P[i + 1], z];
      for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], q[c]); mx[c] = Math.max(mx[c], q[c]); }
    }
    const ext = [0, 1, 2].map((c) => mx[c] - mn[c] || 1);
    const s0 = size / Math.max(...ext);
    const f = [s0, s0, s0];
    if (dims) {
      // sem simetria, o comprimento vai para o maior eixo horizontal
      const [ia, ib] = sym || ext[2] >= ext[0] ? [2, 0] : [0, 2];
      if (dims.L) f[ia] = dims.L / ext[ia];
      if (dims.W) f[ib] = dims.W / ext[ib];
      if (dims.H) f[1] = dims.H / ext[1];
    }
    const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
    return {
      point: (x, y, z) => { const [a, b] = rot(x, z); return [(a - cx) * f[0], (y - mn[1]) * f[1], (b - cz) * f[2]]; },
      normal: (x, y, z) => { const [a, b] = rot(x, z); const n = [a / f[0], y / f[1], b / f[2]], l = Math.hypot(...n) || 1; return n.map((v) => v / l); },
      dims: ext.map((e, c) => e * f[c]),
    };
  }
  function applyTransform(mesh, T) {
    const p = mesh.geometry.attributes.position, n = mesh.geometry.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const q = T.point(p.getX(i), p.getY(i), p.getZ(i)); p.setXYZ(i, q[0], q[1], q[2]);
      const r = T.normal(n.getX(i), n.getY(i), n.getZ(i)); n.setXYZ(i, r[0], r[1], r[2]);
    }
    mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
  }

  $('mgo').onclick = async () => {
    $('mgo').disabled = true;
    const t0 = performance.now();
    try {
      const hint = renderChips();
      const Q = QUALITY[$('mq').value];
      const n = photos.length;
      const span = +($('mspan').value === 'auto' ? hint.span || 360 : $('mspan').value) * D2R;
      const sym = $('msym').value === 'auto' ? hint.sym || 'none' : $('msym').value;
      const start = (hint.start || 0) * D2R;

      // vistas informadas por foto: as fotos sao reordenadas pelo angulo; as sem vista ficam entre as vizinhas
      const given = photos.map((p) => (p.view.value === '' ? null : +p.view.value * D2R));
      const anyGiven = given.some((g) => g != null);
      let ph = photos, az0 = null;
      if (anyGiven) {
        const gi = given.map((g, i) => (g != null ? i : -1)).filter((i) => i >= 0);
        az0 = given.map((g, i) => {
          if (g != null) return g;
          let a = gi.filter((j) => j < i).pop(), b = gi.find((j) => j > i);
          if (a === undefined) a = gi[gi.length - 1];
          if (b === undefined) b = gi[0];
          const da = (i - a + n) % n || n, db = (b - a + n) % n || n;
          let A = given[a], Bz = given[b];
          while (Bz <= A) Bz += 2 * Math.PI;
          return A + ((Bz - A) * da) / db;
        }).map((a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
        const order = photos.map((_, i) => i).sort((p, q) => az0[p] - az0[q]);
        ph = order.map((i) => photos[i]);
        az0 = order.map((i) => az0[i]);
      }
      const varied = anyGiven || $('mvaried').checked;

      setStep('Preparando silhuetas...', 2); await tick();
      const views = MV.prepareViews(ph.map((p) => ({ mask: p.mask, w: p.w, h: p.h })));

      let dir = 1, dirNote = '', cams;
      const miss = n >= 10 ? 1 : 0;
      if (anyGiven) {
        cams = MV.initialCameras(views, { span: 2 * Math.PI, dir: 1 });
        cams.forEach((c, i) => (c.az = az0[i]));
      } else {
        dir = $('mdir').value === 'ccw' ? 1 : $('mdir').value === 'cw' ? -1 : hint.dir === 'ccw' ? 1 : hint.dir === 'cw' ? -1 : 0;
        if (!dir) {
          dir = MV.estimateDirection(views.map((v, i) => grayOf(ph[i], v.box)));
          dirNote = dir ? ` (sentido detectado: ${dir > 0 ? 'anti-horário' : 'horário'})` : '';
          if (!dir) dir = 1;
        }
        cams = MV.initialCameras(views, { span, dir, start });
      }
      // simetria espelhada (plano x = 0, ja que a frente esta em +Z): fotos espelhadas viram vistas extras
      const mirror = sym === 'mirror';
      const ref = await MV.refinePoses(views, cams, {
        miss, tick, dir: anyGiven ? 1 : dir, span: anyGiven ? 2 * Math.PI : span, varied, rounds: varied ? 6 : 3, mirror, azPrior: anyGiven ? 0.00003 : 0.00015,
        onProgress: (f, msg) => setStep(`Calculando a posição de cada foto (${msg})${dirNote}...`, 5 + 35 * f),
      });
      cams = mirror ? ref.cams : ref;
      const carveViews = mirror ? ref.views : views, carveCams = mirror ? MV.withMirror(cams, views) : cams;
      cams.forEach((c, i) => (ph[i].cell.lastChild.textContent = `${Math.round((((c.az / D2R) % 360) + 360) % 360)}° · ${Math.round(c.score * 100)}%`));
      const fit = cams.reduce((s, c) => s + c.score, 0) / n;
      window.__mv = { photos: ph, views, cams, MV, models };

      setStep('Esculpindo o volume em alta resolução...', 42); await tick();
      const R = Math.max(...views.map((v, i) => Math.max(cams[i].cu - v.box.x0, v.box.x1 - cams[i].cu) / cams[i].s)) * 1.15;
      const Ry = Math.max(...views.map((v, i) => Math.max(cams[i].cr - v.box.y0, v.box.y1 - cams[i].cr) / cams[i].s)) * 1.15;
      const grid = MV.carve(carveViews, carveCams, MV.makeGrid(Math.max(R, Ry), Ry, Q.res), { miss });
      if ($('mground').checked && hint.ground !== false) { setStep('Achando o chão...', 49); await tick(); MV.groundCut(carveViews, carveCams, grid); }
      let symInfo = null;
      if (sym === 'mirror') { setStep('Aplicando simetria espelhada...', 52); await tick(); symInfo = MV.mirrorSymmetry(grid); }
      if (sym === 'rot') { setStep('Aplicando simetria de revolução...', 52); await tick(); MV.rotationalSymmetry(grid); }

      setStep('Extraindo a malha...', 56); await tick();
      let { positions, indices } = MV.surfaceNets(grid);
      if (!indices.length) throw new Error('Nada restou do volume: confira os recortes e a ordem das fotos (devem seguir a volta em torno do objeto).');
      positions = MV.taubin(positions, indices, 8);
      await MeshoptSimplifier.ready;
      const decimate = (P, I, faces, err) => {
        if (I.length / 3 <= faces) return { positions: P, indices: I };
        const [simp] = MeshoptSimplifier.simplify(I, P, 3, faces * 3, err);
        return MV.compact(P, simp);
      };
      const real = decimate(positions, indices, Q.faces, 0.01);
      const low = decimate(positions, indices, Math.max(200, +$('mtris').value), 0.2);

      const colors = ph.map((p) => p.small);
      const mat = { rough: hint.rough ?? 0.6, metal: hint.metal ?? 0, name: hint.category === 'carro' ? 'Body' : 'Model' };
      const build = async (mesh, atlasSize, p0, p1, label) => {
        const N = MV.vertexNormals(mesh.positions, mesh.indices);
        const choice = await MV.chooseViews(mesh.positions, mesh.indices, views, cams, {
          eps: grid.vs * 2.5, colors, tick,
          onProgress: (f) => setStep(`Texturizando o ${label} com as fotos...`, p0 + (p1 - p0) * f),
        });
        return texturedMesh(ph, mesh.positions, mesh.indices, N, views, cams, choice, atlasSize, mat);
      };
      const realMesh = await build(real, Q.atlas, 60, 85, 'modelo realista');
      const lowMesh = await build(low, Q.lowAtlas, 86, 97, 'low poly');

      const size = +$('msize').value || hint.size || 1;
      const T = outputTransform(real.positions, symInfo, size, hint.dims);
      applyTransform(realMesh, T);
      applyTransform(lowMesh, T);
      models.realistic = new THREE.Group().add(realMesh);
      models.lowpoly = new THREE.Group().add(lowMesh);
      models.realistic.name = models.lowpoly.name = 'Root';
      show('realistic');
      $('dl1').disabled = $('dl2').disabled = false;
      const dims = T.dims.map((d) => d.toLocaleString('pt-BR', { maximumFractionDigits: 2 })).join(' × ');
      setStep(`Concluído em ${Math.round((performance.now() - t0) / 1000)} s. Coerência das fotos: ${Math.round(fit * 100)}%${fit < 0.8 ? ' (baixa: confira recortes, ordem e sentido)' : ''}. Medidas (L × A × C): ${dims} m.`, 100);
    } catch (e) {
      console.error(e);
      setStep('Erro: ' + e.message, 0);
    }
    $('mgo').disabled = false;
  };

  renderChips();
  // teste com fotos sinteticas: ?synth=<url de um .glb>&desc=<descricao>
  const q = new URLSearchParams(location.search);
  if (q.get('synth')) {
    $('mode').value = 'multi';
    $('mode').dispatchEvent(new Event('change'));
    if (q.get('desc')) { $('mdesc').value = q.get('desc'); renderChips(); }
    import('./synth.js').then(async (m) => {
      setStep('Gerando fotos sintéticas...', 1);
      const files = await m.renderPhotos(q.get('synth'), { n: +(q.get('n') || 24), dir: +(q.get('dir') || 1), el: +(q.get('el') || 18), varied: q.get('varied') === '1' });
      await setFiles(files);
      if (q.get('views') === '1') photos.forEach((p, i) => (p.view.value = String(Math.round(((((i * 360) / photos.length) % 360) + 360) % 360))));
      if (q.get('auto')) $('mgo').click();
    });
  }
}
