"""
meshkit.py - 코드로 모델링할 때 쓰는 기본 도구 모음.

여기 있는 것:
  * ring / Loft      : 단면 고리(ring)를 차례로 이어 붙여 관(tube) 모양의 사각형 메시를 만든다.
  * quad_sphere      : 정육면체를 부풀려 만든 "사각형만으로 된 공"(머리의 바탕).
  * (가지 내기는 parts.py 의 open_patch + ring_after: 면 몇 장을 열고 새 고리를 이어 소매, 엄지를 뽑는다)
  * subdivide        : Catmull-Clark 세분화(Subdivision Surface)를 실제로 적용한다.
  * 조각 붓(grab/inflate) : 넘파이로 꼭짓점을 직접 미는 "스컬프트 붓".
  * 색/가중치 기록    : 면마다 색 번호(material_index), 꼭짓점마다 뼈 가중치(vertex group).

좌표계(블렌더): +X = 캐릭터의 왼쪽, -Y = 앞, +Z = 위.  크기는 "키 = 1" 을 기준으로 한다.
"""
import math
import bmesh
import bpy
import numpy as np
from mathutils import Vector, Matrix


# --------------------------------------------------------------------------- 색 팔레트
class Palette:
    """색 이름 -> 번호. 면에는 번호(material_index)만 적어 두고, 마지막에 꼭짓점 색으로 바꾼다."""

    def __init__(self, colors: dict):
        self.names = list(colors.keys())
        self.hex = dict(colors)

    def index(self, name: str) -> int:
        return self.names.index(name)

    def linear(self, name: str):
        """#rrggbb(sRGB) -> 선형 RGB. glTF 의 꼭짓점 색(COLOR_0)은 선형 값이어야 한다."""
        h = self.hex[name].lstrip('#')
        out = []
        for i in (0, 2, 4):
            c = int(h[i:i + 2], 16) / 255
            out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
        return out


def mix_hex(a: str, b: str, k: float) -> str:
    """three.js 의 Color.lerp 와 같은 방식(선형 공간)으로 두 색을 섞는다. kid.ts 의 mix() 와 결과가 같다."""
    def lin(h):
        h = h.lstrip('#')
        v = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in v]

    def srgb(c):
        c = max(0.0, min(1.0, c))
        return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
    la, lb = lin(a), lin(b)
    m = [la[i] + (lb[i] - la[i]) * k for i in range(3)]
    return '#' + ''.join(f'{round(srgb(c) * 255):02x}' for c in m)


# --------------------------------------------------------------------------- 고리와 로프트
def frame_from(axis: Vector, ref: Vector):
    """axis 에 수직인 두 축(u, v)을 만든다. u 는 ref 쪽을 향한다(고리의 0도 방향)."""
    t = axis.normalized()
    u = ref - t * ref.dot(t)
    if u.length < 1e-6:
        u = Vector((1, 0, 0)) - t * t.x
    u.normalize()
    v = t.cross(u)
    return u, v, t


def ring(center, rx, ry, n, u=Vector((1, 0, 0)), v=Vector((0, 1, 0)), power=2.0, phase=0.0, shape=None):
    """
    타원(또는 둥근 네모) 고리의 점 n 개.
      power = 2 면 타원, 더 크면 네모에 가까워진다(superellipse).
      shape(theta) 는 각도별 반지름 배율(배를 볼록하게, 엉덩이를 통통하게 같은 조각용).
    """
    c = Vector(center)
    pts = []
    for i in range(n):
        th = phase + 2 * math.pi * i / n
        cs, sn = math.cos(th), math.sin(th)
        e = 2.0 / power
        x = math.copysign(abs(cs) ** e, cs) * rx
        y = math.copysign(abs(sn) ** e, sn) * ry
        k = shape(th) if shape else 1.0
        pts.append(c + u * (x * k) + v * (y * k))
    return pts


class Part:
    """bmesh 하나를 감싼 조립 도구. 면 색 번호와 꼭짓점 가중치를 함께 기록한다."""

    def __init__(self, name: str, palette: Palette):
        self.name = name
        self.pal = palette
        self.bm = bmesh.new()
        self.dl = self.bm.verts.layers.deform.verify()
        self.groups: list[str] = []
        self.crease = self.bm.edges.layers.float.new('crease_edge')

    # ---- 가중치
    def gi(self, bone: str) -> int:
        if bone not in self.groups:
            self.groups.append(bone)
        return self.groups.index(bone)

    def set_w(self, v, w: dict):
        d = v[self.dl]
        d.clear()
        s = sum(w.values()) or 1.0
        for b, x in w.items():
            if x > 0:
                d[self.gi(b)] = x / s

    def set_thin(self, verts, value: float):
        """외곽선을 얇게 할 곳을 표시한다(0 = 보통, 1 = 외곽선 없음). 엄지 틈이나 옷 속으로 접혀 들어간 면에 쓴다."""
        gi = self.gi('_thin')
        for v in verts:
            v[self.dl][gi] = value

    # ---- 만들기
    def add_ring(self, pts, w: dict):
        vs = [self.bm.verts.new(p) for p in pts]
        for v in vs:
            self.set_w(v, w)
        return vs

    def bridge(self, a, b, color: str, flip=False):
        """같은 개수의 두 고리 사이를 사각형으로 메운다."""
        n = len(a)
        mi = self.pal.index(color)
        faces = []
        for i in range(n):
            j = (i + 1) % n
            vs = [a[i], a[j], b[j], b[i]]
            if flip:
                vs.reverse()
            f = self.bm.faces.new(vs)
            f.material_index = mi
            f.smooth = True
            faces.append(f)
        return faces

    def loft(self, rings, colors, weights, flip=False):
        """
        rings   : 점 목록의 목록(아래에서 위로, 또는 몸쪽에서 끝쪽으로)
        colors  : 고리 사이 구간마다의 색 이름(길이 = len(rings) - 1) 또는 색 하나
        weights : 고리마다의 뼈 가중치 dict
        """
        if isinstance(colors, str):
            colors = [colors] * (len(rings) - 1)
        vrings = [self.add_ring(r, w) for r, w in zip(rings, weights)]
        for k in range(len(vrings) - 1):
            self.bridge(vrings[k], vrings[k + 1], colors[k], flip)
        return vrings

    def cap(self, vring, color: str, flip=False, offset=None, w=None):
        """고리를 닫는다. 가운데 점 하나를 두고 사각형 n/2 장으로 메운다(짝수 개 고리)."""
        n = len(vring)
        c = Vector((0, 0, 0))
        for v in vring:
            c += v.co
        c /= n
        if offset is not None:
            c += Vector(offset)
        cv = self.bm.verts.new(c)
        if w is None:
            # 고리의 가중치를 평균해 물려받는다
            acc = {}
            for v in vring:
                for g, x in v[self.dl].items():
                    acc[g] = acc.get(g, 0) + x / n
            d = cv[self.dl]
            for g, x in acc.items():
                d[g] = x
        else:
            self.set_w(cv, w)
        mi = self.pal.index(color)
        for i in range(0, n, 2):
            vs = [vring[i], vring[(i + 1) % n], vring[(i + 2) % n], cv]
            if flip:
                vs.reverse()
            f = self.bm.faces.new(vs)
            f.material_index = mi
            f.smooth = True
        return cv

    def crease_ring(self, vring, value=1.0):
        """고리의 모서리를 날카롭게(세분화해도 둥글어지지 않게) 표시한다."""
        n = len(vring)
        for i in range(n):
            e = self.bm.edges.get((vring[i], vring[(i + 1) % n]))
            if e:
                e[self.crease] = value

    def faces_between(self, ra, rb, idxs):
        """두 고리 사이에서 idxs 번째 칸의 면들을 찾는다."""
        out = []
        n = len(ra)
        for i in idxs:
            i %= n
            j = (i + 1) % n
            want = {ra[i], ra[j], rb[j], rb[i]}
            for f in ra[i].link_faces:
                if set(f.verts) == want:
                    out.append(f)
        return out

    # ---- 마무리
    def to_object(self, levels=1) -> bpy.types.Object:
        """bmesh -> 오브젝트. 법선을 바깥으로 맞추고, 세분화(Subdivision Surface)를 levels 번 적용한다."""
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.collection.objects.link(ob)
        for g in self.groups:
            ob.vertex_groups.new(name=g)
        if '_thin' not in self.groups:
            ob.vertex_groups.new(name='_thin')
        if levels > 0:
            subdivide(ob, levels)
        return ob


def subdivide(ob, levels: int):
    """Subdivision Surface 수정자를 붙여 '적용'한 결과로 메시를 바꾼다(가중치와 면 색 번호는 따라온다)."""
    m = ob.modifiers.new('subsurf', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    m.subdivision_type = 'CATMULL_CLARK'
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)
    for p in me.polygons:
        p.use_smooth = True


def quad_sphere(part: Part, center, radii, seg: int, color: str, w: dict):
    """정육면체의 각 면을 seg x seg 로 나눈 뒤 공으로 부풀린다. 극점이 없어 얼굴 쪽 면이 고르다."""
    bm = part.bm
    c = Vector(center)
    cache = {}

    def vert(ix, iy, iz):
        key = (ix, iy, iz)
        if key not in cache:
            p = Vector((ix / seg * 2 - 1, iy / seg * 2 - 1, iz / seg * 2 - 1))
            # 정육면체 -> 공: 면이 고르게 퍼지는 변환
            x2, y2, z2 = p.x * p.x, p.y * p.y, p.z * p.z
            s = Vector((p.x * math.sqrt(max(0, 1 - y2 / 2 - z2 / 2 + y2 * z2 / 3)),
                        p.y * math.sqrt(max(0, 1 - z2 / 2 - x2 / 2 + z2 * x2 / 3)),
                        p.z * math.sqrt(max(0, 1 - x2 / 2 - y2 / 2 + x2 * y2 / 3))))
            v = bm.verts.new(c + Vector((s.x * radii[0], s.y * radii[1], s.z * radii[2])))
            part.set_w(v, w)
            cache[key] = v
        return cache[key]
    mi = part.pal.index(color)
    for axis in range(3):
        for side in (0, seg):
            for a in range(seg):
                for b in range(seg):
                    def idx(i, j):
                        k = [0, 0, 0]
                        k[axis] = side
                        k[(axis + 1) % 3] = i
                        k[(axis + 2) % 3] = j
                        return tuple(k)
                    vs = [vert(*idx(a, b)), vert(*idx(a + 1, b)), vert(*idx(a + 1, b + 1)), vert(*idx(a, b + 1))]
                    if side == 0:
                        vs.reverse()
                    f = bm.faces.new(vs)
                    f.material_index = mi
                    f.smooth = True


# --------------------------------------------------------------------------- 넘파이 <-> 메시
def get_co(ob) -> np.ndarray:
    n = len(ob.data.vertices)
    a = np.empty(n * 3, dtype=np.float32)
    ob.data.vertices.foreach_get('co', a)
    return a.reshape(n, 3).astype(np.float64)


def set_co(ob, co: np.ndarray):
    ob.data.vertices.foreach_set('co', co.astype(np.float32).ravel())
    ob.data.update()


def get_normals(ob) -> np.ndarray:
    n = len(ob.data.vertices)
    a = np.empty(n * 3, dtype=np.float32)
    ob.data.vertices.foreach_get('normal', a)
    return a.reshape(n, 3).astype(np.float64)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ---- 조각 붓: 부드러운 범위(falloff) 안의 꼭짓점을 민다
def falloff(co, center, radius):
    d = np.linalg.norm(co - np.asarray(center), axis=1) / radius
    t = np.clip(1 - d, 0, 1)
    return t * t * (3 - 2 * t)


def brush_grab(co, center, radius, delta):
    """잡아 끌기: center 주변을 delta 만큼 옮긴다."""
    return co + falloff(co, center, radius)[:, None] * np.asarray(delta)[None, :]


def brush_inflate(co, normals, center, radius, amount):
    """부풀리기: 법선 방향으로 민다(볼, 코)."""
    return co + falloff(co, center, radius)[:, None] * normals * amount


def laplacian_smooth(ob, iterations=1, factor=0.5, mask=None):
    """이웃 평균 쪽으로 당겨 표면을 고르게 편다(스컬프트의 Smooth 붓 전체 적용)."""
    me = ob.data
    n = len(me.vertices)
    e = np.empty(len(me.edges) * 2, dtype=np.int32)
    me.edges.foreach_get('vertices', e)
    e = e.reshape(-1, 2)
    co = get_co(ob)
    deg = np.bincount(e.ravel(), minlength=n).astype(np.float64)
    deg[deg == 0] = 1
    for _ in range(iterations):
        acc = np.zeros_like(co)
        np.add.at(acc, e[:, 0], co[e[:, 1]])
        np.add.at(acc, e[:, 1], co[e[:, 0]])
        avg = acc / deg[:, None]
        k = factor if mask is None else (factor * mask)[:, None]
        co = co + (avg - co) * k
    set_co(ob, co)


# --------------------------------------------------------------------------- 마무리 도구
def clean_mesh(ob, merge=1e-5):
    """겹친 점 합치기, 낱점 지우기, 법선 바깥으로, 검증. glTF 내보내기 전에 꼭 거친다."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=merge)
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.validate()
    ob.data.update()


def tri_count(ob) -> int:
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def mesh_report(ob):
    """메시 검사: (셋 이상의 면이 만나는 모서리 수, 이웃 면과 법선이 뒤집힌 모서리 수, 사각형이 아닌 면 수). 모두 0 이어야 한다."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    non_manifold = sum(1 for e in bm.edges if len(e.link_faces) > 2)
    flips = sum(1 for e in bm.edges if len(e.link_faces) == 2 and e.link_faces[0].normal.dot(e.link_faces[1].normal) < -0.3)
    not_quad = sum(1 for f in bm.faces if len(f.verts) != 4)
    bm.free()
    return non_manifold, flips, not_quad
