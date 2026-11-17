/**
 * "선 그어 접기(고급)" 계산. 예전 편집기(src/app/lib/foldPlan.ts)의 방식을 옮겨 왔다.
 * 종이 위에 선을 긋고, 그 선으로 접는다. 기본으로 "더 작은 쪽"이 움직이고, flip 이면 반대쪽이 움직인다.
 * 검사와 양쪽 같이 접기는 gesture.ts 의 planOps 를 그대로 쓴다.
 */
import type { FoldOp, Vec2 } from '../../core/types';
import { applyFold } from '../../core/fold/fold';
import type { FoldedSheet } from '../../core/fold/fold';
import { hintForStatus, planOps } from './gesture';
import type { GesturePlan, Outline, PlanOptions } from './gesture';

/** 너무 짧은 선(톡 누른 것)은 접기로 보지 않는다(m). */
export const MIN_LINE_M = 0.004;

const round4 = (v: number): number => {
  const r = Math.round(v * 1e4) / 1e4;
  return r === 0 ? 0 : r;
};

/** 선 p-q 로 접는 계획. */
export function planLine(
  sheet: FoldedSheet, p: Vec2, q: Vec2, dir: FoldOp['dir'], flip: boolean, opts: PlanOptions,
): GesturePlan {
  const a = { x: round4(p.x), y: round4(p.y) };
  const b = { x: round4(q.x), y: round4(q.y) };
  if (Math.hypot(a.x - b.x, a.y - b.y) < MIN_LINE_M) {
    return { status: 'short', ops: [], result: sheet, moved: sheet.layers.map(() => false), mirrorSkipped: null, hint: hintForStatus('short') };
  }
  const op1: FoldOp = { a, b, dir };
  const op2: FoldOp = { a: b, b: a, dir };
  const moved = (op: FoldOp): number => {
    const r = applyFold(sheet, op).reports;
    const last = r[r.length - 1];
    return last && last.status === 'ok' ? last.movedAreaM2 : -1;
  };
  const m1 = moved(op1);
  const m2 = moved(op2);
  // 둘 다 되면 작은 쪽이 기본. flip 이면 다른 쪽.
  let op = op1;
  if (m1 >= 0 && m2 >= 0) op = (m1 <= m2) !== flip ? op1 : op2;
  else if (m2 >= 0) op = op2;
  return planOps(sheet, op, opts);
}

export interface LineSnap {
  point: Vec2;
  kind: 'point' | 'center' | 'angle' | 'free';
}

/** 붙을 수 있는 점: 테두리 모서리, 안쪽 모서리, 가장자리의 가운데 점 */
export function lineSnapPoints(outline: Outline): Vec2[] {
  const out: Vec2[] = [...outline.vertices, ...outline.innerPoints];
  for (const e of outline.edges) out.push({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 });
  return out;
}

const ANGLE_STEP = Math.PI / 12; // 15도
const ANGLE_TOL = (5 * Math.PI) / 180;

/**
 * 선의 끝점을 가까운 기준에 붙인다.
 * @param anchor 선의 첫 점(둘째 점을 잡는 중일 때). 있으면 15도 단위 각도에도 붙는다.
 */
export function snapLinePoint(raw: Vec2, candidates: readonly Vec2[], tolM: number, anchor: Vec2 | null): LineSnap {
  let best: Vec2 | null = null;
  let bestD = tolM;
  for (const c of candidates) {
    const d = Math.hypot(c.x - raw.x, c.y - raw.y);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (best) return { point: { x: best.x, y: best.y }, kind: 'point' };

  if (anchor) {
    const dx = raw.x - anchor.x;
    const dy = raw.y - anchor.y;
    const len = Math.hypot(dx, dy);
    if (len > MIN_LINE_M) {
      const ang = Math.atan2(dy, dx);
      const snapped = Math.round(ang / ANGLE_STEP) * ANGLE_STEP;
      if (Math.abs(ang - snapped) < ANGLE_TOL) {
        const ux = Math.cos(snapped);
        const uy = Math.sin(snapped);
        let t = len * Math.cos(ang - snapped);
        // 각도를 지킨 채로 가운데 선 가까이 왔으면 가운데 선 위의 점으로 맞춘다.
        if (Math.abs(ux) > 1e-6) {
          const tCenter = -anchor.x / ux;
          if (tCenter > 0 && Math.abs(tCenter - t) * Math.abs(ux) < tolM) t = tCenter;
        }
        return { point: { x: anchor.x + ux * t, y: anchor.y + uy * t }, kind: 'angle' };
      }
    }
  }
  if (Math.abs(raw.x) < tolM) return { point: { x: 0, y: raw.y }, kind: 'center' };
  return { point: raw, kind: 'free' };
}
