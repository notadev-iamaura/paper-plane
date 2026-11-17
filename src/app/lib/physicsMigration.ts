/**
 * 물리 판(PHYSICS_VERSION)이 바뀌었을 때 저장해 둔 기록을 새 규칙으로 다시 재는 일.
 *
 * 저장된 기록의 "진짜 모습"은 코드(설계 + 던지기)뿐이다. 거리와 시간은 그 코드를 계산한 값이라서,
 * 계산 규칙이 바뀌면 예전 숫자는 더는 맞지 않는다(랭킹 서버가 다시 계산한 값과도 어긋난다).
 * 그래서 앱이 켜질 때 한 번, 저장된 판 번호가 지금과 다르면
 *   1) 내 기록(가장 멀리, 가장 오래, 최근 비행)을 코드로 다시 계산하고,
 *   2) 격납고 비행기마다 최고 기록을 그때 던진 코드로 다시 계산하고(코드가 없거나 더는 던질 수 없는 값이면 그 기록만 지운다. 비행기는 그대로 둔다),
 *   3) 계산해서 만들어 둔 것(실험실 쪽지 등)을 정리하게 알리고,
 *   4) 새 판 번호를 적는다.
 * 같은 판에서는 아무 일도 하지 않는다(여러 번 불러도 결과가 같다). 저장소가 막혀 있으면 할 일이 없다.
 * 순위표 캐시는 제 지문으로 스스로 낡은 값을 버리므로 여기서 건드리지 않는다.
 *
 * 저장소와 계산 함수를 밖에서 받으므로 Node 에서 그대로 시험한다.
 */
import { decodeDesign, evaluate, validateSubmission } from '../../core/index';
import type { FlightVerdict } from '../../core/index';
import { HANGAR_KEY, reviveHangar, serializeHangar } from './hangar';
import type { HangarData, PlaneBest, SavedPlane, StorageLike } from './hangar';
import { reviveRecords } from './records';
import type { FlightRecord, Records } from './records';

export const PHYSICS_KEY = 'pp.physics.v1';
export const RECORDS_KEY = 'pp.records.v1';

export interface FlightEval { distanceM: number; airtimeS: number; verdict: FlightVerdict }

export interface MigrationDeps {
  /** 저장소. 쓸 수 없으면 null (또는 꺼내다 예외) */
  getStorage: () => StorageLike | null;
  /** 지금의 물리 판 번호 */
  version: number;
  /** 코드(설계 + 던지기)를 지금 규칙으로 계산한다. 코드가 틀렸거나 더는 던질 수 없는 값이면 null. */
  evaluate: (throwCode: string) => FlightEval | null | Promise<FlightEval | null>;
  /** 계산 사이사이에 쉬어 간다(화면이 멈추지 않게). 없으면 쉬지 않는다. */
  pause?: () => Promise<void>;
  /** 계산해서 만들어 둔 다른 것들을 치운다 */
  clearCaches?: () => void;
  recordsKey?: string;
  hangarKey?: string;
  physicsKey?: string;
}

export interface MigrationReport {
  /** 다시 재는 일을 했는지(판이 같거나 저장소가 없으면 false) */
  ran: boolean;
  from: number | null;
  to: number;
  /** 값이 달라진 내 기록 수, 지운 내 기록 수 */
  recordsChanged: number;
  recordsDropped: number;
  /** 값이 달라진 격납고 최고 기록 수, 지운 수 */
  bestsChanged: number;
  bestsDropped: number;
  /** 아이에게 "기록을 다시 쟀어요"라고 알릴 만한 일이 있었는지 */
  notify: boolean;
}

/**
 * 코드(설계 + 던지기)를 지금의 core 로 계산한다. 앱이 migratePhysics 의 evaluate 로 넘기는 함수다.
 * 다음은 모두 "계산할 수 없음"(null)이다: 틀린 코드, 던지기 값이 없는 코드,
 * 그리고 던지기 값이 지금 한도를 벗어난 코드(decodeDesign 이 throwIn 없이 throwOutOfRange 만 돌려준다.
 * 예: 한도가 16 m/s 이던 물리 1판의 12 m/s 던지기). 한도 안으로 잘라서 계산하지 않는다: 그러면 다른 던지기가 된다.
 */
export function evaluateThrowCode(code: string): FlightEval | null {
  try {
    const dec = decodeDesign(code);
    if (!dec || !dec.throwIn || !validateSubmission(dec.design, dec.throwIn).ok) return null;
    const r = evaluate(dec.design, dec.throwIn).result;
    return { distanceM: r.distanceM, airtimeS: r.airtimeS, verdict: r.verdict };
  } catch {
    return null;
  }
}

export const MIGRATION_NOTICE = '대회 규칙이 더 진짜처럼 바뀌어서 기록을 다시 쟀어요.';

const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

function readJson(st: StorageLike, key: string): unknown {
  try {
    const text = st.getItem(key);
    return text === null ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

function recordCodes(r: Records): string[] {
  const out = r.recent.map((x) => x.code);
  if (r.bestDistance) out.push(r.bestDistance.code);
  if (r.bestAirtime) out.push(r.bestAirtime.code);
  return out;
}

function hangarCodes(h: HangarData): string[] {
  const out: string[] = [];
  for (const p of h.planes) {
    if (p.best.distance?.throwCode) out.push(p.best.distance.throwCode);
    if (p.best.airtime?.throwCode) out.push(p.best.airtime.throwCode);
  }
  return out;
}

/** 저장된 그대로의 격납고에는 있었지만 읽어 들이면서(reviveHangar) 버려진 최고 기록의 수. 남은 비행기만 센다. */
function bestsLostOnRevive(raw: unknown, revived: HangarData): number {
  try {
    const planes = (raw as { planes?: unknown } | null)?.planes;
    if (!Array.isArray(planes)) return 0;
    let lost = 0;
    for (const p of revived.planes) {
      const src = planes.find((x) => typeof x === 'object' && x !== null && (x as { id?: unknown }).id === p.id) as { best?: unknown } | undefined;
      const best = src && typeof src.best === 'object' && src.best !== null ? (src.best as Record<string, unknown>) : null;
      if (!best) continue;
      for (const k of ['distance', 'airtime'] as const) {
        const b = best[k] as { value?: unknown } | null | undefined;
        const had = typeof b === 'object' && b !== null && typeof b.value === 'number' && Number.isFinite(b.value) && b.value >= 0;
        if (had && p.best[k] === undefined) lost++;
      }
    }
    return lost;
  } catch {
    return 0;
  }
}

/** 내 기록을 새 계산값으로 고친다(순수 함수). evals 에 없는 코드는 "계산할 수 없음"으로 본다. */
export function remeasureRecords(prev: Records, evals: ReadonlyMap<string, FlightEval | null>): { next: Records; changed: number; dropped: number } {
  let changed = 0, dropped = 0;
  const fix = (r: FlightRecord): FlightRecord | null => {
    const e = evals.get(r.code);
    if (!e) return null;
    return { ...r, distanceM: e.distanceM, airtimeS: e.airtimeS, verdict: e.verdict };
  };
  const tally = (before: FlightRecord, after: FlightRecord | null): void => {
    if (!after) dropped++;
    else if (!same(before.distanceM, after.distanceM) || !same(before.airtimeS, after.airtimeS) || before.verdict !== after.verdict) changed++;
  };
  const recent: FlightRecord[] = [];
  for (const r of prev.recent) {
    const f = fix(r);
    tally(r, f);
    if (f) recent.push(f);
  }
  const bd = prev.bestDistance ? fix(prev.bestDistance) : null;
  const ba = prev.bestAirtime ? fix(prev.bestAirtime) : null;
  if (prev.bestDistance) tally(prev.bestDistance, bd);
  if (prev.bestAirtime) tally(prev.bestAirtime, ba);
  // 새 규칙에서는 예전 2등이 1등이 될 수 있다: 남은 기록 모두에서 다시 고른다.
  const pool = [...(bd ? [bd] : []), ...(ba ? [ba] : []), ...recent];
  let bestDistance: FlightRecord | null = null, bestAirtime: FlightRecord | null = null;
  for (const r of pool) {
    if (!bestDistance || r.distanceM > bestDistance.distanceM) bestDistance = r;
    if (!bestAirtime || r.airtimeS > bestAirtime.airtimeS) bestAirtime = r;
  }
  return { next: { bestDistance, bestAirtime, recent }, changed, dropped };
}

/** 격납고 비행기 한 대의 최고 기록을 새 계산값으로 고친다. 비행기는 언제나 남는다. */
export function remeasurePlane(p: SavedPlane, evals: ReadonlyMap<string, FlightEval | null>): { plane: SavedPlane; changed: number; dropped: number } {
  const olds = [p.best.distance, p.best.airtime].filter((b): b is PlaneBest => b !== undefined);
  if (olds.length === 0) return { plane: p, changed: 0, dropped: 0 };
  const pool: { e: FlightEval; at: number; throwCode: string }[] = [];
  for (const b of olds) {
    const e = b.throwCode ? evals.get(b.throwCode) : null;
    if (e && b.throwCode) pool.push({ e, at: b.at, throwCode: b.throwCode });
  }
  let distance: PlaneBest | undefined, airtime: PlaneBest | undefined;
  for (const c of pool) {
    if (!distance || c.e.distanceM > distance.value) distance = { value: c.e.distanceM, at: c.at, throwCode: c.throwCode };
    if (!airtime || c.e.airtimeS > airtime.value) airtime = { value: c.e.airtimeS, at: c.at, throwCode: c.throwCode };
  }
  let changed = 0, dropped = 0;
  const tally = (before: PlaneBest | undefined, after: PlaneBest | undefined): void => {
    if (!before) return;
    if (!after) dropped++;
    else if (!same(before.value, after.value)) changed++;
  };
  tally(p.best.distance, distance);
  tally(p.best.airtime, airtime);
  if (changed === 0 && dropped === 0) return { plane: p, changed, dropped };
  return { plane: { ...p, best: { ...(distance ? { distance } : {}), ...(airtime ? { airtime } : {}) } }, changed, dropped };
}

/**
 * 저장된 판 번호가 지금과 다르면 기록을 다시 잰다. 어떤 일이 있어도 예외를 던지지 않는다.
 */
export async function migratePhysics(deps: MigrationDeps): Promise<MigrationReport> {
  const report: MigrationReport = { ran: false, from: null, to: deps.version, recordsChanged: 0, recordsDropped: 0, bestsChanged: 0, bestsDropped: 0, notify: false };
  const recordsKey = deps.recordsKey ?? RECORDS_KEY, hangarKey = deps.hangarKey ?? HANGAR_KEY, physicsKey = deps.physicsKey ?? PHYSICS_KEY;
  let st: StorageLike | null = null;
  try { st = deps.getStorage(); } catch { st = null; }
  if (!st) return report;
  try {
    const stored = readJson(st, physicsKey);
    report.from = typeof stored === 'number' && Number.isFinite(stored) ? stored : null;
    if (report.from === deps.version) return report;

    const evals = new Map<string, FlightEval | null>();
    const measure = async (codes: string[]): Promise<void> => {
      for (const code of codes) {
        if (evals.has(code)) continue;
        let e: FlightEval | null = null;
        try {
          e = await deps.evaluate(code);
          if (e && !(Number.isFinite(e.distanceM) && Number.isFinite(e.airtimeS))) e = null;
        } catch {
          e = null;
        }
        evals.set(code, e);
        if (deps.pause) await deps.pause();
      }
    };

    // 계산은 쉬어 가며 하고, 저장소를 고쳐 쓰는 일은 한 번에(그 사이에 새 비행이 끼어들지 못하게) 한다.
    // 쉬는 동안 새 기록이 생겼으면 그 코드까지 계산한 뒤에 쓴다.
    for (let round = 0; round < 4; round++) {
      const records = reviveRecords(readJson(st, recordsKey));
      const hangarRaw = readJson(st, hangarKey);
      const hangar = reviveHangar(hangarRaw);
      const missing = [...recordCodes(records), ...hangarCodes(hangar.data)].filter((c) => !evals.has(c));
      if (missing.length > 0 && round < 3) {
        await measure(missing);
        continue;
      }
      report.ran = true;
      const hadRecords = records.recent.length > 0 || records.bestDistance !== null || records.bestAirtime !== null;
      if (hadRecords) {
        const r = remeasureRecords(records, evals);
        report.recordsChanged = r.changed;
        report.recordsDropped = r.dropped;
        if (r.changed > 0 || r.dropped > 0) st.setItem(recordsKey, JSON.stringify(r.next));
      }
      // 더 새로운 앱이 적어 둔 격납고는 건드리지 않는다.
      if (!hangar.newer && hangar.data.planes.length > 0) {
        // 읽어 들일 때 이미 걸러진 기록(지금 규칙보다 센 던지기로 낸 최고 기록)도 "지운 기록"으로 세고,
        // 저장소에도 걸러진 모습으로 다시 적는다.
        const lost = bestsLostOnRevive(hangarRaw, hangar.data);
        report.bestsDropped += lost;
        let touched = lost > 0;
        const planes = hangar.data.planes.map((p) => {
          const r = remeasurePlane(p, evals);
          report.bestsChanged += r.changed;
          report.bestsDropped += r.dropped;
          if (r.plane !== p) touched = true;
          return r.plane;
        });
        if (touched) st.setItem(hangarKey, serializeHangar({ ...hangar.data, planes }));
      }
      break;
    }
    try { deps.clearCaches?.(); } catch { /* 치우지 못해도 기록은 이미 고쳤다 */ }
    st.setItem(physicsKey, JSON.stringify(deps.version));
    report.notify = report.recordsChanged + report.recordsDropped + report.bestsChanged + report.bestsDropped > 0;
    return report;
  } catch {
    // 저장소가 도중에 막혔다: 판 번호를 적지 못했으므로 다음에 켤 때 다시 해 본다.
    return report;
  }
}
