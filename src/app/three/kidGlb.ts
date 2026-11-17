/**
 * 블렌더(파이썬 코드)로 만든 아이 모델(kid.glb)을 불러와 무대가 쓰는 "아이" 자리에 끼워 넣는다.
 *
 * - 모델: tools/character/build_kid.py 가 만든다. 한 장으로 이어진 살과 옷, 뼈대, 동작 클립이 들어 있다.
 * - 재질: toon.ts 의 툰 재질과 남색 외곽선을 그대로 쓴다. 외곽선은 같은 뼈대를 따르는 껍데기(SkinnedMesh)다.
 * - 얼굴: kid.ts 가 캔버스에 그리는 표정 묶음을 머리 앞면에 붙인다(표정 8 가지 + 눈 깜빡임을 그대로 쓴다).
 * - 동작: 클립은 AnimationMixer 로 섞고, 그 위에 "고개 돌리기"와 "오른손을 비행기 쥐는 자리에 맞추기(IK)"를 얹는다.
 * - 무대가 보기에는 기존 아이(kid.ts 의 Actor)와 똑같이 생겼다: chibi.root / handR / headPos / update / snap / dispose.
 *
 * 이 파일은 필요할 때만 따로 내려받는다(GymStage 가 import() 로 부른다). 기본 아이를 쓰는 동안에는 한 바이트도 더 받지 않는다.
 * 좌표: 모델은 +Z 가 앞(glTF). 게임의 캐릭터는 +X 가 앞이라 통째로 90도 돌려 넣는다.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import kidUrl from '../assets/kid.glb?url';
import wardrobeUrl from '../assets/kid-wardrobe.glb?url';
import { byId, defaultLook, HAIR_HAT, hexToLinear, IRIS_COLORS, needsWardrobe, piecesOf, sanitizeLook, slotColors } from '../lib/characterLook';
import type { CharacterLook, SlotName } from '../lib/characterLook';
import { log } from '../lib/logger';
import { tok } from '../lib/palette';
import { browOf, makeFaceAtlas2 } from './faceAtlas';
import type { FaceLook } from './faceAtlas';
import { axesOf, clamp, ease, flipV, loadGlb, solveArm, turnBone } from './glbActor';
import { FACE_ATLAS } from './kid';
import type { Actor, Chibi, ChibiLook, Expr, KidInput } from './kid';
import { canvasOf, outlineMat, roundRect, texOf, toonMat, Trash } from './toon';

type ClipName = 'Idle' | 'Home' | 'AimLow' | 'AimMid' | 'AimHigh' | 'WindUp' | 'Throw' | 'Watch' | 'Cheer' | 'CheerHold' | 'Nod' | 'Slump';
const CLIPS: ClipName[] = ['Idle', 'Home', 'AimLow', 'AimMid', 'AimHigh', 'WindUp', 'Throw', 'Watch', 'Cheer', 'CheerHold', 'Nod', 'Slump'];
/** 만세는 0.55 초에 한 번 뛴다(clips_kid.py 의 Cheer 와 같은 값). 네 번 뛰고 나면 팔만 든 채 흔든다. */
const CHEER_JUMPS_S = 2.2;
/** 외곽선 두께(모델 단위). 기존 아이와 같은 값. */
const OUTLINE = 0.0075;

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

export interface KidGlbOpts {
  /** 얼굴 그림의 배율(1 = 칸 256 x 192). 낮은 단계에서는 1, 그 밖에는 1.5 */
  facePx?: number;
  /** 내 캐릭터의 차림. 없으면 기본 차림 */
  character?: CharacterLook;
}

/** 차림을 바꿨을 때의 작은 반응: hop = 폴짝 뛰며 웃는다, look = 새 모자를 올려다본다 */
export type KidReact = 'hop' | 'look';
export type ThumbView = 'head' | 'body';
/** 갈아입을 수 있는 아이: 무대가 쓰는 Actor 에 차림 바꾸기를 더했다. */
export interface DressActor extends Actor {
  /** 차림을 바꾼다(모델을 다시 불러오지 않는다). 옷장 파일이 아직 없으면 받아 온 뒤에 마저 입힌다. */
  setLook: (look: CharacterLook) => void;
  react: (kind: KidReact) => void;
  /** 그 차림을 한 아이의 작은 그림(선택지 단추용). 아직 그릴 수 없으면 null. */
  thumb: (renderer: THREE.WebGLRenderer, look: CharacterLook, view: ThumbView, size: number, yaw?: number) => HTMLCanvasElement | null;
  /** 옷장 파일까지 다 받았는지 */
  wardrobeReady: () => boolean;
}

// ---------------------------------------------------------------------------
// 모델의 조각(머리, 머리카락, 모자, 윗옷...)을 꺼내 한 메시로 합친다
// ---------------------------------------------------------------------------
/** 조각 하나: 꼭짓점 자료를 평평한 배열로 풀어 둔 것(모델 파일의 메시는 꺼낸 뒤 버린다) */
interface Piece {
  n: number;
  pos: Float32Array; nor: Float32Array;
  /** 꼭짓점마다 (그늘 k, 덧그늘, 부분 번호, 외곽선 두께) 0~255 */
  col: Uint8Array;
  /** 머리만: 머리 모양 1~4, 5~7 번일 때의 그늘 k */
  col1: Uint8Array | null; col2: Uint8Array | null;
  ji: Uint16Array; jw: Float32Array;
  idx: Uint32Array;
}
interface KidInfo { slots: { name: SlotName; tint: [number, number, number] }[]; crownBit: number; hair: string[]; rigid: Record<string, string> }

function infoOf(gltf: GLTF): KidInfo {
  const ex = (gltf.asset as { extras?: { kid?: { slots: [string, number, number[]][]; crownBit: number; hair: string[] }; rigid?: Record<string, string> } }).extras;
  if (!ex?.kid) throw new Error('kid.glb: 부분 정보(asset.extras.kid)가 없어요');
  return {
    slots: ex.kid.slots.map(([name, , t]) => ({ name: name as SlotName, tint: [t[0] ?? 1, t[1] ?? 1, t[2] ?? 1] })),
    crownBit: ex.kid.crownBit, hair: ex.kid.hair, rigid: ex.rigid ?? {},
  };
}

/** 메시에서 조각을 꺼낸다. 줄여 적은 위치(16 비트)는 노드의 배율과 이동으로 되돌린다. bones = 기본 파일의 뼈 이름 순서. */
function pieceOf(m: THREE.Mesh, bones: string[], rigidBone: string | undefined, noColor = false): Piece {
  const g = m.geometry;
  const P = g.getAttribute('position'), N = g.getAttribute('normal'), C = noColor ? null : g.getAttribute('color');
  const n = P.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Uint8Array(n * 4);
  const sc = m.scale, tr = m.position;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = P.getX(i) * sc.x + tr.x; pos[i * 3 + 1] = P.getY(i) * sc.y + tr.y; pos[i * 3 + 2] = P.getZ(i) * sc.z + tr.z;
    nor[i * 3] = N.getX(i); nor[i * 3 + 1] = N.getY(i); nor[i * 3 + 2] = N.getZ(i);
    if (C) { col[i * 4] = Math.round(C.getX(i) * 255); col[i * 4 + 1] = Math.round(C.getY(i) * 255); col[i * 4 + 2] = Math.round(C.getZ(i) * 255); col[i * 4 + 3] = Math.round(C.getW(i) * 255); }
  }
  const more = (name: string): Uint8Array | null => {
    const A = g.getAttribute(name);
    if (!A) return null;
    const out = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { out[i * 4] = Math.round(A.getX(i) * 255); out[i * 4 + 1] = Math.round(A.getY(i) * 255); out[i * 4 + 2] = Math.round(A.getZ(i) * 255); out[i * 4 + 3] = Math.round(A.getW(i) * 255); }
    return out;
  };
  const ji = new Uint16Array(n * 4), jw = new Float32Array(n * 4);
  const sm = m as THREE.SkinnedMesh;
  if (rigidBone !== undefined || !sm.isSkinnedMesh) {
    const b = bones.indexOf((rigidBone ?? 'head').replace('.', ''));
    if (b < 0) throw new Error(`kid: 뼈 ${rigidBone} 가 없어요`);
    for (let i = 0; i < n; i++) { ji[i * 4] = b; jw[i * 4] = 1; }
  } else {
    const J = g.getAttribute('skinIndex'), W = g.getAttribute('skinWeight');
    // 옷장 파일의 뼈 순서가 기본 파일과 달라도 이름으로 맞춘다
    const map = sm.skeleton.bones.map((bn) => Math.max(0, bones.indexOf(bn.name)));
    for (let i = 0; i < n; i++) {
      const w = [W.getX(i), W.getY(i), W.getZ(i), W.getW(i)];
      const j = [J.getX(i), J.getY(i), J.getZ(i), J.getW(i)];
      const sum = w[0]! + w[1]! + w[2]! + w[3]! || 1;
      for (let k = 0; k < 4; k++) { ji[i * 4 + k] = w[k]! > 0 ? map[j[k]!] ?? 0 : 0; jw[i * 4 + k] = w[k]! / sum; }
    }
  }
  const I = g.getIndex();
  const idx = new Uint32Array(I ? I.count : n);
  for (let i = 0; i < idx.length; i++) idx[i] = I ? I.getX(i) : i;
  return { n, pos, nor, col, col1: more('color_1'), col2: more('color_2'), ji, jw, idx };
}

/** 옷장 파일(kid-wardrobe.glb)의 조각들. 한 번만 받아서 모든 아이가 함께 쓴다. */
interface Wardrobe { pieces: Map<string, Piece>; tagBib: { pos: Float32Array; nor: Float32Array; uv: Float32Array; ji: Uint16Array; jw: Float32Array; idx: Uint32Array } | null }
let wardrobeCache: Promise<Wardrobe | null> | null = null;
function loadWardrobe(bones: string[]): Promise<Wardrobe | null> {
  wardrobeCache ??= loadGlb(wardrobeUrl).then((gltf) => {
    const info = infoOf(gltf);
    const out: Wardrobe = { pieces: new Map(), tagBib: null };
    const meshes: THREE.Mesh[] = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    for (const m of meshes) {
      if (m.name.startsWith('kid_tag')) {
        const p = pieceOf(m, bones, undefined, true);
        const U = m.geometry.getAttribute('uv');
        const uv = new Float32Array(p.n * 2);
        for (let i = 0; i < p.n; i++) { uv[i * 2] = U.getX(i); uv[i * 2 + 1] = 1 - U.getY(i); }
        out.tagBib = { pos: p.pos, nor: p.nor, uv, ji: p.ji, jw: p.jw, idx: p.idx };
      } else if (m.name.startsWith('kid_')) out.pieces.set(m.name.slice(4), pieceOf(m, bones, info.rigid[m.name]));
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
    }
    return out;
  }).catch((err) => { log.warn('three', '옷장 파일을 불러오지 못했어요. 기본 모양에 색만 입혀요', err); return null; });
  return wardrobeCache;
}

export async function loadKidGlb(look: ChibiLook, opts: KidGlbOpts = {}): Promise<DressActor> {
  // 모델이 JS 안에 data: 주소로 들어 있는 빌드에서는 네트워크 요청 없이 바로 풀어서 읽는다(glbActor.loadGlb).
  const gltf = await loadGlb(kidUrl);
  const info = infoOf(gltf);
  const kid = look.kind === 'kid';
  let cur = sanitizeLook(opts.character ?? defaultLook());

  const root = new THREE.Group();
  root.scale.setScalar(look.scale);
  const model = gltf.scene;
  model.rotation.y = Math.PI / 2;
  root.add(model);
  root.updateMatrixWorld(true);

  // ---- 뼈 찾기(three 는 이름의 점을 지운다: 'upper_arm.R' -> 'upper_armR')
  const bone = (name: string): THREE.Object3D => {
    const o = model.getObjectByName(name.replace('.', ''));
    if (!o) throw new Error(`kid.glb: 뼈 ${name} 가 없어요`);
    return o;
  };
  const B = {
    root: bone('root'), hips: bone('hips'), spine: bone('spine'), chest: bone('chest'), neck: bone('neck'), head: bone('head'),
    upperR: bone('upper_arm.R'), foreR: bone('forearm.R'), handR: bone('hand.R'), gripR: bone('hand_grip.R'), handL: bone('hand.L'),
  };
  const AX = { spine: axesOf(B.spine), chest: axesOf(B.chest), neck: axesOf(B.neck), head: axesOf(B.head) };
  /** 머리 한가운데, 손차양 자리(머리뼈 기준). 캐릭터 기준 좌표(키 1)에서 머리뼈 좌표로 옮겨 둔다. */
  const inHead = (x: number, y: number, z: number): THREE.Vector3 => B.head.worldToLocal(root.localToWorld(new THREE.Vector3(x, y, z)));
  const headCenterL = inHead(0, 0.752, 0);
  const visorL = inHead(0.235, 0.805, 0.10);

  // ---- 조각 꺼내기: 모델 파일의 메시는 그리지 않는다. 고른 차림의 조각만 한 메시로 합쳐 그린다.
  const trash = new Trash();
  const keep = <T extends { dispose: () => void }>(x: T): T => trash.keep(x);
  let faceM: THREE.SkinnedMesh | null = null, tagM0: THREE.SkinnedMesh | null = null;
  const raw: THREE.Mesh[] = [];
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!(m as THREE.Mesh).isMesh) return;
    if (m.name.startsWith('kid_face')) faceM = m;
    else if (m.name.startsWith('kid_tag')) tagM0 = m;
    else if (m.name.startsWith('kid_')) raw.push(m);
  });
  if (!faceM) throw new Error('kid.glb: 얼굴 메시가 없어요');
  const fM = faceM as THREE.SkinnedMesh, tagM = tagM0 as THREE.SkinnedMesh | null;
  const skeleton = fM.skeleton;
  const boneNames = skeleton.bones.map((b) => b.name);
  const store = new Map<string, Piece>();
  for (const m of raw) {
    store.set(m.name.slice(4), pieceOf(m, boneNames, info.rigid[m.name]));
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
    m.removeFromParent();
  }
  for (const m of [fM, tagM]) {
    if (!m) continue;
    keep(m.geometry);
    (m.material as THREE.Material).dispose();
    // 뼈가 움직이면 처음 계산한 테두리 상자를 벗어난다: 화면 밖으로 잘못 걸러지지 않게 한다
    m.frustumCulled = false;
  }
  let wardrobe: Wardrobe | null = null;
  if (needsWardrobe(cur)) {
    wardrobe = await loadWardrobe(boneNames);
    if (wardrobe) for (const [k, v] of wardrobe.pieces) store.set(k, v);
  }

  // ---- 몸: 꼭짓점 색 + 툰 재질. 외곽선은 같은 뼈대를 따르는 껍데기이고, 두께에 꼭짓점 색의 알파를 곱한다.
  const bodyMat = keep(toonMat({ vertexColors: true, rim: 0.3, skin: true }));
  const bodyM = new THREE.SkinnedMesh(new THREE.BufferGeometry(), bodyMat);
  bodyM.name = 'kid_body';
  bodyM.castShadow = true;
  bodyM.frustumCulled = false;
  const line = keep(outlineMat(OUTLINE));
  line.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute vec4 color;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `vec3 transformed = position + normalize(normal) * ${OUTLINE.toFixed(5)} * color.a;`);
  };
  line.customProgramCacheKey = () => `glb-outline-${OUTLINE.toFixed(5)}`;
  const hull = new THREE.SkinnedMesh(bodyM.geometry, line);
  hull.frustumCulled = false;
  fM.parent?.add(bodyM, hull);
  bodyM.bind(skeleton, fM.bindMatrix);
  hull.bind(skeleton, fM.bindMatrix);

  const slotIndex = new Map(info.slots.map((s, i) => [s.name, i] as const));
  const tints = info.slots.map((s) => s.tint);
  /** 고른 차림의 조각 이름. 옷장 파일이 없으면 기본 모양(짧은 머리, 학교 모자, 체육복)으로 바꿔 쓴다: 색은 고른 대로다. */
  const namesFor = (lk: CharacterLook): string[] => {
    const want = piecesOf(lk);
    if (want.every((n) => store.has(n))) return want;
    const safe = piecesOf({ ...lk, hair: 'short', hat: lk.hat === 'none' ? 'none' : 'cap', outfit: 'gym', outfitColor: 0 });
    return safe.filter((n) => store.has(n));
  };
  const canDress = (lk: CharacterLook): boolean => piecesOf(lk).every((n) => store.has(n));

  /** 조각들을 한 메시로 합치고 색을 입힌다. 색 = 고른 색 x (1 - k + k x 그 부분의 그늘 색). */
  const rebuild = (lk: CharacterLook): void => {
    const names = namesFor(lk);
    const colors = slotColors(lk);
    const pal = info.slots.map((s) => hexToLinear(colors[s.name] ?? '#ffffff'));
    const rule = HAIR_HAT[lk.hair][lk.hat];
    const worn = (x: string): boolean => names.includes(x);
    const hairNo = Math.max(0, info.hair.indexOf(lk.hair));
    let nv = 0, ni = 0;
    for (const nm of names) { const p = store.get(nm)!; nv += p.n; ni += p.idx.length; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 4);
    const ji = new Uint16Array(nv * 4), jw = new Float32Array(nv * 4);
    const idx = new Uint32Array(ni);
    let v0 = 0, i0 = 0;
    for (const nm of names) {
      const p = store.get(nm)!;
      pos.set(p.pos, v0 * 3); nor.set(p.nor, v0 * 3); ji.set(p.ji, v0 * 4); jw.set(p.jw, v0 * 4);
      // 이 조각을 덮는 것이 있으면 덧그늘(G)을 더한다
      const cover = nm === 'head' || nm.startsWith('hair_') ? rule.shade && lk.hat !== 'none'
        : nm === 'bot_short' ? worn('x_skirt') : nm === 'top_tee' ? worn('x_bib') : nm === 'top_long' ? worn('x_hood') : false;
      const tuck = rule.tuckCrown && worn(`hat_${lk.hat}`) && (nm === 'head' || nm.startsWith('hair_'));
      // 머리는 머리 모양마다 앞머리 그늘이 다르다
      const kSrc = nm === 'head' && hairNo >= 1 && hairNo <= 4 && p.col1 ? p.col1 : nm === 'head' && hairNo >= 5 && p.col2 ? p.col2 : p.col;
      const kOff = nm === 'head' && hairNo >= 1 ? (hairNo - 1) % 4 : 0;
      for (let i = 0; i < p.n; i++) {
        const part = p.col[i * 4 + 2]! & 31;
        const k = Math.min(1, (kSrc[i * 4 + kOff]! + (cover ? p.col[i * 4 + 1]! : 0)) / 255);
        const c = pal[part] ?? pal[0]!, t = tints[part] ?? tints[0]!;
        const o4 = (v0 + i) * 4;
        col[o4] = c[0] * (1 - k + k * t[0]); col[o4 + 1] = c[1] * (1 - k + k * t[1]); col[o4 + 2] = c[2] * (1 - k + k * t[2]);
        col[o4 + 3] = p.col[i * 4 + 3]! / 255;
      }
      for (let i = 0; i < p.idx.length; i += 3) {
        // 정수리를 덮는 모자를 쓰면 정수리의 머리카락은 그리지 않는다(모자를 뚫고 나오지 않게)
        if (tuck && (p.col[p.idx[i]! * 4 + 2]! & info.crownBit) !== 0) continue;
        idx[i0++] = p.idx[i]! + v0; idx[i0++] = p.idx[i + 1]! + v0; idx[i0++] = p.idx[i + 2]! + v0;
      }
      v0 += p.n;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(ji, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(jw, 4));
    g.setIndex(new THREE.BufferAttribute(i0 === ni ? idx : idx.slice(0, i0), 1));
    bodyM.geometry.dispose();
    bodyM.geometry = g;
    hull.geometry = g;
  };

  // ---- 얼굴: 캔버스에 그린 표정 묶음. 눈 모양, 눈동자 색, 살빛, 머리 색(눈썹)이 바뀌면 다시 그린다.
  flipV(fM.geometry);
  const { exprs, cols, rows } = FACE_ATLAS;
  const facePx = opts.facePx ?? 1.5;
  const faceLook = (lk: CharacterLook): FaceLook => {
    const iris = byId(IRIS_COLORS, lk.iris);
    const plain = lk.eyes === 'round' && lk.iris === 'plum' && lk.skin === 'peach';
    return { kind: kid ? 'kid' : 'teacher', brow: browOf(slotColors(lk).hair), px: facePx, ...(plain ? {} : { eyes: lk.eyes, iris, skin: slotColors(lk).skin }) };
  };
  const faceKey = (lk: CharacterLook): string => `${lk.eyes}|${lk.iris}|${lk.skin}|${lk.hairColor}`;
  let faceDrawn = faceKey(cur);
  const faceTex = keep(texOf(makeFaceAtlas2(faceLook(cur)), 4));
  faceTex.repeat.set(1 / cols, 1 / rows);
  fM.material = keep(new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  fM.renderOrder = 2;
  const setFace = (e: Expr, blink: boolean): void => {
    const cell = exprs.indexOf(e) * 2 + (blink ? 1 : 0);
    faceTex.offset.set((cell % cols) / cols, 1 - (Math.floor(cell / cols) + 1) / rows);
  };

  // ---- 이름표: 윗옷 위의 판. 멜빵 가슴판을 입으면 그 위에 붙는 판(옷장 파일)을 쓴다.
  const TAG_FONT = "'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif";
  const tagC = canvasOf(128, 80);
  const tagTex = keep(texOf(tagC.canvas, 4));
  const redrawTag = (): void => {
    const ctx = tagC.ctx;
    if (!ctx) return;
    const name = cur.name;
    ctx.clearRect(0, 0, 128, 80);
    ctx.fillStyle = tok('--yellow');
    ctx.strokeStyle = tok('--ink');
    ctx.lineWidth = 6;
    roundRect(ctx, 5, 5, 118, 70, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = tok('--ink');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 두 글자까지는 예전 크기 그대로, 길어지면 판 안에 들어오게 줄인다
    let px = 44;
    ctx.font = `${px}px ${TAG_FONT}`;
    while (px > 16 && ctx.measureText(name).width > 100) { px -= 2; ctx.font = `${px}px ${TAG_FONT}`; }
    ctx.fillText(name, 64, 43);
    tagTex.needsUpdate = true;
  };
  const tagMat = keep(toonMat({ map: tagTex, transparent: true }));
  tagMat.polygonOffset = true;
  tagMat.polygonOffsetFactor = -3;
  tagMat.polygonOffsetUnits = -3;
  let tagBibM: THREE.SkinnedMesh | null = null;
  if (tagM) {
    if (look.tag !== null) {
      flipV(tagM.geometry);
      tagM.material = tagMat;
      tagM.renderOrder = 1;
    } else tagM.visible = false;
  }
  const fitTag = (lk: CharacterLook): void => {
    if (!tagM || look.tag === null) return;
    const bib = namesFor(lk).includes('x_bib') && wardrobe?.tagBib;
    if (bib && !tagBibM) {
      const g = keep(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.BufferAttribute(bib.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(bib.nor, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(bib.uv, 2));
      g.setAttribute('skinIndex', new THREE.BufferAttribute(bib.ji, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(bib.jw, 4));
      g.setIndex(new THREE.BufferAttribute(bib.idx, 1));
      tagBibM = new THREE.SkinnedMesh(g, tagMat);
      tagBibM.frustumCulled = false;
      tagBibM.renderOrder = 1;
      tagM.parent?.add(tagBibM);
      tagBibM.bind(skeleton, fM.bindMatrix);
    }
    if (tagBibM) tagBibM.visible = Boolean(bib);
    tagM.visible = !bib;
  };
  let nameDrawn = '';
  const drawName = (): void => {
    redrawTag();
    if (cur.name === nameDrawn) return;
    nameDrawn = cur.name;
    // 이름의 글자가 든 글꼴 조각이 아직 없으면 받아 온 뒤에 다시 그린다(번들에 든 글꼴이라 바깥 요청은 없다)
    try { void document.fonts.load(`44px 'Jua'`, cur.name).then(() => redrawTag(), () => undefined); } catch { /* 글꼴 API 가 없으면 기기 글꼴 그대로 */ }
  };

  /** 차림을 지금 가진 조각으로 바로 입힌다. */
  const dress = (lk: CharacterLook, parts = true): void => {
    cur = lk;
    rebuild(lk);
    if (!parts) return;
    const fk = faceKey(lk);
    if (fk !== faceDrawn) {
      faceDrawn = fk;
      faceTex.image = makeFaceAtlas2(faceLook(lk));
      faceTex.needsUpdate = true;
    }
    fitTag(lk);
    drawName();
  };
  dress(cur);
  let lookSeq = 0;
  let alive = true;
  const setLook = (next: CharacterLook): void => {
    const lk = sanitizeLook(next);
    const seq = ++lookSeq;
    dress(lk);
    if (canDress(lk) || wardrobe) return;
    // 옷장 파일을 받아 온 뒤에 마저 입힌다(그동안은 기본 모양에 고른 색)
    void loadWardrobe(boneNames).then((w) => {
      if (!alive || !w) return;
      wardrobe = w;
      for (const [k, v] of w.pieces) if (!store.has(k)) store.set(k, v);
      if (seq === lookSeq) dress(lk);
    });
  };

  // ---- 선택지 단추에 넣을 작은 그림: 그 차림으로 잠깐 갈아입혀 작은 판에 그린 뒤 되돌린다
  let thumbKit: { scene: THREE.Scene; cam: THREE.PerspectiveCamera; rt: THREE.WebGLRenderTarget; buf: Uint8Array; size: number } | null = null;
  const thumb = (renderer: THREE.WebGLRenderer, lk0: CharacterLook, view: ThumbView, size: number, yaw = 0.22): HTMLCanvasElement | null => {
    const lk = sanitizeLook(lk0);
    if (!canDress(lk)) {
      // 옷장 파일이 아직 없으면 받아 두고, 이번에는 그리지 않는다(부르는 쪽이 조금 뒤에 다시 청한다)
      if (!wardrobe) void loadWardrobe(boneNames).then((w) => { if (alive && w && !wardrobe) { wardrobe = w; for (const [k, v] of w.pieces) if (!store.has(k)) store.set(k, v); } });
      return null;
    }
    if (!thumbKit || thumbKit.size !== size) {
      thumbKit?.rt.dispose();
      const scene = thumbKit?.scene ?? new THREE.Scene();
      if (!thumbKit) {
        // 체육관과 같은 빛(둘레 빛 + 해 + 얼굴을 밝히는 보조 빛): 작은 그림의 색이 놀이 화면과 같아 보인다
        scene.add(new THREE.HemisphereLight(new THREE.Color('#e3eaff'), new THREE.Color('#ffd9ae'), 2.22));
        const sun = new THREE.DirectionalLight(new THREE.Color('#fff0d2'), 1.28);
        sun.position.set(0.9, 1.6, -1.1);
        const fill = new THREE.DirectionalLight(new THREE.Color('#ffe9ee'), 0.42);
        fill.position.set(1, 0.45, 0.6);
        scene.add(sun, fill);
      }
      const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
      rt.texture.colorSpace = THREE.SRGBColorSpace;
      thumbKit = { scene, cam: thumbKit?.cam ?? new THREE.PerspectiveCamera(24, 1, 0.1, 30), rt, buf: new Uint8Array(size * size * 4), size };
    }
    const kit = thumbKit;
    const saved = cur, parent = root.parent, sp = root.position.clone(), sr = root.rotation.y, hullOn = hull.visible;
    dress(lk, false);
    kit.scene.add(root);
    root.position.set(0, 0, 0);
    root.rotation.y = 0;
    hull.visible = true;
    const sc = look.scale;
    const a = yaw;
    if (view === 'head') { kit.cam.fov = 24; kit.cam.position.set(Math.cos(a) * 2.5 * sc / 1.64, 1.3 * sc / 1.64, Math.sin(a) * 2.5 * sc / 1.64); kit.cam.updateMatrixWorld(true); kit.cam.lookAt(0, 1.27 * sc / 1.64, 0); }
    else { kit.cam.fov = 24; kit.cam.position.set(Math.cos(a) * 4.6 * sc / 1.64, 1.0 * sc / 1.64, Math.sin(a) * 4.6 * sc / 1.64); kit.cam.updateMatrixWorld(true); kit.cam.lookAt(0, 0.86 * sc / 1.64, 0); }
    kit.cam.updateProjectionMatrix();
    kit.cam.updateMatrixWorld(true);
    root.updateMatrixWorld(true);
    // three 는 뼈 행렬을 한 프레임에 한 번만 다시 계산한다. 그림자 그리기가 이미 이번 프레임 몫을 써 버렸을 수 있어서 직접 계산한다
    // (안 그러면 체육관에 서 있던 자리와 방향 그대로 그려진다).
    skeleton.update();
    const prevRt = renderer.getRenderTarget();
    const prevColor = new THREE.Color();
    renderer.getClearColor(prevColor);
    const prevAlpha = renderer.getClearAlpha();
    const prevShadow = renderer.shadowMap.autoUpdate;
    let out: HTMLCanvasElement | null = null;
    try {
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(kit.rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(kit.scene, kit.cam);
      renderer.readRenderTargetPixels(kit.rt, 0, 0, size, size, kit.buf);
      const c = canvasOf(size, size);
      if (c.ctx) {
        const img = c.ctx.createImageData(size, size);
        // 그림은 아래에서 위로 읽힌다: 뒤집어 담는다
        for (let y = 0; y < size; y++) img.data.set(kit.buf.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
        c.ctx.putImageData(img, 0, 0);
        out = c.canvas;
      }
    } catch (err) {
      log.warn('three', '작은 그림을 그리지 못했어요', err);
    } finally {
      renderer.setRenderTarget(prevRt);
      renderer.setClearColor(prevColor, prevAlpha);
      renderer.shadowMap.autoUpdate = prevShadow;
      hull.visible = hullOn;
      if (parent) parent.add(root); else kit.scene.remove(root);
      root.position.copy(sp);
      root.rotation.y = sr;
      dress(saved, false);
      root.updateMatrixWorld(true);
    }
    return out;
  };

  // ---- 동작 클립
  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map<ClipName, THREE.AnimationAction>();
  const dur = new Map<ClipName, number>();
  const weight = new Map<ClipName, number>();
  for (const name of CLIPS) {
    let clip = gltf.animations.find((c) => c.name === name);
    if (!clip) throw new Error(`kid.glb: 동작 ${name} 이 없어요`);
    dur.set(name, clip.duration);
    if (name === 'WindUp') {
      // 당기는 동작은 조준 자세 위에 "덧붙이는" 동작으로 바꾼다(첫 프레임 = 당기지 않은 자세가 기준)
      clip = THREE.AnimationUtils.makeClipAdditive(clip.clone(), 0, clip, 20);
    }
    const a = mixer.clipAction(clip);
    if (name === 'WindUp') a.blendMode = THREE.AdditiveAnimationBlendMode;
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = false;
    a.play();
    // 시간은 우리가 직접 넣는다(무대의 시계에 정확히 맞추려고). 믹서는 값만 섞는다.
    a.timeScale = 0;
    a.setEffectiveWeight(0);
    actions.set(name, a);
    weight.set(name, 0);
  }
  const setTime = (name: ClipName, t: number, loop: boolean): void => {
    const d = dur.get(name) ?? 1;
    // 끝 프레임에 딱 맞추면 되풀이로 처음에 돌아가 버리므로 아주 조금 앞에 둔다
    actions.get(name)!.time = loop ? ((t % d) + d) % d : clamp(t, 0, d - 1e-4);
  };

  const handR = new THREE.Vector3(), handL = new THREE.Vector3(), headPos = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  let baseY = 0;
  const measure = (): void => {
    root.updateMatrixWorld(true);
    B.gripR.getWorldPosition(handR);
    B.handL.getWorldPosition(handL);
    headPos.copy(headCenterL);
    B.head.localToWorld(headPos);
  };

  const chibi = {
    root, look,
    apply: () => undefined,
    setFace,
    setOutline: (on: boolean) => { hull.visible = on; },
    setBaseY: (y: number) => { baseY = y; root.position.y = y; },
    redrawText: () => redrawTag(),
    handR, handL, headPos,
    toLocal: (world: THREE.Vector3, out: THREE.Vector3) => {
      root.updateMatrixWorld();
      return out.copy(world).applyMatrix4(inv.copy(root.matrixWorld).invert());
    },
    dispose: () => {
      alive = false;
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      bodyM.geometry.dispose();
      thumbKit?.rt.dispose();
      skeleton.dispose();
      trash.dispose();
    },
  } as unknown as Chibi;

  // ---- 연기: 무대가 주는 입력(KidInput)을 클립 섞기 + 고개 + 손 IK 로 옮긴다
  const want = new Map<ClipName, number>();
  const tmp = new THREE.Vector3(), ikAt = new THREE.Vector3();
  let snapNext = true;
  let facing = 0;
  let blinkAt = 2, blinkT = 0;
  let ikW = 0;
  let reactT = -1;
  let reactKind: KidReact = 'hop';
  const ikLast = new THREE.Vector3();
  // 고개(좌우, 위아래)와 허리 틀기: 부드럽게 따라간다
  const look_ = { yaw: 0, pitch: 0, twist: 0 };
  /** 클립 위에 우리가 손을 대는 뼈들과, 손대기 전의 값 */
  const touched = [B.spine, B.chest, B.neck, B.head, B.upperR, B.foreR];
  const cleanQ = touched.map((b) => b.quaternion.clone());
  const cleanS = touched.map((b) => b.scale.clone());

  /** 세계의 한 점을 바라보는 각도(몸이 서 있는 방향 기준) */
  const gaze = (world: THREE.Vector3, face_: number): [number, number] => {
    tmp.copy(world).sub(headPos);
    let yaw = Math.atan2(-tmp.z, tmp.x) - face_;
    while (yaw > Math.PI) yaw -= Math.PI * 2;
    while (yaw < -Math.PI) yaw += Math.PI * 2;
    return [clamp(yaw, -1.15, 1.15), clamp(Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)), -0.5, 0.75)];
  };
  const turn = turnBone;

  const update = (dt: number, clock: number, inp: KidInput): void => {
    const t = inp.t;
    for (const n of CLIPS) want.set(n, 0);
    let rate = 10;
    let expr: Expr = 'smile';
    let hold = false;
    let ikTarget: THREE.Vector3 | null = null;
    // 바라볼 곳(세계 좌표), 얼마나 따라갈지(0~1), 위아래도 따라갈지, 허리를 얼마나 틀지
    let lookTo: THREE.Vector3 | null = null;
    let lookW = 0, lookPitch = 1, gtw = 0, gRate = 8, sway = 0;

    switch (inp.mode) {
      case 'home': {
        want.set('Home', 1);
        setTime('Home', clock, true);
        const d = dur.get('Home') ?? 6;
        expr = (clock % d) / d < 0.42 ? 'joy' : 'smile';
        rate = 8;
        break;
      }
      case 'rest':
        want.set('Idle', 1);
        setTime('Idle', clock, true);
        break;
      case 'aim': {
        // 조준 각도(-20 ~ 60도)에 맞춰 세 자세를 섞고, 당긴 만큼 WindUp 을 덧붙인다
        const p = clamp(inp.pitchDeg, -20, 60);
        const hi = clamp((p - 20) / 40, 0, 1), lo = clamp((20 - p) / 40, 0, 1);
        want.set('AimLow', lo);
        want.set('AimHigh', hi);
        want.set('AimMid', 1 - lo - hi);
        want.set('WindUp', 1);
        setTime('WindUp', clamp(inp.pull, 0, 1) * (dur.get('WindUp') ?? 1), false);
        hold = true;
        expr = inp.pull > 0.82 ? 'effort' : inp.pull > 0.04 ? 'focus' : 'neutral';
        rate = 16;
        break;
      }
      case 'throw': {
        want.set('Throw', 1);
        setTime('Throw', (clamp(inp.swing, 0, 3) / 3) * (dur.get('Throw') ?? 3), false);
        hold = inp.swing < 2;
        expr = inp.swing < 2 ? 'effort' : 'wow';
        rate = 45;
        if (inp.swing >= 2 && inp.lookAt) { lookTo = inp.lookAt; lookW = 0.9; gRate = 14; }
        break;
      }
      case 'watch': {
        want.set('Watch', 1);
        setTime('Watch', clock, true);
        if (inp.lookAt) { const [y] = gaze(inp.lookAt, facing); gtw = y * 0.45; lookTo = inp.lookAt; lookW = 1; }
        expr = 'wow';
        rate = 9;
        break;
      }
      case 'react': {
        if (inp.mood === 'great') {
          if (t < CHEER_JUMPS_S) { want.set('Cheer', 1); setTime('Cheer', t, true); rate = 26; } else { want.set('CheerHold', 1); setTime('CheerHold', clock, true); rate = 10; }
          expr = 'joy';
        } else if (inp.mood === 'good') {
          const d = dur.get('Nod') ?? 1.6;
          if (t < d) { want.set('Nod', 1); setTime('Nod', t, false); } else { want.set('Idle', 1); setTime('Idle', clock, true); }
          expr = t < 1 ? 'joy' : 'smile';
          rate = 20;
        } else {
          want.set('Slump', 1);
          setTime('Slump', t, false);
          expr = t < 1.1 ? 'oops' : 'grit';
          rate = 14;
        }
        if (inp.lookAt && inp.mood !== 'again') { lookTo = inp.lookAt; lookW = 0.5; lookPitch = 0; }
        break;
      }
    }
    // 쉬는 자세에서는 가끔 카메라 쪽을 본다
    if (inp.mode === 'rest' || inp.mode === 'home') {
      const cyc = (clock + 3) % 9;
      const peek = cyc < 2.2 ? ease(Math.min(cyc / 0.4, (2.2 - cyc) / 0.4)) : 0;
      lookTo = inp.camera;
      lookW = inp.mode === 'home' ? 0.8 : 0.35 * (0.4 + 0.6 * peek);
      lookPitch = 0.5;
      if (inp.mode === 'home') sway = Math.sin(clock * 0.6) * 0.1 * (1 - peek);
    }

    // ---- 클립 섞기: 무게를 부드럽게 옮기고, 합이 1 이 되게 맞춘다(덧붙이는 WindUp 은 따로)
    const k = snapNext ? 1 : 1 - Math.exp(-dt * rate);
    let sum = 0;
    for (const n of CLIPS) {
      const w = (weight.get(n) ?? 0) + ((want.get(n) ?? 0) - (weight.get(n) ?? 0)) * k;
      weight.set(n, w < 1e-4 ? 0 : w);
      if (n !== 'WindUp') sum += weight.get(n) ?? 0;
    }
    for (const n of CLIPS) {
      const w = weight.get(n) ?? 0;
      actions.get(n)!.setEffectiveWeight(n === 'WindUp' ? w : sum > 1e-6 ? w / sum : 0);
    }
    // 믹서는 값이 바뀐 뼈만 다시 쓴다. 그래서 우리가 덧붙인 회전(고개, IK)이 멈춘 자세 위에 계속 쌓이지 않도록,
    // 손댄 뼈를 "클립만 적용된 깨끗한 값"으로 되돌린 다음 섞고, 섞은 결과를 다시 적어 둔다.
    for (let i = 0; i < touched.length; i++) {
      touched[i]!.quaternion.copy(cleanQ[i]!);
      touched[i]!.scale.copy(cleanS[i]!);
    }
    mixer.update(0);
    for (let i = 0; i < touched.length; i++) {
      cleanQ[i]!.copy(touched[i]!.quaternion);
      cleanS[i]!.copy(touched[i]!.scale);
    }

    // ---- 서 있는 방향(조금 천천히 돈다)
    if (snapNext) facing = inp.facing;
    else {
      let df = inp.facing - facing;
      while (df > Math.PI) df -= Math.PI * 2;
      while (df < -Math.PI) df += Math.PI * 2;
      facing += df * (1 - Math.exp(-dt * 7));
    }
    root.rotation.y = facing;
    root.position.y = baseY;
    // 차림을 바꿨을 때의 작은 반응: 폴짝 뛰거나(hop) 새 모자를 올려다본다(look)
    let reactUp = 0;
    if (reactT >= 0) {
      reactT += dt;
      const u = reactT / 0.56;
      if (reactT > 0.95) reactT = -1;
      else {
        const bell = u < 1 ? Math.sin(Math.PI * u) : 0;
        if (reactKind === 'hop') root.position.y = baseY + bell * 0.075 * look.scale;
        else reactUp = Math.sin(Math.PI * Math.min(1, reactT / 0.95)) * 0.3;
        expr = reactKind === 'hop' ? 'joy' : 'wow';
      }
    }

    // ---- 허리와 고개(클립 위에 덧붙인다)
    const gk = snapNext ? 1 : 1 - Math.exp(-dt * gRate);
    look_.twist += (gtw - look_.twist) * gk;
    if (Math.abs(look_.twist) > 1e-4) {
      turn(B.spine, AX.spine, look_.twist * 0.5, 0);
      turn(B.chest, AX.chest, look_.twist * 0.5, 0);
    }
    // 고개: 클립이 놓은 머리가 지금 어디를 보는지 재고, 바라볼 곳까지 모자란 만큼만 더 돌린다.
    // (던진 뒤처럼 몸이 크게 틀어져 있어도 눈은 비행기를 놓치지 않는다)
    let gy = sway, gp = 0;
    if (lookTo && lookW > 0) {
      root.updateMatrixWorld(true);
      B.head.getWorldQuaternion(_q);
      _v1.copy(AX.head.fwd).applyQuaternion(_q);
      const yawNow = Math.atan2(-_v1.z, _v1.x), pitchNow = Math.asin(clamp(_v1.y, -1, 1));
      B.chest.getWorldQuaternion(_q);
      _v2.copy(AX.chest.fwd).applyQuaternion(_q);
      const yawChest = Math.atan2(-_v2.z, _v2.x);
      tmp.copy(headCenterL);
      B.head.localToWorld(tmp);
      tmp.subVectors(lookTo, tmp);
      const wrap = (x: number): number => { let v = x; while (v > Math.PI) v -= Math.PI * 2; while (v < -Math.PI) v += Math.PI * 2; return v; };
      // 가슴 기준으로 좌우 66도까지만 돌린다(부엉이처럼 돌아가지 않게)
      const yawWant = yawChest + clamp(wrap(Math.atan2(-tmp.z, tmp.x) - yawChest), -1.15, 1.15);
      const pitchWant = clamp(Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)), -0.5, 0.75);
      gy += wrap(yawWant - yawNow) * lookW;
      gp = (pitchWant - pitchNow) * lookW * lookPitch;
    }
    gp += reactUp;
    look_.yaw += (gy - look_.yaw) * gk;
    look_.pitch += (gp - look_.pitch) * gk;
    if (Math.abs(look_.yaw) > 1e-4 || Math.abs(look_.pitch) > 1e-4) {
      turn(B.neck, AX.neck, look_.yaw * 0.3, look_.pitch * 0.3);
      turn(B.head, AX.head, look_.yaw * 0.7, look_.pitch * 0.7);
    }
    // 조준할 때의 작은 숨쉬기(조준 자세 클립은 멈춘 그림이라서)
    if (inp.mode === 'aim') B.spine.scale.y *= 1 + Math.sin(clock * 2.1) * 0.012;
    root.updateMatrixWorld(true);

    // ---- 오른손 IK: 비행기를 쥐는 자리(조준, 던지기) 또는 이마 위(지켜보기)
    if (hold && inp.hold) ikTarget = ikAt.copy(inp.hold);
    else if (inp.mode === 'watch') ikTarget = B.head.localToWorld(ikAt.copy(visorL));
    const ikWant = ikTarget ? 1 : 0;
    ikW += (ikWant - ikW) * (snapNext ? 1 : 1 - Math.exp(-dt * (ikWant ? 45 : 22)));
    // 목표가 사라진 직후에는 마지막 자리에서 스르르 풀려난다(손이 튀지 않게)
    if (ikTarget) ikLast.copy(ikTarget);
    if (ikW > 0.01) solveArm(B.upperR, B.foreR, B.gripR, ikLast, ikW);
    measure();

    // ---- 표정과 눈 깜빡임
    blinkT -= dt;
    if (clock > blinkAt) {
      blinkT = 0.11;
      blinkAt = clock + 2.2 + ((clock * 7.3) % 2.6);
    }
    chibi.setFace(expr, blinkT > 0);
    snapNext = false;
  };

  chibi.setFace('neutral', false);
  measure();
  return {
    chibi, update, snap: () => { snapNext = true; },
    setLook,
    react: (kind) => { reactKind = kind; reactT = 0; },
    thumb,
    wardrobeReady: () => wardrobe !== null,
  };
}
