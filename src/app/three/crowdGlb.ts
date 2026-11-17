/**
 * 관람석의 관중(새 모델): 블렌더(파이썬 코드)로 만든 아이 여섯 가지(audience.glb)를 수십 명 앉힌다.
 *
 * 어떻게 싸게 그리는가 ("뼈 행렬 그림" + 인스턴싱)
 *  - 모델에는 뼈대와 동작 클립(SeatedIdle, CheerSmall, CheerBig)이 들어 있다. 불러올 때 클립을 한 번 재생해서
 *    "시간 x 뼈" 의 행렬을 작은 그림(반정밀도 실수 텍스처, 약 110 x 66 칸)으로 찍어 둔다.
 *  - 그릴 때는 변형마다 InstancedMesh 하나(그리기 호출 1 번)이고, 꼭짓점 셰이더가 사람마다 다른 시간의 뼈 행렬을 그 그림에서 읽어 스키닝한다.
 *    시간축은 선형 필터가 프레임 사이를 이어 주고, 평소 동작과 환호 동작은 사람마다의 섞는 비율로 섞는다.
 *  - 고개 돌리기(비행기를 좇는다)는 클립이 아니라 사람마다의 각도 두 개로, 머리에 묶인 꼭짓점만 목 둘레로 돌린다.
 *  - 색은 모델에 없다. 꼭짓점 색의 알파에 "어느 부분인지"가 적혀 있고, 사람마다의 색 다섯 개(윗옷, 바지, 머리카락, 살, 포인트)를 곱한다.
 *  - 그래서 프레임마다 CPU 가 하는 일은 사람당 숫자 8 개를 고쳐 쓰는 것뿐이다(뼈 계산 없음, 행렬 갱신 없음).
 *
 * three.js 0.170 에는 "인스턴싱 + 스키닝"이 없지만, 재질의 셰이더 조각(skinning)을 바꿔 끼우면 새 패키지 없이 된다.
 * 반정밀도 실수 텍스처의 선형 필터는 WebGL2 의 기본 기능이다.
 *
 * 화질 단계: 높음 = 54 명. 출발선에 가까운 14 명은 lod0(약 2.4 천 삼각형), 나머지는 lod1(약 1 천) + 외곽선 + 그림자,
 *            보통 = 36 명 모두 lod1, 낮음 = 14 명 모두 lod1. 모델을 불러오지 못하면 무대가 기존 도형 관중을 쓴다.
 */
import * as THREE from 'three';
import audUrl from '../assets/audience.glb?url';
import { tok } from '../lib/palette';
import type { Crowd, Seat } from './crowd';
import { pickSeats } from './crowd';
import { loadGlb } from './glbActor';
import type { Tier } from './quality';
import { canvasOf, mix, outlineMat, seeded, toonMat, Trash } from './toon';

const VARIANTS = ['short', 'pigtails', 'bob', 'cap', 'bun', 'spiky'] as const;
const CLIPS = [
  { name: 'SeatedIdle', fps: 15 },
  { name: 'CheerSmall', fps: 20 },
  { name: 'CheerBig', fps: 20 },
] as const;
const OUTLINE = 0.009;
const FACE_CELLS = 4;
/** 앉은 키(모델 단위 0.8)가 기존 관중과 비슷해지는 크기 */
const SCALE = 0.8;
/** 높은 화질 단계에서 촘촘한 모델(lod0)로 그리는 사람 수 */
const FINE_AT_HIGH = 14;
/** 자리 앞쪽 끝에 걸터앉게 앞으로 당기는 거리(무릎 아래가 자리 밖으로 늘어진다) */
const SEAT_FORWARD = 0.29;

// ---------------------------------------------------------------------------
// 셰이더 조각: 뼈 행렬 그림에서 읽어 스키닝한다
// ---------------------------------------------------------------------------
const PARS = /* glsl */`
attribute vec4 _jw;
attribute vec4 aAnim;
attribute vec4 aMisc;
attribute vec4 aTint;
uniform sampler2D uAnim;
uniform vec2 uAnimTexel;
uniform vec3 uHeadPivot;
uniform float uHeadBone;
mat4 crowdBone(float bone, float u) {
  float v0 = (bone * 3.0 + 0.5) * uAnimTexel.y;
  vec4 r0 = texture2D(uAnim, vec2(u, v0));
  vec4 r1 = texture2D(uAnim, vec2(u, v0 + uAnimTexel.y));
  vec4 r2 = texture2D(uAnim, vec2(u, v0 + 2.0 * uAnimTexel.y));
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}
mat4 crowdSkinAt(float u) {
  float w0 = _jw.z / 255.0;
#ifdef CROWD_RIGID
  // 가벼운 방식(낮은 화질): 영향이 큰 뼈 하나만 따른다. 그림을 읽는 횟수가 절반 아래로 준다.
  return crowdBone(w0 >= 0.5 ? _jw.x : _jw.y, u);
#else
  mat4 m = crowdBone(_jw.x, u) * w0;
  if (w0 < 0.995) m += crowdBone(_jw.y, u) * (1.0 - w0);
  return m;
#endif
}
vec3 crowdColor(float f) {
  vec3 c = vec3(floor(f / 65536.0), mod(floor(f / 256.0), 256.0), mod(f, 256.0)) / 255.0;
  return c * c * (c * 0.305306011 + 0.682171111) + c * 0.012522878;
}
`;
/** 부분 번호, 뼈 행렬, 고개 회전을 구한다(모든 재질이 함께 쓴다) */
const SETUP = /* glsl */`
  float cA = CROWD_ALPHA * 255.0;
  float cPart = floor(cA / 32.0 + 0.01);
  float cThick = mod(cA, 32.0) / 31.0;
  // 평소 동작과 환호 동작을 섞는다. 한쪽뿐일 때는 그쪽만 읽는다.
  mat4 cSkin;
  if (aAnim.z < 0.004) cSkin = crowdSkinAt(aAnim.x);
  else if (aAnim.z > 0.996) cSkin = crowdSkinAt(aAnim.y);
  else cSkin = crowdSkinAt(aAnim.x) * (1.0 - aAnim.z) + crowdSkinAt(aAnim.y) * aAnim.z;
  float cW0 = _jw.z / 255.0;
  float cHead = (abs(_jw.x - uHeadBone) < 0.5 ? cW0 : 0.0) + (abs(_jw.y - uHeadBone) < 0.5 ? 1.0 - cW0 : 0.0);
  float cYaw = aAnim.w * cHead, cPitch = aMisc.x * cHead;
  float cy = cos(cYaw), sy = sin(cYaw), cx = cos(cPitch), sx = sin(cPitch);
  mat3 cRot = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy) * mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
`;
const APPLY = /* glsl */`
  transformed = uHeadPivot + cRot * (transformed - uHeadPivot);
  transformed = (cSkin * vec4(transformed, 1.0)).xyz;
  // 깃발이 없는 사람의 깃발과 깃대는 한 점으로 접어 안 보이게 한다
  if ((cPart > 4.5 && cPart < 5.5 || cPart > 6.5) && aMisc.z < 0.5) transformed = vec3(0.0, -40.0, 0.0);
`;
const TINT = /* glsl */`
  {
    vec3 cT = vec3(1.0);
    if (cPart > 0.5 && cPart < 1.5) cT = crowdColor(aTint.w);
    else if (cPart < 2.5 && cPart > 1.5) cT = crowdColor(aTint.x);
    else if (cPart < 3.5 && cPart > 2.5) cT = crowdColor(aTint.y);
    else if (cPart < 4.5 && cPart > 3.5) cT = crowdColor(aTint.z);
    else if (cPart > 4.5 && cPart < 6.5) cT = crowdColor(aMisc.w);
    vColor = vec4(color.rgb * cT, 1.0);
  }
`;

type Kind = 'toon' | 'outline' | 'depth';
interface Uniforms { uAnim: { value: THREE.Texture }; uAnimTexel: { value: THREE.Vector2 }; uHeadPivot: { value: THREE.Vector3 }; uHeadBone: { value: number } }

function patch(mat: THREE.Material, kind: Kind, uni: Uniforms, rigid = false): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uni);
    let vs = shader.vertexShader;
    const alpha = 'color.a';
    vs = vs.replace('#include <common>', `#include <common>\n${rigid ? '#define CROWD_RIGID\n' : ''}${kind === 'toon' ? '' : 'attribute vec4 color;\n'}${PARS}`);
    const setup = SETUP.replace('CROWD_ALPHA', alpha);
    if (kind === 'toon') {
      vs = vs.replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = vec2((uv.x + aMisc.y) / ${FACE_CELLS.toFixed(1)}, uv.y);\n#endif`);
      vs = vs.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${setup}\n  objectNormal = mat3(cSkin) * (cRot * objectNormal);`);
      vs = vs.replace('#include <color_vertex>', `#include <color_vertex>`);
      vs = vs.replace('#include <skinning_vertex>', `${APPLY}\n${TINT}`);
    } else if (kind === 'outline') {
      vs = vs.replace('#include <begin_vertex>', `${setup}\n  vec3 transformed = position + normalize(normal) * ${OUTLINE.toFixed(5)} * cThick;`);
      vs = vs.replace('#include <skinning_vertex>', APPLY);
    } else {
      vs = vs.replace('#include <begin_vertex>', `${setup}\n  vec3 transformed = vec3(position);`);
      vs = vs.replace('#include <skinning_vertex>', APPLY);
    }
    shader.vertexShader = vs;
  };
  const key = mat.customProgramCacheKey?.() ?? '';
  mat.customProgramCacheKey = () => `crowd-glb-${kind}-${rigid ? 'rigid' : 'full'}-${key}`;
}

// ---------------------------------------------------------------------------
// 얼굴 그림: 평소 / 깜빡 / 환호 / 우와 (흰 바탕에 그리고, 사람마다의 살색이 곱해진다)
// ---------------------------------------------------------------------------
function makeCrowdFaces(): HTMLCanvasElement {
  const W = 256, H = 192, px = 0.75;
  const { canvas, ctx } = canvasOf(W * FACE_CELLS * px, H * px);
  if (!ctx) return canvas;
  ctx.scale(px, px);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W * FACE_CELLS, H);
  const ink = '#2a2142';
  for (let cell = 0; cell < FACE_CELLS; cell++) {
    ctx.save();
    ctx.translate(cell * W, 0);
    ctx.beginPath();
    ctx.rect(8, 8, W - 16, H - 16);
    ctx.clip();
    const cx = W / 2, ey = 110, ex = 42;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of [-1, 1]) {
      const g = ctx.createRadialGradient(cx + s * 67, 133, 1, cx + s * 67, 133, 25);
      g.addColorStop(0, `rgba(255,96,116,${cell === 2 ? 0.8 : 0.6})`);
      g.addColorStop(1, 'rgba(255,110,126,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx + s * 67, 133, 25, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      const x = cx + s * ex;
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      if (cell === 1) {
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(x - 15, ey + 3);
        ctx.quadraticCurveTo(x, ey + 13, x + 15, ey + 3);
        ctx.stroke();
      } else if (cell === 2) {
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(x - 15, ey + 7);
        ctx.quadraticCurveTo(x, ey - 19, x + 15, ey + 7);
        ctx.stroke();
      } else {
        const ry = cell === 3 ? 24 : 21.5;
        ctx.beginPath();
        ctx.ellipse(x, ey, 15.5, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(x - 5, ey - 8.5, 6, 6.6, -0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + 5.5, ey + 8, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const my = 150;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 5;
    if (cell === 2) {
      ctx.fillStyle = '#9a3743';
      ctx.beginPath();
      ctx.moveTo(cx - 17, my - 8);
      ctx.quadraticCurveTo(cx, my - 4, cx + 17, my - 8);
      ctx.quadraticCurveTo(cx + 14, my + 17, cx, my + 17);
      ctx.quadraticCurveTo(cx - 14, my + 17, cx - 17, my - 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (cell === 3) {
      ctx.fillStyle = '#9a3743';
      ctx.beginPath();
      ctx.ellipse(cx, my + 2, 7.5, 9.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(cx - 11, my - 3);
      ctx.quadraticCurveTo(cx, my + 8, cx + 11, my - 3);
      ctx.stroke();
    }
    ctx.restore();
  }
  return canvas;
}

const packColor = (c: THREE.Color, hex: string): number => {
  c.set(hex);
  // 색 공간 변환 없이 화면 값(sRGB) 그대로 8 비트씩 묶는다. 셰이더가 선형으로 푼다.
  const h = c.getHex(THREE.SRGBColorSpace);
  return h;
};

interface Sitter extends Seat { variant: number; tint: [number, number, number, number]; accent: number; blinkAt: number; e: number; mesh: number; slot: number }

export async function loadCrowdGlb(tier: Tier): Promise<Crowd> {
  const gltf = await loadGlb(audUrl);
  const trash = new Trash();
  const keep = <T extends { dispose: () => void }>(x: T): T => trash.keep(x);
  const group = new THREE.Group();
  const model = gltf.scene;
  model.updateMatrixWorld(true);

  // ---- 뼈: 이름 순서는 모델이 적어 두었다(asset.extras.joints). three 는 이름의 점을 지운다.
  const jointNames = ((gltf.asset as { extras?: { joints?: string[] } }).extras?.joints ?? []) as string[];
  if (jointNames.length === 0) throw new Error('audience.glb: 뼈 목록이 없어요');
  const bones = jointNames.map((n) => model.getObjectByName(n.replace(/\./g, '')) ?? null);
  const nb = bones.length;
  const inverse = bones.map((b) => (b ? b.matrixWorld.clone().invert() : new THREE.Matrix4()));
  const headIdx = jointNames.indexOf('head');
  const headPivot = new THREE.Vector3();
  bones[headIdx]?.getWorldPosition(headPivot);

  // ---- 뼈 행렬 그림: 가로 = 시간(클립을 이어 붙인다. 각 클립의 마지막 칸 = 첫 칸이라 되풀이가 매끄럽다), 세로 = 뼈 x 3 줄
  const mixer = new THREE.AnimationMixer(model);
  const spans: { start: number; frames: number; dur: number }[] = [];
  let width = 0;
  for (const c of CLIPS) {
    const clip = gltf.animations.find((a) => a.name === c.name);
    if (!clip) throw new Error(`audience.glb: 동작 ${c.name} 이 없어요`);
    const frames = Math.max(2, Math.round(clip.duration * c.fps));
    spans.push({ start: width, frames, dur: clip.duration });
    width += frames + 1;
  }
  const height = nb * 3;
  const data = new Uint16Array(width * height * 4);
  const m = new THREE.Matrix4();
  CLIPS.forEach((c, ci) => {
    const clip = gltf.animations.find((a) => a.name === c.name)!;
    const action = mixer.clipAction(clip);
    action.play();
    const { start, frames, dur } = spans[ci]!;
    for (let f = 0; f <= frames; f++) {
      action.time = f === frames ? 0 : (f / frames) * dur;
      mixer.update(0);
      model.updateMatrixWorld(true);
      for (let b = 0; b < nb; b++) {
        const bone = bones[b];
        if (bone) m.multiplyMatrices(bone.matrixWorld, inverse[b]!); else m.identity();
        const e = m.elements;
        for (let r = 0; r < 3; r++) {
          const o = ((b * 3 + r) * width + start + f) * 4;
          data[o] = THREE.DataUtils.toHalfFloat(e[r]!);
          data[o + 1] = THREE.DataUtils.toHalfFloat(e[4 + r]!);
          data[o + 2] = THREE.DataUtils.toHalfFloat(e[8 + r]!);
          data[o + 3] = THREE.DataUtils.toHalfFloat(e[12 + r]!);
        }
      }
    }
    action.stop();
    mixer.uncacheAction(clip);
  });
  mixer.uncacheRoot(model);
  const animTex = keep(new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType));
  animTex.minFilter = THREE.LinearFilter;
  animTex.magFilter = THREE.LinearFilter;
  animTex.wrapS = THREE.ClampToEdgeWrapping;
  animTex.wrapT = THREE.ClampToEdgeWrapping;
  animTex.generateMipmaps = false;
  animTex.needsUpdate = true;
  const uni: Uniforms = { uAnim: { value: animTex }, uAnimTexel: { value: new THREE.Vector2(1 / width, 1 / height) }, uHeadPivot: { value: headPivot }, uHeadBone: { value: headIdx } };
  /** 클립 ci 의 진행도 frac(0~1) -> 그림의 가로 좌표 */
  const uOf = (ci: number, frac: number): number => (spans[ci]!.start + 0.5 + frac * spans[ci]!.frames) / width;

  // ---- 재질: 몸(툰 + 얼굴 그림), 외곽선, 그림자
  const faceC = makeCrowdFaces();
  const faceTex = keep(new THREE.CanvasTexture(faceC));
  faceTex.colorSpace = THREE.SRGBColorSpace;
  faceTex.flipY = false;
  faceTex.anisotropy = 2;
  const bodyMat = keep(toonMat({ vertexColors: true, map: faceTex, rim: 0.3 }));
  patch(bodyMat, 'toon', uni);
  // 낮은 화질 단계용: 뼈 하나만 따르고, 뼈 행렬 그림을 가장 가까운 칸 하나만 읽는다(소프트웨어 렌더러에서 선형 필터는 비싸다)
  const animTexNear = keep(new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType));
  animTexNear.minFilter = THREE.NearestFilter;
  animTexNear.magFilter = THREE.NearestFilter;
  animTexNear.generateMipmaps = false;
  animTexNear.needsUpdate = true;
  const bodyLite = keep(toonMat({ vertexColors: true, map: faceTex, rim: 0.3 }));
  patch(bodyLite, 'toon', { ...uni, uAnim: { value: animTexNear } }, true);
  const lineMat = keep(outlineMat(OUTLINE));
  lineMat.onBeforeCompile = () => undefined;
  patch(lineMat, 'outline', uni);
  const depthMat = keep(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
  patch(depthMat, 'depth', uni);

  // ---- 도형: 변형 6 가지 x 두 벌. 줄여 적은 위치(16 비트)는 노드의 배율과 이동으로 되돌린다.
  const geoms: THREE.BufferGeometry[] = [];
  const v = new THREE.Vector3();
  for (const name of VARIANTS) {
    for (const lod of [0, 1]) {
      const mesh = model.getObjectByName(`aud_${name}_lod${lod}`) as THREE.Mesh | undefined;
      if (!mesh?.isMesh) throw new Error(`audience.glb: 메시 aud_${name}_lod${lod} 이 없어요`);
      const src = mesh.geometry;
      mesh.updateMatrix();
      const pos = src.getAttribute('position');
      const out = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix);
        out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
      }
      const g = keep(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.BufferAttribute(out, 3));
      for (const key of ['normal', 'uv', 'color', '_jw']) g.setAttribute(key, src.getAttribute(key));
      g.setIndex(src.getIndex());
      geoms.push(g);
      src.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }

  // ---- 사람: 자리는 기존 관중과 같은 방법으로 뽑는다(같은 씨앗 = 같은 자리)
  const rnd = seeded(2024);
  const shirts = [tok('--red'), tok('--yellow'), tok('--blue'), tok('--green'), tok('--orange'), tok('--pink'), tok('--purple'), tok('--sky'), tok('--paper')];
  const pants = [tok('--ink'), mix(tok('--blue'), tok('--ink'), 0.4), mix(tok('--court-dark'), tok('--ink'), 0.3), tok('--ink-soft'), tok('--blue')];
  const skins = [tok('--skin'), mix(tok('--skin'), tok('--paper'), 0.35), mix(tok('--skin'), tok('--court-dark'), 0.3), mix(tok('--skin'), tok('--pink'), 0.15)];
  const hairTones = ['#2a2238', '#3b2a26', '#5a3a28', '#74482a'];
  const accents = [tok('--red'), tok('--yellow'), tok('--sky'), tok('--pink'), tok('--green'), tok('--blue')];
  const col = new THREE.Color();
  const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;
  const sitters: Sitter[] = pickSeats(rnd).map((s, i) => {
    const shirt = pick(shirts);
    let accent = pick(accents);
    if (accent === shirt) accent = accents[(accents.indexOf(accent) + 2) % accents.length]!;
    return {
      ...s, variant: (i * 5 + Math.floor(rnd() * 2)) % VARIANTS.length, blinkAt: rnd() * 4, e: 0, mesh: 0, slot: 0,
      tint: [packColor(col, shirt), packColor(col, pick(pants)), packColor(col, pick(hairTones)), packColor(col, pick(skins))],
      accent: packColor(col, accent),
      // 새 모델은 앉은 키가 달라서 크기를 다시 맞춘다. 높이는 앉는 면(방석 윗면) 그대로다.
      s: s.s * SCALE, z: s.z + SEAT_FORWARD,
    };
  });
  const N = sitters.length;

  // ---- 변형 x 두 벌마다 InstancedMesh 하나. 사람이 어느 메시의 몇 번째인지는 단계가 바뀔 때 다시 정한다.
  interface Slot { mesh: THREE.InstancedMesh; line: THREE.InstancedMesh; anim: THREE.InstancedBufferAttribute; misc: THREE.InstancedBufferAttribute; tint: THREE.InstancedBufferAttribute }
  const perVariant = VARIANTS.map((_, vi) => sitters.filter((s) => s.variant === vi).length);
  const slots: Slot[] = geoms.map((g0, gi) => {
    const cap = Math.max(1, perVariant[gi >> 1]!);
    const g = g0;
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const misc = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const tintA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    g.setAttribute('aAnim', anim);
    g.setAttribute('aMisc', misc);
    g.setAttribute('aTint', tintA);
    const mesh = new THREE.InstancedMesh(g, bodyMat, cap);
    mesh.frustumCulled = false;
    mesh.customDepthMaterial = depthMat;
    mesh.count = 0;
    mesh.visible = false;
    const line = new THREE.InstancedMesh(g, lineMat, cap);
    line.instanceMatrix = mesh.instanceMatrix;
    line.frustumCulled = false;
    line.count = 0;
    line.visible = false;
    group.add(mesh, line);
    return { mesh, line, anim, misc, tint: tintA };
  });

  let shown = 0;
  let outline = false;
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const setTier = (t: Tier): void => {
    shown = Math.min(N, t.crowd);
    outline = t.crowdOutline;
    // 촘촘한 모델(lod0)은 높은 단계에서, 출발선에 가장 가까운 몇 명에게만 쓴다(주인공 바로 뒤에 보이는 아이들).
    // 나머지와 보통, 낮은 단계는 성긴 모델(lod1)이다: 화면에서 작아서 차이가 거의 안 보인다.
    const fine = new Set<number>();
    if (t.name === 'high') {
      const order = sitters.slice(0, shown).map((s, i) => ({ i, d: Math.abs(s.x - 1) + (s.y - 0.45) * 1.5 })).sort((a, b) => a.d - b.d);
      for (const o of order.slice(0, FINE_AT_HIGH)) fine.add(o.i);
    }
    const counts = slots.map(() => 0);
    for (let i = 0; i < shown; i++) {
      const s = sitters[i]!;
      const mi = s.variant * 2 + (fine.has(i) ? 0 : 1);
      const slot = slots[mi]!;
      const k = counts[mi]!++;
      s.mesh = mi;
      s.slot = k;
      p.set(s.x, s.y, s.z);
      q.identity();
      sc.setScalar(s.s);
      M.compose(p, q, sc);
      slot.mesh.setMatrixAt(k, M);
      slot.tint.setXYZW(k, s.tint[0], s.tint[1], s.tint[2], s.tint[3]);
    }
    slots.forEach((slot, mi) => {
      const n = counts[mi]!;
      slot.mesh.count = n;
      slot.line.count = n;
      slot.mesh.visible = n > 0;
      slot.line.visible = n > 0 && outline;
      slot.mesh.castShadow = t.crowdShadow;
      slot.mesh.material = t.name === 'low' ? bodyLite : bodyMat;
      slot.mesh.instanceMatrix.needsUpdate = true;
      slot.tint.needsUpdate = true;
    });
  };

  // ---- 움직임: 사람마다 (평소 동작의 시간, 환호 동작의 시간, 섞는 비율, 고개 좌우, 고개 위아래, 표정, 깃발)
  let cheerLevel = 0, cheerAt = -100, cheerX = 0, cheerHold = 1.5, now = 0;
  const update = (dt: number, clock: number, focus: THREE.Vector3): void => {
    now = clock;
    const since = clock - cheerAt;
    const big = cheerLevel >= 0.6;
    const ci = big ? 2 : 1;
    for (let i = 0; i < shown; i++) {
      const s = sitters[i]!;
      const slot = slots[s.mesh]!;
      // 환호는 가까운 자리부터 파도처럼 번진다
      const tau = since - Math.abs(s.x - cheerX) * 0.035 - s.lazy * 0.12;
      let e = 0;
      if (tau > 0) e = cheerLevel * (tau < 0.18 ? tau / 0.18 : tau < cheerHold ? 1 : Math.exp(-(tau - cheerHold) / 0.7)) * (0.55 + 0.45 * s.lazy);
      s.e = e;
      const blend = Math.min(1, e * (big ? 1.5 : 2.6));
      const tIdle = (((clock * s.sp + s.ph * 0.64) / spans[0]!.dur) % 1 + 1) % 1;
      const tCheer = (((clock * (0.9 + 0.25 * s.lazy) + s.ph) / spans[ci]!.dur) % 1 + 1) % 1;
      // 고개: 초점을 바라본다(사람마다 조금 늦게, 조금 다르게)
      const dx = focus.x - s.x, dy = focus.y - (s.y + 0.56 * s.s), dz = focus.z - s.z;
      const yawT = THREE.MathUtils.clamp(Math.atan2(dx, dz), -1.2, 1.2) + Math.sin(clock * 0.31 * s.sp + s.ph * 2) * 0.12;
      const pitchT = THREE.MathUtils.clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.55, 0.3) - e * 0.1;
      const k = dt <= 0 ? 0 : 1 - Math.exp(-dt * (3 + 3 * s.lazy));
      s.yaw += (yawT - s.yaw) * k;
      s.pitch += (pitchT - s.pitch) * k;
      slot.anim.setXYZW(s.slot, uOf(0, tIdle), uOf(ci, tCheer), blend, s.yaw);
      // 표정: 환호 중에는 활짝, 평소에는 가끔 깜빡인다
      let cell = 0;
      if (blend > 0.45) cell = 2;
      else {
        if (clock > s.blinkAt + 0.12) s.blinkAt = clock + 2 + ((clock * 7.3 + s.ph) % 3);
        else if (clock > s.blinkAt) cell = 1;
      }
      slot.misc.setXYZW(s.slot, s.pitch, cell, s.flag ? 1 : 0, s.accent);
    }
    for (const slot of slots) {
      if (slot.mesh.count === 0) continue;
      slot.anim.needsUpdate = true;
      slot.misc.needsUpdate = true;
    }
  };

  setTier(tier);
  // 처음에는 모두 정면 아래(경기장)를 보고 있다
  update(0, 0, new THREE.Vector3(0, 1.2, 0));
  return {
    group,
    update,
    cheer: (level, fromX, holdS) => { cheerLevel = level; cheerAt = now; cheerX = fromX; cheerHold = holdS; },
    calm: () => { cheerLevel = 0; },
    setTier,
    dispose: () => {
      for (const s of slots) { s.mesh.dispose(); s.line.dispose(); }
      trash.dispose();
    },
  };
}
