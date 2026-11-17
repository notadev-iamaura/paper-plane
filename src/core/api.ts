/**
 * 랭킹 서버와 화면이 주고받는 값의 규격 (타입만 있다. fetch 등 실행 코드는 넣지 않는다).
 *
 * 조작 방지 원칙: 화면은 "입력"(공유 코드 = 설계 + 던지기 값)만 보낸다.
 * 거리, 체공 시간, 점수는 서버가 같은 core 코드로 다시 계산해서 저장한다.
 * 화면이 결과 값을 같이 보내더라도 서버는 읽지 않는다.
 */
import type { FlightVerdict, GameMode } from './types';

/** POST /api/submit 의 본문 */
export interface SubmitRequest {
  /** `encodeDesign(design, throwIn)` 이 만든 공유 코드. 던지기 값이 반드시 들어 있어야 한다. */
  code: string;
  mode: GameMode;
  /** 1~16자. 서버가 앞뒤 공백과 제어 문자를 지운다. */
  nickname: string;
}

/** 랭킹 한 줄. 모든 수치는 서버가 계산한 값이다. */
export interface LeaderboardEntry {
  id: string;
  nickname: string;
  mode: GameMode;
  /** 순위를 정하는 값. distance 모드는 distanceM, airtime 모드는 airtimeS 와 같다. */
  score: number;
  distanceM: number;
  airtimeS: number;
  verdict: FlightVerdict;
  /** 이 기록을 만든 공유 코드. 화면에서 불러와 그대로 재현할 수 있다. */
  code: string;
  /** ISO 8601 (UTC) */
  createdAt: string;
}

/** POST /api/submit 성공 응답 (HTTP 200) */
export interface SubmitResponse {
  ok: true;
  entry: LeaderboardEntry;
  /** 해당 모드에서의 순위 (1 이 가장 높다) */
  rank: number;
  /** 해당 모드에 등록된 기록 수 */
  total: number;
  /** 같은 코드, 모드, 닉네임이 이미 등록되어 있어 기존 기록을 돌려준 경우 true */
  duplicate?: boolean;
}

/** GET /api/leaderboard?mode=distance|airtime&limit=50 성공 응답 (HTTP 200) */
export interface LeaderboardResponse {
  ok: true;
  mode: GameMode;
  entries: LeaderboardEntry[];
  total: number;
}

/** GET /api/health 응답 */
export interface HealthResponse {
  ok: true;
  coreVersion: number;
}

/** 모든 실패 응답 (HTTP 400, 404, 405, 408, 413, 503). errors 는 사용자에게 보여줄 수 있는 한국어 문장. */
export interface ApiError {
  ok: false;
  errors: string[];
}
