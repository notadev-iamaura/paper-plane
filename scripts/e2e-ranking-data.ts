/**
 * e2e-ranking 검사용 도우미: 순위표에 깔아 둘 기록과 "정답"을 JSON 으로 찍는다.
 * 정답은 순위표 코드를 거치지 않고 core 의 evaluate 로 바로 계산한다(화면이 보여 주는 순서와 견주는 독립된 기준).
 * 실행: npx tsx scripts/e2e-ranking-data.ts
 */
import { decodeDesign, encodeDesign, evaluate, LIMITS, PAPERS, PRESETS, validateSubmission } from '../src/core/index';
import { buildPresetDesign } from '../src/core/presets';

const NAMES = ['종이왕', '번개', '느림보', '우리반대표', '뭉툭이', '하늘이', '가나다라마바사아자차카타파하가나', '세모날개', '스텔스', '멀리멀리', '종이새', '도화지',
  '켄트', '연습중', '바람돌이', '초록매트', '쌩쌩이', '구름', '별똥별', '참새', '독수리', '잠자리', '나비', '<b>굵게</b>', '체육관지기', '색종이', 'Paper Ace', '비행사', '줄자', '도장',
  '콘', '마루', '현수막', '만국기', '전광판', '출발선', '책상', '연필', '지우개', '공책', '스티커', '딱지', '풍선', '호루라기', '심판', '응원단', '이름표', '클립', '모눈', '끝번'];

// 던지는 힘은 모두 지금 한도(LIMITS.throwSpeedMin ~ throwSpeedMax)에서 만든다. 한도가 바뀌어도 이 파일은 고칠 필요가 없다.
const V_MIN = LIMITS.throwSpeedMin, V_MAX = LIMITS.throwSpeedMax;
/** 한도 안의 빠르기: k = 0 이면 가장 살살, 1 이면 가장 세게 (0.1 m/s 단위) */
const speedAt = (k: number): number => Math.round((V_MIN + (V_MAX - V_MIN) * Math.min(1, Math.max(0, k))) * 10) / 10;

function official(code: string): { distance: number; airtime: number; verdict: string; paperId: string } | null {
  const dec = decodeDesign(code);
  if (!dec || !dec.throwIn || !validateSubmission(dec.design, dec.throwIn).ok) return null;
  const r = evaluate(dec.design, dec.throwIn).result;
  return { distance: r.distanceM, airtime: r.airtimeS, verdict: r.verdict, paperId: dec.design.paperId };
}

const base = Date.UTC(2026, 10, 1);
const valid: { id: string; nickname: string; code: string; at: number; distance: number; airtime: number; verdict: string; paperId: string }[] = [];
for (let i = 0; valid.length < 49; i++) {
  const preset = PRESETS[i % PRESETS.length]!;
  const paper = PAPERS[(i * 5 + Math.floor(i / 5)) % PAPERS.length]!;
  const design = buildPresetDesign(preset.id, { elevatorDeg: 0.5 + (i % 6) * 0.5 }, paper.id);
  // 보통 힘에서 가장 센 힘까지 17단계로 고르게
  const code = encodeDesign(design, { speedMps: speedAt(0.375 + (((i * 7) % 17) / 16) * 0.625), pitchDeg: -2 + ((i * 11) % 23), rollDeg: 0 });
  const o = official(code);
  if (!o) throw new Error(`깔아 둘 기록 ${i}번의 코드가 규칙에 맞지 않아요(던지기 한도를 확인해 주세요)`);
  const n = valid.length;
  valid.push({ id: `player-${String(n).padStart(2, '0')}`, nickname: NAMES[n]!, code, at: base + n * 60_000, ...o });
}
// 동점 다툼: 50번째 선수는 3번 선수와 같은 코드를 나중에 올렸다(같은 점수, 늦은 시각 -> 바로 아래).
valid.push({ ...valid[3]!, id: 'player-copycat', nickname: '따라쟁이', at: base + 999 * 60_000 });

const docs: Record<string, unknown> = {};
for (const v of valid) docs[v.id] = { v: 1, distance: { code: v.code, nickname: v.nickname, at: v.at }, airtime: { code: v.code, nickname: v.nickname, at: v.at } };
// 진짜 코드에 가짜 점수 칸을 붙인 두 사람: 순위표에는 진짜 값으로만 오른다.
const liars = [valid[10]!.id, valid[20]!.id];
for (const id of liars) {
  const d = docs[id] as { distance: Record<string, unknown>; airtime: Record<string, unknown> } & Record<string, unknown>;
  d.score = 99999; d.distanceM = 99999; d.airtimeS = 99999;
  Object.assign(d.distance, { score: 99999, distanceM: 99999, rank: 1 });
  Object.assign(d.airtime, { score: 99999, airtimeS: 99999, rank: 1 });
}

// 순위표에 나오면 안 되는 꾸민 문서 열 개
const good = valid[0]!.code;
const tampered = (() => {
  for (let i = good.length - 1; i > 2; i--) {
    const t = good.slice(0, i) + (good[i] === 'Z' ? 'Y' : 'Z') + good.slice(i + 1);
    if (!official(t) && !decodeDesign(t)) return t;
  }
  throw new Error('풀리지 않는 고친 코드를 만들지 못했어요');
})();
const noThrow = encodeDesign(buildPresetDesign('dart', {}, 'copy80'));
const forged: Record<string, unknown> = {
  'forged-fake-score': { v: 1, score: 500, distance: { code: tampered, nickname: '가짜점수', at: base, score: 500, distanceM: 500 }, airtime: { code: tampered, nickname: '가짜점수', at: base, score: 500, airtimeS: 500 } },
  'forged-tampered': { v: 1, distance: { code: tampered, nickname: '고친코드', at: base } },
  'forged-garbage': { v: 1, distance: { code: 'P1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', nickname: '쓰레기코드', at: base, distanceM: 400 }, airtime: { code: 'hello', nickname: '쓰레기코드', at: base } },
  'forged-no-throw': { v: 1, distance: { code: noThrow, nickname: '안던진코드', at: base, distanceM: 300 }, airtime: { code: noThrow, nickname: '안던진코드', at: base } },
  'forged-no-code': { v: 1, distance: { nickname: '코드없음', at: base, score: 200, distanceM: 200 } },
  'forged-number': { v: 1, distance: 12345, airtime: '99.9' },
  'forged-version': { v: 2, distance: { code: good, nickname: '다른판', at: base } },
  'forged-noname': { v: 1, distance: { code: good, nickname: '\u0000\u0001  ', at: base }, airtime: { code: good, nickname: '가'.repeat(40), at: base } },
  'forged-long': { v: 1, distance: { code: 'P1' + 'a'.repeat(3000), nickname: '너무긴코드', at: base } },
  'forged-array': { v: 1, distance: [good, '배열', base], airtime: null },
};
const forgedNames = ['가짜점수', '고친코드', '쓰레기코드', '안던진코드', '코드없음', '다른판', '너무긴코드', '배열'];

// 내가 올려 볼 세 번의 비행: 낮은 것 -> 높은 것 -> 그 사이 것 (멀리 날리기)
const mineAll = [0, 1, 2, 3, 4].map((k) => {
  const code = encodeDesign(buildPresetDesign(PRESETS[k % PRESETS.length]!.id, { elevatorDeg: 2 }, 'copy100'), { speedMps: speedAt(0.5 + k * 0.125), pitchDeg: 9 + k, rollDeg: 0 });
  const o = official(code);
  if (!o) throw new Error(`내 비행 ${k}번의 코드가 규칙에 맞지 않아요`);
  return { code, ...o };
}).sort((a, b) => a.distance - b.distance);
const mine = { low: mineAll[0]!, mid: mineAll[2]!, high: mineAll[4]! };
if (!(mine.low.distance < mine.mid.distance && mine.mid.distance < mine.high.distance)) throw new Error('내 비행 세 번의 거리가 서로 달라야 해요');

// 두 번째 선수가 나중에 올릴 기록(가장 멀리)
// 날개를 다듬은 스텔스를 가장 세게: tests/stickerGoals.test.ts 의 "가장 먼 목표" 증명과 같은 비행기다.
const friendCode = encodeDesign(buildPresetDesign('stealth', { elevatorDeg: -1.5, keelM: 0.012 }, 'copy100'), { speedMps: V_MAX, pitchDeg: 5, rollDeg: 0 });
const friendOfficial = official(friendCode);
if (!friendOfficial) throw new Error('친구 기록의 코드가 규칙에 맞지 않아요');
const friend = { id: 'friend-live', nickname: '옆반친구', code: friendCode, ...friendOfficial };
if (!(friend.distance > mine.high.distance)) throw new Error('친구 기록은 내 가장 좋은 기록보다 멀리 가야 해요');

// 꼴찌가 될 내 기록(순위 밖의 내 줄을 보는 데 쓴다): 아래로 살살 던진 것
const lastCode = encodeDesign(buildPresetDesign('glider', { elevatorDeg: 2 }, 'kent160'), { speedMps: V_MIN, pitchDeg: LIMITS.pitchMin, rollDeg: 0 });
const lastOfficial = official(lastCode);
if (!lastOfficial) throw new Error('꼴찌 기록의 코드가 규칙에 맞지 않아요');
const last = { code: lastCode, ...lastOfficial };
if (!valid.every((v) => v.distance > last.distance && v.airtime > last.airtime)) throw new Error('꼴찌 기록은 깔아 둔 모든 기록보다 낮아야 해요');

console.log(JSON.stringify({ valid, docs, liars, forged, forgedNames, mine, friend, noThrow, last }));
