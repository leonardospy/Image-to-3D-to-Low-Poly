"""Projeta a cor das fotos (RGBA, fundo removido) numa malha sem cor, com cameras ortograficas alinhadas aos eixos.
Cada foto escolhe sozinha a direcao horizontal (+X, -X, +Z, -Z) cuja silhueta mais combina com a dela (IoU).
Eixo Y = para cima. Sem IA: so geometria."""
import cv2
import numpy as np

DIRS = {"+z": (0, 0, 1), "-z": (0, 0, -1), "+x": (1, 0, 0), "-x": (-1, 0, 0)}
UP = np.array([0.0, 1.0, 0.0])


class ColorProjector:
    def __init__(self, V, view_images, names=None, log=print):
        """V: vertices da malha de referencia (n,3). view_images: lista de arrays RGBA uint8."""
        self.V = np.asarray(V, float)
        self.extent = float(np.ptp(self.V, axis=0).max())
        self.views = []
        used = set()
        for i, rgba in enumerate(view_images):
            alpha = rgba[:, :, 3] > 127
            ys, xs = np.nonzero(alpha)
            x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
            best = None
            for name, d in DIRS.items():
                if name in used and len(view_images) <= 4:
                    continue
                fit = self._fit(np.asarray(d, float), (x0, x1, y0, y1))
                px, py, _ = self._map(self.V, fit)
                score = self._iou(px, py, alpha)
                if best is None or score > best[0]:
                    best = (score, name, np.asarray(d, float), fit)
            score, dname, d, fit = best
            used.add(dname)
            if log:
                log(f"[cor] foto {i + 1}{'' if not names else ' (' + names[i] + ')'}: direcao {dname} (IoU {score:.2f})")
            h, w = alpha.shape
            px, py, t = self._map(self.V, fit)
            ix, iy = np.clip(np.round(px).astype(int), 0, w - 1), np.clip(np.round(py).astype(int), 0, h - 1)
            zb = np.full(((h + 1) // 2, (w + 1) // 2), -1e9)
            np.maximum.at(zb, (iy // 2, ix // 2), t)
            self.views.append(dict(d=d, name=dname, label=names[i] if names else None, fit=fit,
                                   rgba=rgba, alpha=alpha, zb=zb, shape=(h, w), iou=score))
        self.mean = self._estimate_paint(view_images[0])

    def _fit(self, d, box):
        right = np.cross(UP, d)
        u, v = self.V @ right, self.V @ UP
        x0, x1, y0, y1 = box
        s = (y1 - y0 + 1) / max(v.max() - v.min(), 1e-9)
        return dict(d=d, right=right, s=s, uc=(u.min() + u.max()) / 2, v0=v.min(), cx=(x0 + x1) / 2, y1=y1)

    @staticmethod
    def _map(P, f):
        u, v, t = P @ f["right"], P @ UP, P @ f["d"]
        return f["cx"] + (u - f["uc"]) * f["s"], f["y1"] - (v - f["v0"]) * f["s"], t

    @staticmethod
    def _iou(px, py, alpha):
        h, w = alpha.shape
        occ = np.zeros((h, w), np.uint8)
        ix, iy = np.round(px).astype(int), np.round(py).astype(int)
        ok = (ix >= 0) & (ix < w) & (iy >= 0) & (iy < h)
        occ[iy[ok], ix[ok]] = 1
        occ = cv2.morphologyEx(occ, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
        a = alpha.astype(np.uint8)
        return (occ & a).sum() / max((occ | a).sum(), 1)

    @staticmethod
    def _estimate_paint(rgba):
        """Cor dominante da carroceria: maior grupo de cor do objeto, ignorando muito escuro/estourado."""
        px = rgba[:, :, :3][rgba[:, :, 3] > 127].astype(np.float32)
        if len(px) > 20000:
            px = px[np.random.default_rng(0).choice(len(px), 20000, replace=False)]
        if len(px) < 50:
            return np.array([128.0, 128.0, 128.0])
        _, labels, centers = cv2.kmeans(px, 5, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5), 3, cv2.KMEANS_PP_CENTERS)
        counts = np.bincount(labels.ravel(), minlength=5)
        luma = centers @ np.array([0.299, 0.587, 0.114])
        ok = (luma > 55) & (luma < 215)
        if not ok.any():
            return centers[counts.argmax()].astype(float)
        score = np.where(ok, counts, -1)
        return centers[score.argmax()].astype(float)

    def direction_of(self, label):
        """Direcao (nome) escolhida para a foto com esse rotulo, ou None."""
        for v in self.views:
            if v["label"] == label:
                return v["name"]
        return None

    def sample(self, P, N, smooth_edges=None):
        """Cores sRGB (0-255) para pontos P com normais N. Pontos sem foto recebem a cor media."""
        P, N = np.asarray(P, float), np.asarray(N, float)
        acc = np.zeros((len(P), 3))
        wsum = np.zeros(len(P))
        for vw in self.views:
            h, w = vw["shape"]
            px, py, t = self._map(P, vw["fit"])
            ix, iy = np.round(px).astype(int), np.round(py).astype(int)
            inside = (ix >= 0) & (ix < w) & (iy >= 0) & (iy < h)
            ixc, iyc = np.clip(ix, 0, w - 1), np.clip(iy, 0, h - 1)
            visible = t >= vw["zb"][iyc // 2, ixc // 2] - 0.03 * self.extent
            facing = np.clip(N @ vw["d"], 0, None) ** 1.5
            wgt = facing * (inside & vw["alpha"][iyc, ixc] & visible)
            acc += vw["rgba"][iyc, ixc, :3] * wgt[:, None]
            wsum += wgt
        seen = wsum > 1e-6
        cols = np.where(seen[:, None], acc / np.maximum(wsum[:, None], 1e-6), self.mean)
        return cols, seen


def smooth_vertex_colors(cols, edges, iters=3):
    n = len(cols)
    for _ in range(iters):
        s = cols.copy()
        cnt = np.ones(n)
        np.add.at(s, edges[:, 0], cols[edges[:, 1]])
        np.add.at(s, edges[:, 1], cols[edges[:, 0]])
        np.add.at(cnt, edges[:, 0], 1)
        np.add.at(cnt, edges[:, 1], 1)
        cols = s / cnt[:, None]
    return cols


def project_colors(mesh, view_images, log=print):
    """Compatibilidade: cores por vertice (n,4) uint8."""
    cp = ColorProjector(mesh.vertices, view_images, log=log)
    cols, _ = cp.sample(mesh.vertices, mesh.vertex_normals)
    cols = smooth_vertex_colors(cols, mesh.edges_unique)
    return np.concatenate([np.clip(cols, 0, 255), np.full((len(cols), 1), 255)], axis=1).astype(np.uint8)
