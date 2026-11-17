/**
 * 바람에 휜 날개를 보여 주는 도우미(바람 실험실 전용).
 * planeMesh.ts 의 buildPlaneObject 가 만든 비행기는 휘는 기능이 없어서, 만든 뒤의 꼭짓점을 여기서 직접 옮긴다.
 * (planeMesh 내부는 건드리지 않는다. 물체 안의 도형 넷: 앞면, 뒷면(같은 자리 버퍼), 옆면, 외곽선을 읽어 쓴다.)
 *
 * - 휨: 날개 뿌리에서 끝으로 갈수록 포물선으로 들린다. 날개 끝까지 이은 선이 flexDeg 만큼 들리게 맞춘다(과장 없음).
 * - 꺾임(buckled): 날개 중간에서 접혀 올라가고, 접힌 바깥쪽은 자글자글 구겨진다.
 * 화면 표시일 뿐이며 계산에는 쓰이지 않는다.
 */
import * as THREE from 'three';
import type { PlaneObject } from './planeMesh';

export interface WingBend {
  /** flexLeftDeg / flexRightDeg: core 가 준 값(위로 +). buckled: 꺾였는지. 값이 바뀐 때만 버퍼를 고친다. */
  apply: (flexLeftDeg: number, flexRightDeg: number, buckled: boolean) => void;
}

const DEG = Math.PI / 180;
/** 이 폭까지는 몸통으로 보고 휘지 않는다(m) */
const ROOT_M = 0.012;
/** 꺾이는 자리(날개 폭의 비율)와 꺾이는 각도 */
const HINGE_AT = 0.45;
const BUCKLE_DEG = 62;

interface Buf { arr: Float32Array; base: Float32Array; touch: () => void }

export function createWingBend(plane: PlaneObject): WingBend {
  const bufs: Buf[] = [];
  const front = plane.group.children[0] as THREE.Mesh | undefined;
  const wall = plane.group.children[2] as THREE.Mesh | undefined;
  const edges = plane.group.children[3] as THREE.Mesh | undefined;
  const frontGeom = front?.geometry as THREE.BufferGeometry | undefined;
  const wallGeom = wall?.geometry as THREE.BufferGeometry | undefined;

  const take = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined, after?: () => void): void => {
    if (!attr) return;
    const inter = (attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute === true;
    const arr = (inter ? (attr as THREE.InterleavedBufferAttribute).data.array : (attr as THREE.BufferAttribute).array) as Float32Array;
    if (!(arr instanceof Float32Array) || arr.length === 0) return;
    bufs.push({
      arr,
      base: arr.slice(),
      touch: () => {
        if (inter) (attr as THREE.InterleavedBufferAttribute).data.needsUpdate = true;
        else (attr as THREE.BufferAttribute).needsUpdate = true;
        after?.();
      },
    });
  };
  take(frontGeom?.getAttribute('position') as THREE.BufferAttribute | undefined, () => frontGeom?.computeVertexNormals());
  take(wallGeom?.getAttribute('position') as THREE.BufferAttribute | undefined, () => wallGeom?.computeVertexNormals());
  // 외곽선(LineSegments2): 선분마다 (시작 xyz, 끝 xyz) 여섯 값이 한 버퍼에 들어 있다.
  take((edges?.geometry as THREE.BufferGeometry | undefined)?.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute | undefined);

  // 날개 폭: three 좌표 z 가 오른쪽(+)이다.
  let half = 0.03;
  for (const b of bufs) for (let i = 2; i < b.base.length; i += 3) half = Math.max(half, Math.abs(b.base[i]!));
  const reach = Math.max(0.01, half - ROOT_M);

  let lastL = 0, lastR = 0, lastB = false;
  const apply = (flexLeftDeg: number, flexRightDeg: number, buckled: boolean): void => {
    const fl = Math.round(flexLeftDeg * 4) / 4, fr = Math.round(flexRightDeg * 4) / 4;
    if (fl === lastL && fr === lastR && buckled === lastB) return;
    lastL = fl; lastR = fr; lastB = buckled;
    const tanL = Math.tan(Math.max(-60, Math.min(60, fl)) * DEG), tanR = Math.tan(Math.max(-60, Math.min(60, fr)) * DEG);
    const hinge = reach * HINGE_AT;
    for (const b of bufs) {
      const { arr, base } = b;
      for (let i = 0; i < base.length; i += 3) {
        const x = base[i]!, y = base[i + 1]!, z = base[i + 2]!;
        const right = z >= 0;
        const u = Math.abs(z) - ROOT_M;
        if (u <= 0) { arr[i] = x; arr[i + 1] = y; arr[i + 2] = z; continue; }
        const tan = right ? tanR : tanL;
        let ny = y + (tan * u * u) / reach;
        let nu = u;
        if (buckled && u > hinge) {
          // 꺾인 자리 바깥쪽을 접어 올린다(휜 쪽으로). 접힌 종이는 구겨져서 울퉁불퉁하다.
          const dir = tan < 0 ? -1 : 1;
          const a = dir * BUCKLE_DEG * DEG;
          const du = u - hinge;
          const hy = y + (tan * hinge * hinge) / reach;
          const crumple = 0.0035 * Math.sin(x * 190 + du * 260) * Math.min(1, du / 0.01);
          nu = hinge + du * Math.cos(a);
          ny = hy + du * Math.sin(a) + crumple;
        }
        arr[i] = x;
        arr[i + 1] = ny;
        arr[i + 2] = (right ? 1 : -1) * (nu + ROOT_M);
      }
      b.touch();
    }
  };
  return { apply };
}
