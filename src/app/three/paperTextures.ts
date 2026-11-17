/**
 * 종이 여섯 가지의 겉모습을 캔버스에 직접 그린다(그림 파일 없음, 외부 요청 없음).
 * 이 파일은 "그리기"만 한다. 캐시, 화질 단계, three.js 재질은 paperLook.ts 가 맡는다.
 *
 * 그림 좌표는 mm 이다(A4: 210 x 297). 캔버스의 위쪽이 종이의 기수 쪽(종이 좌표 +y)이다.
 * 뒷면 그림은 "종이를 뒤집어 들고 본 모습"으로 그린다(글씨가 바로 읽힌다).
 * 신문지의 글씨는 진짜 글이 아니라 글처럼 보이는 짧은 줄과 네모다. 실제 신문이나 상표는 흉내 내지 않는다.
 * 제호만 지어낸 이름("체육관 신문")을 쓴다.
 */

export type PaperFace = 'front' | 'back';

/** 종이마다 정해 둔 겉모습 값. 그리는 쪽(2D, 3D)이 함께 쓴다. */
export interface PaperLookSpec {
  id: string;
  /** 앞면의 대표 색(#rrggbb). 무늬 없이 한 색으로 칠할 때 쓴다. */
  tint: string;
  /** 뒷면의 대표 색 */
  backTint: string;
  /** 잘린 가장자리(종이 두께가 보이는 곳)의 색 */
  edgeColor: string;
  /** 앞뒤가 같은 무늬인지. true 면 뒷면 그림을 따로 만들지 않는다. */
  sameBothSides: boolean;
  /** 거칠기 0(매끈) ~ 1(까슬까슬). 가장자리 빛의 세기를 줄인다. */
  roughness: number;
  /** 윤기 0 ~ 1. 매끈한 종이는 가장자리 빛이 더 또렷하다. */
  sheen: number;
  /** 눈에 보이는 겹 사이 간격(m). 실제 두께보다 조금 과장해 두꺼운 종이가 두꺼워 보이게 한다. */
  thicknessM: number;
  /** 비쳐 보이는 정도 0 ~ 1. 얇은 종이는 겹친 곳이 더 진하게 보인다(진짜 투명은 쓰지 않는다). */
  translucency: number;
  /** 흐물흐물한 정도 0 ~ 1 (참고 값) */
  floppy: number;
}

export const PAPER_LOOK_SPECS: Record<string, PaperLookSpec> = {
  newsprint: { id: 'newsprint', tint: '#d6cfbd', backTint: '#d4cdbb', edgeColor: '#bfb7a2', sameBothSides: false, roughness: 0.9, sheen: 0, thicknessM: 0.00018, translucency: 0.35, floppy: 1 },
  copy60: { id: 'copy60', tint: '#f6f9fd', backTint: '#f6f9fd', edgeColor: '#dfe6ee', sameBothSides: true, roughness: 0.35, sheen: 0.15, thicknessM: 0.00021, translucency: 0.8, floppy: 0.5 },
  copy80: { id: 'copy80', tint: '#f8f6ef', backTint: '#f8f6ef', edgeColor: '#e2ddd0', sameBothSides: true, roughness: 0.45, sheen: 0.1, thicknessM: 0.00027, translucency: 0.12, floppy: 0.2 },
  copy100: { id: 'copy100', tint: '#fdfdff', backTint: '#fdfdff', edgeColor: '#e6e8f0', sameBothSides: true, roughness: 0.1, sheen: 0.9, thicknessM: 0.00033, translucency: 0, floppy: 0.1 },
  craft120: { id: 'craft120', tint: '#3f7fdd', backTint: '#3f7fdd', edgeColor: '#2c61b8', sameBothSides: false, roughness: 0.8, sheen: 0, thicknessM: 0.00042, translucency: 0, floppy: 0 },
  kent160: { id: 'kent160', tint: '#f5eedd', backTint: '#f5eedd', edgeColor: '#d9cdb0', sameBothSides: true, roughness: 0.65, sheen: 0.05, thicknessM: 0.00056, translucency: 0, floppy: 0 },
};

/** 모르는 종이는 일반 복사지로 본다. */
export const FALLBACK_PAPER_LOOK_ID = 'copy80';

export const SHEET_W_MM = 210;
export const SHEET_H_MM = 297;
/** 제호에 쓰는 글자(글꼴 조각을 미리 불러오는 데 쓴다) */
export const MASTHEAD_TEXT = '체육관 신문';
export const MASTHEAD_FONT = "'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif";

type Ctx = CanvasRenderingContext2D;
type Rnd = () => number;

function rng(seed: number): Rnd {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * 바탕: 한 색 위에 잔 알갱이(화소마다)와 큰 얼룩(천천히 변하는 밝기)을 얹는다.
 * @param grain 잔 알갱이의 세기(밝기 0..255 기준)
 * @param cloud 큰 얼룩의 세기
 * @param cloudMm 얼룩 한 덩이의 크기(mm)
 */
function paintBase(ctx: Ctx, w: number, h: number, base: string, grain: number, cloud: number, cloudMm: number, rnd: Rnd, warm = 0): void {
  const [r0, g0, b0] = hexRgb(base);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  // 큰 얼룩: 성긴 격자에 값을 뿌리고 그 사이를 부드럽게 잇는다.
  const cell = Math.max(4, Math.round((cloudMm / SHEET_W_MM) * w));
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd() * 2 - 1;
  for (let y = 0; y < h; y++) {
    const gy = y / cell;
    const iy = Math.floor(gy);
    const fy = gy - iy;
    const sy = fy * fy * (3 - 2 * fy);
    for (let x = 0; x < w; x++) {
      const gx = x / cell;
      const ix = Math.floor(gx);
      const fx = gx - ix;
      const sx = fx * fx * (3 - 2 * fx);
      const a = grid[iy * gw + ix]!, b = grid[iy * gw + ix + 1]!;
      const c = grid[(iy + 1) * gw + ix]!, e = grid[(iy + 1) * gw + ix + 1]!;
      const cl = (a + (b - a) * sx) * (1 - sy) + (c + (e - c) * sx) * sy;
      const n = (rnd() - 0.5) * 2 * grain + cl * cloud;
      const o = (y * w + x) * 4;
      d[o] = Math.max(0, Math.min(255, r0 + n + warm * cl));
      d[o + 1] = Math.max(0, Math.min(255, g0 + n));
      d[o + 2] = Math.max(0, Math.min(255, b0 + n - warm * cl));
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** 종이 섬유: 짧고 살짝 휜 가는 선을 흩뿌린다. 길이와 굵기는 mm. */
function fibres(ctx: Ctx, count: number, color: string, alpha: number, lenMm: [number, number], widthMm: number, rnd: Rnd): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = rnd() * SHEET_W_MM;
    const y = rnd() * SHEET_H_MM;
    const len = lenMm[0] + rnd() * (lenMm[1] - lenMm[0]);
    const a = rnd() * Math.PI;
    const bend = (rnd() - 0.5) * len * 0.6;
    ctx.globalAlpha = alpha * (0.4 + rnd() * 0.6);
    ctx.lineWidth = widthMm * (0.6 + rnd() * 0.8);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 - Math.sin(a) * bend, y + Math.sin(a) * len * 0.5 + Math.cos(a) * bend, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const q = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + q, y);
  ctx.arcTo(x + w, y, x + w, y + h, q);
  ctx.arcTo(x + w, y + h, x, y + h, q);
  ctx.arcTo(x, y + h, x, y, q);
  ctx.arcTo(x, y, x + w, y, q);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// 신문지
// ---------------------------------------------------------------------------
const NEWS_INK = '#33363f';
const NEWS_PAPER = '#d9d2c0';
const NEWS_NAVY = '#27335a';
const NEWS_RED = '#b6453a';
const NEWS_BLUE = '#4d6f9f';
const NEWS_OCHRE = '#c79a3a';

/** 글처럼 보이는 줄들: 낱말 길이의 짧은 막대를 줄지어 놓는다. 문단 끝 줄은 짧게 끊는다. */
function textBlock(ctx: Ctx, x: number, y: number, w: number, h: number, rnd: Rnd, pitch = 2.15, thick = 0.92, alpha = 0.78): void {
  ctx.save();
  ctx.fillStyle = NEWS_INK;
  let paraLeft = 3 + Math.floor(rnd() * 5);
  let first = true;
  for (let ly = y; ly + thick <= y + h; ly += pitch) {
    const last = paraLeft === 0;
    const lineW = last ? w * (0.3 + rnd() * 0.5) : w;
    let lx = x + (first ? 2.2 : 0);
    while (lx < x + lineW - 0.8) {
      const word = Math.min(0.9 + rnd() * rnd() * 5.2, x + lineW - lx);
      ctx.globalAlpha = alpha * (0.72 + rnd() * 0.28);
      ctx.fillRect(lx, ly + (rnd() - 0.5) * 0.12, word, thick);
      lx += word + 0.55 + rnd() * 0.35;
    }
    first = false;
    if (last) {
      paraLeft = 3 + Math.floor(rnd() * 6);
      first = true;
      ly += pitch * 0.35;
    } else paraLeft--;
  }
  ctx.restore();
}

/** 굵은 제목 줄: 글자처럼 보이는 두툼한 네모들. */
function headline(ctx: Ctx, x: number, y: number, w: number, size: number, rnd: Rnd, color = NEWS_INK, fill = 0.94): number {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  let lx = x;
  const end = x + w * fill;
  while (lx < end - size * 0.6) {
    // 낱말 하나 = 글자 2~4개
    const letters = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < letters && lx < end - size * 0.6; i++) {
      const lw = size * (0.72 + rnd() * 0.22);
      rr(ctx, lx, y, lw, size, size * 0.16);
      ctx.fill();
      // 글자 속의 빈 곳(획 사이)을 바탕색으로 파낸다. 네모가 글자처럼 읽힌다.
      ctx.save();
      ctx.fillStyle = NEWS_PAPER;
      ctx.globalAlpha = 0.94;
      const kind = Math.floor(rnd() * 3);
      if (kind === 0) ctx.fillRect(lx + lw * 0.26, y + size * 0.24, lw * 0.42, size * 0.2);
      else if (kind === 1) { ctx.fillRect(lx + lw * 0.5, y + size * 0.16, lw * 0.14, size * 0.5); ctx.fillRect(lx + lw * 0.2, y + size * 0.62, lw * 0.6, size * 0.14); }
      else { ctx.beginPath(); ctx.arc(lx + lw * 0.42, y + size * 0.42, size * 0.17, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
      lx += lw + size * 0.14;
    }
    lx += size * 0.42;
  }
  ctx.restore();
  return y + size;
}

/**
 * 망점 사진: 정해진 그림(하늘, 해, 구름, 종이비행기 또는 언덕)을 굵은 점의 크기로 나타낸다.
 * shade(u, v) 는 0(밝음) ~ 1(어두움).
 */
function halftone(ctx: Ctx, x: number, y: number, w: number, h: number, shade: (u: number, v: number) => number, color = NEWS_INK, cell = 1.5): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.07;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 0.86;
  let row = 0;
  for (let py = y; py < y + h + cell; py += cell * 0.866, row++) {
    for (let px = x + (row % 2 ? cell / 2 : 0); px < x + w + cell; px += cell) {
      const s = Math.max(0, Math.min(1, shade((px - x) / w, (py - y) / h)));
      if (s < 0.04) continue;
      ctx.beginPath();
      ctx.arc(px, py, cell * 0.62 * Math.sqrt(s), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = NEWS_INK;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

/** 사진 속 그림 1: 하늘을 나는 종이비행기와 해 */
function picPlane(u: number, v: number): number {
  let s = 0.16 + v * 0.3;
  const sun = Math.hypot(u - 0.8, (v - 0.24) * 0.8);
  if (sun < 0.12) s = 0.02;
  // 구름 두 덩이
  for (const [cx, cy, r] of [[0.22, 0.26, 0.13], [0.34, 0.3, 0.1], [0.62, 0.7, 0.12], [0.74, 0.74, 0.09]] as const) {
    if (Math.hypot(u - cx, (v - cy) * 1.5) < r) s = 0.03;
  }
  // 종이비행기(세모 두 개). 기수는 오른쪽 위.
  const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean => {
    const d1 = (u - bx) * (ay - by) - (ax - bx) * (v - by);
    const d2 = (u - cx) * (by - cy) - (bx - cx) * (v - cy);
    const d3 = (u - ax) * (cy - ay) - (cx - ax) * (v - ay);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  if (tri(0.66, 0.34, 0.26, 0.5, 0.44, 0.6)) s = 0.92;
  else if (tri(0.66, 0.34, 0.44, 0.6, 0.5, 0.78)) s = 0.6;
  else if (tri(0.66, 0.34, 0.5, 0.78, 0.58, 0.62)) s = 0.98;
  return s;
}

/** 사진 속 그림 2: 언덕과 나무, 해 */
function picHills(u: number, v: number): number {
  let s = 0.1 + v * 0.16;
  if (Math.hypot(u - 0.22, (v - 0.26) * 0.9) < 0.11) s = 0.02;
  const hill1 = 0.62 + 0.12 * Math.sin(u * 5.2 + 0.6);
  const hill2 = 0.74 + 0.1 * Math.sin(u * 7.4 + 2.4);
  if (v > hill1) s = 0.46;
  if (v > hill2) s = 0.72;
  // 동그란 나무 세 그루
  for (const [cx, cy, r] of [[0.7, 0.5, 0.1], [0.84, 0.56, 0.075], [0.56, 0.58, 0.06]] as const) {
    if (Math.hypot(u - cx, (v - cy) * 1.25) < r) s = 0.88;
    if (Math.abs(u - cx) < 0.012 && v > cy && v < cy + 0.2) s = 0.95;
  }
  return s;
}

/** 낱말 맞추기 칸 */
function crossword(ctx: Ctx, x: number, y: number, size: number, n: number, rnd: Rnd): void {
  const c = size / n;
  ctx.save();
  ctx.fillStyle = '#e9e3d2';
  ctx.globalAlpha = 0.7;
  ctx.fillRect(x, y, size, size);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = NEWS_INK;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    // 가운데를 기준으로 맞보는 칸을 같이 칠해 진짜 낱말 맞추기처럼 보이게 한다.
    if (i * n + j > (n * n) / 2) continue;
    if (rnd() < 0.24) {
      ctx.fillRect(x + j * c, y + i * c, c, c);
      ctx.fillRect(x + (n - 1 - j) * c, y + (n - 1 - i) * c, c, c);
    } else if (rnd() < 0.3) {
      // 칸 번호(아주 작은 점)
      ctx.fillRect(x + j * c + c * 0.12, y + i * c + c * 0.12, c * 0.2, c * 0.24);
    }
  }
  ctx.strokeStyle = NEWS_INK;
  ctx.lineWidth = 0.28;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    ctx.moveTo(x + i * c, y);
    ctx.lineTo(x + i * c, y + size);
    ctx.moveTo(x, y + i * c);
    ctx.lineTo(x + size, y + i * c);
  }
  ctx.stroke();
  ctx.lineWidth = 0.7;
  ctx.strokeRect(x, y, size, size);
  ctx.restore();
}

/** 네 칸 만화: 동그란 얼굴의 아이와 말풍선, 날아가는 종이비행기 */
function comic(ctx: Ctx, x: number, y: number, w: number, h: number, panels: number, rnd: Rnd): void {
  const gap = 1.6;
  const pw = (w - gap * (panels - 1)) / panels;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (let i = 0; i < panels; i++) {
    const px = x + i * (pw + gap);
    ctx.fillStyle = i % 2 ? '#e4dcc6' : '#ece6d6';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(px, y, pw, h);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = NEWS_INK;
    ctx.lineWidth = 0.7;
    ctx.strokeRect(px, y, pw, h);
    // 바닥 선
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    ctx.moveTo(px, y + h * 0.84);
    ctx.lineTo(px + pw, y + h * 0.84);
    ctx.stroke();
    // 아이: 머리, 몸, 팔다리
    const cx = px + pw * (0.26 + 0.1 * (i % 2));
    const cy = y + h * 0.5;
    const hr = Math.min(pw, h) * 0.13;
    ctx.fillStyle = '#f3ecdc';
    ctx.beginPath();
    ctx.arc(cx, cy, hr, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 0.55;
    ctx.stroke();
    ctx.fillStyle = NEWS_INK;
    ctx.beginPath();
    ctx.arc(cx - hr * 0.35, cy - hr * 0.1, hr * 0.12, 0, Math.PI * 2);
    ctx.arc(cx + hr * 0.35, cy - hr * 0.1, hr * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy + hr * 0.25, hr * 0.4, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    // 모자
    ctx.fillStyle = NEWS_OCHRE;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy - hr * 0.25, hr * 1.02, Math.PI, 0);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(cx, cy + hr);
    ctx.lineTo(cx, y + h * 0.7);
    ctx.lineTo(cx - hr * 0.7, y + h * 0.84);
    ctx.moveTo(cx, y + h * 0.7);
    ctx.lineTo(cx + hr * 0.7, y + h * 0.84);
    // 팔: 칸마다 조금씩 더 들어 올린다(던지는 동작)
    const lift = (i / Math.max(1, panels - 1)) * 0.9;
    ctx.moveTo(cx, cy + hr * 1.5);
    ctx.lineTo(cx + hr * 1.5, cy + hr * (1.2 - lift * 2));
    ctx.stroke();
    // 종이비행기: 칸이 지날수록 멀리 날아간다
    const fx = cx + hr * 1.8 + (pw * 0.42 * i) / Math.max(1, panels - 1);
    const fy = cy - hr * 0.2 - (h * 0.2 * i) / Math.max(1, panels - 1);
    ctx.fillStyle = NEWS_RED;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(fx + hr * 1.3, fy - hr * 0.3);
    ctx.lineTo(fx - hr * 0.8, fy - hr * 0.1);
    ctx.lineTo(fx - hr * 0.3, fy + hr * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 0.4;
    ctx.stroke();
    // 말풍선(글 대신 짧은 줄)
    if (i !== 1) {
      const bx = px + pw * 0.5;
      const by = y + h * 0.08;
      const bw = pw * 0.44;
      const bh = h * 0.22;
      ctx.fillStyle = '#f6f1e4';
      rr(ctx, bx, by, bw, bh, 1.6);
      ctx.fill();
      ctx.lineWidth = 0.45;
      ctx.stroke();
      ctx.fillStyle = NEWS_INK;
      ctx.globalAlpha = 0.75;
      for (let l = 0; l < 2; l++) ctx.fillRect(bx + 1.4, by + bh * (0.26 + l * 0.34), bw * (0.5 + rnd() * 0.32), 0.8);
      ctx.globalAlpha = 0.9;
    }
  }
  ctx.restore();
}

/** 광고처럼 보이는 칸: 굵은 테두리, 톱니 별, 굵은 막대 글자 */
function adBox(ctx: Ctx, x: number, y: number, w: number, h: number, rnd: Rnd): void {
  ctx.save();
  ctx.fillStyle = '#e6dfcb';
  ctx.globalAlpha = 0.8;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = NEWS_INK;
  ctx.lineWidth = 1.1;
  ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = 0.3;
  ctx.strokeRect(x + 1.4, y + 1.4, w - 2.8, h - 2.8);
  // 톱니 별
  const cx = x + w * 0.24;
  const cy = y + h * 0.5;
  const r1 = Math.min(w, h) * 0.3;
  ctx.fillStyle = NEWS_RED;
  ctx.globalAlpha = 0.82;
  ctx.beginPath();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = i % 2 ? r1 * 0.74 : r1;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f3ecdc';
  ctx.globalAlpha = 0.95;
  ctx.fillRect(cx - r1 * 0.42, cy - r1 * 0.2, r1 * 0.84, r1 * 0.16);
  ctx.fillRect(cx - r1 * 0.3, cy + r1 * 0.08, r1 * 0.6, r1 * 0.14);
  ctx.restore();
  headline(ctx, x + w * 0.46, y + h * 0.2, w * 0.5, h * 0.2, rnd, NEWS_NAVY);
  textBlock(ctx, x + w * 0.46, y + h * 0.52, w * 0.48, h * 0.36, rnd, 2.3, 1, 0.7);
}

function columnRule(ctx: Ctx, x: number, y0: number, y1: number): void {
  ctx.save();
  ctx.strokeStyle = NEWS_INK;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 0.22;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
  ctx.restore();
}

function hRule(ctx: Ctx, x0: number, x1: number, y: number, w = 0.5, alpha = 0.85): void {
  ctx.save();
  ctx.strokeStyle = NEWS_INK;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.restore();
}

/** 작은 종이비행기 그림(제호 옆 장식, 무늬) */
function tinyPlane(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(cx + s, cy - s * 0.45);
  ctx.lineTo(cx - s, cy - s * 0.1);
  ctx.lineTo(cx - s * 0.25, cy + s * 0.2);
  ctx.lineTo(cx - s * 0.1, cy + s * 0.75);
  ctx.lineTo(cx + s * 0.2, cy + s * 0.3);
  ctx.closePath();
}

/** 구겨진 자국: 아주 옅은 밝고 어두운 줄 쌍. 신문지가 흐물흐물해 보인다. */
function wrinkles(ctx: Ctx, count: number, rnd: Rnd): void {
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = rnd() * SHEET_W_MM;
    const y = rnd() * SHEET_H_MM;
    const a = rnd() * Math.PI;
    const len = 30 + rnd() * 90;
    const bend = (rnd() - 0.5) * 26;
    const dx = Math.cos(a), dy = Math.sin(a);
    for (const [off, col, al] of [[0, '#000000', 0.07], [0.7, '#ffffff', 0.16]] as const) {
      ctx.strokeStyle = col;
      ctx.globalAlpha = al * (0.5 + rnd() * 0.5);
      ctx.lineWidth = 0.6 + rnd() * 0.5;
      ctx.beginPath();
      ctx.moveTo(x - dy * off, y + dx * off);
      ctx.quadraticCurveTo(x + dx * len * 0.5 - dy * (bend + off), y + dy * len * 0.5 + dx * (bend + off), x + dx * len - dy * off, y + dy * len + dx * off);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawNewsFront(ctx: Ctx, rnd: Rnd): void {
  const L = 8, R = SHEET_W_MM - 8;
  const W = R - L;
  // ---- 제호 ----
  hRule(ctx, L, R, 9.5, 0.9);
  ctx.save();
  ctx.fillStyle = NEWS_NAVY;
  ctx.globalAlpha = 0.92;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `21px ${MASTHEAD_FONT}`;
  ctx.fillText(MASTHEAD_TEXT, SHEET_W_MM / 2, 30.5);
  // 제호 왼쪽: 날짜처럼 보이는 작은 칸
  ctx.strokeStyle = NEWS_INK;
  ctx.lineWidth = 0.4;
  ctx.strokeRect(L, 13.5, 30, 17);
  ctx.restore();
  textBlock(ctx, L + 2.2, 16, 25.6, 12.5, rnd, 2.5, 1.05, 0.7);
  // 제호 오른쪽: 날씨 칸(해와 구름)
  ctx.save();
  ctx.strokeStyle = NEWS_INK;
  ctx.lineWidth = 0.4;
  ctx.strokeRect(R - 30, 13.5, 30, 17);
  ctx.fillStyle = NEWS_OCHRE;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(R - 21, 22, 4.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = NEWS_OCHRE;
  ctx.lineWidth = 0.9;
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(R - 21 + Math.cos(a) * 5.9, 22 + Math.sin(a) * 5.9);
    ctx.lineTo(R - 21 + Math.cos(a) * 7.3, 22 + Math.sin(a) * 7.3);
    ctx.stroke();
  }
  ctx.fillStyle = NEWS_INK;
  ctx.globalAlpha = 0.7;
  for (let l = 0; l < 3; l++) ctx.fillRect(R - 12, 17.5 + l * 3.4, 6 + rnd() * 4, 1.1);
  ctx.restore();
  // 제호 아래 띠: 붉은 줄 + 발행 정보처럼 보이는 잔 줄
  ctx.save();
  ctx.fillStyle = NEWS_RED;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(L, 34.5, W, 2.6);
  ctx.restore();
  textBlock(ctx, L, 39.2, W, 1.2, rnd, 3, 0.95, 0.6);
  hRule(ctx, L, R, 42.6, 0.35);

  // ---- 머리기사 ----
  let y = headline(ctx, L, 46.5, W, 11.5, rnd, NEWS_INK, 0.98);
  y = headline(ctx, L, y + 3.2, W, 6.2, rnd, NEWS_INK, 0.72);
  y += 4.2;
  hRule(ctx, L, R, y, 0.3, 0.6);
  y += 3;

  // ---- 큰 사진(왼쪽 두 단 반) + 오른쪽 기사 단 ----
  const colGap = 4.2;
  const colW = (W - colGap * 3) / 4;
  const photoW = colW * 2.5 + colGap * 2;
  const photoH = 70;
  halftone(ctx, L, y, photoW, photoH, picPlane);
  textBlock(ctx, L, y + photoH + 1.8, photoW, 4.6, rnd, 2.2, 0.95, 0.66);
  const rightX = L + photoW + colGap;
  const rightW = R - rightX;
  let ry = headline(ctx, rightX, y, rightW, 4.6, rnd, NEWS_NAVY, 0.95);
  ry = headline(ctx, rightX, ry + 1.6, rightW, 4.6, rnd, NEWS_NAVY, 0.6);
  textBlock(ctx, rightX, ry + 3, rightW, y + photoH + 6.4 - (ry + 3), rnd);
  columnRule(ctx, rightX - colGap / 2, y, y + photoH + 6.4);
  y += photoH + 10.5;
  hRule(ctx, L, R, y, 0.3, 0.6);
  y += 3.4;

  // ---- 네 단 본문 ----
  const bodyBottom = 222;
  for (let c = 0; c < 4; c++) {
    const cx = L + c * (colW + colGap);
    let cy = y;
    if (c === 0 || c === 2) {
      cy = headline(ctx, cx, cy, colW, 3.9, rnd, NEWS_INK, 0.96) + 2.4;
    }
    if (c === 3) {
      // 작은 파란 상자 기사
      ctx.save();
      ctx.fillStyle = NEWS_BLUE;
      ctx.globalAlpha = 0.2;
      ctx.fillRect(cx, cy, colW, 26);
      ctx.restore();
      headline(ctx, cx + 2, cy + 2.4, colW - 4, 3.6, rnd, NEWS_NAVY, 0.9);
      textBlock(ctx, cx + 2, cy + 8.6, colW - 4, 15.4, rnd, 2.2, 0.95, 0.72);
      cy += 29.5;
    }
    textBlock(ctx, cx, cy, colW, bodyBottom - cy, rnd);
    if (c > 0) columnRule(ctx, cx - colGap / 2, y, bodyBottom);
  }
  y = bodyBottom + 3;
  hRule(ctx, L, R, y, 0.9);
  y += 4;

  // ---- 아래쪽: 낱말 맞추기 + 작은 사진 + 기사 ----
  const boxSize = 289 - y - 6.5;
  headline(ctx, L, y, boxSize, 4.2, rnd, NEWS_RED, 0.8);
  crossword(ctx, L, y + 6.5, boxSize, 9, rnd);
  const midX = L + boxSize + colGap;
  const midW = 62;
  halftone(ctx, midX, y, midW, 40, picHills, NEWS_INK, 1.35);
  textBlock(ctx, midX, y + 42, midW, 289 - (y + 42), rnd);
  const lastX = midX + midW + colGap;
  const ly = headline(ctx, lastX, y, R - lastX, 4.4, rnd, NEWS_INK, 0.92);
  textBlock(ctx, lastX, ly + 2.6, R - lastX, 289 - (ly + 2.6), rnd);
  columnRule(ctx, midX - colGap / 2, y, 289);
  columnRule(ctx, lastX - colGap / 2, y, 289);
}

function drawNewsBack(ctx: Ctx, rnd: Rnd): void {
  const L = 8, R = SHEET_W_MM - 8;
  const W = R - L;
  // ---- 면 머리: 쪽 번호 칸과 가는 줄 ----
  ctx.save();
  ctx.fillStyle = NEWS_NAVY;
  ctx.globalAlpha = 0.88;
  ctx.fillRect(L, 8, 12, 7.5);
  ctx.fillStyle = '#e9e3d2';
  ctx.fillRect(L + 3.2, 10, 2.2, 3.6);
  ctx.fillRect(L + 6.6, 10, 2.2, 3.6);
  ctx.restore();
  headline(ctx, L + 16, 9.2, 60, 5, rnd, NEWS_NAVY, 0.9);
  textBlock(ctx, R - 44, 10.4, 44, 1.2, rnd, 3, 1, 0.6);
  hRule(ctx, L, R, 18, 0.8);
  hRule(ctx, L, R, 19.4, 0.25, 0.7);

  // ---- 만화 ----
  let y = 23;
  headline(ctx, L, y, 70, 5.6, rnd, NEWS_RED, 0.86);
  y += 8.6;
  comic(ctx, L, y, W, 46, 4, rnd);
  y += 50;
  hRule(ctx, L, R, y, 0.3, 0.6);
  y += 3.6;

  // ---- 가운데: 기사 두 단 + 큰 사진 ----
  const colGap = 4.2;
  const colW = (W - colGap * 3) / 4;
  const midBottom = 196;
  y = headline(ctx, L, y, colW * 2 + colGap, 7.4, rnd, NEWS_INK, 0.98) + 3.4;
  const photoX = L + (colW + colGap) * 2;
  halftone(ctx, photoX, y - 10.8, R - photoX, 64, picHills, NEWS_INK, 1.6);
  textBlock(ctx, photoX, y + 55.2, R - photoX, 4.6, rnd, 2.2, 0.95, 0.66);
  for (let c = 0; c < 2; c++) {
    const cx = L + c * (colW + colGap);
    textBlock(ctx, cx, y, colW, midBottom - y, rnd);
    if (c > 0) columnRule(ctx, cx - colGap / 2, y, midBottom);
  }
  // 사진 아래 두 단
  for (let c = 2; c < 4; c++) {
    const cx = L + c * (colW + colGap);
    const cy = y + 62.4;
    const hy = c === 2 ? headline(ctx, cx, cy, colW, 3.8, rnd, NEWS_NAVY, 0.94) + 2.2 : cy;
    textBlock(ctx, cx, hy, colW, midBottom - hy, rnd);
    columnRule(ctx, cx - colGap / 2, c === 2 ? y : cy, midBottom);
  }
  y = midBottom + 3;
  hRule(ctx, L, R, y, 0.9);
  y += 4;

  // ---- 아래: 광고 칸 + 낱말 맞추기 + 기사 ----
  const bottom = 289;
  const adW = 96;
  adBox(ctx, L, y, adW, 40, rnd);
  textBlock(ctx, L, y + 43.5, adW, bottom - (y + 43.5), rnd);
  const cwSize = bottom - y - 7;
  const cwX = L + adW + colGap + 2;
  headline(ctx, cwX, y, cwSize, 4.2, rnd, NEWS_RED, 0.7);
  crossword(ctx, cwX, y + 7, Math.min(cwSize, 56), 8, rnd);
  const lastX = cwX + Math.min(cwSize, 56) + colGap;
  if (R - lastX > 14) {
    const hy = headline(ctx, lastX, y, R - lastX, 4, rnd, NEWS_INK, 0.94);
    textBlock(ctx, lastX, hy + 2.4, R - lastX, bottom - (hy + 2.4), rnd);
    columnRule(ctx, lastX - colGap / 2, y, bottom);
  }
}

// ---------------------------------------------------------------------------
// 종이별 그리기
// ---------------------------------------------------------------------------

/**
 * 종이 한 면을 캔버스에 그린다. 캔버스는 210:297 비율이어야 한다.
 * 같은 종이, 같은 면, 같은 크기면 언제나 같은 그림이 나온다(정해진 순서의 난수만 쓴다).
 */
export function drawPaperFace(canvas: HTMLCanvasElement, paperId: string, face: PaperFace): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const k = w / SHEET_W_MM;
  const id = PAPER_LOOK_SPECS[paperId] ? paperId : FALLBACK_PAPER_LOOK_ID;
  const seedBase = { newsprint: 11, copy60: 23, copy80: 37, copy100: 53, craft120: 71, kent160: 89 }[id] ?? 37;
  const rnd = rng(seedBase * 1000 + (face === 'back' ? 517 : 3));
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  switch (id) {
    case 'newsprint': {
      // 누르스름한 회색 재생지. 얼룩이 크고 알갱이가 거칠다.
      paintBase(ctx, w, h, face === 'front' ? '#d9d2c0' : '#d7d0be', 7, 5, 26, rnd, 2);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      fibres(ctx, 520, '#8a8068', 0.3, [0.8, 3.2], 0.16, rnd);
      fibres(ctx, 260, '#f4efe2', 0.34, [0.6, 2.4], 0.18, rnd);
      // 뒷면 글씨가 살짝 비친다(얇은 종이): 반대쪽 면을 따로 그려 두었다가 좌우를 뒤집어 아주 옅게 얹는다.
      {
        const ghost = document.createElement('canvas');
        ghost.width = Math.max(64, Math.round(w / 2));
        ghost.height = Math.max(90, Math.round(h / 2));
        const gctx = ghost.getContext('2d');
        if (gctx) {
          const gk = ghost.width / SHEET_W_MM;
          gctx.setTransform(gk, 0, 0, gk, 0, 0);
          const grnd = rng(seedBase * 1000 + (face === 'back' ? 3 : 517));
          if (face === 'front') drawNewsBack(gctx, grnd);
          else drawNewsFront(gctx, grnd);
          ctx.save();
          ctx.globalAlpha = 0.075;
          ctx.translate(SHEET_W_MM, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(ghost, 0, 0, SHEET_W_MM, SHEET_H_MM);
          ctx.restore();
        }
      }
      if (face === 'front') drawNewsFront(ctx, rnd);
      else drawNewsBack(ctx, rnd);
      wrinkles(ctx, 9, rnd);
      break;
    }
    case 'copy60': {
      // 얇고 푸르스름하게 밝은 흰 종이. 빛에 비춰 본 것처럼 구름 같은 얼룩이 보인다.
      paintBase(ctx, w, h, '#f7fafe', 1.6, 3.4, 9, rnd, -1.2);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      fibres(ctx, 240, '#c9d6e6', 0.3, [1.5, 5], 0.14, rnd);
      fibres(ctx, 160, '#ffffff', 0.5, [1.5, 5], 0.2, rnd);
      break;
    }
    case 'copy80': {
      // 사무실 복사지: 따뜻한 쪽으로 아주 살짝 기운 흰색, 잔 섬유.
      paintBase(ctx, w, h, '#f9f7f0', 2.6, 1.6, 18, rnd, 0.8);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      fibres(ctx, 420, '#d9d2c0', 0.34, [0.6, 2.6], 0.13, rnd);
      fibres(ctx, 200, '#ffffff', 0.5, [0.6, 2.2], 0.16, rnd);
      break;
    }
    case 'copy100': {
      // 매끈하고 새하얀 고급지: 비스듬한 윤기 띠와 아주 옅은 종이비행기 무늬(비침 무늬).
      paintBase(ctx, w, h, '#fcfcff', 0.9, 0.8, 30, rnd, 0);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      const sheenGrad = ctx.createLinearGradient(0, 0, SHEET_W_MM, SHEET_H_MM);
      sheenGrad.addColorStop(0, 'rgba(214, 222, 240, 0.34)');
      sheenGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0)');
      sheenGrad.addColorStop(0.46, 'rgba(255, 255, 255, 0.9)');
      sheenGrad.addColorStop(0.6, 'rgba(255, 255, 255, 0)');
      sheenGrad.addColorStop(1, 'rgba(206, 216, 238, 0.4)');
      ctx.fillStyle = sheenGrad;
      ctx.fillRect(0, 0, SHEET_W_MM, SHEET_H_MM);
      // 비침 무늬: 작은 종이비행기를 벽돌 쌓듯 엇갈려 놓는다.
      ctx.save();
      ctx.fillStyle = '#7f93c4';
      ctx.strokeStyle = '#7f93c4';
      ctx.lineWidth = 0.5;
      ctx.lineJoin = 'round';
      let row = 0;
      for (let y = 15; y < SHEET_H_MM; y += 27, row++) {
        for (let x = (row % 2 ? 26 : 8); x < SHEET_W_MM; x += 36) {
          ctx.globalAlpha = 0.085;
          tinyPlane(ctx, x, y, 5.4);
          ctx.fill();
          ctx.globalAlpha = 0.14;
          tinyPlane(ctx, x, y, 5.4);
          ctx.stroke();
        }
      }
      ctx.restore();
      break;
    }
    case 'craft120': {
      // 파란 색지: 속까지 물든 종이라 앞뒤가 같은 색이다. 밝고 어두운 섬유 조각이 도톰하게 박혀 있다.
      paintBase(ctx, w, h, face === 'front' ? '#3f7fdd' : '#427fda', 9, 5, 7, rnd, -3);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      fibres(ctx, 900, '#2a5cb2', 0.5, [0.8, 3.6], 0.2, rnd);
      fibres(ctx, 760, '#9cc0f4', 0.55, [0.8, 3.4], 0.2, rnd);
      fibres(ctx, 130, '#eef4ff', 0.75, [0.5, 1.8], 0.26, rnd);
      fibres(ctx, 90, '#1e4a94', 0.6, [1.5, 5], 0.24, rnd);
      break;
    }
    case 'kent160':
    default: {
      // 켄트지: 따뜻한 흰색 도화지. 고운 결(가로로 살짝 누운 잔 무늬)이 있다.
      paintBase(ctx, w, h, '#f6efdf', 4.6, 2.4, 5, rnd, 1.6);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 0; i < 2600; i++) {
        const x = rnd() * SHEET_W_MM;
        const y = rnd() * SHEET_H_MM;
        const len = 0.7 + rnd() * 1.6;
        ctx.strokeStyle = rnd() < 0.5 ? '#cdbf9e' : '#fffaf0';
        ctx.globalAlpha = 0.22 + rnd() * 0.2;
        ctx.lineWidth = 0.16;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + len, y + (rnd() - 0.5) * 0.3);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
