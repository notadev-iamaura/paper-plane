/**
 * 랭킹 서버(VITE_API_URL)로 움직이는 순위표. 예전부터 있던 길 그대로다(src/app/api.ts 를 감싼 것).
 * 보내는 값은 코드, 종목, 별명뿐이고 점수는 서버가 코드로 다시 계산한다. 화면은 서버가 준 값을 보여 주기만 한다.
 */
import { decodeDesign } from '../../../core/index';
import { fetchLeaderboard, submitScore } from '../../api';
import type { LeaderboardEntry } from '../../api';
import { log } from '../logger';
import { loadJson, saveJson } from '../storage';
import { sanitizeNickname } from './board';
import type { BoardStatus, BoardView, RankingBackend, RankingState, RankMode, RankRow, SubmitOutcome } from './types';
import { EMPTY_BOARD, TOP_N } from './types';

const MINE_KEY = 'pp.rank.mine.v1';
const MINE_MAX = 40;

function paperOf(code: string): string | null {
  try {
    return decodeDesign(code)?.design.paperId ?? null;
  } catch {
    return null;
  }
}

export function createHttpBackend(): RankingBackend {
  let status: BoardStatus = 'idle';
  let errors: string[] = [];
  const entries: Record<RankMode, LeaderboardEntry[] | null> = { distance: null, airtime: null };
  const savedMine = loadJson(MINE_KEY);
  /** 이 기기에서 올린 기록의 id(서버는 누가 올렸는지 모르므로 "나" 표시는 이 기기에서만 안다) */
  const mineIds: string[] = Array.isArray(savedMine) ? savedMine.filter((x): x is string => typeof x === 'string').slice(-MINE_MAX) : [];
  const listeners = new Set<() => void>();
  let state: RankingState;
  let ticket = 0;

  function view(mode: RankMode): BoardView {
    const list = entries[mode];
    if (!list) return EMPTY_BOARD;
    const rows: RankRow[] = list.slice(0, TOP_N).map((e, i) => ({
      id: String(e.id), rank: i + 1, nickname: String(e.nickname), code: String(e.code), at: Date.parse(e.createdAt) || 0, mode,
      score: e.score, distanceM: e.distanceM, airtimeS: e.airtimeS, verdict: e.verdict, paperId: paperOf(String(e.code)),
      mine: mineIds.includes(String(e.id)),
    }));
    return { rows, total: rows.length, pending: 0, mine: rows.find((r) => r.mine) ?? null, minePending: false };
  }
  function emit(): void {
    state = { status, errors, write: 'yes', boards: { distance: view('distance'), airtime: view('airtime') } };
    for (const fn of [...listeners]) fn();
  }
  state = { status, errors, write: 'yes', boards: { distance: EMPTY_BOARD, airtime: EMPTY_BOARD } };

  function load(mode: RankMode): void {
    const mine = ++ticket;
    status = 'loading';
    errors = [];
    emit();
    void fetchLeaderboard(mode, TOP_N).then((r) => {
      if (mine !== ticket) return; // 그사이 다른 종목을 보러 갔으면 늦게 온 답은 버린다.
      if (r.ok) {
        entries[mode] = r.data;
        status = 'ready';
      } else {
        entries[mode] = null;
        status = 'error';
        errors = r.errors;
      }
      emit();
    });
  }

  return {
    kind: 'http',
    live: false,
    canRemove: false,
    start(): void { /* 종목을 볼 때(watch) 가져온다 */ },
    watch: load,
    retry: load,
    getState: () => state,
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    async submit(mode: RankMode, code: string, rawNickname: string): Promise<SubmitOutcome> {
      const nickname = sanitizeNickname(rawNickname);
      if (nickname === null) return { ok: false, reason: 'nickname' };
      const r = await submitScore(code, mode, nickname);
      if (!r.ok) return { ok: false, reason: 'error', errors: r.errors };
      const id = String(r.data.entry.id);
      if (!mineIds.includes(id)) {
        mineIds.push(id);
        while (mineIds.length > MINE_MAX) mineIds.shift();
        saveJson(MINE_KEY, mineIds);
      }
      log.info('rank', '랭킹 서버에 기록을 올렸어요', { mode, rank: r.data.rank, total: r.data.total });
      load(mode);
      return { ok: true, score: r.data.entry.score, rank: r.data.rank, total: r.data.total, duplicate: r.data.duplicate === true };
    },
    remove: () => Promise.resolve({ ok: false, reason: 'error' as const }),
  };
}
