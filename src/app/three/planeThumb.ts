/**
 * 위에서 내려다본 비행기 그림(2D 캔버스). 종이 무늬가 접힌 대로 붙어 있다.
 * 3D 장면 없이 가볍게 그릴 수 있어서 접는 법 카드, 목록, 저장한 비행기의 작은 그림에 쓴다.
 *
 * ── 바깥에서 쓰는 것 ─────────────────────────────────────────────────────────
 *   renderPlaneThumb(geom: PlaneGeometry, paperId: string, sizePx = 160): string
 *       저장해 둘 수 있는 작은 그림의 data URL(webp 또는 jpeg, 14000 자 이하). 못 만들면 빈 문자열.
 *   drawPlaneThumb(geom: PlaneGeometry, paperId: string, sizePx = 220): HTMLCanvasElement
 *       정사각형 캔버스에 비행기를 꼭 맞게 그려 돌려준다(기수가 위, 바탕은 투명).
 *   planeThumbUrl(key: string, geom: PlaneGeometry, paperId: string, sizePx = 220): string
 *       화면에 바로 쓰는 PNG data URL. key(+ 종이, 크기)로 기억해 두므로 같은 비행기는 한 번만 그린다.
 */
import type { PlaneGeometry } from '../../core/index';
import { tok } from '../lib/palette';
import { getPaperLook, paperLookVersion } from './paperLook';

export function drawPlaneThumb(geom: PlaneGeometry, paperId: string, sizePx = 220): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = sizePx;
  canvas.height = sizePx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const m = geom.mesh;
  const pos = m.positions;
  const n = Math.floor(pos.length / 9);
  if (n === 0) return canvas;
  // 작은 그림에는 작은 무늬면 충분하다.
  const look = getPaperLook(paperId, sizePx > 320 ? 'low' : 'swatch');
  const ink = tok('--ink');

  // 기체 좌표: x 앞, y 왼쪽 -> 그림: 왼쪽 날개가 왼쪽, 기수가 위
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n * 3; i++) {
    const sx = -pos[i * 3 + 1]!, sy = -pos[i * 3]!;
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  // 좌우 대칭으로 보이도록 가운데를 중심선에 맞춘다.
  const half = Math.max(Math.abs(minX), Math.abs(maxX), 1e-4);
  const pad = sizePx * 0.07;
  const scale = Math.min((sizePx - pad * 2) / (half * 2), (sizePx - pad * 2) / Math.max(1e-4, maxY - minY));
  const ox = sizePx / 2;
  const oy = (sizePx - (maxY - minY) * scale) / 2 - minY * scale;
  const PX = (t: number, k: number): number => ox - pos[t * 9 + k * 3 + 1]! * scale;
  const PY = (t: number, k: number): number => oy - pos[t * 9 + k * 3]! * scale;

  // 아래 겹부터 그린다(위에서 보므로 쌓인 순서가 곧 가리는 순서다).
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => (m.stackOrder?.[a] ?? 0) - (m.stackOrder?.[b] ?? 0));

  // 1) 남색 바탕: 전체 둘레에 굵은 외곽선이 남는다.
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = Math.max(3, sizePx * 0.034);
  for (const t of order) {
    ctx.beginPath();
    ctx.moveTo(PX(t, 0), PY(t, 0));
    ctx.lineTo(PX(t, 1), PY(t, 1));
    ctx.lineTo(PX(t, 2), PY(t, 2));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // 2) 겹마다: 무늬를 붙인 삼각형들, 그다음 그 겹의 가장자리 선
  const q = (v: number): number => Math.round(v * 1e6);
  const W = look.width, H = look.height;
  let i = 0;
  while (i < order.length) {
    const ord = m.stackOrder?.[order[i]!] ?? 0;
    let j = i;
    const edges = new Map<string, [number, number, number, number] | null>();
    while (j < order.length && (m.stackOrder?.[order[j]!] ?? 0) === ord) {
      const t = order[j]!;
      const x0 = PX(t, 0), y0 = PY(t, 0), x1 = PX(t, 1), y1 = PY(t, 1), x2 = PX(t, 2), y2 = PY(t, 2);
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(area) > 0.4) {
        // 위에서 볼 때 감긴 방향의 법선이 위를 보면(기체 좌표 z > 0) 그쪽 면이 보인다.
        const nz = (pos[t * 9 + 3]! - pos[t * 9]!) * (pos[t * 9 + 7]! - pos[t * 9 + 1]!) - (pos[t * 9 + 4]! - pos[t * 9 + 1]!) * (pos[t * 9 + 6]! - pos[t * 9]!);
        const front = (m.faceSide?.[t] ?? 1) * (nz >= 0 ? 1 : -1) > 0;
        const tex = front ? look.frontCanvas : look.backCanvas;
        const mirror = !front && look.backCanvas !== look.frontCanvas;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.closePath();
        ctx.fillStyle = front ? look.tint : look.backTint;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 0.8;
        ctx.fill();
        ctx.stroke(); // 삼각형 사이의 실금을 메운다
        const uv = m.sheetUv;
        if (uv) {
          ctx.clip();
          // 무늬 화소 (tx, ty) -> 화면 (x, y) 로 가는 변환을 세 꼭짓점으로 푼다.
          const u = (k: number): number => { const v = uv[t * 6 + k * 2]!; return (mirror ? 1 - v : v) * W; };
          const v = (k: number): number => (1 - uv[t * 6 + k * 2 + 1]!) * H;
          const u0 = u(0), v0 = v(0), u1 = u(1), v1 = v(1), u2 = u(2), v2 = v(2);
          const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
          if (Math.abs(det) > 1e-9) {
            const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det;
            const c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / det;
            const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det;
            const d = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / det;
            ctx.transform(a, b, c, d, x0 - a * u0 - c * v0, y0 - b * u0 - d * v0);
            ctx.drawImage(tex, 0, 0);
          }
        }
        ctx.restore();
      }
      // 이 겹의 가장자리(한 번만 나오는 변)를 모은다.
      const f = m.flatXY;
      for (let e = 0; e < 3; e++) {
        const g = (e + 1) % 3;
        const key = f
          ? ((): string => {
            const ka = `${q(f[t * 6 + e * 2]!)},${q(f[t * 6 + e * 2 + 1]!)}`;
            const kb = `${q(f[t * 6 + g * 2]!)},${q(f[t * 6 + g * 2 + 1]!)}`;
            return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
          })()
          : `${t}:${e}`;
        if (edges.has(key)) edges.set(key, null);
        else edges.set(key, [PX(t, e), PY(t, e), PX(t, g), PY(t, g)]);
      }
      j++;
    }
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = Math.max(1, sizePx * 0.008);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const seg of edges.values()) {
      if (!seg) continue;
      ctx.moveTo(seg[0], seg[1]);
      ctx.lineTo(seg[2], seg[3]);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    i = j;
  }
  return canvas;
}

/** 저장용 그림이 넘지 말아야 할 글자 수(격납고 저장소의 한도와 같다) */
const STORED_THUMB_MAX_CHARS = 14000;

/**
 * 저장해 둘 작은 그림. 투명 바탕을 살리려고 webp 를 먼저 써 보고,
 * webp 를 못 만드는 브라우저에서는 도화지색 바탕의 jpeg 로 만든다. 한도를 넘으면 화질을 낮춘다.
 */
export function renderPlaneThumb(geom: PlaneGeometry, paperId: string, sizePx = 160): string {
  try {
    const canvas = drawPlaneThumb(geom, paperId, sizePx);
    for (const q of [0.82, 0.6, 0.4]) {
      const url = canvas.toDataURL('image/webp', q);
      if (url.startsWith('data:image/webp') && url.length <= STORED_THUMB_MAX_CHARS) return url;
      if (!url.startsWith('data:image/webp')) break;
    }
    const flat = document.createElement('canvas');
    flat.width = sizePx;
    flat.height = sizePx;
    const ctx = flat.getContext('2d');
    if (!ctx) return '';
    ctx.fillStyle = tok('--paper');
    ctx.fillRect(0, 0, sizePx, sizePx);
    ctx.drawImage(canvas, 0, 0);
    for (const q of [0.8, 0.6, 0.45, 0.3]) {
      const url = flat.toDataURL('image/jpeg', q);
      if (url.length <= STORED_THUMB_MAX_CHARS) return url;
    }
  } catch {
    /* 그림을 못 만들어도 저장은 된다 */
  }
  return '';
}

const cache = new Map<string, string>();

export function planeThumbUrl(key: string, geom: PlaneGeometry, paperId: string, sizePx = 220): string {
  const k = `${key}|${paperId}|${sizePx}|${paperLookVersion()}`;
  const hit = cache.get(k);
  if (hit !== undefined) return hit;
  let url = '';
  try { url = drawPlaneThumb(geom, paperId, sizePx).toDataURL('image/png'); } catch { url = ''; }
  cache.set(k, url);
  if (cache.size > 80) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return url;
}
