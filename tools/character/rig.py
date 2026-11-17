"""
rig.py - 뼈대(armature)를 세우고, 부분 메시들을 하나로 합쳐 뼈에 묶는다(스키닝).

가중치는 "자동 가중치"에 맡기지 않고, 틀을 만들 때 고리마다 적어 둔 값(예: 팔꿈치 고리는 위팔 50% + 아래팔 50%)이
세분화를 거치며 부드럽게 보간된 것을 쓴다. 팔이 가슴 가중치를 끌고 가는 식의 "새는" 일이 없고, 매번 같은 결과가 나온다.
마지막에 이웃끼리 한 번 더 고르게 펴고, 꼭짓점마다 영향이 큰 뼈 4 개만 남겨 합이 1 이 되게 맞춘다(WebGL 의 한계).
"""
import math
import bpy
import numpy as np
from mathutils import Vector

import meshkit as mk
import parts


def bone_table(P):
    """
    뼈 이름 -> (머리 위치, 꼬리 위치, 부모). 좌표는 블렌더 기준(+X 왼쪽, -Y 앞, +Z 위).
    몸통의 높이는 아이 기준으로 적고 parts.Z 로 옮긴다(다른 비율의 캐릭터도 같은 표를 쓴다).
    P['bones_skip'] 에 적힌 뼈는 만들지 않는다(관중은 엄지, 모자 뼈가 없다).
    P['clipboard'], P['flag'] 가 있으면 손에 쥔 소품의 뼈(prop.L, prop.R, flag)를 더한다.
    """
    Zf = lambda z: parts.Z(P, z)
    t = {
        'root': ((0, 0, 0), (0, 0, 0.08), None),
        'hips': ((0, 0, P['hip_z']), (0, 0, Zf(0.33)), 'root'),
        'spine': ((0, 0, Zf(0.33)), (0, 0, Zf(0.43)), 'hips'),
        'chest': ((0, 0, Zf(0.43)), (0, 0, Zf(0.54)), 'spine'),
        'neck': ((0, 0, Zf(0.54)), (0, 0, Zf(0.60)), 'chest'),
        'head': ((0, 0, Zf(0.60)), (0, 0, Zf(0.90)), 'neck'),
        'cap': ((0, 0.01, Zf(0.83)), (0, 0.04, Zf(0.97)), 'head'),
    }
    for side, sfx in ((1, '.L'), (-1, '.R')):
        S, d, E, fd, W, T, G = parts.arm_axes(P, side)
        t['shoulder' + sfx] = ((side * 0.035, 0, P['shoulder_z'] - 0.005), tuple(S), 'chest')
        t['upper_arm' + sfx] = (tuple(S), tuple(E), 'shoulder' + sfx)
        t['forearm' + sfx] = (tuple(E), tuple(W), 'upper_arm' + sfx)
        t['hand' + sfx] = (tuple(W), tuple(T), 'forearm' + sfx)
        u = Vector((0, -1, 0)) - fd * Vector((0, -1, 0)).dot(fd)
        u.normalize()
        tb = W + fd * (0.036 * P['hand'] / 0.105) + u * 0.040
        tax = (u * 0.85 + fd * 0.55).normalized()
        t['thumb' + sfx] = (tuple(tb), tuple(tb + tax * 0.045), 'hand' + sfx)
        # 쥐는 점: 손바닥 가운데. 종이비행기가 여기에 붙는다.
        t['hand_grip' + sfx] = (tuple(G), tuple(G + fd * 0.03), 'hand' + sfx)
        x = side * P['leg_x']
        t['upper_leg' + sfx] = ((x, 0, P['hip_z']), (x, -0.005, P['knee_z']), 'hips')
        t['lower_leg' + sfx] = ((x, -0.005, P['knee_z']), (x, 0, P['ankle_z']), 'upper_leg' + sfx)
        yaw = side * math.radians(P['toe_out_deg'])
        t['foot' + sfx] = ((x, 0, P['ankle_z']), (x + math.sin(yaw) * 0.10, -math.cos(yaw) * 0.10, 0.02), 'lower_leg' + sfx)
    # 손에 쥔 소품: 쥐는 점에서 똑바로 위를 향한 뼈(자세 함수가 소품의 방향을 따로 정한다)
    if P.get('clipboard'):
        G = parts.arm_axes(P, 1)[6]
        t['prop.L'] = (tuple(G), tuple(G + Vector((0, 0, 0.1))), 'hand.L')
    if P.get('flag'):
        G = parts.arm_axes(P, -1)[6]
        t['prop.R'] = (tuple(G), tuple(G + Vector((0, 0, 0.1))), 'hand.R')
        if P['flag'].get('cloth_bone', 'flag') == 'flag':
            top = G + Vector((0, 0, P['flag']['pole'] - P['flag'].get('below', 0.05) - P['flag']['cloth_h'] / 2))
            t['flag'] = (tuple(top), tuple(top + Vector((0, -0.1, 0))), 'prop.R')
    for name in P.get('bones_skip', ()):
        t.pop(name, None)
    return t


def build_armature(P, name='kid_rig'):
    arm = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, arm)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    table = bone_table(P)
    for name, (h, t, parent) in table.items():
        b = arm.edit_bones.new(name)
        b.head = h
        b.tail = t
        b.roll = 0
        if parent:
            b.parent = arm.edit_bones[parent]
            b.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig, table


def extract(ob):
    """오브젝트 -> (좌표, 면 목록, 면 색 번호, {뼈: 가중치 배열})"""
    me = ob.data
    co = mk.get_co(ob)
    faces = [tuple(p.vertices) for p in me.polygons]
    mats = [p.material_index for p in me.polygons]
    n = len(me.vertices)
    w = {g.name: np.zeros(n) for g in ob.vertex_groups}
    names = [g.name for g in ob.vertex_groups]
    for v in me.vertices:
        for g in v.groups:
            w[names[g.group]][v.index] = g.weight
    return co, faces, mats, w


def join_parts(obs, name):
    """부분들을 한 메시로 합친다. 색 번호와 가중치를 그대로 옮긴다."""
    cos, faces, mats, ws = [], [], [], {}
    off = 0
    for ob in obs:
        co, f, m, w = extract(ob)
        cos.append(co)
        faces += [tuple(i + off for i in face) for face in f]
        mats += m
        for k, arr in w.items():
            ws.setdefault(k, []).append((off, arr))
        off += len(co)
    co = np.concatenate(cos)
    W = {k: np.zeros(off) for k in ws}
    for k, lst in ws.items():
        for o, arr in lst:
            W[k][o:o + len(arr)] = arr
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(c) for c in co], [], faces)
    me.update()
    for p, m in zip(me.polygons, mats):
        p.use_smooth = True
        p.material_index = m
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    for o in obs:
        d = o.data
        bpy.data.objects.remove(o)
        bpy.data.meshes.remove(d)
    return ob, mats, W


def finish_weights(ob, W, smooth_iters=1, max_influences=4):
    """가중치를 이웃끼리 고르게 펴고, 4 개로 줄이고, 합을 1 로 맞춰 vertex group 으로 적는다."""
    me = ob.data
    n = len(me.vertices)
    names = sorted(k for k in W.keys() if not k.startswith('_'))
    A = np.stack([W[k] for k in names], axis=1)
    e = np.empty(len(me.edges) * 2, dtype=np.int32)
    me.edges.foreach_get('vertices', e)
    e = e.reshape(-1, 2)
    deg = np.bincount(e.ravel(), minlength=n).astype(np.float64)
    deg[deg == 0] = 1
    for _ in range(smooth_iters):
        acc = np.zeros_like(A)
        np.add.at(acc, e[:, 0], A[e[:, 1]])
        np.add.at(acc, e[:, 1], A[e[:, 0]])
        A = A * 0.5 + (acc / deg[:, None]) * 0.5
    # 큰 것 4 개만 남긴다
    if A.shape[1] > max_influences:
        idx = np.argsort(-A, axis=1)[:, max_influences:]
        np.put_along_axis(A, idx, 0, axis=1)
    A[A < 0.01] = 0
    s = A.sum(axis=1)
    bad = int((s < 1e-6).sum())
    s[s < 1e-6] = 1
    A /= s[:, None]
    ob.vertex_groups.clear()
    for j, k in enumerate(names):
        g = ob.vertex_groups.new(name=k)
        col = A[:, j]
        nz = np.nonzero(col)[0]
        # 같은 값끼리 묶어 한 번에 넣는다(호출 수를 줄인다)
        vals = np.round(col[nz], 3)
        for val in np.unique(vals):
            g.add([int(i) for i in nz[vals == val]], float(val), 'REPLACE')
    return bad, int((A > 0).sum(axis=1).max())


def bind(ob, rig):
    ob.parent = rig
    m = ob.modifiers.new('Armature', 'ARMATURE')
    m.object = rig
