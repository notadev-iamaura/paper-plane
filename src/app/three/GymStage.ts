/**
 * 체육관 무대 (React 와 무관한 순수 three.js 코드).
 * 대회장(홈), 출발선(조준), 비행, 줄자 재기까지 한 장면에서 카메라만 옮겨 가며 보여 준다.
 *
 * 한 번의 던지기는 이렇게 흘러간다:
 *   aim -> windup(아이가 팔을 젖혔다 휘두름) -> flight(따라가는 카메라) -> landed(톡)
 *       -> tape(노란 줄자가 출발선에서 착지 지점까지 풀림) -> done(아이와 관중의 반응)
 * 단계가 바뀌는 순간과 매 프레임의 값은 events 로 바깥(화면)에 알려 준다. 숫자, 도장은 화면 쪽이 맡는다.
 *
 * 그림: 따뜻한 햇빛(왼쪽 창) + 차가운 하늘빛/따뜻한 바닥빛의 둘레 빛 + 카메라 쪽 보조 빛, 부드러운 3단 툰 음영,
 *       진짜 그림자(움직임을 따라다니는 그림자 지도), 남색 외곽선, 옅은 안개. 색 관리는 sRGB 출력, 톤 매핑 없음
 *       (색종이 색 토큰이 그대로 보이도록 빛의 세기를 1 근처로 맞췄다).
 * 좌표: core 세계 (x 앞, y 왼쪽, z 위) -> three (x, z, -y). coords.ts 참고.
 * 가벼움: 그림 파일 없음. 화질 3단계(quality.ts)를 기기에 맞춰 고르고 느리면 스스로 내린다.
 *         쉬는 장면(홈, 조준, 결과)은 초당 30장으로 줄이고, 탭이 가려지면 멈춘다.
 */
import * as THREE from 'three';
import { LIMITS } from '../../core/index';
import type { FlightSample, FlightStructure, PlaneGeometry, SimResult } from '../../core/index';
import { gradeOf } from '../lib/kidvoice';
import { log } from '../lib/logger';
import { tok } from '../lib/palette';
import { setPaperLookTier } from './paperLook';
import { buildPlaneObject } from './planeMesh';
import { createWingBend } from './tunnelBend';
import type { WingBend } from './tunnelBend';
import type { PlaneObject } from './planeMesh';
import { launchQuat, toThreeQuat, toThreeVec } from './coords';
import { buildCrowd } from './crowd';
import type { Crowd } from './crowd';
import { buildConfetti, buildDust, buildTrail } from './fx';
import type { Confetti, Dust, Trail } from './fx';
import { BANNER_TEXT, buildGym, GYM, KID_SPOT, STEP_H, SUN_DIR } from './gym';
import type { Gym } from './gym';
import { buildChibi, KID_LOOK, makeHeldActor, makeKidActor, makeRefActor, TEACHER_LOOK } from './kid';
import type { Actor, ChibiLook, KidInput, KidMode, Mood, RefActor, RefInput, RefMode } from './kid';
import { primColors, sameLook, sanitizeLook } from '../lib/characterLook';
import { loadLook } from '../lib/characterStore';
import type { CharacterLook } from '../lib/characterLook';
import type { DressActor, KidReact, ThumbView } from './kidGlb';
import { Governor, pickInitialTier, TIERS } from './quality';
import type { Tier, TierName } from './quality';
import { canvasOf, Merger, mix, radialTexture, texOf, toonMat, Trash } from './toon';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type StagePhase = 'home' | 'aim' | 'windup' | 'flight' | 'landed' | 'tape' | 'done';

export interface StageEvents {
  /** 아이 손에서 비행기가 떠나는 순간 */
  onRelease?: () => void;
  /** 비행 중 매 프레임: 지금까지 간 거리(m)와 시간(s) */
  onFrame?: (distanceM: number, timeS: number) => void;
  onLanded?: () => void;
  onTapeStart?: (durationS: number) => void;
  /** 줄자가 풀리는 동안: 지금까지 풀린 길이(m) */
  onTape?: (lengthM: number) => void;
  /** 줄자가 다 풀렸다(건너뛰었으면 skipped = true) */
  onTapeDone?: (skipped: boolean) => void;
}

export interface Insets { top: number; right: number; bottom: number; left: number }

/** 화면이 무대에 시키는 일. WebGL 이 없을 때는 같은 모양의 빈 무대(NullStage)가 대신한다. */
export interface Stage {
  events: StageEvents;
  resize: (w: number, h: number) => void;
  /** 조작 패널 등에 가려지는 가장자리 폭(px). 장면의 중심을 남은 영역 가운데로 옮긴다. */
  setInsets: (i: Insets) => void;
  setActive: (on: boolean) => void;
  /** paperId: 종이 종류. 비행기의 무늬와 질감이 여기서 정해진다. */
  setPlane: (geom: PlaneGeometry, paperId: string) => void;
  /** 대회장 구도로. */
  showHome: () => void;
  /** 출발선 구도로. 비행기는 다시 아이 손에. */
  showAim: () => void;
  /** 조준 값. pull 은 뒤로 당긴 정도(0~1). */
  setAim: (pitchDeg: number, rollDeg: number, pull: number) => void;
  setBoard: (label: string, value: string) => void;
  /** 던지는 동작을 시작한다. instant 면 움직임 없이 곧바로 결과 구도로 간다. */
  /** launch: 던지는 빠르기와 각도(알면). 계산이 늦어도 손을 떠난 비행기를 이 값으로 먼저 날려 멈춰 보이지 않게 한다. */
  beginThrow: (instant: boolean, launch?: { speedMps: number; pitchDeg: number }) => void;
  /** 계산된 비행을 넘겨준다. 던지는 동작이 끝나는 대로 재생한다. */
  setResult: (r: SimResult) => void;
  skip: () => void;
  /** 출발선 구도에서 세계 좌표(three) 한 점이 화면 어디에 오는지(px). 그릴 수 없으면 null. */
  projectAim: (x: number, y: number, z: number) => { x: number; y: number } | null;
  /**
   * (선택) 결과 등급을 알려 주면 아이와 관중의 반응이 도장과 정확히 맞는다.
   * 알려 주지 않으면 무대가 거리와 시간으로 짐작한다.
   */
  setMood?: (grade: 'great' | 'good' | 'again') => void;
  /** (선택) 내 캐릭터의 차림을 바꾼다. react 를 주면 아이가 작게 반응한다(폴짝, 올려다보기). */
  setCharacter?: (look: CharacterLook, react?: KidReact) => void;
  /** (선택) 꾸미기 구도로: 아이를 가까이서 보고, spin 만큼 돌려 세운다. showHome 을 부르면 풀린다. */
  showDress?: () => void;
  setDressSpin?: (rad: number) => void;
  /** (선택) 그 차림을 한 아이의 작은 그림. 아직 그릴 수 없으면 null. */
  kidThumb?: (look: CharacterLook, view: ThumbView, size: number, yaw?: number) => HTMLCanvasElement | null;
  /** (선택) 아이가 화면의 어디에 서 있는지(px). 모르면 null. */
  kidRect?: () => { x: number; y: number; w: number; h: number } | null;
  dispose: () => void;
}

/** 개발, 갈무리용 손잡이(window.__ppStage.debug). 놀이 흐름에는 쓰지 않는다. */
export interface StageDebug {
  tier: (name: TierName) => void;
  /** 스스로 도는 것을 멈추고, step 으로만 시간을 보낸다. */
  pause: (on: boolean) => void;
  step: (seconds: number) => void;
  info: () => { tier: TierName; calls: number; triangles: number; shadow: number; pixelRatio: number; geometries: number; textures: number; phase: StagePhase; updateMs: number; frameMs: number; lost: boolean };
  /** 카메라를 직접 놓는다(null 이면 원래대로). */
  cam: (c: { pos: [number, number, number]; look: [number, number, number]; tanH?: number; tanV?: number } | null) => void;
  /** 지어낸 비행으로 던지기 연출을 돌린다(거리 m, 시간 s). */
  fakeThrow: (distanceM: number, airtimeS: number, lateralM?: number) => void;
  loseContext: () => void;
  restoreContext: () => void;
  /** 지금까지 그린 프레임 수 */
  frames: () => number;
  /** 지금 비행기 자리와 아이 오른손 자리(던지는 동작이 끊기지 않는지 재는 검사용) */
  motion: () => { phase: StagePhase; plane: [number, number, number]; hand: [number, number, number]; throwT: number };
  scene: () => THREE.Scene;
  /** 아이 모델을 바꾼다: 'glb' = 블렌더로 만든 모델(kid.glb), 'prim' = 기본 도형 아이. 바뀌었으면 true. */
  setKid: (kind: KidKind) => Promise<boolean>;
  kidKind: () => KidKind;
  /** 심판과 관중이 모두 제자리에 들어왔는지 */
  castReady: () => boolean;
}

export type KidKind = 'prim' | 'glb';
/**
 * 블렌더로 만든 아이(kid.glb)를 쓸지. 이제 기본값이다.
 * 예전 도형 아이로 되돌리려면 localStorage['pp-kid'] = 'prim' 이거나 주소의 # 뒤에 kid-prim 을 붙인다.
 * 모델을 불러오지 못하면 도형 아이를 그대로 쓴다.
 */
function wantsGlbKid(): boolean {
  try {
    if (window.location.hash.includes('kid-prim')) return false;
    return window.localStorage.getItem('pp-kid') !== 'prim';
  } catch {
    return true;
  }
}

/** 모델(kid.glb)을 기다리며 아이 자리를 비워 두는 가장 긴 시간(장면을 지은 뒤부터). 지나면 도형 아이가 대신 선다. */
const KID_HOLD_MS = 2500;

/**
 * 블렌더로 만든 심판과 관중(referee.glb, audience.glb)을 쓸지. 기본값이다.
 * 예전 도형 인물로 되돌리려면 localStorage['pp-cast'] = 'prim' 이거나 주소의 # 뒤에 cast-prim 을 붙인다.
 * 모델을 불러오지 못하면 도형 인물이 대신 선다.
 */
function wantsGlbCast(): { ref: boolean; crowd: boolean } {
  try {
    if (window.location.hash.includes('cast-prim')) return { ref: false, crowd: false };
    // 'prim' = 둘 다 도형, 'ref' = 심판만 새 모델, 'crowd' = 관중만 새 모델(비교, 성능 재기용)
    const v = window.localStorage.getItem('pp-cast');
    return { ref: v !== 'prim' && v !== 'crowd', crowd: v !== 'prim' && v !== 'ref' };
  } catch {
    return { ref: true, crowd: true };
  }
}
/** 심판, 관중 모델을 기다리는 가장 긴 시간(첫 그림이 나간 뒤부터). 지나면 도형 인물이 대신 선다. */
const CAST_HOLD_MS = 3200;
/** 낮은 화질 단계에서도 새 관중 모델(성긴 벌)을 쓸지. false 면 낮은 단계는 기존 도형 관중을 쓴다. */
const GLB_CROWD_AT_LOW = true;

/** 비행기는 실제 크기로는 너무 작아서 그림만 키워 보여 준다(계산과는 무관). */
const PLANE_SCALE = 2;
const WINDUP_BACK_S = 0.26;
const WINDUP_SWING_S = 0.13;
const FOLLOW_S = 0.62;
const LANDED_PAUSE_S = 0.45;

/** 출발선 구도: 아이의 오른쪽 앞에서 본다. 화면 오른쪽이 던지는 방향이고, 아이 얼굴이 비스듬히 보인다. */
const AIM_POS = new THREE.Vector3(1.95, 1.5, 5.3);
const AIM_LOOK = new THREE.Vector3(0.32, 1.34, -0.35);
const AIM_TAN = { h: 0.255, v: 0.275 };

/** 아이가 서는 자리(발판 위). 비행기를 든 오른손이 던지는 선(z = 0) 위에 온다. */
const KID_POS = new THREE.Vector3(KID_SPOT.x, STEP_H, KID_SPOT.z);
const REF_POS = new THREE.Vector3(-2.8, 0, -3.6);
/**
 * 조준할 때 비행기를 드는 자리(던지는 점 (0, h, 0) 기준): 머리 뒤쪽 옆, 귀 높이.
 * 조준 카메라는 아이의 오른쪽에서 보므로, 손이 머리 옆에 있으면 주먹과 비행기가 얼굴을 가린다. 그래서 머리보다 뒤에 둔다.
 * 보이는 것만의 문제다: 휘두르는 동안 던지는 점으로 옮겨 가서, 손을 떠나는 순간에는 계산의 출발점과 같다.
 * (tools/character/anim.py 의 hold() 가 같은 값을 쓴다)
 */
const HOLD_AT = { x: -0.66, y: -0.17, z: -0.14 };
/** 끝까지 당겼을 때 더 옮겨 가는 양 */
const HOLD_PULL = { x: -0.26, y: -0.07, z: 0.02 };
/** 손은 비행기 몸통 아래를 받친다 */
const GRIP_DROP = 0.105;

const smooth = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class GymStage implements Stage {
  events: StageEvents = {};
  debug: StageDebug;

  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.1, 220);
  private gym!: Gym;
  private kid!: Actor;
  private kidKind: KidKind = 'prim';
  /** 모델(kid.glb)을 기다리며 아이 자리를 비워 둔 상태인지 */
  private kidHeld = false;
  private kidHoldTimer = 0;
  /** 무대를 만들자마자 받기 시작한 모델(첫 그림이 나가면 곧바로 선다) */
  private kidPreload: Promise<Actor | null> | null = null;
  /** 첫 그림이 나간 뒤 받기 시작하는 심판, 관중 모델 */
  private refPreload: Promise<RefActor | null> | null = null;
  private crowdPreload: Promise<Crowd | null> | null = null;
  private extrasStarted = false;
  private castTimer = 0;
  /** 심판과 관중이 모두 제자리에 들어왔는지(갈무리, 성능 재기용) */
  private castSettled = false;
  /** 아이 모델을 바꾸는 중이면 그 차례 번호(늦게 끝난 옛 요청을 버린다) */
  private kidSwapSeq = 0;
  /** 내 캐릭터의 차림(꾸미기). 모델에도, 도형 아이에도 같은 값을 입힌다. */
  private charLook: CharacterLook = loadLook();
  /** 꾸미기 구도인지와 돌려 세운 각도 */
  private dress: { spin: number } | null = null;
  private ref: RefActor | null = null;
  private crowd: Crowd | null = null;
  private dust!: Dust;
  private trails!: [Trail, Trail];
  private confetti!: Confetti;
  private planeHolder = new THREE.Group();
  private plane: PlaneObject | null = null;
  private planeInput: { geom: PlaneGeometry; paperId: string } | null = null;
  private sun: THREE.DirectionalLight;
  private fill: THREE.DirectionalLight;
  /** 장면을 다 지었는지(첫 화면을 막지 않으려고 무대를 만든 뒤 한 박자 늦게 짓는다) */
  private built = false;
  private bootTimer = 0;
  private bootRaf = 0;
  private pendingBoard: [string, string] | null = null;
  private pregym: Gym | null = null;
  private holdUntil = 0;
  /** 셰이더를 준비하는 중(그리지 않는다) */
  private warming = false;
  /** 차례로 드러내는 중이면, 남은 것을 한꺼번에 드러내는 함수 */
  private revealAll: (() => void) | null = null;
  private rested = 0;
  /** 프레임 하나를 그리는 데 든 시간(ms)의 이동 평균(일부러 쉰 시간 제외) */
  private costMs = 0;
  private restTimer = 0;
  /** 조준 값이 방금 바뀌었다: 다음 프레임을 건너뛰지 않고 곧바로 그린다 */
  private urgent = false;
  private lastTouch = 0;
  private blobs: THREE.Mesh[] = [];
  private tape!: THREE.Mesh;
  private tapePos!: THREE.BufferAttribute;
  private tapeUv!: THREE.BufferAttribute;
  private tapeCase!: THREE.Group;
  private tapeTip!: THREE.Mesh;
  private flag!: THREE.Group;
  private flagCloth!: THREE.Mesh;
  private trash = new Trash();

  private tier: Tier;
  private governor: Governor;
  private phase: StagePhase = 'home';
  private phaseT = 0;
  private clock = 0;
  private active = true;
  private hidden = false;
  private lost = false;
  private paused = false;
  private rafId = 0;
  private lastNow = 0;
  private lastDraw = 0;
  private disposed = false;
  /** 한 프레임의 움직임 계산에 든 시간(ms)의 이동 평균. 그리는 시간은 들어 있지 않다. */
  private updateMs = 0;
  private frameCount = 0;

  private w = 1;
  private h = 1;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

  private aimPitch = 5;
  private aimRoll = 0;
  private aimPull = 0;
  private pullShown = 0;
  private windupFrom = 0;
  /** 이번 던지기에서 팔을 뒤로 젖히는 시간(s) */
  private backS = WINDUP_BACK_S;
  /** 던지는 빠르기와 각도(계산이 오기 전에 손을 떠난 비행기를 움직이는 데 쓴다) */
  private launch: { speedMps: number; pitchDeg: number } | null = null;
  /** 손을 떠난 뒤 계산을 기다린 시간(s) */
  private waitT = 0;
  private throwT = 0;
  private released = false;
  private instant = false;
  private wantSkip = false;
  private kidMode: KidMode = 'home';
  private kidT = 0;
  private refMode: RefMode = 'idle';
  private refT = 0;
  private mood: Mood = 'good';
  private moodGiven: Mood | null = null;
  private airtimeEvent = false;

  private result: SimResult | null = null;
  /** 꺾인 날개 보여 주기(꺾인 비행에서만 만든다) */
  private bend: WingBend | null = null;
  private bent = false;
  private samples: FlightSample[] = [];
  private cursor = 0;
  private flightT = 0;
  private landT = 0;
  private landing = new THREE.Vector3();
  private tapeDir = new THREE.Vector3(1, 0, 0);
  private tapeLen = 0;
  private tapeDur = 1;
  private boardT = 0;
  private releaseOffset = new THREE.Vector3();
  private vel = new THREE.Vector3(1, 0, 0);
  private bank = 0;

  private camPos = new THREE.Vector3(-2.2, 1.6, 4.6);
  private camLook = new THREE.Vector3(1.5, 2.0, -6);
  private camTan = { h: 0.31, v: 0.34 };
  private camRoll = 0;
  private camOverride: { pos: THREE.Vector3; look: THREE.Vector3; tanH: number; tanV: number } | null = null;
  private snapCamera = true;
  private goalPos = new THREE.Vector3();
  private goalLook = new THREE.Vector3();
  private shadowFocus = new THREE.Vector3(1, 0, -3);
  private shadowUp = new THREE.Vector3();
  private focus = new THREE.Vector3();
  private holdAt = new THREE.Vector3();
  private gripAt = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private kidIn: KidInput;
  private refIn: RefInput;
  private onVisibility: () => void;
  private onLost: (e: Event) => void;
  private onRestored: () => void;

  constructor(private renderer: THREE.WebGLRenderer) {
    performance.mark('pp3d-ctor');
    const keep = <T extends { dispose: () => void }>(x: T): T => this.trash.keep(x);
    this.tier = TIERS[pickInitialTier(renderer.getContext())];
    this.governor = new Governor(this.tier.name, (t) => this.applyTier(TIERS[t]));

    // ---- 색과 빛 ----
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const haze = new THREE.Color(mix(tok('--wall'), tok('--yellow-soft'), 0.45));
    renderer.setClearColor(haze, 1);
    this.scene.background = haze;
    this.scene.fog = new THREE.Fog(haze, 30, 118);
    // 둘레 빛: 위에서는 차가운 하늘빛, 아래에서는 마루에 되비친 따뜻한 빛
    this.scene.add(new THREE.HemisphereLight(new THREE.Color('#e3eaff'), new THREE.Color('#ffd9ae'), 2.22));
    // 해: 왼쪽(-Z) 높은 창으로 들어오는 따뜻한 빛
    const sun = new THREE.DirectionalLight(new THREE.Color('#fff0d2'), 1.28);
    sun.castShadow = this.tier.shadowSize > 0;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.035;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    this.sun = sun;
    this.scene.add(sun, sun.target);
    // 보조 빛: 카메라가 있는 오른쪽(+Z)에서 얼굴을 밝혀 준다(그림자 없음)
    const fill = new THREE.DirectionalLight(new THREE.Color('#ffe9ee'), 0.42);
    fill.position.set(0.15, 0.45, 1);
    this.fill = fill;
    this.scene.add(fill);

    this.kidIn = { mode: 'home', t: 0, pitchDeg: 5, pull: 0, swing: 0, hold: null, lookAt: null, camera: this.camera.position, mood: 'good', facing: 0 };
    this.refIn = { mode: 'idle', t: 0, lookAt: null, facing: -0.9, pointAt: null };

    // 둥근 글꼴이 준비되면 현수막, 숫자 카드, 전광판, 이름표를 다시 그린다.
    try {
      void document.fonts.load("40px 'Jua'", `${BANNER_TEXT}0123456789.m초거리시간최고기록아직없음하늘`).then(() => {
        if (this.disposed) return;
        if (!this.built) return;
        this.gym.redrawText();
        this.kid.chibi.redrawText();
        this.kick();
      }, () => undefined);
    } catch { /* 글꼴 API 가 없으면 기기 글꼴로 그린 그대로 둔다 */ }

    // 탭이 가려지면 쉰다.
    this.onVisibility = () => {
      this.hidden = document.visibilityState === 'hidden';
      if (this.hidden) this.halt();
      else this.kick();
    };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.hidden = document.visibilityState === 'hidden';

    // WebGL 문맥을 잃으면 연출을 건너뛰어 결과가 막히지 않게 하고, 되찾으면 다시 그린다.
    this.onLost = (e) => {
      e.preventDefault();
      this.lost = true;
      this.halt();
      if (this.phase !== 'home' && this.phase !== 'aim' && this.phase !== 'done') {
        if (this.result) this.finishAll(true);
        else this.wantSkip = true;
      }
    };
    this.onRestored = () => {
      this.lost = false;
      this.kick();
    };
    renderer.domElement.addEventListener('webglcontextlost', this.onLost);
    renderer.domElement.addEventListener('webglcontextrestored', this.onRestored);

    this.debug = this.makeDebug();
    // 아이 모델은 장면을 짓는 동안 미리 받아 둔다(따로 떨어진 파일이라 첫 화면을 막지 않는다).
    if (wantsGlbKid()) {
      this.kidPreload = this.loadGlbKid().then(
        (a) => {
          if (this.disposed) { a.chibi.dispose(); return null; }
          return a;
        },
        (err) => { log.warn('three', '아이 모델을 불러오지 못했어요. 기본 아이를 써요', err); return null; },
      );
    }
    // 첫 화면(단추와 글자)이 먼저 그려지도록, 무거운 장면 짓기는 한 박자 뒤로 미룬다.
    // 캔버스가 문서에서 떨어져 있는 동안(품고 있던 화면이 사라진 경우)에는 짓지도 그리지도 않는다.
    const boot = (): void => {
      this.bootRaf = 0;
      if (this.disposed || this.built) return;
      if (!this.renderer.domElement.isConnected) { this.bootRaf = requestAnimationFrame(boot); return; }
      // 화면의 단추와 글자가 먼저 자리를 잡고 누를 수 있게 된 뒤에 짓는다.
      // 무거운 일은 몇 토막으로 나누고 사이사이 숨을 돌려, 그동안에도 화면이 눌림에 답할 수 있게 한다.
      this.bootTimer = window.setTimeout(() => {
        if (this.disposed || this.built) return;
        this.pregym = buildGym(this.renderer.capabilities.getMaxAnisotropy(), this.tier);
        performance.mark('pp3d-gym-built');
        this.bootTimer = window.setTimeout(() => this.build(true), 90);
      }, 140);
    };
    this.bootRaf = requestAnimationFrame(boot);
  }

  /** 장면 짓기 1: 체육관, 아이, 줄자 같은 뼈대. 무대를 만든 다음 박자에 부른다. */
  private build(paced = false): void {
    if (this.built || this.disposed) return;
    performance.mark('pp3d-build-start');
    const keep = <T extends { dispose: () => void }>(x: T): T => this.trash.keep(x);
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.gym = this.pregym ?? buildGym(maxAniso, this.tier);
    this.pregym = null;
    this.scene.add(this.gym.group);

    // ---- 등장인물 ----
    // 블렌더로 만든 아이(kid.glb)가 기본이다.
    //  - 아이 자리는 비워 둔 채로 첫 그림을 낸다(도형 아이를 먼저 보여 줬다가 바꾸면 "펑" 하고 바뀌는 것이 눈에 띈다).
    //    체육관이 먼저 보이고, 모델은 받아 둔 대로 바로 다음 박자에 선다. 뼈대 셰이더를 만드는 시간이 첫 그림을 늦추지 않는다.
    //  - 불러오지 못했거나 KID_HOLD_MS 가 지나도 안 오면 도형 아이가 대신 선다.
    if (this.kidPreload) {
      this.kid = makeHeldActor(this.kidLook());
      this.kidHeld = true;
      this.kidHoldTimer = window.setTimeout(() => this.endKidHold(), KID_HOLD_MS);
      void this.useKid('glb').then((ok) => { if (!ok) this.endKidHold(); });
    } else {
      this.kid = makeKidActor(buildChibi(this.kidLook()));
    }
    const kidChibi = this.kid.chibi;
    kidChibi.root.position.set(KID_POS.x, 0, KID_POS.z);
    kidChibi.setBaseY(KID_POS.y);
    this.scene.add(kidChibi.root);
    // ---- 분위기 ----
    this.dust = buildDust(TIERS.high.dust);
    this.scene.add(this.dust.points);
    this.trails = [buildTrail(20, 0.032), buildTrail(20, 0.032)];
    this.scene.add(this.trails[0].mesh, this.trails[1].mesh);
    this.confetti = buildConfetti(TIERS.high.confetti);
    this.scene.add(this.confetti.mesh);

    this.planeHolder.scale.setScalar(PLANE_SCALE);
    this.scene.add(this.planeHolder);

    const ink = tok('--ink');
    // 둥근 그림자(진짜 그림자를 끈 단계에서만 쓴다): 비행기, 아이, 심판
    const blobTex = keep(radialTexture(64, 0.15, 1.6));
    const blobGeom = keep(new THREE.PlaneGeometry(2, 2));
    const blobMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(mix(ink, tok('--court-dark'), 0.3)), map: blobTex, transparent: true, opacity: 0.34, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(blobGeom, blobMat);
      b.rotation.x = -Math.PI / 2;
      b.position.y = 0.008;
      b.renderOrder = -1;
      this.blobs.push(b);
      this.scene.add(b);
    }
    this.blobs[1]!.position.set(KID_POS.x, STEP_H + 0.024, KID_POS.z);
    this.blobs[1]!.scale.set(0.42, 0.36, 1);
    this.blobs[2]!.position.set(REF_POS.x, 0.008, REF_POS.z);
    this.blobs[2]!.scale.set(0.5, 0.42, 1);

    // ---- 줄자: 길이만큼 늘어나는 띠(눈금이 찍혀 있다). 몸통에서 비스듬히 내려와 바닥에 붙는다. ----
    const tc = canvasOf(256, 48);
    if (tc.ctx) {
      const ctx = tc.ctx;
      ctx.fillStyle = tok('--measure');
      ctx.fillRect(0, 0, 256, 48);
      ctx.fillStyle = mix(tok('--measure'), tok('--orange'), 0.35);
      ctx.fillRect(0, 40, 256, 8);
      ctx.fillStyle = ink;
      ctx.fillRect(0, 0, 256, 3);
      ctx.fillRect(0, 45, 256, 3);
      for (let i = 0; i < 20; i++) {
        const x = i * 12.8;
        const tall = i === 0 ? 30 : i === 10 ? 22 : i % 2 === 0 ? 14 : 9;
        ctx.fillStyle = i === 0 ? tok('--red') : ink;
        ctx.fillRect(x - (i === 0 ? 2.5 : 1), 3, i === 0 ? 5 : 2, tall);
      }
    }
    const tapeTex = keep(texOf(tc.canvas, Math.min(4, maxAniso)));
    tapeTex.wrapS = THREE.RepeatWrapping;
    const tg = keep(new THREE.BufferGeometry());
    this.tapePos = new THREE.BufferAttribute(new Float32Array(6 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.tapeUv = new THREE.BufferAttribute(new Float32Array(6 * 2), 2).setUsage(THREE.DynamicDrawUsage);
    tg.setAttribute('position', this.tapePos);
    tg.setAttribute('uv', this.tapeUv);
    tg.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    tg.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]);
    const tm = keep(toonMat({ map: tapeTex, side: THREE.DoubleSide }));
    tm.polygonOffset = true;
    tm.polygonOffsetFactor = -7;
    tm.polygonOffsetUnits = -7;
    this.tape = new THREE.Mesh(tg, tm);
    this.tape.frustumCulled = false;
    this.tape.receiveShadow = true;
    this.tape.visible = false;
    this.scene.add(this.tape);

    // 줄자 몸통(출발선에 놓인다)과 끝 고리(착지 지점까지 끌려간다)
    const propMat = keep(toonMat({ vertexColors: true, rim: 0.3 }));
    this.tapeCase = new THREE.Group();
    {
      const m = new Merger();
      m.add(new RoundedBoxGeometry(0.3, 0.27, 0.11, 3, 0.05), tok('--measure'), { y: 0.135 });
      m.add(new THREE.CylinderGeometry(0.075, 0.075, 0.13, 18), ink, { y: 0.15, rx: Math.PI / 2 });
      m.add(new THREE.CylinderGeometry(0.03, 0.03, 0.15, 12), tok('--red'), { y: 0.15, rx: Math.PI / 2 });
      m.add(new RoundedBoxGeometry(0.05, 0.06, 0.13, 1, 0.015), ink, { x: 0.15, y: 0.1 });
      const mesh = new THREE.Mesh(keep(m.build()), propMat);
      mesh.castShadow = true;
      this.tapeCase.add(mesh);
    }
    this.tapeCase.visible = false;
    this.scene.add(this.tapeCase);
    {
      const m = new Merger();
      m.add(new RoundedBoxGeometry(0.04, 0.07, 0.21, 1, 0.012), tok('--red'), { y: 0.035 });
      m.add(new THREE.TorusGeometry(0.04, 0.012, 6, 12), ink, { x: 0.04, y: 0.02, rx: Math.PI / 2 });
      this.tapeTip = new THREE.Mesh(keep(m.build()), propMat);
      this.tapeTip.castShadow = true;
    }
    this.tapeTip.visible = false;
    this.scene.add(this.tapeTip);

    // 착지 지점 깃발
    this.flag = new THREE.Group();
    {
      const m = new Merger();
      m.add(new THREE.CylinderGeometry(0.014, 0.014, 0.74, 8), ink, { y: 0.37 });
      m.add(new THREE.SphereGeometry(0.03, 10, 8), tok('--yellow'), { y: 0.75 });
      m.add(new THREE.CylinderGeometry(0.09, 0.11, 0.035, 14), mix(ink, tok('--paper'), 0.25), { y: 0.018 });
      const pole = new THREE.Mesh(keep(m.build()), propMat);
      pole.castShadow = true;
      const fg = keep(new THREE.PlaneGeometry(0.36, 0.24, 6, 1));
      // 삼각 깃발: 깃대 쪽이 넓고 끝이 뾰족하다
      const P = fg.getAttribute('position');
      for (let i = 0; i < P.count; i++) {
        const u = (P.getX(i) + 0.18) / 0.36;
        P.setXYZ(i, u * 0.36, P.getY(i) * (1 - u * 0.92), 0);
      }
      fg.computeVertexNormals();
      this.flagCloth = new THREE.Mesh(fg, keep(toonMat({ color: tok('--red'), side: THREE.DoubleSide })));
      this.flagCloth.position.set(0.012, 0.6, 0);
      this.flagCloth.castShadow = true;
      this.flag.add(pole, this.flagCloth);
    }
    this.flag.visible = false;
    this.scene.add(this.flag);

    this.built = true;
    if (this.pendingBoard) this.gym.setBoard(this.pendingBoard[0], this.pendingBoard[1]);
    this.applyTier(this.tier);
    this.resetFlight();
    this.snapCamera = true;
    performance.mark('pp3d-built');
    window.clearTimeout(this.bootTimer);
    const first = (): void => {
      if (this.disposed) return;
      this.warming = false;
      this.tick(0);
      performance.mark('pp3d-first-frame');
      this.preloadCast();
      // 장면 짓기 2: 심판과 관중은 첫 그림이 나간 뒤에 들어온다.
      this.bootTimer = window.setTimeout(() => this.buildExtras(paced), paced ? 700 : 120);
      this.kick();
    };
    if (paced) {
      // 셰이더를 한꺼번에 만들면 처음 방문에서 화면이 몇 초 멈출 수 있다.
      // 그래서 장면을 몇 묶음으로 나눠 차례로 드러내며(바닥과 벽 -> 소품 -> 아이) 묶음 사이에 숨 돌릴 틈을 둔다.
      this.warming = true;
      const kids = [...this.gym.group.children];
      const packs: THREE.Object3D[][] = [];
      for (let i = 0; i < kids.length; i += 3) packs.push(kids.slice(i, i + 3));
      packs.push([this.kid.chibi.root, this.planeHolder]);
      this.reveal(packs, first);
    } else first();
  }

  /** 묶음을 하나씩 보이게 하고 한 번 그린다(그 묶음의 셰이더만 새로 만든다). 다 드러나면 done 을 부른다. */
  private reveal(packs: THREE.Object3D[][], done: () => void): void {
    const was = new Map<THREE.Object3D, boolean>();
    for (const p of packs) for (const o of p) { was.set(o, o.visible); o.visible = false; }
    this.revealAll = () => {
      for (const [o, v] of was) o.visible = v;
      was.clear();
      this.revealAll = null;
    };
    let i = 0;
    let began = 0;
    const step = (): void => {
      if (this.disposed || !this.revealAll) return;
      // 앞 묶음을 그리느라 오래 멈췄다면(느린 기기) 그만큼 더 쉬었다가 다음 묶음으로 간다: 그 틈에 화면이 눌림에 답한다.
      const took = began === 0 ? 0 : performance.now() - began - 40;
      if (took > 120) {
        began = 0;
        this.bootTimer = window.setTimeout(step, Math.min(320, took * 0.7));
        return;
      }
      began = performance.now();
      const pack = packs[i++];
      if (!pack) {
        this.revealAll = null;
        done();
        return;
      }
      for (const o of pack) { o.visible = was.get(o) ?? true; was.delete(o); }
      if (!this.lost && this.renderer.domElement.isConnected) {
        this.applyCamera();
        this.renderer.render(this.scene, this.camera);
      }
      this.bootTimer = window.setTimeout(step, 40);
    };
    step();
  }

  /** 심판과 관중 모델을 받기 시작한다(첫 그림이 나간 뒤). 실패하면 null 이 되고 도형 인물이 대신 선다. */
  private preloadCast(): void {
    const want = wantsGlbCast();
    if (this.refPreload || this.crowdPreload || this.disposed) return;
    const facePx = this.tier.name === 'low' ? 1 : 1.5;
    if (want.ref) {
      this.refPreload = import('./refGlb').then((m) => m.loadRefGlb(TEACHER_LOOK(), { facePx, lite: this.tier.name !== 'high' })).catch((err) => {
        log.warn('three', '심판 모델을 불러오지 못해 기본 심판을 써요', err);
        return null;
      });
    }
    if (want.crowd && (GLB_CROWD_AT_LOW || this.tier.name !== 'low')) {
      this.crowdPreload = import('./crowdGlb').then((m) => m.loadCrowdGlb(this.tier)).catch((err) => {
        log.warn('three', '관중 모델을 불러오지 못해 기본 관중을 써요', err);
        return null;
      });
    }
  }

  /**
   * 장면 짓기 2: 심판과 관중. 모델을 기다렸다가 들이고(도형 인물을 먼저 보여 줬다가 바꾸지 않는다),
   * 불러오지 못했거나 CAST_HOLD_MS 가 지나도 안 오면 도형 인물을 세운다. 모델이 뒤늦게 오면 그때 바꾼다.
   */
  private buildExtras(paced = false): void {
    if (this.extrasStarted || this.disposed) return;
    this.extrasStarted = true;
    const primRef = (): RefActor => makeRefActor(buildChibi(TEACHER_LOOK()));
    const settle = (): void => {
      if (this.castSettled || !this.ref || !this.crowd) return;
      this.castSettled = true;
      performance.mark('pp3d-extras');
    };
    const refP = this.refPreload, crowdP = this.crowdPreload;
    if (!refP) void this.placeRef(primRef(), paced).then(settle);
    else {
      void refP.then((a) => {
        if (this.disposed) { a?.chibi.dispose(); return; }
        if (!a && this.ref) return;
        void this.placeRef(a ?? primRef(), paced).then(settle);
      });
    }
    if (!crowdP) void this.placeCrowd(buildCrowd(this.tier), paced).then(settle);
    else {
      void crowdP.then((c) => {
        if (this.disposed) { c?.dispose(); return; }
        if (!c && this.crowd) return;
        void this.placeCrowd(c ?? buildCrowd(this.tier), paced).then(settle);
      });
    }
    if (refP || crowdP) {
      this.castTimer = window.setTimeout(() => {
        if (this.disposed) return;
        if (!this.ref) void this.placeRef(primRef(), paced).then(settle);
        if (!this.crowd) void this.placeCrowd(buildCrowd(this.tier), paced).then(settle);
      }, CAST_HOLD_MS);
    }
  }

  /** 새로 들어온 것들을 장면에 넣는다. 처음 방문에서는 묶음으로 나눠 드러내 셰이더를 조금씩 만든다. */
  private async admit(objs: THREE.Object3D[], paced: boolean): Promise<void> {
    while ((this.warming || this.revealAll) && !this.disposed) await new Promise((r) => window.setTimeout(r, 60));
    if (this.disposed) return;
    if (paced && objs.length > 0) {
      const packs: THREE.Object3D[][] = [];
      for (let i = 0; i < objs.length; i += 3) packs.push(objs.slice(i, i + 3));
      this.warming = true;
      await new Promise<void>((done) => this.reveal(packs, () => { this.warming = false; done(); }));
    }
    this.kick();
  }
  private async placeRef(next: RefActor, paced: boolean): Promise<void> {
    while ((this.warming || this.revealAll) && !this.disposed) await new Promise((r) => window.setTimeout(r, 60));
    if (this.disposed) { next.chibi.dispose(); return; }
    const old = this.ref;
    if (old) { this.scene.remove(old.chibi.root); old.chibi.dispose(); }
    next.chibi.root.position.set(REF_POS.x, 0, REF_POS.z);
    next.chibi.setOutline(this.tier.crowdOutline);
    this.ref = next;
    this.scene.add(next.chibi.root);
    next.snap();
    await this.admit([next.chibi.root], paced);
  }
  private async placeCrowd(next: Crowd, paced: boolean): Promise<void> {
    while ((this.warming || this.revealAll) && !this.disposed) await new Promise((r) => window.setTimeout(r, 60));
    if (this.disposed) { next.dispose(); return; }
    const old = this.crowd;
    if (old) { this.scene.remove(old.group); old.dispose(); }
    next.setTier(this.tier);
    this.crowd = next;
    this.scene.add(next.group);
    await this.admit(next.group.children.filter((o) => o.visible), paced);
  }

  // ------------------------------------------------------------------ 바깥에서 부르는 함수
  resize(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.tier.pixelRatio));
    this.renderer.setSize(this.w, this.h, false);
    this.plane?.setResolution(this.w, this.h);
    this.kick();
  }

  setInsets(i: Insets): void {
    this.insets = i;
    this.kick();
  }

  setActive(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    if (on) this.kick();
    else this.halt();
  }

  setPlane(geom: PlaneGeometry, paperId: string): void {
    if (this.plane) {
      this.planeHolder.remove(this.plane.group);
      this.plane.dispose();
    }
    // 새로 만든 비행기는 날개가 반듯하다(꺾인 모습은 꺾인 비행을 다시 보여 줄 때 새로 만든다).
    this.bend = null;
    this.bent = false;
    this.planeInput = { geom, paperId };
    // 무늬의 크기는 화질 단계를 따른다. 체육관의 그림자 지도는 성기므로 제 그림자는 받지 않는다(접힌 자리의 그늘은 꼭짓점 색이 맡는다).
    this.plane = buildPlaneObject(geom, paperId, 2.2, { tier: this.tier.name, anisotropy: this.tier.anisotropy });
    this.plane.setResolution(this.w, this.h);
    // 기체 좌표의 원점은 기수다. 회전 중심이 무게중심이 되도록 옮겨 붙인다.
    toThreeVec(geom.cg, this.tmpV);
    this.plane.group.position.copy(this.tmpV).multiplyScalar(-1);
    this.planeHolder.add(this.plane.group);
    this.kick();
  }

  /** 도형 아이와 자리만 잡아 두는 아이에게 넘길 생김새: 고른 차림의 색과 이름을 입힌다. */
  private kidLook(): ChibiLook {
    return { ...KID_LOOK(), ...primColors(this.charLook) };
  }

  setCharacter(look: CharacterLook, react?: KidReact): void {
    const next = sanitizeLook(look);
    if (sameLook(next, this.charLook)) return;
    this.charLook = next;
    if (!this.built || this.kidHeld) { this.kick(); return; }
    const dresser = this.kid as Partial<DressActor>;
    if (this.kidKind === 'glb' && dresser.setLook) {
      dresser.setLook(next);
      if (react) dresser.react?.(react);
    } else {
      // 도형 아이는 색을 다시 칠해 새로 세운다
      this.swapKid(makeKidActor(buildChibi(this.kidLook())), 'prim');
    }
    this.kick();
  }

  showDress(): void {
    this.resetFlight();
    this.dress ??= { spin: 0 };
    this.setPhase('home');
    this.setKid('rest');
    this.setRef('idle');
    this.kick();
  }

  setDressSpin(rad: number): void {
    if (this.dress) this.dress.spin = rad;
    this.kick();
  }

  kidThumb(look: CharacterLook, view: ThumbView, size: number, yaw?: number): HTMLCanvasElement | null {
    if (!this.built || this.kidHeld || this.kidKind !== 'glb' || this.lost || this.warming) return null;
    const dresser = this.kid as Partial<DressActor>;
    return dresser.thumb ? dresser.thumb(this.renderer, look, view, size, yaw) : null;
  }

  kidRect(): { x: number; y: number; w: number; h: number } | null {
    if (!this.built || this.kidHeld) return null;
    const head = this.tmpV.copy(this.kid.chibi.headPos).project(this.camera);
    const hx = (head.x * 0.5 + 0.5) * this.w, hy = (-head.y * 0.5 + 0.5) * this.h;
    const foot = this.tmpV.set(KID_POS.x, KID_POS.y, KID_POS.z).project(this.camera);
    const fy = (-foot.y * 0.5 + 0.5) * this.h;
    const hgt = Math.max(60, fy - hy);
    if (!Number.isFinite(hx) || !Number.isFinite(hy)) return null;
    return { x: hx - hgt * 0.36, y: hy - hgt * 0.32, w: hgt * 0.72, h: hgt * 1.36 };
  }

  showHome(): void {
    this.dress = null;
    this.resetFlight();
    this.setPhase('home');
    this.setKid('home');
    this.setRef('idle');
    this.kick();
  }

  showAim(): void {
    this.dress = null;
    this.resetFlight();
    this.setPhase('aim');
    this.setKid('aim');
    this.setRef('idle');
    this.kick();
    // 조준하는 동안 한가할 때, 던진 뒤에야 처음 보이는 것들(줄자, 깃발, 바람 꼬리, 색종이)의 셰이더를 미리 만들어 둔다.
    // 미리 만들지 않으면 손을 떠나는 순간의 첫 프레임에서 만들어 느린 기기에서는 화면이 잠깐 멈춘다.
    if (!this.prewarmed) window.setTimeout(() => this.prewarmThrow(), 400);
  }

  private prewarmed = false;
  private prewarmThrow(): void {
    if (this.prewarmed || this.disposed || !this.built || this.phase !== 'aim') return;
    this.prewarmed = true;
    const objs: THREE.Object3D[] = [this.tape, this.tapeCase, this.tapeTip, this.flag, this.trails[0].mesh, this.trails[1].mesh, this.confetti.mesh];
    const was = objs.map((o) => o.visible);
    try {
      for (const o of objs) o.visible = true;
      this.renderer.compile(this.scene, this.camera);
      // 비행 카메라가 처음 비추는 먼 곳(숫자 카드, 콘, 벽 그림)의 그림도 미리 올려 둔다.
      const seen = new Set<THREE.Texture>();
      this.scene.traverse((o) => {
        const mats = (o as THREE.Mesh).material;
        for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
          for (const v of Object.values(m as unknown as Record<string, unknown>)) {
            if (v instanceof THREE.Texture && !seen.has(v)) { seen.add(v); this.renderer.initTexture(v); }
          }
        }
      });
    } catch { /* 미리 못 만들어도 던질 때 만든다 */ }
    objs.forEach((o, i) => { o.visible = was[i]!; });
  }

  setAim(pitchDeg: number, rollDeg: number, pull: number): void {
    this.aimPitch = pitchDeg;
    this.aimRoll = rollDeg;
    this.aimPull = clamp01(pull);
    this.urgent = true;
    this.lastTouch = performance.now();
    if (this.restTimer !== 0) {
      // 쉬는 중이었다면 쉬기를 끊고 바로 그린다(손가락을 따라가는 화살과 팔이 늦지 않게).
      window.clearTimeout(this.restTimer);
      this.restTimer = 0;
      this.rafId = 0;
    }
    if (this.phase === 'aim') this.kick();
  }

  setBoard(label: string, value: string): void {
    // 홈에서 보여 주는 최고 기록의 단위로 지금 종목을 짐작해 둔다(반응의 등급을 맞추는 데 쓴다).
    if (label === '최고 기록' && value !== '아직 없음') this.airtimeEvent = value.trim().endsWith('초');
    this.pendingBoard = [label, value];
    if (this.built) this.gym.setBoard(label, value);
    this.kick();
  }

  setMood(grade: Mood): void {
    this.moodGiven = grade;
    this.mood = grade;
  }

  beginThrow(instant: boolean, launch?: { speedMps: number; pitchDeg: number }): void {
    this.build();
    this.revealAll?.();
    this.warming = false;
    this.resetFlight();
    this.instant = instant;
    this.wantSkip = instant;
    this.windupFrom = this.pullShown;
    // 힘을 모으며 팔을 이미 당겨 두었으면 그만큼 뒤로 젖히는 시간을 줄인다(다 당겨 있으면 곧바로 휘두른다).
    // 예전에는 늘 0.26초를 썼는데, 팔이 이미 끝까지 당겨져 있으면 그동안 아무것도 움직이지 않아 "딱 멈춘" 것처럼 보였다.
    this.backS = WINDUP_BACK_S * Math.max(0, 1 - this.windupFrom);
    this.launch = launch ?? null;
    this.waitT = 0;
    // 쉬는 중(느린 기기에서 프레임 사이에 두는 틈)이었다면 끊고 바로 그린다: 놓는 순간 팔이 곧장 움직이게.
    this.urgent = true;
    if (this.restTimer !== 0) {
      window.clearTimeout(this.restTimer);
      this.restTimer = 0;
      this.rafId = 0;
    }
    this.throwT = 0;
    this.setPhase('windup');
    this.setKid('throw');
    this.kick();
  }

  /**
   * 날개가 꺾인 비행(result.structure.buckled)이면 꺾인 뒤로는 날개를 접어 올려 보여 준다(바람 실험실과 같은 도우미).
   * 보여 주기일 뿐이다. 도우미가 실패하면 반듯한 날개 그대로 둔다.
   */
  private showBend(on: boolean): void {
    if (on === this.bent) return;
    this.bent = on;
    if (!this.plane) return;
    try {
      if (on && !this.bend) this.bend = createWingBend(this.plane);
      const flex = on ? Math.min(40, Math.max(10, this.result?.structure?.maxFlexDeg ?? 0)) : 0;
      this.bend?.apply(flex, flex, on);
    } catch {
      this.bend = null;
    }
  }

  /** 지금 재생 시각에 날개가 이미 꺾였는지 */
  private buckledBy(t: number): boolean {
    const st = this.result?.structure;
    return Boolean(st && st.buckled && st.buckledAtS !== null && t >= st.buckledAtS);
  }

  setResult(r: SimResult): void {
    this.result = r;
    this.samples = r.samples;
    const last = r.samples[r.samples.length - 1];
    if (last) this.landing.set(last.pos.x, 0, -last.pos.y);
    const d = Math.hypot(this.landing.x, this.landing.z);
    if (d > 0.3) this.tapeDir.set(this.landing.x / d, 0, this.landing.z / d);
    else this.tapeDir.set(1, 0, 0);
    this.tapeLen = d;
    this.tapeDur = Math.min(1.7, Math.max(0.7, 0.55 + d * 0.06));
    if (!this.moodGiven) this.mood = gradeOf(this.airtimeEvent ? 'airtime' : 'distance', r);
    if (this.wantSkip) this.finishAll(true);
    this.kick();
  }

  skip(): void {
    if (this.phase === 'done' || this.phase === 'home' || this.phase === 'aim') return;
    if (this.result) this.finishAll(true);
    else this.wantSkip = true;
  }

  projectAim(x: number, y: number, z: number): { x: number; y: number } | null {
    // 카메라가 아직 옮겨 가는 중이어도 "도착했을 때"의 자리를 알려 준다.
    const pos = this.camPos.clone(), look = this.camLook.clone(), tan = { ...this.camTan }, roll = this.camRoll, over = this.camOverride;
    this.camOverride = null;
    this.camPos.copy(AIM_POS);
    this.camLook.copy(AIM_LOOK);
    this.camTan = { ...AIM_TAN };
    this.camRoll = 0;
    this.applyCamera();
    const v = this.tmpV.set(x, y, z).project(this.camera);
    const out = v.z > 1 || v.z < -1 ? null : { x: (v.x * 0.5 + 0.5) * this.w, y: (1 - (v.y * 0.5 + 0.5)) * this.h };
    this.camPos.copy(pos);
    this.camLook.copy(look);
    this.camTan = tan;
    this.camRoll = roll;
    this.camOverride = over;
    this.applyCamera();
    return out;
  }

  dispose(): void {
    this.disposed = true;
    this.halt();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onRestored);
    cancelAnimationFrame(this.bootRaf);
    window.clearTimeout(this.bootTimer);
    window.clearTimeout(this.kidHoldTimer);
    window.clearTimeout(this.castTimer);
    void this.refPreload?.then((a) => { if (a && a !== this.ref) a.chibi.dispose(); });
    void this.crowdPreload?.then((c) => { if (c && c !== this.crowd) c.dispose(); });
    void this.kidPreload?.then((a) => a?.chibi.dispose());
    this.kidPreload = null;
    this.pregym?.dispose();
    this.plane?.dispose();
    if (this.built) {
      this.gym.dispose();
      this.kid.chibi.dispose();
      this.dust.dispose();
      this.trails[0].dispose();
      this.trails[1].dispose();
      this.confetti.dispose();
    }
    this.ref?.chibi.dispose();
    this.crowd?.dispose();
    this.sun.shadow.map?.dispose();
    this.sun.dispose();
    this.trash.dispose();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
  }

  // ------------------------------------------------------------------ 안쪽 구현
  private setPhase(p: StagePhase): void {
    this.phase = p;
    this.phaseT = 0;
  }
  /**
   * 아이 모델을 바꾼다. 'glb' 는 필요할 때만 따로 내려받는다(kidGlb.ts + kid.glb).
   * 실패하면(파일이 없거나 WebGL 이 거부하면) 기본 도형 아이로 남는다.
   */
  private async useKid(kind: KidKind): Promise<boolean> {
    if (!this.kid || this.disposed) return false;
    if (kind === this.kidKind && !(this.kidHeld && kind === 'prim')) return true;
    const seq = ++this.kidSwapSeq;
    let next: Actor | null;
    try {
      if (kind === 'glb') {
        // 무대를 만들 때 받기 시작한 것이 있으면 그것을 쓴다(한 번만 쓴다)
        const pre = this.kidPreload;
        this.kidPreload = null;
        next = pre ? await pre : null;
        next ??= await this.loadGlbKid();
      } else next = makeKidActor(buildChibi(this.kidLook()));
    } catch (err) {
      log.warn('three', '새 아이 모델을 불러오지 못해 기본 아이를 그대로 써요', err);
      return false;
    }
    // 첫 그림이 나갈 때까지, 그리고 장면을 한 묶음씩 드러내는 중이면 끝날 때까지 기다린다
    // (숨겨 둔 옛 아이와 바꿔치기하면 새 아이가 안 보인다. 첫 그림 전에 넣으면 셰이더를 만드느라 첫 그림이 늦어진다).
    while ((this.warming || this.frameCount === 0) && !this.disposed) await new Promise((r) => window.setTimeout(r, 40));
    if (this.disposed || seq !== this.kidSwapSeq) { next.chibi.dispose(); return false; }
    this.swapKid(next, kind);
    return true;
  }
  private async loadGlbKid(): Promise<Actor> {
    const mod = await import('./kidGlb');
    return mod.loadKidGlb(this.kidLook(), { facePx: this.tier.name === 'low' ? 1 : 1.5, character: this.charLook });
  }
  private swapKid(next: Actor, kind: KidKind): void {
    const old = this.kid;
    window.clearTimeout(this.kidHoldTimer);
    this.kidHeld = false;
    next.chibi.root.position.set(KID_POS.x, 0, KID_POS.z);
    next.chibi.setBaseY(KID_POS.y);
    next.chibi.setOutline(this.tier.outline);
    this.scene.remove(old.chibi.root);
    old.chibi.dispose();
    this.kid = next;
    this.kidKind = kind;
    this.scene.add(next.chibi.root);
    if (this.blobs[1]) this.blobs[1].visible = this.tier.shadowSize === 0;
    next.snap();
    this.kick();
  }
  /** 비워 둔 아이 자리에 도형 아이를 세운다(모델이 너무 늦거나 불러오지 못했을 때). 모델이 뒤늦게 오면 그때 바꾼다. */
  private endKidHold(): void {
    window.clearTimeout(this.kidHoldTimer);
    if (!this.kidHeld || this.disposed) return;
    if (this.warming) { this.kidHoldTimer = window.setTimeout(() => this.endKidHold(), 80); return; }
    this.swapKid(makeKidActor(buildChibi(this.kidLook())), 'prim');
  }
  private setKid(m: KidMode): void {
    if (this.kidMode === m) return;
    this.kidMode = m;
    this.kidT = 0;
  }
  private setRef(m: RefMode): void {
    if (this.refMode === m) return;
    this.refMode = m;
    this.refT = 0;
  }

  private resetFlight(): void {
    this.showBend(false);
    this.result = null;
    this.samples = [];
    this.cursor = 0;
    this.flightT = 0;
    this.landT = 0;
    this.released = false;
    this.instant = false;
    this.wantSkip = false;
    this.moodGiven = null;
    this.bank = 0;
    this.releaseOffset.set(0, 0, 0);
    if (!this.built) return;
    this.tape.visible = false;
    this.tapeCase.visible = false;
    this.tapeTip.visible = false;
    this.flag.visible = false;
    this.trails[0].reset();
    this.trails[1].reset();
    this.confetti.clear();
    this.crowd?.calm();
  }

  private applyTier(t: Tier): void {
    this.tier = t;
    // 종이 무늬의 크기도 같은 단계를 따른다(바뀌면 App 이 비행기를 다시 입힌다).
    setPaperLookTier(t.name);
    if (!this.built) return;
    // 낮은 단계: 보조 빛을 끄고(셰이더가 가벼워진다) 안개를 당겨 먼 곳을 덜 그린다.
    this.fill.visible = t.name !== 'low';
    (this.scene.fog as THREE.Fog).far = t.name === 'low' ? 70 : 118;
    const shadows = t.shadowSize > 0;
    this.sun.castShadow = shadows;
    if (shadows && this.sun.shadow.mapSize.x !== t.shadowSize) {
      this.sun.shadow.mapSize.set(t.shadowSize, t.shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    const cam = this.sun.shadow.camera;
    cam.left = -t.shadowRange; cam.right = t.shadowRange; cam.top = t.shadowRange; cam.bottom = -t.shadowRange;
    cam.updateProjectionMatrix();
    for (const b of this.blobs) b.visible = !shadows;
    this.gym.setTier(t);
    this.crowd?.setTier(t);
    this.kid.chibi.setOutline(t.outline);
    this.ref?.chibi.setOutline(t.crowdOutline);
    this.dust.setCount(t.dust);
    this.confetti.setMax(t.confetti);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, t.pixelRatio));
    this.renderer.setSize(this.w, this.h, false);
    this.kick();
  }

  private halt(): void {
    window.clearTimeout(this.restTimer);
    this.restTimer = 0;
    this.rested = 0;
    if (this.rafId > 0) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.lastNow = 0;
  }

  /** 그리기 반복을 (다시) 시작한다. */
  private kick(): void {
    if (this.active && !this.hidden && !this.lost && !this.paused && !this.disposed && this.rafId === 0) this.rafId = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.rafId = 0;
    if (!this.active || this.hidden || this.lost || this.paused || this.disposed) return;
    if (!this.renderer.domElement.isConnected || now < this.holdUntil) { this.lastNow = 0; this.rafId = requestAnimationFrame(this.frame); return; }
    // 쉬는 장면(홈, 조준, 결과)의 잔잔한 움직임은 초당 30장이면 충분하다.
    const calm = this.phase === 'home' || this.phase === 'aim' || this.phase === 'done';
    // 조준 중 손을 대지 않은 지 2초가 넘으면 초당 20장으로 더 줄인다. 조준 값이 바뀌면 건너뛰지 않고 바로 그린다.
    const gap = this.phase === 'aim' && now - this.lastTouch > 2000 ? 48 : 29;
    if (calm && !this.urgent && this.lastDraw !== 0 && now - this.lastDraw < gap) {
      this.rafId = requestAnimationFrame(this.frame);
      return;
    }
    const raw = this.lastNow === 0 ? 0 : (now - this.lastNow) / 1000;
    const dt = Math.min(0.1, raw);
    this.lastNow = now;
    this.lastDraw = now;
    this.urgent = false;
    // 앞 프레임 하나를 그리는 데 실제로 든 시간(일부러 쉰 시간은 뺀다)
    const cost = Math.max(0, raw - this.rested);
    if (cost > 0 && cost < 1) this.costMs += (cost * 1000 - this.costMs) * 0.15;
    this.governor.sample(calm ? Math.min(cost, raw * (gap > 30 ? 0.4 : 0.6)) : cost, false);
    this.tick(dt);
    // 느린 기기에서는 프레임 사이에 숨 돌릴 틈을 둔다: 그리기가 화면의 눌림, 글자 갱신을 굶기지 않게 한다.
    if (cost > 0.045 && !this.urgent) {
      const restMs = Math.min(110, cost * 1000 * (calm ? 0.6 : 0.3));
      this.rested = restMs / 1000;
      this.rafId = -1;
      this.restTimer = window.setTimeout(() => {
        this.restTimer = 0;
        this.rafId = 0;
        this.kick();
      }, restMs);
    } else {
      this.rested = 0;
      this.rafId = requestAnimationFrame(this.frame);
    }
  };

  private tick(dt: number): void {
    if (!this.built || this.warming) return;
    this.clock += dt;
    this.phaseT += dt;
    this.kidT += dt;
    this.refT += dt;
    const t0 = performance.now();
    this.update(dt);
    this.updateCamera(dt);
    this.updateShadow(dt);
    this.updateMs += (performance.now() - t0 - this.updateMs) * 0.1;
    if (!this.lost) this.renderer.render(this.scene, this.camera);
    this.frameCount++;
  }

  /** 손에 든 비행기가 있어야 할 곳. pull: 뒤로 당긴 정도(0~1), swing: 휘두른 정도(0~1, 1 이면 손을 떠나는 자리). */
  private heldPos(pull: number, swing: number, out: THREE.Vector3): THREE.Vector3 {
    const h = LIMITS.launchHeightM;
    if (swing <= 0) return out.set(HOLD_AT.x + HOLD_PULL.x * pull, h + HOLD_AT.y + HOLD_PULL.y * pull, HOLD_AT.z + HOLD_PULL.z * pull);
    const s = swing * swing;
    const x1 = HOLD_AT.x + HOLD_PULL.x, y1 = h + HOLD_AT.y + HOLD_PULL.y, z1 = HOLD_AT.z + HOLD_PULL.z;
    return out.set(x1 * (1 - s), y1 + (h - y1) * s + 0.06 * Math.sin(Math.PI * swing), z1 * (1 - s));
  }

  private update(dt: number): void {
    const kc = this.kid.chibi;
    const holder = this.planeHolder;
    let held = false;
    let swing = 0;
    const kin = this.kidIn;
    kin.hold = null;
    kin.lookAt = null;
    kin.facing = 0;

    switch (this.phase) {
      case 'home': {
        // 카메라를 보고 선다
        kin.facing = Math.atan2(-(this.camPos.z - KID_POS.z), this.camPos.x - KID_POS.x);
        // 꾸미기 구도: 비행기는 내려놓고, 돌려 세운 만큼 돈다
        if (this.dress) kin.facing += this.dress.spin;
        held = !this.dress;
        break;
      }
      case 'aim':
        this.pullShown += (this.aimPull - this.pullShown) * (dt === 0 ? 1 : 1 - Math.exp(-dt * 22));
        this.heldPos(this.pullShown, 0, this.holdAt);
        held = true;
        kin.hold = this.gripAt.copy(this.holdAt).setY(this.holdAt.y - GRIP_DROP);
        break;
      case 'windup':
      case 'flight':
      case 'landed':
      case 'tape': {
        this.throwT += dt;
        const t = this.throwT;
        const backS = this.backS;
        if (t < backS) {
          // 지금 당긴 자리에서 이어서 끝까지 젖힌다(처음부터 속도가 붙어 있게 smooth 대신 끝에서만 늦춘다).
          const u = t / backS;
          const k = 1 - (1 - u) * (1 - u);
          swing = k;
          this.heldPos(this.windupFrom + (1 - this.windupFrom) * k, 0, this.holdAt);
        } else if (t < backS + WINDUP_SWING_S) {
          const k = (t - backS) / WINDUP_SWING_S;
          swing = 1 + k;
          this.heldPos(1, k, this.holdAt);
        } else {
          swing = 2 + (t - backS - WINDUP_SWING_S) / FOLLOW_S;
          this.heldPos(0, 1, this.holdAt);
        }
        if (swing >= 3 && this.kidMode === 'throw') this.setKid('watch');
        if (!this.released) {
          held = true;
          kin.hold = this.gripAt.copy(this.holdAt).setY(this.holdAt.y - GRIP_DROP);
        }
        break;
      }
      case 'done':
        break;
    }
    if (this.phase === 'windup') {
      if (!this.released && this.throwT >= this.backS + WINDUP_SWING_S) {
        this.released = true;
        held = false;
        kin.hold = null;
        // 손을 떠나는 자리와 계산의 출발점 사이의 작은 어긋남은 날아가며 스르르 없앤다.
        this.releaseOffset.copy(holder.position).sub(this.tmpV.set(0, LIMITS.launchHeightM, 0));
        if (this.releaseOffset.length() > 0.5) this.releaseOffset.setLength(0.5);
        if (!this.instant) {
          this.events.onRelease?.();
          this.crowd?.cheer(0.3, 0, 0.25);
        }
        this.setRef('watch');
      }
      // 손을 떠났고 계산도 끝났으면 날아간다. 계산이 조금 늦으면 그동안에도 멈추지 않는다:
      // 손을 떠나는 순간의 자리, 빠르기, 방향은 계산 전에 이미 알고 있으므로, 처음 잠깐은 그 값으로 앞으로 날려 보내고
      // 계산이 오면 그 시각의 계산값에서 이어 간다(처음 0.1~0.3초는 공기 힘보다 던진 힘이 훨씬 커서 둘이 거의 같다).
      if (this.released && !this.result) this.waitT += dt;
      if (this.released && this.result) {
        const end = this.samples[this.samples.length - 1]?.t ?? 0;
        this.setPhase('flight');
        this.flightT = Math.min(this.waitT, end * 0.5);
        this.cursor = 0;
        this.boardT = 0;
      }
    }

    // ---- 비행 ----
    if (this.phase === 'flight') {
      this.flightT += dt;
      const end = this.samples[this.samples.length - 1]?.t ?? 0;
      const before = this.tmpV2.copy(holder.position);
      if (this.flightT >= end) {
        this.applySample(end);
        this.setPhase('landed');
        this.landT = 0;
        this.events.onFrame?.(this.result?.distanceM ?? 0, this.result?.airtimeS ?? 0);
        this.events.onLanded?.();
        this.setRef('flag');
        const lvl = this.mood === 'great' ? 1 : this.mood === 'good' ? 0.7 : 0.32;
        this.crowd?.cheer(lvl, this.landing.x, this.mood === 'great' ? 3.2 : this.mood === 'good' ? 1.8 : 0.7);
      } else {
        const d = this.applySample(this.flightT);
        if (!this.bent && this.buckledBy(this.flightT)) this.showBend(true);
        holder.position.addScaledVector(this.releaseOffset, Math.exp(-this.flightT * 9));
        this.events.onFrame?.(d, this.flightT);
        this.boardT += dt;
        if (this.boardT > 0.12) {
          this.boardT = 0;
          this.gym.setBoard('거리', `${d.toFixed(1)} m`);
        }
        if (dt > 0) {
          this.tmpV.copy(holder.position).sub(before).multiplyScalar(1 / dt);
          this.vel.lerp(this.tmpV, 1 - Math.exp(-dt * 10));
        }
        // 날개 끝의 바람 꼬리
        if (this.plane) {
          holder.updateMatrixWorld(true);
          const sp = this.vel.length();
          for (let i = 0; i < 2; i++) {
            this.tmpV.copy(this.plane.tips[i]!);
            this.plane.group.localToWorld(this.tmpV);
            this.trails[i]!.push(this.tmpV, this.camera.position, sp);
          }
        }
      }
    } else if (this.phase !== 'windup') {
      this.trails[0].fade(dt);
      this.trails[1].fade(dt);
    }

    if (this.phase === 'landed') {
      this.landT += dt;
      if (this.phaseT >= LANDED_PAUSE_S) {
        this.setPhase('tape');
        this.placeTape(0);
        this.events.onTapeStart?.(this.tapeDur);
        this.setRef('point');
      }
    } else if (this.phase === 'tape') {
      this.landT += dt;
      const k = clamp01(this.phaseT / this.tapeDur);
      const eased = 1 - (1 - k) ** 3;
      this.placeTape(this.tapeLen * eased);
      this.events.onTape?.((this.result?.distanceM ?? this.tapeLen) * eased);
      if (k >= 1) this.finishAll(false);
    } else if (this.phase === 'done') {
      this.landT += dt;
      if (this.refMode === 'cheer' && this.refT > 3) this.setRef('idle');
    }

    // ---- 바라볼 곳 ----
    const flying = this.phase === 'flight' || (this.phase === 'windup' && this.released);
    if (flying) this.focus.copy(holder.position);
    else if (this.phase === 'landed' || this.phase === 'tape' || this.phase === 'done') this.focus.copy(this.landing).setY(0.3);
    else this.focus.copy(kc.headPos);
    if (this.phase !== 'home' && this.phase !== 'aim') kin.lookAt = this.focus;

    // ---- 아이 ----
    kin.mode = this.kidMode;
    kin.t = this.kidT;
    kin.pitchDeg = this.aimPitch;
    kin.pull = this.pullShown;
    kin.swing = swing;
    kin.mood = this.mood;
    kin.camera = this.camPos;
    this.kid.update(dt, this.clock, kin);

    // 아이 자리를 비워 둔 동안에는 손에 든 비행기도 그리지 않는다(허공에 떠 보이지 않게).
    holder.visible = !(this.kidHeld && held) && !this.dress;
    // 손에 든 비행기는 실제 손 위치를 따라간다(팔이 닿지 않아도 손에서 뜨지 않는다).
    if (held) {
      holder.position.copy(kc.handR);
      holder.position.y += GRIP_DROP;
      if (this.phase === 'home') {
        const bob = Math.sin(this.clock * 2.1);
        // 대회장에서는 비행기 윗면이 카메라에 보이게 비스듬히 든다
        toThreeQuat(launchQuat(24 + bob * 3, 38 + Math.sin(this.clock * 1.3) * 5), this.tmpQ2);
        holder.quaternion.setFromAxisAngle(Y_AXIS, kc.root.rotation.y + 0.75).multiply(this.tmpQ2);
      } else {
        toThreeQuat(launchQuat(this.aimPitch, this.aimRoll), holder.quaternion);
      }
    } else if (this.phase === 'windup' && this.released) {
      // 계산을 기다리는 짧은 동안: 던진 빠르기와 각도 그대로 앞으로 나아간다(멈춰 서지 않는다).
      toThreeQuat(launchQuat(this.aimPitch, this.aimRoll), holder.quaternion);
      if (this.launch) {
        const t = this.waitT, a = (this.launch.pitchDeg * Math.PI) / 180, v = this.launch.speedMps;
        holder.position.set(v * Math.cos(a) * t, Math.max(0.03, LIMITS.launchHeightM + v * Math.sin(a) * t - 4.903 * t * t), 0)
          .addScaledVector(this.releaseOffset, Math.exp(-t * 9));
      }
    }

    // ---- 심판, 관중, 분위기 ----
    const rin = this.refIn;
    rin.mode = this.refMode;
    rin.t = this.refT;
    rin.lookAt = this.phase === 'home' || this.phase === 'aim' || (this.phase === 'windup' && !this.released) ? kc.headPos : this.focus;
    rin.pointAt = this.landing;
    this.ref?.update(dt, this.clock, rin);
    this.crowd?.update(dt, this.clock, this.focus);
    this.gym.update(this.clock);
    this.dust.update(this.clock);
    this.confetti.update(dt, this.clock);
    if (this.flag.visible) {
      this.flagCloth.rotation.y = Math.sin(this.clock * 3.1) * 0.35 - 0.3;
      this.flagCloth.scale.y = 1 + Math.sin(this.clock * 5.3) * 0.06;
    }

    // 둥근 그림자(낮은 단계)
    if (this.kidHeld) this.blobs[1]!.visible = false;
    if (!this.ref) this.blobs[2]!.visible = false;
    else if (this.tier.shadowSize === 0) this.blobs[2]!.visible = true;
    if (this.blobs[0]!.visible) {
      const p = holder.position;
      const s = 0.22 * Math.max(0.45, 1 - p.y * 0.1);
      this.blobs[0]!.position.set(p.x, 0.008, p.z);
      this.blobs[0]!.scale.set(s * 1.5, s, 1);
    }
  }

  /** 모든 연출을 끝낸 상태로 만든다. */
  private finishAll(skipped: boolean): void {
    if (!this.result) return;
    const end = this.samples[this.samples.length - 1]?.t ?? 0;
    this.cursor = 0;
    this.applySample(end);
    // 꺾인 채로 내려앉은 비행기는 꺾인 모습으로 놓인다(건너뛰었을 때도).
    if (this.buckledBy(end)) this.showBend(true);
    this.released = true;
    this.placeTape(this.tapeLen);
    this.flag.visible = true;
    this.flag.position.copy(this.landing).addScaledVector(this.tapeDir, 0.02);
    this.flag.position.x += this.tapeDir.z * 0.34;
    this.flag.position.z -= this.tapeDir.x * 0.34;
    this.flag.rotation.y = Math.atan2(-this.tapeDir.z, this.tapeDir.x);
    this.gym.setBoard('거리', `${this.result.distanceM.toFixed(2)} m`);
    const was = this.phase;
    this.setPhase('done');
    this.wantSkip = false;
    this.setKid('react');
    this.setRef(this.mood === 'great' ? 'cheer' : 'idle');
    if (skipped) {
      this.snapCamera = true;
      this.landT = 10;
      this.kidT = 10;
      this.kid.snap();
      this.ref?.snap();
      this.trails[0].reset();
      this.trails[1].reset();
    } else if (this.mood !== 'again') {
      // 색종이 조각: 착지 지점과 아이 머리 위에서 터진다
      const n = this.mood === 'great' ? 0.5 : 0.22;
      this.confetti.burst(this.tmpV.copy(this.landing).setY(2.4), Math.round(this.tier.confetti * n), 1.5, 2.2);
      this.confetti.burst(this.tmpV.set(KID_POS.x, 2.6, KID_POS.z), Math.round(this.tier.confetti * n * 0.8), 1.3, 2.4);
    }
    if (was !== 'done') this.events.onTapeDone?.(skipped);
    this.kick();
  }

  private placeTape(len: number): void {
    const l = Math.max(0.02, len);
    const u = this.tapeDir;
    const hw = 0.085;
    const nx = -u.z * hw, nz = u.x * hw;
    const put = (i: number, s: number, y: number): void => {
      const x = u.x * s, z = u.z * s;
      this.tapePos.setXYZ(i * 2, x - nx, y, z - nz);
      this.tapePos.setXYZ(i * 2 + 1, x + nx, y, z + nz);
      this.tapeUv.setXY(i * 2, s, 0);
      this.tapeUv.setXY(i * 2 + 1, s, 1);
    };
    const mid = Math.min(0.3, l * 0.5);
    put(0, 0, 0.1);
    put(1, mid, 0.014);
    put(2, l, 0.014);
    this.tapePos.needsUpdate = true;
    this.tapeUv.needsUpdate = true;
    this.tape.visible = true;
    const yaw = Math.atan2(-u.z, u.x);
    // 줄자 몸통은 출발선에 놓여 있고, 끝의 고리가 착지 지점까지 끌려간다.
    this.tapeCase.visible = true;
    this.tapeCase.position.set(-u.x * 0.15, 0, -u.z * 0.15);
    this.tapeCase.rotation.y = yaw;
    this.tapeTip.visible = true;
    this.tapeTip.position.set(u.x * l, 0, u.z * l);
    this.tapeTip.rotation.y = yaw;
  }

  /** 시간 t 의 위치와 자세를 앞뒤 표본 사이에서 보간해 비행기에 적용한다. 돌려주는 값은 출발선에서의 거리. */
  private applySample(t: number): number {
    const n = this.samples.length;
    if (n === 0) return 0;
    while (this.cursor < n - 2 && this.samples[this.cursor + 1]!.t <= t) this.cursor++;
    const a = this.samples[this.cursor]!;
    const b = this.samples[Math.min(this.cursor + 1, n - 1)]!;
    const span = b.t - a.t;
    const k = span > 1e-9 ? clamp01((t - a.t) / span) : 0;
    const x = a.pos.x + (b.pos.x - a.pos.x) * k;
    const y = a.pos.y + (b.pos.y - a.pos.y) * k;
    const z = a.pos.z + (b.pos.z - a.pos.z) * k;
    this.planeHolder.position.set(x, Math.max(0.03, z), -y);
    toThreeQuat(a.quat, this.tmpQ);
    toThreeQuat(b.quat, this.tmpQ2);
    this.planeHolder.quaternion.copy(this.tmpQ).slerp(this.tmpQ2, k);
    return Math.hypot(x, y);
  }

  // ---- 그림자 지도: 지금 벌어지는 일(아이, 비행기, 착지 지점) 둘레만 촘촘히 덮는다 ----
  private updateShadow(dt: number): void {
    if (!this.sun.castShadow) return;
    const g = this.tmpV;
    switch (this.phase) {
      case 'home': g.set(2.5, 0, -4.5); break;
      case 'aim':
      case 'windup': g.set(2, 0, -4); break;
      case 'flight': g.set(this.planeHolder.position.x + 3.5, 0, Math.max(-6, Math.min(6, this.planeHolder.position.z - 2.5))); break;
      default: g.set(this.landing.x - this.tapeDir.x * 3, 0, this.landing.z - this.tapeDir.z * 3 - 1.5); break;
    }
    if (dt === 0 || this.snapCamera) this.shadowFocus.copy(g);
    else this.shadowFocus.lerp(g, 1 - Math.exp(-dt * 5));
    // 그림자가 일렁이지 않게, 지도의 화소 한 칸 단위로만 움직인다.
    const texel = (this.tier.shadowRange * 2) / this.tier.shadowSize;
    const right = this.tmpV2.crossVectors(Y_AXIS, SUN_DIR).normalize();
    const upV = this.shadowUp.crossVectors(SUN_DIR, right);
    const a = Math.round(this.shadowFocus.dot(right) / texel) * texel;
    const b = Math.round(this.shadowFocus.dot(upV) / texel) * texel;
    const c = this.shadowFocus.dot(SUN_DIR);
    const f = this.sun.target.position;
    f.set(0, 0, 0).addScaledVector(right, a).addScaledVector(upV, b).addScaledVector(SUN_DIR, c);
    this.sun.position.copy(f).addScaledVector(SUN_DIR, 45);
    this.sun.target.updateMatrixWorld();
  }

  // ---- 카메라 ----
  private updateCamera(dt: number): void {
    const p = this.planeHolder.position;
    const gp = this.goalPos, gl = this.goalLook;
    let tanH = 0.4, tanV = 0.3, rate = 4, roll = 0;
    const wide = this.w > this.h * 1.15;
    switch (this.phase) {
      case 'home': {
        // 대회장: 아이, 그 뒤의 관람석과 현수막, 오른쪽으로 멀어지는 체육관
        const sway = Math.sin(this.clock * 0.3) * 0.22;
        if (this.dress) {
          // 꾸미기: 발판 위의 아이를 머리부터 발끝까지 가까이서 본다
          gp.set(KID_POS.x - 1.25, 1.32, KID_POS.z + 4.3);
          gl.set(KID_POS.x, KID_POS.y + 0.9, KID_POS.z);
          tanH = 0.17; tanV = 0.27;
          rate = 5;
          break;
        }
        if (wide) {
          gp.set(-2.6 + sway, 1.5, 4.6);
          gl.set(2.2, 1.86, -6);
          tanH = 0.5; tanV = 0.305;
        } else {
          gp.set(-2.05 + sway, 1.5, 4.25);
          gl.set(0.9, 1.84, -5.85);
          tanH = 0.3; tanV = 0.34;
        }
        rate = 2.6;
        break;
      }
      case 'aim':
      case 'windup':
        gp.copy(AIM_POS);
        gl.copy(AIM_LOOK);
        tanH = AIM_TAN.h; tanV = AIM_TAN.v; rate = 3.4;
        if (this.phase === 'windup') {
          // 던지는 순간 살짝 물러나며 앞쪽을 본다
          const k = clamp01(this.throwT / 0.4);
          gp.x += 0.25 * k; gp.z += 0.35 * k;
          gl.x += 0.4 * k;
          rate = 5;
        }
        break;
      case 'flight': {
        // 비행기의 오른쪽 뒤, 조금 위에서 따라간다. 나아가는 쪽을 미리 내다보고, 비행기가 기울면 화면도 살짝 기운다.
        const sp = Math.max(0.5, this.vel.length());
        const vx = this.vel.x / sp, vz = this.vel.z / sp;
        const back = 1.55, sideOff = 1.05;
        gp.set(p.x - vx * back - vz * 0.3, p.y + 0.9, p.z - vz * back + sideOff);
        gl.set(p.x + vx * 0.55, p.y - 0.12 + Math.max(-0.4, Math.min(0.3, this.vel.y * 0.06)), p.z + vz * 0.55 - 0.05);
        // 기운 정도: 기체의 오른쪽 날개가 내려간 만큼
        this.tmpV.set(0, 0, 1).applyQuaternion(this.planeHolder.quaternion);
        const want = Math.max(-0.5, Math.min(0.5, -this.tmpV.y)) * 0.3;
        this.bank += (want - this.bank) * (1 - Math.exp(-dt * 3));
        roll = this.bank;
        tanH = 0.4; tanV = 0.4; rate = 9;
        break;
      }
      case 'landed':
      case 'tape':
      case 'done': {
        // 착지 지점 너머에서 출발선 쪽을 돌아본다: 줄자가 이쪽으로 쭉 풀려 온다. 그동안 천천히 돌며 다가간다.
        const u = this.tapeDir;
        const L = this.landing;
        const k = smooth(clamp01(this.landT / 3.2));
        const back = Math.min(3.3, 1.5 + this.tapeLen * 0.12) * (1.28 - 0.3 * k);
        const side = 2.5 - 1.15 * k;
        gp.set(L.x + u.x * back - u.z * side, 2.05 - 0.4 * k, L.z + u.z * back + u.x * side);
        gl.set(L.x - u.x * (1.2 + 0.5 * k), 0.3, L.z - u.z * (1.2 + 0.5 * k));
        tanH = 0.42; tanV = 0.36; rate = 3.2;
        break;
      }
    }
    // 벽, 바닥, 관람석, 천장 트러스를 뚫지 않게
    gp.y = Math.min(8.4, Math.max(0.5, gp.y));
    gp.z = Math.min(GYM.halfZ - 0.9, Math.max(GYM.bleacherZ + 1.3, gp.z));
    gp.x = Math.max(GYM.backX + 0.8, gp.x);
    if (this.snapCamera || dt === 0) {
      this.camPos.copy(gp);
      this.camLook.copy(gl);
      this.camTan.h = tanH;
      this.camTan.v = tanV;
      this.camRoll = roll;
      this.snapCamera = false;
    } else {
      const k = 1 - Math.exp(-dt * rate);
      const kl = 1 - Math.exp(-dt * rate * 1.5);
      this.camPos.lerp(gp, k);
      this.camLook.lerp(gl, kl);
      this.camTan.h += (tanH - this.camTan.h) * k;
      this.camTan.v += (tanV - this.camTan.v) * k;
      this.camRoll += (roll - this.camRoll) * k;
    }
    this.camPos.y = Math.max(0.45, this.camPos.y);
    this.applyCamera();
  }

  /** 가려지지 않은 영역 가운데로 장면의 중심을 옮기고, 그 영역 안에 필요한 범위가 다 들어오도록 화각을 정한다. */
  private applyCamera(): void {
    const { w, h } = this;
    const o = this.camOverride;
    const tan = o ? { h: o.tanH, v: o.tanV } : this.camTan;
    const ins = o ? { top: 0, right: 0, bottom: 0, left: 0 } : this.insets;
    const visW = Math.max(80, w - ins.left - ins.right);
    const visH = Math.max(80, h - ins.top - ins.bottom);
    const tanHalf = Math.min(1.25, Math.max((tan.v * h) / visH, (tan.h * h) / visW));
    this.camera.fov = (Math.atan(tanHalf) * 360) / Math.PI;
    this.camera.aspect = w / h;
    const cx = ins.left + visW / 2;
    const cy = ins.top + visH / 2;
    this.camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);
    this.camera.position.copy(o ? o.pos : this.camPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(o ? o.look : this.camLook);
    if (!o && this.camRoll !== 0) this.camera.rotateZ(this.camRoll);
    this.camera.updateMatrixWorld();
  }

  private makeDebug(): StageDebug {
    return {
      tier: (name) => this.governor.lock(name),
      pause: (on) => {
        this.paused = on;
        if (on) this.halt();
        else this.kick();
      },
      step: (seconds) => {
        this.build();
        this.revealAll?.();
        this.warming = false;
        this.buildExtras();
        let left = seconds;
        while (left > 1e-6) {
          const dt = Math.min(1 / 30, left);
          left -= dt;
          this.clock += dt; this.phaseT += dt; this.kidT += dt; this.refT += dt;
          const t0 = performance.now();
          this.update(dt);
          this.updateCamera(dt);
          this.updateShadow(dt);
          this.updateMs += (performance.now() - t0 - this.updateMs) * 0.1;
        }
        this.applyCamera();
        if (this.lost) return;
        this.renderer.render(this.scene, this.camera);
      },
      info: () => ({
        tier: this.tier.name,
        calls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        shadow: this.sun.castShadow ? this.sun.shadow.mapSize.x : 0,
        pixelRatio: this.renderer.getPixelRatio(),
        geometries: this.renderer.info.memory.geometries,
        textures: this.renderer.info.memory.textures,
        phase: this.phase,
        updateMs: this.updateMs,
        frameMs: this.costMs,
        lost: this.lost,
      }),
      cam: (c) => {
        this.camOverride = c ? { pos: new THREE.Vector3(...c.pos), look: new THREE.Vector3(...c.look), tanH: c.tanH ?? 0.3, tanV: c.tanV ?? 0.3 } : null;
        this.applyCamera();
      },
      fakeThrow: (distanceM, airtimeS, lateralM = 0) => {
        const samples: FlightSample[] = [];
        const n = Math.max(2, Math.round(airtimeS * 60));
        const h0 = LIMITS.launchHeightM;
        for (let i = 0; i <= n; i++) {
          const u = i / n;
          const t = u * airtimeS;
          const x = distanceM * (1 - (1 - u) ** 1.35);
          const z = h0 + Math.sin(u * Math.PI) * distanceM * 0.07 - h0 * u * u;
          const y = lateralM * u * u;
          const pitch = 12 * (1 - u * 2.2);
          samples.push({ t, pos: { x, y, z: Math.max(0.02, z) }, quat: launchQuat(pitch, -lateralM * 4 * Math.sin(u * Math.PI)), speed: 6, alphaDeg: 5 });
        }
        // 지어낸 비행이라 종이는 멀쩡했던 것으로 둔다(꺾임 없음, 한도까지 버팀).
        const structure: FlightStructure = { collapsedAtLaunch: false, buckled: false, buckledAtS: null, peakLoadRatio: 0, maxFlexDeg: 0, safeThrowSpeedMps: LIMITS.throwSpeedMax, noteKo: null };
        const r: SimResult = { distanceM, airtimeS, maxHeightM: 2, lateralM, verdict: 'glide', diagnosisKo: '', tipsKo: [], samples, structure };
        this.beginThrow(false);
        this.setResult(r);
      },
      loseContext: () => { this.renderer.forceContextLoss(); },
      restoreContext: () => { this.renderer.forceContextRestore(); },
      frames: () => this.frameCount,
      motion: () => {
        const p = this.planeHolder.position, h = this.kid.chibi.handR;
        return { phase: this.phase, plane: [p.x, p.y, p.z], hand: [h.x, h.y, h.z], throwT: this.throwT };
      },
      scene: () => this.scene,
      setKid: (kind) => {
        this.build();
        return this.useKid(kind);
      },
      kidKind: () => this.kidKind,
      castReady: () => this.castSettled,
    };
  }
}

/** WebGL 을 쓸 수 없는 기기용 빈 무대. 그림은 없지만 같은 순서로 신호를 보내 놀이가 그대로 이어진다. */
export class NullStage implements Stage {
  events: StageEvents = {};
  private timer = 0;
  private pending: SimResult | null = null;
  private waiting = false;
  resize(): void { /* 그릴 것이 없다 */ }
  setInsets(): void { /* 그릴 것이 없다 */ }
  setActive(): void { /* 그릴 것이 없다 */ }
  setPlane(): void { /* 그릴 것이 없다 */ }
  showHome(): void { this.cancel(); }
  showAim(): void { this.cancel(); }
  setAim(): void { /* 그릴 것이 없다 */ }
  setBoard(): void { /* 그릴 것이 없다 */ }
  beginThrow(): void {
    this.cancel();
    this.waiting = true;
  }
  setResult(r: SimResult): void {
    if (!this.waiting) return;
    this.pending = r;
    this.timer = window.setTimeout(() => this.finish(), 250);
  }
  skip(): void {
    if (this.pending) this.finish();
  }
  projectAim(): null { return null; }
  dispose(): void { this.cancel(); }
  private finish(): void {
    const r = this.pending;
    this.cancel();
    if (!r) return;
    this.events.onFrame?.(r.distanceM, r.airtimeS);
    this.events.onTape?.(r.distanceM);
    this.events.onTapeDone?.(true);
  }
  private cancel(): void {
    window.clearTimeout(this.timer);
    this.pending = null;
    this.waiting = false;
  }
}
