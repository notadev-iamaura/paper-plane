/**
 * 바람 실험실의 작은 계산과 말 모음(순수 함수. 화면, 검사 스크립트, 시험이 같이 쓴다).
 * 공기 힘은 여기서 계산하지 않는다. core 의 probeTunnel / tunnelTrim 이 준 값을 읽어서
 * 단위를 바꾸고, 아이 말로 옮기고, "좋아하는 속도" 같은 것을 찾을 뿐이다.
 */
import type { PlaneGeometry, TunnelReading } from '../../../core/index';
import { powerZone, SPEED_MAX } from '../power';

/** core 에서 빌려 쓰는 것들(시험에서는 가짜를 넣는다) */
export interface TunnelDeps {
  probe: (geom: PlaneGeometry, input: { speedMps: number; alphaDeg: number; betaDeg?: number }) => TunnelReading;
  trim: (geom: PlaneGeometry, speedMps: number) => { alphaDeg: number | null; stable: boolean; liftToWeight: number };
  limits: { speedMin: number; speedMax: number; alphaMin: number; alphaMax: number; betaMin: number; betaMax: number };
}

export const G0 = 9.80665;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------
// 단위: 아이에게는 "그램"이 익숙하다. 1 g 의 물건을 드는 힘 = 1 g중(gf).
// ---------------------------------------------------------------------------
/** 뉴턴 -> 그램중(g 만큼의 물건을 드는 힘) */
export function gramsForce(newtons: number): number {
  return Number.isFinite(newtons) ? (newtons / G0) * 1000 : 0;
}

/** 그램 값을 글자로: 10 미만은 소수 한 자리, 그 이상은 정수. -0.0 은 0.0 으로. */
export function fmtGrams(g: number): string {
  if (!Number.isFinite(g)) return '–';
  const digits = Math.abs(g) < 9.95 ? 1 : 0;
  const s = g.toFixed(digits);
  return Number(s) === 0 ? (0).toFixed(digits) : s;
}

/** 뉴턴 -> '5.2' (g 단위 글자) */
export function gfText(newtons: number): string {
  return fmtGrams(gramsForce(newtons));
}

/** 뉴턴을 작게 덧붙일 때: '0.051 N' */
export function newtonText(newtons: number): string {
  if (!Number.isFinite(newtons)) return '– N';
  const s = newtons.toFixed(3);
  return `${Number(s) === 0 ? '0.000' : s} N`;
}

export function fmt1(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const s = v.toFixed(1);
  return Number(s) === 0 ? '0.0' : s;
}

// ---------------------------------------------------------------------------
// 아이 말
// ---------------------------------------------------------------------------
export type WindLevel = 'none' | 'breeze' | 'normal' | 'strong';

export function windLevel(speedMps: number, speedMax: number): WindLevel {
  if (speedMps < 0.05) return 'none';
  const f = speedMps / Math.max(1, speedMax);
  if (f <= 0.3) return 'breeze';
  if (f <= 0.65) return 'normal';
  return 'strong';
}

export const WIND_WORD: Record<WindLevel, string> = { none: '바람 없음', breeze: '산들바람', normal: '보통 바람', strong: '센 바람' };

/** 고개 각도를 아이 말로 */
export function noseWord(alphaDeg: number): string {
  if (alphaDeg <= -8) return '고개를 푹 숙임';
  if (alphaDeg < -1) return '고개를 살짝 숙임';
  if (alphaDeg <= 1) return '고개가 똑바로';
  if (alphaDeg <= 10) return '고개를 살짝 듦';
  if (alphaDeg <= 25) return '고개를 듦';
  return '고개를 번쩍 듦';
}

/** 뜨는 힘과 무게를 견준 한마디(가장 크게 보여 주는 말) */
export function liftHeadline(r: Pick<TunnelReading, 'liftToWeight' | 'liftN'>, speedMps: number): { ok: boolean; text: string } {
  if (speedMps < 0.05) return { ok: false, text: '바람을 켜 봐요' };
  if (r.liftToWeight >= 1) return { ok: true, text: '뜰 수 있어요!' };
  if (r.liftN < 0) return { ok: false, text: '아래로 눌려요' };
  return { ok: false, text: '조금 모자라요' };
}

/** 효율 별: 뜨는 힘 ÷ 막는 힘. 종이비행기는 3~6 이면 아주 좋은 편이라 5 이상이면 별 다섯. */
export function starsOf(liftToDrag: number): number {
  if (!Number.isFinite(liftToDrag) || liftToDrag <= 0) return 0;
  return clamp(Math.round(liftToDrag), 0, 5);
}

/** 실속 설명을 띄울 만큼 바람이 떨어져 나갔는지 */
export const STALL_SHOW = 0.34;
export function isStalledView(r: Pick<TunnelReading, 'stalledFraction'>, speedMps: number): boolean {
  return speedMps >= 0.5 && r.stalledFraction >= STALL_SHOW;
}

// ---------------------------------------------------------------------------
// 입력 다듬기와 기억해 두기
// ---------------------------------------------------------------------------
export const SPEED_STEP = 0.5;
export const ALPHA_STEP = 1;

export function snapSpeed(v: number, d: TunnelDeps['limits']): number {
  return clamp(Math.round(v / SPEED_STEP) * SPEED_STEP, d.speedMin, d.speedMax);
}
export function snapAlpha(v: number, d: TunnelDeps['limits']): number {
  return clamp(Math.round(v / ALPHA_STEP) * ALPHA_STEP, d.alphaMin, d.alphaMax);
}
export function snapBeta(v: number, d: TunnelDeps['limits']): number {
  return clamp(Math.round(v), d.betaMin, d.betaMax);
}

/** 형상마다 따로 기억해 둔 계산 결과(형상이 사라지면 같이 사라진다) */
interface Memo {
  probes: Map<string, TunnelReading>;
  trims: Map<number, { alphaDeg: number | null; stable: boolean; liftToWeight: number }>;
  favourite?: FavouriteSpeed;
  sweeps: Map<number, AlphaSweep>;
  buckle?: number | null;
}
const memos = new WeakMap<PlaneGeometry, Memo>();
function memoOf(g: PlaneGeometry): Memo {
  let m = memos.get(g);
  if (!m) { m = { probes: new Map(), trims: new Map(), sweeps: new Map() }; memos.set(g, m); }
  return m;
}
const PROBE_MEMO_MAX = 600;

/** 같은 입력(속도 0.1 m/s, 각도 0.01 도로 반올림)은 한 번만 계산한다. */
export function probeMemo(deps: TunnelDeps, geom: PlaneGeometry, speedMps: number, alphaDeg: number, betaDeg = 0): TunnelReading {
  const m = memoOf(geom);
  const sp = Math.round(speedMps * 10) / 10, al = Math.round(alphaDeg * 100) / 100, be = Math.round(betaDeg * 10) / 10;
  const key = `${sp}|${al}|${be}`;
  const hit = m.probes.get(key);
  if (hit) return hit;
  const r = deps.probe(geom, { speedMps: sp, alphaDeg: al, betaDeg: be });
  if (m.probes.size >= PROBE_MEMO_MAX) m.probes.clear();
  m.probes.set(key, r);
  return r;
}

export function trimMemo(deps: TunnelDeps, geom: PlaneGeometry, speedMps: number): { alphaDeg: number | null; stable: boolean; liftToWeight: number } {
  const m = memoOf(geom);
  const sp = Math.round(speedMps * 100) / 100;
  const hit = m.trims.get(sp);
  if (hit) return hit;
  const r = deps.trim(geom, sp);
  m.trims.set(sp, r);
  return r;
}

// ---------------------------------------------------------------------------
// 이 비행기가 좋아하는 속도: 혼자 균형 잡은 각도에서 뜨는 힘이 딱 무게만큼 되는 바람 속도
// ---------------------------------------------------------------------------
export interface FavouriteSpeed {
  /** m/s (0.1 단위). 실험실 바람으로는 못 뜨면 null */
  speedMps: number | null;
  /** 그 속도에서 균형 잡는 각도(도) */
  alphaDeg: number | null;
  /** 왜 없는지: 'unstable' 균형을 못 잡는다, 'heavy' 가장 센 바람에도 모자란다 */
  why: 'ok' | 'unstable' | 'heavy';
}

/**
 * 바람 속도를 차례로 올려 보며(0.5 m/s 간격) 균형 잡은 각도에서 뜨는 힘이 처음으로 무게를 넘는 곳을 찾고,
 * 그 사이를 반씩 좁혀 0.1 m/s 까지 맞춘다.
 */
export function* favouriteSteps(deps: TunnelDeps, geom: PlaneGeometry): Generator<void, FavouriteSpeed, void> {
  const { speedMax } = deps.limits;
  const ratio = (v: number): number | null => {
    const t = trimMemo(deps, geom, v);
    return t.alphaDeg !== null && t.stable && Number.isFinite(t.liftToWeight) ? t.liftToWeight : null;
  };
  let lo = 0, hi = -1;
  let anyStable = false;
  for (let v = 1; v <= speedMax + 1e-9; v += 0.5) {
    const r = ratio(v);
    yield;
    if (r === null) continue;
    anyStable = true;
    if (r >= 1) { hi = v; break; }
    lo = v;
  }
  if (hi < 0) return { speedMps: null, alphaDeg: null, why: anyStable ? 'heavy' : 'unstable' };
  lo = Math.max(lo, hi - 0.5);
  for (let i = 0; i < 6 && hi - lo > 0.05; i++) {
    const mid = (lo + hi) / 2;
    const r = ratio(mid);
    yield;
    if (r !== null && r >= 1) hi = mid; else lo = mid;
  }
  // 0.1 단위로 올림한다: 적어 준 속도에서는 정말로 뜬다.
  const speed = Math.min(speedMax, Math.ceil(hi * 10 - 1e-6) / 10);
  const alphaDeg = trimMemo(deps, geom, speed).alphaDeg;
  return { speedMps: speed, alphaDeg, why: 'ok' };
}

export function findFavouriteSpeed(deps: TunnelDeps, geom: PlaneGeometry): FavouriteSpeed {
  const it = favouriteSteps(deps, geom);
  for (;;) {
    const n = it.next();
    if (n.done) return n.value;
  }
}

/** 한 걸음마다 쉬어 가며 찾는다(화면이 멈추지 않게). 결과는 형상에 기억해 둔다. */
export async function favouriteSpeedAsync(deps: TunnelDeps, geom: PlaneGeometry, pause: () => Promise<void>): Promise<FavouriteSpeed> {
  const m = memoOf(geom);
  if (m.favourite) return m.favourite;
  const it = favouriteSteps(deps, geom);
  for (;;) {
    const n = it.next();
    if (n.done) { m.favourite = n.value; return n.value; }
    await pause();
  }
}

export function favouriteSpeedMemo(deps: TunnelDeps, geom: PlaneGeometry): FavouriteSpeed {
  const m = memoOf(geom);
  if (!m.favourite) m.favourite = findFavouriteSpeed(deps, geom);
  return m.favourite;
}

// ---------------------------------------------------------------------------
// 각도를 훑어보기: 딱 좋은 각도(뜨는 힘 ÷ 막는 힘이 가장 큰 각도)와 바람이 떨어져 나가기 시작하는 각도
// ---------------------------------------------------------------------------
export interface AlphaSweep {
  speedMps: number;
  points: { alphaDeg: number; liftN: number; dragN: number; liftToDrag: number; liftToWeight: number; stalledFraction: number }[];
  /** 뜨는 힘 ÷ 막는 힘이 가장 큰 각도. 없으면 null */
  bestAlphaDeg: number | null;
  bestLiftToDrag: number;
  /** 고개를 들어 갈 때 처음으로 바람이 떨어져 나가는(실속) 각도. 없으면 null */
  stallAlphaDeg: number | null;
}

export function sweepAlpha(deps: TunnelDeps, geom: PlaneGeometry, speedMps: number, stepDeg = 1): AlphaSweep {
  const { alphaMin, alphaMax } = deps.limits;
  const points: AlphaSweep['points'] = [];
  let bestAlphaDeg: number | null = null, bestLiftToDrag = 0;
  let stallAlphaDeg: number | null = null;
  for (let a = alphaMin; a <= alphaMax + 1e-9; a += stepDeg) {
    const r = probeMemo(deps, geom, speedMps, a);
    points.push({ alphaDeg: a, liftN: r.liftN, dragN: r.dragN, liftToDrag: r.liftToDrag, liftToWeight: r.liftToWeight, stalledFraction: r.stalledFraction });
    if (r.liftN > 0 && r.liftToDrag > bestLiftToDrag) { bestLiftToDrag = r.liftToDrag; bestAlphaDeg = a; }
    if (stallAlphaDeg === null && a > 0 && r.stalledFraction >= STALL_SHOW) stallAlphaDeg = a;
  }
  return { speedMps, points, bestAlphaDeg, bestLiftToDrag, stallAlphaDeg };
}

export function sweepMemo(deps: TunnelDeps, geom: PlaneGeometry, speedMps: number): AlphaSweep {
  const m = memoOf(geom);
  const sp = Math.round(speedMps * 10) / 10;
  let s = m.sweeps.get(sp);
  if (!s) {
    s = sweepAlpha(deps, geom, sp);
    if (m.sweeps.size > 12) m.sweeps.clear();
    m.sweeps.set(sp, s);
  }
  return s;
}

/** 종이가 꺾이기 시작하는 바람 속도(균형 각도 또는 5도에서). 가장 센 바람에도 안 꺾이면 null. */
export function findBuckleSpeed(deps: TunnelDeps, geom: PlaneGeometry, alphaDeg: number): number | null {
  const m = memoOf(geom);
  if (m.buckle !== undefined) return m.buckle;
  let out: number | null = null;
  for (let v = 1; v <= deps.limits.speedMax + 1e-9; v += 0.5) {
    if (probeMemo(deps, geom, v, alphaDeg).buckled) { out = v; break; }
  }
  m.buckle = out;
  return out;
}

// ---------------------------------------------------------------------------
// 혼자 균형 잡기
// ---------------------------------------------------------------------------
export type BalanceOutcome =
  /** 바람이 없어 가만히 있다 */
  | { kind: 'calm' }
  /** 균형 각도에서 멈춘다 */
  | { kind: 'settle'; alphaDeg: number; liftToWeight: number }
  /** 앞이 너무 무거워 고개를 푹 숙인 채 받침에 걸린다 */
  | { kind: 'nose-down'; alphaDeg: number }
  /** 뒤가 무거워 고개가 들리다 뒤집힌다 */
  | { kind: 'tumble'; dir: 1 | -1 };

/**
 * 축을 풀어 주면 어떻게 될지. 균형 각도는 core 의 tunnelTrim 이 정한다.
 * 균형이 없을 때 어느 쪽으로 넘어가는지는 probeTunnel 의 고개 돌리는 힘(pitchMomentNm)의 부호로 정한다.
 */
export function balanceOutcome(deps: TunnelDeps, geom: PlaneGeometry, speedMps: number, fromAlphaDeg: number): BalanceOutcome {
  if (speedMps < 0.5) return { kind: 'calm' };
  const t = trimMemo(deps, geom, speedMps);
  if (t.alphaDeg !== null && t.stable) return { kind: 'settle', alphaDeg: t.alphaDeg, liftToWeight: t.liftToWeight };
  const { alphaMin, alphaMax } = deps.limits;
  // 실험할 수 있는 각도 어디에서나 고개를 숙이는 쪽으로만 밀리면 "앞이 너무 무거운" 비행기다.
  let allDown = true;
  for (let a = alphaMin; a <= alphaMax; a += 8) {
    if (probeMemo(deps, geom, speedMps, a).pitchMomentNm > 0) { allDown = false; break; }
  }
  if (allDown) return { kind: 'nose-down', alphaDeg: alphaMin };
  const at = t.alphaDeg !== null ? clamp(fromAlphaDeg === t.alphaDeg ? t.alphaDeg + 2 : fromAlphaDeg, alphaMin, alphaMax) : clamp(fromAlphaDeg, alphaMin, alphaMax);
  const mNow = probeMemo(deps, geom, speedMps, at).pitchMomentNm;
  return { kind: 'tumble', dir: mNow >= 0 ? 1 : -1 };
}

export function balanceWords(o: BalanceOutcome): { title: string; why: string } {
  switch (o.kind) {
    case 'calm':
      return { title: '바람이 없어서 가만히 있어요', why: '바람을 켜면 비행기가 스스로 고개를 움직여요.' };
    case 'settle':
      return {
        title: `혼자서 고개를 ${fmt1(o.alphaDeg)}도로 잡았어요`,
        why: '앞이 알맞게 무거워서, 고개가 들리면 바람이 도로 눌러 주고 숙여지면 도로 들어 줘요.',
      };
    case 'nose-down':
      return { title: '고개를 푹 숙였어요', why: '앞이 너무 무거워서 바람이 고개를 들어 주지 못해요. 꼬리를 조금 올려 접어 봐요.' };
    case 'tumble':
      return { title: '균형을 못 잡고 뒤집혔어요', why: '뒤가 무거워서, 고개가 조금 들리면 바람이 더 밀어 올려요. 앞을 더 접거나 클립을 앞에 끼워 봐요.' };
  }
}

// ---------------------------------------------------------------------------
// 연구 노트에 적는 쪽지
// ---------------------------------------------------------------------------
export const LAB_NOTE_VERSION = 1;

export interface LabNote {
  v: number;
  /** 이 쪽지를 적을 때의 물리 판 번호(PHYSICS_VERSION) */
  physics: number;
  at: number;
  /** 좋아하는 속도(m/s). 없으면 null */
  favSpeedMps: number | null;
  /** 혼자 균형 잡는 각도(도). 균형을 못 잡으면 null */
  trimAlphaDeg: number | null;
  /** 딱 좋은 각도(뜨는 힘 ÷ 막는 힘이 가장 큰 각도)와 그때의 값 */
  bestAlphaDeg: number | null;
  bestLiftToDrag: number | null;
  /** 바람이 떨어져 나가기 시작하는 각도(도) */
  stallAlphaDeg: number | null;
  /** 종이가 꺾이는 바람 속도(m/s). 안 꺾이면 null */
  buckleSpeedMps: number | null;
}

const numOrNull = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/** 저장된 쪽지를 검사해 되살린다. 모양이 맞지 않으면 undefined. */
export function reviveLabNote(x: unknown): LabNote | undefined {
  if (typeof x !== 'object' || x === null) return undefined;
  const r = x as Partial<Record<keyof LabNote, unknown>>;
  if (r.v !== LAB_NOTE_VERSION) return undefined;
  if (typeof r.physics !== 'number' || !Number.isFinite(r.physics)) return undefined;
  return {
    v: LAB_NOTE_VERSION,
    physics: r.physics,
    at: typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0,
    favSpeedMps: numOrNull(r.favSpeedMps, 0, 100),
    trimAlphaDeg: numOrNull(r.trimAlphaDeg, -90, 90),
    bestAlphaDeg: numOrNull(r.bestAlphaDeg, -90, 90),
    bestLiftToDrag: numOrNull(r.bestLiftToDrag, 0, 1000),
    stallAlphaDeg: numOrNull(r.stallAlphaDeg, -90, 90),
    buckleSpeedMps: numOrNull(r.buckleSpeedMps, 0, 100),
  };
}

/** 실험실에서 알아낸 것을 한꺼번에 계산해 쪽지로 만든다(몇십 번의 probe: 한가할 때 부른다). */
export function measureLabNote(deps: TunnelDeps, geom: PlaneGeometry, physics: number, now: number): LabNote {
  const fav = favouriteSpeedMemo(deps, geom);
  const refSpeed = fav.speedMps ?? Math.min(6, deps.limits.speedMax);
  const trim = trimMemo(deps, geom, refSpeed);
  const sweep = sweepMemo(deps, geom, refSpeed);
  const round1 = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10);
  const trimAlpha = trim.alphaDeg !== null && trim.stable ? trim.alphaDeg : null;
  return {
    v: LAB_NOTE_VERSION,
    physics,
    at: now,
    favSpeedMps: fav.speedMps,
    trimAlphaDeg: round1(trimAlpha),
    bestAlphaDeg: sweep.bestAlphaDeg,
    bestLiftToDrag: sweep.bestAlphaDeg === null ? null : round1(sweep.bestLiftToDrag),
    stallAlphaDeg: sweep.stallAlphaDeg,
    buckleSpeedMps: findBuckleSpeed(deps, geom, trimAlpha ?? 5),
  };
}

/** 던지는 힘을 세 단계 말로(힘 막대와 같은 경계: lib/power.ts) */
function throwPower(speedMps: number): string {
  const z = powerZone(speedMps);
  return z === 'soft' ? '살살' : z === 'mid' ? '보통 힘으로' : '세게';
}

/** 쪽지를 아이 말 문장들로(격납고의 비행기 판과 실험실에서 보여 준다) */
export function labNoteLines(n: LabNote): string[] {
  const out: string[] = [];
  if (n.favSpeedMps !== null && n.favSpeedMps > SPEED_MAX) out.push(`좋아하는 바람은 ${fmt1(n.favSpeedMps)} m/s예요. 가장 세게 던져도 그보다 느려서, 날개를 넓히거나 가벼운 종이로 바꾸면 좋아요.`);
  else if (n.favSpeedMps !== null) out.push(`좋아하는 바람은 ${fmt1(n.favSpeedMps)} m/s예요. ${throwPower(n.favSpeedMps)} 던지면 딱 좋아요.`);
  else out.push('실험실 바람으로는 혼자 뜨지 못했어요.');
  if (n.trimAlphaDeg !== null) out.push(`혼자 두면 고개를 ${fmt1(n.trimAlphaDeg)}도로 잡아요.`);
  else out.push('혼자 두면 균형을 못 잡아요. 앞뒤 무게를 고쳐 봐요.');
  if (n.bestAlphaDeg !== null) out.push(`고개를 ${n.bestAlphaDeg}도쯤 들 때 가장 알뜰하게 날아요.`);
  if (n.stallAlphaDeg !== null) out.push(`${n.stallAlphaDeg}도보다 더 들면 바람이 날개에서 떨어져 나가요.`);
  // 실험실에서는 같은 바람을 계속 불어 준다. 던진 비행기는 금방 느려지므로 이보다 조금 세게 던져도 버틸 수 있다.
  if (n.buckleSpeedMps !== null) out.push(`바람을 ${fmt1(n.buckleSpeedMps)} m/s보다 세게 계속 불면 종이가 꺾여요. 세게 던질 때는 조심해요.`);
  return out;
}

/** 격납고 판에 붙이는 한 줄 */
export function labNoteShort(n: LabNote): string {
  const parts: string[] = [];
  parts.push(n.favSpeedMps !== null ? `좋아하는 바람 ${fmt1(n.favSpeedMps)} m/s` : '혼자 뜨지 못해요');
  if (n.trimAlphaDeg !== null) parts.push(`균형 ${fmt1(n.trimAlphaDeg)}도`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// 작은 실험 카드
// ---------------------------------------------------------------------------
export type ExperimentId = 'lift' | 'best' | 'stall' | 'paper';

export interface ExperimentDef { id: ExperimentId; title: string; goal: string; token: string }

export const EXPERIMENTS: readonly ExperimentDef[] = [
  { id: 'lift', title: '뜨는 속도 찾기', goal: '바람을 조금씩 세게 해서 비행기가 제 무게만큼 들릴 때를 찾아봐요.', token: '--sky' },
  { id: 'best', title: '딱 좋은 각도 찾기', goal: '고개를 올렸다 내렸다 하며 별이 가장 많이 켜지는 각도를 찾아봐요.', token: '--yellow' },
  { id: 'stall', title: '실속 만들어 보기', goal: '실속은 고개를 너무 들어서 바람이 날개에서 떨어져 나가는 일이에요. 고개를 자꾸 들어서 연기가 떨어져 나가게 해 봐요.', token: '--pink' },
  { id: 'paper', title: '종이 바꿔 보기', goal: '얇은 종이는 센 바람에 날개가 휘고 펄럭여요. 센 바람에서 지금 값을 붙여 두고, 다른 종이로 바꿔 얼마나 다른지 견줘 봐요.', token: '--green' },
];

/** 센 바람(종이 견주기 실험)으로 치는 속도 */
export function strongWind(limits: TunnelDeps['limits']): number {
  return Math.round(limits.speedMax * 0.7 * 2) / 2;
}

/** 딱 좋은 각도 실험: 지금 각도가 가장 좋은 각도에 충분히 가까운지 */
export function nearBest(sweep: AlphaSweep, alphaDeg: number, liftToDrag: number): boolean {
  if (sweep.bestAlphaDeg === null) return false;
  return Math.abs(alphaDeg - sweep.bestAlphaDeg) <= 1 || liftToDrag >= sweep.bestLiftToDrag * 0.985;
}

/** 종이 견주기 실험에서 알아낸 것(붙여 둔 값과 지금 값). 힘은 같은 바람, 같은 고개 각도에서 잰 것일 때만 넣는다. */
export interface PaperFacts {
  flexNowDeg?: number;
  flexPinnedDeg?: number;
  buckledNow?: boolean;
  buckledPinned?: boolean;
  liftNowN?: number;
  liftPinnedN?: number;
  dragNowN?: number;
  dragPinnedN?: number;
}

/** 실험을 마쳤을 때 던지기와 이어 주는 한 문장 */
export function experimentLesson(id: ExperimentId, facts: { speedMps: number; alphaDeg: number } & PaperFacts): string {
  switch (id) {
    case 'lift': {
      const head = `바람이 ${fmt1(facts.speedMps)} m/s일 때 떴어요.`;
      // 가장 센 던지기보다도 센 바람에서야 떴다: 이 고개 각도로는 던져서 띄우기 어렵다.
      if (facts.speedMps > SPEED_MAX) return `${head} 그래서 이 비행기는 아주 세게 던져야 떠요. 가장 센 던지기(${fmt1(SPEED_MAX)} m/s)보다도 센 바람이라, 고개를 조금 들어 줘야 해요.`;
      return `${head} 그래서 이 비행기는 ${powerZone(facts.speedMps) === 'soft' ? '살살 던져도 떠요' : `${throwPower(facts.speedMps)} 던져야 떠요`}.`;
    }
    case 'best':
      return `고개를 ${Math.round(facts.alphaDeg)}도쯤 들 때 가장 알뜰해요. 그래서 살짝 위로 던지면 멀리 가요.`;
    case 'stall':
      return `고개를 ${Math.round(facts.alphaDeg)}도까지 드니 바람이 떨어져 나갔어요. 그래서 너무 위로 던지면 힘이 빠져서 뚝 떨어져요.`;
    case 'paper': {
      const a = Math.abs(facts.flexPinnedDeg ?? 0), b = Math.abs(facts.flexNowDeg ?? 0);
      if (facts.buckledNow || facts.buckledPinned) return '얇은 종이는 센 바람에 꺾였어요. 꺾인 날개는 펄럭거리기만 해서 뜨는 힘이 새요. 그래서 세게 던질 때는 빳빳한 종이가 좋아요.';
      if (Math.abs(a - b) < 0.05) return '두 종이 모두 거의 휘지 않았어요. 그래서 이 모양은 세게 던져도 잘 버텨요.';
      // 같은 바람, 같은 각도에서 쟀다면: 더 휜 종이가 막는 힘은 얼마나 커지고 뜨는 힘은 얼마나 줄었는지도 말해 준다.
      const { liftNowN, liftPinnedN, dragNowN, dragPinnedN } = facts;
      if (liftNowN !== undefined && liftPinnedN !== undefined && dragNowN !== undefined && dragPinnedN !== undefined) {
        const nowBent = b > a;
        const bent = { flex: Math.max(a, b), lift: nowBent ? liftNowN : liftPinnedN, drag: nowBent ? dragNowN : dragPinnedN };
        const stiff = { flex: Math.min(a, b), lift: nowBent ? liftPinnedN : liftNowN, drag: nowBent ? dragPinnedN : dragNowN };
        if (bent.drag > stiff.drag * 1.3 && bent.lift < stiff.lift) {
          return `더 휜 종이는 날개가 ${fmt1(bent.flex)}도 휘며 펄럭여서, 막는 힘이 ${gfText(stiff.drag)} g에서 ${gfText(bent.drag)} g으로 커지고 뜨는 힘은 ${gfText(stiff.lift)} g에서 ${gfText(bent.lift)} g으로 줄었어요. 그래서 세게 던질 때는 덜 휘는 빳빳한 종이가 좋아요.`;
        }
      }
      return `한 종이는 ${fmt1(Math.max(a, b))}도, 다른 종이는 ${fmt1(Math.min(a, b))}도 휘었어요. 그래서 세게 던질 때는 덜 휘는 빳빳한 종이가 좋아요.`;
    }
  }
}

/** 힘 화살표의 길이(m). 무게 화살표를 기준 길이로 삼고 나머지는 뉴턴에 비례한다. 너무 길면 자른다. */
export const ARROW_WEIGHT_LEN_M = 0.055;
export const ARROW_MAX_RATIO = 2.6;
export function arrowLength(forceN: number, weightN: number): { lengthM: number; clipped: boolean } {
  if (!(weightN > 0) || !Number.isFinite(forceN)) return { lengthM: 0, clipped: false };
  const ratio = forceN / weightN;
  const clipped = Math.abs(ratio) > ARROW_MAX_RATIO;
  return { lengthM: clamp(ratio, -ARROW_MAX_RATIO, ARROW_MAX_RATIO) * ARROW_WEIGHT_LEN_M, clipped };
}
