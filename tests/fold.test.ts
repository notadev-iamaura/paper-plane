import { describe, expect, it } from 'vitest';
import type { FoldOp } from '../src/core/types';
import { getPaper, PAPERS } from '../src/core/papers';
import {
  applyFold, applyFolds, boundingBox, checkArea, creasePattern, flatSheet, foldStatusMessageKo,
  foldedToSheet, layerCountAt, MAX_LAYER_POLYGONS, polygonArea, reflectPoint, renderLayers, signedArea,
  totalLayerArea,
} from '../src/core/fold/fold';
import { PRESETS } from '../src/core/presets';
import { makeLcg, randomFold } from './helpers';

const A4 = getPaper('copy80')!;
const W = A4.widthM;
const H = A4.heightM;

/** 가로선 y 위쪽을 접어 내리는 접기 */
const down = (y: number, dir: 'valley' | 'mountain' = 'valley'): FoldOp => ({ a: { x: -W / 2, y }, b: { x: W / 2, y }, dir });

describe('종이 목록', () => {
  it('모두 A4 이고 값이 현실적인 범위다', () => {
    expect(PAPERS.length).toBeGreaterThanOrEqual(6);
    const ids = new Set(PAPERS.map((p) => p.id));
    expect(ids.size).toBe(PAPERS.length);
    for (const p of PAPERS) {
      expect(p.widthM).toBe(0.21);
      expect(p.heightM).toBe(0.297);
      expect(p.gsm).toBeGreaterThanOrEqual(40);
      expect(p.gsm).toBeLessThanOrEqual(200);
      expect(p.thicknessM).toBeGreaterThanOrEqual(60e-6);
      expect(p.thicknessM).toBeLessThanOrEqual(200e-6);
      expect(p.youngsModulusPa).toBeGreaterThanOrEqual(2e9);
      expect(p.youngsModulusPa).toBeLessThanOrEqual(5e9);
      expect(p.nameKo.length).toBeGreaterThan(0);
      expect(p.descriptionKo.length).toBeGreaterThan(0);
      expect(getPaper(p.id)).toBe(p);
    }
    expect(getPaper('없는종이')).toBeUndefined();
    expect(getPaper('__proto__')).toBeUndefined();
  });
});

describe('평면 접기', () => {
  it('접지 않은 종이는 한 겹이고 넓이가 종이 넓이와 같다', () => {
    const s = applyFolds(A4, []);
    expect(s.layers.length).toBe(1);
    expect(totalLayerArea(s)).toBeCloseTo(W * H, 12);
    expect(boundingBox(s)).toEqual({ minX: -W / 2, maxX: W / 2, minY: -H / 2, maxY: H / 2 });
    expect(layerCountAt(s, { x: 0, y: 0 })).toBe(1);
    expect(layerCountAt(s, { x: 1, y: 0 })).toBe(0);
    expect(creasePattern(s)).toEqual([]);
  });

  it('같은 직선에 두 번 반사하면 제자리로 돌아온다', () => {
    const rnd = makeLcg(7);
    for (let i = 0; i < 200; i++) {
      const f = randomFold(rnd);
      const p = { x: rnd() - 0.5, y: rnd() - 0.5 };
      const back = reflectPoint(reflectPoint(p, f.a, f.b), f.a, f.b);
      expect(back.x).toBeCloseTo(p.x, 12);
      expect(back.y).toBeCloseTo(p.y, 12);
    }
    // 직선 위의 점은 움직이지 않는다.
    const on = reflectPoint({ x: 0.03, y: 0.03 }, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(on.x).toBeCloseTo(0.03, 14);
    expect(on.y).toBeCloseTo(0.03, 14);
  });

  it('윗변을 접어 내리면 진행 방향 왼쪽(위쪽)이 움직이고 두 겹이 된다', () => {
    const y = H / 2 - 0.05;
    const s = applyFolds(A4, [down(y)]);
    expect(s.reports).toEqual([{ index: 0, status: 'ok', movedAreaM2: expect.closeTo(W * 0.05, 10) }]);
    expect(s.layers.length).toBe(2);
    expect(boundingBox(s).maxY).toBeCloseTo(y, 12);
    expect(layerCountAt(s, { x: 0, y: y - 0.01 })).toBe(2);
    expect(layerCountAt(s, { x: 0, y: y - 0.06 })).toBe(1);
    expect(layerCountAt(s, { x: 0, y: y + 0.01 })).toBe(0);
    expect(checkArea(s).ok).toBe(true);
  });

  it('골접기는 움직인 겹이 위에, 산접기는 아래에 쌓인다', () => {
    const y = H / 2 - 0.05;
    const valley = applyFolds(A4, [down(y, 'valley')]);
    const mountain = applyFolds(A4, [down(y, 'mountain')]);
    const top = valley.layers[valley.layers.length - 1]!;
    expect(top.flipped).toBe(true);
    expect(polygonArea(top.poly)).toBeCloseTo(W * 0.05, 10);
    const bottom = mountain.layers[0]!;
    expect(bottom.flipped).toBe(true);
    expect(bottom.order).toBe(0);
    expect(polygonArea(bottom.poly)).toBeCloseTo(W * 0.05, 10);
  });

  it('여러 겹을 함께 접으면 움직인 묶음의 순서가 뒤집힌다', () => {
    // 1) 위 5cm 를 접어 내린다 -> 아래부터 [본체, 덮개]
    // 2) 세로 중심선(아래 -> 위 방향, 왼쪽이 움직임)으로 왼쪽을 오른쪽 위로 접는다 -> [본체R, 덮개R, 덮개L, 본체L]
    const y = H / 2 - 0.05;
    const s = applyFolds(A4, [down(y), { a: { x: 0, y: -H }, b: { x: 0, y: H }, dir: 'valley' }]);
    expect(s.layers.length).toBe(4);
    const areas = s.layers.map((l) => polygonArea(l.poly));
    const big = (W / 2) * (H - 0.05);
    const small = (W / 2) * 0.05;
    expect(areas[0]).toBeCloseTo(big, 10);
    expect(areas[1]).toBeCloseTo(small, 10);
    expect(areas[2]).toBeCloseTo(small, 10);
    expect(areas[3]).toBeCloseTo(big, 10);
    expect(s.layers.map((l) => l.flipped)).toEqual([false, true, false, true]);
    expect(s.layers.map((l) => l.order)).toEqual([0, 1, 2, 3]);
    // 산접기면 움직인 묶음이 아래로 들어간다.
    const m = applyFolds(A4, [down(y), { a: { x: 0, y: -H }, b: { x: 0, y: H }, dir: 'mountain' }]);
    const mAreas = m.layers.map((l) => polygonArea(l.poly));
    expect(mAreas[0]).toBeCloseTo(small, 10);
    expect(mAreas[1]).toBeCloseTo(big, 10);
    expect(mAreas[2]).toBeCloseTo(big, 10);
    expect(mAreas[3]).toBeCloseTo(small, 10);
    expect(boundingBox(s).minX).toBeCloseTo(0, 12);
  });

  it('겹 다각형은 항상 반시계 방향이고 그리기용 목록은 아래에서 위 순서다', () => {
    const rnd = makeLcg(99);
    for (let k = 0; k < 30; k++) {
      const folds = Array.from({ length: 6 }, () => randomFold(rnd));
      const s = applyFolds(A4, folds);
      for (const l of s.layers) expect(signedArea(l.poly)).toBeGreaterThan(0);
      const r = renderLayers(s);
      expect(r.length).toBe(s.layers.length);
      r.forEach((l, i) => expect(l.order).toBe(i));
    }
  });

  it('접을 수 없는 접기는 건너뛰고 이유를 알려 준다', () => {
    const s = applyFolds(A4, [
      { a: { x: 0.3, y: -1 }, b: { x: 0.3, y: 1 }, dir: 'valley' },          // 종이 밖(왼쪽에 종이 전체)
      { a: { x: 0.3, y: 1 }, b: { x: 0.3, y: -1 }, dir: 'valley' },          // 종이 밖(왼쪽에 아무것도 없음)
      { a: { x: 0.01, y: 0.01 }, b: { x: 0.01, y: 0.01 }, dir: 'valley' },   // 같은 점
      { a: { x: -W / 2, y: H / 2 - 1e-6 }, b: { x: W / 2, y: H / 2 - 1e-6 }, dir: 'valley' }, // 너무 얇은 조각
      { a: { x: NaN, y: 0 }, b: { x: 1, y: 0 }, dir: 'valley' },
      down(0),
    ]);
    expect(s.reports.map((r) => r.status)).toEqual(['miss', 'miss', 'degenerate', 'sliver', 'degenerate', 'ok']);
    expect(s.layers.length).toBe(2);
    expect(checkArea(s).ok).toBe(true);
    for (const st of ['miss', 'sliver', 'degenerate', 'too-many-layers'] as const) {
      expect(foldStatusMessageKo(st).length).toBeGreaterThan(0);
    }
    expect(foldStatusMessageKo('ok')).toBe('');
    // 잘못된 입력에도 예외 없이 동작한다.
    expect(() => applyFolds(A4, [null as unknown as FoldOp, {} as FoldOp])).not.toThrow();
    expect(applyFolds(A4, 'x' as unknown as FoldOp[]).layers.length).toBe(1);
  });

  it('직선 위의 꼭짓점은 움직이지 않는다(대각선 접기)', () => {
    // 왼쪽 위 모서리를 중심선으로: 접는 선은 (0, 위) 와 (-W/2, 위 - W/2) 를 지난다.
    const top = H / 2;
    const s = applyFolds(A4, [{ a: { x: -W / 2, y: top - W / 2 }, b: { x: 0, y: top }, dir: 'valley' }]);
    expect(s.reports[0]!.status).toBe('ok');
    expect(s.layers.length).toBe(2);
    const flap = s.layers[1]!;
    expect(polygonArea(flap.poly)).toBeCloseTo((W * W) / 8, 12);
    // 모서리 (-W/2, top) 는 (0, top - W/2) 로 간다.
    const hit = flap.poly.some((p) => Math.abs(p.x) < 1e-12 && Math.abs(p.y - (top - W / 2)) < 1e-12);
    expect(hit).toBe(true);
    // 접는 선 위의 두 점은 그대로 있다.
    expect(flap.poly.some((p) => Math.abs(p.x) < 1e-12 && Math.abs(p.y - top) < 1e-12)).toBe(true);
    expect(flap.poly.some((p) => Math.abs(p.x + W / 2) < 1e-12 && Math.abs(p.y - (top - W / 2)) < 1e-12)).toBe(true);
  });

  it('임의로 접어도 겹 넓이의 합은 항상 종이 넓이와 같다', () => {
    const rnd = makeLcg(12345);
    for (let k = 0; k < 300; k++) {
      let s = flatSheet(PAPERS[k % PAPERS.length]!);
      const n = 1 + Math.floor(rnd() * 10);
      for (let i = 0; i < n; i++) {
        s = applyFold(s, randomFold(rnd));
        const c = checkArea(s);
        expect(c.errorM2).toBeLessThan(1e-10);
        expect(c.ok).toBe(true);
      }
      expect(s.reports.length).toBe(n);
      expect(s.layers.length).toBeLessThanOrEqual(MAX_LAYER_POLYGONS);
    }
  });

  it('각 겹을 펼친 좌표로 되돌리면 종이 안에 들어가고 길이가 보존된다', () => {
    const rnd = makeLcg(4242);
    for (let k = 0; k < 60; k++) {
      const s = applyFolds(A4, Array.from({ length: 7 }, () => randomFold(rnd)));
      let area = 0;
      for (const l of s.layers) {
        const un = l.poly.map((p) => foldedToSheet(l, p));
        area += polygonArea(un);
        for (const p of un) {
          expect(Math.abs(p.x)).toBeLessThanOrEqual(W / 2 + 1e-9);
          expect(Math.abs(p.y)).toBeLessThanOrEqual(H / 2 + 1e-9);
        }
        // 등거리 변환: 변의 길이가 같다. 뒤집힌 겹은 방향이 반대다.
        const d0 = Math.hypot(l.poly[0]!.x - l.poly[1]!.x, l.poly[0]!.y - l.poly[1]!.y);
        const d1 = Math.hypot(un[0]!.x - un[1]!.x, un[0]!.y - un[1]!.y);
        expect(d1).toBeCloseTo(d0, 10);
        expect(signedArea(un) > 0).toBe(!l.flipped);
      }
      expect(area).toBeCloseTo(W * H, 9);
    }
  });

  it('전개도: 접은 선이 펼친 종이 좌표로 기록되고 산/골이 구분된다', () => {
    const y = H / 2 - 0.05;
    const one = creasePattern(applyFolds(A4, [down(y)]));
    expect(one.length).toBe(1);
    expect(one[0]!.kind).toBe('valley');
    expect(one[0]!.foldIndex).toBe(0);
    expect(one[0]!.a.y).toBeCloseTo(y, 12);
    expect(one[0]!.b.y).toBeCloseTo(y, 12);
    expect(Math.abs(one[0]!.a.x - one[0]!.b.x)).toBeCloseTo(W, 12);

    // 반으로 접은 뒤 다시 반으로 접으면, 뒤집힌 겹에 생긴 선은 앞면에서 볼 때 반대(산)가 된다.
    const two = creasePattern(applyFolds(A4, [down(0), { a: { x: 0, y: -H }, b: { x: 0, y: H }, dir: 'valley' }]));
    expect(two.length).toBe(3);
    const second = two.filter((c) => c.foldIndex === 1);
    expect(second.map((c) => c.kind).sort()).toEqual(['mountain', 'valley']);
    for (const c of second) {
      expect(c.a.x).toBeCloseTo(0, 12);
      expect(c.b.x).toBeCloseTo(0, 12);
    }
    // 두 선분을 합치면 종이 세로 전체를 덮는다.
    const len = second.reduce((s, c) => s + Math.abs(c.a.y - c.b.y), 0);
    expect(len).toBeCloseTo(H, 12);

    // 산접기는 산으로 기록된다.
    expect(creasePattern(applyFolds(A4, [down(y, 'mountain')]))[0]!.kind).toBe('mountain');
  });

  it('임의 접기의 접은 선은 모두 종이 안에 있다', () => {
    const rnd = makeLcg(555);
    for (let k = 0; k < 40; k++) {
      const s = applyFolds(A4, Array.from({ length: 6 }, () => randomFold(rnd)));
      for (const c of creasePattern(s)) {
        for (const p of [c.a, c.b]) {
          expect(Math.abs(p.x)).toBeLessThanOrEqual(W / 2 + 1e-9);
          expect(Math.abs(p.y)).toBeLessThanOrEqual(H / 2 + 1e-9);
        }
      }
    }
  });

  it('계속 반으로 접으면 겹 수 한도에서 멈추고 알려 준다', () => {
    // 가로, 세로로 번갈아 가며 남은 부분의 가운데를 접는다.
    const folds: FoldOp[] = [];
    let x0 = -W / 2, x1 = W / 2, y0 = -H / 2, y1 = H / 2;
    for (let i = 0; i < 24; i++) {
      if (i % 2 === 0) {
        const m = (x0 + x1) / 2;
        folds.push({ a: { x: m, y: -0.5 }, b: { x: m, y: 0.5 }, dir: 'valley' }); // 왼쪽(-x)이 움직인다
        x0 = m;
      } else {
        const m = (y0 + y1) / 2;
        folds.push({ a: { x: -0.4, y: m }, b: { x: 0.4, y: m }, dir: 'mountain' }); // 위쪽이 움직인다
        y1 = m;
      }
    }
    const s = applyFolds(A4, folds);
    const statuses = s.reports.map((r) => r.status);
    expect(statuses.slice(0, 9).every((v) => v === 'ok')).toBe(true);
    expect(statuses).toContain('too-many-layers');
    expect(s.layers.length).toBeLessThanOrEqual(MAX_LAYER_POLYGONS);
    expect(s.layers.length).toBe(512);
    expect(checkArea(s).ok).toBe(true);
    const bb = boundingBox(s);
    expect(layerCountAt(s, { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 })).toBe(512);
  });

  it('모든 프리셋의 접기는 전부 실제로 접히고 넓이가 보존된다', () => {
    for (const p of PRESETS) {
      const s = applyFolds(getPaper(p.design.paperId)!, p.design.folds);
      expect(s.reports.every((r) => r.status === 'ok'), p.id).toBe(true);
      expect(checkArea(s).ok, p.id).toBe(true);
      // 좌우 대칭: 상자가 중심선에 대해 대칭이다.
      const bb = boundingBox(s);
      expect(bb.minX).toBeCloseTo(-bb.maxX, 9);
    }
  });
});
