/**
 * e2e 검사용 도우미: 출발선 조준의 규칙(힘 막대 눈금 <-> 빠르기, 세 구역, 한도)을 JSON 으로 찍는다.
 * 검사 스크립트(.mjs)가 숫자를 따로 적어 두지 않고 화면과 같은 상수(src/app/lib/power.ts, aimMath.ts, core 의 LIMITS)를 쓰게 하려는 것이다.
 * 실행: npx tsx scripts/e2e-aim-data.ts
 */
import { LIMITS } from '../src/core/index';
import { DRAG_DEG_PER_PX, SWEEP_MS, TAP_MS } from '../src/app/components/aimMath';
import {
  DEFAULT_THROW_SPEED, GAUGE_EASE, HARD_START_MPS, ORDINARY_THROW_MPS, POWER_WORD, SOFT_END_MPS, ZONE_HARD_START, ZONE_SOFT_END,
  gaugeToSpeed, powerWord, powerZone,
} from '../src/app/lib/power';
import { DEFAULT_THROW } from '../src/app/state';
import { STAMP_GOALS } from '../src/app/lib/kidvoice';
import { STICKER_GOALS } from '../src/app/lib/stickers';

/** 눈금 0, 0.01, ..., 1 의 빠르기와 구역(검사 스크립트가 같은 표로 견준다) */
const table = Array.from({ length: 101 }, (_, i) => {
  const speed = gaugeToSpeed(i / 100);
  return { g: i / 100, speed, zone: powerZone(speed), word: powerWord(speed) };
});

console.log(JSON.stringify({
  degPerPx: DRAG_DEG_PER_PX,
  tapMs: TAP_MS,
  sweepMs: SWEEP_MS,
  ease: GAUGE_EASE,
  speedMin: LIMITS.throwSpeedMin,
  speedMax: LIMITS.throwSpeedMax,
  pitchMin: LIMITS.pitchMin,
  pitchMax: LIMITS.pitchMax,
  ordinary: ORDINARY_THROW_MPS,
  zoneSoftEnd: ZONE_SOFT_END,
  zoneHardStart: ZONE_HARD_START,
  softEndMps: SOFT_END_MPS,
  hardStartMps: HARD_START_MPS,
  words: POWER_WORD,
  defaultThrow: DEFAULT_THROW,
  defaultSpeed: DEFAULT_THROW_SPEED,
  stamps: STAMP_GOALS,
  stickers: STICKER_GOALS,
  table,
}));
