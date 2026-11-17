/**
 * 아주 작은 기록(로그) 모듈.
 * - 수준(debug, info, warn, error)을 붙여 콘솔에 찍고,
 * - 최근 200개를 메모리에 보관한다(오래된 것부터 버리는 고리 버퍼).
 * - 화면의 숨은 디버그 패널이 subscribe 로 목록을 받아 보여준다.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  /** 순번(1부터) */
  id: number;
  /** 기록 시각 (ms, Date.now) */
  time: number;
  level: LogLevel;
  /** 어느 부분에서 남겼는지 (예: 'fold', 'sim', 'api') */
  scope: string;
  message: string;
  /** 덧붙인 값을 짧은 글자열로 바꾼 것 */
  detail: string;
}

const MAX_ENTRIES = 200;
const buffer: LogEntry[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

/** 덧붙인 값을 안전하게 글자열로 바꾼다(순환 참조나 너무 긴 값 대비). */
function stringify(data: unknown): string {
  if (data === undefined) return '';
  if (data instanceof Error) return `${data.name}: ${data.message}`;
  if (typeof data === 'string') return data.slice(0, 400);
  try {
    return JSON.stringify(data).slice(0, 400);
  } catch {
    return String(data).slice(0, 400);
  }
}

function write(level: LogLevel, scope: string, message: string, data?: unknown): void {
  const entry: LogEntry = { id: nextId++, time: Date.now(), level, scope, message, detail: stringify(data) };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();

  const line = `[${scope}] ${message}`;
  /* eslint-disable no-console */
  if (level === 'error') console.error(line, data ?? '');
  else if (level === 'warn') console.warn(line, data ?? '');
  else if (level === 'info') console.info(line, data ?? '');
  else console.debug(line, data ?? '');
  /* eslint-enable no-console */

  for (const fn of listeners) fn();
}

export const log = {
  debug: (scope: string, message: string, data?: unknown): void => write('debug', scope, message, data),
  info: (scope: string, message: string, data?: unknown): void => write('info', scope, message, data),
  warn: (scope: string, message: string, data?: unknown): void => write('warn', scope, message, data),
  error: (scope: string, message: string, data?: unknown): void => write('error', scope, message, data),
};

/** 지금까지의 기록(복사본, 오래된 것부터) */
export function getLogEntries(): LogEntry[] {
  return buffer.slice();
}

/** 기록이 추가될 때마다 불릴 함수를 등록한다. 돌려주는 함수를 부르면 해제된다. */
export function subscribeLogs(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
