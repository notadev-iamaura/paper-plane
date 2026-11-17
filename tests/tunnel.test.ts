/**
 * 바람 실험실(풍동) 계약 시험. TUNNEL_CONTRACT.md 의 약속을 공개 창구(src/core/index.ts)만으로 확인한다.
 * 풍동은 비행 계산과 같은 힘 모델을 쓰므로, 분석 화면(analyze)과 숫자가 맞아야 한다.
 */
import { describe, expect, it } from 'vitest';
import {
  PAPERS, PHYSICS_VERSION, PRESETS, TUNNEL_LIMITS, analyze, buildGeometry, probeTunnel, tunnelTrim, validateDesign,
  type PlaneDesign, type PlaneGeometry, type TunnelReading,
} from '../src/core/index';
import { makeLcg, randomDesign } from './helpers';

const preset = (id: string, paperId = 'copy80'): PlaneDesign => {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`프리셋 없음: ${id}`);
  return { ...(JSON.parse(JSON.stringify(p.design)) as PlaneDesign), paperId };
};
const geomOf = (id: string, paperId = 'copy80'): PlaneGeometry => buildGeometry(preset(id, paperId));

function nonFinite(o: unknown, path: string, out: string[]): void {
  if (out.length > 5) return;
  if (typeof o === 'number') { if (!Number.isFinite(o)) out.push(path); }
  else if (Array.isArray(o)) o.forEach((v, i) => nonFinite(v, `${path}[${i}]`, out));
  else if (o !== null && typeof o === 'object') for (const k of Object.keys(o)) nonFinite((o as Record<string, unknown>)[k], `${path}.${k}`, out);
}

function checkShape(r: TunnelReading, g: PlaneGeometry, label: string): void {
  const bad: string[] = [];
  nonFinite(r, 'reading', bad);
  expect(bad, label).toEqual([]);
  expect(r.elements.length, label).toBe(g.elements.length);
  r.elements.forEach((e, i) => expect(e.index, label).toBe(i));
  expect(r.stalledFraction, label).toBeGreaterThanOrEqual(0);
  expect(r.stalledFraction, label).toBeLessThanOrEqual(1);
  expect(typeof r.buckled, label).toBe('boolean');
  expect(r.weightN, label).toBeCloseTo(g.massKg * 9.81, 12);
  expect(r.centerOfPressureX, label).toBeLessThanOrEqual(1e-12);
  expect(r.centerOfPressureX, label).toBeGreaterThanOrEqual(-g.stats.lengthM - 1e-12);
}

describe('풍동: 한도와 판 번호', () => {
  it('TUNNEL_LIMITS 는 계약서 값 그대로다', () => {
    expect(TUNNEL_LIMITS).toEqual({ speedMin: 0, speedMax: 14, alphaMin: -20, alphaMax: 60, betaMin: -30, betaMax: 30 });
  });
  it('PHYSICS_VERSION 은 2 (이번 균형 재조정)', () => {
    expect(PHYSICS_VERSION).toBe(2);
  });
});

describe('풍동: 힘의 기본 성질', () => {
  it('휨이 거의 없는 단단한 종이에서는 힘이 속도의 제곱에 비례한다', () => {
    // 켄트지 다트를 느린 바람(종이가 거의 휘지 않는 구간)에서 잰다. 마찰 계수는 속도에 따라 조금 변하므로
    // (레이놀즈수) 항력에는 여유를 더 둔다.
    const g = geomOf('dart', 'kent160');
    for (const alphaDeg of [4, 8, 15]) {
      const a = probeTunnel(g, { speedMps: 2, alphaDeg });
      const b = probeTunnel(g, { speedMps: 4, alphaDeg });
      expect(Math.abs(a.flexLeftDeg), `flex ${alphaDeg}`).toBeLessThan(1);
      expect(Math.abs(b.flexLeftDeg), `flex ${alphaDeg}`).toBeLessThan(1);
      expect(b.buckled).toBe(false);
      expect(b.liftN / a.liftN, `lift ${alphaDeg}`).toBeGreaterThan(4 * 0.97);
      expect(b.liftN / a.liftN, `lift ${alphaDeg}`).toBeLessThan(4 * 1.03);
      expect(b.pitchMomentNm / a.pitchMomentNm, `moment ${alphaDeg}`).toBeGreaterThan(4 * 0.9);
      expect(b.pitchMomentNm / a.pitchMomentNm, `moment ${alphaDeg}`).toBeLessThan(4 * 1.1);
      // 항력: 압력에서 오는 몫은 속도의 제곱, 표면 마찰은 층류라 속도의 1.5제곱에 비례한다(마찰 계수 ∝ 1/sqrt(레이놀즈수)).
      // 그래서 속도를 2배로 하면 2^1.5 = 2.83배와 4배 사이가 된다. 받음각이 클수록(압력 몫이 클수록) 4배에 가깝다.
      expect(b.dragN / a.dragN, `drag ${alphaDeg}`).toBeGreaterThan(2 ** 1.5);
      expect(b.dragN / a.dragN, `drag ${alphaDeg}`).toBeLessThanOrEqual(4.0001);
      if (alphaDeg >= 15) expect(b.dragN / a.dragN, `drag ${alphaDeg}`).toBeGreaterThan(4 * 0.93);
      // 계수로 보면 거의 같다
      expect(Math.abs(b.cl - a.cl) / Math.abs(a.cl), `cl ${alphaDeg}`).toBeLessThan(0.03);
    }
  });

  it('바람이 없으면 모든 힘이 0 이고 작용점은 무게중심이다', () => {
    const g = geomOf('glider');
    const r = probeTunnel(g, { speedMps: 0, alphaDeg: 10 });
    checkShape(r, g, 'zero wind');
    for (const k of ['liftN', 'dragN', 'sideN', 'pitchMomentNm', 'rollMomentNm', 'yawMomentNm', 'cl', 'cd', 'cm', 'liftToWeight', 'liftToDrag', 'flexLeftDeg', 'flexRightDeg', 'stalledFraction'] as const) {
      expect(r[k], k).toBe(0);
    }
    expect(r.buckled).toBe(false);
    expect(r.centerOfPressureX).toBe(g.cg.x);
    expect(tunnelTrim(g, 0)).toEqual({ alphaDeg: null, stable: false, liftToWeight: 0 });
  });

  it('좌우 대칭 기체는 옆바람이 없으면 옆힘, 롤, 요 모멘트가 0 이고 좌우 휨이 같다', () => {
    for (const p of PRESETS) {
      const g = buildGeometry(p.design);
      for (const alphaDeg of [-5, 0, 6, 20, 45]) {
        const r = probeTunnel(g, { speedMps: 6, alphaDeg });
        const scale = Math.max(Math.abs(r.liftN), Math.abs(r.dragN), 1e-6);
        expect(Math.abs(r.sideN) / scale, `${p.id} ${alphaDeg}`).toBeLessThan(1e-9);
        expect(Math.abs(r.rollMomentNm) / (scale * g.stats.spanM), `${p.id} ${alphaDeg}`).toBeLessThan(1e-9);
        expect(Math.abs(r.yawMomentNm) / (scale * g.stats.spanM), `${p.id} ${alphaDeg}`).toBeLessThan(1e-9);
        expect(r.flexLeftDeg, `${p.id} ${alphaDeg}`).toBeCloseTo(r.flexRightDeg, 9);
      }
    }
  });

  it('옆바람을 주면 옆힘이 생기고, 좌우를 뒤집으면 부호만 바뀐다. 기수를 왼쪽으로 돌리면(+) 오른쪽에서 바람을 맞아 왼쪽으로 밀린다', () => {
    for (const p of PRESETS) {
      const g = buildGeometry(p.design);
      const a = probeTunnel(g, { speedMps: 6, alphaDeg: 5, betaDeg: 12 });
      const b = probeTunnel(g, { speedMps: 6, alphaDeg: 5, betaDeg: -12 });
      expect(a.sideN, p.id).toBeGreaterThan(0);
      expect(a.sideN, p.id).toBeCloseTo(-b.sideN, 9);
      expect(a.liftN, p.id).toBeCloseTo(b.liftN, 9);
      expect(a.dragN, p.id).toBeCloseTo(b.dragN, 9);
      expect(a.rollMomentNm, p.id).toBeCloseTo(-b.rollMomentNm, 9);
      expect(a.yawMomentNm, p.id).toBeCloseTo(-b.yawMomentNm, 9);
      // 풍향계 안정: 기수가 왼쪽으로 돌아가 있으면 오른쪽(-)으로 되돌리는 요 모멘트가 생긴다(프리셋은 모두 방향 안정).
      expect(a.yawMomentNm, p.id).toBeLessThan(0);
      // 생략한 betaDeg 는 0 과 같다
      expect(probeTunnel(g, { speedMps: 6, alphaDeg: 5 })).toEqual(probeTunnel(g, { speedMps: 6, alphaDeg: 5, betaDeg: 0 }));
    }
  });

  it('띠별 힘을 모두 더하면 전체 힘과 같다(기체 좌표의 힘을 풍동 좌표로 돌려 비교)', () => {
    const DEG = Math.PI / 180;
    for (const p of PRESETS) {
      const g = buildGeometry(p.design);
      for (const [speedMps, alphaDeg, betaDeg] of [[5, 6, 0], [9, 18, 10], [3, -8, -20], [12, 40, 5]] as const) {
        const r = probeTunnel(g, { speedMps, alphaDeg, betaDeg });
        let fx = 0, fy = 0, fz = 0;
        for (const e of r.elements) { fx += e.forceBody.x; fy += e.forceBody.y; fz += e.forceBody.z; }
        const sa = Math.sin(alphaDeg * DEG), ca = Math.cos(alphaDeg * DEG), sb = Math.sin(betaDeg * DEG), cb = Math.cos(betaDeg * DEG);
        const fwd = fx * ca - fz * sa;
        const lift = fx * sa + fz * ca;
        const drag = -(fwd * cb - fy * sb);
        const side = fwd * sb + fy * cb;
        const label = `${p.id} ${speedMps} ${alphaDeg} ${betaDeg}`;
        expect(lift, label).toBeCloseTo(r.liftN, 10);
        expect(drag, label).toBeCloseTo(r.dragN, 10);
        expect(side, label).toBeCloseTo(r.sideN, 10);
        // 파생 값들의 정의
        expect(r.liftToWeight, label).toBeCloseTo(r.liftN / r.weightN, 10);
        expect(r.liftToDrag, label).toBeCloseTo(r.liftN / r.dragN, 9);
        const qS = 0.5 * 1.225 * speedMps * speedMps * g.stats.wingAreaM2;
        expect(r.cl, label).toBeCloseTo(r.liftN / qS, 9);
        expect(r.cd, label).toBeCloseTo(r.dragN / qS, 9);
        expect(r.cm, label).toBeCloseTo(r.pitchMomentNm / (qS * g.stats.macM), 9);
        expect(r.dragN, label).toBeGreaterThan(0);
      }
    }
  });

  it('받음각을 키우면 실속한 면적 비율이 0 근처에서 1 근처로 늘어난다(줄어들지 않는다)', () => {
    for (const p of PRESETS) {
      const g = buildGeometry(p.design);
      const stall = analyze(g).stallAlphaDeg;
      let prev = -1;
      for (let a = 0; a <= 60; a += 2) {
        const r = probeTunnel(g, { speedMps: 5, alphaDeg: a });
        expect(r.stalledFraction, `${p.id} ${a}`).toBeGreaterThanOrEqual(prev - 0.02);
        prev = r.stalledFraction;
      }
      expect(probeTunnel(g, { speedMps: 5, alphaDeg: 4 }).stalledFraction, p.id).toBeLessThan(0.1);
      expect(probeTunnel(g, { speedMps: 5, alphaDeg: 60 }).stalledFraction, p.id).toBeGreaterThan(0.9);
      // 실속 받음각을 넉넉히 지나면 날개 띠 대부분이 '실속' 표시가 된다
      const after = probeTunnel(g, { speedMps: 5, alphaDeg: Math.min(60, stall + 20) });
      const wings = after.elements.filter((e) => g.elements[e.index]!.kind === 'wing');
      expect(wings.filter((e) => e.stalled).length / wings.length, p.id).toBeGreaterThan(0.8);
      const before = probeTunnel(g, { speedMps: 5, alphaDeg: 4 });
      expect(before.elements.filter((e) => g.elements[e.index]!.kind === 'wing' && e.stalled).length, p.id).toBe(0);
      // 띠가 느끼는 받음각은 작은 휨에서는 고정대의 받음각과 비슷하다
      const mid = before.elements.filter((e) => g.elements[e.index]!.kind === 'wing');
      for (const e of mid) expect(Math.abs(e.alphaDeg - 4), p.id).toBeLessThan(3);
    }
  });
});

describe('풍동: 종이 휨과 꺾임', () => {
  it('얇은 종이의 넓은 날개는 센 바람과 큰 받음각에서 꺾이고(buckled), 빳빳한 종이는 같은 바람을 버틴다', () => {
    const thin = geomOf('glider', 'newsprint');
    const stiff = geomOf('glider', 'kent160');
    // 약한 바람: 둘 다 버틴다. 얇은 종이가 훨씬 많이 휜다.
    const t0 = probeTunnel(thin, { speedMps: 3, alphaDeg: 9 });
    const s0 = probeTunnel(stiff, { speedMps: 3, alphaDeg: 9 });
    expect(t0.buckled).toBe(false);
    expect(s0.buckled).toBe(false);
    expect(t0.flexLeftDeg).toBeGreaterThan(5);
    expect(t0.flexLeftDeg).toBeGreaterThan(s0.flexLeftDeg * 5);
    // 가장 센 바람에 받음각 12도: 신문지는 꺾여 날개가 35도 넘게 접히고 뜨는 힘을 크게 잃는다
    const t1 = probeTunnel(thin, { speedMps: TUNNEL_LIMITS.speedMax, alphaDeg: 12 });
    const s1 = probeTunnel(stiff, { speedMps: TUNNEL_LIMITS.speedMax, alphaDeg: 12 });
    expect(t1.buckled).toBe(true);
    expect(t1.flexLeftDeg).toBeGreaterThan(35);
    expect(t1.flexLeftDeg).toBeLessThanOrEqual(81);
    expect(s1.buckled).toBe(false);
    expect(s1.flexLeftDeg).toBeLessThan(15);
    expect(t1.cl).toBeLessThan(s1.cl * 0.6);
    // 펄럭임 때문에 막는 힘의 계수는 오히려 크다(받음각 0 에서 비교)
    expect(probeTunnel(thin, { speedMps: TUNNEL_LIMITS.speedMax, alphaDeg: 0 }).cd)
      .toBeGreaterThan(probeTunnel(stiff, { speedMps: TUNNEL_LIMITS.speedMax, alphaDeg: 0 }).cd + 0.1);
    // 바람을 정면이 아니라 아래에서(음의 받음각) 받으면 아래로 휜다
    expect(probeTunnel(thin, { speedMps: 5, alphaDeg: -9 }).flexLeftDeg).toBeLessThan(-3);
  });

  it('일반 복사지 프리셋은 안정 활공 조건에서 몇 도만 휘고, 풍동의 가장 센 바람에서도 안정 받음각이면 꺾이지 않는다', () => {
    for (const p of PRESETS) {
      const g = buildGeometry(p.design);
      const a = analyze(g);
      const trim = probeTunnel(g, { speedMps: a.trimSpeedMps!, alphaDeg: a.trimAlphaDeg! });
      expect(trim.flexLeftDeg, p.id).toBeGreaterThan(0);
      expect(trim.flexLeftDeg, p.id).toBeLessThan(5);
      expect(trim.buckled, p.id).toBe(false);
      // 던지기 한도(10 m/s)에서 안정 받음각: 버틴다
      expect(probeTunnel(g, { speedMps: 10, alphaDeg: a.trimAlphaDeg! }).buckled, p.id).toBe(false);
    }
  });
});

describe('풍동과 분석 화면의 일치', () => {
  for (const p of PRESETS) {
    for (const paperId of ['newsprint', 'copy80', 'kent160']) {
      it(`${p.id}/${paperId}: 분석이 말한 안정 받음각, 안정 속도에서 뜨는 힘 = 무게, 피치 모멘트 = 0, tunnelTrim 이 같은 각을 찾는다`, () => {
        const g = geomOf(p.id, paperId);
        const a = analyze(g);
        expect(a.trimAlphaDeg).not.toBeNull();
        expect(a.trimSpeedMps).not.toBeNull();
        expect(a.trimSpeedMps!).toBeLessThanOrEqual(TUNNEL_LIMITS.speedMax);
        const r = probeTunnel(g, { speedMps: a.trimSpeedMps!, alphaDeg: a.trimAlphaDeg! });
        checkShape(r, g, p.id);
        // 안정 활공에서는 양력과 항력을 합친 공기 힘이 무게와 같다
        expect(Math.hypot(r.liftN, r.dragN) / r.weightN).toBeGreaterThan(0.99);
        expect(Math.hypot(r.liftN, r.dragN) / r.weightN).toBeLessThan(1.01);
        expect(r.liftToWeight).toBeGreaterThan(0.9);
        expect(r.liftToWeight).toBeLessThanOrEqual(1.001);
        expect(r.liftToDrag / a.glideRatio!).toBeGreaterThan(0.99);
        expect(r.liftToDrag / a.glideRatio!).toBeLessThan(1.01);
        // 모멘트는 0 (기준: 양력 x 평균 시위의 0.2% 이내)
        expect(Math.abs(r.pitchMomentNm) / (r.weightN * g.stats.macM)).toBeLessThan(0.002);
        expect(Math.abs(r.cm)).toBeLessThan(0.002);
        expect(r.buckled).toBe(false);
        const t = tunnelTrim(g, a.trimSpeedMps!);
        expect(t.alphaDeg).not.toBeNull();
        expect(t.stable).toBe(true);
        expect(Math.abs(t.alphaDeg! - a.trimAlphaDeg!)).toBeLessThan(0.05);
        expect(t.liftToWeight).toBeCloseTo(probeTunnel(g, { speedMps: a.trimSpeedMps!, alphaDeg: t.alphaDeg! }).liftToWeight, 12);
        // 안정한 평형: 받음각을 2도 키우면 숙이는(-) 모멘트, 2도 줄이면 드는(+) 모멘트
        expect(probeTunnel(g, { speedMps: a.trimSpeedMps!, alphaDeg: t.alphaDeg! + 2 }).pitchMomentNm).toBeLessThan(0);
        expect(probeTunnel(g, { speedMps: a.trimSpeedMps!, alphaDeg: t.alphaDeg! - 2 }).pitchMomentNm).toBeGreaterThan(0);
        // 분석 화면의 곡선과 같은 계수
        const pt = a.polar.find((q) => q.alphaDeg === 10)!;
        const r10 = probeTunnel(g, { speedMps: a.trimSpeedMps!, alphaDeg: 10 });
        // (분석은 안정 속도를 찾는 마지막 걸음의 속도로 곡선을 그리므로 레이놀즈수 차이만큼 아주 조금 다를 수 있다)
        expect(r10.cl).toBeCloseTo(pt.cl, 3);
        expect(r10.cd).toBeCloseTo(pt.cd, 3);
        expect(r10.cm).toBeCloseTo(pt.cm, 3);
      });
    }
  }

  it('무게중심이 뒤에 있어 스스로 서지 못하는 종이(펼친 종이)는 낮은 받음각의 안정 평형이 없다', () => {
    const flat: PlaneDesign = { v: 1, paperId: 'copy80', folds: [], shaping: { keelM: 0.02, dihedralDeg: 10, wingletM: 0, wingletDeg: 0, elevatorDeg: 0 }, clip: null };
    const g = buildGeometry(flat);
    const t = tunnelTrim(g, 5);
    const a = analyze(g);
    if (t.alphaDeg !== null && t.stable) {
      // 평형이 있더라도 실속 뒤의 큰 받음각(바람을 정면으로 받는 자세)이다
      expect(t.alphaDeg).toBeGreaterThan(25);
    }
    expect(a.pitchStability).toBe('tumble');
  });
});

describe('풍동: 입력 자르기, 결정성, 견고성', () => {
  it('한도를 벗어난 입력은 한도 값으로 잘라 쓴다. 숫자가 아닌 값은 0 으로 본다', () => {
    const g = geomOf('delta');
    const L = TUNNEL_LIMITS;
    expect(probeTunnel(g, { speedMps: 99, alphaDeg: 200, betaDeg: 77 })).toEqual(probeTunnel(g, { speedMps: L.speedMax, alphaDeg: L.alphaMax, betaDeg: L.betaMax }));
    expect(probeTunnel(g, { speedMps: -3, alphaDeg: -200, betaDeg: -77 })).toEqual(probeTunnel(g, { speedMps: L.speedMin, alphaDeg: L.alphaMin, betaDeg: L.betaMin }));
    expect(probeTunnel(g, { speedMps: NaN, alphaDeg: Infinity, betaDeg: NaN })).toEqual(probeTunnel(g, { speedMps: 0, alphaDeg: 0, betaDeg: 0 }));
    expect(probeTunnel(g, { speedMps: 6, alphaDeg: 5, betaDeg: undefined })).toEqual(probeTunnel(g, { speedMps: 6, alphaDeg: 5 }));
    expect(tunnelTrim(g, 99)).toEqual(tunnelTrim(g, L.speedMax));
    expect(tunnelTrim(g, -1)).toEqual(tunnelTrim(g, 0));
    expect(tunnelTrim(g, NaN)).toEqual(tunnelTrim(g, 0));
  });

  it('같은 입력이면 완전히 같은 결과이고 호출 순서와 무관하며 입력을 건드리지 않는다', () => {
    const g1 = geomOf('stealth', 'newsprint');
    const g2 = geomOf('dart', 'kent160');
    const snap = JSON.stringify(g1);
    const inp = { speedMps: 11.3, alphaDeg: 13.7, betaDeg: -8.2 };
    const a = probeTunnel(g1, inp);
    probeTunnel(g2, { speedMps: 14, alphaDeg: 60, betaDeg: 30 });
    tunnelTrim(g2, 7);
    const b = probeTunnel(g1, inp);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(tunnelTrim(g1, 6.1))).toBe(JSON.stringify(tunnelTrim(g1, 6.1)));
    expect(JSON.stringify(g1)).toBe(snap);
    expect(inp).toEqual({ speedMps: 11.3, alphaDeg: 13.7, betaDeg: -8.2 });
  });

  it('프리셋 x 종이 x (속도, 받음각, 옆바람) 격자에서 모든 출력이 유한하다', () => {
    for (const p of PRESETS) for (const paper of PAPERS) {
      const g = geomOf(p.id, paper.id);
      for (const speedMps of [0, 0.5, 4, 9, 14]) for (const alphaDeg of [-20, -3, 0, 5, 12, 25, 60]) for (const betaDeg of [-30, 0, 15]) {
        checkShape(probeTunnel(g, { speedMps, alphaDeg, betaDeg }), g, `${p.id}/${paper.id} ${speedMps} ${alphaDeg} ${betaDeg}`);
      }
      for (const v of [0.5, 3, 7, 14]) {
        const t = tunnelTrim(g, v);
        if (t.alphaDeg !== null) {
          expect(Number.isFinite(t.alphaDeg)).toBe(true);
          expect(t.alphaDeg).toBeGreaterThanOrEqual(TUNNEL_LIMITS.alphaMin);
          expect(t.alphaDeg).toBeLessThanOrEqual(TUNNEL_LIMITS.alphaMax);
        }
        expect(Number.isFinite(t.liftToWeight)).toBe(true);
      }
    }
  });

  it('임의 자유접기 300개에서도 예외 없이 유한한 값을 낸다', () => {
    const rnd = makeLcg(20261116);
    let done = 0;
    for (let i = 0; i < 400 && done < 300; i++) {
      const d = randomDesign(rnd);
      d.shaping.keelM = Math.round(d.shaping.keelM * 1e4) / 1e4;
      if (!validateDesign(d).ok) continue;
      done++;
      const g = buildGeometry(d);
      const inp = { speedMps: rnd() * 16 - 1, alphaDeg: rnd() * 100 - 30, betaDeg: rnd() * 80 - 40 };
      checkShape(probeTunnel(g, inp), g, JSON.stringify(inp));
      const t = tunnelTrim(g, rnd() * 14);
      expect(Number.isFinite(t.liftToWeight)).toBe(true);
      expect(t.alphaDeg === null || Number.isFinite(t.alphaDeg)).toBe(true);
    }
    expect(done).toBeGreaterThan(200);
  });
});
