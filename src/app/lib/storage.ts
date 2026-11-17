/**
 * localStorage 를 안전하게 쓰는 도우미.
 * 게시 환경(샌드박스 iframe)에서는 localStorage 접근 자체가 예외를 던질 수 있다.
 * 그래서 모든 접근을 try/catch 로 감싸고, 실패하면 "저장 없이" 계속 동작한다.
 */
import { log } from './logger';

let warned = false;

function warnOnce(err: unknown): void {
  if (warned) return;
  warned = true;
  log.warn('storage', '저장소를 쓸 수 없어 이번 방문 동안만 기억해요', err);
}

/** JSON 으로 저장된 값을 읽는다. 없거나 실패하면 null. */
export function loadJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as unknown;
  } catch (err) {
    warnOnce(err);
    return null;
  }
}

/** 값을 JSON 으로 저장한다. 성공하면 true. */
export function saveJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    warnOnce(err);
    return false;
  }
}

/** 저장소 키 모음 (한곳에서 관리) */
export const STORAGE_KEYS = {
  session: 'pp.session.v2',
  records: 'pp.records.v1',
  introSeen: 'pp.introSeen.v1',
  nickname: 'pp.nickname.v1',
  sound: 'pp.sound.v1',
  stickers: 'pp.stickers.v1',
} as const;
