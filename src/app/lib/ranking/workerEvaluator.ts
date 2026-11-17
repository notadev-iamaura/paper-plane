/**
 * 브라우저용 계산기: 기존 비행 계산 Worker(sim.worker.ts)를 순위표 전용으로 따로 띄워 쓴다.
 * - 놀이의 던지기 계산(simRunner)과 일꾼을 나눠 쓰지 않으므로, 순위표 계산이 밀려도 내 비행은 늦어지지 않는다.
 * - 제한 시간을 넘긴 계산은 그 Worker 를 꺼 버리는 것으로 그만둔다(다음 계산 때 새로 띄운다).
 * - Worker 를 띄울 수 없는 곳에서는 화면 실에서 하나씩, 사이사이 쉬어 가며 계산한다.
 *   이때는 도중에 그만둘 수 없으므로, 끝난 뒤 걸린 시간이 제한을 넘었으면 'slow' 로 알린다.
 */
import { buildGeometry, simulate } from '../../../core/index';
import type { PlaneDesign, ThrowInput } from '../../../core/index';
import { log } from '../logger';
import type { SimReply, SimRequest } from '../sim.worker';
import type { EvalJob, EvalResult, Evaluator } from './verifier';
import { EVAL_TIMEOUT_MS } from './verifier';

interface Slot {
  worker: Worker;
  busy: ((r: SimReply) => void) | null;
  fail: ((e: Error) => void) | null;
}

let workersBroken = false;
const idle: Slot[] = [];
let nextId = 1;
/** 화면 실에서 계산할 때의 줄(한 번에 하나) */
let mainChain: Promise<unknown> = Promise.resolve();
const MAIN_GAP_MS = 120;

function makeSlot(): Slot | null {
  if (workersBroken) return null;
  try {
    const worker = new Worker(new URL('../sim.worker.ts', import.meta.url), { type: 'module' });
    const slot: Slot = { worker, busy: null, fail: null };
    worker.onmessage = (e: MessageEvent<SimReply>) => {
      const cb = slot.busy;
      slot.busy = null;
      slot.fail = null;
      cb?.(e.data);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      if (!workersBroken) log.warn('rank', 'Worker 를 쓸 수 없어 화면 실에서 순위표를 계산해요');
      workersBroken = true;
      const fail = slot.fail;
      slot.busy = null;
      slot.fail = null;
      try { worker.terminate(); } catch { /* 이미 끝남 */ }
      fail?.(new Error('worker'));
    };
    return slot;
  } catch (err) {
    log.warn('rank', 'Worker 를 만들지 못해 화면 실에서 순위표를 계산해요', err);
    workersBroken = true;
    return null;
  }
}

function runOnMain(design: PlaneDesign, throwIn: ThrowInput): Promise<EvalResult> {
  const run = (): Promise<EvalResult> => new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        const t0 = performance.now();
        const r = simulate(buildGeometry(design), throwIn);
        if (performance.now() - t0 > EVAL_TIMEOUT_MS) reject(new Error('slow'));
        else resolve({ distanceM: r.distanceM, airtimeS: r.airtimeS, verdict: r.verdict });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }, MAIN_GAP_MS);
  });
  const p = mainChain.then(run, run);
  mainChain = p.catch(() => undefined);
  return p;
}

/** 순위표 계산에 쓸 일꾼 수: 기기의 코어가 넉넉하면 둘, 아니면 하나 */
export function workerCount(): number {
  try {
    return (navigator.hardwareConcurrency ?? 2) >= 4 ? 2 : 1;
  } catch {
    return 1;
  }
}

export const workerEvaluator: Evaluator = (design, throwIn): EvalJob => {
  const slot = idle.pop() ?? makeSlot();
  if (!slot) return { promise: runOnMain(design, throwIn), abort: () => undefined };
  let aborted = false;
  const promise = new Promise<EvalResult>((resolve, reject) => {
    slot.busy = (msg) => {
      idle.push(slot);
      if (msg.ok) resolve({ distanceM: msg.result.distanceM, airtimeS: msg.result.airtimeS, verdict: msg.result.verdict });
      else reject(new Error(msg.error));
    };
    // Worker 가 고장 나면 이 계산은 화면 실에서 이어서 한다.
    slot.fail = () => { if (!aborted) runOnMain(design, throwIn).then(resolve, reject); };
    const req: SimRequest = { id: nextId++, design, throwIn };
    try {
      slot.worker.postMessage(req);
    } catch (err) {
      slot.busy = null;
      slot.fail = null;
      try { slot.worker.terminate(); } catch { /* 이미 끝남 */ }
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
  return {
    promise,
    abort: () => {
      aborted = true;
      slot.busy = null;
      slot.fail = null;
      try { slot.worker.terminate(); } catch { /* 이미 끝남 */ }
    },
  };
};
