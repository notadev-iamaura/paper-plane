/**
 * 바람 실험실이 이 브라우저에 적어 두는 것: 마친 실험 카드(도장), 격납고에 넣지 않은 비행기의 실험 쪽지.
 * 저장소가 막혀 있으면 이번 방문 동안만 기억한다.
 */
import { loadJson, saveJson } from '../storage';
import { EXPERIMENTS, reviveLabNote } from './labMath';
import type { ExperimentId, LabNote } from './labMath';

export const LAB_KEY = 'pp.lab.v1';
const NOTES_MAX = 12;

export interface LabProgress {
  v: 1;
  /** 마친 실험과 마친 때 */
  done: Partial<Record<ExperimentId, number>>;
  /** 설계 코드 -> 쪽지(격납고에 넣지 않은 비행기용. 최근 것만 남긴다) */
  notes: Record<string, LabNote>;
}

let memory: LabProgress | null = null;

export function reviveLabProgress(raw: unknown): LabProgress {
  const out: LabProgress = { v: 1, done: {}, notes: {} };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as { done?: unknown; notes?: unknown };
  if (typeof r.done === 'object' && r.done !== null) {
    for (const e of EXPERIMENTS) {
      const at = (r.done as Record<string, unknown>)[e.id];
      if (typeof at === 'number' && Number.isFinite(at)) out.done[e.id] = at;
    }
  }
  if (typeof r.notes === 'object' && r.notes !== null) {
    for (const [code, v] of Object.entries(r.notes as Record<string, unknown>).slice(0, NOTES_MAX)) {
      const n = reviveLabNote(v);
      if (n && code.length > 0 && code.length <= 600) out.notes[code] = n;
    }
  }
  return out;
}

export function loadLabProgress(): LabProgress {
  if (memory) return memory;
  memory = reviveLabProgress(loadJson(LAB_KEY));
  return memory;
}

function store(next: LabProgress): LabProgress {
  memory = next;
  saveJson(LAB_KEY, next);
  return next;
}

export function markExperimentDone(id: ExperimentId, now: number): LabProgress {
  const cur = loadLabProgress();
  if (cur.done[id] !== undefined) return cur;
  return store({ ...cur, done: { ...cur.done, [id]: now } });
}

export function saveCodeNote(code: string, note: LabNote): LabProgress {
  const cur = loadLabProgress();
  const entries = Object.entries(cur.notes).filter(([c]) => c !== code);
  entries.push([code, note]);
  // 오래된 것부터 버린다.
  entries.sort((a, b) => a[1].at - b[1].at);
  return store({ ...cur, notes: Object.fromEntries(entries.slice(-NOTES_MAX)) });
}

export function codeNote(code: string): LabNote | null {
  return loadLabProgress().notes[code] ?? null;
}

/** 물리 판이 바뀌면 옛 판으로 적은 쪽지는 버린다(도장은 그대로 둔다). 버린 것이 있으면 true. */
export function dropStaleNotes(physics: number): boolean {
  memory = null;
  const cur = loadLabProgress();
  const keep = Object.entries(cur.notes).filter(([, n]) => n.physics === physics);
  if (keep.length === Object.keys(cur.notes).length) return false;
  store({ ...cur, notes: Object.fromEntries(keep) });
  return true;
}
