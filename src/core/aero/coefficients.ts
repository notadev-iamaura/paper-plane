/**
 * 얇은 평판(종이) 한 장의 공기 힘 계수 모음.
 *
 * 종이비행기는 "얇고 평평한 판 + 낮은 가로세로비 + 낮은 레이놀즈수(1만~10만)" 영역이라
 * 교과서의 두꺼운 날개 공식(양력 = 2π·받음각)을 그대로 쓰면 맞지 않는다.
 * 여기서는 다음 세 가지를 합쳐 -180~180도 전 범위에서 쓸 수 있는 계수를 만든다.
 *
 *  1) 붙은 흐름(작은 받음각): 선형 양력(Helmbold 식) + 소용돌이 양력(Polhamus 앞전 흡입 유추).
 *  2) 떨어진 흐름(실속 이후): 평판이 바람을 막는 힘(Hoerner 평판 수직력).
 *  3) 둘 사이는 가로세로비에 따라 달라지는 실속각 근처에서 부드럽게 섞는다.
 *
 * 날카로운 종이 앞전은 앞전 흡입력을 거의 만들지 못하므로 공기 힘은 "판에 수직인 힘(수직력)"
 * 으로만 다룬다. 이렇게 하면 양력이 생길 때 따라오는 유도 항력(= 수직력 * sin(받음각))이 저절로 포함된다.
 *
 * 각 계수는 문헌 값에 맞춘 근사식이며, 종이비행기 실측 범위(활공비 3~6)에 맞춰 조정했다.
 * 받음각 0 근처의 항력(기생 항력)은 상수 하나가 아니라 형상에서 항목별로 더해 만든다(forces.ts 의 "항력 예산" 참고).
 */

/** 공기와 중력 상수 */
export const AIR = {
  /** 공기 밀도 kg/m^3 */
  rho: 1.225,
  /** 동점성 계수 m^2/s */
  nu: 1.5e-5,
  /** 중력 가속도 m/s^2 */
  g: 9.81,
} as const;

/** 모델 조정 계수. 한곳에 모아 두어 시험하며 맞추기 쉽게 한다. */
export const COEF = {
  /** 소용돌이 양력 계수의 기본값(가로세로비가 0 에 가까울 때). 이론값 π 보다 낮은 레이놀즈수를 감안해 조금 줄였다. */
  kv0: 2.6,
  /** 가로세로비가 이 값쯤 되면 소용돌이 양력이 절반으로 줄어든다(긴 날개는 앞전 소용돌이가 유지되지 않는다). */
  kvFadeAR: 3,
  /** 실속각(도) = stallBase + stallPerInvAR / 가로세로비. AR 1 → 37도, AR 2.5 → 약 20도, AR 8 → 약 12도 */
  stallBaseDeg: 8,
  stallPerInvARDeg: 29,
  stallMinDeg: 9,
  stallMaxDeg: 45,
  /** 작은 받음각에서 양력 작용점(시위 비율) */
  cpSmall: 0.25,
  /** 받음각 90도에서 양력 작용점(시위 비율) */
  cpFlat: 0.5,
  // ---- 받음각 0 근처의 항력(기생 항력) 예산. forces.ts 의 parasiteCoeff 설명 참고 ----
  /** 층류 마찰 계수 상수(Blasius): 한 면당 1.328 / sqrt(Re) */
  blasius: 1.328,
  /** 난류 마찰 계수(Prandtl 1/5 승 법칙): 한 면당 0.074 / Re^0.2 */
  turbCf: 0.074,
  /**
   * 얇고 날카로운 판은 받음각이 약 3도만 되어도 앞전 바로 뒤에서 흐름이 살짝 떨어졌다가 다시 붙는다(앞전 박리 거품).
   * 다시 붙은 뒤의 윗면 경계층은 난류다. 이 각도(도)에서 윗면의 절반이 난류라고 본다(추정).
   */
  bubbleAlphaDeg: 3,
  /** 접은 자국과 잔주름 때문에 매끈한 평판보다 마찰이 늘어나는 배수(추정). 압력 항력은 아래 항목들로 따로 센다. */
  frictionRoughness: 1.1,
  /** 겹쳐 접은 가장자리는 완전히 눌리지 않아 종이 두께 합보다 두껍다(배수, 추정). */
  foldBulge: 1.5,
  /** 겹은 대개 앞전 쪽 1/3 에 몰려 있다: 앞전 두께 = 종이 두께 x (1 + 이 값 x (평균 겹 수 - 1)) (추정). */
  layerConcentration: 3,
  /** 뭉툭한 앞전(접힌 가장자리)의 정면 넓이 기준 항력 계수. Hoerner: 둥글린 뭉툭한 앞면 0.5~1.0 */
  bluntLeadingEdgeCd: 0.7,
  /** 잘린 뒷전(종이 두께만큼의 단면)의 밑면 항력 계수. Hoerner: 0.3~0.6 */
  bluntTrailingEdgeCd: 0.4,
  /** 동체(용골) 앞끝의 뭉툭한 겹 뭉치가 받는 정면 항력 계수 */
  keelNoseCd: 0.8,
  /** 동체 뒤끝: 맞붙은 겹 사이가 벌어진 틈의 밑면 항력 계수 */
  keelBaseCd: 0.6,
  /** 눌러 접은 동체가 되벌어지는 정도(벌어진 각의 탄젠트). 깊이 2 cm 동체의 위쪽 틈이 약 3 mm (추정). */
  keelOpenTan: 0.15,
  /** 손으로 접은 날개의 울퉁불퉁함(굴곡, 날개와 동체가 만나는 모서리)이 만드는 압력 항력. 날개 면적 기준(추정). */
  handmadeCd: 0.004,
  /** 승강타(뒷전 15% 꺾기)의 이론 효율. 얇은 날개 이론에서 시위 15% 플랩은 0.48 */
  flapTau: 0.48,
  /** 낮은 레이놀즈수에서는 뒷전 경계층이 두꺼워 플랩 효과가 줄어든다(배수). */
  flapLowReFactor: 0.65,
  /** 플랩이 만드는 추가 힘의 작용점(시위 비율). 얇은 날개 이론: 0.25 + 0.607/3.02 ≈ 0.45 */
  flapCp: 0.45,
  /** 플랩 시위 비율 */
  flapChordFrac: 0.15,
  /** 꺾인 플랩이 바람을 막아 생기는 항력 계수(플랩 면적 기준 평판 항력) */
  flapDragCn: 1.2,
} as const;

const DEG = Math.PI / 180;

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * 선형 양력 기울기 Kp (1/rad). Helmbold 식.
 * 가로세로비(AR)가 작으면 π·AR/2 (가느다란 날개 이론), 크면 2π 에 가까워진다.
 */
export function liftSlopeKp(ar: number): number {
  return (2 * Math.PI * ar) / (2 + Math.sqrt(ar * ar + 4));
}

/**
 * 소용돌이 양력 계수 Kv. 날카로운 앞전과 날개 끝에서 말려 올라가는 소용돌이가 윗면 압력을 낮춰
 * 받음각의 제곱에 비례하는 추가 양력을 만든다(Polhamus). 가로세로비가 클수록 이 효과는 사라진다.
 */
export function vortexKv(ar: number): number {
  const r = ar / COEF.kvFadeAR;
  return COEF.kv0 / (1 + r * r);
}

/** 실속 받음각(rad). 가로세로비가 작을수록 소용돌이가 흐름을 붙잡아 주어 더 큰 각까지 버틴다. */
export function stallAngleRad(ar: number): number {
  const deg = clamp(COEF.stallBaseDeg + COEF.stallPerInvARDeg / ar, COEF.stallMinDeg, COEF.stallMaxDeg);
  return deg * DEG;
}

/** 실속이 진행되는 각도 폭(rad). 긴 날개는 갑자기, 짧은 날개는 완만하게 실속한다. */
export function stallWidthRad(ar: number): number {
  return clamp(2.5 + 2.5 / ar, 3, 6) * DEG;
}

/**
 * 바람을 정면(90도)으로 받을 때의 수직력 계수. Hoerner 의 직사각형 평판 값.
 * 정사각형 근처는 약 1.15, 아주 길쭉한 판은 2.0.
 */
export function cn90(ar: number): number {
  return Math.min(2.0, 1.1 + 0.02 * (ar + 1 / ar));
}

/** 한 면(날개 전체 등)의 가로세로비로 미리 계산해 두는 값들 */
export interface PlateParams {
  kp: number;
  kv: number;
  stallRad: number;
  stallWidthRad: number;
  cn90: number;
  /** 길쭉한 정도(0 = 보통 날개, 1 = 용골처럼 아주 길쭉한 면). 작용점과 회전 감쇠 계산에 쓴다. */
  slender: number;
}

export function plateParams(surfaceAR: number): PlateParams {
  // 극단적인 형상에서도 식이 터지지 않도록 가로세로비 범위를 제한한다.
  const ar = clamp(Number.isFinite(surfaceAR) ? surfaceAR : 1, 0.05, 20);
  return {
    kp: liftSlopeKp(ar),
    kv: vortexKv(ar),
    stallRad: stallAngleRad(ar),
    stallWidthRad: stallWidthRad(ar),
    cn90: cn90(ar),
    slender: 1 / (1 + Math.pow(ar / 0.35, 4)),
  };
}

/**
 * 흐름이 판에 붙어 있는 정도(1 = 완전히 붙음, 0 = 완전히 떨어짐).
 * sinAbs 는 판과 바람 사이 각의 사인 절댓값. 뒤에서 불어오는 바람(뒤로 날 때)도 같은 식을 쓴다
 * (평판은 앞뒤가 같은 모양이기 때문).
 */
export function attachedWeight(sinAbs: number, p: PlateParams): number {
  const a = Math.asin(sinAbs > 1 ? 1 : sinAbs);
  return 1 / (1 + Math.exp((a - p.stallRad) / p.stallWidthRad));
}

/**
 * 수직력 계수 CN. 판의 법선 방향으로 작용하는 힘 / (동압 * 면적).
 * sinA = sin(받음각), cosA = cos(받음각). 받음각이 양수면 바람이 판 아랫면을 때린다.
 *
 *  붙은 흐름:   CN = Kp·sinα·cosα + Kv·sin²α     (양력으로 바꾸면 Kp sinα cos²α + Kv sin²α cosα)
 *  떨어진 흐름: CN = CN90·sinα / (0.56 + 0.44·sinα)   (Hoerner)
 */
export function normalForceCoeff(sinA: number, cosA: number, p: PlateParams): number {
  const sa = Math.abs(sinA);
  const ca = Math.abs(cosA);
  const attached = p.kp * sa * ca + p.kv * sa * sa;
  const separated = (p.cn90 * sa) / (0.56 + 0.44 * sa);
  const w = attachedWeight(sa, p);
  const cn = w * attached + (1 - w) * separated;
  return sinA >= 0 ? cn : -cn;
}

/**
 * 양력 작용점(앞전에서 잰 시위 비율).
 * 작은 받음각에서는 25%, 받음각이 커질수록 뒤로 가서 90도에서 50%.
 * 받음각이 커지면 작용점이 뒤로 가므로 기수를 숙이는 힘이 생기고, 이것이 꼬리날개 없는
 * 종이비행기가 스스로 받음각을 유지하는 원리다(Li, Goodwill, Wang, Ristroph, JFM 2022).
 *
 * 아주 길쭉한 면(가로세로비 약 0.35 이하, 예: 용골)은 다르게 다룬다(추정).
 * 이런 면은 날카로운 가장자리 전체에서 흐름이 떨어져, 힘이 앞쪽에 몰리지 않고 길이 전체에 고르게 걸린다
 * (가느다란 물체의 가로흐름 이론). 그래서 작용점을 시위 가운데(slenderCp ≈ 50%) 쪽으로 둔다.
 * 날개(가로세로비 0.75 이상)에는 이 보정이 거의 들어가지 않는다.
 *
 * 뒤로 날 때(cosA < 0)는 뒷전이 앞전 역할을 하므로 뒷전에서부터 같은 규칙을 적용한다.
 */
export function centerOfPressureFrac(sinA: number, cosA: number, p: PlateParams): number {
  const sa = Math.abs(sinA);
  const small = COEF.cpSmall + (COEF.cpFlat - COEF.cpSmall) * p.slender;
  const fromLeadingEdge = small + (COEF.cpFlat - small) * sa;
  return cosA >= 0 ? fromLeadingEdge : 1 - fromLeadingEdge;
}

/**
 * 표면 마찰 계수(양면 합, 면적 기준).
 *
 * 종이비행기의 레이놀즈수(1만~10만)에서 매끈한 평판의 경계층은 층류다(Blasius: 한 면당 1.328/sqrt(Re)).
 * 다만 날카로운 앞전은 받음각이 조금만 있어도 윗면에 박리 거품을 만들고, 그 뒤는 난류로 다시 붙는다.
 * 그래서 "바람을 등진 면"은 받음각이 커질수록 난류 마찰(0.074/Re^0.2)에 가까워진다.
 *   양면 합 = 거칠기 배수 x [ 층류 + (1-w)·층류 + w·max(층류, 난류) ],  w = sin²α / (sin²α + sin²3°)
 * 레이놀즈수 1만 5천 아래에서는 난류 식이 층류 식보다 작게 나오는데, 그렇게 느린 흐름은 난류를 유지하지 못하므로 큰 쪽을 쓴다.
 * 레이놀즈수가 아주 작을 때 값이 무한히 커지지 않도록 하한을 둔다(속도가 0 에 가까울 때의 수치 보호).
 * @param sinAbs 판과 바람 사이 각의 사인 절댓값
 */
export function frictionCoeff(reynolds: number, sinAbs: number): number {
  // 층류 식에만 레이놀즈수 하한(500)을 둔다. 난류 식은 층류보다 클 때만 쓰이므로 하한이 필요 없다.
  const lam = COEF.blasius / Math.sqrt(reynolds < 500 ? 500 : reynolds);
  const turb = Math.max(lam, COEF.turbCf / Math.pow(Math.max(reynolds, 1e-3), 0.2));
  const s0 = Math.sin(COEF.bubbleAlphaDeg * DEG);
  const s2 = sinAbs * sinAbs;
  const w = s2 / (s2 + s0 * s0);
  return COEF.frictionRoughness * (lam + (1 - w) * lam + w * turb);
}
