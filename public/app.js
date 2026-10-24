import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = (id) => document.getElementById(id);

// ---------- Visualizador ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
camera.position.set(2.5, 1.5, 3);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(3, 5, 2);
scene.add(sun);
scene.add(new THREE.GridHelper(4, 16, 0x333a46, 0x232830));

const models = {};
let current = null, wire = false;
const loader = new GLTFLoader();

function show(name) {
  if (current) scene.remove(current);
  current = models[name] || null;
  if (current) scene.add(current);
  $('v1').classList.toggle('on', name === 'realistic');
  $('v2').classList.toggle('on', name === 'lowpoly');
  applyWire();
  if (current) {
    let tris = 0;
    current.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    $('info').textContent = `${Math.round(tris).toLocaleString('pt-BR')} triângulos`;
    fitCamera(current);
  }
}
let fitted = '';
function fitCamera(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()).length();
  const key = size.toFixed(2);
  if (fitted === key) return;
  fitted = key;
  const c = box.getCenter(new THREE.Vector3());
  controls.target.copy(c);
  camera.position.copy(c).add(new THREE.Vector3(0.7, 0.35, 0.9).multiplyScalar(size * 0.85));
  camera.near = size / 200; camera.far = size * 50; camera.updateProjectionMatrix();
}
function applyWire() {
  current?.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.wireframe = wire)); });
}
async function loadModel(name, url) {
  const gltf = await loader.loadAsync(url);
  gltf.scene.traverse((o) => { if (o.isMesh && !o.geometry.attributes.normal) o.geometry.computeVertexNormals(); });
  models[name] = gltf.scene;
}
$('v1').onclick = () => show('realistic');
$('v2').onclick = () => show('lowpoly');
$('wf').onclick = () => { wire = !wire; $('wf').classList.toggle('on', wire); applyWire(); };

function resize() {
  const m = canvas.parentElement;
  renderer.setSize(m.clientWidth, m.clientHeight, false);
  camera.aspect = m.clientWidth / m.clientHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

$('open').onclick = () => $('glbfile').click();
$('glbfile').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  await loadModel('realistic', url);
  show('realistic');
};

// ---------- Upload e pipeline ----------
let photos = [], jobId = null, events = null;
fetch('/api/tools').then((r) => r.json()).then((t) => {
  $('tools').innerHTML = t.missing.length
    ? `<small style="color:#ff9a6b">Faltando: ${t.missing.join(', ')}. Veja o README (npm run check).</small>`
    : '<small style="color:#6bd48a">COLMAP e OpenMVS encontrados.</small>';
});

let pick = 0;
const isAi = () => $('engine').value !== 'photo';
const isHy = () => $('engine').value === 'hunyuan';
function setPhotos(list) {
  photos = [...list].filter((f) => /.(jpe?g|png|tiff?|webp)$/i.test(f.name));
  pick = 0;
  $('count').innerHTML = `<small>${photos.length} foto(s) selecionada(s)</small>`;
  $('picks').innerHTML = '';
  photos.forEach((f, i) => {
    const cell = document.createElement('div');
    const im = new Image();
    im.src = URL.createObjectURL(f);
    im.style.cssText = 'width:100%;aspect-ratio:1;object-fit:cover;border-radius:4px;cursor:pointer;border:2px solid transparent';
    im.onclick = () => { pick = i; [...$('picks').children].forEach((c, j) => (c.firstChild.style.borderColor = j === i ? '#4da3ff' : 'transparent')); };
    if (i === 0) im.style.borderColor = '#4da3ff';
    const sel = document.createElement('select');
    sel.className = 'view';
    sel.innerHTML = '<option value="">ignorar</option><option value="front">frente</option><option value="left">esquerda</option><option value="back">trás</option><option value="right">direita</option>';
    sel.value = i === 0 ? 'front' : '';
    sel.style.cssText = 'width:100%;font-size:11px;padding:2px;margin-top:2px';
    cell.append(im, sel);
    $('picks').appendChild(cell);
  });
  refreshGo();
}
function refreshGo() { $('go').disabled = photos.length < (isAi() ? 1 : 8); }
function viewMap() {
  const m = {};
  [...$('picks').children].forEach((c, i) => { const v = c.querySelector('select').value; if (v) m[photos[i].name] = v; });
  return m;
}
$('clean').oninput = () => ($('cleanv').textContent = $('clean').value);
$('engine').onchange = () => { $('aiopts').hidden = !isAi(); $('quality').parentElement.hidden = isAi(); document.querySelectorAll('#picks select').forEach((s) => (s.hidden = !isHy())); $('dims').hidden = !isHy() && $('engine').value !== 'trellis'; $('side').hidden = $('engine').value !== 'trellis'; $('cleanbox').hidden = $('engine').value !== 'trellis'; refreshGo(); };
$('drop').onclick = () => $('files').click();
$('files').onchange = (e) => setPhotos(e.target.files);
$('drop').ondragover = (e) => { e.preventDefault(); $('drop').classList.add('over'); };
$('drop').ondragleave = () => $('drop').classList.remove('over');
$('drop').ondrop = (e) => { e.preventDefault(); $('drop').classList.remove('over'); setPhotos(e.dataTransfer.files); };

function addLog(l) { const el = $('log'); el.textContent += l + '\n'; el.scrollTop = el.scrollHeight; }

$('go').onclick = async () => {
  $('go').disabled = true; $('cancel').hidden = false; $('log').textContent = '';
  const fd = new FormData();
  fd.append('quality', $('quality').value);
  fd.append('lowPolyTris', $('tris').value);
  fd.append('engine', $('engine').value);
  fd.append('pick', photos[pick]?.name || '');
  fd.append('removeBg', $('rembg').checked ? '1' : '0');
  fd.append('photoSide', $('photoSide').value); fd.append('cleanLevel', $('clean').value); fd.append('length', $('dl').value); fd.append('width', $('dw').value); fd.append('height', $('dh').value);
  fd.append('views', JSON.stringify(isHy() ? viewMap() : {}));
  const chosen = isHy() ? photos.filter((f) => viewMap()[f.name]) : $('engine').value === 'trellis' ? photos.slice(0, 6) : isAi() ? [photos[pick]] : photos;
  (chosen.length ? chosen : [photos[0]]).forEach((f) => fd.append('photos', f));
  $('step').innerHTML = '<small>Enviando fotos...</small>';
  const r = await fetch('/api/jobs', { method: 'POST', body: fd });
  const j = await r.json();
  if (!r.ok) { $('step').innerHTML = `<small style="color:#ff9a6b">${j.error}</small>`; $('go').disabled = false; $('cancel').hidden = true; return; }
  jobId = j.id;
  events = new EventSource(`/api/jobs/${jobId}/events`);
  events.addEventListener('log', (e) => addLog(JSON.parse(e.data)));
  events.onmessage = async (e) => {
    const s = JSON.parse(e.data);
    $('step').innerHTML = `<small>${s.error ? 'Erro: ' + s.error : s.step}</small>`;
    $('bar').firstElementChild.style.width = s.progress + '%';
    if (s.status !== 'running') {
      events.close(); $('go').disabled = false; $('cancel').hidden = true;
      if (s.status === 'done') {
        const base = `/files/${jobId}/out/`;
        await loadModel('realistic', base + 'realistic.glb');
        await loadModel('lowpoly', base + 'lowpoly.glb');
        show('realistic');
        const dl = (id, f) => { $(id).disabled = false; $(id).onclick = () => { const a = document.createElement('a'); a.href = base + f; a.download = f; a.click(); }; };
        dl('dl1', 'realistic.glb'); dl('dl2', 'lowpoly.glb');
      }
    }
  };
};
$('cancel').onclick = () => fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });

// Abre direto um resultado ja gerado: /?job=<id>
const qJob = new URLSearchParams(location.search).get('job');
if (qJob) {
  const base = `/files/${qJob}/out/`;
  Promise.all([loadModel('realistic', base + 'realistic.glb'), loadModel('lowpoly', base + 'lowpoly.glb')]).then(() => show('realistic'));
}

$('engine').onchange();
