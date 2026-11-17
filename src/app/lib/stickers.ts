/**
 * 스티커판(도전 과제). 비행 결과만 보고 이 기기 안에서 판단한다.
 * 저장소가 막혀 있으면 이번 방문 동안만 기억한다.
 */
import type { FlightVerdict } from '../../core/index';
import { PRESETS } from '../../core/index';
import { loadJson, saveJson, STORAGE_KEYS } from './storage';

export type StickerId =
  | 'first' | 'd10' | 'd20' | 't3' | 't5' | 'news8'
  | 'all5' | 'free10' | 'spin' | 'straight' | 'clip10' | 'ten'
  | 'hangar1' | 'hangar5' | 'paper6';

export interface StickerDef {
  id: StickerId;
  name: string;
  /** 어떻게 하면 받는지 */
  how: string;
  /** 스티커 바탕 색 토큰 */
  token: string;
}

/**
 * 스티커의 목표 숫자. 물리 2판(던지기 한도 10 m/s)에서 실제로 나오는 범위에 맞춰 정했다.
 * 기본 접는 법 5가지 x 종이 6가지 x 여러 던지기를 잰 값(물리 담당 측정):
 *   거리: 가운데 8.2 m, 위 25% 10.2 m, 위 10% 11.9 m, 기본 접는 법 최고 16.5 m, 다듬거나 내 맘대로 접으면 약 22 m
 *   시간: 가운데 2.3 초, 위 25% 2.6 초, 위 10% 2.8 초, 기본 접는 법 최고 4.4 초, 다듬으면 약 7 초
 * 그래서
 *   far 10 m  : 잘 맞는 종이와 힘을 고르면 기본 접는 법으로 닿는다(위 25%).
 *   farTop 18 m: 기본 접는 법 그대로는 안 닿는다(최고 16.5 m). 날개 다듬기를 조금 해야 닿는 꿈의 목표.
 *   long 3 초 : 넓은 날개와 가벼운 종이를 골라야 닿는다(위 10% 밖).
 *   longTop 4.5 초: 기본 접는 법 그대로는 안 닿는다(최고 4.4 초). 조금 다듬어야 닿는다.
 *   news 8 m  : 신문지는 세게 던지면 손해라(최고 약 11 m) 10 m 대신 8 m.
 * 숫자를 바꾸면 tests/stickerGoals.test.ts 가 스티커마다 "실제로 받을 수 있는 설계 + 던지기"를 core 로 다시 확인한다.
 * (물리가 바뀌어 닿을 수 없게 되면 그 시험이 알려 준다.)
 */
export const STICKER_GOALS = {
  farM: 10,
  farTopM: 18,
  longS: 3,
  longTopS: 4.5,
  newsM: 8,
  /** 똑바로 날리기: 옆으로 벗어나도 되는 폭(m) */
  straightSideM: 0.5,
} as const;

const G = STICKER_GOALS;
/** 숫자를 글자로: 4.5 -> '4.5', 18 -> '18' */
const n = (v: number): string => String(v);

// id 는 저장소에 적히는 이름이라 목표 숫자가 바뀌어도 그대로 둔다(d20 = 가장 먼 목표, t5 = 가장 긴 목표).
export const STICKERS: readonly StickerDef[] = [
  { id: 'first', name: '처음 던지기', how: '비행기를 한 번 던져요.', token: '--yellow' },
  { id: 'd10', name: `${n(G.farM)} m 넘기기`, how: `${n(G.farM)} m보다 멀리 날려요.`, token: '--sky' },
  { id: 'd20', name: `${n(G.farTopM)} m 넘기기`, how: `${n(G.farTopM)} m보다 멀리 날려요. 날개를 다듬어야 닿아요.`, token: '--red' },
  { id: 't3', name: `${n(G.longS)}초 버티기`, how: `${n(G.longS)}초 넘게 떠 있어요.`, token: '--green' },
  { id: 't5', name: `${n(G.longTopS)}초 버티기`, how: `${n(G.longTopS)}초 넘게 떠 있어요. 날개를 다듬어야 닿아요.`, token: '--purple' },
  { id: 'news8', name: `신문지로 ${n(G.newsM)} m`, how: `신문지 비행기로 ${n(G.newsM)} m를 넘겨요.`, token: '--paper-shade' },
  { id: 'all5', name: '다섯 가지 모두', how: '따라 접기 비행기 다섯 가지를 모두 날려요.', token: '--orange' },
  { id: 'free10', name: `내 맘대로 ${n(G.farM)} m`, how: `내 맘대로 접은 비행기로 ${n(G.farM)} m를 넘겨요.`, token: '--pink' },
  { id: 'spin', name: '빙글빙글', how: '비행기가 빙글빙글 돌게 던져요.', token: '--sky' },
  { id: 'straight', name: '똑바로 날리기', how: `옆으로 ${n(G.straightSideM)} m도 안 벗어나게 ${n(G.farM)} m를 넘겨요.`, token: '--green' },
  { id: 'clip10', name: `클립 달고 ${n(G.farM)} m`, how: `클립을 끼운 비행기로 ${n(G.farM)} m를 넘겨요.`, token: '--yellow' },
  { id: 'ten', name: '열 번 던지기', how: '비행기를 열 번 던져요.', token: '--red' },
  // 격납고 스티커: 비행이 아니라 격납고에 넣어 둔 비행기를 보고 준다(addHangarFacts).
  { id: 'hangar1', name: '첫 비행기 넣기', how: '격납고에 비행기를 한 대 넣어요.', token: '--sky' },
  { id: 'hangar5', name: '다섯 대 모으기', how: '격납고에 비행기를 다섯 대 모아요.', token: '--orange' },
  { id: 'paper6', name: '종이 여섯 가지', how: '여섯 가지 종이로 접은 비행기를 모두 모아요.', token: '--purple' },
];

/** 스티커 판단에 필요한 비행 한 번의 정보 */
export interface FlightFacts {
  distanceM: number;
  airtimeS: number;
  lateralM: number;
  verdict: FlightVerdict;
  paperId: string;
  /** 따라 접기로 끝까지 접은 비행기면 그 접는 법의 id, 아니면 null */
  presetId: string | null;
  /** 내 맘대로 접은 비행기인지 */
  free: boolean;
  hasClip: boolean;
}

export interface StickerProgress {
  /** 받은 스티커와 받은 시각 */
  got: Partial<Record<StickerId, number>>;
  /** 던진 횟수 */
  throws: number;
  /** 날려 본 접는 법 */
  presets: string[];
}

export function emptyProgress(): StickerProgress {
  return { got: {}, throws: 0, presets: [] };
}

export function loadProgress(): StickerProgress {
  const raw = loadJson(STORAGE_KEYS.stickers);
  if (typeof raw !== 'object' || raw === null) return emptyProgress();
  const r = raw as Partial<StickerProgress>;
  const got: Partial<Record<StickerId, number>> = {};
  if (typeof r.got === 'object' && r.got !== null) {
    for (const def of STICKERS) {
      const v = (r.got as Record<string, unknown>)[def.id];
      if (typeof v === 'number' && Number.isFinite(v)) got[def.id] = v;
    }
  }
  return {
    got,
    throws: typeof r.throws === 'number' && Number.isFinite(r.throws) ? Math.max(0, Math.floor(r.throws)) : 0,
    presets: Array.isArray(r.presets) ? r.presets.filter((p): p is string => typeof p === 'string').slice(0, 20) : [],
  };
}

/** 비행 한 번을 더해 새로 받은 스티커를 알려 준다. 저장도 시도한다. */
export function addFlight(prev: StickerProgress, f: FlightFacts, now: number): { progress: StickerProgress; fresh: StickerId[] } {
  const throws = prev.throws + 1;
  const presets = f.presetId !== null && !prev.presets.includes(f.presetId) ? [...prev.presets, f.presetId] : prev.presets;
  const earned: Record<StickerId, boolean> = {
    first: true,
    d10: f.distanceM >= G.farM,
    d20: f.distanceM >= G.farTopM,
    t3: f.airtimeS >= G.longS,
    t5: f.airtimeS >= G.longTopS,
    news8: f.paperId === 'newsprint' && f.distanceM >= G.newsM,
    all5: PRESETS.every((p) => presets.includes(p.id)),
    free10: f.free && f.distanceM >= G.farM,
    spin: f.verdict === 'tumble',
    straight: f.distanceM >= G.farM && Math.abs(f.lateralM) <= G.straightSideM,
    clip10: f.hasClip && f.distanceM >= G.farM,
    ten: throws >= 10,
    // 격납고 스티커는 여기서 주지 않는다.
    hangar1: false,
    hangar5: false,
    paper6: false,
  };
  const got = { ...prev.got };
  const fresh: StickerId[] = [];
  for (const def of STICKERS) {
    if (earned[def.id] && got[def.id] === undefined) {
      got[def.id] = now;
      fresh.push(def.id);
    }
  }
  const progress: StickerProgress = { got, throws, presets };
  saveJson(STORAGE_KEYS.stickers, progress);
  return { progress, fresh };
}

/** 격납고에 든 비행기 수와 종이 종류 수를 보고 격납고 스티커를 준다. 저장도 시도한다. */
export function addHangarFacts(prev: StickerProgress, f: { planes: number; paperKinds: number; allPapers: number }, now: number): { progress: StickerProgress; fresh: StickerId[] } {
  const earned: Partial<Record<StickerId, boolean>> = {
    hangar1: f.planes >= 1,
    hangar5: f.planes >= 5,
    paper6: f.allPapers > 0 && f.paperKinds >= f.allPapers,
  };
  const got = { ...prev.got };
  const fresh: StickerId[] = [];
  for (const def of STICKERS) {
    if (earned[def.id] && got[def.id] === undefined) {
      got[def.id] = now;
      fresh.push(def.id);
    }
  }
  if (fresh.length === 0) return { progress: prev, fresh };
  const progress: StickerProgress = { ...prev, got };
  saveJson(STORAGE_KEYS.stickers, progress);
  return { progress, fresh };
}

export function stickerCount(p: StickerProgress): number {
  return STICKERS.filter((d) => p.got[d.id] !== undefined).length;
}
