/**
 * 블렌더 모델(kid.glb, referee.glb)의 얼굴 그림: 표정 8 가지 x (눈 뜸, 눈 감음)을 캔버스 한 장에 그린다.
 *
 * - 칸 배치와 표정 이름은 kid.ts 의 FACE_ATLAS 와 같다(표정을 바꾸는 쪽 코드는 그대로다).
 * - 한 칸의 논리 크기는 256 x 192. px 배율만큼 크게 그린다(가까이서 봐도 또렷하게: 높음/보통 1.5, 낮음 1).
 * - 그림은 머리의 굴곡을 따라 붙는다(tools/character/parts.py 의 face_uv). 볼 빨강의 자리는 조각한 볼의 한가운데다.
 * - 디자인: 색종이를 오려 붙인 듯한 또렷한 면. 눈은 위가 짙고 아래에 마룻바닥 빛이 비친 콩 모양,
 *   윗눈꺼풀은 가운데가 도톰하고 끝이 가는 초승달, 눈썹은 안쪽이 도톰한 붓 자국. 표정마다 좌우를 조금씩 다르게 그린다.
 */
import { tok } from '../lib/palette';
import { FACE_ATLAS } from './kid';
import type { Expr } from './kid';
import { canvasOf, mix } from './toon';

export interface FaceLook {
  kind: 'kid' | 'teacher';
  /** 눈썹 색 */
  brow: string;
  /** 그리는 배율(1 = 칸 256 x 192) */
  px: number;
  /** 눈 모양(내 캐릭터 꾸미기). 없으면 동글 눈 */
  eyes?: 'round' | 'sparkle' | 'sleepy' | 'upturned' | 'dot';
  /** 눈동자 색: 위, 가운데, 아래. 없으면 자두색 */
  iris?: { top: string; mid: string; low: string };
  /** 살빛(코 그늘을 살빛에 맞춘다). 없으면 기본 살구색 */
  skin?: string;
}

const W = 256, H = 192;
const INK = '#2a2142';
const INK_DEEP = '#191428';
const MOUTH_IN = '#9a3743';
const TONGUE = '#ff97a5';
const TEETH = '#fffdf6';

type Ctx = CanvasRenderingContext2D;

interface EyeOpts {
  rx: number; ry: number;
  /** 윗눈꺼풀이 내려온 정도(화소)와 기울기(+ 면 안쪽이 더 내려온다: 다부진 눈) */
  cut?: number; slope?: number;
  /** 아랫눈꺼풀이 올라온 정도(웃을 때 볼이 눈을 밀어 올린다) */
  lower?: number;
  /** 반짝임 크기 배율 */
  hl?: number;
  sparkle?: boolean;
  lash?: boolean;
  /** 눈동자 색(위, 가운데, 아래) */
  iris?: { top: string; mid: string; low: string };
  /** 눈동자 안의 별 반짝임(반짝 눈) */
  star?: boolean;
  /** 눈동자가 보는 쪽(화소) */
  look?: [number, number];
}

/** 뜬 눈. s: -1 = 그림의 왼쪽 눈, +1 = 오른쪽 눈 */
function eyeOpen(ctx: Ctx, x: number, y: number, s: number, o: EyeOpts): void {
  const { rx, ry } = o;
  const cut = o.cut ?? 0, slope = o.slope ?? 0, lower = o.lower ?? 0, hl = o.hl ?? 1;
  const [lx, ly] = o.look ?? [0, 0];
  const top = y - ry + cut;
  // 눈꺼풀 선의 양 끝 높이(안쪽, 바깥쪽)
  const yIn = top + slope, yOut = top - slope;
  const lidded = cut > 0 || slope !== 0;
  ctx.save();
  // 눈꺼풀 아래, 아랫눈꺼풀 위만 남긴다
  ctx.beginPath();
  if (lidded) {
    ctx.moveTo(x - s * (rx + 6), yIn);
    ctx.quadraticCurveTo(x, (yIn + yOut) / 2 - 2.5, x + s * (rx + 6), yOut);
  } else {
    ctx.moveTo(x - s * (rx + 6), y - ry - 6);
    ctx.lineTo(x + s * (rx + 6), y - ry - 6);
  }
  if (lower > 0) {
    ctx.lineTo(x + s * (rx + 6), y + ry - lower + 4);
    ctx.quadraticCurveTo(x, y + ry - lower - 4, x - s * (rx + 6), y + ry - lower + 4);
  } else {
    ctx.lineTo(x + s * (rx + 6), y + ry + 6);
    ctx.lineTo(x - s * (rx + 6), y + ry + 6);
  }
  ctx.closePath();
  ctx.clip();
  // 눈동자: 위는 짙은 남색, 가운데는 보라, 아래는 발그레한 자두색
  const g = ctx.createLinearGradient(0, y - ry, 0, y + ry);
  g.addColorStop(0, INK_DEEP);
  g.addColorStop(0.34, o.iris?.top ?? '#2c2148');
  g.addColorStop(0.72, o.iris?.mid ?? '#59397a');
  g.addColorStop(1, o.iris?.low ?? '#8a5488');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.clip();
  // 아래쪽에 비친 마룻바닥 빛(초승달)
  const g2 = ctx.createLinearGradient(0, y + ry * 0.3, 0, y + ry);
  g2.addColorStop(0, 'rgba(255,170,120,0)');
  g2.addColorStop(1, 'rgba(255,176,128,0.62)');
  ctx.fillStyle = g2;
  ctx.beginPath();
  ctx.ellipse(x + lx * 0.5, y + ry * 0.62, rx * 0.74, ry * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  // 동공: 위쪽에 붙은 짙은 방울
  ctx.fillStyle = 'rgba(14,10,26,0.5)';
  ctx.beginPath();
  ctx.ellipse(x + lx, y - ry * 0.16 + ly, rx * 0.46, ry * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  // 반짝임: 창에서 들어온 큰 빛(두 눈 모두 같은 쪽), 맞은편 아래의 작은 빛
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.36 + lx * 0.6, y - ry * 0.42 + ly * 0.6, rx * 0.38 * hl, ry * 0.27 * hl, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(x + rx * 0.4 + lx * 0.6, y + ry * 0.3 + ly * 0.6, rx * 0.15 * hl, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  if (o.star) {
    // 반짝 눈: 눈동자 아래쪽의 네 갈래 별 하나와 작은 빛 하나
    const sx = x + rx * 0.08 + lx * 0.5, sy = y + ry * 0.5 + ly * 0.5, r1 = rx * 0.34, r0 = rx * 0.1;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? r1 : r0;
      if (i === 0) ctx.moveTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r); else ctx.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - rx * 0.46 + lx * 0.5, y + ry * 0.24 + ly * 0.5, rx * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }
  // 눈동자 테두리: 아래쪽이 살빛에 묻히지 않게 가는 선으로 닫는다
  ctx.strokeStyle = 'rgba(30,22,52,0.85)';
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.ellipse(x, y, rx - 0.6, ry - 0.6, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // 윗눈꺼풀: 가운데가 도톰하고 양 끝이 가는 초승달. 바깥 끝은 살짝 길게 뺀다.
  ctx.fillStyle = INK_DEEP;
  ctx.beginPath();
  if (lidded) {
    const span = (yy: number): number => {
      // 타원의 그 높이에서의 반폭(눈꺼풀이 눈 밖으로 삐져나가지 않게)
      const k = Math.max(-1, Math.min(1, (yy - y) / ry));
      return rx * Math.sqrt(1 - k * k);
    };
    const xi = x - s * (span(yIn) + 1.5), xo = x + s * (span(yOut) + 4);
    ctx.moveTo(xi, yIn + 1);
    ctx.quadraticCurveTo(x, (yIn + yOut) / 2 - 7, xo, yOut - 1);
    ctx.quadraticCurveTo(x, (yIn + yOut) / 2 - 2, xi, yIn + 1);
  } else {
    // 바깥 호(조금 크고 위로 올라간 타원)와 안쪽 호(눈동자 윗선) 사이
    const aIn = s > 0 ? Math.PI * 1.1 : Math.PI * 1.9, aOut = s > 0 ? Math.PI * 1.97 : Math.PI * 1.03;
    ctx.ellipse(x, y - 0.6, rx + 2.2, ry + 2.6, 0, aIn, aOut, s < 0);
    ctx.lineTo(x + s * (rx + 5.2), y - ry * 0.3);
    ctx.ellipse(x, y + 1.2, rx + 0.6, ry + 0.2, 0, aOut, aIn, s > 0);
  }
  ctx.closePath();
  ctx.fill();
  // 속눈썹(어른만)
  if (o.lash) {
    ctx.strokeStyle = INK_DEEP;
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(x + s * (rx - 2.5), y - ry * 0.8 + cut * 0.6);
    ctx.lineTo(x + s * (rx + 2.5), y - ry * 1.16 + cut * 0.6);
    ctx.stroke();
  }
  if (o.sparkle) {
    // 네 갈래 반짝이
    const sx = x + s * (rx + 10), sy = y - ry - 3;
    ctx.fillStyle = tok('--yellow');
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? 7.5 : 2.5;
      const px = sx + Math.cos(a) * r, py = sy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/** 감은 눈(깜빡임): 아래로 둥근 선 하나 + 바깥 끝의 짧은 속눈썹 */
function eyeClosed(ctx: Ctx, x: number, y: number, s: number, rx: number, lash: boolean): void {
  ctx.strokeStyle = INK_DEEP;
  ctx.lineCap = 'round';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x - s * (rx + 0.5), y + 3);
  ctx.quadraticCurveTo(x, y + 13.5, x + s * (rx + 1.5), y + 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + s * (rx + 1), y + 3);
  ctx.lineTo(x + s * (rx + 6), y + 6.5);
  if (lash) {
    ctx.moveTo(x + s * (rx - 5), y + 7.5);
    ctx.lineTo(x + s * (rx - 2), y + 12.5);
  }
  ctx.stroke();
}

/** 붓 자국 눈썹: (x0, y0) 안쪽 끝에서 (x1, y1) 바깥 끝까지, 가운데가 bow 만큼 솟는다. 안쪽이 도톰하다. */
function brow(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, bow: number, t0: number, t1: number, color: string): void {
  const n = 10;
  const up: [number, number][] = [], dn: [number, number][] = [];
  const cxm = (x0 + x1) / 2, cym = (y0 + y1) / 2 - bow;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const px = (1 - u) * (1 - u) * x0 + 2 * u * (1 - u) * cxm + u * u * x1;
    const py = (1 - u) * (1 - u) * y0 + 2 * u * (1 - u) * cym + u * u * y1;
    const dx = 2 * (1 - u) * (cxm - x0) + 2 * u * (x1 - cxm);
    const dy = 2 * (1 - u) * (cym - y0) + 2 * u * (y1 - cym);
    const L = Math.hypot(dx, dy) || 1;
    // 안쪽 끝은 둥글게 시작해서 바깥으로 갈수록 가늘어진다
    const t = (t0 + (t1 - t0) * u) * Math.min(1, 0.55 + u * 4) * 0.5;
    up.push([px - (dy / L) * t, py + (dx / L) * t]);
    dn.push([px + (dy / L) * t, py - (dx / L) * t]);
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(up[0]![0], up[0]![1]);
  for (const p of up) ctx.lineTo(p[0], p[1]);
  for (const p of dn.reverse()) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

function drawFace(ctx: Ctx, expr: Expr, blink: boolean, st: FaceLook): void {
  const kid = st.kind === 'kid';
  const cx = W / 2;
  const eyeY = kid ? 110 : 106;
  const ex = kid ? 42 : 37;
  const style = st.eyes ?? 'round';
  const dot = style === 'dot';
  // 콩알 눈은 훨씬 작다. 그 밖의 눈 모양은 같은 크기에서 눈꺼풀과 반짝임만 다르다.
  const rx = dot ? 9.5 : kid ? 18 : 12, ry = dot ? 11.5 : kid ? 24 : 15.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // ---- 볼 빨강: 조각한 볼 한가운데(parts.py 가 계산해 알려 준 자리). 크레파스로 칠한 듯한 빗금 세 줄.
  const bx = kid ? 67 : 60, by = kid ? 132 : 128;
  const blushA = expr === 'joy' ? 0.78 : expr === 'effort' ? 0.82 : expr === 'oops' ? 0.4 : expr === 'smile' ? 0.66 : 0.56;
  for (const s of [-1, 1]) {
    const g = ctx.createRadialGradient(cx + s * bx, by, 1, cx + s * bx, by, 25);
    g.addColorStop(0, `rgba(255,112,126,${blushA * (kid ? 1 : 0.7)})`);
    g.addColorStop(0.55, `rgba(255,120,132,${blushA * 0.5 * (kid ? 1 : 0.7)})`);
    g.addColorStop(1, 'rgba(255,128,138,0)');
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(cx + s * bx, by);
    ctx.scale(1, 0.62);
    ctx.beginPath();
    ctx.arc(0, 0, 25, 0, Math.PI * 2);
    ctx.translate(-(cx + s * bx), -by);
    ctx.fill();
    ctx.restore();
    if (kid) {
      ctx.strokeStyle = `rgba(238,92,112,${0.34 + blushA * 0.3})`;
      ctx.lineWidth = 2.1;
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        const hx = cx + s * bx + i * 6.5;
        ctx.moveTo(hx + 2.2, by - 4.2 + Math.abs(i));
        ctx.lineTo(hx - 2.2, by + 4.2 - Math.abs(i));
      }
      ctx.stroke();
    }
  }

  // ---- 코: 콧등 밑의 아주 옅은 그늘
  ctx.strokeStyle = st.skin ? noseShade(st.skin) : 'rgba(206,112,92,0.42)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  const ny = kid ? 131 : 126;
  ctx.moveTo(cx - 3.2, ny);
  ctx.quadraticCurveTo(cx + 0.3, ny + 2.7, cx + 3.4, ny - 0.3);
  ctx.stroke();

  // ---- 눈
  type EyeKind = 'open' | 'closed' | 'happy' | 'squeeze' | 'wide';
  const kindOf: EyeKind = expr === 'joy' ? 'happy' : expr === 'effort' ? 'squeeze' : blink ? 'closed' : expr === 'oops' ? 'wide' : 'open';
  for (const s of [-1, 1]) {
    const x = cx + s * ex, y = eyeY;
    if (kindOf === 'closed') {
      eyeClosed(ctx, x, y + (expr === 'wow' ? 1 : 0), s, rx - 1, !kid);
    } else if (kindOf === 'happy') {
      // 활짝 웃는 눈: 위로 둥근 도톰한 선. 한쪽을 살짝 더 높이 그린다.
      const lift = s > 0 ? -1.5 : 0;
      ctx.strokeStyle = INK_DEEP;
      ctx.lineWidth = 6.4;
      ctx.beginPath();
      ctx.moveTo(x - (rx - 1), y + 7 + lift);
      ctx.quadraticCurveTo(x, y - ry * 0.95 + lift, x + (rx - 1), y + 7 + lift);
      ctx.stroke();
      if (!kid) {
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + s * (rx - 1), y + 5 + lift);
        ctx.lineTo(x + s * (rx + 5), y + 1 + lift);
        ctx.stroke();
      }
    } else if (kindOf === 'squeeze') {
      // 꽉 감은 눈: 안쪽을 향한 꺾쇠. 꺾쇠 끝이 살짝 벌어져 힘이 들어간 느낌.
      ctx.strokeStyle = INK_DEEP;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x + s * (rx - 2), y - 10);
      ctx.lineTo(x - s * (rx - 5), y + (s > 0 ? 0 : 1));
      ctx.lineTo(x + s * (rx - 2), y + 9);
      ctx.stroke();
    } else if (kindOf === 'wide') {
      // 깜짝 놀란 눈: 흰자 속의 작은 눈동자(아래를 본다)
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = INK_DEEP;
      ctx.lineWidth = 4.4;
      ctx.beginPath();
      ctx.ellipse(x, y - 1, dot ? 14 : rx - 0.5, dot ? 17 : ry - 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK_DEEP;
      ctx.beginPath();
      ctx.ellipse(x - s * 1.5 + 1, y + 2.5, 5.6, 6.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x - s * 1.5 - 1, y, 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const o: EyeOpts = { rx, ry, lash: !kid };
      if (expr === 'smile') { o.lower = 2.5; o.hl = 1.08; }
      else if (expr === 'focus') { o.cut = 6.5; o.slope = 1.2; o.look = [2, 1]; }
      else if (expr === 'grit') { o.cut = 5.5; o.slope = 3.4; }
      else if (expr === 'wow') { o.rx = rx + 1.5; o.ry = ry + 2.2; o.hl = 1.22; o.sparkle = s > 0; }
      else if (expr === 'neutral') { o.hl = 1; }
      o.iris = st.iris;
      if (style === 'sparkle') { o.rx = (o.rx ?? rx) + 1; o.ry = (o.ry ?? ry) + 1; o.hl = (o.hl ?? 1) * 1.16; o.star = true; o.lash = true; }
      else if (style === 'sleepy') { o.cut = (o.cut ?? 0) + 8; o.slope = (o.slope ?? 0) * 0.6 - 1.4; o.lower = Math.max(o.lower ?? 0, 1.5); }
      else if (style === 'upturned') { o.cut = (o.cut ?? 0) + 2.5; o.slope = (o.slope ?? 0) + 2.4; o.lash = true; }
      else if (dot) { o.cut = (o.cut ?? 0) * 0.45; o.slope = (o.slope ?? 0) * 0.5; o.lower = (o.lower ?? 0) * 0.4; if (o.rx !== rx) { o.rx = rx + 1; o.ry = ry + 1.2; } }
      if (dot) {
        // 콩알 눈: 작은 눈이 짙은 살빛에 묻히지 않게 옅은 흰 테를 먼저 깐다
        ctx.fillStyle = 'rgba(255,253,246,0.62)';
        ctx.beginPath();
        ctx.ellipse(x, y + 0.5, (o.rx ?? rx) + 2.4, (o.ry ?? ry) + 2.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      eyeOpen(ctx, x, y, s, o);
    }
  }

  // ---- 눈썹: 표정을 가장 크게 좌우한다. (안쪽 끝 높이, 바깥 끝 높이, 휜 정도) + 좌우 차이
  const browY = eyeY - ry - (kid ? 12.5 : 13) + (dot ? 5 : 0);
  const bt0 = kid ? 5.4 : 3.8, bt1 = kid ? 2.8 : 2;
  const B = (s: number, inner: number, outer: number, bow: number, lift: number): void => {
    brow(ctx, cx + s * (ex - 11), browY + inner + lift, cx + s * (ex + 13), browY + outer + lift, bow, bt0, bt1, st.brow);
  };
  if (expr === 'focus') { B(-1, 6.5, -1.5, 2, 3); B(1, 5, -2.5, 2, 1.5); }
  else if (expr === 'grit') { B(-1, 8, -3, 1.5, 3.5); B(1, 6.5, -4.5, 2, 1.5); }
  else if (expr === 'effort') { B(-1, 10, -3, 0.5, 6); B(1, 11, -2, 0.5, 6.5); }
  else if (expr === 'oops') { B(-1, -6, 5, 2.5, -1); B(1, -8, 4, 2.5, -2.5); }
  else if (expr === 'joy') { B(-1, 1, 2, 5, -3.5); B(1, 0, 1, 5.5, -5.5); }
  else if (expr === 'wow') { B(-1, -1, 2, 5.5, -5); B(1, -2, 1, 6, -7); }
  else if (expr === 'smile') { B(-1, 0, 2, 4, -1); B(1, -0.5, 1.5, 4.5, -2.5); }
  else { B(-1, 0, 2.5, 3.5, 0); B(1, 0, 2, 3.5, -1); }

  // ---- 입: 작고 또렷한 모양 몇 가지
  const my = kid ? 151 : 143;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4.4;
  if (expr === 'neutral') {
    ctx.beginPath();
    ctx.moveTo(cx - 8.5, my - 1.5);
    ctx.quadraticCurveTo(cx + 1, my + 6.5, cx + 10, my - 2.5);
    ctx.stroke();
  } else if (expr === 'smile') {
    // 입꼬리가 올라간 미소(한쪽이 살짝 더 올라간다)
    ctx.beginPath();
    ctx.moveTo(cx - 15.5, my - 6);
    ctx.bezierCurveTo(cx - 10, my + 9, cx + 9, my + 11, cx + 17, my - 8);
    ctx.stroke();
    if (!kid) {
      ctx.strokeStyle = 'rgba(214,92,96,0.5)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(cx - 6, my + 9.5);
      ctx.quadraticCurveTo(cx, my + 12, cx + 6, my + 9.5);
      ctx.stroke();
    }
  } else if (expr === 'joy') {
    // 활짝 벌린 입: 윗니 한 줄과 혀
    ctx.fillStyle = MOUTH_IN;
    ctx.beginPath();
    ctx.moveTo(cx - 18, my - 8);
    ctx.quadraticCurveTo(cx, my - 3.5, cx + 19, my - 9.5);
    ctx.quadraticCurveTo(cx + 17, my + 17, cx + 0.5, my + 18);
    ctx.quadraticCurveTo(cx - 15.5, my + 17, cx - 18, my - 8);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = TONGUE;
    ctx.beginPath();
    ctx.ellipse(cx + 1.5, my + 17.5, 11.5, 8.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = TEETH;
    ctx.beginPath();
    ctx.moveTo(cx - 20, my - 12);
    ctx.lineTo(cx + 21, my - 12);
    ctx.lineTo(cx + 21, my - 3.5);
    ctx.quadraticCurveTo(cx, my + 2.5, cx - 20, my - 2.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.stroke();
  } else if (expr === 'focus') {
    // 한쪽으로 야무지게 다문 입 + 입꼬리에서 살짝 나온 혀
    ctx.fillStyle = TONGUE;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.ellipse(cx + 11.5, my + 3.5, 6.2, 6.8, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 4.4;
    ctx.beginPath();
    ctx.moveTo(cx - 9, my + 0.5);
    ctx.quadraticCurveTo(cx, my - 2.5, cx + 9.5, my - 1.5);
    ctx.stroke();
  } else if (expr === 'effort') {
    // 이를 악문 입(살짝 비뚤어진 둥근 네모)
    ctx.save();
    ctx.translate(cx + 0.5, my);
    ctx.rotate(-0.07);
    ctx.fillStyle = TEETH;
    ctx.beginPath();
    ctx.moveTo(-17, -8);
    ctx.quadraticCurveTo(0, -5, 17, -9);
    ctx.quadraticCurveTo(21, 0, 16, 8.5);
    ctx.quadraticCurveTo(0, 10.5, -15.5, 8);
    ctx.quadraticCurveTo(-20.5, 0, -17, -8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-17.5, 0.5);
    ctx.quadraticCurveTo(0, 2.5, 18, 0);
    ctx.moveTo(-6, -6);
    ctx.lineTo(-6, 9);
    ctx.moveTo(6.5, -6.5);
    ctx.lineTo(6.5, 9);
    ctx.stroke();
    ctx.restore();
  } else if (expr === 'oops') {
    // 꾸불꾸불한 입 + 눈 옆의 땀방울
    ctx.beginPath();
    ctx.moveTo(cx - 14, my + 2);
    ctx.bezierCurveTo(cx - 9, my - 6.5, cx - 5, my - 6.5, cx - 1, my + 1);
    ctx.bezierCurveTo(cx + 2.5, my + 7.5, cx + 7, my + 7.5, cx + 10, my + 1);
    ctx.quadraticCurveTo(cx + 12, my - 3, cx + 15, my - 1.5);
    ctx.stroke();
    ctx.fillStyle = tok('--sky');
    ctx.lineWidth = 2.8;
    const dx = cx + ex + rx + 15, dy = eyeY - 20;
    ctx.beginPath();
    ctx.moveTo(dx, dy);
    ctx.quadraticCurveTo(dx + 10.5, dy + 17, dx, dy + 23.5);
    ctx.quadraticCurveTo(dx - 10.5, dy + 17, dx, dy);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(dx - 2.5, dy + 15, 1.8, 3.2, 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (expr === 'wow') {
    // 작은 동그란 입
    ctx.fillStyle = MOUTH_IN;
    ctx.beginPath();
    ctx.ellipse(cx + 1, my + 2.5, 7.2, 9, 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = TONGUE;
    ctx.beginPath();
    ctx.ellipse(cx + 1.5, my + 11.5, 6, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.stroke();
  } else {
    // grit: 한쪽 입꼬리를 올린 다부진 웃음(이가 살짝 보인다)
    ctx.fillStyle = TEETH;
    ctx.beginPath();
    ctx.moveTo(cx - 13.5, my - 1);
    ctx.quadraticCurveTo(cx + 2, my - 2, cx + 16.5, my - 8.5);
    ctx.quadraticCurveTo(cx + 9, my + 12, cx - 13.5, my - 1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(cx + 20, my - 13);
    ctx.quadraticCurveTo(cx + 22.5, my - 9.5, cx + 20.5, my - 6);
    ctx.stroke();
  }
}

/** 코 밑 그늘: 살빛보다 조금 짙고 붉은 색 */
function noseShade(skin: string): string {
  const h = skin.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${Math.round(c[0]! * 0.8)},${Math.round(c[1]! * 0.52)},${Math.round(c[2]! * 0.5)},0.45)`;
}

/** 표정 묶음 그림. 칸 배치는 FACE_ATLAS(kid.ts) 와 같다. */
export function makeFaceAtlas2(st: FaceLook): HTMLCanvasElement {
  const { exprs, cols, rows } = FACE_ATLAS;
  const { canvas, ctx } = canvasOf(Math.round(W * cols * st.px), Math.round(H * rows * st.px));
  if (ctx) {
    ctx.scale(st.px, st.px);
    exprs.forEach((e, i) => {
      for (const blink of [false, true]) {
        const cell = i * 2 + (blink ? 1 : 0);
        ctx.save();
        ctx.translate((cell % cols) * W, Math.floor(cell / cols) * H);
        ctx.beginPath();
        ctx.rect(0, 0, W, H);
        ctx.clip();
        drawFace(ctx, e, blink, st);
        ctx.restore();
      }
    });
  }
  return canvas;
}

/** 표정 한 칸만 그린 작은 그림(꾸미기 화면의 눈 모양 단추). 바탕은 투명하다. */
export function makeFaceCell(st: FaceLook, expr: Expr = 'smile'): HTMLCanvasElement {
  const { canvas, ctx } = canvasOf(Math.round(W * st.px), Math.round(H * st.px));
  if (ctx) {
    ctx.scale(st.px, st.px);
    drawFace(ctx, expr, false, st);
  }
  return canvas;
}

/** 눈썹 색: 머리카락보다 살짝 짙게 */
export const browOf = (hair: string): string => mix(hair, tok('--ink'), 0.12);
