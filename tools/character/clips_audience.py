"""
clips_audience.py - 관람석 아이들의 동작(앉은 자세).

뿌리(root)는 "앉은 자리의 윗면"이다: 엉덩이가 z = 0 에 닿고, 발은 그 아래로 늘어져 달랑거린다.
  SeatedIdle  무릎에 손을 얹고 살랑살랑 흔들리며 발을 달랑거린다(4 초에 한 바퀴)
  CheerSmall  짝짝짝 손뼉(1 초에 두 번), 살짝 들썩
  CheerBig    두 팔을 번쩍 들고 흔들며 엉덩이를 들썩인다(1.2 초에 한 바퀴). 오른손의 종이 깃발도 함께 흔든다.
고개를 비행기 쪽으로 돌리는 일(LookAtPlane)은 게임이 사람마다 따로 한다(셰이더에서 머리만 돌린다).

게임은 이 클립들을 "뼈 행렬 그림"(시간 x 뼈)으로 한 번 찍어 두고, 관중 수십 명을 한 번에 그리면서 사람마다 다른 시간을 읽는다.
"""
import math
from dataclasses import replace

from anim import Solver, clamp, ease


def make_clips(sv: Solver, P):
    R = sv.rest_pose
    sh, hip, fz = sv.sh, sv.hip, sv.foot_z
    TAU = 2 * math.pi
    az = P['ankle_z']
    SEAT = -(hip - 0.058)               # 엉덩이가 자리 윗면(z = 0)에 닿는 높이
    shs = sh + SEAT                     # 앉았을 때의 어깨 높이
    thigh = P['hip_z'] - P['knee_z']
    shin = P['knee_z'] - P['ankle_z']
    foot_x = thigh + 0.012              # 발목은 무릎 바로 아래
    foot_y = 0.058 - shin - az - 0.004  # 자리 윗면보다 아래(걸터앉아 발이 뜬다)
    LAP = 0.058 + 0.062                 # 무릎 위에 손을 얹는 높이

    def seated(t, amp=1.0):
        breath = math.sin(TAU * t / 2.0)
        sway = math.sin(TAU * t / 4.0)
        p = replace(R)
        p.by = SEAT
        p.squash = 1 + breath * 0.012 * amp
        p.roll = sway * 0.035 * amp
        p.bz = sway * 0.006 * amp
        k = math.sin(TAU * t / 2.0 + 0.4)         # 발 달랑달랑(좌우가 엇갈린다)
        p.rf = (foot_x + k * 0.022 * amp, foot_y + abs(k) * 0.004, fz, 0.25 + k * 0.12)
        p.lf = (foot_x - k * 0.022 * amp, foot_y + abs(k) * 0.004, -fz, 0.25 - k * 0.12)
        p.rh = (0.105, LAP + breath * 0.003, 0.072)
        p.lh = (0.105, LAP + breath * 0.003, -0.072)
        p.relbow = (-0.5, -0.2, 1.0)
        p.lelbow = (-0.5, -0.2, -1.0)
        p.rprop = ((-0.12, 0.93, 0.34 + sway * 0.05), (0.2, 0.0, 1.0))     # 깃발은 어깨 바깥으로 기울여 든다(옆 사람 얼굴을 가리지 않게)
        return p, breath, sway

    def idle(t):
        p, breath, sway = seated(t)
        p.ht = math.sin(TAU * t / 4.0 + 0.8) * 0.05
        p.lean = 0.02 + breath * 0.008
        return p

    def cheer_small(t):
        p, breath, sway = seated(t, 0.4)
        period = 0.5
        u = (t % period) / period
        hit = math.sin(u * math.pi) ** 2
        y = shs - 0.035 + 0.01 * hit
        gap = 0.085 - 0.062 * hit
        p.rh = (0.165, y, gap)
        p.lh = (0.165, y, -gap)
        p.relbow = (-0.2, -0.6, 1.0)
        p.lelbow = (-0.2, -0.6, -1.0)
        p.hop = (1 - hit) * 0.010
        p.squash = 1 + (1 - hit) * 0.03 - hit * 0.02
        p.roll = math.sin(TAU * t / 1.0) * 0.05
        p.hp = 0.08
        p.rprop = ((0.2, 0.9, 0.3 - 0.2 * hit), (0.2, 0.0, 1.0))
        return p

    def cheer_big(t):
        p, breath, sway = seated(t, 0.0)
        D = 1.2
        b = abs(math.sin(TAU * t / D))                # 한 바퀴에 두 번 들썩
        wv = math.sin(TAU * t / D)
        wv2 = math.sin(TAU * 2 * t / D)
        p.hop = b * 0.034
        p.squash = 1 + b * 0.07 - (1 - b) * 0.05
        p.lean = 0.07
        p.roll = wv * 0.07
        # 팔이 짧아서 머리 위로는 못 올린다: 얼굴을 가리지 않게 양옆으로 넓게 벌려 든다
        p.rh = (0.045, shs + 0.235 + b * 0.02, 0.285 + wv * 0.045)
        p.lh = (0.045, shs + 0.235 + b * 0.02, -0.285 + wv * 0.045)
        p.hp = 0.14 + b * 0.05
        p.ht = wv * 0.06
        p.rf = (foot_x + 0.03 + wv2 * 0.03, foot_y + 0.012 + b * 0.02, fz + 0.012, 0.1)
        p.lf = (foot_x + 0.03 - wv2 * 0.03, foot_y + 0.012 + b * 0.02, -fz - 0.012, 0.1)
        p.rprop = ((0.02, 0.9, 0.12 + wv * 0.55), (0.3, 0.0, 1.0))
        return p

    # (이름, 자세 함수, 길이(초), 되풀이 여부, 겹치기 지연(초))
    return [
        ('SeatedIdle', idle, 4.0, True, 0.05),
        ('CheerSmall', cheer_small, 1.0, True, 0.03),
        ('CheerBig', cheer_big, 1.2, True, 0.04),
    ]
