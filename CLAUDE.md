# Gerando 3D — notas para o agente

Projeto: fotos → modelo 3D realista + low poly (GLB, Three.js), foco em carros para jogos. Estado completo, decisões e armadilhas: leia **RESUMO.md** primeiro.

- Responda em português do Brasil. Tudo (código, modelos, caches, ComfyUI) fica em `D:\Projetos Claude\Gerando 3D`; não instale nada no disco C.
- Rodar: `npm start` → http://localhost:3000 (pasta `public/`). Pages é a pasta `docs/` (outro app, só navegador). Ver um resultado: `http://localhost:3000/?job=<id>`.
- Motor padrão e melhor: TRELLIS.2 via ComfyUI (`lib/ai.js::runTrellisJob`, `lib/comfy.js`, `ai/car_textured.py`, `lib/car.js`). ComfyUI sobe sozinho na porta 8189 a partir de `comfyui/install`.
- Convenção de saída para jogo: metros, Y para cima, frente em +Z, +X = esquerda, chão em y=0; nós `Body`, `Headlight_*`, `Taillight_*`, `Wheel_FL/FR/RL/RR` (girar em X), âncoras `*Anchor_*`.
- Scripts com caminhos Windows: use a ferramenta Write (heredoc do bash come as barras invertidas). Não rode Hunyuan e ComfyUI juntos (12 GB de VRAM).
- Commits: `git -c user.name=leonardospy -c user.email=leonardospy14@gmail.com commit`, mensagem terminando com a linha `Co-Authored-By:` do modelo em uso; `git push` para `origin main`.
- Licenças: Hunyuan3D é não comercial; TripoSR é MIT.
