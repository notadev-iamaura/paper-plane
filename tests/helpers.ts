/** 테스트 공용 도우미: 정해진 순서로 같은 값을 내는 유사 난수와 임의 설계 생성기 */
import type { FoldOp, PlaneDesign } from '../src/core/types';
import { PAPERS } from '../src/core/papers';

/** 선형 합동 생성기(LCG). Math.random 을 쓰지 않으므로 매번 같은 결과가 나온다. */
export function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 종이 근처의 임의 직선으로 접는 접기 하나 */
export function randomFold(rnd: () => number): FoldOp {
  for (;;) {
    const a = { x: (rnd() - 0.5) * 0.24, y: (rnd() - 0.5) * 0.32 };
    const b = { x: (rnd() - 0.5) * 0.24, y: (rnd() - 0.5) * 0.32 };
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.01) continue;
    return { a, b, dir: rnd() < 0.5 ? 'valley' : 'mountain' };
  }
}

/** 검사를 통과하는 범위 안의 임의 자유접기 설계 */
export function randomDesign(rnd: () => number, maxFolds = 8): PlaneDesign {
  const n = Math.floor(rnd() * (maxFolds + 1));
  const folds: FoldOp[] = [];
  for (let i = 0; i < n; i++) folds.push(randomFold(rnd));
  return {
    v: 1,
    paperId: PAPERS[Math.floor(rnd() * PAPERS.length)]!.id,
    folds,
    shaping: {
      keelM: rnd() < 0.15 ? 0 : rnd() * 0.05,
      dihedralDeg: -10 + rnd() * 55,
      wingletM: rnd() < 0.4 ? 0 : rnd() * 0.04,
      wingletDeg: -90 + rnd() * 180,
      elevatorDeg: -15 + rnd() * 35,
    },
    clip: rnd() < 0.3 ? { xBodyM: -rnd() * 0.297 } : null,
  };
}
