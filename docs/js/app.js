import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MeshoptSimplifier } from './vendor/meshopt_simplifier.module.js';
import { segment, carve, surfaceNets, smooth, vertexNormals, prepareColorViews, colorize, normalizePositions, compact } from './hull.js';

const $ = (id) => document.getElementById(id);
const tick = () => new Promise((r) => setTimeout(r, 0));
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

// ---------- Visualizador ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(devicePixelRatio);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
camera.position.set(2.5, 1.5, 3);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 0.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(3, 5, 2);
scene.add(sun);
scene.add(new THREE.GridHelper(4, 16, 0x333a46, 0x232830));

const models = {};
let current = null, wire = false;
const eachMat = (obj, f) => obj.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(f); });
let fitted = '';
function fitCamera(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  const key = size.toFixed(2);
  if (fitted === key) return;
  fitted = key;
  const c = box.getCenter(new THREE.Vector3());
  controls.target.copy(c);
  camera.position.copy(c).add(new THREE.Vector3(0.7, 0.35, 0.9).multiplyScalar(size * 0.85));
  camera.near = size / 200; camera.far = size * 50; camera.updateProjectionMatrix();
}
function show(name) {
  if (current) scene.remove(current);
  current = models[name] || null;
  if (current) {
    scene.add(current);
    let tris = 0;
    current.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    $('info').textContent = `${Math.round(tris).toLocaleString('pt-BR')} triângulos`;
    eachMat(current, (m) => (m.wireframe = wire));
    fitCamera(current);
  }
  $('v1').classList.toggle('on', name === 'realistic');
  $('v2').classList.toggle('on', name === 'lowpoly');
}
$('v1').onclick = () => show('realistic');
$('v2').onclick = () => show('lowpoly');
$('wf').onclick = () => { wire = !wire; $('wf').classList.toggle('on', wire); if (current) eachMat(current, (m) => (m.wireframe = wire)); };
function resize() {
  const m = canvas.parentElement;
  renderer.setSize(m.clientWidth, m.clientHeight, false);
  camera.aspect = m.clientWidth / m.clientHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

function makeMesh(positions, indices, colors, flat) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const lc = new Float32Array(colors.length);
  for (let i = 0; i < colors.length; i++) lc[i] = lin(colors[i]);
  geo.setAttribute('color', new THREE.BufferAttribute(lc, 3));
  if (indices) geo.setIndex(new THREE.BufferAttribute(indices, 1));
  if (flat) geo.computeVertexNormals();
  else geo.setAttribute('normal', new THREE.BufferAttribute(vertexNormals(positions, indices), 3));
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
}

async function download(name) {
  const url = models[name]?.userData?.url; // GLB gerado pelo servidor local: baixa o arquivo original (com PBR, ancoras, etc.)
  if (url) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await (await fetch(url)).blob());
    a.download = `${name}.glb`;
    a.click();
    return;
  }
  new GLTFExporter().parse(models[name], (buf) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
    a.download = `${name}.glb`;
    a.click();
  }, (e) => alert('Falha ao exportar: ' + e.message), { binary: true });
}
$('dl1').onclick = () => download('realistic');
$('dl2').onclick = () => download('lowpoly');

// ---------- Fotos ----------
let photos = []; // { rgba, w, h, mask }
const MAXDIM = 640;

async function loadFiles(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/')).slice(0, 72);
  const bitmaps = [];
  for (const f of list) bitmaps.push(await createImageBitmap(f));
  setBitmaps(bitmaps);
}
function setBitmaps(bitmaps) {
  const k = Math.min(1, MAXDIM / Math.max(bitmaps[0].width, bitmaps[0].height));
  const w = Math.round(bitmaps[0].width * k), h = Math.round(bitmaps[0].height * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  photos = bitmaps.map((b) => {
    ctx.drawImage(b, 0, 0, w, h);
    return { rgba: ctx.getImageData(0, 0, w, h).data, w, h, mask: null };
  });
  $('count').innerHTML = `<small>${photos.length} foto(s) — passo de ${(360 / photos.length).toFixed(1)}° entre fotos</small>`;
  $('go').disabled = photos.length < 8;
  $('step').innerHTML = photos.length < 8 ? '<small>Use pelo menos 8 fotos</small>' : '<small>Pronto</small>';
  updateMasks();
}
let maskTimer = 0;
function updateMasks() {
  clearTimeout(maskTimer);
  maskTimer = setTimeout(() => {
    const box = $('thumbs');
    box.innerHTML = '';
    photos.forEach((p) => {
      p.mask = segment(p.rgba, p.w, p.h, +$('thr').value).mask;
      const c = document.createElement('canvas');
      c.width = p.w; c.height = p.h;
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(p.w, p.h);
      for (let i = 0; i < p.mask.length; i++) {
        const m = p.mask[i];
        img.data[i * 4] = m ? p.rgba[i * 4] : 20;
        img.data[i * 4 + 1] = m ? p.rgba[i * 4 + 1] : 20;
        img.data[i * 4 + 2] = m ? p.rgba[i * 4 + 2] : 20;
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      box.appendChild(c);
    });
  }, 120);
}
$('thr').oninput = () => { $('thrv').textContent = $('thr').value; if (photos.length) updateMasks(); };
$('drop').onclick = () => $('files').click();
$('files').onchange = (e) => loadFiles(e.target.files);
$('drop').ondragover = (e) => { e.preventDefault(); $('drop').classList.add('over'); };
$('drop').ondragleave = () => $('drop').classList.remove('over');
$('drop').ondrop = (e) => { e.preventDefault(); $('drop').classList.remove('over'); loadFiles(e.dataTransfer.files); };

// Exemplo: renderiza um objeto com Three em 36 angulos (camera ortografica, fundo liso)
$('demo').onclick = async () => {
  const N = 36, S = 512;
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(S, S, false);
  r.setClearColor(0x6f7f8f);
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
  const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(2, 3, 4); sc.add(dl);
  const obj = new THREE.Group();
  const add = (geo, color, x, y, z) => { const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.7 })); m.position.set(x, y, z); obj.add(m); };
  add(new THREE.BoxGeometry(1.4, 0.8, 0.8), 0xd9822b, 0, -0.4, 0);
  add(new THREE.SphereGeometry(0.45, 32, 24), 0x2b7fd9, 0.25, 0.2, 0);
  add(new THREE.ConeGeometry(0.28, 0.7, 24), 0x3fb56b, -0.45, 0.35, 0.1);
  sc.add(obj);
  const cam = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 20);
  cam.position.set(0, 0, 8);
  const c2 = document.createElement('canvas'); c2.width = c2.height = S;
  const bms = [];
  for (let i = 0; i < N; i++) {
    obj.rotation.y = (i / N) * Math.PI * 2;
    r.render(sc, cam);
    c2.getContext('2d').drawImage(r.domElement, 0, 0);
    bms.push(await createImageBitmap(c2));
  }
  r.dispose();
  $('rev').checked = false;
  setBitmaps(bms);
};

// ---------- Geracao ----------
const setStep = (t, p) => { $('step').innerHTML = `<small>${t}</small>`; $('bar').firstElementChild.style.width = p + '%'; };

$('go').onclick = async () => {
  $('go').disabled = true;
  try {
    const res = +$('res').value, miss = +$('miss').value, smoothIt = +$('smooth').value;
    const n = photos.length, sign = $('rev').checked ? -1 : 1;
    const angles = photos.map((_, i) => sign * (i / n) * Math.PI * 2);

    setStep('Segmentando fotos', 5); await tick();
    const views = photos.map((p) => ({ rgba: p.rgba, w: p.w, h: p.h, mask: segment(p.rgba, p.w, p.h, +$('thr').value).mask }));

    setStep('Esculpindo volume', 20); await tick();
    const grid = carve(views, angles, { res, miss, blur: 2 });

    setStep('Extraindo malha', 50); await tick();
    let { positions, indices } = surfaceNets(grid);
    if (!indices.length) throw new Error('Nenhum volume restou. Aumente a tolerância de erro, ajuste o fundo ou confira o sentido da rotação.');
    if (smoothIt) positions = smooth(positions, indices, smoothIt);

    setStep('Colorindo a partir das fotos', 65); await tick();
    const cviews = prepareColorViews(views);
    const colors = colorize(positions, vertexNormals(positions, indices), cviews, angles, grid.cx);

    models.realistic = makeMesh(normalizePositions(positions), indices, colors, false);

    setStep('Gerando low poly', 85); await tick();
    await MeshoptSimplifier.ready;
    const target = Math.max(100, +$('tris').value) * 3;
    const [simp] = MeshoptSimplifier.simplify(indices, positions, 3, Math.min(target, indices.length), 0.5);
    const lp = compact(positions, simp);
    let lowMesh;
    if ($('facet').checked) {
      const T = lp.indices.length / 3, P = new Float32Array(T * 9), cen = new Float32Array(T * 3);
      const fn = new Float32Array(T * 3), C = new Float32Array(T * 9);
      const vn = vertexNormals(lp.positions, lp.indices);
      for (let t = 0; t < T; t++)
        for (let e = 0; e < 3; e++) {
          const v = lp.indices[t * 3 + e];
          for (let c = 0; c < 3; c++) { P[t * 9 + e * 3 + c] = lp.positions[v * 3 + c]; cen[t * 3 + c] += lp.positions[v * 3 + c] / 3; fn[t * 3 + c] += vn[v * 3 + c]; }
        }
      for (let t = 0; t < T; t++) { const l = Math.hypot(fn[t*3], fn[t*3+1], fn[t*3+2]) || 1; fn[t*3] /= l; fn[t*3+1] /= l; fn[t*3+2] /= l; }
      const fc = colorize(cen, fn, cviews, angles, grid.cx);
      for (let t = 0; t < T; t++) for (let e = 0; e < 3; e++) for (let c = 0; c < 3; c++) C[t * 9 + e * 3 + c] = fc[t * 3 + c];
      lowMesh = makeMesh(normalizePositions(P, positions), null, C, true);
    } else {
      const lc = colorize(lp.positions, vertexNormals(lp.positions, lp.indices), cviews, angles, grid.cx);
      lowMesh = makeMesh(normalizePositions(lp.positions, positions), lp.indices, lc, false);
    }
    models.lowpoly = lowMesh;

    show('realistic');
    $('dl1').disabled = $('dl2').disabled = false;
    setStep('Concluído', 100);
  } catch (e) {
    setStep('Erro: ' + e.message, 0);
  }
  $('go').disabled = false;
};


// Modos extras: foto unica (IA no navegador) e gerador local
import('./modes.js').then((m) => m.init({ models, show, setStep, $ }));
import('./mvmode.js').then((m) => m.init({ models, show, setStep, $ }));
