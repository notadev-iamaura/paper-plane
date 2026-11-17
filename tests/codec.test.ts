import { describe, expect, it } from 'vitest';
import type { PlaneDesign, ThrowInput } from '../src/core/types';
import { LIMITS } from '../src/core/types';
import { decodeDesign, encodeDesign } from '../src/core/codec';
import { PRESETS, buildPresetDesign } from '../src/core/presets';
import { PAPERS } from '../src/core/papers';
import { validateDesign } from '../src/core/validate';
import { buildGeometry } from '../src/core/fold/geometry';
import { validateSubmission } from '../src/core/index';
import { validateThrow } from '../src/core/sim/simulate';
import { makeLcg, randomDesign } from './helpers';

const ALNUM = /^[0-9A-Za-z]+$/;
const LEN_TOL = 0.5e-4 + 1e-9;
const ANG_TOL = 0.05 + 1e-9;

/** 반올림 오차 범위 안에서 같은 설계인지 */
function expectClose(a: PlaneDesign, b: PlaneDesign): void {
  expect(b.v).toBe(1);
  expect(b.paperId).toBe(a.paperId);
  expect(b.folds.length).toBe(a.folds.length);
  a.folds.forEach((f, i) => {
    const g = b.folds[i]!;
    expect(g.dir).toBe(f.dir);
    expect(Math.abs(g.a.x - f.a.x)).toBeLessThanOrEqual(LEN_TOL);
    expect(Math.abs(g.a.y - f.a.y)).toBeLessThanOrEqual(LEN_TOL);
    expect(Math.abs(g.b.x - f.b.x)).toBeLessThanOrEqual(LEN_TOL);
    expect(Math.abs(g.b.y - f.b.y)).toBeLessThanOrEqual(LEN_TOL);
  });
  expect(Math.abs(b.shaping.keelM - a.shaping.keelM)).toBeLessThanOrEqual(LEN_TOL);
  expect(Math.abs(b.shaping.wingletM - a.shaping.wingletM)).toBeLessThanOrEqual(LEN_TOL);
  expect(Math.abs(b.shaping.dihedralDeg - a.shaping.dihedralDeg)).toBeLessThanOrEqual(ANG_TOL);
  expect(Math.abs(b.shaping.wingletDeg - a.shaping.wingletDeg)).toBeLessThanOrEqual(ANG_TOL);
  expect(Math.abs(b.shaping.elevatorDeg - a.shaping.elevatorDeg)).toBeLessThanOrEqual(ANG_TOL);
  if (a.clip === null) expect(b.clip).toBeNull();
  else expect(Math.abs(b.clip!.xBodyM - a.clip.xBodyM)).toBeLessThanOrEqual(LEN_TOL);
}

function randomThrow(rnd: () => number): ThrowInput {
  return {
    speedMps: LIMITS.throwSpeedMin + rnd() * (LIMITS.throwSpeedMax - LIMITS.throwSpeedMin),
    pitchDeg: LIMITS.pitchMin + rnd() * (LIMITS.pitchMax - LIMITS.pitchMin),
    rollDeg: LIMITS.rollMin + rnd() * (LIMITS.rollMax - LIMITS.rollMin),
  };
}

describe('공유 코드', () => {
  it('프리셋은 코드로 바꿨다 되돌리면 완전히 같은 설계가 된다', () => {
    for (const p of PRESETS) {
      for (const paper of PAPERS) {
        const d = buildPresetDesign(p.id, undefined, paper.id);
        const code = encodeDesign(d);
        expect(code, p.id).toMatch(ALNUM);
        expect(code.startsWith('P1')).toBe(true);
        expect(code.length).toBeLessThan(120);
        const back = decodeDesign(code);
        expect(back, p.id).not.toBeNull();
        expect(back!.design).toEqual(d);
        expect(back!.throwIn).toBeUndefined();
        expect('throwIn' in back!).toBe(false);
        expect(encodeDesign(back!.design)).toBe(code);
        // 되돌린 설계의 형상도 완전히 같다.
        if (paper.id === 'copy80') expect(buildGeometry(back!.design)).toEqual(buildGeometry(d));
      }
    }
  });

  it('임의 설계 수백 개: 반올림 범위 안에서 같고, 다시 코드로 만들면 같은 코드다', () => {
    const rnd = makeLcg(987654321);
    let maxLen = 0;
    for (let i = 0; i < 400; i++) {
      const d = randomDesign(rnd, i % 10 === 0 ? LIMITS.maxFolds : 8);
      const t = i % 2 === 0 ? randomThrow(rnd) : undefined;
      const code = encodeDesign(d, t);
      expect(code).toMatch(ALNUM);
      maxLen = Math.max(maxLen, code.length);
      const back = decodeDesign(code);
      expect(back, `#${i}`).not.toBeNull();
      expectClose(d, back!.design);
      expect(validateDesign(back!.design).ok).toBe(true);
      if (t) {
        expect(Math.abs(back!.throwIn!.speedMps - t.speedMps)).toBeLessThanOrEqual(0.005 + 1e-9);
        expect(Math.abs(back!.throwIn!.pitchDeg - t.pitchDeg)).toBeLessThanOrEqual(ANG_TOL);
        expect(Math.abs(back!.throwIn!.rollDeg - t.rollDeg)).toBeLessThanOrEqual(ANG_TOL);
      } else {
        expect(back!.throwIn).toBeUndefined();
      }
      // 멱등성: encode(decode(encode(d))) === encode(d)
      const again = encodeDesign(back!.design, back!.throwIn);
      expect(again).toBe(code);
      expect(decodeDesign(again)).toEqual(back);
    }
    // 24번 접기 + 던지기 값도 주소에 넣을 만한 길이
    expect(maxLen).toBeLessThan(320);
  });

  it('던지기 값의 끝값이 그대로 돌아온다', () => {
    const d = PRESETS[0]!.design;
    for (const t of [
      { speedMps: LIMITS.throwSpeedMin, pitchDeg: LIMITS.pitchMin, rollDeg: LIMITS.rollMin },
      { speedMps: LIMITS.throwSpeedMax, pitchDeg: LIMITS.pitchMax, rollDeg: LIMITS.rollMax },
      { speedMps: 7.25, pitchDeg: 12.3, rollDeg: -4.5 },
      { speedMps: 9, pitchDeg: 0, rollDeg: 0 },
    ]) {
      expect(decodeDesign(encodeDesign(d, t))).toEqual({ design: d, throwIn: t });
    }
    // 물리 2판에서 바뀐 시험: 예전에는 범위를 벗어난 던지기 값이 든 코드를 통째로 버렸다(null).
    // 지금은 설계는 돌려주고, 던지기 값은 "없음"으로 하되 원래 값을 throwOutOfRange 로 알려 준다(한도 안으로 자르지 않는다).
    for (const t of [
      { speedMps: 99, pitchDeg: 0, rollDeg: 0 }, { speedMps: 5, pitchDeg: 80, rollDeg: 0 }, { speedMps: 5, pitchDeg: 0, rollDeg: -45 },
      { speedMps: LIMITS.throwSpeedMax + 0.01, pitchDeg: 0, rollDeg: 0 }, { speedMps: LIMITS.throwSpeedMin - 0.01, pitchDeg: 0, rollDeg: 0 },
    ]) {
      const back = decodeDesign(encodeDesign(d, t));
      expect(back).toEqual({ design: d, throwOutOfRange: t });
      expect(back!.throwIn).toBeUndefined();
      expect('throwIn' in back!).toBe(false);
    }
    // 범위 안의 던지기 값에는 throwOutOfRange 가 붙지 않는다
    expect('throwOutOfRange' in decodeDesign(encodeDesign(d, { speedMps: 9, pitchDeg: 0, rollDeg: 0 }))!).toBe(false);
    expect('throwOutOfRange' in decodeDesign(encodeDesign(d))!).toBe(false);
  });

  // 던지기 한도를 16 -> 10 m/s 로 낮추기 전(물리 1판)의 core 가 실제로 만든 코드들이다. 글자 그대로 붙여 두었다.
  describe('예전(던지기 한도 16 m/s) 코드와의 호환', () => {
    const OLD = {
      // 기본 다트(당시 기본값: 뒷전 2.5도), 일반 복사지, 14 m/s 10도. 당시 기록 14.80 m
      dart14: 'P19uWgrXAv9kAn015ONpdOEaSzCL1klCelt5QC0ReLIhfeF338e14N3BxJoblqZBi7TpYQuVF6p',
      // 기본 글라이더, 켄트지, 16 m/s 60도 기울임 30도
      glider16: 'P11FEEC6zmLXLbhglYgWbzckLlh8CfJiJ4odiftO5r0baooQUVylyOl7qm7v5r9jGnTEWmKmca5uIJzYkPc8EQoa2TarkXARc',
      // 기본 다트, 8 m/s 10도 (지금도 범위 안)
      dart8: 'P19uWgrXAv9kAn015ONpdOEaSzCL1klCelt5QC0ReLIhfeF338e14N3BxJoblqZBhv0KrXwGfWn',
      // 기본 다트, 10.01 m/s (새 한도를 0.01 넘는다)
      dart1001: 'P19uWgrXAv9kAn015ONpdOEaSzCL1klCelt5QC0ReLIhfeF338e14N3BxJoblqZBhzBSETJrYmg',
      // 던지기 값이 없는 설계 코드(격납고에 저장되는 형태)
      designOnly: 'P17czbLu1NZQ6t1jNsF4unFNBArEa1g2g8V4GTfxgvwTeIdlCkezLnagqdqaFpf7OYo',
    };
    const oldDartShaping = { keelM: 0.02, dihedralDeg: 10, wingletM: 0, wingletDeg: 0, elevatorDeg: 2.5 };

    it('코드 형식(P1)은 그대로다: 같은 입력이면 예전과 글자 하나 다르지 않은 코드가 나온다', () => {
      const oldDart: PlaneDesign = { ...PRESETS.find((p) => p.id === 'dart')!.design, shaping: oldDartShaping };
      expect(encodeDesign(oldDart, { speedMps: 14, pitchDeg: 10, rollDeg: 0 })).toBe(OLD.dart14);
      expect(encodeDesign(oldDart, { speedMps: 8, pitchDeg: 10, rollDeg: 0 })).toBe(OLD.dart8);
      expect(encodeDesign(oldDart)).toBe(OLD.designOnly);
    });

    it('한도를 넘는 던지기가 든 예전 코드: 설계는 그대로 돌아오고, 던지기는 없음으로 처리되며 원래 값이 throwOutOfRange 로 온다', () => {
      const a = decodeDesign(OLD.dart14);
      expect(a).not.toBeNull();
      expect(validateDesign(a!.design).ok).toBe(true);
      expect(a!.design.paperId).toBe('copy80');
      expect(a!.design.shaping).toEqual(oldDartShaping);
      expect(a!.throwIn).toBeUndefined();
      expect(a!.throwOutOfRange).toEqual({ speedMps: 14, pitchDeg: 10, rollDeg: 0 });
      // 설계만 다시 코드로 만들면 예전의 설계 코드와 같다(격납고의 비행기는 그대로 살아 있다)
      expect(encodeDesign(a!.design)).toBe(OLD.designOnly);

      const b = decodeDesign(OLD.glider16)!;
      expect(b.design.paperId).toBe('kent160');
      expect(b.throwIn).toBeUndefined();
      expect(b.throwOutOfRange).toEqual({ speedMps: 16, pitchDeg: 60, rollDeg: 30 });

      // 한도를 0.01 m/s 만 넘어도 자르지 않는다(10.01 을 10 으로 바꾸면 다른 던지기가 된다)
      const c = decodeDesign(OLD.dart1001)!;
      expect(c.throwIn).toBeUndefined();
      expect(c.throwOutOfRange).toEqual({ speedMps: 10.01, pitchDeg: 0, rollDeg: 0 });
    });

    it('범위 안의 던지기가 든 예전 코드와 설계 코드는 예전과 똑같이 읽힌다', () => {
      const a = decodeDesign(OLD.dart8)!;
      expect(a.throwIn).toEqual({ speedMps: 8, pitchDeg: 10, rollDeg: 0 });
      expect(a.throwOutOfRange).toBeUndefined();
      expect(a.design.shaping).toEqual(oldDartShaping);
      expect(encodeDesign(a.design, a.throwIn)).toBe(OLD.dart8);
      const d = decodeDesign(OLD.designOnly)!;
      expect(d.throwIn).toBeUndefined();
      expect(d.throwOutOfRange).toBeUndefined();
      expect(d.design).toEqual(a.design);
    });

    it('랭킹 제출 검사는 예전의 센 던지기를 받지 않는다(한도 안으로 잘라 받지도 않는다)', () => {
      const a = decodeDesign(OLD.dart14)!;
      // 던지기 값이 없으므로 제출할 수 없다
      expect(validateSubmission(a.design, a.throwIn).ok).toBe(false);
      // 원래 값을 그대로 넣어도 한도 검사에서 걸린다
      const v = validateSubmission(a.design, a.throwOutOfRange);
      expect(v.ok).toBe(false);
      expect(v.errors.join(' ')).toContain(`${LIMITS.throwSpeedMin}~${LIMITS.throwSpeedMax}`);
      expect(validateThrow({ speedMps: LIMITS.throwSpeedMax, pitchDeg: 0, rollDeg: 0 }).ok).toBe(true);
      expect(validateThrow({ speedMps: LIMITS.throwSpeedMax + 0.01, pitchDeg: 0, rollDeg: 0 }).ok).toBe(false);
      expect(LIMITS.throwSpeedMax).toBe(10);
      expect(LIMITS.throwSpeedMin).toBe(2);
    });

    it('깨진 코드는 여전히 null 이다(설계가 틀리면 던지기 값과 상관없이 버린다)', () => {
      expect(decodeDesign(OLD.dart14.slice(0, -1))).toBeNull();
      expect(decodeDesign(OLD.dart14.replace('P1', 'P2'))).toBeNull();
      const flipped = OLD.dart14.slice(0, 20) + (OLD.dart14[20] === 'A' ? 'B' : 'A') + OLD.dart14.slice(21);
      expect(decodeDesign(flipped)).toBeNull();
    });
  });

  it('클립, 산접기, 음수 값이 보존된다', () => {
    const d: PlaneDesign = {
      v: 1, paperId: 'kent160',
      folds: Array.from({ length: 11 }, (_, i) => ({
        a: { x: -0.1 + i * 0.01, y: -0.14 }, b: { x: 0.05, y: 0.1 - i * 0.02 }, dir: i % 3 === 0 ? 'mountain' as const : 'valley' as const,
      })),
      shaping: { keelM: 0.0123, dihedralDeg: -7.5, wingletM: 0.031, wingletDeg: -90, elevatorDeg: -15 },
      clip: { xBodyM: -0.1234 },
    };
    const back = decodeDesign(encodeDesign(d))!;
    // 입력 좌표(-0.1 + 3 * 0.01 등)에 부동소수 꼬리가 있으므로 반올림 범위 안에서 비교한다.
    expectClose(d, back.design);
    expect(back.design.folds.map((f) => f.dir)).toEqual(d.folds.map((f) => f.dir));
    expect(back.design.shaping).toEqual(d.shaping);
    expect(back.design.clip).toEqual(d.clip);
  });

  it('검사를 통과하지 못하는 설계의 코드는 되돌리지 않는다', () => {
    const base = PRESETS[0]!.design;
    expect(decodeDesign(encodeDesign({ ...base, paperId: 'unknown' }))).toBeNull();
    expect(decodeDesign(encodeDesign({ ...base, shaping: { ...base.shaping, dihedralDeg: 80 } }))).toBeNull();
    expect(decodeDesign(encodeDesign({ ...base, shaping: { ...base.shaping, keelM: 0.2 } }))).toBeNull();
    expect(decodeDesign(encodeDesign({ ...base, clip: { xBodyM: 0.05 } }))).toBeNull();
    const tooMany = { ...base, folds: Array.from({ length: 30 }, () => base.folds[0]!) };
    expect(decodeDesign(encodeDesign(tooMany))).toBeNull();
    const samePoint = { ...base, folds: [{ a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, dir: 'valley' as const }] };
    expect(decodeDesign(encodeDesign(samePoint))).toBeNull();
    // 이상한 값을 넣어도 encode 는 예외 없이 문자열을 만든다.
    const junk = { v: 1, paperId: 'copy80', folds: [null, { a: null }], shaping: null, clip: {} } as unknown as PlaneDesign;
    expect(() => encodeDesign(junk)).not.toThrow();
    expect(encodeDesign(junk)).toMatch(ALNUM);
    const nan = { ...base, shaping: { ...base.shaping, keelM: NaN, wingletM: Infinity } };
    expect(encodeDesign(nan)).toMatch(ALNUM);
  });

  it('잘못된 코드는 null 을 돌려주고 예외를 던지지 않는다', () => {
    const code = encodeDesign(PRESETS[0]!.design, { speedMps: 8, pitchDeg: 10, rollDeg: 0 });
    const bad: unknown[] = [
      '', ' ', 'P', 'P1', 'P2' + code.slice(2), 'p1' + code.slice(2), 'X' + code, code + '0', code.slice(0, -1),
      code.slice(0, 10), 'P1' + '0' + code.slice(2), code.replace(/.$/, '-'), code + ' ', ' ' + code, code + '\n',
      'P1' + '_'.repeat(20), 'P1' + 'z'.repeat(60), 'P1' + 'A'.repeat(1000), 'P1' + 'z'.repeat(100000),
      'P1한글코드', 'P1😀', 'P1' + code.slice(2).split('').reverse().join(''),
      null, undefined, 42, {}, [], true, Symbol('x'), { toString() { throw new Error('boom'); } },
    ];
    for (const b of bad) {
      let r: unknown = 'unset';
      expect(() => { r = decodeDesign(b as string); }).not.toThrow();
      expect(r, String(typeof b === 'string' ? b.slice(0, 30) : typeof b)).toBeNull();
    }
  });

  it('글자 하나만 바뀌어도 검사값에서 걸린다', () => {
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const rnd = makeLcg(31337);
    let rejected = 0;
    let total = 0;
    for (const p of PRESETS) {
      const code = encodeDesign(p.design);
      // 모든 자리를 한 번씩 다른 글자로 바꿔 본다.
      for (let i = 2; i < code.length; i++) {
        let c = alphabet[Math.floor(rnd() * 62)]!;
        if (c === code[i]) c = c === 'A' ? 'B' : 'A';
        const mutated = code.slice(0, i) + c + code.slice(i + 1);
        total++;
        if (decodeDesign(mutated) === null) rejected++;
      }
      // 이웃한 두 글자를 바꿔 본다.
      for (let i = 2; i + 1 < code.length; i++) {
        if (code[i] === code[i + 1]) continue;
        const swapped = code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2);
        total++;
        if (decodeDesign(swapped) === null) rejected++;
      }
    }
    // 16비트 검사값이므로 우연히 통과할 확률은 약 1/65536. 이 고정된 표본에서는 전부 걸려야 한다.
    expect(total).toBeGreaterThan(500);
    expect(rejected).toBe(total);
  });

  it('임의의 영문자+숫자 문자열은 받아들이지 않는다', () => {
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const rnd = makeLcg(2024);
    for (let i = 0; i < 2000; i++) {
      const len = 1 + Math.floor(rnd() * 120);
      let s = 'P1';
      for (let k = 0; k < len; k++) s += alphabet[Math.floor(rnd() * 62)];
      expect(decodeDesign(s)).toBeNull();
    }
  });
});
