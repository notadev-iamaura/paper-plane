/**
 * 힘 막대: 살살(왼쪽)에서 세게(오른쪽)까지. 던지기 단추를 꾹 누르는 동안 차오르고,
 * 막대를 직접 끌어서 힘을 정할 수도 있다.
 * 꾹 누르는 동안에는 매 화면마다 바뀌므로, 바깥에서 paint() 로 직접 그릴 수 있게 한다.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { clamp, fmt } from '../lib/format';
import { powerWord } from '../lib/kidvoice';
import { gaugeToSpeed, powerZone, speedToGauge, ZONE_HARD_START, ZONE_SOFT_END } from './aimMath';

export interface PowerGaugeHandle {
  /** 리액트를 거치지 않고 막대를 바로 그린다(힘 모으는 동안). */
  paint: (speed: number) => void;
}

interface Props {
  speed: number;
  min: number;
  max: number;
  disabled?: boolean;
  /** 힘을 모으는 중(막대가 저절로 움직이는 중) */
  charging?: boolean;
  onChange: (speed: number) => void;
  /** 막대를 끄는 동안 true */
  onDrag?: (on: boolean) => void;
}

const zoneOf = (speed: number): string => powerZone(speed);

/** 손잡이 반지름만큼 양 끝을 비워 둔다(px). */
const PAD = 16;

export const PowerGauge = forwardRef<PowerGaugeHandle, Props>(function PowerGauge({ speed, min, max, disabled, charging, onChange, onDrag }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const word = useRef<HTMLElement>(null);
  const num = useRef<HTMLSpanElement>(null);
  const drag = useRef<number | null>(null);

  const paint = (s: number): void => {
    const el = root.current;
    if (!el) return;
    const g = speedToGauge(s);
    el.style.setProperty('--g', g.toFixed(4));
    el.dataset.speed = s.toFixed(1);
    el.dataset.gauge = g.toFixed(3);
    el.dataset.zone = zoneOf(s);
    el.setAttribute('aria-valuenow', s.toFixed(1));
    el.setAttribute('aria-valuetext', `${powerWord(s)}, ${fmt(s, 1)}`);
    if (word.current) word.current.textContent = powerWord(s);
    if (num.current) num.current.textContent = fmt(s, 1);
  };
  useImperativeHandle(ref, () => ({ paint }), []);
  // 값이 바뀌면(또는 힘 모으기가 끝나면) 정해진 값으로 다시 그린다.
  useEffect(() => { if (!charging) paint(speed); }, [speed, charging]);

  const speedAt = (clientX: number): number => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width <= PAD * 2) return speed;
    return clamp(gaugeToSpeed((clientX - r.left - PAD) / (r.width - PAD * 2)), min, max);
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled || charging || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.current = e.pointerId;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 잡지 못해도 끌기는 된다 */ }
    onDrag?.(true);
    onChange(speedAt(e.clientX));
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current !== e.pointerId) return;
    onChange(speedAt(e.clientX));
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current !== e.pointerId) return;
    drag.current = null;
    onDrag?.(false);
  };
  const key = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (disabled || charging) return;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = speed + 0.5;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = speed - 0.5;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    if (next === null) return;
    e.preventDefault();
    onChange(clamp(Math.round(next * 10) / 10, min, max));
  };

  const g = speedToGauge(speed);
  return (
    <div
      ref={root}
      className={`gauge${charging ? ' is-charging' : ''}${disabled ? ' is-disabled' : ''}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="던지는 힘"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(speed.toFixed(1))}
      aria-valuetext={`${powerWord(speed)}, ${fmt(speed, 1)}`}
      aria-disabled={disabled || undefined}
      data-grab=""
      data-testid="power-gauge"
      data-speed={speed.toFixed(1)}
      data-gauge={g.toFixed(3)}
      data-zone={zoneOf(speed)}
      style={{ '--g': g.toFixed(4), '--z1': String(ZONE_SOFT_END), '--z2': String(ZONE_HARD_START) } as React.CSSProperties}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="gauge__label">힘</span>
      <div className="gauge__track" ref={track} data-testid="power-track">
        <i className="gauge__zones" aria-hidden="true" />
        <i className="gauge__fill" aria-hidden="true" />
        <span className="gauge__end gauge__end--lo" aria-hidden="true">살살</span>
        <span className="gauge__end gauge__end--hi" aria-hidden="true">세게</span>
        <i className="gauge__knob" aria-hidden="true" />
      </div>
      <span className="gauge__now">
        <strong ref={word} className="gauge__word" data-testid="power-word">{powerWord(speed)}</strong>
        <span className="gauge__num num"><span ref={num} data-testid="power-num">{fmt(speed, 1)}</span></span>
      </span>
    </div>
  );
});
