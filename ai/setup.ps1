# Instala o motor de IA (TripoSR) dentro da pasta do projeto (nada fora dela).
# Requer: uv, git, GPU NVIDIA (12 GB recomendado).
$ErrorActionPreference = 'Stop'
$ai = $PSScriptRoot
$proj = Split-Path $ai -Parent
$env:UV_CACHE_DIR = Join-Path $proj 'cache\uv'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $proj 'cache\python'
Set-Location $ai
if (-not (Test-Path TripoSR)) { git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR.git }
uv venv venv --python 3.11
$py = Join-Path $ai 'venv\Scripts\python.exe'
uv pip install --python $py torch torchvision --index-url https://download.pytorch.org/whl/cu124
uv pip install --python $py "numpy<2" omegaconf==2.3.0 einops transformers trimesh rembg onnxruntime huggingface-hub scikit-image Pillow imageio
# TripoSR usa torchmcubes (exige compilador no Windows): copia versao com fallback para scikit-image
Copy-Item (Join-Path $ai 'isosurface_patch.py') (Join-Path $ai 'TripoSR\tsr\models\isosurface.py') -Force
Write-Host 'Pronto. Os pesos do modelo (~1.7 GB) sao baixados em ai\cache na primeira execucao.'
