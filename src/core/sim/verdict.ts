/**
 * 비행 판정과 진단.
 *
 * 비행 궤적(얼마나 돌았는지, 얼마나 솟았는지, 받음각이 얼마나 컸는지 등)을 보고 비행 종류를 정하고,
 * 형상 분석 결과(무게중심 위치, 안정 속도, 승강타 각도 등)와 던진 값을 견주어
 * "왜 그렇게 날았는지"를 한 문장으로 설명한다. 그리고 다음에 바꿔 볼 것을 최대 3개 제안한다.
 */
import type { FlightVerdict, PlaneGeometry, ThrowInput } from '../types';
import { LIMITS } from '../types';
import { AIR } from '../aero/coefficients';
import type { AnalysisDetail } from '../aero/analyze';
import type { FlightTrack } from './integrator';

const DEG = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

export interface Diagnosis {
  verdict: FlightVerdict;
  diagnosisKo: string;
  tipsKo: string[];
}

/** 공기가 없다고 했을 때 같은 던지기로 바닥에 닿기까지 걸리는 시간(s). "그냥 떨어진 것"과 비교하는 기준. */
function ballisticTime(throwIn: ThrowInput): number {
  const vz = throwIn.speedMps * Math.sin(throwIn.pitchDeg * DEG);
  return (vz + Math.sqrt(vz * vz + 2 * AIR.g * LIMITS.launchHeightM)) / AIR.g;
}

/** 날개 띠들의 평균 뒷전 꺾기 각도(도) */
function meanElevatorDeg(geom: PlaneGeometry): number {
  let a = 0, s = 0;
  for (const e of geom.elements) {
    if (e.kind !== 'wing' || !Number.isFinite(e.flapRad) || !Number.isFinite(e.area)) continue;
    a += e.area; s += e.area * e.flapRad;
  }
  return a > 0 ? s / a / DEG : 0;
}

function fmt(x: number, digits = 1): string {
  return x.toFixed(digits);
}

export function classifyFlight(
  geom: PlaneGeometry, throwIn: ThrowInput, track: FlightTrack, a: AnalysisDetail,
  /** 날개가 손 안에서 버티는 가장 빠른 던지기 속도(m/s). 모르면 한도 값 */
  safeThrowSpeedMps: number = LIMITS.throwSpeedMax,
): Diagnosis {
  const samples = track.samples;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const airtime = track.airtimeS;
  const dx = track.landing.x, dy = track.landing.y;
  const distance = Math.hypot(dx, dy);
  const climb = track.maxHeightM - LIMITS.launchHeightM;
  const pitchRev = track.maxAbsPitchTurnRad / TWO_PI;
  const rollRev = Math.abs(track.rollTurnRad) / TWO_PI;
  const headingDeg = Math.abs(track.headingTurnRad) / DEG;

  // 실속 근처 받음각으로 난 시간 비율과, 마지막 0.2초의 하강 각도
  const stallLimit = Math.min(a.stallAlphaDeg - 4, 22);
  let nearStall = 0, counted = 0;
  for (const s of samples) {
    if (s.t < 0.1) continue;
    counted++;
    if (s.alphaDeg > stallLimit) nearStall++;
  }
  const nearStallFrac = counted > 0 ? nearStall / counted : 0;
  let endAngleDeg = 0;
  if (last !== undefined && first !== undefined) {
    let ref = first;
    for (const s of samples) { if (s.t <= last.t - 0.2) ref = s; else break; }
    const ddx = Math.hypot(last.pos.x - ref.pos.x, last.pos.y - ref.pos.y);
    const ddz = ref.pos.z - last.pos.z;
    endAngleDeg = Math.atan2(ddz, Math.max(ddx, 1e-6)) / DEG;
  }
  const tBall = ballisticTime(throwIn);
  const elevDeg = meanElevatorDeg(geom);
  const cgPct = Math.round(geom.stats.cgFracMac * 100);
  const trimV = a.trimSpeedMps;
  const speedRatio = trimV !== null && trimV > 0 ? throwIn.speedMps / trimV : null;
  const asymPct = Math.abs(geom.stats.asymmetry) * 100;
  const cgAft = a.pitchStability === 'tumble' || geom.stats.cgFracMac > 0.38;

  // ------------------------------------------------------------------
  // 1) 비행 종류 정하기 (위에서부터 먼저 해당하는 것)
  // ------------------------------------------------------------------
  let verdict: FlightVerdict;
  if (pitchRev >= 0.7 || rollRev >= 1 || track.invertedFrac >= 0.3) {
    verdict = 'tumble'; // 앞뒤로 한 바퀴 가까이 돌았거나, 옆으로 굴렀거나, 오래 뒤집혀 있었다
  } else if (headingDeg >= 60 || (headingDeg >= 30 && Math.abs(dy) > 0.4 * Math.abs(dx) && distance > 1)) {
    verdict = 'spiral'; // 진행 방향이 크게 돌아갔다
  } else if (track.highAlphaFrac >= 0.5) {
    verdict = 'flutter'; // 대부분의 시간을 바람을 크게 받는 자세(받음각 25도 이상)로 떨어졌다
  } else if (nearStallFrac >= 0.1 && (climb > 0.3 || nearStallFrac >= 0.25)) {
    verdict = 'stall'; // 솟아오른 뒤 실속했거나, 실속에 가까운 자세로 오래 날았다
  } else if ((airtime < 1.7 * tBall && endAngleDeg > 18) || endAngleDeg > 50) {
    verdict = 'dive'; // 그냥 던진 물체와 비슷하게 가파르게 떨어졌다
  } else if (nearStallFrac >= 0.1) {
    verdict = 'stall';
  } else {
    verdict = 'glide';
  }

  // ------------------------------------------------------------------
  // 2) 원인 설명과 제안
  // ------------------------------------------------------------------
  let diag = '';
  const tips: string[] = [];
  const tipSlower = trimV !== null ? `던지는 힘을 안정 속도인 약 ${fmt(trimV)} m/s 가까이로 줄여 보세요.` : '조금 약하게 던져 보세요.';
  const tipCgForward = '기수 쪽을 한 번 더 접거나 클립을 앞쪽에 끼워 무게중심을 앞으로 옮겨 보세요.';
  const tipCgBack = '기수 쪽에 겹친 부분을 줄이거나 클립을 뒤로 옮겨 무게중심을 조금 뒤로 보내 보세요.';
  const tipElevUp = '날개 뒷전을 5~10도 위로 꺾어 기수를 들어 주세요.';
  const tipElevLess = '날개 뒷전을 올려 꺾은 각도를 줄여 보세요.';
  const tipDihedral = '날개 끝이 조금 올라가도록 상반각을 주면 기울어져도 스스로 바로 서요.';

  switch (verdict) {
    case 'tumble':
      if (cgAft) {
        diag = `무게중심이 날개 시위의 ${cgPct}% 지점으로 너무 뒤에 있어서 기수가 들린 채 뒤집히며 떨어졌어요.`;
        tips.push(tipCgForward);
        if (elevDeg > 3) tips.push(tipElevLess);
      } else if (elevDeg > 8) {
        diag = `뒷전을 ${fmt(elevDeg, 0)}도나 올려 꺾어서 기수가 계속 들리다가 뒤로 넘어갔어요.`;
        tips.push(tipElevLess);
      } else if (speedRatio !== null && speedRatio > 1.5 && pitchRev >= 0.7) {
        diag = `이 비행기의 안정 속도(약 ${fmt(trimV ?? 0)} m/s)보다 훨씬 세게 던져서, 남는 양력에 기수가 들려 공중제비를 돌았어요.`;
        tips.push(tipSlower);
        tips.push('세게 던지고 싶다면 무게중심을 조금 앞으로 옮겨 안정 속도를 높여 보세요.');
      } else if (rollRev >= 1 || Math.abs(throwIn.rollDeg) >= 15) {
        diag = '옆으로 기운 채 날다가 바로 서지 못하고 굴러서 뒤집혔어요.';
        tips.push('날개를 수평으로 두고 던져 보세요.');
        tips.push(tipDihedral);
      } else if (throwIn.pitchDeg > 35) {
        diag = '너무 위를 향해 던져서 꼭대기에서 속도를 잃고 뒤로 넘어갔어요.';
        tips.push('던지는 각도를 10~20도로 낮춰 보세요.');
      } else {
        diag = '기수를 숙여 주는 힘이 모자라서 자세를 잃고 뒤집혔어요.';
        tips.push(tipCgForward);
      }
      break;

    case 'flutter':
      if (cgAft || (a.trimAlphaDeg !== null && a.trimAlphaDeg > 25)) {
        diag = `무게중심이 날개 시위의 ${cgPct}% 지점으로 뒤에 있어서, 날개가 바람을 거의 정면으로 받으며 낙엽처럼 흔들리다 떨어졌어요.`;
        tips.push(tipCgForward);
        if (elevDeg > 3) tips.push(tipElevLess);
      } else if (elevDeg > 8) {
        diag = `뒷전을 ${fmt(elevDeg, 0)}도나 올려 꺾어서 기수가 너무 들린 채 힘없이 떨어졌어요.`;
        tips.push(tipElevLess);
      } else {
        diag = '속도를 잃은 뒤 날개가 바람을 크게 받는 자세로 흔들리며 떨어졌어요.';
        tips.push(tipSlower);
        tips.push('던지는 각도를 낮춰 보세요.');
      }
      break;

    case 'stall':
      if (a.trimAlphaDeg !== null && a.trimAlphaDeg > stallLimit - 6 && elevDeg <= 6) {
        diag = `무게중심이 조금 뒤(시위의 ${cgPct}%)에 있어 받음각이 약 ${fmt(a.trimAlphaDeg, 0)}도로 크게 유지되어 실속에 가깝게 날았어요.`;
        tips.push(tipCgForward);
      } else if (elevDeg > 6 && !(speedRatio !== null && speedRatio > 1.8)) {
        diag = `뒷전을 ${fmt(elevDeg, 0)}도 올려 꺾어서 기수가 지나치게 들리며 실속했어요.`;
        tips.push(tipElevLess);
      } else if (throwIn.pitchDeg > 30) {
        diag = `${fmt(throwIn.pitchDeg, 0)}도로 너무 위를 향해 던져서 올라가다 속도를 잃고 실속했어요.`;
        tips.push('던지는 각도를 5~15도로 낮춰 보세요.');
      } else if (speedRatio !== null && speedRatio > 1.3 && climb > 0.3) {
        diag = `안정 속도(약 ${fmt(trimV ?? 0)} m/s)보다 세게 던져서 ${fmt(climb)} m 나 솟아오른 뒤 속도를 잃고 실속했어요.`;
        tips.push(tipSlower);
        tips.push('세게 던질 때는 던지는 각도를 낮추거나 무게중심을 조금 앞으로 옮겨 보세요.');
      } else {
        diag = '기수가 들리며 속도를 잃어 실속했다가 다시 떨어지는 출렁임이 생겼어요.';
        tips.push(tipSlower);
        tips.push(tipCgForward);
      }
      break;

    case 'dive':
      if (a.pitchStability === 'nose-heavy' && elevDeg < -2) {
        diag = `뒷전이 아래로 ${fmt(-elevDeg, 0)}도 꺾여 있어 기수가 눌리며 급강하했어요.`;
        tips.push('뒷전을 평평하게 펴거나 살짝 위로 올려 보세요.');
      } else if (a.pitchStability === 'nose-heavy') {
        diag = `무게중심이 날개 시위의 ${cgPct}% 지점으로 너무 앞에 있어서 기수를 들 힘이 모자라 급강하했어요.`;
        tips.push(tipElevUp);
        tips.push(tipCgBack);
      } else if (throwIn.pitchDeg < -8) {
        diag = `아래쪽(${fmt(throwIn.pitchDeg, 0)}도)을 향해 던져서 기수를 들기 전에 바닥에 닿았어요.`;
        tips.push('수평이나 조금 위를 향해 던져 보세요.');
      } else if (speedRatio !== null && speedRatio < 0.75) {
        diag = `안정 속도(약 ${fmt(trimV ?? 0)} m/s)보다 약하게 던져서 양력이 모자라 곧바로 떨어졌어요.`;
        tips.push(`약 ${fmt(trimV ?? 0)} m/s 정도로 조금 더 세게 던져 보세요.`);
      } else if (a.pitchStability === 'tumble' || a.pitchStability === 'marginal') {
        diag = '자세를 잡지 못하고 기수부터 떨어졌어요. 무게중심 위치가 맞지 않아요.';
        tips.push(tipCgForward);
      } else {
        diag = '기수가 숙여진 채 속도만 붙어 가파르게 떨어졌어요.';
        tips.push(tipElevUp);
      }
      break;

    case 'spiral':
      if (asymPct > 2) {
        diag = `좌우 날개 넓이가 약 ${fmt(asymPct, 0)}% 달라서 한쪽으로 계속 휘며 나선을 그렸어요.`;
        tips.push('좌우 날개가 같은 크기가 되도록 접는 선을 맞춰 보세요.');
      } else if (Math.abs(throwIn.rollDeg) >= 8) {
        diag = `${fmt(Math.abs(throwIn.rollDeg), 0)}도 기울여 던져서 기운 쪽으로 계속 돌며 내려갔어요.`;
        tips.push('날개를 수평으로 두고 던져 보세요.');
        tips.push(tipDihedral);
      } else if (a.lateralStability === 'unstable') {
        diag = '좌우 안정성이 부족해서 작은 기울어짐이 점점 커지며 한쪽으로 돌았어요.';
        tips.push(tipDihedral);
        tips.push('동체(용골)를 조금 더 깊게 접어 보세요.');
      } else {
        diag = '좌우 날개의 꺾임이 서로 달라 한쪽으로 휘어 날았어요.';
        tips.push('좌우 날개의 뒷전과 날개 끝 각도를 똑같이 맞춰 보세요.');
      }
      break;

    case 'glide':
    default: {
      const late = samples.filter((s) => s.t >= airtime * 0.5);
      let v = 0, al = 0;
      for (const s of late) { v += s.speed; al += s.alphaDeg; }
      const n = Math.max(1, late.length);
      diag = `받음각 약 ${fmt(al / n, 0)}도, 속도 약 ${fmt(v / n)} m/s 로 안정적으로 활공했어요.`;
      if (speedRatio !== null && speedRatio > 1.4 && climb > 0.5) {
        diag = `세게 던진 힘으로 ${fmt(Math.max(0, climb))} m 솟아오른 뒤 안정 속도(약 ${fmt(trimV ?? 0)} m/s)로 돌아와 활공했어요.`;
      } else if (speedRatio !== null && speedRatio < 0.75) {
        tips.push(`안정 속도인 약 ${fmt(trimV ?? 0)} m/s 에 가깝게 조금 더 세게 던지면 더 멀리 가요.`);
      }
      if (a.glideRatio !== null && a.glideRatio < 3) {
        tips.push('활공비가 낮아요. 날개를 넓게 접거나 무게중심을 조금 뒤로 옮겨 받음각을 키워 보세요.');
      }
      if (Math.abs(dy) > 0.25 * Math.max(distance, 1)) {
        tips.push('옆으로 많이 벗어났어요. 좌우 대칭과 던질 때의 기울임을 확인해 보세요.');
      }
      break;
    }
  }

  // 종이가 버티지 못한 경우는 어떤 판정이든 가장 먼저 알려 준다(다른 조언보다 이것부터 고쳐야 한다).
  const structTips: string[] = [];
  if (track.collapsedAtLaunch) {
    const safe = Math.floor(safeThrowSpeedMps * 10) / 10;
    structTips.push(safe > LIMITS.throwSpeedMin + 0.05
      ? `종이가 흐물흐물해서 던지는 순간 날개가 접혔어요. 약 ${fmt(safe)} m/s 보다 살살 던지거나 더 빳빳한 종이를 써 보세요.`
      : '종이가 흐물흐물해서 던지는 순간 날개가 접혔어요. 앞쪽을 더 접어 날개를 빳빳하게 만들거나 더 두꺼운 종이를 써 보세요.');
  } else if (track.buckled) {
    structTips.push('날아가는 도중에 날개가 바람을 못 이기고 꺾였어요. 조금 약하게 던지거나 더 빳빳한 종이를 써 보세요.');
  } else if (track.maxFlexDeg > 20) {
    structTips.push(`날개 끝이 최대 약 ${fmt(track.maxFlexDeg, 0)}도까지 휘었어요. 더 두꺼운 종이를 쓰거나 조금 약하게 던져 보세요.`);
  }

  return { verdict, diagnosisKo: diag, tipsKo: [...structTips, ...tips].slice(0, 3) };
}
