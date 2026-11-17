/**
 * 색 토큰을 스크립트에서 읽는 창구.
 * 색은 tokens.css 한곳에만 적어 두고, three.js 나 캔버스 그림이 필요할 때 여기서 꺼내 쓴다.
 */
const cache = new Map<string, string>();

/** CSS 변수(예: '--red')의 값. 읽지 못하면 남색 잉크를 돌려준다. */
export function tok(name: string): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  let v = '';
  try {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  } catch {
    v = '';
  }
  if (v === '') v = '#1d2a4d';
  cache.set(name, v);
  return v;
}
