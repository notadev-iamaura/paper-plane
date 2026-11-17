/**
 * 던지는 힘의 규칙(힘 막대 눈금 <-> 빠르기, 살살 / 보통 / 세게)과, 종이가 못 버틴 일을 아이 말로 옮기는 규칙.
 * 숫자는 core 의 LIMITS 와 power.ts 의 상수에서 계산한다(한도가 바뀌어도 이 시험은 그대로 쓸 수 있다).
 */
import { describe, expect, it } from 'vitest';
import { LIMITS, PAPERS, PRESETS, analyze, buildGeometry, evaluate } from '../src/core/index';
import type { FlightStructure } from '../src/core/index';
import { buildPresetDesign, defaultPresetParams } from '../src/core/presets';
import {
  DEFAULT_THROW_SPEED, GAUGE_EASE, HARD_START_MPS, ORDINARY_THROW_MPS, SOFT_END_MPS, ZONE_HARD_START, ZONE_SOFT_END,
  gaugeToSpeed, powerWord, powerZone, speedToGauge,
} from '../src/app/lib/power';
import { kidTip, kidify, NEAR_MISS_RATIO, structureWords } from '../src/app/lib/kidvoice';
import { DEFAULT_THROW, defaultState, reducer, reviveSession } from '../src/app/state';

describe('힘 막대', () => {
  it('양 끝은 던지기 한도, 가운데는 보통 던지기(5.5 ~ 6.5 m/s)다', () => {
    expect(gaugeToSpeed(0)).toBe(LIMITS.throwSpeedMin);
    expect(gaugeToSpeed(1)).toBe(LIMITS.throwSpeedMax);
    expect(gaugeToSpeed(-3)).toBe(LIMITS.throwSpeedMin);
    expect(gaugeToSpeed(7)).toBe(LIMITS.throwSpeedMax);
    expect(gaugeToSpeed(0.5)).toBe(ORDINARY_THROW_MPS);
    expect(ORDINARY_THROW_MPS).toBeGreaterThanOrEqual(5.5);
    expect(ORDINARY_THROW_MPS).toBeLessThanOrEqual(6.5);
    // 지금 한도(2 ~ 10 m/s)에서는 보통 던지기가 딱 한가운데라 막대가 곧은 자다.
    expect(GAUGE_EASE).toBeCloseTo(Math.log((ORDINARY_THROW_MPS - LIMITS.throwSpeedMin) / (LIMITS.throwSpeedMax - LIMITS.throwSpeedMin)) / Math.log(0.5), 6);
  });

  it('눈금이 커지면 힘도 커지고, 눈금 <-> 빠르기가 서로 되돌려진다(0.1 m/s 한 칸 안)', () => {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = gaugeToSpeed(i / 100);
      expect(v, String(i)).toBeGreaterThanOrEqual(prev);
      expect(Math.abs(gaugeToSpeed(speedToGauge(v)) - v), String(i)).toBeLessThan(1e-9);
      prev = v;
    }
    for (let v = LIMITS.throwSpeedMin; v <= LIMITS.throwSpeedMax + 1e-9; v += 0.1) {
      const s = Math.round(v * 10) / 10;
      expect(gaugeToSpeed(speedToGauge(s)), String(s)).toBe(s);
    }
  });

  it('세 구역: 막대의 30% 아래는 살살, 70% 부터는 세게, 그 사이는 보통. 경계의 말이 숫자와 어긋나지 않는다', () => {
    expect([ZONE_SOFT_END, ZONE_HARD_START]).toEqual([0.3, 0.7]);
    expect(SOFT_END_MPS).toBe(gaugeToSpeed(ZONE_SOFT_END));
    expect(HARD_START_MPS).toBe(gaugeToSpeed(ZONE_HARD_START));
    expect(powerWord(LIMITS.throwSpeedMin)).toBe('살살');
    expect(powerWord(SOFT_END_MPS - 0.1)).toBe('살살');
    expect(powerWord(SOFT_END_MPS)).toBe('보통');
    expect(powerWord(ORDINARY_THROW_MPS)).toBe('보통');
    expect(powerWord(HARD_START_MPS - 0.1)).toBe('보통');
    expect(powerWord(HARD_START_MPS)).toBe('세게');
    expect(powerWord(LIMITS.throwSpeedMax)).toBe('세게');
    // 세 구역 모두 0.1 m/s 로 열 칸 넘게 있다(어느 구역도 "딱 한 점"이 아니다).
    const count = { soft: 0, mid: 0, hard: 0 };
    for (let v = LIMITS.throwSpeedMin; v <= LIMITS.throwSpeedMax + 1e-9; v += 0.1) count[powerZone(v)]++;
    expect(Math.min(count.soft, count.mid, count.hard)).toBeGreaterThan(10);
    // 막대 위의 자리로 보아도 같은 구역이다.
    for (let i = 0; i <= 100; i++) {
      const g = i / 100, zone = powerZone(gaugeToSpeed(g));
      if (g < ZONE_SOFT_END - 0.011) expect(zone, String(g)).toBe('soft');
      else if (g > ZONE_SOFT_END + 0.011 && g < ZONE_HARD_START - 0.011) expect(zone, String(g)).toBe('mid');
      else if (g > ZONE_HARD_START + 0.011) expect(zone, String(g)).toBe('hard');
    }
  });

  it('세 구역이 비행기들이 좋아하는 빠르기와 맞물린다: 살살에도 보통에도 여러 대가 있고, 세게는 거의 모두보다 세다', () => {
    const trims: number[] = [];
    for (const p of PRESETS) for (const paper of PAPERS) {
      const v = analyze(buildGeometry({ ...p.design, paperId: paper.id })).trimSpeedMps;
      expect(v, `${p.id}/${paper.id}`).not.toBeNull();
      trims.push(v!);
    }
    const n = trims.length;
    const soft = trims.filter((v) => powerZone(v) === 'soft').length, mid = trims.filter((v) => powerZone(v) === 'mid').length, hard = trims.filter((v) => powerZone(v) === 'hard').length;
    expect(soft).toBeGreaterThanOrEqual(n / 4);
    expect(mid).toBeGreaterThanOrEqual(n / 4);
    expect(hard).toBeLessThanOrEqual(n / 10);
    // 막대 가운데(처음 던지는 힘)는 대부분의 비행기가 좋아하는 빠르기 이상이다: 처음 던져도 대개 잘 난다.
    expect(trims.filter((v) => v <= ORDINARY_THROW_MPS).length).toBeGreaterThanOrEqual(n * 0.8);
    expect(Math.min(...trims)).toBeGreaterThan(LIMITS.throwSpeedMin);
    expect(Math.max(...trims)).toBeLessThan(LIMITS.throwSpeedMax);
  });

  it('처음 던지기는 막대 한가운데이고, 저장된 값과 바꾸는 값은 한도 안으로 들어온다', () => {
    expect(DEFAULT_THROW_SPEED).toBe(gaugeToSpeed(0.5));
    expect(DEFAULT_THROW).toEqual({ speedMps: DEFAULT_THROW_SPEED, pitchDeg: 5, rollDeg: 0 });
    expect(defaultState().throwIn).toEqual(DEFAULT_THROW);
    expect(reducer(defaultState(), { type: 'throw', patch: { speedMps: 16 } }).throwIn.speedMps).toBe(LIMITS.throwSpeedMax);
    // 한도가 16 m/s 이던 때 저장된 지난 방문 상태(12 m/s)도 한도 안으로 들어온다.
    const old = { ...defaultState(), throwIn: { speedMps: 12, pitchDeg: 10, rollDeg: 0 } };
    expect(reviveSession(JSON.parse(JSON.stringify(old)))!.throwIn).toEqual({ speedMps: LIMITS.throwSpeedMax, pitchDeg: 10, rollDeg: 0 });
  });
});

describe('종이가 버텼는지: 아이 말', () => {
  const st = (over: Partial<FlightStructure>): FlightStructure => ({
    collapsedAtLaunch: false, buckled: false, buckledAtS: null, peakLoadRatio: 0.2, maxFlexDeg: 3, safeThrowSpeedMps: LIMITS.throwSpeedMax, noteKo: null, ...over,
  });

  it('아무 일 없으면 말하지 않고, 접힘 / 꺾임 / 아슬아슬함은 저마다 다른 말로 알려 준다', () => {
    expect(structureWords(st({}))).toBeNull();
    expect(structureWords(null)).toBeNull();
    expect(structureWords(undefined)).toBeNull();
    expect(structureWords(st({ peakLoadRatio: NEAR_MISS_RATIO - 0.01 }))).toBeNull();
    expect(structureWords(st({ peakLoadRatio: NEAR_MISS_RATIO }))!.kind).toBe('near');
    expect(structureWords(st({ buckled: true, buckledAtS: 0.4, peakLoadRatio: 1.2 }))!.kind).toBe('buckled');
    // 던지는 순간 접힌 것은 "날다가 꺾임"보다 먼저다.
    expect(structureWords(st({ collapsedAtLaunch: true, buckled: true, buckledAtS: 0, peakLoadRatio: 1.5 }))!.kind).toBe('collapsed');
    const lines = [st({ peakLoadRatio: 0.8 }), st({ buckled: true, buckledAtS: 0.4 }), st({ collapsedAtLaunch: true, buckled: true, buckledAtS: 0 })].map((s) => structureWords(s)!);
    expect(new Set(lines.map((l) => l.line)).size).toBe(3);
    for (const l of lines) {
      // 짧은 해요체, 어려운 말 없음
      expect(l.line).toMatch(/요\.$/);
      expect(l.line.length).toBeLessThanOrEqual(26);
      for (const w of ['좌굴', '하중', '강성', '동압', '항력', '양력', '받음각']) expect(`${l.line} ${l.why}`).not.toContain(w);
    }
  });

  it('core 가 실제로 돌려준 비행과 맞는다: 신문지 글라이더를 힘껏 던지면 아슬아슬, 날개를 넓힌 신문지 화살은 못 버틴다', () => {
    const near = evaluate(buildPresetDesign('glider', undefined, 'newsprint'), { speedMps: LIMITS.throwSpeedMax, pitchDeg: 5, rollDeg: 0 }).result;
    expect(near.structure.buckled).toBe(false);
    expect(near.structure.noteKo).not.toBeNull();
    expect(structureWords(near.structure)!.kind).toBe('near');
    const wide = evaluate(buildPresetDesign('dart', { ...defaultPresetParams('dart'), keelM: 0.008, elevatorDeg: 2.5 }, 'newsprint'), { speedMps: LIMITS.throwSpeedMax, pitchDeg: 5, rollDeg: 0 }).result;
    expect(wide.structure.buckled).toBe(true);
    expect(['collapsed', 'buckled']).toContain(structureWords(wide.structure)!.kind);
    expect(structureWords(wide.structure)!.kind).toBe(wide.structure.collapsedAtLaunch ? 'collapsed' : 'buckled');
    // 조언의 맨 앞은 종이 이야기다. 풀이를 이미 보여 준 뒤에는 같은 문장을 되풀이하지 않고 고칠 방법만 남긴다.
    const first = wide.tipsKo[0]!;
    expect(first).toMatch(/접혔어요|꺾였어요/);
    const tip = kidTip(first, true);
    expect(tip).not.toMatch(/접혔어요|꺾였어요/);
    expect(tip).toMatch(/던지거나|종이/);
    expect(tip).not.toMatch(/m\/s/);
    expect(kidTip(first, false)).toMatch(/접혔어요|꺾였어요/);
    // 일반 복사지 화살은 힘껏 던져도 아무 일 없다.
    expect(structureWords(evaluate(PRESETS[0]!.design, { speedMps: LIMITS.throwSpeedMax, pitchDeg: 5, rollDeg: 0 }).result.structure)).toBeNull();
  });

  it('조언의 속도는 힘 막대의 숫자로 말한다', () => {
    expect(kidify('종이가 흐물흐물해서 던지는 순간 날개가 접혔어요. 약 9.0 m/s 보다 살살 던지거나 더 빳빳한 종이를 써 보세요.')).toContain('힘을 9.0보다 낮춰서 던지거나');
    expect(kidify('안정 속도(약 3.9 m/s)보다 세게 던져서 2.6 m 나 솟아오른 뒤 속도를 잃고 실속했어요.')).toBe('이 비행기가 좋아하는 빠르기(1초에 3.9 m쯤)보다 세게 던져서 2.6 m나 솟아오른 뒤 속도를 잃고 힘이 빠졌어요.');
  });
});
