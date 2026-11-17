"""
clips_referee.py - 심판 선생님의 동작(자세 함수).

  Idle            기록판을 품에 안고 깃발을 내려 든 채 숨을 쉰다(4 초에 한 바퀴)
  WatchPlane      깃발을 반쯤 들고 발끝으로 서서 비행기를 지켜본다
  RaiseFlag       깃발 번쩍! 0~0.5 초 = 움츠렸다 올리기, 그 뒤 1 초는 든 채로 흔들기(게임이 뒤쪽 1 초를 되풀이한다)
  PointToLanding  깃발로 앞(+X)을 가리킨다. 0~0.5 초 = 뻗기, 그 뒤 1 초는 까딱이기. 어느 쪽을 가리킬지는 게임이 허리를 돌려 맞춘다.
  Clap            "잘했어요!" 깃발 든 손으로 기록판을 톡톡 치며 들썩인다(0.8 초에 두 번)
  WalkCycle       제자리 걷기 한 바퀴(1 초). 게임이 자리를 옮겨 주면 걷는 것처럼 보인다.

자세의 좌표는 캐릭터 기준: +X 앞, +Y 위, +Z 오른쪽, 키 = 1. 소품(rprop, lprop)은 (세운 방향, 앞면이 보는 방향).
"""
import math
from dataclasses import replace

from anim import Solver, clamp, ease, overshoot


def make_clips(sv: Solver, P):
    R = sv.rest_pose
    sh, hip, fz = sv.sh, sv.hip, sv.foot_z
    TAU = 2 * math.pi
    # 기록판을 품에 안은 왼손, 깃발을 내려 든 오른손
    BOARD_H = (0.135, hip + 0.050, -0.105)
    BOARD = ((-0.26, 0.94, -0.16), (1.0, 0.22, -0.30))        # 왼쪽 옆구리에 끼고 살짝 뒤로 기댄다. 종이가 앞을 본다.
    FLAG_H = (0.055, hip - 0.005, 0.185)
    FLAG_DOWN = ((0.30, 0.82, 0.48), (-0.5, -0.5, 0.2))       # 깃대는 바깥 위로, 천은 뒤로 늘어진다

    def base(t, amp=1.0):
        breath = math.sin(TAU * t / 2.0)
        sway = math.sin(TAU * t / 4.0)
        p = replace(R)
        p.squash = 1 + breath * 0.010 * amp
        p.bz = sway * 0.006 * amp
        p.roll = sway * 0.014 * amp
        p.lh = (BOARD_H[0], BOARD_H[1] + breath * 0.004 * amp, BOARD_H[2])
        p.lprop = BOARD
        p.lelbow = (-0.3, -0.5, -1.0)
        p.rh = (FLAG_H[0] + sway * 0.006 * amp, FLAG_H[1] + breath * 0.004 * amp, FLAG_H[2])
        p.rprop = FLAG_DOWN
        p.flag = math.sin(TAU * t / 2.0 + 0.6) * 0.10
        return p, breath, sway

    def idle(t):
        p, breath, sway = base(t)
        p.ht = math.sin(TAU * t / 4.0 + 0.8) * 0.03
        p.twist = math.sin(TAU * t / 4.0 + 1.6) * 0.025
        return p

    def watch(t):
        # 발끝으로 서서 몸을 살짝 내밀고, 깃발을 가슴 높이로 들고 기다린다(1.6 초에 한 번 들썩)
        p, breath, sway = base(t, 0.5)
        b = abs(math.sin(TAU * t / 1.6))
        p.by = 0.008 + b * 0.010
        p.rf = (0, 0, fz, 0.16 + b * 0.04)
        p.lf = (0, 0, -fz, 0.16 + b * 0.04)
        p.lean = -0.07
        p.hp = 0.10
        p.rh = (0.150, sh - 0.085 + b * 0.008, 0.200)
        p.rprop = ((0.12, 0.96, 0.22), (0.9, -0.1, 0.3))
        p.relbow = (-0.3, -0.6, 1.0)
        p.lh = (BOARD_H[0] - 0.02, BOARD_H[1] - 0.035, BOARD_H[2] - 0.01)
        p.flag = math.sin(TAU * t / 0.8) * 0.16
        return p

    def raise_flag(t):
        # 움츠렸다가(예비 동작) 번쩍 들어 올리고, 든 채로 좌우로 흔든다
        p, breath, sway = base(t, 0.3)
        up = overshoot((t - 0.12) / 0.30) if t > 0.12 else 0.0
        dip = math.sin(clamp(t / 0.14, 0, 1) * math.pi) * (1 if t < 0.14 else 0)
        wv = math.sin(TAU * (t - 0.5) / 0.5) if t > 0.5 else 0.0
        p.by = -dip * 0.025
        p.squash = 1 - dip * 0.05 + 0.05 * math.sin(clamp((t - 0.12) / 0.3, 0, 1) * math.pi)
        y0, y1 = FLAG_H[1], sh + 0.275
        p.rh = (0.04 + 0.03 * up, y0 + (y1 - y0) * up, 0.185 + 0.04 * up + wv * 0.030)
        k = clamp(up, 0, 1)
        p.rprop = ((0.30 * (1 - k) + 0.04, 0.82 * (1 - k) + k, 0.48 * (1 - k) + 0.10 * k + wv * 0.20), (-0.5 * (1 - k) + 0.75 * k, -0.5 * (1 - k), 0.2 * (1 - k) - 0.65 * k))
        p.relbow = (-0.2, -0.3, 1.0)
        p.flag = wv * 0.55 + 0.25 * (1 - k)
        p.roll = wv * 0.03
        p.hp = 0.10 * k
        p.lean = 0.03 * k
        p.rf = (0, 0, fz, 0.10 * k)
        p.lf = (0, 0, -fz, 0.10 * k)
        p.by += 0.006 * k
        return p

    def point(t):
        # 깃발 든 팔을 앞으로 쭉 뻗어 가리킨다. 반대쪽 다리에 무게를 싣고 몸을 살짝 기울인다.
        p, breath, sway = base(t, 0.3)
        k = overshoot(t / 0.36)
        kk = clamp(k, 0, 1.05)
        nod = math.sin(TAU * (t - 0.5) / 1.0) if t > 0.5 else 0.0
        x1, y1, z1 = 0.335, sh - 0.012 + nod * 0.012, 0.115
        p.rh = (FLAG_H[0] + (x1 - FLAG_H[0]) * kk, FLAG_H[1] + (y1 - FLAG_H[1]) * kk, FLAG_H[2] + (z1 - FLAG_H[2]) * kk)
        c = clamp(k, 0, 1)
        p.rprop = ((0.30 * (1 - c) + 0.97 * c, 0.82 * (1 - c) + (0.22 + nod * 0.05) * c, 0.48 * (1 - c) + 0.04 * c), (-0.5 * (1 - c) + 0.1 * c, -0.5 * (1 - c) - 1.0 * c, 0.2 * (1 - c)))
        p.relbow = (-0.2, -0.8, 0.6)
        p.twist = 0.16 * c
        p.lean = -0.06 * c
        p.bx = 0.012 * c
        p.flag = nod * 0.20
        p.hp = 0.03
        return p

    def clap(t):
        # 기록판을 앞에 받쳐 들고 깃발 든 손으로 톡톡 친다. 칠 때마다 살짝 들썩인다.
        p, breath, sway = base(t, 0.0)
        period = 0.4
        u = (t % period) / period
        hit = math.sin(u * math.pi) ** 2            # 0 = 떨어짐, 1 = 닿음
        beat = int(t / period) % 2
        p.lh = (0.205, sh - 0.150, -0.020)
        p.lprop = ((0.10, 0.80, 0.50), (0.80, 0.35, -0.50))
        p.lelbow = (-0.2, -0.7, -1.0)
        p.rh = (0.215 - 0.015 * hit, sh - 0.075 - 0.020 * hit, 0.185 - 0.115 * hit)
        p.rprop = ((-0.05, 0.92, 0.40 - 0.25 * hit), (0.9, 0.0, 0.3))
        p.relbow = (-0.2, -0.5, 1.0)
        p.hop = (1 - hit) * 0.016
        p.squash = 1 + (1 - hit) * 0.03 - hit * 0.035
        p.by = -hit * 0.010
        p.roll = (0.035 if beat else -0.035) * (1 - hit)
        p.hp = 0.06
        p.ht = (0.05 if beat else -0.05) * (1 - hit)
        p.flag = (hit - 0.5) * 0.7
        return p

    def walk(t):
        # 제자리 걷기: 발은 번갈아 뒤에서 앞으로, 반대쪽 팔이 같이 나간다(소품을 든 채라 팔은 작게 흔든다)
        p, breath, sway = base(t, 0.0)
        ph = TAU * t / 1.0
        s, c = math.sin(ph), math.cos(ph)
        stride, lift = 0.060, 0.030
        p.rf = (s * stride, max(0.0, c) * lift, fz, max(0.0, c) * 0.35 - min(0.0, s) * 0.0)
        p.lf = (-s * stride, max(0.0, -c) * lift, -fz, max(0.0, -c) * 0.35)
        p.by = -0.004 + abs(c) * 0.008
        p.twist = -s * 0.07
        p.roll = c * 0.02
        p.rh = (FLAG_H[0] - s * 0.045, FLAG_H[1] + abs(s) * 0.008, FLAG_H[2])
        p.lh = (BOARD_H[0] + s * 0.012, BOARD_H[1], BOARD_H[2])
        p.flag = s * 0.25
        p.hp = 0.02
        return p

    # (이름, 자세 함수, 길이(초), 되풀이 여부, 겹치기 지연(초))
    return [
        ('Idle', idle, 4.0, True, 0.05),
        ('WatchPlane', watch, 1.6, True, 0.04),
        ('RaiseFlag', raise_flag, 1.5, False, 0.04),
        ('PointToLanding', point, 1.5, False, 0.04),
        ('Clap', clap, 0.8, True, 0.03),
        ('WalkCycle', walk, 1.0, True, 0.03),
    ]
