/**
 * 공통 규격 (모든 모듈이 공유하는 타입).
 * 이 파일은 계약서 역할을 한다. 필드를 바꾸면 접기 엔진, 비행 엔진, 화면, 서버가 모두 영향을 받는다.
 *
 * 좌표계
 * - 종이 좌표(2D, 미터): 원점은 펼친 종이의 중심. x = 좌우(오른쪽 +), y = 앞뒤(기수 방향 +).
 *   종이는 세로로 놓는다(폭 widthM 이 x, 길이 heightM 이 y). 중심선은 x = 0.
 * - 기체 좌표(3D, 미터, 오른손 좌표계): +x = 기수(앞), +y = 왼쪽 날개, +z = 위.
 *   원점은 접힌 비행기의 가장 앞 점을 중심선 위, 날개 평면 높이에 투영한 점. 따라서 기체의 모든 점은 x <= 0.
 * - 세계 좌표(3D, 미터, 오른손 좌표계): +x = 던지는 방향, +y = 왼쪽, +z = 위. 바닥은 z = 0. 중력은 -z.
 */

export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }
/** 기체 좌표 -> 세계 좌표 회전을 나타내는 단위 사원수 */
export interface Quat { w: number; x: number; y: number; z: number }

// ---------------------------------------------------------------------------
// 종이
// ---------------------------------------------------------------------------
export interface PaperSpec {
  id: string;
  nameKo: string;
  descriptionKo: string;
  widthM: number;
  heightM: number;
  /** 평량 g/m^2 */
  gsm: number;
  thicknessM: number;
  /** 굽힘 탄성 계수(Pa). 종이 강성 계산에 쓴다. */
  youngsModulusPa: number;
}

// ---------------------------------------------------------------------------
// 설계 (사용자가 만드는 값. 공유 코드와 서버 제출에 그대로 쓰인다)
// ---------------------------------------------------------------------------

/**
 * 평면 접기 한 번. 현재 납작하게 접힌 상태의 종이 좌표에서, a->b 를 지나는 무한 직선을 따라
 * "모든 겹을 한꺼번에" 접는다. a->b 진행 방향의 왼쪽에 있는 부분이 움직이는 쪽이며 직선에 대해 반사된다.
 * 모든 겹을 함께 접으므로 종이가 종이를 뚫는 불가능한 접기는 생기지 않는다.
 */
export interface FoldOp {
  a: Vec2;
  b: Vec2;
  /** valley: 움직이는 쪽이 위(+z)로 올라와 겹친다. mountain: 아래로 들어간다. */
  dir: 'valley' | 'mountain';
}

/** 평면 접기가 끝난 뒤의 입체 마무리 */
export interface Shaping {
  /** 중심선에서 날개가 꺾이는 선까지의 거리(m). 이 폭만큼이 아래로 접혀 동체(용골)가 된다. 0 이면 동체 없음. */
  keelM: number;
  /** 날개 상반각(도). 수평 기준 날개 끝이 올라간 각도. */
  dihedralDeg: number;
  /** 날개 끝을 세워 접는 폭(m). 0 이면 없음. */
  wingletM: number;
  /** 날개 끝 접는 각도(도). + 는 위로. */
  wingletDeg: number;
  /** 날개 뒷전 15% 를 위로 꺾는 각도(도). + 는 기수를 드는 방향. */
  elevatorDeg: number;
}

export interface PlaneDesign {
  v: 1;
  paperId: string;
  folds: FoldOp[];
  shaping: Shaping;
  /** 클립. xBodyM 은 기체 좌표 x (0 = 기수, 음수 = 뒤쪽). 중심선 위에 끼운다. null 이면 없음. */
  clip: { xBodyM: number } | null;
}

export interface ThrowInput {
  /** 던지는 속도 m/s */
  speedMps: number;
  /** 던지는 각도(도). 수평 기준 위로 +. 기수 방향과 속도 방향이 같다고 본다. */
  pitchDeg: number;
  /** 좌우 기울임(도). 오른쪽 날개가 내려가면 +. */
  rollDeg: number;
}

export type GameMode = 'distance' | 'airtime';

/** 한도 값. 화면과 서버가 같은 값을 쓴다. */
export const LIMITS = {
  maxFolds: 24,
  /**
   * 던지는 속도 한도(m/s). 이 게임의 주인공은 학교 체육관의 초등학생이다.
   *  - 최대 10 m/s (추정): 초등 3~6학년이 공을 온몸으로 던지면 대략 13~18 m/s 가 나오지만, 종이비행기는
   *    동체를 손끝으로 집고 팔꿈치를 펴며 "밀어" 던진다(손목 스냅과 몸통 회전을 쓰면 자세가 흐트러진다).
   *    이런 던지기의 손 속도는 공 던지기의 약 60% 인 8~11 m/s 다. 어른이 세게 던진 종이비행기가 10~12 m/s,
   *    25 m/s 를 넘는 것은 기록용 비행기를 던지는 운동선수뿐이다. 그래서 10 m/s 로 정했다.
   *    손 속도는 비행기 무게와 거의 무관하다: 팔과 손의 유효 질량(수백 g)에 비해 종이(3~10 g)는 너무 가볍다.
   *  - 최소 2 m/s: 손에서 살짝 놓아 주는 정도. 가장 느린 기체(신문지 델타, 안정 속도 약 2.6 m/s)보다 느리게도 던질 수 있다.
   * 이 값을 바꾸면 공유 코드와 랭킹이 받아들이는 던지기 범위가 바뀐다(codec.ts 의 decodeDesign 설명 참고).
   */
  throwSpeedMin: 2,
  throwSpeedMax: 10,
  pitchMin: -20,
  pitchMax: 60,
  rollMin: -30,
  rollMax: 30,
  dihedralMin: -10,
  dihedralMax: 45,
  wingletDegMin: -90,
  wingletDegMax: 90,
  elevatorMin: -15,
  elevatorMax: 20,
  /** 던지는 높이(m). 고정. */
  launchHeightM: 1.6,
  /** 클립 무게(kg) */
  clipMassKg: 0.0005,
  /** 시뮬레이션 최대 시간(s) */
  maxSimTimeS: 60,
} as const;

// ---------------------------------------------------------------------------
// 형상 (접기 엔진의 출력 = 비행 엔진의 입력)
// ---------------------------------------------------------------------------

export type SurfaceKind = 'wing' | 'keel' | 'winglet';

/**
 * 공기 힘을 계산하는 최소 단위. 날개나 동체 면을 날개 폭 방향으로 잘게 나눈 띠 하나.
 * 모든 벡터는 기체 좌표.
 */
export interface AeroElement {
  kind: SurfaceKind;
  /** 'L' 왼쪽(+y), 'R' 오른쪽(-y), 'C' 중심(동체) */
  side: 'L' | 'R' | 'C';
  /** 이 띠의 앞전 중점 */
  le: Vec3;
  /** 앞전에서 뒷전으로 향하는 단위 벡터 (대체로 -x 방향) */
  chordDir: Vec3;
  /** 시위 길이(m) */
  chord: number;
  /** 띠의 폭(m). area = chord * width */
  width: number;
  /** 면적(m^2) */
  area: number;
  /** 면의 단위 법선. 날개는 대체로 +z, 동체(용골)는 대체로 +y. */
  normal: Vec3;
  /** 이 띠가 속한 면 전체의 가로세로비 (폭^2 / 면적). 양력 기울기 계산용. */
  surfaceAR: number;
  /** 뒷전 꺾임(승강타) 각도(rad). 날개 띠에만 0 이 아닌 값. */
  flapRad: number;
  /** 이 띠 위치의 평균 종이 겹 수 */
  layers: number;
}

export interface PlaneGeometry {
  massKg: number;
  /** 무게중심 (기체 좌표) */
  cg: Vec3;
  /** 무게중심 기준 관성 텐서 (기체 축, kg m^2). [ixx, iyy, izz, ixy, ixz, iyz] */
  inertia: [number, number, number, number, number, number];
  elements: AeroElement[];
  /** 화면 표시와 진단용 요약 값 */
  stats: {
    /** 양쪽 날개 투영 면적 합(m^2) */
    wingAreaM2: number;
    /** 날개 끝에서 끝까지의 폭(m) */
    spanM: number;
    aspectRatio: number;
    /** 평균 공력 시위(m) */
    macM: number;
    /** 평균 공력 시위의 앞전 x (기체 좌표, 음수) */
    macLeX: number;
    /** 전체 길이(m) */
    lengthM: number;
    /** 날개 하중 N/m^2 */
    wingLoadingNm2: number;
    /** 무게중심 위치를 전체 길이 대비 비율로 (0 = 기수, 1 = 꼬리) */
    cgFracLength: number;
    /** 무게중심 위치를 평균 공력 시위 대비 비율로 (0 = 앞전, 1 = 뒷전) */
    cgFracMac: number;
    keelAreaM2: number;
    maxLayers: number;
    /** 좌우 비대칭 정도. (왼쪽 날개 면적 - 오른쪽 날개 면적) / 전체. 대칭이면 0. */
    asymmetry: number;
    /** 날개 뿌리 기준 단위 폭당 굽힘 강성 (N m). E * t^3 / 12 * 유효 겹 계수. */
    wingBendStiffnessNm: number;
  };
  /**
   * 3D 화면 표시용 삼각형 목록 (기체 좌표). positions 는 xyz 반복, layers 는 삼각형별 겹 수.
   *
   * 아래의 선택 필드는 "종이 무늬가 접힌 대로 따라가게" 그리려고 덧붙인 것이다.
   * 화면 표시에만 쓰며 물리 계산(무게, 무게중심, 공기 힘, 요약 값)에는 전혀 쓰이지 않는다.
   * buildGeometry 는 항상 채워 주지만, 다른 곳에서 만든 형상에는 없을 수 있으므로 선택 필드다.
   */
  mesh: {
    positions: number[];
    layers: number[];
    /**
     * 꼭짓점마다 "펼친 종이 위의 자리" (u, v 반복, 삼각형당 6개). 0..1 로 맞춘 값이다.
     * u = 0 은 종이 왼쪽 가장자리(종이 좌표 x = -폭/2), u = 1 은 오른쪽. v = 0 은 꼬리 쪽 끝, v = 1 은 기수 쪽 끝.
     * 종이 앞면을 마주 보고 잰 자리다. 뒷면 그림을 붙일 때는 u 를 1 - u 로 뒤집어야 글씨가 바로 보인다.
     */
    sheetUv?: number[];
    /**
     * 삼각형마다 하나. positions 의 꼭짓점 순서로 오른손 법칙을 썼을 때 법선이 향하는 쪽에
     * 종이의 앞면이 보이면 +1, 뒷면이 보이면 -1. 반대쪽에는 당연히 다른 면이 보인다.
     */
    faceSide?: number[];
    /** 삼각형마다 하나. 위와 같은 법선이 겹 묶음의 위쪽(맨 위 겹 쪽)을 향하면 +1, 아래쪽이면 -1. */
    stackSide?: number[];
    /** 삼각형마다 하나. 이 삼각형이 속한 겹의 쌓인 순서(0 이 맨 아래, stackCount - 1 이 맨 위). */
    stackOrder?: number[];
    /** 납작하게 접힌 종이의 겹(다각형) 개수 */
    stackCount?: number;
    /** 꼭짓점마다 "납작하게 접힌 상태에서의 종이 좌표" (x, y 반복, 미터). 접힌 종이가 비행기로 펴지는 연출에 쓴다. */
    flatXY?: number[];
    /**
     * 입체 마무리에 실제로 쓰인 치수(입력값을 종이 크기에 맞게 다듬은 뒤의 값).
     * flatXY 와 함께 쓰면 납작한 종이에서 지금 모양까지를 화면에서 이어 그릴 수 있다.
     */
    fold?: {
      /** 동체 깊이(m) */
      keelM: number;
      /** 중심선에서 날개와 날개 끝의 경계까지의 거리(m). 왼쪽(+y) / 오른쪽 */
      wingEndLeftM: number;
      wingEndRightM: number;
      dihedralDeg: number;
      /** 날개 끝을 더 꺾은 각도(도). 날개 끝 세우기가 없으면 0 */
      wingletDeg: number;
      /** 접힌 종이에서 가장 앞(기수) 점의 종이 좌표 y. 기체 x = 종이 y - noseY */
      noseY: number;
      /** 종이 한 장의 두께(m). 겹 사이 간격 */
      thicknessM: number;
    };
  };
}

// ---------------------------------------------------------------------------
// 비행 결과
// ---------------------------------------------------------------------------

export type FlightVerdict =
  | 'glide'      // 안정 활공
  | 'stall'      // 급상승 후 실속하며 떨어짐 (출렁임 포함)
  | 'dive'       // 기수가 숙여져 급강하
  | 'tumble'     // 뒤집히거나 빙글빙글 돎
  | 'spiral'     // 한쪽으로 휘어 나선 강하
  | 'flutter';   // 낙엽처럼 흔들리며 떨어짐

export interface FlightSample {
  t: number;
  pos: Vec3;
  quat: Quat;
  speed: number;
  /** 기체 전체 받음각(도) */
  alphaDeg: number;
}

export interface SimResult {
  /** 던진 지점에서 착지 지점까지의 수평 직선 거리(m) */
  distanceM: number;
  airtimeS: number;
  maxHeightM: number;
  /** 착지 지점의 좌우 벗어남(m). 왼쪽 + */
  lateralM: number;
  verdict: FlightVerdict;
  /** 사용자에게 보여줄 한 줄 진단 (한국어) */
  diagnosisKo: string;
  /** 다음에 무엇을 바꾸면 좋을지 (한국어, 0~3개) */
  tipsKo: string[];
  /** 화면 재생용 표본. 대략 60Hz. */
  samples: FlightSample[];
  /** 종이가 던지는 힘과 바람을 버텼는지 (구조). 화면이 "왜 그랬는지"를 말해 줄 때 쓴다. */
  structure: FlightStructure;
}

/**
 * 종이의 구조 결과. 모델은 추정이다(src/core/aero/forces.ts 의 STRUCT 설명 참고).
 * 날개 뿌리에 걸리는 굽힘이 종이가 버티는 한계를 넘으면 날개가 꺾여(좌굴) 위로 접히고, 그 비행 동안 약해진 채로 남는다.
 */
export interface FlightStructure {
  /**
   * 던지는 순간 손 안에서 이미 날개가 꺾였는지. true 면 꺾인 날개로 비행을 시작한다.
   * 손의 속도(던지는 속도) 자체는 줄이지 않는다. 대신 접혀서 펄럭이는 종이는 손을 떠나자마자 큰 항력으로 속도를 잃는다.
   * 화면 문구 예: "종이가 너무 흐물흐물해서 힘이 다 실리지 않았어요".
   */
  collapsedAtLaunch: boolean;
  /** 비행 중(던지는 순간 포함) 날개가 꺾였는지 */
  buckled: boolean;
  /** 날개가 꺾인 시각(s). 던지는 순간이면 0, 꺾이지 않았으면 null */
  buckledAtS: number | null;
  /** 날개 뿌리 굽힘 / 버티는 한계 의 최댓값. 1 을 넘으면 꺾인다. 0.7 이상이면 아슬아슬했던 것. */
  peakLoadRatio: number;
  /** 날개 끝이 가장 많이 휜 각도(도) */
  maxFlexDeg: number;
  /**
   * 이 비행기(종이 + 접기)의 날개가 손 안에서 버티는 가장 빠른 던지기 속도(m/s).
   * 한도(LIMITS.throwSpeedMax)까지 버티면 한도 값, 가장 살살(LIMITS.throwSpeedMin) 던져도 접히면 최소 값이다.
   */
  safeThrowSpeedMps: number;
  /** 사용자에게 보여줄 한 줄 설명(한국어). 구조에 문제가 없었으면 null */
  noteKo: string | null;
}

/** 던지기 전에 보여주는 공기역학 분석 */
export interface AeroSummary {
  /** 받음각별 계수 곡선 (기체 전체, 기준 면적은 stats.wingAreaM2, 모멘트 기준점은 무게중심) */
  polar: { alphaDeg: number; cl: number; cd: number; cm: number }[];
  /** 모멘트가 0 이 되는 안정 받음각(도). 없으면 null */
  trimAlphaDeg: number | null;
  /** 안정 활공 속도(m/s). 없으면 null */
  trimSpeedMps: number | null;
  /** 안정 활공 시 활공비 (전진 거리 / 하강 높이). 없으면 null */
  glideRatio: number | null;
  /** 최대 양항비 */
  maxLD: number;
  /** 실속 받음각(도) */
  stallAlphaDeg: number;
  /** 중립점 x (기체 좌표). 안정 받음각 근처(없으면 3도)에서 받음각이 조금 변할 때 늘어나는 양력이 걸리는 지점. */
  neutralPointX: number;
  /** 정적 여유 = (무게중심 x - 중립점 x) / 평균 공력 시위. + 면 안정. */
  staticMargin: number;
  /** 세로 안정성 판정 */
  pitchStability: 'tumble' | 'marginal' | 'stable' | 'nose-heavy';
  /** 좌우 안정성 판정 */
  lateralStability: 'unstable' | 'neutral' | 'stable';
  /** 안정 활공 조건의 레이놀즈수 (없으면 5 m/s 기준) */
  reynolds: number;
  /** 한국어 요약 문장들 */
  notesKo: string[];
}

export interface ValidationResult {
  ok: boolean;
  /** 사용자에게 보여줄 수 있는 한국어 오류 메시지 */
  errors: string[];
}

// ---------------------------------------------------------------------------
// 바람 실험실(풍동). TUNNEL_CONTRACT.md 의 계약 그대로다.
// ---------------------------------------------------------------------------

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

/**
 * 물리 모델의 판 번호. 계산 결과가 달라지는 변경을 할 때마다 올린다.
 * 화면은 이 값이 바뀌면 저장해 둔 기록을 다시 계산한다.
 *
 * 올려야 하는 경우: src/core/aero/**, src/core/sim/**, src/core/fold/geometry.ts, papers.ts 의 수치,
 * LIMITS 의 물리 값(던지는 높이, 클립 무게, 속도 한도)처럼 같은 설계와 던지기의 결과(거리, 체공 시간, 판정)를
 * 조금이라도 바꾸는 모든 변경. 문구만 바꾼 경우는 올리지 않는다.
 *
 *  1: 처음 공개한 모델
 *  2: 어린이 던지기 속도, 종이 꺾임(좌굴), 접은 종이의 항력 예산을 넣은 균형 재조정
 */
export const PHYSICS_VERSION: number = 2;
