"""
builder.py - 캐릭터를 만드는 공통 순서. 생김새(chars/*.py 의 SPEC)만 바꿔 끼우면 다른 캐릭터가 나온다.

  1. 부분 만들기   : SPEC['assemble'](P, pal) 이 부분 메시들을 돌려준다                                   (parts.py)
  2. 합치기        : 한 메시로 합치고 겹친 점, 법선을 정리한다                                             (rig.py)
  3. 그늘 굽기     : 틈새 그늘(AO)을 계산해 바탕색과 함께 꼭짓점 색으로 적는다                             (shading.py)
  4. 뼈대와 스키닝 : 뼈대를 세우고 가중치를 정리해(최대 4 개) 메시를 묶는다                                (rig.py)
  5. 동작          : 자세 함수 -> IK 풀이 -> 키프레임                                                      (anim.py + clips_*.py)
  6. 내보내기      : GLB 로 내보낸 뒤 용량을 줄인다(색, 가중치, 회전을 작은 정수로)                        (glbpack.py)

SPEC 의 항목
  name      메시와 뼈대 이름의 머리말('kid' -> kid_body, kid_face, kid_tag, kid_rig)
  out       내보낼 GLB 경로
  P, COLORS, AO   비율, 색, 그늘 설정
  assemble  (P, pal) -> dict(parts=[부분 메시...], face=얼굴 그림판 또는 None, tag=이름표 판 또는 None)
  clips     (solver, P) -> [(이름, 자세 함수, 길이, 되풀이, 지연), ...]
  thin      {클립 이름: 키를 솎는 간격}
  topology  (선택) 면 흐름 그림(SVG)을 남길 경로
"""
import os
import time

import bpy
import numpy as np

import anim
import glbpack
import meshkit as mk
import rig as rigmod
import shading
import wire_view


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def bake_ao(body, AO, log):
    """틈새 그늘을 꼭짓점마다 계산한다. Cycles 를 먼저 해 보고 안 되면 광선을 직접 쏜다."""
    ao, how = None, ''
    if AO['method'] in ('auto', 'cycles'):
        try:
            ao = shading.ao_cycles(body, AO['samples'], AO['distance'])
            how = 'cycles'
            if not np.isfinite(ao).all() or ao.std() < 1e-4:
                raise RuntimeError('Cycles 가 고른 값만 돌려줬다')
        except Exception as e:  # noqa: BLE001
            log('  Cycles 굽기 실패 -> 직접 계산:', e)
            ao = None
    if ao is None:
        ao = shading.ao_bvh(body, AO['samples'], AO['distance'])
        how = 'bvh'
    ao = shading.smooth_scalar(body, ao, 1)
    return ao, how


def make_body(name, P, COLORS, AO, assemble, log, colorize=None, topology=None):
    """부분 만들기 -> 합치기 -> 그늘 굽기. 돌려주는 값: (몸 메시, 얼굴판, 이름표판, 가중치 표, 부분별 삼각형 수, AO 방법)"""
    pal = mk.Palette(COLORS)
    made = assemble(P, pal)
    obs = made['parts']
    counts = {}
    for o in obs:
        counts[o.name] = counts.get(o.name, 0) + mk.tri_count(o)
    for o in obs:
        mk.clean_mesh(o)
        nm, flips, nq = mk.mesh_report(o)
        if (nm or flips or nq) and P.get('detail', {}).get('levels', 1) > 0:
            log(f'  메시 점검 {o.name}: 겹친 모서리 {nm}, 날카롭게 접힌 모서리 {flips}(겨드랑이, 머리끝처럼 일부러 접은 곳이면 정상), 사각형 아닌 면 {nq}')
    n_first = len(obs[0].data.vertices)       # 첫 부분(머리)의 꼭짓점 수: 합친 뒤에도 앞쪽 번호가 머리다
    body, mats, W = rigmod.join_parts(obs, name + '_body')
    body.data.validate()
    # 그늘을 구울 때는 이 몸만 보이게 한다: 얼굴 그림판(얼굴에서 2 mm 떠 있다)이나 다른 몸이 빛을 가리면
    # 얼굴 전체가 "틈새"로 계산되어 살빛이 어두워진다.
    others = [o for o in bpy.context.scene.objects if o is not body and o.type == 'MESH']
    was = [o.hide_render for o in others]
    for o in others:
        o.hide_render = True
    ao, how = bake_ao(body, AO, log)
    for o, h in zip(others, was):
        o.hide_render = h
    log(f'  그늘: 방법 = {how}, 평균 {ao.mean():.3f}, 최소 {ao.min():.3f}')
    if topology:
        os.makedirs(os.path.dirname(topology), exist_ok=True)
        wire_view.write_topology_svg(body, mats, pal, topology)
    quads = sum(1 for p in body.data.polygons if len(p.vertices) == 4)
    log(f'  면: 사각형 {quads} / 전체 {len(body.data.polygons)}')
    (colorize or shading.write_colors)(body, mats, pal, ao, AO, W.get('_thin'))
    return dict(body=body, face=made.get('face'), tag=made.get('tag'), W=W, counts=counts, how=how, mats=mats, pal=pal, made=made, n_first=n_first)


def bind_all(rig, name, items):
    """몸, 얼굴판, 이름표판에 재질 이름을 붙이고 뼈대에 묶는다. 게임은 메시 이름(<name>_body 등)으로 찾는다."""
    for ob, kind in items:
        if ob is None:
            continue
        ob.name = f'{name}_{kind}'
        m = bpy.data.materials.new(f'{name}_{"toon" if kind.startswith("body") else kind}')
        ob.data.materials.clear()
        ob.data.materials.append(m)
        for p in ob.data.polygons:
            p.material_index = 0
        rigmod.bind(ob, rig)


def export(out, thin, log):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    raw = out + '.raw.glb'
    bpy.ops.export_scene.gltf(
        filepath=raw, export_format='GLB', export_yup=True, export_apply=False,
        export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
        export_skins=True, export_all_influences=False, export_influence_nb=4, export_def_bones=False,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_frame_step=1,
        export_optimize_animation_size=True, export_optimize_animation_keep_anim_armature=True,
        export_reset_pose_bones=True, export_morph=False, export_extras=False, export_cameras=False, export_lights=False,
    )
    stats = glbpack.pack(raw, out, thin=thin)
    os.remove(raw)
    return stats


def build(spec):
    t0 = time.time()
    name = spec['name']

    def log(*a):
        print(f'[{name}]', *a, flush=True)
    reset_scene()
    P = spec['P']
    log('1~3/6 부분 만들기, 합치기, 그늘(AO) 굽기')
    B = make_body(name, P, spec['COLORS'], spec['AO'], spec['assemble'], log, spec.get('colorize'), spec.get('topology'))
    body, face, tag = B['body'], B['face'], B['tag']
    if spec.get('notes'):
        spec['notes'](P, log)

    log('4/6 뼈대와 스키닝')
    rig, table = rigmod.build_armature(P, name + '_rig')
    bad, most = rigmod.finish_weights(body, B['W'])
    log(f'  가중치 없는 꼭짓점 {bad} 개, 꼭짓점당 뼈 최대 {most} 개')
    bind_all(rig, name, [(body, 'body'), (face, 'face'), (tag, 'tag')])

    log('5/6 동작 만들기')
    clips = anim.bake_clips(rig, P, spec['clips'], log)
    anim.verify_poses(rig, P, spec['clips'], log)

    log('6/6 내보내기')
    stats = export(spec['out'], spec.get('thin', {}), log)
    tris = mk.tri_count(body)
    ft = mk.tri_count(face) if face is not None else 0
    tt = mk.tri_count(tag) if tag is not None else 0
    log('---------------- 결과')
    log('부분별 삼각형:', B['counts'])
    log(f'삼각형: 몸 {tris} + 얼굴판 {ft} + 이름표 {tt} = {tris + ft + tt}')
    log(f'꼭짓점(블렌더 기준): {len(body.data.vertices)}')
    log(f'뼈: {len(rig.data.bones)} 개, 클립: {len(clips)} 개 {[c[0] for c in clips]}')
    log(f'AO 방법: {B["how"]}')
    log(f'GLB: {stats["before"] / 1024:.0f} kB -> {stats["after"] / 1024:.0f} kB  ({spec["out"]})')
    log(f'걸린 시간 {time.time() - t0:.1f} s')
    return dict(tris=tris + ft + tt, bones=len(rig.data.bones), clips=[c[0] for c in clips], bytes=stats['after'])
