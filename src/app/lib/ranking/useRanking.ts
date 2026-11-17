/**
 * 순위표를 화면에서 쓰는 창구(React 훅)와, 어느 화면에서나 "순위표 열기 / 기록 올리기"를 부탁하는 작은 알림판.
 * 알림판을 듣는 것은 App 에 한 번 놓인 RankingHost 다. 그래서 다른 화면은 넘겨받을 값 없이 함수만 부르면 된다.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { getSelection, subscribeSelection } from './select';
import type { Selection } from './select';
import type { RankingBackend, RankingState, RankMode } from './types';
import { EMPTY_BOARD } from './types';

/** 순위표가 어느 길로 움직이는지(알아보는 중 / 없음 / 준비됨) */
export function useRankingSelection(): Selection {
  return useSyncExternalStore(subscribeSelection, getSelection);
}

const IDLE: RankingState = { status: 'idle', errors: [], write: 'no-id', boards: { distance: EMPTY_BOARD, airtime: EMPTY_BOARD } };
const noSub = (): (() => void) => () => undefined;
const idle = (): RankingState => IDLE;

/** 순위표의 지금 모습. 처음 쓰일 때 순위표를 켠다(한 번만 지켜본다). */
export function useRankingState(backend: RankingBackend | null): RankingState {
  useEffect(() => {
    backend?.start();
  }, [backend]);
  return useSyncExternalStore(backend ? backend.subscribe : noSub, backend ? backend.getState : idle);
}

// ---- 알림판 ----
export interface SubmitRequest {
  code: string;
  mode: RankMode;
  /** 이 기기에서 계산한 값(화면에 보여 주기만 한다. 어디에도 보내지 않는다) */
  localScore: number | null;
}
export interface RankUi {
  board: { mode: RankMode } | null;
  submit: SubmitRequest | null;
  /** 순위표에서 남의 비행기를 꺼낸 횟수(꺼낼 때마다 1씩 는다) */
  viewed: number;
}

let ui: RankUi = { board: null, submit: null, viewed: 0 };
const uiListeners = new Set<() => void>();
function setUi(next: RankUi): void {
  ui = next;
  for (const fn of [...uiListeners]) fn();
}
export const rankUi = {
  openBoard: (mode: RankMode): void => setUi({ ...ui, board: { mode } }),
  closeBoard: (): void => setUi({ ...ui, board: null }),
  openSubmit: (req: SubmitRequest): void => setUi({ ...ui, submit: req }),
  closeSubmit: (): void => setUi({ ...ui, submit: null }),
  closeAll: (): void => { if (ui.board || ui.submit) setUi({ ...ui, board: null, submit: null }); },
  /** 순위표의 비행기를 꺼냈다: 떠 있던 판을 닫고, 결과 패널이 떠 있으면 조준으로 돌아가게 알린다. */
  viewed: (): void => setUi({ board: null, submit: null, viewed: ui.viewed + 1 }),
};
export function useRankUi(): RankUi {
  return useSyncExternalStore((fn) => { uiListeners.add(fn); return () => { uiListeners.delete(fn); }; }, () => ui);
}

/** 저장소가 끝내 답하지 않을 때를 대비해, 정해진 시간이 지나면 fallback 을 돌려준다(뒤늦게 온 답은 순위표가 알아서 반영한다). */
export function orAfter<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), ms);
    p.then((v) => { window.clearTimeout(timer); resolve(v); }, () => { window.clearTimeout(timer); resolve(fallback); });
  });
}
/** 올리기, 지우기를 기다려 주는 가장 긴 시간 */
export const WRITE_WAIT_MS = 20_000;
