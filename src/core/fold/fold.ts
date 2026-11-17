/**
 * 평면 접기 엔진.
 *
 * 모델
 * - 접힌 종이는 "납작한 볼록 다각형 겹(layer)의 묶음"이다.
 * - 각 겹은 (a) 현재 접힌 평면에서의 다각형, (b) 펼친 종이 좌표로 되돌리는 변환(toSheet),
 *   (c) 쌓인 순서(order, 0 이 맨 아래), (d) 뒤집힘 여부(flipped)를 가진다.
 * - 접기 한 번(FoldOp)은 a->b 를 지나는 무한 직선으로 "모든 겹"을 자른 뒤,
 *   진행 방향의 왼쪽 조각들을 직선에 대해 반사한다.
 *   valley 면 움직인 조각들이 순서가 뒤집힌 채 맨 위에, mountain 이면 맨 아래에 쌓인다.
 *
 * 오차 처리 원칙(이 파일 전체에 일관되게 적용)
 * - 직선에서 GEOM_EPS 이내의 점은 "직선 위"로 보고 움직이지 않는다(양쪽 조각에 모두 포함).
 * - MERGE_EPS 이내로 붙은 꼭짓점은 하나로 합친다.
 * - 넓이가 MIN_PIECE_AREA 보다 작은 조각은 버린다(사실상 0 넓이).
 * - 움직이는 쪽(또는 남는 쪽) 전체 넓이가 MIN_FOLD_AREA 보다 작으면 그 접기는 하지 않고 상태만 보고한다.
 *
 * 순수 계산만 한다(DOM, 무작위, 시간 사용 없음). 입력 객체는 바꾸지 않는다.
 */
import type { FoldOp, PaperSpec, Vec2 } from '../types';

/** 직선 위 판정 거리(m). 1 나노미터. */
export const GEOM_EPS = 1e-9;
/** 꼭짓점 병합 거리(m). */
export const MERGE_EPS = 1e-8;
/** 이보다 작은 조각은 버린다(m^2). */
export const MIN_PIECE_AREA = 1e-12;
/** 접기가 의미를 가지려면 움직이는 쪽과 남는 쪽이 각각 이 넓이 이상이어야 한다(m^2). 1 mm^2. */
export const MIN_FOLD_AREA = 1e-6;
/**
 * 겹 다각형 개수 한도. 한 번 접을 때마다 최대 2배가 되므로(24번이면 1600만 개) 반드시 막아야 한다.
 * 실제 종이도 7~8번 넘게 반으로 접을 수 없다. 한도를 넘는 접기는 하지 않고 'too-many-layers' 로 보고한다.
 */
export const MAX_LAYER_POLYGONS = 600;

/** 2D 아핀 변환. x' = m00*x + m01*y + tx, y' = m10*x + m11*y + ty */
export interface Affine2 {
  m00: number; m01: number; m10: number; m11: number; tx: number; ty: number;
}

/** 접힌 종이의 겹 하나 */
export interface FoldLayer {
  /** 현재 접힌 평면 좌표의 볼록 다각형. 항상 반시계 방향으로 정리되어 있다. */
  poly: Vec2[];
  /** 접힌 평면 좌표 -> 펼친 종이 좌표 변환(길이를 보존하는 등거리 변환) */
  toSheet: Affine2;
  /** 쌓인 순서. 0 이 맨 아래, 클수록 위. 시트 안에서 0..n-1 로 겹치지 않는다. */
  order: number;
  /** true 면 종이 뒷면이 위를 보고 있다(홀수 번 뒤집힘). */
  flipped: boolean;
}

/** 펼친 종이 위의 접은 선 하나 */
export interface CreaseSegment {
  a: Vec2;
  b: Vec2;
  /** 펼친 종이의 앞면에서 봤을 때 골짜기(valley)인지 산(mountain)인지 */
  kind: 'valley' | 'mountain';
  /** 몇 번째 접기에서 생겼는지 (0 부터) */
  foldIndex: number;
}

/**
 * 접기 한 번의 결과 상태.
 * - ok: 접었다.
 * - miss: 직선이 종이를 지나지 않는다(한쪽에 아무것도 없다).
 * - sliver: 움직이는 쪽이나 남는 쪽이 너무 작다.
 * - degenerate: 두 점이 같거나 숫자가 아니다.
 * - too-many-layers: 겹 수 한도를 넘어 접지 않았다.
 */
export type FoldStatus = 'ok' | 'miss' | 'sliver' | 'degenerate' | 'too-many-layers';

export interface FoldOpReport {
  index: number;
  status: FoldStatus;
  /** 이 접기로 움직인 넓이(m^2). 접지 않았으면 0. */
  movedAreaM2: number;
}

/** applyFolds 의 결과 */
export interface FoldedSheet {
  paper: PaperSpec;
  /** order 오름차순(아래 -> 위)으로 정렬된 겹 목록 */
  layers: FoldLayer[];
  /** 펼친 종이 좌표의 접은 선 목록 */
  creases: CreaseSegment[];
  /** 접기별 상태. folds 와 같은 길이, 같은 순서. */
  reports: FoldOpReport[];
  /** 펼친 종이 넓이(m^2) */
  sheetAreaM2: number;
}

// ---------------------------------------------------------------------------
// 기본 도형 계산
// ---------------------------------------------------------------------------

export const IDENTITY_AFFINE: Affine2 = { m00: 1, m01: 0, m10: 0, m11: 1, tx: 0, ty: 0 };

export function applyAffine(m: Affine2, p: Vec2): Vec2 {
  return { x: m.m00 * p.x + m.m01 * p.y + m.tx, y: m.m10 * p.x + m.m11 * p.y + m.ty };
}

/** 합성 변환 outer(inner(p)) */
function composeAffine(outer: Affine2, inner: Affine2): Affine2 {
  return {
    m00: outer.m00 * inner.m00 + outer.m01 * inner.m10,
    m01: outer.m00 * inner.m01 + outer.m01 * inner.m11,
    m10: outer.m10 * inner.m00 + outer.m11 * inner.m10,
    m11: outer.m10 * inner.m01 + outer.m11 * inner.m11,
    tx: outer.m00 * inner.tx + outer.m01 * inner.ty + outer.tx,
    ty: outer.m10 * inner.tx + outer.m11 * inner.ty + outer.ty,
  };
}

/** a->b 직선에 대한 반사 변환. 두 점이 같으면 null. */
export function reflectionAffine(a: Vec2, b: Vec2): Affine2 | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < MERGE_EPS) return null;
  const ux = dx / len;
  const uy = dy / len;
  // 반사 행렬 M = 2 u u^T - I, 평행 이동 t = a - M a
  const m00 = 2 * ux * ux - 1;
  const m01 = 2 * ux * uy;
  const m11 = 2 * uy * uy - 1;
  return {
    m00, m01, m10: m01, m11,
    tx: a.x - (m00 * a.x + m01 * a.y),
    ty: a.y - (m01 * a.x + m11 * a.y),
  };
}

/** 점 p 를 a->b 직선에 대해 반사한다. 두 점이 같으면 p 를 그대로 돌려준다. */
export function reflectPoint(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const m = reflectionAffine(a, b);
  return m ? applyAffine(m, p) : { x: p.x, y: p.y };
}

/** 부호 있는 넓이. 반시계 방향이면 +. */
export function signedArea(poly: readonly Vec2[]): number {
  let s = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

/** 넓이(항상 0 이상) */
export function polygonArea(poly: readonly Vec2[]): number {
  return Math.abs(signedArea(poly));
}

/**
 * 다각형 정리: 붙어 있는 중복 꼭짓점을 합치고, 반시계 방향으로 맞춘다.
 * 꼭짓점이 3개 미만이거나 넓이가 너무 작으면 null.
 */
function cleanPolygon(pts: Vec2[]): Vec2[] | null {
  const out: Vec2[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) <= MERGE_EPS && Math.abs(last.y - p.y) <= MERGE_EPS) continue;
    out.push(p);
  }
  while (out.length > 1) {
    const f = out[0]!;
    const l = out[out.length - 1]!;
    if (Math.abs(f.x - l.x) <= MERGE_EPS && Math.abs(f.y - l.y) <= MERGE_EPS) out.pop();
    else break;
  }
  if (out.length < 3) return null;
  const a = signedArea(out);
  if (Math.abs(a) < MIN_PIECE_AREA) return null;
  if (a < 0) out.reverse();
  return out;
}

interface SplitResult {
  /** 진행 방향 왼쪽(움직이는 쪽) 조각 */
  left: Vec2[] | null;
  /** 오른쪽(남는 쪽) 조각 */
  right: Vec2[] | null;
  /** 두 조각이 모두 있을 때 잘린 선분의 양 끝 */
  cut: [Vec2, Vec2] | null;
}

/**
 * 볼록 다각형을 직선(점 a, 단위 방향 u)으로 자른다.
 * 직선에서 GEOM_EPS 이내의 꼭짓점은 직선 위로 보고 양쪽 조각에 모두 넣는다.
 */
function splitPolygon(poly: readonly Vec2[], a: Vec2, ux: number, uy: number): SplitResult {
  const n = poly.length;
  const dist: number[] = [];
  for (const p of poly) {
    // 왼쪽이 + 인 부호 있는 거리
    const d = ux * (p.y - a.y) - uy * (p.x - a.x);
    dist.push(Math.abs(d) <= GEOM_EPS ? 0 : d);
  }
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const onLine: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    const dp = dist[i]!;
    const dq = dist[(i + 1) % n]!;
    if (dp >= 0) left.push(p);
    if (dp <= 0) right.push(p);
    if (dp === 0) onLine.push(p);
    if ((dp > 0 && dq < 0) || (dp < 0 && dq > 0)) {
      const t = dp / (dp - dq);
      const x: Vec2 = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
      left.push(x);
      right.push(x);
      onLine.push(x);
    }
  }
  const l = cleanPolygon(left);
  const r = cleanPolygon(right);
  let cut: [Vec2, Vec2] | null = null;
  if (l && r && onLine.length >= 2) {
    // 직선 방향으로 가장 멀리 떨어진 두 점이 잘린 선분의 끝이다.
    let lo = onLine[0]!;
    let hi = onLine[0]!;
    let tLo = Infinity;
    let tHi = -Infinity;
    for (const p of onLine) {
      const t = (p.x - a.x) * ux + (p.y - a.y) * uy;
      if (t < tLo) { tLo = t; lo = p; }
      if (t > tHi) { tHi = t; hi = p; }
    }
    if (tHi - tLo > MERGE_EPS) cut = [lo, hi];
  }
  return { left: l, right: r, cut };
}

// ---------------------------------------------------------------------------
// 접기
// ---------------------------------------------------------------------------

/** 접지 않은 평평한 종이 한 장 */
export function flatSheet(paper: PaperSpec): FoldedSheet {
  const hw = paper.widthM / 2;
  const hh = paper.heightM / 2;
  return {
    paper,
    layers: [{
      poly: [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }],
      toSheet: IDENTITY_AFFINE,
      order: 0,
      flipped: false,
    }],
    creases: [],
    reports: [],
    sheetAreaM2: paper.widthM * paper.heightM,
  };
}

function isFiniteVec(p: unknown): p is Vec2 {
  if (typeof p !== 'object' || p === null) return false;
  const v = p as { x?: unknown; y?: unknown };
  return typeof v.x === 'number' && typeof v.y === 'number' && Number.isFinite(v.x) && Number.isFinite(v.y);
}

/**
 * 접기 한 번을 적용한 새 시트를 돌려준다(원본은 바꾸지 않는다).
 * 접을 수 없는 경우에는 겹은 그대로 두고 reports 에 이유만 추가한다.
 * 화면에서 한 단계씩 접어 보일 때 이 함수를 쓰면 된다.
 */
export function applyFold(sheet: FoldedSheet, op: FoldOp, index: number = sheet.reports.length): FoldedSheet {
  const fail = (status: FoldStatus): FoldedSheet => ({
    ...sheet,
    reports: [...sheet.reports, { index, status, movedAreaM2: 0 }],
  });

  if (typeof op !== 'object' || op === null || !isFiniteVec(op.a) || !isFiniteVec(op.b)) return fail('degenerate');
  const refl = reflectionAffine(op.a, op.b);
  if (!refl) return fail('degenerate');
  const len = Math.hypot(op.b.x - op.a.x, op.b.y - op.a.y);
  const ux = (op.b.x - op.a.x) / len;
  const uy = (op.b.y - op.a.y) / len;
  const mountain = op.dir === 'mountain';

  // 1) 모든 겹을 자른다. layers 는 order 오름차순이므로 결과도 그 순서를 유지한다.
  const stay: FoldLayer[] = [];
  const move: FoldLayer[] = [];
  const newCreases: CreaseSegment[] = [];
  let moveArea = 0;
  let stayArea = 0;
  for (const layer of sheet.layers) {
    const s = splitPolygon(layer.poly, op.a, ux, uy);
    if (s.right) {
      stay.push({ ...layer, poly: s.right });
      stayArea += polygonArea(s.right);
    }
    if (s.left) {
      moveArea += polygonArea(s.left);
      // 반사하면 꼭짓점 방향이 뒤집히므로 순서를 거꾸로 해서 반시계 방향을 유지한다.
      const poly = s.left.map((p) => applyAffine(refl, p)).reverse();
      move.push({
        poly,
        // 새 좌표 p' = R(p) 이고 R 은 자기 자신의 역변환이므로 p = R(p'). 따라서 toSheet' = toSheet ∘ R.
        toSheet: composeAffine(layer.toSheet, refl),
        order: layer.order,
        flipped: !layer.flipped,
      });
    }
    if (s.cut) {
      // 뒤집힌 겹에서는 앞면 기준으로 산/골이 반대가 된다.
      const valley = mountain === layer.flipped;
      newCreases.push({
        a: applyAffine(layer.toSheet, s.cut[0]),
        b: applyAffine(layer.toSheet, s.cut[1]),
        kind: valley ? 'valley' : 'mountain',
        foldIndex: index,
      });
    }
  }

  // 2) 의미 없는 접기 걸러내기
  if (moveArea < MIN_PIECE_AREA * 10 || stayArea < MIN_PIECE_AREA * 10) return fail('miss');
  if (moveArea < MIN_FOLD_AREA || stayArea < MIN_FOLD_AREA) return fail('sliver');
  if (stay.length + move.length > MAX_LAYER_POLYGONS) return fail('too-many-layers');

  // 3) 쌓는 순서 갱신. 움직인 묶음은 통째로 뒤집히므로 순서가 거꾸로 된다.
  move.reverse();
  const stacked = mountain ? [...move, ...stay] : [...stay, ...move];
  const layers = stacked.map((l, i) => ({ ...l, order: i }));

  return {
    paper: sheet.paper,
    layers,
    creases: [...sheet.creases, ...newCreases],
    reports: [...sheet.reports, { index, status: 'ok', movedAreaM2: moveArea }],
    sheetAreaM2: sheet.sheetAreaM2,
  };
}

/**
 * 종이에 접기 목록을 순서대로 적용한다.
 * 결과의 reports[i] 가 folds[i] 의 상태다. 접을 수 없는 접기는 건너뛰고 상태로 알려 준다.
 */
export function applyFolds(paper: PaperSpec, folds: FoldOp[]): FoldedSheet {
  let sheet = flatSheet(paper);
  if (!Array.isArray(folds)) return sheet;
  for (let i = 0; i < folds.length; i++) {
    sheet = applyFold(sheet, folds[i] as FoldOp, i);
  }
  return sheet;
}

/** 접기 상태를 사용자에게 보여줄 한국어 문장으로 바꾼다. ok 면 빈 문자열. */
export function foldStatusMessageKo(status: FoldStatus): string {
  switch (status) {
    case 'ok': return '';
    case 'miss': return '접는 선이 종이를 지나지 않아 접히지 않았습니다.';
    case 'sliver': return '접히는 부분이 너무 작아 접히지 않았습니다.';
    case 'degenerate': return '접는 선의 두 점이 같아 접을 수 없습니다.';
    case 'too-many-layers': return '종이가 너무 많이 겹쳐 더 접을 수 없습니다.';
  }
}

// ---------------------------------------------------------------------------
// 화면과 형상 계산을 위한 도우미
// ---------------------------------------------------------------------------

/** 그리기용 겹 정보 */
export interface RenderLayer {
  poly: Vec2[];
  order: number;
  flipped: boolean;
}

/**
 * 그리기용 데이터. 겹 다각형을 아래에서 위 순서로 돌려준다.
 * 합집합(외곽선) 계산 없이, 이 순서대로 칠하면 접힌 모습이 된다.
 */
export function renderLayers(sheet: FoldedSheet): RenderLayer[] {
  return sheet.layers
    .map((l) => ({ poly: l.poly.map((p) => ({ x: p.x, y: p.y })), order: l.order, flipped: l.flipped }))
    .sort((p, q) => p.order - q.order);
}

/** 점이 볼록(반시계) 다각형 안이나 경계에 있는지 */
export function pointInConvex(poly: readonly Vec2[], p: Vec2, eps: number = GEOM_EPS): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const cross = ex * (p.y - a.y) - ey * (p.x - a.x);
    // 변의 길이로 나누지 않고 비교하기 위해 허용 오차에 변 길이를 곱한다.
    if (cross < -eps * Math.hypot(ex, ey)) return false;
  }
  return true;
}

/** 접힌 평면의 한 점에 종이가 몇 겹 있는지 (경계 포함) */
export function layerCountAt(sheet: FoldedSheet, point: Vec2): number {
  let c = 0;
  for (const l of sheet.layers) if (pointInConvex(l.poly, point)) c++;
  return c;
}

export interface BoundingBox { minX: number; maxX: number; minY: number; maxY: number }

/** 접힌 모양 전체를 감싸는 상자 */
export function boundingBox(sheet: FoldedSheet): BoundingBox {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const l of sheet.layers) {
    for (const p of l.poly) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return { minX, maxX, minY, maxY };
}

/** 모든 겹 넓이의 합. 접어도 종이 넓이는 변하지 않으므로 항상 sheetAreaM2 와 같아야 한다. */
export function totalLayerArea(sheet: FoldedSheet): number {
  let s = 0;
  for (const l of sheet.layers) s += polygonArea(l.poly);
  return s;
}

/** 넓이 보존 검사. 겹 넓이 합과 종이 넓이의 차이가 허용 오차 이내면 ok. */
export function checkArea(sheet: FoldedSheet, tolM2: number = 1e-9): { ok: boolean; totalM2: number; sheetM2: number; errorM2: number } {
  const totalM2 = totalLayerArea(sheet);
  const errorM2 = Math.abs(totalM2 - sheet.sheetAreaM2);
  return { ok: errorM2 <= tolM2, totalM2, sheetM2: sheet.sheetAreaM2, errorM2 };
}

/** 겹 위의 접힌 평면 점을 펼친 종이 좌표로 바꾼다. */
export function foldedToSheet(layer: FoldLayer, p: Vec2): Vec2 {
  return applyAffine(layer.toSheet, p);
}

/**
 * 펼친 종이 위의 접은 선(전개도). 앞면에서 본 산/골 표시가 붙어 있다.
 * 주의: 겹을 실제로 "자른" 선만 기록한다. 이미 있는 접은 선 위를 정확히 다시 접는 경우는 새 선이 생기지 않는다.
 */
export function creasePattern(sheet: FoldedSheet): CreaseSegment[] {
  return sheet.creases.map((c) => ({ a: { ...c.a }, b: { ...c.b }, kind: c.kind, foldIndex: c.foldIndex }));
}
