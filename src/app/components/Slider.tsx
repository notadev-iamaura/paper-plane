/**
 * 굵직한 조절 막대. 이름과 지금 값을 크게 보여 주고, 손가락으로 잡기 쉬운 큰 손잡이를 쓴다.
 * 좌우에 있는 - / + 단추로 한 칸씩 움직일 수도 있다.
 */
import { clamp, snapToStep } from '../lib/format';

interface Props {
  label: string;
  /** 한 줄 설명(무엇이 달라지는지) */
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** 값 옆에 작게 보여 줄 글자(숫자와 단위) */
  format: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
  testId?: string;
  /** 양 끝에 적는 쉬운 말(예: 살살 / 세게) */
  ends?: [string, string];
}

export function Slider({ label, hint, value, min, max, step, format, onChange, disabled, testId, ends }: Props): JSX.Element {
  const set = (v: number): void => onChange(clamp(snapToStep(v, min, step), min, max));
  const fill = ((clamp(value, min, max) - min) / (max - min || 1)) * 100;
  return (
    <div className={`slider${disabled ? ' is-disabled' : ''}`}>
      <div className="slider__head">
        <span className="slider__label">{label}</span>
        <output className="slider__value">{format(value)}</output>
      </div>
      <div className="slider__row">
        <button type="button" className="slider__nudge" aria-label={`${label} 줄이기`} disabled={disabled || value <= min} onClick={() => set(value - step)}>−</button>
        <div className="slider__track">
          <input
            type="range"
            aria-label={label}
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            data-testid={testId}
            style={{ '--fill': `${fill}%` } as React.CSSProperties}
            onChange={(e) => set(Number(e.target.value))}
          />
        </div>
        <button type="button" className="slider__nudge" aria-label={`${label} 늘리기`} disabled={disabled || value >= max} onClick={() => set(value + step)}>+</button>
      </div>
      {ends && <div className="slider__ends" aria-hidden="true"><span>{ends[0]}</span><span>{ends[1]}</span></div>}
      {hint && <p className="slider__hint">{hint}</p>}
    </div>
  );
}
