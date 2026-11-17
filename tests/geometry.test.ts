import { describe, expect, it } from 'vitest';
import type { PlaneDesign, PlaneGeometry } from '../src/core/types';
import { LIMITS } from '../src/core/types';
import { PAPERS, getPaper } from '../src/core/papers';
import { buildGeometry } from '../src/core/fold/geometry';
import { PRESETS, PRESET_PARAM_META, buildPresetDesign, defaultPresetParams, getPresetParamMeta } from '../src/core/presets';
import { validateDesign } from '../src/core/validate';
import { makeLcg, randomDesign } from './helpers';

const W = 0.21;
const H = 0.297;

function flatDesign(over: Partial<PlaneDesign['shaping']> = {}, extra: Partial<PlaneDesign> = {}): PlaneDesign {
  return {
    v: 1,
    paperId: 'copy80',
    folds: [],
    shaping: { keelM: 0, dihedralDeg: 0, wingletM: 0, wingletDeg: 0, elevatorDeg: 0, ...over },
    clip: null,
    ...extra,
  };
}

/** 표시용 삼각형의 넓이 합 */
function meshArea(g: PlaneGeometry): number {
  const p = g.mesh.positions;
  let s = 0;
  for (let i = 0; i < p.length; i += 9) {
    const ux = p[i + 3]! - p[i]!, uy = p[i + 4]! - p[i + 1]!, uz = p[i + 5]! - p[i + 2]!;
    const vx = p[i + 6]! - p[i]!, vy = p[i + 7]! - p[i + 1]!, vz = p[i + 8]! - p[i + 2]!;
    s += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return s;
}

/** 형상 전체가 유한한 값이고 약속을 지키는지 확인한다. */
function expectSane(g: PlaneGeometry, label: string): void {
  const nums: number[] = [g.massKg, g.cg.x, g.cg.y, g.cg.z, ...g.inertia, ...Object.values(g.stats)];
  for (const e of g.elements) {
    nums.push(e.le.x, e.le.y, e.le.z, e.chordDir.x, e.chordDir.y, e.chordDir.z, e.chord, e.width, e.area,
      e.normal.x, e.normal.y, e.normal.z, e.surfaceAR, e.flapRad, e.layers);
  }
  for (const v of nums) expect(Number.isFinite(v), `${label}: 유한하지 않은 값`).toBe(true);
  for (const v of g.mesh.positions) expect(Number.isFinite(v), `${label}: mesh`).toBe(true);

  expect(g.massKg).toBeGreaterThan(0);
  expect(g.elements.length, label).toBeGreaterThan(0);
  // 관성: 대각 성분은 양수, 삼각 부등식(얇은 판이라 등호에 가깝다)
  const [ixx, iyy, izz] = g.inertia;
  expect(ixx).toBeGreaterThan(0);
  expect(iyy).toBeGreaterThan(0);
  expect(izz).toBeGreaterThan(0);
  expect(ixx + iyy).toBeGreaterThanOrEqual(izz * (1 - 1e-9) - 1e-15);
  expect(iyy + izz).toBeGreaterThanOrEqual(ixx * (1 - 1e-9) - 1e-15);
  expect(ixx + izz).toBeGreaterThanOrEqual(iyy * (1 - 1e-9) - 1e-15);

  for (const e of g.elements) {
    expect(e.area).toBeGreaterThan(0);
    expect(e.chord).toBeGreaterThan(0);
    expect(e.width).toBeGreaterThan(0);
    expect(e.area).toBeCloseTo(e.chord * e.width, 12);
    expect(Math.hypot(e.normal.x, e.normal.y, e.normal.z)).toBeCloseTo(1, 12);
    expect(Math.hypot(e.chordDir.x, e.chordDir.y, e.chordDir.z)).toBeCloseTo(1, 12);
    expect(e.le.x).toBeLessThanOrEqual(1e-9);
    expect(e.layers).toBeGreaterThanOrEqual(1 - 1e-9);
    expect(e.surfaceAR).toBeGreaterThan(0);
    if (e.kind === 'keel') {
      expect(e.side).toBe('C');
      expect(e.normal).toEqual({ x: 0, y: 1, z: 0 });
      expect(e.flapRad).toBe(0);
    } else {
      // 날개 띠는 자기 쪽에 있다. (날개 끝은 아래로 90도 넘게 꺾이면 안쪽으로 들어올 수 있어 제외)
      if (e.kind === 'wing') expect(e.side === 'L' ? e.le.y >= -1e-9 : e.le.y <= 1e-9).toBe(true);
      expect(e.side).not.toBe('C');
    }
  }
  const s = g.stats;
  expect(s.wingAreaM2).toBeGreaterThan(0);
  expect(s.spanM).toBeGreaterThan(0);
  expect(s.macM).toBeGreaterThan(0);
  expect(s.lengthM).toBeGreaterThan(0);
  expect(s.aspectRatio).toBeGreaterThan(0);
  expect(s.maxLayers).toBeGreaterThanOrEqual(1);
  expect(Math.abs(s.asymmetry)).toBeLessThanOrEqual(1 + 1e-9);
  expect(s.cgFracLength).toBeGreaterThanOrEqual(-1e-9);
  expect(s.cgFracLength).toBeLessThanOrEqual(1 + 1e-9);
  // 모든 점은 x <= 0 (원점이 가장 앞 점)
  expect(g.mesh.positions.length).toBe(g.mesh.layers.length * 9);
  for (let i = 0; i < g.mesh.positions.length; i += 3) expect(g.mesh.positions[i]!).toBeLessThanOrEqual(1e-9);
  for (const n of g.mesh.layers) expect(n).toBeGreaterThanOrEqual(1);
}

describe('무게', () => {
  it('A4 80g 지는 4.99 g 이다', () => {
    const g = buildGeometry(flatDesign());
    expect(g.massKg * 1000).toBeCloseTo(4.99, 2);
    expect(g.massKg).toBeCloseTo(0.21 * 0.297 * 0.08, 12);
  });

  it('접어도 무게는 변하지 않고 클립만 무게를 더한다', () => {
    for (const p of PRESETS) {
      const g = buildGeometry(p.design);
      expect(g.massKg, p.id).toBeCloseTo(W * H * 0.08, 12);
      const withClip = buildGeometry({ ...p.design, clip: { xBodyM: 0 } });
      expect(withClip.massKg).toBeCloseTo(g.massKg + LIMITS.clipMassKg, 12);
    }
  });

  it('표시용 삼각형의 넓이 합은 종이 넓이와 같다', () => {
    for (const p of PRESETS) expect(meshArea(buildGeometry(p.design)), p.id).toBeCloseTo(W * H, 7);
  });
});

describe('접지 않은 평평한 종이', () => {
  it('동체 없이도 올바른 형상이 나온다', () => {
    const g = buildGeometry(flatDesign());
    expectSane(g, 'flat');
    const s = g.stats;
    expect(s.wingAreaM2).toBeCloseTo(W * H, 9);
    expect(s.spanM).toBeCloseTo(W, 9);
    expect(s.aspectRatio).toBeCloseTo(W / H, 6);
    expect(s.macM).toBeCloseTo(H, 9);
    expect(s.macLeX).toBeCloseTo(0, 9);
    expect(s.lengthM).toBeCloseTo(H, 12);
    expect(s.keelAreaM2).toBe(0);
    expect(s.maxLayers).toBe(1);
    expect(s.asymmetry).toBeCloseTo(0, 12);
    expect(s.cgFracLength).toBeCloseTo(0.5, 9);
    expect(s.cgFracMac).toBeCloseTo(0.5, 9);
    expect(s.wingLoadingNm2).toBeCloseTo((g.massKg * 9.80665) / (W * H), 6);
    expect(g.cg.x).toBeCloseTo(-H / 2, 9);
    expect(g.cg.y).toBeCloseTo(0, 12);
    expect(g.cg.z).toBeCloseTo(0, 12);
    // 직사각형 판의 관성: m w^2 / 12, m h^2 / 12
    expect(g.inertia[0]).toBeCloseTo((g.massKg * W * W) / 12, 12);
    expect(g.inertia[1]).toBeCloseTo((g.massKg * H * H) / 12, 12);
    expect(g.inertia[2]).toBeCloseTo((g.massKg * (W * W + H * H)) / 12, 12);
    expect(g.inertia[3]).toBeCloseTo(0, 14);
    expect(g.inertia[4]).toBeCloseTo(0, 14);
    expect(g.inertia[5]).toBeCloseTo(0, 14);
    // 날개 띠만 있고, 좌우 10개씩
    expect(g.elements.every((e) => e.kind === 'wing')).toBe(true);
    expect(g.elements.filter((e) => e.side === 'L').length).toBe(10);
    expect(g.elements.filter((e) => e.side === 'R').length).toBe(10);
    for (const e of g.elements) {
      expect(e.chord).toBeCloseTo(H, 9);
      expect(e.normal.z).toBeCloseTo(1, 12);
      expect(e.chordDir).toEqual({ x: -1, y: 0, z: 0 });
      expect(e.layers).toBeCloseTo(1, 9);
      expect(e.surfaceAR).toBeCloseTo(W / H, 6);
    }
    // 강성: 한 겹 = E t^3 / 12
    const paper = getPaper('copy80')!;
    expect(s.wingBendStiffnessNm).toBeCloseTo((paper.youngsModulusPa * paper.thicknessM ** 3) / 12, 12);
  });

  it('동체 깊이를 주면 동체 띠가 생기고 날개가 그만큼 좁아진다', () => {
    const g = buildGeometry(flatDesign({ keelM: 0.02 }));
    expectSane(g, 'flat+keel');
    const keel = g.elements.filter((e) => e.kind === 'keel');
    expect(keel.length).toBe(4);
    expect(g.stats.keelAreaM2).toBeCloseTo(0.02 * H, 9);
    for (const e of keel) {
      expect(e.layers).toBeCloseTo(2, 9); // 좌우 두 장이 맞붙는다
      expect(e.le.z).toBeLessThan(0);
      expect(e.le.z).toBeGreaterThan(-0.02);
      expect(e.surfaceAR).toBeCloseTo((2 * 0.02 * 0.02) / (0.02 * H), 6);
    }
    expect(g.stats.wingAreaM2).toBeCloseTo((W - 0.04) * H, 9);
    expect(g.stats.spanM).toBeCloseTo(W - 0.04, 9);
    expect(g.cg.z).toBeLessThan(0); // 동체가 아래에 있으므로
    expect(g.stats.maxLayers).toBe(2);
  });

  it('상반각, 날개 끝, 뒷전 꺾기가 띠에 반영된다', () => {
    const g = buildGeometry(flatDesign({ keelM: 0.02, dihedralDeg: 20, wingletM: 0.02, wingletDeg: 70, elevatorDeg: 10 }));
    expectSane(g, 'shaped');
    const rad = Math.PI / 180;
    const wl = g.elements.filter((e) => e.kind === 'winglet');
    expect(wl.length).toBe(4);
    for (const e of g.elements) {
      if (e.kind === 'wing') {
        expect(e.flapRad).toBeCloseTo(10 * rad, 12);
        expect(e.normal.z).toBeCloseTo(Math.cos(20 * rad), 12);
        expect(e.normal.y).toBeCloseTo((e.side === 'L' ? -1 : 1) * Math.sin(20 * rad), 12);
        expect(e.le.z).toBeGreaterThan(0);
      } else {
        expect(e.flapRad).toBe(0);
      }
      if (e.kind === 'winglet') {
        expect(e.normal.z).toBeCloseTo(Math.cos(90 * rad), 12);
        expect(Math.abs(e.normal.y)).toBeCloseTo(1, 12);
      }
    }
    // 투영 면적 = 날개 * cos(20) + 날개 끝 * cos(90)
    const wingTrue = (W - 0.04 - 0.04) * H;
    expect(g.stats.wingAreaM2).toBeCloseTo(wingTrue * Math.cos(20 * rad), 9);
    expect(g.stats.spanM).toBeCloseTo((W - 0.08) * Math.cos(20 * rad), 9);
    expect(g.cg.y).toBeCloseTo(0, 12);
    // 상반각이 있으면 날개가 올라가 무게중심도 올라간다.
    const flat = buildGeometry(flatDesign({ keelM: 0.02 }));
    expect(g.cg.z).toBeGreaterThan(flat.cg.z);
  });

  it('전부 동체로 접혀 날개가 없어도 유한한 값만 나온다', () => {
    const g = buildGeometry(flatDesign({ keelM: W / 2 }));
    expectSane(g, 'all keel');
    expect(g.elements.every((e) => e.kind === 'keel')).toBe(true);
    expect(g.stats.wingAreaM2).toBeLessThan(1e-5);
    expect(g.stats.keelAreaM2).toBeCloseTo((W / 2) * H, 9);
    expect(Number.isFinite(g.stats.wingLoadingNm2)).toBe(true);
    expect(g.stats.asymmetry).toBe(0);
  });

  it('잘못된 설계가 들어와도 예외 없이 유한한 값을 낸다', () => {
    const bad: unknown[] = [
      null, undefined, 3, 'x', [], {},
      { v: 1, paperId: 'nope', folds: 'x', shaping: null, clip: 5 },
      flatDesign({ keelM: NaN, dihedralDeg: Infinity, wingletM: -1, wingletDeg: NaN, elevatorDeg: -Infinity }),
      flatDesign({ keelM: 99, wingletM: 99, wingletDeg: 45 }),
      flatDesign({}, { clip: { xBodyM: NaN } }),
      flatDesign({}, { clip: { xBodyM: -99 } }),
      flatDesign({}, { folds: [null, { a: 1 }, { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, dir: 'valley' }] as never }),
    ];
    for (const d of bad) {
      const g = buildGeometry(d as PlaneDesign);
      expectSane(g, JSON.stringify(d) ?? 'undefined');
    }
  });
});

describe('대칭과 비대칭', () => {
  const top = H / 2;
  const left = { a: { x: -W / 2, y: top - W / 2 }, b: { x: 0, y: top }, dir: 'valley' as const };
  const right = { a: { x: 0, y: top }, b: { x: W / 2, y: top - W / 2 }, dir: 'valley' as const };

  it('좌우 대칭으로 접으면 비대칭 0, 무게중심 y 는 0', () => {
    const g = buildGeometry(flatDesign({ keelM: 0.02, dihedralDeg: 10 }, { folds: [left, right] }));
    expectSane(g, 'sym');
    expect(Math.abs(g.stats.asymmetry)).toBeLessThan(1e-9);
    expect(Math.abs(g.cg.y)).toBeLessThan(1e-9);
    expect(Math.abs(g.inertia[3])).toBeLessThan(1e-12);
    expect(Math.abs(g.inertia[5])).toBeLessThan(1e-12);
    // 좌우 띠가 거울상이다.
    const L = g.elements.filter((e) => e.side === 'L');
    const R = g.elements.filter((e) => e.side === 'R');
    expect(L.length).toBe(R.length);
    L.forEach((e, i) => {
      expect(e.area).toBeCloseTo(R[i]!.area, 12);
      expect(e.le.y).toBeCloseTo(-R[i]!.le.y, 12);
      expect(e.le.x).toBeCloseTo(R[i]!.le.x, 12);
    });
  });

  it('한쪽만 접으면 비대칭이 0 이 아니고 무게중심이 한쪽으로 간다', () => {
    // 왼쪽 모서리만 접으면 왼쪽(+y) 날개 면적이 줄어든다.
    const g = buildGeometry(flatDesign({ keelM: 0.02 }, { folds: [left] }));
    expectSane(g, 'asym');
    expect(g.stats.asymmetry).toBeLessThan(-0.01);
    expect(Math.abs(g.cg.y)).toBeGreaterThan(1e-4);
    // 종이를 세로로 반 접으면 한쪽 날개만 남는다.
    const half = buildGeometry(flatDesign({ keelM: 0.01 }, { folds: [{ a: { x: 0, y: -1 }, b: { x: 0, y: 1 }, dir: 'valley' }] }));
    expectSane(half, 'half');
    expect(half.stats.asymmetry).toBeCloseTo(-1, 9);
    expect(half.elements.some((e) => e.side === 'L')).toBe(false);
  });
});

describe('프리셋', () => {
  it('5개 이상이고 모두 검사를 통과하며 올바른 형상을 낸다', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(validateDesign(p.design), p.id).toEqual({ ok: true, errors: [] });
      expect(p.nameKo.length).toBeGreaterThan(0);
      expect(p.descriptionKo.length).toBeGreaterThan(0);
      expect([1, 2, 3]).toContain(p.difficulty);
      expect(p.design.folds.length).toBeGreaterThan(0);
      expect(p.design.folds.length).toBeLessThanOrEqual(LIMITS.maxFolds);
      const g = buildGeometry(p.design);
      expectSane(g, p.id);
      const s = g.stats;
      expect(Math.abs(s.asymmetry), p.id).toBeLessThan(1e-9);
      expect(Math.abs(g.cg.y), p.id).toBeLessThan(1e-9);
      expect(s.wingAreaM2).toBeGreaterThan(0.01);
      expect(s.wingAreaM2).toBeLessThan(W * H);
      expect(s.keelAreaM2).toBeGreaterThan(0);
      expect(s.maxLayers).toBeGreaterThan(1);
      expect(g.elements.some((e) => e.kind === 'keel')).toBe(true);
      const wingsL = g.elements.filter((e) => e.kind === 'wing' && e.side === 'L').length;
      expect(wingsL).toBeGreaterThanOrEqual(8);
      expect(wingsL).toBeLessThanOrEqual(12);
      // 접힌 날개 뿌리는 한 겹보다 뻣뻣하다(또는 같다).
      const paper = getPaper(p.design.paperId)!;
      expect(s.wingBendStiffnessNm).toBeGreaterThanOrEqual((paper.youngsModulusPa * paper.thicknessM ** 3) / 12 * (1 - 1e-9));
    }
  });

  it('조절값 정보가 있고 기본값이 범위 안이다', () => {
    for (const p of PRESETS) {
      const meta = getPresetParamMeta(p.id);
      expect(meta).toEqual(p.paramMeta);
      expect(PRESET_PARAM_META[p.id]).toEqual(meta);
      expect(p.params).toEqual(defaultPresetParams(p.id));
      for (const m of meta) {
        expect(m.labelKo.length).toBeGreaterThan(0);
        expect(m.min).toBeLessThan(m.max);
        expect(m.step).toBeGreaterThan(0);
        expect(m.default).toBeGreaterThanOrEqual(m.min);
        expect(m.default).toBeLessThanOrEqual(m.max);
        expect(p.params[m.key]).toBe(m.default);
      }
      for (const key of ['keelM', 'dihedralDeg', 'wingletM', 'wingletDeg', 'elevatorDeg']) {
        expect(meta.some((m) => m.key === key), `${p.id}.${key}`).toBe(true);
      }
      expect(buildPresetDesign(p.id, p.params)).toEqual(p.design);
    }
  });

  it('조절값의 모든 끝값 조합과 엉뚱한 값에서도 검사를 통과하는 설계가 나온다', () => {
    for (const p of PRESETS) {
      const meta = p.paramMeta;
      // 각 조절값을 최소/최대로 (2^n 조합)
      for (let mask = 0; mask < 1 << meta.length; mask++) {
        const params: Record<string, number> = {};
        meta.forEach((m, i) => { params[m.key] = mask & (1 << i) ? m.max : m.min; });
        const d = buildPresetDesign(p.id, params, 'kent160');
        const v = validateDesign(d);
        expect(v.ok, `${p.id} ${JSON.stringify(params)} ${v.errors.join(' ')}`).toBe(true);
        if (mask % 7 === 0) expectSane(buildGeometry(d), `${p.id} ${mask}`);
      }
      const weird = buildPresetDesign(p.id, { keelM: NaN, noseFolds: 1e9, wingletM: -5, dihedralDeg: Infinity, zzz: 3 });
      expect(validateDesign(weird).ok).toBe(true);
    }
    // 모르는 프리셋, 모르는 종이는 기본값으로
    const d = buildPresetDesign('없는것', undefined, '없는종이');
    expect(validateDesign(d).ok).toBe(true);
    expect(d.paperId).toBe('copy80');
    expect(d.folds).toEqual(PRESETS[0]!.design.folds);
  });

  it('조절값이 실제로 형상을 바꾼다', () => {
    const base = buildGeometry(buildPresetDesign('dart'));
    const deepKeel = buildGeometry(buildPresetDesign('dart', { keelM: 0.04 }));
    expect(deepKeel.stats.wingAreaM2).toBeLessThan(base.stats.wingAreaM2);
    expect(deepKeel.stats.keelAreaM2).toBeGreaterThan(base.stats.keelAreaM2);
    const dihedral = buildGeometry(buildPresetDesign('dart', { dihedralDeg: 30 }));
    expect(dihedral.stats.spanM).toBeLessThan(base.stats.spanM);
    const winglet = buildGeometry(buildPresetDesign('dart', { wingletM: 0.02, wingletDeg: 80 }));
    expect(winglet.elements.some((e) => e.kind === 'winglet')).toBe(true);
    expect(base.elements.some((e) => e.kind === 'winglet')).toBe(false);
    const elev = buildGeometry(buildPresetDesign('dart', { elevatorDeg: 12 }));
    expect(elev.elements.find((e) => e.kind === 'wing')!.flapRad).toBeCloseTo((12 * Math.PI) / 180, 12);
  });

  it('기본 다트: 무게중심이 날개 평면 도형의 중심보다 앞에 있다', () => {
    const g = buildGeometry(PRESETS.find((p) => p.id === 'dart')!.design);
    // 평면 도형(날개 + 동체 폭)의 넓이 중심 x. 다트는 뒤가 넓은 삼각형이라 중심이 뒤쪽에 있다.
    let sa = 0, sx = 0;
    for (const e of g.elements) {
      if (e.kind !== 'wing') continue;
      sa += e.area;
      sx += e.area * (e.le.x - e.chord / 2);
    }
    const centroidX = sx / sa;
    expect(g.cg.x).toBeGreaterThan(centroidX + 0.02);
    // 평균 공력 시위 기준으로는 앞쪽 1/4 부근(앞이 무거운 안정적인 배치)
    expect(g.stats.cgFracMac).toBeGreaterThan(0);
    expect(g.stats.cgFracMac).toBeLessThan(0.3);
    // 참고: 모서리를 접는 것은 종이를 "뒤로" 옮기는 접기라서, 길이 기준 무게중심은 한가운데보다 조금 뒤(약 54%)다.
    // 다트가 안정적인 이유는 무게중심이 길이의 앞쪽이라서가 아니라 날개 면적이 훨씬 더 뒤에 있기 때문이다.
    expect(g.stats.cgFracLength).toBeGreaterThan(0.5);
    expect(g.stats.cgFracLength).toBeLessThan(0.58);
    expect((centroidX / -g.stats.lengthM)).toBeGreaterThan(0.6);
  });

  it('앞쪽을 많이 접을수록 무게중심이 앞으로 간다(글라이더형)', () => {
    let prevFrac = Infinity;
    let prevDist = Infinity;
    let prevLayers = 0;
    for (let n = 1; n <= 6; n++) {
      const g = buildGeometry(buildPresetDesign('glider', { noseFolds: n }));
      expect(g.stats.cgFracLength, `n=${n}`).toBeLessThan(prevFrac);
      expect(-g.cg.x, `n=${n}`).toBeLessThan(prevDist); // 기수에서 무게중심까지의 거리도 줄어든다
      expect(g.stats.maxLayers).toBeGreaterThan(prevLayers);
      prevFrac = g.stats.cgFracLength;
      prevDist = -g.cg.x;
      prevLayers = g.stats.maxLayers;
    }
    expect(prevFrac).toBeLessThan(0.5);
    // 손으로 계산한 값과 비교: 폭 d 로 n 번 말면 앞 d 구간이 n+1 겹.
    const n = 3, d = 0.02;
    const g = buildGeometry(buildPresetDesign('glider', { noseFolds: n, noseDepthM: d, keelM: 0.008, dihedralDeg: 0, wingletM: 0 }));
    const expected = ((n + 1) * d * (d / 2) + (H - (n + 1) * d) * (d + (H - (n + 1) * d) / 2)) / H;
    expect(-g.cg.x).toBeCloseTo(expected, 9);
    expect(g.stats.lengthM).toBeCloseTo(H - n * d, 9);
  });

  it('기수에 클립을 끼우면 무게중심이 앞으로 간다', () => {
    for (const p of PRESETS) {
      const base = buildGeometry(p.design);
      const nose = buildGeometry({ ...p.design, clip: { xBodyM: 0 } });
      const tail = buildGeometry({ ...p.design, clip: { xBodyM: -base.stats.lengthM } });
      // 이동량은 |cg.x| * 클립 무게 / 전체 무게. 기수를 많이 말아 접은 델타는 무게중심이 기수에서 약 2.9 cm 라 2.7 mm 쯤 움직인다.
      expect(nose.cg.x, p.id).toBeGreaterThan(base.cg.x + 0.002);
      expect(tail.cg.x, p.id).toBeLessThan(base.cg.x - 0.003);
      // 점 질량 합성 공식과 일치
      const expected = (base.cg.x * base.massKg + 0 * LIMITS.clipMassKg) / (base.massKg + LIMITS.clipMassKg);
      expect(nose.cg.x).toBeCloseTo(expected, 12);
      expect(nose.stats.cgFracMac).toBeLessThan(base.stats.cgFracMac);
      expect(nose.stats.wingLoadingNm2).toBeGreaterThan(base.stats.wingLoadingNm2);
      expect(nose.elements).toEqual(base.elements);
    }
  });

  it('종이를 바꾸면 무게와 강성은 바뀌지만 모양은 그대로다', () => {
    for (const p of PRESETS) {
      const base = buildGeometry(buildPresetDesign(p.id, undefined, 'copy80'));
      for (const paper of PAPERS) {
        const g = buildGeometry(buildPresetDesign(p.id, undefined, paper.id));
        expect(g.massKg).toBeCloseTo((W * H * paper.gsm) / 1000, 12);
        expect(g.elements).toEqual(base.elements);
        expect(g.stats.wingAreaM2).toBe(base.stats.wingAreaM2);
        expect(g.stats.spanM).toBe(base.stats.spanM);
        expect(g.stats.macM).toBe(base.stats.macM);
        expect(g.stats.maxLayers).toBe(base.stats.maxLayers);
        expect(g.cg.x).toBeCloseTo(base.cg.x, 12);
        expect(g.cg.z).toBeCloseTo(base.cg.z, 12);
        expect(g.stats.cgFracMac).toBeCloseTo(base.stats.cgFracMac, 10);
        // 관성은 무게에 비례
        expect(g.inertia[1] / base.inertia[1]).toBeCloseTo(paper.gsm / 80, 9);
        // 강성은 E t^3 에 비례
        const ratio = (paper.youngsModulusPa * paper.thicknessM ** 3) / (3.5e9 * 100e-6 ** 3);
        expect(g.stats.wingBendStiffnessNm / base.stats.wingBendStiffnessNm).toBeCloseTo(ratio, 9);
      }
      const light = buildGeometry(buildPresetDesign(p.id, undefined, 'newsprint'));
      const heavy = buildGeometry(buildPresetDesign(p.id, undefined, 'kent160'));
      expect(heavy.massKg).toBeGreaterThan(light.massKg * 3);
      expect(heavy.stats.wingBendStiffnessNm).toBeGreaterThan(light.stats.wingBendStiffnessNm * 10);
      expect(heavy.stats.wingLoadingNm2).toBeGreaterThan(light.stats.wingLoadingNm2 * 3);
    }
  });
});

describe('임의 자유접기', () => {
  it('수백 개의 임의 설계가 모두 유한하고 올바른 형상을 낸다', () => {
    const rnd = makeLcg(20261113);
    let asymmetric = 0;
    for (let i = 0; i < 400; i++) {
      const d = randomDesign(rnd);
      expect(validateDesign(d).ok).toBe(true);
      const g = buildGeometry(d);
      expectSane(g, `random #${i}`);
      const paper = getPaper(d.paperId)!;
      expect(g.massKg).toBeCloseTo((W * H * paper.gsm) / 1000 + (d.clip ? LIMITS.clipMassKg : 0), 12);
      if (Math.abs(g.stats.asymmetry) > 1e-6) asymmetric++;
      if (i % 20 === 0) expect(meshArea(g)).toBeCloseTo(W * H, 7);
      // 같은 입력이면 같은 결과
      if (i % 50 === 0) expect(buildGeometry(d)).toEqual(g);
    }
    expect(asymmetric).toBeGreaterThan(200);
  });

  it('접기 한도(24번)까지 꽉 채워도 빠르게 끝난다', () => {
    const rnd = makeLcg(77);
    for (let i = 0; i < 5; i++) {
      const d = randomDesign(rnd, 0);
      // 가운데 근처를 지나는 선으로 24번
      d.folds = Array.from({ length: 24 }, (_, k) => {
        const ang = rnd() * Math.PI;
        const c = { x: (rnd() - 0.5) * 0.02, y: (rnd() - 0.5) * 0.02 };
        return {
          a: { x: c.x - 0.1 * Math.cos(ang), y: c.y - 0.1 * Math.sin(ang) },
          b: { x: c.x + 0.1 * Math.cos(ang), y: c.y + 0.1 * Math.sin(ang) },
          dir: k % 2 ? 'valley' as const : 'mountain' as const,
        };
      });
      expect(validateDesign(d).ok).toBe(true);
      expectSane(buildGeometry(d), `stress #${i}`);
    }
  });
});
