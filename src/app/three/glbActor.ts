/**
 * 블렌더(파이썬 코드)로 만든 캐릭터 모델(kid.glb, referee.glb)을 무대에 올릴 때 함께 쓰는 도구.
 *
 * - loadGlb     : 모델 파일을 읽는다. 모델이 JS 안에 data: 주소로 들어 있는 빌드에서는 네트워크 요청 없이 바로 푼다.
 * - dressToon   : 몸에 툰 재질과 남색 외곽선(같은 뼈대를 따르는 껍데기)을 입히고, 얼굴 그림판에 표정 묶음을 붙인다.
 * - ClipSet     : 동작 클립을 무게로 섞는다(시간은 무대의 시계로 직접 넣는다).
 * - rotateWorld, solveArm : 클립 위에 덧붙이는 회전과 두 마디 IK.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { makeFaceAtlas2 } from './faceAtlas';
import type { FaceLook } from './faceAtlas';
import { FACE_ATLAS } from './kid';
import type { Expr } from './kid';
import { outlineMat, texOf, toonMat, Trash } from './toon';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const ease = (t: number): number => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };

/** data:...;base64,XXXX 주소를 바이트 배열로 바꾼다. */
export function dataUrlToBuffer(url: string): ArrayBuffer {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/**
 * 모델을 읽는다. 주소가 data: 로 시작하면(모델을 JS 에 넣은 빌드) 네트워크 요청 없이 바로 풀어서 읽는다
 * (요청이 막힌 게시 환경에서도 불러올 수 있게).
 */
export function loadGlb(url: string): Promise<GLTF> {
  const loader = new GLTFLoader();
  return url.startsWith('data:') ? loader.parseAsync(dataUrlToBuffer(url), '') : loader.loadAsync(url);
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _ax = new THREE.Vector3();
const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _pqi = new THREE.Quaternion();

/** 뼈를 세계 좌표 기준의 회전 q 만큼 더 돌린다. */
export function rotateWorld(bone: THREE.Object3D, q: THREE.Quaternion): void {
  const parent = bone.parent;
  if (!parent) { bone.quaternion.premultiply(q); return; }
  parent.getWorldQuaternion(_pq);
  _pqi.copy(_pq).invert();
  bone.quaternion.premultiply(_pq.premultiply(q).premultiply(_pqi));
}

export const angleBetween = (u: THREE.Vector3, v: THREE.Vector3): number => Math.acos(clamp(u.dot(v) / Math.max(1e-9, u.length() * v.length()), -1, 1));

/**
 * 두 마디 IK: 위팔, 아래팔을 돌려 끝점(eff)이 target 에 오게 한다. 팔꿈치가 굽는 방향은 지금 자세의 것을 그대로 쓴다.
 * weight 가 1 보다 작으면 지금 자리와 목표 사이의 그만큼만 간다.
 */
export function solveArm(upper: THREE.Object3D, fore: THREE.Object3D, eff: THREE.Object3D, target: THREE.Vector3, weight: number): void {
  if (weight <= 0.001) return;
  upper.getWorldPosition(_a);
  fore.getWorldPosition(_b);
  eff.getWorldPosition(_c);
  _t.copy(_c).lerp(target, Math.min(1, weight));
  const lab = _a.distanceTo(_b), lcb = _b.distanceTo(_c);
  const lat = clamp(_a.distanceTo(_t), Math.abs(lab - lcb) + 1e-3, lab + lcb - 1e-3);
  const acab0 = angleBetween(_v1.copy(_c).sub(_a), _v2.copy(_b).sub(_a));
  const babc0 = angleBetween(_v1.copy(_a).sub(_b), _v2.copy(_c).sub(_b));
  const acab1 = Math.acos(clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat), -1, 1));
  const babc1 = Math.acos(clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb), -1, 1));
  _ax.copy(_v1.copy(_c).sub(_a)).cross(_v2.copy(_b).sub(_a));
  if (_ax.lengthSq() < 1e-10) _ax.set(0, 0, 1);
  _ax.normalize();
  rotateWorld(fore, _q.setFromAxisAngle(_ax, babc1 - babc0));
  rotateWorld(upper, _q.setFromAxisAngle(_ax, acab1 - acab0));
  // 길이를 맞췄으니, 어깨를 돌려 방향을 맞춘다
  upper.updateWorldMatrix(false, true);
  eff.getWorldPosition(_c);
  _v1.copy(_c).sub(_a).normalize();
  _v2.copy(_t).sub(_a).normalize();
  rotateWorld(upper, _q.setFromUnitVectors(_v1, _v2));
  upper.updateWorldMatrix(false, true);
}

/** 쉬는 자세에서 캐릭터의 위, 오른쪽, 앞 축이 그 뼈의 좌표로는 어느 쪽인지(고개와 허리를 돌릴 때 쓴다) */
export interface BoneAxes { up: THREE.Vector3; right: THREE.Vector3; fwd: THREE.Vector3 }
export function axesOf(b: THREE.Object3D): BoneAxes {
  const inv = b.getWorldQuaternion(new THREE.Quaternion()).invert();
  return { up: new THREE.Vector3(0, 1, 0).applyQuaternion(inv), right: new THREE.Vector3(0, 0, 1).applyQuaternion(inv), fwd: new THREE.Vector3(1, 0, 0).applyQuaternion(inv) };
}
const _qy = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qt = new THREE.Quaternion();
/** 뼈를 캐릭터 기준의 좌우(yaw), 위아래(pitch), 갸웃(tilt)으로 더 돌린다. */
export function turnBone(b: THREE.Object3D, ax: BoneAxes, yaw: number, pitch: number, tilt = 0): void {
  _qy.setFromAxisAngle(ax.up, yaw);
  _qp.setFromAxisAngle(ax.right, pitch);
  b.quaternion.multiply(_qy).multiply(_qp);
  if (tilt !== 0) b.quaternion.multiply(_qt.setFromAxisAngle(ax.fwd, tilt));
}

export interface Dressed {
  body: THREE.SkinnedMesh;
  face: THREE.SkinnedMesh;
  tag: THREE.SkinnedMesh | null;
  hull: THREE.SkinnedMesh;
  setFace: (e: Expr, blink: boolean) => void;
  setOutline: (on: boolean) => void;
  trash: Trash;
}

/** glTF 는 그림의 위아래가 반대라서, 캔버스 그림을 붙일 판의 UV 를 뒤집어 맞춘다. */
export function flipV(g: THREE.BufferGeometry): void {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  uv.needsUpdate = true;
}

/**
 * 모델에 재질을 입힌다.
 *  - 몸(<name>_body): 꼭짓점 색 + 툰 재질. 외곽선은 같은 뼈대를 따르는 껍데기이고,
 *    두께에 꼭짓점 색의 알파를 곱한다(모델이 "여기는 얇게"를 알파에 적어 두었다: 엄지 틈, 옷의 안쪽 접힘).
 *  - 얼굴(<name>_face): 캔버스에 그린 표정 묶음. 표정을 바꾸는 방법은 기존 아이와 같다(setFace).
 */
export function dressToon(model: THREE.Object3D, name: string, outline: number, face: FaceLook): Dressed {
  const trash = new Trash();
  const keep = <T extends { dispose: () => void }>(x: T): T => trash.keep(x);
  let body: THREE.SkinnedMesh | null = null, faceM: THREE.SkinnedMesh | null = null, tag: THREE.SkinnedMesh | null = null;
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    if (m.name.startsWith(`${name}_body`)) body = m;
    else if (m.name.startsWith(`${name}_face`)) faceM = m;
    else if (m.name.startsWith(`${name}_tag`)) tag = m;
  });
  if (!body || !faceM) throw new Error(`${name}.glb: 몸이나 얼굴 메시가 없어요`);
  const bodyM = body as THREE.SkinnedMesh, fM = faceM as THREE.SkinnedMesh, tagM = tag as THREE.SkinnedMesh | null;
  for (const m of [bodyM, fM, tagM]) {
    if (!m) continue;
    keep(m.geometry);
    (m.material as THREE.Material).dispose();
    // 뼈가 움직이면 처음 계산한 테두리 상자를 벗어난다: 화면 밖으로 잘못 걸러지지 않게 한다
    m.frustumCulled = false;
  }
  bodyM.material = keep(toonMat({ vertexColors: true, rim: 0.3, skin: true }));
  bodyM.castShadow = true;
  const line = keep(outlineMat(outline));
  line.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute vec4 color;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `vec3 transformed = position + normalize(normal) * ${outline.toFixed(5)} * color.a;`);
  };
  line.customProgramCacheKey = () => `glb-outline-${outline.toFixed(5)}`;
  const hull = new THREE.SkinnedMesh(bodyM.geometry, line);
  hull.bind(bodyM.skeleton, bodyM.bindMatrix);
  hull.frustumCulled = false;
  bodyM.parent?.add(hull);

  flipV(fM.geometry);
  const { exprs, cols, rows } = FACE_ATLAS;
  const faceTex = keep(texOf(makeFaceAtlas2(face), 4));
  faceTex.repeat.set(1 / cols, 1 / rows);
  fM.material = keep(new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  fM.renderOrder = 2;
  return {
    body: bodyM, face: fM, tag: tagM, hull, trash,
    setFace: (e, blink) => {
      const cell = exprs.indexOf(e) * 2 + (blink ? 1 : 0);
      faceTex.offset.set((cell % cols) / cols, 1 - (Math.floor(cell / cols) + 1) / rows);
    },
    setOutline: (on) => { hull.visible = on; },
  };
}

/** 동작 클립 묶음: 클립마다의 무게를 부드럽게 옮기고 합이 1 이 되게 맞춘다. 시간은 무대가 직접 넣는다. */
export class ClipSet<N extends string> {
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<N, THREE.AnimationAction>();
  private dur = new Map<N, number>();
  private weight = new Map<N, number>();
  private wanted = new Map<N, number>();
  constructor(private model: THREE.Object3D, clips: THREE.AnimationClip[], readonly names: readonly N[], file: string) {
    this.mixer = new THREE.AnimationMixer(model);
    for (const name of names) {
      const clip = clips.find((c) => c.name === name);
      if (!clip) throw new Error(`${file}: 동작 ${name} 이 없어요`);
      this.dur.set(name, clip.duration);
      const a = this.mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = false;
      a.play();
      a.timeScale = 0;
      a.setEffectiveWeight(0);
      this.actions.set(name, a);
      this.weight.set(name, 0);
    }
  }
  duration(n: N): number { return this.dur.get(n) ?? 1; }
  clear(): void { for (const n of this.names) this.wanted.set(n, 0); }
  want(n: N, w: number): void { this.wanted.set(n, w); }
  /** 끝 프레임에 딱 맞추면 되풀이로 처음에 돌아가 버리므로 아주 조금 앞에 둔다 */
  setTime(n: N, t: number, loop: boolean): void {
    const d = this.duration(n);
    this.actions.get(n)!.time = loop ? ((t % d) + d) % d : clamp(t, 0, d - 1e-4);
  }
  /** k: 이번 프레임에 목표 무게 쪽으로 옮겨 갈 비율(0~1) */
  blend(k: number): void {
    let sum = 0;
    for (const n of this.names) {
      const w = (this.weight.get(n) ?? 0) + ((this.wanted.get(n) ?? 0) - (this.weight.get(n) ?? 0)) * k;
      this.weight.set(n, w < 1e-4 ? 0 : w);
      sum += this.weight.get(n) ?? 0;
    }
    for (const n of this.names) this.actions.get(n)!.setEffectiveWeight(sum > 1e-6 ? (this.weight.get(n) ?? 0) / sum : 0);
  }
  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
  }
}
