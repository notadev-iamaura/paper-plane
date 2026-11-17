/**
 * 아이에게 말하듯 바꾸는 말 모음.
 * core 가 돌려주는 값과 문장은 어른(연구자) 말투라서, 본 화면에서는 여기서 쉬운 말로 바꿔 보여 준다.
 * 원래 문장은 연구 노트에서 그대로 볼 수 있다.
 */
import type { AeroSummary, FlightStructure, FlightVerdict, GameMode, PaperSpec, SimResult } from '../../core/index';
import { PAPERS } from '../../core/index';

// ---------------------------------------------------------------------------
// 종목과 도장
// ---------------------------------------------------------------------------
export const EVENT_NAME: Record<GameMode, string> = { distance: '멀리 날리기', airtime: '오래 날리기' };

export type Grade = 'great' | 'good' | 'again';
export const STAMP_TEXT: Record<Grade, string> = { great: '참 잘했어요', good: '잘했어요', again: '한 번 더!' };

/**
 * 도장 등급의 문턱. 물리 2판(던지기 한도 10 m/s)에서 실제로 나오는 범위에 맞췄다.
 * 기본 접는 법 x 종이 x 던지기를 잰 값: 거리 가운데 8.2 m / 위 25% 10.2 m / 위 10% 11.9 m,
 * 시간 가운데 2.3 초 / 위 25% 2.6 초 / 위 10% 2.8 초.
 *   잘했어요: 보통 비행의 가운데쯤(8 m, 2.2 초)을 넘으면.
 *   참 잘했어요: 열에 하나쯤 나오는 좋은 비행(12 m, 3.0 초)이면.
 */
export const STAMP_GOALS = {
  distance: { great: 12, good: 8 },
  airtime: { great: 3.0, good: 2.2 },
} as const;

export function gradeOf(mode: GameMode, r: Pick<SimResult, 'distanceM' | 'airtimeS'>): Grade {
  const goal = STAMP_GOALS[mode];
  const v = mode === 'distance' ? r.distanceM : r.airtimeS;
  return v >= goal.great ? 'great' : v >= goal.good ? 'good' : 'again';
}

/** 비행 판정을 아이 말로 */
export const VERDICT_LINE: Record<FlightVerdict, string> = {
  glide: '슈웅, 멋지게 날았어요!',
  stall: '위로 솟았다가 힘이 빠졌어요.',
  dive: '코부터 콕 박혔어요.',
  tumble: '빙글빙글 돌았어요.',
  spiral: '한쪽으로 휘어 갔어요.',
  flutter: '나풀나풀 떨어졌어요.',
};

/** 기록장에 쓰는 짧은 이름 */
export const VERDICT_SHORT: Record<FlightVerdict, string> = {
  glide: '슈웅',
  stall: '솟았다 뚝',
  dive: '콕',
  tumble: '빙글빙글',
  spiral: '휘어짐',
  flutter: '나풀나풀',
};

/** 연구 노트에서 쓰는 원래 이름 */
export const VERDICT_TECH: Record<FlightVerdict, string> = {
  glide: '안정 활공',
  stall: '실속',
  dive: '급강하',
  tumble: '뒤집힘',
  spiral: '나선 강하',
  flutter: '낙엽처럼 흔들림',
};

// ---------------------------------------------------------------------------
// 종이가 버텼는지(구조): core 의 SimResult.structure 를 아이 말로
// ---------------------------------------------------------------------------
/** collapsed 던지는 순간 접힘, buckled 날다가 꺾임, near 꺾일 뻔함(하중 비율 0.7 이상) */
export type StructureKind = 'collapsed' | 'buckled' | 'near';

export interface StructureWords {
  kind: StructureKind;
  /** 결과 패널의 한 줄 */
  line: string;
  /** "왜 이렇게 날았을까?"에 적는 풀이(무슨 일이 있었고, 어떻게 하면 되는지) */
  why: string;
}

/** 하중 비율이 이 값 이상이면 "아슬아슬했다"고 알려 준다(core 의 noteKo 와 같은 기준). */
export const NEAR_MISS_RATIO = 0.7;

/**
 * 종이가 던지는 힘과 바람을 못 버텼거나 아슬아슬했으면 그 이야기를, 아무 일 없었으면 null 을 돌려준다.
 * 뜻은 core 의 structure.noteKo 와 같고, 말투만 이 놀이의 것으로 맞췄다(고칠 방법은 tipsKo 의 첫 줄에 core 가 따로 적어 준다).
 */
export function structureWords(st: FlightStructure | null | undefined): StructureWords | null {
  if (!st) return null;
  if (st.collapsedAtLaunch) {
    return {
      kind: 'collapsed',
      line: '던지는 순간 날개가 흐물흐물 접혔어요.',
      why: '종이가 이 힘을 못 버텨서 손에서 떠날 때 날개가 접혔어요. 그래서 던진 힘이 비행기에 다 실리지 못했어요.',
    };
  }
  if (st.buckled) {
    return {
      kind: 'buckled',
      line: '날아가다가 날개가 바람에 꺾였어요.',
      why: '날아가는 도중에 날개가 바람을 못 이기고 꺾였어요. 꺾인 날개는 펄럭거려서 금방 힘이 빠져요.',
    };
  }
  if (st.peakLoadRatio >= NEAR_MISS_RATIO) {
    return {
      kind: 'near',
      line: '날개가 꺾일 듯 말 듯 휘면서 버텼어요.',
      why: '날개가 꺾이기 바로 앞까지 휘었어요. 휜 날개는 펄럭거려서 힘이 조금 빠져요. 더 빳빳한 종이로 바꾸면 세게 던져도 끄떡없어요.',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 진단 문장을 쉬운 말로
// ---------------------------------------------------------------------------
const REPLACEMENTS: readonly (readonly [RegExp, string])[] = [
  [/^받음각 약 \S+도, 속도 약 (\S+) m\/s 로 안정적으로 활공했어요\.$/, '1초에 $1 m쯤 가는 빠르기로 흔들림 없이 미끄러지듯 날았어요.'],
  [/활공비가 낮아요\./g, '앞으로 가는 것보다 빨리 내려와요.'],
  // 종이가 못 버틴 경우의 조언(core 의 structTips)
  [/약 (\S+) m\/s 보다 살살 던지거나/g, '힘을 $1보다 낮춰서 던지거나'],
  [/(\d) m 나 솟아/g, '$1 m나 솟아'],
  [/날개 끝이 최대 약 (\S+)도까지 휘었어요\./g, '날개 끝이 $1도쯤 위로 휘었어요.'],
  [/날개 시위의 (\d+)% 지점/g, '날개 앞에서 $1%쯤 되는 곳'],
  [/\(시위의 (\d+)%\)/g, '(날개 앞에서 $1%쯤)'],
  [/안정 속도인 약 (\S+) m\/s/g, '이 비행기가 좋아하는 빠르기(1초에 $1 m쯤)'],
  [/안정 속도\(약 (\S+) m\/s\)/g, '이 비행기가 좋아하는 빠르기(1초에 $1 m쯤)'],
  [/약 (\S+) m\/s 정도로/g, '1초에 $1 m쯤 가도록'],
  [/약 (\S+) m\/s/g, '1초에 $1 m쯤'],
  [/안정 속도/g, '이 비행기가 좋아하는 빠르기'],
  [/무게중심 위치가 맞지 않아요/g, '무게가 모이는 곳이 맞지 않아요'],
  [/무게중심/g, '무게가 모이는 곳'],
  [/받음각이 약 (\S+)도로 크게 유지되어/g, '날개가 바람을 너무 세게 맞아서'],
  [/받음각을 키워/g, '날개가 바람을 더 받게 해'],
  [/받음각/g, '날개가 바람을 맞는 각도'],
  [/실속에 가깝게 날았어요/g, '힘이 빠질 듯 말 듯 날았어요'],
  [/실속했어요/g, '힘이 빠졌어요'],
  [/실속했다가/g, '힘이 빠졌다가'],
  [/실속/g, '힘 빠짐'],
  [/안정적으로 활공했어요/g, '흔들림 없이 미끄러지듯 날았어요'],
  [/활공했어요/g, '미끄러지듯 날았어요'],
  [/활공/g, '미끄러지듯 날기'],
  [/남는 양력에/g, '뜨는 힘이 남아서'],
  [/양력이 모자라/g, '뜨는 힘이 모자라'],
  [/양력/g, '뜨는 힘'],
  [/상반각을 주면/g, '날개를 살짝 들어 주면'],
  [/\(상반각\)/g, ''],
  [/상반각/g, '날개 들기'],
  [/뒷전/g, '날개 뒤쪽 끝'],
  [/급강하했어요/g, '곤두박질쳤어요'],
  [/급강하/g, '곤두박질'],
  [/동체\(용골\)/g, '몸통'],
  [/동체/g, '몸통'],
  [/기수/g, '코'],
  [/나선을 그렸어요/g, '빙 돌았어요'],
  [/좌우 안정성이 부족해서/g, '좌우로 버티는 힘이 모자라서'],
  [/좌우 안정성이 부족해요/g, '좌우로 버티는 힘이 모자라요'],
  [/쯤 에 /g, '쯤에 '],
];

/**
 * core 가 조언 맨 앞에 적어 주는 "종이가 못 버틴 일"의 첫 문장. 결과 패널은 같은 이야기를 structureWords 의 풀이로 먼저 하므로,
 * 그 아래의 조언에서는 되풀이하지 않고 "어떻게 하면 되는지"만 남긴다.
 */
const STRUCT_TIP_HEADS: readonly RegExp[] = [
  /^종이가 흐물흐물해서 던지는 순간 날개가 접혔어요\.\s*/,
  /^날아가는 도중에 날개가 바람을 못 이기고 꺾였어요\.\s*/,
];

/** 조언 한 줄을 아이 말로. afterStructure: 종이가 못 버틴 풀이를 이미 보여 준 뒤인지 */
export function kidTip(tip: string, afterStructure: boolean): string {
  let t = tip;
  if (afterStructure) for (const re of STRUCT_TIP_HEADS) t = t.replace(re, '');
  return kidify(t);
}

/** core 의 진단, 제안 문장을 뜻은 그대로 두고 쉬운 낱말로 바꾼다. */
export function kidify(text: string): string {
  let out = text;
  for (const [re, to] of REPLACEMENTS) out = out.replace(re, to);
  return out;
}

// ---------------------------------------------------------------------------
// 종이
// ---------------------------------------------------------------------------
export interface PaperKid {
  /** 한 줄 소개 */
  line: string;
  /** 무게 단계 1(가벼움)~6(무거움) */
  weight: number;
  /** 빳빳함 단계 1(흐물흐물)~6(빳빳) */
  stiff: number;
}

const PAPER_LINES: Record<string, string> = {
  newsprint: '깃털처럼 가벼워요. 흐물흐물해서 살살 던져야 해요.',
  copy60: '가벼워서 천천히 오래 떠요. 조금 잘 휘어요.',
  copy80: '무게도 빳빳함도 딱 중간! 처음엔 이 종이가 좋아요.',
  copy100: '조금 묵직하고 빳빳해요. 세게 던져도 끄떡없어요.',
  craft120: '두껍고 무거워요. 힘껏 던져야 잘 떠요.',
  kent160: '가장 무겁고 단단해요. 힘센 친구에게 딱이에요.',
};

/** 굽힘 강성(E t^3)의 순위로 빳빳함 단계를 정한다. */
function stiffRank(p: PaperSpec): number {
  const s = (q: PaperSpec): number => q.youngsModulusPa * q.thicknessM ** 3;
  return PAPERS.filter((q) => s(q) < s(p)).length + 1;
}

function weightRank(p: PaperSpec): number {
  return PAPERS.filter((q) => q.gsm < p.gsm).length + 1;
}

export function paperKid(p: PaperSpec): PaperKid {
  return { line: PAPER_LINES[p.id] ?? p.descriptionKo, weight: weightRank(p), stiff: stiffRank(p) };
}

// ---------------------------------------------------------------------------
// 접는 법(다섯 가지 비행기)
// ---------------------------------------------------------------------------
export interface FoldKid { name: string; line: string }

const FOLD_KID: Record<string, FoldKid> = {
  dart: { name: '뾰족 화살', line: '빠르고 곧게 쌩 날아가요.' },
  glider: { name: '느긋한 글라이더', line: '천천히 오래 떠 있어요.' },
  hybrid: { name: '뭉툭코', line: '묵직해서 흔들림 없이 멀리 가요.' },
  delta: { name: '넓은 세모 날개', line: '날개가 넓어서 둥실둥실 떠다녀요.' },
  stealth: { name: '스텔스', line: '날개 끝을 세워 방향을 잘 잡아요.' },
};

export function foldKid(presetId: string, fallbackName: string): FoldKid {
  return FOLD_KID[presetId] ?? { name: fallbackName, line: '' };
}

export const DIFFICULTY_TEXT: Record<1 | 2 | 3, string> = { 1: '쉬워요', 2: '할 만해요', 3: '도전!' };

/** 접는 법마다 조금 바꿀 수 있는 값의 쉬운 이름 */
export const TWEAK_LABEL: Record<string, { label: string; hint: string }> = {
  noseFolds: { label: '앞쪽 접는 횟수', hint: '많이 접을수록 앞이 무거워져요.' },
  noseDepthM: { label: '한 번에 접는 폭', hint: '넓게 접을수록 앞이 묵직해져요.' },
  tipDepthM: { label: '코끝 접는 깊이', hint: '깊이 접을수록 코가 뭉툭해져요.' },
};

// ---------------------------------------------------------------------------
// 균형 저울과 예보
// ---------------------------------------------------------------------------
export type BalanceKind = 'front' | 'good' | 'back';

export interface Balance {
  kind: BalanceKind;
  label: string;
  hint: string;
  /** 저울 위 비행기가 기우는 각도(도). + 는 코가 내려간다. */
  tiltDeg: number;
}

export function balanceOf(s: AeroSummary): Balance {
  switch (s.pitchStability) {
    case 'nose-heavy':
      return { kind: 'front', label: '앞이 무거워요', hint: '꼬리를 올려 봐요', tiltDeg: 14 };
    case 'stable':
      return { kind: 'good', label: '딱 좋아요', hint: '이대로 던져요!', tiltDeg: 0 };
    case 'marginal':
      return { kind: 'back', label: '뒤가 무거워요', hint: '앞을 더 접어 봐요', tiltDeg: -9 };
    case 'tumble':
      return { kind: 'back', label: '뒤가 무거워요', hint: '앞을 더 접어 봐요', tiltDeg: -18 };
  }
}

/** 어떤 비행기가 될지 한마디 */
export function forecastOf(s: AeroSummary): string {
  if (s.pitchStability === 'tumble') return '빙글 돌기 쉬운 비행기';
  if (s.trimSpeedMps === null) return '아직 잘 못 나는 비행기';
  if (s.trimSpeedMps < 4.4) return '느긋한 비행기';
  if (s.trimSpeedMps < 5.8) return '씩씩한 비행기';
  return '빠른 비행기';
}

/** 던지는 힘을 세 단계 말로(경계는 lib/power.ts 가 LIMITS 에서 정한다) */
export { powerWord } from './power';
