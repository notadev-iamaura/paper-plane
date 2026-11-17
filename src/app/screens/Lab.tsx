/**
 * 바람 실험실: 격납고 방 한쪽의 장난감 풍동.
 * 비행기를 받침대에 올리고, 선풍기 바람을 세게 약하게 바꾸고, 비행기를 손으로 잡아 고개를 들었다 숙였다 하면서
 * 연기가 어떻게 흐르는지, 뜨는 힘이 제 무게를 이기는지 본다.
 *
 * 숫자는 모두 core 의 probeTunnel / tunnelTrim 이 계산한 값이다(여기서는 공기 힘을 계산하지 않는다).
 * 연기 모양은 그 힘을 바탕으로 그린 그림이다(lib/lab/flowModel.ts).
 * 본 흐름에는 어려운 말을 쓰지 않는다: 받음각 -> 고개 각도, 양력 -> 뜨는 힘, 항력 -> 막는 힘. 제 이름은 연구 노트에서 알려 준다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { decodeDesign, encodeDesign, PAPERS } from '../../core/index';
import type { PlaneDesign } from '../../core/index';
import { evaluateDesign } from '../lib/evaluation';
import { designOfCode, paperShortName } from '../lib/hangar';
import { buildFlowModel, roughen } from '../lib/lab/flowModel';
import {
  balanceOutcome, balanceWords, EXPERIMENTS, experimentLesson, favouriteSpeedAsync, fmt1, gfText, isStalledView, labNoteLines, liftHeadline,
  measureLabNote, nearBest, newtonText, noseWord, probeMemo, snapAlpha, snapBeta, snapSpeed, starsOf, strongWind, sweepMemo, WIND_WORD, windLevel,
} from '../lib/lab/labMath';
import type { AlphaSweep, BalanceOutcome, ExperimentId, FavouriteSpeed, LabNote } from '../lib/lab/labMath';
import { loadLabProgress, markExperimentDone, saveCodeNote } from '../lib/lab/labStore';
import { CORE_TUNNEL, idlePause, PHYSICS_VERSION, TUNNEL_LIMITS } from '../lib/lab/tunnelCore';
import { log } from '../lib/logger';
import { playSound, setSoundEnabled, setWindSound, soundEnabled, subscribeSound, unlockSound } from '../lib/sound';
import { useHangarApi } from '../components/HangarKit';
import { Icon } from '../components/Icons';
import { HoldButton, LabIcon, LiftDial, Stars } from '../components/LabBits';
import { LabFlat } from '../components/LabFlat';
import { paperTint } from '../three/hangarPaper';
import { TunnelCanvas } from '../three/TunnelCanvas';
import type { TunnelAnchors, TunnelStage, TunnelView } from '../three/TunnelStage';
import './lab.css';

export interface LabSubject {
  design: PlaneDesign;
  /** 설계 코드(던지기 값 없음) */
  code: string;
  name: string;
  /** 격납고에 들어 있는 비행기면 그 id */
  hangarId: string | null;
}

interface Props {
  subject: LabSubject;
  from: 'hangar' | 'desk';
  onClose: () => void;
}

type Tab = 'cards' | 'compare' | 'note' | 'detail';
const TABS: { id: Tab; label: string }[] = [
  { id: 'cards', label: '실험 카드' },
  { id: 'compare', label: '견주기' },
  { id: 'note', label: '쪽지' },
  { id: 'detail', label: '자세히' },
];

const FLAT_NOTE: Record<'nogl' | 'lost' | 'slow', string> = {
  nogl: '이 기기에서는 입체 실험실을 보여 줄 수 없어서 그림으로 보여 줘요.',
  lost: '입체 실험실이 멈춰서 그림으로 바꿔 보여 줘요.',
  slow: '입체 실험실이 너무 느려서 그림으로 바꿔 보여 줘요.',
};

interface Pinned {
  name: string;
  paperId: string;
  speedMps: number;
  alphaDeg: number;
  liftN: number;
  dragN: number;
  liftToDrag: number;
  flexDeg: number;
  buckled: boolean;
  /** 고개를 옆으로 돌린 각도(견줄 때 같은 조건인지 보는 데 쓴다) */
  betaDeg: number;
}

const EDGE_GUARD = 16;
/** 날개가 이만큼 휘면 "펄럭거린다"고 알려 준다(도). 이쯤부터 막는 힘이 눈에 띄게 커진다. */
const FLUTTER_FLEX_DEG = 15;
const L = TUNNEL_LIMITS;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const signed = (v: number): string => `${v < 0 ? '−' : v > 0 ? '+' : ''}${fmt1(Math.abs(v)).replace(/\.0$/, '')}`;

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export function Lab({ subject, from, onClose }: Props): JSX.Element {
  const api = useHangarApi();
  const planes = api.data.planes;
  const [speed, setSpeed] = useState(0);
  const [alpha, setAlpha] = useState(5);
  const [beta, setBeta] = useState(0);
  const [variant, setVariant] = useState<{ paperId: string | null; planeId: string | null }>({ paperId: null, planeId: null });
  const [tab, setTab] = useState<Tab>('cards');
  const [flat, setFlat] = useState<'nogl' | 'lost' | 'slow' | null>(null);
  const [stage, setStage] = useState<TunnelStage | null>(null);
  const [detail, setDetail] = useState(false);
  const [pinned, setPinned] = useState<Pinned | null>(null);
  const [balanceOn, setBalanceOn] = useState(false);
  const [anim, setAnim] = useState<{ alpha: number; moving: boolean } | null>(null);
  const [fav, setFav] = useState<FavouriteSpeed | null>(null);
  const [sweep, setSweep] = useState<AlphaSweep | null>(null);
  const [progress, setProgress] = useState(loadLabProgress);
  const [activeExp, setActiveExp] = useState<ExperimentId | null>(null);
  const [lessons, setLessons] = useState<Partial<Record<ExperimentId, string>>>({});
  const [writing, setWriting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sound, setSound] = useState(soundEnabled);
  const sceneRef = useRef<HTMLDivElement>(null);
  const liftRef = useRef<HTMLDivElement>(null);
  const dragLblRef = useRef<HTMLDivElement>(null);
  const weightRef = useRef<HTMLDivElement>(null);
  const anchors = useRef<TunnelAnchors | null>(null);

  // ---- 지금 받침대에 올린 비행기(다른 종이, 다른 비행기로 잠깐 바꿔 볼 수 있다. 저장된 비행기는 바뀌지 않는다) ----
  const cur = useMemo(() => {
    let base = subject.design, name = subject.name;
    if (variant.planeId !== null) {
      const p = planes.find((x) => x.id === variant.planeId);
      const d = p ? designOfCode(p.code) : null;
      if (p && d) { base = d; name = p.name; }
    }
    const want = variant.paperId !== null && variant.paperId !== base.paperId ? { ...base, paperId: variant.paperId } : base;
    const code = encodeDesign(want);
    // 코드로 바꿨다 되돌린 값으로 계산한다(다른 화면, 서버와 숫자가 같게).
    const design = decodeDesign(code)?.design ?? want;
    const ev = evaluateDesign(design, code);
    return { design, code, name, geometry: ev.geometry };
  }, [subject, variant, planes]);
  const geom = cur.geometry;
  const geomRef = useRef(geom);
  geomRef.current = geom;
  const isBase = variant.paperId === null && variant.planeId === null;
  const baseGeom = useMemo(() => evaluateDesign(subject.design, subject.code).geometry, [subject]);

  // ---- 혼자 균형 잡기: 축을 풀었을 때 어떻게 되는지(균형 각도는 core 의 tunnelTrim) ----
  const alphaRef = useRef(alpha);
  alphaRef.current = anim ? anim.alpha : alpha;
  const outcome = useMemo<BalanceOutcome | null>(
    () => (balanceOn ? balanceOutcome(CORE_TUNNEL, geom, speed, clamp(alphaRef.current, L.alphaMin, L.alphaMax)) : null),
    [balanceOn, geom, speed],
  );
  useEffect(() => {
    if (!outcome || outcome.kind === 'calm') { setAnim(null); return undefined; }
    const start = alphaRef.current;
    const still = reducedMotion();
    let raf = 0;
    const t0 = performance.now();
    const finish = (a: number, keep: boolean): void => {
      if (keep) setAnim({ alpha: a, moving: false });
      else { setAlpha(a); setAnim(null); }
    };
    if (outcome.kind === 'tumble') {
      const end = start + outcome.dir * 520;
      if (still) { finish(end, true); return undefined; }
      const T = 2.6;
      const step = (now: number): void => {
        const t = Math.min(1, (now - t0) / 1000 / T);
        const e = t * t * (3 - 2 * t);
        if (t >= 1) { finish(end, true); return; }
        setAnim({ alpha: start + outcome.dir * 520 * e, moving: true });
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    }
    const target = outcome.alphaDeg;
    const amp = start - target;
    if (still || Math.abs(amp) < 0.05) { finish(target, false); return undefined; }
    // 바람이 셀수록 빨리 흔들리고 빨리 잦아든다. 앞이 너무 무거우면 받침에 톡톡 부딪히며 멈춘다.
    const w = 2 * Math.PI * (0.5 + 0.1 * speed), z = 1.4 + 0.12 * speed;
    const step = (now: number): void => {
      const t = (now - t0) / 1000;
      const env = Math.exp(-z * t);
      if ((t > 0.35 && Math.abs(amp) * env < 0.12) || t > 4) { finish(target, false); return; }
      const swing = outcome.kind === 'nose-down' ? Math.abs(Math.cos(w * t)) : Math.cos(w * t);
      setAnim({ alpha: target + amp * env * swing, moving: true });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [outcome]);

  const shownAlpha = anim ? anim.alpha : alpha;
  const tumbled = balanceOn && outcome?.kind === 'tumble';
  const probeAlpha = clamp(shownAlpha, L.alphaMin, L.alphaMax);
  // 조절값이 바뀔 때마다 한 번(같은 값은 기억해 둔 것을 쓴다): 화면 한 장에 많아야 한 번 계산한다.
  const reading = useMemo(() => probeMemo(CORE_TUNNEL, geom, speed, probeAlpha, beta), [geom, speed, probeAlpha, beta]);
  const model = useMemo(() => {
    const m = buildFlowModel(reading, geom, { speedMps: speed, alphaDeg: shownAlpha, betaDeg: beta });
    return tumbled ? roughen(m) : m;
  }, [reading, geom, speed, shownAlpha, beta, tumbled]);
  const stalled = !tumbled && isStalledView(reading, speed);
  const shake = tumbled ? (anim?.moving ? 0 : 0.5) : stalled ? clamp(reading.stalledFraction * (speed / 8), 0.15, 1) : 0;
  const ghost = useMemo(() => (pinned ? { liftN: pinned.liftN, dragN: pinned.dragN } : null), [pinned]);

  const view = useMemo<TunnelView>(
    () => ({ speedMps: speed, alphaDeg: shownAlpha, betaDeg: beta, reading, model, detail, ghost, arrows: !tumbled, shake }),
    [speed, shownAlpha, beta, reading, model, detail, ghost, tumbled, shake],
  );
  useEffect(() => { stage?.setPlane(geom, cur.design.paperId); }, [stage, geom, cur.design.paperId]);
  useEffect(() => { stage?.setView(view); }, [stage, view]);

  // ---- 화살표 이름표를 화살표 끝에 붙인다(그릴 때마다 무대가 자리를 알려 준다) ----
  const onAnchors = useCallback((a: TunnelAnchors) => {
    anchors.current = a;
    const host = sceneRef.current;
    if (!host) return;
    const r = host.getBoundingClientRect();
    // 이름표는 화살표 끝 바깥에 둔다: 뜨는 힘은 위, 무게는 아래, 막는 힘은 옆. 비행기를 가리지 않게 축에서 조금 떨어뜨리고,
    // 그래도 서로 겹치면 위아래로 민다.
    const boxes: { el: HTMLDivElement; x: number; y: number; w: number; h: number }[] = [];
    const px = a.pivot.x - r.left, py = a.pivot.y - r.top;
    // 비행기가 차지하는 만큼은 비워 둔다(꼬리 쪽 길이와 날개 폭을 화면 크기로 어림한다).
    const g = geomRef.current;
    const clearSide = Math.min(r.width * 0.34, a.pxPerM * Math.max(0.04, g.stats.lengthM + g.cg.x) * 0.8);
    const clearUp = Math.max(30, a.pxPerM * g.stats.spanM * 0.22);
    const want = (el: HTMLDivElement | null, p: { x: number; y: number } | null, where: 'up' | 'down' | 'side'): void => {
      if (!el) return;
      if (!p) { el.style.visibility = 'hidden'; return; }
      el.style.visibility = 'visible';
      const w = el.offsetWidth, h = el.offsetHeight;
      const tx = p.x - r.left, ty = p.y - r.top;
      let x: number, y: number;
      if (where === 'up') { x = tx - w / 2; y = Math.min(ty - h - 5, py - clearUp - h); }
      else if (where === 'down') { x = tx - w / 2; y = Math.max(ty + 5, py + 36); }
      else { x = Math.max(tx + 7, px + clearSide); y = ty - h / 2 + 14; }
      boxes.push({ el, w, h, x: clamp(x, 4, r.width - w - 4), y: clamp(y, 40, r.height - h - 6) });
    };
    want(liftRef.current, a.lift, 'up');
    want(dragLblRef.current, a.drag, 'side');
    want(weightRef.current, a.weight, 'down');
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const p = boxes[i]!, q = boxes[j]!;
        if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h + 2 && q.y < p.y + p.h + 2) {
          const up = p.y <= q.y ? p : q, down = up === p ? q : p;
          const over = up.y + up.h + 2 - down.y;
          up.y = Math.max(40, up.y - over / 2);
          down.y = Math.min(r.height - down.h - 4, up.y + up.h + 2);
        }
      }
    }
    for (const bx of boxes) bx.el.style.transform = `translate(${bx.x.toFixed(1)}px, ${bx.y.toFixed(1)}px)`;
  }, []);
  const onFlat = useCallback((why: 'nogl' | 'lost' | 'slow') => {
    log.warn('lab', FLAT_NOTE[why]);
    setStage(null);
    setFlat(why);
  }, []);

  // ---- 바람 소리(소리가 켜져 있을 때만) ----
  useEffect(() => subscribeSound(() => setSound(soundEnabled())), []);
  useEffect(() => {
    setWindSound(speed > 0.05 ? 0.15 + 0.85 * (speed / L.speedMax) : 0);
  }, [speed, sound]);
  useEffect(() => () => setWindSound(0), []);

  // ---- 조작 ----
  const releaseBalance = useCallback(() => {
    if (!balanceOn) return;
    setBalanceOn(false);
    setAnim(null);
    setAlpha(snapAlpha(clamp(alphaRef.current, L.alphaMin, L.alphaMax), L));
  }, [balanceOn]);
  const changeSpeed = (v: number): void => setSpeed(snapSpeed(v, L));
  const stepAlpha = useCallback((dir: 1 | -1): boolean => {
    const now = snapAlpha(clamp(alphaRef.current, L.alphaMin, L.alphaMax), L);
    const next = snapAlpha(now + dir, L);
    if (balanceOn) { setBalanceOn(false); setAnim(null); }
    setAlpha(next);
    return next !== now || balanceOn;
  }, [balanceOn]);

  // 비행기를 잡고 돌린다: 축을 중심으로 손가락이 돈 만큼 고개가 돈다(축 가까이에서는 위아래로 끈 만큼).
  const drag = useRef<{ id: number; startAlpha: number; lastPhi: number; turned: number; y: number; far: boolean } | null>(null);
  const pivotPoint = (): { x: number; y: number; reach: number } | null => {
    const host = sceneRef.current;
    if (!host) return null;
    if (flat === null && anchors.current) {
      const a = anchors.current;
      return { x: a.pivot.x, y: a.pivot.y, reach: Math.max(70, a.pxPerM * Math.max(0.1, geom.stats.lengthM) * 0.8 + 30) };
    }
    const el = host.querySelector('[data-lab-pivot]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, reach: Math.max(70, host.clientWidth * 0.3) };
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target instanceof Element && e.target.closest('button')) return;
    if (e.pointerType !== 'mouse') {
      const vw = window.innerWidth;
      if (e.clientX < EDGE_GUARD || e.clientX > vw - EDGE_GUARD) return;
    }
    const p = pivotPoint();
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist > p.reach) return;
    const startAlpha = clamp(alphaRef.current, L.alphaMin, L.alphaMax);
    if (balanceOn) { setBalanceOn(false); setAnim(null); setAlpha(snapAlpha(startAlpha, L)); }
    drag.current = { id: e.pointerId, startAlpha, lastPhi: Math.atan2(dy, dx), turned: 0, y: e.clientY, far: dist > 26 };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 잡지 못해도 끌기는 된다 */ }
    setDragging(true);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const p = pivotPoint();
    if (!p) return;
    let next: number;
    if (d.far) {
      const phi = Math.atan2(e.clientY - p.y, e.clientX - p.x);
      let dphi = phi - d.lastPhi;
      if (dphi > Math.PI) dphi -= 2 * Math.PI;
      if (dphi < -Math.PI) dphi += 2 * Math.PI;
      d.lastPhi = phi;
      d.turned += (dphi * 180) / Math.PI;
      next = d.startAlpha + d.turned;
    } else next = d.startAlpha + (d.y - e.clientY) * 0.4;
    setAlpha(snapAlpha(next, L));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
  };
  // 비행기 위에서 손가락을 움직일 때 화면이 따라 밀리지 않게 한다(touch-action: none 에 더해 직접 막는다).
  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return undefined;
    const stop = (e: TouchEvent): void => { if (e.cancelable) e.preventDefault(); };
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  }, []);

  // ---- 좋아하는 속도(균형 모드나 쪽지에서 쓴다): 한가할 때 조금씩 찾는다 ----
  useEffect(() => {
    setFav(null);
    if (!balanceOn) return undefined;
    let alive = true;
    void favouriteSpeedAsync(CORE_TUNNEL, geom, idlePause).then((f) => { if (alive) setFav(f); });
    return () => { alive = false; };
  }, [geom, balanceOn]);

  // ---- 각도 훑어보기(딱 좋은 각도 실험과 자세히 보기의 그래프): 조절이 잠잠해지면 한가할 때 계산한다 ----
  const needSweep = activeExp === 'best' || tab === 'detail';
  useEffect(() => {
    if (!needSweep || speed < 0.5) { setSweep(null); return undefined; }
    let alive = true;
    const id = window.setTimeout(() => {
      void idlePause().then(() => { if (alive) setSweep(sweepMemo(CORE_TUNNEL, geom, speed)); });
    }, 160);
    return () => { alive = false; window.clearTimeout(id); };
  }, [needSweep, geom, speed]);

  // ---- 작은 실험: 목표를 이루면 도장을 찍고, 던지기와 이어 주는 한마디를 적는다 ----
  const exp = useRef({ sawBelow: false, angles: new Set<number>() });
  useEffect(() => { exp.current = { sawBelow: false, angles: new Set<number>() }; }, [activeExp]);
  const strong = strongWind(L);
  useEffect(() => {
    if (activeExp === null || tumbled || anim?.moving) return;
    const id = activeExp;
    const done = (lesson: string): void => {
      if (lessons[id] === lesson) return;
      setLessons((prev) => ({ ...prev, [id]: lesson }));
      if (progress.done[id] === undefined) playSound('pop');
      setProgress(markExperimentDone(id, Date.now()));
    };
    if (id === 'lift') {
      if (reading.liftToWeight < 1) exp.current.sawBelow = true;
      else if (exp.current.sawBelow && speed >= 0.5) done(experimentLesson('lift', { speedMps: speed, alphaDeg: probeAlpha }));
    } else if (id === 'best') {
      exp.current.angles.add(Math.round(probeAlpha));
      if (speed >= 2 && sweep && sweep.speedMps === Math.round(speed * 10) / 10 && exp.current.angles.size >= 3 && nearBest(sweep, probeAlpha, reading.liftToDrag)) {
        done(experimentLesson('best', { speedMps: speed, alphaDeg: sweep.bestAlphaDeg ?? probeAlpha }));
      }
    } else if (id === 'stall') {
      if (speed >= 2 && isStalledView(reading, speed)) done(experimentLesson('stall', { speedMps: speed, alphaDeg: probeAlpha }));
    } else if (id === 'paper') {
      if (pinned && pinned.speedMps >= strong && speed >= strong && pinned.paperId !== cur.design.paperId) {
        // 같은 바람, 같은 각도에서 쟀을 때만 힘(뜨는 힘, 막는 힘)을 나란히 견준다.
        const same = pinned.speedMps === speed && Math.abs(pinned.alphaDeg - probeAlpha) < 0.01 && pinned.betaDeg === beta;
        done(experimentLesson('paper', {
          speedMps: speed, alphaDeg: probeAlpha,
          flexNowDeg: Math.max(Math.abs(reading.flexLeftDeg), Math.abs(reading.flexRightDeg)), flexPinnedDeg: pinned.flexDeg,
          buckledNow: reading.buckled, buckledPinned: pinned.buckled,
          ...(same ? { liftNowN: reading.liftN, liftPinnedN: pinned.liftN, dragNowN: reading.dragN, dragPinnedN: pinned.dragN } : {}),
        }));
      }
    }
  }, [activeExp, reading, speed, probeAlpha, beta, sweep, pinned, cur.design.paperId, tumbled, anim, lessons, progress, strong]);

  const pinNow = (): void => {
    setPinned({
      name: cur.name, paperId: cur.design.paperId, speedMps: speed, alphaDeg: probeAlpha,
      liftN: reading.liftN, dragN: reading.dragN, liftToDrag: reading.liftToDrag,
      flexDeg: Math.max(Math.abs(reading.flexLeftDeg), Math.abs(reading.flexRightDeg)), buckled: reading.buckled, betaDeg: beta,
    });
  };

  // ---- 쪽지: 알아낸 것을 한꺼번에 재서 비행기에 붙인다 ----
  const savedNote: LabNote | null = (subject.hangarId !== null ? planes.find((p) => p.id === subject.hangarId)?.lab : undefined) ?? progress.notes[subject.code] ?? null;
  const writeNote = async (): Promise<void> => {
    if (writing) return;
    setWriting(true);
    try {
      await idlePause();
      await favouriteSpeedAsync(CORE_TUNNEL, baseGeom, idlePause);
      await idlePause();
      const note = measureLabNote(CORE_TUNNEL, baseGeom, PHYSICS_VERSION, Date.now());
      if (subject.hangarId !== null && planes.some((p) => p.id === subject.hangarId)) api.saveLab(subject.hangarId, note);
      else setProgress(saveCodeNote(subject.code, note));
      playSound('pop');
    } catch (err) {
      log.warn('lab', '쪽지를 적지 못했어요', err);
    } finally {
      setWriting(false);
    }
  };

  // 갈무리, 검사용 손잡이: 조절값을 한 번에 맞춘다(놀이 흐름에는 쓰지 않는다. 계산과 그리기는 단추로 바꿀 때와 같은 길을 탄다).
  useEffect(() => {
    const w = window as unknown as { __ppLabUi?: unknown };
    w.__ppLabUi = {
      set: (v: { speed?: number; alpha?: number; beta?: number }) => {
        if (typeof v.speed === 'number') setSpeed(clamp(Math.round(v.speed * 10) / 10, L.speedMin, L.speedMax));
        if (typeof v.alpha === 'number') { setBalanceOn(false); setAnim(null); setAlpha(snapAlpha(v.alpha, L)); }
        if (typeof v.beta === 'number') setBeta(snapBeta(v.beta, L));
      },
    };
    return () => { delete w.__ppLabUi; };
  }, []);

  // Esc 로 나간다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && document.querySelector('.dialog') === null) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ---- 보여 줄 말 ----
  const level = windLevel(speed, L.speedMax);
  const head = tumbled ? { ok: false, text: '뒤집혔어요' } : liftHeadline(reading, speed);
  // 뒤집힌 동안에는 힘을 잴 수 없다(고개 각도가 실험 범위 밖이다).
  const liftG = tumbled ? '–' : gfText(reading.liftN), dragG = tumbled ? '–' : gfText(reading.dragN), weightG = gfText(reading.weightN);
  const stars = tumbled || speed < 0.05 ? 0 : starsOf(reading.liftToDrag);
  const bw = outcome ? balanceWords(outcome) : null;
  const flexMax = Math.max(Math.abs(reading.flexLeftDeg), Math.abs(reading.flexRightDeg));
  let caption: { tone: 'warn' | 'info' | 'good'; text: string } | null = null;
  if (speed < 0.05) caption = { tone: 'info', text: '선풍기 손잡이를 밀어서 바람을 켜 봐요.' };
  else if (tumbled) caption = { tone: 'warn', text: bw?.title ?? '' };
  else if (reading.buckled) caption = { tone: 'warn', text: '바람이 너무 세서 날개가 꺾였어요. 더 빳빳한 종이나 좁은 날개가 필요해요.' };
  else if (stalled) caption = { tone: 'warn', text: '고개를 너무 들어서 바람이 날개에서 떨어져 나갔어요.' };
  else if (balanceOn && bw && !anim?.moving) caption = { tone: outcome?.kind === 'settle' ? 'good' : 'warn', text: bw.title };
  // 많이 휜 날개는 펄럭거려서 뜨는 힘이 새고 막는 힘이 커진다(꺾이기 전에도 이미 손해다).
  else if (flexMax >= FLUTTER_FLEX_DEG) caption = { tone: 'warn', text: `바람에 날개가 ${fmt1(flexMax)}도 휘어서 펄럭거려요. 뜨는 힘이 새요.` };
  else if (flexMax >= 8) caption = { tone: 'info', text: `바람에 날개가 ${fmt1(flexMax)}도 휘었어요.` };
  const sub = speed < 0.05
    ? `내 무게는 ${weightG} g이에요`
    : reading.liftN >= 0 ? `${liftG} g 만큼 들어 올려요` : `${gfText(-reading.liftN)} g 만큼 눌러요`;

  const others = planes.filter((p) => p.code !== subject.code);
  const expHint = (id: ExperimentId): string => {
    if (id === 'lift') {
      if (speed < 0.05) return '선풍기 손잡이를 오른쪽으로 밀어 봐요.';
      // 바람을 끝까지 올려도 이 고개 각도로는 못 뜨는 비행기: 헛되이 더 올리라고 하지 않는다.
      if (reading.liftToWeight < 1 && speed >= L.speedMax - 0.05) return `가장 센 바람인데도 ${liftG} g만큼만 들려요(내 무게는 ${weightG} g). 위로 단추로 고개를 조금 들어 봐요.`;
      if (reading.liftToWeight < 1 && reading.liftN <= 0) return `지금은 바람이 비행기를 눌러요. 위로 단추로 고개를 조금 들어 봐요.`;
      if (reading.liftToWeight < 1) return `지금은 ${liftG} g만큼 들려요. 내 무게는 ${weightG} g이에요. 조금 더 세게!`;
      return exp.current.sawBelow ? '' : '바람을 줄였다가 다시 천천히 올려 봐요.';
    }
    if (id === 'best') {
      if (speed < 2) return '먼저 바람을 켜요. 보통 바람이면 좋아요.';
      if (!sweep || sweep.bestAlphaDeg === null) return '위로, 아래로 단추를 눌러 고개를 움직여 봐요.';
      if (probeAlpha < sweep.bestAlphaDeg - 1) return `지금 별 ${stars}개예요. 고개를 조금 더 들어 봐요.`;
      if (probeAlpha > sweep.bestAlphaDeg + 1) return `지금 별 ${stars}개예요. 고개를 조금 숙여 봐요.`;
      return '거의 다 왔어요. 한 칸씩 움직여 봐요.';
    }
    if (id === 'stall') {
      if (speed < 2) return '먼저 바람을 켜요.';
      return '위로 단추를 꾹 눌러 고개를 자꾸 들어 봐요. 연기가 날개 위에서 떨어지는지 봐요.';
    }
    if (speed < strong || (pinned !== null && pinned.speedMps < strong && pinned.paperId === cur.design.paperId)) return `바람을 센 바람(${fmt1(strong)} m/s 이상)으로 올려요.`;
    if (!pinned || pinned.speedMps < strong) return '견주기에서 "지금 값 붙여 두기"를 눌러요.';
    return '견주기에서 다른 종이를 골라 봐요. 날개가 얼마나 휘는지, 막는 힘이 얼마나 달라지는지 봐요.';
  };

  const toggleSound = (): void => {
    const next = !soundEnabled();
    setSoundEnabled(next);
    if (next) unlockSound();
  };
  const fill = (speed / L.speedMax) * 100;
  const activeDef = activeExp !== null ? (EXPERIMENTS.find((e) => e.id === activeExp) ?? null) : null;

  return (
    <section className={`lab${flat ? ' lab--flat' : ''}`} aria-labelledby="lab-title" data-testid="lab" data-view={flat ? 'flat' : '3d'} data-from={from} data-code={cur.code}>
      <header className="lab__bar">
        <button type="button" className="bar__btn bar__btn--back" onClick={onClose} data-testid="lab-close">
          <Icon name="back" size={22} /><span className="bar__label">{from === 'hangar' ? '격납고로' : '책상으로'}</span>
        </button>
        <h1 id="lab-title" className="lab__title tape tape--blue">바람 실험실</h1>
        <span className="bar__gap" />
        <button type="button" className="bar__btn" role="switch" aria-checked={sound} onClick={toggleSound} data-testid="lab-sound" aria-label={`소리 ${sound ? '켬' : '끔'}`}>
          <Icon name={sound ? 'soundOn' : 'soundOff'} size={24} />
        </button>
      </header>

      <div
        className={`lab__scene${dragging ? ' is-dragging' : ''}`}
        ref={sceneRef}
        data-grab=""
        data-testid="lab-scene"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onLostPointerCapture={onUp}
      >
        {flat === null
          ? <TunnelCanvas onStage={setStage} onFlat={onFlat} onAnchors={onAnchors} active />
          : <LabFlat geometry={geom} tint={paperTint(cur.design.paperId)} speedMps={speed} alphaDeg={shownAlpha} reading={reading} model={model} arrows={!tumbled} ghost={ghost} shake={shake} />}
        {flat === null && (
          <div className="lab__labels" aria-hidden="true">
            <div ref={liftRef} className="lab-lbl lab-lbl--lift">뜨는 힘 <b className="num">{liftG}</b> g<small className="num">{newtonText(reading.liftN)}</small></div>
            <div ref={dragLblRef} className="lab-lbl lab-lbl--drag">막는 힘 <b className="num">{dragG}</b> g<small className="num">{newtonText(reading.dragN)}</small></div>
            <div ref={weightRef} className="lab-lbl lab-lbl--weight">무게 <b className="num">{weightG}</b> g<small className="num">{newtonText(reading.weightN)}</small></div>
          </div>
        )}
        <div className="lab__who">
          <span className="chip lab__name" data-testid="lab-plane-name">{cur.name}</span>
          <span className={`chip${isBase ? '' : ' lab__temp'}`} data-testid="lab-paper">{paperShortName(cur.design.paperId)}{isBase ? '' : ' (잠깐 바꿔 봄)'}</span>
        </div>
        {caption && <p className={`lab__caption lab__caption--${caption.tone}`} role="status" data-testid="lab-caption">{caption.text}</p>}
        {flat && <p className="lab__flatnote" data-testid="lab-flat-note">{FLAT_NOTE[flat]}</p>}
      </div>

      <div className="lab__panel sheet">
        <div
          className={`lab-read${head.ok ? ' is-ok' : ''}`}
          data-testid="lab-read"
          data-speed={speed} data-alpha={Number(probeAlpha.toFixed(2))} data-beta={beta}
          data-lift-n={reading.liftN} data-drag-n={reading.dragN} data-weight-n={reading.weightN}
          data-ltw={reading.liftToWeight} data-ltd={reading.liftToDrag} data-stalled={reading.stalledFraction}
          data-flex-l={reading.flexLeftDeg} data-flex-r={reading.flexRightDeg} data-buckled={reading.buckled ? '1' : '0'}
          data-tumbled={tumbled ? '1' : '0'} data-settled={balanceOn && outcome?.kind === 'settle' && !anim ? '1' : '0'}
        >
          <div className="lab-read__dial">
            <LiftDial ratio={tumbled ? 0 : reading.liftToWeight} on={speed >= 0.05} />
            <span className="lab-read__dialcap">내 무게</span>
          </div>
          <div className="lab-read__main">
            <b className="lab-read__head" data-testid="lab-headline" aria-live="polite">{head.text}</b>
            <span className="lab-read__sub" data-testid="lab-sub">{tumbled ? '힘을 잴 수 없어요' : sub}</span>
          </div>
          <div className="lab-read__eff"><span>알뜰함</span><Stars count={stars} /></div>
          <div className="lab-read__nums">
            <span data-testid="lab-lift-g"><i className="lab-dot lab-dot--lift" />뜨는 힘 <b className="num">{liftG}</b> g</span>
            <span data-testid="lab-weight-g"><i className="lab-dot lab-dot--weight" />무게 <b className="num">{weightG}</b> g</span>
            <span data-testid="lab-drag-g"><i className="lab-dot lab-dot--drag" />막는 힘 <b className="num">{dragG}</b> g</span>
          </div>
        </div>

        <div className="lab-wind" data-level={level}>
          <span className={`lab-wind__fan lab-wind__fan--${level}`} aria-hidden="true"><LabIcon name="fan" size={34} /></span>
          <div className="lab-wind__body">
            <div className="lab-wind__head">
              <b className="lab-wind__word" data-testid="lab-wind-word">{WIND_WORD[level]}</b>
              <output className="lab-wind__num num" data-testid="lab-wind-num">{fmt1(speed)} m/s</output>
            </div>
            <div className="slider__row">
              <button type="button" className="slider__nudge" aria-label="바람 약하게" disabled={speed <= L.speedMin} onClick={() => changeSpeed(speed - 0.5)} data-testid="lab-wind-down">−</button>
              <div className="slider__track">
                <input type="range" aria-label="바람 세기" min={L.speedMin} max={L.speedMax} step={0.5} value={speed} style={{ '--fill': `${fill}%` } as React.CSSProperties} onChange={(e) => changeSpeed(Number(e.target.value))} data-testid="lab-wind" />
              </div>
              <button type="button" className="slider__nudge" aria-label="바람 세게" disabled={speed >= L.speedMax} onClick={() => changeSpeed(speed + 0.5)} data-testid="lab-wind-up">+</button>
            </div>
          </div>
        </div>

        <div className="lab-angle">
          <div className="lab-step" role="group" aria-label="고개 각도">
            <HoldButton dir={-1} label="아래로" atEnd={!balanceOn && alpha <= L.alphaMin} onStep={stepAlpha} testId="lab-angle-down" ariaLabel="고개 아래로 숙이기" />
            <output className="lab-step__now" aria-live="polite" data-testid="lab-angle" data-alpha={Number(probeAlpha.toFixed(2))}>
              <span className="lab-step__deg num">{tumbled ? '?' : `${signed(Math.round(probeAlpha * 10) / 10)}°`}</span>
              <span className="lab-step__word">{tumbled ? '뒤집혔어요' : noseWord(probeAlpha)}</span>
            </output>
            <HoldButton dir={1} label="위로" atEnd={!balanceOn && alpha >= L.alphaMax} onStep={stepAlpha} testId="lab-angle-up" ariaLabel="고개 위로 들기" />
          </div>
          <button type="button" className={`lab-free${balanceOn ? ' is-on' : ''}`} role="switch" aria-checked={balanceOn} onClick={() => (balanceOn ? releaseBalance() : setBalanceOn(true))} data-testid="lab-balance">
            <LabIcon name="scale" size={22} /><span>{balanceOn ? '손으로 잡기' : '혼자 균형 잡기'}</span>
          </button>
        </div>

        {balanceOn && bw && (
          <div className={`lab-bal lab-bal--${outcome?.kind ?? 'calm'}`} data-testid="lab-balance-box" data-kind={outcome?.kind}>
            <b>{bw.title}</b>
            <p>{bw.why}</p>
            {outcome?.kind === 'settle' && !anim && (
              <p data-testid="lab-balance-lift">{outcome.liftToWeight >= 1 ? '이 각도, 이 바람이면 뜰 수 있어요!' : '이 각도에서는 뜨는 힘이 아직 모자라요. 바람을 더 세게 해 봐요.'}</p>
            )}
            {outcome?.kind !== 'calm' && (
              <p className="lab-bal__fav" data-testid="lab-fav" data-speed={fav?.speedMps ?? ''} data-why={fav?.why ?? 'busy'}>
                {fav === null ? '좋아하는 바람을 찾는 중이에요…'
                  : fav.speedMps !== null ? <>이 비행기가 좋아하는 바람: <b className="num">{fmt1(fav.speedMps)}</b> m/s <button type="button" className="btn btn--small lab-bal__go" onClick={() => setSpeed(fav.speedMps ?? speed)} data-testid="lab-fav-go">이 바람으로 맞추기</button></>
                    : fav.why === 'heavy' ? '가장 센 바람에도 혼자서는 뜨지 못해요.' : '균형을 못 잡아서 좋아하는 바람이 없어요.'}
              </p>
            )}
          </div>
        )}

        <div className="lab-tabs" role="tablist" aria-label="실험실 서랍">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`lab-tab${tab === t.id ? ' is-on' : ''}`} onClick={() => setTab(t.id)} data-testid={`lab-tab-${t.id}`}>{t.label}</button>
          ))}
        </div>

        <div className="lab-drawer" role="tabpanel" data-testid={`lab-drawer-${tab}`}>
          {tab === 'cards' && (
            <div className="lab-cards">
              <div className="lab-cards__grid">
                {EXPERIMENTS.map((e) => {
                  const got = progress.done[e.id] !== undefined;
                  const open = activeExp === e.id;
                  return (
                    <button key={e.id} type="button" className={`lab-card${open ? ' is-open' : ''}${got ? ' is-done' : ''}`} aria-expanded={open} onClick={() => setActiveExp(open ? null : e.id)} data-testid={`lab-card-${e.id}`} data-done={got ? '1' : '0'} data-lesson={lessons[e.id] ? '1' : '0'}>
                      <span className="lab-card__seal" style={{ '--seal': `var(${e.token})` } as React.CSSProperties} aria-hidden="true">{got && <LabIcon name="check" size={20} />}</span>
                      <span className="lab-card__title">{e.title}{got && <span className="sr-only"> (해냈어요)</span>}</span>
                    </button>
                  );
                })}
              </div>
              {activeDef ? (
                <div className="lab-card__body" data-testid="lab-card-body" data-exp={activeDef.id}>
                  <p>{activeDef.goal}</p>
                  {!lessons[activeDef.id] && expHint(activeDef.id) && <p className="lab-card__hint" data-testid="lab-card-hint">{expHint(activeDef.id)}</p>}
                  {lessons[activeDef.id] && <p className="lab-card__lesson" data-testid="lab-card-lesson"><LabIcon name="check" size={18} />{lessons[activeDef.id]}</p>}
                </div>
              ) : (
                <p className="fine lab-cards__lead">카드를 하나 골라 실험해 봐요. 해내면 도장이 찍혀요.</p>
              )}
            </div>
          )}

          {tab === 'compare' && (
            <div className="lab-compare">
              <div className="lab-compare__row">
                <button type="button" className="btn btn--small" onClick={pinNow} data-testid="lab-pin"><LabIcon name="pin" size={20} />지금 값 붙여 두기</button>
                {pinned && <button type="button" className="btn btn--small btn--plain" onClick={() => setPinned(null)} data-testid="lab-unpin">떼기</button>}
              </div>
              {pinned && (
                <table className="lab-table" data-testid="lab-compare-table">
                  <thead><tr><th /><th scope="col"><LabIcon name="pin" size={16} />{pinned.name}<small>{paperShortName(pinned.paperId)}</small></th><th scope="col">지금<small>{paperShortName(cur.design.paperId)}</small></th></tr></thead>
                  <tbody>
                    <tr><th scope="row">바람</th><td className="num">{fmt1(pinned.speedMps)} m/s</td><td className="num">{fmt1(speed)} m/s</td></tr>
                    <tr><th scope="row">고개 각도</th><td className="num">{fmt1(pinned.alphaDeg)}°</td><td className="num">{fmt1(probeAlpha)}°</td></tr>
                    <tr><th scope="row">뜨는 힘</th><td className="num" data-testid="lab-cmp-lift-pinned">{gfText(pinned.liftN)} g</td><td className="num" data-testid="lab-cmp-lift-now">{liftG} g</td></tr>
                    <tr><th scope="row">막는 힘</th><td className="num">{gfText(pinned.dragN)} g</td><td className="num">{dragG} g</td></tr>
                    <tr><th scope="row">알뜰함</th><td className="num">{fmt1(pinned.liftToDrag)}</td><td className="num">{fmt1(reading.liftToDrag)}</td></tr>
                    <tr><th scope="row">날개 휨</th><td className="num" data-testid="lab-cmp-flex-pinned">{pinned.buckled ? '꺾임' : `${fmt1(pinned.flexDeg)}°`}</td><td className="num" data-testid="lab-cmp-flex-now">{reading.buckled ? '꺾임' : `${fmt1(flexMax)}°`}</td></tr>
                  </tbody>
                </table>
              )}
              {!pinned && <p className="fine">지금 값을 붙여 두면 흐린 화살표로 남아요. 그다음 종이나 비행기를 바꿔서 견줘 봐요.</p>}
              <h3 className="lab-h">다른 종이로 보기</h3>
              <div className="lab-chips" role="radiogroup" aria-label="종이">
                {PAPERS.map((p) => {
                  const on = cur.design.paperId === p.id;
                  return (
                    <button key={p.id} type="button" role="radio" aria-checked={on} className={`lab-chip${on ? ' is-on' : ''}`} onClick={() => setVariant((v) => ({ ...v, paperId: p.id }))} data-testid={`lab-paper-${p.id}`}>{paperShortName(p.id)}</button>
                  );
                })}
              </div>
              {others.length > 0 && (
                <>
                  <h3 className="lab-h">다른 비행기로 보기</h3>
                  <div className="lab-chips lab-chips--scroll" role="radiogroup" aria-label="비행기">
                    <button type="button" role="radio" aria-checked={variant.planeId === null} className={`lab-chip${variant.planeId === null ? ' is-on' : ''}`} onClick={() => setVariant({ paperId: null, planeId: null })} data-testid="lab-plane-base">{subject.name}</button>
                    {others.map((p, i) => (
                      <button key={p.id} type="button" role="radio" aria-checked={variant.planeId === p.id} className={`lab-chip${variant.planeId === p.id ? ' is-on' : ''}`} onClick={() => setVariant({ paperId: null, planeId: p.id })} data-testid={`lab-plane-${i}`}>{p.name}</button>
                    ))}
                  </div>
                </>
              )}
              {!isBase && <button type="button" className="btn btn--small" onClick={() => setVariant({ paperId: null, planeId: null })} data-testid="lab-variant-reset">원래 비행기로 돌아가기</button>}
              <p className="fine">여기서 바꿔 봐도 넣어 둔 비행기는 그대로예요.</p>
            </div>
          )}

          {tab === 'note' && (
            <div className="lab-note">
              <p>실험실에서 알아낸 것을 쪽지에 적어 <b>{subject.name}</b>의 연구 노트에 붙여요.</p>
              <button type="button" className="btn btn--primary" onClick={() => { void writeNote(); }} disabled={writing} data-testid="lab-note-write">
                <LabIcon name="pencilNote" size={22} />{writing ? '재는 중이에요…' : savedNote ? '다시 재서 적기' : '연구 노트에 적기'}
              </button>
              {savedNote && (
                <div className="lab-note__paper" data-testid="lab-note-saved" data-fav={savedNote.favSpeedMps ?? ''} data-trim={savedNote.trimAlphaDeg ?? ''} data-best={savedNote.bestAlphaDeg ?? ''} data-stall={savedNote.stallAlphaDeg ?? ''}>
                  <ul>{labNoteLines(savedNote).map((t, i) => <li key={i}>{t}</li>)}</ul>
                  {savedNote.physics !== PHYSICS_VERSION && <p className="fine">대회 규칙이 바뀌기 전에 적은 쪽지예요. 다시 재서 적어 봐요.</p>}
                  <p className="fine">{subject.hangarId !== null ? '격납고의 비행기에 붙여 두었어요.' : api.status?.kind === 'saved' ? '적어 두었어요.' : '이 브라우저에 적어 두었어요. 격납고에 넣어도 같이 따라가요.'}</p>
                </div>
              )}
              {!isBase && <p className="fine">쪽지는 원래 비행기({subject.name})를 재서 적어요.</p>}
            </div>
          )}

          {tab === 'detail' && (
            <div className="lab-detail">
              <div className="switchrow">
                <span><span className="switchrow__label">날개 조각마다의 힘</span><br /><span className="switchrow__hint">노란 선: 조각 하나하나가 받는 힘</span></span>
                <button type="button" className={`switch${detail ? ' is-on' : ''}`} role="switch" aria-checked={detail} aria-label="날개 조각마다의 힘 보기" onClick={() => setDetail((v) => !v)} data-testid="lab-detail-toggle"><span className="switch__knob" /></button>
              </div>
              <label className="lab-beta">
                <span className="lab-beta__head"><b>옆바람</b><output className="num" data-testid="lab-beta-num">{beta === 0 ? '없음' : `${beta > 0 ? '왼쪽으로' : '오른쪽으로'} ${Math.abs(beta)}°`}</output></span>
                <input type="range" min={L.betaMin} max={L.betaMax} step={1} value={beta} onChange={(e) => setBeta(snapBeta(Number(e.target.value), L))} aria-label="옆바람 각도" data-testid="lab-beta" />
              </label>
              <dl className="lab-nums" data-testid="lab-nums">
                <div><dt>뜨는 힘</dt><dd className="num">{newtonText(reading.liftN)}</dd></div>
                <div><dt>막는 힘</dt><dd className="num">{newtonText(reading.dragN)}</dd></div>
                <div><dt>옆으로 미는 힘</dt><dd className="num">{newtonText(reading.sideN)}</dd></div>
                <div><dt>날개 휨</dt><dd className="num" data-testid="lab-flex">{reading.buckled ? '꺾였어요' : `왼쪽 ${fmt1(reading.flexLeftDeg)}° · 오른쪽 ${fmt1(reading.flexRightDeg)}°`}</dd></div>
                <div><dt>바람이 떨어져 나간 날개</dt><dd className="num">{Math.round(reading.stalledFraction * 100)}%</dd></div>
              </dl>
              <SweepChart sweep={sweep} alphaDeg={probeAlpha} ratio={reading.liftToWeight} />
              <div className="lab-how" data-testid="lab-how">
                <p><b>숫자는 진짜 계산이에요.</b> 뜨는 힘과 막는 힘은 대회에서 비행기가 날 때와 똑같은 식으로 계산해요. 1 g은 1 g짜리 물건을 드는 힘이에요.</p>
                <p><b>연기 모양은 계산한 힘을 바탕으로 그린 그림이에요.</b> 공기 알갱이를 하나하나 따라간 것은 아니에요. 뜨는 힘이 클수록 날개 뒤 연기가 더 아래로 꺾이고, 바람이 떨어져 나간 날개 조각 뒤에서는 연기가 돌돌 말리고, 막는 힘이 클수록 날개 뒤가 넓게 흐트러지게 그렸어요.</p>
                <p>화면의 연기는 진짜 바람보다 훨씬 느리게 흘러요. 진짜 속도로는 눈에 보이지 않거든요.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** 고개 각도마다 뜨는 힘이 내 무게의 몇 배인지(지금 바람에서). 가로 점선이 "내 무게"다. */
function SweepChart({ sweep, alphaDeg, ratio }: { sweep: AlphaSweep | null; alphaDeg: number; ratio: number }): JSX.Element {
  const W = 300, H = 110, padL = 30, padR = 8, padT = 10, padB = 22;
  if (!sweep || sweep.points.length < 2) {
    return <p className="fine lab-chart__wait" data-testid="lab-chart-wait">바람을 켜면 고개 각도마다 뜨는 힘을 그려 줘요.</p>;
  }
  const xs = sweep.points.map((p) => p.alphaDeg);
  const x0 = xs[0]!, x1 = xs[xs.length - 1]!;
  let lo = Math.min(0, ...sweep.points.map((p) => p.liftToWeight)), hi = Math.max(1.4, ...sweep.points.map((p) => p.liftToWeight));
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const X = (a: number): number => padL + ((a - x0) / (x1 - x0)) * (W - padL - padR);
  const Y = (v: number): number => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const d = sweep.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.alphaDeg).toFixed(1)} ${Y(p.liftToWeight).toFixed(1)}`).join(' ');
  return (
    <figure className="lab-chart" data-testid="lab-chart">
      <figcaption>고개 각도마다 뜨는 힘 (바람 {fmt1(sweep.speedMps)} m/s)</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="고개 각도에 따른 뜨는 힘 그래프">
        {sweep.stallAlphaDeg !== null && <rect x={X(sweep.stallAlphaDeg)} y={padT} width={X(x1) - X(sweep.stallAlphaDeg)} height={H - padT - padB} className="lab-chart__stall" />}
        <line x1={padL} y1={Y(0)} x2={W - padR} y2={Y(0)} className="lab-chart__axis" />
        <line x1={padL} y1={Y(1)} x2={W - padR} y2={Y(1)} className="lab-chart__one" />
        <text x={padL - 4} y={Y(1) + 4} textAnchor="end" className="lab-chart__tick">내 무게</text>
        <text x={padL - 4} y={Y(0) + 4} textAnchor="end" className="lab-chart__tick">0</text>
        {[x0, 0, 20, 40, x1].map((a) => <text key={a} x={X(a)} y={H - 6} textAnchor="middle" className="lab-chart__tick">{a}°</text>)}
        {sweep.stallAlphaDeg !== null && <text x={(X(sweep.stallAlphaDeg) + X(x1)) / 2} y={padT + 12} textAnchor="middle" className="lab-chart__tick">바람이 떨어져 나가요</text>}
        <path d={d} className="lab-chart__line" />
        <circle cx={X(clamp(alphaDeg, x0, x1))} cy={Y(clamp(ratio, lo, hi))} r={5} className="lab-chart__dot" />
      </svg>
    </figure>
  );
}
