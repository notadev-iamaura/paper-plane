/**
 * 비행 계산 실행기.
 * 먼저 Web Worker 로 계산해 보고, Worker 를 만들 수 없거나 응답이 없으면
 * 화면 실(main thread)에서 setTimeout 뒤에 계산한다. 어느 쪽이든 같은 core 코드라 결과는 같다.
 */
import { buildGeometry, simulate } from '../../core/index';
import type { PlaneDesign, SimResult, ThrowInput } from '../../core/index';
import { log } from './logger';
import type { SimReply, SimRequest } from './sim.worker';

export interface SimOutcome {
  result: SimResult;
  /** 계산에 걸린 시간(ms) */
  ms: number;
  via: 'worker' | 'main';
}

interface Pending {
  resolve: (o: SimOutcome) => void;
  reject: (e: Error) => void;
  design: PlaneDesign;
  throwIn: ThrowInput;
  timer: number;
}

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

/** Worker 응답을 기다리는 최대 시간. 넘으면 화면 실에서 직접 계산한다. */
const WORKER_TIMEOUT_MS = 5000;

function runOnMain(design: PlaneDesign, throwIn: ThrowInput): Promise<SimOutcome> {
  return new Promise((resolve, reject) => {
    // "계산 중" 표시가 먼저 그려지도록 한 박자 늦춘다.
    window.setTimeout(() => {
      try {
        const t0 = performance.now();
        const result = simulate(buildGeometry(design), throwIn);
        resolve({ result, ms: performance.now() - t0, via: 'main' });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }, 30);
  });
}

/** Worker 가 고장 났을 때: 기다리던 요청을 모두 화면 실에서 다시 계산한다. */
function failOver(reason: string): void {
  if (!workerBroken) log.warn('sim', `Worker 를 쓸 수 없어 화면 실에서 계산해요 (${reason})`);
  workerBroken = true;
  try { worker?.terminate(); } catch { /* 이미 끝났으면 무시 */ }
  worker = null;
  const waiting = Array.from(pending.values());
  pending.clear();
  for (const p of waiting) {
    window.clearTimeout(p.timer);
    runOnMain(p.design, p.throwIn).then(p.resolve, p.reject);
  }
}

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    const w = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<SimReply>) => {
      const msg = e.data;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      window.clearTimeout(p.timer);
      if (msg.ok) p.resolve({ result: msg.result, ms: msg.ms, via: 'worker' });
      else runOnMain(p.design, p.throwIn).then(p.resolve, p.reject);
    };
    w.onerror = (e) => {
      e.preventDefault();
      failOver('onerror');
    };
    worker = w;
    return w;
  } catch (err) {
    log.warn('sim', 'Worker 를 만들지 못했어요', err);
    workerBroken = true;
    return null;
  }
}

/** 비행 한 번을 계산한다. 화면을 막지 않는다. */
export function runSimulation(design: PlaneDesign, throwIn: ThrowInput): Promise<SimOutcome> {
  const w = getWorker();
  if (!w) return runOnMain(design, throwIn);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = window.setTimeout(() => failOver('timeout'), WORKER_TIMEOUT_MS);
    pending.set(id, { resolve, reject, design, throwIn, timer });
    const req: SimRequest = { id, design, throwIn };
    try {
      w.postMessage(req);
    } catch {
      failOver('postMessage');
    }
  });
}
