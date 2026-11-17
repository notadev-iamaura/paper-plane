"""
chars/audience.py - 관람석 아이들. 주인공과 같은 부분 함수(parts.py)를 "성기게" 만들어 쓴다.

  - 변형 6 가지: 머리 모양(짧은 머리, 양 갈래, 단발, 모자, 똥머리, 삐죽 머리), 몸집, 옷 모양을 숫자로 바꿔 만든다.
  - 변형마다 두 벌: lod0(높은 화질용, 약 2 천 삼각형), lod1(낮은 화질용, 약 7 백 삼각형).
  - 색은 넣지 않는다. 꼭짓점 색에는 "그늘"과 "어느 부분인지(살, 윗옷, 바지, 머리카락, 깃발, 포인트 색)"만 적고,
    게임이 사람마다 다른 색을 입힌다(shading.write_colors 의 parts).
  - 얼굴은 머리 앞면의 UV 로 작은 표정 그림(게임이 그린다)을 붙인다. 따로 얼굴판을 두지 않는다.
  - 뼈대는 모든 변형이 함께 쓴다(21 개). 그래서 관절 높이는 같고, 몸집은 둘레(torso_w 등)와 게임에서의 크기로 달리한다.
"""
import copy
import os

import meshkit as mk
import parts
import clips_audience
from chars import kid

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))

LOD = [
    dict(levels=0, head_levels=1, body_seg=12, arm_seg=6, leg_seg=6, neck_seg=6, cap_seg=12, brim_seg=6, folds=False, thumb=False, shoe='simple', ears=True),
    dict(levels=0, head_levels=0, body_seg=8, arm_seg=4, leg_seg=4, neck_seg=4, cap_seg=8, brim_seg=4, folds=False, thumb=False, shoe='simple', ears=False, lite=True),
]
HAIR_COLS = [20, 12]


def base_P(lod):
    P = copy.deepcopy(kid.P)
    P['detail'] = dict(LOD[lod])
    P['hair_cols'] = HAIR_COLS[lod]
    P['bones_skip'] = ('cap', 'thumb.L', 'thumb.R', 'hand_grip.L', 'hand_grip.R')
    P['cap_bone'] = 'head'
    P['eye_socket'] = 0.0
    # 종이 깃발(오른손): 작고 가볍다. 천은 깃대와 같은 뼈를 따른다(뼈를 아낀다).
    P['flag'] = dict(pole=0.33, below=0.03, pole_r=0.0065, cloth_h=0.135, cloth_l=0.20, cloth_bone='prop.R')
    return P


def hairline(**kw):
    H = dict(kid.P['hairline'])
    H.update(kw)
    return H


# 변형: (이름, 비율을 고치는 함수). 관절 높이는 건드리지 않는다(뼈대를 함께 쓴다).
def v_short(P):      # 짧은 머리(모자 없음)
    P['cap'] = False
    P['hairline'] = hairline(fringe_z=0.060, fringe_wave=0.026, fringe_width=0.72, thick=0.022)


def v_pigtails(P):   # 양 갈래: 귀 뒤로 묶은 머리 두 덩이 + 머리끈
    P['cap'] = False
    P['hairline'] = hairline(fringe_z=0.050, fringe_wave=0.020, fringe_width=0.5, ear_z=0.020, nape_z=-0.07, thick=0.022)
    P['hair_extras'] = [
        dict(pos=(0.215, 0.045, -0.045), r=(0.060, 0.058, 0.082), mirror=True, pull=(0.02, 0.0, -0.06)),
        dict(pos=(0.196, 0.040, 0.030), r=(0.026, 0.026, 0.022), mirror=True, color='accent'),
    ]
    P['torso_w'] = 0.95
    P['top'] = dict(band=False)


def v_bob(P):        # 단발: 귀를 덮고 턱 높이에서 끝난다
    P['cap'] = False
    P['hairline'] = hairline(fringe_z=0.046, fringe_wave=0.016, fringe_start=-0.95, fringe_width=0.63, burn_az=1.12, burn_w=0.2, burn_z=-0.120,
                             ear_z=-0.125, ear_end=1.75, nape_z=-0.135, nape_wave=0.008, thick=0.028, flare=0.22)
    P['detail']['ears'] = False


def v_cap(P):        # 모자: 주인공과 같은 모자를 쓴다(색은 사람마다 다르다)
    P['hairline'] = hairline(fringe_z=0.062, fringe_wave=0.022)
    P['torso_w'] = 1.06
    P['tummy'] = 0.09


def v_bun(P):        # 똥머리: 정수리에 동그랗게 묶었다
    P['cap'] = False
    P['hairline'] = hairline(fringe_z=0.070, fringe_wave=0.014, fringe_width=0.9, ear_z=0.035, nape_z=-0.06, thick=0.020)
    P['hair_extras'] = [
        dict(pos=(0.0, 0.035, 0.232), r=(0.070, 0.070, 0.058)),
        dict(pos=(0.0, 0.035, 0.196), r=(0.040, 0.040, 0.016), color='accent'),
    ]
    P['torso_w'] = 0.92
    P['head_r'] = (0.202, 0.194, 0.190)


def v_spiky(P):      # 삐죽 머리: 정수리에서 한 가닥이 솟았다. 몸집이 크다.
    P['cap'] = False
    P['hairline'] = hairline(fringe_z=0.066, fringe_wave=0.034, fringe_width=0.42, fringe_vary=0.4, thick=0.026, chunk=0.008)
    P['hair_extras'] = [dict(pos=(0.03, -0.02, 0.215), r=(0.034, 0.034, 0.05), pull=(0.035, -0.01, 0.055))]
    P['torso_w'] = 1.10
    P['tummy'] = 0.10
    P['top'] = dict(band=False)


VARIANTS = [('short', v_short), ('pigtails', v_pigtails), ('bob', v_bob), ('cap', v_cap), ('bun', v_bun), ('spiky', v_spiky)]

# 색 이름은 주인공과 같다. 여기서는 "부분 번호"로 바뀐다(게임이 사람마다 색을 입힌다). 0 = 정해진 색 그대로.
TOK = kid.TOK
COLORS = dict(
    skin='#ffffff', skin_shade='#ffffff', hair='#ffffff', hair_in='#ffffff', shirt='#ffffff', collar='#ffffff', shirt_in='#ffffff',
    shorts='#ffffff', shorts_in='#ffffff',
    sock=TOK['paper'], shoe=mk.mix_hex(TOK['ink'], TOK['paper'], 0.25), sole=TOK['paper'], toe=TOK['paper'],
    cap='#ffffff', cap_band='#ffffff', cap_under='#ffffff', cap_button='#ffffff', accent='#ffffff',
    pole=mk.mix_hex(TOK['ink'], TOK['paper'], 0.3), knob='#ffffff', cloth='#ffffff',
)
# 부분 번호와 밝기 배율: 1 살, 2 윗옷, 3 바지, 4 머리카락, 5 깃발 천, 6 포인트 색(모자, 머리끈), 7 깃대(깃발이 없으면 숨긴다)
PARTS = dict(
    skin=(1, 1.0), skin_shade=(1, 0.90), hair=(4, 1.0), hair_in=(4, 0.72), shirt=(2, 1.0), collar=(3, 1.0), shirt_in=(2, 0.6),
    shorts=(3, 1.0), shorts_in=(3, 0.6), cap=(6, 1.0), cap_band=(6, 0.86), cap_under=(6, 0.7), cap_button=(6, 1.0), accent=(6, 1.0),
    cloth=(5, 1.0), knob=(5, 1.0), pole=(7, 1.0),
)
AO = dict(method='auto', samples=64, distance=0.12, gain=1.0, lo=0.28, hi=0.86,
          default=(0.50, (0.60, 0.52, 0.72)),
          by_color={'skin': (0.30, (1.0, 0.68, 0.58), 0.16, 0.62), 'skin_shade': (0.30, (1.0, 0.68, 0.58), 0.16, 0.62)})


def assemble(P, pal):
    head = parts.build_head(P, pal)
    parts.cull_hidden_head(head, P)
    shirt = parts.build_shirt(P, pal)
    obs = [head, parts.build_neck(P, pal), *parts.build_ears(P, pal), shirt, parts.build_shorts(P, pal)]
    for side in (1, -1):
        obs += [parts.build_arm(P, pal, side), parts.build_leg(P, pal, side), parts.build_shoe_simple(P, pal, side)]
    if P.get('cap', True):
        obs.append(parts.build_cap(P, pal))
    obs += [parts.build_hair(P, pal), *parts.build_hair_extras(P, pal), *parts.build_flag(P, pal)]
    return dict(parts=obs, face=None, tag=None, head=head)


OUT = os.path.join(ROOT, 'src', 'app', 'assets', 'audience.glb')
CLIPS = clips_audience.make_clips
THIN = {'SeatedIdle': 2, 'CheerSmall': 1, 'CheerBig': 1}
