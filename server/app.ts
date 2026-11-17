/**
 * 랭킹 서버의 요청 처리기. node:http 만 쓴다(추가 의존성 없음).
 *
 * 조작 방지는 한 가지뿐이다: 서버는 "입력"(공유 코드 = 설계 + 던지기 값)만 받아 검사하고,
 * 화면과 같은 core 코드로 다시 계산한 결과만 저장한다. 요청 본문에 거리, 시간, 점수가 들어 있어도 읽지 않는다.
 *
 * 계산 비용 보호: evaluate 한 번이 CPU 를 최대 0.2초쯤 쓴다(동기 계산이라 그동안 다른 요청이 멈춘다).
 * 그래서 제출은 작은 대기열에 넣어 하나씩 처리하고, 한 건을 끝낼 때마다 몇 ms 쉬면서 이벤트 루프에 차례를 돌려준다.
 * 쉬는 동안 밀려 있던 연결을 받아들여 랭킹 조회 같은 가벼운 요청은 바로 답하고, 새 제출은 대기열에 세운다.
 * 대기열이 maxQueue 를 넘으면 503 으로 바로 거절하므로, 요청이 몰려도 기다리는 시간은 maxQueue x 약 0.2초를 넘지 않는다.
 * (쉬지 않고 곧바로 다음 건을 계산하면 Node 는 루프 한 바퀴에 새 연결을 하나씩만 받아들이기 때문에
 *  나머지 연결이 운영체제 쪽에 줄을 선 채 보이지 않게 기다리게 되고, 대기열 한도가 제 구실을 못 한다.)
 */
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { decodeDesign, encodeDesign, evaluate, PHYSICS_VERSION, validateSubmission } from '../src/core/index';
import type { GameMode } from '../src/core/index';
import type {
  ApiError, HealthResponse, LeaderboardEntry, LeaderboardResponse, SubmitResponse,
} from '../src/core/api';
import type { Store } from './store';

/**
 * 서버가 계산에 쓰는 core 의 판 번호 = 물리 판 번호(PHYSICS_VERSION). GET /api/health 가 알려 준다.
 * 화면과 서버의 계산 규칙이 같은 판인지 확인하는 용도다. core 에서 그대로 가져오므로 따로 올릴 필요가 없다.
 */
export const CORE_VERSION: number = PHYSICS_VERSION;

/**
 * 저장된 기록 한 줄을 그 코드로 지금의 core 로 다시 계산한다(FileStore 가 옛 판의 파일을 읽을 때 쓴다).
 * 제출 때와 같은 검사를 거친다: 코드가 읽히지 않거나, 던지기 값이 없거나 지금 한도를 벗어났거나
 * (decodeDesign 이 throwIn 을 주지 않는다), 규칙에 맞지 않거나, 계산이 안 되면 null.
 * id, 닉네임, 모드, 등록 시각은 그대로 둔다.
 */
export function remeasureEntry(e: LeaderboardEntry): LeaderboardEntry | null {
  try {
    const decoded = decodeDesign(e.code);
    if (decoded === null || decoded.throwIn === undefined) return null;
    const { design, throwIn } = decoded;
    if (!validateSubmission(design, throwIn).ok) return null;
    const { distanceM, airtimeS, verdict } = evaluate(design, throwIn).result;
    if (!Number.isFinite(distanceM) || !Number.isFinite(airtimeS)) return null;
    return { ...e, code: encodeDesign(design, throwIn), score: e.mode === 'distance' ? distanceM : airtimeS, distanceM, airtimeS, verdict };
  } catch {
    return null;
  }
}

export const MAX_BODY_BYTES = 8 * 1024;
export const NICKNAME_MAX = 16;
export const LEADERBOARD_DEFAULT_LIMIT = 50;
export const LEADERBOARD_MAX_LIMIT = 100;

export interface AppOptions {
  store: Store;
  /** 허용할 출처. '*' 또는 출처 하나, 또는 쉼표로 나눈 여러 출처. 기본 '*'. */
  corsOrigin?: string;
  /** 처리 중 + 대기 중인 제출의 최대 개수. 넘으면 503. 기본 20 (최악의 경우 약 4초 대기). */
  maxQueue?: number;
  /** 제출 한 건을 계산한 뒤 다음 건까지 쉬는 시간(ms). 기본 5. */
  queueGapMs?: number;
  /** 본문 최대 크기(바이트). 기본 8 KB. */
  maxBodyBytes?: number;
  /** 본문을 다 받을 때까지 기다리는 시간(ms). 기본 10초. */
  bodyTimeoutMs?: number;
  /** 현재 시각. 테스트에서 바꿔 끼울 수 있다. */
  now?: () => Date;
}

class HttpError extends Error {
  constructor(readonly status: number, readonly errors: string[], readonly closeConnection = false) {
    super(errors[0] ?? 'error');
  }
}

const bad = (...errors: string[]): HttpError => new HttpError(400, errors);

// ---------------------------------------------------------------------------
// 입력 정리
// ---------------------------------------------------------------------------

/** 닉네임: 제어 문자를 지우고 앞뒤 공백을 뗀다. 1~16자가 아니면 null. */
export function cleanNickname(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 256) return null;
  let s = '';
  for (const ch of raw.normalize('NFC')) {
    const c = ch.codePointAt(0)!;
    // 제어 문자(C0, DEL, C1)와 줄/문단 구분 문자는 버린다.
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) continue;
    if (c >= 0xd800 && c <= 0xdfff) continue; // 짝이 맞지 않는 대리 문자(깨진 글자)
    s += ch;
  }
  s = s.trim();
  const length = Array.from(s).length;
  if (length < 1 || length > NICKNAME_MAX) return null;
  return s;
}

function parseMode(raw: unknown): GameMode | null {
  return raw === 'distance' || raw === 'airtime' ? raw : null;
}

function readBody(req: IncomingMessage, maxBytes: number, timeoutMs: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new HttpError(413, ['요청 본문이 너무 큽니다. (최대 8 KB)'], true));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (fn: () => void): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new HttpError(408, ['요청 시간이 초과되었습니다.'], true)));
    }, timeoutMs);
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        finish(() => reject(new HttpError(413, ['요청 본문이 너무 큽니다. (최대 8 KB)'], true)));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(() => resolve(Buffer.concat(chunks))));
    req.on('error', () => finish(() => reject(bad('요청을 읽는 중 오류가 났습니다.'))));
    req.on('aborted', () => finish(() => reject(bad('요청이 중간에 끊겼습니다.'))));
  });
}

// ---------------------------------------------------------------------------
// 앱
// ---------------------------------------------------------------------------

export function createApp(options: AppOptions): RequestListener {
  const store = options.store;
  const corsOrigin = (options.corsOrigin ?? '*').trim() || '*';
  const allowedOrigins = corsOrigin.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  const maxQueue = Math.max(1, Math.floor(options.maxQueue ?? 20));
  const queueGapMs = Math.max(0, options.queueGapMs ?? 5);
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const bodyTimeoutMs = options.bodyTimeoutMs ?? 10_000;
  const now = options.now ?? ((): Date => new Date());

  // ---- 제출 대기열: 한 번에 하나씩 계산한다 ----
  type Job = { run: () => SubmitResponse; resolve: (r: SubmitResponse) => void; reject: (e: unknown) => void };
  const queue: Job[] = [];
  let pending = 0; // 대기 중 + 처리 중
  let draining = false;

  function drain(): void {
    const job = queue.shift();
    if (!job) {
      draining = false;
      return;
    }
    try {
      job.resolve(job.run());
    } catch (err) {
      job.reject(err);
    }
    pending--;
    // 다음 건은 잠깐 쉰 뒤에 계산한다(그 사이 밀려 있던 다른 요청을 받아 처리하거나 대기열에 세운다).
    setTimeout(drain, queueGapMs);
  }

  function enqueue(run: () => SubmitResponse): Promise<SubmitResponse> {
    if (pending >= maxQueue) {
      return Promise.reject(new HttpError(503, ['지금 등록 요청이 몰려 있습니다. 잠시 뒤에 다시 시도해 주세요.']));
    }
    pending++;
    return new Promise<SubmitResponse>((resolve, reject) => {
      queue.push({ run, resolve, reject });
      if (!draining) {
        draining = true;
        setImmediate(drain);
      }
    });
  }

  // ---- 응답 도우미 ----
  function applyCors(req: IncomingMessage, res: ServerResponse): void {
    if (allowedOrigins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return;
    }
    res.setHeader('Vary', 'Origin');
    const origin = req.headers.origin;
    if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (allowedOrigins.length === 1) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]!);
    }
  }

  function sendJson(res: ServerResponse, status: number, body: unknown, close = false): void {
    if (res.headersSent || res.writableEnded) return;
    const text = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(text));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (close) res.setHeader('Connection', 'close');
    res.end(text);
  }

  function sendError(res: ServerResponse, status: number, errors: string[], close = false): void {
    const body: ApiError = { ok: false, errors };
    sendJson(res, status, body, close);
  }

  function rankOf(entry: LeaderboardEntry): number {
    const all = store.top(entry.mode, Number.POSITIVE_INFINITY);
    const i = all.findIndex((e) => e.id === entry.id);
    return i >= 0 ? i + 1 : all.length + 1;
  }

  // ---- POST /api/submit ----
  async function handleSubmit(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req, maxBodyBytes, bodyTimeoutMs);

    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
      throw bad('요청 본문이 올바른 JSON 이 아닙니다.');
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw bad('요청 본문은 JSON 객체여야 합니다.');
    }
    // 여기서 읽는 것은 code, mode, nickname 세 가지뿐이다. 그 밖의 항목(점수 등)은 쳐다보지 않는다.
    const input = body as Record<string, unknown>;
    const rawCode = input.code;
    const mode = parseMode(input.mode);
    const nickname = cleanNickname(input.nickname);

    const errors: string[] = [];
    if (typeof rawCode !== 'string' || rawCode.length === 0) errors.push('공유 코드(code)가 없습니다.');
    if (mode === null) errors.push("모드(mode)는 'distance' 또는 'airtime' 이어야 합니다.");
    if (nickname === null) errors.push(`닉네임은 1~${NICKNAME_MAX}자로 입력해 주세요.`);
    if (errors.length > 0 || typeof rawCode !== 'string' || mode === null || nickname === null) throw bad(...errors);

    // 코드 해석(검사값, 범위 검사 포함). 잘못된 코드는 null.
    const decoded = decodeDesign(rawCode);
    if (decoded === null) throw bad('공유 코드를 읽을 수 없습니다. 코드가 잘렸거나 바뀌지 않았는지 확인해 주세요.');
    const { design, throwIn } = decoded;
    if (throwIn === undefined) throw bad('이 코드에는 던지기 값이 없습니다. 던진 뒤에 만든 코드로 등록해 주세요.');

    const valid = validateSubmission(design, throwIn);
    if (!valid.ok) throw bad(...(valid.errors.length > 0 ? valid.errors : ['설계 또는 던지기 값이 규칙에 맞지 않습니다.']));

    // 같은 입력은 항상 같은 코드가 되도록 서버가 다시 만든 코드를 기준으로 삼는다.
    const code = encodeDesign(design, throwIn);

    const respondExisting = (existing: LeaderboardEntry): SubmitResponse => ({
      ok: true, entry: existing, rank: rankOf(existing), total: store.count(mode), duplicate: true,
    });

    // 이미 등록된 것과 완전히 같으면 계산하지 않고 기존 기록을 돌려준다.
    const existing = store.findDuplicate(code, mode, nickname);
    if (existing) {
      sendJson(res, 200, respondExisting(existing));
      return;
    }

    const response = await enqueue((): SubmitResponse => {
      // 대기하는 사이 같은 제출이 먼저 처리되었을 수 있다.
      const again = store.findDuplicate(code, mode, nickname);
      if (again) return respondExisting(again);

      let result;
      try {
        result = evaluate(design, throwIn).result;
      } catch {
        throw bad('이 설계는 비행을 계산할 수 없습니다.');
      }
      const { distanceM, airtimeS, verdict } = result;
      if (!Number.isFinite(distanceM) || !Number.isFinite(airtimeS)) {
        throw bad('이 설계는 비행을 계산할 수 없습니다.');
      }
      const entry: LeaderboardEntry = {
        id: randomBytes(9).toString('base64url'),
        nickname,
        mode,
        score: mode === 'distance' ? distanceM : airtimeS,
        distanceM,
        airtimeS,
        verdict,
        code,
        createdAt: now().toISOString(),
      };
      const added = store.add(entry);
      return { ok: true, entry, rank: added.rank, total: store.count(mode) };
    });
    sendJson(res, 200, response);
  }

  // ---- GET /api/leaderboard ----
  function handleLeaderboard(url: URL, res: ServerResponse): void {
    const mode = parseMode(url.searchParams.get('mode'));
    if (mode === null) throw bad("모드(mode)는 'distance' 또는 'airtime' 이어야 합니다.");
    let limit = LEADERBOARD_DEFAULT_LIMIT;
    const rawLimit = url.searchParams.get('limit');
    if (rawLimit !== null) {
      if (!/^[0-9]{1,6}$/.test(rawLimit) || Number(rawLimit) < 1) throw bad('limit 은 1 이상의 정수여야 합니다.');
      limit = Math.min(LEADERBOARD_MAX_LIMIT, Number(rawLimit));
    }
    const body: LeaderboardResponse = { ok: true, mode, entries: store.top(mode, limit), total: store.count(mode) };
    sendJson(res, 200, body);
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    applyCors(req, res);
    const method = req.method ?? 'GET';

    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      throw bad('주소가 올바르지 않습니다.');
    }
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;

    const routes: Record<string, 'GET' | 'POST'> = {
      '/api/health': 'GET',
      '/api/leaderboard': 'GET',
      '/api/submit': 'POST',
    };
    const allowed = Object.prototype.hasOwnProperty.call(routes, path) ? routes[path] : undefined;
    if (allowed === undefined) throw new HttpError(404, ['없는 주소입니다.']);

    if (method === 'OPTIONS') {
      // 다른 출처의 화면이 보내는 사전 확인 요청
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Methods', `${allowed}, OPTIONS`);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.setHeader('Content-Length', '0');
      res.end();
      return;
    }
    if (method !== allowed) {
      res.setHeader('Allow', `${allowed}, OPTIONS`);
      throw new HttpError(405, ['이 주소에서는 쓸 수 없는 요청 방식입니다.']);
    }

    if (path === '/api/health') {
      const body: HealthResponse = { ok: true, coreVersion: CORE_VERSION };
      sendJson(res, 200, body);
    } else if (path === '/api/leaderboard') {
      handleLeaderboard(url, res);
    } else {
      await handleSubmit(req, res);
    }
  }

  return (req, res) => {
    route(req, res).catch((err: unknown) => {
      if (err instanceof HttpError) {
        sendError(res, err.status, err.errors, err.closeConnection);
        if (err.closeConnection) {
          // 남은 본문은 읽지 않고 버린다. 응답을 보낸 뒤 연결을 끊는다.
          req.resume();
          res.once('finish', () => req.socket.destroySoon());
        }
        return;
      }
      // 여기로 오는 것은 입력 문제가 아니라 서버 쪽 고장(저장소 오류 등)이다.
      console.error('[server] 처리 중 오류:', err);
      sendError(res, 500, ['서버 오류가 발생했습니다. 잠시 뒤에 다시 시도해 주세요.']);
    });
  };
}
