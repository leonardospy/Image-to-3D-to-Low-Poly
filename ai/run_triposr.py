"""Imagem -> 3D com TripoSR (IA). Uso: python run_triposr.py <imagem> <saida.glb> [resolucao] [--no-rembg]
Saida: GLB com cores por vertice. O pos-processamento (realista/low poly) e feito pelo Node."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TRIPOSR = os.environ.get("TRIPOSR_DIR") or os.path.join(HERE, "TripoSR")
if not os.path.isdir(TRIPOSR):
    TRIPOSR = "D:/Projetos Claude/Gerando 3D/ai/TripoSR"
sys.path.insert(0, TRIPOSR)

import numpy as np
import torch
import trimesh
from PIL import Image

from tsr.system import TSR
from tsr.utils import remove_background, resize_foreground


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    use_rembg = "--no-rembg" not in sys.argv
    image_path, out_path = args[0], args[1]
    resolution = int(args[2]) if len(args) > 2 else 320

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[ia] dispositivo: {device}", flush=True)

    print("[ia] carregando modelo (primeira vez baixa ~1.7 GB)...", flush=True)
    model = TSR.from_pretrained("stabilityai/TripoSR", config_name="config.yaml", weight_name="model.ckpt")
    model.renderer.set_chunk_size(8192)
    model.to(device)

    print("[ia] preparando imagem...", flush=True)
    img = Image.open(image_path)
    if use_rembg:
        import rembg
        img = remove_background(img, rembg.new_session())
        img = resize_foreground(img, 0.85)
        arr = np.array(img).astype(np.float32) / 255.0
        arr = arr[:, :, :3] * arr[:, :, 3:4] + (1 - arr[:, :, 3:4]) * 0.5
        img = Image.fromarray((arr * 255.0).astype(np.uint8))
    else:
        img = img.convert("RGB")

    print("[ia] gerando modelo 3D...", flush=True)
    with torch.no_grad():
        codes = model([img], device=device)
    print(f"[ia] extraindo malha (resolucao {resolution})...", flush=True)
    mesh = model.extract_mesh(codes, True, resolution=resolution)[0]
    trimesh.repair.fix_normals(mesh)
    mesh.export(out_path)
    print(f"[ia] pronto: {len(mesh.faces)} triangulos", flush=True)


if __name__ == "__main__":
    main()
