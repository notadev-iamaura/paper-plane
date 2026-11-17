"""
wire_view.py - 면 흐름(토폴로지)을 SVG 그림으로 남긴다.

게임 화면의 철망 보기는 삼각형으로 쪼갠 뒤의 선이라 사각형의 대각선까지 그려진다.
여기서는 블렌더 안의 메시(사각형 그대로)를 직접 그려서 "고리가 어떻게 흐르는지"를 보여 준다.
방법: 직교 투영 -> 뒤를 보는 면은 버림 -> 먼 면부터 칠하기(painter's algorithm). 면은 제 색, 선은 남색.
"""
import math
import numpy as np

import meshkit as mk


def write_topology_svg(ob, mats, pal, path, yaws=(-35, 145), size=(800, 1000), title=None):
    me = ob.data
    co = mk.get_co(ob)
    polys = [list(p.vertices) for p in me.polygons]
    normals = np.array([p.normal[:] for p in me.polygons])
    centers = np.array([p.center[:] for p in me.polygons])
    W, H = size
    scale = H * 0.86
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W * len(yaws)} {H}" width="{W * len(yaws)}" height="{H}">',
           f'<rect width="{W * len(yaws)}" height="{H}" fill="#eef2fa"/>']
    for k, yaw in enumerate(yaws):
        a = math.radians(yaw)
        pitch = math.radians(12)
        # 카메라 축: 오른쪽 r, 위 u, 보는 방향의 반대 f(카메라 쪽)
        f = np.array([math.sin(a) * math.cos(pitch), -math.cos(a) * math.cos(pitch), math.sin(pitch)])
        r = np.cross([0, 0, 1], f)
        r /= np.linalg.norm(r)
        u = np.cross(f, r)
        x = co @ r
        y = co @ u
        depth = centers @ f
        facing = normals @ f > 0.02
        order = np.argsort(depth)
        ox, oy = W * k + W / 2, H * 0.93
        out.append('<g stroke="#1d2a4d" stroke-width="0.7" stroke-linejoin="round">')
        for i in order:
            if not facing[i]:
                continue
            pts = ' '.join(f'{ox + x[v] * scale:.1f},{oy - y[v] * scale:.1f}' for v in polys[i])
            out.append(f'<polygon points="{pts}" fill="{pal.hex[pal.names[mats[i]]]}"/>')
        out.append('</g>')
    if title:
        out.append(f'<text x="24" y="{H - 24}" font-family="sans-serif" font-size="22" fill="#1d2a4d">{title}</text>')
    out.append('</svg>')
    with open(path, 'w', encoding='utf8') as fh:
        fh.write('\n'.join(out))
