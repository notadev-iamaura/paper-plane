/**
 * 랭킹 저장소.
 * - MemoryStore: 메모리에만 둔다(테스트, 임시 실행용).
 * - FileStore: 같은 내용을 JSON 파일 하나에 적어 둔다. 시작할 때 읽고, 기록이 추가될 때마다
 *   임시 파일에 쓴 뒤 이름을 바꿔치기한다(쓰는 도중에 꺼져도 파일이 반쯤 쓰인 상태로 남지 않는다).
 *
 * 순위 규칙: 점수가 높은 순. 점수가 같으면 먼저 등록한 기록이 위.
 * 모드마다 가장 좋은 기록 maxPerMode 개만 남긴다.
 */
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LeaderboardEntry } from '../src/core/api';
import type { GameMode } from '../src/core/index';

export const MODES: readonly GameMode[] = ['distance', 'airtime'];
export const DEFAULT_MAX_PER_MODE = 5000;

export interface AddResult {
  /** 해당 모드에서의 순위(1 부터). 보관 한도 밖으로 밀려 저장되지 않았으면 한도 + 1. */
  rank: number;
  /** 보관 한도 안에 들어 저장되었는지 */
  stored: boolean;
}

export interface Store {
  /** 기록을 넣고 순위를 돌려준다. */
  add(entry: LeaderboardEntry): AddResult;
  /** 해당 모드의 상위 기록(점수 높은 순). 복사본을 돌려준다. */
  top(mode: GameMode, limit: number): LeaderboardEntry[];
  /** 코드, 모드, 닉네임이 모두 같은 기록이 이미 있으면 돌려준다. */
  findDuplicate(code: string, mode: GameMode, nickname: string): LeaderboardEntry | undefined;
  /** 해당 모드에 저장된 기록 수 */
  count(mode: GameMode): number;
}

const dupKey = (code: string, mode: string, nickname: string): string => `${mode}\n${nickname}\n${code}`;

/** a 가 b 보다 위 순위면 음수 */
function compareEntries(a: LeaderboardEntry, b: LeaderboardEntry): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export class MemoryStore implements Store {
  protected readonly lists: Record<GameMode, LeaderboardEntry[]> = { distance: [], airtime: [] };
  private readonly dup = new Map<string, LeaderboardEntry>();
  protected readonly maxPerMode: number;

  constructor(maxPerMode: number = DEFAULT_MAX_PER_MODE) {
    this.maxPerMode = Math.max(1, Math.floor(maxPerMode));
  }

  add(entry: LeaderboardEntry): AddResult {
    const list = this.lists[entry.mode];
    // 정렬된 목록에서 들어갈 자리를 이분 탐색으로 찾는다.
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compareEntries(list[mid]!, entry) <= 0) lo = mid + 1;
      else hi = mid;
    }
    if (lo >= this.maxPerMode) return { rank: this.maxPerMode + 1, stored: false };
    list.splice(lo, 0, entry);
    this.dup.set(dupKey(entry.code, entry.mode, entry.nickname), entry);
    while (list.length > this.maxPerMode) {
      const dropped = list.pop()!;
      this.dup.delete(dupKey(dropped.code, dropped.mode, dropped.nickname));
    }
    return { rank: lo + 1, stored: true };
  }

  top(mode: GameMode, limit: number): LeaderboardEntry[] {
    const n = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : this.maxPerMode;
    return this.lists[mode].slice(0, n).map((e) => ({ ...e }));
  }

  findDuplicate(code: string, mode: GameMode, nickname: string): LeaderboardEntry | undefined {
    const e = this.dup.get(dupKey(code, mode, nickname));
    return e ? { ...e } : undefined;
  }

  count(mode: GameMode): number {
    return this.lists[mode].length;
  }
}

const VERDICTS = ['glide', 'stall', 'dive', 'tumble', 'spiral', 'flutter'];

/** 파일에서 읽은 값이 기록 한 줄의 모양인지 확인한다(손상된 줄은 버린다). */
function isEntry(x: unknown): x is LeaderboardEntry {
  if (typeof x !== 'object' || x === null) return false;
  const e = x as Record<string, unknown>;
  const num = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
  return typeof e.id === 'string' && typeof e.nickname === 'string' && typeof e.code === 'string'
    && typeof e.createdAt === 'string' && (e.mode === 'distance' || e.mode === 'airtime')
    && num(e.score) && num(e.distanceM) && num(e.airtimeS)
    && typeof e.verdict === 'string' && VERDICTS.includes(e.verdict);
}

/**
 * 계산 규칙(물리 판)이 바뀌었을 때 파일의 옛 기록을 다시 재는 방법.
 * 저장소는 core 를 모른다. 서버(app.ts 의 remeasureEntry)가 "코드 -> 지금 규칙의 기록"을 넘겨준다.
 */
export interface Remeasure {
  /** 지금의 물리 판 번호. 파일에 같이 적어 둔다. */
  version: number;
  /** 저장된 기록을 그 코드로 다시 계산한다. 코드가 더는 규칙에 맞지 않으면 null (그 기록은 버린다). */
  recompute: (entry: LeaderboardEntry) => LeaderboardEntry | null;
}

export class FileStore extends MemoryStore {
  private readonly file: string;
  private readonly remeasure: Remeasure | undefined;
  /** 시작할 때 옛 판의 파일을 다시 쟀다면 그 결과(없으면 null) */
  readonly migrated: { from: number | null; to: number; kept: number; dropped: number } | null = null;

  /**
   * remeasure 를 주면 파일에 물리 판 번호를 같이 적고, 시작할 때 파일의 번호가 지금과 다르면(번호가 없는 옛 파일 포함)
   * 모든 기록을 코드로 다시 계산해서 싣는다. 옛 규칙의 점수와 새 규칙의 점수가 한 순위표에 섞이지 않게 하기 위해서다.
   * 주지 않으면 번호를 보지 않고 적힌 그대로 읽는다(시험, 임시 실행용).
   */
  constructor(file: string, maxPerMode: number = DEFAULT_MAX_PER_MODE, remeasure?: Remeasure) {
    super(maxPerMode);
    this.file = file;
    this.remeasure = remeasure;
    this.migrated = this.load();
  }

  private load(): FileStore['migrated'] {
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null; // 첫 실행
      throw err;
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      // 손상된 파일은 덮어쓰지 않고 옆에 보관한 뒤 빈 상태로 시작한다.
      const backup = `${this.file}.corrupt-${Date.now()}`;
      renameSync(this.file, backup);
      console.error(`[store] 랭킹 파일을 읽을 수 없어 ${backup} 로 옮기고 새로 시작합니다.`);
      return null;
    }
    const entries = (data as { entries?: unknown } | null)?.entries;
    if (!Array.isArray(entries)) return null;
    const rm = this.remeasure;
    const stored = (data as { physics?: unknown }).physics;
    const from = typeof stored === 'number' && Number.isFinite(stored) ? stored : null;
    const stale = rm !== undefined && from !== rm.version;
    let kept = 0, dropped = 0;
    for (const e of entries) {
      if (!isEntry(e)) continue;
      let entry: LeaderboardEntry | null = {
        id: e.id, nickname: e.nickname, mode: e.mode, score: e.score, distanceM: e.distanceM,
        airtimeS: e.airtimeS, verdict: e.verdict, code: e.code, createdAt: e.createdAt,
      };
      if (stale) {
        // 옛 규칙으로 잰 기록: 코드로 다시 계산한다. 더는 규칙에 맞지 않는 코드(예: 지금 한도보다 센 던지기)는 버린다.
        try { entry = rm.recompute(entry); } catch { entry = null; }
        if (entry === null || !isEntry(entry)) { dropped++; continue; }
        kept++;
      }
      super.add(entry);
    }
    if (!stale) return null;
    // 옛 파일은 옆에 보관하고, 다시 잰 기록을 새 판 번호와 함께 적는다(다음에 켤 때는 다시 재지 않는다).
    try {
      copyFileSync(this.file, `${this.file}.physics-${from ?? 'none'}`);
      this.save();
    } catch (err) {
      console.error('[store] 다시 잰 랭킹 파일 저장 실패:', err);
    }
    return { from, to: rm.version, kept, dropped };
  }

  private save(): void {
    const data = { v: 1, ...(this.remeasure ? { physics: this.remeasure.version } : {}), entries: [...this.lists.distance, ...this.lists.airtime] };
    const tmp = `${this.file}.${process.pid}.tmp`;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(tmp, JSON.stringify(data), 'utf8');
    renameSync(tmp, this.file);
  }

  override add(entry: LeaderboardEntry): AddResult {
    const res = super.add(entry);
    if (res.stored) {
      try {
        this.save();
      } catch (err) {
        // 디스크 문제로 저장에 실패해도 서비스는 계속한다(메모리에는 남아 있다).
        console.error('[store] 랭킹 파일 저장 실패:', err);
      }
    }
    return res;
  }
}
