/**
 * 둥글둥글한 2.4등신 캐릭터(아이, 심판 선생님)와 그 움직임.
 *
 * 생김새: 큰 머리, 작은 몸, 벙어리장갑 손, 짧은 다리와 운동화. 얼굴은 캔버스에 직접 그린 표정 묶음(눈, 눈썹, 입, 볼).
 * 관절은 캡슐을 이어 붙여 매끈하게 보이고, 팔은 손이 가야 할 곳을 주면 팔꿈치가 알아서 굽는다(두 마디 IK).
 * 다리는 발을 바닥에 붙인 채 몸이 움직이는 만큼 늘고 준다(만화 같은 눌림과 늘어남).
 *
 * 좌표(캐릭터 기준): +X 앞, +Y 위, +Z 오른쪽. 크기는 키 1 을 기준으로 만들고 통째로 키운다.
 */
import * as THREE from 'three';
import { tok } from '../lib/palette';
import { canvasOf, capsuleY, Merger, mix, outlineMat, roundRect, smoothLathe, texOf, toonMat, Trash } from './toon';

// ---------------------------------------------------------------------------
// 표정
// ---------------------------------------------------------------------------
export type Expr = 'neutral' | 'smile' | 'focus' | 'effort' | 'joy' | 'oops' | 'wow' | 'grit';
const EXPRS: Expr[] = ['neutral', 'smile', 'focus', 'effort', 'joy', 'oops', 'wow', 'grit'];
const CELL_W = 256, CELL_H = 192, COLS = 4, ROWS = 4;
/** 표정 그림을 그리는 배율(가까이서 봐도 또렷하게) */
const FACE_PX = 1.25;

export interface FaceStyle { glasses: boolean; brow: string; lash: boolean }

function drawFace(ctx: CanvasRenderingContext2D, expr: Expr, blink: boolean, st: FaceStyle): void {
  const eyeInk = '#33264a';
  const cx = CELL_W / 2, cy = 102;
  const ex = 37;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 볼 빨강
  const blushA = expr === 'joy' ? 0.7 : expr === 'effort' ? 0.75 : 0.5;
  for (const s of [-1, 1]) {
    const g = ctx.createRadialGradient(cx + s * 58, cy + 30, 1, cx + s * 58, cy + 30, 19);
    g.addColorStop(0, `rgba(255,120,130,${blushA})`);
    g.addColorStop(1, 'rgba(255,120,130,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx + s * 58, cy + 30, 19, 12, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 눈
  const eyeStyle: string = blink ? 'closed' : expr === 'joy' ? 'happy' : expr === 'effort' ? 'squeeze' : expr === 'oops' ? 'wide' : 'open';
  for (const s of [-1, 1]) {
    const x = cx + s * ex, y = cy;
    ctx.strokeStyle = eyeInk;
    ctx.fillStyle = eyeInk;
    if (eyeStyle === 'closed') {
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      ctx.moveTo(x - 12, y + 2);
      ctx.quadraticCurveTo(x, y + 11, x + 12, y + 2);
      ctx.stroke();
    } else if (eyeStyle === 'happy') {
      ctx.lineWidth = 6.5;
      ctx.beginPath();
      ctx.moveTo(x - 13, y + 6);
      ctx.quadraticCurveTo(x, y - 14, x + 13, y + 6);
      ctx.stroke();
    } else if (eyeStyle === 'squeeze') {
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x - s * 12, y - 9);
      ctx.lineTo(x + s * 9, y);
      ctx.lineTo(x - s * 12, y + 9);
      ctx.stroke();
    } else if (eyeStyle === 'wide') {
      ctx.fillStyle = '#ffffff';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.ellipse(x, y - 2, 14, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = eyeInk;
      ctx.beginPath();
      ctx.arc(x, y, 5.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 크고 동그란 눈: 위는 짙고 아래는 보랏빛, 반짝이는 점 두 개
      const g = ctx.createLinearGradient(0, y - 19, 0, y + 19);
      g.addColorStop(0, '#231a36');
      g.addColorStop(0.55, eyeInk);
      g.addColorStop(1, '#7a5590');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, 13.5, 18.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(x - 4.5, y - 7.5, 5.6, 6.4, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + 5, y + 8, 2.8, 0, Math.PI * 2);
      ctx.fill();
      // 윗눈꺼풀 선
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#231a36';
      ctx.beginPath();
      ctx.moveTo(x - 14.5, y - 9);
      ctx.quadraticCurveTo(x, y - 24, x + 14.5, y - 9);
      ctx.stroke();
      if (st.lash) {
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(x + s * 10, y - 12);
        ctx.lineTo(x + s * 17, y - 17);
        ctx.stroke();
      }
    }
  }
  if (st.glasses) {
    ctx.strokeStyle = tok('--ink');
    ctx.lineWidth = 4;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + s * ex, cy + 1, 24, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - ex + 24, cy);
    ctx.quadraticCurveTo(cx, cy - 7, cx + ex - 24, cy);
    ctx.stroke();
  }

  // 눈썹
  ctx.strokeStyle = st.brow;
  ctx.lineWidth = 5;
  const brow = (s: number, inner: number, outer: number, lift: number): void => {
    const x0 = cx + s * (ex - 11), x1 = cx + s * (ex + 12);
    ctx.beginPath();
    ctx.moveTo(x0, cy - 35 + inner + lift);
    ctx.quadraticCurveTo((x0 + x1) / 2, cy - 40 + (inner + outer) / 2 + lift, x1, cy - 35 + outer + lift);
    ctx.stroke();
  };
  for (const s of [-1, 1]) {
    if (expr === 'focus' || expr === 'grit') brow(s, 6, -4, 1);
    else if (expr === 'effort') brow(s, 9, -4, 3);
    else if (expr === 'oops') brow(s, -6, 4, -2);
    else if (expr === 'joy' || expr === 'wow') brow(s, 0, 1, -7);
    else brow(s, 0, 1, 0);
  }

  // 입
  const my = cy + 40;
  ctx.strokeStyle = eyeInk;
  ctx.lineWidth = 4.5;
  const mouthIn = '#8a2f3a', tongue = '#ff8fa0';
  if (expr === 'neutral') {
    ctx.beginPath();
    ctx.moveTo(cx - 10, my - 2);
    ctx.quadraticCurveTo(cx, my + 7, cx + 10, my - 2);
    ctx.stroke();
  } else if (expr === 'smile') {
    ctx.beginPath();
    ctx.moveTo(cx - 16, my - 4);
    ctx.quadraticCurveTo(cx, my + 12, cx + 16, my - 4);
    ctx.stroke();
  } else if (expr === 'joy') {
    ctx.fillStyle = mouthIn;
    ctx.beginPath();
    ctx.moveTo(cx - 19, my - 7);
    ctx.quadraticCurveTo(cx, my - 3, cx + 19, my - 7);
    ctx.quadraticCurveTo(cx + 15, my + 19, cx, my + 19);
    ctx.quadraticCurveTo(cx - 15, my + 19, cx - 19, my - 7);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = tongue;
    ctx.beginPath();
    ctx.ellipse(cx, my + 18, 11, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.stroke();
  } else if (expr === 'focus') {
    ctx.beginPath();
    ctx.moveTo(cx - 9, my);
    ctx.lineTo(cx + 7, my);
    ctx.stroke();
    // 혀를 살짝 내민다
    ctx.fillStyle = tongue;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.ellipse(cx + 9, my + 5, 6, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (expr === 'effort') {
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, cx - 15, my - 8, 30, 15, 6);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 14, my);
    ctx.lineTo(cx + 14, my);
    ctx.moveTo(cx, my - 7);
    ctx.lineTo(cx, my + 7);
    ctx.stroke();
  } else if (expr === 'oops') {
    ctx.beginPath();
    ctx.moveTo(cx - 13, my + 2);
    ctx.quadraticCurveTo(cx - 6, my - 6, cx, my + 2);
    ctx.quadraticCurveTo(cx + 6, my + 9, cx + 13, my + 1);
    ctx.stroke();
    // 땀방울
    ctx.fillStyle = tok('--sky');
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx + 88, cy - 52);
    ctx.quadraticCurveTo(cx + 99, cy - 34, cx + 88, cy - 28);
    ctx.quadraticCurveTo(cx + 77, cy - 34, cx + 88, cy - 52);
    ctx.fill();
    ctx.stroke();
  } else if (expr === 'wow') {
    ctx.fillStyle = mouthIn;
    ctx.beginPath();
    ctx.ellipse(cx, my + 3, 8.5, 10.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    // grit: 한쪽 입꼬리를 올린 다부진 웃음
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx - 15, my - 5);
    ctx.quadraticCurveTo(cx, my - 1, cx + 15, my - 5);
    ctx.quadraticCurveTo(cx, my + 15, cx - 15, my - 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/** 표정 묶음의 칸 배치(kidGlb.ts 가 같은 그림을 쓴다) */
export const FACE_ATLAS = { exprs: EXPRS, cols: COLS, rows: ROWS } as const;

export function makeFaceAtlas(st: FaceStyle): HTMLCanvasElement {
  const { canvas, ctx } = canvasOf(CELL_W * COLS * FACE_PX, CELL_H * ROWS * FACE_PX);
  if (ctx) {
    ctx.scale(FACE_PX, FACE_PX);
    EXPRS.forEach((e, i) => {
      for (const blink of [false, true]) {
        const cell = i * 2 + (blink ? 1 : 0);
        ctx.save();
        ctx.translate((cell % COLS) * CELL_W, Math.floor(cell / COLS) * CELL_H);
        ctx.beginPath();
        ctx.rect(0, 0, CELL_W, CELL_H);
        ctx.clip();
        drawFace(ctx, e, blink, st);
        ctx.restore();
      }
    });
  }
  return canvas;
}

// ---------------------------------------------------------------------------
// 몸
// ---------------------------------------------------------------------------
export interface ChibiLook {
  kind: 'kid' | 'teacher';
  /** 통째로 키우는 배율(키 1 기준) */
  scale: number;
  skin: string;
  hair: string;
  top: string;
  bottom: string;
  shoe: string;
  cap: string | null;
  /** 이름표에 쓰는 글자(없으면 이름표 없음) */
  tag: string | null;
}

interface Dims { hip: number; hipZ: number; sh: number; shZ: number; neck: number; headUp: number; headR: number; upper: number; fore: number; armR: number; legR: number; bodyR: number; footZ: number }

const KID_DIMS: Dims = { hip: 0.25, hipZ: 0.062, sh: 0.515, shZ: 0.118, neck: 0.555, headUp: 0.2, headR: 0.205, upper: 0.17, fore: 0.165, armR: 0.04, legR: 0.047, bodyR: 1, footZ: 0.075 };
const TEACHER_DIMS: Dims = { hip: 0.43, hipZ: 0.06, sh: 0.755, shZ: 0.128, neck: 0.8, headUp: 0.165, headR: 0.17, upper: 0.2, fore: 0.19, armR: 0.04, legR: 0.05, bodyR: 1.02, footZ: 0.075 };

export interface Pose {
  hop: number; facing: number;
  bx: number; by: number; bz: number;
  lean: number; twist: number; roll: number; squash: number;
  hy: number; hp: number; ht: number;
  rhx: number; rhy: number; rhz: number;
  lhx: number; lhy: number; lhz: number;
  rfx: number; rfy: number; rfz: number; rfp: number;
  lfx: number; lfy: number; lfz: number; lfp: number;
}
const POSE_KEYS: (keyof Pose)[] = ['hop', 'facing', 'bx', 'by', 'bz', 'lean', 'twist', 'roll', 'squash', 'hy', 'hp', 'ht', 'rhx', 'rhy', 'rhz', 'lhx', 'lhy', 'lhz', 'rfx', 'rfy', 'rfz', 'rfp', 'lfx', 'lfy', 'lfz', 'lfp'];

function restPose(d: Dims): Pose {
  return {
    hop: 0, facing: 0, bx: 0, by: 0, bz: 0, lean: 0, twist: 0, roll: 0, squash: 1, hy: 0, hp: 0, ht: 0,
    rhx: 0.03, rhy: d.sh - d.upper - d.fore + 0.03, rhz: d.shZ + 0.075,
    lhx: 0.03, lhy: d.sh - d.upper - d.fore + 0.03, lhz: -d.shZ - 0.075,
    rfx: 0, rfy: 0, rfz: d.footZ, rfp: 0,
    lfx: 0, lfy: 0, lfz: -d.footZ, lfp: 0,
  };
}

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _mm = new THREE.Matrix4();

/** from 에서 to 를 향하도록 놓는다(물체의 +Y 가 그 방향). hint 는 비틀림을 정하는 기준 방향. */
function aimLimb(mesh: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, hint: THREE.Vector3, baseLen = 0): void {
  mesh.position.copy(from);
  _y.copy(to).sub(from);
  const len = _y.length();
  if (len < 1e-6) return;
  _y.multiplyScalar(1 / len);
  _x.copy(hint).addScaledVector(_y, -hint.dot(_y));
  if (_x.lengthSq() < 1e-6) _x.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _x.normalize();
  _z.crossVectors(_x, _y);
  _mm.makeBasis(_x, _y, _z);
  mesh.quaternion.setFromRotationMatrix(_mm);
  if (baseLen > 0) mesh.scale.y = len / baseLen;
}

/** 두 마디 IK: 어깨 S, 손 목표 T, 마디 길이 a, b. 팔꿈치 위치를 elbow 에, 실제 손 위치를 hand 에 넣는다. */
function solveArm(S: THREE.Vector3, T: THREE.Vector3, a: number, b: number, hint: THREE.Vector3, elbow: THREE.Vector3, hand: THREE.Vector3): void {
  _a.copy(T).sub(S);
  let L = _a.length();
  if (L < 1e-5) { _a.set(0, -1, 0); L = 1e-5; }
  _a.multiplyScalar(1 / L);
  L = Math.min(a + b - 0.002, Math.max(Math.abs(a - b) + 0.002, L));
  const x = (a * a - b * b + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  _b.copy(hint).addScaledVector(_a, -hint.dot(_a));
  if (_b.lengthSq() < 1e-6) _b.set(0, 0, 1).addScaledVector(_a, -_a.z);
  _b.normalize();
  elbow.copy(S).addScaledVector(_a, x).addScaledVector(_b, h);
  hand.copy(S).addScaledVector(_a, L);
}

export interface Chibi {
  root: THREE.Group;
  dims: Dims;
  look: ChibiLook;
  rest: Pose;
  /** 자세를 그대로 적용한다(부드럽게 잇는 일은 부르는 쪽이 한다). */
  apply: (p: Pose) => void;
  setFace: (e: Expr, blink: boolean) => void;
  setOutline: (on: boolean) => void;
  /** 서 있는 바닥의 높이(발판 위에 설 때) */
  setBaseY: (y: number) => void;
  redrawText: () => void;
  /** 방금 적용한 자세에서의 오른손, 머리 가운데(세계 좌표) */
  handR: THREE.Vector3;
  handL: THREE.Vector3;
  headPos: THREE.Vector3;
  /** 세계 좌표의 점을 캐릭터 기준 좌표로 */
  toLocal: (world: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3;
  dispose: () => void;
}

export function buildChibi(look: ChibiLook): Chibi {
  const trash = new Trash();
  const keep = <T extends { dispose: () => void }>(x: T): T => trash.keep(x);
  const d = look.kind === 'kid' ? KID_DIMS : TEACHER_DIMS;
  const kid = look.kind === 'kid';
  const paper = tok('--paper'), inkC = tok('--ink');
  const skin = look.skin, skinShade = mix(skin, tok('--pink'), 0.25);

  const mat = keep(toonMat({ vertexColors: true, rim: 0.3, skin: true }));
  const line = keep(outlineMat(0.0075));
  const root = new THREE.Group();
  root.scale.setScalar(look.scale);
  const outlines: THREE.Mesh[] = [];
  const mk = (m: Merger, parent: THREE.Object3D, outlined = true): THREE.Mesh => {
    const g = keep(m.build());
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true;
    parent.add(mesh);
    if (outlined) {
      const o = new THREE.Mesh(g, line);
      mesh.add(o);
      outlines.push(o);
    }
    return mesh;
  };

  // ---- 몸통(엉덩이를 중심으로 돈다) ----
  const body = new THREE.Group();
  body.rotation.order = 'YXZ';
  root.add(body);
  {
    const m = new Merger();
    const H = d.neck - d.hip;
    const k = H / 0.305, r = d.bodyR;
    const split = 0.088 * k;
    const low: [number, number][] = [[0.001, -0.05], [0.07, -0.046], [0.118, -0.02], [0.131, 0.035], [0.129, split - 0.012], [0.12, split + 0.004], [0.09, split + 0.012]];
    const top: [number, number][] = [[0.1, split - 0.03], [0.134, split - 0.022], [0.135, split + 0.01], [0.129, 0.13 * k], [0.118, 0.2 * k], [0.098, 0.255 * k], [0.064, 0.29 * k], [0.04, 0.305 * k], [0.03, 0.33 * k]];
    m.add(smoothLathe(low.map(([pr, py]) => [pr * r, py] as const), 16, 9), look.bottom);
    m.add(smoothLathe(top.map(([pr, py]) => [pr * r, py] as const), 16, 12), look.top);
    if (kid) m.add(new THREE.TorusGeometry(0.1335 * r, 0.006, 4, 16), look.bottom, { y: split - 0.006, rx: Math.PI / 2 });
    // 깃
    m.add(new THREE.TorusGeometry(0.047, 0.015, 6, 14), kid ? look.bottom : mix(look.top, paper, 0.5), { y: 0.3 * k, rx: Math.PI / 2 });
    if (!kid) {
      // 지퍼 선과 호루라기
      m.add(new THREE.BoxGeometry(0.012, 0.2 * k, 0.012), mix(look.top, paper, 0.6), { x: 0.122 * r, y: 0.19 * k, rz: -0.07 });
      m.add(new THREE.SphereGeometry(0.022, 10, 8), tok('--yellow'), { x: 0.125 * r, y: 0.17 * k, z: 0.02, sx: 0.7, sz: 1.3 });
      m.add(new THREE.TorusGeometry(0.075, 0.006, 5, 16), tok('--red'), { y: 0.25 * k, x: 0.02, rx: Math.PI / 2 - 0.5, rz: 0 });
    }
    mk(m, body);
  }
  // 이름표
  let redrawTag = (): void => undefined;
  if (look.tag) {
    const tagC = canvasOf(128, 80);
    const tagTex = keep(texOf(tagC.canvas, 4));
    redrawTag = (): void => {
      const ctx = tagC.ctx;
      if (!ctx) return;
      ctx.clearRect(0, 0, 128, 80);
      ctx.fillStyle = tok('--yellow');
      ctx.strokeStyle = inkC;
      ctx.lineWidth = 6;
      roundRect(ctx, 5, 5, 118, 70, 14);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = inkC;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = "44px 'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif";
      ctx.fillText(look.tag ?? '', 64, 43);
      tagTex.needsUpdate = true;
    };
    redrawTag();
    const g = keep(new THREE.PlaneGeometry(0.088, 0.055, 4, 1));
    // 가슴의 둥근 면을 따라 살짝 휜다
    const P = g.getAttribute('position');
    for (let i = 0; i < P.count; i++) P.setZ(i, -((P.getX(i) / 0.044) ** 2) * 0.006);
    const tag = new THREE.Mesh(g, keep(toonMat({ map: tagTex, transparent: true })));
    const H = d.neck - d.hip;
    tag.position.set(0.1215 * d.bodyR, H * 0.66, -0.052);
    tag.rotation.set(0, Math.PI / 2 + 0.38, 0);
    tag.rotation.order = 'YXZ';
    tag.rotation.x = -0.16;
    body.add(tag);
  }

  // ---- 머리 ----
  const head = new THREE.Group();
  head.rotation.order = 'YZX';
  head.position.set(0, d.neck - d.hip, 0);
  body.add(head);
  const R = d.headR;
  const hs = { sx: 1.0, sy: 0.95, sz: 1.06 };
  {
    const m = new Merger();
    m.add(new THREE.SphereGeometry(R, 24, 16), (x0, y0) => (y0 < -R * 0.2 && x0 > 0 ? mix(skin, skinShade, Math.min(1, (-y0 - R * 0.2) / R) * 0.5) : skin), { y: d.headUp, ...hs });
    for (const s of [-1, 1]) m.add(new THREE.SphereGeometry(R * 0.2, 12, 10), skin, { x: -R * 0.06, y: d.headUp - R * 0.12, z: s * R * 1.03, sx: 0.6, sz: 0.55 });
    const hair = look.hair;
    // 뒷머리와 정수리
    // 모자를 쓰면 정수리 머리는 모자 속에 있으므로 만들지 않는다(모자를 뚫고 나오지 않게).
    m.add(new THREE.SphereGeometry(R * 1.045, 18, 10, -0.62 * Math.PI, 1.24 * Math.PI, look.cap ? 0.3 * Math.PI : 0, (look.cap ? 0.44 : 0.74) * Math.PI), hair, { y: d.headUp, ...hs });
    if (!look.cap) m.add(new THREE.SphereGeometry(R * 1.04, 18, 7, 0, Math.PI * 2, 0, 0.3 * Math.PI), hair, { y: d.headUp, ...hs });
    if (kid) {
      // 모자 밑으로 나온 옆머리와 관자놀이 머리(앞머리는 모자 속)
      for (const s of [-1, 1]) {
        m.add(new THREE.SphereGeometry(R * 0.2, 10, 8), hair, { x: R * 0.22, y: d.headUp + R * 0.02, z: s * R * 1.0, sx: 0.8, sy: 1.6, sz: 0.36 });
        m.add(new THREE.SphereGeometry(R * 0.2, 10, 8), hair, { x: R * 0.62, y: d.headUp + R * 0.3, z: s * R * 0.8, sx: 0.5, sy: 0.9, sz: 0.5, ry: -s * 0.9 });
      }
    } else {
      // 선생님: 단발 + 뒤로 묶은 머리
      m.add(new THREE.SphereGeometry(R * 1.05, 16, 8, -0.8 * Math.PI, 1.6 * Math.PI, 0.2 * Math.PI, 0.5 * Math.PI), hair, { y: d.headUp - R * 0.05, ...hs });
      for (const s of [-1, 1]) m.add(new THREE.SphereGeometry(R * 0.5, 12, 10), hair, { x: R * 0.5, y: d.headUp + R * 0.62, z: s * R * 0.42, sx: 0.9, sy: 0.55, sz: 1.1, rx: s * 0.3 });
      m.add(new THREE.SphereGeometry(R * 0.36, 14, 12), hair, { x: -R * 1.12, y: d.headUp + R * 0.28 });
      m.add(new THREE.TorusGeometry(R * 0.14, R * 0.05, 6, 12), tok('--red'), { x: -R * 0.93, y: d.headUp + R * 0.25, ry: Math.PI / 2 });
    }
    if (look.cap) {
      const cap = look.cap;
      const capM = new THREE.Matrix4().makeTranslation(0, d.headUp + R * 0.06, 0).multiply(new THREE.Matrix4().makeRotationZ(0.2));
      const part = (g: THREE.BufferGeometry, color: string, p: { x?: number; y?: number; z?: number; sx?: number; sy?: number; sz?: number; rz?: number }): void => {
        const local = new THREE.Matrix4().compose(new THREE.Vector3(p.x ?? 0, p.y ?? 0, p.z ?? 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), p.rz ?? 0), new THREE.Vector3(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1));
        m.add(g, color, capM.clone().multiply(local));
      };
      part(new THREE.SphereGeometry(R * 1.09, 22, 9, 0, Math.PI * 2, 0, 0.5 * Math.PI), cap, { y: R * 0.08, sx: 1.01, sy: 0.9, sz: 1.07 });
      part(new THREE.CylinderGeometry(R * 1.1, R * 1.08, R * 0.1, 22, 1, true), mix(cap, tok('--orange'), 0.22), { y: R * 0.05, sz: 1.07 });
      part(new THREE.SphereGeometry(R * 0.72, 14, 7), cap, { x: R * 0.82, y: R * 0.1, sx: 1.0, sy: 0.12, sz: 1.12, rz: -0.2 });
      part(new THREE.SphereGeometry(R * 0.1, 10, 8), tok('--red'), { y: R * 1.06, sy: 0.6 });
    }
    mk(m, head);
  }
  // 얼굴(표정 묶음에서 한 칸을 골라 보여 준다)
  const faceTex = keep(texOf(makeFaceAtlas({ glasses: !kid, brow: mix(look.hair, inkC, 0.3), lash: !kid }), 4));
  faceTex.repeat.set(1 / COLS, 1 / ROWS);
  const faceGeom = keep(new THREE.SphereGeometry(R * 1.012, 24, 16, Math.PI - 1.05, 2.1, 0.255 * Math.PI, 0.5 * Math.PI));
  const face = new THREE.Mesh(faceGeom, keep(new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
  face.position.y = d.headUp;
  face.scale.set(hs.sx, hs.sy, hs.sz);
  face.renderOrder = 2;
  head.add(face);

  // ---- 팔다리 ----
  const armGeomU = (): Merger => {
    const m = new Merger();
    m.add(capsuleY(d.armR * 1.12, d.upper, 9, 3), (_x0, y) => (kid && y > d.upper * 0.72 && y < d.upper * 0.86 ? look.bottom : look.top));
    m.add(new THREE.SphereGeometry(d.armR * 1.5, 10, 7), look.top, { sy: 0.9 });
    return m;
  };
  const armGeomF = (sideZ: number): Merger => {
    const m = new Merger();
    const sleeve = !kid;
    m.add(capsuleY(d.armR * 0.95, d.fore, 9, 3), sleeve ? look.top : skin);
    if (sleeve) m.add(new THREE.CylinderGeometry(d.armR * 1.12, d.armR * 1.12, 0.03, 12), mix(look.top, paper, 0.5), { y: d.fore - 0.01 });
    m.add(new THREE.SphereGeometry(0.05, 12, 8), skin, { y: d.fore + 0.032, sx: 1.0, sy: 1.12, sz: 0.88 });
    m.add(new THREE.SphereGeometry(0.023, 7, 5), skin, { x: 0.04, y: d.fore + 0.015, z: 0 });
    if (!kid && sideZ < 0) {
      // 왼손의 기록판
      m.add(new THREE.BoxGeometry(0.014, 0.25, 0.18), mix(tok('--court-dark'), inkC, 0.15), { x: 0.05, y: d.fore + 0.1, z: 0 });
      m.add(new THREE.BoxGeometry(0.006, 0.21, 0.15), paper, { x: 0.06, y: d.fore + 0.095, z: 0 });
      m.add(new THREE.BoxGeometry(0.02, 0.03, 0.08), mix(paper, inkC, 0.4), { x: 0.06, y: d.fore + 0.215, z: 0 });
    }
    if (!kid && sideZ > 0) {
      // 오른손의 깃발
      m.add(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 6), inkC, { y: d.fore + 0.2 });
      const g = new THREE.BufferGeometry();
      const y0 = d.fore + 0.41;
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, y0, 0, 0, y0 - 0.17, 0, 0.26, y0 - 0.085, 0, 0, y0, 0, 0.26, y0 - 0.085, 0, 0, y0 - 0.17, 0], 3));
      g.computeVertexNormals();
      m.add(g, tok('--yellow'));
    }
    return m;
  };
  const upperR = mk(armGeomU(), root), upperL = mk(armGeomU(), root);
  const foreR = mk(armGeomF(1), root), foreL = mk(armGeomF(-1), root);
  const legLen = d.hip - 0.07;
  const legGeom = (): Merger => {
    const m = new Merger();
    m.add(capsuleY(d.legR, legLen, 10, 3), (_x0, y) => (kid ? (y < 0.03 ? paper : y > legLen - 0.035 ? look.bottom : skin) : look.bottom));
    return m;
  };
  const legR = mk(legGeom(), root), legL = mk(legGeom(), root);
  const shoeGeom = (): Merger => {
    const m = new Merger();
    m.add(new THREE.SphereGeometry(0.062, 11, 7), look.shoe, { x: 0.026, y: 0.047, sx: 1.5, sy: 0.78, sz: 1.06 });
    m.add(new THREE.SphereGeometry(0.062, 11, 4), paper, { x: 0.028, y: 0.02, sx: 1.56, sy: 0.3, sz: 1.12 });
    m.add(new THREE.SphereGeometry(0.04, 8, 5), paper, { x: 0.088, y: 0.042, sx: 0.9, sy: 0.7, sz: 1.1 });
    return m;
  };
  const shoeR = mk(shoeGeom(), root), shoeL = mk(shoeGeom(), root);
  shoeR.rotation.order = shoeL.rotation.order = 'YZX';

  const hintR = new THREE.Vector3(), hintL = new THREE.Vector3();
  const sR = new THREE.Vector3(), sL = new THREE.Vector3(), eR = new THREE.Vector3(), eL = new THREE.Vector3(), hR = new THREE.Vector3(), hL = new THREE.Vector3();
  const tR = new THREE.Vector3(), tL = new THREE.Vector3();
  const hip = new THREE.Vector3(), ankle = new THREE.Vector3();
  const fwd = new THREE.Vector3(1, 0, 0);
  const twR = new THREE.Vector3(0.3, 0.25, 0.9), twL = new THREE.Vector3(0.3, 0.25, -0.9);
  let baseY = 0;
  const handR = new THREE.Vector3(), handL = new THREE.Vector3(), headPos = new THREE.Vector3();
  const a2 = d.upper, b2 = d.fore + 0.032;

  const apply = (p: Pose): void => {
    root.position.y = baseY + p.hop * look.scale;
    root.rotation.y = p.facing;
    const sq = Math.max(0.6, p.squash);
    const wide = 1 / Math.sqrt(sq);
    body.position.set(p.bx, d.hip + p.by - (1 - sq) * d.hip * 0.4, p.bz);
    body.rotation.set(p.roll, p.twist, p.lean);
    body.scale.set(wide, sq, wide);
    head.rotation.set(p.ht, p.hy, p.hp);
    // 머리는 눌려도 덜 찌그러지게 되돌려 준다
    head.scale.set(1 / Math.sqrt(wide), 1 / Math.sqrt(sq), 1 / Math.sqrt(wide));
    body.updateMatrix();
    // 어깨(캐릭터 기준 좌표)
    sR.set(0, d.sh - d.hip, d.shZ).applyMatrix4(body.matrix);
    sL.set(0, d.sh - d.hip, -d.shZ).applyMatrix4(body.matrix);
    tR.set(p.rhx, p.rhy, p.rhz);
    tL.set(p.lhx, p.lhy, p.lhz);
    // 팔꿈치는 바깥 아래 뒤쪽으로 굽는다. 손을 높이 들면 바깥쪽으로.
    hintR.set(-0.45, tR.y > sR.y ? -0.15 : -0.6, 0.75);
    hintL.set(-0.45, tL.y > sL.y ? -0.15 : -0.6, -0.75);
    solveArm(sR, tR, a2, b2, hintR, eR, hR);
    solveArm(sL, tL, a2, b2, hintL, eL, hL);
    aimLimb(upperR, sR, eR, twR);
    aimLimb(foreR, eR, hR, twR);
    aimLimb(upperL, sL, eL, twL);
    aimLimb(foreL, eL, hL, twL);
    // 다리: 엉덩이에서 발목까지
    for (const side of [1, -1]) {
      const leg = side > 0 ? legR : legL, shoe = side > 0 ? shoeR : shoeL;
      const fx = side > 0 ? p.rfx : p.lfx, fy = side > 0 ? p.rfy : p.lfy, fz = side > 0 ? p.rfz : p.lfz, fp = side > 0 ? p.rfp : p.lfp;
      hip.set(0, 0.01, side * d.hipZ).applyMatrix4(body.matrix);
      ankle.set(fx - 0.012, fy + 0.07, fz);
      aimLimb(leg, ankle, hip, fwd, legLen);
      shoe.position.set(fx, fy + Math.sin(Math.max(0, fp)) * 0.085, fz);
      shoe.rotation.set(0, -side * 0.2, -fp);
    }
    root.updateMatrixWorld(true);
    handR.copy(hR).applyMatrix4(root.matrixWorld);
    handL.copy(hL).applyMatrix4(root.matrixWorld);
    headPos.set(0, d.headUp, 0).applyMatrix4(head.matrixWorld);
  };
  const inv = new THREE.Matrix4();

  const api: Chibi = {
    root, dims: d, look, rest: restPose(d), apply,
    setFace: (e, blink) => {
      const cell = EXPRS.indexOf(e) * 2 + (blink ? 1 : 0);
      faceTex.offset.set((cell % COLS) / COLS, 1 - (Math.floor(cell / COLS) + 1) / ROWS);
    },
    setOutline: (on) => { for (const o of outlines) o.visible = on; },
    setBaseY: (y) => { baseY = y; },
    redrawText: () => redrawTag(),
    handR, handL, headPos,
    toLocal: (world, out) => {
      root.updateMatrixWorld();
      return out.copy(world).applyMatrix4(inv.copy(root.matrixWorld).invert());
    },
    dispose: () => trash.dispose(),
  };
  api.setFace('neutral', false);
  api.apply(api.rest);
  return api;
}


function lerpPose(cur: Pose, target: Pose, k: number): void {
  for (const key of POSE_KEYS) cur[key] += (target[key] - cur[key]) * k;
}
const ease = (t: number): number => { const c = t < 0 ? 0 : t > 1 ? 1 : t; return c * c * (3 - 2 * c); };
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** 살짝 넘쳤다 돌아오는 움직임 */
const overshoot = (t: number): number => { const c = clamp(t, 0, 1) - 1; return 1 + c * c * (2.2 * c + 1.2); };

// ---------------------------------------------------------------------------
// 아이의 연기
// ---------------------------------------------------------------------------
export type KidMode = 'home' | 'aim' | 'throw' | 'watch' | 'react' | 'rest';
export type Mood = 'great' | 'good' | 'again';

export interface KidInput {
  mode: KidMode;
  /** 이 모드에 들어온 뒤 흐른 시간(s) */
  t: number;
  /** 조준 각도(도), 당긴 정도 0~1 */
  pitchDeg: number;
  pull: number;
  /** 던지는 동작의 진행: 0~1 뒤로 젖힘, 1~2 휘두름, 2~3 마무리 */
  swing: number;
  /** 손에 든 비행기가 있어야 할 곳(세계 좌표). 손은 그 아래를 받친다. */
  hold: THREE.Vector3 | null;
  /** 바라볼 곳(세계 좌표) */
  lookAt: THREE.Vector3 | null;
  /** 카메라 쪽(세계 좌표): 얼굴이 잘 보이게 살짝 돌린다 */
  camera: THREE.Vector3;
  mood: Mood;
  /** 서 있을 방향(라디안, 0 이면 던지는 방향) */
  facing: number;
}

export interface Actor {
  chibi: Chibi;
  update: (dt: number, clock: number, input: KidInput) => void;
  /** 자세를 한 번에 맞춘다(화면 전환 직후) */
  snap: () => void;
}

/**
 * 자리만 잡아 두는 아이: 모델(kid.glb)을 불러오는 동안 아무것도 그리지 않고, 무대가 묻는 자리(머리, 손)만 알려 준다.
 * 도형 아이를 먼저 보여 줬다가 바꿔치기하면 "펑" 하고 바뀌는 것이 눈에 띄어서, 그동안은 비워 둔다.
 */
export function makeHeldActor(look: ChibiLook): Actor {
  const root = new THREE.Group();
  root.visible = false;
  const handR = new THREE.Vector3(), handL = new THREE.Vector3(), headPos = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  const place = (): void => {
    const s = look.scale;
    headPos.set(root.position.x, root.position.y + 0.752 * s, root.position.z);
    handR.set(root.position.x + 0.1 * s, root.position.y + 0.66 * s, root.position.z + 0.24 * s);
    handL.set(root.position.x + 0.03 * s, root.position.y + 0.3 * s, root.position.z - 0.2 * s);
  };
  const chibi = {
    root, look, dims: KID_DIMS, rest: restPose(KID_DIMS),
    apply: () => undefined,
    setFace: () => undefined,
    setOutline: () => undefined,
    setBaseY: (y: number) => { root.position.y = y; place(); },
    redrawText: () => undefined,
    handR, handL, headPos,
    toLocal: (world: THREE.Vector3, out: THREE.Vector3) => {
      root.updateMatrixWorld();
      return out.copy(world).applyMatrix4(inv.copy(root.matrixWorld).invert());
    },
    dispose: () => undefined,
  } satisfies Chibi;
  return { chibi, update: () => place(), snap: () => undefined };
}

export const KID_LOOK = (): ChibiLook => ({
  kind: 'kid', scale: 1.64, skin: tok('--skin'), hair: mix(tok('--ink'), tok('--court-dark'), 0.22),
  top: tok('--paper'), bottom: tok('--blue'), shoe: tok('--red'), cap: tok('--yellow'), tag: '하늘',
});
export const TEACHER_LOOK = (): ChibiLook => ({
  kind: 'teacher', scale: 1.7, skin: mix(tok('--skin'), tok('--court'), 0.12), hair: mix(tok('--ink'), tok('--court-dark'), 0.25),
  top: mix(tok('--mat'), tok('--sky'), 0.45), bottom: tok('--ink'), shoe: tok('--paper'), cap: null, tag: null,
});

export function makeKidActor(chibi: Chibi): Actor {
  const d = chibi.dims;
  const cur: Pose = { ...chibi.rest };
  const tg: Pose = { ...chibi.rest };
  const local = new THREE.Vector3(), tmp = new THREE.Vector3();
  let snapNext = true;
  let blinkAt = 2, blinkT = 0;
  let expr: Expr = 'smile';

  const reset = (): void => { Object.assign(tg, chibi.rest); };

  /** 세계의 한 점을 바라보는 고개 각도(몸이 도는 것은 빼고) */
  const gaze = (world: THREE.Vector3, facing: number, twist: number): [number, number] => {
    tmp.copy(world).sub(chibi.headPos);
    const yawWorld = Math.atan2(-tmp.z, tmp.x);
    let yaw = yawWorld - facing - twist;
    while (yaw > Math.PI) yaw -= Math.PI * 2;
    while (yaw < -Math.PI) yaw += Math.PI * 2;
    const pitch = Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z));
    return [clamp(yaw, -1.15, 1.15), clamp(pitch, -0.5, 0.75)];
  };

  const update = (dt: number, clock: number, inp: KidInput): void => {
    reset();
    const t = inp.t;
    let rate = 10;
    let wantExpr: Expr = 'smile';
    let holdHand = false;
    tg.facing = inp.facing;
    // 숨쉬기와 무게 옮기기(모든 자세에 얹는다)
    const breath = Math.sin(clock * 2.1);
    const sway = Math.sin(clock * 0.8);
    tg.squash = 1 + breath * 0.012;
    tg.bz = sway * 0.008;
    tg.roll = sway * 0.02;

    switch (inp.mode) {
      case 'home': {
        // 비행기를 자랑스럽게 들고, 가끔 손을 흔든다.
        const cyc = (clock % 7) / 7;
        const waving = cyc < 0.42;
        const w = waving ? ease(Math.min(cyc / 0.06, (0.42 - cyc) / 0.06)) : 0;
        tg.lhx = 0.06 + w * 0.02; tg.lhy = 0.3 + w * 0.6 + (waving ? Math.sin(clock * 9) * 0.02 : 0); tg.lhz = -0.2 - w * 0.12 + (waving ? Math.sin(clock * 9) * 0.07 * w : 0);
        tg.rhx = 0.17; tg.rhy = 0.66 + breath * 0.008; tg.rhz = 0.24;
        tg.hop = Math.max(0, Math.sin(clock * 2.1)) * 0.012;
        tg.ht = Math.sin(clock * 0.9) * 0.07 + w * 0.08;
        tg.twist = Math.sin(clock * 0.5) * 0.08;
        tg.lean = 0.03;
        wantExpr = waving ? 'joy' : 'smile';
        holdHand = false;
        rate = 8;
        break;
      }
      case 'aim': {
        const k = inp.pull;
        const p = (inp.pitchDeg * Math.PI) / 180;
        tg.lfx = 0.085; tg.lfz = -0.09;
        tg.rfx = -0.065; tg.rfz = 0.09; tg.rfp = k * 0.25; tg.rfy = k * 0.012;
        tg.twist = -0.38 - 0.42 * k + Math.sin(clock * 1.3) * 0.015;
        tg.lean = 0.04 + 0.2 * k;
        tg.bx = -0.01 - 0.06 * k;
        tg.by = -0.008 - 0.03 * k;
        tg.squash *= 1 - 0.05 * k;
        // 왼팔은 날아갈 쪽을 가리킨다
        const reach = 0.27 + 0.05 * k;
        tg.lhx = 0.04 + Math.cos(p) * reach; tg.lhy = d.sh - 0.02 + Math.sin(p) * reach; tg.lhz = -0.13;
        holdHand = true;
        // 눈은 날아갈 쪽을 보되, 얼굴이 보이게 카메라 쪽으로 반쯤 돌린다
        tg.hy = -0.52 - tg.twist;
        tg.hp = clamp(p * 0.4, -0.2, 0.42) + k * 0.05;
        tg.ht = -0.14;
        tg.roll += 0.07;
        wantExpr = k > 0.82 ? 'effort' : k > 0.04 ? 'focus' : 'neutral';
        rate = 16;
        break;
      }
      case 'throw': {
        const s = inp.swing;
        const p = (inp.pitchDeg * Math.PI) / 180;
        holdHand = s < 2;
        if (s < 1) {
          // 뒤로 젖힌다
          const k = ease(s);
          tg.lfx = 0.1; tg.lfz = -0.09; tg.lfy = 0.045 * Math.sin(k * Math.PI);
          tg.rfx = -0.07; tg.rfz = 0.09;
          tg.twist = -0.8 - 0.25 * k;
          tg.lean = 0.24 + 0.1 * k;
          tg.bx = -0.07 - 0.04 * k;
          tg.by = -0.04 - 0.02 * k;
          tg.squash = 0.95 - 0.03 * k;
          tg.lhx = 0.04 + Math.cos(p) * 0.32; tg.lhy = d.sh + 0.02 + Math.sin(p) * 0.32; tg.lhz = -0.1;
          tg.hy = -0.3 - tg.twist; tg.hp = 0.1;
          wantExpr = 'effort';
          rate = 40;
        } else if (s < 2) {
          // 휘두른다: 몸이 풀리며 앞으로 쏟아진다
          const k = s - 1;
          const e = k * k;
          tg.lfx = 0.12; tg.lfz = -0.09;
          tg.rfx = -0.08 + 0.02 * e; tg.rfz = 0.09; tg.rfy = 0.03 * e; tg.rfp = 0.5 * e;
          tg.twist = -1.05 + 1.5 * e;
          tg.lean = 0.34 - 0.62 * e;
          tg.bx = -0.11 + 0.2 * e;
          tg.by = -0.06 + 0.08 * e;
          tg.squash = 0.92 + 0.2 * e;
          tg.hop = 0.03 * e;
          tg.lhx = 0.3 - 0.36 * e; tg.lhy = d.sh + 0.1 - 0.26 * e; tg.lhz = -0.12 - 0.12 * e;
          tg.hy = -0.3 - tg.twist * 0.6; tg.hp = 0.12;
          wantExpr = 'effort';
          rate = 60;
        } else {
          // 마무리: 폴짝 뛰었다가 내려앉는다
          const k = clamp(s - 2, 0, 1);
          const air = Math.sin(Math.min(1, k / 0.55) * Math.PI);
          const land = k > 0.55 ? Math.sin(clamp((k - 0.55) / 0.3, 0, 1) * Math.PI) : 0;
          tg.hop = 0.03 + air * 0.07;
          tg.squash = 1.1 - 0.1 * k - land * 0.1 + air * 0.02;
          tg.twist = 0.45 + 0.25 * ease(k * 2) - 0.5 * ease((k - 0.5) * 2);
          tg.lean = -0.28 - 0.1 * ease(k * 2) + 0.3 * ease((k - 0.45) * 2);
          tg.bx = 0.09 - 0.07 * ease((k - 0.4) * 2);
          tg.by = 0.02 - land * 0.03;
          tg.lfx = 0.12; tg.lfz = -0.09; tg.lfy = air * 0.03;
          tg.rfx = -0.12 - air * 0.1 + 0.16 * ease((k - 0.5) * 2); tg.rfz = 0.085; tg.rfy = 0.03 + air * 0.13; tg.rfp = 0.5 + air * 0.6;
          if (k > 0.6) { tg.rfy = 0; tg.rfp = 0; tg.rfx = 0.02; }
          // 던진 팔은 앞 아래로 몸을 가로질러 내려간다
          const f = ease(k * 1.6);
          tg.rhx = 0.3 - 0.04 * f; tg.rhy = d.sh + 0.2 - 0.52 * f; tg.rhz = 0.1 - 0.2 * f;
          tg.lhx = -0.08; tg.lhy = d.sh - 0.2; tg.lhz = -0.26;
          wantExpr = 'wow';
          rate = 32;
          if (inp.lookAt) { const [y, pp] = gaze(inp.lookAt, tg.facing, tg.twist); tg.hy = y; tg.hp = pp; }
        }
        break;
      }
      case 'watch': {
        // 손차양을 하고 비행기를 눈으로 좇는다. 발끝으로 서서 들썩인다.
        let yaw = 0, pitch = 0.1;
        if (inp.lookAt) [yaw, pitch] = gaze(inp.lookAt, tg.facing, 0);
        tg.twist = yaw * 0.45;
        tg.hy = yaw * 0.55;
        tg.hp = pitch;
        tg.by = 0.012 + Math.abs(Math.sin(clock * 5)) * 0.012;
        tg.rfp = 0.18; tg.lfp = 0.18;
        tg.lean = -0.06;
        // 오른손은 이마 위(고개가 도는 쪽을 따라간다)
        const hyaw = tg.twist + tg.hy;
        const hx = Math.cos(hyaw), hz = -Math.sin(hyaw);
        const headY = d.neck + d.headUp + 0.012;
        tg.rhx = hx * 0.27 - hz * 0.1; tg.rhy = headY + 0.035 + pitch * 0.12; tg.rhz = hz * 0.27 + hx * 0.1;
        tg.lhx = 0.03; tg.lhy = d.hip + 0.07; tg.lhz = -0.15;
        wantExpr = 'wow';
        rate = 9;
        break;
      }
      case 'react': {
        if (inp.mood === 'great') {
          // 만세 삼창: 움츠렸다가 폴짝
          const period = 0.56;
          const n = Math.floor(t / period);
          const u = (t % period) / period;
          if (n < 4) {
            const crouch = u < 0.22 ? Math.sin((u / 0.22) * Math.PI * 0.5) : 0;
            const air = u >= 0.22 && u < 0.8 ? Math.sin(((u - 0.22) / 0.58) * Math.PI) : 0;
            const land = u >= 0.8 ? Math.sin(((u - 0.8) / 0.2) * Math.PI) : 0;
            tg.hop = air * 0.2;
            tg.by = -crouch * 0.05 - land * 0.035;
            tg.squash = 1 - crouch * 0.12 + air * 0.1 - land * 0.1;
            const up = u < 0.22 ? 1 - crouch * 0.6 : 1;
            const wv = Math.sin(clock * 13) * 0.04;
            tg.rhx = 0.03; tg.rhy = d.sh + 0.05 + up * 0.36; tg.rhz = 0.2 + up * 0.1 + wv;
            tg.lhx = 0.03; tg.lhy = d.sh + 0.05 + up * 0.36; tg.lhz = -0.2 - up * 0.1 - wv;
            tg.rfy = air * 0.035; tg.lfy = air * 0.035; tg.rfp = air * 0.4; tg.lfp = air * 0.4;
            tg.rfz = d.footZ + air * 0.03; tg.lfz = -d.footZ - air * 0.03;
            tg.twist = (n % 2 ? 1 : -1) * air * 0.25;
            tg.hp = 0.15 + air * 0.15;
            rate = 26;
          } else {
            const wv = Math.sin(clock * 6);
            tg.rhx = 0.03; tg.rhy = d.sh + 0.36; tg.rhz = 0.27 + wv * 0.03;
            tg.lhx = 0.03; tg.lhy = d.sh + 0.36; tg.lhz = -0.27 - wv * 0.03;
            tg.roll += wv * 0.05;
            tg.hp = 0.12;
            rate = 10;
          }
          wantExpr = 'joy';
        } else if (inp.mood === 'good') {
          // 끄덕끄덕, 작게 "좋았어!"
          const u = clamp(t / 0.5, 0, 3);
          const pump = u < 2 ? Math.sin((u % 1) * Math.PI) : 0;
          tg.rhx = 0.13; tg.rhy = d.sh + 0.02 - pump * 0.1; tg.rhz = 0.17;
          tg.lhx = 0.03; tg.lhy = d.hip + 0.07; tg.lhz = -0.15;
          tg.by = -pump * 0.03;
          tg.squash -= pump * 0.05;
          tg.hp = -pump * 0.3 + 0.05;
          tg.twist = -0.15;
          wantExpr = u < 2 ? 'joy' : 'smile';
          rate = 20;
        } else {
          // 털썩 처졌다가, 주먹을 불끈
          if (t < 1.1) {
            const k = overshoot(t / 0.35);
            tg.lean = -0.2 * k;
            tg.by = -0.05 * k;
            tg.squash = 1 - 0.09 * k;
            tg.hp = -0.16 * k;
            tg.hy = -0.45 * k;
            tg.ht = Math.sin(t * 5) * 0.05;
            tg.rhx = 0.14; tg.rhy = d.hip - 0.02; tg.rhz = 0.13 + Math.sin(t * 3.2) * 0.02;
            tg.lhx = 0.14; tg.lhy = d.hip - 0.02; tg.lhz = -0.13 - Math.sin(t * 3.2 + 1) * 0.02;
            wantExpr = 'oops';
            rate = 14;
          } else {
            const k = overshoot((t - 1.1) / 0.3);
            const shake = Math.sin(clock * 16) * 0.012 * (t < 2.2 ? 1 : 0);
            tg.squash = 1 + 0.05 * Math.sin(clamp((t - 1.1) / 0.3, 0, 1) * Math.PI);
            tg.rhx = 0.12; tg.rhy = d.hip + 0.05 + k * (d.sh - d.hip + 0.05) + shake; tg.rhz = 0.19;
            tg.lhx = 0.03; tg.lhy = d.hip + 0.07; tg.lhz = -0.15;
            tg.hp = 0.1; tg.twist = -0.2;
            wantExpr = 'grit';
            rate = 18;
          }
        }
        if (inp.lookAt && inp.mood !== 'again') { const [y] = gaze(inp.lookAt, tg.facing, tg.twist); tg.hy = y * 0.5; }
        break;
      }
      case 'rest':
        tg.lhx = 0.03; tg.lhy = d.hip + 0.07; tg.lhz = -0.15;
        wantExpr = 'smile';
        break;
    }

    // 가끔 두리번거린다(쉬는 자세에서만)
    if (inp.mode === 'rest' || inp.mode === 'home') {
      const cyc = (clock + 3) % 9;
      const peek = cyc < 2.2 ? ease(Math.min(cyc / 0.4, (2.2 - cyc) / 0.4)) : 0;
      // 카메라 쪽을 흘끗
      tmp.copy(inp.camera);
      const [y, p] = gaze(tmp, tg.facing, tg.twist);
      const baseYaw = inp.mode === 'home' ? y * 0.8 : y * 0.35;
      tg.hy = baseYaw * (inp.mode === 'home' ? 1 : 0.4 + 0.6 * peek) + (inp.mode === 'home' ? Math.sin(clock * 0.6) * 0.1 * (1 - peek) : 0);
      tg.hp = p * 0.5;
    }

    // 손에 든 비행기를 받친다
    if (holdHand && inp.hold) {
      chibi.toLocal(inp.hold, local);
      tg.rhx = local.x; tg.rhy = local.y; tg.rhz = local.z;
    }

    // 부드럽게 잇기. 방향 전환은 조금 천천히.
    const facingNow = cur.facing;
    const k = snapNext ? 1 : 1 - Math.exp(-dt * rate);
    lerpPose(cur, tg, k);
    if (!snapNext) {
      let df = tg.facing - facingNow;
      while (df > Math.PI) df -= Math.PI * 2;
      while (df < -Math.PI) df += Math.PI * 2;
      cur.facing = facingNow + df * (1 - Math.exp(-dt * 7));
    }
    // 손에 든 것은 늦지 않게 곧바로 따라간다(비행기가 손에서 뜨지 않게)
    if (holdHand && inp.hold) {
      chibi.toLocal(inp.hold, local);
      const kk = snapNext ? 1 : 1 - Math.exp(-dt * 45);
      cur.rhx += (local.x - cur.rhx) * kk; cur.rhy += (local.y - cur.rhy) * kk; cur.rhz += (local.z - cur.rhz) * kk;
    }
    snapNext = false;
    chibi.apply(cur);

    // 표정과 눈 깜빡임
    expr = wantExpr;
    blinkT -= dt;
    if (clock > blinkAt) {
      blinkT = 0.11;
      blinkAt = clock + 2.2 + ((clock * 7.3) % 2.6);
    }
    chibi.setFace(expr, blinkT > 0);
  };

  return { chibi, update, snap: () => { snapNext = true; } };
}

// ---------------------------------------------------------------------------
// 심판 선생님의 연기
// ---------------------------------------------------------------------------
export type RefMode = 'idle' | 'watch' | 'flag' | 'point' | 'cheer';
export interface RefInput { mode: RefMode; t: number; lookAt: THREE.Vector3 | null; facing: number; pointAt: THREE.Vector3 | null }
export interface RefActor { chibi: Chibi; update: (dt: number, clock: number, input: RefInput) => void; snap: () => void }

export function makeRefActor(chibi: Chibi): RefActor {
  const d = chibi.dims;
  const cur: Pose = { ...chibi.rest };
  const tg: Pose = { ...chibi.rest };
  const tmp = new THREE.Vector3(), local = new THREE.Vector3();
  let snapNext = true;
  let blinkAt = 1.3, blinkT = 0;
  const update = (dt: number, clock: number, inp: RefInput): void => {
    Object.assign(tg, chibi.rest);
    tg.facing = inp.facing;
    const breath = Math.sin(clock * 1.7 + 1);
    tg.squash = 1 + breath * 0.008;
    tg.roll = Math.sin(clock * 0.6 + 2) * 0.015;
    // 왼손: 기록판을 가슴 앞에
    tg.lhx = 0.2; tg.lhy = d.sh - 0.14 + breath * 0.004; tg.lhz = -0.05;
    // 오른손: 깃발을 내려 들고 있다
    tg.rhx = 0.08; tg.rhy = d.hip + 0.02; tg.rhz = d.shZ + 0.1;
    let expr: Expr = 'smile';
    if (inp.lookAt) {
      tmp.copy(inp.lookAt).sub(chibi.headPos);
      let yaw = Math.atan2(-tmp.z, tmp.x) - tg.facing;
      while (yaw > Math.PI) yaw -= Math.PI * 2;
      while (yaw < -Math.PI) yaw += Math.PI * 2;
      const yc = clamp(yaw, -1.5, 1.5);
      tg.twist = yc * 0.35;
      tg.hy = yc * 0.55;
      tg.hp = clamp(Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)), -0.4, 0.6);
    }
    switch (inp.mode) {
      case 'idle':
        // 가끔 기록판을 내려다본다
        if ((clock % 8) > 6.2) { tg.hy *= 0.2; tg.hp = -0.35; tg.lhy += 0.03; }
        break;
      case 'watch':
        expr = 'wow';
        tg.lean = -0.04;
        break;
      case 'flag': {
        // 깃발 번쩍!
        const k = overshoot(inp.t / 0.28);
        tg.rhx = 0.06; tg.rhy = d.hip + 0.02 + k * (d.sh + 0.3 - d.hip); tg.rhz = d.shZ + 0.08;
        tg.squash += 0.04 * Math.sin(clamp(inp.t / 0.3, 0, 1) * Math.PI);
        expr = 'smile';
        break;
      }
      case 'point': {
        // 깃발로 착지 지점을 가리킨다
        if (inp.pointAt) {
          chibi.toLocal(inp.pointAt, local);
          local.y = d.sh;
          const len = Math.hypot(local.x, local.z) || 1;
          tg.rhx = (local.x / len) * 0.36; tg.rhy = d.sh - 0.02 + Math.sin(clock * 5) * 0.012; tg.rhz = (local.z / len) * 0.36 + d.shZ * 0.5;
        }
        expr = 'smile';
        break;
      }
      case 'cheer': {
        const wv = Math.sin(clock * 9);
        tg.rhx = 0.05 + wv * 0.05; tg.rhy = d.sh + 0.3; tg.rhz = d.shZ + 0.1 + wv * 0.09;
        tg.hop = Math.abs(Math.sin(clock * 5)) * 0.03;
        expr = 'joy';
        break;
      }
    }
    const k = snapNext ? 1 : 1 - Math.exp(-dt * 9);
    lerpPose(cur, tg, k);
    snapNext = false;
    chibi.apply(cur);
    blinkT -= dt;
    if (clock > blinkAt) { blinkT = 0.11; blinkAt = clock + 2.5 + ((clock * 5.1) % 2.3); }
    chibi.setFace(expr, blinkT > 0);
  };
  return { chibi, update, snap: () => { snapNext = true; } };
}
