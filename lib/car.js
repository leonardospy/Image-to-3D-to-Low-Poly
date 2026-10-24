// Acabamento de GLB de carro: materiais PBR por parte, cor de vertice em linear, ancoras de luz e texturas leves.
import fs from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsClearcoat } from '@gltf-transform/extensions';
import { prune, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const srgb2lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function toLinearColors(doc, prim) {
  const acc = prim.getAttribute('COLOR_0');
  if (!acc) return;
  const n = acc.getCount();
  const out = new Float32Array(n * 4);
  const el = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    acc.getElement(i, el); // ja normalizado 0..1 (UNSIGNED_BYTE normalized)
    out[i * 4] = srgb2lin(el[0]);
    out[i * 4 + 1] = srgb2lin(el[1]);
    out[i * 4 + 2] = srgb2lin(el[2]);
    out[i * 4 + 3] = acc.getElementSize() === 4 ? el[3] : 1;
  }
  const neu = doc.createAccessor().setType('VEC4').setArray(out).setBuffer(acc.getBuffer());
  prim.setAttribute('COLOR_0', neu);
}

export async function finalizeCar(inPath, outPath, meta, { textureSize = 2048, clearcoatBody = true } = {}) {
  const doc = await io.read(inPath);
  const root = doc.getRoot();
  const clearcoat = doc.createExtension(KHRMaterialsClearcoat);
  const mats = {};
  const mat = (key, f) => (mats[key] ||= f(doc.createMaterial(key)));

  const partOf = (name) => {
    if (/_tire$/.test(name)) return 'tire';
    if (/_rim$/.test(name)) return 'rim';
    if (/_disc$/.test(name)) return 'disc';
    if (/_mesh$/.test(name)) return 'wheelmesh';
    return name.split('_')[0];
  };

  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const name = node.getName();
    const part = partOf(name);
    for (const prim of mesh.listPrimitives()) {
      const old = prim.getMaterial();
      const tex = old?.getBaseColorTexture();
      toLinearColors(doc, prim);
      let m;
      if (tex && (part === 'Body' || part === 'wheelmesh')) {
        m = old; // carro texturizado (TRELLIS.2): mantem os mapas PBR originais
        m.setDoubleSided(false);
        if (part === 'Body' && clearcoatBody) m.setExtension('KHR_materials_clearcoat', clearcoat.createClearcoat().setClearcoatFactor(0.8).setClearcoatRoughnessFactor(0.08));
      } else if (tex && (part === 'Headlight' || part === 'Taillight')) {
        m = (mats['lamp_' + part] ||= old.clone().setName(part).setEmissiveFactor([0, 0, 0]));
      } else if (part === 'Body') {
        m = doc.createMaterial('Body').setMetallicFactor(0.35).setRoughnessFactor(0.4);
        if (tex) m.setBaseColorTexture(tex);
        m.setExtension('KHR_materials_clearcoat', clearcoat.createClearcoat().setClearcoatFactor(1).setClearcoatRoughnessFactor(0.06));
      } else if (part === 'Glass') {
        m = mat('Glass', (x) => x.setBaseColorFactor([0.04, 0.06, 0.08, 0.82]).setAlphaMode('BLEND').setMetallicFactor(0).setRoughnessFactor(0.05).setDoubleSided(true));
      } else if (part === 'Headlight') {
        m = mat('Headlight', (x) => x.setBaseColorFactor([0.5, 0.54, 0.58, 1]).setMetallicFactor(0.2).setRoughnessFactor(0.08).setEmissiveFactor([0.1, 0.1, 0.09]));
      } else if (part === 'Taillight') {
        m = mat('Taillight', (x) => x.setBaseColorFactor([0.5, 0.02, 0.02, 1]).setMetallicFactor(0).setRoughnessFactor(0.1).setEmissiveFactor([0.25, 0, 0]));
      } else if (part === 'tire') {
        m = mat('Tire', (x) => x.setBaseColorFactor([0.02, 0.02, 0.022, 1]).setMetallicFactor(0).setRoughnessFactor(0.92).setDoubleSided(true));
      } else if (part === 'rim') {
        m = mat('Rim', (x) => x.setBaseColorFactor([0.72, 0.73, 0.76, 1]).setMetallicFactor(0.9).setRoughnessFactor(0.28).setDoubleSided(true));
      } else if (part === 'disc') {
        m = mat('BrakeDisc', (x) => x.setBaseColorFactor([0.12, 0.12, 0.13, 1]).setMetallicFactor(0.6).setRoughnessFactor(0.5).setDoubleSided(true));
      } else continue;
      prim.setMaterial(m);
      if (!tex) prim.setAttribute('COLOR_0', ['Glass', 'Headlight', 'Taillight', 'tire', 'rim', 'disc'].includes(part) ? null : prim.getAttribute('COLOR_0'));
    }
  }

  // ancoras de luz (nos vazios) para o jogo prender SpotLights/PointLights
  const scene = root.listScenes()[0];
  for (const a of meta.anchors || []) {
    scene.addChild(doc.createNode(a.name).setTranslation(a.position));
  }
  for (const w of meta.wheels || []) {
    const n = root.listNodes().find((x) => x.getName() === w.name);
    if (n) n.setExtras({ radius: w.radius, width: w.width, spinAxis: 'X' });
  }
  scene.setExtras({ units: 'meters', up: 'Y', front: '+Z', left: '+X', ...meta.dims });

  await doc.transform(prune({ pruneSolidTextures: false, keepLeaves: true }), textureCompress({ encoder: sharp, resize: [textureSize, textureSize], targetFormat: 'jpeg', quality: 90 }));
  await io.write(outPath, doc);
  return (await fs.stat(outPath)).size;
}
