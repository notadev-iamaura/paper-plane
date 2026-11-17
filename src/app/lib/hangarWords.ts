/** 격납고에서 쓰는 말(아이 말투)과 날짜 표시 */
import { getPaper, PRESETS } from '../../core/index';
import { fmt } from './format';
import { originPresetId } from './hangar';
import type { PlaneOrigin, SavedPlane } from './hangar';
import { foldKid } from './kidvoice';

/** 어떻게 만들었는지: 접는 법 이름 또는 "내 맘대로" */
export function originWord(origin: PlaneOrigin): string {
  const id = originPresetId(origin);
  if (id === null) return '내 맘대로 접기';
  const preset = PRESETS.find((p) => p.id === id);
  return foldKid(id, preset?.nameKo ?? '따라 접기').name;
}

export function paperWord(paperId: string): string {
  return getPaper(paperId)?.nameKo ?? '종이';
}

/** 날짜를 아이 말로: 오늘, 어제, 3일 전, 11월 3일 */
export function kidDate(at: number, now: number): string {
  if (!Number.isFinite(at) || at <= 0) return '';
  const day = (ms: number): number => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  if (diff <= 0) return '오늘';
  if (diff === 1) return '어제';
  if (diff < 7) return `${diff}일 전`;
  const d = new Date(at);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 이름표 아래 작은 줄: 가장 자랑할 기록 하나(보는 차례에 맞춰) */
export function tagLine(p: SavedPlane, prefer: 'distance' | 'airtime'): string {
  const d = p.best.distance, t = p.best.airtime;
  const dist = d ? `${fmt(d.value, 1)} m` : '';
  const time = t ? `${fmt(t.value, 1)} 초` : '';
  if (prefer === 'airtime') return time || dist;
  return dist || time;
}

/** 받침 유무에 따라 을/를 을 고른다 */
export function eulReul(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return /[0-9]$/.test(word) ? (/[013678]$/.test(word) ? '을' : '를') : '를';
  return (last - 0xac00) % 28 === 0 ? '를' : '을';
}

/** 받침에 따라 로/으로 를 고른다(ㄹ 받침은 "로") */
export function roEuro(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return /[036]$/.test(word) ? '으로' : '로';
  const jong = (last - 0xac00) % 28;
  return jong === 0 || jong === 8 ? '로' : '으로';
}
