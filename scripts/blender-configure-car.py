# Configura um carro GLB (saida deste projeto) para jogo, dentro do Blender (sem janela):
#   blender -b --python scripts/blender-configure-car.py -- entrada.glb saida.glb
# 1) carroceria com cor trocavel (material "CarPaint": baseColorFactor x textura neutra de relevo/sombra)
# 2) vidros em azul claro (malha "Glass", transparente, por cima de um interior escuro)
# 3) farois construidos (aro, refletor cromado, lampada emissiva, lente) + SpotLights (KHR_lights_punctual)
import math
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, DST = argv[0], argv[1]
PAINT_COLOR = None  # None = usa a cor dominante da textura original (ex.: "#FFC400" para forcar)


def srgb2lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
body = bpy.data.objects["Body"]
me = body.data
paint = me.materials[0]
tree = paint.node_tree
nodes, links = tree.nodes, tree.links
bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
base_tex = next(n for n in nodes if n.type == "TEX_IMAGE" and n.image and n.image.name == "Image_0")
src_img = base_tex.image
W, H = src_img.size
px = np.empty(W * H * 4, np.float32)
src_img.pixels.foreach_get(px)
px = px.reshape(H, W, 4)
rgb = px[..., :3]
mx, mn = rgb.max(axis=2), rgb.min(axis=2)
sat = (mx - mn) / np.maximum(mx, 1e-6)
luma = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)

# ------------------------------------------------------------------ 1) cor da carroceria
is_paint = (sat > 0.5) & (luma > 0.15) & (luma < 0.9)
Lp = float(np.median(luma[is_paint]))
Cp = np.median(rgb[is_paint], axis=0)  # cor dominante (sRGB)
if PAINT_COLOR:
    Cp = np.array([int(PAINT_COLOR[i:i + 2], 16) / 255 for i in (1, 3, 5)])
print(f"[cfg] tinta dominante sRGB={np.round(Cp, 3)} luma={Lp:.3f} ({is_paint.mean() * 100:.0f}% dos texels)")

# textura neutra: a cor da tinta vira branco, o resto (sombras, detalhes, vincos) fica como cinza relativo
neutral = np.clip(luma / Lp, 0.0, 1.0)
det = bpy.data.images.new("Paint_Detail", W, H, alpha=False)
det.colorspace_settings.name = "sRGB"
out = np.ones((H, W, 4), np.float32)
out[..., :3] = neutral[..., None]
det.pixels.foreach_set(out.ravel())
det.pack()

# Base Color = textura neutra x cor (nó Mix multiplicar: o exportador grava como baseColorFactor)
for l in list(bsdf.inputs["Base Color"].links):
    links.remove(l)
base_tex.image = det
mix = nodes.new("ShaderNodeMix")
mix.data_type = "RGBA"
mix.blend_type = "MULTIPLY"
mix.inputs["Factor"].default_value = 1.0
lin = srgb2lin(Cp)
mix.inputs["B"].default_value = (float(lin[0]), float(lin[1]), float(lin[2]), 1.0)
links.new(base_tex.outputs["Color"], mix.inputs["A"])
links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
paint.name = "CarPaint"
paint["recolorable"] = True
paint["paint_default_srgb"] = [float(v) for v in Cp]
bsdf.inputs["Coat Weight"].default_value = 0.8
bsdf.inputs["Coat Roughness"].default_value = 0.08

# ------------------------------------------------------------------ 2) vidros
me.calc_loop_triangles()
uv = me.uv_layers.active.data
tris = me.loop_triangles
ntri = len(tris)
loops = np.empty(ntri * 3, np.int32)
tris.foreach_get("loops", loops)
loops = loops.reshape(ntri, 3)
uvs = np.empty(len(uv) * 2, np.float32)
uv.foreach_get("uv", uvs)
uvs = uvs.reshape(-1, 2)
tri_uv = uvs[loops]  # (ntri, 3, 2)
samples = np.concatenate([tri_uv, tri_uv.mean(axis=1, keepdims=True)], axis=1)  # 3 vertices + centroide


def sample(u, v):
    x = np.clip((u * (W - 1)).astype(int), 0, W - 1)
    y = np.clip((v * (H - 1)).astype(int), 0, H - 1)
    return x, y


sx, sy = sample(samples[..., 0], samples[..., 1])
s_sat, s_luma = sat[sy, sx], luma[sy, sx]
grayish = (s_sat < 0.28) & (s_luma > 0.12) & (s_luma < 0.97)

norms = np.empty(ntri * 3, np.float32)
tris.foreach_get("normal", norms)
norms = norms.reshape(ntri, 3)
cent = np.empty(len(me.vertices) * 3, np.float32)
me.vertices.foreach_get("co", cent)
cent = cent.reshape(-1, 3)
vidx = np.empty(ntri * 3, np.int32)
tris.foreach_get("vertices", vidx)
vidx = vidx.reshape(ntri, 3)
c = cent[vidx].mean(axis=1)  # Blender: Z para cima, frente do carro = -Y
hgt = cent[:, 2].max() - cent[:, 2].min()
is_glass_tri = (grayish.sum(axis=1) >= 3) & (c[:, 2] > cent[:, 2].min() + 0.56 * hgt) & (norms[:, 2] < 0.92)
poly_of_tri = np.empty(ntri, np.int32)
tris.foreach_get("polygon_index", poly_of_tri)
glass_polys = np.unique(poly_of_tri[is_glass_tri])
print(f"[cfg] triangulos de vidro: {is_glass_tri.sum()} de {ntri}")

# interior escuro no lugar da textura dos vidros
interior = bpy.data.materials.new("Interior")
interior.use_nodes = True
ib = interior.node_tree.nodes["Principled BSDF"]
ib.inputs["Base Color"].default_value = (0.02, 0.05, 0.11, 1)
ib.inputs["Roughness"].default_value = 0.6
me.materials.append(interior)
for pi in glass_polys:
    me.polygons[int(pi)].material_index = 1

# copia das faces de vidro -> objeto "Glass" (levemente para fora, transparente, azul claro)
bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
gl_faces = [bm.faces[int(i)] for i in glass_polys]
dup = bmesh.ops.duplicate(bm, geom=gl_faces)
new_faces = [g for g in dup["geom"] if isinstance(g, bmesh.types.BMFace)]
new_verts = {v for f in new_faces for v in f.verts}
gm = bpy.data.meshes.new("Glass")
gbm = bmesh.new()
vmap = {}
for v in new_verts:
    vmap[v] = gbm.verts.new(v.co + v.normal * 0.004)
for f in new_faces:
    gbm.faces.new([vmap[v] for v in f.verts])
bmesh.ops.delete(bm, geom=list(new_faces), context="FACES")  # remove a copia de dentro do Body
bm.to_mesh(me)
gbm.normal_update()
gbm.to_mesh(gm)
bm.free()
gbm.free()
glass_obj = bpy.data.objects.new("Glass", gm)
bpy.context.scene.collection.objects.link(glass_obj)
gmat = bpy.data.materials.new("Glass")
gmat.use_nodes = True
gb = gmat.node_tree.nodes["Principled BSDF"]
gb.inputs["Base Color"].default_value = (0.38, 0.68, 1.0, 1.0)
gb.inputs["Alpha"].default_value = 0.55
gb.inputs["Roughness"].default_value = 0.12
gb.inputs["Metallic"].default_value = 0.0
gmat.blend_method = "BLEND" if hasattr(gmat, "blend_method") else None
gm.materials.append(gmat)
for p in gm.polygons:
    p.use_smooth = True

# ------------------------------------------------------------------ 3) farois + spots
def mat_simple(name, color, metallic=0.0, rough=0.3, emit=None, strength=0.0, alpha=1.0, extra=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    b.inputs["Alpha"].default_value = alpha
    if emit is not None:
        b.inputs["Emission Color"].default_value = (*emit, 1.0)
        b.inputs["Emission Strength"].default_value = strength
    return m


M_BEZEL = mat_simple("HeadlightBezel", (0.015, 0.015, 0.018), 0.6, 0.35)
M_REFL = mat_simple("HeadlightReflector", (0.9, 0.9, 0.92), 1.0, 0.12)
M_BULB = mat_simple("HeadlightBulb", (1.0, 0.95, 0.8), 0.0, 0.2, emit=(1.0, 0.93, 0.75), strength=12.0)
M_LENS = mat_simple("HeadlightLens", (0.82, 0.92, 1.0), 0.0, 0.03, alpha=0.28)


def link(obj):
    if obj.name not in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.link(obj)
    return obj


def prim(kind, name, loc, rot, scale, mat, **kw):
    getattr(bpy.ops.mesh, kind)(location=loc, rotation=rot, **kw)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(mat)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


for side, tag in ((1, "L"), (-1, "R")):
    patch = bpy.data.objects[f"Headlight_{tag}"]
    bb = [patch.matrix_world @ Vector(v) for v in patch.bound_box]
    ymin = min(v.y for v in bb)  # frente (mais negativo)
    cx = sum(v.x for v in bb) / 8
    cz = sum(v.z for v in bb) / 8
    rx = (max(v.x for v in bb) - min(v.x for v in bb)) / 2 * 1.02
    rz = (max(v.z for v in bb) - min(v.z for v in bb)) / 2 * 1.02
    # superficie real no centro do farol: raio de frente para tras contra a peca antiga (ela preenche o buraco da carroceria)
    inv = patch.matrix_world.inverted()
    ok, hit, _n, _i = patch.ray_cast(inv @ Vector((cx, ymin - 0.5, cz)), inv.to_3x3() @ Vector((0, 1, 0)))
    if ok:
        ymin = (patch.matrix_world @ hit).y - 0.01  # o aro fica rente a carroceria
    print(f"[cfg] farol {tag}: centro=({cx:.2f}, {cz:.2f}) frente em y={ymin:.3f} raios=({rx:.2f}, {rz:.2f})")
    anchor = bpy.data.objects[f"HeadlightAnchor_{tag}"]
    anchor.location = (cx, ymin + 0.06, cz)
    bpy.data.objects.remove(patch, do_unlink=True)  # a peca antiga (so um recorte texturizado) sai; o conjunto novo a substitui
    qx = math.radians(90)  # eixo Z local -> -Y (para a frente do carro)

    refl = prim("primitive_cone_add", f"Headlight_{tag}_reflector", (cx, ymin + 0.13, cz), (qx, 0, 0), (rx, rz, 1.0), M_REFL,
                vertices=32, radius1=0.42, radius2=1.0, depth=0.16, end_fill_type="NOTHING")
    ring = prim("primitive_torus_add", f"Headlight_{tag}_bezel", (cx, ymin + 0.055, cz), (qx, 0, 0), (rx * 1.02, rz * 1.02, 1.0), M_BEZEL,
                major_radius=1.0, minor_radius=0.075, major_segments=40, minor_segments=10)
    lens = prim("primitive_uv_sphere_add", f"Headlight_{tag}_lens", (cx, ymin + 0.09, cz), (0, 0, 0), (rx * 0.98, 0.05, rz * 0.98), M_LENS,
                segments=36, ring_count=14, radius=1.0)
    bulb = prim("primitive_uv_sphere_add", f"Headlight_{tag}_bulb", (cx, ymin + 0.17, cz), (0, 0, 0), (0.032, 0.032, 0.032), M_BULB,
                segments=16, ring_count=8, radius=1.0)

    ld = bpy.data.lights.new(f"Headlight_{tag}_Spot", "SPOT")
    ld.energy = 2.2  # W do Blender; o exportador converte para candela (2,2 W ~ 120 cd)
    ld.color = (1.0, 0.95, 0.85)
    ld.spot_size = math.radians(55)
    ld.spot_blend = 0.4
    ld.shadow_soft_size = 0.03
    spot = link(bpy.data.objects.new(f"Headlight_{tag}_Spot", ld))
    spot.location = (cx, ymin + 0.17, cz)
    spot.rotation_euler = Vector((0.0, -1.0, -0.12)).to_track_quat("-Z", "Y").to_euler()
    for o in (refl, ring, lens, bulb, spot):
        o.parent = anchor
        o.matrix_parent_inverse = anchor.matrix_world.inverted()

for o in bpy.data.objects:
    if o.type == "MESH":
        o.select_set(False)
bpy.ops.export_scene.gltf(filepath=DST, export_format="GLB", export_lights=True, export_extras=True, export_apply=False,
                          export_image_format="AUTO", export_yup=True)
print("[cfg] exportado:", DST)
