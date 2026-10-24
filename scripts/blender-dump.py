# blender -b --python scripts/blender-dump.py -- modelo.glb
# Lista objetos (bounding box no mundo, coordenadas do Blender: Z para cima, frente do glTF = -Y), materiais e texturas.
import sys
import bpy
from mathutils import Vector

src = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

print("=== OBJETOS")
for o in bpy.data.objects:
    line = f"{o.type:6} {o.name:26} pai={o.parent.name if o.parent else '-':14}"
    if o.type == "MESH":
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
        mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
        line += f" tris={sum(len(p.vertices) - 2 for p in o.data.polygons):6} min={tuple(round(v, 2) for v in mn)} max={tuple(round(v, 2) for v in mx)} mats={[m.name if m else None for m in o.data.materials]}"
    else:
        line += f" pos={tuple(round(v, 2) for v in o.matrix_world.translation)}"
    print(line)
print("=== MATERIAIS")
for m in bpy.data.materials:
    nodes = {n.type + ":" + n.name for n in m.node_tree.nodes} if m.use_nodes else set()
    print(m.name, "| blend:", m.blend_method, "|", sorted(nodes))
print("=== IMAGENS")
for i in bpy.data.images:
    print(i.name, i.size[:], i.colorspace_settings.name)
