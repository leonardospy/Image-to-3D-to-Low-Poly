# Resumo: onde paramos (2026-10-24)

Objetivo: fotos de um veículo (ângulos, cores e posições variados) → modelo 3D realista + versão low poly, em GLB para Three.js.

## Estado atual
Tudo fica em `D:\Projetos Claude\Gerando 3D` (código, `tools/`, `ai/venv`, `ai/cache`, `data/jobs`). Repositório: https://github.com/leonardospy/Image-to-3D-to-Low-Poly

| Motor | Estado |
|---|---|
| Fotogrametria COLMAP + OpenMVS (sem IA) | Instalada e detectada (`npm run check`). **Nunca rodada com fotos reais.** |
| Modo navegador / GitHub Pages (`docs/`, visual hull de mesa giratória) | Funciona com o exemplo gerado. Falta ativar Pages: Settings → Pages → `main` / `/docs`. |
| IA TripoSR (`ai/run_triposr.py`, integrada ao servidor e à interface) | Roda, mas **qualidade ruim em carros** (volume disforme). Licença MIT. |
| IA Hunyuan3D-2 (`ai/run_hunyuan.py`) | **Melhor resultado**: forma de carro reconhecível a partir de 1 foto (Golf R). Sai **branco, sem cor**. Roda direto pelo script, ainda **não integrado** ao servidor/interface. Licença Tencent **não comercial** (não vale na UE, Reino Unido, Coreia do Sul). |

Teste de referência: `data/jobs/golf_hy/out/{realistic,lowpoly}.glb` (aberto em `http://localhost:3000/?job=golf_hy`, com `npm start`). Dependência fixada: `transformers==4.40.2` (a versão nova quebra o TripoSR).

## Próximos passos
1. Integrar o Hunyuan3D ao servidor (`lib/ai.js`, opção na interface): 1 foto → `Hunyuan3D-2mini`; 2+ fotos (front/left/back) → `Hunyuan3D-2mv`.
2. Projetar a cor das fotos na malha do Hunyuan (reaproveitar `colorize` de `docs/js/hull.js` ou escrever em Python; precisa alinhar a orientação do modelo com as vistas).
3. Gerar o low poly com cor (facetado ou por vértice) a partir dessa malha colorida.
4. Testar a fotogrametria COLMAP/OpenMVS com um conjunto real de fotos (30+ do mesmo veículo).
5. Ativar o GitHub Pages.

## Observações
- Resultados de IA com 1 foto inventam os lados não vistos; várias vistas (modelo `mv`) reduzem isso.
- `C:\fototools` ficou como pasta vazia/quase vazia (a remoção foi bloqueada): pode apagar manualmente.
- Para reinstalar o ambiente de IA: `ai/setup.ps1` (TripoSR); dependências do Hunyuan: `diffusers==0.32.2 opencv-python-headless pymeshlab pygltflib accelerate` no mesmo venv, repositório `ai/Hunyuan3D-2` (git clone da Tencent).
