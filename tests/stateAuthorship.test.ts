import { describe, expect, it } from 'vitest';
import { decodeDesign, encodeDesign, PRESETS } from '../src/core/index';
import { defaultState, designFromState, isAuthoredFreeFold, reducer, reviveSession } from '../src/app/state';

const design = PRESETS[0]!.design;
const imported = () => reducer(defaultState(), { type: 'load', design });

describe('직접 접은 비행기 스티커 판정', () => {
  it('공유 코드, 종이·각도·다듬기 변경, 같은 접기 재설정만으로는 직접 접었다고 보지 않는다', () => {
    let s = imported();
    s = reducer(s, { type: 'paper', paperId: 'newsprint' });
    s = reducer(s, { type: 'throw', patch: { speedMps: 10 } });
    s = reducer(s, { type: 'shaping', key: 'elevatorDeg', value: 2 });
    s = reducer(s, { type: 'freeSet', folds: [...s.freeFolds] });
    expect(isAuthoredFreeFold(s)).toBe(false);
    expect(isAuthoredFreeFold(reviveSession(s)!)).toBe(false);
  });

  it('불러온 모양을 직접 바꾸면 인정하고, 원래 모양으로 되돌리면 인정하지 않는다', () => {
    const changed = reducer(imported(), { type: 'freeSet', folds: design.folds.slice(0, 2) });
    expect(isAuthoredFreeFold(changed)).toBe(true);
    const undone = reducer(changed, { type: 'freeUndo' });
    expect(isAuthoredFreeFold(undone)).toBe(false);
    expect(isAuthoredFreeFold(reducer(undone, { type: 'freeRedo' }))).toBe(true);
    expect(isAuthoredFreeFold(reducer(changed, { type: 'freeSet', folds: [] }))).toBe(false);
  });

  it('직접 만든 비행기는 새로고침과 격납고의 코드 왕복 뒤에도 인정한다', () => {
    let s = reducer(defaultState(), { type: 'foldMode', mode: 'free' });
    s = reducer(s, { type: 'freeSet', folds: design.folds });
    s = reviveSession(s)!;
    const roundTrip = decodeDesign(encodeDesign(designFromState(s)))!.design;
    s = reducer(s, { type: 'load', design: roundTrip, hangarId: 'local-plane' });
    expect(isAuthoredFreeFold(s)).toBe(true);
    const other = reducer(s, { type: 'load', design: PRESETS[1]!.design });
    expect(isAuthoredFreeFold(other)).toBe(false);
  });

  it('따라 접기를 자유 접기로 옮기는 것만으로는 인정하지 않는다', () => {
    let s = reducer(defaultState(), { type: 'presetPick', presetId: 'dart' });
    s = reducer(s, { type: 'presetInstant' });
    s = reducer(s, { type: 'convertToFree' });
    expect(isAuthoredFreeFold(s)).toBe(false);
  });

  it('이력이 없는 예전 저장도 모양은 보존하며, 출처를 임의로 인정하지 않는다', () => {
    const { authoredFoldKeys: _unused, ...old } = imported();
    const s = reviveSession(old)!;
    expect(s.freeFolds).toEqual(old.freeFolds);
    expect(isAuthoredFreeFold(s)).toBe(false);
  });
});
