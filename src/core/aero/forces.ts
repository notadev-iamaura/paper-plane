/**
 * 공기 힘 모델 (분석과 비행 계산이 함께 쓰는 단 하나의 힘 계산).
 *
 * 방법: 띠 이론(strip theory).
 *  - 비행기를 날개 폭 방향의 가느다란 띠(AeroElement)로 나눈다.
 *  - 띠마다 "그 위치에서 공기가 어느 방향, 어느 속도로 지나가는지"를 구한다.
 *    기체가 회전하고 있으면 위치마다 속도가 다르다(v + ω × r). 이 항 덕분에
 *    회전을 줄이는 감쇠(피치, 롤, 요 감쇠)가 따로 넣지 않아도 생긴다.
 *  - 띠의 법선과 시위 방향으로 받음각을 구하고, 평판 계수(coefficients.ts)로 힘을 구한다.
 *  - 모든 띠의 힘과 모멘트(무게중심 기준)를 더한다.
 *
 * 용골(동체)과 날개 끝 세움은 법선이 옆을 향할 뿐 같은 식을 쓴다. 옆바람(옆미끄럼)이 생기면
 * 이 면들이 옆힘을 만들어 방향 안정성이 생긴다. 상반각은 날개 띠의 법선이 기울어진 것으로 나타난다.
 * 좌우가 다른 형상이면 좌우 띠의 힘이 달라 저절로 돌게 된다.
 *
 * 종이의 구조(추정 모델): 아래 STRUCT 설명 참고. 날개 뿌리에 걸리는 굽힘 모멘트와 종이의 굽힘 강성으로
 * 날개 끝이 얼마나 들리는지 구하고, 한계를 넘으면 날개가 꺾인(좌굴) 상태가 된다. 흐물흐물한 날개는 펄럭이며 항력을 만든다.
 *
 * 항력 예산: 받음각 0 근처의 항력(기생 항력)은 상수 하나가 아니라 아래 항목을 형상에서 더해 만든다.
 *  1) 표면 마찰: 띠마다 레이놀즈수로 계산(층류 + 앞전 박리 거품 뒤의 난류). coefficients.ts 의 frictionCoeff.
 *  2) 뭉툭한 가장자리: 겹쳐 접은 앞전의 두께, 잘린 뒷전의 두께만큼 정면으로 바람을 받는다.
 *  3) 동체(용골): 앞끝의 겹 뭉치, 뒤끝의 벌어진 틈(밑면 항력).
 *  4) 손으로 접은 날개의 울퉁불퉁함(추정 상수).
 *  5) 꺾인 뒷전(승강타), 6) 펄럭임(아래 STRUCT).
 * 일반 복사지 프리셋에서 합은 약 0.022(다트)~0.040(앞을 두껍게 만 넓은 날개)이고, 속도가 올라가도
 * 예전 모델(층류 마찰 x 배수 하나)처럼 0.015 까지 떨어지지 않는다. 종이비행기의 실측 최대 양항비 4~6 에서
 * 거꾸로 셈한 범위(0.02~0.045)와 맞는다.
 *
 * 이 모델에 없는 것(알려진 한계. 고칠 때 참고)
 *  - 바람, 돌풍, 던질 때의 손 떨림이 없다. 그래서 정적 여유가 1~5% 뿐인 "겨우 안정한" 설계도 흐트러지지 않고 난다.
 *  - 앞전 흡입력은 없다고 본다(날카로운 종이 앞전). 날개가 살짝 굽은 면(캠버)을 갖는 효과도 없다.
 *  - 구조는 날개의 폭 방향 굽힘 하나만 본다. 시위 방향으로 말리는 것, 기수가 처지는 것, 동체가 벌어지는 것은 없다.
 *  - 펄럭임은 "항력 계수 하나"로만 나타낸다. 실제로 떨리는 운동(양력의 출렁임)은 계산하지 않는다.
 *  - 종이 두께는 강성에서 거꾸로 어림한다(PlaneGeometry 에 두께가 없어서). 오차 약 +-15%.
 *  - 길쭉한 용골의 작용점은 추정이다(coefficients.ts 의 centerOfPressureFrac).
 *  - 땅 가까이에서 양력이 늘어나는 효과(지면 효과)는 없다.
 */
import type { PlaneGeometry } from '../types';
import {
  AIR, COEF, centerOfPressureFrac, clamp, plateParams,
} from './coefficients';

/**
 * 종이 구조 모델의 조정값. 모두 "추정"이다(종이비행기 날개의 구조 실험값은 찾지 못했다).
 *
 * 생각의 뼈대 (주니어 개발자를 위한 설명)
 *  - 날개 한쪽은 동체에 붙은 뿌리를 따라 고정된 얇은 판이다. 뿌리에 굽힘 모멘트 M 이 걸리면
 *    날개 끝은 θ = M · L / (3 · D · c) 만큼 들린다. (L = 한쪽 날개 길이, c = 뿌리 시위, D = 단위 폭당 굽힘 강성.
 *    고르게 눌리는 직사각형 날개의 pL³/6D, 삼각 날개의 pL³/18D 가 모두 이 한 식으로 나온다.)
 *  - D 는 종이 한 겹의 E·t³/12 에서 출발한다. 겹이 n 장이면 서로 미끄러질 때 n 배, 풀로 붙이면 n³ 배다.
 *    접은 종이는 접힌 선에서 이어져 있어 그 사이인 n^1.5 배로 본다(layerExponent).
 *  - 접은 단(앞전을 만 부분 등)은 뼈대처럼 날개를 빳빳하게 한다(creaseStiffening 배). 접은 곳이 거의 없는
 *    종이(평균 겹 수 1 근처)는 이 보강이 없다. 그래서 거의 접지 않은 종이는 던질 수 없고 다트는 던질 수 있다.
 *  - 한계: 선형으로 계산한 휨이 buckleRad(약 35도)를 넘으면 접은 단의 보강이 무너져 날개가 뿌리에서 꺾인다(좌굴).
 *    꺾인 날개는 위로 접혀 양력을 잃고, 한번 꺾인 종이는 그 비행 동안 약해진 채로 남는다(creasedStiffness 배).
 *    줄자를 굽히면 어느 순간 '툭' 꺾이고 그 뒤로는 힘없이 접히는 것과 같은 현상이다.
 *  - 펄럭임: 동압이 강성에 비해 크면 날개가 깃발처럼 떨며 항력을 만든다. 정도는
 *    Λ = (동압) x (수직력 계수 1 일 때의 선형 휨, rad/Pa) 로 재고, Λ 가 flutterOnset 을 넘으면 급히 커져
 *    flutterCd 에 이른다. 잔잔히 나부끼는 깃발의 항력 계수는 0.05~0.15(Hoerner)지만, 날개 길이의 30~40% 폭으로
 *    크게 펄럭이는 종이는 그만큼 정면으로 바람을 막으므로(막힌 넓이 x 평판 항력 약 1) 0.3 으로 잡았다.
 */
export const STRUCT = {
  /** 날개 끝 휨 각도의 기하학적 한계(rad). 약 80도: 양쪽 날개가 머리 위에서 맞닿는 정도. */
  maxTipRad: 1.4,
  /** 날개가 힘을 받아 휘는 데 걸리는 시간(s). 종이 날개의 굽힘 떨림 주기(수십 Hz)에 해당. */
  responseTimeS: 0.03,
  /**
   * 접은 단, 겹친 가장자리, 종이의 살짝 굽은 면이 보강재처럼 작용해 평평한 종이 한 장보다 덜 휘는 배수(추정).
   * 평평한 복사지는 8 cm 만 내밀어도 제 무게로 1 cm 넘게 처지지만, 접은 종이비행기 날개는 그렇지 않다.
   */
  creaseStiffening: 3,
  /** 날개의 평균 겹 수가 1 + 이 값 이상이면 접은 단의 보강을 온전히 받는다고 본다. 그보다 적으면 비례해서 줄인다. */
  creaseFullAtExtraLayers: 0.3,
  /** 겹 수 n 에 대한 굽힘 강성의 지수. 1 = 겹끼리 완전히 미끄러짐, 3 = 풀로 붙임. 접힌 선에서 이어진 종이는 그 사이(추정). */
  layerExponent: 1.5,
  /** 선형 휨이 이 각도(rad, 약 35도)를 넘으면 날개가 꺾인다. */
  buckleRad: 0.61,
  /** 한번 꺾인 날개에 남는 강성 비율 */
  creasedStiffness: 0.5,
  /** 펄럭임이 시작되는 Λ 와, 완전히 펄럭일 때의 항력 계수(날개 면적 기준) */
  flutterOnset: 5,
  flutterCd: 0.3,
  /** 뒷전이 앞전보다 약해서 생기는 비틀림의 비율(휨 각도 대비) */
  trailingEdgeTwist: 0.3,
  /**
   * 던지는 팔이 그리는 호 때문에 손 안의 비행기는 바람과 정확히 나란하지 않다. 손을 떠나기 직전 날개가 받는
   * 받음각을 이 값(도)으로 본다(추정). 이 하중을 날개가 버티지 못하면 손 안에서 이미 꺾인다.
   */
  handAlphaDeg: 6,
  /** 종이 두께를 강성에서 거꾸로 어림할 때 쓰는 대표 탄성 계수(Pa) */
  nominalYoungPa: 3.5e9,
} as const;

/** 마찰 계수 계산용 상수 (frictionCoeff 와 같은 값) */
const LAM_MAX = COEF.blasius / Math.sqrt(500);
const BUBBLE_SIN2 = Math.sin(COEF.bubbleAlphaDeg * Math.PI / 180) ** 2;

/** 미리 계산해 둔 띠 하나. 계산 속도를 위해 벡터를 낱개 숫자로 풀어 둔다. */
interface Strip {
  /** PlaneGeometry.elements 에서의 순번 (풍동 계측용) */
  elemIndex: number;
  isWing: boolean;
  /** 휨을 적용할 쪽: +1 왼쪽, -1 오른쪽, 0 적용 안 함(동체) */
  flexSide: number;
  /** 날개 뿌리 0 ~ 날개 끝 1 */
  eta: number;
  /** 앞전 중점 - 무게중심 */
  lx: number; ly: number; lz: number;
  /** 앞전 -> 뒷전 단위 벡터 */
  dx: number; dy: number; dz: number;
  /** 법선 */
  nx: number; ny: number; nz: number;
  /** 폭 방향 축 (법선 × 앞 방향) */
  sx: number; sy: number; sz: number;
  chord: number;
  width: number;
  area: number;
  layers: number;
  kp: number; kv: number; stallRad: number; stallWidthRad: number; cn90: number; slender: number;
  flapSin: number;
  /** 마찰 계수를 빨리 구하려고 미리 계산해 둔 값: 층류 = aLam / sqrt(속도), 난류 = aTurb / 속도^0.2 */
  aLam: number;
  aTurb: number;
  /** 속도와 무관한 기생 항력 계수(띠 면적 기준): 뭉툭한 가장자리, 동체 앞끝과 뒤끝, 손접기 울퉁불퉁함, 꺾인 뒷전 */
  parasite: number;
  /** 날개 뿌리의 접은 선에서 이 띠 가운데까지 면을 따라 잰 거리(m). 뿌리 굽힘 모멘트의 팔 길이. 날개 띠만 */
  ySpan: number;
}

/** PlaneGeometry 를 힘 계산용으로 정리한 것 */
export interface AeroModel {
  strips: Strip[];
  massKg: number;
  refAreaM2: number;
  macM: number;
  /** 한쪽 날개 길이(m) */
  semiSpanM: number;
  /** 단위 폭당 굽힘 강성 (N m). 겹과 접은 단의 보강을 반영한 값 (왼쪽, 오른쪽) */
  bendStiffnessL: number;
  bendStiffnessR: number;
  wingAreaL: number;
  wingAreaR: number;
  /** 뿌리 굽힘 모멘트 1 N m 가 걸릴 때 날개 끝이 들리는 각도(rad). L / (3 D c) */
  complianceL: number;
  complianceR: number;
  /** 날개 전체에 넓이당 수직력 1 N/m^2 가 고르게 걸릴 때의 선형 휨(rad/Pa). 펄럭임 정도 Λ = 동압 x 이 값 */
  flexPerPaL: number;
  flexPerPaR: number;
  /** 어림한 종이 두께(m) */
  paperThicknessM: number;
  /**
   * 휨이 비틀림(받음각 변화)으로 바뀌는 비율(왼쪽, 오른쪽). + 면 위로 휠 때 받음각이 줄어든다.
   * prepareModel 의 설명 참고.
   */
  twistCouplingL: number;
  twistCouplingR: number;
}

/** 힘 계산 결과 (기체 좌표, 모멘트는 무게중심 기준) */
export interface AeroOut {
  fx: number; fy: number; fz: number;
  mx: number; my: number; mz: number;
  /** 왼쪽, 오른쪽 날개가 받는 수직력 합(N). */
  loadL: number;
  loadR: number;
  /** 왼쪽, 오른쪽 날개 뿌리에 걸리는 굽힘 모멘트(N m). 날개를 위로 꺾는 쪽이 +. 휨과 꺾임 계산에 쓴다. */
  momL: number;
  momR: number;
}

/**
 * 띠별 계측값을 받아 적는 그릇(풍동 화면용). computeAero 에 넘기면 띠마다 힘과 작용점을 채워 준다.
 * 비행 계산은 넘기지 않으므로 속도에 영향이 없다. 배열 길이는 model.strips.length.
 */
export interface StripRecord {
  /** 이 띠가 받는 공기 힘 합 (기체 좌표, N). 수직력 + 마찰 + 승강타 힘 */
  fx: Float64Array; fy: Float64Array; fz: Float64Array;
  /** 수직력이 걸리는 점 (무게중심 기준, m) */
  rx: Float64Array; ry: Float64Array; rz: Float64Array;
  /** 띠가 느끼는 받음각의 사인, 코사인 */
  sinA: Float64Array; cosA: Float64Array;
  /** 흐름이 붙어 있는 정도 (1 = 붙음, 0 = 완전히 떨어짐) */
  attached: Float64Array;
}

export function newStripRecord(n: number): StripRecord {
  const f = (): Float64Array => new Float64Array(n);
  return { fx: f(), fy: f(), fz: f(), rx: f(), ry: f(), rz: f(), sinA: f(), cosA: f(), attached: f() };
}

export function newAeroOut(): AeroOut {
  return { fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0, loadL: 0, loadR: 0, momL: 0, momR: 0 };
}

function finiteOr(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback;
}

/** 한쪽 날개 띠들의 1/4 시위점이 폭 방향으로 얼마나 뒤로 물러나는지(후퇴각)를 면적 가중 직선 맞춤으로 구한다. */
function sweepSine(strips: Strip[], side: number): number {
  let sw = 0, sy = 0, sx = 0, syy = 0, sxy = 0;
  for (const s of strips) {
    if (!s.isWing || s.flexSide !== side) continue;
    const y = Math.abs(s.ly + s.dy * s.chord * 0.25);
    const x = s.lx + s.dx * s.chord * 0.25;
    sw += s.area; sy += s.area * y; sx += s.area * x; syy += s.area * y * y; sxy += s.area * x * y;
  }
  if (sw <= 0) return 0;
  const varY = syy / sw - (sy / sw) * (sy / sw);
  if (varY < 1e-10) return 0;
  const slope = (sxy / sw - (sx / sw) * (sy / sw)) / varY; // dx/dy. 뒤로 젖혀지면 음수
  const tan = clamp(-slope, -4, 4);
  return tan / Math.sqrt(1 + tan * tan);
}

/** 형상에서 힘 계산용 모델을 만든다. 한 번만 만들어 두고 계속 쓴다. */
export function prepareModel(geom: PlaneGeometry): AeroModel {
  const strips: Strip[] = [];
  const semiSpan = Math.max(1e-3, finiteOr(geom.stats.spanM, 0.1) / 2);
  let areaL = 0, areaR = 0;
  for (let ei = 0; ei < geom.elements.length; ei++) {
    const e = geom.elements[ei]!;
    const chord = finiteOr(e.chord, 0);
    const area = finiteOr(e.area, 0);
    if (!(chord > 1e-5) || !(area > 1e-9)) continue; // 넓이가 없는 띠는 힘도 없다
    // 시위 방향을 단위 벡터로
    let dx = finiteOr(e.chordDir.x, -1), dy = finiteOr(e.chordDir.y, 0), dz = finiteOr(e.chordDir.z, 0);
    let len = Math.hypot(dx, dy, dz);
    if (len < 1e-9) { dx = -1; dy = 0; dz = 0; len = 1; }
    dx /= len; dy /= len; dz /= len;
    // 법선을 시위 방향과 직각이 되도록 다듬는다
    let nx = finiteOr(e.normal.x, 0), ny = finiteOr(e.normal.y, 0), nz = finiteOr(e.normal.z, 1);
    const dot = nx * dx + ny * dy + nz * dz;
    nx -= dot * dx; ny -= dot * dy; nz -= dot * dz;
    len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) {
      // 법선이 잘못 들어온 경우: 시위와 직각인 아무 방향이나 고른다
      if (Math.abs(dz) < 0.9) { nx = -dz * dx; ny = -dz * dy; nz = 1 - dz * dz; } else { nx = 1 - dx * dx; ny = -dx * dy; nz = -dx * dz; }
      len = Math.hypot(nx, ny, nz);
    }
    nx /= len; ny /= len; nz /= len;
    // 앞 방향 f = -d. 폭 방향 s = n × f
    const fx = -dx, fy = -dy, fz = -dz;
    const sx = ny * fz - nz * fy, sy = nz * fx - nx * fz, sz = nx * fy - ny * fx;
    const p = plateParams(e.surfaceAR);
    const isWing = e.kind === 'wing';
    const flexSide = e.kind === 'keel' || e.side === 'C' ? 0 : e.side === 'L' ? 1 : -1;
    const lx = e.le.x - geom.cg.x, ly = e.le.y - geom.cg.y, lz = e.le.z - geom.cg.z;
    const midY = e.le.y + dy * chord * 0.5;
    const flap = clamp(finiteOr(e.flapRad, 0), -0.6, 0.6);
    const sinFlap = Math.sin(flap);
    strips.push({
      elemIndex: ei,
      isWing, flexSide, eta: clamp(Math.abs(midY) / semiSpan, 0, 1),
      lx, ly, lz, dx, dy, dz, nx, ny, nz, sx, sy, sz,
      chord, width: area / chord, area, layers: finiteOr(e.layers, 1),
      kp: p.kp, kv: p.kv, stallRad: p.stallRad, stallWidthRad: p.stallWidthRad, cn90: p.cn90, slender: p.slender,
      flapSin: sinFlap,
      aLam: COEF.blasius * Math.sqrt(AIR.nu / chord),
      aTurb: COEF.turbCf * Math.pow(AIR.nu / chord, 0.2),
      parasite: 0, // 아래에서 채운다
      ySpan: 0,
    });
    if (isWing && flexSide > 0) areaL += area;
    if (isWing && flexSide < 0) areaR += area;
  }
  // ---- 날개 한쪽씩: 뿌리에서 잰 거리, 뿌리 시위, 겹 수 ----
  const sideInfo = (side: number): { len: number; rootChord: number; rootLayers: number; meanLayers: number; firstMoment: number } => {
    const list = strips.filter((s) => s.isWing && s.flexSide === side)
      .sort((a, b) => Math.abs(a.ly + a.dy * a.chord * 0.5) - Math.abs(b.ly + b.dy * b.chord * 0.5));
    // 뿌리에서부터 띠 폭을 차례로 쌓아 폭 방향 위치를 정한다(상반각이 있어도 면을 따라 잰 길이가 된다).
    let pos = 0, area = 0, layerArea = 0, moment = 0;
    for (const s of list) {
      s.ySpan = pos + s.width / 2;
      pos += s.width;
      area += s.area; layerArea += s.area * Math.max(1, s.layers); moment += s.area * s.ySpan;
    }
    const root = list[0];
    return {
      len: Math.max(1e-3, pos),
      rootChord: Math.max(1e-3, root !== undefined ? root.chord : 0.1),
      rootLayers: Math.max(1, root !== undefined ? root.layers : 1),
      meanLayers: area > 0 ? layerArea / area : 1,
      firstMoment: moment,
    };
  };
  const infoL = sideInfo(1), infoR = sideInfo(-1);

  // ---- 굽힘 강성 (STRUCT 설명 참고) ----
  // stats.wingBendStiffnessNm 은 "E t³/12 x 뿌리 겹 수"(겹끼리 완전히 미끄러진다고 본 값)다. 여기에
  //  (1) 접힌 선에서 이어진 겹의 부분 합성 효과: 겹 수^(layerExponent - 1) 배,
  //  (2) 접은 단의 보강: 평균 겹 수가 1 이면 1배(보강 없음), 1.3 이상이면 creaseStiffening 배
  // 를 곱한다.
  const baseD = Math.max(1e-7, finiteOr(geom.stats.wingBendStiffnessNm, 1e-3));
  const stiffness = (info: { rootLayers: number; meanLayers: number }): number => {
    const hem = clamp((info.meanLayers - 1) / STRUCT.creaseFullAtExtraLayers, 0, 1);
    return baseD * Math.pow(info.rootLayers, STRUCT.layerExponent - 1) * (1 + (STRUCT.creaseStiffening - 1) * hem);
  };
  const dL = stiffness(infoL), dR = stiffness(infoR);
  const compliance = (info: { len: number; rootChord: number }, d: number): number => info.len / (3 * d * info.rootChord);
  const cL = compliance(infoL, dL), cR = compliance(infoR, dR);

  // ---- 종이 두께 어림: D = E t³/12 x 뿌리 겹 수 에서 거꾸로 (탄성 계수는 대표값. 세제곱근이라 오차가 작다) ----
  const rootN = Math.max(1, (infoL.rootLayers + infoR.rootLayers) / 2);
  const thickness = clamp(Math.cbrt((12 * baseD) / (rootN * STRUCT.nominalYoungPa)), 2e-5, 6e-4);

  // ---- 띠별 기생 항력 계수 (파일 머리말의 "항력 예산" 2~5번) ----
  let keelDepth = 0;
  for (const s of strips) if (s.flexSide === 0) keelDepth = Math.max(keelDepth, -(s.lz + geom.cg.z) + s.width / 2);
  for (const s of strips) {
    const layers = Math.max(1, s.layers);
    const stack = thickness * COEF.foldBulge;
    let c = COEF.flapDragCn * COEF.flapChordFrac * s.flapSin * s.flapSin; // 꺾인 뒷전이 바람을 막는 몫
    if (s.flexSide === 0) {
      // 동체: 앞끝은 겹 뭉치 두께만큼 정면으로 바람을 받고, 뒤끝은 겹 사이가 벌어진 틈만큼 밑면 항력이 생긴다.
      // 틈은 바닥 접은 선에서 0, 위(날개 쪽)로 갈수록 벌어진다.
      const nose = stack * layers;
      const above = clamp(keelDepth - (-(s.lz + geom.cg.z)), 0, keelDepth);
      const gap = nose + COEF.keelOpenTan * above;
      c += (COEF.keelNoseCd * nose + COEF.keelBaseCd * gap) / s.chord;
    } else {
      // 날개, 날개 끝: 겹쳐 접은 앞전의 두께 + 잘린 뒷전의 두께
      const front = stack * (1 + COEF.layerConcentration * (layers - 1));
      c += (COEF.bluntLeadingEdgeCd * front + COEF.bluntTrailingEdgeCd * thickness) / s.chord;
      if (s.isWing) c += COEF.handmadeCd;
    }
    s.parasite = c;
  }

  // 휨이 비틀림으로 바뀌는 정도 (추정).
  //  - 뿌리가 시위 전체에 걸쳐 동체에 붙어 있는 판 모양 날개는 접은 선(앞뒤 방향)을 축으로 통째로 들릴 뿐
  //    비틀리지 않는다. 휘는 선이 바람과 나란하기 때문이다. 폭 방향으로 긴 막대 같은 날개만 비틀린다.
  //    이 정도를 beam = (한쪽 날개 길이)^2 / (한쪽 날개 길이^2 + 뿌리 시위^2) 로 나타낸다.
  //  - 접힌 겹으로 단단한 앞전에 비해 뒷전은 한 겹이라 약해서, 힘을 받으면 뒷전이 더 밀린다(trailingEdgeTwist).
  //  - 뒤로 젖혀진 막대 같은 날개는 위로 휘면 바깥쪽 띠의 받음각이 줄어든다(후퇴각의 사인에 비례).
  //    판 모양 날개에서는 이 효과가 한 번 더 줄어든다(beam 을 한 번 더 곱한다).
  const twist = (info: { len: number; rootChord: number }, side: number): number => {
    const beam = (info.len * info.len) / (info.len * info.len + info.rootChord * info.rootChord);
    return beam * (STRUCT.trailingEdgeTwist + beam * sweepSine(strips, side));
  };
  return {
    strips,
    massKg: geom.massKg,
    refAreaM2: Math.max(1e-6, finiteOr(geom.stats.wingAreaM2, 0)),
    macM: Math.max(1e-4, finiteOr(geom.stats.macM, 0.1)),
    semiSpanM: semiSpan,
    bendStiffnessL: dL,
    bendStiffnessR: dR,
    wingAreaL: areaL,
    wingAreaR: areaR,
    complianceL: areaL > 0 ? cL : 0,
    complianceR: areaR > 0 ? cR : 0,
    flexPerPaL: areaL > 0 ? infoL.firstMoment * cL : 0,
    flexPerPaR: areaR > 0 ? infoR.firstMoment * cR : 0,
    paperThicknessM: thickness,
    twistCouplingL: twist(infoL, 1),
    twistCouplingR: twist(infoR, -1),
  };
}

/**
 * 날개 한쪽의 구조 상태. 비행 계산은 걸음마다 이 값을 갱신하고, 분석과 풍동은 힘과 맞아떨어질 때까지 되풀이해 구한다.
 */
export interface WingState {
  /** 날개 끝 휨 각도(rad). 위로 들리면 + */
  thetaL: number;
  thetaR: number;
  /** 날개가 꺾였는지(좌굴). 한번 꺾이면 그 비행 동안 되돌아가지 않는다. */
  buckledL: boolean;
  buckledR: boolean;
}

export function newWingState(): WingState {
  return { thetaL: 0, thetaR: 0, buckledL: false, buckledR: false };
}

/**
 * 뿌리 굽힘 모멘트에서 "선형으로 계산한" 날개 끝 휨 각도(rad). 꺾임 판정의 기준이 되는 값이다.
 * @param side +1 왼쪽, -1 오른쪽
 * @param buckled 이미 꺾인 날개면 강성이 creasedStiffness 배로 줄어 있다
 */
export function flexLinear(model: AeroModel, rootMomentNm: number, side: number, buckled = false): number {
  const c = side > 0 ? model.complianceL : model.complianceR;
  return (rootMomentNm * c) / (buckled ? STRUCT.creasedStiffness : 1);
}

/**
 * 뿌리 굽힘 모멘트에서 "충분히 시간이 지났을 때의" 날개 끝 휨 각도(rad)를 구한다. (추정 모델)
 * 작은 휨에서는 선형 값 그대로이고, 크게 휘면 양쪽 날개가 맞닿는 각도(약 80도)로 부드럽게 다가간다.
 * 모멘트가 위로 걸리면 +(날개 끝이 올라감), 아래로 걸리면 -(내려감).
 */
export function flexTarget(model: AeroModel, rootMomentNm: number, side: number, buckled = false): number {
  const linear = flexLinear(model, rootMomentNm, side, buckled);
  return STRUCT.maxTipRad * Math.tanh(linear / STRUCT.maxTipRad);
}

/** 날개 뿌리 굽힘 모멘트가 버티는 한계의 몇 배인지. 1 을 넘으면 꺾인다. (꺾이기 전 강성 기준) */
export function loadRatio(model: AeroModel, rootMomentNm: number, side: number): number {
  return Math.abs(flexLinear(model, rootMomentNm, side, false)) / STRUCT.buckleRad;
}

/**
 * 공기 힘 계산.
 * @param vx,vy,vz 무게중심의 속도 (기체 좌표, m/s). 바람이 없으므로 공기에 대한 속도와 같다.
 * @param wx,wy,wz 각속도 (기체 좌표, rad/s)
 * @param thetaL,thetaR 왼쪽, 오른쪽 날개 끝의 휨 각도(rad). 0 이면 휘지 않은 상태.
 * @param softL,softR 꺾인 날개의 강성 감소를 반영한 배수(온전하면 1, 꺾였으면 1 / creasedStiffness). 펄럭임 항력에 쓴다.
 */
export function computeAero(
  model: AeroModel,
  vx: number, vy: number, vz: number,
  wx: number, wy: number, wz: number,
  thetaL: number, thetaR: number,
  out: AeroOut,
  rec?: StripRecord,
  softL = 1, softR = 1,
): void {
  let Fx = 0, Fy = 0, Fz = 0, Mx = 0, My = 0, Mz = 0, loadL = 0, loadR = 0, momL = 0, momR = 0;
  const halfRho = 0.5 * AIR.rho;
  const strips = model.strips;
  // 펄럭임 항력(추정): Λ = 동압 x (수직력 계수 1 일 때의 선형 휨). Λ⁴/(Λc⁴+Λ⁴) 꼴로 급히 켜진다.
  // 떨리는 날개가 공기를 휘젓는 힘이므로 마찰처럼 판을 따라 미끄러지는 속도의 반대 방향으로 건다(항상 에너지를 잃는 방향).
  const qInf = halfRho * (vx * vx + vy * vy + vz * vz);
  const on4 = STRUCT.flutterOnset ** 4;
  const lamL = qInf * model.flexPerPaL * softL, lamR = qInf * model.flexPerPaR * softR;
  const l4 = lamL * lamL * lamL * lamL, r4 = lamR * lamR * lamR * lamR;
  const flutterL = STRUCT.flutterCd * (l4 / (on4 + l4)), flutterR = STRUCT.flutterCd * (r4 / (on4 + r4));
  // 표면 마찰 계수(coefficients.ts 의 frictionCoeff 와 같은 식). 레이놀즈수는 무게중심 속도와 띠의 시위로 잰다.
  // 속도의 거듭제곱은 띠마다 같으므로 한 번만 구해 둔다.
  const vInf = Math.max(1e-3, Math.sqrt(vx * vx + vy * vy + vz * vz));
  const lamV = 1 / Math.sqrt(vInf), turbV = Math.pow(vInf, -0.2);
  for (let i = 0; i < strips.length; i++) {
    const s = strips[i]!;
    if (rec !== undefined) {
      rec.fx[i] = 0; rec.fy[i] = 0; rec.fz[i] = 0;
      rec.rx[i] = s.lx + s.dx * s.chord * 0.25; rec.ry[i] = s.ly + s.dy * s.chord * 0.25; rec.rz[i] = s.lz + s.dz * s.chord * 0.25;
      rec.sinA[i] = 0; rec.cosA[i] = 1; rec.attached[i] = 1;
    }
    let nx = s.nx, ny = s.ny, nz = s.nz;
    let fx = -s.dx, fy = -s.dy, fz = -s.dz;

    // --- 종이 휨 반영 (추정 모델) ---
    if (s.flexSide !== 0) {
      const theta = s.flexSide > 0 ? thetaL : thetaR;
      if (theta !== 0) {
        // 고르게 힘을 받는 외팔보의 기울기 분포: 뿌리 0, 끝에서 최대
        const k = 1 - s.eta;
        const phi = theta * (1 - k * k * k);
        // (1) 위로 휘면서 비틀려 띠의 받음각이 줄어든다. eps > 0 이면 받음각 감소. 아래로 휘면 반대.
        const eps = phi * (s.flexSide > 0 ? model.twistCouplingL : model.twistCouplingR);
        const ce = Math.cos(eps), se = Math.sin(eps);
        const f1x = fx * ce - nx * se, f1y = fy * ce - ny * se, f1z = fz * ce - nz * se;
        const n1x = nx * ce + fx * se, n1y = ny * ce + fy * se, n1z = nz * ce + fz * se;
        // (2) 위로 휘면 법선이 안쪽으로 기운다(상반각이 커진 것과 같다).
        const cp = Math.cos(phi), sp = Math.sin(phi) * s.flexSide;
        nx = n1x * cp - s.sx * sp; ny = n1y * cp - s.sy * sp; nz = n1z * cp - s.sz * sp;
        fx = f1x; fy = f1y; fz = f1z;
      }
    }

    // --- 1차: 1/4 시위점의 속도로 받음각을 어림해 양력 작용점을 정한다 ---
    const c = s.chord;
    let rx = s.lx + s.dx * c * 0.25, ry = s.ly + s.dy * c * 0.25, rz = s.lz + s.dz * c * 0.25;
    let ux = vx + (wy * rz - wz * ry), uy = vy + (wz * rx - wx * rz), uz = vz + (wx * ry - wy * rx);
    let uf = ux * fx + uy * fy + uz * fz;
    let un = ux * nx + uy * ny + uz * nz;
    let U = Math.sqrt(uf * uf + un * un);
    if (U < 1e-6) continue; // 공기가 거의 지나가지 않으면 힘도 없다
    const xcp = centerOfPressureFrac(-un / U, uf / U, s);

    // --- 2차: 작용점에서의 속도로 힘을 구한다 ---
    // 힘을 "그 힘이 걸리는 점의 속도"로 계산하면 공기 힘이 항상 운동을 방해하는 쪽으로만 일해
    // 에너지가 저절로 늘어나는 일이 생기지 않는다.
    rx = s.lx + s.dx * c * xcp; ry = s.ly + s.dy * c * xcp; rz = s.lz + s.dz * c * xcp;
    ux = vx + (wy * rz - wz * ry); uy = vy + (wz * rx - wx * rz); uz = vz + (wx * ry - wy * rx);
    uf = ux * fx + uy * fy + uz * fz;
    un = ux * nx + uy * ny + uz * nz;
    U = Math.sqrt(uf * uf + un * un);
    if (U < 1e-6) continue;
    // 받음각: 바람이 판 아랫면을 때리면(판이 법선 반대쪽으로 움직이면) 양수
    const sinA = -un / U, cosA = uf / U;
    const q = halfRho * U * U; // 동압

    // 수직력 (법선 방향)
    // 수직력 계수: coefficients.ts 의 normalForceCoeff 와 같은 식을 풀어 쓴 것이다
    // (흐름이 붙어 있는 정도 w 를 승강타 계산에서도 다시 쓰려고 여기서 한 번만 구한다).
    const saAbs = sinA < 0 ? -sinA : sinA, caAbs = cosA < 0 ? -cosA : cosA;
    const wAtt = 1 / (1 + Math.exp((Math.asin(saAbs > 1 ? 1 : saAbs) - s.stallRad) / s.stallWidthRad));
    const cnAbs = wAtt * (s.kp * saAbs * caAbs + s.kv * saAbs * saAbs) + (1 - wAtt) * ((s.cn90 * saAbs) / (0.56 + 0.44 * saAbs));
    const cn = sinA >= 0 ? cnAbs : -cnAbs;
    const fn = q * s.area * cn;

    // 표면 마찰: 판을 따라 미끄러지는 속도 성분의 반대 방향
    const utx = ux - un * nx, uty = uy - un * ny, utz = uz - un * nz;
    const speed = Math.sqrt(ux * ux + uy * uy + uz * uz);
    let lam = s.aLam * lamV;
    if (lam > LAM_MAX) lam = LAM_MAX; // 레이놀즈수 하한(500)
    let turb = s.aTurb * turbV;
    if (turb < lam) turb = lam;
    const s2 = sinA * sinA;
    const wb = s2 / (s2 + BUBBLE_SIN2);
    let cf = COEF.frictionRoughness * (lam + (1 - wb) * lam + wb * turb) + s.parasite;
    if (s.isWing) cf += s.flexSide > 0 ? flutterL : flutterR;
    const kt = -halfRho * speed * s.area * cf;

    let px = fn * nx + kt * utx, py = fn * ny + kt * uty, pz = fn * nz + kt * utz;
    Fx += px; Fy += py; Fz += pz;
    Mx += ry * pz - rz * py; My += rz * px - rx * pz; Mz += rx * py - ry * px;
    let stripLoad = fn;
    if (rec !== undefined) {
      rec.fx[i] = px; rec.fy[i] = py; rec.fz[i] = pz;
      rec.rx[i] = rx; rec.ry[i] = ry; rec.rz[i] = rz;
      rec.sinA[i] = sinA; rec.cosA[i] = cosA;
      rec.attached[i] = wAtt;
    }

    // --- 승강타(뒷전 꺾기) ---
    // 뒷전을 위로 꺾으면 날개 뒤쪽이 아래로 눌려 양력이 줄고, 그 힘이 무게중심보다 뒤에 걸려 기수가 들린다.
    // 흐름이 떨어지면(실속) 효과가 크게 줄고, 뒤로 날 때는 없는 것으로 본다.
    if (s.flapSin !== 0 && cosA > 0) {
      const eff = COEF.flapTau * COEF.flapLowReFactor * (0.2 + 0.8 * wAtt) * cosA;
      const ff = -q * s.area * s.kp * eff * s.flapSin;
      px = ff * nx; py = ff * ny; pz = ff * nz;
      const gx = s.lx + s.dx * c * COEF.flapCp, gy = s.ly + s.dy * c * COEF.flapCp, gz = s.lz + s.dz * c * COEF.flapCp;
      Fx += px; Fy += py; Fz += pz;
      Mx += gy * pz - gz * py; My += gz * px - gx * pz; Mz += gx * py - gy * px;
      stripLoad += ff;
      if (rec !== undefined) { rec.fx[i] = rec.fx[i]! + px; rec.fy[i] = rec.fy[i]! + py; rec.fz[i] = rec.fz[i]! + pz; }
    }

    // --- 시위 방향으로 긴 판의 회전 감쇠 ---
    // 판이 폭 방향 축으로 돌면 앞쪽과 뒤쪽이 서로 반대로 공기를 밀어 회전을 늦춘다.
    // 띠 하나를 한 점으로만 보면 이 효과가 빠지므로 따로 더한다. M = -(동압·면적)·k·c²·ω/U 꼴이다.
    //  - 보통 날개의 붙은 흐름: 얇은 날개 이론의 준정상 감쇠, k = Kp/8
    //  - 길쭉한 면, 소용돌이 양력: 힘이 시위 전체에 고르게 걸린다고 보면 k = (힘의 받음각 기울기)/12
    //  - 떨어진 흐름: 판이 도는 속도 자체가 만드는 저항 M = -ρ·CN90·c⁴·폭·ω|ω| / 64
    const ws = wx * s.sx + wy * s.sy + wz * s.sz;
    if (ws !== 0) {
      const c3w = c * c * c * s.width;
      const sa = Math.abs(sinA), ca = Math.abs(cosA);
      const k = (s.kp * (1 - s.slender)) / 8 + (s.kp * s.slender + 2 * s.kv * sa * ca) / 12;
      const md = -0.5 * AIR.rho * U * c3w * k * ws - (AIR.rho * s.cn90 * c3w * c * ws * Math.abs(ws)) / 64;
      Mx += md * s.sx; My += md * s.sy; Mz += md * s.sz;
    }

    if (s.isWing) {
      if (s.flexSide > 0) { loadL += stripLoad; momL += stripLoad * s.ySpan; } else if (s.flexSide < 0) { loadR += stripLoad; momR += stripLoad * s.ySpan; }
    }
  }
  out.fx = Fx; out.fy = Fy; out.fz = Fz;
  out.mx = Mx; out.my = My; out.mz = Mz;
  out.loadL = loadL; out.loadR = loadR;
  out.momL = momL; out.momR = momR;
}

/** 정상 상태(회전 없음)에서의 계수. 분석 화면의 곡선과 안정 활공 계산에 쓴다. */
export interface SteadyCoeffs {
  cl: number;
  cd: number;
  /** 기수를 드는 방향이 + 인 피치 모멘트 계수 (무게중심 기준, 기준 길이 = 평균 공력 시위) */
  cm: number;
  /** 옆힘(+y), 롤(+x 축), 요(+z 축) 모멘트 계수. 기준 길이는 날개 폭. */
  cy: number;
  croll: number;
  cyaw: number;
  thetaL: number;
  thetaR: number;
}

/** 정상 상태(회전 없음, 휨이 힘과 맞아떨어진 상태)의 힘. steadyCoeffs 와 풍동이 함께 쓴다. */
export interface SteadyState {
  out: AeroOut;
  thetaL: number;
  thetaR: number;
  /** 종이가 버티지 못하고 꺾였는지 (왼쪽, 오른쪽, 둘 중 하나라도) */
  buckledL: boolean;
  buckledR: boolean;
  buckled: boolean;
  /** 뿌리 굽힘 / 버티는 한계 (꺾이기 전 강성 기준, 좌우 중 큰 쪽) */
  loadRatio: number;
  /** 기체 좌표 속도 */
  vx: number; vy: number; vz: number;
}

/**
 * 주어진 받음각, 옆미끄럼각, 속도에서 "충분히 시간이 지난 뒤"의 힘을 구한다.
 * 종이 휨은 힘과 휨이 서로 맞아떨어질 때까지 조금씩 고쳐 가며 구한다(비행 계산에서 시간이 충분히 지난 상태와 같다).
 * 온전한 날개로 시작해, 맞아떨어진 상태의 뿌리 굽힘이 한계를 넘으면 그 날개를 꺾인 상태로 바꿔 다시 구한다.
 * 받음각 정의: 기체 좌표에서 속도가 (cosα, ·, -sinα) 방향. 옆미끄럼이 + 면 왼쪽(+y)으로 미끄러진다.
 * @param rec 띠별 계측값을 받고 싶을 때만 넘긴다(마지막 계산의 값이 남는다).
 * @param start 이미 꺾인 날개로 시작하고 싶을 때(비행 중 꺾인 뒤의 상태) 넘긴다.
 */
export function steadySolve(
  model: AeroModel, alphaRad: number, betaRad: number, speed: number, withFlex = true, rec?: StripRecord,
  start?: { buckledL: boolean; buckledR: boolean },
): SteadyState {
  const out = newAeroOut();
  const cb = Math.cos(betaRad);
  const vx = speed * Math.cos(alphaRad) * cb;
  const vy = speed * Math.sin(betaRad);
  const vz = -speed * Math.sin(alphaRad) * cb;
  let thetaL = 0, thetaR = 0;
  let bL = start?.buckledL ?? false, bR = start?.buckledR ?? false;
  let ratio = 0;
  const soft = (b: boolean): number => (b ? 1 / STRUCT.creasedStiffness : 1);
  computeAero(model, vx, vy, vz, 0, 0, 0, 0, 0, out, rec, soft(bL), soft(bR));
  if (withFlex) {
    // 꺾임 상태가 바뀌면 처음부터 다시 맞춘다(많아야 좌우 한 번씩, 두 번).
    for (let pass = 0; pass < 3; pass++) {
      // 휨이 커지면 날개가 받는 힘이 줄어드므로(음의 되먹임) 한 번에 다 고치면 출렁이며 맞지 않을 수 있다.
      // 그래서 고칠 양의 일부(gainL, gainR)만 반영하고, 고칠 방향이 뒤집히면 그 비율을 반으로 줄인다(이분법처럼 반드시 모인다).
      let gainL = 0.5, gainR = 0.5, prevDl = 0, prevDr = 0;
      for (let it = 0; it < 80; it++) {
        const tl = flexTarget(model, out.momL, 1, bL);
        const tr = flexTarget(model, out.momR, -1, bR);
        const dl = tl - thetaL, dr = tr - thetaR;
        if (dl * prevDl < 0) gainL *= 0.5;
        if (dr * prevDr < 0) gainR *= 0.5;
        prevDl = dl; prevDr = dr;
        thetaL += gainL * dl; thetaR += gainR * dr;
        computeAero(model, vx, vy, vz, 0, 0, 0, thetaL, thetaR, out, rec, soft(bL), soft(bR));
        if (Math.abs(dl) < 1e-5 && Math.abs(dr) < 1e-5) break;
      }
      const rl = loadRatio(model, out.momL, 1), rr = loadRatio(model, out.momR, -1);
      if (pass === 0) ratio = Math.max(rl, rr);
      const nl = bL || rl > 1, nr = bR || rr > 1;
      if (nl === bL && nr === bR) break;
      bL = nl; bR = nr;
    }
  }
  return { out, thetaL, thetaR, buckledL: bL, buckledR: bR, buckled: bL || bR, loadRatio: ratio, vx, vy, vz };
}

/** 주어진 받음각, 옆미끄럼각, 속도에서 정상 상태의 계수를 구한다. */
export function steadyCoeffs(model: AeroModel, alphaRad: number, betaRad: number, speed: number, withFlex = true): SteadyCoeffs {
  const st = steadySolve(model, alphaRad, betaRad, speed, withFlex);
  const out = st.out;
  const cb = Math.cos(betaRad);
  const qS = 0.5 * AIR.rho * speed * speed * model.refAreaM2;
  const sa = Math.sin(alphaRad), ca = Math.cos(alphaRad);
  // 항력은 속도 반대 방향, 양력은 속도에 직각이고 위쪽인 방향의 성분 (기체 좌표의 x-z 평면에서)
  const drag = -(out.fx * ca * cb + out.fy * Math.sin(betaRad) - out.fz * sa * cb);
  const lift = out.fx * sa + out.fz * ca;
  const span = model.semiSpanM * 2;
  return {
    cl: lift / qS,
    cd: drag / qS,
    cm: -out.my / (qS * model.macM), // +y 축 회전은 기수를 내리는 방향이므로 부호를 바꾼다
    cy: out.fy / qS,
    croll: out.mx / (qS * span),
    cyaw: out.mz / (qS * span),
    thetaL: st.thetaL, thetaR: st.thetaR,
  };
}

/**
 * 안정 받음각 찾기 (분석 화면과 풍동이 함께 쓴다).
 * 피치 모멘트가 +(기수 듦)에서 -(기수 숙임)로 바뀌는 지점이 안정한 평형이다
 * (받음각이 커지면 숙이고, 작아지면 드는 힘이 생기므로 스스로 되돌아온다).
 * 여러 개면 양력이 생기는(받음각 > 0) 가장 작은 것을 고른다. 그런 것이 없으면 0 에 가장 가까운(가장 큰) 음수 쪽 평형.
 * @param cmAtDeg 1도 간격으로 미리 구해 둔 모멘트 계수(lo 도부터). 없으면 직접 구한다.
 */
export function findStableTrimDeg(
  model: AeroModel, speed: number, loDeg: number, hiDeg: number, cmAtDeg?: readonly number[],
): number | null {
  const DEG = Math.PI / 180;
  const cmOf = (aDeg: number): number => steadyCoeffs(model, aDeg * DEG, 0, speed).cm;
  let fallback: number | null = null;
  let c0 = cmAtDeg !== undefined ? cmAtDeg[0]! : cmOf(loDeg);
  for (let a = loDeg, i = 0; a + 1 <= hiDeg; a++, i++) {
    const c1 = cmAtDeg !== undefined ? cmAtDeg[i + 1]! : cmOf(a + 1);
    if (c0 > 0 && c1 <= 0) {
      // 이분법으로 정밀하게
      let lo = a, hi = a + 1;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        if (cmOf(mid) > 0) lo = mid; else hi = mid;
      }
      const t = (lo + hi) / 2;
      if (t > 0.05) return t;
      fallback = t; // 뒤에 찾은 것일수록 0 에 가깝다
    }
    c0 = c1;
  }
  return fallback;
}
