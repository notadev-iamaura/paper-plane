/**
 * "종이를 직접 잡아 접기"의 계산 부분. 화면(DOM)과 완전히 분리된 순수 함수만 있다.
 *
 * 핵심 생각
 * - 손가락으로 잡은 점(grab)을 손가락이 있는 곳(to)까지 가져가면,
 *   접는 선은 두 점의 "수직이등분선"이다. (그 선으로 접으면 grab 이 정확히 to 위에 포개진다.)
 * - core 의 FoldOp 는 "a->b 진행 방향의 왼쪽이 움직인다"는 규칙이므로,
 *   잡은 점이 왼쪽에 오도록 a, b 의 순서를 정해 준다.
 * - 실제로 접히는지는 항상 core 의 applyFold 에 물어본다(여기서 따로 판정하지 않는다).
 *
 * 길이 단위는 모두 미터, 좌표는 종이 좌표(원점 = 펼친 종이의 중심, +y = 기수 쪽)다.
 */
import { LIMITS } from '../../core/types';
import type { FoldOp, Vec2 } from '../../core/types';
import { applyFold, boundingBox, layerCountAt, pointInConvex, polygonArea, reflectPoint } from '../../core/fold/fold';
import type { FoldedSheet, FoldStatus } from '../../core/fold/fold';

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/** 이보다 짧게 끈 것은 접기로 보지 않는다(m). 손가락이 살짝 떨린 정도. */
export const MIN_DRAG_M = 0.004;
/** 종이 안쪽을 눌렀을 때, 가장자리에서 이 거리 안이면 가장자리를 잡은 것으로 본다(m). */
export const EDGE_GRAB_BAND_M = 0.012;
/** 공유 코드의 정밀도(0.1 mm). 접는 선의 두 점을 이 단위로 반올림해 둔다. */
const ROUND = 1e4;
/** 같은 점으로 보는 거리(m) */
const SAME = 1e-6;
/** 겹침 판정에 쓰는 넓이 한계(m^2). 1 mm^2 보다 작으면 겹치지 않은 것으로 본다. */
const OVERLAP_AREA = 1e-6;

export interface Seg { a: Vec2; b: Vec2 }

const round4 = (v: number): number => {
  const r = Math.round(v * ROUND) / ROUND;
  return r === 0 ? 0 : r; // -0 을 0 으로
};
const roundPt = (p: Vec2): Vec2 => ({ x: round4(p.x), y: round4(p.y) });
const dist = (p: Vec2, q: Vec2): number => Math.hypot(p.x - q.x, p.y - q.y);

/** 점 p 에서 선분 s 위의 가장 가까운 점 */
export function closestOnSeg(p: Vec2, s: Seg): Vec2 {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-18) return { x: s.a.x, y: s.a.y };
  const t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / l2));
  return { x: s.a.x + dx * t, y: s.a.y + dy * t };
}

/** 볼록 다각형에서 a->b 의 왼쪽(직선 위 포함)만 남긴다. 남는 것이 없으면 빈 배열. */
export function clipLeft(poly: readonly Vec2[], a: Vec2, b: Vec2): Vec2[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-12) return [];
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const side = (p: Vec2): number => ux * (p.y - a.y) - uy * (p.x - a.x); // 왼쪽이 +
  const out: Vec2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    const dp = side(p);
    const dq = side(q);
    if (dp >= 0) out.push(p);
    if ((dp > 0 && dq < 0) || (dp < 0 && dq > 0)) {
      const t = dp / (dp - dq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out.length >= 3 ? out : [];
}

/** 접기를 가운데 선(x = 0)에 대해 뒤집은 접기. a, b 를 바꿔서 "움직이는 쪽"도 거울상이 되게 한다. */
export function mirrorOp(op: FoldOp): FoldOp {
  return { a: { x: round4(-op.b.x), y: op.b.y }, b: { x: round4(-op.a.x), y: op.a.y }, dir: op.dir };
}

/** 뒤집어도 같은 선인지(가로선이거나 가운데 선 자체). 그러면 반대쪽을 또 접을 필요가 없다. */
export function isSelfMirror(op: FoldOp): boolean {
  const horizontal = Math.abs(op.a.y - op.b.y) < SAME;
  const onCenter = Math.abs(op.a.x) < SAME && Math.abs(op.b.x) < SAME;
  return horizontal || onCenter;
}

// ---------------------------------------------------------------------------
// 1) 끌기 -> 접기
// ---------------------------------------------------------------------------

export interface DragOptions {
  /** valley = 앞으로(보는 사람 쪽으로) 접기. mountain = 뒤로 접기. 기본 valley. */
  dir?: FoldOp['dir'];
  /** 이보다 짧은 끌기는 null. 기본 MIN_DRAG_M. */
  minDragM?: number;
  /** false 면 0.1 mm 반올림을 하지 않는다(시험용). 기본 true. */
  round?: boolean;
}

/**
 * 잡은 점 grab 을 to 까지 끌었을 때의 접기.
 * 접는 선 = grab-to 의 수직이등분선, 움직이는 쪽 = grab 이 있는 쪽.
 * 선의 두 점은 접힌 종이를 감싸는 상자에 걸치는 구간의 양 끝으로 잡는다(멀리 떨어진 두 점일수록 반올림 오차가 작다).
 */
export function foldFromDrag(sheet: FoldedSheet, grab: Vec2, to: Vec2, opts: DragOptions = {}): FoldOp | null {
  const dx = to.x - grab.x;
  const dy = to.y - grab.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < (opts.minDragM ?? MIN_DRAG_M)) return null;

  // 선 위의 한 점(가운데)과 방향. 방향을 (-dy, dx) 로 잡으면 왼쪽 법선이 (-dx, -dy), 곧 grab 쪽이 된다.
  const mx = (grab.x + to.x) / 2;
  const my = (grab.y + to.y) / 2;
  const ux = -dy / len;
  const uy = dx / len;

  // 감싸는 상자와 만나는 구간 [t0, t1] 을 구한다(슬랩 방법).
  const bb = boundingBox(sheet);
  let t0 = -Infinity;
  let t1 = Infinity;
  const slab = (origin: number, d: number, lo: number, hi: number): void => {
    if (Math.abs(d) < 1e-12) {
      if (origin < lo || origin > hi) { t0 = Infinity; t1 = -Infinity; }
      return;
    }
    const ta = (lo - origin) / d;
    const tb = (hi - origin) / d;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
  };
  slab(mx, ux, bb.minX, bb.maxX);
  slab(my, uy, bb.minY, bb.maxY);
  if (!(t1 > t0) || !Number.isFinite(t0) || !Number.isFinite(t1)) { t0 = -0.05; t1 = 0.05; }
  // 구간이 너무 짧으면(상자 귀퉁이를 스치는 선) 양쪽으로 늘려 반올림 오차를 줄인다.
  const MIN_SPAN = 0.08;
  if (t1 - t0 < MIN_SPAN) {
    const c = (t0 + t1) / 2;
    t0 = c - MIN_SPAN / 2;
    t1 = c + MIN_SPAN / 2;
  }

  let a: Vec2 = { x: mx + ux * t0, y: my + uy * t0 };
  let b: Vec2 = { x: mx + ux * t1, y: my + uy * t1 };
  if (opts.round !== false) { a = roundPt(a); b = roundPt(b); }
  if (dist(a, b) < 1e-3) return null;
  return { a, b, dir: opts.dir ?? 'valley' };
}

// ---------------------------------------------------------------------------
// 2) 접힌 종이의 바깥 테두리
// ---------------------------------------------------------------------------

/**
 * 접힌 종이를 위에서 본 모양.
 * - edges: 바깥 테두리 선분(한 줄로 이어진 것은 합쳐져 있다)
 * - vertices: 테두리의 모서리 점
 * - creases: 테두리 안쪽에 보이는 접힌 선(겹의 가장자리)
 * - innerPoints: 안쪽 선들의 끝점(접어 넣은 모서리 등). 맞춤 대상으로만 쓴다.
 */
export interface Outline {
  vertices: Vec2[];
  edges: Seg[];
  creases: Seg[];
  innerPoints: Vec2[];
}

const ptKey = (p: Vec2): string => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;

/** 한 직선 위에 이어져 있는 선분들을 하나로 합친다. */
function mergeCollinear(segs: Seg[]): Seg[] {
  interface Group { ux: number; uy: number; ox: number; oy: number; spans: [number, number][] }
  const groups = new Map<string, Group>();
  for (const s of segs) {
    let ux = s.b.x - s.a.x;
    let uy = s.b.y - s.a.y;
    const len = Math.hypot(ux, uy);
    if (len < SAME) continue;
    ux /= len; uy /= len;
    // 방향을 하나로 통일(오른쪽, 또는 수직이면 위쪽)
    if (ux < -1e-9 || (Math.abs(ux) <= 1e-9 && uy < 0)) { ux = -ux; uy = -uy; }
    const off = ux * s.a.y - uy * s.a.x; // 원점에서 직선까지의 부호 있는 거리
    const key = `${Math.round(Math.atan2(uy, ux) * 2e4)}|${Math.round(off * 2e5)}`;
    let g = groups.get(key);
    if (!g) {
      // 직선 위에서 원점에 가장 가까운 점을 기준점으로 삼는다.
      g = { ux, uy, ox: -uy * off, oy: ux * off, spans: [] };
      groups.set(key, g);
    }
    const ta = (s.a.x - g.ox) * g.ux + (s.a.y - g.oy) * g.uy;
    const tb = (s.b.x - g.ox) * g.ux + (s.b.y - g.oy) * g.uy;
    g.spans.push(ta < tb ? [ta, tb] : [tb, ta]);
  }
  const out: Seg[] = [];
  for (const g of groups.values()) {
    g.spans.sort((p, q) => p[0] - q[0]);
    let cur: [number, number] | null = null;
    const flush = (c: [number, number]): void => {
      out.push({
        a: { x: g.ox + g.ux * c[0], y: g.oy + g.uy * c[0] },
        b: { x: g.ox + g.ux * c[1], y: g.oy + g.uy * c[1] },
      });
    };
    for (const sp of g.spans) {
      if (cur && sp[0] <= cur[1] + 2e-6) cur[1] = Math.max(cur[1], sp[1]);
      else { if (cur) flush(cur); cur = [sp[0], sp[1]]; }
    }
    if (cur) flush(cur);
  }
  return out;
}

/** 겹이 이보다 많으면 선분을 서로 자르는 과정을 건너뛴다(느려지지 않게). */
const SPLIT_LIMIT_SEGS = 700;

/**
 * 접힌 종이의 바깥 테두리와 안쪽 선을 구한다.
 * 방법: 모든 겹의 변을 서로 만나는 곳에서 잘게 자른 뒤, 조각마다 "양옆에 종이가 있는지"를 본다.
 * 한쪽이라도 종이가 없으면 바깥 테두리, 양쪽 다 있으면 안쪽 선이다.
 */
export function computeOutline(sheet: FoldedSheet): Outline {
  // 1) 모든 겹의 변(같은 변은 한 번만)
  const raw: Seg[] = [];
  const seen = new Set<string>();
  for (const l of sheet.layers) {
    const n = l.poly.length;
    for (let i = 0; i < n; i++) {
      const a = l.poly[i]!;
      const b = l.poly[(i + 1) % n]!;
      const ka = ptKey(a);
      const kb = ptKey(b);
      if (ka === kb) continue;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.has(key)) continue;
      seen.add(key);
      raw.push({ a, b });
    }
  }

  // 2) 서로 만나는 곳에서 자른다.
  const pieces: Seg[] = [];
  const doSplit = raw.length <= SPLIT_LIMIT_SEGS;
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i]!;
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const len = Math.hypot(dx, dy);
    const ts: number[] = [0, 1];
    if (doSplit) {
      const tEps = 2e-6 / len;
      for (let j = 0; j < raw.length; j++) {
        if (j === i) continue;
        const o = raw[j]!;
        const ex = o.b.x - o.a.x;
        const ey = o.b.y - o.a.y;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) > 1e-12 * len * Math.hypot(ex, ey) + 1e-18) {
          // 평행하지 않음: 교점
          const t = ((o.a.x - s.a.x) * ey - (o.a.y - s.a.y) * ex) / den;
          const u = ((o.a.x - s.a.x) * dy - (o.a.y - s.a.y) * dx) / den;
          const uEps = 2e-6 / Math.hypot(ex, ey);
          if (t > tEps && t < 1 - tEps && u >= -uEps && u <= 1 + uEps) ts.push(t);
        } else {
          // 평행: 같은 직선 위에 있으면 상대 선분의 끝점에서 자른다.
          for (const p of [o.a, o.b]) {
            const cross = Math.abs(dx * (p.y - s.a.y) - dy * (p.x - s.a.x)) / len;
            if (cross > 2e-6) continue;
            const t = ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / (len * len);
            if (t > tEps && t < 1 - tEps) ts.push(t);
          }
        }
      }
      ts.sort((p, q) => p - q);
    }
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k]!;
      const t1 = ts[k + 1]!;
      if ((t1 - t0) * len < 2e-6) continue;
      pieces.push({
        a: { x: s.a.x + dx * t0, y: s.a.y + dy * t0 },
        b: { x: s.a.x + dx * t1, y: s.a.y + dy * t1 },
      });
    }
  }

  // 3) 조각의 양옆을 살핀다.
  const covered = (p: Vec2): boolean => {
    for (const l of sheet.layers) if (pointInConvex(l.poly, p, 0)) return true;
    return false;
  };
  const OFFSET = 2e-5; // 0.02 mm 옆
  const boundary: Seg[] = [];
  const inner: Seg[] = [];
  for (const s of pieces) {
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const len = Math.hypot(dx, dy);
    const nx = (-dy / len) * OFFSET;
    const ny = (dx / len) * OFFSET;
    const mx = (s.a.x + s.b.x) / 2;
    const my = (s.a.y + s.b.y) / 2;
    const left = covered({ x: mx + nx, y: my + ny });
    const right = covered({ x: mx - nx, y: my - ny });
    if (left && right) inner.push(s);
    else boundary.push(s);
  }

  const edges = mergeCollinear(boundary);
  const creases = mergeCollinear(inner);

  const vertices: Vec2[] = [];
  const vKeys = new Set<string>();
  for (const e of edges) {
    for (const p of [e.a, e.b]) {
      const k = ptKey(p);
      if (vKeys.has(k)) continue;
      vKeys.add(k);
      vertices.push(p);
    }
  }
  const innerPoints: Vec2[] = [];
  const iKeys = new Set<string>();
  for (const c of creases) {
    for (const p of [c.a, c.b]) {
      const k = ptKey(p);
      if (vKeys.has(k) || iKeys.has(k)) continue;
      // 반올림 칸이 달라 키가 어긋난 경우까지 걸러 낸다.
      if (vertices.some((v) => dist(v, p) < 5e-6)) continue;
      iKeys.add(k);
      innerPoints.push(p);
    }
  }
  return { vertices, edges, creases, innerPoints };
}

// ---------------------------------------------------------------------------
// 3) 잡을 때 붙이기
// ---------------------------------------------------------------------------

export interface GrabSnap {
  point: Vec2;
  /** vertex: 모서리, edge: 가장자리, inside: 종이 안쪽(손가락 위치 그대로) */
  kind: 'vertex' | 'edge' | 'inside';
}

/**
 * 손가락을 댄 곳 p 에서 무엇을 잡았는지 정한다.
 * 1) 손가락 굵기(radiusM) 안에 모서리가 있으면 모서리
 * 2) 가장자리가 있으면 가장자리 위의 가장 가까운 점 (종이 안쪽에서는 약 12 mm 까지 넉넉히 봐 준다)
 * 3) 종이 안쪽 깊숙한 곳이면 손가락 위치 그대로
 * 4) 종이 밖이면 null (아무것도 잡지 않음)
 */
export function snapGrab(
  sheet: FoldedSheet, outline: Outline, p: Vec2, radiusM: number, edgeBandM: number = EDGE_GRAB_BAND_M,
): GrabSnap | null {
  let best: Vec2 | null = null;
  let bestD = radiusM;
  for (const v of outline.vertices) {
    const d = dist(v, p);
    if (d <= bestD) { bestD = d; best = v; }
  }
  if (best) return { point: { x: best.x, y: best.y }, kind: 'vertex' };

  const inside = layerCountAt(sheet, p) > 0;
  let edgePt: Vec2 | null = null;
  let edgeD = inside ? Math.max(radiusM, edgeBandM) : radiusM;
  for (const e of outline.edges) {
    const c = closestOnSeg(p, e);
    const d = dist(c, p);
    if (d <= edgeD) { edgeD = d; edgePt = c; }
  }
  if (edgePt) return { point: edgePt, kind: 'edge' };
  if (inside) return { point: { x: p.x, y: p.y }, kind: 'inside' };
  return null;
}

// ---------------------------------------------------------------------------
// 4) 끌고 갈 때 붙이기
// ---------------------------------------------------------------------------

export type SnapKind =
  | 'vertex'        // 다른 모서리
  | 'mirror'        // 가운데 선 건너편의 같은 자리
  | 'align-center'  // 잡은 가장자리가 가운데 선에 나란히 포개짐
  | 'align-edge'    // 잡은 가장자리가 다른 가장자리(또는 접은 선)에 나란히 포개짐
  | 'center'        // 가운데 선 위
  | 'crease'        // 접은 선 위
  | 'straight'      // 잡은 곳에서 똑바로 위아래/옆
  | 'edge'          // 가장자리 위
  | 'free';

/** 반짝이게 할 대상 */
export type SnapMark =
  | { type: 'point'; p: Vec2 }
  | { type: 'seg'; a: Vec2; b: Vec2 }
  | { type: 'center' };

export interface TargetSnap {
  point: Vec2;
  kind: SnapKind;
  /** 화면에 띄울 짧은 말. 붙지 않았으면 빈 문자열. */
  label: string;
  mark: SnapMark | null;
}

export const SNAP_LABEL: Record<SnapKind, string> = {
  vertex: '모서리끼리 딱!',
  mirror: '반대쪽이랑 딱!',
  'align-center': '가운데 선에 딱!',
  'align-edge': '가장자리끼리 딱!',
  center: '가운데 선에 딱!',
  crease: '접은 선에 딱!',
  straight: '똑바로 딱!',
  edge: '가장자리에 딱!',
  free: '',
};

/** 직선(점 q, 단위 방향 l) 과 직선(점 g, 단위 방향 e) 의 교점. 평행이면 null. */
function lineHit(g: Vec2, ex: number, ey: number, q: Vec2, lx: number, ly: number): Vec2 | null {
  const den = ex * ly - ey * lx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q.x - g.x) * ly - (q.y - g.y) * lx) / den;
  return { x: g.x + ex * t, y: g.y + ey * t };
}

/**
 * "가장자리를 가장자리에 맞추기" 후보.
 * 잡은 점 g 를 지나는 가장자리(방향 e)가 접은 뒤 직선 L 위에 나란히 놓이려면,
 * 접는 선은 두 직선이 만나는 점 P 를 지나는 각의 이등분선이어야 한다.
 * 그때 g 는 L 위에서 P 로부터 같은 거리만큼 떨어진 점으로 간다(양쪽 두 곳).
 * 두 직선이 평행하면 g 에서 L 에 내린 수선의 발로 간다.
 */
function alignCandidates(g: Vec2, e: Seg, target: Seg | null): Vec2[] {
  // target 이 null 이면 가운데 선(x = 0, 끝없는 직선)
  const elen = dist(e.a, e.b);
  if (elen < SAME) return [];
  const ex = (e.b.x - e.a.x) / elen;
  const ey = (e.b.y - e.a.y) / elen;
  let q: Vec2;
  let lx: number;
  let ly: number;
  let tLen = Infinity;
  if (target) {
    tLen = dist(target.a, target.b);
    if (tLen < SAME) return [];
    q = target.a;
    lx = (target.b.x - target.a.x) / tLen;
    ly = (target.b.y - target.a.y) / tLen;
  } else {
    q = { x: 0, y: 0 };
    lx = 0;
    ly = 1;
  }
  // g 가 이미 L 위에 있으면 맞출 것이 없다.
  const offG = lx * (g.y - q.y) - ly * (g.x - q.x);
  if (Math.abs(offG) < 1e-5) return [];

  const out: Vec2[] = [];
  const P = lineHit(g, ex, ey, q, lx, ly);
  if (!P) {
    const t = (g.x - q.x) * lx + (g.y - q.y) * ly;
    out.push({ x: q.x + lx * t, y: q.y + ly * t });
  } else {
    const r = dist(g, P);
    if (r < 1e-5) return [];
    out.push({ x: P.x + lx * r, y: P.y + ly * r }, { x: P.x - lx * r, y: P.y - ly * r });
  }
  if (!target) return out;
  // 끝이 있는 선분이면 그 선분 위에 떨어지는 것만 남긴다.
  return out.filter((p) => {
    const t = (p.x - q.x) * lx + (p.y - q.y) * ly;
    return t >= -1e-5 && t <= tLen + 1e-5;
  });
}

/**
 * 끌고 가는 점(raw)을 가까운 대상에 붙인다. 앞에 있는 종류일수록 먼저 붙는다.
 * 1 다른 모서리 2 반대쪽 같은 자리 3 가장자리끼리 나란히 4 가운데 선 5 접은 선 6 똑바로 7 가장자리
 * @param radiusM 붙는 거리. 화면 픽셀을 미터로 바꿔서 넘긴다.
 * @param enabled false 면 붙이지 않고 raw 를 그대로 돌려준다("딱 붙이기" 끔).
 */
export function snapTarget(outline: Outline, grab: Vec2, raw: Vec2, radiusM: number, enabled: boolean = true): TargetSnap {
  const free: TargetSnap = { point: { x: raw.x, y: raw.y }, kind: 'free', label: '', mark: null };
  if (!enabled || radiusM <= 0) return free;
  const made = (point: Vec2, kind: SnapKind, mark: SnapMark | null, label?: string): TargetSnap => ({
    point: { x: point.x === 0 ? 0 : point.x, y: point.y }, kind, label: label ?? SNAP_LABEL[kind], mark,
  });
  /** 잡은 점 자신(또는 바로 옆)은 대상이 아니다. */
  const usable = (p: Vec2): boolean => dist(p, grab) >= MIN_DRAG_M;
  const grabIsVertex = outline.vertices.some((v) => dist(v, grab) < 5e-6);

  // 1) 점: 테두리 모서리, 안쪽 모서리, 가운데 선이 가장자리/접은 선과 만나는 점
  {
    let best: { p: Vec2; label?: string } | null = null;
    let bestD = radiusM;
    const tryPt = (p: Vec2, label?: string): void => {
      if (!usable(p)) return;
      const d = dist(p, raw);
      if (d < bestD) { bestD = d; best = label === undefined ? { p } : { p, label }; }
    };
    for (const v of outline.vertices) tryPt(v, grabIsVertex ? undefined : '모서리에 딱!');
    for (const v of outline.innerPoints) tryPt(v, grabIsVertex ? undefined : '모서리에 딱!');
    for (const s of [...outline.edges, ...outline.creases]) {
      // 가운데 선(x = 0)을 가로지르는 선분이면 만나는 점을 후보로
      if ((s.a.x < -SAME && s.b.x > SAME) || (s.a.x > SAME && s.b.x < -SAME)) {
        const t = s.a.x / (s.a.x - s.b.x);
        tryPt({ x: 0, y: s.a.y + (s.b.y - s.a.y) * t }, SNAP_LABEL.center);
      }
    }
    if (best) {
      const b = best as { p: Vec2; label?: string };
      return made(b.p, 'vertex', { type: 'point', p: b.p }, b.label);
    }
  }

  // 2) 가운데 선 건너편의 같은 자리(그러면 접는 선이 정확히 가운데 선이 된다)
  if (Math.abs(grab.x) > 1e-4) {
    const m = { x: -grab.x, y: grab.y };
    if (dist(m, raw) < radiusM) return made(m, 'mirror', { type: 'point', p: m });
  }

  // 3) 가장자리끼리 나란히
  {
    const adjacent = outline.edges.filter((e) => dist(closestOnSeg(grab, e), grab) < 5e-6);
    let best: { p: Vec2; target: Seg | null } | null = null;
    let bestD = radiusM;
    for (const e of adjacent) {
      const targets: (Seg | null)[] = [null, ...outline.edges.filter((o) => o !== e), ...outline.creases];
      for (const tg of targets) {
        for (const c of alignCandidates(grab, e, tg)) {
          if (!usable(c)) continue;
          const d = dist(c, raw);
          // 같은 거리면 가운데 선(먼저 나온 것)을 우선한다.
          if (d < bestD - 1e-9) { bestD = d; best = { p: c, target: tg }; }
        }
      }
    }
    if (best) {
      const b = best as { p: Vec2; target: Seg | null };
      return b.target
        ? made(b.p, 'align-edge', { type: 'seg', a: b.target.a, b: b.target.b })
        : made({ x: 0, y: b.p.y }, 'align-center', { type: 'center' });
    }
  }

  // 4) 가운데 선
  if (Math.abs(raw.x) < radiusM && usable({ x: 0, y: raw.y })) {
    return made({ x: 0, y: raw.y }, 'center', { type: 'center' });
  }

  // 5) 접은 선
  {
    let best: { p: Vec2; s: Seg } | null = null;
    let bestD = radiusM;
    for (const s of outline.creases) {
      const c = closestOnSeg(raw, s);
      const d = dist(c, raw);
      if (d < bestD && usable(c)) { bestD = d; best = { p: c, s }; }
    }
    if (best) {
      const b = best as { p: Vec2; s: Seg };
      return made(b.p, 'crease', { type: 'seg', a: b.s.a, b: b.s.b });
    }
  }

  // 6) 똑바로(잡은 곳과 같은 세로줄이나 가로줄). 반듯한 가로/세로 접기가 된다.
  {
    const ddx = Math.abs(raw.x - grab.x);
    const ddy = Math.abs(raw.y - grab.y);
    if (ddx < radiusM * 0.7 && ddy > MIN_DRAG_M && ddx <= ddy) {
      const p = { x: grab.x, y: raw.y };
      return made(p, 'straight', { type: 'seg', a: grab, b: p });
    }
    if (ddy < radiusM * 0.7 && ddx > MIN_DRAG_M) {
      const p = { x: raw.x, y: grab.y };
      return made(p, 'straight', { type: 'seg', a: grab, b: p });
    }
  }

  // 7) 가장자리
  {
    let best: { p: Vec2; s: Seg } | null = null;
    let bestD = radiusM;
    for (const s of outline.edges) {
      const c = closestOnSeg(raw, s);
      const d = dist(c, raw);
      if (d < bestD && usable(c)) { bestD = d; best = { p: c, s }; }
    }
    if (best) {
      const b = best as { p: Vec2; s: Seg };
      return made(b.p, 'edge', { type: 'seg', a: b.s.a, b: b.s.b });
    }
  }
  return free;
}

// ---------------------------------------------------------------------------
// 5) 접기 계획: 검사 + 양쪽 같이 접기
// ---------------------------------------------------------------------------

/** core 의 상태에 화면 쪽 사정 세 가지를 더했다. */
export type GestureStatus = FoldStatus | 'limit' | 'short' | 'off-desk';

/** 접을 수 없을 때 아이에게 건네는 말. ok 면 빈 문자열. */
export function hintForStatus(status: GestureStatus): string {
  switch (status) {
    case 'ok': return '';
    case 'short': return '조금 더 멀리 끌어 보세요.';
    case 'miss': return '거기로는 접을 수 없어요. 종이 안쪽으로 끌어 보세요.';
    case 'sliver': return '너무 조금 접혀요. 조금 더 끌어 볼까요?';
    case 'degenerate': return '조금 더 멀리 끌어 보세요.';
    case 'too-many-layers': return '종이가 너무 두꺼워져서 더는 못 접어요.';
    case 'limit': return `${LIMITS.maxFolds}번까지만 접을 수 있어요. 되돌리기를 눌러 보세요.`;
    case 'off-desk': return '종이가 책상 밖으로 나가요. 다른 쪽으로 접어 보세요.';
  }
}

export type MirrorSkip = 'overlap' | 'nothing' | 'limit';

export function hintForMirrorSkip(reason: MirrorSkip): string {
  switch (reason) {
    case 'overlap': return '가운데를 넘어가는 접기라서 한쪽만 접었어요.';
    case 'nothing': return '반대쪽은 접을 곳이 없어서 한쪽만 접었어요.';
    case 'limit': return '한 번만 더 접을 수 있어서 한쪽만 접었어요.';
  }
}

export interface GesturePlan {
  status: GestureStatus;
  /** 실제로 더해질 접기. 양쪽 같이 접기면 2개. 접을 수 없으면 빈 배열. */
  ops: FoldOp[];
  /** 접은 뒤의 종이. 접을 수 없으면 지금 종이 그대로. */
  result: FoldedSheet;
  /** result.layers 와 같은 순서. 이번 동작으로 움직인 겹이면 true. */
  moved: boolean[];
  /** 양쪽 같이 접기를 켰지만 한쪽만 접은 이유. 해당 없으면 null. */
  mirrorSkipped: MirrorSkip | null;
  /** 사용자에게 보여줄 한 줄(없으면 빈 문자열) */
  hint: string;
}

export interface PlanOptions {
  /** 양쪽 같이 접기 */
  symmetric: boolean;
  /** 지금까지 접은 횟수 */
  count: number;
}

const lastStatus = (s: FoldedSheet): FoldStatus => s.reports[s.reports.length - 1]?.status ?? 'degenerate';

/** 접기의 점이 종이에서 너무 멀면(core 의 설계 검사 한도) 받지 않는다. */
function tooFar(sheet: FoldedSheet, op: FoldOp): boolean {
  const bx = 2 * sheet.paper.widthM - 1e-3;
  const by = 2 * sheet.paper.heightM - 1e-3;
  return [op.a, op.b].some((p) => Math.abs(p.x) > bx || Math.abs(p.y) > by);
}

/** 접기 하나를 적용하고, 결과의 겹마다 "움직였는지"를 이어서 계산한다. */
function stepWithFlags(
  sheet: FoldedSheet, flags: readonly boolean[], op: FoldOp,
): { sheet: FoldedSheet; flags: boolean[] } | null {
  const next = applyFold(sheet, op);
  if (lastStatus(next) !== 'ok') return null;
  // core 와 같은 방식으로 "남는 겹"과 "움직이는 겹"의 원래 번호를 센다.
  const stay: number[] = [];
  const move: number[] = [];
  sheet.layers.forEach((l, i) => {
    if (polygonArea(clipLeft(l.poly, op.b, op.a)) > 1e-12) stay.push(i);
    if (polygonArea(clipLeft(l.poly, op.a, op.b)) > 1e-12) move.push(i);
  });
  move.reverse();
  const order: { src: number; moved: boolean }[] = op.dir === 'mountain'
    ? [...move.map((src) => ({ src, moved: true })), ...stay.map((src) => ({ src, moved: false }))]
    : [...stay.map((src) => ({ src, moved: false })), ...move.map((src) => ({ src, moved: true }))];
  // 아주 드문 오차로 개수가 어긋나면 표시를 포기한다(그림 효과일 뿐이라 안전하다).
  if (order.length !== next.layers.length) return { sheet: next, flags: next.layers.map(() => false) };
  return { sheet: next, flags: order.map((o) => o.moved || (flags[o.src] ?? false)) };
}

/**
 * 접기 op 를 지금 종이에 적용하는 계획을 세운다.
 * - 접을 수 없으면 이유(status, hint)만 돌려주고 ops 는 비운다.
 * - symmetric 이면 가운데 선 건너편에도 같은 접기를 한 번 더 한다. 다만
 *   (가) 첫 접기가 가운데 선을 넘어가 두 접기가 같은 곳을 두 번 접게 되거나,
 *   (나) 접어 넘긴 조각이 반대쪽 접기에 다시 딸려 가면
 *   결과가 엉뚱해지므로 한쪽만 접고 이유를 알려 준다.
 */
export function planOps(sheet: FoldedSheet, op: FoldOp, opts: PlanOptions): GesturePlan {
  const none = (status: GestureStatus): GesturePlan => ({
    status, ops: [], result: sheet, moved: sheet.layers.map(() => false), mirrorSkipped: null, hint: hintForStatus(status),
  });
  if (opts.count >= LIMITS.maxFolds) return none('limit');
  if (tooFar(sheet, op)) return none('off-desk');

  const base = sheet.layers.map(() => false);
  const first = stepWithFlags(sheet, base, op);
  if (!first) return none(lastStatus(applyFold(sheet, op)));

  const single = (skip: MirrorSkip | null): GesturePlan => ({
    status: 'ok', ops: [op], result: first.sheet, moved: first.flags, mirrorSkipped: skip,
    hint: skip ? hintForMirrorSkip(skip) : '',
  });
  if (!opts.symmetric || isSelfMirror(op)) return single(null);
  if (opts.count + 2 > LIMITS.maxFolds) return single('limit');

  const m = mirrorOp(op);
  // (가) 움직이는 부분끼리 겹치는가  (나) 접어 넘긴 조각이 반대쪽 접기의 움직이는 쪽에 걸치는가
  let overlap = 0;
  for (const l of sheet.layers) {
    const piece = clipLeft(l.poly, op.a, op.b);
    if (piece.length < 3) continue;
    overlap += polygonArea(clipLeft(piece, m.a, m.b));
    const landed = piece.map((p) => reflectPoint(p, op.a, op.b)).reverse();
    overlap += polygonArea(clipLeft(landed, m.a, m.b));
    if (overlap > OVERLAP_AREA) return single('overlap');
  }
  if (tooFar(first.sheet, m)) return single('nothing');
  const second = stepWithFlags(first.sheet, first.flags, m);
  if (!second) return single('nothing');
  return { status: 'ok', ops: [op, m], result: second.sheet, moved: second.flags, mirrorSkipped: null, hint: '' };
}

export interface GestureOptions extends PlanOptions {
  dir: FoldOp['dir'];
}

/** 끌기 한 번(grab -> to)을 접기 계획으로 바꾼다. 화면은 포인터가 움직일 때마다 이것을 부른다. */
export function planGesture(sheet: FoldedSheet, grab: Vec2, to: Vec2, opts: GestureOptions): GesturePlan {
  const op = foldFromDrag(sheet, grab, to, { dir: opts.dir });
  if (!op) {
    return {
      status: 'short', ops: [], result: sheet, moved: sheet.layers.map(() => false),
      mirrorSkipped: null, hint: hintForStatus('short'),
    };
  }
  return planOps(sheet, op, opts);
}

/** 이미 정해진 접기들(길잡이 값, 건너뛰기)을 적용했을 때 어느 겹이 움직였는지. 접기 애니메이션용. */
export function movedFlags(sheet: FoldedSheet, ops: readonly FoldOp[]): boolean[] {
  let cur = { sheet, flags: sheet.layers.map(() => false) };
  for (const op of ops) {
    const next = stepWithFlags(cur.sheet, cur.flags, op);
    if (!next) break;
    cur = next;
  }
  return cur.flags;
}

// ---------------------------------------------------------------------------
// 6) 따라 접기 길잡이
// ---------------------------------------------------------------------------

/** 기본 허용 오차: 선의 위치 8 mm, 기울기 9도 */
export const GUIDE_TOL_M = 0.008;
export const GUIDE_TOL_DEG = 9;

/**
 * 사용자의 접기 op 가 길잡이 접기 guideOp 와 충분히 비슷한지.
 * 선은 방향 없는 직선으로 비교하고(기울기 차이, 길잡이 선 가운데 점까지의 거리),
 * 움직이는 쪽이 같은지도 본다. 앞/뒤 방향(dir)은 보지 않는다(화면이 길잡이 값으로 맞춰 준다).
 */
export function matchGuide(op: FoldOp, guideOp: FoldOp, toleranceM: number = GUIDE_TOL_M, toleranceDeg: number = GUIDE_TOL_DEG): boolean {
  const ux = op.b.x - op.a.x;
  const uy = op.b.y - op.a.y;
  const ul = Math.hypot(ux, uy);
  const gx = guideOp.b.x - guideOp.a.x;
  const gy = guideOp.b.y - guideOp.a.y;
  const gl = Math.hypot(gx, gy);
  if (ul < SAME || gl < SAME) return false;
  const cos = (ux * gx + uy * gy) / (ul * gl);
  const sin = Math.abs(ux * gy - uy * gx) / (ul * gl);
  // 방향 없는 직선끼리의 각도(0~90도)
  const angle = (Math.atan2(sin, Math.abs(cos)) * 180) / Math.PI;
  if (angle > toleranceDeg) return false;
  const mx = (guideOp.a.x + guideOp.b.x) / 2;
  const my = (guideOp.a.y + guideOp.b.y) / 2;
  const d = Math.abs((ux * (my - op.a.y) - uy * (mx - op.a.x)) / ul);
  if (d > toleranceM) return false;
  // 거의 나란한 두 선에서 진행 방향이 같으면 왼쪽(움직이는 쪽)도 같다.
  return cos > 0;
}

/**
 * 사용자의 접기(1개 또는 양쪽 2개)를 길잡이와 맞춰 보고, 맞으면 "정확한 길잡이 값"을 돌려준다.
 * - 첫 접기가 지금 단계와 맞으면 그 단계를 넣는다. 양쪽 같이 접었고 둘째가 다음 단계와도 맞으면 두 단계를 한꺼번에 넣는다.
 * - 양쪽 같이 접었는데 순서만 반대(오른쪽을 먼저 잡음)여도 받아 준다.
 * 맞지 않으면 null.
 */
export function resolveGuide(
  ops: readonly FoldOp[], guide: readonly FoldOp[], index: number,
  toleranceM: number = GUIDE_TOL_M, toleranceDeg: number = GUIDE_TOL_DEG,
): FoldOp[] | null {
  const g0 = guide[index];
  const g1 = guide[index + 1];
  const u0 = ops[0];
  const u1 = ops[1];
  if (!g0 || !u0) return null;
  const ok = (u: FoldOp, g: FoldOp): boolean => matchGuide(u, g, toleranceM, toleranceDeg);
  if (ok(u0, g0)) return u1 && g1 && ok(u1, g1) ? [g0, g1] : [g0];
  if (u1 && g1 && ok(u1, g0) && ok(u0, g1)) return [g0, g1];
  return null;
}

export interface GuideCue {
  /** 잡을 곳 */
  grab: Vec2;
  /** 가져갈 곳 */
  dest: Vec2;
}

/**
 * 길잡이 접기를 손으로 하려면 어디를 잡아 어디로 가져가면 되는지.
 * 움직이는 부분의 꼭짓점 가운데 접는 선에서 가장 먼 것을 잡고, 그 점이 접힌 뒤 놓이는 자리로 가져간다.
 * 같은 거리의 후보가 여럿이면 위쪽, 그다음 왼쪽 것을 고른다(항상 같은 결과가 나오도록).
 */
export function guideCue(sheet: FoldedSheet, guideOp: FoldOp): GuideCue | null {
  const { a, b } = guideOp;
  const len = dist(a, b);
  if (len < SAME) return null;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  let best: Vec2 | null = null;
  let bestD = 1e-4;
  for (const l of sheet.layers) {
    for (const p of clipLeft(l.poly, a, b)) {
      const d = ux * (p.y - a.y) - uy * (p.x - a.x);
      const better = d > bestD + 1e-6
        || (best !== null && Math.abs(d - bestD) <= 1e-6 && (p.y > best.y + 1e-6 || (Math.abs(p.y - best.y) <= 1e-6 && p.x < best.x - 1e-6)));
      if (better) { bestD = Math.max(d, bestD); best = p; }
    }
  }
  if (!best) return null;
  const grab = { x: best.x, y: best.y };
  return { grab, dest: reflectPoint(grab, a, b) };
}

// ---------------------------------------------------------------------------
// 7) 그 밖의 작은 도우미
// ---------------------------------------------------------------------------

/** 가장 많이 겹친 곳의 겹 수(각 겹 조각의 가운데에서 센다). */
export function maxLayerCount(sheet: FoldedSheet): number {
  let best = 0;
  for (const l of sheet.layers) {
    let cx = 0;
    let cy = 0;
    for (const v of l.poly) { cx += v.x; cy += v.y; }
    const n = Math.max(1, l.poly.length);
    const c = layerCountAt(sheet, { x: cx / n, y: cy / n });
    if (c > best) best = c;
  }
  return best;
}
