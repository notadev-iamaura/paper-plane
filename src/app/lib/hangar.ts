/**
 * 격납고: 접은 비행기를 이 브라우저에 넣어 두는 곳.
 *
 * - 비행기 한 대의 "진짜 모습"은 code(core 의 encodeDesign 이 만든 설계 코드) 하나다.
 *   이름, 기록, 작은 그림은 덧붙인 정보일 뿐이고, 비행기는 언제나 code 로 똑같이 다시 만든다.
 * - 이 파일의 위쪽은 순수 함수(원본을 바꾸지 않고 새 값을 돌려준다)라서 Node 에서 그대로 시험한다.
 * - 아래쪽 HangarStore 가 저장소(localStorage)를 맡는다. 저장소가 막혀 있으면 이번 방문 동안만 메모리에 둔다.
 */
import { decodeDesign, encodeDesign, getPaper, PRESETS } from '../../core/index';
import type { GameMode, PlaneDesign } from '../../core/index';
import { reviveLabNote } from './lab/labMath';
import type { LabNote } from './lab/labMath';

/** 저장소 열쇠. 저장 모양이 호환되지 않게 바뀌면 숫자를 올리고 migrate 에 옮기는 법을 적는다. */
export const HANGAR_KEY = 'pp.hangar.v1';
export const HANGAR_VERSION = 1;
/** 넣어 둘 수 있는 비행기 수 */
export const HANGAR_MAX = 24;
export const NAME_MAX = 12;
/** 작은 그림(data URL) 한 장의 글자 수 상한. base64 라서 실제 크기는 이 값의 약 3/4 이다. */
export const THUMB_MAX_CHARS = 14000;
/** 격납고 전체가 저장소에서 차지해도 되는 크기(UTF-16 글자 수 기준). 넘으면 오래된 그림부터 뺀다. */
export const HANGAR_BUDGET_CHARS = 420_000;

export type PlaneOrigin = `preset:${string}` | 'free';

export interface PlaneBest {
  /** 거리(m) 또는 시간(s) */
  value: number;
  /** 기록한 시각(ms) */
  at: number;
  /** 그때 던진 방법까지 든 코드(설계 + 던지기). 있으면 그 비행을 똑같이 다시 볼 수 있다. */
  throwCode?: string;
}

export interface SavedPlane {
  id: string;
  name: string;
  /** 설계만 든 코드(던지기 값 없음). 이것이 비행기의 원본이다. */
  code: string;
  paperId: string;
  origin: PlaneOrigin;
  createdAt: number;
  /** 마지막으로 만진 때(넣기, 이름 바꾸기, 고치기, 날리기) */
  updatedAt: number;
  best: { distance?: PlaneBest; airtime?: PlaneBest };
  /** 이 비행기로 날린 횟수 */
  flights: number;
  favourite: boolean;
  /** 작은 그림(data URL). 없어도 된다. */
  thumb?: string;
  /**
   * 바람 실험실에서 적은 쪽지(없어도 된다). 쪽지 안에 제 판 번호(v)와 적을 때의 물리 판 번호가 들어 있다.
   * 모양(code)이 바뀌면 지운다. 예전 앱은 이 칸을 모르고 지나친다.
   */
  lab?: LabNote;
}

export interface HangarData {
  v: number;
  planes: SavedPlane[];
}

export function emptyHangar(): HangarData {
  return { v: HANGAR_VERSION, planes: [] };
}

// ---------------------------------------------------------------------------
// 이름
// ---------------------------------------------------------------------------
/** 눈에 보이는 글자 수(이모지나 조합 글자도 한 글자로 센다) */
export function nameLength(name: string): number {
  return Array.from(name).length;
}

/** 이름을 다듬는다: 앞뒤 빈칸을 떼고 줄바꿈과 겹친 빈칸을 한 칸으로. 1~12자가 아니면 null. */
export function cleanName(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, ' ').trim();
  const n = nameLength(s);
  if (n < 1 || n > NAME_MAX) return null;
  return s;
}

/** 종이의 짧은 이름(이름표에 쓴다) */
const PAPER_SHORT: Record<string, string> = {
  newsprint: '신문지', copy60: '얇은 종이', copy80: '복사지', copy100: '고급 종이', craft120: '도화지', kent160: '켄트지',
};
/** 접는 법의 짧은 이름 */
const FOLD_SHORT: Record<string, string> = {
  dart: '화살', glider: '글라이더', hybrid: '뭉툭코', delta: '세모', stealth: '스텔스',
};

export function paperShortName(paperId: string): string {
  return PAPER_SHORT[paperId] ?? getPaper(paperId)?.nameKo ?? '종이';
}

export function originPresetId(origin: PlaneOrigin): string | null {
  return origin.startsWith('preset:') ? origin.slice(7) : null;
}

/**
 * 이름 추천: "신문지 화살 1호"처럼 종이 + 접는 법 + 차례.
 * 이미 있는 이름과 겹치지 않는 가장 작은 번호를 고른다(겹쳐도 되지만 추천은 겹치지 않게).
 */
export function suggestName(planes: readonly SavedPlane[], paperId: string, origin: PlaneOrigin): string {
  const preset = originPresetId(origin);
  const kind = preset ? (FOLD_SHORT[preset] ?? '비행기') : '내 맘대로';
  const base = `${paperShortName(paperId)} ${kind}`;
  const taken = new Set(planes.map((p) => p.name));
  for (let n = 1; n <= HANGAR_MAX + 1; n++) {
    const name = `${base} ${n}호`;
    if (taken.has(name)) continue;
    if (nameLength(name) <= NAME_MAX) return name;
    // 너무 길면 종이 이름을 빼고 다시 맞춘다.
    const short = `${kind} ${n}호`;
    if (!taken.has(short)) return Array.from(short).slice(0, NAME_MAX).join('');
  }
  return '내 비행기';
}

// ---------------------------------------------------------------------------
// 찾기, 넣기, 고치기
// ---------------------------------------------------------------------------
export function findById(data: HangarData, id: string | null): SavedPlane | null {
  if (id === null) return null;
  return data.planes.find((p) => p.id === id) ?? null;
}

/** 같은 모양(같은 설계 코드)의 비행기가 이미 있는지 */
export function findByCode(data: HangarData, code: string): SavedPlane | null {
  return data.planes.find((p) => p.code === code) ?? null;
}

/** 설계 코드가 올바르면 정리된 설계를, 아니면 null 을 돌려준다(던지기 값이 붙은 코드는 설계 코드가 아니다). */
export function designOfCode(code: unknown): PlaneDesign | null {
  if (typeof code !== 'string' || code.length === 0 || code.length > 600) return null;
  try {
    const dec = decodeDesign(code);
    // 던지기 값이 붙은 코드(지금 규칙으로 던질 수 있든 없든)는 설계 코드가 아니다.
    if (!dec || dec.throwIn || dec.throwOutOfRange) return null;
    // 코드로 되돌렸을 때 같은 코드가 나와야 "정리된 설계 코드"다.
    return encodeDesign(dec.design) === code ? dec.design : null;
  } catch {
    return null;
  }
}

function newId(data: HangarData, now: number): string {
  const base = `h${now.toString(36)}`;
  let id = base;
  for (let n = 1; data.planes.some((p) => p.id === id); n++) id = `${base}-${n.toString(36)}`;
  return id;
}

export interface AddInput {
  name: string;
  code: string;
  origin: PlaneOrigin;
  thumb?: string;
}

export type AddResult =
  | { ok: true; data: HangarData; plane: SavedPlane }
  | { ok: false; reason: 'full' | 'name' | 'code' };

/** 비행기를 한 대 넣는다. 같은 모양이 이미 있어도 넣을 수 있다(겹치는지는 findByCode 로 미리 알려 준다). */
export function addPlane(data: HangarData, input: AddInput, now: number): AddResult {
  if (data.planes.length >= HANGAR_MAX) return { ok: false, reason: 'full' };
  const name = cleanName(input.name);
  if (name === null) return { ok: false, reason: 'name' };
  const design = designOfCode(input.code);
  if (!design) return { ok: false, reason: 'code' };
  const plane: SavedPlane = {
    id: newId(data, now),
    name,
    code: input.code,
    paperId: design.paperId,
    origin: cleanOrigin(input.origin),
    createdAt: now,
    updatedAt: now,
    best: {},
    flights: 0,
    favourite: false,
    ...(okThumb(input.thumb) ? { thumb: input.thumb } : {}),
  };
  return { ok: true, data: { ...data, planes: [...data.planes, plane] }, plane };
}

function mapPlane(data: HangarData, id: string, fn: (p: SavedPlane) => SavedPlane): HangarData {
  let hit = false;
  const planes = data.planes.map((p) => {
    if (p.id !== id) return p;
    hit = true;
    return fn(p);
  });
  return hit ? { ...data, planes } : data;
}

/** 이름을 바꾼다. 이름이 규칙에 맞지 않거나 그런 비행기가 없으면 원본을 그대로 돌려준다. */
export function renamePlane(data: HangarData, id: string, rawName: string, now: number): HangarData {
  const name = cleanName(rawName);
  if (name === null) return data;
  return mapPlane(data, id, (p) => ({ ...p, name, updatedAt: now }));
}

export function setFavourite(data: HangarData, id: string, on: boolean): HangarData {
  return mapPlane(data, id, (p) => (p.favourite === on ? p : { ...p, favourite: on }));
}

export function setThumb(data: HangarData, id: string, thumb: string | undefined): HangarData {
  return mapPlane(data, id, (p) => {
    const { thumb: _old, ...rest } = p;
    void _old;
    return okThumb(thumb) ? { ...rest, thumb } : rest;
  });
}

/**
 * "고친 걸로 바꾸기": 같은 이름표를 단 채 모양만 새것으로 바꾼다.
 * 모양이 달라졌으므로 예전 모양으로 세운 최고 기록은 지운다(그 기록은 이제 이 비행기 것이 아니다).
 * 날린 횟수와 이름, 즐겨찾기는 그대로 둔다.
 */
export function replaceDesign(data: HangarData, id: string, code: string, origin: PlaneOrigin, now: number, thumb?: string): HangarData {
  const design = designOfCode(code);
  if (!design) return data;
  return mapPlane(data, id, (p) => {
    if (p.code === code) return p;
    const { thumb: _old, lab: _lab, ...rest } = p;
    void _old; void _lab;
    return { ...rest, code, paperId: design.paperId, origin: cleanOrigin(origin), best: {}, updatedAt: now, ...(okThumb(thumb) ? { thumb } : {}) };
  });
}

/** 바람 실험실 쪽지를 붙인다(undefined 면 뗀다). 그런 비행기가 없으면 원본을 그대로 돌려준다. */
export function setLabNote(data: HangarData, id: string, note: LabNote | undefined): HangarData {
  return mapPlane(data, id, (p) => {
    const { lab: _old, ...rest } = p;
    void _old;
    const clean = note ? reviveLabNote(note) : undefined;
    return clean ? { ...rest, lab: clean } : rest;
  });
}

export interface FlightInput {
  /** 던진 비행기의 설계 코드 */
  designCode: string;
  distanceM: number;
  airtimeS: number;
  /** 설계 + 던지기 코드 */
  throwCode: string;
  at: number;
}

export interface FlightUpdate {
  data: HangarData;
  /** 기록이 바뀐 비행기(같은 모양이 여러 대면 모두). 없으면 빈 목록. */
  planeIds: string[];
  /** 이 비행으로 격납고 비행기의 최고 기록이 새로 섰는지 */
  improved: { distance: boolean; airtime: boolean };
}

/** 넣어 둔 비행기와 같은 모양으로 날렸으면 그 비행기의 날린 횟수와 최고 기록을 고친다. 더 좋을 때만 바꾼다. */
export function recordFlight(data: HangarData, f: FlightInput): FlightUpdate {
  const improved = { distance: false, airtime: false };
  const planeIds: string[] = [];
  if (!Number.isFinite(f.distanceM) || !Number.isFinite(f.airtimeS)) return { data, planeIds, improved };
  const planes = data.planes.map((p) => {
    if (p.code !== f.designCode) return p;
    planeIds.push(p.id);
    const best = { ...p.best };
    if (!best.distance || f.distanceM > best.distance.value) {
      best.distance = { value: f.distanceM, at: f.at, throwCode: f.throwCode };
      improved.distance = true;
    }
    if (!best.airtime || f.airtimeS > best.airtime.value) {
      best.airtime = { value: f.airtimeS, at: f.at, throwCode: f.throwCode };
      improved.airtime = true;
    }
    return { ...p, best, flights: p.flights + 1, updatedAt: f.at };
  });
  return planeIds.length > 0 ? { data: { ...data, planes }, planeIds, improved } : { data, planeIds, improved };
}

export interface Removed { plane: SavedPlane; index: number }

/** 비행기를 뺀다. 되돌릴 수 있게 뺀 것과 있던 자리를 같이 돌려준다. */
export function deletePlane(data: HangarData, id: string): { data: HangarData; removed: Removed | null } {
  const index = data.planes.findIndex((p) => p.id === id);
  if (index < 0) return { data, removed: null };
  const plane = data.planes[index]!;
  return { data: { ...data, planes: data.planes.filter((p) => p.id !== id) }, removed: { plane, index } };
}

/** 방금 뺀 비행기를 있던 자리에 도로 넣는다. 그 사이 꽉 찼거나 같은 id 가 있으면 그대로 둔다. */
export function restorePlane(data: HangarData, removed: Removed): HangarData {
  if (data.planes.length >= HANGAR_MAX || data.planes.some((p) => p.id === removed.plane.id)) return data;
  const planes = [...data.planes];
  planes.splice(Math.max(0, Math.min(removed.index, planes.length)), 0, removed.plane);
  return { ...data, planes };
}

// ---------------------------------------------------------------------------
// 늘어놓는 차례
// ---------------------------------------------------------------------------
/** 최근 / 멀리 / 오래 / 즐겨찾기 */
export type HangarSort = 'recent' | 'far' | 'long' | 'fav';

/**
 * 보여 줄 차례대로 늘어놓는다(원본은 바꾸지 않는다).
 * - recent: 마지막으로 만진 것이 앞
 * - far / long: 그 종목 최고 기록이 좋은 것이 앞, 기록 없는 비행기는 뒤
 * - fav: 즐겨찾기만, 최근 차례로
 * 값이 같으면 먼저 넣은 것이 앞이라서 차례가 흔들리지 않는다.
 */
export function sortPlanes(planes: readonly SavedPlane[], sort: HangarSort): SavedPlane[] {
  const recent = (a: SavedPlane, b: SavedPlane): number => b.updatedAt - a.updatedAt || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (sort === 'fav') return planes.filter((p) => p.favourite).sort(recent);
  if (sort === 'recent') return [...planes].sort(recent);
  const key = sort === 'far' ? 'distance' : 'airtime';
  return [...planes].sort((a, b) => (b.best[key]?.value ?? -1) - (a.best[key]?.value ?? -1) || recent(a, b));
}

/** 격납고에서 그 종목의 1등 비행기(기록이 있는 것 가운데). 없으면 null. */
export function championOf(planes: readonly SavedPlane[], mode: GameMode): SavedPlane | null {
  const key = mode === 'distance' ? 'distance' : 'airtime';
  let top: SavedPlane | null = null;
  for (const p of planes) {
    const v = p.best[key]?.value;
    if (v === undefined) continue;
    if (!top || v > (top.best[key]?.value ?? -1)) top = p;
  }
  return top;
}

/** 넣어 둔 비행기의 종이 종류(겹치지 않게) */
export function paperKinds(data: HangarData): string[] {
  return Array.from(new Set(data.planes.map((p) => p.paperId)));
}

// ---------------------------------------------------------------------------
// 지금 접은 비행기가 격납고의 어느 비행기와 어떤 사이인지
// ---------------------------------------------------------------------------
export type SaveStatus =
  | { kind: 'new' }
  /** 같은 모양이 이미 들어 있다 */
  | { kind: 'saved'; plane: SavedPlane }
  /** 격납고에서 꺼낸 비행기를 고쳤다(아직 넣지 않았다) */
  | { kind: 'modified'; plane: SavedPlane };

export function saveStatusOf(data: HangarData, designCode: string, linkedId: string | null): SaveStatus {
  const linked = findById(data, linkedId);
  // 꺼내 온 바로 그 비행기가 같은 모양이면 그것을, 아니면 같은 모양의 다른 비행기를 가리킨다.
  if (linked && linked.code === designCode) return { kind: 'saved', plane: linked };
  const same = findByCode(data, designCode);
  if (same) return { kind: 'saved', plane: same };
  if (linked) return { kind: 'modified', plane: linked };
  return { kind: 'new' };
}

/** 손대지 않은 "따라 접기" 비행기인지(그 접는 법의 처음 값 그대로). 그렇다면 그 접는 법의 id. */
export function untouchedPresetOf(plane: Pick<SavedPlane, 'code' | 'origin' | 'paperId'>): string | null {
  const id = originPresetId(plane.origin);
  if (id === null) return null;
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) return null;
  try {
    return encodeDesign({ ...preset.design, paperId: plane.paperId }) === plane.code ? id : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 읽어 들이기(검사), 크기 재기
// ---------------------------------------------------------------------------
function okThumb(t: unknown): t is string {
  return typeof t === 'string' && t.length <= THUMB_MAX_CHARS && /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(t);
}

function cleanOrigin(o: unknown): PlaneOrigin {
  if (typeof o === 'string' && /^preset:[a-z0-9-]{1,24}$/.test(o)) return o as PlaneOrigin;
  return 'free';
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function reviveBest(x: unknown, designCode: string): PlaneBest | undefined {
  if (typeof x !== 'object' || x === null) return undefined;
  const b = x as Partial<PlaneBest>;
  if (!finite(b.value) || b.value < 0) return undefined;
  const out: PlaneBest = { value: b.value, at: finite(b.at) ? b.at : 0 };
  // 던지기 코드는 이 비행기의 모양으로 던진 것일 때만 믿는다.
  if (typeof b.throwCode === 'string' && b.throwCode.length <= 700) {
    try {
      const dec = decodeDesign(b.throwCode);
      if (dec && encodeDesign(dec.design) === designCode) {
        // 지금 규칙으로는 던질 수 없는 힘(예: 한도가 16 m/s 이던 때의 12 m/s)으로 낸 기록은 다시 낼 수 없는 숫자다.
        // 그 기록만 버린다. 비행기(설계 코드)는 던지기 한도와 상관없으므로 그대로 남는다.
        if (dec.throwOutOfRange) return undefined;
        if (dec.throwIn) out.throwCode = b.throwCode;
      }
    } catch { /* 못 읽는 코드는 버린다 */ }
  }
  return out;
}

function revivePlane(x: unknown, seen: Set<string>): SavedPlane | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Partial<SavedPlane> & { best?: unknown };
  const design = designOfCode(r.code);
  if (!design || typeof r.code !== 'string') return null;
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 40 || seen.has(r.id)) return null;
  const name = typeof r.name === 'string' ? cleanName(Array.from(r.name.replace(/\s+/g, ' ').trim()).slice(0, NAME_MAX).join('')) : null;
  const createdAt = finite(r.createdAt) ? r.createdAt : 0;
  const best = (typeof r.best === 'object' && r.best !== null ? r.best : {}) as { distance?: unknown; airtime?: unknown };
  const distance = reviveBest(best.distance, r.code);
  const airtime = reviveBest(best.airtime, r.code);
  seen.add(r.id);
  const lab = reviveLabNote((r as { lab?: unknown }).lab);
  return {
    id: r.id,
    name: name ?? '이름 없는 비행기',
    code: r.code,
    // 종이는 코드에 든 것이 맞다(따로 적힌 값이 달라도 코드를 믿는다).
    paperId: design.paperId,
    origin: cleanOrigin(r.origin),
    createdAt,
    updatedAt: finite(r.updatedAt) ? r.updatedAt : createdAt,
    best: { ...(distance ? { distance } : {}), ...(airtime ? { airtime } : {}) },
    flights: finite(r.flights) ? Math.max(0, Math.floor(r.flights)) : 0,
    favourite: r.favourite === true,
    ...(okThumb(r.thumb) ? { thumb: r.thumb } : {}),
    ...(lab ? { lab } : {}),
  };
}

/** 예전 모양의 저장 값을 지금 모양으로 옮긴다. 지금은 1판뿐이라 옮길 것이 없다. 모르는(더 새로운) 판이면 null. */
function migrate(raw: { v?: unknown; planes?: unknown }): { planes: unknown[] } | null {
  const v = finite(raw.v) ? raw.v : 1;
  if (v > HANGAR_VERSION) return null;
  // (v === 1) 지금 모양 그대로다. 나중에 2판이 생기면 여기서 1 -> 2 로 바꾼다.
  return Array.isArray(raw.planes) ? { planes: raw.planes } : null;
}

export interface Revived {
  data: HangarData;
  /** 망가져서 건너뛴 칸 수 */
  skipped: number;
  /** 이 앱보다 새 판이 적어 둔 값이라 건드리지 않았는지 */
  newer: boolean;
}

/** 저장소에서 읽은 값을 검사해 되살린다. 어떤 값이 와도 예외를 던지지 않는다. */
export function reviveHangar(raw: unknown): Revived {
  const none: Revived = { data: emptyHangar(), skipped: 0, newer: false };
  if (typeof raw !== 'object' || raw === null) return none;
  try {
    const r = raw as { v?: unknown; planes?: unknown };
    if (finite(r.v) && r.v > HANGAR_VERSION) return { ...none, newer: true };
    const m = migrate(r);
    if (!m) return { ...none, skipped: r.planes === undefined ? 0 : 1 };
    const seen = new Set<string>();
    const planes: SavedPlane[] = [];
    let skipped = 0;
    for (const x of m.planes) {
      const p = planes.length < HANGAR_MAX ? revivePlane(x, seen) : null;
      if (p) planes.push(p);
      else skipped++;
    }
    return { data: { v: HANGAR_VERSION, planes }, skipped, newer: false };
  } catch {
    return none;
  }
}

export function serializeHangar(data: HangarData): string {
  return JSON.stringify({ v: HANGAR_VERSION, planes: data.planes });
}

/** 저장했을 때의 크기(바이트, UTF-8 기준) */
export function byteSize(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3;
  }
  return n;
}

export function planeBytes(p: SavedPlane): { total: number; thumb: number } {
  return { total: byteSize(JSON.stringify(p)), thumb: p.thumb ? byteSize(p.thumb) : 0 };
}

export function dropThumbs(data: HangarData): HangarData {
  if (!data.planes.some((p) => p.thumb !== undefined)) return data;
  return { ...data, planes: data.planes.map((p) => { const { thumb: _t, ...rest } = p; void _t; return rest; }) };
}

/** 크기가 한도를 넘으면 오래 안 만진 비행기의 그림부터 빼서 한도 안으로 맞춘다. */
export function fitBudget(data: HangarData, budgetChars: number = HANGAR_BUDGET_CHARS): { data: HangarData; dropped: number } {
  let cur = data;
  let dropped = 0;
  let size = serializeHangar(cur).length;
  if (size <= budgetChars) return { data, dropped };
  const order = [...cur.planes].filter((p) => p.thumb !== undefined).sort((a, b) => a.updatedAt - b.updatedAt);
  for (const victim of order) {
    if (size <= budgetChars) break;
    size -= (victim.thumb?.length ?? 0) + 11;
    cur = setThumb(cur, victim.id, undefined);
    dropped++;
  }
  return { data: cur, dropped };
}

// ---------------------------------------------------------------------------
// 저장소
// ---------------------------------------------------------------------------
export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface SaveOutcome {
  /** 실제로 남은 값(그림을 뺐으면 뺀 값) */
  data: HangarData;
  /** 브라우저 저장소에 적혔는지. false 면 이번 방문 동안만 기억한다. */
  persisted: boolean;
  /** 자리가 모자라 그림을 뺐는지 */
  droppedThumbs: boolean;
}

export interface LoadOutcome extends Revived {
  /** 저장소를 쓸 수 있는지. false 면 이번 방문 동안만 기억한다. */
  persistent: boolean;
}

/**
 * 격납고 저장소. 저장소를 얻는 함수(getStorage)가 예외를 던지거나 null 을 주면 메모리만 쓴다.
 * 쓰다가 자리가 모자라면(quota) 그림을 빼고 한 번 더 써 본다.
 */
export class HangarStore {
  private memory: HangarData = emptyHangar();
  private usable = true;
  /** 새 판이 적어 둔 값이 있으면 덮어쓰지 않는다. */
  private readOnly = false;

  constructor(private getStorage: () => StorageLike | null, private key: string = HANGAR_KEY) {}

  get persistent(): boolean { return this.usable && !this.readOnly; }

  private storage(): StorageLike | null {
    try {
      return this.getStorage();
    } catch {
      return null;
    }
  }

  load(): LoadOutcome {
    // 한 번 메모리 방식으로 넘어갔으면 이번 방문 동안은 메모리에 든 것이 맞는 값이다.
    const st = this.usable ? this.storage() : null;
    if (!st) {
      this.usable = false;
      return { data: this.memory, skipped: 0, newer: false, persistent: false };
    }
    let raw: unknown = null;
    let broken = 0;
    try {
      const text = st.getItem(this.key);
      if (text !== null) {
        try {
          raw = JSON.parse(text) as unknown;
        } catch {
          broken = 1; // 통째로 망가진 값: 빈 격납고로 시작한다.
        }
      }
    } catch {
      this.usable = false;
      return { data: this.memory, skipped: 0, newer: false, persistent: false };
    }
    const r = reviveHangar(raw);
    this.readOnly = r.newer;
    this.memory = r.data;
    // 써 보기 전에는 모르므로, 읽기만 되는 저장소인지 한 번 확인한다.
    if (!r.newer) {
      try {
        st.setItem(`${this.key}.probe`, '1');
      } catch {
        this.usable = false;
      }
    }
    return { ...r, skipped: r.skipped + broken, persistent: this.persistent };
  }

  save(next: HangarData): SaveOutcome {
    const fitted = fitBudget(next);
    let data = fitted.data;
    let droppedThumbs = fitted.dropped > 0;
    this.memory = data;
    const st = this.readOnly ? null : this.storage();
    if (!st) {
      if (!this.readOnly) this.usable = false;
      return { data, persisted: false, droppedThumbs };
    }
    try {
      st.setItem(this.key, serializeHangar(data));
      this.usable = true;
      return { data, persisted: true, droppedThumbs };
    } catch {
      // 자리가 모자랄 수 있다: 그림을 모두 빼고 한 번 더.
      const bare = dropThumbs(data);
      if (bare !== data) {
        try {
          st.setItem(this.key, serializeHangar(bare));
          data = bare;
          droppedThumbs = true;
          this.memory = data;
          this.usable = true;
          return { data, persisted: true, droppedThumbs };
        } catch { /* 아래에서 메모리 방식으로 넘어간다 */ }
      }
      this.usable = false;
      return { data, persisted: false, droppedThumbs };
    }
  }
}

/** 브라우저의 localStorage 를 쓰는 저장소 */
export function browserHangarStore(): HangarStore {
  return new HangarStore(() => (typeof window === 'undefined' ? null : window.localStorage));
}
