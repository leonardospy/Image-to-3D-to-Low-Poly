"""Imagem(ns) -> forma 3D com Hunyuan3D-2 (IA). So a geometria; a cor e projetada depois a partir das fotos.
Uso: python run_hunyuan.py saida.glb front=foto1.jpg [left=foto2.jpg back=foto3.jpg] [--steps N] [--res N]
 - 1 imagem  -> Hunyuan3D-2mini (turbo)
 - 2+ imagens -> Hunyuan3D-2mv (turbo), vistas: front, left, back, right
Licenca do modelo: Tencent Hunyuan NAO COMERCIAL (nao vale na UE, Reino Unido e Coreia do Sul)."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
HY = os.environ.get("HUNYUAN_DIR") or os.path.join(HERE, "Hunyuan3D-2")
if not os.path.isdir(HY):
    HY = "D:/Projetos Claude/Gerando 3D/ai/Hunyuan3D-2"
sys.path.insert(0, HY)
sys.path.insert(0, HERE)

import torch
from PIL import Image


def opt(name, default):
    return int(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


def main():
    out_path = sys.argv[1]
    views = {}
    for a in sys.argv[2:]:
        if "=" in a and not a.startswith("--"):
            k, v = a.split("=", 1)
            views[k] = v
    if not views:
        sys.exit("informe ao menos front=<imagem>")
    steps, res = opt("--steps", 5), opt("--res", 380)
    use_rembg = "--no-rembg" not in sys.argv

    from hy3dgen.rembg import BackgroundRemover
    from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline
    from hy3dgen.shapegen.pipelines import export_to_trimesh

    print("[ia] removendo fundo...", flush=True)
    rm = BackgroundRemover()
    imgs = {}
    for k, p in views.items():
        im = Image.open(p)
        imgs[k] = rm(im.convert("RGB")) if use_rembg else im.convert("RGBA")
        imgs[k].save(os.path.splitext(out_path)[0] + f"_{k}_rgba.png")

    multi = len(imgs) > 1
    repo, sub = ("tencent/Hunyuan3D-2mv", "hunyuan3d-dit-v2-mv-turbo") if multi else ("tencent/Hunyuan3D-2mini", "hunyuan3d-dit-v2-mini-turbo")
    print(f"[ia] carregando {repo} (primeira vez baixa os pesos)...", flush=True)
    pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(repo, subfolder=sub, use_safetensors=True, device="cuda")
    pipe.enable_flashvdm(mc_algo="mc")

    print("[ia] gerando forma 3D...", flush=True)
    gen = torch.Generator().manual_seed(1234)
    out = pipe(image=imgs if multi else imgs["front"], num_inference_steps=steps, guidance_scale=5.0,
               generator=gen, octree_resolution=res, num_chunks=20000, output_type="mesh")
    mesh = export_to_trimesh(out)[0]
    # cor: projeta as fotos na malha (sem IA)
    import numpy as np, trimesh
    from project_colors import project_colors
    sys.path.insert(0, HERE)
    cols = project_colors(mesh, [np.array(im.convert("RGBA")) for im in imgs.values()], log=lambda s: print(s, flush=True))
    mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh, vertex_colors=cols)
    mesh.export(out_path)
    print(f"[ia] pronto: {len(mesh.faces)} triangulos", flush=True)


if __name__ == "__main__":
    main()
