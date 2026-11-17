"""
parts.py - 캐릭터의 각 부분을 만든다.

만드는 순서(사람이 블렌더에서 하는 일과 같다):
  1) 단면 고리를 쌓아 "거친 틀(cage)"을 만든다.  2) 면을 뽑아 가지(소매, 엄지)를 낸다.
  3) Subdivision Surface 로 매끈하게 한다.        4) 조각 붓으로 볼, 코, 배 같은 살을 붙인다.
옷의 끝단(밑단, 소매 끝, 바지 끝, 양말 목, 신발 밑창)은 색만 바꾸지 않고 실제로 한 겹 접혀 들어간 모양으로 만든다.
그 안쪽으로 팔, 다리, 목이 들어가 있어서 관절을 굽혀도 "옷 속에 몸이 있는" 것처럼 보인다.

좌표계: +X = 캐릭터의 왼쪽, -Y = 앞, +Z = 위. 키 = 1.
"""
import math
import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import meshkit as mk
from meshkit import Part, ring, frame_from

FWD = Vector((0, -1, 0))
UP = Vector((0, 0, 1))

# ---------------------------------------------------------------- 캐릭터마다 달라지는 것들
# 얼마나 촘촘하게 만들지(P['detail'] 로 덮어쓴다). 주인공은 기본값, 관중은 훨씬 성기게 만든다.
DETAIL = dict(
    levels=1,        # 세분화 횟수(0 이면 틀을 그대로 쓴다)
    head_levels=2,   # 머리의 세분화 횟수
    body_seg=16,     # 몸통 고리의 점 수(4 의 배수)
    arm_seg=8, leg_seg=10, neck_seg=8, cap_seg=20, brim_seg=10,
    folds=True,      # 옷 끝단이 안으로 접혀 들어간 속 고리까지 만들지
    thumb=True,      # 엄지를 따로 뽑을지
    shoe='full',     # 'full' = 밑창, 앞코, 끈, 발목 테가 있는 운동화 / 'simple' = 단순한 신발
    ears=True,
    lite=False,      # 가장 성긴 모델: 고리 수를 더 줄인다(낮은 화질의 관중)
)


def det(P, key):
    return P.get('detail', {}).get(key, DETAIL[key])


def Z(P, z):
    """
    아이를 기준으로 적어 둔 높이 z 를 이 캐릭터의 높이로 옮긴다.
    P['zmap'] = [(아이 높이, 이 캐릭터 높이), ...] 를 따라 구간마다 곧게 잇는다. 없으면 그대로다(아이).
    몸통, 목처럼 "고리를 쌓는" 부분은 아이의 고리 높이를 그대로 두고 이 함수만 거치면 다른 비율의 몸이 된다.
    """
    zm = P.get('zmap')
    if not zm:
        return z
    xs = [a for a, _ in zm]
    ys = [b for _, b in zm]
    if z <= xs[0]:
        return ys[0] + (z - xs[0])
    if z >= xs[-1]:
        return ys[-1] + (z - xs[-1])
    return float(np.interp(z, xs, ys))


def top_opt(P, key, default):
    return P.get('top', {}).get(key, default)


def bottom_opt(P, key, default):
    return P.get('bottom', {}).get(key, default)


def _z_ring(z, rx, ry, n, cx=0.0, cy=0.0, shape=None, power=2.0, phase=0.0):
    return ring((cx, cy, z), rx, ry, n, shape=shape, power=power, phase=phase)


# --------------------------------------------------------------------------- 윗옷(몸통 + 소매, 한 장의 이어진 면)
def build_shirt(P, pal):
    """
    윗옷. P['top'] 으로 모양을 바꾼다:
      band      소매 끝의 색 띠(아이의 체육복)            hem_band  밑단의 고무단(운동복 윗도리)
      collar_up 깃을 얼마나 더 세울지                     sleeve_r  소매 통의 굵기 배율
    """
    p = Part('shirt', pal)
    n = det(P, 'body_seg')
    folds = det(P, 'folds')
    tw, nw = P.get('torso_w', 1.0), P.get('neck_w', 1.0)
    cu = top_opt(P, 'collar_up', 0.0)
    hemc = 'collar' if top_opt(P, 'hem_band', False) else 'shirt'
    tummy = lambda th: 1 + P['tummy'] * max(0.0, -math.sin(th)) ** 2   # 앞배를 볼록하게
    hz = P['hem_z']
    # (이름, 높이, 반폭, 반두께, 앞뒤 치우침, 가중치, 이 고리 아래 구간의 색, 배를 볼록하게?)
    rows = [
        ('in0', hz + 0.026, 0.112 * tw, 0.102 * tw, 0, {'hips': 0.5, 'spine': 0.5}, None, True),               # 0 속(안 보임)
        ('in1', hz + 0.002, 0.127 * tw, 0.114 * tw, 0, {'hips': 0.6, 'spine': 0.4}, 'shirt_in', False),         # 1 밑단 안쪽 접힘
        ('hem', hz - 0.003, 0.139 * tw, 0.126 * tw, 0, {'hips': 0.6, 'spine': 0.4}, 'shirt_in', False),         # 2 밑단 바닥
        ('hem2', hz + 0.010, 0.143 * tw, 0.131 * tw, 0, {'hips': 0.55, 'spine': 0.45}, hemc, True),            # 3 밑단 바깥
    ]
    if hemc == 'collar':
        # 고무단: 3 cm 높이의 띠가 한 턱 조여 있다
        rows.append(('rib', hz + 0.034, 0.1425 * tw, 0.1305 * tw, 0, {'hips': 0.5, 'spine': 0.5}, 'collar', True))
        rows.append(('rib2', hz + 0.040, 0.146 * tw, 0.134 * tw, 0, {'hips': 0.48, 'spine': 0.52}, 'shirt', True))
    rows += [
        ('belly', Z(P, 0.345), 0.144 * tw, 0.133 * tw, -0.004, {'hips': 0.3, 'spine': 0.7}, 'shirt', True),     # 4 배
        ('rib_', Z(P, 0.395), 0.138 * tw, 0.125 * tw, -0.002, {'spine': 0.75, 'chest': 0.25}, 'shirt', True),   # 5
        ('chest', Z(P, 0.440), 0.130 * tw, 0.114 * tw, 0, {'spine': 0.3, 'chest': 0.7}, 'shirt', False),        # 6 가슴(소매 아래)
        ('sleeve', Z(P, 0.485), 0.121 * tw, 0.103 * tw, 0, {'chest': 1}, 'shirt', False),                       # 7 소매 가운데
        ('shoulder', Z(P, 0.522), 0.100 * tw, 0.087 * tw, 0, {'chest': 1}, 'shirt', False),                     # 8 어깨
        ('neck', Z(P, 0.546), 0.066 * nw, 0.062 * nw, 0, {'chest': 0.8, 'neck': 0.2}, 'shirt', False),          # 9 목 둘레
        ('col0', Z(P, 0.553), 0.060 * nw, 0.057 * nw, 0, {'chest': 0.7, 'neck': 0.3}, 'collar', False),         # 10 깃 시작
        ('col1', Z(P, 0.570) + cu, (0.057 + cu * 0.12) * nw, (0.054 + cu * 0.12) * nw, 0, {'chest': 0.6, 'neck': 0.4}, 'collar', False),   # 11 깃 위
        ('col2', Z(P, 0.572) + cu, (0.047 + cu * 0.12) * nw, (0.045 + cu * 0.12) * nw, 0, {'chest': 0.6, 'neck': 0.4}, 'collar', False),   # 12 깃 안쪽 접힘
        ('in13', Z(P, 0.556), 0.043 * nw, 0.041 * nw, 0, {'chest': 0.6, 'neck': 0.4}, 'shirt_in', False),       # 13 속
    ]
    if not folds:
        rows = [r for r in rows if r[0] not in ('in0', 'in13')]
    lite = det(P, 'lite')
    if lite:
        rows = [r for r in rows if r[0] not in ('in1', 'rib_', 'col0', 'col2')]
    names = [r[0] for r in rows]
    rings = [_z_ring(z, rx, ry, n, cy=cy, shape=tummy if belly else None) for _, z, rx, ry, cy, _, _, belly in rows]
    vr = p.loft(rings, [r[6] for r in rows[1:]], [r[5] for r in rows])
    R = {nm: vr[i] for i, nm in enumerate(names)}
    # 소매: 옆구리 위쪽의 2 x 2 칸을 열고 관을 이어 붙인다(어깨가 한 장으로 이어진다)
    a = math.radians(P['arm_down_deg'])
    sr = top_opt(P, 'sleeve_r', 1.0)
    bandc = 'collar' if top_opt(P, 'band', True) else 'shirt'
    for side, cols in ((1, [n - 1, 0]), (-1, [n // 2 - 1, n // 2])):
        sfx = '.L' if side > 0 else '.R'
        faces = p.faces_between(R['chest'], R['sleeve'], cols) + p.faces_between(R['sleeve'], R['shoulder'], cols)
        loop, base = open_patch(p, faces, Vector((side, 0, 0.35)), FWD)
        # 어깨 둘레는 가슴, 어깨뼈, 위팔이 나눠 갖는다
        for v in loop:
            p.set_w(v, {'chest': 0.45, 'shoulder' + sfx: 0.3, 'upper_arm' + sfx: 0.25})
        S = Vector((side * P['shoulder_x'], 0, P['shoulder_z']))
        d = Vector((side * math.cos(a), 0, -math.sin(a)))
        wU = {'upper_arm' + sfx: 1}
        if lite:
            # 가장 성긴 모델: 소매는 고리 세 개(어깨, 띠 시작, 끝)
            r2 = ring_after(p, loop, S + d * 0.070, d, 0.058 * sr, 0.058 * sr, FWD, base, wU, 'shirt')
            r4 = ring_after(p, r2, S + d * 0.106, d, 0.058 * sr, 0.058 * sr, FWD, base, wU, bandc)
            r5 = ring_after(p, r4, S + d * 0.105, d, 0.044 * sr, 0.044 * sr, FWD, base, wU, 'shirt_in')
            p.set_thin(r5, 1.0)
            continue
        r1 = ring_after(p, loop, S + d * 0.040, d, 0.057 * sr, 0.058 * sr, FWD, base, {'shoulder' + sfx: 0.15, 'upper_arm' + sfx: 0.85}, 'shirt')
        r2 = ring_after(p, r1, S + d * 0.082, d, 0.058 * sr, 0.058 * sr, FWD, base, wU, 'shirt')
        r3 = ring_after(p, r2, S + d * 0.098, d, 0.0595 * sr, 0.0595 * sr, FWD, base, wU, bandc)      # 파란 소매 띠
        r4 = ring_after(p, r3, S + d * 0.106, d, 0.058 * sr, 0.058 * sr, FWD, base, wU, bandc)
        r5 = ring_after(p, r4, S + d * 0.105, d, 0.046 * sr, 0.046 * sr, FWD, base, wU, 'shirt_in')      # 안쪽 접힘
        p.set_thin(r5, 1.0)
        if folds:
            r6 = ring_after(p, r5, S + d * 0.080, d, 0.043 * sr, 0.043 * sr, FWD, base, wU, 'shirt_in')
            p.set_thin(r6, 1.0)
        # 소매 끝의 띠가 안으로 접히는 모서리: 외곽선 껍데기가 접힌 면을 뚫고 나와 톱니처럼 보이지 않게 얇게 한다
        p.set_thin(r4, 0.35)
        # 겨드랑이: 소매 밑과 몸통이 만나는 오목한 곳에서는 두 면의 외곽선 껍데기가 서로를 뚫고 나온다
        for v in loop:
            if v.co.z < S.z - 0.012:
                p.set_thin([v], 1.0)
        for v in r1:
            if v.co.z < S.z + d.z * 0.040 - 0.02:
                p.set_thin([v], 0.75)
    if folds:
        p.set_thin(R['in0'] + R['in13'], 1.0)
        p.set_thin(R['in1'] + R['col2'], 0.8)
    elif not lite:
        p.set_thin(R['in1'] + R['col2'], 1.0)
    return p.to_object(levels=det(P, 'levels'))


def open_patch(p: Part, faces, measure_axis, ref):
    """면 묶음을 지우고, 그 테두리 꼭짓점을 measure_axis 둘레의 각도 순서로 돌려준다."""
    verts = []
    for f in faces:
        for v in f.verts:
            if v not in verts:
                verts.append(v)
    fset = set(faces)
    border = [v for v in verts if any(f not in fset for f in v.link_faces)]
    inner = [v for v in verts if v not in border]
    bmesh.ops.delete(p.bm, geom=faces, context='FACES')
    inner = [v for v in inner if v.is_valid]
    if inner:
        bmesh.ops.delete(p.bm, geom=inner, context='VERTS')
    return order_loop(border, measure_axis, ref)


def order_loop(verts, axis, ref, about=None):
    u, v_, t = frame_from(Vector(axis), Vector(ref))
    c = Vector((0, 0, 0))
    if about is None:
        for x in verts:
            c += x.co
        c /= len(verts)
    else:
        c = Vector(about)
    ang = [math.atan2((x.co - c).dot(v_), (x.co - c).dot(u)) for x in verts]
    order = sorted(range(len(verts)), key=lambda i: ang[i])
    n = len(verts)
    # 고르게 다시 놓을 때의 시작 각도: 원래 각도와의 어긋남 평균(비틀리지 않게)
    sx = sum(math.cos(ang[i] - 2 * math.pi * k / n) for k, i in enumerate(order))
    sy = sum(math.sin(ang[i] - 2 * math.pi * k / n) for k, i in enumerate(order))
    return [verts[i] for i in order], math.atan2(sy, sx)


def ring_after(p: Part, prev, center, axis, rx, ry, ref, base, w, color, power=2.0):
    """prev 고리와 같은 순서, 같은 시작 각도로 새 고리를 놓고 사이를 사각형으로 메운다."""
    u, v_, t = frame_from(Vector(axis), Vector(ref))
    n = len(prev)
    pts = []
    for k in range(n):
        th = base + 2 * math.pi * k / n
        cs, sn = math.cos(th), math.sin(th)
        e = 2.0 / power
        pts.append(Vector(center) + u * (math.copysign(abs(cs) ** e, cs) * rx) + v_ * (math.copysign(abs(sn) ** e, sn) * ry))
    new = p.add_ring(pts, w)
    p.bridge(prev, new, color)
    return new


# --------------------------------------------------------------------------- 팔 + 벙어리장갑 손(엄지 따로)
def arm_axes(P, side):
    """어깨, 팔꿈치, 손목, 손끝 위치와 방향. 뼈대도 같은 값을 쓴다."""
    a = math.radians(P['arm_down_deg'])
    S = Vector((side * P['shoulder_x'], 0, P['shoulder_z']))
    d = Vector((side * math.cos(a), 0, -math.sin(a)))
    fd = (d + Vector((0, -P['elbow_bend'], 0))).normalized()     # 아래팔은 살짝 앞으로 굽혀 둔다(굽는 방향을 알려 준다)
    E = S + d * P['upper_arm']
    W = E + fd * P['forearm']
    T = W + fd * P['hand']
    G = W + fd * (P['hand'] * 0.5)                                # 손바닥 가운데(쥐는 점)
    return S, d, E, fd, W, T, G


def build_arm(P, pal, side):
    """
    팔과 벙어리장갑 손. P['top']['long'] 이면 긴소매다: 손목까지 옷 색이고, 소매 끝에 도톰한 고무단이 있으며
    손은 그 안에서 나온다(소매 끝도 실제로 한 겹 접혀 들어간다).
    """
    sfx = '.L' if side > 0 else '.R'
    p = Part('arm' + sfx, pal)
    S, d, E, fd, W, T, G = arm_axes(P, side)
    U, F, H = 'upper_arm' + sfx, 'forearm' + sfx, 'hand' + sfx
    L1, L2 = P['upper_arm'], P['forearm']
    n = det(P, 'arm_seg')
    long = top_opt(P, 'long', False)

    def at(s):
        return (S + d * s, d) if s <= L1 else (E + fd * (s - L1), fd)
    hs = P['hand'] / 0.105
    ar, hr = P['arm_r'], P['hand_r']
    sl = ar * top_opt(P, 'arm_sleeve', 1.12)       # 긴소매 통의 반지름
    c0 = 'shirt' if long else 'skin'
    q = sl if long else ar
    # (팔을 따라간 거리, 반폭, 반두께, 가중치, 이 고리 앞 구간의 색)
    rows = [
        (0.050, q, q, {U: 1}, None),
        (0.105, q, q, {U: 1}, c0),
        (L1 - 0.022, q * 0.96, q * 0.96, {U: 0.85, F: 0.15}, c0),
        (L1, q * 0.98, q * 0.98, {U: 0.5, F: 0.5}, c0),
        (L1 + 0.022, q * 0.96, q * 0.96, {U: 0.15, F: 0.85}, c0),
        (L1 + L2 * 0.55, q * 0.92, q * 0.92, {F: 1}, c0),
    ]
    if long:
        rows += [
            (L1 + L2 - 0.046, sl * 0.90, sl * 0.90, {F: 1}, 'shirt'),
            (L1 + L2 - 0.040, sl * 1.00, sl * 1.00, {F: 1}, 'collar'),        # 소매 끝 고무단
            (L1 + L2 - 0.018, sl * 0.98, sl * 0.98, {F: 0.8, H: 0.2}, 'collar'),
            (L1 + L2 - 0.014, ar * 0.90, ar * 0.88, {F: 0.8, H: 0.2}, 'collar'),     # 고무단의 끝면
            (L1 + L2 - 0.030, ar * 0.84, ar * 0.82, {F: 0.8, H: 0.2}, 'shirt_in'),
        ]
    n_sleeve = len(rows)
    rows += [
        (L1 + L2 - 0.018, ar * 0.84, ar * 0.82, {F: 0.75, H: 0.25}, 'skin'),
        (L1 + L2, ar * 0.86, ar * 0.80, {F: 0.35, H: 0.65}, 'skin'),
        (L1 + L2 + 0.022 * hs, hr * 0.88, hr * 0.68, {H: 1}, 'skin'),      # 손바닥 시작
        (L1 + L2 + 0.052 * hs, hr * 1.00, hr * 0.74, {H: 1}, 'skin'),      # 손바닥 가운데
        (L1 + L2 + 0.082 * hs, hr * 0.90, hr * 0.70, {H: 1}, 'skin'),
        (L1 + L2 + 0.100 * hs, hr * 0.58, hr * 0.50, {H: 1}, 'skin'),      # 손끝
    ]
    if det(P, 'lite') and not long:
        # 가장 성긴 모델: 어깨, 팔꿈치, 아래팔, 손목, 손바닥, 손끝만 남긴다
        rows = [rows[i] for i in (0, 3, 5, 7, 9, 10, 11)]
    rings = []
    for s, rx, ry, _, _ in rows:
        c, ax = at(s)
        u, v, t = frame_from(ax, FWD)
        # 손은 살짝 앞쪽으로 치우친다(엄지 쪽이 도톰)
        rings.append(ring(c, rx, ry, n, u=u, v=v))
    vr = p.loft(rings, [r[4] for r in rows[1:]], [r[3] for r in rows], flip=side < 0)
    # 소매 속에 들어가 있는 팔: 외곽선을 없앤다(소매를 뚫고 점점이 비치지 않게). 소매 끝에서 서서히 굵어진다.
    p.set_thin(vr[0], 1.0)
    if long:
        p.set_thin(vr[n_sleeve - 2] + vr[n_sleeve - 1] + vr[n_sleeve], 1.0)
        p.set_thin(vr[n_sleeve - 3], 0.4)
    elif not det(P, 'lite'):
        p.set_thin(vr[1], 0.55)
    c, ax = at(rows[-1][0])
    p.cap(vr[-1], 'skin', offset=ax * 0.012, flip=side > 0)
    if not det(P, 'thumb'):
        return p.to_object(levels=det(P, 'levels'))
    # 엄지: 손바닥 앞쪽의 두 칸을 뽑아낸다
    palm0, palm1 = vr[-4], vr[-3]
    faces = p.faces_between(palm0, palm1, [n - 1, 0])
    u, v, t = frame_from(fd, FWD)
    tax = (u * 0.62 + fd * 0.78).normalized()
    # 테두리의 순서는 그 면이 바라보는 방향(u)에서 재야 틀리지 않는다. 엄지가 뻗는 방향(tax)은 그다음 고리에만 쓴다.
    loop, base = open_patch(p, faces, u, fd)
    pc = W + fd * (0.036 * hs)
    wT = {'thumb' + sfx: 1}
    for x in loop:
        p.set_w(x, {H: 0.7, 'thumb' + sfx: 0.3})
    tr = hr * 0.44
    t1 = ring_after(p, loop, pc + u * (hr * 0.90) + tax * 0.006, tax, tr, tr * 0.9, fd, base, wT, 'skin')
    t2 = ring_after(p, t1, pc + u * (hr * 0.92) + tax * 0.026, tax, tr * 0.9, tr * 0.82, fd, base, wT, 'skin')
    tc = p.cap(t2, 'skin', offset=tax * 0.012)
    # 엄지와 손바닥 사이의 좁은 틈에서는 외곽선이 서로 파고들어 지저분해진다: 그 둘레만 외곽선을 얇게 한다
    # 뿌리 둘레의 손바닥 면도 함께 얇게 해야 오목한 골에서 껍데기가 삐져나오지 않는다.
    for k in (n - 2, n - 1, 0, 1):
        p.set_thin([palm0[k], palm1[k]], 0.75)
    p.set_thin([vr[-5][n - 1], vr[-5][0], vr[-2][n - 1], vr[-2][0]], 0.5)
    p.set_thin(loop, 1.0)
    p.set_thin(t1, 1.0)
    p.set_thin(t2 + [tc], 0.55)
    return p.to_object(levels=det(P, 'levels'))


# --------------------------------------------------------------------------- 다리 + 양말(양말 목이 실제로 접혀 있다)
def build_leg(P, pal, side):
    """다리와 양말. P['bottom']['long'] 이면 긴바지다: 발목까지 바지 색이고, 바짓단이 실제로 한 겹 접혀 있다."""
    sfx = '.L' if side > 0 else '.R'
    p = Part('leg' + sfx, pal)
    x = side * P['leg_x']
    UL, LL, FT = 'upper_leg' + sfx, 'lower_leg' + sfx, 'foot' + sfx
    kz, az = P['knee_z'], P['ankle_z']
    sz = P['sock_z']
    lw = P.get('leg_w', 1.0)
    long = bottom_opt(P, 'long', False)
    top = [
        (Z(P, 0.246), 0.050, 0, {'hips': 0.5, UL: 0.5}, 'skin'),
        (Z(P, 0.214), 0.0535, 0, {UL: 1}, 'skin'),
        (kz + 0.024, 0.0515, -0.002, {UL: 0.85, LL: 0.15}, 'skin'),
        (kz, 0.050, -0.005, {UL: 0.5, LL: 0.5}, 'skin'),           # 무릎(살짝 앞으로)
        (kz - 0.022, 0.0485, -0.003, {UL: 0.15, LL: 0.85}, 'skin'),
    ]
    if long:
        tr = bottom_opt(P, 'leg_r', 1.16)       # 바지통의 굵기 배율
        top = [(z, r * tr, cy, w, 'shorts') for z, r, cy, w, _ in top]
        rows = top + [
            ((kz + az) / 2, 0.0475 * tr, 0, {LL: 1}, 'shorts'),
            (az + 0.034, 0.0470 * tr, 0, {LL: 1}, 'shorts'),
            (az + 0.022, 0.0490 * tr, 0, {LL: 1}, 'shorts'),             # 바짓단
            (az + 0.018, 0.0460 * tr, 0, {LL: 1}, 'shorts_in'),          # 안으로 접힘
            (az + 0.034, 0.0440, 0, {LL: 1}, 'shorts_in'),
            (az + 0.030, 0.0420, 0, {LL: 0.8, FT: 0.2}, 'sock'),         # 바지 속의 발목(양말)
            (az, 0.0440, 0, {LL: 0.5, FT: 0.5}, 'sock'),
            (az - 0.03, 0.044, 0, {FT: 1}, 'sock'),
        ]
    else:
        rows = top + [
            (sz + 0.012, 0.0465, 0, {LL: 1}, 'skin'),
            (sz + 0.002, 0.0450, 0, {LL: 1}, 'sock'),                  # 양말 속으로 들어가는 다리
            (sz + 0.001, 0.0515, 0, {LL: 1}, 'sock'),                  # 양말 목 윗면
            (sz - 0.005, 0.0550, 0, {LL: 1}, 'sock'),                  # 도톰한 접힘
            (sz - 0.016, 0.0540, 0, {LL: 1}, 'sock'),
            (sz - 0.021, 0.0505, 0, {LL: 1}, 'sock'),
            (az, 0.0485, 0, {LL: 0.5, FT: 0.5}, 'sock'),
            (az - 0.03, 0.046, 0, {FT: 1}, 'sock'),
        ]
        if not det(P, 'folds'):
            # 성긴 모델: 양말 목의 접힘을 한 턱으로 줄인다
            rows = [r for i, r in enumerate(rows) if i not in (len(top) + 1, len(top) + 3)]
        if det(P, 'lite'):
            rows = [r for i, r in enumerate(rows) if i not in (2, 4, len(top) + 3)]
    rings = [_z_ring(z, r * lw, r * lw, det(P, 'leg_seg'), cx=x, cy=cy) for z, r, cy, _, _ in rows]
    rings.reverse()
    rows.reverse()
    lr = p.loft(rings, [r[4] for r in rows[1:]], [r[3] for r in rows])
    # 바지 속에 들어가 있는 허벅지 위쪽은 외곽선을 없앤다
    p.set_thin(lr[-1], 1.0)
    p.set_thin(lr[-2], 0.0 if long else 0.8)
    if long:
        p.set_thin(lr[2] + lr[3] + lr[4], 1.0)
    return p.to_object(levels=det(P, 'levels'))


# --------------------------------------------------------------------------- 반바지(엉덩이에서 두 가랑이로 갈라진다)
def build_shorts(P, pal):
    p = Part('shorts', pal)
    n = det(P, 'body_seg')
    folds = det(P, 'folds')
    tw, lw = P.get('torso_w', 1.0), P.get('leg_w', 1.0)
    long = bottom_opt(P, 'long', False)
    butt = lambda th: 1 + P['butt'] * max(0.0, math.sin(th)) ** 2    # 뒤쪽(엉덩이)을 통통하게
    hz = P['hem_z']
    cz = P['crotch_z']
    rows = [
        (hz + 0.045, 0.110, 0.098, {'hips': 0.6, 'spine': 0.4}),
        (hz + 0.004, 0.133, 0.120, {'hips': 1}),
        (cz + 0.050, 0.1405, 0.129, {'hips': 1}),
        (cz + 0.024, 0.139, 0.126, None),
        (cz + 0.006, 0.134, 0.121, None),
    ]
    lite = det(P, 'lite')
    if lite:
        del rows[3]
    if not lite and rows[2][0] > rows[1][0] - 0.006:
        # 몸통이 짧은 비율에서는 가운데 고리가 윗고리를 넘지 않게 사이에 둔다
        rows[2] = ((rows[1][0] + rows[3][0]) / 2,) + rows[2][1:]
    vr = []
    for z, rx, ry, w in rows:
        pts = _z_ring(z, rx * tw, ry * tw, n, shape=butt if z < cz + 0.058 else None)
        vs = []
        for i, pt in enumerate(pts):
            v = p.bm.verts.new(pt)
            if w is None:
                # 아래쪽 고리는 좌우 다리가 조금씩 끌고 간다
                k = 0.25 if z > cz + 0.015 else 0.45
                sL = float(mk.smoothstep(-0.03, 0.03, np.array([pt.x]))[0])
                p.set_w(v, {'hips': 1 - k, 'upper_leg.L': k * sL, 'upper_leg.R': k * (1 - sL)})
            else:
                p.set_w(v, w)
            vs.append(v)
        vr.append(vs)
    for k in range(len(vr) - 1):
        p.bridge(vr[k], vr[k + 1], 'shorts')
    # 가랑이: 앞 가운데와 뒤 가운데를 잇는 점 하나
    bottom = vr[-1]
    mid = p.bm.verts.new((0, 0, cz - 0.004))
    p.set_w(mid, {'hips': 0.7, 'upper_leg.L': 0.15, 'upper_leg.R': 0.15})
    q, h = n // 4, n // 2
    tr = bottom_opt(P, 'leg_r', 1.16) if long else 1.0
    for side in (1, -1):
        sfx = '.L' if side > 0 else '.R'
        UL = 'upper_leg' + sfx
        idx = [(3 * q + i) % n for i in range(h + 1)] if side > 0 else [q + i for i in range(h + 1)]
        loopv = [bottom[i] for i in idx] + [mid]
        cx = side * (P['leg_x'] + 0.004)
        down = Vector((0, 0, -1))
        loop, base = order_loop(loopv, down, FWD, about=(cx, 0, cz))
        if lite:
            r3 = ring_after(p, loop, (cx, 0, cz - 0.031), down, 0.0660 * lw, 0.068 * lw, FWD, base, {'hips': 0.2, UL: 0.8}, 'shorts')
            r4 = ring_after(p, r3, (cx, 0, cz - 0.0305), down, 0.0525 * lw, 0.0525 * lw, FWD, base, {'hips': 0.15, UL: 0.85}, 'shorts_in')
            p.set_thin(r4, 1.0)
            continue
        r1 = ring_after(p, loop, (cx, 0, cz - 0.012), down, 0.0665 * lw, 0.069 * lw, FWD, base, {'hips': 0.4, UL: 0.6}, 'shorts')
        r2 = ring_after(p, r1, (cx, 0, cz - 0.024), down, 0.0670 * lw, 0.069 * lw, FWD, base, {'hips': 0.2, UL: 0.8}, 'shorts')
        if long:
            # 긴바지: 가랑이 아래에서 바지통과 같은 굵기로 좁아지며 다리 통 속으로 들어간다(이음매가 보이지 않는다)
            r3 = ring_after(p, r2, (cx, 0, cz - 0.040), down, 0.0545 * tr * lw, 0.0555 * tr * lw, FWD, base, {'hips': 0.1, UL: 0.9}, 'shorts')
            r4 = ring_after(p, r3, (cx, 0, cz - 0.050), down, 0.050 * tr * lw, 0.050 * tr * lw, FWD, base, {UL: 1}, 'shorts')
            p.set_thin(r3, 0.6)
            p.set_thin(r4, 1.0)
            continue
        r3 = ring_after(p, r2, (cx, 0, cz - 0.031), down, 0.0655 * lw, 0.067 * lw, FWD, base, {'hips': 0.15, UL: 0.85}, 'shorts')
        r4 = ring_after(p, r3, (cx, 0, cz - 0.0305), down, 0.0535 * lw, 0.0535 * lw, FWD, base, {'hips': 0.15, UL: 0.85}, 'shorts_in')
        p.set_thin(r4, 0.8 if folds else 1.0)
        if folds:
            r5 = ring_after(p, r4, (cx, 0, cz - 0.008), down, 0.051 * lw, 0.051 * lw, FWD, base, {'hips': 0.2, UL: 0.8}, 'shorts_in')
            p.set_thin(r5, 1.0)
    p.set_thin(vr[0], 1.0)
    return p.to_object(levels=det(P, 'levels'))


# --------------------------------------------------------------------------- 머리(사각형 공 + 조각) / 목 / 귀
def head_center(P):
    return np.array([0.0, 0.0, P['head_z']])


def build_head(P, pal):
    p = Part('head', pal)
    c = head_center(P)
    R = np.array(P['head_r'])
    mk.quad_sphere(p, c, R, 4, 'skin', {'head': 1})
    ob = p.to_object(levels=det(P, 'head_levels'))
    co = mk.get_co(ob)
    # 세분화하면 살짝 쪼그라들므로 타원체 위로 정확히 다시 올려놓는다
    d = (co - c) / R
    d /= np.linalg.norm(d, axis=1)[:, None]
    co = c + d * R
    co = sculpt_head(co, P)
    mk.set_co(ob, co)
    return ob


def cull_hidden_head(head_ob, P):
    """머리카락과 모자에 완전히 덮인 머리 면은 지운다(어차피 안 보이고, 삼각형만 차지한다)."""
    co = mk.get_co(head_ob)
    hidden = hair_cover(co, P)
    if P.get('cap', True):
        cc, cu, cv, cn, crx, cry, chD = cap_frame(P)
        hidden = hidden | ((co - cc) @ cn > 0.016)
    bm = bmesh.new()
    bm.from_mesh(head_ob.data)
    bm.verts.ensure_lookup_table()
    dead = [fc for fc in bm.faces if all(hidden[v.index] for v in fc.verts)]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bm.to_mesh(head_ob.data)
    bm.free()
    head_ob.data.update()


def shape_head(co, P):
    """머리의 큰 모양(주먹밥 모양 + 평평한 얼굴 면). 머리카락도 같은 함수를 지나가서 머리에 딱 붙는다."""
    c = head_center(P)
    R = np.array(P['head_r'])
    rel = co - c
    dz = rel[:, 2] / R[2]
    wide = 1 + P['jaw_wide'] * mk.smoothstep(0.1, -0.7, dz) - 0.03 * mk.smoothstep(0.3, 1.0, dz)
    rel[:, 0] *= wide
    rel[:, 1] *= 1 + (wide - 1) * 0.5
    front = mk.smoothstep(0.0, 1.0, -rel[:, 1] / R[1])
    rel[:, 1] *= 1 - P['face_flat'] * front
    return c + rel


def face_point(P, px, py, cell=(256.0, 192.0)):
    """얼굴 그림 한 칸(256 x 192)의 화소 좌표 -> 머리 타원체 위의 점(조각하기 전). face_uv 의 역함수."""
    c = head_center(P) + np.array([0, 0, P['face_drop']])
    R = np.array(P['head_r'])
    az = (px / cell[0] - 0.5) * 2 * P['face_half_az']
    polar = P['face_polar0'] + (py / cell[1]) * P['face_polar_span']
    d = np.array([math.sin(az) * math.sin(polar), -math.cos(az) * math.sin(polar), math.cos(polar)])
    # 중심이 face_drop 만큼 내려가 있으므로, 그 중심에서 d 방향으로 나가 타원체와 만나는 점을 푼다
    o = np.array([0, 0, P['face_drop']]) / R
    dn = d / R
    a_, b_, c_ = dn @ dn, 2 * (o @ dn), o @ o - 1
    t = (-b_ + math.sqrt(max(0.0, b_ * b_ - 4 * a_ * c_))) / (2 * a_)
    return c + d * t


def sculpt_head(co, P):
    """머리 모양 다듬기: 큰 모양을 잡은 뒤 조각 붓으로 볼, 코, 턱, 눈자리를 만든다."""
    c = head_center(P)
    R = np.array(P['head_r'])
    co = shape_head(co, P)
    rel = co - c
    n = rel / np.linalg.norm(rel, axis=1)[:, None]
    # 3) 볼: 양옆 아래를 부풀린다
    cz = P.get('cheek_z', -0.068)
    for s in (-1, 1):
        co = mk.brush_inflate(co, n, c + np.array([s * 0.112, -0.150, cz]), P.get('cheek_r', 0.085), P['cheek'])
    # 4) 코: 작은 콧등
    co = mk.brush_inflate(co, n, c + np.array([0, -R[1] * (1 - P['face_flat']), P['nose_z']]), P.get('nose_r', 0.034), P['nose'])
    # 5) 턱 밑을 살짝 올려 목과 구분한다
    co = mk.brush_grab(co, c + np.array([0, -0.06, -R[2]]), 0.11, (0, 0, 0.008))
    # 6) 눈자리: 눈 그림이 놓일 곳을 아주 얕게 눌러, 이마와 볼 사이에 눈이 "들어앉게" 한다
    if P.get('eye_socket', 0) > 0:
        ex, ey = P['eye_px']
        for s in (-1, 1):
            pt = shape_head(face_point(P, 128 + s * ex, ey).reshape(1, 3), P)[0]
            co = mk.brush_inflate(co, n, pt, P.get('eye_socket_r', 0.055), -P['eye_socket'])
    # 7) 입자리: 입꼬리 양옆을 살짝 눌러 볼이 도톰해 보이게 한다
    if P.get('mouth_dimple', 0) > 0:
        mx, my_ = P['mouth_px']
        pt = shape_head(face_point(P, 128, my_).reshape(1, 3), P)[0]
        co = mk.brush_inflate(co, n, pt, 0.04, -P['mouth_dimple'])
    return co


def face_marks(P):
    """조각한 볼, 코가 얼굴 그림(256 x 192 칸)의 어디에 오는지(그림을 그릴 때 맞추려고 알려 준다)."""
    c = head_center(P)
    R = np.array(P['head_r'])
    pts = {
        '볼': shape_head((c + np.array([0.112, -0.150, P.get('cheek_z', -0.068)])).reshape(1, 3), P),
        '코': (c + np.array([0, -R[1] * (1 - P['face_flat']), P['nose_z']])).reshape(1, 3),
    }
    out = {}
    for k, pt in pts.items():
        u, v = face_uv(pt, P)
        out[k] = (round(float(u[0]) * 256 - 128, 1), round((1 - float(v[0])) * 192, 1))
    return out


def build_neck(P, pal):
    p = Part('neck', pal)
    nw = P.get('neck_w', 1.0)
    rows = [(0.535, 0.046, {'chest': 0.5, 'neck': 0.5}), (0.560, 0.047, {'neck': 1}), (0.590, 0.050, {'neck': 0.4, 'head': 0.6}), (0.615, 0.052, {'head': 1})]
    rings = [_z_ring(Z(P, z), r * nw, r * 0.95 * nw, det(P, 'neck_seg')) for z, r, _ in rows]
    nr = p.loft(rings, 'skin_shade', [r[2] for r in rows])
    p.set_thin(nr[0] + nr[-1], 1.0)        # 깃 속, 머리 속
    return p.to_object(levels=det(P, 'levels'))


def build_ears(P, pal):
    obs = []
    if not det(P, 'ears'):
        return obs
    c = head_center(P)
    for s in (-1, 1):
        p = Part('ear', pal)
        ec = (s * (P['head_r'][0] * (1 + P['jaw_wide'] * 0.35) - 0.004), 0.018, c[2] - 0.040)
        mk.quad_sphere(p, ec, (0.024, 0.034, 0.044), 2, 'skin', {'head': 1})
        # 귓바퀴 안쪽: 바깥을 보는 면을 살짝 어둡게 칠하고 안으로 민다
        for f in p.bm.faces:
            cx = sum((v.co.x for v in f.verts)) / 4 - ec[0]
            if cx * s > 0.012:
                f.material_index = pal.index('skin_shade')
        ob = p.to_object(levels=det(P, 'levels'))
        co = mk.get_co(ob)
        co = mk.brush_grab(co, (ec[0] + s * 0.024, ec[1] - 0.004, ec[2]), 0.03, (-s * 0.010, 0, 0))
        mk.set_co(ob, co)
        obs.append(ob)
    return obs


def face_uv(co, P):
    """
    머리 꼭짓점 -> 얼굴 표정 그림(kid.ts 의 표정 묶음 한 칸)의 UV.
    kid.ts 의 얼굴 조각과 같은 방식(머리 중심에서 본 방위각, 고도각)이라 같은 그림을 그대로 붙일 수 있다.
      u: 좌우 +-face_half_az 라디안,  v: 위아래 face_v_span 범위.
    """
    c = head_center(P) + np.array([0, 0, P['face_drop']])
    R = np.array(P['head_r'])
    d = (co - c) / R
    d /= np.linalg.norm(d, axis=1)[:, None]
    az = np.arctan2(d[:, 0], -d[:, 1])            # 앞(-Y)이 0, 캐릭터의 왼쪽(+X)이 +
    polar = np.arccos(np.clip(d[:, 2], -1, 1))    # 정수리가 0
    half = P['face_half_az']
    u = 0.5 + az / (2 * half)                     # 그림의 오른쪽 = 캐릭터의 왼쪽(보는 사람 기준 오른쪽)
    v = 1 - (polar - P['face_polar0']) / P['face_polar_span']
    return u, v


def build_face_decal(head_ob, P):
    """머리 앞면을 한 겹 떠서 얼굴 그림을 붙일 판을 만든다(머리의 굴곡을 그대로 따른다)."""
    me = head_ob.data
    co = mk.get_co(head_ob)
    nor = mk.get_normals(head_ob)
    u, v = face_uv(co, P)
    c = head_center(P)
    ok = (u > 0.0) & (u < 1.0) & (v > 0.0) & (v < 1.0) & (co[:, 1] < c[1])
    verts, faces, uvs, remap = [], [], [], {}
    for poly in me.polygons:
        if all(ok[i] for i in poly.vertices):
            f = []
            for i in poly.vertices:
                if i not in remap:
                    remap[i] = len(verts)
                    verts.append(co[i] + nor[i] * 0.0022)
                    uvs.append((u[i], v[i]))
                f.append(remap[i])
            faces.append(f)
    m = bpy.data.meshes.new('face')
    m.from_pydata([tuple(x) for x in verts], [], faces)
    m.update()
    uvl = m.uv_layers.new(name='UVMap')
    for poly in m.polygons:
        poly.use_smooth = True
        for li in poly.loop_indices:
            uvl.data[li].uv = uvs[m.loops[li].vertex_index]
    ob = bpy.data.objects.new('face', m)
    bpy.context.collection.objects.link(ob)
    ob.vertex_groups.new(name='head').add(list(range(len(verts))), 1.0, 'REPLACE')
    return ob


# --------------------------------------------------------------------------- 모자
def cap_frame(P):
    """
    모자의 자리. 뒤로 젖힌 평면으로 머리(+ 머리카락 두께)를 자른 단면이 곧 모자 테다.
    그래서 테가 이마와 뒤통수에 딱 맞게 얹히고, 앞머리는 테 바로 밑에서 나온다.
    돌려주는 값: 테 중심, 좌우 축 u, 뒤쪽 축 v, 위쪽 축 n, 테 반지름(rx, ry), 돔 높이
    """
    c = head_center(P)
    R = np.array(P['head_r']) + P['cap_margin']
    R[0] *= 1 + P['jaw_wide'] * 0.25
    t = P['cap_tilt']
    h0 = P['cap_h0']
    n = np.array([0, math.sin(t), math.cos(t)])       # 모자의 위쪽(뒤로 젖혀 쓴다)
    u = np.array([1.0, 0, 0])
    v = np.array([0, math.cos(t), -math.sin(t)])      # 테 평면 안에서 뒤쪽
    A = v[1] ** 2 / R[1] ** 2 + v[2] ** 2 / R[2] ** 2
    B = 2 * h0 * (n[1] * v[1] / R[1] ** 2 + n[2] * v[2] / R[2] ** 2)
    C = h0 * h0 * (n[1] ** 2 / R[1] ** 2 + n[2] ** 2 / R[2] ** 2) - 1
    vc = -B / (2 * A)
    ry = math.sqrt(B * B - 4 * A * C) / (2 * A)
    py, pz = h0 * n[1] + vc * v[1], h0 * n[2] + vc * v[2]
    rx = R[0] * math.sqrt(max(0.0, 1 - py * py / R[1] ** 2 - pz * pz / R[2] ** 2))
    center = c + n * h0 + v * vc
    hD = math.sqrt((n[1] * R[1]) ** 2 + (n[2] * R[2]) ** 2) - h0 + P['cap_puff']
    return center, u, v, n, rx, ry, hD


def build_cap(P, pal):
    p = Part('cap', pal)
    c, u, v, nrm, rx, ry, hD = cap_frame(P)
    C, U, V, N = Vector(c), Vector(u), Vector(v), Vector(nrm)
    n = det(P, 'cap_seg')
    w = {P.get('cap_bone', 'cap'): 1}

    def rg(h, k):
        return ring(C + N * h, rx * k, ry * k, n, u=U, v=V)
    pw = P['cap_box']
    rows = [(0.030, 0.90), (0.0, 0.93), (-0.005, 0.995), (0.006, 1.0), (0.030, 1.0), (0.036, 0.992)]
    band_top = 0.036
    lite = det(P, 'lite')
    colors = ['cap_under', 'cap_under', 'cap_band', 'cap_band', 'cap_band'] + ['cap'] * 5
    dome = (0.22, 0.45, 0.66, 0.83, 0.94)
    if lite:
        rows = [rows[1], rows[2], rows[5]]
        colors = ['cap_band', 'cap_band', 'cap', 'cap', 'cap']
        dome = (0.38, 0.72, 0.93)
    for t in dome:
        h = band_top + (hD - band_top) * t
        rows.append((h, 0.992 * (1 - t ** pw) ** (1 / pw)))
    rings = [rg(h, k) for h, k in rows]
    vr = p.loft(rings, colors, [w] * len(rows))
    p.cap(vr[-1], 'cap', offset=N * (hD - rows[-1][0]) * 0.9)
    # 꼭지 단추
    mk.quad_sphere(p, C + N * (hD + 0.002), (0.024, 0.024, 0.013), 1 if det(P, 'levels') == 0 else 2, 'cap_button', w)
    # 챙: 앞쪽으로 뻗은 초승달 모양의 도톰한 판
    phim = math.radians(P['brim_span_deg'])
    st = det(P, 'brim_seg')
    L = P['brim_len']
    stations = []
    for i in range(st + 1):
        phi = -phim + 2 * phim * i / st
        prof = max(0.0, math.cos(phi / phim * math.pi / 2)) ** 0.7
        ln = max(0.012, L * prof)
        dirv = U * math.sin(phi) * rx + (-V) * math.cos(phi) * ry     # 테 위의 점(중심 기준)
        out = dirv.normalized()
        th = 0.013 * (0.5 + 0.5 * prof)
        slope = P['brim_slope']
        def pt(k, hh):
            # k: 0(모자 속) ~ 1(챙 끝)
            base = C + dirv * 0.95
            return base + out * (0.05 * dirv.length + ln) * k + N * (hh - slope * ln * k * k)
        stations.append([pt(0, 0.012), pt(0.5, 0.010), pt(0.93, 0.006), pt(1.0, 0.0), pt(0.93, -th * 0.9), pt(0.5, -th), pt(0, -th + 0.004)])
    col = ['cap', 'cap', 'cap', 'cap_under', 'cap_under', 'cap_under', 'cap_under']
    vs = [p.add_ring(s, w) for s in stations]
    for k in range(len(vs) - 1):
        fs = p.bridge(vs[k], vs[k + 1], 'cap')
        for i, f in enumerate(fs):
            f.material_index = pal.index(col[i])
    for end in (vs[0], vs[-1]):
        f = p.bm.faces.new(end)
        f.material_index = pal.index('cap')
        f.smooth = True
    return p.to_object(levels=det(P, 'levels'))


# --------------------------------------------------------------------------- 머리카락(거리 함수로 빚는다)
def _lobes(az, start, width):
    """가닥 무늬: 0(가닥 사이의 골) ~ 1(가닥 한가운데). 골은 뾰족하고 가닥은 둥글다."""
    frac = np.mod((az - start) / width, 1.0)
    return np.sin(np.pi * frac) ** 0.6


def hairline(az, P):
    """
    머리카락이 어디까지 내려오는지(머리 중심 높이 기준). az: 방위각(앞 = 0, 캐릭터의 왼쪽 = +, 뒤 = +-pi).
    앞머리는 둥근 가닥 몇 개가 내려오고(가닥 사이는 위로 뾰족한 골), 귀 앞은 뾰족하게 내려오고,
    귀 위는 드러나며, 뒤는 목덜미까지 내려온다.
    """
    az = np.asarray(az, dtype=np.float64)
    a = np.abs(az)
    H = P['hairline']
    # 앞머리: 가닥마다 길이를 조금씩 다르게(비대칭이 귀엽다)
    vary = 1 + H['fringe_vary'] * np.sin(az * 2.3 + 1.1)
    fringe = H['fringe_z'] + H['fringe_wave'] * (1 - _lobes(az, H['fringe_start'], H['fringe_width']) * vary)
    burn = H['burn_z'] + (H['fringe_z'] + H['fringe_wave'] - H['burn_z']) * np.clip(np.abs(a - H['burn_az']) / H['burn_w'], 0, 1) ** 1.4
    ear = H['ear_z']
    nape = H['nape_z'] + H['nape_wave'] * (1 - _lobes(az, 0.0, H['nape_width']))
    z = fringe
    z = z + (burn - z) * mk.smoothstep(H['burn_az'] - H['burn_w'] - 0.10, H['burn_az'] - H['burn_w'] * 0.5, a)
    # 귀 위로 넘어가는 구간. 단발처럼 옆머리가 계속 길게 내려오는 머리는 ear_from, ear_to 를 앞당겨 귀 앞머리 뒤의 골을 없앤다.
    z = z + (ear - z) * mk.smoothstep(H.get('ear_from', H['burn_az'] + H['burn_w'] * 0.4), H.get('ear_to', H['burn_az'] + H['burn_w'] + 0.06), a)
    z = z + (nape - z) * mk.smoothstep(H['ear_end'], H['ear_end'] + 0.40, a)
    return z


def hair_thickness(az, P):
    """방위각마다의 머리카락 두께. 가닥 한가운데가 도톰하고 가닥 사이는 얇아서 덩어리감이 생긴다."""
    az = np.asarray(az, dtype=np.float64)
    a = np.abs(az)
    H = P['hairline']
    front = 1 - mk.smoothstep(0.9, 1.2, a)
    back = mk.smoothstep(H['ear_end'], H['ear_end'] + 0.4, a)
    lob = _lobes(az, H['fringe_start'], H['fringe_width']) * front + _lobes(az, 0.0, H['nape_width']) * back + (1 - front - back) * 0.5
    return H['thick'] + H['chunk'] * (lob - 0.5) * 2 + H['fringe_puff'] * front


def hair_point(az, z, th, P):
    """방위각 az, 높이 z 에서 머리 표면보다 th 만큼 바깥인 점(머리의 큰 모양을 따라간다)."""
    c = head_center(P)
    R = np.array(P['head_r'])
    k = np.sqrt(np.maximum(1e-4, 1 - ((z - c[2]) / (R[2] + th)) ** 2))
    pt = np.stack([np.sin(az) * (R[0] + th) * k, -np.cos(az) * (R[1] + th) * k, z - c[2]], axis=-1) + c
    return shape_head(pt.reshape(-1, 3), P).reshape(pt.shape)


def hair_cover(co, P):
    """이 점이 머리카락에 덮여 있는가(머리의 안 보이는 면을 지울 때 쓴다)."""
    c = head_center(P)
    rel = co - c
    az = np.arctan2(rel[:, 0], -rel[:, 1])
    return rel[:, 2] > hairline(az, P) + 0.028


def build_hair(P, pal):
    """
    머리카락: 머리 둘레를 따라 세로 띠를 세워 만든 껍데기.
    맨 아래 고리가 머리선(hairline)이라서 앞머리 끝, 귀 앞머리, 목덜미가 톱니 없이 또렷하다.
    끝은 두피 쪽으로 말려 들어가(undercut) 실제 두께가 보이고, 그 밑에 그늘이 진다.
    모자를 쓰면(P['cap']) 모자 테 속에서 끝나고, 안 쓰면 정수리까지 덮어 닫는다.
    """
    p = Part('hair', pal)
    H = P['hairline']
    N = P['hair_cols']
    c = head_center(P)
    capped = P.get('cap', True)
    az = -math.pi + 2 * math.pi * (np.arange(N) + 0.5) / N
    z_low = c[2] + hairline(az, P)
    th = hair_thickness(az, P)
    z_top = np.empty(N)
    if capped:
        cc, cu, cv, cn, crx, cry, chD = cap_frame(P)
        # 모자 속으로 숨는 높이: 그 방위에서 모자 테 평면보다 조금 위
        for i in range(N):
            lo, hi = c[2] - 0.12, c[2] + P['head_r'][2] * 0.98
            for _ in range(24):
                mid = (lo + hi) / 2
                pt = hair_point(az[i], np.array(mid), th[i], P)
                if (pt - cc) @ cn < 0.018:
                    lo = mid
                else:
                    hi = mid
            z_top[i] = max(lo, z_low[i] + 0.012)
        # (머리선에서 위로 간 비율, 두께 배율) : 아래 두 줄이 도톰하게 말린 끝을 만든다
        rows = [(None, 0.0), (0.0, 0.80), (0.10, 1.0), (0.30, 1.0), (0.58, 1.0), (0.82, 0.96), (1.0, 0.90)]
        if det(P, 'lite'):
            rows = [r for i, r in enumerate(rows) if i not in (3, 5)]
    else:
        # 정수리 바로 밑까지 올라간 뒤 가운데 점 하나로 닫는다. 끝이 바깥으로 뻗치는 정도(flare)는 단발머리용.
        z_top[:] = c[2] + (P['head_r'][2] + th * 0.9) * 0.975
        fl = H.get('flare', 0.0)
        rows = [(None, 0.0), (0.0, 0.80 + fl), (0.08, 1.0 + fl), (0.24, 1.0 + fl * 0.45), (0.44, 1.0), (0.64, 1.0), (0.80, 1.0), (0.92, 1.0), (1.0, 1.0)]
        if det(P, 'levels') == 0:
            rows = [r for i, r in enumerate(rows) if i not in ((3, 5, 7) if det(P, 'lite') else (3, 6))]
        elif P.get('hair_rows_drop'):
            # 갈아 끼우는 머리 모양(주인공의 옷장)은 고리를 덜 쌓아 용량을 줄인다
            rows = [r for i, r in enumerate(rows) if i not in P['hair_rows_drop']]
    span = z_top - z_low
    rings = []
    for t, k in rows:
        if t is None:
            z = z_low + H['undercut'] * th          # 두피에 붙은 안쪽 고리
            rings.append([Vector(x) for x in hair_point(az, z, np.full(N, 0.001), P)])
        else:
            z = z_low + np.maximum(span * t, 0.013 * (t > 0) * (t < 0.2))
            rings.append([Vector(x) for x in hair_point(az, z, th * k, P)])
    vr = p.loft(rings, ['hair_in'] + ['hair'] * (len(rings) - 2), [{'head': 1}] * len(rings))
    p.set_thin(vr[0], 1.0)
    if not capped:
        p.cap(vr[-1], 'hair', offset=(0, 0, 0.006))
    return p.to_object(levels=det(P, 'levels'))


def build_hair_extras(P, pal):
    """
    머리 모양의 덧붙임(양 갈래, 똥머리, 삐죽 머리 등). P['hair_extras'] = [dict(pos=(x, y, z), r=(rx, ry, rz), color='hair', seg=2), ...]
    pos 는 머리 중심 기준. 좌우 한 쌍은 mirror=True 로 준다.
    """
    obs = []
    c = head_center(P)
    for e in P.get('hair_extras', []):
        for s_ in ((1, -1) if e.get('mirror') else (1,)):
            p = Part('hairx', pal)
            pos = (c[0] + e['pos'][0] * s_, c[1] + e['pos'][1], c[2] + e['pos'][2])
            mk.quad_sphere(p, pos, e['r'], e.get('seg', 2), e.get('color', 'hair'), {'head': 1})
            ob = p.to_object(levels=e.get('levels', det(P, 'levels')))
            if e.get('pull'):
                # 한쪽으로 잡아 늘여 끝을 뾰족하게(묶은 머리의 끝)
                co = mk.get_co(ob)
                tip = np.array(pos) + np.array([e['pull'][0] * s_, e['pull'][1], e['pull'][2]])
                co = mk.brush_grab(co, tip, max(e['r']) * 1.3, (np.array([e['pull'][0] * s_, e['pull'][1], e['pull'][2]]) * 0.9))
                mk.set_co(ob, co)
            obs.append(ob)
    return obs


# --------------------------------------------------------------------------- 운동화
def build_shoe(P, pal, side):
    """
    운동화. 발 길이 방향으로 단면 고리를 늘어놓아 만든다(뒤꿈치 -> 발끝).
    단면은 "바닥이 평평하고 위가 둥근" 모양이고, 밑창은 갑피보다 한 턱 넓게 튀어나온다.
    색 경계(앞코 고무, 밑창, 끈)가 고리와 세로줄을 따라가므로 삐뚤빼뚤하지 않다.
    발목 구멍은 윗면을 열고 테를 세워 만든다(양말이 그 안으로 들어간다).
    """
    sfx = '.L' if side > 0 else '.R'
    p = Part('shoe' + sfx, pal)
    cx = side * P['leg_x']
    yaw = side * math.radians(P['toe_out_deg'])
    fw = Vector((math.sin(yaw), -math.cos(yaw), 0))       # 발끝 방향(살짝 벌린다)
    lat = Vector((math.cos(yaw), math.sin(yaw), 0))
    w = {'foot' + sfx: 1}
    k = P['shoe_scale']
    O = Vector((cx, 0, 0))

    def section(f, W, H, sole_h=0.020, lift=0.0):
        """발끝 쪽으로 f 만큼 간 자리의 단면(12 점). W: 갑피 반폭, H: 갑피 높이, lift: 바닥이 들린 높이(앞코)"""
        ws = W + 0.0055                                 # 밑창은 조금 더 넓다
        pts2 = [
            (0.0, lift),                                # 0 바닥 가운데
            (ws * 0.86, lift + 0.001),                  # 1 바닥 모서리
            (ws, lift + sole_h * 0.45),                 # 2 밑창 옆
            (ws * 0.985, lift + sole_h),                # 3 밑창 윗모서리
            (W * 0.97, lift + sole_h + 0.004),          # 4 갑피 시작(안으로 들어간 턱)
            (W * 0.96, lift + sole_h + (H - sole_h) * 0.55),   # 5 갑피 옆
            (W * 0.62, H * 0.97),                       # 6 갑피 윗모서리
            (0.0, H),                                   # 7 윗면 가운데
        ]
        full = pts2 + [(-x, z) for x, z in reversed(pts2[1:7])]
        return [O + fw * (f * k) + lat * (x * k) + Vector((0, 0, z * k)) for x, z in full]
    # (앞뒤 위치, 반폭, 높이, 바닥 들림)
    rows = [
        (-0.058, 0.034, 0.050, 0.004),      # 0 뒤꿈치 끝
        (-0.046, 0.047, 0.066, 0.0),        # 1
        (-0.022, 0.052, 0.071, 0.0),        # 2 발목 뒤
        (0.022, 0.054, 0.068, 0.0),         # 3 발목 앞
        (0.050, 0.056, 0.058, 0.0),         # 4 발등
        (0.078, 0.057, 0.050, 0.0),         # 5 앞코 시작
        (0.108, 0.053, 0.044, 0.002),       # 6
        (0.130, 0.036, 0.034, 0.006),       # 7 발끝
    ]
    vr = [p.add_ring(section(f, W, H, lift=l), w) for f, W, H, l in rows]
    # 단면의 칸 번호: 0, 13 = 바닥 / 1, 2, 11, 12 = 밑창 옆 / 3, 10 = 밑창 윗턱 / 4, 5, 8, 9 = 갑피 옆 / 6, 7 = 윗면
    SOLE, TOP = {0, 1, 2, 3, 10, 11, 12, 13}, {6, 7}
    for kseg in range(len(vr) - 1):
        fs = p.bridge(vr[kseg], vr[kseg + 1], 'shoe', flip=True)
        for i, f in enumerate(fs):
            if i in SOLE:
                name = 'sole'
            elif kseg >= 6:
                name = 'toe'                             # 앞코의 흰 고무
            elif i in TOP and kseg in (3, 4):
                name = 'lace'                            # 끈
            else:
                name = 'shoe'
            f.material_index = pal.index(name)
    p.cap(vr[0], 'shoe', offset=fw * (-0.006 * k), flip=False)
    # 뒤꿈치 덮개도 밑창 부분은 흰색
    p.cap(vr[-1], 'toe', offset=fw * (0.008 * k), flip=True)
    # 발목 구멍: 윗면(칸 5~8, 고리 2~3 사이)을 열고 테를 세운다
    faces = p.faces_between(vr[2], vr[3], [5, 6, 7, 8]) + p.faces_between(vr[1], vr[2], [5, 6, 7, 8])
    loop, base = open_patch(p, faces, UP, fw)
    ac = O + Vector((0, 0, 0))
    r1 = ring_after(p, loop, ac + Vector((0, 0, 0.078 * k)), UP, 0.0545 * k, 0.057 * k, fw, base, w, 'shoe')
    r2 = ring_after(p, r1, ac + Vector((0, 0, 0.090 * k)), UP, 0.0545 * k, 0.056 * k, fw, base, w, 'shoe')
    r3 = ring_after(p, r2, ac + Vector((0, 0, 0.094 * k)), UP, 0.050 * k, 0.051 * k, fw, base, w, 'shoe')
    r4 = ring_after(p, r3, ac + Vector((0, 0, 0.091 * k)), UP, 0.041 * k, 0.042 * k, fw, base, w, 'shoe_in')
    r5 = ring_after(p, r4, ac + Vector((0, 0, 0.070 * k)), UP, 0.038 * k, 0.039 * k, fw, base, w, 'shoe_in')
    p.set_thin(r4, 0.8)
    p.set_thin(r5, 1.0)
    # 색이 바뀌는 고리는 또렷하게(세분화해도 번지지 않게) 접어 둔다
    return p.to_object(levels=det(P, 'levels'))


def build_shoe_simple(P, pal, side):
    """성긴 모델용 신발: 발 길이 방향의 타원 고리 다섯 개. 밑창과 앞코만 색을 달리한다."""
    sfx = '.L' if side > 0 else '.R'
    p = Part('shoe' + sfx, pal)
    cx = side * P['leg_x']
    yaw = side * math.radians(P['toe_out_deg'])
    fw = Vector((math.sin(yaw), -math.cos(yaw), 0))
    lat = Vector((math.cos(yaw), math.sin(yaw), 0))
    w = {'foot' + sfx: 1}
    k = P['shoe_scale']
    O = Vector((cx, 0, 0))
    n = 8
    rows = [(-0.054, 0.036, 0.052), (-0.030, 0.050, 0.070), (0.020, 0.054, 0.068), (0.072, 0.056, 0.052), (0.116, 0.044, 0.038)]
    if det(P, 'lite'):
        rows = [rows[1], rows[3], rows[4]]
    rings = []
    for f, W_, H_ in rows:
        ctr = O + fw * (f * k) + Vector((0, 0, H_ * k / 2))
        rings.append(ring(ctr, W_ * k, H_ * k / 2, n, u=lat, v=UP, power=2.6))
    vr = [p.add_ring(r, w) for r in rings]
    for kseg in range(len(vr) - 1):
        fs = p.bridge(vr[kseg], vr[kseg + 1], 'shoe', flip=True)
        for i, f in enumerate(fs):
            # 고리의 아래쪽 반(칸 4~7)의 가운데 두 칸이 바닥이다
            if i in (5, 6):
                f.material_index = pal.index('sole')
            elif kseg == len(vr) - 2:
                f.material_index = pal.index('toe')
    p.cap(vr[0], 'shoe', offset=fw * (-0.008 * k))
    p.cap(vr[-1], 'toe', offset=fw * (0.012 * k))
    return p.to_object(levels=det(P, 'levels'))


# --------------------------------------------------------------------------- 이름표
def build_tag(P, shirt_ob):
    """가슴 왼쪽에 붙는 이름표 판. 윗옷 표면에 광선을 쏘아 굴곡을 따라 붙인다. 글자는 게임이 그린다."""
    co = mk.get_co(shirt_ob)
    polys = [tuple(p.vertices) for p in shirt_ob.data.polygons]
    bvh = BVHTree.FromPolygons([tuple(c) for c in co], polys)
    cx, cz = P['tag_pos']
    cz = Z(P, cz)
    w, h = P['tag_size']
    nx, nz = 6, 3
    verts, uvs, faces = [], [], []
    for j in range(nz + 1):
        for i in range(nx + 1):
            x = cx + (i / nx - 0.5) * w
            z = cz + (j / nz - 0.5) * h
            hit = bvh.ray_cast(Vector((x, -1, z)), Vector((0, 1, 0)))
            if hit[0] is not None:
                pt = hit[0] + hit[1].normalized() * 0.0045      # 표면에서 살짝 띄운다
                verts.append((pt.x, pt.y, pt.z))
            else:
                verts.append((x, -0.12, z))
            uvs.append((i / nx, j / nz))            # 앞에서 볼 때 글자가 바로 보이게(+X 가 보는 사람의 오른쪽)
    for j in range(nz):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    m = bpy.data.meshes.new('tag')
    m.from_pydata(verts, [], faces)
    m.update()
    uvl = m.uv_layers.new(name='UVMap')
    for poly in m.polygons:
        poly.use_smooth = True
        for li in poly.loop_indices:
            uvl.data[li].uv = uvs[m.loops[li].vertex_index]
    ob = bpy.data.objects.new('tag', m)
    bpy.context.collection.objects.link(ob)
    ob.vertex_groups.new(name='chest').add(list(range(len(verts))), 1.0, 'REPLACE')
    return ob


# --------------------------------------------------------------------------- 덧붙이는 것들(안경, 지퍼, 호루라기, 소품)
class Surface:
    """부분 메시의 겉면: 광선으로 표면의 점을 찾고, 그 자리의 뼈 가중치를 가장 가까운 꼭짓점에서 물려받는다."""

    def __init__(self, ob):
        from mathutils.kdtree import KDTree
        self.co = mk.get_co(ob)
        polys = [tuple(pl.vertices) for pl in ob.data.polygons]
        self.bvh = BVHTree.FromPolygons([tuple(c) for c in self.co], polys)
        self.kd = KDTree(len(self.co))
        for i, c in enumerate(self.co):
            self.kd.insert(Vector(c), i)
        self.kd.balance()
        names = [g.name for g in ob.vertex_groups]
        self.w = []
        for v in ob.data.vertices:
            self.w.append({names[g.group]: g.weight for g in v.groups if not names[g.group].startswith('_') and g.weight > 0})

    def front(self, x, z):
        """앞(-Y)에서 본 (x, z) 자리의 표면 점과 법선"""
        hit = self.bvh.ray_cast(Vector((x, -1, z)), Vector((0, 1, 0)))
        if hit[0] is None:
            return None, None
        return hit[0], hit[1].normalized()

    def weights_at(self, pt):
        _, i, _ = self.kd.find(pt)
        return dict(self.w[i]) or {'chest': 1}


def build_ribbon(pal, name, surf: Surface, path, width, thick, color, thin=1.0):
    """
    옷 겉면에 붙은 띠(지퍼 선, 목걸이 줄). path = [(x, z), ...] 를 따라 겉면 위에 납작한 네모 단면의 관을 놓는다.
    겉면에 살짝 묻혀 있고 thick 만큼 도드라진다. 가중치는 그 자리의 옷에서 물려받아 옷과 함께 움직인다.
    """
    p = Part(name, pal)
    rings, ws = [], []
    for i, (x, z) in enumerate(path):
        pt, nrm = surf.front(x, z)
        if pt is None:
            continue
        a = path[max(0, i - 1)]
        b = path[min(len(path) - 1, i + 1)]
        t = Vector((b[0] - a[0], 0, b[1] - a[1])).normalized()
        bn = nrm.cross(t).normalized()
        t = bn.cross(nrm).normalized()
        h = width / 2
        rings.append([pt + bn * h - nrm * 0.003, pt + bn * h + nrm * thick, pt - bn * h + nrm * thick, pt - bn * h - nrm * 0.003])
        ws.append(surf.weights_at(pt))
    vr = p.loft(rings, color, ws)
    p.cap(vr[0], color)
    p.cap(vr[-1], color)
    for r in vr:
        p.set_thin(r, thin)
    return p.to_object(levels=0)


def build_blob(pal, name, center, radii, color, w, levels=1, seg=2, thin=0.0):
    """작은 둥근 덩어리(호루라기 몸통, 지퍼 손잡이, 단추)"""
    p = Part(name, pal)
    mk.quad_sphere(p, center, radii, seg, color, w)
    for v in p.bm.verts:
        p.set_thin([v], thin)
    return p.to_object(levels=levels)


def add_plate(p: Part, origin, along, across, normal, length, width_fn, thick, color, weight_fn, stations=2, inset=0.008, thin=0.0):
    """
    얇은 판(양면이 다 보인다). along 방향으로 stations 칸을 나누고, 단면은 납작한 육각형이다:
    앞뒤 면이 평평하게 보이면서도 가장자리가 이어져 있어 외곽선이 제대로 선다. width_fn(s) 로 폭을 바꾸면 세모 깃발이 된다.
    """
    along, across, normal = Vector(along).normalized(), Vector(across).normalized(), Vector(normal).normalized()
    rings, ws = [], []
    for i in range(stations + 1):
        s_ = i / stations
        c = Vector(origin) + along * (length * s_)
        hw = width_fn(s_) / 2
        ii = min(inset, hw * 0.6)
        rings.append([c + across * hw, c + across * (hw - ii) + normal * thick, c - across * (hw - ii) + normal * thick,
                      c - across * hw, c - across * (hw - ii) - normal * thick, c + across * (hw - ii) - normal * thick])
        ws.append(weight_fn(s_))
    vr = p.loft(rings, color, ws)
    p.cap(vr[0], color)
    p.cap(vr[-1], color)
    for r in vr:
        p.set_thin(r, thin)
    return vr


def add_rod(p: Part, a, b, radius, color, w, n=6, thin=0.0, ref=None):
    """가는 막대(깃대, 안경다리)"""
    a, b = Vector(a), Vector(b)
    u, v, t = frame_from(b - a, Vector(ref) if ref is not None else Vector((0.3, 0.2, 1)))
    vr = p.loft([ring(a, radius, radius, n, u=u, v=v), ring(b, radius, radius, n, u=u, v=v)], color, [w, w])
    p.cap(vr[0], color)
    p.cap(vr[1], color)
    for r in vr:
        p.set_thin(r, thin)
    return vr


def add_rod_path(p: Part, pts, radius, color, w, n=6):
    """꺾인 막대(안경다리, 코걸이): 점들을 따라 고리를 놓아 한 줄로 잇는다."""
    pts = [Vector(x) for x in pts]
    rings = []
    for i, c in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        u, v, _ = frame_from(t, Vector((0.3, 0.2, 1)))
        rings.append(ring(c, radius, radius, n, u=u, v=v))
    vr = p.loft(rings, color, [w] * len(rings))
    p.cap(vr[0], color)
    p.cap(vr[-1], color)
    return vr


def build_glasses(P, pal):
    """
    동그란 안경(실제 모양). 얼굴 그림의 눈 자리(P['eye_px'])를 머리 표면에서 찾아 그 앞에 테를 띄운다.
    테는 정면과 얼굴 면의 중간쯤을 향하게 해서, 앞에서는 동그랗고 옆에서는 얼굴을 감싸 보인다.
    """
    G = P['glasses']
    p = Part('glasses', pal)
    c = head_center(P)
    w = {'head': 1}
    ex, ey = G.get('px', P['eye_px'])
    rM, rt = G['r'], G['tube']
    nseg, ntube = G.get('seg', 16), 6
    centers = {}
    for s_ in (1, -1):
        base = shape_head(face_point(P, 128 + s_ * ex, ey).reshape(1, 3), P)[0]
        radial = Vector(base - c).normalized()
        nrm = (radial * G.get('wrap', 0.5) + FWD * (1 - G.get('wrap', 0.5))).normalized()
        ctr = Vector(base) + nrm * G['off']
        u, v, t = frame_from(nrm, UP)        # u = 위쪽, v = 옆
        rings = []
        for i in range(nseg):
            th = 2 * math.pi * i / nseg
            rad = u * math.cos(th) + v * math.sin(th)
            pc = ctr + rad * rM
            rings.append([pc + (rad * math.cos(a_) + nrm * math.sin(a_)) * rt for a_ in (2 * math.pi * k / ntube for k in range(ntube))])
        vr = [p.add_ring(r, w) for r in rings]
        for i in range(nseg):
            p.bridge(vr[i], vr[(i + 1) % nseg], 'glasses')
        centers[s_] = (ctr, nrm, v, u)
        # 안경다리: 테의 바깥 끝에서 귀 위쪽까지
        side = Vector((s_, 0, 0))
        outer = ctr + side * (rM * 0.92) + UP * (rM * 0.25)
        ear = Vector((c[0] + s_ * (P['head_r'][0] * (1 + P['jaw_wide'] * 0.3) + G.get('temple_out', 0.012)), c[1] + 0.02, c[2] + G.get('temple_z', -0.01)))
        mid = (outer + ear) / 2 + side * 0.010
        add_rod_path(p, [outer, mid, ear], rt * 0.85, 'glasses', w, n=6)
    # 코걸이: 두 테의 안쪽 끝을 잇는다(가운데가 살짝 솟는다)
    cl, cr = centers[1], centers[-1]
    a = cl[0] - Vector((1, 0, 0)) * (rM * 0.96) + UP * (rM * 0.18)
    b = cr[0] + Vector((1, 0, 0)) * (rM * 0.96) + UP * (rM * 0.18)
    m = (a + b) / 2 + UP * 0.004 + FWD * 0.003
    add_rod_path(p, [a, m, b], rt * 0.9, 'glasses', w, n=6)
    for v_ in p.bm.verts:
        p.set_thin([v_], G.get('thin', 0.55))
    return p.to_object(levels=0)


def build_clipboard(P, pal, bone='prop.L', side=1):
    """기록판: 나무판 + 종이 + 집게. 쉬는 자세에서 손바닥 가운데(쥐는 점)에 세워 만든다(판의 앞면이 캐릭터의 앞을 본다)."""
    C = P['clipboard']
    S, d, E, fd, W, T, G = arm_axes(P, side)
    p = Part('clipboard', pal)
    w = {bone: 1}
    wf = lambda s_: w
    bw, bh, bt = C['w'], C['h'], C['t']
    # 손은 판의 아래쪽 1/4 지점을 쥔다
    org = Vector(G) + UP * (-bh * C.get('grip', 0.22))
    add_plate(p, org, UP, Vector((1, 0, 0)), FWD, bh, lambda s_: bw, bt, 'board', wf, stations=1, inset=0.012)
    add_plate(p, org + UP * 0.016 + FWD * (bt + 0.0015), UP, Vector((1, 0, 0)), FWD, bh * 0.82, lambda s_: bw * 0.84, 0.0015, 'sheet', wf, stations=1, inset=0.004, thin=1.0)
    add_plate(p, org + UP * (bh * 0.86) + FWD * (bt + 0.004), UP, Vector((1, 0, 0)), FWD, bh * 0.11, lambda s_: bw * 0.42, 0.005, 'clip', wf, stations=1, inset=0.006, thin=0.6)
    # 종이에 적은 줄 몇 개
    for k in range(4):
        z0 = org + UP * (bh * (0.62 - 0.13 * k)) + FWD * (bt + 0.0034) + Vector((bw * (0.0 if k else -0.06), 0, 0))
        add_plate(p, z0, UP, Vector((1, 0, 0)), FWD, 0.007, lambda s_, k=k: bw * (0.6 if k else 0.44), 0.0006, 'ink', wf, stations=1, inset=0.002, thin=1.0)
    return p.to_object(levels=0)


def build_flag(P, pal, bone='prop.R', cloth_bone='flag', side=-1):
    """손깃발: 깃대 + 세모 깃발. 쉬는 자세에서 쥐는 점에 똑바로 세워 만든다(깃발 천은 캐릭터의 앞쪽으로 뻗는다)."""
    F = P['flag']
    S, d, E, fd, W, T, G = arm_axes(P, side)
    p = Part('flag', pal)
    w = {bone: 1}
    base = Vector(G) - UP * F.get('below', 0.05)
    top = base + UP * F['pole']
    lite = det(P, 'lite')
    add_rod(p, base, top, F.get('pole_r', 0.006), 'pole', w, n=4 if lite else 6, thin=0.3)
    kn = Part('flagknob', pal)
    mk.quad_sphere(kn, top + UP * 0.006, (0.011, 0.011, 0.011), 1 if det(P, 'levels') == 0 else 2, 'knob', w)
    # 천: 깃대 쪽이 넓고 끝이 뾰족하다. 끝으로 갈수록 flag 뼈를 따라 펄럭인다.
    ch, cl = F['cloth_h'], F['cloth_l']
    root = top - UP * (ch / 2 + 0.008) + FWD * (F.get('pole_r', 0.006))
    add_plate(p, root, FWD, UP, Vector((1, 0, 0)), cl, lambda s_: max(0.006, ch * (1 - s_ * 0.94)), 0.0016, 'cloth',
              lambda s_: {bone: 1 - s_ ** 0.8, cloth_bone: s_ ** 0.8} if s_ > 0 else {bone: 1}, stations=2 if lite else 4, inset=0.007, thin=0.25)
    if lite:
        return [p.to_object(levels=0)]
    return [p.to_object(levels=0), kn.to_object(levels=0)]
