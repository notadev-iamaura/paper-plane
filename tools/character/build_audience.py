"""
build_audience.py - 관람석 아이들(변형 6 가지 x 두 벌)을 코드만으로 만들어 src/app/assets/audience.glb 한 파일로 내보낸다.

실행(프로젝트 루트에서):
    /home/claude/bpy-lab/venv/bin/python tools/character/build_audience.py

주인공과 같은 부분 함수와 같은 순서(builder.py)를 쓰되, 한 뼈대에 몸 열두 벌을 묶는다.
  메시 이름: aud_<변형>_lod<0|1>   (게임의 crowdGlb.ts 가 이름으로 찾는다)
  생김새는 chars/audience.py, 동작은 clips_audience.py.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import anim  # noqa: E402
import builder  # noqa: E402
import glbpack  # noqa: E402
import meshkit as mk  # noqa: E402
import parts  # noqa: E402
import rig as rigmod  # noqa: E402
import shading  # noqa: E402
from chars import audience as A  # noqa: E402


def log(*a):
    print('[audience]', *a, flush=True)


def add_face_uv(body, B, P):
    """머리의 살 면에는 얼굴 그림의 UV 를, 그 밖의 면에는 그림의 흰 여백을 가리키는 UV 를 적는다."""
    me = body.data
    co = mk.get_co(body)
    u, v = parts.face_uv(co, P)
    c = parts.head_center(P)
    front = co[:, 1] < c[1] + 0.02
    skin = {B['pal'].index('skin')}
    uvl = me.uv_layers.new(name='UVMap')
    n_head = B['n_first']
    for poly in me.polygons:
        face_ok = B['mats'][poly.index] in skin and all(i < n_head for i in poly.vertices) and all(front[i] for i in poly.vertices)
        for li in poly.loop_indices:
            i = me.loops[li].vertex_index
            if face_ok:
                uvl.data[li].uv = (float(np.clip(u[i], 0.03, 0.97)), float(np.clip(v[i], 0.03, 0.97)))
            else:
                uvl.data[li].uv = (0.5, 0.985)


def main():
    t0 = time.time()
    builder.reset_scene()
    P0 = A.base_P(0)
    rig, table = rigmod.build_armature(P0, 'aud_rig')
    colorize = lambda ob, mats, pal, ao, cfg, thin: shading.write_colors(ob, mats, pal, ao, cfg, thin, parts=A.PARTS)
    rows = []
    for vname, tweak in A.VARIANTS:
        for lod in (0, 1):
            P = A.base_P(lod)
            tweak(P)
            name = f'aud_{vname}_lod{lod}'
            B = builder.make_body(name, P, A.COLORS, A.AO, A.assemble, log, colorize)
            body = B['body']
            bad, most = rigmod.finish_weights(body, B['W'], max_influences=2)
            add_face_uv(body, B, P)
            body.name = name
            body.data.name = name
            m = bpy.data.materials.new('aud_toon')
            body.data.materials.clear()
            body.data.materials.append(m)
            for p in body.data.polygons:
                p.material_index = 0
            rigmod.bind(body, rig)
            tris = mk.tri_count(body)
            rows.append((name, tris, len(body.data.vertices), bad))
            log(f'  {name}: 삼각형 {tris}, 꼭짓점 {len(body.data.vertices)}, 가중치 없는 꼭짓점 {bad}  {B["counts"]}')
    log('동작 만들기')
    clips = anim.bake_clips(rig, P0, A.CLIPS, log)
    anim.verify_poses(rig, P0, A.CLIPS, log)
    log('내보내기')
    raw = A.OUT + '.raw.glb'
    os.makedirs(os.path.dirname(A.OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=raw, export_format='GLB', export_yup=True, export_apply=False,
        export_normals=True, export_tangents=False, export_materials='EXPORT', export_texcoords=True,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
        export_skins=True, export_all_influences=False, export_influence_nb=2, export_def_bones=False,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_frame_step=1,
        export_optimize_animation_size=True, export_optimize_animation_keep_anim_armature=True,
        export_reset_pose_bones=True, export_morph=False, export_extras=False, export_cameras=False, export_lights=False,
    )
    stats = glbpack.pack(raw, A.OUT, thin=A.THIN, uv16=True, pos16=True, jw=True)
    os.remove(raw)
    log('---------------- 결과')
    for name, tris, verts, bad in rows:
        log(f'{name:22s} 삼각형 {tris:5d}  꼭짓점 {verts:5d}')
    l0 = [r[1] for r in rows if r[0].endswith('lod0')]
    l1 = [r[1] for r in rows if r[0].endswith('lod1')]
    log(f'lod0 평균 {sum(l0) / len(l0):.0f} 삼각형, lod1 평균 {sum(l1) / len(l1):.0f} 삼각형')
    log(f'뼈: {len(rig.data.bones)} 개, 클립: {[c[0] for c in clips]}')
    log(f'GLB: {stats["before"] / 1024:.0f} kB -> {stats["after"] / 1024:.0f} kB  ({A.OUT})')
    log(f'걸린 시간 {time.time() - t0:.1f} s')


if __name__ == '__main__':
    main()
