/**
 * 설계(PlaneDesign) -> 비행기 형상(PlaneGeometry).
 *
 * 순서
 * 1) 평면 접기(applyFolds)로 납작한 겹 묶음을 만든다.
 * 2) 입체 마무리: 중심선(x = 0)이 동체 바닥의 접은 선이다.
 *    - |x| < keelM 인 띠는 아래로 접혀 동체(용골)가 된다. 좌우 두 장이 맞붙은 수직면(y = 0)이다.
 *      중심선이 가장 아래(z = -keelM), 날개가 시작되는 선이 z = 0 이다.
 *    - |x| > keelM 은 날개. 상반각만큼 위로 기운다.
 *    - 날개 바깥쪽 wingletM 폭은 wingletDeg 만큼 더 꺾인다(날개 끝 세우기).
 *    좌우는 따로 계산하므로 비대칭으로 접은 종이도 그대로 처리된다(stats.asymmetry 가 0 이 아니게 된다).
 * 3) 겹 다각형을 구역별로 잘라 삼각형으로 나눈 뒤 무게중심, 관성 텐서, 표시용 삼각형을 만든다.
 * 4) 날개/날개 끝/동체를 띠(AeroElement)로 나눈다.
 *
 * 좌표 변환: 종이 좌표 (px, py) -> 기체 좌표. x = py - (가장 앞 py), 왼쪽 날개(+y)는 종이의 px < 0 쪽.
 *
 * 이 파일에서 정한 것(비행 엔진이 알아야 하는 약속)
 * - 띠의 시위(chord)는 그 띠에서 종이가 덮인 구간의 "앞끝~뒤끝 전체 길이"의 평균이다.
 *   띠의 넓이(area)는 실제로 종이가 덮인 넓이다. 덮인 구간에 빈틈이 있으면 area < chord * (기하학적 폭)이 되는데,
 *   이때 width 를 area / chord (유효 폭)로 줄여서 area = chord * width 가 항상 성립하게 한다.
 * - 날개 띠의 surfaceAR = (좌우 날개 패널의 실제 폭 합)^2 / (좌우 날개 넓이 합). 날개 끝 세운 부분은 빼고 계산한다.
 * - 동체(용골)와 날개 끝은 한쪽이 날개에 막혀 있는 면이므로(끝판 효과) 가로세로비를 2배로 본다:
 *   동체 = 2 * 깊이^2 / 넓이, 날개 끝 = 2 * 폭^2 / 넓이.
 * - 날개 법선은 윗면 방향. 왼쪽 날개 (0, -sinΓ, cosΓ), 오른쪽 (0, sinΓ, cosΓ). 날개 끝은 같은 식에 Γ + wingletDeg.
 *   동체 법선은 (0, 1, 0), side 'C'.
 * - flapRad 는 날개 띠에만 넣는다. + 는 뒷전이 위로 꺾인 것(기수를 드는 방향).
 * - 관성 텐서의 ixy, ixz, iyz 는 "텐서 행렬의 성분"이다. 즉 ixy = -∫xy dm.
 *   행렬 [[ixx, ixy, ixz], [ixy, iyy, iyz], [ixz, iyz, izz]] 로 바로 쓰면 된다.
 * - 굽힘 강성: 접힌 겹은 풀로 붙어 있지 않아 서로 미끄러진다. 그래서 n 겹은 n^3 배가 아니라
 *   한 겹의 약 n 배로 본다. wingBendStiffnessNm = E t^3 / 12 * (날개 뿌리의 평균 겹 수).
 * - 나눗셈이 터지지 않도록 넓이, 폭, 시위, 길이에는 아주 작은 양수 하한을 둔다(날개가 전혀 없는 경우 등).
 */
import type { AeroElement, PlaneDesign, PlaneGeometry, SurfaceKind, Vec2, Vec3 } from '../types';
import { LIMITS } from '../types';
import { DEFAULT_PAPER_ID, PAPERS, getPaper } from '../papers';
import { applyAffine, applyFolds, pointInConvex } from './fold';
import type { Affine2 } from './fold';

/** 날개 한쪽을 나누는 띠 개수 */
const N_WING_STRIPS = 10;
/** 날개 끝(세운 부분)을 나누는 띠 개수 */
const N_WINGLET_STRIPS = 2;
/** 동체를 깊이 방향으로 나누는 띠 개수 */
const N_KEEL_STRIPS = 4;
/** 띠 하나 안에서 덮인 구간을 재는 표본 선 개수 */
const SUB_LINES = 12;
/** 승강타가 차지하는 시위 비율(참고용. 실제 적용은 비행 엔진이 flapRad 로 한다) */
export const ELEVATOR_CHORD_FRACTION = 0.15;

const DEG = Math.PI / 180;
const G = 9.80665;

/** 하한값들 */
const MIN_AREA = 1e-6;
const MIN_LENGTH = 1e-4;
const MIN_INERTIA = 1e-12;

function fin(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

interface Box { poly: Vec2[]; order: number; minX: number; maxX: number; minY: number; maxY: number; toSheet: Affine2; flipped: boolean }

/** x 범위 [lo, hi] 로 볼록 다각형을 자른다. 남는 것이 없으면 null. */
function clipPolyX(poly: readonly Vec2[], lo: number, hi: number): Vec2[] | null {
  let cur: Vec2[] = poly as Vec2[];
  for (let pass = 0; pass < 2; pass++) {
    const out: Vec2[] = [];
    const n = cur.length;
    for (let i = 0; i < n; i++) {
      const p = cur[i]!;
      const q = cur[(i + 1) % n]!;
      // pass 0: x >= lo 쪽을 남긴다. pass 1: x <= hi 쪽을 남긴다.
      const dp = pass === 0 ? p.x - lo : hi - p.x;
      const dq = pass === 0 ? q.x - lo : hi - q.x;
      if (dp >= 0) out.push(p);
      if ((dp > 0 && dq < 0) || (dp < 0 && dq > 0)) {
        const t = dp / (dp - dq);
        out.push({ x: pass === 0 ? lo : hi, y: p.y + (q.y - p.y) * t });
      }
    }
    if (out.length < 3) return null;
    cur = out;
  }
  return cur;
}

/** 수직선 x = px 가 각 겹과 만나는 y 구간들을 [lo, hi, lo, hi, ...] 로 모은다. */
function lineIntervals(boxes: readonly Box[], px: number, out: number[]): void {
  for (const b of boxes) {
    if (px < b.minX || px > b.maxX) continue;
    let lo = Infinity;
    let hi = -Infinity;
    const poly = b.poly;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % n]!;
      const dp = p.x - px;
      const dq = q.x - px;
      if (dp * dq > 0) continue;
      if (dp === dq) {
        // 변이 표본 선 위에 놓인 경우: 양 끝을 모두 넣는다.
        if (p.y < lo) lo = p.y;
        if (p.y > hi) hi = p.y;
        if (q.y < lo) lo = q.y;
        if (q.y > hi) hi = q.y;
      } else {
        const y = p.y + (q.y - p.y) * (dp / (dp - dq));
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
    if (hi - lo > 1e-10) out.push(lo, hi);
  }
}

interface LineCover {
  /** 덮인 길이(합집합) */
  covered: number;
  /** 구간 길이의 단순 합(겹 수 x 길이) */
  sum: number;
  lo: number;
  hi: number;
  /** 가장 많이 겹친 수 */
  maxDepth: number;
}

function coverOf(iv: number[]): LineCover | null {
  const n = iv.length / 2;
  if (n === 0) return null;
  const los: number[] = [];
  const his: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const lo = iv[2 * i]!;
    const hi = iv[2 * i + 1]!;
    los.push(lo);
    his.push(hi);
    sum += hi - lo;
  }
  los.sort((a, b) => a - b);
  his.sort((a, b) => a - b);
  // 시작점과 끝점을 순서대로 훑으며 덮인 길이와 최대 겹 수를 구한다.
  let covered = 0;
  let depth = 0;
  let maxDepth = 0;
  let segStart = 0;
  let i = 0;
  let j = 0;
  while (j < n) {
    if (i < n && los[i]! < his[j]! - 1e-10) {
      if (depth === 0) segStart = los[i]!;
      depth++;
      if (depth > maxDepth) maxDepth = depth;
      i++;
    } else {
      depth--;
      if (depth === 0) covered += his[j]! - segStart;
      j++;
    }
  }
  return { covered, sum, lo: los[0]!, hi: his[n - 1]!, maxDepth };
}

/** 띠 하나를 표본 선으로 잰 결과 */
interface StripSample {
  area: number;
  chord: number;
  /** 평균 앞전의 종이 좌표 y */
  leY: number;
  /** 덮인 표본 선들의 평균 위치(중심선에서의 거리) */
  sMid: number;
  layers: number;
  maxDepth: number;
}

/**
 * 중심선에서의 거리 s 가 [sLo, sHi] 인 띠를 잰다.
 * signs 에 들어 있는 쪽(-1: 종이의 왼쪽 px < 0, +1: 오른쪽)의 종이를 모두 합쳐서 본다.
 * 동체는 좌우 두 장이 맞붙으므로 signs = [-1, 1], 날개는 한쪽만 넣는다.
 */
function sampleStrip(boxes: readonly Box[], sLo: number, sHi: number, signs: readonly number[]): StripSample | null {
  const w = sHi - sLo;
  if (!(w > 1e-9)) return null;
  const dw = w / SUB_LINES;
  let area = 0;
  let sumLayerLen = 0;
  let sumCovered = 0;
  let sumExtent = 0;
  let sumLe = 0;
  let sumS = 0;
  let count = 0;
  let maxDepth = 0;
  const iv: number[] = [];
  for (let k = 0; k < SUB_LINES; k++) {
    const s = sLo + (k + 0.5) * dw;
    iv.length = 0;
    for (const sg of signs) lineIntervals(boxes, sg * s, iv);
    const c = coverOf(iv);
    if (!c || c.covered < 1e-9) continue;
    area += c.covered * dw;
    sumLayerLen += c.sum;
    sumCovered += c.covered;
    sumExtent += c.hi - c.lo;
    sumLe += c.hi;
    sumS += s;
    count++;
    if (c.maxDepth > maxDepth) maxDepth = c.maxDepth;
  }
  if (count === 0 || area < 1e-10) return null;
  return {
    area,
    chord: sumExtent / count,
    leY: sumLe / count,
    sMid: sumS / count,
    layers: sumLayerLen / sumCovered,
    maxDepth,
  };
}

/** 질량 분포 누적기. 삼각형을 얇은 판으로 보고 질량, 1차, 2차 모멘트를 더한다. */
class MassAcc {
  m = 0;
  mx = 0; my = 0; mz = 0;
  // 2차 모멘트 ∫ r r^T dm (원점 기준)
  xx = 0; yy = 0; zz = 0; xy = 0; xz = 0; yz = 0;

  addTriangle(a: Vec3, b: Vec3, c: Vec3, mass: number): void {
    const sx = a.x + b.x + c.x;
    const sy = a.y + b.y + c.y;
    const sz = a.z + b.z + c.z;
    this.m += mass;
    this.mx += mass * sx / 3;
    this.my += mass * sy / 3;
    this.mz += mass * sz / 3;
    // 균일한 삼각형: ∫ p p^T dm = m/12 * (a a^T + b b^T + c c^T + s s^T), s = a + b + c
    const k = mass / 12;
    this.xx += k * (a.x * a.x + b.x * b.x + c.x * c.x + sx * sx);
    this.yy += k * (a.y * a.y + b.y * b.y + c.y * c.y + sy * sy);
    this.zz += k * (a.z * a.z + b.z * b.z + c.z * c.z + sz * sz);
    this.xy += k * (a.x * a.y + b.x * b.y + c.x * c.y + sx * sy);
    this.xz += k * (a.x * a.z + b.x * b.z + c.x * c.z + sx * sz);
    this.yz += k * (a.y * a.z + b.y * b.z + c.y * c.z + sy * sz);
  }

  addPoint(p: Vec3, mass: number): void {
    this.m += mass;
    this.mx += mass * p.x; this.my += mass * p.y; this.mz += mass * p.z;
    this.xx += mass * p.x * p.x; this.yy += mass * p.y * p.y; this.zz += mass * p.z * p.z;
    this.xy += mass * p.x * p.y; this.xz += mass * p.x * p.z; this.yz += mass * p.y * p.z;
  }

  /** 모든 값을 같은 비율로 키운다(전체 질량을 정확한 값에 맞출 때 쓴다). */
  scale(f: number): void {
    this.m *= f; this.mx *= f; this.my *= f; this.mz *= f;
    this.xx *= f; this.yy *= f; this.zz *= f; this.xy *= f; this.xz *= f; this.yz *= f;
  }
}

interface SideInfo {
  /** +1 = 기체 왼쪽(+y, 종이의 px < 0), -1 = 오른쪽 */
  sg: 1 | -1;
  /** 이 쪽 종이의 가장 먼 거리(중심선 기준) */
  tip: number;
  /** 날개와 날개 끝의 경계(중심선 기준 거리). 날개 끝이 없으면 tip 과 같다. */
  wingEnd: number;
}

export function buildGeometry(design: PlaneDesign): PlaneGeometry {
  // ---- 0) 입력 정리: 이상한 값이 와도 NaN 이 나오지 않게 한다 ----
  const d = (typeof design === 'object' && design !== null ? design : {}) as Partial<PlaneDesign>;
  const paper = getPaper(d.paperId as string) ?? getPaper(DEFAULT_PAPER_ID) ?? PAPERS[0]!;
  const folds = Array.isArray(d.folds) ? d.folds.slice(0, LIMITS.maxFolds) : [];
  const sh = (typeof d.shaping === 'object' && d.shaping !== null ? d.shaping : {}) as Partial<PlaneDesign['shaping']>;
  const keelIn = Math.max(0, fin(sh.keelM, 0));
  const dihedral = clamp(fin(sh.dihedralDeg, 0), -89, 89) * DEG;
  const wingletIn = Math.max(0, fin(sh.wingletM, 0));
  const wingletDeg = clamp(fin(sh.wingletDeg, 0), -180, 180);
  const elevatorRad = clamp(fin(sh.elevatorDeg, 0), -90, 90) * DEG;

  // ---- 1) 평면 접기 ----
  const sheet = applyFolds(paper, folds);
  const boxes: Box[] = sheet.layers.map((l) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of l.poly) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { poly: l.poly, order: l.order, minX, maxX, minY, maxY, toSheet: l.toSheet, flipped: l.flipped };
  });
  let pxMin = Infinity, pxMax = -Infinity, pyMin = Infinity, pyMax = -Infinity;
  for (const b of boxes) {
    if (b.minX < pxMin) pxMin = b.minX;
    if (b.maxX > pxMax) pxMax = b.maxX;
    if (b.minY < pyMin) pyMin = b.minY;
    if (b.maxY > pyMax) pyMax = b.maxY;
  }
  const lengthM = Math.max(MIN_LENGTH, pyMax - pyMin);
  const halfL = Math.max(0, -pxMin); // 기체 왼쪽 = 종이 px < 0
  const halfR = Math.max(0, pxMax);

  // ---- 2) 입체 마무리에 쓸 치수 ----
  const keel = Math.min(keelIn, Math.max(halfL, halfR));
  // 날개 끝 세우기는 폭과 각도가 둘 다 있을 때만 별도 면으로 취급한다.
  const wingletActive = wingletIn > 1e-6 && Math.abs(wingletDeg) > 0.05;
  const gw = dihedral + (wingletActive ? wingletDeg * DEG : 0);
  const cosG = Math.cos(dihedral), sinG = Math.sin(dihedral);
  const cosW = Math.cos(gw), sinW = Math.sin(gw);

  const mkSide = (sg: 1 | -1, half: number): SideInfo => {
    const tip = Math.max(keel, half);
    const wl = wingletActive ? Math.min(wingletIn, tip - keel) : 0;
    return { sg, tip, wingEnd: tip - wl };
  };
  const sides: SideInfo[] = [mkSide(1, halfL), mkSide(-1, halfR)];

  /**
   * 접힌 평면의 점을 기체 좌표로 옮긴다.
   * s: 중심선에서의 거리, xb: 기체 x, h: 면의 윗면 법선 방향으로 띄우는 높이(겹 두께 표현용. 질량 계산은 0).
   */
  const mapPoint = (side: SideInfo, kind: SurfaceKind, s: number, xb: number, h: number): Vec3 => {
    const sg = side.sg;
    if (kind === 'keel') {
      // 동체: 날개 접는 선(s = keel)이 z = 0, 중심선(s = 0)이 맨 아래. 윗면은 맞은편 반쪽을 향한다.
      return { x: xb, y: -sg * h, z: -(keel - s) };
    }
    if (kind === 'wing') {
      const u = s - keel;
      return { x: xb, y: sg * (u * cosG - h * sinG), z: u * sinG + h * cosG };
    }
    const u0 = side.wingEnd - keel;
    const uw = s - side.wingEnd;
    return {
      x: xb,
      y: sg * (u0 * cosG + uw * cosW - h * sinW),
      z: u0 * sinG + uw * sinW + h * cosW,
    };
  };

  // ---- 3) 질량 분포와 표시용 삼각형 ----
  const sigma = paper.gsm / 1000; // kg/m^2
  const acc = new MassAcc();
  const positions: number[] = [];
  const meshLayers: number[] = [];
  // 화면 표시용 덧붙임 값(물리 계산에는 쓰지 않는다). 설명은 types.ts 의 PlaneGeometry.mesh 참고.
  const sheetUv: number[] = [];
  const flatXY: number[] = [];
  const faceSide: number[] = [];
  const stackSide: number[] = [];
  const stackOrder: number[] = [];
  const halfW = paper.widthM / 2;
  const halfH = paper.heightM / 2;
  const nLayers = sheet.layers.length;
  let maxLayers = 1;

  const countAt = (p: Vec2): number => {
    let c = 0;
    for (const b of boxes) {
      if (p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY) continue;
      if (pointInConvex(b.poly, p)) c++;
    }
    return c;
  };

  for (const b of boxes) {
    // 맨 위 겹의 윗면이 기준면(h = 0 바로 아래)이 되도록 아래 겹일수록 더 내려 그린다.
    const h = (b.order - (nLayers - 1) - 0.5) * paper.thicknessM;
    for (const side of sides) {
      const regions: [SurfaceKind, number, number][] = [
        ['keel', 0, keel],
        ['wing', keel, side.wingEnd],
        ['winglet', side.wingEnd, side.tip],
      ];
      for (const [kind, sLo, sHi] of regions) {
        if (!(sHi - sLo > 1e-9)) continue;
        // 기체 왼쪽(sg = +1)은 종이의 px = -s 쪽이다.
        const lo = side.sg > 0 ? -sHi : sLo;
        const hi = side.sg > 0 ? -sLo : sHi;
        if (b.maxX <= lo || b.minX >= hi) continue;
        const piece = clipPolyX(b.poly, lo, hi);
        if (!piece) continue;
        const p0 = piece[0]!;
        for (let i = 1; i + 1 < piece.length; i++) {
          const p1 = piece[i]!;
          const p2 = piece[i + 1]!;
          const area = Math.abs((p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)) / 2;
          if (area < 1e-14) continue;
          const tri = [p0, p1, p2] as const;
          const flat = tri.map((p) => mapPoint(side, kind, Math.abs(p.x), p.y - pyMax, 0));
          acc.addTriangle(flat[0]!, flat[1]!, flat[2]!, sigma * area);
          const cnt = Math.max(1, countAt({ x: (p0.x + p1.x + p2.x) / 3, y: (p0.y + p1.y + p2.y) / 3 }));
          if (cnt > maxLayers) maxLayers = cnt;
          const shown: Vec3[] = [];
          for (const p of tri) {
            const q = mapPoint(side, kind, Math.abs(p.x), p.y - pyMax, h);
            positions.push(q.x, q.y, q.z);
            shown.push(q);
            // 펼친 종이 위의 자리(0..1). u 는 오른쪽, v 는 기수 쪽으로 커진다.
            const sp = applyAffine(b.toSheet, p);
            sheetUv.push(clamp((sp.x + halfW) / paper.widthM, 0, 1), clamp((sp.y + halfH) / paper.heightM, 0, 1));
            flatXY.push(p.x, p.y);
          }
          meshLayers.push(cnt);
          // 삼각형이 감긴 방향의 법선이 겹 묶음의 "위쪽"(h 가 커지는 쪽)을 보는지 알아낸다.
          const q0 = shown[0]!, q1 = shown[1]!, q2 = shown[2]!;
          const ux = q1.x - q0.x, uy = q1.y - q0.y, uz = q1.z - q0.z;
          const vx = q2.x - q0.x, vy = q2.y - q0.y, vz = q2.z - q0.z;
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const c0 = mapPoint(side, kind, Math.abs(p0.x), p0.y - pyMax, 0);
          const c1 = mapPoint(side, kind, Math.abs(p0.x), p0.y - pyMax, 1);
          const up = nx * (c1.x - c0.x) + ny * (c1.y - c0.y) + nz * (c1.z - c0.z) >= 0 ? 1 : -1;
          stackSide.push(up);
          // 뒤집히지 않은 겹은 위쪽으로 앞면을 보인다.
          faceSide.push(b.flipped ? -up : up);
          stackOrder.push(b.order);
        }
      }
    }
  }

  // 종이 무게는 접어도 변하지 않는다. 잘라 더한 값의 미세한 오차를 정확한 값에 맞춘다.
  const paperMass = sigma * paper.widthM * paper.heightM;
  if (acc.m > 1e-12) acc.scale(paperMass / acc.m);
  else acc.addPoint({ x: -lengthM / 2, y: 0, z: 0 }, paperMass); // 일어나지 않아야 하지만 안전장치

  // 클립: 중심선 위, 동체 중간 높이에 붙은 점 질량
  let massKg = paperMass;
  const clipX = d.clip && typeof d.clip === 'object' ? fin((d.clip as { xBodyM?: unknown }).xBodyM, NaN) : NaN;
  if (Number.isFinite(clipX)) {
    acc.addPoint({ x: clamp(clipX, -lengthM, 0), y: 0, z: -keel / 2 }, LIMITS.clipMassKg);
    massKg += LIMITS.clipMassKg;
  }

  const cg: Vec3 = { x: acc.mx / acc.m, y: acc.my / acc.m, z: acc.mz / acc.m };
  // 무게중심 기준 2차 모멘트(평행축 정리) -> 관성 텐서 I = tr(C) * 1 - C
  const cxx = acc.xx - acc.m * cg.x * cg.x;
  const cyy = acc.yy - acc.m * cg.y * cg.y;
  const czz = acc.zz - acc.m * cg.z * cg.z;
  const cxy = acc.xy - acc.m * cg.x * cg.y;
  const cxz = acc.xz - acc.m * cg.x * cg.z;
  const cyz = acc.yz - acc.m * cg.y * cg.z;
  const inertia: PlaneGeometry['inertia'] = [
    Math.max(MIN_INERTIA, cyy + czz),
    Math.max(MIN_INERTIA, cxx + czz),
    Math.max(MIN_INERTIA, cxx + cyy),
    -cxy, -cxz, -cyz,
  ];

  // ---- 4) 공기 힘 띠 ----
  interface RawStrip { kind: SurfaceKind; side: SideInfo | null; s: StripSample }
  const raw: RawStrip[] = [];
  const wingArea = [0, 0];     // [왼쪽, 오른쪽] 날개 실제 넓이
  const wingletArea = [0, 0];
  const rootLayers: number[] = [];
  sides.forEach((side, idx) => {
    const paperSign = side.sg > 0 ? -1 : 1;
    const wSpan = side.wingEnd - keel;
    let first = true;
    for (let i = 0; i < N_WING_STRIPS; i++) {
      const s = sampleStrip(boxes, keel + (wSpan * i) / N_WING_STRIPS, keel + (wSpan * (i + 1)) / N_WING_STRIPS, [paperSign]);
      if (!s) continue;
      raw.push({ kind: 'wing', side, s });
      wingArea[idx] = wingArea[idx]! + s.area;
      if (first) { rootLayers.push(s.layers); first = false; }
      if (s.maxDepth > maxLayers) maxLayers = s.maxDepth;
    }
    const tSpan = side.tip - side.wingEnd;
    for (let i = 0; i < N_WINGLET_STRIPS; i++) {
      const s = sampleStrip(boxes, side.wingEnd + (tSpan * i) / N_WINGLET_STRIPS, side.wingEnd + (tSpan * (i + 1)) / N_WINGLET_STRIPS, [paperSign]);
      if (!s) continue;
      raw.push({ kind: 'winglet', side, s });
      wingletArea[idx] = wingletArea[idx]! + s.area;
      if (s.maxDepth > maxLayers) maxLayers = s.maxDepth;
    }
  });
  let keelArea = 0;
  for (let i = 0; i < N_KEEL_STRIPS; i++) {
    const s = sampleStrip(boxes, (keel * i) / N_KEEL_STRIPS, (keel * (i + 1)) / N_KEEL_STRIPS, [-1, 1]);
    if (!s) continue;
    raw.push({ kind: 'keel', side: null, s });
    keelArea += s.area;
    if (s.maxDepth > maxLayers) maxLayers = s.maxDepth;
  }

  const sL = sides[0]!;
  const sR = sides[1]!;
  const wingTrueArea = wingArea[0]! + wingArea[1]!;
  const wingTrueSpan = (wingArea[0]! > 0 ? sL.wingEnd - keel : 0) + (wingArea[1]! > 0 ? sR.wingEnd - keel : 0);
  const wingAR = wingTrueArea > 1e-9 ? (wingTrueSpan * wingTrueSpan) / wingTrueArea : 1;
  const keelAR = keelArea > 1e-9 ? (2 * keel * keel) / keelArea : 1;
  const wingletAR = (idx: number): number => {
    const side = sides[idx]!;
    const a = wingletArea[idx]!;
    const w = side.tip - side.wingEnd;
    return a > 1e-9 ? (2 * w * w) / a : 1;
  };

  const elements: AeroElement[] = [];
  for (const r of raw) {
    const s = r.s;
    const chord = Math.max(s.chord, 1e-6);
    const base = {
      chordDir: { x: -1, y: 0, z: 0 },
      chord,
      width: s.area / chord,
      area: s.area,
      layers: s.layers,
    };
    const xLe = s.leY - pyMax;
    if (r.kind === 'keel' || !r.side) {
      elements.push({
        ...base, kind: 'keel', side: 'C',
        le: { x: xLe, y: 0, z: -(keel - s.sMid) },
        normal: { x: 0, y: 1, z: 0 },
        surfaceAR: Math.max(1e-3, keelAR),
        flapRad: 0,
      });
      continue;
    }
    const side = r.side;
    const idx = side.sg > 0 ? 0 : 1;
    const isWing = r.kind === 'wing';
    const sn = isWing ? sinG : sinW;
    const cs = isWing ? cosG : cosW;
    elements.push({
      ...base, kind: r.kind, side: side.sg > 0 ? 'L' : 'R',
      le: mapPoint(side, r.kind, s.sMid, xLe, 0),
      normal: { x: 0, y: -side.sg * sn, z: cs },
      surfaceAR: Math.max(1e-3, isWing ? wingAR : wingletAR(idx)),
      flapRad: isWing ? elevatorRad : 0,
    });
  }

  // ---- 5) 요약 값 ----
  const wingletTrueArea = wingletArea[0]! + wingletArea[1]!;
  // 투영 면적: 수평면(xy)에 비친 넓이
  const projArea = wingTrueArea * Math.abs(cosG) + wingletTrueArea * Math.abs(cosW);
  const wingAreaM2 = Math.max(MIN_AREA, projArea);
  // 폭: 실제로 날개가 있는 쪽의 끝점 y 좌표로 잰다.
  const yReach = (idx: number): number => {
    const side = sides[idx]!;
    let y = 0;
    if (wingArea[idx]! > 0 || wingletArea[idx]! > 0) y = Math.max(y, (side.wingEnd - keel) * cosG);
    if (wingletArea[idx]! > 0) y = Math.max(y, (side.wingEnd - keel) * cosG + (side.tip - side.wingEnd) * cosW);
    return y;
  };
  const spanM = Math.max(MIN_LENGTH, yReach(0) + yReach(1));

  // 평균 공력 시위: MAC = Σ c^2 w / Σ c w, 앞전 위치는 넓이로 가중 평균. 날개 -> 날개 끝 -> 동체 순으로 있는 것을 쓴다.
  let macM = lengthM;
  let macLeX = 0;
  for (const kind of ['wing', 'winglet', 'keel'] as const) {
    let sc = 0, scc = 0, sx = 0;
    for (const e of elements) {
      if (e.kind !== kind) continue;
      sc += e.chord * e.width;
      scc += e.chord * e.chord * e.width;
      sx += e.le.x * e.chord * e.width;
    }
    if (sc > 1e-9) {
      macM = scc / sc;
      macLeX = sx / sc;
      break;
    }
  }
  macM = Math.max(MIN_LENGTH, macM);

  const sideArea = [wingArea[0]! + wingletArea[0]!, wingArea[1]! + wingletArea[1]!];
  const sideTotal = sideArea[0]! + sideArea[1]!;
  const asymmetry = sideTotal > 1e-9 ? (sideArea[0]! - sideArea[1]!) / sideTotal : 0;

  // 날개 뿌리의 평균 겹 수(좌우 평균). 날개가 없으면 1.
  let rootN = 1;
  if (rootLayers.length > 0) {
    rootN = 0;
    for (const v of rootLayers) rootN += v;
    rootN = Math.max(1, rootN / rootLayers.length);
  }
  const t = paper.thicknessM;
  const wingBendStiffnessNm = (paper.youngsModulusPa * t * t * t) / 12 * rootN;

  return {
    massKg,
    cg,
    inertia,
    elements,
    stats: {
      wingAreaM2,
      spanM,
      aspectRatio: Math.max(1e-3, (spanM * spanM) / wingAreaM2),
      macM,
      macLeX,
      lengthM,
      wingLoadingNm2: (massKg * G) / wingAreaM2,
      cgFracLength: -cg.x / lengthM,
      cgFracMac: (macLeX - cg.x) / macM,
      keelAreaM2: keelArea,
      maxLayers,
      asymmetry,
      wingBendStiffnessNm,
    },
    mesh: {
      positions,
      layers: meshLayers,
      sheetUv,
      faceSide,
      stackSide,
      stackOrder,
      stackCount: nLayers,
      flatXY,
      fold: {
        keelM: keel,
        wingEndLeftM: sL.wingEnd,
        wingEndRightM: sR.wingEnd,
        dihedralDeg: dihedral / DEG,
        wingletDeg: wingletActive ? wingletDeg : 0,
        noseY: pyMax,
        thicknessM: paper.thicknessM,
      },
    },
  };
}
