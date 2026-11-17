/**
 * 접기 판 전용 기록 도우미.
 * 앱의 기록 모듈(src/app/lib/logger.ts)이 있으면 그것을 쓰고, 다른 곳으로 옮겨졌거나 없으면 console 로 대신한다.
 * import.meta.glob 은 "파일이 있을 때만" 가져오므로, 파일이 없어도 빌드가 깨지지 않는다.
 */
interface LogLike {
  debug: (scope: string, message: string, data?: unknown) => void;
  info: (scope: string, message: string, data?: unknown) => void;
  warn: (scope: string, message: string, data?: unknown) => void;
  error: (scope: string, message: string, data?: unknown) => void;
}

const found = import.meta.glob('../lib/logger.ts', { eager: true }) as Record<string, { log?: LogLike } | undefined>;
const external: LogLike | undefined = Object.values(found)[0]?.log;

/* eslint-disable no-console */
const fallback: LogLike = {
  debug: (scope, message, data) => console.debug(`[${scope}] ${message}`, data ?? ''),
  info: (scope, message, data) => console.info(`[${scope}] ${message}`, data ?? ''),
  warn: (scope, message, data) => console.warn(`[${scope}] ${message}`, data ?? ''),
  error: (scope, message, data) => console.error(`[${scope}] ${message}`, data ?? ''),
};
/* eslint-enable no-console */

export const log: LogLike = external ?? fallback;
