/**
 * e2e-hangar 검사용 도우미: 격납고에 넣어 볼 비행기 목록과, 저장소에 직접 적어 볼 값(멀쩡한 것 + 망가진 것)을 JSON 으로 찍는다.
 * 실행: npx tsx scripts/e2e-hangar-data.ts
 */
import { encodeDesign, evaluate, PAPERS, PHYSICS_VERSION, PRESETS } from '../src/core/index';
import { buildPresetDesign } from '../src/core/presets';
import { addPlane, emptyHangar, HANGAR_KEY, recordFlight, serializeHangar } from '../src/app/lib/hangar';
import { PHYSICS_KEY } from '../src/app/lib/physicsMigration';

const NAMES = ['신문지 화살 1호', '번개', '느림보 글라이더', '우리 반 대표', '뭉툭이', '하늘이의 비행기', '가나다라마바사아자차카타', '세모 날개', '스텔스 2호', '멀리멀리', '종이새', '도화지 화살 1호',
  '켄트지 뭉툭코', '연습용', '바람돌이', '초록 매트', '쌩쌩이', '구름', '별똥별', '참새', '독수리', '잠자리', '나비', '마지막 한 대'];
const THROW = { speedMps: 7, pitchDeg: 5, rollDeg: 0 };
const now = Date.now();

const seeds = NAMES.map((name, i) => {
  const preset = PRESETS[i % PRESETS.length]!;
  const paper = PAPERS[(i * 5 + Math.floor(i / 5)) % PAPERS.length]!;
  const design = buildPresetDesign(preset.id, { elevatorDeg: 2 + (i % 4) }, paper.id);
  const code = encodeDesign(design);
  // 세 대에 한 대는 아직 날리지 않은 비행기. 나머지는 일부러 낮은 기록을 넣어 둔다(꺼내 날리면 기록이 오르는지 본다).
  const flight = i % 3 === 2 ? undefined : { distanceM: 1 + ((i * 7) % 13) * 0.11, airtimeS: 0.3 + ((i * 5) % 7) * 0.05, throwCode: encodeDesign(design, THROW), at: now - i * 86_400_000 };
  return { name, code, origin: `preset:${preset.id}`, favourite: i % 4 === 1, flight };
});

// 손대지 않은 따라 접기 비행기(글라이더, 일반 복사지)
const untouched = { name: '처음 그대로', code: encodeDesign(PRESETS.find((p) => p.id === 'glider')!.design), origin: 'preset:glider' };
// 아직 격납고에 없는 비행기의 코드(친구가 준 코드 흉내)
const friendCode = encodeDesign(buildPresetDesign('delta', { elevatorDeg: 4.5 }, 'kent160'), THROW);

// 저장소에 직접 적어 볼 값: 멀쩡한 두 대 + 망가진 세 칸
let good = emptyHangar();
for (const s of seeds.slice(0, 2)) {
  const r = addPlane(good, { name: s.name, code: s.code, origin: s.origin as 'free' }, now);
  if (r.ok) good = r.data;
}
// 멀쩡한 비행기의 최고 기록은 "진짜로 저장돼 있을 법한 값"으로 넣는다: 그때 던진 코드를 지금의 core 로 계산한 값 그대로다.
// (지어낸 숫자를 넣으면, 물리 판이 바뀐 것으로 보고 다시 재는 일이 그 숫자를 옳게 고쳐 버린다.)
const goodDesign = buildPresetDesign(PRESETS[0]!.id, { elevatorDeg: 2 }, PAPERS[0]!.id);
const goodFlight = evaluate(goodDesign, THROW).result;
good = recordFlight(good, { designCode: seeds[0]!.code, distanceM: goodFlight.distanceM, airtimeS: goodFlight.airtimeS, throwCode: encodeDesign(goodDesign, THROW), at: now }).data;
if (good.planes[0]?.best.distance?.value !== goodFlight.distanceM) throw new Error('멀쩡한 비행기의 기록을 넣지 못했어요');
const parsed = JSON.parse(serializeHangar(good)) as { v: number; planes: unknown[] };
const corrupt = JSON.stringify({ v: 1, planes: [parsed.planes[0], { id: 'broken1', name: '망가진 것', code: 'this-is-not-a-code' }, null, parsed.planes[1], { nonsense: true }] });

console.log(JSON.stringify({
  key: HANGAR_KEY, seeds, untouched, friendCode, corrupt, garbage: '{"v":1,"planes":[{"id":',
  // 저장소에 직접 적을 때 같이 적는 물리 판 표시(지금 판의 앱이 적어 둔 저장소라는 뜻)와, 멀쩡한 비행기의 진짜 기록
  physicsKey: PHYSICS_KEY, physics: PHYSICS_VERSION, goodBest: { distanceM: goodFlight.distanceM, airtimeS: goodFlight.airtimeS },
}));
