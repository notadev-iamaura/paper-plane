"""
chars/referee.py - 심판 선생님의 생김새. 아이와 같은 부분 함수(parts.py)를 비율과 옵션만 바꿔 쓴다.

  - 3 등신쯤의 어른 비율: 머리 크기는 아이와 비슷하고 몸과 다리가 길다(P['zmap'] 이 아이의 고리 높이를 이 몸으로 옮긴다).
  - 단발머리(모자 없음, 귀를 덮는다), 동그란 안경(실제 모양), 청록 운동복 윗도리(세운 깃, 지퍼, 소매와 밑단의 고무단),
    남색 긴바지, 흰 운동화, 목에 건 호루라기, 왼손의 기록판, 오른손의 손깃발.
  - 소품은 손의 쥐는 점에 달린 뼈(prop.L, prop.R)를 따르고, 깃발 천은 flag 뼈로 펄럭인다.
"""
import copy
import math
import os

import meshkit as mk
import parts
import clips_referee

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))

# =========================================================================== 비율(키 = 1 기준)
P = dict(
    # 관절 높이와 폭
    ankle_z=0.060, knee_z=0.205, hip_z=0.355, leg_x=0.058, sock_z=0.085, crotch_z=0.330,
    hem_z=0.385, shoulder_z=0.600, shoulder_x=0.103,
    # 아이의 고리 높이 -> 이 몸의 높이(발목, 무릎, 가랑이, 엉덩이, 밑단, 배, 어깨, 목 둘레, 턱 밑)
    zmap=[(0.0, 0.0), (0.07, 0.06), (0.16, 0.205), (0.222, 0.33), (0.25, 0.355), (0.292, 0.385), (0.345, 0.447),
          (0.505, 0.600), (0.546, 0.636), (0.615, 0.678)],
    torso_w=0.86, neck_w=0.90, leg_w=0.95,
    arm_down_deg=52, elbow_bend=0.16, upper_arm=0.165, forearm=0.155, hand=0.075,
    arm_r=0.039, hand_r=0.052,
    tummy=0.03, butt=0.05,
    # 머리: 아이보다 조금 작고 갸름하다
    head_z=0.815, head_r=(0.172, 0.165, 0.163),
    jaw_wide=0.05, face_flat=0.07, cheek=0.010, cheek_z=-0.070, nose=0.009, nose_z=-0.058, nose_r=0.026,
    eye_socket=0.003, eye_px=(37, 106), mouth_dimple=0.0, mouth_px=(0, 143),
    face_half_az=1.05 * 1.22, face_polar0=(0.505 - 0.25 * 1.22) * math.pi, face_polar_span=0.5 * 1.22 * math.pi, face_drop=-0.014,
    cap=False,
    # 단발머리: 앞머리는 눈썹 위, 옆과 뒤는 턱 높이까지 내려와 귀를 덮고, 끝이 살짝 바깥으로 뻗친다
    hairline=dict(
        fringe_z=0.058, fringe_wave=0.020, fringe_start=-0.95, fringe_width=0.63, fringe_vary=0.22,
        burn_az=1.12, burn_w=0.20, burn_z=-0.104,
        ear_z=-0.108, ear_end=1.75, ear_from=1.07, ear_to=1.24,
        nape_z=-0.118, nape_wave=0.010, nape_width=0.52,
        thick=0.027, chunk=0.004, fringe_puff=0.006, undercut=0.85, flare=0.22,
    ),
    hair_cols=36,
    toe_out_deg=9, shoe_scale=0.92,
    tag_pos=(0.05, 0.452), tag_size=(0.08, 0.05),
    # 옷
    top=dict(long=True, band=False, hem_band=True, collar_up=0.016, sleeve_r=0.88, arm_sleeve=1.14),
    bottom=dict(long=True, leg_r=1.0),
    detail=dict(ears=False),
    bones_skip=('cap',),
    # 안경: 테의 반지름, 굵기, 얼굴에서 띄운 거리, 얼굴을 감싸는 정도(0 = 정면을 본다, 1 = 얼굴 면을 따른다)
    glasses=dict(r=0.040, tube=0.0040, off=0.017, wrap=0.42, seg=18, thin=0.6, temple_z=-0.006, temple_out=-0.002),
    # 기록판(가로, 세로, 두께의 반, 쥐는 자리), 손깃발(깃대 길이, 손 아래로 내려온 길이, 천의 높이와 길이)
    clipboard=dict(w=0.150, h=0.200, t=0.0045, grip=0.20),
    flag=dict(pole=0.36, below=0.045, pole_r=0.0055, cloth_h=0.135, cloth_l=0.205),
)

# =========================================================================== 색(src/app/tokens.css 의 값과 같아야 한다)
TOK = dict(ink='#1d2a4d', ink_soft='#55607f', paper='#fffdf6', paper_shade='#f1ecdd', red='#ee4b3e', yellow='#ffc533', blue='#2f6fe0',
           orange='#f58a2e', pink='#f27aa6', skin='#ffd9b8', court='#e7b56e', court_dark='#c98f48', mat='#2f8f6b', sky='#4fb6e8')
JACKET = mk.mix_hex(TOK['mat'], TOK['sky'], 0.45)       # 청록(kid.ts 의 TEACHER_LOOK.top 과 같은 식)
COLORS = dict(
    skin=mk.mix_hex(TOK['skin'], TOK['court'], 0.12),
    skin_shade=mk.mix_hex(mk.mix_hex(TOK['skin'], TOK['court'], 0.12), TOK['pink'], 0.22),
    hair=mk.mix_hex(TOK['ink'], TOK['court_dark'], 0.25),
    hair_in=mk.mix_hex(TOK['ink'], TOK['court_dark'], 0.12),
    shirt=JACKET,
    collar=mk.mix_hex(TOK['paper'], JACKET, 0.10),          # 깃, 소매 끝, 밑단의 흰 고무단
    shirt_in=mk.mix_hex(JACKET, TOK['ink'], 0.42),
    zip=mk.mix_hex(TOK['paper'], TOK['ink'], 0.18),
    zip_pull=TOK['yellow'],
    shorts=TOK['ink'],
    shorts_in=mk.mix_hex(TOK['ink'], '#000000', 0.35),
    sock=TOK['paper'],
    shoe=TOK['paper'],
    shoe_in=mk.mix_hex(TOK['paper'], TOK['ink'], 0.45),
    sole=TOK['paper_shade'],
    toe=TOK['paper'],
    lace=mk.mix_hex(TOK['paper'], TOK['sky'], 0.45),
    glasses=TOK['ink'],
    lanyard=TOK['red'],
    whistle=TOK['yellow'],
    whistle_tip=mk.mix_hex(TOK['yellow'], TOK['orange'], 0.55),
    board=mk.mix_hex(TOK['court_dark'], TOK['ink'], 0.15),
    sheet=TOK['paper'],
    clip=TOK['ink_soft'],
    ink=mk.mix_hex(TOK['ink_soft'], TOK['paper'], 0.35),
    pole=TOK['ink'],
    knob=TOK['yellow'],
    cloth=TOK['red'],
)
WHITE = (0.50, (0.66, 0.68, 0.90))
AO = dict(method='auto', samples=96, distance=0.12, gain=1.0, lo=0.28, hi=0.86,
          default=(0.55, (0.55, 0.46, 0.66)),
          by_color={
              'skin': (0.30, (1.0, 0.68, 0.58), 0.16, 0.62), 'skin_shade': (0.30, (1.0, 0.68, 0.58), 0.16, 0.62),
              'shirt': (0.50, (0.42, 0.50, 0.78)),
              'collar': WHITE, 'sock': WHITE, 'shoe': WHITE, 'sole': WHITE, 'toe': WHITE, 'sheet': (0.35, (0.66, 0.68, 0.90)),
              'cloth': (0.35, (0.80, 0.40, 0.45)), 'whistle': (0.4, (0.95, 0.55, 0.30)), 'knob': (0.4, (0.95, 0.55, 0.30)),
              'shorts': (0.35, (0.55, 0.46, 0.66)),
          })


def assemble(P, pal):
    head = parts.build_head(P, pal)
    face = parts.build_face_decal(head, P)
    parts.cull_hidden_head(head, P)
    jacket = parts.build_shirt(P, pal)
    surf = parts.Surface(jacket)
    hz = P['hem_z']
    collar_z = parts.Z(P, 0.553)
    obs = [head, parts.build_neck(P, pal), jacket, parts.build_shorts(P, pal)]
    # 지퍼: 밑단에서 깃까지 앞 가운데를 따라 올라가는 선 + 손잡이
    zs = [hz + 0.004 + (collar_z + 0.012 - hz) * i / 11 for i in range(12)]
    obs.append(parts.build_ribbon(pal, 'zip', surf, [(0.0, z) for z in zs], 0.011, 0.0035, 'zip', thin=1.0))
    pull, nrm = surf.front(0.0, collar_z - 0.03)
    obs.append(parts.build_blob(pal, 'zip_pull', pull + nrm * 0.006 + parts.UP * -0.010, (0.0075, 0.005, 0.014), 'zip_pull', surf.weights_at(pull), thin=1.0, levels=0))
    # 호루라기: 목에 건 빨간 줄(V 자) 끝에 달려 있다
    wx, wz = -0.036, parts.Z(P, 0.458)       # 오른쪽 가슴(기록판을 왼쪽에 안고 있어도 보인다)
    for s_ in (1, -1):
        path = [(s_ * 0.050 + (wx - s_ * 0.050) * t, collar_z + 0.004 + (wz + 0.012 - collar_z - 0.004) * t ** 0.9) for t in [i / 7 for i in range(8)]]
        obs.append(parts.build_ribbon(pal, 'lanyard', surf, path, 0.0085, 0.0045, 'lanyard', thin=1.0))
    wp, wn = surf.front(wx, wz)
    ww = surf.weights_at(wp)
    obs.append(parts.build_blob(pal, 'whistle', wp + wn * 0.013, (0.021, 0.013, 0.016), 'whistle', ww, thin=0.5))
    obs.append(parts.build_blob(pal, 'whistle_tip', wp + wn * 0.013 + parts.Vector((-0.024, 0, 0.004)), (0.011, 0.008, 0.008), 'whistle_tip', ww, thin=0.6, levels=0))
    for side in (1, -1):
        shoe = parts.build_shoe_simple if parts.det(P, 'shoe') == 'simple' else parts.build_shoe
        obs += [parts.build_arm(P, pal, side), parts.build_leg(P, pal, side), shoe(P, pal, side)]
    obs += [parts.build_hair(P, pal), parts.build_glasses(P, pal), parts.build_clipboard(P, pal), *parts.build_flag(P, pal)]
    return dict(parts=obs, face=face, tag=None)


SPEC = dict(
    name='referee',
    out=os.path.join(ROOT, 'src', 'app', 'assets', 'referee.glb'),
    P=P, COLORS=COLORS, AO=AO,
    assemble=assemble,
    clips=clips_referee.make_clips,
    notes=lambda P_, log: log('  얼굴 그림에서의 자리(가운데 기준 x, 위에서 y):', parts.face_marks(P_)),
    thin={'Idle': 2, 'WatchPlane': 2, 'PointToLanding': 2, 'RaiseFlag': 1, 'Clap': 1, 'WalkCycle': 1},
    topology=os.path.join(ROOT, 'screenshots', 'v5-cast', 'raw', 'topology-referee.svg'),
)


# =========================================================================== 가벼운 벌(낮은 화질 단계용)
# 같은 생김새를 세분화 없이, 고리의 점 수를 줄여 만든다(삼각형이 1/4 쯤). 느린 기기는 이 파일만 내려받는다.
P_LITE = copy.deepcopy(P)
P_LITE['detail'] = dict(levels=0, head_levels=1, body_seg=12, arm_seg=6, leg_seg=8, neck_seg=6, folds=False, thumb=True, shoe='simple', ears=False)
P_LITE['hair_cols'] = 28
P_LITE['glasses'] = dict(P['glasses'], seg=12)
SPEC_LITE = dict(SPEC, P=P_LITE, out=os.path.join(ROOT, 'src', 'app', 'assets', 'referee-lite.glb'), topology=None)
