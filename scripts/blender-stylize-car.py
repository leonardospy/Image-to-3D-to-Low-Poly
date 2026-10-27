# Low poly estilizado de um carro (saida realista deste projeto), no Blender sem janela:
#   blender -b --python scripts/blender-stylize-car.py -- realistic.glb saida.glb [--tris 5000] [--colors 10]
# 1) cor da textura amostrada por vertice; 2) metade do carro reduzida e espelhada (simetria garantida);
# 3) cores agrupadas em poucos tons solidos, um material por tom, sem textura; 4) rodas low poly limpas;
# 5) farois/lanternas simplificados. Nomes, ancoras e convencao (metros, frente +Z no glTF) sao mantidos.
import json
import math
import sys

import bmesh
import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, DST = argv[0], argv[1]
opt = {"--tris": 5000, "--colors": 10}
for i, a in enumerate(argv):
    if a in opt:
        opt[a] = int(argv[i + 1])
TOTAL, NCOL = opt["--tris"], opt["--colors"]
WHEEL_SEG = 14


def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def srgb2lin(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def tris_of(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def solid(name, srgb, rough=0.5, metal=0.0, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    lin = srgb2lin(np.asarray(srgb, np.float64))
    b.inputs["Base Color"].default_value = (*lin, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*lin, 1.0)
        b.inputs["Emission Strength"].default_value = emit
    return m


def image_of(ob):
    for m in ob.data.materials:
        if m and m.node_tree:
            b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if b and b.inputs["Base Color"].links:
                n = b.inputs["Base Color"].links[0].from_node
                while n.type != "TEX_IMAGE" and n.inputs and any(i.links for i in n.inputs):
                    n = next(i.links[0].from_node for i in n.inputs if i.links)
                if n.type == "TEX_IMAGE" and n.image:
                    return n.image
    return None


def vertex_colors_from_texture(ob):
    """cor sRGB (0..1) por vertice, media dos cantos (loops) amostrados na textura base"""
    me = ob.data
    img = image_of(ob)
    nv = len(me.vertices)
    if not img or not me.uv_layers:
        return np.full((nv, 3), 0.5)
    W, H = img.size
    px = np.empty(W * H * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(H, W, 4)[..., :3]  # pixels do Blender ja vem em sRGB para imagens sRGB
    uv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    vi = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", vi)
    x = np.clip((uv[:, 0] % 1.0) * W, 0, W - 1).astype(np.int32)
    y = np.clip((uv[:, 1] % 1.0) * H, 0, H - 1).astype(np.int32)
    c = px[y, x]
    acc = np.zeros((nv, 3))
    cnt = np.zeros(nv)
    np.add.at(acc, vi, c)
    np.add.at(cnt, vi, 1)
    return acc / np.maximum(cnt, 1)[:, None]


def set_color_attr(ob, col):
    me = ob.data
    a = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    rgba = np.ones((len(me.vertices), 4), np.float32)
    rgba[:, :3] = col
    a.data.foreach_set("color", rgba.ravel())
    return a


def get_color_attr(ob):
    me = ob.data
    a = me.color_attributes["Col"]
    rgba = np.empty(len(me.vertices) * 4, np.float32)
    a.data.foreach_get("color", rgba)
    return rgba.reshape(-1, 4)[:, :3]


def decimate(ob, target_tris, symmetry=False):
    t = tris_of(ob)
    if t <= target_tris:
        return
    mod = ob.modifiers.new("dec", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = target_tris / t
    mod.use_collapse_triangulate = True
    if symmetry:
        mod.use_symmetry = True
        mod.symmetry_axis = "X"
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)


def to_lab(srgb):
    """sRGB -> Lab aproximado (para agrupar cores como o olho ve)"""
    l = srgb2lin(srgb)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = l @ M.T / np.array([0.9505, 1.0, 1.089])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], 1)


def kmeans(X, w, k, iters=30, seed=1):
    rng = np.random.default_rng(seed)
    k = min(k, len(X))
    # k-means++ ponderado pela area
    C = [X[rng.choice(len(X), p=w / w.sum())]]
    for _ in range(1, k):
        d = np.min(((X[:, None, :] - np.array(C)[None]) ** 2).sum(-1), 1) * w
        C.append(X[rng.choice(len(X), p=d / d.sum())] if d.sum() > 0 else X[rng.integers(len(X))])
    C = np.array(C)
    for _ in range(iters):
        lab = np.argmin(((X[:, None, :] - C[None]) ** 2).sum(-1), 1)
        for j in range(k):
            m = lab == j
            if m.any():
                C[j] = (X[m] * w[m, None]).sum(0) / w[m].sum()
    return lab, C


# ------------------------------------------------------------------ cena
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
objs = {o.name: o for o in bpy.data.objects}
body = objs.get("Body") or max((o for o in bpy.data.objects if o.type == "MESH"), key=tris_of)
wheels = [o for o in bpy.data.objects if o.type == "EMPTY" and o.name.startswith("Wheel_")]
lamps = [o for o in bpy.data.objects if o.type == "MESH" and o.name.split("_")[0] in ("Headlight", "Taillight", "Glass")]
for o in bpy.data.objects:
    o.select_set(False)

wheel_budget = len(wheels) * (WHEEL_SEG * 8 + 60)
lamp_budget = 40 * len(lamps)
body_budget = max(800, TOTAL - wheel_budget - lamp_budget)
print(f"[estilo] orcamento: carroceria {body_budget}, rodas {wheel_budget}, luzes {lamp_budget}")

# ------------------------------------------------------------------ 1-2) carroceria: cor, metade, reducao, espelho
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
set_color_attr(body, vertex_colors_from_texture(body))

bm = bmesh.new()
bm.from_mesh(body.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5, plane_co=(0, 0, 0), plane_no=(1, 0, 0), clear_inner=True)
bm.to_mesh(body.data)
bm.free()
# malha de trabalho: densa o bastante para as fronteiras de cor ficarem precisas
decimate(body, 40000)

# ------------------------------------------------------------------ 3) cores solidas (na malha densa)
me = body.data
col = get_color_attr(body)
nf = len(me.polygons)
ls = np.empty(nf, np.int32); me.polygons.foreach_get("loop_start", ls)
lt = np.empty(nf, np.int32); me.polygons.foreach_get("loop_total", lt)
lv = np.empty(len(me.loops), np.int32); me.loops.foreach_get("vertex_index", lv)
le = np.empty(len(me.loops), np.int32); me.loops.foreach_get("edge_index", le)
lp = np.repeat(np.arange(nf), lt)                       # face de cada canto
fcol = np.zeros((nf, 3)); np.add.at(fcol, lp, col[lv]); fcol /= lt[:, None]
area = np.empty(nf, np.float32); me.polygons.foreach_get("area", area); area = area.astype(np.float64) + 1e-9
cen = np.empty(nf * 3, np.float32); me.polygons.foreach_get("center", cen); cen = cen.reshape(-1, 3)
nrm = np.empty(nf * 3, np.float32); me.polygons.foreach_get("normal", nrm); nrm = nrm.reshape(-1, 3)
# pares de faces vizinhas (mesma aresta), nos dois sentidos
o = np.argsort(le, kind="stable"); se, sp = le[o], lp[o]
same = se[1:] == se[:-1]
A = np.concatenate([sp[:-1][same], sp[1:][same]]); B = np.concatenate([sp[1:][same], sp[:-1][same]])

lab_feat = to_lab(fcol)
# luz e sombra assadas na textura mudam a claridade, nao o tom: a claridade pesa menos, assim a tinta vira uma cor so
lab_feat[:, 0] *= 0.4
labels, centers = kmeans(lab_feat, area, NCOL)

def majority(labels, k, passes=3):
    """limpeza de salpicos: a face adota a cor dominante dos vizinhos quando nenhum vizinho tem a cor dela"""
    for _ in range(passes):
        cnt = np.zeros((nf, k)); np.add.at(cnt, (A, labels[B]), 1)
        best = cnt.argmax(1)
        own = cnt[np.arange(nf), labels]
        flip = (own == 0) & (cnt[np.arange(nf), best] >= 2)
        labels = np.where(flip, best, labels)
    return labels

labels = majority(labels, len(centers))

# cor de cada grupo: mediana (em sRGB) das faces do grupo
groups = []
for j in range(len(centers)):
    m = labels == j
    if not m.any():
        continue
    c = np.array([np.median(fcol[m][:, k]) for k in range(3)])
    groups.append((j, float(area[m].sum()), c))
groups.sort(key=lambda g: -g[1])

# mesmo matiz com claridade diferente (a tinta no sol e na sombra) vira um grupo so, com a cor do maior
def hue_chroma(c):
    L, a, b = to_lab(np.asarray(c, np.float64)[None])[0]
    return math.degrees(math.atan2(b, a)), math.hypot(a, b)

merged = []
for j, a, c in groups:
    h, ch = hue_chroma(c)
    host = None
    for g in merged:
        h2, ch2 = hue_chroma(g[2])
        if ch > 18 and ch2 > 18 and abs((h - h2 + 180) % 360 - 180) < 14:
            host = g
            break
    if host:
        labels[labels == j] = host[0]
        host[1] += a
    else:
        merged.append([j, a, c])
groups = [tuple(g) for g in merged]
labels = majority(labels, len(centers), 2)
sat = lambda c: (c.max() - c.min()) / max(c.max(), 1e-6)
# tinta = maior grupo saturado e nao muito escuro; se nao houver, o maior grupo
# tinta = cor que mais cobre as laterais (faixa das portas, entre 30% e 62% da altura, normais para os lados)
zc = cen[:, 2]
zlo, zhi = zc.min(), zc.max()
flank = (zc > zlo + 0.3 * (zhi - zlo)) & (zc < zlo + 0.62 * (zhi - zlo)) & (np.abs(nrm[:, 0]) > 0.5)
cover = {g[0]: float(area[flank & (labels == g[0])].sum()) for g in groups}
paint = max(groups, key=lambda g: cover[g[0]])
# tinta sem cor forte (branco, prata, preto): os tons de cinza proximos dela sao a mesma tinta em luz e sombra
pL, _, _ = to_lab(paint[2][None])[0]
if hue_chroma(paint[2])[1] < 10:
    for g in list(groups):
        if g[0] == paint[0]:
            continue
        L, _, _ = to_lab(g[2][None])[0]
        if hue_chroma(g[2])[1] < 10 and pL - 28 < L < pL + 12:
            labels[labels == g[0]] = paint[0]
            groups.remove(g)
    labels = majority(labels, len(centers), 2)

# vidros: faces acima da cintura do carro, sem a cor da tinta e sem cor forte -> um material de vidro unico
zs, nz = cen[:, 2], nrm[:, 2]
z0, z1 = zs.min(), zs.max()
fl = fcol @ np.array([0.2126, 0.7152, 0.0722])
fsat = (fcol.max(1) - fcol.min(1)) / np.maximum(fcol.max(1), 1e-6)
glass = (zs > z0 + 0.6 * (z1 - z0)) & (labels != paint[0]) & (fsat < 0.35) & (fl < 0.93) & (nz > -0.2)
deg = np.maximum(np.bincount(A, minlength=nf), 1)
for _ in range(4):  # fecha buracos e tira faces soltas
    k = np.bincount(A, weights=glass[B].astype(np.float64), minlength=nf) / deg
    glass = (glass | ((k > 0.6) & (zs > z0 + 0.55 * (z1 - z0)))) & ~(k < 0.25)
mats, slot = [], {}
for j, a, c in groups:
    lum = float(c @ np.array([0.2126, 0.7152, 0.0722]))
    if j == paint[0]:
        name, rough, metal = "CarPaint", 0.35, 0.1
    elif lum < 0.12:
        name, rough, metal = f"Escuro_{len(mats)}", 0.45, 0.0
    else:
        name, rough, metal = f"Cor_{len(mats)}", 0.5, 0.0
    m = solid(name, c, rough, metal)
    if j == paint[0]:
        m["recolorable"] = True
        m["paint_default_srgb"] = [float(v) for v in c]
    slot[j] = len(mats)
    mats.append(m)
me.materials.clear()
for m in mats:
    me.materials.append(m)
mi = np.array([slot[int(l)] for l in labels], np.int32)
if glass.any():
    mats.append(solid("Glass", (0.12, 0.16, 0.2), 0.05, 0.0))
    me.materials.append(mats[-1])
    mi[glass] = len(mats) - 1
me.polygons.foreach_set("material_index", mi)
me.color_attributes.remove(me.color_attributes["Col"])
for uvl in list(me.uv_layers):
    me.uv_layers.remove(uvl)

# reducao final respeitando as fronteiras de material: primeiro colapso moderado, depois junta faces quase planas
# (sem cruzar materiais) e triangula; o angulo e ajustado para cair no orcamento
half = body_budget // 2
decimate(body, int(half * 2.2))
base = body.data.copy()
lo, hi = 1.0, 25.0
for _ in range(7):
    ang = (lo + hi) / 2
    body.data = base.copy()
    d = body.modifiers.new("plano", "DECIMATE")
    d.decimate_type = "DISSOLVE"
    d.angle_limit = math.radians(ang)
    d.delimit = {"MATERIAL", "SEAM"}
    t = body.modifiers.new("tri", "TRIANGULATE")
    bpy.ops.object.modifier_apply(modifier=d.name)
    bpy.ops.object.modifier_apply(modifier=t.name)
    if tris_of(body) > half:
        lo = ang
    else:
        hi = ang
body.data = base.copy()
d = body.modifiers.new("plano", "DECIMATE"); d.decimate_type = "DISSOLVE"; d.angle_limit = math.radians(hi); d.delimit = {"MATERIAL", "SEAM"}
t = body.modifiers.new("tri", "TRIANGULATE")
bpy.ops.object.modifier_apply(modifier=d.name)
bpy.ops.object.modifier_apply(modifier=t.name)
decimate(body, half)  # garante o teto do orcamento
me = body.data

mod = body.modifiers.new("espelho", "MIRROR")
mod.use_axis = (True, False, False)
mod.use_clip = True
mod.use_mirror_merge = True
mod.merge_threshold = 1e-4
bpy.context.view_layer.objects.active = body
bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(32))
print(f"[estilo] carroceria: {tris_of(body)} triangulos, {len(mats)} cores: " + ", ".join(f"{m.name}=#{''.join(f'{int(round(v * 255)):02x}' for v in g[2])}" for m, g in zip(mats, groups)))

# ------------------------------------------------------------------ 4) rodas low poly
tire_m = solid("Tire", (0.08, 0.08, 0.085), 0.9)
rim_m = solid("Rim", (0.62, 0.63, 0.66), 0.3, 0.8)
hub_m = solid("Hub", (0.25, 0.25, 0.27), 0.5, 0.6)
for w in wheels:
    for ch in list(w.children):
        bpy.data.objects.remove(ch, do_unlink=True)
    r = float(w.get("radius", 0.32))
    wd = float(w.get("width", 0.22))
    bm = bmesh.new()

    def ring(rad, x0, x1, mat_i, cap=True):
        res = bmesh.ops.create_cone(bm, cap_ends=cap, segments=WHEEL_SEG, radius1=rad, radius2=rad, depth=abs(x1 - x0))
        bmesh.ops.rotate(bm, verts=res["verts"], cent=(0, 0, 0), matrix=__import__("mathutils").Matrix.Rotation(math.pi / 2, 3, "Y"))
        bmesh.ops.translate(bm, verts=res["verts"], vec=((x0 + x1) / 2, 0, 0))
        fs = {f for v in res["verts"] for f in v.link_faces}
        for f in fs:
            f.material_index = mat_i
    ring(r, -wd / 2, wd / 2, 0)                        # pneu
    side = 1 if w.location.x > 0 else -1              # aro para fora do carro
    ring(r * 0.66, side * wd / 2 - side * 0.02, side * wd / 2 + side * 0.006, 2)
    ring(r * 0.2, side * wd / 2, side * wd / 2 + side * 0.014, 2)
    # 5 raios do cubo ate o aro, um pouco para fora do disco
    M = __import__("mathutils")
    for k in range(5):
        res = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, verts=res["verts"], vec=(0.03, r * 0.5, r * 0.11))
        bmesh.ops.translate(bm, verts=res["verts"], vec=(side * (wd / 2 + 0.012), r * 0.38, 0))
        bmesh.ops.rotate(bm, verts=res["verts"], cent=(0, 0, 0), matrix=M.Matrix.Rotation(k * 2 * math.pi / 5, 3, "X"))
        for f in {f for v in res["verts"] for f in v.link_faces}:
            f.material_index = 1
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new(w.name + "_mesh")
    bm.to_mesh(mesh)
    bm.free()
    for m in (tire_m, rim_m, hub_m):
        mesh.materials.append(m)
    ob = bpy.data.objects.new(w.name + "_mesh", mesh)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = w
    ob.matrix_parent_inverse.identity()
    for p in mesh.polygons:
        p.use_smooth = False

# ------------------------------------------------------------------ 5) farois e lanternas
for o in lamps:
    kind = o.name.split("_")[0]
    bpy.context.view_layer.objects.active = o
    decimate(o, 40)
    o.data.materials.clear()
    if kind == "Headlight":
        o.data.materials.append(solid("Headlight", (0.85, 0.88, 0.9), 0.1, 0.0, 0.6))
    elif kind == "Taillight":
        o.data.materials.append(solid("Taillight", (0.75, 0.05, 0.04), 0.2, 0.0, 0.8))
    else:
        o.data.materials.append(solid("Glass", (0.1, 0.13, 0.16), 0.05))
    for uvl in list(o.data.uv_layers):
        o.data.uv_layers.remove(uvl)

# remove materiais/imagens que sobraram (a textura nao vai para o arquivo)
for m in list(bpy.data.materials):
    if m.users == 0:
        bpy.data.materials.remove(m)
for im in list(bpy.data.images):
    bpy.data.images.remove(im)

total = sum(tris_of(o) for o in bpy.data.objects if o.type == "MESH")
bpy.ops.export_scene.gltf(filepath=DST, export_format="GLB", export_extras=True, export_apply=True, export_yup=True)
print("[estilo] " + json.dumps({"triangulos": total, "cores": len(mats), "saida": DST}))
