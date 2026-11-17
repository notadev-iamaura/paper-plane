/**
 * 순위표의 순수한 부분 검사: 별명 다듬기, 믿을 수 없는 문서 읽기, 코드 검사, 순서와 동점,
 * 기억해 두기(LRU), 제한 시간, 그리고 흉내 저장소로 본 "더 좋을 때만 쓰기 / 한 번만 다시 하기 / 구경만 하기".
 * 가장 중요한 것: 저장소의 문서를 아무리 꾸며도 가짜 점수가 순위표에 오르지 못한다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeDesign, encodeDesign, evaluate, LIMITS, PRESETS } from '../src/core/index';
import type { PlaneDesign, ThrowInput } from '../src/core/index';
import {
  AT_LAST, buildBoard, checkCode, compareRows, docAfterRemove, docAfterSubmit, isBetter, isDocId, parseEntry, parseScoreDoc,
  sanitizeNickname, scoreKey,
} from '../src/app/lib/ranking/board';
import type { Lookup } from '../src/app/lib/ranking/board';
import { codeHash, ResultCache, SLOW_RETRY_MS, toVerified } from '../src/app/lib/ranking/cache';
import type { CacheVal } from '../src/app/lib/ranking/cache';
import { createPageDbBackend, errorCode } from '../src/app/lib/ranking/pageDbBackend';
import type { DbDocSnapshot, DbQuerySnapshot, PageDb } from '../src/app/lib/ranking/pageDbBackend';
import type { ScoreDoc, Verified } from '../src/app/lib/ranking/types';
import { Verifier } from '../src/app/lib/ranking/verifier';
import type { Evaluator } from '../src/app/lib/ranking/verifier';

const NOW = Date.UTC(2026, 10, 15);
const T = (speedMps: number, pitchDeg: number, rollDeg = 0): ThrowInput => ({ speedMps, pitchDeg, rollDeg });
const design = (i: number): PlaneDesign => PRESETS[i % PRESETS.length]!.design;
const codeOf = (i: number, t: ThrowInput): string => encodeDesign(design(i), t);

/** core 로 바로 계산한 값(순위표 코드를 거치지 않는다) */
function truth(code: string): { distanceM: number; airtimeS: number } {
  const dec = decodeDesign(code)!;
  const r = evaluate(dec.design, dec.throwIn!).result;
  return { distanceM: r.distanceM, airtimeS: r.airtimeS };
}

/** 진짜 core 로 계산하는 계산기(바로 답한다) */
const realEvaluator: Evaluator = (d, t) => {
  const r = evaluate(d, t).result;
  return { promise: Promise.resolve({ distanceM: r.distanceM, airtimeS: r.airtimeS, verdict: r.verdict }), abort: () => undefined };
};

const A = codeOf(0, T(9, 12));
const B = codeOf(1, T(7, 8));
const C = codeOf(3, T(10, 15));

afterEach(() => { vi.useRealTimers(); });

// ---------------------------------------------------------------------------
describe('별명 다듬기', () => {
  it('앞뒤 공백과 제어 문자를 지운다', () => {
    expect(sanitizeNickname('  종이왕 \n')).toBe('종이왕');
    expect(sanitizeNickname('a\u0000b\u0007c\u007f')).toBe('abc');
    expect(sanitizeNickname('가 나‮다')).toBe('가나다');
  });
  it('1~16자가 아니면 받지 않는다', () => {
    expect(sanitizeNickname('')).toBeNull();
    expect(sanitizeNickname('   \t ')).toBeNull();
    expect(sanitizeNickname('가'.repeat(16))).toBe('가'.repeat(16));
    expect(sanitizeNickname('가'.repeat(17))).toBeNull();
    expect(sanitizeNickname('x'.repeat(300))).toBeNull();
  });
  it('글자가 아닌 값은 받지 않는다', () => {
    for (const v of [null, undefined, 3, {}, ['a']]) expect(sanitizeNickname(v)).toBeNull();
  });
  it('꺾쇠 같은 글자는 글자 그대로 둔다(화면은 글자로만 보여 준다)', () => {
    expect(sanitizeNickname('<b>왕</b>')).toBe('<b>왕</b>');
  });
});

describe('문서 id', () => {
  it('경로에 쓸 수 있는 글자만 받는다', () => {
    expect(isDocId('user_1-A.b~c:d@e+f')).toBe(true);
    for (const v of ['', 'a/b', 'a b', '가', '..', null, 5, 'x'.repeat(129)]) expect(isDocId(v)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('믿을 수 없는 문서 읽기', () => {
  it('code, nickname, at 만 읽고 점수처럼 보이는 값은 버린다', () => {
    const doc = parseScoreDoc({
      v: 1, score: 9999, distanceM: 9999, best: 1e9,
      distance: { code: A, nickname: '해커', at: NOW, score: 9999, distanceM: 9999, airtimeS: 9999, verdict: 'glide', rank: 1 },
      airtime: { code: B, nickname: '해커', at: NOW, score: 777 },
    }, NOW);
    expect(doc).toEqual({ v: 1, distance: { code: A, nickname: '해커', at: NOW }, airtime: { code: B, nickname: '해커', at: NOW } });
    expect(JSON.stringify(doc)).not.toMatch(/9999|777|score|rank/);
  });
  it('모양이 틀린 문서와 기록은 버린다', () => {
    for (const bad of [null, 3, 'x', [], { v: 2, distance: { code: A, nickname: 'a', at: NOW } }, { distance: { code: A, nickname: 'a', at: NOW } }, { v: 1 }, { v: 1, distance: 'P1abc' }]) {
      expect(parseScoreDoc(bad, NOW)).toBeNull();
    }
    expect(parseEntry({ code: 12345, nickname: 'a', at: NOW }, NOW)).toBeNull();
    expect(parseEntry({ code: 'P1' + 'a'.repeat(500), nickname: 'a', at: NOW }, NOW)).toBeNull();
    expect(parseEntry({ code: 'P1 <script>', nickname: 'a', at: NOW }, NOW)).toBeNull();
    expect(parseEntry({ code: A, nickname: '\u0000', at: NOW }, NOW)).toBeNull();
    expect(parseEntry({ code: A, nickname: 'x'.repeat(40), at: NOW }, NOW)).toBeNull();
    expect(parseEntry([A, 'a', NOW], NOW)).toBeNull();
  });
  it('한쪽 종목만 틀리면 그쪽만 버린다', () => {
    expect(parseScoreDoc({ v: 1, distance: { code: A, nickname: '가', at: NOW }, airtime: { code: '', nickname: '가', at: NOW } }, NOW))
      .toEqual({ v: 1, distance: { code: A, nickname: '가', at: NOW } });
  });
  it('믿을 수 없는 시각(너무 이르거나, 앞날이거나, 숫자가 아님)은 동점 다툼에서 맨 뒤로 보낸다', () => {
    for (const at of [0, -5, NOW + 3 * 24 * 3600 * 1000, Number.NaN, Infinity, '1', undefined]) {
      expect(parseEntry({ code: A, nickname: 'a', at }, NOW)?.at).toBe(AT_LAST);
    }
    expect(parseEntry({ code: A, nickname: 'a', at: NOW - 1000.7 }, NOW)?.at).toBe(NOW - 1001);
  });
});

// ---------------------------------------------------------------------------
describe('코드 검사', () => {
  it('던지기 값이 든 바른 코드는 통과한다', () => {
    const ok = checkCode(A);
    expect(ok?.throwIn).toEqual(T(9, 12));
    expect(ok?.design.paperId).toBe(design(0).paperId);
  });
  it('던지기 값이 없는 코드는 받지 않는다', () => {
    const noThrow = encodeDesign(design(0));
    expect(decodeDesign(noThrow)).not.toBeNull();
    expect(checkCode(noThrow)).toBeNull();
  });
  it('범위를 벗어난 던지기 값은 받지 않는다', () => {
    for (const t of [T(LIMITS.throwSpeedMax + 30, 10), T(8, LIMITS.pitchMax + 25), T(8, 10, LIMITS.rollMax + 40), T(0.1, 10)]) {
      let code = '';
      try { code = encodeDesign(design(0), t); } catch { code = ''; }
      expect(checkCode(code)).toBeNull();
    }
  });
  it('쓰레기 값, 너무 긴 값, 글자가 아닌 값은 받지 않는다', () => {
    for (const v of ['', 'P1', 'hello', 'P1!!!!', 'P1' + 'z'.repeat(600), 'P2' + A.slice(2), null, undefined, 42, {}]) expect(checkCode(v)).toBeNull();
  });
  it('글자를 바꿔 고친 코드는 풀리지 않거나, 풀리더라도 그 코드 자체의 값으로만 계산된다', () => {
    let rejected = 0;
    let differentButHonest = 0;
    for (let i = 2; i < A.length; i++) {
      const ch = A[i] === 'a' ? 'b' : 'a';
      const tampered = A.slice(0, i) + ch + A.slice(i + 1);
      const res = checkCode(tampered);
      if (!res) { rejected++; continue; }
      // 풀렸다면 그것은 "다른 비행기"다. 다시 코드로 만들면 같은 글자열이 나와야 한다(코드 하나 = 설계 하나).
      expect(encodeDesign(res.design, res.throwIn)).toBe(tampered);
      differentButHonest++;
    }
    expect(rejected + differentButHonest).toBe(A.length - 2);
    expect(rejected).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe('순서와 동점', () => {
  const V = (d: number, t: number): Verified => ({ distanceM: d, airtimeS: t, verdict: 'glide', paperId: 'copy80' });
  const entry = (code: string, at: number, nickname = '선수') => ({ code, nickname, at });
  it('0.001 로 반올림한 값이 높은 순, 같으면 먼저 올린 순, 그래도 같으면 id 순', () => {
    const docs = new Map<string, ScoreDoc>([
      ['zed', { v: 1, distance: entry('c1', 500) }],
      ['amy', { v: 1, distance: entry('c2', 500) }],
      ['bob', { v: 1, distance: entry('c3', 100) }],
      ['cat', { v: 1, distance: entry('c4', 900) }],
      ['dan', { v: 1, distance: entry('c5', 50) }],
    ]);
    const table: Record<string, Verified> = {
      c1: V(10.0004, 1), // 10.000
      c2: V(9.9996, 1),  // 10.000 (기기마다 생길 수 있는 아주 작은 차이)
      c3: V(10.00049, 1), // 10.000, 가장 먼저 올림
      c4: V(10.0006, 1), // 10.001
      c5: V(3, 9),
    };
    const board = buildBoard('distance', docs, (c) => table[c], 'amy');
    expect(board.rows.map((r) => r.id)).toEqual(['cat', 'bob', 'amy', 'zed', 'dan']);
    expect(board.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(board.mine?.id).toBe('amy');
    expect(board.mine?.rank).toBe(3);
    expect(board.total).toBe(5);
  });
  it('종목마다 따로 센다', () => {
    const docs = new Map<string, ScoreDoc>([
      ['a', { v: 1, distance: entry('c1', 1), airtime: entry('c2', 1) }],
      ['b', { v: 1, airtime: entry('c1', 2) }],
    ]);
    const table: Record<string, Verified> = { c1: V(20, 2), c2: V(5, 6) };
    expect(buildBoard('distance', docs, (c) => table[c], null).rows.map((r) => [r.id, r.score])).toEqual([['a', 20]]);
    expect(buildBoard('airtime', docs, (c) => table[c], null).rows.map((r) => [r.id, r.score])).toEqual([['a', 6], ['b', 2]]);
  });
  it('계산 중인 것은 세어 두고, 못 쓰는 것은 조용히 뺀다. 위에서 50줄만 보여 주되 내 줄은 따로 준다', () => {
    const docs = new Map<string, ScoreDoc>();
    const table: Record<string, Verified | 'bad' | undefined> = {};
    for (let i = 0; i < 70; i++) {
      docs.set(`p${String(i).padStart(2, '0')}`, { v: 1, distance: entry(`c${i}`, i) });
      table[`c${i}`] = V(100 - i, 1);
    }
    table.c3 = 'bad';
    table.c5 = undefined;
    table.c6 = { distanceM: Number.NaN, airtimeS: 1, verdict: 'glide', paperId: 'x' };
    const board = buildBoard('distance', docs, (c) => table[c], 'p65');
    expect(board.rows).toHaveLength(50);
    expect(board.total).toBe(67);
    expect(board.pending).toBe(1);
    expect(board.rows.some((r) => ['p03', 'p05', 'p06'].includes(r.id))).toBe(false);
    expect(board.mine?.rank).toBe(63);
    expect(board.rows.some((r) => r.mine)).toBe(false);
  });
  it('compareRows 와 scoreKey, isBetter', () => {
    expect(scoreKey(12.3456)).toBe(12346);
    expect(compareRows({ score: 1, at: 1, id: 'a' }, { score: 2, at: 1, id: 'a' })).toBeGreaterThan(0);
    expect(isBetter(10.0004, 10.0001)).toBe(false);
    expect(isBetter(10.001, 10.0001)).toBe(true);
    expect(isBetter(9, 10)).toBe(false);
    expect(isBetter(1, null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('저장할 문서 만들기', () => {
  const e = (code: string, at = NOW) => ({ code, nickname: '가', at });
  it('다른 종목 기록을 지키고, 세 값만 남긴다', () => {
    const cur = { v: 1, airtime: { ...e(B), score: 5 } } as unknown as ScoreDoc;
    const next = docAfterSubmit(cur, 'distance', e(A));
    expect(next).toEqual({ v: 1, airtime: e(B), distance: e(A) });
    expect(Object.keys(next.airtime!).sort()).toEqual(['at', 'code', 'nickname']);
    expect(docAfterSubmit(null, 'airtime', e(A))).toEqual({ v: 1, airtime: e(A) });
  });
  it('지울 때 남는 기록이 없으면 문서를 없앤다', () => {
    expect(docAfterRemove({ v: 1, distance: e(A), airtime: e(B) }, 'distance')).toEqual({ v: 1, airtime: e(B) });
    expect(docAfterRemove({ v: 1, distance: e(A) }, 'distance')).toBeNull();
    expect(docAfterRemove(null, 'airtime')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('기억해 두기(LRU)', () => {
  const ok = (d: number): CacheVal => ({ k: 'ok', d, t: 1, v: 'glide', p: 'copy80' });
  it('가장 오래 안 쓴 것부터 버린다', () => {
    const c = new ResultCache(3);
    c.adopt('fp');
    c.set('a', ok(1)); c.set('b', ok(2)); c.set('c', ok(3));
    expect(c.get('a')).toEqual(ok(1)); // a 를 방금 썼다
    c.set('d', ok(4));
    expect(c.size).toBe(3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toEqual(ok(1));
    expect(c.get('c')).toEqual(ok(3));
    expect(c.get('d')).toEqual(ok(4));
  });
  it('300개를 넘지 않는다', () => {
    const c = new ResultCache();
    for (let i = 0; i < 1000; i++) c.set(`code${i}`, ok(i));
    expect(c.size).toBe(300);
    expect(c.get('code0')).toBeUndefined();
    expect(c.get('code999')).toEqual(ok(999));
  });
  it('저장소에 넣었다가 꺼낸다. 계산 지문이 다르면 버린다. 저장소에 점수 말고 코드는 넣지 않는다', () => {
    let saved: unknown = null;
    const storage = { load: () => saved, save: (v: unknown) => { saved = JSON.parse(JSON.stringify(v)); } };
    const c1 = new ResultCache(300, storage);
    c1.adopt('fp1');
    c1.set(A, ok(11)); c1.set(B, { k: 'bad' });
    c1.flush();
    expect(JSON.stringify(saved)).not.toContain(A);
    const c2 = new ResultCache(300, storage);
    expect(c2.get(A)).toBeUndefined(); // 지문을 확인하기 전에는 믿지 않는다
    expect(c2.adopt('fp1')).toBe(2);
    expect(c2.get(A)).toEqual(ok(11));
    expect(c2.get(B)).toEqual({ k: 'bad' });
    const c3 = new ResultCache(300, storage);
    expect(c3.adopt('fp2')).toBe(0);
    expect(c3.get(A)).toBeUndefined();
  });
  it('망가진 저장 값과 막힌 저장소를 견딘다', () => {
    for (const junk of [null, 5, 'x', { v: 1 }, { v: 1, fp: 'f', items: 'no' }, { v: 1, fp: 'f', items: [[1, 2], ['h', { k: 'ok', d: 'x' }], ['h2', { k: 'ok', d: -1, t: 1, v: 'glide', p: 'a' }], ['h3', { k: 'ok', d: 1, t: 1, v: 'fly', p: 'a' }]] }]) {
      const c = new ResultCache(300, { load: () => junk, save: () => undefined });
      expect(c.adopt('f')).toBe(0);
      expect(c.size).toBe(0);
    }
    const blocked = new ResultCache(300, { load: () => { throw new Error('막힘'); }, save: () => { throw new Error('막힘'); } });
    blocked.adopt('f');
    blocked.set('a', ok(1));
    expect(() => blocked.flush()).not.toThrow();
    expect(blocked.get('a')).toEqual(ok(1));
  });
  it('시간이 걸려 건너뛴 표시는 하루 뒤에 사라진다', () => {
    const c = new ResultCache(10);
    c.set('a', { k: 'slow', at: 1000 });
    expect(c.get('a', 2000)).toEqual({ k: 'slow', at: 1000 });
    expect(c.get('a', 1000 + SLOW_RETRY_MS + 1)).toBeUndefined();
  });
  it('지문은 코드마다 다르다', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(codeHash(`P1code${i}`));
    expect(seen.size).toBe(2000);
    expect(codeHash(A)).toBe(codeHash(A));
    expect(codeHash(A)).not.toBe(codeHash(B));
  });
});

// ---------------------------------------------------------------------------
describe('검증기: 줄 세우기와 제한 시간', () => {
  it('같은 코드는 한 번만 계산하고, 틀린 코드는 계산기에 맡기지도 않는다', async () => {
    let calls = 0;
    const ev: Evaluator = (d, t) => { calls++; return realEvaluator(d, t); };
    const v = new Verifier({ evaluator: ev, cache: new ResultCache() });
    const [r1, r2, r3] = await Promise.all([v.verify(A), v.verify(A), v.verify('P1garbage')]);
    expect(r1).toEqual(r2);
    expect(r1.k).toBe('ok');
    expect(r3).toEqual({ k: 'bad' });
    expect((await v.verify(A)).k).toBe('ok');
    expect(calls).toBe(1);
    expect(v.stats.invalid).toBe(1);
    const tr = truth(A);
    expect(toVerified(r1)).toMatchObject({ distanceM: tr.distanceM, airtimeS: tr.airtimeS, paperId: design(0).paperId });
  });
  it('한 번에 정해진 개수만 계산한다', async () => {
    let live = 0, peak = 0;
    const gates: (() => void)[] = [];
    const ev: Evaluator = () => {
      live++; peak = Math.max(peak, live);
      return { promise: new Promise((res) => { gates.push(() => { live--; res({ distanceM: 1, airtimeS: 1, verdict: 'glide' }); }); }), abort: () => undefined };
    };
    const v = new Verifier({ evaluator: ev, cache: new ResultCache(), concurrency: 2 });
    const all = [0, 1, 2, 3, 4].map((i) => v.verify(codeOf(i, T(6 + i, 10))));
    await Promise.resolve();
    expect(gates).toHaveLength(2);
    expect(v.pending).toBe(5);
    while (gates.length > 0) { gates.shift()!(); await new Promise((r) => setTimeout(r, 0)); }
    await Promise.all(all);
    expect(peak).toBe(2);
    expect(v.pending).toBe(0);
  });
  it('제한 시간을 넘긴 계산은 그만두게 하고, 건너뛴 것으로 기억하며, 줄은 계속 간다', async () => {
    vi.useFakeTimers();
    let aborted = 0, calls = 0;
    const ev: Evaluator = (d, t) => {
      calls++;
      if (encodeDesign(d, t) === A) return { promise: new Promise(() => undefined), abort: () => { aborted++; } };
      return { promise: Promise.resolve({ distanceM: 5, airtimeS: 2, verdict: 'glide' as const }), abort: () => undefined };
    };
    const settled: string[] = [];
    const cache = new ResultCache();
    const v = new Verifier({ evaluator: ev, cache, timeoutMs: 3000, concurrency: 1, onSettled: (c) => settled.push(c) });
    const slow = v.verify(A);
    const next = v.verify(B);
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect((await slow).k).toBe('slow');
    expect((await next).k).toBe('ok');
    expect(aborted).toBe(1);
    expect(v.stats.timeouts).toBe(1);
    expect(settled).toEqual([A, B]);
    // 다시 물어도 계산기를 부르지 않는다.
    expect((await v.verify(A)).k).toBe('slow');
    expect(calls).toBe(2);
    expect(buildBoard('distance', new Map([['x', { v: 1 as const, distance: { code: A, nickname: 'a', at: NOW } }]]), (c) => { const r = v.peek(c); return r ? toVerified(r) ?? 'bad' : undefined; }, null).total).toBe(0);
  });
  it('계산기가 오류를 내거나 이상한 숫자를 주면 건너뛴다', async () => {
    const boom: Evaluator = () => ({ promise: Promise.reject(new Error('boom')), abort: () => undefined });
    expect(await new Verifier({ evaluator: boom, cache: new ResultCache() }).verify(A)).toEqual({ k: 'bad' });
    const thrower: Evaluator = () => { throw new Error('boom'); };
    expect(await new Verifier({ evaluator: thrower, cache: new ResultCache() }).verify(A)).toEqual({ k: 'bad' });
    const nan: Evaluator = () => ({ promise: Promise.resolve({ distanceM: Number.NaN, airtimeS: 1, verdict: 'glide' as const }), abort: () => undefined });
    expect(await new Verifier({ evaluator: nan, cache: new ResultCache() }).verify(A)).toEqual({ k: 'bad' });
    const slowMain: Evaluator = () => ({ promise: Promise.reject(new Error('slow')), abort: () => undefined });
    expect((await new Verifier({ evaluator: slowMain, cache: new ResultCache() }).verify(A)).k).toBe('slow');
  });
  it('준비(시험 코드 계산)로 저장해 둔 값을 믿을지 정한다', async () => {
    let saved: unknown = null;
    const storage = { load: () => saved, save: (v: unknown) => { saved = JSON.parse(JSON.stringify(v)); } };
    let calls = 0;
    const ev: Evaluator = (d, t) => { calls++; return realEvaluator(d, t); };
    const c1 = new ResultCache(300, storage);
    const v1 = new Verifier({ evaluator: ev, cache: c1 });
    const warm = v1.warmUp(C);
    const early = v1.verify(A); // 준비가 끝나기 전에 온 부탁은 줄에서 기다린다
    await warm; await early;
    c1.flush();
    expect(calls).toBe(2);
    // 다음 방문: 시험 코드 한 번만 계산하고 A 는 다시 계산하지 않는다.
    const c2 = new ResultCache(300, storage);
    const v2 = new Verifier({ evaluator: ev, cache: c2 });
    await v2.warmUp(C);
    expect((await v2.verify(A)).k).toBe('ok');
    expect(calls).toBe(3);
    // 계산이 바뀐 새 판: 저장해 둔 값을 버리고 다시 계산한다.
    const changed: Evaluator = () => ({ promise: Promise.resolve({ distanceM: 1.5, airtimeS: 1, verdict: 'glide' as const }), abort: () => undefined });
    const c3 = new ResultCache(300, storage);
    const v3 = new Verifier({ evaluator: changed, cache: c3 });
    await v3.warmUp(C);
    expect(toVerified(await v3.verify(A))?.distanceM).toBe(1.5);
  });
});

// ---------------------------------------------------------------------------
// 흉내 저장소: 플랫폼 문서에 적힌 규칙대로 움직인다.
// ---------------------------------------------------------------------------
interface FakeOpts { uid: string | null; level: 'contributor' | 'viewer'; failSet?: string[]; failGet?: string[] }
function fakeDb(o: FakeOpts) {
  const store = new Map<string, unknown>();
  const subs = new Set<{ next: (s: DbQuerySnapshot) => void; limit: number }>();
  const calls = { get: 0, set: 0, delete: 0, subscribe: 0, unsubscribe: 0 };
  const writes: { id: string; value: unknown }[] = [];
  const failSet = [...(o.failSet ?? [])];
  const failGet = [...(o.failGet ?? [])];
  const snap = (limit: number): DbQuerySnapshot => ({
    docs: [...store.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, limit).map(([id, value]): DbDocSnapshot => ({ id, exists: true, data: () => JSON.parse(JSON.stringify(value)) as unknown })),
  });
  const notify = (): void => { for (const s of subs) s.next(snap(s.limit)); };
  const mayWrite = (id: string): boolean => o.level === 'contributor' && o.uid !== null && id === o.uid;
  const db: PageDb = {
    doc: (path) => {
      const id = path.split('/')[1]!;
      return {
        get: async () => {
          calls.get++;
          const f = failGet.shift();
          if (f) throw { code: f, message: f };
          return store.has(id) ? { id, exists: true, data: () => JSON.parse(JSON.stringify(store.get(id))) as unknown } : { id, exists: false, data: () => undefined };
        },
        set: async (value) => {
          calls.set++;
          const f = failSet.shift();
          if (f) throw { code: f, message: f };
          if (!mayWrite(id)) throw { code: 'invalid_argument', message: 'rejected' };
          store.set(id, JSON.parse(JSON.stringify(value)));
          writes.push({ id, value: JSON.parse(JSON.stringify(value)) });
          notify();
        },
        delete: async () => {
          calls.delete++;
          if (!mayWrite(id)) throw { code: 'invalid_argument', message: 'rejected' };
          store.delete(id);
          writes.push({ id, value: null });
          notify();
        },
      };
    },
    collection: () => {
      let limit = 1000;
      const q = {
        limit: (n: number) => { limit = n; return q; },
        onSnapshot: (next: (s: DbQuerySnapshot) => void) => {
          calls.subscribe++;
          const sub = { next, limit };
          subs.add(sub);
          queueMicrotask(() => { if (subs.has(sub)) next(snap(limit)); });
          return () => { calls.unsubscribe++; subs.delete(sub); };
        },
      };
      return q;
    },
  };
  return { db, store, calls, writes, remoteSet: (id: string, value: unknown) => { store.set(id, value); notify(); } };
}

function setup(o: FakeOpts & { canHint?: boolean | null; evaluator?: Evaluator; seed?: Record<string, unknown> }) {
  const f = fakeDb(o);
  for (const [id, v] of Object.entries(o.seed ?? {})) f.store.set(id, v);
  const cache = new ResultCache();
  cache.adopt('test');
  let evals = 0;
  const base = o.evaluator ?? realEvaluator;
  const verifier = new Verifier({ evaluator: (d, t) => { evals++; return base(d, t); }, cache });
  let clock = NOW;
  const sleeps: number[] = [];
  const backend = createPageDbBackend({
    db: f.db, uid: o.uid, canWriteHint: o.canHint ?? null, verifier, cache,
    now: () => clock++, random: () => 0.5, sleep: async (ms) => { sleeps.push(ms); },
    setTimer: (fn, ms) => setTimeout(fn, ms > 1000 ? ms : 0),
  });
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 0));
      if (verifier.pending === 0 && i > 3) break;
    }
  };
  return { ...f, backend, verifier, sleeps, settle, evals: () => evals };
}

describe('꾸민 문서는 가짜 점수를 올리지 못한다', () => {
  it('점수 칸을 넣어도, 코드를 고쳐도, 쓰레기를 넣어도 순위는 코드를 다시 계산한 값으로만 정해진다', async () => {
    const tampered = (() => {
      for (let i = A.length - 1; i > 2; i--) {
        const t = A.slice(0, i) + (A[i] === 'Z' ? 'Y' : 'Z') + A.slice(i + 1);
        if (!checkCode(t)) return t;
      }
      throw new Error('풀리지 않는 고친 코드를 만들지 못했어요');
    })();
    const s = setup({
      uid: 'me', level: 'contributor',
      seed: {
        honest1: { v: 1, distance: { code: A, nickname: '정직1', at: NOW - 5000 } },
        honest2: { v: 1, distance: { code: B, nickname: '정직2', at: NOW - 4000 }, airtime: { code: B, nickname: '정직2', at: NOW - 4000 } },
        // 진짜 코드에 가짜 점수 칸을 잔뜩 붙였다: 진짜 값으로만 오른다.
        liar: { v: 1, score: 99999, distanceM: 99999, distance: { code: C, nickname: '뻥쟁이', at: NOW - 3000, score: 99999, distanceM: 99999, airtimeS: 99999 } },
        // 아래는 모두 순위표에 나오면 안 된다.
        tamper: { v: 1, distance: { code: tampered, nickname: '고친코드', at: NOW, score: 5000 } },
        junk: { v: 1, distance: { code: 'P1zzzzzzzzzzzzzzzzzzzz', nickname: '쓰레기', at: NOW, distanceM: 4000 } },
        nothrow: { v: 1, distance: { code: encodeDesign(design(2)), nickname: '안던짐', at: NOW, distanceM: 3000 } },
        noscorecode: { v: 1, distance: { nickname: '코드없음', at: NOW, score: 2000 } },
        number: { v: 1, distance: 12345 },
        v2: { v: 2, distance: { code: A, nickname: '다른판', at: NOW } },
        noname: { v: 1, distance: { code: A, nickname: '\u0000\u0001', at: NOW } },
        'bad id!': { v: 1, distance: { code: A, nickname: '이상한id', at: NOW } },
      },
    });
    s.backend.start();
    await s.settle();
    const board = s.backend.getState().boards.distance;
    const want = [['honest1', A], ['honest2', B], ['liar', C]].map(([id, code]) => ({ id: id!, score: truth(code!).distanceM }))
      .sort((x, y) => scoreKey(y.score) - scoreKey(x.score));
    expect(board.rows.map((r) => r.id)).toEqual(want.map((w) => w.id));
    for (const r of board.rows) {
      expect(r.score).toBe(want.find((w) => w.id === r.id)!.score);
      expect(r.score).toBeLessThan(100);
    }
    expect(board.rows.map((r) => r.nickname)).not.toContain('고친코드');
    expect(board.total).toBe(3);
    expect(board.pending).toBe(0);
    expect(s.backend.getState().boards.airtime.rows.map((r) => [r.id, r.score])).toEqual([['honest2', truth(B).airtimeS]]);
    expect(s.verifier.stats.invalid).toBe(3); // 고친 코드, 쓰레기, 안 던진 코드 (나머지는 계산 전에 걸러진다)
    expect(s.calls.subscribe).toBe(1);
  });
});

describe('기록 올리기(흉내 저장소)', () => {
  it('내 문서 scores/<내 id> 에만, 코드와 별명과 시각만 쓴다', async () => {
    const s = setup({ uid: 'me', level: 'contributor' });
    s.backend.start();
    await s.settle();
    const r = await s.backend.submit('distance', A, '  종이왕\n');
    expect(r).toMatchObject({ ok: true, rank: 1, total: 1, score: truth(A).distanceM });
    expect(s.writes).toHaveLength(1);
    expect(s.writes[0]!.id).toBe('me');
    expect(s.writes[0]!.value).toEqual({ v: 1, distance: { code: A, nickname: '종이왕', at: expect.any(Number) } });
    expect(JSON.stringify(s.writes[0]!.value)).not.toMatch(/score|distanceM|airtimeS|verdict/);
    await s.settle();
    const row = s.backend.getState().boards.distance.rows[0]!;
    expect(row).toMatchObject({ id: 'me', mine: true, nickname: '종이왕', rank: 1 });
  });
  it('더 좋을 때만 쓴다. 나쁘거나 같으면 그대로 두고 이미 올린 기록을 알려 준다', async () => {
    const [lo, hi] = [A, B, C].map((c) => ({ c, d: truth(c).distanceM })).sort((x, y) => x.d - y.d).filter((_, i) => i !== 1);
    const s = setup({ uid: 'me', level: 'contributor' });
    s.backend.start();
    expect((await s.backend.submit('distance', lo!.c, '가')).ok).toBe(true);
    expect(await s.backend.submit('distance', hi!.c, '나')).toMatchObject({ ok: true, score: hi!.d });
    expect(s.writes).toHaveLength(2);
    const worse = await s.backend.submit('distance', lo!.c, '다');
    expect(worse).toEqual({ ok: false, reason: 'not-better', existingScore: hi!.d, existingNickname: '나' });
    const same = await s.backend.submit('distance', hi!.c, '라');
    expect(same).toMatchObject({ ok: false, reason: 'not-better' });
    expect(s.writes).toHaveLength(2);
    expect((s.store.get('me') as ScoreDoc).distance).toMatchObject({ code: hi!.c, nickname: '나' });
  });
  it('다른 종목 기록을 지키며 쓴다(읽고 -> 합쳐서 -> 전체를 다시 쓴다)', async () => {
    const s = setup({ uid: 'me', level: 'contributor' });
    s.backend.start();
    await s.backend.submit('distance', A, '가');
    await s.backend.submit('airtime', B, '나');
    expect(s.store.get('me')).toEqual({ v: 1, distance: { code: A, nickname: '가', at: expect.any(Number) }, airtime: { code: B, nickname: '나', at: expect.any(Number) } });
    expect(s.calls.get).toBeGreaterThanOrEqual(2);
  });
  it('이미 올려 둔 기록이 못 쓰는 것이면 새 기록으로 바꾼다', async () => {
    const s = setup({ uid: 'me', level: 'contributor', seed: { me: { v: 1, distance: { code: 'P1zzzzzzzz', nickname: '옛', at: NOW } } } });
    s.backend.start();
    expect((await s.backend.submit('distance', A, '새')).ok).toBe(true);
    expect((s.store.get('me') as ScoreDoc).distance?.code).toBe(A);
  });
  it('규칙에 안 맞는 코드와 별명은 저장소에 가지도 않는다', async () => {
    const s = setup({ uid: 'me', level: 'contributor' });
    s.backend.start();
    expect(await s.backend.submit('distance', encodeDesign(design(0)), '가')).toEqual({ ok: false, reason: 'invalid' });
    expect(await s.backend.submit('distance', 'P1garbage', '가')).toEqual({ ok: false, reason: 'invalid' });
    expect(await s.backend.submit('distance', A, '   ')).toEqual({ ok: false, reason: 'nickname' });
    expect(s.calls.set).toBe(0);
  });
  it("'unavailable' 은 잠깐 쉬었다가 한 번만 다시 한다", async () => {
    const once = setup({ uid: 'me', level: 'contributor', failSet: ['unavailable'] });
    once.backend.start();
    expect((await once.backend.submit('distance', A, '가')).ok).toBe(true);
    expect(once.calls.set).toBe(2);
    expect(once.sleeps).toHaveLength(1);
    expect(once.sleeps[0]).toBeGreaterThanOrEqual(300);
    expect(once.sleeps[0]).toBeLessThanOrEqual(1200);
    const twice = setup({ uid: 'me', level: 'contributor', failSet: ['unavailable', 'unavailable'] });
    twice.backend.start();
    expect(await twice.backend.submit('distance', A, '가')).toEqual({ ok: false, reason: 'offline' });
    expect(twice.calls.set).toBe(2);
    expect(twice.backend.getState().write).toBe('yes');
    // 모르는 오류 code 도 unavailable 처럼 다룬다.
    expect(errorCode({ code: 'weird' })).toBe('unavailable');
    expect(errorCode(null)).toBe('unavailable');
    expect(errorCode({ code: 'revoked' })).toBe('revoked');
  });
  it('구경만 하는 사람: 쓰기가 거절되면 이번 방문 동안 구경만 하게 바뀌고 다시 쓰려 하지 않는다', async () => {
    const s = setup({ uid: 'viewer1', level: 'viewer', canHint: null });
    s.backend.start();
    expect(s.backend.getState().write).toBe('yes'); // 귀띔이 없으면 한 번은 해 보게 둔다
    expect(await s.backend.submit('distance', A, '가')).toEqual({ ok: false, reason: 'readonly' });
    expect(s.backend.getState().write).toBe('readonly');
    expect(await s.backend.submit('distance', A, '가')).toEqual({ ok: false, reason: 'readonly' });
    expect(await s.backend.remove('distance')).toEqual({ ok: false, reason: 'readonly' });
    expect(s.calls.set).toBe(1);
    expect(s.store.size).toBe(0);
  });
  it('쓸 수 없다고 미리 들었으면(can = false) 처음부터 구경만, id 가 없으면 올릴 수 없다', async () => {
    const no = setup({ uid: 'v', level: 'viewer', canHint: false });
    expect(no.backend.getState().write).toBe('readonly');
    expect(await no.backend.submit('distance', A, '가')).toEqual({ ok: false, reason: 'readonly' });
    expect(no.calls.set).toBe(0);
    const anon = setup({ uid: null, level: 'viewer' });
    expect(anon.backend.getState().write).toBe('no-id');
    expect(await anon.backend.submit('distance', A, '가')).toEqual({ ok: false, reason: 'no-id' });
    const odd = setup({ uid: 'a/b', level: 'contributor' });
    expect(odd.backend.getState().write).toBe('no-id');
  });
  it('자리가 없거나(quota) 저장소가 닫히면(revoked) 알맞게 알려 준다', async () => {
    const full = setup({ uid: 'me', level: 'contributor', failSet: ['quota_exceeded'] });
    full.backend.start();
    expect(await full.backend.submit('distance', A, '가')).toEqual({ ok: false, reason: 'full' });
    expect(full.calls.set).toBe(1);
    const gone = setup({ uid: 'me', level: 'contributor', failSet: ['revoked'] });
    gone.backend.start();
    expect(await gone.backend.submit('distance', A, '가')).toEqual({ ok: false, reason: 'closed' });
    expect(gone.backend.getState().status).toBe('closed');
    expect(gone.calls.unsubscribe).toBe(1);
  });
  it('내 기록 지우기: 한 종목만 빼고, 남는 것이 없으면 문서를 지운다', async () => {
    const s = setup({ uid: 'me', level: 'contributor' });
    s.backend.start();
    await s.backend.submit('distance', A, '가');
    await s.backend.submit('airtime', B, '가');
    expect(await s.backend.remove('distance')).toEqual({ ok: true });
    expect(s.store.get('me')).toEqual({ v: 1, airtime: { code: B, nickname: '가', at: expect.any(Number) } });
    await s.settle();
    expect(s.backend.getState().boards.distance.mine).toBeNull();
    expect(s.backend.getState().boards.airtime.mine?.id).toBe('me');
    expect(await s.backend.remove('airtime')).toEqual({ ok: true });
    expect(s.store.has('me')).toBe(false);
    expect(s.calls.delete).toBe(1);
    expect(await s.backend.remove('airtime')).toEqual({ ok: false, reason: 'nothing' });
  });
  it('다른 사람이 올리면 순위표가 저절로 바뀌고, 지켜보기는 한 번만 한다', async () => {
    const s = setup({ uid: 'me', level: 'contributor' });
    let ticks = 0;
    s.backend.subscribe(() => { ticks++; });
    s.backend.start();
    s.backend.start();
    await s.settle();
    expect(s.backend.getState().status).toBe('ready');
    expect(s.backend.getState().boards.distance.total).toBe(0);
    const before = ticks;
    s.remoteSet('friend', { v: 1, distance: { code: B, nickname: '친구', at: NOW } });
    await s.settle();
    expect(ticks).toBeGreaterThan(before);
    expect(s.backend.getState().boards.distance.rows.map((r) => r.nickname)).toEqual(['친구']);
    expect(s.calls.subscribe).toBe(1);
  });
  it('10초 동안 소식이 없으면 멈춤으로 바꾸고, 다시 해 보기는 지켜보기를 새로 건다', async () => {
    vi.useFakeTimers();
    const cache = new ResultCache();
    const verifier = new Verifier({ evaluator: realEvaluator, cache });
    let subs = 0, unsubs = 0;
    const silent: PageDb = {
      doc: () => ({ get: () => new Promise(() => undefined), set: async () => undefined, delete: async () => undefined }),
      collection: () => { const q: ReturnType<PageDb['collection']> = { limit: () => q, onSnapshot: () => { subs++; return () => { unsubs++; }; } }; return q; },
    };
    const backend = createPageDbBackend({ db: silent, uid: 'me', canWriteHint: null, verifier, cache });
    backend.start();
    expect(backend.getState().status).toBe('loading');
    await vi.advanceTimersByTimeAsync(9999);
    expect(backend.getState().status).toBe('loading');
    await vi.advanceTimersByTimeAsync(2);
    expect(backend.getState().status).toBe('stalled');
    backend.retry('distance');
    expect(backend.getState().status).toBe('loading');
    expect([subs, unsubs]).toEqual([2, 1]);
  });
  it('200개까지만 읽는다', async () => {
    const seed: Record<string, unknown> = {};
    for (let i = 0; i < 260; i++) seed[`p${String(i).padStart(3, '0')}`] = { v: 1, distance: { code: A, nickname: `선수${i}`, at: NOW + i } };
    let asked = 0;
    const s = setup({ uid: null, level: 'viewer', seed });
    const col = s.db.collection.bind(s.db);
    s.db.collection = (p) => { const q = col(p); const lim = q.limit.bind(q); q.limit = (n) => { asked = n; return lim(n); }; return q; };
    s.backend.start();
    await s.settle();
    expect(asked).toBe(200);
    expect(s.backend.getState().boards.distance.total).toBe(200);
    expect(s.backend.getState().boards.distance.rows).toHaveLength(50);
    expect(s.evals()).toBe(1); // 같은 코드는 한 번만 계산한다
  });
});
