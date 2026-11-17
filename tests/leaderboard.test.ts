/**
 * 랭킹 끝값 탐색 시험 ("랭킹 1등은 어떤 비행기이고, 그 기록은 말이 되는가").
 *
 * 물리 2판의 목표는 "어린이가 학교 체육관에서 던진 종이비행기"로 믿을 수 있는 기록만 나오게 하는 것이다.
 * 점수 규칙이나 감점은 넣지 않았으므로, 허점이 있다면 물리에 있다. 그래서 정해진 순서의 탐색
 * (성긴 격자 + 고정 씨앗 오르기, tests/leaderboardSearch.ts)으로 가장 멀리, 가장 오래 나는 것을 찾아보고 따진다.
 *
 * 한계 값의 근거
 *  - 에너지: 던지는 높이 1.6 m, 최대 속도 10 m/s. 운동 에너지를 모두 높이로 바꾸면 10²/(2·9.81) = 5.1 m, 합쳐 6.7 m.
 *  - 거리: 종이비행기의 최대 양항비는 약 4~4.5 다. 에너지를 하나도 잃지 않고 가장 좋은 활공비로만 써도
 *    6.7 x 4.5 = 30 m. 실제 비행은 솟구쳤다 내려오며 20~40% 를 잃는다. 기록용 비행기를 25 m/s 넘게 던지는 선수의
 *    세계 기록이 약 88 m 인데, 속도의 제곱으로 줄이면 (10/25)² x 88 = 14 m 다. 보통 사람은 5~20 m.
 *    그래서 "가장 좋은 설계 + 가장 좋은 던지기"의 한계를 25 m 로 잡았다.
 *  - 체공: 수직으로 던져도 6.7 m 를 넘지 못하고, 일반 복사지 비행기의 가라앉는 속도는 0.7~1.1 m/s 다.
 *    6.7 / 0.8 = 8.4 초. 얇은 종이는 더 천천히 가라앉지만 높이 던질 수 없다. 한계를 8.5 초로 잡았다.
 *
 * 탐색은 runFlight 를 2천 번 넘게 돌린다(이 파일 전체 약 2~3분).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  LIMITS, PAPERS, PRESETS, analyze, buildGeometry, decodeDesign, evaluate, validateSubmission,
  type AeroSummary, type PlaneDesign, type PlaneGeometry, type SimResult, type ThrowInput,
} from '../src/core/index';
import {
  GRID_PITCHES, GRID_SPEEDS, Searcher, climb, codeOf, lcg, presetPaperGrid, randomFreeCandidate, randomPresetCandidate, refineThrow,
  score, type GridCell, type Mode, type Scored,
} from './leaderboardSearch';

const LONG = 600_000;
const G = 9.81;
const H0 = LIMITS.launchHeightM;
const VMAX = LIMITS.throwSpeedMax;
/** 던진 에너지를 모두 높이로 바꿨을 때의 높이(m) */
const energyHeight = (t: ThrowInput): number => H0 + (t.speedMps * t.speedMps) / (2 * G);
/** 공기가 없을 때 같은 던지기로 날아가는 거리와 시간(돌멩이 기준) */
function ballistic(t: ThrowInput): { rangeM: number; timeS: number } {
  const a = (t.pitchDeg * Math.PI) / 180;
  const vz = t.speedMps * Math.sin(a), vx = t.speedMps * Math.cos(a);
  const timeS = (vz + Math.sqrt(vz * vz + 2 * G * H0)) / G;
  return { rangeM: vx * timeS, timeS };
}
/** 날개 띠의 넓이 가중 평균 겹 수. 1 이면 접은 곳이 없는 종이 한 장 */
function meanWingLayers(g: PlaneGeometry): number {
  let a = 0, l = 0;
  for (const e of g.elements) if (e.kind === 'wing') { a += e.area; l += e.area * e.layers; }
  return a > 0 ? l / a : 1;
}

const DISTANCE_LIMIT_M = 25;
const AIRTIME_LIMIT_S = 8.5;

interface Winner { s: Scored; code: string; design: PlaneDesign; throwIn: ThrowInput; geometry: PlaneGeometry; summary: AeroSummary; result: SimResult }

const searcher = new Searcher();
let grid: GridCell[] = [];
const top: Record<Mode, Winner[]> = { distance: [], airtime: [] };

function toWinner(s: Scored): Winner {
  const e = evaluate(s.cand.design, s.cand.throwIn);
  return { s, code: codeOf(s), design: s.cand.design, throwIn: s.cand.throwIn, geometry: e.geometry, summary: e.summary, result: e.result };
}

function describeWinner(w: Winner, i: number): string {
  const st = w.geometry.stats, a = w.summary, r = w.result;
  const kind = w.s.cand.presetId ?? '자유접기';
  return `  ${i + 1}. ${r.distanceM.toFixed(2)} m / ${r.airtimeS.toFixed(2)} s, 최고 높이 ${r.maxHeightM.toFixed(1)} m, 판정 ${r.verdict}`
    + ` | ${kind}, ${w.design.paperId}, 접기 ${w.design.folds.length}번, 던지기 ${w.throwIn.speedMps} m/s ${w.throwIn.pitchDeg}도`
    + ` | 날개 ${(st.wingAreaM2 * 1e4).toFixed(0)} cm², 가로세로비 ${st.aspectRatio.toFixed(2)}, 무게 ${(w.geometry.massKg * 1000).toFixed(1)} g`
    + `, 안정 받음각 ${a.trimAlphaDeg?.toFixed(1) ?? '-'}도, 안정 속도 ${a.trimSpeedMps?.toFixed(2) ?? '-'} m/s, 활공비 ${a.glideRatio?.toFixed(2) ?? '-'}`
    + ` (최대 ${a.maxLD.toFixed(2)}), 정적 여유 ${a.staticMargin.toFixed(2)}, ${a.pitchStability}`
    + `, 하중비 ${r.structure.peakLoadRatio.toFixed(2)}${r.structure.buckled ? ' (꺾임)' : ''}\n     ${w.code}`;
}

beforeAll(() => {
  const rnd = lcg(20261116);
  // 1) 프리셋 기본값 x 종이 x 던지기 격자 (5 x 6 x 4 x 5 = 600번)
  grid = presetPaperGrid(searcher);
  const presetPool: Scored[] = grid.flatMap((c) => c.all);
  // 2) 프리셋 조절값, 종이, 클립, 던지기를 임의로 고른 것 350개
  for (let i = 0; i < 350; i++) presetPool.push(searcher.run(randomPresetCandidate(rnd)));
  // 3) 임의 자유접기 550개
  const freePool: Scored[] = [];
  for (let i = 0; i < 550; i++) freePool.push(searcher.run(randomFreeCandidate(rnd)));
  // 4) 종목마다, 프리셋 쪽과 자유접기 쪽에서 각각 오르기
  for (const mode of ['distance', 'airtime'] as Mode[]) {
    const a = climb(searcher, presetPool, mode, rnd, { keep: 6, children: 8, rounds: 4 });
    const b = climb(searcher, freePool, mode, rnd, { keep: 6, children: 8, rounds: 4 });
    // 오르기가 찾은 것과 처음에 뿌린 것을 모두 모아 점수순으로 줄 세운다.
    const all = [...a, ...b, ...presetPool, ...freePool].sort((x, y) => score(y, mode) - score(x, mode));
    // 상위 5는 "서로 다른 비행기"로 뽑는다: 같은 계열(프리셋, 종이, 접기 횟수)에서 조절값이나 던지기만 조금 다른 것은 하나로 친다.
    const seen = new Set<string>();
    for (const s of all) {
      const key = `${s.cand.presetId ?? 'free'}|${s.cand.design.paperId}|${s.cand.design.folds.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      top[mode].push(toWinner(s));
      if (top[mode].length >= 5) break;
    }
  }
}, LONG);

describe('랭킹 끝값: 탐색이 찾은 최고 기록', () => {
  it('탐색 규모: 2천 번 넘게 비행을 계산했고, 상위 5개씩을 찾았다', () => {
    console.log(`[랭킹 끝값] 비행 계산 ${searcher.evals}번`);
    console.log(`[랭킹 끝값] 거리 상위 5:\n${top.distance.map(describeWinner).join('\n')}`);
    console.log(`[랭킹 끝값] 체공 상위 5:\n${top.airtime.map(describeWinner).join('\n')}`);
    expect(searcher.evals).toBeGreaterThan(2000);
    expect(top.distance.length).toBe(5);
    expect(top.airtime.length).toBe(5);
  });

  it('상위 기록의 코드는 공개 창구로 다시 계산해도 같은 값이고 랭킹 제출 검사를 통과한다', () => {
    for (const mode of ['distance', 'airtime'] as Mode[]) for (const w of top[mode]) {
      const dec = decodeDesign(w.code)!;
      expect(dec.throwIn, w.code).toBeDefined();
      expect(validateSubmission(dec.design, dec.throwIn), w.code).toEqual({ ok: true, errors: [] });
      const again = evaluate(dec.design, dec.throwIn!).result;
      expect(again.distanceM, w.code).toBe(w.s.distanceM);
      expect(again.airtimeS, w.code).toBe(w.s.airtimeS);
    }
  });

  it(`거리 1등은 ${DISTANCE_LIMIT_M} m 를 넘지 않고(어린이의 던지기), 그래도 14 m 는 넘는다(잘 만든 비행기는 잘 난다)`, () => {
    const best = top.distance[0]!;
    expect(best.result.distanceM).toBeLessThan(DISTANCE_LIMIT_M);
    expect(best.result.distanceM).toBeGreaterThan(14);
    // 체공 쪽 탐색에서 나온 것까지 포함해, 찾은 어떤 비행도 한계를 넘지 않는다
    for (const w of [...top.distance, ...top.airtime]) expect(w.result.distanceM, w.code).toBeLessThan(DISTANCE_LIMIT_M);
  });

  it('거리 상위 5는 모두 "비행기"다: 안정 받음각이 있고, 활공 또는 실속 뒤 회복 판정이며, 날개가 꺾이지 않았다', () => {
    for (const w of top.distance) {
      const a = w.summary, r = w.result;
      expect(['glide', 'stall'], w.code).toContain(r.verdict);
      expect(a.trimAlphaDeg, w.code).not.toBeNull();
      expect(a.trimSpeedMps, w.code).not.toBeNull();
      expect(a.glideRatio, w.code).not.toBeNull();
      // 세로 안정: 뒤집히는 형상이 아니고, 받음각이 커지면 기수를 숙이는 힘이 생긴다
      expect(['stable', 'marginal'], w.code).toContain(a.pitchStability);
      expect(a.staticMargin, w.code).toBeGreaterThan(0);
      expect(a.trimAlphaDeg!, w.code).toBeLessThan(a.stallAlphaDeg);
      expect(a.glideRatio!, w.code).toBeGreaterThanOrEqual(2.5);
      expect(a.glideRatio!, w.code).toBeLessThanOrEqual(6);
      expect(r.structure.collapsedAtLaunch, w.code).toBe(false);
      expect(r.structure.buckled, w.code).toBe(false);
      expect(Math.abs(r.lateralM), w.code).toBeLessThan(0.3 * r.distanceM);
    }
  });

  it('거리 상위 5는 "양력 없이 포물선으로 날아간 물체"가 아니다: 돌멩이보다 훨씬 멀리, 오래 가고, 에너지 한계 안이다', () => {
    for (const w of top.distance) {
      const r = w.result, b = ballistic(w.throwIn);
      // 같은 던지기의 돌멩이(공기 없음)보다 1.3배 넘게 멀리, 1.5배 넘게 오래: 날개가 떠받친 비행이다
      expect(r.distanceM, w.code).toBeGreaterThan(1.3 * b.rangeM);
      expect(r.airtimeS, w.code).toBeGreaterThan(1.5 * b.timeS);
      // 에너지 셈: 던진 에너지를 높이로 바꾼 값 x 그 기체의 최대 양항비보다 멀리 갈 수 없다(공짜 에너지 없음)
      const bound = energyHeight(w.throwIn) * w.summary.maxLD;
      expect(r.distanceM, w.code).toBeLessThan(bound);
      // 최고 높이도 에너지 한계 안
      expect(r.maxHeightM, w.code).toBeLessThanOrEqual(energyHeight(w.throwIn) + 1e-6);
    }
  });

  it(`체공 1등은 ${AIRTIME_LIMIT_S} 초를 넘지 않고, 그래도 3.5 초는 넘는다`, () => {
    const best = top.airtime[0]!;
    expect(best.result.airtimeS).toBeLessThan(AIRTIME_LIMIT_S);
    expect(best.result.airtimeS).toBeGreaterThan(3.5);
    for (const w of [...top.airtime, ...top.distance]) {
      expect(w.result.airtimeS, w.code).toBeLessThan(AIRTIME_LIMIT_S);
      // 높이와 가라앉는 속도로 따져도 말이 된다: 꼭대기는 에너지 한계 안이고, 꼭대기에서 바닥까지 평균 0.5 m/s 보다 빨리 내려온다
      expect(w.result.maxHeightM, w.code).toBeLessThanOrEqual(energyHeight(w.throwIn) + 1e-6);
      expect(w.result.airtimeS, w.code).toBeLessThan(w.result.maxHeightM / 0.5 + 1.5);
    }
  });

  it('체공 상위 5는 "거의 접지 않은 종이"가 아니다: 접은 곳이 있고 던지는 순간 접히지 않았다. 1등은 스스로 자세를 잡는 비행기다', () => {
    for (const w of top.airtime) {
      // 접은 곳이 있다: 평면 접기 2번 이상, 날개의 평균 겹 수 1.15 이상
      expect(w.design.folds.length, w.code).toBeGreaterThanOrEqual(2);
      expect(meanWingLayers(w.geometry), w.code).toBeGreaterThan(1.15);
      expect(w.result.structure.collapsedAtLaunch, w.code).toBe(false);
    }
    // 1등은 뒤집히기만 하는 판때기(안정한 균형이 없는 형상)가 아니라 활공하는 비행기다
    const best = top.airtime[0]!;
    expect(best.summary.trimAlphaDeg, best.code).not.toBeNull();
    expect(['stable', 'marginal'], best.code).toContain(best.summary.pitchStability);
    expect(best.summary.staticMargin, best.code).toBeGreaterThan(0);
    expect(best.summary.trimAlphaDeg!, best.code).toBeLessThan(best.summary.stallAlphaDeg);
    expect(['glide', 'stall'], best.code).toContain(best.result.verdict);
    expect(best.summary.glideRatio!, best.code).toBeGreaterThan(2);
    // 꼭대기에서 내려오는 평균 속도가 그 비행기의 활공 가라앉는 속도(안정 속도 / 활공비)와 비슷하다: 활공으로 번 시간이다
    const sink = best.summary.trimSpeedMps! / Math.hypot(1, best.summary.glideRatio!);
    expect(best.result.maxHeightM / best.result.airtimeS, best.code).toBeGreaterThan(0.6 * sink);
  });
});

describe('랭킹 끝값: 거의 접지 않은 종이는 높이 던질 수 없다', () => {
  // 동체만 살짝 접은 종이 한 장(평면 접기 0~1번). 리뷰어가 찾은 허점: 2.8 g 신문지를 16 m/s, 60도로 던지면 7.3 m 까지 올라가 13초를 떠 있었다.
  const sheet = (paperId: string, hem: boolean): PlaneDesign => ({
    v: 1, paperId,
    folds: hem ? [{ a: { x: -0.105, y: 0.13 }, b: { x: 0.105, y: 0.13 }, dir: 'valley' }] : [],
    shaping: { keelM: 0.01, dihedralDeg: 5, wingletM: 0, wingletDeg: 0, elevatorDeg: 0 },
    clip: null,
  });
  const throws: ThrowInput[] = [];
  for (const v of [6, 8, VMAX]) for (const pitch of [30, 45, 60]) throws.push({ speedMps: v, pitchDeg: pitch, rollDeg: 0 });

  it('흐물흐물한 종이(신문지, 얇은 복사지, 일반 복사지)를 펼친 채 던지면 손에서 접히고, 던진 높이에서 1 m 도 못 올라가며 3초 안에 떨어진다', () => {
    for (const paperId of ['newsprint', 'copy60', 'copy80']) {
      for (const t of throws) {
        const r = evaluate(sheet(paperId, false), t).result;
        const label = `${paperId} ${t.speedMps} m/s ${t.pitchDeg}도`;
        expect(r.structure.collapsedAtLaunch, label).toBe(true);
        expect(r.structure.safeThrowSpeedMps, label).toBeLessThan(5);
        expect(r.maxHeightM, label).toBeLessThan(H0 + 1.0);
        expect(r.airtimeS, label).toBeLessThan(3);
        expect(r.distanceM, label).toBeLessThan(4);
        expect(['flutter', 'tumble', 'dive', 'stall'], label).toContain(r.verdict);
        expect(r.structure.noteKo, label).toContain('접혀');
      }
    }
  });

  it('리뷰어가 찾은 그 던지기(신문지 한 장, 최대 속도, 60도)는 이제 50 cm 도 못 올라가고 2.5초 안에 떨어진다', () => {
    const r = evaluate(sheet('newsprint', false), { speedMps: VMAX, pitchDeg: 60, rollDeg: 0 }).result;
    expect(r.maxHeightM).toBeLessThan(H0 + 0.5);
    expect(r.airtimeS).toBeLessThan(2.5);
  });

  it('같은 모양이라도 살살 놓으면 천천히 팔랑팔랑 떨어진다(느린 낙하 자체는 진짜다)', () => {
    // 2 m/s 로 수평으로 놓은 신문지 한 장: 1.6 m 를 1초 넘게 걸려 내려온다(돌멩이는 0.57초)
    const r = evaluate(sheet('newsprint', false), { speedMps: 2, pitchDeg: 0, rollDeg: 0 }).result;
    expect(r.airtimeS).toBeGreaterThan(1.0);
    expect(r.maxHeightM).toBeLessThan(H0 + 0.3);
  });

  it('어떤 종이든, 펼친 종이의 체공 기록은 탐색이 찾은 비행기의 기록보다 한참 아래다', () => {
    let bestSheet = 0, where = '';
    for (const paper of PAPERS) for (const hem of [false, true]) for (const t of throws) {
      const r = searcher.run({ presetId: null, params: null, design: sheet(paper.id, hem), throwIn: t });
      if (r.airtimeS > bestSheet) { bestSheet = r.airtimeS; where = `${paper.id} hem=${hem} ${t.speedMps} m/s ${t.pitchDeg}도`; }
    }
    console.log(`[랭킹 끝값] 펼친 종이의 최고 체공 ${bestSheet.toFixed(2)} 초 (${where}), 비행기 1등 ${top.airtime[0]!.result.airtimeS.toFixed(2)} 초`);
    expect(bestSheet, where).toBeLessThan(top.airtime[0]!.result.airtimeS * 0.85);
    expect(bestSheet, where).toBeLessThan(5.5);
  }, LONG);
});

describe('랭킹 끝값: 종이의 쓸모 (어떤 종이도 모든 것에서 1등은 아니다)', () => {
  const cell = (presetId: string, paperId: string): GridCell => grid.find((c) => c.presetId === presetId && c.paperId === paperId)!;
  /** 격자에서 그 속도로 던진 것 중 가장 좋은 값 */
  const bestAt = (c: GridCell, mode: Mode, speed: number): number =>
    Math.max(...c.all.filter((s) => s.cand.throwIn.speedMps === speed).map((s) => score(s, mode)));
  const WIDE = ['glider', 'delta', 'stealth'];

  it('프리셋 x 종이 표 (안정 받음각, 안정 속도, 활공비, 가장 좋은 거리와 체공과 그 던지기)', () => {
    const lines: string[] = ['| 프리셋 | 종이 | 받음각 | 속도 m/s | 활공비 | 최고 거리 (던지기) | 최고 체공 (던지기) |', '|---|---|---|---|---|---|---|'];
    for (const c of grid) {
      const a = analyze(buildGeometry(c.best.distance.cand.design));
      const d = refineThrow(searcher, c.best.distance, 'distance');
      const t = refineThrow(searcher, c.best.airtime, 'airtime');
      const f = (s: Scored): string => `${s.cand.throwIn.speedMps} m/s, ${s.cand.throwIn.pitchDeg}도`;
      lines.push(`| ${c.presetId} | ${c.paperId} | ${a.trimAlphaDeg!.toFixed(1)} | ${a.trimSpeedMps!.toFixed(2)} | ${a.glideRatio!.toFixed(2)} | ${d.distanceM.toFixed(1)} m (${f(d)}) | ${t.airtimeS.toFixed(2)} s (${f(t)}) |`);
      // 모든 칸이 실측 범위 안에서 난다
      expect(a.trimAlphaDeg!, `${c.presetId}/${c.paperId}`).toBeGreaterThan(3.5);
      expect(a.trimAlphaDeg!, `${c.presetId}/${c.paperId}`).toBeLessThan(10);
      expect(a.glideRatio!, `${c.presetId}/${c.paperId}`).toBeGreaterThan(2.8);
      expect(a.glideRatio!, `${c.presetId}/${c.paperId}`).toBeLessThan(6);
      expect(d.distanceM, `${c.presetId}/${c.paperId}`).toBeLessThan(DISTANCE_LIMIT_M);
      expect(t.airtimeS, `${c.presetId}/${c.paperId}`).toBeLessThan(AIRTIME_LIMIT_S);
    }
    console.log(`[랭킹 끝값] 프리셋 x 종이 표\n${lines.join('\n')}`);
  }, LONG);

  it('한 종이가 모든 프리셋의 거리와 체공을 다 차지하지 않는다', () => {
    const winners: Record<Mode, string[]> = { distance: [], airtime: [] };
    for (const p of PRESETS) for (const mode of ['distance', 'airtime'] as Mode[]) {
      let best = '', val = -1;
      for (const paper of PAPERS) {
        const v = score(cell(p.id, paper.id).best[mode], mode);
        if (v > val) { val = v; best = paper.id; }
      }
      winners[mode].push(best);
    }
    console.log(`[랭킹 끝값] 프리셋별 1등 종이 - 거리: ${winners.distance.join(', ')} / 체공: ${winners.airtime.join(', ')}`);
    const all = new Set([...winners.distance, ...winners.airtime]);
    expect(all.size).toBeGreaterThanOrEqual(3);
    // 거리 1등 종이와 체공 1등 종이가 같은 프리셋은 많아야 한 개다
    expect(PRESETS.filter((_, i) => winners.distance[i] === winners.airtime[i]).length).toBeLessThanOrEqual(1);
    // 가장 무거운 종이가 체공까지 가져가는 프리셋은 없다
    expect(winners.airtime).not.toContain('kent160');
    // 가장 가벼운 종이가 거리 1등인 프리셋도 없다(힘껏 던지는 종목이다)
    expect(winners.distance).not.toContain('newsprint');
  });

  it('넓은 날개에 얇은 종이를 써서 최대 속도로 던지면 일반 복사지보다 못 난다', () => {
    for (const id of WIDE) {
      const thin = bestAt(cell(id, 'newsprint'), 'distance', VMAX);
      const std = bestAt(cell(id, 'copy80'), 'distance', VMAX);
      expect(thin, id).toBeLessThan(std - 1);
      // 같은 높이, 같은 각도로 견줘도(20도 위) 마찬가지
      const at = (paperId: string): number => cell(id, paperId).all.find((s) => s.cand.throwIn.speedMps === VMAX && s.cand.throwIn.pitchDeg === 0)!.distanceM;
      expect(at('newsprint'), id).toBeLessThan(at('copy80'));
    }
  });

  it('얇은 종이는 살살 던질 때 빛난다: 4 m/s 에서는 신문지가 일반 복사지보다 오래 뜨고, 넓은 날개에서는 더 멀리도 간다', () => {
    for (const p of PRESETS) {
      expect(bestAt(cell(p.id, 'newsprint'), 'airtime', 4), p.id).toBeGreaterThan(bestAt(cell(p.id, 'copy80'), 'airtime', 4) * 1.15);
    }
    for (const id of WIDE) expect(bestAt(cell(id, 'newsprint'), 'distance', 4), id).toBeGreaterThan(bestAt(cell(id, 'copy80'), 'distance', 4));
  });

  it('무거운 종이를 살살 던지면 일반 복사지보다 못 난다(거리도 체공도). 힘껏 던져야 제 실력이 나온다', () => {
    for (const p of PRESETS) {
      for (const v of [4, 6]) {
        if (v === 6 && WIDE.includes(p.id)) continue; // 넓은 날개의 켄트지는 6 m/s 가 이미 안정 속도 근처다
        expect(bestAt(cell(p.id, 'kent160'), 'distance', v), `${p.id} ${v}`).toBeLessThan(bestAt(cell(p.id, 'copy80'), 'distance', v));
        expect(bestAt(cell(p.id, 'kent160'), 'airtime', v), `${p.id} ${v}`).toBeLessThan(bestAt(cell(p.id, 'copy80'), 'airtime', v));
      }
      // 켄트지는 4 m/s 보다 10 m/s 에서 2.5배 넘게 간다(일반 복사지는 그만큼 벌어지지 않는다)
      const gainHeavy = bestAt(cell(p.id, 'kent160'), 'distance', VMAX) / bestAt(cell(p.id, 'kent160'), 'distance', 4);
      const gainStd = bestAt(cell(p.id, 'copy80'), 'distance', VMAX) / bestAt(cell(p.id, 'copy80'), 'distance', 4);
      expect(gainHeavy, p.id).toBeGreaterThan(2.5);
      expect(gainHeavy, p.id).toBeGreaterThan(gainStd);
    }
  });

  it('다트: 켄트지는 안정 속도가 던지기 한도에 가까워 남는 에너지가 적다. 그래서 가장 무거운 종이가 거리를 독차지하지 못한다', () => {
    const trim = (paperId: string): number => analyze(buildGeometry({ ...PRESETS.find((p) => p.id === 'dart')!.design, paperId })).trimSpeedMps!;
    // 안정 속도는 무게의 제곱근에 비례: 켄트지 다트는 일반 복사지 다트의 약 1.41배
    expect(trim('kent160') / trim('copy80')).toBeGreaterThan(1.3);
    expect(trim('kent160')).toBeGreaterThan(0.7 * VMAX);
    // 최대 속도로 던졌을 때 켄트지가 한 단계 가벼운 색지보다 뚜렷하게(5% 넘게) 앞서지 못한다
    const d = (paperId: string): number => bestAt(cell('dart', paperId), 'distance', VMAX);
    expect(d('kent160')).toBeLessThan(d('craft120') * 1.05);
    // 8 m/s 로 던지면 켄트지는 일반 복사지와 고급 복사지에 진다
    const d8 = (paperId: string): number => bestAt(cell('dart', paperId), 'distance', 8);
    expect(d8('kent160')).toBeLessThan(d8('copy80'));
    expect(d8('kent160')).toBeLessThan(d8('copy100'));
  });
});

describe('랭킹 끝값: 세게 던질수록 무조건 멀리 가는 것은 아니다', () => {
  const cell = (presetId: string, paperId: string): GridCell => grid.find((c) => c.presetId === presetId && c.paperId === paperId)!;
  const at = (c: GridCell, v: number, pitch: number): Scored => c.all.find((s) => s.cand.throwIn.speedMps === v && s.cand.throwIn.pitchDeg === pitch)!;

  it('같은 각도로 더 세게 던졌는데 덜 가는 경우가 실제로 있다(솟구쳐 실속하거나, 펄럭이며 힘이 빠진다)', () => {
    const worse: string[] = [];
    for (const c of grid) for (const pitch of GRID_PITCHES) {
      if (at(c, VMAX, pitch).distanceM < at(c, 8, pitch).distanceM) worse.push(`${c.presetId}/${c.paperId} ${pitch}도`);
    }
    console.log(`[랭킹 끝값] 8 m/s 보다 10 m/s 에서 덜 간 경우 ${worse.length}/${grid.length * GRID_PITCHES.length}: ${worse.join(', ')}`);
    expect(worse.length).toBeGreaterThanOrEqual(6);
    // 대표적인 예: 신문지 하이브리드를 50도 위로, 신문지 델타를 35도 위로, 켄트지 글라이더를 50도 위로
    expect(at(cell('hybrid', 'newsprint'), VMAX, 50).distanceM).toBeLessThan(at(cell('hybrid', 'newsprint'), 8, 50).distanceM);
    expect(at(cell('delta', 'newsprint'), VMAX, 35).distanceM).toBeLessThan(at(cell('delta', 'newsprint'), 8, 35).distanceM);
    expect(at(cell('glider', 'kent160'), VMAX, 50).distanceM).toBeLessThan(at(cell('glider', 'kent160'), 8, 50).distanceM);
    // 반대로 빳빳한 다트를 낮게(20도 이하) 던지면 세게 던질수록 멀리 간다. 이것은 정당하다(아래 에너지 셈 참고).
    for (const pitch of [0, 10, 20]) {
      expect(at(cell('dart', 'craft120'), VMAX, pitch).distanceM, `${pitch}도`).toBeGreaterThan(at(cell('dart', 'craft120'), 8, pitch).distanceM);
    }
  });

  it('얇은 종이는 8 m/s 를 넘겨 던져도 거리가 거의 늘지 않는다(펄럭임이 남는 힘을 먹는다)', () => {
    for (const id of ['dart', 'glider', 'hybrid', 'delta']) {
      const c = cell(id, 'newsprint');
      const best = (v: number): number => Math.max(...c.all.filter((s) => s.cand.throwIn.speedMps === v).map((s) => s.distanceM));
      // 던지는 에너지는 (10/8)² = 1.56배인데 거리는 6% 도 늘지 않는다
      expect(best(VMAX) / best(8), id).toBeLessThan(1.06);
      // 빳빳한 종이는 같은 구간에서 뚜렷하게 늘어난다
      const k = cell(id, 'kent160');
      const bestK = (v: number): number => Math.max(...k.all.filter((s) => s.cand.throwIn.speedMps === v).map((s) => s.distanceM));
      expect(bestK(VMAX) / bestK(8), id).toBeGreaterThan(1.1);
    }
  });

  it('세게 던질수록 멀리 가는 경우에도 에너지 셈이 맞는다: 어떤 속도에서도 거리는 (던지는 높이 + 속도 에너지 높이) x 최대 양항비를 넘지 않는다', () => {
    expect(GRID_SPEEDS).toContain(VMAX);
    expect(GRID_PITCHES).toContain(0);
    let tightest = 0, where = '';
    for (const c of grid) {
      const a = analyze(buildGeometry(c.best.distance.cand.design));
      for (const v of GRID_SPEEDS) {
        const best = Math.max(...c.all.filter((s) => s.cand.throwIn.speedMps === v).map((s) => s.distanceM));
        const bound = (H0 + (v * v) / (2 * G)) * a.maxLD;
        expect(best, `${c.presetId}/${c.paperId} ${v} m/s`).toBeLessThan(bound);
        if (best / bound > tightest) { tightest = best / bound; where = `${c.presetId}/${c.paperId} ${v} m/s`; }
      }
    }
    // 기본 프리셋은 에너지 한계의 90% 를 넘겨 쓰지 못한다(솟구쳤다 내려오며 잃는 몫이 있다)
    console.log(`[랭킹 끝값] 에너지 한계 대비 가장 알뜰한 비행: ${(tightest * 100).toFixed(0)}% (${where})`);
    expect(tightest, where).toBeLessThan(0.9);
  });
});
