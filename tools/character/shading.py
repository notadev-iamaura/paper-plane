"""
shading.py - 색과 구운 그늘(ambient occlusion, AO)을 꼭짓점 색으로 적는다.

툰 조명은 면이 평평하게 보이기 쉬워서, 모자 챙 밑, 턱 밑, 겨드랑이, 다리 사이, 양말과 신발이 만나는 곳처럼
"빛이 덜 드는 틈"을 미리 계산해 색에 곱해 둔다. 그러면 조명이 단순해도 깊이가 느껴진다.

두 가지 방법:
  * cycles : 블렌더의 Cycles 렌더러로 AO 를 꼭짓점 색에 굽는다(CPU 로도 된다).
  * bvh    : 꼭짓점마다 반구 방향으로 광선을 쏘아 가려진 비율을 직접 센다(Cycles 가 없을 때의 대비책).
"""
import math
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import meshkit as mk


def ao_bvh(ob, samples=64, max_dist=0.14, seed=7):
    me = ob.data
    co = mk.get_co(ob)
    nor = mk.get_normals(ob)
    polys = [tuple(p.vertices) for p in me.polygons]
    bvh = BVHTree.FromPolygons([tuple(c) for c in co], polys)
    rng = np.random.default_rng(seed)
    # 코사인 가중 반구 방향(모든 꼭짓점이 같은 묶음을 쓴다 -> 얼룩이 덜하다)
    u1, u2 = rng.random(samples), rng.random(samples)
    r = np.sqrt(u1)
    th = 2 * math.pi * u2
    local = np.stack([r * np.cos(th), r * np.sin(th), np.sqrt(1 - u1)], axis=1)
    ao = np.ones(len(co))
    for i in range(len(co)):
        n = nor[i]
        ln = np.linalg.norm(n)
        if ln < 1e-6:
            continue
        n = n / ln
        a = np.array([0.0, 1.0, 0.0]) if abs(n[0]) > 0.8 else np.array([1.0, 0.0, 0.0])
        t = np.cross(n, a)
        t /= np.linalg.norm(t)
        b = np.cross(n, t)
        dirs = local[:, 0:1] * t + local[:, 1:2] * b + local[:, 2:3] * n
        o = Vector(co[i] + n * 0.003)
        occ = 0.0
        for d in dirs:
            hit = bvh.ray_cast(o, Vector(d), max_dist)
            if hit[0] is not None:
                occ += 1.0 - (hit[3] / max_dist) ** 2 * 0.6      # 가까이 가릴수록 더 어둡게
        ao[i] = 1.0 - occ / samples
    return ao


def ao_cycles(ob, samples=64, distance=0.14):
    """Cycles 로 AO 를 꼭짓점 색 'ao' 에 굽고, 꼭짓점별 값으로 돌려준다. 실패하면 예외를 던진다."""
    import addon_utils
    addon_utils.enable('cycles')
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    if sc.world is None:
        sc.world = bpy.data.worlds.new('w')
    sc.world.light_settings.distance = distance
    me = ob.data
    attr = me.color_attributes.new('ao', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = attr
    mat = bpy.data.materials.new('bake')
    mat.use_nodes = True
    me.materials.clear()
    me.materials.append(mat)
    old = [p.material_index for p in me.polygons]
    for p in me.polygons:
        p.material_index = 0
    bpy.context.view_layer.update()
    for o in bpy.context.scene.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    sc.render.bake.target = 'VERTEX_COLORS'
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    n = len(me.vertices)
    a = np.empty(n * 4, dtype=np.float32)
    me.color_attributes['ao'].data.foreach_get('color', a)
    ao = a.reshape(n, 4)[:, 0].astype(np.float64)
    me.color_attributes.remove(me.color_attributes['ao'])
    me.materials.clear()
    bpy.data.materials.remove(mat)
    for p, m in zip(me.polygons, old):
        p.material_index = m
    return ao


def smooth_scalar(ob, x, iters=2):
    me = ob.data
    n = len(me.vertices)
    e = np.empty(len(me.edges) * 2, dtype=np.int32)
    me.edges.foreach_get('vertices', e)
    e = e.reshape(-1, 2)
    deg = np.bincount(e.ravel(), minlength=n).astype(np.float64)
    deg[deg == 0] = 1
    for _ in range(iters):
        acc = np.zeros(n)
        np.add.at(acc, e[:, 0], x[e[:, 1]])
        np.add.at(acc, e[:, 1], x[e[:, 0]])
        x = x * 0.5 + acc / deg * 0.5
    return x


def write_colors(ob, mats, pal, ao, cfg, thin=None, parts=None):
    """
    면 색 번호 + AO -> 꼭짓점 색(면 모서리마다 적는다: 색 경계가 번지지 않고 또렷하다).
    그늘은 검정이 아니라 재질마다 정한 색(tint) 쪽으로 물들인다. 탁해지지 않고 남색 외곽선과 어울린다.

    parts 를 주면(관중) 색 대신 "부분 번호"를 적는다: parts = {색 이름: (번호, 밝기 배율)}.
      rgb   = 그늘과 밝기 배율만(게임이 사람마다 다른 색을 곱한다). parts 에 없는 색(번호 0)은 제 색 그대로.
      alpha = (번호 x 32 + 외곽선 두께 0~31) / 255.
    """
    me = ob.data
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    lin = np.array([pal.linear(n) for n in pal.names])
    pid = np.zeros(len(pal.names), dtype=np.int64)
    if parts:
        for i, n in enumerate(pal.names):
            if n in parts:
                pid[i] = parts[n][0]
                lin[i] = parts[n][1]
    st = np.array([cfg['by_color'].get(n, cfg['default'])[0] for n in pal.names])
    tn = np.array([cfg['by_color'].get(n, cfg['default'])[1] for n in pal.names])
    nl = len(me.loops)
    vi = np.empty(nl, dtype=np.int32)
    me.loops.foreach_get('vertex_index', vi)
    out = np.ones((nl, 4), dtype=np.float32)
    # 옅은 그늘은 버리고 진짜 틈새만 남긴다(얼굴과 옷이 전체적으로 탁해지지 않게).
    # 재질마다 (세기, 물들이는 색[, lo, hi]) 를 줄 수 있다: 살은 문턱을 낮춰 깊은 틈(턱 밑, 앞머리 바로 밑)만 남긴다.
    def lohi(name):
        e = cfg['by_color'].get(name, cfg['default'])
        return (e[2], e[3]) if len(e) >= 4 else (cfg['lo'], cfg['hi'])
    a_by = []
    for name in pal.names:
        lo, hi = lohi(name)
        a_ = mk.smoothstep(lo, hi, ao)
        a_by.append(np.clip(1 - (1 - a_) * cfg['gain'], 0, 1))
    for p in me.polygons:
        m = mats[p.index]
        base = lin[m]
        a = a_by[m]
        for li in p.loop_indices:
            k = (1 - a[vi[li]]) * st[m]
            out[li, :3] = base * (1 - k + k * tn[m])
            th = thin[vi[li]] if thin is not None else 0.0
            if parts:
                out[li, 3] = (pid[m] * 32 + round((1.0 - th) * 31)) / 255.0
            elif thin is not None:
                out[li, 3] = 1.0 - th        # 알파 = 외곽선 두께 배율(게임의 외곽선 셰이더가 읽는다)
    attr.data.foreach_set('color', out.ravel())
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = me.color_attributes.find('Col')
    me.materials.clear()
