# Foto → 3D (sem IA)

Fotogrametria clássica rodando local, com interface no navegador.
Entra: fotos do objeto. Sai: `realistic.glb` e `lowpoly.glb`, prontos para o `GLTFLoader` do Three.js.

```
fotos ──► COLMAP (SfM: poses de câmera)
      ──► OpenMVS (nuvem densa → malha → textura)
      ──► Node: obj2gltf + glTF-Transform + meshoptimizer
              ├─ realistic.glb  (≤ 300k tris, textura até 4096 px)
              └─ lowpoly.glb    (alvo configurável, padrão 5000 tris, textura 1024 px)
```

Nenhum modelo de IA: só geometria multi-vista (SIFT, bundle adjustment, PatchMatch) e decimação por quadric error (meshoptimizer).

## Dois modos

| | Modo servidor (este README) | Modo navegador (GitHub Pages, pasta `docs/`) |
|---|---|---|
| Entrada | fotos soltas, qualquer ângulo | fotos de mesa giratória, fundo liso |
| Método | COLMAP + OpenMVS (fotogrametria) | silhuetas / visual hull + cor projetada |
| Qualidade | alta, textura real | forma aproximada, cor por vértice |
| Instalação | COLMAP, OpenMVS, Node | nenhuma |

Modo navegador: https://leonardospy.github.io/Image-to-3D-to-Low-Poly/ (ativar em Settings → Pages → Branch `main` / pasta `/docs`). Há um botão "Testar com exemplo". Teste do algoritmo: `node scripts/test-hull.js`.

## Instalação

1. **Node 18+** (já usado: v24).
2. `npm install`
3. Baixe os binários (grátis) e descompacte, p.ex. em `./tools/`:
   - **COLMAP** — https://github.com/colmap/colmap/releases (versão CUDA se tiver placa NVIDIA; senão a CPU)
   - **OpenMVS** — https://github.com/cdcseacave/openMVS/releases (ou compile)
4. `npm run check` — mostra o que foi encontrado. Os executáveis são procurados em
   `config.json` (copie `config.example.json`) → variáveis de ambiente → `PATH` → `./tools` (recursivo).
5. `npm start` e abra http://localhost:3000

## Como fotografar (define 90% da qualidade)

- 30–80 fotos, 60–80% de sobreposição entre fotos vizinhas, dando a volta no objeto em 2–3 alturas.
- Objeto **fosco e com textura**. Vidro, espelho, metal polido e superfícies lisas/brancas falham.
- Luz difusa e constante (nublado ou softbox), foco nítido, sem modo retrato, sem mover o objeto entre fotos.
- Fundo com detalhes ajuda no alinhamento (não use fundo infinito liso).

## Uso

Na página: arraste as fotos, escolha qualidade (Rápido / Médio / Alto) e o nº de triângulos do low poly, clique em **Gerar**. O resultado aparece no visualizador (alterna Realista / Low poly / Wireframe) e pode ser baixado.

Já tem um OBJ texturizado (Meshroom, RealityCapture, Blender)? Converta sem a fotogrametria:

```
npm run postprocess -- modelo.obj saida 5000
```

## Usar no Three.js

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
new GLTFLoader().load('lowpoly.glb', (g) => scene.add(g.scene));
```

Os GLB não usam Draco/Meshopt, então não precisam de decoder extra. O modelo sai centralizado na origem, com ~2 unidades de tamanho e eixo Y para cima.

## Limitações conhecidas

- O low poly é decimado por geometria; as UVs não entram no erro, então em alvos muito baixos (< 1000 tris) a textura pode distorcer um pouco nas emendas. Para acabamento artístico, retopologia manual no Blender continua melhor.
- Fundo e chão fotografados viram parte da malha; apare no Blender ou use cena com objeto isolado.
- Escala é arbitrária (fotogrametria sem referência); o modelo é normalizado para ~2 unidades.
- Sem GPU NVIDIA o OpenMVS ainda funciona (CPU), só mais lento.
- Este projeto foi testado aqui apenas na etapa de pós-processamento (OBJ → GLB realista/low poly) e no servidor; a cadeia COLMAP/OpenMVS depende de você instalar os binários e não foi executada com fotos reais.
