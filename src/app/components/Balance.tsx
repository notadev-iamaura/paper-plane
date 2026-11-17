/**
 * 균형 저울: 받침대 위에 올린 작은 비행기가 앞이나 뒤로 기운다.
 * 어려운 말 대신 "앞이 무거워요 / 딱 좋아요 / 뒤가 무거워요" 로 알려 준다.
 */
import type { AeroSummary } from '../../core/index';
import { balanceOf } from '../lib/kidvoice';

export function BalanceScale({ summary, color }: { summary: AeroSummary; color: string }): JSX.Element {
  const b = balanceOf(summary);
  return (
    <div className={`balance balance--${b.kind}`} data-testid="balance" data-kind={b.kind}>
      <svg className="balance__svg" viewBox="0 0 120 64" aria-hidden="true">
        <path d="M60 36 48 58h24z" className="balance__stand" />
        <path d="M34 59h52" className="balance__ground" />
        {/* 코가 왼쪽. 앞이 무거우면 왼쪽(코)이 내려간다. */}
        <g style={{ transform: `rotate(${-b.tiltDeg}deg)`, transformOrigin: '60px 34px' }} className="balance__beam">
          <path d="M14 34h92" className="balance__bar" />
          <path d="M22 30 92 14 84 30z" style={{ fill: color }} className="balance__plane" />
          <path d="M22 30h62" className="balance__planeline" />
        </g>
        <circle cx="60" cy="35" r="3.5" className="balance__pin" />
      </svg>
      <div className="balance__text">
        <strong className="balance__label" data-testid="balance-label">{b.label}</strong>
        <span className="balance__hint">{b.hint}</span>
      </div>
    </div>
  );
}
