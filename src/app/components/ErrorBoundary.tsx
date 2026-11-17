/**
 * 화면 어딘가에서 예상하지 못한 오류가 나면 빈 화면 대신 안내와 "처음부터 다시" 단추를 보여준다.
 * (오류 경계는 React 규칙상 클래스로만 만들 수 있다.)
 */
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { log } from '../lib/logger';

interface Props {
  children: ReactNode;
  /** 저장된 상태를 지우고 처음 상태로 되돌리는 함수 */
  onReset: () => void;
}
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error('ui', '화면을 그리다 오류가 났어요', { message: error.message, stack: info.componentStack?.slice(0, 300) });
  }

  private handleReset = (): void => {
    this.props.onReset();
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fallback" role="alert">
        <div className="fallback__card">
          <h1>앗, 비행기가 길을 잃었어요</h1>
          <p>화면을 그리다가 문제가 생겼어요. 아래 단추를 누르면 대회장에서 다시 시작해요. 기록과 스티커는 그대로 있어요.</p>
          <p className="fallback__detail">{this.state.error.message}</p>
          <button type="button" className="btn btn--primary" onClick={this.handleReset}>처음부터 다시 하기</button>
        </div>
      </div>
    );
  }
}
