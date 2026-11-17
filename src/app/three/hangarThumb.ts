/**
 * 격납고에 넣을 때 찍어 두는 비행기의 작은 그림(160 px, data URL).
 * 격납고 선반에 놓인 모습 그대로(비스듬히 본 3D) 한 장 그려서 작게 줄이고,
 * 한 장이 약 8~12 kB 를 넘지 않게 화질을 낮춰 가며 담는다.
 * WebGL 을 쓸 수 없으면 위에서 내려다본 2D 그림(planeThumb.ts)으로 대신하고, 그것도 안 되면 undefined.
 * (그림 없이도 격납고는 잘 동작한다.)
 */
import * as THREE from 'three';
import type { PlaneGeometry } from '../../core/index';
import { tok } from '../lib/palette';
import { buildPaperPlane, webglAvailable } from './hangarPaper';
import { renderPlaneThumb } from './planeThumb';
import { canvasOf, mix } from './toon';

export const HANGAR_THUMB_PX = 160;
/** data URL 글자 수 상한(약 9 kB) */
const MAX_CHARS = 12000;

function render3d(geom: PlaneGeometry, paperId: string): string | undefined {
  const big = HANGAR_THUMB_PX * 2;
  const src = document.createElement('canvas');
  src.width = big;
  src.height = big;
  let renderer: THREE.WebGLRenderer | null = null;
  let plane: ReturnType<typeof buildPaperPlane> | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: src, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(1);
    renderer.setSize(big, big, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // 선반 뒤판과 같은 옅은 파랑 바탕
    renderer.setClearColor(new THREE.Color(mix(tok('--blue-soft'), tok('--blue'), 0.2)), 1);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(new THREE.Color('#eef2ff'), new THREE.Color('#ffdcae'), 2.2));
    const key = new THREE.DirectionalLight(new THREE.Color('#fff1d6'), 1.3);
    key.position.set(-0.5, 1, 0.6);
    scene.add(key);
    plane = buildPaperPlane(geom, paperId, 3.4, 'low', 4);
    plane.setResolution(big, big);
    const holder = new THREE.Group();
    plane.group.position.copy(plane.center).multiplyScalar(-1);
    holder.add(plane.group);
    holder.rotation.set(0.34, -0.6, 0.2, 'YZX');
    scene.add(holder);
    const fov = 28;
    const camera = new THREE.PerspectiveCamera(fov, 1, 0.01, 10);
    const dist = (plane.radius * 0.98) / Math.sin((fov * Math.PI) / 360);
    camera.position.set(0, dist * 0.36, dist * 0.93);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);

    const out = canvasOf(HANGAR_THUMB_PX, HANGAR_THUMB_PX);
    if (!out.ctx) return undefined;
    out.ctx.imageSmoothingQuality = 'high';
    out.ctx.drawImage(src, 0, 0, HANGAR_THUMB_PX, HANGAR_THUMB_PX);
    for (const [type, q] of [['image/webp', 0.88], ['image/jpeg', 0.8], ['image/webp', 0.6], ['image/jpeg', 0.6], ['image/jpeg', 0.42]] as const) {
      const url = out.canvas.toDataURL(type, q);
      if (!url.startsWith(`data:${type};base64,`)) continue; // 이 형식을 못 쓰는 브라우저
      if (url.length <= MAX_CHARS) return url;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    plane?.dispose();
    if (renderer) {
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch { /* 이미 사라진 장치 */ }
    }
  }
}

export function renderHangarThumb(geom: PlaneGeometry, paperId: string): string | undefined {
  const a = webglAvailable() ? render3d(geom, paperId) : undefined;
  if (a) return a;
  try {
    const b = renderPlaneThumb(geom, paperId, HANGAR_THUMB_PX);
    return b && b.length <= MAX_CHARS + 2000 ? b : undefined;
  } catch {
    return undefined;
  }
}
