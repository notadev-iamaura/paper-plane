"""
anim.py - 동작(애니메이션 클립)을 코드로 만든다.

방법: "자세 함수"가 시간 t 에서의 자세를 사람이 읽기 쉬운 말로 내놓는다
      (몸을 얼마나 틀고 숙였는지, 손과 발이 어디에 있어야 하는지, 고개는 어디를 보는지).
      풀이기(Solver)가 그 자세를 뼈의 회전으로 바꾼다. 팔과 다리는 두 마디 IK 로 풀어서
      손은 목표 지점에, 발은 바닥에 정확히 놓인다. 그 결과를 프레임마다 키프레임으로 찍는다.

자세의 좌표는 게임(kid.ts)과 같은 "캐릭터 기준": +X 앞, +Y 위, +Z 오른쪽, 키 = 1.
블렌더 좌표(+X 왼쪽, -Y 앞, +Z 위)로는 k2b() 가 바꿔 준다.

움직임의 맛(12 원칙 가운데 코드로 넣은 것):
  * 예비 동작(anticipation) : 뛰기 전에 움츠린다, 던지기 전에 뒤로 젖힌다.
  * 따라가기와 겹치기(follow-through / overlap) : 머리와 모자는 몸보다 몇 프레임 늦게 따라온다.
  * 눌림과 늘어남(squash & stretch) : 착지에서 배가 눌리고, 뛰어오를 때 늘어난다(spine 뼈의 배율).
  * 느리게 시작하고 느리게 끝내기(ease) : 자세 사이는 smoothstep / overshoot 곡선으로 잇는다.
"""
import math
from dataclasses import dataclass, replace
import bpy
from mathutils import Matrix, Vector, Quaternion

import parts

FPS = 20


def k2b(x, y, z):
    """게임 캐릭터 좌표 -> 블렌더 좌표"""
    return Vector((-z, -x, y))


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def ease(t):
    c = clamp(t, 0, 1)
    return c * c * (3 - 2 * c)


def overshoot(t):
    """목표를 살짝 지나쳤다가 돌아온다"""
    c = clamp(t, 0, 1) - 1
    return 1 + c * c * (2.2 * c + 1.2)


@dataclass
class Pose:
    hop: float = 0.0
    bx: float = 0.0
    by: float = 0.0
    bz: float = 0.0
    lean: float = 0.0     # + 뒤로 젖힘
    twist: float = 0.0    # + 오른 어깨가 앞으로
    roll: float = 0.0     # + 오른쪽으로 기울임
    squash: float = 1.0
    hy: float = 0.0       # 고개: 좌우(+ 왼쪽을 본다)
    hp: float = 0.0       # 고개: 위아래(+ 위)
    ht: float = 0.0       # 고개: 갸웃
    rh: tuple = (0, 0, 0)  # 오른손 목표
    lh: tuple = (0, 0, 0)
    rf: tuple = (0, 0, 0, 0)   # 오른발: 앞, 높이, 옆, 발끝 숙임
    lf: tuple = (0, 0, 0, 0)
    relbow: tuple = None  # 팔꿈치가 향할 쪽(없으면 기본: 뒤, 아래, 바깥)
    lelbow: tuple = None
    rwrist: float = 0.0   # 손목 꺾기(+ 손등 쪽)
    lwrist: float = 0.0
    shrug: float = 0.0    # 어깨 으쓱
    # 손에 쥔 소품의 방향: (세운 방향, 앞면이 보는 방향). 캐릭터 기준 좌표. 없으면 손을 그대로 따른다.
    rprop: tuple = None
    lprop: tuple = None
    flag: float = 0.0     # 깃발 천이 깃대 둘레로 돌아간 각도(펄럭임)


class Solver:
    def __init__(self, rig, P):
        self.rig = rig
        self.P = P
        self.rest = {b.name: b.matrix_local.copy() for b in rig.data.bones}
        self.grip_rest = {sfx: Vector(parts.arm_axes(P, side)[6]) for side, sfx in ((1, '.L'), (-1, '.R'))}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in rig.data.bones}
        self.order = [b.name for b in rig.data.bones]       # 부모가 항상 먼저 온다
        self.sh = P['shoulder_z']
        self.hip = P['hip_z']
        self.foot_z = P['leg_x']
        self.a_len = P['upper_arm']
        self.b_len = P['forearm'] + P['hand'] * 0.5
        self.thigh = P['hip_z'] - P['knee_z']
        self.shin = P['knee_z'] - P['ankle_z']
        # 차렷 자세의 손: 팔이 거의 펴지도록 어깨에서 충분히 멀리, 살짝 바깥에 둔다
        hands_y = self.sh - 0.345
        self.rest_pose = Pose(rh=(0.03, hands_y, 0.205), lh=(0.03, hands_y, -0.205), rf=(0, 0, self.foot_z, 0), lf=(0, 0, -self.foot_z, 0))

    # ---- 뼈 하나를 원하는 자리(뼈대 공간의 행렬)에 놓는다
    def place(self, posed, basis, name, M):
        par = self.parent[name]
        if par:
            base = posed[par] @ self.rest[par].inverted() @ self.rest[name]
        else:
            base = self.rest[name].copy()
        basis[name] = base.inverted() @ M
        posed[name] = M

    def grip(self, posed, sfx):
        """쥐는 점(손바닥 가운데)의 지금 위치"""
        return posed['hand' + sfx] @ self.rest['hand' + sfx].inverted() @ self.grip_rest[sfx]

    def rotate_local(self, posed, basis, name, q: Quaternion, scale=None):
        """쉬는 자세 기준의 캐릭터 축(블렌더 축)으로 q 만큼 돌린다. 부모가 움직인 만큼은 그대로 따라간다. 없는 뼈는 건너뛴다."""
        if name not in self.rest:
            return
        par = self.parent[name]
        base = posed[par] @ self.rest[par].inverted() @ self.rest[name] if par else self.rest[name].copy()
        R = self.rest[name].to_3x3()
        ql = (R.inverted() @ q.to_matrix() @ R).to_4x4()
        if scale is not None:
            ql = ql @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1))
        posed[name] = base @ ql
        basis[name] = ql

    @staticmethod
    def body_q(twist, roll, lean):
        return Quaternion((0, 0, 1), twist) @ Quaternion((0, -1, 0), roll) @ Quaternion((-1, 0, 0), lean)

    @staticmethod
    def aim_matrix(base: Matrix, pos: Vector, direction: Vector):
        """base 의 방향에서 뼈의 길이 축(Y)이 direction 을 향하도록 가장 덜 돌린 행렬"""
        R = base.to_3x3().normalized()
        y = (R @ Vector((0, 1, 0))).normalized()
        q = y.rotation_difference(direction.normalized())
        M = (q.to_matrix() @ R).to_4x4()
        M.translation = pos
        return M

    @staticmethod
    def two_bone(S, T, a, b, hint):
        d = T - S
        L = d.length
        if L < 1e-5:
            d = Vector((0, 0, -1))
            L = 1e-5
        d = d / L
        L = min(a + b - 0.002, max(abs(a - b) + 0.002, L))
        x = (a * a - b * b + L * L) / (2 * L)
        h = math.sqrt(max(0.0, a * a - x * x))
        hv = hint - d * hint.dot(d)
        if hv.length < 1e-6:
            hv = Vector((1, 0, 0)) - d * d.x
        hv.normalize()
        return S + d * x + hv * h, S + d * L

    def solve(self, p: Pose, head_late: Pose = None, cap_pitch=0.0, cap_roll=0.0):
        """자세 -> 뼈마다의 기본(basis) 행렬. head_late 를 주면 고개는 그 자세(조금 전의 자세)를 따른다."""
        posed, basis = {}, {}
        I = Matrix.Identity(4)
        hp_ = head_late or p
        sq = max(0.6, p.squash)
        wide = 1 / math.sqrt(sq)
        # 뿌리: 폴짝 뛰는 높이
        M = self.rest['root'].copy()
        M.translation = Vector((0, 0, p.hop))
        self.place(posed, basis, 'root', M)
        # 엉덩이: 몸의 위치 + 회전의 일부
        fh, fs, fc = 0.34, 0.33, 0.33
        base = posed['root'] @ self.rest['root'].inverted() @ self.rest['hips']
        q = self.body_q(p.twist * 0.30, p.roll * fh, p.lean * fh)
        Mh = (q.to_matrix() @ base.to_3x3()).to_4x4()
        Mh.translation = Vector((-p.bz, -p.bx, self.hip + p.hop + p.by - (1 - sq) * self.hip * 0.4))
        self.place(posed, basis, 'hips', Mh)
        # 허리(배가 눌리고 늘어난다), 가슴(그만큼 되돌려 어깨와 머리는 찌그러지지 않게)
        self.rotate_local(posed, basis, 'spine', self.body_q(p.twist * 0.35, p.roll * fs, p.lean * fs), (wide, sq, wide))
        self.rotate_local(posed, basis, 'chest', self.body_q(p.twist * 0.35, p.roll * fc, p.lean * fc), (1 / wide, 1 / sq, 1 / wide))
        hq = lambda k: Quaternion((0, 0, 1), hp_.hy * k) @ Quaternion((-1, 0, 0), hp_.hp * k) @ Quaternion((0, -1, 0), hp_.ht * k)
        self.rotate_local(posed, basis, 'neck', hq(0.3))
        self.rotate_local(posed, basis, 'head', hq(0.7))
        self.rotate_local(posed, basis, 'cap', Quaternion((-1, 0, 0), cap_pitch) @ Quaternion((0, -1, 0), cap_roll))
        # 팔
        for sfx, tgt, hint_in, wrist in (('.R', p.rh, p.relbow, p.rwrist), ('.L', p.lh, p.lelbow, p.lwrist)):
            side = -1 if sfx == '.R' else 1
            T = k2b(*tgt) + Vector((0, 0, p.hop))       # 손, 발 목표는 뿌리(폴짝 뛰는 몸) 기준이다
            sh0 = (posed['chest'] @ self.rest['chest'].inverted() @ self.rest['upper_arm' + sfx]).translation
            # 손을 어깨 위로 들면 어깨뼈도 따라 올라간다(겨드랑이가 덜 찌그러진다)
            up = clamp((T.z - sh0.z) / 0.3, -0.2, 1.0)
            lift = (0.38 * max(0.0, up) + p.shrug)
            self.rotate_local(posed, basis, 'shoulder' + sfx, Quaternion((0, -1, 0), -side * lift))
            base_u = posed['shoulder' + sfx] @ self.rest['shoulder' + sfx].inverted() @ self.rest['upper_arm' + sfx]
            S = base_u.translation.copy()
            if hint_in is None:
                hint = Vector((side * 0.75, 0.45, -0.15 if T.z > S.z else -0.6))
            else:
                hint = k2b(*hint_in)
            E, H = self.two_bone(S, T, self.a_len, self.b_len, hint)
            Mu = self.aim_matrix(base_u, S, E - S)
            self.place(posed, basis, 'upper_arm' + sfx, Mu)
            base_f = posed['upper_arm' + sfx] @ self.rest['upper_arm' + sfx].inverted() @ self.rest['forearm' + sfx]
            Mf = self.aim_matrix(base_f, base_f.translation.copy(), H - E)
            self.place(posed, basis, 'forearm' + sfx, Mf)
            self.rotate_local(posed, basis, 'hand' + sfx, Quaternion((0, 1, 0), 0))
            if wrist:
                # 손목: 아래팔의 앞뒤 축 둘레로 꺾는다
                ax = (posed['forearm' + sfx].to_3x3() @ Vector((0, 0, 1))).normalized()
                base_h = posed['forearm' + sfx] @ self.rest['forearm' + sfx].inverted() @ self.rest['hand' + sfx]
                Mw = (Quaternion(ax, wrist).to_matrix() @ base_h.to_3x3()).to_4x4()
                Mw.translation = base_h.translation
                self.place(posed, basis, 'hand' + sfx, Mw)
            self.rotate_local(posed, basis, 'thumb' + sfx, Quaternion((0, 1, 0), 0))
            self.rotate_local(posed, basis, 'hand_grip' + sfx, Quaternion((0, 1, 0), 0))
            # 손에 쥔 소품: 쥐는 점에 놓고, 자세가 정한 방향으로 세운다(팔이 어떻게 비틀리든 소품은 원하는 쪽을 본다)
            pname = 'prop' + sfx
            if pname in self.rest:
                spec = p.rprop if sfx == '.R' else p.lprop
                if spec is None:
                    self.rotate_local(posed, basis, pname, Quaternion((0, 1, 0), 0))
                else:
                    up = k2b(*spec[0]).normalized()
                    fr = k2b(*spec[1])
                    fr = (fr - up * fr.dot(up)).normalized()
                    rt = fr.cross(up)        # 쉬는 자세: 위 = +Z, 앞 = -Y, 그 둘의 곱 = -X ... 열로 놓아 회전 행렬을 만든다
                    Rw = Matrix((( -rt.x, -fr.x, up.x), (-rt.y, -fr.y, up.y), (-rt.z, -fr.z, up.z)))
                    M = (Rw @ self.rest[pname].to_3x3()).to_4x4()
                    M.translation = self.grip(posed, sfx)
                    self.place(posed, basis, pname, M)
        if 'flag' in self.rest:
            self.rotate_local(posed, basis, 'flag', Quaternion((0, 0, 1), p.flag))
        # 다리: 엉덩이 관절에서 발목까지. 닿지 않으면 다리가 살짝 늘어난다(만화식).
        for sfx, f in (('.R', p.rf), ('.L', p.lf)):
            side = -1 if sfx == '.R' else 1
            fx, fy, fz, fp = f
            base_t = posed['hips'] @ self.rest['hips'].inverted() @ self.rest['upper_leg' + sfx]
            Hj = base_t.translation.copy()
            c, s = math.cos(fp), math.sin(max(0.0, fp))
            az = self.P['ankle_z']
            ball = 0.07
            ankle = k2b(fx + ball - ball * c + az * s, fy + az * c + ball * s, fz) + Vector((0, 0, p.hop))
            d = (ankle - Hj).length
            reach = self.thigh + self.shin
            stretch = max(1.0, d / (reach - 0.002))
            a_, b_ = self.thigh * stretch, self.shin * stretch
            K, A = self.two_bone(Hj, ankle, a_, b_, Vector((side * 0.25, -1.0, 0.1)))
            Mt = self.aim_matrix(base_t, Hj, K - Hj)
            self.place(posed, basis, 'upper_leg' + sfx, Mt)
            base_s = posed['upper_leg' + sfx] @ self.rest['upper_leg' + sfx].inverted() @ self.rest['lower_leg' + sfx]
            Ms = self.aim_matrix(base_s, K, A - K)
            self.place(posed, basis, 'lower_leg' + sfx, Ms)
            # 발은 몸이 틀어져도 바닥을 향한 채로 있다
            Rf = self.rest['foot' + sfx].to_3x3()
            Mf = (Quaternion((-1, 0, 0), -fp).to_matrix() @ Rf).to_4x4()
            Mf.translation = A
            self.place(posed, basis, 'foot' + sfx, Mf)
        return basis, posed


# --------------------------------------------------------------------------- 키프레임 찍기
def bake_clips(rig, P, make_clips, log=print):
    """make_clips(sv, P) -> [(이름, 자세 함수, 길이(초), 되풀이 여부, 겹치기 지연(초)), ...]"""
    sv = Solver(rig, P)
    clips = make_clips(sv, P)
    sc = bpy.context.scene
    sc.render.fps = FPS
    rig.animation_data_create()
    bpy.context.view_layer.objects.active = rig
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    loc_bones = {'root', 'hips', 'lower_leg.L', 'lower_leg.R', 'foot.L', 'foot.R'}
    scale_bones = {'spine', 'chest'}
    skip = {'hand_grip.L', 'hand_grip.R', 'thumb.L', 'thumb.R'}
    info = []
    for name, fn, dur, loop, lag in clips:
        act = bpy.data.actions.new(name)
        rig.animation_data.action = act
        nframes = max(1, round(dur * FPS))
        last_q = {}
        prev_head = None
        cap_v = 0.0
        for f in range(nframes + 1):
            t = f / FPS
            if loop and f == nframes:
                t = 0.0                                   # 되풀이 클립은 끝 = 처음
            pose = fn(t)
            # 겹치기: 고개는 lag 초 전의 자세를 따라온다
            late = None
            if lag > 0:
                tl = (t - lag) % dur if loop else max(0.0, t - lag)
                late = fn(tl)
            # 모자: 머리가 위아래로 움직이는 속도에 밀려 살짝 들썩인다
            dt = 1.0 / FPS
            ta, tb = ((t - dt) % dur, (t + dt) % dur) if loop else (max(0, t - dt), min(dur, t + dt))
            pa, pb_ = fn(ta), fn(tb)
            vy = ((pb_.hop + pb_.by) - (pa.hop + pa.by)) / (2 * dt)
            cap_pitch = clamp(-vy * 0.10, -0.12, 0.12)
            basis, posed = sv.solve(pose, late, cap_pitch)
            for bname, M in basis.items():
                if bname in skip:
                    continue
                pbone = rig.pose.bones[bname]
                loc, q, s = M.decompose()
                if bname in last_q and last_q[bname].dot(q) < 0:
                    q.negate()
                last_q[bname] = q.copy()
                pbone.rotation_quaternion = q
                pbone.keyframe_insert('rotation_quaternion', frame=f)
                if bname in loc_bones:
                    pbone.location = loc
                    pbone.keyframe_insert('location', frame=f)
                if bname in scale_bones:
                    pbone.scale = s
                    pbone.keyframe_insert('scale', frame=f)
        info.append((name, nframes, act))
        log(f'  clip {name}: {nframes} frames')
    # NLA 트랙 하나에 클립 하나: glTF 로 내보낼 때 트랙 이름이 클립 이름이 된다
    ad = rig.animation_data
    ad.action = None
    for name, nframes, act in info:
        tr = ad.nla_tracks.new()
        tr.name = name
        st = tr.strips.new(name, 0, act)
        st.name = name
        tr.mute = False
    for pb in rig.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    return [(n, f) for n, f, _ in info]


# --------------------------------------------------------------------------- 자세 검사
def verify_poses(rig, P, make_clips, log=print):
    """
    모든 클립의 자세를 훑어 "팔이 몸통이나 머리를 파고드는지", "팔꿈치와 무릎이 지나치게 접히는지"를 숫자로 확인한다.
    (눈으로 보는 대신) 손목, 손, 팔꿈치가 몸통 캡슐과 머리 공에서 얼마나 떨어져 있는지를 잰다. 음수면 파고든 것이다.
    """
    sv = Solver(rig, P)
    torso_r, arm_r, head_r = 0.118, P['arm_r'], min(P['head_r'])
    worst = {}
    for name, fn, dur, loop, lag in make_clips(sv, P):
        n = max(1, round(dur * FPS))
        clear_t, clear_h, elbow, knee, stretch = 9.0, 9.0, 180.0, 180.0, 1.0
        for f in range(n + 1):
            basis, posed = sv.solve(fn(f / FPS))
            a = posed['hips'].translation
            b = (posed['neck']).translation
            hc = posed['head'] @ sv.rest['head'].inverted() @ Vector((0, 0, P['head_z']))
            for sfx in ('.R', '.L'):
                E = posed['forearm' + sfx].translation
                W = posed['hand' + sfx].translation
                G = sv.grip(posed, sfx)
                S = posed['upper_arm' + sfx].translation
                for pt, r in ((E, arm_r), (W, arm_r), (G, P['hand_r'] * 0.7)):
                    ab = b - a
                    t = clamp((pt - a).dot(ab) / ab.length_squared, 0, 1)
                    clear_t = min(clear_t, (pt - (a + ab * t)).length - torso_r - r)
                    if pt is not E:
                        clear_h = min(clear_h, (pt - hc).length - head_r - r)
                elbow = min(elbow, math.degrees((S - E).angle(W - E)))
                Hj = posed['upper_leg' + sfx].translation
                K = posed['lower_leg' + sfx].translation
                A = posed['foot' + sfx].translation
                knee = min(knee, math.degrees((Hj - K).angle(A - K)))
                stretch = max(stretch, ((K - Hj).length + (A - K).length) / (sv.thigh + sv.shin))
        worst[name] = (clear_t, clear_h, elbow, knee, stretch)
        flag = ' <- 확인 필요' if clear_t < -0.015 or clear_h < -0.03 or elbow < 25 or stretch > 1.4 else ''
        log(f'  검사 {name:10s} 몸통과의 틈 {clear_t * 100:+5.1f} cm, 머리와의 틈 {clear_h * 100:+5.1f} cm, 팔꿈치 최소 {elbow:5.1f} 도, 무릎 최소 {knee:5.1f} 도, 다리 늘어남 x{stretch:.2f}{flag}')
    return worst
