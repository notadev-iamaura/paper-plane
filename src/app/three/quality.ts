/**
 * 화질 단계(높음 / 보통 / 낮음).
 * 기기의 화소 비율, 화면 크기, 프레임 시간을 보고 고르고, 느리면 스스로 한 단계씩 내린다(올리지는 않는다).
 */
export type TierName = 'high' | 'medium' | 'low';

export interface Tier {
  name: TierName;
  /** 화소 비율 상한 */
  pixelRatio: number;
  /** 그림자 지도 한 변(화소). 0 이면 진짜 그림자 대신 둥근 그림자만 쓴다. */
  shadowSize: number;
  /** 그림자가 덮는 범위의 반 폭(m) */
  shadowRange: number;
  /** 아이와 심판의 남색 외곽선 */
  outline: boolean;
  /** 관중과 소품의 외곽선 */
  crowdOutline: boolean;
  /** 관중 수 */
  crowd: number;
  /** 관중이 그림자를 드리우는지 */
  crowdShadow: boolean;
  /** 빛줄기, 창 빛무리, 먼지 */
  shafts: boolean;
  dust: number;
  /** 색종이 조각 수 */
  confetti: number;
  /** 바닥에 비치는 창과 조명 */
  floorSheen: boolean;
  anisotropy: number;
}

export const TIERS: Record<TierName, Tier> = {
  high: { name: 'high', pixelRatio: 2, shadowSize: 2048, shadowRange: 11, outline: true, crowdOutline: true, crowd: 54, crowdShadow: true, shafts: true, dust: 150, confetti: 150, floorSheen: true, anisotropy: 8 },
  medium: { name: 'medium', pixelRatio: 1.5, shadowSize: 1024, shadowRange: 10, outline: true, crowdOutline: false, crowd: 36, crowdShadow: false, shafts: true, dust: 70, confetti: 90, floorSheen: true, anisotropy: 4 },
  low: { name: 'low', pixelRatio: 1, shadowSize: 0, shadowRange: 9, outline: false, crowdOutline: false, crowd: 14, crowdShadow: false, shafts: false, dust: 0, confetti: 40, floorSheen: false, anisotropy: 2 },
};

const ORDER: TierName[] = ['high', 'medium', 'low'];
const FORCE_KEY = 'pp-3d-tier';

/** 개발, 갈무리용: localStorage 에 단계를 적어 두면 그 단계로 고정한다. */
export function forcedTier(): TierName | null {
  try {
    const v = window.localStorage.getItem(FORCE_KEY);
    return v === 'high' || v === 'medium' || v === 'low' ? v : null;
  } catch {
    return null;
  }
}

/** 그래픽 칩 없이 CPU 로 그리는 환경(소프트웨어 렌더러)인지. 이런 곳은 처음부터 가장 가볍게 그린다. */
function isSoftwareGl(gl: WebGLRenderingContext | WebGL2RenderingContext | null): boolean {
  if (!gl) return false;
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|software|softpipe|basic render/i.test(name);
  } catch {
    return false;
  }
}

/** 처음 고르는 단계: 화면이 아주 촘촘하고 큰 기기는 화소가 많아 부담이 크다. 작은 코어 수의 기기는 낮음부터 시작한다. */
export function pickInitialTier(gl: WebGLRenderingContext | WebGL2RenderingContext | null = null): TierName {
  const forced = forcedTier();
  if (forced) return forced;
  if (isSoftwareGl(gl)) return 'low';
  let cores = 4, mem = 4;
  try {
    cores = navigator.hardwareConcurrency || 4;
    mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  } catch { /* 모르면 보통 기기로 본다 */ }
  const dpr = window.devicePixelRatio || 1;
  const pixels = window.innerWidth * window.innerHeight * Math.min(dpr, 2) ** 2;
  const coarse = (() => { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; } })();
  if (cores <= 2 || mem <= 2) return 'low';
  if (coarse) return cores >= 8 && mem >= 6 && pixels < 2.6e6 ? 'high' : 'medium';
  return cores >= 4 && pixels < 6e6 ? 'high' : 'medium';
}

/**
 * 프레임 시간을 지켜보다가 계속 느리면 단계를 내리라고 알려 준다.
 * 탭 전환 같은 튀는 값은 버리고, 약 1.5초 동안의 평균으로 판단한다.
 */
export class Governor {
  private acc = 0;
  private n = 0;
  private warm = 4;
  private crawl = 0;
  private strikes = 0;
  private locked: boolean;
  constructor(private tier: TierName, private onChange: (t: TierName) => void) {
    this.locked = forcedTier() !== null;
  }
  get current(): TierName { return this.tier; }
  lock(t: TierName): void {
    this.locked = true;
    if (t !== this.tier) { this.tier = t; this.onChange(t); }
  }
  /** dt: 방금 그린 프레임과 그 앞 프레임 사이의 시간(초). capped: 일부러 천천히 그리는 중이면 true(판단하지 않는다). */
  sample(dt: number, capped: boolean): void {
    // 1초가 넘는 틈은 탭을 떠났다 돌아온 것으로 보고 버린다. 그 밖의 긴 프레임은 "아주 느림"으로 센다.
    if (this.locked || capped || dt <= 0 || dt > 1) return;
    if (this.warm > 0) { this.warm--; return; }
    // 연달아 두 프레임이 0.15초를 넘으면(초당 7장 미만) 기다리지 않고 바로 내린다.
    if (dt > 0.15) {
      if (++this.crawl >= 2) { this.crawl = 0; this.down(); return; }
    } else this.crawl = 0;
    this.acc += Math.min(dt, 0.25);
    this.n++;
    if ((this.acc < 1.5 && this.n < 45) || this.n < 4) return;
    const avg = this.acc / this.n;
    this.acc = 0;
    this.n = 0;
    // 평균 30 ms(초당 33장 미만)가 두 번 이어지면 한 단계 내린다. 아주 느리면(55 ms) 바로 내린다.
    if (avg > 0.055) this.strikes += 2;
    else if (avg > 0.03) this.strikes += 1;
    else this.strikes = Math.max(0, this.strikes - 1);
    if (this.strikes >= 2) this.down();
  }
  private down(): void {
    this.strikes = 0;
    this.acc = 0;
    this.n = 0;
    const i = ORDER.indexOf(this.tier);
    if (i < ORDER.length - 1) {
      this.tier = ORDER[i + 1]!;
      // 단계를 바꾼 직후의 프레임(셰이더를 다시 만든다)은 세지 않는다.
      this.warm = 3;
      this.onChange(this.tier);
    }
  }
}
