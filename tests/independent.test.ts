/**
 * 독립 검증(리뷰어 작성). 기존 시험을 베끼지 않고 공개 창구(src/core/index.ts)만으로 물리의 정직성을 확인한다.
 * 예외: 높은 곳에서 놓는 긴 활공, 에너지(회전 포함), 시간 간격 수렴은 공개 창구로 할 수 없어
 *       내부 함수 runFlight 의 시험용 옵션(launchHeightM, dtS)을 쓴다. 해당 시험에 표시해 두었다.
 *
 * it.fails 로 표시한 시험은 "요구 기준을 지금 구현이 만족하지 못함"을 기록한 것이다(계수를 고치면 통과로 바뀌어 알려 준다).
 *
 * [물리 2판에서 고친 내용] 리뷰어가 it.fails 로 남긴 네 가지(다트와 하이브리드의 제곱근 비례, 다트 활공비 3,
 * 글라이더의 종이 선택 역전)는 모델을 고쳐 모두 보통 시험(it)으로 바꿨다. 남은 it.fails 는 없다.
 * 던지기 한도가 16 -> 10 m/s 로 바뀌어, 16 m/s 를 쓰던 시험은 10 m/s 로 바꾸고 그 자리에 표시해 두었다.
 * 단언을 약하게 만든 곳은 없고, 퍼즈의 "터무니없는 기록" 한계는 40 m / 20 초에서 25 m / 9 초로 오히려 조였다.
 */
import { describe, expect, it } from 'vitest';
import {
  LIMITS, PAPERS, PRESETS, analyze, buildGeometry, decodeDesign, encodeDesign, evaluate, getPaper,
  validateDesign, validateThrow,
  type FoldOp, type PlaneDesign, type ThrowInput,
} from '../src/core/index';
// 내부 함수(시험용 옵션만 사용)
import { runFlight } from '../src/core/sim/integrator';

const DEG = Math.PI / 180;
const RHO = 1.225;
const G = 9.81;
const LONG = 600_000;

const preset = (id: string): PlaneDesign => {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`preset ${id} 없음`);
  return JSON.parse(JSON.stringify(p.design)) as PlaneDesign;
};
const th = (speedMps: number, pitchDeg = 0, rollDeg = 0): ThrowInput => ({ speedMps, pitchDeg, rollDeg });
const withShaping = (d: PlaneDesign, s: Partial<PlaneDesign['shaping']>): PlaneDesign => ({ ...d, shaping: { ...d.shaping, ...s } });

/** 리뷰어 전용 유사 난수(기존 helpers 와 다른 상수) */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}

function nonFinitePaths(o: unknown, path: string, out: string[]): void {
  if (out.length > 5) return;
  if (typeof o === 'number') {
    if (!Number.isFinite(o)) out.push(path);
  } else if (Array.isArray(o)) {
    for (let i = 0; i < o.length; i++) nonFinitePaths(o[i], `${path}[${i}]`, out);
  } else if (o !== null && typeof o === 'object') {
    for (const k of Object.keys(o)) nonFinitePaths((o as Record<string, unknown>)[k], `${path}.${k}`, out);
  }
}

// ---------------------------------------------------------------------------
// B1. 무게
// ---------------------------------------------------------------------------
describe('B1 무게', () => {
  it('A4 80 g 지는 4.99 g', () => {
    const p = getPaper('copy80')!;
    expect(p.widthM * p.heightM * p.gsm).toBeCloseTo(4.9896, 4);
    const flat: PlaneDesign = { v: 1, paperId: 'copy80', folds: [], shaping: { keelM: 0, dihedralDeg: 0, wingletM: 0, wingletDeg: 0, elevatorDeg: 0 }, clip: null };
    expect(buildGeometry(flat).massKg * 1000).toBeCloseTo(4.9896, 6);
  });

  it('접어도 무게는 변하지 않고, 클립은 정확히 clipMassKg 만 더한다', () => {
    const rnd = lcg(7);
    for (const paper of PAPERS) {
      const sheet = paper.widthM * paper.heightM * paper.gsm / 1000;
      for (const p of PRESETS) {
        const d = { ...preset(p.id), paperId: paper.id };
        expect(buildGeometry(d).massKg).toBeCloseTo(sheet, 12);
        const clipped = buildGeometry({ ...d, clip: { xBodyM: -0.05 } }).massKg;
        expect(clipped - sheet).toBeCloseTo(LIMITS.clipMassKg, 12);
      }
      // 임의 자유접기(겹이 많아져도)
      for (let i = 0; i < 40; i++) {
        const d = randomDesign(rnd);
        d.paperId = paper.id;
        d.clip = null;
        expect(buildGeometry(d).massKg, encodeDesign(d)).toBeCloseTo(sheet, 12);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// B2/B3. 안정 활공: 제1원리 교차 확인 + 실측 범위
// ---------------------------------------------------------------------------
interface Glide { v: number; gammaDeg: number; alphaDeg: number; pathRatio: number; speedSd: number }

/** 높은 곳(내부 옵션)에서 놓아 뒤쪽 구간의 정상 활공 값을 잰다. */
function steadyGlide(d: PlaneDesign, heightM = 40): Glide {
  const g = buildGeometry(d);
  const a = analyze(g);
  const v0 = a.trimSpeedMps ?? 5;
  const f = runFlight(g, th(v0, 0, 0), undefined, { launchHeightM: heightM });
  const n = f.samples.length;
  const seg = f.samples.slice(Math.floor(n * 0.6), Math.floor(n * 0.97));
  const A = seg[0]!, B = seg[seg.length - 1]!;
  const mean = (fn: (i: number) => number): number => { let s = 0; for (let i = 0; i < seg.length; i++) s += fn(i); return s / seg.length; };
  const v = mean((i) => seg[i]!.speed);
  // 경로각은 속도 벡터에서(표본 위치의 차분이 아니라 적분기가 가진 속도)
  const gamma = mean((i) => Math.atan2(-seg[i]!.vel.z, Math.hypot(seg[i]!.vel.x, seg[i]!.vel.y)));
  const alpha = mean((i) => seg[i]!.alphaDeg);
  const sd = Math.sqrt(mean((i) => (seg[i]!.speed - v) ** 2));
  const pathRatio = Math.hypot(B.pos.x - A.pos.x, B.pos.y - A.pos.y) / (A.pos.z - B.pos.z);
  return { v, gammaDeg: gamma / DEG, alphaDeg: alpha, pathRatio, speedSd: sd };
}

/** 분석 화면의 곡선(공개 값)에서 받음각으로 계수를 읽는다(직선 보간). */
function polarAt(d: PlaneDesign, alphaDeg: number): { cl: number; cd: number } {
  const polar = analyze(buildGeometry(d)).polar;
  for (let i = 0; i + 1 < polar.length; i++) {
    const p0 = polar[i]!, p1 = polar[i + 1]!;
    if (alphaDeg >= p0.alphaDeg && alphaDeg <= p1.alphaDeg) {
      const t = (alphaDeg - p0.alphaDeg) / (p1.alphaDeg - p0.alphaDeg);
      return { cl: p0.cl + t * (p1.cl - p0.cl), cd: p0.cd + t * (p1.cd - p0.cd) };
    }
  }
  throw new Error('받음각이 곡선 범위 밖');
}

describe('B2 안정 활공 제1원리 교차 확인 (내부 runFlight 의 launchHeightM 사용)', () => {
  for (const p of PRESETS) {
    it(`${p.id}: 양력 = 무게·cos(활공각), 항력 = 무게·sin(활공각), 활공비 = 1/tan(활공각) = 거리/하강`, () => {
      const d = preset(p.id);
      const g = buildGeometry(d);
      const gl = steadyGlide(d);
      const W = g.massKg * G;
      const S = g.stats.wingAreaM2;
      const c = polarAt(d, gl.alphaDeg);
      const q = 0.5 * RHO * gl.v * gl.v;
      const lift = q * S * c.cl;
      const drag = q * S * c.cd;
      // 정상 상태인지(속도 흔들림 1% 미만)
      expect(gl.speedSd / gl.v).toBeLessThan(0.01);
      expect(lift / (W * Math.cos(gl.gammaDeg * DEG))).toBeGreaterThan(0.97);
      expect(lift / (W * Math.cos(gl.gammaDeg * DEG))).toBeLessThan(1.03);
      expect(drag / (W * Math.sin(gl.gammaDeg * DEG))).toBeGreaterThan(0.95);
      expect(drag / (W * Math.sin(gl.gammaDeg * DEG))).toBeLessThan(1.05);
      const ratioFromAngle = 1 / Math.tan(gl.gammaDeg * DEG);
      expect(gl.pathRatio / ratioFromAngle).toBeGreaterThan(0.98);
      expect(gl.pathRatio / ratioFromAngle).toBeLessThan(1.02);
      // 분석 화면이 보여 주는 값과 실제 비행이 같다
      const a = analyze(g);
      expect(gl.v / a.trimSpeedMps!).toBeGreaterThan(0.97);
      expect(gl.v / a.trimSpeedMps!).toBeLessThan(1.03);
      expect(Math.abs(gl.alphaDeg - a.trimAlphaDeg!)).toBeLessThan(0.3);
      expect(gl.pathRatio / a.glideRatio!).toBeGreaterThan(0.97);
      expect(gl.pathRatio / a.glideRatio!).toBeLessThan(1.03);
      // 날개 하중 표시값도 같은 무게와 면적에서 나온다
      expect(g.stats.wingLoadingNm2 / (W / S)).toBeGreaterThan(0.995);
      expect(g.stats.wingLoadingNm2 / (W / S)).toBeLessThan(1.005);
    }, LONG);
  }

  /** 같은 형상에서 종이만 바꿨을 때 속도/sqrt(무게) 의 최대/최소 비 */
  const speedScalingSpread = (id: string): number => {
    const ks: number[] = [];
    for (const paper of PAPERS) {
      const g = buildGeometry({ ...preset(id), paperId: paper.id });
      const a = analyze(g);
      expect(a.trimSpeedMps, `${id}/${paper.id}`).not.toBeNull();
      ks.push(a.trimSpeedMps! / Math.sqrt(g.massKg));
    }
    return Math.max(...ks) / Math.min(...ks);
  };

  for (const id of ['glider', 'delta', 'stealth']) {
    it(`${id}: 같은 형상이면 활공 속도가 무게의 제곱근에 비례한다(10% 이내)`, () => {
      expect(speedScalingSpread(id)).toBeLessThan(1.10);
    });
  }
  // [물리 2판에서 해결] 예전에는 종이 휨 모델이 1 g 활공의 안정 받음각까지 바꿔 다트 1.30배, 하이브리드 1.19배였다.
  // 뿌리가 길게 붙은 판 모양 날개는 휘어도 비틀리지 않는다는 점을 반영하고 접은 종이의 강성을 다시 잡아,
  // 지금은 다트 약 1.04배, 하이브리드 약 1.03배다. it.fails 를 보통 시험으로 바꿨다.
  for (const id of ['dart', 'hybrid']) {
    it(`${id}: 활공 속도가 무게의 제곱근에 비례한다(10% 이내)`, () => {
      expect(speedScalingSpread(id)).toBeLessThan(1.10);
    });
  }
  it('1 g 활공에서 일반 복사지 날개 끝의 휨은 몇 도뿐이고, 같은 형상의 안정 받음각은 종이에 따라 1.5도 넘게 달라지지 않는다', () => {
    for (const p of PRESETS) {
      const alphas: number[] = [];
      for (const paper of PAPERS) {
        const g = buildGeometry({ ...preset(p.id), paperId: paper.id });
        const a = analyze(g);
        alphas.push(a.trimAlphaDeg!);
        // 안정 속도로 수평으로 던진 비행(거의 1 g)에서 잰 최대 휨
        const flex = runFlight(g, th(a.trimSpeedMps!, 0, 0)).maxFlexDeg;
        if (paper.id === 'copy80') expect(flex, `${p.id}/${paper.id}`).toBeLessThan(5);
        if (paper.gsm >= 100) expect(flex, `${p.id}/${paper.id}`).toBeLessThan(3.5);
        expect(flex, `${p.id}/${paper.id}`).toBeLessThan(15);
      }
      expect(Math.max(...alphas) - Math.min(...alphas), p.id).toBeLessThan(1.5);
    }
  });
});

describe('B3 실측 범위와 비교 (일반 복사지 기본 프리셋)', () => {
  for (const p of PRESETS) {
    it(`${p.id}: 활공비 2.5~6.5, 속도 3~8 m/s, 받음각 3~12도, 레이놀즈수 1e4~1e5`, () => {
      const a = analyze(buildGeometry(preset(p.id)));
      expect(a.glideRatio!).toBeGreaterThanOrEqual(2.5);
      expect(a.glideRatio!).toBeLessThanOrEqual(6.5);
      expect(a.trimSpeedMps!).toBeGreaterThanOrEqual(3);
      expect(a.trimSpeedMps!).toBeLessThanOrEqual(8);
      expect(a.trimAlphaDeg!).toBeGreaterThanOrEqual(3);
      expect(a.trimAlphaDeg!).toBeLessThanOrEqual(12);
      expect(a.reynolds).toBeGreaterThanOrEqual(1e4);
      expect(a.reynolds).toBeLessThanOrEqual(1e5);
      // 표시되는 레이놀즈수는 속도 x 평균 시위 / 동점성 계수와 같아야 한다
      const g = buildGeometry(preset(p.id));
      expect(a.reynolds / (a.trimSpeedMps! * g.stats.macM / 1.5e-5)).toBeGreaterThan(0.98);
      expect(a.reynolds / (a.trimSpeedMps! * g.stats.macM / 1.5e-5)).toBeLessThan(1.02);
    });
  }
  // [물리 2판에서 해결] 예전 기본 다트는 2.84 였다. 뒷전을 4.5도로 올려 받음각 4.7도에서 날게 해 약 3.1 이 되었다.
  it('규격서 기준: 다섯 기체 모두 활공비 3~6', () => {
    for (const p of PRESETS) {
      const gr = analyze(buildGeometry(preset(p.id))).glideRatio!;
      expect(gr, p.id).toBeGreaterThanOrEqual(3);
      expect(gr, p.id).toBeLessThanOrEqual(6);
    }
  });
});

// ---------------------------------------------------------------------------
// B4. 정성적 거동
// ---------------------------------------------------------------------------
describe('B4 정성적 거동', () => {
  it('클립을 꼬리에 끼우면 무게중심이 뒤로 가고 받음각이 커지며 느려진다. 넓은 날개는 실속으로 넘어간다', () => {
    for (const p of PRESETS) {
      const d = preset(p.id);
      const g0 = buildGeometry(d);
      const tail = { ...d, clip: { xBodyM: -g0.stats.lengthM } };
      const g1 = buildGeometry(tail);
      const a0 = analyze(g0), a1 = analyze(g1);
      expect(g1.cg.x, p.id).toBeLessThan(g0.cg.x);
      expect(g1.stats.cgFracMac, p.id).toBeGreaterThan(g0.stats.cgFracMac);
      expect(a1.trimAlphaDeg!, p.id).toBeGreaterThan(a0.trimAlphaDeg! + 3);
      expect(a1.trimSpeedMps!, p.id).toBeLessThan(a0.trimSpeedMps!);
    }
    for (const id of ['glider', 'delta', 'stealth']) {
      const d = preset(id);
      const tail = { ...d, clip: { xBodyM: -buildGeometry(d).stats.lengthM } };
      const v = Math.max(LIMITS.throwSpeedMin, analyze(buildGeometry(tail)).trimSpeedMps!);
      expect(['stall', 'flutter', 'tumble'], id).toContain(evaluate(tail, th(v, 0, 0)).result.verdict);
    }
  });

  it('기수 무게가 없는 자유접기(펼친 종이, 뒤쪽만 접은 종이)는 펄럭이거나 뒤집힌다', () => {
    const shaping = { keelM: 0.02, dihedralDeg: 10, wingletM: 0, wingletDeg: 0, elevatorDeg: 0 };
    const flat: PlaneDesign = { v: 1, paperId: 'copy80', folds: [], shaping, clip: null };
    const tailHeavy: PlaneDesign = { ...flat, folds: [{ a: { x: 0.105, y: -0.1 }, b: { x: -0.105, y: -0.1 }, dir: 'valley' }] };
    for (const d of [flat, tailHeavy]) {
      expect(validateDesign(d).ok).toBe(true);
      const e = evaluate(d, th(5, 0, 0));
      expect(e.summary.pitchStability).toBe('tumble');
      expect(['flutter', 'tumble']).toContain(e.result.verdict);
      expect(e.result.distanceM).toBeLessThan(3.5);
    }
  });

  it('클립을 기수에 끼우면 더 빨리, 더 작은 받음각으로 난다', () => {
    for (const p of PRESETS) {
      const d = preset(p.id);
      const a0 = analyze(buildGeometry(d));
      const a1 = analyze(buildGeometry({ ...d, clip: { xBodyM: 0 } }));
      expect(a1.trimSpeedMps!, p.id).toBeGreaterThan(a0.trimSpeedMps! * 1.2);
      expect(a1.trimAlphaDeg!, p.id).toBeLessThan(a0.trimAlphaDeg!);
    }
  });

  it('뒷전을 더 올리면 안정 받음각이 커지고 안정 속도가 줄어든다(단조)', () => {
    for (const p of PRESETS) {
      let prevA = -Infinity, prevV = Infinity;
      for (const e of [2, 5, 8, 12, 16, 20]) {
        const a = analyze(buildGeometry(withShaping(preset(p.id), { elevatorDeg: e })));
        expect(a.trimAlphaDeg, `${p.id} elev ${e}`).not.toBeNull();
        expect(a.trimAlphaDeg!, `${p.id} elev ${e}`).toBeGreaterThan(prevA);
        expect(a.trimSpeedMps!, `${p.id} elev ${e}`).toBeLessThan(prevV);
        prevA = a.trimAlphaDeg!; prevV = a.trimSpeedMps!;
      }
    }
  });

  it('상반각을 키우면 좌우 안정성 판정이 나빠지지 않고, -10도는 불안정, 25도는 안정이다', () => {
    const rank = { unstable: 0, neutral: 1, stable: 2 } as const;
    for (const p of PRESETS) {
      let prev = -1;
      for (const dh of [-10, 0, 10, 25]) {
        const a = analyze(buildGeometry(withShaping(preset(p.id), { dihedralDeg: dh })));
        expect(rank[a.lateralStability], `${p.id} dihedral ${dh}`).toBeGreaterThanOrEqual(prev);
        prev = rank[a.lateralStability];
      }
      expect(analyze(buildGeometry(withShaping(preset(p.id), { dihedralDeg: -10 }))).lateralStability, p.id).toBe('unstable');
      expect(analyze(buildGeometry(withShaping(preset(p.id), { dihedralDeg: 25 }))).lateralStability, p.id).toBe('stable');
    }
  });

  it('한쪽 날개 끝만 접은 비대칭 설계는 한쪽으로 휘고, 좌우를 바꾸면 반대로 휜다', () => {
    for (const p of PRESETS) {
      const d = preset(p.id);
      const sym = evaluate(d, th(analyze(buildGeometry(d)).trimSpeedMps!, 0, 0));
      expect(Math.abs(sym.geometry.stats.asymmetry), p.id).toBeLessThan(1e-6);
      expect(Math.abs(sym.result.lateralM), p.id).toBeLessThan(0.02);
      // 접힌 상태의 오른쪽 뒤 모서리(한 변 5 cm 삼각형)를 위로 접는다. a->b 의 왼쪽(= +x 쪽 모서리)이 움직인다.
      // (3 cm 삼각형으로는 스텔스형이 2.5 cm 밖에 휘지 않았다: 그 모서리가 세운 날개 끝에 들어가기 때문.)
      const yBack = -0.1485;
      const right: FoldOp = { a: { x: 0.105, y: yBack + 0.05 }, b: { x: 0.055, y: yBack }, dir: 'valley' };
      const left: FoldOp = { a: { x: -0.055, y: yBack }, b: { x: -0.105, y: yBack + 0.05 }, dir: 'valley' };
      const dR = { ...d, folds: [...d.folds, right] };
      const dL = { ...d, folds: [...d.folds, left] };
      expect(validateDesign(dR).ok).toBe(true);
      const gR = buildGeometry(dR), gL = buildGeometry(dL);
      expect(Math.abs(gR.stats.asymmetry), p.id).toBeGreaterThan(0.005);
      expect(gR.stats.asymmetry, p.id).toBeCloseTo(-gL.stats.asymmetry, 9);
      const v = analyze(gR).trimSpeedMps ?? 5;
      const rR = evaluate(dR, th(v, 0, 0)).result, rL = evaluate(dL, th(v, 0, 0)).result;
      expect(Math.abs(rR.lateralM), p.id).toBeGreaterThan(0.1);
      expect(rR.lateralM, p.id).toBeCloseTo(-rL.lateralM, 6);
      expect(rR.distanceM, p.id).toBeCloseTo(rL.distanceM, 6);
    }
  });

  // (물리 2판: 최대 속도가 16 -> 10 m/s. 거리 비교는 수평 던지기(10 m/s, 0도)로 한다: 10도 위로 던지면 델타의 신문지와
  //  켄트지가 우연히 같은 11.7 m 에 떨어져 "결과가 달라진다"를 볼 수 없기 때문이다. 휨 비교는 예전처럼 10도.)
  it('종이 휨 모델은 눈에 보이는 효과가 있다: 얇은 종이는 최대 속도에서 더 크게 휘고 결과가 달라진다', () => {
    const vMax = LIMITS.throwSpeedMax;
    for (const id of ['glider', 'delta', 'dart']) {
      const flex = (paperId: string): number => runFlight(buildGeometry({ ...preset(id), paperId }), th(vMax, 10, 0)).maxFlexDeg;
      expect(flex('newsprint'), id).toBeGreaterThan(flex('copy80') * 1.5);
      expect(flex('copy80'), id).toBeGreaterThan(flex('kent160') * 2);
      // 신문지는 최대 속도에서 눈에 띄게(8도 넘게) 휜다
      expect(flex('newsprint'), id).toBeGreaterThan(8);
      const dThin = evaluate({ ...preset(id), paperId: 'newsprint' }, th(vMax, 0, 0)).result.distanceM;
      const dStiff = evaluate({ ...preset(id), paperId: 'kent160' }, th(vMax, 0, 0)).result.distanceM;
      expect(Math.abs(dThin - dStiff), id).toBeGreaterThan(1);
    }
  });

  it('다트: 얇은 종이를 최대 속도로 던지면 빳빳한 종이보다 못 난다', () => {
    const dist = (paperId: string): number => evaluate({ ...preset('dart'), paperId }, th(LIMITS.throwSpeedMax, 10, 0)).result.distanceM;
    expect(dist('newsprint')).toBeLessThan(dist('copy80'));
    expect(dist('copy80')).toBeLessThan(dist('kent160'));
  });

  // [물리 2판에서 해결] 예전에는 넓은 날개가 반대로 나왔다(16 m/s: 신문지 16.8 m > 복사지 12.5 m > 고급 복사지 8.9 m).
  // 날개가 휘어 솟구침이 우연히 막혔기 때문이다. 지금은 흐물흐물한 날개가 빠른 바람에 펄럭이며 속도를 잃고,
  // 넓은 날개 세 가지 모두 신문지가 일반 복사지보다 못 난다. 종이 설명("세게 던지면 불리")과 맞는다.
  for (const id of ['glider', 'delta', 'stealth']) {
    it(`${id}: 얇은 종이를 최대 속도로 던지면 일반 복사지보다 못 난다`, () => {
      const dist = (paperId: string, pitch: number): number => evaluate({ ...preset(id), paperId }, th(LIMITS.throwSpeedMax, pitch, 0)).result.distanceM;
      for (const pitch of [0, 10]) {
        expect(dist('newsprint', pitch), `${pitch}도`).toBeLessThan(dist('copy80', pitch));
        expect(dist('newsprint', pitch), `${pitch}도`).toBeLessThan(dist('copy60', pitch) + 0.5);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// B5. 에너지 (내부 runFlight 의 energyJ: 위치 + 운동 + 회전)
// ---------------------------------------------------------------------------
function randomFold(r: () => number, prev: FoldOp[]): FoldOp {
  const W = 0.21, H = 0.297;
  const q = (v: number): number => Math.round(v * 1e4) / 1e4;
  const P = (x: number, y: number): { x: number; y: number } => ({ x: q(x), y: q(y) });
  const dir = r() < 0.5 ? 'valley' : 'mountain';
  const k = r();
  if (k < 0.08 && prev.length > 0) return { ...prev[Math.floor(r() * prev.length)]!, dir }; // 같은 선 반복
  if (k < 0.16) { // 아주 짧은 선분(0.6~0.9 mm)
    const x = (r() - 0.5) * W, y = (r() - 0.5) * H, a = r() * 6.283;
    return { a: P(x, y), b: P(x + 0.0008 * Math.cos(a), y + 0.0008 * Math.sin(a)), dir };
  }
  if (k < 0.24) return { a: P((r() - 0.5) * 4 * W, (r() - 0.5) * 4 * H), b: P((r() - 0.5) * 4 * W, (r() - 0.5) * 4 * H), dir }; // 종이 밖 먼 점
  if (k < 0.30) { const y0 = (r() - 0.5) * H; return { a: P(0, y0), b: P(0, y0 + (r() < 0.5 ? 0.05 : -0.05)), dir }; } // 중심선
  if (k < 0.36) { const e = r() < 0.5 ? W / 2 : -W / 2; return { a: P(e, -H / 2), b: P(e, H / 2), dir }; } // 종이 가장자리 위
  if (k < 0.42) { const y = (r() - 0.5) * H; return { a: P(-W / 2, y), b: P(W / 2, y + (r() - 0.5) * 0.0004), dir }; } // 거의 가로선
  if (k < 0.48) { const c = r() < 0.5 ? 1 : -1; return { a: P(c * W / 2, H / 2), b: P(c * W / 2 - c * 0.001, H / 2 - 0.001 * r()), dir }; } // 모서리 조각
  return { a: P((r() - 0.5) * 0.26, (r() - 0.5) * 0.34), b: P((r() - 0.5) * 0.26, (r() - 0.5) * 0.34), dir };
}

/** 검사를 통과하는 임의 설계: 퇴화한 접기, 반복, 비대칭, 마무리 값의 양 끝, 모든 종이, 클립 위치 */
function randomDesign(r: () => number): PlaneDesign {
  const W = 0.21, H = 0.297;
  const mode = r();
  const n = mode < 0.1 ? 0 : mode < 0.2 ? LIMITS.maxFolds : Math.floor(r() * 10);
  const folds: FoldOp[] = [];
  while (folds.length < n) {
    const f = randomFold(r, folds);
    if (Math.hypot(f.a.x - f.b.x, f.a.y - f.b.y) < 6e-4) continue;
    folds.push(f);
    if (r() < 0.25 && folds.length < n) folds.push({ a: { x: 0 - f.b.x || 0, y: f.b.y }, b: { x: 0 - f.a.x || 0, y: f.a.y }, dir: f.dir }); // 좌우 짝(-0 은 0 으로)
  }
  const ext = (lo: number, hi: number): number => { const k = r(); return k < 0.2 ? lo : k < 0.4 ? hi : lo + (hi - lo) * r(); };
  const q4 = (v: number): number => Math.round(v * 1e4) / 1e4;
  const q1 = (v: number): number => Math.round(v * 10) / 10;
  const keel = q4(ext(0, W / 2));
  let wl = q4(r() < 0.35 ? 0 : ext(0, W / 2));
  if (keel + wl > W / 2) wl = q4(W / 2 - keel);
  // JSON 을 한 번 거쳐 -0 을 0 으로 만든다(반올림에서 -0 이 나올 수 있고, 공유 코드는 둘을 구분하지 않는다).
  return JSON.parse(JSON.stringify({
    v: 1,
    paperId: PAPERS[Math.floor(r() * PAPERS.length)]!.id,
    folds,
    shaping: {
      keelM: keel,
      dihedralDeg: q1(ext(LIMITS.dihedralMin, LIMITS.dihedralMax)),
      wingletM: wl,
      wingletDeg: q1(ext(LIMITS.wingletDegMin, LIMITS.wingletDegMax)),
      elevatorDeg: q1(ext(LIMITS.elevatorMin, LIMITS.elevatorMax)),
    },
    clip: r() < 0.4 ? { xBodyM: q4(-ext(0, H)) } : null,
  })) as PlaneDesign;
}

function randomThrow(r: () => number): ThrowInput {
  const ext = (lo: number, hi: number): number => { const k = r(); return k < 0.2 ? lo : k < 0.4 ? hi : lo + (hi - lo) * r(); };
  return JSON.parse(JSON.stringify({
    speedMps: Math.round(ext(LIMITS.throwSpeedMin, LIMITS.throwSpeedMax) * 100) / 100,
    pitchDeg: Math.round(ext(LIMITS.pitchMin, LIMITS.pitchMax) * 10) / 10,
    rollDeg: Math.round(ext(LIMITS.rollMin, LIMITS.rollMax) * 10) / 10,
  })) as ThrowInput;
}

/** 한 비행에서 에너지가 가장 많이 늘어난 양(처음 에너지 대비 비율). 늘지 않았으면 0 이하. */
function worstEnergyRise(d: PlaneDesign, t: ThrowInput): number {
  const g = buildGeometry(d);
  const f = runFlight(g, t);
  const e0 = g.massKg * G * LIMITS.launchHeightM + 0.5 * g.massKg * t.speedMps ** 2;
  expect(f.samples[0]!.energyJ).toBeCloseTo(e0, 9);
  let worst = -Infinity;
  let low = f.samples[0]!.energyJ;
  for (const s of f.samples) {
    // 적분기가 적은 에너지가 최소한 병진 + 위치 에너지보다 작지 않은지(회전 에너지는 0 이상)
    const trans = g.massKg * G * s.pos.z + 0.5 * g.massKg * (s.vel.x ** 2 + s.vel.y ** 2 + s.vel.z ** 2);
    expect(s.energyJ).toBeGreaterThanOrEqual(trans - 1e-12);
    worst = Math.max(worst, (s.energyJ - low) / e0);
    if (s.energyJ < low) low = s.energyJ;
  }
  return worst;
}

describe('B5 에너지: 역학적 에너지는 늘어나지 않는다 (내부 runFlight 사용)', () => {
  const TOL = 1e-6;
  it('프리셋 x 종이 x 던지기 격자', () => {
    let worst = -Infinity, where = '';
    for (const p of PRESETS) {
      for (const paperId of ['newsprint', 'copy80', 'kent160']) {
        const d = { ...preset(p.id), paperId };
        for (const v of [2, 6, LIMITS.throwSpeedMax]) for (const pitch of [-20, 0, 20, 60]) for (const roll of [0, 30]) {
          const w = worstEnergyRise(d, th(v, pitch, roll));
          if (w > worst) { worst = w; where = `${p.id}/${paperId} ${v} m/s ${pitch}도 ${roll}도`; }
        }
      }
    }
    console.log(`[B5] 격자 최대 에너지 증가(처음 대비) ${worst.toExponential(2)} @ ${where}`);
    expect(worst, where).toBeLessThanOrEqual(TOL);
  }, LONG);

  it('승강타 양 끝값과 임의 자유접기 300개', () => {
    let worst = -Infinity, where = '';
    for (const p of PRESETS) for (const e of [LIMITS.elevatorMin, LIMITS.elevatorMax]) for (const v of [4, LIMITS.throwSpeedMax]) for (const pitch of [-20, 10]) {
      const w = worstEnergyRise(withShaping(preset(p.id), { elevatorDeg: e }), th(v, pitch, 0));
      if (w > worst) { worst = w; where = `${p.id} elev ${e} ${v} m/s ${pitch}도`; }
    }
    const r = lcg(20261113);
    for (let i = 0; i < 300; i++) {
      const d = randomDesign(r), t = randomThrow(r);
      const w = worstEnergyRise(d, t);
      if (w > worst) { worst = w; where = encodeDesign(d, t); }
    }
    console.log(`[B5] 자유접기 최대 에너지 증가(처음 대비) ${worst.toExponential(2)} @ ${where}`);
    expect(worst, where).toBeLessThanOrEqual(TOL);
  }, LONG);
});

// ---------------------------------------------------------------------------
// B6. 결정성
// ---------------------------------------------------------------------------
describe('B6 결정성', () => {
  it('같은 입력은 완전히 같은 결과, 호출 순서(A, B, A)와 무관, 공유 코드를 거쳐도 같다', () => {
    const A = { d: { ...preset('delta'), paperId: 'newsprint' }, t: th(9.37, 12.3, -7.7) };
    const B = { d: withShaping(preset('glider'), { elevatorDeg: 20 }), t: th(10, 60, 30) };
    const a1 = evaluate(A.d, A.t);
    const b1 = evaluate(B.d, B.t);
    const a2 = evaluate(A.d, A.t);
    const b2 = evaluate(B.d, B.t);
    expect(a2).toEqual(a1);
    expect(b2).toEqual(b1);
    expect(JSON.stringify(a2)).toBe(JSON.stringify(a1));
    expect(a1.result.distanceM).not.toBe(b1.result.distanceM);
    // 입력 객체를 건드리지 않는다
    expect(A.d).toEqual({ ...preset('delta'), paperId: 'newsprint' });
    // 코드로 바꿨다가 되돌린 입력으로도 비트 단위로 같다
    const back = decodeDesign(encodeDesign(A.d, A.t))!;
    expect(back.design).toEqual(A.d);
    expect(back.throwIn).toEqual(A.t);
    expect(JSON.stringify(evaluate(back.design, back.throwIn!))).toBe(JSON.stringify(a1));
    // 임의 설계에서도
    const r = lcg(99);
    for (let i = 0; i < 25; i++) {
      const d = randomDesign(r), t = randomThrow(r);
      const x = evaluate(d, t);
      evaluate(randomDesign(r), randomThrow(r));
      expect(JSON.stringify(evaluate(d, t)), encodeDesign(d, t)).toBe(JSON.stringify(x));
    }
  }, LONG);
});

// ---------------------------------------------------------------------------
// B7. 시간 간격 수렴 (내부 runFlight 의 dtS 사용: 리뷰 중 추가한 시험용 옵션)
// ---------------------------------------------------------------------------
describe('B7 시간 간격 수렴 (내부 runFlight 의 dtS 사용)', () => {
  it('시간 간격을 절반으로 줄여도 거리와 체공 시간이 2% 이내로 같다', () => {
    const cases: [PlaneDesign, ThrowInput][] = [
      [preset('dart'), th(10, 10, 0)],
      [preset('dart'), th(6, 0, 10)],
      [{ ...preset('dart'), paperId: 'kent160' }, th(10, 0, 0)],
      [preset('glider'), th(3.9, 0, 0)],
      [preset('hybrid'), th(8, 5, -5)],
      [preset('delta'), th(10, 10, 0)],
      [preset('stealth'), th(6, 5, 0)],
      [{ ...preset('delta'), paperId: 'newsprint' }, th(10, 10, 0)],
      // 꺾임(좌굴)이 일어나는 비행도 시간 간격에 민감하지 않아야 한다: 신문지 글라이더를 최대 속도로 위로
      [{ ...preset('glider'), paperId: 'newsprint' }, th(10, 25, 0)],
    ];
    for (const [d, t] of cases) {
      const g = buildGeometry(d);
      const full = runFlight(g, t);
      const half = runFlight(g, t, undefined, { dtS: 0.0005 });
      const label = encodeDesign(d, t);
      console.log(`[B7] ${full.landing.x.toFixed(4)} m -> ${half.landing.x.toFixed(4)} m, ${full.airtimeS.toFixed(4)} s -> ${half.airtimeS.toFixed(4)} s`);
      expect(Math.abs(half.landing.x - full.landing.x) / Math.max(1, Math.abs(full.landing.x)), label).toBeLessThan(0.02);
      expect(Math.abs(half.airtimeS - full.airtimeS) / full.airtimeS, label).toBeLessThan(0.02);
      // 기본 간격의 결과가 공개 함수의 결과와 같은지(옵션이 게임 계산을 바꾸지 않았는지)
      const pub = evaluate(d, t).result;
      expect(pub.airtimeS).toBe(full.airtimeS);
      expect(pub.distanceM).toBe(Math.hypot(full.landing.x, full.landing.y));
    }
  }, LONG);
});

// ---------------------------------------------------------------------------
// B8. 견고성 퍼즈
// ---------------------------------------------------------------------------
describe('B8 견고성 퍼즈', () => {
  it('임의 설계 2000개 x 임의 던지기: 예외 없음, 모든 수가 유한, 터무니없는 기록 없음', () => {
    const r = lcg(31337);
    let slowestMs = 0, slowestCode = '';
    const top: { dist: number; air: number; code: string }[] = [];
    for (let i = 0; i < 2000; i++) {
      const d = randomDesign(r), t = randomThrow(r);
      const code = encodeDesign(d, t);
      const vd = validateDesign(d);
      expect(vd.ok, `${vd.errors.join(' / ')} ${code}`).toBe(true);
      expect(validateThrow(t).ok).toBe(true);
      const back = decodeDesign(code);
      expect(back, code).not.toBeNull();
      expect(back!.design, code).toEqual(d);
      expect(back!.throwIn, code).toEqual(t);

      const t0 = performance.now();
      const e = evaluate(d, t);
      const ms = performance.now() - t0;
      if (ms > slowestMs) { slowestMs = ms; slowestCode = code; }

      const bad: string[] = [];
      nonFinitePaths(e.geometry, 'geometry', bad);
      nonFinitePaths({ ...e.summary, trimAlphaDeg: e.summary.trimAlphaDeg ?? 0, trimSpeedMps: e.summary.trimSpeedMps ?? 0, glideRatio: e.summary.glideRatio ?? 0 }, 'summary', bad);
      nonFinitePaths(e.result, 'result', bad);
      expect(bad, code).toEqual([]);

      const paper = getPaper(d.paperId)!;
      const sheet = paper.widthM * paper.heightM * paper.gsm / 1000;
      expect(e.geometry.massKg, code).toBeCloseTo(sheet + (d.clip ? LIMITS.clipMassKg : 0), 12);
      // 날개 넓이는 종이 넓이를 넘을 수 없다
      expect(e.geometry.stats.wingAreaM2, code).toBeLessThanOrEqual(paper.widthM * paper.heightM * 1.0001);
      expect(e.geometry.stats.lengthM, code).toBeLessThanOrEqual(Math.hypot(paper.widthM, paper.heightM) * 1.0001);
      expect(e.result.airtimeS, code).toBeGreaterThan(0);
      expect(e.result.distanceM, code).toBeGreaterThanOrEqual(0);
      // 어린이가 1.6 m 에서 최대 10 m/s 로 던진 종이: 25 m, 9 초를 넘으면 조작 가능한 허점이다
      // (물리 2판: 예전 한계 40 m, 20 초에서 조였다. 근거는 leaderboard.test.ts 머리말.)
      expect(e.result.distanceM, code).toBeLessThan(25);
      expect(e.result.airtimeS, code).toBeLessThan(9);
      // 구조 결과도 유한하고 서로 맞는다
      const st = e.result.structure;
      expect(st.peakLoadRatio, code).toBeGreaterThanOrEqual(0);
      expect(st.safeThrowSpeedMps, code).toBeGreaterThanOrEqual(LIMITS.throwSpeedMin);
      expect(st.safeThrowSpeedMps, code).toBeLessThanOrEqual(LIMITS.throwSpeedMax);
      expect(st.buckled, code).toBe(st.buckledAtS !== null);
      // (가장 살살 던져도 접히는 종이는 safeThrowSpeedMps 가 최소 속도 그대로다)
      if (st.collapsedAtLaunch) { expect(st.buckledAtS, code).toBe(0); expect(st.safeThrowSpeedMps, code).toBeLessThanOrEqual(t.speedMps); }
      if (st.buckled) expect(st.peakLoadRatio, code).toBeGreaterThan(1);
      // 에너지 한계: 던진 속도를 모두 높이로 바꿔도 이보다 높이 갈 수 없다
      expect(e.result.maxHeightM, code).toBeLessThanOrEqual(LIMITS.launchHeightM + t.speedMps ** 2 / (2 * G) + 1e-6);
      top.push({ dist: e.result.distanceM, air: e.result.airtimeS, code });
    }
    const fmt = (x: { dist: number; air: number; code: string }): string => `${x.dist.toFixed(2)} m ${x.air.toFixed(2)} s ${x.code}`;
    console.log(`[B8] 가장 느린 계산 ${slowestMs.toFixed(0)} ms: ${slowestCode}`);
    console.log(`[B8] 거리 상위 5:\n  ${[...top].sort((p, q) => q.dist - p.dist).slice(0, 5).map(fmt).join('\n  ')}`);
    console.log(`[B8] 체공 상위 5:\n  ${[...top].sort((p, q) => q.air - p.air).slice(0, 5).map(fmt).join('\n  ')}`);
    // 한 번 계산이 1초를 넘으면 서버 한 건이 CPU 를 오래 붙잡는다
    expect(slowestMs, slowestCode).toBeLessThan(1000);
  }, LONG);

  it('검사를 통과하지 못하는 값은 코드로 만들어도 되돌릴 때 걸러진다', () => {
    const base = preset('dart');
    const bads: PlaneDesign[] = [
      withShaping(base, { elevatorDeg: 21 }),
      withShaping(base, { dihedralDeg: 46 }),
      withShaping(base, { keelM: 0.2 }),
      withShaping(base, { keelM: 0.09, wingletM: 0.09 }),
      { ...base, clip: { xBodyM: 0.01 } },
      { ...base, clip: { xBodyM: -0.31 } },
      { ...base, folds: [...base.folds, { a: { x: 0.01, y: 0.01 }, b: { x: 0.01, y: 0.01 }, dir: 'valley' }] },
      { ...base, folds: [...base.folds, { a: { x: 3, y: 0 }, b: { x: 0, y: 0 }, dir: 'valley' }] },
    ];
    for (const d of bads) {
      expect(validateDesign(d).ok).toBe(false);
      expect(decodeDesign(encodeDesign(d, th(8, 0, 0)))).toBeNull();
    }
    // (물리 2판: 한도가 16 -> 10 m/s. 그리고 범위를 벗어난 던지기가 든 코드는 통째로 버리지 않고,
    //  설계만 돌려주며 던지기는 "없음"으로 처리한다. 한도 안으로 자르지 않는다. codec.test.ts 의 호환 시험 참고.)
    for (const t of [th(LIMITS.throwSpeedMax + 0.01), th(16), th(1.99), th(8, 60.1), th(8, -20.1), th(8, 0, 30.1)]) {
      expect(validateThrow(t).ok).toBe(false);
      const back = decodeDesign(encodeDesign(base, t));
      expect(back).not.toBeNull();
      expect(back!.design).toEqual(base);
      expect(back!.throwIn).toBeUndefined();
      expect(back!.throwOutOfRange).toEqual(t);
    }
  });
});
