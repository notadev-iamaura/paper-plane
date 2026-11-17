/**
 * 책상: 종이 고르기 -> 접기(따라 접기 / 내 맘대로 접기) -> 날개 다듬기.
 *
 * 종이 종류가 겉모습을 정한다(신문지를 고르면 신문지 비행기). 색은 따로 고르지 않는다.
 * 접는 동안에는 "지금 접은 비행기"가 주인공이다:
 * - 좁은 화면: 종이를 넓게 쓰고, "비행기 보기"를 누르면 입체 모습을 따로 살펴본다.
 *   위쪽의 작은 미리보기는 접는 동안 한 줄짜리 띠(균형, 한 줄 예보, 연구 노트)로 줄어 종이에 자리를 내준다.
 * - 넓은 화면: 왼쪽 큰 칸에 비행기, 오른쪽에 종이를 나란히 둔다.
 * - 다 접으면(따라 접기를 끝냈거나 "다 접었어요"를 누르면) 납작한 종이가 떠올라 비행기로 펴지는 연출을 한다.
 * 맨 아래에는 "다음에 할 일" 단추 하나가 크게 놓인다.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, Dispatch, ReactNode } from 'react';
import { LIMITS, PAPERS, PRESETS } from '../../core/index';
import type { FoldOp, PlaneDesign, Shaping } from '../../core/index';
import { buildPresetDesign, getPresetParamMeta } from '../../core/presets';
import type { PresetParamMeta } from '../../core/presets';
import type { Action, AppState, DeskStep } from '../state';
import type { Evaluated } from '../lib/evaluation';
import { isShapingKey, paperMassG, paperOf, roundLen } from '../lib/design';
import type { ShapingKey } from '../lib/design';
import { cm, fmt } from '../lib/format';
import { DIFFICULTY_TEXT, foldKid, forecastOf, paperKid, TWEAK_LABEL } from '../lib/kidvoice';
import { playSound } from '../lib/sound';
import { BalanceScale } from '../components/Balance';
import { Dialog } from '../components/Dialog';
import { SaveToHangar } from '../components/HangarKit';
import { LabIcon } from '../components/LabBits';
import { Icon } from '../components/Icons';
import { Silhouette } from '../components/Silhouette';
import { Slider } from '../components/Slider';
import { FoldBoard } from '../foldBoard';
import type { FoldTexture } from '../fold/types';
import { PlanePreview } from '../three/PlanePreview';
import type { PlanePreviewHandle, PlaneView, RevealPhase } from '../three/PlanePreview';
import { getPaperLook, getPaperSwatch, usePaperLookVersion } from '../three/paperLook';
import type { PaperLook } from '../three/paperLook';
import './desk-paper.css';

interface Props {
  state: AppState;
  design: PlaneDesign;
  ev: Evaluated;
  dispatch: Dispatch<Action>;
  onNotebook: () => void;
  onGoThrow: () => void;
  /** 지금 접은 비행기를 바람 실험실에 올린다(비행기가 있을 때만 준다) */
  onLab?: () => void;
}

const STEPS: { id: DeskStep; label: string }[] = [
  { id: 'paper', label: '종이' },
  { id: 'fold', label: '접기' },
  { id: 'shape', label: '다듬기' },
];

/** 넓은 화면(종이와 비행기를 나란히 놓는 배치)인지 */
function useWide(): boolean {
  const query = '(min-width: 900px)';
  const [wide, setWide] = useState(() => { try { return window.matchMedia(query).matches; } catch { return false; } });
  useEffect(() => {
    let mq: MediaQueryList;
    try { mq = window.matchMedia(query); } catch { return undefined; }
    const on = (): void => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

/** 접기 판에 넘길 종이 무늬(2D). 종이가 바뀌거나 무늬가 다시 만들어지면 새로 만든다. */
function foldTextureOf(look: PaperLook): FoldTexture {
  return {
    front: look.frontUrl(),
    back: look.backUrl(),
    frontTint: look.tint,
    backTint: look.backTint,
    sameBothSides: look.sameBothSides,
    translucency: look.translucency,
    thickness: look.thicknessM / 0.00027,
  };
}

/** 펴지는 연출의 효과음: 종이 소리 -> 휙 -> 뿅 */
function revealSound(phase: RevealPhase): void {
  if (phase === 'start') playSound('fold');
  else if (phase === 'open') playSound('whoosh');
  else playSound('pop');
}

export function Desk({ state, design, ev, dispatch, onNotebook, onGoThrow, onLab }: Props): JSX.Element {
  const step = state.deskStep;
  const go = (s: DeskStep): void => dispatch({ type: 'deskStep', step: s });
  const foldCount = design.folds.length;
  const wide = useWide();
  const paperId = design.paperId;
  const lookVersion = usePaperLookVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const look = useMemo(() => getPaperLook(paperId), [paperId, lookVersion]);
  const texture = useMemo(() => foldTextureOf(look), [look]);
  const color = look.tint;

  const [inspect, setInspect] = useState(false);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  // 펴지는 연출: key 가 played 와 다르면 아직 보여 주지 않은 연출이 있다.
  const [reveal, setReveal] = useState({ key: 0, played: 0 });
  const startReveal = (): void => setReveal((r) => ({ key: r.key + 1, played: r.played }));
  const onReveal = (phase: RevealPhase): void => {
    revealSound(phase);
    if (phase === 'done') setReveal((r) => (r.played === r.key ? r : { key: r.key, played: r.key }));
  };
  const revealProp = reveal.key !== reveal.played ? reveal.key : 0;
  // 연출이 시작되면 비행기가 화면에 다 보이도록 책상 종이를 맨 위로 올린다.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reveal.key > 0) bodyRef.current?.scrollTo({ top: 0 });
  }, [reveal.key]);
  // 내 맘대로 접기에서 "다 접었어요"를 눌렀는지. 접기가 바뀌면 다시 접는 중으로 돌아간다.
  const [freeDone, setFreeDone] = useState(false);
  useEffect(() => { setFreeDone(false); }, [state.freeFolds, state.foldMode]);

  // 좁은 화면에서는 종이에 가로를 모두 내주고, 입체 보기는 버튼으로 열거나 다 접은 뒤에 보여 준다.
  const slim = !wide && step === 'fold';
  const folding = slim && (state.foldMode === 'simple' ? state.guideFolds !== null : !freeDone);
  const forecast = <span className="chip" data-testid="forecast">{foldCount === 0 ? '빈 종이' : forecastOf(ev.summary)}</span>;
  const noteBtn = (
    <button type="button" className="btn btn--small btn--note" onClick={onNotebook} data-testid="open-notebook">
      <Icon name="note" size={20} />연구 노트
    </button>
  );
  const inspectBtn = (
    <button type="button" className="lookbtn" onClick={() => setInspect(true)} data-testid="plane-inspect-open" aria-label="비행기를 크게 살펴보기">
      <LoupeIcon /><span className="lookbtn__label">살펴보기</span>
    </button>
  );
  /**
   * 비행기 입체 그림은 책상 화면을 통틀어 하나만 만든다(WebGL 장면을 새로 만드는 일은 느린 기기에서 꽤 걸린다).
   * 그 하나를 "지금 보여 줄 칸"(위쪽 미리보기, 접기 판 옆, 다 접은 카드, 살펴보기 창)으로 옮겨 꽂는다.
   */
  const hostRef = useRef<HTMLDivElement | null>(null);
  if (hostRef.current === null) {
    const el = document.createElement('div');
    el.className = 'planehost';
    hostRef.current = el;
  }
  const host = hostRef.current;
  const viewerRef = useRef<PlanePreviewHandle>(null);
  const closeInspect = (): void => {
    setInspect(false);
    viewerRef.current?.setView('hero');
  };
  /** 비행기를 보여 줄 칸 하나. 살펴보기 창이 열려 있는 동안에는 그림을 창에 내주고 비워 둔다. */
  const planeView = (): JSX.Element => (
    <div className="planeview">
      <PlaneSlot host={host} active={!inspect} />
      {inspectBtn}
    </div>
  );

  return (
    <section className="desk" aria-label="책상" data-step={step} data-slim={slim ? '1' : '0'}>
      {slim ? (
        <div className="desk__strip">
          <BalanceScale summary={ev.summary} color={color} />
          {folding ? <button type="button" className="btn btn--small" onClick={() => setInspect(true)} data-testid="plane-inspect-open" aria-label="비행기를 크게 살펴보기">
            <LoupeIcon />비행기 보기
          </button> : forecast}
          {noteBtn}
        </div>
      ) : (
        <div className="desk__top">
          <div className="desk__preview">
            {planeView()}
          </div>
          <div className="desk__meter">
            <BalanceScale summary={ev.summary} color={color} />
            <div className="desk__meterrow">
              {forecast}
              {noteBtn}
            </div>
          </div>
        </div>
      )}
      {folding && <div className="desk__parked" aria-hidden="true"><PlaneSlot host={host} active={!inspect} /></div>}

      <nav className="desk__steps" aria-label="책상에서 하는 일">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`steptab${step === s.id ? ' is-on' : ''}`}
            aria-current={step === s.id ? 'step' : undefined}
            onClick={() => go(s.id)}
            data-testid={`desk-tab-${s.id}`}
          >
            <span className="steptab__num">{i + 1}</span>{s.label}
          </button>
        ))}
      </nav>

      <div className="desk__body" ref={bodyRef}>
        {step === 'paper' && <PaperPick state={state} dispatch={dispatch} />}
        {step === 'fold' && (
          <FoldArea
            state={state}
            paperId={paperId}
            texture={texture}
            color={color}
            dispatch={dispatch}
            hero={wide ? null : planeView()}
            toolbarHost={slim ? toolbarHost : null}
            freeDone={freeDone}
            setFreeDone={setFreeDone}
            startReveal={startReveal}
          />
        )}
        {folding && <SaveToHangar where="desk" />}
        {step === 'shape' && <ShapeArea state={state} design={design} ev={ev} color={color} dispatch={dispatch} />}
      </div>

      <div className="desk__cta">
        {slim && <div ref={setToolbarHost} className="desk__foldtools" />}
        {/* 격납고에 넣기(접은 것이 있을 때만 보인다). 넘겨줄 값 없이 혼자 동작한다: components/HangarKit.tsx */}
        {step !== 'paper' && !folding && <SaveToHangar where="desk" />}
        {/* 다 접은 비행기는 바람 실험실에 올려 볼 수 있다: screens/Lab.tsx */}
        {onLab && foldCount > 0 && (step === 'shape' || (step === 'fold' && (state.foldMode === 'simple' ? state.guideFolds === null : freeDone))) && (
          <button type="button" className="btn btn--small desk__lab" onClick={onLab} data-testid="open-lab"><LabIcon name="fan" size={22} />바람 실험실에 넣어 보기</button>
        )}
        {step === 'paper' && (
          <button type="button" className="btn btn--primary btn--xl" onClick={() => go('fold')} data-testid="desk-next">
            이 종이로 접기<Icon name="next" />
          </button>
        )}
        {step === 'fold' && (
          <button type="button" className="btn btn--primary btn--xl" onClick={() => go('shape')} data-testid="desk-next">
            날개 다듬으러 가기<Icon name="next" />
          </button>
        )}
        {step === 'shape' && (
          <button type="button" className="btn btn--primary btn--xl" onClick={onGoThrow} data-testid="desk-next">
            <Icon name="plane" />던지러 가기
          </button>
        )}
      </div>

      {inspect && (
        <Inspector
          ev={ev}
          color={color}
          forecast={foldCount === 0 ? '빈 종이' : forecastOf(ev.summary)}
          stage={<PlaneSlot host={host} active />}
          onView={(v) => viewerRef.current?.setView(v)}
          onClose={closeInspect}
        />
      )}
      {createPortal(
        <PlanePreview
          ref={viewerRef}
          geometry={ev.geometry}
          paperId={paperId}
          zoom={inspect}
          reveal={revealProp}
          onReveal={onReveal}
          label={inspect ? '크게 본 비행기. 끌어서 돌리고, 두 손가락으로 벌려 가까이 볼 수 있어요.' : undefined}
        />,
        host,
      )}
    </section>
  );
}

/**
 * 비행기 입체 그림을 꽂는 칸. active 인 칸이 그림(host)을 자기 안으로 옮겨 온다.
 * 그림은 하나뿐이므로 한 번에 한 칸만 active 여야 한다.
 */
function PlaneSlot({ host, active }: { host: HTMLElement; active: boolean }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (active && el && host.parentNode !== el) el.appendChild(host);
  }, [host, active]);
  return <div className="planeview__stage" ref={ref} />;
}

/** 돋보기 그림(살펴보기 단추) */
function LoupeIcon(): JSX.Element {
  return (
    <svg className="lookbtn__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5.5 5.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 살펴보기: 비행기를 크게, 여러 방향에서
// ---------------------------------------------------------------------------
const VIEWS: { id: PlaneView; label: string }[] = [
  { id: 'hero', label: '빙글빙글' },
  { id: 'top', label: '위에서' },
  { id: 'side', label: '옆에서' },
  { id: 'front', label: '앞에서' },
];

function Inspector({ ev, color, forecast, stage, onView, onClose }: {
  ev: Evaluated; color: string; forecast: string; stage: JSX.Element; onView: (v: PlaneView) => void; onClose: () => void;
}): JSX.Element {
  const [view, setView] = useState<PlaneView>('hero');
  return (
    <Dialog title="살펴보기" onClose={onClose} testId="plane-inspect">
      <div className="inspect">
        <div className="inspect__stage">{stage}</div>
        <div className="inspect__views" role="group" aria-label="보는 방향">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`viewbtn${view === v.id ? ' is-on' : ''}`}
              aria-pressed={view === v.id}
              onClick={() => { setView(v.id); onView(v.id); }}
              data-testid={`view-${v.id}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="inspect__hint">끌면 돌아가요. 두 손가락을 벌리면 가까이 볼 수 있어요.</p>
        <div className="inspect__meter">
          <BalanceScale summary={ev.summary} color={color} />
          <span className="chip" data-testid="inspect-forecast">{forecast}</span>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 1) 종이 고르기
// ---------------------------------------------------------------------------
function Dots({ level, label, ends }: { level: number; label: string; ends: [string, string] }): JSX.Element {
  return (
    <span className="dots" role="img" aria-label={`${label} ${level}단계 (1은 ${ends[0]}, 6은 ${ends[1]})`}>
      <span className="dots__end">{ends[0]}</span>
      {[1, 2, 3, 4, 5, 6].map((n) => <i key={n} className={n <= level ? 'is-on' : ''} />)}
      <span className="dots__end">{ends[1]}</span>
    </span>
  );
}

/**
 * 종이 한 장의 작은 그림: 실제 무늬로 그린 종이에 귀퉁이를 접어 뒷면을 보여 준다.
 * 두꺼운 종이는 아래에 도톰한 옆면이, 얇은 종이는 밑에 깔린 줄이 살짝 비쳐 보인다.
 */
function PaperSwatch({ paperId }: { paperId: string }): JSX.Element {
  const version = usePaperLookVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const look = useMemo(() => getPaperSwatch(paperId), [paperId, version]);
  const id = `sw-${paperId}`;
  const W = 60, H = 84.86, ear = 17;
  // 도톰함: 겹 간격 값을 그림 단위로 옮긴다(0.18 mm -> 0.9, 0.56 mm -> 4.2)
  const depth = Math.max(0.9, Math.min(4.4, (look.thicknessM - 0.00018) * 8700 + 0.9));
  const sheet = `0,0 ${W - ear},0 ${W},${ear} ${W},${H} 0,${H}`;
  const thin = look.translucency > 0.5;
  return (
    <svg className="paperswatch" viewBox={`-3 -3 ${W + 9} ${H + 11}`} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={`${id}-c`}><polygon points={sheet} /></clipPath>
        <clipPath id={`${id}-e`}><polygon points={`${W - ear},0 ${W},${ear} ${W - ear},${ear}`} /></clipPath>
      </defs>
      {/* 도톰한 옆면과 그림자 */}
      <polygon points={sheet} transform={`translate(${(depth * 0.55 + 1.2).toFixed(2)} ${(depth + 2).toFixed(2)})`} className="paperswatch__drop" />
      <polygon points={sheet} transform={`translate(${(depth * 0.55).toFixed(2)} ${depth.toFixed(2)})`} style={{ fill: look.edgeColor }} className="paperswatch__side" />
      <polygon points={sheet} style={{ fill: look.tint }} />
      {thin && (
        <g clipPath={`url(#${id}-c)`} className="paperswatch__under">
          {/* 얇은 종이 밑에 깔린 공책 줄이 비친다 */}
          {[14, 26, 38, 50, 62, 74].map((y) => <path key={y} d={`M-2 ${y}H${W + 2}`} />)}
        </g>
      )}
      <image href={look.frontUrl()} x="0" y="0" width={W} height={H} preserveAspectRatio="none" clipPath={`url(#${id}-c)`} opacity={thin ? 0.82 : 1} />
      {/* 접은 귀퉁이: 뒷면이 보인다 */}
      <g clipPath={`url(#${id}-e)`}>
        <rect x={W - ear} y="0" width={ear} height={ear} style={{ fill: look.backTint }} />
        <image href={look.backUrl()} x={W - ear - 20} y={-6} width={W} height={H} preserveAspectRatio="none" />
        <rect x={W - ear} y="0" width={ear} height={ear} className="paperswatch__earshade" />
      </g>
      <polygon points={sheet} className="paperswatch__line" />
      <path d={`M${W - ear} 0V${ear}H${W}`} className="paperswatch__line" />
    </svg>
  );
}

function PaperPick({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }): JSX.Element {
  return (
    <div className="stack">
      <h2 className="h-tape"><span className="tape tape--blue">종이 고르기</span></h2>
      <p className="lead">종이를 누르면 비행기가 그 종이로 바뀌어요.</p>
      <div className="papers" role="radiogroup" aria-label="종이 종류">
        {PAPERS.map((p, i) => {
          const kid = paperKid(p);
          const on = state.paperId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`papercard papercard--pic${on ? ' is-on' : ''}`}
              onClick={() => { if (!on) playSound('fold'); dispatch({ type: 'paper', paperId: p.id }); }}
              data-testid={`paper-${p.id}`}
            >
              <span className="papercard__pic" style={{ '--tilt': `${((i * 37) % 7) - 3}deg` } as CSSProperties}><PaperSwatch paperId={p.id} /></span>
              <span className="papercard__text">
                <span className="papercard__name">{p.nameKo}{on && <span className="papercard__pick"><Icon name="check" size={18} />골랐어요</span>}</span>
                <span className="papercard__line">{kid.line}</span>
                <span className="papercard__scales">
                  <Dots level={kid.weight} label="무게" ends={['가벼워요', '무거워요']} />
                  <Dots level={kid.stiff} label="빳빳함" ends={['흐물흐물', '빳빳해요']} />
                </span>
                <span className="papercard__fine">{p.gsm} g/m² · 한 장 {fmt(paperMassG(p), 1)} g</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2) 접기
// ---------------------------------------------------------------------------
const onFoldSound = (name: 'fold' | 'snap' | 'nope'): void => playSound(name);

interface FoldAreaProps {
  state: AppState;
  paperId: string;
  texture: FoldTexture;
  color: string;
  dispatch: Dispatch<Action>;
  toolbarHost: HTMLElement | null;
  /** 다 접은 뒤 크게 보여 줄 비행기 보기(좁은 화면). 넓은 화면이면 null */
  hero: JSX.Element | null;
  freeDone: boolean;
  setFreeDone: (v: boolean) => void;
  startReveal: () => void;
}

function FoldArea(p: FoldAreaProps): JSX.Element {
  const { state, texture, color, dispatch } = p;
  const paper = paperOf(state.paperId);
  const simple = state.foldMode === 'simple';
  return (
    <div className="stack">
      <div className={`modepick${!simple || state.presetChosen ? ' modepick--compact' : ''}`} role="tablist" aria-label="접는 방법">
        <button type="button" role="tab" aria-selected={simple} className={`modepick__opt${simple ? ' is-on' : ''}`} onClick={() => dispatch({ type: 'foldMode', mode: 'simple' })} data-testid="mode-guide">
          <Icon name="hand" size={28} />
          <span><strong>따라 접기</strong><small>하나씩 알려 줘요</small></span>
        </button>
        <button type="button" role="tab" aria-selected={!simple} className={`modepick__opt${!simple ? ' is-on' : ''}`} onClick={() => dispatch({ type: 'foldMode', mode: 'free' })} data-testid="mode-free">
          <Icon name="scissors" size={28} />
          <span><strong>내 맘대로 접기</strong><small>나만의 비행기</small></span>
        </button>
      </div>

      {simple ? <GuidedFold {...p} /> : p.freeDone ? (
        <DoneCard
          hero={p.hero}
          paperId={p.paperId}
          thumbId={`free-${state.paperId}-${JSON.stringify(state.freeFolds)}`}
          design={{ v: 1, paperId: paper.id, folds: state.freeFolds, shaping: state.freeShaping, clip: null }}
          name="나만의 비행기"
          line="세상에 하나뿐인 비행기예요."
          testId="free-done-card"
        >
          <div className="btnrow btnrow--one">
            <button type="button" className="btn" onClick={() => p.setFreeDone(false)} data-testid="free-more"><Icon name="fold" size={20} />더 접기</button>
          </div>
        </DoneCard>
      ) : (
        <>
          <FoldBoard
            paper={paper}
            folds={state.freeFolds}
            onFolds={(next) => dispatch({ type: 'freeSet', folds: next })}
            canUndo={state.freePast.length > 0}
            canRedo={state.freeFuture.length > 0}
            onUndo={() => dispatch({ type: 'freeUndo' })}
            onRedo={() => dispatch({ type: 'freeRedo' })}
            onReset={() => dispatch({ type: 'freeSet', folds: [] })}
            paperColor={color}
            texture={texture}
            toolbarHost={p.toolbarHost}
            onSound={onFoldSound}
          />
          <button
            type="button"
            className="btn btn--done"
            disabled={state.freeFolds.length === 0}
            onClick={() => { p.setFreeDone(true); p.startReveal(); }}
            data-testid="free-done"
          >
            <Icon name="check" size={22} />다 접었어요
          </button>
          {state.presetChosen && state.guideFolds === null && (
            <button type="button" className="btn btn--plain" onClick={() => dispatch({ type: 'convertToFree' })} data-testid="copy-to-free">
              따라 접은 비행기를 가져와서 고치기
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** 다 접었을 때의 카드: 좁은 화면에서는 큰 입체 비행기(펴지는 연출), 넓은 화면에서는 작은 그림과 글. */
function DoneCard({ hero, paperId, thumbId, design, name, line, testId, children }: {
  hero: JSX.Element | null; paperId: string; thumbId: string; design: PlaneDesign; name: string; line: string; testId: string; children?: ReactNode;
}): JSX.Element {
  return (
    <div className="stack">
      <div className={`donecard${hero ? ' donecard--hero' : ''}`} data-testid={testId}>
        {hero
          ? <div className="donecard__stage">{hero}</div>
          : <span className="donecard__pic"><Silhouette id={thumbId} design={design} paperId={paperId} /></span>}
        <div className="donecard__text">
          <span className="tape tape--yellow">{name}</span>
          <strong>다 접었어요!</strong>
          <span>{line}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

function GuidedFold({ state, paperId, texture, color, dispatch, hero, toolbarHost, startReveal }: FoldAreaProps): JSX.Element {
  const paper = paperOf(state.paperId);
  const preset = PRESETS.find((p) => p.id === state.presetId) ?? PRESETS[0]!;
  const kid = foldKid(preset.id, preset.nameKo);
  // 길잡이는 지금 고른 종이와 조절값으로 만든 접는 순서다.
  const guide: FoldOp[] = useMemo(
    () => buildPresetDesign(state.presetId, state.presetParams, state.paperId).folds,
    [state.presetId, state.presetParams, state.paperId],
  );

  // (가) 접는 법 고르기
  if (!state.presetChosen) {
    return (
      <div className="stack">
        <p className="lead">어떤 비행기를 접을까요? 하나를 골라 봐요.</p>
        <div className="foldcards">
          {PRESETS.map((p, i) => {
            const k = foldKid(p.id, p.nameKo);
            return (
              <button key={p.id} type="button" className="foldcard" style={{ '--tilt': `${(i % 2 ? 1 : -1) * 0.8}deg` } as CSSProperties} onClick={() => dispatch({ type: 'presetPick', presetId: p.id })} data-testid={`fold-${p.id}`}>
                <span className="foldcard__pic"><Silhouette id={`card-${p.id}`} design={p.design} paperId={paperId} /></span>
                <span className="foldcard__name">{k.name}</span>
                <span className="foldcard__line">{k.line}</span>
                <span className={`foldcard__level foldcard__level--${p.difficulty}`}>{DIFFICULTY_TEXT[p.difficulty]}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // (나) 한 단계씩 따라 접는 중
  if (state.guideFolds !== null) {
    return (
      <div className="stack">
        <div className="guidehead">
          <span className="tape tape--yellow" data-testid="guide-name">{kid.name}</span>
          <span className="guidehead__count" data-testid="guide-progress">{Math.min(state.guideFolds.length, guide.length)} / {guide.length}</span>
          <button type="button" className="btn btn--small" onClick={() => dispatch({ type: 'presetUnpick' })} data-testid="guide-other">다른 비행기</button>
        </div>
        <FoldBoard
          paper={paper}
          folds={state.guideFolds}
          onFolds={(next) => dispatch({ type: 'guideSet', folds: next })}
          canUndo={state.guidePast.length > 0}
          canRedo={state.guideFuture.length > 0}
          onUndo={() => dispatch({ type: 'guideUndo' })}
          onRedo={() => dispatch({ type: 'guideRedo' })}
          onReset={() => dispatch({ type: 'guideReset' })}
          paperColor={color}
          texture={texture}
          toolbarHost={toolbarHost}
          guide={guide}
          onGuideDone={() => { startReveal(); dispatch({ type: 'guideDone' }); }}
          onSound={onFoldSound}
        />
        <button type="button" className="btn btn--plain" onClick={() => { startReveal(); dispatch({ type: 'presetInstant' }); }} data-testid="guide-instant">
          <Icon name="bolt" size={20} />한 번에 접기
        </button>
      </div>
    );
  }

  // (다) 다 접었다
  const tweaks = getPresetParamMeta(state.presetId).filter((m) => !isShapingKey(m.key));
  return (
    <DoneCard
      hero={hero}
      paperId={paperId}
      thumbId={`done-${state.presetId}-${state.paperId}-${JSON.stringify(state.presetParams)}`}
      design={buildPresetDesign(state.presetId, state.presetParams, state.paperId)}
      name={kid.name}
      line={kid.line}
      testId="guide-done"
    >
      {tweaks.length > 0 && (
        <details className="fold">
          <summary data-testid="tweak-open">조금 바꾸기</summary>
          <div className="fold__body stack">
            {tweaks.map((m) => <TweakSlider key={m.key} meta={m} value={state.presetParams[m.key] ?? m.default} onChange={(v) => dispatch({ type: 'presetParam', key: m.key, value: v })} />)}
            <button type="button" className="btn btn--small" onClick={() => dispatch({ type: 'presetReset' })}>처음 값으로</button>
          </div>
        </details>
      )}
      <div className="btnrow">
        <button type="button" className="btn" onClick={() => dispatch({ type: 'guideReset' })} data-testid="guide-again"><Icon name="retry" size={20} />다시 접기</button>
        <button type="button" className="btn" onClick={() => dispatch({ type: 'presetUnpick' })} data-testid="guide-other">다른 비행기</button>
      </div>
    </DoneCard>
  );
}

function TweakSlider({ meta, value, onChange }: { meta: PresetParamMeta; value: number; onChange: (v: number) => void }): JSX.Element {
  const t = TWEAK_LABEL[meta.key] ?? { label: meta.labelKo, hint: '' };
  const format = (v: number): string => (meta.unit === 'm' ? `${cm(v)} cm` : meta.unit === 'deg' ? `${fmt(v, 0)}°` : `${fmt(v, 0)}번`);
  return <Slider label={t.label} hint={t.hint} value={value} min={meta.min} max={meta.max} step={meta.step} format={format} onChange={onChange} testId={`tweak-${meta.key}`} />;
}

// ---------------------------------------------------------------------------
// 3) 날개 다듬기
// ---------------------------------------------------------------------------
interface Range { min: number; max: number; step: number }

const FREE_RANGES: Record<ShapingKey, Range> = {
  keelM: { min: 0, max: 0.05, step: 0.001 },
  dihedralDeg: { min: LIMITS.dihedralMin, max: LIMITS.dihedralMax, step: 1 },
  wingletM: { min: 0, max: 0.04, step: 0.001 },
  wingletDeg: { min: LIMITS.wingletDegMin, max: LIMITS.wingletDegMax, step: 5 },
  elevatorDeg: { min: LIMITS.elevatorMin, max: LIMITS.elevatorMax, step: 0.5 },
};

const deg = (v: number): string => `${fmt(v, Number.isInteger(v) ? 0 : 1)}°`;
const cmText = (v: number): string => `${cm(v)} cm`;

function ShapeArea({ state, design, ev, color, dispatch }: { state: AppState; design: PlaneDesign; ev: Evaluated; /** 종이의 대표 색 */ color: string; dispatch: Dispatch<Action> }): JSX.Element {
  const simple = state.foldMode === 'simple';
  const ranges = useMemo(() => {
    if (!simple) return FREE_RANGES;
    const out = { ...FREE_RANGES };
    for (const m of getPresetParamMeta(state.presetId)) if (isShapingKey(m.key)) out[m.key] = { min: m.min, max: m.max, step: m.step };
    return out;
  }, [simple, state.presetId]);
  // 조절 막대에 놓인 값. 실제로 적용된 값(design.shaping)은 접힌 폭 때문에 조금 줄어들 수 있다.
  const values: Shaping = simple
    ? {
      keelM: state.presetParams.keelM ?? design.shaping.keelM,
      dihedralDeg: state.presetParams.dihedralDeg ?? design.shaping.dihedralDeg,
      wingletM: state.presetParams.wingletM ?? design.shaping.wingletM,
      wingletDeg: state.presetParams.wingletDeg ?? design.shaping.wingletDeg,
      elevatorDeg: state.presetParams.elevatorDeg ?? design.shaping.elevatorDeg,
    }
    : state.freeShaping;
  const applied = design.shaping;
  const set = (key: ShapingKey) => (v: number): void => dispatch({ type: 'shaping', key, value: v });
  const lengthM = ev.geometry.stats.lengthM;
  const lenCm = Math.max(1, Math.floor(lengthM * 100));
  const clipCm = state.clip ? Math.min(lenCm, Math.max(0, -state.clip.xBodyM * 100)) : 0;
  const halfSpan = Math.max(0.03, ev.geometry.stats.spanM / 2);

  return (
    <div className="stack">
      <div className="shapecard">
        <h2 className="h-tape"><span className="tape tape--yellow">앞에서 본 모습</span></h2>
        <FrontView shaping={applied} halfSpanM={halfSpan} color={color} />
        <Slider label="날개 들기" hint="날개를 V자로 들면 좌우로 덜 흔들려요." value={values.dihedralDeg} {...ranges.dihedralDeg} format={deg} ends={['납작하게', '번쩍']} onChange={set('dihedralDeg')} testId="sh-dihedralDeg" />
        <Slider label="몸통 깊이" hint="손으로 잡는 곳이에요. 얕게 접으면 날개가 넓어져요." value={values.keelM} {...ranges.keelM} format={cmText} ends={['얕게', '깊게']} onChange={set('keelM')} testId="sh-keelM" />
        <Slider label="날개 끝 세우기" hint="끝을 세우면 옆으로 미끄러지지 않고 똑바로 가요." value={values.wingletM} {...ranges.wingletM} format={(v) => (v <= 0 ? '안 세움' : cmText(v))} ends={['안 세움', '넓게']} onChange={set('wingletM')} testId="sh-wingletM" />
        {applied.wingletM > 0 && (
          <Slider label="세우는 방향" hint="오른쪽으로 밀면 위로, 왼쪽으로 밀면 아래로 세워요." value={values.wingletDeg} {...ranges.wingletDeg} format={deg} ends={['아래로', '위로']} onChange={set('wingletDeg')} testId="sh-wingletDeg" />
        )}
      </div>

      <div className="shapecard">
        <h2 className="h-tape"><span className="tape tape--blue">옆에서 본 모습</span></h2>
        <SideView shaping={applied} lengthM={lengthM} clip={state.clip} color={color} />
        <Slider label="꼬리 올리기" hint="날개 뒤쪽 끝을 올리면 코가 들려요. 내리면 코가 숙여져요." value={values.elevatorDeg} {...ranges.elevatorDeg} format={deg} ends={['내리기', '올리기']} onChange={set('elevatorDeg')} testId="sh-elevatorDeg" />
        <div className="switchrow">
          <div>
            <div className="switchrow__label">클립 끼우기</div>
            <div className="switchrow__hint">앞쪽에 끼우면 앞이 무거워져요. (클립 {fmt(LIMITS.clipMassKg * 1000, 1)} g)</div>
          </div>
          <button
            type="button"
            className={`switch${state.clip ? ' is-on' : ''}`}
            role="switch"
            aria-checked={state.clip !== null}
            aria-label="클립 끼우기"
            data-testid="clip-toggle"
            onClick={() => dispatch({ type: 'clip', clip: state.clip ? null : { xBodyM: roundLen(-Math.min(0.03, lengthM)) } })}
          >
            <span className="switch__knob" />
          </button>
        </div>
        {state.clip && (
          <Slider label="클립 자리" hint="코끝에서 얼마나 뒤에 끼울지 정해요." value={clipCm} min={0} max={lenCm} step={0.5} format={(v) => `코에서 ${fmt(v, 1)} cm`} ends={['코 쪽', '꼬리 쪽']} onChange={(v) => dispatch({ type: 'clip', clip: { xBodyM: roundLen(-v / 100) } })} testId="clip-pos" />
        )}
      </div>
    </div>
  );
}

/** 앞에서 본 단면: 가운데 몸통, 양쪽으로 든 날개, 세운 날개 끝. */
function FrontView({ shaping, halfSpanM, color }: { shaping: Shaping; halfSpanM: number; color: string }): JSX.Element {
  const S = 1000; // m -> 그림 단위(mm)
  const d = (shaping.dihedralDeg * Math.PI) / 180;
  const wing = Math.max(18, halfSpanM * S - shaping.wingletM * S * 0.3);
  const tipX = wing * Math.cos(d), tipY = -wing * Math.sin(d);
  const wa = d + (shaping.wingletDeg * Math.PI) / 180;
  const wl = shaping.wingletM * S;
  const endX = tipX + wl * Math.cos(wa), endY = tipY - wl * Math.sin(wa);
  const keel = shaping.keelM * S;
  const path = `M${-endX.toFixed(1)},${endY.toFixed(1)} L${-tipX.toFixed(1)},${tipY.toFixed(1)} L0,0 L${tipX.toFixed(1)},${tipY.toFixed(1)} L${endX.toFixed(1)},${endY.toFixed(1)}`;
  const arcR = 34;
  return (
    <svg className="shapeview" viewBox="-120 -78 240 136" role="img" aria-label={`앞에서 본 비행기. 날개를 ${fmt(shaping.dihedralDeg, 0)}도 들었어요.`}>
      <path d="M-112,0H112" className="shapeview__guide" />
      <path d={`M0,0 V${keel.toFixed(1)}`} className="shapeview__ink" />
      <path d={`M0,0 V${keel.toFixed(1)}`} className="shapeview__paper" style={{ stroke: color }} />
      <path d={path} className="shapeview__ink" />
      <path d={path} className="shapeview__paper" style={{ stroke: color }} />
      {Math.abs(shaping.dihedralDeg) >= 2 && (
        <path d={`M${arcR},0 A${arcR},${arcR} 0 0 ${shaping.dihedralDeg > 0 ? 0 : 1} ${(arcR * Math.cos(d)).toFixed(1)},${(-arcR * Math.sin(d)).toFixed(1)}`} className="shapeview__arc" />
      )}
      <text x={arcR + 8} y={shaping.dihedralDeg >= 0 ? 14 : -8} className="shapeview__label">{fmt(shaping.dihedralDeg, 0)}°</text>
      <text x={-6} y={Math.max(16, keel / 2 + 4)} textAnchor="end" className="shapeview__label">몸통</text>
      <text x={-tipX * 0.55} y={tipY * 0.55 - 10} textAnchor="middle" className="shapeview__label">날개</text>
    </svg>
  );
}

/** 옆에서 본 모습: 코는 왼쪽. 날개 뒤쪽 끝(전체의 15%)이 올라가고, 클립이 끼워진 자리가 보인다. */
function SideView({ shaping, lengthM, clip, color }: { shaping: Shaping; lengthM: number; clip: { xBodyM: number } | null; color: string }): JSX.Element {
  const L = 200;
  const x0 = -L / 2;
  const hinge = x0 + L * 0.85;
  const e = (shaping.elevatorDeg * Math.PI) / 180;
  // 꺾인 정도가 잘 보이도록 그림에서는 각도를 두 배로 과장한다.
  const fx = hinge + L * 0.15 * Math.cos(e * 2), fy = -L * 0.15 * Math.sin(e * 2);
  const keel = Math.min(26, Math.max(4, shaping.keelM * 700));
  const clipX = clip ? x0 + Math.min(1, Math.max(0, -clip.xBodyM / Math.max(lengthM, 1e-6))) * L : 0;
  return (
    <svg className="shapeview" viewBox="-120 -50 240 96" role="img" aria-label={`옆에서 본 비행기. 꼬리를 ${fmt(shaping.elevatorDeg, 1)}도 올렸어요.${clip ? ' 클립을 끼웠어요.' : ''}`}>
      <path d={`M${x0},0 L${hinge - 20},${keel} L${hinge},${keel * 0.6} L${hinge},0 Z`} className="shapeview__body" style={{ fill: color }} />
      <path d={`M${x0},0 H${hinge} L${fx.toFixed(1)},${fy.toFixed(1)}`} className="shapeview__ink" />
      <path d={`M${x0},0 H${hinge} L${fx.toFixed(1)},${fy.toFixed(1)}`} className="shapeview__paper" style={{ stroke: color }} />
      <path d={`M${hinge},0 H${x0 + L}`} className="shapeview__guide" />
      <text x={x0} y={-12} className="shapeview__label">코</text>
      <text x={x0 + L} y={fy < -8 ? 18 : -12} textAnchor="end" className="shapeview__label">꼬리 {fmt(shaping.elevatorDeg, 1)}°</text>
      {clip && (
        <g transform={`translate(${clipX.toFixed(1)} 0)`} className="shapeview__clip">
          <path d="M-5,-9 V10 a5,5 0 0 0 10,0 V-6 a3,3 0 0 0 -6,0 V7" />
        </g>
      )}
    </svg>
  );
}
