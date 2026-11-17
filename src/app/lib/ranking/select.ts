/**
 * 순위표가 어느 길로 움직일지 고른다. 앱 전체에서 한 번만 고른다.
 *   1) VITE_API_URL 이 있으면 랭킹 서버(http). 예전 그대로.
 *   2) 없으면 게시된 페이지의 함께 쓰는 저장소(window.claude.use("db"))를 써 본다.
 *   3) 둘 다 없으면 순위표 없이 논다. 내 기록은 이 기기에 남는다.
 *
 * window.claude 는 아예 없을 수 있고(내 컴퓨터, 다른 곳에 올린 판), use() 는 한참 뒤에 null 을 줄 수도 있다.
 * 어느 경우에도 놀이는 그대로 움직여야 한다. window.claude.db 를 직접 읽지 않는다.
 */
import { encodeDesign, PRESETS } from '../../../core/index';
import { RANKING_ENABLED } from '../../api';
import { log } from '../logger';
import { loadJson, saveJson } from '../storage';
import { isDocId } from './board';
import { CACHE_MAX, ResultCache } from './cache';
import { createHttpBackend } from './httpBackend';
import { createPageDbBackend } from './pageDbBackend';
import type { PageDb } from './pageDbBackend';
import type { RankingBackend } from './types';
import { Verifier } from './verifier';
import { workerCount, workerEvaluator } from './workerEvaluator';

/** checking: 알아보는 중 / none: 순위표 없음 / ready: 쓸 수 있음 */
export type Selection =
  | { kind: 'checking' }
  | { kind: 'none' }
  | { kind: 'ready'; backend: RankingBackend };

const CACHE_KEY = 'pp.rank.cache.v1';
/** use() 가 스스로 10초 뒤 null 을 주지만, 끝내 답이 없을 때를 대비해 조금 더 기다렸다가 포기한다. */
const USE_TIMEOUT_MS = 12_000;

interface PageUser {
  id?: () => Promise<unknown>;
  can?: (what: string) => Promise<unknown>;
}
type UseFn = (name: string) => Promise<unknown>;

let selection: Selection | null = null;
const listeners = new Set<() => void>();

function set(next: Selection): void {
  selection = next;
  for (const fn of [...listeners]) fn();
}

function pageUse(): UseFn | null {
  try {
    const claude = (window as unknown as { claude?: { use?: unknown } }).claude;
    const use = claude?.use;
    return typeof use === 'function' ? (name: string) => Promise.resolve((use as UseFn).call(claude, name)) : null;
  } catch {
    return null;
  }
}

function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms);
    p.then((v) => { window.clearTimeout(timer); resolve(v); }, () => { window.clearTimeout(timer); resolve(null); });
  });
}

/** 계산이 바뀌었는지 알아보는 시험 코드: 첫 번째 따라 접기 비행기를 정해진 힘으로 던진 것 */
function canaryCode(): string {
  return encodeDesign(PRESETS[0]!.design, { speedMps: 8, pitchDeg: 10, rollDeg: 0 });
}

async function resolvePage(use: UseFn): Promise<void> {
  const [dbRaw, userRaw] = await Promise.all([within(use('db'), USE_TIMEOUT_MS), within(use('user'), USE_TIMEOUT_MS)]);
  const db = dbRaw as PageDb | null;
  if (!db || typeof db.doc !== 'function' || typeof db.collection !== 'function') {
    log.info('rank', '이 화면에서는 함께 쓰는 저장소를 쓸 수 없어 순위표 없이 놀아요');
    set({ kind: 'none' });
    return;
  }
  const user = userRaw as PageUser | null;
  let uid: string | null = null;
  let canHint: boolean | null = null;
  if (user) {
    try {
      const id = typeof user.id === 'function' ? await within(user.id(), USE_TIMEOUT_MS) : null;
      uid = isDocId(id) ? id : null;
    } catch {
      uid = null;
    }
    try {
      const can = typeof user.can === 'function' ? await within(user.can('data.write'), USE_TIMEOUT_MS) : null;
      canHint = can === true ? true : can === false ? false : null;
    } catch {
      canHint = null;
    }
  }
  const cache = new ResultCache(CACHE_MAX, { load: () => loadJson(CACHE_KEY), save: (v) => { saveJson(CACHE_KEY, v); } });
  const verifier = new Verifier({ evaluator: workerEvaluator, cache, concurrency: workerCount(), waitForWarmUp: true });
  // 순위표를 처음 켤 때(누군가 순위표를 보거나 기록을 올리려 할 때)에야 계산기를 준비한다.
  const backend = createPageDbBackend({ db, uid, canWriteHint: canHint, verifier, cache, onStart: () => { void verifier.warmUp(canaryCode()); } });
  log.info('rank', '함께 쓰는 저장소로 순위표를 열어요', { hasId: uid !== null, canHint });
  set({ kind: 'ready', backend });
}

/** 고르기를 시작한다(처음 부를 때 한 번만). 지금까지 알아낸 것을 돌려준다. */
export function getSelection(): Selection {
  if (selection) return selection;
  if (RANKING_ENABLED) {
    selection = { kind: 'ready', backend: createHttpBackend() };
    return selection;
  }
  const use = pageUse();
  if (!use) {
    selection = { kind: 'none' };
    return selection;
  }
  selection = { kind: 'checking' };
  resolvePage(use).catch((err: unknown) => {
    log.warn('rank', '순위표를 준비하지 못했어요', err);
    set({ kind: 'none' });
  });
  return selection;
}

export function subscribeSelection(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
