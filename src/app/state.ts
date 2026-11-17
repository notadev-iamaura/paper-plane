/**
 * 앱 전체 상태와 그 상태를 바꾸는 규칙(리듀서).
 * 단계를 오가도 값이 유지되도록 모든 입력 값을 한곳에 둔다.
 */
import { encodeDesign, LIMITS, PRESETS } from '../core/index';
import type { FoldOp, GameMode, PlaneDesign, Shaping, ThrowInput } from '../core/index';
import { buildPresetDesign, defaultPresetParams } from '../core/presets';
import type { PresetParams } from '../core/presets';
import { DEFAULT_PAPER_ID } from '../core/papers';
import { clamp } from './lib/format';
import { DEFAULT_THROW_SPEED } from './lib/power';
import { DEFAULT_SHAPING, isShapingKey, paperOf } from './lib/design';
import type { ShapingKey } from './lib/design';

/** 지금 있는 곳: 대회장(홈), 책상, 출발선, 기록장, 격납고 */
export type Screen = 'home' | 'desk' | 'throw' | 'book' | 'hangar';
/** 책상에서 하는 일: 종이 고르기, 접기, 날개 다듬기 */
export type DeskStep = 'paper' | 'fold' | 'shape';
/** simple = 따라 접기(접는 법 + 조절값), free = 내 맘대로 접기 */
export type FoldMode = 'simple' | 'free';

export interface AppState {
  screen: Screen;
  deskStep: DeskStep;
  /** 종이 종류. 무게와 빳빳함뿐 아니라 겉모습(무늬, 색)도 이것이 정한다. 색을 따로 고르지 않는다. */
  paperId: string;
  foldMode: FoldMode;
  /** 따라 접기: 고른 접는 법과 조절값 */
  presetId: string;
  presetParams: PresetParams;
  /** 접는 법 카드를 한 번이라도 골랐는지 */
  presetChosen: boolean;
  /**
   * 따라 접는 중이면 지금까지 접은 것, 다 접었으면 null.
   * null 이 아닌 동안 비행기는 "여기까지만 접은 종이"다.
   */
  guideFolds: FoldOp[] | null;
  guidePast: FoldOp[][];
  guideFuture: FoldOp[][];
  /** 내 맘대로 접기: 지금까지의 접기, 되돌리기용 과거 목록, 다시 하기용 미래 목록 */
  freeFolds: FoldOp[];
  freePast: FoldOp[][];
  freeFuture: FoldOp[][];
  /** 이 기기에서 직접 바꾼 자유 접기 모양. 코드 불러오기와 모드 전환만으로는 추가하지 않는다. */
  authoredFoldKeys: string[];
  /** 내 맘대로 접기의 날개 다듬기 값 */
  freeShaping: Shaping;
  clip: { xBodyM: number } | null;
  throwIn: ThrowInput;
  mode: GameMode;
  /** 지금 비행기가 격납고의 어느 비행기에서 왔는지(넣었거나 꺼낸 비행기의 id). 없으면 null. */
  hangarId: string | null;
  /** 격납고에 들어오기 전에 있던 곳(뒤로 가면 여기로 돌아간다) */
  hangarFrom: Screen;
}

export type Action =
  | { type: 'screen'; screen: Screen }
  | { type: 'deskStep'; step: DeskStep }
  | { type: 'paper'; paperId: string }
  | { type: 'foldMode'; mode: FoldMode }
  | { type: 'presetPick'; presetId: string }
  | { type: 'presetInstant' }
  | { type: 'presetUnpick' }
  | { type: 'guideSet'; folds: FoldOp[] }
  | { type: 'guideDone' }
  | { type: 'guideUndo' }
  | { type: 'guideRedo' }
  | { type: 'guideReset' }
  | { type: 'presetParam'; key: string; value: number }
  | { type: 'presetReset' }
  | { type: 'convertToFree' }
  | { type: 'freeSet'; folds: FoldOp[] }
  | { type: 'freeUndo' }
  | { type: 'freeRedo' }
  | { type: 'shaping'; key: ShapingKey; value: number }
  | { type: 'clip'; clip: { xBodyM: number } | null }
  | { type: 'throw'; patch: Partial<ThrowInput> }
  | { type: 'mode'; mode: GameMode }
  | { type: 'load'; design: PlaneDesign; throwIn?: ThrowInput; hangarId?: string | null }
  /** 격납고의 "손대지 않은 따라 접기 비행기"를 그 접는 법 그대로 책상에 올린다 */
  | { type: 'loadPreset'; presetId: string; paperId: string; hangarId: string | null }
  | { type: 'hangarLink'; id: string | null };

/** 처음 던지기: 힘 막대 한가운데(보통), 살짝 위로. */
export const DEFAULT_THROW: ThrowInput = { speedMps: DEFAULT_THROW_SPEED, pitchDeg: 5, rollDeg: 0 };

const firstPresetId = PRESETS[0]?.id ?? 'dart';

export function defaultState(): AppState {
  return {
    screen: 'home',
    deskStep: 'paper',
    paperId: DEFAULT_PAPER_ID,
    foldMode: 'simple',
    presetId: firstPresetId,
    presetParams: defaultPresetParams(firstPresetId),
    presetChosen: false,
    // 처음에는 아직 아무것도 접지 않은 종이 한 장이다.
    guideFolds: [],
    guidePast: [],
    guideFuture: [],
    freeFolds: [],
    freePast: [],
    freeFuture: [],
    authoredFoldKeys: [],
    freeShaping: { ...DEFAULT_SHAPING },
    clip: null,
    throwIn: { ...DEFAULT_THROW },
    mode: 'distance',
    hangarId: null,
    hangarFrom: 'home',
  };
}

/** 현재 상태가 뜻하는 설계. 따라 접기는 접는 법에서 매번 새로 만든다. */
export function designFromState(s: AppState): PlaneDesign {
  if (s.foldMode === 'simple') {
    const d = buildPresetDesign(s.presetId, s.presetParams, s.paperId);
    // 따라 접는 중이면 지금까지 접은 데까지만 반영한다.
    return { ...d, folds: s.guideFolds ?? d.folds, clip: s.clip };
  }
  return { v: 1, paperId: paperOf(s.paperId).id, folds: s.freeFolds, shaping: s.freeShaping, clip: s.clip };
}

/** 내 맘대로 접기의 다듬기 값을 규칙 안으로 맞춘다(동체 + 날개 끝이 종이 반쪽 폭을 넘지 않게). */
function fixShaping(sh: Shaping, paperId: string): Shaping {
  const half = paperOf(paperId).widthM / 2;
  const keelM = clamp(sh.keelM, 0, half - 0.01);
  const wingletM = clamp(sh.wingletM, 0, Math.max(0, half - keelM - 0.005));
  return {
    keelM,
    wingletM,
    dihedralDeg: clamp(sh.dihedralDeg, LIMITS.dihedralMin, LIMITS.dihedralMax),
    wingletDeg: clamp(sh.wingletDeg, LIMITS.wingletDegMin, LIMITS.wingletDegMax),
    elevatorDeg: clamp(sh.elevatorDeg, LIMITS.elevatorMin, LIMITS.elevatorMax),
  };
}

const MAX_HISTORY = 60;

/** 공유 코드의 정밀도로 접은 선만 비교한다. 종이와 다듬기, 던지는 힘은 접기 이력이 아니다. */
function foldKey(folds: FoldOp[]): string {
  return encodeDesign({ v: 1, paperId: DEFAULT_PAPER_ID, folds, shaping: DEFAULT_SHAPING, clip: null });
}

export function isAuthoredFreeFold(s: AppState): boolean {
  return s.foldMode === 'free' && s.freeFolds.length > 0 && s.authoredFoldKeys.includes(foldKey(s.freeFolds));
}

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'screen':
      // 격납고에 들어갈 때는 어디서 왔는지 적어 둔다.
      if (a.screen === 'hangar' && s.screen !== 'hangar') return { ...s, screen: a.screen, hangarFrom: s.screen };
      return { ...s, screen: a.screen };
    case 'deskStep':
      return { ...s, deskStep: a.step };
    case 'paper':
      // 종이를 바꿔도 접기는 그대로 둔다.
      return { ...s, paperId: paperOf(a.paperId).id };
    case 'foldMode':
      return { ...s, foldMode: a.mode };
    case 'presetPick':
      // 접는 법을 고르면 빈 종이에서 한 단계씩 따라 접기 시작한다.
      return {
        ...s, foldMode: 'simple', presetId: a.presetId, presetParams: defaultPresetParams(a.presetId),
        presetChosen: true, guideFolds: [], guidePast: [], guideFuture: [],
      };
    case 'presetInstant':
    case 'guideDone':
      return { ...s, foldMode: 'simple', presetChosen: true, guideFolds: null, guidePast: [], guideFuture: [] };
    case 'presetUnpick':
      return { ...s, presetChosen: false, guideFolds: [], guidePast: [], guideFuture: [] };
    case 'guideSet':
      if (s.guideFolds === null) return s;
      return { ...s, guideFolds: a.folds.slice(0, LIMITS.maxFolds), guidePast: [...s.guidePast, s.guideFolds].slice(-MAX_HISTORY), guideFuture: [] };
    case 'guideUndo': {
      const prev = s.guidePast[s.guidePast.length - 1];
      if (!prev || s.guideFolds === null) return s;
      return { ...s, guideFolds: prev, guidePast: s.guidePast.slice(0, -1), guideFuture: [s.guideFolds, ...s.guideFuture] };
    }
    case 'guideRedo': {
      const next = s.guideFuture[0];
      if (!next || s.guideFolds === null) return s;
      return { ...s, guideFolds: next, guidePast: [...s.guidePast, s.guideFolds], guideFuture: s.guideFuture.slice(1) };
    }
    case 'guideReset':
      return { ...s, presetChosen: true, guideFolds: [], guidePast: s.guideFolds ? [...s.guidePast, s.guideFolds].slice(-MAX_HISTORY) : [], guideFuture: [] };
    case 'presetParam':
      return { ...s, presetParams: { ...s.presetParams, [a.key]: a.value } };
    case 'presetReset':
      return { ...s, presetParams: defaultPresetParams(s.presetId) };
    case 'convertToFree': {
      // 지금 보이는 따라 접기 비행기를 그대로 내 맘대로 접기로 옮긴다.
      const d = designFromState({ ...s, foldMode: 'simple' });
      return {
        ...s,
        foldMode: 'free',
        freeFolds: d.folds,
        freePast: [...s.freePast, s.freeFolds].slice(-MAX_HISTORY),
        freeFuture: [],
        freeShaping: fixShaping(d.shaping, s.paperId),
      };
    }
    case 'freeSet': {
      const folds = a.folds.slice(0, LIMITS.maxFolds);
      const key = foldKey(folds);
      const changed = folds.length > 0 && key !== foldKey(s.freeFolds);
      return {
        ...s,
        freeFolds: folds,
        authoredFoldKeys: changed ? [...s.authoredFoldKeys.filter((k) => k !== key), key].slice(-MAX_HISTORY) : s.authoredFoldKeys,
        freePast: [...s.freePast, s.freeFolds].slice(-MAX_HISTORY),
        freeFuture: [],
      };
    }
    case 'freeUndo': {
      const prev = s.freePast[s.freePast.length - 1];
      if (!prev) return s;
      return { ...s, freeFolds: prev, freePast: s.freePast.slice(0, -1), freeFuture: [s.freeFolds, ...s.freeFuture] };
    }
    case 'freeRedo': {
      const next = s.freeFuture[0];
      if (!next) return s;
      return { ...s, freeFolds: next, freePast: [...s.freePast, s.freeFolds], freeFuture: s.freeFuture.slice(1) };
    }
    case 'shaping':
      // 따라 접기에서는 접는 법의 조절값으로, 내 맘대로 접기에서는 따로 둔 다듬기 값으로 들어간다.
      if (s.foldMode === 'simple') return { ...s, presetParams: { ...s.presetParams, [a.key]: a.value } };
      return { ...s, freeShaping: fixShaping({ ...s.freeShaping, [a.key]: a.value }, s.paperId) };
    case 'clip':
      return { ...s, clip: a.clip };
    case 'throw':
      return {
        ...s,
        throwIn: {
          speedMps: clamp(a.patch.speedMps ?? s.throwIn.speedMps, LIMITS.throwSpeedMin, LIMITS.throwSpeedMax),
          pitchDeg: clamp(a.patch.pitchDeg ?? s.throwIn.pitchDeg, LIMITS.pitchMin, LIMITS.pitchMax),
          rollDeg: 0,
        },
      };
    case 'mode':
      return { ...s, mode: a.mode };
    case 'load':
      // 코드로 불러온 비행기는 어떤 접는 법에서 왔는지 알 수 없으므로 내 맘대로 접기로 연다.
      return {
        ...s,
        paperId: paperOf(a.design.paperId).id,
        foldMode: 'free',
        freeFolds: a.design.folds,
        freePast: [...s.freePast, s.freeFolds].slice(-MAX_HISTORY),
        freeFuture: [],
        freeShaping: a.design.shaping,
        clip: a.design.clip,
        // 좌우 기울이기는 이제 고를 수 없다(0). 기울인 채 던진 예전 코드도 비행기와 힘, 각도만 가져온다.
        throwIn: a.throwIn ? { ...a.throwIn, rollDeg: 0 } : s.throwIn,
        hangarId: a.hangarId ?? null,
      };
    case 'loadPreset': {
      const presetId = PRESETS.some((p) => p.id === a.presetId) ? a.presetId : s.presetId;
      return {
        ...s, paperId: paperOf(a.paperId).id, foldMode: 'simple', presetId, presetParams: defaultPresetParams(presetId),
        presetChosen: true, guideFolds: null, guidePast: [], guideFuture: [], clip: null, hangarId: a.hangarId,
      };
    }
    case 'hangarLink':
      return s.hangarId === a.id ? s : { ...s, hangarId: a.id };
  }
}

/**
 * 저장해 둔 지난 방문 상태를 되살린다. 모양이 조금이라도 이상하면 null (기본값으로 시작).
 * 예전 판이 저장한 색종이 색(colorId)은 이제 쓰지 않는다: 읽지 않고 버리며, 나머지 값은 그대로 되살린다.
 */
export function reviveSession(raw: unknown): AppState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<AppState>;
  const base = defaultState();
  try {
    if (typeof r.paperId !== 'string' || typeof r.presetId !== 'string') return null;
    if (r.foldMode !== 'simple' && r.foldMode !== 'free') return null;
    if (!Array.isArray(r.freeFolds) || typeof r.freeShaping !== 'object' || r.freeShaping === null) return null;
    if (typeof r.presetParams !== 'object' || r.presetParams === null) return null;
    if (typeof r.throwIn !== 'object' || r.throwIn === null) return null;
    const presetId = PRESETS.some((p) => p.id === r.presetId) ? r.presetId : base.presetId;
    const params: PresetParams = { ...defaultPresetParams(presetId) };
    for (const [k, v] of Object.entries(r.presetParams)) {
      if (typeof v === 'number' && Number.isFinite(v) && (k in params || isShapingKey(k))) params[k] = v;
    }
    const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const sh = r.freeShaping as Partial<Shaping>;
    const th = r.throwIn as Partial<ThrowInput>;
    const clipX = r.clip && typeof r.clip === 'object' ? (r.clip as { xBodyM?: unknown }).xBodyM : undefined;
    const guide = Array.isArray(r.guideFolds) ? (r.guideFolds as FoldOp[]).slice(0, LIMITS.maxFolds) : null;
    return {
      ...base,
      screen: 'home',
      deskStep: r.deskStep === 'fold' || r.deskStep === 'shape' ? r.deskStep : 'paper',
      paperId: paperOf(r.paperId).id,
      foldMode: r.foldMode,
      presetId,
      presetParams: params,
      presetChosen: r.presetChosen === true,
      guideFolds: r.presetChosen === true ? guide : (guide ?? []),
      freeFolds: (r.freeFolds as FoldOp[]).slice(0, LIMITS.maxFolds),
      // 예전 저장에는 직접 접었는지 알 수 있는 이력이 없다. 비행기와 기존 스티커는 그대로 둔다.
      authoredFoldKeys: Array.isArray(r.authoredFoldKeys)
        ? r.authoredFoldKeys.filter((k): k is string => typeof k === 'string' && k.length <= 1000).slice(-MAX_HISTORY)
        : [],
      freeShaping: fixShaping({
        keelM: num(sh.keelM, base.freeShaping.keelM),
        dihedralDeg: num(sh.dihedralDeg, base.freeShaping.dihedralDeg),
        wingletM: num(sh.wingletM, base.freeShaping.wingletM),
        wingletDeg: num(sh.wingletDeg, base.freeShaping.wingletDeg),
        elevatorDeg: num(sh.elevatorDeg, base.freeShaping.elevatorDeg),
      }, r.paperId),
      clip: typeof clipX === 'number' && Number.isFinite(clipX) ? { xBodyM: clipX } : null,
      throwIn: {
        speedMps: clamp(num(th.speedMps, base.throwIn.speedMps), LIMITS.throwSpeedMin, LIMITS.throwSpeedMax),
        pitchDeg: clamp(num(th.pitchDeg, base.throwIn.pitchDeg), LIMITS.pitchMin, LIMITS.pitchMax),
        rollDeg: 0,
      },
      mode: r.mode === 'airtime' ? 'airtime' : 'distance',
      hangarId: typeof r.hangarId === 'string' && r.hangarId.length <= 40 ? r.hangarId : null,
      hangarFrom: 'home',
    };
  } catch {
    return null;
  }
}
