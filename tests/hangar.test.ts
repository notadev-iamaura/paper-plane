import { describe, expect, it } from 'vitest';
import { decodeDesign, encodeDesign } from '../src/core/codec';
import { LIMITS } from '../src/core/types';
import { PRESETS, buildPresetDesign } from '../src/core/presets';
import { PAPERS } from '../src/core/papers';
import {
  addPlane, byteSize, championOf, cleanName, deletePlane, designOfCode, dropThumbs, emptyHangar, findByCode, fitBudget,
  HANGAR_KEY, HANGAR_MAX, HANGAR_VERSION, HangarStore, paperKinds, planeBytes, recordFlight, renamePlane, replaceDesign,
  restorePlane, reviveHangar, saveStatusOf, serializeHangar, setFavourite, sortPlanes, suggestName, untouchedPresetOf,
} from '../src/app/lib/hangar';
import type { HangarData, SavedPlane, StorageLike } from '../src/app/lib/hangar';

const THROW = { speedMps: 7, pitchDeg: 5, rollDeg: 0 };
const codeOf = (presetId: string, paperId = 'copy80', elevator?: number): string =>
  encodeDesign(buildPresetDesign(presetId, elevator === undefined ? undefined : { elevatorDeg: elevator }, paperId));
const throwCodeOf = (presetId: string, paperId = 'copy80'): string => encodeDesign(buildPresetDesign(presetId, undefined, paperId), THROW);
const DART = codeOf('dart');
const GLIDER = codeOf('glider');
const THUMB = `data:image/jpeg;base64,${'A'.repeat(9000)}`;

function add(data: HangarData, name: string, code: string, now: number, thumb?: string): { data: HangarData; plane: SavedPlane } {
  const r = addPlane(data, { name, code, origin: 'preset:dart', thumb }, now);
  if (!r.ok) throw new Error(`넣기 실패: ${r.reason}`);
  return r;
}

/** 여러 가지 모양의 설계 코드 n 개(서로 다르다) */
function manyCodes(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < n; i++) {
    const preset = PRESETS[i % PRESETS.length]!;
    const paper = PAPERS[Math.floor(i / PRESETS.length) % PAPERS.length]!;
    out.push(codeOf(preset.id, paper.id));
  }
  return out;
}

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { map: Map<string, string>; writes: number } {
  const map = new Map(Object.entries(initial));
  const st = {
    map,
    writes: 0,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { st.writes++; map.set(k, v); },
  };
  return st;
}

describe('격납고: 이름', () => {
  it('앞뒤 빈칸을 떼고 1~12자만 받는다', () => {
    expect(cleanName('  멋진 비행기  ')).toBe('멋진 비행기');
    expect(cleanName('가')).toBe('가');
    expect(cleanName('')).toBeNull();
    expect(cleanName('   ')).toBeNull();
    expect(cleanName('가나다라마바사아자차카타')).toBe('가나다라마바사아자차카타');
    expect(cleanName('가나다라마바사아자차카타파')).toBeNull();
    expect(cleanName('줄\n바꿈  두 칸')).toBe('줄 바꿈 두 칸');
  });

  it('종이와 접는 법으로 이름을 추천하고, 있는 이름은 피해 번호를 올린다', () => {
    let data = emptyHangar();
    const first = suggestName(data.planes, 'newsprint', 'preset:dart');
    expect(first).toBe('신문지 화살 1호');
    data = add(data, first, codeOf('dart', 'newsprint'), 1).data;
    expect(suggestName(data.planes, 'newsprint', 'preset:dart')).toBe('신문지 화살 2호');
    expect(suggestName(data.planes, 'copy80', 'free')).toBe('복사지 내 맘대로 1호');
    for (const p of PAPERS) for (const o of ['free', ...PRESETS.map((x) => `preset:${x.id}`)] as const) {
      const n = cleanName(suggestName(data.planes, p.id, o as 'free'));
      expect(n, `${p.id} ${o}`).not.toBeNull();
    }
  });

  it('같은 이름을 여러 대에 붙일 수 있다', () => {
    let data = add(emptyHangar(), '쌍둥이', DART, 1).data;
    data = add(data, '쌍둥이', GLIDER, 2).data;
    expect(data.planes.map((p) => p.name)).toEqual(['쌍둥이', '쌍둥이']);
    expect(new Set(data.planes.map((p) => p.id)).size).toBe(2);
  });
});

describe('격납고: 넣기와 찾기', () => {
  it('넣은 비행기는 코드로 똑같이 되살아난다', () => {
    const { data, plane } = add(emptyHangar(), '화살', DART, 100, THUMB);
    expect(data.planes).toHaveLength(1);
    expect(plane).toMatchObject({ name: '화살', code: DART, paperId: 'copy80', origin: 'preset:dart', createdAt: 100, updatedAt: 100, flights: 0, favourite: false, best: {} });
    expect(plane.thumb).toBe(THUMB);
    expect(encodeDesign(designOfCode(plane.code)!)).toBe(DART);
  });

  it('원본을 바꾸지 않는다', () => {
    const before = emptyHangar();
    add(before, '화살', DART, 1);
    expect(before.planes).toHaveLength(0);
  });

  it('잘못된 이름, 잘못된 코드, 던지기 값이 붙은 코드는 받지 않는다', () => {
    const e = emptyHangar();
    expect(addPlane(e, { name: ' ', code: DART, origin: 'free' }, 1)).toEqual({ ok: false, reason: 'name' });
    expect(addPlane(e, { name: '가', code: 'zzzz', origin: 'free' }, 1)).toEqual({ ok: false, reason: 'code' });
    expect(addPlane(e, { name: '가', code: throwCodeOf('dart'), origin: 'free' }, 1)).toEqual({ ok: false, reason: 'code' });
  });

  it('너무 크거나 이상한 그림은 빼고 넣는다', () => {
    const big = add(emptyHangar(), '가', DART, 1, `data:image/jpeg;base64,${'A'.repeat(20000)}`).plane;
    expect(big.thumb).toBeUndefined();
    const bad = add(emptyHangar(), '가', DART, 1, 'javascript:alert(1)').plane;
    expect(bad.thumb).toBeUndefined();
  });

  it('같은 모양이 있는지 코드로 알아낸다', () => {
    const { data, plane } = add(emptyHangar(), '화살', DART, 1);
    expect(findByCode(data, DART)?.id).toBe(plane.id);
    expect(findByCode(data, GLIDER)).toBeNull();
    // 종이만 달라도 다른 비행기다.
    expect(findByCode(data, codeOf('dart', 'newsprint'))).toBeNull();
  });

  it('24대까지 들어가고 25번째는 "꽉 찼어요"', () => {
    let data = emptyHangar();
    const codes = manyCodes(HANGAR_MAX + 1);
    expect(new Set(codes).size).toBe(HANGAR_MAX + 1);
    for (let i = 0; i < HANGAR_MAX; i++) data = add(data, `비행기 ${i + 1}`, codes[i]!, i + 1).data;
    expect(data.planes).toHaveLength(HANGAR_MAX);
    expect(new Set(data.planes.map((p) => p.id)).size).toBe(HANGAR_MAX);
    expect(addPlane(data, { name: '하나 더', code: codes[HANGAR_MAX]!, origin: 'free' }, 99)).toEqual({ ok: false, reason: 'full' });
  });

  it('같은 순간에 넣어도 id 가 겹치지 않는다', () => {
    let data = emptyHangar();
    for (let i = 0; i < 5; i++) data = add(data, '가', DART, 777).data;
    expect(new Set(data.planes.map((p) => p.id)).size).toBe(5);
  });
});

describe('격납고: 고치기', () => {
  it('이름 바꾸기: 다듬어서 넣고, 잘못된 이름이면 그대로 둔다', () => {
    const { data, plane } = add(emptyHangar(), '화살', DART, 1);
    const a = renamePlane(data, plane.id, '  번개  ', 5);
    expect(a.planes[0]).toMatchObject({ name: '번개', updatedAt: 5 });
    expect(renamePlane(data, plane.id, '', 5)).toBe(data);
    expect(renamePlane(data, 'nope', '번개', 5)).toBe(data);
  });

  it('즐겨찾기를 켜고 끈다', () => {
    const { data, plane } = add(emptyHangar(), '화살', DART, 1);
    const on = setFavourite(data, plane.id, true);
    expect(on.planes[0]!.favourite).toBe(true);
    expect(setFavourite(on, plane.id, false).planes[0]!.favourite).toBe(false);
  });

  it('고친 걸로 바꾸기: 모양이 바뀌면 최고 기록은 지우고 이름과 날린 횟수는 남긴다', () => {
    let { data, plane } = add(emptyHangar(), '화살', DART, 1, THUMB);
    data = recordFlight(data, { designCode: DART, distanceM: 12, airtimeS: 2, throwCode: throwCodeOf('dart'), at: 2 }).data;
    data = setFavourite(data, plane.id, true);
    const next = replaceDesign(data, plane.id, codeOf('glider', 'newsprint'), 'free', 9);
    expect(next.planes[0]).toMatchObject({ id: plane.id, name: '화살', code: codeOf('glider', 'newsprint'), paperId: 'newsprint', origin: 'free', flights: 1, favourite: true, best: {}, updatedAt: 9, createdAt: 1 });
    expect(next.planes[0]!.thumb).toBeUndefined();
    // 같은 코드로 바꾸면 아무 일도 없다. 잘못된 코드도 마찬가지.
    expect(replaceDesign(data, plane.id, DART, 'free', 9)).toEqual(data);
    expect(replaceDesign(data, plane.id, 'bad', 'free', 9)).toBe(data);
  });

  it('지금 접은 비행기와의 사이: 새것 / 들어 있음 / 꺼내서 고침', () => {
    const { data, plane } = add(emptyHangar(), '화살', DART, 1);
    expect(saveStatusOf(emptyHangar(), DART, null)).toEqual({ kind: 'new' });
    expect(saveStatusOf(data, DART, null)).toMatchObject({ kind: 'saved', plane: { id: plane.id } });
    expect(saveStatusOf(data, GLIDER, plane.id)).toMatchObject({ kind: 'modified', plane: { id: plane.id } });
    expect(saveStatusOf(data, GLIDER, null)).toEqual({ kind: 'new' });
    // 버린 비행기를 가리키고 있으면 새것으로 본다.
    expect(saveStatusOf(data, GLIDER, 'gone')).toEqual({ kind: 'new' });
  });

  it('손대지 않은 따라 접기 비행기만 그 접는 법으로 다시 연다', () => {
    expect(untouchedPresetOf({ code: DART, origin: 'preset:dart', paperId: 'copy80' })).toBe('dart');
    expect(untouchedPresetOf({ code: codeOf('dart', 'kent160'), origin: 'preset:dart', paperId: 'kent160' })).toBe('dart');
    expect(untouchedPresetOf({ code: codeOf('dart', 'copy80', 6), origin: 'preset:dart', paperId: 'copy80' })).toBeNull();
    expect(untouchedPresetOf({ code: DART, origin: 'free', paperId: 'copy80' })).toBeNull();
    expect(untouchedPresetOf({ code: DART, origin: 'preset:nope', paperId: 'copy80' })).toBeNull();
  });
});

describe('격납고: 비행 기록', () => {
  it('같은 모양으로 날리면 횟수가 늘고, 더 좋을 때만 최고 기록이 바뀐다', () => {
    let { data, plane } = add(emptyHangar(), '화살', DART, 1);
    const tc = throwCodeOf('dart');
    let u = recordFlight(data, { designCode: DART, distanceM: 10, airtimeS: 3, throwCode: tc, at: 10 });
    expect(u.planeIds).toEqual([plane.id]);
    expect(u.improved).toEqual({ distance: true, airtime: true });
    expect(u.data.planes[0]).toMatchObject({ flights: 1, updatedAt: 10, best: { distance: { value: 10, at: 10, throwCode: tc }, airtime: { value: 3, at: 10 } } });
    data = u.data;
    // 거리는 못 미치고 시간만 더 좋다
    u = recordFlight(data, { designCode: DART, distanceM: 8, airtimeS: 3.5, throwCode: tc, at: 20 });
    expect(u.improved).toEqual({ distance: false, airtime: true });
    expect(u.data.planes[0]).toMatchObject({ flights: 2, best: { distance: { value: 10, at: 10 }, airtime: { value: 3.5, at: 20 } } });
    data = u.data;
    // 똑같은 기록은 새 기록이 아니다
    u = recordFlight(data, { designCode: DART, distanceM: 10, airtimeS: 3.5, throwCode: tc, at: 30 });
    expect(u.improved).toEqual({ distance: false, airtime: false });
    expect(u.data.planes[0]!.best.distance!.at).toBe(10);
    expect(u.data.planes[0]!.flights).toBe(3);
  });

  it('넣어 두지 않은 모양으로 날리면 아무것도 바뀌지 않는다', () => {
    const { data } = add(emptyHangar(), '화살', DART, 1);
    const u = recordFlight(data, { designCode: GLIDER, distanceM: 30, airtimeS: 9, throwCode: throwCodeOf('glider'), at: 2 });
    expect(u.data).toBe(data);
    expect(u.planeIds).toEqual([]);
  });

  it('숫자가 아닌 결과는 무시한다', () => {
    const { data } = add(emptyHangar(), '화살', DART, 1);
    expect(recordFlight(data, { designCode: DART, distanceM: NaN, airtimeS: 1, throwCode: 'x', at: 2 }).data).toBe(data);
  });
});

describe('격납고: 버리기와 되돌리기', () => {
  it('버린 비행기를 있던 자리에 도로 넣는다', () => {
    let data = emptyHangar();
    const ids: string[] = [];
    for (const [i, c] of manyCodes(4).entries()) { const r = add(data, `비행기${i}`, c, i + 1); data = r.data; ids.push(r.plane.id); }
    const del = deletePlane(data, ids[1]!);
    expect(del.data.planes.map((p) => p.id)).toEqual([ids[0], ids[2], ids[3]]);
    expect(del.removed).toMatchObject({ index: 1, plane: { id: ids[1] } });
    expect(restorePlane(del.data, del.removed!).planes.map((p) => p.id)).toEqual(ids);
    // 두 번 되돌려도 한 대만 돌아온다
    expect(restorePlane(restorePlane(del.data, del.removed!), del.removed!).planes).toHaveLength(4);
  });

  it('없는 비행기를 버리면 아무 일도 없다', () => {
    const { data } = add(emptyHangar(), '화살', DART, 1);
    expect(deletePlane(data, 'nope')).toEqual({ data, removed: null });
  });
});

describe('격납고: 차례', () => {
  const build = (): { data: HangarData; ids: string[] } => {
    let data = emptyHangar();
    const ids: string[] = [];
    const codes = manyCodes(4);
    for (let i = 0; i < 4; i++) { const r = add(data, `p${i}`, codes[i]!, (i + 1) * 10); data = r.data; ids.push(r.plane.id); }
    // p0: 멀리 15 / p1: 멀리 20, 오래 2 / p2: 오래 5 / p3: 기록 없음
    const fly = (i: number, d: number, t: number, at: number): void => { data = recordFlight(data, { designCode: codes[i]!, distanceM: d, airtimeS: t, throwCode: 'x', at }).data; };
    fly(0, 15, 1, 100);
    fly(1, 20, 2, 90);
    fly(2, 3, 5, 80);
    data = setFavourite(data, ids[2]!, true);
    data = setFavourite(data, ids[3]!, true);
    return { data, ids };
  };

  it('최근: 마지막으로 만진 것이 앞', () => {
    const { data } = build();
    expect(sortPlanes(data.planes, 'recent').map((p) => p.name)).toEqual(['p0', 'p1', 'p2', 'p3']);
  });
  it('멀리 / 오래: 기록 좋은 차례, 기록 없는 비행기는 맨 뒤', () => {
    const { data } = build();
    expect(sortPlanes(data.planes, 'far').map((p) => p.name)).toEqual(['p1', 'p0', 'p2', 'p3']);
    expect(sortPlanes(data.planes, 'long').map((p) => p.name)).toEqual(['p2', 'p1', 'p0', 'p3']);
  });
  it('즐겨찾기: 별표한 것만', () => {
    const { data } = build();
    expect(sortPlanes(data.planes, 'fav').map((p) => p.name)).toEqual(['p2', 'p3']);
  });
  it('늘어놓아도 원본 차례는 그대로다', () => {
    const { data } = build();
    const before = data.planes.map((p) => p.id);
    sortPlanes(data.planes, 'far');
    expect(data.planes.map((p) => p.id)).toEqual(before);
  });
  it('종목별 1등을 찾는다', () => {
    const { data } = build();
    expect(championOf(data.planes, 'distance')?.name).toBe('p1');
    expect(championOf(data.planes, 'airtime')?.name).toBe('p2');
    expect(championOf([], 'distance')).toBeNull();
  });
  it('종이 종류를 센다', () => {
    let data = emptyHangar();
    for (const [i, p] of PAPERS.entries()) data = add(data, `p${i}`, codeOf('dart', p.id), i).data;
    data = add(data, '또', codeOf('glider', PAPERS[0]!.id), 99).data;
    expect(paperKinds(data).sort()).toEqual(PAPERS.map((p) => p.id).sort());
  });
});

describe('격납고: 읽어 들이기', () => {
  it('저장했다 읽으면 그대로다', () => {
    let { data } = add(emptyHangar(), '화살', DART, 1, THUMB);
    data = add(data, '글라이더', GLIDER, 2).data;
    data = recordFlight(data, { designCode: DART, distanceM: 12.5, airtimeS: 2.5, throwCode: throwCodeOf('dart'), at: 3 }).data;
    const back = reviveHangar(JSON.parse(serializeHangar(data)));
    expect(back).toEqual({ data, skipped: 0, newer: false });
  });

  it('망가진 칸은 건너뛰고 나머지는 살린다(예외 없음)', () => {
    const good = add(emptyHangar(), '화살', DART, 1).plane;
    const raw = {
      v: 1,
      planes: [
        good,
        { ...good, id: 'x1', code: 'not-a-code!!' },
        { ...good, id: 'x2', code: throwCodeOf('dart') },
        null, 7, 'text', [],
        { id: 'x3' },
        { ...good, id: '' },
        { ...good }, // id 겹침
        { ...good, id: 'x4', name: 12, flights: -3.7, favourite: 'yes', best: { distance: { value: 'far' }, airtime: { value: 4, at: 'x', throwCode: 5 } }, thumb: 'http://evil.example/x.png', origin: 'weird', paperId: 'kent160', updatedAt: null },
      ],
    };
    const r = reviveHangar(raw);
    expect(r.skipped).toBe(9);
    expect(r.data.planes.map((p) => p.id)).toEqual([good.id, 'x4']);
    expect(r.data.planes[1]).toEqual({
      id: 'x4', name: '이름 없는 비행기', code: DART, paperId: 'copy80', origin: 'free', createdAt: 1, updatedAt: 1,
      best: { airtime: { value: 4, at: 0 } }, flights: 0, favourite: false,
    });
  });

  it('다른 모양으로 던진 코드가 기록에 붙어 있으면 떼어 낸다', () => {
    const good = add(emptyHangar(), '화살', DART, 1).plane;
    const r = reviveHangar({ v: 1, planes: [{ ...good, best: { distance: { value: 9, at: 5, throwCode: throwCodeOf('glider') }, airtime: { value: 2, at: 5, throwCode: throwCodeOf('dart') } } }] });
    expect(r.data.planes[0]!.best).toEqual({ distance: { value: 9, at: 5 }, airtime: { value: 2, at: 5, throwCode: throwCodeOf('dart') } });
  });

  it('지금 규칙보다 센 던지기로 낸 최고 기록은 버리고 비행기는 남긴다(설계만 든 코드는 한도와 상관없다)', () => {
    const good = add(emptyHangar(), '화살', DART, 1).plane;
    // 던지기 한도가 16 m/s 이던 때의 14 m/s 던지기: 코드는 읽히지만 throwIn 없이 throwOutOfRange 만 나온다.
    const oldThrow = encodeDesign(buildPresetDesign('dart', undefined, 'copy80'), { speedMps: 14, pitchDeg: 10, rollDeg: 0 });
    expect(LIMITS.throwSpeedMax).toBeLessThan(14);
    expect(decodeDesign(oldThrow)).toMatchObject({ throwOutOfRange: { speedMps: 14 } });
    expect(decodeDesign(oldThrow)!.throwIn).toBeUndefined();
    const r = reviveHangar({ v: 1, planes: [{ ...good, flights: 7, best: { distance: { value: 31.2, at: 5, throwCode: oldThrow }, airtime: { value: 2, at: 6, throwCode: throwCodeOf('dart') } } }] });
    expect(r.skipped).toBe(0);
    expect(r.data.planes).toHaveLength(1);
    expect(r.data.planes[0]!).toMatchObject({ id: good.id, code: DART, name: '화살', flights: 7 });
    expect(r.data.planes[0]!.best).toEqual({ airtime: { value: 2, at: 6, throwCode: throwCodeOf('dart') } });
    // 설계 코드는 그대로 설계 코드이고, 센 던지기가 붙은 코드는 설계 코드로 받지 않는다(넣기에서도 거절).
    expect(designOfCode(DART)).not.toBeNull();
    expect(designOfCode(oldThrow)).toBeNull();
    expect(addPlane(emptyHangar(), { name: '옛 화살', code: oldThrow, origin: 'free' }, 1)).toEqual({ ok: false, reason: 'code' });
  });

  it('긴 이름은 12자로 자르고, 24대가 넘는 칸은 버린다', () => {
    const good = add(emptyHangar(), '화살', DART, 1).plane;
    const planes = Array.from({ length: 30 }, (_, i) => ({ ...good, id: `p${i}`, name: '가나다라마바사아자차카타파하' }));
    const r = reviveHangar({ v: 1, planes });
    expect(r.data.planes).toHaveLength(HANGAR_MAX);
    expect(r.skipped).toBe(6);
    expect(r.data.planes[0]!.name).toBe('가나다라마바사아자차카타');
  });

  it('이상한 값이 와도 빈 격납고로 시작한다', () => {
    for (const raw of [null, undefined, 0, 'x', [], {}, { v: 1 }, { v: 1, planes: 'no' }, { planes: {} }]) {
      const r = reviveHangar(raw);
      expect(r.data, JSON.stringify(raw)).toEqual({ v: HANGAR_VERSION, planes: [] });
    }
  });

  it('판 번호가 없으면 1판으로 읽고, 더 새로운 판은 건드리지 않는다', () => {
    const good = add(emptyHangar(), '화살', DART, 1).plane;
    expect(reviveHangar({ planes: [good] }).data.planes).toHaveLength(1);
    expect(reviveHangar({ v: 99, planes: [good] })).toEqual({ data: emptyHangar(), skipped: 0, newer: true });
  });
});

describe('격납고: 크기', () => {
  it('그림 없는 비행기 한 대는 1 kB 안쪽, 그림이 있으면 12 kB 안쪽', () => {
    let data = emptyHangar();
    for (const preset of PRESETS) {
      const code = codeOf(preset.id);
      let p = add(emptyHangar(), '가나다라마바사아자차카타', code, 1731650000000).plane;
      const d = recordFlight({ v: 1, planes: [p] }, { designCode: code, distanceM: 23.456789, airtimeS: 5.123456, throwCode: throwCodeOf(preset.id), at: 1731650000000 }).data;
      p = d.planes[0]!;
      expect(planeBytes(p).total, preset.id).toBeLessThan(1000);
      const withThumb = add(emptyHangar(), '가나다라마바사아자차카타', code, 1, THUMB).plane;
      expect(planeBytes(withThumb).total).toBeLessThan(12_000);
      data = add(data, preset.id, code, 1).data;
    }
    expect(byteSize('가a')).toBe(4);
  });

  it('한도를 넘으면 오래 안 만진 비행기의 그림부터 뺀다', () => {
    let data = emptyHangar();
    const codes = manyCodes(6);
    for (let i = 0; i < 6; i++) data = add(data, `p${i}`, codes[i]!, i + 1, THUMB).data;
    const size = serializeHangar(data).length;
    const fit = fitBudget(data, size - 10);
    expect(fit.dropped).toBe(1);
    expect(fit.data.planes.map((p) => p.thumb !== undefined)).toEqual([false, true, true, true, true, true]);
    expect(serializeHangar(fit.data).length).toBeLessThanOrEqual(size - 10);
    expect(fitBudget(data, size).dropped).toBe(0);
    const tiny = fitBudget(data, 2000);
    expect(tiny.dropped).toBe(6);
    expect(tiny.data.planes).toHaveLength(6);
    expect(dropThumbs(data).planes.every((p) => p.thumb === undefined)).toBe(true);
  });
});

describe('격납고: 저장소', () => {
  it('저장하고 다시 읽는다', () => {
    const st = memoryStorage();
    const store = new HangarStore(() => st);
    expect(store.load()).toMatchObject({ data: emptyHangar(), persistent: true, skipped: 0 });
    const { data } = add(emptyHangar(), '화살', DART, 1, THUMB);
    expect(store.save(data)).toEqual({ data, persisted: true, droppedThumbs: false });
    expect(st.map.has(HANGAR_KEY)).toBe(true);
    const again = new HangarStore(() => st).load();
    expect(again.data).toEqual(data);
    expect(again.persistent).toBe(true);
  });

  it('저장소를 얻는 것부터 막혀 있으면 이번 방문 동안 메모리에 둔다', () => {
    const store = new HangarStore(() => { throw new Error('SecurityError'); });
    const first = store.load();
    expect(first).toMatchObject({ persistent: false, data: emptyHangar() });
    const { data } = add(emptyHangar(), '화살', DART, 1);
    expect(store.save(data)).toEqual({ data, persisted: false, droppedThumbs: false });
    expect(store.load().data).toEqual(data);
    expect(store.persistent).toBe(false);
  });

  it('저장소가 없어도(null) 같다', () => {
    const store = new HangarStore(() => null);
    expect(store.load().persistent).toBe(false);
    const { data } = add(emptyHangar(), '화살', DART, 1);
    expect(store.save(data).persisted).toBe(false);
    expect(store.load().data.planes).toHaveLength(1);
  });

  it('읽기는 되는데 쓰기가 막혀 있으면 처음부터 "이번 방문만"이라고 알려 준다', () => {
    const saved = serializeHangar(add(emptyHangar(), '화살', DART, 1).data);
    const st: StorageLike = { getItem: (k) => (k === HANGAR_KEY ? saved : null), setItem: () => { throw new Error('denied'); } };
    const store = new HangarStore(() => st);
    const r = store.load();
    expect(r.data.planes).toHaveLength(1);
    expect(r.persistent).toBe(false);
  });

  it('읽다가 예외가 나도 멈추지 않는다', () => {
    const st: StorageLike = { getItem: () => { throw new Error('boom'); }, setItem: () => undefined };
    const r = new HangarStore(() => st).load();
    expect(r).toMatchObject({ persistent: false, data: emptyHangar() });
  });

  it('글자가 깨진 값은 건너뛰고 빈 격납고로 시작한다', () => {
    const st = memoryStorage({ [HANGAR_KEY]: '{"v":1,"planes":[{"id":' });
    const r = new HangarStore(() => st).load();
    expect(r.data.planes).toHaveLength(0);
    expect(r.skipped).toBe(1);
    expect(r.persistent).toBe(true);
  });

  it('자리가 모자라면 그림을 빼고 다시 적는다', () => {
    const map = new Map<string, string>();
    const st: StorageLike = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => { if (v.length > 3000) throw new Error('QuotaExceededError'); map.set(k, v); },
    };
    const store = new HangarStore(() => st);
    store.load();
    const { data } = add(emptyHangar(), '화살', DART, 1, THUMB);
    const out = store.save(data);
    expect(out.persisted).toBe(true);
    expect(out.droppedThumbs).toBe(true);
    expect(out.data.planes[0]!.thumb).toBeUndefined();
    expect(JSON.parse(map.get(HANGAR_KEY)!).planes[0].name).toBe('화살');
  });

  it('그림을 빼도 안 적히면 메모리에 두고 알려 준다', () => {
    const st: StorageLike = { getItem: () => null, setItem: (k) => { if (!k.endsWith('.probe')) throw new Error('QuotaExceededError'); } };
    const store = new HangarStore(() => st);
    expect(store.load().persistent).toBe(true);
    const { data } = add(emptyHangar(), '화살', DART, 1, THUMB);
    const out = store.save(data);
    expect(out.persisted).toBe(false);
    expect(out.data.planes).toHaveLength(1);
    expect(store.persistent).toBe(false);
    expect(store.load().data.planes).toHaveLength(1);
  });

  it('더 새로운 판이 적어 둔 값은 덮어쓰지 않는다', () => {
    const newer = JSON.stringify({ v: 99, planes: [{ future: true }] });
    const st = memoryStorage({ [HANGAR_KEY]: newer });
    const store = new HangarStore(() => st);
    const r = store.load();
    expect(r).toMatchObject({ newer: true, persistent: false });
    const out = store.save(add(emptyHangar(), '화살', DART, 1).data);
    expect(out.persisted).toBe(false);
    expect(st.map.get(HANGAR_KEY)).toBe(newer);
  });
});
