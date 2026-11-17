/**
 * 출발선: 각도와 힘을 따로 정한다.
 *   각도: 장면 아무 데나 위아래로 끌거나(끈 만큼만 바뀐다), 옆의 위로/아래로 단추를 누른다.
 *   힘: 던지기 단추를 꾹 누르면 힘 막대가 살살 <-> 세게를 오가고, 놓는 순간의 힘으로 던진다.
 *       톡 누르면 지난번 힘 그대로. 단추 밖으로 끌고 놓으면 취소. 막대를 직접 끌어도 된다.
 * 그리고 이 놀이의 단 한 번뿐인 큰 연출이 여기서 이어진다.
 *   놓기 -> 아이가 던짐 -> 휙 -> 따라가는 카메라와 올라가는 전광판 -> 톡 착지
 *        -> 노란 줄자가 쭉 풀리며 숫자가 올라감 -> 도장 쾅 -> (신기록이면) 리본과 색종이 조각 -> 결과 패널
 * 화면을 누르면 건너뛴다. "움직임 줄이기"가 켜져 있으면 움직임 없이 결과만 바로 보여 준다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { LIMITS } from '../../core/index';
import type { GameMode, ThrowInput } from '../../core/index';
import type { Flight } from '../lib/flight';
import { fmt } from '../lib/format';
import { EVENT_NAME, kidify, kidTip, STAMP_TEXT, structureWords, VERDICT_LINE } from '../lib/kidvoice';
import { playSound } from '../lib/sound';
import { STICKERS } from '../lib/stickers';
import { loadJson, saveJson } from '../lib/storage';
import { useStageInsets } from '../lib/useInsets';
import type { Insets, Stage } from '../three/GymStage';
import { SaveToHangar } from '../components/HangarKit';
import { RankEntry } from '../components/RankingHost';
import { Icon, Stamp } from '../components/Icons';
import { AngleStepper } from '../components/AngleStepper';
import { PowerGauge } from '../components/PowerGauge';
import type { PowerGaugeHandle } from '../components/PowerGauge';
import { angleWord, clampPitch, DRAG_DEG_PER_PX, gaugeToSpeed, pingPong, speedToGauge, SWEEP_MS, TAP_MS } from '../components/aimMath';

interface Props {
  stage: Stage | null;
  throwIn: ThrowInput;
  mode: GameMode;
  /** 접은 모양이 규칙에 맞아 던질 수 있는지 */
  canThrow: boolean;
  /** 접은 횟수(0 이면 안 접은 종이) */
  foldCount: number;
  onThrowChange: (patch: Partial<ThrowInput>) => void;
  /** 던진다. 계산이 끝나면 비행을 돌려준다(실패하면 null). */
  onThrow: (t: ThrowInput) => Promise<Flight | null>;
  onEditFold: () => void;
  onBrag: (f: Flight) => void;
  onNotebook: () => void;
}

type Phase = 'aim' | 'flying' | 'result';

/** 결과가 드러나는 순서: 0 아직, 1 점수판(숫자), 2 도장, 3 리본과 스티커, 4 패널 */
type Reveal = 0 | 1 | 2 | 3 | 4;

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** 화면 가장자리 이만큼은 휴대전화의 뒤로 가기 같은 몸짓이 시작되는 곳이라 끌기를 받지 않는다(px). */
const EDGE_GUARD = 16;
/** 이보다 적게 움직이면 끌기가 아니라 톡 누른 것으로 본다(px). */
const TAP_SLOP = 6;
/** 던지기 단추 밖으로 이만큼 벗어나야 취소로 본다(px). */
const OFF_SLOP = 14;

/** 처음 온 사람에게 알려 준 것들(이 기기에만 기억한다). */
const COACH_KEY = 'pp.aimCoach.v1';
interface CoachSeen { angle: boolean; charge: boolean; throws: number; cancelHint: number }
function loadCoach(): CoachSeen {
  const r = loadJson(COACH_KEY) as Partial<CoachSeen> | null;
  return {
    angle: r?.angle === true,
    charge: r?.charge === true,
    throws: typeof r?.throws === 'number' && Number.isFinite(r.throws) ? r.throws : 0,
    cancelHint: typeof r?.cancelHint === 'number' && Number.isFinite(r.cancelHint) ? r.cancelHint : 0,
  };
}
const coachDone = (c: CoachSeen): boolean => (c.angle && c.charge) || c.throws >= 4;

type Charging = 'no' | 'press' | 'hold' | 'off';

/**
 * 입력이 실제로 일어난 시각(ms, performance.now() 와 같은 기준).
 * 화면이 바빠서 처리가 늦어져도 "얼마나 오래 눌렀는지"를 바르게 재려고 쓴다.
 * 기준이 다른 브라우저(아주 옛 것)에서는 지금 시각으로 대신한다.
 */
function eventTime(stamp: number): number {
  const now = performance.now();
  return Number.isFinite(stamp) && stamp > 0 && stamp <= now + 50 && now - stamp < 5000 ? stamp : now;
}

export function ThrowLine(p: Props): JSX.Element {
  const { stage, throwIn, mode } = p;
  const [phase, setPhase] = useState<Phase>('aim');
  const [reveal, setReveal] = useState<Reveal>(0);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [aiming, setAiming] = useState(false);
  const [charging, setCharging] = useState<Charging>('no');
  const [powerDrag, setPowerDrag] = useState(false);
  const [coach, setCoach] = useState<CoachSeen>(loadCoach);
  const [notice, setNotice] = useState('');
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [nudge, setNudge] = useState(0);
  const [remind, setRemind] = useState(false);
  const remindTimer = useRef(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const liveDist = useRef<HTMLSpanElement>(null);
  const liveTime = useRef<HTMLSpanElement>(null);
  const bigNum = useRef<HTMLSpanElement>(null);
  const timers = useRef<number[]>([]);
  const rootRef = useRef<HTMLElement>(null);
  const gaugeRef = useRef<PowerGaugeHandle>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ id: number; y: number; pitch: number; moved: boolean } | null>(null);
  const charge = useRef<{ id: number | 'key'; t0: number; raf: number; live: boolean; off: boolean; speed: number } | null>(null);
  const noticeTimer = useRef(0);
  /** 단추의 누름/글쇠를 방금 처리한 시각(뒤따라오는 click 을 한 번 더 세지 않으려고). */
  const handledAt = useRef(0);
  const throwRef = useRef(throwIn);
  throwRef.current = throwIn;
  /** 가장 최근 각도. 단추를 꾹 누르면 화면이 다시 그려지기 전에 다음 걸음이 올 수 있어 따로 둔다. */
  const pitchLive = useRef(throwIn.pitchDeg);
  pitchLive.current = throwIn.pitchDeg;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const flightRef = useRef<Flight | null>(null);
  const tokenRef = useRef(0);
  /** 던지기 시작한 시각. 손을 뗄 때 함께 생기는 누름(click)을 건너뛰기로 잘못 읽지 않기 위해 쓴다. */
  const startedAt = useRef(0);
  /** 줄자까지 끝났는지(그 뒤의 건너뛰기는 남은 연출만 넘긴다) */
  const tapeDone = useRef(false);

  const clearTimers = (): void => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  };

  // ---- 무대 맞추기: 가려진 폭, 조준 값, 눈금 위치 ----
  const onInsets = useCallback((_: Insets) => {
    if (!stage) return;
    setAnchor(stage.projectAim(0, LIMITS.launchHeightM, 0));
  }, [stage]);
  useStageInsets(stage, sheetRef, `${phase}-${reveal >= 4}`, onInsets);

  useEffect(() => {
    if (!stage) return;
    stage.showAim();
    stage.setBoard('거리', '0.0 m');
    return () => { clearTimers(); stage.events = {}; };
  }, [stage]);

  // 아이의 팔과 비행기가 각도를 따라 움직인다. 힘 막대를 끄는 동안에는 그만큼 팔을 뒤로 당긴다.
  // (힘을 모으는 동안에는 매 화면마다 직접 알린다. 아래 beginCharge 참고)
  useEffect(() => {
    if (phase !== 'aim' || charge.current?.live) return;
    stage?.setAim(throwIn.pitchDeg, 0, powerDrag ? speedToGauge(throwIn.speedMps) : 0);
  }, [stage, phase, throwIn.pitchDeg, throwIn.speedMps, powerDrag]);

  // 조준하는 곳 위의 손가락 움직임을 브라우저나 바깥 앱의 몸짓(스크롤, 당겨서 새로 고침)으로 넘기지 않는다.
  // touch-action: none 에 더해 touchmove 를 직접 막는다(React 의 onTouchMove 는 막을 수 없게 등록된다).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const stop = (e: TouchEvent): void => {
      if (phaseRef.current !== 'aim' || !e.cancelable) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('[data-grab]')) e.preventDefault();
    };
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  }, []);

  const learn = useCallback((patch: Partial<CoachSeen>): void => {
    setCoach((c) => {
      const next = { ...c, ...patch };
      if (next.angle === c.angle && next.charge === c.charge && next.throws === c.throws && next.cancelHint === c.cancelHint) return c;
      saveJson(COACH_KEY, next);
      return next;
    });
  }, []);

  const say = useCallback((msg: string, ms = 2600): void => {
    window.clearTimeout(noticeTimer.current);
    setNotice(msg);
    noticeTimer.current = window.setTimeout(() => setNotice(''), ms);
  }, []);
  useEffect(() => () => {
    window.clearTimeout(noticeTimer.current);
    window.clearTimeout(remindTimer.current);
    if (charge.current) cancelAnimationFrame(charge.current.raf);
  }, []);

  // ---- 결과가 차례로 드러난다 ----
  const showResult = useCallback((f: Flight, skipped: boolean): void => {
    clearTimers();
    if (bigNum.current) bigNum.current.textContent = f.mode === 'distance' ? fmt(f.result.distanceM, 2) : fmt(f.result.airtimeS, 2);
    if (liveDist.current) liveDist.current.textContent = fmt(f.result.distanceM, 1);
    if (liveTime.current) liveTime.current.textContent = fmt(f.result.airtimeS, 1);
    if (skipped) {
      playSound('thunk');
      setReveal(4);
      setPhase('result');
      return;
    }
    setReveal(1);
    const later = (ms: number, fn: () => void): void => { timers.current.push(window.setTimeout(fn, ms)); };
    later(260, () => { setReveal(2); playSound('thunk'); });
    later(820, () => {
      setReveal(3);
      if (f.isBest) playSound('cheer');
      else if (f.fresh.length > 0) playSound('pop');
    });
    later(f.isBest ? 1700 : 1250, () => { setReveal(4); setPhase('result'); });
  }, []);

  const startThrow = useCallback((t: ThrowInput): void => {
    if (!p.canThrow || phase === 'flying') return;
    const token = ++tokenRef.current;
    const reduced = reducedMotion();
    clearTimers();
    setAiming(false);
    setPowerDrag(false);
    setNotice('');
    drag.current = null;
    setFlight(null);
    flightRef.current = null;
    setReveal(0);
    setPhase('flying');
    startedAt.current = performance.now();
    tapeDone.current = false;
    if (liveDist.current) liveDist.current.textContent = '0.0';
    if (liveTime.current) liveTime.current.textContent = '0.0';

    if (stage) {
      stage.events = {
        onRelease: () => playSound('whoosh'),
        onFrame: (d, time) => {
          if (liveDist.current) liveDist.current.textContent = fmt(d, 1);
          if (liveTime.current) liveTime.current.textContent = fmt(time, 1);
        },
        onLanded: () => {
          playSound('tap');
          // 오래 날리기는 착지하는 순간 시간이 정해진다.
          const f = flightRef.current;
          if (bigNum.current && f && f.mode === 'airtime') bigNum.current.textContent = fmt(f.result.airtimeS, 2);
        },
        onTapeStart: (dur) => {
          playSound('zip', dur);
          setReveal(1);
        },
        onTape: (len) => {
          const f = flightRef.current;
          if (bigNum.current && f && f.mode === 'distance') bigNum.current.textContent = fmt(len, 2);
        },
        onTapeDone: (skipped) => {
          tapeDone.current = true;
          const f = flightRef.current;
          if (f && token === tokenRef.current) showResult(f, skipped || reduced);
        },
      };
      stage.beginThrow(reduced, { speedMps: t.speedMps, pitchDeg: t.pitchDeg });
    }
    void p.onThrow(t).then((f) => {
      if (token !== tokenRef.current) return;
      if (!f) {
        // 계산하지 못했다: 조준으로 돌아간다(알림은 App 이 띄운다).
        stage?.showAim();
        setPhase('aim');
        return;
      }
      flightRef.current = f;
      setFlight(f);
      if (stage) { stage.setMood?.(f.grade); stage.setResult(f.result); }
      else showResult(f, true);
    });
  }, [p, phase, stage, showResult]);

  const skip = (): void => {
    if (phase !== 'flying' || performance.now() - startedAt.current < 450) return;
    if (tapeDone.current && flightRef.current) {
      // 줄자까지 끝난 뒤라면 남은 연출만 건너뛴다.
      showResult(flightRef.current, true);
      return;
    }
    stage?.skip();
  };

  const again = (): void => {
    clearTimers();
    tokenRef.current++;
    setFlight(null);
    flightRef.current = null;
    setReveal(0);
    setPhase('aim');
    if (liveDist.current) liveDist.current.textContent = '0.0';
    if (liveTime.current) liveTime.current.textContent = '0.0';
    stage?.showAim();
    stage?.setBoard('거리', '0.0 m');
  };

  // ---- 각도: 장면을 위아래로 끈다(끈 만큼만 바뀐다. 손가락 자리와는 상관없다) ----
  const setPitch = useCallback((deg: number): boolean => {
    const next = clampPitch(deg);
    if (next === pitchLive.current) return false;
    pitchLive.current = next;
    p.onThrowChange({ pitchDeg: next });
    return true;
  }, [p]);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (phase !== 'aim' || !p.canThrow || drag.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 장면 위의 단추(각도 단추)는 제 일을 한다.
    if (e.target instanceof Element && e.target.closest('button')) return;
    if (e.pointerType !== 'mouse') {
      const vw = window.innerWidth, vh = window.innerHeight;
      if (e.clientX < EDGE_GUARD || e.clientX > vw - EDGE_GUARD || e.clientY > vh - EDGE_GUARD) return;
    }
    drag.current = { id: e.pointerId, y: e.clientY, pitch: pitchLive.current, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 잡지 못해도 끌기는 된다 */ }
    setAiming(true);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = d.y - e.clientY; // 위로 끌면 +
    if (!d.moved && Math.abs(dy) < TAP_SLOP) return;
    d.moved = true;
    const raw = d.pitch + dy * DRAG_DEG_PER_PX;
    // 끝에 닿은 뒤에도 계속 끌었다면 기준점을 옮겨, 반대로 끌 때 바로 따라오게 한다.
    if (raw > LIMITS.pitchMax) d.y = e.clientY + (LIMITS.pitchMax - d.pitch) / DRAG_DEG_PER_PX;
    else if (raw < LIMITS.pitchMin) d.y = e.clientY + (LIMITS.pitchMin - d.pitch) / DRAG_DEG_PER_PX;
    setPitch(raw);
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setAiming(false);
    if (d.moved) learn({ angle: true });
    else {
      // 톡 누르기만 했다: 어떻게 하는지 한 번 더 알려 준다.
      setNudge((n) => n + 1);
      setRemind(true);
      window.clearTimeout(remindTimer.current);
      remindTimer.current = window.setTimeout(() => setRemind(false), 4000);
    }
  };
  const onCancel = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current && drag.current.id !== e.pointerId) return;
    drag.current = null;
    setAiming(false);
  };

  const stepPitch = useCallback((dir: 1 | -1): boolean => {
    const ok = setPitch(pitchLive.current + dir);
    if (ok) learn({ angle: true });
    return ok;
  }, [setPitch, learn]);

  // ---- 힘: 던지기 단추를 꾹 눌러 모으고, 놓아서 던진다 ----
  const endCharge = useCallback((commit: boolean, stamp = 0): void => {
    const c = charge.current;
    if (!c) return;
    charge.current = null;
    cancelAnimationFrame(c.raf);
    handledAt.current = performance.now();
    setCharging('no');
    const now = throwRef.current;
    if (commit && !c.off) {
      const held = eventTime(stamp) - c.t0;
      if (held < TAP_MS) {
        // 톡: 지난번 힘 그대로.
        // 화면이 느려 막대가 잠깐 움직여 보였더라도, 실제로 던지는 힘(지난번 힘)으로 막대를 맞춰 둔다.
        gaugeRef.current?.paint(now.speedMps);
        learn({ throws: coach.throws + 1 });
        startThrow({ ...now, pitchDeg: pitchLive.current, rollDeg: 0 });
        return;
      }
      // 꾹: 놓는 순간 막대에 보이던 힘 그대로. (화면이 한 번도 못 그려졌다면 누른 시간으로 셈한다)
      if (!c.live) c.speed = gaugeToSpeed(pingPong((held - TAP_MS) / SWEEP_MS));
      p.onThrowChange({ speedMps: c.speed });
      learn({ charge: true, throws: coach.throws + 1, cancelHint: coach.cancelHint + 1 });
      startThrow({ speedMps: c.speed, pitchDeg: pitchLive.current, rollDeg: 0 });
      return;
    }
    // 그만두기: 팔을 내리고 막대를 지난번 힘으로 돌려놓는다.
    gaugeRef.current?.paint(now.speedMps);
    stage?.setAim(pitchLive.current, 0, 0);
    if (c.live || c.off) say('던지기를 멈췄어요. 다시 꾹 눌러요!');
  }, [coach.throws, coach.cancelHint, learn, p, say, stage, startThrow]);

  const beginCharge = (id: number | 'key', stamp: number): void => {
    if (phase !== 'aim' || !p.canThrow || charge.current) return;
    const c = { id, t0: eventTime(stamp), raf: 0, live: false, off: false, speed: throwRef.current.speedMps };
    charge.current = c;
    setCharging('press');
    setNotice('');
    const frame = (): void => {
      if (charge.current !== c) return;
      const t = performance.now() - c.t0 - TAP_MS;
      if (t >= 0) {
        if (!c.live) {
          c.live = true;
          setCharging(c.off ? 'off' : 'hold');
        }
        c.speed = gaugeToSpeed(pingPong(t / SWEEP_MS));
        gaugeRef.current?.paint(c.speed);
        stage?.setAim(pitchLive.current, 0, c.off ? 0 : speedToGauge(c.speed));
      }
      c.raf = requestAnimationFrame(frame);
    };
    c.raf = requestAnimationFrame(frame);
  };

  const btnDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 잡지 못해도 된다 */ }
    beginCharge(e.pointerId, e.timeStamp);
  };
  const btnMove = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const c = charge.current;
    if (!c || c.id !== e.pointerId) return;
    const r = e.currentTarget.getBoundingClientRect();
    const off = e.clientX < r.left - OFF_SLOP || e.clientX > r.right + OFF_SLOP || e.clientY < r.top - OFF_SLOP || e.clientY > r.bottom + OFF_SLOP;
    if (off === c.off) return;
    c.off = off;
    setCharging(off ? 'off' : c.live ? 'hold' : 'press');
  };
  const btnUp = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (charge.current?.id === e.pointerId) endCharge(true, e.timeStamp);
  };
  const btnLost = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    // 바깥 앱이 손가락을 가져갔다(스크롤, 뒤로 가기 등): 던지지 않는다.
    if (charge.current?.id === e.pointerId) endCharge(false);
  };
  const btnKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'Escape') { endCharge(false); return; }
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (!e.repeat) beginCharge('key', e.timeStamp);
  };
  const btnKeyUp = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (charge.current?.id === 'key') endCharge(true, e.timeStamp);
  };
  const btnClick = (e: ReactMouseEvent<HTMLButtonElement>): void => {
    // 손가락이나 글쇠 없이 온 누름(보조 기기 등)만 여기서 던진다.
    if (charge.current || performance.now() - handledAt.current < 700) return;
    e.preventDefault();
    startThrow({ ...throwRef.current, pitchDeg: pitchLive.current, rollDeg: 0 });
  };
  // 화면이 가려지면(다른 앱으로 넘어감) 모으던 힘은 버린다.
  useEffect(() => {
    const drop = (): void => { if (document.hidden) endCharge(false); };
    document.addEventListener('visibilitychange', drop);
    return () => document.removeEventListener('visibilitychange', drop);
  }, [endCharge]);

  const busy = charging !== 'no';
  const showCoach = phase === 'aim' && !aiming && !busy && !notice && (!coachDone(coach) || remind);
  const showCancelHint = phase === 'aim' && charging === 'hold' && coach.cancelHint < 2;
  const f = flight;
  // 종이가 못 버텼거나 아슬아슬했으면 그 이야기를 한 줄 더 한다.
  const struct = f ? structureWords(f.result.structure) : null;
  const showCard = phase !== 'aim' && reveal >= 1 && f !== null;

  return (
    <section ref={rootRef} className={`throw throw--${phase}`} aria-label="출발선" data-charging={charging}>
      {/* 장면 위: 위아래로 끌어 각도를 맞추는 곳이자, 날아가는 동안에는 건너뛰기 단추 */}
      <div
        ref={sceneRef}
        className={`throw__scene${aiming ? ' is-aiming' : ''}`}
        data-testid="throw-scene"
        data-grab={phase === 'aim' ? '' : undefined}
        onContextMenu={phase === 'aim' ? (e) => e.preventDefault() : undefined}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onClick={phase === 'flying' ? skip : undefined}
      >
        <div className={`scoreboard${showCard ? ' is-away' : ''}`} aria-live="off" data-testid="scoreboard">
          <span className="scoreboard__event">{EVENT_NAME[mode]}</span>
          <span className={`scoreboard__cell${mode === 'distance' ? ' is-main' : ''}`}><span ref={liveDist} className="num">0.0</span><small>m</small></span>
          <span className={`scoreboard__cell${mode === 'airtime' ? ' is-main' : ''}`}><span ref={liveTime} className="num">0.0</span><small>초</small></span>
        </div>

        {phase === 'aim' && (
          <AimHud anchor={anchor} pitchDeg={throwIn.pitchDeg} aiming={aiming} />
        )}
        {phase === 'aim' && (
          <AngleStepper pitchDeg={throwIn.pitchDeg} min={LIMITS.pitchMin} max={LIMITS.pitchMax} disabled={!p.canThrow} onStep={stepPitch} />
        )}
        {showCoach && (
          <p key={nudge} className={`throw__coach${remind ? ' is-nudge' : ''}`} data-testid="throw-coach">
            <span className="throw__coach-hand" aria-hidden="true"><Icon name="hand" size={26} /></span>
            <span><b>위아래로 끌어서</b> 각도를 맞추고, 던지기 단추를 <b>꾹 눌렀다 놓아요</b></span>
          </p>
        )}
        {phase === 'aim' && showCancelHint && (
          <p className="throw__coach throw__coach--hint" data-testid="cancel-hint"><span>그만두려면 손가락을 <b>단추 밖으로</b> 빼서 놓아요</span></p>
        )}
        {phase === 'aim' && charging === 'off' && (
          <p className="throw__coach throw__coach--hint" data-testid="cancel-armed"><span>여기서 놓으면 <b>안 던져요</b></span></p>
        )}
        {phase === 'aim' && !busy && notice && (
          <p className="throw__coach throw__coach--hint" role="status" data-testid="throw-notice">{notice}</p>
        )}
        {phase === 'flying' && reveal < 4 && (
          <button type="button" className="throw__skip" data-testid="skip">건너뛰기<Icon name="next" size={18} /></button>
        )}

        {/* 심판이 든 점수판: 큰 숫자, 도장, 신기록 리본 */}
        <div className={`scorecard${showCard ? ' is-in' : ''}`} aria-hidden={!showCard} data-testid="scorecard">
          <span className="scorecard__label">{f ? EVENT_NAME[f.mode] : ''}</span>
          <span className="scorecard__num"><span ref={bigNum} className="num" data-testid="big-number">0.00</span><small>{(f?.mode ?? mode) === 'distance' ? 'm' : '초'}</small></span>
          {f && reveal >= 2 && (
            <span className={`scorecard__stamp scorecard__stamp--${f.grade}`} data-testid="stamp" data-grade={f.grade}><Stamp text={STAMP_TEXT[f.grade]} /></span>
          )}
          {f && f.isBest && reveal >= 3 && <span className="ribbon" data-testid="ribbon">신기록!</span>}
        </div>
        {f && f.isBest && reveal >= 3 && !reducedMotion() && <Confetti />}
      </div>

      {phase === 'aim' && (
        <div className="sheet throw__sheet" ref={sheetRef}>
          {p.foldCount === 0 && <p className="note-warn">아직 종이를 안 접었어요. 그대로 던지면 나풀나풀 떨어져요.</p>}
          {!p.canThrow && <p className="note-warn" role="alert">이 모양으로는 던질 수 없어요. 책상에서 조금 고쳐 주세요.</p>}
          <PowerGauge
            ref={gaugeRef}
            speed={throwIn.speedMps}
            min={LIMITS.throwSpeedMin}
            max={LIMITS.throwSpeedMax}
            disabled={!p.canThrow}
            charging={busy}
            onChange={(v) => p.onThrowChange({ speedMps: v })}
            onDrag={setPowerDrag}
          />
          <button
            ref={btnRef}
            type="button"
            className={`btn btn--primary btn--xl throwbtn${charging === 'hold' ? ' is-charging' : ''}${charging === 'off' ? ' is-off' : ''}`}
            disabled={!p.canThrow}
            aria-describedby="throwbtn-how"
            data-grab=""
            data-testid="throw-btn"
            onPointerDown={btnDown}
            onPointerMove={btnMove}
            onPointerUp={btnUp}
            onPointerCancel={btnLost}
            onLostPointerCapture={btnLost}
            onKeyDown={btnKeyDown}
            onKeyUp={btnKeyUp}
            onBlur={() => endCharge(false)}
            onClick={btnClick}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="throwbtn__main"><Icon name="plane" />{charging === 'off' ? '멈출까요?' : charging === 'hold' ? '놓으면 슝!' : '던지기!'}</span>
            <span className="throwbtn__sub" id="throwbtn-how">{charging === 'off' ? '단추로 돌아오면 계속 모아요' : charging === 'hold' ? '원하는 힘에서 손을 떼요' : '꾹 누르면 힘이 모여요'}</span>
          </button>
        </div>
      )}

      {phase === 'result' && f && (
        <div className="sheet result" ref={sheetRef} data-testid="result-panel">
          <div className="result__scores">
            <div className={`score${f.mode === 'distance' ? ' is-main' : ''}`}>
              <span className="score__name"><Icon name="ruler" size={20} />멀리</span>
              <span className="score__num"><b className="num" data-testid="result-distance">{fmt(f.result.distanceM, 2)}</b> m</span>
            </div>
            <div className={`score${f.mode === 'airtime' ? ' is-main' : ''}`}>
              <span className="score__name"><Icon name="clock" size={20} />오래</span>
              <span className="score__num"><b className="num" data-testid="result-airtime">{fmt(f.result.airtimeS, 2)}</b> 초</span>
            </div>
          </div>
          <p className="result__line" data-testid="result-line" data-verdict={f.result.verdict}>{VERDICT_LINE[f.result.verdict]}</p>
          {struct && (
            <p className={`result__struct result__struct--${struct.kind}`} data-testid="result-struct" data-kind={struct.kind}>
              <BentWing kind={struct.kind} />
              <span>{struct.line}</span>
            </p>
          )}
          {f.fresh.length > 0 && (
            <div className="newsticker" data-testid="new-stickers">
              <span className="newsticker__title">새 스티커!</span>
              {f.fresh.map((id) => {
                const def = STICKERS.find((s) => s.id === id);
                return def ? <span key={id} className="newsticker__one" style={{ '--sticker': `var(${def.token})` } as React.CSSProperties} data-testid={`new-sticker-${id}`}><i aria-hidden="true"><Icon name="star" size={16} /></i>{def.name}</span> : null;
              })}
            </div>
          )}
          <details className="fold">
            <summary data-testid="why-open">왜 이렇게 날았을까?</summary>
            <div className="fold__body">
              {struct && <p className={`why-struct why-struct--${struct.kind}`} data-testid="why-struct">{struct.why}</p>}
              <p data-testid="why-diagnosis">{kidify(f.result.diagnosisKo)}</p>
              {f.result.tipsKo.length > 0 && (
                <ul className="tips">
                  {f.result.tipsKo.map((t, i) => <li key={i}>{kidTip(t, struct !== null && struct.kind !== 'near')}</li>)}
                </ul>
              )}
              <button type="button" className="btn btn--small btn--note" onClick={p.onNotebook} data-testid="why-notebook"><Icon name="note" size={20} />연구 노트에서 더 보기</button>
            </div>
          </details>
          <div className="result__btns">
            <button type="button" className="btn btn--primary btn--big" onClick={again} data-testid="throw-again"><Icon name="retry" />다시 던지기</button>
            <button type="button" className="btn" onClick={p.onEditFold} data-testid="edit-fold"><Icon name="fold" size={20} />고쳐 접기</button>
            <button type="button" className="btn" onClick={() => p.onBrag(f)} data-testid="brag"><Icon name="megaphone" size={20} />자랑하기</button>
            <RankEntry flight={f} onViewed={again} />
            <SaveToHangar where="result" />
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 조준 눈금: 아이 손 옆의 각도 부채와 화살표. 끄는 동안에는 크게 강조한다.
// ---------------------------------------------------------------------------
interface AimHudProps {
  anchor: { x: number; y: number } | null;
  pitchDeg: number;
  aiming: boolean;
}

function AimHud({ anchor, pitchDeg, aiming }: AimHudProps): JSX.Element {
  const R = 74;
  const xy = (degUp: number, r: number): [number, number] => {
    const a = (degUp * Math.PI) / 180;
    return [Number((Math.cos(a) * r).toFixed(1)), Number((-Math.sin(a) * r).toFixed(1))];
  };
  const pt = (degUp: number, r: number): string => xy(degUp, r).join(',');
  const style = anchor ? { left: `${anchor.x}px`, top: `${anchor.y}px` } : undefined;
  const [nx1, ny1] = xy(pitchDeg, 26);
  const [nx2, ny2] = xy(pitchDeg, R + 16);
  const arc = `M${pt(LIMITS.pitchMin, R)} A${R},${R} 0 0 0 ${pt(LIMITS.pitchMax, R)}`;
  // 지나온 만큼(0도에서 지금 각도까지)을 색으로 채운다.
  const from = Math.min(0, pitchDeg), to = Math.max(0, pitchDeg);
  const swept = `M${pt(from, R)} A${R},${R} 0 0 0 ${pt(to, R)}`;
  const [lx, ly] = xy(Math.min(46, Math.max(-6, pitchDeg + 15)), R + 40);
  // (끄는 동안에는 부채 위에 큰 이름표로 한 번 더 적는다)
  const [ux, uy] = xy(LIMITS.pitchMax + 14, R);
  const [dx, dy] = xy(LIMITS.pitchMin - 15, R);
  return (
    <div className={`aimhud${anchor ? '' : ' aimhud--loose'}${aiming ? ' is-aiming' : ''}`} style={style} data-testid="aim-hud" data-pitch={pitchDeg}>
      <svg className="aimhud__svg" viewBox="-120 -110 300 200" width="300" height="200" aria-hidden="true">
        {/* 각도 부채: 아래 20도 ~ 위 60도 */}
        <path d={arc} className="aimhud__arc aimhud__arc--ink" />
        <path d={arc} className="aimhud__arc" />
        {to > from && <path d={swept} className="aimhud__arc aimhud__arc--swept" />}
        {[-20, 0, 20, 40, 60].map((d) => {
          const [x1, y1] = xy(d, R - 7), [x2, y2] = xy(d, R + 7);
          return <line key={d} x1={x1} y1={y1} x2={x2} y2={y2} className="aimhud__tick" />;
        })}
        {/* 위아래로 끌 수 있다는 표시 */}
        <path d="M0,-8 L8,5 H-8 Z" transform={`translate(${ux} ${uy})`} className={`aimhud__chev${pitchDeg >= LIMITS.pitchMax ? ' is-end' : ''}`} />
        <path d="M0,8 L8,-5 H-8 Z" transform={`translate(${dx} ${dy})`} className={`aimhud__chev${pitchDeg <= LIMITS.pitchMin ? ' is-end' : ''}`} />
        <line x1={nx1} y1={ny1} x2={nx2} y2={ny2} className="aimhud__needle aimhud__needle--ink" />
        <line x1={nx1} y1={ny1} x2={nx2} y2={ny2} className="aimhud__needle" />
        <g transform={`translate(${nx2},${ny2}) rotate(${-pitchDeg})`}>
          <path d="M-2,-8 L14,0 L-2,8 Z" className="aimhud__head" />
        </g>
        <text x={lx} y={ly} className="aimhud__deg">{fmt(pitchDeg, 0)}°</text>
      </svg>
      {aiming && <span className="aimhud__tag" data-testid="aim-tag">{angleWord(pitchDeg)} <b className="num">{fmt(pitchDeg, 0)}°</b></span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 종이가 못 버텼을 때의 작은 그림: 앞에서 본 비행기. 날개가 휘었거나(near) 꺾여 올라갔다(buckled, collapsed).
// ---------------------------------------------------------------------------
function BentWing({ kind }: { kind: 'collapsed' | 'buckled' | 'near' }): JSX.Element {
  const wing = kind === 'near'
    ? 'M16 20 Q9 19 3 12 M16 20 Q23 19 29 12'
    : kind === 'buckled'
      ? 'M16 20 L9 18 L6 8 M16 20 L23 18 L26 8'
      : 'M16 20 L11 18 L10 7 M16 20 L21 18 L22 7';
  return (
    <svg className="result__struct-pic" viewBox="0 0 32 28" width="34" height="30" aria-hidden="true" focusable="false">
      <path d="M16 20 L16 26" />
      <path d={wing} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 색종이 조각(신기록)
// ---------------------------------------------------------------------------
const CONFETTI = ['--red', '--yellow', '--blue', '--green', '--pink', '--orange'];

function Confetti(): JSX.Element {
  // 조각마다 자리, 늦게 떨어지는 정도, 도는 방향을 조금씩 다르게 한다(정해진 순서로).
  const bits = Array.from({ length: 26 }, (_, i) => ({
    left: (i * 37 + 11) % 100,
    delay: ((i * 53) % 60) / 100,
    dur: 1.5 + ((i * 29) % 80) / 100,
    turn: (i % 2 ? 1 : -1) * (300 + ((i * 71) % 360)),
    color: CONFETTI[i % CONFETTI.length]!,
    shape: i % 3,
  }));
  return (
    <div className="confetti" aria-hidden="true" data-testid="confetti">
      {bits.map((b, i) => (
        <i
          key={i}
          className={`confetti__bit confetti__bit--${b.shape}`}
          style={{ left: `${b.left}%`, background: `var(${b.color})`, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, '--turn': `${b.turn}deg` } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
