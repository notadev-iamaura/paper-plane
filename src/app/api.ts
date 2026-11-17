/**
 * 랭킹 서버와 통신하는 부분.
 * 주소는 빌드할 때 VITE_API_URL 로 정한다. 비어 있으면 랭킹 기능 전체를 숨긴다(외부 요청을 전혀 하지 않는다).
 * 조작 방지: 화면은 공유 코드(설계 + 던지기 값), 모드, 닉네임만 보낸다. 점수는 서버가 다시 계산한다.
 */
import type { GameMode } from '../core/index';
import type { ApiError, LeaderboardEntry, LeaderboardResponse, SubmitRequest, SubmitResponse } from '../core/api';
import { log } from './lib/logger';

export type { LeaderboardEntry, SubmitResponse };

const rawBase: unknown = import.meta.env.VITE_API_URL;
/** 랭킹 서버 주소(끝의 / 제거). 설정되지 않았으면 빈 글자열. */
export const API_BASE: string = typeof rawBase === 'string' ? rawBase.trim().replace(/\/+$/, '') : '';
export const RANKING_ENABLED: boolean = API_BASE.length > 0;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; errors: string[] };

const TIMEOUT_MS = 8000;
const NETWORK_ERROR = '랭킹 서버에 연결하지 못했어요. 잠시 뒤에 다시 시도해 주세요.';
const BAD_REPLY = '랭킹 서버의 응답을 이해하지 못했어요.';

async function request(path: string, init?: RequestInit): Promise<ApiResult<unknown>> {
  if (!RANKING_ENABLED) return { ok: false, errors: ['이 빌드에는 온라인 랭킹이 연결되어 있지 않아요.'] };
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = performance.now();
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...init, signal: ctrl.signal });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    log.info('api', `${init?.method ?? 'GET'} ${path} -> ${res.status}`, { ms: Math.round(performance.now() - t0) });
    if (typeof body !== 'object' || body === null) return { ok: false, errors: [BAD_REPLY] };
    const b = body as { ok?: unknown; errors?: unknown };
    if (b.ok === true) return { ok: true, data: body };
    const errs = Array.isArray((b as ApiError).errors)
      ? (b as ApiError).errors.filter((e): e is string => typeof e === 'string').slice(0, 5)
      : [];
    return { ok: false, errors: errs.length > 0 ? errs : ['랭킹 서버가 요청을 받아들이지 않았어요.'] };
  } catch (err) {
    log.warn('api', `${init?.method ?? 'GET'} ${path} 실패`, err);
    return { ok: false, errors: [NETWORK_ERROR] };
  } finally {
    window.clearTimeout(timer);
  }
}

/** 기록 등록. 보내는 값은 code, mode, nickname 뿐이다. */
export async function submitScore(code: string, mode: GameMode, nickname: string): Promise<ApiResult<SubmitResponse>> {
  const payload: SubmitRequest = { code, mode, nickname };
  const r = await request('/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) return r;
  const d = r.data as Partial<SubmitResponse>;
  if (typeof d.entry !== 'object' || d.entry === null || typeof d.entry.score !== 'number') {
    return { ok: false, errors: [BAD_REPLY] };
  }
  return { ok: true, data: d as SubmitResponse };
}

/** 모드별 순위표 */
export async function fetchLeaderboard(mode: GameMode, limit = 20): Promise<ApiResult<LeaderboardEntry[]>> {
  const r = await request(`/api/leaderboard?mode=${encodeURIComponent(mode)}&limit=${limit}`);
  if (!r.ok) return r;
  const d = r.data as Partial<LeaderboardResponse>;
  if (!Array.isArray(d.entries)) return { ok: false, errors: [BAD_REPLY] };
  const entries = d.entries.filter(
    (e): e is LeaderboardEntry => typeof e === 'object' && e !== null && typeof e.score === 'number' && typeof e.nickname === 'string',
  );
  return { ok: true, data: entries };
}
