/**
 * 설계 검사. 믿을 수 없는 입력(서버로 들어온 값, 붙여넣은 공유 코드)을 확인한다.
 * - 어떤 입력이 와도 예외를 던지지 않는다(null, 배열, 문자열, 엉뚱한 구조, 거대한 배열, getter 가 터지는 객체 등).
 * - 정해진 키만 허용한다. '__proto__' 같은 낯선 키가 있으면 거부한다.
 * - 통과한 값은 PlaneDesign 으로 안전하게 쓸 수 있다.
 */
import type { ValidationResult } from './types';
import { LIMITS } from './types';
import { getPaper } from './papers';

/** 접는 선의 두 점이 이보다 가까우면 같은 점으로 본다(m). */
export const MIN_FOLD_POINT_DISTANCE_M = 5e-4;
/** 길이 비교 허용 오차(m). 공유 코드의 0.1 mm 반올림 때문에 생기는 차이를 받아 준다. */
const LEN_TOL = 1.5e-4;
/** 오류 메시지 최대 개수 */
const MAX_ERRORS = 12;

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** 평범한 객체인지(배열, null, 클래스 인스턴스 제외) */
function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x) as unknown;
  return proto === Object.prototype || proto === null;
}

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** 허용한 키만 있고, 필요한 키가 모두 있는지 */
function checkKeys(o: Record<string, unknown>, keys: readonly string[], label: string, errors: string[]): boolean {
  const own = Object.keys(o);
  if (own.length > keys.length + 8) {
    errors.push(`${label}에 알 수 없는 항목이 너무 많습니다.`);
    return false;
  }
  let ok = true;
  for (const k of own) {
    if (!keys.includes(k)) {
      errors.push(`${label}에 알 수 없는 항목이 있습니다.`);
      ok = false;
      break;
    }
  }
  for (const k of keys) {
    if (!hasOwn(o, k)) {
      errors.push(`${label}에 필요한 항목(${k})이 없습니다.`);
      ok = false;
    }
  }
  return ok;
}

function checkRange(v: unknown, lo: number, hi: number, label: string, errors: string[]): v is number {
  if (!isNum(v)) {
    errors.push(`${label} 값이 올바른 숫자가 아닙니다.`);
    return false;
  }
  if (v < lo || v > hi) {
    errors.push(`${label} 값이 허용 범위(${lo} ~ ${hi})를 벗어났습니다.`);
    return false;
  }
  return true;
}

function check(x: unknown, errors: string[]): void {
  if (!isPlainObject(x)) {
    errors.push('설계 데이터 형식이 올바르지 않습니다.');
    return;
  }
  if (!checkKeys(x, ['v', 'paperId', 'folds', 'shaping', 'clip'], '설계', errors)) return;

  if (x.v !== 1) errors.push('지원하지 않는 설계 버전입니다.');

  // 종이
  const paper = typeof x.paperId === 'string' && x.paperId.length <= 64 ? getPaper(x.paperId) : undefined;
  if (!paper) errors.push('알 수 없는 종이입니다.');
  // 종이를 모르면 A4 크기로 나머지 검사를 계속한다(오류는 이미 기록됨).
  const widthM = paper ? paper.widthM : 0.21;
  const heightM = paper ? paper.heightM : 0.297;

  // 접기 목록
  const folds = x.folds;
  if (!Array.isArray(folds)) {
    errors.push('접기 목록이 올바르지 않습니다.');
  } else if (folds.length > LIMITS.maxFolds) {
    // 길이를 먼저 확인하므로 거대한 배열도 내용을 훑지 않는다.
    errors.push(`접기는 최대 ${LIMITS.maxFolds}번까지 할 수 있습니다.`);
  } else {
    const bx = 2 * widthM;
    const by = 2 * heightM;
    for (let i = 0; i < folds.length && errors.length < MAX_ERRORS; i++) {
      const label = `${i + 1}번째 접기`;
      const f: unknown = folds[i];
      if (!isPlainObject(f) || !checkKeys(f, ['a', 'b', 'dir'], label, errors)) {
        if (!isPlainObject(f)) errors.push(`${label}의 형식이 올바르지 않습니다.`);
        continue;
      }
      if (f.dir !== 'valley' && f.dir !== 'mountain') errors.push(`${label}의 방향은 골접기 또는 산접기여야 합니다.`);
      const pts: { x: number; y: number }[] = [];
      for (const key of ['a', 'b'] as const) {
        const p: unknown = f[key];
        if (!isPlainObject(p) || !checkKeys(p, ['x', 'y'], `${label}의 점`, errors)) {
          if (!isPlainObject(p)) errors.push(`${label}의 점 형식이 올바르지 않습니다.`);
          continue;
        }
        if (!isNum(p.x) || !isNum(p.y)) {
          errors.push(`${label}의 좌표가 올바른 숫자가 아닙니다.`);
          continue;
        }
        if (Math.abs(p.x) > bx || Math.abs(p.y) > by) {
          errors.push(`${label}의 점이 종이에서 너무 멀리 있습니다.`);
          continue;
        }
        pts.push({ x: p.x, y: p.y });
      }
      if (pts.length === 2) {
        const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        if (dist < MIN_FOLD_POINT_DISTANCE_M) errors.push(`${label}의 두 점이 같습니다. 서로 다른 두 점을 지정해 주세요.`);
      }
    }
  }

  // 입체 마무리
  const s = x.shaping;
  if (!isPlainObject(s)) {
    errors.push('마무리 접기 값이 올바르지 않습니다.');
  } else if (checkKeys(s, ['keelM', 'dihedralDeg', 'wingletM', 'wingletDeg', 'elevatorDeg'], '마무리 접기', errors)) {
    const half = widthM / 2;
    const okKeel = checkRange(s.keelM, 0, half + LEN_TOL, '동체 깊이', errors);
    const okWl = checkRange(s.wingletM, 0, half + LEN_TOL, '날개 끝 폭', errors);
    if (okKeel && okWl && (s.keelM as number) + (s.wingletM as number) > half + LEN_TOL) {
      errors.push('동체 깊이와 날개 끝 폭의 합이 종이 반쪽 폭보다 큽니다.');
    }
    checkRange(s.dihedralDeg, LIMITS.dihedralMin, LIMITS.dihedralMax, '상반각', errors);
    checkRange(s.wingletDeg, LIMITS.wingletDegMin, LIMITS.wingletDegMax, '날개 끝 각도', errors);
    checkRange(s.elevatorDeg, LIMITS.elevatorMin, LIMITS.elevatorMax, '뒷전 꺾기 각도', errors);
  }

  // 클립
  const c = x.clip;
  if (c !== null) {
    if (!isPlainObject(c)) {
      errors.push('클립 값이 올바르지 않습니다.');
    } else if (checkKeys(c, ['xBodyM'], '클립', errors)) {
      if (!isNum(c.xBodyM)) errors.push('클립 위치가 올바른 숫자가 아닙니다.');
      else if (c.xBodyM > LEN_TOL || c.xBodyM < -heightM - LEN_TOL) errors.push('클립 위치가 비행기 길이를 벗어났습니다.');
    }
  }
}

/** 설계가 규칙에 맞는지 검사한다. 절대 예외를 던지지 않는다. */
export function validateDesign(x: unknown): ValidationResult {
  const errors: string[] = [];
  try {
    check(x, errors);
  } catch {
    // getter 나 Proxy 가 예외를 던지는 등 비정상 객체
    errors.push('설계 데이터를 읽을 수 없습니다.');
  }
  return { ok: errors.length === 0, errors: errors.slice(0, MAX_ERRORS) };
}
