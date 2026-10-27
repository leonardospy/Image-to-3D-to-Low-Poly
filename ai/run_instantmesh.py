# Executa o InstantMesh (TencentARC, Apache-2.0) clonado em ai/InstantMesh, com tudo no disco D.
# Uso: ai/InstantMesh/venv/Scripts/python.exe ai/run_instantmesh.py <foto ou pasta> --output_path <pasta> [opcoes do run.py]
# Usa a variante "instant-nerf-large", que extrai a malha por marching cubes: assim o nvdiffrast (que precisaria do
# CUDA Toolkit e do compilador da Microsoft, instalados no disco C) nao e necessario. Sem --export_texmap a malha sai
# com cor por vertice; o nvdiffrast so seria usado para textura em mapa UV.
import os
import runpy
import sys
import types

here = os.path.dirname(os.path.abspath(__file__))
repo = os.path.join(here, 'InstantMesh')
cache = os.path.join(here, 'cache')
os.environ.setdefault('HF_HOME', os.path.join(cache, 'hf'))
os.environ.setdefault('U2NET_HOME', os.path.join(cache, 'u2net'))
os.environ.setdefault('TORCH_HOME', os.path.join(cache, 'torch'))

# substituto vazio do nvdiffrast (so seria chamado com --export_texmap)
nv = types.ModuleType('nvdiffrast')
nv.torch = types.ModuleType('nvdiffrast.torch')
sys.modules['nvdiffrast'] = nv
sys.modules['nvdiffrast.torch'] = nv.torch

args = [os.path.abspath(a) if i == 0 else a for i, a in enumerate(sys.argv[1:])]
for i, a in enumerate(args):
    if i > 0 and args[i - 1] == '--output_path':
        args[i] = os.path.abspath(a)
os.chdir(repo)  # o pipeline "zero123plus" e carregado da pasta local do repositorio
sys.path.insert(0, repo)
sys.argv = ['run.py', 'configs/instant-nerf-large.yaml', *args]
runpy.run_path('run.py', run_name='__main__')
