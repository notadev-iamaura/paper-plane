/**
 * 기본 접기 패턴이 "기본값 그대로" 잘 나는지 확인한다(일반 복사지 80 g 기준).
 * 모든 값은 공개 창구(evaluate / analyze / buildGeometry)로만 구한다.
 *
 * 기대하는 성격
 * - 다섯 기체 모두 받음각 약 4~9도, 활공비 3 이상으로 안정 활공하고, 안정 속도로 수평으로 살짝 던지면 '활공' 판정이 난다.
 * - 다트: 빠르다. 세게 수평으로 던져도 곧게 멀리 간다.
 * - 글라이더, 델타: 느리고 오래 뜬다. 세게 위로 던지면 솟구쳤다가 실속한다.
 *
 * 참고(물리 모델의 성질이라 프리셋 값으로는 바꿀 수 없는 부분):
 * 최대 힘에 가까운 수평 던지기에서는 활공비가 높은 델타와 글라이더가 높이 솟은 뒤 다시 활공해
 * 다트보다 멀리 가기도 한다. 그래서 "다트가 거리 1등"은 검사하지 않는다.
 */
import { describe, expect, it } from 'vitest';
import {
  PRESETS, analyze, buildGeometry, evaluate, validateSubmission,
  type AeroSummary, type GameMode, type SimResult, type ThrowInput,
} from '../src/core/index';

const round2 = (v: number): number => Math.round(v * 100) / 100;
const th = (speedMps: number, pitchDeg: number): ThrowInput => ({ speedMps, pitchDeg, rollDeg: 0 });

const byId = (id: string) => {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`프리셋 없음: ${id}`);
  return p;
};

const summaries = new Map<string, AeroSummary>();
for (const p of PRESETS) summaries.set(p.id, analyze(buildGeometry(p.design)));
const summary = (id: string): AeroSummary => summaries.get(id)!;

/** 안정 속도로 수평으로 살짝 던지기 */
const gentleCache = new Map<string, SimResult>();
function gentle(id: string): SimResult {
  let r = gentleCache.get(id);
  if (!r) {
    r = evaluate(byId(id).design, th(round2(summary(id).trimSpeedMps!), 0)).result;
    gentleCache.set(id, r);
  }
  return r;
}

describe('프리셋 기본값: 안정 활공', () => {
  it('다섯 가지가 있고 기본값에는 클립이 없으며 일반 복사지를 쓴다', () => {
    expect(PRESETS.map((p) => p.id).sort()).toEqual(['dart', 'delta', 'glider', 'hybrid', 'stealth']);
    for (const p of PRESETS) {
      expect(p.design.clip, p.id).toBeNull();
      expect(p.design.paperId, p.id).toBe('copy80');
      for (const m of p.paramMeta) {
        expect(p.params[m.key], `${p.id}.${m.key}`).toBeGreaterThanOrEqual(m.min);
        expect(p.params[m.key], `${p.id}.${m.key}`).toBeLessThanOrEqual(m.max);
        expect(m.default, `${p.id}.${m.key}`).toBe(p.params[m.key]);
      }
    }
  });

  it('받음각 약 4~9도에서 안정되고 세로, 좌우 모두 안정 판정이다', () => {
    for (const p of PRESETS) {
      const s = summary(p.id);
      expect(s.trimAlphaDeg, p.id).not.toBeNull();
      expect(s.trimAlphaDeg!, p.id).toBeGreaterThanOrEqual(4.0);
      expect(s.trimAlphaDeg!, p.id).toBeLessThanOrEqual(9.0);
      // 실속 받음각까지 넉넉한 여유
      expect(s.stallAlphaDeg - s.trimAlphaDeg!, p.id).toBeGreaterThan(12);
      expect(s.pitchStability, p.id).toBe('stable');
      expect(s.lateralStability, p.id).toBe('stable');
      expect(s.staticMargin, p.id).toBeGreaterThan(0.02);
    }
  });

  it('안정 속도는 3~7 m/s, 활공비는 다섯 기체 모두 3 이상이다', () => {
    for (const p of PRESETS) {
      const s = summary(p.id);
      expect(s.trimSpeedMps!, p.id).toBeGreaterThanOrEqual(3);
      expect(s.trimSpeedMps!, p.id).toBeLessThanOrEqual(7);
      // (물리 2판: 예전에는 다트만 2.6 이상으로 봐줬다. 지금은 다트도 3 이상이다.)
      expect(s.glideRatio!, p.id).toBeGreaterThanOrEqual(3.0);
      expect(s.glideRatio!, p.id).toBeLessThanOrEqual(6.0);
      // 최대 양항비에 가깝게 난다(기체가 낼 수 있는 성능의 70% 이상을 기본값에서 쓴다).
      expect(s.glideRatio! / s.maxLD, p.id).toBeGreaterThan(0.7);
    }
  });

  it('무게중심은 다트와 하이브리드가 앞쪽(뒷전을 올려 보정), 나머지는 시위의 26~30% 근처다', () => {
    for (const p of PRESETS) {
      const frac = buildGeometry(p.design).stats.cgFracMac;
      if (p.id === 'dart' || p.id === 'hybrid') {
        expect(frac, p.id).toBeLessThan(0.24);
        expect(p.design.shaping.elevatorDeg, p.id).toBeGreaterThanOrEqual(2);
      } else {
        expect(frac, p.id).toBeGreaterThan(0.25);
        expect(frac, p.id).toBeLessThan(0.30);
      }
    }
  });

  it('안정 속도로 수평으로 살짝 던지면 활공 판정이 나고 곧게 간다', () => {
    for (const p of PRESETS) {
      const input = th(round2(summary(p.id).trimSpeedMps!), 0);
      expect(validateSubmission(p.design, input), p.id).toEqual({ ok: true, errors: [] });
      const r = gentle(p.id);
      expect(r.verdict, p.id).toBe('glide');
      expect(Math.abs(r.lateralM), p.id).toBeLessThan(0.2);
      expect(r.distanceM, p.id).toBeGreaterThan(5);
      expect(r.airtimeS, p.id).toBeGreaterThan(1.4);
      // 1.6 m 높이에서 적어도 활공비만큼은 간다. 수평으로 출발하므로(처음엔 내려가지 않는다) 그보다 조금 더 간다.
      const expected = 1.6 * summary(p.id).glideRatio!;
      expect(r.distanceM / expected, p.id).toBeGreaterThan(0.9);
      expect(r.distanceM / expected, p.id).toBeLessThan(2);
    }
  });
});

describe('프리셋 기본값: 서로 다른 성격', () => {
  it('다트가 가장 빠르고, 글라이더와 델타는 느리다', () => {
    const dartV = summary('dart').trimSpeedMps!;
    // (물리 2판: 다트의 활공비를 규격의 3 이상으로 올리려고 뒷전을 2.5도 -> 4.5도로 올렸다. 받음각이 커진 만큼
    //  안정 속도가 6.0 -> 5.5 m/s 로 내려가 기준을 5.5 에서 5.2 로 바꿨다. 다른 기체보다 0.5 m/s 넘게 빠른 것은 그대로다.)
    expect(dartV).toBeGreaterThan(5.2);
    for (const p of PRESETS) {
      if (p.id !== 'dart') expect(dartV, p.id).toBeGreaterThan(summary(p.id).trimSpeedMps! + 0.5);
    }
    expect(summary('glider').trimSpeedMps!).toBeLessThan(4.2);
    expect(summary('delta').trimSpeedMps!).toBeLessThan(4.2);
    expect(summary('delta').trimSpeedMps!).toBeLessThan(summary('hybrid').trimSpeedMps!);
  });

  it('살짝 던지면 글라이더와 델타가 다트보다 오래 뜨고, 다트가 더 멀리 간다', () => {
    const dart = gentle('dart');
    for (const id of ['glider', 'delta']) {
      expect(gentle(id).airtimeS, id).toBeGreaterThan(dart.airtimeS);
      expect(dart.distanceM, id).toBeGreaterThan(gentle(id).distanceM);
      expect(summary(id).glideRatio!, id).toBeGreaterThan(summary('dart').glideRatio!);
    }
  });

  // 물리 2판에서 바뀐 시험: 던지기 한도가 16 -> 10 m/s (어린이의 던지기)가 되어 10, 12, 14 m/s 를 8, 9, 10 m/s 로 바꿨다.
  // 예전 기준 "12 m 초과, 14 m/s 에서 살짝 던질 때의 2배와 15 m 초과"는 14 m/s 의 에너지(높이 10 m 어치)가 있어야 가능했다.
  // 10 m/s 의 에너지는 높이 5.1 m 어치다. 지금 기준: 8 m/s 부터 10 m 초과, 10 m/s 에서 13 m 초과와 살짝 던질 때의 1.8배 초과.
  it('다트는 세게 수평으로 던져도 실속하지 않고 살짝 던질 때보다 훨씬 멀리 간다', () => {
    const design = byId('dart').design;
    let prev = gentle('dart').distanceM;
    for (const speed of [8, 9, 10]) {
      const r = evaluate(design, th(speed, 0)).result;
      expect(r.verdict, `${speed} m/s`).toBe('glide');
      expect(r.distanceM, `${speed} m/s`).toBeGreaterThan(10);
      expect(r.distanceM, `${speed} m/s`).toBeGreaterThan(prev); // 세게 던질수록 더 멀리
      expect(r.structure.buckled, `${speed} m/s`).toBe(false);
      prev = r.distanceM;
    }
    const hard = evaluate(design, th(10, 0)).result;
    expect(hard.distanceM).toBeGreaterThan(1.8 * gentle('dart').distanceM);
    expect(hard.distanceM).toBeGreaterThan(13);
    // 어린이가 던진 종이비행기의 범위를 넘지 않는다
    expect(hard.distanceM).toBeLessThan(20);
  });

  // 물리 2판에서 바뀐 시험: 14 m/s 를 10 m/s 로 바꿨다. 다트도 뒷전을 더 올린 뒤로는 10 m/s, 30도에서 실속해
  // 8.5 m 밖에 못 가므로, "다트보다 못 간다"는 글라이더에만 남기고(8.1 m < 8.5 m), 델타는
  // "수평으로 세게 던졌을 때(16.5 m)의 60% 도 못 간다"로 바꿨다. 솟구쳐 실속한다는 내용은 그대로다.
  it('글라이더와 델타는 세게 위로 던지면 솟구친 뒤 실속하거나 뒤집혀 수평으로 던질 때보다 훨씬 못 간다', () => {
    const dart = evaluate(byId('dart').design, th(10, 30)).result;
    for (const id of ['glider', 'delta']) {
      const r = evaluate(byId(id).design, th(10, 30)).result;
      const level = evaluate(byId(id).design, th(10, 0)).result;
      expect(['stall', 'tumble'], id).toContain(r.verdict);
      expect(r.maxHeightM, id).toBeGreaterThan(4);
      expect(r.distanceM, id).toBeLessThan(level.distanceM * 0.75);
      if (id === 'glider') expect(r.distanceM, id).toBeLessThan(dart.distanceM);
      else expect(r.distanceM, id).toBeLessThan(level.distanceM * 0.6);
    }
    // 글라이더는 수평으로도 안정 속도의 약 2.6배(10 m/s)면 실속한다.
    expect(evaluate(byId('glider').design, th(10, 0)).result.verdict).toBe('stall');
  });
});

describe('모드별 최고 기록(성긴 격자 탐색)', () => {
  // (물리 2판: 던지기 한도 10 m/s 에 맞춰 6, 10, 14 를 6, 8, 10 으로 바꿨다.)
  const speeds = [6, 8, 10];
  const pitches = [0, 10, 25];
  type Best = { presetId: string; throwIn: ThrowInput; result: SimResult };
  const best: Partial<Record<GameMode, Best>> = {};
  const bestPerPreset = new Map<string, { distanceM: number; airtimeS: number }>();

  function search(): void {
    if (best.distance) return;
    for (const p of PRESETS) {
      const mine = { distanceM: 0, airtimeS: 0 };
      for (const speed of speeds) {
        for (const pitch of pitches) {
          const throwIn = th(speed, pitch);
          const result = evaluate(p.design, throwIn).result;
          mine.distanceM = Math.max(mine.distanceM, result.distanceM);
          mine.airtimeS = Math.max(mine.airtimeS, result.airtimeS);
          if (!best.distance || result.distanceM > best.distance.result.distanceM) best.distance = { presetId: p.id, throwIn, result };
          if (!best.airtime || result.airtimeS > best.airtime.result.airtimeS) best.airtime = { presetId: p.id, throwIn, result };
        }
      }
      bestPerPreset.set(p.id, mine);
    }
  }

  it('거리 모드: 가장 좋은 프리셋 던지기가 12 m 를 넘는다', () => {
    search();
    expect(best.distance!.result.distanceM).toBeGreaterThan(12);
    expect(Number.isFinite(best.distance!.result.distanceM)).toBe(true);
    // 어느 프리셋이든 잘 던지면 10 m 는 넘는다(못 쓰는 기체가 없다).
    for (const p of PRESETS) expect(bestPerPreset.get(p.id)!.distanceM, p.id).toBeGreaterThan(10);
    // 다트 혼자서도 12 m 를 넘는다.
    expect(bestPerPreset.get('dart')!.distanceM).toBeGreaterThan(12);
  }, 60_000);

  it('체공 모드: 가장 좋은 프리셋 던지기가 1.6 m 높이에서 2.0초를 넘고, 느린 기체가 1등이다', () => {
    search();
    expect(best.airtime!.result.airtimeS).toBeGreaterThan(2.0);
    expect(['glider', 'delta']).toContain(best.airtime!.presetId);
    for (const p of PRESETS) expect(bestPerPreset.get(p.id)!.airtimeS, p.id).toBeGreaterThan(2.0);
    // 체공 1등 기록은 다트의 최고 체공 시간보다 뚜렷하게 길다.
    expect(best.airtime!.result.airtimeS).toBeGreaterThan(bestPerPreset.get('dart')!.airtimeS + 0.5);
  }, 60_000);
});
