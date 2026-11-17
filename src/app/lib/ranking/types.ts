/**
 * 순위표(온라인 랭킹)의 공통 타입.
 *
 * 순위표는 두 가지 길 가운데 하나로 움직인다(select.ts 가 고른다).
 *   - http   : VITE_API_URL 로 정한 랭킹 서버. 점수는 서버가 코드로 다시 계산한다(예전 그대로).
 *   - pagedb : 게시된 페이지가 받는 함께 쓰는 저장소(window.claude.use("db")). 서버가 없으므로
 *              저장소에는 "코드"만 두고, 점수는 보는 사람의 기기가 저마다 코드로 다시 계산한다.
 * 어느 길이든 화면이 계산한 점수를 보내거나 저장하지 않는다.
 */
import type { FlightVerdict, GameMode } from '../../../core/index';

export type RankMode = GameMode;
export const RANK_MODES: readonly RankMode[] = ['distance', 'airtime'];

/** 저장소에 두는 한 종목의 기록. 점수는 없다. */
export interface RankEntry {
  /** encodeDesign(design, throwIn) 이 만든 코드(접은 모양 + 던지기 값) */
  code: string;
  /** 놀이에서 직접 적은 별명(계정 이름이 아니다) */
  nickname: string;
  /** 올린 시각(ms). 올린 기기가 적은 값이라 동점일 때만 쓴다. */
  at: number;
}

/** 문서 scores/<내 id> 의 모양. 한 사람에 문서 하나, 종목마다 가장 좋은 기록 하나. */
export interface ScoreDoc {
  v: 1;
  distance?: RankEntry;
  airtime?: RankEntry;
}

/** 코드 하나를 다시 계산해 얻은 공식 값 */
export interface Verified {
  distanceM: number;
  airtimeS: number;
  verdict: FlightVerdict;
  paperId: string;
}

/** 순위표 한 줄 */
export interface RankRow {
  /** pagedb: 올린 사람의 id(문서 이름). http: 서버가 붙인 기록 id */
  id: string;
  rank: number;
  nickname: string;
  code: string;
  at: number;
  mode: RankMode;
  /** 순위를 정하는 공식 값(멀리: m, 오래: 초) */
  score: number;
  distanceM: number;
  airtimeS: number;
  verdict: FlightVerdict;
  paperId: string | null;
  mine: boolean;
}

export interface BoardView {
  /** 위에서부터 보여 줄 줄(최대 50) */
  rows: RankRow[];
  /** 순위가 매겨진 기록 수 */
  total: number;
  /** 아직 계산 중인 기록 수 */
  pending: number;
  /** 내 줄(순위 밖이어도 들어 있다). 없으면 null */
  mine: RankRow | null;
  /** 내 기록이 저장소에는 있는데 아직 계산 중인지 */
  minePending: boolean;
}

/**
 * idle 아직 안 켬 / loading 가져오는 중 / ready 받음 / stalled 10초가 지나도 소식이 없음 /
 * error 실패(다시 해 볼 수 있다) / closed 이번 방문에는 더 쓸 수 없음
 */
export type BoardStatus = 'idle' | 'loading' | 'ready' | 'stalled' | 'error' | 'closed';

/** yes 올릴 수 있다 / readonly 구경만 / no-id 누구인지 몰라 올릴 수 없다 */
export type WriteState = 'yes' | 'readonly' | 'no-id';

export interface RankingState {
  status: BoardStatus;
  /** error 일 때 보여 줄 말(여러 줄일 수 있다) */
  errors: string[];
  boards: Record<RankMode, BoardView>;
  write: WriteState;
}

export type SubmitOutcome =
  | { ok: true; score: number; rank: number | null; total: number | null; duplicate?: boolean }
  /** 이미 올린 기록이 더 좋아서 그대로 두었다 */
  | { ok: false; reason: 'not-better'; existingScore: number; existingNickname: string }
  | { ok: false; reason: 'nickname' | 'invalid' | 'readonly' | 'no-id' | 'busy' | 'full' | 'offline' | 'closed' | 'error'; errors?: string[] };

export type RemoveOutcome =
  | { ok: true }
  | { ok: false; reason: 'readonly' | 'no-id' | 'nothing' | 'offline' | 'closed' | 'error' };

export interface RankingBackend {
  readonly kind: 'http' | 'pagedb';
  /** 남이 올리면 저절로 바뀌는지(아니면 "새로 보기" 단추를 보여 준다) */
  readonly live: boolean;
  /** 내 기록을 지울 수 있는지 */
  readonly canRemove: boolean;
  /** 순위표를 켠다(여러 번 불러도 한 번만 켜진다). */
  start(): void;
  /** 이 종목을 보려고 한다(http 는 이때 서버에 묻는다). */
  watch(mode: RankMode): void;
  /** 다시 가져온다(사람이 단추를 눌렀을 때만 부른다). */
  retry(mode: RankMode): void;
  getState(): RankingState;
  subscribe(fn: () => void): () => void;
  submit(mode: RankMode, code: string, nickname: string): Promise<SubmitOutcome>;
  remove(mode: RankMode): Promise<RemoveOutcome>;
}

export const EMPTY_BOARD: BoardView = { rows: [], total: 0, pending: 0, mine: null, minePending: false };

/** 한 번에 읽는 문서 수, 보여 주는 줄 수 */
export const DOC_LIMIT = 200;
export const TOP_N = 50;
