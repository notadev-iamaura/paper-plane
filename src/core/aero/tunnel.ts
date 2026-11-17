/**
 * 바람 실험실(풍동). 규격은 TUNNEL_CONTRACT.md.
 *
 * 고정대에 물린 비행기에 일정한 바람을 불어 주고 힘을 잰다. 비행 계산과 똑같은 힘 모델(forces.ts 의 computeAero)을
 * "회전 없이 일정한 속도로 나는 상태"로 부르기만 하므로, 여기서 본 숫자와 실제 비행이 어긋나지 않는다.
 * 종이 휨(과 꺾임)도 비행 계산과 같은 식으로 "충분히 시간이 지난 뒤"의 값을 쓴다.
 *
 * 좌표와 부호 (풍동 좌표: 바람이 불어오는 쪽이 +X, 왼쪽 +Y, 위 +Z)
 *  - 고정대는 먼저 기수를 왼쪽으로 betaDeg 만큼 돌리고(세로축), 그다음 기수를 alphaDeg 만큼 든다.
 *  - liftN 은 풍동의 위(+Z), dragN 은 바람이 미는 쪽(-X), sideN 은 왼쪽(+Y) 성분이다.
 *    옆바람이 없으면(beta = 0) 분석 화면의 양력, 항력과 정확히 같은 정의다.
 *  - 모멘트는 무게중심 기준, 기체 축 기준이다. pitch = 기체 좌우축(기수 듦 +), roll = 기체 앞뒤축(오른쪽 날개 내려감 +),
 *    yaw = 기체 위아래축(기수 왼쪽 +).
 *  - cl, cd 의 기준 면적은 stats.wingAreaM2, cm 의 기준 길이는 평균 공력 시위(분석 화면과 같다).
 */
import type { PlaneGeometry, TunnelElementReading, TunnelInput, TunnelReading } from '../types';
import { TUNNEL_LIMITS } from '../types';
import { AIR, clamp } from './coefficients';
import { type AeroModel, findStableTrimDeg, newStripRecord, prepareModel, steadySolve } from './forces';

const DEG = Math.PI / 180;

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** -0 을 0 으로 (화면에 "-0.00" 이 찍히지 않게) */
function z(v: number): number {
  return v === 0 || !Number.isFinite(v) ? 0 : v;
}

function probeModel(model: AeroModel, geom: PlaneGeometry, input: TunnelInput): TunnelReading {
  const speed = clamp(num(input?.speedMps, 0), TUNNEL_LIMITS.speedMin, TUNNEL_LIMITS.speedMax);
  const alphaDeg = clamp(num(input?.alphaDeg, 0), TUNNEL_LIMITS.alphaMin, TUNNEL_LIMITS.alphaMax);
  const betaDeg = clamp(num(input?.betaDeg, 0), TUNNEL_LIMITS.betaMin, TUNNEL_LIMITS.betaMax);
  const alpha = alphaDeg * DEG;
  const beta = betaDeg * DEG;

  const n = model.strips.length;
  const rec = newStripRecord(n);
  // 계약의 옆바람 각도(기수를 왼쪽으로 돌리면 +)는 힘 모델의 옆미끄럼각(왼쪽으로 미끄러지면 +)과 부호가 반대다.
  const st = steadySolve(model, alpha, -beta, speed, true, rec);
  const o = st.out;

  // 기체 좌표의 힘을 풍동 좌표로: 먼저 기수 듦(alpha)을 되돌리고, 그다음 왼쪽 돌림(beta)을 되돌린다.
  const sa = Math.sin(alpha), ca = Math.cos(alpha), sb = Math.sin(beta), cb = Math.cos(beta);
  const px = o.fx * ca - o.fz * sa;      // 기수 듦만 되돌린 중간 좌표의 앞 성분
  const lift = o.fx * sa + o.fz * ca;
  const drag = -(px * cb - o.fy * sb);
  const side = px * sb + o.fy * cb;

  const weight = Math.max(0, num(geom.massKg, 0)) * AIR.g;
  const qS = 0.5 * AIR.rho * speed * speed * model.refAreaM2;
  const has = qS > 1e-12;

  // 띠별 값. 넓이가 없어 계산에서 빠진 띠도 0 힘으로 채워 elements 와 순번이 맞게 한다.
  const elements: TunnelElementReading[] = [];
  for (let i = 0; i < geom.elements.length; i++) {
    const e = geom.elements[i]!;
    elements.push({
      index: i,
      forceBody: { x: 0, y: 0, z: 0 },
      pointBody: { x: num(e.le?.x, 0), y: num(e.le?.y, 0), z: num(e.le?.z, 0) },
      alphaDeg: 0,
      stalled: false,
    });
  }
  let wingArea = 0, stalledArea = 0;
  const cgx = num(geom.cg?.x, 0), cgy = num(geom.cg?.y, 0), cgz = num(geom.cg?.z, 0);
  for (let k = 0; k < n; k++) {
    const s = model.strips[k]!;
    const el = elements[s.elemIndex];
    if (el === undefined) continue;
    const attached = rec.attached[k]!;
    el.forceBody = { x: z(rec.fx[k]!), y: z(rec.fy[k]!), z: z(rec.fz[k]!) };
    el.pointBody = { x: rec.rx[k]! + cgx, y: rec.ry[k]! + cgy, z: rec.rz[k]! + cgz };
    el.alphaDeg = z(Math.atan2(rec.sinA[k]!, rec.cosA[k]!) / DEG);
    el.stalled = speed > 0 && attached < 0.5;
    if (s.isWing) {
      wingArea += s.area;
      if (speed > 0) stalledArea += s.area * (1 - attached);
    }
  }

  // 전체 힘의 작용점: 기체 앞뒤축 위에서 피치 모멘트가 0 이 되는 점. 힘이 거의 없으면 무게중심.
  // (모멘트 My = -rx * Fz 에서 rx 를 구한다. 화면에 그릴 수 있게 기체 길이 안으로 자른다.)
  let cpX = cgx;
  const fnScale = Math.max(1e-9, 1e-3 * weight);
  if (has && Math.abs(o.fz) > fnScale) {
    const len = Math.max(1e-3, num(geom.stats?.lengthM, 0.3));
    cpX = clamp(cgx - o.my / o.fz, -len, 0);
  }

  return {
    liftN: z(lift),
    dragN: z(drag),
    sideN: z(side),
    pitchMomentNm: z(-o.my),
    rollMomentNm: z(o.mx),
    yawMomentNm: z(o.mz),
    weightN: weight,
    liftToWeight: weight > 0 ? z(lift / weight) : 0,
    liftToDrag: Math.abs(drag) > 1e-9 ? z(lift / drag) : 0,
    cl: has ? z(lift / qS) : 0,
    cd: has ? z(drag / qS) : 0,
    cm: has ? z(-o.my / (qS * model.macM)) : 0,
    flexLeftDeg: z(st.thetaL / DEG),
    flexRightDeg: z(st.thetaR / DEG),
    buckled: st.buckled,
    stalledFraction: wingArea > 0 ? clamp(stalledArea / wingArea, 0, 1) : 0,
    centerOfPressureX: cpX,
    elements,
  };
}

/** 고정대에 물린 비행기에 일정한 바람을 불어 준 정상 상태의 힘. 입력은 TUNNEL_LIMITS 로 잘라 쓴다. */
export function probeTunnel(geom: PlaneGeometry, input: TunnelInput): TunnelReading {
  return probeModel(prepareModel(geom), geom, input);
}

/**
 * 무게중심에 꽂은 축에서 비행기가 위아래로 자유롭게 고개를 돌릴 수 있을 때,
 * 이 바람 속도에서 스스로 멈춰 서는 받음각. 없으면 alphaDeg 는 null.
 * stable: 그 각도에서 살짝 건드려도 되돌아오는지. liftToWeight: 그 각도에서의 뜨는 힘 / 무게.
 *
 * 분석 화면(analyze)의 안정 받음각과 같은 규칙을 쓴다: 되돌아오는(안정한) 평형 가운데 양력이 생기는 가장 작은 각.
 * 안정한 평형이 하나도 없고 되돌아오지 않는 평형(건드리면 달아나는 각)만 있으면 그 각을 stable = false 로 알려 준다.
 */
export function tunnelTrim(geom: PlaneGeometry, speedMps: number): { alphaDeg: number | null; stable: boolean; liftToWeight: number } {
  const speed = clamp(num(speedMps, 0), TUNNEL_LIMITS.speedMin, TUNNEL_LIMITS.speedMax);
  const none = { alphaDeg: null, stable: false, liftToWeight: 0 };
  if (!(speed > 1e-6)) return none; // 바람이 없으면 돌리는 힘도 없다
  const model = prepareModel(geom);
  const lo = TUNNEL_LIMITS.alphaMin, hi = TUNNEL_LIMITS.alphaMax;
  const cm: number[] = [];
  for (let a = lo; a <= hi; a++) cm.push(steadySolve(model, a * DEG, 0, speed).out.my * -1);
  let alphaDeg = findStableTrimDeg(model, speed, lo, hi, cm);
  let stable = alphaDeg !== null;
  if (alphaDeg === null) {
    // 되돌아오지 않는 평형: 모멘트가 -(숙임)에서 +(듦)로 바뀌는 점
    for (let i = 0; i + 1 < cm.length; i++) {
      if (cm[i]! < 0 && cm[i + 1]! >= 0) {
        let a0 = lo + i, a1 = a0 + 1;
        for (let k = 0; k < 24; k++) {
          const mid = (a0 + a1) / 2;
          if (-steadySolve(model, mid * DEG, 0, speed).out.my < 0) a0 = mid; else a1 = mid;
        }
        alphaDeg = (a0 + a1) / 2;
        break;
      }
    }
    stable = false;
  }
  if (alphaDeg === null) return none;
  const r = probeModel(model, geom, { speedMps: speed, alphaDeg, betaDeg: 0 });
  return { alphaDeg, stable, liftToWeight: r.liftToWeight };
}
