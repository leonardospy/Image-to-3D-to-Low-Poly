"""Correcao geometrica de carros gerados por IA (sem IA): endireita o eixo, simetriza esquerda/direita e alisa a
carroceria sem arredondar vincos (portas, capo, caixas de roda). Trabalha em vertices SOLDADOS (as emendas de UV
duplicam vertices; mover cada copia separado abriria rachaduras) e nunca mexe nas faces protegidas (rodas, farois)."""
import numpy as np
import trimesh
from scipy.sparse import coo_matrix
from scipy.spatial import cKDTree

from car_tools import _rot_y


def _weld(vertices):
    key = np.round(np.asarray(vertices) / 1e-4).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    return inv.ravel()


def asymmetry(vertices):
    """Distancia media (m) entre cada vertice espelhado em X e o vertice mais proximo."""
    V = np.asarray(vertices)
    tree = cKDTree(V)
    d, _ = tree.query(V * np.array([-1.0, 1.0, 1.0]))
    return float(d.mean())


def straighten_yaw(m, wheels, log=print):
    """Gira em torno de Y para o eixo longo (centros de roda de cada lado) ficar paralelo a Z."""
    c = {w["name"]: np.array(w["center"]) for w in wheels}
    angs = []
    for side in ("L", "R"):
        f, r = c.get(f"Wheel_F{side}"), c.get(f"Wheel_R{side}")
        if f is not None and r is not None:
            angs.append(np.arctan2(f[0] - r[0], f[2] - r[2]))
    if not angs:
        return 0.0
    a = float(np.mean(angs))
    if abs(np.degrees(a)) < 0.15 or abs(np.degrees(a)) > 6:
        return 0.0
    m.apply_transform(_rot_y(a))  # rotacao de +a em Y leva (x,z) -> corrige o desvio medido
    b = m.bounds
    m.apply_translation([-(b[0][0] + b[1][0]) / 2, -b[0][1], -(b[0][2] + b[1][2]) / 2])
    log(f"[carro] eixo endireitado em {np.degrees(a):.2f} graus")
    return a


def params_from_level(level, dense=True):
    """Nivel 0-100 -> parametros. 0 = nada; ~25 = padrao (alisa ruido, mantem vincos); 100 = forte (arredonda ate vincos suaves)."""
    t = max(0.0, min(100.0, float(level))) / 100.0
    iters = int(round(60 * t)) if dense else int(round(26 * t))
    return dict(
        iters=max(1, iters) if t > 0 else 0,
        sym_weight=0.5 * min(1.0, t / 0.25),       # simetria completa (media dos dois lados) a partir de 25%
        sym_dist=0.04 + 0.08 * t,                   # distancia maxima para considerar o ponto espelhado
        crease=0.12 + 0.55 * max(0.0, t - 0.25),    # acima do padrao, vincos suaves tambem sao alisados
    )


def clean_geometry(m, protect_faces, iters=14, lamb=0.5, nu=-0.53, crease=0.12, sym_dist=0.06, sym_weight=0.5, log=print):
    """Simetriza em X e alisa (Taubin) com peso reduzido perto de vincos. Retorna novas posicoes de vertice."""
    inv = _weld(m.vertices)
    n = int(inv.max()) + 1
    cnt = np.bincount(inv, minlength=n)
    P = np.zeros((n, 3))
    np.add.at(P, inv, m.vertices)
    P /= cnt[:, None]
    f = inv[m.faces]

    pr = np.zeros(n, bool)
    pr[f[protect_faces].ravel()] = True

    before = asymmetry(P)

    # --- simetria: aproxima cada ponto da media entre ele e o ponto mais proximo do espelho
    flip = np.array([-1.0, 1.0, 1.0])
    Pm = P * flip
    if len(m.faces) < 50000:
        # malha rala: amostra a SUPERFICIE espelhada (triangulos grandes) e usa o ponto amostrado mais proximo
        mirrored = trimesh.Trimesh(Pm, f, process=False)
        pts, _ = trimesh.sample.sample_surface(mirrored, 120000, seed=0)
        d, i = cKDTree(pts).query(P)
        target = pts[i]
    else:
        tree = cKDTree(Pm)
        d, i = tree.query(P)
        target = Pm[i]
    ok = (d < sym_dist) & ~pr
    P2 = P.copy()
    P2[ok] = (1 - sym_weight) * P[ok] + sym_weight * target[ok]
    P = P2

    # --- alisamento Taubin ponderado por "quao liso" e o local (vincos preservados)
    e = np.vstack([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    e = np.vstack([e, e[:, ::-1]])
    A = coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n)).tocsr()
    A.data[:] = 1.0
    deg = np.maximum(np.asarray(A.sum(axis=1)).ravel(), 1)
    fn = m.face_normals * m.area_faces[:, None]
    N = np.zeros((n, 3))
    for k in range(3):
        np.add.at(N, f[:, k], fn)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
    M = (A @ N) / deg[:, None]
    M /= np.maximum(np.linalg.norm(M, axis=1, keepdims=True), 1e-12)
    dev = 1.0 - (N * M).sum(axis=1)  # 0 = liso, grande = vinco
    w = np.clip(1.0 - dev / crease, 0.0, 1.0)
    w[pr] = 0.0
    for _ in range(iters):
        for s in (lamb, nu):
            L = (A @ P) / deg[:, None] - P
            P += (s * w)[:, None] * L

    log(f"[carro] geometria (iters={iters}, simetria={sym_weight:.2f}): assimetria {before * 1000:.1f} mm -> {asymmetry(P) * 1000:.1f} mm; "
        f"{int((w > 0.5).sum())}/{n} vertices alisados (vincos preservados)")
    return P[inv]
