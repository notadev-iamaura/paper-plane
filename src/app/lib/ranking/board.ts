/**
 * 순위표의 순수한 부분: 저장소에서 온 값을 믿지 않고 읽기, 순서 매기기, 저장할 문서 만들기.
 * 화면(DOM)이나 저장소에 기대지 않으므로 Node 에서 그대로 검사한다(tests/ranking.test.ts).
 *
 * 조작 방지의 뼈대: 저장소의 문서에는 점수가 없다. 문서에 점수처럼 보이는 값이 섞여 있어도 읽지 않는다.
 * 순위는 오직 "코드를 풀어 -> 규칙 검사 -> 같은 core 로 다시 계산"한 값으로만 매긴다.
 */
import { decodeDesign, validateSubmission } from '../../../core/index';
import type { PlaneDesign, ThrowInput } from '../../../core/index';
import type { BoardView, RankEntry, RankMode, RankRow, ScoreDoc, Verified } from './types';
import { TOP_N } from './types';

export const NICK_MAX = 16;
/** 코드의 최대 길이(core 의 codec 과 같은 값). 이보다 길면 풀어 보지도 않는다. */
export const CODE_MAX = 420;
/** 이보다 이른 시각은 믿지 않는다(2026-01-01 UTC). */
const AT_MIN = Date.UTC(2026, 0, 1);
/** 지금보다 이만큼 넘게 앞선 시각은 믿지 않는다. */
const AT_FUTURE_SLACK = 24 * 3600 * 1000;
/** 믿을 수 없는 시각은 동점 다툼에서 맨 뒤로 보낸다. */
export const AT_LAST = Number.MAX_SAFE_INTEGER;

/** 별명: 제어 문자를 지우고 앞뒤 공백을 뗀다. 1~16자가 아니면 null. (서버의 cleanNickname 과 같은 규칙) */
export function sanitizeNickname(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 256) return null;
  let s = '';
  for (const ch of raw.normalize('NFC')) {
    const c = ch.codePointAt(0)!;
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) continue;
    if (c >= 0xd800 && c <= 0xdfff) continue; // 짝이 맞지 않는 대리 문자
    if (c === 0x200b || c === 0x200e || c === 0x200f || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff) continue; // 보이지 않는 방향 바꿈 문자
    s += ch;
  }
  s = s.trim();
  const length = Array.from(s).length;
  if (length < 1 || length > NICK_MAX) return null;
  return s;
}

/** 저장소 경로의 한 마디로 쓸 수 있는 id 인지(영문자, 숫자, _ - . ~ : @ +) */
export function isDocId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_\-.~:@+]{1,128}$/.test(id) && id !== '.' && id !== '..';
}

/** 저장소에서 온 한 종목 기록을 읽는다. 모양이 맞지 않으면 null. code, nickname, at 말고는 아무것도 읽지 않는다. */
export function parseEntry(x: unknown, now: number): RankEntry | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const e = x as { code?: unknown; nickname?: unknown; at?: unknown };
  if (typeof e.code !== 'string' || e.code.length < 3 || e.code.length > CODE_MAX || !/^[0-9A-Za-z]+$/.test(e.code)) return null;
  const nickname = sanitizeNickname(e.nickname);
  if (nickname === null) return null;
  const at = typeof e.at === 'number' && Number.isFinite(e.at) && e.at >= AT_MIN && e.at <= now + AT_FUTURE_SLACK ? Math.floor(e.at) : AT_LAST;
  return { code: e.code, nickname, at };
}

/** 저장소에서 온 문서를 읽는다. 쓸 만한 기록이 하나도 없으면 null. 점수처럼 보이는 값은 어디에 있든 버린다. */
export function parseScoreDoc(data: unknown, now: number): ScoreDoc | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const d = data as { v?: unknown; distance?: unknown; airtime?: unknown };
  if (d.v !== 1) return null;
  const out: ScoreDoc = { v: 1 };
  const distance = parseEntry(d.distance, now);
  const airtime = parseEntry(d.airtime, now);
  if (distance) out.distance = distance;
  if (airtime) out.airtime = airtime;
  return distance || airtime ? out : null;
}

/** 코드를 풀어 규칙에 맞는지 본다. 던지기 값이 없거나 범위를 벗어나면 null. (예외를 던지지 않는다) */
export function checkCode(code: unknown): { design: PlaneDesign; throwIn: ThrowInput } | null {
  try {
    if (typeof code !== 'string' || code.length > CODE_MAX) return null;
    const dec = decodeDesign(code);
    if (!dec || !dec.throwIn) return null;
    if (!validateSubmission(dec.design, dec.throwIn).ok) return null;
    return { design: dec.design, throwIn: dec.throwIn };
  } catch {
    return null;
  }
}

/** 순위를 견줄 때 쓰는 값: 0.001 단위로 반올림한 정수. 기기마다 생길 수 있는 아주 작은 계산 차이를 지운다. */
export function scoreKey(v: number): number {
  return Math.round(v * 1000);
}

export function officialScore(mode: RankMode, v: Pick<Verified, 'distanceM' | 'airtimeS'>): number {
  return mode === 'distance' ? v.distanceM : v.airtimeS;
}

/** 다시 계산한 값이 순위에 올릴 만한 숫자인지 */
export function isSaneResult(v: { distanceM: unknown; airtimeS: unknown }): boolean {
  return typeof v.distanceM === 'number' && typeof v.airtimeS === 'number'
    && Number.isFinite(v.distanceM) && Number.isFinite(v.airtimeS)
    && v.distanceM >= 0 && v.airtimeS >= 0 && v.distanceM < 1e4 && v.airtimeS < 1e4;
}

/** 순서: 점수(0.001 반올림) 높은 순 -> 먼저 올린 순 -> id 순 */
export function compareRows(a: Pick<RankRow, 'score' | 'at' | 'id'>, b: Pick<RankRow, 'score' | 'at' | 'id'>): number {
  const ka = scoreKey(a.score), kb = scoreKey(b.score);
  if (ka !== kb) return kb - ka;
  if (a.at !== b.at) return a.at - b.at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 새 기록이 이미 올린 기록보다 좋을 때만 true (같으면 그대로 둔다) */
export function isBetter(newScore: number, existingScore: number | null): boolean {
  if (existingScore === null) return true;
  return scoreKey(newScore) > scoreKey(existingScore);
}

/** 코드 하나의 계산 결과를 알려 주는 함수: 값, 'bad'(규칙에 안 맞거나 계산 못 함), undefined(아직 계산 중) */
export type Lookup = (code: string) => Verified | 'bad' | undefined;

/** 문서 묶음과 계산 결과로 한 종목의 순위표를 만든다. */
export function buildBoard(mode: RankMode, docs: ReadonlyMap<string, ScoreDoc>, lookup: Lookup, myId: string | null, topN: number = TOP_N): BoardView {
  const rows: RankRow[] = [];
  let pending = 0;
  let minePending = false;
  for (const [id, doc] of docs) {
    const e = doc[mode];
    if (!e) continue;
    const v = lookup(e.code);
    if (v === undefined) {
      pending++;
      if (id === myId) minePending = true;
      continue;
    }
    if (v === 'bad' || !isSaneResult(v)) continue;
    rows.push({
      id, rank: 0, nickname: e.nickname, code: e.code, at: e.at, mode,
      score: officialScore(mode, v), distanceM: v.distanceM, airtimeS: v.airtimeS, verdict: v.verdict, paperId: v.paperId,
      mine: id === myId,
    });
  }
  rows.sort(compareRows);
  rows.forEach((r, i) => { r.rank = i + 1; });
  const mine = rows.find((r) => r.mine) ?? null;
  return { rows: rows.slice(0, topN), total: rows.length, pending, mine, minePending };
}

/** 한 종목 기록을 저장할 모양으로 다듬는다(세 값만 남긴다). */
function cleanEntry(e: RankEntry): RankEntry {
  return { code: e.code, nickname: e.nickname, at: e.at === AT_LAST ? 0 : e.at };
}

/** 내 문서에 한 종목 기록을 넣은 새 문서(다른 종목 기록은 그대로 둔다). 점수는 넣지 않는다. */
export function docAfterSubmit(current: ScoreDoc | null, mode: RankMode, entry: RankEntry): ScoreDoc {
  const out: ScoreDoc = { v: 1 };
  const other: RankMode = mode === 'distance' ? 'airtime' : 'distance';
  const keep = current?.[other];
  if (keep) out[other] = cleanEntry(keep);
  out[mode] = cleanEntry(entry);
  return out;
}

/** 내 문서에서 한 종목 기록을 뺀 새 문서. 남는 기록이 없으면 null(문서를 지운다). */
export function docAfterRemove(current: ScoreDoc | null, mode: RankMode): ScoreDoc | null {
  const other: RankMode = mode === 'distance' ? 'airtime' : 'distance';
  const keep = current?.[other];
  if (!keep) return null;
  const out: ScoreDoc = { v: 1 };
  out[other] = cleanEntry(keep);
  return out;
}
