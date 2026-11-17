"""
glbpack.py - 블렌더가 내보낸 GLB 의 용량을 줄인다(모양과 움직임은 그대로).

glTF 표준이 허용하는 범위 안에서 숫자의 자료형만 작게 바꾼다:
  * 꼭짓점 색(COLOR_0)   : 실수 4 개(16 바이트) -> 0~255 정수 4 개(4 바이트, normalized)
  * 가중치(WEIGHTS_0)    : 실수 4 개(16 바이트) -> 0~255 정수 4 개(4 바이트, normalized). 합이 정확히 255 가 되게 맞춘다.
  * 회전 키프레임        : 실수 4 개(16 바이트) -> -32767~32767 정수 4 개(8 바이트, normalized)
  * 법선(NORMAL)         : 실수 3 개(12 바이트) -> -127~127 정수 3 개 + 빈칸(4 바이트). KHR_mesh_quantization 확장(three.js 가 지원).
  * 키프레임 솎기        : 느린 동작은 한 칸 걸러 한 키만 남긴다(사이는 선형 보간). thin = {클립 이름: 간격}
  * 안 움직이는 채널 지우기: 쉬는 자세 그대로인 위치/회전/배율 채널은 뺀다. 같은 시간표는 한 번만 저장한다.
위치는 손대지 않는다.
"""
import json
import struct
import numpy as np

CT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, ver, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67
    off = 12
    js, binc = None, b''
    while off < length:
        clen, ctype = struct.unpack_from('<II', data, off)
        chunk = data[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode('utf8'))
        elif ctype == 0x004E4942:
            binc = chunk
        off += 8 + clen
    return js, binc


def accessor_array(js, binc, i):
    a = js['accessors'][i]
    bv = js['bufferViews'][a['bufferView']]
    fmt, size = CT[a['componentType']]
    n = NC[a['type']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', size * n)
    if stride == size * n:
        arr = np.frombuffer(binc, dtype=np.dtype(fmt).newbyteorder('<'), count=a['count'] * n, offset=start)
    else:
        arr = np.concatenate([np.frombuffer(binc, dtype=np.dtype(fmt).newbyteorder('<'), count=n, offset=start + k * stride) for k in range(a['count'])])
    return arr.reshape(a['count'], n).copy()


def pack(src, dst, thin=None, uv16=False, pos16=False, jw=False, rigid=None, extras=None):
    """
    uv16 : 텍스처 좌표(0~1)를 0~65535 정수로 줄인다(KHR_mesh_quantization). 관중처럼 작은 그림을 붙이는 모델용.
    pos16: 위치를 -32767~32767 정수로 줄이고(메시의 테두리 상자 기준), 되돌리는 배율과 이동을 그 메시 노드의 scale / translation 에 적는다.
           뼈에 묶인 메시의 노드 변환은 glTF 표준으로는 무시되므로, 읽는 쪽(crowdGlb.ts)이 직접 곱해 되돌린다. 관중 모델에만 쓴다.
    jw   : 뼈 번호와 가중치(JOINTS_0 + WEIGHTS_0 = 8 바이트)를 "뼈 둘 + 첫 뼈의 가중치"(_JW = 4 바이트)로 줄인다.
           메시는 더 이상 표준 스킨 메시가 아니다(노드의 skin 을 뗀다). 뼈의 순서는 asset.extras.joints 에 이름으로 적어 둔다.
           관중 모델에만 쓴다: 게임(crowdGlb.ts)이 뼈 행렬을 그림으로 구워 직접 스키닝한다.
    rigid : {메시 노드 이름: 뼈 이름}. 뼈 하나에만 붙은 메시(머리, 머리카락, 모자)는 뼈 번호와 가중치를 빼고 보통 메시로 내보낸다.
            어느 뼈인지는 asset.extras.rigid 에 적는다. 주인공 모델에만 쓴다(kidGlb.ts 가 합칠 때 되살린다).
    extras: asset.extras 에 더 적어 둘 값.
    pos16 에 함수를 주면 그 함수가 참을 돌려주는 메시 노드만 줄인다.
    """
    thin = thin or {}
    js, binc = read_glb(src)
    if extras:
        js.setdefault('asset', {}).setdefault('extras', {}).update(extras)
    before = len(binc)
    acc = js['accessors']
    arrays = {i: accessor_array(js, binc, i) for i in range(len(acc))}
    conv = {}       # accessor -> (새 배열, componentType, normalized)
    stride4 = set() # 4 바이트 간격으로 놓아야 하는 접근자(법선)
    stride8 = set() # 8 바이트 간격(16 비트로 줄인 위치)
    keep_minmax = {}
    nodes = js['nodes']
    REST = {'translation': [0, 0, 0], 'rotation': [0, 0, 0, 1], 'scale': [1, 1, 1]}
    # ---- 동작: 안 움직이는 채널 지우기 + 솎기
    for an in js.get('animations', []):
        step = int(thin.get(an['name'], 1))
        keep_ch = []
        for ch in an['channels']:
            s = an['samplers'][ch['sampler']]
            v = arrays[s['output']].astype(np.float64)
            path = ch['target']['path']
            rest = np.array(nodes[ch['target']['node']].get(path, REST[path]), dtype=np.float64)
            if path == 'rotation':
                same = (np.abs(np.abs(v @ rest) - 1) < 1e-5).all()
            else:
                same = (np.abs(v - rest) < 1e-5).all()
            if same:
                continue
            keep_ch.append(ch)
            if step > 1 and len(v) > 3 and 'thinned' not in s:
                idx = sorted(set(list(range(0, len(v), step)) + [len(v) - 1]))
                for key in ('input', 'output'):
                    # 다른 샘플러와 접근자를 나눠 쓰지 않도록 새 접근자를 만든다
                    a = dict(acc[s[key]])
                    arr = arrays[s[key]][idx]
                    a['count'] = len(idx)
                    if key == 'input':
                        a['min'] = [float(arr.min())]
                        a['max'] = [float(arr.max())]
                    acc.append(a)
                    arrays[len(acc) - 1] = arr
                    s[key] = len(acc) - 1
                s['thinned'] = True
        an['channels'] = keep_ch
        for s in an['samplers']:
            s.pop('thinned', None)
    for mesh in js.get('meshes', []):
        for prim in mesh['primitives']:
            at = prim['attributes']
            if 'NORMAL' in at:
                nrm = arrays[at['NORMAL']].astype(np.float64)
                nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
                q = np.zeros((len(nrm), 4), dtype=np.int8)
                q[:, :3] = np.round(nrm * 127).astype(np.int8)
                conv[at['NORMAL']] = (q, 5120, True)
                stride4.add(at['NORMAL'])
    if jw and js.get('skins'):
        joints = js['skins'][0]['joints']
        js.setdefault('asset', {}).setdefault('extras', {})['joints'] = [nodes[j].get('name', '') for j in joints]
        for mesh in js.get('meshes', []):
            for prim in mesh['primitives']:
                at = prim['attributes']
                if 'JOINTS_0' not in at:
                    continue
                J = arrays[at['JOINTS_0']].astype(np.int64)
                Wt = arrays[at['WEIGHTS_0']].astype(np.float64)
                order = np.argsort(-Wt, axis=1)[:, :2]
                j2 = np.take_along_axis(J, order, axis=1)
                w2 = np.take_along_axis(Wt, order, axis=1)
                w0 = w2[:, 0] / np.maximum(w2.sum(axis=1), 1e-9)
                q = np.zeros((len(J), 4), dtype=np.uint8)
                q[:, 0] = j2[:, 0]
                q[:, 1] = np.where(w2[:, 1] > 0, j2[:, 1], j2[:, 0])
                q[:, 2] = np.clip(np.round(w0 * 255), 0, 255)
                ai = at.pop('JOINTS_0')
                at.pop('WEIGHTS_0')
                at['_JW'] = ai
                acc[ai]['type'] = 'VEC4'
                conv[ai] = (q, 5121, False)
        for node in nodes:
            node.pop('skin', None)
        js.pop('skins', None)
    if rigid:
        js.setdefault('asset', {}).setdefault('extras', {})['rigid'] = dict(rigid)
        for node in nodes:
            if 'mesh' in node and node.get('name') in rigid:
                node.pop('skin', None)
                for prim in js['meshes'][node['mesh']]['primitives']:
                    prim['attributes'].pop('JOINTS_0', None)
                    prim['attributes'].pop('WEIGHTS_0', None)
    if pos16:
        for ni, node in enumerate(nodes):
            if 'mesh' not in node:
                continue
            if callable(pos16) and not pos16(node.get('name', '')):
                continue
            for prim in js['meshes'][node['mesh']]['primitives']:
                ai = prim['attributes']['POSITION']
                pos = arrays[ai].astype(np.float64)
                lo, hi = pos.min(axis=0), pos.max(axis=0)
                ctr, half = (lo + hi) / 2, np.maximum((hi - lo) / 2, 1e-6)
                q = np.zeros((len(pos), 4), dtype=np.int16)        # 한 점 = 8 바이트(x, y, z, 빈칸): 4 바이트 경계에 맞춘다
                q[:, :3] = np.round((pos - ctr) / half * 32767).astype(np.int16)
                conv[ai] = (q, 5122, True)
                stride8.add(ai)
                keep_minmax[ai] = ([-32767, -32767, -32767], [32767, 32767, 32767])
                node['translation'] = [float(x) for x in ctr]
                node['scale'] = [float(x) for x in half]
                node.pop('matrix', None)
    if uv16:
        for mesh in js.get('meshes', []):
            for prim in mesh['primitives']:
                at = prim['attributes']
                if 'TEXCOORD_0' in at and at['TEXCOORD_0'] not in conv:
                    uv = np.clip(arrays[at['TEXCOORD_0']].astype(np.float64), 0, 1)
                    conv[at['TEXCOORD_0']] = (np.round(uv * 65535).astype(np.uint16), 5123, True)
    if stride4 or uv16 or pos16:
        for key in ('extensionsUsed', 'extensionsRequired'):
            lst = js.setdefault(key, [])
            if 'KHR_mesh_quantization' not in lst:
                lst.append('KHR_mesh_quantization')
    for mesh in js.get('meshes', []):
        for prim in mesh['primitives']:
            at = prim['attributes']
            for ck in [k for k in at if k.startswith('COLOR_')]:
                c = arrays[at[ck]].astype(np.float64)
                if acc[at[ck]]['componentType'] == 5123:
                    c = c / 65535.0
                if c.shape[1] == 3:
                    c = np.concatenate([c, np.ones((len(c), 1))], axis=1)
                    acc[at[ck]]['type'] = 'VEC4'
                conv[at[ck]] = (np.clip(np.round(c * 255), 0, 255).astype(np.uint8), 5121, True)
            if 'WEIGHTS_0' in at:
                w = arrays[at['WEIGHTS_0']].astype(np.float64)
                w = w / np.maximum(w.sum(axis=1, keepdims=True), 1e-9)
                q = np.floor(w * 255).astype(np.int64)
                # 남는 몫은 가장 큰 가중치에 더해 합을 255 로 맞춘다
                rem = 255 - q.sum(axis=1)
                q[np.arange(len(q)), np.argmax(w, axis=1)] += rem
                conv[at['WEIGHTS_0']] = (q.astype(np.uint8), 5121, True)
    for an in js.get('animations', []):
        for ch in an['channels']:
            if ch['target']['path'] == 'rotation':
                s = an['samplers'][ch['sampler']]
                o = s['output']
                if o not in conv and acc[o]['componentType'] == 5126:
                    q = arrays[o].astype(np.float64)
                    q /= np.maximum(np.linalg.norm(q, axis=1, keepdims=True), 1e-9)
                    conv[o] = (np.round(q * 32767).astype(np.int16), 5122, True)
    # 쓰이지 않게 된 접근자는 버리고 번호를 다시 매긴다. 내용이 같은 시간표(input)는 하나로 합친다.
    used = []

    def use(i):
        if i not in used:
            used.append(i)
    for mesh in js.get('meshes', []):
        for prim in mesh['primitives']:
            for v in prim['attributes'].values():
                use(v)
            if 'indices' in prim:
                use(prim['indices'])
    for sk in js.get('skins', []):
        if 'inverseBindMatrices' in sk:
            use(sk['inverseBindMatrices'])
    seen_time = {}
    for an in js.get('animations', []):
        live = sorted({ch['sampler'] for ch in an['channels']})
        remap_s = {o: n for n, o in enumerate(live)}
        an['samplers'] = [an['samplers'][o] for o in live]
        for ch in an['channels']:
            ch['sampler'] = remap_s[ch['sampler']]
        for s in an['samplers']:
            key = arrays[s['input']].tobytes()
            if key in seen_time:
                s['input'] = seen_time[key]
            else:
                seen_time[key] = s['input']
            use(s['input'])
            use(s['output'])
    remap = {o: n for n, o in enumerate(used)}
    for mesh in js.get('meshes', []):
        for prim in mesh['primitives']:
            prim['attributes'] = {k: remap[v] for k, v in prim['attributes'].items()}
            if 'indices' in prim:
                prim['indices'] = remap[prim['indices']]
    for sk in js.get('skins', []):
        if 'inverseBindMatrices' in sk:
            sk['inverseBindMatrices'] = remap[sk['inverseBindMatrices']]
    for an in js.get('animations', []):
        for s in an['samplers']:
            s['input'] = remap[s['input']]
            s['output'] = remap[s['output']]
    conv = {remap[k]: v for k, v in conv.items() if k in remap}
    stride4 = {remap[k] for k in stride4 if k in remap}
    stride8 = {remap[k] for k in stride8 if k in remap}
    keep_minmax = {remap[k]: v for k, v in keep_minmax.items() if k in remap}
    arrays = {remap[k]: v for k, v in arrays.items() if k in remap}
    acc = [acc[o] for o in used]
    js['accessors'] = acc
    # 버퍼를 다시 쌓는다(접근자마다 버퍼뷰 하나)
    out = bytearray()
    views = []
    old_views = js['bufferViews']
    for i, a in enumerate(acc):
        if 'bufferView' not in a:
            continue
        if i in conv:
            arr, ct, norm = conv[i]
            a['componentType'] = ct
            if norm:
                a['normalized'] = True
            else:
                a.pop('normalized', None)
            a.pop('min', None)
            a.pop('max', None)
            if i in keep_minmax:
                a['min'], a['max'] = keep_minmax[i]
        else:
            arr = arrays[i]
        fmt, size = CT[a['componentType']]
        raw = np.ascontiguousarray(arr.astype(np.dtype(fmt).newbyteorder('<'))).tobytes()
        while len(out) % 4:
            out.append(0)
        view = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(raw)}
        tgt = old_views[a['bufferView']].get('target')
        if tgt:
            view['target'] = tgt
        if i in stride8:
            view['byteStride'] = 8
        if i in stride4:
            view['byteStride'] = 4
        out += raw
        a['bufferView'] = len(views)
        a.pop('byteOffset', None)
        views.append(view)
    # 접근자에 묶이지 않은 버퍼뷰(그림 등)는 없다고 가정한다(이 모델은 텍스처를 넣지 않는다)
    js['bufferViews'] = views
    while len(out) % 4:
        out.append(0)
    js['buffers'] = [{'byteLength': len(out)}]
    jb = json.dumps(js, separators=(',', ':')).encode('utf8')
    while len(jb) % 4:
        jb += b' '
    total = 12 + 8 + len(jb) + 8 + len(out)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A))
        f.write(jb)
        f.write(struct.pack('<II', len(out), 0x004E4942))
        f.write(out)
    return {'before': before, 'after': total, 'json': js, 'json_bytes': len(jb)}
