# Resumo: onde paramos (2026-10-24)

Objetivo: fotos de um veículo (ângulos, cores e posições variados) → modelo 3D realista + versão low poly, em GLB para Three.js.

## Estado atual
Tudo fica em `D:\Projetos Claude\Gerando 3D` (código, `tools/`, `ai/venv`, `ai/cache`, `data/jobs`). Repositório: https://github.com/leonardospy/Image-to-3D-to-Low-Poly

| Motor | Estado |
|---|---|
| Fotogrametria COLMAP + OpenMVS (sem IA) | Instalada e detectada (`npm run check`). **Nunca rodada com fotos reais.** |
| Modo navegador / GitHub Pages (`docs/`, visual hull de mesa giratória) | Funciona com o exemplo gerado. Falta ativar Pages: Settings → Pages → `main` / `/docs`. |
| IA TripoSR (`ai/run_triposr.py`, integrada ao servidor e à interface) | Roda, mas **qualidade ruim em carros** (volume disforme). Licença MIT. |
| IA Hunyuan3D-2 (`ai/run_hunyuan.py`, motor padrão da interface) | **Funciona de ponta a ponta**: 1 a 4 fotos (frente/esquerda/trás/direita) → forma de carro + cor projetada das fotos (`ai/project_colors.py`) → GLB realista e low poly. Licença Tencent **não comercial** (não vale na UE, Reino Unido, Coreia do Sul). |

Teste de referência: `data/jobs/golf_hy/out/{realistic,lowpoly}.glb` (aberto em `http://localhost:3000/?job=golf_hy`, com `npm start`). Dependência fixada: `transformers==4.40.2` (a versão nova quebra o TripoSR).

## Próximos passos
1. Melhorar a cor: com 1 foto 3/4 os lados saem aproximados; testar com várias vistas retas (modelo mv) e com fotos limpas.
2. Low poly com cor mais nítida (facetado por face, como no modo navegador).
3. Testar a fotogrametria COLMAP/OpenMVS com um conjunto real de fotos (30+ do mesmo veículo).
4. Ativar o GitHub Pages.

## Observações
- Resultados de IA com 1 foto inventam os lados não vistos; várias vistas (modelo `mv`) reduzem isso.
- `C:\fototools` ficou como pasta vazia/quase vazia (a remoção foi bloqueada): pode apagar manualmente.
- Para reinstalar o ambiente de IA: `ai/setup.ps1` (TripoSR); dependências do Hunyuan: `diffusers==0.32.2 opencv-python-headless pymeshlab pygltflib accelerate` no mesmo venv, repositório `ai/Hunyuan3D-2` (git clone da Tencent).

## Modo carro (2026-10-24)
Motor Hunyuan3D gera a forma; `ai/car_tools.py` trata o carro (sem IA) e `lib/car.js` faz o acabamento PBR:
- Escala para as medidas reais (comprimento/largura/altura em metros), chão em y=0, frente em +Z, +X = esquerda.
- Rodas detectadas e **substituídas por rodas procedurais giráveis** (`Wheel_FL/FR/RL/RR`, origem no eixo, girar em X; partes tire/rim/disc).
- Faróis e lanternas separados (`Headlight_L/R`, `Taillight_L/R`) com material emissivo e âncoras de luz vazias (`HeadlightAnchor_*`, `TaillightAnchor_*`); vidros em `Glass` (transparente).
- Realista: ~150k triângulos, cor por vértice (espelhada para o lado não fotografado, reflexos atenuados). Low poly: carroceria decimada + textura 2048 assada das fotos, rodas 16 segmentos.
- Limites: a detecção de rodas/faróis é heurística (proporções + geometria); portas não têm recorte próprio (só aparecem na textura se a foto mostrar); com 1 foto 3/4 a cor dos lados é aproximada.
