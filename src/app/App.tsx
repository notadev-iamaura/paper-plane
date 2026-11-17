/**
 * 앱의 뼈대.
 * - Root: 오류 경계. 문제가 생기면 저장된 상태를 지우고 Game 을 새로 만든다.
 * - Game: 상태(리듀서)를 들고, 지금 있는 곳(대회장, 책상, 출발선, 기록장)에 맞는 화면에 값과 함수를 나눠 준다.
 *   체육관 3D 무대는 하나만 만들어 대회장과 출발선이 함께 쓴다(카메라만 옮긴다).
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { decodeDesign, encodeDesign, PHYSICS_VERSION } from '../core/index';
import type { ThrowInput } from '../core/index';
import { DEFAULT_THROW, defaultState, designFromState, reducer, reviveSession } from './state';
import type { AppState, Screen } from './state';
import { codeFromHash } from './lib/design';
import { useEvaluation } from './lib/evaluation';
import type { Flight } from './lib/flight';
import { useDebounced } from './lib/hooks';
import { hotData, registerHotSnapshot } from './lib/hot';
import { gradeOf } from './lib/kidvoice';
import { log } from './lib/logger';
import { designOfCode } from './lib/hangar';
import { codeNote, dropStaleNotes } from './lib/lab/labStore';
import { evaluateThrowCode, MIGRATION_NOTICE, migratePhysics } from './lib/physicsMigration';
import { addRecord, loadRecords } from './lib/records';
import { runSimulation } from './lib/simRunner';
import { playSound, unlockSound } from './lib/sound';
import { addFlight, addHangarFacts, loadProgress, stickerCount } from './lib/stickers';
import { loadJson, saveJson, STORAGE_KEYS } from './lib/storage';
import type { CharacterLook } from './lib/characterLook';
import { loadLook, markNudgeSeen, nudgeWasSeen, saveLook } from './lib/characterStore';
import { DebugPanel } from './components/DebugPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HangarContext, useHangar } from './components/HangarKit';
import { RankingHost } from './components/RankingHost';
import { ShareDialog } from './components/ShareDialog';
import { TopBar } from './components/TopBar';
import { Book } from './screens/Book';
import { Desk } from './screens/Desk';
import { Hangar } from './screens/Hangar';
import { Character } from './screens/Character';
import { Home } from './screens/Home';
import { Lab } from './screens/Lab';
import type { LabSubject } from './screens/Lab';
import { Notebook } from './screens/Notebook';
import { ThrowLine } from './screens/ThrowLine';
import { GymCanvas } from './three/GymCanvas';
import type { Stage } from './three/GymStage';
import { usePaperLookVersion } from './three/paperLook';

export const APP_VERSION = '2.0.0';

const SCREENS: readonly Screen[] = ['home', 'desk', 'throw', 'book', 'hangar'];

/** 상태가 뜻하는 내 비행기 코드(접은 모양 + 던지기 값) */
function shareCodeOf(s: AppState): string {
  return encodeDesign(designFromState(s), s.throwIn);
}

interface Boot { state: AppState; notice: string }

/**
 * 코드에 담긴 던지기가 지금 규칙(LIMITS)보다 셀 때 한 번 알려 주는 말.
 * 비행기는 그대로 꺼내고, 던지기만 처음 값으로 새로 시작한다(한도 안으로 잘라 쓰면 "다른 던지기"가 되므로 쓰지 않는다).
 */
export const OLD_THROW_NOTICE = '비행기를 꺼냈어요. 예전 던지기는 지금 규칙보다 세서, 힘을 새로 정해 던져 봐요!';

/**
 * 시작 상태를 정한다.
 * 0) 게시 뷰어가 지난 판의 상태를 넘겨줬으면 그대로 이어서 시작한다.
 * 1) 주소에 코드(#p...)가 있으면 그 비행기로 시작한다.
 *    단, 지난 방문 상태가 같은 코드를 만들면 지난 상태를 그대로 쓴다(새로 고침해도 따라 접기 값이 유지된다).
 * 2) 없으면 지난 방문 상태, 그것도 없으면 기본값.
 */
function boot(fresh: boolean): Boot {
  if (fresh) return { state: defaultState(), notice: '' };
  const hot = hotData();
  if (typeof hot === 'object' && hot !== null) {
    const h = hot as { session?: unknown; screen?: unknown };
    const revived = reviveSession(h.session);
    if (revived) {
      const screen = typeof h.screen === 'string' && (SCREENS as readonly string[]).includes(h.screen) ? (h.screen as Screen) : 'home';
      return { state: { ...revived, screen }, notice: '' };
    }
  }
  const session = reviveSession(loadJson(STORAGE_KEYS.session));
  let hashCode: string | null = null;
  try {
    hashCode = codeFromHash(window.location.hash);
  } catch {
    hashCode = null;
  }
  if (hashCode !== null) {
    if (session && shareCodeOf(session) === hashCode) return { state: session, notice: '' };
    const dec = decodeDesign(hashCode);
    if (dec) {
      // 예전 규칙의 센 던지기가 담긴 주소: 비행기는 그대로 꺼내고, 던지기는 처음 값으로 새로 시작한다.
      const old = dec.throwOutOfRange !== undefined;
      if (old && session && encodeDesign(designFromState(session)) === encodeDesign(dec.design)) {
        // 내가 접던 바로 그 비행기다(지난 방문의 주소): 접던 방식(따라 접기 값)은 그대로 둔다.
        log.info('share', '주소의 던지기가 지금 규칙보다 세서 새로 시작해요', { speedMps: dec.throwOutOfRange?.speedMps });
        return { state: { ...session, throwIn: { ...DEFAULT_THROW } }, notice: OLD_THROW_NOTICE };
      }
      log.info('share', '주소의 코드로 비행기를 불러왔어요', { folds: dec.design.folds.length, oldThrow: old });
      const loaded = reducer(session ?? defaultState(), { type: 'load', design: dec.design, throwIn: old ? { ...DEFAULT_THROW } : dec.throwIn });
      return { state: { ...loaded, freePast: [], screen: 'throw' }, notice: old ? OLD_THROW_NOTICE : '주소에 담긴 비행기를 꺼냈어요. 던져 봐요!' };
    }
    log.warn('share', '주소의 코드가 올바르지 않아요');
    return { state: session ?? defaultState(), notice: '주소에 담긴 코드가 맞지 않아서 비행기를 꺼내지 못했어요.' };
  }
  return { state: session ?? defaultState(), notice: '' };
}

/** 저장하거나 넘겨줄 때는 되돌리기 목록을 뺀다. */
function slim(s: AppState): Omit<AppState, 'freePast' | 'freeFuture' | 'guidePast' | 'guideFuture'> {
  const { freePast: _a, freeFuture: _b, guidePast: _c, guideFuture: _d, ...rest } = s;
  void _a; void _b; void _c; void _d;
  return rest;
}

export function Root(): JSX.Element {
  // epoch 가 바뀌면 Game 이 완전히 새로 만들어진다(오류 뒤 초기화).
  const [epoch, setEpoch] = useState(0);
  const reset = useCallback(() => {
    saveJson(STORAGE_KEYS.session, null);
    log.warn('ui', '사용자가 처음 상태로 되돌렸어요');
    setEpoch((n) => n + 1);
  }, []);
  return (
    <ErrorBoundary onReset={reset}>
      <Game key={epoch} fresh={epoch > 0} />
    </ErrorBoundary>
  );
}

function Game({ fresh }: { fresh: boolean }): JSX.Element {
  const booted = useMemo(() => boot(fresh), [fresh]);
  const [state, dispatch] = useReducer(reducer, booted.state);
  const [stage, setStage] = useState<Stage | null>(null);
  const [lastFlight, setLastFlight] = useState<Flight | null>(null);
  const [records, setRecords] = useState(loadRecords);
  const recordsRef = useRef(records);
  const [progress, setProgress] = useState(loadProgress);
  const progressRef = useRef(progress);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(booted.notice ? { id: 0, text: booted.notice } : null);
  const [showHint, setShowHint] = useState(() => loadJson(STORAGE_KEYS.introSeen) !== true);
  const [showDebug, setShowDebug] = useState(false);
  // 내 캐릭터(꾸미기): 차림은 비행기 코드, 랭킹과 상관없는 꾸미기 값이다. 대회장 위에 겹쳐 여는 화면이라 state.ts 의 화면 목록에는 넣지 않는다.
  const [look, setLook] = useState<CharacterLook>(loadLook);
  const [showCreator, setShowCreator] = useState(false);
  const [charNudge, setCharNudge] = useState(() => !nudgeWasSeen());
  const [showNotebook, setShowNotebook] = useState(false);
  // 바람 실험실: 격납고나 책상 위에 겹쳐 여는 화면이다(화면 목록에는 넣지 않는다). 올려놓은 비행기를 같이 기억한다.
  const [lab, setLab] = useState<{ from: 'hangar' | 'desk'; subject: LabSubject } | null>(null);
  const [share, setShare] = useState<{ code: string; canRank: boolean } | null>(null);
  const [rankingToken, setRankingToken] = useState(0);
  const versionTaps = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const notify = useCallback((text: string) => setToast({ id: Date.now(), text }), []);
  const go = useCallback((screen: Screen) => dispatch({ type: 'screen', screen }), []);

  // ---- 비행기: 상태 -> 설계 -> 코드 -> (코드로 되돌린) 정리된 설계 ----
  const rawDesign = useMemo(
    () => designFromState(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.paperId, state.foldMode, state.presetId, state.presetParams, state.guideFolds, state.freeFolds, state.freeShaping, state.clip],
  );
  const designCode = useMemo(() => encodeDesign(rawDesign), [rawDesign]);
  const { design, valid } = useMemo(() => {
    // 코드로 바꿨다 되돌린 값을 쓰면 코드를 받은 친구, 랭킹 서버와 계산 결과가 정확히 같아진다.
    const dec = decodeDesign(designCode);
    return dec ? { design: dec.design, valid: true } : { design: rawDesign, valid: false };
  }, [designCode, rawDesign]);
  const shareCode = useMemo(() => encodeDesign(design, state.throwIn), [design, state.throwIn]);
  const { ev } = useEvaluation(design, designCode);
  // 종이 무늬가 다시 만들어지면(글꼴이 늦게 왔을 때 등) 비행기도 다시 입힌다.
  const lookVersion = usePaperLookVersion();

  // 체육관의 아이가 든 비행기도 같은 모양, 같은 종이다.
  useEffect(() => {
    stage?.setPlane(ev.geometry, design.paperId);
  }, [stage, ev.geometry, design.paperId, lookVersion]);

  // 고른 차림을 체육관의 아이에게 입힌다. 다른 화면으로 가면 꾸미기 화면은 닫는다.
  useEffect(() => {
    stage?.setCharacter?.(look);
  }, [stage, look]);
  useEffect(() => {
    if (state.screen !== 'home') setShowCreator(false);
    // 다른 곳으로 가면 실험실은 닫는다.
    setLab((cur) => (cur && cur.from !== state.screen ? null : cur));
  }, [state.screen]);

  // ---- 계산 규칙(물리 판)이 바뀌었으면 저장된 기록을 새 규칙으로 다시 잰다: 켜진 뒤 한가할 때 한 번 ----
  useEffect(() => {
    let alive = true;
    const pause = (): Promise<void> => new Promise((res) => { window.setTimeout(res, 0); });
    const id = window.setTimeout(() => {
      void migratePhysics({
        getStorage: () => window.localStorage,
        version: PHYSICS_VERSION,
        evaluate: evaluateThrowCode,
        pause,
        clearCaches: () => { dropStaleNotes(PHYSICS_VERSION); },
      }).then((rep) => {
        if (!rep.ran) return;
        log.info('physics', '계산 규칙이 바뀌어 기록을 다시 쟀어요', { from: rep.from, to: rep.to, records: rep.recordsChanged, dropped: rep.recordsDropped, bests: rep.bestsChanged, bestsDropped: rep.bestsDropped });
        if (!alive || !rep.notify) return;
        // 화면이 들고 있던 옛 숫자를 새로 잰 값으로 바꾼다.
        const next = loadRecords();
        recordsRef.current = next;
        setRecords(next);
        try { window.dispatchEvent(new StorageEvent('storage', { key: 'pp.hangar.v1' })); } catch { /* 격납고는 다음에 켤 때 새 값을 읽는다 */ }
        setToast({ id: Date.now(), text: MIGRATION_NOTICE });
      });
    }, 1200);
    return () => { alive = false; window.clearTimeout(id); };
  }, []);

  // ---- 기록(로그): 모양이 바뀌고 잠잠해지면 한 줄 남긴다 ----
  const settledCode = useDebounced(designCode, 500);
  useEffect(() => {
    log.info('design', '비행기 모양이 바뀌었어요', { paper: design.paperId, folds: design.folds.length, mode: state.foldMode, valid });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledCode]);

  // ---- 주소(#p코드)와 지난 방문 상태 저장 ----
  const settledShare = useDebounced(shareCode, 300);
  const shareRef = useRef(shareCode);
  shareRef.current = shareCode;
  const lastWritten = useRef<string | null>(null);

  useEffect(() => {
    lastWritten.current = settledShare;
    try {
      // replace 는 뒤로 가기 기록을 쌓지 않는다. # 뒤에는 영문자와 숫자만 들어간다.
      if (window.location.hash !== `#p${settledShare}`) window.location.replace(`#p${settledShare}`);
    } catch (err) {
      log.warn('share', '주소를 바꾸지 못했어요', err);
    }
  }, [settledShare]);

  useEffect(() => {
    const id = window.setTimeout(() => saveJson(STORAGE_KEYS.session, slim(state)), 400);
    return () => window.clearTimeout(id);
  }, [state]);

  // 게시 뷰어가 새 판으로 바꿔 끼울 때 지금 상태를 넘겨준다(뷰어 밖에서는 아무 일도 없다).
  useEffect(() => {
    registerHotSnapshot(() => ({ session: slim(stateRef.current), screen: stateRef.current.screen }));
  }, []);

  /**
   * 코드로 비행기를 꺼낸다. 잘못된 코드면 null.
   * 코드의 던지기가 지금 규칙보다 세면(oldThrow) 비행기만 꺼내고 던지기는 처음 값으로 새로 시작한다.
   */
  const loadCode = useCallback((code: string, from: string): { oldThrow: boolean } | null => {
    const dec = decodeDesign(code);
    if (!dec) {
      log.warn('share', `${from}: 코드가 올바르지 않아요`, { length: code.length });
      return null;
    }
    const oldThrow = dec.throwOutOfRange !== undefined;
    dispatch({ type: 'load', design: dec.design, throwIn: oldThrow ? { ...DEFAULT_THROW } : dec.throwIn });
    setLastFlight(null);
    log.info('share', `${from}에서 비행기를 불러왔어요`, { folds: dec.design.folds.length, hasThrow: Boolean(dec.throwIn), oldThrow });
    return { oldThrow };
  }, []);

  // ---- 격납고: 넣어 둔 비행기, 넣기/이름 바꾸기 대화상자, 알림 ----
  const awardHangar = useCallback((f: { planes: number; paperKinds: number; allPapers: number }) => {
    const st = addHangarFacts(progressRef.current, f, Date.now());
    progressRef.current = st.progress;
    setProgress(st.progress);
    return st.fresh;
  }, []);
  const clearLastFlight = useCallback(() => setLastFlight(null), []);
  const hangar = useHangar({ state, dispatch, design, designCode, valid, awardHangar, onLoaded: clearLastFlight });
  const hangarFlight = hangar.recordFlight;

  // 주소가 바깥에서 바뀌면(붙여 넣기, 뒤로 가기) 그 코드를 불러온다.
  useEffect(() => {
    const onHash = (): void => {
      const code = codeFromHash(window.location.hash);
      if (code === null) return;
      if (code === shareRef.current || code === lastWritten.current) return; // 우리가 방금 쓴 주소
      const loaded = loadCode(code, '주소');
      if (loaded) {
        notify(loaded.oldThrow ? OLD_THROW_NOTICE : '주소에 담긴 비행기를 꺼냈어요. 던져 봐요!');
        go('throw');
      } else {
        notify('주소에 담긴 코드가 맞지 않아서 비행기를 꺼내지 못했어요.');
        // 주소를 지금 비행기의 코드로 되돌려 놓는다.
        try { window.location.replace(`#p${shareRef.current}`); } catch { /* 주소를 못 바꿔도 놀이에는 지장 없음 */ }
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [loadCode, notify, go]);

  // 알림은 잠시 뒤에 스스로 사라진다.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3800);
    return () => window.clearTimeout(id);
  }, [toast]);

  // 소리: 화면을 누른 순간에만 소리 장치를 준비하고, 단추를 누르면 작게 "톡".
  useEffect(() => {
    const onDown = (): void => unlockSound();
    const onClick = (e: MouseEvent): void => {
      const t = e.target as Element | null;
      if (t && typeof t.closest === 'function' && t.closest('button, summary, [role="radio"], [role="tab"], [role="switch"]') && !t.closest('.fb')) playSound('tick');
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  // ---- 던지기: 계산하고, 기록과 스티커를 챙겨 비행 하나를 돌려준다 ----
  const onThrow = useCallback(async (t: ThrowInput): Promise<Flight | null> => {
    dispatch({ type: 'throw', patch: t });
    // 코드로 바꿨다 되돌린 값으로 계산한다(서버, 친구 화면과 숫자가 한 자리도 다르지 않게).
    const code = encodeDesign(design, t);
    const canon = decodeDesign(code);
    if (!valid || !canon || !canon.throwIn) {
      notify('이 모양으로는 던질 수 없어요. 책상에서 조금 고쳐 주세요.');
      return null;
    }
    const s = stateRef.current;
    const mode = s.mode;
    try {
      const out = await runSimulation(canon.design, canon.throwIn);
      const r = out.result;
      log.info('sim', `비행 계산 ${Math.round(out.ms)} ms (${out.via})`, {
        distanceM: Number(r.distanceM.toFixed(3)), airtimeS: Number(r.airtimeS.toFixed(3)), verdict: r.verdict, samples: r.samples.length,
      });
      const prev = recordsRef.current;
      const prevBest = mode === 'distance' ? prev.bestDistance?.distanceM : prev.bestAirtime?.airtimeS;
      const now = mode === 'distance' ? r.distanceM : r.airtimeS;
      const isBest = prevBest === undefined || now > prevBest;
      const nextRecords = addRecord(prev, { code, mode, distanceM: r.distanceM, airtimeS: r.airtimeS, verdict: r.verdict, at: Date.now() });
      recordsRef.current = nextRecords;
      setRecords(nextRecords);
      const guided = s.foldMode === 'simple' && s.presetChosen && s.guideFolds === null;
      const st = addFlight(progressRef.current, {
        distanceM: r.distanceM, airtimeS: r.airtimeS, lateralM: r.lateralM, verdict: r.verdict,
        paperId: canon.design.paperId,
        presetId: guided ? s.presetId : null,
        free: s.foldMode === 'free' && canon.design.folds.length > 0,
        hasClip: canon.design.clip !== null,
      }, Date.now());
      progressRef.current = st.progress;
      setProgress(st.progress);
      const flight: Flight = { code, designCode: encodeDesign(canon.design), mode, result: r, grade: gradeOf(mode, r), isBest, fresh: st.fresh };
      // 격납고에 넣어 둔 비행기로 날렸으면 그 비행기의 기록도 고친다.
      hangarFlight({ designCode: flight.designCode, distanceM: r.distanceM, airtimeS: r.airtimeS, throwCode: code, at: Date.now() });
      setLastFlight(flight);
      return flight;
    } catch (err) {
      log.error('sim', '비행 계산 중 오류가 났어요', err);
      notify('비행기를 날리지 못했어요. 접은 모양을 조금 바꿔서 다시 던져 봐요.');
      return null;
    }
  }, [design, valid, notify, hangarFlight]);

  const onVersionTap = (): void => {
    versionTaps.current += 1;
    if (versionTaps.current >= 5) {
      versionTaps.current = 0;
      setShowDebug((v) => !v);
    }
  };

  const closeHint = (): void => {
    setShowHint(false);
    saveJson(STORAGE_KEYS.introSeen, true);
  };

  // 기록장과 순위표에서 코드로 비행기를 꺼내는 길(둘이 같이 쓴다).
  const loadFromBook = (code: string, from: string): boolean => {
    const loaded = loadCode(code, from);
    if (loaded) {
      // 코드로 꺼낸 비행기는 격납고에 넣어 둘 수 있게 권한다(이미 들어 있으면 그냥 알려 준다).
      const dec = decodeDesign(code);
      const inHangar = dec ? hangar.ctx.data.planes.some((pl) => pl.code === encodeDesign(dec.design)) : true;
      // 예전 규칙의 센 던지기가 담긴 코드면 그 얘기를 먼저 한다(격납고 권유는 다음 기회에).
      if (loaded.oldThrow) notify(OLD_THROW_NOTICE);
      else if (inHangar || !dec || dec.design.folds.length === 0) notify('비행기를 꺼냈어요. 출발선에서 던져 봐요!');
      else hangar.offerSave('비행기를 꺼냈어요! 격납고에 넣어 둘까요?');
      go('throw');
    }
    return loaded !== null;
  };

  // ---- 바람 실험실에 비행기 올리기 ----
  const openLabDesk = (): void => {
    const st = hangar.ctx.status;
    const saved = st && st.kind === 'saved' ? st.plane : null;
    setShowNotebook(false);
    setLab({ from: 'desk', subject: { design, code: designCode, name: saved ? saved.name : '지금 접은 비행기', hangarId: saved ? saved.id : null } });
  };
  const openLabHangar = (id: string): void => {
    const p = hangar.ctx.data.planes.find((x) => x.id === id);
    const d = p ? designOfCode(p.code) : null;
    if (p && d) setLab({ from: 'hangar', subject: { design: d, code: p.code, name: p.name, hangarId: p.id } });
  };
  const deskLabNote = (hangar.ctx.status?.kind === 'saved' ? hangar.ctx.status.plane.lab : undefined) ?? codeNote(designCode);

  const screen = state.screen;
  const gymVisible = screen === 'home' || screen === 'throw';
  const creatorOpen = screen === 'home' && showCreator;
  const hasPlane = design.folds.length > 0;
  // 지금 비행기 모양으로 던진 비행만 연구 노트에 싣는다.
  const notebookResult = lastFlight && lastFlight.designCode === designCode ? lastFlight.result : null;

  return (
    <HangarContext.Provider value={hangar.ctx}>
    <div className={`app app--${screen}`} data-screen={screen}>
      <div className={`app__gym${gymVisible ? '' : ' is-hidden'}`}>
        <GymCanvas onStage={setStage} active={gymVisible && !showNotebook && !lab} />
      </div>

      <TopBar screen={screen} onHome={() => go('home')} onBook={() => go('book')} onHangar={hangar.ctx.goHangar} onLeaveHangar={hangar.ctx.leaveHangar} />

      <main className="app__main">
        {creatorOpen && (
          <Character stage={stage} look={look} onChange={(next) => { setLook(next); saveLook(next); }} onDone={() => setShowCreator(false)} />
        )}
        {screen === 'home' && !creatorOpen && (
          <Home
            stage={stage}
            mode={state.mode}
            records={records}
            stickerCount={stickerCount(progress)}
            hasPlane={hasPlane}
            showHint={showHint}
            version={APP_VERSION}
            onMode={(mode) => dispatch({ type: 'mode', mode })}
            onGoDesk={() => { closeHint(); go('desk'); }}
            onGoThrow={() => { closeHint(); go('throw'); }}
            onGoBook={() => go('book')}
            onGoHangar={hangar.ctx.goHangar}
            hangarCount={hangar.ctx.data.planes.length}
            onCloseHint={closeHint}
            onVersionTap={onVersionTap}
            onGoCharacter={() => { closeHint(); setCharNudge(false); setShowCreator(true); }}
            charNudge={charNudge && !showHint}
            onCharNudgeShown={markNudgeSeen}
          />
        )}
        {screen === 'desk' && (
          <Desk state={state} design={design} ev={ev} dispatch={dispatch} onNotebook={() => setShowNotebook(true)} onGoThrow={() => go('throw')} onLab={valid && hasPlane ? openLabDesk : undefined} />
        )}
        {screen === 'throw' && (
          <ThrowLine
            stage={stage}
            throwIn={state.throwIn}
            mode={state.mode}
            canThrow={valid}
            foldCount={design.folds.length}
            onThrowChange={(patch) => dispatch({ type: 'throw', patch })}
            onThrow={onThrow}
            onEditFold={() => { dispatch({ type: 'deskStep', step: 'fold' }); go('desk'); }}
            onBrag={(f) => setShare({ code: f.code, canRank: true })}
            onNotebook={() => setShowNotebook(true)}
          />
        )}
        {screen === 'book' && (
          <Book
            records={records}
            progress={progress}
            shareCode={shareCode}
            rankingToken={rankingToken}
            onLoadCode={loadFromBook}
            onGoHangar={hangar.ctx.goHangar}
          />
        )}
        {screen === 'hangar' && <Hangar mode={state.mode} active={!showNotebook && !lab} onGoDesk={() => go('desk')} onLab={openLabHangar} />}
      </main>

      {toast && <div className="toast" role="status" aria-live="polite" key={toast.id} data-testid="toast">{toast.text}</div>}

      {showNotebook && <Notebook design={design} ev={ev} lastResult={notebookResult} onClose={() => setShowNotebook(false)} lab={deskLabNote} onLab={screen === 'desk' && valid && hasPlane ? openLabDesk : undefined} />}
      {lab && <Lab key={`${lab.from}:${lab.subject.code}`} subject={lab.subject} from={lab.from} onClose={() => setLab(null)} />}
      {share && (
        <ShareDialog code={share.code} mode={lastFlight?.mode ?? state.mode} canRank={share.canRank} onClose={() => setShare(null)} onRanked={() => setRankingToken((n) => n + 1)} />
      )}
      <RankingHost records={records} onLoadCode={loadFromBook} screen={screen} />
      {showDebug && <DebugPanel onClose={() => setShowDebug(false)} />}
      {hangar.ui}
    </div>
    </HangarContext.Provider>
  );
}
