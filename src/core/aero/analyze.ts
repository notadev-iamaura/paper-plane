/**
 * 던지기 전에 보여주는 공기역학 분석.
 *
 * 비행 계산(sim/simulate.ts)과 똑같은 힘 모델(forces.ts)을 "회전 없이 일정한 속도로 나는 상태"에
 * 넣어 받음각별 양력, 항력, 피치 모멘트 곡선을 만든다. 그 곡선에서
 *  - 안정 받음각: 피치 모멘트가 0 이고, 받음각이 커지면 기수를 숙이는 쪽으로 바뀌는 점
 *  - 안정 활공 속도: 그 받음각에서 공기 힘이 무게와 같아지는 속도
 *  - 활공비: 그때의 양력 / 항력
 * 등을 읽어 낸다. 같은 모델을 쓰므로 여기서 나온 값과 실제 비행 계산이 서로 맞는다.
 */
import type { AeroSummary, PlaneGeometry } from '../types';
import { LIMITS } from '../types';
import { AIR } from './coefficients';
import { type AeroModel, findStableTrimDeg, prepareModel, steadyCoeffs } from './forces';

const DEG = Math.PI / 180;
const ALPHA_MIN = -10;
const ALPHA_MAX = 60;

type PolarPoint = { alphaDeg: number; cl: number; cd: number; cm: number };

function buildPolar(model: AeroModel, speed: number): PolarPoint[] {
  const polar: PolarPoint[] = [];
  for (let a = ALPHA_MIN; a <= ALPHA_MAX; a++) {
    const c = steadyCoeffs(model, a * DEG, 0, speed);
    polar.push({ alphaDeg: a, cl: c.cl, cd: c.cd, cm: c.cm });
  }
  return polar;
}

/** 안정 받음각 찾기. 규칙은 forces.ts 의 findStableTrimDeg 에 있다(풍동과 같은 규칙을 쓴다). */
function findTrim(model: AeroModel, polar: PolarPoint[], speed: number): number | null {
  return findStableTrimDeg(model, speed, ALPHA_MIN, ALPHA_MAX, polar.map((p) => p.cm));
}

/** 내부용 상세 결과. 비행 진단에서도 쓴다. */
export interface AnalysisDetail extends AeroSummary {
  /** 안정 활공 시 양력 계수 (없으면 null) */
  trimCl: number | null;
  /** 옆미끄럼에 대한 롤, 요 복원 계수 (1/rad). + 면 안정. */
  rollRestoring: number;
  yawRestoring: number;
}

export function analyzeModel(model: AeroModel, geom: PlaneGeometry): AnalysisDetail {
  const S = model.refAreaM2;
  const weight = model.massKg * AIR.g;
  const notes: string[] = [];

  // 종이 휨과 레이놀즈수가 속도에 따라 달라지므로, 속도를 5 m/s 로 가정해 시작한 뒤
  // 안정 활공 속도가 구해지면 그 속도로 다시 계산하는 것을 몇 번 되풀이한다.
  let speed = 5;
  let polar: PolarPoint[] = [];
  let trimAlpha: number | null = null;
  let trimSpeed: number | null = null;
  let trimCl: number | null = null;
  let glideRatio: number | null = null;
  for (let iter = 0; iter < 12; iter++) {
    polar = buildPolar(model, speed);
    trimAlpha = findTrim(model, polar, speed);
    trimSpeed = null; glideRatio = null; trimCl = null;
    if (trimAlpha === null) break;
    const c = steadyCoeffs(model, trimAlpha * DEG, 0, speed);
    trimCl = c.cl;
    if (c.cl > 0.02 && c.cd > 0) {
      // 안정 활공에서는 양력과 항력을 합친 공기 힘이 무게와 같다.
      const v = Math.sqrt((2 * weight) / (AIR.rho * S * Math.hypot(c.cl, c.cd)));
      trimSpeed = v;
      glideRatio = c.cl / c.cd;
      if (Math.abs(v - speed) < 0.005) break;
      speed = Math.min(40, Math.max(0.5, v));
    } else {
      break;
    }
  }

  // 최대 양항비와 실속 받음각.
  // 실속 받음각은 받음각을 키워 갈 때 양력 계수가 처음으로 꺾이는 점이다.
  // (평판은 실속 뒤 40도 근처에서 양력이 다시 조금 오르기도 하므로 "가장 큰 값"이 아니라 "첫 꼭대기"를 쓴다.)
  let maxLD = 0;
  let stallAlpha = 0;
  let clMax = -Infinity;
  let foundPeak = false;
  for (let i = 0; i < polar.length; i++) {
    const p = polar[i]!;
    if (p.alphaDeg <= 0) continue;
    if (p.cd > 1e-6) maxLD = Math.max(maxLD, p.cl / p.cd);
    if (foundPeak) continue;
    if (p.cl > clMax) { clMax = p.cl; stallAlpha = p.alphaDeg; }
    const next = polar[i + 1];
    if (next !== undefined && next.cl < p.cl && p.cl > 0) foundPeak = true;
  }

  // 중립점: 받음각이 조금 변할 때 늘어난 양력이 걸리는 위치.
  // 안정 받음각이 있으면 그 근처에서, 없으면 작은 받음각(1~5도)에서 구한다.
  // 평판은 받음각에 따라 작용점이 뒤로 가므로, 이 값은 고정된 25% 점보다 조금 뒤에 나온다.
  const aRef = trimAlpha !== null && trimAlpha > 1 && trimAlpha < 40 ? trimAlpha : 3;
  const cA = steadyCoeffs(model, (aRef - 2) * DEG, 0, speed);
  const cB = steadyCoeffs(model, (aRef + 2) * DEG, 0, speed);
  const dCl = cB.cl - cA.cl;
  const dCmdCl = Math.abs(dCl) > 1e-6 ? (cB.cm - cA.cm) / dCl : 0;
  const staticMargin = -dCmdCl;
  const neutralPointX = geom.cg.x - staticMargin * model.macM;

  // 세로(피치) 안정성 판정
  let pitchStability: AeroSummary['pitchStability'];
  if (trimAlpha === null) {
    const c5 = polar.find((p) => p.alphaDeg === 5);
    pitchStability = c5 !== undefined && c5.cm > 0 ? 'tumble' : 'nose-heavy';
  } else if (trimAlpha < 1 || trimSpeed === null || trimSpeed > LIMITS.throwSpeedMax + 1) {
    // 안정 속도가 던질 수 있는 가장 빠른 속도보다도 빠르면, 아무리 세게 던져도 양력이 모자라 기수부터 떨어진다.
    pitchStability = 'nose-heavy';
  } else if (trimAlpha >= 40) {
    pitchStability = 'tumble';
  } else if (trimAlpha > stallAlpha - 3) {
    pitchStability = 'marginal';
  } else {
    pitchStability = 'stable';
  }

  // 좌우 안정성: 옆으로 3도 미끄러질 때 생기는 롤, 요 모멘트를 본다.
  //  - 요 복원(풍향계 효과): 미끄러지는 쪽으로 기수가 돌아가면 안정. 용골과 날개 끝 세움이 만든다.
  //  - 롤 복원(상반각 효과): 미끄러지는 쪽 날개가 들리면 안정.
  const aLat = (trimAlpha !== null && trimAlpha > 0 && trimAlpha < 40 ? trimAlpha : 5) * DEG;
  const b = 3 * DEG;
  const cp = steadyCoeffs(model, aLat, b, speed);
  const cm = steadyCoeffs(model, aLat, -b, speed);
  const yawRestoring = (cp.cyaw - cm.cyaw) / (2 * b);
  const rollRestoring = (cp.croll - cm.croll) / (2 * b);
  let lateralStability: AeroSummary['lateralStability'];
  if (yawRestoring < -0.002 || rollRestoring < -0.02) lateralStability = 'unstable';
  else if (yawRestoring > 0.004 && rollRestoring > 0.005) lateralStability = 'stable';
  else lateralStability = 'neutral';

  const reynolds = (speed * model.macM) / AIR.nu;

  // --- 한국어 요약 ---
  const cgPct = Math.round(geom.stats.cgFracMac * 100);
  if (pitchStability === 'stable' && trimAlpha !== null && trimSpeed !== null && glideRatio !== null) {
    notes.push(`받음각 약 ${trimAlpha.toFixed(1)}도, 속도 약 ${trimSpeed.toFixed(1)} m/s 에서 안정적으로 활공해요.`);
    notes.push(`활공비는 약 ${glideRatio.toFixed(1)} 이에요. 1 m 내려가는 동안 약 ${glideRatio.toFixed(1)} m 나아가요.`);
  } else if (pitchStability === 'nose-heavy') {
    notes.push(`무게중심이 날개 시위의 ${cgPct}% 지점으로 앞쪽에 치우쳐 있어 기수가 숙여지기 쉬워요. 뒷전을 조금 올려 접으면 좋아요.`);
  } else if (pitchStability === 'tumble') {
    notes.push(`무게중심이 날개 시위의 ${cgPct}% 지점으로 너무 뒤에 있어요. 기수가 들리며 뒤집히기 쉬워요.`);
  } else if (trimAlpha !== null) {
    notes.push(`안정 받음각이 약 ${trimAlpha.toFixed(0)}도로 실속각(약 ${stallAlpha.toFixed(0)}도)에 가까워요. 느리게 떨어지듯 날 수 있어요.`);
  }
  notes.push(`날개 가로세로비는 ${geom.stats.aspectRatio.toFixed(1)}, 실속 받음각은 약 ${stallAlpha.toFixed(0)}도예요.`);
  if (lateralStability === 'unstable') notes.push('좌우 안정성이 부족해요. 날개 끝을 조금 올리거나(상반각) 동체를 깊게 접어 보세요.');
  else if (lateralStability === 'stable') notes.push('좌우로 흔들려도 스스로 바로잡는 형태예요.');
  if (Math.abs(geom.stats.asymmetry) > 0.02) notes.push('좌우 날개 넓이가 달라 한쪽으로 휘어 날 수 있어요.');
  if (trimSpeed !== null) {
    const c = steadyCoeffs(model, (trimAlpha ?? 5) * DEG, 0, speed);
    const flexDeg = Math.max(Math.abs(c.thetaL), Math.abs(c.thetaR)) / DEG;
    if (flexDeg > 8) notes.push(`종이가 얇아 활공 중에도 날개 끝이 약 ${flexDeg.toFixed(0)}도 휘어요. 세게 던지면 더 크게 휘어요.`);
  }

  return {
    polar,
    trimAlphaDeg: trimAlpha,
    trimSpeedMps: trimSpeed,
    glideRatio,
    maxLD,
    stallAlphaDeg: stallAlpha,
    neutralPointX,
    staticMargin,
    pitchStability,
    lateralStability,
    reynolds,
    notesKo: notes,
    trimCl,
    rollRestoring,
    yawRestoring,
  };
}

/** 형상의 공기역학 요약을 계산한다. */
export function analyze(geom: PlaneGeometry): AeroSummary {
  const d = analyzeModel(prepareModel(geom), geom);
  // 공개 타입(AeroSummary)에 있는 값만 돌려준다.
  return {
    polar: d.polar,
    trimAlphaDeg: d.trimAlphaDeg,
    trimSpeedMps: d.trimSpeedMps,
    glideRatio: d.glideRatio,
    maxLD: d.maxLD,
    stallAlphaDeg: d.stallAlphaDeg,
    neutralPointX: d.neutralPointX,
    staticMargin: d.staticMargin,
    pitchStability: d.pitchStability,
    lateralStability: d.lateralStability,
    reynolds: d.reynolds,
    notesKo: d.notesKo,
  };
}
