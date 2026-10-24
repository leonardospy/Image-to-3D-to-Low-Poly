# Resumo do projeto "Gerando 3D" (passagem de bastão)

Atualizado em 2026-10-24. Leia este arquivo e o `CLAUDE.md` e já dá para continuar sem reler a conversa.

## Objetivo
Receber fotos de um objeto (principalmente **carros**) e gerar um modelo 3D **realista** e outro **low poly**, em **GLB** para Three.js. Para jogos: rodas separadas que giram, faróis separados para receber luz, portas/detalhes visíveis, medidas reais. Tudo deve ficar no **disco D** (`D:\Projetos Claude\Gerando 3D`). Idioma com o usuário: português do Brasil. O usuário liberou o uso de IA (antes pedia "sem IA").

Repositório: https://github.com/leonardospy/Image-to-3D-to-Low-Poly (branch `main`, GitHub Pages serve a pasta `/docs`: https://leonardospy.github.io/Image-to-3D-to-Low-Poly/).

## Dois aplicativos no mesmo repositório (não são a mesma versão, de propósito)
| | Localhost (`npm start` → http://localhost:3000, pasta `public/`) | GitHub Pages (pasta `docs/`) |
|---|---|---|
| Roda onde | Node + Python + ComfyUI no PC | só no navegador (arquivos estáticos) |
| Motores | TRELLIS.2 via ComfyUI (padrão, melhor), Hunyuan3D-2, TripoSR, fotogrametria COLMAP/OpenMVS | "Fotos em volta" (padrão: várias fotos → 3D completo texturizado), "Qualquer foto" (IA no navegador, relevo 2.5D), "Meu PC" (ponte para o localhost), "Mesa giratória" (visual hull) |
Pages não consegue rodar TRELLIS/Hunyuan (precisam de GPU e GBs de modelos); por isso o modo "Meu PC" chama `http://localhost:3000` por CORS (liberado só para `leonardospy.github.io` e localhost, em `server.js`).

## Estado dos motores
- **TRELLIS.2 via ComfyUI (melhor)**: 1 foto → forma fiel + texturas PBR (cor, normal, metal/rugosidade, AO). Roda duas vezes: realista (~300k faces, textura 4096) e low poly (~6k faces com mapas assados do detalhado, mantém portas/faróis/logo). Testado de ponta a ponta com o Golf. Tempo: ~9 min na 1ª execução (carrega modelos), bem menos depois.
- **Low poly estilizado** (opção "Estilo do low poly" = estilizado, campo `lowStyle`): o TRELLIS.2 roda só o realista e o Blender (`scripts/blender-stylize-car.py`, Blender achado em `C:/Program Files/Blender Foundation` ou `config.json` "blender") gera `lowpoly.glb`. Etapas: cor da textura por vértice → metade do carro (corte em x=0) → redução a 40 mil → k-means de cores (Lab com claridade pesando 0,4) + junção por matiz (tinta no sol e na sombra = uma cor) + limpeza de salpicos → vidro único acima da cintura → colapso moderado + dissolução planar limitada por material (facetas limpas) → espelho → rodas low poly de 14 lados com 5 raios → faróis/lanternas reduzidos. ~5 mil triângulos, 5–8 cores sólidas, sem textura, material `CarPaint` marcado `recolorable`. Referência de estilo (CC-BY, SheldonJ99) em `data/test/stylize/`; comparar com `data/test/stylize/view.html?f=...` (servidor `pages`).
- **Hunyuan3D-2** (`ai/run_hunyuan.py`): 1 foto (mini) ou 2–4 vistas front/left/back/right (mv). Forma boa, **sem cor própria**: a cor é projetada das fotos (`ai/project_colors.py`, câmeras ortográficas alinhadas aos eixos). Licença **Tencent não comercial** (não vale em UE/UK/Coreia do Sul).
- **TripoSR**: roda, qualidade ruim em carros. Licença MIT. (Patch `ai/isosurface_patch.py` troca `torchmcubes` por scikit-image.)
- **Fotogrametria COLMAP 4.2.1 + OpenMVS 2.4** (`lib/pipeline.js`, binários em `tools/`): instalada e detectada (`npm run check`), **nunca rodada com fotos reais**.
- **Pages "Fotos em volta"** (padrão do Pages, 100% navegador): `docs/js/mvmode.js` (interface), `docs/js/multiview.js` (recorte → poses por silhueta → escultura → chão → simetria → malha → textura por foto), `docs/js/scene-text.js` (lê a descrição da cena), `docs/js/ai.js` (RMBG compartilhado, WebGPU com volta para CPU). Testado só com fotos sintéticas (`docs/js/synth.js`, `?synth=/data/test/trellis_golf.glb&desc=carro&n=24&auto=1`, servidor `pages` em `.claude/launch.json`, porta 8090): erro médio de ângulo ~2,5°, proporções a ~5% da verdade, ~12 s após o recorte (24 fotos). Lições: otimizar o azimute só por silhueta piora (carro); por isso há penalidade por se afastar do espaçamento uniforme e os ângulos ficam na ordem. A escala inicial é comum a todas as fotos.
- **Pages "Fotos em volta" com 1 foto** (`docs/js/onephoto.js`): vistas geradas por simetria (foto espelhada) ou revolução, molde por categoria (carro procedural; caixa arredondada para as outras; medidas típicas em `DIMS`) encaixado na silhueta, profundidade do Depth-Anything para cavar o lado visto, cor típica onde nada é visto, maior peça da malha. Testado com 1 foto do RX-7 (3/4 frente): vista estimada 56° (real ~45°), medidas 1,8 × 1,35 × 4,28 m, forma reconhecível, superfície um pouco irregular. Sem descrição, o objeto é reconhecido por uma IA leve (`Xenova/resnet-18` q8, ~12 MB, classes do ImageNet → categoria em `scene-text.js::categoryFromLabels`); com uma foto real de RX-7 (`data/test/rx7_real.webp`) deu "carro 99%". O volume de 1 foto recebe um borrão 3D leve (`smoothField`), que tira as abas do teto. Teste local: `scripts/dev-static.py` (sem cache; o `http.server` comum deixava o navegador usar módulos antigos). Gerador por IA (Zero123++) descartado: não roda em celular e o usuário exige qualquer aparelho.
- **Pages "Qualquer foto"**: transformers.js 3.5.1 (CDN) com RMBG-1.4 (remove fundo) + Depth-Anything-V2-small (profundidade) → `docs/js/relief.js` monta relevo fechado (frente boa, lados/trás aproximados). Testado só com o Golf.

## Pipeline de carro (o que torna o GLB "pronto para jogo")
Convenção de saída: **metros, Y para cima, frente em +Z, +X = lado esquerdo, chão em y=0**. Nós: `Body`, `Glass` (só Hunyuan), `Headlight_L/R`, `Taillight_L/R`, `Wheel_FL/FR/RL/RR` (origem no eixo, girar em X; filhos `_tire/_rim/_disc` ou `_mesh`), âncoras vazias `HeadlightAnchor_*`/`TaillightAnchor_*` para prender luzes.
- Caminho TRELLIS: `lib/ai.js::runTrellisJob` → `lib/comfy.js` (executa workflow) → `ai/car_textured.py` (orienta, escala para as medidas, acha rodas, separa farois; realista: roda original da melhor roda copiada nos 4 cantos; low poly: rodas procedurais de 16 segmentos de `ai/car_wheels.py`) → `lib/car.js::finalizeCar` (materiais PBR, clearcoat só no realista, JPEG, âncoras).
- Caminho Hunyuan: `runHunyuanJob` → `ai/run_hunyuan.py` → `ai/car_tools.py::build_car` (decimação, cor por vértice espelhada, classificação por região, textura assada no low poly) → `finalizeCar`.
- Entradas da interface: motor, medidas reais (comprimento/largura/altura), "a foto mostra frente/traseira", triângulos do low poly.
- Heurísticas (testadas só no Golf!): raio das rodas ≈ 7,6% do comprimento, eixos a ~20% das pontas; farol = região frontal y 42–64% da altura; lanterna traseira idem atrás (no TRELLIS não acha faces: usa âncoras estimadas).

## ComfyUI (somente disco D)
`comfyui/install` (programa + Python 3.13, fora do git), `comfyui/models` (33,4 GB: TRELLIS.2, Pixal3D, VAEs, DINOv3, BiRefNet, MoGe, z_image, qwen), `comfyui/extra_model_paths.yaml`, `comfyui/shared`, `comfyui/cache`, backup da config antiga em `comfyui/backup_config/`. O Comfy Desktop foi reapontado para essas pastas e os originais em `C:\Users\Spy\AppData\Local\Comfy-Desktop` foram apagados (por pedido do usuário). O servidor sobe o ComfyUI sozinho (`ensureComfy`, porta **8189**, log em `data/comfy/comfy.log`). Workflow versionado: `ai/workflows/trellis2_image_to_model.json` (template oficial). `lib/comfy.js::toApi` converte o workflow do editor para a API: resolve `ComfySwitchNode`, trata combos dinâmicos (`COMFY_DYNAMICCOMBO_V3` → entradas `nome.sub`). IDs de nós usados nos overrides: 122 LoadImage, 316 boolean (true = TRELLIS.2), 186 DecimateMesh (`target_face_count`), 288 resolução da textura, 322 Save3DAdvanced (saída `output/3d/<prefixo>_00001.glb`).

## Ambiente
- Máquina: Windows 10, RTX 4070 12 GB, Node 24, `uv`. Python do projeto: `ai/venv` (3.11, torch 2.6+cu124, **`transformers==4.40.2` fixado**, rembg, trimesh, scipy, fast-simplification, xatlas, pymeshlab, diffusers 0.32.2). Caches de IA em `ai/cache` (HF_HOME, U2NET_HOME, TORCH_HOME); `config.json` (fora do git) aponta ferramentas e pastas absolutas.
- Repos clonados (fora do git): `ai/TripoSR`, `ai/Hunyuan3D-2`.
- Dados de teste: `data/test/golf.jpg` (Wikimedia Commons), jobs em `data/jobs/<id>/out/{realistic,lowpoly}.glb`; ver no viewer local com `http://localhost:3000/?job=<id>`.
- Testes: `node scripts/test-hull.js`, `node scripts/test-relief.js`, `node scripts/comfy-trellis.mjs <foto> <prefixo> [faces] [texRes]`, `npm run postprocess -- modelo.glb saida 5000`.

## Armadilhas já encontradas
- Executáveis do OpenMVS falham em caminhos longos (por isso o projeto fica em caminho curto no D).
- No bash, heredocs comem barras invertidas: para scripts com caminhos Windows use a ferramenta Write.
- `gltf-transform prune` remove nós vazios (âncoras): usar `keepLeaves: true`; também remove texturas "sólidas" (`pruneSolidTextures:false`). `sharp` ≥ 0.35 (a 0.33 quebra com Node 24). `normals()` do gltf-transform desfaz o weld (usamos normais próprias).
- Rodar Hunyuan e ComfyUI ao mesmo tempo estoura a VRAM de 12 GB.
- `C:\fototools` sobrou vazio/quase vazio (remoção bloqueada): apagar manualmente.
- Commits: `git -c user.name=leonardospy -c user.email=leonardospy14@gmail.com commit ...` e terminar a mensagem com `Co-Authored-By: Claude ... <noreply@anthropic.com>`.

## O que ainda não foi testado / limitações
1. Fotogrametria COLMAP/OpenMVS com fotos reais (30+ do mesmo carro).
2. Detecção de rodas/faróis em outros carros (picape, esportivo baixo); só o Golf foi validado. Lanternas traseiras só têm âncora estimada; portas não têm recorte próprio (visíveis pela textura/normal).
3. Pages: o modo "Meu PC" foi só testado até a detecção do servidor (uma geração completa por ele e o seletor TRELLIS/Hunyuan não foram exercitados); layout mobile não foi testado.
4. TRELLIS aceita 1 foto; sem fusão de várias fotos.
5. O modo "Qualquer foto" do Pages é 2.5D (não substitui o 3D completo).
6. "Fotos em volta": com 8 capturas de tela de um RX-7 (`data/test/rx7/`, fora do git; vista marcada por foto, alturas/zoom/perspectiva diferentes) a forma sai com proporções certas só quando as medidas vêm na descrição, e a textura fica em retalhos (poses imprecisas): silhuetas de poucas fotos tão variadas não fixam a pose. Testes descartados: busca grossa de elevação/escala por foto (piora), fator de esticamento horizontal por foto (não ajuda). Com fotos em sequência (sintéticas) funciona bem; depende da ordem das fotos (seguem a volta) e de a 1ª mostrar a frente (ou dizer na descrição). Cavidades não aparecem (só silhuetas). O RMBG-1.4 tem licença não comercial da BRIA.

## Próximos passos sugeridos
- "Fotos em volta": testar com fotos reais de celular; recuperar cavidades (caixas de roda, janelas) com profundidade (Depth-Anything) ou consistência de cor; mesclar 2 fotos nas emendas da textura; separar rodas/faróis como no pipeline de carro.
- Rodar o TRELLIS com outros carros e ajustar as heurísticas (raio de roda, regiões de faróis); separar lanternas traseiras de forma confiável.
- Testar o modo "Meu PC" a partir da página publicada (Chrome/Edge/Firefox; Safari bloqueia https→localhost).
- Opcional: unificar a interface de `public/` e `docs/`; perfil de foto lateral no TRELLIS; exportar sem o tratamento de carro para outros objetos (modo "objeto genérico").

## Estado dos processos ao encerrar esta sessão
Servidor `node server.js` na porta 3000 e ComfyUI na 8189 estavam ligados; podem ser parados sem perda (o servidor religa o ComfyUI quando precisa). Tudo está commitado e enviado (último commit `0223c54`), exceto este resumo e o `CLAUDE.md` enquanto não forem commitados.
