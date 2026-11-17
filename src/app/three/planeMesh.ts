/**
 * 형상(PlaneGeometry.mesh) -> three.js 물체. 모양은 물리 계산에서 온 그대로 쓰고, 그리는 방법만 곱게 한다.
 *
 * ── 바깥에서 쓰는 것(이 서명은 바꾸지 않는다) ─────────────────────────────────────────
 *   buildPlaneObject(geom: PlaneGeometry, paper: string, linePx = 2.2, opts: PlaneBuildOpts = {}): PlaneObject
 *       paper 는 종이 id('newsprint', 'copy60', 'copy80', 'copy100', 'craft120', 'kent160').
 *       (예전처럼 CSS 색 문자열 '#rrggbb' 을 넘기면 무늬 없이 그 색으로 칠한다.)
 *       opts.tier       : 무늬 화질('high' | 'medium' | 'low' | 'swatch'). 생략하면 기기에 맞춘 단계.
 *       opts.selfShadow : 비행기가 제 그림자를 받게 한다(가까이에서 보는 작은 장면용. 그림자 지도가 촘촘할 때만 켤 것).
 *       opts.fold       : 처음 펼침 정도(0 = 납작하게 접힌 종이, 1 = 완성된 비행기). 기본 1.
 *   PlaneObject
 *       group                 : 장면에 넣을 물체(기체 좌표를 three 좌표로 옮긴 것. 원점은 기수).
 *       center, radius, box   : 완성된 모양을 감싸는 공과 상자(물체 기준)
 *       tips                  : 양쪽 날개 끝
 *       setResolution(w, h)   : 외곽선 두께가 화소 기준이라 그리는 크기를 알려 줘야 한다.
 *       setFold(t)            : 0..1. 납작한 종이에서 완성된 비행기까지 이어서 보여 준다(펼쳐지는 연출).
 *       dispose()             : 도형과 재질을 정리한다. 화면에서 뺄 때 반드시 부른다(무늬 텍스처는 캐시가 갖고 있다).
 *   createRenderer(canvas)    : WebGL 그리개. 지원하지 않으면 null.
 *
 * 그리는 방법
 * - 무늬는 종이에 붙어 있다: 꼭짓점마다 "펼친 종이 위의 자리"(mesh.sheetUv)를 UV 로 쓴다.
 *   그래서 신문지 비행기는 접힌 조각마다 글줄의 방향이 다르다(진짜 접은 신문처럼).
 * - 삼각형마다 앞면이 보이는 쪽과 뒷면이 보이는 쪽을 따로 그린다(같은 도형을 재질 두 개로 두 번).
 * - 겹친 종이는 쌓인 순서대로 조금씩 띄운다(종이마다 정해 둔 "눈에 보이는 두께"). 깜빡임(z-fighting)이 없고
 *   두꺼운 종이는 가장자리가 도톰해 보인다. 가장자리에는 얇은 옆면을 세워 두께가 보이게 한다.
 * - 몸통과 날개가 만나는 곳은 꼭짓점 색으로 살짝 어둡게 해 접힌 자리가 읽히게 한다.
 * - 얇은 종이는 진짜 투명을 쓰지 않고, 겹친 수가 적은 곳을 더 밝게 칠해 비쳐 보이는 느낌만 낸다(그리는 순서 문제가 없다).
 * - 바깥 둘레와 접힌 모서리에는 화면 두께가 일정한 남색 선을 두른다.
 */
import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { PlaneGeometry } from '../../core/index';
import { tok } from '../lib/palette';
import { createPaperMaterials } from './paperLook';
import type { PaperLook, PaperLookTier } from './paperLook';
import { PAPER_LOOK_SPECS } from './paperTextures';
import { mix, toonMat } from './toon';

export interface PlaneBuildOpts {
  tier?: PaperLookTier;
  selfShadow?: boolean;
  anisotropy?: number;
  fold?: number;
}

export interface PlaneObject {
  group: THREE.Group;
  /** 물체를 감싸는 공의 중심과 반지름(three 좌표, 기체 기준) */
  center: THREE.Vector3;
  radius: number;
  /** 완성된 모양을 감싸는 상자 */
  box: THREE.Box3;
  /** 양쪽 날개 끝(기체 기준). 바람 꼬리가 여기서 풀려 나온다. */
  tips: [THREE.Vector3, THREE.Vector3];
  /** 완성된 모양의 꼭짓점들(x, y, z 반복). 화면에 꼭 맞게 담는 거리를 잴 때 쓴다. */
  points: Float32Array;
  /** 이 비행기의 종이 겉모습(색 문자열로 만든 경우 null) */
  look: PaperLook | null;
  /** 외곽선 두께는 화면 화소 기준이라 그리는 크기를 알려 줘야 한다. */
  setResolution: (w: number, h: number) => void;
  /** 0 = 납작하게 접힌 종이, 1 = 완성된 비행기 */
  setFold: (t: number) => void;
  /** 만든 도형과 재질을 모두 정리한다. 화면에서 뺄 때 반드시 불러야 메모리가 새지 않는다. */
  dispose: () => void;
}

const KEEL = 0, WING = 1, WINGLET = 2;
const DEG = Math.PI / 180;
/** 무늬 없는 종이(색 문자열)의 겹 간격 */
const PLAIN_GAP_M = 0.00027;

interface Segment { ax: number; ay: number; bx: number; by: number; tri: number }

export function buildPlaneObject(geom: PlaneGeometry, paper: string, linePx = 2.2, opts: PlaneBuildOpts = {}): PlaneObject {
  const mesh = geom.mesh;
  const src = mesh.positions;
  const n = Math.floor(src.length / 9);
  const fold = mesh.fold;
  const flatXY = mesh.flatXY;
  // 납작한 종이 좌표가 있으면 모든 꼭짓점을 직접 계산한다(펼침 연출, 겹 띄우기). 없으면 받은 좌표를 그대로 쓴다.
  const live = !!fold && !!flatXY && flatXY.length === n * 6 && !!mesh.stackOrder && mesh.stackOrder.length === n;
  const stackCount = mesh.stackCount ?? 1;

  const plain = !PAPER_LOOK_SPECS[paper] && /^(#|rgb|hsl)/i.test(paper);
  const mats = plain ? null : createPaperMaterials(paper, { tier: opts.tier, anisotropy: opts.anisotropy });
  const look = mats ? mats.look : null;
  const gap = look ? look.thicknessM : PLAIN_GAP_M;
  const translucency = look ? look.translucency : 0;

  // ---- 삼각형마다 한 번만 정해 두는 값 ----
  const kind = new Uint8Array(n);
  const sgn = new Int8Array(n);
  const swap = new Uint8Array(n);
  /** 감긴 방향(바꾼 뒤)의 법선이 겹 묶음의 위쪽을 보는지 */
  const topIsWinding = new Uint8Array(n);
  const hOf = new Float32Array(n);
  const keel = fold ? fold.keelM : 0;
  for (let t = 0; t < n; t++) {
    const face = mesh.faceSide?.[t] ?? 1;
    const stack = mesh.stackSide?.[t] ?? 1;
    // 감긴 방향 쪽에 언제나 종이 앞면이 오도록 뒷면이 보이는 삼각형은 뒤집어 감는다.
    swap[t] = face < 0 ? 1 : 0;
    topIsWinding[t] = stack * face > 0 ? 1 : 0;
    const order = mesh.stackOrder?.[t] ?? 0;
    hOf[t] = (order - (stackCount - 1) - 0.5) * gap;
    if (live && flatXY && fold) {
      const o = t * 6;
      const cx = (flatXY[o]! + flatXY[o + 2]! + flatXY[o + 4]!) / 3;
      const s = Math.abs(cx);
      sgn[t] = cx < 0 ? 1 : -1;
      const wingEnd = cx < 0 ? fold.wingEndLeftM : fold.wingEndRightM;
      kind[t] = s < keel ? KEEL : s < wingEnd ? WING : WINGLET;
    } else {
      kind[t] = WING;
      sgn[t] = 1;
    }
  }

  // ---- 꼭짓점 계산: 납작한 종이의 한 점을 펼침 정도 t 일 때의 three 좌표로 옮긴다 ----
  let alpha = 0, beta = 0, gamma = 0; // 몸통, 날개, 날개 끝이 수평에서 일어선 각도
  let cosA = 1, sinA = 0, cosB = 1, sinB = 0, cosC = 1, sinC = 0;
  const setAngles = (t: number): void => {
    // 몸통은 수직(90도)을 넘지 않는다. 날개는 내려앉는 연출을 위해 조금 더 꺾일 수 있다.
    alpha = Math.min(1, t) * 90 * DEG;
    beta = t * (fold ? fold.dihedralDeg : 0) * DEG;
    gamma = t * ((fold ? fold.dihedralDeg + fold.wingletDeg : 0)) * DEG;
    cosA = Math.cos(alpha); sinA = Math.sin(alpha);
    cosB = Math.cos(beta); sinB = Math.sin(beta);
    cosC = Math.cos(gamma); sinC = Math.sin(gamma);
  };
  const tmp = [0, 0, 0];
  /** (px, py): 납작한 종이 좌표, h: 겹 높이, t 번 삼각형의 구역과 좌우를 따른다. 결과는 tmp 에 (three x, y, z). */
  const place = (px: number, py: number, h: number, t: number): void => {
    const f = fold!;
    const sg = sgn[t]!;
    const s = Math.abs(px);
    const xb = py - f.noseY;
    let y: number, z: number;
    // 중심선은 (0, -keel sinA), 날개 뿌리는 (sg keel cosA, 0) 에 있다.
    if (kind[t] === KEEL) {
      y = sg * s * cosA - sg * h * sinA;
      z = -keel * sinA + s * sinA + h * cosA;
    } else {
      const ry = sg * keel * cosA;
      if (kind[t] === WING) {
        const u = s - keel;
        y = ry + sg * (u * cosB - h * sinB);
        z = u * sinB + h * cosB;
      } else {
        const wingEnd = sg > 0 ? f.wingEndLeftM : f.wingEndRightM;
        const u0 = wingEnd - keel;
        const uw = s - wingEnd;
        y = ry + sg * (u0 * cosB + uw * cosC - h * sinC);
        z = u0 * sinB + uw * sinC + h * cosC;
      }
    }
    // core (x, y, z) -> three (x, z, -y)
    tmp[0] = xb; tmp[1] = z; tmp[2] = -y;
  };

  // ---- 바깥 둘레와 접힌 모서리 찾기(납작한 종이 좌표에서, 같은 겹끼리만 맞춰 본다) ----
  const outline: Segment[] = []; // 선을 그을 곳
  const walls: Segment[] = [];   // 종이가 실제로 끝나는 곳(옆면을 세운다)
  if (live && flatXY) {
    const seen = new Map<string, { seg: Segment; other: number }>();
    const q = (v: number): number => Math.round(v * 1e6);
    for (let t = 0; t < n; t++) {
      const o = t * 6;
      const order = mesh.stackOrder![t]!;
      for (let e = 0; e < 3; e++) {
        const f = (e + 1) % 3;
        const ax = flatXY[o + e * 2]!, ay = flatXY[o + e * 2 + 1]!;
        const bx = flatXY[o + f * 2]!, by = flatXY[o + f * 2 + 1]!;
        const ka = `${q(ax)},${q(ay)}`, kb = `${q(bx)},${q(by)}`;
        const key = `${order}|${ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`}`;
        const hit = seen.get(key);
        if (hit) hit.other = t;
        else seen.set(key, { seg: { ax, ay, bx, by, tri: t }, other: -1 });
      }
    }
    const hasKeel = keel > 1e-6;
    const hasDihedral = !!fold && Math.abs(fold.dihedralDeg) > 0.5;
    for (const { seg, other } of seen.values()) {
      if (other < 0) {
        outline.push(seg);
        walls.push(seg);
        continue;
      }
      const a = seg.tri;
      if (kind[a] === kind[other] && sgn[a] === sgn[other]) continue; // 같은 면 안의 나눔선
      // 접히는 선: 가운데 선, 몸통과 날개 사이, 날개와 날개 끝 사이
      const centre = sgn[a] !== sgn[other];
      if (centre && !hasKeel && !hasDihedral) continue;
      // 선은 바깥쪽(날개 쪽) 조각의 높이에 맞춘다.
      outline.push(kind[other]! > kind[a]! ? { ...seg, tri: other } : seg);
    }
  }

  // ---- 버퍼 ----
  const pos = new Float32Array(n * 9);
  const uv = new Float32Array(n * 6);
  const colA = new Float32Array(n * 9);
  const colB = new Float32Array(n * 9);
  const wallPos = new Float32Array(walls.length * 18);
  const linePos = new Float32Array(Math.max(1, outline.length) * 6);
  const ORDER_STRAIGHT = [0, 1, 2] as const;
  const ORDER_SWAPPED = [0, 2, 1] as const;

  for (let t = 0; t < n; t++) {
    const ord = swap[t] ? ORDER_SWAPPED : ORDER_STRAIGHT;
    for (let k = 0; k < 3; k++) {
      const v = ord[k]!;
      uv[t * 6 + k * 2] = mesh.sheetUv?.[t * 6 + v * 2] ?? 0.5;
      uv[t * 6 + k * 2 + 1] = mesh.sheetUv?.[t * 6 + v * 2 + 1] ?? 0.5;
    }
  }

  const fill = (t01: number): void => {
    if (!live || !flatXY) {
      for (let t = 0; t < n; t++) {
        const ord = swap[t] ? ORDER_SWAPPED : ORDER_STRAIGHT;
        for (let k = 0; k < 3; k++) {
          const o = t * 9 + ord[k]! * 3;
          pos[t * 9 + k * 3] = src[o] ?? 0;
          pos[t * 9 + k * 3 + 1] = src[o + 2] ?? 0;
          pos[t * 9 + k * 3 + 2] = -(src[o + 1] ?? 0);
        }
      }
      colA.fill(1);
      colB.fill(1);
      return;
    }
    setAngles(t01);
    const ao = Math.min(1, t01);
    for (let t = 0; t < n; t++) {
      const ord = swap[t] ? ORDER_SWAPPED : ORDER_STRAIGHT;
      const count = Math.max(1, mesh.layers[t] ?? 1);
      // 얇은 종이: 한 겹뿐인 곳은 빛이 비쳐 밝고, 겹친 곳은 조금 어둡다.
      const layerShade = 1 - (0.03 + 0.15 * translucency) * (1 - 1 / count);
      const k0 = kind[t]!;
      for (let k = 0; k < 3; k++) {
        const v = ord[k]!;
        const px = flatXY[t * 6 + v * 2]!, py = flatXY[t * 6 + v * 2 + 1]!;
        place(px, py, hOf[t]!, t);
        const o = t * 9 + k * 3;
        pos[o] = tmp[0]!; pos[o + 1] = tmp[1]!; pos[o + 2] = tmp[2]!;
        // 접힌 자리의 그늘(윗면 / 아랫면). 납작할 때는 없다.
        const s = Math.abs(px);
        let top = 1, bottom = 1;
        if (keel > 1e-6) {
          if (k0 === KEEL) {
            const r = s / keel;
            top = 1 - 0.3 * ao;                    // 맞붙은 안쪽 면
            bottom = 1 - 0.24 * ao * r * Math.sqrt(r); // 바깥 면: 날개 바로 아래가 가장 어둡다
          } else if (k0 === WING) {
            const u = s - keel;
            top = 1 - 0.1 * ao * Math.exp(-u / 0.006);
            bottom = 1 - 0.2 * ao * Math.exp(-u / 0.02);
          }
        }
        const a = (topIsWinding[t] ? top : bottom) * layerShade;
        const b = (topIsWinding[t] ? bottom : top) * layerShade;
        colA[o] = a; colA[o + 1] = a; colA[o + 2] = a;
        colB[o] = b; colB[o + 1] = b; colB[o + 2] = b;
      }
    }
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i]!;
      const h = hOf[w.tri]!;
      const o = i * 18;
      place(w.ax, w.ay, h + gap / 2, w.tri);
      const a0 = tmp[0]!, a1 = tmp[1]!, a2 = tmp[2]!;
      place(w.bx, w.by, h + gap / 2, w.tri);
      const b0 = tmp[0]!, b1 = tmp[1]!, b2 = tmp[2]!;
      place(w.bx, w.by, h - gap / 2, w.tri);
      const c0 = tmp[0]!, c1 = tmp[1]!, c2 = tmp[2]!;
      place(w.ax, w.ay, h - gap / 2, w.tri);
      const d0 = tmp[0]!, d1 = tmp[1]!, d2 = tmp[2]!;
      wallPos.set([a0, a1, a2, b0, b1, b2, c0, c1, c2, a0, a1, a2, c0, c1, c2, d0, d1, d2], o);
    }
    for (let i = 0; i < outline.length; i++) {
      const s = outline[i]!;
      const h = hOf[s.tri]!;
      place(s.ax, s.ay, h, s.tri);
      linePos[i * 6] = tmp[0]!; linePos[i * 6 + 1] = tmp[1]!; linePos[i * 6 + 2] = tmp[2]!;
      place(s.bx, s.by, h, s.tri);
      linePos[i * 6 + 3] = tmp[0]!; linePos[i * 6 + 4] = tmp[1]!; linePos[i * 6 + 5] = tmp[2]!;
    }
  };

  // 완성된 모양으로 한 번 채워 크기와 날개 끝을 잰다.
  fill(1);
  const box = new THREE.Box3();
  const tipR = new THREE.Vector3(0, 0, -Infinity), tipL = new THREE.Vector3(0, 0, Infinity);
  const v = new THREE.Vector3();
  for (let i = 0; i < n * 3; i++) {
    v.set(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
    box.expandByPoint(v);
    // 같은 폭이면 더 뒤쪽(꼬리 쪽) 꼭짓점을 날개 끝으로 본다
    if (v.z > tipR.z + 1e-5 || (Math.abs(v.z - tipR.z) <= 1e-5 && v.x < tipR.x)) tipR.copy(v);
    if (v.z < tipL.z - 1e-5 || (Math.abs(v.z - tipL.z) <= 1e-5 && v.x < tipL.x)) tipL.copy(v);
  }
  if (!Number.isFinite(tipR.z)) tipR.set(0, 0, 0.05);
  if (!Number.isFinite(tipL.z)) tipL.set(0, 0, -0.05);
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.1, -0.01, -0.05), new THREE.Vector3(0, 0.01, 0.05));
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  // 상자의 공은 넉넉하므로 실제 꼭짓점까지의 가장 먼 거리로 줄인다.
  let far = 0;
  for (let i = 0; i < n * 3; i++) {
    const d = Math.hypot(pos[i * 3]! - sphere.center.x, pos[i * 3 + 1]! - sphere.center.y, pos[i * 3 + 2]! - sphere.center.z);
    if (d > far) far = d;
  }
  const center = sphere.center.clone();
  const radius = far > 0.01 ? far : 0.15;
  const points = pos.slice();

  // ---- 도형 ----
  const posAttr = new THREE.BufferAttribute(pos, 3);
  const uvAttr = new THREE.BufferAttribute(uv, 2);
  const gA = new THREE.BufferGeometry();
  gA.setAttribute('position', posAttr);
  gA.setAttribute('uv', uvAttr);
  gA.setAttribute('color', new THREE.BufferAttribute(colA, 3));
  gA.computeVertexNormals();
  // 뒷면용: 자리, 법선, UV 는 같이 쓰고 밝기만 다르다.
  const gB = new THREE.BufferGeometry();
  gB.setAttribute('position', posAttr);
  gB.setAttribute('uv', uvAttr);
  gB.setAttribute('normal', gA.getAttribute('normal'));
  gB.setAttribute('color', new THREE.BufferAttribute(colB, 3));
  const gWall = new THREE.BufferGeometry();
  gWall.setAttribute('position', new THREE.BufferAttribute(wallPos, 3));
  gWall.computeVertexNormals();

  let matFront: THREE.Material, matBack: THREE.Material, matEdge: THREE.Material;
  const ownMats: THREE.Material[] = [];
  if (mats) {
    matFront = mats.front;
    matBack = mats.back;
    matEdge = mats.edge;
  } else {
    // 예전 방식: 앞면은 받은 색, 뒷면은 흰 도화지.
    const white = mix(tok('--paper'), '#ffffff', 0.4);
    const f = toonMat({ color: paper, side: THREE.FrontSide, rim: 0.3, skin: true, vertexColors: true });
    f.shadowSide = THREE.DoubleSide;
    const b = toonMat({ color: white, side: THREE.BackSide, rim: 0.3, skin: true, vertexColors: true });
    const e = toonMat({ color: mix(paper, '#ffffff', 0.5), side: THREE.DoubleSide, skin: true });
    matFront = f; matBack = b; matEdge = e;
    ownMats.push(f, b, e);
  }

  const lineGeom = new LineSegmentsGeometry();
  const lineMat = new LineMaterial({ color: new THREE.Color(tok('--ink')).getHex(), linewidth: linePx, worldUnits: false });
  lineMat.resolution.set(800, 800);
  let edgesFallback: THREE.EdgesGeometry | null = null;
  if (outline.length > 0) lineGeom.setPositions(linePos);
  else {
    // 납작한 종이 좌표가 없는 형상: 꺾인 모서리를 도형에서 찾는다.
    edgesFallback = new THREE.EdgesGeometry(gA, 1);
    lineGeom.setPositions(edgesFallback.getAttribute('position').array as Float32Array);
  }
  const edges = new LineSegments2(lineGeom, lineMat);
  edges.frustumCulled = false;

  const front = new THREE.Mesh(gA, matFront);
  const back = new THREE.Mesh(gB, matBack);
  const wall = new THREE.Mesh(gWall, matEdge);
  front.castShadow = true;
  const self = opts.selfShadow === true;
  front.receiveShadow = self;
  back.receiveShadow = self;
  // 펼치는 동안 모양이 변하므로 화면 밖 판정(감싸는 공)에 기대지 않는다. 비행기는 작아서 늘 그려도 된다.
  front.frustumCulled = false;
  back.frustumCulled = false;
  wall.frustumCulled = false;
  const group = new THREE.Group();
  group.add(front, back, wall, edges);

  let current = 1;
  const setFold = (t: number): void => {
    const next = Math.max(0, Math.min(1.2, t));
    if (!live || Math.abs(next - current) < 1e-4) return;
    current = next;
    fill(next);
    posAttr.needsUpdate = true;
    gA.computeVertexNormals();
    (gA.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (gB.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    if (walls.length > 0) {
      (gWall.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      gWall.computeVertexNormals();
    }
    if (outline.length > 0) lineGeom.setPositions(linePos);
  };
  const start = opts.fold ?? 1;
  if (start !== 1) setFold(start);

  return {
    group,
    center,
    radius,
    box,
    tips: [tipR, tipL],
    points,
    look,
    setResolution: (w, h) => { lineMat.resolution.set(Math.max(1, w), Math.max(1, h)); },
    setFold,
    dispose: () => {
      gA.dispose(); gB.dispose(); gWall.dispose();
      edgesFallback?.dispose();
      lineGeom.dispose(); lineMat.dispose();
      mats?.dispose();
      for (const m of ownMats) m.dispose();
    },
  };
}

/** WebGL 그리개를 만든다. 기기가 WebGL 을 지원하지 않으면 null. */
export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer | null {
  try {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    // 고해상도 화면에서도 2배까지만 그린다(그 이상은 느려지기만 한다).
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    return r;
  } catch {
    return null;
  }
}
