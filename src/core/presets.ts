/**
 * 기본 접기 패턴(간편 모드).
 * 실제 접는 순서를 A4 종이 위의 FoldOp 로 옮긴 것이다. 좌표는 종이 좌표(중심 원점, +y 가 기수).
 * 모든 좌표와 치수는 공유 코드의 정밀도(0.1 mm, 0.1 도)에 맞춰 반올림해 두므로
 * 코드로 바꿨다가 되돌려도 값이 그대로다.
 *
 * FoldOp 규칙 복습: a->b 진행 방향의 "왼쪽"이 움직인다.
 * - 가로선을 따라 위쪽을 접어 내리려면 a 가 왼쪽 점, b 가 오른쪽 점(진행 방향 +x, 왼쪽은 +y).
 */
import type { FoldOp, PlaneDesign, Vec2 } from './types';
import { LIMITS } from './types';
import { DEFAULT_PAPER_ID, getPaper } from './papers';
import { applyFolds, boundingBox } from './fold/fold';

/** 조절값 하나의 정보(화면의 슬라이더를 만들 때 쓴다) */
export interface PresetParamMeta {
  key: string;
  labelKo: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** m: 길이(미터), deg: 각도(도), count: 횟수 */
  unit: 'm' | 'deg' | 'count';
}

/** 조절값 묶음. 키는 PresetParamMeta.key */
export type PresetParams = Record<string, number>;

export interface Preset {
  id: string;
  nameKo: string;
  descriptionKo: string;
  /** 1 쉬움 ~ 3 어려움 */
  difficulty: 1 | 2 | 3;
  /** 기본값으로 만든 설계 */
  design: PlaneDesign;
  /** 조절값의 기본값 */
  params: PresetParams;
  /** 조절값 정보(최소, 최대, 간격, 한국어 이름) */
  paramMeta: PresetParamMeta[];
}

const q4 = (v: number): number => Math.round(v * 1e4) / 1e4; // 0.1 mm
const q1 = (v: number): number => Math.round(v * 10) / 10;   // 0.1 도
const pt = (x: number, y: number): Vec2 => ({ x: q4(x), y: q4(y) });

// ---- 접기 조각들 ----

/** 가로선 y 위쪽을 아래로 접어 내린다. */
function foldDown(y: number, w: number): FoldOp {
  return { a: pt(-w / 2, y), b: pt(w / 2, y), dir: 'valley' };
}

/**
 * 꼭짓점 apex(중심선 위)에서 중심선과 angleDeg 를 이루는 선으로 바깥쪽을 안으로 접는다(좌우 한 쌍).
 * 45 도면 "윗변 모서리를 중심선에 맞추기"가 된다.
 */
function foldSidesIn(apexY: number, angleDeg: number, w: number, h: number): FoldOp[] {
  const th = (angleDeg * Math.PI) / 180;
  const len = Math.min(w / 2 / Math.sin(th), h);
  const dx = len * Math.sin(th);
  const dy = len * Math.cos(th);
  return [
    { a: pt(-dx, apexY - dy), b: pt(0, apexY), dir: 'valley' }, // 왼쪽 조각이 움직인다
    { a: pt(0, apexY), b: pt(dx, apexY - dy), dir: 'valley' },  // 오른쪽 조각이 움직인다
  ];
}

// ---- 공통 조절값(입체 마무리) ----

interface ShapeDefaults { keelM: number; dihedralDeg: number; wingletM: number; wingletDeg: number; elevatorDeg: number }

function shapeMeta(d: ShapeDefaults): PresetParamMeta[] {
  return [
    { key: 'keelM', labelKo: '동체 깊이 (작을수록 날개가 넓음)', min: 0.008, max: 0.05, step: 0.001, default: d.keelM, unit: 'm' },
    { key: 'dihedralDeg', labelKo: '상반각 (날개를 위로 든 각도)', min: LIMITS.dihedralMin, max: LIMITS.dihedralMax, step: 1, default: d.dihedralDeg, unit: 'deg' },
    { key: 'wingletM', labelKo: '날개 끝 세우는 폭', min: 0, max: 0.04, step: 0.001, default: d.wingletM, unit: 'm' },
    { key: 'wingletDeg', labelKo: '날개 끝 세우는 각도', min: LIMITS.wingletDegMin, max: LIMITS.wingletDegMax, step: 5, default: d.wingletDeg, unit: 'deg' },
    { key: 'elevatorDeg', labelKo: '뒷전 올림 (기수를 드는 정도)', min: LIMITS.elevatorMin, max: LIMITS.elevatorMax, step: 0.5, default: d.elevatorDeg, unit: 'deg' },
  ];
}

interface PresetDef {
  id: string;
  nameKo: string;
  descriptionKo: string;
  difficulty: 1 | 2 | 3;
  paramMeta: PresetParamMeta[];
  /** 조절값(이미 범위 안으로 정리됨)으로 평면 접기 목록을 만든다. w, h 는 종이 크기. */
  folds: (p: PresetParams, w: number, h: number) => FoldOp[];
}

const DEFS: PresetDef[] = [
  {
    id: 'dart',
    nameKo: '기본 다트',
    descriptionKo: '윗변 두 모서리를 중심선에 맞추고 한 번 더 접는 가장 흔한 뾰족한 비행기. 빠르고 곧게 날아가요.',
    difficulty: 1,
    paramMeta: [
      { key: 'noseFolds', labelKo: '앞쪽 접기 횟수 (많을수록 뾰족함)', min: 1, max: 3, step: 1, default: 2, unit: 'count' },
      // 기본값: 동체를 2 cm 로 얕게 잡아 날개를 넓히고, 앞이 무거운 만큼 뒷전을 4.5도 올려 받음각 약 4.7도로 맞춘다.
      // (물리 2판: 뒷전 2.5도로는 받음각 3.1도, 활공비 2.6 이라 규격의 활공비 3 에 못 미쳤다. 좁은 날개의 최대 양항비는 약 3.9 다.)
      ...shapeMeta({ keelM: 0.02, dihedralDeg: 10, wingletM: 0, wingletDeg: 0, elevatorDeg: 4.5 }),
    ],
    folds: (p, w, h) => {
      const top = h / 2;
      const out: FoldOp[] = [];
      // 1회: 모서리를 중심선에(45도). 2회: 비스듬한 변을 다시 중심선에(22.5도). 3회: 한 번 더(11.25도).
      for (let k = 0; k < p.noseFolds!; k++) out.push(...foldSidesIn(top, 45 / 2 ** k, w, h));
      return out;
    },
  },
  {
    id: 'glider',
    nameKo: '글라이더형',
    descriptionKo: '윗변을 여러 번 말아 접어 앞을 무겁게 만든 넓은 날개. 천천히 오래 떠요.',
    difficulty: 1,
    paramMeta: [
      { key: 'noseFolds', labelKo: '앞쪽 말아 접기 횟수 (많을수록 앞이 무거움)', min: 1, max: 6, step: 1, default: 6, unit: 'count' },
      { key: 'noseDepthM', labelKo: '한 번에 접는 폭', min: 0.01, max: 0.03, step: 0.001, default: 0.029, unit: 'm' },
      ...shapeMeta({ keelM: 0.015, dihedralDeg: 8, wingletM: 0.012, wingletDeg: 60, elevatorDeg: 2 }),
    ],
    folds: (p, w, h) => {
      const top = h / 2;
      const out: FoldOp[] = [];
      // 윗변을 같은 폭으로 계속 말아 내린다. k 번째 접는 선은 원래 윗변에서 k * 폭 아래.
      for (let k = 1; k <= p.noseFolds!; k++) out.push(foldDown(top - k * p.noseDepthM!, w));
      return out;
    },
  },
  {
    id: 'hybrid',
    nameKo: '하이브리드(배 모양 기수)',
    descriptionKo: '모서리를 접고 뾰족한 끝을 내려 접은 뒤 다시 모서리를 접는 방식. 앞이 뭉툭하고 묵직해 안정적으로 멀리 가요.',
    difficulty: 2,
    paramMeta: [
      { key: 'noseDepthM', labelKo: '기수 내려 접는 여유 (클수록 짧고 뭉툭함)', min: 0, max: 0.03, step: 0.001, default: 0.01, unit: 'm' },
      // 기본값: 뒷전 4.5도로 받음각 약 5.5도. 다트보다 조금 느리고 활공비는 조금 높다.
      ...shapeMeta({ keelM: 0.02, dihedralDeg: 8, wingletM: 0, wingletDeg: 0, elevatorDeg: 4.5 }),
    ],
    folds: (p, w, h) => {
      const top = h / 2;
      // 삼각형 밑변보다 조금 아래에서 끝을 내려 접는다.
      const yl = top - w / 2 - p.noseDepthM!;
      return [
        ...foldSidesIn(top, 45, w, h),
        foldDown(yl, w),
        ...foldSidesIn(yl, 45, w, h),
      ];
    },
  },
  {
    id: 'delta',
    nameKo: '넓은 델타',
    descriptionKo: '모서리를 길게 비스듬히 접어 삼각 날개를 만들고 끝을 접어 넣은 형태. 날개가 넓어 느리게 떠다녀요.',
    difficulty: 2,
    paramMeta: [
      { key: 'noseDepthM', labelKo: '기수 끝 접는 깊이', min: 0.02, max: 0.08, step: 0.001, default: 0.06, unit: 'm' },
      { key: 'noseFolds', labelKo: '기수 접기 횟수 (많을수록 앞이 무거움)', min: 1, max: 5, step: 1, default: 5, unit: 'count' },
      // 기본값: 끝을 6 cm 접고 3 cm 씩 네 번 더 말아 무게중심을 시위의 약 28% 까지 당긴다(3번 접기로는 32% 라 받음각 17도로 뜬 채 가라앉는다).
      ...shapeMeta({ keelM: 0.015, dihedralDeg: 12, wingletM: 0, wingletDeg: 0, elevatorDeg: 1.5 }),
    ],
    folds: (p, w, h) => {
      const top = h / 2;
      // 앞전이 중심선과 35도를 이루도록 모서리를 접는다(45도보다 길게 접혀 삼각 날개가 된다).
      const out: FoldOp[] = [...foldSidesIn(top, 35, w, h)];
      // 뾰족한 끝을 접어 내리고, 그 뒤로는 절반 깊이씩 더 말아 접는다.
      const d = p.noseDepthM!;
      for (let k = 0; k < p.noseFolds!; k++) out.push(foldDown(top - d - (k * d) / 2, w));
      return out;
    },
  },
  {
    id: 'stealth',
    nameKo: '스텔스형',
    descriptionKo: '윗변을 먼저 접어 내린 뒤 모서리를 접고 끝을 뭉툭하게 자른 형태. 날개 끝을 세워 방향을 잡아요.',
    difficulty: 3,
    paramMeta: [
      { key: 'noseDepthM', labelKo: '처음 접어 내리는 깊이 (클수록 앞이 무거움)', min: 0.04, max: 0.12, step: 0.001, default: 0.1, unit: 'm' },
      { key: 'tipDepthM', labelKo: '기수 끝 접는 깊이', min: 0.01, max: 0.06, step: 0.001, default: 0.05, unit: 'm' },
      // 기본값: 끝을 5 cm 로 깊게 접어 앞을 무겁게 하고, 세운 날개 끝은 1.2 cm 로 줄여 날개 면적을 지킨다. 뒷전은 거의 올리지 않는다.
      ...shapeMeta({ keelM: 0.022, dihedralDeg: 5, wingletM: 0.012, wingletDeg: 70, elevatorDeg: 0.5 }),
    ],
    folds: (p, w, h) => {
      const top = h / 2;
      const yT = top - p.noseDepthM!;
      return [
        foldDown(yT, w),
        ...foldSidesIn(yT, 45, w, h),
        foldDown(yT - p.tipDepthM!, w),
      ];
    },
  },
];

function findDef(presetId: string): PresetDef {
  for (const d of DEFS) if (d.id === presetId) return d;
  return DEFS[0]!;
}

/** 조절값을 범위 안으로 정리한다. 빠진 값은 기본값, 횟수는 정수로. */
function normalizeParams(def: PresetDef, params: Partial<PresetParams> | undefined): PresetParams {
  const out: PresetParams = {};
  const src = (typeof params === 'object' && params !== null ? params : {}) as Partial<PresetParams>;
  for (const m of def.paramMeta) {
    const raw = src[m.key];
    let v = typeof raw === 'number' && Number.isFinite(raw) ? raw : m.default;
    v = Math.min(m.max, Math.max(m.min, v));
    if (m.unit === 'count') v = Math.round(v);
    else if (m.unit === 'm') v = q4(v);
    else v = q1(v);
    out[m.key] = v;
  }
  return out;
}

/** 프리셋의 조절값 정보. 모르는 id 면 첫 프리셋의 것을 돌려준다. */
export function getPresetParamMeta(presetId: string): PresetParamMeta[] {
  return findDef(presetId).paramMeta.map((m) => ({ ...m }));
}

/** 프리셋의 조절값 기본값 */
export function defaultPresetParams(presetId: string): PresetParams {
  return normalizeParams(findDef(presetId), undefined);
}

/**
 * 프리셋 + 조절값 -> 설계. 간편 모드에서 슬라이더를 움직일 때마다 부르면 된다.
 * - 범위를 벗어난 값은 잘라내고, 빠진 값은 기본값을 쓴다.
 * - 동체 깊이와 날개 끝 폭이 접힌 종이의 반쪽 폭을 넘지 않게 줄인다. 그래서 항상 검사를 통과하는 설계가 나온다.
 * - 모르는 presetId 면 첫 프리셋(기본 다트)으로 만든다.
 */
export function buildPresetDesign(
  presetId: string,
  params?: Partial<PresetParams>,
  paperId: string = DEFAULT_PAPER_ID,
): PlaneDesign {
  const def = findDef(presetId);
  const paper = getPaper(paperId) ?? getPaper(DEFAULT_PAPER_ID)!;
  const p = normalizeParams(def, params);
  const folds = def.folds(p, paper.widthM, paper.heightM);

  // 접힌 뒤의 반쪽 폭을 재서 동체와 날개 끝이 날개를 다 먹어 버리지 않게 한다(날개를 최소 1 cm 는 남긴다).
  const bb = boundingBox(applyFolds(paper, folds));
  const half = Math.min(paper.widthM / 2, Math.max(-bb.minX, bb.maxX));
  const keelM = q4(Math.max(0, Math.min(p.keelM!, half - 0.01)));
  const wingletM = q4(Math.max(0, Math.min(p.wingletM!, half - keelM - 0.01)));

  return {
    v: 1,
    paperId: paper.id,
    folds,
    shaping: {
      keelM,
      dihedralDeg: p.dihedralDeg!,
      wingletM,
      wingletDeg: p.wingletDeg!,
      elevatorDeg: p.elevatorDeg!,
    },
    clip: null,
  };
}

/** 프리셋 목록 */
export const PRESETS: Preset[] = DEFS.map((def) => ({
  id: def.id,
  nameKo: def.nameKo,
  descriptionKo: def.descriptionKo,
  difficulty: def.difficulty,
  design: buildPresetDesign(def.id),
  params: defaultPresetParams(def.id),
  paramMeta: def.paramMeta.map((m) => ({ ...m })),
}));

/** 프리셋 id -> 조절값 정보 */
export const PRESET_PARAM_META: Record<string, PresetParamMeta[]> = Object.fromEntries(
  DEFS.map((def) => [def.id, def.paramMeta.map((m) => ({ ...m }))]),
);
