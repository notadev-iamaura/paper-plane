"""
wardrobe.py - 주인공 아이를 "갈아입힐 수 있는 모델"로 만든다(캐릭터 꾸미기용).

builder.py 는 몸 전체를 한 메시로 합쳐 색까지 구워 넣는다. 여기서는 같은 부분 함수로 만들되,
  * 바꿔 끼우는 부분(머리 모양, 모자, 윗옷, 바지, 덧붙임)을 이름이 붙은 메시로 따로 내보내고(뼈대는 하나),
  * 꼭짓점 색에는 색 대신 "그늘의 세기 + 어느 부분인지"를 적는다. 색은 게임이 고른 대로 입힌다.

꼭짓점 색(COLOR_0)의 뜻
  R = 그늘 k(0 = 없음). 게임이 계산하는 색 = 고른 색 x (1 - k + k x 그 부분의 그늘 색).
  G = "덮는 것"이 있을 때 더해지는 그늘. 머리와 머리카락은 정수리를 덮는 모자, 반바지와 다리는 치마,
      긴소매 윗옷은 목의 모자(후드). 모자를 벗으면 이 그늘도 사라진다(검은 자국이 남지 않는다).
  B = 부분 번호(0~31) + 32(정수리 표시: 정수리를 덮는 모자를 쓰면 게임이 이 면을 그리지 않는다)
  A = 외곽선 두께(1 = 보통, 0 = 없음). 지금까지와 같다.
머리(kid_head)에는 색 묶음이 둘 더 있다(COLOR_1, COLOR_2): 머리 모양마다 앞머리가 드리우는 그늘이 달라서
  머리 모양 1~4 번의 k 는 COLOR_1 의 R, G, B, A 에, 5~7 번은 COLOR_2 의 R, G, B 에 적는다.

파일 둘로 나눠 내보낸다.
  kid.glb          : 기본 차림(짧은 머리, 노란 모자, 체육복) + 뼈대 + 동작. 처음부터 받는다.
  kid-wardrobe.glb : 나머지 머리 모양, 모자, 옷. 꾸미기 화면을 열거나 기본이 아닌 차림일 때만 받는다.
부분 번호와 그늘 색, 뼈 하나에만 붙은 메시의 뼈 이름은 asset.extras.kid 에 적어 둔다(게임의 kidGlb.ts 가 읽는다).
"""
import os
import time

import bpy  # noqa: F401
import bmesh
import numpy as np

import anim
import glbpack
import meshkit as mk
import parts
import rig as rigmod
import shading
import wardrobe_parts as wp
from chars import kid

ROOT = kid.ROOT
OUT_MAIN = os.path.join(ROOT, 'src', 'app', 'assets', 'kid.glb')
OUT_WARD = os.path.join(ROOT, 'src', 'app', 'assets', 'kid-wardrobe.glb')

# 부분(색 자리) 목록. 순서가 곧 번호다. 색 값은 굽는 데 쓰이지 않는다(게임이 입힌다). 이름만 중요하다.
SLOTS = ['skin', 'skin_shade', 'hair', 'hair_in', 'shirt', 'collar', 'shorts', 'shorts_in', 'shirt_in', 'shoe_in',
         'sock', 'shoe', 'sole', 'toe', 'lace', 'cap', 'cap_band', 'cap_under', 'cap_button', 'accent', 'zip']
COLORS = {k: kid.COLORS.get(k, '#ffffff') for k in SLOTS}
AO = dict(kid.AO)
AO['by_color'] = dict(kid.AO['by_color'], accent=(0.45, (0.80, 0.45, 0.50)), zip=(0.50, (0.66, 0.68, 0.90)))
CROWN_ABOVE = 0.022      # 모자 테 평면에서 이만큼 위에 있는 머리카락 면은 "정수리"다(모자 속에 숨는다)
CROWN_BIT = 32
HAIR_ORDER = ['short', 'bowl', 'spiky', 'bob', 'pigtails', 'ponytail', 'bun', 'long']
HAT_ORDER = ['cap', 'visor', 'band', 'beanie', 'bucket']
MAIN = ['kid_head', 'kid_ears', 'kid_core', 'kid_top_tee', 'kid_bot_short', 'kid_hair_short', 'kid_hat_cap', 'kid_face', 'kid_tag']


def log(*a):
    print('[kid]', *a, flush=True)


class Piece:
    """내보낼 메시 하나: 오브젝트, 면마다의 부분 번호, 가중치 표"""

    def __init__(self, name, obs):
        for o in obs:
            mk.clean_mesh(o)
        self.tris = sum(mk.tri_count(o) for o in obs)
        self.ob, self.mats, self.W = rigmod.join_parts(obs, name)
        self.ob.data.validate()
        self.name = name
        self.k = None
        self.g = None
        self.extra = []      # 머리의 다른 머리 모양용 k


def bake(piece, pieces, ctx):
    """piece 의 틈새 그늘을 굽는다. ctx 에 든 메시만 빛을 가린다."""
    show = set(ctx) | {piece.name}
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.hide_render = o.name not in show
    ao, how = None, ''
    try:
        ao = shading.ao_cycles(piece.ob, AO['samples'], AO['distance'])
        if not np.isfinite(ao).all() or ao.std() < 1e-5:
            raise RuntimeError('Cycles 가 고른 값만 돌려줬다')
    except Exception as e:  # noqa: BLE001
        log('  Cycles 굽기 실패 -> 직접 계산:', piece.name, e)
        ao = shading.ao_bvh(piece.ob, AO['samples'], AO['distance'])
    return shading.smooth_scalar(piece.ob, ao, 1)


def k_of(piece, pal, ao):
    """그늘 값(0~1, 1 = 가려지지 않음) -> 면 모서리마다의 k(재질마다 문턱과 세기가 다르다)."""
    me = piece.ob.data
    nl = len(me.loops)
    vi = np.empty(nl, dtype=np.int32)
    me.loops.foreach_get('vertex_index', vi)
    out = np.zeros(nl, dtype=np.float64)
    cache = {}
    for p in me.polygons:
        m = piece.mats[p.index]
        if m not in cache:
            e = AO['by_color'].get(pal.names[m], AO['default'])
            lo, hi = (e[2], e[3]) if len(e) >= 4 else (AO['lo'], AO['hi'])
            a = np.clip(1 - (1 - mk.smoothstep(lo, hi, ao)) * AO['gain'], 0, 1)
            cache[m] = (1 - a) * e[0]
        kk = cache[m]
        for li in p.loop_indices:
            out[li] = kk[vi[li]]
    return out


def write_piece(piece, pal, crown=None):
    """k, 덧그늘, 부분 번호, 외곽선 두께를 꼭짓점 색으로 적는다."""
    me = piece.ob.data
    nl = len(me.loops)
    vi = np.empty(nl, dtype=np.int32)
    me.loops.foreach_get('vertex_index', vi)
    thin = piece.W.get('_thin')
    col = np.zeros((nl, 4), dtype=np.float32)
    col[:, 0] = piece.k
    if piece.g is not None:
        col[:, 1] = np.clip(piece.g - piece.k, 0, 1)
    for p in me.polygons:
        pid = piece.mats[p.index] + (CROWN_BIT if crown is not None and crown[p.index] else 0)
        for li in p.loop_indices:
            col[li, 2] = pid / 255.0
    col[:, 3] = 1.0 - (thin[vi] if thin is not None else 0.0)
    for i, ex in enumerate(piece.extra):
        a = me.color_attributes.new(f'Col{i + 1}', 'FLOAT_COLOR', 'CORNER')
        a.data.foreach_set('color', np.ascontiguousarray(ex, dtype=np.float32).ravel())
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    attr.data.foreach_set('color', col.ravel())
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = me.color_attributes.find('Col')
    me.materials.clear()


def crown_faces(piece, P):
    """모자 테 평면보다 CROWN_ABOVE 넘게 위에 있는 면(정수리)."""
    cc, cu, cv, cn, crx, cry, chD = parts.cap_frame(P)
    co = mk.get_co(piece.ob)
    above = (co - cc) @ cn > CROWN_ABOVE
    return [all(above[i] for i in p.vertices) for p in piece.ob.data.polygons]


def export(path, names, rig, animations):
    for o in bpy.context.scene.objects:
        o.hide_render = False
        o.select_set(o is rig or o.name in names)
    bpy.context.view_layer.objects.active = rig
    raw = path + '.raw.glb'
    bpy.ops.export_scene.gltf(
        filepath=raw, export_format='GLB', export_yup=True, export_apply=False, use_selection=True,
        export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_vertex_color='ACTIVE', export_all_vertex_colors=True, export_active_vertex_color_when_no_material=True,
        export_skins=True, export_all_influences=False, export_influence_nb=4, export_def_bones=False,
        export_animations=animations, export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_frame_step=1,
        export_optimize_animation_size=True, export_optimize_animation_keep_anim_armature=True,
        export_reset_pose_bones=True, export_morph=False, export_extras=False, export_cameras=False, export_lights=False,
    )
    return raw


def build():
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    P = kid.P
    pal = mk.Palette(COLORS)
    styles = wp.hair_styles(P)
    PS = {h: wp.style_P(P, styles[h]) for h in HAIR_ORDER}

    log('1/6 부분 만들기')
    head = parts.build_head(P, pal)
    face = parts.build_face_decal(head, P)
    face.name = 'kid_face'
    # 어떤 머리 모양을 해도 머리카락에 덮이는 머리 면은 지운다
    co = mk.get_co(head)
    hidden = np.logical_and.reduce([parts.hair_cover(co, PS[h]) for h in HAIR_ORDER])
    bm = bmesh.new()
    bm.from_mesh(head.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(hidden[v.index] for v in f.verts)], context='FACES')
    bm.to_mesh(head.data)
    bm.free()
    head.data.update()

    pieces = {}

    def add(name, obs):
        pieces[name] = Piece(name, obs)
        return pieces[name]

    add('kid_head', [head])
    add('kid_ears', parts.build_ears(P, pal))
    add('kid_core', [parts.build_neck(P, pal), parts.build_shoe(P, pal, 1), parts.build_shoe(P, pal, -1)])
    # ---- 윗옷: 반소매(체육복), 긴소매(운동복, 모자 달린 옷)
    tee = parts.build_shirt(P, pal)
    tag = parts.build_tag(P, tee)
    tag.name = 'kid_tag'
    tee_shell = tee.copy()
    tee_shell.data = tee.data.copy()
    add('kid_top_tee', [tee, parts.build_arm(P, pal, 1), parts.build_arm(P, pal, -1)])
    PL = dict(P, top=dict(long=True, band=False, hem_band=True, collar_up=0.010, arm_sleeve=1.14))
    jacket = parts.build_shirt(PL, pal)
    zips = wp.build_zip(PL, pal, jacket)
    hood = wp.build_hood(PL, pal, jacket)
    add('kid_top_long', [jacket, parts.build_arm(PL, pal, 1), parts.build_arm(PL, pal, -1)])
    add('kid_x_zip', zips)
    add('kid_x_hood', hood)
    # ---- 바지: 반바지, 긴바지
    add('kid_bot_short', [parts.build_shorts(P, pal), parts.build_leg(P, pal, 1), parts.build_leg(P, pal, -1)])
    PB = dict(P, bottom=dict(long=True, leg_r=1.12))
    add('kid_bot_long', [parts.build_shorts(PB, pal), parts.build_leg(PB, pal, 1), parts.build_leg(PB, pal, -1)])
    add('kid_x_skirt', [wp.build_skirt(P, pal)])
    bib = wp.build_bib(P, pal, tee_shell)
    bpy.context.collection.objects.link(tee_shell)
    tag_bib = parts.build_tag(dict(P, tag_pos=(0.0, 0.425), tag_size=(0.080, 0.050)), bib[0])
    tag_bib.name = 'kid_tag_bib'
    add('kid_x_bib', bib)
    d = tee_shell.data
    bpy.data.objects.remove(tee_shell)
    bpy.data.meshes.remove(d)
    # ---- 머리 모양
    for h in HAIR_ORDER:
        add(f'kid_hair_{h}', [parts.build_hair(PS[h], pal), *parts.build_hair_extras(PS[h], pal)])
    # ---- 모자
    add('kid_hat_cap', [parts.build_cap(P, pal)])
    add('kid_hat_visor', [wp.build_visor(P, pal)])
    add('kid_hat_band', wp.build_headband(P, pal))
    add('kid_hat_beanie', [wp.build_beanie(P, pal)])
    add('kid_hat_bucket', [wp.build_bucket(P, pal)])
    log('  모자 테의 앞 끝 높이(머리 중심 기준): 모자 %.3f' % wp.front_rim_z(P))
    for n_, pc in pieces.items():
        log(f'  {n_:18s} 삼각형 {pc.tris:5d}  꼭짓점 {len(pc.ob.data.vertices):5d}')

    log('2/6 그늘(AO) 굽기: 부분마다 제 차림 속에서')
    for o in (face, tag, tag_bib):
        o.hide_render = True
    base = ['kid_head', 'kid_ears', 'kid_core', 'kid_hair_short']
    gym = base + ['kid_top_tee', 'kid_bot_short']
    track = base + ['kid_top_long', 'kid_bot_long']

    def K(name, ctx):
        return k_of(pieces[name], pal, bake(pieces[name], pieces, ctx))
    for name in ('kid_ears', 'kid_core', 'kid_top_tee', 'kid_bot_short'):
        pieces[name].k = K(name, gym)
    # 멜빵 가슴판은 윗옷에 붙어 있어서 덧그늘을 주면 어깨에 얼룩이 진다: 굽지 않는다(가슴판의 외곽선으로 충분하다)
    pieces['kid_bot_short'].g = K('kid_bot_short', gym + ['kid_x_skirt'])
    for name in ('kid_top_long', 'kid_bot_long'):
        pieces[name].k = K(name, track)
    pieces['kid_top_long'].g = K('kid_top_long', track + ['kid_x_hood'])
    pieces['kid_x_zip'].k = K('kid_x_zip', track)
    pieces['kid_x_hood'].k = K('kid_x_hood', track)
    pieces['kid_x_skirt'].k = K('kid_x_skirt', gym)
    pieces['kid_x_bib'].k = K('kid_x_bib', gym)
    nohair = ['kid_head', 'kid_ears', 'kid_core', 'kid_top_tee']
    head_k = []
    for h in HAIR_ORDER:
        hp = pieces[f'kid_hair_{h}']
        ctx = nohair + [hp.name]
        hp.k = K(hp.name, ctx)
        hp.g = K(hp.name, ctx + ['kid_hat_cap'])
        head_k.append(K('kid_head', ctx))
    hd = pieces['kid_head']
    hd.k = head_k[0]
    hd.g = K('kid_head', nohair + ['kid_hair_short', 'kid_hat_cap'])
    z = np.zeros_like(hd.k)
    hd.extra = [np.stack([head_k[1], head_k[2], head_k[3], head_k[4]], axis=1), np.stack([head_k[5], head_k[6], head_k[7], z], axis=1)]
    for hat in HAT_ORDER:
        pieces[f'kid_hat_{hat}'].k = K(f'kid_hat_{hat}', nohair + ['kid_hair_short'])
    for o in bpy.context.scene.objects:
        o.hide_render = False
    for name, pc in pieces.items():
        crown = crown_faces(pc, P) if name.startswith('kid_hair_') else None
        write_piece(pc, pal, crown)

    log('3/6 뼈대와 스키닝')
    rig, table = rigmod.build_armature(P, 'kid_rig')
    rigid = {}
    for name, pc in pieces.items():
        bad, most = rigmod.finish_weights(pc.ob, pc.W)
        if most == 1:
            used = {pc.ob.vertex_groups[g.group].name for v in pc.ob.data.vertices for g in v.groups if g.weight > 0.5}
            if len(used) == 1:
                rigid[name] = used.pop()
        if bad:
            log(f'  {name}: 가중치 없는 꼭짓점 {bad} 개 <- 확인 필요')
        m = bpy.data.materials.new('kid_toon')
        pc.ob.data.materials.clear()
        pc.ob.data.materials.append(m)
        for p in pc.ob.data.polygons:
            p.material_index = 0
        rigmod.bind(pc.ob, rig)
    for ob, kind in ((face, 'face'), (tag, 'tag'), (tag_bib, 'tag')):
        m = bpy.data.materials.new(f'kid_{kind}')
        ob.data.materials.clear()
        ob.data.materials.append(m)
        rigmod.bind(ob, rig)
    log('  뼈 하나에 붙은 메시:', rigid)

    log('4/6 동작 만들기')
    clips = anim.bake_clips(rig, P, kid.SPEC['clips'], log)
    anim.verify_poses(rig, P, kid.SPEC['clips'], log)
    kid.SPEC['notes'](P, log)

    log('5/6 내보내기')
    extras = dict(
        slots=[[n, AO['by_color'].get(n, AO['default'])[0], list(AO['by_color'].get(n, AO['default'])[1])] for n in SLOTS],
        crownBit=CROWN_BIT, hair=HAIR_ORDER, hats=HAT_ORDER,
    )
    stats = {}
    for path, names, animations in ((OUT_MAIN, MAIN, True), (OUT_WARD, [n for n in list(pieces) + ['kid_tag_bib'] if n not in MAIN], False)):
        raw = export(path, names, rig, animations)
        keep = ('kid_face', 'kid_tag')
        stats[path] = glbpack.pack(raw, path, thin=kid.SPEC['thin'], pos16=lambda n: not n.startswith(keep),
                                   rigid={n: b for n, b in rigid.items() if n in names}, extras={'kid': extras})
        os.remove(raw)
    log('---------------- 결과')
    tm = sum(pieces[n].tris for n in MAIN if n in pieces)
    tw = sum(pc.tris for n, pc in pieces.items() if n not in MAIN)
    log(f'삼각형: 기본 파일 {tm} + 옷장 파일 {tw}  (기본 차림으로 그리는 삼각형 = {tm} + 얼굴판 {mk.tri_count(face)} + 이름표 {mk.tri_count(tag)})')
    log(f'뼈: {len(rig.data.bones)} 개, 클립: {len(clips)} 개 {[c[0] for c in clips]}')
    a, b = stats[OUT_MAIN]['after'], stats[OUT_WARD]['after']
    log(f'GLB: kid.glb {a / 1000:.1f} kB + kid-wardrobe.glb {b / 1000:.1f} kB = {(a + b) / 1000:.1f} kB')
    log(f'걸린 시간 {time.time() - t0:.1f} s')
    return dict(main=a, wardrobe=b, tris_main=tm, tris_wardrobe=tw)
