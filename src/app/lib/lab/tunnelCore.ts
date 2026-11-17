/**
 * core 의 풍동 계산을 실험실이 쓰는 모양(TunnelDeps)으로 묶은 것. 공기 힘 계산은 전부 core 가 한다.
 */
import { PHYSICS_VERSION, probeTunnel, TUNNEL_LIMITS, tunnelTrim } from '../../../core/index';
import type { TunnelDeps } from './labMath';

export const CORE_TUNNEL: TunnelDeps = {
  probe: probeTunnel,
  trim: tunnelTrim,
  limits: TUNNEL_LIMITS,
};

export { PHYSICS_VERSION, TUNNEL_LIMITS };

/** 한가할 때 한 걸음(없으면 잠깐 뒤). 긴 계산을 잘게 나눠 화면이 멈추지 않게 한다. */
export function idlePause(): Promise<void> {
  return new Promise((res) => {
    const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(() => res(), { timeout: 120 });
    else window.setTimeout(res, 16);
  });
}
