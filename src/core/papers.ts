/**
 * 종이 목록.
 * 모두 A4(0.210 x 0.297 m)이고 재질(평량, 두께, 탄성 계수)만 다르다.
 * - 평량(gsm)은 무게를 정한다: 무게 = 평량 x 넓이.
 * - 두께와 탄성 계수는 굽힘 강성(E * t^3 / 12)을 정한다. 얇은 종이는 빠르게 던지면 날개가 휜다.
 * 값은 시판 종이의 대표적인 범위에서 고른 것이다(두께 60~200 마이크로미터, 탄성 계수 2~5 GPa).
 *
 * 설명 문구는 물리 2판(PHYSICS_VERSION 2, 던지기 한도 10 m/s)의 계산 결과와 맞춰 두었다. 근거(기본 프리셋 기준):
 *  - 살살(4 m/s) 던지면 가벼운 종이일수록 멀리, 오래 간다(글라이더: 신문지 6.5 m / 2.4 초, 켄트지 4.3 m / 1.3 초).
 *  - 힘껏(10 m/s) 던지면 신문지는 날개가 펄럭이며 속도를 잃어 일반 복사지보다 2~5 m 덜 간다.
 *  - 무거운 종이는 안정 속도가 빨라(다트: 복사지 5.5, 켄트지 7.8 m/s) 힘껏 던져야 제 실력이 나온다.
 * 물리나 프리셋을 바꾸면 이 문구가 여전히 참인지 tests/leaderboard.test.ts 의 "종이의 쓸모" 시험으로 확인한다.
 */
import type { PaperSpec } from './types';

const A4_W = 0.21;
const A4_H = 0.297;

export const PAPERS: PaperSpec[] = [
  {
    id: 'newsprint',
    nameKo: '신문지',
    descriptionKo: '아주 가벼워서 살살 던져도 천천히 오래 떠요. 흐물흐물해서 세게 던지면 날개가 펄럭이며 힘이 빠져요.',
    widthM: A4_W, heightM: A4_H, gsm: 45, thicknessM: 68e-6, youngsModulusPa: 2.2e9,
  },
  {
    id: 'copy60',
    nameKo: '얇은 복사지',
    descriptionKo: '가벼워서 천천히 오래 떠요. 일반 복사지보다 잘 휘어서 힘껏 던지면 조금 손해예요.',
    widthM: A4_W, heightM: A4_H, gsm: 60, thicknessM: 78e-6, youngsModulusPa: 3.0e9,
  },
  {
    id: 'copy80',
    nameKo: '일반 복사지',
    descriptionKo: '무게와 빳빳함의 균형이 좋은 기준 종이예요. 살살 던져도 세게 던져도 무난해요. 약 5 g.',
    widthM: A4_W, heightM: A4_H, gsm: 80, thicknessM: 100e-6, youngsModulusPa: 3.5e9,
  },
  {
    id: 'copy100',
    nameKo: '고급 복사지',
    descriptionKo: '조금 무겁고 빳빳해서 세게 던져도 모양이 유지돼요. 살살 던지면 금방 내려앉아요.',
    widthM: A4_W, heightM: A4_H, gsm: 100, thicknessM: 118e-6, youngsModulusPa: 4.0e9,
  },
  {
    id: 'craft120',
    nameKo: '색지(도화지)',
    descriptionKo: '두껍고 무거워 빠르게 날아야 떠요. 힘껏 던지는 뾰족한 비행기에 잘 맞아요.',
    widthM: A4_W, heightM: A4_H, gsm: 120, thicknessM: 150e-6, youngsModulusPa: 3.2e9,
  },
  {
    id: 'kent160',
    nameKo: '켄트지',
    descriptionKo: '가장 무겁고 단단해요. 거의 휘지 않지만 힘껏 던져야 하고, 속도가 떨어지면 금방 가라앉아요.',
    widthM: A4_W, heightM: A4_H, gsm: 160, thicknessM: 195e-6, youngsModulusPa: 4.2e9,
  },
];

/** 기본 종이(일반 복사지)의 id */
export const DEFAULT_PAPER_ID = 'copy80';

/** id 로 종이를 찾는다. 없으면 undefined. */
export function getPaper(id: string): PaperSpec | undefined {
  if (typeof id !== 'string') return undefined;
  for (const p of PAPERS) if (p.id === id) return p;
  return undefined;
}
