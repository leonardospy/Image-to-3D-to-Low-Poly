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

### Fotos em volta (navegador, modo padrão do Pages)
Roda 100% no navegador, em qualquer plataforma (Chrome/Edge/Firefox/Safari, desktop ou celular): 4 a 60 fotos tiradas andando em volta do objeto, com a câmera na mão e qualquer fundo → GLB realista (malha de até 300 mil triângulos com textura feita das próprias fotos) e low poly texturizado.
1. A IA RMBG-1.4 (transformers.js, WebGPU quando houver) recorta o objeto em cada foto.
2. A posição de cada foto é estimada pela coerência entre silhuetas: elevação e perspectiva comuns, depois o ângulo, o centro e a escala de cada foto, com os ângulos mantidos na ordem da volta.
3. Escultura por silhuetas suaves em grade fina, corte da "quilha" abaixo do chão, simetria opcional, Surface Nets e suavização de Taubin.
4. Textura: para cada triângulo, a foto que o vê mais de frente (com teste de visibilidade), escolha suavizada entre vizinhos, ganho de cor por foto e atlas JPEG de até 4096².
5. O campo "O que está nas fotos?" (`docs/js/scene-text.js`) ajusta simetria (espelhada para carro, pessoa, cadeira…; de revolução para garrafa, vaso…), tamanho real em metros, rugosidade/metal, por onde a volta começou, meia volta, sentido e se o objeto está apoiado no chão.

Fotos fora de ordem ou de alturas/zoom diferentes (ex.: capturas de tela): marque a vista de cada foto no seletor embaixo da miniatura; as fotos são reordenadas e cada uma ganha elevação, escala e perspectiva próprias. Com simetria espelhada, cada foto espelhada vira uma vista extra do lado oposto. Medidas completas na descrição ("4,28 x 1,76 x 1,23 m" ou "largura 1,76 m") ajustam o modelo final por eixo.

Uma foto só (`docs/js/onephoto.js`): a página gera as outras vistas sem IA generativa, o que mantém tudo leve para qualquer aparelho. Para objeto simétrico (carro, pessoa, cadeira…), a foto espelhada vira a vista do lado oposto. Um molde da categoria, encaixado na silhueta (que também estima ângulo, elevação e perspectiva da foto), limita o que nenhuma vista mostra. O mapa de profundidade (Depth-Anything) cava as reentrâncias do lado fotografado. Para objeto de revolução (garrafa, vaso), o perfil da silhueta é girado. O que nenhuma vista vê recebe a cor típica do objeto. Sem categoria nem simetria, sai um relevo. Embaixo das fotos aparecem 8 vistas do modelo gerado. O lado não fotografado é dedução: fica coerente, mas sem os detalhes reais.

Saída: metros, Y para cima, chão em y=0, frente (1ª foto) em +Z, plano de simetria em x=0; nó `Body` para carros. Limites: cavidades (caixa de roda, interior, vãos) não aparecem só com silhuetas; reflexos das fotos ficam na textura. Teste com fotos sintéticas: servir a raiz do repositório e abrir `docs/?synth=/data/test/<modelo>.glb&desc=carro&n=24&auto=1`.

### Low poly estilizado (gerador local + Blender)
No gerador local, com o motor TRELLIS.2, escolha "Estilo do low poly: Estilizado". O realista sai do TRELLIS.2 e o Blender gera um low poly de ~5 mil triângulos, simétrico, com facetas planas e cores sólidas tiradas da textura: tinta, vidros, frisos, faróis, lanternas e rodas de 5 raios. Não usa textura, e a tinta (`CarPaint`) pode ter a cor trocada no jogo. Precisa do Blender instalado; o caminho pode ser definido em `config.json` (`"blender": "C:/.../blender.exe"`). Uso direto: `blender -b --python scripts/blender-stylize-car.py -- realistic.glb lowpoly.glb --tris 5000 --colors 10`.

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
