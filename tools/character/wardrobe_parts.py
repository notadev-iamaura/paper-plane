"""
wardrobe_parts.py - 주인공 아이의 "갈아입는 부분"을 만든다(머리 모양, 모자, 옷의 덧붙임).

parts.py 의 부분 함수를 그대로 쓰고(비율 P 만 바꿔 부른다), 거기에 없는 모양만 여기서 만든다:
  모자   : 썬캡(visor), 머리띠 + 리본(band), 비니(beanie), 벙거지(bucket)
  머리   : 머리 모양마다의 머리선(HAIR)과 덧붙임(양 갈래, 묶은 머리, 똥머리, 삐죽 가닥)
  옷     : 치마(skirt), 멜빵(bib), 모자 달린 옷의 모자(hood), 지퍼(zip), 끈

좌표계는 parts.py 와 같다: +X = 캐릭터의 왼쪽, -Y = 앞, +Z = 위. 키 = 1.
"""
import copy
import math

import bpy  # noqa: F401
import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import meshkit as mk
import parts
from meshkit import Part, ring

FWD = Vector((0, -1, 0))
UP = Vector((0, 0, 1))


# =========================================================================== 머리 모양
def hairline(P, **kw):
    H = dict(P['hairline'])
    H.update(kw)
    return H


def hair_styles(P):
    """
    머리 모양 8 가지: 이름 -> dict(hairline=머리선, cols=세로 띠 수, extras=덧붙임, ears=귀가 보이는지)
    첫째(short)가 지금까지의 주인공 머리다. 숫자를 그대로 둔다.
    덧붙임 가운데 정수리에 있는 것(똥머리, 삐죽 가닥)은 모자 테 위에 있어서, 정수리를 덮는 모자를 쓰면 게임이 숨긴다.
    """
    return dict(
        short=dict(hairline=dict(P['hairline']), cols=64, extras=[], ears=True),
        # 바가지 머리: 앞머리가 일자로 내려오고 옆과 뒤가 귀 가운데 높이에서 둥글게 끝난다
        bowl=dict(hairline=hairline(P, fringe_z=0.041, fringe_wave=0.007, fringe_start=-1.0, fringe_width=0.5, fringe_vary=0.08,
                                    burn_az=1.14, burn_w=0.20, burn_z=-0.020, ear_z=-0.026, ear_from=1.07, ear_to=1.26, ear_end=1.75,
                                    nape_z=-0.062, nape_wave=0.006, nape_width=0.5, thick=0.030, chunk=0.003, fringe_puff=0.007, flare=0.14),
                  cols=34, extras=[], ears=True),
        # 삐죽 머리: 굵은 가닥이 들쭉날쭉하고 정수리에서 세 가닥이 솟았다
        spiky=dict(hairline=hairline(P, fringe_z=0.060, fringe_wave=0.040, fringe_width=0.42, fringe_vary=0.42, nape_wave=0.034, nape_width=0.45,
                                     thick=0.027, chunk=0.008),
                   cols=36, ears=True,
                   extras=[dict(pos=(0.050, -0.030, 0.206), r=(0.044, 0.040, 0.052), pull=(0.060, -0.030, 0.085)),
                           dict(pos=(-0.045, -0.010, 0.212), r=(0.044, 0.040, 0.054), pull=(-0.045, -0.010, 0.095)),
                           dict(pos=(0.005, 0.075, 0.198), r=(0.046, 0.042, 0.050), pull=(0.020, 0.075, 0.075)),
                           dict(pos=(-0.105, 0.040, 0.165), r=(0.040, 0.038, 0.046), pull=(-0.080, 0.030, 0.050)),
                           dict(pos=(0.115, 0.050, 0.160), r=(0.040, 0.038, 0.046), pull=(0.085, 0.040, 0.048)),
                           dict(pos=(-0.010, -0.110, 0.172), r=(0.036, 0.034, 0.040), pull=(-0.030, -0.070, 0.050))]),
        # 단발: 귀를 덮고 턱 높이에서 끝이 살짝 뻗친다
        bob=dict(hairline=hairline(P, fringe_z=0.046, fringe_wave=0.016, fringe_start=-0.95, fringe_width=0.63, burn_az=1.12, burn_w=0.2, burn_z=-0.120,
                                   ear_z=-0.125, ear_end=1.75, ear_from=1.07, ear_to=1.24, nape_z=-0.135, nape_wave=0.008, thick=0.028, flare=0.22),
                 cols=34, extras=[], ears=False),
        # 양 갈래: 귀 뒤로 묶은 두 덩이 + 머리끈
        pigtails=dict(hairline=hairline(P, fringe_z=0.050, fringe_wave=0.020, fringe_width=0.5, ear_z=0.020, nape_z=-0.07, thick=0.022),
                      cols=34, ears=True,
                      extras=[dict(pos=(0.222, 0.050, -0.062), r=(0.058, 0.056, 0.080), mirror=True, pull=(0.022, 0.0, -0.062)),
                              dict(pos=(0.205, 0.045, 0.012), r=(0.027, 0.027, 0.022), mirror=True, color='accent')]),
        # 묶은 머리(포니테일): 뒤통수 아래에서 한 갈래로 묶어 모자 밑으로도 나온다
        ponytail=dict(hairline=hairline(P, fringe_z=0.048, fringe_wave=0.024, fringe_width=0.58, ear_z=0.034, nape_z=-0.080, nape_wave=0.012, thick=0.022),
                      cols=34, ears=True,
                      extras=[dict(pos=(0.0, 0.250, -0.118), r=(0.052, 0.050, 0.086), pull=(0.0, 0.030, -0.075)),
                              dict(pos=(0.0, 0.216, -0.040), r=(0.028, 0.026, 0.026), color='accent')]),
        # 똥머리: 정수리에 동그랗게 묶었다
        bun=dict(hairline=hairline(P, fringe_z=0.062, fringe_wave=0.016, fringe_width=0.9, ear_z=0.035, nape_z=-0.062, thick=0.021),
                 cols=34, ears=True,
                 extras=[dict(pos=(0.0, 0.040, 0.238), r=(0.072, 0.072, 0.060)),
                         dict(pos=(0.0, 0.040, 0.200), r=(0.042, 0.042, 0.017), color='accent')]),
        # 긴 머리: 앞머리가 있고 옆과 뒤가 어깨 위까지 내려와 안으로 말린다
        long=dict(hairline=hairline(P, fringe_z=0.044, fringe_wave=0.022, fringe_start=-0.98, fringe_width=0.49, burn_az=1.10, burn_w=0.2, burn_z=-0.150,
                                    ear_z=-0.172, ear_end=1.72, ear_from=1.05, ear_to=1.22, nape_z=-0.186, nape_wave=0.010, nape_width=0.44,
                                    thick=0.029, flare=0.10),
                  cols=34, extras=[], ears=False),
    )


def style_P(P, st):
    Q = copy.deepcopy(P)
    Q['cap'] = False
    Q['hairline'] = st['hairline']
    Q['hair_cols'] = st['cols']
    Q['hair_extras'] = st['extras']
    if st['cols'] < 64:
        Q['hair_rows_drop'] = (3, 6)
    return Q


# =========================================================================== 모자
def _brim(p, pal, P, frame, w, length, span_deg, slope, color='cap', under='cap_under'):
    """앞으로 뻗은 초승달 챙(parts.build_cap 의 챙과 같은 모양)."""
    c, u, v, nrm, rx, ry, hD = frame
    C, U, V, N = Vector(c), Vector(u), Vector(v), Vector(nrm)
    phim = math.radians(span_deg)
    st = parts.det(P, 'brim_seg')
    stations = []
    for i in range(st + 1):
        phi = -phim + 2 * phim * i / st
        prof = max(0.0, math.cos(phi / phim * math.pi / 2)) ** 0.7
        ln = max(0.012, length * prof)
        dirv = U * math.sin(phi) * rx + (-V) * math.cos(phi) * ry
        out = dirv.normalized()
        th = 0.013 * (0.5 + 0.5 * prof)

        def pt(k, hh, dirv=dirv, out=out, ln=ln):
            base = C + dirv * 0.95
            return base + out * (0.05 * dirv.length + ln) * k + N * (hh - slope * ln * k * k)
        stations.append([pt(0, 0.012), pt(0.5, 0.010), pt(0.93, 0.006), pt(1.0, 0.0), pt(0.93, -th * 0.9), pt(0.5, -th), pt(0, -th + 0.004)])
    col = [color, color, color, under, under, under, under]
    vs = [p.add_ring(s, w) for s in stations]
    for k in range(len(vs) - 1):
        fs = p.bridge(vs[k], vs[k + 1], color)
        for i, f in enumerate(fs):
            f.material_index = pal.index(col[i])
    for end in (vs[0], vs[-1]):
        f = p.bm.faces.new(end)
        f.material_index = pal.index(color)
        f.smooth = True


def front_rim_z(P):
    """모자 테의 앞 끝이 머리 중심보다 얼마나 높은지(앞머리와 눈썹을 가리는지 볼 때 쓴다)."""
    c, u, v, n, rx, ry, hD = parts.cap_frame(P)
    return float((c - v * ry)[2] - parts.head_center(P)[2])


def build_visor(P, pal):
    """썬캡: 머리를 두르는 띠 + 큰 챙. 정수리는 열려 있어서 머리카락이 그대로 보인다."""
    Q = dict(P, brim_len=0.112, brim_span_deg=60, brim_slope=0.8)
    p = Part('visor', pal)
    frame = parts.cap_frame(Q)
    c, u, v, nrm, rx, ry, hD = frame
    C, U, V, N = Vector(c), Vector(u), Vector(v), Vector(nrm)
    n = parts.det(P, 'cap_seg')
    w = {'head': 1}
    rows = [(0.012, 0.90), (-0.004, 0.94), (-0.007, 1.0), (0.004, 1.008), (0.036, 1.008), (0.043, 0.995), (0.040, 0.93), (0.020, 0.895)]
    rings = [ring(C + N * h, rx * k, ry * k, n, u=U, v=V) for h, k in rows]
    vr = p.loft(rings, ['cap_under', 'cap_under', 'cap_band', 'cap', 'cap', 'cap_under', 'cap_under'], [w] * len(rows))
    p.set_thin(vr[0] + vr[-1] + vr[-2], 1.0)
    _brim(p, pal, Q, frame, w, Q['brim_len'], Q['brim_span_deg'], Q['brim_slope'])
    return p.to_object(levels=parts.det(P, 'levels'))


def _dome(p, pal, Q, rows, colors, dome, pw, w, n):
    c, u, v, nrm, rx, ry, hD = parts.cap_frame(Q)
    C, U, V, N = Vector(c), Vector(u), Vector(v), Vector(nrm)
    band_top = rows[-1][0]
    rows = list(rows)
    kt = rows[-1][1]
    for t in dome:
        rows.append((band_top + (hD - band_top) * t, kt * (1 - t ** pw) ** (1 / pw)))
    rings = [ring(C + N * h, rx * k, ry * k, n, u=U, v=V) for h, k in rows]
    vr = p.loft(rings, colors + ['cap'] * (len(rows) - 1 - len(colors)), [w] * len(rows))
    p.cap(vr[-1], 'cap', offset=N * (hD - rows[-1][0]) * 0.9)
    return vr, (C, U, V, N, rx, ry, hD)


def build_beanie(P, pal):
    """비니: 도톰하게 접어 올린 단 + 둥근 돔 + 방울."""
    Q = dict(P, cap_tilt=0.34, cap_h0=0.058, cap_margin=0.043, cap_puff=0.034)
    p = Part('beanie', pal)
    w = {P.get('cap_bone', 'cap'): 1}
    n = 16
    rows = [(0.030, 0.88), (0.002, 0.92), (-0.006, 0.99), (0.000, 1.030), (0.040, 1.034), (0.048, 1.012), (0.050, 0.985)]
    vr, (C, U, V, N, rx, ry, hD) = _dome(p, pal, Q, rows, ['cap_under', 'cap_under', 'cap_band', 'cap_band', 'cap_band', 'cap_band'],
                                         (0.20, 0.42, 0.63, 0.81, 0.93), 2.15, w, n)
    p.set_thin(vr[0], 1.0)
    mk.quad_sphere(p, C + N * (hD + 0.026), (0.046, 0.046, 0.042), 2, 'cap_button', w)
    return p.to_object(levels=parts.det(P, 'levels'))


def build_bucket(P, pal):
    """벙거지: 납작한 돔 + 빙 둘러 아래로 처진 챙."""
    Q = dict(P, cap_tilt=0.30, cap_h0=0.080, cap_margin=0.040, cap_puff=0.006)
    p = Part('bucket', pal)
    w = {P.get('cap_bone', 'cap'): 1}
    n = 16
    # 챙: 속 -> 밑면 -> 끝 -> 윗면 -> 띠
    rows = [(0.028, 0.90), (0.004, 0.94), (-0.030, 1.17), (-0.047, 1.33), (-0.041, 1.345), (-0.020, 1.17), (0.000, 1.012), (0.008, 1.0), (0.030, 0.995), (0.036, 0.985)]
    cols = ['cap_under', 'cap_under', 'cap_under', 'cap', 'cap', 'cap', 'cap_band', 'cap_band', 'cap_band']
    vr, (C, U, V, N, rx, ry, hD) = _dome(p, pal, Q, rows, cols, (0.26, 0.52, 0.76, 0.93), 3.4, w, n)
    p.set_thin(vr[0], 1.0)
    return p.to_object(levels=parts.det(P, 'levels'))


def build_headband(P, pal):
    """머리띠 + 리본: 귀 위에서 정수리 앞쪽을 넘어가는 띠. 왼쪽 위에 리본이 달려 있다."""
    obs = []
    p = Part('band', pal)
    c = parts.head_center(P)
    w = {'head': 1}
    tilt = 0.30                    # 띠가 넘어가는 면을 앞으로 기울인 각도(정수리의 똥머리 앞을 지난다)
    th = 0.036
    R = np.array(P['head_r'])
    path = []
    N_ = 18
    for i in range(N_ + 1):
        a = math.radians(-112 + 224 * i / N_)       # 0 = 정수리, +-112 도 = 귀 밑
        d = np.array([math.sin(a), -math.cos(a) * math.sin(tilt), math.cos(a) * math.cos(tilt)])
        # 머리(+ 머리카락 두께) 타원체 위의 점
        rr = R + th
        t = 1.0 / math.sqrt(((d / rr) ** 2).sum())
        pt = parts.shape_head((c + d * t).reshape(1, 3), P)[0]
        path.append((Vector(pt), Vector(d)))
    rings = []
    hw, tk = 0.021, 0.009
    for i, (pt, d) in enumerate(path):
        a = path[max(0, i - 1)][0]
        b = path[min(N_, i + 1)][0]
        t = (b - a).normalized()
        nrm = (pt - Vector(c)).normalized()
        bn = nrm.cross(t).normalized()
        k = 1.0 if 1 <= i <= N_ - 1 else 0.6
        rings.append([pt + bn * hw * k - nrm * tk, pt + bn * hw * k * 0.8 + nrm * tk * 0.5, pt - bn * hw * k * 0.8 + nrm * tk * 0.5, pt - bn * hw * k - nrm * tk])
    vr = p.loft(rings, 'cap', [w] * len(rings))
    p.cap(vr[0], 'cap')
    p.cap(vr[-1], 'cap')
    obs.append(p.to_object(levels=1))
    # 리본: 띠의 왼쪽 위(보는 사람 기준 오른쪽)에 날개 두 장과 매듭
    i0 = int(N_ * 0.66)
    pt, d = path[i0]
    nrm = (pt - Vector(c)).normalized()
    t = (path[i0 + 1][0] - path[i0 - 1][0]).normalized()
    base = pt + nrm * 0.016
    for s_ in (1, -1):
        q = Part('bow', pal)
        ctr = base + t * (0.044 * s_)
        mk.quad_sphere(q, ctr, (0.038, 0.038, 0.038), 2, 'cap', w)
        ob = q.to_object(levels=1)
        co = mk.get_co(ob)
        # 띠 방향(t)으로 길고, 바깥(nrm)으로 납작한 물방울: 매듭 쪽이 가늘다
        rel = co - np.array(ctr)
        tt, nn = np.array(t), np.array(nrm)
        bb = np.cross(nn, tt)
        a_, b_, c_ = rel @ tt, rel @ bb, rel @ nn
        wide = 0.55 + 0.75 * mk.smoothstep(-0.03, 0.03, a_ * s_)
        co = np.array(ctr) + np.outer(a_ * 1.15, tt) + np.outer(b_ * wide * 1.25, bb) + np.outer(c_ * 0.55, nn)
        mk.set_co(ob, co)
        obs.append(ob)
    obs.append(parts.build_blob(pal, 'knot', base + nrm * 0.006, (0.019, 0.019, 0.019), 'cap_band', w, levels=1))
    return obs


# =========================================================================== 옷의 덧붙임
class Shell:
    """몸에 입힌 옷 겉면: 바깥에서 몸의 세로축을 향해 광선을 쏘아 표면의 점을 찾는다(앞뒤 어디든)."""

    def __init__(self, ob):
        self.surf = parts.Surface(ob)

    def at(self, az, z, cx=0.0):
        """방위각 az(앞 = 0, 캐릭터의 왼쪽 = +), 높이 z 에서의 표면 점과 법선"""
        d = Vector((math.sin(az), -math.cos(az), 0))
        o = Vector((cx, 0, z)) + d * 0.6
        hit = self.surf.bvh.ray_cast(o, -d)
        if hit[0] is None:
            return None, None
        return hit[0], hit[1].normalized()

    def toward(self, origin, target):
        d = (Vector(target) - Vector(origin)).normalized()
        hit = self.surf.bvh.ray_cast(Vector(origin), d)
        if hit[0] is None:
            return None, None
        return hit[0], hit[1].normalized()


def build_strip(pal, name, shell_w, pts, width, thick, color, thin=0.6, sink=0.003, levels=1):
    """표면 위의 점과 법선 목록 [(점, 법선), ...] 을 따라 납작한 띠를 놓는다. 가중치는 그 자리의 옷에서 물려받는다."""
    p = Part(name, pal)
    rings, ws = [], []
    for i, (pt, nrm) in enumerate(pts):
        a = pts[max(0, i - 1)][0]
        b = pts[min(len(pts) - 1, i + 1)][0]
        t = (b - a).normalized()
        bn = nrm.cross(t).normalized()
        h = width / 2
        rings.append([pt + bn * h - nrm * sink, pt + bn * h * 0.86 + nrm * thick, pt - bn * h * 0.86 + nrm * thick, pt - bn * h - nrm * sink])
        ws.append(shell_w(pt))
    vr = p.loft(rings, color, ws)
    p.cap(vr[0], color)
    p.cap(vr[-1], color)
    for r in vr:
        p.set_thin([r[0], r[3]], 1.0)
        p.set_thin([r[1], r[2]], thin)
    return p.to_object(levels=levels)


def build_zip(P, pal, shirt):
    """지퍼: 밑단에서 깃까지 앞 가운데를 따라 올라가는 선 + 손잡이(심판 선생님의 것과 같은 방법)."""
    surf = parts.Surface(shirt)
    hz = P['hem_z']
    cz = parts.Z(P, 0.553)
    zs = [hz + 0.004 + (cz + 0.010 - hz) * i / 11 for i in range(12)]
    obs = [parts.build_ribbon(pal, 'zip', surf, [(0.0, z) for z in zs], 0.011, 0.0035, 'zip', thin=1.0)]
    pull, nrm = surf.front(0.0, cz - 0.034)
    obs.append(parts.build_blob(pal, 'zip_pull', pull + nrm * 0.006 + UP * -0.010, (0.0085, 0.0055, 0.016), 'accent', surf.weights_at(pull), thin=1.0, levels=0))
    return obs


def build_hood(P, pal, shirt):
    """
    모자 달린 옷의 모자: 목을 두른 도톰한 테가 뒤로 갈수록 굵어져 등 위에 얹힌 주머니가 된다. 앞에는 끈 두 가닥.
    """
    surf = parts.Surface(shirt)
    obs = []
    p = Part('hood', pal)
    n_st, n_cs = 16, 8
    rings, ws = [], []
    for i in range(n_st):
        a = 2 * math.pi * i / n_st                # 0 = 앞
        back = 0.5 - 0.5 * math.cos(a)             # 0 앞 ~ 1 뒤
        rad_x, rad_y = 0.078, 0.066 + 0.030 * back
        ctr = Vector((math.sin(a) * rad_x, -math.cos(a) * rad_y + 0.020 * back, parts.Z(P, 0.556) + 0.004 * back))
        out = Vector((math.sin(a), -math.cos(a), 0))
        r_out = 0.017 + 0.026 * back ** 1.4          # 바깥쪽으로의 굵기
        r_up = 0.016 + 0.022 * back ** 1.4
        pts = []
        for j in range(n_cs):
            b = 2 * math.pi * j / n_cs
            pts.append(ctr + out * (math.cos(b) * r_out) + UP * (math.sin(b) * r_up - 0.012 * back * max(0.0, math.cos(b))))
        rings.append(pts)
        ws.append({'chest': 0.8, 'neck': 0.2})
    vr = [p.add_ring(r, w) for r, w in zip(rings, ws)]
    for i in range(n_st):
        fs = p.bridge(vr[i], vr[(i + 1) % n_st], 'shirt')
        for j, f in enumerate(fs):
            # 안쪽(목을 보는 면)은 안감 색
            if j in (3, 4):
                f.material_index = pal.index('shirt_in')
    for r in vr:
        p.set_thin([r[3], r[4], r[5]], 0.8)
    obs.append(p.to_object(levels=1))
    # 끈 두 가닥: 깃 아래에서 가슴으로 늘어진다
    for s_ in (1, -1):
        path = [(s_ * (0.026 + 0.004 * t), parts.Z(P, 0.540) - 0.062 * t) for t in [k / 5 for k in range(6)]]
        obs.append(parts.build_ribbon(pal, 'string', surf, path, 0.008, 0.0045, 'collar', thin=1.0))
        tip, nrm = surf.front(path[-1][0], path[-1][1] - 0.006)
        obs.append(parts.build_blob(pal, 'string_tip', tip + nrm * 0.005, (0.007, 0.006, 0.011), 'collar', surf.weights_at(tip), thin=1.0, levels=0))
    # 앞주머니: 배 위의 넓적한 띠(윗변이 살짝 좁다)
    sh = Shell(shirt)
    z0, z1 = P['hem_z'] + 0.046, P['hem_z'] + 0.092
    pts = []
    for k in range(7):
        az = -0.50 + 1.0 * k / 6
        pt, nrm = sh.at(az, (z0 + z1) / 2)
        pts.append((pt, nrm))
    obs.append(build_strip(pal, 'pocket', surf.weights_at, pts, z1 - z0, 0.004, 'shirt', thin=0.5, sink=0.004))
    return obs


def build_skirt(P, pal):
    """
    치마: 윗옷 밑단 속에서 시작해 허벅지 가운데까지 퍼지는 주름치마. 밑단은 한 겹 접혀 들어가 속이 비어 보이지 않는다.
    아랫단은 좌우 다리를 조금씩 따라가서, 다리를 벌리거나 내디딜 때 다리가 치마를 뚫지 않는다.
    """
    p = Part('skirt', pal)
    n = 24
    hz, cz = P['hem_z'], P['crotch_z']
    z_hem = cz - 0.052
    butt = lambda th: 1 + P['butt'] * 0.8 * max(0.0, math.sin(th)) ** 2

    def pleat(amp):
        return lambda th: butt(th) * (1 + amp * math.cos(th * n / 2))
    # (높이, 반폭, 반두께, 주름 깊이, 다리를 따라가는 정도, 색)
    rows = [
        (hz + 0.030, 0.118, 0.106, 0.0, 0.0, None),
        (hz + 0.004, 0.137, 0.124, 0.0, 0.0, 'shorts'),
        (hz - 0.016, 0.150, 0.137, 0.010, 0.10, 'shorts'),
        (cz + 0.012, 0.164, 0.150, 0.022, 0.30, 'shorts'),
        (cz - 0.022, 0.176, 0.162, 0.032, 0.48, 'shorts'),
        (z_hem + 0.004, 0.184, 0.170, 0.038, 0.60, 'shorts'),
        (z_hem, 0.181, 0.167, 0.038, 0.60, 'shorts'),
        (z_hem + 0.006, 0.170, 0.156, 0.034, 0.60, 'shorts_in'),
        (cz + 0.000, 0.140, 0.128, 0.0, 0.40, 'shorts_in'),
    ]
    vr = []
    for z, rx, ry, amp, follow, _ in rows:
        pts = ring((0, 0, z), rx, ry, n, shape=pleat(amp))
        vs = []
        for pt in pts:
            v = p.bm.verts.new(pt)
            sL = float(mk.smoothstep(-0.05, 0.05, np.array([pt.x]))[0])
            wd = {'hips': 1 - follow, 'upper_leg.L': follow * sL, 'upper_leg.R': follow * (1 - sL)}
            if z > hz:
                wd = {'hips': 0.75, 'spine': 0.25}
            p.set_w(v, wd)
            vs.append(v)
        vr.append(vs)
    for k in range(len(vr) - 1):
        p.bridge(vr[k], vr[k + 1], rows[k + 1][5])
    p.set_thin(vr[0], 1.0)
    p.set_thin(vr[-1] + vr[-2], 1.0)
    return p.to_object(levels=parts.det(P, 'levels'))


def build_bib(P, pal, shirt):
    """
    멜빵바지의 가슴판과 멜빵: 윗옷 겉면에서 6 mm 떠 있는 한 겹.
      허리띠(몸을 한 바퀴) + 앞 가슴판 + 어깨를 넘어가는 멜빵 두 줄 + 단추 두 개.
    가중치는 그 자리의 윗옷에서 물려받아 윗옷과 똑같이 움직인다.
    """
    sh = Shell(shirt)
    surf = sh.surf
    obs = []
    off = 0.0065
    hz = P['hem_z']
    p = Part('bib', pal)
    n = 24
    zs = [hz + 0.004, hz + 0.024, hz + 0.052]             # 허리띠(맨 아래 고리는 밑단을 덮도록 더 내린다)
    top_z = [parts.Z(P, 0.392), parts.Z(P, 0.432), parts.Z(P, 0.468)]     # 가슴판
    half = 3                                               # 가슴판의 반폭(칸 수): 앞 가운데에서 좌우로 3 칸

    def vert(az, z, extra=0.0, dz=0.0):
        pt, nrm = sh.at(az, z)
        v = p.bm.verts.new(pt + nrm * (off + extra) + UP * dz)
        p.set_w(v, surf.weights_at(pt))
        return v
    band = [[vert(2 * math.pi * i / n, z, dz=-0.014 if k == 0 else 0.0) for i in range(n)] for k, z in enumerate(zs)]
    for k in range(len(band) - 1):
        p.bridge(band[k], band[k + 1], 'shorts')
    cols = [(-half + i) % n for i in range(2 * half + 1)]
    prev = [band[-1][i] for i in cols]
    mi = pal.index('shorts')
    for z in top_z:
        # 가슴판은 위로 갈수록 살짝 좁아진다
        k_ = 1.0 - 0.16 * (z - top_z[0]) / (top_z[-1] - top_z[0] + 1e-9) - 0.06
        cur = [vert((2 * math.pi * (-half + i) / n) * k_, z) for i in range(2 * half + 1)]
        for i in range(2 * half):
            f = p.bm.faces.new([prev[i], prev[i + 1], cur[i + 1], cur[i]])
            f.material_index = mi
            f.smooth = True
        prev = cur
    ob = p.to_object(levels=1)
    # 가장자리(열린 테두리)는 윗옷 쪽으로 내려앉힌다: 옆에서 봐도 떠 보이지 않는다
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    dl = bm.verts.layers.deform.verify()
    ti = ob.vertex_groups['_thin'].index
    for v in bm.verts:
        if v.is_boundary:
            v.co -= v.normal * (off - 0.0015)
            v[dl][ti] = 0.5
    bm.to_mesh(ob.data)
    bm.free()
    obs.append(ob)
    # 멜빵: 가슴판 위 모서리에서 어깨를 넘어 등의 허리띠까지
    az_f = 2 * math.pi * (half - 0.9) / n * 0.78
    for s_ in (1, -1):
        pts = []
        zt = top_z[-1] - 0.012
        zsh = parts.Z(P, 0.516)
        for t in [k / 4 for k in range(5)]:                       # 앞: 가슴판 -> 어깨
            pt, nrm = sh.at(s_ * (az_f + 0.10 * t), zt + (zsh - zt) * t)
            pts.append((pt, nrm))
        for a in (0.30, 0.5, 0.70):                               # 어깨 위: 어깨와 목 사이를 넘어간다
            x = s_ * 0.082
            o = Vector((x, -0.2 + 0.4 * a, 0.75))
            pt, nrm = sh.toward(o, (x * 0.85, -0.02 + 0.04 * a, 0.45))
            pts.append((pt, nrm))
        for t in [k / 5 for k in range(6)]:                       # 뒤: 어깨 -> 등의 허리띠
            az = math.pi - s_ * (0.62 - 0.28 * t)
            pt, nrm = sh.at(az, zsh + (zs[-1] - 0.010 - zsh) * t)
            pts.append((pt, nrm))
        pts = [(a, b) for a, b in pts if a is not None]
        obs.append(build_strip(pal, 'strap', surf.weights_at, pts, 0.030, off + 0.002, 'shorts', thin=0.5, sink=0.001))
        # 단추
        bp, bn = sh.at(s_ * az_f, zt)
        obs.append(parts.build_blob(pal, 'button', bp + bn * (off + 0.006), (0.012, 0.012, 0.012), 'accent', surf.weights_at(bp), thin=0.6, levels=1))
    return obs
