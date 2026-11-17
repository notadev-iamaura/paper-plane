/**
 * 바람 실험실의 작은 부품들: 직접 그린 그림(선풍기, 압정, 도장 등), 용수철 저울 바늘판, 별, 꾹 누르는 각도 단추.
 * 색은 tokens.css 의 값만 쓴다(.icon 규칙은 Icons.tsx 와 같다).
 */
import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

export type LabIconName = 'fan' | 'pin' | 'check' | 'scale' | 'flask' | 'paper' | 'more' | 'pencilNote';

const P: Record<LabIconName, ReactNode> = {
  fan: (<>
    <circle cx="12" cy="12" r="9.500" className="fill-paper" /><path d="M12 12c-1-4 .5-7 3-7 1.500 2.500.5 5.500-3 7zM12 12c4-1 7 .5 7 3-2.500 1.500-5.500.5-7-3zM12 12c1 4-.5 7-3 7-1.500-2.500-.5-5.500 3-7zM12 12c-4 1-7-.5-7-3 2.500-1.500 5.500-.5 7 3z" className="fill-yellow" /><circle cx="12" cy="12" r="1.600" />
  </>),
  pin: (<>
    <path d="M9 3.500h6l-1 5 3 3.500H7l3-3.500z" className="fill-yellow" /><path d="M12 12v8.500" />
  </>),
  check: <path d="m5 12.500 4.500 4.500L19 7.500" />,
  scale: (<>
    <path d="M12 3v3M6 20.500h12" /><path d="M8 6h8v9a4 4 0 0 1-8 0z" className="fill-paper" /><path d="M10 10h4M10 13h4" />
  </>),
  flask: (<>
    <path d="M9.500 3.500h5M10.500 3.500v5.500L5.500 18a1.800 1.800 0 0 0 1.600 2.500h9.800a1.800 1.800 0 0 0 1.600-2.500L13.500 9V3.500" className="fill-paper" /><path d="M7.500 15.500h9" />
  </>),
  paper: (<>
    <path d="M6 3.500h8.500L18 7v13.500H6z" className="fill-paper" /><path d="M14.500 3.500V7H18M9 11.500h6M9 15h6" />
  </>),
  more: (<>
    <circle cx="6" cy="12" r="1.300" /><circle cx="12" cy="12" r="1.300" /><circle cx="18" cy="12" r="1.300" />
  </>),
  pencilNote: (<>
    <path d="M5 4h10v6M5 4v16h8" className="fill-paper" /><path d="m13 19.500 1-3.500 5.500-5.500 2.500 2.500-5.500 5.500z" className="fill-yellow" /><path d="M8 8.500h5M8 12h3" />
  </>),
};

export function LabIcon({ name, size = 24 }: { name: LabIconName; size?: number }): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      {P[name]}
    </svg>
  );
}

const STAR = 'm12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.700l5.9-.8z';

/** 알뜰함 별 다섯 개(뜨는 힘 ÷ 막는 힘) */
export function Stars({ count }: { count: number }): JSX.Element {
  return (
    <span className="lab-stars" role="img" aria-label={`별 ${count}개`} data-testid="lab-stars" data-stars={count}>
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} className={`icon lab-star${i < count ? ' is-on' : ''}`} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d={STAR} /></svg>
      ))}
    </span>
  );
}

/**
 * 용수철 저울 바늘판: 뜨는 힘이 내 무게의 몇 배인지. 가운데 꼭대기 눈금이 "내 무게"이고, 그 오른쪽 초록 띠에 들어가면 뜬다.
 * ratio: 뜨는 힘 ÷ 무게 (0 ~ 2 를 반원에 편다. 음수는 왼쪽 끝에 붙는다)
 */
export function LiftDial({ ratio, on }: { ratio: number; on: boolean }): JSX.Element {
  const r = Math.max(0, Math.min(2, Number.isFinite(ratio) ? ratio : 0));
  const deg = -90 + r * 90;
  return (
    <svg className={`lab-dial${on && ratio >= 1 ? ' is-ok' : ''}`} viewBox="0 0 120 74" aria-hidden="true" data-testid="lab-dial" data-deg={deg.toFixed(1)}>
      <path d="M10 64 A50 50 0 0 1 110 64 Z" className="lab-dial__face" />
      <path d="M60 14 A50 50 0 0 1 110 64 L96 64 A36 36 0 0 0 60 28 Z" className="lab-dial__ok" />
      <path d="M10 64 A50 50 0 0 1 110 64" className="lab-dial__rim" />
      <path d="M60 14v12" className="lab-dial__tick" />
      <path d="M24.600 28.600l6 6M95.400 28.600l-6 6" className="lab-dial__tick lab-dial__tick--minor" />
      <g style={{ transform: `rotate(${deg}deg)`, transformOrigin: '60px 64px' }} className="lab-dial__needle">
        <path d="M60 64 L57 60 L60 20 L63 60 Z" />
      </g>
      <circle cx="60" cy="64" r="5" className="lab-dial__hub" />
    </svg>
  );
}

const FIRST_DELAY = 380;
const START_EVERY = 130;
const FASTEST = 45;

/** 한 번 누르면 한 칸, 꾹 누르면 점점 빨리(AngleStepper 와 같은 손맛). onStep 이 false 를 돌려주면 멈춘다. */
export function HoldButton({ dir, label, atEnd, onStep, testId, ariaLabel }: { dir: 1 | -1; label: string; atEnd: boolean; onStep: (dir: 1 | -1) => boolean; testId: string; ariaLabel: string }): JSX.Element {
  const timer = useRef(0);
  const stepRef = useRef(onStep);
  stepRef.current = onStep;
  const stop = (): void => {
    window.clearTimeout(timer.current);
    timer.current = 0;
  };
  useEffect(() => stop, []);
  const down = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 잡지 못해도 된다 */ }
    stop();
    if (!stepRef.current(dir)) return;
    let every = START_EVERY;
    const tick = (): void => {
      if (!stepRef.current(dir)) { stop(); return; }
      every = Math.max(FASTEST, every * 0.88);
      timer.current = window.setTimeout(tick, every);
    };
    timer.current = window.setTimeout(tick, FIRST_DELAY);
  };
  return (
    <button
      type="button"
      className={`lab-step__btn${atEnd ? ' is-end' : ''}`}
      aria-label={ariaLabel}
      aria-disabled={atEnd || undefined}
      data-grab=""
      data-testid={testId}
      onPointerDown={down}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => { if (e.detail === 0) stepRef.current(dir); }}
    >
      <svg className="lab-step__arrow" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d={dir > 0 ? 'M12 4 L21 15 H15.500 V20 H8.500 V15 H3 Z' : 'M12 20 L21 9 H15.500 V4 H8.500 V9 H3 Z'} />
      </svg>
      <span>{label}</span>
    </button>
  );
}
