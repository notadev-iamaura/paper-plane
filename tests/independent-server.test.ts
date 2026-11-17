/**
 * 독립 검증(리뷰어 작성): 랭킹 서버 공격 시험.
 * 유일한 조작 방지 수단은 "입력 검사 + 서버 재계산"이다. 그래서 확인할 것은 세 가지다.
 *  1) 저장된 점수는 언제나 저장된 코드를 직접 evaluate 한 값과 같다.
 *  2) 어떤 입력에도 500 이 나오거나 서버가 죽지 않는다.
 *  3) 제출 한 건이 CPU 를 1초 넘게 붙잡지 못한다.
 * 공유 코드는 core 의 encodeDesign 을 거치지 않고 바이트를 직접 짜서도 만든다(아래 rawCode).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { createApp } from '../server/app';
import { MemoryStore } from '../server/store';
import {
  LIMITS, PAPERS, PRESETS, decodeDesign, encodeDesign, evaluate, validateDesign,
  type FoldOp, type PlaneDesign, type ThrowInput,
} from '../src/core/index';

// ---------------------------------------------------------------------------
// 코드 직접 짜기 (codec.ts 머리말의 바이트 구성을 보고 따로 구현)
// ---------------------------------------------------------------------------
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function crc16(bytes: number[]): number {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= (b & 0xff) << 8;
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

function toBase62(bytes: number[]): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b & 0xff);
  let out = '';
  while (n > 0n) { out = B62[Number(n % 62n)]! + out; n /= 62n; }
  return out;
}

const i16 = (n: number): number[] => { const u = Math.trunc(n) & 0xffff; return [u >>> 8, u & 0xff]; };

interface RawParts {
  head?: number; flags?: number; paper?: number; nFolds?: number;
  dirBytes?: number[];
  /** 접기마다 [ax, ay, bx, by] (0.1 mm 정수) */
  folds?: number[][];
  /** [동체, 상반각, 날개 끝 폭, 날개 끝 각도, 뒷전] 정수 */
  shaping?: number[];
  clip?: number | null;
  /** [속도(0.01 m/s), 각도(0.1 도), 기울임(0.1 도)] 또는 null */
  thr?: number[] | null;
  extra?: number[];
  badCrc?: boolean;
}

/** 범위 검사 없이 원하는 정수를 그대로 담은 코드를 만든다. */
function rawCode(p: RawParts): string {
  const folds = p.folds ?? [];
  const clip = p.clip === undefined ? null : p.clip;
  const thr = p.thr === undefined ? [800, 50, 0] : p.thr;
  const b: number[] = [];
  b.push(p.head ?? 0x01);
  b.push(p.flags ?? ((clip !== null ? 1 : 0) | (thr !== null ? 2 : 0)));
  b.push(p.paper ?? 2);
  const n = p.nFolds ?? folds.length;
  b.push(n);
  b.push(...(p.dirBytes ?? new Array<number>(Math.ceil(n / 8)).fill(0)));
  for (const f of folds) for (const v of f) b.push(...i16(v));
  for (const v of p.shaping ?? [200, 100, 0, 0, 25]) b.push(...i16(v));
  if (clip !== null) b.push(...i16(clip));
  if (thr !== null) for (const v of thr) b.push(...i16(v));
  b.push(...(p.extra ?? []));
  const crc = crc16(b) ^ (p.badCrc ? 0x0101 : 0);
  b.push(crc >>> 8, crc & 0xff);
  return `P1${toBase62(b)}`;
}

// ---------------------------------------------------------------------------
// 서버와 요청 도우미
// ---------------------------------------------------------------------------
let server: Server;
let store: MemoryStore;
let base = '';
let port = 0;

beforeAll(async () => {
  store = new MemoryStore();
  server = createServer(createApp({ store, maxQueue: 20, bodyTimeoutMs: 400 }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
});

interface Reply { status: number; json: any; ms: number }

async function send(body: string | Buffer, headers: Record<string, string> = { 'Content-Type': 'application/json' }, path = '/api/submit', method = 'POST'): Promise<Reply> {
  const t0 = performance.now();
  return new Promise<Reply>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: unknown = null;
        try { json = JSON.parse(text); } catch { /* JSON 아님 */ }
        resolve({ status: res.statusCode ?? 0, json, ms: performance.now() - t0 });
      });
    });
    req.on('error', (e: NodeJS.ErrnoException) => {
      // 서버가 413/408 뒤에 연결을 끊는 경우
      if (e.code === 'ECONNRESET' || e.code === 'EPIPE') resolve({ status: -1, json: null, ms: performance.now() - t0 });
      else reject(e);
    });
    req.end(body);
  });
}

const submit = (code: unknown, mode: unknown = 'distance', nickname: unknown = 'rev', extra: Record<string, unknown> = {}): Promise<Reply> =>
  send(JSON.stringify({ code, mode, nickname, ...extra }));

async function health(): Promise<Reply> { return send('', {}, '/api/health', 'GET'); }

/** 받아들여졌다면 저장된 값이 "저장된 코드"를 직접 계산한 값과 같은지 확인한다. */
function expectHonest(r: Reply, mode: 'distance' | 'airtime'): void {
  expect(r.status).toBe(200);
  const e = r.json.entry;
  const dec = decodeDesign(e.code);
  expect(dec).not.toBeNull();
  expect(dec!.throwIn).toBeDefined();
  expect(validateDesign(dec!.design).ok).toBe(true);
  const local = evaluate(dec!.design, dec!.throwIn!).result;
  expect(e.distanceM).toBe(local.distanceM);
  expect(e.airtimeS).toBe(local.airtimeS);
  expect(e.verdict).toBe(local.verdict);
  expect(e.score).toBe(mode === 'distance' ? local.distanceM : local.airtimeS);
  expect(e.mode).toBe(mode);
}

const preset = (id: string): PlaneDesign => JSON.parse(JSON.stringify(PRESETS.find((p) => p.id === id)!.design)) as PlaneDesign;
const th = (speedMps: number, pitchDeg = 0, rollDeg = 0): ThrowInput => ({ speedMps, pitchDeg, rollDeg });

// ---------------------------------------------------------------------------
describe('C 직접 짠 코드가 codec 과 같은 형식인지(시험 도구 확인)', () => {
  it('rawCode 로 만든 정상 코드는 encodeDesign 결과와 글자 하나까지 같다', () => {
    const d = preset('dart');
    const t = th(8, 5, 0);
    const mine = rawCode({
      paper: PAPERS.findIndex((p) => p.id === d.paperId),
      folds: d.folds.map((f) => [f.a.x, f.a.y, f.b.x, f.b.y].map((v) => Math.round(v * 1e4))),
      dirBytes: [d.folds.reduce((bits, f, i) => bits | (f.dir === 'mountain' ? 1 << i : 0), 0)],
      shaping: [d.shaping.keelM * 1e4, d.shaping.dihedralDeg * 10, d.shaping.wingletM * 1e4, d.shaping.wingletDeg * 10, d.shaping.elevatorDeg * 10].map(Math.round),
      thr: [800, 50, 0],
    });
    expect(mine).toBe(encodeDesign(d, t));
  });
});

describe('C 가짜 점수', () => {
  it('본문에 어떤 점수 항목을 넣어도 저장되는 값은 서버가 계산한 값이다', async () => {
    const code = encodeDesign(preset('dart'), th(9, 12, 3));
    const local = evaluate(preset('dart'), th(9, 12, 3)).result;
    for (const mode of ['distance', 'airtime'] as const) {
      const r = await submit(code, mode, 'forger', {
        score: 99999, distanceM: 99999, airtimeS: 99999, verdict: 'glide', rank: 1, id: 'x', createdAt: '1970-01-01T00:00:00.000Z',
        entry: { score: 99999, distanceM: 99999 }, result: { distanceM: 99999, airtimeS: 99999 }, design: { v: 1 }, throwIn: { speedMps: 1000 },
        __proto__: { score: 5 }, constructor: { prototype: { score: 5 } },
      });
      expectHonest(r, mode);
      expect(r.json.entry.score).toBe(mode === 'distance' ? local.distanceM : local.airtimeS);
      expect(r.json.entry.score).toBeLessThan(100);
    }
    // 모드를 섞어 보내도(체공 모드에 거리 점수를 노림) 점수는 그 모드의 값이다
    const r2 = await send(`{"code":"${code}","mode":"airtime","mode":"distance","nickname":"dupkey","score":1e9}`);
    expectHonest(r2, 'distance');
  });
});

describe('C 변조한 코드', () => {
  it('한 글자씩 바꾼 코드는 거절되거나, 받아들여졌다면 그 코드 그대로의 정직한 점수다', async () => {
    const good = encodeDesign(preset('hybrid'), th(7, 5, 0));
    let accepted = 0, rejected = 0;
    for (let i = 2; i < good.length; i += 3) {
      for (const ch of ['0', 'z', 'A']) {
        if (good[i] === ch) continue;
        const code = good.slice(0, i) + ch + good.slice(i + 1);
        const r = await submit(code, 'distance', `t${i}${ch}`);
        if (r.status === 200) { accepted++; expectHonest(r, 'distance'); } else { rejected++; expect(r.status).toBe(400); }
      }
    }
    // 잘라낸 것, 덧붙인 것, 대소문자 바꾼 것, 접두사 바꾼 것
    for (const code of [good.slice(0, -1), good.slice(0, -5), `${good}0`, `${good}${good.slice(2)}`, good.toLowerCase(), good.toUpperCase(), `P2${good.slice(2)}`, `p1${good.slice(2)}`, `P10${good.slice(2)}`, ` ${good}`, `${good}\n`, `${good}\u0000`]) {
      const r = await submit(code, 'distance', 'cut');
      expect(r.status, code).toBe(400);
    }
    expect(rejected).toBeGreaterThan(accepted * 50); // CRC-16 이 거의 다 걸러낸다
  });
});

describe('C 범위를 벗어난 값을 바이트로 직접 넣은 코드', () => {
  const cases: [string, RawParts][] = [
    ['속도 327.67 m/s', { thr: [32767, 50, 0] }],
    // (물리 2판: 던지기 한도가 16 -> 10 m/s. 예전 한도 안이던 10.01, 16 m/s 도 이제 거절된다.)
    ['속도 16.01 m/s', { thr: [1601, 50, 0] }],
    ['속도 16 m/s (예전 한도)', { thr: [1600, 50, 0] }],
    ['속도 10.01 m/s', { thr: [1001, 50, 0] }],
    ['속도 1.99 m/s', { thr: [199, 0, 0] }],
    ['속도 0', { thr: [0, 0, 0] }],
    ['속도 음수', { thr: [-800, 0, 0] }],
    ['각도 89도', { thr: [1000, 890, 0] }],
    ['각도 60.1도', { thr: [1000, 601, 0] }],
    ['각도 -20.1도', { thr: [1000, -201, 0] }],
    ['각도 -90도', { thr: [1000, -900, 0] }],
    ['기울임 30.1도', { thr: [800, 0, 301] }],
    ['기울임 180도', { thr: [800, 0, 1800] }],
    ['뒷전 90도', { shaping: [200, 100, 0, 0, 900] }],
    ['뒷전 20.1도', { shaping: [200, 100, 0, 0, 201] }],
    ['뒷전 -15.1도', { shaping: [200, 100, 0, 0, -151] }],
    ['상반각 45.1도', { shaping: [200, 451, 0, 0, 25] }],
    ['상반각 89도', { shaping: [200, 890, 0, 0, 25] }],
    ['상반각 -10.1도', { shaping: [200, -101, 0, 0, 25] }],
    ['날개 끝 각도 90.1도', { shaping: [200, 100, 100, 901, 25] }],
    ['날개 끝 각도 -3276.8도', { shaping: [200, 100, 100, -32768, 25] }],
    ['동체 깊이 3.2767 m', { shaping: [32767, 100, 0, 0, 25] }],
    ['동체 깊이 음수', { shaping: [-1, 100, 0, 0, 25] }],
    ['동체 깊이 10.52 cm (반쪽 폭 초과)', { shaping: [1052, 100, 0, 0, 25] }],
    ['날개 끝 폭 음수', { shaping: [200, 100, -1, 0, 25] }],
    ['동체 + 날개 끝 > 반쪽 폭', { shaping: [600, 100, 600, 0, 25] }],
    ['클립 앞으로 1 cm', { clip: 100 }],
    ['클립 뒤로 3.2 m', { clip: -32000 }],
    ['클립 뒤로 29.72 cm', { clip: -2972 }],
    ['접기 좌표 3.2767 m', { folds: [[32767, 0, -32768, 0]] }],
    ['접기 좌표 폭의 2배 초과', { folds: [[4201, 0, 0, 0]] }],
    ['접기 두 점이 같음', { folds: [[100, 100, 100, 100]] }],
    ['접기 두 점 거리 0.4 mm', { folds: [[100, 100, 104, 100]] }],
    ['접기 횟수 25', { folds: Array.from({ length: 25 }, (_, i) => [-1050, i * 10, 1050, i * 10]) }],
    ['접기 횟수 255(자료는 1개)', { nFolds: 255, dirBytes: new Array<number>(32).fill(0), folds: [[-1050, 0, 1050, 0]] }],
    ['접기 횟수 0 인데 자료가 있음', { nFolds: 0, dirBytes: [], folds: [[-1050, 0, 1050, 0]] }],
    ['종이 번호 6 (없음)', { paper: 6 }],
    ['종이 번호 255', { paper: 255 }],
    ['깃발 0xFF', { flags: 0xff, clip: -100 }],
    ['깃발 0x06', { flags: 0x06 }],
    ['깃발은 던지기 있음인데 자료 없음', { flags: 2, thr: null }],
    ['깃발은 클립 없음인데 자료 있음', { flags: 2, clip: -100 }],
    ['맨 앞 바이트 2', { head: 0x02 }],
    ['맨 앞 바이트 0', { head: 0x00 }],
    ['뒤에 남는 바이트', { extra: [0, 0, 0, 0] }],
    ['검사값 틀림', { badCrc: true }],
  ];
  it('모두 400 으로 거절된다', async () => {
    for (const [label, parts] of cases) {
      const code = rawCode(parts);
      // (물리 2판: 던지기 값만 범위를 벗어난 코드는 통째로 버리지 않는다. 설계는 읽히고, 던지기는 "없음"이 되며
      //  원래 값이 throwOutOfRange 로 온다. 한도 안으로 잘라 받는 일은 없으므로 서버는 예전처럼 400 으로 거절한다.)
      const throwOnly = Object.keys(parts).length === 1 && Array.isArray(parts.thr);
      const dec = decodeDesign(code);
      if (throwOnly) {
        expect(dec, label).not.toBeNull();
        expect(dec!.throwIn, label).toBeUndefined();
        expect(dec!.throwOutOfRange, label).toBeDefined();
      } else {
        expect(dec, label).toBeNull();
      }
      const r = await submit(code, 'distance', 'raw');
      expect(r.status, `${label} ${code}`).toBe(400);
      expect(r.json.ok, label).toBe(false);
    }
  });

  it('던지기 값이 없는 코드(설계만 공유하는 정상 코드)는 해석은 되지만 등록은 400', async () => {
    const code = rawCode({ thr: null });
    expect(decodeDesign(code)).not.toBeNull();
    expect(decodeDesign(code)!.throwIn).toBeUndefined();
    expect((await submit(code, 'distance', 'nothrow')).status).toBe(400);
  });

  it('한도에 딱 걸친 값(화면 조절 간격으로는 못 만드는 값 포함)은 받아들이되 점수는 정직하다', async () => {
    const edge: RawParts[] = [
      { thr: [1000, 600, 300] },
      { thr: [200, -200, -300] },
      { shaping: [0, 450, 1050, 900, 200] },
      { shaping: [1050, -100, 0, -900, -150] },
      { shaping: [1051, 137, 0, 0, 33], clip: 1 }, // 반올림 허용 오차(0.15 mm) 안: 동체 10.51 cm, 클립 +0.1 mm
      { clip: -2971 },
      { folds: [[4200, 5940, -4200, -5940]] },      // 종이에서 가장 먼 허용 점
      { folds: [[100, 100, 105, 100]] },            // 두 점 거리 0.5 mm
      { paper: 5, thr: [1000, 0, 0] },
    ];
    for (const parts of edge) {
      const code = rawCode(parts);
      const r = await submit(code, 'distance', 'edge');
      expect(r.status, code).toBe(200);
      expectHonest(r, 'distance');
      expect(r.json.entry.distanceM).toBeLessThan(25); // (물리 2판: 40 m 에서 조였다)
      expect(r.ms).toBeLessThan(1000);
    }
  });
});

describe('C 겹 수를 폭발시키는 설계와 계산 시간', () => {
  /** 번갈아 가며 반으로 접기: 접을 때마다 겹이 2배 */
  function halving(n: number): FoldOp[] {
    const folds: FoldOp[] = [];
    let w = 0.21, h = 0.297, cx = 0, cy = 0;
    for (let i = 0; i < n; i++) {
      const q = (v: number): number => Math.round(v * 1e4) / 1e4;
      if (i % 2 === 0) { folds.push({ a: { x: q(cx), y: -0.3 }, b: { x: q(cx), y: 0.3 }, dir: 'valley' }); w /= 2; cx += w / 2; }
      else { folds.push({ a: { x: -0.3, y: q(cy) }, b: { x: 0.3, y: q(cy) }, dir: 'mountain' }); h /= 2; cy -= h / 2; }
    }
    return folds;
  }
  /** 부채꼴: 한 점을 지나는 선들을 조금씩 돌려 가며 접는다(조각 수를 늘리는 다른 방법) */
  function fan(n: number): FoldOp[] {
    const folds: FoldOp[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i * 7.5 * Math.PI) / 180;
      const q = (v: number): number => Math.round(v * 1e4) / 1e4;
      folds.push({ a: { x: q(-0.2 * Math.cos(a)), y: q(-0.2 * Math.sin(a)) }, b: { x: q(0.2 * Math.cos(a)), y: q(0.2 * Math.sin(a)) }, dir: i % 2 ? 'valley' : 'mountain' });
    }
    return folds;
  }
  /** 촘촘한 병풍 접기 */
  function pleats(n: number): FoldOp[] {
    const folds: FoldOp[] = [];
    for (let i = 0; i < n; i++) {
      const y = Math.round((0.14 - i * 0.004) * 1e4) / 1e4;
      folds.push(i % 2 === 0 ? { a: { x: -0.105, y }, b: { x: 0.105, y }, dir: 'valley' } : { a: { x: 0.105, y }, b: { x: -0.105, y }, dir: 'mountain' });
    }
    return folds;
  }

  it('24번 접기 설계들: 직접 계산도, 서버 제출도 1초 안에 끝나고 점수는 정직하다', async () => {
    const shapes: [string, FoldOp[]][] = [
      ['halving24', halving(24)], ['halving9', halving(9)], ['halving10', halving(10)],
      ['fan24', fan(24)], ['pleats24', pleats(24)],
      ['halving8+fan16', [...halving(8), ...fan(16)]], ['pleats12+fan12', [...pleats(12), ...fan(12)]],
    ];
    let slowest = 0, slowestName = '';
    for (const [name, folds] of shapes) {
      for (const shaping of [
        { keelM: 0, dihedralDeg: 0, wingletM: 0, wingletDeg: 0, elevatorDeg: 0 },
        { keelM: 0.005, dihedralDeg: 45, wingletM: 0.005, wingletDeg: 90, elevatorDeg: 20 },
      ]) {
        const d: PlaneDesign = { v: 1, paperId: 'newsprint', folds, shaping, clip: null };
        expect(validateDesign(d).ok, name).toBe(true);
        for (const t of [th(10, 60, 30), th(2, 0, 0)]) {
          const t0 = performance.now();
          const local = evaluate(d, t);
          const ms = performance.now() - t0;
          if (ms > slowest) { slowest = ms; slowestName = name; }
          expect(local.geometry.massKg).toBeCloseTo(0.21 * 0.297 * 0.045, 12);
          expect(Number.isFinite(local.result.distanceM) && Number.isFinite(local.result.airtimeS)).toBe(true);
          const r = await submit(encodeDesign(d, t), 'airtime', name.slice(0, 16));
          expectHonest(r, 'airtime');
          expect(r.ms, name).toBeLessThan(1000);
          expect(r.json.entry.airtimeS, name).toBeLessThan(9); // (물리 2판: 20 초에서 조였다)
        }
      }
    }
    console.log(`[C] 겹 폭발 설계 중 가장 느린 계산: ${slowestName} ${slowest.toFixed(0)} ms`);
    expect(slowest, slowestName).toBeLessThan(1000);
  }, 120_000);
});

describe('C 형식이 틀린 본문', () => {
  it('NaN, Infinity, 문자열, 배열, 중첩 객체, 긴 값: 모두 400 이고 500 은 없다', async () => {
    const good = encodeDesign(preset('dart'), th(8, 5, 0));
    const bodies: string[] = [
      '', ' ', 'null', 'true', '0', '"x"', '[]', '[{}]', '{}', '{', '{"code":', 'code=abc&mode=distance',
      `{"code":NaN,"mode":"distance","nickname":"a"}`,
      `{"code":Infinity,"mode":"distance","nickname":"a"}`,
      `{"code":1e999,"mode":"distance","nickname":"a"}`,
      `{"code":123,"mode":"distance","nickname":"a"}`,
      `{"code":null,"mode":"distance","nickname":"a"}`,
      `{"code":["${good}"],"mode":"distance","nickname":"a"}`,
      `{"code":{"toString":"${good}"},"mode":"distance","nickname":"a"}`,
      `{"code":"${good}","mode":["distance"],"nickname":"a"}`,
      `{"code":"${good}","mode":"Distance","nickname":"a"}`,
      `{"code":"${good}","mode":"__proto__","nickname":"a"}`,
      `{"code":"${good}","mode":"distance","nickname":{"a":1}}`,
      `{"code":"${good}","mode":"distance","nickname":""}`,
      `{"code":"${good}","mode":"distance","nickname":"   "}`,
      `{"code":"${good}","mode":"distance","nickname":"\\u0000\\u0007"}`,
      `{"code":"${good}","mode":"distance","nickname":"${'가'.repeat(17)}"}`,
      `{"code":"${'P1' + 'z'.repeat(419)}","mode":"distance","nickname":"a"}`,
      `{"code":"${'P1' + 'z'.repeat(5000)}","mode":"distance","nickname":"a"}`,
      `{"code":"P1","mode":"distance","nickname":"a"}`,
      `{"code":"","mode":"distance","nickname":"a"}`,
      `{"code":"P1${'가'.repeat(30)}","mode":"distance","nickname":"a"}`,
      `{"__proto__":{"code":"${good}","mode":"distance","nickname":"a"}}`,
      JSON.stringify({ code: good, mode: 'distance', nickname: 'a' }).replace('{', '{'.repeat(1) + '"a":' + '['.repeat(2000) + ']'.repeat(2000) + ','),
    ];
    for (const body of bodies) {
      const r = await send(body);
      // 마지막 것(깊게 중첩된 모르는 항목)은 읽지 않는 항목이므로 200 이어도 된다
      if (r.status === 200) { expectHonest(r, 'distance'); continue; }
      expect(r.status, body.slice(0, 80)).toBe(400);
      expect(r.json?.ok, body.slice(0, 80)).toBe(false);
    }
    // 깨진 UTF-8, 널 바이트, 임의 바이트
    for (const buf of [Buffer.from([0xff, 0xfe, 0x00]), Buffer.from([0xc3, 0x28]), Buffer.alloc(100, 0), Buffer.from('{"code":"\ud800"}')]) {
      const r = await send(buf);
      expect(r.status).toBe(400);
    }
    expect((await health()).status).toBe(200);
  });

  it('Content-Type 이 달라도 500 은 없고, 받아들이면 같은 재계산을 한다', async () => {
    const body = JSON.stringify({ code: encodeDesign(preset('glider'), th(4, 0, 0)), mode: 'airtime', nickname: 'ctype', score: 1e6 });
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/octet-stream', 'application/json; charset=utf-16', '']) {
      const r = await send(body, ct ? { 'Content-Type': ct } : {});
      expect([200, 400, 415]).toContain(r.status);
      if (r.status === 200) expectHonest(r, 'airtime');
    }
  });

  it('엉뚱한 주소와 방식: 404/405/400 이고 500 은 없다', async () => {
    const tries: [string, string][] = [
      ['GET', '/'], ['GET', '/api'], ['GET', '/api/submit'], ['PUT', '/api/submit'], ['DELETE', '/api/leaderboard'], ['PATCH', '/api/health'],
      ['POST', '/api/leaderboard?mode=distance'], ['GET', '/api/leaderboard'], ['GET', '/api/leaderboard?mode=x'], ['GET', '/api/leaderboard?mode=distance&limit=-1'],
      ['GET', '/api/leaderboard?mode=distance&limit=1e9'], ['GET', '/api/leaderboard?mode=distance&limit=99999999999999999999'], ['GET', '/api/leaderboard?mode[]=distance'],
      ['GET', '/api/leaderboard?mode=distance&mode=airtime'], ['GET', '/api/../../etc/passwd'], ['GET', '/api/submit/%00'], ['GET', `/api/leaderboard?mode=distance&x=${'a'.repeat(6000)}`],
      ['GET', '//api//health'], ['POST', '/api/submit?code=x&mode=distance'], ['GET', '/api/__proto__'], ['GET', '/api/constructor'],
    ];
    for (const [method, path] of tries) {
      const r = await send('', {}, path, method);
      expect([200, 400, 404, 405, 431], `${method} ${path}`).toContain(r.status);
      expect(r.status, `${method} ${path}`).not.toBe(500);
    }
    expect((await send('', {}, '/api/leaderboard?mode=distance&limit=999999', 'GET')).json.entries.length).toBeLessThanOrEqual(100);
  });
});

describe('C 큰 본문, 느린 본문', () => {
  it('1 MB 본문은 413(또는 연결 끊김)이고 서버는 계속 응답한다', async () => {
    const r = await send(JSON.stringify({ code: 'P1' + 'A'.repeat(1024 * 1024), mode: 'distance', nickname: 'big' }));
    expect([413, -1]).toContain(r.status);
    const r2 = await send(Buffer.alloc(9 * 1024, 0x20));
    expect([413, -1]).toContain(r2.status);
    expect((await health()).status).toBe(200);
  });

  it('본문을 보내다 만 연결 10개가 버티는 동안에도 다른 요청은 바로 처리되고, 버틴 연결은 408 로 끊긴다', async () => {
    const replies: Promise<string>[] = [];
    for (let i = 0; i < 10; i++) {
      replies.push(new Promise<string>((resolve) => {
        const sock = connect(port, '127.0.0.1', () => {
          sock.write('POST /api/submit HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 200\r\n\r\n{"code":"P1');
        });
        let text = '';
        sock.on('data', (c) => { text += c.toString('utf8'); });
        sock.on('close', () => resolve(text));
        sock.on('error', () => resolve(text));
        setTimeout(() => { sock.destroy(); resolve(text); }, 3000);
      }));
    }
    await new Promise((r) => setTimeout(r, 50));
    const h = await health();
    expect(h.status).toBe(200);
    expect(h.ms).toBeLessThan(200);
    const ok = await submit(encodeDesign(preset('delta'), th(5, 0, 0)), 'distance', 'meanwhile');
    expectHonest(ok, 'distance');
    for (const text of await Promise.all(replies)) expect(text).toMatch(/^HTTP\/1\.1 408 /);
  }, 20_000);
});

describe('C 동시에 많은 제출', () => {
  it('서로 다른 제출 80건을 한꺼번에 보내도 500 은 없고, 받은 것은 모두 정직한 점수이며, 그 사이 조회가 1초 넘게 막히지 않는다', async () => {
    const jobs: Promise<Reply>[] = [];
    const inputs: { d: PlaneDesign; t: ThrowInput }[] = [];
    for (let i = 0; i < 80; i++) {
      const d = preset(PRESETS[i % PRESETS.length]!.id);
      d.paperId = PAPERS[i % PAPERS.length]!.id;
      d.shaping.elevatorDeg = (i % 20) * 0.5;
      const t = th(4 + (i % 13) * 0.5, -10 + (i % 7) * 10, (i % 5) * 5 - 10); // (물리 2판: 4~16 m/s 를 4~10 m/s 로)
      inputs.push({ d, t });
      jobs.push(submit(encodeDesign(d, t), i % 2 ? 'airtime' : 'distance', `p${i}`));
    }
    // 제출이 처리되는 동안 가벼운 조회를 계속 보낸다
    let worstHealth = 0;
    let done = false;
    const prober = (async (): Promise<void> => {
      while (!done) {
        const h = await health();
        expect(h.status).toBe(200);
        worstHealth = Math.max(worstHealth, h.ms);
        await new Promise((r) => setTimeout(r, 10));
      }
    })();
    const replies = await Promise.all(jobs);
    done = true;
    await prober;
    const count: Record<number, number> = {};
    replies.forEach((r, i) => {
      count[r.status] = (count[r.status] ?? 0) + 1;
      expect([200, 503]).toContain(r.status);
      if (r.status === 200) {
        expectHonest(r, i % 2 ? 'airtime' : 'distance');
        const local = evaluate(inputs[i]!.d, inputs[i]!.t).result;
        expect(r.json.entry.distanceM).toBe(local.distanceM);
        expect(r.json.entry.nickname).toBe(`p${i}`);
      }
    });
    console.log(`[C] 동시 80건: ${JSON.stringify(count)}, 그동안 /api/health 최대 지연 ${worstHealth.toFixed(0)} ms`);
    expect(count[200] ?? 0).toBeGreaterThanOrEqual(20);
    // 주의: 여기서는 서버와 요청 보내는 쪽이 같은 스레드라서 지연 시간은 참고값일 뿐이다(실측 1.4~2.0초).
    // 지연 한도는 아래의 "따로 띄운 서버 프로세스" 시험에서 단언한다.
  }, 120_000);
});

describe('C 실제 서버 프로세스(npm run server 와 같은 진입점)에 몰아 보내기', () => {
  it('제출 100건이 몰려도 조회는 1초 안에 답하고, 제출 한 건은 1초 안에 끝나며, 서버는 죽지 않는다', async () => {
    const childPort = 20000 + Math.floor(performance.now() * 7) % 20000;
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { // tsx 를 로더로 직접 써서 자식이 곧 서버다(끝낼 때 남는 프로세스가 없게)
      cwd: process.cwd(), env: { ...process.env, PORT: String(childPort), HOST: '127.0.0.1', DATA_FILE: '' }, stdio: 'ignore',
    });
    const url = `http://127.0.0.1:${childPort}`;
    try {
      let up = false;
      for (let i = 0; i < 100 && !up; i++) {
        try { up = (await fetch(`${url}/api/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
      }
      expect(up).toBe(true);
      const post = async (body: unknown): Promise<Reply> => {
        const t0 = performance.now();
        const res = await fetch(`${url}/api/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { status: res.status, json: await res.json().catch(() => null), ms: performance.now() - t0 };
      };
      // 한 건씩: 가장 오래 걸리는 종류(높이 던져 오래 나는 비행)
      let slowestSingle = 0;
      for (let i = 0; i < 10; i++) {
        const r = await post({ code: encodeDesign(preset(PRESETS[i % 5]!.id), th(9.5, 55, i)), mode: 'airtime', nickname: 'one' });
        expectHonest(r, 'airtime');
        slowestSingle = Math.max(slowestSingle, r.ms);
      }
      // 몰아 보내기
      const jobs: Promise<Reply>[] = [];
      for (let i = 0; i < 100; i++) {
        const d = preset(PRESETS[i % 5]!.id);
        d.paperId = PAPERS[i % PAPERS.length]!.id;
        d.shaping.elevatorDeg = (i % 20) * 0.5;
        jobs.push(post({ code: encodeDesign(d, th(10, 30 + (i % 4) * 10, (i % 7) - 3)), mode: i % 2 ? 'airtime' : 'distance', nickname: `b${i}`, score: 1e9 }));
      }
      let worstHealth = 0, done = false;
      const prober = (async (): Promise<void> => {
        while (!done) {
          const t0 = performance.now();
          const res = await fetch(`${url}/api/health`);
          await res.text();
          expect(res.status).toBe(200);
          worstHealth = Math.max(worstHealth, performance.now() - t0);
          await new Promise((r) => setTimeout(r, 20));
        }
      })();
      const replies = await Promise.all(jobs);
      done = true;
      await prober;
      const count: Record<number, number> = {};
      for (const r of replies) {
        count[r.status] = (count[r.status] ?? 0) + 1;
        expect([200, 503]).toContain(r.status);
        if (r.status === 200) expectHonest(r, r.json.entry.mode);
      }
      console.log(`[C] 따로 띄운 서버: 한 건 최대 ${slowestSingle.toFixed(0)} ms, 100건 동시 ${JSON.stringify(count)}, 그동안 조회 최대 지연 ${worstHealth.toFixed(0)} ms`);
      expect(slowestSingle).toBeLessThan(1000);
      expect(worstHealth).toBeLessThan(1000);
      expect(child.exitCode).toBeNull(); // 죽지 않았다
      expect((await fetch(`${url}/api/health`)).status).toBe(200);
    } finally {
      child.kill('SIGKILL');
    }
  }, 180_000);
});

describe('C 마지막 점검: 랭킹 전체가 정직한가', () => {
  it('지금까지의 공격 뒤에 랭킹에 남은 모든 기록은 저장된 코드를 직접 계산한 값과 같고, 점수 순이다', async () => {
    for (const mode of ['distance', 'airtime'] as const) {
      const all = store.top(mode, Number.POSITIVE_INFINITY);
      expect(all.length).toBeGreaterThan(5);
      let prev = Infinity;
      for (const e of all) {
        const dec = decodeDesign(e.code)!;
        expect(dec, e.code).not.toBeNull();
        const local = evaluate(dec.design, dec.throwIn!).result;
        expect(e.score, e.code).toBe(mode === 'distance' ? local.distanceM : local.airtimeS);
        expect(e.distanceM).toBe(local.distanceM);
        expect(e.airtimeS).toBe(local.airtimeS);
        expect(e.score).toBeLessThanOrEqual(prev);
        expect(e.score).toBeLessThan(mode === 'distance' ? 40 : 20);
        expect(e.nickname.length).toBeGreaterThan(0);
        expect(Array.from(e.nickname).length).toBeLessThanOrEqual(16);
        prev = e.score;
      }
      const lb = await send('', {}, `/api/leaderboard?mode=${mode}&limit=100`, 'GET');
      expect(lb.status).toBe(200);
      expect(lb.json.entries.map((x: { id: string }) => x.id)).toEqual(all.slice(0, 100).map((x) => x.id));
    }
    expect((await health()).status).toBe(200);
  }, 120_000);
});
