/**
 * 장난감 디오라마 같은 그림체를 만드는 공통 도구.
 * - 부드러운 3단 음영(직접 칠한 밝기 띠)을 쓰는 툰 재질 + 가장자리 빛(림 라이트)
 * - 남색 외곽선(뒤집은 껍데기 방식: 후처리 없이 싸다)
 * - 여러 도형을 꼭짓점 색과 함께 한 덩어리로 합치는 Merger
 * - 캔버스에 직접 그리는 텍스처 도우미, 매번 같은 값을 내는 난수기
 * 그림 파일은 하나도 쓰지 않는다. 전부 코드로 만든다.
 */
import * as THREE from 'three';
import { tok } from '../lib/palette';

export interface Disposable { dispose: () => void }

/** 만든 것을 모아 두었다가 한꺼번에 정리한다. */
export class Trash {
  private items: Disposable[] = [];
  keep<T extends Disposable>(x: T): T {
    this.items.push(x);
    return x;
  }
  dispose(): void {
    for (const t of this.items) t.dispose();
    this.items = [];
  }
}

/** 정해진 순서로 흩어진 값을 내는 작은 난수기("매번 같은 모양"이어야 하는 곳에 쓴다). */
export function seeded(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function canvasOf(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  // willReadFrequently: 캔버스를 그래픽 메모리가 아닌 일반 메모리에 둔다. 텍스처로 올릴 때 되읽어 오느라 멈추는 일이 없다.
  return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) };
}

export function texOf(canvas: HTMLCanvasElement, aniso = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.max(1, aniso);
  return t;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 두 색을 섞은 CSS 색 문자열(#rrggbb). */
export function mix(a: string, b: string, k: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString()}`;
}

/** 이 장면에서만 쓰는 색(토큰에서 섞어 만든다). */
export const ink = (): string => tok('--ink');

// ---------------------------------------------------------------------------
// 밝기 띠(그라디언트 맵)
// ---------------------------------------------------------------------------
let rampSoft: THREE.DataTexture | null = null;
let rampSkin: THREE.DataTexture | null = null;

function makeRamp(stops: readonly (readonly [number, number])[]): THREE.DataTexture {
  const n = 128;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    let v = stops[0]![1];
    for (let s = 0; s < stops.length - 1; s++) {
      const [x0, v0] = stops[s]!;
      const [x1, v1] = stops[s + 1]!;
      if (x >= x0 && x <= x1) {
        const k = x1 > x0 ? (x - x0) / (x1 - x0) : 0;
        const e = k * k * (3 - 2 * k);
        v = v0 + (v1 - v0) * e;
      } else if (x > x1) v = v1;
    }
    const b = Math.round(Math.max(0, Math.min(1, v)) * 255);
    data[i * 4] = b; data[i * 4 + 1] = b; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** 일반 물체용: 그늘 / 중간 / 밝음 3단, 경계는 부드럽게. x 는 (N·L + 1) / 2. */
export function softRamp(): THREE.DataTexture {
  rampSoft ??= makeRamp([[0, 0], [0.4, 0], [0.5, 0.42], [0.6, 0.48], [0.7, 0.94], [0.86, 1], [1, 1]]);
  return rampSoft;
}
/** 얼굴과 피부용: 그늘이 덜 어둡다. */
export function skinRamp(): THREE.DataTexture {
  rampSkin ??= makeRamp([[0, 0.34], [0.36, 0.36], [0.5, 0.7], [0.62, 0.96], [1, 1]]);
  return rampSkin;
}

// ---------------------------------------------------------------------------
// 툰 재질
// ---------------------------------------------------------------------------
export interface ToonOpts {
  color?: string | THREE.Color;
  map?: THREE.Texture | null;
  vertexColors?: boolean;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
  /** 가장자리 빛의 세기(0 이면 없음) */
  rim?: number;
  skin?: boolean;
  alphaTest?: number;
  emissive?: string | THREE.Color;
  emissiveIntensity?: number;
}

const RIM_GLSL = (strength: string): string => `
  {
    float rimF = 1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
    float rimA = smoothstep(0.52, 0.92, rimF) * (0.55 + 0.45 * clamp(normal.y * 0.5 + 0.5, 0.0, 1.0));
    outgoingLight += (vec3(1.0, 0.94, 0.82) * 0.55 + diffuseColor.rgb * 0.45) * rimA * ${strength};
  }
  #include <opaque_fragment>`;

export function toonMat(o: ToonOpts = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color: o.color !== undefined ? new THREE.Color(o.color as THREE.ColorRepresentation) : 0xffffff,
    map: o.map ?? null,
    vertexColors: o.vertexColors ?? false,
    side: o.side ?? THREE.FrontSide,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    depthWrite: o.depthWrite ?? true,
    gradientMap: o.skin ? skinRamp() : softRamp(),
    alphaTest: o.alphaTest ?? 0,
  });
  if (o.emissive !== undefined) {
    m.emissive = new THREE.Color(o.emissive as THREE.ColorRepresentation);
    m.emissiveIntensity = o.emissiveIntensity ?? 1;
  }
  const rim = o.rim ?? 0;
  if (rim > 0) {
    const s = rim.toFixed(3);
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', RIM_GLSL(s));
    };
    m.customProgramCacheKey = () => `toon-rim-${s}`;
  }
  return m;
}

/** 남색 외곽선 재질(뒤집은 껍데기). thick 는 물체 좌표 기준 두께(m). */
export function outlineMat(thick: number, color: string = ink()): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), side: THREE.BackSide });
  const t = thick.toFixed(5);
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = position + normalize(normal) * ${t};`);
  };
  m.customProgramCacheKey = () => `outline-${t}`;
  return m;
}

// ---------------------------------------------------------------------------
// 도형 합치기
// ---------------------------------------------------------------------------
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n3 = new THREE.Matrix3();
const _c = new THREE.Color();

export interface Place {
  x?: number; y?: number; z?: number;
  rx?: number; ry?: number; rz?: number;
  s?: number; sx?: number; sy?: number; sz?: number;
}

export function placeMatrix(p: Place, out: THREE.Matrix4 = new THREE.Matrix4()): THREE.Matrix4 {
  _e.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0, 'YXZ');
  _q.setFromEuler(_e);
  const s = p.s ?? 1;
  _p.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
  _s.set((p.sx ?? 1) * s, (p.sy ?? 1) * s, (p.sz ?? 1) * s);
  return out.compose(_p, _q, _s);
}

/**
 * 여러 도형을 꼭짓점 색(과 UV)을 넣어 한 덩어리로 합친다. 그리기 호출을 줄이는 핵심 도구.
 * add 에 넘긴 도형은 복사해 쓰므로, 임시로 만든 도형은 넘긴 뒤 바로 버려도 된다(disposeSrc = true 가 기본).
 */
export class Merger {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  private extra: number[] = [];
  private cache = new Map<string, THREE.Color>();
  /** extraSize > 0 이면 꼭짓점마다 값을 더 싣는다(흔들림 세기 같은 것). */
  constructor(private withUv = false, private extraSize = 0) {}

  get vertexCount(): number { return this.pos.length / 3; }

  /**
   * @param colorOf 색 하나, 또는 꼭짓점 위치(원래 도형 좌표)에 따라 색을 정하는 함수
   */
  add(geom: THREE.BufferGeometry, color: string | ((x: number, y: number, z: number) => string), place?: Place | THREE.Matrix4, extra?: readonly number[], disposeSrc = true): this {
    const g = geom.index ? geom.toNonIndexed() : geom;
    const m = place instanceof THREE.Matrix4 ? place : place ? placeMatrix(place, _m) : _m.identity();
    _n3.getNormalMatrix(m);
    const flip = m.determinant() < 0;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const P = g.getAttribute('position').array as ArrayLike<number>;
    const N = g.getAttribute('normal').array as ArrayLike<number>;
    const U = this.withUv ? (g.getAttribute('uv')?.array as ArrayLike<number> | undefined) : undefined;
    const n = g.getAttribute('position').count;
    const e = m.elements, ne = _n3.elements;
    const pos = this.pos, nor = this.nor, col = this.col, uv = this.uv;
    const fixed = typeof color === 'string' ? _c.set(color) : null;
    const fr = fixed ? fixed.r : 0, fg = fixed ? fixed.g : 0, fb = fixed ? fixed.b : 0;
    const fn = typeof color === 'string' ? null : color;
    for (let i = 0; i < n; i++) {
      // 거울 뒤집기(음수 배율)를 했으면 삼각형의 감는 방향을 되돌린다(둘째, 셋째 꼭짓점을 맞바꾼다).
      const k = flip ? (i % 3 === 1 ? i + 1 : i % 3 === 2 ? i - 1 : i) : i;
      const o = k * 3;
      const x = P[o]!, y = P[o + 1]!, z = P[o + 2]!;
      pos.push(e[0]! * x + e[4]! * y + e[8]! * z + e[12]!, e[1]! * x + e[5]! * y + e[9]! * z + e[13]!, e[2]! * x + e[6]! * y + e[10]! * z + e[14]!);
      const nx = N[o]!, ny = N[o + 1]!, nz = N[o + 2]!;
      let ax = ne[0]! * nx + ne[3]! * ny + ne[6]! * nz, ay = ne[1]! * nx + ne[4]! * ny + ne[7]! * nz, az = ne[2]! * nx + ne[5]! * ny + ne[8]! * nz;
      const l = Math.hypot(ax, ay, az) || 1;
      ax /= l; ay /= l; az /= l;
      nor.push(ax, ay, az);
      if (fn) {
        const key = fn(x, y, z);
        let c = this.cache.get(key);
        if (!c) { c = new THREE.Color(key); this.cache.set(key, c); }
        col.push(c.r, c.g, c.b);
      } else col.push(fr, fg, fb);
      if (this.withUv) uv.push(U ? U[k * 2]! : 0, U ? U[k * 2 + 1]! : 0);
    }
    if (this.extraSize > 0) for (let i = 0; i < n; i++) for (let k = 0; k < this.extraSize; k++) this.extra.push(extra?.[k] ?? 0);
    if (g !== geom) g.dispose();
    if (disposeSrc) geom.dispose();
    return this;
  }

  /** 네 꼭짓점을 차례로(한 바퀴, 앞에서 볼 때 반시계) 주는 면. UV 는 (0,0)(1,0)(1,1)(0,1) 에 uvRect 를 적용한다. */
  quad(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[], color: string, uvRect: readonly [number, number, number, number] = [0, 0, 1, 1], extra?: readonly number[]): this {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
    const [u0, v0, u1, v1] = uvRect;
    g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1], 2));
    g.computeVertexNormals();
    return this.add(g, color, undefined, extra);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.withUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.extraSize > 0) g.setAttribute('aExtra', new THREE.Float32BufferAttribute(this.extra, this.extraSize));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    this.pos = []; this.nor = []; this.col = []; this.uv = []; this.extra = [];
    return g;
  }
}

// ---------------------------------------------------------------------------
// 자주 쓰는 둥근 도형
// ---------------------------------------------------------------------------
/** 회전체. pts 는 (반지름, 높이) 목록. 부드러운 옆모습을 원하면 점을 넉넉히 준다. */
export function lathe(pts: readonly (readonly [number, number])[], seg = 20): THREE.LatheGeometry {
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)), seg);
}

/** 부드러운 곡선으로 이은 회전체(Catmull-Rom 으로 점 사이를 채운다). */
export function smoothLathe(pts: readonly (readonly [number, number])[], seg = 20, steps = 18): THREE.LatheGeometry {
  const curve = new THREE.CatmullRomCurve3(pts.map(([r, y]) => new THREE.Vector3(r, y, 0)), false, 'catmullrom', 0.5);
  const out = curve.getPoints(steps).map((p) => new THREE.Vector2(Math.max(0.0001, p.x), p.y));
  return new THREE.LatheGeometry(out, seg);
}

/** 캡슐: y = 0 ~ len 사이(양 끝 반구 중심 기준). */
export function capsuleY(r: number, len: number, seg = 12, capSeg = 5): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(r, len, capSeg, seg);
  g.translate(0, len / 2, 0);
  return g;
}

/** 부드러운 원형 그림자/빛무리용 텍스처(가운데 진하고 밖으로 사라진다). */
export function radialTexture(size = 128, inner = 0, power = 1.6): THREE.CanvasTexture {
  const { canvas, ctx } = canvasOf(size, size);
  if (ctx) {
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
      const d = Math.min(1, Math.hypot(dx, dy));
      const k = d <= inner ? 1 : Math.pow(1 - (d - inner) / (1 - inner), power);
      const o = (y * size + x) * 4;
      img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255; img.data[o + 3] = Math.round(255 * k);
    }
    ctx.putImageData(img, 0, 0);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
