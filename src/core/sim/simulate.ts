/**
 * 비행 계산의 공개 함수.
 *
 *  - simulate(형상, 던지기) -> 결과(거리, 체공 시간, 판정, 진단, 재생용 표본)
 *  - validateThrow(값) -> 던지기 입력 검사
 *
 * 실제 계산은 integrator.ts(6자유도 적분)와 verdict.ts(판정과 진단)에 있다.
 * 같은 입력이면 항상 같은 결과가 나온다(고정 시간 간격, 무작위 없음, 시계 사용 없음).
 */
import type { FlightSample, FlightStructure, PlaneGeometry, SimResult, ThrowInput, ValidationResult } from '../types';
import { LIMITS } from '../types';
import { analyzeModel } from '../aero/analyze';
import { prepareModel } from '../aero/forces';
import { runFlight, safeThrowSpeed } from './integrator';
import { classifyFlight } from './verdict';

/** 던지기 입력이 규칙(유한한 숫자, 한도 안)에 맞는지 검사한다. 서버는 이 검사를 통과한 값만 계산한다. */
export function validateThrow(x: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof x !== 'object' || x === null || Array.isArray(x)) {
    return { ok: false, errors: ['던지기 값이 올바른 형식이 아니에요.'] };
  }
  const o = x as Record<string, unknown>;
  const check = (key: string, label: string, unit: string, min: number, max: number): void => {
    const v = o[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`${label} 값이 숫자가 아니에요.`);
    } else if (v < min || v > max) {
      errors.push(`${label}는 ${min}~${max}${unit} 사이여야 해요.`);
    }
  };
  check('speedMps', '던지는 속도', ' m/s', LIMITS.throwSpeedMin, LIMITS.throwSpeedMax);
  check('pitchDeg', '던지는 각도', '도', LIMITS.pitchMin, LIMITS.pitchMax);
  check('rollDeg', '좌우 기울기', '도', LIMITS.rollMin, LIMITS.rollMax);
  return { ok: errors.length === 0, errors };
}

function clampNum(v: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 비행 한 번을 계산한다.
 * 던지기 값은 validateThrow 를 통과했다고 가정하지만, 혹시 벗어난 값이 와도 계산이 터지지 않도록 한도 안으로 자른다.
 */
export function simulate(geom: PlaneGeometry, throwIn: ThrowInput): SimResult {
  const th: ThrowInput = {
    speedMps: clampNum(throwIn.speedMps, LIMITS.throwSpeedMin, LIMITS.throwSpeedMax, LIMITS.throwSpeedMin),
    pitchDeg: clampNum(throwIn.pitchDeg, LIMITS.pitchMin, LIMITS.pitchMax, 0),
    rollDeg: clampNum(throwIn.rollDeg, LIMITS.rollMin, LIMITS.rollMax, 0),
  };
  const model = prepareModel(geom);
  const track = runFlight(geom, th, model);
  const analysis = analyzeModel(model, geom);
  const safe = safeThrowSpeed(model, LIMITS.throwSpeedMin, LIMITS.throwSpeedMax);
  const d = classifyFlight(geom, th, track, analysis, safe);

  // 구조 설명: 손 안에서 꺾였는지, 날다가 꺾였는지, 아슬아슬했는지
  let noteKo: string | null = null;
  if (track.collapsedAtLaunch) {
    noteKo = '종이가 너무 흐물흐물해서 던지는 순간 날개가 접혀 버렸어요. 던진 힘이 비행기에 제대로 실리지 않았어요.';
  } else if (track.buckled) {
    noteKo = '날아가는 도중에 바람을 못 이기고 날개가 꺾였어요.';
  } else if (track.peakLoadRatio >= 0.7) {
    noteKo = '날개가 꺾이기 직전까지 휘었어요. 이보다 세게 던지면 접힐 수 있어요.';
  }
  const structure: FlightStructure = {
    collapsedAtLaunch: track.collapsedAtLaunch,
    buckled: track.buckled,
    buckledAtS: track.buckledAtS,
    peakLoadRatio: track.peakLoadRatio,
    maxFlexDeg: track.maxFlexDeg,
    safeThrowSpeedMps: safe,
    noteKo,
  };

  const samples: FlightSample[] = track.samples.map((s) => ({
    t: s.t, pos: s.pos, quat: s.quat, speed: s.speed, alphaDeg: s.alphaDeg,
  }));
  return {
    distanceM: Math.hypot(track.landing.x, track.landing.y),
    airtimeS: track.airtimeS,
    maxHeightM: track.maxHeightM,
    lateralM: track.landing.y,
    verdict: d.verdict,
    diagnosisKo: d.diagnosisKo,
    tipsKo: d.tipsKo,
    samples,
    structure,
  };
}
