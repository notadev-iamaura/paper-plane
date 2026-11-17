import { describe, expect, it } from 'vitest';
import { buildGeometry, LIMITS as APP_LIMITS, PAPERS, PRESETS, probeTunnel, TUNNEL_LIMITS, tunnelTrim } from '../src/core/index';
import type { PlaneGeometry, TunnelReading } from '../src/core/index';
import { buildPresetDesign } from '../src/core/presets';
import { bodyToWind, buildFlowModel, DOWNWASH_MAX_DEG, flowPoint, rakeHeights, roughen, vortexPoint } from '../src/app/lib/lab/flowModel';
import type { FlowPointOut } from '../src/app/lib/lab/flowModel';
import {
  arrowLength, ARROW_MAX_RATIO, ARROW_WEIGHT_LEN_M, balanceOutcome, experimentLesson, findFavouriteSpeed, favouriteSpeedAsync, fmtGrams, G0, gfText, gramsForce,
  isStalledView, labNoteLines, labNoteShort, liftHeadline, measureLabNote, nearBest, newtonText, noseWord, probeMemo, reviveLabNote, snapAlpha, snapSpeed,
  starsOf, strongWind, sweepAlpha, WIND_WORD, windLevel,
} from '../src/app/lib/lab/labMath';
import type { TunnelDeps } from '../src/app/lib/lab/labMath';
import { reviveLabProgress } from '../src/app/lib/lab/labStore';

const LIMITS = { speedMin: 0, speedMax: 14, alphaMin: -20, alphaMax: 60, betaMin: -30, betaMax: 30 };
const CORE: TunnelDeps = { probe: probeTunnel, trim: tunnelTrim, limits: TUNNEL_LIMITS };
const dart = buildGeometry(buildPresetDesign('dart', undefined, 'copy80'));

/** 가짜 형상(계산에는 쓰지 않고 기억해 두는 열쇠로만 쓴다) */
const fakeGeom = (): PlaneGeometry => ({ ...dart });

function reading(over: Partial<TunnelReading> = {}): TunnelReading {
  return {
    liftN: 0.05, dragN: 0.012, sideN: 0, pitchMomentNm: 0, rollMomentNm: 0, yawMomentNm: 0, weightN: 0.049, liftToWeight: 1.02, liftToDrag: 4.2,
    cl: 0.3, cd: 0.07, cm: 0, flexLeftDeg: 2, flexRightDeg: 2, buckled: false, stalledFraction: 0, centerOfPressureX: -0.1,
    elements: dart.elements.map((_, index) => ({ index, forceBody: { x: 0, y: 0, z: 0 }, pointBody: { x: 0, y: 0, z: 0 }, alphaDeg: 5, stalled: false })),
    ...over,
  };
}

describe('그램으로 적기', () => {
  it('뉴턴을 그램중으로 바꾼다: 1 g 의 물건을 드는 힘이 1 g', () => {
    expect(gramsForce(G0 / 1000)).toBeCloseTo(1, 12);
    expect(gramsForce(0.049)).toBeCloseTo(4.9966, 3);
    expect(gramsForce(Number.NaN)).toBe(0);
  });
  it('10 g 미만은 소수 한 자리, 그 이상은 정수, -0 은 없다', () => {
    expect(fmtGrams(5.24)).toBe('5.2');
    expect(fmtGrams(9.94)).toBe('9.9');
    expect(fmtGrams(9.96)).toBe('10');
    expect(fmtGrams(23.4)).toBe('23');
    expect(fmtGrams(-0.02)).toBe('0.0');
    expect(fmtGrams(-3.26)).toBe('-3.3');
    expect(fmtGrams(Number.POSITIVE_INFINITY)).toBe('–');
    expect(gfText(0.0514)).toBe('5.2');
    expect(newtonText(0.05136)).toBe('0.051 N');
    expect(newtonText(-0.0001)).toBe('0.000 N');
  });
});

describe('아이 말', () => {
  it('바람 이름은 가장 센 바람에 대한 비율로 나눈다', () => {
    expect(windLevel(0, 14)).toBe('none');
    expect(windLevel(0.5, 14)).toBe('breeze');
    expect(windLevel(4, 14)).toBe('breeze');
    expect(windLevel(4.5, 14)).toBe('normal');
    expect(windLevel(9, 14)).toBe('normal');
    expect(windLevel(9.5, 14)).toBe('strong');
    expect(windLevel(5, 28)).toBe('breeze');
    expect(WIND_WORD.breeze).toBe('산들바람');
    expect(WIND_WORD.normal).toBe('보통 바람');
    expect(WIND_WORD.strong).toBe('센 바람');
  });
  it('한마디: 뜨는 힘이 무게 이상이면 뜰 수 있어요', () => {
    expect(liftHeadline({ liftToWeight: 1, liftN: 0.05 }, 6)).toEqual({ ok: true, text: '뜰 수 있어요!' });
    expect(liftHeadline({ liftToWeight: 0.999, liftN: 0.05 }, 6).text).toBe('조금 모자라요');
    expect(liftHeadline({ liftToWeight: -0.2, liftN: -0.01 }, 6).text).toBe('아래로 눌려요');
    expect(liftHeadline({ liftToWeight: 0, liftN: 0 }, 0).ok).toBe(false);
  });
  it('별과 고개 말', () => {
    expect(starsOf(0)).toBe(0);
    expect(starsOf(-2)).toBe(0);
    expect(starsOf(3.4)).toBe(3);
    expect(starsOf(9)).toBe(5);
    expect(noseWord(0)).toBe('고개가 똑바로');
    expect(noseWord(5)).toBe('고개를 살짝 듦');
    expect(noseWord(-12)).toBe('고개를 푹 숙임');
  });
  it('실속 설명은 바람이 불고 날개의 삼분의 일쯤이 떨어져 나갔을 때 띄운다', () => {
    expect(isStalledView({ stalledFraction: 0.5 }, 0)).toBe(false);
    expect(isStalledView({ stalledFraction: 0.2 }, 6)).toBe(false);
    expect(isStalledView({ stalledFraction: 0.4 }, 6)).toBe(true);
  });
  it('화살표 길이는 뉴턴에 비례하고 너무 길면 자른다', () => {
    expect(arrowLength(0.049, 0.049).lengthM).toBeCloseTo(ARROW_WEIGHT_LEN_M, 12);
    expect(arrowLength(0.0245, 0.049).lengthM).toBeCloseTo(ARROW_WEIGHT_LEN_M / 2, 12);
    expect(arrowLength(-0.049, 0.049).lengthM).toBeCloseTo(-ARROW_WEIGHT_LEN_M, 12);
    const big = arrowLength(1, 0.049);
    expect(big.clipped).toBe(true);
    expect(big.lengthM).toBeCloseTo(ARROW_WEIGHT_LEN_M * ARROW_MAX_RATIO, 12);
    expect(arrowLength(1, 0).lengthM).toBe(0);
  });
  it('입력은 한도 안으로, 칸에 맞춰 다듬는다', () => {
    expect(snapSpeed(6.26, LIMITS)).toBe(6.5);
    expect(snapSpeed(99, LIMITS)).toBe(14);
    expect(snapSpeed(-3, LIMITS)).toBe(0);
    expect(snapAlpha(12.4, LIMITS)).toBe(12);
    expect(snapAlpha(80, LIMITS)).toBe(60);
    expect(snapAlpha(-80, LIMITS)).toBe(-20);
    expect(strongWind(LIMITS)).toBe(10);
  });
});

describe('좋아하는 속도 찾기', () => {
  /** 균형 각도는 늘 4도, 뜨는 힘 / 무게 = (v / v0)^2 인 가짜 비행기 */
  const fake = (v0: number, opts: { stableFrom?: number; calls?: number[] } = {}): TunnelDeps => ({
    probe: () => reading(),
    trim: (_g, v) => {
      opts.calls?.push(v);
      const stable = v >= (opts.stableFrom ?? 0);
      return { alphaDeg: stable ? 4 : null, stable, liftToWeight: stable ? (v / v0) ** 2 : 0 };
    },
    limits: LIMITS,
  });
  it('뜨는 힘이 무게와 같아지는 속도를 0.1 m/s 까지 찾는다', () => {
    for (const v0 of [3.3, 5.24, 6.8, 9.97, 13.9]) {
      const f = findFavouriteSpeed(fake(v0), fakeGeom());
      expect(f.why).toBe('ok');
      expect(f.alphaDeg).toBe(4);
      // 찾은 속도에서는 실제로 뜬다(모자란 쪽으로 틀리지 않는다). 0.1 단위로 올림하므로 많아야 0.15 높다.
      expect((f.speedMps ?? 0) - v0).toBeGreaterThanOrEqual(-1e-9);
      expect((f.speedMps ?? 0) - v0).toBeLessThanOrEqual(0.151);
    }
  });
  it('가장 센 바람에도 모자라면 heavy, 균형을 한 번도 못 잡으면 unstable', () => {
    expect(findFavouriteSpeed(fake(20), fakeGeom())).toEqual({ speedMps: null, alphaDeg: null, why: 'heavy' });
    expect(findFavouriteSpeed(fake(5, { stableFrom: 99 }), fakeGeom())).toEqual({ speedMps: null, alphaDeg: null, why: 'unstable' });
  });
  it('느린 바람에서 균형을 못 잡는 비행기도 잡기 시작한 뒤의 속도에서 찾는다', () => {
    const f = findFavouriteSpeed(fake(3, { stableFrom: 6 }), fakeGeom());
    expect(f.speedMps).toBe(6);
  });
  it('쉬어 가며 찾아도 같은 답이고, 한 번 찾은 것은 다시 계산하지 않는다', async () => {
    const calls: number[] = [];
    const deps = fake(6.8, { calls });
    const g = fakeGeom();
    let pauses = 0;
    const a = await favouriteSpeedAsync(deps, g, async () => { pauses++; });
    expect(a).toEqual(findFavouriteSpeed(fake(6.8), fakeGeom()));
    expect(pauses).toBeGreaterThan(5);
    const n = calls.length;
    const b = await favouriteSpeedAsync(deps, g, async () => { pauses++; });
    expect(b).toBe(a);
    expect(calls.length).toBe(n);
  });
  it('진짜 core 로도 찾은 속도에서 뜨는 힘이 무게와 거의 같다', () => {
    const f = findFavouriteSpeed(CORE, dart);
    if (f.speedMps === null) { expect(['heavy', 'unstable']).toContain(f.why); return; }
    const at = tunnelTrim(dart, f.speedMps);
    const below = tunnelTrim(dart, f.speedMps - 0.1);
    expect(at.liftToWeight).toBeGreaterThanOrEqual(1);
    expect(below.liftToWeight).toBeLessThan(1);
  });
});

describe('각도 훑어보기와 균형', () => {
  it('딱 좋은 각도는 뜨는 힘 ÷ 막는 힘이 가장 큰 각도, 실속 각도는 처음으로 떨어져 나가는 각도', () => {
    const s = sweepAlpha(CORE, dart, 6);
    expect(s.points.length).toBe(LIMITS.alphaMax - LIMITS.alphaMin + 1);
    expect(s.bestAlphaDeg).not.toBeNull();
    const best = s.points.find((p) => p.alphaDeg === s.bestAlphaDeg)!;
    for (const p of s.points) if (p.liftN > 0) expect(p.liftToDrag).toBeLessThanOrEqual(best.liftToDrag + 1e-12);
    expect(s.bestLiftToDrag).toBe(best.liftToDrag);
    if (s.stallAlphaDeg !== null) {
      expect(isStalledView(probeTunnel(dart, { speedMps: 6, alphaDeg: s.stallAlphaDeg }), 6)).toBe(true);
      expect(isStalledView(probeTunnel(dart, { speedMps: 6, alphaDeg: s.stallAlphaDeg - 1 }), 6)).toBe(false);
    }
    expect(nearBest(s, s.bestAlphaDeg!, best.liftToDrag)).toBe(true);
    expect(nearBest(s, s.bestAlphaDeg! + 15, best.liftToDrag * 0.5)).toBe(false);
  });
  it('기억해 둔 값은 core 를 다시 부르지 않고, core 값 그대로다', () => {
    let n = 0;
    const deps: TunnelDeps = { ...CORE, probe: (g, i) => { n++; return probeTunnel(g, i); } };
    const g = buildGeometry(buildPresetDesign('glider', undefined, 'copy80'));
    const a = probeMemo(deps, g, 6, 5, 0);
    const b = probeMemo(deps, g, 6, 5, 0);
    expect(b).toBe(a);
    expect(n).toBe(1);
    expect(a).toEqual(probeTunnel(g, { speedMps: 6, alphaDeg: 5, betaDeg: 0 }));
    probeMemo(deps, g, 6, 5.01, 0);
    expect(n).toBe(2);
  });
  it('균형: 안정하면 tunnelTrim 의 각도, 바람이 없으면 가만히', () => {
    const t = tunnelTrim(dart, 6);
    const o = balanceOutcome(CORE, dart, 6, 20);
    if (t.alphaDeg !== null && t.stable) expect(o).toEqual({ kind: 'settle', alphaDeg: t.alphaDeg, liftToWeight: t.liftToWeight });
    else expect(o.kind).not.toBe('settle');
    expect(balanceOutcome(CORE, dart, 0, 5)).toEqual({ kind: 'calm' });
  });
  it('균형이 없을 때: 어디서나 숙이는 쪽이면 nose-down, 아니면 고개 돌리는 힘의 쪽으로 뒤집힌다', () => {
    const mk = (moment: (a: number) => number, trimAlpha: number | null): TunnelDeps => ({
      probe: (_g, i) => reading({ pitchMomentNm: moment(i.alphaDeg) }),
      trim: () => ({ alphaDeg: trimAlpha, stable: false, liftToWeight: 0 }),
      limits: LIMITS,
    });
    expect(balanceOutcome(mk(() => -1, null), fakeGeom(), 6, 5)).toEqual({ kind: 'nose-down', alphaDeg: -20 });
    expect(balanceOutcome(mk((a) => a - 2, 2), fakeGeom(), 6, 5)).toEqual({ kind: 'tumble', dir: 1 });
    expect(balanceOutcome(mk((a) => a - 2, 2), fakeGeom(), 6, -5)).toEqual({ kind: 'tumble', dir: -1 });
  });
});

describe('쪽지', () => {
  it('core 로 잰 값을 담고, 문장으로 풀 수 있다', () => {
    const n = measureLabNote(CORE, dart, 7, 123);
    expect(n.v).toBe(1);
    expect(n.physics).toBe(7);
    expect(n.at).toBe(123);
    const fav = findFavouriteSpeed(CORE, dart);
    expect(n.favSpeedMps).toBe(fav.speedMps);
    const lines = labNoteLines(n);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(labNoteShort(n).length).toBeGreaterThan(3);
    // 본 흐름에 보이는 문장에는 어려운 말을 쓰지 않는다
    for (const w of ['받음각', '양력', '항력', '실속']) expect(lines.join(' ')).not.toContain(w);
    expect(reviveLabNote(JSON.parse(JSON.stringify(n)))).toEqual(n);
  });
  it('모양이 틀린 쪽지는 버리고, 이상한 숫자는 비운다', () => {
    expect(reviveLabNote(null)).toBeUndefined();
    expect(reviveLabNote({ v: 2, physics: 1 })).toBeUndefined();
    expect(reviveLabNote({ v: 1 })).toBeUndefined();
    const n = reviveLabNote({ v: 1, physics: 2, at: 'x', favSpeedMps: 1e9, trimAlphaDeg: 'no', bestAlphaDeg: 8, bestLiftToDrag: 4.1, stallAlphaDeg: null, buckleSpeedMps: Number.NaN });
    expect(n).toEqual({ v: 1, physics: 2, at: 0, favSpeedMps: null, trimAlphaDeg: null, bestAlphaDeg: 8, bestLiftToDrag: 4.1, stallAlphaDeg: null, buckleSpeedMps: null });
  });
  it('실험실 저장 값: 모르는 실험과 망가진 쪽지는 건너뛴다', () => {
    const p = reviveLabProgress({ done: { lift: 5, nope: 3, stall: 'x' }, notes: { abc: { v: 1, physics: 2, at: 1, favSpeedMps: 5 }, bad: { v: 9 } } });
    expect(p.done).toEqual({ lift: 5 });
    expect(Object.keys(p.notes)).toEqual(['abc']);
    expect(reviveLabProgress('garbage')).toEqual({ v: 1, done: {}, notes: {} });
  });
  it('실험을 마친 뒤의 한마디는 던지기와 이어진다', () => {
    expect(experimentLesson('lift', { speedMps: 6.5, alphaDeg: 5 })).toMatch(/6\.5 m\/s.*그래서 이 비행기는 보통 힘으로 던져야 떠요/);
    expect(experimentLesson('lift', { speedMps: 4, alphaDeg: 5 })).toMatch(/살살 던져도 떠요/);
    expect(experimentLesson('lift', { speedMps: 11, alphaDeg: 5 })).toMatch(/세게 던져야 떠요/);
    expect(experimentLesson('best', { speedMps: 6, alphaDeg: 8 })).toMatch(/8도.*살짝 위로 던지면/);
    expect(experimentLesson('stall', { speedMps: 6, alphaDeg: 35 })).toMatch(/너무 위로 던지면/);
    expect(experimentLesson('paper', { speedMps: 10, alphaDeg: 6, flexNowDeg: 30, flexPinnedDeg: 4 })).toMatch(/30\.0도.*4\.0도.*빳빳한 종이/);
    expect(experimentLesson('paper', { speedMps: 10, alphaDeg: 6, buckledNow: true })).toMatch(/꺾였어요/);
  });
});

describe('연기 그림(계산한 힘에서 만든다)', () => {
  const fp: FlowPointOut = { s: 0, y: 0, z: 0, pace: 1, rough: 0 };
  const far = 0.3;
  const sinkAt = (r: TunnelReading, alphaDeg = 8, speedMps = 6): number => {
    const m = buildFlowModel(r, dart, { speedMps, alphaDeg });
    const z0 = -m.spanHalfM * 0.55;
    const st = m.stations.reduce((a, b) => (Math.abs(b.z - z0) < Math.abs(a.z - z0) ? b : a));
    // 날개 바로 위를 지나는 줄이 뒤쪽 먼 곳에서 뒷전보다 얼마나 내려갔는지
    flowPoint(m, z0, st.yLe - m.upwashM + 0.004, st.sTe + far, 0, fp);
    return st.yTe - fp.y;
  };

  it('기체 좌표를 바람 좌표로: 고개를 들면 코가 위로, 옆으로 돌리면 코가 왼쪽으로', () => {
    const cg = { x: -0.1, y: 0, z: 0 };
    const out = { s: 0, y: 0, z: 0 };
    bodyToWind({ x: 0, y: 0, z: 0 }, cg, 0, 0, out);
    expect(out.s).toBeCloseTo(-0.1, 12);
    expect(out.y).toBeCloseTo(0, 12);
    bodyToWind({ x: 0, y: 0, z: 0 }, cg, 30, 0, out);
    expect(out.y).toBeCloseTo(0.05, 12);
    expect(out.s).toBeCloseTo(-0.1 * Math.cos(Math.PI / 6), 12);
    bodyToWind({ x: 0, y: 0, z: 0 }, cg, 0, 20, out);
    expect(out.z).toBeLessThan(0); // 오른쪽이 +z 이므로 왼쪽은 음수
    bodyToWind({ x: -0.1, y: 0.05, z: 0 }, cg, 0, 0, out);
    expect(out.z).toBeCloseTo(-0.05, 12); // 왼쪽 날개는 -z
  });

  it('뜨는 힘이 없으면 연기는 꺾이지 않고, 소용돌이도 없다', () => {
    const m = buildFlowModel(reading({ cl: 0, cd: 0.01, liftN: 0 }), dart, { speedMps: 6, alphaDeg: 0 });
    expect(m.downwashRad).toBe(0);
    expect(m.vortex).toBe(0);
    // 날개 뒤의 얇은 띠가 몇 mm 출렁일 뿐, 줄 전체가 위나 아래로 꺾이지 않는다.
    let drift = 0;
    const heights = rakeHeights(7);
    for (const y0 of heights) {
      flowPoint(m, -0.04, y0 + 0.05, 0.35, 0, fp);
      expect(Math.abs(fp.y - (y0 + 0.05))).toBeLessThan(0.009);
      drift += fp.y - (y0 + 0.05);
    }
    expect(Math.abs(drift / heights.length)).toBeLessThan(0.003);
  });

  it('뜨는 힘 계수가 클수록 날개 뒤 연기가 더 아래로 꺾인다(상한까지)', () => {
    const a = buildFlowModel(reading({ cl: 0.1 }), dart, { speedMps: 6, alphaDeg: 8 });
    const b = buildFlowModel(reading({ cl: 0.3 }), dart, { speedMps: 6, alphaDeg: 8 });
    const c = buildFlowModel(reading({ cl: 5 }), dart, { speedMps: 6, alphaDeg: 8 });
    expect(b.downwashRad).toBeCloseTo(3 * a.downwashRad, 10);
    expect(c.downwashRad).toBeCloseTo((DOWNWASH_MAX_DEG * Math.PI) / 180, 12);
    expect(sinkAt(reading({ cl: 0.3 }))).toBeGreaterThan(sinkAt(reading({ cl: 0.1 })) + 0.005);
    // 아래로 누르는 힘이면 위로 꺾인다
    expect(buildFlowModel(reading({ cl: -0.3 }), dart, { speedMps: 6, alphaDeg: -8 }).downwashRad).toBeLessThan(0);
    expect(buildFlowModel(reading({ cl: -0.3 }), dart, { speedMps: 6, alphaDeg: -8 }).suction).toBe(-1);
  });

  it('바람이 없으면 힘이 계산되어 있어도 그림은 고요하다', () => {
    const m = buildFlowModel(reading({ cl: 0.5, stalledFraction: 0.9 }), dart, { speedMps: 0, alphaDeg: 10 });
    expect(m.downwashRad).toBe(0);
    expect(m.turbulence).toBe(0);
    expect(m.stations.some((s) => s.stalled)).toBe(false);
  });

  it('붙어 흐르는 연기는 시간에 따라 변하지 않고, 실속한 띠 뒤의 연기만 말려서 흘러간다', () => {
    const calm = buildFlowModel(reading({ cl: 0.3 }), dart, { speedMps: 6, alphaDeg: 8 });
    const z0 = -calm.spanHalfM * 0.55;
    const st = calm.stations.reduce((a, b) => (Math.abs(b.z - z0) < Math.abs(a.z - z0) ? b : a));
    const y0 = st.yLe - calm.upwashM + 0.004;
    const mid = (st.sLe + st.sTe) / 2;
    flowPoint(calm, z0, y0, mid, 0, fp);
    const y1 = fp.y, rough1 = fp.rough, pace1 = fp.pace;
    flowPoint(calm, z0, y0, mid, 1.7, fp);
    expect(fp.y).toBe(y1);
    expect(rough1).toBe(0);
    expect(pace1).toBe(1);
    // 붙어 흐를 때는 날개 윗면 바로 위를 따라간다
    const plate = st.yLe + ((st.yTe - st.yLe) * (mid - st.sLe)) / (st.sTe - st.sLe);
    expect(y1).toBeGreaterThan(plate);
    expect(y1 - plate).toBeLessThan(0.012);

    const r = reading({ cl: 0.6, cd: 0.4, stalledFraction: 0.9 });
    r.elements = r.elements.map((e) => ({ ...e, stalled: true }));
    const torn = buildFlowModel(r, dart, { speedMps: 6, alphaDeg: 40 });
    expect(torn.stations.every((s) => s.stalled)).toBe(true);
    expect(torn.turbulence).toBeGreaterThan(0.7);
    const st2 = torn.stations.reduce((a, b) => (Math.abs(b.z - z0) < Math.abs(a.z - z0) ? b : a));
    const yUp = st2.yLe - torn.upwashM + 0.004;
    const sT = st2.sTe - 0.01;
    flowPoint(torn, z0, yUp, sT, 0, fp);
    const a0 = { s: fp.s, y: fp.y, rough: fp.rough, pace: fp.pace };
    flowPoint(torn, z0, yUp, sT, 0.4, fp);
    expect(a0.rough).toBeGreaterThan(0.5);
    expect(a0.pace).toBeLessThan(0.7);
    expect(Math.hypot(fp.s - a0.s, fp.y - a0.y)).toBeGreaterThan(0.002);
    // 떨어져 나간 연기는 날개 윗면에서 멀리 떠 있다(붙어 흐를 때보다 훨씬)
    const plate2 = st2.yLe + ((st2.yTe - st2.yLe) * (sT - st2.sLe)) / (st2.sTe - st2.sLe);
    expect(a0.y - plate2).toBeGreaterThan(0.03);
    // 아랫면 쪽 줄은 그대로 붙어 흐른다
    flowPoint(torn, z0, st2.yLe - torn.upwashM - 0.02, sT, 0, fp);
    expect(fp.rough).toBeLessThan(0.3);
  });

  it('막는 힘 계수가 클수록 날개 뒤 어지러운 띠가 넓다', () => {
    const thin = buildFlowModel(reading({ cd: 0.03 }), dart, { speedMps: 6, alphaDeg: 5 });
    const fat = buildFlowModel(reading({ cd: 0.5 }), dart, { speedMps: 6, alphaDeg: 5 });
    expect(fat.wakeHalfM).toBeGreaterThan(thin.wakeHalfM * 2);
    expect(fat.turbulence).toBeGreaterThan(thin.turbulence);
  });

  it('날개 끝 소용돌이의 굵기는 뜨는 힘을 따르고, 뜨는 힘의 방향이 바뀌면 반대로 돈다', () => {
    const out = { s: 0, y: 0, z: 0 };
    const radius = (cl: number): number => {
      const m = buildFlowModel(reading({ cl }), dart, { speedMps: 6, alphaDeg: 8 });
      let r = 0;
      for (let t = 0.1; t < 0.2; t += 0.004) {
        vortexPoint(m, 0, t, 0, out);
        r = Math.max(r, Math.abs(out.z - m.tips[0].z * (1 - 0.1 * (1 - Math.exp(-t / 0.15)))));
      }
      return r;
    };
    expect(radius(0)).toBeLessThan(1e-9);
    expect(radius(0.3)).toBeGreaterThan(radius(0.1) * 2);
    const up = buildFlowModel(reading({ cl: 0.4 }), dart, { speedMps: 6, alphaDeg: 8 });
    const dn = buildFlowModel(reading({ cl: -0.4 }), dart, { speedMps: 6, alphaDeg: 8 });
    expect(Math.sign(up.vortex)).toBe(1);
    expect(Math.sign(dn.vortex)).toBe(-1);
    // 양쪽 날개 끝은 거울처럼 반대로 돈다
    const a = { s: 0, y: 0, z: 0 }, b = { s: 0, y: 0, z: 0 };
    vortexPoint(up, 0, 0.12, 0, a);
    vortexPoint(up, 1, 0.12, 0, b);
    expect(a.y - up.tips[0].y).toBeCloseTo(b.y - up.tips[1].y, 6);
  });

  it('진짜 core 값으로도: 고개를 들수록 더 꺾이다가, 실속하면 흐트러진다', () => {
    const at = (alphaDeg: number) => buildFlowModel(probeTunnel(dart, { speedMps: 6, alphaDeg }), dart, { speedMps: 6, alphaDeg });
    expect(at(10).downwashRad).toBeGreaterThan(at(4).downwashRad);
    expect(at(4).stations.some((s) => s.stalled)).toBe(false);
    const deep = at(55);
    expect(deep.stations.filter((s) => s.stalled).length).toBeGreaterThan(deep.stations.length / 2);
    expect(deep.turbulence).toBeGreaterThan(at(4).turbulence);
    const rough = roughen(at(4));
    expect(rough.stations.every((s) => s.stalled)).toBe(true);
    expect(rough.downwashRad).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 물리 2판(던지기 한도 10 m/s, 종이 꺾임)에서도 실험 카드를 끝낼 수 있는지: 기본 접는 법 5가지 x 종이 6가지 모두
// ---------------------------------------------------------------------------
describe('실험 카드: 기본 접는 법과 종이 어느 것으로도 끝낼 수 있다', () => {
  const strong = strongWind(TUNNEL_LIMITS);
  const cells = PRESETS.flatMap((p) => PAPERS.map((paper) => ({ id: `${p.id}/${paper.id}`, presetId: p.id, paperId: paper.id, geom: buildGeometry({ ...p.design, paperId: paper.id }) })));
  const flexOf = (r: TunnelReading): number => Math.max(Math.abs(r.flexLeftDeg), Math.abs(r.flexRightDeg));

  it('뜨는 속도 찾기: 처음 고개 각도(5도)에서 실험실 바람 안에 뜨는 때가 있다(가장 무거운 종이, 가장 좁은 날개도)', () => {
    let slowest = 0;
    for (const c of cells) {
      expect(probeTunnel(c.geom, { speedMps: 0.5, alphaDeg: 5 }).liftToWeight, c.id).toBeLessThan(1);
      let at: number | null = null;
      for (let v = 0.5; v <= TUNNEL_LIMITS.speedMax + 1e-9; v += 0.5) {
        if (probeTunnel(c.geom, { speedMps: v, alphaDeg: 5 }).liftToWeight >= 1) { at = v; break; }
      }
      expect(at, c.id).not.toBeNull();
      slowest = Math.max(slowest, at!);
      // 그때의 한마디는 던지기와 이어진다(던질 수 있는 힘 안이면 세 단계 말 가운데 하나).
      expect(experimentLesson('lift', { speedMps: at!, alphaDeg: 5 }), c.id).toMatch(/던져(야|도) 떠요/);
    }
    // 가장 늦게 뜨는 것도 가장 센 던지기 안쪽이다(실험실 바람의 끝보다 한참 아래).
    expect(slowest).toBeLessThanOrEqual(APP_LIMITS.throwSpeedMax);
    expect(slowest).toBeLessThan(TUNNEL_LIMITS.speedMax);
  }, 60_000);

  it('딱 좋은 각도 찾기, 실속 만들어 보기: 보통 바람(6 m/s)에서 가장 알뜰한 각도와 실속 각도가 실험 범위 안에 있다', () => {
    for (const c of cells) {
      const sweep = sweepAlpha(CORE, c.geom, 6, 2);
      expect(sweep.bestAlphaDeg, c.id).not.toBeNull();
      expect(sweep.bestAlphaDeg!, c.id).toBeGreaterThan(0);
      expect(sweep.bestAlphaDeg!, c.id).toBeLessThan(25);
      expect(sweep.stallAlphaDeg, c.id).not.toBeNull();
      expect(sweep.stallAlphaDeg!, c.id).toBeLessThanOrEqual(TUNNEL_LIMITS.alphaMax);
      expect(isStalledView(probeTunnel(c.geom, { speedMps: 6, alphaDeg: TUNNEL_LIMITS.alphaMax }), 6), c.id).toBe(true);
    }
  }, 60_000);

  it('종이 바꿔 보기: 센 바람에서 얇은 종이는 더 휘고, 막는 힘이 커지고, 뜨는 힘이 준다(카드의 말과 같다)', () => {
    expect(strong).toBeLessThanOrEqual(TUNNEL_LIMITS.speedMax);
    for (const p of PRESETS) {
      const at = (paperId: string): TunnelReading => probeTunnel(cells.find((c) => c.presetId === p.id && c.paperId === paperId)!.geom, { speedMps: strong, alphaDeg: 5 });
      const thin = at('newsprint'), std = at('copy80'), stiff = at('kent160');
      expect(flexOf(thin), p.id).toBeGreaterThan(flexOf(std) + 5);
      expect(flexOf(std), p.id).toBeGreaterThan(flexOf(stiff));
      expect(flexOf(thin), p.id).toBeGreaterThanOrEqual(15); // 화면이 "펄럭거려요"라고 알려 주는 만큼
      expect(thin.dragN, p.id).toBeGreaterThan(std.dragN * 2);
      expect(thin.liftN, p.id).toBeLessThan(std.liftN);
      // 처음 고개 각도(5도)에서는 꺾이지 않는다: 아이가 보는 것은 "접힘"이 아니라 휘고 펄럭이는 날개다.
      expect(thin.buckled, p.id).toBe(false);
      const lesson = experimentLesson('paper', {
        speedMps: strong, alphaDeg: 5, flexNowDeg: flexOf(thin), flexPinnedDeg: flexOf(std), buckledNow: thin.buckled, buckledPinned: std.buckled,
        liftNowN: thin.liftN, liftPinnedN: std.liftN, dragNowN: thin.dragN, dragPinnedN: std.dragN,
      });
      expect(lesson, p.id).toMatch(/펄럭/);
      expect(lesson, p.id).toContain(`${gfText(std.dragN)} g에서 ${gfText(thin.dragN)} g으로 커지고`);
      expect(lesson, p.id).toContain(`${gfText(std.liftN)} g에서 ${gfText(thin.liftN)} g으로 줄었어요`);
      expect(lesson, p.id).toMatch(/그래서 세게 던질 때는 덜 휘는 빳빳한 종이가 좋아요\.$/);
      // 붙여 둔 쪽이 얇은 종이여도(순서를 바꿔도) 같은 말이 나온다.
      expect(experimentLesson('paper', {
        speedMps: strong, alphaDeg: 5, flexNowDeg: flexOf(std), flexPinnedDeg: flexOf(thin),
        liftNowN: std.liftN, liftPinnedN: thin.liftN, dragNowN: std.dragN, dragPinnedN: thin.dragN,
      }), p.id).toBe(lesson);
      // 고개를 더 들면(10도) 신문지는 실험실 바람 안에서 정말로 꺾인다: 꺾임 그림과 말이 나올 수 있다.
      let buckleAt: number | null = null;
      for (let v = strong - 4; v <= TUNNEL_LIMITS.speedMax + 1e-9; v += 0.5) {
        if (probeTunnel(cells.find((c) => c.presetId === p.id && c.paperId === 'newsprint')!.geom, { speedMps: v, alphaDeg: 10 }).buckled) { buckleAt = v; break; }
      }
      expect(buckleAt, p.id).not.toBeNull();
      // 가장 빳빳한 종이는 같은 조건에서 끝까지 버틴다.
      expect(probeTunnel(cells.find((c) => c.presetId === p.id && c.paperId === 'kent160')!.geom, { speedMps: TUNNEL_LIMITS.speedMax, alphaDeg: 10 }).buckled, p.id).toBe(false);
    }
  }, 60_000);

  it('한마디: 던질 수 없는 센 바람에서야 뜨면 그렇게 알려 주고, 쪽지도 던지기 한도를 안다', () => {
    const over = APP_LIMITS.throwSpeedMax + 1.5;
    expect(experimentLesson('lift', { speedMps: over, alphaDeg: 5 })).toMatch(/세게 던져야 떠요.*가장 센 던지기.*고개를 조금 들어/);
    expect(experimentLesson('lift', { speedMps: APP_LIMITS.throwSpeedMax, alphaDeg: 5 })).toMatch(/그래서 이 비행기는 세게 던져야 떠요\.$/);
    const note = { v: 1, physics: 2, at: 0, favSpeedMps: over, trimAlphaDeg: 6, bestAlphaDeg: 8, bestLiftToDrag: 4, stallAlphaDeg: 20, buckleSpeedMps: 7.5 };
    const lines = labNoteLines(note).join(' ');
    expect(lines).toMatch(/가장 세게 던져도 그보다 느려서/);
    expect(lines).toMatch(/7\.5 m\/s보다 세게 계속 불면 종이가 꺾여요/);
    expect(labNoteLines({ ...note, favSpeedMps: 4 }).join(' ')).toMatch(/4\.0 m\/s예요\. 살살 던지면 딱 좋아요/);
    expect(labNoteLines({ ...note, favSpeedMps: 6 }).join(' ')).toMatch(/보통 힘으로 던지면 딱 좋아요/);
    expect(labNoteLines({ ...note, favSpeedMps: 8 }).join(' ')).toMatch(/세게 던지면 딱 좋아요/);
  });
});
