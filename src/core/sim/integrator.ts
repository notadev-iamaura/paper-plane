/**
 * 6자유도 강체 비행 적분기.
 *
 * 상태: 위치(세계), 속도(세계), 자세 사원수(기체 -> 세계), 각속도(기체), 좌우 날개 휨 각도와 꺾임 여부.
 * 힘: 중력 + 공기 힘(aero/forces.ts). 바람은 없다.
 * 적분: 고정 시간 간격의 4차 룽게-쿠타(RK4). 시간 간격이 고정이고 무작위가 없으므로
 *       같은 입력이면 같은 기계에서 비트 단위로 같은 결과가 나온다.
 *
 * 수치 보호 장치(물리적으로 설명 가능한 것만 둔다)
 *  - 최소 관성: 종이에는 두께와 겹이 있어 관성이 0 이 될 수 없다. 형상 계산이 0 에 가까운 값을 주면
 *    "질량 × (2 mm)^2" 을 하한으로 쓴다.
 *  - 각속도 한계 초당 약 32바퀴(200 rad/s): 이보다 빨리 도는 종이는 원심력과 공기 힘에 형태를 유지하지 못한다.
 *  - 속도 한계 60 m/s: 던지기 한도(10 m/s)와 낙하로는 도달할 수 없는 값. 계산이 어긋났을 때만 걸린다.
 *
 * 던지는 순간의 구조 점검(launchCheck)
 *  - 던지는 팔은 호를 그리므로 손 안의 비행기는 바람과 정확히 나란하지 않다(받음각 약 6도, STRUCT.handAlphaDeg).
 *    던지는 속도의 바람을 그 각도로 받았을 때 날개 뿌리의 굽힘이 한계를 넘으면, 손을 떠나기 전에 이미 날개가 꺾인다.
 *    이때는 "꺾인 날개"로 비행을 시작한다. 손의 속도 자체는 줄이지 않는다: 종이는 팔에 비해 너무 가벼워서
 *    (팔과 손의 유효 질량은 수백 g, 종이는 3~10 g) 무게도 공기 저항도 손 속도를 거의 바꾸지 못하기 때문이다.
 *    대신 꺾여서 펄럭이는 종이는 손을 떠나자마자 큰 항력으로 속도를 잃는다. 그 과정은 비행 계산이 그대로 보여 준다.
 */
import type { PlaneGeometry, Quat, ThrowInput, Vec3 } from '../types';
import { LIMITS } from '../types';
import { AIR } from '../aero/coefficients';
import {
  type AeroModel, STRUCT, computeAero, flexLinear, flexTarget, newAeroOut, prepareModel, steadySolve,
} from '../aero/forces';

/** 적분 시간 간격(s). 5 g 안팎의 가벼운 기체에서 가장 빠른 운동(롤 감쇠, 수백 1/s)도 안정하게 풀리는 값. */
export const SIM_DT = 1 / 1000;
/** 화면 재생용 표본을 남기는 간격(적분 걸음 수). 1000 Hz / 16 ≈ 62.5 Hz */
export const SAMPLE_EVERY = 16;
const MAX_OMEGA = 200;
const MAX_SPEED = 60;
const DEG = Math.PI / 180;

export interface TrackSample {
  t: number;
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  speed: number;
  alphaDeg: number;
  /** 역학적 에너지(J) = 위치 + 운동 + 회전 */
  energyJ: number;
  /** 왼쪽, 오른쪽 날개 끝 휨(도) */
  flexDeg: number;
}

/** 비행 전체에서 모은 값. 판정(verdict.ts)에서 쓴다. */
export interface FlightTrack {
  samples: TrackSample[];
  airtimeS: number;
  landing: Vec3;
  maxHeightM: number;
  /** 최고 높이에 이른 시각 */
  maxHeightT: number;
  /** 피치 방향 누적 회전(rad, 부호 있음: + 는 기수 듦), 그 절댓값의 최대 */
  pitchTurnRad: number;
  maxAbsPitchTurnRad: number;
  /** 롤 방향 누적 회전(rad) */
  rollTurnRad: number;
  /** 진행 방향(수평)의 누적 변화(rad). + 는 왼쪽으로 돎 */
  headingTurnRad: number;
  /** 뒤집혀 있던 시간 비율 */
  invertedFrac: number;
  /** 받음각 크기가 실속 근처(25도) 이상이던 시간 비율 */
  highAlphaFrac: number;
  /** 최대 휨(도) */
  maxFlexDeg: number;
  /** 던지는 순간 손 안에서 이미 날개가 꺾였는지 */
  collapsedAtLaunch: boolean;
  /** 날개가 꺾였는지(던지는 순간 포함)와 그 시각(s). 꺾이지 않았으면 null */
  buckled: boolean;
  buckledAtS: number | null;
  /** 날개 뿌리 굽힘 / 버티는 한계 의 최댓값(던지는 순간의 손 안 하중 포함). 1 을 넘으면 꺾인다. */
  peakLoadRatio: number;
  timedOut: boolean;
}

/** 던지는 순간 손 안에서 날개가 받는 하중을 점검한 결과 */
export interface LaunchCheck {
  /** 뿌리 굽힘 / 버티는 한계. 1 을 넘으면 손 안에서 꺾인다 */
  loadRatio: number;
  collapsedL: boolean;
  collapsedR: boolean;
}

/**
 * 던지는 순간의 구조 점검. 던지는 속도의 바람을 손 안 받음각(STRUCT.handAlphaDeg)으로 받는 정상 상태에서
 * 날개 뿌리의 굽힘이 한계를 넘는지 본다(파일 머리말 참고).
 */
export function launchCheck(model: AeroModel, speedMps: number): LaunchCheck {
  const st = steadySolve(model, STRUCT.handAlphaDeg * DEG, 0, Math.max(0, speedMps));
  return { loadRatio: st.loadRatio, collapsedL: st.buckledL, collapsedR: st.buckledR };
}

/**
 * 손 안에서 날개가 꺾이지 않는 가장 빠른 던지기 속도(m/s)를 이분법으로 찾는다. 한도 안에서 모두 버티면 hi 를 돌려준다.
 */
export function safeThrowSpeed(model: AeroModel, lo: number, hi: number): number {
  if (launchCheck(model, hi).loadRatio <= 1) return hi;
  if (launchCheck(model, lo).loadRatio > 1) return lo;
  let a = lo, b = hi;
  for (let k = 0; k < 12; k++) {
    const mid = (a + b) / 2;
    if (launchCheck(model, mid).loadRatio <= 1) a = mid; else b = mid;
  }
  return a;
}

/** 3x3 대칭 관성 텐서와 그 역행렬 */
interface Inertia {
  ixx: number; iyy: number; izz: number; ixy: number; ixz: number; iyz: number;
  a11: number; a12: number; a13: number; a22: number; a23: number; a33: number;
}

function buildInertia(geom: PlaneGeometry): Inertia {
  const m = Math.max(1e-5, geom.massKg);
  const floor = m * 0.002 * 0.002;
  const src = geom.inertia;
  const fin = (x: number | undefined): number => (x !== undefined && Number.isFinite(x) ? x : 0);
  let ixx = Math.max(floor, fin(src[0])), iyy = Math.max(floor, fin(src[1])), izz = Math.max(floor, fin(src[2]));
  let ixy = fin(src[3]), ixz = fin(src[4]), iyz = fin(src[5]);
  // 역행렬 (대칭 행렬의 여인수)
  let c11 = iyy * izz - iyz * iyz, c12 = ixz * iyz - ixy * izz, c13 = ixy * iyz - ixz * iyy;
  let det = ixx * c11 + ixy * c12 + ixz * c13;
  // 물리적으로 가능한 관성 텐서는 항상 양의 정부호다. 그렇지 않으면 비대각 성분을 버린다.
  const ok = det > 1e-3 * ixx * iyy * izz && ixy * ixy < ixx * iyy && ixz * ixz < ixx * izz && iyz * iyz < iyy * izz;
  if (!ok) {
    ixy = 0; ixz = 0; iyz = 0;
    c11 = iyy * izz; c12 = 0; c13 = 0;
    det = ixx * c11;
  }
  const c22 = ixx * izz - ixz * ixz, c23 = ixy * ixz - ixx * iyz, c33 = ixx * iyy - ixy * ixy;
  return {
    ixx, iyy, izz, ixy, ixz, iyz,
    a11: c11 / det, a12: c12 / det, a13: c13 / det, a22: c22 / det, a23: c23 / det, a33: c33 / det,
  };
}

/** 바닥에 닿는지 볼 기체 위의 점들(무게중심 기준). 띠의 앞전, 뒷전 양 끝. */
function contactPoints(geom: PlaneGeometry): { pts: Float64Array; radius: number } {
  const list: number[] = [];
  let radius = 0.005;
  for (const e of geom.elements) {
    if (!(e.chord > 0)) continue;
    const lx = e.le.x - geom.cg.x, ly = e.le.y - geom.cg.y, lz = e.le.z - geom.cg.z;
    const tx = lx + e.chordDir.x * e.chord, ty = ly + e.chordDir.y * e.chord, tz = lz + e.chordDir.z * e.chord;
    if (![lx, ly, lz, tx, ty, tz].every(Number.isFinite)) continue;
    list.push(lx, ly, lz, tx, ty, tz);
    radius = Math.max(radius, Math.hypot(lx, ly, lz) + e.width, Math.hypot(tx, ty, tz) + e.width);
  }
  if (list.length === 0) list.push(0, 0, 0);
  // 형상이 이상해도 접지 판정 반경이 터무니없이 커지지 않게 한다(A4 대각선의 절반 정도면 충분).
  return { pts: Float64Array.from(list), radius: Math.min(radius, 0.4) };
}

// 상태 벡터의 칸 번호
const PX = 0, PY = 1, PZ = 2, VX = 3, VY = 4, VZ = 5, QW = 6, QX = 7, QY = 8, QZ = 9, WX = 10, WY = 11, WZ = 12;
const N = 13;

/**
 * 비행 한 번을 처음부터 끝까지 계산한다.
 * 던지는 순간: 위치 (0, 0, 던지는 높이), 속도는 x-z 평면에서 수평 위로 pitchDeg,
 * 기수는 속도 방향, 그 축을 중심으로 rollDeg 만큼 기울임(오른쪽 날개가 내려가면 +), 회전 없음.
 */
export function runFlight(
  geom: PlaneGeometry, throwIn: ThrowInput, modelIn?: AeroModel,
  /** 시험용: 던지는 높이를 바꿔 긴 활공을 관찰할 때 쓴다. 게임에서는 쓰지 않는다. */
  opts?: { launchHeightM?: number; /** 시험용: 적분 시간 간격(s)을 바꿔 수렴을 확인할 때 쓴다. 게임에서는 쓰지 않는다. */ dtS?: number },
): FlightTrack {
  const model = modelIn ?? prepareModel(geom);
  const mass = Math.max(1e-5, geom.massKg);
  const I = buildInertia(geom);
  const { pts, radius } = contactPoints(geom);
  const dt = opts?.dtS !== undefined && opts.dtS > 0 && opts.dtS <= SIM_DT ? opts.dtS : SIM_DT;
  const aero = newAeroOut();

  const s = new Float64Array(N);
  const tmp = new Float64Array(N);
  const k1 = new Float64Array(N), k2 = new Float64Array(N), k3 = new Float64Array(N), k4 = new Float64Array(N);

  // --- 처음 상태 ---
  const pitch = throwIn.pitchDeg * DEG;
  const roll = throwIn.rollDeg * DEG;
  s[PZ] = opts?.launchHeightM ?? LIMITS.launchHeightM;
  s[VX] = throwIn.speedMps * Math.cos(pitch);
  s[VZ] = throwIn.speedMps * Math.sin(pitch);
  // 자세 = (세계 y 축으로 -pitch 회전: 기수가 위로) × (기체 x 축으로 +roll 회전: 오른쪽 날개가 아래로)
  const cp = Math.cos(-pitch / 2), sp = Math.sin(-pitch / 2);
  const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  s[QW] = cp * cr; s[QX] = cp * sr; s[QY] = sp * cr; s[QZ] = -sp * sr;

  let thetaL = 0, thetaR = 0; // 날개 휨(한 걸음 동안은 고정)
  let momL = 0, momR = 0;     // 날개 뿌리 굽힘 모멘트
  // 던지는 순간 손 안에서 이미 꺾였는지
  const launch = launchCheck(model, throwIn.speedMps);
  let buckledL = launch.collapsedL, buckledR = launch.collapsedR;
  let softL = buckledL ? 1 / STRUCT.creasedStiffness : 1, softR = buckledR ? 1 / STRUCT.creasedStiffness : 1;
  let buckledAt: number | null = buckledL || buckledR ? 0 : null;
  let peakRatio = launch.loadRatio;

  /** 상태 y 에서의 시간 변화율 dy 를 구한다. */
  const deriv = (y: Float64Array, dy: Float64Array, saveLoad: boolean): void => {
    const qw = y[QW]!, qx = y[QX]!, qy = y[QY]!, qz = y[QZ]!;
    // 사원수는 적분 중 길이가 1 에서 조금 벗어날 수 있으므로 회전 행렬을 만들 때 길이로 나눈다
    const n2 = qw * qw + qx * qx + qy * qy + qz * qz;
    const sc = n2 > 0 ? 2 / n2 : 0;
    const r11 = 1 - sc * (qy * qy + qz * qz), r12 = sc * (qx * qy - qw * qz), r13 = sc * (qx * qz + qw * qy);
    const r21 = sc * (qx * qy + qw * qz), r22 = 1 - sc * (qx * qx + qz * qz), r23 = sc * (qy * qz - qw * qx);
    const r31 = sc * (qx * qz - qw * qy), r32 = sc * (qy * qz + qw * qx), r33 = 1 - sc * (qx * qx + qy * qy);
    const vx = y[VX]!, vy = y[VY]!, vz = y[VZ]!;
    // 세계 속도를 기체 좌표로 (회전 행렬의 전치)
    const bx = r11 * vx + r21 * vy + r31 * vz;
    const by = r12 * vx + r22 * vy + r32 * vz;
    const bz = r13 * vx + r23 * vy + r33 * vz;
    const wx = y[WX]!, wy = y[WY]!, wz = y[WZ]!;
    computeAero(model, bx, by, bz, wx, wy, wz, thetaL, thetaR, aero, undefined, softL, softR);
    if (saveLoad) { momL = aero.momL; momR = aero.momR; }
    dy[PX] = vx; dy[PY] = vy; dy[PZ] = vz;
    // 힘을 세계 좌표로 돌려 가속도를 구한다
    dy[VX] = (r11 * aero.fx + r12 * aero.fy + r13 * aero.fz) / mass;
    dy[VY] = (r21 * aero.fx + r22 * aero.fy + r23 * aero.fz) / mass;
    dy[VZ] = (r31 * aero.fx + r32 * aero.fy + r33 * aero.fz) / mass - AIR.g;
    // 사원수 변화율 = 0.5 * q ⊗ (0, ω)
    dy[QW] = 0.5 * (-qx * wx - qy * wy - qz * wz);
    dy[QX] = 0.5 * (qw * wx + qy * wz - qz * wy);
    dy[QY] = 0.5 * (qw * wy + qz * wx - qx * wz);
    dy[QZ] = 0.5 * (qw * wz + qx * wy - qy * wx);
    // 오일러 회전 방정식: I·dω/dt = M - ω × (I·ω)
    const hx = I.ixx * wx + I.ixy * wy + I.ixz * wz;
    const hy = I.ixy * wx + I.iyy * wy + I.iyz * wz;
    const hz = I.ixz * wx + I.iyz * wy + I.izz * wz;
    const tx = aero.mx - (wy * hz - wz * hy);
    const ty = aero.my - (wz * hx - wx * hz);
    const tz = aero.mz - (wx * hy - wy * hx);
    dy[WX] = I.a11 * tx + I.a12 * ty + I.a13 * tz;
    dy[WY] = I.a12 * tx + I.a22 * ty + I.a23 * tz;
    dy[WZ] = I.a13 * tx + I.a23 * ty + I.a33 * tz;
  };

  /** 기체에서 가장 낮은 점의 높이 */
  const lowestZ = (y: Float64Array): number => {
    const z = y[PZ]!;
    if (z > radius) return z - radius; // 아직 충분히 높으면 자세한 계산을 건너뛴다
    const qw = y[QW]!, qx = y[QX]!, qy = y[QY]!, qz = y[QZ]!;
    const r31 = 2 * (qx * qz - qw * qy), r32 = 2 * (qy * qz + qw * qx), r33 = 1 - 2 * (qx * qx + qy * qy);
    let low = z;
    for (let i = 0; i < pts.length; i += 3) {
      const h = z + r31 * pts[i]! + r32 * pts[i + 1]! + r33 * pts[i + 2]!;
      if (h < low) low = h;
    }
    return low;
  };

  const samples: TrackSample[] = [];
  const pushSample = (t: number): void => {
    const qw = s[QW]!, qx = s[QX]!, qy = s[QY]!, qz = s[QZ]!;
    const vx = s[VX]!, vy = s[VY]!, vz = s[VZ]!;
    const r11 = 1 - 2 * (qy * qy + qz * qz), r21 = 2 * (qx * qy + qw * qz), r31 = 2 * (qx * qz - qw * qy);
    const r13 = 2 * (qx * qz + qw * qy), r23 = 2 * (qy * qz - qw * qx), r33 = 1 - 2 * (qx * qx + qy * qy);
    const bx = r11 * vx + r21 * vy + r31 * vz;
    const bz = r13 * vx + r23 * vy + r33 * vz;
    const wx = s[WX]!, wy = s[WY]!, wz = s[WZ]!;
    const rot = 0.5 * (I.ixx * wx * wx + I.iyy * wy * wy + I.izz * wz * wz) + I.ixy * wx * wy + I.ixz * wx * wz + I.iyz * wy * wz;
    const v2 = vx * vx + vy * vy + vz * vz;
    samples.push({
      t,
      pos: { x: s[PX]!, y: s[PY]!, z: s[PZ]! },
      vel: { x: vx, y: vy, z: vz },
      quat: { w: qw, x: qx, y: qy, z: qz },
      speed: Math.sqrt(v2),
      alphaDeg: Math.atan2(-bz, bx) / DEG,
      energyJ: mass * AIR.g * s[PZ]! + 0.5 * mass * v2 + rot,
      flexDeg: Math.max(Math.abs(thetaL), Math.abs(thetaR)) / DEG,
    });
  };

  // 판정용 누적값
  let maxH = s[PZ]!, maxHT = 0;
  let pitchTurn = 0, maxAbsPitchTurn = 0, rollTurn = 0, headingTurn = 0;
  let invertedSteps = 0, highAlphaSteps = 0, maxFlex = 0;
  let prevHeading = 0, hasHeading = false;
  let timedOut = true;
  let t = 0;
  let landX = 0, landY = 0;
  const maxSteps = Math.round(LIMITS.maxSimTimeS / dt);
  const flexGain = dt / STRUCT.responseTimeS;
  pushSample(0);

  let step = 0;
  for (step = 1; step <= maxSteps; step++) {
    const prevX = s[PX]!, prevY = s[PY]!;
    const prevLow = lowestZ(s);

    // --- RK4 한 걸음 ---
    deriv(s, k1, true);
    for (let i = 0; i < N; i++) tmp[i] = s[i]! + 0.5 * dt * k1[i]!;
    deriv(tmp, k2, false);
    for (let i = 0; i < N; i++) tmp[i] = s[i]! + 0.5 * dt * k2[i]!;
    deriv(tmp, k3, false);
    for (let i = 0; i < N; i++) tmp[i] = s[i]! + dt * k3[i]!;
    deriv(tmp, k4, false);
    for (let i = 0; i < N; i++) s[i] = s[i]! + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
    t = step * dt;

    // 사원수 길이를 1 로 되돌린다
    const qn = Math.hypot(s[QW]!, s[QX]!, s[QY]!, s[QZ]!);
    if (qn > 0) { s[QW] = s[QW]! / qn; s[QX] = s[QX]! / qn; s[QY] = s[QY]! / qn; s[QZ] = s[QZ]! / qn; } else { s[QW] = 1; }

    // 수치 보호: 각속도와 속도의 한계 (파일 머리말 참고)
    const wn = Math.hypot(s[WX]!, s[WY]!, s[WZ]!);
    if (wn > MAX_OMEGA) { const f = MAX_OMEGA / wn; s[WX] = s[WX]! * f; s[WY] = s[WY]! * f; s[WZ] = s[WZ]! * f; }
    const vn = Math.hypot(s[VX]!, s[VY]!, s[VZ]!);
    if (vn > MAX_SPEED) { const f = MAX_SPEED / vn; s[VX] = s[VX]! * f; s[VY] = s[VY]! * f; s[VZ] = s[VZ]! * f; }

    // 날개 휨: 지금 받는 힘에 맞는 휨 쪽으로 조금씩 따라간다(종이가 휘는 데 걸리는 시간 반영).
    // 뿌리 굽힘이 한계를 넘으면 그 날개는 꺾이고(좌굴), 이 비행이 끝날 때까지 약해진 채로 남는다.
    {
      const rl = Math.abs(flexLinear(model, momL, 1, false)) / STRUCT.buckleRad;
      const rr = Math.abs(flexLinear(model, momR, -1, false)) / STRUCT.buckleRad;
      if (rl > peakRatio) peakRatio = rl;
      if (rr > peakRatio) peakRatio = rr;
      if (!buckledL && rl > 1) { buckledL = true; softL = 1 / STRUCT.creasedStiffness; if (buckledAt === null) buckledAt = t; }
      if (!buckledR && rr > 1) { buckledR = true; softR = 1 / STRUCT.creasedStiffness; if (buckledAt === null) buckledAt = t; }
    }
    thetaL += flexGain * (flexTarget(model, momL, 1, buckledL) - thetaL);
    thetaR += flexGain * (flexTarget(model, momR, -1, buckledR) - thetaR);
    const fl = Math.max(Math.abs(thetaL), Math.abs(thetaR));
    if (fl > maxFlex) maxFlex = fl;

    // --- 판정용 값 모으기 ---
    if (s[PZ]! > maxH) { maxH = s[PZ]!; maxHT = t; }
    pitchTurn -= s[WY]! * dt; // +y 축 회전은 기수를 내리는 방향
    if (Math.abs(pitchTurn) > maxAbsPitchTurn) maxAbsPitchTurn = Math.abs(pitchTurn);
    rollTurn += s[WX]! * dt;
    {
      const qw = s[QW]!, qx = s[QX]!, qy = s[QY]!, qz = s[QZ]!;
      const r33 = 1 - 2 * (qx * qx + qy * qy);
      if (r33 < 0) invertedSteps++;
      const vx = s[VX]!, vy = s[VY]!, vz = s[VZ]!;
      const bx = (1 - 2 * (qy * qy + qz * qz)) * vx + 2 * (qx * qy + qw * qz) * vy + 2 * (qx * qz - qw * qy) * vz;
      const bz = 2 * (qx * qz + qw * qy) * vx + 2 * (qy * qz - qw * qx) * vy + r33 * vz;
      if (Math.abs(Math.atan2(-bz, bx)) > 25 * DEG) highAlphaSteps++;
      if (vx * vx + vy * vy > 0.25) {
        const h = Math.atan2(vy, vx);
        if (hasHeading) {
          let d = h - prevHeading;
          if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
          headingTurn += d;
        }
        prevHeading = h; hasHeading = true;
      } else {
        hasHeading = false;
      }
    }

    // --- 착지 판정: 기체의 가장 낮은 점이 바닥에 닿으면 끝 ---
    const low = lowestZ(s);
    if (low <= 0) {
      // 이번 걸음 안에서 닿은 순간을 직선 보간으로 어림한다
      const f = prevLow > low ? Math.min(1, Math.max(0, prevLow / (prevLow - low))) : 1;
      landX = prevX + (s[PX]! - prevX) * f;
      landY = prevY + (s[PY]! - prevY) * f;
      t = (step - 1 + f) * dt;
      timedOut = false;
      break;
    }
    if (step % SAMPLE_EVERY === 0) pushSample(t);
  }
  if (timedOut) { landX = s[PX]!; landY = s[PY]!; t = LIMITS.maxSimTimeS; step = maxSteps; }
  // 마지막 순간도 표본으로 남긴다
  const last = samples[samples.length - 1];
  if (last === undefined || t > last.t + 1e-9) pushSample(t);

  return {
    samples,
    airtimeS: t,
    landing: { x: landX, y: landY, z: 0 },
    maxHeightM: maxH,
    maxHeightT: maxHT,
    pitchTurnRad: pitchTurn,
    maxAbsPitchTurnRad: maxAbsPitchTurn,
    rollTurnRad: rollTurn,
    headingTurnRad: headingTurn,
    invertedFrac: step > 0 ? invertedSteps / step : 0,
    highAlphaFrac: step > 0 ? highAlphaSteps / step : 0,
    maxFlexDeg: maxFlex / DEG,
    collapsedAtLaunch: launch.collapsedL || launch.collapsedR,
    buckled: buckledL || buckledR,
    buckledAtS: buckledAt,
    peakLoadRatio: peakRatio,
    timedOut,
  };
}
