"""Pos-processamento especifico para carros (sem IA): orienta e escala, acha as rodas e as troca por rodas
procedurais giraveis, separa farois/lanternas/vidros, limpa a malha, gera versao realista (cor por vertice)
e low poly (malha decimada + textura assada das fotos).

Convencao de saida (glTF): metros, Y para cima, frente do carro em +Z, +X = lado esquerdo, chao em y=0.
Nos: Body, Glass, Headlight_L/R, Taillight_L/R, Wheel_FL/FR/RL/RR (origem no eixo, girar em X).

Uso: python car_tools.py <malha.glb> <saida_dir> nome=rgba.png [nome=rgba.png ...] [--length 4.3] [--tris 6000] [--hi 150000]
"""
import json
import os
import sys

import cv2
import fast_simplification
import numpy as np
import trimesh
import xatlas
from PIL import Image
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from car_wheels import wheel_parts  # noqa: E402
from project_colors import ColorProjector, smooth_vertex_colors  # noqa: E402

LUMA = np.array([0.299, 0.587, 0.114])


def _rot_y(t):
    return trimesh.transformations.rotation_matrix(t, [0, 1, 0])


def _tr(v):
    return trimesh.transformations.translation_matrix(v)


def _sc(s):
    return np.diag([s, s, s, 1.0])


# ---------------------------------------------------------------- orientacao
def prepare(mesh, length_m, front_dir, log=print, width_m=0.0, height_m=0.0):
    m = mesh.copy()
    parts = m.split(only_watertight=False)
    if len(parts) > 1:
        big = max(len(p.faces) for p in parts)
        keep = [p for p in parts if len(p.faces) >= 0.02 * big]
        log(f"[carro] {len(parts) - len(keep)} fragmentos soltos removidos")
        m = trimesh.util.concatenate(keep)
    T = np.eye(4)
    ext = m.extents
    theta = 0.0
    if ext[0] > ext[2]:  # eixo longo em X
        theta = np.pi / 2 if front_dir == "-x" else -np.pi / 2
    elif front_dir == "-z":
        theta = np.pi
    M = _rot_y(theta)
    m.apply_transform(M)
    T = M @ T
    sz = length_m / m.extents[2]
    M = np.diag([(width_m / m.extents[0]) if width_m else sz, (height_m / m.extents[1]) if height_m else sz, sz, 1.0])
    m.apply_transform(M)
    T = M @ T
    b = m.bounds
    M = _tr([-(b[0][0] + b[1][0]) / 2, -b[0][1], -(b[0][2] + b[1][2]) / 2])
    m.apply_transform(M)
    T = M @ T
    return m, T


# ---------------------------------------------------------------- rodas
def detect_wheels(m, log=print):
    V = m.vertices
    L, W = m.extents[2], m.extents[0]
    zmin, zmax = m.bounds[0][2], m.bounds[1][2]
    R0 = 0.076 * L
    band = V[(np.abs(V[:, 0]) > 0.35 * W / 2) & (V[:, 1] < 2.9 * R0)]
    axles = []
    for z0 in (zmax - 0.20 * L, zmin + 0.20 * L):
        pts = band[np.abs(band[:, 2] - z0) < 0.10 * L + 2.2 * R0]
        best = (-1, R0, z0)
        for R in R0 * np.linspace(0.85, 1.12, 20):
            for zc in z0 + np.linspace(-0.07 * L, 0.07 * L, 29):
                d = np.hypot(pts[:, 1] - R, pts[:, 2] - zc)
                sc = np.count_nonzero(np.abs(d - R) < 0.05 * R)
                if sc > best[0]:
                    best = (sc, R, zc)
        axles.append(best)
    R = float(np.mean([a[1] for a in axles]))
    tw = float(np.clip(0.13 * W, 0.16, 0.30))
    wheels = []
    for (front, (_, _, zc)) in zip((True, False), axles):
        for side, sname in ((1, "L"), (-1, "R")):
            d = np.hypot(band[:, 1] - R, band[:, 2] - zc)
            ring = band[(np.abs(d - R) < 0.07 * R) & (side * band[:, 0] > 0.2 * W / 2)]
            x_out = float(np.percentile(side * ring[:, 0], 97)) if len(ring) > 30 else 0.47 * W
            x_out = float(np.clip(x_out, 0.35 * W, 0.52 * W))
            wheels.append(dict(name=f"Wheel_{'F' if front else 'R'}{sname}", side=side, front=front, R=R, w=tw,
                               x_out=x_out, center=[side * (x_out - tw / 2), R, float(zc)]))
    log(f"[carro] rodas: raio {R:.2f} m, largura {tw:.2f} m, eixos z={[round(a[2], 2) for a in axles]}")
    return wheels


def remove_wheel_faces(m, wheels):
    c = m.triangles_center
    drop = np.zeros(len(m.faces), bool)
    for wh in wheels:
        xin = wh["side"] * c[:, 0]
        drop |= (xin > wh["x_out"] - 1.25 * wh["w"]) & (xin < wh["x_out"] + 0.10) & \
                (np.hypot(c[:, 1] - wh["R"], c[:, 2] - wh["center"][2]) <= 1.04 * wh["R"])
    b = m.copy()
    b.update_faces(~drop)
    b.remove_unreferenced_vertices()
    return b


# ---------------------------------------------------------------- malha
def decimate(V, F, target):
    if len(F) <= target:
        return V, F
    v, f = fast_simplification.simplify(V.astype(np.float32), F.astype(np.int32), target_reduction=1 - target / len(F))
    return np.asarray(v, float), np.asarray(f)


def clean_body(body, hi_tris, log=print):
    V, F = decimate(body.vertices, body.faces, hi_tris)
    m = trimesh.Trimesh(V, F, process=True)
    m.remove_unreferenced_vertices()
    try:
        trimesh.smoothing.filter_taubin(m, lamb=0.5, nu=-0.53, iterations=12)
    except Exception as e:  # pragma: no cover
        log(f"[carro] suavizacao ignorada: {e}")
    log(f"[carro] corpo limpo: {len(m.faces)} triangulos")
    return m


# ---------------------------------------------------------------- classificacao
def classify(body, fcol, seen_f, paint):
    H, W, L = body.extents[1], body.extents[0], body.extents[2]
    c = body.triangles_center
    luma, pl = fcol @ LUMA, paint @ LUMA
    dist = np.linalg.norm(fcol - paint, axis=1)
    zf, zr = body.bounds[1][2], body.bounds[0][2]
    lab = np.zeros(len(c), int)  # 0 corpo, 1 vidro, 2 farol L, 3 farol R, 4 lanterna L, 5 lanterna R
    if pl > 55:
        lab[seen_f & (c[:, 1] > 0.52 * H) & (c[:, 1] < 0.95 * H) & (np.abs(c[:, 2]) < 0.38 * L) &
            (luma < min(95, 0.75 * pl))] = 1
    ax = np.abs(c[:, 0])
    nz = body.face_normals[:, 2]
    ny = body.face_normals[:, 1]
    head_sel = (c[:, 2] > zf - 0.11 * L) & (c[:, 1] > 0.47 * H) & (c[:, 1] < 0.60 * H) & (ax > 0.52 * W / 2) & (ax < 0.97 * W / 2) & (nz > 0.25) & (ny < 0.6) & (lab == 0)
    tail_sel = (c[:, 2] < zr + 0.09 * L) & (c[:, 1] > 0.46 * H) & (c[:, 1] < 0.66 * H) & (ax > 0.40 * W / 2) & (ax < 0.97 * W / 2) & (nz < -0.25) & (ny < 0.6) & (lab == 0)
    lab[head_sel & (c[:, 0] > 0)] = 2
    lab[head_sel & (c[:, 0] <= 0)] = 3
    lab[tail_sel & (c[:, 0] > 0)] = 4
    lab[tail_sel & (c[:, 0] <= 0)] = 5
    return lab


LABEL_NAMES = {0: "Body", 1: "Glass", 2: "Headlight_L", 3: "Headlight_R", 4: "Taillight_L", 5: "Taillight_R"}
LENS_COLOR = {2: (214, 218, 222), 3: (214, 218, 222), 4: (170, 12, 12), 5: (170, 12, 12)}


def _sub(mesh, mask):
    if not mask.any():
        return None
    s = mesh.submesh([np.nonzero(mask)[0]], append=True)
    s.remove_unreferenced_vertices()
    return s


# ---------------------------------------------------------------- textura
def bake_texture(low, sample_fn, size=2048, log=print):
    vmap, F2, uv = xatlas.parametrize(low.vertices.astype(np.float32), low.faces.astype(np.uint32))
    V2 = low.vertices[vmap]
    vn = low.vertex_normals[vmap]
    px = uv[:, 0] * (size - 1)
    py = (1 - uv[:, 1]) * (size - 1)
    pts, nrm, rows, cols_ = [], [], [], []
    for f in F2:
        xs, ys = px[f], py[f]
        x0, x1 = int(np.floor(xs.min())), int(np.ceil(xs.max()))
        y0, y1 = int(np.floor(ys.min())), int(np.ceil(ys.max()))
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        gx, gy = gx.ravel(), gy.ravel()
        d = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
        if abs(d) < 1e-9:
            continue
        a = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / d
        b = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / d
        c = 1 - a - b
        ok = (a >= -0.02) & (b >= -0.02) & (c >= -0.02) & (gx >= 0) & (gx < size) & (gy >= 0) & (gy < size)
        if not ok.any():
            continue
        a, b, c = a[ok][:, None], b[ok][:, None], c[ok][:, None]
        pts.append(a * V2[f[0]] + b * V2[f[1]] + c * V2[f[2]])
        nrm.append(a * vn[f[0]] + b * vn[f[1]] + c * vn[f[2]])
        rows.append(gy[ok])
        cols_.append(gx[ok])
    P, N = np.vstack(pts), np.vstack(nrm)
    rows, cols_ = np.concatenate(rows), np.concatenate(cols_)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    col, seen = sample_fn(P, N)
    img = np.zeros((size, size, 3), np.uint8)
    img[rows, cols_] = np.clip(col, 0, 255).astype(np.uint8)
    empty = np.ones((size, size), np.uint8)
    empty[rows, cols_] = 0
    img = cv2.inpaint(img, empty, 4, cv2.INPAINT_TELEA)
    log(f"[carro] textura {size}px assada ({len(P)} texels, {seen.mean() * 100:.0f}% vistos nas fotos)")
    return img, V2, F2, uv, vmap


# ---------------------------------------------------------------- montagem
def _wheel_node(scene, wh, segs, spokes):
    name = wh["name"]
    M = _tr(wh["center"])
    if wh["side"] < 0:
        M = M @ _rot_y(np.pi)
    scene.graph.update(frame_to=name, frame_from=scene.graph.base_frame, matrix=M)
    for part, V, F, rgb in wheel_parts(wh["R"], wh["w"], segs, spokes):
        mesh = trimesh.Trimesh(V, F, process=False)
        mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh, vertex_colors=np.tile(list(rgb) + [255], (len(V), 1)))
        scene.add_geometry(mesh, node_name=f"{name}_{part}", geom_name=f"{name}_{part}", parent_node_name=name)


def build_car(raw_mesh, images, names, out_dir, length_m=4.3, hi_tris=150000, low_tris=6000, log=print, width_m=0.0, height_m=0.0):
    os.makedirs(out_dir, exist_ok=True)
    cp = ColorProjector(raw_mesh.vertices, images, names, log=log)
    front_dir = cp.direction_of("front")
    m, T = prepare(raw_mesh, length_m, front_dir, log, width_m, height_m)
    Tinv = np.linalg.inv(T)

    M3 = T[:3, :3]

    def to_orig(P, N):
        No = N @ M3  # normais: inversa transposta (vale tambem com escala nao uniforme)
        return trimesh.transform_points(P, Tinv), No / np.maximum(np.linalg.norm(No, axis=1, keepdims=True), 1e-9)

    def sample_car(P, N, fix_dark=False):
        """Cor das fotos para pontos no referencial do carro; lado nao fotografado usa o espelho (carros sao simetricos)."""
        c, seen = cp.sample(*to_orig(P, N))
        if (~seen).any():
            flip = np.array([-1.0, 1.0, 1.0])
            c2, seen2 = cp.sample(*to_orig(P * flip, N * flip))
            use = ~seen & seen2
            c[use] = c2[use]
            seen = seen | seen2
        rl = cp.mean @ LUMA
        mx, mn = c.max(axis=1), c.min(axis=1)
        sat = (mx - mn) / np.maximum(mx, 1)
        k = np.clip((c @ LUMA - 1.15 * rl) / (0.25 * rl + 1e-6), 0, 1) * (sat < 0.30)  # tira reflexos/papel brancos
        if fix_dark:  # manchas escuras de reflexo em superficies voltadas para cima (capo/teto)
            k = np.maximum(k, ((N[:, 1] > 0.45) & (c @ LUMA < 0.6 * rl) & (sat < 0.55)))
        k = k[:, None]
        return c * (1 - k) + cp.mean * k, seen

    def colors(mesh, smooth=True, fix_dark=False):
        c, seen = sample_car(mesh.vertices, mesh.vertex_normals, fix_dark)
        if smooth:
            c = smooth_vertex_colors(c, mesh.edges_unique, 3)
        return c, seen

    wheels = detect_wheels(m, log)
    body = remove_wheel_faces(m, wheels)
    body = clean_body(body, hi_tris, log)

    vcol, vseen = colors(body)
    fcol = vcol[body.faces].mean(axis=1)
    fseen = vseen[body.faces].all(axis=1)
    paint = np.median(fcol[fseen], axis=0) if fseen.any() else cp.mean
    lab = classify(body, fcol, fseen, paint)
    log("[carro] faces: " + ", ".join(f"{LABEL_NAMES[k]}={int((lab == k).sum())}" for k in LABEL_NAMES))

    H = m.extents[1]
    meta = dict(length=float(m.extents[2]), width=float(m.extents[0]), height=float(H), wheels=[], anchors=[], paint=[int(v) for v in paint])
    for wh in wheels:
        meta["wheels"].append(dict(name=wh["name"], center=wh["center"], radius=wh["R"], width=wh["w"]))

    def lens_anchor(k, front):
        mask = lab == k
        if not mask.any():
            return
        c = body.triangles_center[mask].mean(axis=0)
        meta["anchors"].append(dict(name=("Headlight" if front else "Taillight") + "Anchor_" + ("L" if k in (2, 4) else "R"),
                                    position=[float(c[0]), float(c[1]), float(c[2] + (0.05 if front else -0.05))], front=front))

    for k in (2, 3):
        lens_anchor(k, True)
    for k in (4, 5):
        lens_anchor(k, False)

    # ----- realista -----
    sc = trimesh.Scene()
    for k, nm in LABEL_NAMES.items():
        part = _sub(body, lab == k)
        if part is None:
            continue
        if k in LENS_COLOR:
            vc = np.tile(list(LENS_COLOR[k]) + [255], (len(part.vertices), 1))
        elif k == 1:
            vc = np.tile([18, 22, 26, 255], (len(part.vertices), 1))
        else:
            c, _ = colors(part, smooth=True, fix_dark=True)
            vc = np.concatenate([np.clip(c, 0, 255), np.full((len(c), 1), 255)], axis=1)
        part.visual = trimesh.visual.ColorVisuals(mesh=part, vertex_colors=vc.astype(np.uint8))
        sc.add_geometry(part, node_name=nm, geom_name=nm)
    for wh in wheels:
        _wheel_node(sc, wh, 48, 5)
    sc.export(os.path.join(out_dir, "realistic.glb"))
    meta["realisticTris"] = int(len(body.faces))

    # ----- low poly -----
    wheel_budget = 4 * 330
    target = max(1500, low_tris - wheel_budget)
    LV, LF = decimate(body.vertices, body.faces, target)
    low = trimesh.Trimesh(LV, LF, process=True)
    low.remove_unreferenced_vertices()
    img, V2, F2, uv, vmap = bake_texture(low, lambda P, N: sample_car(P, N, True), 2048, log)
    Image.fromarray(img).save(os.path.join(out_dir, "lowpoly_texture.png"))

    sc2 = trimesh.Scene()
    body_low = trimesh.Trimesh(V2, F2, process=False)
    body_low.visual = trimesh.visual.TextureVisuals(uv=uv, image=Image.fromarray(img))
    sc2.add_geometry(body_low, node_name="Body", geom_name="Body")
    # farois, lanternas e vidros: pecas pequenas separadas, coladas por cima da carroceria (nao dependem da decimacao)
    for k, nm in LABEL_NAMES.items():
        if k == 0:
            continue
        part = _sub(body, lab == k)
        if part is None or len(part.faces) < 10:
            continue
        pv, pf = decimate(part.vertices, part.faces, 200 if k == 1 else 36)
        ov = trimesh.Trimesh(pv, pf, process=True)
        ov.vertices = ov.vertices + ov.vertex_normals * 0.004
        rgb = LENS_COLOR.get(k, (18, 22, 26))
        ov.visual = trimesh.visual.ColorVisuals(mesh=ov, vertex_colors=np.tile(list(rgb) + [255], (len(ov.vertices), 1)).astype(np.uint8))
        sc2.add_geometry(ov, node_name=nm, geom_name=nm)
    for wh in wheels:
        _wheel_node(sc2, wh, 16, 5)
    sc2.export(os.path.join(out_dir, "lowpoly.glb"))
    meta["lowTris"] = int(len(low.faces) + 4 * 330)
    with open(os.path.join(out_dir, "car_meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
    log(f"[carro] pronto: realista {meta['realisticTris']} tris + rodas, low poly ~{meta['lowTris']} tris")
    return meta


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]

    def opt(n, d):
        return float(sys.argv[sys.argv.index(n) + 1]) if n in sys.argv else d

    mesh = trimesh.load(args[0], force="mesh")
    out = args[1]
    names, imgs = [], []
    for a in args[2:]:
        if "=" in a:
            k, v = a.split("=", 1)
            if v.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                names.append(k)
                imgs.append(np.array(Image.open(v).convert("RGBA")))
    build_car(mesh, imgs, names, out, opt("--length", 4.3), int(opt("--hi", 150000)), int(opt("--tris", 6000)), width_m=opt("--width", 0), height_m=opt("--height", 0))


if __name__ == "__main__":
    main()
