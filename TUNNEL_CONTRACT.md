# 바람 실험실(풍동) 계약

계산 담당(core)과 화면 담당이 이 문서를 기준으로 따로 작업한다. 타입은 `src/core/types.ts` 에 그대로 추가하고,
함수는 `src/core/index.ts` 에서 내보낸다. core 는 순수 계산(무작위, DOM, three 없음)이며 같은 입력이면 같은 결과다.
풍동 계산은 비행 시뮬레이션과 **같은 힘 모델**을 써야 한다(풍동에서 본 숫자와 실제 비행이 어긋나면 안 된다).

```ts
/** 풍동 한도. 화면과 계산이 같은 값을 쓴다. */
export const TUNNEL_LIMITS = {
  speedMin: 0, speedMax: 14,      // 바람 속도 m/s
  alphaMin: -20, alphaMax: 60,    // 받음각(기수를 드는 각도) 도
  betaMin: -30, betaMax: 30,      // 옆바람 각도 도 (기수를 왼쪽으로 돌리면 +)
} as const;

export interface TunnelInput {
  speedMps: number;
  alphaDeg: number;
  /** 생략하면 0 */
  betaDeg?: number;
}

export interface TunnelElementReading {
  /** PlaneGeometry.elements 의 순번 */
  index: number;
  /** 이 띠에 걸리는 공기 힘 (기체 좌표, N) */
  forceBody: Vec3;
  /** 힘이 걸리는 점 (기체 좌표, m) */
  pointBody: Vec3;
  /** 이 띠가 느끼는 받음각(도) */
  alphaDeg: number;
  /** 공기가 떨어져 나갔는지(실속) */
  stalled: boolean;
}

export interface TunnelReading {
  /** 바람 방향에 수직으로 위를 향하는 힘(뜨는 힘, N). 아래로 누르면 음수 */
  liftN: number;
  /** 바람 방향으로 미는 힘(막는 힘, N) */
  dragN: number;
  /** 옆으로 미는 힘(N). 왼쪽 + */
  sideN: number;
  /** 무게중심 기준 모멘트(N m). pitch: 기수를 들면 +, roll: 오른쪽 날개가 내려가면 +, yaw: 기수가 왼쪽으로 돌면 + */
  pitchMomentNm: number;
  rollMomentNm: number;
  yawMomentNm: number;
  /** 비행기 무게(N) */
  weightN: number;
  /** 뜨는 힘 / 무게. 1 이상이면 이 속도와 각도에서 뜰 수 있다 */
  liftToWeight: number;
  /** 뜨는 힘 / 막는 힘. dragN 이 0 에 가까우면 0 */
  liftToDrag: number;
  cl: number; cd: number; cm: number;
  /** 종이 날개가 바람에 휜 각도(도). 위로 휘면 + */
  flexLeftDeg: number;
  flexRightDeg: number;
  /** 바람이 너무 세서 종이가 버티지 못하고 꺾였는지 (그런 모델이 없으면 항상 false) */
  buckled: boolean;
  /** 날개 면적 중 실속한 비율 0..1 */
  stalledFraction: number;
  /** 전체 힘의 작용점 x (기체 좌표). 힘이 거의 없으면 무게중심 x */
  centerOfPressureX: number;
  elements: TunnelElementReading[];
}

/** 고정대에 물린 비행기에 일정한 바람을 불어 준 정상 상태의 힘. 입력은 TUNNEL_LIMITS 로 잘라 쓴다. */
export function probeTunnel(geom: PlaneGeometry, input: TunnelInput): TunnelReading;

/**
 * 무게중심에 꽂은 축에서 비행기가 위아래로 자유롭게 고개를 돌릴 수 있을 때,
 * 이 바람 속도에서 스스로 멈춰 서는 받음각. 없으면 alphaDeg 는 null.
 * stable: 그 각도에서 살짝 건드려도 되돌아오는지. liftToWeight: 그 각도에서의 뜨는 힘 / 무게.
 */
export function tunnelTrim(geom: PlaneGeometry, speedMps: number):
  { alphaDeg: number | null; stable: boolean; liftToWeight: number };

/** 물리 모델의 판 번호. 계산 결과가 달라지는 변경을 할 때마다 올린다. 화면은 이 값이 바뀌면 저장해 둔 기록을 다시 계산한다. */
export const PHYSICS_VERSION: number;
```
