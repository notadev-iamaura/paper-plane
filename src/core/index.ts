/**
 * core 의 공개 창구. 화면과 서버는 이 파일에서만 가져다 쓴다.
 * core 는 브라우저 기능(DOM, three 등)에 의존하지 않는 순수 계산 모듈이라
 * 브라우저와 서버(Node)에서 같은 코드가 그대로 돈다.
 */
import type {
  PlaneDesign, ThrowInput, PlaneGeometry, SimResult, AeroSummary, ValidationResult,
} from './types';
import { buildGeometry } from './fold/geometry';
import { validateDesign } from './validate';
import { simulate, validateThrow } from './sim/simulate';
import { analyze } from './aero/analyze';

export * from './types';
export { PAPERS, getPaper } from './papers';
export { PRESETS } from './presets';
export { encodeDesign, decodeDesign, type DecodedDesign } from './codec';
export { applyFolds, type FoldedSheet } from './fold/fold';
export { buildGeometry } from './fold/geometry';
export { validateDesign } from './validate';
export { simulate, validateThrow } from './sim/simulate';
export { analyze } from './aero/analyze';
export { probeTunnel, tunnelTrim } from './aero/tunnel';

export interface Evaluation {
  geometry: PlaneGeometry;
  summary: AeroSummary;
  result: SimResult;
}

/** 설계와 던지기 값이 규칙에 맞는지 검사한다. 서버는 반드시 이 함수를 통과한 값만 계산한다. */
export function validateSubmission(design: unknown, throwIn: unknown): ValidationResult {
  const d = validateDesign(design);
  const t = validateThrow(throwIn);
  return { ok: d.ok && t.ok, errors: [...d.errors, ...t.errors] };
}

/**
 * 설계 + 던지기 -> 공식 결과. 같은 입력이면 항상 같은 결과가 나온다(고정 시간 간격, 무작위 없음).
 * 화면의 연습 비행과 서버의 랭킹 재계산이 모두 이 함수를 쓴다.
 */
export function evaluate(design: PlaneDesign, throwIn: ThrowInput): Evaluation {
  const geometry = buildGeometry(design);
  const summary = analyze(geometry);
  const result = simulate(geometry, throwIn);
  return { geometry, summary, result };
}
