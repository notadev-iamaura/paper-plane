/**
 * 바람 실험실 무대: 격납고 방 한쪽 작업대에 놓인 장난감 풍동.
 * 투명한 상자, 한쪽 끝의 큼직한 선풍기, 벌집 모양 바람 고르개, 무게중심을 받친 받침대 위의 비행기,
 * 그 곁을 흘러가는 연기 줄, 힘 화살표, 위에 달린 용수철 저울과 바람 세기 바늘.
 *
 * - 그림체와 화질 단계는 격납고(HangarStage)와 같은 도구(toon.ts, quality.ts)를 쓴다.
 * - 연기와 화살표는 받은 값(TunnelView)을 그대로 그릴 뿐이다. 힘은 core 가 계산하고,
 *   연기 줄의 자리는 lib/lab/flowModel.ts 가 그 힘에서 만든 그림이다(유체 계산이 아니다).
 * - 바람이 불 때만 이어서 그리고(초당 장수에 상한), 멈추면 한 장만 그린다. 가려지면 쉰다. 화면에서 빠질 때 모두 정리한다.
 *
 * 좌표: 바람 좌표 (s 뒤쪽 +, y 위, z 비행기 오른쪽) -> three (X, Y, Z) = (-s, y, z). 받침대 축(무게중심)이 원점.
 * 카메라는 비행기 왼쪽 뒤에서 본다: 화면 왼쪽에 선풍기, 바람은 왼쪽에서 오른쪽으로 흐른다.
 */
import * as THREE from 'three';
import type { PlaneGeometry, TunnelReading } from '../../core/index';
import { flowPoint, rakeHeights, SMOKE_PACE, vortexPoint } from '../lib/lab/flowModel';
import type { FlowModel, FlowPointOut } from '../lib/lab/flowModel';
import { arrowLength } from '../lib/lab/labMath';
import { tok } from '../lib/palette';
import { buildPaperPlane } from './hangarPaper';
import { subscribePaperLooks } from './paperLook';
import type { PlaneObject } from './planeMesh';
import { forcedTier, Governor, pickInitialTier, TIERS } from './quality';
import type { Tier, TierName } from './quality';
import { canvasOf, lathe, Merger, mix, outlineMat, radialTexture, seeded, texOf, toonMat, Trash } from './toon';
import { createWingBend } from './tunnelBend';
import type { WingBend } from './tunnelBend';

export interface TunnelView {
  speedMps: number;
  /** 화면에 보이는 고개 각도(도). 균형 잡기에서 뒤집힐 때는 한도 밖의 값도 온다. */
  alphaDeg: number;
  betaDeg: number;
  reading: TunnelReading | null;
  model: FlowModel | null;
  /** 띠마다의 작은 힘 화살표를 보일지 */
  detail: boolean;
  /** 붙여 둔 값(견주기)의 흐린 화살표. 없으면 null */
  ghost: { liftN: number; dragN: number } | null;
  /** 힘 화살표를 보일지(뒤집히는 동안에는 숨긴다) */
  arrows: boolean;
  /** 바람이 떨어져 나가 덜덜 떠는 정도 0..1 */
  shake: number;
}

export interface Pt { x: number; y: number }
export interface TunnelAnchors {
  /** 받침대 축(비행기를 돌리는 중심) */
  pivot: Pt;
  /** 화살표 끝(이름표를 붙일 자리). 화살표가 없으면 null */
  lift: Pt | null;
  drag: Pt | null;
  weight: Pt | null;
  /** 화면에서 1 m 가 몇 px 인지(축 근처) */
  pxPerM: number;
}

export interface TunnelStageOpts {
  onSlow: () => void;
  onLost: () => void;
  /** 그릴 때마다 화살표 끝의 화면 자리를 알려 준다(이름표를 따라 붙인다) */
  onAnchors?: (a: TunnelAnchors) => void;
}

export interface TunnelDebug {
  tier: (name: TierName) => void;
  info: () => { tier: TierName; calls: number; triangles: number; frames: number; frameMs: number; intervalMs: number; lines: number; segments: number; puffs: number; animating: boolean; pixelRatio: number; fpsCap: number; geometries: number; textures: number };
  anchors: () => TunnelAnchors;
  /** 한 장을 강제로 그린다(갈무리용) */
  render: () => void;
  /** 연기 무늬의 시각을 정해 준다(갈무리를 같은 모습으로 찍으려고) */
  setTime: (t: number) => void;
}

/** 화질 단계마다의 연기 양 */
export const SMOKE_BUDGET: Record<TierName, { near: number; far: number; segs: number; vortexArms: number; puffs: number; fps: number }> = {
  high: { near: 9, far: 5, segs: 72, vortexArms: 2, puffs: 160, fps: 60 },
  medium: { near: 7, far: 0, segs: 56, vortexArms: 2, puffs: 130, fps: 45 },
  low: { near: 7, far: 0, segs: 44, vortexArms: 1, puffs: 60, fps: 30 },
};

const FOV = 26;
const DEG = Math.PI / 180;
const CAM_YAW = 30 * DEG;   // 옆에서 얼마나 뒤쪽으로 돌아가 보는지
const CAM_UP = 27 * DEG;

interface Dims { sIn: number; sOut: number; hy: number; hz: number; fanR: number }

class Arrow {
  group = new THREE.Group();
  private shaft: THREE.Mesh;
  private head: THREE.Mesh;
  private shaftLine: THREE.Mesh | null = null;
  private headLine: THREE.Mesh | null = null;
  private up = new THREE.Vector3(0, 1, 0);
  constructor(shaftGeom: THREE.BufferGeometry, headGeom: THREE.BufferGeometry, fill: THREE.Material, line: THREE.Material | null, private headLen: number) {
    this.shaft = new THREE.Mesh(shaftGeom, fill);
    this.head = new THREE.Mesh(headGeom, fill);
    if (line) {
      this.shaftLine = new THREE.Mesh(shaftGeom, line);
      this.headLine = new THREE.Mesh(headGeom, line);
      this.shaftLine.renderOrder = 20; this.headLine.renderOrder = 20;
      this.group.add(this.shaftLine, this.headLine);
    }
    this.shaft.renderOrder = 21; this.head.renderOrder = 21;
    this.group.add(this.shaft, this.head);
    this.group.visible = false;
  }
  /** origin 에서 dir(단위 벡터) 쪽으로 length(m) 만큼. 너무 짧으면 숨긴다. */
  set(origin: THREE.Vector3, dir: THREE.Vector3, length: number): void {
    const len = Math.abs(length);
    if (len < 0.004) { this.group.visible = false; return; }
    this.group.visible = true;
    this.group.position.copy(origin);
    this.group.quaternion.setFromUnitVectors(this.up, length < 0 ? dir.clone().negate() : dir);
    const head = Math.min(this.headLen, len * 0.6);
    const k = head / this.headLen;
    const shaft = Math.max(0.0005, len - head);
    for (const m of [this.shaft, this.shaftLine]) if (m) m.scale.set(1, shaft, 1);
    for (const m of [this.head, this.headLine]) if (m) { m.position.set(0, shaft, 0); m.scale.set(Math.max(0.6, k), k, Math.max(0.6, k)); }
  }
  tip(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.group.visible) return null;
    const m = this.head;
    return out.set(0, m.position.y + this.headLen * m.scale.y, 0).applyQuaternion(this.group.quaternion).add(this.group.position);
  }
}

export class TunnelStage {
  debug: TunnelDebug;

  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 20);
  private trash = new Trash();
  private boxTrash = new Trash();
  private tier: Tier;
  private governor: Governor;

  private room = new THREE.Group();
  private box = new THREE.Group();
  private fanBlades = new THREE.Group();
  private dialNeedle = new THREE.Group();
  private scaleMark: THREE.Mesh | null = null;
  private glass: THREE.Mesh | null = null;
  private dims: Dims = { sIn: -0.25, sOut: 0.4, hy: 0.16, hz: 0.16, fanR: 0.13 };

  private wrapper = new THREE.Group();
  private inner = new THREE.Group();
  private plane: PlaneObject | null = null;
  private bend: WingBend | null = null;
  private geom: PlaneGeometry | null = null;
  private paperId = '';
  private blob: THREE.Mesh;
  private elemLines: THREE.LineSegments;

  /** 연기 줄: 카메라를 보는 얇은 띠들을 한 덩어리로 그린다(가장자리가 부드럽고, 무늬를 밀어서 흐르는 것처럼 보이게 한다) */
  private ribbon: THREE.Mesh;
  private ribbonMat: THREE.MeshBasicMaterial;
  private ribbonTex: THREE.CanvasTexture;
  private ribPos: Float32Array = new Float32Array(6);
  private ribUv: Float32Array = new Float32Array(4);
  private ribCentre: Float32Array = new Float32Array(3);
  private smokeStamp = '';
  private lineDefs: { kind: 'flow' | 'vortex'; z0: number; y0: number; tip: 0 | 1; arm: number; shade: number }[] = [];
  private segs = 30;
  /** 연기 알갱이: 카메라를 보는 작은 네모들을 한 덩어리로 그린다(점 그리기보다 어느 기기에서나 가볍다) */
  private puffs: THREE.Mesh;
  private puffPos: Float32Array = new Float32Array(12);
  private puffState: { line: number; s: number; j1: number; j2: number }[] = [];

  private arrowLift: Arrow;
  private arrowDrag: Arrow;
  private arrowWeight: Arrow;
  private ghostLift: Arrow;
  private ghostDrag: Arrow;

  private view: TunnelView = { speedMps: 0, alphaDeg: 0, betaDeg: 0, reading: null, model: null, detail: false, ghost: null, arrows: true, shake: 0 };
  private time = 0;
  private modelSeq = 0;
  private camDist = 1;
  private timeFixed: number | null = null;
  private dash = 0;
  private fanSpin = 0;
  private fanVel = 0;

  private w = 1;
  private h = 1;
  private active = true;
  private disposed = false;
  private lost = false;
  private rafId = 0;
  private lastNow = 0;
  private lastDraw = 0;
  private needs = true;
  private frames = 0;
  private frameMs = 0;
  private intervalMs = 0;
  private slowRun = 0;
  private streak = 0;
  private anchorsNow: TunnelAnchors = { pivot: { x: 0, y: 0 }, lift: null, drag: null, weight: null, pxPerM: 400 };

  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private fp: FlowPointOut = { s: 0, y: 0, z: 0, pace: 1, rough: 0 };
  private vp = { s: 0, y: 0, z: 0 };
  private rnd = seeded(4242);
  private onCtxLost: (e: Event) => void;
  private onVis: () => void;
  private unsubPaper: () => void = () => undefined;

  constructor(private renderer: THREE.WebGLRenderer, private opts: TunnelStageOpts) {
    const keep = <T extends { dispose: () => void }>(x: T): T => this.trash.keep(x);
    this.tier = TIERS[pickInitialTier(renderer.getContext())];
    this.governor = new Governor(this.tier.name, (t) => this.applyTier(TIERS[t]));

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = false;
    const haze = new THREE.Color(mix(tok('--wall'), tok('--yellow-soft'), 0.35));
    renderer.setClearColor(haze, 1);
    this.scene.background = haze;

    // 빛은 격납고와 같은 색: 위는 차가운 하늘빛, 아래는 마루에 되비친 따뜻한 빛.
    const hemi = new THREE.HemisphereLight(new THREE.Color('#e9eeff'), new THREE.Color('#ffd7a8'), 2.1);
    const key = new THREE.DirectionalLight(new THREE.Color('#fff0d2'), 1.45);
    key.position.set(1.2, 2.4, -3.2);
    const fill = new THREE.DirectionalLight(new THREE.Color('#ffe2e6'), 0.35);
    fill.position.set(-2.5, 1.2, -2);
    this.scene.add(hemi, key, fill, this.room, this.box);

    // ---- 비행기 자리 ----
    this.wrapper.rotation.order = 'YZX';
    this.wrapper.add(this.inner);
    this.scene.add(this.wrapper);
    const blobTex = keep(radialTexture(64, 0.1, 1.5));
    this.blob = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), keep(new THREE.MeshBasicMaterial({ map: blobTex, color: 0x3a2a18, transparent: true, opacity: 0.3, depthWrite: false })));
    this.scene.add(this.blob);
    this.elemLines = new THREE.LineSegments(new THREE.BufferGeometry(), keep(new THREE.LineBasicMaterial({ color: new THREE.Color(tok('--yellow')), depthTest: false, transparent: true })));
    this.elemLines.renderOrder = 19;
    this.elemLines.frustumCulled = false;
    this.elemLines.visible = false;
    this.inner.add(this.elemLines);

    // ---- 연기 줄: 가운데는 희고 가장자리는 옅은 남색으로 번지는 띠(흰 종이 위에서도 보인다). 띠 무늬의 짧은 틈이 바람을 따라 흘러간다 ----
    const smoke = new THREE.Color(mix(tok('--paper'), '#ffffff', 0.6));
    const rc = canvasOf(128, 16);
    if (rc.ctx) {
      const img = rc.ctx.createImageData(128, 16);
      const inkC = new THREE.Color(tok('--ink'));
      for (let y = 0; y < 16; y++) for (let x = 0; x < 128; x++) {
        const v = Math.abs((y + 0.5) / 16 - 0.5) * 2;      // 0 가운데, 1 가장자리
        const core = v < 0.42 ? 1 : Math.max(0, 1 - (v - 0.42) / 0.2);
        const halo = Math.max(0, 1 - v) * 0.5;
        const u = (x + 0.5) / 128;
        const gap = u > 0.9 ? 0.25 + 0.75 * Math.abs((u - 0.95) / 0.05) : 1; // 줄 사이의 옅은 틈
        const a = Math.min(1, core + halo * (1 - core)) * gap;
        const o = (y * 128 + x) * 4;
        img.data[o] = Math.round(255 * (core + (1 - core) * inkC.r));
        img.data[o + 1] = Math.round(255 * (core + (1 - core) * inkC.g));
        img.data[o + 2] = Math.round(255 * (core + (1 - core) * inkC.b));
        img.data[o + 3] = Math.round(255 * a);
      }
      rc.ctx.putImageData(img, 0, 0);
    }
    this.ribbonTex = keep(texOf(rc.canvas, 1));
    this.ribbonTex.wrapS = THREE.RepeatWrapping;
    this.ribbonMat = keep(new THREE.MeshBasicMaterial({ map: this.ribbonTex, color: smoke, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
    this.ribbon = new THREE.Mesh(new THREE.BufferGeometry(), this.ribbonMat);
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 6;
    this.scene.add(this.ribbon);

    const puffTex = keep(radialTexture(64, 0.12, 1.7));
    const puffMat = keep(new THREE.MeshBasicMaterial({ map: puffTex, color: smoke, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
    this.puffs = new THREE.Mesh(new THREE.BufferGeometry(), puffMat);
    this.puffs.frustumCulled = false;
    this.puffs.renderOrder = 7;
    this.scene.add(this.puffs);

    // ---- 힘 화살표 ----
    const shaftGeom = keep(new THREE.CylinderGeometry(0.0034, 0.0034, 1, 10).translate(0, 0.5, 0));
    const headLen = 0.02;
    const headGeom = keep(new THREE.ConeGeometry(0.0095, headLen, 14).translate(0, headLen / 2, 0));
    const flat = (c: string, opacity = 1): THREE.MeshBasicMaterial => keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(c), depthTest: false, transparent: true, opacity }));
    const lineM = keep(outlineMat(0.0019));
    lineM.depthTest = false;
    lineM.transparent = true;
    this.arrowLift = new Arrow(shaftGeom, headGeom, flat(tok('--green')), lineM, headLen);
    this.arrowDrag = new Arrow(shaftGeom, headGeom, flat(tok('--red')), lineM, headLen);
    this.arrowWeight = new Arrow(shaftGeom, headGeom, flat(tok('--purple')), lineM, headLen);
    this.ghostLift = new Arrow(shaftGeom, headGeom, flat(tok('--green'), 0.38), null, headLen);
    this.ghostDrag = new Arrow(shaftGeom, headGeom, flat(tok('--red'), 0.38), null, headLen);
    this.scene.add(this.ghostLift.group, this.ghostDrag.group, this.arrowLift.group, this.arrowDrag.group, this.arrowWeight.group);

    this.buildRoom(keep);
    this.buildBox();
    this.buildSmoke();

    const el = renderer.domElement;
    this.onCtxLost = (e) => {
      e.preventDefault();
      this.lost = true;
      this.halt();
      this.opts.onLost();
    };
    el.addEventListener('webglcontextlost', this.onCtxLost);
    this.onVis = () => { if (!document.hidden) this.invalidate(); };
    document.addEventListener('visibilitychange', this.onVis);
    // 종이 무늬가 다시 만들어지면(글꼴이 늦게 도착한 신문지 제호 등) 비행기를 다시 만든다.
    this.unsubPaper = subscribePaperLooks(() => {
      if (this.disposed || !this.geom) return;
      const g = this.geom, p = this.paperId;
      this.geom = null;
      this.setPlane(g, p);
    });

    this.applyTier(this.tier);

    this.debug = {
      tier: (name) => this.governor.lock(name),
      info: () => ({
        tier: this.tier.name,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        frames: this.frames,
        frameMs: this.frameMs,
        intervalMs: this.intervalMs,
        lines: this.lineDefs.length,
        segments: this.lineDefs.length * this.segs,
        puffs: this.puffState.length,
        animating: this.rafId !== 0,
        pixelRatio: renderer.getPixelRatio(),
        fpsCap: SMOKE_BUDGET[this.tier.name].fps,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
      }),
      anchors: () => { this.draw(0); return this.anchorsNow; },
      render: () => { if (!this.lost) this.draw(0); },
      setTime: (t) => { this.timeFixed = t; this.invalidate(); },
    };
  }

  // -------------------------------------------------------------------------
  // 방(작업대와 뒷벽): 격납고의 한쪽 구석
  // -------------------------------------------------------------------------
  private buildRoom(keep: <T extends { dispose: () => void }>(x: T) => T): void {
    const wood = tok('--desk'), woodDark = tok('--desk-dark'), woodDeep = tok('--court-dark');
    const m = new Merger();
    // 작업대 상판과 앞 테두리
    m.add(new THREE.BoxGeometry(3.2, 0.04, 1.3), wood, { y: -0.02, z: 0.2 });
    m.add(new THREE.BoxGeometry(3.2, 0.05, 0.02), woodDark, { y: -0.03, z: -0.455 });
    // 뒷벽의 선반 널과 초록 매트(격납고와 같은 재료)
    m.add(new THREE.BoxGeometry(3.4, 0.03, 0.12), woodDeep, { y: 0.52, z: 0.8 });
    m.add(new THREE.BoxGeometry(3.4, 0.03, 0.12), woodDeep, { y: 0.92, z: 0.8 });
    m.add(new THREE.BoxGeometry(3.6, 0.3, 0.02), tok('--mat'), { y: 0.15, z: 0.86 });
    m.add(new THREE.BoxGeometry(3.6, 0.012, 0.024), tok('--mat-dark'), { y: 0.302, z: 0.86 });
    const mesh = new THREE.Mesh(keep(m.build()), keep(toonMat({ vertexColors: true, rim: 0.2 })));
    const wall = new THREE.Mesh(keep(new THREE.PlaneGeometry(5, 2.4)), keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(mix(tok('--wall'), tok('--yellow-soft'), 0.3)) })));
    wall.position.set(0, 1.0, 0.9);
    wall.rotation.y = Math.PI;
    this.room.add(mesh, wall);
  }

  // -------------------------------------------------------------------------
  // 풍동 상자: 비행기 크기에 맞춰 다시 만든다
  // -------------------------------------------------------------------------
  private buildBox(): void {
    this.boxTrash.dispose();
    this.box.clear();
    this.fanBlades = new THREE.Group();
    this.dialNeedle = new THREE.Group();
    const keep = <T extends { dispose: () => void }>(x: T): T => this.boxTrash.keep(x);
    const { sIn, sOut, hy, hz, fanR } = this.dims;
    const inkC = tok('--ink'), paper = tok('--paper'), yellow = tok('--yellow'), blue = tok('--blue');
    const len = sOut - sIn;
    const xc = -(sIn + sOut) / 2;
    const floorY = -hy;
    // 상자 전체를 작업대 위에 올린다: 작업대 윗면이 y = floorY - 0.012 에 오도록 방을 내린다.
    this.room.position.y = floorY - 0.012;

    // 틀(남색 막대)과 모서리 색 조각, 바닥 판
    const bar = 0.009;
    const m = new Merger();
    for (const y of [-hy, hy]) for (const z of [-hz, hz]) m.add(new THREE.BoxGeometry(len + bar, bar, bar), inkC, { x: xc, y, z });
    for (const s of [sIn, sOut]) {
      for (const z of [-hz, hz]) m.add(new THREE.BoxGeometry(bar, 2 * hy, bar), inkC, { x: -s, z });
      for (const y of [-hy, hy]) m.add(new THREE.BoxGeometry(bar, bar, 2 * hz), inkC, { x: -s, y });
      for (const y of [-hy, hy]) for (const z of [-hz, hz]) m.add(new THREE.BoxGeometry(0.02, 0.02, 0.02), yellow, { x: -s, y, z });
    }
    // 바닥도 칠판 색: 흰 종이 비행기와 흰 연기가 또렷하게 보인다.
    m.add(new THREE.BoxGeometry(len, 0.008, 2 * hz), mix(tok('--board'), tok('--blue'), 0.22), { x: xc, y: floorY - 0.004 });
    // 받침대: 바닥의 둥근 발과 가는 기둥, 축의 구슬
    m.add(new THREE.CylinderGeometry(0.03, 0.036, 0.012, 20), tok('--desk-dark'), { y: floorY + 0.006 });
    m.add(new THREE.CylinderGeometry(0.0036, 0.0046, hy - 0.004, 8), mix(yellow, paper, 0.3), { y: floorY + (hy - 0.004) / 2 });
    m.add(new THREE.SphereGeometry(0.0075, 12, 8), yellow, {});
    // 선풍기 몸통: 파란 고리와 뒤쪽 모터 덮개, 받침 발
    const fx = -(sIn - 0.05);
    const ring = lathe([[fanR, -0.045], [fanR + 0.02, -0.045], [fanR + 0.026, 0], [fanR + 0.02, 0.045], [fanR, 0.045]], 28).rotateZ(Math.PI / 2);
    m.add(ring, blue, { x: fx });
    m.add(new THREE.SphereGeometry(0.04, 16, 10), yellow, { x: fx + 0.045, sx: 1.2 });
    m.add(new THREE.BoxGeometry(0.11, hy - fanR + 0.004, 0.2), mix(blue, inkC, 0.25), { x: fx, y: floorY + (hy - fanR + 0.004) / 2 - 0.004 });
    // 모터에서 고리로 가는 살(십자)
    for (let i = 0; i < 4; i++) m.add(new THREE.BoxGeometry(0.008, fanR, 0.008), inkC, { x: fx + 0.03, y: Math.cos((i * Math.PI) / 2 + 0.6) * fanR / 2, z: Math.sin((i * Math.PI) / 2 + 0.6) * fanR / 2, rx: (i * Math.PI) / 2 + 0.6 });
    // 용수철 저울(상자 위): 노란 통과 흰 눈금 창
    const sc = this.scaleX();
    m.add(new THREE.BoxGeometry(0.036, 0.1, 0.026), yellow, { x: sc, y: hy + 0.056 });
    m.add(new THREE.BoxGeometry(0.02, 0.084, 0.004), paper, { x: sc, y: hy + 0.056, z: -0.0135 });
    m.add(new THREE.BoxGeometry(0.02, 0.003, 0.005), tok('--green'), { x: sc, y: hy + 0.014 + 0.084 * (1 / 2.4), z: -0.0145 });
    m.add(new THREE.TorusGeometry(0.008, 0.002, 6, 12), inkC, { x: sc, y: hy + 0.112 });
    const body = new THREE.Mesh(keep(m.build()), keep(toonMat({ vertexColors: true, rim: 0.25 })));
    this.box.add(body);
    const mark = new THREE.Mesh(keep(new THREE.BoxGeometry(0.026, 0.006, 0.006)), keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(tok('--red')) })));
    mark.position.set(sc, hy + 0.014, -0.0155);
    this.scaleMark = mark;
    this.box.add(mark);

    // 뒤판: 짙은 남색 칠판(흰 연기가 잘 보인다)에 옅은 모눈
    const bc = canvasOf(256, 128);
    if (bc.ctx) {
      const c = bc.ctx;
      c.fillStyle = tok('--board');
      c.fillRect(0, 0, 256, 128);
      c.strokeStyle = 'rgba(201, 220, 242, 0.13)';
      c.lineWidth = 1;
      for (let x = 0; x <= 256; x += 16) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, 128); c.stroke(); }
      for (let y = 0; y <= 128; y += 16) { c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(256, y + 0.5); c.stroke(); }
    }
    const boardTex = keep(texOf(bc.canvas, 2));
    const board = new THREE.Mesh(keep(new THREE.PlaneGeometry(len, 2 * hy)), keep(new THREE.MeshBasicMaterial({ map: boardTex })));
    board.position.set(xc, 0, hz - 0.001);
    board.rotation.y = Math.PI;
    this.box.add(board);

    // 앞 유리: 거의 안 보이는 판과 비스듬한 빛 줄기 둘
    const gc = canvasOf(128, 64);
    if (gc.ctx) {
      const c = gc.ctx;
      c.fillStyle = 'rgba(255,255,255,0.03)';
      c.fillRect(0, 0, 128, 64);
      c.fillStyle = 'rgba(255,255,255,0.09)';
      c.beginPath(); c.moveTo(96, 0); c.lineTo(108, 0); c.lineTo(84, 64); c.lineTo(72, 64); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(114, 0); c.lineTo(119, 0); c.lineTo(95, 64); c.lineTo(90, 64); c.closePath(); c.fill();
    }
    const glass = new THREE.Mesh(keep(new THREE.PlaneGeometry(len, 2 * hy)), keep(new THREE.MeshBasicMaterial({ map: keep(texOf(gc.canvas)), transparent: true, depthWrite: false })));
    glass.position.set(xc, 0, -hz);
    glass.rotation.y = Math.PI;
    glass.renderOrder = 9;
    // 낮은 화질에서는 화면을 넓게 덮는 반투명 판을 그리지 않는다(틀만으로도 상자로 읽힌다).
    glass.visible = this.tier.name !== 'low';
    this.glass = glass;
    this.box.add(glass);

    // 벌집 바람 고르개: 굵은 벌집 무늬(사이로 선풍기 날개가 보인다)
    const hc = canvasOf(256, 256);
    if (hc.ctx) {
      const c = hc.ctx;
      c.clearRect(0, 0, 256, 256);
      c.strokeStyle = mix(mix(tok('--yellow'), paper, 0.5), tok('--board'), 0.3);
      c.lineWidth = 3;
      c.lineJoin = 'round';
      const r = 20, hgt = Math.sqrt(3) * r;
      for (let row = -1; row < 9; row++) for (let col = -1; col < 10; col++) {
        const cx = col * 1.5 * r, cy = row * hgt + (col % 2 === 0 ? 0 : hgt / 2);
        c.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3;
          const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
          if (k === 0) c.moveTo(px, py); else c.lineTo(px, py);
        }
        c.closePath();
        c.stroke();
      }
    }
    const honeyTex = keep(texOf(hc.canvas, 2));
    const honey = new THREE.Mesh(keep(new THREE.PlaneGeometry(2 * hz, 2 * hy)), keep(new THREE.MeshBasicMaterial({ map: honeyTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide })));
    honey.position.set(-sIn, 0, 0);
    honey.rotation.y = Math.PI / 2;
    this.box.add(honey);

    // 선풍기 날개(돌아간다)와 가운데 얼굴(돌지 않는다)
    const bm = new Merger();
    const cols = [tok('--red'), tok('--yellow'), tok('--green'), tok('--sky')];
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      bm.add(new THREE.SphereGeometry(1, 12, 8), cols[i]!, { y: Math.cos(a) * fanR * 0.52, z: Math.sin(a) * fanR * 0.52, rx: a, sx: 0.006, sy: fanR * 0.44, sz: fanR * 0.25 });
    }
    const blades = new THREE.Mesh(keep(bm.build()), keep(toonMat({ vertexColors: true, rim: 0.2 })));
    blades.rotation.x = 0.0;
    this.fanBlades.add(blades);
    this.fanBlades.position.set(fx - 0.006, 0, 0);
    const hm = new Merger();
    hm.add(new THREE.SphereGeometry(0.03, 16, 10), paper, { sx: 0.5 });
    // 얼굴: 눈 둘과 웃는 입(바람이 나가는 쪽 = 카메라 쪽을 본다)
    hm.add(new THREE.SphereGeometry(0.0042, 8, 6), inkC, { x: -0.0145, y: 0.007, z: -0.01 });
    hm.add(new THREE.SphereGeometry(0.0042, 8, 6), inkC, { x: -0.0145, y: 0.007, z: 0.01 });
    hm.add(new THREE.TorusGeometry(0.009, 0.0018, 6, 12, Math.PI), inkC, { x: -0.0148, y: -0.004, ry: Math.PI / 2, rx: Math.PI });
    const hub = new THREE.Mesh(keep(hm.build()), keep(toonMat({ vertexColors: true, rim: 0.2 })));
    hub.position.set(fx - 0.016, 0, 0);
    this.box.add(this.fanBlades, hub);

    // 바람 세기 바늘(선풍기 고리 위의 둥근 판)
    const dm = new Merger();
    dm.add(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 20), inkC, { rx: Math.PI / 2 });
    dm.add(new THREE.CylinderGeometry(0.025, 0.025, 0.009, 20), paper, { rx: Math.PI / 2, z: -0.001 });
    for (let i = 0; i < 5; i++) {
      const a = (-120 + i * 60) * DEG;
      dm.add(new THREE.BoxGeometry(0.003, 0.006, 0.002), i >= 3 ? tok('--red') : inkC, { x: -Math.sin(a) * 0.02, y: Math.cos(a) * 0.02, z: -0.0058, rz: -a });
    }
    const dial = new THREE.Mesh(keep(dm.build()), keep(new THREE.MeshBasicMaterial({ vertexColors: true })));
    const needle = new THREE.Mesh(keep(new THREE.BoxGeometry(0.0035, 0.02, 0.002).translate(0, 0.008, 0)), keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(tok('--red')) })));
    needle.position.z = -0.0075;
    this.dialNeedle.add(needle);
    const dialGroup = new THREE.Group();
    dialGroup.add(dial, this.dialNeedle);
    dialGroup.position.set(fx, fanR + 0.05, -0.02);
    this.box.add(dialGroup);

    this.blob.position.set(0, floorY + 0.001, 0);
  }

  private scaleX(): number {
    return -(this.dims.sOut - 0.07);
  }

  // -------------------------------------------------------------------------
  // 연기 줄과 연기 알갱이의 버퍼(화질 단계나 상자 크기가 바뀌면 다시 잡는다)
  // -------------------------------------------------------------------------
  private buildSmoke(): void {
    const b = SMOKE_BUDGET[this.tier.name];
    const m = this.view.model;
    const half = m ? m.spanHalfM : 0.08;
    const zNear = -Math.min(this.dims.hz - 0.03, half * 0.55);
    const defs: typeof this.lineDefs = [];
    for (const y0 of rakeHeights(b.near, Math.min(0.026, (this.dims.hy * 1.5) / b.near))) defs.push({ kind: 'flow', z0: zNear, y0, tip: 0, arm: 0, shade: 1 });
    for (const y0 of rakeHeights(b.far, 0.026)) defs.push({ kind: 'flow', z0: -zNear, y0, tip: 0, arm: 0, shade: 0.32 });
    for (let arm = 0; arm < b.vortexArms; arm++) {
      defs.push({ kind: 'vortex', z0: 0, y0: 0, tip: 1, arm, shade: 0.95 });
      defs.push({ kind: 'vortex', z0: 0, y0: 0, tip: 0, arm, shade: 0.6 });
    }
    this.lineDefs = defs;
    this.segs = b.segs;
    // 줄마다 점 (segs + 1)개, 점마다 띠의 양쪽 꼭짓점 둘.
    const P = this.segs + 1;
    const nv = defs.length * P * 2;
    this.ribPos = new Float32Array(nv * 3);
    this.ribUv = new Float32Array(nv * 2);
    this.ribCentre = new Float32Array(P * 4);
    const colors = new Float32Array(nv * 3);
    const index: number[] = [];
    const board = new THREE.Color(tok('--board'));
    const white = new THREE.Color(1, 1, 1);
    const tint = new THREE.Color(mix(tok('--sky'), '#ffffff', 0.55));
    const c = new THREE.Color();
    defs.forEach((d, li) => {
      c.copy(d.kind === 'vortex' ? tint : white).lerp(board, 1 - d.shade);
      const base = li * P * 2;
      for (let k = 0; k < P * 2; k++) { const o = (base + k) * 3; colors[o] = c.r; colors[o + 1] = c.g; colors[o + 2] = c.b; }
      for (let k = 0; k < this.segs; k++) { const a = base + k * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    });
    this.ribbon.geometry.dispose();
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.ribPos, 3));
    rg.setAttribute('uv', new THREE.BufferAttribute(this.ribUv, 2));
    rg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    rg.setIndex(index);
    this.ribbon.geometry = rg;
    this.smokeStamp = '';

    const flowLines = defs.map((d, i) => (d.kind === 'flow' ? i : -1)).filter((i) => i >= 0);
    this.puffState = [];
    const span = this.dims.sOut - this.dims.sIn;
    for (let i = 0; i < b.puffs; i++) {
      // 가까운 쪽 줄에 더 많이 둔다.
      const near = this.rnd() < 0.72 || b.far === 0;
      const pool = flowLines.filter((li) => (defs[li]!.shade === 1) === near);
      const line = pool[Math.floor(this.rnd() * pool.length)] ?? flowLines[0] ?? 0;
      this.puffState.push({ line, s: this.dims.sIn + this.rnd() * span, j1: this.rnd() * 2 - 1, j2: this.rnd() * 2 - 1 });
    }
    this.puffPos = new Float32Array(b.puffs * 12);
    const puv = new Float32Array(b.puffs * 8);
    const pidx: number[] = [];
    for (let i = 0; i < b.puffs; i++) {
      puv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      pidx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    }
    this.puffs.geometry.dispose();
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.puffPos, 3));
    pg.setAttribute('uv', new THREE.BufferAttribute(puv, 2));
    pg.setIndex(pidx);
    this.puffs.geometry = pg;
  }

  /**
   * 지금 그림(model)과 시각으로 연기 띠의 자리를 채운다.
   * 붙어 흐르는 연기는 시간에 따라 변하지 않으므로, 그림이나 카메라가 그대로면 다시 계산하지 않는다(무늬만 민다).
   */
  private fillSmoke(): void {
    const m = this.view.model;
    const moving = m !== null && (m.turbulence > 0.01 || m.stalledFraction > 0.001);
    const cam = this.camera.position;
    const stamp = `${this.modelSeq}|${this.w}x${this.h}|${cam.x.toFixed(4)},${cam.y.toFixed(4)},${cam.z.toFixed(4)}|${this.lineDefs.length}x${this.segs}`;
    if (!moving && stamp === this.smokeStamp) return;
    this.smokeStamp = moving ? '' : stamp;
    const { sIn, sOut, hy } = this.dims;
    const segs = this.segs, P = segs + 1;
    const pos = this.ribPos, uv = this.ribUv, ctr = this.ribCentre;
    const t = this.time;
    const fp = this.fp, vp = this.vp;
    // 띠의 반 폭: 화면에서 약 1.9 px
    const half = 1.9 / Math.max(200, this.anchorsNow.pxPerM);
    const period = 0.11;
    let o = 0, q = 0;
    for (const d of this.lineDefs) {
      let s0 = sIn, s1 = sOut;
      if (d.kind === 'vortex') { s0 = m ? m.tips[d.tip].s : 0; s1 = sOut; }
      let acc = 0;
      for (let k = 0; k < P; k++) {
        const f = k / segs;
        let x: number, y: number, z: number;
        if (!m) { x = -(s0 + (s1 - s0) * f); y = d.y0; z = d.z0; }
        else if (d.kind === 'flow') {
          flowPoint(m, d.z0, d.y0, s0 + (s1 - s0) * f, t, fp);
          x = -fp.s; y = fp.y; z = fp.z;
        } else {
          vortexPoint(m, d.tip, Math.max(0, s1 - s0) * f, d.arm, vp);
          x = -vp.s; y = vp.y; z = vp.z;
        }
        // 상자 밖으로 나가지 않게 한다.
        y = Math.max(-hy + 0.008, Math.min(hy - 0.008, y));
        if (k > 0) acc += Math.hypot(x - ctr[(k - 1) * 4]!, y - ctr[(k - 1) * 4 + 1]!, z - ctr[(k - 1) * 4 + 2]!);
        ctr[k * 4] = x; ctr[k * 4 + 1] = y; ctr[k * 4 + 2] = z; ctr[k * 4 + 3] = acc;
      }
      for (let k = 0; k < P; k++) {
        const a = Math.max(0, k - 1) * 4, b = Math.min(P - 1, k + 1) * 4, c = k * 4;
        const tx = ctr[b]! - ctr[a]!, ty = ctr[b + 1]! - ctr[a + 1]!, tz = ctr[b + 2]! - ctr[a + 2]!;
        const vx = cam.x - ctr[c]!, vy = cam.y - ctr[c + 1]!, vz = cam.z - ctr[c + 2]!;
        // 띠의 폭 방향 = 흐르는 방향 x 카메라 쪽
        let ox = ty * vz - tz * vy, oy = tz * vx - tx * vz, oz = tx * vy - ty * vx;
        const len = Math.hypot(ox, oy, oz) || 1;
        // 멀리 있는 곳도 같은 굵기로 보이게 거리에 비례해 넓힌다.
        const w = (half * Math.hypot(vx, vy, vz)) / Math.max(0.1, this.camDist) / len;
        ox *= w; oy *= w; oz *= w;
        pos[o] = ctr[c]! + ox; pos[o + 1] = ctr[c + 1]! + oy; pos[o + 2] = ctr[c + 2]! + oz;
        pos[o + 3] = ctr[c]! - ox; pos[o + 4] = ctr[c + 1]! - oy; pos[o + 5] = ctr[c + 2]! - oz;
        const u = ctr[c + 3]! / period;
        uv[q] = u; uv[q + 1] = 0; uv[q + 2] = u; uv[q + 3] = 1;
        o += 6; q += 4;
      }
    }
    (this.ribbon.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.ribbon.geometry.getAttribute('uv') as THREE.BufferAttribute).needsUpdate = true;
  }

  private fillPuffs(dt: number): void {
    const m = this.view.model;
    const { sIn, sOut, hy } = this.dims;
    const pace = this.view.speedMps * SMOKE_PACE;
    const fp = this.fp;
    const arr = this.puffPos;
    // 카메라의 오른쪽, 위쪽으로 반 크기만큼(화면에서 지름 약 7 px)
    const e = this.camera.matrixWorld.elements;
    const hs = 3.5 / Math.max(200, this.anchorsNow.pxPerM);
    const rx = e[0]! * hs, ry = e[1]! * hs, rz = e[2]! * hs, ux = e[4]! * hs, uy = e[5]! * hs, uz = e[6]! * hs;
    for (let i = 0; i < this.puffState.length; i++) {
      const p = this.puffState[i]!;
      const d = this.lineDefs[p.line];
      if (!d) continue;
      let x = -p.s, y = d.y0, z = d.z0, local = 1;
      if (m) {
        flowPoint(m, d.z0, d.y0, p.s, this.time, fp);
        // 어지러운 자리에서는 줄에서 벗어나 흩어진다.
        const scatter = fp.rough * (0.008 + 0.02 * m.turbulence);
        x = -fp.s + p.j1 * scatter;
        y = fp.y + p.j2 * scatter * Math.sin(this.time * 7 + i);
        z = fp.z + p.j1 * p.j2 * scatter;
        local = fp.pace;
      }
      p.s += pace * local * dt;
      if (p.s > sOut) p.s = sIn + (p.s - sOut) % Math.max(0.01, sOut - sIn);
      y = Math.max(-hy + 0.008, Math.min(hy - 0.008, y));
      const o = i * 12;
      arr[o] = x - rx - ux; arr[o + 1] = y - ry - uy; arr[o + 2] = z - rz - uz;
      arr[o + 3] = x + rx - ux; arr[o + 4] = y + ry - uy; arr[o + 5] = z + rz - uz;
      arr[o + 6] = x + rx + ux; arr[o + 7] = y + ry + uy; arr[o + 8] = z + rz + uz;
      arr[o + 9] = x - rx + ux; arr[o + 10] = y - ry + uy; arr[o + 11] = z - rz + uz;
    }
    (this.puffs.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  // 비행기
  // -------------------------------------------------------------------------
  setPlane(geom: PlaneGeometry, paperId: string): void {
    if (this.disposed) return;
    if (this.geom === geom && this.paperId === paperId) return;
    this.geom = geom;
    this.paperId = paperId;
    if (this.plane) { this.inner.remove(this.plane.group); this.plane.dispose(); this.plane = null; this.bend = null; }
    try {
      // 비행기는 이 장면의 주인공이라 낮은 화질에서도 무늬는 보통 단계로 입힌다(한 대뿐이라 부담이 없다).
      const obj = buildPaperPlane(geom, paperId, 2.4, this.tier.name === 'high' ? 'high' : 'medium', Math.max(4, this.tier.anisotropy));
      obj.setResolution(this.w, this.h);
      this.plane = obj;
      this.bend = createWingBend(obj);
      this.inner.add(obj.group);
    } catch {
      this.plane = null;
      this.bend = null;
    }
    // 무게중심이 축(원점)에 오게 한다. core (x, y, z) -> three (x, z, -y)
    this.inner.position.set(-geom.cg.x, -geom.cg.z, geom.cg.y);
    // 상자 크기를 비행기에 맞춘다: 코 앞에 조금, 꼬리 뒤에는 연기가 꺾이는 것을 볼 만큼.
    const nose = Math.max(0.02, -geom.cg.x);
    const tail = Math.max(0.03, geom.stats.lengthM + geom.cg.x);
    const reach = Math.max(nose, tail);
    const round = (v: number): number => Math.round(v * 200) / 200;
    const hy = round(Math.min(0.18, Math.max(0.105, reach * 0.8 + 0.022)));
    const hz = round(Math.min(0.18, Math.max(0.09, geom.stats.spanM / 2 + 0.028)));
    const next: Dims = { sIn: -round(nose + 0.04), sOut: round(tail + 0.15), hy, hz, fanR: round(Math.min(hy, hz) - 0.016) };
    const d = this.dims;
    const changed = next.sIn !== d.sIn || next.sOut !== d.sOut || next.hy !== d.hy || next.hz !== d.hz;
    if (changed) {
      this.dims = next;
      this.buildBox();
    }
    this.buildSmoke();
    const span = Math.max(0.08, geom.stats.spanM);
    this.blob.scale.set(Math.max(0.1, geom.stats.lengthM) * 1.15, 1, span * 1.1);
    this.invalidate();
  }

  setView(v: TunnelView): void {
    if (this.disposed) return;
    const spanChanged = (v.model?.spanHalfM ?? 0) !== (this.view.model?.spanHalfM ?? 0);
    if (v.model !== this.view.model) this.modelSeq++;
    this.view = v;
    if (spanChanged) this.buildSmoke();
    this.invalidate();
  }

  // -------------------------------------------------------------------------
  // 카메라
  // -------------------------------------------------------------------------
  private applyCamera(): void {
    const { sIn, sOut, hy, hz, fanR } = this.dims;
    const aspect = this.w / this.h;
    const wide = this.w >= 700;
    // 좁은 화면에서는 상자를 화면에 꽉 차게 잡는다(선풍기는 왼쪽에 살짝 걸친다). 상자는 비행기에 꼭 맞게 지어져 있어 비행기가 크게 보인다.
    // 넓은 화면에서는 선풍기와 저울까지 다 담는다.
    const sA = wide ? sIn - 0.13 : sIn - 0.02;
    const sB = wide ? sOut + 0.012 : sOut - 0.01;
    const yA = wide ? -hy - 0.03 : -hy - 0.012;
    const yB = wide ? Math.max(hy + 0.12, fanR + 0.09) : hy + 0.012;
    const zF = wide ? hz : hz * 0.75;
    const dir = this.tmpV.set(Math.sin(CAM_YAW) * Math.cos(CAM_UP), -Math.sin(CAM_UP), Math.cos(CAM_YAW) * Math.cos(CAM_UP)).normalize();
    // 카메라는 -Z 쪽(비행기 왼쪽), 뒤쪽(-X)으로 돌아간 자리에서 +Z 와 앞쪽(+X)을 본다.
    const f = new THREE.Vector3(dir.x, dir.y, dir.z);
    const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    const u = new THREE.Vector3().crossVectors(r, f).normalize();
    const tanY = Math.tan((FOV * DEG) / 2), tanX = tanY * aspect;
    const target = new THREE.Vector3(-(sA + sB) / 2, (yA + yB) / 2, 0);
    let D = 1;
    const p = new THREE.Vector3();
    for (let pass = 0; pass < 2; pass++) {
      let need = 0.2, rMin = Infinity, rMax = -Infinity, uMin = Infinity, uMax = -Infinity;
      for (const s of [sA, sB]) for (const y of [yA, yB]) for (const z of [-zF, zF]) {
        p.set(-s, y, z).sub(target);
        const pr = p.dot(r), pu = p.dot(u), pf = p.dot(f);
        need = Math.max(need, Math.abs(pr) / tanX - pf, Math.abs(pu) / tanY - pf);
        const k = 1 / Math.max(0.2, D + pf);
        rMin = Math.min(rMin, pr * k); rMax = Math.max(rMax, pr * k);
        uMin = Math.min(uMin, pu * k); uMax = Math.max(uMax, pu * k);
      }
      if (pass === 0) {
        D = need;
        // 원근 때문에 치우친 만큼 보는 곳을 옮겨 가운데에 오게 한다.
        let rr = Infinity, rR = -Infinity, uu = Infinity, uU = -Infinity;
        for (const s of [sA, sB]) for (const y of [yA, yB]) for (const z of [-zF, zF]) {
          p.set(-s, y, z).sub(target);
          const k = D / Math.max(0.2, D + p.dot(f));
          rr = Math.min(rr, p.dot(r) * k); rR = Math.max(rR, p.dot(r) * k);
          uu = Math.min(uu, p.dot(u) * k); uU = Math.max(uU, p.dot(u) * k);
        }
        target.addScaledVector(r, (rr + rR) / 2).addScaledVector(u, (uu + uU) / 2);
      } else D = need;
      void rMin; void rMax; void uMin; void uMax;
    }
    D *= wide ? 1.03 : 1.0;
    this.camDist = D;
    this.camera.position.copy(target).addScaledVector(f, -D);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
  }

  private toScreen(world: THREE.Vector3): Pt {
    const v = this.tmpV2.copy(world).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height };
  }

  resize(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.tier.pixelRatio));
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.plane?.setResolution(this.w, this.h);
    this.invalidate();
  }

  setActive(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    if (on) this.invalidate();
    else this.halt();
  }

  private applyTier(t: Tier): void {
    const was = this.tier.name;
    this.tier = t;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, t.pixelRatio));
    this.renderer.setSize(this.w, this.h, false);
    if (was !== t.name || this.lineDefs.length === 0) this.buildSmoke();
    if (this.glass) this.glass.visible = t.name !== 'low';
    this.invalidate();
  }

  invalidate(): void {
    this.needs = true;
    if (this.active && !this.disposed && !this.lost && this.rafId === 0) this.rafId = requestAnimationFrame(this.frame);
  }

  private halt(): void {
    if (this.rafId !== 0) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.lastNow = 0;
    this.streak = 0;
  }

  private reducedMotion(): boolean {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  }

  private frame = (now: number): void => {
    this.rafId = 0;
    if (this.disposed || this.lost || !this.active) return;
    if (!this.renderer.domElement.isConnected || document.hidden) { this.lastNow = 0; return; }
    // 초당 장수 상한: 아직 때가 안 됐으면 이번 화면은 건너뛴다.
    const cap = SMOKE_BUDGET[this.tier.name].fps;
    const minGap = 1000 / cap - 3;
    if (this.lastNow !== 0 && now - this.lastNow < minGap && !this.needs) {
      this.rafId = requestAnimationFrame(this.frame);
      return;
    }
    const raw = this.lastNow === 0 ? 1 / 60 : (now - this.lastNow) / 1000;
    const continuous = this.lastNow !== 0;
    this.lastNow = now;
    const dt = Math.min(raw, 0.1);
    this.draw(dt);
    if (continuous && raw < 1) {
      this.intervalMs += (raw * 1000 - this.intervalMs) * 0.15;
      this.streak++;
      // 상한에 맞춰 일부러 천천히 그리는 중이면(낮음 단계 30장) 느린 것으로 세지 않는다.
      this.governor.sample(raw, cap < 40 && raw < 0.06);
      if (this.tier.name === 'low' && forcedTier() === null && this.streak > 3) {
        this.slowRun = raw > 0.3 ? this.slowRun + 1 : 0;
        if (this.slowRun >= 6) { this.slowRun = 0; this.opts.onSlow(); }
      }
    } else this.streak = 0;
    this.needs = false;
    // 바람이 불거나 떨고 있는 동안에는 이어서 그린다.
    const moving = (this.view.speedMps > 0.05 || Math.abs(this.fanVel) > 0.05) && !this.reducedMotion();
    if (moving) this.rafId = requestAnimationFrame(this.frame);
    else this.lastNow = 0;
  };

  /** 한 장 그린다. dt 만큼 연기와 선풍기를 보낸다. */
  private draw(dt: number): void {
    const v = this.view;
    const still = this.reducedMotion();
    if (this.timeFixed !== null) this.time = this.timeFixed;
    else if (!still) this.time += dt;
    const pace = v.speedMps * SMOKE_PACE;
    if (!still && this.timeFixed === null) this.dash -= pace * dt;

    // 선풍기: 바람 세기를 부드럽게 따라간다.
    const goal = v.speedMps * 2.4;
    this.fanVel += (goal - this.fanVel) * Math.min(1, dt * 3);
    if (!still) this.fanSpin += this.fanVel * dt;
    this.fanBlades.rotation.x = this.fanSpin;
    const frac = Math.min(1, v.speedMps / 14);
    this.dialNeedle.rotation.z = -(-120 + 240 * frac) * DEG;

    // 비행기 자세와 떨림
    const shake = still ? 0 : v.shake;
    const wob = shake > 0.01 ? Math.sin(this.time * 47) * 0.6 + Math.sin(this.time * 31 + 1) * 0.4 : 0;
    this.wrapper.rotation.set(0, v.betaDeg * DEG, (v.alphaDeg + wob * shake * 1.3) * DEG);
    this.wrapper.position.set(0, wob * shake * 0.0016, 0);
    const r = v.reading;
    this.bend?.apply(r ? r.flexLeftDeg : 0, r ? r.flexRightDeg : 0, r ? r.buckled : false);

    // 연기
    const on = v.speedMps > 0.05;
    this.ribbonMat.opacity = on ? 0.95 : 0.32;
    this.ribbonTex.offset.x = this.dash / 0.11;
    this.puffs.visible = on;
    // 카메라 자리를 먼저 정한다: 연기 띠는 카메라를 보도록 세운다.
    this.applyCamera();
    this.fillSmoke();
    if (on) this.fillPuffs(dt);

    // 용수철 저울의 빨간 표시: 뜨는 힘 ÷ 무게 (0 ~ 2.4)
    if (this.scaleMark) {
      const lw = r ? Math.max(0, Math.min(2.4, r.liftToWeight)) : 0;
      this.scaleMark.position.y = this.dims.hy + 0.014 + 0.084 * (lw / 2.4);
    }

    this.placeArrows();
    this.fillElementArrows();
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    const cost = performance.now() - t0;
    this.frameMs += (cost - this.frameMs) * 0.2;
    this.frames++;
    this.emitAnchors();
  }

  private placeArrows(): void {
    const v = this.view, r = v.reading, g = this.geom;
    const show = v.arrows && r !== null && g !== null;
    if (!show || !r || !g) {
      for (const a of [this.arrowLift, this.arrowDrag, this.arrowWeight, this.ghostLift, this.ghostDrag]) a.group.visible = false;
      return;
    }
    // 힘이 걸리는 점: 중심선 위, 작용점 x. 비행기와 같은 자세로 돌린다.
    this.wrapper.updateMatrixWorld(true);
    const cp = this.tmpV.set(r.centerOfPressureX - g.cg.x, 0, 0).applyMatrix4(this.wrapper.matrixWorld).clone();
    const up = new THREE.Vector3(0, 1, 0), back = new THREE.Vector3(-1, 0, 0), down = new THREE.Vector3(0, -1, 0);
    this.arrowWeight.set(new THREE.Vector3(0, 0, 0), down, arrowLength(r.weightN, r.weightN).lengthM);
    const on = v.speedMps > 0.05;
    this.arrowLift.set(cp, up, on ? arrowLength(r.liftN, r.weightN).lengthM : 0);
    this.arrowDrag.set(cp, back, on ? arrowLength(r.dragN, r.weightN).lengthM : 0);
    if (v.ghost) {
      const off = new THREE.Vector3(0, 0, -0.012).add(cp);
      this.ghostLift.set(off, up, arrowLength(v.ghost.liftN, r.weightN).lengthM);
      this.ghostDrag.set(off, back, arrowLength(v.ghost.dragN, r.weightN).lengthM);
    } else {
      this.ghostLift.group.visible = false;
      this.ghostDrag.group.visible = false;
    }
  }

  /** 띠마다의 힘(자세히 보기): 힘이 걸리는 점에서 힘의 방향으로 짧은 노란 선 */
  private fillElementArrows(): void {
    const v = this.view, r = v.reading;
    const show = v.detail && v.arrows && r !== null && v.speedMps > 0.05;
    this.elemLines.visible = show;
    if (!show || !r) return;
    const n = r.elements.length;
    let attr = this.elemLines.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!attr || attr.count !== n * 2) {
      this.elemLines.geometry.dispose();
      const g = new THREE.BufferGeometry();
      attr = new THREE.BufferAttribute(new Float32Array(n * 6), 3);
      g.setAttribute('position', attr);
      this.elemLines.geometry = g;
    }
    const arr = attr.array as Float32Array;
    // 띠 하나의 힘은 작아서, 전체 화살표보다 12배 길게 그린다.
    const k = r.weightN > 0 ? (0.055 / r.weightN) * 12 : 0;
    r.elements.forEach((e, i) => {
      const o = i * 6;
      const px = e.pointBody.x, py = e.pointBody.z, pz = -e.pointBody.y;
      arr[o] = px; arr[o + 1] = py; arr[o + 2] = pz;
      arr[o + 3] = px + e.forceBody.x * k; arr[o + 4] = py + e.forceBody.z * k; arr[o + 5] = pz - e.forceBody.y * k;
    });
    attr.needsUpdate = true;
  }

  private emitAnchors(): void {
    const pivot = this.toScreen(this.tmpV.set(0, 0, 0));
    const one = this.toScreen(this.tmpV.set(0, 0.1, 0));
    const tip = (a: Arrow): Pt | null => {
      const t = a.tip(this.tmpV);
      return t ? this.toScreen(t) : null;
    };
    this.anchorsNow = { pivot, lift: tip(this.arrowLift), drag: tip(this.arrowDrag), weight: tip(this.arrowWeight), pxPerM: Math.abs(one.y - pivot.y) * 10 };
    this.opts.onAnchors?.(this.anchorsNow);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.halt();
    const el = this.renderer.domElement;
    el.removeEventListener('webglcontextlost', this.onCtxLost);
    document.removeEventListener('visibilitychange', this.onVis);
    this.unsubPaper();
    this.plane?.dispose();
    this.plane = null;
    this.ribbon.geometry.dispose();
    this.puffs.geometry.dispose();
    this.elemLines.geometry.dispose();
    this.boxTrash.dispose();
    this.trash.dispose();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
  }
}
