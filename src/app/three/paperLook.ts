/**
 * 종이 겉모습(paper look): 종이 종류가 정하는 무늬, 색, 질감 값의 단 하나뿐인 창구.
 * 비행기나 종이를 그리는 모든 곳(책상의 종이 카드, 접기 판, 3D 미리보기, 체육관의 비행기, 격납고 등)이 여기서 받아 쓴다.
 *
 * ── 바깥에서 쓰는 것(이 서명은 바꾸지 않는다) ─────────────────────────────────────────
 *   getPaperLook(paperId: string, tier?: PaperLookTier): PaperLook
 *       종이 한 가지의 겉모습. 같은 (종이, 단계)면 같은 객체를 돌려준다(캐시). 모르는 id 는 일반 복사지로 본다.
 *       look.frontCanvas / look.backCanvas  : 무늬가 그려진 캔버스(210:297, 위쪽이 기수 쪽). 뒷면은 뒤집어 본 모습.
 *       look.frontUrl() / look.backUrl()    : 같은 그림의 data URL(SVG <image>, CSS background 용). 처음 부를 때 만든다.
 *       look.tint / look.backTint / look.edgeColor : 대표 색(#rrggbb)
 *       look.roughness / sheen / thicknessM / translucency / floppy / sameBothSides : 그리는 쪽이 참고하는 값
 *   getPaperSwatch(paperId): PaperLook
 *       카드, 목록에 쓰는 작은 그림(가로 192). getPaperLook(paperId, 'swatch') 와 같다.
 *   createPaperMaterials(paperId, opts?): PaperMaterials
 *       three.js 재질 묶음 { front, back, edge, look, setPaper(id), dispose() }.
 *       front 는 종이 앞면(FrontSide), back 은 뒷면(BackSide, 좌우를 뒤집어 붙인다), edge 는 잘린 가장자리.
 *       도형에는 uv(= PlaneGeometry.mesh.sheetUv)와 color(밝기 조절용) 속성이 있어야 한다.
 *       비행기 전체를 만들려면 planeMesh.ts 의 buildPlaneObject(geometry, paperId) 를 쓰는 편이 쉽다.
 *   setPaperLookTier(tier) / getPaperLookTier()
 *       화질 단계. 'high' 1024, 'medium' 768, 'low' 512 (가로 화소). 바꾸면 그 뒤로 새 크기로 만든다.
 *   subscribePaperLooks(fn): () => void,  paperLookVersion(): number,  usePaperLookVersion(): number (React)
 *       무늬가 다시 만들어졌을 때(글꼴이 늦게 도착했거나 단계가 바뀌었을 때) 알려 준다. 값이 바뀌면 다시 그리면 된다.
 *   disposePaperLooks()
 *       캐시와 텍스처를 모두 비운다(시험, 화면 정리용).
 *
 * 메모리: 큰 그림은 요즘 쓴 것 몇 장만 기억한다(가장 오래 안 쓴 것부터 버리고 텍스처를 내린다).
 * 버려진 뒤에도 그 재질을 쓰는 물체가 남아 있으면 three.js 가 캔버스에서 다시 올리므로 그림이 깨지지 않는다.
 */
import { useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { log } from '../lib/logger';
import { forcedTier, pickInitialTier } from './quality';
import type { TierName } from './quality';
import {
  drawPaperFace, FALLBACK_PAPER_LOOK_ID, MASTHEAD_FONT, MASTHEAD_TEXT, PAPER_LOOK_SPECS, SHEET_H_MM, SHEET_W_MM,
} from './paperTextures';
import type { PaperLookSpec } from './paperTextures';
import { toonMat } from './toon';

export type PaperLookTier = TierName | 'swatch';

export interface PaperLook extends PaperLookSpec {
  tier: PaperLookTier;
  /** 캔버스 크기(화소) */
  width: number;
  height: number;
  frontCanvas: HTMLCanvasElement;
  /** 뒷면. 앞뒤가 같은 종이는 frontCanvas 와 같은 캔버스다. */
  backCanvas: HTMLCanvasElement;
  /** 2D 화면용 그림 주소(data URL). 처음 부를 때 만들어 기억한다. */
  frontUrl: () => string;
  backUrl: () => string;
}

const WIDTHS: Record<PaperLookTier, number> = { high: 1024, medium: 768, low: 512, swatch: 192 };
/** 큰 그림을 몇 장까지 기억할지 */
const CACHE_MAX = 6;

interface Entry {
  look: PaperLook;
  front: THREE.CanvasTexture | null;
  back: THREE.CanvasTexture | null;
}

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
let tier: TierName | null = null;
let fontAsked = false;

function bump(): void {
  version++;
  for (const fn of [...listeners]) {
    try { fn(); } catch (err) { log.warn('paper', '종이 겉모습을 알리다가 오류가 났어요', err); }
  }
}

export function paperLookVersion(): number {
  return version;
}

export function subscribePaperLooks(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** 무늬가 다시 만들어지면 값이 바뀐다. 이 값을 의존성에 넣으면 화면이 따라 바뀐다. */
export function usePaperLookVersion(): number {
  return useSyncExternalStore(subscribePaperLooks, paperLookVersion, paperLookVersion);
}

export function getPaperLookTier(): TierName {
  if (tier === null) {
    try { tier = forcedTier() ?? pickInitialTier(); } catch { tier = 'medium'; }
  }
  return tier;
}

export function setPaperLookTier(next: TierName): void {
  if (getPaperLookTier() === next) return;
  tier = next;
  bump();
}

function dropEntry(key: string): void {
  const e = cache.get(key);
  if (!e) return;
  e.front?.dispose();
  if (e.back && e.back !== e.front) e.back.dispose();
  cache.delete(key);
}

export function disposePaperLooks(): void {
  for (const key of [...cache.keys()]) dropEntry(key);
}

/**
 * 제호 글씨는 둥근 표시 글꼴(Jua)로 쓴다. 글꼴 조각이 아직 안 왔으면 불러 달라고 하고,
 * 도착하면 신문지 그림만 다시 만들도록 캐시에서 지우고 알린다.
 */
function askFont(): void {
  if (fontAsked) return;
  fontAsked = true;
  try {
    const fonts = document.fonts;
    const spec = `32px ${MASTHEAD_FONT.split(',')[0]}`;
    if (!fonts || fonts.check(spec, MASTHEAD_TEXT)) return;
    void fonts.load(spec, MASTHEAD_TEXT).then(() => {
      for (const key of [...cache.keys()]) if (key.startsWith('newsprint:')) dropEntry(key);
      bump();
    }).catch(() => { /* 글꼴이 없어도 기기 글꼴로 그린 제호가 남는다 */ });
  } catch {
    /* 글꼴 API 가 없는 환경 */
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function urlOf(canvas: HTMLCanvasElement): string {
  try {
    // 사진처럼 알갱이가 많은 그림이라 JPEG 가 훨씬 작다(불투명한 그림뿐이다).
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    return '';
  }
}

function build(id: string, t: PaperLookTier): Entry {
  const spec = PAPER_LOOK_SPECS[id]!;
  const width = WIDTHS[t];
  const height = Math.round((width * SHEET_H_MM) / SHEET_W_MM);
  if (id === 'newsprint') askFont();
  const t0 = performance.now();
  const frontCanvas = makeCanvas(width, height);
  drawPaperFace(frontCanvas, id, 'front');
  let backCanvas = frontCanvas;
  if (!spec.sameBothSides) {
    backCanvas = makeCanvas(width, height);
    drawPaperFace(backCanvas, id, 'back');
  }
  let fu: string | null = null;
  let bu: string | null = null;
  const look: PaperLook = {
    ...spec,
    tier: t,
    width,
    height,
    frontCanvas,
    backCanvas,
    frontUrl: () => (fu ??= urlOf(frontCanvas)),
    backUrl: () => (backCanvas === frontCanvas ? look.frontUrl() : (bu ??= urlOf(backCanvas))),
  };
  if (t !== 'swatch') log.debug('paper', '종이 무늬를 그렸어요', { id, tier: t, width, ms: Math.round(performance.now() - t0) });
  return { look, front: null, back: null };
}

function entryOf(paperId: string, t?: PaperLookTier): Entry {
  const id = PAPER_LOOK_SPECS[paperId] ? paperId : FALLBACK_PAPER_LOOK_ID;
  const useTier = t ?? getPaperLookTier();
  const key = `${id}:${useTier}`;
  const hit = cache.get(key);
  if (hit) {
    // 방금 쓴 것을 맨 뒤로 옮긴다(가장 오래 안 쓴 것이 맨 앞).
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const made = build(id, useTier);
  cache.set(key, made);
  // 작은 그림(카드용)은 세지 않는다. 큰 그림만 몇 장으로 묶어 둔다.
  let big = 0;
  for (const k of cache.keys()) if (!k.endsWith(':swatch')) big++;
  if (big > CACHE_MAX) {
    for (const k of cache.keys()) {
      if (k.endsWith(':swatch') || k === key) continue;
      dropEntry(k);
      break;
    }
  }
  return made;
}

export function getPaperLook(paperId: string, t?: PaperLookTier): PaperLook {
  return entryOf(paperId, t).look;
}

export function getPaperSwatch(paperId: string): PaperLook {
  return entryOf(paperId, 'swatch').look;
}

// ---------------------------------------------------------------------------
// three.js 재질
// ---------------------------------------------------------------------------

function texFrom(canvas: HTMLCanvasElement, aniso: number, mirror: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.max(1, aniso);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (mirror) {
    // 뒷면은 좌우를 뒤집어 붙여야 글씨가 바로 읽힌다(sheetUv 는 앞면을 마주 보고 잰 값이다).
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.x = -1;
    t.offset.x = 1;
  }
  return t;
}

/** 종이의 앞뒤 텍스처(캐시에 함께 묶여 있다. 직접 dispose 하지 말 것). */
export function getPaperTextures(paperId: string, t?: PaperLookTier, aniso = 4): { look: PaperLook; front: THREE.CanvasTexture; back: THREE.CanvasTexture } {
  const e = entryOf(paperId, t);
  e.front ??= texFrom(e.look.frontCanvas, aniso, false);
  // 앞뒤가 같은 종이는 같은 텍스처를 그대로 쓴다. 뒤에서 보면 무늬가 거울처럼 뒤집혀 비친다(진짜 종이도 그렇다).
  e.back ??= e.look.backCanvas === e.look.frontCanvas ? e.front : texFrom(e.look.backCanvas, aniso, true);
  return { look: e.look, front: e.front, back: e.back };
}

export interface PaperMaterialOpts {
  tier?: PaperLookTier;
  /** 텍스처 비등방성 필터 상한 */
  anisotropy?: number;
  /** 꼭짓점 색(밝기 조절)을 쓸지. 기본 true */
  vertexColors?: boolean;
}

export interface PaperMaterials {
  look: PaperLook;
  /** 종이 앞면이 보이는 쪽(FrontSide) */
  front: THREE.MeshToonMaterial;
  /** 종이 뒷면이 보이는 쪽(BackSide) */
  back: THREE.MeshToonMaterial;
  /** 잘린 가장자리(두께가 보이는 곳) */
  edge: THREE.MeshToonMaterial;
  /** 다른 종이로 바꾼다(재질 객체는 그대로 두고 그림과 값만 바꾼다). */
  setPaper: (paperId: string) => void;
  dispose: () => void;
}

export function createPaperMaterials(paperId: string, opts: PaperMaterialOpts = {}): PaperMaterials {
  const first = getPaperTextures(paperId, opts.tier, opts.anisotropy);
  const vc = opts.vertexColors ?? true;
  // 가장자리 빛: 매끈한 종이는 또렷하게, 거친 종이는 거의 없게.
  const rimOf = (look: PaperLook): number => 0.14 + 0.3 * look.sheen + 0.12 * (1 - look.roughness);
  const mk = (look: PaperLook, map: THREE.Texture, side: THREE.Side): THREE.MeshToonMaterial => {
    const m = toonMat({ color: '#ffffff', map, side, rim: rimOf(look), skin: true, vertexColors: vc });
    m.shadowSide = THREE.DoubleSide;
    return m;
  };
  const out: PaperMaterials = {
    look: first.look,
    front: mk(first.look, first.front, THREE.FrontSide),
    back: mk(first.look, first.back, THREE.BackSide),
    edge: toonMat({ color: first.look.edgeColor, side: THREE.DoubleSide, skin: true }),
    setPaper: (id) => {
      const next = getPaperTextures(id, opts.tier, opts.anisotropy);
      out.look = next.look;
      out.front.map = next.front;
      out.back.map = next.back;
      out.edge.color.set(next.look.edgeColor);
      out.front.needsUpdate = true;
      out.back.needsUpdate = true;
    },
    dispose: () => {
      // 텍스처는 캐시가 갖고 있으므로 재질만 내린다.
      out.front.dispose();
      out.back.dispose();
      out.edge.dispose();
    },
  };
  return out;
}
