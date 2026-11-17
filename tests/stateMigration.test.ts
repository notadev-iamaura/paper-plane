/**
 * 저장해 둔 지난 방문 상태 되살리기: 색종이 색(colorId)이 있던 예전 저장값도 문제없이 읽혀야 한다.
 * (종이 종류가 겉모습을 정하게 되면서 색 고르기가 없어졌다.)
 */
import { describe, expect, it } from 'vitest';
import { defaultState, reducer, reviveSession } from '../src/app/state';

const legacy = {
  screen: 'desk', deskStep: 'fold', paperId: 'newsprint', colorId: 'blue', foldMode: 'simple', presetId: 'dart',
  presetParams: {}, presetChosen: true, guideFolds: null, freeFolds: [],
  freeShaping: { keelM: 0.02, dihedralDeg: 8, wingletM: 0, wingletDeg: 0, elevatorDeg: 2 },
  clip: null, throwIn: { speedMps: 7, pitchDeg: 5, rollDeg: 0 }, mode: 'distance',
};

describe('지난 방문 상태', () => {
  it('색이 들어 있던 예전 저장값을 되살리고 색은 버린다', () => {
    const s = reviveSession(legacy);
    expect(s).not.toBeNull();
    expect(s!.paperId).toBe('newsprint');
    expect(s!.deskStep).toBe('fold');
    expect(s!.presetChosen).toBe(true);
    expect(s!.guideFolds).toBeNull();
    expect('colorId' in (s as object)).toBe(false);
  });

  it('기본 상태에는 색이 없고, 종이를 바꾸면 종이만 바뀐다', () => {
    const s = defaultState();
    expect('colorId' in (s as object)).toBe(false);
    const next = reducer(s, { type: 'paper', paperId: 'kent160' });
    expect(next.paperId).toBe('kent160');
    expect(next.freeFolds).toBe(s.freeFolds);
  });

  it('모르는 종이 id 가 저장돼 있으면 기본 종이로 바꿔 되살린다', () => {
    const s = reviveSession({ ...legacy, paperId: 'gold-leaf' });
    expect(s).not.toBeNull();
    expect(s!.paperId).toBe('copy80');
  });
});
