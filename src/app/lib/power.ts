/**
 * 던지는 힘의 규칙: 힘 막대 눈금(0~1) <-> 던지는 빠르기(m/s), 그리고 아이 말 세 단계(살살 / 보통 / 세게).
 * 화면(힘 막대, 세밀 조정, 실험실 쪽지), 기본 던지기 값, 검사 스크립트가 모두 이 파일 하나를 쓴다.
 *
 * 한도는 core 의 LIMITS(throwSpeedMin ~ throwSpeedMax, 지금은 2 ~ 10 m/s)에서 그대로 가져온다.
 * 손으로 정한 값은 ORDINARY_THROW_MPS 하나뿐이다. 한도가 바뀌어도 막대 가운데는 계속 "보통 던지기"이고,
 * 나머지(휘는 정도, 세 구역의 경계 속도, 기본 던지기, 막대 색 띠)는 모두 여기서 따라 나온다.
 *
 * 왜 6 m/s 인가 (물리 2판, 기본 접는 법 5가지 x 종이 6가지를 core 의 analyze 로 잰 값):
 *  - 비행기가 좋아하는 빠르기(안정 활공 속도)는 2.6 ~ 7.8 m/s, 가운데 값은 약 4.4 m/s 다.
 *  - 좋아하는 빠르기보다 조금 세게 던져야 높이를 잃지 않고 멀리 간다. 6 m/s 는 서른 대 가운데 스물여섯 대의
 *    좋아하는 빠르기보다 빠르거나 같아서, 처음 던지는 아이가 가운데에 놓고 던져도 대부분 "슈웅" 난다.
 *  - 한도 2 ~ 10 m/s 에서는 6 m/s 가 딱 한가운데라 막대가 곧은 자(휘는 정도 1)가 된다.
 * 세 구역은 막대 길이의 30% / 40% / 30% 다(지금 한도에서는 4.4 m/s 미만 살살, 7.6 m/s 이상 세게).
 *  - 살살: 가볍고 날개 넓은 비행기(좋아하는 빠르기 4.3 m/s 이하, 서른 대 중 열다섯 대)를 띄우는 힘.
 *  - 보통: 나머지 대부분(4.5 ~ 7.0 m/s)이 좋아하는 빠르기.
 *  - 세게: 거의 모든 비행기의 좋아하는 빠르기보다 세다. 무거운 종이의 뾰족한 비행기를 멀리 보낼 때 쓴다.
 */
import { LIMITS } from '../../core/index';

/** 막대 한가운데의 빠르기(m/s): 평범한 던지기. 손으로 정한 값은 이것 하나다(위 설명 참고). */
export const ORDINARY_THROW_MPS = 6;

/** 살살이 끝나는 눈금, 세게가 시작되는 눈금(막대 길이의 비율) */
export const ZONE_SOFT_END = 0.3;
export const ZONE_HARD_START = 0.7;

export const SPEED_MIN: number = LIMITS.throwSpeedMin;
export const SPEED_MAX: number = LIMITS.throwSpeedMax;
const SPAN = SPEED_MAX - SPEED_MIN;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * 막대가 휘는 정도. 눈금 g 의 빠르기는 최소 + 폭 x g^휨 이고, g = 0.5 에서 ORDINARY_THROW_MPS 가 되게 정한다.
 * 보통 던지기가 한도 밖(또는 끝)에 놓이는 이상한 한도에서는 곧은 자(1)로 둔다.
 */
export const GAUGE_EASE: number = (() => {
  const share = (ORDINARY_THROW_MPS - SPEED_MIN) / SPAN;
  if (!(share > 0.05 && share < 0.95)) return 1;
  return Number((Math.log(share) / Math.log(0.5)).toFixed(6));
})();

/** 막대 눈금(0~1) -> 던지는 빠르기(m/s, 0.1 단위) */
export function gaugeToSpeed(g: number): number {
  return round1(SPEED_MIN + SPAN * Math.pow(clamp01(g), GAUGE_EASE));
}

/** 던지는 빠르기(m/s) -> 막대 눈금(0~1) */
export function speedToGauge(speed: number): number {
  return Math.pow(clamp01((speed - SPEED_MIN) / SPAN), 1 / GAUGE_EASE);
}

/** 구역 경계의 빠르기(m/s, 0.1 단위). 이 값부터 다음 구역이다. */
export const SOFT_END_MPS: number = gaugeToSpeed(ZONE_SOFT_END);
export const HARD_START_MPS: number = gaugeToSpeed(ZONE_HARD_START);

export type PowerZone = 'soft' | 'mid' | 'hard';

/** 빠르기가 어느 구역인지. 경계는 0.1 m/s 로 맞춘 값이라 화면에 보이는 숫자와 어긋나지 않는다. */
export function powerZone(speedMps: number): PowerZone {
  const s = round1(speedMps);
  return s < SOFT_END_MPS ? 'soft' : s < HARD_START_MPS ? 'mid' : 'hard';
}

export const POWER_WORD: Record<PowerZone, string> = { soft: '살살', mid: '보통', hard: '세게' };

/** 던지는 힘을 세 단계 말로 */
export function powerWord(speedMps: number): string {
  return POWER_WORD[powerZone(speedMps)];
}

/** 처음 던질 때의 힘: 막대 한가운데 */
export const DEFAULT_THROW_SPEED: number = gaugeToSpeed(0.5);
