// OBJ (texturizado) -> GLB realista + GLB low poly. Sem IA: obj2gltf + glTF-Transform + meshoptimizer.
import fs from 'node:fs/promises';
import obj2gltf from 'obj2gltf';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup, textureCompress, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

export function countTriangles(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      n += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  return Math.round(n);
}

// Normais suaves ponderadas por area (normals() do glTF-Transform gera normais planas e desfaz o weld).
function smoothNormals(doc) {
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      if (!pos || !idx) continue;
      const P = pos.getArray(), I = idx.getArray(), N = new Float32Array(P.length);
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const i of [a, b, c]) { N[i] += nx; N[i + 1] += ny; N[i + 2] += nz; }
      }
      for (let i = 0; i < N.length; i += 3) {
        const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
        N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
      }
      prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N).setBuffer(pos.getBuffer()));
    }
}

// OpenMVS/COLMAP usam Y para baixo: gira 180 graus em X, centraliza e escala para ~2 unidades.
function normalizeScene(doc) {
  const scene = doc.getRoot().listScenes()[0];
  const root = doc.createNode('modelo').setRotation([1, 0, 0, 0]);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    root.addChild(child);
  }
  scene.addChild(root);
  const { min, max } = getBounds(scene);
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const s = 2 / size;
  const c = min.map((v, i) => (v + max[i]) / 2);
  root.setScale([s, s, s]).setTranslation([-c[0] * s, -c[1] * s, -c[2] * s]);
}

async function toGlb(objPath) {
  const glb = await obj2gltf(objPath, { binary: true, secure: true });
  return io.readBinary(new Uint8Array(glb));
}

async function shrinkTextures(doc, size, quality) {
  await doc.transform(
    textureCompress({ encoder: sharp, resize: [size, size], targetFormat: 'jpeg', quality })
  );
}

export async function buildModels(objPath, outDir, opts = {}, log = console.log) {
  const { realisticMaxTris = 300_000, lowPolyTris = 5000, realisticTex = 4096, lowTex = 1024 } = opts;
  await MeshoptSimplifier.ready;
  await fs.mkdir(outDir, { recursive: true });

  log('Convertendo OBJ -> glTF...');
  const doc = await toGlb(objPath);
  const keepTex = { pruneSolidTextures: false };
  await doc.transform(weld(), dedup(), prune(keepTex));
  normalizeScene(doc);

  // --- Realista ---
  const total = countTriangles(doc);
  log(`Malha original: ${total.toLocaleString()} triangulos`);
  if (total > realisticMaxTris) {
    log(`Reduzindo versao realista para ~${realisticMaxTris.toLocaleString()} triangulos...`);
    await doc.transform(
      simplify({ simplifier: MeshoptSimplifier, ratio: realisticMaxTris / total, error: 0.01 })
    );
  }
  smoothNormals(doc);
  await shrinkTextures(doc, realisticTex, 92);
  const realisticTris = countTriangles(doc);
  await io.write(`${outDir}/realistic.glb`, doc);
  log(`realistic.glb pronto (${realisticTris.toLocaleString()} tris)`);

  // --- Low poly ---
  const hi = realisticTris;
  log(`Gerando low poly (~${lowPolyTris.toLocaleString()} triangulos)...`);
  await doc.transform(
    simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, lowPolyTris / hi), error: 0.25, lockBorder: false })
  );
  smoothNormals(doc);
  await doc.transform(prune(keepTex));
  await shrinkTextures(doc, lowTex, 80);
  const lowTris = countTriangles(doc);
  await io.write(`${outDir}/lowpoly.glb`, doc);
  log(`lowpoly.glb pronto (${lowTris.toLocaleString()} tris)`);

  const sizes = {};
  for (const f of ['realistic', 'lowpoly']) sizes[f] = (await fs.stat(`${outDir}/${f}.glb`)).size;
  return { realisticTris, lowTris, sizes };
}
