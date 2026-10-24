// Modos "qualquer foto": IA no navegador (transformers.js) e ponte para o gerador local (TRELLIS.2 no PC do usuario).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildRelief } from './relief.js';
import * as ai from './ai.js';

const LOCAL = 'http://localhost:3000';

export function init({ models, show, setStep, $ }) {
  // ---------------------------------------------------------------- alternancia de modo
  const panels = { multi: $('multi'), single: $('single'), local: $('local'), turntable: $('turn') };
  let localTimer = 0;
  const setMode = (m) => {
    for (const [k, el] of Object.entries(panels)) el.hidden = k !== m;
    clearInterval(localTimer);
    if (m === 'local') { probeLocal(); localTimer = setInterval(probeLocal, 5000); }
    setStep('Pronto', 0);
  };
  $('mode').onchange = () => setMode($('mode').value);
  setMode($('mode').value);

  const bindDrop = (zone, input, onFile) => {
    zone.onclick = () => input.click();
    input.onchange = () => input.files[0] && onFile(input.files[0], [...input.files]);
    zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('over'); };
    zone.ondragleave = () => zone.classList.remove('over');
    zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) onFile(f, [...e.dataTransfer.files]); };
  };

  // ---------------------------------------------------------------- foto unica (IA no navegador)
  let sFile = null;
  bindDrop($('sdrop'), $('sfile'), (f) => {
    sFile = f;
    $('spreview').src = URL.createObjectURL(f);
    $('spreview').style.display = 'block';
    $('sgo').disabled = false;
  });
  $('sdepth').oninput = () => ($('sdv').textContent = $('sdepth').value);

  async function loadModels() {
    await ai.loadSegmenter(setStep);
    await ai.loadDepth(setStep);
  }

  $('sgo').onclick = async () => {
    $('sgo').disabled = true;
    try {
      await loadModels();
      setStep('Lendo a foto...', 45);
      const tf = await ai.getTF();
      const image = (await tf.RawImage.fromBlob(sFile)).rgb();
      const maxd = 1024;
      const k = Math.min(1, maxd / Math.max(image.width, image.height));
      const img = k < 1 ? await image.resize(Math.round(image.width * k), Math.round(image.height * k)) : image;
      const w = img.width, h = img.height;
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const bmp = await createImageBitmap(sFile, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
      ctx.drawImage(bmp, 0, 0);
      const rgba = ctx.getImageData(0, 0, w, h).data;

      setStep('Separando o objeto do fundo...', 55);
      const mask = await ai.foregroundMask(img, w, h, rgba);
      setStep('Estimando a profundidade...', 70);
      const out = await (await ai.loadDepth())(img);
      const dep = await out.depth.resize(w, h);
      const depth = Uint8Array.from(dep.data);

      setStep('Montando a malha 3D...', 85);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const thickness = +$('sdepth').value / 100;
      const make = (cells, flat) => {
        const r = buildRelief({ mask, depth, w, h }, { cells, thickness });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(r.uvs, 2));
        g.setIndex(new THREE.BufferAttribute(r.indices, 1));
        g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0, flatShading: flat }));
        return { mesh, tris: r.indices.length / 3 };
      };
      models.realistic = make(+$('sres').value, false).mesh;
      const target = Math.max(300, +$('stris').value);
      let cells = Math.max(8, Math.round(Math.sqrt(target / 3)));
      let low = make(cells, true);
      cells = Math.max(6, Math.round(cells * Math.sqrt(target / low.tris)));
      low = make(cells, true);
      models.lowpoly = low.mesh;
      show('realistic');
      $('dl1').disabled = $('dl2').disabled = false;
      setStep('Concluído', 100);
    } catch (e) {
      console.error(e);
      setStep('Erro: ' + e.message, 0);
    }
    $('sgo').disabled = false;
  };

  // ---------------------------------------------------------------- gerador local (TRELLIS.2)
  let lFile = null, lFiles = [], localOk = false;
  bindDrop($('ldz'), $('lfile'), (f, all) => {
    lFile = f;
    lFiles = all || [f];
    $('lpreview').src = URL.createObjectURL(f);
    $('lpreview').style.display = 'block';
    refreshLocal();
  });
  $('lclean').oninput = () => ($('lcv').textContent = $('lclean').value);
  function refreshLocal() { $('lgo').disabled = !(lFile && localOk); }
  async function probeLocal() {
    try {
      const t = await (await fetch(`${LOCAL}/api/tools`)).json();
      localOk = !!(t.comfy || t.ai);
      $('lstatus').innerHTML = localOk ? '<span style="color:#6bd48a">Gerador local encontrado (ComfyUI ok).</span>' : '<span style="color:#ff9a6b">Gerador local ligado, mas sem ComfyUI.</span>';
    } catch {
      localOk = false;
      $('lstatus').innerHTML = '<span style="color:#ff9a6b">Gerador local não encontrado em localhost:3000. Rode <code>npm start</code> na pasta do projeto e recarregue (use Chrome/Edge/Firefox).</span>';
    }
    refreshLocal();
  }
  $('lgo').onclick = async () => {
    $('lgo').disabled = true;
    try {
      const fd = new FormData();
      fd.append('engine', $('lengine').value);
      if ($('lengine').value === 'hunyuan') fd.append('views', JSON.stringify({ [lFile.name]: $('lside').value === 'rear' ? 'back' : 'front' }));
      fd.append('lowPolyTris', $('ltris').value);
      fd.append('length', $('ll').value); fd.append('width', $('lw').value); fd.append('height', $('lh').value);
      fd.append('photoSide', $('lside').value);
      fd.append('cleanLevel', $('lclean').value);
      for (const f of ($('lengine').value === 'trellis' ? lFiles.slice(0, 6) : [lFile])) fd.append('photos', f); // TRELLIS.2 junta varias fotos do mesmo objeto
      setStep('Enviando a foto ao seu PC...', 2);
      const r = await fetch(`${LOCAL}/api/jobs`, { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'falha ao iniciar');
      await new Promise((resolve, reject) => {
        const es = new EventSource(`${LOCAL}/api/jobs/${j.id}/events`);
        es.onmessage = (e) => {
          const s = JSON.parse(e.data);
          setStep(s.error ? 'Erro: ' + s.error : s.step, s.progress || 0);
          if (s.status === 'done') { es.close(); resolve(); }
          if (s.status === 'error') { es.close(); reject(new Error(s.error)); }
        };
        es.onerror = () => { /* reconecta sozinho */ };
      });
      const loader = new GLTFLoader();
      for (const [name, file] of [['realistic', 'realistic.glb'], ['lowpoly', 'lowpoly.glb']]) {
        const url = `${LOCAL}/files/${j.id}/out/${file}`;
        const g = await loader.loadAsync(url);
        g.scene.userData.url = url;
        models[name] = g.scene;
      }
      show('realistic');
      $('dl1').disabled = $('dl2').disabled = false;
      setStep('Concluído', 100);
    } catch (e) {
      setStep('Erro: ' + e.message, 0);
    }
    refreshLocal();
  };
}
