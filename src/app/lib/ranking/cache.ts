/**
 * 코드 -> 다시 계산한 값을 기억해 두는 곳. 계산 한 번이 0.2~0.4초쯤 걸리므로 같은 코드는 한 번만 계산한다.
 * - 메모리에 최대 300개(가장 오래 안 쓴 것부터 버린다).
 * - 브라우저 저장소에도 넣어 두어 다음 방문 때 다시 계산하지 않는다(저장소가 막혀 있으면 메모리만 쓴다).
 * - 열쇠는 코드 전체가 아니라 짧은 지문(hash)이다.
 * - 물리 계산이 바뀐 새 판에서 옛 값을 쓰지 않도록, 정해 둔 시험 코드 하나의 계산 결과(fingerprint)를 같이 적어 두고
 *   그것이 달라지면 저장해 둔 값을 모두 버린다.
 */
import type { FlightVerdict } from '../../../core/index';
import type { Verified } from './types';

export const CACHE_MAX = 300;
/** 시간이 너무 오래 걸려 건너뛴 코드를 다시 계산해 보기까지 기다리는 시간 */
export const SLOW_RETRY_MS = 24 * 3600 * 1000;

/** ok: 계산한 값 / bad: 규칙에 안 맞거나 계산 못 함 / slow: 제한 시간을 넘겨 건너뜀(at 에 건너뛴 시각) */
export type CacheVal =
  | { k: 'ok'; d: number; t: number; v: FlightVerdict; p: string }
  | { k: 'bad' }
  | { k: 'slow'; at: number };

const VERDICTS: readonly string[] = ['glide', 'stall', 'dive', 'tumble', 'spiral', 'flutter'];

/** 코드의 지문: 서로 다른 두 32비트 해시 + 길이. 암호용은 아니다(코드는 어차피 누구나 볼 수 있다). */
export function codeHash(code: string): string {
  let h1 = 0xdeadbeef ^ code.length;
  let h2 = 0x41c6ce57 ^ code.length;
  for (let i = 0; i < code.length; i++) {
    const ch = code.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h1 >>> 0).toString(36)}.${(h2 >>> 0).toString(36)}.${code.length.toString(36)}`;
}

export function toVerified(v: CacheVal): Verified | null {
  return v.k === 'ok' ? { distanceM: v.d, airtimeS: v.t, verdict: v.v, paperId: v.p } : null;
}

function reviveVal(x: unknown): CacheVal | null {
  if (typeof x !== 'object' || x === null) return null;
  const v = x as { k?: unknown; d?: unknown; t?: unknown; v?: unknown; p?: unknown; at?: unknown };
  if (v.k === 'bad') return { k: 'bad' };
  if (v.k === 'slow') return typeof v.at === 'number' && Number.isFinite(v.at) ? { k: 'slow', at: v.at } : null;
  if (v.k !== 'ok') return null;
  if (typeof v.d !== 'number' || typeof v.t !== 'number' || !Number.isFinite(v.d) || !Number.isFinite(v.t) || v.d < 0 || v.t < 0) return null;
  if (typeof v.v !== 'string' || !VERDICTS.includes(v.v) || typeof v.p !== 'string' || v.p.length > 40) return null;
  return { k: 'ok', d: v.d, t: v.t, v: v.v as FlightVerdict, p: v.p };
}

export interface CacheStorage {
  load: () => unknown;
  save: (value: unknown) => void;
}

interface Saved { v: 1; fp: string; items: [string, CacheVal][] }

export class ResultCache {
  private map = new Map<string, CacheVal>();
  private fingerprint = '';
  /** 저장소에서 읽어 왔지만 아직 믿어도 되는지 확인하지 않은 값 */
  private held: { fp: string; items: [string, CacheVal][] } | null = null;
  private dirty = false;

  constructor(private readonly max: number = CACHE_MAX, private readonly storage: CacheStorage | null = null) {
    if (!storage) return;
    try {
      const raw = storage.load() as Partial<Saved> | null;
      if (raw && raw.v === 1 && typeof raw.fp === 'string' && Array.isArray(raw.items)) {
        const items: [string, CacheVal][] = [];
        for (const it of raw.items.slice(-max)) {
          if (!Array.isArray(it) || typeof it[0] !== 'string' || it[0].length > 40) continue;
          const val = reviveVal(it[1]);
          if (val) items.push([it[0], val]);
        }
        this.held = { fp: raw.fp, items };
      }
    } catch {
      this.held = null;
    }
  }

  /**
   * 지금 판의 계산 지문을 알려 준다. 저장해 둔 값의 지문과 같으면 그 값을 받아들이고, 다르면 버린다.
   * 받아들인 개수를 돌려준다.
   */
  adopt(fingerprint: string): number {
    this.fingerprint = fingerprint;
    const held = this.held;
    this.held = null;
    if (!held || held.fp !== fingerprint) {
      if (held) this.dirty = true;
      return 0;
    }
    // 이번 방문에 이미 계산한 값이 더 새것이므로 저장돼 있던 값은 그 앞(더 오래된 쪽)에 둔다.
    const fresh = this.map;
    this.map = new Map();
    for (const [h, v] of held.items) if (!fresh.has(h)) this.map.set(h, v);
    for (const [h, v] of fresh) this.map.set(h, v);
    this.trim();
    return held.items.length;
  }

  get size(): number {
    return this.map.size;
  }

  /** 기억해 둔 값. 꺼내면 "방금 쓴 것"이 된다. 오래된 slow 표시는 없는 것으로 친다. */
  get(code: string, now: number = Date.now()): CacheVal | undefined {
    const h = codeHash(code);
    const v = this.map.get(h);
    if (v === undefined) return undefined;
    if (v.k === 'slow' && now - v.at > SLOW_RETRY_MS) {
      this.map.delete(h);
      this.dirty = true;
      return undefined;
    }
    this.map.delete(h);
    this.map.set(h, v);
    return v;
  }

  set(code: string, val: CacheVal): void {
    const h = codeHash(code);
    this.map.delete(h);
    this.map.set(h, val);
    this.trim();
    this.dirty = true;
  }

  private trim(): void {
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  /** 바뀐 것이 있으면 저장소에 적는다. 지문을 알기 전에는 적지 않는다. */
  flush(): void {
    if (!this.dirty || !this.storage || this.fingerprint === '') return;
    this.dirty = false;
    const saved: Saved = { v: 1, fp: this.fingerprint, items: Array.from(this.map.entries()) };
    try {
      this.storage.save(saved);
    } catch {
      /* 저장소가 막혀 있으면 메모리만 쓴다 */
    }
  }
}
