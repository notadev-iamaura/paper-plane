/**
 * 시험용 형상 만들기.
 *
 * 접기 엔진 없이도 공기 힘과 비행 계산을 시험할 수 있도록, 몇 개의 숫자(날개 폭, 시위, 후퇴각 등)로
 * PlaneGeometry 를 직접 만든다. 다트형(길고 뾰족한 삼각 날개)과 글라이더형(넓은 날개)을 만들 수 있다.
 *
 * 무게 분포는 "두께가 고른 얇은 판(날개 + 용골)" + "기수 쪽에 겹겹이 접힌 종이를 대신하는 무게 덩어리"
 * 로 본다. 무게 덩어리의 위치를 조절해 원하는 무게중심을 맞추고, 관성 텐서는 이 분포를 잘게 나눈
 * 점 질량의 합으로 계산한다.
 */
import type { AeroElement, PlaneGeometry, Vec3 } from '../types';
import { AIR } from './coefficients';

export interface FixturePaper {
  gsm: number;
  thicknessM: number;
  youngsModulusPa: number;
}

export interface FixtureOptions {
  /** 날개를 평평하게 폈을 때의 끝에서 끝까지 폭(m) */
  spanM?: number;
  /** 중심선에서의 시위(m) */
  rootChordM?: number;
  /** 날개 끝 시위(m) */
  tipChordM?: number;
  /** 앞전 후퇴각(도). 생략하면 뒷전이 일직선이 되도록 정한다. */
  sweepDeg?: number;
  /** 용골(동체) 깊이(m). 0 이면 없음. */
  keelDepthM?: number;
  /** 상반각(도) */
  dihedralDeg?: number;
  /** 전체 무게(kg). 생략하면 A4 한 장의 무게를 종이 평량으로 계산한다. */
  massKg?: number;
  /** 무게중심 위치(평균 공력 시위 대비 비율, 0 = 앞전). */
  cgFracMac?: number;
  /** 뒷전 꺾기 각도(도). + 는 위로(기수를 든다). */
  elevatorDeg?: number;
  /** 좌우 승강타 차이(도). 왼쪽 = elevatorDeg + 차이/2, 오른쪽 = elevatorDeg - 차이/2 */
  elevatorDiffDeg?: number;
  /** 날개 끝 세움의 폭(m)과 각도(도, + 는 위로) */
  wingletM?: number;
  wingletDeg?: number;
  /** 오른쪽 날개 폭 배율. 1 이 아니면 좌우 비대칭이 된다. */
  rightSpanScale?: number;
  /** 한쪽 날개를 나누는 띠 수 */
  strips?: number;
  /** 기수 쪽 무게 덩어리가 전체 무게에서 차지하는 비율 */
  ballastFrac?: number;
  /** 종이 물성 */
  paper?: FixturePaper;
  /** 날개 뿌리의 겹 수에 해당하는 굽힘 강성 배수 (접기 엔진과 같은 규칙: E·t³/12 × 겹 수). 생략 시 layers. */
  stiffnessFactor?: number;
  /** 날개 띠의 평균 겹 수 */
  layers?: number;
}

/** 평량(g/m^2)으로 일반적인 복사지 물성을 어림한다. 80 g 지는 두께 약 0.1 mm. */
export function fixturePaper(gsm: number): FixturePaper {
  return { gsm, thicknessM: gsm * 1.25e-6, youngsModulusPa: 3.5e9 };
}

/**
 * 기준 다트형: 길이 28 cm, 폭 11 cm 의 삼각 날개, 깊은 용골. 세게 던지는 용도라 무게중심이 앞쪽.
 * (물리 2판: 깊은 동체의 앞끝, 뒤끝 항력을 따로 세면서 무게중심 27.5% 에서는 활공비가 2.97 로 내려가,
 *  받음각 약 5.7도로 날도록 28% 로 옮겼다. 활공비 약 3.2.)
 */
export const FIXTURE_DART: FixtureOptions = {
  spanM: 0.11, rootChordM: 0.28, tipChordM: 0.01, keelDepthM: 0.028, dihedralDeg: 8,
  cgFracMac: 0.28, elevatorDeg: 0, layers: 2, ballastFrac: 0.45,
};

/** 기준 글라이더형: 폭 20 cm, 시위 약 10 cm 의 넓은 날개, 얕은 용골. 천천히 오래 나는 용도. */
export const FIXTURE_GLIDER: FixtureOptions = {
  spanM: 0.2, rootChordM: 0.115, tipChordM: 0.08, sweepDeg: 12, keelDepthM: 0.02, dihedralDeg: 10,
  cgFracMac: 0.275, elevatorDeg: 0, layers: 2, stiffnessFactor: 4, ballastFrac: 0.5,
};

const DEG = Math.PI / 180;
const A4_AREA = 0.21 * 0.297;

interface MassPoint { m: number; x: number; y: number; z: number }

export function makeFixtureGeometry(opts: FixtureOptions = {}): PlaneGeometry {
  const paper = opts.paper ?? fixturePaper(80);
  const span = opts.spanM ?? 0.11;
  const cr = opts.rootChordM ?? 0.28;
  const ct = opts.tipChordM ?? 0.01;
  const keelDepth = Math.max(0, opts.keelDepthM ?? 0.028);
  const dihedral = (opts.dihedralDeg ?? 8) * DEG;
  const mass = opts.massKg ?? (A4_AREA * paper.gsm) / 1000;
  const elevator = (opts.elevatorDeg ?? 0) * DEG;
  const elevDiff = (opts.elevatorDiffDeg ?? 0) * DEG;
  const wingletW = Math.max(0, opts.wingletM ?? 0);
  const wingletAng = (opts.wingletDeg ?? 60) * DEG;
  const rightScale = opts.rightSpanScale ?? 1;
  const nStrips = Math.max(2, Math.floor(opts.strips ?? 8));
  const ballastFrac = Math.min(0.9, Math.max(0.05, opts.ballastFrac ?? 0.4));
  const layers = opts.layers ?? 1;

  const halfL = span / 2;            // 왼쪽 날개 길이(면을 따라 잰 값)
  const halfR = (span / 2) * rightScale;
  // 앞전 후퇴각의 탄젠트. 생략 시 뒷전이 일직선(x = -cr)이 되도록 한다.
  const tanSweep = opts.sweepDeg !== undefined ? Math.tan(opts.sweepDeg * DEG) : (cr - ct) / halfL;

  const cosD = Math.cos(dihedral), sinD = Math.sin(dihedral);
  const elements: AeroElement[] = [];
  const points: MassPoint[] = [];
  const meshPos: number[] = [];
  const meshLayers: number[] = [];

  // 날개 면적 등 통계용 누적값
  let areaL = 0, areaR = 0, sumC2 = 0, sumXleC = 0, sumC = 0, minX = 0;
  let plateArea = 0; // 무게를 나눠 줄 전체 판 넓이(겹 수 반영)

  // 날개 전체(좌우 합)의 가로세로비: 투영 폭^2 / 투영 면적
  const projSpan = (halfL + halfR) * cosD;
  const projArea = ((cr + ct) / 2) * (halfL + halfR) * cosD;
  const wingAR = (projSpan * projSpan) / projArea;

  /** 날개 면 위의 점(중심선에서 면을 따라 s 만큼 떨어진 곳, x)을 기체 좌표로 */
  const wingPoint = (x: number, s: number, sign: number): Vec3 => ({ x, y: sign * s * cosD, z: s * sinD });

  for (const sign of [1, -1]) {
    const half = sign > 0 ? halfL : halfR;
    const flap = sign > 0 ? elevator + elevDiff / 2 : elevator - elevDiff / 2;
    const normal: Vec3 = { x: 0, y: -sign * sinD, z: cosD };
    const w = half / nStrips;
    for (let i = 0; i < nStrips; i++) {
      const s0 = i * w, s1 = (i + 1) * w, sm = (s0 + s1) / 2;
      // 폭 방향 위치의 비율은 좌우 모두 0(뿌리)~1(끝)로 맞춘다
      const t = sm / half;
      const chord = cr + (ct - cr) * t;
      const xle = -sm * (halfL / half) * tanSweep;
      const area = chord * w;
      elements.push({
        kind: 'wing', side: sign > 0 ? 'L' : 'R',
        le: wingPoint(xle, sm, sign),
        chordDir: { x: -1, y: 0, z: 0 },
        chord, width: w, area, normal, surfaceAR: wingAR, flapRad: flap, layers,
      });
      const proj = area * cosD;
      if (sign > 0) areaL += proj; else areaR += proj;
      sumC2 += chord * chord * w; sumXleC += xle * chord * w; sumC += chord * w;
      minX = Math.min(minX, xle - chord);
      // 무게: 띠를 시위 방향으로 6칸으로 나눈 점 질량
      const cells = 6;
      for (let k = 0; k < cells; k++) {
        const p = wingPoint(xle - (chord * (k + 0.5)) / cells, sm, sign);
        points.push({ m: (area * layers) / cells, x: p.x, y: p.y, z: p.z });
      }
      plateArea += area * layers;
      // 화면용 삼각형 2개
      const t0 = s0 / half, t1 = s1 / half;
      const c0 = cr + (ct - cr) * t0, c1 = cr + (ct - cr) * t1;
      const x0 = -s0 * (halfL / half) * tanSweep, x1 = -s1 * (halfL / half) * tanSweep;
      const a = wingPoint(x0, s0, sign), b = wingPoint(x1, s1, sign);
      const c = wingPoint(x1 - c1, s1, sign), d = wingPoint(x0 - c0, s0, sign);
      meshPos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
      meshLayers.push(layers, layers);
    }
    // 날개 끝 세움
    if (wingletW > 0) {
      const tipX = -half * (halfL / half) * tanSweep;
      const ang = dihedral + wingletAng; // 수평에서 잰 세움 면의 각도
      const base = wingPoint(tipX, half, sign);
      const mid: Vec3 = { x: tipX, y: base.y + sign * Math.cos(ang) * wingletW / 2, z: base.z + Math.sin(ang) * wingletW / 2 };
      const area = ct * wingletW;
      elements.push({
        kind: 'winglet', side: sign > 0 ? 'L' : 'R', le: mid, chordDir: { x: -1, y: 0, z: 0 },
        chord: ct, width: wingletW, area, normal: { x: 0, y: -sign * Math.sin(ang), z: Math.cos(ang) },
        surfaceAR: Math.max(0.05, wingletW / Math.max(ct, 1e-4)), flapRad: 0, layers,
      });
      points.push({ m: area * layers, x: mid.x - ct / 2, y: mid.y, z: mid.z });
      plateArea += area * layers;
    }
  }

  // 용골: 중심선 아래로 내려온 세로 판. 종이 두 겹이 맞붙어 있다.
  let keelArea = 0;
  if (keelDepth > 0) {
    const keelStrips = 3;
    const w = keelDepth / keelStrips;
    const keelLen = cr;
    for (let i = 0; i < keelStrips; i++) {
      const zm = -(i + 0.5) * w;
      // 아래로 갈수록 앞쪽이 깎인 사다리꼴(다트의 동체 모양)
      const cut = 0.5 * keelLen * ((i + 0.5) / keelStrips);
      const chord = keelLen - cut;
      const area = chord * w;
      elements.push({
        kind: 'keel', side: 'C', le: { x: -cut, y: 0, z: zm }, chordDir: { x: -1, y: 0, z: 0 },
        chord, width: w, area, normal: { x: 0, y: 1, z: 0 },
        surfaceAR: Math.max(0.05, (keelDepth * keelDepth) / (keelLen * keelDepth * 0.75)), flapRad: 0, layers: 2,
      });
      keelArea += area;
      const cells = 6;
      for (let k = 0; k < cells; k++) {
        points.push({ m: (area * 2) / cells, x: -cut - (chord * (k + 0.5)) / cells, y: 0, z: zm });
      }
      plateArea += area * 2;
      meshPos.push(-cut, 0, zm + w / 2, -keelLen, 0, zm + w / 2, -keelLen, 0, zm - w / 2);
      meshLayers.push(2);
    }
  }

  // --- 통계 ---
  const wingArea = areaL + areaR;
  const mac = sumC2 / sumC;
  const macLeX = sumXleC / sumC;
  const length = -minX;

  // --- 무게 분포 ---
  // 판 무게를 넓이에 비례해 나눠 주고, 나머지는 기수 쪽 무게 덩어리로 둔다.
  const plateMass = mass * (1 - ballastFrac);
  const ballastMass = mass * ballastFrac;
  let px = 0, py = 0, pz = 0;
  for (const p of points) {
    p.m = (p.m / plateArea) * plateMass;
    px += p.m * p.x; py += p.m * p.y; pz += p.m * p.z;
  }
  // 원하는 무게중심 x 가 나오도록 무게 덩어리의 x 를 정한다. 생략 시 길이의 25% 지점에 둔다.
  let ballastX: number;
  if (opts.cgFracMac !== undefined) {
    const targetX = macLeX - opts.cgFracMac * mac;
    ballastX = (mass * targetX - px) / ballastMass;
  } else {
    ballastX = -0.25 * length;
  }
  // 무게 덩어리는 길이 6 cm 정도의 막대로 본다(접힌 기수 부분). 중심선 위, 용골 깊이의 1/3 아래.
  const ballastZ = -keelDepth / 3;
  const rod = 5;
  for (let k = 0; k < rod; k++) {
    points.push({ m: ballastMass / rod, x: ballastX + 0.06 * ((k + 0.5) / rod - 0.5), y: 0, z: ballastZ });
  }
  let cx = 0, cy = 0, cz = 0, mt = 0;
  for (const p of points) { cx += p.m * p.x; cy += p.m * p.y; cz += p.m * p.z; mt += p.m; }
  cx /= mt; cy /= mt; cz /= mt;
  void py; void pz;

  // --- 관성 텐서 (무게중심 기준). 비대각 성분은 텐서 성분 그대로(-Σ m·x·y 등) ---
  let ixx = 0, iyy = 0, izz = 0, ixy = 0, ixz = 0, iyz = 0;
  for (const p of points) {
    const x = p.x - cx, y = p.y - cy, z = p.z - cz;
    ixx += p.m * (y * y + z * z);
    iyy += p.m * (x * x + z * z);
    izz += p.m * (x * x + y * y);
    ixy -= p.m * x * y;
    ixz -= p.m * x * z;
    iyz -= p.m * y * z;
  }

  const d0 = (paper.youngsModulusPa * Math.pow(paper.thicknessM, 3)) / 12;
  return {
    massKg: mass,
    cg: { x: cx, y: cy, z: cz },
    inertia: [ixx, iyy, izz, ixy, ixz, iyz],
    elements,
    stats: {
      wingAreaM2: wingArea,
      spanM: projSpan,
      aspectRatio: (projSpan * projSpan) / wingArea,
      macM: mac,
      macLeX,
      lengthM: length,
      wingLoadingNm2: (mass * AIR.g) / wingArea,
      cgFracLength: -cx / length,
      cgFracMac: (macLeX - cx) / mac,
      keelAreaM2: keelArea,
      maxLayers: Math.max(layers, keelDepth > 0 ? 2 : 1),
      asymmetry: (areaL - areaR) / wingArea,
      wingBendStiffnessNm: d0 * (opts.stiffnessFactor ?? layers),
    },
    mesh: { positions: meshPos, layers: meshLayers },
  };
}
