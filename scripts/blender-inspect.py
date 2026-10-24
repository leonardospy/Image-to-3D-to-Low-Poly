# Teste/uso: blender -b --python scripts/blender-inspect.py -- entrada.glb [saida.glb]
# Importa um GLB, lista objetos/materiais e (opcional) reexporta.
import sys
import bpy

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
src = args[0]
dst = args[1] if len(args) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

print("== Blender", bpy.app.version_string)
for o in bpy.data.objects:
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons) if o.type == "MESH" else 0
    print(f"{o.type:6} {o.name:28} pai={o.parent.name if o.parent else '-':16} tris={tris:7} pos={tuple(round(v, 2) for v in o.location)}")
print("materiais:", [m.name for m in bpy.data.materials])

if dst:
    bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB")
    print("exportado:", dst)
