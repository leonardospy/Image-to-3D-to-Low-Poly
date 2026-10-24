// Reduz o tamanho de um GLB (texturas em JPEG) mantendo nos vazios, luzes (KHR_lights_punctual) e extras.
//   node scripts/optimize-glb.mjs entrada.glb saida.glb [tamanhoMaxTextura=2048]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import fs from 'node:fs';

const [src, dst, size = '2048'] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
await doc.transform(
  prune({ keepLeaves: true, pruneSolidTextures: false }),
  textureCompress({ encoder: sharp, resize: [+size, +size], targetFormat: 'jpeg', quality: 90 })
);
await io.write(dst, doc);
console.log(`${(fs.statSync(src).size / 1e6).toFixed(1)} MB -> ${(fs.statSync(dst).size / 1e6).toFixed(1)} MB`);
