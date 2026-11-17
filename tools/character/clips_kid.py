"""
clips_kid.py - 주인공 아이의 동작 12 개(자세 함수). 풀이와 키프레임 찍기는 anim.py 가 한다.

자세의 좌표는 게임과 같은 "캐릭터 기준": +X 앞, +Y 위, +Z 오른쪽, 키 = 1.
"""
import math
from dataclasses import replace

from anim import Solver, clamp, ease, overshoot


def make_clips(sv: Solver, P):
    R = sv.rest_pose
    sh, hip, fz = sv.sh, sv.hip, sv.foot_z
    headY = P['head_z'] + 0.012
    TAU = 2 * math.pi
    # 게임이 조준할 때 비행기를 드는 자리(GymStage.heldPos 를 캐릭터 기준으로 옮긴 값. HOLD_AT, HOLD_PULL 과 같아야 한다)
    SC, KX, KY, KZ, H0, DROP = 1.64, -0.4, 0.14, -0.56, 1.6, 0.105
    HA, HP = (-0.66, -0.17, -0.14), (-0.26, -0.07, 0.02)

    def hold(pull, swing=0.0):
        if swing <= 0:
            wx, wy, wz = HA[0] + HP[0] * pull, H0 + HA[1] + HP[1] * pull, HA[2] + HP[2] * pull
        else:
            s = swing * swing
            x1, y1, z1 = HA[0] + HP[0], H0 + HA[1] + HP[1], HA[2] + HP[2]
            wx, wy, wz = x1 * (1 - s), y1 + (H0 - y1) * s + 0.06 * math.sin(math.pi * swing), z1 * (1 - s)
        return ((wx - KX) / SC, (wy - DROP - KY) / SC, (wz - KZ) / SC)

    def base(t, breath_amp=1.0):
        """모든 자세의 바탕: 숨쉬기와 무게 옮기기(4 초에 한 바퀴)"""
        breath = math.sin(TAU * t / 2.0)
        sway = math.sin(TAU * t / 4.0)
        p = replace(R)
        p.squash = 1 + breath * 0.014 * breath_amp
        p.bz = sway * 0.008 * breath_amp
        p.roll = sway * 0.02 * breath_amp
        return p, breath, sway

    def idle(t):
        p, breath, sway = base(t)
        # 팔은 숨에 맞춰 살짝 벌어지고, 무게를 싣는 쪽으로 엉덩이가 간다
        p.rh = (0.035 + sway * 0.012, R.rh[1] + breath * 0.006, R.rh[2] + breath * 0.006)
        p.lh = (0.035 - sway * 0.012, R.lh[1] + breath * 0.006, R.lh[2] - breath * 0.006)
        p.ht = math.sin(TAU * t / 4.0 + 0.8) * 0.04
        p.twist = math.sin(TAU * t / 4.0 + 1.6) * 0.03
        p.by = -abs(sway) * 0.004
        return p

    def home(t):
        # 비행기를 자랑스럽게 들고, 가끔 손을 흔든다(6 초에 한 번)
        p, breath, sway = base(t)
        D = 6.0
        cyc = (t % D) / D
        waving = cyc < 0.42
        w = ease(min(cyc / 0.07, (0.42 - cyc) / 0.07)) if waving else 0.0
        wav = math.sin(TAU * 9 * t / D)
        p.lh = (0.06 + w * 0.02, 0.30 + w * 0.60 + wav * 0.02 * w, -0.20 - w * 0.12 + wav * 0.07 * w)
        p.rh = (0.165, 0.612 + breath * 0.008, 0.282)     # 비행기 든 손은 볼에 닿지 않게 어깨 바깥, 턱 높이
        p.hop = max(0.0, math.sin(TAU * 2 * t / D)) * 0.012
        p.ht = math.sin(TAU * t / D) * 0.07 + w * 0.08
        p.twist = math.sin(TAU * t / D + 1.0) * 0.08
        p.lean = 0.03
        p.lwrist = wav * 0.25 * w
        return p

    def aim(pitch_deg, k=0.0, t=0.0):
        p, breath, sway = base(t, 0.0)
        a = math.radians(pitch_deg)
        p.lf = (0.085, 0, -0.09, 0)
        p.rf = (-0.065, k * 0.012, 0.09, k * 0.25)
        p.twist = -0.38 - 0.42 * k
        p.lean = 0.04 + 0.2 * k
        p.bx = -0.01 - 0.06 * k
        p.by = -0.008 - 0.03 * k
        p.squash = 1 - 0.05 * k
        reach = 0.27 + 0.05 * k
        p.lh = (0.04 + math.cos(a) * reach, sh - 0.02 + math.sin(a) * reach, -0.13)
        p.rh = hold(k)
        p.hy = -0.52 - p.twist
        p.hp = clamp(a * 0.4, -0.2, 0.42) + k * 0.05
        p.ht = -0.14
        p.roll = 0.07
        return p

    def windup(t):
        return aim(20, clamp(t, 0, 1))

    def throw(s):
        # s: 0~1 뒤로 젖힘(예비 동작), 1~2 휘두름, 2~3 마무리(따라가기 + 폴짝)
        p, _, _ = base(0, 0.0)
        a = math.radians(20)
        if s < 1:
            k = ease(s)
            p.lf = (0.1, 0.045 * math.sin(k * math.pi), -0.09, 0)
            p.rf = (-0.07, 0, 0.09, 0)
            p.twist = -0.8 - 0.25 * k
            p.lean = 0.24 + 0.1 * k
            p.bx = -0.07 - 0.04 * k
            p.by = -0.04 - 0.02 * k
            p.squash = 0.95 - 0.03 * k
            p.lh = (0.04 + math.cos(a) * 0.32, sh + 0.02 + math.sin(a) * 0.32, -0.1)
            p.rh = hold(0.6 + 0.4 * k)
            p.hy = -0.3 - p.twist
            p.hp = 0.1
        elif s < 2:
            k = s - 1
            e = k * k
            p.lf = (0.12, 0, -0.09, 0)
            p.rf = (-0.08 + 0.02 * e, 0.03 * e, 0.09, 0.5 * e)
            p.twist = -1.05 + 1.5 * e
            p.lean = 0.34 - 0.62 * e
            p.bx = -0.11 + 0.2 * e
            p.by = -0.06 + 0.08 * e
            p.squash = 0.92 + 0.2 * e
            p.hop = 0.03 * e
            p.lh = (0.3 - 0.36 * e, sh + 0.1 - 0.26 * e, -0.12 - 0.12 * e)
            p.rh = hold(1, k)
            p.hy = -0.3 - p.twist * 0.6
            p.hp = 0.12
        else:
            k = clamp(s - 2, 0, 1)
            air = math.sin(min(1, k / 0.55) * math.pi)
            land = math.sin(clamp((k - 0.55) / 0.3, 0, 1) * math.pi) if k > 0.55 else 0.0
            p.hop = 0.03 * (1 - ease(k * 3)) + air * 0.07
            p.squash = 1.1 - 0.1 * k - land * 0.12 + air * 0.02
            p.twist = 0.45 + 0.25 * ease(k * 2) - 0.5 * ease((k - 0.5) * 2)
            p.lean = -0.28 - 0.1 * ease(k * 2) + 0.3 * ease((k - 0.45) * 2)
            p.bx = 0.09 - 0.07 * ease((k - 0.4) * 2)
            p.by = 0.02 - land * 0.035
            p.lf = (0.12, air * 0.03, -0.09, 0)
            back = ease((k - 0.5) * 2.5)
            p.rf = (-0.12 - air * 0.1 + (0.14 + air * 0.1) * back, (0.03 + air * 0.13) * (1 - back), 0.085, (0.5 + air * 0.6) * (1 - back))
            # 던진 팔: 놓은 자리에서 앞 아래로 큰 호를 그리며 내려온다(따라가기). 팔꿈치는 몸 바깥으로.
            f = ease(k * 1.6)
            r0, r1 = hold(1, 1), (0.25, sh - 0.27, 0.03)
            arc = math.sin(math.pi * f)
            p.rh = (r0[0] + (r1[0] - r0[0]) * f + arc * 0.08, r0[1] + (r1[1] - r0[1]) * f, r0[2] + (r1[2] - r0[2]) * f)
            p.relbow = (0.1, -0.5, 1.0)
            p.lh = (-0.08, sh - 0.2, -0.26)
            # 고개는 날아가는 비행기를 좇아 서서히 돌아온다
            hk = ease(k * 3)
            p.hy = (-0.3 - 0.45 * 0.6) * (1 - hk) + 0.1 * hk
            p.hp = 0.12 + 0.08 * hk - 0.1 * k
        return p

    def watch(t):
        # 손차양을 하고 발끝으로 서서 들썩인다(0.6 초에 한 번)
        p, breath, sway = base(t, 0.5)
        b = abs(math.sin(TAU * t / 1.2))
        p.by = 0.012 + b * 0.014
        p.rf = (0, 0, fz, 0.18 + b * 0.05)
        p.lf = (0, 0, -fz, 0.18 + b * 0.05)
        p.lean = -0.06
        p.hp = 0.1
        p.rh = (0.24, headY + 0.05, 0.11)
        p.relbow = (-0.15, -0.25, 1.0)
        p.lh = (0.03, hip + 0.07, -0.15)
        p.squash = 1 + b * 0.02
        return p

    def cheer(t):
        # 만세: 움츠렸다가(예비 동작) 폴짝, 착지에서 눌린다. 두 번 뛰면 한 바퀴(좌우로 번갈아 튼다).
        p, _, _ = base(0, 0.0)
        period = 0.55
        n = int(t / period)
        u = (t % period) / period
        crouch = math.sin((u / 0.22) * math.pi * 0.5) if u < 0.22 else 0.0
        air = math.sin(((u - 0.22) / 0.58) * math.pi) if 0.22 <= u < 0.8 else 0.0
        land = math.sin(((u - 0.8) / 0.2) * math.pi) if u >= 0.8 else 0.0
        p.hop = air * 0.2
        p.by = -crouch * 0.05 - land * 0.04
        p.squash = 1 - crouch * 0.12 + air * 0.10 - land * 0.13
        up = 1 - crouch * 0.6 if u < 0.22 else 1.0
        wv = math.sin(TAU * t / period) * 0.04
        # 팔은 몸보다 한 박자 늦게 올라가고 늦게 내려온다(겹치기)
        late = ease((u - 0.1) / 0.3) if u < 0.5 else 1.0
        ay = sh + 0.05 + up * 0.36 * (0.75 + 0.25 * late)
        p.rh = (0.04, ay, 0.21 + up * 0.11 + wv)
        p.lh = (0.04, ay, -0.21 - up * 0.11 - wv)
        p.rf = (0, air * 0.035, fz + air * 0.03, air * 0.4)
        p.lf = (0, air * 0.035, -fz - air * 0.03, air * 0.4)
        p.twist = (1 if n % 2 else -1) * air * 0.25
        p.hp = 0.15 + air * 0.15
        return p

    def cheer_hold(t):
        # 뛰고 난 뒤: 두 팔을 든 채 좌우로 흔든다
        p, breath, _ = base(t, 0.6)
        wv = math.sin(TAU * t / 1.0)
        p.rh = (0.05, sh + 0.35, 0.31 + wv * 0.03)
        p.lh = (0.05, sh + 0.35, -0.31 - wv * 0.03)
        p.roll = wv * 0.05
        p.bz = wv * 0.01
        p.hp = 0.12
        p.ht = wv * 0.04
        return p

    def nod(t):
        # 끄덕끄덕 + 작은 주먹 "좋았어!"
        p, breath, _ = base(t, 0.5)
        u = clamp(t / 0.5, 0, 3)
        pump = math.sin((u % 1) * math.pi) if u < 2 else 0.0
        settle = ease((t - 1.0) / 0.5)
        p.rh = (0.13 * (1 - settle) + 0.035 * settle, (sh + 0.02 - pump * 0.1) * (1 - settle) + R.rh[1] * settle, 0.17 * (1 - settle) + R.rh[2] * settle)
        p.lh = (0.03, hip + 0.07, -0.15)
        p.by = -pump * 0.03
        p.squash -= pump * 0.06
        p.hp = -pump * 0.3 + 0.05 * (1 - settle)
        p.twist = -0.15 * (1 - settle)
        return p

    def slump(t):
        # 털썩 처졌다가(1.1 초) 주먹을 불끈 쥔다
        p, breath, _ = base(t, 0.3)
        if t < 1.1:
            k = overshoot(t / 0.35)
            p.lean = -0.2 * k
            p.by = -0.05 * k
            p.squash = 1 - 0.09 * k
            p.hp = -0.16 * k
            p.hy = -0.45 * k
            p.ht = math.sin(t * 5) * 0.05
            p.rh = (0.14, hip - 0.02, 0.13 + math.sin(t * 3.2) * 0.02)
            p.lh = (0.14, hip - 0.02, -0.13 - math.sin(t * 3.2 + 1) * 0.02)
        else:
            k = overshoot((t - 1.1) / 0.3)
            shake = math.sin(t * 16) * 0.012 * (1 - ease((t - 1.9) / 0.3))
            p.squash = 1 + 0.06 * math.sin(clamp((t - 1.1) / 0.3, 0, 1) * math.pi)
            p.rh = (0.12, hip + 0.05 + k * (sh - hip + 0.05) + shake, 0.19)
            p.lh = (0.03, hip + 0.07, -0.15)
            p.hp = 0.1
            p.twist = -0.2
            p.rwrist = -0.2
        return p

    # (이름, 자세 함수, 길이(초), 되풀이 여부, 겹치기 지연(초))
    return [
        ('Idle', idle, 4.0, True, 0.05),
        ('Home', home, 6.0, True, 0.05),
        ('AimLow', lambda t: aim(-20), 0.05, False, 0),
        ('AimMid', lambda t: aim(20), 0.05, False, 0),
        ('AimHigh', lambda t: aim(60), 0.05, False, 0),
        ('WindUp', windup, 1.0, False, 0),
        ('Throw', throw, 3.0, False, 0),
        ('Watch', watch, 1.2, True, 0.04),
        ('Cheer', cheer, 1.1, True, 0.04),
        ('CheerHold', cheer_hold, 1.0, True, 0.05),
        ('Nod', nod, 1.6, False, 0.04),
        ('Slump', slump, 2.6, False, 0.05),
    ]
