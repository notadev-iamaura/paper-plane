/**
 * 랭킹 끝값 탐색(시험 도우미). "가장 멀리", "가장 오래" 나는 설계와 던지기를 정해진 순서로 찾는다.
 *
 * 방법: 성긴 격자 -> 좋은 것들 주변을 조금씩 바꿔 가며 오르기(hill climbing). 무작위는 씨앗이 고정된
 * 선형 합동 생성기(LCG)만 쓰므로 언제 돌려도 같은 순서로 같은 후보를 본다.
 * 탐색 대상: (1) 프리셋 x 조절값 x 종이 x 클립 x 던지기, (2) 임의 자유접기(좌우 대칭 접기, 가로 접기) x 마무리 값 x 던지기.
 *
 * 속도를 위해 후보 평가는 내부 함수 runFlight 로 하고(분석 없이 비행만), 상위 후보만 공개 창구 evaluate 로 다시 확인한다.
 * runFlight 와 evaluate 의 거리, 체공 시간이 같다는 것은 independent.test.ts 의 B7 이 따로 확인한다.
 */
import {
  LIMITS, PAPERS, PRESETS, buildGeometry, encodeDesign, validateDesign,
  type FoldOp, type PlaneDesign, type ThrowInput,
} from '../src/core/index';
import { PRESET_PARAM_META, buildPresetDesign } from '../src/core/presets';
import { runFlight } from '../src/core/sim/integrator';

export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const W = 0.21, H = 0.297;
const q4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const q2 = (v: number): number => Math.round(v * 100) / 100;
const q1 = (v: number): number => Math.round(v * 10) / 10;
const clampN = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export type Mode = 'distance' | 'airtime';

/** 후보 하나: 프리셋에서 만든 것이면 presetId 와 조절값이 있고, 자유접기면 design 만 있다. */
export interface Candidate {
  presetId: string | null;
  params: Record<string, number> | null;
  design: PlaneDesign;
  throwIn: ThrowInput;
}

export interface Scored {
  cand: Candidate;
  distanceM: number;
  airtimeS: number;
  maxHeightM: number;
  lateralM: number;
  buckled: boolean;
  collapsedAtLaunch: boolean;
}

export const score = (s: Scored, mode: Mode): number => (mode === 'distance' ? s.distanceM : s.airtimeS);
export const codeOf = (s: Scored): string => encodeDesign(s.cand.design, s.cand.throwIn);

export class Searcher {
  evals = 0;
  private cache = new Map<string, Scored>();

  run(cand: Candidate): Scored {
    const key = encodeDesign(cand.design, cand.throwIn);
    const hit = this.cache.get(key);
    if (hit) return hit;
    this.evals++;
    const f = runFlight(buildGeometry(cand.design), cand.throwIn);
    const out: Scored = {
      cand,
      distanceM: Math.hypot(f.landing.x, f.landing.y),
      airtimeS: f.airtimeS,
      maxHeightM: f.maxHeightM,
      lateralM: f.landing.y,
      buckled: f.buckled,
      collapsedAtLaunch: f.collapsedAtLaunch,
    };
    this.cache.set(key, out);
    return out;
  }
}

export function presetCandidate(
  presetId: string, params: Record<string, number>, paperId: string, clipX: number | null, throwIn: ThrowInput,
): Candidate {
  const design = buildPresetDesign(presetId, params, paperId);
  if (clipX !== null) design.clip = { xBodyM: q4(clipX) };
  return { presetId, params: { ...params }, design, throwIn: { speedMps: q2(throwIn.speedMps), pitchDeg: q1(throwIn.pitchDeg), rollDeg: q1(throwIn.rollDeg) } };
}

export function defaultParams(presetId: string): Record<string, number> {
  const p = PRESETS.find((x) => x.id === presetId)!;
  return { ...p.params };
}

/** 프리셋 조절값을 범위 안에서 임의로 고른다(30% 는 기본값 그대로). */
export function randomPresetCandidate(rnd: () => number): Candidate {
  const p = PRESETS[Math.floor(rnd() * PRESETS.length)]!;
  const params: Record<string, number> = {};
  for (const m of PRESET_PARAM_META[p.id]!) params[m.key] = rnd() < 0.3 ? m.default : m.min + rnd() * (m.max - m.min);
  const paperId = PAPERS[Math.floor(rnd() * PAPERS.length)]!.id;
  const clip = rnd() < 0.25 ? -rnd() * 0.25 : null;
  return presetCandidate(p.id, params, paperId, clip, randomThrow(rnd));
}

export function randomThrow(rnd: () => number): ThrowInput {
  const span = LIMITS.throwSpeedMax - LIMITS.throwSpeedMin;
  return {
    speedMps: q2(rnd() < 0.5 ? LIMITS.throwSpeedMax : LIMITS.throwSpeedMin + rnd() * span),
    pitchDeg: q1(-10 + rnd() * 70),
    rollDeg: 0,
  };
}

/** 임의 자유접기: 가로 접기와 좌우 대칭 한 쌍 접기를 0~5번. 좌우 대칭이라 똑바로 난다(비대칭은 휘어서 거리 손해). */
export function randomFreeFolds(rnd: () => number): FoldOp[] {
  const n = Math.floor(rnd() * 6);
  const out: FoldOp[] = [];
  for (let i = 0; i < n; i++) {
    const dir = rnd() < 0.8 ? 'valley' : 'mountain';
    if (rnd() < 0.45) {
      const y = q4((rnd() - 0.3) * H * 0.9);
      out.push({ a: { x: -W / 2, y }, b: { x: W / 2, y }, dir });
    } else {
      const ax = q4(-rnd() * W / 2), ay = q4((rnd() - 0.5) * H), bx = q4(-rnd() * 0.02), by = q4((rnd() - 0.2) * H * 0.6);
      out.push({ a: { x: ax, y: ay }, b: { x: bx, y: by }, dir }, { a: { x: -bx || 0, y: by }, b: { x: -ax || 0, y: ay }, dir });
    }
  }
  return out;
}

export function randomFreeCandidate(rnd: () => number): Candidate {
  for (;;) {
    const design: PlaneDesign = {
      v: 1,
      paperId: PAPERS[Math.floor(rnd() * PAPERS.length)]!.id,
      folds: rnd() < 0.15 ? [] : randomFreeFolds(rnd),
      shaping: {
        keelM: q4(rnd() < 0.15 ? 0 : rnd() * 0.04),
        dihedralDeg: q1(-5 + rnd() * 30),
        wingletM: q4(rnd() < 0.6 ? 0 : rnd() * 0.03),
        wingletDeg: q1(-90 + rnd() * 180),
        elevatorDeg: q1(-5 + rnd() * 20),
      },
      clip: rnd() < 0.4 ? { xBodyM: q4(-rnd() * 0.25) } : null,
    };
    if (!validateDesign(design).ok) continue;
    return { presetId: null, params: null, design, throwIn: randomThrow(rnd) };
  }
}

/** 후보를 조금 바꾼다: 조절값 하나, 던지기, 종이, 클립 중 하나. 검사를 통과하지 못하면 원래 후보를 돌려준다. */
export function mutate(c: Candidate, rnd: () => number): Candidate {
  for (let tries = 0; tries < 20; tries++) {
    const th: ThrowInput = { ...c.throwIn };
    let paperId = c.design.paperId;
    let clip: number | null = c.design.clip ? c.design.clip.xBodyM : null;
    const k = rnd();
    // 던지기 값
    if (k < 0.14) th.speedMps = q2(clampN(th.speedMps + (rnd() - 0.5) * 2, LIMITS.throwSpeedMin, LIMITS.throwSpeedMax));
    else if (k < 0.32) th.pitchDeg = q1(clampN(th.pitchDeg + (rnd() - 0.5) * 16, LIMITS.pitchMin, LIMITS.pitchMax));
    else if (k < 0.40) paperId = PAPERS[Math.floor(rnd() * PAPERS.length)]!.id;
    else if (k < 0.50) clip = rnd() < 0.3 ? null : q4(-rnd() * 0.25);
    if (k < 0.50) {
      if (c.presetId !== null && c.params !== null) return presetCandidate(c.presetId, c.params, paperId, clip, th);
      const design: PlaneDesign = { ...c.design, paperId, clip: clip === null ? null : { xBodyM: clip } };
      if (validateDesign(design).ok) return { presetId: null, params: null, design, throwIn: th };
      continue;
    }
    // 형상 값
    if (c.presetId !== null && c.params !== null) {
      const metas = PRESET_PARAM_META[c.presetId]!;
      const m = metas[Math.floor(rnd() * metas.length)]!;
      const params = { ...c.params };
      let v = clampN((params[m.key] ?? m.default) + (rnd() - 0.5) * (m.max - m.min) * 0.3, m.min, m.max);
      if (m.unit === 'count') v = Math.round(v);
      params[m.key] = v;
      return presetCandidate(c.presetId, params, paperId, clip, th);
    }
    const design: PlaneDesign = JSON.parse(JSON.stringify(c.design)) as PlaneDesign;
    const s = design.shaping;
    const j = rnd();
    if (j < 0.2) s.keelM = q4(clampN(s.keelM + (rnd() - 0.5) * 0.01, 0, 0.05));
    else if (j < 0.4) s.dihedralDeg = q1(clampN(s.dihedralDeg + (rnd() - 0.5) * 10, LIMITS.dihedralMin, LIMITS.dihedralMax));
    else if (j < 0.65) s.elevatorDeg = q1(clampN(s.elevatorDeg + (rnd() - 0.5) * 5, LIMITS.elevatorMin, LIMITS.elevatorMax));
    else if (j < 0.8) {
      s.wingletM = q4(clampN(s.wingletM + (rnd() - 0.5) * 0.01, 0, 0.04));
      s.wingletDeg = q1(clampN(s.wingletDeg + (rnd() - 0.5) * 40, LIMITS.wingletDegMin, LIMITS.wingletDegMax));
    } else if (design.folds.length > 0) {
      // 가로 접는 선을 앞뒤로 조금 옮긴다
      const f = design.folds[Math.floor(rnd() * design.folds.length)]!;
      if (f.a.y !== f.b.y) continue;
      const y = q4(f.a.y + (rnd() - 0.5) * 0.02);
      f.a.y = y; f.b.y = y;
    } else continue;
    if (validateDesign(design).ok) return { presetId: null, params: null, design, throwIn: th };
  }
  return c;
}

/**
 * 오르기: 상위 keep 개를 남기고 각각 children 개씩 바꿔 보는 것을 rounds 번 되풀이한다.
 * 돌려주는 목록은 점수 내림차순.
 */
export function climb(
  searcher: Searcher, start: Scored[], mode: Mode, rnd: () => number,
  opts: { keep: number; children: number; rounds: number },
): Scored[] {
  const uniq = (list: Scored[]): Scored[] => {
    const seen = new Set<string>();
    const out: Scored[] = [];
    for (const s of list) { const k = codeOf(s); if (!seen.has(k)) { seen.add(k); out.push(s); } }
    return out;
  };
  let pool = uniq(start).sort((a, b) => score(b, mode) - score(a, mode)).slice(0, opts.keep);
  for (let r = 0; r < opts.rounds; r++) {
    const next = [...pool];
    for (const s of pool) for (let j = 0; j < opts.children; j++) next.push(searcher.run(mutate(s.cand, rnd)));
    pool = uniq(next).sort((a, b) => score(b, mode) - score(a, mode)).slice(0, opts.keep);
  }
  return pool;
}

/** 프리셋(기본 조절값) x 종이 x 던지기 격자. 표와 종이별 비교에 쓴다. */
export const GRID_SPEEDS = [4, 6, 8, 10];
export const GRID_PITCHES = [0, 10, 20, 35, 50];

export interface GridCell { presetId: string; paperId: string; best: Record<Mode, Scored>; all: Scored[] }

export function presetPaperGrid(searcher: Searcher): GridCell[] {
  const out: GridCell[] = [];
  for (const p of PRESETS) for (const paper of PAPERS) {
    const all: Scored[] = [];
    for (const v of GRID_SPEEDS) for (const pitch of GRID_PITCHES) {
      all.push(searcher.run(presetCandidate(p.id, defaultParams(p.id), paper.id, null, { speedMps: v, pitchDeg: pitch, rollDeg: 0 })));
    }
    const top = (mode: Mode): Scored => all.reduce((a, b) => (score(b, mode) > score(a, mode) ? b : a));
    out.push({ presetId: p.id, paperId: paper.id, best: { distance: top('distance'), airtime: top('airtime') }, all });
  }
  return out;
}

/** 던지기만 바꿔 가며 오른다(설계는 그대로). 표의 "가장 좋은 던지기"를 다듬는 데 쓴다. */
export function refineThrow(searcher: Searcher, start: Scored, mode: Mode): Scored {
  let best = start;
  for (const [dv, dp] of [[1, 5], [0.5, 2]] as const) {
    for (let it = 0; it < 3; it++) {
      let improved = false;
      for (const [sv, sp] of [[dv, 0], [-dv, 0], [0, dp], [0, -dp]] as const) {
        const th: ThrowInput = {
          speedMps: q2(clampN(best.cand.throwIn.speedMps + sv, LIMITS.throwSpeedMin, LIMITS.throwSpeedMax)),
          pitchDeg: q1(clampN(best.cand.throwIn.pitchDeg + sp, LIMITS.pitchMin, LIMITS.pitchMax)),
          rollDeg: 0,
        };
        const s = searcher.run({ ...best.cand, throwIn: th });
        if (score(s, mode) > score(best, mode) + 1e-9) { best = s; improved = true; }
      }
      if (!improved) break;
    }
  }
  return best;
}
