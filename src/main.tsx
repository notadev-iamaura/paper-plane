/** 앱의 시작점. 화면 뿌리(#root)에 React 앱을 붙인다. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './app/App';
import { log } from './app/lib/logger';
import './app/fonts.css';
import './app/tokens.css';
import './app/styles.css';

// 어디서도 잡지 못한 오류를 기록해 둔다(숨은 디버그 패널에서 볼 수 있다).
window.addEventListener('error', (e) => log.error('window', e.message));
window.addEventListener('unhandledrejection', (e) => log.error('window', '처리되지 않은 비동기 오류', e.reason));

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}
