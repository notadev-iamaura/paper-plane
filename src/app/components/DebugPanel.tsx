/** 숨은 디버그 패널: 버전 글자를 5번 누르면 열린다. 최근 기록 200개를 보여준다. */
import { useEffect, useState } from 'react';
import { getLogEntries, subscribeLogs } from '../lib/logger';
import type { LogEntry } from '../lib/logger';

function timeText(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export function DebugPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const [entries, setEntries] = useState<LogEntry[]>(() => getLogEntries());

  useEffect(() => subscribeLogs(() => setEntries(getLogEntries())), []);

  return (
    <section className="debug" aria-label="디버그 기록" data-testid="debug-panel">
      <div className="debug__head">
        <strong>디버그 기록 ({entries.length})</strong>
        <button type="button" className="btn btn--small" onClick={onClose}>닫기</button>
      </div>
      <ol className="debug__list">
        {entries.slice().reverse().map((e) => (
          <li key={e.id} className={`debug__item debug__item--${e.level}`}>
            <span className="debug__time">{timeText(e.time)}</span>
            <span className="debug__scope">{e.level} · {e.scope}</span>
            <span className="debug__msg">{e.message}{e.detail ? ` ${e.detail}` : ''}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
