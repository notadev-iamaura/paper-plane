/**
 * 격납고와 작은 그림이 비행기를 만들 때 거치는 한 곳.
 * 비행기의 생김새(무늬, 색, 질감)는 종이 종류가 정한다: 종이 겉모습 모듈(paperLook.ts)과
 * planeMesh.ts 의 buildPlaneObject(geometry, paperId) 를 그대로 쓴다.
 */
import type { PlaneGeometry } from '../../core/index';
import type { PaperLookTier } from './paperLook';
import { FALLBACK_PAPER_LOOK_ID, PAPER_LOOK_SPECS } from './paperTextures';
import { buildPlaneObject } from './planeMesh';
import type { PlaneObject } from './planeMesh';

/** 종이 종류의 대표색(CSS 색). 무늬 없이 한 색으로 칠하는 2D 그림(실루엣)에 쓴다. */
export function paperTint(paperId: string): string {
  return (PAPER_LOOK_SPECS[paperId] ?? PAPER_LOOK_SPECS[FALLBACK_PAPER_LOOK_ID])?.tint ?? '#f8f6ef';
}

/**
 * 종이 종류의 겉모습을 입힌 비행기.
 * 격납고의 비행기는 화면에서 작게 보이므로 무늬 그림은 작은 단계(tier)로 충분하다.
 */
export function buildPaperPlane(geom: PlaneGeometry, paperId: string, linePx = 2, tier: PaperLookTier = 'low', anisotropy = 2): PlaneObject {
  return buildPlaneObject(geom, paperId, linePx, { tier, anisotropy });
}

let glOk: boolean | null = null;

/**
 * 이 기기에서 WebGL 을 쓸 수 있는지 조용히 알아본다(한 번만).
 * 그리개를 바로 만들어 보면 실패할 때 three.js 가 콘솔에 오류를 찍으므로, 먼저 여기서 확인한다.
 */
export function webglAvailable(): boolean {
  if (glOk !== null) return glOk;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') as WebGL2RenderingContext | null;
    glOk = gl !== null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    glOk = false;
  }
  return glOk;
}
