/**
 * e2e-lab 검사용 도우미: 바람 실험실 화면에 보이는 숫자를 core 로 직접 계산해 JSON 으로 찍는다.
 * 화면이 쓰는 것과 같은 글자 만들기 함수(lib/lab/labMath.ts)를 쓰되, 힘은 core 의 probeTunnel / tunnelTrim 을 여기서 따로 부른다.
 *
 * 실행:
 *   npx tsx scripts/e2e-lab-data.ts                              검사에 쓸 비행기들(안정한 것, 뒤가 무거운 것)
 *   npx tsx scripts/e2e-lab-data.ts probe <코드> <속도> <각도> [옆바람]   그 입력의 계산값
 *   npx tsx scripts/e2e-lab-data.ts scan <코드> [속도]                 균형 각도, 좋아하는 속도, 딱 좋은 각도, 실속 각도, 뜨는 속도
 */
import { buildGeometry, decodeDesign, encodeDesign, LIMITS, PHYSICS_VERSION, probeTunnel, TUNNEL_LIMITS, tunnelTrim } from '../src/core/index';
import type { PlaneDesign } from '../src/core/index';
import { buildPresetDesign } from '../src/core/presets';
import { balanceOutcome, findBuckleSpeed, findFavouriteSpeed, fmt1, gfText, isStalledView, liftHeadline, measureLabNote, starsOf, strongWind, sweepAlpha, WIND_WORD, windLevel } from '../src/app/lib/lab/labMath';
import type { TunnelDeps } from '../src/app/lib/lab/labMath';

const deps: TunnelDeps = { probe: probeTunnel, trim: tunnelTrim, limits: TUNNEL_LIMITS };
const [cmd, code, a, b, c] = process.argv.slice(2);

function geomOf(designCode: string) {
  const dec = decodeDesign(designCode);
  if (!dec) throw new Error('코드가 올바르지 않아요');
  return buildGeometry(dec.design);
}

if (cmd === 'probe') {
  const g = geomOf(code ?? '');
  const speed = Number(a), alpha = Number(b), beta = Number(c ?? 0);
  const r = probeTunnel(g, { speedMps: speed, alphaDeg: alpha, betaDeg: beta });
  console.log(JSON.stringify({
    liftN: r.liftN, dragN: r.dragN, weightN: r.weightN, liftToWeight: r.liftToWeight, liftToDrag: r.liftToDrag, stalledFraction: r.stalledFraction,
    flexLeftDeg: r.flexLeftDeg, flexRightDeg: r.flexRightDeg, buckled: r.buckled,
    liftG: gfText(r.liftN), dragG: gfText(r.dragN), weightG: gfText(r.weightN),
    headline: liftHeadline(r, speed).text, stars: starsOf(r.liftToDrag), stalledView: isStalledView(r, speed),
    wind: WIND_WORD[windLevel(speed, TUNNEL_LIMITS.speedMax)],
  }));
} else if (cmd === 'scan') {
  const g = geomOf(code ?? '');
  const speed = Number(a ?? 6);
  const trim = tunnelTrim(g, speed);
  const sweep = sweepAlpha(deps, g, speed);
  // 정해진 각도(5도)에서 바람을 0.5 씩 올릴 때 처음으로 뜨는 속도
  let liftSpeedAt5: number | null = null;
  for (let v = 0.5; v <= TUNNEL_LIMITS.speedMax + 1e-9; v += 0.5) {
    if (probeTunnel(g, { speedMps: v, alphaDeg: 5 }).liftToWeight >= 1) { liftSpeedAt5 = v; break; }
  }
  console.log(JSON.stringify({
    speed, trim, trimText: trim.alphaDeg === null ? null : fmt1(trim.alphaDeg),
    outcome: balanceOutcome(deps, g, speed, 5),
    favourite: findFavouriteSpeed(deps, g),
    bestAlphaDeg: sweep.bestAlphaDeg, bestLiftToDrag: sweep.bestLiftToDrag, stallAlphaDeg: sweep.stallAlphaDeg,
    liftSpeedAt5, buckleSpeed: findBuckleSpeed(deps, g, 5),
    note: measureLabNote(deps, g, PHYSICS_VERSION, 0),
  }));
} else {
  const THROW = { speedMps: 7, pitchDeg: 5, rollDeg: 0 };
  const plane = (name: string, presetId: string, paperId: string) => {
    const design = buildPresetDesign(presetId, undefined, paperId);
    return { name, code: encodeDesign(design), origin: `preset:${presetId}`, flight: { distanceM: 3.21, airtimeS: 0.9, throwCode: encodeDesign(design, THROW), at: Date.now() - 86_400_000 } };
  };
  // 뒤가 무거운 비행기: 꼬리 쪽을 앞으로 접어 올려 무게중심이 뒤로 간 종이(혼자 두면 균형을 못 잡는다)
  const tailHeavy: PlaneDesign = {
    v: 1, paperId: 'copy80',
    folds: [{ a: { x: 0.2, y: -0.05 }, b: { x: -0.2, y: -0.05 }, dir: 'valley' }],
    shaping: { keelM: 0.02, dihedralDeg: 10, wingletM: 0, wingletDeg: 0, elevatorDeg: 0 },
    clip: null,
  };
  const tailCode = encodeDesign(decodeDesign(encodeDesign(tailHeavy))!.design);
  console.log(JSON.stringify({
    limits: TUNNEL_LIMITS,
    physics: PHYSICS_VERSION,
    strong: strongWind(TUNNEL_LIMITS),
    seeds: [
      plane('뾰족 화살', 'dart', 'copy80'),
      plane('느림보 글라이더', 'glider', 'craft120'),
      plane('신문지 세모', 'delta', 'newsprint'),
      { name: '뒤뚱이', code: tailCode, origin: 'free' },
    ],
    dartThin: encodeDesign(buildPresetDesign('dart', undefined, 'newsprint')),
    throwCode: encodeDesign(buildPresetDesign('dart', undefined, 'copy80'), THROW),
    // 던지기 한도가 16 m/s 이던 때(물리 1판)의 센 던지기가 담긴 코드: 지금 한도를 넘는 힘이다(둘째 비행기의 모양으로 던진 것).
    oldThrowCode: encodeDesign(buildPresetDesign('glider', undefined, 'craft120'), { speedMps: LIMITS.throwSpeedMax + 4, pitchDeg: 10, rollDeg: 0 }),
  }));
}
