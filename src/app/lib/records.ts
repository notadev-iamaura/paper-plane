/**
 * 내 기록: 가장 멀리 간 거리, 가장 오래 뜬 시간, 최근 10번의 비행.
 * 저장소(localStorage)에 넣지만, 저장소가 막혀 있어도 이번 방문 동안은 메모리에서 동작한다.
 */
import type { FlightVerdict, GameMode } from '../../core/index';
import { loadJson, saveJson, STORAGE_KEYS } from './storage';

export interface FlightRecord {
  /** 설계 + 던지기 값이 들어 있는 공유 코드. 이것만 있으면 똑같이 재현할 수 있다. */
  code: string;
  mode: GameMode;
  distanceM: number;
  airtimeS: number;
  verdict: FlightVerdict;
  /** 기록 시각(ms) */
  at: number;
}

export interface Records {
  bestDistance: FlightRecord | null;
  bestAirtime: FlightRecord | null;
  /** 최근 것이 앞 */
  recent: FlightRecord[];
}

const RECENT_MAX = 10;
const VERDICTS: readonly string[] = ['glide', 'stall', 'dive', 'tumble', 'spiral', 'flutter'];

function reviveRecord(x: unknown): FlightRecord | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Partial<FlightRecord>;
  if (typeof r.code !== 'string' || r.code.length > 500) return null;
  if (typeof r.distanceM !== 'number' || !Number.isFinite(r.distanceM)) return null;
  if (typeof r.airtimeS !== 'number' || !Number.isFinite(r.airtimeS)) return null;
  if (typeof r.verdict !== 'string' || !VERDICTS.includes(r.verdict)) return null;
  return {
    code: r.code,
    mode: r.mode === 'airtime' ? 'airtime' : 'distance',
    distanceM: r.distanceM,
    airtimeS: r.airtimeS,
    verdict: r.verdict,
    at: typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0,
  };
}

export function loadRecords(): Records {
  return reviveRecords(loadJson(STORAGE_KEYS.records));
}

/** 저장소에서 읽은 값을 검사해 기록으로 되살린다(어떤 값이 와도 예외를 던지지 않는다). */
export function reviveRecords(raw: unknown): Records {
  const empty: Records = { bestDistance: null, bestAirtime: null, recent: [] };
  if (typeof raw !== 'object' || raw === null) return empty;
  const r = raw as { bestDistance?: unknown; bestAirtime?: unknown; recent?: unknown };
  const recent = Array.isArray(r.recent)
    ? r.recent.map(reviveRecord).filter((v): v is FlightRecord => v !== null).slice(0, RECENT_MAX)
    : [];
  return { bestDistance: reviveRecord(r.bestDistance), bestAirtime: reviveRecord(r.bestAirtime), recent };
}

/** 새 비행을 더한 기록을 돌려준다(원본은 바꾸지 않는다). 저장도 시도한다. */
export function addRecord(prev: Records, rec: FlightRecord): Records {
  const next: Records = {
    bestDistance: !prev.bestDistance || rec.distanceM > prev.bestDistance.distanceM ? rec : prev.bestDistance,
    bestAirtime: !prev.bestAirtime || rec.airtimeS > prev.bestAirtime.airtimeS ? rec : prev.bestAirtime,
    recent: [rec, ...prev.recent].slice(0, RECENT_MAX),
  };
  saveJson(STORAGE_KEYS.records, next);
  return next;
}
