/**
 * 격납고 무대: 체육관 창고 한쪽의 나무 선반장. 체육관과 같은 장난감 디오라마 그림체다.
 *
 * - 선반장은 가로 8칸 x 세로 3줄(24칸). 맨 윗줄 비행기는 실에 매달려 있고, 아래 두 줄은 작은 받침대에 올라 있다.
 *   칸마다 손글씨 이름표가 서 있고, 종목 1등 비행기 칸에는 리본이 달린다. 빈 칸은 점선 그림과 점선 이름표로 보인다.
 * - 옆으로 끌면 선반을 따라 움직이고, 비행기를 누르면 앞의 돌림판 받침대로 나와 조명을 받는다.
 * - 움직임이 있을 때만 그린다(가만히 있으면 한 장도 그리지 않는다). 비행기는 한 프레임에 한 대씩 천천히 만들어 넣는다.
 * - 화질 단계(quality.ts)를 따른다. 가장 낮은 단계에서도 너무 느리면 onSlow 로 알려 2D 목록으로 바꾸게 한다.
 * - 만든 것은 dispose 에서 모두 정리한다.
 *
 * 좌표(three): +X 오른쪽(선반을 따라), +Y 위, +Z 보는 사람 쪽. 벽은 z = 0.
 */
import * as THREE from 'three';
import type { PlaneGeometry } from '../../core/index';
import { tok } from '../lib/palette';
import { buildPaperPlane } from './hangarPaper';
import { subscribePaperLooks } from './paperLook';
import type { PlaneObject } from './planeMesh';
import { forcedTier, Governor, pickInitialTier, TIERS } from './quality';
import type { Tier, TierName } from './quality';
import { canvasOf, lathe, Merger, mix, radialTexture, roundRect, seeded, texOf, toonMat, Trash } from './toon';

export const HANGAR_COLS = 8;
export const HANGAR_ROWS = 3;
const SLOTS = HANGAR_COLS * HANGAR_ROWS;

const CW = 0.44;          // 한 칸 폭(m)
const CH = 0.38;          // 한 칸 높이
const Y0 = 0.44;          // 맨 아랫줄 선반 윗면 높이
const DEPTH = 0.34;       // 선반 깊이
const BOARD = 0.03;       // 선반 널 두께
const X0 = -(HANGAR_COLS * CW) / 2;
const X1 = -X0;
const TOP = Y0 + HANGAR_ROWS * CH;
const TAG_W = 0.36;
const TAG_H = TAG_W * (104 / 256);
const PLANE_Z = 0.16;
const PEDESTAL_Z = 1.3;
const PEDESTAL_TOP = 0.74;
const FOV = 30;
const TAN = Math.tan((FOV * Math.PI) / 360);

/** 이름표 그림판: 256 x 104 칸이 4 x 6 = 24칸, 그 아래에 낱그림들 */
const ATLAS = 1024;
const CELL_W = 256;
const CELL_H = 104;
const SPR = {
  ghost: [0, 640, 256, 256],
  far: [256, 640, 128, 192],
  long: [384, 640, 128, 192],
  emptyTag: [512, 640, 256, 104],
} as const;

export interface HangarItem {
  id: string;
  /** 설계 코드(모양의 원본) */
  code: string;
  paperId: string;
  name: string;
  /** 이름 아래 작은 줄(최고 기록). 없으면 빈 글자열 */
  line: string;
  fav: boolean;
  /** 격납고에서 멀리 1등 / 오래 1등 */
  farChamp: boolean;
  longChamp: boolean;
}

export interface HangarInsets { top: number; right: number; bottom: number; left: number }

export interface HangarStageOpts {
  /** 설계 코드 -> 형상. 계산은 부르는 쪽이 기억해 둔다. 못 만들면 null. */
  geometryOf: (code: string) => PlaneGeometry | null;
  /** 비행기를 눌렀다(빈 곳을 누르면 null) */
  onPick: (id: string | null) => void;
  /** 가장 낮은 화질에서도 너무 느리다 */
  onSlow: () => void;
  /** 그래픽 장치를 잃었다 */
  onLost: () => void;
}

export interface HangarDebug {
  tier: (name: TierName) => void;
  info: () => { tier: TierName; calls: number; triangles: number; geometries: number; textures: number; planes: number; pending: number; frames: number; frameMs: number; animating: boolean; selected: string | null; pan: number; panMin: number; panMax: number; shadow: number; pixelRatio: number; /** debug.render 로 잰 값: 그림자 지도를 그리는 몫까지 더한 그리기 수 */ full: { calls: number; triangles: number } | null };
  /** 그 차례의 칸이 화면 어디에 있는지(브라우저 창 기준 px) */
  slotScreen: (index: number) => { x: number; y: number } | null;
  /** 돌림판 위 비행기가 화면 어디에 있는지 */
  pedestalScreen: () => { x: number; y: number };
  /** 비행기를 모두 만들고 움직임이 멎을 때까지 기다린다 */
  settle: () => Promise<void>;
  pan: (x: number) => void;
  /** 그 차례의 칸이 화면에 들어오게 선반을 옮긴다 */
  reveal: (index: number) => void;
  /** 그리기를 한 번 강제로 한다(갈무리용) */
  render: () => void;
}

interface Entry {
  item: HangarItem;
  slot: number;
  wrapper: THREE.Group;
  obj: PlaneObject | null;
  /** 만들다 실패했으면 다시 시도하지 않는다 */
  failed: boolean;
  /** 지금 자리(움직이는 중이면 옛 자리에서 새 자리로 가는 길) */
  fromPos: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  move: number;   // 0..1 자리 옮기기 진행
  lift: number;   // 0..1 받침대로 나온 정도
  pop: number;    // 0..1 처음 나타날 때 커지는 정도
  scale: number;  // 선반 위에서의 크기 배율
  bigScale: number;
  baseEmissive: THREE.Color[];
  mats: THREE.MeshToonMaterial[];
}

const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeOut = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

export function slotCell(slot: number): { col: number; row: number } {
  return { col: Math.floor(slot / HANGAR_ROWS), row: slot % HANGAR_ROWS };
}
const cellX = (col: number): number => X0 + (col + 0.5) * CW;
const boardTop = (row: number): number => Y0 + (HANGAR_ROWS - 1 - row) * CH;

export class HangarStage {
  debug: HangarDebug;

  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 40);
  private trash = new Trash();
  private tier: Tier;
  private governor: Governor;
  private hemi: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private fill: THREE.DirectionalLight;

  private entries = new Map<string, Entry>();
  private order: string[] = [];
  private queue: string[] = [];
  private buildTimer = 0;

  private decor: THREE.Mesh;
  private decorMat: THREE.MeshBasicMaterial;
  private atlas: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null };
  private atlasTex: THREE.CanvasTexture;
  private strings: THREE.LineSegments;
  private blobs: THREE.InstancedMesh;
  private pedestal: THREE.Group;
  private turntable: THREE.Group;
  private cone: THREE.Mesh;
  private pool: THREE.Mesh;
  private pedTopMat: THREE.MeshToonMaterial;

  private w = 1;
  private h = 1;
  private insets: HangarInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** 선반 전체 보기일 때의 가림(받침대 보기로 가도 선반의 크기와 움직일 범위는 이 값으로 잰다) */
  private wideInsets: HangarInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private pan = 0;
  private panGoal = 0;
  private panVel = 0;
  private panMin = 0;
  private panMax = 0;
  private panInit = false;
  private sway = 0;
  private swayVel = 0;
  private selected: string | null = null;
  private focus = 0;      // 0 선반 전체 보기, 1 받침대 보기
  private pedX = 0;
  private spin = 0;
  private spinVel = 0;
  private autoSpin = 0;   // 남은 자동 돌림 시간(s)

  private active = true;
  private disposed = false;
  private lost = false;
  private rafId = 0;
  private lastNow = 0;
  private needs = true;
  private frames = 0;
  private frameMs = 0;
  private slowRun = 0;
  private streak = 0;
  private settleWaiters: (() => void)[] = [];

  private drag: { id: number; x: number; y: number; lastX: number; lastT: number; moved: boolean; mode: 'pan' | 'spin' } | null = null;
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
  private tmpM = new THREE.Matrix4();
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private onDown: (e: PointerEvent) => void;
  private onMove: (e: PointerEvent) => void;
  private onUp: (e: PointerEvent) => void;
  private onCtxLost: (e: Event) => void;
  private onVis: () => void;
  private unsubPaper: () => void = () => undefined;
  private fontAsked = new Set<string>();
  private fullCost: { calls: number; triangles: number } | null = null;

  constructor(private renderer: THREE.WebGLRenderer, private opts: HangarStageOpts) {
    const keep = <T extends { dispose: () => void }>(x: T): T => this.trash.keep(x);
    this.tier = TIERS[pickInitialTier(renderer.getContext())];
    this.governor = new Governor(this.tier.name, (t) => this.applyTier(TIERS[t]));

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    const haze = new THREE.Color(mix(tok('--wall'), tok('--yellow-soft'), 0.35));
    renderer.setClearColor(haze, 1);
    this.scene.background = haze;

    // ---- 빛: 위는 차가운 하늘빛, 아래는 마루에 되비친 따뜻한 빛, 왼쪽 위에서 전등 ----
    this.hemi = new THREE.HemisphereLight(new THREE.Color('#e9eeff'), new THREE.Color('#ffd7a8'), 2.1);
    this.key = new THREE.DirectionalLight(new THREE.Color('#fff0d2'), 1.45);
    // 앞쪽 조금 위에서 비춘다: 빛이 칸 안쪽까지 들어가고, 비행기 그림자가 뒤판에 살짝 떨어진다.
    this.key.position.set(-1.3, 2.3, 4.2);
    this.key.target.position.set(0, 1, 0);
    this.key.shadow.bias = -0.0015;
    this.key.shadow.normalBias = 0.01;
    this.key.shadow.radius = 3;
    this.key.shadow.intensity = 0.5;
    const sc = this.key.shadow.camera;
    sc.left = -2.7; sc.right = 2.7; sc.top = 1.5; sc.bottom = -1.6; sc.near = 0.5; sc.far = 9;
    this.fill = new THREE.DirectionalLight(new THREE.Color('#ffe2e6'), 0.35);
    this.fill.position.set(2.5, 1.2, 3);
    this.scene.add(this.hemi, this.key, this.key.target, this.fill);

    this.buildRoom(keep);

    // ---- 이름표, 리본, 빈 칸 점선 그림: 그림판 한 장에 모아 한 번에 그린다 ----
    this.atlas = canvasOf(ATLAS, ATLAS);
    this.atlasTex = keep(texOf(this.atlas.canvas, 4));
    this.decorMat = keep(new THREE.MeshBasicMaterial({ map: this.atlasTex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide }));
    this.decor = new THREE.Mesh(new THREE.BufferGeometry(), this.decorMat);
    this.decor.frustumCulled = false;
    this.scene.add(this.decor);

    // ---- 매다는 실 ----
    const stringMat = keep(new THREE.LineBasicMaterial({ color: new THREE.Color(mix(tok('--ink'), '#ffffff', 0.25)) }));
    this.strings = new THREE.LineSegments(new THREE.BufferGeometry(), stringMat);
    this.strings.frustumCulled = false;
    this.scene.add(this.strings);

    // ---- 둥근 그림자(진짜 그림자를 쓰지 않는 화질에서만 보인다) ----
    const blobTex = keep(radialTexture(64, 0.1, 1.5));
    const blobMat = keep(new THREE.MeshBasicMaterial({ map: blobTex, color: 0x3a2a18, transparent: true, opacity: 0.28, depthWrite: false }));
    const blobGeom = keep(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    this.blobs = new THREE.InstancedMesh(blobGeom, blobMat, SLOTS);
    this.blobs.count = 0;
    this.blobs.frustumCulled = false;
    this.scene.add(this.blobs);

    // ---- 돌림판 받침대와 조명 ----
    this.pedestal = new THREE.Group();
    this.turntable = new THREE.Group();
    const wood = tok('--desk'), woodDark = tok('--desk-dark'), inkC = tok('--ink');
    const pm = new Merger();
    pm.add(lathe([[0.2, 0], [0.2, 0.05], [0.13, 0.09], [0.1, PEDESTAL_TOP - 0.1], [0.165, PEDESTAL_TOP - 0.06], [0.165, PEDESTAL_TOP - 0.03]], 28), (_x, y) => (y < 0.06 ? woodDark : wood));
    pm.add(new THREE.CylinderGeometry(0.175, 0.175, 0.016, 28), inkC, { y: PEDESTAL_TOP - 0.03 });
    const pedGeom = keep(pm.build());
    const pedMat = keep(toonMat({ vertexColors: true, rim: 0.25 }));
    const pedBody = new THREE.Mesh(pedGeom, pedMat);
    pedBody.castShadow = true;
    this.pedTopMat = keep(toonMat({ color: tok('--yellow'), rim: 0.2 }));
    const topGeom = keep(new THREE.CylinderGeometry(0.152, 0.152, 0.03, 28));
    const top = new THREE.Mesh(topGeom, this.pedTopMat);
    top.position.y = PEDESTAL_TOP - 0.012;
    // 돌림판 위 표시: 돌아가는 것이 보이도록 흰 점 넷
    const dm = new Merger();
    for (let i = 0; i < 4; i++) dm.add(new THREE.CylinderGeometry(0.014, 0.014, 0.004, 10), tok('--paper'), { x: Math.cos((i * Math.PI) / 2) * 0.12, z: Math.sin((i * Math.PI) / 2) * 0.12, y: PEDESTAL_TOP + 0.005 });
    const dots = new THREE.Mesh(keep(dm.build()), keep(new THREE.MeshBasicMaterial({ vertexColors: true })));
    const post = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.007, 0.007, 0.1, 6)), keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(inkC) })));
    post.position.y = PEDESTAL_TOP + 0.05;
    this.turntable.add(top, dots, post);
    this.pedestal.add(pedBody, this.turntable);
    this.pedestal.position.set(0, 0, PEDESTAL_Z);
    this.pedestal.visible = false;
    this.scene.add(this.pedestal);

    const coneGeom = keep(new THREE.CylinderGeometry(0.05, 0.36, 1.5, 24, 1, true).translate(0, PEDESTAL_TOP + 0.75, 0));
    const cc = canvasOf(4, 64);
    if (cc.ctx) {
      const g = cc.ctx.createLinearGradient(0, 0, 0, 64);
      g.addColorStop(0, 'rgba(255, 240, 200, 0.7)');
      g.addColorStop(1, 'rgba(255, 240, 200, 0.16)');
      cc.ctx.fillStyle = g;
      cc.ctx.fillRect(0, 0, 4, 64);
    }
    const coneTex = keep(texOf(cc.canvas));
    const coneMat = keep(new THREE.MeshBasicMaterial({ map: coneTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0 }));
    this.cone = new THREE.Mesh(coneGeom, coneMat);
    const poolTex = keep(radialTexture(96, 0.25, 1.4));
    const poolMat = keep(new THREE.MeshBasicMaterial({ map: poolTex, color: 0xffe9b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    this.pool = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2)), poolMat);
    this.pool.position.y = 0.004;
    this.pedestal.add(this.cone, this.pool);

    // ---- 손가락, 마우스 ----
    const el = renderer.domElement;
    this.onDown = (e) => this.pointerDown(e);
    this.onMove = (e) => this.pointerMove(e);
    this.onUp = (e) => this.pointerUp(e);
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
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
      if (this.disposed) return;
      for (const e of this.entries.values()) {
        if (!e.obj) continue;
        this.dropObject(e);
        if (!this.queue.includes(e.item.id)) this.queue.push(e.item.id);
      }
      this.pumpQueue();
    });

    this.applyTier(this.tier);
    this.drawAtlas();
    this.rebuildDecor();

    this.debug = {
      tier: (name) => this.governor.lock(name),
      info: () => ({
        tier: this.tier.name,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        planes: [...this.entries.values()].filter((e) => e.obj).length,
        pending: this.queue.length,
        frames: this.frames,
        frameMs: this.frameMs,
        animating: this.needs,
        selected: this.selected,
        pan: this.pan, panMin: this.panMin, panMax: this.panMax,
        shadow: this.key.castShadow ? this.key.shadow.mapSize.x : 0,
        pixelRatio: renderer.getPixelRatio(),
        full: this.fullCost,
      }),
      slotScreen: (index) => {
        if (index < 0 || index >= SLOTS) return null;
        this.applyCamera();
        return this.toScreen(this.slotCentre(index, this.tmpV));
      },
      pedestalScreen: () => {
        this.applyCamera();
        return this.toScreen(this.tmpV.set(this.pedX, PEDESTAL_TOP + 0.14, PEDESTAL_Z));
      },
      settle: () => new Promise((res) => {
        if (this.queue.length === 0 && !this.needs) { res(); return; }
        this.settleWaiters.push(res);
        this.invalidate();
      }),
      pan: (x) => { this.panInit = true; this.panGoal = this.pan = THREE.MathUtils.clamp(x, this.panMin, this.panMax); this.invalidate(); },
      reveal: (index) => { this.panInit = true; this.panGoal = this.pan = THREE.MathUtils.clamp(cellX(slotCell(index).col), this.panMin, this.panMax); this.invalidate(); },
      render: () => {
        this.applyCamera();
        if (this.lost) return;
        // 그림자 지도를 그리는 몫까지 세려고 이번 한 장만 스스로 지우지 않게 한다(three 는 그림자를 그린 뒤에 수를 지운다).
        const inf = this.renderer.info;
        if (this.key.castShadow) this.renderer.shadowMap.needsUpdate = true;
        inf.autoReset = false;
        inf.reset();
        this.renderer.render(this.scene, this.camera);
        this.fullCost = { calls: inf.render.calls, triangles: inf.render.triangles };
        inf.autoReset = true;
      },
    };
  }

  // -------------------------------------------------------------------------
  // 방 만들기
  // -------------------------------------------------------------------------
  private buildRoom(keep: <T extends { dispose: () => void }>(x: T) => T): void {
    const wood = tok('--desk'), woodDark = tok('--desk-dark'), woodDeep = tok('--court-dark');
    const paper = tok('--paper');
    const aniso = 4;

    // 마루
    const fc = canvasOf(512, 512);
    if (fc.ctx) {
      const c = fc.ctx;
      c.fillStyle = tok('--court');
      c.fillRect(0, 0, 512, 512);
      const rnd = seeded(7);
      for (let y = 0; y < 512; y += 64) {
        c.fillStyle = `rgba(150, 95, 40, ${0.05 + rnd() * 0.07})`;
        c.fillRect(0, y, 512, 64);
        c.fillStyle = 'rgba(120, 72, 30, 0.35)';
        c.fillRect(0, y, 512, 2);
        for (let k = 0; k < 2; k++) c.fillRect(Math.floor(rnd() * 512), y, 2, 64);
      }
    }
    const floorTex = keep(texOf(fc.canvas, aniso));
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(7, 4);
    const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(14, 8).rotateX(-Math.PI / 2)), keep(new THREE.MeshLambertMaterial({ map: floorTex })));
    floor.position.set(0, 0, 3.6);
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 벽: 아래는 초록 매트, 위는 구멍 뚫린 걸이판. 만국기와 오려 붙인 그림도 벽 그림에 같이 그린다.
    const WALL_W = 12, WALL_H = 3.2, PX = 170;
    const wc = canvasOf(WALL_W * PX, Math.round(WALL_H * PX));
    if (wc.ctx) {
      const c = wc.ctx;
      const H = wc.canvas.height, W = wc.canvas.width;
      const yOf = (m: number): number => H - m * PX;
      const xOf = (m: number): number => (m + WALL_W / 2) * PX;
      c.fillStyle = mix(tok('--wall'), tok('--desk'), 0.22);
      c.fillRect(0, 0, W, H);
      // 걸이판 구멍(5 cm 간격)
      c.fillStyle = 'rgba(120, 84, 44, 0.33)';
      for (let y = 1.02; y < WALL_H; y += 0.06) for (let x = -WALL_W / 2 + 0.03; x < WALL_W / 2; x += 0.06) {
        c.beginPath();
        c.arc(xOf(x), yOf(y), 1.7, 0, Math.PI * 2);
        c.fill();
      }
      // 매트
      c.fillStyle = tok('--mat');
      c.fillRect(0, yOf(0.92), W, 0.92 * PX);
      c.fillStyle = tok('--mat-dark');
      for (let x = -WALL_W / 2; x < WALL_W / 2; x += 1.1) c.fillRect(xOf(x), yOf(0.92), 4, 0.92 * PX);
      c.fillStyle = woodDeep;
      c.fillRect(0, yOf(0.98), W, 0.06 * PX);
      // 만국기
      const flags = [tok('--red'), tok('--yellow'), tok('--blue'), tok('--green'), tok('--pink'), tok('--orange'), tok('--sky'), tok('--purple')];
      c.strokeStyle = tok('--ink');
      c.lineWidth = 3;
      const sag = (x: number): number => 2.22 - 0.1 * Math.sin(((x + 3.2) / 1.6) * Math.PI) ** 2;
      c.beginPath();
      for (let x = -3.2; x <= 3.2; x += 0.05) c.lineTo(xOf(x), yOf(sag(x)));
      c.stroke();
      let k = 0;
      for (let x = -3.1; x < 3.1; x += 0.2) {
        c.fillStyle = flags[k++ % flags.length]!;
        c.beginPath();
        c.moveTo(xOf(x), yOf(sag(x)));
        c.lineTo(xOf(x + 0.15), yOf(sag(x + 0.15)));
        c.lineTo(xOf(x + 0.075), yOf(sag(x + 0.075) - 0.17));
        c.closePath();
        c.fill();
        c.stroke();
      }
      // 걸이판에 걸린 것들(오려 붙인 그림): 별, 줄자 테이프, 색종이 묶음
      const star = (cx: number, cy: number, r: number, color: string): void => {
        c.fillStyle = color;
        c.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const rr = i % 2 === 0 ? r : r * 0.46;
          c.lineTo(xOf(cx) + Math.cos(a) * rr * PX, yOf(cy) + Math.sin(a) * rr * PX);
        }
        c.closePath();
        c.fill();
        c.stroke();
      };
      star(-1.2, 1.92, 0.06, tok('--yellow'));
      star(0.7, 1.95, 0.05, tok('--paper'));
      star(-2.35, 1.6, 0.07, tok('--sky'));
      star(2.45, 1.55, 0.08, tok('--yellow'));
    }
    const wallTex = keep(texOf(wc.canvas, aniso));
    const wall = new THREE.Mesh(keep(new THREE.PlaneGeometry(WALL_W, WALL_H)), keep(new THREE.MeshLambertMaterial({ map: wallTex })));
    wall.position.set(0, WALL_H / 2, -0.005);
    wall.receiveShadow = true;
    this.scene.add(wall);

    // 선반장과 소품: 꼭짓점 색으로 칠해 한 덩어리로
    const m = new Merger();
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: string): void => {
      m.add(new THREE.BoxGeometry(w, h, d), color, { x, y, z });
    };
    const fullW = HANGAR_COLS * CW;
    // 옆판, 널, 칸막이
    box(0.045, TOP + 0.02, DEPTH, X0 - 0.0225, (TOP + 0.02) / 2, DEPTH / 2, woodDark);
    box(0.045, TOP + 0.02, DEPTH, X1 + 0.0225, (TOP + 0.02) / 2, DEPTH / 2, woodDark);
    for (let k = 0; k <= HANGAR_ROWS; k++) box(fullW + 0.09, BOARD, DEPTH + (k === HANGAR_ROWS ? 0.03 : 0.012), 0, Y0 + k * CH - BOARD / 2, (DEPTH + 0.012) / 2, k === HANGAR_ROWS ? woodDark : wood);
    for (let c = 1; c < HANGAR_COLS; c++) box(0.024, HANGAR_ROWS * CH, DEPTH - 0.01, X0 + c * CW, Y0 + (HANGAR_ROWS * CH) / 2 - BOARD / 2, DEPTH / 2, wood);
    // 칸 뒤판: 옅은 색종이를 번갈아 붙였다(흰 종이 비행기가 잘 보이게 조금 짙게)
    const backs = [mix(tok('--blue-soft'), tok('--blue'), 0.2), mix(tok('--green-soft'), tok('--green'), 0.16), mix(tok('--yellow-soft'), tok('--orange'), 0.16), mix(tok('--red-soft'), tok('--pink'), 0.2)];
    for (let c = 0; c < HANGAR_COLS; c++) for (let r = 0; r < HANGAR_ROWS; r++) {
      box(CW - 0.02, CH - BOARD, 0.012, cellX(c), boardTop(r) + (CH - BOARD) / 2, 0.008, backs[(c + r * 3) % backs.length]!);
    }
    // 아래 수납장: 문짝과 손잡이
    box(fullW + 0.09, Y0 - BOARD - 0.07, DEPTH - 0.02, 0, 0.07 + (Y0 - BOARD - 0.07) / 2, (DEPTH - 0.02) / 2, woodDark);
    box(fullW + 0.05, 0.07, DEPTH - 0.06, 0, 0.035, (DEPTH - 0.06) / 2, woodDeep);
    for (let c = 0; c < HANGAR_COLS; c += 2) {
      const cx = X0 + (c + 1) * CW;
      box(CW * 2 - 0.05, Y0 - BOARD - 0.13, 0.014, cx, 0.1 + (Y0 - BOARD - 0.13) / 2, DEPTH - 0.015, wood);
      for (const s of [-1, 1]) m.add(new THREE.SphereGeometry(0.016, 10, 8), tok('--ink'), { x: cx + s * 0.035, y: 0.3, z: DEPTH });
    }
    // 받침대(아래 두 줄): 나무 받침 + 가는 기둥 + 작은 받이
    for (let c = 0; c < HANGAR_COLS; c++) for (let r = 1; r < HANGAR_ROWS; r++) {
      const cx = cellX(c), by = boardTop(r);
      m.add(new THREE.CylinderGeometry(0.05, 0.058, 0.016, 14), woodDark, { x: cx, y: by + 0.008, z: PLANE_Z });
      m.add(new THREE.CylinderGeometry(0.006, 0.006, 0.15, 6), tok('--ink'), { x: cx, y: by + 0.085, z: PLANE_Z });
    }
    // 선반장 위: 색종이 묶음, 연필꽂이, 우승컵, 상자
    const topY = TOP;
    const papers = [tok('--red'), tok('--yellow'), tok('--green'), tok('--blue'), tok('--pink'), paper];
    papers.forEach((col, i) => box(0.3, 0.012, 0.22, X0 + 0.42 + (i % 2) * 0.012, topY + 0.006 + i * 0.012, 0.17, col));
    m.add(new THREE.CylinderGeometry(0.045, 0.04, 0.11, 14), tok('--sky'), { x: X0 + 0.95, y: topY + 0.055, z: 0.18 });
    [tok('--yellow'), tok('--red'), tok('--green')].forEach((col, i) => m.add(new THREE.CylinderGeometry(0.008, 0.008, 0.17, 6), col, { x: X0 + 0.93 + i * 0.02, y: topY + 0.13, z: 0.18 + (i - 1) * 0.012, rz: (i - 1) * 0.16 }));
    m.add(lathe([[0.05, 0], [0.05, 0.015], [0.014, 0.03], [0.014, 0.075], [0.055, 0.1], [0.07, 0.17], [0.062, 0.175], [0.0005, 0.12]], 16), tok('--yellow'), { x: 0.25, y: topY, z: 0.17 });
    box(0.36, 0.2, 0.24, X1 - 0.62, topY + 0.1, 0.16, mix(wood, paper, 0.35));
    box(0.37, 0.035, 0.25, X1 - 0.62, topY + 0.2, 0.16, tok('--red'));
    box(0.26, 0.14, 0.2, X1 - 1.25, topY + 0.07, 0.15, tok('--green'));
    // 왼쪽: 공 바구니
    const bx = X0 - 0.62;
    for (const [dx, dz] of [[-0.24, 0.06], [0.24, 0.06], [-0.24, 0.5], [0.24, 0.5]] as const) box(0.03, 0.62, 0.03, bx + dx, 0.31, dz + 0.02, tok('--ink'));
    box(0.54, 0.03, 0.5, bx, 0.3, 0.3, tok('--sky'));
    for (const y of [0.45, 0.61]) { box(0.54, 0.022, 0.022, bx, y, 0.055, tok('--sky')); box(0.54, 0.022, 0.022, bx, y, 0.545, tok('--sky')); box(0.022, 0.022, 0.5, bx - 0.26, y, 0.3, tok('--sky')); box(0.022, 0.022, 0.5, bx + 0.26, y, 0.3, tok('--sky')); }
    const balls = [[-0.11, 0.44, 0.2, tok('--red')], [0.12, 0.45, 0.3, tok('--yellow')], [-0.04, 0.46, 0.42, tok('--blue')], [0.04, 0.64, 0.27, tok('--orange')]] as const;
    for (const [dx, y, z, col] of balls) m.add(new THREE.SphereGeometry(0.125, 18, 12), col, { x: bx + dx, y, z });
    // 오른쪽: 겹쳐 둔 콘과 접은 매트
    const kx = X1 + 0.5;
    for (let i = 0; i < 3; i++) {
      m.add(lathe([[0.15, 0], [0.15, 0.02], [0.105, 0.03], [0.03, 0.36], [0.0005, 0.36]], 16), tok('--orange'), { x: kx, y: i * 0.075, z: 0.42 });
    }
    m.add(new THREE.CylinderGeometry(0.076, 0.085, 0.045, 16), paper, { x: kx, y: 0.3, z: 0.42 });
    for (let i = 0; i < 3; i++) box(0.7, 0.07, 0.42, kx + 0.75, 0.035 + i * 0.072, 0.3, i % 2 ? tok('--mat-dark') : tok('--mat'));
    const roomGeom = keep(m.build());
    const roomMat = keep(toonMat({ vertexColors: true, rim: 0.15 }));
    const room = new THREE.Mesh(roomGeom, roomMat);
    room.castShadow = true;
    room.receiveShadow = true;
    this.scene.add(room);
  }

  // -------------------------------------------------------------------------
  // 이름표 그림판
  // -------------------------------------------------------------------------
  /**
   * 둥근 표시 글꼴은 글자 묶음별로 나뉘어 있어서, 이름에 쓰인 글자의 조각이 아직 안 왔을 수 있다.
   * 그 글자들을 불러 달라고 하고, 도착하면 이름표를 한 번 더 그린다.
   */
  private askFont(text: string): void {
    if (text === '' || this.fontAsked.has(text)) return;
    this.fontAsked.add(text);
    try {
      void document.fonts.load("32px 'Jua'", text).then(() => {
        if (this.disposed) return;
        this.drawAtlas();
        this.invalidate();
      }).catch(() => undefined);
    } catch { /* 글꼴 장치가 없어도 기본 글꼴로 보인다 */ }
  }

  private drawAtlas(): void {
    const c = this.atlas.ctx;
    if (!c) return;
    this.askFont(Array.from(new Set(Array.from(`멀리오래1등 m초.0123456789${this.order.map((id) => this.entries.get(id)?.item.name ?? '').join('')}`))).sort().join(''));
    const inkC = tok('--ink'), paper = tok('--paper'), soft = tok('--ink-soft');
    c.clearRect(0, 0, ATLAS, ATLAS);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const font = (px: number): string => `${px}px 'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif`;
    const chars = (s: string): string[] => Array.from(s);

    this.order.forEach((id, slot) => {
      const e = this.entries.get(id);
      if (!e || slot >= SLOTS) return;
      const x = (slot % 4) * CELL_W, y = Math.floor(slot / 4) * CELL_H;
      // 이름표: 흰 도화지 + 남색 테두리 + 아래로 떨어진 단색 그림자
      c.fillStyle = inkC;
      roundRect(c, x + 8, y + 12, CELL_W - 16, CELL_H - 16, 14);
      c.fill();
      c.fillStyle = e.item.fav ? tok('--yellow-soft') : paper;
      roundRect(c, x + 8, y + 5, CELL_W - 16, CELL_H - 18, 14);
      c.fill();
      c.lineWidth = 5;
      c.strokeStyle = inkC;
      c.stroke();
      const hasLine = e.item.line !== '';
      const maxW = CELL_W - (e.item.fav ? 98 : 40);
      const name = e.item.name;
      c.fillStyle = inkC;
      let size = 38;
      c.font = font(size);
      while (size > 27 && c.measureText(name).width > maxW) { size -= 1; c.font = font(size); }
      const cx = x + CELL_W / 2 - (e.item.fav ? 24 : 0);
      if (c.measureText(name).width <= maxW) {
        c.fillText(name, cx, y + (hasLine ? 37 : 47));
      } else {
        // 두 줄로 나눈다: 빈칸이 가운데 근처에 있으면 거기서, 없으면 글자 수 절반에서.
        const cs = chars(name);
        let cut = Math.ceil(cs.length / 2);
        for (let d = 0; d <= 2; d++) {
          if (cs[cut - d] === ' ') { cut -= d; break; }
          if (cs[cut + d] === ' ') { cut += d; break; }
        }
        const a = cs.slice(0, cut).join('').trim(), b = cs.slice(cut).join('').trim();
        size = hasLine ? 27 : 31;
        c.font = font(size);
        while (size > 20 && Math.max(c.measureText(a).width, c.measureText(b).width) > maxW) { size -= 1; c.font = font(size); }
        const top = hasLine ? 22 : 31;
        c.fillText(a, cx, y + top);
        c.fillText(b, cx, y + top + size + 1);
      }
      if (hasLine) {
        const two = c.measureText(name).width > maxW;
        c.font = font(two ? 19 : 23);
        c.fillStyle = e.item.farChamp ? tok('--blue') : e.item.longChamp ? tok('--red') : soft;
        c.fillText(e.item.line, x + CELL_W / 2, y + (two ? 78 : 72));
      }
      if (e.item.fav) this.drawStar(c, x + CELL_W - 38, y + 32, 18);
    });

    // 빈 이름표(점선)
    {
      const [x, y, w, h] = SPR.emptyTag;
      c.setLineDash([12, 9]);
      c.lineWidth = 5;
      c.strokeStyle = 'rgba(29, 42, 77, 0.5)';
      c.fillStyle = 'rgba(255, 253, 246, 0.45)';
      roundRect(c, x + 10, y + 8, w - 20, h - 22, 14);
      c.fill();
      c.stroke();
      c.setLineDash([]);
    }
    // 빈 칸의 점선 비행기
    {
      const [x, y, w, h] = SPR.ghost;
      c.save();
      c.translate(x + w / 2, y + h / 2);
      c.rotate(-0.32);
      c.setLineDash([15, 10]);
      c.lineWidth = 8;
      c.lineJoin = 'round';
      c.strokeStyle = 'rgba(29, 42, 77, 0.5)';
      c.fillStyle = 'rgba(255, 253, 246, 0.4)';
      c.beginPath();
      c.moveTo(100, -8);
      c.lineTo(-92, -70);
      c.lineTo(-58, -4);
      c.lineTo(-92, 56);
      c.closePath();
      c.fill();
      c.stroke();
      c.beginPath();
      c.moveTo(100, -8);
      c.lineTo(-58, -4);
      c.stroke();
      c.restore();
      c.setLineDash([]);
    }
    // 1등 리본(멀리: 파랑, 오래: 빨강)
    const rosette = (spr: readonly [number, number, number, number], color: string, word: string): void => {
      const [x, y, w] = spr;
      const cx = x + w / 2, cy = y + 62;
      c.lineWidth = 5;
      c.strokeStyle = inkC;
      c.fillStyle = color;
      for (const s of [-1, 1]) {
        c.beginPath();
        c.moveTo(cx + s * 6, cy + 30);
        c.lineTo(cx + s * 40, cy + 118);
        c.lineTo(cx + s * 20, cy + 104);
        c.lineTo(cx + s * 4, cy + 122);
        c.lineTo(cx - s * 8, cy + 36);
        c.closePath();
        c.fill();
        c.stroke();
      }
      c.beginPath();
      for (let i = 0; i < 24; i++) {
        const a = (i * Math.PI) / 12;
        const r = i % 2 === 0 ? 56 : 48;
        c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      c.closePath();
      c.fill();
      c.stroke();
      c.fillStyle = paper;
      c.beginPath();
      c.arc(cx, cy, 36, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = inkC;
      c.font = font(24);
      c.fillText(word, cx, cy - 11);
      c.font = font(25);
      c.fillText('1등', cx, cy + 14);
    };
    rosette(SPR.far, tok('--sky'), '멀리');
    rosette(SPR.long, tok('--red'), '오래');
    this.atlasTex.needsUpdate = true;
  }

  private drawStar(c: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    c.fillStyle = tok('--yellow');
    c.strokeStyle = tok('--ink');
    c.lineWidth = 4;
    c.lineJoin = 'round';
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.48;
      c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    c.closePath();
    c.fill();
    c.stroke();
  }

  /** 이름표, 리본, 빈 칸 그림의 네모들을 차례에 맞게 다시 깐다. */
  private rebuildDecor(): void {
    const pos: number[] = [], uv: number[] = [];
    const quad = (cx: number, cy: number, z: number, w: number, h: number, r: readonly [number, number, number, number], tilt = 0): void => {
      const [sx, sy, sw, sh] = r;
      const u0 = sx / ATLAS, u1 = (sx + sw) / ATLAS, v1 = 1 - sy / ATLAS, v0 = 1 - (sy + sh) / ATLAS;
      const dz = Math.sin(tilt) * h;
      const hh = Math.cos(tilt) * h;
      const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - hh / 2, y1 = cy + hh / 2;
      pos.push(x0, y0, z + dz / 2, x1, y0, z + dz / 2, x1, y1, z - dz / 2, x0, y0, z + dz / 2, x1, y1, z - dz / 2, x0, y1, z - dz / 2);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    };
    for (let slot = 0; slot < SLOTS; slot++) {
      const { col, row } = slotCell(slot);
      const cx = cellX(col), by = boardTop(row);
      const id = this.order[slot];
      const e = id !== undefined ? this.entries.get(id) : undefined;
      if (e) {
        quad(cx, by + TAG_H / 2 + 0.002, DEPTH - 0.012, TAG_W, TAG_H, [(slot % 4) * CELL_W, Math.floor(slot / 4) * CELL_H, CELL_W, CELL_H], 0.16);
        if (e.item.farChamp) quad(cx - CW / 2 + 0.062, by + CH - BOARD - 0.07, DEPTH + 0.012, 0.09, 0.135, SPR.far);
        if (e.item.longChamp) quad(cx + CW / 2 - 0.062, by + CH - BOARD - 0.07, DEPTH + 0.012, 0.09, 0.135, SPR.long);
      } else {
        quad(cx, by + TAG_H / 2 + 0.002, DEPTH - 0.012, TAG_W, TAG_H, SPR.emptyTag, 0.16);
        quad(cx, by + 0.215, 0.02, 0.27, 0.27, SPR.ghost);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.decor.geometry.dispose();
    this.decor.geometry = g;
  }

  // -------------------------------------------------------------------------
  // 비행기 목록
  // -------------------------------------------------------------------------
  /** 보여 줄 비행기를 차례대로 알려 준다. 새 비행기는 뒤에서 천천히 만들어 넣고, 없어진 것은 정리한다. */
  setItems(items: readonly HangarItem[]): void {
    const list = items.slice(0, SLOTS);
    const seen = new Set<string>();
    list.forEach((item, slot) => {
      seen.add(item.id);
      let e = this.entries.get(item.id);
      if (e && e.item.code !== item.code) {
        // 모양이 바뀌었다: 옛 물체를 버리고 다시 만든다.
        this.dropObject(e);
        e.failed = false;
      }
      if (!e) {
        const wrapper = new THREE.Group();
        wrapper.visible = false;
        this.scene.add(wrapper);
        e = { item, slot, wrapper, obj: null, failed: false, fromPos: new THREE.Vector3(), fromQuat: new THREE.Quaternion(), move: 1, lift: 0, pop: 0, scale: 1, bigScale: 1, baseEmissive: [], mats: [] };
        this.slotTransform(slot, 0, e.fromPos, e.fromQuat);
        this.entries.set(item.id, e);
      } else if (e.slot !== slot) {
        // 자리가 바뀌었다: 지금 있는 곳에서 새 자리로 날아간다.
        e.fromPos.copy(e.wrapper.position);
        e.fromQuat.copy(e.wrapper.quaternion);
        e.move = e.obj ? 0 : 1;
        e.slot = slot;
      }
      e.item = item;
      if (!e.obj && !e.failed && !this.queue.includes(item.id)) this.queue.push(item.id);
    });
    for (const [id, e] of this.entries) {
      if (seen.has(id)) continue;
      this.dropObject(e);
      this.scene.remove(e.wrapper);
      this.entries.delete(id);
      if (this.selected === id) this.selected = null;
    }
    this.order = list.map((i) => i.id);
    this.queue = this.queue.filter((id) => seen.has(id));
    this.drawAtlas();
    this.rebuildDecor();
    this.updatePanRange();
    this.pumpQueue();
    this.invalidate();
  }

  /** 받침대로 내보낼 비행기(없으면 null: 모두 제자리로) */
  select(id: string | null): void {
    const next = id !== null && this.entries.has(id) ? id : null;
    if (next === this.selected) return;
    this.selected = next;
    if (next !== null) {
      this.pedX = this.pan;
      this.spin = 0;
      this.spinVel = 0;
      this.autoSpin = this.reducedMotion() ? 0 : 7;
      // 고른 비행기는 기다리지 않고 맨 먼저 만든다.
      const qi = this.queue.indexOf(next);
      if (qi > 0) { this.queue.splice(qi, 1); this.queue.unshift(next); }
    }
    this.invalidate();
  }

  private reducedMotion(): boolean {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  }

  private dropObject(e: Entry): void {
    if (!e.obj) return;
    e.wrapper.remove(e.obj.group);
    e.obj.dispose();
    e.obj = null;
    e.mats = [];
    e.baseEmissive = [];
    e.wrapper.visible = false;
  }

  /** 기다리는 비행기를 한 대씩 만든다(한 번에 다 만들면 화면이 멈춘다). 지금 보이는 칸에 가까운 것부터. */
  private pumpQueue(): void {
    if (this.buildTimer !== 0 || this.queue.length === 0 || this.disposed) return;
    this.buildTimer = window.setTimeout(() => {
      this.buildTimer = 0;
      if (this.disposed) return;
      let best = 0, bestD = Infinity;
      this.queue.forEach((id, i) => {
        const e = this.entries.get(id);
        if (!e) return;
        const d = id === this.selected ? -1 : Math.abs(cellX(slotCell(e.slot).col) - this.pan);
        if (d < bestD) { bestD = d; best = i; }
      });
      const id = this.queue.splice(best, 1)[0];
      const e = id !== undefined ? this.entries.get(id) : undefined;
      if (e && !e.obj) this.buildOne(e);
      this.checkSettled();
      this.pumpQueue();
    }, 16);
  }

  private buildOne(e: Entry): void {
    try {
      const geom = this.opts.geometryOf(e.item.code);
      if (!geom) { e.failed = true; return; }
      const obj = buildPaperPlane(geom, e.item.paperId, this.tier.name === 'low' ? 1.6 : 2, this.tier.name === 'high' ? 'medium' : 'low', this.tier.anisotropy);
      obj.setResolution(this.w, this.h);
      // 물체의 가운데가 손잡이(wrapper)의 원점에 오게 한다.
      obj.group.position.copy(obj.center).multiplyScalar(-1);
      e.wrapper.add(obj.group);
      e.obj = obj;
      e.scale = Math.min(1.3, 0.185 / obj.radius);
      e.bigScale = 0.195 / obj.radius;
      e.mats = [];
      e.baseEmissive = [];
      obj.group.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (mat && (mat as THREE.MeshToonMaterial).isMeshToonMaterial) {
          const tm = mat as THREE.MeshToonMaterial;
          e.mats.push(tm);
          // 무늬가 있는 종이는 재질 색이 흰색이라, 빛낼 때는 종이의 대표색을 쓴다.
          e.baseEmissive.push(obj.look && tm.map ? new THREE.Color(obj.look.tint) : tm.color.clone());
        }
        // 그림자를 드리우게 만들어진 면만 기억해 두고, 화질 단계에 따라 켜고 끈다(외곽선은 그림자를 만들지 않는다).
        if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).castShadow) {
          o.userData.hgCast = true;
          (o as THREE.Mesh).castShadow = this.tier.shadowSize > 0;
        }
      });
      e.pop = this.reducedMotion() ? 1 : 0;
      e.wrapper.visible = true;
      this.renderer.shadowMap.needsUpdate = true;
      this.invalidate();
    } catch {
      e.failed = true;
    }
  }

  // -------------------------------------------------------------------------
  // 자리 계산
  // -------------------------------------------------------------------------
  private slotCentre(slot: number, out: THREE.Vector3): THREE.Vector3 {
    const { col, row } = slotCell(slot);
    return out.set(cellX(col), boardTop(row) + 0.2, PLANE_Z);
  }

  /** 그 칸에 놓인 비행기의 자리와 자세. 맨 윗줄은 실에 매달려 sway(흔들림 각)만큼 흔들린다. */
  private slotTransform(slot: number, sway: number, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    const { col, row } = slotCell(slot);
    const cx = cellX(col), by = boardTop(row);
    const v = ((slot * 37) % 11) / 11 - 0.5; // 칸마다 조금씩 다른 각도(늘 같은 값)
    if (row === 0) {
      const L = 0.145;
      const a = sway * (1 + v * 0.3);
      pos.set(cx + Math.sin(a) * L, by + CH - BOARD - Math.cos(a) * L, PLANE_Z + 0.01);
      this.tmpE.set(0.42, -0.62 + v * 0.2, 0.1 + a * 0.6, 'YZX');
    } else {
      pos.set(cx, by + 0.205, PLANE_Z);
      this.tmpE.set(0.34, -0.6 + v * 0.16, 0.2, 'YZX');
    }
    quat.setFromEuler(this.tmpE);
  }

  private pedestalTransform(e: Entry, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    pos.set(this.pedX, PEDESTAL_TOP + 0.14, PEDESTAL_Z);
    this.tmpE.set(0.3, -0.55 + this.spin, 0.16, 'YZX');
    quat.setFromEuler(this.tmpE);
    void e;
  }

  private updatePanRange(): void {
    const ppm = this.pxPerM(0);
    const visW = (this.w - this.wideInsets.left - this.wideInsets.right) / ppm;
    const span = HANGAR_COLS * CW;
    if (visW >= span + 0.5) { this.panMin = this.panMax = 0; } else {
      this.panMin = X0 + visW / 2 - 0.1;
      this.panMax = X1 - visW / 2 + 0.1;
    }
    // 아직 손대지 않았으면 선반의 왼쪽 끝(첫 칸)에서 시작한다. 화면 크기가 늦게 정해져도 따라간다.
    if (!this.panInit) this.pan = this.panGoal = this.panMin;
    this.panGoal = THREE.MathUtils.clamp(this.panGoal, this.panMin, this.panMax);
    this.pan = THREE.MathUtils.clamp(this.pan, this.panMin - 0.2, this.panMax + 0.2);
  }

  /** 화면 1 m 가 몇 px 인지(선반 전체 보기 f = 0, 받침대 보기 f = 1) */
  private pxPerM(f: number): number {
    const wi = this.wideInsets;
    const wide = Math.min(Math.max(120, this.h - wi.top - wi.bottom) / 1.5, Math.max(120, this.w - wi.left - wi.right) / (2.32 * CW), 560);
    const visW = Math.max(120, this.w - this.insets.left - this.insets.right);
    const visH = Math.max(120, this.h - this.insets.top - this.insets.bottom);
    const close = Math.min(visW * 0.72 / 0.42, visH / 0.6, 860);
    return wide + (close - wide) * f;
  }

  private applyCamera(): void {
    const f = ease(this.focus);
    const ppm = this.pxPerM(f);
    // 선반 면(z = PLANE_Z)이나 받침대가 화면에서 ppm 크기로 보이도록 거리를 잡는다.
    const dist = this.h / 2 / (ppm * TAN);
    const lookY = THREE.MathUtils.lerp(Y0 + (HANGAR_ROWS * CH) / 2 - 0.03, PEDESTAL_TOP + 0.1, f);
    const lookZ = THREE.MathUtils.lerp(PLANE_Z, PEDESTAL_Z, f);
    const lookX = THREE.MathUtils.lerp(this.pan, this.pedX, f);
    const rise = THREE.MathUtils.lerp(0.09, 0.36, f);
    this.camLook.set(lookX, lookY, lookZ);
    this.camPos.set(lookX, lookY + dist * rise, lookZ + dist * Math.sqrt(1 - rise * rise));
    const a = this.wideInsets, b = this.insets;
    const cx = THREE.MathUtils.lerp(a.left + (this.w - a.left - a.right) / 2, b.left + (this.w - b.left - b.right) / 2, f);
    const cy = THREE.MathUtils.lerp(a.top + (this.h - a.top - a.bottom) / 2, b.top + (this.h - b.top - b.bottom) / 2, f);
    this.camera.setViewOffset(this.w, this.h, this.w / 2 - cx, this.h / 2 - cy, this.w, this.h);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.updateMatrixWorld();
  }

  private toScreen(world: THREE.Vector3): { x: number; y: number } {
    const v = this.tmpV2.copy(world).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  // -------------------------------------------------------------------------
  // 손가락
  // -------------------------------------------------------------------------
  private pointerDown(e: PointerEvent): void {
    if (this.drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    try { this.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* 잡지 못해도 끌 수 있다 */ }
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastT: performance.now(), moved: false, mode: this.selected ? 'spin' : 'pan' };
    this.panVel = 0;
    this.autoSpin = 0;
    this.panInit = true;
  }

  private pointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8) return;
    d.moved = true;
    const now = performance.now();
    const dx = e.clientX - d.lastX;
    const dt = Math.max(1, now - d.lastT) / 1000;
    d.lastX = e.clientX;
    d.lastT = now;
    if (d.mode === 'spin') {
      this.spin += dx * 0.012;
      this.spinVel = (dx * 0.012) / dt;
    } else {
      const m = dx / this.pxPerM(0);
      // 끝을 넘어가면 고무줄처럼 덜 따라온다.
      const over = this.panGoal < this.panMin || this.panGoal > this.panMax;
      this.panGoal -= over ? m * 0.35 : m;
      this.pan = this.panGoal;
      this.panVel = -m / dt;
      this.swayVel += m * 9;
    }
    this.invalidate();
  }

  private pointerUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    try { this.renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* 이미 놓였다 */ }
    if (e.type === 'pointercancel') { this.invalidate(); return; }
    if (!d.moved) {
      this.tap(e.clientX, e.clientY);
      return;
    }
    if (d.mode === 'pan') {
      if (performance.now() - d.lastT > 90) this.panVel = 0;
      this.panGoal = THREE.MathUtils.clamp(this.pan + this.panVel * 0.28, this.panMin, this.panMax);
    } else if (performance.now() - d.lastT > 90) this.spinVel = 0;
    this.invalidate();
  }

  private tap(x: number, y: number): void {
    if (this.selected !== null) {
      // 받침대 둘레를 누르면 그대로, 다른 곳을 누르면 제자리로 돌려보낸다.
      const p = this.debug.pedestalScreen();
      const r = this.pxPerM(1) * 0.27;
      if (Math.hypot(x - p.x, y - p.y) > r) this.opts.onPick(null);
      else { this.autoSpin = this.reducedMotion() ? 0 : 5; this.invalidate(); }
      return;
    }
    this.applyCamera();
    const ppm = this.pxPerM(0);
    let hit: string | null = null, hitD = Infinity;
    this.order.forEach((id, slot) => {
      const s = this.toScreen(this.slotCentre(slot, this.tmpV));
      const dx = (x - s.x) / (ppm * CW * 0.5), dy = (y - s.y - ppm * 0.03) / (ppm * CH * 0.5);
      const dd = dx * dx + dy * dy;
      if (dd <= 1 && dd < hitD) { hitD = dd; hit = id; }
    });
    if (hit !== null) this.opts.onPick(hit);
  }

  // -------------------------------------------------------------------------
  // 그리기
  // -------------------------------------------------------------------------
  resize(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.tier.pixelRatio));
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    for (const e of this.entries.values()) e.obj?.setResolution(this.w, this.h);
    this.updatePanRange();
    this.invalidate();
  }

  /** focused: 고른 비행기의 판이 떠 있을 때의 가림이면 true(선반 전체 보기의 크기와 범위는 바꾸지 않는다) */
  setInsets(i: HangarInsets, focused = false): void {
    const a = focused ? this.insets : this.wideInsets;
    if (a.top === i.top && a.right === i.right && a.bottom === i.bottom && a.left === i.left && (focused || this.selected !== null)) return;
    this.insets = { ...i };
    if (!focused) this.wideInsets = { ...i };
    this.updatePanRange();
    this.invalidate();
  }

  setActive(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    if (on) this.invalidate();
    else this.halt();
  }

  private applyTier(t: Tier): void {
    this.tier = t;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, t.pixelRatio));
    this.renderer.setSize(this.w, this.h, false);
    const shadows = t.shadowSize > 0;
    this.key.castShadow = shadows;
    if (shadows) {
      const size = Math.min(t.shadowSize, 2048);
      if (this.key.shadow.mapSize.x !== size) {
        this.key.shadow.mapSize.set(size, size);
        this.key.shadow.map?.dispose();
        this.key.shadow.map = null;
      }
    }
    for (const e of this.entries.values()) e.obj?.group.traverse((o) => { if (o.userData.hgCast === true) (o as THREE.Mesh).castShadow = shadows; });
    this.blobs.visible = !shadows;
    this.renderer.shadowMap.needsUpdate = true;
    this.invalidate();
  }

  /** 다음 프레임에 다시 그리게 한다. */
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

  private checkSettled(): void {
    if (this.queue.length > 0 || this.needs || this.settleWaiters.length === 0) return;
    const ws = this.settleWaiters;
    this.settleWaiters = [];
    for (const w of ws) w();
  }

  private frame = (now: number): void => {
    this.rafId = 0;
    if (this.disposed || this.lost || !this.active) return;
    if (!this.renderer.domElement.isConnected || document.hidden) { this.lastNow = 0; return; }
    const raw = this.lastNow === 0 ? 1 / 60 : (now - this.lastNow) / 1000;
    const continuous = this.lastNow !== 0;
    this.lastNow = now;
    const dt = Math.min(raw, 0.1);
    const moving = this.update(dt);
    this.applyCamera();
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    const cost = performance.now() - t0;
    this.frameMs += (cost - this.frameMs) * 0.2;
    this.frames++;
    // 이어서 그린 프레임만 빠르기 판단에 쓴다(가만히 있다 한 장 그린 것은 세지 않는다).
    // 비행기를 만드는 동안에는 만드느라 늦은 것이므로 세지 않는다.
    if (continuous && raw < 1 && this.queue.length === 0 && this.buildTimer === 0) {
      this.streak++;
      this.governor.sample(raw, false);
      if (this.tier.name === 'low' && forcedTier() === null && this.streak > 3) {
        this.slowRun = raw > 0.3 ? this.slowRun + 1 : 0;
        if (this.slowRun >= 6) { this.slowRun = 0; this.opts.onSlow(); }
      }
    } else this.streak = 0;
    this.needs = moving;
    if (moving) this.rafId = requestAnimationFrame(this.frame);
    else { this.lastNow = 0; this.checkSettled(); }
  };

  /** 움직이는 것들을 dt 만큼 보낸다. 아직 움직이는 중이면 true. */
  private update(dt: number): boolean {
    let moving = false;
    const instant = this.reducedMotion();

    // 선반 따라 움직이기: 놓은 뒤에는 목표 자리로 부드럽게 미끄러진다.
    if (!this.drag) {
      this.panGoal = THREE.MathUtils.clamp(this.panGoal, this.panMin, this.panMax);
      const d = this.panGoal - this.pan;
      if (Math.abs(d) > 0.0008) {
        const step = d * (instant ? 1 : 1 - Math.exp(-dt * 9));
        this.pan += step;
        this.swayVel -= step * 9;
        moving = true;
      } else this.pan = this.panGoal;
    }
    // 매달린 비행기의 흔들림(감쇠 용수철)
    if (instant) { this.sway = 0; this.swayVel = 0; } else {
      this.swayVel += (-this.sway * 38 - this.swayVel * 3.2) * dt;
      this.swayVel = THREE.MathUtils.clamp(this.swayVel, -3, 3);
      this.sway = THREE.MathUtils.clamp(this.sway + this.swayVel * dt, -0.5, 0.5);
      if (Math.abs(this.sway) > 0.004 || Math.abs(this.swayVel) > 0.02) moving = true;
      else { this.sway = 0; this.swayVel = 0; }
    }

    // 받침대 보기로 가거나 돌아오기
    const fGoal = this.selected !== null ? 1 : 0;
    if (this.focus !== fGoal) {
      const s = instant ? 1 : dt / 0.55;
      this.focus = fGoal > this.focus ? Math.min(1, this.focus + s) : Math.max(0, this.focus - s);
      moving = true;
    }
    const f = ease(this.focus);
    this.pedestal.visible = this.focus > 0.001;
    this.pedestal.position.x = this.pedX;
    this.pedestal.scale.setScalar(0.6 + 0.4 * easeOut(this.focus));
    (this.cone.material as THREE.MeshBasicMaterial).opacity = f * 0.5;
    (this.pool.material as THREE.MeshBasicMaterial).opacity = f * 0.55;
    // 둘레를 어둡게, 받침대 위만 밝게
    const dim = 1 - 0.66 * f;
    this.hemi.intensity = 2.1 * dim;
    this.key.intensity = 1.45 * dim;
    this.fill.intensity = 0.35 * dim;
    this.decorMat.color.setScalar(0.25 + 0.75 * dim);
    this.pedTopMat.emissive.copy(this.pedTopMat.color).multiplyScalar(0.55 * f);

    // 돌림판
    if (this.selected !== null && !this.drag) {
      if (this.autoSpin > 0) {
        this.autoSpin -= dt;
        this.spinVel += (0.9 - this.spinVel) * Math.min(1, dt * 3);
        moving = true;
      } else if (Math.abs(this.spinVel) > 0.02) {
        this.spinVel *= Math.exp(-dt * 2.4);
        moving = true;
      } else this.spinVel = 0;
      this.spin += this.spinVel * dt;
    }
    this.turntable.rotation.y = -this.spin;

    // 비행기들
    let blob = 0;
    let stringN = 0;
    const sp = this.strings.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    const need = this.order.filter((_, s) => slotCell(s).row === 0).length * 6;
    let arr = sp && sp.count * 3 >= need ? (sp.array as Float32Array) : new Float32Array(Math.max(need, 6));
    if (!sp || arr !== sp.array) {
      this.strings.geometry.dispose();
      this.strings.geometry = new THREE.BufferGeometry();
      this.strings.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    }
    arr = (this.strings.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    for (const e of this.entries.values()) {
      if (!e.obj) continue;
      const isSel = e.item.id === this.selected;
      const liftGoal = isSel ? 1 : 0;
      if (e.lift !== liftGoal) {
        const s = instant ? 1 : dt / 0.6;
        e.lift = liftGoal > e.lift ? Math.min(1, e.lift + s) : Math.max(0, e.lift - s);
        moving = true;
      }
      if (e.move < 1) { e.move = instant ? 1 : Math.min(1, e.move + dt / 0.5); moving = true; }
      if (e.pop < 1) { e.pop = Math.min(1, e.pop + dt / 0.35); moving = true; }
      const { row } = slotCell(e.slot);
      this.slotTransform(e.slot, this.sway, this.tmpV, this.tmpQ);
      if (e.move < 1) {
        const k = ease(e.move);
        this.tmpV.lerpVectors(e.fromPos, this.tmpV, k);
        this.tmpV.z += Math.sin(k * Math.PI) * 0.22;
        this.tmpQ.copy(this.tmpQ2.copy(e.fromQuat).slerp(this.tmpQ, k));
      }
      let scale = e.scale;
      if (e.lift > 0) {
        const k = ease(e.lift);
        const p2 = this.tmpV2, q2 = this.tmpQ2;
        this.pedestalTransform(e, p2, q2);
        this.tmpV.lerp(p2, k);
        this.tmpV.y += Math.sin(k * Math.PI) * 0.12;
        this.tmpQ.slerp(q2, k);
        scale = e.scale + (e.bigScale - e.scale) * k;
      }
      const pop = e.pop < 1 ? 0.3 + 0.7 * easeOut(e.pop) * (1 + 0.12 * Math.sin(e.pop * Math.PI)) : 1;
      e.wrapper.position.copy(this.tmpV);
      e.wrapper.quaternion.copy(this.tmpQ);
      e.wrapper.scale.setScalar(scale * pop);
      // 받침대에 오른 비행기는 어두워진 방에서도 제 색으로 빛난다.
      const glow = 0.36 * ease(e.lift) * f;
      for (let i = 0; i < e.mats.length; i++) e.mats[i]!.emissive.copy(e.baseEmissive[i]!).multiplyScalar(glow);
      // 실(맨 윗줄, 선반에 있을 때만)
      if (row === 0 && e.lift < 0.02 && e.move >= 1 && stringN + 6 <= arr.length) {
        const cx = cellX(slotCell(e.slot).col), ty = boardTop(0) + CH - BOARD;
        arr[stringN++] = cx; arr[stringN++] = ty; arr[stringN++] = PLANE_Z + 0.01;
        arr[stringN++] = this.tmpV.x; arr[stringN++] = this.tmpV.y + 0.012; arr[stringN++] = this.tmpV.z;
      }
      // 둥근 그림자(아래 두 줄)
      if (this.blobs.visible && row !== 0 && e.lift < 0.5 && e.move >= 1) {
        this.tmpM.makeScale(0.3, 1, 0.2).setPosition(cellX(slotCell(e.slot).col), boardTop(row) + 0.019, PLANE_Z);
        this.blobs.setMatrixAt(blob++, this.tmpM);
      }
    }
    (this.strings.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.strings.geometry.setDrawRange(0, stringN / 3);
    this.blobs.count = blob;
    this.blobs.instanceMatrix.needsUpdate = true;
    if (this.key.castShadow) this.renderer.shadowMap.needsUpdate = true;
    return moving;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.halt();
    if (this.buildTimer !== 0) window.clearTimeout(this.buildTimer);
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onUp);
    el.removeEventListener('webglcontextlost', this.onCtxLost);
    document.removeEventListener('visibilitychange', this.onVis);
    this.unsubPaper();
    for (const e of this.entries.values()) this.dropObject(e);
    this.entries.clear();
    this.queue = [];
    for (const w of this.settleWaiters) w();
    this.settleWaiters = [];
    this.decor.geometry.dispose();
    this.strings.geometry.dispose();
    this.blobs.dispose();
    this.key.shadow.map?.dispose();
    this.trash.dispose();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
  }
}
