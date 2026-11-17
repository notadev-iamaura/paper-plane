/** 숫자를 화면용 글자열로 바꾸는 도우미 모음 */

/** 소수 자릿수를 고정해 표시한다. 숫자가 아니면 '–'. */
export function fmt(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  // -0.00 처럼 보이는 것을 막는다.
  const s = v.toFixed(digits);
  return Number(s) === 0 ? (0).toFixed(digits) : s;
}

/** 미터 -> 센티미터 표시 */
export function cm(vM: number, digits = 1): string {
  return fmt(vM * 100, digits);
}

/** 미터 -> 밀리미터 표시 */
export function mm(vM: number, digits = 1): string {
  return fmt(vM * 1000, digits);
}

/** 비율 -> 퍼센트 표시 */
export function pct(frac: number, digits = 0): string {
  return fmt(frac * 100, digits);
}

/** 값을 범위 안으로 자른다. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 간격(step)에 맞춰 반올림한다. 0.1 + 0.2 같은 부동소수 오차도 정리한다. */
export function snapToStep(v: number, min: number, step: number): number {
  const n = Math.round((v - min) / step);
  return Number((min + n * step).toFixed(6));
}

/** 시각(ms) -> '11/13 21:05' */
export function shortTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
