/**
 * 체육관 장면 만들기 (React 와 무관한 순수 three.js 코드).
 *
 * 그림체: 장난감 디오라마. 모서리는 전부 둥글리고, 무늬는 캔버스에 직접 그려 텍스처로 쓴다(그림 파일 없음).
 *  - 마루: 널마다 색이 조금씩 다른 나뭇결 + 닳은 코트 라인 + 창과 조명이 비치는 윤기(계산으로 그린 반사)
 *  - 벽: 누빈 초록 안전 매트, 나무 띠, 기둥, 아치 창(스스로 빛난다), 창에서 내려오는 빛줄기와 바닥의 햇빛 무늬
 *  - 천장: 트러스와 매달린 조명
 *  - 소품: 관람석, 뜀틀, 공 수레, 말아 세운 매트, 긴 의자, 심판 책상, 구급함, 스피커, 시계, 농구 골대
 *  - 현수막(처진 천), 흔들리는 만국기, 점으로 빛나는 전광판, 찢은 파란 테이프 출발선, 숫자 카드, 둥근 콘
 *
 * 좌표(three): +X 던지는 방향, +Y 위, +Z 오른쪽. 출발선은 X = 0. 해는 왼쪽(-Z) 창으로 들어온다.
 * 가벼움: 움직이지 않는 것은 몇 덩어리로 합쳐 그리기 호출을 줄인다.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { tok } from '../lib/palette';
import type { Tier } from './quality';
import { canvasOf, Merger, mix, radialTexture, roundRect, seeded, smoothLathe, texOf, toonMat, Trash } from './toon';

/** 체육관 크기(m) */
export const GYM = {
  backX: -8,
  frontX: 132,
  halfZ: 13,
  height: 10.5,
  matH: 2.2,
  /** 숫자 카드가 붙은 마지막 거리 */
  maxMark: 120,
  /** 관람석 앞 끝(z). 카메라가 넘지 않게 할 때 쓴다. */
  bleacherZ: -10.6,
  bleacherX0: -6.5,
  bleacherX1: 46,
} as const;

/** 해가 있는 쪽(빛이 오는 방향의 반대가 아니라, 물체에서 해를 보는 방향). */
export const SUN_DIR = new THREE.Vector3(0.5, 0.62, -0.55).normalize();

/** 아이가 올라서는 발판 높이(m)와 자리. 비행기를 든 오른손이 던지는 선(z = 0) 위에 오도록 왼쪽으로 비켜 선다. */
export const STEP_H = 0.14;
export const KID_SPOT = { x: -0.4, z: -0.56 } as const;

/** 관람석 한 단: 앉는 면의 높이와 가운데 z */
export const BLEACHER_ROWS = [
  { y: 1.35, z: -12.6 },
  { y: 0.9, z: -11.8 },
  { y: 0.45, z: -11.0 },
] as const;

export const BANNER_TEXT = '종이비행기 날리기 대회';
const DISPLAY_FONT = "'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', system-ui, sans-serif";

const WIN = { first: -3, pitch: 8.5, hw: 1.5, y0: 4.6, straight: 3.0 } as const;
const TRUSS = { first: 1.25, pitch: 8.5, lampZ: 6 } as const;

export interface Gym {
  group: THREE.Group;
  /** 전광판 글자를 바꾼다. */
  setBoard: (label: string, value: string) => void;
  /** 글꼴이 준비된 뒤 글자가 들어간 텍스처를 다시 그린다. */
  redrawText: () => void;
  /** 흔들리는 것(만국기)의 시간을 맞춘다. */
  update: (timeS: number) => void;
  setTier: (t: Tier) => void;
  dispose: () => void;
}

const rbox = (w: number, h: number, d: number, r: number, seg = 2): THREE.BufferGeometry =>
  new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) * 0.49));

// ---------------------------------------------------------------------------
// 캔버스 그림들
// ---------------------------------------------------------------------------
/** 마루: 널이 길이 방향(u)으로 놓인다. 가로세로 모두 이어 붙여도 티가 나지 않는다. */
function drawFloor(ctx: CanvasRenderingContext2D, size: number): void {
  const rnd = seeded(7);
  const base = tok('--court');
  const light = mix(base, tok('--paper'), 0.38);
  const dark = mix(base, tok('--court-dark'), 0.7);
  const red = mix(base, tok('--orange'), 0.3);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const rows = 24;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * rh;
    let x = -rnd() * size * 0.3;
    const start = x;
    while (x < start + size) {
      const w = Math.min(size * (0.2 + rnd() * 0.26), start + size - x);
      const t = rnd();
      const tone = t < 0.3 ? mix(base, light, 0.12 + rnd() * 0.3) : t < 0.5 ? mix(base, dark, 0.08 + rnd() * 0.16) : t < 0.64 ? mix(base, red, 0.15 + rnd() * 0.22) : mix(base, light, rnd() * 0.1);
      for (const ox of [0, size]) {
        ctx.fillStyle = tone;
        ctx.fillRect(x + ox, y, w, rh);
        // 나뭇결: 길고 가는 물결선
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + ox, y, w, rh);
        ctx.clip();
        const g = seeded(Math.floor(1 + (r * 131 + (x - start)) * 7.1));
        const lines = 3 + Math.floor(g() * 3);
        for (let i = 0; i < lines; i++) {
          const ly = y + rh * (0.15 + 0.7 * g());
          const amp = 1 + g() * 2.5, ph = g() * 6, wl = 60 + g() * 120;
          ctx.strokeStyle = g() > 0.4 ? 'rgba(120,70,25,0.10)' : 'rgba(255,240,210,0.13)';
          ctx.lineWidth = 1 + g() * 1.2;
          ctx.beginPath();
          for (let px = 0; px <= w; px += 8) {
            const yy = ly + Math.sin(px / wl + ph) * amp;
            if (px === 0) ctx.moveTo(x + ox + px, yy);
            else ctx.lineTo(x + ox + px, yy);
          }
          ctx.stroke();
        }
        if (g() < 0.12) {
          // 옹이
          const kx = x + ox + w * (0.2 + 0.6 * g()), ky = y + rh * (0.3 + 0.4 * g());
          ctx.fillStyle = 'rgba(120,70,25,0.16)';
          ctx.beginPath();
          ctx.ellipse(kx, ky, 7, 3.2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        // 널 끝 이음
        ctx.fillStyle = 'rgba(110,62,20,0.32)';
        ctx.fillRect(x + ox + w - 1.5, y, 2, rh);
        ctx.fillStyle = 'rgba(255,244,214,0.16)';
        ctx.fillRect(x + ox + w + 0.5, y, 1.5, rh);
      }
      x += w;
    }
    // 널 사이 틈과 모서리 빛
    ctx.fillStyle = 'rgba(110,62,20,0.36)';
    ctx.fillRect(0, y - 1, size, 2);
    ctx.fillStyle = 'rgba(255,244,214,0.2)';
    ctx.fillRect(0, y + 1, size, 1.5);
  }
}

/** 누빈 안전 매트 두 장(조금 다른 초록). */
function drawMats(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const mat = tok('--mat'), matDark = tok('--mat-dark');
  const tones = [mix(mat, tok('--green'), 0.12), mix(mat, matDark, 0.45)];
  ctx.fillStyle = mix(matDark, tok('--ink'), 0.35);
  ctx.fillRect(0, 0, w, h);
  const pw = w / 2;
  for (let i = 0; i < 2; i++) {
    const x0 = i * pw + 3, y0 = 4, ww = pw - 6, hh = h - 7;
    const base = tones[i]!;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + hh);
    g.addColorStop(0, mix(base, '#ffffff', 0.3));
    g.addColorStop(0.1, mix(base, '#ffffff', 0.1));
    g.addColorStop(0.5, base);
    g.addColorStop(0.9, mix(base, matDark, 0.5));
    g.addColorStop(1, mix(base, tok('--ink'), 0.4));
    ctx.fillStyle = g;
    roundRect(ctx, x0, y0, ww, hh, 16);
    ctx.fill();
    // 옆으로 둥글게 부푼 느낌
    const side = ctx.createLinearGradient(x0, 0, x0 + ww, 0);
    side.addColorStop(0, 'rgba(10,50,40,0.34)');
    side.addColorStop(0.1, 'rgba(10,50,40,0)');
    side.addColorStop(0.86, 'rgba(255,255,255,0)');
    side.addColorStop(0.94, 'rgba(255,255,255,0.12)');
    side.addColorStop(1, 'rgba(10,50,40,0.3)');
    ctx.fillStyle = side;
    roundRect(ctx, x0, y0, ww, hh, 16);
    ctx.fill();
    // 누빈 가로줄(살짝 들어간 골)
    for (const fy of [0.34, 0.67]) {
      const yy = y0 + hh * fy;
      ctx.fillStyle = 'rgba(10,50,40,0.28)';
      ctx.fillRect(x0 + 4, yy, ww - 8, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(x0 + 4, yy + 3, ww - 8, 2);
    }
    // 바느질 선
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    roundRect(ctx, x0 + 11, y0 + 11, ww - 22, hh - 22, 9);
    ctx.stroke();
    ctx.setLineDash([]);
    // 윗모서리 빛
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    roundRect(ctx, x0 + 14, y0 + 5, ww - 28, 5, 2.5);
    ctx.fill();
  }
}

/** 닳은 코트 라인(u 방향으로 되풀이). */
function drawLine(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const rnd = seeded(91);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = tok('--court-line');
  for (let x = 0; x < w; x += 2) {
    const top = 3 + rnd() * 2.2, bot = 3 + rnd() * 2.2;
    ctx.globalAlpha = 0.86 + rnd() * 0.12;
    ctx.fillRect(x, top, 2, h - top - bot);
  }
  // 닳아서 마루가 비치는 자리
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 46; i++) {
    ctx.globalAlpha = 0.25 + rnd() * 0.5;
    ctx.beginPath();
    ctx.ellipse(rnd() * w, rnd() * h, 2 + rnd() * 9, 0.6 + rnd() * 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

/** 손으로 찢은 파란 마스킹 테이프(출발선). 긴 쪽이 u. */
function drawTape(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const rnd = seeded(5);
  ctx.clearRect(0, 0, w, h);
  const blue = tok('--tape');
  ctx.fillStyle = blue;
  ctx.beginPath();
  ctx.moveTo(10, 4);
  ctx.lineTo(w - 10, 4);
  // 오른쪽 찢긴 끝
  for (let y = 4; y <= h - 4; y += 4) ctx.lineTo(w - 4 - rnd() * 9, y);
  ctx.lineTo(10, h - 4);
  for (let y = h - 4; y >= 4; y -= 4) ctx.lineTo(4 + rnd() * 9, y);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.clip();
  // 종이 테이프의 잔주름과 결
  for (let i = 0; i < 70; i++) {
    const x = rnd() * w;
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(20,40,120,0.10)';
    ctx.fillRect(x, 0, 1 + rnd() * 2, h);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(0, 5, w, 3);
  ctx.fillStyle = 'rgba(15,30,90,0.2)';
  ctx.fillRect(0, h - 8, w, 3);
  ctx.restore();
}

/** 손글씨 현수막(천). */
function drawBanner(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  const inkC = tok('--ink');
  ctx.fillStyle = tok('--paper');
  ctx.strokeStyle = inkC;
  ctx.lineWidth = 8;
  roundRect(ctx, 6, 6, w - 12, h - 12, 18);
  ctx.fill();
  ctx.stroke();
  // 박음질
  ctx.setLineDash([12, 9]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = mix(tok('--paper-shade'), tok('--court-dark'), 0.35);
  roundRect(ctx, 20, 20, w - 40, h - 40, 10);
  ctx.stroke();
  ctx.setLineDash([]);
  // 끈 구멍
  for (const [gx, gy] of [[34, 34], [w - 34, 34], [34, h - 34], [w - 34, h - 34]] as const) {
    ctx.fillStyle = tok('--yellow');
    ctx.beginPath();
    ctx.arc(gx, gy, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = inkC;
    ctx.stroke();
    ctx.fillStyle = inkC;
    ctx.beginPath();
    ctx.arc(gx, gy, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // 양 끝의 종이비행기 낙서
  const doodle = (cx: number, cy: number, s: number, color: string, flip: number): void => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(flip * s, s);
    ctx.rotate(-0.25);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5 / s;
    ctx.strokeStyle = inkC;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-30, -6); ctx.lineTo(34, -16); ctx.lineTo(-6, 20); ctx.lineTo(-8, 4); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(34, -16); ctx.lineTo(-8, 4);
    ctx.stroke();
    ctx.restore();
  };
  doodle(96, h / 2 + 4, 1.05, tok('--sky'), 1);
  doodle(w - 96, h / 2 + 4, 1.05, tok('--pink'), -1);
  const colors = [tok('--red'), tok('--blue'), tok('--green'), tok('--orange'), tok('--purple')];
  const fontPx = Math.round(h * 0.54);
  ctx.font = `${fontPx}px ${DISPLAY_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  const chars = Array.from(BANNER_TEXT);
  const widths = chars.map((ch) => (ch === ' ' ? fontPx * 0.34 : ctx.measureText(ch).width + 6));
  const total = widths.reduce((s, v) => s + v, 0);
  const scale = Math.min(1, (w - 300) / total);
  let x = (w - total * scale) / 2;
  const rnd = seeded(31);
  let k = 0;
  chars.forEach((ch, i) => {
    const cw = widths[i]! * scale;
    if (ch !== ' ') {
      ctx.save();
      // 아이가 한 글자씩 오려 붙인 듯 조금씩 비뚤게
      ctx.translate(x + cw / 2, h / 2 + (rnd() - 0.5) * h * 0.08);
      ctx.rotate((rnd() - 0.5) * 0.14);
      ctx.scale(scale, scale);
      ctx.lineWidth = 12;
      ctx.strokeStyle = inkC;
      ctx.strokeText(ch, 0, 4);
      ctx.fillStyle = colors[k % colors.length]!;
      ctx.fillText(ch, 0, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillText(ch, -2, 1);
      ctx.restore();
      k++;
    }
    x += cw;
  });
}

// ---- 전광판: 점으로 빛나는 글자 ----
interface BoardLayers { mask: HTMLCanvasElement; dim: HTMLCanvasElement; text: HTMLCanvasElement }

function makeBoardLayers(w: number, h: number): BoardLayers {
  const pitch = 5;
  const mask = canvasOf(w, h);
  const dim = canvasOf(w, h);
  const text = canvasOf(w, h);
  if (mask.ctx && dim.ctx) {
    dim.ctx.fillStyle = mix(tok('--board'), '#000000', 0.25);
    dim.ctx.fillRect(0, 0, w, h);
    mask.ctx.fillStyle = '#fff';
    dim.ctx.fillStyle = mix(tok('--board'), tok('--blue'), 0.22);
    for (let y = pitch / 2 + 14; y < h - 14; y += pitch) for (let x = pitch / 2 + 14; x < w - 14; x += pitch) {
      mask.ctx.beginPath();
      mask.ctx.arc(x, y, 2.15, 0, Math.PI * 2);
      mask.ctx.fill();
      dim.ctx.beginPath();
      dim.ctx.arc(x, y, 1.4, 0, Math.PI * 2);
      dim.ctx.fill();
    }
    // 테두리
    dim.ctx.strokeStyle = tok('--yellow');
    dim.ctx.lineWidth = 7;
    roundRect(dim.ctx, 5, 5, w - 10, h - 10, 12);
    dim.ctx.stroke();
  }
  return { mask: mask.canvas, dim: dim.canvas, text: text.canvas };
}

function drawBoard(ctx: CanvasRenderingContext2D, L: BoardLayers, w: number, h: number, label: string, value: string): void {
  const t = L.text.getContext('2d');
  if (!t) return;
  t.globalCompositeOperation = 'source-over';
  t.clearRect(0, 0, w, h);
  t.textAlign = 'center';
  t.textBaseline = 'middle';
  t.fillStyle = mix(tok('--paper'), tok('--sky'), 0.15);
  t.font = `${Math.round(h * 0.24)}px ${DISPLAY_FONT}`;
  t.fillText(label, w / 2, h * 0.25);
  t.fillStyle = tok('--yellow');
  let px = Math.round(h * 0.47);
  t.font = `${px}px ${DISPLAY_FONT}`;
  const tw = t.measureText(value).width;
  if (tw > w - 64) {
    px = Math.floor((px * (w - 64)) / tw);
    t.font = `${px}px ${DISPLAY_FONT}`;
  }
  t.fillText(value, w / 2, h * 0.66);
  t.globalCompositeOperation = 'destination-in';
  t.drawImage(L.mask, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(L.dim, 0, 0);
  ctx.save();
  ctx.shadowColor = tok('--yellow');
  ctx.shadowBlur = 12;
  ctx.drawImage(L.text, 0, 0);
  ctx.drawImage(L.text, 0, 0);
  ctx.restore();
  ctx.drawImage(L.text, 0, 0);
}

// ---- 바닥 숫자 카드(1 ~ maxMark 를 한 장에 모은 그림) ----
const ATLAS_COLS = 11;
const ATLAS_CELL = 93;

function drawAtlas(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, ATLAS_COLS * ATLAS_CELL, ATLAS_COLS * ATLAS_CELL);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const rnd = seeded(77);
  for (let n = 1; n <= GYM.maxMark; n++) {
    const cx = ((n - 1) % ATLAS_COLS) * ATLAS_CELL + ATLAS_CELL / 2;
    const cy = Math.floor((n - 1) / ATLAS_COLS) * ATLAS_CELL + ATLAS_CELL / 2;
    const major = n % 5 === 0;
    const bw = ATLAS_CELL - 14, bh = ATLAS_CELL * 0.64;
    ctx.save();
    ctx.translate(cx, cy + 5);
    ctx.rotate((rnd() - 0.5) * 0.07);
    ctx.fillStyle = major ? tok('--yellow') : tok('--paper');
    ctx.strokeStyle = tok('--ink');
    ctx.lineWidth = 4;
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = tok('--ink');
    ctx.font = `${n >= 100 ? 36 : 44}px ${DISPLAY_FONT}`;
    ctx.fillText(String(n), 0, 3);
    // 위쪽에 붙인 마스킹 테이프 조각
    ctx.rotate((rnd() - 0.5) * 0.2);
    ctx.fillStyle = major ? tok('--tape-blue') : tok('--tape-yellow');
    ctx.fillRect(-17, -bh / 2 - 9, 34, 15);
    ctx.restore();
  }
}

function drawGlass(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#bfe6ff');
  g.addColorStop(0.35, '#e9f8ff');
  g.addColorStop(0.7, '#fffdf0');
  g.addColorStop(1, '#fff3cf');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rnd = seeded(12);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = 0; i < 5; i++) {
    const cx = rnd() * w, cy = h * (0.12 + rnd() * 0.5);
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.ellipse(cx + (k - 1.5) * 18, cy + (rnd() - 0.5) * 8, 20 + rnd() * 12, 11 + rnd() * 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** 바닥에 떨어진 창 모양 햇빛(창살 그림자 포함). */
function drawSunPatch(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  ctx.filter = 'blur(3px)';
  ctx.fillStyle = '#fff';
  const hw = w * 0.42, cx = w / 2, bottom = h - 8, straight = (h - 16) * (WIN.straight / (WIN.straight + WIN.hw));
  ctx.beginPath();
  ctx.moveTo(cx - hw, bottom);
  ctx.lineTo(cx + hw, bottom);
  ctx.lineTo(cx + hw, bottom - straight);
  ctx.arc(cx, bottom - straight, hw, 0, Math.PI, true);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillRect(cx - 3, 0, 6, h);
  ctx.fillRect(0, bottom - straight * 0.5 - 3, w, 6);
  ctx.fillRect(0, bottom - straight - 3, w, 6);
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
}

/** 빛줄기: 창 쪽(v = 0)이 밝고 바닥 쪽으로 사라진다. 가로로는 가장자리가 부드럽다. */
function drawShaft(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const img = ctx.createImageData(w, h);
  const rnd = seeded(3);
  const streak: number[] = [];
  for (let x = 0; x < w; x++) streak.push(0.72 + 0.28 * Math.sin(x * 0.55 + rnd() * 0.8) * Math.sin(x * 0.21 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x + 0.5) / w, v = 1 - (y + 0.5) / h;
    const edge = Math.pow(Math.sin(Math.PI * u), 1.4);
    const along = Math.pow(1 - v, 0.9) * Math.min(1, v * 12);
    const a = edge * along * streak[x]!;
    const o = (y * w + x) * 4;
    img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255; img.data[o + 3] = Math.round(255 * a);
  }
  ctx.putImageData(img, 0, 0);
}

/** 벽에 붙인 아이들 그림 네 장(크레파스 느낌). 한 장이 정사각형 한 칸. */
function drawKidArt(ctx: CanvasRenderingContext2D, cell: number): void {
  const inkC = tok('--ink');
  const paper = tok('--paper');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const sheet = (i: number, tint: string): void => {
    ctx.save();
    ctx.translate(i * cell, 0);
    ctx.fillStyle = tint;
    ctx.strokeStyle = mix(inkC, paper, 0.35);
    ctx.lineWidth = 4;
    roundRect(ctx, 12, 20, cell - 24, cell - 32, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = tok('--tape-yellow');
    ctx.fillRect(cell / 2 - 30, 8, 60, 24);
  };
  const crayon = (color: string, w: number): void => { ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w; };
  // 1) 종이비행기와 구름
  sheet(0, paper);
  crayon(tok('--sky'), 9);
  for (const [x, y, r] of [[70, 80, 20], [96, 72, 26], [124, 82, 20]] as const) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  crayon(tok('--red'), 8);
  ctx.beginPath(); ctx.moveTo(70, 170); ctx.lineTo(196, 118); ctx.lineTo(128, 204); ctx.lineTo(120, 172); ctx.closePath(); ctx.fill();
  crayon(inkC, 5);
  ctx.beginPath(); ctx.moveTo(196, 118); ctx.lineTo(120, 172); ctx.stroke();
  ctx.setLineDash([4, 14]);
  ctx.beginPath(); ctx.moveTo(66, 176); ctx.quadraticCurveTo(30, 200, 52, 222); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  // 2) 해와 무지개
  sheet(1, mix(paper, tok('--yellow-soft'), 0.6));
  const bow = [tok('--red'), tok('--orange'), tok('--yellow'), tok('--green'), tok('--blue'), tok('--purple')];
  bow.forEach((c, k) => { crayon(c, 11); ctx.beginPath(); ctx.arc(cell / 2, 196, 92 - k * 11, Math.PI, 0); ctx.stroke(); });
  crayon(tok('--orange'), 7);
  ctx.beginPath(); ctx.arc(196, 74, 20, 0, Math.PI * 2); ctx.fill();
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(196 + Math.cos(a) * 28, 74 + Math.sin(a) * 28); ctx.lineTo(196 + Math.cos(a) * 40, 74 + Math.sin(a) * 40); ctx.stroke(); }
  ctx.restore();
  // 3) 큰 별과 "1등"
  sheet(2, mix(paper, tok('--blue-soft'), 0.6));
  crayon(tok('--yellow'), 8);
  ctx.beginPath();
  for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k / 10) * Math.PI * 2; const r = k % 2 ? 34 : 78; const x = cell / 2 + Math.cos(a) * r, y = 128 + Math.sin(a) * r; if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.closePath(); ctx.fill();
  crayon(tok('--orange'), 6); ctx.stroke();
  crayon(inkC, 5);
  ctx.beginPath(); ctx.arc(cell / 2 - 16, 122, 4, 0, Math.PI * 2); ctx.arc(cell / 2 + 16, 122, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cell / 2, 132, 15, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.restore();
  // 4) 꽃과 풀밭
  sheet(3, mix(paper, tok('--green-soft'), 0.6));
  crayon(tok('--green'), 9);
  ctx.beginPath(); ctx.moveTo(30, 214); ctx.lineTo(cell - 30, 214); ctx.stroke();
  for (const [fx, c] of [[84, tok('--pink')], [150, tok('--purple')], [200, tok('--red')]] as const) {
    crayon(tok('--green'), 7);
    ctx.beginPath(); ctx.moveTo(fx, 212); ctx.lineTo(fx, 132); ctx.stroke();
    crayon(c, 6);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; ctx.beginPath(); ctx.arc(fx + Math.cos(a) * 17, 116 + Math.sin(a) * 17, 11, 0, Math.PI * 2); ctx.fill(); }
    crayon(tok('--yellow'), 4);
    ctx.beginPath(); ctx.arc(fx, 116, 10, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawClock(ctx: CanvasRenderingContext2D, s: number): void {
  const c = s / 2;
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = tok('--paper');
  ctx.beginPath();
  ctx.arc(c, c, c - 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = tok('--ink');
  ctx.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r0 = i % 3 === 0 ? c * 0.7 : c * 0.78, r1 = c * 0.87;
    ctx.lineWidth = i % 3 === 0 ? 9 : 5;
    ctx.beginPath();
    ctx.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0);
    ctx.lineTo(c + Math.sin(a) * r1, c - Math.cos(a) * r1);
    ctx.stroke();
  }
  const hand = (a: number, len: number, lw: number, color: string): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(c - Math.sin(a) * len * 0.15, c + Math.cos(a) * len * 0.15);
    ctx.lineTo(c + Math.sin(a) * len, c - Math.cos(a) * len);
    ctx.stroke();
  };
  hand((2 / 12) * Math.PI * 2 + 0.09, c * 0.46, 11, tok('--ink'));
  hand((10 / 60) * Math.PI * 2, c * 0.68, 8, tok('--ink'));
  hand((38 / 60) * Math.PI * 2, c * 0.7, 3.5, tok('--red'));
  ctx.fillStyle = tok('--red');
  ctx.beginPath();
  ctx.arc(c, c, 9, 0, Math.PI * 2);
  ctx.fill();
}

const noUv = <T extends THREE.BufferGeometry>(g: T): T => { g.deleteAttribute('uv'); return g; };

function archShape(hw: number, straight: number, y0 = 0): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-hw, y0);
  s.lineTo(hw, y0);
  s.lineTo(hw, y0 + straight);
  s.absarc(0, y0 + straight, hw, 0, Math.PI, false);
  s.lineTo(-hw, y0);
  return s;
}

// ---------------------------------------------------------------------------
export function buildGym(maxAnisotropy: number, tier: Tier): Gym {
  const group = new THREE.Group();
  const trash = new Trash();
  const keep = <T extends { dispose: () => void }>(x: T): T => trash.keep(x);
  const { backX, frontX, halfZ, height, matH } = GYM;
  const lenX = frontX - backX;
  const midX = (frontX + backX) / 2;
  const aniso = Math.min(tier.anisotropy, Math.max(1, maxAnisotropy));
  const timeU = { value: 0 };
  const sheenU = { value: tier.floorSheen ? 1 : 0 };
  /** 낮은 화질에서는 바닥과 바닥에 붙은 것을 빛 계산 없는 재질로 바꿔 그린다(화면의 절반이 바닥이라 효과가 크다). */
  const swaps: { mesh: THREE.Mesh; lit: THREE.Material; flat: THREE.Material }[] = [];
  const flatOf = (lit: THREE.MeshToonMaterial): THREE.MeshBasicMaterial => keep(new THREE.MeshBasicMaterial({ map: lit.map, vertexColors: lit.vertexColors, transparent: lit.transparent, depthWrite: lit.depthWrite, side: lit.side, polygonOffset: lit.polygonOffset, polygonOffsetFactor: lit.polygonOffsetFactor, polygonOffsetUnits: lit.polygonOffsetUnits, color: new THREE.Color('#fff6e8') }));

  const paper = tok('--paper'), inkC = tok('--ink'), wood = tok('--court-dark'), wall = tok('--wall');
  const woodLight = mix(tok('--court'), paper, 0.25);
  const woodDark = mix(wood, inkC, 0.25);
  const orange = tok('--orange');

  // ---------------- 마루 ----------------
  const floorC = canvasOf(1024, 1024);
  if (floorC.ctx) drawFloor(floorC.ctx, 1024);
  const floorTex = keep(texOf(floorC.canvas, aniso));
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(lenX / 4.8, (halfZ * 2) / 4.8);
  const floorGeom = keep(new THREE.PlaneGeometry(lenX, halfZ * 2));
  const floorMat = keep(toonMat({ map: floorTex }));
  floorMat.onBeforeCompile = (shader) => {
    shader.uniforms.uSheen = sheenU;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;\nuniform float uSheen;')
      .replace('#include <opaque_fragment>', `
        if (uSheen > 0.5) {
          // 윤이 나는 마루: 보는 방향을 바닥에 되비춰 창(양쪽 벽)과 천장 조명이 어디에 비치는지 계산한다.
          vec3 Vw = normalize(cameraPosition - vWorldP);
          vec3 Rw = reflect(-Vw, vec3(0.0, 1.0, 0.0));
          float fres = pow(1.0 - clamp(Vw.y, 0.0, 1.0), 3.0);
          float lum = dot(diffuseColor.rgb, vec3(0.33));
          float refl = 0.0;
          for (int i = 0; i < 2; i++) {
            float sgn = i == 0 ? -1.0 : 1.0;
            float rz = Rw.z * sgn;
            if (rz > 0.02) {
              float tt = (${halfZ.toFixed(1)} - vWorldP.z * sgn) / rz;
              vec3 H = vWorldP + Rw * tt;
              float blur = 0.25 + tt * 0.035;
              float wy = smoothstep(${WIN.y0.toFixed(1)} - blur, ${WIN.y0.toFixed(1)} + blur, H.y) * (1.0 - smoothstep(8.6 - blur, 8.9 + blur * 2.0, H.y));
              float fx = abs(mod(H.x - ${WIN.first.toFixed(2)} + ${(WIN.pitch / 2).toFixed(3)}, ${WIN.pitch.toFixed(2)}) - ${(WIN.pitch / 2).toFixed(3)});
              float wx = 1.0 - smoothstep(${WIN.hw.toFixed(2)} - blur, ${WIN.hw.toFixed(2)} + blur, fx);
              refl += wy * wx * (i == 0 ? 1.0 : 0.6);
            }
          }
          float lamp = 0.0;
          if (Rw.y > 0.05) {
            float tl = (8.3 - vWorldP.y) / Rw.y;
            vec3 Hl = vWorldP + Rw * tl;
            float lx = abs(mod(Hl.x - ${TRUSS.first.toFixed(2)} + ${(TRUSS.pitch / 2).toFixed(3)}, ${TRUSS.pitch.toFixed(2)}) - ${(TRUSS.pitch / 2).toFixed(3)});
            float lz = abs(abs(Hl.z) - ${TRUSS.lampZ.toFixed(1)});
            lamp = 1.0 - smoothstep(0.25, 1.1, length(vec2(lx, lz)));
          }
          float gloss = 0.75 + lum * 0.5;
          outgoingLight += vec3(1.0, 0.97, 0.88) * refl * (0.07 + 0.55 * fres) * gloss;
          outgoingLight += vec3(1.0, 0.93, 0.75) * lamp * (0.05 + 0.3 * fres) * gloss;
          outgoingLight += vec3(0.95, 0.93, 0.9) * fres * 0.12;
        }
        #include <opaque_fragment>`);
  };
  floorMat.customProgramCacheKey = () => 'gym-floor';
  const floor = new THREE.Mesh(floorGeom, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(midX, 0, 0);
  floor.renderOrder = -5;
  floor.receiveShadow = true;
  group.add(floor);
  swaps.push({ mesh: floor, lit: floorMat, flat: flatOf(floorMat) });

  const decalBase = { transparent: true, depthWrite: false } as const;
  const addDecal = (geom: THREE.BufferGeometry, mat: THREE.Material, order: number, offset: number): THREE.Mesh => {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -offset;
    mat.polygonOffsetUnits = -offset;
    const m = new THREE.Mesh(keep(geom), keep(mat));
    m.renderOrder = order;
    m.receiveShadow = true;
    group.add(m);
    if (mat instanceof THREE.MeshToonMaterial) swaps.push({ mesh: m, lit: mat, flat: flatOf(mat) });
    return m;
  };

  // ---------------- 닿은 자리 그림자(소품 아래의 부드러운 그늘) ----------------
  const blobTex = keep(radialTexture(64, 0.1, 1.8));
  const blobs = new Merger(true);
  const blob = (x: number, z: number, rx: number, rz: number, ry = 0): void => {
    const c = Math.cos(ry), s = Math.sin(ry);
    const p = (dx: number, dz: number): number[] => [x + dx * c + dz * s, 0.003, z - dx * s + dz * c];
    blobs.quad(p(-rx, rz), p(rx, rz), p(rx, -rz), p(-rx, -rz), '#ffffff');
  };

  // ---------------- 코트 라인, 눈금 ----------------
  const lineC = canvasOf(256, 32);
  if (lineC.ctx) drawLine(lineC.ctx, 256, 32);
  const lineTex = keep(texOf(lineC.canvas, aniso));
  lineTex.wrapS = THREE.RepeatWrapping;
  const lines = new Merger(true);
  const Y = 0.004;
  /** (x0,z0)-(x1,z1) 를 잇는 폭 w 의 띠. u 는 길이를 따라 되풀이된다. */
  const stripUV = (x0: number, z0: number, x1: number, z1: number, w: number, color = '#ffffff'): void => {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const nx = (-dz / len) * w * 0.5, nz = (dx / len) * w * 0.5;
    const g = new THREE.BufferGeometry();
    const a = [x0 - nx, Y, z0 - nz], b = [x1 - nx, Y, z1 - nz], c = [x1 + nx, Y, z1 + nz], d = [x0 + nx, Y, z0 + nz];
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...d, ...c, ...a, ...c, ...b], 3));
    const u = len / (w * 8);
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, u, 1, 0, 0, u, 1, u, 0], 2));
    g.computeVertexNormals();
    lines.add(g, color);
  };
  const ringUV = (cx: number, cz: number, r: number, w: number, a0 = 0, a1 = Math.PI * 2, seg = 56): void => {
    for (let i = 0; i < seg; i++) {
      const t0 = a0 + ((a1 - a0) * i) / seg, t1 = a0 + ((a1 - a0) * (i + 1)) / seg;
      stripUV(cx + Math.cos(t0) * r, cz + Math.sin(t0) * r, cx + Math.cos(t1) * r, cz + Math.sin(t1) * r, w);
    }
  };
  const cx0 = -5.5, cx1 = 22.5, cz = 7.5, lw = 0.08;
  stripUV(cx0, -cz, cx1, -cz, lw);
  stripUV(cx0, cz, cx1, cz, lw);
  stripUV(cx0, -cz, cx0, cz, lw);
  stripUV(cx1, -cz, cx1, cz, lw);
  stripUV(8.5, -cz, 8.5, cz, lw);
  ringUV(8.5, 0, 1.8, lw);
  ringUV(cx0, 0, 6.2, lw, -Math.PI / 2, Math.PI / 2, 40);
  ringUV(cx1, 0, 6.2, lw, Math.PI / 2, Math.PI * 1.5, 40);
  // 1 m 눈금(짧게)과 5 m 눈금(길게)
  const tickTint = mix(paper, tok('--yellow'), 0.15);
  for (let n = 1; n <= GYM.maxMark; n++) {
    if (n % 5 === 0) stripUV(n, -1.1, n, 1.1, 0.085, tickTint);
    else stripUV(n, -0.34, n, 0.34, 0.05, tickTint);
  }
  addDecal(lines.build(), toonMat({ map: lineTex, vertexColors: true, ...decalBase }), -4, 2);

  // ---------------- 출발선 ----------------
  const tapeC = canvasOf(1024, 40);
  if (tapeC.ctx) drawTape(tapeC.ctx, 1024, 40);
  const tapeTex = keep(texOf(tapeC.canvas, aniso));
  {
    const g = new Merger(true);
    g.quad([-0.075, Y, 2.9], [0.055, Y, 2.94], [0.075, Y, -2.86], [-0.055, Y, -2.9], '#ffffff', [0, 0, 1, 1]);
    // quad 의 UV 는 a(0,0) b(1,0) c(1,1) d(0,1): 긴 쪽이 v 가 되므로 텍스처를 돌려 쓴다.
    const geom = g.build();
    const uv = geom.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
    addDecal(geom, toonMat({ map: tapeTex, ...decalBase }), -3, 4);
  }

  // ---------------- 숫자 카드 ----------------
  const atlasC = canvasOf(ATLAS_COLS * ATLAS_CELL, ATLAS_COLS * ATLAS_CELL);
  if (atlasC.ctx) drawAtlas(atlasC.ctx);
  const atlasTex = keep(texOf(atlasC.canvas, aniso));
  {
    const cards = new Merger(true);
    // 글자의 위쪽은 "출발선 옆에서 봐도, 뒤에서 따라가며 봐도" 읽히도록 비스듬히(-Z 와 +X 사이) 향한다.
    const up = new THREE.Vector3(0.5, 0, -0.866);
    const right = new THREE.Vector3(0.866, 0, 0.5);
    const rnd = seeded(404);
    for (let n = 1; n <= GYM.maxMark; n++) {
      const major = n % 5 === 0;
      const s = major ? 1.0 : 0.62;
      const z = major ? -1.95 : -1.0;
      const u0 = ((n - 1) % ATLAS_COLS) / ATLAS_COLS;
      const v1 = 1 - Math.floor((n - 1) / ATLAS_COLS) / ATLAS_COLS;
      const u1 = u0 + 1 / ATLAS_COLS, v0 = v1 - 1 / ATLAS_COLS;
      const wob = (rnd() - 0.5) * 0.16;
      const r = right.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), wob).multiplyScalar(s / 2);
      const uu = up.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), wob).multiplyScalar(s / 2);
      const c = new THREE.Vector3(n + 0.12, Y, z);
      const P = (a: number, b: number): number[] => [c.x + r.x * a + uu.x * b, Y, c.z + r.z * a + uu.z * b];
      cards.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), '#ffffff', [u0, v0, u1, v1]);
    }
    addDecal(cards.build(), toonMat({ map: atlasTex, ...decalBase, side: THREE.DoubleSide }), -2, 6);
  }

  // =====================================================================
  // 음영 있는 덩어리들: shell(벽, 천장: 그림자를 드리우지 않는다) / props(소품: 그림자를 드리운다)
  // =====================================================================
  const shell = new Merger();
  const props = new Merger();
  const propsFar = new Merger(); // 멀리 있어 그림자를 드리울 일이 없는 소품
  const shellFar = new Merger(); // 먼 쪽의 창, 기둥, 트러스(낮은 화질에서는 그리지 않는다)
  const glowFar = new Merger(true);
  const FAR_X = 44;
  const roof = new Merger(); // 가까운 쪽 천장 트러스와 조명 갓(낮은 화질에서는 그리지 않는다)
  const glow = new Merger(true); // 스스로 밝은 면(창유리, 조명, 문 유리)

  // ---- 윗벽: 아래는 따뜻한 크림색, 위로 갈수록 살짝 어둡고 차갑게 ----
  const wallLow = mix(wall, tok('--yellow-soft'), 0.25);
  const wallHigh = mix(wall, tok('--hall'), 0.45);
  const wallColor = (yWorld: number): string => mix(wallLow, wallHigh, Math.min(1, Math.max(0, (yWorld - matH) / (height - matH))));
  {
    const hgt = height - matH;
    const side = (): THREE.PlaneGeometry => new THREE.PlaneGeometry(lenX, hgt, 1, 6);
    shell.add(side(), (_x, y) => wallColor(y + matH + hgt / 2), { x: midX, y: matH + hgt / 2, z: -halfZ });
    shell.add(side(), (_x, y) => wallColor(y + matH + hgt / 2), { x: midX, y: matH + hgt / 2, z: halfZ, ry: Math.PI });
    shell.add(new THREE.PlaneGeometry(halfZ * 2, hgt, 1, 6), (_x, y) => wallColor(y + matH + hgt / 2), { x: backX, y: matH + hgt / 2, ry: Math.PI / 2 });
    shell.add(new THREE.PlaneGeometry(halfZ * 2, height, 1, 1), wallHigh, { x: frontX, y: height / 2, ry: -Math.PI / 2 });
    // 천장
    shell.add(new THREE.PlaneGeometry(lenX, halfZ * 2), mix(paper, tok('--hall'), 0.55), { x: midX, y: height, rx: Math.PI / 2 });
  }
  // 매트 위 나무 띠, 기둥
  shell.add(rbox(lenX, 0.16, 0.2, 0.05), wood, { x: midX, y: matH + 0.07, z: -halfZ + 0.1 });
  shell.add(rbox(lenX, 0.16, 0.2, 0.05), wood, { x: midX, y: matH + 0.07, z: halfZ - 0.1 });
  shell.add(rbox(0.2, 0.16, halfZ * 2, 0.05), wood, { x: backX + 0.1, y: matH + 0.07 });
  const pilaster = mix(wall, paper, 0.5);
  for (let x = TRUSS.first; x < frontX - 2; x += TRUSS.pitch) {
    for (const z of [-halfZ + 0.13, halfZ - 0.13]) {
      (x < FAR_X ? shell : shellFar).add(x < FAR_X ? rbox(0.56, height - matH - 0.1, 0.26, 0.06, 1) : new THREE.BoxGeometry(0.56, height - matH - 0.1, 0.26), pilaster, { x, y: matH + (height - matH) / 2 + 0.05, z });
      if (x < FAR_X) shell.add(rbox(0.74, 0.3, 0.4, 0.07, 1), pilaster, { x, y: height - 1.05, z });
    }
  }

  // ---- 매트(텍스처) ----
  const matC = canvasOf(512, 256);
  if (matC.ctx) drawMats(matC.ctx, 512, 256);
  const matTex = keep(texOf(matC.canvas, aniso));
  matTex.wrapS = THREE.RepeatWrapping;
  {
    const mats = new Merger(true);
    const off = 0.1;
    const uLen = lenX / 4, uBack = (halfZ * 2) / 4;
    mats.quad([backX, 0, -halfZ + off], [frontX, 0, -halfZ + off], [frontX, matH, -halfZ + off], [backX, matH, -halfZ + off], '#ffffff', [0, 0, uLen, 1]);
    mats.quad([frontX, 0, halfZ - off], [backX, 0, halfZ - off], [backX, matH, halfZ - off], [frontX, matH, halfZ - off], '#ffffff', [0, 0, uLen, 1]);
    mats.quad([backX + off, 0, halfZ], [backX + off, 0, -halfZ], [backX + off, matH, -halfZ], [backX + off, matH, halfZ], '#ffffff', [0.5, 0, uBack + 0.5, 1]);
    const m = new THREE.Mesh(keep(mats.build()), keep(toonMat({ map: matTex, vertexColors: true })));
    m.receiveShadow = true;
    group.add(m);
  }

  // ---- 아치 창 ----
  const glassC = canvasOf(128, 192);
  if (glassC.ctx) drawGlass(glassC.ctx, 128, 192);
  const glassTex = keep(texOf(glassC.canvas, 1));
  const frameWood = mix(wood, woodLight, 0.25);
  const addWindow = (x: number, y: number, z: number, ry: number, bright: number, near = true): void => {
    const base = placeMatrix4(x, y, z, ry);
    const frameShape = archShape(WIN.hw + 0.24, WIN.straight, 0);
    frameShape.holes.push(archShape(WIN.hw, WIN.straight - 0.18, 0.18));
    const frame = new THREE.ExtrudeGeometry(frameShape, near ? { depth: 0.16, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, curveSegments: 8 } : { depth: 0.19, bevelEnabled: false, curveSegments: 5 });
    const sh = near ? shell : shellFar, gl = near ? glow : glowFar;
    sh.add(frame, frameWood, base);
    const at = (lx: number, ly: number, lz: number): THREE.Matrix4 => base.clone().multiply(new THREE.Matrix4().makeTranslation(lx, ly, lz));
    const bar = (w: number, h: number, dd: number, r: number): THREE.BufferGeometry => (near ? rbox(w, h, dd, r, 1) : new THREE.BoxGeometry(w, h, dd));
    sh.add(bar(0.11, WIN.straight + WIN.hw - 0.2, 0.1, 0.03), frameWood, at(0, (WIN.straight + WIN.hw) / 2 + 0.05, 0.08));
    sh.add(bar(WIN.hw * 2, 0.11, 0.1, 0.03), frameWood, at(0, WIN.straight * 0.5 + 0.1, 0.08));
    sh.add(bar(WIN.hw * 2, 0.11, 0.1, 0.03), frameWood, at(0, WIN.straight, 0.08));
    sh.add(bar(WIN.hw * 2 + 0.9, 0.16, 0.42, 0.06), mix(frameWood, paper, 0.25), at(0, -0.07, 0.14));
    const glass = new THREE.ShapeGeometry(archShape(WIN.hw, WIN.straight - 0.18, 0.18), near ? 8 : 5);
    const P = glass.getAttribute('position'), U = glass.getAttribute('uv');
    for (let i = 0; i < P.count; i++) U.setXY(i, (P.getX(i) + WIN.hw) / (WIN.hw * 2), P.getY(i) / (WIN.straight + WIN.hw));
    const tint = new THREE.Color(1, 1, 1).multiplyScalar(bright);
    gl.add(glass, `#${tint.getHexString()}`, at(0, 0, 0.04));
  };
  const placeMatrix4 = (x: number, y: number, z: number, ry: number): THREE.Matrix4 =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
  const windowXs: number[] = [];
  for (let x = WIN.first; x < frontX - 4; x += WIN.pitch) windowXs.push(x);
  for (const x of windowXs) {
    addWindow(x, WIN.y0, -halfZ + 0.01, 0, 1, x < FAR_X);
    addWindow(x, WIN.y0, halfZ - 0.01, Math.PI, 0.9, x < FAR_X);
  }
  for (const z of [-8.2, 8.2]) addWindow(backX + 0.01, WIN.y0, z, Math.PI / 2, 0.92);

  // ---- 천장 트러스, 도리, 매달린 조명 ----
  const steel = mix(mix(wall, tok('--mat'), 0.22), inkC, 0.1);
  const lampWarm = '#fff4cf';
  for (let x = TRUSS.first; x < frontX - 2; x += TRUSS.pitch) {
    const near = x < FAR_X;
    const sh = near ? roof : shellFar, gl = near ? glow : glowFar;
    sh.add(new THREE.BoxGeometry(0.2, 0.2, halfZ * 2 - 0.2), steel, { x, y: 9.55 });
    sh.add(new THREE.BoxGeometry(0.2, 0.2, halfZ * 2 - 0.2), steel, { x, y: 10.36 });
    if (near) {
      const n = 12, span = (halfZ * 2 - 0.4) / n;
      for (let i = 0; i < n; i++) {
        const zc = -halfZ + 0.2 + span * (i + 0.5);
        const ang = Math.atan2(0.81, span) * (i % 2 ? 1 : -1);
        sh.add(new THREE.BoxGeometry(0.1, 0.1, Math.hypot(span, 0.81)), steel, { x, y: 9.955, z: zc, rx: ang });
      }
    }
    for (const z of [-TRUSS.lampZ, TRUSS.lampZ]) {
      sh.add(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 6), inkC, { x, y: 8.95, z });
      sh.add(smoothLathe([[0.07, 0.34], [0.12, 0.3], [0.34, 0.14], [0.62, 0.02], [0.66, -0.03]], near ? 16 : 8, near ? 8 : 4), mix(tok('--mat'), paper, 0.15), { x, y: 8.36, z });
      gl.add(noUv(new THREE.CircleGeometry(0.6, near ? 18 : 10)), lampWarm, { x, y: 8.36, z, rx: Math.PI / 2 });
      if (near) gl.add(noUv(new THREE.SphereGeometry(0.16, 10, 8)), lampWarm, { x, y: 8.33, z });
    }
  }
  for (const z of [-9.5, -3.2, 3.2, 9.5]) shell.add(new THREE.BoxGeometry(lenX, 0.12, 0.14), steel, { x: midX, y: 10.43, z });

  // ---- 뒷벽: 문, 농구 골대, 시계, 스피커, 구급함 ----
  for (const dz of [-9.2, 9.2]) {
    props.add(rbox(0.14, 2.3, 2.1, 0.05), mix(tok('--blue'), inkC, 0.15), { x: backX + 0.13, y: 1.15, z: dz });
    for (const s of [-1, 1]) {
      props.add(rbox(0.1, 2.12, 0.94, 0.04), tok('--blue'), { x: backX + 0.2, y: 1.12, z: dz + s * 0.5 });
      glow.add(noUv(new THREE.PlaneGeometry(0.5, 0.7)), '#eaf8ff', { x: backX + 0.262, y: 1.55, z: dz + s * 0.5, ry: Math.PI / 2 });
      props.add(rbox(0.06, 0.06, 0.6, 0.025, 1), mix(paper, inkC, 0.25), { x: backX + 0.29, y: 1.0, z: dz + s * 0.5 });
    }
    props.add(rbox(0.1, 0.3, 0.8, 0.04, 1), tok('--green'), { x: backX + 0.18, y: 2.62, z: dz });
    glow.add(noUv(new THREE.PlaneGeometry(0.56, 0.14)), '#f2fff4', { x: backX + 0.235, y: 2.62, z: dz, ry: Math.PI / 2 });
  }
  for (const hz of [-5.75, 5.75]) {
    // 농구 골대: 벽 받침, 백보드, 림, 그물(원뿔)
    props.add(rbox(0.7, 0.1, 0.1, 0.03, 1), steel, { x: backX + 0.5, y: 3.5, z: hz });
    props.add(rbox(0.08, 1.05, 1.6, 0.04), paper, { x: backX + 0.85, y: 3.55, z: hz });
    props.add(rbox(0.09, 0.5, 0.66, 0.02, 1), tok('--red'), { x: backX + 0.86, y: 3.32, z: hz });
    props.add(rbox(0.1, 0.4, 0.56, 0.02, 1), paper, { x: backX + 0.865, y: 3.32, z: hz });
    props.add(new THREE.TorusGeometry(0.25, 0.022, 6, 20), orange, { x: backX + 1.17, y: 3.1, z: hz, rx: Math.PI / 2 });
    props.add(new THREE.CylinderGeometry(0.25, 0.16, 0.34, 14, 1, true), paper, { x: backX + 1.17, y: 2.93, z: hz });
  }
  // 시계
  const clockC = canvasOf(256, 256);
  if (clockC.ctx) drawClock(clockC.ctx, 256);
  const clockTex = keep(texOf(clockC.canvas, aniso));
  props.add(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 28), tok('--red'), { x: backX + 0.09, y: 6.7, z: -4.3, rz: Math.PI / 2 });
  {
    const m = new THREE.Mesh(keep(new THREE.CircleGeometry(0.54, 28)), keep(toonMat({ map: clockTex })));
    m.position.set(backX + 0.156, 6.7, -4.3);
    m.rotation.y = Math.PI / 2;
    group.add(m);
  }
  // 스피커
  props.add(rbox(0.46, 0.9, 0.56, 0.08), mix(inkC, wall, 0.12), { x: backX + 0.34, y: 6.7, z: 4.3, rz: -0.22 });
  for (const [dy, r] of [[0.18, 0.17], [-0.2, 0.11]] as const) props.add(new THREE.CylinderGeometry(r, r, 0.04, 16), mix(inkC, wall, 0.4), { x: backX + 0.6 + dy * 0.22, y: 6.7 + dy, z: 4.3, rz: Math.PI / 2 - 0.22 });
  // 구급함
  props.add(rbox(0.16, 0.5, 0.62, 0.05), paper, { x: backX + 0.2, y: 2.86, z: 6.9 });
  props.add(new THREE.BoxGeometry(0.02, 0.26, 0.09), tok('--green'), { x: backX + 0.29, y: 2.86, z: 6.9 });
  props.add(new THREE.BoxGeometry(0.02, 0.09, 0.26), tok('--green'), { x: backX + 0.29, y: 2.86, z: 6.9 });

  // ---- 관람석(왼쪽 벽 앞 3단). 반 구역마다 앉는 판 색이 다르다. ----
  {
    const x0 = GYM.bleacherX0, x1 = GYM.bleacherX1;
    const len = x1 - x0, cx = (x0 + x1) / 2;
    const seatTones = [tok('--red-soft'), tok('--yellow-soft'), tok('--blue-soft'), tok('--green-soft')];
    BLEACHER_ROWS.forEach((row, k) => {
      props.add(rbox(len, row.y, 0.8, 0.04, 1), k % 2 ? wood : mix(wood, woodDark, 0.35), { x: cx, y: row.y / 2, z: row.z });
      const sections = 10, sl = len / sections;
      for (let s = 0; s < sections; s++) {
        props.add(rbox(sl - 0.06, 0.08, 0.72, 0.035, 1), mix(seatTones[(s + k) % 4]!, woodLight, 0.35), { x: x0 + sl * (s + 0.5), y: row.y + 0.03, z: row.z + 0.02 });
      }
    });
    for (const ex of [x0 - 0.06, x1 + 0.06]) props.add(rbox(0.12, 1.5, 2.5, 0.05, 1), woodDark, { x: ex, y: 0.75, z: -11.8 });
    blob((x0 + x1) / 2, GYM.bleacherZ + 0.05, len / 2 + 0.5, 0.75);
  }

  // ---- 둥근 주황 콘(5 m 마다 양쪽) ----
  const coneBody = (near: boolean): THREE.BufferGeometry => smoothLathe([[0.135, 0.04], [0.128, 0.07], [0.1, 0.2], [0.067, 0.36], [0.036, 0.48], [0.022, 0.515], [0.004, 0.528]], near ? 11 : 8, near ? 9 : 6);
  for (let n = 5; n <= GYM.maxMark; n += 5) {
    const near = n <= 40;
    const into = near ? props : propsFar;
    for (const z of [-2.75, 2.3]) {
      into.add(near ? rbox(0.38, 0.045, 0.38, 0.02, 1) : new THREE.BoxGeometry(0.38, 0.045, 0.38), mix(orange, inkC, 0.12), { x: n, y: 0.023, z });
      into.add(coneBody(near), (_x, y) => (y > 0.21 && y < 0.31 ? paper : orange), { x: n, z });
      blob(n, z, 0.36, 0.36);
    }
  }

  // ---- 뜀틀 ----
  {
    const bx = -5.4, bz = 9.4, ry = 0.5;
    const base = placeMatrix4(bx, 0, bz, ry);
    const tones = [woodLight, mix(woodLight, wood, 0.45)];
    for (let i = 0; i < 5; i++) {
      const w = 0.98 - i * 0.085, l = 1.45 - i * 0.07;
      props.add(rbox(l, 0.185, w, 0.035), tones[i % 2]!, base.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.095 + i * 0.19, 0)));
    }
    props.add(rbox(1.2, 0.16, 0.56, 0.07), paper, base.clone().multiply(new THREE.Matrix4().makeTranslation(0, 1.03, 0)));
    blob(bx, bz, 1.05, 0.8, ry);
  }
  // ---- 말아 세운 매트 ----
  {
    const tones = [tok('--blue'), tok('--red'), tok('--green')];
    const spots = [[-7.15, 11.9], [-6.5, 12.25], [-7.2, 11.15]] as const;
    spots.forEach(([x, z], i) => {
      const c = tones[i]!;
      props.add(new THREE.CylinderGeometry(0.3, 0.3, 1.25 + i * 0.1, 18), (px, py, pz) => {
        if (py > 0.6) { const r = Math.hypot(px, pz); return Math.floor(r / 0.06) % 2 ? mix(c, inkC, 0.25) : c; }
        return Math.abs(py - 0.2) < 0.045 || Math.abs(py + 0.25) < 0.045 ? mix(paper, inkC, 0.15) : c;
      }, { x, y: 0.63 + i * 0.05, z });
      blob(x, z, 0.5, 0.5);
    });
  }
  // ---- 공 수레 ----
  {
    const bx = -6.35, bz = 5.2;
    props.add(rbox(0.9, 0.5, 0.62, 0.08), mix(tok('--sky'), paper, 0.1), { x: bx, y: 0.47, z: bz });
    props.add(rbox(0.8, 0.06, 0.52, 0.02, 1), mix(tok('--sky'), inkC, 0.35), { x: bx, y: 0.71, z: bz });
    for (const [dx, dz] of [[-0.36, -0.24], [0.36, -0.24], [-0.36, 0.24], [0.36, 0.24]] as const) {
      props.add(new THREE.CylinderGeometry(0.022, 0.022, 0.24, 6), mix(paper, inkC, 0.3), { x: bx + dx, y: 0.15, z: bz + dz });
      props.add(new THREE.SphereGeometry(0.055, 10, 8), inkC, { x: bx + dx, y: 0.055, z: bz + dz });
    }
    const ballTone = [orange, tok('--red'), tok('--yellow'), orange, tok('--blue'), tok('--green'), orange];
    const ballAt = [[-0.24, 0.8, -0.1], [0.02, 0.8, 0.1], [0.27, 0.8, -0.08], [-0.1, 0.8, -0.16], [-0.12, 0.98, 0.02], [0.16, 0.97, 0.04], [0.26, 0.82, 0.16]] as const;
    ballAt.forEach(([dx, dy, dz], i) => {
      const c = ballTone[i]!;
      const seam = c === orange;
      props.add(new THREE.SphereGeometry(0.135, 18, 14), (px, py, pz) => (seam && (Math.abs(px) < 0.012 || Math.abs(py) < 0.012 || Math.abs(Math.abs(pz) - 0.085) < 0.01) ? mix(inkC, orange, 0.2) : c), { x: bx + dx, y: dy, z: bz + dz, rx: i * 1.3, ry: i * 2.1 });
    });
    // 굴러 나온 공 하나
    props.add(new THREE.SphereGeometry(0.135, 18, 14), (px, py) => (Math.abs(px) < 0.012 || Math.abs(py) < 0.012 ? mix(inkC, orange, 0.2) : orange), { x: -5.3, y: 0.135, z: 6.3, rx: 0.6, rz: 0.4 });
    blob(bx, bz, 0.7, 0.55);
    blob(-5.3, 6.3, 0.22, 0.22);
  }
  // ---- 긴 의자(오른쪽 벽 앞) ----
  for (const bx of [3.5, 10.5, 17.5, 24.5, 33]) {
    const bz = halfZ - 1.0;
    props.add(rbox(2.4, 0.08, 0.4, 0.035), woodLight, { x: bx, y: 0.44, z: bz });
    for (const dx of [-0.9, 0.9]) {
      props.add(rbox(0.07, 0.42, 0.34, 0.03, 1), wood, { x: bx + dx, y: 0.21, z: bz });
    }
    props.add(rbox(1.8, 0.06, 0.06, 0.025, 1), wood, { x: bx, y: 0.16, z: bz });
    blob(bx, bz, 1.4, 0.42);
  }
  // ---- 심판 책상(출발선 왼쪽 뒤): 트로피, 종, 물통, 종이 ----
  {
    const tx = -2.3, tz = -5.2;
    props.add(rbox(1.5, 0.07, 0.75, 0.03), tok('--desk'), { x: tx, y: 0.74, z: tz });
    for (const [dx, dz] of [[-0.66, -0.3], [0.66, -0.3], [-0.66, 0.3], [0.66, 0.3]] as const) props.add(rbox(0.07, 0.72, 0.07, 0.025, 1), wood, { x: tx + dx, y: 0.36, z: tz + dz });
    props.add(rbox(1.44, 0.3, 0.03, 0.012, 1), tok('--red'), { x: tx, y: 0.56, z: tz + 0.37 });
    // 트로피
    const gold = mix(tok('--yellow'), orange, 0.2);
    props.add(smoothLathe([[0.09, 0], [0.09, 0.03], [0.03, 0.05], [0.022, 0.13], [0.05, 0.16], [0.1, 0.24], [0.115, 0.33], [0.105, 0.34]], 16, 20), gold, { x: tx + 0.42, y: 0.775, z: tz - 0.05 });
    for (const s of [-1, 1]) props.add(new THREE.TorusGeometry(0.045, 0.012, 6, 12, Math.PI), gold, { x: tx + 0.42, y: 1.04, z: tz - 0.05 + s * 0.11, ry: Math.PI / 2, rz: s * -Math.PI / 2 });
    // 종
    props.add(smoothLathe([[0.085, 0], [0.08, 0.02], [0.06, 0.08], [0.035, 0.12], [0.012, 0.135], [0.012, 0.2], [0.022, 0.22]], 14, 14), tok('--red'), { x: tx + 0.05, y: 0.775, z: tz + 0.12 });
    // 물통과 컵
    props.add(smoothLathe([[0.1, 0], [0.11, 0.03], [0.11, 0.24], [0.08, 0.3], [0.04, 0.33], [0.04, 0.38]], 14, 14), tok('--sky'), { x: tx - 0.45, y: 0.775, z: tz - 0.08 });
    props.add(new THREE.CylinderGeometry(0.045, 0.035, 0.1, 10), paper, { x: tx - 0.22, y: 0.825, z: tz + 0.1 });
    // 기록지
    props.add(rbox(0.3, 0.02, 0.4, 0.008, 1), paper, { x: tx + 0.02, y: 0.785, z: tz - 0.14, ry: 0.2 });
    blob(tx, tz, 1.0, 0.62);
  }
  // ---- 아이가 올라서는 발판 ----
  props.add(rbox(0.78, STEP_H, 0.7, 0.045), woodLight, { x: KID_SPOT.x + 0.02, y: STEP_H / 2, z: KID_SPOT.z });
  props.add(rbox(0.64, 0.03, 0.56, 0.012, 1), tok('--green'), { x: KID_SPOT.x + 0.02, y: STEP_H + 0.004, z: KID_SPOT.z });
  blob(KID_SPOT.x + 0.02, KID_SPOT.z, 0.62, 0.56);

  // ---- 현수막을 매단 끈 ----
  const HANG_X = 9.75;
  for (const z of [-3.6, 3.6]) shell.add(new THREE.CylinderGeometry(0.014, 0.014, 1.75, 5), inkC, { x: HANG_X, y: 8.62, z });
  for (const z of [-3.6, 3.6]) shell.add(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 5), inkC, { x: backX + 0.13, y: 4.85, z });

  // ---- 덩어리 마무리 ----
  const solidMat = keep(toonMat({ vertexColors: true, rim: 0 }));
  const shellMesh = new THREE.Mesh(keep(shell.build()), solidMat);
  group.add(shellMesh);
  const propsMat = keep(toonMat({ vertexColors: true, rim: 0.3 }));
  const propsMesh = new THREE.Mesh(keep(props.build()), propsMat);
  propsMesh.castShadow = true;
  propsMesh.receiveShadow = true;
  group.add(propsMesh);
  const far = new THREE.Group();
  far.add(new THREE.Mesh(keep(propsFar.build()), propsMat), new THREE.Mesh(keep(shellFar.build()), solidMat));
  far.add(new THREE.Mesh(keep(roof.build()), solidMat));
  far.visible = tier.name !== 'low';
  group.add(far);
  const glowMat = keep(new THREE.MeshBasicMaterial({ vertexColors: true, map: glassTex, fog: true }));
  group.add(new THREE.Mesh(keep(glow.build()), glowMat));
  far.add(new THREE.Mesh(keep(glowFar.build()), glowMat));
  {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(mix(inkC, wood, 0.3)), map: blobTex, opacity: 0.3, ...decalBase });
    addDecal(blobs.build(), m, -4.5, 1).receiveShadow = false;
  }

  // ---------------- 벽에 붙인 아이들 그림 ----------------
  {
    const artC = canvasOf(1024, 256);
    if (artC.ctx) drawKidArt(artC.ctx, 256);
    const artTex = keep(texOf(artC.canvas, aniso));
    const art = new Merger(true);
    const rnd = seeded(808);
    let k = 0;
    const pin = (x: number, y: number, z: number, onBack: boolean): void => {
      const i = k++ % 4;
      const g = new THREE.PlaneGeometry(1.02, 1.02);
      const U = g.getAttribute('uv');
      for (let v = 0; v < U.count; v++) U.setX(v, (U.getX(v) + i) / 4);
      art.add(g, '#ffffff', { x, y: y + (rnd() - 0.5) * 0.14, z, ry: onBack ? Math.PI / 2 : 0, rz: (rnd() - 0.5) * 0.16 });
    };
    for (const x of [11.4, 12.7, 14.0, 15.3, 16.6, 20.0, 21.3, 22.6, 23.9, 29.2, 30.5, 31.8]) pin(x, 3.05, -halfZ + 0.03, false);
    for (const z of [-7.5, 7.8]) pin(backX + 0.03, 3.2, z, true);
    const m = new THREE.Mesh(keep(art.build()), keep(toonMat({ map: artTex, alphaTest: 0.5 })));
    group.add(m);
  }

  // ---------------- 만국기(살랑살랑 흔들린다) ----------------
  {
    const bunting = new Merger(false, 3);
    const flagColors = [tok('--red'), tok('--yellow'), tok('--blue'), tok('--green'), tok('--pink'), tok('--sky')];
    let fi = 0;
    const tri = (a: number[], b: number[], c: number[], color: string, sx: number, sz: number, ph: number): void => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
      g.computeVertexNormals();
      bunting.add(g, color, undefined, [0, 0, 0]);
      // 꼭짓점마다 흔들림이 달라야 하므로(끝만 흔들린다) 방금 넣은 세 꼭짓점의 값을 직접 고친다.
      tipFix.push({ at: bunting.vertexCount - 1, sx, sz, ph });
    };
    const tipFix: { at: number; sx: number; sz: number; ph: number }[] = [];
    const cross = (x: number, yEnd: number, sag: number): void => {
      const n = 22;
      let prev: [number, number] | null = null;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const z = -halfZ + 0.3 + u * (halfZ * 2 - 0.6);
        const y = yEnd - sag * 4 * u * (1 - u);
        if (prev) {
          const len = Math.hypot(z - prev[0], y - prev[1]);
          bunting.add(new THREE.BoxGeometry(0.025, 0.025, len), inkC, { x, y: (y + prev[1]) / 2, z: (z + prev[0]) / 2, rx: -Math.atan2(y - prev[1], z - prev[0]) }, [0, 0, 0]);
          const zm = (prev[0] + z) / 2, ym = (prev[1] + y) / 2 - 0.01;
          tri([x, ym, zm - 0.33], [x, ym, zm + 0.33], [x, ym - 0.7, zm], flagColors[fi++ % flagColors.length]!, 0.2, 0.04, fi * 1.7);
        }
        prev = [z, y];
      }
    };
    for (const x of [-3, 5.5, 14, 22.5, 31, 39.5, 48]) cross(x, 9.15, 1.5 + (x % 3) * 0.12);
    {
      // 왼쪽 벽을 따라가는 줄(관람석 위)
      const z = -halfZ + 0.4;
      for (let seg = 0; seg < 6; seg++) {
        const xa = TRUSS.first - TRUSS.pitch + seg * TRUSS.pitch, xb = xa + TRUSS.pitch;
        const n = 9;
        let prev: [number, number] | null = null;
        for (let i = 0; i <= n; i++) {
          const u = i / n;
          const x = xa + (xb - xa) * u;
          const y = 4.52 - 0.42 * 4 * u * (1 - u);
          if (prev) {
            const len = Math.hypot(x - prev[0], y - prev[1]);
            bunting.add(new THREE.BoxGeometry(len, 0.02, 0.02), inkC, { x: (x + prev[0]) / 2, y: (y + prev[1]) / 2, z, rz: Math.atan2(y - prev[1], x - prev[0]) }, [0, 0, 0]);
            const xm = (prev[0] + x) / 2, ym = (prev[1] + y) / 2 - 0.01;
            tri([xm - 0.26, ym, z], [xm + 0.26, ym, z], [xm, ym - 0.54, z], flagColors[fi++ % flagColors.length]!, 0.03, 0.14, fi * 1.3);
          }
          prev = [x, y];
        }
      }
    }
    const geom = keep(bunting.build());
    const ex = geom.getAttribute('aExtra');
    for (const f of tipFix) ex.setXYZ(f.at, f.sx, f.sz, f.ph);
    const mat = keep(toonMat({ vertexColors: true, side: THREE.DoubleSide }));
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = timeU;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aExtra;\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          transformed.x += sin(uTime * 1.7 + aExtra.z) * aExtra.x;
          transformed.z += sin(uTime * 1.3 + aExtra.z * 1.7) * aExtra.y;`);
    };
    mat.customProgramCacheKey = () => 'gym-bunting';
    const m = new THREE.Mesh(geom, mat);
    m.frustumCulled = false;
    group.add(m);
  }

  // ---------------- 현수막(처진 천) ----------------
  const bannerC = canvasOf(1280, 200);
  if (bannerC.ctx) drawBanner(bannerC.ctx, 1280, 200);
  const bannerTex = keep(texOf(bannerC.canvas, aniso));
  const bannerMat = keep(toonMat({ map: bannerTex, alphaTest: 0.5 }));
  const bannerGeom = keep(new THREE.PlaneGeometry(7.68, 1.2, 24, 3));
  {
    const P = bannerGeom.getAttribute('position');
    for (let i = 0; i < P.count; i++) {
      const u = P.getX(i) / 3.84;
      P.setY(i, P.getY(i) - 0.16 * (1 - u * u) + Math.sin(u * 5) * 0.012);
      P.setZ(i, Math.sin(u * 7.5 + 0.6) * 0.035 + (1 - u * u) * 0.05);
    }
    bannerGeom.computeVertexNormals();
  }
  const mkBanner = (x: number, y: number, z: number, ry: number, s = 1): void => {
    const m = new THREE.Mesh(bannerGeom, bannerMat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.scale.setScalar(s);
    group.add(m);
  };
  mkBanner(backX + 0.2, 3.95, 0, Math.PI / 2);
  mkBanner(3.5, 3.12, -halfZ + 0.22, 0, 0.9);
  // 체육관을 가로질러 매단 현수막(앞뒤 양면)
  mkBanner(HANG_X - 0.02, 7.25, 0, -Math.PI / 2);
  mkBanner(HANG_X + 0.02, 7.25, 0, Math.PI / 2);

  // ---------------- 전광판 ----------------
  const BW = 512, BH = 256;
  const boardC = canvasOf(BW, BH);
  const boardLayers = makeBoardLayers(BW, BH);
  const boardTex = keep(texOf(boardC.canvas, aniso));
  const boardMat = keep(new THREE.MeshBasicMaterial({ map: boardTex }));
  const boardGeom = keep(new THREE.PlaneGeometry(3.4, 1.7));
  const frameGeom = keep((() => {
    const f = new Merger();
    f.add(rbox(3.74, 2.04, 0.24, 0.09), mix(inkC, tok('--blue'), 0.12), { z: -0.125 });
    f.add(rbox(3.9, 0.14, 0.34, 0.05, 1), tok('--yellow'), { y: 1.06, z: -0.1 });
    for (const sx of [-1.3, 1.3]) f.add(rbox(0.12, 0.3, 0.3, 0.04, 1), mix(inkC, wall, 0.3), { x: sx, y: -1.1, z: -0.14 });
    for (const sx of [-1.62, 1.62]) f.add(new THREE.SphereGeometry(0.06, 8, 6), tok('--red'), { x: sx, y: 1.14, z: 0.02 });
    return f.build();
  })());
  const frameMat = keep(toonMat({ vertexColors: true, rim: 0.3 }));
  const mkBoard = (x: number, y: number, z: number, ry: number, s: number): void => {
    const g = new THREE.Group();
    const scr = new THREE.Mesh(boardGeom, boardMat);
    scr.position.z = 0.002;
    g.add(new THREE.Mesh(frameGeom, frameMat), scr);
    g.position.set(x, y, z);
    g.rotation.y = ry;
    g.scale.setScalar(s);
    group.add(g);
  };
  mkBoard(backX + 0.3, 6.5, 0, Math.PI / 2, 1);
  mkBoard(8.75, 3.2, -halfZ + 0.4, 0, 0.74);
  mkBoard(26.75, 3.4, -halfZ + 0.4, 0, 0.8);

  let boardLabel = '', boardValue = '';
  const paintBoard = (): void => {
    if (!boardC.ctx) return;
    drawBoard(boardC.ctx, boardLayers, BW, BH, boardLabel, boardValue);
    boardTex.needsUpdate = true;
  };
  paintBoard();

  // ---------------- 빛: 창 빛무리, 빛줄기, 바닥의 햇빛 무늬 ----------------
  const fx = new THREE.Group();
  group.add(fx);
  {
    const D = SUN_DIR.clone().multiplyScalar(-1); // 빛이 나아가는 방향
    const kx = D.x / -D.y, kz = D.z / -D.y; // 높이 1 m 를 내려오는 동안 옆으로 가는 거리
    const floorHit = (x: number, y: number): [number, number, number] => [x + kx * y, 0.012, -halfZ + kz * y];
    const shaftC = canvasOf(64, 128);
    if (shaftC.ctx) drawShaft(shaftC.ctx, 64, 128);
    const shaftTex = keep(texOf(shaftC.canvas));
    const patchC = canvasOf(96, 144);
    if (patchC.ctx) drawSunPatch(patchC.ctx, 96, 144);
    const patchTex = keep(texOf(patchC.canvas, aniso));
    const haloTex = keep(radialTexture(64, 0.15, 1.5));
    const shafts = new Merger(true);
    const patches = new Merger(true);
    const halos = new Merger(true);
    const top = WIN.y0 + WIN.straight + WIN.hw - 0.2, bot = WIN.y0 + 0.2;
    for (const x of windowXs) {
      if (x < 62) halos.add(new THREE.PlaneGeometry(6.4, 8.4), '#ffffff', { x, y: 6.9, z: -halfZ + 0.3 });
      if (x < 62) halos.add(new THREE.PlaneGeometry(6.0, 8.0), '#9aa6b8', { x, y: 6.9, z: halfZ - 0.3, ry: Math.PI });
      if (x > 56) continue;
      // 바닥의 햇빛 무늬
      const p0 = floorHit(x - WIN.hw, WIN.y0), p1 = floorHit(x + WIN.hw, WIN.y0), p2 = floorHit(x + WIN.hw, top + 0.2), p3 = floorHit(x - WIN.hw, top + 0.2);
      patches.quad(p0, p1, p2, p3, '#ffffff', [0, 0, 1, 1]);
      if (x > 40) continue;
      // 빛줄기: 서로 엇갈린 두 장(어느 쪽에서 봐도 두께가 있어 보인다)
      const yc = (top + bot) / 2;
      const a0 = [x - WIN.hw, yc, -halfZ + 0.3], a1 = [x + WIN.hw, yc, -halfZ + 0.3];
      const f0 = floorHit(x - WIN.hw, yc), f1 = floorHit(x + WIN.hw, yc);
      shafts.quad(a0, a1, [f1[0], 0.05, f1[2]], [f0[0], 0.05, f0[2]], '#ffffff', [0, 0, 1, 1]);
      const b0 = [x, bot, -halfZ + 0.3], b1 = [x, top, -halfZ + 0.3];
      const g0 = floorHit(x, bot), g1 = floorHit(x, top);
      shafts.quad(b0, b1, [g1[0], 0.05, g1[2]], [g0[0], 0.05, g0[2]], '#ffffff', [0, 0, 1, 1]);
    }
    const add = (g: THREE.BufferGeometry, tex: THREE.Texture, opacity: number, color: string, order: number, vc = false): THREE.Mesh => {
      const mat = keep(new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(color), vertexColors: vc, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      const m = new THREE.Mesh(keep(g), mat);
      m.renderOrder = order;
      fx.add(m);
      return m;
    };
    add(halos.build(), haloTex, 0.3, '#ffe9b8', 5, true);
    {
      // 천장 조명의 빛무리
      const pts: number[] = [];
      for (let x = TRUSS.first; x < 62; x += TRUSS.pitch) for (const z of [-TRUSS.lampZ, TRUSS.lampZ]) pts.push(x, 8.3, z);
      const g = keep(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const pm = keep(new THREE.PointsMaterial({ map: haloTex, color: new THREE.Color('#ffe6a8'), size: 3.4, sizeAttenuation: true, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      const lampHalo = new THREE.Points(g, pm);
      lampHalo.renderOrder = 5;
      fx.add(lampHalo);
    }
    add(shafts.build(), shaftTex, 0.2, '#ffe6ae', 6);
    const pmat = add(patches.build(), patchTex, 0.34, '#ffd98f', -3.5).material as THREE.MeshBasicMaterial;
    pmat.polygonOffset = true;
    pmat.polygonOffsetFactor = -3;
    pmat.polygonOffsetUnits = -3;
  }
  fx.visible = tier.shafts;
  if (tier.name === 'low') for (const sw of swaps) sw.mesh.material = sw.flat;

  return {
    group,
    setBoard: (label, value) => {
      if (label === boardLabel && value === boardValue) return;
      boardLabel = label;
      boardValue = value;
      paintBoard();
    },
    redrawText: () => {
      if (bannerC.ctx) { drawBanner(bannerC.ctx, 1280, 200); bannerTex.needsUpdate = true; }
      if (atlasC.ctx) { drawAtlas(atlasC.ctx); atlasTex.needsUpdate = true; }
      paintBoard();
    },
    update: (timeS) => { timeU.value = timeS; },
    setTier: (t) => {
      fx.visible = t.shafts;
      far.visible = t.name !== 'low';
      for (const sw of swaps) sw.mesh.material = t.name === 'low' ? sw.flat : sw.lit;
      sheenU.value = t.floorSheen ? 1 : 0;
    },
    dispose: () => trash.dispose(),
  };
}
