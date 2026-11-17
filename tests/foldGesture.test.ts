/**
 * "종이를 직접 잡아 접기" 계산(src/app/fold/gesture.ts) 시험.
 * 화면 없이 끌기 좌표만으로 접기가 올바르게 만들어지는지 확인한다.
 */
import { describe, expect, it } from 'vitest';
import type { FoldOp, Vec2 } from '../src/core/types';
import { LIMITS } from '../src/core/types';
import { getPaper } from '../src/core/papers';
import { PRESETS } from '../src/core/presets';
import { buildGeometry } from '../src/core/fold/geometry';
import {
  applyFold, applyFolds, checkArea, flatSheet, polygonArea, reflectPoint,
} from '../src/core/fold/fold';
import type { FoldedSheet } from '../src/core/fold/fold';
import {
  clipLeft, computeOutline, foldFromDrag, guideCue, hintForStatus, isSelfMirror, matchGuide, MIN_DRAG_M,
  mirrorOp, movedFlags, planGesture, planOps, resolveGuide, snapGrab, snapTarget, SNAP_LABEL,
} from '../src/app/fold/gesture';

const A4 = getPaper('copy80')!;
const W = A4.widthM;
const H = A4.heightM;
const TOP = H / 2;
const LEFT = -W / 2;
/** 화면에서 약 14픽셀에 해당하는 붙는 거리 */
const SNAP_R = 0.009;
/** 손가락 굵기에 해당하는 잡는 거리 */
const GRAB_R = 0.015;

const P = (x: number, y: number): Vec2 => ({ x, y });
const ok = (s: FoldedSheet): boolean => s.reports[s.reports.length - 1]?.status === 'ok';

/** 접힌 종이가 가운데 선(x = 0)에 대해 좌우 대칭인지: 모든 겹의 거울상이 겹 목록 안에 있어야 한다. */
function isMirrorSymmetric(sheet: FoldedSheet, tol = 1e-6): boolean {
  const info = sheet.layers.map((l) => {
    let cx = 0;
    let cy = 0;
    for (const p of l.poly) { cx += p.x; cy += p.y; }
    return { cx: cx / l.poly.length, cy: cy / l.poly.length, area: polygonArea(l.poly), n: l.poly.length };
  });
  const used = new Set<number>();
  for (const a of info) {
    const j = info.findIndex((b, k) => !used.has(k) && b.n === a.n
      && Math.abs(b.cx + a.cx) < tol && Math.abs(b.cy - a.cy) < tol && Math.abs(b.area - a.area) < tol * 1e-2);
    if (j < 0) return false;
    used.add(j);
  }
  return true;
}

/** 넓이의 좌우 균형: 모든 겹의 (넓이 x 가운데 x좌표) 합. 좌우 대칭이면 0. */
function xMoment(sheet: FoldedSheet): number {
  let m = 0;
  for (const l of sheet.layers) {
    // 다각형의 넓이 중심 x 를 삼각형으로 나눠 구한다.
    const p0 = l.poly[0]!;
    for (let i = 1; i + 1 < l.poly.length; i++) {
      const p1 = l.poly[i]!;
      const p2 = l.poly[i + 1]!;
      const a = ((p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)) / 2;
      m += a * (p0.x + p1.x + p2.x) / 3;
    }
  }
  return m;
}

/** 직선 a->b 에 대해 점 p 가 왼쪽이면 + */
const side = (op: FoldOp, p: Vec2): number => (op.b.x - op.a.x) * (p.y - op.a.y) - (op.b.y - op.a.y) * (p.x - op.a.x);

describe('foldFromDrag: 끌기 -> 접는 선', () => {
  const sheet = flatSheet(A4);
  const cases: [Vec2, Vec2][] = [
    [P(LEFT, TOP), P(0, TOP - 0.105)],
    [P(LEFT, TOP), P(0.03, 0.01)],
    [P(0.105, -0.1485), P(-0.02, -0.03)],
    [P(-0.04, 0.02), P(0.06, -0.07)],
    [P(0, TOP), P(0, 0)],
    [P(LEFT, 0), P(0.105, 0)],
  ];

  it('접는 선은 수직이등분선이다: 반올림하지 않으면 잡은 점이 정확히 손가락 자리에 놓인다', () => {
    for (const [grab, to] of cases) {
      const op = foldFromDrag(sheet, grab, to, { round: false })!;
      expect(op).not.toBeNull();
      const landed = reflectPoint(grab, op.a, op.b);
      expect(landed.x).toBeCloseTo(to.x, 10);
      expect(landed.y).toBeCloseTo(to.y, 10);
      // 선 위의 점은 잡은 점과 손가락에서 같은 거리에 있다.
      for (const q of [op.a, op.b]) {
        expect(Math.hypot(q.x - grab.x, q.y - grab.y)).toBeCloseTo(Math.hypot(q.x - to.x, q.y - to.y), 10);
      }
    }
  });

  it('0.1 mm 로 반올림해도 잡은 점은 0.2 mm 안에 놓이고, 좌표는 0.1 mm 단위다', () => {
    for (const [grab, to] of cases) {
      const op = foldFromDrag(sheet, grab, to)!;
      const landed = reflectPoint(grab, op.a, op.b);
      expect(Math.hypot(landed.x - to.x, landed.y - to.y)).toBeLessThan(2e-4);
      for (const v of [op.a.x, op.a.y, op.b.x, op.b.y]) expect(Math.abs(v * 1e4 - Math.round(v * 1e4))).toBeLessThan(1e-6);
    }
  });

  it('잡은 쪽이 a->b 의 왼쪽이다(그쪽이 움직인다)', () => {
    for (const [grab, to] of cases) {
      const op = foldFromDrag(sheet, grab, to)!;
      expect(side(op, grab)).toBeGreaterThan(0);
      expect(side(op, to)).toBeLessThan(0);
      // 실제로 접으면 잡은 점이 있던 자리의 종이가 사라지거나(한 겹일 때) 손가락 자리에 겹이 생긴다.
      const after = applyFold(sheet, op);
      expect(ok(after)).toBe(true);
      expect(checkArea(after).ok).toBe(true);
    }
  });

  it('앞으로(valley)가 기본이고 뒤로(mountain)도 고를 수 있다', () => {
    const [grab, to] = cases[0]!;
    expect(foldFromDrag(sheet, grab, to)!.dir).toBe('valley');
    expect(foldFromDrag(sheet, grab, to, { dir: 'valley' })!.dir).toBe('valley');
    const m = foldFromDrag(sheet, grab, to, { dir: 'mountain' })!;
    expect(m.dir).toBe('mountain');
    // 앞으로 접으면 움직인 겹이 맨 위에, 뒤로 접으면 맨 아래에 온다.
    const v = applyFold(sheet, foldFromDrag(sheet, grab, to)!);
    const mm = applyFold(sheet, m);
    expect(v.layers[v.layers.length - 1]!.flipped).toBe(true);
    expect(mm.layers[0]!.flipped).toBe(true);
    expect(movedFlags(sheet, [foldFromDrag(sheet, grab, to)!])).toEqual([false, true]);
    expect(movedFlags(sheet, [m])).toEqual([true, false]);
  });

  it('너무 짧게 끌면 null', () => {
    const g = P(LEFT, TOP);
    expect(foldFromDrag(sheet, g, g)).toBeNull();
    expect(foldFromDrag(sheet, g, P(LEFT + MIN_DRAG_M * 0.9, TOP))).toBeNull();
    expect(foldFromDrag(sheet, g, P(LEFT + MIN_DRAG_M * 1.1, TOP))).not.toBeNull();
    expect(foldFromDrag(sheet, g, P(LEFT + 0.02, TOP), { minDragM: 0.03 })).toBeNull();
    expect(foldFromDrag(sheet, g, P(Number.NaN, 0))).toBeNull();
  });

  it('선의 두 점은 종이를 감싸는 상자 안팎의 가까운 곳에 잡힌다(설계 검사 한도 안)', () => {
    for (const [grab, to] of cases) {
      const op = foldFromDrag(sheet, grab, to)!;
      for (const q of [op.a, op.b]) {
        expect(Math.abs(q.x)).toBeLessThan(2 * W);
        expect(Math.abs(q.y)).toBeLessThan(2 * H);
      }
      expect(Math.hypot(op.a.x - op.b.x, op.a.y - op.b.y)).toBeGreaterThan(0.07);
    }
  });
});

describe('computeOutline: 접힌 종이의 테두리', () => {
  it('펼친 종이는 모서리 4개, 가장자리 4개, 안쪽 선 없음', () => {
    const o = computeOutline(flatSheet(A4));
    expect(o.vertices).toHaveLength(4);
    expect(o.edges).toHaveLength(4);
    expect(o.creases).toHaveLength(0);
    expect(o.innerPoints).toHaveLength(0);
  });

  it('모서리를 가운데 선에 접으면 테두리는 오각형이 되고, 접어 넣은 조각의 가장자리는 안쪽 선이 된다', () => {
    const dart = PRESETS.find((p) => p.id === 'dart')!.design.folds;
    const s1 = applyFolds(A4, dart.slice(0, 1));
    const o = computeOutline(s1);
    expect(o.vertices).toHaveLength(5);
    expect(o.edges).toHaveLength(5);
    // 비스듬한 접힌 변이 테두리에 있다.
    const slanted = o.edges.find((e) => Math.abs(Math.abs(e.a.x - e.b.x) - 0.105) < 1e-6 && Math.abs(Math.abs(e.a.y - e.b.y) - 0.105) < 1e-6);
    expect(slanted).toBeDefined();
    // 안쪽 선: 조각의 아랫변(가로)과 가운데 선 위의 변(세로)
    expect(o.creases.length).toBe(2);
    expect(o.innerPoints.some((p) => Math.abs(p.x) < 1e-6 && Math.abs(p.y - (TOP - 0.105)) < 1e-6)).toBe(true);

    // 양쪽을 다 접으면 삼각 지붕 모양: 모서리 5개(꼭대기, 양 어깨, 아래 두 모서리)
    const o2 = computeOutline(applyFolds(A4, dart.slice(0, 2)));
    expect(o2.vertices).toHaveLength(5);
    expect(o2.vertices.some((p) => Math.abs(p.x) < 1e-6 && Math.abs(p.y - TOP) < 1e-6)).toBe(true);
  });
});

describe('snapGrab: 잡을 때 붙이기', () => {
  const sheet = flatSheet(A4);
  const o = computeOutline(sheet);

  it('모서리 근처를 누르면 모서리를 잡는다(종이 밖에서 눌러도)', () => {
    const g = snapGrab(sheet, o, P(LEFT - 0.006, TOP + 0.005), GRAB_R)!;
    expect(g.kind).toBe('vertex');
    expect(g.point).toEqual(P(LEFT, TOP));
    expect(snapGrab(sheet, o, P(LEFT + 0.008, TOP - 0.008), GRAB_R)!.kind).toBe('vertex');
  });

  it('가장자리 근처를 누르면 가장자리 위의 가장 가까운 점을 잡는다', () => {
    const g = snapGrab(sheet, o, P(-0.03, TOP - 0.007), GRAB_R)!;
    expect(g.kind).toBe('edge');
    expect(g.point.x).toBeCloseTo(-0.03, 9);
    expect(g.point.y).toBeCloseTo(TOP, 9);
    // 손가락 반경이 작아도 종이 안쪽에서는 12 mm 까지 가장자리로 봐 준다.
    const g2 = snapGrab(sheet, o, P(LEFT + 0.011, 0), 0.004)!;
    expect(g2.kind).toBe('edge');
    expect(g2.point.x).toBeCloseTo(LEFT, 9);
  });

  it('종이 안쪽 깊숙한 곳은 손가락 위치 그대로, 종이 밖 먼 곳은 잡지 않는다', () => {
    const g = snapGrab(sheet, o, P(0.02, 0.03), GRAB_R)!;
    expect(g.kind).toBe('inside');
    expect(g.point).toEqual(P(0.02, 0.03));
    expect(snapGrab(sheet, o, P(LEFT - 0.03, 0), GRAB_R)).toBeNull();
    // 종이 밖에서는 넉넉한 띠(12 mm)를 적용하지 않는다.
    expect(snapGrab(sheet, o, P(LEFT - 0.011, 0), 0.004)).toBeNull();
  });
});

describe('snapTarget: 끌고 갈 때 붙이기', () => {
  const sheet = flatSheet(A4);
  const o = computeOutline(sheet);
  const dart = PRESETS.find((p) => p.id === 'dart')!.design.folds;

  it('다른 모서리: "모서리끼리 딱!"', () => {
    const s = snapTarget(o, P(LEFT, TOP), P(0.101, -0.144), SNAP_R);
    expect(s.kind).toBe('vertex');
    expect(s.point).toEqual(P(0.105, -0.1485));
    expect(s.label).toBe('모서리끼리 딱!');
    expect(s.mark).toEqual({ type: 'point', p: P(0.105, -0.1485) });
    // 모서리가 아닌 곳을 잡았으면 말이 달라진다.
    expect(snapTarget(o, P(-0.03, TOP), P(0.101, -0.144), SNAP_R).label).toBe('모서리에 딱!');
  });

  it('잡은 점 자신에게는 붙지 않는다', () => {
    const s = snapTarget(o, P(LEFT, TOP), P(LEFT + 0.002, TOP - 0.001), SNAP_R);
    expect(s.point).not.toEqual(P(LEFT, TOP));
  });

  it('가운데 선 건너편의 같은 자리: 접는 선이 정확히 가운데 선이 된다', () => {
    const grab = P(LEFT, 0.05);
    const s = snapTarget(o, grab, P(0.102, 0.053), SNAP_R);
    expect(s.kind).toBe('mirror');
    expect(s.point).toEqual(P(0.105, 0.05));
    expect(s.label).toBe(SNAP_LABEL.mirror);
    const op = foldFromDrag(sheet, grab, s.point)!;
    expect(op.a.x).toBe(0);
    expect(op.b.x).toBe(0);
    expect(isSelfMirror(op)).toBe(true);
  });

  it('가장자리를 가운데 선에 나란히: 윗변 모서리를 끌면 정확히 45도로 붙는다', () => {
    const s = snapTarget(o, P(LEFT, TOP), P(0.003, TOP - 0.102), SNAP_R);
    expect(s.kind).toBe('align-center');
    expect(s.point.x).toBe(0);
    expect(s.point.y).toBeCloseTo(TOP - 0.105, 9);
    expect(s.label).toBe('가운데 선에 딱!');
    expect(s.mark).toEqual({ type: 'center' });
  });

  it('가장자리를 다른 가장자리에 나란히: 윗변을 잡아 아랫변에 맞춘다', () => {
    const grab = P(-0.05, TOP);
    const s = snapTarget(o, grab, P(-0.047, -TOP + 0.004), SNAP_R);
    expect(s.kind).toBe('align-edge');
    expect(s.point.x).toBeCloseTo(-0.05, 9);
    expect(s.point.y).toBeCloseTo(-TOP, 9);
    expect(s.label).toBe('가장자리끼리 딱!');
    // 이렇게 접으면 반으로 접는 가로선이 된다.
    const op = foldFromDrag(sheet, grab, s.point)!;
    expect(op.a.y).toBeCloseTo(0, 9);
    expect(op.b.y).toBeCloseTo(0, 9);
  });

  it('비스듬한 가장자리를 가운데 선에 나란히(다트의 둘째 접기)', () => {
    const s2 = applyFolds(A4, dart.slice(0, 2));
    const o2 = computeOutline(s2);
    const grab = P(LEFT, TOP - 0.105);
    const s = snapTarget(o2, grab, P(0.002, 0.003), SNAP_R);
    expect(s.kind).toBe('align-center');
    expect(s.point.x).toBe(0);
    expect(s.point.y).toBeCloseTo(TOP - 0.105 * Math.SQRT2, 9);
  });

  it('가운데 선: x 만 0 으로 붙는다', () => {
    const s = snapTarget(o, P(-0.05, 0.05), P(0.004, -0.012), SNAP_R);
    expect(s.kind).toBe('center');
    expect(s.point).toEqual(P(0, -0.012));
    expect(s.label).toBe('가운데 선에 딱!');
  });

  it('접은 선: 이미 접힌 조각의 가장자리에 붙는다', () => {
    const s1 = applyFolds(A4, dart.slice(0, 1));
    const o1 = computeOutline(s1);
    const s = snapTarget(o1, P(0.05, -0.05), P(-0.05, TOP - 0.105 + 0.003), SNAP_R);
    expect(s.kind).toBe('crease');
    expect(s.point.x).toBeCloseTo(-0.05, 9);
    expect(s.point.y).toBeCloseTo(TOP - 0.105, 9);
    expect(s.label).toBe('접은 선에 딱!');
    expect(s.mark?.type).toBe('seg');
  });

  it('똑바로: 잡은 곳과 같은 세로줄(가로줄)에 붙어 반듯한 선이 된다', () => {
    const grab = P(-0.05, 0.05);
    const v = snapTarget(o, grab, P(-0.047, -0.02), SNAP_R);
    expect(v.kind).toBe('straight');
    expect(v.point).toEqual(P(-0.05, -0.02));
    expect(v.label).toBe('똑바로 딱!');
    const op = foldFromDrag(sheet, grab, v.point)!;
    expect(op.a.y).toBe(op.b.y);
    const h = snapTarget(o, grab, P(0.03, 0.052), SNAP_R);
    expect(h.kind).toBe('straight');
    expect(h.point).toEqual(P(0.03, 0.05));
  });

  it('가장자리: 가장자리 위의 가장 가까운 점', () => {
    const s = snapTarget(o, P(-0.05, 0.05), P(0.101, -0.03), SNAP_R);
    expect(s.kind).toBe('edge');
    expect(s.point.x).toBeCloseTo(0.105, 9);
    expect(s.point.y).toBeCloseTo(-0.03, 9);
    expect(s.label).toBe('가장자리에 딱!');
  });

  it('가까운 것이 없으면 그대로, "딱 붙이기"를 끄면 언제나 그대로', () => {
    const raw = P(0.04, -0.02);
    const f = snapTarget(o, P(-0.05, 0.08), raw, SNAP_R);
    expect(f.kind).toBe('free');
    expect(f.point).toEqual(raw);
    expect(f.label).toBe('');
    expect(f.mark).toBeNull();
    const off = snapTarget(o, P(LEFT, TOP), P(0.003, TOP - 0.102), SNAP_R, false);
    expect(off.kind).toBe('free');
    expect(off.point).toEqual(P(0.003, TOP - 0.102));
  });

  it('붙는 거리 밖이면 붙지 않는다(경계)', () => {
    expect(snapTarget(o, P(-0.05, 0.05), P(SNAP_R * 0.95, -0.01), SNAP_R).kind).toBe('center');
    expect(snapTarget(o, P(-0.05, 0.05), P(SNAP_R * 1.05, -0.01), SNAP_R).kind).toBe('free');
  });
});

describe('양쪽 같이 접기', () => {
  const sheet = flatSheet(A4);

  it('mirrorOp 은 선과 움직이는 쪽을 모두 거울상으로 만든다', () => {
    const op = foldFromDrag(sheet, P(LEFT, TOP), P(-0.01, 0.03))!;
    const m = mirrorOp(op);
    expect(m.dir).toBe(op.dir);
    // 원래 접기에서 움직이는 점의 거울상은 거울 접기에서도 움직인다.
    expect(side(op, P(LEFT, TOP))).toBeGreaterThan(0);
    expect(side(m, P(-LEFT, TOP))).toBeGreaterThan(0);
    expect(side(m, P(LEFT, TOP))).toBeLessThan(0);
    expect(mirrorOp(m)).toEqual(op);
  });

  it('한쪽 모서리를 접으면 반대쪽도 접히고, 결과는 좌우 대칭이며 넓이가 보존된다', () => {
    const drags: [Vec2, Vec2][] = [
      [P(LEFT, TOP), P(0, TOP - 0.105)],
      [P(LEFT, TOP), P(-0.03, 0.06)],
      [P(0.105, -0.1485), P(0.04, -0.09)],
      [P(LEFT, 0.02), P(-0.06, 0.0)],
    ];
    for (const dir of ['valley', 'mountain'] as const) {
      for (const [grab, to] of drags) {
        const plan = planGesture(sheet, grab, to, { dir, symmetric: true, count: 0 });
        expect(plan.status).toBe('ok');
        expect(plan.ops).toHaveLength(2);
        expect(plan.ops[1]).toEqual(mirrorOp(plan.ops[0]!));
        expect(plan.mirrorSkipped).toBeNull();
        expect(isMirrorSymmetric(plan.result)).toBe(true);
        expect(checkArea(plan.result).ok).toBe(true);
        // 계획의 결과는 core 로 직접 접은 것과 같다.
        const direct = applyFolds(A4, plan.ops);
        expect(direct.layers.length).toBe(plan.result.layers.length);
        expect(plan.moved).toHaveLength(plan.result.layers.length);
        expect(plan.moved.filter(Boolean)).toHaveLength(2);
      }
    }
  });

  it('이미 접힌 대칭 종이에 또 접어도 대칭이 유지된다', () => {
    const first = planGesture(sheet, P(LEFT, TOP), P(0, TOP - 0.105), { dir: 'valley', symmetric: true, count: 0 });
    const second = planGesture(first.result, P(LEFT, TOP - 0.105), P(0, 0), { dir: 'valley', symmetric: true, count: 2 });
    expect(second.ops).toHaveLength(2);
    expect(isMirrorSymmetric(second.result)).toBe(true);
    expect(checkArea(second.result).ok).toBe(true);
  });

  it('가로선이나 가운데 선 접기는 그 자체로 대칭이라 한 번만 접는다', () => {
    const down = planGesture(sheet, P(LEFT, TOP), P(LEFT, 0.05), { dir: 'valley', symmetric: true, count: 0 });
    expect(down.ops).toHaveLength(1);
    expect(down.mirrorSkipped).toBeNull();
    expect(down.hint).toBe('');
    expect(isMirrorSymmetric(down.result)).toBe(true);
    const half = planGesture(sheet, P(LEFT, 0.05), P(0.105, 0.05), { dir: 'valley', symmetric: true, count: 0 });
    expect(half.ops).toHaveLength(1);
    expect(half.mirrorSkipped).toBeNull();
  });

  it('가운데 선을 넘어가는 접기는 한쪽만 접고 이유를 알려 준다', () => {
    // 움직이는 부분이 가운데 선을 걸친다(살짝 기운 가로 접기)
    const a = planGesture(sheet, P(LEFT, TOP), P(LEFT + 0.01, 0.02), { dir: 'valley', symmetric: true, count: 0 });
    expect(a.status).toBe('ok');
    expect(a.ops).toHaveLength(1);
    expect(a.mirrorSkipped).toBe('overlap');
    expect(a.hint).toContain('한쪽만');
    // 모서리를 가운데 선 너머까지 끌어도, 조각끼리 포개질 뿐이면 양쪽 다 접는다(실제 종이와 같다).
    const b = planGesture(sheet, P(LEFT, TOP), P(0.04, 0.06), { dir: 'valley', symmetric: true, count: 0 });
    expect(b.ops).toHaveLength(2);
    expect(isMirrorSymmetric(b.result)).toBe(true);
  });

  it('어떤 끌기든: 양쪽을 다 접었으면 결과가 대칭이고, 아니면 이유가 붙는다', () => {
    const start = planGesture(sheet, P(LEFT, TOP), P(0, TOP - 0.105), { dir: 'valley', symmetric: true, count: 0 }).result;
    let both = 0;
    let skipped = 0;
    for (const base of [sheet, start]) {
      const o = computeOutline(base);
      for (const grab of o.vertices) {
        for (let ix = -4; ix <= 4; ix++) {
          for (let iy = -5; iy <= 5; iy++) {
            const to = P(ix * 0.024 + 0.001, iy * 0.027 + 0.002);
            const plan = planGesture(base, grab, to, { dir: 'valley', symmetric: true, count: 2 });
            if (plan.status !== 'ok') { expect(plan.ops).toHaveLength(0); continue; }
            expect(checkArea(plan.result).ok).toBe(true);
            if (plan.ops.length === 2) {
              both++;
              // 1 mm^2 보다 작은 걸침은 봐주므로, 여기서는 넓이의 좌우 균형(1차 모멘트)으로 대칭을 확인한다.
              expect(Math.abs(xMoment(plan.result)), JSON.stringify({ grab, to })).toBeLessThan(5e-7);
            } else {
              skipped++;
              expect(plan.mirrorSkipped).not.toBeNull();
              expect(plan.hint.length).toBeGreaterThan(0);
            }
          }
        }
      }
    }
    expect(both).toBeGreaterThan(50);
    expect(skipped).toBeGreaterThan(50);
  });

  it('끄면 한 번만 접는다', () => {
    const plan = planGesture(sheet, P(LEFT, TOP), P(0, TOP - 0.105), { dir: 'valley', symmetric: false, count: 0 });
    expect(plan.ops).toHaveLength(1);
    expect(plan.mirrorSkipped).toBeNull();
    expect(isMirrorSymmetric(plan.result)).toBe(false);
  });
});

describe('검사와 안내 말', () => {
  const sheet = flatSheet(A4);

  it('접을 수 없는 끌기는 아무것도 더하지 않고 쉬운 말로 이유를 알려 준다', () => {
    // 모서리를 종이 밖으로 끌면 접는 선이 종이를 지나지 않는다.
    const miss = planGesture(sheet, P(LEFT, TOP), P(LEFT - 0.05, TOP + 0.05), { dir: 'valley', symmetric: true, count: 0 });
    expect(miss.status).toBe('miss');
    expect(miss.ops).toHaveLength(0);
    expect(miss.result).toBe(sheet);
    expect(miss.hint).toBe(hintForStatus('miss'));
    // 너무 짧은 끌기
    const short = planGesture(sheet, P(LEFT, TOP), P(LEFT + 0.001, TOP), { dir: 'valley', symmetric: true, count: 0 });
    expect(short.status).toBe('short');
    expect(short.ops).toHaveLength(0);
    // 귀퉁이를 아주 조금만 접으면 조각이 너무 작다.
    const sliver = planGesture(sheet, P(LEFT, TOP), P(LEFT + 0.0012, TOP - 0.0012), { dir: 'valley', symmetric: false, count: 0 });
    expect(['sliver', 'short']).toContain(sliver.status);
    const sliver2 = planOps(sheet, { a: P(LEFT, TOP - 0.001), b: P(LEFT + 0.001, TOP), dir: 'valley' }, { symmetric: false, count: 0 });
    expect(sliver2.status).toBe('sliver');
    expect(sliver2.hint).toBe(hintForStatus('sliver'));
    const degenerate = planOps(sheet, { a: P(0, 0), b: P(0, 0), dir: 'valley' }, { symmetric: false, count: 0 });
    expect(degenerate.status).toBe('degenerate');
  });

  it('모든 상태에 한국어 안내가 있고 전문 용어가 없다', () => {
    for (const st of ['short', 'miss', 'sliver', 'degenerate', 'too-many-layers', 'limit', 'off-desk'] as const) {
      const h = hintForStatus(st);
      expect(h.length).toBeGreaterThan(5);
      expect(h).toMatch(/요\.?$|요\?$/);
      expect(h).not.toMatch(/골접기|산접기|직선|좌표/);
    }
    expect(hintForStatus('ok')).toBe('');
  });

  it(`접기는 ${LIMITS.maxFolds}번까지: 꽉 차면 접지 않고, 한 번 남았으면 한쪽만 접는다`, () => {
    const full = planGesture(sheet, P(LEFT, TOP), P(0, TOP - 0.105), { dir: 'valley', symmetric: true, count: LIMITS.maxFolds });
    expect(full.status).toBe('limit');
    expect(full.ops).toHaveLength(0);
    expect(full.hint).toContain(String(LIMITS.maxFolds));
    const one = planGesture(sheet, P(LEFT, TOP), P(0, TOP - 0.105), { dir: 'valley', symmetric: true, count: LIMITS.maxFolds - 1 });
    expect(one.status).toBe('ok');
    expect(one.ops).toHaveLength(1);
    expect(one.mirrorSkipped).toBe('limit');
  });

  it('겹이 한도를 넘는 접기는 too-many-layers 로 막힌다', () => {
    // 반으로 계속 접어 겹을 늘린다.
    let s = sheet;
    let status = 'ok';
    for (let i = 0; i < 12 && status === 'ok'; i++) {
      const o = computeOutline(s);
      const ys = o.vertices.map((v) => v.y);
      const xs = o.vertices.map((v) => v.x);
      const horizontal = i % 2 === 0;
      const grab = horizontal ? P(Math.min(...xs), Math.max(...ys)) : P(Math.min(...xs), Math.max(...ys));
      const to = horizontal ? P(Math.min(...xs), Math.min(...ys)) : P(Math.max(...xs), Math.max(...ys));
      const plan = planGesture(s, grab, to, { dir: 'valley', symmetric: false, count: i });
      status = plan.status;
      s = plan.result;
    }
    expect(status).toBe('too-many-layers');
  });

  it('종이에서 너무 먼 선은 받지 않는다', () => {
    const far = planOps(sheet, { a: P(0.5, 0), b: P(0.5, 0.1), dir: 'valley' }, { symmetric: false, count: 0 });
    expect(far.status).toBe('off-desk');
    expect(far.ops).toHaveLength(0);
  });
});

describe('따라 접기 길잡이', () => {
  const dart = PRESETS.find((p) => p.id === 'dart')!.design.folds;
  const g0 = dart[0]!;

  it('비슷한 선이면 맞는 것으로 본다(방향 없는 직선으로 비교)', () => {
    expect(matchGuide(g0, g0, 0.008, 9)).toBe(true);
    // 살짝 어긋난 선
    const near: FoldOp = { a: P(g0.a.x + 0.003, g0.a.y - 0.002), b: P(g0.b.x + 0.004, g0.b.y + 0.001), dir: 'valley' };
    expect(matchGuide(near, g0, 0.008, 9)).toBe(true);
    // 같은 직선 위의 다른 두 점(길이와 위치가 달라도 같은 선)
    const dx = g0.b.x - g0.a.x;
    const dy = g0.b.y - g0.a.y;
    const longer: FoldOp = { a: P(g0.a.x - dx, g0.a.y - dy), b: P(g0.b.x + dx * 0.5, g0.b.y + dy * 0.5), dir: 'valley' };
    expect(matchGuide(longer, g0, 0.008, 9)).toBe(true);
    // 앞/뒤 방향은 보지 않는다.
    expect(matchGuide({ ...g0, dir: 'mountain' }, g0, 0.008, 9)).toBe(true);
  });

  it('반대쪽이 움직이는 접기, 멀리 떨어진 선, 많이 기운 선은 맞지 않는다', () => {
    expect(matchGuide({ a: g0.b, b: g0.a, dir: 'valley' }, g0, 0.008, 9)).toBe(false);
    const shifted: FoldOp = { a: P(g0.a.x + 0.02, g0.a.y - 0.02), b: P(g0.b.x + 0.02, g0.b.y - 0.02), dir: 'valley' };
    expect(matchGuide(shifted, g0, 0.008, 9)).toBe(false);
    expect(matchGuide(shifted, g0, 0.04, 9)).toBe(true);
    const tilted: FoldOp = { a: g0.a, b: P(g0.b.x + 0.03, g0.b.y - 0.03), dir: 'valley' };
    expect(matchGuide(tilted, g0, 0.02, 9)).toBe(false);
    expect(matchGuide(tilted, g0, 0.03, 30)).toBe(true);
    expect(matchGuide(dart[1]!, g0, 0.008, 9)).toBe(false);
    expect(matchGuide({ a: P(0, 0), b: P(0, 0), dir: 'valley' }, g0, 0.008, 9)).toBe(false);
  });

  it('guideCue: 접는 선에서 가장 먼 모서리를 잡아 접힌 뒤의 자리로 가져가라고 알려 준다', () => {
    const c0 = guideCue(flatSheet(A4), g0)!;
    expect(c0.grab.x).toBeCloseTo(LEFT, 9);
    expect(c0.grab.y).toBeCloseTo(TOP, 9);
    expect(c0.dest.x).toBeCloseTo(0, 9);
    expect(c0.dest.y).toBeCloseTo(TOP - 0.105, 9);
    // 오른쪽 접기는 오른쪽 모서리
    const c1 = guideCue(applyFolds(A4, dart.slice(0, 1)), dart[1]!)!;
    expect(c1.grab.x).toBeCloseTo(0.105, 9);
    expect(c1.dest.x).toBeCloseTo(0, 9);
    // 가로로 내려 접기는 위 왼쪽 모서리를 똑바로 아래로
    const down: FoldOp = { a: P(LEFT, 0.1), b: P(0.105, 0.1), dir: 'valley' };
    const c2 = guideCue(flatSheet(A4), down)!;
    expect(c2.grab).toEqual(P(LEFT, TOP));
    expect(c2.dest.x).toBeCloseTo(LEFT, 9);
    expect(c2.dest.y).toBeCloseTo(0.2 - TOP, 9);
    // 종이를 지나지 않는 선은 안내할 것이 없다.
    expect(guideCue(flatSheet(A4), { a: P(-1, 1), b: P(1, 1), dir: 'valley' })).toBeNull();
  });

  it('모든 프리셋: 안내한 대로 끌면 그 단계와 맞는다', () => {
    for (const preset of PRESETS) {
      const folds = preset.design.folds;
      let sheet = flatSheet(A4);
      for (let i = 0; i < folds.length; i++) {
        const cue = guideCue(sheet, folds[i]!);
        expect(cue, `${preset.id} ${i}`).not.toBeNull();
        const plan = planGesture(sheet, cue!.grab, cue!.dest, { dir: 'valley', symmetric: false, count: i });
        expect(plan.status, `${preset.id} ${i}`).toBe('ok');
        expect(resolveGuide(plan.ops, folds, i), `${preset.id} ${i}`).toEqual([folds[i]]);
        sheet = applyFold(sheet, folds[i]!);
      }
    }
  });

  it('resolveGuide: 양쪽 같이 접었으면 두 단계를 한꺼번에, 순서가 반대여도 받아 준다', () => {
    const sheet = flatSheet(A4);
    const both = planGesture(sheet, P(LEFT, TOP), P(0.002, TOP - 0.103), { dir: 'valley', symmetric: true, count: 0 });
    expect(resolveGuide(both.ops, dart, 0)).toEqual([dart[0], dart[1]]);
    const rightFirst = planGesture(sheet, P(0.105, TOP), P(-0.002, TOP - 0.103), { dir: 'valley', symmetric: true, count: 0 });
    expect(resolveGuide(rightFirst.ops, dart, 0)).toEqual([dart[0], dart[1]]);
    const single = planGesture(sheet, P(LEFT, TOP), P(0.002, TOP - 0.103), { dir: 'valley', symmetric: false, count: 0 });
    expect(resolveGuide(single.ops, dart, 0)).toEqual([dart[0]]);
    // 오른쪽만 접으면 지금 단계(왼쪽)와 맞지 않는다.
    const rightOnly = planGesture(sheet, P(0.105, TOP), P(-0.002, TOP - 0.103), { dir: 'valley', symmetric: false, count: 0 });
    expect(resolveGuide(rightOnly.ops, dart, 0)).toBeNull();
    // 엉뚱한 접기
    const wrong = planGesture(sheet, P(LEFT, -TOP), P(-0.02, -0.05), { dir: 'valley', symmetric: true, count: 0 });
    expect(resolveGuide(wrong.ops, dart, 0)).toBeNull();
    expect(resolveGuide([], dart, 0)).toBeNull();
    expect(resolveGuide(both.ops, dart, dart.length)).toBeNull();
  });
});

describe('손으로 끌어서 기본 다트를 그대로 만든다', () => {
  const preset = PRESETS.find((p) => p.id === 'dart')!;
  const target = preset.design.folds;

  /** 손가락이 정확하지 않은 것을 흉내 낸 끌기(몇 mm 씩 어긋나게 누르고 놓는다) */
  function drag(sheet: FoldedSheet, down: Vec2, up: Vec2, count: number): FoldOp[] {
    const outline = computeOutline(sheet);
    const grab = snapGrab(sheet, outline, down, GRAB_R)!;
    expect(grab.kind).toBe('vertex');
    const snap = snapTarget(outline, grab.point, up, SNAP_R);
    expect(snap.kind).toBe('align-center');
    const plan = planGesture(sheet, grab.point, snap.point, { dir: 'valley', symmetric: true, count });
    expect(plan.status).toBe('ok');
    return plan.ops;
  }

  it('모서리를 가운데 선에 두 번 맞추면 프리셋과 같은 접기 4개가 나온다', () => {
    expect(target).toHaveLength(4);
    const folds: FoldOp[] = [];
    folds.push(...drag(applyFolds(A4, folds), P(LEFT + 0.004, TOP - 0.005), P(0.003, TOP - 0.101), folds.length));
    expect(folds).toHaveLength(2);
    folds.push(...drag(applyFolds(A4, folds), P(LEFT + 0.003, TOP - 0.108), P(-0.002, 0.003), folds.length));
    expect(folds).toHaveLength(4);

    // 접는 선이 프리셋과 같다(0.1 mm 단위까지).
    for (let i = 0; i < 4; i++) {
      expect(folds[i]!.dir).toBe(target[i]!.dir);
      for (const k of ['a', 'b'] as const) {
        expect(folds[i]![k].x).toBeCloseTo(target[i]![k].x, 6);
        expect(folds[i]![k].y).toBeCloseTo(target[i]![k].y, 6);
      }
    }

    // 그래서 비행기 형상 값도 같다.
    const mine = buildGeometry({ ...preset.design, folds }).stats;
    const theirs = buildGeometry(preset.design).stats;
    expect(mine.wingAreaM2).toBeCloseTo(theirs.wingAreaM2, 8);
    expect(mine.spanM).toBeCloseTo(theirs.spanM, 8);
    expect(mine.lengthM).toBeCloseTo(theirs.lengthM, 8);
    expect(mine.cgFracLength).toBeCloseTo(theirs.cgFracLength, 8);
    expect(mine.maxLayers).toBe(theirs.maxLayers);
    expect(Math.abs(mine.asymmetry)).toBeLessThan(1e-9);
  });

  it('clipLeft 는 넓이를 둘로 정확히 나눈다', () => {
    const sheet = flatSheet(A4);
    const op = target[0]!;
    const poly = sheet.layers[0]!.poly;
    const l = polygonArea(clipLeft(poly, op.a, op.b));
    const r = polygonArea(clipLeft(poly, op.b, op.a));
    expect(l + r).toBeCloseTo(W * H, 12);
    expect(l).toBeCloseTo(0.105 * 0.105 / 2, 9);
  });
});
