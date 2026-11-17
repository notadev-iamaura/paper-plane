/**
 * 비행 계산을 화면과 다른 실(Web Worker)에서 돌린다.
 * 계산은 0.1~0.2초쯤 걸리는데, 그동안 화면이 멈추지 않게 하기 위해서다.
 * 주고받는 값: { id, design, throwIn } -> { id, ok, result | error }
 */
import { buildGeometry, simulate } from '../../core/index';
import type { PlaneDesign, SimResult, ThrowInput } from '../../core/index';

export interface SimRequest { id: number; design: PlaneDesign; throwIn: ThrowInput }
export type SimReply =
  | { id: number; ok: true; result: SimResult; ms: number }
  | { id: number; ok: false; error: string };

// Worker 안의 self 는 타입 설정(DOM 라이브러리)상 Window 로 보이므로 필요한 모양만 직접 적는다.
interface WorkerScope {
  onmessage: ((e: MessageEvent<SimRequest>) => void) | null;
  postMessage: (msg: SimReply) => void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { id, design, throwIn } = e.data;
  try {
    const t0 = performance.now();
    const result = simulate(buildGeometry(design), throwIn);
    scope.postMessage({ id, ok: true, result, ms: performance.now() - t0 });
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
