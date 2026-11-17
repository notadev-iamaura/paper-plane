/**
 * 랭킹 서버 테스트. 실제 HTTP 로 임시 포트에 띄운 서버에 요청을 보낸다.
 * 핵심: 서버는 입력(공유 코드)만 받아 같은 core 코드로 다시 계산하고, 자기 계산 결과만 저장한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CORE_VERSION, createApp, cleanNickname, remeasureEntry, type AppOptions } from '../server/app';
import { FileStore, MemoryStore, type Store } from '../server/store';
import { PHYSICS_VERSION, PRESETS, decodeDesign, encodeDesign, evaluate, LIMITS, type ThrowInput } from '../src/core/index';
import type { ApiError, LeaderboardEntry, LeaderboardResponse, SubmitResponse } from '../src/core/api';
import { makeLcg } from './helpers';

// ---------------------------------------------------------------------------
// 도우미
// ---------------------------------------------------------------------------

interface Running { url: string; server: Server; store: Store; close: () => Promise<void> }

async function start(options: Partial<AppOptions> = {}): Promise<Running> {
  const store = options.store ?? new MemoryStore();
  const server = createServer(createApp({ ...options, store }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    store,
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

async function post(base: string, body: unknown, raw = false): Promise<{ status: number; json: any; headers: Headers }> {
  const res = await fetch(`${base}/api/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? (body as BodyInit) : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* JSON 이 아니면 null */ }
  return { status: res.status, json, headers: res.headers };
}

async function get(base: string, path: string, init?: RequestInit): Promise<{ status: number; json: any; headers: Headers }> {
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let json: unknown = null;
  try { json = text.length > 0 ? JSON.parse(text) : null; } catch { /* 그대로 null */ }
  return { status: res.status, json, headers: res.headers };
}

function expectApiError(r: { status: number; json: any }, status: number): void {
  expect(r.status).toBe(status);
  const body = r.json as ApiError;
  expect(body.ok).toBe(false);
  expect(Array.isArray(body.errors)).toBe(true);
  expect(body.errors.length).toBeGreaterThan(0);
  for (const e of body.errors) {
    expect(typeof e).toBe('string');
    expect(e).toMatch(/[가-힣]/); // 한국어 메시지
  }
}

const preset = (id: string) => PRESETS.find((p) => p.id === id)!.design;
const th = (speedMps: number, pitchDeg: number, rollDeg = 0): ThrowInput => ({ speedMps, pitchDeg, rollDeg });
const codeOf = (id: string, t: ThrowInput): string => encodeDesign(preset(id), t);

/** 화면이 하는 것과 똑같이: 코드를 풀어 그 값으로 계산한다. */
function localResult(code: string) {
  const d = decodeDesign(code)!;
  return evaluate(d.design, d.throwIn!).result;
}

// ---------------------------------------------------------------------------
// 기본 동작
// ---------------------------------------------------------------------------

describe('랭킹 서버: 기본 동작', () => {
  let app: Running;
  beforeAll(async () => { app = await start({ now: () => new Date('2026-01-02T03:04:05.000Z') }); });
  afterAll(async () => { await app.close(); });

  it('GET /api/health', async () => {
    const r = await get(app.url, '/api/health');
    expect(r.status).toBe(200);
    // 서버가 알려 주는 core 판 번호는 물리 판 번호(PHYSICS_VERSION)다.
    expect(CORE_VERSION).toBe(PHYSICS_VERSION);
    expect(r.json).toEqual({ ok: true, coreVersion: PHYSICS_VERSION });
    expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8');
  });

  it('거리 모드 제출: 서버 결과가 같은 코드로 계산한 화면 결과와 완전히 같다', async () => {
    const code = codeOf('dart', th(6.25, 5.5));
    const r = await post(app.url, { code, mode: 'distance', nickname: '영욱' });
    expect(r.status).toBe(200);
    const body = r.json as SubmitResponse;
    const local = localResult(code);
    expect(body.ok).toBe(true);
    expect(body.entry.distanceM).toBe(local.distanceM);
    expect(body.entry.airtimeS).toBe(local.airtimeS);
    expect(body.entry.verdict).toBe(local.verdict);
    expect(body.entry.score).toBe(local.distanceM);
    expect(body.entry.mode).toBe('distance');
    expect(body.entry.nickname).toBe('영욱');
    expect(body.entry.code).toBe(code);
    expect(body.entry.createdAt).toBe('2026-01-02T03:04:05.000Z');
    expect(typeof body.entry.id).toBe('string');
    expect(body.entry.id.length).toBeGreaterThan(6);
    expect(body.rank).toBe(1);
    expect(body.total).toBe(1);
    expect(Object.keys(body.entry).sort()).toEqual(
      ['airtimeS', 'code', 'createdAt', 'distanceM', 'id', 'mode', 'nickname', 'score', 'verdict'],
    );
  });

  it('체공 모드 제출: 점수는 체공 시간이다', async () => {
    const code = codeOf('delta', th(4, 0));
    const r = await post(app.url, { code, mode: 'airtime', nickname: 'owen' });
    expect(r.status).toBe(200);
    const body = r.json as SubmitResponse;
    const local = localResult(code);
    expect(body.entry.airtimeS).toBe(local.airtimeS);
    expect(body.entry.distanceM).toBe(local.distanceM);
    expect(body.entry.score).toBe(local.airtimeS);
    expect(body.entry.mode).toBe('airtime');
    expect(body.rank).toBe(1);
    expect(body.total).toBe(1); // 모드별로 따로 센다
  });

  it('반올림 전 값으로 만든 코드도 서버는 코드에 담긴(반올림된) 값으로 계산한다', async () => {
    // 화면이 0.01 m/s, 0.1 도보다 잔 값을 갖고 있어도 코드에 담기면 반올림된다.
    const code = encodeDesign(preset('hybrid'), th(5.123456, 3.14159, -0.04));
    const decoded = decodeDesign(code)!;
    expect(decoded.throwIn).toEqual({ speedMps: 5.12, pitchDeg: 3.1, rollDeg: 0 });
    const r = await post(app.url, { code, mode: 'distance', nickname: 'round' });
    expect(r.status).toBe(200);
    expect((r.json as SubmitResponse).entry.distanceM).toBe(evaluate(decoded.design, decoded.throwIn!).result.distanceM);
  });

  it('닉네임은 앞뒤 공백과 제어 문자를 지우고 저장한다', async () => {
    const code = codeOf('dart', th(4, 0));
    const r = await post(app.url, { code, mode: 'distance', nickname: '  종이\u0000비\u001b행\u007f기\n ' });
    expect(r.status).toBe(200);
    expect((r.json as SubmitResponse).entry.nickname).toBe('종이비행기');
    expect(cleanNickname('가'.repeat(16))).toBe('가'.repeat(16));
    expect(cleanNickname('가'.repeat(17))).toBeNull();
    expect(cleanNickname('😀'.repeat(16))).toBe('😀'.repeat(16)); // 글자 수는 코드 포인트로 센다
    expect(cleanNickname(' \u0000\t ')).toBeNull();
    expect(cleanNickname(123)).toBeNull();
    expect(cleanNickname('a\ud800b')).toBe('ab'); // 깨진 글자 제거
  });

  it('없는 주소는 404, 맞지 않는 방식은 405', async () => {
    expectApiError(await get(app.url, '/'), 404);
    expectApiError(await get(app.url, '/api/nope'), 404);
    expectApiError(await get(app.url, '/api/submit/extra'), 404);
    const r1 = await get(app.url, '/api/submit');
    expectApiError(r1, 405);
    expect(r1.headers.get('allow')).toContain('POST');
    expectApiError(await get(app.url, '/api/leaderboard?mode=distance', { method: 'POST', body: '{}' }), 405);
    expectApiError(await get(app.url, '/api/health', { method: 'DELETE' }), 405);
    expectApiError(await get(app.url, '/api/submit', { method: 'PUT', body: '{}' }), 405);
  });
});

// ---------------------------------------------------------------------------
// 조작 방지
// ---------------------------------------------------------------------------

describe('랭킹 서버: 조작 방지(서버 재계산)', () => {
  let app: Running;
  beforeAll(async () => { app = await start(); });
  afterAll(async () => { await app.close(); });

  it('본문에 가짜 점수를 넣어도 아무 영향이 없다', async () => {
    const code = codeOf('dart', th(5, 2));
    const local = localResult(code);
    const forged = {
      code, mode: 'distance', nickname: 'cheater',
      score: 99999, distanceM: 99999, airtimeS: 99999, verdict: 'glide', rank: 1,
      id: 'forged-id', createdAt: '1999-01-01T00:00:00.000Z',
      entry: { score: 99999, distanceM: 99999 }, result: { distanceM: 99999, airtimeS: 99999 },
      design: { v: 1 }, throwIn: { speedMps: 16, pitchDeg: 45, rollDeg: 0 },
    };
    const r = await post(app.url, forged);
    expect(r.status).toBe(200);
    const body = r.json as SubmitResponse;
    expect(body.entry.score).toBe(local.distanceM);
    expect(body.entry.distanceM).toBe(local.distanceM);
    expect(body.entry.airtimeS).toBe(local.airtimeS);
    expect(body.entry.verdict).toBe(local.verdict);
    expect(body.entry.id).not.toBe('forged-id');
    expect(body.entry.createdAt).not.toBe('1999-01-01T00:00:00.000Z');
    expect(body.entry.score).toBeLessThan(100);

    // 정직한 제출과 저장 결과가 같다(닉네임만 다르게 해서 따로 등록).
    const honest = await post(app.url, { code, mode: 'distance', nickname: 'honest' });
    expect((honest.json as SubmitResponse).entry.score).toBe(body.entry.score);

    const board = (await get(app.url, '/api/leaderboard?mode=distance')).json as LeaderboardResponse;
    expect(board.entries.length).toBe(2);
    for (const e of board.entries) expect(e.score).toBe(local.distanceM);
    expect(JSON.stringify(board)).not.toContain('99999');
  });

  it('읽을 수 없는 코드는 400', async () => {
    for (const code of ['hello', 'P1', 'P1zzzzzzzzzzzzzzzzzz', 'P2' + codeOf('dart', th(5, 0)).slice(2), '한글코드', 'P1!!!!', 'x'.repeat(2000)]) {
      expectApiError(await post(app.url, { code, mode: 'distance', nickname: 'a' }), 400);
    }
    for (const code of [null, 123, {}, [], true, '']) {
      expectApiError(await post(app.url, { code, mode: 'distance', nickname: 'a' }), 400);
    }
    expect(app.store.count('distance')).toBe(2); // 앞 테스트의 두 건뿐
  });

  it('한 글자라도 바꾼 코드는 검사값에 걸려 400', async () => {
    const code = codeOf('glider', th(4, 5));
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const before = app.store.count('distance');
    const step = Math.max(1, Math.floor((code.length - 2) / 12));
    let tried = 0;
    for (let i = 2; i < code.length; i += step) {
      const ch = code[i]!;
      const other = alphabet[(alphabet.indexOf(ch) + 1) % alphabet.length]!;
      const tampered = code.slice(0, i) + other + code.slice(i + 1);
      expect(tampered).not.toBe(code);
      expect(decodeDesign(tampered), `위치 ${i}`).toBeNull();
      expectApiError(await post(app.url, { code: tampered, mode: 'distance', nickname: 'tamper' }), 400);
      tried++;
    }
    expect(tried).toBeGreaterThanOrEqual(10);
    // 잘린 코드, 글자가 덧붙은 코드
    expectApiError(await post(app.url, { code: code.slice(0, -1), mode: 'distance', nickname: 'tamper' }), 400);
    expectApiError(await post(app.url, { code: code + '0', mode: 'distance', nickname: 'tamper' }), 400);
    expect(app.store.count('distance')).toBe(before);
  });

  it('던지기 값이 없는 코드는 400', async () => {
    const code = encodeDesign(preset('dart'));
    expect(decodeDesign(code)).not.toBeNull();
    const r = await post(app.url, { code, mode: 'distance', nickname: 'a' });
    expectApiError(r, 400);
    expect((r.json as ApiError).errors.join(' ')).toContain('던지기');
  });

  it('한도를 벗어난 던지기 값은 코드로 만들어도 받아들여지지 않는다', async () => {
    const outOfRange: ThrowInput[] = [
      th(LIMITS.throwSpeedMax + 0.01, 0), th(16, 10), th(100, 10), th(327, 45), th(LIMITS.throwSpeedMin - 0.01, 0), th(0, 0), th(-5, 0),
      th(8, LIMITS.pitchMax + 0.1), th(8, LIMITS.pitchMin - 0.1), th(8, 90),
      th(8, 0, LIMITS.rollMax + 0.1), th(8, 0, LIMITS.rollMin - 0.1),
      th(Number.NaN, 0), th(Number.POSITIVE_INFINITY, 0),
    ];
    for (const t of outOfRange) {
      const code = encodeDesign(preset('dart'), t);
      // (물리 2판: 범위를 벗어난 던지기가 든 코드는 통째로 버리지 않고 설계만 돌려준다. 던지기는 "없음"이고,
      //  한도 안으로 잘라 주지 않는다. 그래서 서버는 예전처럼 400 으로 거절한다. 한도는 16 -> 10 m/s 로 바뀌었다.)
      const dec = decodeDesign(code);
      expect(dec, JSON.stringify(t)).not.toBeNull();
      expect(dec!.design, JSON.stringify(t)).toEqual(preset('dart'));
      expect(dec!.throwIn, JSON.stringify(t)).toBeUndefined();
      expect(dec!.throwOutOfRange, JSON.stringify(t)).toBeDefined();
      expectApiError(await post(app.url, { code, mode: 'distance', nickname: 'a' }), 400);
    }
    // 한도 끝 값은 받아들인다.
    const edge = encodeDesign(preset('dart'), th(LIMITS.throwSpeedMin, LIMITS.pitchMin, LIMITS.rollMin));
    expect((await post(app.url, { code: edge, mode: 'airtime', nickname: 'edge' })).status).toBe(200);
  });

  it('규칙을 벗어난 설계(범위 밖 마무리 값)는 코드로 만들어도 400', async () => {
    const base = preset('dart');
    const bad = { ...base, shaping: { ...base.shaping, elevatorDeg: 60 } };
    expectApiError(await post(app.url, { code: encodeDesign(bad, th(6, 0)), mode: 'distance', nickname: 'a' }), 400);
    const badKeel = { ...base, shaping: { ...base.shaping, keelM: 0.5 } };
    expectApiError(await post(app.url, { code: encodeDesign(badKeel, th(6, 0)), mode: 'distance', nickname: 'a' }), 400);
  });
});

// ---------------------------------------------------------------------------
// 잘못된 입력
// ---------------------------------------------------------------------------

describe('랭킹 서버: 잘못된 입력', () => {
  let app: Running;
  const good = codeOf('dart', th(4.5, 0));
  beforeAll(async () => { app = await start(); });
  afterAll(async () => { await app.close(); });

  it('JSON 이 아니거나 객체가 아니면 400', async () => {
    for (const raw of ['', '{', 'not json', '[]', '"text"', '123', 'null', 'true', '{"code":', "{'code':1}"]) {
      expectApiError(await post(app.url, raw, true), 400);
    }
    // 깨진 UTF-8
    expectApiError(await post(app.url, new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]), true), 400);
  });

  it('필수 항목이 없거나 모드, 닉네임이 틀리면 400', async () => {
    expectApiError(await post(app.url, {}), 400);
    expectApiError(await post(app.url, { mode: 'distance', nickname: 'a' }), 400);
    expectApiError(await post(app.url, { code: good, nickname: 'a' }), 400);
    expectApiError(await post(app.url, { code: good, mode: 'distance' }), 400);
    for (const mode of ['speed', 'DISTANCE', '', null, 1, ['distance'], { a: 1 }]) {
      expectApiError(await post(app.url, { code: good, mode, nickname: 'a' }), 400);
    }
    for (const nickname of ['', '   ', '\u0000\u0001', 'x'.repeat(17), 'x'.repeat(5000), null, 7, ['a'], { toString: 'x' }]) {
      expectApiError(await post(app.url, { code: good, mode: 'distance', nickname }), 400);
    }
    // 여러 항목이 틀리면 메시지도 여러 개
    const r = await post(app.url, { code: 5, mode: 'x', nickname: '' });
    expect((r.json as ApiError).errors.length).toBe(3);
    expect(app.store.count('distance') + app.store.count('airtime')).toBe(0);
  });

  it('8 KB 를 넘는 본문은 413', async () => {
    const big = JSON.stringify({ code: good, mode: 'distance', nickname: 'a', pad: 'x'.repeat(20_000) });
    expectApiError(await post(app.url, big, true), 413);
    // 한도 바로 아래는 크기 때문에 거절되지 않는다(내용이 맞으므로 등록된다).
    const head = JSON.stringify({ code: good, mode: 'distance', nickname: 'pad', pad: '' });
    const ok = head.replace('"pad":""', `"pad":"${'x'.repeat(8 * 1024 - Buffer.byteLength(head))}"`);
    expect(Buffer.byteLength(ok)).toBe(8 * 1024);
    expect((await post(app.url, ok, true)).status).toBe(200);
    const over = ok.replace('"pad":"', '"pad":"x');
    expect(Buffer.byteLength(over)).toBe(8 * 1024 + 1);
    expectApiError(await post(app.url, over, true), 413);
  });

  it('길이를 밝히지 않고 조각조각 보내는 큰 본문도 413 으로 끊는다', async () => {
    const port = (app.server.address() as AddressInfo).port;
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/api/submit', method: 'POST' }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', (err) => reject(err));
      let sent = 0;
      const pump = (): void => {
        if (sent >= 40 || req.destroyed) { if (!req.destroyed) req.end(); return; }
        sent++;
        req.write('x'.repeat(1024), () => setTimeout(pump, 1));
      };
      pump();
    });
    expect(status).toBe(413);
  });

  it('본문을 다 보내지 않고 버티면 408 로 끊는다', async () => {
    const slow = await start({ bodyTimeoutMs: 150 });
    try {
      const port = (slow.server.address() as AddressInfo).port;
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest({
          host: '127.0.0.1', port, path: '/api/submit', method: 'POST', headers: { 'Content-Length': '100' },
        }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
        req.on('error', (err) => reject(err));
        req.write('{"code":');
      });
      expect(status).toBe(408);
    } finally {
      await slow.close();
    }
  });

  it('엉터리 본문을 아무리 보내도 500 은 나오지 않는다', async () => {
    const rnd = makeLcg(20261113);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const junkValue = (depth: number): unknown => {
      const k = Math.floor(rnd() * 12);
      if (k === 0) return null;
      if (k === 1) return rnd() < 0.5;
      if (k === 2) return (rnd() - 0.5) * 10 ** Math.floor(rnd() * 20);
      if (k === 3) return pick(['', 'distance', 'airtime', '__proto__', 'constructor', '\u0000', '😀'.repeat(9), 'P1' + 'A'.repeat(Math.floor(rnd() * 500)), good, good.slice(0, Math.floor(rnd() * good.length)), good + good]);
      if (k === 4 && depth < 4) return Array.from({ length: Math.floor(rnd() * 5) }, () => junkValue(depth + 1));
      if (k === 5 && depth < 4) {
        const o: Record<string, unknown> = {};
        for (let i = 0; i < Math.floor(rnd() * 5); i++) o[pick(['code', 'mode', 'nickname', 'score', 'a', 'toString', 'length', 'v'])] = junkValue(depth + 1);
        return o;
      }
      if (k === 6) return String.fromCharCode(...Array.from({ length: Math.floor(rnd() * 40) }, () => Math.floor(rnd() * 0xffff)));
      if (k === 7) return 1e308 * 10; // JSON 으로는 null
      if (k === 8) return good.split('').sort(() => rnd() - 0.5).join('');
      return pick([good, 'distance', 'airtime', 'nick', 0, -1, 1e21]);
    };
    const bodies: (string | Uint8Array)[] = [];
    for (let i = 0; i < 160; i++) {
      const kind = i % 4;
      if (kind === 0) {
        bodies.push(Uint8Array.from({ length: Math.floor(rnd() * 300) }, () => Math.floor(rnd() * 256)));
      } else if (kind === 1) {
        bodies.push(JSON.stringify(junkValue(0)) ?? 'undefined');
      } else if (kind === 2) {
        bodies.push(JSON.stringify({ code: junkValue(1), mode: junkValue(1), nickname: junkValue(1), score: junkValue(1) }));
      } else {
        const text = JSON.stringify({ code: good, mode: 'distance', nickname: 'fuzz' });
        const cut = Math.floor(rnd() * text.length);
        bodies.push(rnd() < 0.5 ? text.slice(0, cut) : text.slice(0, cut) + pick(['}', '"', '\\', '\u0000', '{{', ']']) + text.slice(cut));
      }
    }
    // 특별한 모양 몇 가지
    bodies.push('{"__proto__":{"code":"x"},"code":"x","mode":"distance","nickname":"a"}');
    bodies.push('{"code":{"length":5},"mode":"distance","nickname":"a"}');
    bodies.push('['.repeat(3000) + ']'.repeat(3000));
    bodies.push('{"a":'.repeat(1000) + '1' + '}'.repeat(1000));
    bodies.push(`{"code":"${good}","mode":"distance","nickname":"a","code":123}`);
    bodies.push('﻿{}');

    const statuses = new Map<number, number>();
    for (const body of bodies) {
      const r = await post(app.url, body, true);
      statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
      expect(r.status, typeof body === 'string' ? body.slice(0, 80) : 'bytes').not.toBe(500);
      expect([200, 400, 413]).toContain(r.status);
      expect(r.json, 'JSON 응답').not.toBeNull();
      if (r.status !== 200) expectApiError(r, r.status);
    }
    expect(statuses.get(400)).toBeGreaterThan(150);

    // 주소와 방식도 엉터리로
    for (const path of ['/api/submit?x=%', '/api/leaderboard?mode=%ff', '/api/leaderboard?mode=distance&limit=1e9', '//', '/api/../etc/passwd', '/api/leaderboard?' + 'a=1&'.repeat(500), '/%00']) {
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        const r = await get(app.url, path, { method, body: method === 'GET' ? undefined : '{' });
        expect(r.status, `${method} ${path}`).toBeGreaterThanOrEqual(400);
        expect(r.status, `${method} ${path}`).toBeLessThan(500);
        expect((r.json as ApiError).ok).toBe(false);
      }
    }
    // 서버는 여전히 살아 있다.
    expect((await get(app.url, '/api/health')).status).toBe(200);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 랭킹
// ---------------------------------------------------------------------------

describe('랭킹 서버: 중복, 순서, 개수', () => {
  let app: Running;
  let tick = 0;
  beforeAll(async () => {
    app = await start({ now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)) });
  });
  afterAll(async () => { await app.close(); });

  it('완전히 같은 제출(코드, 모드, 닉네임)은 새로 넣지 않고 기존 기록을 돌려준다', async () => {
    const code = codeOf('dart', th(5, 0));
    const a = (await post(app.url, { code, mode: 'distance', nickname: 'dup' })).json as SubmitResponse;
    const b = (await post(app.url, { code, mode: 'distance', nickname: '  dup  ' })).json as SubmitResponse;
    expect(a.duplicate).toBeUndefined();
    expect(b.duplicate).toBe(true);
    expect(b.entry).toEqual(a.entry);
    expect(b.rank).toBe(a.rank);
    expect(b.total).toBe(1);
    expect(app.store.count('distance')).toBe(1);

    // 닉네임이나 모드가 다르면 새 기록
    const c = (await post(app.url, { code, mode: 'distance', nickname: 'dup2' })).json as SubmitResponse;
    expect(c.entry.id).not.toBe(a.entry.id);
    expect(c.total).toBe(2);
    expect(c.rank).toBe(2); // 같은 점수면 먼저 등록한 쪽이 위
    const d = (await post(app.url, { code, mode: 'airtime', nickname: 'dup' })).json as SubmitResponse;
    expect(d.entry.id).not.toBe(a.entry.id);
    expect(app.store.count('airtime')).toBe(1);

    // 동시에 같은 제출이 여러 번 와도 하나만 들어간다.
    const code2 = codeOf('dart', th(5.5, 0));
    const many = await Promise.all(Array.from({ length: 5 }, () => post(app.url, { code: code2, mode: 'distance', nickname: 'same' })));
    const ids = new Set(many.map((r) => (r.json as SubmitResponse).entry.id));
    expect(many.every((r) => r.status === 200)).toBe(true);
    expect(ids.size).toBe(1);
    expect(app.store.count('distance')).toBe(3);
  });

  it('랭킹은 점수 높은 순이고 limit 을 지킨다', async () => {
    for (const [i, speed] of [3, 7, 4, 6, 8].entries()) {
      const r = await post(app.url, { code: codeOf('dart', th(speed, 0)), mode: 'distance', nickname: `p${i}` });
      expect(r.status).toBe(200);
    }
    const all = (await get(app.url, '/api/leaderboard?mode=distance')).json as LeaderboardResponse;
    expect(all.ok).toBe(true);
    expect(all.mode).toBe('distance');
    expect(all.total).toBe(8);
    expect(all.entries.length).toBe(8);
    for (let i = 1; i < all.entries.length; i++) {
      const prev = all.entries[i - 1]!, cur = all.entries[i]!;
      expect(prev.score).toBeGreaterThanOrEqual(cur.score);
      if (prev.score === cur.score) expect(prev.createdAt < cur.createdAt).toBe(true);
    }
    expect(all.entries[0]!.nickname).toBe('p4'); // 8 m/s 로 던진 기록이 가장 멀다
    for (const e of all.entries) {
      expect(e.mode).toBe('distance');
      expect(e.score).toBe(e.distanceM);
      expect(e.score).toBe(localResult(e.code).distanceM); // 저장된 코드로 누구나 재현할 수 있다
    }

    const top3 = (await get(app.url, '/api/leaderboard?mode=distance&limit=3')).json as LeaderboardResponse;
    expect(top3.entries).toEqual(all.entries.slice(0, 3));
    expect(top3.total).toBe(8);
    const top1 = (await get(app.url, '/api/leaderboard?mode=distance&limit=1')).json as LeaderboardResponse;
    expect(top1.entries.length).toBe(1);
    const huge = await get(app.url, '/api/leaderboard?mode=distance&limit=99999');
    expect(huge.status).toBe(200); // 최대 100 으로 줄여서 준다

    const air = (await get(app.url, '/api/leaderboard?mode=airtime')).json as LeaderboardResponse;
    expect(air.entries.length).toBe(1);
    expect(air.entries[0]!.score).toBe(air.entries[0]!.airtimeS);

    // 새 기록의 순위가 랭킹 속 위치와 같다.
    const mid = (await post(app.url, { code: codeOf('dart', th(6.5, 0)), mode: 'distance', nickname: 'mid' })).json as SubmitResponse;
    const after = (await get(app.url, '/api/leaderboard?mode=distance')).json as LeaderboardResponse;
    expect(after.entries[mid.rank - 1]!.id).toBe(mid.entry.id);
    expect(mid.total).toBe(9);
  });

  it('랭킹 조회의 잘못된 값은 400', async () => {
    expectApiError(await get(app.url, '/api/leaderboard'), 400);
    expectApiError(await get(app.url, '/api/leaderboard?mode=speed'), 400);
    for (const limit of ['0', '-1', 'abc', '1.5', '', '1e3', ' 5']) {
      expectApiError(await get(app.url, `/api/leaderboard?mode=distance&limit=${encodeURIComponent(limit)}`), 400);
    }
  });
});

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

describe('랭킹 서버: 다른 출처 허용(CORS)', () => {
  it('기본은 모든 출처 허용이고 오류 응답에도 머리말이 붙는다', async () => {
    const app = await start();
    try {
      expect((await get(app.url, '/api/health')).headers.get('access-control-allow-origin')).toBe('*');
      expect((await get(app.url, '/api/leaderboard?mode=distance')).headers.get('access-control-allow-origin')).toBe('*');
      expect((await post(app.url, '{', true)).headers.get('access-control-allow-origin')).toBe('*');
      expect((await get(app.url, '/nope')).headers.get('access-control-allow-origin')).toBe('*');

      const pre = await get(app.url, '/api/submit', {
        method: 'OPTIONS',
        headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
      });
      expect(pre.status).toBe(204);
      expect(pre.headers.get('access-control-allow-origin')).toBe('*');
      expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
      expect(pre.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('content-type');
      expect(pre.headers.get('access-control-max-age')).toBe('86400');
      const preGet = await get(app.url, '/api/leaderboard', { method: 'OPTIONS' });
      expect(preGet.status).toBe(204);
      expect(preGet.headers.get('access-control-allow-methods')).toContain('GET');
    } finally {
      await app.close();
    }
  });

  it('CORS_ORIGIN 을 정하면 그 출처만 허용한다', async () => {
    const app = await start({ corsOrigin: 'https://plane.example' });
    const multi = await start({ corsOrigin: 'https://a.example, https://b.example' });
    try {
      const r = await get(app.url, '/api/health', { headers: { Origin: 'https://evil.example' } });
      expect(r.headers.get('access-control-allow-origin')).toBe('https://plane.example');
      expect(r.headers.get('vary')).toBe('Origin');

      const b = await get(multi.url, '/api/health', { headers: { Origin: 'https://b.example' } });
      expect(b.headers.get('access-control-allow-origin')).toBe('https://b.example');
      const evil = await get(multi.url, '/api/health', { headers: { Origin: 'https://evil.example' } });
      expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await app.close();
      await multi.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 계산 비용 보호
// ---------------------------------------------------------------------------

describe('랭킹 서버: 대기열', () => {
  it('대기열이 차면 503 으로 거절하고, 받은 것은 모두 정확히 처리한다', async () => {
    const app = await start({ maxQueue: 2 });
    try {
      const codes = Array.from({ length: 8 }, (_, i) => codeOf('dart', th(4 + i * 0.25, 0)));
      // 연결을 따로따로 열어 여덟 건을 한꺼번에 보낸다.
      const port = (app.server.address() as AddressInfo).port;
      const rawPost = (body: unknown): Promise<{ status: number; json: any }> => new Promise((resolve, reject) => {
        const text = JSON.stringify(body);
        const req = httpRequest({
          host: '127.0.0.1', port, path: '/api/submit', method: 'POST', agent: false,
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) },
        }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
        });
        req.on('error', reject);
        req.end(text);
      });
      const results = await Promise.all(codes.map((code, i) => rawPost({ code, mode: 'distance', nickname: `q${i}` })));
      const ok = results.filter((r) => r.status === 200);
      const busy = results.filter((r) => r.status === 503);
      expect(ok.length + busy.length).toBe(results.length);
      expect(ok.length).toBeGreaterThanOrEqual(1);
      expect(busy.length).toBeGreaterThanOrEqual(1);
      for (const r of busy) expectApiError(r, 503);
      for (const r of ok) {
        const e = (r.json as SubmitResponse).entry;
        expect(e.score).toBe(localResult(e.code).distanceM);
      }
      expect(app.store.count('distance')).toBe(ok.length);
      // 몰림이 지나가면 다시 받는다.
      const again = await post(app.url, { code: codes[7]!, mode: 'distance', nickname: 'later' });
      expect(again.status).toBe(200);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 저장소
// ---------------------------------------------------------------------------

describe('저장소', () => {
  const entry = (i: number, score: number, mode: 'distance' | 'airtime' = 'distance'): LeaderboardEntry => ({
    id: `id${i}`, nickname: `n${i}`, mode, score, distanceM: score, airtimeS: 1, verdict: 'glide',
    code: `code${i}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  });

  it('메모리 저장소: 모드별 한도를 넘으면 가장 좋은 기록만 남긴다', () => {
    const s = new MemoryStore(3);
    expect(s.add(entry(1, 5))).toEqual({ rank: 1, stored: true });
    expect(s.add(entry(2, 9))).toEqual({ rank: 1, stored: true });
    expect(s.add(entry(3, 7))).toEqual({ rank: 2, stored: true });
    expect(s.add(entry(4, 1))).toEqual({ rank: 4, stored: false }); // 한도 밖
    expect(s.count('distance')).toBe(3);
    expect(s.add(entry(5, 8))).toEqual({ rank: 2, stored: true }); // 5점 기록이 밀려난다
    expect(s.top('distance', 10).map((e) => e.score)).toEqual([9, 8, 7]);
    expect(s.findDuplicate('code1', 'distance', 'n1')).toBeUndefined(); // 밀려난 기록
    expect(s.findDuplicate('code2', 'distance', 'n2')?.id).toBe('id2');
    expect(s.findDuplicate('code2', 'airtime', 'n2')).toBeUndefined();
    expect(s.add(entry(6, 8))).toEqual({ rank: 3, stored: true }); // 동점은 나중 것이 아래
    expect(s.count('airtime')).toBe(0);
    s.add(entry(7, 3, 'airtime'));
    expect(s.count('airtime')).toBe(1);
    // 돌려준 값을 고쳐도 저장소 안은 바뀌지 않는다.
    s.top('distance', 1)[0]!.score = -1;
    expect(s.top('distance', 1)[0]!.score).toBe(9);
  });

  it('파일 저장소: 서버를 껐다 켜도 기록이 남는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paper-plane-'));
    const file = join(dir, 'nested', 'ranking.json');
    try {
      const first = await start({ store: new FileStore(file) });
      const a = (await post(first.url, { code: codeOf('dart', th(6, 0)), mode: 'distance', nickname: '첫째' })).json as SubmitResponse;
      const b = (await post(first.url, { code: codeOf('glider', th(4, 0)), mode: 'airtime', nickname: '둘째' })).json as SubmitResponse;
      const c = (await post(first.url, { code: codeOf('hybrid', th(5, 0)), mode: 'distance', nickname: '셋째' })).json as SubmitResponse;
      const boardBefore = (await get(first.url, '/api/leaderboard?mode=distance')).json as LeaderboardResponse;
      await first.close();

      expect(existsSync(file)).toBe(true);
      expect(readdirSync(join(dir, 'nested'))).toEqual(['ranking.json']); // 임시 파일이 남지 않는다
      const onDisk = JSON.parse(readFileSync(file, 'utf8')) as { v: number; entries: LeaderboardEntry[] };
      expect(onDisk.v).toBe(1);
      expect(onDisk.entries.length).toBe(3);

      const second = await start({ store: new FileStore(file) });
      try {
        const board = (await get(second.url, '/api/leaderboard?mode=distance')).json as LeaderboardResponse;
        expect(board).toEqual(boardBefore);
        expect(board.entries.map((e) => e.id).sort()).toEqual([a.entry.id, c.entry.id].sort());
        const air = (await get(second.url, '/api/leaderboard?mode=airtime')).json as LeaderboardResponse;
        expect(air.entries).toEqual([b.entry]);
        // 다시 켠 뒤에도 중복은 기존 기록을 돌려준다.
        const dup = (await post(second.url, { code: a.entry.code, mode: 'distance', nickname: '첫째' })).json as SubmitResponse;
        expect(dup.duplicate).toBe(true);
        expect(dup.entry).toEqual(a.entry);
        expect(second.store.count('distance')).toBe(2);
      } finally {
        await second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('파일 저장소: 손상된 파일이나 이상한 줄이 있어도 죽지 않는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paper-plane-'));
    try {
      const broken = join(dir, 'broken.json');
      writeFileSync(broken, '{"v":1,"entries":[{"id":');
      const s1 = new FileStore(broken);
      expect(s1.count('distance')).toBe(0);
      expect(readdirSync(dir).some((f) => f.startsWith('broken.json.corrupt-'))).toBe(true); // 원본은 옆에 보관
      s1.add(entry(1, 3));
      expect(new FileStore(broken).count('distance')).toBe(1);

      const mixed = join(dir, 'mixed.json');
      writeFileSync(mixed, JSON.stringify({ v: 1, entries: [entry(1, 4), null, 'x', { id: 'bad' }, { ...entry(2, 5), score: 'NaN' }, entry(3, 6, 'airtime')] }));
      const s2 = new FileStore(mixed);
      expect(s2.count('distance')).toBe(1);
      expect(s2.count('airtime')).toBe(1);

      const capped = join(dir, 'capped.json');
      const s3 = new FileStore(capped, 2);
      for (let i = 0; i < 5; i++) s3.add(entry(i, i));
      expect(new FileStore(capped, 2).top('distance', 10).map((e) => e.score)).toEqual([4, 3]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('파일 저장소: 옛 물리 판의 파일은 켤 때 코드로 다시 계산하고, 더는 던질 수 없는 기록은 버린다(새 점수와 섞이지 않는다)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paper-plane-'));
    const file = join(dir, 'ranking.json');
    try {
      const at = (i: number): string => new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
      const row = (i: number, code: string, mode: 'distance' | 'airtime', distanceM: number, airtimeS: number): LeaderboardEntry => ({
        id: `old${i}`, nickname: `옛${i}`, mode, score: mode === 'distance' ? distanceM : airtimeS, distanceM, airtimeS, verdict: 'glide', code, createdAt: at(i),
      });
      const dartCode = codeOf('dart', th(8, 0)), gliderCode = codeOf('glider', th(5, 5));
      // 던지기 한도가 16 m/s 이던 때의 14 m/s 던지기: 지금은 코드를 풀어도 던지기 값이 나오지 않는다.
      const tooStrong = codeOf('dart', th(14, 10));
      expect(LIMITS.throwSpeedMax).toBeLessThan(14);
      expect(decodeDesign(tooStrong)!.throwIn).toBeUndefined();
      const designOnly = encodeDesign(preset('hybrid'));
      // 옛 규칙의 숫자(지금 계산과 다르다). 물리 판 번호가 없는 파일 = 1판 서버가 쓴 파일.
      const old = [
        row(1, tooStrong, 'distance', 31.5, 3.3),
        row(2, dartCode, 'distance', 24.0, 2.9),
        row(3, gliderCode, 'distance', 9.0, 4.0),
        row(4, gliderCode, 'airtime', 9.0, 4.0),
        row(5, 'not-a-code', 'airtime', 5, 9.9),
        row(6, designOnly, 'airtime', 5, 8.8),
      ];
      writeFileSync(file, JSON.stringify({ v: 1, entries: old }));

      let calls = 0;
      const remeasure = { version: PHYSICS_VERSION, recompute: (e: LeaderboardEntry) => { calls++; return remeasureEntry(e); } };
      const s1 = new FileStore(file, undefined, remeasure);
      expect(calls).toBe(old.length);
      expect(s1.migrated).toEqual({ from: null, to: PHYSICS_VERSION, kept: 3, dropped: 3 });

      const dartNow = localResult(dartCode), gliderNow = localResult(gliderCode);
      const dist = s1.top('distance', 10), air = s1.top('airtime', 10);
      // 남은 기록은 지금의 core 값 그대로이고, 새 점수로 다시 줄을 선다. id, 닉네임, 시각은 그대로다.
      expect(dist.map((e) => e.id).sort()).toEqual(['old2', 'old3']);
      expect(dist[0]!.score).toBeGreaterThanOrEqual(dist[1]!.score);
      const d2 = dist.find((e) => e.id === 'old2')!, d3 = dist.find((e) => e.id === 'old3')!;
      expect(d2).toEqual({ ...old[1]!, score: dartNow.distanceM, distanceM: dartNow.distanceM, airtimeS: dartNow.airtimeS, verdict: dartNow.verdict });
      expect(d3).toEqual({ ...old[2]!, score: gliderNow.distanceM, distanceM: gliderNow.distanceM, airtimeS: gliderNow.airtimeS, verdict: gliderNow.verdict });
      expect(d2.score).not.toBe(24.0);
      expect(air).toEqual([{ ...old[3]!, score: gliderNow.airtimeS, distanceM: gliderNow.distanceM, airtimeS: gliderNow.airtimeS, verdict: gliderNow.verdict }]);
      // 버린 기록의 코드로는 중복도 찾지 못한다.
      expect(s1.findDuplicate(tooStrong, 'distance', '옛1')).toBeUndefined();

      // 파일은 새 판 번호와 함께 다시 적히고, 옛 파일은 옆에 보관된다.
      const onDisk = JSON.parse(readFileSync(file, 'utf8')) as { v: number; physics: number; entries: LeaderboardEntry[] };
      expect(onDisk.v).toBe(1);
      expect(onDisk.physics).toBe(PHYSICS_VERSION);
      expect(onDisk.entries.map((e) => e.id).sort()).toEqual(['old2', 'old3', 'old4']);
      expect(JSON.parse(readFileSync(`${file}.physics-none`, 'utf8'))).toEqual({ v: 1, entries: old });

      // 다시 켜면 다시 계산하지 않는다. 그 서버에 새 기록을 올리면 옛 기록과 같은 규칙의 점수로 나란히 선다.
      calls = 0;
      const second = await start({ store: new FileStore(file, undefined, remeasure) });
      try {
        expect(calls).toBe(0);
        expect((second.store as FileStore).migrated).toBeNull();
        const fresh = (await post(second.url, { code: dartCode, mode: 'distance', nickname: '새 친구' })).json as SubmitResponse;
        expect(fresh.entry.score).toBe(d2.score);
        const board = (await get(second.url, '/api/leaderboard?mode=distance')).json as LeaderboardResponse;
        expect(board.entries.map((e) => e.id)).toEqual(d2.score >= d3.score ? ['old2', fresh.entry.id, 'old3'] : ['old3', 'old2', fresh.entry.id]);
        for (const e of board.entries) expect(e.score, e.id).toBe(localResult(e.code).distanceM);
      } finally {
        await second.close();
      }

      // 더 옛 번호가 적힌 파일도 같다(번호가 지금과 다르면 다시 잰다).
      const file2 = join(dir, 'v1.json');
      writeFileSync(file2, JSON.stringify({ v: 1, physics: PHYSICS_VERSION - 1, entries: [old[0], old[1]] }));
      const s3 = new FileStore(file2, undefined, remeasure);
      expect(s3.migrated).toEqual({ from: PHYSICS_VERSION - 1, to: PHYSICS_VERSION, kept: 1, dropped: 1 });
      expect(s3.top('distance', 10).map((e) => [e.id, e.score])).toEqual([['old2', dartNow.distanceM]]);
      expect(existsSync(`${file2}.physics-${PHYSICS_VERSION - 1}`)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
