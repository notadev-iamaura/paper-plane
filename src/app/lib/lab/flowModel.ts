/**
 * 바람 실험실의 연기 그림.
 *
 * 이것은 공기 흐름을 푼 것(유체 계산)이 아니다. core 의 probeTunnel 이 계산한 "힘"을 보고,
 * 그 힘이 생기려면 공기가 대략 어떻게 흘러야 하는지를 간단한 식으로 그린 그림이다.
 *   - 뜨는 힘 계수(cl)가 클수록 날개 뒤 연기가 더 아래로 꺾인다(내리흐름).
 *   - 띠(element)마다의 실속 표시(stalled)가 켜진 자리에서는 연기가 날개 윗면을 따라가지 못하고 떨어져 나가 돌돌 말린다.
 *   - 날개 끝 소용돌이의 굵기는 뜨는 힘 계수를 따른다.
 *   - 막는 힘 계수(cd)가 클수록 날개 뒤의 어지러운 띠(후류)가 넓어진다.
 * 화면(3D 무대, 2D 그림)은 모두 이 파일의 flowPoint / vortexPoint 로 연기 줄의 자리를 구한다.
 *
 * 좌표(바람 좌표): s = 바람이 흘러가는 방향(+가 뒤쪽), y = 위, z = 비행기의 오른쪽. 원점은 받침대 축(무게중심).
 * three 좌표로는 (X, Y, Z) = (-s, y, z).
 */
import type { PlaneGeometry, TunnelReading, Vec3 } from '../../../core/index';

export interface FlowStation {
  /** 이 띠의 가로 자리(바람 좌표 z) */
  z: number;
  /** 앞전과 뒷전의 자리 */
  sLe: number; yLe: number;
  sTe: number; yTe: number;
  chord: number;
  stalled: boolean;
}

export interface FlowModel {
  /** 바람 속도(m/s) */
  speed: number;
  /** 뜨는 힘 계수(없으면 0) */
  cl: number;
  cd: number;
  /** 바람이 떨어져 나가는 쪽: 뜨는 힘이 위면 윗면(+1), 아래면 아랫면(-1) */
  suction: 1 | -1;
  /** 날개 뒤 멀리에서 연기가 꺾이는 각도(rad). + 는 아래로 */
  downwashRad: number;
  /** 날개 앞에서 연기가 미리 떠오르는 높이(m). 뜨는 힘이 아래면 음수 */
  upwashM: number;
  /** 날개 끝 소용돌이의 세기 -1..1 (부호는 도는 방향) */
  vortex: number;
  /** 날개 뒤 어지러운 띠의 반 폭(m) */
  wakeHalfM: number;
  /** 연기가 얼마나 흐트러지는지 0..1 (실속 비율과 막는 힘에서) */
  turbulence: number;
  stalledFraction: number;
  /** 날개 띠들(z 가 작은 것부터) */
  stations: FlowStation[];
  /** 날개 끝의 뒤쪽 점: [오른쪽(+z), 왼쪽(-z)] */
  tips: [{ s: number; y: number; z: number }, { s: number; y: number; z: number }];
  spanHalfM: number;
  chordRefM: number;
}

export interface FlowInput { speedMps: number; alphaDeg: number; betaDeg?: number }

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const smooth = (t: number): number => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

/** 화면에서 연기가 흘러가는 빠르기(m/s) = 바람 속도 x 이 값. 진짜 속도로는 너무 빨라 눈에 보이지 않는다. */
export const SMOKE_PACE = 0.06;
/** 꺾이는 각도의 상한(도). 그림이 지나치게 과장되지 않게 한다. */
export const DOWNWASH_MAX_DEG = 24;
/** 잘 보이도록 이론값(2 cl / (pi AR))에 곱하는 배율 */
export const DOWNWASH_GAIN = 1.6;

/** 기체 좌표의 점(무게중심 기준이 아님)을 받음각, 옆바람 각도만큼 돌려 바람 좌표로 옮긴다. */
export function bodyToWind(p: Vec3, cg: Vec3, alphaDeg: number, betaDeg: number, out: { s: number; y: number; z: number }): { s: number; y: number; z: number } {
  // 기체 (x 앞, y 왼쪽, z 위) -> three (X, Y, Z) = (x, z, -y)
  const X = p.x - cg.x, Y = p.z - cg.z, Z = -(p.y - cg.y);
  const a = alphaDeg * DEG, b = betaDeg * DEG;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  // 먼저 고개를 든다(Z 축), 그다음 옆으로 돌린다(Y 축)
  const X1 = X * ca - Y * sa;
  const Y1 = X * sa + Y * ca;
  const X2 = X1 * cb + Z * sb;
  const Z2 = -X1 * sb + Z * cb;
  out.s = -X2; out.y = Y1; out.z = Z2;
  return out;
}

/**
 * 계산한 힘(reading)에서 연기 그림의 값들을 정한다. 순수 함수: 같은 입력이면 같은 그림.
 */
export function buildFlowModel(reading: TunnelReading, geom: PlaneGeometry, input: FlowInput): FlowModel {
  const alpha = input.alphaDeg, beta = input.betaDeg ?? 0;
  const ar = Math.max(0.4, geom.stats.aspectRatio || 1);
  const cl = Number.isFinite(reading.cl) ? reading.cl : 0;
  const cd = Number.isFinite(reading.cd) ? Math.max(0, reading.cd) : 0;
  const moving = input.speedMps > 0.05;
  const clEff = moving ? cl : 0;
  const cdEff = moving ? cd : 0;
  const stalledFraction = moving ? clamp(reading.stalledFraction, 0, 1) : 0;

  const downwashDeg = clamp(((2 * clEff) / (Math.PI * ar)) / DEG * DOWNWASH_GAIN, -DOWNWASH_MAX_DEG, DOWNWASH_MAX_DEG);
  const chordRef = Math.max(0.03, geom.stats.macM || 0.1);
  const stations: FlowStation[] = [];
  const tmpA = { s: 0, y: 0, z: 0 }, tmpB = { s: 0, y: 0, z: 0 };
  const byIndex = new Map<number, boolean>();
  for (const e of reading.elements) byIndex.set(e.index, e.stalled);
  let zMax = -Infinity, zMin = Infinity;
  let tipR = { s: 0, y: 0, z: 0 }, tipL = { s: 0, y: 0, z: 0 };
  const hasWing = geom.elements.some((e) => e.kind === 'wing');
  geom.elements.forEach((e, i) => {
    if (hasWing ? e.kind !== 'wing' : e.kind === 'keel') return;
    bodyToWind(e.le, geom.cg, alpha, beta, tmpA);
    const te = { x: e.le.x + e.chordDir.x * e.chord, y: e.le.y + e.chordDir.y * e.chord, z: e.le.z + e.chordDir.z * e.chord };
    bodyToWind(te, geom.cg, alpha, beta, tmpB);
    // 옆바람으로 돌리면 앞뒤가 바뀌어 보일 수 있으므로 앞쪽에 있는 점을 앞전으로 삼는다.
    const front = tmpA.s <= tmpB.s ? tmpA : tmpB, rear = tmpA.s <= tmpB.s ? tmpB : tmpA;
    const st: FlowStation = { z: (tmpA.z + tmpB.z) / 2, sLe: front.s, yLe: front.y, sTe: Math.max(rear.s, front.s + 0.005), yTe: rear.y, chord: e.chord, stalled: moving && byIndex.get(i) === true };
    stations.push(st);
    const outer = st.z + Math.sign(st.z || 1) * e.width / 2;
    if (outer > zMax) { zMax = outer; tipR = { s: st.sTe, y: st.yTe, z: outer }; }
    if (outer < zMin) { zMin = outer; tipL = { s: st.sTe, y: st.yTe, z: outer }; }
  });
  stations.sort((p, q) => p.z - q.z);
  if (stations.length === 0) {
    // 날개 띠가 없는 형상(빈 종이 등): 납작한 판 하나로 본다.
    const len = Math.max(0.05, geom.stats.lengthM || 0.2);
    const a = alpha * DEG;
    const xN = -geom.cg.x, xT = -len - geom.cg.x;
    stations.push({ z: 0, sLe: -xN * Math.cos(a), yLe: xN * Math.sin(a), sTe: -xT * Math.cos(a), yTe: xT * Math.sin(a), chord: len, stalled: moving && stalledFraction > 0.5 });
    zMax = 0.05; zMin = -0.05;
    tipR = { s: stations[0]!.sTe, y: stations[0]!.yTe, z: zMax };
    tipL = { s: stations[0]!.sTe, y: stations[0]!.yTe, z: zMin };
  }
  const spanHalf = Math.max(0.02, Math.max(Math.abs(zMax), Math.abs(zMin)));

  return {
    speed: Math.max(0, input.speedMps),
    cl: clEff,
    cd: cdEff,
    suction: clEff >= 0 ? 1 : -1,
    downwashRad: downwashDeg * DEG,
    upwashM: clamp(0.16 * clEff, -0.2, 0.2) * chordRef,
    vortex: clamp(clEff / 0.6, -1, 1),
    wakeHalfM: clamp(chordRef * (0.04 + 0.55 * cdEff), 0.003, 0.06),
    turbulence: clamp(stalledFraction * 0.85 + cdEff * 0.35, 0, 1),
    stalledFraction,
    stations,
    tips: [tipR, tipL],
    spanHalfM: spanHalf,
    chordRefM: chordRef,
  };
}

function stationAt(m: FlowModel, z0: number): { st: FlowStation; wz: number } {
  let best = m.stations[0]!;
  let bd = Infinity;
  for (const st of m.stations) {
    const d = Math.abs(st.z - z0);
    if (d < bd) { bd = d; best = st; }
  }
  const out = Math.abs(z0) - m.spanHalfM;
  return { st: best, wz: out <= 0 ? 1 : Math.exp(-out / 0.03) };
}

/** 줄마다 다른 값을 내는 싼 해시 0..1 */
function hash01(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export interface FlowPointOut {
  s: number; y: number; z: number;
  /** 이 자리에서 연기가 흐르는 빠르기(바람 속도 대비 0..1). 떨어져 나간 자리와 날개 뒤는 느리다. */
  pace: number;
  /** 이 자리가 얼마나 어지러운지 0..1 */
  rough: number;
}

/**
 * 연기 줄 한 가닥의 한 점.
 * z0, y0 : 연기가 나오는 빗(rake)에서의 자리(날개에서 멀리 앞쪽일 때의 가로 자리와 높이).
 * s      : 흘러간 거리(축 기준, 뒤쪽 +).
 * time   : 초. 어지러운 자리의 말림 무늬가 바람을 타고 흘러가게 한다(차분한 자리는 시간에 따라 변하지 않는다).
 */
export function flowPoint(m: FlowModel, z0: number, y0: number, s: number, time: number, out: FlowPointOut): FlowPointOut {
  const { st, wz } = stationAt(m, z0);
  const c = st.chord;
  const yStag = st.yLe - m.upwashM;
  const d = y0 - yStag;
  const side = d >= 0 ? 1 : -1;
  const separated = st.stalled && side === m.suction;
  const mP = (st.yTe - st.yLe) / (st.sTe - st.sLe);
  const mF = -Math.tan(m.downwashRad);
  const Lu = 0.55 * c, Lr = 0.45 * c, Ld = 3.2 * c;

  // 붙어서 흐르는 길: 앞전까지 떠오르고, 날개를 따라가고, 뒷전을 떠난 뒤에는 차츰 내리흐름 각도로 눕는다.
  let cAtt: number;
  if (s < st.sLe) cAtt = yStag + (st.yLe - yStag) * Math.exp((s - st.sLe) / Lu);
  else if (s <= st.sTe) cAtt = st.yLe + mP * (s - st.sLe);
  else {
    const t = s - st.sTe;
    cAtt = st.yTe + (mP - mF) * Lr * (1 - Math.exp(-t / Lr)) + mF * Ld * (1 - Math.exp(-t / Ld));
  }
  let cLine = cAtt;
  let gap = 0;
  if (separated && s > st.sLe) {
    // 떨어져 나간 길: 앞전에서 날개를 따라가지 않고 거의 곧장 뒤로 간다. 한참 뒤에야 아래쪽 흐름과 다시 만난다.
    const t = s - st.sLe;
    const cSep = st.yLe + mF * 0.5 * Ld * (1 - Math.exp(-t / Ld));
    const rejoin = s > st.sTe ? 1 - Math.exp(-(s - st.sTe) / (3.5 * c)) : 0;
    cLine = cSep + (cAtt - cSep) * rejoin;
    gap = Math.abs(cLine - cAtt);
  }
  const H = Math.max(0.05, 0.9 * c);
  const wgt = Math.exp(-Math.abs(d) / H) * wz;
  let y = y0 + (cLine - yStag) * wgt;
  let sOut = s;
  let zOut = z0;
  let pace = 1;
  let rough = 0;
  const Uc = SMOKE_PACE * m.speed; // 무늬가 흘러가는 빠르기(화면용)
  const ph = hash01(z0 * 31 + 0.5, y0 * 57 + 0.25) * Math.PI * 2;

  if (separated && s > st.sLe) {
    // 돌돌 말림: 떨어져 나간 틈 안에서 연기가 고리를 그리며 떠내려간다.
    const band = Math.max(0.012, 0.5 * Math.abs(st.yTe - st.yLe));
    const near = Math.exp(-Math.abs(d) / band);
    const grow = smooth((s - st.sLe) / (0.8 * c)) * Math.exp(-Math.max(0, s - st.sTe) / (4 * c));
    const A = Math.min(0.03, 0.02 + 0.3 * gap) * grow * near * wz;
    const phi = (2 * Math.PI / 0.12) * (s - Uc * time) + ph;
    sOut += A * 0.9 * Math.cos(phi);
    y += A * Math.sin(phi) - m.suction * A * 0.7;
    zOut += A * 0.35 * Math.cos(phi * 0.7 + 1.3);
    pace -= 0.55 * near * grow;
    rough = Math.max(rough, near * grow);
  }
  if (s > st.sTe && m.wakeHalfM > 0.004) {
    // 날개 뒤 어지러운 띠: 막는 힘이 클수록 넓고 크게 출렁인다.
    const t = s - st.sTe;
    const wHalf = m.wakeHalfM * (1 + t / (2.5 * c));
    const near = Math.exp(-Math.abs(y - cAtt) / (wHalf + 0.006)) * wz;
    const A = wHalf * 0.55 * (1 - Math.exp(-t / (0.5 * c))) * near;
    const phi = (2 * Math.PI / 0.1) * (s - Uc * time) + ph * 1.7;
    y += A * Math.sin(phi);
    pace -= 0.35 * near * clamp(m.cd * 2.5, 0, 1);
    rough = Math.max(rough, near * clamp(m.wakeHalfM / 0.03, 0, 1));
  }
  out.s = sOut; out.y = y; out.z = zOut;
  out.pace = clamp(pace, 0.25, 1);
  out.rough = clamp(rough, 0, 1);
  return out;
}

/**
 * 날개 끝 소용돌이 줄의 한 점. tip: 0 = 오른쪽 날개 끝, 1 = 왼쪽. t: 날개 끝에서 뒤로 흘러간 거리(m). arm: 꼬인 가닥의 순번.
 * 뜨는 힘이 위면 공기가 날개 끝 바깥을 돌아 아래에서 위로 말려 올라간다. 세기가 0 이면 곧은 줄이다.
 */
export function vortexPoint(m: FlowModel, tip: 0 | 1, t: number, arm: number, out: { s: number; y: number; z: number }): { s: number; y: number; z: number } {
  const p = m.tips[tip];
  const c = m.chordRefM;
  const mF = -Math.tan(m.downwashRad);
  const Ld = 3.2 * c;
  const mirror = tip === 0 ? 1 : -1;
  // 바람이 떨어져 나간 날개는 소용돌이도 힘을 잃고 퍼진다.
  const strength = Math.abs(m.vortex) * (1 - 0.75 * m.stalledFraction);
  const r = 0.019 * strength * (1 - Math.exp(-t / 0.05)) * (1 + t * 0.9);
  // 소용돌이의 가운데는 날개 뒤 흐름을 따라 절반쯤 내려가고 조금 안쪽으로 모인다.
  const yc = p.y + 0.5 * mF * Ld * (1 - Math.exp(-t / Ld));
  const zc = p.z * (1 - 0.1 * (1 - Math.exp(-t / 0.15)));
  const turns = (2 * Math.PI / 0.11) * t * (0.55 + 0.45 * strength);
  const th = Math.sign(m.vortex || 1) * turns + arm * Math.PI;
  out.s = p.s + t;
  out.y = yc - r * Math.cos(th);
  out.z = zc + mirror * r * Math.sin(th);
  return out;
}

/** 빗의 줄 높이들(축 높이 기준, m). n 은 홀수면 가운데 줄이 축 높이를 지난다. */
export function rakeHeights(n: number, spacing = 0.021): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((i - (n - 1) / 2) * spacing);
  return out;
}

/** 균형을 못 잡고 뒤집히는 동안의 그림: 연기가 어디에도 붙지 못하고 온통 흐트러진다. */
export function roughen(m: FlowModel): FlowModel {
  return {
    ...m,
    downwashRad: 0,
    upwashM: 0,
    vortex: 0,
    turbulence: 1,
    stalledFraction: 1,
    wakeHalfM: Math.max(m.wakeHalfM, 0.04),
    stations: m.stations.map((s) => ({ ...s, stalled: m.speed > 0.05 })),
  };
}
