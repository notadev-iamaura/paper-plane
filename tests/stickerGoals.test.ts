/**
 * 스티커 목표가 "실제로 받을 수 있는지"를 core 의 공개 창구(evaluate)로 확인한다.
 *
 * 스티커마다 받을 수 있는 설계 + 던지기를 하나씩 적어 두고, 그 비행을 계산해 화면과 같은 규칙(addFlight)에 넣어 본다.
 * 물리(src/core)가 바뀌어 어떤 목표에 닿을 수 없게 되면 여기서 먼저 알게 된다. 그때는
 *   1) 아래의 증명용 설계를 다시 찾거나(프리셋 조절값과 던지기를 조금씩 바꿔 보는 작은 격자면 충분하다),
 *   2) src/app/lib/stickers.ts 의 STICKER_GOALS 숫자를 새 범위에 맞게 고친다.
 * 증명용 설계는 모두 놀이 안에서 아이가 만들 수 있는 것이다(따라 접기 + 날개 다듬기 범위, 클립, 내 맘대로 접기로 옮기기).
 */
import { describe, expect, it } from 'vitest';
import { LIMITS, PAPERS, PRESETS, encodeDesign, decodeDesign, evaluate, validateSubmission } from '../src/core/index';
import type { PlaneDesign, SimResult, ThrowInput } from '../src/core/index';
import { buildPresetDesign, defaultPresetParams } from '../src/core/presets';
import { STAMP_GOALS, gradeOf } from '../src/app/lib/kidvoice';
import { STICKERS, STICKER_GOALS, addFlight, addHangarFacts, emptyProgress } from '../src/app/lib/stickers';
import type { FlightFacts, StickerId, StickerProgress } from '../src/app/lib/stickers';
import { defaultState, designFromState, isAuthoredFreeFold, reducer } from '../src/app/state';

const FULL = LIMITS.throwSpeedMax;
const th = (speedMps: number, pitchDeg: number, rollDeg = 0): ThrowInput => ({ speedMps, pitchDeg, rollDeg });
const tuned = (presetId: string, paperId: string, patch: Record<string, number> = {}): PlaneDesign =>
  buildPresetDesign(presetId, { ...defaultPresetParams(presetId), ...patch }, paperId);

/** 화면과 똑같이: 코드로 바꿨다 되돌린 값으로 계산한다(공유 코드, 랭킹 서버와 같은 숫자). */
function fly(design: PlaneDesign, throwIn: ThrowInput): SimResult {
  const dec = decodeDesign(encodeDesign(design, throwIn));
  expect(dec?.throwIn, '던지기가 지금 한도 안이어야 한다').toBeDefined();
  expect(validateSubmission(dec!.design, dec!.throwIn)).toEqual({ ok: true, errors: [] });
  return evaluate(dec!.design, dec!.throwIn!).result;
}

function facts(design: PlaneDesign, r: SimResult, extra: Partial<FlightFacts> = {}): FlightFacts {
  return {
    distanceM: r.distanceM, airtimeS: r.airtimeS, lateralM: r.lateralM, verdict: r.verdict,
    paperId: design.paperId, presetId: null, free: false, hasClip: design.clip !== null, ...extra,
  };
}

/** 빈 스티커판에 이 비행 하나를 더했을 때 새로 받는 스티커 */
const earned = (f: FlightFacts, prev: StickerProgress = emptyProgress()): StickerId[] => addFlight(prev, f, 1).fresh;

describe('스티커 목표: 숫자와 글', () => {
  it('목표 숫자는 물리 2판의 범위 안에서 쉬운 것부터 어려운 것 순서다', () => {
    expect(STICKER_GOALS.newsM).toBeLessThan(STICKER_GOALS.farM);
    expect(STICKER_GOALS.farM).toBeLessThan(STICKER_GOALS.farTopM);
    expect(STICKER_GOALS.longS).toBeLessThan(STICKER_GOALS.longTopS);
    // 도장: 참 잘했어요가 잘했어요보다 어렵고, 가장 먼 / 긴 스티커는 참 잘했어요보다 어렵다.
    expect(STAMP_GOALS.distance.good).toBeLessThan(STAMP_GOALS.distance.great);
    expect(STAMP_GOALS.airtime.good).toBeLessThan(STAMP_GOALS.airtime.great);
    expect(STAMP_GOALS.distance.great).toBeLessThan(STICKER_GOALS.farTopM);
    expect(STAMP_GOALS.airtime.great).toBeLessThan(STICKER_GOALS.longTopS);
  });

  it('스티커 이름과 설명에 적힌 숫자가 목표 숫자와 같다(옛 숫자가 남아 있지 않다)', () => {
    const def = (id: StickerId) => STICKERS.find((s) => s.id === id)!;
    expect(def('d10').name).toBe(`${STICKER_GOALS.farM} m 넘기기`);
    expect(def('d20').name).toBe(`${STICKER_GOALS.farTopM} m 넘기기`);
    expect(def('t3').name).toBe(`${STICKER_GOALS.longS}초 버티기`);
    expect(def('t5').name).toBe(`${STICKER_GOALS.longTopS}초 버티기`);
    expect(def('news8').how).toContain(`${STICKER_GOALS.newsM} m`);
    for (const id of ['free10', 'straight', 'clip10'] as const) expect(def(id).how).toContain(`${STICKER_GOALS.farM} m`);
    expect(def('straight').how).toContain(`${STICKER_GOALS.straightSideM} m`);
    for (const s of STICKERS) expect(`${s.name} ${s.how}`, s.id).not.toMatch(/20 m|(?<![.\d])5초/);
  });

  it('도장 문턱: 멀리 12 m / 8 m, 오래 3.0 초 / 2.2 초', () => {
    expect(STAMP_GOALS).toEqual({ distance: { great: 12, good: 8 }, airtime: { great: 3.0, good: 2.2 } });
    const r = (distanceM: number, airtimeS: number) => ({ distanceM, airtimeS });
    expect([gradeOf('distance', r(12, 0)), gradeOf('distance', r(11.99, 9)), gradeOf('distance', r(8, 0)), gradeOf('distance', r(7.99, 9))]).toEqual(['great', 'good', 'good', 'again']);
    expect([gradeOf('airtime', r(0, 3)), gradeOf('airtime', r(99, 2.99)), gradeOf('airtime', r(0, 2.2)), gradeOf('airtime', r(99, 2.19))]).toEqual(['great', 'good', 'good', 'again']);
  });
});

describe('스티커 목표: 스티커마다 받을 수 있는 비행이 하나씩 있다', () => {
  // 기본 화살(일반 복사지)을 힘껏, 살짝 아래로: 처음 접는 비행기로도 닿는 목표들의 증명에 같이 쓴다.
  const dart = PRESETS.find((p) => p.id === 'dart')!.design;

  it('처음 던지기, 10 m 넘기기, 똑바로 날리기: 기본 화살을 힘껏', () => {
    const r = fly(dart, th(FULL, -5));
    expect(r.distanceM).toBeGreaterThanOrEqual(STICKER_GOALS.farM);
    expect(Math.abs(r.lateralM)).toBeLessThanOrEqual(STICKER_GOALS.straightSideM);
    const got = earned(facts(dart, r, { presetId: 'dart' }));
    expect(got).toEqual(expect.arrayContaining(['first', 'd10', 'straight']));
    // 꿈의 목표는 기본 화살로는 받지 못한다.
    expect(got).not.toContain('d20');
    expect(got).not.toContain('t5');
  });

  it('18 m 넘기기(가장 먼 목표): 스텔스를 고급 복사지로 접고 뒷전을 조금 내리고 몸통을 얕게, 힘껏', () => {
    const design = tuned('stealth', 'copy100', { elevatorDeg: -1.5, keelM: 0.012 });
    const r = fly(design, th(FULL, 5));
    expect(r.distanceM).toBeGreaterThanOrEqual(STICKER_GOALS.farTopM);
    expect(r.structure.buckled).toBe(false);
    expect(earned(facts(design, r))).toContain('d20');
    // 기본 접는 법 그대로는 닿지 않아야 "꿈의 목표"다: 기본값으로 가장 멀리 가는 넓은 세모 날개(일반 복사지)도 모자란다.
    const best = fly(PRESETS.find((p) => p.id === 'delta')!.design, th(FULL, 0));
    expect(best.distanceM).toBeGreaterThan(STAMP_GOALS.distance.great);
    expect(best.distanceM).toBeLessThan(STICKER_GOALS.farTopM);
    expect(fly(tuned('stealth', 'copy100'), th(FULL, 5)).distanceM).toBeLessThan(STICKER_GOALS.farTopM);
  });

  it('3초 버티기: 넓은 세모 날개를 신문지로 접어 보통 힘으로', () => {
    const design = tuned('delta', 'newsprint');
    const r = fly(design, th(6, 10));
    expect(r.airtimeS).toBeGreaterThanOrEqual(STICKER_GOALS.longS);
    expect(earned(facts(design, r, { presetId: 'delta' }))).toContain('t3');
  });

  it('4.5초 버티기(가장 긴 목표): 스텔스를 얇은 복사지로 접고 몸통을 얕게, 힘껏 위로', () => {
    const design = tuned('stealth', 'copy60', { elevatorDeg: -0.5, keelM: 0.012 });
    const r = fly(design, th(FULL, 15));
    expect(r.airtimeS).toBeGreaterThanOrEqual(STICKER_GOALS.longTopS);
    expect(earned(facts(design, r))).toContain('t5');
    // 기본 접는 법 그대로는 닿지 않는다: 기본값으로 가장 오래 뜨는 넓은 세모 날개(일반 복사지)도 조금 모자란다.
    const best = fly(PRESETS.find((p) => p.id === 'delta')!.design, th(FULL, 15));
    expect(best.airtimeS).toBeGreaterThan(STAMP_GOALS.airtime.great);
    expect(best.airtimeS).toBeLessThan(STICKER_GOALS.longTopS);
  });

  it('신문지로 8 m: 신문지 글라이더를 힘껏(날개가 꺾일 듯 휘지만 버틴다)', () => {
    const design = tuned('glider', 'newsprint');
    const r = fly(design, th(FULL, 5));
    expect(r.distanceM).toBeGreaterThanOrEqual(STICKER_GOALS.newsM);
    expect(r.structure.buckled).toBe(false);
    expect(earned(facts(design, r, { presetId: 'glider' }))).toContain('news8');
    // 다른 종이로는 받지 못한다.
    expect(earned(facts({ ...design, paperId: 'copy80' }, r))).not.toContain('news8');
  });

  it('내 맘대로 10 m: 직접 접은 화살로 목표에 닿는다. 모드 전환만으로는 받지 않는다', () => {
    let s = defaultState();
    s = reducer(s, { type: 'presetPick', presetId: 'dart' });
    s = reducer(s, { type: 'presetInstant' });
    s = reducer(s, { type: 'convertToFree' });
    expect(isAuthoredFreeFold(s)).toBe(false);
    const folds = designFromState(s).folds;
    s = reducer(s, { type: 'freeSet', folds: [] });
    for (let i = 1; i <= folds.length; i++) s = reducer(s, { type: 'freeSet', folds: folds.slice(0, i) });
    const design = designFromState(s);
    expect(s.foldMode).toBe('free');
    expect(design.folds.length).toBeGreaterThan(0);
    const r = fly(design, th(FULL, -5));
    expect(r.distanceM).toBeGreaterThanOrEqual(STICKER_GOALS.farM);
    expect(earned(facts(design, r, { free: isAuthoredFreeFold(s) }))).toContain('free10');
    expect(earned(facts(design, r, { free: false }))).not.toContain('free10');
  });

  it('빙글빙글: 앞을 두 번만 말아 접은(뒤가 무거운) 글라이더를 힘껏 위로', () => {
    const design = tuned('glider', 'copy80', { noseFolds: 2 });
    const r = fly(design, th(FULL, 20));
    expect(r.verdict).toBe('tumble');
    expect(earned(facts(design, r))).toContain('spin');
  });

  it('클립 달고 10 m: 기본 화살에 클립을 끼우고 힘껏', () => {
    const design: PlaneDesign = { ...dart, clip: { xBodyM: -0.05 } };
    const r = fly(design, th(FULL, -5));
    expect(r.distanceM).toBeGreaterThanOrEqual(STICKER_GOALS.farM);
    expect(earned(facts(design, r))).toContain('clip10');
    expect(earned(facts(dart, r))).not.toContain('clip10');
  });

  it('다섯 가지 모두, 열 번 던지기: 다섯 접는 법을 두 번씩 던지면 둘 다 받는다', () => {
    let progress = emptyProgress();
    const got: StickerId[] = [];
    for (let round = 0; round < 2; round++) {
      for (const p of PRESETS) {
        const out = addFlight(progress, { distanceM: 5, airtimeS: 1.5, lateralM: 0, verdict: 'glide', paperId: 'copy80', presetId: p.id, free: false, hasClip: false }, 1);
        progress = out.progress;
        got.push(...out.fresh);
      }
    }
    expect(progress.throws).toBe(10);
    expect(got).toEqual(expect.arrayContaining(['first', 'all5', 'ten']));
  });

  it('격납고 스티커: 한 대, 다섯 대, 종이 여섯 가지', () => {
    const a = addHangarFacts(emptyProgress(), { planes: 1, paperKinds: 1, allPapers: PAPERS.length }, 1);
    expect(a.fresh).toEqual(['hangar1']);
    const b = addHangarFacts(a.progress, { planes: 6, paperKinds: PAPERS.length, allPapers: PAPERS.length }, 2);
    expect(b.fresh).toEqual(['hangar5', 'paper6']);
  });

  it('빠진 스티커가 없다: 위의 증명이 스티커판의 모든 스티커를 덮는다', () => {
    const proven: StickerId[] = ['first', 'd10', 'd20', 't3', 't5', 'news8', 'all5', 'free10', 'spin', 'straight', 'clip10', 'ten', 'hangar1', 'hangar5', 'paper6'];
    expect(STICKERS.map((s) => s.id).sort()).toEqual([...proven].sort());
  });
});
