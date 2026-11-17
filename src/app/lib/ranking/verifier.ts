/**
 * 코드 검증기: 코드를 풀어 규칙을 검사하고, 계산기(evaluator)에게 맡겨 공식 값을 얻는다.
 * - 한 번에 몇 개씩만 계산한다(concurrency). 나머지는 줄을 선다.
 * - 계산 하나가 제한 시간(기본 3초)을 넘기면 그만두고(abort) 그 코드를 건너뛴 것으로 기억한다.
 *   일부러 계산이 오래 걸리게 만든 기록이 순위표를 멈추게 하지 못하게 하려는 것이다.
 * - 결과는 ResultCache 에 넣는다. 이미 있는 코드는 다시 계산하지 않는다.
 * 계산기는 바깥에서 넣어 준다(브라우저: Worker, 검사: 흉내 계산기).
 */
import type { PlaneDesign, ThrowInput, FlightVerdict } from '../../../core/index';
import { checkCode, isSaneResult, scoreKey } from './board';
import type { CacheVal, ResultCache } from './cache';

export interface EvalResult { distanceM: number; airtimeS: number; verdict: FlightVerdict }
export interface EvalJob {
  promise: Promise<EvalResult>;
  /** 계산을 그만둔다(제한 시간을 넘겼을 때 부른다). */
  abort: () => void;
}
export type Evaluator = (design: PlaneDesign, throwIn: ThrowInput) => EvalJob;

export const EVAL_TIMEOUT_MS = 3000;

export interface VerifierStats {
  /** 계산기에 맡긴 횟수 */
  evaluated: number;
  /** 기억해 둔 값으로 넘어간 횟수 */
  cacheHits: number;
  /** 규칙에 안 맞거나 계산하지 못해 건너뛴 코드 수 */
  invalid: number;
  /** 제한 시간을 넘겨 건너뛴 코드 수 */
  timeouts: number;
}

interface Options {
  evaluator: Evaluator;
  cache: ResultCache;
  timeoutMs?: number;
  concurrency?: number;
  /** 코드 하나가 끝날 때마다 불린다. */
  onSettled?: (code: string) => void;
  now?: () => number;
  /** true 면 warmUp 이 끝날 때까지 줄을 움직이지 않는다(저장해 둔 값을 믿을지 정한 뒤에 계산을 시작한다). */
  waitForWarmUp?: boolean;
}

interface Waiting { code: string; resolvers: ((v: CacheVal) => void)[] }

export class Verifier {
  readonly stats: VerifierStats = { evaluated: 0, cacheHits: 0, invalid: 0, timeouts: 0 };
  private readonly evaluator: Evaluator;
  private readonly cache: ResultCache;
  private readonly timeoutMs: number;
  private readonly concurrency: number;
  /** 코드 하나가 끝날 때마다 불린다(순위표가 다시 세도록). */
  onSettled: (code: string) => void;
  private readonly now: () => number;
  private queue: Waiting[] = [];
  private byCode = new Map<string, Waiting>();
  private running = 0;
  /** 준비(시험 코드 계산)가 끝나기 전에는 줄을 움직이지 않는다. */
  private held = false;

  constructor(o: Options) {
    this.evaluator = o.evaluator;
    this.cache = o.cache;
    this.timeoutMs = o.timeoutMs ?? EVAL_TIMEOUT_MS;
    this.concurrency = Math.max(1, o.concurrency ?? 1);
    this.onSettled = o.onSettled ?? (() => undefined);
    this.now = o.now ?? (() => Date.now());
    this.held = o.waitForWarmUp === true;
  }

  /** 줄 서 있거나 계산 중인 코드 수 */
  get pending(): number {
    return this.byCode.size;
  }

  /**
   * 정해 둔 시험 코드를 계산해 "지금 판의 계산 지문"을 얻고, 저장해 둔 값을 믿어도 되는지 정한다.
   * 이것이 끝날 때까지 다른 코드는 줄에서 기다린다.
   */
  async warmUp(canaryCode: string): Promise<void> {
    this.held = true;
    let fp = '';
    try {
      const input = checkCode(canaryCode);
      if (input) {
        const r = await this.runOne(input.design, input.throwIn);
        if (r.k === 'ok') fp = `${scoreKey(r.d)}:${scoreKey(r.t)}:${r.v}`;
      }
    } catch {
      fp = '';
    }
    this.cache.adopt(fp);
    this.held = false;
    this.pump();
  }

  /** 기억해 둔 결과(없으면 undefined). 계산을 시키지는 않는다. */
  peek(code: string): CacheVal | undefined {
    if (this.held) return undefined;
    return this.cache.get(code, this.now());
  }

  /** 코드의 결과를 얻는다. 기억해 둔 값이 있으면 바로, 없으면 줄을 세워 계산한다. front 면 줄의 맨 앞에 세운다. */
  verify(code: string, front = false): Promise<CacheVal> {
    if (!this.held) {
      const hit = this.cache.get(code, this.now());
      if (hit) {
        this.stats.cacheHits++;
        return Promise.resolve(hit);
      }
    }
    return new Promise((resolve) => {
      const waiting = this.byCode.get(code);
      if (waiting) {
        waiting.resolvers.push(resolve);
        if (front) {
          const i = this.queue.indexOf(waiting);
          if (i > 0) {
            this.queue.splice(i, 1);
            this.queue.unshift(waiting);
          }
        }
        return;
      }
      const w: Waiting = { code, resolvers: [resolve] };
      this.byCode.set(code, w);
      if (front) this.queue.unshift(w);
      else this.queue.push(w);
      this.pump();
    });
  }

  /** verify 와 같지만 결과를 기다리지 않는다. */
  request(code: string, front = false): void {
    void this.verify(code, front);
  }

  private pump(): void {
    while (!this.held && this.running < this.concurrency && this.queue.length > 0) {
      const w = this.queue.shift()!;
      this.running++;
      void this.process(w);
    }
  }

  private async process(w: Waiting): Promise<void> {
    let val: CacheVal;
    try {
      // 준비 중에 줄을 선 코드는 그사이 기억해 둔 값이 생겼을 수 있다.
      const hit = this.cache.get(w.code, this.now());
      if (hit) {
        this.stats.cacheHits++;
        val = hit;
      } else {
        const input = checkCode(w.code);
        if (!input) {
          val = { k: 'bad' };
        } else {
          val = await this.runOne(input.design, input.throwIn, input.design.paperId);
        }
        if (val.k === 'bad') this.stats.invalid++;
        if (val.k === 'slow') this.stats.timeouts++;
        this.cache.set(w.code, val);
      }
    } catch {
      val = { k: 'bad' };
      this.stats.invalid++;
    }
    this.running--;
    this.byCode.delete(w.code);
    for (const r of w.resolvers) r(val);
    try { this.onSettled(w.code); } catch { /* 알림을 받는 쪽의 오류로 줄이 멈추면 안 된다 */ }
    this.pump();
  }

  /** 계산기에 한 번 맡긴다. 제한 시간을 넘기면 그만두게 하고 slow 를 돌려준다. */
  private runOne(design: PlaneDesign, throwIn: ThrowInput, paperId: string = design.paperId): Promise<CacheVal> {
    this.stats.evaluated++;
    return new Promise<CacheVal>((resolve) => {
      let done = false;
      let job: EvalJob;
      const finish = (v: CacheVal): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      };
      const timer = setTimeout(() => {
        if (done) return;
        try { job?.abort(); } catch { /* 이미 끝났으면 무시 */ }
        finish({ k: 'slow', at: this.now() });
      }, this.timeoutMs);
      try {
        job = this.evaluator(design, throwIn);
      } catch {
        finish({ k: 'bad' });
        return;
      }
      job.promise.then(
        (r) => finish(isSaneResult(r) ? { k: 'ok', d: r.distanceM, t: r.airtimeS, v: r.verdict, p: paperId } : { k: 'bad' }),
        (err: unknown) => finish(err instanceof Error && err.message === 'slow' ? { k: 'slow', at: this.now() } : { k: 'bad' }),
      );
    });
  }
}
