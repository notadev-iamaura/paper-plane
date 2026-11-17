import { describe, expect, it } from 'vitest';
import type { PlaneDesign } from '../src/core/types';
import { LIMITS } from '../src/core/types';
import { PAPERS } from '../src/core/papers';
import { PRESETS } from '../src/core/presets';
import { validateDesign } from '../src/core/validate';
import { makeLcg, randomDesign } from './helpers';

function good(): PlaneDesign {
  return {
    v: 1,
    paperId: 'copy80',
    folds: [
      { a: { x: -0.105, y: 0.0435 }, b: { x: 0, y: 0.1485 }, dir: 'valley' },
      { a: { x: 0, y: 0.1485 }, b: { x: 0.105, y: 0.0435 }, dir: 'mountain' },
    ],
    shaping: { keelM: 0.02, dihedralDeg: 10, wingletM: 0.01, wingletDeg: 45, elevatorDeg: 3 },
    clip: { xBodyM: -0.05 },
  };
}

/** 올바른 설계를 복사해 한 군데만 바꾼다. */
function mutate(fn: (d: any) => void): unknown {
  const d = JSON.parse(JSON.stringify(good()));
  fn(d);
  return d;
}

function expectBad(x: unknown, label: string): void {
  let r: ReturnType<typeof validateDesign> | undefined;
  expect(() => { r = validateDesign(x); }, label).not.toThrow();
  expect(r!.ok, label).toBe(false);
  expect(r!.errors.length, label).toBeGreaterThan(0);
  expect(r!.errors.length).toBeLessThanOrEqual(12);
  for (const e of r!.errors) {
    expect(typeof e).toBe('string');
    expect(/[가-힣]/.test(e), `${label}: 한국어 메시지여야 함 (${e})`).toBe(true);
  }
}

describe('validateDesign', () => {
  it('올바른 설계와 모든 프리셋을 통과시킨다', () => {
    expect(validateDesign(good())).toEqual({ ok: true, errors: [] });
    expect(validateDesign(mutate((d) => { d.clip = null; d.folds = []; }))).toEqual({ ok: true, errors: [] });
    for (const p of PRESETS) expect(validateDesign(p.design), p.id).toEqual({ ok: true, errors: [] });
    for (const paper of PAPERS) expect(validateDesign(mutate((d) => { d.paperId = paper.id; })).ok).toBe(true);
    // JSON 으로 오간 뒤에도 통과
    for (const p of PRESETS) expect(validateDesign(JSON.parse(JSON.stringify(p.design))).ok).toBe(true);
  });

  it('임의 설계 생성기의 결과를 통과시킨다', () => {
    const rnd = makeLcg(1);
    for (let i = 0; i < 300; i++) expect(validateDesign(randomDesign(rnd)).ok).toBe(true);
  });

  it('경계값을 받아들인다', () => {
    expect(validateDesign(mutate((d) => { d.shaping.keelM = 0; d.shaping.wingletM = 0; })).ok).toBe(true);
    expect(validateDesign(mutate((d) => { d.shaping.keelM = 0.105; d.shaping.wingletM = 0; })).ok).toBe(true);
    expect(validateDesign(mutate((d) => { d.shaping.keelM = 0.065; d.shaping.wingletM = 0.04; })).ok).toBe(true);
    expect(validateDesign(mutate((d) => { d.shaping.dihedralDeg = LIMITS.dihedralMin; })).ok).toBe(true);
    expect(validateDesign(mutate((d) => { d.shaping.dihedralDeg = LIMITS.dihedralMax; })).ok).toBe(true);
    expect(validateDesign(mutate((d) => { d.shaping.wingletDeg = LIMITS.wingletDegMin; })).ok).toBe(true);
    expect(validateDesign(mutate((d) => { d.shaping.elevatorDeg = LIMITS.elevatorMax; })).ok).toBe(true);
    expect(validateDesign(mutate((d) => { d.clip.xBodyM = 0; })).ok).toBe(true);
    expect(validateDesign(mutate((d) => { d.clip.xBodyM = -0.297; })).ok).toBe(true);
    expect(validateDesign(mutate((d) => { d.folds[0].a = { x: 0.42, y: -0.594 }; })).ok).toBe(true);
    const many = mutate((d) => { d.folds = Array.from({ length: LIMITS.maxFolds }, () => d.folds[0]); });
    expect(validateDesign(many).ok).toBe(true);
  });

  it('구조가 틀린 입력을 거부한다', () => {
    const cases: [string, unknown][] = [
      ['null', null], ['undefined', undefined], ['숫자', 42], ['문자열', 'design'], ['불리언', true],
      ['배열', []], ['배열 안 설계', [good()]], ['빈 객체', {}], ['함수', () => 1], ['심볼', Symbol('x')],
      ['Date', new Date(0)], ['Map', new Map()], ['NaN', NaN], ['BigInt', BigInt(1)],
      ['JSON 문자열', JSON.stringify(good())],
      ['v 없음', mutate((d) => { delete d.v; })],
      ['paperId 없음', mutate((d) => { delete d.paperId; })],
      ['folds 없음', mutate((d) => { delete d.folds; })],
      ['shaping 없음', mutate((d) => { delete d.shaping; })],
      ['clip 없음', mutate((d) => { delete d.clip; })],
      ['모르는 키', mutate((d) => { d.extra = 1; })],
      ['모르는 키(접기)', mutate((d) => { d.folds[0].extra = 1; })],
      ['모르는 키(점)', mutate((d) => { d.folds[0].a.z = 0; })],
      ['모르는 키(마무리)', mutate((d) => { d.shaping.massKg = 0.001; })],
      ['모르는 키(클립)', mutate((d) => { d.clip.massKg = 1; })],
    ];
    for (const [label, x] of cases) expectBad(x, label);
  });

  it('버전과 종이를 검사한다', () => {
    expectBad(mutate((d) => { d.v = 2; }), 'v=2');
    expectBad(mutate((d) => { d.v = '1'; }), "v='1'");
    expectBad(mutate((d) => { d.v = true; }), 'v=true');
    expectBad(mutate((d) => { d.paperId = 'gold-leaf'; }), '모르는 종이');
    expectBad(mutate((d) => { d.paperId = ''; }), '빈 종이');
    expectBad(mutate((d) => { d.paperId = 3; }), '종이 숫자');
    expectBad(mutate((d) => { d.paperId = null; }), '종이 null');
    expectBad(mutate((d) => { d.paperId = '__proto__'; }), '종이 __proto__');
    expectBad(mutate((d) => { d.paperId = 'toString'; }), '종이 toString');
    expectBad(mutate((d) => { d.paperId = { id: 'copy80' }; }), '종이 객체');
    expectBad(mutate((d) => { d.paperId = 'x'.repeat(100000); }), '긴 종이 이름');
  });

  it('접기 목록을 검사한다', () => {
    expectBad(mutate((d) => { d.folds = null; }), 'folds null');
    expectBad(mutate((d) => { d.folds = {}; }), 'folds 객체');
    expectBad(mutate((d) => { d.folds = 'abc'; }), 'folds 문자열');
    expectBad(mutate((d) => { d.folds = { length: 1, 0: d.folds[0] }; }), 'folds 유사 배열');
    expectBad(mutate((d) => { d.folds = Array.from({ length: LIMITS.maxFolds + 1 }, () => d.folds[0]); }), '너무 많은 접기');
    expectBad(mutate((d) => { d.folds = [null]; }), '접기 null');
    expectBad(mutate((d) => { d.folds = [[]]; }), '접기 배열');
    expectBad(mutate((d) => { d.folds = [7]; }), '접기 숫자');
    expectBad(mutate((d) => { d.folds[0].dir = 'up'; }), '모르는 방향');
    expectBad(mutate((d) => { d.folds[0].dir = 1; }), '방향 숫자');
    expectBad(mutate((d) => { delete d.folds[0].dir; }), '방향 없음');
    expectBad(mutate((d) => { delete d.folds[0].a; }), 'a 없음');
    expectBad(mutate((d) => { d.folds[0].a = null; }), 'a null');
    expectBad(mutate((d) => { d.folds[0].a = [0, 0]; }), 'a 배열');
    expectBad(mutate((d) => { d.folds[0].b = { x: 0 }; }), 'b.y 없음');
    expectBad(mutate((d) => { d.folds[0].a.x = '0'; }), '좌표 문자열');
    expectBad(mutate((d) => { d.folds[0].a.x = null; }), '좌표 null');
    expectBad(mutate((d) => { d.folds[1].b = { ...d.folds[1].a }; }), '같은 두 점');
    expectBad(mutate((d) => { d.folds[1].b = { x: d.folds[1].a.x + 1e-5, y: d.folds[1].a.y }; }), '거의 같은 두 점');
    expectBad(mutate((d) => { d.folds[0].a.x = 0.43; }), '너무 먼 점 x');
    expectBad(mutate((d) => { d.folds[0].b.y = -0.6; }), '너무 먼 점 y');
    expectBad(mutate((d) => { d.folds[0].b.y = 1e300; }), '거대한 좌표');
    // NaN, Infinity 는 JSON 으로 못 보내지만 직접 만든 객체로는 올 수 있다.
    for (const bad of [NaN, Infinity, -Infinity]) {
      const d = good();
      d.folds[0]!.a.x = bad;
      expectBad(d, `좌표 ${bad}`);
    }
  });

  it('마무리 접기 값을 검사한다', () => {
    expectBad(mutate((d) => { d.shaping = null; }), 'shaping null');
    expectBad(mutate((d) => { d.shaping = []; }), 'shaping 배열');
    expectBad(mutate((d) => { d.shaping.keelM = -0.001; }), '음수 동체');
    expectBad(mutate((d) => { d.shaping.keelM = 0.11; }), '동체가 반쪽 폭보다 큼');
    expectBad(mutate((d) => { d.shaping.wingletM = -0.01; }), '음수 날개 끝');
    expectBad(mutate((d) => { d.shaping.keelM = 0.07; d.shaping.wingletM = 0.04; }), '합이 반쪽 폭 초과');
    expectBad(mutate((d) => { d.shaping.dihedralDeg = LIMITS.dihedralMax + 0.5; }), '상반각 초과');
    expectBad(mutate((d) => { d.shaping.dihedralDeg = LIMITS.dihedralMin - 0.5; }), '상반각 미만');
    expectBad(mutate((d) => { d.shaping.wingletDeg = 91; }), '날개 끝 각도 초과');
    expectBad(mutate((d) => { d.shaping.wingletDeg = -91; }), '날개 끝 각도 미만');
    expectBad(mutate((d) => { d.shaping.elevatorDeg = LIMITS.elevatorMax + 1; }), '뒷전 초과');
    expectBad(mutate((d) => { d.shaping.elevatorDeg = LIMITS.elevatorMin - 1; }), '뒷전 미만');
    expectBad(mutate((d) => { d.shaping.keelM = '0.02'; }), '문자열 숫자');
    expectBad(mutate((d) => { delete d.shaping.elevatorDeg; }), '항목 없음');
    for (const key of ['keelM', 'dihedralDeg', 'wingletM', 'wingletDeg', 'elevatorDeg'] as const) {
      for (const bad of [NaN, Infinity, -Infinity]) {
        const d = good();
        d.shaping[key] = bad;
        expectBad(d, `${key}=${bad}`);
      }
    }
  });

  it('클립을 검사한다', () => {
    expectBad(mutate((d) => { d.clip = undefined; }), 'clip undefined'); // JSON 에서는 키가 사라진다
    expectBad({ ...good(), clip: undefined }, 'clip undefined 직접');
    expectBad(mutate((d) => { d.clip = 0; }), 'clip 숫자');
    expectBad(mutate((d) => { d.clip = false; }), 'clip false');
    expectBad(mutate((d) => { d.clip = []; }), 'clip 배열');
    expectBad(mutate((d) => { d.clip = {}; }), 'clip 빈 객체');
    expectBad(mutate((d) => { d.clip.xBodyM = 0.01; }), '기수보다 앞');
    expectBad(mutate((d) => { d.clip.xBodyM = -0.3; }), '꼬리보다 뒤');
    expectBad(mutate((d) => { d.clip.xBodyM = '0'; }), '문자열');
    expectBad({ ...good(), clip: { xBodyM: NaN } }, 'NaN');
    expectBad({ ...good(), clip: { xBodyM: -Infinity } }, '-Infinity');
  });

  it('프로토타입 오염 키와 이상한 객체에도 안전하다', () => {
    // JSON.parse 는 "__proto__" 를 진짜 키로 만든다.
    expectBad(JSON.parse('{"v":1,"paperId":"copy80","folds":[],"shaping":{"keelM":0,"dihedralDeg":0,"wingletM":0,"wingletDeg":0,"elevatorDeg":0},"clip":null,"__proto__":{"polluted":true}}'), '__proto__ 키');
    expectBad(JSON.parse('{"v":1,"paperId":"copy80","folds":[],"shaping":{"keelM":0,"dihedralDeg":0,"wingletM":0,"wingletDeg":0,"elevatorDeg":0,"constructor":{"prototype":{"x":1}}},"clip":null}'), 'constructor 키');
    expectBad(JSON.parse('{"__proto__":{"v":1,"paperId":"copy80","folds":[],"shaping":{},"clip":null}}'), '__proto__ 로만 채운 객체');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    // 필요한 값이 프로토타입에만 있는 객체(자기 것이 아님)
    const inherited = Object.create(good()) as unknown;
    expectBad(inherited, '상속된 값');
    // 클래스 인스턴스
    class Fake { v = 1; paperId = 'copy80'; folds = []; shaping = good().shaping; clip = null; }
    expectBad(new Fake(), '클래스 인스턴스');
    // 읽을 때 예외를 던지는 객체
    const thrower = { ...good() };
    Object.defineProperty(thrower, 'folds', { enumerable: true, get() { throw new Error('boom'); } });
    expectBad(thrower, 'getter 예외');
    const proxy = new Proxy({}, { ownKeys() { throw new Error('boom'); }, getPrototypeOf() { throw new Error('boom'); } });
    expectBad(proxy, 'Proxy 예외');
    // 자기 자신을 가리키는 객체
    const cyc: Record<string, unknown> = { ...good() };
    cyc.shaping = cyc;
    expectBad(cyc, '순환 참조');
    // null 프로토타입 객체는 내용이 맞으면 통과
    const bare = Object.assign(Object.create(null), good()) as unknown;
    expect(validateDesign(bare).ok).toBe(true);
  });

  it('거대한 입력도 빨리 거부한다', () => {
    const huge = mutate((d) => { d.folds = new Array(2_000_000).fill(d.folds[0]); });
    const t0 = performance.now();
    expectBad(huge, '200만 개 접기');
    const sparse = good() as unknown as { folds: unknown[] };
    sparse.folds = [];
    sparse.folds.length = 4_000_000_000;
    expectBad(sparse, '길이만 큰 배열');
    const wide: Record<string, unknown> = { ...good() };
    for (let i = 0; i < 50_000; i++) wide[`k${i}`] = i;
    expectBad(wide, '키가 아주 많은 객체');
    // 깊게 중첩된 값
    let deep: unknown = 1;
    for (let i = 0; i < 20_000; i++) deep = { a: deep };
    expectBad(mutate((d) => { d.shaping = deep; }), '깊은 중첩');
    expectBad({ ...good(), clip: deep }, '깊은 중첩 클립');
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('오류가 많아도 메시지 개수는 제한된다', () => {
    const d = mutate((x) => {
      x.folds = Array.from({ length: LIMITS.maxFolds }, () => ({ a: { x: 9, y: 9 }, b: { x: 'q', y: 0 }, dir: 'zz' }));
    });
    const r = validateDesign(d);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeLessThanOrEqual(12);
  });
});
