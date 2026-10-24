"""Rodas procedurais para carros (eixo em X, face externa em +X, origem no centro do eixo).
Cada roda e feita de partes separadas (pneu, aro, disco de freio) para o jogo girar tudo em torno do eixo X."""
import numpy as np


def _lathe(profile, segs):
    """Revolve [(x, r), ...] em torno do eixo X. Retorna (vertices, faces); profile aberto."""
    prof = np.asarray(profile, float)
    ang = np.linspace(0, 2 * np.pi, segs, endpoint=False)
    n = len(prof)
    V = np.zeros((n * segs, 3))
    for j, a in enumerate(ang):
        V[j * n:(j + 1) * n, 0] = prof[:, 0]
        V[j * n:(j + 1) * n, 1] = prof[:, 1] * np.cos(a)
        V[j * n:(j + 1) * n, 2] = prof[:, 1] * np.sin(a)
    F = []
    for j in range(segs):
        j2 = (j + 1) % segs
        for i in range(n - 1):
            a, b = j * n + i, j * n + i + 1
            c, d = j2 * n + i + 1, j2 * n + i
            F += [(a, b, c), (a, c, d)]
    return V, np.asarray(F)


def tire(R, w, segs):
    rin = 0.66 * R
    prof = [(-0.5 * w, rin), (-0.5 * w, 0.80 * R), (-0.44 * w, 0.94 * R), (-0.28 * w, 1.0 * R),
            (0.28 * w, 1.0 * R), (0.44 * w, 0.94 * R), (0.5 * w, 0.80 * R), (0.5 * w, rin)]
    return _lathe(prof, segs)


def rim(R, w, segs, spokes=5):
    """Barril do aro + prato frontal com raios (estrela). Face externa em +X."""
    rr = 0.68 * R
    Vb, Fb = _lathe([(-0.40 * w, rr * 0.96), (-0.40 * w, rr), (0.46 * w, rr), (0.46 * w, rr * 0.97)], segs)
    xo = 0.44 * w
    hub, n = 0.16 * R, spokes
    V, F = [Vb], [Fb]
    base = len(Vb)
    verts, faces = [], []
    step = 2 * np.pi / n
    half = step * 0.17
    for k in range(n):
        a = k * step
        # raio = quadrilatero do cubo ate o aro, levemente afunilado
        pts = [(hub, a - half * 1.4), (hub, a + half * 1.4), (rr * 0.98, a + half), (rr * 0.98, a - half)]
        i0 = len(verts)
        for r, t in pts:
            verts.append((xo, r * np.cos(t), r * np.sin(t)))
        faces += [(i0, i0 + 1, i0 + 2), (i0, i0 + 2, i0 + 3)]
    # cubo (disco central)
    i0 = len(verts)
    verts.append((xo + 0.02 * w, 0, 0))
    for t in np.linspace(0, 2 * np.pi, max(8, segs // 2), endpoint=False):
        verts.append((xo, hub * 1.4 * np.cos(t), hub * 1.4 * np.sin(t)))
    m = max(8, segs // 2)
    for t in range(m):
        faces.append((i0, i0 + 1 + t, i0 + 1 + (t + 1) % m))
    V.append(np.asarray(verts))
    F.append(np.asarray(faces) + base)
    return np.vstack(V), np.vstack(F)


def brake_disc(R, w, segs):
    x = 0.12 * w
    V = [(x, 0, 0)] + [(x, 0.62 * R * np.cos(t), 0.62 * R * np.sin(t)) for t in np.linspace(0, 2 * np.pi, segs, endpoint=False)]
    F = [(0, 1 + i, 1 + (i + 1) % segs) for i in range(segs)]
    return np.asarray(V), np.asarray(F)


def wheel_parts(R, w, segs=32, spokes=5):
    """Lista de (nome, vertices, faces, cor_rgb) em coordenadas locais."""
    return [
        ("tire", *tire(R, w, segs), (28, 28, 30)),
        ("rim", *rim(R, w, segs, spokes), (176, 178, 184)),
        ("disc", *brake_disc(R, w, segs), (45, 45, 50)),
    ]
