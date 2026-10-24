// Fotos sinteticas para testar o modo "Fotos em volta": renderiza um .glb de varios angulos, com camera em perspectiva,
// chao, objetos ao fundo e pequenas variacoes de distancia/altura/enquadramento (como fotos feitas a mao).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export async function renderPhotos(url, { n = 24, dir = 1, el = 18, W = 1280, H = 960, seed = 7, varied = false } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(W, H, false);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb4c8);
  scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(4, 8, 3);
  scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x556655, 0.6));

  const g = await new GLTFLoader().loadAsync(url);
  const obj = g.scene;
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  obj.position.set(-c.x, -box.min.y, -c.z);
  scene.add(obj);
  const L = Math.max(size.x, size.y, size.z);

  // chao xadrez e "bagunca" ao fundo
  const tc = document.createElement('canvas');
  tc.width = tc.height = 256;
  const tx = tc.getContext('2d');
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { tx.fillStyle = (i + j) % 2 ? '#6d6a64' : '#86837c'; tx.fillRect(i * 32, j * 32, 32, 32); }
  const ft = new THREE.CanvasTexture(tc);
  ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(20, 20); ft.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(L * 30, L * 30), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const colors = [0xc0392b, 0x2980b9, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xe67e22];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rnd() * 0.2, d = L * (5 + 3 * Math.abs(rnd()));
    const b = new THREE.Mesh(new THREE.BoxGeometry(L * 0.4, L * (0.3 + Math.abs(rnd())), L * 0.4), new THREE.MeshStandardMaterial({ color: colors[i % 6], roughness: 0.6 }));
    b.position.set(Math.sin(a) * d, b.geometry.parameters.height / 2, Math.cos(a) * d);
    scene.add(b);
  }

  const cam = new THREE.PerspectiveCamera(40, W / H, L / 100, L * 100);
  const files = [], truth = [];
  for (let i = 0; i < n; i++) {
    const az = dir * (i / n) * Math.PI * 2 + rnd() * 0.07;
    // varied: cada foto com altura e distancia/zoom bem diferentes (como capturas de tela de um visualizador)
    const e = (varied ? 17 + rnd() * 17 : el + rnd() * 3) * (Math.PI / 180);
    const dist = L * (varied ? 2.4 + rnd() * 1.0 : 1.9 * (1 + rnd() * 0.06));
    cam.fov = varied ? 2 * Math.atan((L * 0.62) / dist) * (180 / Math.PI) * (1 + rnd() * 0.15) : 40;
    cam.updateProjectionMatrix();
    const target = new THREE.Vector3(rnd() * L * 0.03, size.y * 0.45 + rnd() * L * 0.02, rnd() * L * 0.03);
    cam.position.set(Math.sin(az) * Math.cos(e) * dist, target.y + Math.sin(e) * dist, Math.cos(az) * Math.cos(e) * dist);
    cam.lookAt(target);
    truth.push({ az, el: e, dist, fov: cam.fov, target: target.toArray() });
    r.render(scene, cam);
    const blob = await new Promise((res) => r.domElement.toBlob(res, 'image/jpeg', 0.92));
    files.push(new File([blob], `foto_${String(i + 1).padStart(2, '0')}.jpg`, { type: 'image/jpeg' }));
  }
  r.dispose();
  window.__synthTruth = { truth, size: size.toArray(), L, fov: 40 };
  return files;
}
