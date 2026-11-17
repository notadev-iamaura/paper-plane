"""
chars/kid.py - 주인공 아이의 생김새(비율, 색, 그늘)와 부분 목록.

모양이나 색을 바꾸고 싶으면 아래의 P(비율)와 COLORS(색), AO(그늘)만 고치고 build_kid.py 를 다시 실행하면 된다.
"""
import math
import os

import meshkit as mk
import parts
import clips_kid

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))

# =========================================================================== 비율(키 = 1 기준)
P = dict(
    # 관절 높이와 폭
    ankle_z=0.070, knee_z=0.160, hip_z=0.250, leg_x=0.068, sock_z=0.110, crotch_z=0.222,
    hem_z=0.292, shoulder_z=0.505, shoulder_x=0.116,
    # 팔: A 자 자세(수평에서 아래로 내린 각도), 길이
    arm_down_deg=48, elbow_bend=0.16, upper_arm=0.170, forearm=0.155, hand=0.085,
    arm_r=0.043, hand_r=0.060,   # 팔 굵기, 손 크기(벙어리장갑의 반폭)
    # 몸통의 살
    tummy=0.06, butt=0.06,
    # 머리: 중심 높이, 반지름(좌우, 앞뒤, 위아래). 2.4 등신.
    head_z=0.752, head_r=(0.210, 0.200, 0.196),
    jaw_wide=0.07, face_flat=0.07, cheek=0.016, cheek_z=-0.086, nose=0.010, nose_z=-0.076, nose_r=0.030,
    # 눈자리(얼굴 그림의 눈 위치: 가운데에서 좌우로 42 화소, 위에서 110 화소)를 얕게 누른다
    eye_socket=0.0035, eye_px=(42, 110), mouth_dimple=0.0, mouth_px=(0, 151),
    # 얼굴 그림(표정 묶음 한 칸)을 붙이는 범위: 좌우 +-라디안, 위쪽 시작 각도, 위아래 폭, 아래로 내리는 양
    # kid.ts 의 얼굴 조각은 좌우 +-1.05, 위 0.255pi 에서 0.5pi 폭이다. 여기서는 그 범위를 조금 키워 눈, 입이 더 크게 보이게 한다.
    face_half_az=1.05 * 1.22, face_polar0=(0.505 - 0.25 * 1.22) * math.pi, face_polar_span=0.5 * 1.22 * math.pi, face_drop=-0.018,
    # 모자: 뒤로 젖힌 각도, 머리 중심에서 테 평면까지의 높이, 머리와의 틈(머리카락 두께 포함), 돔의 여유 높이, 돔의 각진 정도
    cap_tilt=0.40, cap_h0=0.066, cap_margin=0.036, cap_puff=0.014, cap_box=2.5,
    # 챙: 길이, 좌우로 벌어진 각도, 아래로 숙인 정도
    brim_len=0.090, brim_span_deg=52, brim_slope=0.9,
    # 머리선(머리카락이 내려오는 끝): parts.hairline 참고. 높이는 머리 중심 기준.
    hairline=dict(
        fringe_z=0.044, fringe_wave=0.030, fringe_start=-1.08, fringe_width=0.54, fringe_vary=0.25,   # 앞머리: 끝 높이, 가닥 깊이, 첫 가닥 자리, 가닥 폭, 길이 차이
        burn_az=1.24, burn_w=0.17, burn_z=-0.055,                                  # 귀 앞머리: 방위각, 폭, 끝 높이
        ear_z=0.045, ear_end=1.85,                                                 # 귀 위 높이, 귀 뒤가 시작되는 방위각
        nape_z=-0.128, nape_wave=0.024, nape_width=0.62,                           # 목덜미: 끝 높이, 가닥 깊이, 가닥 폭
        thick=0.024, chunk=0.005, fringe_puff=0.008, undercut=0.9,                 # 두께, 가닥의 도톰함, 앞머리 볼륨, 끝이 말려 들어간 정도
    ),
    hair_cols=64,   # 머리 둘레의 세로 띠 수
    # 운동화
    toe_out_deg=11, shoe_scale=1.0,
    # 이름표: 가슴에서의 위치(x, z), 크기(가로, 세로)
    tag_pos=(0.050, 0.452), tag_size=(0.080, 0.050),
)

# =========================================================================== 색(src/app/tokens.css 의 값과 같아야 한다)
TOK = dict(ink='#1d2a4d', paper='#fffdf6', red='#ee4b3e', yellow='#ffc533', blue='#2f6fe0', orange='#f58a2e',
           pink='#f27aa6', skin='#ffd9b8', court_dark='#c98f48')
COLORS = dict(
    skin=TOK['skin'],
    skin_shade=mk.mix_hex(TOK['skin'], TOK['pink'], 0.22),
    hair=mk.mix_hex(TOK['ink'], TOK['court_dark'], 0.22),       # kid.ts 의 KID_LOOK.hair 와 같은 식
    hair_in=mk.mix_hex(TOK['ink'], TOK['court_dark'], 0.10),
    shirt=TOK['paper'],
    collar=TOK['blue'],
    shorts=TOK['blue'],
    shorts_in=mk.mix_hex(TOK['blue'], TOK['ink'], 0.35),
    shirt_in=mk.mix_hex(TOK['paper'], TOK['ink'], 0.28),
    shoe_in=mk.mix_hex(TOK['red'], TOK['ink'], 0.35),
    sock=TOK['paper'],
    shoe=TOK['red'],
    sole=TOK['paper'],
    toe=TOK['paper'],
    lace=TOK['paper'],
    cap=TOK['yellow'],
    cap_band=mk.mix_hex(TOK['yellow'], TOK['orange'], 0.22),
    cap_under=mk.mix_hex(TOK['yellow'], TOK['orange'], 0.42),
    cap_button=TOK['red'],
)
# 틈새 그늘: 세기, 물들이는 색(선형 RGB 배율), 방법('auto' = Cycles 를 먼저 해 보고 안 되면 직접 계산)
#   그늘 색은 재질마다 다르게 물들인다: 살은 따뜻한 복숭아빛, 흰 옷은 연보라, 나머지는 짙은 보라.
AO = dict(method='auto', samples=96, distance=0.12, gain=1.0, lo=0.28, hi=0.86,   # lo 이하 = 가장 어두움, hi 이상 = 그늘 없음
          default=(0.55, (0.55, 0.46, 0.66)),
          by_color={
              'skin': (0.30, (1.0, 0.68, 0.58), 0.16, 0.62), 'skin_shade': (0.30, (1.0, 0.68, 0.58), 0.16, 0.62),
              'shirt': (0.50, (0.66, 0.68, 0.90)), 'sock': (0.50, (0.66, 0.68, 0.90)), 'sole': (0.50, (0.66, 0.68, 0.90)),
              'toe': (0.50, (0.66, 0.68, 0.90)), 'lace': (0.50, (0.66, 0.68, 0.90)),
              'cap': (0.50, (0.95, 0.55, 0.30)), 'cap_band': (0.50, (0.95, 0.55, 0.30)), 'cap_under': (0.55, (0.90, 0.50, 0.30)),
          })




def assemble(P, pal):
    """부분을 만든다: 머리, 목, 귀, 윗옷(몸통 + 소매), 팔 + 손, 반바지, 다리 + 양말, 운동화, 모자, 머리카락."""
    head = parts.build_head(P, pal)
    face = parts.build_face_decal(head, P)
    parts.cull_hidden_head(head, P)
    shirt = parts.build_shirt(P, pal)
    tag = parts.build_tag(P, shirt)
    obs = [head, parts.build_neck(P, pal), *parts.build_ears(P, pal), shirt, parts.build_shorts(P, pal)]
    for side in (1, -1):
        obs += [parts.build_arm(P, pal, side), parts.build_leg(P, pal, side), parts.build_shoe(P, pal, side)]
    obs += [parts.build_cap(P, pal), parts.build_hair(P, pal)]
    return dict(parts=obs, face=face, tag=tag)


SPEC = dict(
    name='kid',
    out=os.path.join(ROOT, 'src', 'app', 'assets', 'kid.glb'),
    P=P, COLORS=COLORS, AO=AO,
    assemble=assemble,
    clips=clips_kid.make_clips,
    notes=lambda P_, log: log('  얼굴 그림에서의 자리(가운데 기준 x, 위에서 y):', parts.face_marks(P_)),
    # 느린 동작은 키를 한 칸 걸러 남긴다(10 Hz). 빠른 동작(던지기, 만세)은 그대로 둔다.
    thin={'Idle': 2, 'Home': 2, 'CheerHold': 2, 'Nod': 2, 'Slump': 2, 'Watch': 1},
    topology=os.path.join(ROOT, 'screenshots', 'v4-kid', 'raw', 'topology.svg'),
)
