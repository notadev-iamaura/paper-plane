/**
 * 각도 단추: 위로 / 아래로. 한 번 누르면 1도, 꾹 누르면 점점 빨리 바뀐다.
 * 가운데에는 지금 각도를 아이 말과 숫자로 크게 적는다.
 */
import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { angleWord } from './aimMath';

interface Props {
  pitchDeg: number;
  min: number;
  max: number;
  disabled?: boolean;
  /** dir: +1 위로, -1 아래로. 더 갈 수 없으면 false 를 돌려준다. */
  onStep: (dir: 1 | -1) => boolean;
}

const FIRST_DELAY = 380;
const START_EVERY = 130;
const FASTEST = 45;

function Arrow({ up }: { up: boolean }): JSX.Element {
  return (
    <svg className="anglestep__arrow" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path d={up ? 'M12 4 L21 15 H15.500 V20 H8.500 V15 H3 Z' : 'M12 20 L21 9 H15.500 V4 H8.500 V9 H3 Z'} />
    </svg>
  );
}

function HoldButton({ dir, label, atEnd, disabled, onStep, testId }: { dir: 1 | -1; label: string; atEnd: boolean; disabled?: boolean; onStep: (dir: 1 | -1) => boolean; testId: string }): JSX.Element {
  const timer = useRef(0);
  const stepRef = useRef(onStep);
  stepRef.current = onStep;
  const stop = (): void => {
    window.clearTimeout(timer.current);
    timer.current = 0;
  };
  useEffect(() => stop, []);

  const down = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
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
      className={`anglestep__btn anglestep__btn--${dir > 0 ? 'up' : 'down'}${atEnd ? ' is-end' : ''}`}
      aria-label={dir > 0 ? '각도 위로 올리기' : '각도 아래로 내리기'}
      aria-disabled={atEnd || disabled || undefined}
      disabled={disabled}
      data-grab=""
      data-testid={testId}
      onPointerDown={down}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()}
      // 글쇠(스페이스, 엔터)나 보조 기기로 누른 경우: 손가락 누름은 위에서 이미 처리했다.
      onClick={(e) => { if (e.detail === 0 && !disabled) stepRef.current(dir); }}
    >
      {dir > 0 && <Arrow up />}
      <span>{label}</span>
      {dir < 0 && <Arrow up={false} />}
    </button>
  );
}

export function AngleStepper({ pitchDeg, min, max, disabled, onStep }: Props): JSX.Element {
  const word = angleWord(pitchDeg);
  return (
    <div className="anglestep" role="group" aria-label="던지는 각도" data-testid="angle-stepper">
      <HoldButton dir={1} label="위로" atEnd={pitchDeg >= max} disabled={disabled} onStep={onStep} testId="angle-up" />
      <output className="anglestep__now" aria-live="polite" data-testid="angle-readout" data-pitch={pitchDeg}>
        <span className="anglestep__word" data-testid="angle-word">{word}</span>
        <span className="anglestep__deg num">{pitchDeg < 0 ? '−' : ''}{Math.abs(pitchDeg)}°</span>
      </output>
      <HoldButton dir={-1} label="아래로" atEnd={pitchDeg <= min} disabled={disabled} onStep={onStep} testId="angle-down" />
    </div>
  );
}
