/**
 * 공기 힘 모델과 분석(analyze) 시험.
 * 문헌과 실측에서 얻은 기준값(실속각, 작용점 이동, 활공비 3~6 등)을 그대로 단언한다.
 */
import { describe, expect, it } from 'vitest';
import {
  AIR, attachedWeight, centerOfPressureFrac, frictionCoeff, liftSlopeKp, normalForceCoeff, plateParams, stallAngleRad,
} from '../src/core/aero/coefficients';
import {
  STRUCT, computeAero, flexLinear, flexTarget, newAeroOut, prepareModel, steadyCoeffs, steadySolve,
} from '../src/core/aero/forces';
import { analyze, analyzeModel } from '../src/core/aero/analyze';
import { FIXTURE_DART, FIXTURE_GLIDER, fixturePaper, makeFixtureGeometry } from '../src/core/aero/fixtureGeometry';
import type { PlaneDesign, PlaneGeometry } from '../src/core/types';
import { PAPERS } from '../src/core/papers';
import { PRESETS } from '../src/core/presets';
import { buildGeometry } from '../src/core/fold/geometry';

const DEG = Math.PI / 180;

/** 평판 한 장의 양력 계수 (수직력의 양력 방향 성분) */
function plateCl(ar: number, alphaDeg: number): number {
  const a = alphaDeg * DEG;
  return normalForceCoeff(Math.sin(a), Math.cos(a), plateParams(ar)) * Math.cos(a);
}
function plateStallDeg(ar: number): number {
  let best = 0, bestCl = -1;
  // 받음각을 키워 갈 때 양력이 처음 꺾이는 점
  for (let a = 1; a <= 80; a += 0.5) { const cl = plateCl(ar, a); if (cl > bestCl) { bestCl = cl; best = a; } else break; }
  return best;
}
function detail(g: PlaneGeometry) { return analyzeModel(prepareModel(g), g); }

describe('평판 계수', () => {
  it('양력 기울기: 가로세로비가 작으면 π·AR/2, 크면 2π 에 가까워진다', () => {
    expect(liftSlopeKp(0.1)).toBeCloseTo((Math.PI * 0.1) / 2, 2);
    expect(liftSlopeKp(1)).toBeGreaterThan(1.3);
    expect(liftSlopeKp(1)).toBeLessThan(1.7);
    expect(liftSlopeKp(50)).toBeGreaterThan(5.8);
    expect(liftSlopeKp(50)).toBeLessThan(2 * Math.PI);
  });

  it('실속각은 가로세로비에 따라 달라진다 (AR 1: 35~40도, AR 2~3: 약 20도, 더 길면 더 낮게)', () => {
    expect(stallAngleRad(1) / DEG).toBeGreaterThanOrEqual(35);
    expect(stallAngleRad(1) / DEG).toBeLessThanOrEqual(40);
    expect(stallAngleRad(2.5) / DEG).toBeGreaterThan(17);
    expect(stallAngleRad(2.5) / DEG).toBeLessThan(23);
    expect(stallAngleRad(8) / DEG).toBeLessThan(14);
    // 실제 양력 곡선의 꼭대기도 같은 경향이어야 한다
    const s1 = plateStallDeg(1), s25 = plateStallDeg(2.5), s8 = plateStallDeg(8);
    expect(s1).toBeGreaterThanOrEqual(30);
    expect(s1).toBeLessThanOrEqual(42);
    expect(s25).toBeGreaterThanOrEqual(16);
    expect(s25).toBeLessThanOrEqual(24);
    expect(s8).toBeLessThan(s25);
    expect(s8).toBeLessThanOrEqual(14);
  });

  it('낮은 가로세로비에서는 양력이 받음각에 단순 비례하지 않는다 (소용돌이 양력)', () => {
    // 비례라면 20도 값이 10도 값의 2배(정확히는 sin·cos² 때문에 그보다 작음)여야 한다
    expect(plateCl(1, 20) / plateCl(1, 10)).toBeGreaterThan(2.15);
    // 긴 날개는 소용돌이 양력이 거의 없다
    expect(plateCl(8, 8) / plateCl(8, 4)).toBeLessThan(2.05);
    // 최대 양력 계수는 문헌 범위 (AR 1 평판 약 0.9~1.3)
    expect(plateCl(1, plateStallDeg(1))).toBeGreaterThan(0.85);
    expect(plateCl(1, plateStallDeg(1))).toBeLessThan(1.35);
  });

  it('실속 이후에는 평판이 바람을 막는 힘으로 이어진다 (90도에서 CN 1.1~2.0)', () => {
    for (const ar of [0.3, 1, 2.5, 8, 20]) {
      const cn = normalForceCoeff(1, 0, plateParams(ar));
      expect(cn).toBeGreaterThanOrEqual(1.1);
      expect(cn).toBeLessThanOrEqual(2.0);
      expect(attachedWeight(1, plateParams(ar))).toBeLessThan(0.01);
    }
  });

  it('-180~180도 전 범위에서 유한하고, 부호가 받음각을 따르며, 급격히 튀지 않는다', () => {
    for (const ar of [0.05, 0.3, 1, 3, 8]) {
      const p = plateParams(ar);
      let prev = normalForceCoeff(Math.sin(-Math.PI), Math.cos(-Math.PI), p);
      for (let d = -180; d <= 180; d += 0.5) {
        const a = d * DEG;
        const cn = normalForceCoeff(Math.sin(a), Math.cos(a), p);
        expect(Number.isFinite(cn)).toBe(true);
        if (d > 0.5 && d < 179.5) expect(cn).toBeGreaterThan(0);
        if (d < -0.5 && d > -179.5) expect(cn).toBeLessThan(0);
        expect(Math.abs(cn - prev)).toBeLessThan(0.12);
        prev = cn;
        // 홀함수: 받음각 부호를 바꾸면 힘의 부호만 바뀐다
        expect(normalForceCoeff(Math.sin(-a), Math.cos(-a), p)).toBeCloseTo(-cn, 12);
      }
    }
  });

  it('양력 작용점은 받음각에 따라 25% 에서 50% 로 뒤로 이동한다', () => {
    const p = plateParams(2);
    expect(centerOfPressureFrac(Math.sin(0.5 * DEG), Math.cos(0.5 * DEG), p)).toBeCloseTo(0.25, 2);
    expect(centerOfPressureFrac(1, 0, p)).toBeCloseTo(0.5, 6);
    let prev = 0;
    for (let d = 0; d <= 90; d += 1) {
      const x = centerOfPressureFrac(Math.sin(d * DEG), Math.cos(d * DEG), p);
      expect(x).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = x;
    }
    const x10 = centerOfPressureFrac(Math.sin(10 * DEG), Math.cos(10 * DEG), p);
    expect(x10).toBeGreaterThan(0.27);
    expect(x10).toBeLessThan(0.35);
    // 뒤로 날 때는 뒷전 쪽에서부터 25%
    expect(centerOfPressureFrac(Math.sin(179.5 * DEG), Math.cos(179.5 * DEG), p)).toBeCloseTo(0.75, 2);
  });

  // 물리 2판에서 바뀐 시험: 예전에는 "층류 마찰 x 형상 계수(겹이 많으면 증가)" 하나였다. 지금은 마찰은 레이놀즈수와
  // 받음각(앞전 박리 거품 뒤의 난류)으로만 정하고, 겹의 효과는 "뭉툭한 가장자리 항력"으로 따로 센다(아래 '항력 예산' 시험).
  it('마찰 계수는 레이놀즈수가 커질수록 줄고, 받음각이 생기면 윗면이 난류가 되어 늘어난다', () => {
    expect(frictionCoeff(1e4, 0)).toBeGreaterThan(frictionCoeff(1e5, 0));
    expect(frictionCoeff(3e4, Math.sin(8 * DEG))).toBeGreaterThan(frictionCoeff(3e4, 0));
    expect(frictionCoeff(1e5, Math.sin(8 * DEG))).toBeGreaterThan(frictionCoeff(1e5, Math.sin(2 * DEG)));
    // 받음각 0: Blasius 양면 값(2.656/sqrt(Re))에 잔주름 배수 1.1 을 곱한 값
    const blasius = 2.656 / Math.sqrt(3e4);
    expect(frictionCoeff(3e4, 0)).toBeCloseTo(1.1 * blasius, 12);
    expect(frictionCoeff(3e4, 0)).toBeGreaterThan(blasius);
    expect(frictionCoeff(3e4, 1)).toBeLessThan(3 * blasius);
    // 큰 받음각: 한 면은 층류, 한 면은 난류(0.074/Re^0.2)
    expect(frictionCoeff(1e5, 1)).toBeCloseTo(1.1 * (1.328 / Math.sqrt(1e5) + 0.074 / Math.pow(1e5, 0.2)), 4);
    // 아주 느린 흐름(레이놀즈수 1만 5천 아래)은 난류를 유지하지 못한다: 받음각이 있어도 층류 값 그대로
    expect(frictionCoeff(5e3, 1)).toBeCloseTo(frictionCoeff(5e3, 0), 12);
    expect(Number.isFinite(frictionCoeff(0, 0))).toBe(true);
    expect(Number.isFinite(frictionCoeff(0, 1))).toBe(true);
  });
});

describe('시험용 형상', () => {
  it('모든 값이 서로 맞는다 (면적, 무게, 무게중심, 관성)', () => {
    for (const o of [FIXTURE_DART, FIXTURE_GLIDER, { ...FIXTURE_GLIDER, wingletM: 0.02, rightSpanScale: 0.8 }]) {
      const g = makeFixtureGeometry(o);
      expect(g.massKg).toBeCloseTo(0.21 * 0.297 * 0.08, 6); // A4 80 g 지 약 5.0 g
      let wing = 0, keel = 0;
      for (const e of g.elements) {
        expect(e.area).toBeCloseTo(e.chord * e.width, 12);
        expect(Math.hypot(e.normal.x, e.normal.y, e.normal.z)).toBeCloseTo(1, 9);
        expect(Math.hypot(e.chordDir.x, e.chordDir.y, e.chordDir.z)).toBeCloseTo(1, 9);
        expect(e.le.x).toBeLessThanOrEqual(1e-12);
        if (e.kind === 'wing') wing += e.area * e.normal.z;
        if (e.kind === 'keel') keel += e.area;
      }
      expect(g.stats.wingAreaM2).toBeCloseTo(wing, 9);
      expect(g.stats.keelAreaM2).toBeCloseTo(keel, 9);
      expect(g.stats.aspectRatio).toBeCloseTo((g.stats.spanM * g.stats.spanM) / g.stats.wingAreaM2, 9);
      expect(g.stats.wingLoadingNm2).toBeCloseTo((g.massKg * AIR.g) / g.stats.wingAreaM2, 9);
      expect(g.stats.cgFracMac).toBeCloseTo(o.cgFracMac ?? 0, 6);
      expect(g.stats.cgFracLength).toBeGreaterThan(0);
      expect(g.stats.cgFracLength).toBeLessThan(1);
      const [ixx, iyy, izz, ixy, ixz, iyz] = g.inertia;
      expect(ixx).toBeGreaterThan(0);
      expect(iyy).toBeGreaterThan(0);
      expect(izz).toBeGreaterThan(0);
      // 얇은 판에 가까우므로 izz ≈ ixx + iyy (수직축 정리), 삼각 부등식도 성립
      expect(izz).toBeLessThanOrEqual(ixx + iyy + 1e-12);
      expect(izz).toBeGreaterThan(0.8 * (ixx + iyy));
      const det = ixx * (iyy * izz - iyz * iyz) - ixy * (ixy * izz - iyz * ixz) + ixz * (ixy * iyz - iyy * ixz);
      expect(det).toBeGreaterThan(0);
      expect(g.mesh.positions.length).toBe(g.mesh.layers.length * 9);
    }
    expect(makeFixtureGeometry(FIXTURE_DART).stats.asymmetry).toBe(0);
    expect(makeFixtureGeometry({ ...FIXTURE_DART, rightSpanScale: 0.8 }).stats.asymmetry).toBeGreaterThan(0.05);
  });
});

describe('힘 모델', () => {
  const dart = makeFixtureGeometry(FIXTURE_DART);
  const glider = makeFixtureGeometry(FIXTURE_GLIDER);

  it('대칭 형상은 옆힘, 롤, 요 모멘트가 없다', () => {
    for (const g of [dart, glider]) {
      const c = steadyCoeffs(prepareModel(g), 6 * DEG, 0, 5);
      expect(Math.abs(c.cy)).toBeLessThan(1e-9);
      expect(Math.abs(c.croll)).toBeLessThan(1e-9);
      expect(Math.abs(c.cyaw)).toBeLessThan(1e-9);
    }
  });

  it('좌우가 다른 형상은 롤, 요 모멘트가 생긴다', () => {
    const c1 = steadyCoeffs(prepareModel(makeFixtureGeometry({ ...FIXTURE_GLIDER, rightSpanScale: 0.8 })), 6 * DEG, 0, 4);
    expect(Math.abs(c1.croll)).toBeGreaterThan(1e-4);
    const c2 = steadyCoeffs(prepareModel(makeFixtureGeometry({ ...FIXTURE_GLIDER, elevatorDiffDeg: 8 })), 6 * DEG, 0, 4);
    // 왼쪽 뒷전을 더 올리면 왼쪽 양력이 줄어 왼쪽 날개가 내려간다(+x 축 기준 음의 롤)
    expect(c2.croll).toBeLessThan(-1e-4);
  });

  it('회전하면 회전을 줄이는 모멘트가 생긴다 (피치, 롤, 요 감쇠)', () => {
    const out = newAeroOut();
    for (const g of [dart, glider]) {
      const m = prepareModel(g);
      const v = 5, a = 6 * DEG;
      computeAero(m, v * Math.cos(a), 0, -v * Math.sin(a), 0, 0, 0, 0, 0, out);
      const base = { ...out };
      computeAero(m, v * Math.cos(a), 0, -v * Math.sin(a), 3, 0, 0, 0, 0, out);
      expect(out.mx - base.mx).toBeLessThan(0);
      computeAero(m, v * Math.cos(a), 0, -v * Math.sin(a), 0, 3, 0, 0, 0, out);
      expect(out.my - base.my).toBeLessThan(0);
      computeAero(m, v * Math.cos(a), 0, -v * Math.sin(a), 0, 0, 3, 0, 0, out);
      expect(out.mz - base.mz).toBeLessThan(0);
    }
  });

  it('승강타를 올리면 양력이 줄고 기수를 드는 모멘트가 생긴다', () => {
    for (const o of [FIXTURE_DART, FIXTURE_GLIDER]) {
      const flat = steadyCoeffs(prepareModel(makeFixtureGeometry(o)), 5 * DEG, 0, 5);
      const up = steadyCoeffs(prepareModel(makeFixtureGeometry({ ...o, elevatorDeg: 10 })), 5 * DEG, 0, 5);
      const down = steadyCoeffs(prepareModel(makeFixtureGeometry({ ...o, elevatorDeg: -10 })), 5 * DEG, 0, 5);
      expect(up.cl).toBeLessThan(flat.cl);
      expect(up.cm).toBeGreaterThan(flat.cm);
      expect(down.cl).toBeGreaterThan(flat.cl);
      expect(down.cm).toBeLessThan(flat.cm);
      expect(up.cd).toBeGreaterThan(0);
      expect(down.cd).toBeGreaterThan(0);
    }
  });

  it('용골은 옆미끄럼을 막는 옆힘을 만들고, 상반각은 롤 복원력을 만든다', () => {
    const b = 5 * DEG;
    const withKeel = steadyCoeffs(prepareModel(makeFixtureGeometry({ ...FIXTURE_GLIDER, dihedralDeg: 0 })), 6 * DEG, b, 4);
    const noKeel = steadyCoeffs(prepareModel(makeFixtureGeometry({ ...FIXTURE_GLIDER, dihedralDeg: 0, keelDepthM: 0 })), 6 * DEG, b, 4);
    // 왼쪽(+y)으로 미끄러지면 용골이 오른쪽(-y)으로 미는 힘을 낸다
    expect(withKeel.cy).toBeLessThan(noKeel.cy - 1e-3);
    expect(withKeel.cy).toBeLessThan(0);
    const dihedral = steadyCoeffs(prepareModel(makeFixtureGeometry({ ...FIXTURE_GLIDER, dihedralDeg: 12, keelDepthM: 0 })), 6 * DEG, b, 4);
    // 왼쪽으로 미끄러지면 왼쪽 날개가 들리는 방향(+)의 롤 모멘트
    expect(dihedral.croll).toBeGreaterThan(noKeel.croll + 1e-3);
    const anhedral = steadyCoeffs(prepareModel(makeFixtureGeometry({ ...FIXTURE_GLIDER, dihedralDeg: -10, keelDepthM: 0 })), 6 * DEG, b, 4);
    expect(anhedral.croll).toBeLessThan(noKeel.croll - 1e-3);
  });

  it('항력은 모든 받음각에서 양수이고, 받음각 0 근처에서는 레이놀즈수가 낮을수록 크다', () => {
    for (const g of [dart, glider]) {
      const m = prepareModel(g);
      for (let d = -180; d <= 180; d += 5) {
        const c = steadyCoeffs(m, d * DEG, 0, 5);
        expect(c.cd).toBeGreaterThan(0);
        expect(Number.isFinite(c.cl + c.cm)).toBe(true);
      }
      expect(steadyCoeffs(m, 0, 0, 2).cd).toBeGreaterThan(steadyCoeffs(m, 0, 0, 10).cd);
      // 받음각 0 의 항력 계수는 종이비행기 범위(0.015~0.06)
      const cd0 = steadyCoeffs(m, 0, 0, 5).cd;
      expect(cd0).toBeGreaterThan(0.015);
      expect(cd0).toBeLessThan(0.06);
    }
  });

  it('종이 휨: 힘의 방향에 따라 휘는 방향이 바뀌고, 빠를수록 얇을수록 더 휜다', () => {
    const thin = makeFixtureGeometry({ ...FIXTURE_GLIDER, paper: fixturePaper(45) });
    const thick = makeFixtureGeometry({ ...FIXTURE_GLIDER, paper: fixturePaper(160) });
    const mThin = prepareModel(thin), mThick = prepareModel(thick);
    const up = steadyCoeffs(mThin, 8 * DEG, 0, 8);
    const dn = steadyCoeffs(mThin, -8 * DEG, 0, 8);
    expect(up.thetaL).toBeGreaterThan(5 * DEG); // 양력이 위로 → 날개 끝이 올라감
    expect(dn.thetaL).toBeLessThan(-5 * DEG);   // 힘이 아래로 → 날개 끝이 내려감
    expect(up.thetaL).toBeCloseTo(up.thetaR, 9);
    const slow = steadyCoeffs(mThin, 8 * DEG, 0, 3);
    expect(up.thetaL).toBeGreaterThan(slow.thetaL * 2);
    const stiff = steadyCoeffs(mThick, 8 * DEG, 0, 8);
    expect(up.thetaL).toBeGreaterThan(stiff.thetaL * 4);
    // 휘면 같은 받음각에서 양력이 달라진다. 고정 감점이 아니라 힘에 따라 달라지는 효과다.
    const rigidUp = steadyCoeffs(mThin, 8 * DEG, 0, 8, false);
    const rigidSlow = steadyCoeffs(mThin, 8 * DEG, 0, 3, false);
    const lossFast = 1 - up.cl / rigidUp.cl;
    const lossSlow = 1 - slow.cl / rigidSlow.cl;
    expect(lossFast).toBeGreaterThan(0.05);
    expect(lossFast).toBeGreaterThan(lossSlow * 1.5);
    // 받음각 0 (힘 없음)에서는 휘지 않는다
    expect(Math.abs(steadyCoeffs(mThin, 0, 0, 8).thetaL)).toBeLessThan(0.5 * DEG);
    // 물리 2판에서 바뀐 시험: 예전에는 휨을 약 35도에서 부드럽게 막았다(그 너머는 모델 밖).
    // 지금은 뿌리 굽힘 모멘트로 휨을 구하고, 선형 휨이 약 35도를 넘으면 날개가 꺾인 것으로 본다. 기하학적 한계는 약 80도.
    expect(Math.abs(flexTarget(mThin, 100, 1))).toBeLessThanOrEqual(STRUCT.maxTipRad);
    expect(Math.abs(flexTarget(mThin, -100, 1))).toBeLessThanOrEqual(STRUCT.maxTipRad);
    expect(flexTarget(mThin, 100, 1)).toBeGreaterThan(75 * DEG);
    expect(flexTarget(mThin, 0, 1)).toBe(0);
    // 작은 모멘트에서는 선형(모멘트 x 유연도)이고 부호를 따른다
    expect(flexTarget(mThin, 1e-5, 1)).toBeCloseTo(flexLinear(mThin, 1e-5, 1), 7);
    expect(flexTarget(mThin, -1e-5, -1)).toBeCloseTo(-flexTarget(mThin, 1e-5, -1), 12);
    // 이미 꺾인 날개는 같은 모멘트에 더 많이 휜다
    expect(flexLinear(mThin, 1e-5, 1, true)).toBeCloseTo(flexLinear(mThin, 1e-5, 1) / STRUCT.creasedStiffness, 12);
  });

  it('종이 꺾임(좌굴): 얇은 종이의 넓은 날개는 세게 바람을 받으면 꺾이고, 빳빳한 종이는 버틴다', () => {
    const thin = prepareModel(makeFixtureGeometry({ ...FIXTURE_GLIDER, paper: fixturePaper(45) }));
    const thick = prepareModel(makeFixtureGeometry({ ...FIXTURE_GLIDER, paper: fixturePaper(160) }));
    // 느린 바람: 버틴다. 하중 비는 동압(속도의 제곱)에 따라 커진다.
    const slow = steadySolve(thin, 8 * DEG, 0, 3);
    expect(slow.buckled).toBe(false);
    expect(slow.loadRatio).toBeGreaterThan(0.1);
    expect(slow.loadRatio).toBeLessThan(1);
    // 빠른 바람: 한계를 넘어 꺾이고, 꺾인 날개는 위로 접혀 양력을 크게 잃는다
    const fast = steadySolve(thin, 8 * DEG, 0, 9);
    expect(fast.buckled).toBe(true);
    expect(fast.buckledL && fast.buckledR).toBe(true);
    expect(fast.loadRatio).toBeGreaterThan(1);
    expect(fast.thetaL).toBeGreaterThan(STRUCT.buckleRad);
    expect(steadyCoeffs(thin, 8 * DEG, 0, 9).cl).toBeLessThan(0.5 * steadyCoeffs(thin, 8 * DEG, 0, 9, false).cl);
    // 같은 조건에서 두꺼운 종이는 한계의 1/5 도 쓰지 않는다
    const stiff = steadySolve(thick, 8 * DEG, 0, 9);
    expect(stiff.buckled).toBe(false);
    expect(stiff.loadRatio).toBeLessThan(0.2);
    // 받음각 0 (날개에 힘이 없음)에서는 아무리 빨라도 꺾이지 않는다
    expect(steadySolve(thin, 0, 0, 10).buckled).toBe(false);
    // 한번 꺾인 날개(이력)는 느린 바람에서도 온전한 날개보다 더 휜다
    const creased = steadySolve(thin, 8 * DEG, 0, 3, true, undefined, { buckledL: true, buckledR: true });
    expect(creased.buckled).toBe(true);
    expect(creased.thetaL).toBeGreaterThan(slow.thetaL * 1.5);
  });

  it('펄럭임 항력: 흐물흐물한 날개는 빠른 바람에서 항력이 크게 늘고, 빳빳한 날개와 느린 바람에서는 거의 없다', () => {
    const thin = prepareModel(makeFixtureGeometry({ ...FIXTURE_GLIDER, paper: fixturePaper(45) }));
    const thick = prepareModel(makeFixtureGeometry({ ...FIXTURE_GLIDER, paper: fixturePaper(160) }));
    // 받음각 0 에서 비교(날개에 힘이 없어 휨, 꺾임과 무관하게 펄럭임만 본다)
    const cd = (m: ReturnType<typeof prepareModel>, v: number): number => steadyCoeffs(m, 0, 0, v).cd;
    expect(cd(thin, 10)).toBeGreaterThan(cd(thick, 10) + 0.1);
    expect(cd(thin, 10)).toBeGreaterThan(cd(thin, 3) + 0.1);
    expect(Math.abs(cd(thin, 3) - cd(thick, 3))).toBeLessThan(0.01);
    // 펄럭임 항력은 날개 면적 기준 0.3 을 넘지 않는다
    expect(cd(thin, 10)).toBeLessThan(0.3 * 1.2 + 0.06);
  });

  it('아래로 휘는 경우(음의 받음각)에는 상반각이 줄어 양력 크기가 위로 휠 때와 다르게 변한다', () => {
    // (물리 2판: 이 흐물흐물한 시험 형상은 9 m/s 에서 꺾임 한계에 닿는다. 탄성 범위의 성질을 보려고 7 m/s 로 낮췄다.)
    const m = prepareModel(makeFixtureGeometry({ ...FIXTURE_DART, stiffnessFactor: 0.15 }));
    expect(steadySolve(m, 10 * DEG, 0, 7).buckled).toBe(false);
    expect(steadySolve(m, -10 * DEG, 0, 7).buckled).toBe(false);
    const up = steadyCoeffs(m, 10 * DEG, 0, 7), upRigid = steadyCoeffs(m, 10 * DEG, 0, 7, false);
    const dn = steadyCoeffs(m, -10 * DEG, 0, 7), dnRigid = steadyCoeffs(m, -10 * DEG, 0, 7, false);
    // 위로 휘면 상반각이 커져 양력이 줄고, 아래로 휘면 원래 있던 상반각이 펴져 양력 크기가 덜 줄거나 늘어난다
    const upRatio = up.cl / upRigid.cl;
    const dnRatio = dn.cl / dnRigid.cl;
    expect(upRatio).toBeLessThan(0.97);
    expect(dnRatio).toBeGreaterThan(upRatio + 0.02);
  });
});

describe('항력 예산 (받음각 0 근처의 항력을 형상에서 항목별로 더한다)', () => {
  const cd0 = (g: PlaneGeometry, v: number): number => steadyCoeffs(prepareModel(g), 0, 0, v, false).cd;
  const presetGeom = (id: string, paperId = 'copy80', shaping: Partial<PlaneDesign['shaping']> = {}): PlaneGeometry => {
    const d = PRESETS.find((p) => p.id === id)!.design;
    return buildGeometry({ ...d, paperId, shaping: { ...d.shaping, elevatorDeg: 0, ...shaping } });
  };

  it('접은 종이비행기의 기생 항력 계수는 0.018~0.045 범위다(뒷전을 펴고 잰 값). 예전 모델의 0.015 까지 내려가지 않는다', () => {
    // 펄럭임 항력(흐물흐물한 종이가 빠른 바람에서 떠는 몫)은 따로 시험한다. 여기서는 그것이 없는 조건만 본다:
    // 일반 복사지 이상의 종이.
    for (const p of PRESETS) for (const paper of PAPERS) {
      if (paper.gsm < 80) continue;
      const g = presetGeom(p.id, paper.id);
      for (const v of [3, 5, 7, 10]) {
        const c = cd0(g, v);
        expect(c, `${p.id}/${paper.id} ${v} m/s`).toBeGreaterThan(0.018);
        expect(c, `${p.id}/${paper.id} ${v} m/s`).toBeLessThan(0.045);
      }
      // 속도가 올라가면 마찰 몫은 줄지만(층류) 압력 몫은 그대로라, 3 -> 10 m/s 에서 절반 아래로 떨어지지 않는다
      expect(cd0(g, 10) / cd0(g, 3), `${p.id}/${paper.id}`).toBeGreaterThan(0.5);
      expect(cd0(g, 10), `${p.id}/${paper.id}`).toBeLessThan(cd0(g, 3));
    }
  });

  it('항목별로 형상을 따른다: 앞을 두껍게 만 넓은 날개 > 다트, 깊은 동체 > 얕은 동체, 두꺼운 종이 > 얇은 종이', () => {
    // 앞전을 6번 만 글라이더는 뭉툭한 앞전 때문에 다트보다 크다
    expect(cd0(presetGeom('glider'), 6)).toBeGreaterThan(cd0(presetGeom('dart'), 6) * 1.15);
    // 동체를 깊게 접으면(같은 종이, 날개는 줄고 동체 넓이, 앞끝, 벌어진 뒤끝은 늘어난다) 항력 "넓이"(계수 x 날개 넓이)가 늘어난다
    const shallow = presetGeom('dart', 'copy80', { keelM: 0.012 }), deep = presetGeom('dart', 'copy80', { keelM: 0.04 });
    const dragArea = (g: PlaneGeometry): number => cd0(g, 6) * g.stats.wingAreaM2;
    expect(cd0(deep, 6)).toBeGreaterThan(cd0(shallow, 6) * 1.2);
    expect(dragArea(deep) / deep.stats.wingAreaM2).toBeGreaterThan(dragArea(shallow) / shallow.stats.wingAreaM2);
    // 같은 접기라도 두꺼운 종이는 접힌 가장자리가 두꺼워 조금 더 크다
    // (얇은 종이가 펄럭이지 않는 느린 바람 3 m/s 에서 견준다)
    for (const id of ['dart', 'glider', 'delta']) {
      expect(cd0(presetGeom(id, 'kent160'), 3), id).toBeGreaterThan(cd0(presetGeom(id, 'newsprint'), 3));
      expect(cd0(presetGeom(id, 'kent160'), 3), id).toBeLessThan(cd0(presetGeom(id, 'newsprint'), 3) * 1.4);
    }
    // 모델이 어림한 종이 두께는 실제 두께의 +-20% 안이다(강성에서 거꾸로 셈한 값)
    for (const paper of PAPERS) {
      const t = prepareModel(presetGeom('dart', paper.id)).paperThicknessM;
      expect(t / paper.thicknessM, paper.id).toBeGreaterThan(0.8);
      expect(t / paper.thicknessM, paper.id).toBeLessThan(1.2);
    }
  });

  it('최대 양항비는 종이비행기의 실측 범위(3~5)이고 그때의 받음각은 5~12도다', () => {
    for (const p of PRESETS) {
      const a = analyze(buildGeometry(p.design));
      expect(a.maxLD, p.id).toBeGreaterThan(3);
      expect(a.maxLD, p.id).toBeLessThan(5);
      let bestA = 0, best = 0;
      for (const q of a.polar) if (q.alphaDeg > 0 && q.cl / q.cd > best) { best = q.cl / q.cd; bestA = q.alphaDeg; }
      expect(bestA, p.id).toBeGreaterThanOrEqual(5);
      expect(bestA, p.id).toBeLessThanOrEqual(12);
    }
  });

  it('힘 계산 안의 마찰 식은 frictionCoeff 와 같다: 납작한 판 하나로 견준다', () => {
    // 겹이 없고(1겹) 동체가 없는 판: 받음각 0 의 항력 = 마찰 + 뭉툭한 가장자리 + 손접기 울퉁불퉁함
    // (접은 곳이 없는 판은 흐물흐물해서 펄럭이므로, 이 시험에서는 강성을 50배로 올려 펄럭임 몫을 없앤다.)
    const g = makeFixtureGeometry({ spanM: 0.2, rootChordM: 0.1, tipChordM: 0.1, sweepDeg: 0, keelDepthM: 0, dihedralDeg: 0, layers: 1, stiffnessFactor: 50 });
    const m = prepareModel(g);
    const v = 5;
    const friction = frictionCoeff((v * 0.1) / AIR.nu, 0);
    const edges = (0.7 * 1.5 * m.paperThicknessM + 0.4 * m.paperThicknessM) / 0.1;
    expect(steadyCoeffs(m, 0, 0, v, false).cd).toBeCloseTo(friction + edges + 0.004, 6);
  });
});

describe('analyze', () => {
  const dartG = makeFixtureGeometry(FIXTURE_DART);
  const gliderG = makeFixtureGeometry(FIXTURE_GLIDER);
  const dart = analyze(dartG);
  const glider = analyze(gliderG);

  it('받음각 -10~60도의 곡선을 돌려준다', () => {
    for (const a of [dart, glider]) {
      expect(a.polar[0]!.alphaDeg).toBe(-10);
      expect(a.polar[a.polar.length - 1]!.alphaDeg).toBe(60);
      expect(a.polar.length).toBeGreaterThanOrEqual(36);
      for (const p of a.polar) {
        expect(Number.isFinite(p.cl + p.cd + p.cm)).toBe(true);
        expect(p.cd).toBeGreaterThan(0);
      }
      const at = (deg: number) => a.polar.find((p) => p.alphaDeg === deg)!;
      expect(at(10).cl).toBeGreaterThan(at(5).cl);
      expect(at(-5).cl).toBeLessThan(0);
    }
  });

  it('기준 다트와 글라이더는 실측 범위에서 안정 활공한다 (활공비 3~6, 속도 3~7 m/s, 받음각 3~10도)', () => {
    for (const a of [dart, glider]) {
      expect(a.pitchStability).toBe('stable');
      expect(a.trimAlphaDeg).not.toBeNull();
      expect(a.trimAlphaDeg!).toBeGreaterThanOrEqual(3);
      expect(a.trimAlphaDeg!).toBeLessThanOrEqual(10);
      expect(a.trimSpeedMps!).toBeGreaterThanOrEqual(3);
      expect(a.trimSpeedMps!).toBeLessThanOrEqual(7);
      expect(a.glideRatio!).toBeGreaterThanOrEqual(3);
      expect(a.glideRatio!).toBeLessThanOrEqual(6);
      expect(a.maxLD).toBeGreaterThanOrEqual(a.glideRatio! - 1e-9);
      expect(a.maxLD).toBeLessThanOrEqual(7);
      expect(a.staticMargin).toBeGreaterThan(0);
      expect(a.reynolds).toBeGreaterThan(1e4);
      expect(a.reynolds).toBeLessThan(1e5);
      expect(a.notesKo.length).toBeGreaterThan(0);
      expect(a.lateralStability).not.toBe('unstable');
    }
    // 다트는 좁고 빠르고, 글라이더는 넓고 느리며 활공비가 더 좋다
    expect(dart.trimSpeedMps!).toBeGreaterThan(glider.trimSpeedMps! + 1);
    expect(glider.glideRatio!).toBeGreaterThan(dart.glideRatio!);
  });

  it('실속 받음각은 가로세로비가 작은 다트가 훨씬 크다', () => {
    expect(dart.stallAlphaDeg).toBeGreaterThanOrEqual(33);
    expect(glider.stallAlphaDeg).toBeGreaterThanOrEqual(17);
    expect(glider.stallAlphaDeg).toBeLessThanOrEqual(26);
  });

  it('안정 받음각에서 모멘트는 0 이고 기울기는 음수(복원)다. 속도는 양력 = 무게 조건과 맞는다', () => {
    for (const g of [dartG, gliderG]) {
      const a = analyze(g);
      const m = prepareModel(g);
      const c = steadyCoeffs(m, a.trimAlphaDeg! * DEG, 0, a.trimSpeedMps!);
      expect(Math.abs(c.cm)).toBeLessThan(2e-4);
      const lo = steadyCoeffs(m, (a.trimAlphaDeg! - 2) * DEG, 0, a.trimSpeedMps!);
      const hi = steadyCoeffs(m, (a.trimAlphaDeg! + 2) * DEG, 0, a.trimSpeedMps!);
      expect(lo.cm).toBeGreaterThan(0);
      expect(hi.cm).toBeLessThan(0);
      const force = 0.5 * AIR.rho * a.trimSpeedMps! ** 2 * g.stats.wingAreaM2 * Math.hypot(c.cl, c.cd);
      expect(force / (g.massKg * AIR.g)).toBeCloseTo(1, 2);
      expect(c.cl / c.cd).toBeCloseTo(a.glideRatio!, 1);
      // 중립점은 무게중심보다 뒤(더 음의 x)
      expect(a.neutralPointX).toBeLessThan(g.cg.x);
    }
  });

  it('무게중심 위치에 따른 판정: 뒤면 뒤집힘, 앞이면 기수 무거움, 사이에서만 안정', () => {
    for (const o of [FIXTURE_DART, FIXTURE_GLIDER]) {
      expect(analyze(makeFixtureGeometry({ ...o, cgFracMac: 0.5 })).pitchStability).toBe('tumble');
      expect(analyze(makeFixtureGeometry({ ...o, cgFracMac: 0.6 })).pitchStability).toBe('tumble');
      expect(analyze(makeFixtureGeometry({ ...o, cgFracMac: 0.1 })).pitchStability).toBe('nose-heavy');
      expect(analyze(makeFixtureGeometry({ ...o, cgFracMac: 0.28 })).pitchStability).toBe('stable');
      const aft = analyze(makeFixtureGeometry({ ...o, cgFracMac: 0.4 }));
      expect(['marginal', 'tumble']).toContain(aft.pitchStability);
      // 무게중심이 뒤로 갈수록 안정 받음각이 커진다 (작용점이 뒤로 가야 균형이 맞으므로)
      const a1 = analyze(makeFixtureGeometry({ ...o, cgFracMac: 0.265 })).trimAlphaDeg!;
      const a2 = analyze(makeFixtureGeometry({ ...o, cgFracMac: 0.29 })).trimAlphaDeg!;
      const a3 = analyze(makeFixtureGeometry({ ...o, cgFracMac: 0.32 })).trimAlphaDeg!;
      expect(a2).toBeGreaterThan(a1 + 1);
      expect(a3).toBeGreaterThan(a2 + 1);
    }
  });

  it('기수가 무거운 형상도 승강타를 올리면 안정 활공이 된다', () => {
    for (const o of [FIXTURE_DART, FIXTURE_GLIDER]) {
      const heavy = analyze(makeFixtureGeometry({ ...o, cgFracMac: 0.18 }));
      expect(heavy.pitchStability).toBe('nose-heavy');
      const fixed = analyze(makeFixtureGeometry({ ...o, cgFracMac: 0.18, elevatorDeg: 10 }));
      expect(fixed.pitchStability).toBe('stable');
      expect(fixed.trimAlphaDeg!).toBeGreaterThan(3);
      expect(fixed.glideRatio!).toBeGreaterThan(2);
      // 승강타를 더 올리면 받음각이 커지고 느려진다
      const more = analyze(makeFixtureGeometry({ ...o, cgFracMac: 0.18, elevatorDeg: 16 }));
      expect(more.trimAlphaDeg!).toBeGreaterThan(fixed.trimAlphaDeg!);
      expect(more.trimSpeedMps!).toBeLessThan(fixed.trimSpeedMps!);
    }
  });

  it('무거운 종이는 더 빠르게, 비슷한 활공비로 난다. 얇은 종이는 느리다', () => {
    for (const o of [FIXTURE_DART, FIXTURE_GLIDER]) {
      const a80 = analyze(makeFixtureGeometry({ ...o, paper: fixturePaper(80) }));
      const a120 = analyze(makeFixtureGeometry({ ...o, paper: fixturePaper(120) }));
      const a160 = analyze(makeFixtureGeometry({ ...o, paper: fixturePaper(160) }));
      const a45 = analyze(makeFixtureGeometry({ ...o, paper: fixturePaper(45) }));
      expect(a120.trimSpeedMps!).toBeGreaterThan(a80.trimSpeedMps! * 1.1);
      expect(a160.trimSpeedMps!).toBeGreaterThan(a120.trimSpeedMps! * 1.05);
      expect(a45.trimSpeedMps!).toBeLessThan(a80.trimSpeedMps! * 0.9);
      expect(Math.abs(a120.glideRatio! / a80.glideRatio! - 1)).toBeLessThan(0.15);
      expect(Math.abs(a160.glideRatio! / a80.glideRatio! - 1)).toBeLessThan(0.15);
    }
  });

  it('좌우 안정성: 하반각(날개 끝이 내려감)이면 불안정으로 판정한다', () => {
    expect(analyze(makeFixtureGeometry({ ...FIXTURE_GLIDER, dihedralDeg: -10, keelDepthM: 0 })).lateralStability).toBe('unstable');
    const d0 = detail(makeFixtureGeometry({ ...FIXTURE_GLIDER, dihedralDeg: 0 }));
    const d15 = detail(makeFixtureGeometry({ ...FIXTURE_GLIDER, dihedralDeg: 15 }));
    expect(d15.rollRestoring).toBeGreaterThan(d0.rollRestoring);
    // 날개 끝 세움은 요 복원력을 키운다 (후퇴각이 있는 날개 끝은 무게중심보다 뒤에 있다)
    const w = detail(makeFixtureGeometry({ ...FIXTURE_GLIDER, sweepDeg: 30, wingletM: 0.02, wingletDeg: 80 }));
    const nw = detail(makeFixtureGeometry({ ...FIXTURE_GLIDER, sweepDeg: 30 }));
    expect(w.yawRestoring).toBeGreaterThan(nw.yawRestoring);
  });

  it('극단적인 형상에서도 모든 값이 유한하다', () => {
    const shapes = [
      { spanM: 0.03, rootChordM: 0.25, tipChordM: 0.005 },             // AR 약 0.2
      { spanM: 0.3, rootChordM: 0.04, tipChordM: 0.035, sweepDeg: 0 }, // AR 8
      { spanM: 0.02, rootChordM: 0.02, tipChordM: 0.01 },              // 아주 작은 날개
      { ...FIXTURE_DART, massKg: 0.002 }, { ...FIXTURE_GLIDER, massKg: 0.012 },
      { ...FIXTURE_GLIDER, cgFracMac: 1.2 }, { ...FIXTURE_GLIDER, cgFracMac: -0.5 },
      { ...FIXTURE_GLIDER, paper: fixturePaper(40), stiffnessFactor: 0.2 },
    ];
    for (const sh of shapes) {
      const a = analyze(makeFixtureGeometry(sh));
      const nums = [a.maxLD, a.stallAlphaDeg, a.neutralPointX, a.staticMargin, a.reynolds,
        a.trimAlphaDeg ?? 0, a.trimSpeedMps ?? 0, a.glideRatio ?? 0, ...a.polar.flatMap((p) => [p.cl, p.cd, p.cm])];
      for (const n of nums) expect(Number.isFinite(n)).toBe(true);
      expect(a.notesKo.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
    }
    // 띠가 하나도 없는 형상
    const empty = makeFixtureGeometry(FIXTURE_DART);
    empty.elements = [];
    const a = analyze(empty);
    expect(a.trimAlphaDeg).toBeNull();
    expect(Number.isFinite(a.maxLD + a.staticMargin + a.neutralPointX)).toBe(true);
  });
});
