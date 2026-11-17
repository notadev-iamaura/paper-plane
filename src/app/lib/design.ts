/**
 * 설계(PlaneDesign)를 다루는 화면 쪽 도우미.
 * 계산 자체는 모두 core 가 한다. 여기서는 값을 다듬고 묶는 일만 한다.
 */
import { decodeDesign, encodeDesign, getPaper, PAPERS } from '../../core/index';
import type { FoldOp, PaperSpec, PlaneDesign, Shaping, ThrowInput, Vec2 } from '../../core/index';
import { DEFAULT_PAPER_ID } from '../../core/papers';

/** 입체 마무리 값의 키. 프리셋 조절값 중 이 키들은 "마무리" 묶음으로 따로 보여준다. */
export const SHAPING_KEYS = ['keelM', 'dihedralDeg', 'wingletM', 'wingletDeg', 'elevatorDeg'] as const;
export type ShapingKey = (typeof SHAPING_KEYS)[number];

export function isShapingKey(key: string): key is ShapingKey {
  return (SHAPING_KEYS as readonly string[]).includes(key);
}

/** 길이를 공유 코드의 정밀도(0.1 mm)로 반올림한다. 이렇게 해 두면 코드로 바꿨다 되돌려도 값이 같다. */
export function roundLen(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

export function roundPoint(p: Vec2): Vec2 {
  return { x: roundLen(p.x), y: roundLen(p.y) };
}

/** 종이를 찾는다. 모르는 id 면 기본 종이. */
export function paperOf(paperId: string): PaperSpec {
  return getPaper(paperId) ?? getPaper(DEFAULT_PAPER_ID) ?? PAPERS[0]!;
}

/** 종이 한 장의 무게(g) = 평량 x 넓이 */
export function paperMassG(p: PaperSpec): number {
  return p.gsm * p.widthM * p.heightM;
}

/**
 * 접기를 중심선(x = 0)에 대해 뒤집은 접기.
 * 좌우를 뒤집으면 "진행 방향의 왼쪽"이 오른쪽이 되므로, a 와 b 를 바꿔 움직이는 쪽을 유지한다.
 */
export function mirrorFold(op: FoldOp): FoldOp {
  return { a: { x: -op.b.x, y: op.b.y }, b: { x: -op.a.x, y: op.a.y }, dir: op.dir };
}

/** 뒤집어도 같은 선인지(가로선이거나 중심선 자체). 그러면 대칭 접기를 한 번 더 할 필요가 없다. */
export function isSelfMirrorLine(op: FoldOp): boolean {
  const horizontal = Math.abs(op.a.y - op.b.y) < 1e-6;
  const onCenter = Math.abs(op.a.x) < 1e-6 && Math.abs(op.b.x) < 1e-6;
  return horizontal || onCenter;
}

/** a 와 b 를 바꾼 접기(움직이는 쪽이 반대가 된다) */
export function swapFold(op: FoldOp): FoldOp {
  return { a: op.b, b: op.a, dir: op.dir };
}

export interface Canonical {
  design: PlaneDesign;
  throwIn: ThrowInput;
  /** 설계 + 던지기 값이 모두 들어 있는 공유 코드 */
  code: string;
}

/**
 * 설계와 던지기 값을 "코드로 바꿨다가 되돌린 값"으로 맞춘다.
 * 화면, 주소로 불러온 화면, 랭킹 서버가 모두 이 값으로 계산해야 숫자가 한 자리도 다르지 않다.
 * 규칙에 맞지 않는 설계면 null.
 */
export function canonicalize(design: PlaneDesign, throwIn: ThrowInput): Canonical | null {
  const code = encodeDesign(design, throwIn);
  const back = decodeDesign(code);
  if (!back || !back.throwIn) return null;
  return { design: back.design, throwIn: back.throwIn, code };
}

/** 기본 입체 마무리 값(자유 모드를 빈 종이에서 시작할 때) */
export const DEFAULT_SHAPING: Shaping = {
  keelM: 0.02,
  dihedralDeg: 8,
  wingletM: 0,
  wingletDeg: 0,
  elevatorDeg: 3,
};

/** 주소(#p코드)에서 코드를 꺼낸다. 형식이 아니면 null. 글자는 영문자와 숫자만 허용한다. */
export function codeFromHash(hash: string): string | null {
  const m = /^#p([0-9A-Za-z]+)$/.exec(hash);
  return m ? m[1]! : null;
}
