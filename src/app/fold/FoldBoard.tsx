/**
 * 접기 판: 종이를 손가락으로 "직접 잡아" 접는 편집기.
 *
 * 쓰는 법(한 줄 요약): 종이의 모서리나 가장자리를 누른 채 끌면 종이가 손가락을 따라 접히고, 손을 떼면 그대로 접힌다.
 *
 * 구조
 * - 계산은 모두 gesture.ts(순수 함수)와 core 가 한다. 이 파일은 포인터 입력을 받아 계산을 부르고 그림을 그릴 뿐이다.
 * - 접기 목록(folds)은 바깥(부모)이 갖고 있다. 여기서는 onFolds 로 "새 목록"을 올려 보내기만 한다.
 * - 끌고 있는 동안의 임시 상태(drag)만 이 컴포넌트가 갖는다.
 *
 * 그림 좌표는 mm, 종이 좌표는 m 이다(parts.tsx 의 X, Y 로 바꾼다).
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { LIMITS } from '../../core/types';
import type { FoldOp, Vec2 } from '../../core/types';
import { applyFolds, boundingBox, creasePattern } from '../../core/fold/fold';
import type { FoldBoardProps } from './types';
import {
  computeOutline, guideCue, hintForStatus, maxLayerCount, movedFlags, planGesture, planOps, resolveGuide,
  snapGrab, snapTarget,
} from './gesture';
import type { GesturePlan, GrabSnap, GuideCue, SnapMark, TargetSnap } from './gesture';
import { lineSnapPoints, MIN_LINE_M, planLine, snapLinePoint } from './lineMode';
import { HandCue, Icon, PaperLayers, TextureDefs, X, Y } from './parts';
import type { IconName } from './parts';
import { log } from './log';
import './fold.css';

/** 종이 둘레의 여백(mm). 종이 밖에서 모서리를 잡을 자리이기도 하다. */
const MARGIN_MM = 13;
/** 잡을 때: 손가락 굵기만큼의 반경(px) */
const GRAB_PX = 26;
/** 끌 때: 이 거리(px) 안에 맞출 대상이 있으면 착 붙는다 */
const SNAP_PX = 15;
/** 이보다 조금 움직인 것은 "끌기"가 아니라 "톡 누르기"로 본다(px) */
const TAP_PX = 7;

interface DragState {
  grab: GrabSnap;
  /** 잡은 점이 지금 가 있는 곳(맞춤 적용 후) */
  to: Vec2;
  snap: TargetSnap | null;
  plan: GesturePlan | null;
  /** 손가락의 화면 좌표(말풍선 위치용) */
  clientX: number;
  clientY: number;
}

interface LineState { p: Vec2; q: Vec2; dragging: boolean }

interface Hint { text: string; tone: 'info' | 'warn' }

export function FoldBoard(props: FoldBoardProps): JSX.Element {
  const { paper, folds, paperColor, texture, aside, guide, onSound } = props;
  const asideLayout = props.asideLayout ?? 'split';
  const flatId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  /** 책상을 나눴을 때 종이 쪽이 차지하는 비율(나눔 막대를 끌어 바꾼다) */
  const [split, setSplit] = useState(0.6);
  const boardRef = useRef<HTMLDivElement>(null);
  const splitDrag = useRef<{ id: number } | null>(null);

  // ---- 사용자가 고르는 설정 ----
  const [symmetric, setSymmetric] = useState(true);
  const [userDir, setUserDir] = useState<FoldOp['dir']>('valley');
  const [snapOn, setSnapOn] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [lineMode, setLineMode] = useState(false);
  const [creaseView, setCreaseView] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // ---- 잠깐 쓰는 상태 ----
  /** 한 번이라도 판을 만졌는지(처음 안내 손을 치우는 데 쓴다) */
  const [touched, setTouched] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [line, setLine] = useState<LineState | null>(null);
  const [lineFlip, setLineFlip] = useState(false);
  const [hint, setHint] = useState<Hint | null>(null);
  /** 숫자가 바뀔 때마다 "아니야" 흔들림을 한 번 보여 준다 */
  const [wobble, setWobble] = useState(0);
  /** 방금 접힌 겹(내려앉는 애니메이션용). len 은 그때의 접기 개수. */
  const [settle, setSettle] = useState<{ len: number; flags: boolean[]; behind: boolean } | null>(null);
  const [pxPerMm, setPxPerMm] = useState(1.3);

  const svgRef = useRef<SVGSVGElement>(null);
  const deskRef = useRef<HTMLDivElement>(null);
  /** 지금 끌고 있는 포인터. 두 번째 손가락을 무시하는 데 쓴다. */
  const active = useRef<{ id: number; startX: number; startY: number; lastX: number; lastY: number; raf: number; snapKey: string } | null>(null);

  // ---- 지금 종이 (접기 목록이 바뀔 때만 다시 계산) ----
  const sheet = useMemo(() => applyFolds(paper, folds), [paper, folds]);
  const outline = useMemo(() => computeOutline(sheet), [sheet]);
  const creases = useMemo(() => creasePattern(sheet), [sheet]);
  const thickest = useMemo(() => maxLayerCount(sheet), [sheet]);

  // ---- 길잡이 ----
  const guideOn = !!guide && guide.length > 0;
  const guideIndex = folds.length;
  const guideOp = guideOn ? guide[guideIndex] : undefined;
  const guideDone = guideOn && !guideOp;
  const dir: FoldOp['dir'] = guideOp ? guideOp.dir : userDir;
  const gestureMode = !lineMode && !creaseView && !guideDone;

  /** 손이 보여 줄 "여기를 잡고 -> 저기로". 길잡이 중이면 다음 접기, 아니면 맨 처음 한 번의 예시. */
  const cue = useMemo<GuideCue | null>(() => {
    if (guideOp) return guideCue(sheet, guideOp);
    if (!guideOn && folds.length === 0 && !touched) {
      const hw = paper.widthM / 2;
      const top = paper.heightM / 2;
      return { grab: { x: -hw, y: top }, dest: { x: 0, y: top - hw } };
    }
    return null;
  }, [guideOp, guideOn, sheet, folds.length, touched, paper]);

  // ---- 그림 범위: 원래 종이와 접힌 모양을 모두 담고 여백을 둔다 ----
  const vb = useMemo(() => {
    const bb = boundingBox(sheet);
    const hw = paper.widthM / 2;
    const hh = paper.heightM / 2;
    const minX = X(Math.min(bb.minX, -hw)) - MARGIN_MM;
    const maxX = X(Math.max(bb.maxX, hw)) + MARGIN_MM;
    const top = Y(Math.max(bb.maxY, hh)) - MARGIN_MM;
    const bottom = Y(Math.min(bb.minY, -hh)) + MARGIN_MM;
    return { x: minX, y: top, w: maxX - minX, h: bottom - top };
  }, [sheet, paper]);

  // 화면 1 mm 가 몇 픽셀인지 재 둔다(손잡이, 점선 등을 화면에서 늘 같은 크기로 그리려고).
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const measure = (): void => {
      const m = svg.getScreenCTM();
      if (!m) return;
      const s = Math.hypot(m.a, m.b);
      if (s > 0.05) setPxPerMm((prev) => (Math.abs(prev - s) > 0.005 ? s : prev));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [vb]);

  // 종이 위의 터치 이동을 "브라우저 몸짓"으로 넘기지 않는다.
  // touch-action: none 만으로도 스크롤은 막히지만, 빠르게 끌다 놓으면 크롬이 "튕기기(fling)"로 여겨
  // 바로 다음의 톡 누르기를 삼키는 일이 있다. touchmove 를 직접 막으면 그런 일이 없다.
  // (React 의 onTouchMove 는 막을 수 없는 방식으로 등록되므로 직접 등록한다.)
  const liveRef = useRef(false);
  liveRef.current = gestureMode || lineMode;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const stop = (e: TouchEvent): void => {
      if (liveRef.current && e.cancelable) e.preventDefault();
    };
    svg.addEventListener('touchmove', stop, { passive: false });
    return () => svg.removeEventListener('touchmove', stop);
  }, []);

  // 내려앉는 애니메이션이 끝나면 표시를 지운다.
  useEffect(() => {
    if (!settle) return undefined;
    const t = window.setTimeout(() => setSettle(null), 260);
    return () => window.clearTimeout(t);
  }, [settle]);

  // 판이 사라질 때 예약해 둔 그리기를 취소한다.
  useEffect(() => () => {
    if (active.current) cancelAnimationFrame(active.current.raf);
  }, []);

  // ---- 화면 좌표 -> 종이 좌표. SVG 의 현재 변환 행렬(CTM)을 쓰므로 판의 크기가 어떻든 맞는다. ----
  const toSheet = (clientX: number, clientY: number): { p: Vec2; pxPerM: number } | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!ctm) return null;
    const inv = ctm.inverse();
    const mmX = inv.a * clientX + inv.c * clientY + inv.e;
    const mmY = inv.b * clientX + inv.d * clientY + inv.f;
    const scale = Math.hypot(ctm.a, ctm.b); // px / mm
    if (!(scale > 0)) return null;
    return { p: { x: mmX / 1000, y: -mmY / 1000 }, pxPerM: scale * 1000 };
  };

  const say = (text: string, tone: Hint['tone'] = 'info'): void => setHint(text ? { text, tone } : null);

  /** "아니야" 표시: 종이가 살짝 흔들리고 소리가 난다. 아무것도 바뀌지 않는다. */
  const nope = (text: string): void => {
    setWobble((n) => n + 1);
    onSound?.('nope');
    say(text, 'warn');
  };

  /** 접기를 목록에 더한다. sound 는 길잡이에 맞았을 때 'snap', 그 밖에는 'fold'. */
  const commit = (ops: FoldOp[], sound: 'fold' | 'snap', message: string): void => {
    if (ops.length === 0) return;
    const next = [...folds, ...ops];
    setSettle({ len: next.length, flags: movedFlags(sheet, ops), behind: ops[0]!.dir === 'mountain' });
    props.onFolds(next);
    onSound?.(sound);
    say(message);
    log.info('fold', `접기 ${ops.length}개를 더했어요`, { total: next.length, dir: ops[0]!.dir, guide: guideOn });
    if (guideOn && guide && folds.length < guide.length && next.length >= guide.length) {
      log.info('fold', '따라 접기를 끝까지 했어요', { total: next.length });
      props.onGuideDone?.();
    }
  };

  // -------------------------------------------------------------------------
  // 잡아 끌기
  // -------------------------------------------------------------------------

  /** 손가락 위치에서 "지금 접으면 어떻게 되는지"를 계산한다. 포인터가 움직일 때마다(프레임당 한 번) 부른다. */
  const computeDrag = (grab: GrabSnap, clientX: number, clientY: number): DragState | null => {
    const hit = toSheet(clientX, clientY);
    if (!hit) return null;
    const radius = SNAP_PX / hit.pxPerM;
    let snap = snapTarget(outline, grab.point, hit.p, radius, snapOn);
    // 길잡이 중에는 "가져갈 곳"에 넉넉하게 붙여 준다(안내한 곳을 잡았을 때만).
    if (snapOn && cue && guideOp && Math.hypot(cue.grab.x - grab.point.x, cue.grab.y - grab.point.y) < 1e-4
      && Math.hypot(cue.dest.x - hit.p.x, cue.dest.y - hit.p.y) < radius * 1.6) {
      snap = { point: cue.dest, kind: 'vertex', label: '여기에 딱!', mark: { type: 'point', p: cue.dest } };
    }
    const plan = planGesture(sheet, grab.point, snap.point, { dir, symmetric, count: folds.length });
    return { grab, to: snap.point, snap, plan, clientX, clientY };
  };

  /** 예약된 프레임에서 불린다. 항상 "가장 최근 렌더의" 값들을 쓰도록 ref 에 담아 둔다. */
  const frame = useRef<() => void>(() => undefined);
  frame.current = () => {
    const a = active.current;
    if (!a || !drag) return;
    a.raf = 0;
    const next = computeDrag(drag.grab, a.lastX, a.lastY);
    if (!next) return;
    // 새 대상에 붙는 순간에만 "착" 소리
    const key = next.snap && next.snap.kind !== 'free' ? `${next.snap.kind}:${next.to.x.toFixed(4)},${next.snap.kind === 'vertex' || next.snap.kind === 'mirror' ? next.to.y.toFixed(4) : ''}` : '';
    if (key && key !== a.snapKey) onSound?.('snap');
    a.snapKey = key;
    setDrag(next);
  };

  const endPointer = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const a = active.current;
    if (a) cancelAnimationFrame(a.raf);
    active.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 이미 풀렸으면 그만 */ }
  };

  const onDown = (e: ReactPointerEvent<SVGSVGElement>): void => {
    // 두 번째 손가락과 마우스 오른쪽 단추는 무시한다.
    if (active.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (!touched) setTouched(true);
    if (creaseView || guideDone) return;
    const hit = toSheet(e.clientX, e.clientY);
    if (!hit) return;
    setConfirmReset(false);

    if (lineMode) {
      e.preventDefault();
      const s = snapOn ? snapLinePoint(hit.p, lineSnapPoints(outline), SNAP_PX / hit.pxPerM, null) : { point: hit.p };
      active.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, raf: 0, snapKey: '' };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 잡지 못해도 계속 */ }
      setLine({ p: s.point, q: s.point, dragging: true });
      setLineFlip(false);
      say('');
      return;
    }

    const grab = snapGrab(sheet, outline, hit.p, GRAB_PX / hit.pxPerM);
    if (!grab) return; // 종이가 없는 곳
    e.preventDefault();
    active.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, raf: 0, snapKey: '' };
    // 손가락이 그림 밖으로 나가도 계속 따라오도록 포인터를 붙잡아 둔다.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 잡지 못해도 계속 */ }
    setDrag({ grab, to: grab.point, snap: null, plan: null, clientX: e.clientX, clientY: e.clientY });
    say('');
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    a.lastX = e.clientX;
    a.lastY = e.clientY;
    if (line?.dragging) {
      const hit = toSheet(e.clientX, e.clientY);
      if (!hit) return;
      const s = snapOn ? snapLinePoint(hit.p, lineSnapPoints(outline), SNAP_PX / hit.pxPerM, line.p) : { point: hit.p };
      setLine({ p: line.p, q: s.point, dragging: true });
      return;
    }
    // 그리기는 화면 주사율에 맞춰 프레임당 한 번만 한다.
    if (!a.raf) a.raf = requestAnimationFrame(() => frame.current());
  };

  const onUp = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    const movedPx = Math.hypot(e.clientX - a.startX, e.clientY - a.startY);
    endPointer(e);

    if (line?.dragging) {
      if (Math.hypot(line.q.x - line.p.x, line.q.y - line.p.y) < MIN_LINE_M) {
        setLine(null);
        say('종이 위에서 한 점을 누른 채 다른 점까지 끌어 보세요.');
      } else {
        setLine({ ...line, dragging: false });
      }
      return;
    }
    if (!drag) return;
    // 마지막 손가락 위치로 한 번 더 계산해서(프레임을 기다리지 않고) 그 결과로 정한다.
    const last = computeDrag(drag.grab, e.clientX, e.clientY) ?? drag;
    setDrag(null);
    const plan = last.plan;

    if (movedPx < TAP_PX) { say('종이를 누른 채로 쭉 끌어 보세요.'); return; }
    if (!plan || plan.status === 'short') { nope('제자리로 돌아왔어요. 접으려면 더 멀리 끌어 보세요.'); return; }
    if (plan.status !== 'ok') { nope(plan.hint || hintForStatus(plan.status)); return; }

    if (guideOn && guide) {
      const exact = resolveGuide(plan.ops, guide, guideIndex);
      if (!exact) { nope('조금만 더 맞춰 볼까요?'); return; }
      const left = guide.length - (guideIndex + exact.length);
      commit(exact, 'snap', left > 0 ? '딱 맞았어요! 다음 접기도 해 볼까요?' : '다 접었어요! 참 잘했어요.');
      return;
    }
    commit(plan.ops, 'fold', plan.hint);
  };

  const onCancel = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    endPointer(e);
    setDrag(null);
    if (line?.dragging) setLine(null);
  };

  // -------------------------------------------------------------------------
  // 선 그어 접기(고급)
  // -------------------------------------------------------------------------
  const linePlan = useMemo(
    () => (line ? planLine(sheet, line.p, line.q, dir, lineFlip, { symmetric, count: folds.length }) : null),
    [sheet, line, dir, lineFlip, symmetric, folds.length],
  );
  const cancelLine = (): void => { setLine(null); setLineFlip(false); };
  const confirmLine = (): void => {
    if (!linePlan || linePlan.status !== 'ok') return;
    commit(linePlan.ops, 'fold', linePlan.hint);
    cancelLine();
  };

  // -------------------------------------------------------------------------
  // 단추들
  // -------------------------------------------------------------------------
  const clearTransient = (): void => { setDrag(null); cancelLine(); setConfirmReset(false); say(''); };

  const skip = (): void => {
    if (!guideOp) return;
    const plan = planOps(sheet, guideOp, { symmetric: false, count: folds.length });
    // 길잡이 값은 믿고 그대로 넣는다(접히지 않는 값이어도 순서를 맞추기 위해).
    if (plan.status !== 'ok') log.warn('fold', '길잡이 접기가 접히지 않는 값이에요', { index: guideIndex, status: plan.status });
    const left = (guide?.length ?? 0) - (guideIndex + 1);
    commit([guideOp], 'fold', left > 0 ? '이번 접기는 대신 접어 줬어요.' : '다 접었어요!');
  };

  // -------------------------------------------------------------------------
  // 그릴 것 정하기
  // -------------------------------------------------------------------------
  const livePlan = drag?.plan?.status === 'ok' ? drag.plan : line && linePlan?.status === 'ok' ? linePlan : null;
  const settling = !livePlan && settle && settle.len === folds.length && settle.flags.length === sheet.layers.length ? settle : null;
  const k = 1 / Math.max(0.2, pxPerMm); // 1픽셀 = k mm

  const title = ((): string => {
    if (creaseView) return '펼친 그림이에요';
    if (guideDone) return '다 접었어요!';
    if (guideOp && guide) return `${guideIndex + 1}번째 접기 (전체 ${guide.length}번)`;
    if (lineMode) return '종이에 선을 그어 보세요';
    if (folds.length === 0) return '종이 모서리를 잡고 끌어 보세요';
    return '잡고 끌면 또 접혀요';
  })();

  const idleHint = ((): string => {
    if (creaseView) return '파란 점선은 앞으로 접은 선, 빨간 선은 뒤로 접은 선이에요.';
    if (guideDone) return '끝까지 잘 따라 접었어요.';
    if (guideOp) return '반짝이는 점을 잡고 화살표를 따라 끌어 보세요.';
    if (lineMode) return line && !line.dragging ? '이 선으로 접을까요?' : '한 점을 누른 채 다른 점까지 끌면 접는 선이 생겨요.';
    if (folds.length === 0) return '손을 떼면 그대로 접혀요.';
    return thickest >= 6 ? `가장 두꺼운 곳은 ${thickest}겹이에요.` : '마음에 안 들면 되돌리기!';
  })();
  const linePlanWarn = line && !line.dragging && linePlan && linePlan.status !== 'ok' ? linePlan.hint : '';
  const hintText = linePlanWarn || hint?.text || idleHint;
  const hintWarn = !!linePlanWarn || (hint?.tone === 'warn');

  // 말풍선 위치: 손가락 위쪽. 위에 자리가 없으면 옆으로 비켜 준다.
  const bubble = ((): { left: number; top: number; text: string; warn: boolean } | null => {
    if (!drag || !deskRef.current) return null;
    const text = drag.plan && drag.plan.status !== 'ok' && drag.plan.status !== 'short' ? '여기는 안 접혀요' : drag.snap?.label ?? '';
    if (!text) return null;
    const r = deskRef.current.getBoundingClientRect();
    const x = drag.clientX - r.left;
    const y = drag.clientY - r.top;
    const half = 74;
    let left = x;
    let top = y - 58;
    if (top < 34) { top = y - 6; left = x < r.width / 2 ? x + half + 30 : x - half - 30; }
    left = Math.max(half + 4, Math.min(r.width - half - 4, left));
    return { left, top, text, warn: !drag.snap?.label || drag.plan?.status !== 'ok' };
  })();

  const mark: SnapMark | null = drag?.snap?.mark ?? null;
  const hw = paper.widthM / 2;
  const hh = paper.heightM / 2;
  const boardLabel = creaseView
    ? '펼친 종이의 접은 선 그림'
    : `접고 있는 종이. 지금까지 ${folds.length}번 접었어요. 모서리나 가장자리를 누른 채 끌면 접혀요.`;

  const toolbar = line && !line.dragging ? (
    <div className="fb-row" data-testid="fb-line-bar">
      <Btn icon="check" label="이 선으로 접기" primary disabled={linePlan?.status !== 'ok'} onClick={confirmLine} testId="fb-line-ok" />
      <Btn icon="both" label="반대쪽 접기" disabled={linePlan?.status !== 'ok'} onClick={() => setLineFlip((f) => !f)} testId="fb-line-flip" />
      <Btn icon="close" label="그만두기" onClick={cancelLine} testId="fb-line-cancel" />
    </div>
  ) : confirmReset ? (
    <div className="fb-row fb-row--ask" role="group" aria-label="처음부터 다시 할지 묻기" data-testid="fb-reset-ask">
      <p className="fb-ask">접은 걸 모두 펴고 처음부터 할까요?</p>
      <Btn icon="check" label="응, 처음부터" primary onClick={() => { clearTransient(); props.onReset(); say('새 종이를 꺼냈어요.'); log.info('fold', '처음부터 다시'); }} testId="fb-reset-yes" />
      <Btn icon="close" label="아니요" onClick={() => setConfirmReset(false)} testId="fb-reset-no" />
    </div>
  ) : (
    <div className="fb-row" data-testid="fb-history">
      <Btn icon="undo" label="되돌리기" disabled={!props.canUndo} onClick={() => { clearTransient(); props.onUndo(); }} testId="fb-undo" />
      <Btn icon="redo" label="다시 하기" disabled={!props.canRedo} onClick={() => { clearTransient(); props.onRedo(); }} testId="fb-redo" />
      <Btn icon="reset" label="처음부터" disabled={folds.length === 0} onClick={() => setConfirmReset(true)} testId="fb-reset" />
      {guideOp && <Btn icon="skip" label="건너뛰기" onClick={skip} testId="fb-skip" ariaLabel="이번 접기 건너뛰기(대신 접어 줘요)" />}
    </div>
  );

  return (
    <section className="fb" data-testid="fold-board" aria-label="종이 접기 판">
      <p className="fb-title" data-testid="fb-title">{title}</p>

      <div
        className={`fb-desk${aside ? ` fb-desk--${asideLayout}` : ''}`}
        ref={boardRef}
        style={aside && asideLayout === 'split' ? ({ '--fb-split': `${(split * 100).toFixed(1)}%` } as CSSProperties) : undefined}
      >
       <div className="fb-pane" ref={deskRef}>
        {/* 책상 위의 연필과 지우개(장식). 누를 수 없고 화면 낭독기에도 읽히지 않는다. */}
        <DeskProps pencil={!aside} />
        <svg
          ref={svgRef}
          className={`fb-svg${gestureMode || lineMode ? ' is-live' : ''}`}
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={boardLabel}
          data-testid="fb-svg"
          data-dragging={drag || line?.dragging ? '1' : '0'}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
          onLostPointerCapture={onCancel}
        >
          {creaseView ? (
            <g>
              <rect x={X(-hw)} y={Y(hh) + 2.2} width={X(hw) * 2} height={-Y(hh) * 2} className="fb-drop-rect" />
              <rect x={X(-hw)} y={Y(hh)} width={X(hw) * 2} height={-Y(hh) * 2} className="fb-flat" style={{ fill: texture ? texture.frontTint : paperColor }} />
              {texture && (
                <>
                  <TextureDefs id={flatId} texture={texture} widthM={paper.widthM} heightM={paper.heightM} />
                  <use href={`#${flatId}-f`} />
                  {/* 무늬 위에서도 접은 선이 잘 보이게 살짝 덮어 준다. */}
                  <rect x={X(-hw)} y={Y(hh)} width={X(hw) * 2} height={-Y(hh) * 2} className="fb-flat fb-flat--veil" />
                </>
              )}
              {creases.map((c, i) => (
                <line
                  key={i}
                  x1={X(c.a.x)} y1={Y(c.a.y)} x2={X(c.b.x)} y2={Y(c.b.y)}
                  className={`fb-crease fb-crease--${c.kind}`}
                />
              ))}
            </g>
          ) : (
            <g key={wobble} className={wobble > 0 ? 'fb-paper fb-paper--nope' : 'fb-paper'}>
              {/* 원래 종이가 있던 자리(연한 점선) */}
              <rect x={X(-hw)} y={Y(hh)} width={X(hw) * 2} height={-Y(hh) * 2} className="fb-home" />
              <PaperLayers
                sheet={livePlan ? livePlan.result : sheet}
                moved={livePlan ? livePlan.moved : settling?.flags}
                flap={livePlan ? 'live' : settling ? 'settle' : 'none'}
                behind={livePlan ? dir === 'mountain' : settling?.behind ?? false}
                paperColor={paperColor}
                texture={texture}
                edges={livePlan ? undefined : outline.edges}
              />
            </g>
          )}

          {/* 가운데 선 */}
          <line x1={0} x2={0} y1={vb.y + 2} y2={vb.y + vb.h - 2} className="fb-center" />
          <text x={0} y={vb.y + 9.5 * k} className="fb-center__label" style={{ fontSize: `${11 * k}px` }}>가운데 선</text>

          {/* 맞춤 도우미가 붙은 대상(반짝임) */}
          {mark?.type === 'center' && <line x1={0} x2={0} y1={vb.y + 2} y2={vb.y + vb.h - 2} className="fb-glow" />}
          {mark?.type === 'seg' && <line x1={X(mark.a.x)} y1={Y(mark.a.y)} x2={X(mark.b.x)} y2={Y(mark.b.y)} className="fb-glow" />}
          {mark?.type === 'point' && <circle cx={X(mark.p.x)} cy={Y(mark.p.y)} r={15 * k} className="fb-glow fb-glow--point" />}

          {/* 지금 접히는 선 */}
          {livePlan && livePlan.ops.map((op, i) => (
            <g key={i}>
              <line x1={X(op.a.x)} y1={Y(op.a.y)} x2={X(op.b.x)} y2={Y(op.b.y)} className="fb-foldline fb-foldline--under" />
              <line x1={X(op.a.x)} y1={Y(op.a.y)} x2={X(op.b.x)} y2={Y(op.b.y)} className="fb-foldline" />
            </g>
          ))}

          {/* 잡을 수 있는 모서리마다 작은 점(끌고 있지 않을 때만). 모서리가 너무 많으면 지저분하므로 생략한다. */}
          {gestureMode && !drag && !cue && outline.vertices.length <= 14 && (
            <g className="fb-corners" aria-hidden="true">
              {outline.vertices.map((v, i) => <circle key={i} cx={X(v.x)} cy={Y(v.y)} r={4 * k} />)}
            </g>
          )}

          {/* 손 모양 길잡이 */}
          {cue && gestureMode && <HandCue from={cue.grab} to={cue.dest} pxPerMm={pxPerMm} dragging={!!drag} />}

          {/* 잡은 손잡이: 처음 잡은 자리에는 작은 점, 지금 자리에는 손가락보다 큰 고리 */}
          {drag && (
            <g className="fb-grab">
              <line x1={X(drag.grab.point.x)} y1={Y(drag.grab.point.y)} x2={X(drag.to.x)} y2={Y(drag.to.y)} className="fb-grab__trail" />
              <circle cx={X(drag.grab.point.x)} cy={Y(drag.grab.point.y)} r={4.5 * k} className="fb-grab__origin" />
              <g transform={`translate(${X(drag.to.x)} ${Y(drag.to.y)})`}>
                <circle r={25 * k} className={`fb-grab__ring${drag.snap && drag.snap.kind !== 'free' ? ' is-snapped' : ''}`} />
                <circle r={5 * k} className="fb-grab__dot" />
              </g>
            </g>
          )}

          {/* 선 그어 접기: 그은 선과 양 끝 */}
          {line && (
            <g className="fb-line">
              <line x1={X(line.p.x)} y1={Y(line.p.y)} x2={X(line.q.x)} y2={Y(line.q.y)} className="fb-foldline fb-foldline--under" />
              <line x1={X(line.p.x)} y1={Y(line.p.y)} x2={X(line.q.x)} y2={Y(line.q.y)} className="fb-foldline" />
              <circle cx={X(line.p.x)} cy={Y(line.p.y)} r={6 * k} className="fb-grab__dot" />
              <circle cx={X(line.q.x)} cy={Y(line.q.y)} r={6 * k} className="fb-grab__dot" />
            </g>
          )}
        </svg>

        {bubble && (
          <div
            className={`fb-bubble${bubble.warn ? ' fb-bubble--warn' : ''}`}
            style={{ left: bubble.left, top: bubble.top }}
            data-testid="fb-bubble"
            aria-hidden="true"
          >
            {bubble.text}
          </div>
        )}

        {creaseView && (
          <button type="button" className="fb-btn fb-btn--chip fb-desk__back" onClick={() => setCreaseView(false)} data-testid="fb-crease-back">
            <Icon name="close" />접은 모습으로
          </button>
        )}
       </div>

        {aside && asideLayout === 'split' && (
          <div
            className="fb-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="종이와 비행기 사이의 나눔 막대. 끌어서 크기를 바꿔요."
            aria-valuemin={45}
            aria-valuemax={75}
            aria-valuenow={Math.round(split * 100)}
            tabIndex={0}
            data-testid="fb-divider"
            onPointerDown={(e) => {
              splitDrag.current = { id: e.pointerId };
              try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 잡지 못해도 계속 */ }
              e.preventDefault();
            }}
            onPointerMove={(e) => {
              if (!splitDrag.current || splitDrag.current.id !== e.pointerId || !boardRef.current) return;
              const r = boardRef.current.getBoundingClientRect();
              if (r.width > 0) setSplit(Math.max(0.45, Math.min(0.75, (e.clientX - r.left) / r.width)));
            }}
            onPointerUp={() => { splitDrag.current = null; }}
            onPointerCancel={() => { splitDrag.current = null; }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') { setSplit((v) => Math.max(0.45, v - 0.03)); e.preventDefault(); }
              if (e.key === 'ArrowRight') { setSplit((v) => Math.min(0.75, v + 0.03)); e.preventDefault(); }
            }}
          >
            <span className="fb-divider__grip" aria-hidden="true" />
          </div>
        )}
        {aside && <div className="fb-aside" data-testid="fb-aside">{aside}</div>}
      </div>

      <div className="fb-status">
        <p className={`fb-hint${hintWarn ? ' is-warn' : ''}`} role="status" aria-live="polite" data-testid="fb-hint">{hintText}</p>
        <span className="fb-count" data-testid="fb-count">접은 횟수 {folds.length} / {LIMITS.maxFolds}</span>
      </div>

      {props.toolbarHost ? createPortal(toolbar, props.toolbarHost) : toolbar}

      <div className="fb-row" data-testid="fb-toggles">
        <Toggle
          icon="both" label="양쪽 같이 접기" on={symmetric} onClick={() => setSymmetric((v) => !v)} testId="fb-toggle-both"
          ariaLabel="양쪽 같이 접기"
        />
        <button
          type="button"
          className={`fb-btn fb-toggle fb-toggle--dir${dir === 'mountain' ? ' is-alt' : ''}`}
          onClick={() => setUserDir((d) => (d === 'valley' ? 'mountain' : 'valley'))}
          disabled={!!guideOp}
          aria-label={`접는 방향: 지금은 ${dir === 'valley' ? '앞으로 접기' : '뒤로 접기'}. 누르면 바뀌어요.`}
          data-testid="fb-toggle-dir"
          data-dir={dir}
        >
          <Icon name={dir === 'valley' ? 'front' : 'back'} />
          <span className="fb-btn__label">{dir === 'valley' ? '앞으로 접기' : '뒤로 접기'}</span>
        </button>
        <Toggle icon="magnet" label="딱 붙이기" on={snapOn} onClick={() => setSnapOn((v) => !v)} testId="fb-toggle-snap" ariaLabel="딱 붙이기(맞춤 도우미)" />
      </div>

      {!guideOn && (
        <div className={`fb-adv${advancedOpen ? ' is-open' : ''}`}>
          <button
            type="button"
            className="fb-adv__head"
            aria-expanded={advancedOpen}
            aria-controls="fb-adv-panel"
            onClick={() => setAdvancedOpen((v) => !v)}
            data-testid="fb-adv-toggle"
          >
            <Icon name="pencil" />
            <span>선 그어 접기(고급)</span>
            <Icon name="chevron" />
          </button>
          {advancedOpen && (
            <div className="fb-adv__panel" id="fb-adv-panel">
              <p className="fb-adv__help">자로 잰 듯이 접고 싶을 때 써요. 종이에 선을 긋고, 그 선으로 접어요.</p>
              <div className="fb-row">
                <Toggle
                  icon="pencil" label="선 그어서 접기" on={lineMode} testId="fb-toggle-line" ariaLabel="선 그어서 접기"
                  onClick={() => { clearTransient(); setCreaseView(false); setLineMode((v) => !v); }}
                />
                <Toggle
                  icon="unfold" label="펼친 그림 보기" on={creaseView} testId="fb-toggle-crease" ariaLabel="펼친 그림 보기"
                  onClick={() => { clearTransient(); setCreaseView((v) => !v); }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 작은 부품
// ---------------------------------------------------------------------------

interface BtnProps {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  testId: string;
  ariaLabel?: string;
}

/** 아이콘이 위, 글자가 아래에 놓이는 단추. 높이는 48px 이상. */
function Btn(p: BtnProps): JSX.Element {
  return (
    <button
      type="button"
      className={`fb-btn${p.primary ? ' fb-btn--primary' : ''}`}
      onClick={p.onClick}
      disabled={p.disabled}
      aria-label={p.ariaLabel ?? p.label}
      data-testid={p.testId}
    >
      <Icon name={p.icon} />
      <span className="fb-btn__label">{p.label}</span>
    </button>
  );
}

interface ToggleProps {
  icon: IconName;
  label: string;
  on: boolean;
  onClick: () => void;
  testId: string;
  ariaLabel: string;
}

/** 켜고 끄는 단추. 켜지면 노란 색종이 색이 되고 귀퉁이에 체크 표시가 붙는다. */
function Toggle(p: ToggleProps): JSX.Element {
  return (
    <button
      type="button"
      className={`fb-btn fb-toggle${p.on ? ' is-on' : ''}`}
      aria-pressed={p.on}
      aria-label={p.ariaLabel}
      onClick={p.onClick}
      data-testid={p.testId}
    >
      <Icon name={p.icon} />
      <span className="fb-btn__label">{p.label}</span>
      <span className="fb-toggle__state" aria-hidden="true">{p.on ? <Icon name="check" /> : null}</span>
    </button>
  );
}

/** 책상 위 소품: 연필과 지우개. 색종이를 오려 붙인 듯한 단순한 그림. */
function DeskProps({ pencil }: { pencil: boolean }): JSX.Element {
  return (
    <div className="fb-desk__props" aria-hidden="true">
      {pencil && (
        <svg className="fb-pencil" viewBox="0 0 14 120" width="14" height="120" focusable="false">
          <path d="M2 16 7 2l5 14v92H2z" className="fb-pencil__body" />
          <path d="M2 16h10" className="fb-pencil__line" />
          <path d="M5.300 6.800 7 2l1.700 4.800z" className="fb-pencil__lead" />
          <rect x="2" y="108" width="10" height="10" rx="2" className="fb-pencil__rubber" />
        </svg>
      )}
      <svg className="fb-eraser" viewBox="0 0 34 20" width="34" height="20" focusable="false">
        <rect x="1.500" y="1.500" width="31" height="17" rx="4" className="fb-eraser__body" />
        <path d="M13 1.500v17" className="fb-eraser__band" />
      </svg>
    </div>
  );
}
