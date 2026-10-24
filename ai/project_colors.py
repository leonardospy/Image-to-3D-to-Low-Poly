"""Projeta a cor das fotos (RGBA, fundo removido) numa malha sem cor, com cameras ortograficas alinhadas aos eixos.
Cada foto escolhe sozinha a direcao horizontal (+X, -X, +Z, -Z) cuja silhueta mais combina com a dela (IoU).
Eixo Y = para cima. Sem IA: so geometria."""
import cv2
import numpy as np

DIRS = {"+z": (0, 0, 1), "-z": (0, 0, -1), "+x": (1, 0, 0), "-x": (-1, 0, 0)}


def _fit(V, d, rgba):
    """Mapeia vertices para pixels da foto (ajuste por altura, base alinhada, centro horizontal)."""
    d = np.asarray(d, float)
    up = np.array([0.0, 1.0, 0.0])
    right = np.cross(up, d)
    u, v, t = V @ right, V @ up, V @ d
    alpha = rgba[:, :, 3] > 127
    ys, xs = np.nonzero(alpha)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    s = (y1 - y0 + 1) / max(v.max() - v.min(), 1e-9)
    px = (x0 + x1) / 2 + (u - (u.min() + u.max()) / 2) * s
    py = y1 - (v - v.min()) * s
    return px, py, t, alpha


def _iou(px, py, alpha):
    h, w = alpha.shape
    occ = np.zeros((h, w), np.uint8)
    ix, iy = np.round(px).astype(int), np.round(py).astype(int)
    ok = (ix >= 0) & (ix < w) & (iy >= 0) & (iy < h)
    occ[iy[ok], ix[ok]] = 1
    occ = cv2.morphologyEx(occ, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    a = alpha.astype(np.uint8)
    inter, union = (occ & a).sum(), (occ | a).sum()
    return inter / max(union, 1)


def project_colors(mesh, view_images, log=print):
    """mesh: trimesh.Trimesh; view_images: lista de arrays RGBA uint8. Devolve cores (n,4) uint8."""
    V = np.asarray(mesh.vertices, float)
    N = np.asarray(mesh.vertex_normals, float)
    extent = float(np.ptp(V, axis=0).max())
    acc = np.zeros((len(V), 3))
    wsum = np.zeros(len(V))
    used = set()
    body = []

    for i, rgba in enumerate(view_images):
        best = None
        for name, d in DIRS.items():
            if name in used and len(view_images) <= 4:
                continue
            px, py, t, alpha = _fit(V, d, rgba)
            score = _iou(px, py, alpha)
            if best is None or score > best[0]:
                best = (score, name, d, px, py, t, alpha)
        score, name, d, px, py, t, alpha = best
        used.add(name)
        log(f"[cor] foto {i + 1}: direcao {name} (IoU {score:.2f})")
        h, w = alpha.shape
        ix, iy = np.round(px).astype(int), np.round(py).astype(int)
        inside = (ix >= 0) & (ix < w) & (iy >= 0) & (iy < h)
        ixc, iyc = np.clip(ix, 0, w - 1), np.clip(iy, 0, h - 1)

        # z-buffer (resolucao /2) para nao pintar o que esta atras
        zb = np.full(((h + 1) // 2, (w + 1) // 2), -1e9)
        np.maximum.at(zb, (iyc // 2, ixc // 2), t)
        visible = t >= zb[iyc // 2, ixc // 2] - 0.03 * extent

        facing = np.clip(N @ np.asarray(d, float), 0, None) ** 1.5
        valid = inside & alpha[iyc, ixc] & visible
        wgt = facing * valid
        acc += rgba[iyc, ixc, :3] * wgt[:, None]
        wsum += wgt
        body.append(rgba[:, :, :3][alpha].mean(axis=0))

    seen = wsum > 1e-6
    mean = (acc[seen].sum(axis=0) / wsum[seen].sum()) if seen.any() else np.mean(body, axis=0)
    cols = np.where(wsum[:, None] > 1e-6, acc / np.maximum(wsum[:, None], 1e-6), mean)

    # suaviza as cores entre vertices vizinhos (reduz emendas e pontos sem foto)
    edges = mesh.edges_unique
    for _ in range(3):
        s = cols.copy()
        cnt = np.ones(len(V))
        np.add.at(s, edges[:, 0], cols[edges[:, 1]])
        np.add.at(s, edges[:, 1], cols[edges[:, 0]])
        np.add.at(cnt, edges[:, 0], 1)
        np.add.at(cnt, edges[:, 1], 1)
        cols = s / cnt[:, None]
    rgba_out = np.concatenate([np.clip(cols, 0, 255), np.full((len(V), 1), 255)], axis=1).astype(np.uint8)
    return rgba_out
