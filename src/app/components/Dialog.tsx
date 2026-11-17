/**
 * 화면 안에 직접 그리는 대화상자.
 * 게시 환경에서는 alert/confirm/prompt 를 쓸 수 없으므로 모든 물음은 이것으로 띄운다.
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icons';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  /** 모눈 공책처럼 화면을 가득 채우는 큰 판 */
  variant?: 'card' | 'notebook';
}

export function Dialog({ title, onClose, children, testId, variant = 'card' }: Props): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 열릴 때 상자로 초점을 옮기고, Esc 로 닫을 수 있게 한다.
    boxRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={`dialog__backdrop dialog__backdrop--${variant}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dialog dialog--${variant}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={boxRef} data-testid={testId}>
        <div className="dialog__head">
          <h2 className="dialog__title">{title}</h2>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="닫기" data-testid={testId ? `${testId}-close` : undefined}>
            <Icon name="close" />
          </button>
        </div>
        <div className="dialog__body">{children}</div>
      </div>
    </div>
  );
}
