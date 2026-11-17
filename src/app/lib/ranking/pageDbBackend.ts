/**
 * 게시된 페이지의 함께 쓰는 저장소(window.claude.use("db"))로 움직이는 순위표.
 *
 * 저장하는 것: scores/<내 id> 문서 하나 = { v: 1, distance?: { code, nickname, at }, airtime?: { ... } }
 *   - 점수는 저장하지 않는다. 문서에 점수처럼 보이는 값이 있어도 읽지 않는다.
 *   - 보는 기기마다 코드를 풀어 규칙을 검사하고 같은 core 로 다시 계산해 순위를 매긴다(verifier).
 * 읽기: scores 묶음을 최대 200개까지 한 번만 지켜본다(onSnapshot). 10초 동안 소식이 없으면 "불러올 수 없어요"를 보여 준다.
 * 쓰기: 내 문서에만, 한 번에 하나씩, 정말 바뀔 때만. 지금 문서를 읽어(다른 종목 기록을 지키려고) 전체를 다시 쓴다(set).
 *   - 'unavailable' 은 잠깐 쉬었다가 한 번만 다시 해 본다.
 *   - 'invalid_argument' 는 "쓸 수 없는 사람"이라는 뜻으로 보고 이번 방문 동안 구경만 하게 바꾼다.
 * 이 파일은 window 에 기대지 않는다(저장소, 사용자, 시계를 바깥에서 받는다). 그래서 Node 에서 흉내 저장소로 검사할 수 있다.
 */
import { log } from '../logger';
import { buildBoard, docAfterRemove, docAfterSubmit, isBetter, isDocId, officialScore, parseScoreDoc, sanitizeNickname } from './board';
import type { Lookup } from './board';
import { toVerified } from './cache';
import type { ResultCache } from './cache';
import type {
  BoardStatus, RankingBackend, RankingState, RankMode, RemoveOutcome, ScoreDoc, SubmitOutcome, WriteState,
} from './types';
import { DOC_LIMIT, EMPTY_BOARD, RANK_MODES } from './types';
import type { Verifier } from './verifier';

// ---- 플랫폼 문서에 적힌 모양 가운데 여기서 쓰는 것만 ----
export interface DbDocSnapshot { id?: unknown; exists?: unknown; data?: unknown }
export interface DbDocRef {
  get: () => Promise<DbDocSnapshot>;
  set: (value: Record<string, unknown>) => Promise<unknown>;
  delete: () => Promise<unknown>;
}
export interface DbQuerySnapshot { docs?: unknown }
export interface DbQuery {
  limit: (n: number) => DbQuery;
  onSnapshot: (next: (snap: DbQuerySnapshot) => void, error?: (err: unknown) => void) => unknown;
}
export interface PageDb {
  doc: (path: string) => DbDocRef;
  collection: (path: string) => DbQuery;
}

export const COLLECTION = 'scores';
export const STALL_MS = 10_000;

const KNOWN_CODES = ['invalid_argument', 'resource_exhausted', 'quota_exceeded', 'unavailable', 'revoked', 'not_granted', 'capability_disabled', 'capability_removed', 'transform_error'];
/** 이 오류가 나면 이번 방문에는 저장소를 더 쓸 수 없다. */
const TERMINAL = ['revoked', 'not_granted', 'capability_disabled', 'capability_removed'];

/** 오류의 code. 모르는 code 는 'unavailable' 로 본다. */
export function errorCode(err: unknown): string {
  const c = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof c === 'string' && KNOWN_CODES.includes(c) ? c : 'unavailable';
}

/** 문서 스냅숏에서 내용을 꺼낸다. 없는 문서거나 읽다가 오류가 나면 null. */
function snapshotData(s: DbDocSnapshot | null | undefined): unknown {
  try {
    if (!s || s.exists === false) return null;
    return typeof s.data === 'function' ? (s.data as () => unknown)() : s.data ?? null;
  } catch {
    return null;
  }
}

export interface PageDbDeps {
  db: PageDb;
  /** 보는 사람의 id(user.id()). 없으면 null: 구경만 한다. */
  uid: string | null;
  /** user.can("data.write") 의 답. false 면 처음부터 구경만. true 나 null 이면 올려 보게 둔다. */
  canWriteHint: boolean | null;
  verifier: Verifier;
  cache: ResultCache;
  /** 순위표를 처음 켤 때 한 번 부른다(계산기 준비). */
  onStart?: () => void;
  now?: () => number;
  random?: () => number;
  /** ms 만큼 쉰다(검사에서 바꿔 끼운다). */
  sleep?: (ms: number) => Promise<void>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export function createPageDbBackend(deps: PageDbDeps): RankingBackend & { /** 검사용: 지켜보기를 끈다 */ stop: () => void } {
  const { db, verifier, cache } = deps;
  const now = deps.now ?? (() => Date.now());
  const random = deps.random ?? Math.random;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => { setTimeout(r, ms); }));
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const uid = isDocId(deps.uid) ? deps.uid : null;

  let status: BoardStatus = 'idle';
  let write: WriteState = uid === null ? 'no-id' : deps.canWriteHint === false ? 'readonly' : 'yes';
  /** 지켜보는 묶음에서 온 문서(믿지 않고 다듬은 것) */
  let docs = new Map<string, ScoreDoc>();
  /** 내 문서. undefined: 아직 모름 / null: 없음. 내가 방금 쓴 값이 스냅숏보다 먼저다. */
  let ownDoc: ScoreDoc | null | undefined;
  let ownIsLocal = false;
  let unsub: (() => void) | null = null;
  let stallTimer: unknown = null;
  let started = false;
  let state: RankingState = makeState();
  const listeners = new Set<() => void>();
  let emitQueued = false;
  let lastSummary = '';
  /** 쓰기는 한 번에 하나씩 */
  let writeChain: Promise<unknown> = Promise.resolve();
  let writing = false;
  // 계산이 하나 끝날 때마다 순위표를 다시 센다.
  verifier.onSettled = () => emitSoon();

  function effectiveDocs(): Map<string, ScoreDoc> {
    if (uid === null) return docs;
    if (ownDoc === undefined || (!ownIsLocal && docs.has(uid))) return docs;
    const m = new Map(docs);
    if (ownDoc === null) m.delete(uid);
    else m.set(uid, ownDoc);
    return m;
  }

  const lookup: Lookup = (code) => {
    const v = verifier.peek(code);
    if (v === undefined) return undefined;
    return toVerified(v) ?? 'bad';
  };

  function makeState(): RankingState {
    const all = effectiveDocs();
    return {
      status,
      errors: [],
      write,
      boards: {
        distance: status === 'idle' ? EMPTY_BOARD : buildBoard('distance', all, lookup, uid),
        airtime: status === 'idle' ? EMPTY_BOARD : buildBoard('airtime', all, lookup, uid),
      },
    };
  }

  function emitNow(): void {
    emitQueued = false;
    state = makeState();
    if (verifier.pending === 0 && status === 'ready') {
      cache.flush();
      const s = verifier.stats;
      const summary = `${docs.size}/${state.boards.distance.total}/${state.boards.airtime.total}/${s.evaluated}/${s.invalid}/${s.timeouts}`;
      if (summary !== lastSummary) {
        lastSummary = summary;
        log.debug('rank', '순위표를 다시 셌어요', {
          docs: docs.size, distance: state.boards.distance.total, airtime: state.boards.airtime.total,
          evaluated: s.evaluated, cacheHits: s.cacheHits, skippedInvalid: s.invalid, skippedSlow: s.timeouts,
        });
      }
    }
    for (const fn of [...listeners]) {
      try { fn(); } catch (err) { log.warn('rank', '순위표를 알리다가 오류가 났어요', err); }
    }
  }
  /** 계산이 줄줄이 끝날 때 화면을 너무 자주 고치지 않도록 조금 모았다가 알린다. */
  function emitSoon(): void {
    if (emitQueued) return;
    emitQueued = true;
    setTimer(emitNow, 120);
  }

  function requestAll(): void {
    const all = effectiveDocs();
    // 내 기록부터 계산한다.
    const mine = uid !== null ? all.get(uid) : undefined;
    for (const m of RANK_MODES) if (mine?.[m]) verifier.request(mine[m]!.code, true);
    for (const [, d] of all) for (const m of RANK_MODES) if (d[m]) verifier.request(d[m]!.code);
  }

  function clearStall(): void {
    if (stallTimer !== null) clearTimer(stallTimer);
    stallTimer = null;
  }

  function close(code: string): void {
    log.warn('rank', `순위표 저장소를 더 쓸 수 없어요 (${code})`);
    status = 'closed';
    clearStall();
    try { unsub?.(); } catch { /* 이미 끊김 */ }
    unsub = null;
    emitNow();
  }

  function onSnapshot(snap: DbQuerySnapshot): void {
    clearStall();
    const next = new Map<string, ScoreDoc>();
    let dropped = 0;
    const list = Array.isArray(snap?.docs) ? (snap.docs as DbDocSnapshot[]).slice(0, DOC_LIMIT) : [];
    const t = now();
    for (const d of list) {
      const id = d?.id;
      const parsed = isDocId(id) ? parseScoreDoc(snapshotData(d), t) : null;
      if (parsed && isDocId(id)) next.set(id, parsed);
      else dropped++;
    }
    docs = next;
    if (dropped > 0) log.debug('rank', '모양이 맞지 않는 문서를 건너뛰었어요', { dropped });
    status = 'ready';
    requestAll();
    emitNow();
  }

  function onError(err: unknown): void {
    clearStall();
    const code = errorCode(err);
    log.warn('rank', `순위표를 받지 못했어요 (${code})`);
    try { unsub?.(); } catch { /* 이미 끊김 */ }
    unsub = null;
    if (TERMINAL.includes(code)) { close(code); return; }
    status = 'error';
    emitNow();
  }

  /** 묶음을 지켜보기 시작한다. 한 번에 하나만 지켜본다. */
  function subscribe(): void {
    try { unsub?.(); } catch { /* 이미 끊김 */ }
    unsub = null;
    status = 'loading';
    clearStall();
    stallTimer = setTimer(() => {
      stallTimer = null;
      if (status !== 'loading') return;
      status = 'stalled';
      log.warn('rank', '10초 동안 순위표 소식이 없어요');
      emitNow();
    }, STALL_MS);
    try {
      const off = db.collection(COLLECTION).limit(DOC_LIMIT).onSnapshot(
        (snap) => { try { onSnapshot(snap); } catch (err) { log.warn('rank', '순위표를 읽다가 오류가 났어요', err); } },
        (err) => onError(err),
      );
      unsub = typeof off === 'function' ? (off as () => void) : null;
    } catch (err) {
      onError(err);
      return;
    }
    emitNow();
  }

  /** 내 문서를 한 번 읽어 둔다(읽는 묶음 200개 안에 내 문서가 없을 때를 대비한다). */
  function loadOwn(): void {
    if (uid === null) return;
    db.doc(`${COLLECTION}/${uid}`).get().then((s) => {
      if (ownIsLocal) return;
      ownDoc = parseScoreDoc(snapshotData(s), now());
      requestAll();
      emitSoon();
    }, (err: unknown) => {
      const code = errorCode(err);
      if (TERMINAL.includes(code)) close(code);
    });
  }

  /** 'unavailable' 이면 0.3~1.2초 쉬었다가 한 번만 다시 한다. */
  async function withRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (errorCode(err) !== 'unavailable') throw err;
      log.info('rank', `${what}: 잠깐 쉬었다가 한 번 더 해 봐요`);
      await sleep(300 + Math.floor(random() * 900));
      return fn();
    }
  }

  async function readOwn(): Promise<ScoreDoc | null> {
    const s = await withRetry('내 기록 읽기', () => db.doc(`${COLLECTION}/${uid}`).get());
    return parseScoreDoc(snapshotData(s), now());
  }

  function failure(err: unknown, wasWrite: boolean): 'readonly' | 'full' | 'offline' | 'closed' | 'error' {
    const code = errorCode(err);
    log.warn('rank', `순위표 저장소가 일을 받아 주지 않았어요 (${code})`);
    if (code === 'invalid_argument') {
      if (!wasWrite) return 'error';
      // 잘 만든 문서를 내 자리에 쓰는데도 거절당했다 = 쓸 수 없는 사람. 이번 방문 동안은 구경만 한다.
      write = 'readonly';
      emitNow();
      return 'readonly';
    }
    if (TERMINAL.includes(code)) { close(code); return 'closed'; }
    if (code === 'resource_exhausted' || code === 'quota_exceeded') return 'full';
    if (code === 'unavailable') return 'offline';
    return 'error';
  }

  /** 쓰기를 줄 세운다. */
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = writeChain.then(fn, fn);
    writeChain = p.catch(() => undefined);
    return p;
  }

  async function submit(mode: RankMode, code: string, rawNickname: string): Promise<SubmitOutcome> {
    const nickname = sanitizeNickname(rawNickname);
    if (nickname === null) return { ok: false, reason: 'nickname' };
    if (uid === null) return { ok: false, reason: 'no-id' };
    if (status === 'closed') return { ok: false, reason: 'closed' };
    if (write !== 'yes') return { ok: false, reason: 'readonly' };
    if (writing) return { ok: false, reason: 'busy' };
    writing = true;
    try {
      return await serial(async (): Promise<SubmitOutcome> => {
        // 1) 올리려는 코드를 이 기기에서 먼저 검사하고 계산한다.
        const mine = toVerified(await verifier.verify(code, true));
        if (!mine) return { ok: false, reason: 'invalid' };
        const score = officialScore(mode, mine);
        // 2) 지금 내 문서를 읽어, 이미 올린 기록보다 좋을 때만 쓴다.
        let current: ScoreDoc | null;
        try {
          current = await readOwn();
        } catch (err) {
          return { ok: false, reason: failure(err, false) };
        }
        const prev = current?.[mode];
        if (prev) {
          const old = toVerified(await verifier.verify(prev.code, true));
          if (old && !isBetter(score, officialScore(mode, old))) {
            ownDoc = current;
            ownIsLocal = true;
            emitSoon();
            return { ok: false, reason: 'not-better', existingScore: officialScore(mode, old), existingNickname: prev.nickname };
          }
        }
        // 3) 다른 종목 기록을 지키면서 문서 전체를 다시 쓴다. 점수는 넣지 않는다.
        const next = docAfterSubmit(current, mode, { code, nickname, at: now() });
        try {
          await withRetry('기록 올리기', () => db.doc(`${COLLECTION}/${uid}`).set(next as unknown as Record<string, unknown>));
        } catch (err) {
          return { ok: false, reason: failure(err, true) };
        }
        ownDoc = next;
        ownIsLocal = true;
        requestAll();
        state = makeState();
        const board = state.boards[mode];
        log.info('rank', '기록을 올렸어요', { mode, rank: board.mine?.rank ?? null, total: board.total });
        emitNow();
        return { ok: true, score, rank: board.mine?.rank ?? null, total: board.total };
      });
    } finally {
      writing = false;
    }
  }

  async function remove(mode: RankMode): Promise<RemoveOutcome> {
    if (uid === null) return { ok: false, reason: 'no-id' };
    if (status === 'closed') return { ok: false, reason: 'closed' };
    if (write !== 'yes') return { ok: false, reason: 'readonly' };
    if (writing) return { ok: false, reason: 'error' };
    writing = true;
    try {
      return await serial(async (): Promise<RemoveOutcome> => {
        let current: ScoreDoc | null;
        try {
          current = await readOwn();
        } catch (err) {
          const why = failure(err, false);
          return { ok: false, reason: why === 'full' ? 'error' : why };
        }
        if (!current?.[mode]) {
          ownDoc = current;
          ownIsLocal = true;
          emitNow();
          return { ok: false, reason: 'nothing' };
        }
        const next = docAfterRemove(current, mode);
        const ref = db.doc(`${COLLECTION}/${uid}`);
        try {
          await withRetry('기록 지우기', () => (next === null ? ref.delete() : ref.set(next as unknown as Record<string, unknown>)));
        } catch (err) {
          const why = failure(err, true);
          return { ok: false, reason: why === 'full' ? 'error' : why };
        }
        ownDoc = next;
        ownIsLocal = true;
        log.info('rank', '내 기록을 지웠어요', { mode });
        emitNow();
        return { ok: true };
      });
    } finally {
      writing = false;
    }
  }

  return {
    kind: 'pagedb',
    live: true,
    canRemove: true,
    start(): void {
      if (started) return;
      started = true;
      try { deps.onStart?.(); } catch (err) { log.warn('rank', '계산기를 준비하지 못했어요', err); }
      subscribe();
      loadOwn();
    },
    watch(): void { /* 두 종목을 한꺼번에 받으므로 할 일이 없다 */ },
    retry(): void {
      if (status === 'error' || status === 'stalled') subscribe();
    },
    getState: () => state,
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    submit,
    remove,
    stop(): void {
      clearStall();
      try { unsub?.(); } catch { /* 이미 끊김 */ }
      unsub = null;
    },
  };
}
