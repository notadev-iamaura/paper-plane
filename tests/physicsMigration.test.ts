import { describe, expect, it } from 'vitest';
import { encodeDesign } from '../src/core/codec';
import { buildPresetDesign } from '../src/core/presets';
import { addPlane, emptyHangar, HANGAR_KEY, recordFlight, reviveHangar, serializeHangar, setLabNote } from '../src/app/lib/hangar';
import type { HangarData, StorageLike } from '../src/app/lib/hangar';
import { evaluateThrowCode, migratePhysics, MIGRATION_NOTICE, PHYSICS_KEY, RECORDS_KEY, remeasurePlane, remeasureRecords } from '../src/app/lib/physicsMigration';
import { LIMITS, PHYSICS_VERSION, evaluate } from '../src/core/index';
import type { FlightEval } from '../src/app/lib/physicsMigration';
import type { FlightRecord, Records } from '../src/app/lib/records';

const T1 = { speedMps: 7, pitchDeg: 5, rollDeg: 0 };
const T2 = { speedMps: 9, pitchDeg: 12, rollDeg: 0 };
const dartDesign = buildPresetDesign('dart', undefined, 'copy80');
const gliderDesign = buildPresetDesign('glider', undefined, 'copy80');
const DART = encodeDesign(dartDesign), GLIDER = encodeDesign(gliderDesign);
const DART_T1 = encodeDesign(dartDesign, T1), DART_T2 = encodeDesign(dartDesign, T2), GLIDER_T1 = encodeDesign(gliderDesign, T1);

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { map: Map<string, string>; writes: string[] } {
  const map = new Map(Object.entries(initial));
  const writes: string[] = [];
  return { map, writes, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { writes.push(k); map.set(k, v); } };
}
const rec = (code: string, distanceM: number, airtimeS: number, at = 1): FlightRecord => ({ code, mode: 'distance', distanceM, airtimeS, verdict: 'glide', at });

/** 새 규칙의 계산값(가짜): 코드마다 정해 둔 값. 없는 코드는 계산할 수 없는 것으로 본다. */
const NEW: Record<string, FlightEval> = {
  [DART_T1]: { distanceM: 6.5, airtimeS: 1.4, verdict: 'glide' },
  [DART_T2]: { distanceM: 5.1, airtimeS: 2.2, verdict: 'stall' },
  [GLIDER_T1]: { distanceM: 4.0, airtimeS: 1.9, verdict: 'glide' },
};
const evaluator = (calls?: string[]) => (code: string): FlightEval | null => { calls?.push(code); return NEW[code] ?? null; };

function hangarWith(): HangarData {
  let h = emptyHangar();
  const a = addPlane(h, { name: '화살', code: DART, origin: 'preset:dart' }, 10);
  if (!a.ok) throw new Error('넣기 실패');
  h = a.data;
  const b = addPlane(h, { name: '글라이더', code: GLIDER, origin: 'preset:glider' }, 11);
  if (!b.ok) throw new Error('넣기 실패');
  h = b.data;
  // 옛 규칙의 값: 화살은 T1 로 멀리(12 m), T2 로 오래(3 초). 글라이더는 T1 하나.
  h = recordFlight(h, { designCode: DART, distanceM: 12, airtimeS: 1.0, throwCode: DART_T1, at: 100 }).data;
  h = recordFlight(h, { designCode: DART, distanceM: 8, airtimeS: 3.0, throwCode: DART_T2, at: 200 }).data;
  h = recordFlight(h, { designCode: GLIDER, distanceM: 9, airtimeS: 2.5, throwCode: GLIDER_T1, at: 300 }).data;
  return h;
}

describe('기록 다시 재기(순수 함수)', () => {
  it('내 기록: 값을 새로 재고, 새 값으로 1등을 다시 고른다', () => {
    const prev: Records = { bestDistance: rec(DART_T2, 20, 1), bestAirtime: rec(GLIDER_T1, 3, 9), recent: [rec(DART_T1, 10, 1, 5), rec(DART_T2, 20, 1, 4), rec('junk', 1, 1, 3)] };
    const evals = new Map<string, FlightEval | null>(Object.entries(NEW));
    const { next, changed, dropped } = remeasureRecords(prev, evals);
    expect(next.recent.map((r) => r.code)).toEqual([DART_T1, DART_T2]);
    expect(next.recent[0]).toMatchObject({ distanceM: 6.5, airtimeS: 1.4, at: 5 });
    expect(next.recent[1]).toMatchObject({ distanceM: 5.1, airtimeS: 2.2, verdict: 'stall' });
    // 예전에는 T2 가 가장 멀리였지만 새 규칙에서는 T1 이 더 멀다
    expect(next.bestDistance?.code).toBe(DART_T1);
    expect(next.bestAirtime?.code).toBe(DART_T2);
    expect(dropped).toBe(1);
    expect(changed).toBe(4);
  });
  it('내 기록: 값이 그대로면 바뀐 것이 없다', () => {
    const prev: Records = { bestDistance: rec(DART_T1, 6.5, 1.4), bestAirtime: rec(DART_T2, 5.1, 2.2), recent: [rec(DART_T1, 6.5, 1.4)] };
    prev.bestAirtime!.verdict = 'stall';
    const r = remeasureRecords(prev, new Map(Object.entries(NEW)));
    expect(r.changed).toBe(0);
    expect(r.dropped).toBe(0);
    expect(r.next).toEqual(prev);
  });
  it('격납고 비행기: 두 최고 기록의 코드를 모두 재서 종목마다 더 좋은 것을 고른다', () => {
    const h = hangarWith();
    const p = h.planes[0]!;
    const r = remeasurePlane(p, new Map(Object.entries(NEW)));
    expect(r.plane.best.distance).toEqual({ value: 6.5, at: 100, throwCode: DART_T1 });
    expect(r.plane.best.airtime).toEqual({ value: 2.2, at: 200, throwCode: DART_T2 });
    expect(r.changed).toBe(2);
    expect(r.plane.name).toBe('화살');
    expect(r.plane.flights).toBe(2);
  });
  it('격납고 비행기: 코드가 없거나 더는 던질 수 없으면 그 기록만 지우고 비행기는 남긴다', () => {
    const h = hangarWith();
    const p = { ...h.planes[1]!, best: { distance: { value: 9, at: 1 }, airtime: { value: 2.5, at: 1, throwCode: 'zzz' } } };
    const r = remeasurePlane(p, new Map());
    expect(r.plane.best).toEqual({});
    expect(r.dropped).toBe(2);
    expect(r.plane.id).toBe(p.id);
    expect(r.plane.code).toBe(GLIDER);
    // 기록이 없는 비행기는 그대로
    const bare = { ...p, best: {} };
    expect(remeasurePlane(bare, new Map()).plane).toBe(bare);
  });
});

describe('migratePhysics', () => {
  const setup = (physics: string | null = '1') => {
    const records: Records = { bestDistance: rec(DART_T2, 20, 1), bestAirtime: rec(GLIDER_T1, 3, 9), recent: [rec(DART_T1, 10, 1, 5), rec('junk', 1, 1, 3)] };
    const init: Record<string, string> = { [RECORDS_KEY]: JSON.stringify(records), [HANGAR_KEY]: serializeHangar(hangarWith()) };
    if (physics !== null) init[PHYSICS_KEY] = physics;
    return memoryStorage(init);
  };

  it('판이 다르면 내 기록과 격납고 기록을 다시 재고, 새 판 번호를 적고, 알릴 일이 있다고 한다', async () => {
    const st = setup();
    const calls: string[] = [];
    let cleared = 0, pauses = 0;
    const rep = await migratePhysics({ getStorage: () => st, version: 2, evaluate: evaluator(calls), pause: async () => { pauses++; }, clearCaches: () => { cleared++; } });
    expect(rep).toMatchObject({ ran: true, from: 1, to: 2, notify: true, recordsDropped: 1 });
    expect(rep.recordsChanged).toBeGreaterThan(0);
    expect(rep.bestsChanged).toBe(4);
    expect(st.map.get(PHYSICS_KEY)).toBe('2');
    const records = JSON.parse(st.map.get(RECORDS_KEY)!) as Records;
    expect(records.bestDistance).toMatchObject({ code: DART_T1, distanceM: 6.5 });
    expect(records.bestAirtime).toMatchObject({ code: DART_T2, airtimeS: 2.2 });
    expect(records.recent.map((r) => r.code)).toEqual([DART_T1]);
    const hangar = reviveHangar(JSON.parse(st.map.get(HANGAR_KEY)!)).data;
    expect(hangar.planes.map((p) => p.name)).toEqual(['화살', '글라이더']);
    expect(hangar.planes[0]!.best.distance).toMatchObject({ value: 6.5, throwCode: DART_T1 });
    expect(hangar.planes[0]!.best.airtime).toMatchObject({ value: 2.2, throwCode: DART_T2 });
    expect(hangar.planes[1]!.best.distance).toMatchObject({ value: 4.0 });
    // 같은 코드는 한 번만 계산한다
    expect(new Set(calls).size).toBe(calls.length);
    expect(calls.sort()).toEqual([DART_T1, DART_T2, GLIDER_T1, 'junk'].sort());
    expect(cleared).toBe(1);
    expect(pauses).toBe(calls.length);
    expect(MIGRATION_NOTICE).toBe('대회 규칙이 더 진짜처럼 바뀌어서 기록을 다시 쟀어요.');
  });

  it('한 번만 한다: 다시 부르면 아무것도 계산하지 않고 아무것도 쓰지 않는다', async () => {
    const st = setup();
    await migratePhysics({ getStorage: () => st, version: 2, evaluate: evaluator() });
    const snapshot = new Map(st.map);
    const writes = st.writes.length;
    const calls: string[] = [];
    const rep = await migratePhysics({ getStorage: () => st, version: 2, evaluate: evaluator(calls) });
    expect(rep).toMatchObject({ ran: false, from: 2, notify: false });
    expect(calls).toEqual([]);
    expect(st.writes.length).toBe(writes);
    expect(st.map).toEqual(snapshot);
  });

  it('도중에 끊겨서 판 번호를 못 적었어도, 다시 하면 같은 결과가 된다(여러 번 해도 같다)', async () => {
    const a = setup();
    await migratePhysics({ getStorage: () => a, version: 2, evaluate: evaluator() });
    const b = setup();
    await migratePhysics({ getStorage: () => b, version: 2, evaluate: evaluator() });
    b.map.set(PHYSICS_KEY, '1'); // 판 번호만 못 적은 것처럼
    const rep = await migratePhysics({ getStorage: () => b, version: 2, evaluate: evaluator() });
    expect(rep.ran).toBe(true);
    expect(rep.notify).toBe(false); // 값은 이미 새 값이라 바뀐 것이 없다
    expect(b.map).toEqual(a.map);
  });

  it('판 번호가 아예 없던 저장소(옛 앱): 기록이 있으면 다시 잰다. 아무것도 없으면 번호만 적고 조용히 넘어간다', async () => {
    const old = setup(null);
    const rep = await migratePhysics({ getStorage: () => old, version: 2, evaluate: evaluator() });
    expect(rep).toMatchObject({ ran: true, from: null, notify: true });
    const empty = memoryStorage();
    const calls: string[] = [];
    const rep2 = await migratePhysics({ getStorage: () => empty, version: 2, evaluate: evaluator(calls) });
    expect(rep2.notify).toBe(false);
    expect(calls).toEqual([]);
    expect(empty.map.get(PHYSICS_KEY)).toBe('2');
    expect(empty.map.has(RECORDS_KEY)).toBe(false);
    expect(empty.map.has(HANGAR_KEY)).toBe(false);
  });

  it('저장소가 없거나 막혀 있으면 아무 일도 하지 않는다(예외도 없다)', async () => {
    const calls: string[] = [];
    expect((await migratePhysics({ getStorage: () => null, version: 2, evaluate: evaluator(calls) })).ran).toBe(false);
    expect((await migratePhysics({ getStorage: () => { throw new Error('막힘'); }, version: 2, evaluate: evaluator(calls) })).ran).toBe(false);
    expect(calls).toEqual([]);
    // 읽기는 되는데 쓰기가 막힌 저장소: 번호를 못 적으니 다음에 다시 해 본다
    const st = setup();
    const readOnly: StorageLike = { getItem: (k) => st.getItem(k), setItem: () => { throw new Error('quota'); } };
    const rep = await migratePhysics({ getStorage: () => readOnly, version: 2, evaluate: evaluator() });
    expect(rep.notify).toBe(false);
    expect(st.map.get(PHYSICS_KEY)).toBe('1');
  });

  it('계산이 예외를 던지거나 이상한 값을 주면 그 기록만 지운다', async () => {
    const st = setup();
    const rep = await migratePhysics({
      getStorage: () => st, version: 2,
      evaluate: (code) => {
        if (code === DART_T1) throw new Error('터짐');
        if (code === DART_T2) return { distanceM: Number.NaN, airtimeS: 1, verdict: 'glide' };
        return NEW[code] ?? null;
      },
    });
    expect(rep.ran).toBe(true);
    const hangar = reviveHangar(JSON.parse(st.map.get(HANGAR_KEY)!)).data;
    expect(hangar.planes.length).toBe(2);
    expect(hangar.planes[0]!.best).toEqual({});
    expect(hangar.planes[1]!.best.distance?.value).toBe(4.0);
    const records = JSON.parse(st.map.get(RECORDS_KEY)!) as Records;
    expect(records.bestDistance?.code).toBe(GLIDER_T1);
    expect(records.recent).toEqual([]);
  });

  it('쉬는 사이에 새 비행이 끼어들어도 잃지 않는다(그 코드까지 재서 쓴다)', async () => {
    const st = setup();
    const extra = encodeDesign(gliderDesign, T2);
    let injected = false;
    const rep = await migratePhysics({
      getStorage: () => st, version: 2,
      evaluate: (code) => (code === extra ? { distanceM: 7.7, airtimeS: 0.5, verdict: 'glide' } : (NEW[code] ?? null)),
      pause: async () => {
        if (injected) return;
        injected = true;
        // 계산하는 사이에 아이가 한 번 던졌다(새 규칙의 값으로 저장됨)
        const cur = JSON.parse(st.map.get(RECORDS_KEY)!) as Records;
        cur.recent.unshift(rec(extra, 7.7, 0.5, 999));
        st.map.set(RECORDS_KEY, JSON.stringify(cur));
      },
    });
    expect(rep.ran).toBe(true);
    const records = JSON.parse(st.map.get(RECORDS_KEY)!) as Records;
    expect(records.recent[0]).toMatchObject({ code: extra, distanceM: 7.7, at: 999 });
    expect(records.bestDistance?.code).toBe(extra);
  });

  it('더 새로운 앱이 적어 둔 격납고와 실험 쪽지는 건드리지 않는다', async () => {
    const newer = JSON.stringify({ v: 99, planes: [{ anything: true }] });
    const st = memoryStorage({ [HANGAR_KEY]: newer, [PHYSICS_KEY]: '1' });
    await migratePhysics({ getStorage: () => st, version: 2, evaluate: evaluator() });
    expect(st.map.get(HANGAR_KEY)).toBe(newer);
    // 쪽지는 비행기에 남는다(화면이 "규칙이 바뀌기 전에 쟀어요"라고 알려 준다)
    const withNote = setLabNote(hangarWith(), hangarWith().planes[0]!.id, { v: 1, physics: 1, at: 5, favSpeedMps: 6, trimAlphaDeg: 4, bestAlphaDeg: 8, bestLiftToDrag: 4, stallAlphaDeg: 30, buckleSpeedMps: null });
    const st2 = memoryStorage({ [HANGAR_KEY]: serializeHangar(withNote), [PHYSICS_KEY]: '1' });
    await migratePhysics({ getStorage: () => st2, version: 2, evaluate: evaluator() });
    const h = reviveHangar(JSON.parse(st2.map.get(HANGAR_KEY)!)).data;
    expect(h.planes[0]!.lab).toMatchObject({ physics: 1, favSpeedMps: 6 });
  });
});

describe('지금 규칙보다 센 던지기(예전 한도의 코드)', () => {
  // 던지기 한도가 16 m/s 이던 물리 1판에서 14 m/s 로 던진 기록. 지금은 코드를 풀어도 던지기 값(throwIn)이 나오지 않는다.
  const OLD = { speedMps: 14, pitchDeg: 10, rollDeg: 0 };
  const DART_OLD = encodeDesign(dartDesign, OLD), GLIDER_OLD = encodeDesign(gliderDesign, OLD);

  it('앱이 쓰는 계산 함수: 한도 안의 코드는 core 값 그대로, 한도 밖 / 던지기 없는 / 틀린 코드는 null', () => {
    expect(LIMITS.throwSpeedMax).toBeLessThan(OLD.speedMps);
    const now = evaluate(dartDesign, T1).result;
    expect(evaluateThrowCode(DART_T1)).toEqual({ distanceM: now.distanceM, airtimeS: now.airtimeS, verdict: now.verdict });
    expect(evaluateThrowCode(DART_OLD)).toBeNull();
    expect(evaluateThrowCode(DART)).toBeNull();
    expect(evaluateThrowCode('junk')).toBeNull();
    expect(evaluateThrowCode('')).toBeNull();
  });

  it('내 기록에서는 지우고, 격납고에서는 그 최고 기록만 지운다(비행기와 한도 안의 기록은 남는다)', async () => {
    let h = hangarWith();
    // 화살: 멀리 기록은 옛 센 던지기, 오래 기록은 지금도 되는 던지기. 글라이더: 둘 다 옛 센 던지기.
    h = recordFlight(h, { designCode: DART, distanceM: 30, airtimeS: 1.2, throwCode: DART_OLD, at: 400 }).data;
    h = recordFlight(h, { designCode: GLIDER, distanceM: 25, airtimeS: 6, throwCode: GLIDER_OLD, at: 500 }).data;
    const records: Records = { bestDistance: rec(DART_OLD, 30, 1.2, 9), bestAirtime: rec(GLIDER_OLD, 25, 6, 8), recent: [rec(DART_OLD, 30, 1.2, 9), rec(GLIDER_OLD, 25, 6, 8), rec(DART_T1, 10, 1, 5)] };
    const st = memoryStorage({ [RECORDS_KEY]: JSON.stringify(records), [HANGAR_KEY]: serializeHangar(h), [PHYSICS_KEY]: '1' });
    const calls: string[] = [];
    const rep = await migratePhysics({ getStorage: () => st, version: PHYSICS_VERSION, evaluate: (code) => { calls.push(code); return evaluateThrowCode(code); } });
    expect(rep).toMatchObject({ ran: true, from: 1, to: PHYSICS_VERSION, notify: true });
    // 내 기록: 옛 센 던지기 넉 줄(최근 2 + 최고 2)은 사라지고, 남은 한 줄이 두 종목의 최고가 된다.
    expect(rep.recordsDropped).toBe(4);
    const after = JSON.parse(st.map.get(RECORDS_KEY)!) as Records;
    const dartNow = evaluate(dartDesign, T1).result;
    expect(after.recent.map((r) => r.code)).toEqual([DART_T1]);
    expect(after.recent[0]).toMatchObject({ distanceM: dartNow.distanceM, airtimeS: dartNow.airtimeS });
    expect(after.bestDistance?.code).toBe(DART_T1);
    expect(after.bestAirtime?.code).toBe(DART_T1);
    // 격납고: 두 대 모두 남는다. 화살은 한도 안의 던지기(T2)로 다시 잰 기록이 두 종목에 남고, 글라이더는 기록이 비어 있다.
    const hangar = reviveHangar(JSON.parse(st.map.get(HANGAR_KEY)!)).data;
    expect(hangar.planes.map((p) => [p.name, p.code])).toEqual([['화살', DART], ['글라이더', GLIDER]]);
    const t2 = evaluate(dartDesign, T2).result;
    expect(hangar.planes[0]!.best).toEqual({ distance: { value: t2.distanceM, at: 200, throwCode: DART_T2 }, airtime: { value: t2.airtimeS, at: 200, throwCode: DART_T2 } });
    expect(hangar.planes[1]!.best).toEqual({});
    expect(rep.bestsDropped).toBe(3);
    // 저장소에 적힌 글자에도 옛 코드가 남아 있지 않다.
    expect(st.map.get(HANGAR_KEY)!.includes(DART_OLD)).toBe(false);
    expect(st.map.get(RECORDS_KEY)!.includes(GLIDER_OLD)).toBe(false);
    expect(st.map.get(PHYSICS_KEY)).toBe(String(PHYSICS_VERSION));
    // 다시 켜면 아무 일도 없다.
    const writes = st.writes.length;
    const again = await migratePhysics({ getStorage: () => st, version: PHYSICS_VERSION, evaluate: evaluateThrowCode });
    expect(again.ran).toBe(false);
    expect(st.writes.length).toBe(writes);
  });

  it('판 번호가 이미 지금 것이어도, 읽어 들일 때 센 던지기 기록은 걸러진다', () => {
    let h = hangarWith();
    h = recordFlight(h, { designCode: GLIDER, distanceM: 25, airtimeS: 6, throwCode: GLIDER_OLD, at: 500 }).data;
    const back = reviveHangar(JSON.parse(serializeHangar(h))).data;
    expect(back.planes.map((p) => p.name)).toEqual(['화살', '글라이더']);
    expect(back.planes[1]!.best).toEqual({});
    expect(back.planes[0]!.best.distance?.throwCode).toBe(DART_T1);
  });
});
