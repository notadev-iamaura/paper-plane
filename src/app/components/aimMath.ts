/**
 * 출발선 조준에 쓰는 작은 계산 모음: 힘 막대 눈금 <-> 던지는 빠르기, 각도를 아이 말로.
 * 화면(ThrowLine, AngleStepper, PowerGauge)과 검사 스크립트가 같은 규칙을 쓴다.
 */
import { LIMITS } from '../../core/index';
import { clamp } from '../lib/format';

/** 장면을 위아래로 끌 때 1px 에 바뀌는 각도(도). 120px 끌면 36도. */
export const DRAG_DEG_PER_PX = 0.3;
/** 이보다 짧게 누르면 "톡": 지난번 힘 그대로 던진다(ms). */
export const TAP_MS = 180;
/** 힘 막대가 살살에서 세게까지 한 번 가는 데 걸리는 시간(ms). */
export const SWEEP_MS = 1200;
// 힘 막대의 규칙(눈금 <-> 빠르기, 살살 / 보통 / 세게)은 lib/power.ts 한곳에 있다.
export { GAUGE_EASE, gaugeToSpeed, speedToGauge, powerZone, powerWord, ZONE_SOFT_END, ZONE_HARD_START } from '../lib/power';

/** 0 -> 1 -> 0 -> 1 ... 로 오가는 값 */
export function pingPong(x: number): number {
  const m = ((x % 2) + 2) % 2;
  return m <= 1 ? m : 2 - m;
}

/** 각도를 아이 말로 */
export function angleWord(pitchDeg: number): string {
  if (pitchDeg <= -3) return '아래로';
  if (pitchDeg <= 3) return '똑바로';
  if (pitchDeg <= 20) return '살짝 위로';
  if (pitchDeg <= 40) return '위로';
  return '하늘 높이';
}

export function clampPitch(v: number): number {
  return clamp(Math.round(v), LIMITS.pitchMin, LIMITS.pitchMax);
}
