/**
 * 게시 뷰어의 "새 판으로 바꿔 끼우기"(hot republish) 지원.
 * 뷰어가 있으면 window.claude.hot 으로 지금 상태를 넘겨주고, 새 판이 뜰 때 그 상태로 이어서 시작한다.
 * 뷰어 밖(보통의 브라우저)에서는 window.claude 가 없으므로 아무 일도 하지 않는다.
 */
interface HotApi {
  data?: unknown;
  snapshot?: (fn: () => unknown) => void;
}

function hot(): HotApi | undefined {
  try {
    return (window as unknown as { claude?: { hot?: HotApi } }).claude?.hot;
  } catch {
    return undefined;
  }
}

/** 지난 판이 남긴 상태(없으면 null) */
export function hotData(): unknown {
  return hot()?.data ?? null;
}

/** 지금 상태를 돌려주는 함수를 등록한다. 값은 JSON 으로 바꿀 수 있는 것만 넣는다. */
export function registerHotSnapshot(fn: () => unknown): void {
  try {
    hot()?.snapshot?.(fn);
  } catch {
    /* 뷰어가 받지 않아도 놀이에는 지장이 없다 */
  }
}
