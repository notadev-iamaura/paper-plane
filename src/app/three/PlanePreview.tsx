/**
 * 책상 위의 비행기 3D 보기. 고른 종이의 무늬 그대로, 책상 색 바닥에 부드러운 그림자를 떨구고 선다.
 *
 * - 가만히 두면 천천히 돌고(가로로 넓은 틀) 또는 좌우로 살랑거리고(세로로 긴 틀), 끌면 돌려 볼 수 있다.
 *   zoom 을 켜면 두 손가락 벌리기나 휠로 당겨 볼 수 있다.
 * - 어떤 모양이든 틀에 꼭 맞게 담는다(실제 꼭짓점으로 거리를 잰다).
 * - 접기가 하나 늘면 날개가 살짝 접혔다 펴지며 내려앉고(settle), reveal 값이 바뀌면
 *   납작한 종이가 떠오르며 비행기로 펴지는 연출(reveal)을 한다. "움직임 줄이기"를 켠 기기에서는 바로 바뀐다.
 * - 움직일 때만 다시 그리고, 화면 밖에 있으면 쉰다.
 *
 * PlaneViewer(클래스)가 장면을 맡고, PlanePreview(React)가 값의 변화를 전해 준다.
 */
import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PlaneGeometry } from '../../core/index';
import { log } from '../lib/logger';
import { tok } from '../lib/palette';
import { getPaperLookTier, usePaperLookVersion } from './paperLook';
import { buildPlaneObject } from './planeMesh';
import type { PlaneObject } from './planeMesh';
import { canvasOf, mix, texOf } from './toon';

/** 보는 방향: 멋지게(기본), 위에서, 옆에서, 앞에서 */
export type PlaneView = 'hero' | 'top' | 'side' | 'front';
export type PlaneChange = 'none' | 'settle' | 'reveal';
export type RevealPhase = 'start' | 'open' | 'done';

const FOV = 30;
const DEG = Math.PI / 180;
const IDLE_MS = 2200;
const REVEAL_MS = 1650;
const SETTLE_MS = 420;
/** 세로로 긴 틀에서 좌우로 살랑거리는 폭 */
const SWAY = 11 * DEG;

const reducedMotion = (): boolean => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

const easeInOut = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutBack = (x: number): number => { const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const easeOut = (x: number): number => 1 - Math.pow(1 - x, 3);

interface Sph { theta: number; phi: number; dist: number }

export interface PlaneViewerOpts {
  zoom?: boolean;
  autoRotate?: boolean;
  onReveal?: (phase: RevealPhase) => void;
}

export class PlaneViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 20);
  private controls: OrbitControls;
  private key: THREE.DirectionalLight;
  private ground: THREE.Mesh;
  private holder = new THREE.Group();
  private plane: PlaneObject | null = null;
  private size = { w: 1, h: 1 };
  private sph: Sph = { theta: -38 * DEG, phi: 58 * DEG, dist: 0.6 };
  private view: PlaneView = 'hero';
  private raf = 0;
  private last = 0;
  private visible = true;
  private disposed = false;
  private idleTimer = 0;
  private auto = false;
  private userTouched = false;
  private swayPhase = 0;
  private swayBase = 0;
  private camTween: { from: Sph; to: Sph; t0: number; ms: number } | null = null;
  /**
   * 접힘/펴짐 연출. el 은 지금까지 흐른 시간(ms)이다. 벽시계가 아니라 프레임마다 조금씩(최대 50 ms) 더하므로
   * 첫 프레임이 오래 걸리거나(셰이더 준비) 기기가 느려도 연출을 건너뛰지 않고 천천히 다 보여 준다.
   */
  private anim: { kind: 'settle' | 'reveal'; el: number; from: Sph; to: Sph; lift: number; opened: boolean } | null = null;
  private ro: ResizeObserver;
  private io: IntersectionObserver | null = null;
  private disposables: { dispose: () => void }[] = [];
  private opts: PlaneViewerOpts;
  private freeze: number | null = null;
  private autoTimer = 0;
  private onVis = (): void => { if (!document.hidden) this.kick(); };
  /**
   * 다른 곳(접기 판 등)을 손가락으로 누르고 있는 동안에는 스스로 도는 것을 멈춘다.
   * 종이를 끄는 동안 그 화면이 매 프레임 다시 그려지므로, 여기서까지 그리면 느린 기기에서 접기가 굼떠진다.
   */
  private held = false;
  private onDocDown = (e: PointerEvent): void => {
    if (e.target === this.canvas) return;
    this.held = true;
    this.auto = false;
    window.clearTimeout(this.idleTimer);
  };
  private onDocUp = (): void => {
    if (!this.held) return;
    this.held = false;
    this.armIdle();
  };

  constructor(private host: HTMLElement, private canvas: HTMLCanvasElement, opts: PlaneViewerOpts = {}) {
    this.opts = opts;
    const tier = getPaperLookTier();
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
    this.renderer = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const desk = tok('--desk');
    const edge = mix(desk, tok('--desk-dark'), 0.55);
    renderer.setClearColor(new THREE.Color(edge), 1);

    // 사진관처럼: 위에서 오는 주 빛, 반대쪽의 보조 빛, 하늘/바닥 빛
    this.scene.add(new THREE.HemisphereLight(new THREE.Color('#f1f4ff'), new THREE.Color('#ffdcae'), 2.2));
    const key = new THREE.DirectionalLight(new THREE.Color('#fff3dc'), 1.3);
    key.castShadow = true;
    key.shadow.mapSize.setScalar(tier === 'low' ? 512 : 1024);
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.0016;
    key.shadow.radius = 3.5;
    this.key = key;
    const fill = new THREE.DirectionalLight(new THREE.Color('#ffe9ee'), 0.38);
    fill.position.set(0.6, 0.4, -0.7);
    this.scene.add(key, key.target, fill, this.holder);

    // 책상 바닥: 가운데가 밝고 가장자리로 갈수록 살짝 어두운 나무(그림자를 받는다)
    const gc = canvasOf(256, 256);
    if (gc.ctx) {
      const g = gc.ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
      g.addColorStop(0, mix(desk, '#ffffff', 0.24));
      g.addColorStop(0.55, desk);
      g.addColorStop(1, edge);
      gc.ctx.fillStyle = g;
      gc.ctx.fillRect(0, 0, 256, 256);
      gc.ctx.strokeStyle = 'rgba(140, 90, 40, 0.13)';
      gc.ctx.lineWidth = 1.5;
      for (let x = 10; x < 256; x += 34) {
        gc.ctx.beginPath();
        gc.ctx.moveTo(x, 0);
        gc.ctx.bezierCurveTo(x + 6, 80, x - 6, 170, x + 2, 256);
        gc.ctx.stroke();
      }
    }
    const groundTex = texOf(gc.canvas, 2);
    const groundGeom = new THREE.CircleGeometry(1, 40);
    const groundMat = new THREE.MeshLambertMaterial({ map: groundTex });
    this.ground = new THREE.Mesh(groundGeom, groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.disposables.push(groundTex, groundGeom, groundMat);

    const controls = new OrbitControls(this.camera, canvas);
    controls.enablePan = false;
    controls.enableDamping = false;
    controls.enableZoom = opts.zoom === true;
    controls.minPolarAngle = 0.02;
    controls.maxPolarAngle = Math.PI * 0.94;
    controls.addEventListener('start', this.onUserStart);
    controls.addEventListener('change', this.onUserChange);
    controls.addEventListener('end', this.onUserEnd);
    this.controls = controls;

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    if (typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver((entries) => {
        const e = entries[entries.length - 1];
        if (!e) return;
        this.visible = e.isIntersecting;
        if (this.visible) this.kick();
      });
      this.io.observe(host);
    }
    document.addEventListener('visibilitychange', this.onVis);
    document.addEventListener('pointerdown', this.onDocDown, true);
    document.addEventListener('pointerup', this.onDocUp, true);
    document.addEventListener('pointercancel', this.onDocUp, true);
    this.resize();
    this.armIdle();
  }

  // ---- 바깥에서 부르는 것 ----

  setPlane(geom: PlaneGeometry, paperId: string, how: PlaneChange = 'none'): void {
    if (this.disposed) return;
    // 방금 다른 칸으로 옮겨졌을 수 있다: 틀의 크기를 지금 다시 잰다(연출의 시작과 끝 자세가 새 틀에 맞게).
    if (this.host.clientWidth !== this.size.w || this.host.clientHeight !== this.size.h) this.resize();
    const firstTime = this.plane === null;
    // 펴지는 연출 도중에 모양이 도착하면(계산이 조금 늦게 끝난다) 연출을 이어서 한다.
    const carry = this.anim?.kind === 'reveal' ? this.anim : null;
    if (carry && how !== 'reveal') how = 'reveal';
    if (this.plane) {
      this.holder.remove(this.plane.group);
      this.plane.dispose();
    }
    const plane = buildPlaneObject(geom, paperId, 2, { selfShadow: true });
    plane.setResolution(this.size.w, this.size.h);
    this.plane = plane;
    this.holder.add(plane.group);
    this.holder.position.set(0, 0, 0);
    this.holder.scale.setScalar(1);

    // 바닥은 비행기 바로 아래에, 그림자 지도는 비행기 둘레에 꼭 맞게 놓는다.
    const r = plane.radius;
    this.ground.position.set(plane.center.x, plane.box.min.y - Math.max(0.0015, r * 0.012), plane.center.z);
    this.ground.scale.setScalar(r * 7);
    this.key.target.position.copy(plane.center);
    this.key.position.copy(plane.center).add(new THREE.Vector3(-0.4, 1, 0.42).normalize().multiplyScalar(r * 6));
    const sc = this.key.shadow.camera;
    sc.left = -r * 1.5; sc.right = r * 1.5; sc.top = r * 1.5; sc.bottom = -r * 1.5;
    sc.near = r * 2; sc.far = r * 10;
    sc.updateProjectionMatrix();
    this.key.target.updateMatrixWorld();
    this.controls.target.copy(plane.center);

    const calm = reducedMotion();
    this.anim = null;
    if (firstTime || this.view === 'hero') {
      // 보는 방향은 그대로 두고 거리만 새 모양에 맞춘다(사용자가 돌려 둔 각도를 지킨다).
      const base = firstTime || !this.userTouched ? this.heroSph() : { ...this.sph, dist: this.fitAround(this.sph.phi) };
      if (firstTime || !this.userTouched) this.swayBase = base.theta;
      if (!this.controlsZoomed()) this.sph = base;
    } else {
      this.sph = this.viewSph(this.view);
    }
    this.updateZoomLimits();

    if (how === 'reveal' && !calm) {
      const to = this.heroSph();
      const from: Sph = { theta: -90 * DEG, phi: 0.06, dist: this.fitDir(-90 * DEG, 0.06) * 1.12 };
      // 한 바퀴 돌며 내려온다(가까운 쪽이 아니라 일부러 멀리 돈다).
      let sweepTo = to.theta;
      while (sweepTo < from.theta + Math.PI * 1.2) sweepTo += Math.PI * 2;
      this.view = 'hero';
      this.userTouched = false;
      this.swayBase = to.theta;
      // 납작한 종이는 책상에 놓여 있다가(겹 두께만큼만 떠서) 몸통 깊이만큼 떠오른다.
      const stack = (geom.mesh.stackCount ?? 1) * (plane.look?.thicknessM ?? 0.0003);
      const lift = Math.min(0, plane.box.min.y + stack);
      this.anim = { kind: 'reveal', el: carry ? carry.el : -1, from, to: { ...to, theta: sweepTo }, lift, opened: carry ? carry.opened : false };
      this.sph = { ...from };
      plane.setFold(0);
      this.holder.position.y = lift;
      if (!carry) this.opts.onReveal?.('start');
    } else if (how === 'settle' && !calm) {
      this.anim = { kind: 'settle', el: -1, from: this.sph, to: this.sph, lift: 0, opened: true };
      plane.setFold(0.74);
    } else if (how === 'reveal') {
      this.opts.onReveal?.('done');
    }
    this.applyCamera();
    this.armIdle();
    this.kick();
  }

  /** 보는 방향을 바꾼다(단추). */
  setView(view: PlaneView, animate = true): void {
    this.view = view;
    this.userTouched = false;
    const to = view === 'hero' ? this.heroSph() : this.viewSph(view);
    if (view === 'hero') this.swayBase = to.theta;
    this.auto = false;
    if (!animate || reducedMotion()) {
      this.sph = to;
      this.camTween = null;
      this.applyCamera();
    } else {
      this.readCamera();
      // 가까운 쪽으로 돈다.
      let d = to.theta - this.sph.theta;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.camTween = { from: { ...this.sph }, to: { ...to, theta: this.sph.theta + d }, t0: performance.now(), ms: 460 };
    }
    this.armIdle();
    this.kick();
  }

  setZoom(on: boolean): void {
    this.controls.enableZoom = on;
  }

  /**
   * 갈무리용: 펴지는 연출을 정해진 진행도(0..1)에서 멈춰 둔다. null 이면 다시 흐르게 한다.
   * 놀이 흐름에는 쓰지 않는다(캔버스의 __viewer 로만 닿는다).
   */
  debugRevealAt(x: number | null): void {
    this.freeze = x;
    if (this.anim && x === null) this.anim.el = REVEAL_MS;
    this.kick();
  }

  /** 지금 화면을 그림(PNG data URL)으로. 갈무리나 미리보기 그림에 쓴다. */
  snapshot(): string {
    this.renderNow();
    try { return this.canvas.toDataURL('image/png'); } catch { return ''; }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.idleTimer);
    window.clearTimeout(this.autoTimer);
    document.removeEventListener('visibilitychange', this.onVis);
    document.removeEventListener('pointerdown', this.onDocDown, true);
    document.removeEventListener('pointerup', this.onDocUp, true);
    document.removeEventListener('pointercancel', this.onDocUp, true);
    this.ro.disconnect();
    this.io?.disconnect();
    this.controls.removeEventListener('start', this.onUserStart);
    this.controls.removeEventListener('change', this.onUserChange);
    this.controls.removeEventListener('end', this.onUserEnd);
    this.controls.dispose();
    this.plane?.dispose();
    this.plane = null;
    for (const d of this.disposables) d.dispose();
    this.key.shadow.map?.dispose();
    this.renderer.dispose();
    // 화면을 여러 번 오가도 WebGL 문맥이 쌓이지 않게 바로 돌려준다.
    try { this.renderer.forceContextLoss(); } catch { /* 이미 사라졌으면 그만 */ }
  }

  // ---- 카메라 ----

  private get portrait(): boolean {
    return this.size.w / this.size.h < 0.92;
  }

  /** 기본으로 보여 주는 방향. 세로로 긴 틀은 뒤에서 비스듬히 내려다보고(기수가 위), 넓은 틀은 옆에서 비스듬히 본다. */
  private heroSph(): Sph {
    if (this.portrait) {
      const phi = 36 * DEG;
      const theta = -80 * DEG;
      return { theta, phi, dist: this.fitSweep(theta, phi, SWAY, 5) };
    }
    const phi = 57 * DEG;
    return { theta: -40 * DEG, phi, dist: this.fitAround(phi) };
  }

  private viewSph(view: PlaneView): Sph {
    const a: Record<Exclude<PlaneView, 'hero'>, [number, number]> = {
      top: [-90 * DEG, 0.03],
      side: [180 * DEG, 84 * DEG],
      front: [90 * DEG, 78 * DEG],
    };
    const [theta, phi] = a[view as Exclude<PlaneView, 'hero'>];
    return { theta, phi, dist: this.fitDir(theta, phi) * 1.04 };
  }

  /** 한 방향에서 볼 때 모든 꼭짓점이 틀 안에 들어오는 거리 */
  private fitDir(theta: number, phi: number): number {
    const plane = this.plane;
    if (!plane) return 0.6;
    const tanV = Math.tan((FOV * DEG) / 2);
    const tanH = tanV * (this.size.w / this.size.h);
    // 카메라 쪽 단위 벡터와 화면의 오른쪽, 위쪽
    const sp = Math.sin(phi), cp = Math.cos(phi), st = Math.sin(theta), ct = Math.cos(theta);
    const dx = sp * st, dy = cp, dz = sp * ct;
    // 오른쪽 = up(0,1,0) x d 를 정규화. 바로 위에서 볼 때는 theta 로 정한다.
    let rx = dz, rz = -dx;
    const rl = Math.hypot(rx, rz);
    if (rl < 1e-4) { rx = ct; rz = -st; } else { rx /= rl; rz /= rl; }
    // 위쪽 = d x 오른쪽
    const ux = dy * rz, uy = dz * rx - dx * rz, uz = -dy * rx;
    const c = plane.center;
    const p = plane.points;
    let need = 0.05;
    // 여백: 외곽선과 그림자가 잘리지 않게 조금 넉넉히
    const pad = 1.05;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i]! - c.x, y = p[i + 1]! - c.y, z = p[i + 2]! - c.z;
      const along = x * dx + y * dy + z * dz;
      const right = Math.abs(x * rx + z * rz);
      const up = Math.abs(x * ux + y * uy + z * uz);
      const d = Math.max((right * pad) / tanH, (up * pad) / tanV) + along;
      if (d > need) need = d;
    }
    return need;
  }

  /** 한 바퀴를 다 돌아도 잘리지 않는 거리 */
  private fitAround(phi: number): number {
    let d = 0;
    for (let i = 0; i < 12; i++) d = Math.max(d, this.fitDir((i / 12) * Math.PI * 2, phi));
    return d;
  }

  /** theta 를 가운데로 ±amp 만큼 살랑거려도 잘리지 않는 거리 */
  private fitSweep(theta: number, phi: number, amp: number, steps: number): number {
    let d = 0;
    for (let i = 0; i < steps; i++) d = Math.max(d, this.fitDir(theta - amp + (2 * amp * i) / (steps - 1), phi));
    return d;
  }

  private controlsZoomed(): boolean {
    return this.controls.enableZoom && this.userTouched;
  }

  private updateZoomLimits(): void {
    const base = this.plane ? this.plane.radius / Math.sin((FOV * DEG) / 2) : 0.6;
    this.controls.minDistance = base * 0.4;
    this.controls.maxDistance = base * 3;
  }

  private applyCamera(): void {
    const { theta, phi, dist } = this.sph;
    const t = this.controls.target;
    const sp = Math.sin(phi);
    this.camera.position.set(t.x + dist * sp * Math.sin(theta), t.y + dist * Math.cos(phi), t.z + dist * sp * Math.cos(theta));
    // 바로 위에서 볼 때 화면이 휙 돌지 않도록 "위"를 theta 에 맞춰 둔다.
    if (phi < 0.2) this.camera.up.set(-Math.sin(theta), 0.0001, -Math.cos(theta)).normalize();
    else this.camera.up.set(0, 1, 0);
    this.camera.lookAt(t);
  }

  private readCamera(): void {
    const off = this.camera.position.clone().sub(this.controls.target);
    const dist = off.length() || 0.6;
    this.sph = { dist, phi: Math.acos(Math.max(-1, Math.min(1, off.y / dist))), theta: Math.atan2(off.x, off.z) };
  }

  // ---- 사용자 조작 ----

  private onUserStart = (): void => {
    this.userTouched = true;
    this.auto = false;
    this.camTween = null;
    this.camera.up.set(0, 1, 0);
    window.clearTimeout(this.idleTimer);
  };
  private onUserChange = (): void => {
    if (this.anim || this.camTween || this.auto) return;
    this.readCamera();
    this.kick();
  };
  private onUserEnd = (): void => {
    this.readCamera();
    this.swayBase = this.sph.theta;
    this.swayPhase = 0;
    this.armIdle();
  };

  private armIdle(): void {
    window.clearTimeout(this.idleTimer);
    if (this.opts.autoRotate === false || this.held || reducedMotion()) return;
    this.idleTimer = window.setTimeout(() => {
      if (this.disposed || this.anim || this.camTween) { this.armIdle(); return; }
      if (this.view !== 'hero' && !this.userTouched) return; // 위/옆/앞에서 보는 동안은 가만히 둔다
      this.readCamera();
      this.swayBase = this.sph.theta;
      this.swayPhase = 0;
      this.auto = true;
      this.kick();
    }, IDLE_MS);
  }

  // ---- 그리기 ----

  private resize(): void {
    if (this.disposed) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    const wasPortrait = this.portrait;
    this.size.w = w;
    this.size.h = h;
    this.plane?.setResolution(w, h);
    const cap = getPaperLookTier() === 'low' ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.plane && !this.anim && !this.userTouched) {
      // 틀의 모양이 바뀌면(세로 <-> 가로, 나눔 막대를 끌었을 때) 다시 꼭 맞게 담는다.
      this.sph = this.view === 'hero' ? this.heroSph() : this.viewSph(this.view);
      if (wasPortrait !== this.portrait) this.swayBase = this.sph.theta;
      else if (this.auto) this.sph.theta = this.swayBase;
      this.applyCamera();
    }
    this.renderNow();
    this.kick();
  }

  private renderNow(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  private kick(): void {
    if (this.raf || this.disposed) return;
    if (this.autoTimer) { window.clearTimeout(this.autoTimer); this.autoTimer = 0; }
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.raf = 0;
    if (this.disposed) return;
    const dt = this.last ? Math.min(0.3, (now - this.last) / 1000) : 0.016;
    let busy = false;

    if (this.anim && this.plane) {
      const a = this.anim;
      // 첫 프레임은 처음 자세로 한 번 그리기만 하고, 그다음 프레임부터 시간이 흐른다.
      a.el = a.el < 0 ? 0 : a.el + Math.min(dt, 0.05) * 1000;
      if (a.kind === 'settle') {
        const x = Math.min(1, a.el / SETTLE_MS);
        this.plane.setFold(0.74 + 0.26 * easeOutBack(x));
        if (x >= 1) { this.plane.setFold(1); this.anim = null; } else busy = true;
      } else {
        const x = this.freeze !== null ? Math.min(0.999, this.freeze) : Math.min(1, a.el / REVEAL_MS);
        // 0 ~ 0.16: 납작한 종이가 잠깐 보인다. 0.16 ~ 0.78: 떠오르며 펴진다. 그 뒤: 내려앉는다.
        const open = Math.max(0, Math.min(1, (x - 0.16) / 0.5));
        const move = Math.max(0, Math.min(1, (x - 0.1) / 0.82));
        this.plane.setFold(open <= 0 ? 0 : easeOutBack(open));
        const hop = Math.sin(Math.PI * Math.min(1, Math.max(0, (x - 0.12) / 0.7)));
        this.holder.position.y = a.lift * (1 - easeOut(open)) + hop * this.plane.radius * 0.22;
        const pop = x > 0.82 ? Math.sin(Math.PI * (x - 0.82) / 0.18) : 0;
        this.holder.scale.setScalar(1 + 0.05 * pop);
        const e = easeInOut(move);
        this.sph = {
          theta: a.from.theta + (a.to.theta - a.from.theta) * e,
          phi: a.from.phi + (a.to.phi - a.from.phi) * easeInOut(Math.max(0, Math.min(1, (x - 0.14) / 0.6))),
          dist: a.from.dist + (a.to.dist - a.from.dist) * e,
        };
        this.applyCamera();
        if (!a.opened && open > 0) { a.opened = true; this.opts.onReveal?.('open'); }
        if (x >= 1) {
          this.plane.setFold(1);
          this.holder.position.y = 0;
          this.holder.scale.setScalar(1);
          this.sph.theta = this.swayBase;
          this.applyCamera();
          this.anim = null;
          this.opts.onReveal?.('done');
          this.armIdle();
        } else busy = true;
      }
    }

    if (this.camTween) {
      const c = this.camTween;
      const x = Math.min(1, (now - c.t0) / c.ms);
      const e = easeInOut(x);
      this.sph = {
        theta: c.from.theta + (c.to.theta - c.from.theta) * e,
        phi: c.from.phi + (c.to.phi - c.from.phi) * e,
        dist: c.from.dist + (c.to.dist - c.from.dist) * e,
      };
      this.applyCamera();
      if (x >= 1) this.camTween = null; else busy = true;
    }

    if (this.auto && !this.anim && !this.camTween) {
      if (this.portrait) {
        // 살랑살랑: 좌우로 천천히 흔든다
        this.swayPhase += dt * 0.75;
        this.sph.theta = this.swayBase + Math.sin(this.swayPhase) * SWAY;
      } else {
        // 빙글빙글: 한 바퀴에 약 24초
        this.sph.theta += dt * (Math.PI * 2) / 24;
      }
      this.applyCamera();
      busy = true;
    }

    const r0 = performance.now();
    this.renderNow();
    const renderMs = performance.now() - r0;
    this.last = now;
    if (!busy || !this.visible || document.hidden) return;
    if (this.anim || this.camTween) {
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    // 스스로 도는 동안에는 초당 30장이면 충분하다. 그리는 데 오래 걸리는 기기에서는 더 띄엄띄엄 그려서
    // 화면의 다른 일(누르기, 접기, 계산)이 밀리지 않게 한다: 그리는 시간의 두 배는 쉰다.
    const wait = Math.max(33, Math.min(260, renderMs * 3)) - 16;
    this.autoTimer = window.setTimeout(() => {
      this.autoTimer = 0;
      if (!this.disposed && !this.raf) this.raf = requestAnimationFrame(this.frame);
    }, wait);
  };
}

// ---------------------------------------------------------------------------
// React 껍데기
// ---------------------------------------------------------------------------

interface Props {
  geometry: PlaneGeometry;
  /** 종이 id. 무늬와 질감이 여기서 정해진다. */
  paperId: string;
  /** 휠, 두 손가락으로 당겨 보기 */
  zoom?: boolean;
  /** 가만히 둘 때 천천히 돌리기(기본 켬) */
  autoRotate?: boolean;
  /** 이 값이 바뀌면(0 이 아닌 값으로) "펴지는 연출"을 한다. */
  reveal?: number;
  onReveal?: (phase: RevealPhase) => void;
  testId?: string;
  label?: string;
}

export interface PlanePreviewHandle {
  setView: (view: PlaneView) => void;
}

/** 접은 모양이 달라졌는지(다듬기 값만 바뀐 것과 구별한다) 알아보는 표시 */
function foldSignature(g: PlaneGeometry): string {
  const f = g.mesh.flatXY;
  if (!f) return `${g.mesh.positions.length}`;
  let s = 0;
  for (let i = 0; i < f.length; i += 7) s += f[i]! * (i + 1);
  return `${g.mesh.stackCount ?? 0}:${f.length}:${s.toFixed(6)}`;
}

export const PlanePreview = forwardRef<PlanePreviewHandle, Props>(function PlanePreview(
  { geometry, paperId, zoom = false, autoRotate = true, reveal = 0, onReveal, testId = 'preview-canvas', label }, ref,
): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<PlaneViewer | null>(null);
  const prev = useRef<{ geom: PlaneGeometry; sig: string; paper: string; reveal: number; version: number } | null>(null);
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;
  const [failed, setFailed] = useState(false);
  const lookVersion = usePaperLookVersion();

  useImperativeHandle(ref, () => ({ setView: (view) => viewerRef.current?.setView(view) }), []);

  // 1) 처음 한 번: 장면을 만든다. 화면에서 빠질 때 모두 정리한다.
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return undefined;
    let viewer: PlaneViewer;
    try {
      viewer = new PlaneViewer(host, canvas, { zoom, autoRotate, onReveal: (p) => onRevealRef.current?.(p) });
    } catch {
      log.warn('three', '비행기 미리보기를 만들지 못했어요 (WebGL 없음)');
      setFailed(true);
      return undefined;
    }
    viewerRef.current = viewer;
    prev.current = null;
    (canvas as unknown as { __viewer?: PlaneViewer }).__viewer = viewer;
    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
    // 장면은 한 번만 만든다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { viewerRef.current?.setZoom(zoom); }, [zoom]);

  // 2) 모양이나 종이가 바뀔 때마다: 비행기 물체를 새로 만든다. 보는 방향은 그대로 둔다.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const sig = foldSignature(geometry);
    const was = prev.current;
    const wantReveal = reveal !== 0 && (!was || was.reveal !== reveal);
    // 연출 번호만 0 으로 돌아온 것(연출이 끝났다는 표시)이면 다시 만들 것이 없다.
    if (was && !wantReveal && was.geom === geometry && was.paper === paperId && was.version === lookVersion) return;
    let how: PlaneChange = 'none';
    if (wantReveal) how = 'reveal';
    else if (was && was.sig !== sig && was.paper === paperId) how = 'settle';
    prev.current = { geom: geometry, sig, paper: paperId, reveal: reveal !== 0 ? reveal : (was?.reveal ?? 0), version: lookVersion };
    viewer.setPlane(geometry, paperId, how);
  }, [geometry, paperId, reveal, lookVersion]);

  return (
    <div className="preview3d" ref={hostRef}>
      <canvas ref={canvasRef} className="preview3d__canvas" data-testid={testId} aria-label={label ?? '지금 접은 비행기 모습. 끌어서 돌려 볼 수 있어요.'} />
      {failed && <p className="preview3d__fallback">이 기기에서는 입체 그림을 보여 줄 수 없어요. 그래도 접고 던질 수 있어요.</p>}
    </div>
  );
});
