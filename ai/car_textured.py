"""Trata um carro ja texturizado (saida do TRELLIS.2 via ComfyUI): orienta, escala para medidas reais, separa rodas
(giraveis), farois e lanternas, e exporta GLB mantendo texturas PBR (cor, normal, metalico/rugosidade, AO).

Convencao de saida (glTF): metros, Y para cima, frente em +Z, +X = lado esquerdo, chao em y=0.
Uso: python car_textured.py <entrada.glb> <saida.glb> --wheels original|procedural [--front-image foto.png]
        [--length 4.3] [--width 0] [--height 0] [--meta saida.json]
"""
import json
import os
import sys

import numpy as np
import trimesh
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from car_tools import detect_wheels, _rot_y, _tr  # noqa: E402
from car_wheels import wheel_parts  # noqa: E402
from project_colors import ColorProjector  # noqa: E402
from car_geometry import clean_geometry, straighten_yaw  # noqa: E402


def load_mesh(path):
    s = trimesh.load(path)
    if isinstance(s, trimesh.Scene):
        geoms = list(s.geometry.values())
        m = geoms[0] if len(geoms) == 1 else trimesh.util.concatenate(geoms)
    else:
        m = s
    return m


def front_direction(mesh, image_rgba, log=print):
    """Direcao horizontal (+z,-z,+x,-x) para onde a frente do carro aponta, pela silhueta da foto de frente."""
    cp = ColorProjector(mesh.vertices, [image_rgba], ["front"], log=log)
    return cp.direction_of("front")


def orient_scale(m, front_dir, length_m, width_m, height_m, log=print):
    ext = m.extents
    theta = 0.0
    if ext[0] > ext[2]:
        theta = np.pi / 2 if front_dir == "-x" else -np.pi / 2
    elif front_dir == "-z":
        theta = np.pi
    m.apply_transform(_rot_y(theta))
    e = m.extents
    sz = length_m / e[2]
    m.apply_transform(np.diag([(width_m / e[0]) if width_m else sz, (height_m / e[1]) if height_m else sz, sz, 1.0]))
    b = m.bounds
    m.apply_translation([-(b[0][0] + b[1][0]) / 2, -b[0][1], -(b[0][2] + b[1][2]) / 2])
    log(f"[carro] medidas finais: {m.extents[2]:.2f} x {m.extents[0]:.2f} x {m.extents[1]:.2f} m (C x L x A)")
    return m


def face_masks(m, wheels):
    c = m.triangles_center
    V = m.vertices[m.faces]  # (f,3,3)
    wmask = {}
    for wh in wheels:
        xin = wh["side"] * c[:, 0]
        wmask[wh["name"]] = (xin > wh["x_out"] - 1.25 * wh["w"]) & (xin < wh["x_out"] + 0.10) & \
            (np.hypot(c[:, 1] - wh["R"], c[:, 2] - wh["center"][2]) <= 1.04 * wh["R"])
    return wmask


def lamp_masks(m):
    """Regioes geometricas de farol e lanterna: centroide no recorte, voltada para frente/tras, faces pequenas."""
    H, W, L = m.extents[1], m.extents[0], m.extents[2]
    zf, zr = m.bounds[1][2], m.bounds[0][2]
    c = m.triangles_center
    n = m.face_normals
    small = m.area_faces < 0.03
    ax = np.abs(c[:, 0])
    ok_head = ((c[:, 2] > zf - 0.10 * L) & (c[:, 1] > 0.42 * H) & (c[:, 1] < 0.64 * H) & (ax > 0.42 * W / 2) & (ax < 0.99 * W / 2)
               & (n[:, 2] > 0.15) & (n[:, 1] < 0.7) & small)
    ok_tail = ((c[:, 2] < zr + 0.09 * L) & (c[:, 1] > 0.46 * H) & (c[:, 1] < 0.70 * H) & (ax > 0.42 * W / 2) & (ax < 0.99 * W / 2)
               & (n[:, 2] < -0.15) & (n[:, 1] < 0.7) & small)
    return {
        "Headlight_L": ok_head & (c[:, 0] > 0), "Headlight_R": ok_head & (c[:, 0] <= 0),
        "Taillight_L": ok_tail & (c[:, 0] > 0), "Taillight_R": ok_tail & (c[:, 0] <= 0),
    }


def _sub(m, mask):
    if not mask.any():
        return None
    return m.submesh([np.nonzero(mask)[0]], append=True)


def add_wheel(scene, wh, source_mesh, mode, segs, log=print):
    name = wh["name"]
    M = _tr(wh["center"])
    scene.graph.update(frame_to=name, frame_from=scene.graph.base_frame, matrix=M)
    if mode == "procedural":
        Mr = _rot_y(np.pi) if wh["side"] < 0 else np.eye(4)
        for part, V, F, rgb in wheel_parts(wh["R"], wh["w"], segs, 5):
            mesh = trimesh.Trimesh(V, F, process=False)
            mesh.apply_transform(Mr)
            mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh, vertex_colors=np.tile(list(rgb) + [255], (len(V), 1)))
            scene.add_geometry(mesh, node_name=f"{name}_{part}", geom_name=f"{name}_{part}", parent_node_name=name)
    else:
        part = source_mesh
        scene.add_geometry(part, node_name=f"{name}_mesh", geom_name=f"{name}_mesh", parent_node_name=name)


def process(in_glb, out_glb, wheel_mode="original", front_image=None, front_dir=None, length=4.3, width=0.0, height=0.0, log=print, clean=True):
    m = load_mesh(in_glb)
    if front_dir is None and front_image is not None:
        front_dir = front_direction(m, np.array(Image.open(front_image).convert("RGBA")), log)
    log(f"[carro] frente do carro: {front_dir or '(+z por padrao)'}")
    orient_scale(m, front_dir, length, width, height, log)
    wheels = detect_wheels(m, log)
    if clean and straighten_yaw(m, wheels, log):
        wheels = detect_wheels(m, log)
    wm = face_masks(m, wheels)
    lm = lamp_masks(m)

    taken = np.zeros(len(m.faces), bool)
    for k in wm.values():
        taken |= k
    for k in lm.values():
        k &= ~taken
        taken |= k
    log("[carro] faces: " + ", ".join(f"{k}={int(v.sum())}" for k, v in {**lm}.items()) + f", rodas={int(sum(v.sum() for v in wm.values()))}")

    if clean:  # simetria + alisamento (rodas e farois ficam como estao)
        m.vertices = clean_geometry(m, taken, iters=14 if len(m.faces) > 50000 else 6, log=log)
    scene = trimesh.Scene()
    body = _sub(m, ~taken)
    scene.add_geometry(body, node_name="Body", geom_name="Body")
    anchors = []
    for nm, mask in lm.items():
        part = _sub(m, mask)
        if part is None or len(part.faces) < 4:
            continue
        scene.add_geometry(part, node_name=nm, geom_name=nm)
        c = part.triangles_center.mean(axis=0)
        front = nm.startswith("Head")
        anchors.append(dict(name=("Headlight" if front else "Taillight") + "Anchor_" + nm[-1], position=[float(c[0]), float(c[1]), float(c[2] + (0.05 if front else -0.05))], front=front))
    # ancoras de luz que nao puderam ser medidas pela geometria: posicao tipica pelas proporcoes
    have = {a["name"] for a in anchors}
    H, W = m.extents[1], m.extents[0]
    zf, zr = m.bounds[1][2], m.bounds[0][2]
    for front, side, nm in ((True, 1, "L"), (True, -1, "R"), (False, 1, "L"), (False, -1, "R")):
        an = ("Headlight" if front else "Taillight") + "Anchor_" + nm
        if an not in have:
            anchors.append(dict(name=an, position=[side * 0.34 * W, (0.50 if front else 0.58) * H, (zf - 0.02) if front else (zr + 0.02)], front=front, estimated=True))
    # rodas originais: a roda mais bem fotografada (mais faces) serve de molde para as quatro
    template = None
    if wheel_mode == "original":
        best = max(wheels, key=lambda w: int(wm[w["name"]].sum()))
        src = _sub(m, wm[best["name"]])
        if src is not None and len(src.faces) > 200:
            src.apply_translation(-np.array(best["center"]))
            template = (src, best["side"])
    for wh in wheels:
        mode, part = wheel_mode, None
        if wheel_mode == "original":
            if template is None:
                mode = "procedural"
            else:
                part = template[0].copy()
                if wh["side"] != template[1]:
                    part.apply_transform(_rot_y(np.pi))
        add_wheel(scene, wh, part, mode, 16 if wheel_mode == "procedural" else 32, log)
    scene.export(out_glb)
    meta = dict(length=float(m.extents[2]), width=float(m.extents[0]), height=float(m.extents[1]), anchors=anchors,
                wheels=[dict(name=w["name"], center=w["center"], radius=w["R"], width=w["w"]) for w in wheels],
                triangles=int(len(body.faces)))
    return meta


def main():
    pos = [a for a in sys.argv[1:] if not a.startswith("--")]

    def opt(n, d=None):
        return sys.argv[sys.argv.index(n) + 1] if n in sys.argv else d

    meta = process(pos[0], pos[1], opt("--wheels", "original"), opt("--front-image"), opt("--front-dir"),
                   float(opt("--length", 4.3)), float(opt("--width", 0)), float(opt("--height", 0)), clean="--no-clean" not in sys.argv)
    if opt("--meta"):
        json.dump(meta, open(opt("--meta"), "w"), indent=1)
    print("[carro] pronto")


if __name__ == "__main__":
    main()
